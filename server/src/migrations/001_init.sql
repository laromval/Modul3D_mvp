-- Modul3D backend — Этап 1: аккаунты, подписки, баланс токенов.
-- Применяется один раз через `npm run migrate` (см. server/scripts/migrate.js).

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- для gen_random_uuid()

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Статус подписки пользователя. Одна активная подписка на пользователя
-- на этом этапе (Paddle subscription); provider_subscription_id — id
-- подписки в Paddle для сверки при вебхуках.
CREATE TABLE IF NOT EXISTS subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                   TEXT NOT NULL DEFAULT 'none',
    -- ожидаемые значения status: 'none' | 'active' | 'past_due' | 'canceled'
  provider                 TEXT NOT NULL DEFAULT 'paddle',
  provider_customer_id     TEXT,
  provider_subscription_id TEXT UNIQUE,
  current_period_end       TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- Баланс токенов для платных вызовов ИИ-распознавания эскиза (Этап 2).
-- Строка создаётся вместе с пользователем при регистрации.
CREATE TABLE IF NOT EXISTS token_balances (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance    INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Журнал уже обработанных событий Paddle webhook — защита от повторной
-- обработки одного и того же события при retry со стороны Paddle (иначе
-- повторный вебхук может продублировать изменение статуса подписки).
-- event_id хранит значение event.eventId из Paddle SDK (Webhooks.unmarshal).
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id     TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
