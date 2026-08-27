# Modul3D — сервер (Этап 1 монетизации)

Первый серверный код в проекте. До этого Modul3D был полностью клиентским
(см. `CLAUDE.md` в корне) — конфигуратор, 3D-вьювер, чертежи и расчёты
по-прежнему работают офлайн и без сервера. Этот сервер отвечает только за
аккаунты, подписки, баланс токенов и приём платежей (`ТЗ-МОНЕТИЗАЦИЯ.md`
в корне проекта — источник истины по архитектуре).

Реализовано на Этапе 1:
- Регистрация / вход (`POST /auth/register`, `POST /auth/login`) — bcrypt + JWT.
- `GET /auth/me` — статус подписки и баланс токенов текущего пользователя.
- `POST /billing/checkout` — создание Paddle Transaction для оформления подписки.
- `POST /billing/webhook` — обработка событий Paddle (с проверкой подписи).

Приём платежей — **Paddle** (Paddle.com, merchant of record), не Stripe:
Stripe недоступен для мерчантов из Молдовы (страна пользователя проекта),
Paddle официально поддерживает Молдову и сам берёт на себя расчёт и уплату
налогов (VAT/sales tax) — юрлицо мерчанта для этого не требуется.

Реализовано на Этапе 2:
- `POST /sketch/recognize` — прокси-эндпоинт ИИ-распознавания эскиза шкафа
  (Claude Vision, серверный ключ Anthropic), с атомарным списанием токенов.
  Логика перенесена с клиента (`src/sketchAI.js`, прежний bring-your-own-key
  вариант — не используется этим эндпоинтом и остаётся только для истории/
  офлайн-сценария, если клиент решит его сохранить).

Не реализовано (следующие этапы по ТЗ-МОНЕТИЗАЦИЯ.md):
- Серверная генерация Excel/DXF/CSV с гейтом по подписке (Этап 3).

## Требования

- Node.js 20+ (требование самого `@paddle/paddle-node-sdk`, см. его `package.json`)
- PostgreSQL 13+ (локально или в облаке — любой провайдер)
- Аккаунт Paddle (sandbox-аккаунт достаточен для разработки, см. ниже)

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
| `PADDLE_API_KEY` | API-ключ из Paddle Dashboard → Developer Tools → Authentication → API keys. У sandbox- и production-аккаунта ключи разные |
| `PADDLE_PRICE_ID` | ID цены подписки (Paddle Dashboard → Catalog → Products → создать Product с рекуррентной ценой → скопировать Price ID, вида `pri_...`) |
| `PADDLE_WEBHOOK_SECRET` | Secret key конкретного webhook destination (см. ниже, «Настройка вебхука Paddle») |
| `PADDLE_ENVIRONMENT` | `sandbox` (тестовые платежи) или `production` (боевые). По умолчанию `sandbox` — намеренно, чтобы недонастроенный сервер не мог случайно принять боевые деньги |
| `CHECKOUT_SUCCESS_URL` | Куда Paddle вернёт пользователя после оплаты — страница клиентской части (у Paddle, в отличие от Stripe, нет отдельного `cancel_url`) |
| `STARTING_TOKEN_BALANCE` | Сколько токенов даётся при регистрации бесплатно |
| `ANTHROPIC_API_KEY` | Ключ Anthropic API (console.anthropic.com → Settings → API Keys), нужен для `POST /sketch/recognize`. Без него эндпоинт отвечает 503, сервер не падает |
| `SKETCH_TOKEN_COST` | Сколько токенов списывается за один вызов `/sketch/recognize` (по умолчанию 1) |

### 2. База данных

Создай пустую БД PostgreSQL (например `modul3d`), затем примени миграцию:

```bash
npm run migrate
```

Это создаст таблицы `users`, `subscriptions`, `token_balances`,
`processed_webhook_events` (см. `src/migrations/001_init.sql`). Миграции
идемпотентны (`CREATE TABLE IF NOT EXISTS`) — повторный запуск безопасен.

### 3. Настройка вебхука Paddle

Paddle (в отличие от Stripe) не имеет официального CLI для проброса
вебхуков на локальный `localhost` — для локальной разработки нужен
туннель наружу (например `ngrok http 4000` или аналог), т.к. Paddle должен
достучаться до `/billing/webhook` по публичному HTTPS-адресу.

1. Зайди в Paddle Dashboard (в sandbox-режиме для разработки, переключатель
   sandbox/production — в левом нижнем углу дашборда) → Developer Tools →
   Notifications → Create notification destination.
2. Тип destination — Webhook, URL — твой публичный адрес
   (`https://<туннель-или-домен>/billing/webhook`).
3. Включи события: `subscription.created`, `subscription.updated`,
   `subscription.activated`, `subscription.trialing`,
   `subscription.past_due`, `subscription.paused`, `subscription.resumed`,
   `subscription.canceled`, `transaction.completed`. Без
   `subscription.resumed` подписка, поставленная на паузу и потом
   возобновлённая, может надолго остаться в БД со статусом `past_due`.
4. После создания destination Paddle покажет Secret key (вида
   `pdl_ntfset_...`) — вставь его в `PADDLE_WEBHOOK_SECRET` в `.env`.

Sandbox и production — независимые аккаунты Paddle с отдельными
destination'ами и своими secret key; если переключаешься на
`PADDLE_ENVIRONMENT=production`, нужно завести webhook destination заново
в production-аккаунте и обновить `PADDLE_WEBHOOK_SECRET`.

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

### `POST /billing/checkout`
Заголовок: `Authorization: Bearer <jwt>`.
Создаёт Paddle Customer (при первом обращении) и Paddle Transaction для
подписки текущего пользователя. Ответ:
```json
{
  "transactionId": "txn_...",
  "priceId": "pri_...",
  "checkoutUrl": "https://.../checkout/... | null"
}
```
Модель чекаута у Paddle отличается от Stripe (см. подробный комментарий в
`src/routes/billing.js`): `checkoutUrl` — ссылка на Paddle-хостируемую
страницу оплаты, на которую можно редиректить (аналог Stripe Checkout
Session), но она может прийти `null`, если hosted checkout не включён в
настройках аккаунта Paddle — тогда клиент должен открыть оверлей Paddle.js
по `transactionId` (`Paddle.Checkout.open({ transactionId })`). Какой из
двух вариантов реально нужен — определится на Этапе 4 (`ui-configurator`)
по факту того, что придёт от Paddle в конкретном аккаунте (sandbox сначала).

### `POST /billing/webhook`
Вызывается только Paddle. Требует заголовок `Paddle-Signature` — запросы
без валидной подписи (не от настоящего Paddle) отклоняются с 400.

### `POST /sketch/recognize`
Заголовок: `Authorization: Bearer <jwt>`.
Body: `{ "imageBase64": "<base64 без префикса data:...>", "mimeType": "image/jpeg" | "image/png" }`.

Списывает `SKETCH_TOKEN_COST` токенов атомарно (conditional `UPDATE ...
WHERE balance >= cost`), затем вызывает Claude Vision серверным ключом
Anthropic и возвращает распознанные параметры шкафа.

Ответ при успехе:
```json
{
  "params": { "width": 800, "height": 2000, "depth": 560, "sections": [...], ... },
  "tokenBalance": 19
}
```

Коды ошибок:
- `400` — некорректное тело запроса (нет `imageBase64` или недопустимый `mimeType`).
- `401` — нет/недействителен JWT.
- `402` — недостаточно токенов; Anthropic не вызывается, баланс не трогается.
- `502` — вызов Anthropic упал или вернул невалидный JSON; токены **возвращены** на баланс.
- `503` — `ANTHROPIC_API_KEY` не настроен на сервере; токены не списывались.

Промпт (`SYSTEM_PROMPT`) и функция `sanitizeRecognizedParams` (зажатие
размеров в мебельные пределы) — в `src/services/sketchRecognition.js`,
перенесены без изменений из клиентского `src/sketchAI.js` (см.
`ТЗ-МОНЕТИЗАЦИЯ.md`, 4.1) — не переизобретать заново при последующих правках.

## Что нужно настроить вручную (не входит в код)

- Получить ключ Anthropic API (console.anthropic.com → Settings → API Keys,
  требуется свой аккаунт с оплаченным доступом) → `ANTHROPIC_API_KEY`. Этот
  ключ отдельный от того, что раньше пользователи вводили сами в
  клиентском `sketchAI.js` — теперь оплата вызовов идёт с аккаунта
  разработчика, а не пользователя, поэтому важно следить за расходом.
- Зарегистрировать аккаунт Paddle (paddle.com) — сначала sandbox для
  разработки и тестов, отдельно production перед реальным запуском.
- В Paddle Dashboard → Catalog → Products создать Product с рекуррентной
  ценой (подписка месяц/год — конкретную цену задать самому, в ТЗ не
  зафиксирована), скопировать Price ID → `PADDLE_PRICE_ID`.
- В Paddle Dashboard → Developer Tools → Authentication создать API key →
  `PADDLE_API_KEY`.
- Настроить webhook destination в Paddle Dashboard → Developer Tools →
  Notifications на продакшен-домене сервера (`https://<домен>/billing/
  webhook`), включить события `subscription.created`, `subscription.
  updated`, `subscription.activated`, `subscription.trialing`,
  `subscription.past_due`, `subscription.paused`, `subscription.resumed`,
  `subscription.canceled`, `transaction.completed`; получить
  `PADDLE_WEBHOOK_SECRET`.
- Проверить в Paddle Dashboard → Checkout settings, включён ли Paddle
  Hosted Checkout — от этого зависит, придёт ли `checkoutUrl` заполненным
  из `POST /billing/checkout` (см. раздел «Эндпоинты» выше) или клиенту
  придётся использовать оверлей Paddle.js.
- Проверить, что нет ограничений Paddle по стране регистрации мерчанта —
  на момент написания (проверено на paddle.com) Молдова поддерживается,
  но условия провайдеров могут меняться, стоит перепроверить перед запуском
  в продакшен.
- Поднять реальную БД PostgreSQL (managed-хостинг: Railway, Render, Supabase,
  Neon и т.п., либо свой сервер) и указать её в `DATABASE_URL`.
- Выбрать хостинг для самого Node-процесса (сейчас есть только статический
  GitHub Pages под клиентскую часть — под этот сервер нужен отдельный
  хостинг, поддерживающий постоянно работающий процесс: Railway, Render,
  Fly.io, VPS и т.п.) — открытый вопрос из ТЗ-МОНЕТИЗАЦИЯ.md, раздел 6.
- Сгенерировать `JWT_SECRET` и держать его в секрете (утечка = возможность
  подделать сессию любого пользователя).
- В продакшене сузить `CORS_ORIGIN` до реального домена клиента вместо `*`.
