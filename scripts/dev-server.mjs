#!/usr/bin/env node
// Local dev server for web/ with the same rule as CloudFront: real files are served as-is,
// any other path gets index.html so client-side routes (/browse, /item/…) work on reload.
//   node scripts/dev-server.mjs   ->  http://localhost:8123
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../web/', import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 8123);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
};

createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(ROOT, path);
  try {
    if (!(await stat(file)).isFile()) throw new Error('directory');
  } catch {
    file = join(ROOT, 'index.html'); // SPA fallback
  }
  response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  response.end(await readFile(file));
}).listen(PORT, '127.0.0.1', () => console.log(`CampusFind dev server: http://localhost:${PORT}`));
