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
      <span class="stock-notes-label">Your note</span>
      <textarea data-notes-ticker="${escapeHtml(ticker)}" placeholder="e.g. watching for pullback to 38…"
                aria-label="Personal note on ${escapeHtml(ticker)}">${escapeHtml(note ? note.text : '')}</textarea>
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
        flash.textContent = 'Saved';
        setTimeout(() => { if (flash.textContent === 'Saved') flash.textContent = ''; }, 2000);
      }
    });
  });
}

// ---- Context panels: email + calendar --------------------------------------

// Read state is a local-only annotation -- this static viewer has no
// write-back path to Gmail (no credentials, no backend), same hard
// constraint as everything else here. Swipe or tap just remembers "I've
// seen this" in this browser; it never touches the actual mailbox.
const EMAIL_READ_KEY = 'jarvis:email:read';

// emails.json items may not carry a stable id -- fall back to a composite
// key so read-state still survives a reload even without one.
function emailReadKey(item) {
  return item.id || `${item.sender || ''}|${item.subject || ''}|${item.received || ''}`;
}

function loadReadEmails() {
  try { return new Set(JSON.parse(localStorage.getItem(EMAIL_READ_KEY) || '[]')); } catch (e) { return new Set(); }
}

function setEmailRead(key, isRead) {
  const set = loadReadEmails();
  if (isRead) set.add(key); else set.delete(key);
  try { localStorage.setItem(EMAIL_READ_KEY, JSON.stringify([...set])); } catch (e) { /* non-fatal */ }
}

function renderEmailRow(item, index) {
  const key = emailReadKey(item);
  const isRead = loadReadEmails().has(key);
  const label = isRead ? 'Mark unread' : 'Mark read';
  return `
    <div class="swipeable" data-swipe-role="email" data-email-key="${escapeHtml(key)}">
      <div class="swipe-reveal is-read">${ICONS.mailRead()}&nbsp;Mark read</div>
      <div class="context-panel swipeable-surface ${isRead ? 'is-read' : ''}" style="--i:${index}" data-email-surface="${escapeHtml(key)}">
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
        <button type="button" class="context-mark-read" data-email-toggle="${escapeHtml(key)}"
                aria-label="${label}" title="${label}">${ICONS.mailRead()}</button>
      </div>
    </div>
  `;
}

// Tap affordance (desktop/non-touch) + swipe (touch, via gestures.js) both
// land here so they stay in sync through one code path.
function wireEmailRows(container) {
  container.querySelectorAll('[data-email-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.emailToggle;
      const surface = container.querySelector(`[data-email-surface="${CSS.escape(key)}"]`);
      if (!surface) return;
      const nowRead = !surface.classList.contains('is-read');
      setEmailRead(key, nowRead);
      surface.classList.toggle('is-read', nowRead);
      const label = nowRead ? 'Mark unread' : 'Mark read';
      btn.setAttribute('aria-label', label);
      btn.title = label;
    });
  });

  if (typeof wireSwipe !== 'function') return; // gestures.js not loaded on this page
  container.querySelectorAll('.swipeable[data-swipe-role="email"]').forEach(el => {
    const key = el.dataset.emailKey;
    const surface = el.querySelector('.swipeable-surface');
    wireSwipe(el, {
      revealClass: 'is-read',
      onSwipe: () => {
        setEmailRead(key, true);
        surface.classList.add('is-read');
        const btn = surface.querySelector('.context-mark-read');
        if (btn) { btn.setAttribute('aria-label', 'Mark unread'); btn.title = 'Mark unread'; }
      },
    });
  });
}

function renderCalendarRow(event, index) {
  return `
    <div class="context-panel" style="--i:${index}">
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

// ---- Jarvis: SMA distance on the stock card --------------------------------

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
// distance-from-SMA150, market cap + 10-day average volume, plus the
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
    <button type="button" class="stock-row ${r.confluence ? 'is-confluence' : ''}" data-ticker="${escapeHtml(r.ticker)}" aria-expanded="false" style="--i:${rank - 1}">
      <span class="stock-rank mono">${rank}</span>
      <span class="stock-ticker">${escapeHtml(r.ticker)}</span>
      <span class="stock-marketcap mono" title="Market cap">${fmtCompactNumber(r.market_cap)}</span>
      <span class="stock-change mono ${changeCls}">${fmtChange(r.change_pct)}</span>
      ${smaDistanceHtml(r)}
      <span class="stock-avgvol mono" title="10-day average volume">${fmtCompactNumber(r.avg_volume_10d)}</span>
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
  // wall of identical apologies -- the "how to see it" hint now appears once
  // in the page footer instead.
  return `<div class="zone-withheld">
    <span class="zone-withheld-lock" aria-hidden="true">🔒</span>
    <span class="zone-withheld-body"><b>${escapeHtml(label)}</b> — local only, not published here.</span>
  </div>`;
}

// A zone whose ciphertext shipped but hasn't been unlocked yet. Distinct
// from renderWithheldZone: the data is right there on the page, just
// unreadable without the password entered in the unlock banner above.
function renderLockedZone(label) {
  return `<div class="zone-withheld zone-locked">
    <span class="zone-withheld-lock" aria-hidden="true">🔒</span>
    <span class="zone-withheld-body"><b>${escapeHtml(label)}</b> — locked. Enter your password above to view.</span>
  </div>`;
}

// Footer shown once on a public build, explaining the page's scope.
// withheldCount: zones that never ship here (priorities, trade notes) --
// run the local build to see them. lockedCount: zones that DID ship, just
// encrypted (email/tasks/calendar) -- the unlock banner above handles those,
// so they get a different sentence rather than "stay on your machine".
function renderPublicScopeNote(withheldCount, lockedCount) {
  const parts = [];
  if (lockedCount) {
    parts.push(`${lockedCount} zone${lockedCount === 1 ? '' : 's'} above ${lockedCount === 1 ? 'is' : 'are'}
      password-locked — enter your password once to unlock them on this device.`);
  }
  if (withheldCount) {
    parts.push(`${withheldCount} zone${withheldCount === 1 ? '' : 's'} (priorities, trade notes)
      stay on your machine — run <code>python build_pwa.py --serve</code> to see them.`);
  }
  if (!parts.length) return '';
  return `<p class="public-scope-note">${parts.join(' ')}</p>`;
}

// A zone whose data loaded but is empty. Different fact, different message:
// this one really is "nothing today".
function renderEmptyZone(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}
