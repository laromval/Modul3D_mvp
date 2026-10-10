-- Modul3D backend — «Файлы» проекта клиента: ссылки из интернета (kind='link')
-- и, на следующем этапе, карточки файлов на Google Диске пользователя
-- (kind='drive'; сами файлы лежат на Диске пользователя, у нас только ссылка).
-- Применяется через `npm run migrate` (идемпотентно).
--
-- Изоляция, как в 008/009: user_id в каждой строке, каждый запрос фильтруется
-- по user_id из JWT. Название и адрес шифруются (AES-256-GCM, workflowCrypto.js).

CREATE TABLE IF NOT EXISTS client_files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id    UUID REFERENCES client_projects(id) ON DELETE CASCADE, -- NULL — файл на весь клиент
  kind          TEXT NOT NULL DEFAULT 'link',  -- 'link' | 'drive'
  title         TEXT NOT NULL,                 -- зашифрованная строка "v1...."
  url           TEXT NOT NULL,                 -- зашифрованная строка "v1...." (адрес ссылки / ссылка на файл на Диске)
  drive_file_id TEXT,                          -- для kind='drive'
  mime          TEXT,
  size_bytes    BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_files_client ON client_files (user_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_files_project ON client_files (user_id, project_id, created_at DESC);
