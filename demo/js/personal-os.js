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
