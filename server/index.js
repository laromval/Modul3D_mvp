// Modul3D backend — Этап 1 монетизации: аккаунты, подписки, баланс токенов,
// приём платежей (Stripe). Точка входа Express-приложения.
//
// Обычный Node-процесс (require/CommonJS) — стиль клиентской части проекта
// (глобальные объекты window.Modul3D.*, без сборщика) сюда не переносится,
// см. CLAUDE.md и .claude/agents/backend-monetization.md.

const express = require('express');
const cors = require('cors');

const config = require('./src/config');
const authRouter = require('./src/routes/auth');
const billingRouter = require('./src/routes/billing');

const app = express();

app.use(cors({ origin: config.corsOrigin }));

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'modul3d-server' });
});

// express.json() подключается точечно внутри routers/auth.js и
// routers/billing.js (а не здесь глобально) — /billing/webhook требует
// сырое тело для проверки подписи Stripe, см. комментарий в billing.js.
app.use('/auth', express.json(), authRouter);
app.use('/billing', billingRouter);

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
