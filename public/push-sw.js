/* XauCloud Apex first-party Web Push service worker */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'XauCloud Apex';
  const options = {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: Boolean(data.renotify),
    requireInteraction: Boolean(data.requireInteraction),
    data: data.data || { url: '/' },
    icon: '/apex-icon.svg',
    badge: '/apex-icon.svg'
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      try {
        const target = new URL(url, self.location.origin);
        const current = new URL(client.url);
        if (current.origin === target.origin) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target.href);
          return;
        }
      } catch (_) {}
    }
    if (clients.openWindow) await clients.openWindow(url);
  })());
});
