// Push notifications -- mirrors the existing Telegram alerts (SMA150
// breakout, CCI reclaim watchlist, alert-performance summary) through an
// additional channel. No new alert logic lives here; market_data.py's
// send_push() fires alongside send_telegram() at the same call sites.
//
// This is a static, credential-less viewer, so there's no backend to
// receive a subscription. The one-time setup is manual: click "Enable"
// once, then copy the subscription JSON this produces into the
// PUSH_SUBSCRIPTION GitHub secret (VAPID_PRIVATE_KEY is the other secret,
// generated once and never shipped to the client). Public keys are meant
// to be shared, so the public half is just a constant here.
const VAPID_PUBLIC_KEY = 'BCA9omTyh3puuRQ-3wP1J7gewncKmk6tPEr9vWhxtgtl7eBj4LQcnFLOOaGoJgeimLlPQ5yOpyAbVJ_2hXXpMQQ';

const PUSH_DISMISSED_KEY = 'jarvis:push:dismissed';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function renderPushSubscriptionBox(mount, subscription) {
  const json = JSON.stringify(subscription);
  mount.innerHTML = `
    <div class="push-subscription-box">
      <textarea readonly aria-label="Push subscription JSON">${escapeHtml(json)}</textarea>
      <p class="push-subscription-hint">Subscribed. Copy the value above into a new
        <code>PUSH_SUBSCRIPTION</code> secret on the private repo (Settings → Secrets →
        Actions) so scheduled scans can send to it -- this is a one-time step,
        this device won't ask again.</p>
    </div>`;
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
  renderPushSubscriptionBox(mount, subscription);
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
