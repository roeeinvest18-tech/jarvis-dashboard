// US equity market calendar, computed rather than listed.
//
// Holidays follow the NYSE rules, so there is no year-by-year table to go
// stale: New Year's Day, MLK Day, Presidents Day, Good Friday, Memorial Day,
// Juneteenth, Independence Day, Labor Day, Thanksgiving, Christmas -- each
// with the NYSE observance rule (Saturday -> the Friday before, Sunday -> the
// Monday after; New Year's on a Saturday is NOT moved back into December).
// Early closes (13:00 ET): the day before Independence Day, the day after
// Thanksgiving, and Christmas Eve, when those are weekdays.
//
// Times are handled through Intl with IANA zones, so both DST schedules come
// out right on their own -- including the weeks in March and October/November
// when the US and Israel have switched on different dates and the usual
// 16:30 Israel open is 15:30 instead.
//
// Public-tier: nothing here is strategy, it's the exchange's own calendar.

const MC_ET = 'America/New_York';
const MC_IL = 'Asia/Jerusalem';

function mcYmd(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Day of week (0=Sun) for a plain calendar date, timezone-free.
function mcDow(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function mcAddDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return mcYmd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// nth weekday (dow 0=Sun) of a month; n = -1 for the last one.
function mcNthDow(y, m, dow, n) {
  if (n > 0) {
    const first = mcDow(y, m, 1);
    return mcYmd(y, m, 1 + ((dow - first + 7) % 7) + 7 * (n - 1));
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastDow = mcDow(y, m, last);
  return mcYmd(y, m, last - ((lastDow - dow + 7) % 7));
}

// Anonymous Gregorian algorithm.
function mcEaster(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return mcYmd(y, month, day);
}

function mcObserved(y, m, d) {
  const dow = mcDow(y, m, d);
  if (dow === 6) return mcAddDays(mcYmd(y, m, d), -1);
  if (dow === 0) return mcAddDays(mcYmd(y, m, d), 1);
  return mcYmd(y, m, d);
}

const mcHolidayCache = {};
function mcHolidays(y) {
  if (mcHolidayCache[y]) return mcHolidayCache[y];
  const h = {};
  // New Year's: Sunday -> Monday; Saturday -> not observed (NYSE rule 7.2).
  if (mcDow(y, 1, 1) !== 6) h[mcObserved(y, 1, 1)] = "New Year's Day";
  h[mcNthDow(y, 1, 1, 3)] = 'Martin Luther King Jr. Day';
  h[mcNthDow(y, 2, 1, 3)] = "Presidents' Day";
  h[mcAddDays(mcEaster(y), -2)] = 'Good Friday';
  h[mcNthDow(y, 5, 1, -1)] = 'Memorial Day';
  if (y >= 2022) h[mcObserved(y, 6, 19)] = 'Juneteenth';
  h[mcObserved(y, 7, 4)] = 'Independence Day';
  h[mcNthDow(y, 9, 1, 1)] = 'Labor Day';
  h[mcNthDow(y, 11, 4, 4)] = 'Thanksgiving';
  h[mcObserved(y, 12, 25)] = 'Christmas';
  return (mcHolidayCache[y] = h);
}

function mcHolidayName(ymd) {
  return mcHolidays(Number(ymd.slice(0, 4)))[ymd] || null;
}

function mcIsTradingDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = mcDow(y, m, d);
  return dow !== 0 && dow !== 6 && !mcHolidayName(ymd);
}

// 13:00 ET close, or null for a normal 16:00 close.
function mcEarlyClose(ymd) {
  if (!mcIsTradingDay(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (m === 7 && d === 3) return '13:00';
  if (m === 12 && d === 24) return '13:00';
  if (ymd === mcAddDays(mcNthDow(y, 11, 4, 4), 1)) return '13:00';
  return null;
}

// Wall-clock parts of an instant in a zone.
function mcParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return {
    ymd: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute),
    weekday: p.weekday,
  };
}

// The instant at which a zone's wall clock reads ymd hh:mm.
function mcZonedInstant(ymd, hh, mm, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  let t = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 3; i += 1) {
    const p = mcParts(new Date(t), tz);
    const [py, pm, pd] = p.ymd.split('-').map(Number);
    const shown = Date.UTC(py, pm - 1, pd, p.hour, p.minute);
    t += Date.UTC(y, m - 1, d, hh, mm) - shown;
  }
  return new Date(t);
}

// One US session as instants: {ymd, open, close, early}.
function mcSession(ymd) {
  if (!mcIsTradingDay(ymd)) return null;
  const early = mcEarlyClose(ymd);
  const [ch, cm] = (early || '16:00').split(':').map(Number);
  return {
    ymd,
    open: mcZonedInstant(ymd, 9, 30, MC_ET),
    close: mcZonedInstant(ymd, ch, cm, MC_ET),
    early: !!early,
  };
}

// The latest session that has OPENED at `now` (possibly still running).
function mcLatestOpenedSession(now) {
  let ymd = mcParts(now, MC_ET).ymd;
  for (let i = 0; i < 10; i += 1) {
    const s = mcSession(ymd);
    if (s && s.open <= now) return s;
    ymd = mcAddDays(ymd, -1);
  }
  return null;
}

// The next session that hasn't closed yet at `now` (today's if still open).
function mcNextSession(now) {
  let ymd = mcParts(now, MC_ET).ymd;
  for (let i = 0; i < 10; i += 1) {
    const s = mcSession(ymd);
    if (s && s.close > now) return s;
    ymd = mcAddDays(ymd, 1);
  }
  return null;
}

function mcFmtIL(date, opts) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: MC_IL, hourCycle: 'h23', ...opts }).format(date);
}

if (typeof module !== 'undefined') {
  module.exports = {
    mcHolidays, mcHolidayName, mcIsTradingDay, mcEarlyClose, mcSession,
    mcLatestOpenedSession, mcNextSession, mcParts, mcZonedInstant, mcAddDays, mcFmtIL,
  };
}
