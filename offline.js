/* Offline package: registration, download/update/delete, diagnostics, new-version banner, offline bar.
   The worker only serves; this script downloads (page and worker sleep alike on iOS, the page is easier to debug). */
(() => {
  const BASE = new URL('./', location.href).href;
  const PAGES = 'pages-v1', MEDIA = 'media-v1';
  const LS_VERS = 'offline.vers', LS_PKG = 'offline.pkg';
  const params = new URLSearchParams(location.search);
  const MANIFEST_URL = new URL(params.get('manifest') || 'offline-manifest.json', BASE).href;
  const buildVersion = document.querySelector('meta[name="build-version"]')?.content || '';
  const $ = (id) => document.getElementById(id);
  const el = {
    status: $('off-status'), bar: $('off-bar'), btn: $('off-download'), check: $('off-check'), stop: $('off-stop'),
    del: $('off-delete'), diag: $('off-diag'), errors: $('off-errors'), banner: $('new-version'), offline: $('offline-bar'),
    offlineDate: $('offline-date'), reload: $('new-version-reload')
  };
  if (!el.status) return;

  const state = { manifest: null, cached: new Set(), errors: [], lastError: '', running: false, abort: null, sw: null, swVersion: '', persisted: null };
  const fmtMB = (b) => `≈ ${(b / 1e6).toFixed(1)} МБ`;
  const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
  const keyOf = (url) => { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; };
  const abs = (p) => /^https?:/.test(p) ? p : new URL(p, BASE).href;
  const sameOrigin = (u) => new URL(u).origin === location.origin;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const supported = 'serviceWorker' in navigator && 'caches' in window;

  // ---------- registration ----------
  async function register() {
    if (!supported) { el.status.textContent = 'Этот браузер не поддерживает офлайн-режим (нужен Safari 11.3+ или Chrome).'; return; }
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') { el.status.textContent = 'Офлайн-режим работает только по HTTPS.'; return; }
    try {
      state.sw = await navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' });
      navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'version') { state.swVersion = e.data.version; renderDiag(); } });
      const ask = () => navigator.serviceWorker.controller?.postMessage('version');
      navigator.serviceWorker.ready.then(ask);
      navigator.serviceWorker.addEventListener('controllerchange', ask);
      ask();
    } catch (e) { el.status.textContent = 'Не удалось запустить офлайн-режим: ' + e.message; }
  }

  // ---------- package state ----------
  async function loadManifest() {
    const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('manifest ' + res.status);
    state.manifest = await res.json();
  }
  async function scanCache() {
    state.cached = new Set();
    for (const name of [PAGES, MEDIA]) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) state.cached.add(keyOf(req.url));
    }
  }
  function diff() {
    const vers = readJSON(LS_VERS, {});
    const todo = [];
    for (const [url, ver, size] of state.manifest.files) {
      const key = keyOf(abs(url));
      const stale = ver !== 'key' && vers[key] !== ver;
      if (!state.cached.has(key) || stale) todo.push({ url: abs(url), key, ver, size });
    }
    return todo;
  }
  function render() {
    const m = state.manifest;
    if (!m) return;
    const total = m.files.length;
    const have = m.files.filter(([u]) => state.cached.has(keyOf(abs(u)))).length;
    const todo = diff();
    const bytes = todo.reduce((s, f) => s + f.size, 0);
    const pkg = readJSON(LS_PKG, null);
    el.bar.style.width = `${Math.round(100 * have / total)}%`;
    document.documentElement.dataset.offlineState = state.running ? 'downloading' : todo.length === 0 ? 'complete' : have === 0 ? 'empty' : 'partial';
    if (state.running) {
      el.status.textContent = `Скачивание: ${have} из ${total} файлов`;
      el.btn.hidden = true; el.stop.hidden = false;
    } else if (todo.length === 0) {
      el.status.textContent = `Пакет полный: ${total} файлов, версия сайта ${m.version}` + (pkg?.built ? `, собран ${new Date(pkg.built).toLocaleString('ru-RU')}` : '') + '. Можно выключать интернет.';
      el.btn.hidden = true; el.stop.hidden = true;
    } else {
      const label = have === 0 ? 'Скачать пакет' : pkg && pkg.hash !== m.hash ? 'Обновить пакет' : 'Докачать пакет';
      el.status.textContent = have === 0 ? `Пакет не скачан. Файлов: ${total}.` : `В кэше ${have} из ${total} файлов` + (pkg && pkg.hash !== m.hash ? ', есть новая версия пакета.' : '.');
      el.btn.textContent = `${label} (${fmtMB(bytes)})`;
      el.btn.hidden = false; el.stop.hidden = true;
    }
    el.del.hidden = have === 0 && !pkg;
    renderDiag();
  }
  async function renderDiag() {
    const lines = [];
    try { const e = await navigator.storage?.estimate?.(); if (e) lines.push(`Хранилище: занято ${(e.usage / 1e6).toFixed(1)} МБ из ${(e.quota / 1e9).toFixed(1)} ГБ`); } catch { /* n/a */ }
    lines.push(`persist(): ${state.persisted === null ? 'не запрашивали' : state.persisted ? 'да' : 'нет'}`);
    const reg = state.sw;
    lines.push(`Service worker: ${!supported ? 'не поддерживается' : reg ? (reg.active ? 'активен' : reg.installing ? 'устанавливается' : reg.waiting ? 'ждёт' : 'нет') : 'не зарегистрирован'}${state.swVersion ? ', версия ' + state.swVersion : ''}${navigator.serviceWorker?.controller ? ', управляет страницей' : ''}`);
    lines.push(`Страница: версия ${buildVersion || '?'}, режим ${matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'с экрана «Домой»' : 'браузер'}, сеть ${navigator.onLine ? 'есть' : 'нет'}`);
    lines.push(`Ошибок при скачивании: ${state.errors.length}${state.lastError ? ', последняя: ' + state.lastError : ''}`);
    lines.push(`User-Agent: ${navigator.userAgent}`);
    el.diag.textContent = lines.join('\n');
  }

  // ---------- download ----------
  async function fetchRetry(url, signal) {
    let last = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, sameOrigin(url) ? { cache: 'no-cache', signal } : { mode: 'cors', credentials: 'omit', cache: 'no-cache', signal });
        if (res.ok) return res;
        last = `${url} (${res.status})`;
        if (![408, 429].includes(res.status) && res.status < 500) break;
        const ra = Number(res.headers.get('Retry-After')) || 0;
        await sleep(Math.max(ra * 1000, 1000 * attempt + Math.random() * 1000));
      } catch (e) {
        if (signal.aborted) throw e;
        last = `${url} (${e.message})`;
        await sleep(1000 * attempt + Math.random() * 1000);
      }
    }
    throw new Error(last);
  }
  async function download() {
    if (state.running) return;
    state.running = true; state.errors = []; state.lastError = '';
    state.abort = new AbortController();
    const { signal } = state.abort;
    let wake = null;
    try {
      if (state.persisted === null && navigator.storage?.persist) { try { state.persisted = await navigator.storage.persist(); } catch { state.persisted = false; } }
      try { wake = await navigator.wakeLock?.request?.('screen'); } catch { /* not allowed */ }
      await loadManifest(); await scanCache(); render();
      const queue = diff();
      const vers = readJSON(LS_VERS, {});
      const pages = await caches.open(PAGES), media = await caches.open(MEDIA);
      let i = 0;
      const worker = async () => {
        while (i < queue.length && !signal.aborted) {
          const f = queue[i++];
          try {
            const res = await fetchRetry(f.url, signal);
            await (sameOrigin(f.url) ? pages : media).put(f.key, res);
            state.cached.add(f.key);
            if (f.ver !== 'key') { vers[f.key] = f.ver; writeJSON(LS_VERS, vers); }
          } catch (e) {
            if (signal.aborted) return;
            state.errors.push(e.message); state.lastError = e.message;
          }
          render();
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      if (!signal.aborted && state.errors.length === 0) {
        // prune what the manifest no longer lists, keep runtime-cached fonts and tiles outside the package
        const keep = new Set(state.manifest.files.map(([u]) => keyOf(abs(u))));
        for (const req of await pages.keys()) {
          const k = keyOf(req.url);
          if (!keep.has(k) && !/(sw\.js|version\.json|offline-manifest[^/]*\.json)$/.test(new URL(k).pathname)) await pages.delete(req);
        }
        for (const req of await media.keys()) { const k = keyOf(req.url); if (/tile\.openstreetmap\.org/.test(k) && !keep.has(k)) await media.delete(req); }
        writeJSON(LS_PKG, { version: state.manifest.version, hash: state.manifest.hash, built: state.manifest.built });
        await scanCache();
        checkVersion(true);
      }
    } catch (e) {
      state.lastError = e.message; state.errors.push(e.message);
    } finally {
      state.running = false; state.abort = null;
      try { await wake?.release(); } catch { /* ignore */ }
      render();
    }
  }
  async function check() {
    el.check.disabled = true;
    try { await loadManifest(); await scanCache(); render(); state.lastError = ''; }
    catch (e) { state.lastError = e.message; renderDiag(); el.status.textContent = 'Не удалось проверить: ' + e.message; }
    finally { el.check.disabled = false; }
  }
  let armed = false;
  async function remove() {
    if (!armed) { armed = true; el.del.textContent = 'Точно удалить?'; setTimeout(() => { armed = false; el.del.textContent = 'Удалить пакет'; }, 4000); return; }
    armed = false; el.del.textContent = 'Удалить пакет';
    state.abort?.abort();
    await caches.delete(PAGES); await caches.delete(MEDIA);
    try { localStorage.removeItem(LS_VERS); localStorage.removeItem(LS_PKG); } catch { /* ignore */ }
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) await r.unregister();
    state.sw = null; state.swVersion = '';
    await scanCache(); render();
    el.status.textContent = 'Пакет удалён. Перезагрузите страницу, чтобы снова включить офлайн-режим.';
  }

  // ---------- shell: new version banner, offline bar ----------
  let lastCheck = 0;
  async function checkVersion(force) {
    if (!buildVersion || !navigator.onLine) return;
    if (document.documentElement.dataset.offlineState === 'downloading') return;
    const now = Date.now();
    if (!force && now - lastCheck < 60_000) return;
    lastCheck = now;
    try {
      const res = await fetch(new URL('version.json', BASE), { cache: 'no-store' });
      if (!res.ok) return;
      const v = await res.json();
      if (v.version && v.version !== buildVersion) el.banner.hidden = false;
      if (state.manifest && v.hash && v.hash !== state.manifest.hash) { await loadManifest(); render(); }
    } catch { /* offline */ }
  }
  function offlineBar() {
    const pkg = readJSON(LS_PKG, null);
    el.offline.hidden = navigator.onLine;
    el.offlineDate.textContent = pkg?.built ? new Date(pkg.built).toLocaleDateString('ru-RU') : (buildVersion || '');
    renderDiag();
  }

  el.btn.addEventListener('click', download);
  el.check.addEventListener('click', check);
  el.stop.addEventListener('click', () => state.abort?.abort());
  el.del.addEventListener('click', remove);
  el.reload?.addEventListener('click', () => location.reload());
  window.addEventListener('online', () => { offlineBar(); checkVersion(false); });
  window.addEventListener('offline', offlineBar);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion(false); });

  (async () => {
    offlineBar();
    await register();
    if (!supported) return;
    try { await loadManifest(); await scanCache(); render(); } catch (e) { el.status.textContent = navigator.onLine ? 'Не удалось загрузить список файлов: ' + e.message : 'Нет сети: список файлов недоступен.'; renderDiag(); }
    checkVersion(false);
  })();
})();
