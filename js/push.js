// Push notifications -- mirrors the existing Telegram alerts (SMA150
// breakout, CCI reclaim watchlist, alert-performance summary) through an
// additional channel. No new alert logic lives here; market_data.py's
// send_push() fires alongside send_telegram() at the same call sites.
//
// This is a static, credential-less viewer, so there's no backend to
// receive a subscription except the same optional Railway sync host the
// Training zone already talks to (see training.js's docstring for the
// identical pattern). If a push sync URL+token is configured on this
// device, subscribing POSTs straight to webhook_server.py's
// /push-subscribe (backed by push_store.py), which market_data.py's
// send_push() then fans out to on every alert -- one device subscribing
// doesn't overwrite another's subscription, both get every alert. Without
// sync configured (or if the POST fails), falls back to the original
// manual flow: copy the subscription JSON into the PUSH_SUBSCRIPTION
// secret yourself. VAPID_PRIVATE_KEY is generated once and never shipped
// to the client; the public half is just a constant here since public
// keys are meant to be shared.
const VAPID_PUBLIC_KEY = 'BIE4HA2AoTPLgW63by4wtJjyCCR1CIKjZ3p7EGow5NB5EC8Zw9PH7G544QgC6vO2FcAZpyRZyyaAPUg9BOyATCg';

const PUSH_DISMISSED_KEY = 'jarvis:push:dismissed';
const PUSH_SYNC_URL_KEY = 'jarvis:push:syncUrl';
const PUSH_SYNC_TOKEN_KEY = 'jarvis:push:syncToken';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function pushSyncConfig() {
  try {
    return {
      url: (localStorage.getItem(PUSH_SYNC_URL_KEY) || '').replace(/\/+$/, ''),
      token: localStorage.getItem(PUSH_SYNC_TOKEN_KEY) || '',
    };
  } catch (e) {
    return { url: '', token: '' };
  }
}

function savePushSyncConfig(url, token) {
  try {
    localStorage.setItem(PUSH_SYNC_URL_KEY, url.replace(/\/+$/, ''));
    localStorage.setItem(PUSH_SYNC_TOKEN_KEY, token);
  } catch (e) { /* non-fatal */ }
}

// Registers this device's subscription with the shared server so every
// other subscribed device keeps getting alerts too (an add, never a
// replace -- see push_store.add_subscription's endpoint-keyed upsert).
// Returns true only on a confirmed 200 so the caller can fall back to the
// manual copy-paste box when sync isn't configured or the POST fails.
async function registerSubscriptionWithServer(subscription) {
  const { url, token } = pushSyncConfig();
  if (!url || !token) return false;
  try {
    const resp = await fetch(`${url}/push-subscribe`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

function renderPushSubscriptionBox(mount, subscription) {
  const json = JSON.stringify(subscription);
  mount.innerHTML = `
    <div class="push-subscription-box">
      <textarea readonly aria-label="Push subscription JSON">${escapeHtml(json)}</textarea>
      <p class="push-subscription-hint">Subscribed, but couldn't register automatically. Copy the value
        above into a new <code>PUSH_SUBSCRIPTION</code> secret on the private repo (Settings → Secrets →
        Actions) so scheduled scans can send to it -- or set up sync below instead so this (and every
        other) device registers itself.</p>
      ${renderPushSyncSetupHtml()}
    </div>`;
  wirePushSyncSetup(mount, subscription);
}

function renderPushSyncedNoticeHtml(mount) {
  const { url } = pushSyncConfig();
  let host = url;
  try { host = new URL(url).host; } catch (e) { /* keep raw string if unparseable */ }
  mount.innerHTML = `<p class="push-subscription-hint">Subscribed and registered via ${escapeHtml(host)} --
    this device will get alerts alongside any other device you've enabled push on.</p>`;
}

// Same "optional, set up inline, not a global settings page" pattern as
// training.js's renderTrainingSyncSectionHtml -- push is the only other
// zone that needs a server address, so it doesn't warrant its own screen.
function renderPushSyncSetupHtml() {
  return `
    <details class="training-sync-setup">
      <summary class="local-note">Register automatically on future devices (optional) — set up</summary>
      <form id="push-sync-form" class="unlock-form" autocomplete="off">
        <input type="url" id="push-sync-url" placeholder="https://your-app.up.railway.app" required>
        <input type="password" id="push-sync-token" placeholder="Push sync token" required autocomplete="off">
        <button type="submit">Save &amp; register this device</button>
      </form>
    </details>`;
}

function wirePushSyncSetup(mount, subscription) {
  const form = mount.querySelector('#push-sync-form');
  if (!form) return;
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const url = mount.querySelector('#push-sync-url').value.trim();
    const token = mount.querySelector('#push-sync-token').value.trim();
    if (!url || !token) return;
    savePushSyncConfig(url, token);
    const ok = await registerSubscriptionWithServer(subscription);
    if (ok) {
      renderPushSyncedNoticeHtml(mount);
    } else {
      const note = document.createElement('p');
      note.className = 'push-subscription-hint';
      note.style.color = 'var(--loss)';
      note.textContent = 'Could not reach that server -- double check the URL and token.';
      form.after(note);
    }
  });
}

async function subscribeToPush(mount) {
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const registered = await registerSubscriptionWithServer(subscription);
  if (registered) {
    renderPushSyncedNoticeHtml(mount);
  } else {
    renderPushSubscriptionBox(mount, subscription);
  }
}

async function renderPushBanner() {
  const mount = document.getElementById('push-banner-mount');
  if (!mount) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
  if (Notification.permission === 'denied') return; // browser-level block, nothing to offer
  try {
    if (localStorage.getItem(PUSH_DISMISSED_KEY)) return;
  } catch (e) { /* non-fatal */ }

  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration) return;
  const existing = await registration.pushManager.getSubscription().catch(() => null);
  if (existing) return; // already subscribed on this device, nothing to show

  mount.innerHTML = `
    <div class="push-banner" id="push-banner">
      <span class="push-banner-label">${ICONS.bell()} Get breakout alerts as push notifications, same as the Telegram bot sends.</span>
      <button type="button" id="push-enable-btn">Enable push notifications</button>
      <button type="button" class="push-banner-dismiss" id="push-dismiss-btn" aria-label="Dismiss">&times;</button>
    </div>`;

  document.getElementById('push-enable-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Enabling…';
    try {
      await subscribeToPush(document.getElementById('push-banner'));
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Enable push notifications';
      const banner = document.getElementById('push-banner');
      const errNote = document.createElement('p');
      errNote.className = 'push-subscription-hint';
      errNote.style.color = 'var(--loss)';
      errNote.textContent = 'Could not enable push notifications (permission denied or unsupported).';
      banner.appendChild(errNote);
    }
  });
  document.getElementById('push-dismiss-btn').addEventListener('click', () => {
    try { localStorage.setItem(PUSH_DISMISSED_KEY, '1'); } catch (e) { /* non-fatal */ }
    mount.innerHTML = '';
  });
}

renderPushBanner();
