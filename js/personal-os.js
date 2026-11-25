// Personal OS — the page controller.
//
// Owns nothing but wiring: mountShell (shell.js) draws the chrome and tells
// this which sub-tab is active; this calls the renderer that owns that tab.
// The renderers themselves live where their concern does — daily-today.js,
// training.js, os.js — so moving Training under Personal OS was a routing
// change here rather than a rewrite there.

function isAllowedSyncOrigin(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const u = new URL(rawUrl.trim());
    if (u.username || u.password) return false;
    if (u.protocol === 'https:' && (/^[a-z0-9-]+\.up\.railway\.app$/i.test(u.hostname) || /^[a-z0-9.-]+\.workers\.dev$/i.test(u.hostname))) return true;
    if ((u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
      return true;
    }
  } catch (e) {}
  return false;
}

function safeExternalUrl(rawUrl, fallback) {
  const fb = fallback || '#';
  if (!rawUrl || typeof rawUrl !== 'string') return fb;
  try {
    const u = new URL(rawUrl.trim());
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
  } catch (e) {}
  return fb;
}

// Check URL hash (preferred) or search params for 1-click cloud sync configuration
(function checkUrlSyncPairing() {
  try {
    if (typeof window === 'undefined') return;
    const rawHash = (window.location.hash || '').replace(/^#/, '');
    const hashHasSync = rawHash.includes('sync_url=') || rawHash.includes('sync_token=');
    const hashParams = hashHasSync ? new URLSearchParams(rawHash) : null;
    const searchParams = new URLSearchParams(window.location.search);

    const syncUrl = (hashParams && hashParams.get('sync_url')) || searchParams.get('sync_url');
    const syncToken = (hashParams && hashParams.get('sync_token')) || searchParams.get('sync_token');

    if (syncUrl && syncToken) {
      if (isAllowedSyncOrigin(syncUrl)) {
        const clean = syncUrl.trim().replace(/\/+$/, '');
        const existing = (localStorage.getItem('jarvis:daily:syncUrl') || '').trim().replace(/\/+$/, '');
        const confirmed = !existing || existing === clean || typeof window.confirm !== 'function'
          || window.confirm('Replace existing sync server (' + existing + ') with ' + clean + '?');
        if (confirmed) {
          if (typeof DAILY !== 'undefined' && typeof DAILY.saveSyncConfig === 'function') {
            DAILY.saveSyncConfig(clean, syncToken);
          } else {
            localStorage.setItem('jarvis:daily:syncUrl', clean);
            localStorage.setItem('jarvis:daily:syncToken', syncToken);
            localStorage.setItem('jarvis:training:syncUrl', clean);
            localStorage.setItem('jarvis:training:syncToken', syncToken);
            localStorage.setItem('jarvis:workout:syncUrl', clean);
            localStorage.setItem('jarvis:workout:syncToken', syncToken);
          }
          setTimeout(() => {
            if (typeof DAILY !== 'undefined' && typeof DAILY.syncWithServer === 'function') {
              DAILY.syncWithServer();
            }
            if (typeof WORKOUT !== 'undefined' && typeof WORKOUT.syncWithServer === 'function') {
              WORKOUT.syncWithServer();
            }
          }, 300);
        }
      }
      searchParams.delete('sync_url');
      searchParams.delete('sync_token');
      let nextHash = window.location.hash;
      if (hashParams) {
        hashParams.delete('sync_url');
        hashParams.delete('sync_token');
        const remHash = hashParams.toString();
        nextHash = remHash ? '#' + remHash : '';
      }
      const newQuery = searchParams.toString();
      const newUrl = window.location.pathname + (newQuery ? '?' + newQuery : '') + nextHash;
      try {
        window.history.replaceState(null, '', newUrl);
      } catch (e) {}
    }
  } catch (e) {}
})();

// ---- Feedback & Self-Learning Rating Storage ----
let osFeedbackRatings = {};
try {
  osFeedbackRatings = JSON.parse(localStorage.getItem('jarvis:feedback:ratings') || '{}');
} catch (e) {
  osFeedbackRatings = {};
}

function osSaveRating(type, id, score, title, metadata) {
  const key = type + ':' + id;
  osFeedbackRatings[key] = {
    type: type,
    id: id,
    score: score,
    title: title || '',
    metadata: metadata || {},
    timestamp: new Date().toISOString()
  };
  try {
    localStorage.setItem('jarvis:feedback:ratings', JSON.stringify(osFeedbackRatings));
  } catch (e) {}

  // Sync to Railway daily_store if available
  try {
    if (typeof DAILY !== 'undefined' && typeof DAILY.saveSettings === 'function') {
      DAILY.saveSettings({ feedback_ratings: osFeedbackRatings });
    }
  } catch (e) {}
}

function osRatingWidgetHtml(type, id, title, metadata) {
  const FB_S = STRINGS.feedback;
  const key = type + ':' + id;
  const current = (osFeedbackRatings[key] && osFeedbackRatings[key].score) || 0;
  const metaStr = escapeHtml(JSON.stringify(metadata || {}));
  const titleStr = escapeHtml(title || '');
  const presets = [
    { score: 2, label: FB_S.tiers.skip, band: [1, 3] },
    { score: 5, label: FB_S.tiers.okay, band: [4, 6] },
    { score: 8, label: FB_S.tiers.good, band: [7, 9] },
    { score: 10, label: FB_S.tiers.great, band: [10, 10] },
  ];

  return `
    <div class="os-rating-widget" dir="ltr" data-rating-type="${escapeHtml(type)}" data-rating-id="${escapeHtml(id)}" data-rating-title="${titleStr}" data-rating-meta="${metaStr}">
      <span class="os-rating-label">${escapeHtml(FB_S.label)}</span>
      <div class="os-rating-pills">
        ${presets.map(p => {
          const isSel = current >= p.band[0] && current <= p.band[1];
          const cls = isSel ? (p.score >= 8 ? ' is-selected is-high' : p.score <= 4 ? ' is-selected is-low' : ' is-selected') : '';
          return `<button type="button" class="os-rating-btn${cls}" aria-pressed="${isSel ? 'true' : 'false'}" data-rating-score="${p.score}">${escapeHtml(p.label)}</button>`;
        }).join('')}
      </div>
      <span class="os-rating-feedback mono">${current > 0 ? escapeHtml(FB_S.current(current)) : ''}</span>
    </div>
  `;
}

// Global click listener for ratings
if (typeof document !== 'undefined') {
  document.addEventListener('click', function(ev) {
    const btn = ev.target.closest('.os-rating-btn');
    if (!btn) return;
    const widget = btn.closest('.os-rating-widget');
    if (!widget) return;
    const type = widget.dataset.ratingType;
    const id = widget.dataset.ratingId;
    const title = widget.dataset.ratingTitle;
    let metadata = {};
    try {
      metadata = JSON.parse(widget.dataset.ratingMeta || '{}');
    } catch (e) {}
    const score = parseInt(btn.dataset.ratingScore, 10);
    if (!score) return;

    osSaveRating(type, id, score, title, metadata);

    widget.querySelectorAll('.os-rating-btn').forEach(b => {
      const s = parseInt(b.dataset.ratingScore, 10);
      b.className = 'os-rating-btn' + (s === score ? (score >= 8 ? ' is-selected is-high' : score <= 4 ? ' is-selected is-low' : ' is-selected') : '');
      b.setAttribute('aria-pressed', s === score ? 'true' : 'false');
    });
    const fb = widget.querySelector('.os-rating-feedback');
    if (fb) {
      fb.textContent = STRINGS.feedback.saved(score);
    }
  });
}

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
  if (c && c.track === 'ecommerce') return 'ecommerce';
  return c && c.track === 'lowtech' ? 'lowtech' : 'saas';
}

function osPpPick(c, key, isHe) {
  return isHe ? (c[key + '_he'] || c[key + '_en'] || '') : (c[key + '_en'] || c[key + '_he'] || '');
}

function osPpSlug(raw) {
  return String(raw || 'item').toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item';
}

function osPpRow(label, value) {
  if (!value) return '';
  return `<div class="pp-mvp-row"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`;
}

function osPpCardHtml(c, isHe, dirAttr) {
  const S = STRINGS.painpoints;
  const track = osPpTrack(c);
  const isLow = track === 'lowtech';
  const isEcom = track === 'ecommerce';
  const title = osPpPick(c, 'title', isHe);
  const who = osPpPick(c, 'who', isHe);
  const quote = osPpPick(c, 'quote', isHe);
  const solution = osPpPick(c, 'solution', isHe);
  const score = typeof c.score === 'number' ? c.score
    : Math.round(((c.intensity || 0) + (c.frequency || 0) + (c.ease_of_build || 0) + (c.low_competition || 0)) / 4);
  const sourcesList = Array.isArray(c.sources) ? c.sources.join(' · ') : '';
  const competitors = Array.isArray(c.competitors) ? c.competitors : [];

  const competitorsHtml = competitors.length ? `
    <div class="pp-competitors">
      <div class="sec-label">${escapeHtml(S.competitorsLabel)}</div>
      <div class="pp-comp-list">
        ${competitors.map(comp => `
          <div class="pp-comp-item"><strong>${escapeHtml(comp.name || '')}:</strong> ${escapeHtml(isHe ? (comp.gap_he || comp.gap_en || '') : (comp.gap_en || comp.gap_he || ''))}</div>`).join('')}
      </div>
    </div>` : '';

  let body;
  let deepRows = '';
  if (isLow) {
    const L = S.lowtech;
    const capital = [typeof c.startup_capital_usd === 'number' ? L.capitalValue(c.startup_capital_usd) : '',
      osPpPick(c, 'startup_capital', isHe)].filter(Boolean).join(' · ');
    const pricing = [osPpPick(c, 'pricing', isHe),
      typeof c.gross_margin_pct === 'number' ? L.margin(c.gross_margin_pct) : ''].filter(Boolean).join(' · ');
    body = `
      <div class="pp-cluster-mvp">
        ${osPpRow(S.solutionLabel, solution)}
        ${osPpRow(L.roles, osPpPick(c, 'roles_to_hire', isHe))}
        ${osPpRow(L.ai, osPpPick(c, 'ai_leverage', isHe))}
      </div>`;
    deepRows = `
      <div class="pp-lt-grid">
        ${osPpRow(L.capital, capital)}
        ${osPpRow(L.equipment, osPpPick(c, 'equipment_licensing', isHe))}
        ${osPpRow(L.pricing, pricing)}
        ${osPpRow(L.firstCustomers, osPpPick(c, 'first_customers', isHe))}
        ${osPpRow(L.moat, osPpPick(c, 'moat', isHe))}
        ${osPpRow(L.pilot, osPpPick(c, 'launch_plan', isHe))}
      </div>`;
  } else if (isEcom) {
    const E = S.ecommerce;
    const econPills = [
      typeof c.retail_price_usd === 'number' ? E.retail(c.retail_price_usd) : '',
      typeof c.cogs_usd === 'number' ? E.cogs(c.cogs_usd) : '',
      typeof c.gross_margin_pct === 'number' ? E.margin(c.gross_margin_pct) : '',
      typeof c.max_cac_usd === 'number' ? E.maxCac(c.max_cac_usd) : '',
    ].filter(Boolean).map(p => `<span class="pp-econ-pill mono">${escapeHtml(p)}</span>`).join('');
    body = `
      ${econPills ? `<div class="pp-econ-strip" dir="ltr">${econPills}</div>` : ''}
      <div class="pp-cluster-mvp">
        ${osPpRow(S.solutionLabel, solution)}
        ${osPpRow(E.aiUx, osPpPick(c, 'ai_experience', isHe))}
        ${osPpRow(E.supplier, osPpPick(c, 'supplier_match', isHe))}
      </div>`;
    deepRows = `
      <div class="pp-lt-grid">
        ${osPpRow(E.unitEcon, osPpPick(c, 'unit_economics', isHe))}
        ${osPpRow(E.platforms, osPpPick(c, 'target_platforms', isHe))}
        ${osPpRow(E.marketing, osPpPick(c, 'marketing_angle', isHe))}
        ${osPpRow(E.firstCustomers, osPpPick(c, 'first_customers', isHe))}
        ${osPpRow(E.launch, osPpPick(c, 'launch_plan', isHe))}
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

  const deepDrawer = (deepRows.trim() || competitorsHtml.trim()) ? `
    <details class="pp-deep-details">
      <summary class="pp-deep-summary">${escapeHtml(S.deepPlanSummary)}</summary>
      ${deepRows}
      ${competitorsHtml}
    </details>` : '';

  const extraBadges = isLow ? [
    c.delivery_model && S.delivery[c.delivery_model],
    c.market && S.market[c.market],
  ].filter(Boolean).map(t => `<span class="pp-badge-meta">${escapeHtml(t)}</span>`).join('')
    : isEcom ? [
      c.product_type && S.ecomProductType[c.product_type],
    ].filter(Boolean).map(t => `<span class="pp-badge-meta">${escapeHtml(t)}</span>`).join('') : '';

  return `
    <article class="pp-cluster-card${isLow ? ' is-lowtech' : isEcom ? ' is-ecommerce' : ''}" ${dirAttr}>
      <div class="pp-cluster-head" dir="ltr">
        <span class="pp-badge-track is-${track}">${escapeHtml(S.trackBadge[track])}</span>
        <span class="pp-badge-cat">${escapeHtml(c.category || '')}</span>
        ${extraBadges}
        <span class="pp-badge-sources">${escapeHtml(sourcesList)} · ${escapeHtml(S.metrics.mentions(c.mentions || 0))}</span>
        <span class="pp-badge-score">${escapeHtml(String(score))}</span>
      </div>
      <h2 class="pp-cluster-title">${escapeHtml(title)}</h2>
      ${who ? `<div class="pp-cluster-who"><strong>${escapeHtml(S.whoLabel)}:</strong> ${escapeHtml(who)}</div>` : ''}
      ${quote ? `<blockquote class="pp-cluster-quote">"${escapeHtml(quote)}"${c.quote_url ? ` <a href="${escapeHtml(safeExternalUrl(c.quote_url, '#'))}" target="_blank" rel="noopener noreferrer" class="pp-quote-link">${escapeHtml(S.sourceLinkLabel)} &rarr;</a>` : ''}</blockquote>` : ''}
      ${body}
      ${deepDrawer}
      ${(c.mvp_live_url || c.launch_kit_url) ? `
        <div class="labs-action-bar" dir="ltr">
          <a class="labs-live-btn" href="${escapeHtml(safeExternalUrl(c.mvp_live_url || c.launch_kit_url, '#'))}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(isEcom ? S.openLaunchKit : S.openLiveMvp)} &rarr;
          </a>
        </div>` : ''}
      <div class="pp-metrics-bar" dir="ltr">
        <div class="pp-metric-cell"><span class="pp-m-num">${escapeHtml(String(c.intensity ?? 0))}</span><span class="pp-m-lbl">${escapeHtml(S.metrics.intensity)}</span></div>
        <div class="pp-metric-cell"><span class="pp-m-num">${escapeHtml(String(c.frequency ?? 0))}</span><span class="pp-m-lbl">${escapeHtml(S.metrics.frequency)}</span></div>
        <div class="pp-metric-cell"><span class="pp-m-num">${escapeHtml(String(c.ease_of_build ?? 0))}</span><span class="pp-m-lbl">${escapeHtml(isLow ? S.lowtech.launchEase : isEcom ? S.ecommerce.launchEase : S.metrics.ease)}</span></div>
        <div class="pp-metric-cell"><span class="pp-m-num">${escapeHtml(String(c.low_competition ?? 0))}</span><span class="pp-m-lbl">${escapeHtml(S.metrics.competition)}</span></div>
      </div>
      ${osRatingWidgetHtml('painpoint', osPpSlug(c.title_en || title), title || '', { track: track, category: c.category || '' })}
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
    ? Object.entries(stats.by_source).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`).join(' · ')
    : '';
  const counts = { all: data.clusters.length, saas: 0, ecommerce: 0, lowtech: 0 };
  data.clusters.forEach(c => { counts[osPpTrack(c)] += 1; });
  const track = osPainpointsTrack;
  const shown = track === 'all' ? data.clusters : data.clusters.filter(c => osPpTrack(c) === track);

  const sumMain = isHe ? (data.summary_he || data.summary_en || '') : (data.summary_en || data.summary_he || '');
  const sumEcom = isHe ? (data.summary_ecommerce_he || data.summary_ecommerce_en || '') : (data.summary_ecommerce_en || data.summary_ecommerce_he || '');
  const sumLow = isHe ? (data.summary_lowtech_he || data.summary_lowtech_en || '') : (data.summary_lowtech_en || data.summary_lowtech_he || '');
  const summaries = track === 'saas' ? [sumMain]
    : track === 'ecommerce' ? [sumEcom]
    : track === 'lowtech' ? [sumLow]
    : [sumMain, sumEcom, sumLow];

  mount.innerHTML = `
    <div class="pp-toolbar">
      <div>
        <div class="sec-label">${escapeHtml(S.weekLabel(data.week || '', data.date || ''))}</div>
        <div class="sec-note mono">${escapeHtml(S.scanSummary(stats.pains ?? 0, stats.raw ?? 0, stats.sources ?? 0))}</div>
      </div>
      <div class="pp-lang-switch">
        <button type="button" class="os-btn ${isHe ? 'is-active' : ''}" aria-pressed="${isHe ? 'true' : 'false'}" data-pp-lang="he">${escapeHtml(S.langToggleHe)}</button>
        <button type="button" class="os-btn ${!isHe ? 'is-active' : ''}" aria-pressed="${!isHe ? 'true' : 'false'}" data-pp-lang="en">${escapeHtml(S.langToggleEn)}</button>
      </div>
    </div>

    <div class="os-window-tabs pp-track-tabs" role="tablist">
      ${['all', 'saas', 'ecommerce', 'lowtech'].map(k => `
        <button type="button" role="tab" aria-selected="${k === track}" tabindex="${k === track ? '0' : '-1'}" class="os-window-btn${k === track ? ' is-active' : ''}" data-pp-track="${k}">
          ${escapeHtml(S.filters[k])} <span class="pp-track-count mono">${escapeHtml(S.filters.count(counts[k]))}</span>
        </button>`).join('')}
    </div>

    ${summaries.filter(Boolean).slice(0, 1).map(s => `<p class="pp-summary" ${dirAttr}>${escapeHtml(s)}</p>`).join('')}

    ${(() => {
      const saasList = data.clusters.filter(c => osPpTrack(c) === 'saas');
      const spotlight = (saasList.length ? saasList : data.clusters).slice().sort((a, b) => ((b.validation_score ?? b.score ?? 0) - (a.validation_score ?? a.score ?? 0)))[0];
      if (!spotlight) return '';
      const vScore = typeof spotlight.validation_score === 'number' ? spotlight.validation_score : (spotlight.score || 0);
      const spTitle = osPpPick(spotlight, 'title', isHe);
      const spGap = isHe
        ? (spotlight.competitor_pricing_gap_he || spotlight.competitor_pricing_gap_en || '')
        : (spotlight.competitor_pricing_gap_en || spotlight.competitor_pricing_gap_he || '');
      const spVerdict = isHe
        ? (spotlight.weekend_mvp_verdict_he || spotlight.weekend_mvp_verdict_en || osPpPick(spotlight, 'mvp', isHe))
        : (spotlight.weekend_mvp_verdict_en || spotlight.weekend_mvp_verdict_he || osPpPick(spotlight, 'mvp', isHe));
      return `
        <section class="pp-validator-card" ${dirAttr}>
          <div class="pp-validator-head" dir="ltr">
            <span class="sec-label">${escapeHtml(S.validator.heading)}</span>
            <span class="pp-validator-score mono">${escapeHtml(S.validator.scoreLabel(vScore))}</span>
          </div>
          <h3 class="pp-validator-title">${escapeHtml(spTitle)}</h3>
          ${spVerdict ? `<p class="pp-validator-row"><strong>${escapeHtml(S.validator.verdictLabel)}:</strong> ${escapeHtml(spVerdict)}</p>` : ''}
          ${spGap ? `<p class="pp-validator-row"><strong>${escapeHtml(S.validator.pricingGapLabel)}:</strong> ${escapeHtml(spGap)}</p>` : ''}
        </section>`;
    })()}

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
        <a class="job-open-link" href="${escapeHtml(safeExternalUrl(job.url, 'https://www.upwork.com'))}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(JOBS_S.labels.openListing)} &rarr;
        </a>
        ${job.poc_live_url ? `
          <a class="labs-live-btn" href="${escapeHtml(safeExternalUrl(job.poc_live_url, '#'))}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(JOBS_S.labels.openLivePoc)} &rarr;
          </a>` : ''}
        <button type="button" class="job-toggle-proposal-btn" aria-expanded="false" aria-controls="job-proposal-${escapeHtml(jobId)}" data-proposal-toggle="${escapeHtml(jobId)}">
          ${escapeHtml(JOBS_S.labels.proposalDraft)} <span class="job-chevron" aria-hidden="true">&#9662;</span>
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
      ${(job.poc_blueprint || '').trim() ? `
        <details class="job-poc-box">
          <summary>${escapeHtml(JOBS_S.labels.pocTitle)}</summary>
          <div class="job-poc-head">
            <button type="button" class="job-poc-copy-btn" data-poc-job-id="${escapeHtml(jobId)}">
              ${escapeHtml(JOBS_S.labels.copyPoc)}
            </button>
          </div>
          <pre class="job-poc-text" id="job-poc-text-${escapeHtml(jobId)}">${escapeHtml(job.poc_blueprint)}</pre>
        </details>` : ''}
      ${osRatingWidgetHtml('upwork', jobId, job.title || '', { track: track, budget: budget })}
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
    web_dashboards: stats.web_count || jobs.filter(j => j.track === 'web_dashboards').length,
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
      <span class="sec-note mono">${escapeHtml(JOBS_S.labels.summaryLine(counts.all, stats.total_scanned || jobs.length))}</span>
    </div>

    <div class="os-window-tabs pp-track-tabs" role="tablist">
      ${['all', 'ai_automation', 'web_dashboards', 'cyber_soc', 'scraping_data'].map(k => `
        <button type="button" role="tab" aria-selected="${k === filter}" tabindex="${k === filter ? '0' : '-1'}" class="os-window-btn${k === filter ? ' is-active' : ''}" data-job-filter="${k}">
          ${escapeHtml(JOBS_S.filters[k])} <span class="pp-track-count mono">${escapeHtml(JOBS_S.filters.count(counts[k] || 0))}</span>
        </button>`).join('')}
    </div>

    <div class="job-subfilters" role="tablist">
      ${['all', 'fixed', 'hourly'].map(b => `
        <button type="button" role="tab" aria-selected="${b === budgetFilter}" tabindex="${b === budgetFilter ? '0' : '-1'}" class="job-subfilter-btn${b === budgetFilter ? ' is-active' : ''}" data-job-budget-filter="${b}">
          ${escapeHtml(JOBS_S.budgetFilters[b])}
        </button>`).join('')}
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
      const drawer = document.getElementById('job-proposal-' + id);
      if (drawer) {
        drawer.hidden = !drawer.hidden;
        btn.classList.toggle('is-open', !drawer.hidden);
        btn.setAttribute('aria-expanded', String(!drawer.hidden));
      }
    });
  });

  osWireCopyButtons(mount, '.job-copy-btn', 'jobId', 'job-proposal-text-', JOBS_S.labels.copied);
  osWireCopyButtons(mount, '.job-poc-copy-btn', 'pocJobId', 'job-poc-text-', JOBS_S.labels.copied);
}

function osWireCopyButtons(mount, selector, datasetKey, textPrefix, copiedText) {
  mount.querySelectorAll(selector).forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset[datasetKey];
      const textEl = document.getElementById(textPrefix + id);
      if (textEl && navigator.clipboard) {
        navigator.clipboard.writeText(textEl.textContent).then(() => {
          const original = btn.textContent;
          btn.textContent = copiedText;
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

      <h3 class="content-title" dir="rtl">${escapeHtml(post.topic || '')}</h3>

      <div class="content-post-box" dir="rtl">
        <div class="content-post-header">
          <span class="content-post-badge">${escapeHtml(CONTENT_S.labels.draftedPost)}</span>
          <button type="button" class="content-copy-btn" data-post-id="${escapeHtml(postId)}">
            ${escapeHtml(CONTENT_S.labels.copyPost)}
          </button>
        </div>
        <pre class="content-post-text" id="post-text-${escapeHtml(postId)}">${escapeHtml(post.linkedin_post || '')}</pre>
      </div>

      <details class="content-intel-details">
        <summary class="content-intel-summary">${escapeHtml(CONTENT_S.labels.intelSummary(post.credibility_score || '9/10'))}</summary>
        <div class="content-intel-box">
          <p class="content-intel-rationale" dir="auto">${escapeHtml(post.credibility_rationale || '')}</p>
          ${post.post_angle ? `<p class="content-intel-rationale" dir="auto"><strong>${escapeHtml(CONTENT_S.labels.angle)}:</strong> ${escapeHtml(post.post_angle)}</p>` : ''}
          ${post.opening_hook ? `<p class="content-intel-rationale" dir="auto"><strong>${escapeHtml(CONTENT_S.labels.hook)}:</strong> ${escapeHtml(post.opening_hook)}</p>` : ''}
          ${Array.isArray(post.key_takeaways) && post.key_takeaways.length ? `
            <ul class="content-takeaways" dir="auto">
              ${post.key_takeaways.slice(0, 3).map(t => `<li>${escapeHtml(t)}</li>`).join('')}
            </ul>` : ''}
          ${post.first_comment ? `
            <div class="content-first-comment" dir="auto">
              <div class="content-post-header">
                <span class="content-post-badge">${escapeHtml(CONTENT_S.labels.firstCommentLabel)}</span>
                <button type="button" class="content-comment-copy-btn" data-comment-id="${escapeHtml(postId)}">${escapeHtml(CONTENT_S.labels.copyFirstComment)}</button>
              </div>
              <pre class="content-post-text" id="post-comment-${escapeHtml(postId)}">${escapeHtml(post.first_comment)}</pre>
            </div>` : ''}
        </div>
      </details>

      <div class="content-actions-row">
        <a class="content-source-link" href="${escapeHtml(safeExternalUrl(post.source_url, '#'))}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(CONTENT_S.labels.openSource)} &rarr;
        </a>
        ${post.pack_url ? `
          <a class="labs-live-btn" href="${escapeHtml(safeExternalUrl(post.pack_url, '#'))}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(CONTENT_S.labels.openPublishPack)} &rarr;
          </a>` : ''}
        <a class="content-linkedin-link" href="https://www.linkedin.com/feed/" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(CONTENT_S.labels.openLinkedIn)} &rarr;
        </a>
      </div>
      ${osRatingWidgetHtml('linkedin', postId, post.topic || '', { category: category, source: post.source_platform || '' })}
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
    <div class="os-window-tabs pp-track-tabs" role="tablist">
      ${filterKeys.map(([k, label, count]) => `
        <button type="button" role="tab" aria-selected="${osContentFilter === k}" tabindex="${osContentFilter === k ? '0' : '-1'}" class="os-window-btn${osContentFilter === k ? ' is-active' : ''}" data-content-filter="${escapeHtml(k)}">
          ${escapeHtml(label)} <span class="pp-track-count mono">${count}</span>
        </button>
      `).join('')}
    </div>

    <div class="content-feed">
      ${filteredPosts.length ? filteredPosts.map(osContentCardHtml).join('') : `<div class="empty-state">${escapeHtml(CONTENT_S.ghostSub)}</div>`}
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
  osWireCopyButtons(mount, '.content-copy-btn', 'postId', 'post-text-', CONTENT_S.labels.copied);
  osWireCopyButtons(mount, '.content-comment-copy-btn', 'commentId', 'post-comment-', CONTENT_S.labels.copied);
}

// System health at the foot of Personal OS too: the backups it reports
// protect this area's data. Loaded here (after deferred scripts finish).
if (typeof document !== 'undefined' && typeof DASHBOARD !== 'undefined' && typeof renderHealthStrip === 'function') {
  const hs = document.getElementById('health-strip');
  if (hs) {
    DASHBOARD.fetchOne('scan').then(scan => renderHealthStrip(hs, scan));
  }
}
