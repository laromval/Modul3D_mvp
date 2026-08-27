// Единый клиент Paddle SDK (@paddle/paddle-node-sdk). Инициализируется
// лениво, чтобы отсутствие PADDLE_API_KEY (плейсхолдер из .env.example) не
// валило сервер при старте — упадёт только конкретный запрос, который
// реально обращается к Paddle, с понятной ошибкой.
//
// ПРОВЕРЕНО ПО ТИПАМ SDK (node_modules/@paddle/paddle-node-sdk/dist/types/paddle.d.ts):
// конструктор — new Paddle(apiKey, { environment }), environment — enum
// Environment.sandbox | Environment.production
// (node_modules/@paddle/paddle-node-sdk/dist/types/internal/api/environment.d.ts).

const { Paddle, Environment } = require('@paddle/paddle-node-sdk');
const config = require('./config');

let client = null;

function resolveEnvironment() {
  // По умолчанию — sandbox, а не production: если PADDLE_ENVIRONMENT не
  // задан явно, безопаснее не рисковать случайным приёмом настоящих денег
  // с недонастроенным сервером.
  return config.paddleEnvironment === 'production' ? Environment.production : Environment.sandbox;
}

function getPaddleClient() {
  if (!config.paddleApiKey || config.paddleApiKey === 'pdl_placeholder') {
    throw new Error(
      'PADDLE_API_KEY не настроен. Заполни server/.env реальным API-ключом Paddle (Developer Tools → Authentication).'
    );
  }
  if (!client) {
    client = new Paddle(config.paddleApiKey, { environment: resolveEnvironment() });
  }
  return client;
}

module.exports = { getPaddleClient };
