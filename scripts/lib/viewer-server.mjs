import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { clearRecents, loadRecents } from './recents-store.mjs';

const DEFAULT_PORT = 4173;
const MAX_PORT_ATTEMPTS = 30;
const LIST_CAP = 250;

const MIME_TYPES = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
};

const KNOWN_OUTPUT_DIRS = ['entries'];
const LOCAL_ASSET_ROOTS = [path.join('public', 'assets'), 'assets', path.join('docs', 'assets')];
const LOCAL_CSS_ROOTS = [path.join('public', 'css'), 'css', path.join('docs', 'css')];
const LOCAL_STATIC_ROOTS = [path.join('public', 'static'), 'static', path.join('docs', 'static')];
const LOCAL_DATA_ROOTS = [path.join('public', 'data'), 'data', path.join('docs', 'data')];
const BREADCRUMB_RUNTIME_PATH = '/assets/js/dex-breadcrumb-motion.js';
const BREADCRUMB_RUNTIME_URLS = [
  'https://dexdsl.github.io/assets/js/dex-breadcrumb-motion.js',
  'https://www.dexdsl.github.io/assets/js/dex-breadcrumb-motion.js',
  'https://dexdsl.org/assets/js/dex-breadcrumb-motion.js',
  'https://dexdsl.com/assets/js/dex-breadcrumb-motion.js',
];

function htmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizePath(inputPath) {
  return path.resolve(String(inputPath || ''));
}

function isWithinRoot(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveSafePathUnderRoot(rootDir, requestedPath = '') {
  const rootPath = normalizePath(rootDir);
  let raw = String(requestedPath || '').replace(/\\/g, '/');
  try {
    raw = decodeURIComponent(raw);
  } catch {}
  const withoutLeadingSlash = raw.replace(/^\/+/, '');
  const candidate = normalizePath(path.join(rootPath, withoutLeadingSlash));
  if (!isWithinRoot(candidate, rootPath)) return null;
  return candidate;
}

function encodeFileId(filePath) {
  return Buffer.from(String(filePath || ''), 'utf8').toString('base64url');
}

function decodeFileId(id) {
  try {
    const value = Buffer.from(String(id || ''), 'base64url').toString('utf8');
    if (!value) return '';
    return normalizePath(value);
  } catch {
    return '';
  }
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function send(res, statusCode, body, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  const payload = Buffer.isBuffer(body) || body instanceof Uint8Array
    ? body
    : typeof body === 'string'
      ? body
      : JSON.stringify(body);
  res.writeHead(statusCode, {
    ...BASE_HEADERS,
    'Content-Type': contentType,
    ...extraHeaders,
  });
  res.end(payload);
}

function rewriteViewerHtml(html) {
  let output = String(html || '');
  output = output.replace(
    /https?:\/\/(?:www\.)?dexdsl\.(?:github\.io|org|com)\/((?:assets|css|static|scripts)\/)/gi,
    '/$1',
  );
  for (const runtimeUrl of BREADCRUMB_RUNTIME_URLS) {
    output = output.split(runtimeUrl).join(BREADCRUMB_RUNTIME_PATH);
  }
  if (!output.includes('__dxChromeTemplateCandidates')) {
    const viewerChromeHint = '<script>window.__dxChromeTemplateCandidates=["/__dx/chrome-template"];</script>';
    output = output.replace(/<head([^>]*)>/i, `<head$1>\n${viewerChromeHint}`);
  }
  return output;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveViewerChromeTemplatePath(cwd) {
  const candidates = [
    path.join(cwd, 'docs', 'index.html'),
    path.join(cwd, 'index.html'),
    path.join(cwd, 'docs', 'entry', 'settings', 'index.html'),
    path.join(cwd, 'entry-template', 'index.html'),
  ];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return '';
}

async function resolveViewerStaticPath(cwd, pathname, { prefix, roots }) {
  if (!String(pathname || '').startsWith(prefix)) return '';
  const trailing = String(pathname || '').slice(prefix.length);
  for (const relativeRoot of roots) {
    const rootPath = normalizePath(path.join(cwd, relativeRoot));
    const candidate = resolveSafePathUnderRoot(rootPath, trailing);
    if (!candidate) continue;
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {}
  }
  return '';
}

async function listHtmlFiles(rootDir, { max = LIST_CAP } = {}) {
  const rootPath = normalizePath(rootDir);
  const files = [];
  const queue = [rootPath];

  while (queue.length && files.length < max) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= max) break;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (path.extname(entry.name).toLowerCase() !== '.html') continue;
      files.push({
        path: absolute,
        displayName: path.relative(rootPath, absolute) || entry.name,
        timestamp: Date.now(),
        source: 'root',
      });
    }
  }

  return files;
}

async function listRecentFiles() {
  const recents = await loadRecents();
  const existing = [];
  for (const item of recents) {
    const absolutePath = normalizePath(item.path);
    if (path.extname(absolutePath).toLowerCase() !== '.html') continue;
    if (!(await fileExists(absolutePath))) continue;
    existing.push({
      path: absolutePath,
      displayName: item.displayName || path.basename(absolutePath),
      timestamp: item.timestamp || Date.now(),
      source: 'recent',
    });
  }
  return existing;
}

async function discoverAllowedRoots(cwd, explicitRoot) {
  const roots = [];
  if (explicitRoot) roots.push(normalizePath(explicitRoot));
  for (const relative of KNOWN_OUTPUT_DIRS) {
    const candidate = normalizePath(path.join(cwd, relative));
    if (await fileExists(candidate)) roots.push(candidate);
  }
  return [...new Set(roots)];
}

function isAllowedFile(filePath, { recentSet, allowedRoots }) {
  if (recentSet.has(filePath)) return true;
  return allowedRoots.some((root) => isWithinRoot(filePath, root));
}

function renderListItems(items, emptyText) {
  if (!items.length) {
    return `<li class="empty">${htmlEscape(emptyText)}</li>`;
  }
  return items
    .map((item) => (
      `<li>
        <a class="row" href="/view/${encodeFileId(item.path)}/">
          <span class="name">${htmlEscape(item.displayName)}</span>
          <span class="path">${htmlEscape(item.path)}</span>
        </a>
      </li>`
    ))
    .join('\n');
}

function pickerHtml({ recents, rootFiles, rootPath }) {
  const rootTitle = rootPath ? `Files in ${rootPath}` : 'Output files';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>Dex Viewer</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
        color: #f6f8fb;
        background: radial-gradient(1200px 600px at 15% -10%, #3a5b8c88, transparent),
                    radial-gradient(1000px 700px at 110% 15%, #62466e66, transparent),
                    #0d1017;
      }
      .page { max-width: 980px; margin: 0 auto; padding: 28px 16px 40px; }
      .card {
        background: linear-gradient(145deg, rgba(255,255,255,.12), rgba(255,255,255,.05));
        border: 1px solid rgba(255,255,255,.2);
        border-radius: 16px;
        box-shadow: 0 24px 48px rgba(0,0,0,.28);
        backdrop-filter: blur(10px);
        padding: 18px;
      }
      h1 { margin: 0 0 8px; font-size: 1.3rem; letter-spacing: .02em; }
      p { margin: 0 0 18px; color: #bac4d6; font-size: .95rem; }
      h2 { margin: 18px 0 10px; font-size: .95rem; text-transform: uppercase; letter-spacing: .08em; color: #d6dff0; }
      ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
      .row {
        display: block;
        padding: 10px 12px;
        border-radius: 10px;
        text-decoration: none;
        border: 1px solid rgba(255,255,255,.12);
        background: rgba(10,12,18,.45);
        transition: background .12s ease, border-color .12s ease;
      }
      .row:hover { background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.3); }
      .name { display: block; color: #f6f8fb; font-size: .93rem; }
      .path { display: block; margin-top: 2px; color: #a8b2c3; font-size: .76rem; overflow-wrap: anywhere; }
      .controls { display: flex; justify-content: flex-end; margin-top: 12px; }
      button {
        border: 1px solid rgba(255,255,255,.25);
        background: rgba(255,255,255,.08);
        color: #f6f8fb;
        border-radius: 10px;
        padding: 8px 10px;
        cursor: pointer;
      }
      button:hover { background: rgba(255,255,255,.16); }
      .empty { color: #98a3b7; font-size: .9rem; padding: 8px 2px; }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="card">
        <h1>Dex Local Viewer</h1>
        <p>Open generated pages over <code>http://localhost</code>.</p>
        <h2>Recent files</h2>
        <ul id="recent-list">${renderListItems(recents, 'No recent generated files yet.')}</ul>
        <div class="controls"><button type="button" id="clear-recents">Clear recents</button></div>
        <h2>${htmlEscape(rootTitle)}</h2>
        <ul id="root-list">${renderListItems(rootFiles, 'No HTML files found in allowed output roots.')}</ul>
      </section>
    </main>
    <script>
      (function () {
        var recentList = document.getElementById('recent-list');
        var rootList = document.getElementById('root-list');
        var clearBtn = document.getElementById('clear-recents');

        function esc(value) {
          return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        function render(listEl, items, emptyText) {
          if (!listEl) return;
          if (!Array.isArray(items) || items.length === 0) {
            listEl.innerHTML = '<li class="empty">' + esc(emptyText) + '</li>';
            return;
          }
          listEl.innerHTML = items.map(function (item) {
            return '<li><a class="row" href="/view/' + esc(item.id) + '/">' +
              '<span class="name">' + esc(item.displayName) + '</span>' +
              '<span class="path">' + esc(item.path) + '</span>' +
              '</a></li>';
          }).join('');
        }

        function fetchJson(url) {
          return fetch(url, { cache: 'no-store' }).then(function (res) {
            if (!res.ok) throw new Error('request failed');
            return res.json();
          });
        }

        function refresh() {
          fetchJson('/api/recent')
            .then(function (payload) { render(recentList, payload.items, 'No recent generated files yet.'); })
            .catch(function () {});
          fetchJson('/api/list')
            .then(function (payload) { render(rootList, payload.items, 'No HTML files found in allowed output roots.'); })
            .catch(function () {});
        }

        if (clearBtn) {
          clearBtn.addEventListener('click', function () {
            fetch('/api/recent/clear', { method: 'POST', cache: 'no-store' })
              .then(function () { refresh(); })
              .catch(function () {});
          });
        }

        refresh();
      })();
    </script>
  </body>
</html>`;
}

async function getViewState({ cwd, explicitRoot }) {
  const recents = await listRecentFiles();
  const recentSet = new Set(recents.map((item) => item.path));
  const allowedRoots = await discoverAllowedRoots(cwd, explicitRoot);
  const rootFilesNested = await Promise.all(allowedRoots.map((root) => listHtmlFiles(root)));
  const rootFiles = [];
  const seen = new Set();
  for (const item of rootFilesNested.flat()) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    rootFiles.push(item);
    if (rootFiles.length >= LIST_CAP) break;
  }
  return { recents, recentSet, allowedRoots, rootFiles };
}

async function tryPort(port) {
  return await new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (error) => {
      if (error && error.code === 'EADDRINUSE') resolve(false);
      else resolve(false);
    });
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, '127.0.0.1');
  });
}

async function pickPort(startPort) {
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt += 1) {
    const port = startPort + attempt;
    if (await tryPort(port)) return port;
  }
  throw new Error(`No open port found starting at ${startPort}`);
}

function maybeOpenBrowser(url) {
  const command = process.platform === 'darwin'
    ? { cmd: 'open', args: [url] }
    : process.platform === 'win32'
      ? { cmd: 'cmd', args: ['/c', 'start', '', url] }
      : { cmd: 'xdg-open', args: [url] };
  try {
    spawn(command.cmd, command.args, { stdio: 'ignore', detached: true }).unref();
  } catch {}
}

export async function startViewer({
  cwd = process.cwd(),
  open = true,
  port = DEFAULT_PORT,
  root = '',
} = {}) {
  const explicitRoot = String(root || '').trim() ? normalizePath(root) : '';
  const chosenPort = await pickPort(port);
  const server = http.createServer(async (req, res) => {
    try {
      const method = String(req.method || 'GET').toUpperCase();
      const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = requestUrl.pathname;
      const viewState = await getViewState({ cwd, explicitRoot });

      if (pathname === '/api/recent' && method === 'GET') {
        const items = viewState.recents.map((entry) => ({
          id: encodeFileId(entry.path),
          path: entry.path,
          displayName: entry.displayName,
          timestamp: entry.timestamp,
        }));
        send(res, 200, { items }, 'application/json; charset=utf-8');
        return;
      }

      if (pathname === '/api/recent/clear' && method === 'POST') {
        await clearRecents();
        send(res, 200, { ok: true }, 'application/json; charset=utf-8');
        return;
      }

      if (pathname === '/api/list' && method === 'GET') {
        const items = viewState.rootFiles.map((entry) => ({
          id: encodeFileId(entry.path),
          path: entry.path,
          displayName: entry.displayName,
        }));
        send(res, 200, { items }, 'application/json; charset=utf-8');
        return;
      }

      if (pathname === '/__dx/chrome-template' && method === 'GET') {
        const chromeTemplatePath = await resolveViewerChromeTemplatePath(cwd);
        if (!chromeTemplatePath) {
          send(res, 404, 'Not found');
          return;
        }
        let body;
        try {
          body = await fs.readFile(chromeTemplatePath, 'utf8');
        } catch {
          send(res, 404, 'Not found');
          return;
        }
        send(res, 200, body, 'text/html; charset=utf-8');
        return;
      }

      if (method === 'GET' && pathname.startsWith('/assets/')) {
        const assetPath = await resolveViewerStaticPath(cwd, pathname, {
          prefix: '/assets/',
          roots: LOCAL_ASSET_ROOTS,
        });
        if (!assetPath) {
          send(res, 404, 'Not found');
          return;
        }
        let body;
        try {
          body = await fs.readFile(assetPath);
        } catch {
          send(res, 404, 'Not found');
          return;
        }
        send(res, 200, body, contentTypeFor(assetPath));
        return;
      }

      if (method === 'GET' && pathname.startsWith('/css/')) {
        const cssPath = await resolveViewerStaticPath(cwd, pathname, {
          prefix: '/css/',
          roots: LOCAL_CSS_ROOTS,
        });
        if (!cssPath) {
          send(res, 404, 'Not found');
          return;
        }
        let body;
        try {
          body = await fs.readFile(cssPath);
        } catch {
          send(res, 404, 'Not found');
          return;
        }
        send(res, 200, body, contentTypeFor(cssPath));
        return;
      }

      if (method === 'GET' && pathname.startsWith('/static/')) {
        const staticPath = await resolveViewerStaticPath(cwd, pathname, {
          prefix: '/static/',
          roots: LOCAL_STATIC_ROOTS,
        });
        if (!staticPath) {
          send(res, 404, 'Not found');
          return;
        }
        let body;
        try {
          body = await fs.readFile(staticPath);
        } catch {
          send(res, 404, 'Not found');
          return;
        }
        send(res, 200, body, contentTypeFor(staticPath));
        return;
      }

      if (method === 'GET' && pathname.startsWith('/data/')) {
        const dataPath = await resolveViewerStaticPath(cwd, pathname, {
          prefix: '/data/',
          roots: LOCAL_DATA_ROOTS,
        });
        if (!dataPath) {
          send(res, 404, 'Not found');
          return;
        }
        let body;
        try {
          body = await fs.readFile(dataPath);
        } catch {
          send(res, 404, 'Not found');
          return;
        }
        send(res, 200, body, contentTypeFor(dataPath));
        return;
      }

      if (pathname === '/' && method === 'GET') {
        const html = pickerHtml({
          recents: viewState.recents,
          rootFiles: viewState.rootFiles,
          rootPath: explicitRoot || viewState.allowedRoots[0] || '',
        });
        send(res, 200, html, 'text/html; charset=utf-8');
        return;
      }

      if (pathname.startsWith('/view/')) {
        const match = pathname.match(/^\/view\/([^/]+)(?:\/(.*))?$/);
        if (!match) {
          send(res, 404, 'Not found');
          return;
        }
        const [, id, trailingPath = ''] = match;
        const filePath = decodeFileId(id);
        if (!filePath) {
          send(res, 404, 'Not found');
          return;
        }
        if (!isAllowedFile(filePath, viewState) || path.extname(filePath).toLowerCase() !== '.html') {
          send(res, 403, 'Forbidden');
          return;
        }

        if (!trailingPath && !pathname.endsWith('/')) {
          send(res, 302, '', 'text/plain; charset=utf-8', { Location: `/view/${id}/` });
          return;
        }

        let targetPath = filePath;
        if (trailingPath) {
          const safePath = resolveSafePathUnderRoot(path.dirname(filePath), trailingPath);
          if (!safePath) {
            send(res, 403, 'Forbidden');
            return;
          }
          targetPath = safePath;
        }

        try {
          const stat = await fs.stat(targetPath);
          if (stat.isDirectory()) {
            const indexPath = path.join(targetPath, 'index.html');
            if (!(await fileExists(indexPath))) {
              send(res, 404, 'Not found');
              return;
            }
            targetPath = indexPath;
          }
        } catch {
          send(res, 404, 'Not found');
          return;
        }

        let body;
        try {
          body = await fs.readFile(targetPath);
        } catch {
          send(res, 404, 'Not found');
          return;
        }
        const contentType = contentTypeFor(targetPath);
        if (contentType.startsWith('text/html')) {
          send(res, 200, rewriteViewerHtml(body.toString('utf8')), contentType);
          return;
        }
        send(res, 200, body, contentType);
        return;
      }

      send(res, 404, 'Not found');
    } catch (error) {
      const status = error && (error.code === 'EACCES' || error.code === 'EPERM') ? 403 : 500;
      if (status === 403) {
        send(res, 403, 'Forbidden');
      } else {
        send(res, 500, 'Internal server error');
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(chosenPort, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const url = `http://localhost:${chosenPort}/`;
  if (open) maybeOpenBrowser(url);
  return { server, url, port: chosenPort };
}

export function parseViewerArgs(args = []) {
  const opts = { open: true, port: DEFAULT_PORT, root: '' };
  const parsePort = (value) => {
    const numeric = Number.parseInt(String(value || ''), 10);
    return Number.isInteger(numeric) && numeric > 0 && numeric < 65536 ? numeric : DEFAULT_PORT;
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--no-open') { opts.open = false; continue; }
    if (arg === '--open') { opts.open = true; continue; }
    if (arg === '--port' && next) {
      opts.port = parsePort(next);
      i += 1;
      continue;
    }
    if (arg.startsWith('--port=')) {
      opts.port = parsePort(arg.slice('--port='.length));
      continue;
    }
    if (arg === '--root' && next) {
      opts.root = next;
      i += 1;
      continue;
    }
    if (arg.startsWith('--root=')) {
      opts.root = arg.slice('--root='.length);
    }
  }
  return opts;
}
