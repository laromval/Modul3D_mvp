-- Modul3D backend — раздел «Клиенты» (клиент → проекты → заметки).
-- Применяется через `npm run migrate`, как и предыдущие миграции
-- (идемпотентно: IF NOT EXISTS).
--
-- Изоляция данных: в КАЖДОЙ таблице есть user_id, и каждый запрос в
-- routes/clients.js фильтруется по user_id из JWT — чужие строки недоступны
-- по построению. Задачи и файлы (Google Диск) добавятся отдельными
-- миграциями.
--
-- Что шифруется (AES-256-GCM, services/workflowCrypto.js, ключ
-- WORKFLOW_ENC_KEY): контакт клиента (телефон/почта третьего лица) и текст
-- заметок. Имя клиента и название проекта лежат открытым текстом — по ним
-- строится список и сортировка.

CREATE TABLE IF NOT EXISTS clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  contact     TEXT,              -- зашифрованная строка "v1...." или NULL
  archived_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_user ON clients (user_id, created_at);

CREATE TABLE IF NOT EXISTS client_projects (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active', -- 'active' | 'done'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_projects_client ON client_projects (user_id, client_id, created_at);

-- project_id NULL — заметка «на весь клиент», без привязки к проекту.
CREATE TABLE IF NOT EXISTS client_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id UUID REFERENCES client_projects(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,      -- зашифрованная строка "v1...."
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_notes_client ON client_notes (user_id, client_id, created_at);
