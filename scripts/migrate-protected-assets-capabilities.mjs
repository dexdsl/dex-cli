#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeProtectedAssetsFile } from './lib/protected-assets-schema.mjs';

function toText(value) {
  return String(value == null ? '' : value).trim();
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    filePath: path.resolve('data', 'protected.assets.json'),
    write: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--write') {
      args.write = true;
      continue;
    }
    if (arg === '--file') {
      args.filePath = path.resolve(argv[i + 1] || args.filePath);
      i += 1;
      continue;
    }
  }
  return args;
}

function dedupe(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = toText(value).toLowerCase();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function inferAvailableTypes(file = {}) {
  const explicit = dedupe(file.availableTypes || []);
  if (explicit.length) return explicit;

  const type = toText(file.type).toLowerCase();
  if (type === 'audio' || type === 'video' || type === 'pdf') return [type];

  const mime = toText(file.mime).toLowerCase();
  const r2Key = toText(file.r2Key).toLowerCase();
  const label = `${toText(file.label).toLowerCase()} ${toText(file.sourceLabel).toLowerCase()} ${toText(file.fileId).toLowerCase()}`;

  const available = [];
  if (mime.startsWith('audio/') || /\.(wav|aif|aiff|flac|mp3|m4a)(\?|$)/.test(r2Key) || /\b(wav|aif|aiff|flac|mp3|m4a|audio|ste|stereo)\b/.test(label)) {
    available.push('audio');
  }
  if (mime.startsWith('video/') || /\.(mov|mp4|mxf|mkv|webm)(\?|$)/.test(r2Key) || /(4k|1080|720|video|prores|h264|h265)/.test(label)) {
    available.push('video');
  }
  if (mime.includes('pdf') || /\.pdf(\?|$)/.test(r2Key) || /\b(pdf|recording index)\b/.test(label)) {
    available.push('pdf');
  }

  const normalized = dedupe(available);
  return normalized.length ? normalized : ['unknown'];
}

function inferType(availableTypes = []) {
  const types = dedupe(availableTypes);
  if (types.includes('pdf')) return 'pdf';
  if (types.includes('audio') && !types.includes('video')) return 'audio';
  if (types.includes('video') && !types.includes('audio')) return 'video';
  if (types.includes('audio') && types.includes('video')) return 'unknown';
  return 'unknown';
}

async function main() {
  const args = parseArgs();
  const rawText = await fs.readFile(args.filePath, 'utf8');
  const raw = JSON.parse(rawText);
  const normalized = normalizeProtectedAssetsFile(raw);

  let changed = 0;
  for (const lookup of normalized.lookups || []) {
    const pdfAssetId = toText(lookup.recordingIndex?.pdfAssetId).toLowerCase();
    for (const file of lookup.files || []) {
      const before = JSON.stringify(file);
      file.sourceLabel = toText(file.sourceLabel || file.label);
      file.availableTypes = inferAvailableTypes(file).filter((value) => value !== 'unknown');
      file.type = inferType(file.availableTypes);
      file.role = toText(file.role).toLowerCase() || 'media';

      if (pdfAssetId && toText(file.fileId).toLowerCase() === pdfAssetId) {
        file.role = 'recording_index_pdf';
      }
      if (file.role === 'recording_index_pdf') {
        file.availableTypes = dedupe([...file.availableTypes, 'pdf']);
        if (file.type === 'unknown') file.type = 'pdf';
      }
      if (!file.availableTypes.length) {
        file.availableTypes = file.type === 'unknown' ? [] : [file.type];
      }

      const after = JSON.stringify(file);
      if (before !== after) changed += 1;
    }
  }

  if (!args.write) {
    console.log(`migrate-protected-assets-capabilities: scanned=${normalized.lookups.length} lookups changedFiles=${changed} mode=check`);
    if (changed > 0) {
      console.log('Run with --write to persist inferred availableTypes/type/role/sourceLabel metadata.');
    }
    return;
  }

  normalized.updatedAt = new Date().toISOString();
  await fs.writeFile(args.filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  console.log(`migrate-protected-assets-capabilities: scanned=${normalized.lookups.length} lookups changedFiles=${changed} mode=write path=${args.filePath}`);
}

main().catch((error) => {
  console.error(`migrate-protected-assets-capabilities failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
