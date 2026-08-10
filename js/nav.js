// Shared chrome: top bar (title + refresh), bottom tab bar (mobile) / top
// nav (desktop), a global ticker/sector search bar, and a push-notification
// banner mount. Injected into mount points that each page's HTML provides.

// Session-scoped, not localStorage: a forgotten filter shouldn't silently
// persist across days, but should survive navigating between index.html and
// scan.html within the same visit -- both pages read/write this one key.
const GLOBAL_SEARCH_KEY = 'jarvis:globalSearch';

function getGlobalSearch() {
  try { return sessionStorage.getItem(GLOBAL_SEARCH_KEY) || ''; } catch (e) { return ''; }
}

// Renders once, shared by index.html and scan.html (both load nav.js).
// Filters ticker/sector wherever that data exists (Top 10, Full Scan) --
// zones with neither field (email/tasks/calendar/training) are left alone.
function renderGlobalSearch() {
  const header = document.getElementById('app-header');
  if (!header) return;
  let row = document.getElementById('global-search-row');
  if (!row) {
    row = document.createElement('div');
    row.className = 'global-search-row';
    row.id = 'global-search-row';
    header.after(row);
  }
  const initial = getGlobalSearch();
  row.innerHTML = `
    <div class="global-search">
      ${ICONS.search()}
      <input type="text" id="global-search-input" placeholder="Search ticker or sector…"
             aria-label="Search ticker or sector" value="${escapeHtml(initial)}">
      <button type="button" class="global-search-clear" id="global-search-clear"
              aria-label="Clear search" ${initial ? '' : 'hidden'}>&times;</button>
    </div>`;

  const input = document.getElementById('global-search-input');
  const clearBtn = document.getElementById('global-search-clear');
  const commit = (value) => {
    try { sessionStorage.setItem(GLOBAL_SEARCH_KEY, value); } catch (e) { /* non-fatal */ }
    clearBtn.hidden = !value;
    window.dispatchEvent(new CustomEvent('globalsearch:change', { detail: value }));
  };
  input.addEventListener('input', (e) => commit(e.target.value));
  clearBtn.addEventListener('click', () => {
    input.value = '';
    commit('');
    input.focus();
  });

  // A mount point for push.js's "Enable push notifications" banner -- lives
  // here so both pages get it without either page's own script owning it.
  if (!document.getElementById('push-banner-mount')) {
    const pushMount = document.createElement('div');
    pushMount.id = 'push-banner-mount';
    row.after(pushMount);
  }
}

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

  renderGlobalSearch();
}

function renderTopbar(mountId, title) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  mount.innerHTML = `
    <h1 class="topbar-title">${title}</h1>
    <div style="display:flex;align-items:center;gap:10px;">
      <span class="refresh-indicator" id="refresh-indicator" hidden></span>
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
  const indicator = document.getElementById('refresh-indicator');
  if (!btn) return;
  let hideTimer = null;

  // Success/error feedback distinct from the spinner: the spinner only
  // shows "a fetch is happening", not "did it actually get fresh data or
  // silently fall back to what was already cached" -- a real gap when the
  // whole point of the button is confirming a refresh took effect.
  const flash = (text, kind) => {
    if (!indicator) return;
    clearTimeout(hideTimer);
    indicator.textContent = text;
    indicator.className = `refresh-indicator is-${kind}`;
    indicator.hidden = false;
    hideTimer = setTimeout(() => { indicator.hidden = true; }, 4000);
  };

  btn.addEventListener('click', async () => {
    btn.classList.add('is-loading');
    btn.disabled = true;
    if (indicator) indicator.hidden = true;
    try {
      await onRefresh();
      if (DASHBOARD.networkFailed.size) {
        flash("Couldn't reach the server — showing last known data", 'error');
      } else {
        flash('Updated', 'success');
      }
    } catch (e) {
      flash('Refresh failed', 'error');
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
