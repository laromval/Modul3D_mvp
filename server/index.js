// Modul3D backend — Этап 1 монетизации: аккаунты, подписки, баланс токенов,
// приём платежей (Paddle). Точка входа Express-приложения.
//
// Обычный Node-процесс (require/CommonJS) — стиль клиентской части проекта
// (глобальные объекты window.Modul3D.*, без сборщика) сюда не переносится,
// см. CLAUDE.md и .claude/agents/backend-monetization.md.

const path = require('path');

const express = require('express');
const cors = require('cors');

const config = require('./src/config');
const authRouter = require('./src/routes/auth');
const billingRouter = require('./src/routes/billing');
const sketchRouter = require('./src/routes/sketch');
const exportRouter = require('./src/routes/export');
const hardwareModelsRouter = require('./src/routes/hardwareModels');
const reviewsRouter = require('./src/routes/reviews');

const app = express();

app.use(cors({ origin: config.corsOrigin }));

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'modul3d-server' });
});

// Статическая раздача загруженных файлов (сейчас — только аватарки, см.
// server/src/services/avatarUpload.js). Сами файлы не коммитятся в git
// (server/.gitignore).
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Статическая страница ручной модерации отзывов (server/public/admin/reviews.html).
// Сама страница не авторизована на уровне маршрута — она сама просит
// ADMIN_TOKEN у оператора и передаёт его в заголовке X-Admin-Token при
// вызовах API (см. routes/reviews.js, requireAdmin).
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// express.json() подключается точечно внутри routers/auth.js,
// routers/billing.js, routers/sketch.js, routers/export.js,
// routers/hardwareModels.js и routers/reviews.js (а не здесь глобально) —
// /billing/webhook требует сырое тело для проверки подписи Paddle (см.
// комментарий в billing.js), а /sketch/recognize и /export/* — увеличенные
// лимиты (10mb и 20mb соответственно) под base64-изображение и полную
// модель/спецификацию проекта, не нужные остальным роутам. express.json()
// на /auth ниже молча пропускает POST /auth/register (multipart/form-data,
// парсится отдельно через handleAvatarUpload в auth.js) — типы контента не
// совпадают, конфликта нет.
app.use('/auth', express.json(), authRouter);
app.use('/billing', billingRouter);
app.use('/sketch', sketchRouter);
app.use('/export', exportRouter);
app.use('/hardware-models', hardwareModelsRouter);
app.use('/reviews', reviewsRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Не найдено.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера.' });
});

app.listen(config.port, () => {
  console.log(`Modul3D server слушает на http://localhost:${config.port}`);
});
