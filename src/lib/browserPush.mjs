export function browserPushSupported(win = window) {
  return win.isSecureContext && 'Notification' in win && 'PushManager' in win && 'serviceWorker' in win.navigator;
}

async function api(path, method = 'GET', body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`/api/push/${path}`, {
      method, cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error('Browser notifications could not be saved. Please try again.');
    return await response.json();
  } finally { clearTimeout(timer); }
}

export async function prepareBrowserPush(subscriber) {
  if (!browserPushSupported()) return { state: 'unsupported' };
  if (Notification.permission === 'denied') return { state: 'denied' };
  const config = await api('config');
  if (!config.enabled || !config.publicKey) return { state: 'unavailable' };
  const registration = await navigator.serviceWorker.register('/notifications/sw.js', { scope: '/notifications/' });
  if (!registration.active) {
    await new Promise((resolve, reject) => {
      const worker = registration.installing || registration.waiting;
      const done = error => { clearTimeout(timer); worker?.removeEventListener('statechange', changed); error ? reject(error) : resolve(); };
      const changed = () => { if (worker?.state === 'activated') done(); else if (worker?.state === 'redundant') done(new Error('Notification setup failed.')); };
      const timer = setTimeout(() => done(new Error('Notification setup timed out. Please try again.')), 10_000);
      worker?.addEventListener('statechange', changed);
      if (registration.active) done();
    });
  }
  const subscription = await registration.pushManager.getSubscription();
  const status = subscription ? await api('status', 'POST', { ...credentials(subscriber), endpoint: subscription.endpoint }) : { active: false };
  return { state: status.active ? 'enabled' : 'ready', registration, publicKey: config.publicKey };
}

export async function enableBrowserPush(prepared, subscriber) {
  // Call synchronously from the click handler, before any other awaited work.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ...prepared, state: permission === 'denied' ? 'denied' : 'ready' };
  let subscription = await prepared.registration.pushManager.getSubscription();
  if (!subscription) {
    const key = prepared.publicKey.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(key), c => c.charCodeAt(0));
    subscription = await prepared.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  }
  await api('subscriptions', 'POST', { ...credentials(subscriber), subscription: subscription.toJSON() });
  return { ...prepared, state: 'enabled' };
}

export async function disableBrowserPush(prepared, subscriber) {
  const subscription = await prepared.registration.pushManager.getSubscription();
  if (subscription) {
    // Stop server delivery first, so an offline deletion cannot look successful.
    await api('subscriptions', 'DELETE', { ...credentials(subscriber), endpoint: subscription.endpoint });
    await subscription.unsubscribe();
  }
  return { ...prepared, state: 'ready' };
}

function credentials(subscriber) {
  return { subscriberId: subscriber.subscriberId, subscriberToken: subscriber.subscriberToken };
}
