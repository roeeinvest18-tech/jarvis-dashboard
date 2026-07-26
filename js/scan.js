// Page 2 — Full Scan Results: sortable/filterable table of every scanned
// ticker, plus a separate CCI Oversold Watchlist tab. Trading-only page.

renderNav('scan');
renderTopbar('app-header', 'Full Scan Results');

const state = {
  scan: null,
  cciOversold: null,
  activeTab: 'scan',
  search: '',
  minScore: 0,
  sector: '',
  confluenceOnly: false,
  smaFilter: 'any', // any | above | below
  earningsOnly: false,
  sortKey: 'score',
  sortDir: 'desc',
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
    if (state.search && !r.ticker.toLowerCase().includes(state.search.toLowerCase())) return false;
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

function renderOversoldTable() {
  const mount = document.getElementById('oversold-table-body');
  const list = state.cciOversold ? state.cciOversold.watchlist || [] : [];
  const empty = document.getElementById('oversold-empty');
  const wrap = document.getElementById('oversold-table-wrap');
  if (list.length === 0) {
    empty.hidden = false;
    wrap.hidden = true;
    return;
  }
  empty.hidden = true;
  wrap.hidden = false;
  mount.innerHTML = list.map(r => `
    <tr>
      <td class="mono">${r.consecutive_days}d</td>
      <td class="mono">${escapeHtml(r.ticker)}</td>
      <td class="mono">${fmtPrice(r.price)}</td>
      <td class="mono ${r.change_pct >= 0 ? 'gain' : 'loss'}">${fmtChange(r.change_pct)}</td>
      <td class="mono">${Math.round(r.cci)}</td>
      <td class="mono">${r.sma150_pct !== null ? fmtPct(r.sma150_pct) : '—'}</td>
      <td class="mono">${escapeHtml(r.sector_etf || '—')}</td>
      <td>${r.earnings_days !== null && r.earnings_days !== undefined && r.earnings_days <= 14 ? ICONS.earningsSoon() : ''}</td>
    </tr>
  `).join('');
}

function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.setAttribute('aria-selected', String(btn.dataset.tab === tab)));
  document.getElementById('panel-scan').hidden = tab !== 'scan';
  document.getElementById('panel-oversold').hidden = tab !== 'oversold';
}

function wireControls() {
  document.getElementById('search-input').addEventListener('input', (e) => {
    state.search = e.target.value;
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

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

async function loadAndRender() {
  const { scan, cciOversold } = await DASHBOARD.fetchAll();
  state.scan = scan;
  state.cciOversold = cciOversold;
  if (scan && scan.stocks) populateSectorOptions(scan.stocks);
  renderScanTable();
  renderOversoldTable();
  updateLastUpdated(scan ? scan.generated_at : null);
}

wireControls();
if (window.location.hash === '#oversold') switchTab('oversold');
wireRefreshButton(loadAndRender);
loadAndRender();
