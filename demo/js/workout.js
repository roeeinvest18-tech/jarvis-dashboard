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
};

const WORKOUT_MAX_RIR_FOR_PROGRESSION = 2;
const WORKOUT_SET_CAP = 3;

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
    };
  },

  saveSettings(patch) {
    const next = { ...this.settings(), ...patch };
    this.saveJson(WORKOUT_KEYS.settings, next);
    return next;
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
        attempt_number: workoutNum(r.attempt_number),
      };
    }
    if (progressionType === 'time_or_distance') {
      return {
        distance: workoutNum(r.distance),
        duration: workoutNum(r.duration),
        rest_between_reps: workoutNum(r.rest_between_reps),
        rep_count: workoutNum(r.rep_count),
        surface: typeof r.surface === 'string' && r.surface.trim() ? r.surface.trim() : null,
        is_test: r.is_test === true,
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
    if (progressionType === 'hold_duration') return set.duration_seconds !== null;
    if (progressionType === 'time_or_distance') {
      return set.distance !== null || set.duration !== null || set.rep_count !== null;
    }
    return false;
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
    const template = programWorkoutForWeekday(weekday);

    const entries = (Array.isArray(input.entries) ? input.entries : []).map(raw => {
      const exerciseId = raw && raw.exercise_id;
      const ex = programExercise(exerciseId);
      if (!ex) return null;
      const type = ex.progression_type;
      const cap = (type === 'hold_duration' || type === 'time_or_distance')
        ? Infinity : WORKOUT_SET_CAP;
      const sets = (Array.isArray(raw.sets) ? raw.sets : [])
        .slice(0, cap === Infinity ? undefined : cap)
        .map(s => this.normalizeSet(type, s));
      return {
        exercise_id: exerciseId,
        progression_type: type,
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

    const record = {
      id,
      date,
      weekday,
      weekday_name: workoutWeekdayName(date),
      day: template ? template.day : null,
      focus: template ? template.focus : (input.focus || null),
      phase: input.phase !== undefined ? input.phase
        : (existing ? existing.phase : (this.activePhase() ? this.activePhase().name : null)),
      week: input.week !== undefined ? input.week : this.weekNumberFor(date),
      entries,
      recovery: this.normalizeRecovery(input.recovery),
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
  metTopOfRange(sets, prescribed) {
    if (!prescribed || !prescribed.rep_range) return null;
    const [low, high] = prescribed.rep_range;
    if (high === null || high === undefined || prescribed.amrap) return null;
    if (!sets.length) return null;
    const reps = sets.map(s => s.reps).filter(v => v !== null);
    if (reps.length !== sets.length) return null;
    const avgRir = this.averageRir(sets);
    if (avgRir === null) return null;
    return reps.every(r => r >= high) && avgRir <= WORKOUT_MAX_RIR_FOR_PROGRESSION
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
    const base = { exercise_id: exerciseId, flag: null, history: history.length, last_date: last.session.date };
    const met = this.metTopOfRange(last.sets, last.entry.prescribed);
    // The two rules are separate conditions, and this one wins: a session at
    // the top of the range that was nonetheless taken to RIR 0, or that had a
    // set fall under the bottom, is not a session to add load to.
    const lastWasTooHard = this.sessionWasTooHard(last.sets, last.entry.prescribed);

    if (met === true && !lastWasTooHard) {
      return {
        ...base,
        flag: WORKOUT_FLAGS.progressionAvailable,
        suggestion: 'Add the smallest increment the equipment allows, about 2.5 to 5%, '
          + 'and start back at the bottom of the rep range next session.',
      };
    }

    // Two consecutive too-hard sessions is the deload condition. One is not.
    const tooHard = history.slice(-2).map(h => this.sessionWasTooHard(h.sets, h.entry.prescribed));
    if (tooHard.length === 2 && tooHard.every(Boolean)) {
      return {
        ...base,
        flag: WORKOUT_FLAGS.deloadSuggested,
        suggestion: 'Two sessions in a row came in under the rep range or at RIR 0. '
          + 'Consider dropping the load for a session.',
      };
    }
    return { ...base, reason: met === null ? 'not_enough_detail_logged' : 'in_range' };
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
    const tooHard = history.slice(-2).map(h => this.sessionWasTooHard(h.sets, h.entry.prescribed));
    if (tooHard.length === 2 && tooHard.every(Boolean)) {
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
    const threshold = this.settings().hold_variation_threshold_s;
    const last = history[history.length - 1];
    const variation = last.sets.map(s => s.variation).find(v => v) || this.holdVariation(exerciseId);

    const sumFor = h => h.sets
      .filter(s => s.variation === variation && s.duration_seconds !== null)
      .reduce((a, s) => a + s.duration_seconds, 0);

    const lastSum = sumFor(last);
    // The comparison is against the previous session *at the same variation*:
    // moving up the ladder resets the numbers, and comparing across variations
    // would read that as a collapse.
    const prior = history.slice(0, -1).reverse()
      .find(h => h.sets.some(s => s.variation === variation && s.duration_seconds !== null));
    const priorSum = prior ? sumFor(prior) : null;

    const longest = last.sets
      .filter(s => s.variation === variation && s.duration_seconds !== null)
      .reduce((m, s) => Math.max(m, s.duration_seconds), 0);

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
      return {
        ...base,
        flag: WORKOUT_FLAGS.variationAdvance,
        next_variation: nextVariation,
        suggestion: `Longest hold was ${longest}s, past the ${threshold}s mark. `
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
        total_reps: reps.reduce((a, b) => a + b, 0),
        sets: h.sets.length,
      };
    });
  },

  // Weekly total sets per category, only counting filled sets. Keyed by the
  // ISO date of the week's Sunday, since the training week runs Sun-Thu.
  weeklyVolumeByCategory() {
    const out = {};
    this.sessions().forEach(s => {
      const key = this.weekStartIso(s.date);
      out[key] = out[key] || { push: 0, pull: 0, legs: 0, skill: 0, conditioning: 0 };
      (s.entries || []).forEach(entry => {
        const cat = programCategoryOf(entry.exercise_id);
        if (!cat || out[key][cat] === undefined) return;
        out[key][cat] += this.filledSets(entry).length;
      });
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
        if (!s.variation || s.duration_seconds === null) return;
        byVariation[s.variation] = byVariation[s.variation] || { total: 0, longest: 0, attempts: 0 };
        byVariation[s.variation].total += s.duration_seconds;
        byVariation[s.variation].longest = Math.max(byVariation[s.variation].longest, s.duration_seconds);
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

  weeklyReview(weekStartIso = this.weekStartIso(workoutTodayIso())) {
    const start = Date.parse(`${weekStartIso}T00:00:00Z`);
    const inWeek = d => {
      const t = Date.parse(`${d}T00:00:00Z`);
      return t >= start && t < start + 7 * 86400000;
    };
    const sessions = this.sessions().filter(s => inWeek(s.date));
    const scheduled = WEEK_TEMPLATE.length;

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
    if (payload.settings) this.saveSettings(payload.settings);
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
        return state;
      })
      .catch(() => null);
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WORKOUT,
    WORKOUT_KEYS,
    WORKOUT_FLAGS,
    WORKOUT_LEGACY_KEYS,
    WORKOUT_LEGACY_DRILL_MAP,
    WORKOUT_DEFAULT_SETTINGS,
    workoutNum,
    workoutTodayIso,
    workoutWeekdayIndex,
    workoutWeekdayName,
  };
}
