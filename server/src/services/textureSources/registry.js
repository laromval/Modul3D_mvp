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
    hint: 'Откройте страницу декора на egger.com (раздел «Декоры»), скопируйте адрес страницы из адресной строки. Берётся изображение листа (вид «Platte»).',
    exampleUrl: 'https://www.egger.com/de/moebel-innenausbau/dekore/F206_9',
    fetchTexture: egger.fetchTexture,
  },
  {
    id: 'kronospan',
    name: 'Kronospan',
    domain: 'kronospan.com',
    kind: 'fragment',
    hint: 'Откройте страницу декора Kronodesign на kronospan.com и скопируйте адрес. Kronospan публикует не лист целиком, а фрагмент рисунка.',
    exampleUrl: 'https://kronospan.com/en_EN/decors/view/kronodesign/K001/',
    fetchTexture: kronospan.fetchTexture,
  },
];

function listSources() {
  return SOURCES.map(({ id, name, domain, hint, exampleUrl, kind }) => ({ id, name, domain, hint, exampleUrl, kind }));
}

function getSource(id) {
  return SOURCES.find((s) => s.id === id) || null;
}

module.exports = { SOURCES, listSources, getSource };
