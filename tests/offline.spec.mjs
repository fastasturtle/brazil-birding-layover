// Offline smoke test. Run after `node scripts/build-offline.mjs`:
//   node tests/offline.spec.mjs
// Needs the playwright package (npm i --no-save playwright) and a Chromium it can find.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const DIST = `${ROOT}/dist`;
const BASE = '/brazil-birding-layover/';
const PORT = 4321;
const ORIGIN = `http://localhost:${PORT}`;
const URL_ = ORIGIN + BASE;
const ctl = (path) => fetch(ORIGIN + '/__ctl/' + path).then((r) => r.text());
const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('ok  ' + msg); };

// Test manifest: the real one without cross-origin tiles (no network in the test).
const real = JSON.parse(readFileSync(`${DIST}/offline-manifest.json`));
const test = { ...real, files: real.files.filter(([u]) => !/^https?:/.test(u)) };
writeFileSync(`${DIST}/offline-manifest.test.json`, JSON.stringify(test));
const PHOTO = test.files.find(([u]) => u.startsWith('img/birds/'))[0];

const server = spawn(process.execPath, [`${ROOT}/tests/server.mjs`, DIST, BASE, String(PORT)], { stdio: 'inherit' });
await sleep(700);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
let failed = false;
try {
  // 1. first visit, worker installs, package downloads (one 503 on a photo must be retried)
  await ctl(`fail?path=${PHOTO}&n=1`);
  await page.goto(URL_ + '?manifest=offline-manifest.test.json', { waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForSelector('#off-download:not([hidden])', { timeout: 15000 });
  await page.click('#off-download');
  await page.waitForFunction(() => document.documentElement.dataset.offlineState === 'complete', null, { timeout: 60000 });
  const status = await page.textContent('#off-status');
  assert(/Пакет полный/.test(status), 'package downloaded: ' + status);
  const errors = await page.textContent('#off-diag');
  assert(/Ошибок при скачивании: 0/.test(errors), 'a 503 was retried without an error');

  // 2. page is served from cache while the server is slow, and revalidation reaches the server
  await ctl('delay?ms=2000');
  const t0 = Date.now();
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  const dt = Date.now() - t0;
  assert(dt < 1500, `cached page rendered in ${dt} ms with a 2 s server delay`);
  await ctl('delay?ms=0');
  await sleep(2500); // let the delayed background revalidation finish before changing the page

  // 3. a changed page is visible from the second visit on
  const idx = `${DIST}/index.html`;
  writeFileSync(idx, readFileSync(idx).toString().replace('</footer>', '<!-- MARKER-42 --></footer>'));
  await page.goto(URL_, { waitUntil: 'load' });
  await sleep(800); // background revalidation
  await page.goto(URL_, { waitUntil: 'load' });
  assert((await page.content()).includes('MARKER-42'), 'updated page served on the next visit');

  // 4. offline: cached page and photo render, any navigation falls back to the cached page
  await context.setOffline(true);
  server.kill();
  await page.goto(URL_, { waitUntil: 'load' });
  assert(await page.$('h1'), 'page renders offline');
  await page.locator(`img[src="${PHOTO}"]`).scrollIntoViewIfNeeded();
  await page.waitForFunction((src) => { const i = document.querySelector(`img[src="${src}"]`); return i && i.complete; }, PHOTO, { timeout: 10000 });
  const w = await page.evaluate((src) => { const i = document.querySelector(`img[src="${src}"]`); return i && i.naturalWidth; }, PHOTO);
  assert(w > 0, `cached photo renders offline (naturalWidth ${w})`);
  const bar = await page.$('#offline-bar:not([hidden])');
  assert(bar, 'offline bar shown');
  const res = await page.goto(URL_ + 'nope/', { waitUntil: 'load' });
  assert(res.status() === 200 && (await page.$('h1')), 'any navigation offline falls back to the cached single page');
} catch (e) {
  failed = true; console.error(e.message);
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
