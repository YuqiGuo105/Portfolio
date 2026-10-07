/* This worker has no fetch handler: it cannot cache private pages or API responses. */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch (_) { /* Display a safe fallback. */ }
  const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
  const task = self.registration.showNotification(text(data.title, 100) || 'Yuqi Portfolio', {
    body: text(data.body, 180) || 'A new update is available.',
    icon: '/favicon.ico',
    tag: text(data.tag, 128) || 'portfolio-update',
    data: { url: safeUrl(data.url) },
  });
  event.waitUntil(task);
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = safeUrl(event.notification.data?.url);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const existing = clients.find(client => client.url === url);
    if (existing) return existing.focus();
    return self.clients.openWindow(url);
  }));
});

function safeUrl(value) {
  try {
    const url = new URL(value || '/', self.location.origin);
    if (url.origin === self.location.origin && ['http:', 'https:'].includes(url.protocol)) return url.href;
  } catch (_) { /* Ignore malformed or external destinations. */ }
  return `${self.location.origin}/`;
}
