// System health strip: when each data source last updated, and whether each
// integration is working, not set up, or needs attention.
//
// Two layers:
//   - Public: the nightly scan's freshness, read from scan.json's own
//     generated_at. Judged against the US market calendar, so a weekend or a
//     market holiday never reads as "behind".
//   - Devices with sync set up: the per-integration records the workflows
//     post to the sync server's /health (see integration_status.py), fetched
//     with the same token the device already uses for daily sync. Without a
//     token those rows show the usual "local only" placeholder.
//
// Everything shown is a name, a state and a time. No error text, paths or
// tokens are ever sent here, by construction on the server side.

// Copy lives in strings.js (a global in the browser, required directly by
// the Node suites that exercise this module's row logic).
const HEALTH_S = (typeof STRINGS !== 'undefined' ? STRINGS : require('./strings.js').STRINGS).health;

const HEALTH_LABELS = HEALTH_S.labels;
const HEALTH_NONE = (typeof STRINGS !== 'undefined' ? STRINGS : require('./strings.js').STRINGS).common.none;

// Plain words for the short codes the workflows send. Each one now says what
// to do where there is something to do -- these lines are the only
// explanation the owner ever gets for a source that stopped reporting.
const HEALTH_CODES = HEALTH_S.codes;

// How often each source is expected to succeed, for the "behind" call.
// Anything not listed shows its state and last success without a judgement.
const HEALTH_MAX_AGE_HOURS = {
  backup_training: 36, backup_daily: 36, backup_push_subscriptions: 36,
  weekly_briefing: 8 * 24, tax_loss_report: 8 * 24, alert_performance: 8 * 24,
};

let healthAuthSummary = null;

const HEALTH_SCAN_HOUR_IL = 22;      // the nightly scan's slot, Israel time
const HEALTH_SCAN_GRACE_HOURS = 6;   // GitHub often starts it hours late

function healthFmtWhen(iso) {
  if (!iso) return HEALTH_NONE;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return HEALTH_NONE;
  return mcFmtIL(d, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// The evening session a scan timestamp belongs to (a run after midnight is
// still last night's), as an Israel-local YYYY-MM-DD.
function healthScanSession(iso) {
  const p = mcParts(new Date(iso), MC_IL);
  return p.hour < HEALTH_SCAN_HOUR_IL ? mcAddDays(p.ymd, -1) : p.ymd;
}

// The most recent US trading day whose nightly scan should have landed by
// `now`. Weekends and market holidays are skipped, so they never read stale.
function healthExpectedScanSession(now) {
  let ymd = mcParts(now, MC_IL).ymd;
  for (let i = 0; i < 12; i += 1) {
    if (mcIsTradingDay(ymd)) {
      const due = new Date(mcZonedInstant(ymd, HEALTH_SCAN_HOUR_IL, 0, MC_IL).getTime()
        + HEALTH_SCAN_GRACE_HOURS * 3600e3);
      if (due <= now) return ymd;
    }
    ymd = mcAddDays(ymd, -1);
  }
  return null;
}

function healthScanRow(scan, now) {
  if (!scan || !scan.generated_at) {
    return { label: HEALTH_LABELS.scan, state: 'unknown', note: HEALTH_S.states.noScanYet, when: null };
  }
  const have = healthScanSession(scan.generated_at);
  const want = healthExpectedScanSession(now);
  const current = !want || have >= want;
  return {
    label: HEALTH_LABELS.scan,
    state: current ? 'current' : 'behind',
    note: current ? HEALTH_S.states.current : HEALTH_S.states.behindSession(want),
    when: scan.generated_at,
  };
}

// Breakout checks run every 30 min in market hours, Monday-Thursday only
// (breakout_alert.py's MARKET_WEEKDAYS). "Behind" only once such a session
// has been open an hour with no successful check since it opened -- a
// Friday, weekend or holiday never counts.
function healthBreakoutBehind(lastOk, now) {
  let s = mcLatestOpenedSession(now);
  for (let i = 0; s && i < 7; i += 1) {
    const dow = new Date(`${s.ymd}T12:00:00Z`).getUTCDay();
    if (dow >= 1 && dow <= 4) break;
    s = mcLatestOpenedSession(new Date(s.open.getTime() - 60e3));
  }
  if (!s) return false;
  if (now - s.open < 3600e3) return false;
  return !lastOk || new Date(lastOk) < s.open;
}

function healthRecordRow(r, now) {
  const label = HEALTH_LABELS[r.name] || r.name;
  if (r.state === 'skipped') {
    return { label, state: 'skipped', note: HEALTH_CODES[r.code] || HEALTH_CODES.skipped, when: r.last_ok_at };
  }
  if (r.state === 'failing') {
    return {
      label, state: 'attention', when: r.last_ok_at,
      note: HEALTH_S.states.needsAttention(HEALTH_CODES[r.code] || HEALTH_CODES.failing),
    };
  }
  let behind = false;
  const maxAge = HEALTH_MAX_AGE_HOURS[r.name];
  if (maxAge) behind = !r.last_ok_at || (now - new Date(r.last_ok_at)) > maxAge * 3600e3;
  if (r.name === 'breakout_check') behind = healthBreakoutBehind(r.last_ok_at, now);
  return {
    label, state: behind ? 'behind' : 'current', when: r.last_ok_at,
    note: behind ? HEALTH_S.states.behind : HEALTH_S.states.working,
  };
}

function healthSyncConfig() {
  try {
    const url = localStorage.getItem('jarvis:daily:syncUrl') || localStorage.getItem('jarvis:training:syncUrl') || '';
    const token = localStorage.getItem('jarvis:daily:syncToken') || localStorage.getItem('jarvis:training:syncToken') || '';
    return { url: url.replace(/\/+$/, ''), token };
  } catch (e) {
    return { url: '', token: '' };
  }
}

// Refused sign-ins on the sync server (private tier, item 31). Counts and a
// spike flag only -- the server stores nothing identifying.
async function healthFetchAuthFailures() {
  const { url, token } = healthSyncConfig();
  if (!url || !token) return null;
  try {
    const resp = await fetch(`${url}/auth-failures`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    });
    if (!resp.ok) return null;
    const body = await resp.json();
    return typeof body.today === 'number' ? body : null;
  } catch (e) {
    return null;
  }
}

function healthAuthRow(summary) {
  if (!summary) return null;
  const quiet = summary.today === 0 && summary.last_7_days === 0;
  return {
    label: HEALTH_S.labels.authFailures,
    state: summary.spike ? 'attention' : quiet ? 'current' : 'behind',
    note: quiet
      ? HEALTH_S.auth.quiet
      : HEALTH_S.auth.counts(summary.today, summary.last_7_days)
        + (summary.spike ? HEALTH_S.auth.spike : ''),
    when: (summary.recent && summary.recent.length) ? summary.recent[summary.recent.length - 1].at : null,
  };
}

async function healthFetchRecords() {
  const { url, token } = healthSyncConfig();
  if (!url || !token) return { status: 'no-sync', records: [] };
  try {
    const resp = await fetch(`${url}/health`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (resp.status === 404) return { status: 'not-deployed', records: [] };
    if (resp.status === 401 || resp.status === 403) return { status: 'rejected', records: [] };
    if (!resp.ok) return { status: 'error', records: [] };
    const body = await resp.json();
    return { status: 'ok', records: Array.isArray(body.records) ? body.records : [] };
  } catch (e) {
    return { status: 'unreachable', records: [] };
  }
}

function healthRowHtml(row) {
  return `<li class="health-row is-${row.state}">
      <span class="health-label">${escapeHtml(row.label)}</span>
      <span class="health-state">${escapeHtml(row.note)}</span>
      <span class="health-when mono">${escapeHtml(healthFmtWhen(row.when))}</span>
    </li>`;
}

const HEALTH_REMOTE_NOTES = HEALTH_S.remote;

// Renders into `mount`. The summary line stays one line; the rows sit in a
// <details> so the strip never pushes the page's real content down.
async function renderHealthStrip(mount, scan, now = new Date()) {
  if (!mount) return;
  const scanRow = healthScanRow(scan, now);
  const draw = (remote) => {
    const rows = [scanRow];
    if (healthAuthSummary) rows.push(healthAuthSummary);
    for (const r of remote.records) {
      if (r.name === 'scan' && r.state !== 'failing') continue;   // the public row already says it
      rows.push(healthRecordRow(r, now));
    }
    const attention = rows.filter(r => r.state === 'attention' || r.state === 'behind').length;
    const summary = attention
      ? HEALTH_S.summary.needAttention(attention)
      : (scanRow.state === 'current' ? HEALTH_S.summary.allCurrent : scanRow.note);
    const open = mount.querySelector('details') && mount.querySelector('details').open;
    let tail = '';
    if (remote.status === 'no-sync') {
      tail = renderWithheldZone(HEALTH_S.withheldLabel);
    } else if (HEALTH_REMOTE_NOTES[remote.status]) {
      tail = `<p class="health-note">${HEALTH_REMOTE_NOTES[remote.status]}</p>`;
    }
    mount.className = 'health-strip';
    mount.innerHTML = `
      <details${open ? ' open' : ''}>
        <summary>
          <span class="health-title">${HEALTH_S.title}</span>
          <span class="health-summary">${escapeHtml(summary)}</span>
          <span class="health-when mono">${escapeHtml(HEALTH_S.summary.lastScan(healthFmtWhen(scanRow.when)))}</span>
        </summary>
        <ul class="health-rows">${rows.map(healthRowHtml).join('')}</ul>
        ${tail}
      </details>`;
  };
  draw({ status: 'loading', records: [] });
  const [remote, auth] = await Promise.all([healthFetchRecords(), healthFetchAuthFailures()]);
  healthAuthSummary = healthAuthRow(auth);
  draw(remote);
}

if (typeof module !== 'undefined') {
  module.exports = { healthScanRow, healthExpectedScanSession, healthScanSession, healthRecordRow, healthBreakoutBehind };
}
