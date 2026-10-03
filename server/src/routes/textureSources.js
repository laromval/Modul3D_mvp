// Роуты «Источники текстур» (ТЗ-ПАРСЕР-МАТЕРИАЛОВ.md, раздел «Источники
// текстур»). Сервер находит картинку листа декора на странице производителя,
// скачивает и отдаёт байты клиенту; ничего не сохраняет.
//
// - GET  /texture-sources -> [{ id, name, domain, hint, exampleUrl, kind }]
// - POST /texture-sheet { siteId, url } -> байты JPEG/PNG; заголовки
//   X-Texture-Kind (sheet|fragment), X-Sheet-Width-Mm / X-Sheet-Height-Mm
//   (только если известны), X-Texture-Source-Url. Ошибки — JSON { error }.
// Оба за requireAuth; пути полные, роутер монтируется без префикса.

const express = require('express');

const { requireAuth } = require('../middleware/auth');
const { listSources, getSource } = require('../services/textureSources/registry');
const { CatalogLinkError } = require('../services/catalogLinkFetch');
const config = require('../config');

const router = express.Router();

// Лимит «N запросов в минуту на пользователя» в памяти процесса — чтобы
// /texture-sheet нельзя было использовать как инструмент нагрузки на чужие сайты.
let active = 0; // текущее число обработок /texture-sheet (глобально)
const hits = new Map();
function rateLimited(userId) {
  const now = Date.now();
  const arr = (hits.get(userId) || []).filter((t) => now - t < 60000);
  if (arr.length >= config.textureRateLimitPerMin) {
    hits.set(userId, arr);
    return true;
  }
  arr.push(now);
  hits.set(userId, arr);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k);
  }
  return false;
}

const EXPOSED = 'X-Texture-Kind, X-Sheet-Width-Mm, X-Sheet-Height-Mm, X-Texture-Source-Url, Content-Type';

router.get('/texture-sources', requireAuth, (req, res) => res.json(listSources()));

router.post('/texture-sheet', express.json({ limit: '4kb' }), requireAuth, async (req, res) => {
  const { siteId, url } = req.body || {};
  if (typeof siteId !== 'string' || !siteId) return res.status(400).json({ error: 'Не передан siteId.' });
  if (typeof url !== 'string' || !url || url.length > 2000) return res.status(400).json({ error: 'Не передан url.' });
  const source = getSource(siteId);
  if (!source) return res.status(400).json({ error: `Неизвестный источник текстур (siteId=${siteId}).` });

  if (rateLimited(req.user.id)) {
    return res.status(429).json({ error: 'Слишком много запросов — подождите минуту.' });
  }

  if (active >= config.textureMaxConcurrent) {
    return res.status(503).json({ error: 'Сервер занят, повторите через минуту.' });
  }
  active += 1;
  try {
    const r = await source.fetchTexture(url, { maxBytes: config.textureMaxImageBytes });
    res.set('Content-Type', r.contentType);
    res.set('X-Texture-Kind', r.kind);
    if (r.sheetWidthMm && r.sheetHeightMm) {
      res.set('X-Sheet-Width-Mm', String(r.sheetWidthMm));
      res.set('X-Sheet-Height-Mm', String(r.sheetHeightMm));
    }
    res.set('X-Texture-Source-Url', r.sourceUrl);
    res.set('Access-Control-Expose-Headers', EXPOSED);
    res.set('Cache-Control', 'no-store');
    return res.send(r.buffer);
  } catch (err) {
    if (err instanceof CatalogLinkError) return res.status(err.httpStatus).json({ error: err.message });
    console.error('[texture-sheet] непредвиденная ошибка:', err);
    return res.status(500).json({ error: 'Внутренняя ошибка при обработке ссылки.' });
  } finally {
    active -= 1;
  }
});

module.exports = router;
