// Data loading: same-origin fetch of the committed dashboard_data/*.json
// files (synced here by GitHub Actions from the private morning-scout repo).
// No client ever talks to Gmail/CalDAV/IBKR/yfinance directly -- this is a
// pure viewer. Manual refresh only: no polling, no websockets.

const DASHBOARD = {
  FILES: {
    scan: 'dashboard_data/scan.json',
    cciOversold: 'dashboard_data/cci_oversold.json',
    emails: 'dashboard_data/emails.json',
    calendar: 'dashboard_data/calendar.json',
    tasks: 'dashboard_data/tasks.json',
    priority: 'dashboard_data/priority.json',
    tradeNotes: 'dashboard_data/trade_notes.json',
  },

  cache: {},

  async fetchOne(key) {
    const url = `${this.FILES[key]}?t=${Date.now()}`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return null;
      const json = await res.json();
      this.cache[key] = json;
      try { localStorage.setItem(`dash:${key}`, JSON.stringify(json)); } catch (e) { /* storage full/unavailable — non-fatal */ }
      return json;
    } catch (e) {
      // Offline or file genuinely missing -- fall back to last-known-good.
      const stored = localStorage.getItem(`dash:${key}`);
      if (stored) {
        try { return JSON.parse(stored); } catch (parseErr) { return null; }
      }
      return null;
    }
  },

  async fetchAll() {
    const keys = ['scan', 'cciOversold', 'emails', 'calendar', 'tasks', 'priority', 'tradeNotes'];
    const results = await Promise.all(keys.map(k => this.fetchOne(k)));
    return Object.fromEntries(keys.map((k, i) => [k, results[i]]));
  },
};

// ---- Formatting helpers ---------------------------------------------------

function fmtPrice(v) {
  if (v === null || v === undefined) return '—';
  return v.toFixed(2);
}

function fmtChange(v) {
  if (v === null || v === undefined) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

function fmtPct(v, digits = 1) {
  if (v === null || v === undefined) return null;
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

function fmtTime(isoOrHHMM) {
  if (!isoOrHHMM) return '';
  if (/^\d{2}:\d{2}$/.test(isoOrHHMM)) return isoOrHHMM;
  try {
    return new Date(isoOrHHMM).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

function fmtRelative(isoTimestamp) {
  if (!isoTimestamp) return 'never';
  const diffMs = Date.now() - new Date(isoTimestamp).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
