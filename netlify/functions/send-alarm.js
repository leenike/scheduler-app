const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = getFirestore();

exports.handler = async () => {
  try {
    const now = new Date();
    const nowMin = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0);
    const nowMs = nowMin.getTime();

    // items 가져오기
    const snap = await db.collection('scheduler').doc('items').get();
    if (!snap.exists) return { statusCode: 200, body: 'no items' };
    const items = snap.data().list || [];

    // FCM 토큰 가져오기
    const tokenSnap = await db.collection('scheduler').doc('fcm_tokens').get();
    const tokens = tokenSnap.exists ? (tokenSnap.data().tokens || []) : [];
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
        const fireAt = baseMs - offsetMins * 60 * 1000;

        // 현재 분과 일치하는 알람만 전송
        if (fireAt === nowMs) {
          const offsetLabel = offsetMins === 0 ? '지금' : `${offsetMins}분 전`;
          messages.push({
            title: `⏰ ${item.title}`,
            body: item.allDay ? `종일 일정 알람` : `${timeStr} 일정 (${offsetLabel})`,
          });
        }
      });
    });

    if (messages.length === 0) return { statusCode: 200, body: 'no alarms now' };

    // 각 토큰에 FCM 전송
    const messaging = getMessaging();
    const validTokens = [];

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
              fcmOptions: { link: '/' },
            },
          });
          if (!validTokens.includes(token)) validTokens.push(token);
        } catch (err) {
          console.log('토큰 오류 (만료됨):', token.slice(0, 20));
        }
      }
    }

    // 유효한 토큰만 다시 저장
    if (validTokens.length !== tokens.length) {
      await db.collection('scheduler').doc('fcm_tokens').set({ tokens: validTokens });
    }

    return { statusCode: 200, body: `sent ${messages.length} alarms` };
  } catch (err) {
    console.error('send-alarm error:', err);
    return { statusCode: 500, body: err.message };
  }
};
