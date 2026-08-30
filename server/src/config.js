// Единая точка чтения переменных окружения. Секретов по умолчанию нет —
// плейсхолдеры существуют только чтобы сервер не падал при импорте до того,
// как код реально попробует ими воспользоваться (Paddle/JWT дадут понятную
// ошибку сами, если значение осталось плейсхолдером).

require('dotenv').config();

if (!process.env.JWT_SECRET) {
  console.warn('[config] JWT_SECRET не задан — используется небезопасный дефолт для разработки. ' +
    'В проде обязательно задайте свой JWT_SECRET, иначе любой сможет подделать сессию.');
}

// Managed Postgres в облаке (Railway, Render, Supabase, Neon и т.п.) почти
// всегда требует SSL и использует самоподписанный сертификат — без
// `rejectUnauthorized: false` подключение падает с "self signed certificate"
// или "no encryption". Локальный Postgres (localhost/127.0.0.1), наоборот,
// обычно SSL не поддерживает вовсе. Определяем по хосту в самой строке
// подключения, чтобы не заводить отдельную переменную окружения.
function resolveDatabaseSsl(connectionString) {
  if (!connectionString) return false;
  const isLocalHost = /(?:@|\/\/)(localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(
    connectionString
  );
  return isLocalHost ? false : { rejectUnauthorized: false };
}

module.exports = {
  port: parseInt(process.env.PORT || '4000', 10),
  corsOrigin: process.env.CORS_ORIGIN || '*',

  databaseUrl: process.env.DATABASE_URL,
  databaseSsl: resolveDatabaseSsl(process.env.DATABASE_URL),
  resolveDatabaseSsl,

  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  startingTokenBalance: parseInt(process.env.STARTING_TOKEN_BALANCE || '20', 10),

  paddleApiKey: process.env.PADDLE_API_KEY,
  paddlePriceId: process.env.PADDLE_PRICE_ID,
  paddleWebhookSecret: process.env.PADDLE_WEBHOOK_SECRET,
  // 'sandbox' | 'production' — см. paddleClient.js. По умолчанию sandbox.
  paddleEnvironment: process.env.PADDLE_ENVIRONMENT || 'sandbox',
  // Единственный URL возврата, который принимает Paddle Transaction
  // (checkout.url в запросе) — у Paddle, в отличие от Stripe, нет отдельного
  // cancel_url: при отмене пользователь просто закрывает окно чекаута.
  checkoutSuccessUrl: process.env.CHECKOUT_SUCCESS_URL || 'http://localhost:8080/?checkout=success',

  // --- Этап 2: прокси ИИ-эскиза (server/src/services/sketchRecognition.js) ---
  // Серверный ключ Anthropic — никогда не попадает в клиентский код/ответ.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  // Стоимость одного распознавания эскиза в токенах (ТЗ-МОНЕТИЗАЦИЯ.md, 4.1).
  sketchTokenCost: parseInt(process.env.SKETCH_TOKEN_COST || '1', 10),

  // Приватный токен для модерационных эндпоинтов отзывов
  // (GET /reviews/pending, POST /reviews/:id/approve|reject) — не полноценные
  // роли, у проекта на этом этапе один владелец. Если не задан, эти
  // эндпоинты отклоняют все запросы (см. requireAdmin в routes/reviews.js).
  adminToken: process.env.ADMIN_TOKEN,

  // Публичный адрес самого сервера (без завершающего слэша) — используется
  // только для формирования ссылок (например, на страницу модерации отзывов
  // в уведомлении в Telegram, см. services/telegramNotify.js). Не влияет на
  // то, где сервер реально слушает.
  publicServerUrl: process.env.PUBLIC_SERVER_URL || `http://localhost:${process.env.PORT || '4000'}`,

  // Telegram-уведомление о новом отзыве (services/telegramNotify.js). Если
  // хотя бы одна из двух переменных не задана — уведомления просто не
  // отправляются (штатное состояние, пока владелец не настроит бота).
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
};
