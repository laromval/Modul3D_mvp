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
const tehmobMd = require('./tehmobMd');

// kinds — что реально продаёт сайт, ['materials', 'hardware'] или подмножество
// (см. state.libLinkForm.kind в src/app.js — форма «Добавить по ссылке»
// открывается либо из панели материалов, либо из панели фурнитуры). Используется
// клиентом, чтобы не предлагать в списке материалов сайт, где материалов нет
// вообще (см. libLinkSitePickerHtml) — mobilier.md/dask-centru.md торгуют и тем,
// и тем (проверено живыми примерами прямо в комментариях их парсеров), а
// sebas.md/tehmob.md — только штучной фурнитурой и профилем (см. комментарии
// вверху sebasMd.js/tehmobMd.js про "сайт продаёт только штучную фурнитуру").
const SITES = [
  {
    id: 'mobilierMd',
    name: 'mobilier.md',
    domain: 'mobilier.md',
    // Русскоязычная версия сайта — открывается сразу при выборе сайта в
    // форме «Добавить по ссылке» (см. src/app.js), чтобы найти товар и
    // скопировать его URL. Без /ru сайт по умолчанию отдаёт другой язык.
    browseUrl: 'https://mobilier.md/ru',
    kinds: ['materials', 'hardware'],
    parse: mobilierMd.parse,
  },
  {
    id: 'daskCentruMd',
    name: 'dask-centru.md',
    domain: 'dask-centru.md',
    browseUrl: 'https://dask-centru.md/ru',
    kinds: ['materials', 'hardware'],
    parse: daskCentruMd.parse,
  },
  {
    id: 'sebasMd',
    name: 'sebas.md',
    domain: 'sebas.md',
    browseUrl: 'https://sebas.md/ru/',
    kinds: ['hardware'],
    parse: sebasMd.parse,
  },
  {
    id: 'tehmobMd',
    name: 'tehmob.md',
    domain: 'tehmob.md',
    // /ru/ — рабочий русскоязычный корень (проверено живьём, в т.ч. с чистыми
    // куками): открывает сайт на русском и держит язык при переходе по
    // каталогу (категории получают отдельные русские ЧПУ-адреса вида
    // /profili/..., не /profile/...). Страницы товара парсер при этом
    // понимает в любом варианте — и румынском, и русском — см. tehmobMd.js.
    browseUrl: 'https://tehmob.md/ru/',
    kinds: ['hardware'],
    parse: tehmobMd.parse,
  },
];

function listSites() {
  return SITES.map(({ id, name, domain, browseUrl, kinds }) => ({ id, name, domain, browseUrl, kinds }));
}

function getSite(id) {
  return SITES.find((s) => s.id === id) || null;
}

module.exports = { SITES, listSites, getSite };
