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
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/emailSender');

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

// Общий sha256-хэш для одноразовых токенов по ссылке (подтверждение email,
// сброс пароля) — сам токен уже криптографически случайный и
// высокоэнтропийный (32 байта из crypto.randomBytes), поэтому медленное
// хэширование (bcrypt) здесь не нужно, в отличие от пароля пользователя.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Генерирует токен подтверждения email, сохраняет его хэш (не сырой токен —
// см. migrations/004_email_verification.sql) и возвращает сырой токен для
// вставки в ссылку письма. Вызывать внутри транзакции/клиента БД.
async function issueEmailVerificationToken(client, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + config.emailVerificationTokenTtlMinutes * 60 * 1000);

  await client.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return token;
}

// Генерирует токен сброса пароля, сохраняет его хэш (не сырой токен — см.
// migrations/005_password_reset.sql) и возвращает сырой токен для вставки в
// ссылку письма. Та же структура, что issueEmailVerificationToken выше, но
// свой TTL (config.passwordResetTokenTtlMinutes) и своя таблица. Вызывать
// внутри транзакции/клиента БД.
async function issuePasswordResetToken(client, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + config.passwordResetTokenTtlMinutes * 60 * 1000);

  await client.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
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

function sendPasswordResetEmailFor(userEmail, rawToken) {
  const resetUrl = `${config.publicServerUrl}/auth/reset-password?token=${rawToken}`;
  // Не блокируем ответ клиенту сетевым вызовом к Brevo — тот же подход, что
  // sendVerificationEmailFor выше.
  sendPasswordResetEmail(userEmail, resetUrl);
}

// Простая статическая HTML-страница результата (открывается прямо из письма
// в браузере, без JS/JSON) — в духе public/admin/reviews.html. Общий стиль
// вынесен сюда, чтобы renderVerifyEmailPage и страницы сброса пароля ниже
// выглядели одинаково.
function renderAuthMessagePage(title, message, ok) {
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

function renderVerifyEmailPage(ok, message) {
  const title = ok ? 'Email подтверждён' : 'Не удалось подтвердить email';
  return renderAuthMessagePage(title, message, ok);
}

// Страница-ошибка для невалидной/истёкшей/уже использованной ссылки сброса
// пароля — тот же стиль, что и renderVerifyEmailPage, без формы.
function renderResetPasswordErrorPage(message) {
  return renderAuthMessagePage('Не удалось сбросить пароль', message, false);
}

// Страница с формой сброса пароля (валидный, ещё не использованный токен).
// Отправка — не обычный <form method="POST"> (express.json() на /auth не
// понимает urlencoded-тела формы, заводить его отдельно ради одной страницы
// не нужно), а инлайн-скрипт с fetch на этот же POST /auth/reset-password,
// результат показывается прямо на странице без редиректа.
function renderResetPasswordFormPage(token) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Modul3D — Сброс пароля</title>
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
    width: 100%;
    max-width: 420px;
    margin: 24px;
    background: #1b1f26;
    border: 1px solid #262c35;
    border-radius: 12px;
    padding: 28px;
    box-sizing: border-box;
  }
  h1 { font-size: 18px; margin: 0 0 16px; color: #eef3f8; text-align: center; }
  label { display: block; font-size: 13px; color: #bcccdc; margin: 12px 0 4px; }
  input {
    width: 100%;
    box-sizing: border-box;
    padding: 9px 10px;
    border-radius: 8px;
    border: 1px solid #2c333d;
    background: #12161b;
    color: #eef3f8;
    font-size: 14px;
  }
  button {
    width: 100%;
    margin-top: 18px;
    padding: 10px;
    border: none;
    border-radius: 8px;
    background: #3d7dfc;
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  #status { margin-top: 14px; text-align: center; color: #bcccdc; min-height: 18px; }
  #status.error { color: #ff5c72; }
  #status.ok { color: #34d399; }
</style>
</head>
<body>
<main>
  <h1>Новый пароль</h1>
  <label for="password">Новый пароль</label>
  <input id="password" type="password" minlength="8" placeholder="не менее 8 символов" autocomplete="new-password" />
  <label for="passwordConfirm">Подтвердите пароль</label>
  <input id="passwordConfirm" type="password" minlength="8" placeholder="повторите пароль" autocomplete="new-password" />
  <button id="submitBtn" type="button">Сохранить новый пароль</button>
  <div id="status"></div>
</main>
<script>
  var token = new URLSearchParams(location.search).get('token');
  var statusEl = document.getElementById('status');
  var btn = document.getElementById('submitBtn');
  function setStatus(message, kind) {
    statusEl.textContent = message || '';
    statusEl.className = kind || '';
  }
  btn.addEventListener('click', function () {
    var password = document.getElementById('password').value;
    var passwordConfirm = document.getElementById('passwordConfirm').value;
    if (!password || password.length < 8) {
      setStatus('Пароль должен быть не короче 8 символов.', 'error');
      return;
    }
    if (password !== passwordConfirm) {
      setStatus('Пароли не совпадают.', 'error');
      return;
    }
    btn.disabled = true;
    setStatus('Сохраняем…', '');
    fetch('/auth/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token, password: password }),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          setStatus((result.data && result.data.error) || 'Не удалось сохранить пароль.', 'error');
          btn.disabled = false;
          return;
        }
        setStatus('Пароль обновлён, можно войти.', 'ok');
      })
      .catch(function () {
        setStatus('Не удалось связаться с сервером — проверьте подключение к интернету.', 'error');
        btn.disabled = false;
      });
  });
</script>
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

  const tokenHash = hashToken(token);

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

// POST /auth/forgot-password { email } — всегда отвечает одинаковым успехом,
// независимо от того, найден ли такой email, чтобы не палить, какие email
// зарегистрированы (user enumeration). Не требует авторизации.
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  const successResponse = {
    ok: true,
    message: 'Если такой email зарегистрирован, на него отправлено письмо со ссылкой для сброса пароля.',
  };

  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    // Даже при явно некорректном формате email отвечаем тем же успехом —
    // иначе валидная/невалидная форма email тоже становится каналом утечки.
    return res.json(successResponse);
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { rows } = await db.query('SELECT id, email FROM users WHERE email = $1', [normalizedEmail]);
    if (rows.length > 0) {
      const user = rows[0];

      const rawToken = await db.withTransaction(async (client) => {
        // Инвалидируем ранее выданные, ещё не использованные токены сброса
        // пароля — чтобы по почте не гуляло сразу несколько живых ссылок на
        // один аккаунт (тот же приём, что и в resend-verification выше).
        await client.query(
          `UPDATE password_reset_tokens SET used_at = now()
           WHERE user_id = $1 AND used_at IS NULL`,
          [user.id]
        );
        return issuePasswordResetToken(client, user.id);
      });

      sendPasswordResetEmailFor(user.email, rawToken);
    }

    return res.json(successResponse);
  } catch (err) {
    console.error('[auth/forgot-password] ошибка:', err);
    // Даже при внутренней ошибке не раскрываем факт существования email —
    // отдаём тот же успешный ответ, ошибку только логируем на сервере.
    return res.json(successResponse);
  }
});

// GET /auth/reset-password?token=... — открывается прямо из письма в
// браузере, поэтому отвечает HTML-страницей, а не JSON. Токен ищем по
// sha256-хэшу (сырой токен нигде в БД не хранится) и НЕ расходуем здесь —
// расход (used_at) происходит только в POST ниже, после реальной смены
// пароля.
router.get('/reset-password', async (req, res) => {
  const { token } = req.query || {};

  res.type('html');

  if (typeof token !== 'string' || token.length === 0) {
    return res.status(400).send(renderResetPasswordErrorPage('Ссылка недействительна: отсутствует токен.'));
  }

  const tokenHash = hashToken(token);

  try {
    const { rows } = await db.query(
      `SELECT used_at, expires_at FROM password_reset_tokens WHERE token_hash = $1`,
      [tokenHash]
    );

    if (rows.length === 0) {
      return res.status(400).send(renderResetPasswordErrorPage('Ссылка недействительна.'));
    }
    if (rows[0].used_at !== null) {
      return res.status(400).send(
        renderResetPasswordErrorPage(
          'Эта ссылка уже была использована. Если пароль всё ещё нужно сбросить — запросите новое письмо.'
        )
      );
    }
    if (new Date(rows[0].expires_at).getTime() <= Date.now()) {
      return res.status(400).send(
        renderResetPasswordErrorPage('Срок действия ссылки истёк. Запросите новое письмо для сброса пароля.')
      );
    }

    return res.send(renderResetPasswordFormPage(token));
  } catch (err) {
    console.error('[auth/reset-password:get] ошибка:', err);
    return res.status(500).send(renderResetPasswordErrorPage('Не удалось открыть страницу сброса пароля. Попробуй ещё раз позже.'));
  }
});

// POST /auth/reset-password { token, password } — принимает новый пароль,
// вызывается инлайн-скриптом со страницы выше через fetch (JSON), а не как
// обычная отправка формы.
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body || {};

  if (typeof token !== 'string' || token.length === 0) {
    return res.status(400).json({ error: 'Ссылка недействительна: отсутствует токен.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов.' });
  }

  const tokenHash = hashToken(token);

  try {
    // Атомарно: помечаем токен использованным только если он ещё не был
    // использован и не истёк — закрывает гонку при двойном/параллельном
    // сабмите формы (тот же паттерн, что и GET /auth/verify-email).
    const { rows } = await db.query(
      `UPDATE password_reset_tokens
       SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [tokenHash]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Ссылка недействительна или уже использована.' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, rows[0].user_id]);

    return res.json({ ok: true });
  } catch (err) {
    console.error('[auth/reset-password:post] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось сохранить новый пароль. Попробуй ещё раз позже.' });
  }
});

module.exports = router;
