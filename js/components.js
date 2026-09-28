// Row-level renderers shared between index.html (Zone A cards) and
// scan.html (full table). Pure functions over already-computed fields --
// nothing here recomputes score/confluence/signals, it only formats them.

const CARD_S = STRINGS.stockCard;

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
  return isRecurring ? `<span class="recurring-chip" title="${CARD_S.recurring}">${ICONS.recurring()}</span>` : '';
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
  const D = CARD_S.detail;
  const none = STRINGS.common.none;
  const na = STRINGS.common.notApplicable;
  const rows = [
    [D.sma150, r.pct_SMA150 !== null && r.pct_SMA150 !== undefined ? CARD_S.fromSma(fmtPct(r.pct_SMA150)) : none],
    [D.sma200, r.pct_SMA200 !== null && r.pct_SMA200 !== undefined ? CARD_S.fromSma(fmtPct(r.pct_SMA200)) : none],
    [D.cci, r.cci !== null && r.cci !== undefined ? Math.round(r.cci) : none],
    [D.volumeRatio, CARD_S.timesAverage(r.volume_ratio.toFixed(2))],
    [D.shortInterest, r.short_pct !== null && r.short_pct !== undefined ? `${r.short_pct.toFixed(1)}%` : na],
    [D.redditMentions, `${r.reddit_mentions || 0}${r.reddit_bullish_mentions ? CARD_S.bullish(r.reddit_bullish_mentions) : ''}`],
    [D.sector, `${r.sector_etf || na}${r.sector_strong ? CARD_S.strongSector : ''}`],
    [D.baseLength, CARD_S.days(r.base_length_days || 0)],
    [D.failedBreakouts, r.failed_attempts_90d ?? 0],
    [D.earnings, r.earnings_days !== null && r.earnings_days !== undefined ? CARD_S.earningsIn(r.earnings_days) : na],
    [D.signals, (r.signals_present || []).join(', ') || CARD_S.noSignals],
  ];
  return `<dl class="stock-detail">
    ${rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}
  </dl>`;
}

// Toggles the `.is-open` class rather than `hidden` -- the mount uses a
// grid-template-rows 0fr/1fr transition (styles.css) so the expand/collapse
// animates, which a `hidden` (display:none) toggle can't do smoothly.
function wireStockCardExpansion(container) {
  container.querySelectorAll('.stock-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const ticker = btn.dataset.ticker;
      const mount = container.querySelector(`[data-ticker-detail="${CSS.escape(ticker)}"]`);
      if (!mount) return;
      const nowOpen = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(nowOpen));
      mount.classList.toggle('is-open', nowOpen);
      mount.setAttribute('aria-hidden', String(!nowOpen));
    });
  });
  wireStockNotes(container);
}

// ---- Per-stock notes --------------------------------------------------
// Public/plaintext tier (same as scan.json/training.json, per the user's
// explicit choice) -- pure localStorage, no dashboard_data file, no
// unlock-password gating. Same read/write helper shape as tasks.js's
// loadJson/saveJson.
const STOCK_NOTES_KEY = 'jarvis:stockNotes';

function loadStockNotes() {
  try { return JSON.parse(localStorage.getItem(STOCK_NOTES_KEY) || '{}'); } catch (e) { return {}; }
}

function saveStockNote(ticker, text) {
  const notes = loadStockNotes();
  if (text) {
    notes[ticker] = { text, updatedAt: new Date().toISOString() };
  } else {
    delete notes[ticker]; // empty note is the same as no note
  }
  try { localStorage.setItem(STOCK_NOTES_KEY, JSON.stringify(notes)); } catch (e) { /* non-fatal */ }
}

function stockNotesHtml(ticker) {
  const note = loadStockNotes()[ticker];
  return `
    <div class="stock-notes">
      <span class="stock-notes-label">${CARD_S.noteLabel}</span>
      <textarea data-notes-ticker="${escapeHtml(ticker)}" placeholder="${CARD_S.notePlaceholder}"
                aria-label="${escapeHtml(CARD_S.noteFor(ticker))}">${escapeHtml(note ? note.text : '')}</textarea>
      <div class="stock-notes-saved" data-notes-saved="${escapeHtml(ticker)}"></div>
    </div>`;
}

// Autosave on blur, same UX as tasks.js's bubble-label inline edit -- no
// explicit save button, with a brief "Saved" flash confirming the write.
function wireStockNotes(container) {
  container.querySelectorAll('[data-notes-ticker]').forEach(textarea => {
    textarea.addEventListener('blur', () => {
      const ticker = textarea.dataset.notesTicker;
      saveStockNote(ticker, textarea.value.trim());
      const flash = container.querySelector(`[data-notes-saved="${CSS.escape(ticker)}"]`);
      if (flash) {
        flash.textContent = STRINGS.common.saved;
        setTimeout(() => { if (flash.textContent === STRINGS.common.saved) flash.textContent = ''; }, 2000);
      }
    });
  });
}

// ---- Context panels: email + calendar (removed) ----------------------------
//
// The Email and Calendar zones were taken out of the app. Their renderers
// stayed behind here with no caller, so their copy -- "Mark read",
// "Deadline:", "All day" -- kept shipping to the public site describing
// features that no longer exist. Removed with the copy pass, 2026-09-24.
// Nothing on either page called renderEmailRow, wireEmailRows,
// renderCalendarRow or renderPriorityItem.

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
      <td class="mono">${r.cci !== null && r.cci !== undefined ? Math.round(r.cci) : STRINGS.common.none}</td>
      <td class="mono">${r.volume_ratio.toFixed(2)}x</td>
      <td class="mono">${r.pct_SMA150 !== null && r.pct_SMA150 !== undefined ? fmtPct(r.pct_SMA150) : STRINGS.common.none}</td>
      <td class="mono">${escapeHtml(r.sector_etf || STRINGS.common.none)}</td>
      <td>${glyphsForStock(r)}${recurringChipHtml(isRecurring)}</td>
    </tr>
    <tr class="detail-row" data-detail-index="${index}" hidden>
      <td colspan="9">${renderStockDetail(r)}</td>
    </tr>
  `;
}

// ---- Jarvis: SMA distance on the stock card --------------------------------

function smaDistanceHtml(r) {
  const pct = r.pct_from_sma150 !== undefined && r.pct_from_sma150 !== null
    ? r.pct_from_sma150
    : r.pct_SMA150;
  if (pct === null || pct === undefined) return '';
  // in_reclaim_band is computed server-side; highlighting it here is the
  // visual cue for "this is actually actionable right now".
  const cls = r.in_reclaim_band ? 'stock-sma-dist in-band' : 'stock-sma-dist';
  return `<span class="${cls} mono" title="${CARD_S.smaDistance}">${fmtPct(pct)} ${CARD_S.detail.sma150}</span>`;
}

// Card used by the Jarvis Today page: adds the spec's required
// distance-from-SMA150, market cap + 10-day average volume, plus the
// position's own exit thesis when one exists.
function renderJarvisStockCard(r, rank, recurringSet, noteByTicker) {
  const changeCls = r.change_pct >= 0 ? 'gain' : 'loss';
  const isRecurring = recurringSet && recurringSet.has(r.ticker);
  const note = noteByTicker ? noteByTicker[r.ticker] : null;

  const thesis = note && note.thesis
    ? `<div class="exit-thesis ${note.moved_against ? 'is-against' : ''}">
         <span class="exit-thesis-label">${note.moved_against
           ? CARD_S.exitThesisAgainst(fmtPct(note.unrealized_pct))
           : CARD_S.exitThesis}</span>
         ${escapeHtml(note.thesis)}
       </div>`
    : '';

  return `
    <button type="button" class="stock-row ${r.confluence ? 'is-confluence' : ''}" data-ticker="${escapeHtml(r.ticker)}" aria-expanded="false" style="--i:${rank - 1}">
      <span class="stock-rank mono">${rank}</span>
      <span class="stock-ticker">${escapeHtml(r.ticker)}</span>
      <span class="stock-marketcap mono" title="${CARD_S.marketCap}">${fmtCompactNumber(r.market_cap)}</span>
      <span class="stock-change mono ${changeCls}">${fmtChange(r.change_pct)}</span>
      ${smaDistanceHtml(r)}
      <span class="stock-avgvol mono" title="${CARD_S.avgVolume}">${fmtCompactNumber(r.avg_volume_10d)}</span>
      <span class="stock-spacer"></span>
      <span class="stock-badges">
        ${recurringChipHtml(isRecurring)}
        ${scoreBadgeHtml(r)}
      </span>
    </button>
    ${thesis}
    <div class="stock-detail-mount" data-ticker-detail="${escapeHtml(r.ticker)}" aria-hidden="true">
      <div class="stock-detail-panel">
        ${renderStockDetail(r)}
        ${stockNotesHtml(r.ticker)}
      </div>
    </div>
  `;
}

// A zone whose data file is absent renders this instead of vanishing.
// Vanishing is indistinguishable from a broken page -- the user reported
// exactly that -- so the zone stays, states plainly that it isn't published
// here, and says where the full version is.
function renderWithheldZone(label) {
  // One compact line. This renders once per withheld zone, so the full
  // two-line explanation repeated four times turned the public page into a
  // wall of identical apologies.
  return `<div class="zone-withheld">
    <span class="zone-withheld-lock" aria-hidden="true">🔒</span>
    <span class="zone-withheld-body">${escapeHtml(STRINGS.privacy.localOnly(label))}</span>
  </div>`;
}

// The password-locked zone and the public-scope footer that explained it
// were removed with the copy pass (2026-09-24). Since Phase 7 no encrypted
// zone ships at all, so "enter your password above to view" and "N zones are
// password-locked" described an unlock banner the app no longer has. Neither
// function had a caller on either page.

// A zone whose data loaded but is empty. Different fact, different message:
// this one really is "nothing today".
function renderEmptyZone(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}
