# Сан-Паулу за 6,5 часов: птицы и обед

Одностраничный гид для пересадки в аэропорту Гуарульос (GRU): два плана по времени,
логистика аэропорта, парки для бёрдвотчинга (Parque Ecológico do Tietê + Bosque Maia),
46 карточек птиц с фото и ссылками eBird / iNaturalist, где спокойно поесть, план Б.
Работает офлайн как PWA: раздел «Офлайн» на странице скачивает пакет ≈ 3 МБ.

Сайт: https://fastasturtle.github.io/brazil-birding-layover/

## Структура

- `index.html`, `offline.js`, `vendor/leaflet`, `img/birds`, `icons/`, `manifest.webmanifest` — исходники сайта.
- `sw.template.js` — service worker, версия вшивается при сборке.
- `scripts/build-offline.mjs` — собирает `dist/` и генерирует `offline-manifest.json`, `version.json`, `sw.js`.
- `tests/offline.spec.mjs` — Playwright-смоук офлайн-режима, запускается в CI перед деплоем.
- `docs/OFFLINE.md` — решения и ограничения офлайн-режима.

## Деплой

`.github/workflows/pages.yml`: при пуше в `main` собирает `dist/`, прогоняет тест и публикует `dist/`
на GitHub Pages (Settings → Pages → Source: GitHub Actions).

## Локально

```
node scripts/build-offline.mjs
npm i --no-save playwright@1.56.1
node tests/offline.spec.mjs
node tests/server.mjs dist /brazil-birding-layover/ 4321   # http://localhost:4321/brazil-birding-layover/
```
