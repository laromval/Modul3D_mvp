const crypto = require('crypto');

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const disposableDomains = require('disposable-email-domains');

const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { getAccountStatus } = require('../services/account');
const { handleAvatarUpload, deleteUploadedFile } = require('../services/avatarUpload');
const { sendVerificationEmail } = require('../services/emailSender');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 12;
const NICKNAME_MIN_LENGTH = 2;
const NICKNAME_MAX_LENGTH = 40;

// Set для O(1) проверки — пакет отдаёт плоский массив ~120k доменов.
const DISPOSABLE_DOMAINS = new Set(disposableDomains);

function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function hashVerificationToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Генерирует токен подтверждения email, сохраняет его хэш (не сырой токен —
// см. migrations/004_email_verification.sql) и возвращает сырой токен для
// вставки в ссылку письма. Вызывать внутри транзакции/клиента БД.
async function issueEmailVerificationToken(client, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashVerificationToken(token);
  const expiresAt = new Date(Date.now() + config.emailVerificationTokenTtlMinutes * 60 * 1000);

  await client.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return token;
}

function sendVerificationEmailFor(userEmail, rawToken) {
  const verificationUrl = `${config.publicServerUrl}/auth/verify-email?token=${rawToken}`;
  // Не блокируем ответ клиенту сетевым вызовом к Brevo — sendVerificationEmail
  // никогда не бросает исключение, сбой только логируется внутри неё же
  // (тот же подход, что и notifyNewReview в routes/reviews.js).
  sendVerificationEmail(userEmail, verificationUrl);
}

// Простая статическая HTML-страница результата подтверждения (открывается
// прямо из письма в браузере, без JS/JSON) — в духе public/admin/reviews.html.
function renderVerifyEmailPage(ok, message) {
  const title = ok ? 'Email подтверждён' : 'Не удалось подтвердить email';
  const color = ok ? '#34d399' : '#ff5c72';
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Modul3D — ${title}</title>
<style>
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #101317;
    color: #eef3f8;
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  }
  main {
    max-width: 420px;
    margin: 24px;
    background: #1b1f26;
    border: 1px solid #262c35;
    border-radius: 12px;
    padding: 28px;
    text-align: center;
  }
  h1 { font-size: 18px; margin: 0 0 12px; color: ${color}; }
  p { color: #bcccdc; margin: 0; }
</style>
</head>
<body>
<main>
  <h1>${title}</h1>
  <p>${message}</p>
</main>
</body>
</html>`;
}

// POST /auth/register — multipart/form-data: email, password, nickname,
// avatar (опциональный файл, поле "avatar"). handleAvatarUpload сам
// разбирает multipart-тело (замена express.json() для этого роута —
// они несовместимы на одном запросе, см. server/index.js).
router.post('/register', handleAvatarUpload, async (req, res) => {
  const { email, password, nickname } = req.body || {};

  // С этого места, если валидация не пройдёт, файл (если был загружен)
  // нужно удалить, чтобы не копить мусор на диске.
  const rejectWithCleanup = (status, error) => {
    deleteUploadedFile(req.file);
    return res.status(status).json({ error });
  };

  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return rejectWithCleanup(400, 'Укажи корректный email.');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const emailDomain = normalizedEmail.split('@')[1];
  if (emailDomain && DISPOSABLE_DOMAINS.has(emailDomain)) {
    return rejectWithCleanup(
      400,
      'Регистрация с одноразовых/временных почтовых сервисов не поддерживается. Укажи постоянный email — он нужен, чтобы с тобой можно было связаться.'
    );
  }

  if (typeof password !== 'string' || password.length < 8) {
    return rejectWithCleanup(400, 'Пароль должен быть не короче 8 символов.');
  }
  if (typeof nickname !== 'string') {
    return rejectWithCleanup(400, 'Укажи никнейм.');
  }
  const trimmedNickname = nickname.trim();
  if (trimmedNickname.length < NICKNAME_MIN_LENGTH || trimmedNickname.length > NICKNAME_MAX_LENGTH) {
    return rejectWithCleanup(
      400,
      `Никнейм должен быть от ${NICKNAME_MIN_LENGTH} до ${NICKNAME_MAX_LENGTH} символов.`
    );
  }

  const avatarUrl = req.file ? `/uploads/avatars/${req.file.filename}` : null;
  // req.ip требует app.set('trust proxy', 1) в index.js, иначе за прокси
  // хостинга здесь всегда будет адрес самого прокси — см. комментарий там.
  const clientIp = req.ip || null;

  try {
    if (clientIp) {
      // Анти-фрод: грубый лимит на количество регистраций с одного IP в
      // сутки — против массового создания аккаунтов ради стартового баланса
      // токенов (config.startingTokenBalance).
      const { rows: ipRows } = await db.query(
        `SELECT COUNT(*)::int AS count FROM users
         WHERE registration_ip = $1 AND created_at >= now() - interval '24 hours'`,
        [clientIp]
      );
      if (ipRows[0].count >= config.registrationIpDailyLimit) {
        return rejectWithCleanup(
          429,
          'Слишком много регистраций с этого IP за последние 24 часа. Попробуй позже.'
        );
      }
    }

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return rejectWithCleanup(409, 'Пользователь с таким email уже зарегистрирован.');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await db.withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (email, password_hash, nickname, avatar_url, registration_ip)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, created_at`,
        [normalizedEmail, passwordHash, trimmedNickname, avatarUrl, clientIp]
      );
      const newUser = rows[0];

      await client.query(
        `INSERT INTO subscriptions (user_id, status) VALUES ($1, 'none')`,
        [newUser.id]
      );
      await client.query(
        `INSERT INTO token_balances (user_id, balance) VALUES ($1, $2)`,
        [newUser.id, config.startingTokenBalance]
      );

      const verificationToken = await issueEmailVerificationToken(client, newUser.id);

      return { ...newUser, verificationToken };
    });

    sendVerificationEmailFor(user.email, user.verificationToken);

    const token = issueToken(user);
    return res.status(201).json({ token });
  } catch (err) {
    deleteUploadedFile(req.file);
    console.error('[auth/register] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось зарегистрировать пользователя.' });
  }
});

// POST /auth/login { email, password }
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Укажи email и пароль.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { rows } = await db.query(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [normalizedEmail]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Неверный email или пароль.' });
    }

    const user = rows[0];
    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Неверный email или пароль.' });
    }

    const token = issueToken(user);
    return res.json({ token });
  } catch (err) {
    console.error('[auth/login] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось выполнить вход.' });
  }
});

// GET /auth/me — защищённый роут, отдаёт статус подписки и баланс токенов.
router.get('/me', requireAuth, async (req, res) => {
  try {
    const account = await getAccountStatus(req.user.id);
    if (!account) {
      return res.status(404).json({ error: 'Пользователь не найден.' });
    }
    return res.json(account);
  } catch (err) {
    console.error('[auth/me] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось получить данные аккаунта.' });
  }
});

// GET /auth/verify-email?token=... — открывается прямо из письма в браузере,
// поэтому отвечает HTML-страницей, а не JSON. Токен ищем по sha256-хэшу
// (сырой токен нигде в БД не хранится).
router.get('/verify-email', async (req, res) => {
  const { token } = req.query || {};

  res.type('html');

  if (typeof token !== 'string' || token.length === 0) {
    return res.status(400).send(renderVerifyEmailPage(false, 'Ссылка недействительна: отсутствует токен.'));
  }

  const tokenHash = hashVerificationToken(token);

  try {
    // Атомарно: помечаем токен использованным только если он ещё не был
    // использован и не истёк — закрывает гонку при повторном/параллельном
    // переходе по одной и той же ссылке (двойной клик, автоматическая
    // предзагрузка ссылки почтовым клиентом и т.п.).
    const { rows } = await db.query(
      `UPDATE email_verification_tokens
       SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [tokenHash]
    );

    if (rows.length === 0) {
      const { rows: existing } = await db.query(
        `SELECT used_at, expires_at FROM email_verification_tokens WHERE token_hash = $1`,
        [tokenHash]
      );
      if (existing.length === 0) {
        return res.status(400).send(renderVerifyEmailPage(false, 'Ссылка недействительна.'));
      }
      if (existing[0].used_at !== null) {
        return res.status(400).send(
          renderVerifyEmailPage(
            false,
            'Эта ссылка уже была использована. Если email всё ещё не подтверждён — войдите в Modul3D и запросите письмо ещё раз.'
          )
        );
      }
      return res.status(400).send(
        renderVerifyEmailPage(
          false,
          'Срок действия ссылки истёк. Войдите в Modul3D и запросите письмо ещё раз.'
        )
      );
    }

    await db.query(
      `UPDATE users SET email_verified_at = now() WHERE id = $1 AND email_verified_at IS NULL`,
      [rows[0].user_id]
    );

    return res.send(
      renderVerifyEmailPage(
        true,
        'Email подтверждён. Вернитесь в Modul3D — отзывы и распознавание эскиза теперь доступны.'
      )
    );
  } catch (err) {
    console.error('[auth/verify-email] ошибка:', err);
    return res.status(500).send(renderVerifyEmailPage(false, 'Не удалось подтвердить email. Попробуй ещё раз позже.'));
  }
});

// POST /auth/resend-verification — перевыпускает токен подтверждения и
// отправляет письмо заново. Требует авторизацию (JWT), тела не ждёт.
router.post('/resend-verification', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, email, email_verified_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден.' });
    }

    const user = rows[0];
    if (user.email_verified_at !== null) {
      return res.status(400).json({ error: 'Email уже подтверждён.' });
    }

    const rawToken = await db.withTransaction(async (client) => {
      // Инвалидируем ранее выданные, ещё не использованные токены — чтобы по
      // почте не гуляло сразу несколько живых ссылок на один аккаунт.
      await client.query(
        `UPDATE email_verification_tokens SET used_at = now()
         WHERE user_id = $1 AND used_at IS NULL`,
        [user.id]
      );
      return issueEmailVerificationToken(client, user.id);
    });

    sendVerificationEmailFor(user.email, rawToken);

    return res.json({ ok: true, message: 'Письмо с подтверждением отправлено повторно.' });
  } catch (err) {
    console.error('[auth/resend-verification] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось отправить письмо повторно.' });
  }
});

module.exports = router;
