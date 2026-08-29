// Роуты отзывов о приложении с ручной модерацией.
//
// Контракт:
// - POST   /reviews          (requireAuth)  body { text } -> создаёт отзыв
//                             со статусом 'pending'.
// - GET    /reviews/public   (без авторизации) -> только status='approved',
//                             без email автора.
// - GET    /reviews/pending  (requireAdmin) -> все status='pending', с email.
// - POST   /reviews/:id/approve (requireAdmin) -> status='approved'.
// - POST   /reviews/:id/reject  (requireAdmin) -> status='rejected'.
//
// Модерация защищена одним приватным токеном (ADMIN_TOKEN) — не полноценные
// роли, у проекта на этом этапе один владелец (см. server/README.md).

const express = require('express');

const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const MAX_REVIEW_LENGTH = 2000;

// Мини-мидлварь модерации: сверяет заголовок X-Admin-Token с config.adminToken.
// Если ADMIN_TOKEN не задан на сервере — отклоняем всех (503), а не пускаем
// всех подряд из-за пустого сравнения.
function requireAdmin(req, res, next) {
  if (!config.adminToken) {
    return res.status(503).json({ error: 'Модерация отзывов не настроена на сервере (ADMIN_TOKEN).' });
  }
  const token = req.headers['x-admin-token'];
  if (typeof token !== 'string' || token !== config.adminToken) {
    return res.status(401).json({ error: 'Недействительный админ-токен.' });
  }
  return next();
}

// POST /reviews { text } — требует авторизацию, JSON-тело.
router.post('/', express.json(), requireAuth, async (req, res) => {
  const { text } = req.body || {};

  if (typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'Отзыв не может быть пустым.' });
  }
  const trimmedText = text.trim();
  if (trimmedText.length > MAX_REVIEW_LENGTH) {
    return res.status(400).json({ error: `Отзыв длиннее ${MAX_REVIEW_LENGTH} символов.` });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO reviews (user_id, body, status)
       VALUES ($1, $2, 'pending')
       RETURNING id, body, status, created_at`,
      [req.user.id, trimmedText]
    );

    const row = rows[0];
    return res.status(201).json({
      id: row.id,
      body: row.body,
      status: row.status,
      createdAt: row.created_at,
    });
  } catch (err) {
    console.error('[reviews/create] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось сохранить отзыв.' });
  }
});

// GET /reviews/public — без авторизации, только одобренные, без email.
router.get('/public', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.id, r.body, r.created_at, u.nickname, u.avatar_url
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       WHERE r.status = 'approved'
       ORDER BY r.created_at DESC`
    );

    return res.json(
      rows.map((row) => ({
        id: row.id,
        body: row.body,
        createdAt: row.created_at,
        nickname: row.nickname,
        avatarUrl: row.avatar_url,
      }))
    );
  } catch (err) {
    console.error('[reviews/public] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось загрузить отзывы.' });
  }
});

// GET /reviews/pending — только для владельца проекта (X-Admin-Token).
router.get('/pending', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.id, r.body, r.created_at, u.nickname, u.avatar_url, u.email
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       WHERE r.status = 'pending'
       ORDER BY r.created_at ASC`
    );

    return res.json(
      rows.map((row) => ({
        id: row.id,
        body: row.body,
        createdAt: row.created_at,
        nickname: row.nickname,
        avatarUrl: row.avatar_url,
        email: row.email,
      }))
    );
  } catch (err) {
    console.error('[reviews/pending] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось загрузить отзывы на модерации.' });
  }
});

// POST /reviews/:id/approve — только для владельца проекта.
router.post('/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE reviews SET status = 'approved', moderated_at = now()
       WHERE id = $1
       RETURNING id, status, moderated_at`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Отзыв не найден.' });
    }
    return res.json(rows[0]);
  } catch (err) {
    if (err.code === '22P02') {
      return res.status(404).json({ error: 'Отзыв не найден.' });
    }
    console.error('[reviews/approve] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось одобрить отзыв.' });
  }
});

// POST /reviews/:id/reject — только для владельца проекта.
router.post('/:id/reject', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE reviews SET status = 'rejected', moderated_at = now()
       WHERE id = $1
       RETURNING id, status, moderated_at`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Отзыв не найден.' });
    }
    return res.json(rows[0]);
  } catch (err) {
    if (err.code === '22P02') {
      return res.status(404).json({ error: 'Отзыв не найден.' });
    }
    console.error('[reviews/reject] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось отклонить отзыв.' });
  }
});

module.exports = router;
