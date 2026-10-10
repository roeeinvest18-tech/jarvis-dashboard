// The training LOG and the ANALYSIS over it. Never the prescription.
//
// program.js says what you are meant to do. This file records what actually
// happened and works out whether it is going anywhere. The two are separate
// objects and are never merged: a logged session carries a snapshot of the
// prescription it was performed under (`prescribed`), so re-reading an old
// session tells you what was asked of you *then*, not what the current phase
// asks now.
//
// DOM-free and storage-shimmable, so test_workout_logic.js runs the whole
// model under plain Node.

const WORKOUT_KEYS = {
  sessions: 'jarvis:workout:sessions',
  deleted: 'jarvis:workout:deleted',
  settings: 'jarvis:workout:settings',
  customExercises: 'jarvis:workout:customExercises',
  migrated: 'jarvis:workout:migratedFrom',
  syncUrl: 'jarvis:workout:syncUrl',
  syncToken: 'jarvis:workout:syncToken',
};

// The old flat model's keys. Read once by migrateLegacyTraining(), never
// written: the old data stays exactly where it is, so a migration bug cannot
// destroy history and the old store on the server is untouched.
const WORKOUT_LEGACY_KEYS = {
  captured: 'jarvis:training:captured',
  edits: 'jarvis:training:edits',
  deleted: 'jarvis:training:deleted',
};

// Old drill id -> new exercise id. `shoulders` deliberately lands on a legacy
// entity rather than being guessed onto one of the three shoulder exercises
// the new program has: see programExercise('legacy_shoulders').
const WORKOUT_LEGACY_DRILL_MAP = {
  pull_ups: 'pull_ups',
  push_ups: 'push_ups',
  chin_ups: 'chin_ups',
  triceps_extension: 'triceps_extension',
  shoulders: 'legacy_shoulders',
};

const WORKOUT_DEFAULT_SETTINGS = {
  // Week 1 of the program is the week containing this date. Null until the
  // owner starts the program -- no phase is reported before then, rather than
  // assuming today is week 1.
  program_start: null,
  // Phase transitions are suggested, then applied on confirmation. This is the
  // phase the owner has actually accepted.
  confirmed_phase: null,
  // Per-exercise tempo stage for tempo_then_load work. Advanced only by an
  // explicit accept, never by the engine on its own.
  tempo_stages: {},
  // Per-exercise hold variation currently being trained.
  hold_variations: {},
  // "Longest attempt beat this -> suggest the next variation", in seconds.
  hold_variation_threshold_s: 20,
  // Sets per external_load / tempo_then_load exercise. The 3rd is often
  // skipped; empty sets are excluded from every average and check.
  max_sets: 3,
  // Per-exercise edits to an exercise's own settings, keyed by exercise id:
  // { load_unit, progression_type, rep_range }. The static program is never
  // rewritten; program.js's programExercise() layers these on top.
  exercise_overrides: {},
};

const WORKOUT_MAX_RIR_FOR_PROGRESSION = 2;
const WORKOUT_SET_CAP = 3;
// An exercise in an active superset pairing has to be taken closer to failure
// before it is flagged: pairing adds fatigue the raw numbers do not show.
const WORKOUT_MAX_RIR_FOR_SUPERSET_PROGRESSION = 1;
// Sets logged as part of a superset count this much toward the weekly volume
// stat only. The logged sets, reps and loads themselves are never scaled.
const WORKOUT_SUPERSET_VOLUME_MULTIPLIER = 1.2;
// A quick-added exercise can ask for more sets than the program's three.
const WORKOUT_CUSTOM_SET_CAP = 6;

// Progression flags. Every one of these is a suggestion surfaced to the owner.
// Nothing in this file mutates the program or a setting on its own.
const WORKOUT_FLAGS = {
  progressionAvailable: 'PROGRESSION_AVAILABLE',
  deloadSuggested: 'DELOAD_SUGGESTED',
  tempoAdvance: 'TEMPO_ADVANCE',
  addedWeightNext: 'ADDED_WEIGHT_NEXT',
  variationAdvance: 'VARIATION_ADVANCE',
  trendOnly: 'TREND_ONLY',
};

const WORKOUT_WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function workoutWeekdayIndex(dateIso) {
  const t = Date.parse(`${dateIso}T00:00:00Z`);
  return Number.isNaN(t) ? null : new Date(t).getUTCDay();
}

function workoutWeekdayName(dateIso) {
  const i = workoutWeekdayIndex(dateIso);
  return i === null ? '' : WORKOUT_WEEKDAY_NAMES[i];
}

function workoutTodayIso() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function workoutNewId() {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// --- numeric coercion -----------------------------------------------------
//
// A blank field is null (not logged), never 0. This is the bug that bit the
// Personal OS check-in: Number('') is 0, and a 0 that means "blank" poisons
// every average it reaches.

function workoutNum(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function workoutClamp(n, low, high) {
  if (n === null) return null;
  return Math.min(high, Math.max(low, n));
}

const WORKOUT = {
  // --- storage ------------------------------------------------------------

  loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  },

  saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* quota, private mode */ }
  },

  settings() {
    const stored = this.loadJson(WORKOUT_KEYS.settings, {}) || {};
    return {
      ...WORKOUT_DEFAULT_SETTINGS,
      ...stored,
      tempo_stages: { ...(stored.tempo_stages || {}) },
      hold_variations: { ...(stored.hold_variations || {}) },
      exercise_overrides: { ...(stored.exercise_overrides || {}) },
    };
  },

  saveSettings(patch) {
    const next = { ...this.settings(), ...patch };
    this.saveJson(WORKOUT_KEYS.settings, next);
    this.applyRegistry();
    return next;
  },

  // --- exercises added from the app, and per-exercise settings -------------

  customExercises() {
    const list = this.loadJson(WORKOUT_KEYS.customExercises, []);
    return Array.isArray(list) ? list.filter(e => e && typeof e.id === 'string') : [];
  },

  // Hands program.js the runtime exercises. Also adopts any custom exercise a
  // logged session carries a definition for but this device has never seen:
  // sessions sync between devices and the exercise list does not, so a session
  // logged on the phone has to be readable on the laptop.
  applyRegistry() {
    let custom = this.customExercises();
    const known = new Set(custom.map(e => e.id));
    const adopted = [];
    Object.values(this.rawSessions()).forEach(s => {
      ((s && s.entries) || []).forEach(entry => {
        const def = entry && entry.exercise_def;
        if (def && typeof def.id === 'string' && !known.has(def.id) && !programIsBuiltIn(def.id)) {
          known.add(def.id);
          adopted.push(def);
        }
      });
    });
    if (adopted.length) {
      custom = [...custom, ...adopted];
      this.saveJson(WORKOUT_KEYS.customExercises, custom);
    }
    const stored = this.loadJson(WORKOUT_KEYS.settings, {}) || {};
    programSetRuntime({ custom, overrides: stored.exercise_overrides || {} });
  },

  // A [low, high] pair from the template the exercise is added with, or the
  // default when it is missing or malformed.
  cleanRange(range, fallback) {
    if (!Array.isArray(range) || range.length !== 2) return [...fallback];
    const [low, high] = range.map(workoutNum);
    return low !== null && high !== null && low >= 0 && high >= low ? [low, high] : [...fallback];
  },

  // The "add exercise" flow: a name, a number of sets and a starting
  // plate count, nothing else. The result is an ordinary Exercise -- it gets an
  // id, is tracked by the progression engine and is offered in every session --
  // with the defaults in program.js's CUSTOM_EXERCISE_DEFAULTS.
  addCustomExercise({ name, sets, plates, rep_range, rir_target, rest } = {}) {
    const cleanName = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!cleanName) throw new Error('an exercise needs a name');
    const nSets = Math.round(workoutNum(sets) === null ? 3 : workoutNum(sets));
    if (nSets < 1 || nSets > WORKOUT_CUSTOM_SET_CAP) {
      throw new Error(`sets must be between 1 and ${WORKOUT_CUSTOM_SET_CAP}`);
    }
    const startPlates = workoutNum(plates);
    if (startPlates !== null && startPlates < 0) throw new Error('plates cannot be negative');

    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'exercise';
    const taken = new Set([...EXERCISES.map(e => e.id), ...this.customExercises().map(e => e.id)]);
    let id = `x-${slug}`;
    while (taken.has(id)) id = `x-${slug}-${Math.random().toString(36).slice(2, 6)}`;

    const d = CUSTOM_EXERCISE_DEFAULTS;
    const exercise = {
      id,
      name: cleanName,
      category: d.category,
      movement_pattern: 'unspecified',
      primary_muscles: [],
      equipment: 'multi_gym',
      progression_type: d.progression_type,
      load_unit: d.load_unit,
      variations: [],
      rep_range: this.cleanRange(rep_range, d.rep_range),
      rir_target: this.cleanRange(rir_target, d.rir_target),
      default_sets: nSets,
      default_rest: typeof rest === 'string' && rest.trim() ? rest.trim().slice(0, 20) : null,
      start_load: startPlates,
      custom: true,
      why: 'Added by you.',
      rationale: 'An exercise you added yourself, tracked like any other. Its '
        + 'rep range is a default (8-12) you can change in its settings.',
    };
    this.saveJson(WORKOUT_KEYS.customExercises, [...this.customExercises(), exercise]);
    this.applyRegistry();
    return programExercise(id);
  },

  // Edit an exercise's own settings afterwards. Only load_unit is editable on
  // the built-in program; a custom exercise can also change its progression
  // type (the two shapes quick-add can produce) and its rep range.
  setExerciseOverride(exerciseId, patch) {
    const base = programExercise(exerciseId);
    if (!base) throw new Error(`unknown exercise: ${exerciseId}`);
    const current = this.settings().exercise_overrides[exerciseId] || {};
    const next = { ...current };
    if (patch.load_unit !== undefined) {
      if (!LOAD_UNITS.includes(patch.load_unit)) throw new Error(`unknown load unit: ${patch.load_unit}`);
      next.load_unit = patch.load_unit;
    }
    if (base.custom && patch.progression_type !== undefined) {
      if (!['external_load', 'tempo_then_load'].includes(patch.progression_type)) {
        throw new Error('a quick-added exercise is external_load or tempo_then_load');
      }
      next.progression_type = patch.progression_type;
    }
    if (base.custom && patch.rep_range !== undefined) {
      const [low, high] = patch.rep_range.map(workoutNum);
      if (low === null || high === null || low < 1 || high < low) throw new Error('rep range must be low <= high');
      next.rep_range = [low, high];
    }
    const overrides = { ...this.settings().exercise_overrides, [exerciseId]: next };
    this.saveSettings({ exercise_overrides: overrides });
    return programExercise(exerciseId);
  },

  // What the number in an entry's weight field means. An entry with no
  // load_unit predates the field and is kg -- never inferred from the
  // exercise's current unit, so switching an exercise to plates later cannot
  // relabel what was already logged.
  entryLoadUnit(entry) {
    return entry && entry.load_unit === 'plates' ? 'plates' : 'kg';
  },

  deletedIds() { return this.loadJson(WORKOUT_KEYS.deleted, []) || []; },

  // Sessions are stored keyed by id so an edit is a single-key write and two
  // devices editing different sessions can never clobber each other.
  rawSessions() { return this.loadJson(WORKOUT_KEYS.sessions, {}) || {}; },

  // Every live session, oldest first. Tombstoned ids are filtered here, in the
  // single read path, so no caller can accidentally see a deleted session.
  sessions() {
    const dead = new Set(this.deletedIds());
    return Object.values(this.rawSessions())
      .filter(s => s && typeof s.id === 'string' && !dead.has(s.id))
      .sort((a, b) => (a.date === b.date
        ? String(a.created_at || '').localeCompare(String(b.created_at || ''))
        : String(a.date).localeCompare(String(b.date))));
  },

  session(id) { return this.sessions().find(s => s.id === id) || null; },

  sessionsOn(dateIso) { return this.sessions().filter(s => s.date === dateIso); },

  // --- program position ---------------------------------------------------

  // The phase the calendar implies for a date, which is a *suggestion*. What
  // the owner has confirmed is settings().confirmed_phase, and that is what
  // logging uses.
  suggestedPhaseFor(dateIso) {
    const start = this.settings().program_start;
    if (!start) return null;
    return programPhaseForDate(start, dateIso);
  },

  weekNumberFor(dateIso) {
    const start = this.settings().program_start;
    return start ? programWeekNumber(start, dateIso) : null;
  },

  activePhase() {
    const name = this.settings().confirmed_phase;
    return PROGRAM_PHASES.find(p => p.name === name) || null;
  },

  // True when the calendar has moved into a phase the owner has not accepted.
  // The UI shows this as a prompt; nothing changes until confirmPhase() runs.
  pendingPhaseChange(dateIso = workoutTodayIso()) {
    const suggested = this.suggestedPhaseFor(dateIso);
    if (!suggested) return null;
    const confirmed = this.settings().confirmed_phase;
    if (confirmed === suggested.name) return null;
    return { from: confirmed, to: suggested.name, week: this.weekNumberFor(dateIso), phase: suggested };
  },

  confirmPhase(phaseName) {
    const phase = PROGRAM_PHASES.find(p => p.name === phaseName);
    if (!phase) throw new Error(`unknown phase: ${phaseName}`);
    return this.saveSettings({ confirmed_phase: phase.name });
  },

  startProgram(dateIso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateIso))) throw new Error('program start must be YYYY-MM-DD');
    const phase = programPhaseForDate(dateIso, dateIso);
    return this.saveSettings({ program_start: dateIso, confirmed_phase: phase ? phase.name : null });
  },

  // --- prescription snapshot ---------------------------------------------

  // What the program asks of one exercise, under the confirmed phase, on the
  // day it appears. Stored onto the log entry so the analysis of an old
  // session never shifts when the phase does.
  prescriptionFor(exerciseId, day) {
    const phase = this.activePhase();
    const added = programExercise(exerciseId);
    // A quick-added exercise is on no template day, so its "prescription" is
    // the defaults it was created with.
    if (added && added.custom) {
      return {
        sets: added.default_sets || 3,
        rep_range: added.rep_range ? [...added.rep_range] : null,
        rir_target: added.rir_target ? [...added.rir_target] : null,
        rest: null,
        attempts: null,
        amrap: false,
        per_leg: false,
        phase: phase ? phase.name : null,
      };
    }
    const workout = programPrescription(day, phase);
    if (!workout) return null;
    const row = workout.exercises.find(r => r.exercise_id === exerciseId);
    if (!row) return null;
    return {
      sets: row.sets === undefined ? null : row.sets,
      rep_range: row.rep_range ? [...row.rep_range] : null,
      rir_target: row.rir_target ? [...row.rir_target] : null,
      rest: row.rest || null,
      attempts: row.attempts ? [...row.attempts] : null,
      amrap: !!row.amrap,
      per_leg: !!row.per_leg,
      phase: phase ? phase.name : null,
    };
  },

  tempoStage(exerciseId) {
    return this.settings().tempo_stages[exerciseId] || 'normal';
  },

  // Explicit accept only: Stage A -> Stage B is a decision the owner makes
  // when the engine suggests it.
  setTempoStage(exerciseId, stage) {
    if (!['normal', 'slow_eccentric'].includes(stage)) throw new Error(`unknown tempo stage: ${stage}`);
    const s = this.settings();
    s.tempo_stages[exerciseId] = stage;
    return this.saveSettings({ tempo_stages: s.tempo_stages });
  },

  holdVariation(exerciseId) {
    const stored = this.settings().hold_variations[exerciseId];
    if (stored) return stored;
    const ex = programExercise(exerciseId);
    return ex && ex.variations.length ? ex.variations[0] : null;
  },

  setHoldVariation(exerciseId, variation) {
    const ex = programExercise(exerciseId);
    if (!ex || !ex.variations.includes(variation)) {
      throw new Error(`${variation} is not a variation of ${exerciseId}`);
    }
    const s = this.settings();
    s.hold_variations[exerciseId] = variation;
    return this.saveSettings({ hold_variations: s.hold_variations });
  },

  // --- set normalisation --------------------------------------------------
  //
  // The shape of a set is decided by the exercise's progression_type, not by
  // what the caller happens to pass. Anything not recognised for that type is
  // dropped rather than stored as a stray field.

  normalizeSet(progressionType, raw) {
    const r = raw || {};
    if (progressionType === 'external_load') {
      return {
        weight: workoutNum(r.weight),
        reps: workoutNum(r.reps),
        rir: workoutClamp(workoutNum(r.rir), 0, 10),
      };
    }
    if (progressionType === 'tempo_then_load') {
      const stage = r.tempo_stage === undefined ? null : r.tempo_stage;
      return {
        reps: workoutNum(r.reps),
        rir: workoutClamp(workoutNum(r.rir), 0, 10),
        tempo_stage: ['normal', 'slow_eccentric'].includes(stage) ? stage : null,
        added_weight: workoutNum(r.added_weight) === null ? 0 : workoutNum(r.added_weight),
      };
    }
    if (progressionType === 'hold_duration') {
      return {
        variation: typeof r.variation === 'string' ? r.variation : null,
        duration_seconds: workoutNum(r.duration_seconds),
        // Reps: an alternate quantity for an exercise whose attempts are
        // counted rather than timed (Pogo Jumps -- see program.js's
        // hold_metric). Null for every other hold_duration exercise, which
        // keeps using duration_seconds exactly as before.
        reps: workoutNum(r.reps),
        // How many reps this timed attempt (a "set") held. A separate field
        // from `reps` on purpose: `reps` is the measured quantity for Pogo
        // Jumps and feeds holdMetricValue, so a timed hold's rep count must
        // never be read as seconds. Nothing in the progression engine uses it.
        hold_reps: workoutNum(r.hold_reps),
        // A subjective note or a device-supplied reading (e.g. ground contact
        // time), per attempt. Free text because "subjective" cannot be
        // constrained to a number.
        quality_note: typeof r.quality_note === 'string' && r.quality_note.trim()
          ? r.quality_note.trim() : null,
        attempt_number: workoutNum(r.attempt_number),
      };
    }
    if (progressionType === 'time_or_distance') {
      const restMode = r.rest_mode === 'hr_autoregulated' ? 'hr_autoregulated' : 'fixed';
      return {
        distance: workoutNum(r.distance),
        duration: workoutNum(r.duration),
        rest_between_reps: workoutNum(r.rest_between_reps),
        rep_count: workoutNum(r.rep_count),
        surface: typeof r.surface === 'string' && r.surface.trim() ? r.surface.trim() : null,
        is_test: r.is_test === true,
        // Fixed rest (a timer) or HR-autoregulated (next rep starts once HR
        // drops under a threshold). A per-session choice, not a global
        // setting, so it lives on the set like every other sprint field.
        rest_mode: restMode,
        hr_threshold_pct: restMode === 'hr_autoregulated'
          ? workoutClamp(workoutNum(r.hr_threshold_pct), 1, 100) : null,
        // Manual entry when no device supplies live HR. Null under fixed
        // rest -- there is nothing to autoregulate against.
        recovery_hr_bpm: restMode === 'hr_autoregulated' ? workoutNum(r.recovery_hr_bpm) : null,
      };
    }
    throw new Error(`unknown progression type: ${progressionType}`);
  },

  // A set with nothing in it is not a set. This is what keeps the frequently
  // skipped 3rd set from dragging an average down: it never enters one.
  setIsFilled(progressionType, set) {
    if (!set) return false;
    if (progressionType === 'external_load') return set.reps !== null || set.weight !== null;
    if (progressionType === 'tempo_then_load') return set.reps !== null;
    if (progressionType === 'hold_duration') {
      return set.duration_seconds !== null || set.reps !== null
        || (set.hold_reps !== null && set.hold_reps !== undefined);
    }
    if (progressionType === 'time_or_distance') {
      return set.distance !== null || set.duration !== null || set.rep_count !== null;
    }
    return false;
  },

  // The quantity a hold_duration set actually measures: seconds for a real
  // hold, reps for an exercise like Pogo Jumps that counts attempts instead
  // (see program.js's hold_metric). One accessor so holdProgression/holdTrend
  // don't need to know which exercise they're summing.
  holdMetricValue(set) {
    if (!set) return null;
    return set.duration_seconds !== null ? set.duration_seconds : set.reps;
  },

  filledSets(entry) {
    if (!entry || !Array.isArray(entry.sets)) return [];
    return entry.sets.filter(s => this.setIsFilled(entry.progression_type, s));
  },

  // --- writing ------------------------------------------------------------

  // The single write path for a session. Passing an existing id edits that
  // session in place -- including a backdated one -- and touches nothing else.
  saveSession(input) {
    const date = String((input && input.date) || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('a session needs a YYYY-MM-DD date');

    const sessions = this.rawSessions();
    const id = (input.id && sessions[input.id]) ? input.id : (input.id || workoutNewId());
    const existing = sessions[id] || null;
    const now = new Date().toISOString();

    const weekday = workoutWeekdayIndex(date);
    // A session is normally the day the date falls on. The log screen can also
    // browse another day's program for this date (input.template_day); the
    // session then records that day, so it is never mislabelled as the
    // scheduled one. An already-saved session keeps the day it was saved with.
    const templateDay = input.template_day !== undefined ? input.template_day
      : (existing && existing.day ? existing.day : null);
    const template = (templateDay && programWorkoutForDay(Number(templateDay)))
      || programWorkoutForWeekday(weekday);

    const existingEntries = (existing && existing.entries) || [];
    const sessionType = template ? (template.session_type || null) : (input.session_type || null);
    const entries = (Array.isArray(input.entries) ? input.entries : []).map(raw => {
      const exerciseId = raw && raw.exercise_id;
      const ex = programExercise(exerciseId);
      if (!ex) return null;
      const type = ex.progression_type;
      const cap = (type === 'hold_duration' || type === 'time_or_distance')
        ? Infinity : (ex.custom ? WORKOUT_CUSTOM_SET_CAP : WORKOUT_SET_CAP);
      const sets = (Array.isArray(raw.sets) ? raw.sets : [])
        .slice(0, cap === Infinity ? undefined : cap)
        .map(s => this.normalizeSet(type, s));
      // A quick-added exercise is offered on every day; one that was not
      // touched is not a logged exercise, so it is not stored.
      if (ex.custom && !sets.some(s => this.setIsFilled(type, s))) return null;

      // load_unit is stamped on the entry, so a later switch of the
      // exercise's unit never relabels what was logged under the old one. An
      // edit of an already-saved entry keeps the unit it was saved with.
      const prior = existingEntries.find(e => e.exercise_id === exerciseId);
      const requestedUnit = raw.load_unit !== undefined ? raw.load_unit
        : (prior ? this.entryLoadUnit(prior) : programLoadUnit(exerciseId));
      const loadUnit = LOAD_UNITS.includes(requestedUnit) ? requestedUnit : 'kg';
      const groupId = typeof raw.superset_group_id === 'string' && raw.superset_group_id
        ? raw.superset_group_id : null;
      const custom = ex.custom ? this.customExercises().find(e => e.id === exerciseId) : null;

      return {
        exercise_id: exerciseId,
        progression_type: type,
        ...(type === 'external_load' ? { load_unit: loadUnit } : {}),
        ...(groupId ? { superset_group_id: groupId } : {}),
        // Carried so another device that has never seen this exercise can
        // still read the session (see applyRegistry).
        ...(custom ? { exercise_def: custom } : {}),
        // Preserved from the caller if given (a migration supplies its own),
        // otherwise snapshotted from the program as it stands right now.
        prescribed: raw.prescribed !== undefined
          ? raw.prescribed
          : this.prescriptionFor(exerciseId, template ? template.day : null),
        tempo_stage: type === 'tempo_then_load'
          ? (raw.tempo_stage !== undefined ? raw.tempo_stage : this.tempoStage(exerciseId))
          : null,
        sets,
        ...(raw.migrated ? { migrated: true } : {}),
      };
    }).filter(Boolean);

    // A superset is exactly two exercises sharing a group id, in a strength
    // session. Anything else (a lone id, three sharing one, any id at all on a
    // Sprint + Legs day) is dropped here rather than stored, so the UI cannot
    // be the only thing enforcing it.
    const groupSizes = {};
    entries.forEach(e => {
      if (e.superset_group_id) groupSizes[e.superset_group_id] = (groupSizes[e.superset_group_id] || 0) + 1;
    });
    entries.forEach(e => {
      if (e.superset_group_id
        && (!programSessionAllowsSuperset(sessionType) || groupSizes[e.superset_group_id] !== 2)) {
        delete e.superset_group_id;
      }
    });

    const record = {
      id,
      date,
      weekday,
      weekday_name: workoutWeekdayName(date),
      day: template ? template.day : null,
      focus: template ? template.focus : (input.focus || null),
      session_type: sessionType,
      phase: input.phase !== undefined ? input.phase
        : (existing ? existing.phase : (this.activePhase() ? this.activePhase().name : null)),
      week: input.week !== undefined ? input.week : this.weekNumberFor(date),
      entries,
      recovery: this.normalizeRecovery(input.recovery),
      // Manually toggled, never inferred. Excludes this session from the
      // progression engine's deload signal (see externalLoadProgression/
      // tempoProgression) without hiding it from Insights/consistency, which
      // still see a completed training day either way.
      comeback_session: input.comeback_session !== undefined
        ? !!input.comeback_session
        : !!(existing && existing.comeback_session),
      created_at: existing ? existing.created_at : now,
      updated_at: now,
      ...(input.migrated ? { migrated: true } : {}),
      ...(existing && existing.migrated ? { migrated: true } : {}),
    };

    sessions[id] = record;
    this.saveJson(WORKOUT_KEYS.sessions, sessions);
    return record;
  },

  // Section 7: three fields, and that is the whole set. Sleep reuses the
  // existing from-times arithmetic rather than asking for a duration.
  normalizeRecovery(raw) {
    const r = raw || {};
    const from = r.sleep_from || null;
    const to = r.sleep_to || null;
    let minutes = workoutNum(r.sleep_minutes);
    if (minutes === null && from && to && typeof dailySleepDurationMinutes === 'function') {
      minutes = dailySleepDurationMinutes(from, to);
    }
    return {
      sleep_from: from,
      sleep_to: to,
      sleep_minutes: minutes,
      energy: workoutClamp(workoutNum(r.energy), 1, 10),
      soreness: workoutClamp(workoutNum(r.soreness), 1, 10),
    };
  },

  // Tombstoned, not spliced out: a bare delete would be resurrected by the
  // next sync from a device that still has the session. The UI asks for
  // confirmation before calling this.
  deleteSession(id) {
    const sessions = this.rawSessions();
    if (sessions[id]) { delete sessions[id]; this.saveJson(WORKOUT_KEYS.sessions, sessions); }
    const dead = this.deletedIds();
    if (!dead.includes(id)) { dead.push(id); this.saveJson(WORKOUT_KEYS.deleted, dead); }
    return id;
  },

  // --- the progression engine --------------------------------------------
  //
  // Reads the log, returns suggestions. Never writes.

  // Every session that logged filled sets of this exercise, oldest first.
  historyFor(exerciseId) {
    return this.sessions()
      .map(s => {
        const entry = (s.entries || []).find(e => e.exercise_id === exerciseId);
        if (!entry) return null;
        const sets = this.filledSets(entry);
        return sets.length ? { session: s, entry, sets } : null;
      })
      .filter(Boolean);
  },

  // Hours since the most recent PRIOR session (strictly before dateIso) that
  // logged a filled set of this exercise, or null if never logged before
  // that date. Day-granular like the rest of the model -- sessions carry a
  // date, not a time of day -- so this is (days * 24), not sub-day
  // precision. Used for a soft minimum-gap warning (see program.js's
  // min_gap_hours), never a hard block.
  hoursSinceLastLogged(exerciseId, dateIso) {
    const before = this.historyFor(exerciseId).filter(h => h.session.date < dateIso);
    if (!before.length) return null;
    const last = before[before.length - 1];
    const a = Date.parse(`${last.session.date}T00:00:00Z`);
    const b = Date.parse(`${dateIso}T00:00:00Z`);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return Math.round((b - a) / 3600000);
  },

  // Average RIR across filled sets, or null when no set recorded one. Null is
  // load-bearing: a migrated session has no RIR, and must therefore never
  // satisfy an RIR condition rather than satisfying it by accident at 0.
  averageRir(sets) {
    const vals = sets.map(s => s.rir).filter(v => v !== null && v !== undefined);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  },

  // Did this session meet "every filled set at the top of the rep range, with
  // average RIR <= 2"? Returns null when it cannot be told -- an AMRAP set has
  // no top of range, and a session with no RIR has no average.
  metTopOfRange(sets, prescribed, maxRir = WORKOUT_MAX_RIR_FOR_PROGRESSION) {
    if (!prescribed || !prescribed.rep_range) return null;
    const [low, high] = prescribed.rep_range;
    if (high === null || high === undefined || prescribed.amrap) return null;
    if (!sets.length) return null;
    const reps = sets.map(s => s.reps).filter(v => v !== null);
    if (reps.length !== sets.length) return null;
    const avgRir = this.averageRir(sets);
    if (avgRir === null) return null;
    return reps.every(r => r >= high) && avgRir <= maxRir
      ? true : false;
  },

  // The "no progression" side of the rule, which is a separate question from
  // the one above: a set under the bottom of the range, or an average RIR of
  // 0, means the session was too hard rather than merely not easy enough.
  sessionWasTooHard(sets, prescribed) {
    if (!prescribed || !prescribed.rep_range) return false;
    const [low] = prescribed.rep_range;
    const reps = sets.map(s => s.reps).filter(v => v !== null);
    if (low !== null && low !== undefined && reps.some(r => r < low)) return true;
    const avgRir = this.averageRir(sets);
    return avgRir === 0;
  },

  progressionFor(exerciseId) {
    const ex = programExercise(exerciseId);
    if (!ex) return null;
    const history = this.historyFor(exerciseId);
    if (!history.length) {
      return { exercise_id: exerciseId, flag: null, reason: 'no_sessions_logged', history: 0 };
    }
    const type = ex.progression_type;
    if (type === 'external_load') return this.externalLoadProgression(exerciseId, history);
    if (type === 'tempo_then_load') return this.tempoProgression(exerciseId, history);
    if (type === 'hold_duration') return this.holdProgression(exerciseId, history);
    return this.timeDistanceProgression(exerciseId, history);
  },

  externalLoadProgression(exerciseId, history) {
    const last = history[history.length - 1];
    const inSuperset = !!last.entry.superset_group_id;
    const unit = this.entryLoadUnit(last.entry);
    const base = {
      exercise_id: exerciseId, flag: null, history: history.length, last_date: last.session.date,
      load_unit: unit, superset: inSuperset,
    };
    // In a superset the bar is stricter: average RIR 1 or lower rather than 2,
    // because pairing adds fatigue the raw numbers do not show.
    const maxRir = inSuperset
      ? WORKOUT_MAX_RIR_FOR_SUPERSET_PROGRESSION : WORKOUT_MAX_RIR_FOR_PROGRESSION;
    const met = this.metTopOfRange(last.sets, last.entry.prescribed, maxRir);
    // The two rules are separate conditions, and this one wins: a session at
    // the top of the range that was nonetheless taken to RIR 0, or that had a
    // set fall under the bottom, is not a session to add load to.
    const lastWasTooHard = this.sessionWasTooHard(last.sets, last.entry.prescribed);

    if (met === true && !lastWasTooHard) {
      return {
        ...base,
        flag: WORKOUT_FLAGS.progressionAvailable,
        suggestion: (unit === 'plates'
          ? `Add ${PLATE_INCREMENT === 1 ? '1 plate' : `${PLATE_INCREMENT} plates`}, `
          : 'Add the smallest increment the equipment allows, about 2.5 to 5%, ')
          + 'and start back at the bottom of the rep range next session.',
      };
    }

    // Two consecutive too-hard sessions is the deload condition. One is not.
    // A comeback session is invisible to this streak -- see
    // deloadStreakIsTooHard -- so it can never itself trigger the flag or
    // count as one of the two.
    if (this.deloadStreakIsTooHard(history)) {
      return {
        ...base,
        flag: WORKOUT_FLAGS.deloadSuggested,
        suggestion: 'Two sessions in a row came in under the rep range or at RIR 0. '
          + 'Consider dropping the load for a session.',
      };
    }
    // In a superset, say why the normal bar being met was not enough.
    if (inSuperset && met === false
      && this.metTopOfRange(last.sets, last.entry.prescribed) === true && !lastWasTooHard) {
      return { ...base, reason: 'superset_needs_rir_1' };
    }
    return { ...base, reason: met === null ? 'not_enough_detail_logged' : 'in_range' };
  },

  // Two consecutive too-hard sessions, skipping any comeback_session
  // entirely: it counts neither toward nor against the streak, so an
  // intentionally reduced session can never itself trigger a deload
  // suggestion, and doesn't break a streak spanning around it either.
  deloadStreakIsTooHard(history) {
    const counted = history.filter(h => !h.session.comeback_session);
    const tooHard = counted.slice(-2).map(h => this.sessionWasTooHard(h.sets, h.entry.prescribed));
    return tooHard.length === 2 && tooHard.every(Boolean);
  },

  tempoProgression(exerciseId, history) {
    const last = history[history.length - 1];
    const stage = this.tempoStage(exerciseId);
    const base = {
      exercise_id: exerciseId, flag: null, history: history.length,
      last_date: last.session.date, tempo_stage: stage,
    };
    const met = this.metTopOfRange(last.sets, last.entry.prescribed);
    const lastWasTooHard = this.sessionWasTooHard(last.sets, last.entry.prescribed);

    if (met === true && !lastWasTooHard && stage === 'normal') {
      return {
        ...base,
        flag: WORKOUT_FLAGS.tempoAdvance,
        suggestion: 'Move this exercise to a slow eccentric, 3 to 4 seconds lowering, '
          + 'and start back at the bottom of the rep range.',
      };
    }
    if (met === true && !lastWasTooHard && stage === 'slow_eccentric') {
      return {
        ...base,
        flag: WORKOUT_FLAGS.addedWeightNext,
        suggestion: 'The slow tempo is at the top of the range. Adding weight is the '
          + 'next step, a vest or a loaded backpack.',
      };
    }
    if (this.deloadStreakIsTooHard(history)) {
      return {
        ...base,
        flag: WORKOUT_FLAGS.deloadSuggested,
        suggestion: 'Two sessions in a row came in under the rep range or at RIR 0. '
          + 'Consider easing the tempo or the added weight for a session.',
      };
    }
    // AMRAP has no top of range to reach, so a stage advance can never be
    // computed for it. The trend is shown instead of a flag being invented.
    const amrap = last.entry.prescribed && last.entry.prescribed.amrap;
    return { ...base, reason: amrap ? 'amrap_has_no_top_of_range' : (met === null ? 'not_enough_detail_logged' : 'in_range') };
  },

  holdProgression(exerciseId, history) {
    const ex = programExercise(exerciseId);
    // "seconds" for a real hold, "reps" for an exercise like Pogo Jumps that
    // counts attempts instead. Only the copy differs -- the summation below
    // reads whichever field holdMetricValue finds, in either case.
    const metric = ex.hold_metric === 'reps' ? 'reps' : 'seconds';
    const threshold = this.settings().hold_variation_threshold_s;
    const last = history[history.length - 1];
    const variation = last.sets.map(s => s.variation).find(v => v) || this.holdVariation(exerciseId);

    const valueFor = s => (s.variation === variation ? this.holdMetricValue(s) : null);
    const sumFor = h => h.sets
      .map(valueFor).filter(v => v !== null)
      .reduce((a, v) => a + v, 0);

    const lastSum = sumFor(last);
    // The comparison is against the previous session *at the same variation*:
    // moving up the ladder resets the numbers, and comparing across variations
    // would read that as a collapse.
    const prior = history.slice(0, -1).reverse()
      .find(h => h.sets.some(s => valueFor(s) !== null));
    const priorSum = prior ? sumFor(prior) : null;

    const longest = last.sets
      .map(valueFor).filter(v => v !== null)
      .reduce((m, v) => Math.max(m, v), 0);

    const base = {
      exercise_id: exerciseId, flag: null, history: history.length,
      last_date: last.session.date, variation,
      total_seconds: lastSum, previous_total_seconds: priorSum,
      // A rising total is a positive trend, displayed. Nothing gates on it.
      trend: priorSum === null ? null : (lastSum > priorSum ? 'up' : (lastSum < priorSum ? 'down' : 'flat')),
      longest_attempt_s: longest,
      attempts: last.sets.filter(s => s.variation === variation).length,
    };

    const nextVariation = ex.variations[ex.variations.indexOf(variation) + 1] || null;
    if (longest > threshold && nextVariation) {
      const longestLabel = metric === 'reps' ? `${longest} reps` : `${longest}s`;
      const thresholdLabel = metric === 'reps' ? `${threshold}-rep` : `${threshold}s`;
      return {
        ...base,
        flag: WORKOUT_FLAGS.variationAdvance,
        next_variation: nextVariation,
        suggestion: metric === 'reps'
          ? `Longest set was ${longestLabel}, past the ${thresholdLabel} mark. `
            + `Moving to ${nextVariation.replace(/_/g, ' ')} is the next step when you want it.`
          : `Longest hold was ${longestLabel}, past the ${thresholdLabel} mark. `
            + `Moving to ${nextVariation.replace(/_/g, ' ')} is the next step when you want it.`,
      };
    }
    return base;
  },

  // Endurance does not progress like strength, so there is no flag here by
  // design -- only the series, for the UI to draw.
  timeDistanceProgression(exerciseId, history) {
    const points = history.map(h => ({
      date: h.session.date,
      sets: h.sets.map(s => ({ ...s })),
      best_duration: h.sets.map(s => s.duration).filter(v => v !== null).sort((a, b) => a - b)[0] ?? null,
      best_distance: h.sets.map(s => s.distance).filter(v => v !== null).sort((a, b) => b - a)[0] ?? null,
      is_test: h.sets.some(s => s.is_test),
    }));
    return {
      exercise_id: exerciseId,
      flag: WORKOUT_FLAGS.trendOnly,
      history: history.length,
      last_date: history[history.length - 1].session.date,
      points,
      suggestion: null,
    };
  },

  // --- dashboard aggregates ----------------------------------------------

  // Section 8: a progression series per exercise, not a session count.
  strengthSeries(exerciseId) {
    const ex = programExercise(exerciseId);
    if (!ex) return [];
    return this.historyFor(exerciseId).map(h => {
      const reps = h.sets.map(s => s.reps).filter(v => v !== null);
      const weights = h.sets.map(s => s.weight).filter(v => v !== null && v !== undefined);
      return {
        date: h.session.date,
        best_reps: reps.length ? Math.max(...reps) : null,
        top_weight: weights.length ? Math.max(...weights) : null,
        // What top_weight is counted in for this session: kg, or plates.
        load_unit: this.entryLoadUnit(h.entry),
        total_reps: reps.reduce((a, b) => a + b, 0),
        sets: h.sets.length,
      };
    });
  },

  // Weekly total sets per category, only counting filled sets. Keyed by the
  // ISO date of the week's Sunday, since the training week runs Sun-Thu.
  //
  // Sets logged as part of a superset count 1.2x here, to reflect the added
  // difficulty. That is a property of this aggregate only: the sets, reps and
  // loads in the log are never scaled. weighted:false gives the plain count.
  weeklyVolumeByCategory({ weighted = true } = {}) {
    const out = {};
    this.sessions().forEach(s => {
      const key = this.weekStartIso(s.date);
      out[key] = out[key] || { push: 0, pull: 0, legs: 0, skill: 0, conditioning: 0, other: 0 };
      (s.entries || []).forEach(entry => {
        const cat = programCategoryOf(entry.exercise_id);
        if (!cat || out[key][cat] === undefined) return;
        const factor = weighted && entry.superset_group_id ? WORKOUT_SUPERSET_VOLUME_MULTIPLIER : 1;
        out[key][cat] += this.filledSets(entry).length * factor;
      });
    });
    // One decimal is plenty, and it keeps 3 * 1.2 from printing as 3.5999999.
    Object.values(out).forEach(week => {
      Object.keys(week).forEach(cat => { week[cat] = Math.round(week[cat] * 10) / 10; });
    });
    return out;
  },

  // The Sunday of the week a date falls in, as an ISO string.
  weekStartIso(dateIso) {
    const t = Date.parse(`${dateIso}T00:00:00Z`);
    if (Number.isNaN(t)) return dateIso;
    const d = new Date(t);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.toISOString().slice(0, 10);
  },

  // Best (lowest) sprint time per session, excluding test entries so a Cooper
  // run can never look like a fast 10m.
  sprintTrend() {
    return this.historyFor('sprints').map(h => {
      const times = h.sets.filter(s => !s.is_test).map(s => s.duration).filter(v => v !== null);
      return {
        date: h.session.date,
        best: times.length ? Math.min(...times) : null,
        reps: h.sets.length,
        distance: h.sets.map(s => s.distance).filter(v => v !== null)[0] ?? null,
      };
    });
  },

  cooperTrend() {
    return this.historyFor('cooper_test')
      .map(h => ({
        date: h.session.date,
        distance: h.sets.map(s => s.distance).filter(v => v !== null).sort((a, b) => b - a)[0] ?? null,
      }))
      .filter(p => p.distance !== null);
  },

  // Hold duration trend per variation, so moving up the ladder starts a new
  // series rather than looking like a regression in the old one.
  holdTrend(exerciseId) {
    const out = {};
    this.historyFor(exerciseId).forEach(h => {
      const byVariation = {};
      h.sets.forEach(s => {
        const value = this.holdMetricValue(s);
        if (!s.variation || value === null) return;
        byVariation[s.variation] = byVariation[s.variation] || { total: 0, longest: 0, attempts: 0 };
        byVariation[s.variation].total += value;
        byVariation[s.variation].longest = Math.max(byVariation[s.variation].longest, value);
        byVariation[s.variation].attempts += 1;
      });
      Object.entries(byVariation).forEach(([variation, agg]) => {
        out[variation] = out[variation] || [];
        out[variation].push({ date: h.session.date, ...agg });
      });
    });
    return out;
  },

  // --- weekly review ------------------------------------------------------
  //
  // Section 6: real logged data only. No generated advice, one conditional
  // plain-language note, and nothing that editorialises past it.

  // How many of the week's five training days are actually asked of the
  // owner -- WEEK_TEMPLATE.length, minus any that Personal OS has marked a
  // holiday/Shabbat. A holiday must not read as a missed session, so it
  // comes out of the denominator rather than staying uncompleted in it.
  // Reads DAILY defensively: under plain Node (test_workout_logic.js loads
  // only program.js/workout.js) DAILY does not exist, and nothing is marked
  // a holiday, so the count is simply unaffected.
  scheduledSessionsInWeek(weekStartIso) {
    const start = Date.parse(`${weekStartIso}T00:00:00Z`);
    const hasDaily = typeof DAILY !== 'undefined' && DAILY && typeof DAILY.days === 'function';
    const days = hasDaily ? DAILY.days() : {};
    let scheduled = 0;
    for (let i = 0; i < 7; i++) {
      const iso = new Date(start + i * 86400000).toISOString().slice(0, 10);
      const weekday = new Date(start + i * 86400000).getUTCDay();
      if (!programIsTrainingDay(weekday)) continue;
      if (days[iso] && days[iso].is_holiday) continue;
      scheduled += 1;
    }
    return scheduled;
  },

  weeklyReview(weekStartIso = this.weekStartIso(workoutTodayIso())) {
    const start = Date.parse(`${weekStartIso}T00:00:00Z`);
    const inWeek = d => {
      const t = Date.parse(`${d}T00:00:00Z`);
      return t >= start && t < start + 7 * 86400000;
    };
    const sessions = this.sessions().filter(s => inWeek(s.date));
    const scheduled = this.scheduledSessionsInWeek(weekStartIso);

    // Trend arrows come from the engine's own numbers, not a second judgement.
    const trends = programTrackedExerciseIds().map(id => {
      const p = this.progressionFor(id);
      const ex = programExercise(id);
      let arrow = '→';
      if (p && p.flag === WORKOUT_FLAGS.progressionAvailable) arrow = '↑';
      else if (p && p.flag === WORKOUT_FLAGS.tempoAdvance) arrow = '↑';
      else if (p && p.flag === WORKOUT_FLAGS.addedWeightNext) arrow = '↑';
      else if (p && p.flag === WORKOUT_FLAGS.variationAdvance) arrow = '↑';
      else if (p && p.trend === 'up') arrow = '↑';
      else if (p && p.flag === WORKOUT_FLAGS.deloadSuggested) arrow = '↓';
      else if (p && p.trend === 'down') arrow = '↓';
      return { exercise_id: id, name: ex.name, arrow, flag: p ? p.flag : null, logged: p ? p.history : 0 };
    }).filter(t => t.logged > 0);

    const sleepMinutes = sessions
      .map(s => s.recovery && s.recovery.sleep_minutes)
      .filter(v => v !== null && v !== undefined);
    // Falls back to the Personal OS check-in, which already records sleep from
    // bed and wake times, rather than reporting nothing when the recovery
    // fields were left blank.
    let sleepAvg = sleepMinutes.length
      ? Math.round(sleepMinutes.reduce((a, b) => a + b, 0) / sleepMinutes.length) : null;
    if (sleepAvg === null && typeof DAILY !== 'undefined' && DAILY && typeof DAILY.days === 'function') {
      const fromDaily = Object.entries(DAILY.days())
        .filter(([date]) => inWeek(date))
        .map(([, rec]) => rec && rec.sleep_minutes)
        .filter(v => v !== null && v !== undefined && v > 0);
      if (fromDaily.length) {
        sleepAvg = Math.round(fromDaily.reduce((a, b) => a + b, 0) / fromDaily.length);
      }
    }

    const sprint = this.sprintTrend().filter(p => inWeek(p.date) && p.best !== null);
    const cooper = this.cooperTrend();

    return {
      week_start: weekStartIso,
      sessions_completed: sessions.length,
      sessions_scheduled: scheduled,
      trends,
      sprint_best: sprint.length ? Math.min(...sprint.map(p => p.best)) : null,
      sprint_points: this.sprintTrend().map(p => ({ date: p.date, best: p.best })),
      cooper_points: cooper,
      sleep_avg_minutes: sleepAvg,
      // The single conditional note, and the only interpretation offered.
      note: (sleepAvg !== null && sleepAvg < 420)
        ? 'Sleep averaged under 7h this week, which is the most likely limiting '
          + 'factor on the numbers above.'
        : null,
    };
  },

  // --- migration ----------------------------------------------------------

  // Reads the old flat model and writes the equivalent sessions in the new
  // shape. Idempotent: an already-migrated session id is skipped, so running
  // it twice cannot duplicate history.
  //
  // Nothing is invented. The old log recorded reps and nothing else, so weight
  // and RIR land as null, and a null RIR can never satisfy a progression
  // condition -- a migrated session is history, not evidence of readiness.
  migrateLegacyTraining(legacyPayload) {
    const captured = this.loadJson(WORKOUT_LEGACY_KEYS.captured, []) || [];
    const fromServer = (legacyPayload && Array.isArray(legacyPayload.sessions))
      ? legacyPayload.sessions : [];
    const edits = this.loadJson(WORKOUT_LEGACY_KEYS.edits, {}) || {};
    const legacyDeleted = new Set(this.loadJson(WORKOUT_LEGACY_KEYS.deleted, []) || []);

    const byId = {};
    [...fromServer, ...captured].forEach(s => {
      if (s && typeof s.id === 'string' && !legacyDeleted.has(s.id)) byId[s.id] = s;
    });

    const already = this.loadJson(WORKOUT_KEYS.migrated, []) || [];
    const done = new Set(already);
    const result = { migrated: 0, skipped: 0, sessions: [], unmapped: [] };

    Object.values(byId).forEach(old => {
      const newId = `migrated-${old.id}`;
      if (done.has(old.id) || this.rawSessions()[newId] || this.deletedIds().includes(newId)) {
        result.skipped += 1;
        return;
      }
      const drills = { ...(old.drills || {}), ...((edits[old.id]) || {}) };
      const entries = Object.entries(drills).map(([drillId, reps]) => {
        const exerciseId = WORKOUT_LEGACY_DRILL_MAP[drillId];
        if (!exerciseId) { result.unmapped.push({ session: old.id, drill: drillId }); return null; }
        const type = programProgressionType(exerciseId);
        const sets = (Array.isArray(reps) ? reps : []).slice(0, WORKOUT_SET_CAP).map(r => (
          type === 'tempo_then_load'
            // tempo_stage stays null: the old log never recorded a tempo, and
            // defaulting it to 'normal' would assert something never measured.
            ? { reps: workoutNum(r), rir: null, tempo_stage: null, added_weight: 0 }
            : { weight: null, reps: workoutNum(r), rir: null }
        ));
        return {
          exercise_id: exerciseId,
          progression_type: type,
          // No prescription existed in the old model, so there is none to
          // snapshot. Null, not a back-dated guess at one.
          prescribed: null,
          tempo_stage: null,
          sets,
          migrated: true,
        };
      }).filter(Boolean);

      const record = this.saveSession({
        id: newId,
        date: old.date,
        entries,
        phase: null,
        week: null,
        migrated: true,
      });
      // saveSession stamps created_at as now; the original log time is the
      // honest value for a backdated import.
      const sessions = this.rawSessions();
      sessions[newId] = { ...record, created_at: old.logged_at || record.created_at, legacy_id: old.id };
      this.saveJson(WORKOUT_KEYS.sessions, sessions);

      done.add(old.id);
      result.migrated += 1;
      result.sessions.push({ id: newId, date: old.date, entries: entries.length });
    });

    this.saveJson(WORKOUT_KEYS.migrated, [...done]);
    return result;
  },

  // --- backup -------------------------------------------------------------

  exportAll() {
    return {
      kind: 'jarvis-workout-backup',
      version: 1,
      exported_at: new Date().toISOString(),
      sessions: this.rawSessions(),
      deleted: this.deletedIds(),
      settings: this.settings(),
      custom_exercises: this.customExercises(),
    };
  },

  importAll(payload) {
    if (!payload || payload.kind !== 'jarvis-workout-backup') {
      throw new Error('not a Jarvis workout backup file');
    }
    const sessions = this.rawSessions();
    let restored = 0;
    Object.entries(payload.sessions || {}).forEach(([id, rec]) => {
      if (!rec || typeof rec !== 'object' || typeof rec.date !== 'string') return;
      const existing = sessions[id];
      if (!existing || String(rec.updated_at || '') > String(existing.updated_at || '')) {
        sessions[id] = rec;
        restored += 1;
      }
    });
    this.saveJson(WORKOUT_KEYS.sessions, sessions);
    if (Array.isArray(payload.deleted)) {
      this.saveJson(WORKOUT_KEYS.deleted, [...new Set([...this.deletedIds(), ...payload.deleted])]);
    }
    if (Array.isArray(payload.custom_exercises)) {
      const have = new Set(this.customExercises().map(e => e.id));
      const added = payload.custom_exercises.filter(e => e && typeof e.id === 'string' && !have.has(e.id));
      if (added.length) this.saveJson(WORKOUT_KEYS.customExercises, [...this.customExercises(), ...added]);
    }
    if (payload.settings) this.saveSettings(payload.settings);
    this.applyRegistry();
    return { sessions: restored };
  },

  // --- sync ---------------------------------------------------------------

  syncConfig() {
    try {
      return {
        url: (localStorage.getItem(WORKOUT_KEYS.syncUrl)
          || localStorage.getItem('jarvis:training:syncUrl') || '').replace(/\/+$/, ''),
        token: localStorage.getItem(WORKOUT_KEYS.syncToken)
          || localStorage.getItem('jarvis:training:syncToken') || '',
      };
    } catch (e) {
      return { url: '', token: '' };
    }
  },

  // The pre-rebuild log as the sync server still holds it. Read-only: the old
  // endpoint is never written by anything in the new model, so this cannot
  // damage the migration source.
  //
  // This matters because dashboard_data/training.json stopped being published
  // (it moved to the private tier), so the published feed is no longer a
  // reliable place to find sessions logged on another device. The server store
  // is.
  fetchLegacyServerState() {
    const { url, token } = this.syncConfig();
    if (!url || !token) return Promise.resolve(null);
    return fetch(`${url}/training`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
  },

  // Offline-first, same contract as the Personal OS sync: the local write has
  // already happened and rendered; this is a best-effort reconciliation and
  // never blocks the UI.
  syncWithServer() {
    const { url, token } = this.syncConfig();
    if (!url || !token) return Promise.resolve(null);
    return fetch(`${url}/workout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sessions: this.rawSessions(), deleted: this.deletedIds() }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(state => {
        if (!state) return null;
        const sessions = this.rawSessions();
        let changed = false;
        Object.entries(state.sessions || {}).forEach(([id, rec]) => {
          if (!rec || typeof rec.date !== 'string') return;
          const mine = sessions[id];
          if (!mine || String(rec.updated_at || '') > String(mine.updated_at || '')) {
            sessions[id] = rec; changed = true;
          }
        });
        if (changed) this.saveJson(WORKOUT_KEYS.sessions, sessions);
        if (Array.isArray(state.deleted) && state.deleted.length) {
          this.saveJson(WORKOUT_KEYS.deleted, [...new Set([...this.deletedIds(), ...state.deleted])]);
        }
        // A synced session may use an exercise added on another device.
        if (changed) this.applyRegistry();
        return state;
      })
      .catch(() => null);
  },
};

// Hand program.js the exercises added from the app, and any per-exercise
// overrides, before anything reads the program.
try { WORKOUT.applyRegistry(); } catch (e) { /* storage unavailable: static program only */ }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WORKOUT,
    WORKOUT_KEYS,
    WORKOUT_FLAGS,
    WORKOUT_LEGACY_KEYS,
    WORKOUT_LEGACY_DRILL_MAP,
    WORKOUT_DEFAULT_SETTINGS,
    WORKOUT_SUPERSET_VOLUME_MULTIPLIER,
    WORKOUT_MAX_RIR_FOR_SUPERSET_PROGRESSION,
    WORKOUT_CUSTOM_SET_CAP,
    workoutNum,
    workoutTodayIso,
    workoutWeekdayIndex,
    workoutWeekdayName,
  };
}
