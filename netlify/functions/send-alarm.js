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

    // items 가져오기 (Realtime Database)
    const itemsSnap = await db.ref('scheduler/items').get();
    if (!itemsSnap.exists()) return { statusCode: 200, body: 'no items' };
    const itemsRaw = itemsSnap.val() || {};
    const items = Array.isArray(itemsRaw) ? itemsRaw : Object.values(itemsRaw);

    // FCM 토큰 가져오기
    const tokenSnap = await db.ref('scheduler/fcmTokens').get();
    const tokensRaw = tokenSnap.exists() ? tokenSnap.val() : {};
    const allTokens = Object.values(tokensRaw).filter(t => t && t !== 'test');
    // 모바일 토큰만 FCM 전송 (객체 형태 또는 문자열 형태 모두 처리)
    const tokens = allTokens.map(t => typeof t === 'object' ? t : { token: t, isMobile: false })
      .filter(t => t.isMobile)
      .map(t => t.token);
    if (tokens.length === 0) return { statusCode: 200, body: 'no tokens' };

    const messages = [];

    items.forEach(item => {
      if (!item.date || item.done) return;
      if (!item.alarms || item.alarms.length === 0) return;

      const timeStr = item.allDay ? '09:00' : (item.time || '09:00');
      const [h, m] = timeStr.split(':').map(Number);
      const baseDate = new Date(item.date + 'T00:00:00');
      baseDate.setHours(h, m, 0, 0);
      const baseMs = baseDate.getTime();

      item.alarms.forEach(alarm => {
        const offsetMins = (alarm.days || 0) * 1440 + (alarm.hours || 0) * 60 + (alarm.mins || 0);
        const fireMs = baseMs - offsetMins * 60 * 1000;

        // 현재 시각 기준 ±30초 (테스트 모드면 항상 전송)
        if (isTest || Math.abs(fireMs - nowMs) <= 30000) {
          const offsetLabel = offsetMins === 0 ? '지금' : `${offsetMins}분 전`;
          messages.push({
            title: `⏰ ${item.title}`,
            body: item.allDay ? '종일 일정' : `${timeStr} 일정 (${offsetLabel})`,
            sound: alarm.sound || 'normal'
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

    return { statusCode: 200, body: `sent ${messages.length} alarms` };
  } catch (err) {
    console.error('send-alarm error:', err);
    return { statusCode: 500, body: err.message };
  }
};
