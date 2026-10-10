// Задачи клиентов со сроком и напоминанием (миграция 009). Задача
// принадлежит клиенту и, по желанию, его проекту. Как и весь раздел
// «Клиенты», данные личные: каждый запрос фильтруется по user_id из JWT,
// чужое неотличимо от несуществующего (404).
//
// Контракт (Authorization: Bearer <JWT>, подтверждённый email):
//   GET    /tasks?status=open|done|all&client=<uuid>&project=<uuid|none>
//                                            -> { tasks: [...] } (+ clientName, projectName)
//   GET    /tasks/summary                    -> { open, overdue }
//   POST   /tasks { clientId, projectId?, title, details?, dueAt?, remindBeforeMin? }
//   PATCH  /tasks/:id { title?, details?, status?, projectId?, dueAt?, remindBeforeMin? }
//   DELETE /tasks/:id
//   DELETE /tasks?client=&project=            -> { deleted } (только выполненные)
//
// dueAt — ISO-время (с часовым поясом), null убирает срок. remindBeforeMin —
// за сколько минут до срока напомнить (0 — в момент срока), null — не
// напоминать; требует срока. Название и описание хранятся зашифрованными
// (WORKFLOW_ENC_KEY), без ключа — 503.

const express = require('express');

const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireVerifiedEmail } = require('../middleware/emailVerification');
const { encryptJson } = require('../services/workflowCrypto');
const { isUuid, cleanText, handleError, safeDecrypt } = require('../services/clientHelpers');

const router = express.Router();

router.use(express.json({ limit: '64kb' }));
router.use(requireAuth);
router.use(requireVerifiedEmail);

const MAX_TASKS_PER_CLIENT = 1000;
const MAX_TITLE = 200;
const MAX_DETAILS = 5000;
const MAX_REMIND_MIN = 7 * 24 * 60;
const STATUSES = ['todo', 'doing', 'done'];
const LIST_LIMIT = 500;
// Напоминание, время которого прошло больше минуты назад, создать нельзя —
// оно бы не сработало, а человек думал бы, что оно стоит.
const PAST_GRACE_MS = 60 * 1000;

function parseDue(raw) {
  if (raw === null) return { value: null };
  if (typeof raw !== 'string') return { error: 'Срок: ожидается дата и время.' };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000 || d.getFullYear() > 2100) {
    return { error: 'Срок: неверная дата.' };
  }
  return { value: d };
}

function parseRemind(raw) {
  if (raw === null) return { value: null };
  if (!Number.isInteger(raw) || raw < 0 || raw > MAX_REMIND_MIN) {
    return { error: 'Напоминание: от 0 минут до 7 дней.' };
  }
  return { value: raw };
}

function taskDto(row) {
  const title = safeDecrypt(row.title);
  const details = safeDecrypt(row.details);
  return {
    id: row.id,
    clientId: row.client_id,
    projectId: row.project_id,
    title: title.value,
    details: details.value,
    unreadable: !!(title.unreadable || details.unreadable),
    status: row.status,
    dueAt: row.due_at,
    remindBeforeMin: row.remind_before_min,
    reminded: row.reminded_at !== null,
    doneAt: row.done_at,
    clientName: row.client_name,
    projectName: row.project_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_TASK = `
  SELECT t.*, c.name AS client_name, p.name AS project_name
    FROM client_tasks t
    JOIN clients c ON c.id = t.client_id AND c.user_id = t.user_id
    LEFT JOIN client_projects p ON p.id = t.project_id AND p.user_id = t.user_id`;

async function loadOwnTask(req, res) {
  const id = req.params.id;
  if (!isUuid(id)) { res.status(404).json({ error: 'Задача не найдена.' }); return null; }
  const { rows } = await db.query(`${SELECT_TASK} WHERE t.id = $1 AND t.user_id = $2`, [id, req.user.id]);
  if (rows.length === 0) { res.status(404).json({ error: 'Задача не найдена.' }); return null; }
  return rows[0];
}

// Проверяет, что клиент и (если указан) проект принадлежат пользователю и
// проект — этого клиента. Возвращает true или отвечает 404.
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

// remind_at = срок − интервал; null, если срока или интервала нет.
function computeRemindAt(due, remindMin) {
  if (!due || remindMin === null || remindMin === undefined) return null;
  return new Date(due.getTime() - remindMin * 60 * 1000);
}

// ------------------------------------------------------------------- список

router.get('/summary', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS open,
              COUNT(*) FILTER (WHERE due_at IS NOT NULL AND due_at < now())::int AS overdue
         FROM client_tasks WHERE user_id = $1 AND status <> 'done'`,
      [req.user.id]
    );
    return res.json(rows[0]);
  } catch (err) {
    return handleError(err, res, 'tasks-summary');
  }
});

router.get('/', async (req, res) => {
  const status = req.query.status === 'done' || req.query.status === 'all' ? req.query.status : 'open';
  const where = ['t.user_id = $1'];
  const params = [req.user.id];
  if (status === 'open') where.push("t.status <> 'done'");
  else if (status === 'done') where.push("t.status = 'done'");
  if (req.query.client !== undefined) {
    if (!isUuid(req.query.client)) return res.json({ tasks: [] });
    params.push(req.query.client); where.push(`t.client_id = $${params.length}`);
  }
  if (req.query.project !== undefined) {
    if (req.query.project === 'none') where.push('t.project_id IS NULL');
    else if (!isUuid(req.query.project)) return res.json({ tasks: [] });
    else { params.push(req.query.project); where.push(`t.project_id = $${params.length}`); }
  }
  const order = status === 'done'
    ? 't.done_at DESC NULLS LAST, t.created_at DESC'
    : 't.due_at ASC NULLS LAST, t.created_at DESC';
  try {
    const { rows } = await db.query(
      `${SELECT_TASK} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${LIST_LIMIT}`,
      params
    );
    return res.json({ tasks: rows.map(taskDto) });
  } catch (err) {
    return handleError(err, res, 'tasks-list');
  }
});

// ------------------------------------------------------------------ создание

router.post('/', async (req, res) => {
  const body = req.body || {};
  const title = cleanText(body.title, MAX_TITLE, 'название задачи', { required: true });
  if (title.error) return res.status(400).json({ error: title.error });
  const details = cleanText(body.details, MAX_DETAILS, 'описание', { required: false });
  if (details.error) return res.status(400).json({ error: details.error });
  let due = { value: null };
  if (body.dueAt !== undefined) { due = parseDue(body.dueAt); if (due.error) return res.status(400).json({ error: due.error }); }
  let remind = { value: null };
  if (body.remindBeforeMin !== undefined) { remind = parseRemind(body.remindBeforeMin); if (remind.error) return res.status(400).json({ error: remind.error }); }
  if (remind.value !== null && due.value === null) {
    return res.status(400).json({ error: 'Напоминание возможно только для задачи со сроком.' });
  }
  const remindAt = computeRemindAt(due.value, remind.value);
  if (remindAt && remindAt.getTime() < Date.now() - PAST_GRACE_MS) {
    return res.status(400).json({ error: 'Время напоминания уже прошло — выберите меньший интервал или более поздний срок.' });
  }

  try {
    const projectId = body.projectId === undefined ? null : body.projectId;
    if (!(await checkOwnership(req, res, body.clientId, projectId))) return undefined;
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM client_tasks WHERE user_id = $1 AND client_id = $2', [req.user.id, body.clientId]);
    if (cnt.rows[0].n >= MAX_TASKS_PER_CLIENT) {
      return res.status(409).json({ error: `Достигнут предел: не более ${MAX_TASKS_PER_CLIENT} задач на клиента.` });
    }
    const { rows } = await db.query(
      `INSERT INTO client_tasks (user_id, client_id, project_id, title, details, due_at, remind_before_min, remind_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [req.user.id, body.clientId, projectId, encryptJson(title.value),
        details.value === null ? null : encryptJson(details.value),
        due.value, remind.value, remindAt]
    );
    const full = await db.query(`${SELECT_TASK} WHERE t.id = $1 AND t.user_id = $2`, [rows[0].id, req.user.id]);
    return res.status(201).json({ task: taskDto(full.rows[0]) });
  } catch (err) {
    return handleError(err, res, 'tasks-create');
  }
});

// ------------------------------------------------------------------- правка

router.patch('/:id', async (req, res) => {
  const body = req.body || {};
  try {
    const task = await loadOwnTask(req, res);
    if (!task) return undefined;

    const sets = [];
    const params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (body.title !== undefined) {
      const t = cleanText(body.title, MAX_TITLE, 'название задачи', { required: true });
      if (t.error) return res.status(400).json({ error: t.error });
      add('title', encryptJson(t.value));
    }
    if (body.details !== undefined) {
      const d = cleanText(body.details, MAX_DETAILS, 'описание', { required: false });
      if (d.error) return res.status(400).json({ error: d.error });
      add('details', d.value === null ? null : encryptJson(d.value));
    }
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return res.status(400).json({ error: 'Статус: todo, doing или done.' });
      add('status', body.status);
      if (body.status === 'done') { if (task.status !== 'done') sets.push('done_at = now()'); }
      else sets.push('done_at = NULL');
    }
    if (body.projectId !== undefined) {
      if (!(await checkOwnership(req, res, task.client_id, body.projectId))) return undefined;
      add('project_id', body.projectId);
    }

    // Срок и напоминание пересчитываются вместе: смена любого сбрасывает
    // «уже отправлено», чтобы новое напоминание сработало.
    if (body.dueAt !== undefined || body.remindBeforeMin !== undefined) {
      let due = { value: task.due_at ? new Date(task.due_at) : null };
      if (body.dueAt !== undefined) { due = parseDue(body.dueAt); if (due.error) return res.status(400).json({ error: due.error }); }
      let remindMin = task.remind_before_min;
      if (body.remindBeforeMin !== undefined) {
        const r = parseRemind(body.remindBeforeMin);
        if (r.error) return res.status(400).json({ error: r.error });
        remindMin = r.value;
      }
      if (due.value === null) {
        if (body.remindBeforeMin !== undefined && body.remindBeforeMin !== null) {
          return res.status(400).json({ error: 'Напоминание возможно только для задачи со сроком.' });
        }
        remindMin = null; // убрали срок — убираем и напоминание
      }
      const remindAt = computeRemindAt(due.value, remindMin);
      if (remindAt && remindAt.getTime() < Date.now() - PAST_GRACE_MS) {
        return res.status(400).json({ error: 'Время напоминания уже прошло — выберите меньший интервал или более поздний срок.' });
      }
      add('due_at', due.value);
      add('remind_before_min', remindMin);
      add('remind_at', remindAt);
      sets.push('reminded_at = NULL');
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Нечего менять.' });

    params.push(task.id, req.user.id);
    await db.query(
      `UPDATE client_tasks SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${params.length - 1} AND user_id = $${params.length}`,
      params
    );
    const full = await db.query(`${SELECT_TASK} WHERE t.id = $1 AND t.user_id = $2`, [task.id, req.user.id]);
    return res.json({ task: taskDto(full.rows[0]) });
  } catch (err) {
    return handleError(err, res, 'tasks-update');
  }
});

// Удалить все ВЫПОЛНЕННЫЕ задачи (только свои): ?client=<uuid>&project=<uuid|none>
// — по клиенту/проекту, без параметров — все выполненные пользователя.
router.delete('/', async (req, res) => {
  const where = ['user_id = $1', "status = 'done'"];
  const params = [req.user.id];
  if (req.query.client !== undefined) {
    if (!isUuid(req.query.client)) return res.json({ deleted: 0 });
    params.push(req.query.client); where.push(`client_id = $${params.length}`);
  }
  if (req.query.project !== undefined) {
    if (req.query.project === 'none') where.push('project_id IS NULL');
    else if (!isUuid(req.query.project)) return res.json({ deleted: 0 });
    else { params.push(req.query.project); where.push(`project_id = $${params.length}`); }
  }
  try {
    const r = await db.query(`DELETE FROM client_tasks WHERE ${where.join(' AND ')}`, params);
    return res.json({ deleted: r.rowCount });
  } catch (err) {
    return handleError(err, res, 'tasks-delete-done');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const task = await loadOwnTask(req, res);
    if (!task) return undefined;
    await db.query('DELETE FROM client_tasks WHERE id = $1 AND user_id = $2', [task.id, req.user.id]);
    return res.json({ ok: true });
  } catch (err) {
    return handleError(err, res, 'tasks-delete');
  }
});

module.exports = router;
