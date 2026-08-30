// Уведомление владельца проекта в Telegram о новом отзыве на модерации.
//
// Обычный HTTP-запрос к Telegram Bot API (без сторонних npm-пакетов), в
// том же стиле, что и вызов Anthropic в services/sketchRecognition.js:
// таймаут, try/catch вокруг сетевого вызова, ошибки только логируются.
//
// Если TELEGRAM_BOT_TOKEN и/или TELEGRAM_CHAT_ID не заданы — уведомления
// молча не отправляются, это штатное состояние (см. config.js), а не сбой.
// Отправка никогда не бросает исключение наружу — вызывающий код
// (routes/reviews.js) не должен ни ждать её, ни оборачивать в try/catch.

const config = require('../config');

const MAX_BODY_LENGTH = 500;
const REQUEST_TIMEOUT_MS = 10000;

function truncate(text, maxLength) {
  if (typeof text !== 'string') return '';
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
}

function buildMessage({ nickname, email, body, reviewId }) {
  const moderationUrl = `${config.publicServerUrl}/admin/reviews.html`;
  return [
    'Новый отзыв на модерации в Modul3D',
    `От: ${nickname || '(без никнейма)'} <${email || '(без email)'}>`,
    '',
    truncate(body, MAX_BODY_LENGTH),
    '',
    `Модерация: ${moderationUrl}`,
    reviewId != null ? `ID отзыва: ${reviewId}` : null,
  ].filter((line) => line !== null).join('\n');
}

/**
 * Отправляет уведомление о новом отзыве в Telegram. Не бросает исключения —
 * при отсутствии настройки или сбое API просто логирует и завершается.
 * @param {{ nickname?: string, email?: string, body: string, reviewId?: string|number }} params
 */
async function notifyNewReview({ nickname, email, body, reviewId } = {}) {
  if (!config.telegramBotToken || !config.telegramChatId) {
    // Бот ещё не настроен владельцем проекта — штатное состояние, тихо выходим.
    return;
  }

  const apiUrl = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  const text = buildMessage({ nickname, email, body, reviewId });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: config.telegramChatId, text }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[telegramNotify] Telegram API ответил ${res.status}: ${errText.slice(0, 300)}`);
    }
  } catch (err) {
    console.error('[telegramNotify] не удалось отправить уведомление:', err.message);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { notifyNewReview };
