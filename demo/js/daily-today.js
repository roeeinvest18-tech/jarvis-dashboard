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

const TODAY_S = STRINGS.today;
const CLOSE_S = STRINGS.close;
const SLEEP_S = STRINGS.sleep;

const DAILY_CLOSE_STEPS = Object.keys(CLOSE_S.steps).map(id => ({ id, label: CLOSE_S.steps[id] }));

function dailyCurrentDate() {
  return dailyActiveDate || dailyTodayIso();
}

// Which day the screen is on. null means "follow the clock", so leaving the
// app open past midnight lands on the new day rather than pinning yesterday.
//
// A future date is never accepted: the store would happily key a record
// under one, and a day that has not happened has nothing to report. Anything
// at or after today collapses back to null.
function dailySetActiveDate(iso) {
  const today = dailyTodayIso();
  dailyActiveDate = (!iso || iso >= today) ? null : iso;
  return dailyCurrentDate();
}

// Exposed for the shell: switching to another tab and back keeps the day you
// were editing, but a fresh page load starts on today (dailyActiveDate is
// null until something sets it).
function dailyStepActiveDate(deltaDays) {
  return dailySetActiveDate(dailyShiftIso(dailyCurrentDate(), deltaDays));
}

// "Today", "Yesterday", or the full date -- the two nearest days are named
// because that is how they are thought about.
function dailyRelativeDayLabel(iso) {
  const today = dailyTodayIso();
  if (iso === today) return TODAY_S.dateNav.isToday;
  if (iso === dailyShiftIso(today, -1)) return TODAY_S.dateNav.yesterday;
  return dailyDisplayDate(iso);
}

function dailyGreeting() {
  const h = new Date().getHours();
  if (h < 12) return TODAY_S.greetingMorning;
  if (h < 18) return TODAY_S.greetingAfternoon;
  return TODAY_S.greetingEvening;
}

// The day's date in English. The interface is English throughout (owner's
// decision, 2026-09-22); this line used to show a Hebrew-calendar date, the
// one line on the screen in a different calendar.
function dailyDisplayDate(iso) {
  return new Date(`${iso}T12:00:00`)
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
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
    // A holiday/Shabbat is skipped, not treated as a break: the day before
    // it stays connected to the day after it. This is the one place that
    // can't just filter the day out of the list (dailyWindow's approach) --
    // a skipped date has to not count as a break in a walk that otherwise
    // reads consecutiveness from the calendar itself.
    if (record && record.is_holiday) continue;
    if (!record) break;
    const normalized = dailyNormalizeRecord(record, date);
    const any = DAILY_ALL_HABITS.some(h => !!normalized[h.id]);
    if (!any) break;
    streak += 1;
  }
  return streak;
}

// BUILDING while there is nothing to count yet; the streak once there is.
function dailyStatusBadge(endIso) {
  const end = endIso || dailyTodayIso();
  const week = DAILY.windowDays(7, end);
  const anyRecent = week.some(r => DAILY_ALL_HABITS.some(h => !!r[h.id]));
  if (!anyRecent) return { text: TODAY_S.building, kind: 'building' };
  const streak = dailyStreakDays(end);
  if (streak <= 0) return { text: TODAY_S.building, kind: 'building' };
  return { text: TODAY_S.streak(streak), kind: 'streak' };
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
  dailyFlashSaved();
  dailyTriggerSync();
}

// --- pieces ---------------------------------------------------------------

const DAILY_CHECK_SVG = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
  <path d="M2.5 6.2L4.8 8.5L9.5 3.8" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const DAILY_MOON_SVG = `<svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
  <path d="M15.2 11.1A6.8 6.8 0 0 1 6.9 2.8a6.9 6.9 0 1 0 8.3 8.3z" stroke="currentColor"
        stroke-width="1.5" stroke-linejoin="round"/></svg>`;

// `meta` is the quiet target-time text on the right of a scheduled row. It is
// the same whether or not the row is ticked, and whenever it was ticked: the
// screen never shows how a completion related to its deadline.
function dailyHabitCardHtml(id, label, checked, attr = 'data-daily-toggle', meta = '') {
  return `
    <button type="button" class="habit ${checked ? 'is-done' : ''}"
            ${attr}="${escapeHtml(id)}" aria-pressed="${checked ? 'true' : 'false'}">
      <span class="habit-box" aria-hidden="true">${checked ? DAILY_CHECK_SVG : ''}</span>
      <span class="habit-label">${escapeHtml(label)}</span>
      ${meta ? `<span class="habit-time mono">${escapeHtml(meta)}</span>` : ''}
    </button>`;
}

// --- the schedule groups ----------------------------------------------------
// Morning / Afternoon / Evening come from DAILY_SCHEDULE (schedule-config.js).
// The data underneath is unchanged: a day is still one flat record of habit
// ticks, and the groups are how those ticks are laid out, so no history needed
// reshaping to appear in them.

function dailyScheduleTimeText(item) {
  if (Array.isArray(item.window) && item.window.length === 2) {
    return TODAY_S.schedule.window(item.window[0], item.window[1]);
  }
  if (typeof item.deadline === 'string') return TODAY_S.schedule.by(item.deadline);
  return '';
}

function dailyScheduleNoteHtml(item) {
  const note = TODAY_S.schedule.notes[item.id];
  if (!note) return '';
  const time = Array.isArray(item.window) && item.window.length === 2
    ? TODAY_S.schedule.window(item.window[0], item.window[1]) : (item.at || '');
  return `<div class="sched-note">${escapeHtml(note(time))}</div>`;
}

function dailyScheduleGroupHtml(group, record, settings, trainingDay) {
  const coreIds = DAILY_CORE_HABITS.map(h => h.id);
  // A Minimum Day is the core five and nothing else, exactly as before: the
  // other items, the reference lines and the supplements step out of the way.
  const visible = group.items.filter(item =>
    !record.minimum_day || (item.kind === 'check' && coreIds.includes(item.id)));
  const rows = visible.map(item => {
    if (item.kind === 'note') return dailyScheduleNoteHtml(item);
    if (item.kind === 'supplements') {
      return (settings.supplements || []).map(sp =>
        dailyHabitCardHtml(sp.id, sp.label, !!record.supplements[sp.id], 'data-daily-supplement')).join('');
    }
    const habit = DAILY_ALL_HABITS.find(h => h.id === item.id);
    if (!habit) return '';
    return dailyHabitCardHtml(habit.id, dailyExtraLabel(habit, settings), !!record[habit.id],
      'data-daily-toggle', dailyScheduleTimeText(item));
  }).join('');
  if (!rows.trim()) return '';
  return `
    <section class="today-group" data-today-group="${escapeHtml(group.id)}">
      <div class="sec-label-row">
        <h2 class="sec-label">${TODAY_S.sections[group.id]}</h2>
        ${group.id === 'afternoon' && trainingDay && !record.minimum_day
          ? `<span class="sec-note">${TODAY_S.sections.trainingDay}</span>` : ''}
      </div>
      <div class="habit-grid">${rows}</div>
    </section>`;
}

function dailyFollowupsHtml(record) {
  return `${record.spiritual_learning ? `
      <div class="followup">
        <label class="followup-label" for="daily-spiritual-note">${TODAY_S.spiritualPrompt}</label>
        <input type="text" id="daily-spiritual-note" class="text-input"
               data-daily-text="spiritual_learning_note" maxlength="140"
               placeholder="${TODAY_S.spiritualPlaceholder}"
               value="${escapeHtml(record.spiritual_learning_note || '')}">
      </div>` : ''}

    ${record.htb_completed ? `
      <div class="followup">
        <label class="followup-label" for="daily-htb-topic">${TODAY_S.htbPrompt}</label>
        <input type="text" id="daily-htb-topic" class="text-input"
               data-daily-text="htb_topic" maxlength="140" placeholder="${TODAY_S.htbPlaceholder}"
               value="${escapeHtml(record.htb_topic || '')}">
      </div>` : ''}`;
}

function dailyExtraLabel(habit, settings) {
  if (habit.id === 'protein_target_met') return STRINGS.daily.proteinTarget(settings.protein_target_g);
  if (habit.id === 'water_target_met') return STRINGS.daily.waterTarget(settings.water_target_l);
  return habit.label;
}

// Previous / next / today, always visible so the screen is never a dead end
// on a past day. The next button is genuinely disabled on today rather than
// hidden: a control that vanishes is harder to understand than one that is
// visibly unavailable, and the title says why.
function dailyDateNavHtml(date) {
  const today = dailyTodayIso();
  const atToday = date === today;
  const N = TODAY_S.dateNav;
  return `
    <nav class="day-nav" aria-label="${N.label}">
      <button type="button" class="day-nav-btn" data-daily-day-step="-1"
              aria-label="${N.previous}">&#8249;</button>
      <span class="day-nav-current">
        <span class="day-nav-label">${escapeHtml(dailyRelativeDayLabel(date))}</span>
        <span class="day-nav-state ${DAILY.hasDay(date) ? 'is-saved' : 'is-empty'}">${
          DAILY.hasDay(date) ? N.entrySaved : N.noEntry}</span>
      </span>
      <button type="button" class="day-nav-btn" data-daily-day-step="1"
              aria-label="${N.next}" ${atToday ? `disabled title="${N.noFuture}"` : ''}>&#8250;</button>
      <button type="button" class="day-nav-today ${atToday ? 'is-current' : ''}"
              data-daily-day-today ${atToday ? 'disabled' : ''}>${N.today}</button>
    </nav>`;
}

function dailySleepCardHtml(record) {
  const mins = dailySleepDurationMinutes(record.sleep_start, record.wake_time);
  if (mins === null) {
    return `
      <button type="button" class="sleep-prompt" data-daily-sleep-modal>
        <span class="sleep-prompt-icon" aria-hidden="true">${DAILY_MOON_SVG}</span>
        <span class="sleep-prompt-text">${TODAY_S.sleepPrompt}</span>
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
            ? `<span class="mono">${TODAY_S.sleepQuality(record.sleep_quality)}</span>` : ''}
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
              aria-label="${TODAY_S.priorityRemove(i + 1)}">&times;</button>
    </div>`).join('');

  const canAdd = list.length < 3;
  return `${cards}${canAdd ? `
    <button type="button" class="prio-add" data-daily-prio-add>+ ${TODAY_S.priorityAdd}</button>` : ''}`;
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
      <div class="today-head-row">
        <h1 class="today-greeting">${escapeHtml(isToday ? dailyGreeting() : TODAY_S.greetingPastDay)}</h1>
        <button type="button" class="holiday-toggle ${record.is_holiday ? 'is-on' : ''}"
                data-daily-holiday aria-pressed="${record.is_holiday ? 'true' : 'false'}">
          ${escapeHtml(record.is_holiday ? TODAY_S.holidayOn : TODAY_S.holiday)}
        </button>
      </div>
      <div class="today-sub">
        <span class="today-date">${escapeHtml(dailyDisplayDate(date))}</span>
        <span class="today-badge is-${badge.kind}">${escapeHtml(badge.text)}</span>
      </div>
    </div>

    ${dailyDateNavHtml(date)}

    ${!isToday ? `<div class="today-editing">
      ${TODAY_S.editingPastDay}
      <button type="button" class="linkbtn" data-daily-back-today>${TODAY_S.backToToday}</button>
    </div>` : ''}

    ${DAILY.hasDay(date) ? '' : `<p class="today-noentry">${TODAY_S.dateNav.noEntryHint}</p>`}

    ${dailySleepCardHtml(record)}

    ${DAILY_SCHEDULE.map(group => dailyScheduleGroupHtml(group, record, settings, trainingDay)
      + (group.id === 'morning' ? dailyFollowupsHtml(record) : '')).join('')}

    <section class="today-group">
      <h2 class="sec-label">${TODAY_S.sections.priorities}</h2>
      <div class="prio-list">${dailyPrioritiesHtml(record)}</div>
    </section>

    <div class="today-tv">
      <span class="today-tv-label">${TODAY_S.tradingViewLabel}</span>
      <div class="today-tv-controls">
        <button type="button" class="stepper" data-daily-tv="-1" aria-label="${TODAY_S.tradingViewFewer}">−</button>
        <input type="number" min="0" inputmode="numeric" class="today-tv-count mono"
               data-daily-number="tradingview_opens" aria-label="${TODAY_S.tradingViewLabel}"
               value="${record.tradingview_opens === null ? '' : record.tradingview_opens}">
        <button type="button" class="stepper" data-daily-tv="1" aria-label="${TODAY_S.tradingViewMore}">+</button>
      </div>
    </div>

    <div class="today-minimum-row">
      <button type="button" class="minimum-btn ${record.minimum_day ? 'is-on' : ''}"
              data-daily-minimum aria-pressed="${record.minimum_day ? 'true' : 'false'}">
        ${record.minimum_day ? TODAY_S.minimumDayOn : TODAY_S.minimumDay}
      </button>
    </div>
    ${record.minimum_day ? `<p class="today-minimum-note">${TODAY_S.minimumDayNote}</p>` : ''}

    <div class="close-day-bar">
      <button type="button" class="close-day-btn" data-daily-close-day>
        ${record.closed ? TODAY_S.reopenDay : TODAY_S.closeDay}
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
      const date = dailyCurrentDate();
      const record = DAILY.getDay(date);
      // Today is the one place a tick is stamped with its time: the tap is
      // the act. Past days and Close the Day are recording after the fact.
      dailyPatch(dailyHabitPatch(record, id, !record[id], { stamp: true, date }));
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

  // The count is also directly typable, not just stepped -- commits on
  // change (blur/Enter/native stepper), same as every other numeric field
  // here, so a re-render never fights a value mid-keystroke.
  mount.querySelectorAll('[data-daily-number]').forEach(input => {
    input.addEventListener('change', () => {
      dailyPatch({ [input.dataset.dailyNumber]: dailyClampCount(input.value) });
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

  // A simple toggle: tap to mark, tap again to unmark -- the day's other
  // data is untouched either way, only whether the analytics count it.
  const holidayBtn = mount.querySelector('[data-daily-holiday]');
  if (holidayBtn) {
    holidayBtn.addEventListener('click', () => {
      dailyPatch({ is_holiday: !DAILY.getDay(dailyCurrentDate()).is_holiday });
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
      dailySetActiveDate(null);
      renderDailyToday();
    });
  }

  mount.querySelectorAll('[data-daily-day-step]').forEach(btn => {
    btn.addEventListener('click', () => {
      dailyStepActiveDate(Number(btn.dataset.dailyDayStep));
      renderDailyToday();
    });
  });

  const todayBtn = mount.querySelector('[data-daily-day-today]');
  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      dailySetActiveDate(null);
      renderDailyToday();
    });
  }
}

// A write to a day you are not living through has no other feedback -- the
// habit fills in, but nothing says it reached this date's record rather than
// today's. The date bar says so for a moment.
function dailyFlashSaved() {
  const state = document.querySelector('.day-nav-state');
  if (!state) return;
  const previous = state.textContent;
  state.textContent = TODAY_S.dateNav.saved;
  state.classList.add('is-flash');
  setTimeout(() => {
    if (state.isConnected && state.textContent === TODAY_S.dateNav.saved) {
      state.textContent = previous;
      state.classList.remove('is-flash');
    }
  }, 1400);
}

// Swaps the ghost card for a live input in place, rather than opening a
// dialog for one short string.
function dailyOpenPriorityInput(ghostBtn) {
  const wrap = document.createElement('div');
  wrap.className = 'prio-new';
  wrap.innerHTML = `<input type="text" class="text-input" maxlength="80"
    placeholder="${TODAY_S.priorityPlaceholder}" aria-label="${TODAY_S.priorityNew}">`;
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
//
// Closes only on data-sleep-close (the X or Done) -- never on its own, never
// on an outside tap (this sheet has no such handler at all), never on a
// timer. renderDailySleepModal() used to rebuild the whole sheet's markup on
// every call, which recreated the <input type="time"> the browser's own
// picker was still attached to and dismissed it after one field -- and that
// call came from more places than the time-input handler itself, since
// renderDailyToday() re-invokes this on its own tail whenever the sheet is
// open. So the fix lives in renderDailySleepModal(): once the sheet exists,
// every re-entry updates only the derived bits (updateDailySleepComputed,
// updateDailySleepScale) and never touches the <input> nodes again.

function renderDailySleepModal() {
  let overlay = document.getElementById('daily-sleep-overlay');
  if (!dailySleepModalOpen) {
    if (overlay) overlay.remove();
    return;
  }

  const record = DAILY.getDay(dailyCurrentDate());

  // Already open: refresh only the derived bits, never the <input> nodes.
  // This is the path that matters, not just the time-input handler below --
  // renderDailyToday() calls this function again on its own tail whenever
  // the sheet is open, which every other Today action (not only a time
  // change) can trigger. Without this early return, any of those would have
  // rebuilt the sheet just the same and reintroduced the bug.
  if (overlay) {
    updateDailySleepComputed();
    updateDailySleepScale(record.sleep_quality);
    return;
  }

  overlay = document.createElement('div');
  overlay.id = 'daily-sleep-overlay';
  overlay.className = 'sheet-overlay';
  document.body.appendChild(overlay);

  const mins = dailySleepDurationMinutes(record.sleep_start, record.wake_time);

  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${SLEEP_S.dialogLabel}">
      <div class="sheet-head">
        <span class="sheet-kicker">${SLEEP_S.title}</span>
        <button type="button" class="sheet-x" data-sleep-close aria-label="${STRINGS.common.close}">&times;</button>
      </div>
      <div class="sheet-body">
        <p class="sheet-hint">${SLEEP_S.hint}</p>
        <div class="time-row">
          <label class="time-field"><span>${SLEEP_S.asleep}</span>
            <input type="time" data-daily-time="sleep_start" value="${escapeHtml(record.sleep_start || '')}"></label>
          <label class="time-field"><span>${SLEEP_S.awake}</span>
            <input type="time" data-daily-time="wake_time" value="${escapeHtml(record.wake_time || '')}"></label>
        </div>
        <div class="computed mono">
          ${mins === null ? SLEEP_S.durationUnknown : SLEEP_S.duration(dailyFormatDuration(mins))}
          ${dailySleepLooksImplausible(mins) ? SLEEP_S.implausible : ''}
        </div>
        ${dailyScaleHtml('sleep_quality', STRINGS.daily.mind.sleepQuality, record.sleep_quality)}
      </div>
      <div class="sheet-foot">
        <span></span>
        <button type="button" class="btn-primary" data-sleep-close>${STRINGS.common.done}</button>
      </div>
    </div>`;

  overlay.querySelectorAll('[data-daily-time]').forEach(input => {
    input.addEventListener('change', () => {
      DAILY.saveDay(dailyCurrentDate(), { [input.dataset.dailyTime]: input.value || null });
      // Only the derived duration text updates here -- a full
      // renderDailySleepModal() would recreate this <input> node mid-pick,
      // which is what dismissed the browser's own time picker after the
      // first field and read as "the sheet closes on its own". The sheet's
      // open/closed state is untouched; only data-sleep-close changes that.
      updateDailySleepComputed();
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

// Refreshes just the derived "Duration ..." line after a time changes,
// instead of the full sheet -- see renderDailySleepModal's time-input
// handler for why a full re-render there was the actual bug.
function updateDailySleepComputed() {
  const overlay = document.getElementById('daily-sleep-overlay');
  if (!overlay) return;
  const computed = overlay.querySelector('.computed');
  if (!computed) return;
  const record = DAILY.getDay(dailyCurrentDate());
  const mins = dailySleepDurationMinutes(record.sleep_start, record.wake_time);
  computed.innerHTML = `
    ${mins === null ? 'Duration —' : `Duration ${dailyFormatDuration(mins)}`}
    ${dailySleepLooksImplausible(mins) ? ' · that looks unusual, worth a second look' : ''}`;
}

// Refreshes the sleep-quality scale's selected state and "X/10" readout in
// place -- no risk to a native picker either way (a scale tap isn't one),
// but matching updateDailySleepComputed keeps every re-entry into an already
// open sheet equally cheap and equally safe.
function updateDailySleepScale(value) {
  const overlay = document.getElementById('daily-sleep-overlay');
  if (!overlay) return;
  const valueEl = overlay.querySelector('.scale-value');
  if (valueEl) valueEl.textContent = value === null ? '—' : `${value}/10`;
  overlay.querySelectorAll('[data-daily-scale]').forEach(btn => {
    const selected = Number(btn.dataset.value) === value;
    btn.classList.toggle('is-selected', selected);
    btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
}

function dailyScaleHtml(id, label, value) {
  return `
    <div class="scale">
      <div class="scale-head">
        <span>${escapeHtml(label)}</span>
        <span class="scale-value mono">${value === null ? STRINGS.common.none : CLOSE_S.scaleValue(value)}</span>
      </div>
      <div class="scale-row" role="group" aria-label="${escapeHtml(CLOSE_S.scaleGroup(label))}">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `
          <button type="button" class="scale-dot ${value === n ? 'is-selected' : ''}"
                  data-daily-scale="${escapeHtml(id)}" data-value="${n}"
                  aria-label="${escapeHtml(CLOSE_S.scalePoint(label, n))}"
                  aria-pressed="${value === n ? 'true' : 'false'}">${n}</button>`).join('')}
      </div>
    </div>`;
}

// --- Close the Day --------------------------------------------------------

function dailyCloseStepBodyHtml(step, record, settings) {
  switch (step.id) {
    case 'mind':
      return `
        <p class="sheet-hint">${CLOSE_S.hints.mind}</p>
        ${DAILY_MIND_METRICS.map(m => dailyScaleHtml(m.id, m.label, record[m.id])).join('')}
        ${dailyHabitCardHtml('meditation', STRINGS.daily.habits.meditation, !!record.meditation)}`;

    case 'sleep': {
      const mins = dailySleepDurationMinutes(record.sleep_start, record.wake_time);
      return `
        <p class="sheet-hint">${SLEEP_S.hintLastNight}</p>
        <div class="time-row">
          <label class="time-field"><span>${SLEEP_S.asleep}</span>
            <input type="time" data-daily-time="sleep_start" value="${escapeHtml(record.sleep_start || '')}"></label>
          <label class="time-field"><span>${SLEEP_S.awake}</span>
            <input type="time" data-daily-time="wake_time" value="${escapeHtml(record.wake_time || '')}"></label>
        </div>
        <div class="computed mono" id="daily-sleep-computed">
          ${mins === null ? SLEEP_S.durationUnknown : SLEEP_S.duration(dailyFormatDuration(mins))}
          ${dailySleepLooksImplausible(mins) ? SLEEP_S.implausible : ''}
        </div>
        ${dailyScaleHtml('sleep_quality', STRINGS.daily.mind.sleepQuality, record.sleep_quality)}`;
    }

    case 'routine':
      return `
        <p class="sheet-hint">${CLOSE_S.hints.routine}</p>
        <div class="habit-grid">
          ${DAILY_CORE_HABITS.map(h => dailyHabitCardHtml(h.id, h.label, !!record[h.id])).join('')}
          ${DAILY_EXTRA_HABITS.filter(h => h.id !== 'career_output')
            .map(h => dailyHabitCardHtml(h.id, dailyExtraLabel(h, settings), !!record[h.id])).join('')}
          ${DAILY_ROUTINE_HABITS.map(h => dailyHabitCardHtml(h.id, h.label, !!record[h.id])).join('')}
        </div>`;

    case 'nutrition':
      return `
        <p class="sheet-hint">${CLOSE_S.hints.nutrition}</p>
        <div class="habit-grid">
          ${dailyHabitCardHtml('protein_target_met', STRINGS.daily.proteinTarget(settings.protein_target_g), !!record.protein_target_met)}
          ${dailyHabitCardHtml('water_target_met', STRINGS.daily.waterTarget(settings.water_target_l), !!record.water_target_met)}
          ${(settings.supplements || []).map(s =>
            dailyHabitCardHtml(s.id, s.label, !!record.supplements[s.id], 'data-daily-supplement')).join('')}
        </div>`;

    case 'learning':
      return `
        <p class="sheet-hint">${CLOSE_S.hints.learning}</p>
        <div class="habit-grid">
          ${dailyHabitCardHtml('htb_completed', STRINGS.daily.habits.htb_completed, !!record.htb_completed)}
          ${dailyHabitCardHtml('spiritual_learning', STRINGS.daily.habits.spiritual_learning, !!record.spiritual_learning)}
        </div>
        ${record.htb_completed ? `
          <input type="text" class="text-input" data-daily-text="htb_topic"
                 maxlength="140" placeholder="${TODAY_S.htbPlaceholder}"
                 value="${escapeHtml(record.htb_topic || '')}">` : ''}
        ${record.spiritual_learning ? `
          <input type="text" class="text-input" data-daily-text="spiritual_learning_note"
                 maxlength="140" placeholder="${TODAY_S.spiritualPlaceholder}"
                 value="${escapeHtml(record.spiritual_learning_note || '')}">` : ''}`;

    case 'trading':
      return `
        <p class="sheet-hint">${CLOSE_S.hints.trading}</p>
        <div class="bignum-row">
          <button type="button" class="bignum-btn" data-daily-tv="-1" aria-label="${CLOSE_S.tradingViewFewer}">−</button>
          <input type="number" min="0" inputmode="numeric" class="bignum-input mono"
                 data-daily-number="tradingview_opens" aria-label="${TODAY_S.tradingViewLabel}"
                 value="${record.tradingview_opens === null ? '' : record.tradingview_opens}">
          <button type="button" class="bignum-btn" data-daily-tv="1" aria-label="${CLOSE_S.tradingViewMore}">+</button>
        </div>
        <p class="sheet-hint">${CLOSE_S.hints.screenTime}</p>
        <div class="time-row">
          <label class="time-field"><span>${CLOSE_S.screenTotal}</span>
            <input type="number" min="0" inputmode="numeric" class="mono" data-daily-screen="total_min"
                   value="${record.screen_time.total_min === null ? '' : record.screen_time.total_min}"></label>
          <label class="time-field"><span>${CLOSE_S.screenSocial}</span>
            <input type="number" min="0" inputmode="numeric" class="mono" data-daily-screen="social_min"
                   value="${record.screen_time.social_min === null ? '' : record.screen_time.social_min}"></label>
          <label class="time-field"><span>${CLOSE_S.screenYouTube}</span>
            <input type="number" min="0" inputmode="numeric" class="mono" data-daily-screen="youtube_min"
                   value="${record.screen_time.youtube_min === null ? '' : record.screen_time.youtube_min}"></label>
        </div>`;

    case 'career':
      return `
        <p class="sheet-hint">${CLOSE_S.hints.career}</p>
        ${dailyHabitCardHtml('career_output', STRINGS.daily.habits.career_output, !!record.career_output)}
        <p class="sheet-hint">${CLOSE_S.hints.careerExamples}</p>`;

    case 'reflection':
      return `
        <label class="followup-label" for="daily-win">${CLOSE_S.winLabel}</label>
        <input type="text" id="daily-win" class="text-input" data-daily-text="win_of_day"
               maxlength="200" placeholder="${CLOSE_S.winPlaceholder}"
               value="${escapeHtml(record.win_of_day || '')}">
        <label class="followup-label" for="daily-friction">${CLOSE_S.frictionLabel}</label>
        <input type="text" id="daily-friction" class="text-input" data-daily-text="friction"
               maxlength="200" placeholder="${CLOSE_S.frictionPlaceholder}"
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
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(CLOSE_S.dialogLabel(step.label))}">
      <div class="sheet-head">
        <span class="sheet-kicker">${CLOSE_S.title}</span>
        <button type="button" class="sheet-x" data-daily-step-cancel aria-label="${STRINGS.common.close}">&times;</button>
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
          ? `<button type="button" class="btn-ghost" data-daily-step-back>${STRINGS.common.back}</button>`
          : `<span></span>`}
        <span class="step-count mono">${CLOSE_S.progress(dailyClosingStep + 1, DAILY_CLOSE_STEPS.length)}</span>
        <button type="button" class="btn-primary" data-daily-step-next>
          ${isLast ? CLOSE_S.complete : CLOSE_S.next}
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
      const record = DAILY.getDay(dailyCurrentDate());
      patchLocal(dailyHabitPatch(record, id, !record[id], { stamp: false, date: dailyCurrentDate() }));
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
