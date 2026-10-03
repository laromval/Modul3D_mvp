// Источник текстур Egger (egger.com): страница декора рендерится сервером,
// изображение листа — первый слайд в первом <egger-imagemediastageelement>.
// Картинка листа портретная: длинная сторона 2800 мм вдоль, 1300 мм поперёк
// (подпись «ca. 2.311 x 1.300 mm» на странице к картинке не относится).

const { CatalogLinkError } = require('../catalogLinkFetch');
const { assertAllowedUrl, fetchHtml, fetchImage } = require('./fetchCore');

const HOSTS = ['egger.com', 'www.egger.com', 'cdn.egger.com'];
const PAGE_HOSTS = ['egger.com', 'www.egger.com'];
const CODE_RE = /^[A-Za-z]?\d+_\d+$/;
const SHEET_RE = /<egger-imagemediastageelement[\s\S]*?<img[^>]*src="(https:\/\/cdn\.egger\.com\/img\/pim\/\d+\/\d+\/original\.png)"/;
const SHEET_LONG_MM = 2800;
const SHEET_SHORT_MM = 1300;

function validatePageUrl(raw) {
  const u = assertAllowedUrl(raw, PAGE_HOSTS, 'Ссылка не ведёт на egger.com — проверьте адрес.');
  const segs = u.pathname.split('/').filter(Boolean);
  const last = segs[segs.length - 1] || '';
  if (!CODE_RE.test(last)) {
    throw new CatalogLinkError('Это не страница декора Egger. Нужен адрес вида egger.com/…/dekore/F206_9.', 400);
  }
  return u;
}

async function fetchTexture(rawUrl, { maxBytes }) {
  const pageUrl = validatePageUrl(rawUrl);
  const { html } = await fetchHtml(pageUrl.toString(), PAGE_HOSTS);
  const m = SHEET_RE.exec(html);
  if (!m) throw new CatalogLinkError('На странице нет изображения листа (вид «Platte»).', 404);
  const pngUrl = m[1].replace(/&amp;/g, '&');

  // Лёгкая JPEG-версия того же листа; если не отдалась — исходный PNG.
  const lightUrl = pngUrl.replace('original.png', 'original.jpg?width=1600&srcext=png');
  let img = null;
  let sourceUrl = lightUrl;
  try {
    img = await fetchImage(lightUrl, HOSTS, maxBytes, { notFoundOk: true });
  } catch (err) {
    if (!(err instanceof CatalogLinkError)) throw err;
    img = null;
  }
  if (!img) {
    img = await fetchImage(pngUrl, HOSTS, maxBytes);
    sourceUrl = pngUrl;
  }

  const result = { buffer: img.buffer, contentType: img.type, kind: 'sheet', sourceUrl };
  const long = Math.max(img.width, img.height);
  const short = Math.min(img.width, img.height);
  if (short > 0) {
    const expected = SHEET_LONG_MM / SHEET_SHORT_MM;
    if (Math.abs(long / short - expected) / expected <= 0.05) {
      result.sheetWidthMm = SHEET_LONG_MM;
      result.sheetHeightMm = SHEET_SHORT_MM;
    }
  }
  return result;
}

module.exports = { fetchTexture, validatePageUrl };
