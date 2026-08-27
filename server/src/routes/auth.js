const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { getAccountStatus } = require('../services/account');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 12;

function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

// POST /auth/register { email, password }
router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Укажи корректный email.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Пользователь с таким email уже зарегистрирован.' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await db.withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2)
         RETURNING id, email, created_at`,
        [normalizedEmail, passwordHash]
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
