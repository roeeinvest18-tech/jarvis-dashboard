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

// Only a top-tier score earns the accent; the rest step down through ink.
// A ranked list is only useful if its head is separable from its middle.
//
// Thresholds are set against the Top 10 model's real distribution, not a
// round number: on a live scan of 146 eligible stocks the scores ran
// 7..88 with a median of 56, so the old >=90 cut would never have fired and
// the accent would have been dead code. >=80 picks out roughly the top
// handful, which is what "notable" should mean.
function tradingScoreClass(score) {
  if (score >= 80) return 'is-high';
  if (score >= 65) return 'is-mid';
  return 'is-low';
}

// --- Top 10 score ----------------------------------------------------------
//
// scoring.py owns the model and scout.py writes top10_score (and the ranked
// scan.top10 list) into the feed. This page only renders that answer. It used
// to carry a JS copy of the model as a fallback for scans published before
// the model existed, but that copy put the strategy's weights and gates into
// the public repo; the rules now live only in the private repo.
// A scan without scores shows an honest "not scored yet" state instead.
function tradingTop10Score(record) {
  return typeof record.top10_score === 'number' ? record.top10_score : null;
}

// --- TradingView links ------------------------------------------------------
//
// A bare ticker often fails to resolve on TradingView, so the exchange prefix
// matters. scout.py resolves it per stock (yfinance's own code, mapped); this
// falls back to a bare symbol when it is missing rather than guessing a
// prefix, because a wrong exchange silently opens a different instrument.
//
// Until the next nightly scan runs, no record carries an exchange yet, so
// every link uses the bare form. That resolves for most US listings and
// self-corrects the first time the scan republishes.

function tradingViewUrl(ticker, exchange) {
  const symbol = exchange ? `${exchange}:${ticker}` : ticker;
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
}

// Breakout alerts carry no exchange of their own, so they borrow it from the
// scan by ticker -- one lookup table rather than a second published field.
function tradingExchangeFor(ticker) {
  const scan = tradingState.scan;
  if (!scan || !scan.stocks) return null;
  if (!tradingState._exchangeByTicker) {
    tradingState._exchangeByTicker = Object.fromEntries(
      scan.stocks.map(s => [s.ticker, s.exchange || null]));
  }
  return tradingState._exchangeByTicker[ticker] || null;
}

// Shared by every tappable row. target=_blank keeps Jarvis open behind it,
// and on mobile hands off to the TradingView app when installed.
function tradingLinkAttrs(ticker, exchange) {
  return `href="${escapeHtml(tradingViewUrl(ticker, exchange))}" target="_blank" `
    + `rel="noopener noreferrer" aria-label="Open ${escapeHtml(ticker)} chart on TradingView"`;
}

const tradingState = {
  scan: null,
  account: null,
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

  // The scan's own ranking, and only once it was produced by the current
  // model: a scan.json from before it carries the previous ordering, which
  // would show the old list under the new rules.
  const byTicker = Object.fromEntries(scan.stocks.map(s => [s.ticker, s]));
  const scanHasModel = scan.stocks.some(s => typeof s.top10_score === 'number');
  if (!scanHasModel) {
    mount.innerHTML = `<div class="empty-state">This scan predates the current Top 10 scores. The next nightly scan ranks it.</div>`;
    return;
  }
  // scout.py ranks; ties and order are its call, not re-derived here.
  const ordered = (scan.top10 && scan.top10.length)
    ? scan.top10.map(t => byTicker[t]).filter(Boolean)
    : scan.stocks
        .filter(s => typeof s.top10_score === 'number')
        .sort((a, b) => b.top10_score - a.top10_score)
        .slice(0, 10);

  const shown = ordered.filter(r => tradingMatchesSearch(r, tradingState.search));
  const peers = correlationPeers(ordered);
  // Private tier, and only ever on a device that already has the positions.
  const held = accountSectorOverlap(ordered,
    ((tradingState.account || {}).record || {}).open_sectors);
  const hasFlags = ordered.some(r => Array.isArray(r.rule_flags));

  mount.innerHTML = `
    <div class="sec-label-row">
      <h2 class="sec-label sec-label-gold">Today's ranked setups</h2>
      <span class="sec-note">scan ${escapeHtml(healthFmtWhen(scan.generated_at))}</span>
    </div>
    ${shown.length ? `<div class="setup-list">${shown.map(r => {
      const rank = ordered.indexOf(r) + 1;
      const badge = tradingBadge(r.setup_tag);
      const change = r.change_pct;
      // Ranks 6+ step down in weight and ink so the list reads as continuing
      // past its head. This used to be an opacity fade down to 15%, which
      // put tickers and prices near 1.2:1 contrast -- unreadable, and below
      // the 4.5:1 floor the design now enforces (test_contrast_e2e.js).
      const tail = rank >= 6 ? ' is-tail' : '';
      const score = tradingTop10Score(r);
      return `
        <a class="setup-card is-link${tail}" ${tradingLinkAttrs(r.ticker, r.exchange)}>
          <span class="setup-rank mono">${rank}</span>
          <div class="setup-main">
            <div class="setup-row">
              <span class="setup-ticker">${escapeHtml(r.ticker)}</span>
              <span class="setup-badge ${badge.cls}">${badge.label}</span>
            </div>
            <div class="setup-row setup-meta">
              <span class="mono setup-price">${fmtPrice(r.price)}</span>
              <span class="mono setup-change ${change >= 0 ? 'is-up' : 'is-down'}">${fmtChange(change)}</span>
              <span class="setup-vol">Vol ${fmtCompactNumber(r.today_volume)}</span>
            </div>
            ${tradingFlagsHtml(r, peers[r.ticker], held[r.ticker])}
          </div>
          <span class="setup-score mono ${tradingScoreClass(score)}">${Math.round(score)}</span>
        </a>`;
    }).join('')}</div>`
    : `<div class="empty-state">No ranked setups match "${escapeHtml(tradingState.search)}".</div>`}
    ${hasFlags ? '' : `<p class="trading-note">Float, short-float and earnings checks appear from the next nightly scan.</p>`}
    ${tradingSizingHtml()}`;
  wireTradingSizing();
}

// --- Rule flags + correlation (quiet mono marks under each card) ----------
//
// Verdicts come from the scan (thresholds stay private in the scan's config).
// Missing data reads "unknown" -- never silently as a pass.
const TRADING_FLAG_TEXT = {
  'float:low': 'low float', 'float:unknown': 'float unknown',
  'short:high': 'high short float', 'short:unknown': 'short float unknown',
  'earnings:unknown': 'earnings date unknown',
};

function tradingFlagsHtml(r, peer, heldSector) {
  const marks = (r.rule_flags || []).map(f => (f.kind === 'earnings' && f.state === 'soon'
    ? `earnings ${f.days}d` : TRADING_FLAG_TEXT[`${f.kind}:${f.state}`])).filter(Boolean);
  if (peer) {
    marks.push(`same ${peer.basis} as ${peer.peers.join(', ')}`);
  }
  if (heldSector) {
    marks.push(`you already hold ${heldSector}`);
  }
  if (!marks.length) return '';
  return `<div class="setup-flags mono">${marks.map(m => `<span>${escapeHtml(m)}</span>`).join('')}</div>`;
}

// --- Position sizing (fully client-side) ----------------------------------
//
// The three limits and the portfolio value live in THIS device's
// localStorage only: never synced, never published. Nothing is prefilled --
// the app ships no one's risk rules.
const SIZING_KEY = 'jarvis:sizing';

function sizingLoad() {
  try { return JSON.parse(localStorage.getItem(SIZING_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function sizingSave(v) {
  try { localStorage.setItem(SIZING_KEY, JSON.stringify(v)); } catch (e) { /* private mode: still computes */ }
}

let tradingSizingOpen = false;
function tradingSizingHtml() {
  const v = sizingLoad();
  const field = (id, label, val, step) => `
    <label class="sizing-field"><span>${label}</span>
      <input type="number" inputmode="decimal" step="${step}" min="0" data-sizing="${id}" value="${val ?? ''}"></label>`;
  return `
    <details class="sizing-tool"${tradingSizingOpen ? ' open' : ''}>
      <summary><span class="sec-label">Position size</span><span class="sec-note">stays on this device</span></summary>
      <div class="sizing-grid">
        ${field('entry', 'Entry', v.entry, '0.01')}
        ${field('stop', 'Stop', v.stop, '0.01')}
        ${field('portfolio', 'Portfolio $', v.portfolio, '1')}
      </div>
      <p class="sizing-hint">Your limits</p>
      <div class="sizing-grid">
        ${field('maxRisk', 'Max risk $', v.maxRisk, '1')}
        ${field('maxPosition', 'Max position $', v.maxPosition, '1')}
        ${field('maxPct', 'Max % of portfolio', v.maxPct, '0.1')}
      </div>
      <div class="sizing-result" id="sizing-result" aria-live="polite"></div>
    </details>`;
}

function renderSizingResult() {
  const out = document.getElementById('sizing-result');
  if (!out) return;
  const r = sizingCompute(sizingLoad());
  if (r.error) { out.innerHTML = `<p class="sizing-hint">${escapeHtml(r.error)}</p>`; return; }
  out.innerHTML = `
    <div class="sizing-shares"><span class="mono">${r.shares}</span> shares</div>
    <p class="sizing-line">Limited by <b>${escapeHtml(r.bindingLabel)}</b>.</p>
    <p class="sizing-line mono">risk $${r.riskUsd.toFixed(0)} · position $${r.positionUsd.toFixed(0)} · ${r.pctOfPortfolio.toFixed(1)}% of portfolio</p>`;
}

function wireTradingSizing() {
  const tool = document.querySelector('.sizing-tool');
  if (!tool) return;
  tool.addEventListener('toggle', () => { tradingSizingOpen = tool.open; });
  tool.querySelectorAll('[data-sizing]').forEach(input => {
    input.addEventListener('input', () => {
      const v = sizingLoad();
      const n = parseFloat(input.value);
      v[input.dataset.sizing] = Number.isFinite(n) ? n : undefined;
      sizingSave(v);
      renderSizingResult();
    });
  });
  renderSizingResult();
}

// --- "Can I trade today" (private tier) -----------------------------------
//
// The answers come from the sync server, computed where the rules live. The
// public site and any device without the owner's sync token show the "local
// only" placeholder instead -- account facts never ship with the dashboard.
const ACCOUNT_CALENDAR = { ET: MC_ET, IL: MC_IL, parts: mcParts, isTradingDay: mcIsTradingDay };
let accountEditorOpen = false;

async function accountFetchStatus() {
  const { url, token } = healthSyncConfig();
  if (!url || !token) return { status: 'no-sync', record: null };
  try {
    const resp = await fetch(`${url}/account-status`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    });
    if (resp.status === 404) return { status: 'not-deployed', record: null };
    if (resp.status === 401 || resp.status === 403) return { status: 'rejected', record: null };
    if (!resp.ok) return { status: 'error', record: null };
    const body = await resp.json();
    return { status: 'ok', record: body && typeof body.open_positions === 'number' ? body : null };
  } catch (e) {
    return { status: 'unreachable', record: null };
  }
}

async function accountSaveManual(entry) {
  const { url, token } = healthSyncConfig();
  if (!url || !token) return null;
  try {
    const resp = await fetch(`${url}/account-manual`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    return resp.ok ? await resp.json() : null;
  } catch (e) {
    return null;
  }
}

function accountEditorHtml(record) {
  const manual = (record && record.manual_input) || { positions: [], closed_trades: [] };
  const rows = manual.positions.map((p, i) => `
    <div class="acct-row">
      <input type="text" data-acct-pos="${i}" data-field="ticker" value="${escapeHtml(p.ticker || '')}"
             placeholder="Ticker" aria-label="Position ticker" maxlength="10">
      <input type="text" data-acct-pos="${i}" data-field="sector" value="${escapeHtml(p.sector || '')}"
             placeholder="Sector ETF" aria-label="Sector ETF" maxlength="10">
      <button type="button" class="acct-remove" data-acct-remove-pos="${i}" aria-label="Remove position">&times;</button>
    </div>`).join('');
  const trades = manual.closed_trades.map((t, i) => `
    <div class="acct-row">
      <input type="date" data-acct-trade="${i}" data-field="closed_at" value="${escapeHtml(t.closed_at || '')}"
             aria-label="Closed date">
      <select data-acct-trade="${i}" data-field="result" aria-label="Result">
        ${['win', 'loss', 'breakeven'].map(r => `<option value="${r}"${t.result === r ? ' selected' : ''}>${r}</option>`).join('')}
      </select>
      <label class="acct-stop"><input type="checkbox" data-acct-trade="${i}" data-field="stopped_out"
             ${t.stopped_out ? 'checked' : ''}> stop</label>
      <button type="button" class="acct-remove" data-acct-remove-trade="${i}" aria-label="Remove trade">&times;</button>
    </div>`).join('');
  return `
    <details class="acct-editor"${accountEditorOpen ? ' open' : ''}>
      <summary><span class="sec-note">Positions and closed trades (private)</span></summary>
      <p class="sizing-hint">Tickers and outcomes only — no sizes or prices. Stays on your sync server.</p>
      <div class="acct-list">${rows || '<p class="sizing-hint">No open positions recorded.</p>'}</div>
      <button type="button" class="btn-quiet" id="acct-add-pos">Add position</button>
      <p class="sizing-hint">Closed trades</p>
      <div class="acct-list">${trades || '<p class="sizing-hint">None recorded.</p>'}</div>
      <button type="button" class="btn-quiet" id="acct-add-trade">Add closed trade</button>
      <div class="acct-save-row">
        <button type="button" class="btn-primary" id="acct-save">Save</button>
        <span class="sizing-hint" id="acct-save-note"></span>
      </div>
    </details>`;
}

function renderAccountCard() {
  const mount = document.getElementById('account-card');
  if (!mount) return;
  const { status, record } = tradingState.account || { status: 'loading', record: null };
  mount.className = 'acct-card';

  if (status === 'no-sync') {
    mount.innerHTML = `<div class="sec-label-row"><h2 class="sec-label">Can I trade today</h2></div>
      ${renderWithheldZone('Account rules')}`;
    return;
  }
  const now = new Date();
  const win = accountEntryWindow(now, record && record.entry_cutoff_israel, ACCOUNT_CALENDAR);
  const lines = accountCardLines(record, win, now);
  const note = {
    'not-deployed': 'Waiting for the sync server to update.',
    rejected: 'The sync server rejected this device’s token.',
    unreachable: 'Sync server unreachable.',
    error: 'The sync server returned an error.',
    loading: 'Checking…',
  }[status];

  mount.innerHTML = `
    <div class="sec-label-row">
      <h2 class="sec-label">Can I trade today</h2>
      <span class="sec-note">${record ? escapeHtml(record.source === 'ibkr' ? 'from IBKR' : 'entered by you') : ''}</span>
    </div>
    ${lines ? `<ul class="acct-lines">${lines.map(l => `
      <li class="acct-line">
        <span class="acct-label">${escapeHtml(l.label)}</span>
        <span class="acct-value mono">${escapeHtml(l.value)}</span>
        ${l.note ? `<span class="acct-note mono">${escapeHtml(l.note)}</span>` : ''}
      </li>`).join('')}</ul>`
    : `<p class="sizing-hint">${escapeHtml(note || 'No account data yet — add your positions below, or connect IBKR.')}</p>`}
    ${status === 'ok' || record ? accountEditorHtml(record) : ''}`;
  wireAccountEditor(record);
}

function wireAccountEditor(record) {
  const editor = document.querySelector('.acct-editor');
  if (!editor) return;
  editor.addEventListener('toggle', () => { accountEditorOpen = editor.open; });
  const manual = JSON.parse(JSON.stringify((record && record.manual_input) || { positions: [], closed_trades: [] }));

  editor.querySelectorAll('[data-acct-pos]').forEach(input => input.addEventListener('input', () => {
    manual.positions[+input.dataset.acctPos][input.dataset.field] = input.value.trim().toUpperCase();
  }));
  editor.querySelectorAll('[data-acct-trade]').forEach(input => input.addEventListener('change', () => {
    const t = manual.closed_trades[+input.dataset.acctTrade];
    t[input.dataset.field] = input.type === 'checkbox' ? input.checked : input.value;
  }));
  const rerender = () => {
    tradingState.account = { status: 'ok', record: { ...(record || {}), manual_input: manual } };
    accountEditorOpen = true;
    renderAccountCard();
  };
  const add = (id, fn) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', () => { fn(); rerender(); });
  };
  add('acct-add-pos', () => manual.positions.push({ ticker: '', sector: '' }));
  add('acct-add-trade', () => manual.closed_trades.push({
    closed_at: new Date().toISOString().slice(0, 10), result: 'win', stopped_out: false }));
  editor.querySelectorAll('[data-acct-remove-pos]').forEach(btn => btn.addEventListener('click', () => {
    manual.positions.splice(+btn.dataset.acctRemovePos, 1); rerender();
  }));
  editor.querySelectorAll('[data-acct-remove-trade]').forEach(btn => btn.addEventListener('click', () => {
    manual.closed_trades.splice(+btn.dataset.acctRemoveTrade, 1); rerender();
  }));

  const save = document.getElementById('acct-save');
  if (save) save.addEventListener('click', async () => {
    const note = document.getElementById('acct-save-note');
    const clean = {
      positions: manual.positions.filter(p => p.ticker),
      closed_trades: manual.closed_trades.filter(t => t.closed_at && t.result),
    };
    if (note) note.textContent = 'Saving…';
    const saved = await accountSaveManual(clean);
    if (saved) {
      tradingState.account = { status: 'ok', record: saved };
      renderAccountCard();
      if (tradingShell) tradingShell.repaint();
    } else if (note) {
      note.textContent = 'Could not save — check the sync settings.';
    }
  });
}

// --- Trading window (a mood, not a lock) ----------------------------------
function renderMarketWindow(now = new Date()) {
  const mount = document.getElementById('market-window');
  if (!mount) return;
  const s = mcNextSession(now);
  const open = s && s.open <= now && now < s.close;
  const t = d => mcFmtIL(d, { hour: '2-digit', minute: '2-digit' });
  let text;
  if (open) {
    text = `Session open · closes ${t(s.close)}${s.early ? ' (early close)' : ''}`;
  } else if (s) {
    const todayIl = mcParts(now, MC_IL).ymd;
    const openIl = mcParts(s.open, MC_IL).ymd;
    const day = openIl === todayIl ? 'today' : mcFmtIL(s.open, { weekday: 'short' });
    const holiday = mcHolidayName(mcParts(now, MC_ET).ymd);
    text = `${holiday ? `US market closed for ${holiday} · ` : ''}Session opens ${day} ${t(s.open)}`;
  } else {
    text = 'Market calendar unavailable';
  }
  document.body.classList.toggle('is-market-closed', !open);
  mount.className = 'market-window mono';
  mount.textContent = text;
}

// --- Breadth + why the regime label says what it says ---------------------
function renderMarketWhy() {
  const mount = document.getElementById('market-why');
  const scan = tradingState.scan;
  if (!mount || !scan) return;
  const b = breadthAboveSma150(scan);
  const regime = (scan.market && scan.market.regime) || null;
  const inputs = scan.market && scan.market.regime_inputs;
  const breadth = b ? `${Math.round(100 * b.above / b.total)}% of the watchlist is above its SMA150 (${b.above} of ${b.total}).` : '';
  let why;
  if (inputs && inputs.ratios) {
    const arrow = t => (t === 'rising' ? 'rising' : t === 'falling' ? 'falling' : 'unknown');
    why = `
      <p>The label compares three risk-appetite ratios with ${inputs.lookback_days} trading days ago:</p>
      <ul class="why-list">${inputs.ratios.map(r => `<li><span>${escapeHtml(r.meaning)}</span><span class="mono">${arrow(r.trend)}</span></li>`).join('')}</ul>
      <p>Two or more rising reads RISK-ON, two or more falling reads DEFENSIVE, anything else NEUTRAL.</p>`;
  } else {
    why = '<p>The inputs behind this label are published from the next nightly scan.</p>';
  }
  const open = mount.querySelector('details') && mount.querySelector('details').open;
  mount.className = 'market-why';
  mount.innerHTML = `
    <details${open ? ' open' : ''}>
      <summary>Why ${escapeHtml(regime || 'this label')}${breadth ? ' · breadth' : ''}</summary>
      ${breadth ? `<p>${escapeHtml(breadth)}</p>` : ''}
      ${why}
    </details>`;
}

// --- Signal scorecard -----------------------------------------------------
const SCORECARD_MODELS = {
  'lowcci-v1': 'Low-CCI model · live picks',
  'lowcci-v1-reconstructed': 'Low-CCI model · reconstructed for earlier nights',
  'reclaim-v1': 'Reclaim model · as published',
};

function scorecardCell(c) {
  if (!c || !c.n) return '<td class="mono sc-empty">no outcomes yet</td>';
  if (c.avg_return_pct === undefined) return `<td class="mono sc-empty">n=${c.n} · not enough samples yet</td>`;
  const sign = v => (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  return `<td class="mono"><span class="sc-main">${sign(c.avg_excess_vs_spy_pct)}</span> vs SPY<br>
    <span class="sc-sub">avg ${sign(c.avg_return_pct)} · beat SPY ${c.beat_spy_pct}% · n=${c.n}</span></td>`;
}

function renderTradingScorecard() {
  const mount = document.getElementById('panel-scorecard');
  if (!mount) return;
  const sc = tradingState.scorecard;
  if (!sc || !sc.rows || !sc.rows.length) {
    mount.innerHTML = '<div class="empty-state">The scorecard appears after the next nightly scan.</div>';
    return;
  }
  const hz = sc.horizons_trading_days || [5, 10, 20];
  const versions = [...new Set(sc.rows.map(r => r.model_version))]
    .sort((a, b) => Object.keys(SCORECARD_MODELS).indexOf(a) - Object.keys(SCORECARD_MODELS).indexOf(b));
  const liveFrom = (sc.rows.find(r => r.model_version === 'lowcci-v1' && r.group === 'all ranks') || {}).first_session;
  mount.innerHTML = `
    <p class="sc-caution">Low-CCI figures${liveFrom ? ` before ${escapeHtml(liveFrom)}` : ''} are reconstructed from each
      night's published data, not live picks, and the period is too short to draw conclusions.</p>
    <p class="trading-note">How each night's Top 10 did afterwards: average forward return compared with SPY over the
      same window, ${escapeHtml(sc.period.first_session || '')} to ${escapeHtml(sc.period.last_session || '')}.
      Observed averages over this period, not predictions; a figure appears only once a group has
      ${sc.min_sample} completed picks. ${escapeHtml(sc.method || '')}</p>
    ${versions.map(v => `
      <section class="sc-block">
        <h2 class="sec-label">${escapeHtml(SCORECARD_MODELS[v] || v)}</h2>
        ${(() => {
          const all = sc.rows.find(r => r.model_version === v && r.group === 'all ranks');
          return all ? `<p class="sc-range mono">${all.picks} picks · ${all.sessions} nights · ${escapeHtml(all.first_session || '?')} to ${escapeHtml(all.last_session || '?')}</p>` : '';
        })()}
        <table class="sc-table">
          <thead><tr><th></th>${hz.map(h => `<th class="mono">${h} days</th>`).join('')}</tr></thead>
          <tbody>${sc.rows.filter(r => r.model_version === v).map(r => `
            <tr><th scope="row">${escapeHtml(r.group)}<br><span class="sc-sub mono">${r.picks} picks · ${r.sessions} nights</span></th>
              ${hz.map(h => scorecardCell(r.horizons[String(h)])).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </section>`).join('')}`;
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
        <a class="setup-card is-link" ${tradingLinkAttrs(r.ticker, tradingExchangeFor(r.ticker))}>
          <div class="setup-main">
            <div class="setup-row">
              <span class="setup-ticker">${escapeHtml(r.ticker)}</span>
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
        </a>`;
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
              <tr class="is-link" data-tv-ticker="${escapeHtml(r.ticker)}"
                  data-tv-exchange="${escapeHtml(r.exchange || '')}">
                <td class="col-ticker"><a ${tradingLinkAttrs(r.ticker, r.exchange)}>${escapeHtml(r.ticker)}</a></td>
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

  // Whole-row tap target for the table. The ticker cell is already a real
  // anchor (so keyboard and screen readers get a proper link); this just
  // widens the target to the rest of the row for a thumb.
  mount.querySelectorAll('tr[data-tv-ticker]').forEach(tr => {
    tr.addEventListener('click', ev => {
      if (ev.target.closest('a')) return;   // the anchor handles its own click
      window.open(tradingViewUrl(tr.dataset.tvTicker, tr.dataset.tvExchange || null),
        '_blank', 'noopener');
    });
  });

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

const TRADING_TITLES = { breakouts: 'Breakouts', fullscan: 'Full Scan', scorecard: 'Scorecard' };

const tradingShell = mountShell({
  areaId: 'trading',
  titleFor: tab => (TRADING_TITLES[tab] ? `<h1 class="shell-title">${TRADING_TITLES[tab]}</h1>` : ''),
  render(tab) {
    renderMarketWindow();
    renderMarketBar(tab);
    renderMarketWhy();
    renderTradingSearch();
    if (tab === 'top10') { renderTradingTop10(); renderAccountCard(); }
    else if (tab === 'breakouts') renderTradingBreakouts();
    else if (tab === 'scorecard') renderTradingScorecard();
    else renderTradingFullScan();
  },
});

async function tradingLoad() {
  const [scan, breakouts, scorecard] = await Promise.all([
    DASHBOARD.fetchOne('scan'),
    DASHBOARD.fetchOne('breakoutAlerts'),
    DASHBOARD.fetchOne('scorecard'),
  ]);
  tradingState.scan = scan;
  tradingState.breakouts = breakouts;
  tradingState.scorecard = scorecard;
  if (tradingShell) tradingShell.repaint();
  renderHealthStrip(document.getElementById('health-strip'), scan);
  // Private tier: only a device holding the owner's sync token gets an answer.
  tradingState.account = await accountFetchStatus();
  renderAccountCard();
  if (tradingShell) tradingShell.repaint();
}

tradingLoad();
// The open/closed line follows the clock without a reload.
setInterval(() => renderMarketWindow(), 60 * 1000);
