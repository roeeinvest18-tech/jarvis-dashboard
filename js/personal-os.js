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

// Training keeps its own data feed (dashboard_data/training.json), fetched
// once and handed to the existing renderer untouched. Cached so switching
// tabs doesn't refetch.
let osTrainingPayload = null;
let osTrainingFetched = false;

function osRenderTraining() {
  const mount = document.getElementById('panel-training');
  if (!mount) return;

  // The existing training zone renders into #zone-training / #training-list
  // (see training.js). Rather than rewriting that renderer for new markup,
  // the panel provides the mount points it already expects — a placement
  // change, exactly as specified, with its data model untouched.
  if (!document.getElementById('training-list')) {
    mount.innerHTML = `
      <section class="zone" id="zone-training" aria-label="Training">
        <div id="training-list"></div>
      </section>`;
  }

  if (!osTrainingFetched) {
    osTrainingFetched = true;
    DASHBOARD.fetchOne('training').then(payload => {
      osTrainingPayload = payload;
      renderTrainingZone(payload);
      triggerTrainingSync(payload);
    });
    // Render immediately from locally captured sessions so the screen is
    // never blank while the feed is in flight.
    renderTrainingZone(null);
    return;
  }
  renderTrainingZone(osTrainingPayload);
}

const OS_TAB_TITLES = {
  training: 'Training',
  insights: 'Insights',
  memory: 'Memory',
  history: 'History',
};

const osShell = mountShell({
  areaId: 'os',
  // Today draws its own greeting as the screen title, so the shell's title
  // slot stays empty there rather than repeating it.
  titleFor: tab => (OS_TAB_TITLES[tab] ? `<h1 class="shell-title">${OS_TAB_TITLES[tab]}</h1>` : ''),
  render(tab) {
    if (tab === 'today') {
      dailyActiveDate = osDateFromQuery();
      renderDailyToday();
      dailyTriggerSync();
      return;
    }
    if (tab === 'training') { osRenderTraining(); return; }
    osActiveTab = tab;
    renderOsActiveTab();
    osTriggerSync();
  },
});
