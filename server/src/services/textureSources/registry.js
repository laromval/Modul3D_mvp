// Реестр источников текстур (единственное место, где они перечислены).
// Чтобы добавить сайт: модуль { fetchTexture(url, {maxBytes}) } + запись ниже.

const egger = require('./egger');
const kronospan = require('./kronospan');

const SOURCES = [
  {
    id: 'egger',
    name: 'Egger',
    domain: 'egger.com',
    kind: 'sheet',
    // Раздел «Мебель и интерьер» (200 при живой проверке); прямой адрес каталога
    // декоров /decors у Egger для запросов без браузера отдаёт 404/500.
    browseUrl: 'https://www.egger.com/en/furniture-interior-design/',
    hint: 'Откройте страницу декора на egger.com (раздел «Декоры»), скопируйте адрес страницы из адресной строки. Берётся изображение листа (вид «Platte»).',
    exampleUrl: 'https://www.egger.com/de/moebel-innenausbau/dekore/F206_9',
    fetchTexture: egger.fetchTexture,
  },
  {
    id: 'kronospan',
    name: 'Kronospan',
    domain: 'kronospan.com',
    kind: 'fragment',
    browseUrl: 'https://kronospan.com/en_EN/decors/by_collection/kronodesign/',
    hint: 'Откройте страницу декора Kronodesign на kronospan.com и скопируйте адрес. Kronospan публикует не лист целиком, а фрагмент рисунка.',
    exampleUrl: 'https://kronospan.com/en_EN/decors/view/kronodesign/K001/',
    fetchTexture: kronospan.fetchTexture,
  },
];

function listSources() {
  return SOURCES.map(({ id, name, domain, hint, exampleUrl, kind, browseUrl }) => ({ id, name, domain, hint, exampleUrl, kind, browseUrl }));
}

function getSource(id) {
  return SOURCES.find((s) => s.id === id) || null;
}

module.exports = { SOURCES, listSources, getSource };
