-- Modul3D backend — восстановление забытого пароля.
-- Применяется через `npm run migrate` (см. server/scripts/migrate.js), как и
-- предыдущие миграции.
--
-- Структура полностью аналогична email_verification_tokens
-- (004_email_verification.sql) — те же причины: храним только sha256-хэш
-- токена (crypto, не bcrypt — сам токен уже криптографически случайный и
-- высокоэнтропийный, 32 байта из crypto.randomBytes, а не пароль
-- пользователя), чтобы утечка БД не давала готовые ссылки сброса пароля.
-- Ссылка уходит пользователю на email один раз сразу после генерации и
-- больше нигде не хранится в открытом виде.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash
  ON password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
  ON password_reset_tokens (user_id);
