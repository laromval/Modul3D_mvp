// POST /catalog-publish — кнопка «Опубликовать как базу по умолчанию» в
// панели «Библиотека» (видна только разработчику, см. GET /auth/me
// -> isAdmin). Источник правды — СОБСТВЕННЫЙ сохранённый снимок
// catalog_overrides разработчика (та же таблица, что и GET/PUT
// /catalog-overrides, см. routes/catalogOverrides.js), тело запроса не
// нужно: публикуется именно то, что уже лежит в его личных правках каталога.
//
// Логика (подробности — ТЗ-МОНЕТИЗАЦИЯ.md, раздел 6):
// 1. Только config.adminEmail может дёрнуть этот роут — иначе 403.
// 2. Без config.githubToken функция не настроена на сервере — 503, сервер
//    не падает (тот же паттерн, что ANTHROPIC_API_KEY/ADMIN_TOKEN в
//    config.js).
// 3. Читаем catalog_overrides разработчика — если пусто, публиковать нечего
//    (400).
// 4. Тянем ТЕКУЩИЕ src/catalog.js/src/app.js из GitHub (services/
//    githubPublish.js) и прогоняем их через services/catalogPublishCodegen.js
//    — она же гарантирует, что итоговый код синтаксически валиден, иначе
//    бросает CatalogPublishCodegenError и наружу НИЧЕГО не уходит (422).
// 5. Если оба файла не изменились (пустой changedKeys) — отвечаем успехом,
//    не тратя вызов записи в GitHub API.
// 6. Иначе — один атомарный коммит обоих файлов (см. githubPublish.commitFiles).
//
// Авторизация — JWT (requireAuth), НЕ ADMIN_TOKEN из routes/reviews.js: там
// эндпоинты модерации не привязаны к конкретному пользователю-владельцу
// проекта (единый секрет для внешнего инструмента), а здесь публикует
// именно личный каталог разработчика, поэтому нужен именно его req.user.

const express = require('express');

const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const githubPublish = require('../services/githubPublish');
const {
  buildCatalogSource,
  buildAppSource,
  CatalogPublishCodegenError,
} = require('../services/catalogPublishCodegen');

const router = express.Router();

// Пути от корня ОСНОВНОГО репозитория (laromval/Modul3D_mvp), не от server/ —
// сервер публикует в другой репозиторий/дерево, чем то, в котором сам живёт.
const CATALOG_PATH = 'src/catalog.js';
const APP_PATH = 'src/app.js';

router.use(express.json());
router.use(requireAuth);

router.post('/', async (req, res) => {
  if (!config.adminEmail || req.user.email !== config.adminEmail) {
    return res.status(403).json({ error: 'Публикация каталога недоступна для этого аккаунта.' });
  }

  if (!config.githubToken) {
    console.error('[catalogPublish] GITHUB_TOKEN не задан на сервере — публикация недоступна.');
    return res.status(503).json({ error: 'Публикация каталога не настроена на сервере (нет GITHUB_TOKEN).' });
  }

  try {
    const { rows } = await db.query(
      'SELECT data FROM catalog_overrides WHERE user_id = $1',
      [req.user.id]
    );
    const blob = rows.length > 0 ? rows[0].data : null;
    if (!blob || typeof blob !== 'object' || Array.isArray(blob)) {
      return res.status(400).json({ error: 'Нет сохранённых правок каталога для публикации.' });
    }

    const [catalogSource, appSource] = await Promise.all([
      githubPublish.getFileContent(CATALOG_PATH),
      githubPublish.getFileContent(APP_PATH),
    ]);

    let catalogResult;
    let appResult;
    try {
      catalogResult = buildCatalogSource(catalogSource, blob);
      appResult = buildAppSource(appSource, blob);
    } catch (err) {
      if (err instanceof CatalogPublishCodegenError) {
        // Ничего не пушим — единственная защита от битого файла в master
        // (см. catalogPublishCodegen.js).
        return res.status(422).json({ error: err.message });
      }
      throw err;
    }

    const changedKeys = [...catalogResult.changedKeys, ...appResult.changedKeys];
    if (changedKeys.length === 0) {
      return res.json({ ok: true, changed: [] });
    }

    const files = [];
    if (catalogResult.changedKeys.length > 0) {
      files.push({ path: CATALOG_PATH, content: catalogResult.newSource });
    }
    if (appResult.changedKeys.length > 0) {
      files.push({ path: APP_PATH, content: appResult.newSource });
    }

    await githubPublish.commitFiles(
      files,
      `Каталог: публикация правок разработчика (${changedKeys.join(', ')})`
    );

    return res.json({ ok: true, changed: changedKeys });
  } catch (err) {
    // Токен GitHub не должен попасть в ответ клиенту — githubPublish.js уже
    // формирует сообщения без секрета (только статус/путь запроса), но на
    // всякий случай отдаём клиенту общий текст, а подробности — только в лог.
    console.error('[catalogPublish] ошибка:', err);
    return res.status(500).json({ error: 'Не удалось опубликовать каталог.' });
  }
});

module.exports = router;
