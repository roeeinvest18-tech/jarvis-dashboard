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
    const form = document.getElementById('training-log-form');
    if (form) {
      form.scrollIntoView({ block: 'start' });
      const first = form.querySelector('input:not([type="date"])');
      if (first) first.focus({ preventScroll: true });
    }
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
      // The shortcut acts on the settled render; the first, feed-less one
      // is replaced by this and would lose focus.
      osRunPendingAction('training');
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
      osRunPendingAction(tab);
      return;
    }
    if (tab === 'training') {
      const settled = osTrainingFetched;   // feed already in hand: act now
      osRenderTraining();
      if (settled) osRunPendingAction(tab);
      return;
    }
    osActiveTab = tab;
    renderOsActiveTab();
    osTriggerSync();
  },
});
