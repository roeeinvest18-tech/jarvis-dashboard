// Personal OS page — Insights, Memory and History.
//
// Everything rendered here is computed from stored daily records by daily.js.
// Nothing on this page invents a number, and nothing writes an interpretation
// back into a record: interpretations are produced on read, so redefining one
// later reinterprets all history rather than stranding records stamped under
// an older rule.
//
// The three areas the brief asked for as separate destinations live here as
// sub-tabs rather than as three more entries in the bottom bar: six tab-bar
// items do not survive a thumb on a phone, and the existing nav is a two-item
// bar. Today stays where it is, and this adds one sibling next to it.

renderNav('os', { search: false });
renderTopbar('app-header', 'Personal OS');

let osActiveTab = 'insights';
// Which History day is expanded, and which topic's recall composer is open.
let osOpenDay = null;
let osOpenRecallTopicId = null;
let osOpenEvaluationRecallId = null;

function osPct(value) {
  return value === null || value === undefined ? '—' : `${value}%`;
}

function osNum(value) {
  return value === null || value === undefined ? '—' : String(value);
}

function osDateLabel(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined,
    { weekday: 'short', day: 'numeric', month: 'short' });
}

// A zone with nothing in it yet says so plainly and says what would fill it.
// Same reasoning as components.js's renderEmptyZone: a blank panel is
// indistinguishable from a broken one.
function osEmpty(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

// --- Insights -------------------------------------------------------------

function osConsistencyTableHtml(records, windowLabel) {
  if (!records.length) return osEmpty(`No days checked in over the last ${windowLabel}.`);
  const rows = dailyConsistencyTable(records).map(r => `
    <tr>
      <td>${escapeHtml(r.label)}</td>
      <td class="mono">${r.done}/${r.reported}</td>
      <td class="mono">${osPct(r.pct)}</td>
      <td><span class="os-bar"><span class="os-bar-fill" style="width:${r.pct || 0}%"></span></span></td>
    </tr>`).join('');
  return `
    <div class="table-scroll">
      <table class="os-table">
        <thead><tr><th>Habit</th><th>Done</th><th>Rate</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function osSleepPanelHtml(records) {
  const s = dailySleepStats(records);
  if (!s) return osEmpty('No sleep entries yet. Add one from Close the Day.');
  return `
    <div class="os-stat-grid">
      <div class="os-stat"><span class="os-stat-value mono">${dailyFormatDuration(s.avgDurationMin)}</span><span class="os-stat-label">Avg duration</span></div>
      <div class="os-stat"><span class="os-stat-value mono">${osNum(s.avgQuality)}</span><span class="os-stat-label">Avg quality</span></div>
      <div class="os-stat"><span class="os-stat-value mono">${escapeHtml(s.avgBedtime)}</span><span class="os-stat-label">Avg bedtime</span></div>
      <div class="os-stat"><span class="os-stat-value mono">${escapeHtml(s.avgWakeTime)}</span><span class="os-stat-label">Avg wake</span></div>
      <div class="os-stat"><span class="os-stat-value mono">±${osNum(s.bedtimeSpreadMin)}m</span><span class="os-stat-label">Bedtime spread</span></div>
      <div class="os-stat"><span class="os-stat-value mono">±${osNum(s.wakeSpreadMin)}m</span><span class="os-stat-label">Wake spread</span></div>
    </div>
    <p class="os-note">Based on ${s.n} night${s.n === 1 ? '' : 's'} with sleep recorded.</p>`;
}

function osMindPanelHtml(records) {
  const cells = DAILY_MIND_METRICS.map(m => {
    const mean = dailyRound(dailyMean(records.map(r => r[m.id])));
    const n = records.filter(r => typeof r[m.id] === 'number').length;
    return `<div class="os-stat">
      <span class="os-stat-value mono">${osNum(mean)}</span>
      <span class="os-stat-label">${escapeHtml(m.label)}${n ? ` · ${n}d` : ''}</span>
    </div>`;
  }).join('');
  return `<div class="os-stat-grid">${cells}</div>`;
}

function osTradingViewPanelHtml(records) {
  const tv = dailyTradingViewStats(records);
  if (!tv) return osEmpty('No TradingView opens recorded yet.');
  return `
    <div class="os-stat-grid">
      <div class="os-stat"><span class="os-stat-value mono">${osNum(tv.avg)}</span><span class="os-stat-label">Avg / day</span></div>
      <div class="os-stat"><span class="os-stat-value mono">${tv.max}</span><span class="os-stat-label">Highest · ${escapeHtml(osDateLabel(tv.maxDate))}</span></div>
      <div class="os-stat"><span class="os-stat-value mono">${tv.min}</span><span class="os-stat-label">Lowest · ${escapeHtml(osDateLabel(tv.minDate))}</span></div>
      <div class="os-stat"><span class="os-stat-value mono">${tv.total}</span><span class="os-stat-label">Total · ${tv.n}d</span></div>
    </div>`;
}

// Observations are rendered with their evidence attached and an explicit
// "observed association" label. The brief was specific that a correlation must
// never be presented as a cause, so the wording is fixed here rather than left
// to whatever generated the sentence.
function osObservationsHtml(records) {
  const observations = dailyBehaviouralObservations(records);
  if (!observations.length) {
    return osEmpty('Not enough data yet. Comparisons appear once both sides of a '
      + `split have at least ${DAILY_MIN_GROUP_N} days behind them.`);
  }
  return observations.map(o => `
    <div class="os-observation">
      <span class="os-observation-tag">observed association</span>
      <p class="os-observation-text">${escapeHtml(o.text)}</p>
      <p class="os-observation-evidence mono">
        ${escapeHtml(o.evidence.metric)}: group A n=${o.evidence.a.n} mean=${osNum(o.evidence.a.mean)} ·
        group B n=${o.evidence.b.n} mean=${osNum(o.evidence.b.mean)}
      </p>
    </div>`).join('')
    + `<p class="os-note">These are differences between groups of days, not evidence that one
        caused the other.</p>`;
}

function osWeeklyReviewHtml() {
  const wr = dailyWeeklyReview();
  if (!wr.reportedDays) return osEmpty('No days checked in this week yet.');

  const movement = (list, kind) => list.length
    ? `<ul class="os-list">${list.map(e => `
        <li><span>${escapeHtml(e.label)}</span>
        <span class="mono os-delta-${kind}">${e.before}% → ${e.now}%</span></li>`).join('')}</ul>`
    : `<p class="os-note">Nothing ${kind === 'up' ? 'improved' : 'declined'} measurably against last week.</p>`;

  const mindRows = DAILY_MIND_METRICS.map(m => {
    const v = wr.mind[m.id];
    return `<li><span>${escapeHtml(v.label)}</span><span class="mono">${osNum(v.before)} → ${osNum(v.now)}</span></li>`;
  }).join('');

  const frictions = wr.frictions.length
    ? `<ul class="os-list">${wr.frictions.map(f => `
        <li><span>${escapeHtml(f.text)}</span><span class="mono os-muted">${escapeHtml(osDateLabel(f.date))}</span></li>`).join('')}</ul>`
    : `<p class="os-note">No friction recorded this week.</p>`;

  const wins = wr.wins.length
    ? `<ul class="os-list">${wr.wins.map(w => `
        <li><span>${escapeHtml(w.text)}</span><span class="mono os-muted">${escapeHtml(osDateLabel(w.date))}</span></li>`).join('')}</ul>`
    : `<p class="os-note">No wins recorded this week.</p>`;

  return `
    <p class="os-note">${wr.reportedDays} day${wr.reportedDays === 1 ? '' : 's'} checked in this week,
      ${wr.previousReportedDays} the week before. Percentages compare only days actually reported.</p>
    <h4 class="os-subhead">What improved</h4>${movement(wr.improved, 'up')}
    <h4 class="os-subhead">What declined</h4>${movement(wr.declined, 'down')}
    <h4 class="os-subhead">Mind, week over week</h4><ul class="os-list">${mindRows}</ul>
    <h4 class="os-subhead">Wins</h4>${wins}
    <h4 class="os-subhead">Friction</h4>${frictions}`;
}

function renderOsInsights() {
  const mount = document.getElementById('panel-insights');
  if (!mount) return;
  const all = DAILY.orderedDays();

  if (!all.length) {
    mount.innerHTML = osEmpty('No days recorded yet. Check in from Today and this fills in on its own.');
    return;
  }

  const w7 = DAILY.windowDays(7);
  const w30 = DAILY.windowDays(30);
  const w90 = DAILY.windowDays(90);

  mount.innerHTML = `
    <div class="os-block">
      <h3 class="os-head">Consistency</h3>
      <div class="os-window-tabs" role="tablist">
        <button type="button" class="os-window-btn is-active" data-os-window="7">7 days</button>
        <button type="button" class="os-window-btn" data-os-window="30">30 days</button>
        <button type="button" class="os-window-btn" data-os-window="90">90 days</button>
      </div>
      <div id="os-consistency-mount">${osConsistencyTableHtml(w7, '7 days')}</div>
    </div>

    <div class="os-block">
      <h3 class="os-head">Sleep · last 30 days</h3>
      ${osSleepPanelHtml(w30)}
    </div>

    <div class="os-block">
      <h3 class="os-head">Mind · last 30 days</h3>
      ${osMindPanelHtml(w30)}
    </div>

    <div class="os-block">
      <h3 class="os-head">TradingView · last 30 days</h3>
      ${osTradingViewPanelHtml(w30)}
    </div>

    <div class="os-block">
      <h3 class="os-head">Observations · last 90 days</h3>
      ${osObservationsHtml(w90)}
    </div>

    <div class="os-block">
      <h3 class="os-head">This week</h3>
      ${osWeeklyReviewHtml()}
    </div>

    ${osSettingsHtml()}`;

  wireOsSettings();

  mount.querySelectorAll('[data-os-window]').forEach(btn => {
    btn.addEventListener('click', () => {
      const days = Number(btn.dataset.osWindow);
      mount.querySelectorAll('[data-os-window]').forEach(b => b.classList.toggle('is-active', b === btn));
      document.getElementById('os-consistency-mount').innerHTML =
        osConsistencyTableHtml(DAILY.windowDays(days), `${days} days`);
    });
  });
}

// --- Settings -------------------------------------------------------------
// Targets and cross-device sync, collapsed by default. Lives here rather than
// in a global settings screen for the same reason training.js keeps its own:
// this is the only area that needs it, and a whole settings page for two
// numbers and a token would be more structure than the app has anywhere else.

function osSettingsHtml() {
  const s = DAILY.settings();
  const { url, token } = DAILY.syncConfig();
  let host = url;
  try { if (url) host = new URL(url).host; } catch (e) { /* keep the raw string */ }

  const syncBody = (url && token)
    ? `<p class="os-note">Syncing across devices via ${escapeHtml(host)}.
        <button type="button" class="os-btn os-btn-quiet" id="os-sync-forget">Turn off sync</button></p>`
    : `<p class="os-note">Optional. Without it everything still works on this device —
        sync only adds the ability to check in on the phone and read it on the desktop.</p>
       <form id="os-sync-form" class="os-settings-form" autocomplete="off">
         <input type="url" id="os-sync-url" placeholder="https://your-app.up.railway.app" required>
         <input type="password" id="os-sync-token" placeholder="Sync token" required autocomplete="off">
         <button type="submit" class="os-btn os-btn-primary">Save</button>
       </form>`;

  return `
    <div class="os-block">
      <details class="os-settings">
        <summary class="os-note">Settings — targets and cross-device sync</summary>
        <div class="os-settings-body">
          <form id="os-targets-form" class="os-settings-form">
            <label>Protein target (g)
              <input type="number" min="0" id="os-protein" value="${escapeHtml(String(s.protein_target_g))}">
            </label>
            <label>Water target (L)
              <input type="number" min="0" step="0.1" id="os-water" value="${escapeHtml(String(s.water_target_l))}">
            </label>
            <button type="submit" class="os-btn os-btn-primary">Save targets</button>
          </form>
          <p class="os-note">Changing a target relabels the toggle from now on. Days already
            recorded keep the target that was in force when you reported them.</p>
          <h4 class="os-subhead">Cross-device sync</h4>
          ${syncBody}
        </div>
      </details>
    </div>`;
}

function wireOsSettings() {
  const targets = document.getElementById('os-targets-form');
  if (targets) {
    targets.addEventListener('submit', ev => {
      ev.preventDefault();
      const protein = Number(document.getElementById('os-protein').value);
      const water = Number(document.getElementById('os-water').value);
      const patch = {};
      if (Number.isFinite(protein) && protein > 0) patch.protein_target_g = protein;
      if (Number.isFinite(water) && water > 0) patch.water_target_l = water;
      if (Object.keys(patch).length) {
        DAILY.saveSettings(patch);
        osTriggerSync();
      }
      renderOsInsights();
    });
  }

  const syncForm = document.getElementById('os-sync-form');
  if (syncForm) {
    syncForm.addEventListener('submit', ev => {
      ev.preventDefault();
      const url = document.getElementById('os-sync-url').value.trim();
      const tokenValue = document.getElementById('os-sync-token').value.trim();
      if (!url || !tokenValue) return;
      DAILY.saveSyncConfig(url, tokenValue);
      renderOsInsights();
      osTriggerSync();
    });
  }

  const forget = document.getElementById('os-sync-forget');
  if (forget) {
    forget.addEventListener('click', () => {
      DAILY.clearSyncConfig();
      renderOsInsights();
    });
  }
}

// --- Memory ---------------------------------------------------------------

function osRecallPromptHtml(entry) {
  const t = entry.topic;
  const since = t.first_learned_date
    ? dailyDaysBetween(t.first_learned_date, dailyTodayIso()) : null;
  return `
    <div class="os-recall-card ${entry.due ? 'is-due' : ''}">
      <div class="os-recall-head">
        <span class="os-recall-topic">${escapeHtml(t.topic)}</span>
        ${entry.due
          ? `<span class="os-recall-due">due</span>`
          : `<span class="os-recall-next mono">next ${escapeHtml(entry.dueDate)}</span>`}
      </div>
      <p class="os-recall-meta mono">
        learned ${escapeHtml(t.first_learned_date)}${since !== null ? ` · ${since}d ago` : ''}
        · studied ${t.study_count}×
        · ${entry.attempts.length} recall${entry.attempts.length === 1 ? '' : 's'}
      </p>
      ${entry.due ? `<p class="os-recall-prompt">You studied
        <b>${escapeHtml(t.topic)}</b> ${since !== null ? `${since} days ago` : 'recently'}.
        Explain how it works, without looking at your notes.</p>` : ''}
      <div class="os-recall-actions">
        <button type="button" class="os-btn" data-os-recall="${escapeHtml(t.id)}">
          ${osOpenRecallTopicId === t.id ? 'Cancel' : 'Write a recall'}
        </button>
        <button type="button" class="os-btn os-btn-quiet" data-os-delete-topic="${escapeHtml(t.id)}">Remove</button>
      </div>
      ${osOpenRecallTopicId === t.id ? `
        <form class="os-recall-form" data-os-recall-form="${escapeHtml(t.id)}">
          <textarea class="os-textarea" rows="5" placeholder="Explain it in your own words…"
                    aria-label="Your explanation of ${escapeHtml(t.topic)}"></textarea>
          <button type="submit" class="os-btn os-btn-primary">Save recall</button>
        </form>` : ''}
      ${osAttemptsHtml(entry.attempts)}
    </div>`;
}

// Past attempts, each with its evaluation or an explicit invitation to add
// one. V1 ships no built-in evaluator: the response is stored raw, and a score
// arrives only when an external evaluator (ChatGPT today, an API later)
// actually produces one. Nothing here estimates a score.
function osAttemptsHtml(attempts) {
  if (!attempts.length) return '';
  const rows = [...attempts].reverse().map(a => {
    const evaluated = a.evaluation && typeof a.evaluation.score === 'number';
    return `
      <div class="os-attempt">
        <div class="os-attempt-head">
          <span class="mono os-muted">${escapeHtml((a.prompted_at || '').slice(0, 10))}</span>
          ${evaluated
            ? `<span class="os-score mono">${a.evaluation.score}/10</span>`
            : `<span class="os-score-none mono">not evaluated</span>`}
        </div>
        <p class="os-attempt-body">${escapeHtml(a.response_text || '')}</p>
        ${evaluated && Array.isArray(a.evaluation.weak_points) && a.evaluation.weak_points.length
          ? `<p class="os-attempt-weak">Weak points: ${escapeHtml(a.evaluation.weak_points.join(', '))}</p>` : ''}
        ${osOpenEvaluationRecallId === a.id ? `
          <form class="os-eval-form" data-os-eval-form="${escapeHtml(a.id)}">
            <p class="os-note">Paste your explanation into an evaluator you trust, then record what it
              said. Your answer above is never altered.</p>
            <div class="os-eval-row">
              <label>Score <input type="number" min="0" max="10" step="0.1" class="os-eval-score" required></label>
              <label>Weak points <input type="text" class="os-eval-weak" placeholder="TGT/TGS relationship"></label>
            </div>
            <button type="submit" class="os-btn os-btn-primary">Save evaluation</button>
          </form>`
          : `<button type="button" class="os-btn os-btn-quiet" data-os-eval="${escapeHtml(a.id)}">
              ${evaluated ? 'Update evaluation' : 'Add evaluation'}</button>`}
      </div>`;
  }).join('');
  return `<details class="os-attempts"><summary>Recall history (${attempts.length})</summary>${rows}</details>`;
}

function osRetentionHtml() {
  const rows = dailyRetentionTable();
  if (!rows.length) return '';
  const body = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.topic.topic)}</td>
      <td class="mono">${escapeHtml(r.topic.first_learned_date || '—')}</td>
      <td class="mono">${r.attemptCount}</td>
      <td class="mono">${r.latestScore === null ? '—' : r.latestScore}</td>
      <td>${r.weakPoints.length ? escapeHtml(r.weakPoints.join(', ')) : '—'}</td>
    </tr>`).join('');
  return `
    <div class="os-block">
      <h3 class="os-head">Retention</h3>
      <div class="table-scroll">
        <table class="os-table">
          <thead><tr><th>Topic</th><th>Learned</th><th>Recalls</th><th>Score</th><th>Weak areas</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <p class="os-note">A score appears only once a recall attempt has actually been evaluated.</p>
    </div>`;
}

function renderOsMemory() {
  const mount = document.getElementById('panel-memory');
  if (!mount) return;
  const entries = dailyDueRecalls();

  if (!entries.length) {
    mount.innerHTML = osEmpty('No topics yet. Record an HTB topic on Today and it lands here, '
      + 'with a recall prompt scheduled a couple of days later.');
    return;
  }

  const due = entries.filter(e => e.due);
  const upcoming = entries.filter(e => !e.due);

  mount.innerHTML = `
    <div class="os-block">
      <h3 class="os-head">Due for recall ${due.length ? `<span class="os-count">${due.length}</span>` : ''}</h3>
      ${due.length ? due.map(osRecallPromptHtml).join('') : osEmpty('Nothing due right now.')}
    </div>
    ${upcoming.length ? `
      <div class="os-block">
        <h3 class="os-head">Scheduled</h3>
        ${upcoming.map(osRecallPromptHtml).join('')}
      </div>` : ''}
    ${osRetentionHtml()}`;

  wireOsMemory();
}

function wireOsMemory() {
  const mount = document.getElementById('panel-memory');
  if (!mount) return;

  mount.querySelectorAll('[data-os-recall]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.osRecall;
      osOpenRecallTopicId = osOpenRecallTopicId === id ? null : id;
      renderOsMemory();
    });
  });

  mount.querySelectorAll('[data-os-recall-form]').forEach(form => {
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const text = form.querySelector('.os-textarea').value.trim();
      if (!text) return;   // an empty attempt is not an attempt
      DAILY.saveRecallAttempt(form.dataset.osRecallForm, text);
      osOpenRecallTopicId = null;
      renderOsMemory();
      osTriggerSync();
    });
  });

  mount.querySelectorAll('[data-os-eval]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.osEval;
      osOpenEvaluationRecallId = osOpenEvaluationRecallId === id ? null : id;
      renderOsMemory();
    });
  });

  mount.querySelectorAll('[data-os-eval-form]').forEach(form => {
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const score = Number(form.querySelector('.os-eval-score').value);
      if (!Number.isFinite(score)) return;
      const weakRaw = form.querySelector('.os-eval-weak').value.trim();
      DAILY.saveRecallEvaluation(form.dataset.osEvalForm, {
        score: Math.min(10, Math.max(0, score)),
        weak_points: weakRaw ? weakRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
        evaluator: 'manual',
        evaluated_at: new Date().toISOString(),
      });
      osOpenEvaluationRecallId = null;
      renderOsMemory();
      osTriggerSync();
    });
  });

  mount.querySelectorAll('[data-os-delete-topic]').forEach(btn => {
    btn.addEventListener('click', () => {
      DAILY.deleteTopic(btn.dataset.osDeleteTopic);
      renderOsMemory();
      osTriggerSync();
    });
  });
}

// --- History --------------------------------------------------------------

function osDayDetailHtml(record) {
  const mins = dailySleepDurationMinutes(record.sleep_start, record.wake_time);
  const habits = DAILY_CORE_HABITS.concat(DAILY_EXTRA_HABITS)
    .map(h => `<span class="os-chip ${record[h.id] ? 'is-on' : ''}">${escapeHtml(h.label)}</span>`).join('');
  const supplements = Object.keys(record.supplements || {})
    .filter(k => record.supplements[k])
    .map(k => `<span class="os-chip is-on">${escapeHtml(k)}</span>`).join('');

  const line = (label, value) => value === null || value === undefined || value === ''
    ? '' : `<div class="os-kv"><span>${escapeHtml(label)}</span><span class="mono">${escapeHtml(String(value))}</span></div>`;

  return `
    <div class="os-day-detail">
      <div class="os-kv-grid">
        ${line('Sleep', mins === null ? null : `${record.sleep_start} → ${record.wake_time} · ${dailyFormatDuration(mins)}`)}
        ${line('Sleep quality', record.sleep_quality)}
        ${line('Mood', record.mood)}
        ${line('Energy', record.energy)}
        ${line('Focus', record.focus)}
        ${line('TradingView opens', record.tradingview_opens)}
        ${line('Screen time (min)', record.screen_time.total_min)}
        ${line('HTB topic', record.htb_topic)}
        ${line('Spiritual learning', record.spiritual_learning_note)}
      </div>
      <div class="os-chips">${habits}${supplements}</div>
      ${record.priorities.length ? `
        <div class="os-kv-block">
          <span class="os-kv-head">Priorities</span>
          <ol class="os-priorities">${record.priorities.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ol>
        </div>` : ''}
      ${record.win_of_day ? `<div class="os-kv-block"><span class="os-kv-head">Win</span>
        <p class="os-reflection">${escapeHtml(record.win_of_day)}</p></div>` : ''}
      ${record.friction ? `<div class="os-kv-block"><span class="os-kv-head">Friction</span>
        <p class="os-reflection">${escapeHtml(record.friction)}</p></div>` : ''}
      <a class="os-btn os-btn-primary os-edit-link" href="index.html?date=${encodeURIComponent(record.date)}">
        Edit this day on Today</a>
    </div>`;
}

function renderOsHistory() {
  const mount = document.getElementById('panel-history');
  if (!mount) return;
  const days = DAILY.orderedDays().reverse();   // newest first

  if (!days.length) {
    mount.innerHTML = osEmpty('No days recorded yet.');
    return;
  }

  mount.innerHTML = `
    <p class="os-note">${days.length} day${days.length === 1 ? '' : 's'} recorded. Tap a day to see what you reported.</p>
    <div class="os-history">
      ${days.map(r => {
        const tier = dailyDayTier(r);
        const mins = dailySleepDurationMinutes(r.sleep_start, r.wake_time);
        const open = osOpenDay === r.date;
        return `
          <div class="os-history-item ${open ? 'is-open' : ''}">
            <button type="button" class="os-history-row" data-os-day="${escapeHtml(r.date)}"
                    aria-expanded="${open ? 'true' : 'false'}">
              <span class="os-history-date mono">${escapeHtml(osDateLabel(r.date))}</span>
              <span class="os-history-summary mono">
                ${tier.core}/${DAILY_CORE_HABITS.length} core
                ${mins !== null ? ` · ${dailyFormatDuration(mins)}` : ''}
                ${typeof r.focus === 'number' ? ` · focus ${r.focus}` : ''}
              </span>
              <span class="daily-tier daily-tier-${escapeHtml(tier.id)}">${escapeHtml(tier.label)}</span>
            </button>
            ${open ? osDayDetailHtml(r) : ''}
          </div>`;
      }).join('')}
    </div>`;

  mount.querySelectorAll('[data-os-day]').forEach(btn => {
    btn.addEventListener('click', () => {
      const date = btn.dataset.osDay;
      osOpenDay = osOpenDay === date ? null : date;
      renderOsHistory();
    });
  });
}

// --- page shell -----------------------------------------------------------

let osSyncInFlight = false;

function osTriggerSync() {
  if (osSyncInFlight) return;
  const { url, token } = DAILY.syncConfig();
  if (!url || !token) return;
  osSyncInFlight = true;
  DAILY.syncWithServer().then(state => {
    osSyncInFlight = false;
    if (state) renderOsActiveTab();
  });
}

function renderOsActiveTab() {
  if (osActiveTab === 'insights') renderOsInsights();
  else if (osActiveTab === 'memory') renderOsMemory();
  else renderOsHistory();
}

function wireOsTabs() {
  document.querySelectorAll('[data-os-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      osActiveTab = btn.dataset.osTab;
      document.querySelectorAll('[data-os-tab]').forEach(b => {
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      ['insights', 'memory', 'history'].forEach(id => {
        const panel = document.getElementById(`panel-${id}`);
        if (panel) panel.hidden = id !== osActiveTab;
      });
      renderOsActiveTab();
    });
  });
}

function osLoadAndRender() {
  wireOsTabs();
  renderOsActiveTab();
  updateLastUpdated(new Date().toISOString());
  osTriggerSync();
}

wireRefreshButton(async () => {
  await DAILY.syncWithServer();
  renderOsActiveTab();
});

osLoadAndRender();
