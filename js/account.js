// "Can I trade today" -- private tier.
//
// The answers are computed off-device by account_status.py (which holds the
// rules) and fetched from the sync server with the owner's own token. A
// device without that token, and the public site, show the usual "local
// only" placeholder instead: account facts never ship with the dashboard.
//
// The one thing computed here is the entry window, because it depends on the
// clock: "no new entries after <cutoff> Israel time", on a US trading day.
// Manual entry (item 21) lives in this device's localStorage only.

const ACCOUNT_KEY = 'jarvis:account:manual';
const ACCOUNT_CUTOFF_FALLBACK = '22:00';

function accountLoadManual() {
  try {
    const v = JSON.parse(localStorage.getItem(ACCOUNT_KEY) || '{}');
    return { positions: v.positions || [], closed_trades: v.closed_trades || [] };
  } catch (e) {
    return { positions: [], closed_trades: [] };
  }
}

function accountSaveManual(v) {
  try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(v)); } catch (e) { /* non-fatal */ }
}

// Inside the entry window? A US trading day, before the cutoff in Israel
// time. Returns {open, reason, cutoff}.
function accountEntryWindow(now, cutoff, calendar) {
  const hhmm = /^\d{2}:\d{2}$/.test(cutoff || '') ? cutoff : ACCOUNT_CUTOFF_FALLBACK;
  const etDay = calendar.parts(now, calendar.ET).ymd;
  if (!calendar.isTradingDay(etDay)) {
    return { open: false, reason: 'US market closed today', cutoff: hhmm };
  }
  const il = calendar.parts(now, calendar.IL);
  const [h, m] = hhmm.split(':').map(Number);
  const past = il.hour * 60 + il.minute >= h * 60 + m;
  return {
    open: !past,
    reason: past ? `after ${hhmm} Israel time` : `until ${hhmm} Israel time`,
    cutoff: hhmm,
  };
}

// The card's lines, in plain non-judgmental language. `status` is the
// server record (or null); `window` comes from accountEntryWindow.
function accountCardLines(status, window, now) {
  if (!status || typeof status.open_positions !== 'number') return null;
  const lines = [];
  const free = Math.max(0, (status.max_positions || 0) - status.open_positions);
  lines.push({
    label: 'Open slots',
    value: `${free} of ${status.max_positions} free`,
    note: status.open_tickers && status.open_tickers.length ? status.open_tickers.join(', ') : '',
  });

  if (status.pause_active && status.pause_until) {
    const until = new Date(status.pause_until);
    const hours = Math.max(0, Math.round((until - now) / 3600e3));
    lines.push({
      label: 'Loss-streak pause',
      value: `on until ${isNaN(until) ? '—' : until.toISOString().slice(0, 16).replace('T', ' ')}Z`,
      note: `${status.consecutive_losses} losses in a row · about ${hours}h left`,
    });
  } else {
    lines.push({ label: 'Loss-streak pause', value: 'not active', note: '' });
  }

  lines.push(status.rest_day
    ? { label: 'Rest day', value: 'yes', note: `${status.stops_this_week} stops this week` }
    : { label: 'Rest day', value: 'no', note: '' });

  lines.push({
    label: 'Entry window',
    value: window.open ? 'open' : 'closed',
    note: window.reason,
  });
  return lines;
}

// Sector overlap between today's candidates and what is already held.
// Public-tier candidates, private-tier positions: the result is only ever
// rendered on a device that already has the private data.
function accountSectorOverlap(candidates, heldSectors) {
  const held = new Set((heldSectors || []).map(s => String(s).toUpperCase()));
  const out = {};
  for (const c of candidates || []) {
    const sector = (c.sector_etf || '').toUpperCase();
    if (sector && held.has(sector)) out[c.ticker] = sector;
  }
  return out;
}

if (typeof module !== 'undefined') {
  module.exports = { accountEntryWindow, accountCardLines, accountSectorOverlap };
}
