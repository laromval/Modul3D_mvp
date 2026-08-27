// Единая точка чтения переменных окружения. Секретов по умолчанию нет —
// плейсхолдеры существуют только чтобы сервер не падал при импорте до того,
// как код реально попробует ими воспользоваться (Stripe/JWT дадут понятную
// ошибку сами, если значение осталось плейсхолдером).

require('dotenv').config();

if (!process.env.JWT_SECRET) {
  console.warn('[config] JWT_SECRET не задан — используется небезопасный дефолт для разработки. ' +
    'В проде обязательно задайте свой JWT_SECRET, иначе любой сможет подделать сессию.');
}

module.exports = {
  port: parseInt(process.env.PORT || '4000', 10),
  corsOrigin: process.env.CORS_ORIGIN || '*',

  databaseUrl: process.env.DATABASE_URL,

  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  startingTokenBalance: parseInt(process.env.STARTING_TOKEN_BALANCE || '20', 10),

  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripePriceId: process.env.STRIPE_PRICE_ID,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  checkoutSuccessUrl: process.env.CHECKOUT_SUCCESS_URL || 'http://localhost:8080/?checkout=success',
  checkoutCancelUrl: process.env.CHECKOUT_CANCEL_URL || 'http://localhost:8080/?checkout=cancel',
};
