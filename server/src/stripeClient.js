// Единый клиент Stripe SDK. Инициализируется лениво, чтобы отсутствие
// STRIPE_SECRET_KEY (плейсхолдер из .env.example) не валило сервер при
// старте — упадёт только конкретный запрос, который реально обращается
// к Stripe, с понятной ошибкой.

const Stripe = require('stripe');
const config = require('./config');

let client = null;

function getStripeClient() {
  if (!config.stripeSecretKey || config.stripeSecretKey === 'sk_test_placeholder') {
    throw new Error(
      'STRIPE_SECRET_KEY не настроен. Заполни server/.env реальным секретным ключом Stripe.'
    );
  }
  if (!client) {
    client = new Stripe(config.stripeSecretKey);
  }
  return client;
}

module.exports = { getStripeClient };
