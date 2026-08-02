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
