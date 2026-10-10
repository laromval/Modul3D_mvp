-- Modul3D backend — задачи клиентов со сроком и напоминанием + подписки на
-- push-уведомления. Применяется через `npm run migrate` (идемпотентно).
--
-- Изоляция данных, как и в 008_clients.sql: user_id в каждой таблице, каждый
-- запрос фильтруется по user_id из JWT.
--
-- Название и описание задачи шифруются (AES-256-GCM, workflowCrypto.js).
-- Срок, статус и время напоминания лежат открытым текстом — по ним строится
-- сортировка и работает планировщик напоминаний.

CREATE TABLE IF NOT EXISTS client_tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id       UUID REFERENCES client_projects(id) ON DELETE CASCADE, -- NULL — задача на весь клиент
  title            TEXT NOT NULL,   -- зашифрованная строка "v1...."
  details          TEXT,            -- зашифрованная строка "v1...." или NULL
  status           TEXT NOT NULL DEFAULT 'todo', -- 'todo' | 'doing' | 'done'
  due_at           TIMESTAMPTZ,     -- срок (с временем)
  remind_before_min INTEGER,        -- за сколько минут до срока напомнить (0 — в момент срока); NULL — не напоминать
  remind_at        TIMESTAMPTZ,     -- due_at - remind_before_min (считает сервер)
  reminded_at      TIMESTAMPTZ,     -- когда напоминание отправлено
  done_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_tasks_user_due ON client_tasks (user_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_client_tasks_client ON client_tasks (user_id, client_id, created_at);
-- Планировщик ищет только неотправленные напоминания по незавершённым задачам.
CREATE INDEX IF NOT EXISTS idx_client_tasks_due_reminders ON client_tasks (remind_at)
  WHERE reminded_at IS NULL AND remind_at IS NOT NULL AND status <> 'done';

-- Подписки браузера на push (одна запись на устройство/браузер).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ok_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions (user_id);

-- Ключи VAPID (подпись push-сообщений). Создаются сервером при первом
-- запуске и хранятся здесь, чтобы не требовать ручной настройки. Не больше
-- одной строки. Если заданы переменные окружения VAPID_PUBLIC_KEY /
-- VAPID_PRIVATE_KEY, используются они.
CREATE TABLE IF NOT EXISTS push_vapid_keys (
  id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  public_key  TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
