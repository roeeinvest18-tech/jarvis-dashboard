// Jarvis app shell — two top-level areas, each with its own sub-tabs.
//
// Replaces the old three-item nav (Today / Personal OS / Full Scan), which
// mixed two unrelated modes on one page: Today carried a ticker search and a
// market status bar above the morning routine, so daily use bounced between
// screens. Now the split is by mode, not by feed:
//
//   Personal OS (purple)  Today · Training · Insights · Memory · History
//   Trading     (gold)    Top 10 · Breakouts · Full Scan
//
// Each area is one page (index.html, trading.html) and its sub-tabs are
// client-side panels, which is the pattern scan.html already used. Keeping
// two documents rather than building a router matches the existing
// architecture — no framework, no build step, plain <script> tags — and means
// an area's scripts only load when that area does.
//
// Area colour is load-bearing and nothing else: it marks the eyebrow, the
// active sub-tab underline, the active nav item, and a checked control. It is
// never used decoratively, so colour always answers "which area am I in".

const SHELL_AREAS = [
  {
    id: 'os',
    label: 'Personal OS',
    eyebrow: 'PERSONAL OS',
    href: 'index.html',
    accent: 'purple',
    tabs: [
      { id: 'today', label: 'Today' },
      { id: 'training', label: 'Training' },
      { id: 'insights', label: 'Insights' },
      { id: 'memory', label: 'Memory' },
      { id: 'history', label: 'History' },
    ],
  },
  {
    id: 'trading',
    label: 'Trading',
    eyebrow: 'TRADING',
    href: 'trading.html',
    accent: 'gold',
    tabs: [
      { id: 'top10', label: 'Top 10' },
      { id: 'breakouts', label: 'Breakouts' },
      { id: 'fullscan', label: 'Full Scan' },
    ],
  },
];

// Sub-tab position is remembered PER AREA, so switching Personal OS →
// Trading → Personal OS returns to the sub-tab you left rather than resetting
// to the first one. sessionStorage rather than localStorage: within a visit
// this is useful continuity, but a tab you opened last week shouldn't decide
// where tomorrow morning starts.
const SHELL_TAB_KEY = 'jarvis:shell:tab';

function shellArea(areaId) {
  return SHELL_AREAS.find(a => a.id === areaId);
}

function shellGetTab(areaId) {
  const area = shellArea(areaId);
  if (!area) return null;
  let stored = null;
  try {
    stored = sessionStorage.getItem(`${SHELL_TAB_KEY}:${areaId}`);
  } catch (e) { /* private mode — fall through to the default */ }
  // A hash wins over the remembered tab: a link into a specific sub-tab
  // (History's "edit this day", a deep link) must land where it points.
  const hash = (window.location.hash || '').replace('#', '');
  if (area.tabs.some(t => t.id === hash)) return hash;
  if (stored && area.tabs.some(t => t.id === stored)) return stored;
  return area.tabs[0].id;
}

function shellSetTab(areaId, tabId) {
  try {
    sessionStorage.setItem(`${SHELL_TAB_KEY}:${areaId}`, tabId);
  } catch (e) { /* non-fatal */ }
}

// --- icons ----------------------------------------------------------------
// Inline so the nav paints with the first frame rather than after an icon
// font or sprite request.

const SHELL_ICONS = {
  personOs: (size = 22) => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/>
      <circle cx="12" cy="9.5" r="2.8" stroke="currentColor" stroke-width="1.6"/>
      <path d="M6.8 19.2a5.6 5.6 0 0 1 10.4 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`,
  trading: (size = 22) => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <polyline points="3,16 9,10 13,13 21,5" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="15,5 21,5 21,11" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  logo: (size = 18) => `
    <svg width="${size}" height="${size}" viewBox="0 0 18 18" aria-hidden="true">
      ${[3, 9, 15].map(y => [3, 9, 15].map(x =>
        `<circle cx="${x}" cy="${y}" r="1.6" fill="currentColor"/>`).join('')).join('')}
    </svg>`,
  today: () => shellNavIcon('<rect x="3" y="4" width="10" height="9" rx="1.6"/><path d="M3 7h10M6 2.5v2M10 2.5v2"/>'),
  training: () => shellNavIcon('<path d="M3.5 6v4M12.5 6v4M2 8h12M5.5 5v6M10.5 5v6"/>'),
  insights: () => shellNavIcon('<path d="M3 12V7M8 12V4M13 12V9"/>'),
  memory: () => shellNavIcon('<path d="M4 3h8a1 1 0 0 1 1 1v9l-5-2.5L3 13V4a1 1 0 0 1 1-1z"/>'),
  history: () => shellNavIcon('<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2.2 1.3"/>'),
  top10: () => shellNavIcon('<path d="M3 12.5h10M4.5 12.5V8M8 12.5V4M11.5 12.5V6.5"/>'),
  breakouts: () => shellNavIcon('<path d="M2 11l4-4 3 3 5-6"/><path d="M10.5 4H14v3.5"/>'),
  fullscan: () => shellNavIcon('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>'),
  settings: (size = 15) => `
    <svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.4"/>
      <path d="M8 1.6v1.6M8 12.8v1.6M14.4 8h-1.6M3.2 8H1.6M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1M12.5 12.5l-1.1-1.1M4.6 4.6L3.5 3.5"
            stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </svg>`,
};

function shellNavIcon(inner) {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

// --- mobile bottom bar ----------------------------------------------------

function renderShellTabBar(activeAreaId) {
  const existing = document.querySelector('.shell-tabbar');
  if (existing) existing.remove();

  const bar = document.createElement('nav');
  bar.className = 'shell-tabbar';
  bar.setAttribute('aria-label', 'Primary');
  bar.innerHTML = SHELL_AREAS.map(area => {
    const active = area.id === activeAreaId;
    const icon = area.id === 'os' ? SHELL_ICONS.personOs() : SHELL_ICONS.trading();
    // Each area link carries the remembered sub-tab as a hash, so crossing
    // between areas returns you to where you were rather than to tab one.
    const href = active ? area.href : `${area.href}#${shellGetTab(area.id)}`;
    return `
      <a class="shell-tabbar-item accent-${area.accent} ${active ? 'is-active' : ''}"
         href="${href}" ${active ? 'aria-current="page"' : ''}>
        ${icon}
        <span>${area.label}</span>
      </a>`;
  }).join('');
  document.body.appendChild(bar);
}

// --- desktop sidebar ------------------------------------------------------

function renderShellSidebar(activeAreaId, activeTabId, onTabChange) {
  let sidebar = document.getElementById('shell-sidebar');
  if (!sidebar) {
    sidebar = document.createElement('aside');
    sidebar.id = 'shell-sidebar';
    sidebar.className = 'shell-sidebar';
    document.body.insertBefore(sidebar, document.body.firstChild);
  }

  sidebar.innerHTML = `
    <div class="shell-logo">
      <span class="shell-logo-mark">${SHELL_ICONS.logo()}</span>
      <span class="shell-logo-text">JARVIS</span>
    </div>
    ${SHELL_AREAS.map(area => `
      <div class="shell-side-section">
        <div class="shell-eyebrow accent-${area.accent}">${area.label.toUpperCase()}</div>
        ${area.tabs.map(tab => {
          const isHere = area.id === activeAreaId;
          const active = isHere && tab.id === activeTabId;
          const href = isHere ? `#${tab.id}` : `${area.href}#${tab.id}`;
          return `
            <a class="shell-side-link accent-${area.accent} ${active ? 'is-active' : ''}"
               href="${href}" ${isHere ? `data-shell-tab="${tab.id}"` : ''}
               ${active ? 'aria-current="page"' : ''}>
              ${(SHELL_ICONS[tab.id] || shellNavIcon(''))()}
              <span>${tab.label}</span>
            </a>`;
        }).join('')}
      </div>`).join('')}
    <div class="shell-side-foot">
      <span class="shell-avatar" aria-hidden="true">R</span>
      <span class="shell-side-name">Roee</span>
      <span class="shell-side-settings" aria-hidden="true">${SHELL_ICONS.settings()}</span>
    </div>`;

  sidebar.querySelectorAll('[data-shell-tab]').forEach(link => {
    link.addEventListener('click', ev => {
      ev.preventDefault();
      onTabChange(link.dataset.shellTab);
    });
  });
}

// --- sub-tab strip --------------------------------------------------------

function renderShellSubTabs(mount, area, activeTabId, onTabChange) {
  if (!mount) return;
  mount.className = 'shell-subtabs';
  mount.setAttribute('role', 'tablist');
  mount.innerHTML = area.tabs.map(tab => `
    <button type="button" role="tab"
            class="shell-subtab accent-${area.accent} ${tab.id === activeTabId ? 'is-active' : ''}"
            data-shell-subtab="${tab.id}"
            aria-selected="${tab.id === activeTabId ? 'true' : 'false'}">${tab.label}</button>`).join('');

  mount.querySelectorAll('[data-shell-subtab]').forEach(btn => {
    btn.addEventListener('click', () => onTabChange(btn.dataset.shellSubtab));
  });

  // Keep the active tab in view when the strip scrolls horizontally, so a
  // tab at the far end is never hidden off-screen on a phone.
  const active = mount.querySelector('.shell-subtab.is-active');
  if (active && active.scrollIntoView) {
    active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

// --- the shell ------------------------------------------------------------

// Mounts the chrome for one area and hands back a controller. The page
// supplies a `render(tabId)` that draws the active panel; the shell owns
// everything around it (nav, eyebrow, sub-tabs, persistence, hash sync).
function mountShell({ areaId, titleFor, render }) {
  const area = shellArea(areaId);
  if (!area) return null;

  let activeTab = shellGetTab(areaId);

  const header = document.getElementById('shell-header');
  const subtabMount = document.getElementById('shell-subtabs');
  const titleMount = document.getElementById('shell-title');

  function paint() {
    if (header) header.classList.add('shell-header', `accent-${area.accent}`);
    const eyebrow = document.getElementById('shell-eyebrow');
    if (eyebrow) {
      eyebrow.className = `shell-eyebrow accent-${area.accent}`;
      eyebrow.textContent = area.eyebrow;
    }
    renderShellSubTabs(subtabMount, area, activeTab, setTab);
    if (titleMount && typeof titleFor === 'function') {
      const title = titleFor(activeTab);
      titleMount.innerHTML = title || '';
      titleMount.hidden = !title;
    }
    renderShellTabBar(areaId);
    renderShellSidebar(areaId, activeTab, setTab);
    document.querySelectorAll('[data-shell-panel]').forEach(panel => {
      panel.hidden = panel.dataset.shellPanel !== activeTab;
    });
    render(activeTab);
  }

  function setTab(tabId) {
    if (!area.tabs.some(t => t.id === tabId) || tabId === activeTab) return;
    activeTab = tabId;
    shellSetTab(areaId, tabId);
    // replaceState, not a hash assignment: this should not stack a history
    // entry per sub-tab, or Back would walk the tab strip instead of leaving.
    try {
      history.replaceState(null, '', `#${tabId}`);
    } catch (e) { /* non-fatal */ }
    paint();
  }

  // A hash arriving from outside (a link, Back, or the address bar) selects
  // that tab; the shell's own replaceState above never fires this.
  window.addEventListener('hashchange', () => {
    const hash = (window.location.hash || '').replace('#', '');
    if (hash && hash !== activeTab && area.tabs.some(t => t.id === hash)) setTab(hash);
  });

  shellSetTab(areaId, activeTab);
  paint();

  return { get tab() { return activeTab; }, setTab, repaint: paint };
}
