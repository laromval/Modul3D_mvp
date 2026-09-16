// Единый реестр сайтов, для которых на сервере есть парсер товара (см.
// ТЗ-ПАРСЕР-МАТЕРИАЛОВ.md, разделы 1.2, 2, 4). Единственный источник
// истины: из него же строится и список для выпадающего списка на клиенте
// (GET /catalog-link-sources), и проверка домена ссылки перед скачиванием
// страницы (защита от SSRF, см. ../catalogLinkFetch.js) — намеренно нет
// второго места, где перечислены сайты, чтобы список никогда не разошёлся
// с реальностью.
//
// Чтобы добавить парсер под новый сайт: написать модуль вида
// ./mobilierMd.js (экспортирует { parse(html, sourceUrl) -> draft }) и
// добавить для него запись в SITES ниже — больше никаких правок в
// routes/catalogLinks.js или catalogLinkFetch.js не требуется.

const mobilierMd = require('./mobilierMd');
const daskCentruMd = require('./daskCentruMd');
const sebasMd = require('./sebasMd');

const SITES = [
  {
    id: 'mobilierMd',
    name: 'mobilier.md',
    domain: 'mobilier.md',
    // Русскоязычная версия сайта — открывается сразу при выборе сайта в
    // форме «Добавить по ссылке» (см. src/app.js), чтобы найти товар и
    // скопировать его URL. Без /ru сайт по умолчанию отдаёт другой язык.
    browseUrl: 'https://mobilier.md/ru',
    parse: mobilierMd.parse,
  },
  {
    id: 'daskCentruMd',
    name: 'dask-centru.md',
    domain: 'dask-centru.md',
    browseUrl: 'https://dask-centru.md/ru',
    parse: daskCentruMd.parse,
  },
  {
    id: 'sebasMd',
    name: 'sebas.md',
    domain: 'sebas.md',
    browseUrl: 'https://sebas.md/ru/',
    parse: sebasMd.parse,
  },
];

function listSites() {
  return SITES.map(({ id, name, domain, browseUrl }) => ({ id, name, domain, browseUrl }));
}

function getSite(id) {
  return SITES.find((s) => s.id === id) || null;
}

module.exports = { SITES, listSites, getSite };
