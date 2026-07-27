// Jarvis — Page 1 "Today".
//
// Layout, top to bottom:
//   Priority strip   the silence budget: at most 3 items, ranked across all
//                    three domains by priority_engine.py. Not a fourth feed --
//                    it's the filter that stops the feeds competing for attention.
//   Zone A Trading   top 10 from the nightly scan, with the spec's required
//                    distance-from-SMA150 and Zone Reclaim / Fresh Breakout tag,
//                    plus the position's own exit thesis where one exists.
//   Zone B Email     important/flagged only, classified by the Gmail feed.
//   Zone C Tasks     quick-add + tappable sub-task bubbles.
//   Zone D Calendar  kept below the spec's three zones rather than removed --
//                    it's existing working functionality the spec didn't ask
//                    to drop.
//
// No zone ever vanishes. Each renders one of three states, because they mean
// different things and a blank page is indistinguishable from a broken one:
//   withheld  the data file isn't in this build (public dashboard) -> say so
//   empty     the feed ran and found nothing -> "nothing today"
//   populated the normal case

renderNav('today');
renderTopbar('app-header', 'Today');

function renderMarketHeader(scan, cciOversold) {
  const mount = document.getElementById('market-header');
  if (!mount) return;
  if (!scan) { mount.innerHTML = ''; return; }
  const m = scan.market || {};
  const oversoldCount = cciOversold ? (cciOversold.watchlist || []).length : null;
  mount.innerHTML = `
    <span class="regime-pill" data-regime="${escapeHtml(m.regime || 'NEUTRAL')}">${escapeHtml(m.regime || 'NEUTRAL')}</span>
    <div class="stat-strip">
      <span>Scanned <b>${scan.scanned_count ?? '—'}</b>/${scan.total_tickers ?? '—'}</span>
      <span>Signals <b>${scan.signal_count ?? '—'}</b></span>
      ${scan.reclaim_count !== undefined ? `<span>Reclaims <b>${scan.reclaim_count}</b></span>` : ''}
      ${oversoldCount !== null ? `<span>Oversold <a href="scan.html#oversold"><b>${oversoldCount}</b></a></span>` : ''}
    </div>
  `;
}

function renderPriorityStrip(priority) {
  const section = document.getElementById('zone-priority');
  const mount = document.getElementById('priority-list');
  if (!section || !mount) return;

  // Three distinct states, three distinct messages. Claiming "nothing needs
  // you" from a file this build never had would be asserting something the
  // page has no way to know.
  if (!priority) {
    section.hidden = false;
    mount.innerHTML = renderWithheldZone('Your cross-domain priorities');
    return;
  }

  const items = priority.items || [];
  section.hidden = false;

  if (items.length === 0) {
    // A quiet day IS a real result here: the feed ran and ranked nothing above
    // the threshold. That's the cap working, not a failure state.
    mount.innerHTML = `<div class="priority-quiet">Nothing needs you right now.</div>`;
    return;
  }
  mount.innerHTML = `<div class="priority-strip">${items.map(renderPriorityItem).join('')}</div>`;
}

function noteIndex(tradeNotes) {
  const map = {};
  ((tradeNotes && tradeNotes.positions) || []).forEach(p => { map[p.ticker] = p; });
  return map;
}

function renderZoneTrading(scan, tradeNotes) {
  const listMount = document.getElementById('top10-list');
  if (!listMount) return;

  if (!scan || !scan.stocks || scan.stocks.length === 0) {
    listMount.innerHTML = `<div class="empty-state">No scan data yet. Run scout.py, or check back after the next scheduled scan.</div>`;
    return;
  }

  const recurringSet = new Set(scan.recurring_tickers || []);
  const notes = noteIndex(tradeNotes);
  const byTicker = Object.fromEntries(scan.stocks.map(s => [s.ticker, s]));

  // Prefer the server-side ranking (which puts zone reclaims first); fall
  // back to score order only if an older scan.json has no top10 key.
  const ordered = (scan.top10 && scan.top10.length)
    ? scan.top10.map(t => byTicker[t]).filter(Boolean)
    : [...scan.stocks].sort((a, b) => b.score - a.score).slice(0, 10);

  listMount.innerHTML = `<div class="stock-list">${
    ordered.map((r, i) => renderJarvisStockCard(r, i + 1, recurringSet, notes)).join('')
  }</div>`;
  wireStockCardExpansion(listMount);
}

function renderZoneEmail(emails) {
  const section = document.getElementById('zone-email');
  const mount = document.getElementById('emails-list');
  if (!section || !mount) return;
  section.hidden = false;

  if (DASHBOARD.locked.has('emails')) {
    mount.innerHTML = renderLockedZone('Important email');
    return;
  }
  if (!emails) {
    mount.innerHTML = DASHBOARD.isWithheld('emails')
      ? renderWithheldZone('Important email')
      : renderEmptyZone('Email feed not set up yet — see README_SETUP.md.');
    return;
  }
  const items = emails.items || [];
  mount.innerHTML = items.length
    ? items.map(renderEmailRow).join('')
    : renderEmptyZone('No important email today.');
}

function renderZoneCalendar(calendar) {
  const section = document.getElementById('zone-calendar');
  const mount = document.getElementById('calendar-list');
  if (!section || !mount) return;
  section.hidden = false;

  if (DASHBOARD.locked.has('calendar')) {
    mount.innerHTML = renderLockedZone("Today's calendar");
    return;
  }
  if (!calendar) {
    mount.innerHTML = DASHBOARD.isWithheld('calendar')
      ? renderWithheldZone("Today's calendar")
      : renderEmptyZone('Calendar feed not set up yet — see README_SETUP.md.');
    return;
  }
  const events = calendar.events || [];
  mount.innerHTML = events.length
    ? events.map(renderCalendarRow).join('')
    : renderEmptyZone('Nothing scheduled today.');
}

function renderScopeNote() {
  const mount = document.getElementById('scope-note');
  if (!mount) return;
  const lockedCount = document.querySelectorAll('.zone-locked').length;
  const withheldCount = document.querySelectorAll('.zone-withheld').length - lockedCount;
  mount.innerHTML = renderPublicScopeNote(withheldCount, lockedCount);
}

// One shared prompt unlocks all 3 encrypted zones at once -- they're all
// encrypted with the same password, so a per-zone prompt would just mean
// typing it three times. Sits above "Needs you now" so it's the first thing
// visible on a locked page.
function renderUnlockBanner() {
  let mount = document.getElementById('zone-unlock');
  if (!DASHBOARD.locked.size) {
    if (mount) mount.remove();
    return;
  }
  if (!mount) {
    mount = document.createElement('section');
    mount.className = 'zone';
    mount.id = 'zone-unlock';
    document.getElementById('zone-priority').before(mount);
  }
  mount.innerHTML = `
    <form id="unlock-form" class="unlock-form" autocomplete="off">
      <span class="zone-withheld-lock" aria-hidden="true">🔒</span>
      <span class="unlock-label">Email, tasks and calendar are locked on this device.</span>
      <input type="password" id="unlock-password" placeholder="Password" autocomplete="current-password" required>
      <button type="submit">Unlock</button>
      <label class="unlock-remember">
        <input type="checkbox" id="unlock-remember" checked> Remember on this device
      </label>
      <span id="unlock-error" class="unlock-error" hidden>Wrong password — try again.</span>
    </form>`;
  document.getElementById('unlock-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pwInput = document.getElementById('unlock-password');
    const password = pwInput.value;
    const remember = document.getElementById('unlock-remember').checked;
    const ok = await DASHBOARD.unlockAll(password);
    if (!ok) {
      document.getElementById('unlock-error').hidden = false;
      pwInput.value = '';
      pwInput.focus();
      return;
    }
    if (remember) {
      try { localStorage.setItem(ZONE_PASSWORD_KEY, password); } catch (e) { /* non-fatal */ }
    }
    loadAndRender();
  });
}

async function loadAndRender() {
  const d = await DASHBOARD.fetchAll();
  renderMarketHeader(d.scan, d.cciOversold);
  renderUnlockBanner();
  renderPriorityStrip(d.priority);
  renderZoneTrading(d.scan, d.tradeNotes);
  renderZoneEmail(d.emails);
  renderTaskZone(d.tasks);
  renderZoneCalendar(d.calendar);
  renderScopeNote();
  updateLastUpdated(d.scan ? d.scan.generated_at : null);
}

wireRefreshButton(loadAndRender);
loadAndRender();
