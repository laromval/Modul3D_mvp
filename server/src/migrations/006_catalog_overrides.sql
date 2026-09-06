-- Modul3D backend — пользовательские правки каталога материалов
-- (панель «Библиотека → Материалы» на клиенте: дерево категорий,
-- переименование/добавление/удаление категорий, редактирование
-- названий/цен/фото прямо в таблицах). Применяется через `npm run migrate`
-- (см. server/scripts/migrate.js), как и предыдущие миграции.
--
-- Один JSON-снимок изменяемых частей каталога материалов на пользователя —
-- сохранение всегда заменяет весь блок целиком (upsert), сервер не
-- валидирует и не понимает его содержимое по существу (форма данных из
-- src/catalog.js/src/app.js — клиентская зона, не серверная), только
-- хранит и отдаёт как есть. Может содержать base64 data URL картинок
-- (фото-образцы материалов), поэтому data — JSONB без ограничения размера
-- на уровне схемы (лимит — на уровне HTTP body в routes/catalogOverrides.js).

CREATE TABLE IF NOT EXISTS catalog_overrides (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
