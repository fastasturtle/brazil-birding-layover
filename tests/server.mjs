// Tiny static server for the offline smoke test. Serves DIR under BASE with test hooks:
//   GET /__ctl/delay?ms=N            delay every response by N ms
//   GET /__ctl/fail?path=P&n=N       answer 503 N times for P (path relative to base), then 200
//   GET /__ctl/reset
// Usage: node tests/server.mjs <dir> <base> <port>
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const [dir, base = '/brazil-birding-layover/', port = '4321'] = process.argv.slice(2);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
let delay = 0; const fails = new Map();

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/__ctl/')) {
    if (url.pathname === '/__ctl/delay') delay = Number(url.searchParams.get('ms')) || 0;
    if (url.pathname === '/__ctl/fail') fails.set(url.searchParams.get('path'), Number(url.searchParams.get('n')) || 0);
    if (url.pathname === '/__ctl/reset') { delay = 0; fails.clear(); }
    res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok');
  }
  if (!url.pathname.startsWith(base)) { res.writeHead(404); return res.end('outside base'); }
  let rel = url.pathname.slice(base.length);
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  if (delay) await new Promise((r) => setTimeout(r, delay));
  const left = fails.get(rel) || 0;
  if (left > 0) { fails.set(rel, left - 1); res.writeHead(503, { 'Content-Type': 'text/plain' }); return res.end('flaky'); }
  const file = join(dir, rel);
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('dir');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); }
}).listen(Number(port), () => console.log(`serving ${dir} at http://localhost:${port}${base}`));
