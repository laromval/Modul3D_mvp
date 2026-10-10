-- Modul3D backend — личные данные страницы Workflow (доска задач и заметки
-- владельца проекта). Применяется через `npm run migrate`, как и предыдущие
-- миграции (идемпотентно: IF NOT EXISTS).
--
-- Содержимое (в том числе заметки, где могут быть пароли) хранится ТОЛЬКО в
-- зашифрованном виде: сервер шифрует JSON AES-256-GCM ключом из переменной
-- окружения WORKFLOW_ENC_KEY (services/workflowCrypto.js) и кладёт сюда
-- готовую строку. Открытого текста в базе нет — копия базы без ключа
-- заметок не раскрывает.
--
-- revision растёт на 1 при каждом сохранении: клиент передаёт ту ревизию, на
-- которой основаны его правки, и сервер отвергает устаревшую запись (409) —
-- так второе устройство со старой копией не затрёт свежие заметки.

CREATE TABLE IF NOT EXISTS workflow_data (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload    TEXT NOT NULL,
  revision   INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
