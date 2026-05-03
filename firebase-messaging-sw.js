importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyADNy32WP27_hBl4esATFhSvUJEZZmCECQ",
  authDomain: "scheduler-app-806ec.firebaseapp.com",
  projectId: "scheduler-app-806ec",
  storageBucket: "scheduler-app-806ec.firebasestorage.app",
  messagingSenderId: "404232236572",
  appId: "1:404232236572:web:7a1ef0b82ceb88dbbd39d9"
});

const messaging = firebase.messaging();

// 백그라운드 메시지 수신
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || '⏰ 알람', {
    body: body || '일정 시간이 됐어요!',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    data: { url: '/' }
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
