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
var osPainpointsTrack = 'all';

const OS_TAB_TITLES = {
  training: 'Training',
  insights: 'Insights',
  memory: 'Memory',
  history: 'History',
  painpoints: STRINGS.shell.tabs.painpoints,
  jobs: STRINGS.shell.tabs.jobs,
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
    if (tab === 'painpoints') {
      const jb = document.getElementById('panel-jobs'); if (jb) jb.hidden = true;
      const cn = document.getElementById('panel-content'); if (cn) cn.hidden = true;
      osRenderPainpoints();
      return;
    }
    if (tab === 'jobs') {
      const pp = document.getElementById('panel-painpoints'); if (pp) pp.hidden = true;
      const cn = document.getElementById('panel-content'); if (cn) cn.hidden = true;
      osRenderJobs();
      return;
    }
    if (tab === 'content') {
      const pp = document.getElementById('panel-painpoints'); if (pp) pp.hidden = true;
      const jb = document.getElementById('panel-jobs'); if (jb) jb.hidden = true;
      osRenderContent();
      return;
    }
    const pp = document.getElementById('panel-painpoints'); if (pp) pp.hidden = true;
    const jb = document.getElementById('panel-jobs'); if (jb) jb.hidden = true;
    const cn = document.getElementById('panel-content'); if (cn) cn.hidden = true;
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
        osPainpointsPayload = payload;
        osPaintPainpoints(mount, payload);
      });
  }
  osPaintPainpoints(mount, osPainpointsPayload);
}

function osPpTrack(c) {
  return c && c.track === 'lowtech' ? 'lowtech' : 'saas';
}

function osPpPick(c, key, isHe) {
  return isHe ? (c[key + '_he'] || c[key + '_en'] || '') : (c[key + '_en'] || c[key + '_he'] || '');
}

function osPpRow(label, value) {
  if (!value) return '';
  return `<div class="pp-mvp-row"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`;
}

function osPpCardHtml(c, isHe, dirAttr) {
  const S = STRINGS.painpoints;
  const track = osPpTrack(c);
  const isLow = track === 'lowtech';
  const title = osPpPick(c, 'title', isHe);
  const who = osPpPick(c, 'who', isHe);
  const quote = osPpPick(c, 'quote', isHe);
  const solution = osPpPick(c, 'solution', isHe);
  const score = typeof c.score === 'number' ? c.score
    : Math.round(((c.intensity || 0) + (c.frequency || 0) + (c.ease_of_build || 0) + (c.low_competition || 0)) / 4);
  const sourcesList = Array.isArray(c.sources) ? c.sources.join(' ? ') : '';
  const competitors = Array.isArray(c.competitors) ? c.competitors : [];

  let body;
  if (isLow) {
    const L = S.lowtech;
    const capital = [typeof c.startup_capital_usd === 'number' ? L.capitalValue(c.startup_capital_usd) : '',
      osPpPick(c, 'startup_capital', isHe)].filter(Boolean).join(' ? ');
    const pricing = [osPpPick(c, 'pricing', isHe),
      typeof c.gross_margin_pct === 'number' ? L.margin(c.gross_margin_pct) : ''].filter(Boolean).join(' ? ');
    body = `
      <div class="pp-cluster-mvp">
        ${osPpRow(S.solutionLabel, solution)}
        ${osPpRow(L.roles, osPpPick(c, 'roles_to_hire', isHe))}
        ${osPpRow(L.ai, osPpPick(c, 'ai_leverage', isHe))}
      </div>
      <div class="pp-lt-grid">
        ${osPpRow(L.capital, capital)}
        ${osPpRow(L.equipment, osPpPick(c, 'equipment_licensing', isHe))}
        ${osPpRow(L.pricing, pricing)}
        ${osPpRow(L.firstCustomers, osPpPick(c, 'first_customers', isHe))}
        ${osPpRow(L.moat, osPpPick(c, 'moat', isHe))}
        ${osPpRow(L.pilot, osPpPick(c, 'launch_plan', isHe))}
      </div>`;
  } else {
    const pricing = osPpPick(c, 'pricing', isHe);
    const stack = osPpPick(c, 'tech_stack', isHe);
    body = `
      <div class="pp-cluster-mvp">
        ${osPpRow(S.solutionLabel, solution)}
        ${osPpRow(S.mvpLabel, osPpPick(c, 'mvp', isHe))}
        <div class="pp-mvp-meta">
          ${pricing ? `<span><strong>${escapeHtml(S.pricingLabel)}:</strong> ${escapeHtml(pricing)}</span>` : ''}
          ${stack ? `<span><strong>${escapeHtml(S.stackLabel)}:</strong> ${escapeHtml(stack)}</span>` : ''}
        </div>
      </div>`;
  }

  const extraBadges = isLow ? [
    c.delivery_model && S.delivery[c.delivery_model],
    c.market && S.market[c.market],
  ].filter(Boolean).map(t => `<span class="pp-badge-meta">${escapeHtml(t)}</span>`).join('') : '';

  return `
    <article class="pp-cluster-card${isLow ? ' is-lowtech' : ''}" ${dirAttr}>
      <div class="pp-cluster-head" dir="ltr">
        <span class="pp-badge-track is-${track}">${escapeHtml(S.trackBadge[track])}</span>
        <span class="pp-badge-cat">${escapeHtml(c.category || '')}</span>
        ${extraBadges}
        <span class="pp-badge-sources">${escapeHtml(sourcesList)} ? ${escapeHtml(S.metrics.mentions(c.mentions || 0))}</span>
        <span class="pp-badge-score">${escapeHtml(String(score))}</span>
      </div>
      <h2 class="pp-cluster-title">${escapeHtml(title)}</h2>
      ${who ? `<div class="pp-cluster-who"><strong>${escapeHtml(S.whoLabel)}:</strong> ${escapeHtml(who)}</div>` : ''}
      ${quote ? `<blockquote class="pp-cluster-quote">"${escapeHtml(quote)}"${c.quote_url ? ` <a href="${escapeHtml(c.quote_url)}" target="_blank" rel="noopener noreferrer" class="pp-quote-link">${escapeHtml(S.sourceLinkLabel)} &rarr;</a>` : ''}</blockquote>` : ''}
      ${body}
      ${competitors.length ? `
        <div class="pp-competitors">
          <div class="sec-label">${escapeHtml(S.competitorsLabel)}</div>
          <div class="pp-comp-list">
            ${competitors.map(comp => `
              <div class="pp-comp-item"><strong>${escapeHtml(comp.name || '')}:</strong> ${escapeHtml(isHe ? (comp.gap_he || comp.gap_en || '') : (comp.gap_en || comp.gap_he || ''))}</div>`).join('')}
          </div>
        </div>` : ''}
      <div class="pp-metrics-bar" dir="ltr">
        <div class="pp-metric-cell"><span class="pp-m-num">${escapeHtml(String(c.intensity ?? 0))}</span><span class="pp-m-lbl">${escapeHtml(S.metrics.intensity)}</span></div>
        <div class="pp-metric-cell"><span class="pp-m-num">${escapeHtml(String(c.frequency ?? 0))}</span><span class="pp-m-lbl">${escapeHtml(S.metrics.frequency)}</span></div>
        <div class="pp-metric-cell"><span class="pp-m-num">${escapeHtml(String(c.ease_of_build ?? 0))}</span><span class="pp-m-lbl">${escapeHtml(isLow ? S.lowtech.launchEase : S.metrics.ease)}</span></div>
        <div class="pp-metric-cell"><span class="pp-m-num">${escapeHtml(String(c.low_competition ?? 0))}</span><span class="pp-m-lbl">${escapeHtml(S.metrics.competition)}</span></div>
      </div>
    </article>`;
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
    ? Object.entries(stats.by_source).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`).join(' ? ')
    : '';
  const counts = { all: data.clusters.length, saas: 0, lowtech: 0 };
  data.clusters.forEach(c => { counts[osPpTrack(c)] += 1; });
  const track = osPainpointsTrack;
  const shown = track === 'all' ? data.clusters : data.clusters.filter(c => osPpTrack(c) === track);

  const sumMain = isHe ? (data.summary_he || data.summary_en || '') : (data.summary_en || data.summary_he || '');
  const sumLow = isHe ? (data.summary_lowtech_he || data.summary_lowtech_en || '') : (data.summary_lowtech_en || data.summary_lowtech_he || '');
  const summaries = track === 'saas' ? [sumMain] : track === 'lowtech' ? [sumLow] : [sumMain, sumLow];

  mount.innerHTML = `
    <div class="pp-toolbar">
      <div class="sec-label">${escapeHtml(S.weekLabel(data.week || '', data.date || ''))}${bySource ? ` ? ${bySource}` : ''}</div>
      <div class="pp-lang-switch">
        <button type="button" class="os-btn ${isHe ? 'is-active' : ''}" data-pp-lang="he">${escapeHtml(S.langToggleHe)}</button>
        <button type="button" class="os-btn ${!isHe ? 'is-active' : ''}" data-pp-lang="en">${escapeHtml(S.langToggleEn)}</button>
      </div>
    </div>

    <div class="os-window-tabs pp-track-tabs" role="tablist">
      ${['all', 'saas', 'lowtech'].map(k => `
        <button type="button" role="tab" aria-selected="${k === track}" class="os-window-btn${k === track ? ' is-active' : ''}" data-pp-track="${k}">
          ${escapeHtml(S.filters[k])} <span class="pp-track-count mono">${escapeHtml(S.filters.count(counts[k]))}</span>
        </button>`).join('')}
    </div>

    <div class="pp-stats-grid">
      <div class="pp-stat-box"><div class="sec-label">${escapeHtml(S.stats.raw)}</div><div class="pp-stat-num">${escapeHtml(String(stats.raw ?? 0))}</div></div>
      <div class="pp-stat-box"><div class="sec-label">${escapeHtml(S.stats.analyzed)}</div><div class="pp-stat-num">${escapeHtml(String(stats.analyzed ?? 0))}</div></div>
      <div class="pp-stat-box"><div class="sec-label">${escapeHtml(S.stats.pains)}</div><div class="pp-stat-num is-accent">${escapeHtml(String(stats.pains ?? 0))}</div></div>
      <div class="pp-stat-box"><div class="sec-label">${escapeHtml(S.stats.sources)}</div><div class="pp-stat-num is-up">${escapeHtml(String(stats.sources ?? 0))}</div></div>
    </div>

    ${summaries.filter(Boolean).map(s => `<p class="pp-summary" ${dirAttr}>${escapeHtml(s)}</p>`).join('')}

    <div class="pp-cluster-list">
      ${shown.length ? shown.map(c => osPpCardHtml(c, isHe, dirAttr)).join('')
        : `<div class="empty-state">${escapeHtml(S.filterEmpty)}</div>`}
    </div>`;

  mount.querySelectorAll('[data-pp-lang]').forEach(btn => {
    btn.addEventListener('click', () => {
      osPainpointsLang = btn.dataset.ppLang;
      osPaintPainpoints(mount, data);
    });
  });
  mount.querySelectorAll('[data-pp-track]').forEach(btn => {
    btn.addEventListener('click', () => {
      osPainpointsTrack = btn.dataset.ppTrack;
      osPaintPainpoints(mount, data);
    });
  });
}


// -----------------------------------------------------------------------------
// Gigs & Jobs (Upwork & Freelance Scanner)
// -----------------------------------------------------------------------------

var osJobsPayload = null;
var osJobsFetched = false;
var osJobsFilter = 'all';
var osJobsBudgetFilter = 'all';

function osEnsureJobsMount() {
  let mount = document.getElementById('panel-jobs');
  if (!mount) {
    const body = document.querySelector('.shell-body');
    if (body) {
      mount = document.createElement('section');
      mount.setAttribute('data-shell-panel', 'jobs');
      mount.id = 'panel-jobs';
      const strip = document.getElementById('health-strip');
      body.insertBefore(mount, strip || null);
    }
  }
  return mount;
}

function osRenderJobs() {
  const mount = osEnsureJobsMount();
  if (!mount) return;
  mount.hidden = false;
  if (!osJobsFetched) {
    osJobsFetched = true;
    fetch('dashboard_data/jobs.json?t=' + Date.now(), { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(payload => {
        osJobsPayload = payload;
        osPaintJobs(mount, payload);
      })
      .catch(() => osPaintJobs(mount, null));
  } else {
    osPaintJobs(mount, osJobsPayload);
  }
}

function osJobCardHtml(job) {
  const JOBS_S = STRINGS.jobs;
  const matchPct = job.match_score || 85;
  const isTopMatch = matchPct >= 95;
  const budget = job.budget || '$150';
  const platform = job.platform || 'Upwork';
  const track = job.track || 'ai_automation';
  const skills = Array.isArray(job.skills) ? job.skills : [];
  const jobId = String(job.id || Math.random().toString(36).slice(2));

  return `
    <article class="job-card${isTopMatch ? ' is-top-match' : ''}" data-job-track="${escapeHtml(track)}">
      <div class="job-card-head">
        <div class="job-badges">
          ${isTopMatch ? `<span class="job-badge-top mono">${escapeHtml(JOBS_S.labels.topMatch)}</span>` : ''}
          <span class="job-badge-match mono">${escapeHtml(JOBS_S.labels.matchScore(matchPct))}</span>
          <span class="job-badge-platform">${escapeHtml(platform)}</span>
          <span class="job-badge-budget mono">${escapeHtml(budget)}</span>
        </div>
        <div class="job-posted mono">${escapeHtml(job.posted_at || '')}</div>
      </div>

      <h3 class="job-title">${escapeHtml(job.title || '')}</h3>

      <div class="job-client-need">
        <span class="job-field-label">${escapeHtml(JOBS_S.labels.clientNeed)}:</span>
        <span class="job-field-body">${escapeHtml(job.client_problem || '')}</span>
      </div>

      ${skills.length ? `
        <div class="job-skills-list">
          ${skills.map(s => `<span class="job-skill-pill">${escapeHtml(s)}</span>`).join('')}
        </div>
      ` : ''}

      <div class="job-actions-row">
        <a class="job-open-link" href="${escapeHtml(job.url || 'https://www.upwork.com')}" target="_blank" rel="noopener">
          ${escapeHtml(JOBS_S.labels.openListing)} &rarr;
        </a>
        <button type="button" class="job-toggle-proposal-btn" data-proposal-toggle="${escapeHtml(jobId)}">
          ${escapeHtml(JOBS_S.labels.proposalDraft)} <span class="job-chevron">&#9662;</span>
        </button>
      </div>

      <div class="job-proposal-drawer" id="job-proposal-${escapeHtml(jobId)}" hidden>
        <div class="job-proposal-header">
          <span class="job-proposal-title">${escapeHtml(JOBS_S.labels.proposalDraft)}</span>
          <button type="button" class="job-copy-btn" data-job-id="${escapeHtml(jobId)}">
            ${escapeHtml(JOBS_S.labels.copyProposal)}
          </button>
        </div>
        <pre class="job-proposal-text" id="job-proposal-text-${escapeHtml(jobId)}">${escapeHtml(job.proposal_draft || '')}</pre>
      </div>
    </article>
  `;
}

function osPaintJobs(mount, data) {
  const JOBS_S = STRINGS.jobs;
  if (!data || !Array.isArray(data.jobs) || !data.jobs.length) {
    mount.innerHTML = `
      <div class="pp-ghost">
        <h2 class="serif pp-ghost-title">${escapeHtml(JOBS_S.ghostHeading)}</h2>
        <p class="pp-ghost-sub">${escapeHtml(JOBS_S.ghostSub)}</p>
      </div>`;
    return;
  }

  const jobs = data.jobs;
  const stats = data.stats || {};
  const filter = osJobsFilter;
  const budgetFilter = osJobsBudgetFilter;
  const counts = {
    all: jobs.length,
    ai_automation: stats.ai_count || jobs.filter(j => j.track === 'ai_automation').length,
    cyber_soc: stats.cyber_count || jobs.filter(j => j.track === 'cyber_soc').length,
    scraping_data: stats.scraping_count || jobs.filter(j => j.track === 'scraping_data').length,
  };

  const filtered = jobs.filter(j => {
    const matchTrack = filter === 'all' || j.track === filter;
    const jType = j.job_type || (j.budget && j.budget.indexOf('/hr') !== -1 ? 'hourly' : 'fixed');
    const matchBudget = budgetFilter === 'all' || jType === budgetFilter;
    return matchTrack && matchBudget;
  });

  mount.innerHTML = `
    <div class="pp-toolbar">
      <div class="sec-label">${escapeHtml(JOBS_S.stats.scanned)}: ${escapeHtml(String(stats.total_scanned || jobs.length))}</div>
    </div>

    <div class="os-window-tabs pp-track-tabs" role="tablist">
      ${['all', 'ai_automation', 'cyber_soc', 'scraping_data'].map(k => `
        <button type="button" role="tab" aria-selected="${k === filter}" class="os-window-btn${k === filter ? ' is-active' : ''}" data-job-filter="${k}">
          ${escapeHtml(JOBS_S.filters[k])} <span class="pp-track-count mono">${escapeHtml(JOBS_S.filters.count(counts[k] || 0))}</span>
        </button>`).join('')}
    </div>

    <div class="job-subfilters" role="tablist">
      ${['all', 'fixed', 'hourly'].map(b => `
        <button type="button" role="tab" aria-selected="${b === budgetFilter}" class="job-subfilter-btn${b === budgetFilter ? ' is-active' : ''}" data-job-budget-filter="${b}">
          ${escapeHtml(JOBS_S.budgetFilters[b])}
        </button>`).join('')}
    </div>

    <div class="pp-stats-grid">
      <div class="pp-stat-box"><div class="sec-label">${escapeHtml(JOBS_S.stats.scanned)}</div><div class="pp-stat-val mono">${escapeHtml(String(stats.total_scanned || jobs.length))}</div></div>
      <div class="pp-stat-box"><div class="sec-label">${escapeHtml(JOBS_S.stats.matched)}</div><div class="pp-stat-val mono">${escapeHtml(String(counts.all))}</div></div>
      <div class="pp-stat-box"><div class="sec-label">${escapeHtml(JOBS_S.stats.ai)}</div><div class="pp-stat-val mono">${escapeHtml(String(counts.ai_automation))}</div></div>
      <div class="pp-stat-box"><div class="sec-label">${escapeHtml(JOBS_S.stats.cyber)}</div><div class="pp-stat-val mono">${escapeHtml(String(counts.cyber_soc))}</div></div>
    </div>

    <div class="job-list">
      ${filtered.length ? filtered.map(j => osJobCardHtml(j)).join('')
        : `<div class="empty-state">${escapeHtml(JOBS_S.filterEmpty)}</div>`}
    </div>
  `;

  // Filter click handlers
  mount.querySelectorAll('[data-job-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      osJobsFilter = btn.dataset.jobFilter;
      osPaintJobs(mount, data);
    });
  });

  // Budget filter click handlers
  mount.querySelectorAll('[data-job-budget-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      osJobsBudgetFilter = btn.dataset.jobBudgetFilter;
      osPaintJobs(mount, data);
    });
  });

  // Proposal toggle handlers
  mount.querySelectorAll('[data-proposal-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.proposalToggle;
      const drawer = mount.querySelector('#job-proposal-' + id);
      if (drawer) {
        drawer.hidden = !drawer.hidden;
        btn.classList.toggle('is-open', !drawer.hidden);
      }
    });
  });

  // Copy proposal handlers
  mount.querySelectorAll('.job-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.jobId;
      const textEl = mount.querySelector('#job-proposal-text-' + id);
      if (textEl && navigator.clipboard) {
        navigator.clipboard.writeText(textEl.textContent).then(() => {
          const original = btn.textContent;
          btn.textContent = JOBS_S.labels.copied;
          btn.classList.add('is-copied');
          setTimeout(() => {
            btn.textContent = original;
            btn.classList.remove('is-copied');
          }, 2000);
        });
      }
    });
  });
}

/* --- Content Creator / LinkedIn Agent --------------------------------- */
var osContentPayload = null;
var osContentFetched = false;
var osContentFilter = 'all';

function osEnsureContentMount() {
  let mount = document.getElementById('panel-content');
  if (!mount) {
    const body = document.querySelector('.shell-body');
    if (body) {
      mount = document.createElement('section');
      mount.setAttribute('data-shell-panel', 'content');
      mount.id = 'panel-content';
      const strip = document.getElementById('health-strip');
      body.insertBefore(mount, strip || null);
    }
  }
  return mount;
}

function osRenderContent() {
  const mount = osEnsureContentMount();
  if (!mount) return;
  mount.hidden = false;
  const pp = document.getElementById('panel-painpoints'); if (pp) pp.hidden = true;
  const jb = document.getElementById('panel-jobs'); if (jb) jb.hidden = true;

  if (!osContentFetched) {
    osContentFetched = true;
    fetch('dashboard_data/linkedin_posts.json?t=' + Date.now(), { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(payload => {
        osContentPayload = payload;
        osPaintContent(mount, payload);
      })
      .catch(() => osPaintContent(mount, null));
  } else {
    osPaintContent(mount, osContentPayload);
  }
}

function osContentCardHtml(post) {
  const CONTENT_S = STRINGS.content;
  const category = post.category || 'cyber_soc';
  const categoryLabels = {
    cyber_soc: 'Cyber & SOC',
    ai_agents: 'AI & Agents',
    automation: 'Automation',
    tech_dev: 'Tech & Dev'
  };
  const categoryLabel = categoryLabels[category] || category;
  const postId = String(post.id || Math.random().toString(36).slice(2));

  return `
    <article class="content-card" data-content-track="${escapeHtml(category)}">
      <div class="content-card-head">
        <div class="content-badges">
          <span class="content-badge-cat mono">${escapeHtml(categoryLabel)}</span>
          <span class="content-badge-platform">${escapeHtml(post.source_platform || 'Tech News')}</span>
        </div>
        <div class="content-posted mono">${escapeHtml(post.posted_at || 'Today')}</div>
      </div>

      <h3 class="content-title">${escapeHtml(post.topic || '')}</h3>

      <div class="content-intel-box">
        <div class="content-intel-head">
          <span class="content-intel-kicker">${escapeHtml(CONTENT_S.labels.credibility)}:</span>
          <span class="content-intel-score mono">${escapeHtml(post.credibility_score || '9/10')}</span>
        </div>
        <p class="content-intel-rationale">${escapeHtml(post.credibility_rationale || '')}</p>
      </div>

      <div class="content-post-box" dir="rtl">
        <div class="content-post-header">
          <span class="content-post-badge">${escapeHtml(CONTENT_S.labels.draftedPost)}</span>
          <button type="button" class="content-copy-btn" data-post-id="${escapeHtml(postId)}">
            ${escapeHtml(CONTENT_S.labels.copyPost)}
          </button>
        </div>
        <pre class="content-post-text" id="post-text-${escapeHtml(postId)}">${escapeHtml(post.linkedin_post || '')}</pre>
      </div>

      <div class="content-actions-row">
        <a class="content-source-link" href="${escapeHtml(post.source_url || '#')}" target="_blank" rel="noopener">
          ${escapeHtml(CONTENT_S.labels.openSource)} &rarr;
        </a>
        <a class="content-linkedin-link" href="https://www.linkedin.com/feed/" target="_blank" rel="noopener">
          ${escapeHtml(CONTENT_S.labels.openLinkedIn)} &rarr;
        </a>
      </div>
    </article>
  `;
}

function osPaintContent(mount, data) {
  const CONTENT_S = STRINGS.content;
  if (!data || !Array.isArray(data.posts) || !data.posts.length) {
    mount.innerHTML = `
      <div class="pp-ghost">
        <h2 class="serif pp-ghost-title">${escapeHtml(CONTENT_S.ghostHeading)}</h2>
        <p class="pp-ghost-sub">${escapeHtml(CONTENT_S.ghostSub)}</p>
      </div>
    `;
    return;
  }

  const posts = data.posts;
  const stats = data.stats || {};
  const totalDrafted = stats.total_drafted || posts.length;
  const cyberCount = stats.cyber_count || posts.filter(p => p.category === 'cyber_soc').length;
  const aiCount = stats.ai_count || posts.filter(p => p.category === 'ai_agents').length;

  const filteredPosts = posts.filter(p => {
    if (osContentFilter === 'all') return true;
    return p.category === osContentFilter;
  });

  const filterKeys = [
    ['all', CONTENT_S.filters.all, totalDrafted],
    ['cyber_soc', CONTENT_S.filters.cyber_soc, cyberCount],
    ['ai_agents', CONTENT_S.filters.ai_agents, aiCount],
  ];

  mount.innerHTML = `
    <div class="jobs-summary-strip">
      <div class="jobs-stat">
        <span class="jobs-stat-label">${escapeHtml(CONTENT_S.stats.total)}</span>
        <span class="jobs-stat-value mono">${totalDrafted}</span>
      </div>
      <div class="jobs-stat">
        <span class="jobs-stat-label">${escapeHtml(CONTENT_S.stats.cyber)}</span>
        <span class="jobs-stat-value mono">${cyberCount}</span>
      </div>
      <div class="jobs-stat">
        <span class="jobs-stat-label">${escapeHtml(CONTENT_S.stats.ai)}</span>
        <span class="jobs-stat-value mono">${aiCount}</span>
      </div>
    </div>

    <div class="pp-track-pills">
      ${filterKeys.map(([k, label, count]) => `
        <button type="button" class="pp-pill ${osContentFilter === k ? 'is-active' : ''}" data-content-filter="${escapeHtml(k)}">
          <span>${escapeHtml(label)}</span>
          <span class="pp-pill-count mono">${count}</span>
        </button>
      `).join('')}
    </div>

    <div class="content-feed">
      ${filteredPosts.length ? filteredPosts.map(osContentCardHtml).join('') : `<p class="pp-filter-empty">${escapeHtml(CONTENT_S.ghostSub)}</p>`}
    </div>
  `;

  // Filter button handlers
  mount.querySelectorAll('[data-content-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      osContentFilter = btn.dataset.contentFilter;
      osPaintContent(mount, data);
    });
  });

  // Copy post handlers
  mount.querySelectorAll('.content-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.postId;
      const textEl = mount.querySelector('#post-text-' + id);
      if (textEl && navigator.clipboard) {
        navigator.clipboard.writeText(textEl.textContent).then(() => {
          const original = btn.textContent;
          btn.textContent = CONTENT_S.labels.copied;
          btn.classList.add('is-copied');
          setTimeout(() => {
            btn.textContent = original;
            btn.classList.remove('is-copied');
          }, 2000);
        });
      }
    });
  });
}
