const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({
    credential: cert(serviceAccount),
    databaseURL: "https://scheduler-app-806ec-default-rtdb.firebaseio.com"
  });
}

const db = getDatabase();

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { token, isMobile } = JSON.parse(event.body);
    if (!token) return { statusCode: 400, body: 'no token' };

    // 토큰을 key로 저장 (중복 방지) + 기기 타입 포함
    const safeKey = token.replace(/[.#$[\]]/g, '_').slice(0, 100);
    await db.ref(`scheduler/fcmTokens/${safeKey}`).set({ token, isMobile: !!isMobile });

    return { statusCode: 200, body: 'token saved' };
  } catch (err) {
    console.error('save-token error:', err);
    return { statusCode: 500, body: err.message };
  }
};
