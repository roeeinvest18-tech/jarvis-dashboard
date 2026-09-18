// Jarvis Personal OS — the data model, persistence and analytics layer.
//
// Deliberately DOM-free. Rendering lives in daily-today.js (the Today zone
// and the Close the Day flow) and os.js (Insights / Memory / History); this
// file is pure functions plus localStorage, so the sleep arithmetic and every
// derived statistic can be exercised directly under Node by
// test_daily_logic.js without a browser.
//
// PERSISTENCE, and why it looks like training.js
// ----------------------------------------------
// Same shape as the Training zone's sync, for the same reason: the PWA is a
// static page served from GitHub Pages with no backend of its own, so a tap
// writes to localStorage FIRST and always. If a sync URL + token are
// configured, the local state is then pushed to webhook_server.py's /daily
// route (backed by daily_store.py on Railway) and the merged result is pulled
// back, so a day checked in on the phone shows up on the desktop. Sync is
// best-effort background reconciliation and never blocks a write or a render:
// with the server unreachable, or never configured at all, everything here
// still works offline against localStorage alone.
//
// This data NEVER travels through dashboard_data/. Those files are published
// to the PUBLIC jarvis-dashboard repo, where git history is permanent; mood,
// sleep, spiritual practice and friction notes are the most personal data in
// Jarvis. Routing writes straight to the authenticated Railway endpoint keeps
// build_pwa.py's allowlist (and its self-test) untouched by this feature.
//
// RAW DATA vs INTERPRETATION
// --------------------------
// Everything stored is something the user reported or the system measured.
// Derived states — sleep duration, day tier, consistency, associations — are
// computed on read, never written back into the record. Changing how a tier
// is defined later therefore reinterprets all history instead of stranding
// records that were stamped under the old rule.

const DAILY_KEYS = {
  days: 'jarvis:daily:days',
  topics: 'jarvis:daily:topics',
  recalls: 'jarvis:daily:recalls',
  experiments: 'jarvis:daily:experiments',
  settings: 'jarvis:daily:settings',
  deleted: 'jarvis:daily:deleted',
  syncUrl: 'jarvis:daily:syncUrl',
  syncToken: 'jarvis:daily:syncToken',
};

// Reused from the Training zone's sync setup when the Personal OS has no
// config of its own: it's the same Railway app, the same single user and the
// same device pairing, so making it configurable twice would be friction with
// no security benefit. Setting the Personal OS keys overrides these.
const DAILY_FALLBACK_SYNC_URL_KEY = 'jarvis:training:syncUrl';
const DAILY_FALLBACK_SYNC_TOKEN_KEY = 'jarvis:training:syncToken';

// The five actions that constitute a Minimum Day. A hard day should still be
// winnable, so the tier ladder below is anchored on these and nothing else.
const DAILY_CORE_HABITS = [
  { id: 'tefillin', label: 'Tefillin' },
  { id: 'spiritual_learning', label: 'Spiritual learning' },
  { id: 'htb_completed', label: 'HTB' },
  { id: 'four_minute_routine', label: '4-minute routine' },
  { id: 'meditation', label: 'Meditation' },
];

// Tracked, but never required for a Minimum Day.
const DAILY_EXTRA_HABITS = [
  { id: 'mobility_posture', label: 'Mobility / posture' },
  { id: 'workout_completed', label: 'Workout' },
  { id: 'protein_target_met', label: 'Protein target' },
  { id: 'water_target_met', label: 'Water target' },
  { id: 'career_output', label: 'Career output' },
];

const DAILY_MIND_METRICS = [
  { id: 'mood', label: 'Mood' },
  { id: 'energy', label: 'Energy' },
  { id: 'focus', label: 'Focus' },
];

const DAILY_DEFAULT_SETTINGS = {
  protein_target_g: 150,
  water_target_l: 2.5,
  supplements: [{ id: 'creatine', label: 'Creatine' }],
};

// Delayed-recall ladder. Expressed as data, not as a hardcoded SM-2
// implementation: the requirement was explicitly "do not hard-code an
// inflexible spaced repetition system", and a topic's next prompt is simply
// the next rung it hasn't reached yet.
const DAILY_RECALL_INTERVALS_DAYS = [2, 7, 21, 60];

// An association is only shown once BOTH sides of the split have this many
// days behind them. Below that the difference between two small means is
// mostly noise, and presenting it as a finding would be fabricating a
// behavioural conclusion.
const DAILY_MIN_GROUP_N = 5;

// --- dates ----------------------------------------------------------------
// The device's own local calendar date is the day key. The user and the phone
// are both in Israel, so local midnight is the real day boundary; storing UTC
// would file a 01:00 check-in under the previous day for half the year.

function dailyToIso(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dailyTodayIso() { return dailyToIso(new Date()); }

function dailyShiftIso(iso, deltaDays) {
  // Parsed as local noon, not midnight: a date-only string is parsed as UTC by
  // spec, and midnight-UTC lands on the previous calendar day for anyone west
  // of Greenwich, while noon is at least 11 hours clear of both boundaries in
  // every real timezone.
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return dailyToIso(d);
}

function dailyDaysBetween(isoA, isoB) {
  const a = new Date(`${isoA}T12:00:00`).getTime();
  const b = new Date(`${isoB}T12:00:00`).getTime();
  return Math.round((b - a) / 86400000);
}

function dailyWeekdayIndex(iso) {
  return new Date(`${iso}T12:00:00`).getDay();
}

// --- sleep ----------------------------------------------------------------

function dailyParseClock(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

// Duration from two wall-clock times, handling the midnight crossing that
// makes a naive subtraction negative. Only the DURATION is derived; the two
// clock times are stored exactly as entered, so 23:00->07:00 and 03:00->11:00
// both correctly read as 8h while remaining distinguishable in the data and
// in the timing analytics below.
function dailySleepDurationMinutes(start, wake) {
  const s = dailyParseClock(start);
  const w = dailyParseClock(wake);
  if (s === null || w === null) return null;
  let mins = w - s;
  if (mins < 0) mins += 1440;
  return mins;
}

function dailyFormatDuration(mins) {
  if (mins === null || mins === undefined) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

// Flags a duration that is almost certainly a typo rather than a real night.
// Advisory only: the raw times are always stored regardless, because silently
// rejecting what the user reported would corrupt the record.
function dailySleepLooksImplausible(mins) {
  return mins !== null && mins !== undefined && (mins < 60 || mins > 960);
}

// Bedtimes straddle midnight, so the ordinary mean is wrong: 23:00 and 01:00
// average to noon rather than to midnight. Re-anchoring the day at 12:00
// makes the evening range monotonic (18:00 -> 360, 23:00 -> 660, 01:00 -> 780)
// so a plain mean is correct, then it is mapped back to a clock time.
function dailyBedtimeToAnchored(mins) {
  return mins < 720 ? mins + 1440 - 720 : mins - 720;
}

function dailyAnchoredToClock(anchored) {
  const mins = Math.round(((anchored + 720) % 1440 + 1440) % 1440);
  const h = Math.floor(mins / 60);
  return `${String(h).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

// --- small statistics -----------------------------------------------------

function dailyMean(values) {
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function dailyStdDev(values) {
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (nums.length < 2) return null;
  const mean = dailyMean(nums);
  const variance = nums.reduce((a, v) => a + (v - mean) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

function dailyRound(v, digits = 1) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

// --- record shape ---------------------------------------------------------

function dailyEmptyRecord(date) {
  const record = {
    date,
    sleep_start: null,
    wake_time: null,
    sleep_quality: null,
    mood: null,
    energy: null,
    focus: null,
    spiritual_learning_note: '',
    htb_topic: '',
    supplements: {},
    screen_time: { total_min: null, social_min: null, youtube_min: null },
    tradingview_opens: null,
    priorities: [],
    win_of_day: '',
    friction: '',
    minimum_day: false,
    closed: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  DAILY_CORE_HABITS.concat(DAILY_EXTRA_HABITS).forEach(h => { record[h.id] = false; });
  return record;
}

// Fills in anything a stored record predates, so a record written by an older
// version of the app never renders as broken and never needs a migration.
function dailyNormalizeRecord(record, date) {
  const base = dailyEmptyRecord(date || (record && record.date) || dailyTodayIso());
  const merged = { ...base, ...(record || {}) };
  merged.supplements = { ...(record && record.supplements) || {} };
  merged.screen_time = { ...base.screen_time, ...((record && record.screen_time) || {}) };
  merged.priorities = Array.isArray(merged.priorities) ? merged.priorities.slice(0, 3) : [];
  return merged;
}

// Clamps a 1-10 self-report. Anything unparseable becomes null (absent)
// rather than 0, because "not answered" and "answered zero" are different
// facts and averaging a phantom 0 would drag every mean down.
function dailyIsBlank(value) {
  // Number('') is 0, so an empty field would otherwise clamp to a real score
  // and record "not answered" as a 1. Blank has to be rejected before any
  // numeric coercion happens.
  return value === null || value === undefined
    || (typeof value === 'string' && value.trim() === '');
}

function dailyClampScore(value) {
  if (dailyIsBlank(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(10, Math.max(1, Math.round(n)));
}

function dailyClampCount(value) {
  if (dailyIsBlank(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

// --- derived day state ----------------------------------------------------

function dailyCoreDoneCount(record) {
  return DAILY_CORE_HABITS.filter(h => !!record[h.id]).length;
}

function dailyExtraDoneCount(record) {
  const supplements = record.supplements || {};
  const supplementDone = Object.keys(supplements).some(k => supplements[k]) ? 1 : 0;
  return DAILY_EXTRA_HABITS.filter(h => !!record[h.id]).length + supplementDone;
}

// Descriptive tiers, never a grade. "Building" is what an unfinished day is
// called — not "failed" — and a Minimum Day is a complete, legitimate day, so
// nothing in this ladder treats it as a shortfall.
function dailyDayTier(record) {
  const core = dailyCoreDoneCount(record);
  const extras = dailyExtraDoneCount(record);
  const learned = !!(record.htb_topic || '').trim() || !!(record.spiritual_learning_note || '').trim();
  if (core < DAILY_CORE_HABITS.length) {
    return { id: 'building', label: 'Building', core, extras };
  }
  if (extras >= 4 && learned) return { id: 'great', label: 'Great', core, extras };
  if (extras >= 2) return { id: 'standard', label: 'Standard', core, extras };
  return { id: 'minimum', label: 'Minimum', core, extras };
}

// --- store ----------------------------------------------------------------

const DAILY = {
  loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  },

  saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage full or blocked — non-fatal, the render still works */ }
  },

  days() { return this.loadJson(DAILY_KEYS.days, {}) || {}; },
  topics() { return this.loadJson(DAILY_KEYS.topics, []) || []; },
  recalls() { return this.loadJson(DAILY_KEYS.recalls, []) || []; },
  experiments() { return this.loadJson(DAILY_KEYS.experiments, []) || []; },
  deleted() { return this.loadJson(DAILY_KEYS.deleted, []) || []; },

  settings() {
    return { ...DAILY_DEFAULT_SETTINGS, ...(this.loadJson(DAILY_KEYS.settings, {}) || {}) };
  },

  saveSettings(patch) {
    const next = { ...this.settings(), ...patch };
    this.saveJson(DAILY_KEYS.settings, next);
    return next;
  },

  // The single write path for a day. Keyed by calendar date, so a second
  // check-in for the same date updates that one record instead of creating a
  // duplicate — the one-record-per-date guarantee is structural, not enforced
  // by a check that could be forgotten.
  getDay(date) {
    return dailyNormalizeRecord(this.days()[date], date);
  },

  hasDay(date) {
    return Object.prototype.hasOwnProperty.call(this.days(), date);
  },

  saveDay(date, patch) {
    const days = this.days();
    const existing = days[date];
    const record = dailyNormalizeRecord(existing, date);
    const next = {
      ...record,
      ...patch,
      date,
      created_at: (existing && existing.created_at) || record.created_at,
      updated_at: new Date().toISOString(),
    };
    days[date] = next;
    this.saveJson(DAILY_KEYS.days, days);
    return next;
  },

  // Sorted oldest-first. Every analytic below walks this, so the ordering is
  // established once here rather than re-sorted at each call site.
  orderedDays() {
    const days = this.days();
    return Object.keys(days).sort().map(d => dailyNormalizeRecord(days[d], d));
  },

  // The last `count` calendar days up to and including `endIso`, as records.
  // Days never checked in are simply absent — they are NOT synthesised as
  // all-false records, because "did not report" and "reported not done" are
  // different facts and conflating them would invent data.
  windowDays(count, endIso) {
    const end = endIso || dailyTodayIso();
    const start = dailyShiftIso(end, -(count - 1));
    return this.orderedDays().filter(r => r.date >= start && r.date <= end);
  },

  // --- topics & recalls ---------------------------------------------------

  newId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  },

  // Called whenever an HTB topic is recorded. Matching on the normalised name
  // means studying "Kerberos" on three separate days builds one topic with a
  // recall history, rather than three disconnected entries.
  upsertTopic(name, { date, source, context } = {}) {
    const clean = (name || '').trim();
    if (!clean) return null;
    const topics = this.topics();
    const key = clean.toLowerCase();
    let topic = topics.find(t => (t.topic || '').trim().toLowerCase() === key);
    const now = new Date().toISOString();
    if (topic) {
      topic.last_studied_date = date || dailyTodayIso();
      topic.study_count = (topic.study_count || 1) + 1;
      topic.updated_at = now;
    } else {
      topic = {
        id: this.newId('topic'),
        topic: clean,
        source: source || 'HTB',
        category: null,
        first_learned_date: date || dailyTodayIso(),
        last_studied_date: date || dailyTodayIso(),
        study_count: 1,
        initial_context: context || '',
        created_at: now,
        updated_at: now,
      };
      topics.push(topic);
    }
    this.saveJson(DAILY_KEYS.topics, topics);
    return topic;
  },

  deleteTopic(topicId) {
    this.saveJson(DAILY_KEYS.topics, this.topics().filter(t => t.id !== topicId));
    this.saveJson(DAILY_KEYS.recalls, this.recalls().filter(r => r.topic_id !== topicId));
    const deleted = new Set(this.deleted());
    deleted.add(topicId);
    this.saveJson(DAILY_KEYS.deleted, [...deleted]);
  },

  recallsFor(topicId) {
    return this.recalls()
      .filter(r => r.topic_id === topicId)
      .sort((a, b) => (a.prompted_at || '') < (b.prompted_at || '') ? -1 : 1);
  },

  // The response and its evaluation are separate fields from the outset. V1
  // records the answer and leaves `evaluation` null; an external evaluator
  // (ChatGPT today, an API later) fills it in through saveRecallEvaluation
  // without ever touching what was actually written.
  saveRecallAttempt(topicId, responseText) {
    const now = new Date().toISOString();
    const attempt = {
      id: this.newId('recall'),
      topic_id: topicId,
      prompted_at: now,
      responded_at: now,
      response_text: responseText || '',
      evaluation: null,
      created_at: now,
      updated_at: now,
    };
    const recalls = this.recalls();
    recalls.push(attempt);
    this.saveJson(DAILY_KEYS.recalls, recalls);
    return attempt;
  },

  saveRecallEvaluation(recallId, evaluation) {
    const recalls = this.recalls();
    const attempt = recalls.find(r => r.id === recallId);
    if (!attempt) return null;
    attempt.evaluation = evaluation;   // raw response_text is never overwritten
    attempt.updated_at = new Date().toISOString();
    this.saveJson(DAILY_KEYS.recalls, recalls);
    return attempt;
  },

  // --- sync ---------------------------------------------------------------

  syncConfig() {
    try {
      const url = localStorage.getItem(DAILY_KEYS.syncUrl)
        || localStorage.getItem(DAILY_FALLBACK_SYNC_URL_KEY) || '';
      const token = localStorage.getItem(DAILY_KEYS.syncToken)
        || localStorage.getItem(DAILY_FALLBACK_SYNC_TOKEN_KEY) || '';
      return { url: url.replace(/\/+$/, ''), token };
    } catch (e) {
      return { url: '', token: '' };
    }
  },

  saveSyncConfig(url, token) {
    try {
      localStorage.setItem(DAILY_KEYS.syncUrl, (url || '').replace(/\/+$/, ''));
      localStorage.setItem(DAILY_KEYS.syncToken, token || '');
    } catch (e) { /* non-fatal */ }
  },

  clearSyncConfig() {
    try {
      localStorage.removeItem(DAILY_KEYS.syncUrl);
      localStorage.removeItem(DAILY_KEYS.syncToken);
    } catch (e) { /* non-fatal */ }
  },

  // Pushes local state and adopts the server's merged view. The response is
  // authoritative for the synced set, so it REPLACES the local cache rather
  // than being appended to it — otherwise an already-synced record would be
  // re-pushed and re-merged on every render forever. Silent on any failure
  // (offline, wrong token, server asleep): the caller keeps rendering local
  // data and tries again next time.
  async syncWithServer() {
    const { url, token } = this.syncConfig();
    if (!url || !token) return null;
    try {
      const resp = await fetch(`${url}/daily`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          days: this.days(),
          topics: this.topics(),
          recalls: this.recalls(),
          experiments: this.experiments(),
          settings: this.settings(),
          deleted: this.deleted(),
        }),
      });
      if (!resp.ok) return null;
      const state = await resp.json();
      if (!state || typeof state !== 'object') return null;
      this.saveJson(DAILY_KEYS.days, state.days || {});
      this.saveJson(DAILY_KEYS.topics, state.topics || []);
      this.saveJson(DAILY_KEYS.recalls, state.recalls || []);
      this.saveJson(DAILY_KEYS.experiments, state.experiments || []);
      this.saveJson(DAILY_KEYS.deleted, state.deleted || []);
      if (state.settings) this.saveJson(DAILY_KEYS.settings, state.settings);
      return state;
    } catch (e) {
      return null;
    }
  },
};

// --- analytics ------------------------------------------------------------
// Every number below is computed from stored records at read time. Nothing
// here writes, and nothing here invents a value for a day that was never
// checked in.

// Consistency counts completions against DAYS ACTUALLY REPORTED, not against
// the calendar window. A week away with no check-ins should read as "no data",
// not as a week of failures.
function dailyConsistency(records, habitId) {
  const reported = records.length;
  if (!reported) return { done: 0, reported: 0, pct: null };
  const done = records.filter(r => !!r[habitId]).length;
  return { done, reported, pct: Math.round((done / reported) * 100) };
}

function dailyConsistencyTable(records) {
  return DAILY_CORE_HABITS.concat(DAILY_EXTRA_HABITS).map(h => ({
    id: h.id,
    label: h.label,
    ...dailyConsistency(records, h.id),
  }));
}

function dailySleepStats(records) {
  const withSleep = records.filter(r => dailySleepDurationMinutes(r.sleep_start, r.wake_time) !== null);
  if (!withSleep.length) return null;
  const durations = withSleep.map(r => dailySleepDurationMinutes(r.sleep_start, r.wake_time));
  const bedAnchored = withSleep.map(r => dailyBedtimeToAnchored(dailyParseClock(r.sleep_start)));
  const wakeMins = withSleep.map(r => dailyParseClock(r.wake_time));
  const qualities = withSleep.map(r => r.sleep_quality).filter(q => typeof q === 'number');
  return {
    n: withSleep.length,
    avgDurationMin: Math.round(dailyMean(durations)),
    avgQuality: dailyRound(dailyMean(qualities)),
    avgBedtime: dailyAnchoredToClock(dailyMean(bedAnchored)),
    avgWakeTime: dailyAnchoredToClock(dailyMean(wakeMins) - 720 + 1440),
    // Spread in minutes. Lower means a more regular schedule; this is the
    // "sleep consistency" / "wake-time consistency" the brief asked for,
    // reported as a spread rather than dressed up as a 0-100 score.
    bedtimeSpreadMin: dailyRound(dailyStdDev(bedAnchored), 0),
    wakeSpreadMin: dailyRound(dailyStdDev(wakeMins), 0),
  };
}

// The honest form of "X relates to Y": split the reported days in two by a
// predicate, report each group's mean AND its n, and say nothing at all until
// both groups clear DAILY_MIN_GROUP_N. Returns the evidence so the UI can show
// it alongside the claim.
function dailyGroupCompare(records, predicate, metricId) {
  const withMetric = records.filter(r => typeof r[metricId] === 'number');
  const groupA = withMetric.filter(predicate);
  const groupB = withMetric.filter(r => !predicate(r));
  const result = {
    metric: metricId,
    a: { n: groupA.length, mean: dailyRound(dailyMean(groupA.map(r => r[metricId]))) },
    b: { n: groupB.length, mean: dailyRound(dailyMean(groupB.map(r => r[metricId]))) },
    sufficient: groupA.length >= DAILY_MIN_GROUP_N && groupB.length >= DAILY_MIN_GROUP_N,
  };
  result.delta = (result.a.mean !== null && result.b.mean !== null)
    ? dailyRound(result.a.mean - result.b.mean) : null;
  return result;
}

function dailyTradingViewStats(records) {
  const withOpens = records.filter(r => typeof r.tradingview_opens === 'number');
  if (!withOpens.length) return null;
  const opens = withOpens.map(r => r.tradingview_opens);
  const sorted = [...withOpens].sort((a, b) => a.tradingview_opens - b.tradingview_opens);
  return {
    n: withOpens.length,
    avg: dailyRound(dailyMean(opens)),
    max: sorted[sorted.length - 1].tradingview_opens,
    maxDate: sorted[sorted.length - 1].date,
    min: sorted[0].tradingview_opens,
    minDate: sorted[0].date,
    total: opens.reduce((a, b) => a + b, 0),
  };
}

// Observations that are true by construction: each is a direct restatement of
// stored numbers plus the n behind it. No claim is generated unless the data
// supports it, and none is phrased causally — the brief's "observed
// association, never causation" rule is enforced here rather than left to
// whoever writes the copy.
function dailyBehaviouralObservations(records) {
  const out = [];

  const sleepFocus = dailyGroupCompare(records, r => {
    const mins = dailySleepDurationMinutes(r.sleep_start, r.wake_time);
    return mins !== null && mins >= 420;
  }, 'focus');
  if (sleepFocus.sufficient) {
    out.push({
      text: `On days following 7h+ of sleep, average Focus was ${sleepFocus.a.mean} `
        + `(${sleepFocus.a.n} days), compared with ${sleepFocus.b.mean} on days below 7h `
        + `(${sleepFocus.b.n} days).`,
      kind: 'association',
      evidence: sleepFocus,
    });
  }

  const sleepEnergy = dailyGroupCompare(records, r => (r.sleep_quality || 0) >= 7, 'energy');
  if (sleepEnergy.sufficient) {
    out.push({
      text: `On days after sleep rated 7+, average Energy was ${sleepEnergy.a.mean} `
        + `(${sleepEnergy.a.n} days), compared with ${sleepEnergy.b.mean} otherwise `
        + `(${sleepEnergy.b.n} days).`,
      kind: 'association',
      evidence: sleepEnergy,
    });
  }

  const tvFocus = dailyGroupCompare(records, r => (r.tradingview_opens || 0) >= 5, 'focus');
  if (tvFocus.sufficient) {
    out.push({
      text: `On days with 5 or more TradingView opens, average Focus was ${tvFocus.a.mean} `
        + `(${tvFocus.a.n} days), compared with ${tvFocus.b.mean} on days with fewer `
        + `(${tvFocus.b.n} days).`,
      kind: 'association',
      evidence: tvFocus,
    });
  }

  const htbFocus = dailyGroupCompare(records, r => !!r.htb_completed, 'focus');
  if (htbFocus.sufficient) {
    out.push({
      text: `On days HTB was completed, average Focus was ${htbFocus.a.mean} `
        + `(${htbFocus.a.n} days), compared with ${htbFocus.b.mean} on days it was not `
        + `(${htbFocus.b.n} days).`,
      kind: 'association',
      evidence: htbFocus,
    });
  }

  return out;
}

// Week-over-week movement. `improved` / `declined` are literal comparisons of
// two reported percentages, so a habit only appears when both weeks actually
// have data behind them.
function dailyWeeklyReview(endIso) {
  const end = endIso || dailyTodayIso();
  const thisWeek = DAILY.windowDays(7, end);
  const prevWeek = DAILY.windowDays(7, dailyShiftIso(end, -7));

  const improved = [];
  const declined = [];
  const steady = [];
  DAILY_CORE_HABITS.concat(DAILY_EXTRA_HABITS).forEach(h => {
    const now = dailyConsistency(thisWeek, h.id);
    const before = dailyConsistency(prevWeek, h.id);
    if (now.pct === null || before.pct === null) return;
    const entry = { label: h.label, now: now.pct, before: before.pct, delta: now.pct - before.pct };
    if (entry.delta > 0) improved.push(entry);
    else if (entry.delta < 0) declined.push(entry);
    else steady.push(entry);
  });
  improved.sort((a, b) => b.delta - a.delta);
  declined.sort((a, b) => a.delta - b.delta);

  const mind = {};
  DAILY_MIND_METRICS.forEach(m => {
    const now = dailyMean(thisWeek.map(r => r[m.id]));
    const before = dailyMean(prevWeek.map(r => r[m.id]));
    mind[m.id] = {
      label: m.label,
      now: dailyRound(now),
      before: dailyRound(before),
      delta: (now !== null && before !== null) ? dailyRound(now - before) : null,
    };
  });

  return {
    endIso: end,
    reportedDays: thisWeek.length,
    previousReportedDays: prevWeek.length,
    improved,
    declined,
    steady,
    mind,
    sleep: dailySleepStats(thisWeek),
    previousSleep: dailySleepStats(prevWeek),
    tradingview: dailyTradingViewStats(thisWeek),
    previousTradingview: dailyTradingViewStats(prevWeek),
    frictions: thisWeek.map(r => ({ date: r.date, text: (r.friction || '').trim() }))
      .filter(f => f.text),
    wins: thisWeek.map(r => ({ date: r.date, text: (r.win_of_day || '').trim() }))
      .filter(w => w.text),
    observations: dailyBehaviouralObservations(DAILY.windowDays(90, end)),
  };
}

// Which topics are due for a delayed recall, and at which rung of the ladder.
// A topic climbs a rung per completed attempt, so the gap widens as it is
// successfully revisited without committing to a rigid SM-2 schedule.
function dailyDueRecalls(todayIso) {
  const today = todayIso || dailyTodayIso();
  return DAILY.topics().map(topic => {
    const attempts = DAILY.recallsFor(topic.id);
    const rung = Math.min(attempts.length, DAILY_RECALL_INTERVALS_DAYS.length - 1);
    const intervalDays = DAILY_RECALL_INTERVALS_DAYS[rung];
    const anchorDate = attempts.length
      ? (attempts[attempts.length - 1].prompted_at || '').slice(0, 10)
      : topic.first_learned_date;
    if (!anchorDate) return null;
    const dueDate = dailyShiftIso(anchorDate, intervalDays);
    return {
      topic,
      attempts,
      intervalDays,
      dueDate,
      overdueDays: dailyDaysBetween(dueDate, today),
      due: dueDate <= today,
    };
  }).filter(Boolean).sort((a, b) => b.overdueDays - a.overdueDays);
}

// Retention view: what has been studied, how often it has been revisited, and
// what the latest evaluation said. Score is null until something actually
// evaluates an attempt — never estimated, never filled in with a placeholder.
function dailyRetentionTable() {
  return DAILY.topics().map(topic => {
    const attempts = DAILY.recallsFor(topic.id);
    const evaluated = attempts.filter(a => a.evaluation && typeof a.evaluation.score === 'number');
    const latest = evaluated.length ? evaluated[evaluated.length - 1] : null;
    return {
      topic,
      attemptCount: attempts.length,
      lastAttempt: attempts.length ? attempts[attempts.length - 1] : null,
      latestScore: latest ? latest.evaluation.score : null,
      avgScore: dailyRound(dailyMean(evaluated.map(a => a.evaluation.score))),
      weakPoints: latest && Array.isArray(latest.evaluation.weak_points)
        ? latest.evaluation.weak_points : [],
    };
  }).sort((a, b) => (a.topic.first_learned_date < b.topic.first_learned_date ? 1 : -1));
}

// Exported for test_daily_logic.js under Node. In the browser this file is a
// plain <script>, so everything above is already a global and this is skipped.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DAILY, DAILY_KEYS, DAILY_CORE_HABITS, DAILY_EXTRA_HABITS, DAILY_MIND_METRICS,
    DAILY_DEFAULT_SETTINGS, DAILY_RECALL_INTERVALS_DAYS, DAILY_MIN_GROUP_N,
    dailyToIso, dailyTodayIso, dailyShiftIso, dailyDaysBetween, dailyWeekdayIndex,
    dailyParseClock, dailySleepDurationMinutes, dailyFormatDuration,
    dailySleepLooksImplausible, dailyBedtimeToAnchored, dailyAnchoredToClock,
    dailyMean, dailyStdDev, dailyRound,
    dailyEmptyRecord, dailyNormalizeRecord, dailyIsBlank, dailyClampScore, dailyClampCount,
    dailyCoreDoneCount, dailyExtraDoneCount, dailyDayTier,
    dailyConsistency, dailyConsistencyTable, dailySleepStats, dailyGroupCompare,
    dailyTradingViewStats, dailyBehaviouralObservations, dailyWeeklyReview,
    dailyDueRecalls, dailyRetentionTable,
  };
}
