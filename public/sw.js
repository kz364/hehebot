// Web Push service worker (TODO.md "Push notifications"). This worker exists
// ONLY to receive push events and notification clicks. It intentionally does
// NOT implement 'fetch', 'install' caching or any offline strategy: the
// portal sits behind Cloudflare Access, and a caching service worker could
// serve a stale authenticated page or interfere with the Access redirect
// flow. Keep this file minimal.

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', event => {
  let payload = { title: 'Hehebot', body: 'You have an update.' };
  try { if (event.data) payload = { ...payload, ...event.data.json() }; } catch {}
  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'Hehebot';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const tag = typeof payload.tag === 'string' ? payload.tag : undefined;
  const url = typeof payload.url === 'string' ? payload.url : '/';
  event.waitUntil(self.registration.showNotification(title, {
    body, tag, data: { url }, renotify: !!tag,
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil((async () => {
    const targetUrl = new URL(url, self.location.origin).href;
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if (client.url === targetUrl && 'focus' in client) { await client.focus(); return; }
    }
    for (const client of clientsList) {
      if ('focus' in client && 'navigate' in client) { await client.focus(); await client.navigate(targetUrl); return; }
    }
    await self.clients.openWindow(targetUrl);
  })());
});
