// Роуты фичи «Добавить материал/фурнитуру по ссылке» (см.
// ТЗ-ПАРСЕР-МАТЕРИАЛОВ.md, разделы 1, 4). Ничего не сохраняет — только
// парсит страницу стороннего сайта и отдаёт черновик клиенту для
// подтверждения; сохранение по-прежнему идёт через уже существующий
// PUT /catalog-overrides (см. routes/catalogOverrides.js), туда клиент сам
// добавляет sourceUrl/sourceSiteId/verifiedAt в объект позиции.
//
// Контракт:
// - Authorization: Bearer <JWT> обязателен на всех трёх эндпоинтах
//   (requireAuth) — гостям фича недоступна, как и личные catalog_overrides.
//
// - GET /catalog-link-sources
//   -> { sites: [{ id, name, domain }, ...] }
//   Список сайтов, для которых на сервере есть парсер (источник —
//   services/catalogLinkParsers/registry.js, единственное место, где
//   сайты перечислены).
//
// - POST /catalog-link-parse { siteId, url }
//   -> { draft: {...} } — см. поля черновика в
//      services/catalogLinkParsers/mobilierMd.js (parse()).
//   400, если siteId неизвестен или url не принадлежит домену этого сайта
//   (защита от SSRF, см. services/catalogLinkFetch.js).
//   404/502/504, если сайт недоступен/вернул ошибку/не удалось распознать
//   вёрстку — понятный текст, без сырого HTML в ответе.
//
// - POST /catalog-link-refresh { items: [{ url, siteId }, ...] }
//   -> { results: [{ url, siteId, ok: true, draft } |
//                  { url, siteId, ok: false, error }, ...] }
//   Батч для кнопки «Обновить цены с сайта» (раздел 1, п.8) — перепарсивает
//   разом все переданные позиции. Не более MAX_REFRESH_ITEMS элементов за
//   запрос, обрабатываются небольшими партиями (REFRESH_CONCURRENCY), чтобы
//   не заваливать сторонний сайт разом полусотней параллельных запросов.
//   Результат — по одному объекту на каждый элемент items, в том же
//   порядке (в т.ч. при ok:false — "не найдено"/ошибка сайта не прерывает
//   обработку остальных позиций).

const express = require('express');

const { requireAuth } = require('../middleware/auth');
const { listSites, getSite } = require('../services/catalogLinkParsers/registry');
const { fetchAndParseProduct, CatalogLinkError } = require('../services/catalogLinkFetch');
const config = require('../config');

const router = express.Router();

const MAX_REFRESH_ITEMS = config.catalogLinkMaxRefreshItems;
const REFRESH_CONCURRENCY = 4;

function respondWithCatalogLinkError(res, err, logPrefix) {
  if (err instanceof CatalogLinkError) {
    return res.status(err.httpStatus).json({ error: err.message });
  }
  console.error(`${logPrefix} непредвиденная ошибка:`, err);
  return res.status(500).json({ error: 'Внутренняя ошибка при обработке ссылки.' });
}

// requireAuth и express.json() подключены на каждый роут отдельно (а не
// через router.use без пути) намеренно: этот роутер монтируется в index.js
// без общего префикса (сами пути уже содержат "/catalog-link-..."), и
// router.use(...) без указания пути выполнялся бы для ЛЮБОГО запроса,
// который вообще доходит до этого роутера — включая, например,
// POST /billing/webhook, которому нужно сырое (не JSON) тело для проверки
// подписи Paddle. Middleware, привязанный к конкретному router.get/post,
// запускается строго при совпадении метода и пути.

router.get('/catalog-link-sources', requireAuth, (req, res) => {
  return res.json({ sites: listSites() });
});

router.post('/catalog-link-parse', express.json({ limit: '32kb' }), requireAuth, async (req, res) => {
  const { siteId, url } = req.body || {};

  if (typeof siteId !== 'string' || !siteId) {
    return res.status(400).json({ error: 'Не передан siteId.' });
  }
  if (typeof url !== 'string' || !url) {
    return res.status(400).json({ error: 'Не передан url.' });
  }

  const site = getSite(siteId);
  if (!site) {
    return res.status(400).json({ error: `Неизвестный сайт (siteId=${siteId}).` });
  }

  try {
    const draft = await fetchAndParseProduct(site, url);
    return res.json({ draft });
  } catch (err) {
    return respondWithCatalogLinkError(res, err, '[catalog-link-parse]');
  }
});

router.post('/catalog-link-refresh', express.json({ limit: '256kb' }), requireAuth, async (req, res) => {
  const { items } = req.body || {};

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'Не передан массив items.' });
  }
  if (items.length === 0) {
    return res.json({ results: [] });
  }
  if (items.length > MAX_REFRESH_ITEMS) {
    return res.status(400).json({
      error: `Слишком много позиций за один раз (максимум ${MAX_REFRESH_ITEMS}).`,
    });
  }

  const normalized = items.map((item, index) => ({
    index,
    url: item && typeof item.url === 'string' ? item.url : null,
    siteId: item && typeof item.siteId === 'string' ? item.siteId : null,
  }));

  const invalid = normalized.find((it) => !it.url || !it.siteId);
  if (invalid) {
    return res.status(400).json({
      error: `Позиция №${invalid.index + 1} в items не содержит url и siteId.`,
    });
  }

  const results = new Array(normalized.length);

  for (let i = 0; i < normalized.length; i += REFRESH_CONCURRENCY) {
    const batch = normalized.slice(i, i + REFRESH_CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(batch.map(async (item) => {
      const site = getSite(item.siteId);
      if (!site) {
        results[item.index] = {
          url: item.url,
          siteId: item.siteId,
          ok: false,
          error: `Неизвестный сайт (siteId=${item.siteId}).`,
        };
        return;
      }
      try {
        const draft = await fetchAndParseProduct(site, item.url);
        results[item.index] = { url: item.url, siteId: item.siteId, ok: true, draft };
      } catch (err) {
        const message = err instanceof CatalogLinkError
          ? err.message
          : 'Внутренняя ошибка при обработке ссылки.';
        if (!(err instanceof CatalogLinkError)) {
          console.error('[catalog-link-refresh] непредвиденная ошибка:', err);
        }
        results[item.index] = { url: item.url, siteId: item.siteId, ok: false, error: message };
      }
    }));
  }

  return res.json({ results });
});

module.exports = router;
