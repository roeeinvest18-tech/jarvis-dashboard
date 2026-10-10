// Every user-facing string in the app, in one place.
//
// Before this file the copy lived inside the renderers, so the same idea was
// worded three different ways on three screens and a language change meant
// editing eleven files. Renderers now hold structure; this holds language.
//
// Rules the copy follows (see docs/COPY.md):
//   - Plain and quiet. Jarvis reports; it does not cheer, scold or sell.
//     No exclamation marks, no "simply"/"just"/"easily", no blame.
//   - An empty state says why it is empty and what fills it.
//   - An error says what happened and what the owner can do. Never a raw
//     exception, never a bare status code.
//   - Sentence case for labels and buttons. ALL CAPS is a visual treatment
//     (CSS text-transform), never baked into a string -- so the same label
//     can be read aloud by a screen reader in its normal case.
//   - One word per concept, per the glossary in docs/COPY.md: session (not
//     workout), setup (not pick/signal), Close the Day (the flow) vs checked
//     in (having done it), habit (one item) vs core (the five).
//
// Interpolated strings are functions, so the whole sentence stays here
// rather than being reassembled in a template.
//
// Loaded before every other script on both pages, and required directly by
// the Node test suites, so it must stay free of DOM and browser globals.

// The app's clock. Named once here because several sentences embed it, and a
// market time and a local time must never look alike.
const STRINGS_ZONE = 'Israel time';

const STRINGS = {
  // ---- shared -------------------------------------------------------------
  common: {
    brand: 'Jarvis',
    // One dash for "no value", everywhere. Screen readers get the word.
    none: '—',
    noneLabel: 'not recorded',
    notApplicable: 'not applicable',
    save: 'Save',
    saved: 'Saved',
    cancel: 'Cancel',
    remove: 'Remove',
    edit: 'Edit',
    delete: 'Delete',
    back: 'Back',
    done: 'Done',
    close: 'Close',
    dismiss: 'Dismiss',
    optional: 'optional',
    never: 'never',
    justNow: 'just now',
    // Israel time is the app's clock. Said out loud wherever a time could be
    // read as a market time instead.
    localZone: STRINGS_ZONE,
  },

  shell: {
    areas: {
      os: 'Personal OS',
      trading: 'Trading',
    },
    tabs: {
      today: 'Today',
      training: 'Training',
      insights: 'Insights',
      memory: 'Memory',
      history: 'History',
      top10: 'Top 10',
      breakouts: 'Breakouts',
      fullscan: 'Full Scan',
      scorecard: 'Scorecard',
    },
    ownerInitial: 'R',
    ownerName: 'Roee',
    // One line under each page title: what the screen is for.
    subtitles: {
      training: 'Log today\'s session, review the week and follow your progress.',
      insights: 'What your routine, sleep and training show over time.',
      memory: 'Recall what you have learned, a little each day.',
      history: 'Every past day, ready to open and correct.',
      top10: 'The strongest setups from the nightly scan.',
      breakouts: 'Setups that broke out in the last 48 hours.',
      fullscan: 'Every ticker the nightly scan covered.',
      scorecard: 'How past signals performed against the market.',
    },
  },

  // ---- system health strip ------------------------------------------------
  health: {
    title: 'System',
    labels: {
      scan: 'Nightly scan',
      cci_oversold: 'CCI watchlist',
      breakout_check: 'Breakout checks',
      ibkr: 'IBKR account data',
      reddit: 'Reddit sentiment',
      gmail: 'Gmail triage',
      push: 'Push notifications',
      weekly_briefing: 'Weekly briefing',
      tax_loss_report: 'Tax-loss report',
      alert_performance: 'Alert performance report',
      backup_training: 'Backup · training',
      backup_daily: 'Backup · daily',
      backup_push_subscriptions: 'Backup · push devices',
      authFailures: 'Refused sign-ins',
    },
    // Why a source is not reporting, in plain words. These are the only
    // explanation the owner gets, so each one says what to do about it where
    // there is something to do.
    codes: {
      not_configured: 'not set up — add its credentials to run it',
      token_rejected: 'the server rejected this token — rotate it in both places',
      server_reset_suspected: 'the server looks reset — restore from the last backup',
      flex_unavailable: 'IBKR did not respond',
      no_data: 'ran, but returned nothing',
      fetch_failed: 'could not reach the source',
      step_failed: 'the scheduled run stopped part-way',
      unreachable: 'the sync server did not answer',
      no_devices: 'no devices subscribed yet',
      send_failed: 'every device rejected the last send',
      bad_fallback: 'the saved fallback device could not be read',
      skipped: 'skipped',
      failing: 'not working',
    },
    states: {
      current: 'up to date',
      working: 'working',
      behind: 'behind',
      noScanYet: 'no scan has run yet',
      needsAttention: (note) => `needs attention — ${note}`,
      behindSession: (session) => `behind — the ${session} session has not landed`,
    },
    summary: {
      allCurrent: 'everything up to date',
      needAttention: (n) => `${n} item${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} attention`,
      lastScan: (when) => `scan ${when}`,
    },
    auth: {
      quiet: 'none in the last 7 days',
      counts: (today, week) => `${today} today · ${week} in the last 7 days`,
      spike: ' — well above the recent norm',
    },
    remote: {
      'not-deployed': 'Integration details appear once the sync server is updated.',
      rejected: 'This device’s sync token was refused. Re-enter it in Settings, or rotate it on the server.',
      unreachable: 'The sync server did not answer, so only the public part is shown here.',
      error: 'The sync server could not return integration details just now.',
    },
    withheldLabel: 'Integrations',
  },

  // ---- private-tier placeholder -------------------------------------------
  privacy: {
    // Was "— local only, not published here", which read as a limitation.
    // It is a deliberate split, so it says so.
    localOnly: (label) => `${label} stays on your devices — the published site never carries it.`,
  },

  // ---- "Can I trade today" card (private tier) ----------------------------
  account: {
    title: 'Can I trade today',
    lines: {
      openSlots: 'Open slots',
      lossStreakPause: 'Loss-streak pause',
      restDay: 'Rest day',
      entryWindow: 'Entry window',
    },
    slotsFree: (free, max) => `${free} of ${max} free`,
    pauseOn: (until) => `on until ${until}`,
    pauseNote: (losses, hours) => `${losses} losses in a row · about ${hours}h left`,
    pauseOff: 'not active',
    restDayYes: 'yes',
    restDayNo: 'no',
    restDayNote: (stops) => `${stops} stops this week`,
    windowOpen: 'open',
    windowClosed: 'closed',
    marketClosedToday: 'the US market is closed today',
    windowUntil: (hhmm) => `until ${hhmm} ${STRINGS_ZONE}`,
    windowAfter: (hhmm) => `after ${hhmm} ${STRINGS_ZONE}`,
    empty: 'No account data yet. Add your positions below, or connect IBKR.',
    editor: {
      title: 'Positions and closed trades (private)',
      note: 'Tickers and outcomes only — no sizes or prices. Stays on your sync server.',
      noPositions: 'No open positions recorded.',
      noTrades: 'None recorded.',
      addPosition: 'Add position',
      closedTrades: 'Closed trades',
      addTrade: 'Add closed trade',
      ticker: 'Ticker',
      tickerLabel: 'Position ticker',
      sectorEtf: 'Sector ETF',
      removePosition: 'Remove position',
      removeTrade: 'Remove trade',
      closedDate: 'Closed date',
      result: 'Result',
      stop: 'stop',
    },
  },

  // ---- push notifications -------------------------------------------------
  push: {
    bannerLabel: 'Get breakout alerts as push notifications, the same ones the Telegram bot sends.',
    enable: 'Enable push notifications',
    enabling: 'Enabling…',
    // Was "(permission denied or unsupported)" -- two causes, no action.
    enableFailed: 'This browser would not turn on notifications. Check that notifications are allowed for this site, then try again.',
    subscriptionLabel: 'Push subscription details',
    // Names the secret by name only, and says where it goes.
    manualHint: 'Subscribed on this device, but it could not register itself. Copy the value above into the push subscription secret on the private repo (Settings → Secrets → Actions) so scheduled scans can reach it — or set up sync below and every device registers itself.',
    registered: (host) => `Subscribed and registered through ${host}. This device gets alerts alongside any other device you have enabled.`,
    setupSummary: 'Register future devices automatically (optional) — set up',
    serverUrl: 'Sync server address',
    serverToken: 'Sync token',
    saveAndRegister: 'Save and register this device',
  },

  // ---- Trading: shared ----------------------------------------------------
  trading: {
    search: 'Search ticker or sector',
    clearSearch: 'Clear search',
    openChart: (ticker) => `Open the ${ticker} chart on TradingView`,
    tags: {
      reclaim: 'Reclaim',
      breakout: 'Breakout',
      signal: 'Signal',
    },
    // The three tags are different things, and the colour alone never said
    // how. One line, shown under the Top 10 list.
    tagLegend: 'Reclaim: back above a level it had lost. Breakout: through the top of its base. '
      + 'Signal: on the watchlist, neither yet.',
    top10: {
      heading: 'Today’s ranked setups',
      scanned: (when) => `scan ${when}`,
      noScan: 'No scan data yet. The nightly scan fills this in.',
      staleModel: 'This scan predates the current Top 10 scores. The next nightly scan ranks it.',
      noMatch: (term) => `No ranked setups match “${term}”.`,
      volume: (value) => `Vol ${value}`,
      columns: { rank: '#', ticker: 'Ticker', sma150: 'SMA150', price: 'Price', change: 'Chg', volume: 'Vol', score: 'Score' },
      viewAll: 'View all scanned tickers →',
      shownOf: (n, total) => `${n} of ${total}`,
      flagsPending: 'Float, short-float and earnings checks appear from the next nightly scan.',
      // Missing data reads "unknown" -- never silently as a pass.
      flags: {
        'float:low': 'low float',
        'float:unknown': 'float unknown',
        'short:high': 'high short float',
        'short:unknown': 'short float unknown',
        'earnings:unknown': 'earnings date unknown',
      },
      earningsSoon: (days) => `earnings ${days}d`,
      peer: (basis, peers) => `same ${basis} as ${peers}`,
      heldSector: (sector) => `you already hold ${sector}`,
    },
    sizing: {
      title: 'Position size',
      note: 'stays on this device',
      entry: 'Entry',
      stop: 'Stop',
      portfolio: 'Portfolio $',
      limits: 'Your limits',
      maxRisk: 'Max risk $',
      maxPosition: 'Max position $',
      maxPct: 'Max % of portfolio',
      shares: (n) => `${n} shares`,
      limitedBy: (label) => `Limited by ${label}.`,
      breakdown: (risk, position, pct) => `risk $${risk} · position $${position} · ${pct}% of portfolio`,
      errors: {
        noEntry: 'Enter an entry and a stop price.',
        stopAboveEntry: 'The stop has to be below the entry for a long position.',
        noLimits: 'Set your three limits first.',
        noPortfolio: 'Enter your portfolio value.',
      },
      bindingRisk: (risk) => `max risk $${risk}`,
      bindingPosition: (position) => `max position $${position}`,
      bindingPortfolio: (pct) => `${pct}% of portfolio`,
    },
    // The market runs on New York hours; the owner reads the app on Israel
    // time. Every clock here says which one it is.
    marketWindow: {
      open: (closes) => `Session open · closes ${closes} ${STRINGS_ZONE}`,
      openEarly: (closes) => `Session open · closes early at ${closes} ${STRINGS_ZONE}`,
      opens: (day, time) => `Session opens ${day} ${time} ${STRINGS_ZONE}`,
      holiday: (name) => `US market closed for ${name} · `,
      unavailable: 'Market calendar unavailable',
      today: 'today',
    },
    why: {
      summary: (regime) => `Why ${regime}? →`,
      thisLabel: 'this label',
      breadth: (pct, above, total) => `${pct}% of the watchlist is above its SMA150 (${above} of ${total}).`,
      intro: (days) => `The label compares three risk-appetite ratios with ${days} trading days ago:`,
      rule: 'Two or more rising reads RISK-ON, two or more falling reads DEFENSIVE, anything else NEUTRAL.',
      pending: 'The inputs behind this label are published from the next nightly scan.',
      trends: { rising: 'rising', falling: 'falling', unknown: 'unknown' },
    },
    scorecard: {
      empty: 'The scorecard appears after the next nightly scan.',
      models: {
        'lowcci-v1': 'Low-CCI model · live setups',
        'lowcci-v1-reconstructed': 'Low-CCI model · reconstructed for earlier nights',
        'reclaim-v1': 'Reclaim model · as published',
      },
      caution: (before) => `Low-CCI figures${before ? ` before ${before}` : ''} are reconstructed from `
        + 'each night’s published data, not live setups, and the period is too short to draw conclusions.',
      method: (from, to, minSample, method) =>
        `How each night’s Top 10 did afterwards: average forward return compared with SPY over the `
        + `same window, ${from} to ${to}. Observed averages over this period, not predictions; a figure `
        + `appears only once a group has ${minSample} completed setups. ${method}`,
      range: (setups, nights, from, to) =>
        `${setups} setups · ${nights} nights · ${from} to ${to}`,
      groupRange: (setups, nights) => `${setups} setups · ${nights} nights`,
      horizon: (days) => `${days} days`,
      noOutcomes: 'no outcomes yet',
      belowSample: (n) => `n=${n} · not enough samples yet`,
      vsSpy: 'vs SPY',
      detail: (avg, beat, n) => `avg ${avg} · beat SPY ${beat}% · n=${n}`,
    },
    breakouts: {
      empty: 'No breakout data published yet. The breakout check publishes SMA150 touches '
        + 'during market hours.',
      filters: { all: 'All', today: 'Today', week: 'This week', archive: 'Archive' },
      level: 'SMA150',
      touches: (n) => `${n}× touch`,
      remaining: (hours, mins) => `${hours}h ${mins}m remaining`,
      expiredLabel: 'Window expired',
      expired: (hours) => `expired ${hours}h ago`,
      left: (hours, mins) => `${hours}h ${mins}m left`,
      touched: (when) => `touched ${when}`,
      emptyArchive: 'Nothing in the archive yet. A touch moves here once its window closes.',
      emptyWindow: 'No SMA150 touches in this window. The breakout check adds them during market hours.',
    },
    fullScan: {
      heading: 'All scanned',
      count: (shown, total) => `${shown} of ${total}`,
      empty: 'No scan data yet. The nightly scan fills this in.',
      columns: {
        ticker: 'Ticker',
        pct_SMA150: 'SMA150',
        price: 'Price',
        change_pct: 'Chg',
        today_volume: 'Vol',
        score: 'Score',
      },
      sortAsc: '▲',
      sortDesc: '▼',
      clearFilters: 'Clear filters',
      noMatchSearchAndFilters: (q) => `No stocks match "${q}" and the current filters.`,
      noMatchSearch: (q) => `No stocks match "${q}".`,
      noMatchFilters: 'No stocks match the current filters.',
    },
    accountCard: {
      withheldLabel: 'Account rules',
      sourceIbkr: 'from IBKR',
      sourceManual: 'entered by you',
      checking: 'Checking…',
      saving: 'Saving…',
      saveFailed: 'Not saved. Check the sync server address and token in Settings.',
    },
  },

  // ---- Personal OS: the day's record --------------------------------------
  daily: {
    habits: {
      tefillin: 'Tefillin',
      spiritual_learning: 'Spiritual learning',
      htb_completed: 'Learning block complete',
      four_minute_routine: '4-minute routine',
      meditation: 'Meditation',
      mobility_posture: 'Mobility / posture',
      // Was 'Workout'. The Training tab logs "sessions", so this habit --
      // the same act, ticked from a different screen -- now says the same.
      workout_completed: 'Training session',
      protein_target_met: 'Protein target',
      water_target_met: 'Water target',
      career_output: 'Career output',
      creatine: 'Creatine',
      getting_ready: 'Getting ready',
      breakfast: 'Breakfast',
      dinner: 'Dinner',
      wind_down_no_screens: 'Wind-down, no screens',
      in_bed: 'In bed',
    },
    proteinTarget: (grams) => `Protein ${grams}g`,
    waterTarget: (litres) => `Water ${litres}L`,
    mind: {
      mood: 'Mood',
      energy: 'Energy',
      focus: 'Focus',
      sleepQuality: 'Sleep quality',
    },
    tiers: {
      building: 'Building',
      minimum: 'Minimum',
      standard: 'Standard',
      great: 'Great',
    },
  },

  today: {
    greetingMorning: 'Good morning',
    greetingAfternoon: 'Good afternoon',
    greetingEvening: 'Good evening',
    greetingPastDay: 'Reviewing',
    editingPastDay: 'Editing a past day.',
    backToToday: 'Back to today',
    // Moving between days on the Today screen itself.
    dateNav: {
      label: 'Pick the day to track',
      previous: 'Previous day',
      next: 'Next day',
      today: 'Today',
      // Only past days can be opened: a day that has not happened has
      // nothing to report, and the store would file a real record under it.
      noFuture: 'Today is the last day you can open.',
      isToday: 'Today',
      yesterday: 'Yesterday',
      // Whether this date already has a record, said plainly.
      entrySaved: 'Entry saved',
      noEntry: 'No entry yet',
      noEntryHint: 'Nothing recorded for this day yet. Tick a habit, log sleep or close '
        + 'the day and an entry is created for this date.',
      saved: 'Saved',
    },
    // A streak of zero is not a failure, so it is never reported as one.
    building: 'Building',
    streak: (days) => `${days} day${days === 1 ? '' : 's'}`,
    sections: {
      morning: 'Morning',
      afternoon: 'Afternoon',
      evening: 'Evening',
      trainingDay: 'training day',
      priorities: 'Today’s priorities',
    },
    // Reference lines on the schedule: a block or a marker, no checkbox. The
    // clock times in them are read from schedule-config.js at render time.
    schedule: {
      by: (time) => `by ${time}`,
      window: (from, to) => `${from} to ${to}`,
      notes: {
        wake_window: (time) => `Wake window ${time}`,
        learning_block: () => 'Learning block, 4 hours',
        lunch: () => 'Free time and lunch',
        wind_down_dim: (time) => `Wind-down starts ${time}, screens dimmed`,
      },
    },
    sleepPrompt: 'Log last night’s sleep',
    sleepQuality: (score) => `Quality ${score}/10`,
    spiritualPrompt: 'What did you learn?',
    spiritualPlaceholder: 'Mesillat Yesharim — Chapter 4',
    htbPrompt: 'What did you study?',
    htbPlaceholder: 'Kerberos',
    priorityPlaceholder: 'What matters today?',
    priorityNew: 'New priority',
    priorityAdd: 'Add priority',
    priorityRemove: (n) => `Remove priority ${n}`,
    tradingViewLabel: 'TradingView opens',
    tradingViewFewer: 'One fewer TradingView open',
    tradingViewMore: 'One more TradingView open',
    holiday: 'Holiday',
    holidayOn: 'Holiday: on',
    minimumDay: 'Minimum day',
    minimumDayOn: 'Minimum day: on',
    minimumDayNote: 'Core five only. Everything else is still tracked, just out of the way.',
    closeDay: 'Close the Day',
    reopenDay: 'Reopen the day',
  },

  sleep: {
    title: 'Sleep',
    dialogLabel: 'Log sleep',
    hint: 'Duration is worked out for you.',
    hintLastNight: 'Last night. Duration is worked out for you.',
    asleep: 'Asleep',
    awake: 'Awake',
    duration: (formatted) => `Duration ${formatted}`,
    durationUnknown: 'Duration not yet known',
    implausible: ' · that looks unusual, worth a second look',
  },

  // The eight-step Close the Day flow.
  close: {
    title: 'Close the Day',
    dialogLabel: (step) => `Close the Day — ${step}`,
    steps: {
      mind: 'Mind',
      sleep: 'Sleep',
      routine: 'Routine',
      nutrition: 'Nutrition',
      learning: 'Learning',
      trading: 'Trading',
      career: 'Career',
      reflection: 'Reflection',
    },
    progress: (n, total) => `${n} / ${total}`,
    next: 'Next',
    complete: 'Complete day',
    hints: {
      mind: 'How the day actually felt.',
      routine: 'Anything you finished but haven’t ticked.',
      nutrition: 'Targets only — no food diary.',
      learning: 'No duration needed — just what you covered.',
      trading: 'How many times you opened TradingView today.',
      screenTime: 'Screen time, if you have it to hand (Settings → Screen Time).',
      career: 'Only when it was on the plan — skipping is not a miss.',
      careerExamples: 'Applied, messaged a recruiter, prepped, improved the CV or a project.',
    },
    screenTotal: 'Total (min)',
    screenSocial: 'Social (min)',
    screenYouTube: 'YouTube (min)',
    tradingViewFewer: 'One fewer',
    tradingViewMore: 'One more',
    winLabel: 'Win of the day',
    winPlaceholder: 'One thing that went well',
    frictionLabel: 'Friction',
    frictionPlaceholder: 'What got in the way',
    scaleGroup: (label) => `${label} 1 to 10`,
    scalePoint: (label, n) => `${label} ${n} of 10`,
    scaleValue: (value) => `${value}/10`,
  },

  // ---- shared stock-row renderers -----------------------------------------
  //
  // components.js's card and table renderers. Nothing on either page calls
  // them today -- trading.js draws its own rows -- but their copy is here
  // with the rest rather than left behind in a template. See docs/COPY.md.
  stockCard: {
    recurring: 'Flagged on more than one day this week',
    noteLabel: 'Your note',
    notePlaceholder: 'e.g. watching for a pullback to 38',
    noteFor: (ticker) => `Your note on ${ticker}`,
    smaDistance: 'Distance from its SMA150',
    marketCap: 'Market cap',
    avgVolume: '10-day average volume',
    exitThesis: 'Your exit thesis',
    exitThesisAgainst: (pct) => `Your exit thesis — ${pct} against you`,
    detail: {
      sma150: 'SMA150',
      sma200: 'SMA200',
      cci: 'CCI(20)',
      volumeRatio: 'Volume ratio',
      shortInterest: 'Short interest',
      redditMentions: 'Reddit mentions',
      sector: 'Sector',
      baseLength: 'Base length',
      failedBreakouts: 'Failed breakouts (90d)',
      earnings: 'Earnings',
      signals: 'Signals',
    },
    fromSma: (pct) => `${pct} from`,
    timesAverage: (ratio) => `${ratio}x avg`,
    bullish: (n) => ` (${n} bullish)`,
    strongSector: ' — strong',
    days: (n) => `${n}d`,
    earningsIn: (days) => `in ${days}d`,
    noSignals: 'none',
  },

  // ---- shared stock-row renderers -----------------------------------------
  //
  // components.js's card and table renderers. Nothing on either page calls
  // them today -- trading.js draws its own rows -- but their copy is here
  // with the rest rather than left behind in a template. See docs/COPY.md.
  stockCard: {
    recurring: 'Flagged on more than one day this week',
    noteLabel: 'Your note',
    notePlaceholder: 'e.g. watching for a pullback to 38',
    noteFor: (ticker) => `Your note on ${ticker}`,
    smaDistance: 'Distance from its SMA150',
    marketCap: 'Market cap',
    avgVolume: '10-day average volume',
    exitThesis: 'Your exit thesis',
    exitThesisAgainst: (pct) => `Your exit thesis — ${pct} against you`,
    detail: {
      sma150: 'SMA150',
      sma200: 'SMA200',
      cci: 'CCI(20)',
      volumeRatio: 'Volume ratio',
      shortInterest: 'Short interest',
      redditMentions: 'Reddit mentions',
      sector: 'Sector',
      baseLength: 'Base length',
      failedBreakouts: 'Failed breakouts (90d)',
      earnings: 'Earnings',
      signals: 'Signals',
    },
    fromSma: (pct) => `${pct} from`,
    timesAverage: (ratio) => `${ratio}x avg`,
    bullish: (n) => ` (${n} bullish)`,
    strongSector: ' — strong',
    days: (n) => `${n}d`,
    earningsIn: (days) => `in ${days}d`,
    noSignals: 'none',
  },

  // ---- Personal OS: Training ----------------------------------------------
  training: {
    drills: {
      pull_ups: 'Pull ups',
      push_ups: 'Push ups',
      shoulders: 'Shoulders',
      chin_ups: 'Chin ups',
      triceps_extension: 'Triceps extension',
    },
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    empty: 'No sessions logged yet — log one above.',
    notLogged: (days, more) => `Not logged: ${days}${more > 0 ? ` (+${more} earlier)` : ''}`,
    noDrills: 'No drills recorded',
    logHeading: 'Log a session',
    logDate: 'Session date',
    setPlaceholder: (n) => `Set ${n}`,
    thirdSetPlaceholder: 'optional',
    logSubmit: 'Log session',
    columns: { session: 'Session', set: (n) => `Set ${n}`, total: 'Total' },
    reps: (total) => `${total} reps`,
    delta: (delta) => `${delta > 0 ? '+' : ''}${delta} vs last session`,
    personalBest: 'Personal best',
    personalBestShort: 'PB',
    notLoggedYet: 'Not logged yet.',
    editRow: (date, drill) => `Edit ${date} ${drill}`,
    sessionList: (n) => `Logged sessions (${n}) — view / delete`,
    deleteConfirm: (date) => `Delete the ${date} session? This removes every drill logged that `
      + 'day, on every device it has synced to.',
    deleteLabel: (date) => `Delete the session logged ${date}`,
    savedNote: 'Sessions are saved in this browser. Editing a past entry recalculates its '
      + 'progress and personal bests immediately.',
    dismissHint: 'Dismiss this note',
    sync: {
      on: (host) => `Synced across devices through ${host}.`,
      forget: 'Turn off sync',
      // Was "Sync failed (HTTP 503)" -- a number the owner cannot act on.
      rejected: 'The sync server refused this device’s token',
      failed: 'The sync server could not be reached',
      problem: (reason, host) => `${reason} (${host}) — showing this device’s data only.`,
      setupSummary: 'Sync across devices (optional) — set up',
      serverUrl: 'Sync server address',
      serverToken: 'Sync token',
    },
  },

  // ---- Training log: day switcher and add-exercise -------------------------
  workout: {
    daySelect: 'Session to log',
    scheduledOption: (focus) => `${focus} · scheduled for this date`,
    restDayOption: 'Rest day',
    scheduledMeta: 'scheduled for this date',
    browsing: (focus, scheduled) => (scheduled
      ? `You are logging ${focus} on this date. The scheduled session is ${scheduled}.`
      : `This date has no scheduled session. You are logging ${focus} on it.`),
    backToScheduled: (scheduled) => `Back to ${scheduled}`,
    addSummary: 'Add an exercise',
    addName: 'Exercise name',
    addNew: 'New',
    addNote: (focus) => `Starts with the same structure as the other ${focus} exercises. Only the name is chosen now; change the rest afterwards in the exercise's settings.`,
    addSets: 'Sets',
    addReps: 'Reps',
    addRir: 'RIR',
    addUnit: 'Unit',
  },

  // ---- Personal OS: Insights ----------------------------------------------
  insights: {
    periods: { 7: '7 days', 30: '30 days', 90: '90 days' },
    sections: {
      consistency: 'Consistency',
      deadlines: 'Timing',
      sleep: 'Sleep',
      mind: 'Mind & energy',
      marketChecking: 'Market checking',
      observations: 'Observations',
      thisWeek: 'This week',
      experiments: 'Experiments',
    },
    // Timing against each item's target time. Insights only: Today looks the
    // same for an item ticked at 09:00 and one ticked at 14:00.
    deadlines: {
      headings: { item: 'Item', target: 'Target', inNorm: 'In norm', outOfNorm: 'Out of norm' },
      explain: (hours) => `Out of norm means ticked more than ${hours} hours after the target time. `
        + 'Earlier than the target counts as in norm. Holiday days are left out.',
      share: (pct, n) => `${pct}% in norm over ${n} timed days`,
      needMore: (n, min) => `${n} of ${min} timed days so far. A rate appears after ${min}.`,
      noTimes: 'No timed days yet',
      ghostHeading: 'Timing starts from the first item you tick on Today',
      ghostSub: 'Each item with a target time gets a count of days ticked in norm and out of norm. '
        + 'Days ticked before this existed, from a past day, or inside Close the Day carry no time '
        + 'and are left out, so this fills in as you tick items on the day itself.',
      ghostNudge: 'Tick an item on Today to start the record',
    },
    consistency: {
      headings: { habit: 'Habit', done: 'Done', rate: 'Rate' },
      emptyWindow: (windowLabel) => `No days checked in over the last ${windowLabel}. `
        + 'Close a day and each habit gets a completion bar here.',
      ghostDay: (n) => `Day ${n} of building your pattern`,
      ghostDays: (n) => `${n} days in`,
      ghostSub: 'Each habit gets a completion bar once there are a few days to compare. '
        + 'Percentages count only the days you actually reported.',
      ghostNudge: 'Check back after your first Close the Day',
    },
    sleep: {
      empty: 'No sleep entries yet. Add one from Close the Day.',
      avgDuration: 'Avg duration',
      avgQuality: 'Avg quality',
      avgBedtime: 'Avg bedtime',
      avgWake: 'Avg wake',
      bedtimeSpread: 'Bedtime spread',
      wakeSpread: 'Wake spread',
      consistency: 'Consistency',
      basedOn: (n) => `Based on ${n} night${n === 1 ? '' : 's'} with sleep recorded.`,
      ghostHeading: 'No nights logged yet',
      ghostSub: 'Log a bedtime and wake time and your average duration, quality and '
        + 'bedtime consistency appear here.',
      ghostNudge: 'Log last night’s sleep on Today',
    },
    mind: {
      ghostHeading: 'Nothing rated yet',
      ghostSub: 'Mood, energy and focus are asked once, at the end of the day, and averaged here.',
      ghostNudge: 'Rate them in Close the Day',
    },
    tradingView: {
      empty: 'No TradingView opens recorded yet. The count on Today fills this in.',
      avgPerDay: 'Avg / day',
      highest: (date) => `Highest · ${date}`,
      lowest: (date) => `Lowest · ${date}`,
      total: (days) => `Total · ${days}d`,
    },
    // Analytics wording is fixed here, not left to whatever produced the
    // sentence: a difference between groups of days is never a cause.
    observations: {
      tag: 'observed association',
      empty: (minGroup) => 'Not enough data yet. Comparisons appear once both sides of a split '
        + `have at least ${minGroup} days behind them.`,
      evidence: (metric, aN, aMean, bN, bMean) =>
        `${metric}: group A n=${aN} mean=${aMean} · group B n=${bN} mean=${bMean}`,
      caveat: 'These are differences between groups of days, not evidence that one caused the other.',
    },
    week: {
      empty: 'No days checked in this week yet. Close a day and the week-over-week '
        + 'comparison appears here.',
      reported: (days, previous) => `${days} day${days === 1 ? '' : 's'} checked in this week, `
        + `${previous} the week before. Percentages compare only days actually reported.`,
      improved: 'What improved',
      declined: 'What declined',
      mind: 'Mind, week over week',
      training: 'Training',
      sessionsLogged: 'Sessions logged',
      wins: 'Wins',
      friction: 'Friction',
      nothingImproved: 'Nothing improved measurably against last week.',
      nothingDeclined: 'Nothing declined measurably against last week.',
      noFriction: 'No friction recorded this week.',
      noWins: 'No wins recorded this week.',
    },
    experiments: {
      untitled: 'Untitled experiment',
      name: 'Name',
      namePlaceholder: 'What are you trying?',
      hypothesis: 'Hypothesis',
      hypothesisPlaceholder: 'What do you expect to change?',
      metric: 'Metric',
      metricPlaceholder: 'focus, sleep, TradingView opens…',
      baseline: 'Baseline',
      baselinePlaceholder: 'Where it stands now',
      resultField: 'Result',
      resultPlaceholder: 'What actually happened',
      from: 'From',
      until: 'Until',
      meta: (metric, baseline) => `Metric: ${metric} · baseline: ${baseline}`,
      result: (text) => `Result: ${text}`,
      noResult: 'No result recorded yet.',
      empty: 'No experiments yet. Start one below — one at a time works best.',
      add: 'New experiment',
      seed: 'Start the TradingView one',
      caveat: (minGroup) => 'Results follow the same rule as everything else here: a comparison '
        + `appears only once both sides have at least ${minGroup} reported days, and it is an `
        + 'observed association, never a proven effect.',
      seedName: 'No TradingView before the morning routine',
      seedHypothesis: 'Leaving the chart until after the routine protects focus.',
      seedMetric: 'focus (and TradingView opens)',
    },
  },

  settings: {
    summary: 'Settings — targets, sync and backup',
    proteinTarget: 'Protein target (g)',
    waterTarget: 'Water target (L)',
    saveTargets: 'Save targets',
    targetsNote: 'Changing a target relabels the toggle from now on. Days already recorded keep '
      + 'the target that was in force when you reported them.',
    syncHeading: 'Cross-device sync',
    syncOn: (host) => `Syncing across devices through ${host}.`,
    syncOff: 'Optional. Without it everything still works on this device — sync only adds the '
      + 'ability to check in on the phone and read it on the desktop.',
    syncForget: 'Turn off sync',
    serverUrl: 'Sync server address',
    serverToken: 'Sync token',
    backupHeading: 'Backup',
    backupNote: 'Your Personal OS data lives in this browser, and on the sync server only if '
      + 'sync is on. Neither is a backup you control. Download a copy you keep.',
    download: 'Download a backup',
    restore: 'Restore from a file',
    downloaded: (days) => `Saved ${days} day${days === 1 ? '' : 's'}.`,
    restored: (days, topics, recalls) => `Restored ${days} day${days === 1 ? '' : 's'}, `
      + `${topics} topic${topics === 1 ? '' : 's'} and ${recalls} recall${recalls === 1 ? '' : 's'}. `
      + 'Anything newer than the backup was kept.',
    // Was "Could not read that file: <raw exception>".
    restoreFailed: 'That file could not be read as a Jarvis backup. Pick the .json file the '
      + 'Download button produced, unedited.',
  },

  // ---- Personal OS: Memory ------------------------------------------------
  memory: {
    ghostHeading: 'No topics yet',
    ghostSub: 'Record what you studied on Today and it lands here, with a recall prompt '
      + 'scheduled a couple of days later.',
    ghostNudge: 'Tick HTB on Today and name the topic',
    dueCount: (n) => `${n} review${n === 1 ? '' : 's'} due`,
    dueSub: 'Start to clear the queue',
    review: 'Review',
    queueClear: 'Queue clear',
    nextReview: (date) => `Next review ${date}`,
    dueNow: 'Due now',
    scheduled: 'Scheduled',
    dueLabel: 'Due now',
    nextLabel: (date) => `Next ${date}`,
    interval: (days) => `every ${days}d`,
    // The topic is bolded inside the sentence, so this one takes ready-made
    // HTML: the caller escapes the topic before passing it in.
    questionHtml: (topicHtml) => `Explain how <b>${topicHtml}</b> works, without looking at your notes.`,
    // Handed to an outside evaluator by the owner; nothing is sent anywhere
    // by the app itself.
    evaluationPrompt: (topic, answer) => [
      'Please grade this recall attempt.',
      '',
      `Topic: ${topic}`,
      'Question: Explain how it works, without looking at notes.',
      '',
      'My answer:',
      answer,
      '',
      'Give a score out of 10 and list the weak points, briefly.',
    ].join('\n'),
    unnamedTopic: 'this topic',
    learned: (date, sinceDays) => `learned ${date}${sinceDays !== null ? ` · ${sinceDays}d ago` : ''}`,
    studied: (count, recalls) => `studied ${count}× · ${recalls} recall${recalls === 1 ? '' : 's'}`,
    answerPlaceholder: 'Explain it in your own words…',
    answerLabel: (topic) => `Your explanation of ${topic}`,
    reveal: 'Tap to reveal answer area',
    write: 'Write a recall',
    removeTopic: 'Remove',
    ratings: {
      again: { label: 'Again', hint: 'same interval' },
      good: { label: 'Good', hint: 'next interval' },
      easy: { label: 'Easy', hint: 'skip ahead' },
    },
    attempts: {
      history: (n) => `Recall history (${n})`,
      score: (score) => `${score}/10`,
      notEvaluated: 'not evaluated',
      weakPoints: (points) => `Weak points: ${points}`,
      copy: 'Copy for evaluation',
      copied: 'Copied',
      evalNote: 'Paste your explanation into an evaluator you trust, then record what it said. '
        + 'Your answer above is never altered.',
      scoreField: 'Score',
      weakField: 'Weak points',
      weakPlaceholder: 'TGT/TGS relationship',
      saveEval: 'Save evaluation',
      addEval: 'Add evaluation',
      updateEval: 'Update evaluation',
    },
    retention: {
      heading: 'Retention',
      topic: 'Topic',
      learned: 'Learned',
      recalls: 'Recalls',
      score: 'Score',
      weakAreas: 'Weak areas',
      note: 'A score appears only once a recall attempt has actually been evaluated.',
    },
  },

  // ---- Personal OS: History -----------------------------------------------
  history: {
    ghostHeading: 'No days recorded yet',
    ghostSub: 'Once you close a day it appears here, and every past day stays editable.',
    ghostNudge: 'Close your first day on Today',
    pickDay: 'Pick a day',
    fields: {
      sleep: 'Sleep',
      sleepQuality: 'Sleep quality',
      mood: 'Mood',
      energy: 'Energy',
      focus: 'Focus',
      tradingViewOpens: 'TradingView opens',
      screenTime: 'Screen time (min)',
      htbTopic: 'HTB topic',
      spiritualLearning: 'Spiritual learning',
    },
    sleepValue: (start, end, duration) => `${start} → ${end} · ${duration}`,
    priorities: 'Priorities',
    win: 'Win',
    friction: 'Friction',
    editDay: 'Edit this day on Today',
    pipLabel: (label, value) => `${label} ${value === null ? 'not rated' : `${value} of 10`}`,
  },
};

// Browser: a global, loaded before every other script. Node: required by the
// logic suites, which run these modules outside a page.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { STRINGS };
}
