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
let workoutDraftCtx = null;      // { date, day, baseline } of the log form on screen, for autosave
let workoutDraftTimer = null;
let workoutDraftSkipFlush = false;
let workoutDraftBooted = false;
let workoutDraftConfirm = null;  // 'current' or a date: a discard waiting for its second tap
let workoutSheet = null;         // { mode: 'add' | 'swap', id } while the exercise library is open
let workoutEditNote = null;      // { text, undoRows } shown under the title after a change
let workoutEditOpen = null;      // exercise id whose sets / reps / rest editor is open
let workoutTemplateDay = null;  // a day chosen in the title's selector; null = the scheduled one
let workoutEditingId = null;    // a session being edited, rather than logged fresh
let workoutConfirmDelete = null;
let workoutLinkPending = null;   // the exercise awaiting its superset partner

function workoutCurrentDate() { return workoutDate || workoutTodayIso(); }

function workoutPrettyDate(iso) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  return `${WORKOUT_WEEKDAY_NAMES[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
}

function workoutPrettyVariation(v) { return String(v || '').replace(/_/g, ' '); }

// --- load unit, supersets and added exercises: small shared helpers ---------

// The unit a row is logged in: the unit its saved entry was stored with, else
// whatever the exercise is set to now. A saved entry always wins, so opening an
// old session after switching an exercise to plates still reads it as kg.
function workoutRowLoadUnit(exerciseId, loggedEntry) {
  return loggedEntry ? WORKOUT.entryLoadUnit(loggedEntry) : programLoadUnit(exerciseId);
}

function workoutWeightCellLabel(unit) { return unit === 'plates' ? 'Plates' : (unit === 'bodyweight' ? '+kg' : 'kg'); }
function workoutWeightCellAttrs(unit) { return unit === 'plates' ? 'step="1" min="0"' : 'step="0.5" min="0"'; }

// "4 plates" / "60kg", for the progress lines.
function workoutFormatLoad(value, unit) {
  if (unit === 'bodyweight') return `+${value}kg`;
  return unit === 'plates' ? `${value} plate${Number(value) === 1 ? '' : 's'}` : `${value}kg`;
}

// 7.2 stays 7.2, 6.0 prints 6.
function workoutFormatVolume(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }

// A quick-added exercise as a log row. It is on no template day, so the row is
// built from the defaults it was created with.
function workoutRowForAddedExercise(ex) {
  return {
    exercise_id: ex.id, added: true,
    sets: ex.default_sets || 3,
    rep_range: ex.rep_range ? [...ex.rep_range] : null,
    rir_target: ex.rir_target ? [...ex.rir_target] : null,
    ...(ex.default_rest ? { rest: ex.default_rest } : {}),
  };
}

// Put the two members of a superset next to each other, whichever order they
// were listed in. Everything else keeps its order.
function workoutOrderRows(rows, entryFor) {
  const groupOf = row => { const e = entryFor(row.exercise_id); return e && e.superset_group_id || null; };
  const placed = new Set();
  const out = [];
  rows.forEach(row => {
    if (placed.has(row.exercise_id)) return;
    placed.add(row.exercise_id);
    out.push(row);
    const group = groupOf(row);
    if (!group) return;
    const partner = rows.find(r => r !== row && !placed.has(r.exercise_id) && groupOf(r) === group);
    if (partner) { placed.add(partner.exercise_id); out.push(partner); }
  });
  return out;
}

function workoutFormatSeconds(total) {
  if (total === null || total === undefined) return '';
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

// Same total, labelled by whatever unit the exercise actually measures (see
// program.js's hold_metric) -- seconds for a real hold, reps for Pogo Jumps.
function workoutFormatHoldMetric(ex, total) {
  if (total === null || total === undefined) return '';
  return ex.hold_metric === 'reps' ? `${total} reps` : workoutFormatSeconds(total);
}

function workoutRepRangeLabel(row) {
  if (row.amrap) return 'AMRAP';
  if (!row.rep_range) return '';
  const [low, high] = row.rep_range;
  return high === null ? `${low}+` : `${low}-${high}`;
}

function workoutSetsLabel(row) {
  if (row.sprint_build) return `${row.attempts[0]}-${row.attempts[1]} sprints`;
  if (row.attempts && row.attempts[0] === row.attempts[1]) return `${row.attempts[0]} holds`;
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

// A text (not numeric) per-set cell -- used only for a hold_duration
// exercise's optional quality_note (program.js's logs_quality_note), which
// is "subjective or a device reading" and so cannot be constrained to a
// number.
function workoutSetTextCellHtml(index, key, label, value) {
  return `<label class="wk-cell">
    <span>${escapeHtml(label)}</span>
    <input type="text" data-wk-set="${index}" data-wk-key="${key}" value="${escapeHtml(value)}">
  </label>`;
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
// tempo toggle for tempo_then_load, a variation toggle for hold_duration, a
// rest-mode toggle for Sprints specifically (the only time_or_distance
// exercise reps are ever paced between).
// Weight and RIR are asked once per exercise. A saved entry whose filled sets
// carry different values (a synced or migrated session) must not be flattened
// into one value by the next save, so for that entry they are shown, and
// collected, per set instead. Returns the keys that go per set, else [].
function workoutPerSetKeys(type, entry) {
  const keys = type === 'external_load' ? ['weight', 'rir']
    : type === 'tempo_then_load' ? ['added_weight', 'rir'] : [];
  if (!keys.length || !entry || !entry.sets) return [];
  const filled = WORKOUT.filledSets(entry);
  const differs = keys.some(k => new Set(filled.map(s => String(s[k] === null || s[k] === undefined ? '' : s[k]))).size > 1);
  return differs ? keys : [];
}

function workoutControlCellsHtml(type, exerciseId, entry, perSet = [], row = null) {
  const v = k => {
    const set = entry && entry.sets && entry.sets[0];
    const raw = set ? set[k] : null;
    return raw === null || raw === undefined ? '' : String(raw);
  };
  if (type === 'external_load') {
    // The weight cell is the load: kg for a real weight, or a plate count on
    // the multi-gym. Same cell, same compact style; only its label changes.
    // (A pre-filled starting value for an added exercise is not a logged
    // entry: it has no exercise_id, so it never pins a unit.)
    const unit = workoutRowLoadUnit(exerciseId, entry && entry.exercise_id ? entry : null);
    if (perSet.length) return '';
    return workoutExkeyCellHtml('weight', workoutWeightCellLabel(unit), v('weight'), workoutWeightCellAttrs(unit))
      + workoutExkeyCellHtml('rir', 'RIR', v('rir'), 'min="0" max="10"');
  }
  if (type === 'tempo_then_load') {
    return workoutPillGroupHtml('tempo_stage',
      [['normal', 'normal'], ['slow_eccentric', 'slow ecc.']], v('tempo_stage') || 'normal')
      + (perSet.length ? '' : workoutExkeyCellHtml('added_weight', '+kg', v('added_weight'), 'step="0.5" min="0"')
        + workoutExkeyCellHtml('rir', 'RIR', v('rir'), 'min="0" max="10"'));
  }
  if (type === 'hold_duration') {
    const ex = programExercise(exerciseId);
    const current = v('variation') || WORKOUT.holdVariation(exerciseId);
    return workoutPillGroupHtml('variation',
      ex.variations.map(o => [o, workoutPrettyVariation(o)]), current);
  }
  if (type === 'time_or_distance' && exerciseId === 'sprints' && !(row && row.sprint_build)) {
    // A per-session choice, not a global setting: fixed rest (a timer) or the
    // next rep starting once heart rate drops under a threshold. Cooper Test
    // has no reps to pace between, so it never shows this.
    const mode = v('rest_mode') || 'fixed';
    return workoutPillGroupHtml('rest_mode',
      [['fixed', 'fixed rest'], ['hr_autoregulated', 'HR-based']], mode)
      + workoutExkeyCellHtml('hr_threshold_pct', 'HR% max', v('hr_threshold_pct') || '60', 'min="1" max="100"')
      + workoutExkeyCellHtml('recovery_hr_bpm', 'HR bpm', v('recovery_hr_bpm'), 'min="0"');
  }
  return '';
}

// The per-set cells: what varies set to set. Reps for loaded work, one
// duration per hold attempt, the sprint/Cooper protocol's own few fields.
function workoutSetCellsHtml(type, exerciseId, row, sets, perSet = [], unit = null) {
  if (type === 'external_load' || type === 'tempo_then_load') {
    const val = (set, k) => (set && set[k] !== null && set[k] !== undefined ? String(set[k]) : '');
    return sets.map((set, i) => {
      const reps = val(set, 'reps');
      let html = workoutSetCellHtml(i, 'reps', `Set ${i + 1}`, reps, 'min="0"');
      if (perSet.length && reps !== '') {
        if (type === 'external_load') {
          html += workoutSetCellHtml(i, 'weight', `${workoutWeightCellLabel(unit)} ${i + 1}`,
            val(set, 'weight'), workoutWeightCellAttrs(unit));
        } else {
          html += workoutSetCellHtml(i, 'added_weight', `+kg ${i + 1}`, val(set, 'added_weight'), 'step="0.5" min="0"');
        }
        html += workoutSetCellHtml(i, 'rir', `RIR ${i + 1}`, val(set, 'rir'), 'min="0" max="10"');
      }
      return html;
    }).join('');
  }
  if (type === 'hold_duration') {
    const ex = programExercise(exerciseId);
    // Pogo Jumps counts reps instead of timing a hold (program.js's
    // hold_metric) -- same cell, bound to a different field.
    const metricKey = ex.hold_metric === 'reps' ? 'reps' : 'duration_seconds';
    return sets.map((set, i) => {
      const val = set && set[metricKey] !== null && set[metricKey] !== undefined
        ? String(set[metricKey]) : '';
      let cell = workoutSetCellHtml(i, metricKey, `#${i + 1}`, val, 'min="0"');
      // A timed hold also takes a rep count per set; an exercise that already
      // counts reps as its measure (Pogo Jumps) does not need a second one.
      if (metricKey === 'duration_seconds') {
        const held = set && set.hold_reps !== null && set.hold_reps !== undefined ? String(set.hold_reps) : '';
        cell += workoutSetCellHtml(i, 'hold_reps', `#${i + 1} reps`, held, 'min="0"');
      }
      if (!ex.logs_quality_note) return cell;
      const note = set && set.quality_note ? String(set.quality_note) : '';
      return cell + workoutSetTextCellHtml(i, 'quality_note', 'note', note);
    }).join('');
  }
  // Cardio rows of the current program: each sprint is its own set with a time
  // and the rest taken after it; a run or a bike ride is one set of distance
  // and time.
  if (type === 'time_or_distance' && row && row.sprint_build) {
    return sets.map((set, i) => {
      const val = k => (set && set[k] !== null && set[k] !== undefined ? String(set[k]) : '');
      return workoutSetCellHtml(i, 'duration', `#${i + 1} time (s)`, val('duration'), 'step="0.1" min="0"')
        + workoutSetCellHtml(i, 'rest_between_reps', `#${i + 1} rest (s)`, val('rest_between_reps'), 'min="0"');
    }).join('');
  }
  if (type === 'time_or_distance' && row && row.measure) {
    const set = sets[0] || null;
    const val = k => (set && set[k] !== null && set[k] !== undefined ? String(set[k]) : '');
    const km = val('distance') || (row.measure === 'run' ? '2' : '');
    return workoutSetCellHtml(0, 'distance', 'km', km, 'step="0.01" min="0"')
      + workoutSetCellHtml(0, 'duration', 'time (min)', val('duration'), 'step="0.01" min="0"');
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
function workoutRowActionsHtml(ex, ctx) {
  const E = STRINGS.workout.edit;
  const btn = (attr, icon, label, extra = '') => `<button type="button" class="wk-icon-btn" ${attr} aria-label="${escapeHtml(label)}"${extra}>${icon}</button>`;
  return `<span class="wk-row-actions">
    ${btn(`data-wk-move="up" data-wk-ex="${ex.id}"`, WORKOUT_ICONS.up, E.moveUp(ex.name), ctx.index === 1 ? ' disabled' : '')}
    ${btn(`data-wk-move="down" data-wk-ex="${ex.id}"`, WORKOUT_ICONS.down, E.moveDown(ex.name), ctx.index === ctx.total ? ' disabled' : '')}
    ${btn(`data-wk-swap="${ex.id}"`, WORKOUT_ICONS.swap, E.swap(ex.name))}
    ${btn(`data-wk-remove="${ex.id}"`, WORKOUT_ICONS.trash, E.remove(ex.name))}
  </span>`;
}

// Sets, reps and rest of one exercise, changed in place.
function workoutRowEditorHtml(row) {
  const E = STRINGS.workout.edit;
  const cell = (field, label, value, attrs) => `<label class="wk-cell"><span>${escapeHtml(label)}</span>
    <input type="number" inputmode="numeric" ${attrs} data-wk-row-field="${field}" data-wk-ex="${row.exercise_id}" value="${escapeHtml(String(value))}"></label>`;
  return `<div class="wk-row-edit wk-cols">
    ${row.sets !== undefined ? cell('sets', E.sets, row.sets, `min="1" max="${WORKOUT_CUSTOM_SET_CAP}"`) : ''}
    ${row.rep_range ? cell('rep-low', E.repsFrom, row.rep_range[0], 'min="1"') + (row.rep_range[1] === null ? ''
      : cell('rep-high', E.repsTo, row.rep_range[1], 'min="1"')) : ''}
    <label class="wk-cell wk-cell-wide"><span>${E.rest}</span><input type="text" maxlength="24" data-wk-row-field="rest"
      data-wk-ex="${row.exercise_id}" value="${escapeHtml(row.rest || '')}"></label>
  </div>`;
}

function workoutExerciseHtml(row, loggedEntry, date, ctx = {}) {
  const ex = programExercise(row.exercise_id);
  if (!ex) return '';
  const type = ex.progression_type;
  const groupId = loggedEntry ? (loggedEntry.superset_group_id || '') : (row.pair ? `pair-${row.pair}` : '');
  const unit = type === 'external_load' ? workoutRowLoadUnit(row.exercise_id, loggedEntry) : null;
  // An added exercise that has not been logged yet starts from the plate
  // count it was added with. Not a logged entry, so it never pins a unit.
  const prefill = !loggedEntry && ex.custom && ex.start_load !== null && ex.start_load !== undefined
    ? { sets: [{ weight: ex.start_load }] } : null;
  const progression = WORKOUT.progressionFor(row.exercise_id);
  const logged = loggedEntry ? WORKOUT.filledSets(loggedEntry).length : 0;

  // A soft floor, not a hard block: still lets the session be logged, just
  // says so first. Only checked against a PRIOR session -- editing today's
  // own already-saved entry must never warn against itself.
  let gapWarningHtml = '';
  if (ex.min_gap_hours && date) {
    const hours = WORKOUT.hoursSinceLastLogged(row.exercise_id, date);
    if (hours !== null && hours < ex.min_gap_hours) {
      gapWarningHtml = `<p class="wk-note" data-wk-gap-warning>Last ${escapeHtml(ex.name.toLowerCase())} `
        + `session was ${hours}h ago; research suggests ${ex.min_gap_hours}h between sessions.</p>`;
    }
  }

  // How many set cells to offer. Holds and runs get their prescribed attempt
  // count; loaded work gets the phase's set count, and the last is routinely
  // left blank, which costs nothing.
  let slots;
  if (type === 'hold_duration') slots = Math.max(row.attempts ? row.attempts[1] : 6, logged);
  else if (type === 'time_or_distance') slots = row.sprint_build ? Math.max(row.attempts[1], logged) : 1;
  else slots = Math.max(typeof row.sets === 'number' ? row.sets : 3, logged);

  const sets = Array.from({ length: slots }, (_, i) => (loggedEntry && loggedEntry.sets[i]) || null);
  const perSet = workoutPerSetKeys(type, loggedEntry);

  const flagHtml = (progression && progression.flag && progression.flag !== WORKOUT_FLAGS.trendOnly)
    ? `<div class="wk-suggestion" data-wk-flag="${progression.flag}">
         <span class="wk-flag">${progression.flag.replace(/_/g, ' ').toLowerCase()}</span>
         <p>${escapeHtml(progression.suggestion || '')}</p>
         ${workoutAcceptButtonHtml(progression)}
       </div>`
    : ((progression && progression.reason === 'superset_needs_rir_1')
      ? `<p class="wk-note" data-wk-superset-note>Last time this was in a superset, so progression waits for an average RIR of 1 or lower.</p>`
      : '');

  return `
  <div class="wk-row" data-wk-exercise="${row.exercise_id}"${unit ? ` data-wk-load-unit="${unit}"` : ''}
    data-wk-logged="${loggedEntry ? '1' : '0'}"${groupId ? ' data-wk-superset' : ''}>
    <div class="wk-row-meta">
      ${ctx.total ? `<span class="wk-index">${ctx.index} / ${ctx.total}</span>` : ''}
      ${ctx.supersetAllowed ? `<span class="wk-superset-tag" data-wk-superset-tag${groupId ? '' : ' hidden'}>superset</span>` : ''}
      ${logged ? `<span class="wk-done" aria-label="${logged} sets logged">${logged}</span>` : ''}
      ${ctx.editable ? workoutRowActionsHtml(ex, ctx) : ''}
    </div>
    <div class="wk-row-top">
      <span class="wk-name">${escapeHtml(ex.name)}</span>
      ${ctx.editable
        ? `<button type="button" class="wk-prescription wk-presc-btn" data-wk-edit-row="${row.exercise_id}" aria-expanded="${workoutEditOpen === row.exercise_id}"
             aria-label="${escapeHtml(STRINGS.workout.edit.editRow(ex.name))}">${escapeHtml(workoutSetsLabel(row))}${
            row.rir_target ? ` &middot; RIR ${row.rir_target.join('-')}` : ''}</button>`
        : `<span class="wk-prescription">${escapeHtml(workoutSetsLabel(row))}${
            row.rir_target ? ` &middot; RIR ${row.rir_target.join('-')}` : ''}</span>`}
    </div>
    ${ctx.editable && workoutEditOpen === row.exercise_id ? workoutRowEditorHtml(row) : ''}
    <p class="wk-why">${escapeHtml(ex.why)}</p>
    ${gapWarningHtml}
    ${row.note ? `<p class="wk-note">${escapeHtml(row.note)}</p>` : ''}
    ${row.rest ? `<p class="wk-note wk-rest">Rest ${escapeHtml(row.rest)}</p>` : ''}
    ${row.protocol === 'sprint' ? `<p class="wk-note">${escapeHtml(SPRINT_PROTOCOL.note)}</p>` : ''}
    ${row.protocol === 'sprint' ? '<p class="wk-note">HR-based rest: enter heart rate from a synced device or by hand; the next rep starts once it drops under the threshold. Fixed rest ignores these two fields.</p>' : ''}
    ${row.protocol === 'cooper' ? `<p class="wk-note">${escapeHtml(COOPER_PROTOCOL.note)}</p>` : ''}
    ${flagHtml}
    ${workoutUnitAskHtml(ex)}
    <div class="wk-cols">
      ${workoutSetCellsHtml(type, row.exercise_id, row, sets, perSet, unit)}
      ${workoutControlCellsHtml(type, row.exercise_id, loggedEntry || prefill, perSet, row)}
    </div>
    <div class="wk-more">
      ${ctx.supersetAllowed ? workoutSupersetControlHtml(row.exercise_id, groupId) : ''}
      ${workoutExerciseSettingsHtml(ex, unit)}
      <details class="wk-science">
        <summary>Why this exercise</summary>
        <p>${escapeHtml(ex.rationale)}</p>
      </details>
    </div>
  </div>`;
}

// "Link with" picker, next to the exercise rather than on a screen of its own.
// The hidden input holds the shared group id (empty when unpaired); the button
// is wired in wireWorkoutZone and works on the DOM in place, so nothing already
// typed into the form is lost when two exercises are linked.
function workoutSupersetControlHtml(exerciseId, groupId) {
  return `<div class="wk-superset-control">
    <input type="hidden" data-wk-exkey="superset" value="${escapeHtml(groupId)}">
    <button type="button" class="os-btn os-btn-quiet wk-link-btn" data-wk-link="${exerciseId}"></button>
  </div>`;
}

// The exercise's own settings. Its load unit on any loaded exercise; for one
// the owner added, also its type and rep range. Saved straight away, separate
// from logging a session.
// A gym machine whose unit is not known yet (leg press, standing calf raise) asks
// once, at first logging. The answer is saved as the exercise's own setting, so
// it is remembered and the question is not asked again.
function workoutUnitAskHtml(ex) {
  if (!ex.unit_choice || (WORKOUT.settings().exercise_overrides[ex.id] || {}).load_unit) return '';
  return `<div class="wk-setting wk-unit-ask" data-wk-unit-ask>
    <span class="os-note">${STRINGS.workout.unitAsk}</span>
    <div class="wk-pill-group" data-wk-setting-group="load_unit">
      ${['kg', 'plates'].map(u => `<button type="button" class="pill${programLoadUnit(ex.id) === u ? ' is-active' : ''}"
        data-wk-setting="load_unit" data-wk-ex="${ex.id}" data-wk-value="${u}">${u}</button>`).join('')}
    </div>
  </div>`;
}

function workoutExerciseSettingsHtml(ex, unit) {
  const unitSettable = ex.progression_type === 'external_load' && programLoadUnit(ex.id) !== 'bodyweight';
  if (!unitSettable && !ex.custom) return '';
  const pills = (setting, options, current) => `<div class="wk-pill-group" data-wk-setting-group="${setting}">
    ${options.map(([value, label]) => `<button type="button" class="pill${value === current ? ' is-active' : ''}"
      data-wk-setting="${setting}" data-wk-ex="${ex.id}" data-wk-value="${value}">${escapeHtml(label)}</button>`).join('')}
  </div>`;
  const rep = ex.rep_range || [8, 12];
  return `<details class="wk-science wk-settings">
    <summary>Exercise settings</summary>
    <div class="wk-settings-body">
      ${unitSettable ? `<div class="wk-setting">
        <span class="os-note">Load is counted in</span>
        ${pills('load_unit', [['kg', 'kg'], ['plates', 'plates']], programLoadUnit(ex.id))}
      </div>` : ''}
      ${ex.custom ? `<div class="wk-setting">
        <label class="wk-cell"><span>Sets</span><input type="number" inputmode="numeric" min="1" max="${WORKOUT_CUSTOM_SET_CAP}"
          data-wk-custom-field="default_sets" data-wk-ex="${ex.id}" value="${ex.default_sets || 3}"></label>
        <label class="wk-cell"><span>${workoutWeightCellLabel(programLoadUnit(ex.id))}</span><input type="number" inputmode="decimal" min="0"
          step="${programLoadUnit(ex.id) === 'plates' ? '1' : '0.5'}" data-wk-custom-field="start_load" data-wk-ex="${ex.id}"
          value="${ex.start_load === null || ex.start_load === undefined ? '' : ex.start_load}"></label>
        <label class="wk-cell wk-cell-wide"><span>Rest</span><input type="text" maxlength="20" data-wk-custom-field="default_rest"
          data-wk-ex="${ex.id}" value="${escapeHtml(ex.default_rest || '')}"></label>
      </div>
      <div class="wk-setting">
        <span class="os-note">Progresses by</span>
        ${pills('progression_type', [['external_load', 'load'], ['tempo_then_load', 'bodyweight']], ex.progression_type)}
      </div>
      <div class="wk-setting">
        <span class="os-note">Rep range</span>
        <label class="wk-cell"><span>low</span><input type="number" inputmode="numeric" min="1"
          data-wk-rep-bound="0" data-wk-ex="${ex.id}" value="${rep[0]}"></label>
        <label class="wk-cell"><span>high</span><input type="number" inputmode="numeric" min="1"
          data-wk-rep-bound="1" data-wk-ex="${ex.id}" value="${rep[1]}"></label>
      </div>` : ''}
      <p class="os-note">Applies from the next session you log. Sessions already saved keep the unit they were logged in.</p>
    </div>
  </details>`;
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

// Which session's program the log screen shows for a date. Normally the day
// the date falls on; the title's selector can browse another day's program
// for the same date, and a session already saved under another day reopens as
// that day. `browsing` is true whenever what is shown is not the scheduled one.
function workoutResolveTemplate(date, existing) {
  const resolve = w => programResolveWorkout(w, date, WORKOUT.cardioOverrideFor(date));
  const scheduled = resolve(programWorkoutForWeekday(workoutWeekdayIndex(date)));
  const day = workoutTemplateDay || (existing && existing.day) || null;
  const chosen = day ? resolve(programWorkoutForDay(Number(day))) : null;
  const template = chosen || scheduled;
  // A session saved under the earlier split reopens as that day, labelled so.
  const legacy = !!template && !WEEK_TEMPLATE.some(w => w.day === template.day);
  return { scheduled, template, legacy, browsing: !!template && (!scheduled || template.day !== scheduled.day) };
}

function workoutExistingFor(date) {
  return workoutEditingId ? WORKOUT.session(workoutEditingId) : (WORKOUT.sessionsOn(date)[0] || null);
}

// The title is a session selector: every session type in the program, with the
// scheduled one marked so it is never unclear which day is today's. It is a
// custom listbox rather than a native <select>: the native popup is drawn by
// the browser, ignores the app's colours, and was white on white in the dark
// theme. Keyboard: Enter or Space or arrows open it, arrows / Home / End move,
// Enter or Space picks, Escape closes.
function workoutDayListboxHtml(date, scheduled, template, legacy) {
  const S = STRINGS.workout;
  const items = WEEK_TEMPLATE.map(w => {
    const resolved = programResolveWorkout(w, date, WORKOUT.cardioOverrideFor(date));
    const label = scheduled && scheduled.day === w.day ? S.scheduledOption(resolved.focus) : resolved.focus;
    return { value: String(w.day), label, short: resolved.focus, selected: !!template && template.day === w.day };
  });
  if (legacy) items.unshift({ value: String(template.day), label: S.earlierSchedule(template.focus), short: S.earlierSchedule(template.focus), selected: true });
  if (!template) items.unshift({ value: '', label: S.restDayOption, short: S.restDayOption, selected: true });
  const current = items.find(i => i.selected) || items[0];
  return `<span class="wk-daypick" data-wk-daypick>
    <button type="button" id="wk-day" class="wk-title wk-title-select" aria-haspopup="listbox" aria-expanded="false"
      aria-controls="wk-day-list" aria-label="${S.daySelect}">${escapeHtml(current.short)}</button>
    <ul id="wk-day-list" class="wk-day-list" role="listbox" aria-label="${S.daySelect}" tabindex="-1" hidden>
      ${items.map(i => `<li role="option" class="wk-day-option${i.selected ? ' is-selected' : ''}" data-day="${i.value}"
        aria-selected="${i.selected ? 'true' : 'false'}" tabindex="-1">${escapeHtml(i.label)}</li>`).join('')}
    </ul>
  </span>`;
}

// Wednesday's cardio type for this date, and a one-off choice of another.
function workoutCardioPickHtml(template, date) {
  if (!template || !template.cardio) return '';
  const S = STRINGS.workout;
  const names = { run: 'Run 2 km', sprints: 'Sprints', bike: 'Bike' };
  return `<div class="wk-setting wk-cardio-pick">
    <span class="os-note">${template.cardio_overridden ? S.cardioOverridden(names[template.cardio_scheduled]) : S.cardioScheduled}</span>
    <div class="wk-pill-group">
      ${['run', 'sprints', 'bike'].map(t => `<button type="button" class="pill${template.cardio_type === t ? ' is-active' : ''}"
        data-wk-cardio="${t}" data-wk-date="${date}">${names[t]}</button>`).join('')}
    </div>
  </div>`;
}

// --- editing a session: remove, add from the library, move, replace, edit ---
//
// Rows are kept as an ordered list per date (or as the owner's own default for
// a session type); the program is only the starting point. See workout.js's
// editedRowsFor.

const WORKOUT_ICONS = {
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l.8 12.5h9.4L17.5 7"/><path d="M10 11v5M14 11v5"/></svg>',
  up: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 14l6-6 6 6"/></svg>',
  down: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 10l6 6 6-6"/></svg>',
  swap: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9h13l-3-3"/><path d="M19 15H6l3 3"/></svg>',
};

// The rows a session is made of before the phase is applied, and where they come
// from: this date's own edit, the owner's default for the session type, or the
// program. Without any edit the exercises the owner added earlier still appear,
// as they always did, so nothing disappears from a session.
function workoutRawRows(date, template) {
  const dateRows = WORKOUT.editedRowsFor(date, template.day);
  if (dateRows) return { rows: dateRows, state: 'today' };
  const baseRows = WORKOUT.baseRowsFor(template.day);
  if (baseRows) return { rows: baseRows, state: 'default' };
  return {
    rows: [...template.exercises, ...programCustomExerciseIds().filter(id => !programExercise(id).scoped).map(id => ({ exercise_id: id, added: true }))],
    state: null,
  };
}

function workoutSessionEditable(template, legacy) { return !!template && !template.cardio && !legacy; }

// Applies `mutator` to a copy of the rows on screen and keeps the result for this
// date. Returns false when the session cannot be edited.
function workoutEditRows(mutator, note) {
  const date = workoutCurrentDate();
  const { template, legacy } = workoutResolveTemplate(date, workoutExistingFor(date));
  if (!workoutSessionEditable(template, legacy)) return false;
  const { rows } = workoutRawRows(date, template);
  const before = JSON.parse(JSON.stringify(rows));
  const next = mutator(JSON.parse(JSON.stringify(rows)));
  if (!next) return false;
  WORKOUT.saveEditedRows(date, template.day, next);
  workoutEditNote = note ? { text: note, undoRows: before } : null;
  renderWorkoutZone();
  return true;
}

function workoutExerciseName(id) { const ex = programExercise(id); return ex ? ex.name : id; }

function workoutRemoveExercise(id) {
  workoutEditRows(rows => {
    const removed = rows.find(r => r.exercise_id === id);
    const rest = rows.filter(r => r.exercise_id !== id);
    // A superset partner left alone is no longer paired.
    if (removed && removed.pair) rest.forEach(r => { if (r.pair === removed.pair && !rest.some(o => o !== r && o.pair === r.pair)) delete r.pair; });
    return rest;
  }, STRINGS.workout.edit.removed(workoutExerciseName(id)));
}

function workoutMoveExercise(id, delta) {
  workoutEditRows(rows => {
    const i = rows.findIndex(r => r.exercise_id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= rows.length) return null;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    return rows;
  });
}

function workoutAddExerciseRow(id) {
  const date = workoutCurrentDate();
  const { template } = workoutResolveTemplate(date, workoutExistingFor(date));
  const row = programRowFor(id, template);
  workoutSheet = null;
  if (!row) { renderWorkoutZone(); return; }
  workoutEditRows(rows => (rows.some(r => r.exercise_id === id) ? null : [...rows, row]),
    STRINGS.workout.edit.added(workoutExerciseName(id)));
}

function workoutSwapExercise(oldId, newId) {
  const date = workoutCurrentDate();
  const { template } = workoutResolveTemplate(date, workoutExistingFor(date));
  workoutSheet = null;
  workoutEditRows(rows => {
    const i = rows.findIndex(r => r.exercise_id === oldId);
    if (i < 0 || rows.some(r => r.exercise_id === newId)) return null;
    const fresh = programRowFor(newId, template);
    const old = rows[i];
    // The new exercise takes the place and the prescription of the old one.
    rows[i] = (fresh && fresh.sets !== undefined && old.sets !== undefined)
      ? { ...fresh, sets: old.sets, rep_range: old.rep_range || fresh.rep_range, rir_target: old.rir_target || fresh.rir_target,
          rest: old.rest || fresh.rest, ...(old.pair ? { pair: old.pair } : {}), ...(old.primary ? { primary: true } : {}) }
      : fresh;
    return rows;
  }, STRINGS.workout.edit.swapped(workoutExerciseName(oldId), workoutExerciseName(newId)));
}

function workoutChangeRow(id, field, value) {
  workoutEditOpen = id;
  workoutEditRows(rows => {
    const row = rows.find(r => r.exercise_id === id);
    if (!row) return null;
    const n = Math.round(Number(value));
    if (field === 'sets') {
      if (!(n >= 1 && n <= WORKOUT_CUSTOM_SET_CAP)) return null;
      row.sets = n;
      delete row.primary;          // the phase's extra set is the program's, not an edit
    } else if (field === 'rep-low' || field === 'rep-high') {
      const [lo, hi] = row.rep_range || [8, 12];
      const next = field === 'rep-low' ? [n, hi] : [lo, n];
      if (!(next[0] >= 1 && (next[1] === null || next[1] >= next[0]))) return null;
      row.rep_range = next;
    } else if (field === 'rest') {
      row.rest = String(value).trim().slice(0, 24);
    }
    return rows;
  });
}

// The note under the title: this date is edited, or the default differs from the program.
function workoutEditedNoteHtml(state, template) {
  const E = STRINGS.workout.edit;
  const status = workoutEditNote
    ? `<p class="os-note wk-edit-status" id="wk-edit-status" role="status">${escapeHtml(workoutEditNote.text)}${
        workoutEditNote.undoRows ? ` <button type="button" class="linkbtn" id="wk-edit-undo">${E.undo}</button>` : ''}</p>`
    : '<p class="os-note wk-edit-status" id="wk-edit-status" role="status" hidden></p>';
  if (state === 'today') {
    return `${status}<p class="os-note wk-edited" data-wk-edited="today">${E.editedToday}
      <button type="button" class="linkbtn" id="wk-edit-reset">${E.undoToday}</button>
      <button type="button" class="linkbtn" id="wk-edit-default">${E.makeDefault}</button></p>`;
  }
  if (state === 'default') {
    return `${status}<p class="os-note wk-edited" data-wk-edited="default">${escapeHtml(E.ownDefault(template.focus))}
      <button type="button" class="linkbtn" id="wk-edit-base">${E.backToProgram}</button></p>`;
  }
  return status;
}

function workoutCopyHtml() {
  const E = STRINGS.workout.edit;
  return `<details class="wk-science wk-copy">
    <summary>${E.copySummary}</summary>
    <div class="wk-setting">
      <label class="wk-field"><span>${E.copyDate}</span><input type="date" id="wk-copy-date"></label>
      <button type="button" class="os-btn" id="wk-copy-go">${E.copyGo}</button>
    </div>
  </details>`;
}

// The exercise library as a bottom sheet: search, a category filter, one tap to add or replace.
const WORKOUT_LIBRARY_CATEGORIES = ['push', 'pull', 'legs', 'other'];
function workoutLibraryCategory(ex) { return WORKOUT_LIBRARY_CATEGORIES.includes(ex.category) ? ex.category : 'other'; }

function workoutSheetHtml(template, rows) {
  if (!workoutSheet || !template) return '';
  const E = STRINGS.workout.edit;
  const inSession = new Set(rows.map(r => r.exercise_id));
  const swapping = workoutSheet.mode === 'swap' ? programExercise(workoutSheet.id) : null;
  const startCategory = swapping ? workoutLibraryCategory(swapping)
    : ({ Push: 'push', Pull: 'pull', Legs: 'legs' }[template.focus] || 'all');
  const library = programLibrary();
  return `<div class="wk-sheet-backdrop" id="wk-sheet-backdrop"></div>
  <div class="wk-sheet" id="wk-sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(swapping ? E.swapTitle(swapping.name) : E.sheetTitle)}">
    <div class="wk-sheet-head">
      <h3 class="wk-sheet-title">${escapeHtml(swapping ? E.swapTitle(swapping.name) : E.sheetTitle)}</h3>
      <button type="button" class="wk-icon-btn" id="wk-sheet-close" aria-label="${E.close}">&times;</button>
    </div>
    <input type="search" id="wk-lib-search" class="wk-lib-search" placeholder="${E.search}" aria-label="${E.search}" autocomplete="off">
    <div class="wk-pill-group wk-lib-chips" role="group">
      ${['all', ...WORKOUT_LIBRARY_CATEGORIES].map(c => `<button type="button" class="pill${c === startCategory ? ' is-active' : ''}"
        data-wk-lib-cat="${c}">${c === 'all' ? E.all : E.categories[c]}</button>`).join('')}
    </div>
    <ul class="wk-lib-list" id="wk-lib-list">
      ${library.map(ex => {
        const taken = inSession.has(ex.id) && !(swapping && swapping.id === ex.id);
        const unit = ex.progression_type === 'external_load' ? ` &middot; ${escapeHtml(workoutWeightCellLabel(programLoadUnit(ex.id)).toLowerCase())}` : '';
        return `<li><button type="button" class="wk-lib-item" data-wk-lib="${ex.id}" data-wk-lib-name="${escapeHtml(ex.name.toLowerCase())}"
          data-wk-lib-cat-of="${workoutLibraryCategory(ex)}"${taken || (swapping && swapping.id === ex.id) ? ' disabled' : ''}>
          <span class="wk-lib-name">${escapeHtml(ex.name)}</span>
          <span class="wk-lib-meta">${escapeHtml(String(ex.equipment || '').replace(/_/g, ' '))}${unit}${inSession.has(ex.id) ? ` &middot; ${E.inSession}` : ''}</span>
        </button></li>`;
      }).join('')}
    </ul>
    <p class="os-note wk-lib-empty" id="wk-lib-empty" hidden>${E.noMatch}</p>
    ${workoutSheet.mode === 'add' ? workoutAddExerciseHtml(template) : ''}
  </div>`;
}

function workoutFilterLibrary() {
  const q = ((document.getElementById('wk-lib-search') || {}).value || '').trim().toLowerCase();
  const chip = document.querySelector('[data-wk-lib-cat].is-active');
  const cat = chip ? chip.getAttribute('data-wk-lib-cat') : 'all';
  let shown = 0;
  document.querySelectorAll('#wk-lib-list li').forEach(li => {
    const b = li.querySelector('[data-wk-lib]');
    const ok = (cat === 'all' || b.getAttribute('data-wk-lib-cat-of') === cat) && (!q || b.getAttribute('data-wk-lib-name').includes(q));
    li.hidden = !ok;
    if (ok) shown += 1;
  });
  const empty = document.getElementById('wk-lib-empty');
  if (empty) empty.hidden = shown > 0;
}

function workoutOpenSheet(sheet) {
  workoutSheet = sheet;
  renderWorkoutZone();
}

function workoutCloseSheet() {
  workoutSheet = null;
  renderWorkoutZone();
}

function workoutLogHtml() {
  const date = workoutCurrentDate();
  const phase = WORKOUT.activePhase();
  const week = WORKOUT.weekNumberFor(date);
  const existing = workoutExistingFor(date);
  const { scheduled, template, legacy, browsing } = workoutResolveTemplate(date, existing);

  const header = `
    <div class="wk-head">
      <div>
        ${workoutDayListboxHtml(date, scheduled, template, legacy)}
        <p class="os-note wk-meta">${escapeHtml(workoutPrettyDate(date))}${
          phase ? ` &middot; ${escapeHtml(phase.name)}` : ''}${week ? ` &middot; week ${week}` : ''}${
          !browsing && scheduled ? ` &middot; ${STRINGS.workout.scheduledMeta}` : ''}</p>
        ${browsing ? `<p class="os-note wk-browse" data-wk-browsing>${escapeHtml(STRINGS.workout.browsing(
          template.focus, scheduled && scheduled.focus))}${scheduled
          ? ` <button type="button" class="linkbtn" id="wk-day-reset">${escapeHtml(STRINGS.workout.backToScheduled(scheduled.focus))}</button>` : ''}</p>` : ''}
      </div>
      <label class="wk-field wk-date">
        <span>date</span>
        <input type="date" id="wk-date" value="${date}">
      </label>
    </div>
    ${workoutPhasePromptHtml()}
    <p class="os-note wk-draft" id="wk-draft-note" hidden></p>
    ${workoutStaleDraftsHtml(date)}`;

  if (!template) {
    return `<div class="os-block">${header}
      <p class="wk-why">Sunday to Thursday are training days. Nothing is prescribed today.</p>
      <p class="os-note">You can still pick another date above to log or correct a session.</p>
    </div>`;
  }

  const editable = workoutSessionEditable(template, legacy);
  const raw = editable ? workoutRawRows(date, template) : { rows: template.exercises, state: null };
  // A row of an exercise the owner created follows that exercise's own settings
  // (sets, rep range, rest) unless the row says otherwise.
  const sessionRows = raw.rows.map(r => (r.added && programExercise(r.exercise_id)
    ? { ...workoutRowForAddedExercise(programExercise(r.exercise_id)), ...r } : r));
  const prescription = programPrescription({ ...template, exercises: sessionRows }, phase);
  const entryFor = id => (existing ? (existing.entries || []).find(e => e.exercise_id === id) : null);
  const sessionType = programSessionType(template);
  // Only strength sessions (Push, Pull, Upper) offer supersets. The Sprint +
  // Legs days are explosive: fixed order, no pairing.
  const supersetAllowed = programSessionAllowsSuperset(template.session_type);
  // The prescribed exercises, then any the owner has added. Both are ordinary
  // rows; a superset pair is shown side by side whichever list its two are in.
  const rows = workoutOrderRows(prescription.exercises, entryFor);

  return `<div class="os-block">
    ${header}
    ${existing ? `<p class="os-note">Editing the session already logged for this date.</p>` : ''}
    ${editable ? workoutEditedNoteHtml(raw.state, template) : ''}
    ${workoutCardioPickHtml(template, date)}
    ${template.warm_up ? `<details class="wk-science wk-warmup">
      <summary>Warm-up &middot; about ${template.estimated_duration_min} min</summary>
      <p>${escapeHtml(template.warm_up)}</p>
    </details>` : ''}
    ${sessionType && sessionType.why ? `<p class="wk-why">${escapeHtml(sessionType.why)}</p>` : ''}
    <form id="wk-log-form" class="wk-form">
      ${rows.map((row, i) => workoutExerciseHtml(row, entryFor(row.exercise_id), date,
        { supersetAllowed, index: i + 1, total: rows.length, editable })).join('')}
      ${editable ? `<button type="button" class="wk-add-bar" id="wk-open-sheet"><span aria-hidden="true">+</span> ${STRINGS.workout.edit.addBar}</button>` : ''}
      ${workoutRecoveryHtml(existing ? existing.recovery : null)}
      <section class="wk-section wk-comeback">
        <span class="os-note">Reduced intensity today?</span>
        ${workoutPillGroupHtml('comeback',
          [['no', 'normal session'], ['yes', 'comeback session']],
          existing && existing.comeback_session ? 'yes' : 'no')}
      </section>
      <div class="wk-actions">
        <button type="submit" class="os-btn os-btn-primary">${existing ? 'Save changes' : 'Save session'}</button>
        <span class="os-note" id="wk-log-status"></span>
      </div>
    </form>
    ${editable ? workoutCopyHtml() : ''}
    ${editable ? workoutSheetHtml(template, rows) : ''}
  </div>`;
}

// The add-exercise form is an exercise card in the same shape as the others in
// this session, with only the name editable. Everything else is the structure
// of the session it is added to (programAddTemplate) and is shown, not asked.
// It sits outside the session form so adding never submits a half-filled log.
function workoutAddExerciseHtml(template) {
  const S = STRINGS.workout;
  const t = programAddTemplate(template);
  const num = (id, label, value, attrs) => `<label class="wk-cell"><span>${escapeHtml(label)}</span>
    <input type="number" inputmode="numeric" id="${id}" value="${escapeHtml(String(value))}" ${attrs}></label>`;
  return `<details class="wk-science wk-add" id="wk-add">
    <summary>${STRINGS.workout.edit.createNew}</summary>
    <form id="wk-add-form" class="wk-add-form">
      <div class="wk-row wk-row-draft">
        <div class="wk-row-meta"><span class="wk-index">${S.addNew}</span></div>
        <div class="wk-row-top">
          <input type="text" id="wk-add-name" class="wk-add-name-input" maxlength="40" autocomplete="off"
            required aria-label="${S.addName}" placeholder="${S.addName}">
          <span class="wk-prescription" id="wk-add-presc"></span>
        </div>
        <div class="wk-cols">
          ${num('wk-add-sets', S.addSets, t.sets, `min="1" max="${WORKOUT_CUSTOM_SET_CAP}"`)}
          ${num('wk-add-rep-low', S.addRepsFrom, t.rep_range[0], 'min="1"')}
          ${num('wk-add-rep-high', S.addRepsTo, t.rep_range[1], 'min="1"')}
          ${num('wk-add-rir-low', S.addRirFrom, t.rir_target[0], 'min="0" max="10"')}
          ${num('wk-add-rir-high', S.addRirTo, t.rir_target[1], 'min="0" max="10"')}
        </div>
        <div class="wk-setting">
          <span class="os-note">${S.addUnit}</span>
          <div class="wk-pill-group" id="wk-add-unit" role="group" aria-label="${S.addUnit}">
            ${['plates', 'kg'].map(u => `<button type="button" class="pill${t.load_unit === u ? ' is-active' : ''}"
              data-wk-add-unit="${u}">${u}</button>`).join('')}
          </div>
          <label class="wk-cell"><span id="wk-add-start-label">${workoutWeightCellLabel(t.load_unit)}</span>
            <input type="number" inputmode="decimal" id="wk-add-start" min="0" step="1" placeholder="${S.addStartHint}"></label>
          <label class="wk-cell wk-cell-wide"><span>${S.addRest}</span>
            <input type="text" id="wk-add-rest" maxlength="20" value="${escapeHtml(t.rest)}"></label>
        </div>
        <button type="submit" class="os-btn">${S.addSummary}</button>
      </div>
      <p class="os-note">${escapeHtml(S.addNote(template ? template.focus : 'session'))}</p>
      <p class="os-note" id="wk-add-status"></p>
    </form>
  </details>`;
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
  // The current program, then anything else that was ever logged. An exercise
  // that is no longer scheduled keeps its history here; the two removed skills
  // (archived) are left out.
  const tracked = [...programTrackedExerciseIds(), ...WORKOUT.loggedExerciseIds()]
    .filter((id, i, all) => all.indexOf(id) === i && programExercise(id) && !programExercise(id).archived);
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
            ? workoutSeriesLine(x.series.slice(-6).map(p => (p.top_weight === null ? null : workoutFormatLoad(p.top_weight, p.load_unit))))
            : workoutSeriesLine(x.series.slice(-6).map(p => p.best_reps));
          return `<li><span>${escapeHtml(x.ex.name)}</span><span class="wk-num">${escapeHtml(line)}</span></li>`;
        }).join('')}
      </ul>` : ''}
    ${holds.length ? `
      <h3 class="os-subhead">Holds</h3>
      ${holds.map(x => Object.entries(x.trend).map(([variation, points]) => `
        <ul class="os-list"><li>
          <span>${escapeHtml(x.ex.name)} &middot; ${escapeHtml(workoutPrettyVariation(variation))}</span>
          <span class="wk-num">${escapeHtml(workoutSeriesLine(points.slice(-6).map(p => workoutFormatHoldMetric(x.ex, p.total))))}</span>
        </li></ul>`).join('')).join('')}
      <p class="os-note">Total per session, at that variation (seconds for a hold, reps for a rep-counted exercise like Pogo Jumps).</p>` : ''}
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
            <span class="wk-num">push ${workoutFormatVolume(v.push)} &middot; pull ${workoutFormatVolume(v.pull)} &middot; legs ${workoutFormatVolume(v.legs)}${
              v.other ? ` &middot; other ${workoutFormatVolume(v.other)}` : ''}</span></li>`;
        }).join('')}
      </ul>
      <p class="os-note">Sets actually logged, by category.${
        WORKOUT.sessions().some(s => (s.entries || []).some(e => e.superset_group_id))
          ? ` Sets done as part of a superset count ${WORKOUT_SUPERSET_VOLUME_MULTIPLIER}x here to reflect the added difficulty; the log itself is unchanged.`
          : ''}</p>` : ''}
  </div>`;
}

// --- history --------------------------------------------------------------

// "Superset: Chest Press + Incline Fly." for each pair the session logged.
function workoutSupersetSummaryHtml(session) {
  const groups = {};
  (session.entries || []).forEach(e => {
    if (e.superset_group_id) (groups[e.superset_group_id] = groups[e.superset_group_id] || []).push(e);
  });
  return Object.values(groups).map(pair => {
    const names = pair.map(e => (programExercise(e.exercise_id) || {}).name || e.exercise_id);
    return `<p class="os-note">Superset: ${escapeHtml(names.join(' + '))}.</p>`;
  }).join('');
}

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
          ${s.comeback_session ? '<p class="os-note">Comeback session.</p>' : ''}
          ${workoutSupersetSummaryHtml(s)}
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

// --- the draft of a workout in progress --------------------------------------
//
// Every field of the log form is snapshotted (reps, load, RIR, duration, notes,
// tempo and variation pills, superset links, recovery) and kept on this device
// by WORKOUT.draftSave, debounced to 300 ms and flushed at once when the page
// is hidden, because iOS does not reliably fire beforeunload for a PWA that is
// closed or killed. Opening the screen puts the values back; Save session
// commits the workout and clears the draft.

function workoutSnapshotForm(form) {
  const snap = { rows: {}, form: {} };
  form.querySelectorAll('[data-wk-exercise]').forEach(block => {
    const row = {};
    block.querySelectorAll('[data-wk-set]').forEach(i => {
      row[`s:${i.getAttribute('data-wk-set')}:${i.getAttribute('data-wk-key')}`] = i.value;
    });
    block.querySelectorAll('[data-wk-exkey]').forEach(i => { row[`x:${i.getAttribute('data-wk-exkey')}`] = i.value; });
    snap.rows[block.getAttribute('data-wk-exercise')] = row;
  });
  form.querySelectorAll('[data-wk-recovery]').forEach(i => { snap.form[`r:${i.getAttribute('data-wk-recovery')}`] = i.value; });
  const comeback = form.querySelector('.wk-comeback [data-wk-exkey="comeback"]');
  if (comeback) snap.form['x:comeback'] = comeback.value;
  return snap;
}

function workoutSetFieldValue(input, value) {
  input.value = value;
  const group = input.closest('.wk-pill-group');
  if (group) group.querySelectorAll('.pill').forEach(p => p.classList.toggle('is-active', p.getAttribute('data-wk-value') === value));
}

function workoutApplySnapshot(form, snap) {
  if (!snap || typeof snap !== 'object') return;
  Object.entries(snap.rows || {}).forEach(([id, fields]) => {
    const block = form.querySelector(`[data-wk-exercise="${id}"]`);
    if (!block) return;
    Object.entries(fields || {}).forEach(([key, value]) => {
      const parts = key.split(':');
      const input = parts[0] === 's'
        ? block.querySelector(`[data-wk-set="${parts[1]}"][data-wk-key="${parts[2]}"]`)
        : block.querySelector(`[data-wk-exkey="${parts[1]}"]`);
      if (input) workoutSetFieldValue(input, String(value));
    });
  });
  Object.entries(snap.form || {}).forEach(([key, value]) => {
    const name = key.slice(2);
    const input = key.startsWith('r:') ? form.querySelector(`[data-wk-recovery="${name}"]`)
      : form.querySelector(`.wk-comeback [data-wk-exkey="${name}"]`);
    if (input) workoutSetFieldValue(input, String(value));
  });
  // Superset partners sit together, as they do after linking by hand.
  const groups = {};
  form.querySelectorAll('[data-wk-exercise]').forEach(block => {
    const g = block.querySelector('[data-wk-exkey="superset"]');
    if (g && g.value) (groups[g.value] = groups[g.value] || []).push(block);
  });
  Object.values(groups).forEach(rows => { for (let i = 1; i < rows.length; i++) rows[i - 1].after(rows[i]); });
  workoutRefreshLinks(form);
}

// Writes the form on screen to the draft, unless nothing differs from what was
// there when the screen was drawn and no draft exists yet.
function workoutSaveDraftNow() {
  clearTimeout(workoutDraftTimer);
  workoutDraftTimer = null;
  const ctx = workoutDraftCtx;
  const form = document.getElementById('wk-log-form');
  if (!ctx || !form) return;
  const snap = workoutSnapshotForm(form);
  const changed = JSON.stringify(snap) !== ctx.baseline || !!WORKOUT.draftGet(ctx.date);
  if (!changed) return;
  if (WORKOUT.draftSave(ctx.date, ctx.day, snap)) {
    workoutDraftRequestPersist();
    workoutShowDraftNote();
  }
}

function workoutScheduleDraftSave() {
  clearTimeout(workoutDraftTimer);
  workoutDraftTimer = setTimeout(workoutSaveDraftNow, 300);
}

let workoutPersistAsked = false;
function workoutDraftRequestPersist() {
  if (workoutPersistAsked) return;
  workoutPersistAsked = true;
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      Promise.resolve(navigator.storage.persist()).catch(() => {});
    }
  } catch (e) { /* not available: the draft is still saved */ }
}

// The quiet "workout in progress" line, with a two-tap discard.
function workoutDraftNoteHtml() {
  const S = STRINGS.workout.draft;
  if (workoutDraftConfirm === 'current') {
    return `${S.confirm} <button type="button" class="linkbtn" data-wk-draft-yes="current">${S.yes}</button>
      <button type="button" class="linkbtn" data-wk-draft-keep="1">${S.keep}</button>`;
  }
  return `${S.inProgress} <button type="button" class="linkbtn" id="wk-draft-discard">${S.discard}</button>`;
}

function workoutShowDraftNote() {
  const note = document.getElementById('wk-draft-note');
  const ctx = workoutDraftCtx;
  if (!note || !ctx) return;
  const has = !!WORKOUT.draftGet(ctx.date);
  note.hidden = !has;
  if (has) { note.innerHTML = workoutDraftNoteHtml(); workoutWireDraftNote(); }
}

function workoutDiscardDraft(date) {
  WORKOUT.draftClear(date);
  workoutDraftConfirm = null;
  workoutDraftSkipFlush = true;
  renderWorkoutZone();
}

function workoutWireDraftNote() {
  const note = document.getElementById('wk-draft-note');
  if (!note) return;
  const discard = note.querySelector('#wk-draft-discard');
  if (discard) discard.addEventListener('click', () => { workoutDraftConfirm = 'current'; workoutShowDraftNote(); });
  const keep = note.querySelector('[data-wk-draft-keep]');
  if (keep) keep.addEventListener('click', () => { workoutDraftConfirm = null; workoutShowDraftNote(); });
  const yes = note.querySelector('[data-wk-draft-yes]');
  if (yes) yes.addEventListener('click', () => workoutDiscardDraft(workoutDraftCtx.date));
}

// Drafts from days before today are never merged into today. They are offered:
// finish it for its own date, or discard it (two taps).
function workoutStaleDraftsHtml(viewedDate) {
  const S = STRINGS.workout.draft;
  return WORKOUT.staleDrafts(workoutTodayIso()).filter(d => d !== viewedDate).map(d => {
    const draft = WORKOUT.draftGet(d);
    const day = draft && draft.day ? programWorkoutForDay(Number(draft.day)) : null;
    const focus = day ? programResolveWorkout(day, d, WORKOUT.cardioOverrideFor(d)).focus : '';
    const asking = workoutDraftConfirm === d;
    return `<div class="wk-prompt wk-stale" data-wk-stale="${d}">
      <p>${escapeHtml(S.stale(workoutPrettyDate(d), focus))}</p>
      ${asking
        ? `<p class="os-note">${S.confirm}</p>
           <div class="wk-actions"><button type="button" class="os-btn" data-wk-stale-yes="${d}">${S.yes}</button>
           <button type="button" class="os-btn os-btn-quiet" data-wk-stale-keep="1">${S.keep}</button></div>`
        : `<div class="wk-actions"><button type="button" class="os-btn" data-wk-stale-open="${d}">${S.finishFor}</button>
           <button type="button" class="os-btn os-btn-quiet" data-wk-stale-drop="${d}">${S.discardIt}</button></div>`}
    </div>`;
  }).join('');
}

function workoutWireStaleDrafts(mount) {
  mount.querySelectorAll('[data-wk-stale-open]').forEach(btn => btn.addEventListener('click', () => {
    const d = btn.getAttribute('data-wk-stale-open');
    const draft = WORKOUT.draftGet(d);
    workoutDate = d;
    workoutEditingId = null;
    workoutTemplateDay = draft && draft.day ? Number(draft.day) : null;
    renderWorkoutZone();
  }));
  mount.querySelectorAll('[data-wk-stale-drop]').forEach(btn => btn.addEventListener('click', () => {
    workoutDraftConfirm = btn.getAttribute('data-wk-stale-drop');
    workoutDraftSkipFlush = false;
    renderWorkoutZone();
  }));
  mount.querySelectorAll('[data-wk-stale-keep]').forEach(btn => btn.addEventListener('click', () => {
    workoutDraftConfirm = null;
    renderWorkoutZone();
  }));
  mount.querySelectorAll('[data-wk-stale-yes]').forEach(btn => btn.addEventListener('click', () => {
    WORKOUT.draftClear(btn.getAttribute('data-wk-stale-yes'));
    workoutDraftConfirm = null;
    renderWorkoutZone();
  }));
}

// Called once per drawing of the log form: restore what was typed, remember the
// starting point, and start watching the form. A date that already has a saved
// session is being edited, not drafted, so it is left alone.
function workoutStartDraft(form) {
  workoutDraftCtx = null;
  const date = workoutCurrentDate();
  if (workoutExistingFor(date)) return;
  const { template } = workoutResolveTemplate(date, null);
  if (!template) return;
  const draft = WORKOUT.draftGet(date);
  if (draft && draft.snaps && draft.snaps[String(template.day)]) {
    workoutApplySnapshot(form, draft.snaps[String(template.day)]);
  }
  workoutDraftCtx = { date, day: template.day, baseline: JSON.stringify(workoutSnapshotForm(form)) };
  if (draft && draft.snaps && draft.snaps[String(template.day)]) workoutDraftCtx.baseline = '';
  ['input', 'change', 'click'].forEach(type => form.addEventListener(type, workoutScheduleDraftSave));
  workoutShowDraftNote();
}

let workoutDraftListenersBound = false;
function workoutBindDraftFlush() {
  if (workoutDraftListenersBound) return;
  workoutDraftListenersBound = true;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') workoutSaveDraftNow(); });
  window.addEventListener('pagehide', workoutSaveDraftNow);
}

function renderWorkoutZone() {
  const mount = document.getElementById('panel-training');
  if (!mount) return;
  // What is typed is kept before anything redraws the form (a tab, a session
  // switch, a date change), except right after a save or a discard.
  if (!workoutDraftSkipFlush) workoutSaveDraftNow();
  workoutDraftSkipFlush = false;
  // On opening, today's unfinished workout comes back as the session it was.
  if (!workoutDraftBooted) {
    workoutDraftBooted = true;
    const today = WORKOUT.draftGet(workoutTodayIso());
    if (workoutDate === null && today && today.day) workoutTemplateDay = Number(today.day);
  }
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
      // A key the screen asked per set (workoutPerSetKeys) is already in
      // `raw` from its own cell; only the once-per-exercise ones are copied.
      const own = (k, value) => { if (raw[k] === undefined) raw[k] = value; };
      if (type === 'external_load' && hasReps) {
        own('weight', exVal('weight'));
        own('rir', exVal('rir'));
      } else if (type === 'tempo_then_load' && hasReps) {
        raw.tempo_stage = exVal('tempo_stage');
        own('added_weight', exVal('added_weight'));
        own('rir', exVal('rir'));
      } else if (type === 'hold_duration') {
        raw.variation = exVal('variation');
        raw.attempt_number = Number(i) + 1;
      } else if (type === 'time_or_distance' && exerciseId === 'sprints') {
        raw.rest_mode = exVal('rest_mode');
        raw.hr_threshold_pct = exVal('hr_threshold_pct');
        raw.recovery_hr_bpm = exVal('recovery_hr_bpm');
      }
      if (exerciseId === 'cooper_test') raw.is_test = true;
      return raw;
    });
    // The unit the row is shown in (a saved entry keeps its own) and, on a
    // strength day, the group id shared with its superset partner.
    const loadUnit = block.getAttribute('data-wk-load-unit');
    const group = exVal('superset');
    entries.push({
      exercise_id: exerciseId,
      sets,
      ...(loadUnit ? { load_unit: loadUnit } : {}),
      ...(group ? { superset_group_id: group } : {}),
    });
  });
  const recovery = {};
  form.querySelectorAll('[data-wk-recovery]').forEach(input => {
    recovery[input.getAttribute('data-wk-recovery')] = input.value;
  });
  const comebackInput = form.querySelector('[data-wk-exkey="comeback"]');
  const comebackSession = !!(comebackInput && comebackInput.value === 'yes');
  return { entries, recovery, comebackSession };
}

// --- superset linking -------------------------------------------------------
//
// Works on the DOM in place. Re-rendering the zone would rebuild every input
// and throw away whatever has been typed into the session so far.

function workoutRefreshLinks(form) {
  const rows = Array.from(form.querySelectorAll('[data-wk-exercise]'));
  const idOf = row => row.getAttribute('data-wk-exercise');
  const groupOf = row => { const i = row.querySelector('[data-wk-exkey="superset"]'); return i ? i.value : ''; };
  const nameOf = id => (programExercise(id) || {}).name || id;
  rows.forEach(row => {
    const btn = row.querySelector('[data-wk-link]');
    if (!btn) return;
    const id = idOf(row);
    const group = groupOf(row);
    let label = 'Link with →';
    if (group) {
      const partner = rows.find(r => r !== row && groupOf(r) === group);
      label = `Superset with ${partner ? nameOf(idOf(partner)) : 'its partner'} · unlink`;
    } else if (workoutLinkPending === id) {
      label = 'Pick the partner, or tap to cancel';
    } else if (workoutLinkPending) {
      label = `Link with ${nameOf(workoutLinkPending)}`;
    }
    btn.textContent = label;
    row.toggleAttribute('data-wk-superset', !!group);
    const tag = row.querySelector('[data-wk-superset-tag]');
    if (tag) tag.hidden = !group;
    row.classList.toggle('is-link-pending', workoutLinkPending === id);
  });
}

function workoutHandleLinkClick(form, exerciseId) {
  const rowOf = id => form.querySelector(`[data-wk-exercise="${id}"]`);
  const groupInput = row => row.querySelector('[data-wk-exkey="superset"]');
  const row = rowOf(exerciseId);
  if (!row || !groupInput(row)) return;
  const input = groupInput(row);
  if (input.value) {
    const group = input.value;
    form.querySelectorAll('[data-wk-exkey="superset"]').forEach(i => { if (i.value === group) i.value = ''; });
    workoutLinkPending = null;
  } else if (workoutLinkPending === exerciseId) {
    workoutLinkPending = null;
  } else if (workoutLinkPending) {
    const first = rowOf(workoutLinkPending);
    const group = `ss-${Date.now().toString(36)}`;
    if (first && groupInput(first)) {
      groupInput(first).value = group;
      input.value = group;
      first.after(row);          // the two rows sit together
    }
    workoutLinkPending = null;
  } else {
    workoutLinkPending = exerciseId;
  }
  workoutRefreshLinks(form);
}

// Saves one of an exercise's own settings straight away. A load-unit change
// patches the row in place; a type change reshapes the row's inputs, so that
// one redraws the screen.
function workoutHandleSettingClick(form, btn) {
  const id = btn.getAttribute('data-wk-ex');
  const setting = btn.getAttribute('data-wk-setting');
  const value = btn.getAttribute('data-wk-value');
  try {
    WORKOUT.setExerciseOverride(id, { [setting]: value });
  } catch (e) {
    return;
  }
  if (setting === 'progression_type') { renderWorkoutZone(); return; }
  const group = btn.closest('[data-wk-setting-group]');
  if (group) group.querySelectorAll('.pill').forEach(p => p.classList.toggle('is-active', p === btn));
  const row = form.querySelector(`[data-wk-exercise="${id}"]`);
  // A row with a saved entry keeps that entry's unit; the change applies to
  // the next session, so its label stays.
  if (row && row.getAttribute('data-wk-logged') === '0') {
    row.setAttribute('data-wk-load-unit', value);
    const input = row.querySelector('[data-wk-exkey="weight"]');
    if (input) {
      input.step = value === 'plates' ? '1' : '0.5';
      const label = input.parentElement && input.parentElement.querySelector('span');
      if (label) label.textContent = workoutWeightCellLabel(value);
    }
  }
}

function workoutHandleAddExercise(form) {
  const status = document.getElementById('wk-add-status');
  const say = text => { if (status) status.textContent = text; };
  const nameEl = document.getElementById('wk-add-name');
  const date = workoutCurrentDate();
  const { template } = workoutResolveTemplate(date, workoutExistingFor(date));
  const val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const unitBtn = document.querySelector('#wk-add-unit .pill.is-active');
  let ex;
  try {
    ex = WORKOUT.addCustomExercise({
      name: nameEl.value,
      sets: val('wk-add-sets'),
      rep_range: [val('wk-add-rep-low'), val('wk-add-rep-high')],
      rir_target: [val('wk-add-rir-low'), val('wk-add-rir-high')],
      rest: val('wk-add-rest'),
      load_unit: unitBtn ? unitBtn.getAttribute('data-wk-add-unit') : undefined,
      plates: val('wk-add-start'),
    });
  } catch (e) {
    say(e.message);
    return;
  }
  // The new exercise joins this session's list; the log is redrawn with what was typed
  // restored from the draft.
  workoutSheet = null;
  workoutEditRows(rows => [...rows, { exercise_id: ex.id, added: true }], STRINGS.workout.edit.added(ex.name));
}

function workoutWireEditing(mount) {
  const E = STRINGS.workout.edit;
  const ctx = () => {
    const date = workoutCurrentDate();
    const { template, legacy } = workoutResolveTemplate(date, workoutExistingFor(date));
    return { date, template, editable: workoutSessionEditable(template, legacy) };
  };
  mount.querySelectorAll('[data-wk-remove]').forEach(b => b.addEventListener('click', () => workoutRemoveExercise(b.getAttribute('data-wk-remove'))));
  mount.querySelectorAll('[data-wk-move]').forEach(b => b.addEventListener('click', () =>
    workoutMoveExercise(b.getAttribute('data-wk-ex'), b.getAttribute('data-wk-move') === 'up' ? -1 : 1)));
  mount.querySelectorAll('[data-wk-swap]').forEach(b => b.addEventListener('click', () => workoutOpenSheet({ mode: 'swap', id: b.getAttribute('data-wk-swap') })));
  const open = document.getElementById('wk-open-sheet');
  if (open) open.addEventListener('click', () => workoutOpenSheet({ mode: 'add' }));
  mount.querySelectorAll('[data-wk-edit-row]').forEach(b => b.addEventListener('click', () => {
    const id = b.getAttribute('data-wk-edit-row');
    workoutEditOpen = workoutEditOpen === id ? null : id;
    renderWorkoutZone();
  }));
  mount.querySelectorAll('[data-wk-row-field]').forEach(i => i.addEventListener('change', () =>
    workoutChangeRow(i.getAttribute('data-wk-ex'), i.getAttribute('data-wk-row-field'), i.value)));

  const undo = document.getElementById('wk-edit-undo');
  if (undo) undo.addEventListener('click', () => {
    const { date, template } = ctx();
    const rows = workoutEditNote && workoutEditNote.undoRows;
    workoutEditNote = null;
    if (rows && template) WORKOUT.saveEditedRows(date, template.day, rows);
    renderWorkoutZone();
  });
  const reset = document.getElementById('wk-edit-reset');
  if (reset) reset.addEventListener('click', () => {
    const { date, template } = ctx();
    if (template) WORKOUT.clearEditedRows(date, template.day);
    workoutEditNote = null;
    renderWorkoutZone();
  });
  const makeDefault = document.getElementById('wk-edit-default');
  if (makeDefault) makeDefault.addEventListener('click', () => {
    const { date, template } = ctx();
    if (!template) return;
    WORKOUT.saveBaseRows(template.day, WORKOUT.editedRowsFor(date, template.day) || []);
    WORKOUT.clearEditedRows(date, template.day);
    workoutEditNote = null;
    renderWorkoutZone();
  });
  const backToProgram = document.getElementById('wk-edit-base');
  if (backToProgram) backToProgram.addEventListener('click', () => {
    const { template } = ctx();
    if (template) WORKOUT.clearBaseRows(template.day);
    workoutEditNote = null;
    renderWorkoutZone();
  });
  const copyGo = document.getElementById('wk-copy-go');
  if (copyGo) copyGo.addEventListener('click', () => {
    const { date, template } = ctx();
    const target = (document.getElementById('wk-copy-date') || {}).value;
    const note = text => { workoutEditNote = { text, undoRows: null }; renderWorkoutZone(); };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(target || '')) { note(E.copyNeedsDate); return; }
    WORKOUT.saveEditedRows(target, template.day, workoutRawRows(date, template).rows);
    note(E.copied(workoutPrettyDate(target)));
  });

  // The library sheet.
  const sheet = document.getElementById('wk-sheet');
  if (sheet) {
    const close = () => workoutCloseSheet();
    document.getElementById('wk-sheet-close').addEventListener('click', close);
    document.getElementById('wk-sheet-backdrop').addEventListener('click', close);
    sheet.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.preventDefault(); close(); } });
    const search = document.getElementById('wk-lib-search');
    search.addEventListener('input', workoutFilterLibrary);
    sheet.querySelectorAll('[data-wk-lib-cat]').forEach(chip => chip.addEventListener('click', () => {
      sheet.querySelectorAll('[data-wk-lib-cat]').forEach(c => c.classList.toggle('is-active', c === chip));
      workoutFilterLibrary();
    }));
    sheet.querySelectorAll('[data-wk-lib]').forEach(b => b.addEventListener('click', () => {
      if (workoutSheet && workoutSheet.mode === 'swap') workoutSwapExercise(workoutSheet.id, b.getAttribute('data-wk-lib'));
      else workoutAddExerciseRow(b.getAttribute('data-wk-lib'));
    }));
    workoutFilterLibrary();
    sheet.setAttribute('tabindex', '-1');
    sheet.focus({ preventScroll: true });
  }
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

  workoutWireEditing(mount);

  const dateInput = document.getElementById('wk-date');
  if (dateInput) {
    dateInput.addEventListener('change', () => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)) {
        workoutDate = dateInput.value;
        workoutEditingId = null;
        const dated = WORKOUT.draftGet(dateInput.value);
        workoutTemplateDay = dated && dated.day ? Number(dated.day) : null;
        renderWorkoutZone();
      }
    });
  }

  // The title's selector switches which session's program is shown for this
  // date. It is a view and logging choice only: today's scheduled day, the
  // date and the program phase are untouched.
  const dayBtn = document.getElementById('wk-day');
  const dayList = document.getElementById('wk-day-list');
  if (dayBtn && dayList) {
    const options = () => Array.from(dayList.querySelectorAll('[role="option"]'));
    let active = -1;
    const setActive = n => {
      const list = options();
      if (!list.length) return;
      active = (n + list.length) % list.length;
      list.forEach((o, k) => o.classList.toggle('is-active', k === active));
      list[active].scrollIntoView({ block: 'nearest' });
    };
    const open = () => {
      dayList.hidden = false;
      dayBtn.setAttribute('aria-expanded', 'true');
      setActive(Math.max(0, options().findIndex(o => o.classList.contains('is-selected'))));
      dayList.focus();
    };
    const close = refocus => {
      dayList.hidden = true;
      dayBtn.setAttribute('aria-expanded', 'false');
      if (refocus) dayBtn.focus();
    };
    const pick = o => {
      if (!o) return;
      const day = o.getAttribute('data-day');
      close(false);
      if (o.classList.contains('is-selected')) return;
      workoutTemplateDay = day ? Number(day) : null;
      renderWorkoutZone();
    };
    dayBtn.addEventListener('click', () => (dayList.hidden ? open() : close(true)));
    dayBtn.addEventListener('keydown', ev => {
      if (['ArrowDown', 'ArrowUp'].includes(ev.key)) { ev.preventDefault(); if (dayList.hidden) open(); }
    });
    dayList.addEventListener('click', ev => pick(ev.target.closest('[role="option"]')));
    dayList.addEventListener('keydown', ev => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive(active + 1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive(active - 1); }
      else if (ev.key === 'Home') { ev.preventDefault(); setActive(0); }
      else if (ev.key === 'End') { ev.preventDefault(); setActive(options().length - 1); }
      else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(options()[active]); }
      else if (ev.key === 'Escape') { ev.preventDefault(); close(true); }
      else if (ev.key === 'Tab') close(false);
    });
    // A tap anywhere else closes it.
    document.addEventListener('click', ev => {
      if (!dayList.hidden && !ev.target.closest('[data-wk-daypick]')) close(false);
    }, { once: false });
  }
  mount.querySelectorAll('[data-wk-cardio]').forEach(btn => {
    btn.addEventListener('click', () => {
      WORKOUT.setCardioOverride(btn.getAttribute('data-wk-date'), btn.getAttribute('data-wk-cardio'));
      renderWorkoutZone();
    });
  });
  const dayReset = document.getElementById('wk-day-reset');
  if (dayReset) {
    dayReset.addEventListener('click', () => {
      const scheduled = programWorkoutForWeekday(workoutWeekdayIndex(workoutCurrentDate()));
      workoutTemplateDay = scheduled ? scheduled.day : null;
      renderWorkoutZone();
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

  workoutBindDraftFlush();
  workoutWireStaleDrafts(mount);
  const form = document.getElementById('wk-log-form');
  if (form) {
    workoutLinkPending = null;
    workoutRefreshLinks(form);
    workoutStartDraft(form);
    // Delegated, so a row added after this render behaves like the rest.
    form.addEventListener('click', ev => {
      const link = ev.target.closest('[data-wk-link]');
      if (link) { workoutHandleLinkClick(form, link.getAttribute('data-wk-link')); return; }
      const setting = ev.target.closest('[data-wk-setting]');
      if (setting) workoutHandleSettingClick(form, setting);
    });
    form.addEventListener('change', ev => {
      const field = ev.target.closest('[data-wk-custom-field]');
      if (field) {
        try {
          WORKOUT.setExerciseOverride(field.getAttribute('data-wk-ex'), { [field.getAttribute('data-wk-custom-field')]: field.value });
        } catch (e) { /* refused: the screen below redraws with the value that is kept */ }
        renderWorkoutZone();
        return;
      }
      const bound = ev.target.closest('[data-wk-rep-bound]');
      if (!bound) return;
      const id = bound.getAttribute('data-wk-ex');
      const pair = Array.from(form.querySelectorAll(`[data-wk-rep-bound][data-wk-ex="${id}"]`))
        .sort((a, b) => Number(a.getAttribute('data-wk-rep-bound')) - Number(b.getAttribute('data-wk-rep-bound')));
      try {
        WORKOUT.setExerciseOverride(id, { rep_range: pair.map(i => i.value) });
      } catch (e) {
        const current = programExercise(id).rep_range || [8, 12];
        pair.forEach((i, n) => { i.value = current[n]; });
      }
    });
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const collected = workoutCollectForm();
      if (!collected) return;
      const date = workoutCurrentDate();
      const existing = workoutEditingId
        ? WORKOUT.session(workoutEditingId) : (WORKOUT.sessionsOn(date)[0] || null);
      const chosenDay = workoutResolveTemplate(date, existing).template;
      WORKOUT.saveSession({
        id: existing ? existing.id : undefined,
        date: existing ? existing.date : date,
        ...(chosenDay ? { template_day: chosenDay.day } : {}),
        entries: collected.entries,
        recovery: collected.recovery,
        comeback_session: collected.comebackSession,
      });
      workoutEditingId = null;
      workoutTemplateDay = null;
      // The workout is finished: the draft has done its job.
      WORKOUT.draftClear(date);
      workoutDraftCtx = null;
      workoutDraftConfirm = null;
      workoutDraftSkipFlush = true;
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

  const addForm = document.getElementById('wk-add-form');
  if (addForm) {
    // The prescription line follows every field, and the unit pills relabel the
    // starting-weight cell.
    const presc = document.getElementById('wk-add-presc');
    const field = id => { const el = document.getElementById(id); return el && el.value !== '' ? el.value : '?'; };
    const refreshPresc = () => {
      if (!presc) return;
      presc.textContent = `${field('wk-add-sets')}x${field('wk-add-rep-low')}-${field('wk-add-rep-high')} \u00b7 RIR ${field('wk-add-rir-low')}-${field('wk-add-rir-high')}`;
    };
    addForm.addEventListener('input', refreshPresc);
    refreshPresc();
    addForm.querySelectorAll('[data-wk-add-unit]').forEach(btn => btn.addEventListener('click', () => {
      const unit = btn.getAttribute('data-wk-add-unit');
      addForm.querySelectorAll('[data-wk-add-unit]').forEach(b => b.classList.toggle('is-active', b === btn));
      const label = document.getElementById('wk-add-start-label');
      const start = document.getElementById('wk-add-start');
      if (label) label.textContent = workoutWeightCellLabel(unit);
      if (start) start.step = unit === 'plates' ? '1' : '0.5';
    }));
    addForm.addEventListener('submit', ev => { ev.preventDefault(); workoutHandleAddExercise(addForm); });
  }

  mount.querySelectorAll('[data-wk-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const session = WORKOUT.session(btn.getAttribute('data-wk-edit'));
      if (!session) return;
      workoutEditingId = session.id;
      workoutDate = session.date;
      workoutTemplateDay = null;
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
    // Logging the session is the moment the training habit is done, so it is
    // timed like a tick on Today (only when the session is for today; see
    // dailyHabitPatch). One-way as before: nothing here ever unticks it.
    DAILY.saveDay(date, dailyHabitPatch(DAILY.getDay(date), 'workout_completed', true,
      { stamp: true, date }));
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
