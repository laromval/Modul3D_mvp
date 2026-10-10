// «Файлы» проекта клиента (миграция 010). Сейчас — ссылки из интернета
// (kind='link'); файлы на Google Диске пользователя (kind='drive') — следующий
// этап. Данные личные: каждый запрос фильтруется по user_id из JWT, чужое
// неотличимо от несуществующего (404).
//
// Контракт (Authorization: Bearer <JWT>, подтверждённый email):
//   GET    /files?client=<uuid>&project=<uuid|none>  -> { files: [...] }
//   POST   /files { clientId, projectId?, kind?:'link', title?, url }  -> { file }
//   PATCH  /files/:id { title?, url? }
//   DELETE /files/:id
// Адрес — только http/https (без схемы дописывается https://); название по
// умолчанию — домен. Название и адрес хранятся зашифрованными, без
// WORKFLOW_ENC_KEY — 503.

const express = require('express');

const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireVerifiedEmail } = require('../middleware/emailVerification');
const { encryptJson } = require('../services/workflowCrypto');
const { isUuid, cleanText, handleError, safeDecrypt } = require('../services/clientHelpers');

const router = express.Router();

router.use(express.json({ limit: '16kb' }));
router.use(requireAuth);
router.use(requireVerifiedEmail);

const MAX_FILES_PER_CLIENT = 500;
const MAX_TITLE = 200;
const MAX_URL = 2000;
const LIST_LIMIT = 500;

// Приводит введённое к нормальному http(s)-адресу или возвращает { error }.
function cleanUrl(raw) {
  const t = cleanText(raw, MAX_URL, 'адрес ссылки', { required: true });
  if (t.error) return t;
  let v = t.value;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = 'https://' + v; // «example.com/page» → https://…
  let u;
  try { u = new URL(v); } catch (e) { return { error: 'Адрес ссылки: неверный формат.' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'Адрес ссылки: допустимы только http и https.' };
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') return { error: 'Адрес ссылки: неверный формат.' };
  return { value: u.href, host: u.hostname.replace(/^www\./, '') };
}

function fileDto(row) {
  const title = safeDecrypt(row.title);
  const url = safeDecrypt(row.url);
  return {
    id: row.id,
    clientId: row.client_id,
    projectId: row.project_id,
    kind: row.kind,
    title: title.value,
    url: url.value,
    unreadable: !!(title.unreadable || url.unreadable),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function checkOwnership(req, res, clientId, projectId) {
  if (!isUuid(clientId)) { res.status(404).json({ error: 'Клиент не найден.' }); return false; }
  const c = await db.query('SELECT 1 FROM clients WHERE id = $1 AND user_id = $2', [clientId, req.user.id]);
  if (c.rows.length === 0) { res.status(404).json({ error: 'Клиент не найден.' }); return false; }
  if (projectId !== null && projectId !== undefined) {
    if (!isUuid(projectId)) { res.status(404).json({ error: 'Проект не найден.' }); return false; }
    const p = await db.query(
      'SELECT 1 FROM client_projects WHERE id = $1 AND client_id = $2 AND user_id = $3',
      [projectId, clientId, req.user.id]
    );
    if (p.rows.length === 0) { res.status(404).json({ error: 'Проект не найден.' }); return false; }
  }
  return true;
}

async function loadOwnFile(req, res) {
  if (!isUuid(req.params.id)) { res.status(404).json({ error: 'Файл не найден.' }); return null; }
  const { rows } = await db.query('SELECT * FROM client_files WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (rows.length === 0) { res.status(404).json({ error: 'Файл не найден.' }); return null; }
  return rows[0];
}

router.get('/', async (req, res) => {
  const where = ['user_id = $1'];
  const params = [req.user.id];
  if (req.query.client !== undefined) {
    if (!isUuid(req.query.client)) return res.json({ files: [] });
    params.push(req.query.client); where.push(`client_id = $${params.length}`);
  }
  if (req.query.project !== undefined) {
    if (req.query.project === 'none') where.push('project_id IS NULL');
    else if (!isUuid(req.query.project)) return res.json({ files: [] });
    else { params.push(req.query.project); where.push(`project_id = $${params.length}`); }
  }
  try {
    const { rows } = await db.query(
      `SELECT * FROM client_files WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`, params);
    return res.json({ files: rows.map(fileDto) });
  } catch (err) {
    return handleError(err, res, 'files-list');
  }
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  if (body.kind !== undefined && body.kind !== 'link') {
    return res.status(400).json({ error: 'Пока можно добавлять только ссылки.' });
  }
  const url = cleanUrl(body.url);
  if (url.error) return res.status(400).json({ error: url.error });
  const title = cleanText(body.title, MAX_TITLE, 'название', { required: false });
  if (title.error) return res.status(400).json({ error: title.error });
  const projectId = body.projectId === undefined ? null : body.projectId;
  try {
    if (!(await checkOwnership(req, res, body.clientId, projectId))) return undefined;
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM client_files WHERE client_id = $1 AND user_id = $2', [body.clientId, req.user.id]);
    if (cnt.rows[0].n >= MAX_FILES_PER_CLIENT) {
      return res.status(409).json({ error: `Достигнут предел: не более ${MAX_FILES_PER_CLIENT} файлов и ссылок на клиента.` });
    }
    const { rows } = await db.query(
      `INSERT INTO client_files (user_id, client_id, project_id, kind, title, url)
       VALUES ($1,$2,$3,'link',$4,$5) RETURNING *`,
      [req.user.id, body.clientId, projectId, encryptJson(title.value || url.host), encryptJson(url.value)]
    );
    return res.status(201).json({ file: fileDto(rows[0]) });
  } catch (err) {
    return handleError(err, res, 'files-create');
  }
});

router.patch('/:id', async (req, res) => {
  const body = req.body || {};
  try {
    const file = await loadOwnFile(req, res);
    if (!file) return undefined;
    const sets = [];
    const params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (body.url !== undefined) {
      const u = cleanUrl(body.url);
      if (u.error) return res.status(400).json({ error: u.error });
      add('url', encryptJson(u.value));
    }
    if (body.title !== undefined) {
      const t = cleanText(body.title, MAX_TITLE, 'название', { required: true });
      if (t.error) return res.status(400).json({ error: t.error });
      add('title', encryptJson(t.value));
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Нечего менять.' });
    params.push(file.id, req.user.id);
    const { rows } = await db.query(
      `UPDATE client_files SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${params.length - 1} AND user_id = $${params.length} RETURNING *`, params);
    return res.json({ file: fileDto(rows[0]) });
  } catch (err) {
    return handleError(err, res, 'files-update');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const file = await loadOwnFile(req, res);
    if (!file) return undefined;
    await db.query('DELETE FROM client_files WHERE id = $1 AND user_id = $2', [file.id, req.user.id]);
    return res.json({ ok: true });
  } catch (err) {
    return handleError(err, res, 'files-delete');
  }
});

module.exports = router;
