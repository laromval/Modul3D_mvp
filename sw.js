// Service worker Modul3D — только для push-уведомлений (напоминания о
// задачах клиентов, см. src/clientTasks.js и server/src/services/taskReminders.js).
// Никакого кеширования и перехвата запросов здесь нет: приложение
// обновляется как обычная страница.
//
// Подключается лениво: браузер регистрирует этот файл только когда
// пользователь сам включил уведомления.

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  var title = data.title || 'Modul3D';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    vibrate: [200, 100, 200],
    data: { url: data.url || '/?open=clients' }
  }));
});

// Нажатие на уведомление: если программа уже открыта — переключаемся на неё
// и просим открыть экран задач, иначе открываем новую вкладку.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/?open=clients';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if ('focus' in c) {
        c.postMessage({ type: 'open-tasks' });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
