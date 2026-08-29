const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { getAccountStatus } = require('../services/account');
const { handleAvatarUpload, deleteUploadedFile } = require('../services/avatarUpload');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 12;
const NICKNAME_MIN_LENGTH = 2;
const NICKNAME_MAX_LENGTH = 40;

function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
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

  const normalizedEmail = email.trim().toLowerCase();
  const avatarUrl = req.file ? `/uploads/avatars/${req.file.filename}` : null;

  try {
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return rejectWithCleanup(409, 'Пользователь с таким email уже зарегистрирован.');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await db.withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (email, password_hash, nickname, avatar_url)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, created_at`,
        [normalizedEmail, passwordHash, trimmedNickname, avatarUrl]
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

      return newUser;
    });

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

module.exports = router;
