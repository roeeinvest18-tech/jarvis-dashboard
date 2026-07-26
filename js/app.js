if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline app-shell caching is a progressive enhancement; a
      // registration failure must never block the page from working.
    });
  });
}
