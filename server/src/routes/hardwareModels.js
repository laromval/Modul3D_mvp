// Роуты приватной библиотеки 3D-моделей фурнитуры (.obj петель) пользователя.
//
// Не ИИ-операция и не платный документ — просто хранение файла под
// аккаунтом, поэтому здесь нет ни списания токенов (token_balances), ни
// проверки подписки: доступно любому авторизованному пользователю.
//
// Контракт:
// - Authorization: Bearer <JWT> обязателен на всех роутах (requireAuth).
// - POST   /            body { name, slotKind, objText } -> создаёт запись.
// - GET    /             -> список моделей пользователя, БЕЗ objText (лёгкий).
// - GET    /:id           -> одна модель, включая objText.
// - DELETE /:id           -> удаляет модель пользователя.
//
// express.json({ limit: '5mb' }) подключён только к этому роутеру (не
// глобально в index.js) — так же, как в server/src/routes/sketch.js: .obj
// текст может быть увесистым, остальным роутам такой лимит не нужен.

const express = require('express');

const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Тот же словарь, что используется в src/engine.js для part.holes[].kind —
// значения должны совпадать буква в букву с клиентским кодом. slot_kind
// сознательно не CHECK-constraint в БД (см. миграцию 002), чтобы список
// можно было расширять без миграции — whitelist живёт здесь, в коде роута.
const ALLOWED_SLOT_KINDS = ['hingeCup', 'hingeGlass'];

const MAX_NAME_LENGTH = 200;
const MAX_MODELS_PER_USER = 50;

router.use(express.json({ limit: '5mb' }));
router.use(requireAuth);

// POST / — сохраняет новую модель фурнитуры под текущим пользователем.
router.post('/', async (req, res) => {
  const { name, slotKind, objText } = req.body || {};

  if (typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Не передано имя модели (name).' });
  }
  const trimmedName = name.trim();
  if (trimmedName.length > MAX_NAME_LENGTH) {
    return res.status(400).json({
      error: `Имя модели длиннее ${MAX_NAME_LENGTH} символов.`,
    });
  }

  if (typeof slotKind !== 'string' || !ALLOWED_SLOT_KINDS.includes(slotKind)) {
    return res.status(400).json({
      error: `slotKind должен быть одним из: ${ALLOWED_SLOT_KINDS.join(', ')}.`,
    });
  }

  if (typeof objText !== 'string' || objText.length === 0) {
    return res.status(400).json({ error: 'Не передано содержимое .obj (objText).' });
  }

  try {
    // Лимит на аккаунт — чтобы не раздувать бесплатно БД произвольным
    // числом загрузок. Проверка и вставка сделаны одним атомарным запросом
    // (CTE + условный INSERT ... SELECT ... WHERE), а не отдельными
    // SELECT COUNT + INSERT — иначе два параллельных запроса от одного
    // пользователя, оба стартовавшие при count=49, могли бы оба пройти
    // проверку и дать 51 запись (TOCTOU). 400, а не 429: это не превышение
    // частоты запросов (rate limit), а исчерпанная квота хранилища на
    // аккаунт — по смыслу ближе к ошибке валидации состояния запроса, как
    // остальные проверки в этом роуте.
    const { rows } = await db.query(
      `WITH cnt AS (
         SELECT COUNT(*)::int AS n FROM hardware_models WHERE user_id = $1
       )
       INSERT INTO hardware_models (user_id, slot_kind, name, obj_text)
       SELECT $1, $2, $3, $4
       WHERE (SELECT n FROM cnt) < $5
       RETURNING id, name, slot_kind, created_at`,
      [req.user.id, slotKind, trimmedName, objText, MAX_MODELS_PER_USER]
    );

    if (rows.length === 0) {
      return res.status(400).json({
        error: `Достигнут лимит моделей фурнитуры на аккаунт (${MAX_MODELS_PER_USER}). Удалите неиспользуемые модели, чтобы добавить новую.`,
      });
    }

    const row = rows[0];
    return res.status(201).json({
      id: row.id,
      name: row.name,
      slotKind: row.slot_kind,
      createdAt: row.created_at,
    });
  } catch (err) {
    console.error('[hardwareModels/create] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось сохранить модель фурнитуры.' });
  }
});

// GET / — список моделей текущего пользователя, без тяжёлого objText.
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, slot_kind, created_at
       FROM hardware_models
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    return res.json(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        slotKind: row.slot_kind,
        createdAt: row.created_at,
      }))
    );
  } catch (err) {
    console.error('[hardwareModels/list] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось загрузить список моделей фурнитуры.' });
  }
});

// GET /:id — полная запись, включая objText.
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, slot_kind, obj_text, created_at
       FROM hardware_models
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (rows.length === 0) {
      // 404, не 403 — не должно быть заметно снаружи, существует ли чужая
      // запись с этим id.
      return res.status(404).json({ error: 'Модель фурнитуры не найдена.' });
    }

    const row = rows[0];
    return res.json({
      id: row.id,
      name: row.name,
      slotKind: row.slot_kind,
      objText: row.obj_text,
      createdAt: row.created_at,
    });
  } catch (err) {
    // 22P02 — invalid_text_representation, т.е. :id не парсится как UUID
    // (например, чужой мусор в адресе). Это не серверная ошибка, а то же
    // самое "не найдено" — не отдаём 500 на кривой id.
    if (err.code === '22P02') {
      return res.status(404).json({ error: 'Модель фурнитуры не найдена.' });
    }
    console.error('[hardwareModels/get] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось загрузить модель фурнитуры.' });
  }
});

// DELETE /:id — удаляет модель текущего пользователя.
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `DELETE FROM hardware_models WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Модель фурнитуры не найдена.' });
    }

    return res.status(204).send();
  } catch (err) {
    if (err.code === '22P02') {
      return res.status(404).json({ error: 'Модель фурнитуры не найдена.' });
    }
    console.error('[hardwareModels/delete] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось удалить модель фурнитуры.' });
  }
});

module.exports = router;
