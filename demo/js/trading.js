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

const TRADE_S = STRINGS.trading;
const ACCT_S = STRINGS.account.editor;

// The RECLAIM/BREAKOUT/SIGNAL classification (scout.py's setup_tag) still
// feeds scoring server-side -- this file just stopped displaying it as a
// column, in favour of the SMA150 distance the classification is largely
// derived from. See tradingSma150Html below.

// Signed distance from SMA150, e.g. "+2.7%" above or "-1.3%" below.
// fmtPct (data.js) already does exactly this formatting -- it backs the same
// figure on the account/priority cards -- so this only picks the field.
// Neutral colour, deliberately: --up/--down are reserved for today's price
// change, not a technical level, and the existing SMA-distance display
// elsewhere in the app (components.js's smaDistanceHtml) is neutral too.
function tradingSma150Value(pct) {
  return pct === null || pct === undefined ? '—' : fmtPct(pct);
}

// The card layouts (Top 10) have no column header to say what this figure
// is, so it carries its own "SMA150" label, the same "+2.7% SMA150"
// convention components.js's smaDistanceHtml already uses. The Full Scan
// table has an actual "SMA150" header instead (see TRADING_COLUMNS), so its
// cells use the bare value.
function tradingSma150Html(r) {
  return `<span class="mono setup-sma150">${tradingSma150Value(r.pct_SMA150)} SMA150</span>`;
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
  // Full Scan filters. Plain in-memory state, same as search and sort above
  // it: persists across sub-tab switches for the life of this page load,
  // resets to these defaults on a fresh one -- no separate mechanism needed.
  scanFilters: { sma150Min: null, sma150Max: null, volMin: null, sectors: [] },
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
    <input type="text" id="trading-search-input" placeholder="${TRADE_S.search}…"
           aria-label="${TRADE_S.search}" value="${escapeHtml(tradingState.search)}">
    <button type="button" class="trading-search-clear" id="trading-search-clear"
            aria-label="${TRADE_S.clearSearch}" ${tradingState.search ? '' : 'hidden'}>&times;</button>`;

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
    mount.innerHTML = `<div class="empty-state">${TRADE_S.top10.noScan}</div>`;
    return;
  }

  // The scan's own ranking, and only once it was produced by the current
  // model: a scan.json from before it carries the previous ordering, which
  // would show the old list under the new rules.
  const byTicker = Object.fromEntries(scan.stocks.map(s => [s.ticker, s]));
  const scanHasModel = scan.stocks.some(s => typeof s.top10_score === 'number');
  if (!scanHasModel) {
    mount.innerHTML = `<div class="empty-state">${TRADE_S.top10.staleModel}</div>`;
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
      <h2 class="sec-label sec-label-gold">${TRADE_S.top10.heading}</h2>
      <span class="sec-note">${escapeHtml(TRADE_S.top10.scanned(healthFmtWhen(scan.generated_at)))}</span>
    </div>
    ${shown.length ? `<div class="setup-list">${shown.map(r => {
      const rank = ordered.indexOf(r) + 1;
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
              ${tradingSma150Html(r)}
            </div>
            <div class="setup-row setup-meta">
              <span class="mono setup-price">${fmtPrice(r.price)}</span>
              <span class="mono setup-change ${change >= 0 ? 'is-up' : 'is-down'}">${fmtChange(change)}</span>
              <span class="setup-vol">${TRADE_S.top10.volume(fmtCompactNumber(r.today_volume))}</span>
            </div>
            ${tradingFlagsHtml(r, peers[r.ticker], held[r.ticker])}
          </div>
          <span class="setup-score mono ${tradingScoreClass(score)}">${Math.round(score)}</span>
        </a>`;
    }).join('')}</div>`
    : `<div class="empty-state">${escapeHtml(TRADE_S.top10.noMatch(tradingState.search))}</div>`}
    <p class="trading-note">${TRADE_S.tagLegend}</p>
    ${hasFlags ? '' : `<p class="trading-note">${TRADE_S.top10.flagsPending}</p>`}
    ${tradingSizingHtml()}`;
  wireTradingSizing();
}

// --- Rule flags + correlation (quiet mono marks under each card) ----------
//
// Verdicts come from the scan (thresholds stay private in the scan's config).
// Missing data reads "unknown" -- never silently as a pass.
const TRADING_FLAG_TEXT = TRADE_S.top10.flags;

function tradingFlagsHtml(r, peer, heldSector) {
  const marks = (r.rule_flags || []).map(f => (f.kind === 'earnings' && f.state === 'soon'
    ? TRADE_S.top10.earningsSoon(f.days) : TRADING_FLAG_TEXT[`${f.kind}:${f.state}`])).filter(Boolean);
  if (peer) {
    marks.push(TRADE_S.top10.peer(peer.basis, peer.peers.join(', ')));
  }
  if (heldSector) {
    marks.push(TRADE_S.top10.heldSector(heldSector));
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
      <summary><span class="sec-label">${TRADE_S.sizing.title}</span><span class="sec-note">${TRADE_S.sizing.note}</span></summary>
      <div class="sizing-grid">
        ${field('entry', TRADE_S.sizing.entry, v.entry, '0.01')}
        ${field('stop', TRADE_S.sizing.stop, v.stop, '0.01')}
        ${field('portfolio', TRADE_S.sizing.portfolio, v.portfolio, '1')}
      </div>
      <p class="sizing-hint">${TRADE_S.sizing.limits}</p>
      <div class="sizing-grid">
        ${field('maxRisk', TRADE_S.sizing.maxRisk, v.maxRisk, '1')}
        ${field('maxPosition', TRADE_S.sizing.maxPosition, v.maxPosition, '1')}
        ${field('maxPct', TRADE_S.sizing.maxPct, v.maxPct, '0.1')}
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
    <div class="sizing-shares">${TRADE_S.sizing.shares(`<span class="mono">${r.shares}</span>`)}</div>
    <p class="sizing-line">${TRADE_S.sizing.limitedBy(`<b>${escapeHtml(r.bindingLabel)}</b>`)}</p>
    <p class="sizing-line mono">${escapeHtml(TRADE_S.sizing.breakdown(
      r.riskUsd.toFixed(0), r.positionUsd.toFixed(0), r.pctOfPortfolio.toFixed(1)))}</p>`;
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
             placeholder="${ACCT_S.ticker}" aria-label="${ACCT_S.tickerLabel}" maxlength="10">
      <input type="text" data-acct-pos="${i}" data-field="sector" value="${escapeHtml(p.sector || '')}"
             placeholder="${ACCT_S.sectorEtf}" aria-label="${ACCT_S.sectorEtf}" maxlength="10">
      <button type="button" class="acct-remove" data-acct-remove-pos="${i}" aria-label="${ACCT_S.removePosition}">&times;</button>
    </div>`).join('');
  const trades = manual.closed_trades.map((t, i) => `
    <div class="acct-row">
      <input type="date" data-acct-trade="${i}" data-field="closed_at" value="${escapeHtml(t.closed_at || '')}"
             aria-label="${ACCT_S.closedDate}">
      <select data-acct-trade="${i}" data-field="result" aria-label="${ACCT_S.result}">
        ${['win', 'loss', 'breakeven'].map(r => `<option value="${r}"${t.result === r ? ' selected' : ''}>${r}</option>`).join('')}
      </select>
      <label class="acct-stop"><input type="checkbox" data-acct-trade="${i}" data-field="stopped_out"
             ${t.stopped_out ? 'checked' : ''}> ${ACCT_S.stop}</label>
      <button type="button" class="acct-remove" data-acct-remove-trade="${i}" aria-label="${ACCT_S.removeTrade}">&times;</button>
    </div>`).join('');
  return `
    <details class="acct-editor"${accountEditorOpen ? ' open' : ''}>
      <summary><span class="sec-note">${ACCT_S.title}</span></summary>
      <p class="sizing-hint">${ACCT_S.note}</p>
      <div class="acct-list">${rows || `<p class="sizing-hint">${ACCT_S.noPositions}</p>`}</div>
      <button type="button" class="btn-quiet" id="acct-add-pos">${ACCT_S.addPosition}</button>
      <p class="sizing-hint">${ACCT_S.closedTrades}</p>
      <div class="acct-list">${trades || `<p class="sizing-hint">${ACCT_S.noTrades}</p>`}</div>
      <button type="button" class="btn-quiet" id="acct-add-trade">${ACCT_S.addTrade}</button>
      <div class="acct-save-row">
        <button type="button" class="btn-primary" id="acct-save">${STRINGS.common.save}</button>
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
    mount.innerHTML = `<div class="sec-label-row"><h2 class="sec-label">${STRINGS.account.title}</h2></div>
      ${renderWithheldZone(TRADE_S.accountCard.withheldLabel)}`;
    return;
  }
  const now = new Date();
  const win = accountEntryWindow(now, record && record.entry_cutoff_israel, ACCOUNT_CALENDAR);
  const lines = accountCardLines(record, win, now);
  // The same four sentences the health strip uses, so one condition is
   // never described two ways on one screen.
  const note = { ...STRINGS.health.remote, loading: TRADE_S.accountCard.checking }[status];

  mount.innerHTML = `
    <div class="sec-label-row">
      <h2 class="sec-label">${STRINGS.account.title}</h2>
      <span class="sec-note">${record ? escapeHtml(record.source === 'ibkr'
        ? TRADE_S.accountCard.sourceIbkr : TRADE_S.accountCard.sourceManual) : ''}</span>
    </div>
    ${lines ? `<ul class="acct-lines">${lines.map(l => `
      <li class="acct-line">
        <span class="acct-label">${escapeHtml(l.label)}</span>
        <span class="acct-value mono">${escapeHtml(l.value)}</span>
        ${l.note ? `<span class="acct-note mono">${escapeHtml(l.note)}</span>` : ''}
      </li>`).join('')}</ul>`
    : `<p class="sizing-hint">${escapeHtml(note || STRINGS.account.empty)}</p>`}
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
    if (note) note.textContent = TRADE_S.accountCard.saving;
    const saved = await accountSaveManual(clean);
    if (saved) {
      tradingState.account = { status: 'ok', record: saved };
      renderAccountCard();
      if (tradingShell) tradingShell.repaint();
    } else if (note) {
      note.textContent = TRADE_S.accountCard.saveFailed;
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
    text = s.early ? TRADE_S.marketWindow.openEarly(t(s.close)) : TRADE_S.marketWindow.open(t(s.close));
  } else if (s) {
    const todayIl = mcParts(now, MC_IL).ymd;
    const openIl = mcParts(s.open, MC_IL).ymd;
    const day = openIl === todayIl ? TRADE_S.marketWindow.today : mcFmtIL(s.open, { weekday: 'short' });
    const holiday = mcHolidayName(mcParts(now, MC_ET).ymd);
    text = (holiday ? TRADE_S.marketWindow.holiday(holiday) : '')
      + TRADE_S.marketWindow.opens(day, t(s.open));
  } else {
    text = TRADE_S.marketWindow.unavailable;
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
  const breadth = b ? TRADE_S.why.breadth(Math.round(100 * b.above / b.total), b.above, b.total) : '';
  let why;
  if (inputs && inputs.ratios) {
    const arrow = t => TRADE_S.why.trends[t] || TRADE_S.why.trends.unknown;
    why = `
      <p>${TRADE_S.why.intro(inputs.lookback_days)}</p>
      <ul class="why-list">${inputs.ratios.map(r => `<li><span>${escapeHtml(r.meaning)}</span><span class="mono">${arrow(r.trend)}</span></li>`).join('')}</ul>
      <p>${TRADE_S.why.rule}</p>`;
  } else {
    why = `<p>${TRADE_S.why.pending}</p>`;
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
const SCORECARD_MODELS = TRADE_S.scorecard.models;

function scorecardCell(c) {
  const S = TRADE_S.scorecard;
  if (!c || !c.n) return `<td class="mono sc-empty">${S.noOutcomes}</td>`;
  if (c.avg_return_pct === undefined) return `<td class="mono sc-empty">${S.belowSample(c.n)}</td>`;
  const sign = v => (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  return `<td class="mono"><span class="sc-main">${sign(c.avg_excess_vs_spy_pct)}</span> ${S.vsSpy}<br>
    <span class="sc-sub">${escapeHtml(S.detail(sign(c.avg_return_pct), c.beat_spy_pct, c.n))}</span></td>`;
}

function renderTradingScorecard() {
  const mount = document.getElementById('panel-scorecard');
  if (!mount) return;
  const sc = tradingState.scorecard;
  if (!sc || !sc.rows || !sc.rows.length) {
    mount.innerHTML = `<div class="empty-state">${TRADE_S.scorecard.empty}</div>`;
    return;
  }
  const hz = sc.horizons_trading_days || [5, 10, 20];
  const versions = [...new Set(sc.rows.map(r => r.model_version))]
    .sort((a, b) => Object.keys(SCORECARD_MODELS).indexOf(a) - Object.keys(SCORECARD_MODELS).indexOf(b));
  const liveFrom = (sc.rows.find(r => r.model_version === 'lowcci-v1' && r.group === 'all ranks') || {}).first_session;
  const S = TRADE_S.scorecard;
  mount.innerHTML = `
    <p class="sc-caution">${escapeHtml(S.caution(liveFrom ? fmtDate(liveFrom) : ''))}</p>
    <p class="trading-note">${escapeHtml(S.method(
      fmtDate(sc.period.first_session), fmtDate(sc.period.last_session),
      sc.min_sample, sc.method || ''))}</p>
    ${versions.map(v => `
      <section class="sc-block">
        <h2 class="sec-label">${escapeHtml(SCORECARD_MODELS[v] || v)}</h2>
        ${(() => {
          const all = sc.rows.find(r => r.model_version === v && r.group === 'all ranks');
          return all ? `<p class="sc-range mono">${escapeHtml(S.range(all.picks, all.sessions,
            fmtDate(all.first_session), fmtDate(all.last_session)))}</p>` : '';
        })()}
        <table class="sc-table">
          <thead><tr><th></th>${hz.map(h => `<th class="mono">${S.horizon(h)}</th>`).join('')}</tr></thead>
          <tbody>${sc.rows.filter(r => r.model_version === v).map(r => `
            <tr><th scope="row">${escapeHtml(r.group)}<br><span class="sc-sub mono">${escapeHtml(S.groupRange(r.picks, r.sessions))}</span></th>
              ${hz.map(h => scorecardCell(r.horizons[String(h)])).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </section>`).join('')}`;
}

// --- Breakouts ------------------------------------------------------------

const TRADING_BREAKOUT_FILTERS = ['all', 'today', 'week', 'archive']
  .map(id => ({ id, label: TRADE_S.breakouts.filters[id] }));

function renderTradingBreakouts() {
  const mount = document.getElementById('panel-breakouts');
  if (!mount) return;
  const payload = tradingState.breakouts;

  if (!payload) {
    mount.innerHTML = `<div class="empty-state">${TRADE_S.breakouts.empty}</div>`;
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
              <span class="setup-badge is-breakout">${TRADE_S.breakouts.level}</span>
              ${r.touch_count > 1 ? `<span class="setup-touches mono">${TRADE_S.breakouts.touches(r.touch_count)}</span>` : ''}
            </div>
            <div class="setup-row setup-meta">
              <span class="mono setup-price">${fmtPrice(r.price)}</span>
              <span class="mono setup-change ${r.change_pct >= 0 ? 'is-up' : 'is-down'}">${fmtChange(r.change_pct)}</span>
              <span class="setup-vol">${TRADE_S.top10.volume(fmtCompactNumber(r.today_volume))}</span>
            </div>
            <div class="timer-track" role="img"
                 aria-label="${expired ? TRADE_S.breakouts.expiredLabel : TRADE_S.breakouts.remaining(hours, mins)}">
              <span class="timer-fill ${expired ? 'is-expired' : ''}" style="width:${pct}%"></span>
            </div>
            <div class="timer-label mono">
              ${expired ? TRADE_S.breakouts.expired(hours) : TRADE_S.breakouts.left(hours, String(mins).padStart(2, '0'))}
              · ${escapeHtml(TRADE_S.breakouts.touched(fmtRelative(r.last_touch_at)))}
            </div>
          </div>
        </a>`;
    }).join('')}</div>`
    : `<div class="empty-state">${tradingState.breakoutFilter === 'archive'
        ? TRADE_S.breakouts.emptyArchive
        : TRADE_S.breakouts.emptyWindow}</div>`}`;

  mount.querySelectorAll('[data-breakout-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      tradingState.breakoutFilter = btn.dataset.breakoutFilter;
      renderTradingBreakouts();
    });
  });
}

// --- Full Scan ------------------------------------------------------------

// The standard 11 SPDR Select Sector ETFs -- a fixed, public classification,
// not derived data. Anything the scan carries outside this list (shouldn't
// happen, but a stray code must never vanish from the filter) falls back to
// showing its own code as the label.
const TRADING_SECTOR_NAMES = {
  XLC: 'Communication Services', XLY: 'Consumer Discretionary', XLP: 'Consumer Staples',
  XLE: 'Energy', XLF: 'Financials', XLV: 'Health Care', XLI: 'Industrials',
  XLB: 'Materials', XLRE: 'Real Estate', XLK: 'Technology', XLU: 'Utilities',
};
function tradingSectorLabel(code) { return TRADING_SECTOR_NAMES[code] || code; }

// Persisted across repaints the same way tradingSizingOpen is: a plain
// module variable a 'toggle' listener writes to, so switching sub-tabs and
// back leaves the panel exactly as the owner left it.
let tradingScanFiltersOpen = false;

function tradingScanActiveFilterCount() {
  const f = tradingState.scanFilters;
  return ['sma150Min', 'sma150Max', 'volMin'].filter(k => f[k] !== null).length
    + (f.sectors.length ? 1 : 0);
}
function tradingScanFiltersActive() { return tradingScanActiveFilterCount() > 0; }

function tradingClearScanFilters() {
  tradingState.scanFilters = { sma150Min: null, sma150Max: null, volMin: null, sectors: [] };
  // Reset the panel's own fields in place rather than re-rendering it: once
  // #scan-filters exists, renderTradingFullScan's own guard leaves it alone
  // (the same guard that keeps a keystroke from rebuilding itself), so a
  // full re-render here would silently leave the stale values on screen.
  const panel = document.getElementById('scan-filters');
  if (panel) {
    panel.querySelectorAll('[data-scan-filter]').forEach(input => { input.value = ''; });
    panel.querySelectorAll('[data-scan-sector]').forEach(btn => btn.classList.remove('is-active'));
  }
  renderTradingScanTable();
  refreshScanFiltersIndicator();
}

// A stock missing a field a filter checks is excluded, not guessed past --
// showing it would present an unverified match as a real one.
function tradingMatchesScanFilters(r) {
  const f = tradingState.scanFilters;
  if (f.sma150Min !== null && !(typeof r.pct_SMA150 === 'number' && r.pct_SMA150 >= f.sma150Min)) return false;
  if (f.sma150Max !== null && !(typeof r.pct_SMA150 === 'number' && r.pct_SMA150 <= f.sma150Max)) return false;
  if (f.volMin !== null && !(typeof r.volume_ratio === 'number' && r.volume_ratio >= f.volMin)) return false;
  if (f.sectors.length && !f.sectors.includes(r.sector_etf)) return false;
  return true;
}

function tradingScanFiltersHtml(scan) {
  const f = tradingState.scanFilters;
  const sectors = [...new Set(scan.stocks.map(s => s.sector_etf).filter(Boolean))]
    .sort((a, b) => tradingSectorLabel(a).localeCompare(tradingSectorLabel(b)));
  const field = (id, label, val, step, extraAttrs = '') => `
    <label class="sizing-field"><span>${label}</span>
      <input type="number" inputmode="decimal" step="${step}" ${extraAttrs}
        data-scan-filter="${id}" value="${val ?? ''}"></label>`;
  const count = tradingScanActiveFilterCount();
  return `
    <details class="scan-filters" id="scan-filters"${tradingScanFiltersOpen ? ' open' : ''}>
      <summary>
        <span class="sec-label">Filters</span>
        <span class="sec-note mono" id="scan-filters-count">${count ? `${count} active` : 'none active'}</span>
      </summary>
      <p class="sizing-hint">SMA150 distance %, signed -- e.g. 0 to 10 for the eligibility gate</p>
      <div class="sizing-grid">
        ${field('sma150Min', 'Min %', f.sma150Min, '0.1', 'placeholder="e.g. 0"')}
        ${field('sma150Max', 'Max %', f.sma150Max, '0.1', 'placeholder="e.g. 10"')}
        ${field('volMin', 'Min rel. vol ×', f.volMin, '0.1', 'min="0" placeholder="e.g. 1.5"')}
      </div>
      <p class="sizing-hint">Sector</p>
      <div class="pill-row" role="group" aria-label="Sector">
        ${sectors.map(code => `<button type="button" class="pill${f.sectors.includes(code) ? ' is-active' : ''}"
          data-scan-sector="${escapeHtml(code)}">${escapeHtml(tradingSectorLabel(code))}</button>`).join('')}
      </div>
      <div class="scan-filters-actions">
        <button type="button" class="linkbtn" id="scan-filters-clear" ${count ? '' : 'hidden'}>${TRADE_S.fullScan.clearFilters}</button>
      </div>
    </details>`;
}

// Refreshes only the summary's active-count and the Clear button's
// visibility -- never rebuilds the panel itself, which might be mid-edit.
function refreshScanFiltersIndicator() {
  const count = tradingScanActiveFilterCount();
  const note = document.getElementById('scan-filters-count');
  if (note) note.textContent = count ? `${count} active` : 'none active';
  const clearBtn = document.getElementById('scan-filters-clear');
  if (clearBtn) clearBtn.hidden = !count;
}

function wireTradingScanFilters() {
  const panel = document.getElementById('scan-filters');
  if (!panel) return;
  panel.addEventListener('toggle', () => { tradingScanFiltersOpen = panel.open; });

  panel.querySelectorAll('[data-scan-filter]').forEach(input => {
    input.addEventListener('input', () => {
      const n = parseFloat(input.value);
      tradingState.scanFilters[input.dataset.scanFilter] = Number.isFinite(n) ? n : null;
      renderTradingScanTable();
      refreshScanFiltersIndicator();
    });
  });

  panel.querySelectorAll('[data-scan-sector]').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.scanSector;
      const sectors = tradingState.scanFilters.sectors;
      const i = sectors.indexOf(code);
      if (i === -1) sectors.push(code); else sectors.splice(i, 1);
      btn.classList.toggle('is-active');
      renderTradingScanTable();
      refreshScanFiltersIndicator();
    });
  });

  const clearBtn = document.getElementById('scan-filters-clear');
  if (clearBtn) clearBtn.addEventListener('click', tradingClearScanFilters);
}

const TRADING_COLUMNS = [
  { key: 'ticker', cls: 'col-ticker' },
  { key: 'pct_SMA150', cls: 'col-num col-sma' },
  { key: 'price', cls: 'col-num' },
  { key: 'change_pct', cls: 'col-num' },
  { key: 'today_volume', cls: 'col-num col-vol' },
  { key: 'score', cls: 'col-num col-score' },
].map(c => ({ ...c, label: TRADE_S.fullScan.columns[c.key] }));

function renderTradingFullScan() {
  const mount = document.getElementById('panel-fullscan');
  if (!mount) return;
  const scan = tradingState.scan;

  if (!scan || !scan.stocks || !scan.stocks.length) {
    mount.innerHTML = `<div class="empty-state">${TRADE_S.fullScan.empty}</div>`;
    return;
  }

  // The filter panel is built once and left alone after that -- the same
  // reason renderTradingSearch never rebuilds its own <input>: typing into a
  // filter field, or any other repaint this screen gets, must never destroy
  // the node the keystroke landed in.
  if (!document.getElementById('scan-filters')) {
    mount.innerHTML = `
      <div class="sec-label-row">
        <h2 class="sec-label sec-label-gold">${TRADE_S.fullScan.heading}</h2>
        <span class="sec-note mono" id="scan-count"></span>
      </div>
      ${tradingScanFiltersHtml(scan)}
      <div id="scan-table-wrap"></div>`;
    wireTradingScanFilters();
  }

  renderTradingScanTable();
}

// Everything that changes on a sort, search or filter update, and nothing
// else -- so none of those ever touch the filter panel's own controls.
function renderTradingScanTable() {
  const wrap = document.getElementById('scan-table-wrap');
  const scan = tradingState.scan;
  if (!wrap || !scan) return;

  const rows = scan.stocks
    .filter(r => tradingMatchesSearch(r, tradingState.search))
    .filter(tradingMatchesScanFilters)
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

  const countEl = document.getElementById('scan-count');
  if (countEl) countEl.textContent = TRADE_S.fullScan.count(rows.length, scan.stocks.length);

  if (!rows.length) {
    const filtered = tradingScanFiltersActive();
    const searched = !!tradingState.search;
    const q = escapeHtml(tradingState.search);
    const why = searched && filtered
      ? TRADE_S.fullScan.noMatchSearchAndFilters(q)
      : searched
        ? TRADE_S.fullScan.noMatchSearch(q)
        : TRADE_S.fullScan.noMatchFilters;
    wrap.innerHTML = `<div class="empty-state">${why}${
      filtered ? `<div><button type="button" class="linkbtn" id="scan-filters-clear-empty">${TRADE_S.fullScan.clearFilters}</button></div>` : ''}
    </div>`;
    const clearBtn = document.getElementById('scan-filters-clear-empty');
    if (clearBtn) clearBtn.addEventListener('click', tradingClearScanFilters);
    return;
  }

  wrap.innerHTML = `
    <div class="scan-wrap">
      <table class="scan-grid">
        <thead>
          <tr>
            ${TRADING_COLUMNS.map(c => `
              <th class="${c.cls} ${tradingState.sortKey === c.key ? 'is-sorted' : ''}"
                  data-sort="${c.key}" scope="col">
                ${c.label}${tradingState.sortKey === c.key
                  ? `<span class="sort-arrow">${tradingState.sortDir === 'asc' ? TRADE_S.fullScan.sortAsc : TRADE_S.fullScan.sortDesc}</span>` : ''}
              </th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            return `
              <tr class="is-link" data-tv-ticker="${escapeHtml(r.ticker)}"
                  data-tv-exchange="${escapeHtml(r.exchange || '')}">
                <td class="col-ticker"><a ${tradingLinkAttrs(r.ticker, r.exchange)}>${escapeHtml(r.ticker)}</a></td>
                <td class="col-num col-sma mono">${tradingSma150Value(r.pct_SMA150)}</td>
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
  wrap.querySelectorAll('tr[data-tv-ticker]').forEach(tr => {
    tr.addEventListener('click', ev => {
      if (ev.target.closest('a')) return;   // the anchor handles its own click
      window.open(tradingViewUrl(tr.dataset.tvTicker, tr.dataset.tvExchange || null),
        '_blank', 'noopener');
    });
  });

  wrap.querySelectorAll('[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (tradingState.sortKey === key) {
        tradingState.sortDir = tradingState.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        tradingState.sortKey = key;
        // Text reads naturally A-Z; numbers are most useful strongest-first.
        tradingState.sortDir = key === 'ticker' ? 'asc' : 'desc';
      }
      renderTradingScanTable();   // the filter panel stays put -- only the table changed
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
