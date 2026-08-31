// Middleware, требующий подтверждённый email. Ставится ПОСЛЕ requireAuth
// (нужен req.user.id). JWT не переиздаётся в момент подтверждения email
// (см. GET /auth/verify-email), поэтому клейму из токена доверять нельзя —
// значение email_verified_at всегда читается свежим запросом к БД.
//
// Применяется там, где непроверенный email — это дыра для фарма/злоупотреб-
// лений: POST /reviews (нельзя оставить отзыв без способа связаться с
// автором) и POST /sketch/recognize (нельзя тратить, в т.ч. стартовые
// бесплатные, токены без подтверждённого владения email — см.
// ТЗ-МОНЕТИЗАЦИЯ.md и migrations/004_email_verification.sql).

const db = require('../db');

async function requireVerifiedEmail(req, res, next) {
  try {
    const { rows } = await db.query('SELECT email_verified_at FROM users WHERE id = $1', [
      req.user.id,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден.' });
    }

    if (rows[0].email_verified_at === null) {
      return res.status(403).json({
        error: 'Подтвердите email, чтобы продолжить. Проверьте почту или запросите письмо заново (POST /auth/resend-verification).',
      });
    }

    return next();
  } catch (err) {
    console.error('[emailVerification] ошибка проверки статуса email:', err);
    return res.status(500).json({ error: 'Не удалось проверить статус подтверждения email.' });
  }
}

module.exports = { requireVerifiedEmail };
