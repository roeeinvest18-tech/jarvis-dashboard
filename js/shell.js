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

// Labels come from strings.js. The eyebrow used to carry its own ALL-CAPS
// copy ('PERSONAL OS') on top of the .shell-eyebrow rule that already
// uppercases it, so the same label existed twice in two cases; a screen
// reader read the shouted one. One label now, uppercased by CSS.
const SHELL_TABS = STRINGS.shell.tabs;

const SHELL_AREAS = [
  {
    id: 'os',
    label: STRINGS.shell.areas.os,
    href: 'index.html',
    accent: 'purple',
    tabs: [
      { id: 'today', label: SHELL_TABS.today },
      { id: 'training', label: SHELL_TABS.training },
      { id: 'insights', label: SHELL_TABS.insights },
      { id: 'memory', label: SHELL_TABS.memory, parentId: 'insights' },
      { id: 'history', label: SHELL_TABS.history, parentId: 'insights' },
      { id: 'painpoints', label: SHELL_TABS.painpoints },
      { id: 'jobs', label: SHELL_TABS.jobs },
      { id: 'content', label: SHELL_TABS.content },
    ],
  },
  {
    id: 'trading',
    label: STRINGS.shell.areas.trading,
    href: 'trading.html',
    accent: 'gold',
    tabs: [
      { id: 'top10', label: SHELL_TABS.top10 },
      { id: 'breakouts', label: SHELL_TABS.breakouts },
      { id: 'fullscan', label: SHELL_TABS.fullscan },
      { id: 'scorecard', label: SHELL_TABS.scorecard, parentId: 'tools' },
      { id: 'tools', label: SHELL_TABS.tools },
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
  painpoints: () => shellNavIcon('<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.2"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2"/>'),
  jobs: () => shellNavIcon('<rect x="2.5" y="4.5" width="11" height="8.5" rx="1.5"/><path d="M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M2.5 8h11"/>'),
  top10: () => shellNavIcon('<path d="M3 12.5h10M4.5 12.5V8M8 12.5V4M11.5 12.5V6.5"/>'),
  breakouts: () => shellNavIcon('<path d="M2 11l4-4 3 3 5-6"/><path d="M10.5 4H14v3.5"/>'),
  fullscan: () => shellNavIcon('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>'),
  scorecard: () => shellNavIcon('<path d="M3 3.5h10M3 8h10M3 12.5h10"/><path d="M6 3.5v9"/>'),
  tools: () => shellNavIcon('<path d="M9.5 3a3 3 0 0 0-3.6 3.9L2.5 10.3a1.2 1.2 0 0 0 1.7 1.7l3.4-3.4A3 3 0 0 0 11.5 5L9.8 6.7 8.5 5.4z"/>'),
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
      <span class="shell-logo-text">${STRINGS.common.brand}</span>
    </div>
    ${SHELL_AREAS.map(area => `
      <div class="shell-side-section">
        <div class="shell-eyebrow accent-${area.accent}">${area.label}</div>
        ${area.tabs.filter(tab => !tab.parentId).map(tab => {
          const isHere = area.id === activeAreaId;
          const activeTabObj = area.tabs.find(t => t.id === activeTabId);
          const effectiveId = (activeTabObj && activeTabObj.parentId) ? activeTabObj.parentId : activeTabId;
          const active = isHere && tab.id === effectiveId;
          const href = isHere ? `#${tab.id}` : `${area.href}#${tab.id}`;
          return `
            <a class="shell-side-link accent-${area.accent} ${active ? 'is-active' : ''}"
               href="${href}" ${isHere ? `data-shell-tab="${tab.id}"` : ''}
               ${active ? 'aria-current="page"' : ''}>
              ${(SHELL_ICONS[tab.id] || (() => shellNavIcon('')))()}
              <span>${tab.label}</span>
            </a>`;
        }).join('')}
      </div>`).join('')}
    <div class="shell-side-foot">
      <span class="shell-avatar" aria-hidden="true">${STRINGS.shell.ownerInitial}</span>
      <span class="shell-side-name">${STRINGS.shell.ownerName}</span>
      <span class="shell-side-settings" aria-hidden="true">${SHELL_ICONS.settings()}</span>
    </div>`;

  sidebar.querySelectorAll('[data-shell-tab]').forEach(link => {
    link.addEventListener('click', ev => {
      ev.preventDefault();
      onTabChange(link.dataset.shellTab);
    });
  });
}

// Page title with its one-line subtitle (copy in strings.js).
function shellTitleHtml(title, tabId) {
  const sub = STRINGS.shell.subtitles[tabId];
  return `<h1 class="shell-title">${title}</h1>${sub ? `<p class="shell-sub">${sub}</p>` : ''}`;
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
  if (typeof window !== 'undefined' && areaId === 'os' && (typeof osRenderPainpoints === 'undefined' || typeof osRenderJobs === 'undefined' || typeof NUTRITION === 'undefined')) {
    if (!sessionStorage.getItem('jarvis:cache-healed-v59')) {
      sessionStorage.setItem('jarvis:cache-healed-v59', '1');
      const healAssets = [
        './', 'index.html', 'trading.html', 'css/styles.css', 'js/strings.js',
        'js/icons.js', 'js/data.js', 'js/shell.js', 'js/components.js',
        'js/schedule-config.js', 'js/daily.js', 'js/nutrition.js', 'js/daily-today.js', 'js/os.js',
        'js/personal-os.js', 'js/training-hints.js', 'js/training.js',
        'js/program.js', 'js/workout.js', 'js/workout-ui.js', 'js/market-calendar.js',
        'js/health.js', 'js/trading-logic.js', 'js/account.js', 'js/trading.js',
        'js/push.js', 'js/app.js', 'sw.js',
      ];
      Promise.all([
        typeof caches !== 'undefined' ? caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))) : Promise.resolve(),
        navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))) : Promise.resolve(),
        ...healAssets.map(u => fetch(u, { cache: 'reload' }).catch(() => null)),
      ]).finally(() => window.location.reload());
    }
  }
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
      eyebrow.textContent = area.label;
    }
    renderShellSubTabs(subtabMount, area, activeTab, setTab);
    if (titleMount && typeof titleFor === 'function') {
      const title = titleFor(activeTab);
      titleMount.innerHTML = title || '';
      titleMount.hidden = !title;
      const activeObj = area.tabs.find(t => t.id === activeTab);
      const groupRootId = (activeObj && activeObj.parentId) ? activeObj.parentId : activeTab;
      const children = area.tabs.filter(t => t.id === groupRootId || t.parentId === groupRootId);
      if (children.length > 1) {
        titleMount.innerHTML += `<div class="wk-tabs" style="margin-bottom: var(--sp-5);">${children.map(ct =>
          `<button type="button" class="wk-tab ${ct.id === activeTab ? 'is-active' : ''}" data-shell-group-tab="${ct.id}">${ct.label}</button>`
        ).join('')}</div>`;
        titleMount.hidden = false;
        titleMount.querySelectorAll('[data-shell-group-tab]').forEach(btn => {
          btn.addEventListener('click', () => setTab(btn.dataset.shellGroupTab));
        });
      }
    }
    renderShellTabBar(areaId);
    renderShellSidebar(areaId, activeTab, setTab);
    if (areaId === 'os') {
      if (typeof osEnsurePainpointsMount === 'function') osEnsurePainpointsMount();
      if (typeof osEnsureJobsMount === 'function') osEnsureJobsMount();
    }
    document.querySelectorAll('[data-shell-panel]').forEach(panel => {
      panel.hidden = panel.dataset.shellPanel !== activeTab;
    });
    if (areaId === 'os' && activeTab === 'training' && typeof renderWorkoutZone === 'function') {
      if (titleMount) {
        titleMount.innerHTML = shellTitleHtml(STRINGS.shell.tabs.training, 'training');
        titleMount.hidden = false;
      }
      if (typeof workoutMigrateOnce === 'function') workoutMigrateOnce(null);
      renderWorkoutZone();
      if (typeof osRunPendingAction === 'function') osRunPendingAction(activeTab);
      return;
    }
    if (areaId === 'os' && activeTab === 'painpoints') {
      if (titleMount) {
        titleMount.innerHTML = shellTitleHtml(STRINGS.shell.tabs.painpoints, 'painpoints');
        titleMount.hidden = false;
      }
      if (typeof osRenderPainpoints === 'function') osRenderPainpoints();
      return;
    }
    if (areaId === 'os' && activeTab === 'jobs') {
      if (titleMount) {
        titleMount.innerHTML = shellTitleHtml(STRINGS.shell.tabs.jobs, 'jobs');
        titleMount.hidden = false;
      }
      if (typeof osRenderJobs === 'function') osRenderJobs();
      return;
    }
    render(activeTab);
    if (areaId === 'os' && activeTab === 'training' && typeof renderWorkoutZone === 'function') {
      renderWorkoutZone();
    }
    if (areaId === 'os' && activeTab === 'painpoints' && typeof osRenderPainpoints === 'function') {
      osRenderPainpoints();
    }
    if (areaId === 'os' && activeTab === 'jobs' && typeof osRenderJobs === 'function') {
      osRenderJobs();
    }
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

  if (typeof document !== 'undefined' && !window.__jarvis_sync_listeners_installed) {
    window.__jarvis_sync_listeners_installed = true;
    const triggerAutoSync = () => {
      try {
        if (typeof dailyTriggerSync === 'function') dailyTriggerSync();
        if (typeof WORKOUT !== 'undefined' && typeof WORKOUT.syncWithServer === 'function') WORKOUT.syncWithServer();
      } catch (e) {}
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') triggerAutoSync();
    });
    window.addEventListener('focus', triggerAutoSync);
  }

  return { get tab() { return activeTab; }, setTab, repaint: paint };
}


var shellPainpointsPayload = null;
var shellPainpointsFetched = false;
var shellPainpointsLang = 'he';

function osEnsurePainpointsMount() {
  let mount = document.getElementById('panel-painpoints');
  if (!mount && typeof document !== 'undefined') {
    const body = document.querySelector('.shell-body');
    if (body) {
      mount = document.createElement('section');
      mount.setAttribute('data-shell-panel', 'painpoints');
      mount.id = 'panel-painpoints';
      mount.hidden = true;
      const strip = document.getElementById('health-strip');
      body.insertBefore(mount, strip || null);
    }
  }
  return mount;
}

function osRenderPainpoints() {
  const mount = osEnsurePainpointsMount();
  if (!mount) return;
  mount.hidden = false;
  if (!shellPainpointsFetched) {
    shellPainpointsFetched = true;
    fetch('dashboard_data/painpoints.json?t=' + Date.now(), { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(payload => {
        shellPainpointsPayload = payload;
        osPaintPainpoints(mount, payload);
      });
    osPaintPainpoints(mount, shellPainpointsPayload);
    return;
  }
  osPaintPainpoints(mount, shellPainpointsPayload);
}

function osPaintPainpoints(mount, data) {
  const S = STRINGS.painpoints;
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  if (!data || !Array.isArray(data.clusters) || !data.clusters.length) {
    mount.innerHTML = `
      <div class="ghost-state">
        <p class="ghost-heading">${esc(S.ghostHeading)}</p>
        <p class="ghost-sub">${esc(S.ghostSub)}</p>
      </div>`;
    return;
  }

  const isHe = shellPainpointsLang === 'he';
  const dirAttr = isHe ? 'dir="rtl"' : 'dir="ltr"';
  const stats = data.stats || {};
  const bySource = stats.by_source
    ? Object.entries(stats.by_source).map(([k, v]) => `${esc(k)}: ${esc(String(v))}`).join(' · ')
    : '';
  const summary = isHe ? (data.summary_he || data.summary_en || '') : (data.summary_en || data.summary_he || '');

  mount.innerHTML = `
    <div class="pp-toolbar">
      <div class="sec-label">${esc(S.weekLabel(data.week || '', data.date || ''))}${bySource ? ` · ${bySource}` : ''}</div>
      <div class="pp-lang-switch">
        <button type="button" class="os-btn ${isHe ? 'is-active' : ''}" data-pp-lang="he">${esc(S.langToggleHe)}</button>
        <button type="button" class="os-btn ${!isHe ? 'is-active' : ''}" data-pp-lang="en">${esc(S.langToggleEn)}</button>
      </div>
    </div>

    <div class="pp-stats-grid">
      <div class="pp-stat-box">
        <div class="sec-label">${esc(S.stats.raw)}</div>
        <div class="pp-stat-num">${esc(String(stats.raw ?? 0))}</div>
      </div>
      <div class="pp-stat-box">
        <div class="sec-label">${esc(S.stats.analyzed)}</div>
        <div class="pp-stat-num">${esc(String(stats.analyzed ?? 0))}</div>
      </div>
      <div class="pp-stat-box">
        <div class="sec-label">${esc(S.stats.pains)}</div>
        <div class="pp-stat-num is-accent">${esc(String(stats.pains ?? 0))}</div>
      </div>
      <div class="pp-stat-box">
        <div class="sec-label">${esc(S.stats.sources)}</div>
        <div class="pp-stat-num is-up">${esc(String(stats.sources ?? 0))}</div>
      </div>
    </div>

    ${summary ? `<p class="pp-summary" ${dirAttr}>${esc(summary)}</p>` : ''}

    <div class="pp-cluster-list">
      ${data.clusters.map(c => {
        const title = isHe ? (c.title_he || c.title_en) : (c.title_en || c.title_he);
        const who = isHe ? (c.who_he || c.who_en) : (c.who_en || c.who_he);
        const quote = isHe ? (c.quote_he || c.quote_en) : (c.quote_en || c.quote_he);
        const solution = isHe ? (c.solution_he || c.solution_en) : (c.solution_en || c.solution_he);
        const mvp = isHe ? (c.mvp_he || c.mvp_en) : (c.mvp_en || c.mvp_he);
        const pricing = isHe ? (c.pricing_he || c.pricing_en) : (c.pricing_en || c.pricing_he);
        const stack = isHe ? (c.tech_stack_he || c.tech_stack_en) : (c.tech_stack_en || c.tech_stack_he);
        const avgScore = Math.round(((c.intensity || 0) + (c.frequency || 0) + (c.ease_of_build || 0) + (c.low_competition || 0)) / 4);
        const sourcesList = Array.isArray(c.sources) ? c.sources.join(' · ') : '';
        const competitors = Array.isArray(c.competitors) ? c.competitors : [];

        return `
          <article class="pp-cluster-card" ${dirAttr}>
            <div class="pp-cluster-head" dir="ltr">
              <span class="pp-badge-cat">${esc(c.category || '')}</span>
              <span class="pp-badge-sources">${esc(sourcesList)} · ${esc(S.metrics.mentions(c.mentions || 0))}</span>
              <span class="pp-badge-score">${esc(String(avgScore))}</span>
            </div>
            <h2 class="pp-cluster-title">${esc(title || '')}</h2>
            ${who ? `<div class="pp-cluster-who"><strong>${esc(S.whoLabel)}:</strong> ${esc(who)}</div>` : ''}
            ${quote ? `<blockquote class="pp-cluster-quote">"${esc(quote)}"${c.quote_url ? ` <a href="${esc(c.quote_url)}" target="_blank" rel="noopener noreferrer" class="pp-quote-link">${esc(S.sourceLinkLabel)} &rarr;</a>` : ''}</blockquote>` : ''}
            <div class="pp-cluster-mvp">
              <div class="pp-mvp-row"><strong>${esc(S.solutionLabel)}:</strong> ${esc(solution || '')}</div>
              <div class="pp-mvp-row"><strong>${esc(S.mvpLabel)}:</strong> ${esc(mvp || '')}</div>
              <div class="pp-mvp-meta">
                ${pricing ? `<span><strong>${esc(S.pricingLabel)}:</strong> ${esc(pricing)}</span>` : ''}
                ${stack ? `<span><strong>${esc(S.stackLabel)}:</strong> ${esc(stack)}</span>` : ''}
              </div>
            </div>
            ${competitors.length ? `
              <div class="pp-competitors">
                <div class="sec-label">${esc(S.competitorsLabel)}</div>
                <div class="pp-comp-list">
                  ${competitors.map(comp => `
                    <div class="pp-comp-item">
                      <strong>${esc(comp.name || '')}:</strong> ${esc(isHe ? (comp.gap_he || comp.gap_en || '') : (comp.gap_en || comp.gap_he || ''))}
                    </div>`).join('')}
                </div>
              </div>` : ''}
            <div class="pp-metrics-bar" dir="ltr">
              <div class="pp-metric-cell"><span class="pp-m-num">${esc(String(c.intensity ?? 0))}</span><span class="pp-m-lbl">${esc(S.metrics.intensity)}</span></div>
              <div class="pp-metric-cell"><span class="pp-m-num">${esc(String(c.frequency ?? 0))}</span><span class="pp-m-lbl">${esc(S.metrics.frequency)}</span></div>
              <div class="pp-metric-cell"><span class="pp-m-num">${esc(String(c.ease_of_build ?? 0))}</span><span class="pp-m-lbl">${esc(S.metrics.ease)}</span></div>
              <div class="pp-metric-cell"><span class="pp-m-num">${esc(String(c.low_competition ?? 0))}</span><span class="pp-m-lbl">${esc(S.metrics.competition)}</span></div>
            </div>
          </article>`;
      }).join('')}
    </div>`;

  mount.querySelectorAll('[data-pp-lang]').forEach(btn => {
    btn.addEventListener('click', () => {
      shellPainpointsLang = btn.dataset.ppLang;
      osPaintPainpoints(mount, data);
    });
  });
}
