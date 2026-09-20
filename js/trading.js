// Trading — Top 10, Breakouts and Full Scan.
//
// The market status bar and the ticker/sector search moved here from Today
// during the restructure. They are trading instruments: sitting above a
// morning routine they made one screen ask two unrelated questions, and here
// they apply to all three sub-tabs at once.
//
// Reads the same published feeds as before (scan.json, breakout_alerts.json)
// through DASHBOARD, and reuses splitBreakoutAlerts from data.js so the 48h
// window is computed in exactly one place. No feed, field or backend changed.

const TRADING_BADGES = {
  'Zone Reclaim':   { label: 'RECLAIM',  cls: 'is-reclaim' },
  'Fresh Breakout': { label: 'BREAKOUT', cls: 'is-breakout' },
};

function tradingBadge(setupTag) {
  return TRADING_BADGES[setupTag] || { label: 'SIGNAL', cls: 'is-signal' };
}

// 90+ green, 80-89 gold, below that muted — a ranked list is only useful if
// the top of it is visually separable from the middle.
function tradingScoreClass(score) {
  if (score >= 90) return 'is-high';
  if (score >= 80) return 'is-mid';
  return 'is-low';
}

const tradingState = {
  scan: null,
  breakouts: null,
  search: '',
  breakoutFilter: 'all',
  sortKey: 'score',
  sortDir: 'desc',
};

function tradingMatchesSearch(r, term) {
  if (!term) return true;
  const t = term.toLowerCase();
  return (r.ticker || '').toLowerCase().includes(t)
    || (r.sector_etf || '').toLowerCase().includes(t);
}

// --- market status bar ----------------------------------------------------

function renderMarketBar(activeTab) {
  const mount = document.getElementById('market-bar');
  if (!mount) return;
  const scan = tradingState.scan;
  if (!scan) { mount.innerHTML = ''; return; }

  const regime = (scan.market && scan.market.regime) || 'NEUTRAL';
  const riskOn = regime === 'RISK-ON';
  const active = tradingState.breakouts
    ? splitBreakoutAlerts(tradingState.breakouts).active.length : null;

  // Each sub-tab gets the counts that matter to it rather than one generic
  // strip: on Breakouts, "scanned 562/576" is noise.
  let stats;
  if (activeTab === 'breakouts' && tradingState.breakouts) {
    const split = splitBreakoutAlerts(tradingState.breakouts);
    const expiring = split.active.filter(a => a.expiresAt - Date.now() < 12 * 3600 * 1000).length;
    stats = [
      ['Active', split.active.length],
      ['Total 48h', split.active.length + split.archived.length],
      ['Expiring', expiring],
    ];
  } else {
    stats = [
      ['Scanned', `${scan.scanned_count ?? '—'}/${scan.total_tickers ?? '—'}`],
      ['Signals', scan.signal_count ?? '—'],
      ['Breakouts', active === null ? '—' : active],
    ];
  }

  mount.className = 'market-bar';
  mount.innerHTML = `
    <span class="regime ${riskOn ? 'is-on' : 'is-off'}">${escapeHtml(regime)}</span>
    <div class="market-stats">
      ${stats.map(([label, value]) => `
        <span class="market-stat">
          <span class="market-stat-label">${escapeHtml(label)}</span>
          <span class="market-stat-value mono">${escapeHtml(String(value))}</span>
        </span>`).join('')}
    </div>`;
}

function renderTradingSearch() {
  const mount = document.getElementById('trading-search');
  if (!mount) return;
  if (mount.dataset.ready === '1') return;   // keep the node so typing isn't interrupted
  mount.dataset.ready = '1';
  mount.className = 'trading-search';
  mount.innerHTML = `
    ${ICONS.search()}
    <input type="text" id="trading-search-input" placeholder="Search ticker or sector…"
           aria-label="Search ticker or sector" value="${escapeHtml(tradingState.search)}">
    <button type="button" class="trading-search-clear" id="trading-search-clear"
            aria-label="Clear search" ${tradingState.search ? '' : 'hidden'}>&times;</button>`;

  const input = document.getElementById('trading-search-input');
  const clear = document.getElementById('trading-search-clear');
  const commit = value => {
    tradingState.search = value;
    clear.hidden = !value;
    if (tradingShell) tradingShell.repaint();
  };
  input.addEventListener('input', e => commit(e.target.value));
  clear.addEventListener('click', () => { input.value = ''; commit(''); input.focus(); });
}

// --- Top 10 ---------------------------------------------------------------

function renderTradingTop10() {
  const mount = document.getElementById('panel-top10');
  if (!mount) return;
  const scan = tradingState.scan;

  if (!scan || !scan.stocks || !scan.stocks.length) {
    mount.innerHTML = `<div class="empty-state">No scan data yet. The nightly scan fills this in.</div>`;
    return;
  }

  const byTicker = Object.fromEntries(scan.stocks.map(s => [s.ticker, s]));
  // Prefer the server's ranking (it puts zone reclaims first); fall back to
  // score order only for an older scan.json with no top10 key.
  const ordered = (scan.top10 && scan.top10.length)
    ? scan.top10.map(t => byTicker[t]).filter(Boolean)
    : [...scan.stocks].sort((a, b) => b.score - a.score).slice(0, 10);

  const shown = ordered.filter(r => tradingMatchesSearch(r, tradingState.search));

  mount.innerHTML = `
    <div class="sec-label-row">
      <h2 class="sec-label sec-label-gold">Today's ranked setups</h2>
      <span class="sec-note">as of open</span>
    </div>
    ${shown.length ? `<div class="setup-list">${shown.map(r => {
      const rank = ordered.indexOf(r) + 1;
      const badge = tradingBadge(r.setup_tag);
      const change = r.change_pct;
      // Ranks 7-10 fade progressively: the list stays complete but its head
      // is unmistakable, which is the point of a ranked list.
      const fade = rank >= 7 ? ` style="opacity:${[0.5, 0.35, 0.2, 0.1][rank - 7]}"` : '';
      return `
        <article class="setup-card"${fade}>
          <span class="setup-rank mono">${rank}</span>
          <div class="setup-main">
            <div class="setup-row">
              <span class="setup-ticker mono">${escapeHtml(r.ticker)}</span>
              <span class="setup-badge ${badge.cls}">${badge.label}</span>
            </div>
            <div class="setup-row setup-meta">
              <span class="mono setup-price">${fmtPrice(r.price)}</span>
              <span class="mono setup-change ${change >= 0 ? 'is-up' : 'is-down'}">${fmtChange(change)}</span>
              <span class="setup-vol">Vol ${fmtCompactNumber(r.today_volume)}</span>
            </div>
          </div>
          <span class="setup-score mono ${tradingScoreClass(r.score)}">${Math.round(r.score)}</span>
        </article>`;
    }).join('')}</div>`
    : `<div class="empty-state">No ranked setups match "${escapeHtml(tradingState.search)}".</div>`}`;
}

// --- Breakouts ------------------------------------------------------------

const TRADING_BREAKOUT_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This Week' },
  { id: 'archive', label: 'Archive' },
];

function renderTradingBreakouts() {
  const mount = document.getElementById('panel-breakouts');
  if (!mount) return;
  const payload = tradingState.breakouts;

  if (!payload) {
    mount.innerHTML = `<div class="empty-state">No breakout data published yet.</div>`;
    return;
  }

  const split = splitBreakoutAlerts(payload);
  const windowMs = ((payload.window_hours) || 48) * 3600 * 1000;
  const now = Date.now();

  let rows = tradingState.breakoutFilter === 'archive' ? split.archived : split.active;
  if (tradingState.breakoutFilter === 'today') {
    rows = rows.filter(r => now - new Date(r.last_touch_at).getTime() < 24 * 3600 * 1000);
  } else if (tradingState.breakoutFilter === 'week') {
    rows = rows.filter(r => now - new Date(r.last_touch_at).getTime() < 7 * 24 * 3600 * 1000);
  }
  rows = rows.filter(r => tradingMatchesSearch(r, tradingState.search));

  mount.innerHTML = `
    <div class="pill-row">
      ${TRADING_BREAKOUT_FILTERS.map(f => `
        <button type="button" class="pill ${f.id === tradingState.breakoutFilter ? 'is-active' : ''}"
                data-breakout-filter="${f.id}">${f.label}</button>`).join('')}
    </div>
    ${rows.length ? `<div class="setup-list">${rows.map(r => {
      const remaining = r.expiresAt - now;
      // The bar shows time LEFT in the rolling window. A fresh touch resets
      // it to full, which is the behaviour that matters: re-touching restarts
      // the 48h rather than continuing the old clock.
      const pct = Math.max(0, Math.min(100, (remaining / windowMs) * 100));
      const expired = remaining <= 0;
      const hours = Math.floor(Math.abs(remaining) / 3600000);
      const mins = Math.floor((Math.abs(remaining) % 3600000) / 60000);
      return `
        <article class="setup-card">
          <div class="setup-main">
            <div class="setup-row">
              <span class="setup-ticker mono">${escapeHtml(r.ticker)}</span>
              <span class="setup-badge is-breakout">SMA150</span>
              ${r.touch_count > 1 ? `<span class="setup-touches mono">${r.touch_count}× touch</span>` : ''}
            </div>
            <div class="setup-row setup-meta">
              <span class="mono setup-price">${fmtPrice(r.price)}</span>
              <span class="mono setup-change ${r.change_pct >= 0 ? 'is-up' : 'is-down'}">${fmtChange(r.change_pct)}</span>
              <span class="setup-vol">Vol ${fmtCompactNumber(r.today_volume)}</span>
            </div>
            <div class="timer-track" role="img"
                 aria-label="${expired ? 'Window expired' : `${hours}h ${mins}m remaining`}">
              <span class="timer-fill ${expired ? 'is-expired' : ''}" style="width:${pct}%"></span>
            </div>
            <div class="timer-label mono">
              ${expired ? `expired ${hours}h ago` : `${hours}h ${String(mins).padStart(2, '0')}m left`}
              · touched ${escapeHtml(fmtRelative(r.last_touch_at))}
            </div>
          </div>
        </article>`;
    }).join('')}</div>`
    : `<div class="empty-state">${tradingState.breakoutFilter === 'archive'
        ? 'Nothing in the archive yet.'
        : 'No SMA150 touches in this window.'}</div>`}`;

  mount.querySelectorAll('[data-breakout-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      tradingState.breakoutFilter = btn.dataset.breakoutFilter;
      renderTradingBreakouts();
    });
  });
}

// --- Full Scan ------------------------------------------------------------

const TRADING_COLUMNS = [
  { key: 'ticker', label: 'Ticker', cls: 'col-ticker' },
  { key: 'setup_tag', label: 'Setup', cls: 'col-setup' },
  { key: 'price', label: 'Price', cls: 'col-num' },
  { key: 'change_pct', label: 'Chg', cls: 'col-num' },
  { key: 'today_volume', label: 'Vol', cls: 'col-num col-vol' },
  { key: 'score', label: 'Score', cls: 'col-num col-score' },
];

function renderTradingFullScan() {
  const mount = document.getElementById('panel-fullscan');
  if (!mount) return;
  const scan = tradingState.scan;

  if (!scan || !scan.stocks || !scan.stocks.length) {
    mount.innerHTML = `<div class="empty-state">No scan data yet.</div>`;
    return;
  }

  const rows = scan.stocks
    .filter(r => tradingMatchesSearch(r, tradingState.search))
    .sort((a, b) => {
      const { sortKey, sortDir } = tradingState;
      const av = a[sortKey];
      const bv = b[sortKey];
      // Missing values sort last in both directions rather than pretending
      // to be zero, which would put them among the real low values.
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return sortDir === 'asc' ? cmp : -cmp;
    });

  mount.innerHTML = `
    <div class="sec-label-row">
      <h2 class="sec-label sec-label-gold">All scanned</h2>
      <span class="sec-note mono">${rows.length} of ${scan.stocks.length}</span>
    </div>
    <div class="scan-wrap">
      <table class="scan-grid">
        <thead>
          <tr>
            ${TRADING_COLUMNS.map(c => `
              <th class="${c.cls} ${tradingState.sortKey === c.key ? 'is-sorted' : ''}"
                  data-sort="${c.key}" scope="col">
                ${c.label}${tradingState.sortKey === c.key
                  ? `<span class="sort-arrow">${tradingState.sortDir === 'asc' ? '▲' : '▼'}</span>` : ''}
              </th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const badge = tradingBadge(r.setup_tag);
            return `
              <tr>
                <td class="col-ticker mono">${escapeHtml(r.ticker)}</td>
                <td class="col-setup"><span class="setup-badge is-tiny ${badge.cls}">${badge.label}</span></td>
                <td class="col-num mono">${fmtPrice(r.price)}</td>
                <td class="col-num mono ${r.change_pct >= 0 ? 'is-up' : 'is-down'}">${fmtChange(r.change_pct)}</td>
                <td class="col-num col-vol mono">${fmtCompactNumber(r.today_volume)}</td>
                <td class="col-num col-score mono ${tradingScoreClass(r.score)}">${Math.round(r.score)}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  mount.querySelectorAll('[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (tradingState.sortKey === key) {
        tradingState.sortDir = tradingState.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        tradingState.sortKey = key;
        // Text reads naturally A-Z; numbers are most useful strongest-first.
        tradingState.sortDir = (key === 'ticker' || key === 'setup_tag') ? 'asc' : 'desc';
      }
      renderTradingFullScan();
    });
  });
}

// --- page -----------------------------------------------------------------

const TRADING_TITLES = { breakouts: 'Breakouts', fullscan: 'Full Scan' };

const tradingShell = mountShell({
  areaId: 'trading',
  titleFor: tab => (TRADING_TITLES[tab] ? `<h1 class="shell-title">${TRADING_TITLES[tab]}</h1>` : ''),
  render(tab) {
    renderMarketBar(tab);
    renderTradingSearch();
    if (tab === 'top10') renderTradingTop10();
    else if (tab === 'breakouts') renderTradingBreakouts();
    else renderTradingFullScan();
  },
});

async function tradingLoad() {
  const [scan, breakouts] = await Promise.all([
    DASHBOARD.fetchOne('scan'),
    DASHBOARD.fetchOne('breakoutAlerts'),
  ]);
  tradingState.scan = scan;
  tradingState.breakouts = breakouts;
  if (tradingShell) tradingShell.repaint();
}

tradingLoad();
