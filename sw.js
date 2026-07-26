// App-shell offline caching only. dashboard_data/*.json is never cached
// here -- data.js already fetches it with cache:'no-store' and falls back
// to localStorage itself, which is a more accurate "last known good" than
// whatever this worker happened to have cached.

const CACHE_NAME = 'jarvis-shell-v2';
const SHELL_ASSETS = [
  './',
  'index.html',
  'scan.html',
  'manifest.json',
  'css/styles.css',
  'js/app.js',
  'js/data.js',
  'js/nav.js',
  'js/icons.js',
  'js/components.js',
  'js/today.js',
  'js/tasks.js',
  'js/scan.js',
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
