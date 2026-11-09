// Personal OS — the page controller.
//
// Owns nothing but wiring: mountShell (shell.js) draws the chrome and tells
// this which sub-tab is active; this calls the renderer that owns that tab.
// The renderers themselves live where their concern does — daily-today.js,
// training.js, os.js — so moving Training under Personal OS was a routing
// change here rather than a rewrite there.

// Deep links from History ("edit this day") arrive as ?date=YYYY-MM-DD.
// Validated strictly rather than trusted: a malformed value falls back to
// today instead of opening a record under a nonsense key.
function osDateFromQuery() {
  try {
    const value = new URLSearchParams(window.location.search).get('date');
    return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : null;
  } catch (e) {
    return null;
  }
}

// Home-screen shortcuts (manifest.json) arrive as ?action=... . Consumed
// once per page load, so switching tabs and back doesn't reopen anything.
let osPendingAction = (() => {
  try {
    const a = new URLSearchParams(window.location.search).get('action');
    return a === 'close-day' || a === 'log-training' ? a : null;
  } catch (e) {
    return null;
  }
})();

function osRunPendingAction(tab) {
  if (osPendingAction === 'close-day' && tab === 'today') {
    osPendingAction = null;
    const record = DAILY.getDay(dailyCurrentDate());
    if (!record.closed) {
      dailyClosingStep = 0;
      renderDailyCloseFlow();
    }
  } else if (osPendingAction === 'log-training' && tab === 'training') {
    osPendingAction = null;
    const form = document.getElementById('wk-log-form');
    if (form) {
      form.scrollIntoView({ block: 'start' });
      // Open the first exercise and land on its first set field, so the
      // shortcut arrives ready to type rather than on a closed row.
      const first = form.querySelector('.wk-exercise');
      if (first) first.open = true;
      const field = form.querySelector('[data-wk-key]');
      if (field) field.focus({ preventScroll: true });
    }
  }
}

// Training now renders from the rebuilt model (program.js + workout.js +
// workout-ui.js). dashboard_data/training.json is still fetched, but only as a
// migration source: it is where sessions logged on another device under the old
// flat model ended up, and they have to be pulled into the new shape before the
// screen can show them. Nothing writes it.

// Whether Today has been rendered yet in this page load; see render().
let osTodayVisited = false;

let osTrainingPayload = null;
let osTrainingFetched = false;
let osTrainingMigrated = false;

function osRenderTraining() {
  const mount = document.getElementById('panel-training');
  if (!mount) return;

  if (!osTrainingFetched) {
    osTrainingFetched = true;
    DASHBOARD.fetchOne('training').then(payload => {
      osTrainingPayload = payload;
      // The old log may exist only in the published feed, so the migration
      // runs again once it lands. migrateLegacyTraining is idempotent.
      workoutMigrateOnce(payload);
      renderWorkoutZone();
      osRunPendingAction('training');
      // The old log may also still live only on the sync server, which is now
      // the reliable source since training.json left the public tier.
      workoutMigrateFromServer()
        .then(() => WORKOUT.syncWithServer())
        .then(state => { if (state) renderWorkoutZone(); });
    });
    // Render immediately from local data so the screen is never blank while
    // the feed is in flight.
    if (!osTrainingMigrated) { osTrainingMigrated = true; workoutMigrateOnce(null); }
    renderWorkoutZone();
    return;
  }
  renderWorkoutZone();
}

var osPainpointsPayload = null;
var osPainpointsFetched = false;
var osPainpointsLang = 'he';

const OS_TAB_TITLES = {
  training: 'Training',
  insights: 'Insights',
  memory: 'Memory',
  history: 'History',
  painpoints: STRINGS.shell.tabs.painpoints,
};

const osShell = mountShell({
  areaId: 'os',
  // Today draws its own greeting as the screen title, so the shell's title
  // slot stays empty there rather than repeating it.
  titleFor: tab => (OS_TAB_TITLES[tab] ? shellTitleHtml(OS_TAB_TITLES[tab], tab) : ''),
  render(tab) {
    if (tab === 'today') {
      // ?date= is read once, on the first visit to Today in this page load
      // (History's "edit this day" links into it). After that the screen's
      // own date navigation owns the selection, so switching to Training and
      // back returns to the day you were editing rather than snapping to
      // today.
      if (!osTodayVisited) {
        osTodayVisited = true;
        dailySetActiveDate(osDateFromQuery());
      }
      renderDailyToday();
      dailyTriggerSync();
      osRunPendingAction(tab);
      return;
    }
    if (tab === 'training') {
      const settled = osTrainingFetched;   // feed already in hand: act now
      osRenderTraining();
      if (settled) osRunPendingAction(tab);
      return;
    }
    if (tab === 'painpoints') { osRenderPainpoints(); return; }
    osActiveTab = tab;
    renderOsActiveTab();
    osTriggerSync();
  },
});


function osEnsurePainpointsMount() {
  let mount = document.getElementById('panel-painpoints');
  if (!mount) {
    const body = document.querySelector('.shell-body');
    if (body) {
      mount = document.createElement('section');
      mount.setAttribute('data-shell-panel', 'painpoints');
      mount.id = 'panel-painpoints';
      const strip = document.getElementById('health-strip');
      body.insertBefore(mount, strip || null);
    }
  }
  return mount;
}

function osRenderPainpoints() {
  const mount = osEnsurePainpointsMount();
  if (!mount) return;
  mount.hidden = false;
  if (!osPainpointsFetched) {
    osPainpointsFetched = true;
    fetch('dashboard_data/painpoints.json?t=' + Date.now(), { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(payload => {
        osPainpointsPayload = payload || OS_PAINPOINTS_FALLBACK;
        osPaintPainpoints(mount, payload);
      });
    osPaintPainpoints(mount, osPainpointsPayload);
    return;
  }
  osPaintPainpoints(mount, osPainpointsPayload);
}

function osPaintPainpoints(mount, data) {
  const S = STRINGS.painpoints;
  if (!data || !Array.isArray(data.clusters) || !data.clusters.length) {
    mount.innerHTML = `
      <div class="ghost-state">
        <p class="ghost-heading">${escapeHtml(S.ghostHeading)}</p>
        <p class="ghost-sub">${escapeHtml(S.ghostSub)}</p>
      </div>`;
    return;
  }

  const isHe = osPainpointsLang === 'he';
  const dirAttr = isHe ? 'dir="rtl"' : 'dir="ltr"';
  const stats = data.stats || {};
  const bySource = stats.by_source
    ? Object.entries(stats.by_source).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`).join(' · ')
    : '';
  const summary = isHe ? (data.summary_he || data.summary_en || '') : (data.summary_en || data.summary_he || '');

  mount.innerHTML = `
    <div class="pp-toolbar">
      <div class="sec-label">${escapeHtml(S.weekLabel(data.week || '', data.date || ''))}${bySource ? ` · ${bySource}` : ''}</div>
      <div class="pp-lang-switch">
        <button type="button" class="os-btn ${isHe ? 'is-active' : ''}" data-pp-lang="he">${escapeHtml(S.langToggleHe)}</button>
        <button type="button" class="os-btn ${!isHe ? 'is-active' : ''}" data-pp-lang="en">${escapeHtml(S.langToggleEn)}</button>
      </div>
    </div>

    <div class="pp-stats-grid">
      <div class="pp-stat-box">
        <div class="sec-label">${escapeHtml(S.stats.raw)}</div>
        <div class="pp-stat-num">${escapeHtml(String(stats.raw ?? 0))}</div>
      </div>
      <div class="pp-stat-box">
        <div class="sec-label">${escapeHtml(S.stats.analyzed)}</div>
        <div class="pp-stat-num">${escapeHtml(String(stats.analyzed ?? 0))}</div>
      </div>
      <div class="pp-stat-box">
        <div class="sec-label">${escapeHtml(S.stats.pains)}</div>
        <div class="pp-stat-num is-accent">${escapeHtml(String(stats.pains ?? 0))}</div>
      </div>
      <div class="pp-stat-box">
        <div class="sec-label">${escapeHtml(S.stats.sources)}</div>
        <div class="pp-stat-num is-up">${escapeHtml(String(stats.sources ?? 0))}</div>
      </div>
    </div>

    ${summary ? `<p class="pp-summary" ${dirAttr}>${escapeHtml(summary)}</p>` : ''}

    <div class="pp-cluster-list">
      ${data.clusters.map(c => {
        const title = isHe ? (c.title_he || c.title_en) : (c.title_en || c.title_he);
        const who = isHe ? (c.who_he || c.who_en) : (c.who_en || c.who_he);
        const quote = isHe ? (c.quote_he || c.quote_en) : (c.quote_en || c.quote_he);
        const solution = isHe ? (c.solution_he || c.solution_en) : (c.solution_en || c.solution_he);
        const mvp = isHe ? (c.mvp_he || c.mvp_en) : (c.mvp_en || c.mvp_he);
        const pricing = isHe ? (c.pricing_he || c.pricing_en) : (c.pricing_en || c.pricing_he);
        const stack = isHe ? (c.tech_stack_he || c.tech_stack_en) : (c.tech_stack_en || c.tech_stack_he);
        const avgScore = Math.round(((c.intensity || 0) + (c.frequency || 0) + (c.ease_of_build || 0) + (c.low_competition || 0)) / 4);
        const sourcesList = Array.isArray(c.sources) ? c.sources.join(' · ') : '';
        const competitors = Array.isArray(c.competitors) ? c.competitors : [];

        return `
          <article class="pp-cluster-card" ${dirAttr}>
            <div class="pp-cluster-head" dir="ltr">
              <span class="pp-badge-cat">${escapeHtml(c.category || '')}</span>
              <span class="pp-badge-sources">${escapeHtml(sourcesList)} · ${escapeHtml(S.metrics.mentions(c.mentions || 0))}</span>
              <span class="pp-badge-score">${escapeHtml(String(avgScore))}</span>
            </div>
            <h2 class="pp-cluster-title">${escapeHtml(title || '')}</h2>
            ${who ? `<div class="pp-cluster-who"><strong>${escapeHtml(S.whoLabel)}:</strong> ${escapeHtml(who)}</div>` : ''}
            ${quote ? `<blockquote class="pp-cluster-quote">"${escapeHtml(quote)}"${c.quote_url ? ` <a href="${escapeHtml(c.quote_url)}" target="_blank" rel="noopener noreferrer" class="pp-quote-link">${escapeHtml(S.sourceLinkLabel)} &rarr;</a>` : ''}</blockquote>` : ''}
            <div class="pp-cluster-mvp">
              <div class="pp-mvp-row"><strong>${escapeHtml(S.solutionLabel)}:</strong> ${escapeHtml(solution || '')}</div>
              <div class="pp-mvp-row"><strong>${escapeHtml(S.mvpLabel)}:</strong> ${escapeHtml(mvp || '')}</div>
              <div class="pp-mvp-meta">
                ${pricing ? `<span><strong>${escapeHtml(S.pricingLabel)}:</strong> ${escapeHtml(pricing)}</span>` : ''}
                ${stack ? `<span><strong>${escapeHtml(S.stackLabel)}:</strong> ${escapeHtml(stack)}</span>` : ''}
              </div>
            </div>
            ${competitors.length ? `
              <div class="pp-competitors">
                <div class="sec-label">${escapeHtml(S.competitorsLabel)}</div>
                <div class="pp-comp-list">
                  ${competitors.map(comp => `
                    <div class="pp-comp-item">
                      <strong>${escapeHtml(comp.name || '')}:</strong> ${escapeHtml(isHe ? (comp.gap_he || comp.gap_en || '') : (comp.gap_en || comp.gap_he || ''))}
                    </div>`).join('')}
                </div>
              </div>` : ''}
            <div class="pp-metrics-bar" dir="ltr">
              <div class="pp-metric-cell"><span class="pp-m-num">${escapeHtml(String(c.intensity ?? 0))}</span><span class="pp-m-lbl">${escapeHtml(S.metrics.intensity)}</span></div>
              <div class="pp-metric-cell"><span class="pp-m-num">${escapeHtml(String(c.frequency ?? 0))}</span><span class="pp-m-lbl">${escapeHtml(S.metrics.frequency)}</span></div>
              <div class="pp-metric-cell"><span class="pp-m-num">${escapeHtml(String(c.ease_of_build ?? 0))}</span><span class="pp-m-lbl">${escapeHtml(S.metrics.ease)}</span></div>
              <div class="pp-metric-cell"><span class="pp-m-num">${escapeHtml(String(c.low_competition ?? 0))}</span><span class="pp-m-lbl">${escapeHtml(S.metrics.competition)}</span></div>
            </div>
          </article>`;
      }).join('')}
    </div>`;

  mount.querySelectorAll('[data-pp-lang]').forEach(btn => {
    btn.addEventListener('click', () => {
      osPainpointsLang = btn.dataset.ppLang;
      osPaintPainpoints(mount, data);
    });
  });
}
