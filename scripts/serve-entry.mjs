#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

const inputArg = process.argv[2];
if (!inputArg) {
  console.error('Usage: node scripts/serve-entry.mjs entries/<slug>/index.html');
  process.exit(1);
}

const targetFile = path.resolve(inputArg);
const targetDir = path.dirname(targetFile);
const targetBase = path.basename(targetFile);
const port = Number.parseInt(process.env.PORT || '4173', 10);

try {
  await fs.access(targetFile);
} catch {
  console.warn(`Warning: path does not exist: ${targetFile}`);
}

const MIME = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.mp4': 'video/mp4',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const STATIC_RUNTIME_ROOTS = [
  { prefix: '/assets/', roots: ['public/assets', 'assets', 'docs/assets'] },
  { prefix: '/css/', roots: ['public/css', 'css', 'docs/css'] },
  { prefix: '/static/', roots: ['public/static', 'static', 'docs/static'] },
];

function safeJoin(base, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const normalized = path.normalize(decoded).replace(/^(\.\.(?:[\\/]|$))+/, '');
  const full = path.join(base, normalized);
  if (!full.startsWith(base)) return null;
  return full;
}

async function resolveRuntimeStaticPath(requestPath) {
  for (const candidate of STATIC_RUNTIME_ROOTS) {
    if (!requestPath.startsWith(candidate.prefix)) continue;
    const trailing = requestPath.slice(candidate.prefix.length);
    for (const relativeRoot of candidate.roots) {
      const absoluteRoot = path.resolve(relativeRoot);
      const fullPath = safeJoin(absoluteRoot, trailing);
      if (!fullPath) continue;
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isFile()) return fullPath;
      } catch {}
    }
  }
  return '';
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const requestPath = requestUrl.pathname === '/' ? `/${targetBase}` : requestUrl.pathname;

  const runtimeStaticPath = await resolveRuntimeStaticPath(requestPath);
  if (runtimeStaticPath) {
    try {
      const body = await fs.readFile(runtimeStaticPath);
      const ext = path.extname(runtimeStaticPath).toLowerCase();
      const contentType = MIME[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(body);
      return;
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
  }

  const fullPath = safeJoin(targetDir, requestPath);

  if (!fullPath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  let filePath = fullPath;
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  let body;
  try {
    body = await fs.readFile(filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(body);
});

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use.`);
  } else {
    console.error(error?.message || String(error));
  }
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Serving: ${targetDir}`);
  console.log(`Open: http://localhost:${port}/`);
});
