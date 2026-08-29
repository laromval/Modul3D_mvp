-- Modul3D backend — никнейм и аватарка пользователя, отзывы о приложении
-- с модерацией. Применяется через `npm run migrate` (см.
-- server/scripts/migrate.js), как и предыдущие миграции.

-- nickname и avatar_url — nullable: у уже существующих пользователей (до
-- этой миграции) их нет и взяться неоткуда. Для новых регистраций nickname
-- обязателен на уровне API (см. server/src/routes/auth.js), но в схеме не
-- делаем его NOT NULL, чтобы не ломать существующие строки.
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Отзывы о приложении с ручной модерацией одним владельцем проекта
-- (см. server/src/routes/reviews.js). status по умолчанию 'pending' —
-- отзыв не виден публично (GET /reviews/public), пока не одобрен.
CREATE TABLE IF NOT EXISTS reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
    -- ожидаемые значения status: 'pending' | 'approved' | 'rejected'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  moderated_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
