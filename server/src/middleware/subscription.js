// Мидлвар, требующий активную подписку. Ставится ПОСЛЕ requireAuth (нужен
// req.user.id). Источник истины по контракту — ТЗ-МОНЕТИЗАЦИЯ.md, 4.3
// («Роуты ... все требуют активную подписку»).
//
// В таблице subscriptions.status уже нормализованный статус — billing.js
// (mapPaddleSubscriptionStatus) схлопывает Paddle 'trialing' в 'active' ещё
// на этапе записи в БД, поэтому в этой колонке реального значения
// 'trialing' не бывает и здесь достаточно проверить status === 'active'
// (отдельная ветка под 'trialing' была бы мёртвым кодом).

const db = require('../db');

async function requireActiveSubscription(req, res, next) {
  try {
    const { rows } = await db.query(
      'SELECT status FROM subscriptions WHERE user_id = $1',
      [req.user.id]
    );
    const status = rows[0] && rows[0].status;

    if (status === 'active') {
      return next();
    }

    return res.status(402).json({
      error: 'Требуется активная подписка для экспорта документов.',
    });
  } catch (err) {
    console.error('[subscription] ошибка проверки статуса подписки:', err);
    return res.status(500).json({ error: 'Не удалось проверить статус подписки.' });
  }
}

module.exports = { requireActiveSubscription };
