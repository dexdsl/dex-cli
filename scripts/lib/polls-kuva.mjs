import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

let cachedKuvaBin = undefined;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function padRight(value, width) {
  const text = String(value ?? '');
  if (text.length >= width) return text;
  return `${text}${' '.repeat(width - text.length)}`;
}

function normalizeSeries(series = []) {
  return Array.isArray(series)
    ? series.map((item) => ({
      t: String(item?.t || item?.timestamp || item?.bucket || '').trim(),
      value: toNumber(item?.value ?? item?.total ?? item?.count, 0),
    }))
      .filter((item) => item.t)
    : [];
}

function fallbackLineChart(series = [], { title = 'Trend', width = 36 } = {}) {
  const points = normalizeSeries(series);
  const max = points.reduce((acc, item) => Math.max(acc, item.value), 0);
  const safeMax = max > 0 ? max : 1;
  const rows = points.map((item) => {
    const ratio = Math.max(0, Math.min(1, item.value / safeMax));
    const bars = Math.round(ratio * width);
    return `${padRight(item.t, 12)} ${String(item.value).padStart(4)} ${'█'.repeat(bars)}${'░'.repeat(Math.max(0, width - bars))}`;
  });
  return [title, ...rows].join('\n');
}

function fallbackStackedChart(seriesByOption = {}, { title = 'Trend (stacked)', width = 26 } = {}) {
  const optionKeys = Object.keys(seriesByOption || {});
  if (!optionKeys.length) return `${title}\n(no data)`;
  const byTime = new Map();
  for (const optionKey of optionKeys) {
    const series = normalizeSeries(seriesByOption[optionKey]);
    for (const point of series) {
      if (!byTime.has(point.t)) byTime.set(point.t, {});
      byTime.get(point.t)[optionKey] = point.value;
    }
  }
  const timeLabels = Array.from(byTime.keys()).sort();
  const rows = [];
  for (const label of timeLabels) {
    const row = byTime.get(label) || {};
    const total = optionKeys.reduce((sum, key) => sum + toNumber(row[key], 0), 0);
    const safeTotal = total > 0 ? total : 1;
    const segments = optionKeys.map((key, index) => {
      const value = toNumber(row[key], 0);
      const ratio = value / safeTotal;
      const bars = Math.max(0, Math.round(ratio * width));
      const glyph = ['█', '▓', '▒', '░'][index % 4];
      return `${glyph.repeat(bars)}`;
    }).join('');
    const normalizedSegments = segments.length > width
      ? segments.slice(0, width)
      : `${segments}${' '.repeat(Math.max(0, width - segments.length))}`;
    rows.push(`${padRight(label, 12)} ${String(total).padStart(4)} ${normalizedSegments}`);
  }
  rows.push('');
  rows.push(`Legend: ${optionKeys.map((key, index) => `${['█', '▓', '▒', '░'][index % 4]}=${key}`).join('  ')}`);
  return [title, ...rows].join('\n');
}

function fallbackVelocityChart(series = [], { title = 'Trend velocity', width = 32 } = {}) {
  const points = normalizeSeries(series);
  const rows = [];
  let prev = null;
  for (const point of points) {
    const delta = prev == null ? 0 : point.value - prev;
    const magnitude = Math.min(width, Math.abs(delta));
    const glyph = delta >= 0 ? '+' : '-';
    rows.push(`${padRight(point.t, 12)} ${String(point.value).padStart(4)} Δ${String(delta).padStart(4)} ${glyph.repeat(magnitude)}`);
    prev = point.value;
  }
  return [title, ...rows].join('\n');
}

function normalizeBreakdown(options = [], counts = {}) {
  const labels = Array.isArray(options) ? options : [];
  const countsObj = counts && typeof counts === 'object' ? counts : {};
  const rows = labels.map((label, index) => ({
    label: String(label || `Option ${index + 1}`).trim() || `Option ${index + 1}`,
    value: Math.max(0, toNumber(countsObj[String(index)] ?? countsObj[index], 0)),
  }));
  return rows.filter((row) => row.label);
}

function buildBreakdownTsv(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const lines = ['label\tvalue'];
  rows.forEach((row) => {
    lines.push(`${String(row?.label || '').replace(/\t/g, ' ')}\t${toNumber(row?.value, 0)}`);
  });
  return lines.join('\n');
}

function fallbackBarBreakdown(options = [], counts = {}, { title = 'Live bar', width = 30 } = {}) {
  const entries = normalizeBreakdown(options, counts);
  const max = entries.reduce((acc, row) => Math.max(acc, row.value), 0);
  const safeMax = max > 0 ? max : 1;
  const rows = entries.map((row) => {
    const ratio = Math.max(0, Math.min(1, row.value / safeMax));
    const bars = Math.round(ratio * width);
    return `${padRight(row.label, 18)} ${String(row.value).padStart(4)} ${'█'.repeat(bars)}${'░'.repeat(Math.max(0, width - bars))}`;
  });
  return [title, ...rows].join('\n');
}

function fallbackPieBreakdown(options = [], counts = {}, { title = 'Live share' } = {}) {
  const entries = normalizeBreakdown(options, counts);
  const total = entries.reduce((acc, row) => acc + row.value, 0);
  const safeTotal = total > 0 ? total : 1;
  const glyphs = ['◉', '◎', '◌', '◍', '◐', '◑'];
  const rows = entries.map((row, index) => {
    const pct = Math.round((row.value / safeTotal) * 100);
    return `${glyphs[index % glyphs.length]} ${padRight(row.label, 18)} ${String(row.value).padStart(4)} (${String(pct).padStart(3)}%)`;
  });
  return [title, ...rows].join('\n');
}

function isExecutable(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeOptNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function resolveTermDimensions(opts = {}) {
  const defaultWidth = Math.max(42, Math.min(120, (process.stdout?.columns || 96) - 8));
  const defaultHeight = 16;
  return {
    width: normalizeOptNumber(opts.termWidth ?? opts.width, defaultWidth, { min: 30, max: 180 }),
    height: normalizeOptNumber(opts.termHeight ?? opts.height, defaultHeight, { min: 10, max: 64 }),
  };
}

function resolveKuvaCandidates() {
  const envPath = String(process.env.DEX_KUVA_BIN || '').trim();
  const localPaths = [
    path.join(PROJECT_ROOT, '.dex-tools', 'bin', 'kuva'),
    path.join(PROJECT_ROOT, '.tools', 'kuva', 'bin', 'kuva'),
  ];
  const candidates = [];
  if (envPath) candidates.push(envPath);
  candidates.push(...localPaths);
  candidates.push('kuva');
  return candidates;
}

function resolveKuvaBin() {
  if (cachedKuvaBin !== undefined) return cachedKuvaBin;
  for (const candidate of resolveKuvaCandidates()) {
    if (candidate === 'kuva') {
      const probe = spawnSync('which', ['kuva'], { encoding: 'utf8' });
      if (probe.status === 0) {
        const resolved = String(probe.stdout || '').trim();
        cachedKuvaBin = resolved || 'kuva';
        return cachedKuvaBin;
      }
      continue;
    }
    if (existsSync(candidate) && isExecutable(candidate)) {
      cachedKuvaBin = candidate;
      return cachedKuvaBin;
    }
  }
  cachedKuvaBin = null;
  return cachedKuvaBin;
}

function buildNumericSeriesTsv(series = []) {
  const points = normalizeSeries(series);
  const lines = ['x\tvalue'];
  points.forEach((point, index) => {
    lines.push(`${index + 1}\t${toNumber(point.value, 0)}`);
  });
  return lines.join('\n');
}

function buildStackedSeriesTsv(seriesByOption = {}) {
  const optionKeys = Object.keys(seriesByOption || {});
  if (!optionKeys.length) return '';
  const byTime = new Map();
  for (const optionKey of optionKeys) {
    const points = normalizeSeries(seriesByOption[optionKey]);
    for (const point of points) {
      if (!byTime.has(point.t)) byTime.set(point.t, {});
      byTime.get(point.t)[optionKey] = point.value;
    }
  }
  const labels = Array.from(byTime.keys()).sort();
  const lines = ['x\tgroup\tvalue'];
  labels.forEach((label, index) => {
    const row = byTime.get(label) || {};
    optionKeys.forEach((group) => {
      lines.push(`${index + 1}\t${group}\t${toNumber(row[group], 0)}`);
    });
  });
  return lines.join('\n');
}

function buildVelocityTsv(series = []) {
  const points = normalizeSeries(series);
  const lines = ['x\tvalue'];
  let prev = null;
  points.forEach((point, index) => {
    const delta = prev == null ? 0 : point.value - prev;
    prev = point.value;
    lines.push(`${index + 1}\t${delta}`);
  });
  return lines.join('\n');
}

async function renderWithKuva({
  mode = 'line',
  stdin = '',
  title = 'Trend',
  termWidth = 56,
  termHeight = 16,
}) {
  const bin = resolveKuvaBin();
  if (!bin || !stdin.trim()) return '';

  const args = mode === 'stacked'
    ? [
      'stacked-area',
      '-',
      '--x-col',
      'x',
      '--group-col',
      'group',
      '--y-col',
      'value',
      '--title',
      title,
      '--terminal',
      '--term-width',
      String(termWidth),
      '--term-height',
      String(termHeight),
      '--theme',
      'dark',
    ]
    : mode === 'bar'
      ? [
        'bar',
        '-',
        '--label-col',
        'label',
        '--value-col',
        'value',
        '--title',
        title,
        '--terminal',
        '--term-width',
        String(termWidth),
        '--term-height',
        String(termHeight),
        '--theme',
        'dark',
      ]
      : mode === 'pie'
        ? [
          'pie',
          '-',
          '--label-col',
          'label',
          '--value-col',
          'value',
          '--title',
          title,
          '--percent',
          '--terminal',
          '--term-width',
          String(termWidth),
          '--term-height',
          String(termHeight),
          '--theme',
          'dark',
        ]
    : [
      'line',
      '-',
      '--x',
      'x',
      '--y',
      'value',
      '--title',
      title,
      '--terminal',
      '--term-width',
      String(termWidth),
      '--term-height',
      String(termHeight),
      '--theme',
      'dark',
    ];

  const output = await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const child = spawn(bin, args, {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const timeoutMs = 2500;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', () => {
      settle('');
    });
    child.on('close', (code) => {
      if (timedOut || code !== 0) {
        settle('');
        return;
      }
      const rendered = stdout.trim();
      if (!rendered || /error/i.test(stderr)) {
        settle('');
        return;
      }
      settle(rendered);
    });

    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });

  return typeof output === 'string' ? output : '';
}

export async function renderLineTrend(series = [], opts = {}) {
  const { width, height } = resolveTermDimensions(opts);
  const rendered = await renderWithKuva({
    mode: 'line',
    stdin: buildNumericSeriesTsv(series),
    title: String(opts.title || 'Trend'),
    termWidth: width,
    termHeight: height,
  });
  if (rendered) return rendered;
  return fallbackLineChart(series, opts);
}

export async function renderStackedOptionTrend(seriesByOption = {}, opts = {}) {
  const { width, height } = resolveTermDimensions(opts);
  const rendered = await renderWithKuva({
    mode: 'stacked',
    stdin: buildStackedSeriesTsv(seriesByOption),
    title: String(opts.title || 'Trend (stacked)'),
    termWidth: width,
    termHeight: height,
  });
  if (rendered) return rendered;
  return fallbackStackedChart(seriesByOption, opts);
}

export async function renderVelocityTrend(series = [], opts = {}) {
  const { width, height } = resolveTermDimensions(opts);
  const rendered = await renderWithKuva({
    mode: 'line',
    stdin: buildVelocityTsv(series),
    title: String(opts.title || 'Trend velocity'),
    termWidth: width,
    termHeight: height,
  });
  if (rendered) return rendered;
  return fallbackVelocityChart(series, opts);
}

export async function renderBarBreakdown(options = [], counts = {}, opts = {}) {
  const entries = normalizeBreakdown(options, counts);
  const { width, height } = resolveTermDimensions(opts);
  const rendered = await renderWithKuva({
    mode: 'bar',
    stdin: buildBreakdownTsv(entries),
    title: String(opts.title || 'Live bar'),
    termWidth: width,
    termHeight: height,
  });
  if (rendered) return rendered;
  return fallbackBarBreakdown(options, counts, opts);
}

export async function renderPieBreakdown(options = [], counts = {}, opts = {}) {
  const entries = normalizeBreakdown(options, counts);
  const { width, height } = resolveTermDimensions(opts);
  const rendered = await renderWithKuva({
    mode: 'pie',
    stdin: buildBreakdownTsv(entries),
    title: String(opts.title || 'Live share'),
    termWidth: width,
    termHeight: height,
  });
  if (rendered) return rendered;
  return fallbackPieBreakdown(options, counts, opts);
}
