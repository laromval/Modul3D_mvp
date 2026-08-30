# Modul3D — сервер (монетизация, Этапы 1-3)

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

Дополнительно (вне этапов монетизации из ТЗ):
- Никнейм и аватарка в аккаунте (`POST /auth/register` принимает `nickname`
  и файл `avatar`), раздача аватарок через `/uploads/avatars/...`.
- Отзывы о приложении с ручной модерацией (`POST /reviews`,
  `GET /reviews/public`, `GET /reviews/pending`, `POST /reviews/:id/approve`,
  `POST /reviews/:id/reject`), Telegram-уведомление владельцу о новом
  отзыве (`services/telegramNotify.js`) и статическая страница модерации
  `GET /admin/reviews.html`.

Реализовано на Этапе 3:
- `src/services/exportGeneration.js` — построение содержимого документов
  (`buildDetailingWorkbook`, `buildSpecificationWorkbook`, `buildDrillCsv`,
  `buildDrillDxf`), перенесено без изменений из клиентских `src/export.js` и
  `src/cnc.js` (те же колонки/форматы/единицы измерения). Функции синхронные,
  принимают уже посчитанные на клиенте `model`/`spec` и отдают готовый
  `Buffer` (xlsx) или `string` (csv/dxf, без BOM).
- `src/middleware/subscription.js` — мидлвар `requireActiveSubscription`,
  жёсткий гейт по `subscriptions.status === 'active'`.
- `POST /export/detailing`, `/export/specification`, `/export/cnc/csv`,
  `/export/cnc/dxf` (`src/routes/export.js`) — требуют `Authorization: Bearer
  <jwt>` + активную подписку, вызывают `exportGeneration.js` и отдают готовый
  файл сырым телом ответа (см. «Эндпоинты» ниже). Модуль `exportGeneration.js`
  подключается лениво: если бы его не было на диске, эндпоинты отвечали бы
  `501`, а не роняли сервер — сейчас это не актуально, модуль на месте.

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
| `ADMIN_TOKEN` | Приватный токен владельца проекта для модерации отзывов (`GET /reviews/pending`, `POST /reviews/:id/approve\|reject`), передаётся в заголовке `X-Admin-Token`. Без него эти эндпоинты отвечают 503 |
| `PUBLIC_SERVER_URL` | Публичный адрес сервера, используется только для ссылок (например, на `/admin/reviews.html` в Telegram-уведомлении). По умолчанию `http://localhost:<PORT>` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Уведомление о новом отзыве в Telegram (`services/telegramNotify.js`). Если хоть одна не задана — уведомления просто не отправляются, `POST /reviews` работает как обычно |

### 2. База данных

Создай пустую БД PostgreSQL (например `modul3d`), затем примени миграцию:

```bash
npm run migrate
```

Это создаст таблицы `users`, `subscriptions`, `token_balances`,
`processed_webhook_events` (см. `src/migrations/001_init.sql`), а также
`hardware_models` (`002_hardware_models.sql`), колонки `nickname`/
`avatar_url` у `users` и таблицу `reviews` (`003_reviews_avatars.sql`).
Миграции идемпотентны (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT
EXISTS`) — повторный запуск безопасен.

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
Body: `multipart/form-data` с полями `email`, `password` (от 8 символов),
`nickname` (2–40 символов после trim, обязателен) и опциональным файлом
`avatar` (JPEG/PNG/WebP, до 2 МБ).
Ответ: `{ "token": "<jwt>" }`. Создаёт пользователя, запись подписки
(`status: 'none'`) и баланс токенов (`STARTING_TOKEN_BALANCE`). Аватарка
(если передана) сохраняется на диск сервера (`server/uploads/avatars/`,
не коммитится в git) и раздаётся статически по `/uploads/avatars/<файл>`.

### `POST /auth/login`
Body: `{ "email": "...", "password": "..." }`.
Ответ: `{ "token": "<jwt>" }`.

### `GET /auth/me`
Заголовок: `Authorization: Bearer <jwt>`.
Ответ:
```json
{
  "id": "...", "email": "...", "createdAt": "...",
  "nickname": "...", "avatarUrl": "/uploads/avatars/... | null",
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

### `POST /export/detailing`, `/export/specification`, `/export/cnc/csv`, `/export/cnc/dxf`

Жёсткий гейт на экспорт документов (`ТЗ-МОНЕТИЗАЦИЯ.md`, 4.3). Заголовок
`Authorization: Bearer <jwt>` обязателен, плюс активная подписка
(`subscription.status === 'active'`) — иначе запрос до генерации файла не
доходит вообще. Клиент по-прежнему сам считает `model`/`spec` (`engine.js`/
`specification.js` остаются единственным источником истины и на сервер не
портируются) — сюда уходят уже готовые данные, сервер их не пересчитывает
и не проверяет, только сериализует в файл.

| Роут | Body | Файл |
|---|---|---|
| `POST /export/detailing` | `{ model, projectName? }` | `.xlsx`, деталировка |
| `POST /export/specification` | `{ spec, projectName? }` | `.xlsx`, спецификация и стоимость (`spec.currencySymbol` — опционально, по умолчанию `₽`) |
| `POST /export/cnc/csv` | `{ model }` | `.csv`, присадка для ЧПУ |
| `POST /export/cnc/dxf` | `{ model }` | `.dxf`, присадка для ЧПУ |

Ответ при успехе — сырое тело файла (не JSON), с `Content-Type` под формат
и `Content-Disposition: attachment; filename="..."` (кириллица в имени —
через `filename*=UTF-8''...`, RFC 5987). CSV/DXF отдаются с BOM в начале
(`﻿`) — так Excel и CAD-программы с русской локалью не путают
кодировку; сами `buildDrillCsv`/`buildDrillDxf` в `exportGeneration.js`
BOM не добавляют, это часть доставки файла в `routes/export.js`, а не
формата содержимого.

Коды ошибок:
- `400` — отсутствует обязательное поле (`model`/`spec`) или оно не объект.
- `401` — нет/недействителен JWT.
- `402` — нет активной подписки.
- `501` — `exportGeneration.js` не найден на диске (эксплуатационная
  подстраховка, в норме не встречается — модуль реализован).
- `500` — прочая ошибка генерации файла.

Клиент (`src/export.js`, `src/cnc.js`) не показывает эти коды пользователю
напрямую — переводит их в понятный призыв к действию («войдите в аккаунт» /
«оформите подписку»), см. `ТЗ-МОНЕТИЗАЦИЯ.md`, 4.4.

### `POST /reviews`
Заголовок: `Authorization: Bearer <jwt>`. Body: `{ "text": "..." }` (непустая
строка после trim, до 2000 символов). Создаёт отзыв со статусом `pending` —
он не виден публично, пока владелец проекта его не одобрит.

### `GET /reviews/public`
Без авторизации. Список одобренных отзывов (`status: 'approved'`), сортировка
по дате новые сверху: `[{ id, body, createdAt, nickname, avatarUrl }]`. Email
автора не возвращается.

### `GET /reviews/pending`, `POST /reviews/:id/approve`, `POST /reviews/:id/reject`
Заголовок: `X-Admin-Token: <ADMIN_TOKEN>` — приватные модерационные
эндпоинты владельца проекта (не полноценные роли). `GET /reviews/pending`
отдаёт все отзывы на модерации, включая `email` автора (чтобы можно было
с ним связаться). `POST .../approve` и `POST .../reject` переводят отзыв
в `approved`/`rejected` и проставляют `moderated_at`. Без `ADMIN_TOKEN` в
`.env` все три эндпоинта отвечают `503`.

При создании нового отзыва (`POST /reviews`) сервер также пытается
отправить уведомление в Telegram владельцу проекта
(`services/telegramNotify.js`) — не блокирует ответ клиенту и тихо
пропускается, если `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` не настроены.

### `GET /admin/reviews.html`
Статическая страница ручной модерации отзывов (`server/public/admin/
reviews.html`), раздаётся через `express.static` без авторизации на уровне
маршрута — сама страница просит ввести `ADMIN_TOKEN` (хранит его в
`localStorage` браузера) и обращается к `GET /reviews/pending`/`POST
/reviews/:id/approve|reject` с заголовком `X-Admin-Token`, то есть реально
защищена тем же `ADMIN_TOKEN`, что и сами эндпоинты.

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
  **Решено (2026-08-30): Railway** — см. подраздел ниже.
- Сгенерировать `JWT_SECRET` и держать его в секрете (утечка = возможность
  подделать сессию любого пользователя).
- В продакшене сузить `CORS_ORIGIN` до реального домена клиента вместо `*`.
  **Не применимо здесь** — клиент должен уметь работать и с `file://`
  (открытие `index.html` двойным кликом с диска, см. корневой CLAUDE.md),
  у которого нет фиксированного origin (браузер шлёт `Origin: null`),
  поэтому сузить `CORS_ORIGIN` без потери этого сценария нельзя. Реальная
  защита приватных эндпоинтов — не CORS, а `JWT_SECRET`/`ADMIN_TOKEN`.
- Сгенерировать `ADMIN_TOKEN` (`openssl rand -hex 32`) и держать в секрете —
  им защищены модерационные эндпоинты отзывов (`GET /reviews/pending`,
  `POST /reviews/:id/approve|reject`) и страница `/admin/reviews.html`.
- (Опционально) Настроить Telegram-уведомление о новых отзывах:
  1. Написать `@BotFather` в Telegram → `/newbot` → следовать подсказкам
     (имя бота, username) → скопировать выданный токен вида
     `123456789:AA...` → `TELEGRAM_BOT_TOKEN`.
  2. Написать своему новому боту любое сообщение (например «привет») — это
     обязательно, иначе бот не может первым написать пользователю.
  3. Открыть в браузере `https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates`
     и найти в JSON-ответе `message.chat.id` — это и есть `TELEGRAM_CHAT_ID`
     (число, может быть отрицательным для групповых чатов).
  4. Задать обе переменные в `.env` (или в Variables на Railway) и
     перезапустить сервер. Без них `POST /reviews` продолжает работать как
     раньше — уведомления просто не приходят.
- В проде убедиться, что папка `server/uploads/avatars/` сохраняется между
  деплоями/рестартами процесса (обычный эфемерный контейнер её потеряет) —
  либо примонтировать постоянный volume, либо (на будущее) перенести
  хранение аватарок в объектное хранилище (S3-совместимое и т.п.).

## Деплой на Railway (пошагово)

Решение зафиксировано 2026-08-30: хостинг для Node-процесса и managed
PostgreSQL — Railway (railway.app), один проект на оба сервиса. Аккаунт
и оплату заводит владелец проекта лично — это шаги, которые нельзя
выполнить автоматически.

1. Зарегистрироваться на railway.app (проще всего — через GitHub).
2. New Project → Deploy from GitHub repo → выбрать `laromval/Modul3D_mvp`.
3. В сервисе с кодом: Settings → Root Directory → `server` (репозиторий
   монорепо, сервер лежит в подпапке, не в корне).
4. В том же Railway-проекте: + New → Database → PostgreSQL. Railway сам
   создаёт переменную `DATABASE_URL` на сервисе базы.
5. В сервисе с кодом → Variables → добавить (или сослаться на существующие
   переменные Postgres-сервиса, где это применимо):
   - `DATABASE_URL` — ссылка на переменную Postgres-сервиса, не вводить
     значение руками;
   - `JWT_SECRET` — случайная строка (`openssl rand -hex 32`);
   - `ADMIN_TOKEN` — случайная строка (`openssl rand -hex 32`);
   - `CORS_ORIGIN=*` (см. пояснение выше, почему сужать нельзя).
   `PORT` Railway передаёт автоматически, `config.js` его уже читает.
   Остальные переменные (`PADDLE_*`, `ANTHROPIC_API_KEY`,
   `STARTING_TOKEN_BALANCE`, `JWT_EXPIRES_IN`, `CHECKOUT_SUCCESS_URL`,
   `SKETCH_TOKEN_COST`) можно не задавать сразу — без них сервер стартует,
   просто соответствующие функции (оплата, распознавание эскиза) отвечают
   понятной ошибкой вместо падения процесса, см. `config.js`/`paddleClient.js`/
   `services/sketchRecognition.js`.
6. Settings → Volumes → New Volume, mount path `/app/uploads` — иначе
   `uploads/avatars/` (см. `services/avatarUpload.js`) будет пропадать при
   каждом рестарте/редеплое контейнера.
7. Дождаться деплоя (Railway триггерится автоматически на пуш в `master`
   после первого подключения репозитория), затем Settings → Networking →
   Generate Domain — получить публичный адрес вида
   `https://<имя>.up.railway.app`.
8. Применить миграции (`server/src/migrations/*.sql`, все идемпотентны —
   используют `IF NOT EXISTS`, повторный прогон безопасен) одним из
   способов, доступных в интерфейсе Railway на момент деплоя:
   - через встроенный SQL-редактор Postgres-сервиса (если есть) — вставить
     содержимое файлов по порядку имён и выполнить;
   - либо локально через Railway CLI: `npm install -g @railway/cli`,
     `railway login`, `railway link` (выбрать этот проект), затем из
     директории `server/`: `railway run npm run migrate` — команда
     выполнится локально, но с переменными окружения (включая
     `DATABASE_URL`) из Railway.
9. Проверить `https://<домен>/health` — должен ответить
   `{"ok":true,"service":"modul3d-server"}`.
10. Сообщить полученный домен — после этого нужно проставить его вместо
    `http://localhost:4000` в `src/sketchAI.js` (`API_BASE`) и в
    `Website_Modul3D/docs/assets/js/main.js` (`REVIEWS_API_BASE`).
