// Роуты платежей (Stripe). Подписка — единственный платный продукт на
// этом этапе; список цен захардкожен в один STRIPE_PRICE_ID из .env, т.к.
// по ТЗ-МОНЕТИЗАЦИЯ.md конкретные цифры (цена, периодичность) задаются как
// настройка Stripe Dashboard, а не в коде.
//
// ВАЖНО про body-parsing: /billing/webhook должен получать СЫРОЕ тело
// запроса (express.raw), не распарсенный JSON — иначе stripe.webhooks.
// constructEvent не сможет проверить подпись. Поэтому express.json()
// применяется здесь точечно, к конкретным роутам, а не глобально в
// index.js — так порядок подключения middleware не имеет значения.

const express = require('express');

const config = require('../config');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getStripeClient } = require('../stripeClient');

const router = express.Router();

// POST /billing/checkout-session — создаёт Stripe Checkout Session для
// оформления подписки текущим авторизованным пользователем.
router.post('/checkout-session', express.json(), requireAuth, async (req, res) => {
  if (!config.stripePriceId || config.stripePriceId === 'price_placeholder') {
    return res.status(503).json({ error: 'Приём платежей ещё не настроен на сервере.' });
  }

  try {
    const stripe = getStripeClient();

    // Переиспользуем существующего Stripe Customer, если уже был создан
    // для этого пользователя ранее (например, при предыдущей попытке оплаты).
    const { rows } = await db.query(
      'SELECT provider_customer_id FROM subscriptions WHERE user_id = $1',
      [req.user.id]
    );
    const existingCustomerId = rows[0] && rows[0].provider_customer_id;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: existingCustomerId || undefined,
      customer_email: existingCustomerId ? undefined : req.user.email,
      client_reference_id: req.user.id,
      line_items: [{ price: config.stripePriceId, quantity: 1 }],
      success_url: config.checkoutSuccessUrl,
      cancel_url: config.checkoutCancelUrl,
      // Дублируем user_id в metadata подписки — понадобится в вебхуке,
      // если событие придёт раньше, чем мы успеем сохранить customer_id.
      subscription_data: {
        metadata: { user_id: req.user.id },
      },
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('[billing/checkout-session] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось создать сессию оплаты.' });
  }
});

// POST /billing/webhook — обрабатывает события Stripe. Тело ОБЯЗАТЕЛЬНО
// сырое (express.raw), подпись ОБЯЗАТЕЛЬНО проверяется через
// stripe.webhooks.constructEvent — без этого тело запроса нельзя считать
// достоверным (кто угодно может прислать POST с поддельным JSON).
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!config.stripeWebhookSecret || config.stripeWebhookSecret === 'whsec_placeholder') {
      console.error('[billing/webhook] STRIPE_WEBHOOK_SECRET не настроен — событие отклонено.');
      return res.status(503).send('Webhook not configured');
    }

    let event;
    try {
      const stripe = getStripeClient();
      const signature = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(req.body, signature, config.stripeWebhookSecret);
    } catch (err) {
      console.error('[billing/webhook] проверка подписи не прошла:', err.message);
      return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
    }

    try {
      await handleStripeEvent(event);
      return res.json({ received: true });
    } catch (err) {
      console.error('[billing/webhook] ошибка обработки события', event.id, err);
      // 500 заставит Stripe повторить доставку позже — обработчик идемпотентен
      // (см. processed_webhook_events), повтор безопасен.
      return res.status(500).json({ error: 'Ошибка обработки события.' });
    }
  }
);

async function handleStripeEvent(event) {
  await db.withTransaction(async (client) => {
    // Идемпотентность: если событие уже обработано (Stripe может доставить
    // одно и то же событие повторно), тихо выходим внутри той же транзакции.
    const already = await client.query(
      'SELECT 1 FROM processed_webhook_events WHERE event_id = $1',
      [event.id]
    );
    if (already.rows.length > 0) {
      return;
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id;
        if (userId) {
          await upsertSubscription(client, {
            userId,
            status: 'active',
            providerCustomerId: session.customer,
            providerSubscriptionId: session.subscription,
          });
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const subscription = event.data.object;
        const userId = subscription.metadata && subscription.metadata.user_id;
        await upsertSubscription(client, {
          userId,
          providerCustomerId: subscription.customer,
          providerSubscriptionId: subscription.id,
          status: mapStripeStatus(subscription.status),
          currentPeriodEnd: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : null,
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await client.query(
          `UPDATE subscriptions
           SET status = 'canceled', updated_at = now()
           WHERE provider_subscription_id = $1`,
          [subscription.id]
        );
        break;
      }

      default:
        // Остальные события подписке/сервису неинтересны на этом этапе —
        // помечаем как обработанные, чтобы Stripe не ретраил впустую.
        break;
    }

    await client.query('INSERT INTO processed_webhook_events (event_id) VALUES ($1)', [event.id]);
  });
}

// Обновляет строку subscriptions пользователя. По userId, если известен,
// иначе по provider_subscription_id (для событий, где user_id не пришёл
// в metadata, например обновление подписки, созданной раньше).
async function upsertSubscription(client, { userId, providerCustomerId, providerSubscriptionId, status, currentPeriodEnd }) {
  if (userId) {
    await client.query(
      `INSERT INTO subscriptions (user_id, status, provider_customer_id, provider_subscription_id, current_period_end, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id) DO UPDATE SET
         status = EXCLUDED.status,
         provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, subscriptions.provider_customer_id),
         provider_subscription_id = COALESCE(EXCLUDED.provider_subscription_id, subscriptions.provider_subscription_id),
         current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
         updated_at = now()`,
      [userId, status, providerCustomerId || null, providerSubscriptionId || null, currentPeriodEnd || null]
    );
    return;
  }

  if (providerSubscriptionId) {
    await client.query(
      `UPDATE subscriptions
       SET status = COALESCE($2, status),
           current_period_end = COALESCE($3, current_period_end),
           updated_at = now()
       WHERE provider_subscription_id = $1`,
      [providerSubscriptionId, status || null, currentPeriodEnd || null]
    );
  }
}

function mapStripeStatus(stripeStatus) {
  // Сжимаем множество статусов Stripe до того, что реально нужно клиенту
  // для решения "открыт ли платный экспорт".
  if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'active';
  if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') return 'past_due';
  if (stripeStatus === 'canceled' || stripeStatus === 'incomplete_expired') return 'canceled';
  return stripeStatus;
}

module.exports = router;
