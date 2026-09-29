// Builds dist/ from the site sources and generates the offline package files:
//   offline-manifest.json  { version, hash, built, files: [[url, ver, size], ...] }
//   version.json           { version, hash, built }
//   sw.js                  from sw.template.js with the version baked in
// and stamps <meta name="build-version"> into dist/index.html.
// No dependencies; run with: node scripts/build-offline.mjs
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const DIST = join(ROOT, 'dist');
const INCLUDE = ['index.html', 'offline.js', 'manifest.webmanifest', 'icons', 'vendor', 'img', '.nojekyll'];
const SERVICE = new Set(['sw.js', 'version.json', 'offline-manifest.json']);

// Map tiles for the default map view (index.html: center -23.462,-46.50, zoom 12).
// OSM tiles are cross-origin; they go into the package as fixed keys (the URL is the version).
const TILE_ZOOM = 12, TILE_X = [1517, 1520], TILE_Y = [2321, 2323], TILE_SIZE = 20_000;

function version() {
  const sha = process.env.GITHUB_SHA || (() => { try { return execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(); } catch { return ''; } })();
  const dirty = !process.env.GITHUB_SHA && (() => { try { return execSync('git status --porcelain', { cwd: ROOT }).toString().trim() !== ''; } catch { return false; } })();
  return (sha.slice(0, 10) || 'local') + (dirty ? '-dev' : '');
}
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const short = (buf) => sha256(buf).slice(0, 12);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST);
for (const item of INCLUDE) {
  if (existsSync(join(ROOT, item))) cpSync(join(ROOT, item), join(DIST, item), { recursive: true });
}

const ver = version();
const built = new Date().toISOString();
const files = [];
for (const abs of walk(DIST).sort()) {
  const rel = relative(DIST, abs).split(sep).join('/');
  if (SERVICE.has(rel) || rel === '.nojekyll') continue;
  let buf = readFileSync(abs);
  if (rel === 'index.html') {
    // hash without the build-version line, otherwise every deploy re-downloads the page
    buf = Buffer.from(buf.toString().replace(/<meta name="build-version"[^>]*>\n?/, ''));
  }
  files.push([rel, short(buf), statSync(abs).size]);
}
for (let x = TILE_X[0]; x <= TILE_X[1]; x++)
  for (let y = TILE_Y[0]; y <= TILE_Y[1]; y++)
    files.push([`https://tile.openstreetmap.org/${TILE_ZOOM}/${x}/${y}.png`, 'key', TILE_SIZE]);

files.sort((a, b) => a[0] < b[0] ? -1 : 1);
const hash = sha256(JSON.stringify(files)).slice(0, 12);
writeFileSync(join(DIST, 'offline-manifest.json'), JSON.stringify({ version: ver, hash, built, files }));
writeFileSync(join(DIST, 'version.json'), JSON.stringify({ version: ver, hash, built }));

const sw = readFileSync(join(ROOT, 'sw.template.js')).toString().replaceAll('__VERSION__', ver);
writeFileSync(join(DIST, 'sw.js'), sw);

const idx = join(DIST, 'index.html');
const html = readFileSync(idx).toString();
if (!html.includes('<meta name="build-version"')) throw new Error('index.html: missing <meta name="build-version">');
writeFileSync(idx, html.replace(/<meta name="build-version" content="[^"]*">/, `<meta name="build-version" content="${ver}">`));

const total = files.reduce((s, f) => s + f[2], 0);
console.log(`dist/ built: version ${ver}, hash ${hash}, ${files.length} files, ≈${(total / 1e6).toFixed(1)} MB`);
