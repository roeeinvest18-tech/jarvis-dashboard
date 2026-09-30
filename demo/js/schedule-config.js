// The Today schedule: which group each item sits in and when it is due.
//
// This is CONFIGURATION: the times are data here, not constants buried in
// rendering or analytics code, so moving a deadline is a one-line edit to this
// file and nothing else. It carries no scoring model and no personal data,
// only clock times.
//
// Everything is derived from this list on read. Nothing computed from it is
// written into a day's record, so changing a deadline re-reads all history
// against the new time rather than stranding days under the old one.
//
// ITEM KINDS
//   check        a habit checkbox. Its id is a habit id from daily.js.
//                deadline: 'HH:MM'  due by this time, or
//                window: ['HH:MM', 'HH:MM']  due within this window (the end is
//                  the deadline the deviation rule measures against), or
//                neither: tracked, but no time is asked of it.
//   note         a reference line with no checkbox (a block, a marker).
//                at: 'HH:MM' or window: [...] or neither.
//   supplements  the supplement list from Settings, one checkbox each.
//
// Labels are not here: the copy rule keeps every user-facing string in
// strings.js (STRINGS.today.schedule), keyed by the same ids.

// A completion more than this many minutes after an item's deadline is
// "out of norm" for that item on that day. Insights only: Today never shows it.
const DAILY_OUT_OF_NORM_AFTER_MIN = 120;

const DAILY_SCHEDULE = [
  {
    id: 'morning',
    items: [
      { kind: 'note', id: 'wake_window', window: ['07:00', '08:00'] },
      { kind: 'check', id: 'getting_ready', deadline: '09:30' },
      { kind: 'check', id: 'tefillin', deadline: '09:30' },
      { kind: 'check', id: 'spiritual_learning', deadline: '09:30' },
      { kind: 'check', id: 'breakfast', deadline: '09:30' },
      { kind: 'note', id: 'learning_block' },
      { kind: 'check', id: 'htb_completed', deadline: '13:30' },
      { kind: 'check', id: 'four_minute_routine', deadline: '09:30' },
      { kind: 'check', id: 'meditation', deadline: '09:30' },
    ],
  },
  {
    id: 'afternoon',
    items: [
      { kind: 'note', id: 'lunch' },
      { kind: 'check', id: 'mobility_posture' },
      { kind: 'check', id: 'workout_completed', window: ['16:00', '18:00'] },
      { kind: 'check', id: 'career_output' },
    ],
  },
  {
    id: 'evening',
    items: [
      { kind: 'check', id: 'protein_target_met' },
      { kind: 'check', id: 'water_target_met' },
      { kind: 'supplements' },
      { kind: 'check', id: 'dinner', deadline: '20:00' },
      { kind: 'note', id: 'wind_down_dim', at: '20:00' },
      { kind: 'check', id: 'wind_down_no_screens', deadline: '21:30' },
      { kind: 'check', id: 'in_bed', window: ['22:00', '23:00'] },
    ],
  },
];

// The deadline the deviation rule measures an item against: its own deadline,
// or the end of its window. null when the item has no time asked of it.
function dailyItemDeadline(item) {
  if (!item) return null;
  if (typeof item.deadline === 'string') return item.deadline;
  if (Array.isArray(item.window) && item.window.length === 2) return item.window[1];
  return null;
}

// Exported for test_daily_logic.js under Node; in the browser this file is a
// plain <script> and these are already globals.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DAILY_SCHEDULE, DAILY_OUT_OF_NORM_AFTER_MIN, dailyItemDeadline };
}
