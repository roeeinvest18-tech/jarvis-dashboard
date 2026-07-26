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
// Any zone with no data hides itself. The trading zone is the exception: it's
// the page's primary content, so it shows an empty state instead of vanishing.

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

  const items = (priority && priority.items) || [];
  section.hidden = false;

  if (items.length === 0) {
    // A quiet day is a real result, not a failure state -- the whole point of
    // the cap is that it's allowed to show nothing.
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
  if (!section) return;
  const items = (emails && emails.items) || [];
  if (items.length === 0) { section.hidden = true; return; }
  section.hidden = false;
  document.getElementById('emails-list').innerHTML = items.map(renderEmailRow).join('');
}

function renderZoneCalendar(calendar) {
  const section = document.getElementById('zone-calendar');
  if (!section) return;
  const events = (calendar && calendar.events) || [];
  if (events.length === 0) { section.hidden = true; return; }
  section.hidden = false;
  document.getElementById('calendar-list').innerHTML = events.map(renderCalendarRow).join('');
}

async function loadAndRender() {
  const d = await DASHBOARD.fetchAll();
  renderMarketHeader(d.scan, d.cciOversold);
  renderPriorityStrip(d.priority);
  renderZoneTrading(d.scan, d.tradeNotes);
  renderZoneEmail(d.emails);
  renderTaskZone(d.tasks);
  renderZoneCalendar(d.calendar);
  updateLastUpdated(d.scan ? d.scan.generated_at : null);
}

wireRefreshButton(loadAndRender);
loadAndRender();
