// Личные данные страницы Workflow (доска задач + заметки) — хранятся на
// сервере в зашифрованном виде (services/workflowCrypto.js), а не в
// localStorage браузера, поэтому не зависят от адреса сайта и устройства.
//
// Контракт (везде Authorization: Bearer <JWT>, и только для config.adminEmail):
// - GET /workflow           -> { data: <{columns, notes} | null>, revision }
//                              (data=null, revision=0 — на сервере ещё пусто)
// - PUT /workflow { data, revision }
//        revision — ревизия, на которой основаны правки клиента.
//        Совпала с серверной -> сохраняем, отвечаем { ok: true, revision }.
//        Не совпала         -> 409 { error, revision } (клиент перезагружает).
//
// Если WORKFLOW_ENC_KEY не задан — 503: открытым текстом не храним.

const express = require('express');

const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { encryptJson, decryptJson, WorkflowKeyMissingError } = require('../services/workflowCrypto');

const router = express.Router();

router.use(express.json({ limit: '2mb' }));
router.use(requireAuth);

router.use((req, res, next) => {
  if (!config.adminEmail || req.user.email !== config.adminEmail) {
    return res.status(403).json({ error: 'Эта страница доступна только владельцу проекта.' });
  }
  return next();
});

function handleError(err, res, what) {
  if (err instanceof WorkflowKeyMissingError) {
    console.error('[workflow] WORKFLOW_ENC_KEY не задан — хранение недоступно.');
    return res.status(503).json({ error: 'На сервере не задан ключ шифрования (WORKFLOW_ENC_KEY).' });
  }
  console.error(`[workflow/${what}] ошибка:`, err);
  return res.status(500).json({ error: 'Не удалось выполнить операцию с данными Workflow.' });
}

router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT payload, revision FROM workflow_data WHERE user_id = $1', [req.user.id]);
    if (rows.length === 0) return res.json({ data: null, revision: 0 });
    return res.json({ data: decryptJson(rows[0].payload), revision: rows[0].revision });
  } catch (err) {
    return handleError(err, res, 'get');
  }
});

router.put('/', async (req, res) => {
  const { data, revision } = req.body || {};
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      !Array.isArray(data.columns) || !Array.isArray(data.notes)) {
    return res.status(400).json({ error: 'Ожидается объект { columns: [], notes: [] }.' });
  }
  if (!Number.isInteger(revision) || revision < 0) {
    return res.status(400).json({ error: 'Не передана ревизия (revision).' });
  }

  try {
    const payload = encryptJson(data);
    let newRevision;
    if (revision === 0) {
      const r = await db.query(
        `INSERT INTO workflow_data (user_id, payload, revision) VALUES ($1, $2, 1)
         ON CONFLICT (user_id) DO NOTHING RETURNING revision`,
        [req.user.id, payload]
      );
      newRevision = r.rows.length ? r.rows[0].revision : null;
    } else {
      const r = await db.query(
        `UPDATE workflow_data SET payload = $2, revision = revision + 1, updated_at = now()
         WHERE user_id = $1 AND revision = $3 RETURNING revision`,
        [req.user.id, payload, revision]
      );
      newRevision = r.rows.length ? r.rows[0].revision : null;
    }

    if (newRevision === null) {
      const cur = await db.query('SELECT revision FROM workflow_data WHERE user_id = $1', [req.user.id]);
      return res.status(409).json({
        error: 'На сервере более свежая версия — данные перезагружены.',
        revision: cur.rows.length ? cur.rows[0].revision : 0,
      });
    }
    return res.json({ ok: true, revision: newRevision });
  } catch (err) {
    return handleError(err, res, 'put');
  }
});

module.exports = router;
