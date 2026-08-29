// Общая логика чтения статуса подписки и баланса токенов пользователя.
// Используется /auth/me и (в будущем) серверной генерацией документов
// при проверке доступа к платным функциям.

const db = require('../db');

async function getAccountStatus(userId) {
  const { rows } = await db.query(
    `SELECT
       u.id, u.email, u.created_at, u.nickname, u.avatar_url,
       s.status AS subscription_status,
       s.current_period_end,
       tb.balance AS token_balance
     FROM users u
     LEFT JOIN subscriptions s ON s.user_id = u.id
     LEFT JOIN token_balances tb ON tb.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    subscription: {
      status: row.subscription_status || 'none',
      currentPeriodEnd: row.current_period_end,
    },
    tokenBalance: row.token_balance === null ? 0 : row.token_balance,
  };
}

module.exports = { getAccountStatus };
