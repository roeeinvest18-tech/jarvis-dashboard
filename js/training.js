// Training zone: strength routine logged 3x/week (Sun/Tue/Thu).
//
// Persistence model, same reasoning as tasks.js: the PWA is a static viewer
// with no backend, so a submitted session can't write back to the repo.
// Every logged session, and every correction to a past one, lives in
// localStorage and is overlaid on whatever dashboard_data/training.json
// ships (an empty seed today -- nothing writes it server-side yet, but
// fetching it the same way as every other zone means a future export
// script could seed real history later without a frontend change).

const TRAINING_DRILLS = [
  { id: 'pull_ups', label: 'Pull ups' },
  { id: 'push_ups', label: 'Push ups' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'chin_ups', label: 'Chin ups' },
  { id: 'triceps_extension', label: 'Triceps extension' },
];

// Sun/Tue/Thu, matching JS Date#getDay() (0 = Sunday).
const TRAINING_SCHEDULE_DAYS = [0, 2, 4];

const TRAINING_CAPTURED_KEY = 'jarvis:training:captured';
// Corrections to a past session, keyed by session id -> { drillId: [reps...] }.
// Only the drills actually corrected are present; everything else in the
// session is left as originally logged.
const TRAINING_EDITS_KEY = 'jarvis:training:edits';
// Tombstone of deleted session ids, same pattern as tasks.js's
// jarvis:tasks:deletedTasks -- the underlying session (server-synced or
// local-only) is never mutated in place, just filtered out everywhere it's
// read from, so a delete can never resurrect a stale edit or re-appear from
// a captured-list entry that predates the delete.
const TRAINING_DELETED_KEY = 'jarvis:training:deleted';

// Cross-device sync (2026-08-10): logging on one device used to be
// invisible on another -- there was no server write path at all, just
// localStorage. Now, if a sync URL+token are configured, captured
// sessions/edits get pushed to a small Flask endpoint on the always-on
// Railway app (webhook_server.py's /training route, backed by
// training_store.py) and merged with whatever other devices already pushed.
// Still offline-first: local writes happen immediately and render right
// away; sync is a best-effort background reconciliation, never a blocker.
const TRAINING_SYNC_URL_KEY = 'jarvis:training:syncUrl';
const TRAINING_SYNC_TOKEN_KEY = 'jarvis:training:syncToken';

function trainingSyncConfig() {
  try {
    return {
      url: (localStorage.getItem(TRAINING_SYNC_URL_KEY) || '').replace(/\/+$/, ''),
      token: localStorage.getItem(TRAINING_SYNC_TOKEN_KEY) || '',
    };
  } catch (e) {
    return { url: '', token: '' };
  }
}

function saveTrainingSyncConfig(url, token) {
  try {
    localStorage.setItem(TRAINING_SYNC_URL_KEY, url.replace(/\/+$/, ''));
    localStorage.setItem(TRAINING_SYNC_TOKEN_KEY, token);
  } catch (e) { /* non-fatal */ }
}

function clearTrainingSyncConfig() {
  try {
    localStorage.removeItem(TRAINING_SYNC_URL_KEY);
    localStorage.removeItem(TRAINING_SYNC_TOKEN_KEY);
  } catch (e) { /* non-fatal */ }
}

// Pushes whatever's captured/edited locally, and pulls back the server's
// merged view (which may include sessions another device already pushed) --
// same shape as training_store.merge_and_save's return. Silent on any
// failure (offline, wrong token, server asleep): the caller just keeps
// showing local data and tries again next render.
async function syncTrainingWithServer() {
  const { url, token } = trainingSyncConfig();
  if (!url || !token) return null;
  try {
    const resp = await fetch(`${url}/training`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessions: loadCapturedSessions(),
        edits: loadTrainingJson(TRAINING_EDITS_KEY, {}),
        deleted: loadTrainingJson(TRAINING_DELETED_KEY, []),
      }),
    });
    if (!resp.ok) return null;
    const state = await resp.json();
    // The server response is now the merged source of truth for the synced
    // set, so it replaces (not appends to) the local cache -- otherwise an
    // already-synced local entry would get re-POSTed and re-merged forever.
    saveCapturedSessions(state.sessions || []);
    saveTrainingJson(TRAINING_EDITS_KEY, state.edits || {});
    return state;
  } catch (e) {
    return null;
  }
}

// `${sessionId}:${drillId}` of the row currently mid-edit. Only one at a
// time, in-memory only -- transient view state, same as tasks.js's
// editingTaskId.
let editingTrainingRow = null;

// Session id mid-delete-confirm (inline "Delete? Yes/No", no browser
// confirm()), and whether the collapsible session list is expanded --
// both in-memory only. Without tracking the open state explicitly, the
// <details> element would collapse on every re-render (confirm click,
// sync completing) since renderTrainingZone rebuilds the DOM from scratch.
let confirmingDeleteSessionId = null;
let trainingSessionListOpen = false;

function loadTrainingJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (e) {
    return fallback;
  }
}
function saveTrainingJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* storage full or blocked -- non-fatal */ }
}

function loadCapturedSessions() { return loadTrainingJson(TRAINING_CAPTURED_KEY, []); }
function saveCapturedSessions(list) { saveTrainingJson(TRAINING_CAPTURED_KEY, list); }

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function weekdayName(dateStr) {
  return WEEKDAY_NAMES[new Date(`${dateStr}T00:00:00`).getDay()];
}

function toIsoDate(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayIso() { return toIsoDate(new Date()); }

// Merge server sessions (training.json) with locally captured ones, then
// overlay corrections -- same shape as tasks.js's mergeTasks(). A
// correction replaces only the drills it names, so fixing one drill's
// numbers never touches another drill logged the same session.
function mergeSessions(serverPayload) {
  const edits = loadTrainingJson(TRAINING_EDITS_KEY, {});
  const deleted = new Set(loadTrainingJson(TRAINING_DELETED_KEY, []));
  const server = (serverPayload && serverPayload.sessions) || [];
  const captured = loadCapturedSessions();

  const merged = [...server, ...captured]
    .filter(s => !deleted.has(s.id))
    .map(s => {
      const edit = edits[s.id];
      return edit ? { ...s, drills: { ...s.drills, ...edit } } : s;
    });

  // Ordered by the actual session (date, then logged_at to break same-day
  // ties) -- every delta/PR/graph calculation below walks this order, never
  // calendar days, so a gap between scheduled sessions never reads as a
  // decline (see missedSessions() for the separate "flag the gap" concern).
  merged.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (a.logged_at || '') < (b.logged_at || '') ? -1 : 1;
  });
  return merged;
}

function drillSets(session, drillId) {
  return (session.drills && session.drills[drillId]) || [];
}
function sessionHasDrill(session, drillId) {
  return drillSets(session, drillId).length > 0;
}
// Sum of filled sets only -- an unfilled Set 3 is simply absent from the
// array, never a zero, so a 2-set session and a 3-set session both total
// correctly without the empty slot skewing the number.
function drillTotal(session, drillId) {
  return drillSets(session, drillId).reduce((a, b) => a + b, 0);
}
function sessionsForDrill(sessions, drillId) {
  return sessions.filter(s => sessionHasDrill(s, drillId));
}

// A PR is a single SET beating the all-time best recorded so far for that
// drill, evaluated in chronological order. Recomputed from scratch on every
// render (never cached) so correcting a past session's numbers immediately
// reshuffles which sets are flagged.
function computePRSetKeys(sessions, drillId) {
  const prSetKeys = new Set();
  let best = -Infinity;
  sessionsForDrill(sessions, drillId).forEach(s => {
    drillSets(s, drillId).forEach((reps, i) => {
      if (reps > best) {
        prSetKeys.add(`${s.id}:${i}`);
        best = reps;
      }
    });
  });
  return prSetKeys;
}

// null when the drill has never been logged. Otherwise the latest session's
// total, the delta vs the previous session THAT ALSO LOGGED THIS DRILL
// (null if there's no such previous session), whether a PR happened in the
// latest session, and the full chronological history for the graph/table.
function drillSummary(sessions, drillId) {
  const history = sessionsForDrill(sessions, drillId);
  if (history.length === 0) return null;
  const latest = history[history.length - 1];
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const total = drillTotal(latest, drillId);
  const delta = previous ? total - drillTotal(previous, drillId) : null;
  const prSetKeys = computePRSetKeys(sessions, drillId);
  const hasPR = drillSets(latest, drillId).some((_, i) => prSetKeys.has(`${latest.id}:${i}`));
  return { total, delta, hasPR, prSetKeys, history };
}

// Scheduled Sun/Tue/Thu dates, from the first-ever logged session through
// yesterday, that have no session logged at all. Bounded to the user's own
// history so a fresh install doesn't report years of "missed" days.
function missedSessions(sessions) {
  if (sessions.length === 0) return [];
  const loggedDates = new Set(sessions.map(s => s.date));
  const firstDate = sessions.reduce((min, s) => (s.date < min ? s.date : min), sessions[0].date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const missed = [];
  for (let d = new Date(`${firstDate}T00:00:00`); d < today; d.setDate(d.getDate() + 1)) {
    if (!TRAINING_SCHEDULE_DAYS.includes(d.getDay())) continue;
    const iso = toIsoDate(d);
    if (!loggedDates.has(iso)) missed.push(iso);
  }
  return missed;
}

function renderSparkline(history, drillId) {
  const totals = history.slice(-8).map(s => drillTotal(s, drillId));
  if (totals.length < 2) return '';
  const w = 120, h = 28, pad = 3;
  const max = Math.max(...totals), min = Math.min(...totals);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (totals.length - 1);
  const points = totals.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `
    <svg class="drill-sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <polyline points="${points}" fill="none" stroke="var(--zone-training)" stroke-width="1.5"
                stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
}

function renderMissedBanner(sessions) {
  const missed = missedSessions(sessions);
  if (missed.length === 0) return '';
  const shown = missed.slice(-5);
  const more = missed.length - shown.length;
  const label = shown.map(d => `${weekdayName(d).slice(0, 3)} ${d.slice(5)}`).join(', ');
  return `<div class="training-missed">
    <span class="training-missed-icon" aria-hidden="true">⚠️</span>
    <span>Missed: ${escapeHtml(label)}${more > 0 ? ` (+${more} earlier)` : ''}</span>
  </div>`;
}

function sessionSummaryLabel(session) {
  const parts = TRAINING_DRILLS
    .filter(d => sessionHasDrill(session, d.id))
    .map(d => `${d.label} ${drillTotal(session, d.id)}`);
  return parts.length ? parts.join(' · ') : 'No drills recorded';
}

// A whole logged session (all drills for that day), distinct from the
// per-drill-row edit above -- deleting here removes the entry everywhere at
// once rather than one drill's numbers. Collapsed in a <details> by default
// since it's a secondary "manage" view, not the primary read surface.
function renderSessionLogList(sessions) {
  if (sessions.length === 0) return '';
  const open = trainingSessionListOpen || confirmingDeleteSessionId !== null;
  const rows = [...sessions].reverse().map(s => {
    const dateLabel = `${weekdayName(s.date)}, ${s.date}`;
    if (confirmingDeleteSessionId === s.id) {
      return `<div class="training-session-row is-confirming">
        <span class="task-confirm-text">Delete the ${escapeHtml(dateLabel)} session? This removes all drills logged that day, everywhere it's synced.</span>
        <button type="button" class="task-confirm-yes" data-session-delete-yes="${escapeHtml(s.id)}">Delete</button>
        <button type="button" class="task-confirm-no" data-session-delete-no="${escapeHtml(s.id)}">Cancel</button>
      </div>`;
    }
    return `<div class="training-session-row">
      <span class="training-session-date mono">${escapeHtml(dateLabel)}</span>
      <span class="training-session-summary">${escapeHtml(sessionSummaryLabel(s))}</span>
      <button type="button" class="task-delete" aria-label="Delete session logged ${escapeHtml(dateLabel)}"
              data-session-delete="${escapeHtml(s.id)}">${ICONS.trash()}</button>
    </div>`;
  }).join('');
  return `
    <details class="training-session-list"${open ? ' open' : ''}>
      <summary class="local-note">Logged sessions (${sessions.length}) — view / delete</summary>
      <div class="training-session-rows">${rows}</div>
    </details>`;
}

function wireTrainingSessionList(payload) {
  const details = document.querySelector('.training-session-list');
  if (details) {
    details.addEventListener('toggle', () => { trainingSessionListOpen = details.open; });
  }

  document.querySelectorAll('[data-session-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      confirmingDeleteSessionId = btn.dataset.sessionDelete;
      renderTrainingZone(payload);
    });
  });
  document.querySelectorAll('[data-session-delete-yes]').forEach(btn => {
    btn.addEventListener('click', () => {
      const deleted = new Set(loadTrainingJson(TRAINING_DELETED_KEY, []));
      deleted.add(btn.dataset.sessionDeleteYes);
      saveTrainingJson(TRAINING_DELETED_KEY, [...deleted]);
      confirmingDeleteSessionId = null;
      renderTrainingZone(payload);
      triggerTrainingSync(payload);
    });
  });
  document.querySelectorAll('[data-session-delete-no]').forEach(btn => {
    btn.addEventListener('click', () => {
      confirmingDeleteSessionId = null;
      renderTrainingZone(payload);
    });
  });
}

function renderDrillRow(session, drill, prSetKeys) {
  const sets = drillSets(session, drill.id);
  const dateLabel = `${weekdayName(session.date).slice(0, 3)} ${session.date.slice(5)}`;
  const rowKey = `${session.id}:${drill.id}`;

  if (editingTrainingRow === rowKey) {
    const cell = i => `<td><input type="number" min="0" inputmode="numeric" class="drill-set-edit-input"
      data-set="${i}" value="${sets[i] !== undefined ? sets[i] : ''}"></td>`;
    return `<tr class="drill-row is-editing">
      <td class="mono">${escapeHtml(dateLabel)}</td>
      ${cell(0)}${cell(1)}${cell(2)}
      <td class="mono">—</td>
      <td><button type="button" class="drill-row-save"
            data-session-save="${escapeHtml(session.id)}" data-drill="${escapeHtml(drill.id)}">Save</button></td>
    </tr>`;
  }

  const total = sets.reduce((a, b) => a + b, 0);
  const cell = i => {
    const v = sets[i];
    if (v === undefined) return `<td class="mono">—</td>`;
    const isPR = prSetKeys.has(`${session.id}:${i}`);
    return `<td class="mono">${v}${isPR ? ' <span class="drill-pr-flag" title="Personal record">🏆</span>' : ''}</td>`;
  };

  return `<tr class="drill-row">
    <td><button type="button" class="drill-row-edit mono"
          aria-label="Edit ${escapeHtml(dateLabel)} ${escapeHtml(drill.label)}"
          data-session-edit="${escapeHtml(session.id)}" data-drill="${escapeHtml(drill.id)}">${escapeHtml(dateLabel)}</button></td>
    ${cell(0)}${cell(1)}${cell(2)}
    <td class="mono">${total}</td>
    <td></td>
  </tr>`;
}

function renderDrillSection(sessions, drill, index = 0) {
  const summary = drillSummary(sessions, drill.id);

  const summaryLine = summary
    ? `<span class="drill-total mono">${summary.total} reps</span>
       ${summary.delta !== null ? `<span class="drill-delta ${summary.delta > 0 ? 'is-up' : summary.delta < 0 ? 'is-down' : 'is-flat'} mono">${summary.delta > 0 ? '+' : ''}${summary.delta} vs last session</span>` : ''}
       ${summary.hasPR ? `<span class="drill-pr-flag" title="Personal record">🏆</span>` : ''}`
    : `<span class="drill-total mono">—</span>`;

  const sparkline = summary ? renderSparkline(summary.history, drill.id) : '';

  const rows = summary
    ? [...summary.history].reverse().map(s => renderDrillRow(s, drill, summary.prSetKeys)).join('')
    : `<tr><td colspan="6" class="substep-empty">Not logged yet.</td></tr>`;

  return `
    <div class="drill-section" style="--i:${index}">
      <div class="drill-summary">
        <span class="drill-name">${escapeHtml(drill.label)}</span>
        ${summaryLine}
      </div>
      ${sparkline}
      <div class="table-scroll">
        <table class="drill-table">
          <thead><tr><th>Session</th><th>Set 1</th><th>Set 2</th><th>Set 3</th><th>Total</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderTrainingLogFormHtml() {
  const date = todayIso();
  return `
    <form class="training-log-form" id="training-log-form" autocomplete="off">
      <div class="training-log-head">
        <span>Log a session</span>
        <input type="date" id="training-log-date" class="training-log-date"
               value="${escapeHtml(date)}" max="${escapeHtml(date)}" aria-label="Session date">
        <span class="training-log-weekday mono" id="training-log-weekday">${escapeHtml(weekdayName(date))}</span>
      </div>
      ${TRAINING_DRILLS.map(d => `
        <div class="training-log-row">
          <span class="training-log-drill">${escapeHtml(d.label)}</span>
          <input type="number" min="0" inputmode="numeric" class="training-set-input" placeholder="Set 1" data-drill="${d.id}">
          <input type="number" min="0" inputmode="numeric" class="training-set-input" placeholder="Set 2" data-drill="${d.id}">
          <input type="number" min="0" inputmode="numeric" class="training-set-input" placeholder="Set 3" data-drill="${d.id}">
        </div>`).join('')}
      <button type="submit">Log session</button>
    </form>`;
}

// Sync status/setup line, shown at the bottom of the zone either way so
// it's discoverable without hunting for a settings page. Setup lives here
// (not in a global settings screen) because it's the only zone that needs
// it -- everything else is either read-only-from-server or intentionally
// local-only (tasks' quick-add).
function renderTrainingSyncSectionHtml() {
  const { url, token } = trainingSyncConfig();
  if (url && token) {
    let host = url;
    try { host = new URL(url).host; } catch (e) { /* keep raw string if unparseable */ }
    return `<p class="local-note">Synced across devices via ${escapeHtml(host)}.
      <button type="button" id="training-sync-forget" class="push-banner-dismiss">Turn off sync</button></p>`;
  }
  return `
    <details class="training-sync-setup">
      <summary class="local-note">Sync across devices (optional) — set up</summary>
      <form id="training-sync-form" class="unlock-form" autocomplete="off">
        <input type="url" id="training-sync-url" placeholder="https://your-app.up.railway.app" required>
        <input type="password" id="training-sync-token" placeholder="Sync token" required autocomplete="off">
        <button type="submit">Save</button>
      </form>
    </details>`;
}

function wireTrainingSyncSection(payload) {
  const form = document.getElementById('training-sync-form');
  if (form) {
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const url = document.getElementById('training-sync-url').value.trim();
      const token = document.getElementById('training-sync-token').value.trim();
      if (!url || !token) return;
      saveTrainingSyncConfig(url, token);
      renderTrainingZone(payload);
      triggerTrainingSync(payload);
    });
  }
  const forget = document.getElementById('training-sync-forget');
  if (forget) {
    forget.addEventListener('click', () => {
      clearTrainingSyncConfig();
      renderTrainingZone(payload);
    });
  }
}

// Guards against overlapping sync requests (e.g. a log-session submit while
// an on-load sync is still in flight); NOT a "only once ever" gate -- each
// call site (initial load, manual refresh, log, edit) legitimately wants its
// own sync attempt. A successful sync re-renders with the merged server
// state; that re-render never itself calls triggerTrainingSync, so this
// can't chain into a request loop.
let trainingSyncInFlight = false;
function triggerTrainingSync(payload) {
  if (trainingSyncInFlight) return;
  const { url, token } = trainingSyncConfig();
  if (!url || !token) return;
  trainingSyncInFlight = true;
  syncTrainingWithServer().then(state => {
    trainingSyncInFlight = false;
    if (state) renderTrainingZone(payload);
  });
}

function renderTrainingZone(payload) {
  const section = document.getElementById('zone-training');
  const mount = document.getElementById('training-list');
  if (!section || !mount) return;

  if (!payload && loadCapturedSessions().length === 0) {
    section.hidden = false;
    if (DASHBOARD.isWithheld('training')) {
      mount.innerHTML = renderWithheldZone('Training log');
      return;
    }
    mount.innerHTML = `${renderTrainingLogFormHtml()}${renderEmptyZone('No sessions logged yet — log one above.')}${renderTrainingSyncSectionHtml()}`;
    wireTrainingLogForm(payload);
    wireTrainingSyncSection(payload);
    return;
  }

  section.hidden = false;
  const sessions = mergeSessions(payload || { sessions: [] });

  mount.innerHTML = `
    ${renderTrainingLogFormHtml()}
    ${renderMissedBanner(sessions)}
    ${renderSessionLogList(sessions)}
    ${TRAINING_DRILLS.map((d, i) => renderDrillSection(sessions, d, i)).join('')}
    <p class="local-note">Sessions are saved in this browser. Editing a past
      entry recalculates its progress and PRs immediately.</p>
    ${renderTrainingSyncSectionHtml()}
  `;

  wireTrainingLogForm(payload);
  wireTrainingRowEdit(payload);
  wireTrainingSessionList(payload);
  wireTrainingSyncSection(payload);
}

function wireTrainingLogForm(payload) {
  const form = document.getElementById('training-log-form');
  if (!form) return;

  // Date defaults to today but is editable -- retroactive logging (e.g.
  // catching up on yesterday's session) needs no separate UI, just a
  // different value in the same field. Capped at today via `max` so a
  // session can't be logged for a date that hasn't happened yet; the
  // weekday label next to it is re-derived live so it never contradicts
  // whatever date is picked.
  const dateInput = document.getElementById('training-log-date');
  const weekdayLabel = document.getElementById('training-log-weekday');
  if (dateInput && weekdayLabel) {
    dateInput.addEventListener('change', () => {
      const picked = dateInput.value || todayIso();
      weekdayLabel.textContent = weekdayName(picked);
    });
  }

  form.addEventListener('submit', ev => {
    ev.preventDefault();
    const drills = {};
    TRAINING_DRILLS.forEach(d => {
      const sets = [...form.querySelectorAll(`.training-set-input[data-drill="${CSS.escape(d.id)}"]`)]
        .map(inp => inp.value.trim())
        .filter(v => v !== '')
        .map(Number)
        .filter(v => Number.isFinite(v) && v >= 0);
      if (sets.length) drills[d.id] = sets;
    });
    if (Object.keys(drills).length === 0) return;   // nothing entered -- no-op

    const today = todayIso();
    const pickedDate = dateInput && dateInput.value ? dateInput.value : today;
    const date = pickedDate > today ? today : pickedDate;   // defensive clamp past the `max` attribute
    const captured = loadCapturedSessions();
    captured.push({
      id: `local-${Date.now().toString(36)}`,
      date,
      weekday: weekdayName(date),
      logged_at: new Date().toISOString(),
      drills,
    });
    saveCapturedSessions(captured);
    renderTrainingZone(payload);
    triggerTrainingSync(payload);
  });
}

function wireTrainingRowEdit(payload) {
  // Date cell: tap a past entry to enter edit mode for that drill's sets.
  document.querySelectorAll('.drill-row-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      editingTrainingRow = `${btn.dataset.sessionEdit}:${btn.dataset.drill}`;
      renderTrainingZone(payload);
      const input = document.querySelector('.drill-set-edit-input');
      if (input) input.focus();
    });
  });

  document.querySelectorAll('.drill-row-save').forEach(btn => {
    btn.addEventListener('click', () => commitTrainingRowEdit(payload, btn));
  });

  // Enter saves, Escape exits edit mode without saving -- must still
  // re-render on Escape or the row is left stuck open with no way out.
  document.querySelectorAll('.drill-set-edit-input').forEach(input => {
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') {
        editingTrainingRow = null;
        renderTrainingZone(payload);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        input.closest('tr').querySelector('.drill-row-save').click();
      }
    });
  });
}

function commitTrainingRowEdit(payload, btn) {
  const row = btn.closest('tr');
  const sets = [...row.querySelectorAll('.drill-set-edit-input')]
    .map(inp => inp.value.trim())
    .filter(v => v !== '')
    .map(Number)
    .filter(v => Number.isFinite(v) && v >= 0);

  const edits = loadTrainingJson(TRAINING_EDITS_KEY, {});
  const sessionId = btn.dataset.sessionSave;
  const drillId = btn.dataset.drill;
  edits[sessionId] = { ...(edits[sessionId] || {}), [drillId]: sets };
  saveTrainingJson(TRAINING_EDITS_KEY, edits);

  editingTrainingRow = null;
  renderTrainingZone(payload);
  triggerTrainingSync(payload);
}
