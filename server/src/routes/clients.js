// Раздел «Клиенты»: клиент → несколько проектов → заметки (миграция
// 008_clients.sql). Это личные данные КАЖДОГО пользователя (в отличие от
// /workflow — доски владельца проекта): любой запрос здесь фильтруется по
// user_id из JWT, так что чужие клиенты/проекты/заметки недоступны, а
// «не твоё» неотличимо от «не существует» (404).
//
// Контракт (везде Authorization: Bearer <JWT>, подтверждённый email):
//   GET    /clients                          -> { clients: [...] } (+ счётчики)
//   POST   /clients { name, phone?, email? } -> { client }
//   GET    /clients/:id                      -> { client, projects: [...] }
//   PATCH  /clients/:id { name?, phone?, email?, archived? }
//          (phone/email: пустая строка или null — очистить; не переданное не меняется)
//   DELETE /clients/:id                      (каскадом проекты и заметки)
//   POST   /clients/:id/projects { name }    -> { project }
//   PATCH  /clients/:id/projects/:pid { name?, status? }
//   DELETE /clients/:id/projects/:pid        (каскадом заметки проекта)
//   GET    /clients/:id/notes?project=<uuid|none>  (без параметра — все)
//   POST   /clients/:id/notes { body, projectId? }  -> { note }
//   PATCH  /clients/:id/notes/:nid { body }
//   DELETE /clients/:id/notes/:nid
//
// Контакт клиента (телефон и почта — один зашифрованный объект
// { phone, email }; старые записи — просто строка, читаются тоже) и текст заметок хранятся зашифрованными
// (services/workflowCrypto.js, ключ WORKFLOW_ENC_KEY). Если ключ не задан,
// операции с контактом/заметками отвечают 503 — открытым текстом не храним;
// клиенты и проекты без них работают.

const express = require('express');

const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireVerifiedEmail } = require('../middleware/emailVerification');
const { encryptJson } = require('../services/workflowCrypto');
const { isUuid, cleanText, handleError, safeDecrypt } = require('../services/clientHelpers');

const router = express.Router();

router.use(express.json({ limit: '256kb' }));
router.use(requireAuth);
router.use(requireVerifiedEmail);

const MAX_CLIENTS_PER_USER = 500;
const MAX_PROJECTS_PER_CLIENT = 200;
const MAX_NOTES_PER_CLIENT = 1000;
const MAX_NAME = 120;
const MAX_CONTACT = 500; // только для старого поля contact (строка)
const MAX_PHONE = 40;
const MAX_EMAIL = 120;
const MAX_NOTE = 20000;
const PROJECT_STATUSES = ['active', 'done'];

// ---- контакт клиента: телефон + почта -------------------------------------

function strOrNull(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// Из расшифрованного значения колонки contact делает { phone, email }.
// Новый формат — объект; старый — одна строка (почта, если есть «@»,
// иначе телефон).
function normalizeContact(value) {
  if (value && typeof value === 'object') {
    return { phone: strOrNull(value.phone), email: strOrNull(value.email) };
  }
  const v = strOrNull(value);
  if (!v) return { phone: null, email: null };
  return v.includes('@') ? { phone: null, email: v } : { phone: v, email: null };
}

// Телефон: цифры, пробелы, + - ( ) . ; от 5 до 18 цифр. Возвращает
// { value } или { error }.
function cleanPhone(raw) {
  const t = cleanText(raw, MAX_PHONE, 'телефон', { required: false });
  if (t.error || t.value === null) return t;
  if (!/^[+\d\s()\-.]+$/.test(t.value)) return { error: 'Телефон: допустимы только цифры, пробелы и символы + - ( ).' };
  const digits = t.value.replace(/\D/g, '').length;
  if (digits < 5 || digits > 18) return { error: 'Телефон: от 5 до 18 цифр.' };
  return t;
}

function cleanEmail(raw) {
  const t = cleanText(raw, MAX_EMAIL, 'почта', { required: false });
  if (t.error || t.value === null) return t;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.value)) return { error: 'Почта: неверный формат.' };
  return t;
}

// Читает из тела запроса телефон и почту. Для обратной совместимости
// принимает и старое поле contact (строка). Возвращает
// { phone?, email? } — ключ есть только если поле передано (значение null =
// очистить), либо { error }.
function readContactFields(body) {
  const out = {};
  if (body.phone !== undefined) {
    const r = cleanPhone(body.phone);
    if (r.error) return { error: r.error };
    out.phone = r.value;
  }
  if (body.email !== undefined) {
    const r = cleanEmail(body.email);
    if (r.error) return { error: r.error };
    out.email = r.value;
  }
  if (body.contact !== undefined && out.phone === undefined && out.email === undefined) {
    const r = cleanText(body.contact, MAX_CONTACT, 'контакт', { required: false });
    if (r.error) return { error: r.error };
    const n = normalizeContact(r.value);
    out.phone = n.phone;
    out.email = n.email;
  }
  return out;
}

function packContact({ phone, email }) {
  return phone || email ? encryptJson({ phone: phone || null, email: email || null }) : null;
}

function clientDto(row, contact) {
  const c = normalizeContact(contact.value);
  return {
    id: row.id,
    name: row.name,
    phone: c.phone,
    email: c.email,
    contactUnreadable: !!contact.unreadable,
    archived: row.archived_at !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function projectDto(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function noteDto(row) {
  const body = safeDecrypt(row.body);
  return {
    id: row.id,
    clientId: row.client_id,
    projectId: row.project_id,
    body: body.value,
    unreadable: !!body.unreadable,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Достаёт клиента ТОЛЬКО если он принадлежит текущему пользователю.
async function loadOwnClient(req, res) {
  const id = req.params.id;
  if (!isUuid(id)) { res.status(404).json({ error: 'Клиент не найден.' }); return null; }
  const { rows } = await db.query(
    'SELECT * FROM clients WHERE id = $1 AND user_id = $2',
    [id, req.user.id]
  );
  if (rows.length === 0) { res.status(404).json({ error: 'Клиент не найден.' }); return null; }
  return rows[0];
}

// ---------------------------------------------------------------- клиенты

router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM client_projects p WHERE p.client_id = c.id AND p.user_id = c.user_id) AS projects_count,
              (SELECT COUNT(*)::int FROM client_notes n WHERE n.client_id = c.id AND n.user_id = c.user_id) AS notes_count
         FROM clients c
        WHERE c.user_id = $1
        ORDER BY (c.archived_at IS NOT NULL), lower(c.name), c.created_at`,
      [req.user.id]
    );
    const clients = rows.map((r) => ({
      ...clientDto(r, safeDecrypt(r.contact)),
      projectsCount: r.projects_count,
      notesCount: r.notes_count,
    }));
    return res.json({ clients });
  } catch (err) {
    return handleError(err, res, 'list');
  }
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const name = cleanText(body.name, MAX_NAME, 'имя клиента', { required: true });
  if (name.error) return res.status(400).json({ error: name.error });
  const contact = readContactFields(body);
  if (contact.error) return res.status(400).json({ error: contact.error });
  const phone = contact.phone || null;
  const email = contact.email || null;

  try {
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM clients WHERE user_id = $1', [req.user.id]);
    if (cnt.rows[0].n >= MAX_CLIENTS_PER_USER) {
      return res.status(409).json({ error: `Достигнут предел: не более ${MAX_CLIENTS_PER_USER} клиентов.` });
    }
    const encContact = packContact({ phone, email });
    const { rows } = await db.query(
      'INSERT INTO clients (user_id, name, contact) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, name.value, encContact]
    );
    return res.status(201).json({ client: { ...clientDto(rows[0], { value: { phone, email } }), projectsCount: 0, notesCount: 0 } });
  } catch (err) {
    return handleError(err, res, 'create');
  }
});

router.get('/:id', async (req, res) => {
  try {
    const client = await loadOwnClient(req, res);
    if (!client) return undefined;
    const projects = await db.query(
      `SELECT p.*,
              (SELECT COUNT(*)::int FROM client_notes n WHERE n.project_id = p.id AND n.user_id = p.user_id) AS notes_count
         FROM client_projects p
        WHERE p.client_id = $1 AND p.user_id = $2
        ORDER BY p.created_at`,
      [client.id, req.user.id]
    );
    return res.json({
      client: clientDto(client, safeDecrypt(client.contact)),
      projects: projects.rows.map((r) => ({ ...projectDto(r), notesCount: r.notes_count })),
    });
  } catch (err) {
    return handleError(err, res, 'get');
  }
});

router.patch('/:id', async (req, res) => {
  const body = req.body || {};
  try {
    const client = await loadOwnClient(req, res);
    if (!client) return undefined;

    const sets = [];
    const params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (body.name !== undefined) {
      const name = cleanText(body.name, MAX_NAME, 'имя клиента', { required: true });
      if (name.error) return res.status(400).json({ error: name.error });
      add('name', name.value);
    }
    const contact = readContactFields(body);
    if (contact.error) return res.status(400).json({ error: contact.error });
    if (contact.phone !== undefined || contact.email !== undefined) {
      // Меняем только переданное: второе поле остаётся как было.
      const current = normalizeContact(safeDecrypt(client.contact).value);
      add('contact', packContact({
        phone: contact.phone !== undefined ? contact.phone : current.phone,
        email: contact.email !== undefined ? contact.email : current.email,
      }));
    }
    if (body.archived !== undefined) {
      if (typeof body.archived !== 'boolean') return res.status(400).json({ error: 'archived: ожидается true или false.' });
      sets.push(body.archived ? 'archived_at = now()' : 'archived_at = NULL');
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Нечего менять.' });

    params.push(client.id, req.user.id);
    const { rows } = await db.query(
      `UPDATE clients SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${params.length - 1} AND user_id = $${params.length} RETURNING *`,
      params
    );
    return res.json({ client: clientDto(rows[0], safeDecrypt(rows[0].contact)) });
  } catch (err) {
    return handleError(err, res, 'update');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const client = await loadOwnClient(req, res);
    if (!client) return undefined;
    await db.query('DELETE FROM clients WHERE id = $1 AND user_id = $2', [client.id, req.user.id]);
    return res.json({ ok: true });
  } catch (err) {
    return handleError(err, res, 'delete');
  }
});

// --------------------------------------------------------------- проекты

router.post('/:id/projects', async (req, res) => {
  const name = cleanText((req.body || {}).name, MAX_NAME, 'название проекта', { required: true });
  if (name.error) return res.status(400).json({ error: name.error });
  try {
    const client = await loadOwnClient(req, res);
    if (!client) return undefined;
    const cnt = await db.query(
      'SELECT COUNT(*)::int AS n FROM client_projects WHERE client_id = $1 AND user_id = $2',
      [client.id, req.user.id]
    );
    if (cnt.rows[0].n >= MAX_PROJECTS_PER_CLIENT) {
      return res.status(409).json({ error: `Достигнут предел: не более ${MAX_PROJECTS_PER_CLIENT} проектов у клиента.` });
    }
    const { rows } = await db.query(
      'INSERT INTO client_projects (user_id, client_id, name) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, client.id, name.value]
    );
    return res.status(201).json({ project: { ...projectDto(rows[0]), notesCount: 0 } });
  } catch (err) {
    return handleError(err, res, 'project-create');
  }
});

async function loadOwnProject(req, res, client) {
  const pid = req.params.pid;
  if (!isUuid(pid)) { res.status(404).json({ error: 'Проект не найден.' }); return null; }
  const { rows } = await db.query(
    'SELECT * FROM client_projects WHERE id = $1 AND client_id = $2 AND user_id = $3',
    [pid, client.id, req.user.id]
  );
  if (rows.length === 0) { res.status(404).json({ error: 'Проект не найден.' }); return null; }
  return rows[0];
}

router.patch('/:id/projects/:pid', async (req, res) => {
  const body = req.body || {};
  try {
    const client = await loadOwnClient(req, res);
    if (!client) return undefined;
    const project = await loadOwnProject(req, res, client);
    if (!project) return undefined;

    const sets = [];
    const params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (body.name !== undefined) {
      const name = cleanText(body.name, MAX_NAME, 'название проекта', { required: true });
      if (name.error) return res.status(400).json({ error: name.error });
      add('name', name.value);
    }
    if (body.status !== undefined) {
      if (!PROJECT_STATUSES.includes(body.status)) {
        return res.status(400).json({ error: `status: допустимо ${PROJECT_STATUSES.join(' или ')}.` });
      }
      add('status', body.status);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Нечего менять.' });

    params.push(project.id, req.user.id);
    const { rows } = await db.query(
      `UPDATE client_projects SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${params.length - 1} AND user_id = $${params.length} RETURNING *`,
      params
    );
    return res.json({ project: projectDto(rows[0]) });
  } catch (err) {
    return handleError(err, res, 'project-update');
  }
});

router.delete('/:id/projects/:pid', async (req, res) => {
  try {
    const client = await loadOwnClient(req, res);
    if (!client) return undefined;
    const project = await loadOwnProject(req, res, client);
    if (!project) return undefined;
    await db.query('DELETE FROM client_projects WHERE id = $1 AND user_id = $2', [project.id, req.user.id]);
    return res.json({ ok: true });
  } catch (err) {
    return handleError(err, res, 'project-delete');
  }
});

// --------------------------------------------------------------- заметки

router.get('/:id/notes', async (req, res) => {
  try {
    const client = await loadOwnClient(req, res);
    if (!client) return undefined;

    const params = [client.id, req.user.id];
    let filter = '';
    const q = req.query.project;
    if (q === 'none') {
      filter = ' AND project_id IS NULL';
    } else if (q !== undefined) {
      if (!isUuid(q)) return res.status(404).json({ error: 'Проект не найден.' });
      params.push(q);
      filter = ` AND project_id = $${params.length}`;
    }
    const { rows } = await db.query(
      `SELECT * FROM client_notes WHERE client_id = $1 AND user_id = $2${filter}
        ORDER BY created_at DESC LIMIT ${MAX_NOTES_PER_CLIENT}`,
      params
    );
    return res.json({ notes: rows.map(noteDto) });
  } catch (err) {
    return handleError(err, res, 'notes-list');
  }
});

router.post('/:id/notes', async (req, res) => {
  const body = req.body || {};
  const text = cleanText(body.body, MAX_NOTE, 'текст заметки', { required: true });
  if (text.error) return res.status(400).json({ error: text.error });
  try {
    const client = await loadOwnClient(req, res);
    if (!client) return undefined;

    let projectId = null;
    if (body.projectId !== undefined && body.projectId !== null) {
      if (!isUuid(body.projectId)) return res.status(404).json({ error: 'Проект не найден.' });
      const p = await db.query(
        'SELECT id FROM client_projects WHERE id = $1 AND client_id = $2 AND user_id = $3',
        [body.projectId, client.id, req.user.id]
      );
      if (p.rows.length === 0) return res.status(404).json({ error: 'Проект не найден.' });
      projectId = p.rows[0].id;
    }

    const cnt = await db.query(
      'SELECT COUNT(*)::int AS n FROM client_notes WHERE client_id = $1 AND user_id = $2',
      [client.id, req.user.id]
    );
    if (cnt.rows[0].n >= MAX_NOTES_PER_CLIENT) {
      return res.status(409).json({ error: `Достигнут предел: не более ${MAX_NOTES_PER_CLIENT} заметок у клиента.` });
    }

    const { rows } = await db.query(
      'INSERT INTO client_notes (user_id, client_id, project_id, body) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, client.id, projectId, encryptJson(text.value)]
    );
    return res.status(201).json({ note: noteDto(rows[0]) });
  } catch (err) {
    return handleError(err, res, 'note-create');
  }
});

router.patch('/:id/notes/:nid', async (req, res) => {
  const text = cleanText((req.body || {}).body, MAX_NOTE, 'текст заметки', { required: true });
  if (text.error) return res.status(400).json({ error: text.error });
  try {
    const client = await loadOwnClient(req, res);
    if (!client) return undefined;
    if (!isUuid(req.params.nid)) return res.status(404).json({ error: 'Заметка не найдена.' });
    const { rows } = await db.query(
      `UPDATE client_notes SET body = $1, updated_at = now()
        WHERE id = $2 AND client_id = $3 AND user_id = $4 RETURNING *`,
      [encryptJson(text.value), req.params.nid, client.id, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Заметка не найдена.' });
    return res.json({ note: noteDto(rows[0]) });
  } catch (err) {
    return handleError(err, res, 'note-update');
  }
});

router.delete('/:id/notes/:nid', async (req, res) => {
  try {
    const client = await loadOwnClient(req, res);
    if (!client) return undefined;
    if (!isUuid(req.params.nid)) return res.status(404).json({ error: 'Заметка не найдена.' });
    const { rowCount } = await db.query(
      'DELETE FROM client_notes WHERE id = $1 AND client_id = $2 AND user_id = $3',
      [req.params.nid, client.id, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Заметка не найдена.' });
    return res.json({ ok: true });
  } catch (err) {
    return handleError(err, res, 'note-delete');
  }
});

module.exports = router;
