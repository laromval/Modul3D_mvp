// Подписки браузера на push-уведомления (напоминания о задачах).
//
// Контракт (Authorization: Bearer <JWT>, подтверждённый email):
//   GET  /push/config                    -> { publicKey }   (ключ VAPID для pushManager.subscribe)
//   GET  /push/devices                   -> { count }       (сколько устройств подписано)
//   POST /push/subscribe { endpoint, keys: { p256dh, auth } }
//   POST /push/unsubscribe { endpoint }
//   POST /push/test                      -> { devices, sent } (тестовое уведомление себе)

const express = require('express');

const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireVerifiedEmail } = require('../middleware/emailVerification');
const pushService = require('../services/pushService');

const router = express.Router();

router.use(express.json({ limit: '16kb' }));
router.use(requireAuth);
router.use(requireVerifiedEmail);

const MAX_DEVICES_PER_USER = 10;

function fail(err, res, what) {
  console.error(`[push/${what}] ошибка:`, err);
  return res.status(500).json({ error: 'Не удалось выполнить операцию с уведомлениями.' });
}

router.get('/config', async (req, res) => {
  try {
    return res.json({ publicKey: await pushService.getPublicKey() });
  } catch (err) {
    return fail(err, res, 'config');
  }
});

router.get('/devices', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE user_id = $1', [req.user.id]);
    return res.json({ count: rows[0].n });
  } catch (err) {
    return fail(err, res, 'devices');
  }
});

router.post('/subscribe', async (req, res) => {
  const b = req.body || {};
  const keys = b.keys || {};
  const okStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (!okStr(b.endpoint, 2000) || !/^https:\/\//i.test(b.endpoint) || !okStr(keys.p256dh, 200) || !okStr(keys.auth, 100)) {
    return res.status(400).json({ error: 'Некорректная подписка на уведомления.' });
  }
  const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 300) : null;
  try {
    // Один и тот же браузер мог раньше быть подписан под другим аккаунтом —
    // тогда подписка переходит к текущему.
    await db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
      [req.user.id, b.endpoint, keys.p256dh, keys.auth, ua]
    );
    // Не больше MAX_DEVICES_PER_USER: лишние (самые старые) удаляем.
    await db.query(
      `DELETE FROM push_subscriptions WHERE user_id = $1 AND id NOT IN (
         SELECT id FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT ${MAX_DEVICES_PER_USER})`,
      [req.user.id]
    );
    return res.status(201).json({ ok: true });
  } catch (err) {
    return fail(err, res, 'subscribe');
  }
});

router.post('/unsubscribe', async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (typeof endpoint !== 'string' || !endpoint) return res.status(400).json({ error: 'Не указан адрес подписки.' });
  try {
    await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.user.id]);
    return res.json({ ok: true });
  } catch (err) {
    return fail(err, res, 'unsubscribe');
  }
});

router.post('/test', async (req, res) => {
  try {
    const r = await pushService.sendToUser(req.user.id, {
      title: 'Проверка уведомлений',
      body: 'Если вы это видите, напоминания о задачах будут приходить так же.',
      tag: 'push-test',
      url: '/?open=clients',
    });
    if (r.devices === 0) return res.status(409).json({ error: 'Нет подключённых устройств: сначала включите уведомления.' });
    if (r.sent === 0) return res.status(502).json({ error: 'Не удалось отправить уведомление. Попробуйте включить уведомления заново.' });
    return res.json({ devices: r.devices, sent: r.sent });
  } catch (err) {
    return fail(err, res, 'test');
  }
});

module.exports = router;
