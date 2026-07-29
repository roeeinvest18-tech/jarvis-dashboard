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

// `${sessionId}:${drillId}` of the row currently mid-edit. Only one at a
// time, in-memory only -- transient view state, same as tasks.js's
// editingTaskId.
let editingTrainingRow = null;

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
  const server = (serverPayload && serverPayload.sessions) || [];
  const captured = loadCapturedSessions();

  const merged = [...server, ...captured].map(s => {
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
      <polyline points="${points}" fill="none" stroke="var(--amber)" stroke-width="1.5"
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

function renderDrillSection(sessions, drill) {
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
    <div class="drill-section">
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
      <div class="training-log-head">Log today — ${escapeHtml(weekdayName(date))}, ${escapeHtml(date)}</div>
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
    mount.innerHTML = `${renderTrainingLogFormHtml()}${renderEmptyZone('No sessions logged yet — log one above.')}`;
    wireTrainingLogForm(payload);
    return;
  }

  section.hidden = false;
  const sessions = mergeSessions(payload || { sessions: [] });

  mount.innerHTML = `
    ${renderTrainingLogFormHtml()}
    ${renderMissedBanner(sessions)}
    ${TRAINING_DRILLS.map(d => renderDrillSection(sessions, d)).join('')}
    <p class="local-note">Sessions are saved in this browser. Editing a past
      entry recalculates its progress and PRs immediately.</p>
  `;

  wireTrainingLogForm(payload);
  wireTrainingRowEdit(payload);
}

function wireTrainingLogForm(payload) {
  const form = document.getElementById('training-log-form');
  if (!form) return;
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

    const date = todayIso();
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
}
