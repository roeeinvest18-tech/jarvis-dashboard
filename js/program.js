// The training PROGRAM: what is prescribed. Never what happened.
//
// This file is the prescription half of the three-way split the Training
// rebuild is built around:
//
//     program (this file)  ->  what you are meant to do
//     log (workout.js)     ->  what you actually did
//     analysis (workout.js)->  whether it is working
//
// Keeping them apart is the whole point. The old model had one flat table
// where "3 sets" was simultaneously the plan and the record, so there was no
// way to ask "did I follow the program?" -- the question had no referent.
//
// Everything here is static data plus pure lookups. No DOM, no storage, no
// dates beyond arithmetic on ISO strings, so test_workout_logic.js can load
// it under plain Node.

// --- Exercise entities ----------------------------------------------------
//
// An exercise is an entity, not a string on a workout row. Two days can
// reference the same Chest Press and the progression engine then sees one
// history for it rather than two unrelated columns -- which is exactly what
// the old drill-name model got wrong.
//
// progression_type drives BOTH the shape of a logged set and which
// progression rule applies, so it lives on the exercise, once.

const PROGRESSION_TYPES = ['external_load', 'tempo_then_load', 'hold_duration', 'time_or_distance'];

// variations[] is ordered easy -> hard and only exists for hold_duration
// exercises: it is the progression axis for a skill you cannot add 2.5kg to.
const EXERCISES = [
  {
    id: 'chest_press',
    name: 'Chest Press',
    category: 'push',
    movement_pattern: 'horizontal_push',
    primary_muscles: ['chest', 'triceps', 'front_delts'],
    equipment: 'machine_or_barbell',
    progression_type: 'external_load',
    variations: [],
    why: 'Horizontal pushing strength and chest/triceps development.',
    rationale: 'The horizontal press is the highest-leverage way to load the '
      + 'chest, front delts and triceps together. Loading it externally means '
      + 'progression is a number you can read off the machine rather than a '
      + 'judgement call, which is why it anchors both upper days.',
  },
  {
    id: 'incline_fly',
    name: 'Incline Fly',
    category: 'push',
    movement_pattern: 'horizontal_push',
    primary_muscles: ['chest', 'front_delts'],
    equipment: 'dumbbell_or_cable',
    progression_type: 'external_load',
    variations: [],
    why: 'Chest work at a longer muscle length than pressing reaches.',
    rationale: 'A fly keeps tension on the chest in the stretched position, '
      + 'where a press is mechanically easiest. Higher reps and lighter load '
      + 'because the joint position is less forgiving than a press.',
  },
  {
    id: 'push_ups',
    name: 'Push-ups',
    category: 'push',
    movement_pattern: 'horizontal_push',
    primary_muscles: ['chest', 'triceps', 'front_delts', 'core'],
    equipment: 'bodyweight',
    progression_type: 'tempo_then_load',
    variations: [],
    why: 'Pressing volume with the trunk holding position under load.',
    rationale: 'Bodyweight, so load is fixed until you change it deliberately. '
      + 'Tempo comes first: slowing the lowering phase raises the demand '
      + 'without any equipment. Added weight is the step after that, not '
      + 'instead of it.',
  },
  {
    id: 'rope_triceps_pushdown',
    name: 'Rope Triceps Pushdown',
    category: 'push',
    movement_pattern: 'elbow_extension',
    primary_muscles: ['triceps'],
    equipment: 'cable',
    progression_type: 'external_load',
    variations: [],
    why: 'Direct triceps work without the pressing fatigue.',
    rationale: 'Pressing already trains the triceps, but always as the weaker '
      + 'link in a bigger movement. A cable isolation lets you accumulate '
      + 'triceps volume after the presses are done, at a load the elbows '
      + 'tolerate.',
  },
  {
    id: 'l_sit',
    name: 'L-sit',
    category: 'skill',
    movement_pattern: 'isometric_hold',
    primary_muscles: ['core', 'hip_flexors', 'triceps'],
    equipment: 'parallettes_or_floor',
    progression_type: 'hold_duration',
    variations: ['tuck', 'one_leg_extended', 'full_extended'],
    why: 'Compression strength: the core holding a shortened position.',
    rationale: 'An isometric hold progresses by leverage, not load. Extending '
      + 'a leg lengthens the lever and raises the demand in a step you cannot '
      + 'fake. Every attempt is logged, because total time under tension in '
      + 'the session is the real training stimulus, not your single best hold.',
  },
  {
    id: 'pull_ups',
    name: 'Pull-ups',
    category: 'pull',
    movement_pattern: 'vertical_pull',
    primary_muscles: ['lats', 'biceps', 'mid_back'],
    equipment: 'bar',
    progression_type: 'tempo_then_load',
    variations: [],
    why: 'Vertical pulling strength, the primary upper-body pull.',
    rationale: 'The clearest measure of relative upper-body strength there is. '
      + 'Bodyweight fixes the load, so tempo is the first progression axis and '
      + 'added weight the second. Low rep range because it is trained as a '
      + 'strength movement, not for volume.',
  },
  {
    id: 'lat_pulldown',
    name: 'Lat Pulldown',
    category: 'pull',
    movement_pattern: 'vertical_pull',
    primary_muscles: ['lats', 'biceps'],
    equipment: 'cable',
    progression_type: 'external_load',
    variations: [],
    why: 'Vertical pulling volume at a load you can dial precisely.',
    rationale: 'Pull-ups cannot supply much volume at a useful rep range while '
      + 'they are still hard. A pulldown adds the same pattern at a load you '
      + 'can set, so the lats get worked through a longer rep range than the '
      + 'bar allows.',
  },
  {
    id: 'seated_row',
    name: 'Seated Row',
    category: 'pull',
    movement_pattern: 'horizontal_pull',
    primary_muscles: ['mid_back', 'lats', 'biceps'],
    equipment: 'machine_or_cable',
    progression_type: 'external_load',
    variations: [],
    why: 'Horizontal pulling to balance the pressing volume.',
    rationale: 'Vertical pulling alone leaves the mid-back under-trained '
      + 'relative to the pressing on the other two days. A row is the direct '
      + 'counterpart to the chest press, which is why it carries the same rep '
      + 'range and rest.',
  },
  {
    id: 'chin_ups',
    name: 'Chin-ups',
    category: 'pull',
    movement_pattern: 'vertical_pull',
    primary_muscles: ['lats', 'biceps'],
    equipment: 'bar',
    progression_type: 'tempo_then_load',
    variations: [],
    why: 'Vertical pull with the biceps in a stronger position.',
    rationale: 'The supinated grip shifts work toward the biceps and lets you '
      + 'get reps at a point in the session where pull-ups are already '
      + 'fatigued. Set count is 2 to 3 precisely because it comes late.',
  },
  {
    id: 'rope_face_pull',
    name: 'Rope Face Pull',
    category: 'pull',
    movement_pattern: 'horizontal_pull',
    primary_muscles: ['rear_delts', 'rotator_cuff', 'mid_back'],
    equipment: 'cable',
    progression_type: 'external_load',
    variations: [],
    why: 'Rear delts and external rotation, for shoulders that press a lot.',
    rationale: 'The small muscles at the back of the shoulder do not get '
      + 'trained by pressing or by heavy pulling. High reps at a low RIR '
      + 'target because the goal is positional endurance, not maximal force.',
  },
  {
    id: 'handstand',
    name: 'Handstand',
    category: 'skill',
    movement_pattern: 'isometric_hold',
    primary_muscles: ['shoulders', 'core', 'wrists'],
    equipment: 'wall_or_floor',
    progression_type: 'hold_duration',
    variations: ['wall_facing', 'wall_back_to_wall', 'freestanding'],
    why: 'Overhead position under load, plus balance.',
    rationale: 'A balance skill as much as a strength one, so it is trained in '
      + 'many short attempts rather than a few long ones: the nervous system '
      + 'learns from repetitions of the position. The variation ladder removes '
      + 'the wall gradually rather than all at once.',
  },
  {
    id: 'goblet_squat',
    name: 'Bodyweight/Goblet Squat',
    category: 'legs',
    movement_pattern: 'squat',
    primary_muscles: ['quads', 'glutes', 'core'],
    equipment: 'bodyweight_or_dumbbell',
    progression_type: 'tempo_then_load',
    variations: [],
    why: 'Knee-dominant squatting pattern, both legs at once.',
    rationale: 'Starts at bodyweight, so tempo is the first lever: a slow '
      + 'descent makes a light squat genuinely hard. High rep range because '
      + 'the load is low, and it comes first so the legs are fresh for it.',
  },
  {
    id: 'bulgarian_split_squat',
    name: 'Bulgarian Split Squat',
    category: 'legs',
    movement_pattern: 'squat',
    primary_muscles: ['quads', 'glutes'],
    equipment: 'bench_and_bodyweight',
    progression_type: 'tempo_then_load',
    variations: [],
    why: 'One leg at a time, so the stronger side cannot compensate.',
    rationale: 'Sprinting is a single-leg action, so single-leg strength is '
      + 'what carries over. Splitting the stance also loads the leg hard at a '
      + 'bodyweight that a two-legged squat would not challenge. Logged per '
      + 'leg.',
  },
  {
    id: 'glute_bridge',
    name: 'Glute Bridge',
    category: 'legs',
    movement_pattern: 'hinge',
    primary_muscles: ['glutes', 'hamstrings'],
    equipment: 'bodyweight',
    progression_type: 'tempo_then_load',
    variations: [],
    why: 'Direct glute work in the shortened position. Single-leg when possible.',
    rationale: 'A bridge loads the glutes at full hip extension, which is where '
      + 'sprint propulsion happens and where a squat gives almost no tension. '
      + 'Moving to one leg roughly doubles the load with no equipment.',
  },
  {
    id: 'calf_raise',
    name: 'Calf Raise',
    category: 'legs',
    movement_pattern: 'ankle_extension',
    primary_muscles: ['calves'],
    equipment: 'bodyweight_or_machine',
    progression_type: 'tempo_then_load',
    variations: [],
    why: 'Ankle stiffness, which is where sprint force is returned.',
    rationale: 'The calf and Achilles act as a spring in sprinting. Trained at '
      + 'high reps and four sets because the tissue responds to accumulated '
      + 'work, and because the range of motion is short.',
  },
  {
    id: 'calf_raise_slow',
    name: 'Calf Raise (slow variation)',
    category: 'legs',
    movement_pattern: 'ankle_extension',
    primary_muscles: ['calves'],
    equipment: 'bodyweight_or_machine',
    progression_type: 'tempo_then_load',
    variations: [],
    why: 'The same ankle work with the lowering phase deliberately slowed.',
    rationale: 'A separate entity from the Day 3 calf raise, not the same one '
      + 'relabelled: its own tempo prescription means its own progression '
      + 'history, so slowing one day down does not read as a regression on the '
      + 'other.',
  },
  {
    id: 'sprints',
    name: 'Sprints',
    category: 'conditioning',
    movement_pattern: 'sprint',
    primary_muscles: ['hamstrings', 'glutes', 'calves'],
    equipment: 'track_or_open_ground',
    progression_type: 'time_or_distance',
    variations: [],
    why: 'Top-end speed and the force output that only sprinting trains.',
    rationale: 'No weight-room exercise reaches the rate of force development '
      + 'of a sprint. Kept short (10s) with long recoveries because the target '
      + 'is speed, not conditioning -- a tired sprint trains something else. '
      + 'Rep count and duration change between phases by review, never '
      + 'automatically.',
  },
  {
    id: 'pull_up_variation',
    name: 'Pull-up variation',
    category: 'pull',
    movement_pattern: 'vertical_pull',
    primary_muscles: ['lats', 'biceps', 'mid_back'],
    equipment: 'bar',
    progression_type: 'tempo_then_load',
    variations: [],
    why: 'A second weekly pull exposure, at a different grip than Day 2.',
    rationale: 'Two exposures a week beats one for a movement this trainable. '
      + 'Changing the grip spreads the load across slightly different tissue '
      + 'and joint angles, so the second session adds stimulus rather than '
      + 'just fatigue. Tracked separately from Day 2 pull-ups on purpose.',
  },
  {
    id: 'cable_row',
    name: 'Cable Row',
    category: 'pull',
    movement_pattern: 'horizontal_pull',
    primary_muscles: ['mid_back', 'lats', 'biceps'],
    equipment: 'cable',
    progression_type: 'external_load',
    variations: [],
    why: 'Second horizontal pull exposure of the week.',
    rationale: 'Mirrors the Day 2 seated row at a cable rather than a machine, '
      + 'so the pulling volume is spread across two days instead of stacked '
      + 'into one.',
  },
  {
    id: 'cable_lateral_raise',
    name: 'Cable Lateral Raise',
    category: 'push',
    movement_pattern: 'shoulder_abduction',
    primary_muscles: ['side_delts'],
    equipment: 'cable',
    progression_type: 'external_load',
    variations: [],
    why: 'Side delts, which pressing barely touches.',
    rationale: 'Pressing trains the front of the shoulder; the side head needs '
      + 'abduction to be loaded at all. A cable keeps tension through the '
      + 'whole range where a dumbbell loses it at the bottom.',
  },
  {
    id: 'biceps_curl',
    name: 'Biceps Curl',
    category: 'pull',
    movement_pattern: 'elbow_flexion',
    primary_muscles: ['biceps'],
    equipment: 'dumbbell_or_cable',
    progression_type: 'external_load',
    variations: [],
    why: 'Direct elbow flexion after the pulling is done.',
    rationale: 'Two sets, not three: the biceps have already worked in every '
      + 'pull this session. This is topping up, not a primary stimulus.',
  },
  {
    id: 'triceps_extension',
    name: 'Triceps Extension',
    category: 'push',
    movement_pattern: 'elbow_extension',
    primary_muscles: ['triceps'],
    equipment: 'dumbbell_or_cable',
    progression_type: 'external_load',
    variations: [],
    why: 'Direct elbow extension after the pressing is done.',
    rationale: 'Same reasoning as the curl: two sets, placed last, because the '
      + 'triceps have already been loaded by the chest press.',
  },
  {
    id: 'single_leg_rdl',
    name: 'Single-leg RDL',
    category: 'legs',
    movement_pattern: 'hinge',
    primary_muscles: ['hamstrings', 'glutes', 'spinal_erectors'],
    equipment: 'bodyweight_or_dumbbell',
    progression_type: 'tempo_then_load',
    variations: [],
    why: 'Hip hinge on one leg: hamstrings at length, plus balance.',
    rationale: 'The hinge trains the hamstrings in the lengthened position, '
      + 'which is where they are injured in sprinting. On one leg it also '
      + 'demands the hip stability that a two-legged RDL lets you skip. '
      + 'Logged per leg.',
  },
  {
    id: 'reverse_lunge',
    name: 'Reverse Lunge',
    category: 'legs',
    movement_pattern: 'squat',
    primary_muscles: ['quads', 'glutes'],
    equipment: 'bodyweight_or_dumbbell',
    progression_type: 'tempo_then_load',
    variations: [],
    why: 'Single-leg knee-dominant work, easier on the knee than a forward lunge.',
    rationale: 'Stepping back rather than forward keeps the loaded knee over a '
      + 'stable foot, so the pattern can be trained at higher reps without the '
      + 'joint stress. Logged per leg.',
  },
  {
    id: 'hip_thrust',
    name: 'Hip Thrust (floor)',
    category: 'legs',
    movement_pattern: 'hinge',
    primary_muscles: ['glutes', 'hamstrings'],
    equipment: 'bodyweight_or_barbell',
    progression_type: 'tempo_then_load',
    variations: [],
    why: 'Glutes at full extension, the Day 5 counterpart to the bridge.',
    rationale: 'Same joint action as the glute bridge with a longer range from '
      + 'the floor. Placed after the single-leg work so the glutes are already '
      + 'warm and the set can be taken close to failure safely.',
  },
  {
    id: 'cooper_test',
    name: 'Cooper Test',
    category: 'conditioning',
    movement_pattern: 'run',
    primary_muscles: ['whole_body'],
    equipment: 'track',
    progression_type: 'time_or_distance',
    variations: [],
    why: 'A fixed 12-minute measurement of aerobic capacity. Not a workout.',
    rationale: 'A test, not training: it is run every 6 to 8 weeks so the '
      + 'number means something, and it is flagged is_test so it never mixes '
      + 'into the sprint trend. Running it weekly would cost training and tell '
      + 'you nothing new.',
  },

  // Migrated from the old flat model. "Shoulders" was a single row with a rep
  // count and no indication of which movement it was -- the new program has
  // three candidate shoulder exercises and guessing between them would invent
  // history that was never recorded. It keeps its own entity so the reps are
  // preserved and visibly separate from anything prescribed.
  {
    id: 'legacy_shoulders',
    name: 'Shoulders (logged before the rebuild)',
    category: 'push',
    movement_pattern: 'unspecified',
    primary_muscles: ['shoulders'],
    equipment: 'unspecified',
    progression_type: 'external_load',
    variations: [],
    legacy: true,
    why: 'Kept so the reps you logged before the rebuild are not lost.',
    rationale: 'The old log recorded "Shoulders" with no movement, load or RIR. '
      + 'Mapping it onto Cable Lateral Raise or Rope Face Pull would be a '
      + 'guess presented as data, so it stays as its own row. Nothing in the '
      + 'program prescribes it.',
  },
];

const EXERCISE_BY_ID = Object.fromEntries(EXERCISES.map(e => [e.id, e]));

function programExercise(id) { return EXERCISE_BY_ID[id] || null; }

function programProgressionType(exerciseId) {
  const ex = programExercise(exerciseId);
  return ex ? ex.progression_type : null;
}

// --- Phases ---------------------------------------------------------------
//
// Week numbers are relative to the program start date, not the calendar.
// A phase change is surfaced as a suggestion and applied only once the user
// confirms it -- see workout.js's confirmPhase(). Nothing here changes on its
// own.

const PROGRAM_PHASES = [
  {
    name: 'Foundation',
    start_week: 1,
    end_week: 8,
    notes: 'Base volume and RIR exactly as prescribed. Learn the movements and '
      + 'build a log worth reading.',
    extra_set_on_primaries: false,
    rir_override: null,
  },
  {
    name: 'Overload',
    start_week: 9,
    end_week: 18,
    notes: 'A fourth set on the two primary lifts of each day. Same exercises, '
      + 'same rep ranges, more work.',
    extra_set_on_primaries: true,
    rir_override: null,
  },
  {
    name: 'Peak',
    start_week: 19,
    end_week: 23,
    notes: 'Back to Foundation volume with the RIR target dropped to 0-1: less '
      + 'work, taken closer to failure.',
    extra_set_on_primaries: false,
    rir_override: [0, 1],
  },
];

// Inclusive ISO-date difference in whole days. Both arguments are 'YYYY-MM-DD'
// and parsed as UTC, so a timezone change cannot shift which week you are in.
function programDaysBetween(startIso, dateIso) {
  const a = Date.parse(`${startIso}T00:00:00Z`);
  const b = Date.parse(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.floor((b - a) / 86400000);
}

// Week 1 is the week containing the start date. Days before the start return
// null rather than week 0 or a negative week: "before the program" is a real
// state and must not be silently rounded into Foundation.
function programWeekNumber(startIso, dateIso) {
  const days = programDaysBetween(startIso, dateIso);
  if (days === null || days < 0) return null;
  return Math.floor(days / 7) + 1;
}

function programPhaseForWeek(week) {
  if (typeof week !== 'number' || week < 1) return null;
  return PROGRAM_PHASES.find(p => week >= p.start_week && week <= p.end_week) || null;
}

// Past the last phase the program has run out. Returning null rather than
// clamping to Peak keeps that visible instead of implying the plan continues.
function programPhaseForDate(startIso, dateIso) {
  return programPhaseForWeek(programWeekNumber(startIso, dateIso));
}

// --- The week template ----------------------------------------------------
//
// Five days, Sunday to Thursday. `weekday` is JS Date#getDay(): 0 = Sunday.
// Friday and Saturday are not training days and have no template.
//
// `primary: true` marks the two lifts that gain a fourth set in Overload.
// The spec names one per day (Chest Press on Push, Pull-ups on Pull, the
// squat/RDL-pattern lift on each Sprint+Legs day); these are those, plus the
// next compound movement in each day's order -- isolation work and the skill
// holds are never primaries.
//
// rep_range is [low, high]; null high means AMRAP. rir_target is [low, high].

const WEEK_TEMPLATE = [
  {
    day: 1,
    weekday: 0,
    focus: 'Push',
    estimated_duration_min: 60,
    warm_up: '5 min easy cardio, then shoulder circles, band external rotations '
      + 'and two light ramp-up sets of the first press.',
    exercises: [
      { exercise_id: 'chest_press', sets: 3, rep_range: [8, 12], rir_target: [1, 3], rest: '90-120s', primary: true },
      { exercise_id: 'incline_fly', sets: 3, rep_range: [10, 15], rir_target: [1, 3], rest: '60-90s' },
      { exercise_id: 'push_ups', sets: 3, rep_range: [1, null], rir_target: [1, 2], rest: '90s', amrap: true, primary: true },
      { exercise_id: 'rope_triceps_pushdown', sets: 3, rep_range: [10, 15], rir_target: [1, 2], rest: '60s' },
      { exercise_id: 'l_sit', attempts: [6, 8], rest: '60-90s' },
    ],
  },
  {
    day: 2,
    weekday: 1,
    focus: 'Pull',
    estimated_duration_min: 65,
    warm_up: '5 min easy cardio, then band pull-aparts, scapular hangs and one '
      + 'light set of pulldowns.',
    exercises: [
      { exercise_id: 'pull_ups', sets: 3, rep_range: [4, 8], rir_target: [1, 2], rest: '2-3 min', primary: true },
      { exercise_id: 'lat_pulldown', sets: 3, rep_range: [10, 12], rir_target: [1, 3], rest: '90s', primary: true },
      { exercise_id: 'seated_row', sets: 3, rep_range: [8, 12], rir_target: [1, 3], rest: '90-120s' },
      { exercise_id: 'chin_ups', sets: 3, sets_min: 2, rep_range: [6, 10], rir_target: [1, 2], rest: '2 min' },
      { exercise_id: 'rope_face_pull', sets: 3, rep_range: [12, 15], rir_target: [2, 3], rest: '60s' },
      { exercise_id: 'handstand', attempts: [8, 10], rest: '60-90s' },
    ],
  },
  {
    day: 3,
    weekday: 2,
    focus: 'Sprint + Legs A',
    estimated_duration_min: 70,
    warm_up: '5 min easy jog, then leg swings, ankle bounces and two build-up '
      + 'runs before the first sprint.',
    exercises: [
      { exercise_id: 'goblet_squat', sets: 3, rep_range: [12, 20], rir_target: [1, 2], rest: '90s', primary: true },
      { exercise_id: 'bulgarian_split_squat', sets: 3, rep_range: [8, 12], rir_target: [1, 2], rest: '90s', per_leg: true, primary: true },
      { exercise_id: 'glute_bridge', sets: 3, rep_range: [10, 15], rir_target: [1, 2], rest: '60s', note: 'Single-leg when possible.' },
      { exercise_id: 'calf_raise', sets: 4, rep_range: [15, 20], rir_target: [1, 2], rest: '45s' },
      { exercise_id: 'sprints', protocol: 'sprint', rest: '90-120s between reps' },
    ],
  },
  {
    day: 4,
    weekday: 3,
    focus: 'Upper (second exposure)',
    estimated_duration_min: 65,
    warm_up: '5 min easy cardio, then band pull-aparts and one light set each of '
      + 'the first pull and the first press.',
    exercises: [
      { exercise_id: 'pull_up_variation', sets: 3, rep_range: [4, 8], rir_target: [1, 2], rest: '2 min', note: 'Different grip than Day 2.', primary: true },
      { exercise_id: 'chest_press', sets: 3, rep_range: [8, 12], rir_target: [1, 3], rest: '90s', primary: true },
      { exercise_id: 'cable_row', sets: 3, rep_range: [8, 12], rir_target: [1, 3], rest: '90s' },
      { exercise_id: 'cable_lateral_raise', sets: 3, rep_range: [10, 15], rir_target: [1, 2], rest: '60s' },
      { exercise_id: 'biceps_curl', sets: 2, rep_range: [10, 15], rir_target: [1, 2], rest: '45-60s' },
      { exercise_id: 'triceps_extension', sets: 2, rep_range: [10, 15], rir_target: [1, 2], rest: '45-60s' },
      { exercise_id: 'l_sit', attempts: [6, 8], rest: '60-90s' },
    ],
  },
  {
    day: 5,
    weekday: 4,
    focus: 'Sprint + Legs B',
    estimated_duration_min: 70,
    warm_up: '5 min easy jog, then leg swings, hip openers and two build-up runs '
      + 'before the first sprint.',
    exercises: [
      { exercise_id: 'single_leg_rdl', sets: 3, rep_range: [8, 12], rir_target: [1, 2], rest: '90s', per_leg: true, primary: true },
      { exercise_id: 'reverse_lunge', sets: 3, rep_range: [10, 12], rir_target: [1, 2], rest: '90s', per_leg: true, primary: true },
      { exercise_id: 'hip_thrust', sets: 3, rep_range: [12, 15], rir_target: [1, 2], rest: '60s' },
      { exercise_id: 'calf_raise_slow', sets: 4, rep_range: [15, 20], rir_target: [1, 2], rest: '45s' },
      { exercise_id: 'sprints', protocol: 'sprint', rest: '90-120s' },
      { exercise_id: 'cooper_test', protocol: 'cooper', is_test: true, cadence_weeks: [6, 8] },
    ],
  },
];

// Weeks 1-2 of each phase. Progressing the rep count or duration is a manual
// between-phase decision, which is why there is no arithmetic here to do it.
const SPRINT_PROTOCOL = {
  warm_up_min: 5,
  reps: 4,
  work_seconds: 10,
  effort_pct: [80, 90],
  recovery: 'walking recovery between reps',
  note: 'Weeks 1-2 of each phase. Rep count and duration change only as a '
    + 'reviewed decision between phases, never automatically.',
};

const COOPER_PROTOCOL = {
  duration_min: 12,
  note: 'Run once every 6-8 weeks. Flagged as a test so it stays out of the '
    + 'sprint trend.',
};

function programWorkoutForWeekday(weekday) {
  return WEEK_TEMPLATE.find(w => w.weekday === weekday) || null;
}

function programWorkoutForDay(day) {
  return WEEK_TEMPLATE.find(w => w.day === day) || null;
}

function programIsTrainingDay(weekday) { return programWorkoutForWeekday(weekday) !== null; }

// The prescription for one workout under one phase. Returns a copy: the
// template is shared across phases and must never be mutated in place, or
// switching phase would rewrite what earlier weeks prescribed.
//
// Only set count and RIR target change between phases. The exercise list is
// structurally identical throughout, by design.
function programPrescription(workoutOrDay, phase) {
  const workout = typeof workoutOrDay === 'number'
    ? programWorkoutForDay(workoutOrDay) : workoutOrDay;
  if (!workout) return null;
  const exercises = workout.exercises.map(row => {
    const next = { ...row };
    if (phase && phase.extra_set_on_primaries && row.primary && typeof row.sets === 'number') {
      next.sets = row.sets + 1;
    }
    if (phase && phase.rir_override && row.rir_target) {
      next.rir_target = [...phase.rir_override];
    }
    return next;
  });
  return { ...workout, phase: phase ? phase.name : null, exercises };
}

function programCategoryOf(exerciseId) {
  const ex = programExercise(exerciseId);
  return ex ? ex.category : null;
}

// Every exercise the template references, deduplicated, in first-appearance
// order. Used by the dashboard to decide what to show a trend for.
function programTrackedExerciseIds() {
  const seen = [];
  WEEK_TEMPLATE.forEach(w => w.exercises.forEach(row => {
    if (!seen.includes(row.exercise_id)) seen.push(row.exercise_id);
  }));
  return seen;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PROGRESSION_TYPES,
    EXERCISES,
    PROGRAM_PHASES,
    WEEK_TEMPLATE,
    SPRINT_PROTOCOL,
    COOPER_PROTOCOL,
    programExercise,
    programProgressionType,
    programDaysBetween,
    programWeekNumber,
    programPhaseForWeek,
    programPhaseForDate,
    programWorkoutForWeekday,
    programWorkoutForDay,
    programIsTrainingDay,
    programPrescription,
    programCategoryOf,
    programTrackedExerciseIds,
  };
}
