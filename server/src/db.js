// Единый пул подключений к PostgreSQL + небольшие хелперы поверх pg.
// Весь остальной код должен ходить в базу только через этот модуль.

const { Pool } = require('pg');
const config = require('./config');

if (!config.databaseUrl) {
  // Не бросаем исключение здесь, чтобы `require('./db')` не валил процесс
  // раньше времени в местах, где это неожиданно (например при импорте для
  // тестов). Реальный запрос к пулу без DATABASE_URL всё равно упадёт с
  // понятной ошибкой подключения.
  console.warn(
    '[db] DATABASE_URL не задан — запросы к базе будут падать. ' +
      'Скопируй server/.env.example в server/.env и заполни его.'
  );
}

const pool = new Pool({ connectionString: config.databaseUrl });

pool.on('error', (err) => {
  // Ошибки на простаивающих клиентах пула — не должны валить процесс.
  console.error('[db] Неожиданная ошибка простаивающего клиента пула:', err);
});

async function query(text, params) {
  return pool.query(text, params);
}

// Выполняет callback внутри транзакции (BEGIN/COMMIT/ROLLBACK) на одном
// клиенте — использовать для любых изменений, где нужна атомарность
// (например: запись события вебхука + обновление статуса подписки).
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
