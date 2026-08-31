// Отправка письма подтверждения email через Brevo Transactional Email API
// (https://api.brevo.com/v3/smtp/email).
//
// Обычный HTTP-запрос через нативный fetch (без сторонних npm-пакетов), в
// том же стиле, что и services/telegramNotify.js: таймаут через
// AbortController, try/catch вокруг сетевого вызова, ошибки только
// логируются. Если BREVO_API_KEY не задан — тихий no-op (лог-warning),
// регистрация не должна падать из-за письма.
//
// Отправка никогда не бросает исключение наружу — вызывающий код
// (routes/auth.js) не должен ждать её результата дольше, чем нужно, и не
// должен оборачивать вызов в try/catch.

const config = require('../config');

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const REQUEST_TIMEOUT_MS = 10000;

// config.emailFromAddress допускает формат "Имя <email@domain>" (как принято
// в остальных местах проекта, см. .env.example) — Brevo же ждёт email и name
// отдельными полями, поэтому разбираем строку один раз здесь.
function parseFromAddress(raw) {
  const match = /^(.*)<(.+)>$/.exec(raw || '');
  if (match) {
    const name = match[1].trim().replace(/^["']|["']$/g, '');
    const email = match[2].trim();
    return { name: name || config.emailFromName, email };
  }
  return { name: config.emailFromName, email: (raw || '').trim() };
}

/**
 * Отправляет письмо со ссылкой подтверждения email. Не бросает исключения —
 * при отсутствии настройки или сбое API просто логирует и завершается.
 * @param {string} toEmail
 * @param {string} verificationUrl
 */
async function sendVerificationEmail(toEmail, verificationUrl) {
  if (!config.brevoApiKey) {
    console.warn(
      '[emailSender] BREVO_API_KEY не задан — письмо подтверждения email не отправлено ' +
        `(${toEmail}). Настрой Brevo, чтобы подтверждение email работало.`
    );
    return;
  }

  const sender = parseFromAddress(config.emailFromAddress);
  const subject = 'Подтвердите email в Modul3D';
  const htmlContent = [
    '<p>Здравствуйте!</p>',
    '<p>Чтобы подтвердить владение этим email в Modul3D, перейдите по ссылке ниже:</p>',
    `<p><a href="${verificationUrl}">${verificationUrl}</a></p>`,
    '<p>Ссылка действительна ограниченное время. Если вы не регистрировались в Modul3D — просто проигнорируйте это письмо.</p>',
  ].join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'api-key': config.brevoApiKey,
      },
      body: JSON.stringify({
        sender,
        to: [{ email: toEmail }],
        subject,
        htmlContent,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[emailSender] Brevo API ответил ${res.status}: ${errText.slice(0, 300)}`);
    }
  } catch (err) {
    console.error('[emailSender] не удалось отправить письмо подтверждения:', err.message);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { sendVerificationEmail };
