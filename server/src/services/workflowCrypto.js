// Шифрование данных страницы Workflow (AES-256-GCM).
// Ключ берётся из WORKFLOW_ENC_KEY (любая достаточно длинная случайная
// строка): из неё через SHA-256 получается 32-байтный ключ. Если переменная
// не задана — шифровать нечем, а хранить открытым текстом нельзя, поэтому
// функции бросают WorkflowKeyMissingError (роут отвечает 503).
//
// Формат строки: "v1." + base64(iv[12] | authTag[16] | ciphertext).

const crypto = require('crypto');
const config = require('../config');

class WorkflowKeyMissingError extends Error {}

function getKey() {
  const raw = config.workflowEncKey;
  if (!raw || raw.length < 16) throw new WorkflowKeyMissingError('WORKFLOW_ENC_KEY не задан или слишком короткий.');
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

function encryptJson(value) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return 'v1.' + Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

function decryptJson(payload) {
  const key = getKey();
  if (typeof payload !== 'string' || !payload.startsWith('v1.')) throw new Error('Неизвестный формат данных.');
  const buf = Buffer.from(payload.slice(3), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  const dec = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

module.exports = { encryptJson, decryptJson, WorkflowKeyMissingError };
