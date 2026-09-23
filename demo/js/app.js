// A demo build (build.json says so) is labelled everywhere, so a screenshot
// or a shared link can never be mistaken for real data.
fetch('dashboard_data/build.json', { cache: 'no-store' })
  .then(r => (r.ok ? r.json() : null))
  .then(build => {
    if (!build || !build.demo) return;
    document.body.classList.add('is-demo');
    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.setAttribute('role', 'note');
    banner.textContent = 'DEMO — synthetic data, not real trading or personal records';
    document.body.prepend(banner);
    document.title = `DEMO — ${document.title}`;
  })
  .catch(() => { /* a missing build.json just means "not a demo" */ });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline app-shell caching is a progressive enhancement; a
      // registration failure must never block the page from working.
    });
  });
}
