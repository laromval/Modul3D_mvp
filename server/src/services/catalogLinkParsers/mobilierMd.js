// Парсер страницы товара mobilier.md (см. ТЗ-ПАРСЕР-МАТЕРИАЛОВ.md, разделы
// 1, 2, 4). Разбирает HTML уже скачанной страницы (скачивание — в
// ../catalogLinkFetch.js, этот модуль не делает сетевых запросов сам, чтобы
// его можно было легко покрыть тестами на сохранённом HTML).
//
// Источники данных на странице (проверено на реальных страницах товара,
// см. примеры ниже) — используем структурированные данные (JSON-LD), где
// они есть, они устойчивее к небольшим правкам вёрстки, чем текстовые
// селекторы:
//   - <script type="application/ld+json"> с "@type":"Product" — name, sku
//     (внутренний numeric id магазина, НЕ артикул производителя), image[],
//     brand.name, offers.price, offers.priceCurrency, offers.availability.
//   - <script type="application/ld+json"> с "@type":"BreadcrumbList" —
//     хлебные крошки. Последний элемент списка обычно не имеет поля "item"
//     (это сам товар, а не ссылка на категорию) — исключаем его вместе с
//     первым элементом (корень сайта "Mobilier"), остальное — categoryPath.
//   - <p class="product-model">Cod produs: <АРТИКУЛ></p> — артикул
//     производителя (не то же самое, что JSON-LD "sku" — это внутренний ID
//     магазина). Пример: "Cod produs: H1180ST37".
//   - <div class="product-price"><div class="price-new">610,00<b
//     class="symbol"> mdl</b><span class="unit-price">/m²</span></div></div>
//     — видимая цена (используется как fallback, если её нет в JSON-LD, и
//     как единственный источник единицы измерения — schema.org Offer не
//     даёт "за м²/пог.м/шт").
//
// Проверено на трёх реальных страницах (2026-09-15): лист ЛДСП (декор),
// фурнитура (ручка), столешница постформинг (погонный метр) — см.
// комментарии внутри extractSheetDims/normalizeUnit.

const cheerio = require('cheerio');

/** Достаёт первое число из строки, понимает и точку, и запятую как
 * десятичный разделитель (сайт использует оба варианта в разных местах:
 * "610,00" в цене, "18.6" в названии). */
function toNumber(str) {
  if (str === null || str === undefined) return null;
  const normalized = String(str).replace(/\s+/g, '').replace(/,/g, '.');
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = parseFloat(match[0]);
  return Number.isFinite(n) ? n : null;
}

/** Нормализует суффикс единицы измерения из ".unit-price" (напр. "/m²",
 * "/ml") к тем же обозначениям, что использует src/catalog.js. Если
 * суффикс не распознан — возвращает его как есть (без слэша), не гадая. */
function normalizeUnit(rawUnitSuffix) {
  if (!rawUnitSuffix) return 'шт';
  const clean = rawUnitSuffix.replace(/^\//, '').trim().toLowerCase();
  if (['m2', 'm²', 'mp', 'м2', 'м²'].includes(clean)) return 'м²';
  if (['ml', 'мл', 'm', 'м'].includes(clean)) return 'пог.м';
  if (['buc', 'bucata', 'pcs', 'шт'].includes(clean)) return 'шт';
  return rawUnitSuffix.replace(/^\//, '').trim();
}

/**
 * Достаёт из названия товара пару (или тройку) чисел вида "2800x2070x18.6"
 * или "4100x600" — единственное место на странице, где вообще встречаются
 * физические размеры (структурированной таблицы характеристик на сайте
 * нет). ВАЖНО: смысл этих двух чисел зависит от типа товара и НЕ
 * определяется этим парсером — для листовых декоров это обычно
 * ширина/высота листа, а для столешниц (продаются погонным метром) первое
 * число — это максимальная длина поставки, второе — фиксированная глубина
 * полосы (не второе "измерение листа"). Поля всё равно называются
 * sheetW/sheetH по контракту с клиентом (см. ТЗ-ПАРСЕР-МАТЕРИАЛОВ.md,
 * раздел 4) — это ЧЕРНОВИК для экрана подтверждения (раздел 1, п.5),
 * пользователь и клиентская форма должны трактовать/поправить их по
 * категории товара, сервер этого не решает.
 */
function extractSheetDims(title) {
  if (!title) return { sheetW: null, sheetH: null, thickness: null };
  const m = title.match(
    /(\d{2,5}(?:[.,]\d+)?)\s*[x×х]\s*(\d{2,5}(?:[.,]\d+)?)(?:\s*[x×х]\s*(\d{1,3}(?:[.,]\d+)?))?/i
  );
  if (!m) return { sheetW: null, sheetH: null, thickness: null };
  return {
    sheetW: toNumber(m[1]),
    sheetH: toNumber(m[2]),
    thickness: m[3] ? toNumber(m[3]) : null,
  };
}

function readJsonLdBlocks($) {
  const blocks = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw || !raw.trim()) return;
    try {
      blocks.push(JSON.parse(raw));
    } catch (_) {
      // Битый/нестандартный JSON-LD — просто пропускаем этот блок.
    }
  });
  return blocks;
}

function findByType(blocks, type) {
  return blocks.find((b) => b && b['@type'] === type) || null;
}

/** Хлебные крошки -> черновой categoryPath (см. ТЗ, раздел 3.3). Первый
 * элемент (корень сайта) и последний (сам товар, без поля "item") в путь
 * категории не входят. Возвращает null, если крошек нет в вёрстке или
 * после отсечения не осталось ни одного сегмента — раздел 4 требует именно
 * не возвращать поле, а не выдумывать его. */
function extractCategoryPath(breadcrumbBlock) {
  if (!breadcrumbBlock || !Array.isArray(breadcrumbBlock.itemListElement)) return null;
  const items = breadcrumbBlock.itemListElement;
  if (items.length === 0) return null;

  const withoutRoot = items.slice(1);
  const last = withoutRoot[withoutRoot.length - 1];
  const withoutProduct = last && !last.item ? withoutRoot.slice(0, -1) : withoutRoot;

  const path = withoutProduct
    .map((it) => (typeof it.name === 'string' ? it.name.trim() : ''))
    .filter(Boolean);

  return path.length > 0 ? path : null;
}

/** offers.availability из schema.org ("https://schema.org/InStock" и т.п.)
 * -> boolean|null. Полезно для батч-обновления цен (раздел 1, п.8) —
 * позволяет отличить "товар сняли с продажи" от обычного успешного
 * обновления. Не часть буквального списка полей из ТЗ, добавлено
 * дополнительно (см. итоговое сообщение агента). */
function extractInStock(offers) {
  if (!offers || typeof offers.availability !== 'string') return null;
  const a = offers.availability.toLowerCase();
  if (a.includes('instock') || a.includes('preorder') || a.includes('limitedavailability')) return true;
  if (a.includes('outofstock') || a.includes('discontinued') || a.includes('soldout')) return false;
  return null;
}

/**
 * Парсит HTML страницы товара mobilier.md в черновой объект для экрана
 * подтверждения на клиенте (раздел 1, п.4-5 ТЗ). Ничего не сохраняет и не
 * валидирует бизнес-смысл полей — только достаёт то, что реально есть на
 * странице.
 *
 * @param {string} html
 * @param {string} sourceUrl — итоговый URL страницы (после разрешённых
 *   редиректов на том же домене, см. catalogLinkFetch.js), возвращается в
 *   черновике как есть, чтобы клиент мог сохранить именно его.
 * @returns {object} черновик товара (см. поля ниже).
 * @throws {Error} с `.code = 'PARSE_FAILED'`, если на странице не нашлось
 *   даже названия/цены — это единственные обязательные поля, без них черновик
 *   бессмысленен (вероятно, это не страница товара или вёрстка изменилась).
 */
function parse(html, sourceUrl) {
  const $ = cheerio.load(html);
  const blocks = readJsonLdBlocks($);
  const product = findByType(blocks, 'Product');
  const breadcrumb = findByType(blocks, 'BreadcrumbList');

  const name = (product && typeof product.name === 'string' && product.name.trim())
    || $('h1').first().text().trim()
    || null;

  if (!name) {
    const err = new Error(
      'Не удалось найти название товара на странице — возможно, это не страница товара или изменилась вёрстка сайта.'
    );
    err.code = 'PARSE_FAILED';
    throw err;
  }

  let price = null;
  if (product && product.offers && product.offers.price != null) {
    price = toNumber(product.offers.price);
  }
  const priceBlockText = $('.product-price .price-new').first().text()
    || $('.product-price .price').first().text()
    || $('.product-price').first().text();
  if (price == null) {
    price = toNumber(priceBlockText);
  }

  if (price == null) {
    const err = new Error('Не удалось найти цену товара на странице.');
    err.code = 'PARSE_FAILED';
    throw err;
  }

  // Валюта — с этого сайта продажи только в MDL (молдавский лей), JSON-LD
  // это подтверждает (offers.priceCurrency), поэтому дефолт безопасен и для
  // страниц без блока Product.
  const currency = (product && product.offers && product.offers.priceCurrency) || 'MDL';

  const unitSuffix = $('.product-price .unit-price').first().text().trim() || null;
  const unit = normalizeUnit(unitSuffix);

  const articleMatch = $('.product-model').first().text().match(/Cod\s+produs:\s*(.+)/i);
  const article = articleMatch ? articleMatch[1].trim() : null;

  let imageUrl = null;
  if (product && Array.isArray(product.image) && product.image.length > 0) {
    imageUrl = product.image[0];
  }
  if (!imageUrl) {
    imageUrl = $('meta[property="og:image"]').attr('content') || null;
  }

  // brand — не входит в буквальный список полей из ТЗ (раздел 4), добавлено
  // дополнительно: JSON-LD даёт его напрямую и надёжнее, чем предположение
  // "последний сегмент хлебных крошек = бренд" (для фурнитуры это не так —
  // проверено на реальной странице ручки: крошки заканчиваются стилем
  // "Modern", а JSON-LD brand.name = "GTV"). Полезно клиенту для п.3.3
  // ТЗ (предложить создать подкатегорию под бренд).
  const brand = (product && product.brand && typeof product.brand.name === 'string')
    ? product.brand.name.trim()
    : null;

  const categoryPath = extractCategoryPath(breadcrumb);
  const inStock = product ? extractInStock(product.offers) : null;

  const { sheetW, sheetH, thickness } = extractSheetDims(name);

  const draft = {
    name,
    price,
    currency,
    unit,
    sourceUrl,
  };
  if (sheetW != null) draft.sheetW = sheetW;
  if (sheetH != null) draft.sheetH = sheetH;
  if (thickness != null) draft.thickness = thickness;
  if (imageUrl) draft.imageUrl = imageUrl;
  if (article) draft.article = article;
  if (brand) draft.brand = brand;
  if (categoryPath) draft.categoryPath = categoryPath;
  if (inStock != null) draft.inStock = inStock;

  return draft;
}

module.exports = { parse, toNumber, normalizeUnit, extractSheetDims, extractCategoryPath };
