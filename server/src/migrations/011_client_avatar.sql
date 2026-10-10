-- Modul3D backend — аватар клиента: обычная карточка файла на Google Диске
-- (client_files, kind='drive', project_id NULL) с пометкой is_avatar.
-- У клиента не больше одного аватара (частичный уникальный индекс).
-- Применяется через `npm run migrate` (идемпотентно).

ALTER TABLE client_files ADD COLUMN IF NOT EXISTS is_avatar BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_files_avatar ON client_files (client_id) WHERE is_avatar;
