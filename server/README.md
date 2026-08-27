# Modul3D — сервер (Этап 1 монетизации)

Первый серверный код в проекте. До этого Modul3D был полностью клиентским
(см. `CLAUDE.md` в корне) — конфигуратор, 3D-вьювер, чертежи и расчёты
по-прежнему работают офлайн и без сервера. Этот сервер отвечает только за
аккаунты, подписки, баланс токенов и приём платежей (`ТЗ-МОНЕТИЗАЦИЯ.md`
в корне проекта — источник истины по архитектуре).

Реализовано на Этапе 1:
- Регистрация / вход (`POST /auth/register`, `POST /auth/login`) — bcrypt + JWT.
- `GET /auth/me` — статус подписки и баланс токенов текущего пользователя.
- `POST /billing/checkout-session` — создание Stripe Checkout Session.
- `POST /billing/webhook` — обработка событий Stripe (с проверкой подписи).

Не реализовано (следующие этапы по ТЗ-МОНЕТИЗАЦИЯ.md):
- Прокси-эндпоинт ИИ-распознавания эскиза со списанием токенов (Этап 2).
- Серверная генерация Excel/DXF/CSV с гейтом по подписке (Этап 3).

## Требования

- Node.js 18+
- PostgreSQL 13+ (локально или в облаке — любой провайдер)
- Аккаунт Stripe (тестовый режим достаточно для разработки)

## Установка и запуск локально

```bash
cd server
npm install
```

### 1. Переменные окружения

```bash
cp .env.example .env
```

Заполни `.env`:

| Переменная | Что это |
|---|---|
| `DATABASE_URL` | Строка подключения к PostgreSQL, напр. `postgres://user:pass@localhost:5432/modul3d` |
| `JWT_SECRET` | Длинная случайная строка (`openssl rand -hex 32`) |
| `STRIPE_SECRET_KEY` | Секретный ключ из Stripe Dashboard → Developers → API keys (тестовый `sk_test_...`) |
| `STRIPE_PRICE_ID` | ID цены подписки (Stripe Dashboard → Product catalog → создать Product с рекуррентной ценой → скопировать Price ID) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret вебхука (см. ниже, «Настройка вебхука Stripe») |
| `CHECKOUT_SUCCESS_URL` / `CHECKOUT_CANCEL_URL` | Куда вернуть пользователя после оплаты — страницы клиентской части |
| `STARTING_TOKEN_BALANCE` | Сколько токенов даётся при регистрации бесплатно |

### 2. База данных

Создай пустую БД PostgreSQL (например `modul3d`), затем примени миграцию:

```bash
npm run migrate
```

Это создаст таблицы `users`, `subscriptions`, `token_balances`,
`processed_webhook_events` (см. `src/migrations/001_init.sql`). Миграции
идемпотентны (`CREATE TABLE IF NOT EXISTS`) — повторный запуск безопасен.

### 3. Настройка вебхука Stripe (для локальной разработки)

Через Stripe CLI (https://stripe.com/docs/stripe-cli), после `stripe login`:

```bash
stripe listen --forward-to localhost:4000/billing/webhook
```

Команда выведет `whsec_...` — вставь его в `STRIPE_WEBHOOK_SECRET` в `.env`.
В продакшене signing secret берётся со страницы конкретного endpoint'а в
Stripe Dashboard → Developers → Webhooks.

### 4. Запуск

```bash
npm start
```

Сервер поднимется на `http://localhost:4000` (или другом порту из `PORT`).
Проверка: `GET /health` должен вернуть `{"ok":true,...}`.

Для разработки с автоперезапуском при изменении файлов:

```bash
npm run dev
```

## Эндпоинты

### `POST /auth/register`
Body: `{ "email": "...", "password": "..." }` (пароль от 8 символов).
Ответ: `{ "token": "<jwt>" }`. Создаёт пользователя, запись подписки
(`status: 'none'`) и баланс токенов (`STARTING_TOKEN_BALANCE`).

### `POST /auth/login`
Body: `{ "email": "...", "password": "..." }`.
Ответ: `{ "token": "<jwt>" }`.

### `GET /auth/me`
Заголовок: `Authorization: Bearer <jwt>`.
Ответ:
```json
{
  "id": "...", "email": "...", "createdAt": "...",
  "subscription": { "status": "none|active|past_due|canceled", "currentPeriodEnd": null },
  "tokenBalance": 20
}
```

### `POST /billing/checkout-session`
Заголовок: `Authorization: Bearer <jwt>`.
Ответ: `{ "url": "https://checkout.stripe.com/..." }` — редиректни на этот
URL с клиента, чтобы пользователь оплатил подписку.

### `POST /billing/webhook`
Вызывается только Stripe. Требует заголовок `Stripe-Signature` — запросы
без валидной подписи (не от настоящего Stripe) отклоняются с 400.

## Что нужно настроить вручную (не входит в код)

- Зарегистрировать аккаунт Stripe, создать Product с рекуррентной ценой
  (подписка месяц/год — конкретную цену задать самому, в ТЗ не
  зафиксирована), получить `STRIPE_SECRET_KEY` и `STRIPE_PRICE_ID`.
- Настроить endpoint вебхука в Stripe Dashboard на продакшен-домене сервера
  (`https://<домен>/billing/webhook`), включить события `checkout.session.
  completed`, `customer.subscription.created`, `customer.subscription.
  updated`, `customer.subscription.deleted`; получить `STRIPE_WEBHOOK_SECRET`.
- Поднять реальную БД PostgreSQL (managed-хостинг: Railway, Render, Supabase,
  Neon и т.п., либо свой сервер) и указать её в `DATABASE_URL`.
- Выбрать хостинг для самого Node-процесса (сейчас есть только статический
  GitHub Pages под клиентскую часть — под этот сервер нужен отдельный
  хостинг, поддерживающий постоянно работающий процесс: Railway, Render,
  Fly.io, VPS и т.п.) — открытый вопрос из ТЗ-МОНЕТИЗАЦИЯ.md, раздел 6.
- Сгенерировать `JWT_SECRET` и держать его в секрете (утечка = возможность
  подделать сессию любого пользователя).
- В продакшене сузить `CORS_ORIGIN` до реального домена клиента вместо `*`.
