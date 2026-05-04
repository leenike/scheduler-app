const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({
    credential: cert(serviceAccount),
    databaseURL: "https://scheduler-app-806ec-default-rtdb.firebaseio.com"
  });
}

const db = getDatabase();

exports.handler = async (event) => {
  try {
    const isTest = event.queryStringParameters?.test === 'true';
    const now = new Date();
    const nowMin = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0);
    const nowMs = nowMin.getTime();

    // items 가져오기 - 중첩 구조 처리
    const snap = await db.ref('scheduler/items').get();
    if (!snap.exists()) return { statusCode: 200, body: 'no items' };
    
    const raw = snap.val();
    let items = [];
    
    // scheduler/items/items 중첩 구조 처리
    if (raw && raw.items) {
      const inner = raw.items;
      items = Array.isArray(inner) ? inner : Object.values(inner);
    } else if (Array.isArray(raw)) {
      items = raw;
    } else if (raw) {
      items = Object.values(raw);
    }

    // FCM 토큰 가져오기 (모바일만)
    const tokenSnap = await db.ref('scheduler/fcmTokens').get();
    const tokensRaw = tokenSnap.exists() ? tokenSnap.val() : {};
    const tokens = Object.values(tokensRaw)
      .filter(t => t && typeof t === 'object' && t.isMobile)
      .map(t => t.token);

    if (tokens.length === 0) return { statusCode: 200, body: 'no tokens' };

    const messages = [];

    items.forEach(item => {
      if (!item || !item.date || item.done) return;
      if (!item.alarms || item.alarms.length === 0) return;

      const timeStr = item.allDay ? '09:00' : (item.time || '09:00');
      const [h, m] = timeStr.split(':').map(Number);
      const baseDate = new Date(item.date + 'T00:00:00');
      baseDate.setHours(h, m, 0, 0);
      const baseMs = baseDate.getTime();

      item.alarms.forEach(alarm => {
        const offsetMins = (alarm.days || 0) * 1440 + (alarm.hours || 0) * 60 + (alarm.mins || 0);
        const fireMs = baseMs - offsetMins * 60 * 1000;

        if (isTest || Math.abs(fireMs - nowMs) <= 30000) {
          const offsetLabel = offsetMins === 0 ? '지금' : `${offsetMins}분 전`;
          messages.push({
            title: `⏰ ${item.title}`,
            body: item.allDay ? '종일 일정' : `${timeStr} 일정 (${offsetLabel})`,
          });
        }
      });
    });

    if (messages.length === 0) return { statusCode: 200, body: 'no alarms now' };

    // FCM 전송
    const messaging = getMessaging();
    for (const token of tokens) {
      for (const msg of messages) {
        try {
          await messaging.send({
            token,
            notification: { title: msg.title, body: msg.body },
            webpush: {
              notification: {
                title: msg.title,
                body: msg.body,
                icon: '/icon-192.png',
                requireInteraction: true,
                vibrate: [200, 100, 200],
              },
              fcmOptions: { link: '/' }
            }
          });
        } catch (err) {
          console.log('토큰 오류:', token.slice(0, 20), err.message);
        }
      }
    }

    return { statusCode: 200, body: `sent ${messages.length} alarms to ${tokens.length} devices` };
  } catch (err) {
    console.error('send-alarm error:', err);
    return { statusCode: 500, body: err.message };
  }
};
