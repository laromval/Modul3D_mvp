// Общие помощники раздела «Клиенты» (клиенты, проекты, заметки, задачи):
// проверка id, чистка текста, обработка ошибок и безопасная расшифровка.

const { decryptJson, WorkflowKeyMissingError } = require('./workflowCrypto');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

// Название/контакт: строка, обрезаются пробелы по краям. Возвращает
// { value } или { error }.
function cleanText(raw, max, label, { required }) {
  if (raw === undefined || raw === null) {
    return required ? { error: `Не указано: ${label}.` } : { value: null };
  }
  if (typeof raw !== 'string') return { error: `Некорректное значение: ${label}.` };
  const value = raw.trim();
  if (!value) return required ? { error: `Не указано: ${label}.` } : { value: null };
  if (value.length > max) return { error: `${label}: не более ${max} символов.` };
  return { value };
}

function handleError(err, res, what) {
  if (err instanceof WorkflowKeyMissingError) {
    console.error('[clients] WORKFLOW_ENC_KEY не задан — контакты и заметки недоступны.');
    return res.status(503).json({ error: 'На сервере не задан ключ шифрования (WORKFLOW_ENC_KEY).' });
  }
  console.error(`[clients/${what}] ошибка:`, err);
  return res.status(500).json({ error: 'Не удалось выполнить операцию с клиентами.' });
}

function safeDecrypt(payload) {
  if (payload === null || payload === undefined) return { value: null };
  try {
    return { value: decryptJson(payload) };
  } catch (err) {
    if (err instanceof WorkflowKeyMissingError) throw err;
    // Ключ сменили или запись повреждена — не роняем весь список.
    return { value: null, unreadable: true };
  }
}


module.exports = { isUuid, cleanText, handleError, safeDecrypt };
