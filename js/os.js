// Personal OS page — Insights, Memory and History.
//
// Everything rendered here is computed from stored daily records by daily.js.
// Nothing on this page invents a number, and nothing writes an interpretation
// back into a record: interpretations are produced on read, so redefining one
// later reinterprets all history rather than stranding records stamped under
// an older rule.
//
// After the two-area restructure this file is renderers only: the nav,
// sub-tabs and panel switching are owned by shell.js, and personal-os.js
// decides which of these three to call. It draws into #panel-insights,
// #panel-memory and #panel-history, which the shell shows and hides.

let osActiveTab = 'insights';
// Which History day is expanded, and which topic's recall composer is open.
let osOpenDay = null;
let osOpenRecallTopicId = null;
let osRevealedTopicId = null;
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

// Active period for Insights. One selection drives every panel on the
// screen, so "7 days" means the same thing in Consistency as in Sleep --
// per-panel windows made two numbers on one screen describe different spans.
let osPeriodDays = 7;

const OS_PERIODS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

// Below this many reported days there is nothing honest to chart, so the
// panel shows what WILL appear instead of a chart of almost nothing.
const OS_MIN_DAYS_FOR_CHARTS = 3;

// An empty state that shows the shape of the populated one, faintly, plus the
// single action that fills it. A blank panel and a broken panel look
// identical; a ghost of the real thing does not.
function osGhostState({ heading, subtext, ghost, nudge }) {
  return `
    <div class="ghost-state">
      <p class="ghost-heading">${escapeHtml(heading)}</p>
      <p class="ghost-sub">${escapeHtml(subtext)}</p>
      <div class="ghost-preview" aria-hidden="true">${ghost}</div>
      ${nudge ? `<div class="nudge">
        <span class="nudge-icon" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
               stroke-width="1.5" stroke-linecap="round">
            <circle cx="8" cy="8" r="6.2"/><path d="M8 4.8V8l2.1 1.3"/>
          </svg></span>
        <span>${escapeHtml(nudge)}</span>
      </div>` : ''}
    </div>`;
}

function osGhostBars(labels) {
  return labels.map(l => `
    <div class="ghost-bar-row">
      <span class="ghost-bar-label">${escapeHtml(l)}</span>
      <span class="os-bar"><span class="os-bar-fill" style="width:0"></span></span>
      <span class="ghost-bar-value mono">—</span>
    </div>`).join('');
}

function osGhostTiles(labels) {
  return `<div class="stat-grid">${labels.map(l => `
    <div class="stat-tile">
      <span class="stat-value mono">—</span>
      <span class="stat-label">${escapeHtml(l)}</span>
    </div>`).join('')}</div>`;
}

function osConsistencyBarsHtml(records) {
  return `<div class="bar-list">${dailyConsistencyTable(records).map(r => `
    <div class="bar-row">
      <span class="bar-label">${escapeHtml(r.label)}</span>
      <span class="os-bar"><span class="os-bar-fill" style="width:${r.pct || 0}%"></span></span>
      <span class="bar-value mono">${osPct(r.pct)}</span>
    </div>`).join('')}</div>`;
}

function osStatTiles(tiles) {
  return `<div class="stat-grid">${tiles.map(t => `
    <div class="stat-tile">
      <span class="stat-value mono">${escapeHtml(String(t.value))}</span>
      <span class="stat-label">${escapeHtml(t.label)}</span>
    </div>`).join('')}</div>`;
}

function renderOsInsights() {
  const mount = document.getElementById('panel-insights');
  if (!mount) return;

  const records = DAILY.windowDays(osPeriodDays);
  const enough = records.length >= OS_MIN_DAYS_FOR_CHARTS;
  const sleep = dailySleepStats(records);
  const tv = dailyTradingViewStats(records);

  const consistency = enough
    ? osConsistencyBarsHtml(records)
    : osGhostState({
        heading: records.length <= 1
          ? `Day ${Math.max(records.length, 1)} of building your pattern`
          : `${records.length} days in`,
        subtext: 'Each habit gets a completion bar once there are a few days to compare. '
          + 'Percentages count only the days you actually reported.',
        ghost: osGhostBars(['Tefillin', 'Spiritual learning', 'HTB']),
        nudge: 'Check back after your first Close the Day',
      });

  const sleepPanel = sleep
    ? osStatTiles([
        { value: dailyFormatDuration(sleep.avgDurationMin), label: 'Avg hours' },
        { value: sleep.avgQuality === null ? '—' : sleep.avgQuality, label: 'Best night' },
        { value: `±${osNum(sleep.bedtimeSpreadMin)}m`, label: 'Consistency' },
      ])
    : osGhostState({
        heading: 'No nights logged yet',
        subtext: 'Log a bedtime and wake time and your average duration, quality and '
          + 'bedtime consistency appear here.',
        ghost: osGhostTiles(['Avg hours', 'Best night', 'Consistency']),
        nudge: 'Tap "Log last night\u2019s sleep" on Today',
      });

  const mindTiles = DAILY_MIND_METRICS.map(m => ({
    value: osNum(dailyRound(dailyMean(records.map(r => r[m.id])))),
    label: m.label,
  }));
  const hasMind = DAILY_MIND_METRICS.some(m => records.some(r => typeof r[m.id] === 'number'));
  const mindPanel = hasMind
    ? osStatTiles(mindTiles)
    : osGhostState({
        heading: 'Nothing rated yet',
        subtext: 'Mood, energy and focus are asked once, at the end of the day, and '
          + 'averaged here.',
        ghost: osGhostTiles(['Mood', 'Energy', 'Focus']),
        nudge: 'Rate them in Close the Day',
      });

  mount.innerHTML = `
    <div class="pill-row is-purple">
      ${OS_PERIODS.map(p => `
        <button type="button" class="pill ${p.days === osPeriodDays ? 'is-active' : ''}"
                data-os-period="${p.days}">${p.label}</button>`).join('')}
    </div>

    <section class="os-block">
      <h2 class="sec-label">Consistency</h2>
      ${consistency}
    </section>

    <section class="os-block">
      <h2 class="sec-label">Sleep</h2>
      ${sleepPanel}
    </section>

    <section class="os-block">
      <h2 class="sec-label">Mind &amp; energy</h2>
      ${mindPanel}
    </section>

    ${tv ? `
      <section class="os-block">
        <h2 class="sec-label">Market checking</h2>
        ${osStatTiles([
          { value: osNum(tv.avg), label: 'Avg / day' },
          { value: tv.max, label: `Highest · ${osDateLabel(tv.maxDate)}` },
          { value: tv.min, label: `Lowest · ${osDateLabel(tv.minDate)}` },
        ])}
      </section>` : ''}

    ${enough ? `
      <section class="os-block">
        <h2 class="sec-label">Observations</h2>
        ${osObservationsHtml(DAILY.windowDays(90))}
      </section>

      <section class="os-block">
        <h2 class="sec-label">This week</h2>
        ${osWeeklyReviewHtml()}
      </section>` : ''}

    ${osSettingsHtml()}`;

  wireOsSettings();

  mount.querySelectorAll('[data-os-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      osPeriodDays = Number(btn.dataset.osPeriod);
      renderOsInsights();
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
        <summary class="os-note">Settings — targets, sync and backup</summary>
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

          <h4 class="os-subhead">Backup</h4>
          <p class="os-note">Your Personal OS data lives in this browser, and on the sync
            server only if sync is on. Neither is a backup you control. Download a copy
            you keep.</p>
          <div class="os-settings-form">
            <button type="button" class="os-btn" id="os-export">Download a backup</button>
            <label class="os-import">
              <span class="os-btn">Restore from a file</span>
              <input type="file" id="os-import" accept="application/json,.json" hidden>
            </label>
          </div>
          <p class="os-note" id="os-backup-status"></p>
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

  const exportBtn = document.getElementById('os-export');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(DAILY.exportAll(), null, 2)],
        { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jarvis-personal-os-${dailyTodayIso()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on the next tick rather than immediately: Safari cancels the
      // download if the object URL disappears while it is still starting.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const status = document.getElementById('os-backup-status');
      if (status) status.textContent = `Saved ${Object.keys(DAILY.days()).length} days.`;
    });
  }

  const importInput = document.getElementById('os-import');
  if (importInput) {
    importInput.addEventListener('change', () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      const status = document.getElementById('os-backup-status');
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const result = DAILY.importAll(JSON.parse(reader.result));
          if (status) {
            status.textContent = `Restored ${result.days} day(s), ${result.topics} topic(s), `
              + `${result.recalls} recall(s). Anything newer than the backup was kept.`;
          }
          renderOsInsights();
          osTriggerSync();
        } catch (e) {
          if (status) status.textContent = `Could not read that file: ${e.message}`;
        }
      };
      reader.readAsText(file);
      importInput.value = '';   // so re-picking the same file fires again
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

// A topic's category badge. Category is whatever was recorded with the
// topic (HTB by default) and is never constrained to a fixed set: Memory is
// primarily cybersecurity learning but must not hardcode that.
function osCategoryOf(topic) {
  return (topic.category || topic.source || 'topic').toString();
}

// Rating buttons map onto the configurable interval ladder in daily.js, NOT
// onto an SM-2 style algorithm. Each one just says which rung to land on
// next, so retuning the schedule means editing one array.
const OS_RATINGS = [
  { id: 'again', label: 'Again', hint: 'same interval' },
  { id: 'good', label: 'Good', hint: 'next interval' },
  { id: 'easy', label: 'Easy', hint: 'skip ahead' },
];

function osRecallPromptHtml(entry) {
  const t = entry.topic;
  const since = t.first_learned_date
    ? dailyDaysBetween(t.first_learned_date, dailyTodayIso()) : null;
  const open = osOpenRecallTopicId === t.id;
  const revealed = osRevealedTopicId === t.id;

  return `
    <article class="recall-card ${entry.due ? 'is-due' : ''}">
      <div class="recall-meta">
        <span class="recall-when mono">
          ${entry.due ? 'Due now' : `Next ${escapeHtml(entry.dueDate)}`}
          · every ${entry.intervalDays}d
        </span>
        <span class="recall-cat">${escapeHtml(osCategoryOf(t))}</span>
      </div>
      <h3 class="recall-topic">${escapeHtml(t.topic)}</h3>
      <p class="recall-question">Explain how <b>${escapeHtml(t.topic)}</b> works, without looking at your notes.</p>
      <p class="recall-sub mono">
        learned ${escapeHtml(t.first_learned_date || '—')}${since !== null ? ` · ${since}d ago` : ''}
        · studied ${t.study_count}× · ${entry.attempts.length} recall${entry.attempts.length === 1 ? '' : 's'}
      </p>

      ${open ? `
        <form class="recall-form" data-os-recall-form="${escapeHtml(t.id)}">
          <textarea class="textarea" rows="5" placeholder="Explain it in your own words…"
                    aria-label="Your explanation of ${escapeHtml(t.topic)}"></textarea>
          <div class="rating-row">
            ${OS_RATINGS.map(r => `
              <button type="submit" class="rating-btn" data-os-rating="${r.id}">
                <span>${r.label}</span>
                <span class="rating-hint">${r.hint}</span>
              </button>`).join('')}
          </div>
        </form>`
        : !revealed ? `
          <button type="button" class="reveal-btn" data-os-reveal="${escapeHtml(t.id)}">
            Tap to reveal answer area
          </button>`
        : `<div class="recall-actions">
            <button type="button" class="btn-primary" data-os-recall="${escapeHtml(t.id)}">Write a recall</button>
            <button type="button" class="btn-quiet" data-os-delete-topic="${escapeHtml(t.id)}">Remove</button>
          </div>`}

      ${osAttemptsHtml(entry.attempts)}
    </article>`;
}

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
    mount.innerHTML = osGhostState({
      heading: 'No topics yet',
      subtext: 'Record what you studied on Today and it lands here, with a recall '
        + 'prompt scheduled a couple of days later.',
      ghost: `<div class="ghost-topic-row"><span></span><span class="ghost-pill"></span></div>
              <div class="ghost-topic-row"><span></span><span class="ghost-pill"></span></div>`,
      nudge: 'Tick HTB on Today and name the topic',
    });
    return;
  }

  const due = entries.filter(e => e.due);
  const upcoming = entries.filter(e => !e.due);

  mount.innerHTML = `
    ${due.length ? `
      <div class="due-banner">
        <div class="due-banner-text">
          <span class="due-count mono">${due.length} review${due.length === 1 ? '' : 's'} due</span>
          <span class="due-sub">Start to clear the queue</span>
        </div>
        <button type="button" class="btn-primary" data-os-start-review>Review</button>
      </div>` : `
      <div class="due-banner is-clear">
        <div class="due-banner-text">
          <span class="due-count mono">Queue clear</span>
          <span class="due-sub">Next review ${escapeHtml(upcoming[0].dueDate)}</span>
        </div>
      </div>`}

    ${due.length ? `
      <section class="os-block">
        <h2 class="sec-label">Due now</h2>
        ${due.map(osRecallPromptHtml).join('')}
      </section>` : ''}

    ${upcoming.length ? `
      <section class="os-block">
        <h2 class="sec-label">Scheduled</h2>
        ${upcoming.map(osRecallPromptHtml).join('')}
      </section>` : ''}

    ${osRetentionHtml()}`;

  wireOsMemory();
}

function wireOsMemory() {
  const mount = document.getElementById('panel-memory');
  if (!mount) return;

  const start = mount.querySelector('[data-os-start-review]');
  if (start) {
    start.addEventListener('click', () => {
      const first = dailyDueRecalls().find(e => e.due);
      if (!first) return;
      osRevealedTopicId = first.topic.id;
      osOpenRecallTopicId = first.topic.id;
      renderOsMemory();
    });
  }

  mount.querySelectorAll('[data-os-reveal]').forEach(btn => {
    btn.addEventListener('click', () => {
      osRevealedTopicId = btn.dataset.osReveal;
      renderOsMemory();
    });
  });

  mount.querySelectorAll('[data-os-recall]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.osRecall;
      osOpenRecallTopicId = osOpenRecallTopicId === id ? null : id;
      renderOsMemory();
    });
  });

  mount.querySelectorAll('[data-os-recall-form]').forEach(form => {
    // The rating that submitted the form decides the next interval. Captured
    // on mousedown because the click that submits clears activeElement first.
    let rating = 'good';
    form.querySelectorAll('[data-os-rating]').forEach(btn => {
      btn.addEventListener('mousedown', () => { rating = btn.dataset.osRating; });
      btn.addEventListener('touchstart', () => { rating = btn.dataset.osRating; }, { passive: true });
    });
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const text = form.querySelector('.textarea').value.trim();
      if (!text) return;   // an empty attempt is not an attempt
      DAILY.saveRecallAttempt(form.dataset.osRecallForm, text, rating);
      osOpenRecallTopicId = null;
      osRevealedTopicId = null;
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
      // Attaches an evaluation ALONGSIDE the answer. response_text is never
      // touched: the original words are the record, a score is commentary.
      DAILY.saveRecallEvaluation(form.dataset.osEvalForm, {
        score: Math.min(10, Math.max(0, score)),
        weak_points: weakRaw ? weakRaw.split(',').map(x => x.trim()).filter(Boolean) : [],
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
    .map(h => `<span class="day-habit ${record[h.id] ? 'is-on' : ''}">
      <span class="day-dot" aria-hidden="true"></span>${escapeHtml(h.label)}</span>`).join('');
  const supplements = Object.keys(record.supplements || {})
    .filter(k => record.supplements[k])
    .map(k => `<span class="day-habit is-on">
      <span class="day-dot" aria-hidden="true"></span>${escapeHtml(k)}</span>`).join('');

  // Mood / energy / focus as a row of round pips -- a score reads faster as a
  // filled proportion than as three separate numeric rows.
  const pips = DAILY_MIND_METRICS.map(m => {
    const v = record[m.id];
    return `<div class="pip-row">
      <span class="pip-label">${escapeHtml(m.label)}</span>
      <span class="pips" aria-label="${escapeHtml(m.label)} ${v === null ? 'not rated' : v + ' of 10'}">
        ${[...Array(10)].map((_, i) =>
          `<span class="pip ${v !== null && i < v ? 'is-on' : ''}"></span>`).join('')}
      </span>
      <span class="pip-value mono">${v === null ? '—' : v}</span>
    </div>`;
  }).join('');

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
      <div class="pip-list">${pips}</div>
      <div class="day-habits">${habits}${supplements}</div>
      ${record.priorities.length ? `
        <div class="os-kv-block">
          <span class="os-kv-head">Priorities</span>
          <ol class="os-priorities">${record.priorities.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ol>
        </div>` : ''}
      ${record.win_of_day ? `<div class="os-kv-block"><span class="os-kv-head">Win</span>
        <p class="os-reflection">${escapeHtml(record.win_of_day)}</p></div>` : ''}
      ${record.friction ? `<div class="os-kv-block"><span class="os-kv-head">Friction</span>
        <p class="os-reflection">${escapeHtml(record.friction)}</p></div>` : ''}
      <a class="btn-primary os-edit-link" href="index.html?date=${encodeURIComponent(record.date)}#today">
        Edit this day on Today</a>
    </div>`;
}

// 21 days of strip, ending today. Fixed length rather than "however many
// were logged" so the strip reads as a calendar you can scrub, and a gap is
// visibly a gap rather than silently collapsed away.
const OS_HISTORY_STRIP_DAYS = 21;
const OS_WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function renderOsHistory() {
  const mount = document.getElementById('panel-history');
  if (!mount) return;

  const today = dailyTodayIso();
  const stored = DAILY.days();
  if (!Object.keys(stored).length) {
    mount.innerHTML = osGhostState({
      heading: 'No days recorded yet',
      subtext: 'Once you close a day it appears here, and every past day stays editable.',
      ghost: `<div class="ghost-topic-row"><span></span><span class="ghost-pill"></span></div>`,
      nudge: 'Close your first day on Today',
    });
    return;
  }

  if (!osOpenDay || !stored[osOpenDay]) {
    // Default to the most recent day that actually has a record, so opening
    // History lands on something rather than on an empty future date.
    osOpenDay = Object.keys(stored).sort().reverse()[0];
  }

  const days = [];
  for (let i = OS_HISTORY_STRIP_DAYS - 1; i >= 0; i--) {
    const date = dailyShiftIso(today, -i);
    const record = stored[date] ? dailyNormalizeRecord(stored[date], date) : null;
    days.push({ date, record });
  }

  const strip = days.map(d => {
    const tier = d.record ? dailyDayTier(d.record) : null;
    const isSel = d.date === osOpenDay;
    const dotClass = !d.record ? 'is-none'
      : tier.id === 'building' ? 'is-partial' : 'is-full';
    return `
      <button type="button" class="strip-day ${isSel ? 'is-selected' : ''} ${d.record ? '' : 'is-empty'}"
              data-os-day="${escapeHtml(d.date)}" aria-pressed="${isSel ? 'true' : 'false'}"
              aria-label="${escapeHtml(osDateLabel(d.date))}">
        <span class="strip-letter">${OS_WEEKDAY_LETTERS[dailyWeekdayIndex(d.date)]}</span>
        <span class="strip-num mono">${Number(d.date.slice(8))}</span>
        <span class="strip-dot ${dotClass}"></span>
      </button>`;
  }).join('');

  const record = dailyNormalizeRecord(stored[osOpenDay], osOpenDay);

  mount.innerHTML = `
    <div class="date-strip" role="group" aria-label="Pick a day">${strip}</div>
    ${osDayDetailHtml(record)}`;

  mount.querySelectorAll('[data-os-day]').forEach(btn => {
    btn.addEventListener('click', () => {
      osOpenDay = btn.dataset.osDay;
      renderOsHistory();
    });
  });

  // Scroll the strip to today on first paint so the most recent days are the
  // ones in view on a phone.
  const selected = mount.querySelector('.strip-day.is-selected');
  if (selected && selected.scrollIntoView) {
    selected.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
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

// Re-renders whichever of the three is currently on screen. Called after a
// background sync lands so a pull from another device is reflected without
// the user having to switch tabs and back.
function renderOsActiveTab() {
  if (osActiveTab === 'insights') renderOsInsights();
  else if (osActiveTab === 'memory') renderOsMemory();
  else if (osActiveTab === 'history') renderOsHistory();
}
