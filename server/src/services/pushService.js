// Web Push: ключи VAPID и отправка уведомлений на подписанные устройства
// пользователя. Используется роутом /push и планировщиком напоминаний
// (taskReminders.js).
//
// Ключи VAPID берутся из переменных окружения VAPID_PUBLIC_KEY /
// VAPID_PRIVATE_KEY, а если их нет — создаются при первом обращении и
// хранятся в таблице push_vapid_keys (ручная настройка не нужна).

const webpush = require('web-push');

const db = require('../db');

const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:noreply@modul3d.app';

let vapidPromise = null;

async function loadVapid() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const read = async () => {
    const { rows } = await db.query('SELECT public_key, private_key FROM push_vapid_keys WHERE id = 1');
    return rows.length ? { publicKey: rows[0].public_key, privateKey: rows[0].private_key } : null;
  };
  const existing = await read();
  if (existing) return existing;
  const keys = webpush.generateVAPIDKeys();
  // Два сервера могут стартовать одновременно — побеждает первая запись.
  await db.query(
    'INSERT INTO push_vapid_keys (id, public_key, private_key) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING',
    [keys.publicKey, keys.privateKey]
  );
  return (await read()) || { publicKey: keys.publicKey, privateKey: keys.privateKey };
}

function getVapid() {
  if (!vapidPromise) {
    vapidPromise = loadVapid().catch((err) => { vapidPromise = null; throw err; });
  }
  return vapidPromise;
}

async function getPublicKey() {
  return (await getVapid()).publicKey;
}

// Реальная отправка одной подписке. Бросает ошибку web-push (у неё есть
// statusCode: 404/410 — подписка умерла).
async function sendNotification(sub, payload) {
  const vapid = await getVapid();
  return webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    JSON.stringify(payload),
    {
      TTL: 3600,
      urgency: 'high',
      vapidDetails: { subject: SUBJECT, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    }
  );
}

function isDeadSubscription(err) {
  return err && (err.statusCode === 404 || err.statusCode === 410);
}

// Отправляет payload на все подписки пользователя. send можно подменить в
// тестах. Возвращает { devices, sent, removed, failed }:
//   sent    — доставлено сервису push (устройство получит, когда онлайн);
//   removed — подписка устарела и удалена;
//   failed  — временная ошибка (сеть, 5xx) — можно повторить позже.
async function sendToUser(userId, payload, { send = sendNotification } = {}) {
  const { rows } = await db.query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [userId]
  );
  const out = { devices: rows.length, sent: 0, removed: 0, failed: 0 };
  for (const sub of rows) {
    try {
      await send(sub, payload);
      out.sent += 1;
      await db.query('UPDATE push_subscriptions SET last_ok_at = now() WHERE id = $1', [sub.id]);
    } catch (err) {
      if (isDeadSubscription(err)) {
        out.removed += 1;
        await db.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
      } else {
        out.failed += 1;
        console.error('[push] не удалось отправить:', err && (err.statusCode || err.message));
      }
    }
  }
  return out;
}

module.exports = { getPublicKey, sendToUser, sendNotification };
