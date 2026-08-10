// App-shell offline caching only. dashboard_data/*.json is never cached
// here -- data.js already fetches it with cache:'no-store' and falls back
// to localStorage itself, which is a more accurate "last known good" than
// whatever this worker happened to have cached.

// v3: purple redesign -- new JS files (gestures.js, push.js) and the CSS
// rewrite need a fresh cache name or an already-installed PWA would keep
// serving the old amber shell until CACHE_NAME changes by hand (bit us
// before, see project memory).
const CACHE_NAME = 'jarvis-shell-v3';
const SHELL_ASSETS = [
  './',
  'index.html',
  'scan.html',
  'manifest.json',
  'css/styles.css',
  'js/app.js',
  'js/data.js',
  'js/nav.js',
  'js/gestures.js',
  'js/icons.js',
  'js/components.js',
  'js/today.js',
  'js/tasks.js',
  'js/training.js',
  'js/scan.js',
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
      .catch(() => caches.match(event.request))
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
