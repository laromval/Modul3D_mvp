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
    parse: mobilierMd.parse,
  },
  {
    id: 'daskCentruMd',
    name: 'dask-centru.md',
    domain: 'dask-centru.md',
    parse: daskCentruMd.parse,
  },
  {
    id: 'sebasMd',
    name: 'sebas.md',
    domain: 'sebas.md',
    parse: sebasMd.parse,
  },
];

function listSites() {
  return SITES.map(({ id, name, domain }) => ({ id, name, domain }));
}

function getSite(id) {
  return SITES.find((s) => s.id === id) || null;
}

module.exports = { SITES, listSites, getSite };
