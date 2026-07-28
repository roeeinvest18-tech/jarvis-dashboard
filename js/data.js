// Data loading: same-origin fetch of the committed dashboard_data/*.json
// files (synced here by GitHub Actions from the private morning-scout repo).
// No client ever talks to Gmail/CalDAV/IBKR/yfinance directly -- this is a
// pure viewer. Manual refresh only: no polling, no websockets.
//
// email/tasks/calendar ship as password-encrypted envelopes on the public
// build (see build_pwa.py's ENCRYPTED_ZONE_ALLOWLIST) -- the ciphertext is
// world-readable same as everything else on GitHub Pages, but unreadable
// without the password. Decryption happens entirely in the browser via
// SubtleCrypto; the password is never sent anywhere.

// A remembered password lives only in this browser's localStorage, so
// unlocking is one-time per device, not per page load -- but a stranger who
// just has the URL never has it.
const ZONE_PASSWORD_KEY = 'jarvis:zonePassword';

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Mirrors build_pwa.py's encrypt_payload(): PBKDF2-SHA256 -> AES-256-GCM,
// both sides using the standard construct (12-byte IV, tag appended to the
// ciphertext) so no custom framing has to travel with the envelope.
async function decryptEnvelope(envelope, password) {
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: envelope.iterations, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plainBuf);
}

const DASHBOARD = {
  FILES: {
    scan: 'dashboard_data/scan.json',
    cciOversold: 'dashboard_data/cci_oversold.json',
    emails: 'dashboard_data/emails.json',
    calendar: 'dashboard_data/calendar.json',
    build: 'dashboard_data/build.json',
    tasks: 'dashboard_data/tasks.json',
    priority: 'dashboard_data/priority.json',
    tradeNotes: 'dashboard_data/trade_notes.json',
  },

  cache: {},

  // Feeds whose file wasn't there at all (404). Distinct from a feed that
  // loaded and happens to be empty: "withheld from this build" and "nothing
  // to show today" are different facts, and collapsing them makes a
  // deliberately-trimmed public page look broken.
  missing: new Set(),

  // Feeds that loaded but arrived as a password-encrypted envelope (public
  // build, email/tasks/calendar). Distinct from both "withheld" (never
  // shipped at all) and "empty" (shipped, decrypted, nothing in it) --
  // "locked" means the ciphertext is sitting right there, just unreadable
  // without the password.
  locked: new Set(),
  encryptedCache: {},

  // Keys where the actual network request failed this fetchAll() (offline,
  // DNS, CORS, etc.) and we fell back to a cached copy. Distinct from a 404
  // (that file just isn't published in this build, which is normal) --
  // this is what the refresh button's success/error indicator checks, so a
  // real fetch failure surfaces instead of silently re-showing stale data.
  networkFailed: new Set(),

  async fetchOne(key) {
    const url = `${this.FILES[key]}?t=${Date.now()}`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        if (res.status === 404) this.missing.add(key);
        return null;
      }
      this.missing.delete(key);
      const json = await res.json();
      if (json && json.encrypted === true) {
        this.encryptedCache[key] = json;
        this.locked.add(key);
        return null;
      }
      this.locked.delete(key);
      this.cache[key] = json;
      try { localStorage.setItem(`dash:${key}`, JSON.stringify(json)); } catch (e) { /* storage full/unavailable — non-fatal */ }
      return json;
    } catch (e) {
      // Offline or file genuinely missing -- fall back to last-known-good.
      this.networkFailed.add(key);
      const stored = localStorage.getItem(`dash:${key}`);
      if (stored) {
        try { return JSON.parse(stored); } catch (parseErr) { return null; }
      }
      return null;
    }
  },

  async fetchAll() {
    const keys = ['scan', 'cciOversold', 'emails', 'calendar', 'tasks', 'priority',
                  'tradeNotes', 'build'];
    this.missing.clear();
    this.networkFailed.clear();
    const results = await Promise.all(keys.map(k => this.fetchOne(k)));
    const out = Object.fromEntries(keys.map((k, i) => [k, results[i]]));
    this.build = out.build || null;
    // A remembered password (see ZONE_PASSWORD_KEY) unlocks silently, same
    // device only -- a stranger with just the URL never sees it prompted.
    if (this.locked.size) {
      const remembered = localStorage.getItem(ZONE_PASSWORD_KEY);
      if (remembered) await this.unlockAll(remembered);
    }
    for (const key of Object.keys(this.encryptedCache)) {
      if (!this.locked.has(key)) out[key] = this.cache[key];
    }
    return out;
  },

  // Tries `password` against every locked zone. Returns true if at least one
  // unlocked -- all 3 personal zones are encrypted with the same password,
  // so in practice this is all-or-nothing, but a partial success (e.g. a
  // future zone added with a different password) still surfaces what it can.
  async unlockAll(password) {
    let any = false;
    for (const key of Object.keys(this.encryptedCache)) {
      if (await this.unlockOne(key, password)) any = true;
    }
    return any;
  },

  async unlockOne(key, password) {
    const envelope = this.encryptedCache[key];
    if (!envelope) return false;
    try {
      const plaintext = await decryptEnvelope(envelope, password);
      const json = JSON.parse(plaintext);
      this.cache[key] = json;
      this.locked.delete(key);
      try { localStorage.setItem(`dash:${key}`, JSON.stringify(json)); } catch (e) { /* non-fatal */ }
      return true;
    } catch (e) {
      return false;
    }
  },

  // True only when THIS build deliberately excluded the feed. A file that's
  // simply absent because its feed was never configured is a different
  // situation and gets a different message.
  isWithheld(key) {
    const file = (this.FILES[key] || '').split('/').pop();
    const b = this.build;
    if (!b) return false;
    // A public build excludes anything off its allowlist by policy -- true
    // even for feeds that have no file yet, which would still never ship.
    if (b.allowlist) return !b.allowlist.includes(file);
    return (b.withheld || []).includes(file);
  },
};

// ---- Formatting helpers ---------------------------------------------------

function fmtPrice(v) {
  if (v === null || v === undefined) return '—';
  return v.toFixed(2);
}

function fmtChange(v) {
  if (v === null || v === undefined) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

function fmtPct(v, digits = 1) {
  if (v === null || v === undefined) return null;
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

function fmtTime(isoOrHHMM) {
  if (!isoOrHHMM) return '';
  if (/^\d{2}:\d{2}$/.test(isoOrHHMM)) return isoOrHHMM;
  try {
    return new Date(isoOrHHMM).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

function fmtRelative(isoTimestamp) {
  if (!isoTimestamp) return 'never';
  const diffMs = Date.now() - new Date(isoTimestamp).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
