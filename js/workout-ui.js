// The Training screen. Renders program.js's prescription, writes through
// workout.js, and shows the analysis over it.
//
// Ink rules apply throughout: rules and spacing rather than cards, serif for
// prose and mono for numbers, one accent that means complete or notable, and
// no punitive language anywhere. Section 5 of the spec makes "visually quiet"
// a hard requirement, so the science sits behind a disclosure and a
// prescription row reads as one line until you open it.

const WORKOUT_VIEWS = ['log', 'review', 'progress', 'history'];
let workoutView = 'log';
let workoutDate = null;         // null means "today"
let workoutEditingId = null;    // a session being edited, rather than logged fresh
let workoutConfirmDelete = null;

function workoutCurrentDate() { return workoutDate || workoutTodayIso(); }

function workoutPrettyDate(iso) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  return `${WORKOUT_WEEKDAY_NAMES[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
}

function workoutPrettyVariation(v) { return String(v || '').replace(/_/g, ' '); }

function workoutFormatSeconds(total) {
  if (total === null || total === undefined) return '';
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

function workoutRepRangeLabel(row) {
  if (row.amrap) return 'AMRAP';
  if (!row.rep_range) return '';
  const [low, high] = row.rep_range;
  return high === null ? `${low}+` : `${low}-${high}`;
}

function workoutSetsLabel(row) {
  if (row.attempts) return `${row.attempts[0]}-${row.attempts[1]} attempts`;
  if (row.protocol === 'sprint') return `${SPRINT_PROTOCOL.reps}x${SPRINT_PROTOCOL.work_seconds}s`;
  if (row.protocol === 'cooper') return `${COOPER_PROTOCOL.duration_min} min`;
  if (typeof row.sets !== 'number') return '';
  const min = row.sets_min ? `${row.sets_min}-` : '';
  return `${min}${row.sets}x${workoutRepRangeLabel(row)}`;
}

// --- the log screen -------------------------------------------------------
//
// One compact row per exercise -- name, then every input in a single
// wrapping strip of small fixed-width cells, styled exactly like the app's
// existing "several numbers side by side" convention (.training-set-input:
// a bordered box, transparent background, mono digits) rather than a full
// labelled form control per field. Weight and RIR are asked once per
// exercise, not once per set: real sessions rarely change either mid-block,
// and cells that grow to fill a row are what produced the unstyled-looking
// giant inputs this replaces. The underlying log still stores weight/RIR on
// every Set object (workout.js's shape is unchanged) -- this UI just writes
// the one value the owner enters into each set it builds.

// A single small cell: a mono label above a fixed-width input. Used for
// anything counted per set (reps, a hold attempt's duration, a sprint's
// distance) via data-wk-set/data-wk-key, or once per exercise (weight, RIR,
// added weight) via data-wk-exkey.
function workoutCellHtml(label, value, attrs, keyAttr) {
  return `<label class="wk-cell">
    <span>${escapeHtml(label)}</span>
    <input type="number" inputmode="decimal" ${attrs} ${keyAttr} value="${escapeHtml(value)}">
  </label>`;
}

function workoutSetCellHtml(index, key, label, value, attrs = '') {
  return workoutCellHtml(label, value, attrs, `data-wk-set="${index}" data-wk-key="${key}"`);
}

function workoutExkeyCellHtml(key, label, value, attrs = '') {
  return workoutCellHtml(label, value, attrs, `data-wk-exkey="${key}"`);
}

// A row of pill toggles (the same .pill the Insights period selector uses)
// plus the hidden input workoutCollectForm reads, so picking one is a single
// tap rather than a native <select> the rest of the app never uses.
function workoutPillGroupHtml(key, options, current) {
  return `<div class="wk-pill-group">
    <input type="hidden" data-wk-exkey="${key}" value="${escapeHtml(current)}">
    ${options.map(([value, label]) => `<button type="button" class="pill${value === current ? ' is-active' : ''}"
      data-wk-toggle="${key}" data-wk-value="${value}">${escapeHtml(label)}</button>`).join('')}
  </div>`;
}

// The exercise-level controls: weight for external_load, added weight and a
// tempo toggle for tempo_then_load, a variation toggle for hold_duration.
// Nothing here for time_or_distance -- distance/duration/reps are already
// asked per set below, and there is no weight or RIR to a sprint.
function workoutControlCellsHtml(type, exerciseId, entry) {
  const v = k => {
    const set = entry && entry.sets && entry.sets[0];
    const raw = set ? set[k] : null;
    return raw === null || raw === undefined ? '' : String(raw);
  };
  if (type === 'external_load') {
    return workoutExkeyCellHtml('weight', 'kg', v('weight'), 'step="0.5" min="0"')
      + workoutExkeyCellHtml('rir', 'RIR', v('rir'), 'min="0" max="10"');
  }
  if (type === 'tempo_then_load') {
    return workoutPillGroupHtml('tempo_stage',
      [['normal', 'normal'], ['slow_eccentric', 'slow ecc.']], v('tempo_stage') || 'normal')
      + workoutExkeyCellHtml('added_weight', '+kg', v('added_weight'), 'step="0.5" min="0"')
      + workoutExkeyCellHtml('rir', 'RIR', v('rir'), 'min="0" max="10"');
  }
  if (type === 'hold_duration') {
    const ex = programExercise(exerciseId);
    const current = v('variation') || WORKOUT.holdVariation(exerciseId);
    return workoutPillGroupHtml('variation',
      ex.variations.map(o => [o, workoutPrettyVariation(o)]), current);
  }
  return '';
}

// The per-set cells: what varies set to set. Reps for loaded work, one
// duration per hold attempt, the sprint/Cooper protocol's own few fields.
function workoutSetCellsHtml(type, exerciseId, row, sets) {
  if (type === 'external_load' || type === 'tempo_then_load') {
    return sets.map((set, i) => {
      const reps = set && set.reps !== null && set.reps !== undefined ? String(set.reps) : '';
      return workoutSetCellHtml(i, 'reps', `Set ${i + 1}`, reps, 'min="0"');
    }).join('');
  }
  if (type === 'hold_duration') {
    return sets.map((set, i) => {
      const dur = set && set.duration_seconds !== null && set.duration_seconds !== undefined
        ? String(set.duration_seconds) : '';
      return workoutSetCellHtml(i, 'duration_seconds', `#${i + 1}`, dur, 'min="0"');
    }).join('');
  }
  // time_or_distance: one row, a handful of named fields rather than an
  // indexed set -- the model already treats a whole sprint/Cooper entry as
  // a single logged set (see WORKOUT.saveSession's per-exercise cap).
  const set = sets[0] || null;
  const v = k => (set && set[k] !== null && set[k] !== undefined ? String(set[k]) : '');
  return workoutSetCellHtml(0, 'distance', 'dist', v('distance'))
    + workoutSetCellHtml(0, 'duration', 'time', v('duration'), 'step="0.01"')
    + workoutSetCellHtml(0, 'rep_count', 'reps', v('rep_count'), 'min="0"')
    + workoutSetCellHtml(0, 'rest_between_reps', 'rest s', v('rest_between_reps'), 'min="0"');
}

// One prescribed exercise, as a single compact row. Only the full scientific
// rationale hides behind a tap -- the name, the one-line why, and every input
// are visible without opening anything, per the spec's "one-line why, full
// rationale behind a tap", not "the whole exercise behind a tap".
function workoutExerciseHtml(row, loggedEntry) {
  const ex = programExercise(row.exercise_id);
  if (!ex) return '';
  const type = ex.progression_type;
  const progression = WORKOUT.progressionFor(row.exercise_id);
  const logged = loggedEntry ? WORKOUT.filledSets(loggedEntry).length : 0;

  // How many set cells to offer. Holds and runs get their prescribed attempt
  // count; loaded work gets the phase's set count, and the last is routinely
  // left blank, which costs nothing.
  let slots;
  if (type === 'hold_duration') slots = Math.max(row.attempts ? row.attempts[1] : 6, logged);
  else if (type === 'time_or_distance') slots = 1;
  else slots = Math.max(typeof row.sets === 'number' ? row.sets : 3, logged);

  const sets = Array.from({ length: slots }, (_, i) => (loggedEntry && loggedEntry.sets[i]) || null);

  const flagHtml = (progression && progression.flag && progression.flag !== WORKOUT_FLAGS.trendOnly)
    ? `<div class="wk-suggestion" data-wk-flag="${progression.flag}">
         <span class="wk-flag">${progression.flag.replace(/_/g, ' ').toLowerCase()}</span>
         <p>${escapeHtml(progression.suggestion || '')}</p>
         ${workoutAcceptButtonHtml(progression)}
       </div>`
    : '';

  return `
  <div class="wk-row" data-wk-exercise="${row.exercise_id}">
    <div class="wk-row-top">
      <span class="wk-name">${escapeHtml(ex.name)}</span>
      <span class="wk-prescription">${escapeHtml(workoutSetsLabel(row))}${
        row.rir_target ? ` &middot; RIR ${row.rir_target.join('-')}` : ''}</span>
      ${logged ? `<span class="wk-done" aria-label="${logged} sets logged">${logged}</span>` : ''}
    </div>
    <p class="wk-why">${escapeHtml(ex.why)}</p>
    ${row.note ? `<p class="wk-note">${escapeHtml(row.note)}</p>` : ''}
    ${row.rest ? `<p class="wk-note">Rest ${escapeHtml(row.rest)}</p>` : ''}
    ${row.protocol === 'sprint' ? `<p class="wk-note">${escapeHtml(SPRINT_PROTOCOL.note)}</p>` : ''}
    ${row.protocol === 'cooper' ? `<p class="wk-note">${escapeHtml(COOPER_PROTOCOL.note)}</p>` : ''}
    ${flagHtml}
    <div class="wk-cols">
      ${workoutSetCellsHtml(type, row.exercise_id, row, sets)}
      ${workoutControlCellsHtml(type, row.exercise_id, loggedEntry)}
    </div>
    <details class="wk-science">
      <summary>Why this exercise</summary>
      <p>${escapeHtml(ex.rationale)}</p>
    </details>
  </div>`;
}

function workoutAcceptButtonHtml(progression) {
  if (progression.flag === WORKOUT_FLAGS.tempoAdvance) {
    return `<button type="button" class="os-btn" data-wk-accept="tempo" data-wk-ex="${progression.exercise_id}">Switch to slow eccentric</button>`;
  }
  if (progression.flag === WORKOUT_FLAGS.variationAdvance) {
    return `<button type="button" class="os-btn" data-wk-accept="variation" data-wk-ex="${progression.exercise_id}" data-wk-value="${progression.next_variation}">Move to ${workoutPrettyVariation(progression.next_variation)}</button>`;
  }
  return '';
}

function workoutRecoveryHtml(recovery) {
  const r = recovery || {};
  const v = k => (r[k] === null || r[k] === undefined ? '' : String(r[k]));
  return `
  <section class="wk-section">
    <h3 class="os-subhead">Recovery</h3>
    <div class="wk-recovery">
      <label class="wk-field"><span>slept from</span>
        <input type="time" data-wk-recovery="sleep_from" value="${escapeHtml(v('sleep_from'))}"></label>
      <label class="wk-field"><span>to</span>
        <input type="time" data-wk-recovery="sleep_to" value="${escapeHtml(v('sleep_to'))}"></label>
      <label class="wk-field"><span>energy 1-10</span>
        <input type="number" min="1" max="10" inputmode="numeric" data-wk-recovery="energy" value="${escapeHtml(v('energy'))}"></label>
      <label class="wk-field"><span>soreness 1-10</span>
        <input type="number" min="1" max="10" inputmode="numeric" data-wk-recovery="soreness" value="${escapeHtml(v('soreness'))}"></label>
    </div>
  </section>`;
}

function workoutPhasePromptHtml() {
  const settings = WORKOUT.settings();
  if (!settings.program_start) {
    return `
    <div class="wk-prompt">
      <p>The program has not been started, so no phase or week is being reported.</p>
      <button type="button" class="os-btn os-btn-primary" id="wk-start-program">Start the program today</button>
    </div>`;
  }
  const pending = WORKOUT.pendingPhaseChange(workoutCurrentDate());
  if (!pending) return '';
  return `
  <div class="wk-prompt">
    <p>Week ${pending.week} begins the <strong>${escapeHtml(pending.to)}</strong> phase.
      ${escapeHtml(pending.phase.notes)}</p>
    <button type="button" class="os-btn os-btn-primary" data-wk-confirm-phase="${escapeHtml(pending.to)}">Move to ${escapeHtml(pending.to)}</button>
    <p class="os-note">Nothing changes until you accept it.</p>
  </div>`;
}

function workoutLogHtml() {
  const date = workoutCurrentDate();
  const weekday = workoutWeekdayIndex(date);
  const template = programWorkoutForWeekday(weekday);
  const phase = WORKOUT.activePhase();
  const week = WORKOUT.weekNumberFor(date);
  const existing = workoutEditingId
    ? WORKOUT.session(workoutEditingId)
    : (WORKOUT.sessionsOn(date)[0] || null);

  const header = `
    <div class="wk-head">
      <div>
        <h2 class="wk-title">${template ? escapeHtml(template.focus) : 'Rest day'}</h2>
        <p class="os-note">${escapeHtml(workoutPrettyDate(date))}${
          phase ? ` &middot; ${escapeHtml(phase.name)}` : ''}${week ? ` &middot; week ${week}` : ''}</p>
      </div>
      <label class="wk-field wk-date">
        <span>date</span>
        <input type="date" id="wk-date" value="${date}">
      </label>
    </div>
    ${workoutPhasePromptHtml()}`;

  if (!template) {
    return `<div class="os-block">${header}
      <p class="wk-why">Sunday to Thursday are training days. Nothing is prescribed today.</p>
      <p class="os-note">You can still pick another date above to log or correct a session.</p>
    </div>`;
  }

  const prescription = programPrescription(template, phase);
  const entryFor = id => (existing ? (existing.entries || []).find(e => e.exercise_id === id) : null);

  return `<div class="os-block">
    ${header}
    ${existing ? `<p class="os-note">Editing the session already logged for this date.</p>` : ''}
    <details class="wk-science wk-warmup">
      <summary>Warm-up &middot; about ${template.estimated_duration_min} min</summary>
      <p>${escapeHtml(template.warm_up)}</p>
    </details>
    <form id="wk-log-form" class="wk-form">
      ${prescription.exercises.map(row => workoutExerciseHtml(row, entryFor(row.exercise_id))).join('')}
      ${workoutRecoveryHtml(existing ? existing.recovery : null)}
      <div class="wk-actions">
        <button type="submit" class="os-btn os-btn-primary">${existing ? 'Save changes' : 'Save session'}</button>
        <span class="os-note" id="wk-log-status"></span>
      </div>
    </form>
  </div>`;
}

// --- weekly review --------------------------------------------------------

function workoutReviewHtml() {
  const review = WORKOUT.weeklyReview();
  const anyData = review.sessions_completed > 0 || review.trends.length > 0;
  return `<div class="os-block">
    <div class="os-head"><h2 class="wk-title">This week</h2>
      <span class="os-count">from ${escapeHtml(workoutPrettyDate(review.week_start))}</span></div>
    ${!anyData ? '<p class="wk-why">Nothing logged this week yet. The review is built from logged sessions only.</p>' : ''}
    <div class="os-stat-grid">
      <div class="os-stat">
        <span class="os-stat-value">${review.sessions_completed}/${review.sessions_scheduled}</span>
        <span class="os-stat-label">SESSIONS</span>
      </div>
      <div class="os-stat">
        <span class="os-stat-value">${review.sleep_avg_minutes === null ? '--' : dailyFormatDuration(review.sleep_avg_minutes)}</span>
        <span class="os-stat-label">SLEEP AVG</span>
      </div>
      <div class="os-stat">
        <span class="os-stat-value">${review.sprint_best === null ? '--' : `${review.sprint_best}s`}</span>
        <span class="os-stat-label">SPRINT BEST</span>
      </div>
    </div>
    ${review.note ? `<p class="wk-review-note">${escapeHtml(review.note)}</p>` : ''}
    ${review.trends.length ? `
      <h3 class="os-subhead">Per exercise</h3>
      <ul class="os-list">
        ${review.trends.map(t => `<li><span>${escapeHtml(t.name)}</span>
          <span class="wk-arrow" data-wk-arrow="${t.arrow === '↑' ? 'up' : (t.arrow === '↓' ? 'down' : 'flat')}">${t.arrow}</span></li>`).join('')}
      </ul>
      <p class="os-note">Arrows come from the logged sets, not from a separate judgement.</p>` : ''}
    ${review.cooper_points.length ? `
      <h3 class="os-subhead">Cooper test</h3>
      <ul class="os-list">${review.cooper_points.map(p => `<li><span>${escapeHtml(workoutPrettyDate(p.date))}</span><span class="wk-num">${p.distance}m</span></li>`).join('')}</ul>` : ''}
  </div>`;
}

// --- progress dashboard ---------------------------------------------------

function workoutSeriesLine(values) {
  const shown = values.filter(v => v !== null && v !== undefined);
  return shown.length ? shown.join(' → ') : '';
}

function workoutProgressHtml() {
  const tracked = programTrackedExerciseIds();
  const strength = tracked
    .map(id => ({ id, ex: programExercise(id), series: WORKOUT.strengthSeries(id) }))
    .filter(x => x.series.length > 0 && ['external_load', 'tempo_then_load'].includes(x.ex.progression_type));

  const holds = tracked
    .filter(id => programExercise(id).progression_type === 'hold_duration')
    .map(id => ({ id, ex: programExercise(id), trend: WORKOUT.holdTrend(id) }))
    .filter(x => Object.keys(x.trend).length > 0);

  const sprint = WORKOUT.sprintTrend().filter(p => p.best !== null);
  const volume = WORKOUT.weeklyVolumeByCategory();
  const weeks = Object.keys(volume).sort().slice(-4);

  if (!strength.length && !holds.length && !sprint.length && !weeks.length) {
    return `<div class="os-block">
      <div class="os-head"><h2 class="wk-title">Progress</h2></div>
      <p class="wk-why">This fills in as you log. It shows how each movement is
        moving, not how many sessions you have done.</p>
    </div>`;
  }

  return `<div class="os-block">
    <div class="os-head"><h2 class="wk-title">Progress</h2></div>
    ${strength.length ? `
      <h3 class="os-subhead">Strength</h3>
      <ul class="os-list">
        ${strength.map(x => {
          const loaded = x.ex.progression_type === 'external_load'
            && x.series.some(p => p.top_weight !== null);
          const line = loaded
            ? workoutSeriesLine(x.series.slice(-6).map(p => (p.top_weight === null ? null : `${p.top_weight}kg`)))
            : workoutSeriesLine(x.series.slice(-6).map(p => p.best_reps));
          return `<li><span>${escapeHtml(x.ex.name)}</span><span class="wk-num">${escapeHtml(line)}</span></li>`;
        }).join('')}
      </ul>` : ''}
    ${holds.length ? `
      <h3 class="os-subhead">Skills</h3>
      ${holds.map(x => Object.entries(x.trend).map(([variation, points]) => `
        <ul class="os-list"><li>
          <span>${escapeHtml(x.ex.name)} &middot; ${escapeHtml(workoutPrettyVariation(variation))}</span>
          <span class="wk-num">${escapeHtml(workoutSeriesLine(points.slice(-6).map(p => workoutFormatSeconds(p.total))))}</span>
        </li></ul>`).join('')).join('')}
      <p class="os-note">Total hold time per session, at that variation.</p>` : ''}
    ${sprint.length ? `
      <h3 class="os-subhead">Sprint</h3>
      <ul class="os-list"><li><span>Best time</span>
        <span class="wk-num">${escapeHtml(workoutSeriesLine(sprint.slice(-6).map(p => `${p.best}s`)))}</span></li></ul>` : ''}
    ${weeks.length ? `
      <h3 class="os-subhead">Weekly volume</h3>
      <ul class="os-list">
        ${weeks.map(w => {
          const v = volume[w];
          return `<li><span>${escapeHtml(workoutPrettyDate(w))}</span>
            <span class="wk-num">push ${v.push} &middot; pull ${v.pull} &middot; legs ${v.legs}</span></li>`;
        }).join('')}
      </ul>
      <p class="os-note">Sets actually logged, by category.</p>` : ''}
  </div>`;
}

// --- history --------------------------------------------------------------

function workoutHistoryHtml() {
  const sessions = WORKOUT.sessions().slice().reverse();
  if (!sessions.length) {
    return `<div class="os-block"><div class="os-head"><h2 class="wk-title">History</h2></div>
      <p class="wk-why">Every session you log appears here, editable and deletable.</p></div>`;
  }
  return `<div class="os-block">
    <div class="os-head"><h2 class="wk-title">History</h2><span class="os-count">${sessions.length}</span></div>
    <div class="os-history">
      ${sessions.map(s => {
        const sets = (s.entries || []).reduce((a, e) => a + WORKOUT.filledSets(e).length, 0);
        return `<div class="os-history-item">
          <div class="os-history-row">
            <span>${escapeHtml(workoutPrettyDate(s.date))}${s.focus ? ` &middot; ${escapeHtml(s.focus)}` : ''}</span>
            <span class="wk-num">${(s.entries || []).length} ex &middot; ${sets} sets</span>
          </div>
          ${s.migrated ? '<p class="os-note">Logged before the rebuild. Reps only, no load or RIR recorded.</p>' : ''}
          <div class="wk-actions">
            <button type="button" class="os-btn os-btn-quiet" data-wk-edit="${s.id}">Edit</button>
            ${workoutConfirmDelete === s.id
              ? `<button type="button" class="os-btn" data-wk-delete-confirm="${s.id}">Delete for good</button>
                 <button type="button" class="os-btn os-btn-quiet" data-wk-delete-cancel="1">Keep it</button>`
              : `<button type="button" class="os-btn os-btn-quiet" data-wk-delete="${s.id}">Delete</button>`}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

// --- mount ----------------------------------------------------------------

function workoutViewHtml() {
  if (workoutView === 'review') return workoutReviewHtml();
  if (workoutView === 'progress') return workoutProgressHtml();
  if (workoutView === 'history') return workoutHistoryHtml();
  return workoutLogHtml();
}

function renderWorkoutZone() {
  const mount = document.getElementById('panel-training');
  if (!mount) return;
  mount.innerHTML = `
    <div class="os-window-tabs" role="tablist">
      ${WORKOUT_VIEWS.map(v => `<button type="button" class="os-window-btn${v === workoutView ? ' is-active' : ''}"
        data-wk-view="${v}">${v === 'log' ? 'Today' : v[0].toUpperCase() + v.slice(1)}</button>`).join('')}
    </div>
    ${workoutViewHtml()}`;
  wireWorkoutZone();
}

function workoutCollectForm() {
  const form = document.getElementById('wk-log-form');
  if (!form) return null;
  const entries = [];
  form.querySelectorAll('[data-wk-exercise]').forEach(block => {
    const exerciseId = block.getAttribute('data-wk-exercise');
    const ex = programExercise(exerciseId);
    if (!ex) return;
    const type = ex.progression_type;

    // Weight, RIR, tempo stage and hold variation are asked once per
    // exercise (see workoutControlCellsHtml) rather than once per set, so
    // the same value is written onto every set this exercise produces.
    const exVal = key => {
      const el = block.querySelector(`[data-wk-exkey="${key}"]`);
      return el ? el.value : undefined;
    };

    const byIndex = {};
    block.querySelectorAll('[data-wk-set]').forEach(input => {
      const i = Number(input.getAttribute('data-wk-set'));
      const key = input.getAttribute('data-wk-key');
      byIndex[i] = byIndex[i] || {};
      byIndex[i][key] = input.value;
    });
    const sets = Object.keys(byIndex).sort((a, b) => a - b).map(i => {
      const raw = byIndex[i];
      // A set with no reps entered is a set the owner skipped, and must stay
      // that way: WORKOUT.setIsFilled treats a present weight as enough to
      // count a set as filled, so writing the shared weight/RIR onto a blank
      // slot would turn "left the 3rd set blank" back into a filled set --
      // exactly the bug the model's null-not-zero rule exists to prevent.
      const hasReps = raw.reps !== undefined && raw.reps !== null && raw.reps !== '';
      if (type === 'external_load' && hasReps) {
        raw.weight = exVal('weight');
        raw.rir = exVal('rir');
      } else if (type === 'tempo_then_load' && hasReps) {
        raw.tempo_stage = exVal('tempo_stage');
        raw.added_weight = exVal('added_weight');
        raw.rir = exVal('rir');
      } else if (type === 'hold_duration') {
        raw.variation = exVal('variation');
        raw.attempt_number = Number(i) + 1;
      }
      if (exerciseId === 'cooper_test') raw.is_test = true;
      return raw;
    });
    entries.push({ exercise_id: exerciseId, sets });
  });
  const recovery = {};
  form.querySelectorAll('[data-wk-recovery]').forEach(input => {
    recovery[input.getAttribute('data-wk-recovery')] = input.value;
  });
  return { entries, recovery };
}

function wireWorkoutZone() {
  const mount = document.getElementById('panel-training');
  if (!mount) return;

  mount.querySelectorAll('[data-wk-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      workoutView = btn.getAttribute('data-wk-view');
      workoutConfirmDelete = null;
      renderWorkoutZone();
    });
  });

  const dateInput = document.getElementById('wk-date');
  if (dateInput) {
    dateInput.addEventListener('change', () => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)) {
        workoutDate = dateInput.value;
        workoutEditingId = null;
        renderWorkoutZone();
      }
    });
  }

  const start = document.getElementById('wk-start-program');
  if (start) {
    start.addEventListener('click', () => { WORKOUT.startProgram(workoutTodayIso()); renderWorkoutZone(); });
  }

  mount.querySelectorAll('[data-wk-confirm-phase]').forEach(btn => {
    btn.addEventListener('click', () => {
      WORKOUT.confirmPhase(btn.getAttribute('data-wk-confirm-phase'));
      renderWorkoutZone();
    });
  });

  // Tempo stage and hold variation are pill toggles, not a native <select>:
  // one tap updates the hidden input workoutCollectForm reads, with no
  // re-render, so nothing else the owner typed in this exercise is disturbed.
  mount.querySelectorAll('[data-wk-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.wk-pill-group');
      if (!group) return;
      const key = btn.getAttribute('data-wk-toggle');
      const hidden = group.querySelector(`[data-wk-exkey="${key}"]`);
      if (hidden) hidden.value = btn.getAttribute('data-wk-value');
      group.querySelectorAll('.pill').forEach(p => p.classList.toggle('is-active', p === btn));
    });
  });

  mount.querySelectorAll('[data-wk-accept]').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind = btn.getAttribute('data-wk-accept');
      const exerciseId = btn.getAttribute('data-wk-ex');
      if (kind === 'tempo') WORKOUT.setTempoStage(exerciseId, 'slow_eccentric');
      if (kind === 'variation') WORKOUT.setHoldVariation(exerciseId, btn.getAttribute('data-wk-value'));
      renderWorkoutZone();
    });
  });

  const form = document.getElementById('wk-log-form');
  if (form) {
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const collected = workoutCollectForm();
      if (!collected) return;
      const date = workoutCurrentDate();
      const existing = workoutEditingId
        ? WORKOUT.session(workoutEditingId) : (WORKOUT.sessionsOn(date)[0] || null);
      WORKOUT.saveSession({
        id: existing ? existing.id : undefined,
        date: existing ? existing.date : date,
        entries: collected.entries,
        recovery: collected.recovery,
      });
      workoutEditingId = null;
      // A logged session IS the Workout habit for that day -- no double entry.
      // Carried over from the old system unchanged, and still deliberately
      // one-way: unticking Workout on Today leaves the session alone, because
      // the session did happen.
      workoutMarkWorkoutDone(existing ? existing.date : date);
      renderWorkoutZone();
      const status = document.getElementById('wk-log-status');
      if (status) status.textContent = 'Saved.';
      WORKOUT.syncWithServer();
    });
  }

  mount.querySelectorAll('[data-wk-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const session = WORKOUT.session(btn.getAttribute('data-wk-edit'));
      if (!session) return;
      workoutEditingId = session.id;
      workoutDate = session.date;
      workoutView = 'log';
      renderWorkoutZone();
    });
  });

  // Delete is two taps: the first turns the row into a confirmation, so a
  // mistap cannot destroy a logged session.
  mount.querySelectorAll('[data-wk-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      workoutConfirmDelete = btn.getAttribute('data-wk-delete');
      renderWorkoutZone();
    });
  });
  mount.querySelectorAll('[data-wk-delete-cancel]').forEach(btn => {
    btn.addEventListener('click', () => { workoutConfirmDelete = null; renderWorkoutZone(); });
  });
  mount.querySelectorAll('[data-wk-delete-confirm]').forEach(btn => {
    btn.addEventListener('click', () => {
      WORKOUT.deleteSession(btn.getAttribute('data-wk-delete-confirm'));
      workoutConfirmDelete = null;
      renderWorkoutZone();
      WORKOUT.syncWithServer();
    });
  });
}

function workoutMarkWorkoutDone(date) {
  if (typeof DAILY === 'undefined' || !DAILY || typeof DAILY.saveDay !== 'function') return;
  try {
    DAILY.saveDay(date, { workout_completed: true });
    if (typeof dailyTriggerSync === 'function') dailyTriggerSync();
    if (typeof renderDailyToday === 'function' && date === workoutTodayIso()) renderDailyToday();
  } catch (e) { /* the training log must never fail because of this */ }
}

// Run once per page load: pulls the old flat log into the new model. Reads the
// old keys, never writes them, and skips anything already migrated, so it is
// safe on every boot.
// Pulls the pre-rebuild log off the sync server and migrates it, then
// re-renders if anything arrived. Separate from workoutMigrateOnce because it
// is asynchronous and best-effort: no sync configured means nothing to do.
function workoutMigrateFromServer() {
  return WORKOUT.fetchLegacyServerState().then(state => {
    if (!state) return null;
    const result = workoutMigrateOnce(state);
    if (result && result.migrated > 0) renderWorkoutZone();
    return result;
  });
}

function workoutMigrateOnce(legacyPayload) {
  try {
    const result = WORKOUT.migrateLegacyTraining(legacyPayload);
    if (result.unmapped.length) {
      console.warn('Training migration could not map some old drills:', result.unmapped);
    }
    return result;
  } catch (e) {
    console.warn('Training migration skipped:', e && e.message);
    return null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { workoutPrettyDate, workoutFormatSeconds, workoutRepRangeLabel, workoutSetsLabel };
}
