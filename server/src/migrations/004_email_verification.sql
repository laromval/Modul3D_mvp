-- Modul3D backend — подтверждение email при регистрации + анти-фрод учёт IP.
-- Применяется через `npm run migrate` (см. server/scripts/migrate.js), как и
-- предыдущие миграции.
--
-- Зачем: без подтверждения владения почтой (1) владелец проекта не может
-- связаться с автором отзыва по указанному email, (2) ничто не мешает
-- регистрировать много аккаунтов на разные email ради стартового баланса
-- токенов (config.startingTokenBalance) — "фарм". Гейт на подтверждённый
-- email для трат токенов и отзывов реализован в
-- server/src/middleware/emailVerification.js.

-- email_verified_at IS NULL — email ещё не подтверждён (в т.ч. для всех
-- пользователей, созданных до этой миграции — им просто нужно будет пройти
-- подтверждение, чтобы дальше тратить токены/оставлять отзывы).
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- IP, с которого пришла регистрация — используется только для лимита
-- регистраций в сутки (см. registrationIpDailyLimit в config.js), не хранит
-- ничего сверх этого. Для пользователей до этой миграции остаётся NULL —
-- на анти-фрод проверку новых регистраций это не влияет.
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_ip TEXT;

-- Индекс под запрос "сколько пользователей зарегистрировано с этого IP за
-- последние 24 часа" (routes/auth.js, POST /register).
CREATE INDEX IF NOT EXISTS idx_users_registration_ip_created_at
  ON users (registration_ip, created_at);

-- Токены подтверждения email. Храним только sha256-хэш токена (crypto,
-- не bcrypt — сам токен уже криптографически случайный и высокоэнтропийный,
-- 32 байта из crypto.randomBytes, а не пароль пользователя, поэтому
-- медленное хэширование здесь не нужно), чтобы утечка БД не давала готовые
-- ссылки подтверждения. Ссылка уходит пользователю на email один раз сразу
-- после генерации и больше нигде не хранится в открытом виде.
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token_hash
  ON email_verification_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id
  ON email_verification_tokens (user_id);
