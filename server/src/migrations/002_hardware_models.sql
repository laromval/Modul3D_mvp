-- Modul3D backend — приватная библиотека 3D-моделей фурнитуры (.obj петель)
-- под аккаунтом пользователя. Применяется через `npm run migrate` (см.
-- server/scripts/migrate.js), как и 001_init.sql.

-- slot_kind — строковый идентификатор типа присадки, под которую загружена
-- модель. Значения ограничены на уровне приложения (см.
-- server/src/routes/hardwareModels.js), не CHECK-constraint, чтобы можно
-- было расширять список типов фурнитуры без миграции. Сейчас допустимые
-- значения — 'hingeCup' и 'hingeGlass', это тот же словарь, что уже
-- используется в src/engine.js для part.holes[].kind (должны совпадать
-- буква в букву с клиентским кодом).
CREATE TABLE IF NOT EXISTS hardware_models (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_kind  TEXT NOT NULL,
  name       TEXT NOT NULL,
  obj_text   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hardware_models_user_id ON hardware_models(user_id);
