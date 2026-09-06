// Роут пользовательских правок каталога материалов (панель клиента
// «Библиотека → Материалы»: дерево категорий, переименование/добавление/
// удаление категорий, редактирование названий/цен/фото прямо в таблицах).
//
// Хранится ОДИН JSON-снимок изменяемых частей каталога материалов на
// пользователя — сохранение всегда заменяет весь блок целиком (upsert), не
// мержит по кусочкам. Форма объекта (DECORS/BACK_MATERIALS/
// FACADE_MATERIALS/EDGE_PRICES/GLASS/COUNTERTOP_MATERIALS/libExtraNodes) —
// зона src/catalog.js/src/app.js (клиент, не эта зона ответственности):
// сервер не валидирует и не понимает содержимое по существу, только
// хранит и отдаёт объект как есть.
//
// Контракт:
// - Authorization: Bearer <JWT> обязателен (requireAuth).
// - GET /catalog-overrides         -> { data: <jsonb-объект | null> }
//                                      (null, если пользователь ещё ничего
//                                      не сохранял).
// - PUT /catalog-overrides { data } -> upsert, отвечает { ok: true }.
//
// express.json({ limit: '8mb' }) подключён только к этому роутеру (не
// глобально в index.js) — как и в routes/export.js/routes/sketch.js:
// блок может содержать base64 data URL фото-образцов материалов, обычный
// маленький дефолтный лимит здесь не подойдёт.

const express = require('express');

const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(express.json({ limit: '8mb' }));
router.use(requireAuth);

// GET / — текущий сохранённый снимок каталога пользователя (или null).
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT data FROM catalog_overrides WHERE user_id = $1`,
      [req.user.id]
    );

    return res.json({ data: rows.length > 0 ? rows[0].data : null });
  } catch (err) {
    console.error('[catalogOverrides/get] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось загрузить правки каталога.' });
  }
});

// PUT / { data } — полностью заменяет сохранённый снимок каталога
// пользователя (upsert по user_id, один ряд на пользователя).
router.put('/', async (req, res) => {
  const { data } = req.body || {};

  if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ error: 'Не передан объект правок каталога (data).' });
  }

  try {
    await db.query(
      `INSERT INTO catalog_overrides (user_id, data)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET data = $2, updated_at = now()`,
      [req.user.id, data]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('[catalogOverrides/put] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось сохранить правки каталога.' });
  }
});

module.exports = router;
