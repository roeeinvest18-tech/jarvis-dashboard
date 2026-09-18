// Personal OS — the Today zone and the Close the Day flow.
//
// The zone sits at the TOP of index.html, above the trading zones: the
// morning routine is the first thing the day needs, and the scan is a
// read-whenever surface. It renders from DAILY (see daily.js) and writes
// through it; there is no state here beyond which step of the closing flow is
// open, matching how tasks.js and training.js keep transient view state in
// module-level lets and re-render wholesale.
//
// Every control writes on the tap that operates it. Nothing is staged behind a
// Save button, because the target is a 1-2 minute check-in and a half-filled
// form that is lost on navigation is exactly the friction this is meant to
// remove.

// Which day the zone is showing. Normally today; History opens a past day for
// editing by setting this and re-rendering.
let dailyActiveDate = null;
// Step index of the Close the Day flow, or null when it is closed.
let dailyClosingStep = null;

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

function dailyFormatDateLabel(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

// Whether today is a scheduled training day, read from the EXISTING training
// system's schedule rather than redefining it here. Falls back to the
// Sun/Tue/Thu constant training.js already declares if the payload is absent.
function dailyIsTrainingDay(iso) {
  const day = dailyWeekdayIndex(iso);
  if (typeof TRAINING_SCHEDULE_DAYS !== 'undefined') return TRAINING_SCHEDULE_DAYS.includes(day);
  return [0, 2, 4].includes(day);
}

// --- sync -----------------------------------------------------------------

let dailySyncInFlight = false;

// Same guard as training.js's triggerTrainingSync: prevents overlapping
// requests without being a once-ever gate, since each call site (load, a tap,
// completing the day) legitimately wants its own attempt. The re-render after
// a successful sync never itself triggers a sync, so this cannot loop.
function dailyTriggerSync() {
  if (dailySyncInFlight) return;
  const { url, token } = DAILY.syncConfig();
  if (!url || !token) return;
  dailySyncInFlight = true;
  DAILY.syncWithServer().then(state => {
    dailySyncInFlight = false;
    if (state) renderDailyZone();
  });
}

// Writes a patch to the active day, re-renders, and reconciles in the
// background. Every control in this file goes through here.
function dailyPatch(patch) {
  DAILY.saveDay(dailyCurrentDate(), patch);
  renderDailyZone();
  dailyTriggerSync();
}

// --- small building blocks ------------------------------------------------

function dailyToggleHtml(id, label, checked, extraClass = '') {
  return `
    <button type="button" class="daily-toggle ${checked ? 'is-done' : ''} ${extraClass}"
            data-daily-toggle="${escapeHtml(id)}" aria-pressed="${checked ? 'true' : 'false'}">
      <span class="daily-toggle-box" aria-hidden="true">${checked ? ICONS.check(12) : ''}</span>
      <span class="daily-toggle-label">${escapeHtml(label)}</span>
    </button>`;
}

function dailyScaleHtml(id, label, value) {
  return `
    <div class="daily-scale">
      <div class="daily-scale-head">
        <span>${escapeHtml(label)}</span>
        <span class="daily-scale-value mono">${value === null ? '—' : value + '/10'}</span>
      </div>
      <div class="daily-scale-row" role="group" aria-label="${escapeHtml(label)} 1 to 10">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `
          <button type="button" class="daily-scale-dot ${value === n ? 'is-selected' : ''}"
                  data-daily-scale="${escapeHtml(id)}" data-value="${n}"
                  aria-label="${escapeHtml(label)} ${n} of 10"
                  aria-pressed="${value === n ? 'true' : 'false'}">${n}</button>`).join('')}
      </div>
    </div>`;
}

function dailySleepSummaryHtml(record) {
  const mins = dailySleepDurationMinutes(record.sleep_start, record.wake_time);
  if (mins === null) {
    return `<button type="button" class="daily-sleep-empty" data-daily-open-step="sleep">
      Add last night's sleep</button>`;
  }
  const warn = dailySleepLooksImplausible(mins)
    ? `<span class="daily-warn" title="That looks unusual — tap to check the times">check times</span>`
    : '';
  return `
    <button type="button" class="daily-sleep-card" data-daily-open-step="sleep">
      <span class="daily-sleep-times mono">${escapeHtml(record.sleep_start)} → ${escapeHtml(record.wake_time)}</span>
      <span class="daily-sleep-duration mono">${dailyFormatDuration(mins)}</span>
      ${record.sleep_quality !== null
        ? `<span class="daily-sleep-quality mono">Quality ${record.sleep_quality}/10</span>` : ''}
      ${warn}
    </button>`;
}

function dailyPrioritiesHtml(record) {
  const rows = [0, 1, 2].map(i => `
    <div class="daily-priority-row">
      <span class="daily-priority-num mono">${i + 1}</span>
      <input type="text" class="daily-priority-input" data-daily-priority="${i}"
             maxlength="80" placeholder="—"
             aria-label="Priority ${i + 1}"
             value="${escapeHtml(record.priorities[i] || '')}">
    </div>`).join('');
  return `<div class="daily-priorities">${rows}</div>`;
}

// --- the Today zone -------------------------------------------------------

function renderDailyZone() {
  const section = document.getElementById('zone-daily');
  const mount = document.getElementById('daily-body');
  if (!section || !mount) return;
  section.hidden = false;

  const date = dailyCurrentDate();
  const record = DAILY.getDay(date);
  const tier = dailyDayTier(record);
  const isToday = date === dailyTodayIso();
  const trainingDay = dailyIsTrainingDay(date);
  const settings = DAILY.settings();

  const coreHabits = record.minimum_day
    ? DAILY_CORE_HABITS
    : DAILY_CORE_HABITS;   // the core five are the same list; Minimum Day hides the extras below

  mount.innerHTML = `
    <div class="daily-head">
      <div>
        <div class="daily-greeting">${isToday ? escapeHtml(dailyGreeting()) : 'Reviewing'}</div>
        <div class="daily-date mono">${escapeHtml(dailyFormatDateLabel(date))}</div>
      </div>
      <span class="daily-tier daily-tier-${escapeHtml(tier.id)}">${escapeHtml(tier.label)}</span>
    </div>

    ${!isToday ? `<div class="daily-editing-note">
      Editing a past day. <button type="button" class="daily-linkbtn" data-daily-back-today>Back to today</button>
    </div>` : ''}

    ${dailySleepSummaryHtml(record)}

    <div class="daily-section-label">Morning core</div>
    <div class="daily-toggle-grid">
      ${coreHabits.map(h => dailyToggleHtml(h.id, h.label, !!record[h.id], 'is-core')).join('')}
    </div>

    ${record.spiritual_learning ? `
      <div class="daily-followup">
        <label class="daily-followup-label" for="daily-spiritual-note">What did you learn?</label>
        <input type="text" id="daily-spiritual-note" class="daily-text-input"
               data-daily-text="spiritual_learning_note" maxlength="140"
               placeholder="Mesillat Yesharim — Chapter 4"
               value="${escapeHtml(record.spiritual_learning_note || '')}">
      </div>` : ''}

    ${record.htb_completed ? `
      <div class="daily-followup">
        <label class="daily-followup-label" for="daily-htb-topic">What did you study?</label>
        <input type="text" id="daily-htb-topic" class="daily-text-input"
               data-daily-text="htb_topic" maxlength="140" placeholder="Kerberos"
               value="${escapeHtml(record.htb_topic || '')}">
      </div>` : ''}

    ${record.minimum_day ? '' : `
      <div class="daily-section-label">
        Also today
        ${trainingDay ? `<span class="daily-training-flag">training day</span>` : ''}
      </div>
      <div class="daily-toggle-grid">
        ${DAILY_EXTRA_HABITS.map(h => {
          const label = h.id === 'protein_target_met' ? `Protein ${settings.protein_target_g}g`
            : h.id === 'water_target_met' ? `Water ${settings.water_target_l}L`
            : h.label;
          return dailyToggleHtml(h.id, label, !!record[h.id]);
        }).join('')}
        ${(settings.supplements || []).map(s => `
          <button type="button" class="daily-toggle ${record.supplements[s.id] ? 'is-done' : ''}"
                  data-daily-supplement="${escapeHtml(s.id)}"
                  aria-pressed="${record.supplements[s.id] ? 'true' : 'false'}">
            <span class="daily-toggle-box" aria-hidden="true">${record.supplements[s.id] ? ICONS.check(12) : ''}</span>
            <span class="daily-toggle-label">${escapeHtml(s.label)}</span>
          </button>`).join('')}
      </div>`}

    <div class="daily-section-label">Today's priorities</div>
    ${dailyPrioritiesHtml(record)}

    <div class="daily-tv-row">
      <span class="daily-tv-label">TradingView opens</span>
      <div class="daily-tv-controls">
        <button type="button" class="daily-tv-btn" data-daily-tv="-1" aria-label="One fewer TradingView open">−</button>
        <span class="daily-tv-count mono">${record.tradingview_opens === null ? '—' : record.tradingview_opens}</span>
        <button type="button" class="daily-tv-btn" data-daily-tv="1" aria-label="One more TradingView open">+</button>
      </div>
    </div>

    <div class="daily-actions">
      <button type="button" class="daily-close-btn" data-daily-close-day>
        ${record.closed ? 'Reopen the day' : 'Close the day'}
      </button>
      <button type="button" class="daily-minimum-btn ${record.minimum_day ? 'is-on' : ''}"
              data-daily-minimum aria-pressed="${record.minimum_day ? 'true' : 'false'}">
        ${record.minimum_day ? 'Minimum day: on' : 'Minimum day'}
      </button>
    </div>
    ${record.minimum_day ? `<p class="daily-minimum-note">Showing the core five only. Everything else is still tracked, just out of the way.</p>` : ''}
  `;

  wireDailyZone();
  if (dailyClosingStep !== null) renderDailyCloseFlow();
}

function wireDailyZone() {
  const mount = document.getElementById('daily-body');
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

  // Text fields commit on blur rather than per keystroke: a re-render on every
  // character would fight the caret, and a patch per character is pointless
  // churn against the sync endpoint.
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

  mount.querySelectorAll('[data-daily-priority]').forEach(input => {
    const commit = () => {
      const idx = Number(input.dataset.dailyPriority);
      const priorities = [...DAILY.getDay(dailyCurrentDate()).priorities];
      while (priorities.length < 3) priorities.push('');
      if (priorities[idx] === input.value) return;
      priorities[idx] = input.value;
      // Trailing blanks are trimmed so "no third priority" stores as absent
      // rather than as an empty string the History view would render as a row.
      while (priorities.length && !priorities[priorities.length - 1].trim()) priorities.pop();
      DAILY.saveDay(dailyCurrentDate(), { priorities });
      dailyTriggerSync();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') input.blur(); });
  });

  mount.querySelectorAll('[data-daily-tv]').forEach(btn => {
    btn.addEventListener('click', () => {
      const delta = Number(btn.dataset.dailyTv);
      const current = DAILY.getDay(dailyCurrentDate()).tradingview_opens;
      // First tap on + starts the count at 1; a count can never go below 0.
      const next = Math.max(0, (current === null ? 0 : current) + delta);
      dailyPatch({ tradingview_opens: next });
    });
  });

  const minimumBtn = mount.querySelector('[data-daily-minimum]');
  if (minimumBtn) {
    minimumBtn.addEventListener('click', () => {
      dailyPatch({ minimum_day: !DAILY.getDay(dailyCurrentDate()).minimum_day });
    });
  }

  const closeBtn = mount.querySelector('[data-daily-close-day]');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const record = DAILY.getDay(dailyCurrentDate());
      if (record.closed) {
        dailyPatch({ closed: false });
        return;
      }
      dailyClosingStep = 0;
      renderDailyCloseFlow();
    });
  }

  mount.querySelectorAll('[data-daily-open-step]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = DAILY_CLOSE_STEPS.findIndex(s => s.id === btn.dataset.dailyOpenStep);
      dailyClosingStep = idx < 0 ? 0 : idx;
      renderDailyCloseFlow();
    });
  });

  const back = mount.querySelector('[data-daily-back-today]');
  if (back) {
    back.addEventListener('click', () => {
      dailyActiveDate = null;
      renderDailyZone();
    });
  }
}

// Records an HTB topic into the learning-memory layer. Called whenever the
// topic field is committed, so the Memory tab is populated by the ordinary
// daily check-in rather than by a second, separate piece of data entry.
function dailyCaptureTopic(name) {
  const clean = (name || '').trim();
  if (!clean) return;
  DAILY.upsertTopic(clean, { date: dailyCurrentDate(), source: 'HTB' });
}

// --- Close the Day flow ---------------------------------------------------
// One concern per screen, advanced by a single button. Every step is
// skippable: a partial day is a valid record, and refusing to store one
// because a field is blank would lose the data that WAS reported.

function dailyCloseStepBodyHtml(step, record, settings) {
  switch (step.id) {
    case 'mind':
      return `
        <p class="daily-step-hint">How the day actually felt.</p>
        ${DAILY_MIND_METRICS.map(m => dailyScaleHtml(m.id, m.label, record[m.id])).join('')}
        ${dailyToggleHtml('meditation', 'Meditation', !!record.meditation)}`;

    case 'sleep': {
      const mins = dailySleepDurationMinutes(record.sleep_start, record.wake_time);
      return `
        <p class="daily-step-hint">Last night. Duration is worked out for you.</p>
        <div class="daily-time-row">
          <label class="daily-time-field">
            <span>Asleep</span>
            <input type="time" data-daily-time="sleep_start" value="${escapeHtml(record.sleep_start || '')}">
          </label>
          <label class="daily-time-field">
            <span>Awake</span>
            <input type="time" data-daily-time="wake_time" value="${escapeHtml(record.wake_time || '')}">
          </label>
        </div>
        <div class="daily-computed mono" id="daily-sleep-computed">
          ${mins === null ? 'Duration —' : `Duration ${dailyFormatDuration(mins)}`}
          ${dailySleepLooksImplausible(mins) ? ' · that looks unusual, worth a second look' : ''}
        </div>
        ${dailyScaleHtml('sleep_quality', 'Sleep quality', record.sleep_quality)}`;
    }

    case 'routine':
      return `
        <p class="daily-step-hint">Anything you finished but haven't ticked.</p>
        <div class="daily-toggle-grid">
          ${DAILY_CORE_HABITS.map(h => dailyToggleHtml(h.id, h.label, !!record[h.id], 'is-core')).join('')}
          ${DAILY_EXTRA_HABITS.filter(h => h.id !== 'career_output')
            .map(h => dailyToggleHtml(h.id, h.label, !!record[h.id])).join('')}
        </div>`;

    case 'nutrition':
      return `
        <p class="daily-step-hint">Targets only — no food diary.</p>
        <div class="daily-toggle-grid">
          ${dailyToggleHtml('protein_target_met', `Protein ${settings.protein_target_g}g`, !!record.protein_target_met)}
          ${dailyToggleHtml('water_target_met', `Water ${settings.water_target_l}L`, !!record.water_target_met)}
          ${(settings.supplements || []).map(s => `
            <button type="button" class="daily-toggle ${record.supplements[s.id] ? 'is-done' : ''}"
                    data-daily-supplement="${escapeHtml(s.id)}"
                    aria-pressed="${record.supplements[s.id] ? 'true' : 'false'}">
              <span class="daily-toggle-box" aria-hidden="true">${record.supplements[s.id] ? ICONS.check(12) : ''}</span>
              <span class="daily-toggle-label">${escapeHtml(s.label)}</span>
            </button>`).join('')}
        </div>`;

    case 'learning':
      return `
        <p class="daily-step-hint">No duration needed — just what you covered.</p>
        ${dailyToggleHtml('htb_completed', 'HTB completed', !!record.htb_completed, 'is-core')}
        ${record.htb_completed ? `
          <input type="text" class="daily-text-input" data-daily-text="htb_topic"
                 maxlength="140" placeholder="Kerberos"
                 value="${escapeHtml(record.htb_topic || '')}">` : ''}
        ${dailyToggleHtml('spiritual_learning', 'Spiritual learning', !!record.spiritual_learning, 'is-core')}
        ${record.spiritual_learning ? `
          <input type="text" class="daily-text-input" data-daily-text="spiritual_learning_note"
                 maxlength="140" placeholder="Mesillat Yesharim — Chapter 4"
                 value="${escapeHtml(record.spiritual_learning_note || '')}">` : ''}`;

    case 'trading':
      return `
        <p class="daily-step-hint">How many times you opened TradingView today.</p>
        <div class="daily-bignum-row">
          <button type="button" class="daily-bignum-btn" data-daily-tv="-1" aria-label="One fewer">−</button>
          <input type="number" min="0" inputmode="numeric" class="daily-bignum-input"
                 data-daily-number="tradingview_opens" aria-label="TradingView opens"
                 value="${record.tradingview_opens === null ? '' : record.tradingview_opens}">
          <button type="button" class="daily-bignum-btn" data-daily-tv="1" aria-label="One more">+</button>
        </div>
        <p class="daily-step-hint">Screen time, if you have it to hand (Settings → Screen Time).</p>
        <div class="daily-time-row">
          <label class="daily-time-field">
            <span>Total (min)</span>
            <input type="number" min="0" inputmode="numeric" data-daily-screen="total_min"
                   value="${record.screen_time.total_min === null ? '' : record.screen_time.total_min}">
          </label>
          <label class="daily-time-field">
            <span>Social (min)</span>
            <input type="number" min="0" inputmode="numeric" data-daily-screen="social_min"
                   value="${record.screen_time.social_min === null ? '' : record.screen_time.social_min}">
          </label>
          <label class="daily-time-field">
            <span>YouTube (min)</span>
            <input type="number" min="0" inputmode="numeric" data-daily-screen="youtube_min"
                   value="${record.screen_time.youtube_min === null ? '' : record.screen_time.youtube_min}">
          </label>
        </div>`;

    case 'career':
      return `
        <p class="daily-step-hint">Only when it was on the plan — skipping is not a miss.</p>
        ${dailyToggleHtml('career_output', 'Career output today', !!record.career_output)}
        <p class="daily-step-hint">Applied, messaged a recruiter, prepped, improved the CV or a project.</p>`;

    case 'reflection':
      return `
        <label class="daily-followup-label" for="daily-win">Win of the day</label>
        <input type="text" id="daily-win" class="daily-text-input" data-daily-text="win_of_day"
               maxlength="200" placeholder="One thing that went well"
               value="${escapeHtml(record.win_of_day || '')}">
        <label class="daily-followup-label" for="daily-friction">Friction</label>
        <input type="text" id="daily-friction" class="daily-text-input" data-daily-text="friction"
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
    overlay.className = 'daily-overlay';
    document.body.appendChild(overlay);
  }

  const step = DAILY_CLOSE_STEPS[dailyClosingStep];
  const record = DAILY.getDay(dailyCurrentDate());
  const settings = DAILY.settings();
  const isLast = dailyClosingStep === DAILY_CLOSE_STEPS.length - 1;

  overlay.innerHTML = `
    <div class="daily-sheet" role="dialog" aria-modal="true" aria-label="Close the day — ${escapeHtml(step.label)}">
      <div class="daily-sheet-head">
        <span class="daily-sheet-title">Close the day</span>
        <button type="button" class="daily-sheet-x" data-daily-step-cancel aria-label="Close">&times;</button>
      </div>
      <div class="daily-steps-rail" aria-hidden="true">
        ${DAILY_CLOSE_STEPS.map((s, i) => `
          <span class="daily-step-pip ${i === dailyClosingStep ? 'is-current' : ''} ${i < dailyClosingStep ? 'is-past' : ''}"></span>`).join('')}
      </div>
      <div class="daily-sheet-body">
        <h3 class="daily-step-title">${escapeHtml(step.label)}</h3>
        ${dailyCloseStepBodyHtml(step, record, settings)}
      </div>
      <div class="daily-sheet-foot">
        ${dailyClosingStep > 0
          ? `<button type="button" class="daily-step-back" data-daily-step-back>Back</button>`
          : `<span></span>`}
        <span class="daily-step-count mono">${dailyClosingStep + 1} / ${DAILY_CLOSE_STEPS.length}</span>
        <button type="button" class="daily-step-next" data-daily-step-next>
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
    renderDailyZone();
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
      // Tapping the selected dot clears it, so a mis-tap is correctable and an
      // unanswered metric can be returned to "not answered" rather than being
      // stuck at whatever was hit first.
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
      // Everything entered so far is already stored, so cancelling only closes
      // the sheet — it never discards what was answered.
      dailyClosingStep = null;
      renderDailyCloseFlow();
      renderDailyZone();
    });
  }

  const next = overlay.querySelector('[data-daily-step-next]');
  if (next) {
    next.addEventListener('click', () => {
      // Commit any focused field before moving on, otherwise a value typed and
      // not blurred would be lost on the step change.
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
      renderDailyZone();
      dailyTriggerSync();
    });
  }
}
