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

const HEALTH_LABELS = {
  scan: 'Nightly scan',
  cci_oversold: 'CCI watchlist',
  breakout_check: 'Breakout checks',
  ibkr: 'IBKR account data',
  reddit: 'Reddit sentiment',
  gmail: 'Gmail triage',
  push: 'Push notifications',
  weekly_briefing: 'Weekly briefing',
  tax_loss_report: 'Tax-loss report',
  alert_performance: 'Alert performance report',
  backup_training: 'Backup · training',
  backup_daily: 'Backup · daily',
  backup_push_subscriptions: 'Backup · push devices',
};

// Plain words for the short codes the workflows send.
const HEALTH_CODES = {
  not_configured: 'not set up',
  token_rejected: 'token rejected',
  server_reset_suspected: 'server looks reset — restore from backup',
  flex_unavailable: 'Flex not responding',
  no_data: 'no data returned',
  fetch_failed: 'fetch failed',
  step_failed: 'run step failed',
  unreachable: 'server unreachable',
  no_devices: 'no devices subscribed',
  send_failed: 'push service rejected every send',
  bad_fallback: 'fallback subscription unreadable',
};

// How often each source is expected to succeed, for the "behind" call.
// Anything not listed shows its state and last success without a judgement.
const HEALTH_MAX_AGE_HOURS = {
  backup_training: 36, backup_daily: 36, backup_push_subscriptions: 36,
  weekly_briefing: 8 * 24, tax_loss_report: 8 * 24, alert_performance: 8 * 24,
};

const HEALTH_SCAN_HOUR_IL = 22;      // the nightly scan's slot, Israel time
const HEALTH_SCAN_GRACE_HOURS = 6;   // GitHub often starts it hours late

function healthFmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
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
    return { label: HEALTH_LABELS.scan, state: 'unknown', note: 'no scan data yet', when: null };
  }
  const have = healthScanSession(scan.generated_at);
  const want = healthExpectedScanSession(now);
  const current = !want || have >= want;
  return {
    label: HEALTH_LABELS.scan,
    state: current ? 'current' : 'behind',
    note: current ? 'current' : `behind — expected the ${want} session`,
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
    return { label, state: 'skipped', note: HEALTH_CODES[r.code] || 'skipped', when: r.last_ok_at };
  }
  if (r.state === 'failing') {
    return { label, state: 'attention', note: `needs attention — ${HEALTH_CODES[r.code] || 'failing'}`, when: r.last_ok_at };
  }
  let behind = false;
  const maxAge = HEALTH_MAX_AGE_HOURS[r.name];
  if (maxAge) behind = !r.last_ok_at || (now - new Date(r.last_ok_at)) > maxAge * 3600e3;
  if (r.name === 'breakout_check') behind = healthBreakoutBehind(r.last_ok_at, now);
  return { label, state: behind ? 'behind' : 'current', note: behind ? 'behind' : 'working', when: r.last_ok_at };
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

const HEALTH_REMOTE_NOTES = {
  'not-deployed': 'Integration details appear once the sync server is updated.',
  rejected: 'The sync server rejected this device’s token.',
  unreachable: 'Sync server unreachable — showing the public part only.',
  error: 'The sync server returned an error.',
};

// Renders into `mount`. The summary line stays one line; the rows sit in a
// <details> so the strip never pushes the page's real content down.
async function renderHealthStrip(mount, scan, now = new Date()) {
  if (!mount) return;
  const scanRow = healthScanRow(scan, now);
  const draw = (remote) => {
    const rows = [scanRow];
    for (const r of remote.records) {
      if (r.name === 'scan' && r.state !== 'failing') continue;   // the public row already says it
      rows.push(healthRecordRow(r, now));
    }
    const attention = rows.filter(r => r.state === 'attention' || r.state === 'behind').length;
    const summary = attention
      ? `${attention} item${attention === 1 ? '' : 's'} need${attention === 1 ? 's' : ''} attention`
      : (scanRow.state === 'current' ? 'data current' : scanRow.note);
    const open = mount.querySelector('details') && mount.querySelector('details').open;
    let tail = '';
    if (remote.status === 'no-sync') {
      tail = renderWithheldZone('Integrations');
    } else if (HEALTH_REMOTE_NOTES[remote.status]) {
      tail = `<p class="health-note">${HEALTH_REMOTE_NOTES[remote.status]}</p>`;
    }
    mount.className = 'health-strip';
    mount.innerHTML = `
      <details${open ? ' open' : ''}>
        <summary>
          <span class="health-title">System</span>
          <span class="health-summary">${escapeHtml(summary)}</span>
          <span class="health-when mono">scan ${escapeHtml(healthFmtWhen(scanRow.when))}</span>
        </summary>
        <ul class="health-rows">${rows.map(healthRowHtml).join('')}</ul>
        ${tail}
      </details>`;
  };
  draw({ status: 'loading', records: [] });
  draw(await healthFetchRecords());
}

if (typeof module !== 'undefined') {
  module.exports = { healthScanRow, healthExpectedScanSession, healthScanSession, healthRecordRow, healthBreakoutBehind };
}
