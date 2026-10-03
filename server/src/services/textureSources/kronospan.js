// Источник текстур Kronospan (kronospan.com): целого листа на сайте нет,
// только фрагмент рисунка (1200x1800), физический масштаб неизвестен.
// Страница: /<lang>/decors/view/kronodesign/<код>/.

const { CatalogLinkError } = require('../catalogLinkFetch');
const { assertAllowedUrl, fetchHtml, fetchImage } = require('./fetchCore');

const HOSTS = ['kronospan.com', 'www.kronospan.com'];
const PATH_RE = /^\/[a-z]{2}_[A-Z]{2}\/decors\/view\/kronodesign\/[^/]+\/?$/;
const DOWNLOAD_RE = /href="(\/[a-z]{2}_[A-Z]{2}\/ajax\/express_services\/download\?args%5B0%5D=decors[^"]+)"/;

function validatePageUrl(raw) {
  const u = assertAllowedUrl(raw, HOSTS, 'Ссылка не ведёт на kronospan.com — проверьте адрес.');
  if (!PATH_RE.test(u.pathname)) {
    throw new CatalogLinkError('Это не страница декора Kronodesign. Нужен адрес вида kronospan.com/en_EN/decors/view/kronodesign/K001/.', 400);
  }
  return u;
}

async function fetchTexture(rawUrl, { maxBytes }) {
  const pageUrl = validatePageUrl(rawUrl);
  const { html, finalUrl } = await fetchHtml(pageUrl.toString(), HOSTS);
  const m = DOWNLOAD_RE.exec(html);
  if (!m) throw new CatalogLinkError('На странице нет изображения декора для скачивания.', 404);

  const downloadUrl = new URL(m[1].replace(/&amp;/g, '&'), finalUrl);
  let img = null;
  let sourceUrl = downloadUrl.toString();
  try {
    img = await fetchImage(sourceUrl, HOSTS, maxBytes, { notFoundOk: true });
  } catch (err) {
    // Для чужого хоста/слишком большого файла fallback не нужен.
    if (!(err instanceof CatalogLinkError) || err.httpStatus === 400 || /слишком большой/.test(err.message)) throw err;
  }

  if (!img) {
    // Запасной прямой адрес: /public/files/decors/kronodesign/<папка>/<код>.jpg
    const folder = downloadUrl.searchParams.get('args[2]');
    const file = downloadUrl.searchParams.get('args[3]');
    if (folder && file && /^[\w.-]+$/.test(folder) && /^[\w.-]+$/.test(file)) {
      sourceUrl = `https://kronospan.com/public/files/decors/kronodesign/${folder}/${file}`;
      img = await fetchImage(sourceUrl, HOSTS, maxBytes);
    } else {
      throw new CatalogLinkError('Не удалось скачать изображение декора.', 502);
    }
  }
  return { buffer: img.buffer, contentType: img.type, kind: 'fragment', sourceUrl };
}

module.exports = { fetchTexture, validatePageUrl };
