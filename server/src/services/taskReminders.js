// Планировщик напоминаний о задачах клиентов: раз в REMINDER_TICK_MS ищет
// задачи, у которых наступило remind_at, и шлёт push на устройства
// владельца (pushService.sendToUser).
//
// Гарантия «не больше одного раза»: напоминание сначала помечается
// отправленным (reminded_at) одним UPDATE ... SKIP LOCKED, и только потом
// отправляется — два процесса не пришлют его дважды. Если ВСЕ отправки
// закончились временной ошибкой, пометка снимается (но не дольше
// RETRY_WINDOW_MS после времени напоминания, чтобы не напоминать «вчера»).

const db = require('../db');
const { decryptJson, WorkflowKeyMissingError } = require('./workflowCrypto');
const pushService = require('./pushService');

const REMINDER_TICK_MS = 30 * 1000;
const RETRY_WINDOW_MS = 60 * 60 * 1000;
const BATCH = 50;

// «Срок через 15 минут» — без часовых поясов: сервер не знает, где
// пользователь, поэтому говорим только интервалом.
function dueText(min) {
  if (!min) return 'Срок наступил';
  if (min % 1440 === 0) {
    const d = min / 1440;
    return 'Срок через ' + d + (d === 1 ? ' день' : (d < 5 ? ' дня' : ' дней'));
  }
  if (min % 60 === 0) {
    const h = min / 60;
    return 'Срок через ' + h + (h === 1 ? ' час' : (h < 5 ? ' часа' : ' часов'));
  }
  return 'Срок через ' + min + ' мин';
}

function reminderPayload(row, title) {
  const where = row.project_name ? row.client_name + ' · ' + row.project_name : row.client_name;
  return {
    title: title,
    body: dueText(row.remind_before_min) + ' — ' + where,
    tag: 'task-' + row.id,
    taskId: row.id,
    url: '/?open=clients',
  };
}

// Одна проверка. send/now подменяются в тестах. Возвращает число
// обработанных напоминаний.
async function processDueReminders({ send, now } = {}) {
  const nowDate = now || new Date();
  const claimed = await db.query(
    `UPDATE client_tasks t SET reminded_at = $1
      WHERE t.id IN (
        SELECT id FROM client_tasks
         WHERE reminded_at IS NULL AND remind_at IS NOT NULL AND remind_at <= $1 AND status <> 'done'
         ORDER BY remind_at LIMIT ${BATCH}
         FOR UPDATE SKIP LOCKED)
      RETURNING t.id, t.user_id, t.client_id, t.project_id, t.title, t.remind_at, t.remind_before_min`,
    [nowDate]
  );
  let handled = 0;
  for (const row of claimed.rows) {
    handled += 1;
    try {
      const info = await db.query(
        `SELECT c.name AS client_name, p.name AS project_name
           FROM clients c LEFT JOIN client_projects p ON p.id = $2
          WHERE c.id = $1`,
        [row.client_id, row.project_id]
      );
      const names = info.rows[0] || { client_name: '', project_name: null };
      const title = decryptJson(row.title);
      const payload = reminderPayload({ ...row, ...names }, title);
      const res = await pushService.sendToUser(row.user_id, payload, send ? { send } : undefined);
      const retryable = res.devices > 0 && res.sent === 0 && res.removed < res.devices && res.failed > 0;
      if (retryable && nowDate.getTime() - new Date(row.remind_at).getTime() < RETRY_WINDOW_MS) {
        await db.query('UPDATE client_tasks SET reminded_at = NULL WHERE id = $1', [row.id]);
      }
    } catch (err) {
      // Ключ шифрования пропал или запись нечитаема — снимаем пометку, чтобы
      // напоминание не потерялось при восстановлении ключа (в пределах окна).
      if (nowDate.getTime() - new Date(row.remind_at).getTime() < RETRY_WINDOW_MS) {
        await db.query('UPDATE client_tasks SET reminded_at = NULL WHERE id = $1', [row.id]).catch(() => {});
      }
      if (!(err instanceof WorkflowKeyMissingError)) console.error('[reminders] ошибка:', err);
    }
  }
  return handled;
}

let timer = null;
let running = false;

function startReminderLoop() {
  if (timer || process.env.REMINDERS_DISABLED === '1') return;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await processDueReminders();
    } catch (err) {
      console.error('[reminders] цикл:', err && err.message);
    } finally {
      running = false;
    }
  }, REMINDER_TICK_MS);
}

module.exports = { processDueReminders, startReminderLoop, dueText };
