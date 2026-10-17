self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    console.error('GoalFlow received an invalid push payload:', error);
    data = { title: 'GoalFlow reminder', body: 'You have unfinished tasks waiting.' };
  }
  event.waitUntil(self.registration.showNotification(data.title || 'GoalFlow reminder', {
    body: data.body || 'You have unfinished tasks waiting.',
    icon: '/favicon.svg',
    tag: 'goalflow-incomplete-tasks',
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url === target);
    return existing ? existing.focus() : self.clients.openWindow(target);
  }));
});
