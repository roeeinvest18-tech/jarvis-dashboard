// App-shell offline caching only. dashboard_data/*.json is never cached
// here -- data.js already fetches it with cache:'no-store' and falls back
// to localStorage itself, which is a more accurate "last known good" than
// whatever this worker happened to have cached.

// v3: purple redesign -- new JS files (gestures.js, push.js) and the CSS
// rewrite need a fresh cache name or an already-installed PWA would keep
// serving the old amber shell until CACHE_NAME changes by hand (bit us
// before, see project memory).
// v5: two-area restructure -- new pages (trading.html), a new shell and
// per-area controllers.
// v6: "Ink" design system -- new palette, new fonts and a de-carded
// component set.
// v7: TradingView chart links and the new Top 10 model -- trading.js and the
// stylesheet both changed, so the cached copies are stale.
// v8: user-controlled backup/restore -- daily.js gained exportAll/importAll
// and os.js the Settings block that drives them.
// v16: Training rebuilt on program/log/analysis -- program.js, workout.js and
// workout-ui.js are new shell files and the stylesheet changed with them.
// v17: Training screen restyled -- workout-ui.js and the stylesheet changed
// again to fix unstyled inputs (a missing appearance:none on <select> and
// fields that grew to fill the row) and to make the row layout compact.
// v18: four fixes across Today and Trading -- the sleep sheet no longer
// rebuilds its <input>s on every time change, the TV-opens count is directly
// typable, the Trading tables show SMA150 distance instead of the setup tag,
// and a holiday/Shabbat toggle excludes a day from every stat. daily.js,
// daily-today.js, trading.js, workout.js and the stylesheet all changed.
// v19: Full Scan filtering -- SMA150 range, relative volume and sector,
// combinable, client-side. trading.js and the stylesheet changed.
// v20: the copy pass -- every user-facing string moved into js/strings.js,
// so an installed PWA without it would render a shell with no labels.
// v21: leg training upgrade -- explosive/strength session ordering, foot &
// fascia exercises, sprint HR-autoregulated rest, and comeback sessions.
// program.js and workout.js gained new fields the old cached workout-ui.js
// wouldn't know how to render.
// v22: Training gained a plates load unit, supersets and a quick add-exercise
// form -- program.js, workout.js, workout-ui.js and the stylesheet all changed.
// v23: Today regrouped into Morning / Afternoon / Evening with target times
// and completion times -- schedule-config.js is new, and daily.js,
// daily-today.js, os.js, strings.js and the stylesheet changed.
// v24: Today gained a date bar for opening and editing a past day; the
// stylesheet and daily-today.js both changed.
// v25: Training screen text contrast, round 2 -- functional labels moved to
// --ink at 12px / 13px, weight 500; styles.css and workout-ui.js changed.
// v26: UI pass phase A -- a 12px type floor for content text, 11px index
// marks, and 16px fields so iOS does not zoom on focus; styles.css changed.
const CACHE_NAME = 'jarvis-shell-v27';
const SHELL_ASSETS = [
  './',
  'index.html',
  'trading.html',
  'os.html',
  'scan.html',
  'manifest.json',
  'css/styles.css',
  'js/app.js',
  'js/strings.js',
  'js/data.js',
  'js/shell.js',
  'js/gestures.js',
  'js/icons.js',
  'js/components.js',
  'js/schedule-config.js',
  'js/daily.js',
  'js/daily-today.js',
  'js/os.js',
  'js/personal-os.js',
  'js/training-hints.js',
  'js/training.js',
  'js/program.js',
  'js/workout.js',
  'js/workout-ui.js',
  'js/market-calendar.js',
  'js/health.js',
  'js/trading-logic.js',
  'js/account.js',
  'js/trading.js',
  'js/push.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept data requests -- always go to the network so refresh
  // is meaningful; data.js handles its own offline fallback.
  if (url.pathname.includes('/dashboard_data/')) return;
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Network-first for the app shell, cache as the offline fallback.
  //
  // Cache-first was the original strategy, but it meant every CSS/JS edit
  // silently served the stale shell until CACHE_NAME was bumped by hand --
  // a change would appear to have no effect, which is a genuinely confusing
  // failure mode on a dashboard that gets iterated on. Network-first costs
  // one conditional request per asset on a warm connection and keeps the
  // offline guarantee intact, because a failed fetch still falls back to
  // whatever was cached last.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      // ignoreSearch for page loads: a home-screen shortcut opens
      // index.html?action=..., which must still work offline.
      .catch(() => caches.match(event.request, { ignoreSearch: event.request.mode === 'navigate' }))
  );
});

// Push notifications mirror the existing Telegram alerts -- market_data.py's
// send_push() sends { title, body } as the payload alongside every
// send_telegram() call, so this is a pure display step, no new alert logic.
self.addEventListener('push', (event) => {
  let data = { title: 'Jarvis', body: 'New alert' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (e) { /* non-fatal */ }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
