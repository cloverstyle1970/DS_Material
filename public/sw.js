// DS 자재관리 Service Worker
// 역할은 Web Push 알림 수신·표시·클릭 라우팅으로 한정 (오프라인 캐싱은 범위 밖).

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = { title: "DS 자재관리", body: "새 알림이 있습니다." };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) {}

  const options = {
    body: data.body,
    icon: data.icon || "/favicon.ico",
    badge: data.badge || "/favicon.ico",
    tag: data.tag || undefined,
    data: { link: data.link || "/", refType: data.refType || null, refId: data.refId || null },
    vibrate: [120, 60, 120],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // 이미 열린 탭이 있으면 포커스 + 해당 링크로 이동 메시지 전달
      for (const client of clientList) {
        if ("focus" in client) {
          client.postMessage({ action: "navigate", link });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
    })
  );
});
