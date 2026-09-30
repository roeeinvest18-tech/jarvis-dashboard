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

const OS_S = STRINGS.insights;
const MEM_S = STRINGS.memory;
const HIST_S = STRINGS.history;
const SET_S = STRINGS.settings;

let osActiveTab = 'insights';
// Which History day is expanded, and which topic's recall composer is open.
let osOpenDay = null;
let osOpenRecallTopicId = null;
let osRevealedTopicId = null;
let osOpenEvaluationRecallId = null;

function osPct(value) {
  return value === null || value === undefined ? STRINGS.common.none : `${value}%`;
}

function osNum(value) {
  return value === null || value === undefined ? STRINGS.common.none : String(value);
}

// Pinned to en-GB like every other date in the app. It used to pass
// `undefined`, which means "the device's locale" -- on a Hebrew phone that
// rendered these day labels in Hebrew, the only non-English text left on an
// otherwise English screen (owner's decision, 2026-09-24).
function osDateLabel(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB',
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
  if (!records.length) return osEmpty(OS_S.consistency.emptyWindow(windowLabel));
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
        <thead><tr><th>${OS_S.consistency.headings.habit}</th><th>${OS_S.consistency.headings.done}</th><th>${OS_S.consistency.headings.rate}</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function osSleepPanelHtml(records) {
  const s = dailySleepStats(records);
  if (!s) return osEmpty(OS_S.sleep.empty);
  return `
    <div class="os-stat-grid">
      <div class="os-stat"><span class="os-stat-value mono">${dailyFormatDuration(s.avgDurationMin)}</span><span class="os-stat-label">${OS_S.sleep.avgDuration}</span></div>
      <div class="os-stat"><span class="os-stat-value mono">${osNum(s.avgQuality)}</span><span class="os-stat-label">${OS_S.sleep.avgQuality}</span></div>
      <div class="os-stat"><span class="os-stat-value mono">${escapeHtml(s.avgBedtime)}</span><span class="os-stat-label">${OS_S.sleep.avgBedtime}</span></div>
      <div class="os-stat"><span class="os-stat-value mono">${escapeHtml(s.avgWakeTime)}</span><span class="os-stat-label">${OS_S.sleep.avgWake}</span></div>
      <div class="os-stat"><span class="os-stat-value mono">±${osNum(s.bedtimeSpreadMin)}m</span><span class="os-stat-label">${OS_S.sleep.bedtimeSpread}</span></div>
      <div class="os-stat"><span class="os-stat-value mono">±${osNum(s.wakeSpreadMin)}m</span><span class="os-stat-label">${OS_S.sleep.wakeSpread}</span></div>
    </div>
    <p class="os-note">${OS_S.sleep.basedOn(s.n)}</p>`;
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
  if (!tv) return osEmpty(OS_S.tradingView.empty);
  return `
    <div class="os-stat-grid">
      <div class="os-stat"><span class="os-stat-value mono">${osNum(tv.avg)}</span><span class="os-stat-label">${OS_S.tradingView.avgPerDay}</span></div>
      <div class="os-stat"><span class="os-stat-value mono">${tv.max}</span><span class="os-stat-label">${escapeHtml(OS_S.tradingView.highest(osDateLabel(tv.maxDate)))}</span></div>
      <div class="os-stat"><span class="os-stat-value mono">${tv.min}</span><span class="os-stat-label">${escapeHtml(OS_S.tradingView.lowest(osDateLabel(tv.minDate)))}</span></div>
      <div class="os-stat"><span class="os-stat-value mono">${tv.total}</span><span class="os-stat-label">${OS_S.tradingView.total(tv.n)}</span></div>
    </div>`;
}

// Observations are rendered with their evidence attached and an explicit
// "observed association" label. The brief was specific that a correlation must
// never be presented as a cause, so the wording is fixed here rather than left
// to whatever generated the sentence.
function osObservationsHtml(records) {
  // Private tier: trade days come from the sync server's account record and
  // only ever exist on a device holding the owner's token.
  const trades = (osAccountRecord && osAccountRecord.trades_by_date) || {};
  const observations = dailyBehaviouralObservations(records)
    .concat(dailyTradeDayObservations(records, trades));
  if (!observations.length) {
    return osEmpty(OS_S.observations.empty(DAILY_MIN_GROUP_N));
  }
  return observations.map(o => `
    <div class="os-observation">
      <span class="os-observation-tag">${OS_S.observations.tag}</span>
      <p class="os-observation-text">${escapeHtml(o.text)}</p>
      <p class="os-observation-evidence mono">${escapeHtml(OS_S.observations.evidence(
        o.evidence.metric, o.evidence.a.n, osNum(o.evidence.a.mean),
        o.evidence.b.n, osNum(o.evidence.b.mean)))}</p>
    </div>`).join('')
    + `<p class="os-note">${OS_S.observations.caveat}</p>`;
}

// --- experiments (item 23) ------------------------------------------------
//
// One hypothesis, the metric it should move, the baseline it started from,
// the period, and afterwards what happened. Results are read against the
// same analytics rules as everything else: nothing is called an effect.
const OS_EXPERIMENT_SEED = {
  name: OS_S.experiments.seedName,
  hypothesis: OS_S.experiments.seedHypothesis,
  metric: OS_S.experiments.seedMetric,
  baseline: '',
  status: 'running',
};

let osEditingExperimentId = null;

function osExperimentFieldsHtml(exp) {
  const f = (id, label, value, placeholder) => `
    <label class="os-field"><span>${label}</span>
      <input type="text" data-os-exp-field="${id}" value="${escapeHtml(value || '')}"
             placeholder="${escapeHtml(placeholder || '')}"></label>`;
  return `
    <form class="os-exp-form" data-os-exp-form="${escapeHtml(exp.id || '')}">
      ${f('name', OS_S.experiments.name, exp.name, OS_S.experiments.namePlaceholder)}
      ${f('hypothesis', OS_S.experiments.hypothesis, exp.hypothesis, OS_S.experiments.hypothesisPlaceholder)}
      ${f('metric', OS_S.experiments.metric, exp.metric, OS_S.experiments.metricPlaceholder)}
      ${f('baseline', OS_S.experiments.baseline, exp.baseline, OS_S.experiments.baselinePlaceholder)}
      <div class="os-exp-dates">
        <label class="os-field"><span>${OS_S.experiments.from}</span>
          <input type="date" data-os-exp-field="started_on" value="${escapeHtml(exp.started_on || '')}"></label>
        <label class="os-field"><span>${OS_S.experiments.until}</span>
          <input type="date" data-os-exp-field="ends_on" value="${escapeHtml(exp.ends_on || '')}"></label>
      </div>
      ${f('result', OS_S.experiments.resultField, exp.result, OS_S.experiments.resultPlaceholder)}
      <div class="os-exp-actions">
        <button type="submit" class="os-btn os-btn-primary">${STRINGS.common.save}</button>
        ${exp.id ? `<button type="button" class="os-btn os-btn-quiet" data-os-exp-delete="${escapeHtml(exp.id)}">${STRINGS.common.remove}</button>` : ''}
      </div>
    </form>`;
}

function osExperimentsHtml() {
  const all = DAILY.experiments();
  const rows = all.map(e => (osEditingExperimentId === e.id
    ? osExperimentFieldsHtml(e)
    : `<article class="os-exp">
         <div class="os-exp-head">
           <h4 class="os-exp-name">${escapeHtml(e.name || OS_S.experiments.untitled)}</h4>
           <span class="mono os-muted">${escapeHtml(e.started_on ? osDateLabel(e.started_on) : '')}${e.ends_on ? ` → ${escapeHtml(osDateLabel(e.ends_on))}` : ''}</span>
         </div>
         ${e.hypothesis ? `<p class="os-note">${escapeHtml(e.hypothesis)}</p>` : ''}
         <p class="os-exp-meta mono">${escapeHtml(OS_S.experiments.meta(
           e.metric || STRINGS.common.none, e.baseline || STRINGS.common.none))}</p>
         ${e.result ? `<p class="os-note">${escapeHtml(OS_S.experiments.result(e.result))}</p>`
           : `<p class="os-note os-muted">${OS_S.experiments.noResult}</p>`}
         <button type="button" class="os-btn os-btn-quiet" data-os-exp-edit="${escapeHtml(e.id)}">${STRINGS.common.edit}</button>
       </article>`)).join('');

  const adding = osEditingExperimentId === 'new';
  return `
    ${rows || `<p class="os-note">${OS_S.experiments.empty}</p>`}
    ${adding ? osExperimentFieldsHtml({ ...OS_EXPERIMENT_SEED, id: '' }) : `
      <div class="os-exp-actions">
        <button type="button" class="os-btn os-btn-quiet" id="os-exp-new">${OS_S.experiments.add}</button>
        ${all.length ? '' : `<button type="button" class="os-btn os-btn-primary" id="os-exp-seed">${OS_S.experiments.seed}</button>`}
      </div>`}
    <p class="os-note os-muted">${OS_S.experiments.caveat(DAILY_MIN_GROUP_N)}</p>`;
}

function wireOsExperiments() {
  const start = (id) => { osEditingExperimentId = id; renderOsInsights(); };
  const newBtn = document.getElementById('os-exp-new');
  if (newBtn) newBtn.addEventListener('click', () => start('new'));
  const seed = document.getElementById('os-exp-seed');
  if (seed) seed.addEventListener('click', () => {
    DAILY.saveExperiment({ ...OS_EXPERIMENT_SEED });
    osTriggerSync();
    renderOsInsights();
  });
  document.querySelectorAll('[data-os-exp-edit]').forEach(b => b.addEventListener('click', () => start(b.dataset.osExpEdit)));
  document.querySelectorAll('[data-os-exp-delete]').forEach(b => b.addEventListener('click', () => {
    DAILY.deleteExperiment(b.dataset.osExpDelete);
    osEditingExperimentId = null;
    osTriggerSync();
    renderOsInsights();
  }));
  document.querySelectorAll('[data-os-exp-form]').forEach(form => form.addEventListener('submit', ev => {
    ev.preventDefault();
    const patch = {};
    form.querySelectorAll('[data-os-exp-field]').forEach(i => { patch[i.dataset.osExpField] = i.value.trim(); });
    const id = form.dataset.osExpForm;
    DAILY.saveExperiment(id ? { ...patch, id } : patch);
    osEditingExperimentId = null;
    osTriggerSync();
    renderOsInsights();
  }));
}

// The private account record (trade days, for the associations above). Null
// until fetched, and stays null on a device without the owner's sync token.
let osAccountRecord = null;
let osAccountFetched = false;

function osFetchAccountRecord() {
  if (osAccountFetched || typeof healthSyncConfig !== 'function') return;
  osAccountFetched = true;
  const { url, token } = healthSyncConfig();
  if (!url || !token) return;
  fetch(`${url}/account-status`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(rec => {
      if (rec && rec.trades_by_date) { osAccountRecord = rec; renderOsInsights(); }
    })
    .catch(() => { /* private extras are optional */ });
}

function osWeeklyReviewHtml() {
  const wr = dailyWeeklyReview();
  if (!wr.reportedDays) return osEmpty(OS_S.week.empty);

  const movement = (list, kind) => list.length
    ? `<ul class="os-list">${list.map(e => `
        <li><span>${escapeHtml(e.label)}</span>
        <span class="mono os-delta-${kind}">${e.before}% → ${e.now}%</span></li>`).join('')}</ul>`
    : `<p class="os-note">${kind === 'up' ? OS_S.week.nothingImproved : OS_S.week.nothingDeclined}</p>`;

  const mindRows = DAILY_MIND_METRICS.map(m => {
    const v = wr.mind[m.id];
    return `<li><span>${escapeHtml(v.label)}</span><span class="mono">${osNum(v.before)} → ${osNum(v.now)}</span></li>`;
  }).join('');

  const frictions = wr.frictions.length
    ? `<ul class="os-list">${wr.frictions.map(f => `
        <li><span>${escapeHtml(f.text)}</span><span class="mono os-muted">${escapeHtml(osDateLabel(f.date))}</span></li>`).join('')}</ul>`
    : `<p class="os-note">${OS_S.week.noFriction}</p>`;

  const wins = wr.wins.length
    ? `<ul class="os-list">${wr.wins.map(w => `
        <li><span>${escapeHtml(w.text)}</span><span class="mono os-muted">${escapeHtml(osDateLabel(w.date))}</span></li>`).join('')}</ul>`
    : `<p class="os-note">${OS_S.week.noWins}</p>`;

  return `
    <p class="os-note">${escapeHtml(OS_S.week.reported(wr.reportedDays, wr.previousReportedDays))}</p>
    <h4 class="os-subhead">${OS_S.week.improved}</h4>${movement(wr.improved, 'up')}
    <h4 class="os-subhead">${OS_S.week.declined}</h4>${movement(wr.declined, 'down')}
    <h4 class="os-subhead">${OS_S.week.mind}</h4><ul class="os-list">${mindRows}</ul>
    <h4 class="os-subhead">${OS_S.week.training}</h4>
    <ul class="os-list"><li><span>${OS_S.week.sessionsLogged}</span>
      <span class="mono">${wr.previousTrainingSessions} → ${wr.trainingSessions}</span></li></ul>
    <h4 class="os-subhead">${OS_S.week.wins}</h4>${wins}
    <h4 class="os-subhead">${OS_S.week.friction}</h4>${frictions}`;
}

// Active period for Insights. One selection drives every panel on the
// screen, so "7 days" means the same thing in Consistency as in Sleep --
// per-panel windows made two numbers on one screen describe different spans.
let osPeriodDays = 7;

const OS_PERIODS = [7, 30, 90].map(days => ({ days, label: OS_S.periods[days] }));

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
      <span class="ghost-bar-value mono">${STRINGS.common.none}</span>
    </div>`).join('');
}

function osGhostTiles(labels) {
  return `<div class="stat-grid">${labels.map(l => `
    <div class="stat-tile">
      <span class="stat-value mono">${STRINGS.common.none}</span>
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

// Timing against each item's target time, from the completion times Today
// records. This is the only place "out of norm" is shown. Items with no timed
// day in the period are left out of the table, and with none at all the panel
// says what fills it instead of listing rows of zeros.
function osDeadlinesHtml(records) {
  const D = OS_S.deadlines;
  const rows = dailyDeviationTable(records).filter(r => r.timed > 0);
  if (!rows.length) {
    return osGhostState({
      heading: D.ghostHeading,
      subtext: D.ghostSub,
      ghost: osGhostBars(dailyDeadlineItems().slice(0, 3).map(i => i.label)),
      nudge: D.ghostNudge,
    });
  }
  const body = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.label)}</td>
      <td class="mono">${escapeHtml(r.deadline)}</td>
      <td class="mono">${r.inNorm}</td>
      <td class="mono">${r.outOfNorm}</td>
    </tr>
    <tr class="os-row-note">
      <td colspan="4">${escapeHtml(r.sufficient
        ? D.share(r.share, r.timed) : D.needMore(r.timed, DAILY_MIN_GROUP_N))}</td>
    </tr>`).join('');
  return `
    <div class="table-scroll">
      <table class="os-table">
        <thead><tr><th>${D.headings.item}</th><th>${D.headings.target}</th><th>${D.headings.inNorm}</th><th>${D.headings.outOfNorm}</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="os-note">${D.explain(DAILY_OUT_OF_NORM_AFTER_MIN / 60)}</p>`;
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
          ? OS_S.consistency.ghostDay(Math.max(records.length, 1))
          : OS_S.consistency.ghostDays(records.length),
        subtext: OS_S.consistency.ghostSub,
        ghost: osGhostBars([STRINGS.daily.habits.tefillin, STRINGS.daily.habits.spiritual_learning,
          STRINGS.daily.habits.htb_completed]),
        nudge: OS_S.consistency.ghostNudge,
      });

  const sleepPanel = sleep
    ? osStatTiles([
        { value: dailyFormatDuration(sleep.avgDurationMin), label: OS_S.sleep.avgDuration },
        { value: sleep.avgQuality === null ? STRINGS.common.none : sleep.avgQuality, label: OS_S.sleep.avgQuality },
        { value: `±${osNum(sleep.bedtimeSpreadMin)}m`, label: OS_S.sleep.consistency },
      ])
    : osGhostState({
        heading: OS_S.sleep.ghostHeading,
        subtext: OS_S.sleep.ghostSub,
        ghost: osGhostTiles([OS_S.sleep.avgDuration, OS_S.sleep.avgQuality, OS_S.sleep.consistency]),
        nudge: OS_S.sleep.ghostNudge,
      });

  const mindTiles = DAILY_MIND_METRICS.map(m => ({
    value: osNum(dailyRound(dailyMean(records.map(r => r[m.id])))),
    label: m.label,
  }));
  const hasMind = DAILY_MIND_METRICS.some(m => records.some(r => typeof r[m.id] === 'number'));
  const mindPanel = hasMind
    ? osStatTiles(mindTiles)
    : osGhostState({
        heading: OS_S.mind.ghostHeading,
        subtext: OS_S.mind.ghostSub,
        ghost: osGhostTiles(DAILY_MIND_METRICS.map(m => m.label)),
        nudge: OS_S.mind.ghostNudge,
      });

  mount.innerHTML = `
    <div class="pill-row is-purple">
      ${OS_PERIODS.map(p => `
        <button type="button" class="pill ${p.days === osPeriodDays ? 'is-active' : ''}"
                data-os-period="${p.days}">${p.label}</button>`).join('')}
    </div>

    <section class="os-block">
      <h2 class="sec-label">${OS_S.sections.consistency}</h2>
      ${consistency}
    </section>

    <section class="os-block">
      <h2 class="sec-label">${OS_S.sections.deadlines}</h2>
      ${osDeadlinesHtml(records)}
    </section>

    <section class="os-block">
      <h2 class="sec-label">${OS_S.sections.sleep}</h2>
      ${sleepPanel}
    </section>

    <section class="os-block">
      <h2 class="sec-label">${OS_S.sections.mind}</h2>
      ${mindPanel}
    </section>

    ${tv ? `
      <section class="os-block">
        <h2 class="sec-label">${OS_S.sections.marketChecking}</h2>
        ${osStatTiles([
          { value: osNum(tv.avg), label: OS_S.tradingView.avgPerDay },
          { value: tv.max, label: OS_S.tradingView.highest(osDateLabel(tv.maxDate)) },
          { value: tv.min, label: OS_S.tradingView.lowest(osDateLabel(tv.minDate)) },
        ])}
      </section>` : ''}

    ${enough ? `
      <section class="os-block">
        <h2 class="sec-label">${OS_S.sections.observations}</h2>
        ${osObservationsHtml(DAILY.windowDays(90))}
      </section>

      <section class="os-block">
        <h2 class="sec-label">${OS_S.sections.thisWeek}</h2>
        ${osWeeklyReviewHtml()}
      </section>` : ''}

    <section class="os-block">
      <h2 class="sec-label">${OS_S.sections.experiments}</h2>
      ${osExperimentsHtml()}
    </section>

    ${osSettingsHtml()}`;

  wireOsSettings();
  wireOsExperiments();
  osFetchAccountRecord();

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
    ? `<p class="os-note">${escapeHtml(SET_S.syncOn(host))}
        <button type="button" class="os-btn os-btn-quiet" id="os-sync-forget">${SET_S.syncForget}</button></p>`
    : `<p class="os-note">${SET_S.syncOff}</p>
       <form id="os-sync-form" class="os-settings-form" autocomplete="off">
         <input type="url" id="os-sync-url" placeholder="${SET_S.serverUrl}" required
                aria-label="${SET_S.serverUrl}">
         <input type="password" id="os-sync-token" placeholder="${SET_S.serverToken}" required
                autocomplete="off" aria-label="${SET_S.serverToken}">
         <button type="submit" class="os-btn os-btn-primary">${STRINGS.common.save}</button>
       </form>`;

  return `
    <div class="os-block">
      <details class="os-settings">
        <summary class="os-note">${SET_S.summary}</summary>
        <div class="os-settings-body">
          <form id="os-targets-form" class="os-settings-form">
            <label>${SET_S.proteinTarget}
              <input type="number" min="0" id="os-protein" value="${escapeHtml(String(s.protein_target_g))}">
            </label>
            <label>${SET_S.waterTarget}
              <input type="number" min="0" step="0.1" id="os-water" value="${escapeHtml(String(s.water_target_l))}">
            </label>
            <button type="submit" class="os-btn os-btn-primary">${SET_S.saveTargets}</button>
          </form>
          <p class="os-note">${SET_S.targetsNote}</p>
          <h4 class="os-subhead">${SET_S.syncHeading}</h4>
          ${syncBody}

          <h4 class="os-subhead">${SET_S.backupHeading}</h4>
          <p class="os-note">${SET_S.backupNote}</p>
          <div class="os-settings-form">
            <button type="button" class="os-btn" id="os-export">${SET_S.download}</button>
            <label class="os-import">
              <span class="os-btn">${SET_S.restore}</span>
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
      if (status) status.textContent = SET_S.downloaded(Object.keys(DAILY.days()).length);
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
          if (status) status.textContent = SET_S.restored(result.days, result.topics, result.recalls);
          renderOsInsights();
          osTriggerSync();
        } catch (e) {
          if (status) status.textContent = SET_S.restoreFailed;
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
const OS_RATINGS = ['again', 'good', 'easy'].map(id => ({
  id, label: MEM_S.ratings[id].label, hint: MEM_S.ratings[id].hint,
}));

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
          ${entry.due ? MEM_S.dueLabel : escapeHtml(MEM_S.nextLabel(osDateLabel(entry.dueDate)))}
          · ${MEM_S.interval(entry.intervalDays)}
        </span>
        <span class="recall-cat">${escapeHtml(osCategoryOf(t))}</span>
      </div>
      <h3 class="recall-topic">${escapeHtml(t.topic)}</h3>
      <p class="recall-question">${MEM_S.questionHtml(escapeHtml(t.topic))}</p>
      <p class="recall-sub mono">
        ${escapeHtml(MEM_S.learned(t.first_learned_date ? osDateLabel(t.first_learned_date) : STRINGS.common.none, since))}
        · ${escapeHtml(MEM_S.studied(t.study_count, entry.attempts.length))}
      </p>

      ${open ? `
        <form class="recall-form" data-os-recall-form="${escapeHtml(t.id)}">
          <textarea class="textarea" rows="5" placeholder="${MEM_S.answerPlaceholder}"
                    aria-label="${escapeHtml(MEM_S.answerLabel(t.topic))}"></textarea>
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
            ${MEM_S.reveal}
          </button>`
        : `<div class="recall-actions">
            <button type="button" class="btn-primary" data-os-recall="${escapeHtml(t.id)}">${MEM_S.write}</button>
            <button type="button" class="btn-quiet" data-os-delete-topic="${escapeHtml(t.id)}">${MEM_S.removeTopic}</button>
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
          <span class="mono os-muted">${escapeHtml(a.prompted_at ? osDateLabel(a.prompted_at.slice(0, 10)) : STRINGS.common.none)}</span>
          ${evaluated
            ? `<span class="os-score mono">${MEM_S.attempts.score(a.evaluation.score)}</span>`
            : `<span class="os-score-none mono">${MEM_S.attempts.notEvaluated}</span>`}
        </div>
        <p class="os-attempt-body">${escapeHtml(a.response_text || '')}</p>
        ${evaluated && Array.isArray(a.evaluation.weak_points) && a.evaluation.weak_points.length
          ? `<p class="os-attempt-weak">${escapeHtml(MEM_S.attempts.weakPoints(a.evaluation.weak_points.join(', ')))}</p>` : ''}
        ${osOpenEvaluationRecallId === a.id ? `
          <button type="button" class="os-btn os-btn-quiet" data-os-copy-eval="${escapeHtml(a.id)}">
            ${MEM_S.attempts.copy}</button>
          <form class="os-eval-form" data-os-eval-form="${escapeHtml(a.id)}">
            <p class="os-note">${MEM_S.attempts.evalNote}</p>
            <div class="os-eval-row">
              <label>${MEM_S.attempts.scoreField} <input type="number" min="0" max="10" step="0.1" class="os-eval-score" required></label>
              <label>${MEM_S.attempts.weakField} <input type="text" class="os-eval-weak" placeholder="${MEM_S.attempts.weakPlaceholder}"></label>
            </div>
            <button type="submit" class="os-btn os-btn-primary">${MEM_S.attempts.saveEval}</button>
          </form>`
          : `<button type="button" class="os-btn os-btn-quiet" data-os-eval="${escapeHtml(a.id)}">
              ${evaluated ? MEM_S.attempts.updateEval : MEM_S.attempts.addEval}</button>`}
      </div>`;
  }).join('');
  return `<details class="os-attempts"><summary>${MEM_S.attempts.history(attempts.length)}</summary>${rows}</details>`;
}

// Item 28: hand the question and the owner's own answer to an outside
// evaluator, then paste the verdict back. response_text is never modified,
// and nothing is sent anywhere by this app.
function osEvaluationPrompt(topic, attempt) {
  return MEM_S.evaluationPrompt(topic, (attempt.response_text || '').trim());
}

function wireOsCopyEvaluation() {
  document.querySelectorAll('[data-os-copy-eval]').forEach(btn => btn.addEventListener('click', async () => {
    const attempt = DAILY.recalls().find(r => r.id === btn.dataset.osCopyEval);
    if (!attempt) return;
    const topic = (DAILY.topics().find(t => t.id === attempt.topic_id) || {}).topic || MEM_S.unnamedTopic;
    const text = osEvaluationPrompt(topic, attempt);
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = MEM_S.attempts.copied;
    } catch (e) {
      // Clipboard blocked (http, permissions): show it to copy by hand.
      btn.insertAdjacentHTML('afterend', `<textarea class="textarea os-eval-copy" rows="8" readonly>${escapeHtml(text)}</textarea>`);
      btn.remove();
    }
  }));
}

function osRetentionHtml() {
  const rows = dailyRetentionTable();
  if (!rows.length) return '';
  const body = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.topic.topic)}</td>
      <td class="mono">${escapeHtml(r.topic.first_learned_date ? osDateLabel(r.topic.first_learned_date) : STRINGS.common.none)}</td>
      <td class="mono">${r.attemptCount}</td>
      <td class="mono">${r.latestScore === null ? STRINGS.common.none : r.latestScore}</td>
      <td>${r.weakPoints.length ? escapeHtml(r.weakPoints.join(', ')) : STRINGS.common.none}</td>
    </tr>`).join('');
  return `
    <div class="os-block">
      <h3 class="os-head">${MEM_S.retention.heading}</h3>
      <div class="table-scroll">
        <table class="os-table">
          <thead><tr><th>${MEM_S.retention.topic}</th><th>${MEM_S.retention.learned}</th><th>${MEM_S.retention.recalls}</th><th>${MEM_S.retention.score}</th><th>${MEM_S.retention.weakAreas}</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <p class="os-note">${MEM_S.retention.note}</p>
    </div>`;
}

function renderOsMemory() {
  const mount = document.getElementById('panel-memory');
  if (!mount) return;
  const entries = dailyDueRecalls();

  if (!entries.length) {
    mount.innerHTML = osGhostState({
      heading: MEM_S.ghostHeading,
      subtext: MEM_S.ghostSub,
      ghost: `<div class="ghost-topic-row"><span></span><span class="ghost-pill"></span></div>
              <div class="ghost-topic-row"><span></span><span class="ghost-pill"></span></div>`,
      nudge: MEM_S.ghostNudge,
    });
    return;
  }

  const due = entries.filter(e => e.due);
  const upcoming = entries.filter(e => !e.due);

  mount.innerHTML = `
    ${due.length ? `
      <div class="due-banner">
        <div class="due-banner-text">
          <span class="due-count mono">${MEM_S.dueCount(due.length)}</span>
          <span class="due-sub">${MEM_S.dueSub}</span>
        </div>
        <button type="button" class="btn-primary" data-os-start-review>${MEM_S.review}</button>
      </div>` : `
      <div class="due-banner is-clear">
        <div class="due-banner-text">
          <span class="due-count mono">${MEM_S.queueClear}</span>
          <span class="due-sub">${escapeHtml(MEM_S.nextReview(osDateLabel(upcoming[0].dueDate)))}</span>
        </div>
      </div>`}

    ${due.length ? `
      <section class="os-block">
        <h2 class="sec-label">${MEM_S.dueNow}</h2>
        ${due.map(osRecallPromptHtml).join('')}
      </section>` : ''}

    ${upcoming.length ? `
      <section class="os-block">
        <h2 class="sec-label">${MEM_S.scheduled}</h2>
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

  wireOsCopyEvaluation();
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
      <span class="pips" aria-label="${escapeHtml(HIST_S.pipLabel(m.label, v))}">
        ${[...Array(10)].map((_, i) =>
          `<span class="pip ${v !== null && i < v ? 'is-on' : ''}"></span>`).join('')}
      </span>
      <span class="pip-value mono">${v === null ? STRINGS.common.none : v}</span>
    </div>`;
  }).join('');

  const line = (label, value) => value === null || value === undefined || value === ''
    ? '' : `<div class="os-kv"><span>${escapeHtml(label)}</span><span class="mono">${escapeHtml(String(value))}</span></div>`;

  return `
    <div class="os-day-detail">
      <div class="os-kv-grid">
        ${line(HIST_S.fields.sleep, mins === null ? null
          : HIST_S.sleepValue(record.sleep_start, record.wake_time, dailyFormatDuration(mins)))}
        ${line(HIST_S.fields.sleepQuality, record.sleep_quality)}
        ${line(HIST_S.fields.mood, record.mood)}
        ${line(HIST_S.fields.energy, record.energy)}
        ${line(HIST_S.fields.focus, record.focus)}
        ${line(HIST_S.fields.tradingViewOpens, record.tradingview_opens)}
        ${line(HIST_S.fields.screenTime, record.screen_time.total_min)}
        ${line(HIST_S.fields.htbTopic, record.htb_topic)}
        ${line(HIST_S.fields.spiritualLearning, record.spiritual_learning_note)}
      </div>
      <div class="pip-list">${pips}</div>
      <div class="day-habits">${habits}${supplements}</div>
      ${record.priorities.length ? `
        <div class="os-kv-block">
          <span class="os-kv-head">${HIST_S.priorities}</span>
          <ol class="os-priorities">${record.priorities.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ol>
        </div>` : ''}
      ${record.win_of_day ? `<div class="os-kv-block"><span class="os-kv-head">${HIST_S.win}</span>
        <p class="os-reflection">${escapeHtml(record.win_of_day)}</p></div>` : ''}
      ${record.friction ? `<div class="os-kv-block"><span class="os-kv-head">${HIST_S.friction}</span>
        <p class="os-reflection">${escapeHtml(record.friction)}</p></div>` : ''}
      <a class="btn-primary os-edit-link" href="index.html?date=${encodeURIComponent(record.date)}#today">
        ${HIST_S.editDay}</a>
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
      heading: HIST_S.ghostHeading,
      subtext: HIST_S.ghostSub,
      ghost: `<div class="ghost-topic-row"><span></span><span class="ghost-pill"></span></div>`,
      nudge: HIST_S.ghostNudge,
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
    <div class="date-strip" role="group" aria-label="${HIST_S.pickDay}">${strip}</div>
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
