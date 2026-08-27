// Роуты платежей (Paddle Billing). Подписка — единственный платный продукт
// на этом этапе; цена захардкожена в один PADDLE_PRICE_ID из .env, т.к. по
// ТЗ-МОНЕТИЗАЦИЯ.md конкретные цифры (цена, периодичность) задаются как
// настройка Paddle Dashboard, а не в коде.
//
// ВАЖНО про body-parsing: /billing/webhook должен получать СЫРОЕ тело
// запроса (express.raw) как СТРОКУ, не распарсенный JSON и не Buffer —
// paddle.webhooks.unmarshal(requestBody: string, ...) по типам SDK
// (dist/types/notifications/helpers/webhooks.d.ts) ожидает именно string.
// Поэтому express.json() применяется точечно, к конкретным роутам, а не
// глобально в index.js — так порядок подключения middleware не имеет
// значения.
//
// === МОДЕЛЬ ЧЕКАУТА PADDLE vs STRIPE (важно, читай перед правкой) ===
// У Stripe checkout — это Checkout Session с готовым hosted-URL, на который
// сервер редиректит клиента. У Paddle Billing нет отдельной сущности
// "Session": вместо неё сервер создаёт Transaction (paddle.transactions.
// create), и уже ГОТОВАЯ transaction содержит поле `checkout.url`
// (подтверждено по типам SDK: dist/types/entities/transaction/transaction.d.ts
// → `checkout: TransactionCheckout | null`, dist/types/entities/shared/
// transaction-checkout.d.ts → `url: string | null`) — это ссылка на
// Paddle-хостируемую страницу оплаты для этой транзакции, куда можно
// редиректить клиента ровно как раньше редиректили на session.url у Stripe.
//
// Но у Paddle есть и альтернативный сценарий — оверлей-чекаут через
// Paddle.js на клиенте, открываемый по transactionId без hosted URL
// (Paddle.Checkout.open({ transactionId })). Хостируемый checkout.url
// подтверждается по типам SDK как поле, которое ЗАПОЛНЯЕТСЯ Paddle в ответе
// (не факт, что он всегда ненулевой — это зависит от настройки "Checkout
// settings" в Paddle Dashboard конкретного аккаунта, которую нельзя
// проверить из кода). Поэтому эндпоинт отдаёт клиенту ОБА варианта —
// checkoutUrl (может быть null) и transactionId + priceId (для оверлея) —
// и решение, какой использовать, принимает Этап 4 (ui-configurator) по
// факту того, что реально пришло от Paddle в конкретном аккаунте.

const express = require('express');

const config = require('../config');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getPaddleClient } = require('../paddleClient');

const router = express.Router();

// POST /billing/checkout — создаёт Paddle Transaction для оформления
// подписки текущим авторизованным пользователем. Название сознательно не
// "checkout-session" (в Paddle нет сущности "session") — см. комментарий
// выше про модель чекаута.
router.post('/checkout', express.json(), requireAuth, async (req, res) => {
  if (!config.paddlePriceId || config.paddlePriceId === 'pri_placeholder') {
    return res.status(503).json({ error: 'Приём платежей ещё не настроен на сервере.' });
  }

  try {
    const paddle = getPaddleClient();

    // Переиспользуем существующего Paddle Customer, если уже был создан для
    // этого пользователя ранее (например, при предыдущей попытке оплаты).
    const { rows } = await db.query(
      'SELECT provider_customer_id FROM subscriptions WHERE user_id = $1',
      [req.user.id]
    );
    let customerId = rows[0] && rows[0].provider_customer_id;

    if (!customerId) {
      // Подтверждено по типам SDK: CustomersResource.create(body: {email,
      // name?, customData?, locale?}) -> Promise<Customer>, Customer.id —
      // dist/types/resources/customers/operations/create-customer-request-body.d.ts,
      // dist/types/entities/customer/customer.d.ts.
      const customer = await paddle.customers.create({
        email: req.user.email,
        customData: { userId: req.user.id },
      });
      customerId = customer.id;

      await db.query(
        `UPDATE subscriptions SET provider_customer_id = $2, provider = 'paddle', updated_at = now()
         WHERE user_id = $1`,
        [req.user.id, customerId]
      );
    }

    // Подтверждено по типам SDK: TransactionsResource.create(body: {items,
    // customerId?, customData?, checkout?: {url?}, ...}) -> Promise<Transaction>
    // — dist/types/resources/transactions/operations/create-transaction-request-body.d.ts.
    const transaction = await paddle.transactions.create({
      items: [{ priceId: config.paddlePriceId, quantity: 1 }],
      customerId,
      // Дублируем user_id в customData транзакции — как страховку, если
      // сопоставление вебхука по customerId по какой-то причине не сработает.
      customData: { userId: req.user.id },
      checkout: { url: config.checkoutSuccessUrl },
    });

    return res.json({
      transactionId: transaction.id,
      priceId: config.paddlePriceId,
      // Может быть null, если Paddle-хостируемый checkout не включён в
      // настройках аккаунта — тогда клиент открывает оверлей Paddle.js по
      // transactionId (см. комментарий выше).
      checkoutUrl: (transaction.checkout && transaction.checkout.url) || null,
    });
  } catch (err) {
    console.error('[billing/checkout] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось создать транзакцию оплаты.' });
  }
});

// POST /billing/webhook — обрабатывает события Paddle. Тело ОБЯЗАТЕЛЬНО
// сырое (express.raw), подпись ОБЯЗАТЕЛЬНО проверяется через
// paddle.webhooks.unmarshal — без этого тело запроса нельзя считать
// достоверным (кто угодно может прислать POST с поддельным JSON).
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!config.paddleWebhookSecret || config.paddleWebhookSecret === 'pdl_ntfset_placeholder') {
      console.error('[billing/webhook] PADDLE_WEBHOOK_SECRET не настроен — событие отклонено.');
      return res.status(503).send('Webhook not configured');
    }

    let event;
    try {
      const paddle = getPaddleClient();
      const signature = req.headers['paddle-signature'];
      // Подтверждено по типам SDK: Webhooks.unmarshal(requestBody: string,
      // secretKey: string, signature: string): Promise<EventEntity> —
      // dist/types/notifications/helpers/webhooks.d.ts. requestBody — именно
      // string, поэтому req.body (Buffer из express.raw) приводим к строке.
      event = await paddle.webhooks.unmarshal(req.body.toString('utf8'), config.paddleWebhookSecret, signature);
    } catch (err) {
      console.error('[billing/webhook] проверка подписи не прошла:', err.message);
      return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
    }

    try {
      await handlePaddleEvent(event);
      return res.json({ received: true });
    } catch (err) {
      console.error('[billing/webhook] ошибка обработки события', event.eventId, err);
      // 500 заставит Paddle повторить доставку позже — обработчик идемпотентен
      // (см. processed_webhook_events), повтор безопасен.
      return res.status(500).json({ error: 'Ошибка обработки события.' });
    }
  }
);

async function handlePaddleEvent(event) {
  // Подтверждено по типам SDK: базовый класс Event (dist/types/entities/
  // events/event.d.ts) имеет поле `eventId` (НЕ `id`) — используем его для
  // идемпотентности вместо event.id, как было у Stripe.
  const eventId = event.eventId;

  await db.withTransaction(async (client) => {
    // Идемпотентность: если событие уже обработано (Paddle может доставить
    // одно и то же событие повторно), тихо выходим внутри той же транзакции.
    const already = await client.query(
      'SELECT 1 FROM processed_webhook_events WHERE event_id = $1',
      [eventId]
    );
    if (already.rows.length > 0) {
      return;
    }

    const eventType = event.eventType;

    if (eventType && eventType.startsWith('subscription.')) {
      // Подтверждено по типам SDK: все события subscription.* (created,
      // updated, activated, trialing, past_due, paused, canceled) несут в
      // event.data совместимый набор полей — id, status, customerId,
      // currentBillingPeriod.endsAt, customData
      // (dist/types/notifications/entities/subscription/subscription-notification.d.ts
      // и subscription-created-notification.d.ts — поля идентичны).
      const subscription = event.data;
      const userId = await resolveUserId(client, subscription);
      if (userId) {
        await upsertSubscription(client, {
          userId,
          providerCustomerId: subscription.customerId,
          providerSubscriptionId: subscription.id,
          status: mapPaddleSubscriptionStatus(subscription.status),
          currentPeriodEnd:
            subscription.currentBillingPeriod && subscription.currentBillingPeriod.endsAt
              ? new Date(subscription.currentBillingPeriod.endsAt)
              : null,
        });
      } else {
        console.error(
          '[billing/webhook] не удалось сопоставить событие подписки с пользователем',
          eventId,
          subscription.id
        );
      }
    } else if (eventType === 'transaction.completed') {
      // Не авторитетно для статуса подписки (его выставляют события
      // subscription.*) — используем только чтобы подстраховать связку
      // customerId/subscriptionId <-> пользователь, если её почему-то ещё
      // нет (например вебхук transaction.completed пришёл раньше
      // subscription.created).
      const transaction = event.data;
      const userId = await resolveUserId(client, transaction);
      if (userId && transaction.subscriptionId) {
        await upsertSubscription(client, {
          userId,
          providerCustomerId: transaction.customerId,
          providerSubscriptionId: transaction.subscriptionId,
          status: null,
          currentPeriodEnd: null,
        });
      }
    }
    // Остальные события (address.*, customer.*, price.* и т.п.) подписке/
    // сервису неинтересны на этом этапе — просто помечаем как обработанные,
    // чтобы Paddle не ретраил впустую.

    await client.query('INSERT INTO processed_webhook_events (event_id) VALUES ($1)', [eventId]);
  });
}

// Пытается найти user_id, привязанный к событию Paddle: сперва по
// provider_customer_id (надёжный путь — мы сами сохраняем эту связку в
// /billing/checkout при создании Paddle Customer), затем — если он ещё не
// сохранён (например, событие пришло раньше, чем наш ответ на checkout) —
// по customData.userId, который сами же передаём при создании Customer и
// Transaction.
async function resolveUserId(client, entity) {
  if (entity.customerId) {
    const { rows } = await client.query(
      'SELECT user_id FROM subscriptions WHERE provider_customer_id = $1',
      [entity.customerId]
    );
    if (rows.length > 0) {
      return rows[0].user_id;
    }
  }
  if (entity.customData && entity.customData.userId) {
    return entity.customData.userId;
  }
  return null;
}

// Обновляет строку subscriptions пользователя.
async function upsertSubscription(client, { userId, providerCustomerId, providerSubscriptionId, status, currentPeriodEnd }) {
  await client.query(
    `INSERT INTO subscriptions (user_id, status, provider, provider_customer_id, provider_subscription_id, current_period_end, updated_at)
     VALUES ($1, COALESCE($2, 'none'), 'paddle', $3, $4, $5, now())
     ON CONFLICT (user_id) DO UPDATE SET
       status = COALESCE($2, subscriptions.status),
       provider = 'paddle',
       provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, subscriptions.provider_customer_id),
       provider_subscription_id = COALESCE(EXCLUDED.provider_subscription_id, subscriptions.provider_subscription_id),
       current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
       updated_at = now()`,
    [userId, status, providerCustomerId || null, providerSubscriptionId || null, currentPeriodEnd || null]
  );
}

// Подтверждено по типам SDK: SubscriptionStatus = 'active' | 'canceled' |
// 'past_due' | 'paused' | 'trialing'
// (dist/types/enums/subscription/subscription-status.d.ts) — набор статусов
// у Paddle УЖЕ является тем сжатым набором, который нужен клиенту (в
// отличие от Stripe, где статусов было больше и требовалось сжатие).
// 'paused' сопоставляем с 'past_due': по смыслу оба означают "доступ не
// должен быть открыт, но подписка не отменена окончательно" — трактовка
// не из документации, а по аналогии со старой Stripe-логикой; если для
// 'paused' нужна отдельная семантика на клиенте, значение нужно завести
// отдельно.
function mapPaddleSubscriptionStatus(paddleStatus) {
  if (paddleStatus === 'active' || paddleStatus === 'trialing') return 'active';
  if (paddleStatus === 'past_due' || paddleStatus === 'paused') return 'past_due';
  if (paddleStatus === 'canceled') return 'canceled';
  return paddleStatus;
}

module.exports = router;
