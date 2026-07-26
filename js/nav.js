// Shared chrome: top bar (title + refresh), bottom tab bar (mobile) / top
// nav (desktop). Injected into a #app-header / #app-nav mount point that
// each page's HTML provides.

function renderNav(activePage) {
  const pages = [
    { id: 'today', href: 'index.html', label: 'Today', icon: ICONS.navToday() },
    { id: 'scan', href: 'scan.html', label: 'Full Scan', icon: ICONS.navScan() },
  ];

  const tabbar = document.createElement('nav');
  tabbar.className = 'tabbar';
  tabbar.setAttribute('aria-label', 'Primary');
  tabbar.innerHTML = pages.map(p => `
    <a class="tabbar-item" href="${p.href}" ${p.id === activePage ? 'aria-current="page"' : ''}>
      ${p.icon}
      <span>${p.label}</span>
    </a>`).join('');
  document.body.appendChild(tabbar);

  const topnavMount = document.getElementById('app-topnav');
  if (topnavMount) {
    topnavMount.innerHTML = `
      <span class="topnav-brand">Jarvis</span>
      ${pages.map(p => `<a class="topnav-link" href="${p.href}" ${p.id === activePage ? 'aria-current="page"' : ''}>${p.label}</a>`).join('')}
    `;
    topnavMount.className = 'topnav';
  }
}

function renderTopbar(mountId, title) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  mount.innerHTML = `
    <h1 class="topbar-title">${title}</h1>
    <div style="display:flex;align-items:center;gap:10px;">
      <span class="topbar-meta" id="last-updated">updated —</span>
      <button class="refresh-btn" id="refresh-btn" type="button" aria-label="Refresh data">
        ${ICONS.refresh()}
        <span>Refresh</span>
      </button>
    </div>
  `;
}

function wireRefreshButton(onRefresh) {
  const btn = document.getElementById('refresh-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.classList.add('is-loading');
    btn.disabled = true;
    try {
      await onRefresh();
    } finally {
      btn.classList.remove('is-loading');
      btn.disabled = false;
    }
  });
}

function updateLastUpdated(isoTimestamp) {
  const el = document.getElementById('last-updated');
  if (el) el.textContent = isoTimestamp ? `updated ${fmtRelative(isoTimestamp)}` : 'no data yet';
}
