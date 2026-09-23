// Quiet, rule-based training hints. No goals, no targets, no AI.
//
// The owner's standing decision is that the training log sets no rep goals,
// so these only ever describe what the history already shows and suggest an
// option. Every hint is dismissible and never reappears once dismissed.
//
// Each hint carries a stable id, so dismissing survives re-renders and new
// sessions.

const TRAINING_HINT_SESSIONS = 3;       // how far back a "same again" run looks
const TRAINING_HINT_GAP_DAYS = 10;      // a long break, worth acknowledging kindly

function thTotal(sets) {
  return (sets || []).reduce((a, b) => a + (Number(b) || 0), 0);
}

function thDaysBetween(aIso, bIso) {
  return Math.round((new Date(`${bIso}T12:00:00`) - new Date(`${aIso}T12:00:00`)) / 864e5);
}

// sessions: [{id, date, drills: {drillId: [reps,...]}}], oldest or newest
// order both fine. drillLabels maps drillId -> label.
function trainingProgressionHints(sessions, drillLabels = {}, today = null) {
  const ordered = [...(sessions || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!ordered.length) return [];
  const hints = [];
  const label = id => drillLabels[id] || id.replace(/_/g, ' ');
  const recent = ordered.slice(-TRAINING_HINT_SESSIONS);

  // 1. The same total, session after session, on a drill still using fewer
  //    sets than another session of the same drill has used.
  if (recent.length === TRAINING_HINT_SESSIONS) {
    const drills = new Set(recent.flatMap(s => Object.keys(s.drills || {})));
    for (const drill of drills) {
      const runs = recent.map(s => (s.drills || {})[drill]).filter(Boolean);
      if (runs.length !== TRAINING_HINT_SESSIONS) continue;
      const totals = runs.map(thTotal);
      if (new Set(totals).size !== 1 || totals[0] === 0) continue;
      const maxSets = Math.max(...runs.map(r => r.length));
      const everMore = Math.max(...ordered.map(s => ((s.drills || {})[drill] || []).length));
      hints.push({
        id: `same-total:${drill}:${totals[0]}`,
        drill,
        text: `${label(drill)}: same total for ${TRAINING_HINT_SESSIONS} sessions`
          + (maxSets < everMore || maxSets < 3
            ? ' — the optional extra set is available if you want it.'
            : ' — worth noting, nothing to change.'),
      });
    }
  }

  // 2. A drill that has dropped out of the recent sessions while others kept going.
  if (ordered.length >= TRAINING_HINT_SESSIONS) {
    const seenRecently = new Set(recent.flatMap(s => Object.keys(s.drills || {})));
    const seenBefore = new Set(ordered.slice(0, -TRAINING_HINT_SESSIONS).flatMap(s => Object.keys(s.drills || {})));
    for (const drill of seenBefore) {
      if (!seenRecently.has(drill)) {
        hints.push({
          id: `missing:${drill}:${recent[recent.length - 1].date}`,
          drill,
          text: `${label(drill)} hasn't appeared in your last ${TRAINING_HINT_SESSIONS} sessions.`,
        });
      }
    }
  }

  // 3. A long gap, stated plainly and without judgement.
  const last = ordered[ordered.length - 1];
  const gap = today ? thDaysBetween(last.date, today) : null;
  if (gap !== null && gap >= TRAINING_HINT_GAP_DAYS) {
    hints.push({
      id: `gap:${last.date}`,
      text: `${gap} days since the last session. Starting lighter is normal.`,
    });
  }
  return hints;
}

function trainingVisibleHints(sessions, drillLabels, today, dismissed) {
  const skip = new Set(dismissed || []);
  return trainingProgressionHints(sessions, drillLabels, today).filter(h => !skip.has(h.id));
}

if (typeof module !== 'undefined') {
  module.exports = { trainingProgressionHints, trainingVisibleHints, TRAINING_HINT_SESSIONS };
}
