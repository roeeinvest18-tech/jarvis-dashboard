// Personal OS → Today — the daily execution surface.
//
// Rebuilt for the two-area restructure. Today now holds ONLY personal
// content: the ticker search and the market status bar moved to Trading,
// where they belong. Reading the market is not part of a morning routine,
// and putting it above one made the screen ask two unrelated questions.
//
// Rendering only — the data model, persistence and sync all stay in
// daily.js, unchanged by the restructure.
//
// LANGUAGE RULE, enforced here rather than left to copy review: an
// incomplete habit is never "failed", "missed", or marked with a red cross.
// A new user sees BUILDING; a returning one sees their streak. The absence
// of a tick is simply the absence of a tick.

let dailyActiveDate = null;
let dailyClosingStep = null;
let dailySleepModalOpen = false;

const DAILY_CLOSE_STEPS = [
  { id: 'mind', label: 'Mind' },
  { id: 'sleep', label: 'Sleep' },
  { id: 'routine', label: 'Routine' },
  { id: 'nutrition', label: 'Nutrition' },
  { id: 'learning', label: 'Learning' },
  { id: 'trading', label: 'Trading' },
  { id: 'career', label: 'Career' },
  { id: 'reflection', label: 'Reflection' },
];

function dailyCurrentDate() {
  return dailyActiveDate || dailyTodayIso();
}

function dailyGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// The Hebrew calendar date, from Intl rather than a bundled conversion
// table: it is already in every browser this runs on, so a hand-rolled
// converter would be a dependency and a source of drift for no gain.
function dailyHebrewDate(iso) {
  try {
    return new Intl.DateTimeFormat('en-u-ca-hebrew', {
      day: 'numeric', month: 'long', year: 'numeric',
    }).format(new Date(`${iso}T12:00:00`));
  } catch (e) {
    return new Date(`${iso}T12:00:00`)
      .toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }
}

// Consecutive days, counting back from today, on which at least one habit was
// ticked. A day never checked in ends the run — but see dailyStatusBadge:
// a zero streak is reported as BUILDING, never as a failure.
function dailyStreakDays(endIso) {
  const end = endIso || dailyTodayIso();
  const all = DAILY.days();
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const date = dailyShiftIso(end, -i);
    const record = all[date];
    if (!record) break;
    const normalized = dailyNormalizeRecord(record, date);
    const any = DAILY_CORE_HABITS.concat(DAILY_EXTRA_HABITS).some(h => !!normalized[h.id]);
    if (!any) break;
    streak += 1;
  }
  return streak;
}

// BUILDING while there is nothing to count yet; the streak once there is.
function dailyStatusBadge(endIso) {
  const end = endIso || dailyTodayIso();
  const week = DAILY.windowDays(7, end);
  const anyRecent = week.some(r =>
    DAILY_CORE_HABITS.concat(DAILY_EXTRA_HABITS).some(h => !!r[h.id]));
  if (!anyRecent) return { text: 'BUILDING', kind: 'building' };
  const streak = dailyStreakDays(end);
  if (streak <= 0) return { text: 'BUILDING', kind: 'building' };
  return { text: `${streak} DAY${streak === 1 ? '' : 'S'}`, kind: 'streak' };
}

function dailyIsTrainingDay(iso) {
  const day = dailyWeekdayIndex(iso);
  if (typeof TRAINING_SCHEDULE_DAYS !== 'undefined') return TRAINING_SCHEDULE_DAYS.includes(day);
  return [0, 2, 4].includes(day);
}

// --- sync -----------------------------------------------------------------

let dailySyncInFlight = false;

function dailyTriggerSync() {
  if (dailySyncInFlight) return;
  const { url, token } = DAILY.syncConfig();
  if (!url || !token) return;
  dailySyncInFlight = true;
  DAILY.syncWithServer().then(state => {
    dailySyncInFlight = false;
    if (state) renderDailyToday();
  });
}

function dailyPatch(patch) {
  DAILY.saveDay(dailyCurrentDate(), patch);
  renderDailyToday();
  dailyTriggerSync();
}

// --- pieces ---------------------------------------------------------------

const DAILY_CHECK_SVG = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
  <path d="M2.5 6.2L4.8 8.5L9.5 3.8" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const DAILY_MOON_SVG = `<svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
  <path d="M15.2 11.1A6.8 6.8 0 0 1 6.9 2.8a6.9 6.9 0 1 0 8.3 8.3z" stroke="currentColor"
        stroke-width="1.5" stroke-linejoin="round"/></svg>`;

function dailyHabitCardHtml(id, label, checked, attr = 'data-daily-toggle') {
  return `
    <button type="button" class="habit ${checked ? 'is-done' : ''}"
            ${attr}="${escapeHtml(id)}" aria-pressed="${checked ? 'true' : 'false'}">
      <span class="habit-box" aria-hidden="true">${checked ? DAILY_CHECK_SVG : ''}</span>
      <span class="habit-label">${escapeHtml(label)}</span>
    </button>`;
}

function dailyExtraLabel(habit, settings) {
  if (habit.id === 'protein_target_met') return `Protein ${settings.protein_target_g}g`;
  if (habit.id === 'water_target_met') return `Water ${settings.water_target_l}L`;
  return habit.label;
}

function dailySleepCardHtml(record) {
  const mins = dailySleepDurationMinutes(record.sleep_start, record.wake_time);
  if (mins === null) {
    return `
      <button type="button" class="sleep-prompt" data-daily-sleep-modal>
        <span class="sleep-prompt-icon" aria-hidden="true">${DAILY_MOON_SVG}</span>
        <span class="sleep-prompt-text">Log last night's sleep</span>
      </button>`;
  }
  return `
    <button type="button" class="sleep-prompt is-logged" data-daily-sleep-modal>
      <span class="sleep-prompt-icon" aria-hidden="true">${DAILY_MOON_SVG}</span>
      <span class="sleep-logged">
        <span class="sleep-logged-times mono">${escapeHtml(record.sleep_start)} → ${escapeHtml(record.wake_time)}</span>
        <span class="sleep-logged-meta">
          <span class="mono">${dailyFormatDuration(mins)}</span>
          ${record.sleep_quality !== null
            ? `<span class="mono">Quality ${record.sleep_quality}/10</span>` : ''}
        </span>
      </span>
    </button>`;
}

function dailyPrioritiesHtml(record) {
  const list = record.priorities.filter(p => (p || '').trim());
  const cards = list.map((text, i) => `
    <div class="prio ${record.priorities_done && record.priorities_done[i] ? 'is-done' : ''}">
      <button type="button" class="prio-main" data-daily-prio-done="${i}"
              aria-pressed="${record.priorities_done && record.priorities_done[i] ? 'true' : 'false'}">
        <span class="prio-rank mono">${i + 1}</span>
        <span class="prio-text">${escapeHtml(text)}</span>
      </button>
      <button type="button" class="prio-remove" data-daily-prio-remove="${i}"
              aria-label="Remove priority ${i + 1}">&times;</button>
    </div>`).join('');

  const canAdd = list.length < 3;
  return `${cards}${canAdd ? `
    <button type="button" class="prio-add" data-daily-prio-add>+ Add priority</button>` : ''}`;
}

// --- the screen -----------------------------------------------------------

function renderDailyToday() {
  const mount = document.getElementById('panel-today');
  if (!mount) return;

  const date = dailyCurrentDate();
  const record = DAILY.getDay(date);
  const isToday = date === dailyTodayIso();
  const badge = dailyStatusBadge(date);
  const settings = DAILY.settings();
  const trainingDay = dailyIsTrainingDay(date);

  mount.innerHTML = `
    <div class="today-head">
      <h1 class="today-greeting">${isToday ? escapeHtml(dailyGreeting()) : 'Reviewing'}</h1>
      <div class="today-sub">
        <span class="today-hebrew">${escapeHtml(dailyHebrewDate(date))}</span>
        <span class="today-badge is-${badge.kind}">${escapeHtml(badge.text)}</span>
      </div>
    </div>

    ${!isToday ? `<div class="today-editing">
      Editing a past day.
      <button type="button" class="linkbtn" data-daily-back-today>Back to today</button>
    </div>` : ''}

    ${dailySleepCardHtml(record)}

    <section class="today-group">
      <h2 class="sec-label">Morning core</h2>
      <div class="habit-grid">
        ${DAILY_CORE_HABITS.map(h => dailyHabitCardHtml(h.id, h.label, !!record[h.id])).join('')}
      </div>
    </section>

    ${record.spiritual_learning ? `
      <div class="followup">
        <label class="followup-label" for="daily-spiritual-note">What did you learn?</label>
        <input type="text" id="daily-spiritual-note" class="text-input"
               data-daily-text="spiritual_learning_note" maxlength="140"
               placeholder="Mesillat Yesharim — Chapter 4"
               value="${escapeHtml(record.spiritual_learning_note || '')}">
      </div>` : ''}

    ${record.htb_completed ? `
      <div class="followup">
        <label class="followup-label" for="daily-htb-topic">What did you study?</label>
        <input type="text" id="daily-htb-topic" class="text-input"
               data-daily-text="htb_topic" maxlength="140" placeholder="Kerberos"
               value="${escapeHtml(record.htb_topic || '')}">
      </div>` : ''}

    ${record.minimum_day ? '' : `
    <section class="today-group">
      <div class="sec-label-row">
        <h2 class="sec-label">Also today</h2>
        ${trainingDay ? `<span class="sec-note">training day</span>` : ''}
      </div>
      <div class="habit-grid">
        ${DAILY_EXTRA_HABITS.map(h =>
          dailyHabitCardHtml(h.id, dailyExtraLabel(h, settings), !!record[h.id])).join('')}
        ${(settings.supplements || []).map(s =>
          dailyHabitCardHtml(s.id, s.label, !!record.supplements[s.id], 'data-daily-supplement')).join('')}
      </div>
    </section>`}

    <section class="today-group">
      <h2 class="sec-label">Today's priorities</h2>
      <div class="prio-list">${dailyPrioritiesHtml(record)}</div>
    </section>

    <div class="today-tv">
      <span class="today-tv-label">TradingView opens</span>
      <div class="today-tv-controls">
        <button type="button" class="stepper" data-daily-tv="-1" aria-label="One fewer TradingView open">−</button>
        <span class="today-tv-count mono">${record.tradingview_opens === null ? '—' : record.tradingview_opens}</span>
        <button type="button" class="stepper" data-daily-tv="1" aria-label="One more TradingView open">+</button>
      </div>
    </div>

    <div class="today-minimum-row">
      <button type="button" class="minimum-btn ${record.minimum_day ? 'is-on' : ''}"
              data-daily-minimum aria-pressed="${record.minimum_day ? 'true' : 'false'}">
        ${record.minimum_day ? 'Minimum day: on' : 'Minimum day'}
      </button>
    </div>
    ${record.minimum_day ? `<p class="today-minimum-note">Core five only. Everything else is still tracked, just out of the way.</p>` : ''}

    <div class="close-day-bar">
      <button type="button" class="close-day-btn" data-daily-close-day>
        ${record.closed ? 'Reopen the day' : 'Close the Day'}
      </button>
    </div>
  `;

  wireDailyToday();
  if (dailySleepModalOpen) renderDailySleepModal();
  if (dailyClosingStep !== null) renderDailyCloseFlow();
}

function wireDailyToday() {
  const mount = document.getElementById('panel-today');
  if (!mount) return;

  mount.querySelectorAll('[data-daily-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.dailyToggle;
      dailyPatch({ [id]: !DAILY.getDay(dailyCurrentDate())[id] });
    });
  });

  mount.querySelectorAll('[data-daily-supplement]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.dailySupplement;
      const current = DAILY.getDay(dailyCurrentDate()).supplements || {};
      dailyPatch({ supplements: { ...current, [id]: !current[id] } });
    });
  });

  // Text commits on blur, not per keystroke: a re-render per character would
  // fight the caret and churn the sync endpoint for no benefit.
  mount.querySelectorAll('[data-daily-text]').forEach(input => {
    const commit = () => {
      const field = input.dataset.dailyText;
      const record = DAILY.getDay(dailyCurrentDate());
      if ((record[field] || '') === input.value) return;
      DAILY.saveDay(dailyCurrentDate(), { [field]: input.value });
      if (field === 'htb_topic') dailyCaptureTopic(input.value);
      dailyTriggerSync();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') input.blur(); });
  });

  mount.querySelectorAll('[data-daily-tv]').forEach(btn => {
    btn.addEventListener('click', () => {
      const delta = Number(btn.dataset.dailyTv);
      const current = DAILY.getDay(dailyCurrentDate()).tradingview_opens;
      dailyPatch({ tradingview_opens: Math.max(0, (current === null ? 0 : current) + delta) });
    });
  });

  mount.querySelectorAll('[data-daily-prio-done]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.dailyPrioDone);
      const record = DAILY.getDay(dailyCurrentDate());
      const done = [...(record.priorities_done || [])];
      while (done.length < record.priorities.length) done.push(false);
      done[idx] = !done[idx];
      dailyPatch({ priorities_done: done });
    });
  });

  mount.querySelectorAll('[data-daily-prio-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.dailyPrioRemove);
      const record = DAILY.getDay(dailyCurrentDate());
      const priorities = record.priorities.filter((_, i) => i !== idx);
      const done = (record.priorities_done || []).filter((_, i) => i !== idx);
      dailyPatch({ priorities, priorities_done: done });
    });
  });

  const add = mount.querySelector('[data-daily-prio-add]');
  if (add) add.addEventListener('click', () => dailyOpenPriorityInput(add));

  const minimumBtn = mount.querySelector('[data-daily-minimum]');
  if (minimumBtn) {
    minimumBtn.addEventListener('click', () => {
      dailyPatch({ minimum_day: !DAILY.getDay(dailyCurrentDate()).minimum_day });
    });
  }

  const sleepBtn = mount.querySelector('[data-daily-sleep-modal]');
  if (sleepBtn) {
    sleepBtn.addEventListener('click', () => {
      dailySleepModalOpen = true;
      renderDailySleepModal();
    });
  }

  const closeBtn = mount.querySelector('[data-daily-close-day]');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const record = DAILY.getDay(dailyCurrentDate());
      if (record.closed) { dailyPatch({ closed: false }); return; }
      dailyClosingStep = 0;
      renderDailyCloseFlow();
    });
  }

  const back = mount.querySelector('[data-daily-back-today]');
  if (back) {
    back.addEventListener('click', () => {
      dailyActiveDate = null;
      renderDailyToday();
    });
  }
}

// Swaps the ghost card for a live input in place, rather than opening a
// dialog for one short string.
function dailyOpenPriorityInput(ghostBtn) {
  const wrap = document.createElement('div');
  wrap.className = 'prio-new';
  wrap.innerHTML = `<input type="text" class="text-input" maxlength="80"
    placeholder="What matters today?" aria-label="New priority">`;
  ghostBtn.replaceWith(wrap);
  const input = wrap.querySelector('input');
  input.focus();

  const commit = () => {
    const value = input.value.trim();
    if (!value) { renderDailyToday(); return; }
    const record = DAILY.getDay(dailyCurrentDate());
    const priorities = [...record.priorities.filter(p => (p || '').trim()), value].slice(0, 3);
    dailyPatch({ priorities });
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
    if (ev.key === 'Escape') { input.value = ''; input.blur(); }
  });
}

function dailyCaptureTopic(name) {
  const clean = (name || '').trim();
  if (!clean) return;
  DAILY.upsertTopic(clean, { date: dailyCurrentDate(), source: 'HTB' });
}

// --- sleep modal ----------------------------------------------------------

function renderDailySleepModal() {
  let overlay = document.getElementById('daily-sleep-overlay');
  if (!dailySleepModalOpen) {
    if (overlay) overlay.remove();
    return;
  }
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'daily-sleep-overlay';
    overlay.className = 'sheet-overlay';
    document.body.appendChild(overlay);
  }

  const record = DAILY.getDay(dailyCurrentDate());
  const mins = dailySleepDurationMinutes(record.sleep_start, record.wake_time);

  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Log sleep">
      <div class="sheet-head">
        <span class="sheet-kicker">Sleep</span>
        <button type="button" class="sheet-x" data-sleep-close aria-label="Close">&times;</button>
      </div>
      <div class="sheet-body">
        <p class="sheet-hint">Duration is worked out for you.</p>
        <div class="time-row">
          <label class="time-field"><span>Asleep</span>
            <input type="time" data-daily-time="sleep_start" value="${escapeHtml(record.sleep_start || '')}"></label>
          <label class="time-field"><span>Awake</span>
            <input type="time" data-daily-time="wake_time" value="${escapeHtml(record.wake_time || '')}"></label>
        </div>
        <div class="computed mono">
          ${mins === null ? 'Duration —' : `Duration ${dailyFormatDuration(mins)}`}
          ${dailySleepLooksImplausible(mins) ? ' · that looks unusual, worth a second look' : ''}
        </div>
        ${dailyScaleHtml('sleep_quality', 'Sleep quality', record.sleep_quality)}
      </div>
      <div class="sheet-foot">
        <span></span>
        <button type="button" class="btn-primary" data-sleep-close>Done</button>
      </div>
    </div>`;

  overlay.querySelectorAll('[data-daily-time]').forEach(input => {
    input.addEventListener('change', () => {
      DAILY.saveDay(dailyCurrentDate(), { [input.dataset.dailyTime]: input.value || null });
      renderDailySleepModal();
      renderDailyToday();
      dailyTriggerSync();
    });
  });
  overlay.querySelectorAll('[data-daily-scale]').forEach(btn => {
    btn.addEventListener('click', () => {
      const value = dailyClampScore(btn.dataset.value);
      const current = DAILY.getDay(dailyCurrentDate()).sleep_quality;
      DAILY.saveDay(dailyCurrentDate(), { sleep_quality: current === value ? null : value });
      renderDailySleepModal();
      renderDailyToday();
      dailyTriggerSync();
    });
  });
  overlay.querySelectorAll('[data-sleep-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      dailySleepModalOpen = false;
      renderDailySleepModal();
      renderDailyToday();
    });
  });
}

function dailyScaleHtml(id, label, value) {
  return `
    <div class="scale">
      <div class="scale-head">
        <span>${escapeHtml(label)}</span>
        <span class="scale-value mono">${value === null ? '—' : value + '/10'}</span>
      </div>
      <div class="scale-row" role="group" aria-label="${escapeHtml(label)} 1 to 10">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `
          <button type="button" class="scale-dot ${value === n ? 'is-selected' : ''}"
                  data-daily-scale="${escapeHtml(id)}" data-value="${n}"
                  aria-label="${escapeHtml(label)} ${n} of 10"
                  aria-pressed="${value === n ? 'true' : 'false'}">${n}</button>`).join('')}
      </div>
    </div>`;
}

// --- Close the Day --------------------------------------------------------

function dailyCloseStepBodyHtml(step, record, settings) {
  switch (step.id) {
    case 'mind':
      return `
        <p class="sheet-hint">How the day actually felt.</p>
        ${DAILY_MIND_METRICS.map(m => dailyScaleHtml(m.id, m.label, record[m.id])).join('')}
        ${dailyHabitCardHtml('meditation', 'Meditation', !!record.meditation)}`;

    case 'sleep': {
      const mins = dailySleepDurationMinutes(record.sleep_start, record.wake_time);
      return `
        <p class="sheet-hint">Last night. Duration is worked out for you.</p>
        <div class="time-row">
          <label class="time-field"><span>Asleep</span>
            <input type="time" data-daily-time="sleep_start" value="${escapeHtml(record.sleep_start || '')}"></label>
          <label class="time-field"><span>Awake</span>
            <input type="time" data-daily-time="wake_time" value="${escapeHtml(record.wake_time || '')}"></label>
        </div>
        <div class="computed mono" id="daily-sleep-computed">
          ${mins === null ? 'Duration —' : `Duration ${dailyFormatDuration(mins)}`}
          ${dailySleepLooksImplausible(mins) ? ' · that looks unusual, worth a second look' : ''}
        </div>
        ${dailyScaleHtml('sleep_quality', 'Sleep quality', record.sleep_quality)}`;
    }

    case 'routine':
      return `
        <p class="sheet-hint">Anything you finished but haven't ticked.</p>
        <div class="habit-grid">
          ${DAILY_CORE_HABITS.map(h => dailyHabitCardHtml(h.id, h.label, !!record[h.id])).join('')}
          ${DAILY_EXTRA_HABITS.filter(h => h.id !== 'career_output')
            .map(h => dailyHabitCardHtml(h.id, dailyExtraLabel(h, settings), !!record[h.id])).join('')}
        </div>`;

    case 'nutrition':
      return `
        <p class="sheet-hint">Targets only — no food diary.</p>
        <div class="habit-grid">
          ${dailyHabitCardHtml('protein_target_met', `Protein ${settings.protein_target_g}g`, !!record.protein_target_met)}
          ${dailyHabitCardHtml('water_target_met', `Water ${settings.water_target_l}L`, !!record.water_target_met)}
          ${(settings.supplements || []).map(s =>
            dailyHabitCardHtml(s.id, s.label, !!record.supplements[s.id], 'data-daily-supplement')).join('')}
        </div>`;

    case 'learning':
      return `
        <p class="sheet-hint">No duration needed — just what you covered.</p>
        <div class="habit-grid">
          ${dailyHabitCardHtml('htb_completed', 'HTB completed', !!record.htb_completed)}
          ${dailyHabitCardHtml('spiritual_learning', 'Spiritual learning', !!record.spiritual_learning)}
        </div>
        ${record.htb_completed ? `
          <input type="text" class="text-input" data-daily-text="htb_topic"
                 maxlength="140" placeholder="Kerberos"
                 value="${escapeHtml(record.htb_topic || '')}">` : ''}
        ${record.spiritual_learning ? `
          <input type="text" class="text-input" data-daily-text="spiritual_learning_note"
                 maxlength="140" placeholder="Mesillat Yesharim — Chapter 4"
                 value="${escapeHtml(record.spiritual_learning_note || '')}">` : ''}`;

    case 'trading':
      return `
        <p class="sheet-hint">How many times you opened TradingView today.</p>
        <div class="bignum-row">
          <button type="button" class="bignum-btn" data-daily-tv="-1" aria-label="One fewer">−</button>
          <input type="number" min="0" inputmode="numeric" class="bignum-input mono"
                 data-daily-number="tradingview_opens" aria-label="TradingView opens"
                 value="${record.tradingview_opens === null ? '' : record.tradingview_opens}">
          <button type="button" class="bignum-btn" data-daily-tv="1" aria-label="One more">+</button>
        </div>
        <p class="sheet-hint">Screen time, if you have it to hand (Settings → Screen Time).</p>
        <div class="time-row">
          <label class="time-field"><span>Total (min)</span>
            <input type="number" min="0" inputmode="numeric" class="mono" data-daily-screen="total_min"
                   value="${record.screen_time.total_min === null ? '' : record.screen_time.total_min}"></label>
          <label class="time-field"><span>Social (min)</span>
            <input type="number" min="0" inputmode="numeric" class="mono" data-daily-screen="social_min"
                   value="${record.screen_time.social_min === null ? '' : record.screen_time.social_min}"></label>
          <label class="time-field"><span>YouTube (min)</span>
            <input type="number" min="0" inputmode="numeric" class="mono" data-daily-screen="youtube_min"
                   value="${record.screen_time.youtube_min === null ? '' : record.screen_time.youtube_min}"></label>
        </div>`;

    case 'career':
      return `
        <p class="sheet-hint">Only when it was on the plan — skipping is not a miss.</p>
        ${dailyHabitCardHtml('career_output', 'Career output today', !!record.career_output)}
        <p class="sheet-hint">Applied, messaged a recruiter, prepped, improved the CV or a project.</p>`;

    case 'reflection':
      return `
        <label class="followup-label" for="daily-win">Win of the day</label>
        <input type="text" id="daily-win" class="text-input" data-daily-text="win_of_day"
               maxlength="200" placeholder="One thing that went well"
               value="${escapeHtml(record.win_of_day || '')}">
        <label class="followup-label" for="daily-friction">Friction</label>
        <input type="text" id="daily-friction" class="text-input" data-daily-text="friction"
               maxlength="200" placeholder="What got in the way"
               value="${escapeHtml(record.friction || '')}">`;

    default:
      return '';
  }
}

function renderDailyCloseFlow() {
  let overlay = document.getElementById('daily-close-overlay');
  if (dailyClosingStep === null) {
    if (overlay) overlay.remove();
    return;
  }
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'daily-close-overlay';
    overlay.className = 'sheet-overlay';
    document.body.appendChild(overlay);
  }

  const step = DAILY_CLOSE_STEPS[dailyClosingStep];
  const record = DAILY.getDay(dailyCurrentDate());
  const settings = DAILY.settings();
  const isLast = dailyClosingStep === DAILY_CLOSE_STEPS.length - 1;

  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Close the day — ${escapeHtml(step.label)}">
      <div class="sheet-head">
        <span class="sheet-kicker">Close the Day</span>
        <button type="button" class="sheet-x" data-daily-step-cancel aria-label="Close">&times;</button>
      </div>
      <div class="steps-rail" aria-hidden="true">
        ${DAILY_CLOSE_STEPS.map((s, i) => `
          <span class="step-pip ${i === dailyClosingStep ? 'is-current' : ''} ${i < dailyClosingStep ? 'is-past' : ''}"></span>`).join('')}
      </div>
      <div class="sheet-body">
        <h3 class="sheet-title">${escapeHtml(step.label)}</h3>
        ${dailyCloseStepBodyHtml(step, record, settings)}
      </div>
      <div class="sheet-foot">
        ${dailyClosingStep > 0
          ? `<button type="button" class="btn-ghost" data-daily-step-back>Back</button>`
          : `<span></span>`}
        <span class="step-count mono">${dailyClosingStep + 1} / ${DAILY_CLOSE_STEPS.length}</span>
        <button type="button" class="btn-primary" data-daily-step-next>
          ${isLast ? 'Complete day' : 'Next'}
        </button>
      </div>
    </div>`;

  wireDailyCloseFlow();
}

function wireDailyCloseFlow() {
  const overlay = document.getElementById('daily-close-overlay');
  if (!overlay) return;

  const patchLocal = (patch) => {
    DAILY.saveDay(dailyCurrentDate(), patch);
    renderDailyCloseFlow();
    renderDailyToday();
    dailyTriggerSync();
  };

  overlay.querySelectorAll('[data-daily-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.dailyToggle;
      patchLocal({ [id]: !DAILY.getDay(dailyCurrentDate())[id] });
    });
  });

  overlay.querySelectorAll('[data-daily-supplement]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.dailySupplement;
      const current = DAILY.getDay(dailyCurrentDate()).supplements || {};
      patchLocal({ supplements: { ...current, [id]: !current[id] } });
    });
  });

  overlay.querySelectorAll('[data-daily-scale]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.dailyScale;
      const value = dailyClampScore(btn.dataset.value);
      const current = DAILY.getDay(dailyCurrentDate())[id];
      // Tapping the selected dot clears it, so a mis-tap is correctable and a
      // metric can return to "not answered" rather than being stuck.
      patchLocal({ [id]: current === value ? null : value });
    });
  });

  overlay.querySelectorAll('[data-daily-time]').forEach(input => {
    input.addEventListener('change', () => {
      patchLocal({ [input.dataset.dailyTime]: input.value || null });
    });
  });

  overlay.querySelectorAll('[data-daily-text]').forEach(input => {
    const commit = () => {
      const field = input.dataset.dailyText;
      const record = DAILY.getDay(dailyCurrentDate());
      if ((record[field] || '') === input.value) return;
      DAILY.saveDay(dailyCurrentDate(), { [field]: input.value });
      if (field === 'htb_topic') dailyCaptureTopic(input.value);
      dailyTriggerSync();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') input.blur(); });
  });

  overlay.querySelectorAll('[data-daily-number]').forEach(input => {
    input.addEventListener('change', () => {
      DAILY.saveDay(dailyCurrentDate(), { [input.dataset.dailyNumber]: dailyClampCount(input.value) });
      dailyTriggerSync();
    });
  });

  overlay.querySelectorAll('[data-daily-screen]').forEach(input => {
    input.addEventListener('change', () => {
      const current = DAILY.getDay(dailyCurrentDate()).screen_time;
      DAILY.saveDay(dailyCurrentDate(), {
        screen_time: { ...current, [input.dataset.dailyScreen]: dailyClampCount(input.value) },
      });
      dailyTriggerSync();
    });
  });

  overlay.querySelectorAll('[data-daily-tv]').forEach(btn => {
    btn.addEventListener('click', () => {
      const delta = Number(btn.dataset.dailyTv);
      const current = DAILY.getDay(dailyCurrentDate()).tradingview_opens;
      patchLocal({ tradingview_opens: Math.max(0, (current === null ? 0 : current) + delta) });
    });
  });

  const back = overlay.querySelector('[data-daily-step-back]');
  if (back) back.addEventListener('click', () => { dailyClosingStep -= 1; renderDailyCloseFlow(); });

  const cancel = overlay.querySelector('[data-daily-step-cancel]');
  if (cancel) {
    cancel.addEventListener('click', () => {
      // Everything answered so far is already stored, so cancelling closes the
      // sheet without discarding anything.
      dailyClosingStep = null;
      renderDailyCloseFlow();
      renderDailyToday();
    });
  }

  const next = overlay.querySelector('[data-daily-step-next]');
  if (next) {
    next.addEventListener('click', () => {
      // Commit a focused field before advancing, or a value typed and not
      // blurred would be lost on the step change.
      if (document.activeElement && overlay.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      if (dailyClosingStep < DAILY_CLOSE_STEPS.length - 1) {
        dailyClosingStep += 1;
        renderDailyCloseFlow();
        return;
      }
      DAILY.saveDay(dailyCurrentDate(), { closed: true });
      dailyClosingStep = null;
      renderDailyCloseFlow();
      renderDailyToday();
      dailyTriggerSync();
    });
  }
}
