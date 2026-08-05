self.addEventListener('install', (event) => {
  const base = new URL('./', self.registration.scope);
  event.waitUntil(caches.open('syncbox-shell-v2').then((cache) => cache.addAll([
    base.href,
    new URL('site.webmanifest', base).href,
    new URL('favicon.svg', base).href,
    new URL('app-icon-512.png', base).href,
  ])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('syncbox-shell-') && key !== 'syncbox-shell-v2').map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.endsWith('/notification-sw.js')) return;

  if (request.mode === 'navigate') {
    const fallback = new URL('./', self.registration.scope).href;
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok) {
        const cache = await caches.open('syncbox-shell-v2');
        await cache.put(fallback, response.clone());
      }
      return response;
    }).catch(() => caches.match(fallback)));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request).then(async (response) => {
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open('syncbox-shell-v2');
      await cache.put(request, response.clone());
    }
    return response;
  })));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.notification.data?.action;
  const targetUrl = event.notification.data?.url;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const client = clients[0];
    if (client) {
      await client.focus();
      client.postMessage({ type: 'syncbox-notification-click', action });
      return;
    }
    if (targetUrl) await self.clients.openWindow(targetUrl);
  }));
});
