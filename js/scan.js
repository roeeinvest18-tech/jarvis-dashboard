// Page 2 — Full Scan Results: sortable/filterable table of every scanned
// ticker, plus a separate Breakout Alerts tab. Trading-only page.

renderNav('scan');
renderTopbar('app-header', 'Full Scan Results');

const state = {
  scan: null,
  breakoutAlerts: null,
  activeTab: 'scan',
  search: getGlobalSearch(),
  minScore: 0,
  sector: '',
  confluenceOnly: false,
  smaFilter: 'any', // any | above | below
  earningsOnly: false,
  sortKey: 'score',
  sortDir: 'desc',
  // No sort applied until the user clicks a Breakout Alerts header -- the
  // table keeps its natural soonest-to-expire order (see splitBreakoutAlerts)
  // until then.
  breakoutSortKey: null,
  breakoutSortDir: null,
};

// First-click sort direction per Breakout Alerts column (per spec: dates
// oldest-first, text A-Z, price low-to-high, everything else "strongest"
// value first). Earnings isn't covered by an explicit rule in the spec --
// treated like the existing Full Scan earnings badge (soonest/most urgent
// first) rather than as a generic "numeric strength" column, since a large
// days-to-earnings number isn't a "stronger" signal.
const BREAKOUT_SORT_DEFAULTS = {
  touched: 'asc',
  ticker: 'asc',
  price: 'asc',
  dist_sma150: 'desc',
  sector: 'asc',
  earnings: 'asc',
  cci: 'desc',
  volume: 'desc',
};

const COLUMNS = [
  { key: 'score', label: 'Score' },
  { key: 'ticker', label: 'Ticker' },
  { key: 'price', label: 'Price' },
  { key: 'change_pct', label: 'Change' },
  { key: 'cci', label: 'CCI' },
  { key: 'volume_ratio', label: 'Vol' },
  { key: 'pct_SMA150', label: 'SMA150' },
  { key: 'sector_etf', label: 'Sector' },
  { key: null, label: 'Signals' },
];

function populateSectorOptions(stocks) {
  const select = document.getElementById('sector-filter');
  const sectors = [...new Set(stocks.map(r => r.sector_etf).filter(Boolean))].sort();
  select.innerHTML = `<option value="">All sectors</option>` + sectors.map(s => `<option value="${s}">${s}</option>`).join('');
}

function applyFilters(stocks) {
  return stocks.filter(r => {
    if (state.search) {
      const term = state.search.toLowerCase();
      const tickerMatch = r.ticker.toLowerCase().includes(term);
      const sectorMatch = (r.sector_etf || '').toLowerCase().includes(term);
      if (!tickerMatch && !sectorMatch) return false;
    }
    if (r.score < state.minScore) return false;
    if (state.sector && r.sector_etf !== state.sector) return false;
    if (state.confluenceOnly && !r.confluence) return false;
    if (state.smaFilter === 'above' && !(r.pct_SMA150 > 0)) return false;
    if (state.smaFilter === 'below' && !(r.pct_SMA150 < 0)) return false;
    if (state.earningsOnly && !(r.earnings_days !== null && r.earnings_days !== undefined && r.earnings_days <= 14)) return false;
    return true;
  });
}

function applySort(stocks) {
  const { sortKey, sortDir } = state;
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...stocks].sort((a, b) => {
    let av = a[sortKey];
    let bv = b[sortKey];
    if (av === null || av === undefined) av = sortDir === 'asc' ? Infinity : -Infinity;
    if (bv === null || bv === undefined) bv = sortDir === 'asc' ? Infinity : -Infinity;
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });
}

function renderScanTable() {
  const mount = document.getElementById('scan-table-body');
  const countEl = document.getElementById('result-count');
  if (!state.scan || !state.scan.stocks) {
    document.getElementById('scan-empty').hidden = false;
    document.getElementById('scan-table-wrap').hidden = true;
    return;
  }
  document.getElementById('scan-empty').hidden = true;
  document.getElementById('scan-table-wrap').hidden = false;

  const recurringSet = new Set(state.scan.recurring_tickers || []);
  const filtered = applySort(applyFilters(state.scan.stocks));
  countEl.textContent = `${filtered.length} of ${state.scan.stocks.length} tickers`;

  if (filtered.length === 0) {
    mount.innerHTML = `<tr><td colspan="9"><div class="empty-state">No tickers match the current filters.</div></td></tr>`;
    return;
  }
  mount.innerHTML = filtered.map((r, i) => renderTableRow(r, recurringSet, i)).join('');
  wireTableExpansion(mount);
}

function wireTableExpansion(mount) {
  mount.querySelectorAll('tr[data-row-index]').forEach(tr => {
    const toggle = () => {
      const idx = tr.dataset.rowIndex;
      const detail = mount.querySelector(`tr[data-detail-index="${idx}"]`);
      detail.hidden = !detail.hidden;
    };
    tr.addEventListener('click', toggle);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
}

// Sector and earnings-days aren't in breakout_alerts.json itself (that file
// only carries what breakout_alert.py computes for the Telegram alert), but
// scan.json's per-ticker rows already carry sector_etf/earnings_days from
// the same nightly fetch_extra_info() call the Full Scan tab uses -- so we
// join against it here instead of adding a second fetch/duplicate lookup to
// the breakout scanner itself.
function buildScanLookup(scan) {
  const map = {};
  for (const r of (scan && scan.stocks) || []) map[r.ticker] = r;
  return map;
}

function computeBreakoutDistSma150(r) {
  return r.sma150 ? ((r.price - r.sma150) / r.sma150) * 100 : null;
}

function getBreakoutEarningsDays(r, scanLookup) {
  const extra = scanLookup[r.ticker];
  return extra && extra.earnings_days !== undefined && extra.earnings_days !== null
    ? extra.earnings_days
    : null;
}

// Raw (unformatted) value for a given column, used for sorting -- kept in
// sync with renderBreakoutAlertRow's display logic via the two helpers above
// rather than duplicating the SMA150/earnings computations.
function getBreakoutSortValue(r, key, scanLookup) {
  const extra = scanLookup[r.ticker];
  switch (key) {
    case 'touched': return r.last_touch_at ? new Date(r.last_touch_at).getTime() : null;
    case 'ticker': return r.ticker || '';
    case 'price': return r.price;
    case 'dist_sma150': return computeBreakoutDistSma150(r);
    case 'sector': return (extra && extra.sector_etf) || '';
    case 'earnings': return getBreakoutEarningsDays(r, scanLookup);
    case 'cci': return r.cci;
    case 'volume': return r.today_volume;
    default: return null;
  }
}

// Mirrors applySort()'s null-handling idiom (Full Scan table above): missing
// values become +/-Infinity depending on direction, which always pushes them
// to the end of the list regardless of ascending vs descending.
function applyBreakoutSort(rows, scanLookup) {
  const { breakoutSortKey: key, breakoutSortDir: dir } = state;
  if (!key) return rows;
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let av = getBreakoutSortValue(a, key, scanLookup);
    let bv = getBreakoutSortValue(b, key, scanLookup);
    if (av === null || av === undefined) av = dir === 'asc' ? Infinity : -Infinity;
    if (bv === null || bv === undefined) bv = dir === 'asc' ? Infinity : -Infinity;
    if (typeof av === 'string') return av.localeCompare(bv) * mul;
    return (av - bv) * mul;
  });
}

function renderBreakoutAlertRow(r, scanLookup) {
  const extra = scanLookup[r.ticker];
  const distSma150 = computeBreakoutDistSma150(r);
  const earningsDays = getBreakoutEarningsDays(r, scanLookup);
  const earningsText = earningsDays !== null && earningsDays !== undefined
    ? (earningsDays <= 14 ? `${ICONS.earningsSoon()} ${earningsDays}d` : `${earningsDays}d`)
    : '—';
  return `
    <tr>
      <td class="mono">${fmtRelative(r.last_touch_at)}</td>
      <td class="mono">${escapeHtml(r.ticker)}</td>
      <td class="mono">${fmtPrice(r.price)}</td>
      <td class="mono">${distSma150 !== null ? fmtPct(distSma150) : '—'}</td>
      <td class="mono">${escapeHtml((extra && extra.sector_etf) || '—')}</td>
      <td>${earningsText}</td>
      <td class="mono">${Math.round(r.cci)}</td>
      <td class="mono">${fmtCompactNumber(r.today_volume)}${r.volume_ratio ? ` (x${r.volume_ratio.toFixed(1)})` : ''}</td>
    </tr>
  `;
}

function renderBreakoutAlertsTable() {
  const { active, archived } = splitBreakoutAlerts(state.breakoutAlerts);
  const scanLookup = buildScanLookup(state.scan);
  const sortedActive = applyBreakoutSort(active, scanLookup);

  const empty = document.getElementById('breakouts-empty');
  const wrap = document.getElementById('breakouts-table-wrap');
  const body = document.getElementById('breakouts-table-body');
  if (active.length === 0) {
    empty.hidden = false;
    wrap.hidden = true;
  } else {
    empty.hidden = true;
    wrap.hidden = false;
    body.innerHTML = sortedActive.map(r => renderBreakoutAlertRow(r, scanLookup)).join('');
  }

  const archiveDetails = document.getElementById('breakouts-archive');
  const archiveCount = document.getElementById('breakouts-archive-count');
  const archiveBody = document.getElementById('breakouts-archive-body');
  archiveDetails.hidden = archived.length === 0;
  archiveCount.textContent = archived.length;
  archiveBody.innerHTML = archived.map(r => renderBreakoutAlertRow(r, scanLookup)).join('');
}

function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.setAttribute('aria-selected', String(btn.dataset.tab === tab)));
  document.getElementById('panel-scan').hidden = tab !== 'scan';
  document.getElementById('panel-breakouts').hidden = tab !== 'breakouts';
}

function wireControls() {
  // Ticker/sector search now lives in the shared global search bar
  // (nav.js), so this page just reacts to it.
  window.addEventListener('globalsearch:change', (e) => {
    state.search = e.detail;
    renderScanTable();
  });
  document.getElementById('min-score').addEventListener('input', (e) => {
    state.minScore = Number(e.target.value) || 0;
    renderScanTable();
  });
  document.getElementById('sector-filter').addEventListener('change', (e) => {
    state.sector = e.target.value;
    renderScanTable();
  });
  document.getElementById('confluence-toggle').addEventListener('click', (e) => {
    state.confluenceOnly = !state.confluenceOnly;
    e.target.setAttribute('aria-pressed', String(state.confluenceOnly));
    renderScanTable();
  });
  document.getElementById('earnings-toggle').addEventListener('click', (e) => {
    state.earningsOnly = !state.earningsOnly;
    e.target.setAttribute('aria-pressed', String(state.earningsOnly));
    renderScanTable();
  });
  document.getElementById('sma-filter').addEventListener('change', (e) => {
    state.smaFilter = e.target.value;
    renderScanTable();
  });

  document.querySelectorAll('#scan-table-head th[data-sort-key]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = key;
        state.sortDir = 'desc';
      }
      document.querySelectorAll('#scan-table-head th').forEach(h => h.removeAttribute('aria-sort'));
      th.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
      renderScanTable();
    });
  });

  document.querySelectorAll('#breakouts-table-head th[data-sort-key]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (state.breakoutSortKey === key) {
        state.breakoutSortDir = state.breakoutSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.breakoutSortKey = key;
        state.breakoutSortDir = BREAKOUT_SORT_DEFAULTS[key];
      }
      document.querySelectorAll('#breakouts-table-head th').forEach(h => {
        h.removeAttribute('aria-sort');
        const arrow = h.querySelector('.sort-arrow');
        if (arrow) arrow.remove();
      });
      th.setAttribute('aria-sort', state.breakoutSortDir === 'asc' ? 'ascending' : 'descending');
      th.insertAdjacentHTML('beforeend', `<span class="sort-arrow">${state.breakoutSortDir === 'asc' ? '▲' : '▼'}</span>`);
      renderBreakoutAlertsTable();
    });
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

async function loadAndRender() {
  const { scan, breakoutAlerts } = await DASHBOARD.fetchAll();
  state.scan = scan;
  state.breakoutAlerts = breakoutAlerts;
  if (scan && scan.stocks) populateSectorOptions(scan.stocks);
  renderScanTable();
  renderBreakoutAlertsTable();
  updateLastUpdated(scan ? scan.generated_at : null);
}

wireControls();
if (window.location.hash === '#breakouts') switchTab('breakouts');
wireRefreshButton(loadAndRender);
loadAndRender();
