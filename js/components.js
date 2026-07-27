// Row-level renderers shared between index.html (Zone A cards) and
// scan.html (full table). Pure functions over already-computed fields --
// nothing here recomputes score/confluence/signals, it only formats them.

function glyphsForStock(r) {
  const glyphs = [];
  if (r.cci_rising) glyphs.push(ICONS.momentumUp());
  if (r.hot_volume) glyphs.push(ICONS.volumeSurge());
  if (r.crossed_recently) glyphs.push(ICONS.maCross());
  if (r.earnings_days !== null && r.earnings_days !== undefined && r.earnings_days <= 14) {
    glyphs.push(ICONS.earningsSoon());
  }
  return glyphs.join('');
}

function scoreBadgeHtml(r) {
  const cls = r.confluence ? 'score-badge is-confluence' : 'score-badge';
  const star = r.confluence ? ICONS.confluenceStar() : '';
  return `<span class="${cls}">${star}<span>${Math.round(r.score)}</span></span>`;
}

function recurringChipHtml(isRecurring) {
  return isRecurring ? `<span class="recurring-chip" title="Flagged multiple days this week">${ICONS.recurring()}</span>` : '';
}

// ---- Zone A / card-style stock row ----------------------------------------

function renderStockCard(r, rank, recurringSet) {
  const changeCls = r.change_pct >= 0 ? 'gain' : 'loss';
  const isRecurring = recurringSet && recurringSet.has(r.ticker);
  return `
    <button type="button" class="stock-row ${r.confluence ? 'is-confluence' : ''}" data-ticker="${escapeHtml(r.ticker)}" aria-expanded="false">
      <span class="stock-rank mono">${rank}</span>
      <span class="stock-ticker">${escapeHtml(r.ticker)}</span>
      <span class="stock-price mono">${fmtPrice(r.price)}</span>
      <span class="stock-change mono ${changeCls}">${fmtChange(r.change_pct)}</span>
      <span class="stock-glyphs">${glyphsForStock(r)}</span>
      <span class="stock-spacer"></span>
      <span class="stock-badges">
        ${recurringChipHtml(isRecurring)}
        ${scoreBadgeHtml(r)}
      </span>
    </button>
    <div class="stock-detail-mount" data-ticker-detail="${escapeHtml(r.ticker)}" hidden></div>
  `;
}

function renderStockDetail(r) {
  const rows = [
    ['SMA150', r.pct_SMA150 !== null && r.pct_SMA150 !== undefined ? `${fmtPct(r.pct_SMA150)} from` : '—'],
    ['SMA200', r.pct_SMA200 !== null && r.pct_SMA200 !== undefined ? `${fmtPct(r.pct_SMA200)} from` : '—'],
    ['CCI(20)', r.cci !== null && r.cci !== undefined ? Math.round(r.cci) : '—'],
    ['Volume ratio', `${r.volume_ratio.toFixed(2)}x avg`],
    ['Short interest', r.short_pct !== null && r.short_pct !== undefined ? `${r.short_pct.toFixed(1)}%` : 'n/a'],
    ['Reddit mentions', `${r.reddit_mentions || 0}${r.reddit_bullish_mentions ? ` (${r.reddit_bullish_mentions} bullish)` : ''}`],
    ['Sector', `${r.sector_etf || 'n/a'}${r.sector_strong ? ' — strong' : ''}`],
    ['Base length', `${r.base_length_days || 0}d`],
    ['Failed breakouts (90d)', r.failed_attempts_90d ?? 0],
    ['Earnings', r.earnings_days !== null && r.earnings_days !== undefined ? `in ${r.earnings_days}d` : 'n/a'],
    ['Signals', (r.signals_present || []).join(', ') || 'none'],
  ];
  return `<dl class="stock-detail">
    ${rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}
  </dl>`;
}

function wireStockCardExpansion(container) {
  container.querySelectorAll('.stock-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const ticker = btn.dataset.ticker;
      const mount = container.querySelector(`[data-ticker-detail="${CSS.escape(ticker)}"]`);
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      mount.hidden = expanded;
    });
  });
}

// ---- Context panels: email + calendar --------------------------------------

function renderEmailRow(item) {
  return `
    <div class="context-panel">
      <span class="priority-dot ${item.priority}"></span>
      <div class="context-body">
        <div class="context-row-top">
          <span class="context-sender">${escapeHtml(item.sender)}</span>
          <span class="context-time">${fmtTime(item.received)}</span>
        </div>
        <div class="context-subject">${escapeHtml(item.subject)}</div>
        ${item.preview ? `<div class="context-preview">${escapeHtml(item.preview)}</div>` : ''}
        ${item.deadline ? `<div class="context-deadline">Deadline: ${escapeHtml(item.deadline)}</div>` : ''}
      </div>
    </div>
  `;
}

function renderCalendarRow(event) {
  return `
    <div class="context-panel">
      <span class="calendar-time mono">${event.all_day ? 'All day' : (event.time || '')}</span>
      <span class="calendar-title">${escapeHtml(event.title)}</span>
    </div>
  `;
}

// ---- Full Scan table row ----------------------------------------------------

function renderTableRow(r, recurringSet, index) {
  const changeCls = r.change_pct >= 0 ? 'gain' : 'loss';
  const isRecurring = recurringSet && recurringSet.has(r.ticker);
  return `
    <tr class="${r.confluence ? 'is-confluence' : ''}" data-row-index="${index}" tabindex="0">
      <td class="mono">${scoreBadgeHtml(r)}</td>
      <td class="mono">${escapeHtml(r.ticker)}</td>
      <td class="mono">${fmtPrice(r.price)}</td>
      <td class="mono ${changeCls}">${fmtChange(r.change_pct)}</td>
      <td class="mono">${r.cci !== null && r.cci !== undefined ? Math.round(r.cci) : '—'}</td>
      <td class="mono">${r.volume_ratio.toFixed(2)}x</td>
      <td class="mono">${r.pct_SMA150 !== null && r.pct_SMA150 !== undefined ? fmtPct(r.pct_SMA150) : '—'}</td>
      <td class="mono">${escapeHtml(r.sector_etf || '—')}</td>
      <td>${glyphsForStock(r)}${recurringChipHtml(isRecurring)}</td>
    </tr>
    <tr class="detail-row" data-detail-index="${index}" hidden>
      <td colspan="9">${renderStockDetail(r)}</td>
    </tr>
  `;
}

// ---- Jarvis: silence-budget priority strip ---------------------------------

function renderPriorityItem(item) {
  return `
    <div class="priority-item" data-domain="${escapeHtml(item.domain)}">
      <span class="priority-domain">${escapeHtml(item.domain)}</span>
      <div class="priority-body">
        <div class="priority-title">${escapeHtml(item.title)}</div>
        ${item.detail ? `<div class="priority-detail">${escapeHtml(item.detail)}</div>` : ''}
        ${item.action ? `<div class="priority-action">${escapeHtml(item.action)}</div>` : ''}
      </div>
    </div>`;
}

// ---- Jarvis: setup tag + SMA distance on the stock card --------------------

function setupTagHtml(r) {
  const tag = r.setup_tag;
  if (!tag) return '';
  const isReclaim = tag === 'Zone Reclaim';
  return `<span class="setup-tag ${isReclaim ? 'is-reclaim' : 'is-fresh'}">${escapeHtml(tag)}</span>`;
}

function smaDistanceHtml(r) {
  const pct = r.pct_from_sma150 !== undefined && r.pct_from_sma150 !== null
    ? r.pct_from_sma150
    : r.pct_SMA150;
  if (pct === null || pct === undefined) return '';
  // in_reclaim_band is computed server-side; highlighting it here is the
  // visual cue for "this is actually actionable right now".
  const cls = r.in_reclaim_band ? 'stock-sma-dist in-band' : 'stock-sma-dist';
  return `<span class="${cls} mono" title="Distance from SMA150">${fmtPct(pct)} SMA150</span>`;
}

// Card used by the Jarvis Today page: adds the spec's required
// distance-from-SMA150 and Zone Reclaim / Fresh Breakout tag, plus the
// position's own exit thesis when one exists.
function renderJarvisStockCard(r, rank, recurringSet, noteByTicker) {
  const changeCls = r.change_pct >= 0 ? 'gain' : 'loss';
  const isRecurring = recurringSet && recurringSet.has(r.ticker);
  const note = noteByTicker ? noteByTicker[r.ticker] : null;

  const thesis = note && note.thesis
    ? `<div class="exit-thesis ${note.moved_against ? 'is-against' : ''}">
         <span class="exit-thesis-label">${note.moved_against
           ? `Your exit thesis — ${fmtPct(note.unrealized_pct)} against you`
           : 'Your exit thesis'}</span>
         ${escapeHtml(note.thesis)}
       </div>`
    : '';

  return `
    <button type="button" class="stock-row ${r.confluence ? 'is-confluence' : ''}" data-ticker="${escapeHtml(r.ticker)}" aria-expanded="false">
      <span class="stock-rank mono">${rank}</span>
      <span class="stock-ticker">${escapeHtml(r.ticker)}</span>
      <span class="stock-price mono">${fmtPrice(r.price)}</span>
      <span class="stock-change mono ${changeCls}">${fmtChange(r.change_pct)}</span>
      ${smaDistanceHtml(r)}
      ${setupTagHtml(r)}
      <span class="stock-spacer"></span>
      <span class="stock-badges">
        ${recurringChipHtml(isRecurring)}
        ${scoreBadgeHtml(r)}
      </span>
    </button>
    ${thesis}
    <div class="stock-detail-mount" data-ticker-detail="${escapeHtml(r.ticker)}" hidden></div>
  `;
}

// A zone whose data file is absent renders this instead of vanishing.
// Vanishing is indistinguishable from a broken page -- the user reported
// exactly that -- so the zone stays, states plainly that it isn't published
// here, and says where the full version is.
function renderWithheldZone(label) {
  return `<div class="zone-withheld">
    <span class="zone-withheld-title">Not published to the public dashboard</span>
    <span class="zone-withheld-body">${escapeHtml(label)} — local only.
      Run <code>python build_pwa.py --serve</code> for the full view.</span>
  </div>`;
}

// A zone whose data loaded but is empty. Different fact, different message:
// this one really is "nothing today".
function renderEmptyZone(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}
