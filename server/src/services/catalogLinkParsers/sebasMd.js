// Парсер страницы товара sebas.md (WordPress + WooCommerce, SEO-разметка от
// Yoast/RankMath) — см. ТЗ-ПАРСЕР-МАТЕРИАЛОВ.md, разделы 1, 2, 4. Как и
// mobilierMd.js/daskCentruMd.js, разбирает уже скачанный HTML (скачивание —
// в ../catalogLinkFetch.js), сам сети не касается.
//
// Источники данных на странице (проверено на 4 реальных страницах товара,
// 2026-09-15: петля Blum, ручка-кнопка Giusti, опора-бистро Eroglu со
// скидкой — разные категории и бренды):
//
//   - <script type="application/ld+json"> — ОДИН блок на странице, но
//     устроен как @graph (массив разнотипных объектов: WebPage,
//     ImageObject, BreadcrumbList, WebSite, Organization) плюс ВТОРОЙ,
//     отдельный <script> с "@type":"Product" — оба блока разбираем через
//     findAllByType(), который умеет искать и на верхнем уровне, и внутри
//     "@graph" (устойчивее к тому, что разные версии Yoast/RankMath иногда
//     кладут Product тоже внутрь "@graph").
//   - Product.offers — МАССИВ (не один объект, как на mobilier.md/
//     dask-centru.md). У обычного (без вариаций) товара цена лежит ещё на
//     уровень глубже, в offers[0].priceSpecification[0].price/priceCurrency
//     (см. firstOffer()/offerPrice()/offerCurrency()). Для товара со скидкой
//     (проверено на опоре Eroglu) offers[0].priceSpecification[0].price
//     корректно равен ТЕКУЩЕЙ (акционной) цене, а не старой — это уже
//     готовая логика на стороне сайта, повторно её не считаем.
//   - У ВАРИАТИВНОГО товара (проверено на живой странице петли Blum,
//     https://sebas.md/shop/balama-155-clip-top-blumotion-blum/, с
//     вариантами по атрибуту "Montare ușă: Aplicată/Semiaplicată" — разная
//     цена по вариантам) offers[0] устроен иначе:
//     "@type":"AggregateOffer" с lowPrice/highPrice/offerCount прямо на
//     самом объекте (price/priceSpecification там нет вообще). Берём
//     lowPrice как цену (см. offerPriceRange()) — это настоящее число с
//     сайта, не выдумка, — но ЧЕСТНО помечаем черновик как диапазон через
//     draft.priceNote (тот же паттерн поля черновика, что уже используют
//     "приближённые"/"ориентировочные" цены в src/catalog.js и умеет
//     показывать src/app.js), чтобы на экране подтверждения пользователь не
//     принял нижнюю границу диапазона за точную цену конкретного варианта.
//   - Product.sku — это ВСЕГДА внутренний числовой ID товара WordPress
//     (например у товара с явным полем "Артикул: Н/Д" на самой странице
//     JSON-LD sku всё равно содержит число) — НЕ реальный артикул, не
//     используем как article.
//   - Таблица `table.woocommerce-product-attributes` (стандартная
//     WooCommerce-разметка характеристик, `<tr><th>Метка</th><td><p>Значение
//     </p></td></tr>`) — единственный надёжный источник:
//       - "Брэнд" -> brand. Проверено на 3 разных брендах (BLUM/GIUSTI/
//         EROGLU) — везде совпадает с брендом, вынесенным через точку в
//         конец названия товара ("...BLUMOTION 110°. BLUM" и т.п.), то есть
//         оба источника согласуются — берём структурированный, он надёжнее
//         регэкспа по названию.
//       - "Код" -> см. КРУПНЫЙ НЮАНС про article ниже — берём как fallback,
//         не как основной источник.
//     Таблица присутствует на странице ДВАЖДЫ (то же самое, что и на
//     dask-centru.md) — читаем только первую (`.first()`), значения там же.
//   - `.sku_wrapper .sku` — родное поле WooCommerce "Артикул" (если
//     заполнено продавцом). Пусто/не рендерится вовсе для petli/ручек в
//     наших примерах; для опоры Eroglu отрендерилось, но с текстом-
//     заглушкой "Н/Д" ("не заполнено") — такое трактуем как отсутствие
//     артикула, не как реальное значение "Н/Д". На петле Blum (см. ссылку
//     выше) та же заглушка, но по-румынски — сайт румыноязычный
//     (`lang="ro-RO"`), там `<span class="sku">Nu se aplică</span>`
//     ("не применимо" — тот же стандартный вывод WooCommerce для
//     незаполненного SKU) — тоже трактуем как отсутствие артикула (см.
//     extractNativeSku()).
//
// ==========================================================================
// ВАЖНЫЙ НЮАНС — article (артикул) на этом сайте НЕ извлекается надёжно ни
// из одного источника с гарантией, что это именно ПОЛНЫЙ номер детали
// производителя:
//   - `.sku_wrapper .sku` (родной WooCommerce SKU) — часто вообще не
//     заполнен продавцом (пусто/"Н/Д").
//   - Атрибут "Код" в таблице характеристик — его смысл РАЗНЫЙ у разных
//     категорий: для петли Blum он был "70T7550.TL" (похоже на полный
//     артикул производителя), а для ручки Giusti — "192" (явно НЕ совпадает
//     с полным кодом "WPO794.000.001C" из названия товара, похоже на
//     внутренний короткий код/базовую модель без цветового суффикса — тот
//     отдельно лежит в "Код цвета").
//   Поэтому article достаём двухступенчато (сначала родной SKU, если не
//   заглушка, иначе — атрибут "Код"), но ЧЕСТНО предупреждаем: для
//   некоторых категорий (замечено на ручках) это может быть НЕ полный
//   артикул производителя, а частичный/внутренний код — экран
//   подтверждения на клиенте (раздел 1, п.5 ТЗ) обязателен для проверки
//   пользователем, это НЕ автоматическая истина.
// ==========================================================================
//
// ==========================================================================
// ВАЖНЫЙ НЮАНС — categoryPath НЕ извлекается для этого сайта вообще:
//   - Видимый JSON-LD BreadcrumbList всегда даёт общий путь вида "Главная
//     > Produse > <товар>" — "Produse" это служебная страница магазина
//     WooCommerce, а не реальная категория товара, бесполезно.
//   - Категории WooCommerce (`.product_meta .posted_in a`) — это ПЛОСКИЙ
//     список назначенных товару категорий, а не путь по дереву: (1) туда
//     иногда подмешивается служебная категория "новые продукты", не
//     имеющая отношения к типу товара; (2) на реальном примере (опора
//     Eroglu) категории "Мебельные опоры" и "Опоры бистро" НЕ вложены друг
//     в друга (это два независимых верхнеуровневых раздела по ссылкам по
//     факту), то есть список вообще не образует единую иерархию "тип
//     материала -> бренд", как того требует раздел 3.3 ТЗ. Строить
//     categoryPath из этого списка значило бы показывать пользователю
//     придуманную иерархию, которой на сайте нет — решили НЕ делать этого
//     (см. итоговое сообщение агента), поле просто не заполняется.
// ==========================================================================
//
// unit: сайт продаёт только штучную фурнитуру (петли/ручки/опоры/
// полкодержатели и т.п., без листовых материалов) — своего поля "единица
// измерения" на странице товара не нашли ни в одной категории, поэтому по
// умолчанию 'шт' (см. normalizeUnit ниже — если вдруг для каких-то будущих
// категорий появится атрибут с явной единицей измерения, распознаём его,
// иначе используем дефолт, ничего не выдумывая сверх этого).

const cheerio = require('cheerio');

/** В отличие от mobilier.md/dask-centru.md, на sebas.md запятая в видимой
 * цене — это разделитель ТЫСЯЧ, а не десятичный разделитель (пример:
 * "1,034.00 MDL" = 1034.00, не 1.034). Все проверенные примеры (128.00,
 * 64.00, 665.00, 1,034.00) используют точку как десятичный разделитель —
 * поэтому запятые просто убираем, а не заменяем на точку. JSON-LD price
 * (основной источник цены) и так уже приходит в чистом виде ("665.00"),
 * это в первую очередь fallback-парсер для видимого текста. */
function toNumber(str) {
  if (str === null || str === undefined) return null;
  const normalized = String(str).replace(/\s+/g, '').replace(/,/g, '');
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = parseFloat(match[0]);
  return Number.isFinite(n) ? n : null;
}

/** См. daskCentruMd.normalizeUnit — тот же принцип, дефолт 'шт' (сайт
 * продаёт только штучную фурнитуру, см. комментарий вверху файла). */
function normalizeUnit(raw) {
  if (!raw) return 'шт';
  const clean = raw.trim().toLowerCase();
  if (clean.includes('м2') || clean.includes('м²') || clean.includes('кв')) return 'м²';
  if (clean.includes('м/п') || clean.includes('пог')) return 'пог.м';
  if (clean.includes('шт') || clean.includes('к-т') || clean.includes('компл')) return 'шт';
  return raw.trim();
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

/** Ищет объекты заданного "@type" и на верхнем уровне списка JSON-LD
 * блоков, и внутри "@graph" каждого блока (см. комментарий вверху файла —
 * на этом сайте Product и BreadcrumbList лежат в разных местах). */
function findAllByType(blocks, type) {
  const results = [];
  blocks.forEach((b) => {
    if (!b) return;
    if (b['@type'] === type) results.push(b);
    if (Array.isArray(b['@graph'])) {
      b['@graph'].forEach((x) => {
        if (x && x['@type'] === type) results.push(x);
      });
    }
  });
  return results;
}

/** Product.offers — массив на этом сайте (см. комментарий вверху файла).
 * Берём первый оффер — на простых (не вариативных) товарах он единственный. */
function firstOffer(product) {
  if (!product || !product.offers) return null;
  return Array.isArray(product.offers) ? (product.offers[0] || null) : product.offers;
}

function offerPrice(offer) {
  if (!offer) return null;
  if (offer.price != null) return toNumber(offer.price);
  if (Array.isArray(offer.priceSpecification) && offer.priceSpecification[0]
    && offer.priceSpecification[0].price != null) {
    return toNumber(offer.priceSpecification[0].price);
  }
  return null;
}

/** Вариативный товар (несколько опций типа "Montare ușă: Aplicată/
 * Semiaplicată" с разной ценой каждая, проверено на живой странице петли
 * Blum) — вместо обычного Offer/price там "@type":"AggregateOffer" с
 * lowPrice/highPrice/offerCount прямо на самом объекте (см. комментарий
 * вверху файла). Возвращает { low, high, offerCount } (числа/null), если
 * это похоже на такой диапазон (есть хотя бы lowPrice), иначе null —
 * offerPrice() тогда отрабатывает как обычно для простого товара. */
function offerPriceRange(offer) {
  if (!offer || offer.lowPrice == null) return null;
  const low = toNumber(offer.lowPrice);
  if (low == null) return null;
  const high = offer.highPrice != null ? toNumber(offer.highPrice) : null;
  const offerCount = Number(offer.offerCount);
  return { low, high, offerCount: Number.isFinite(offerCount) ? offerCount : null };
}

/** Черновик должен ЧЕСТНО показать, что цена — нижняя граница диапазона по
 * нескольким вариантам товара, а не точная цена (см. комментарий вверху
 * файла) — переиспользуем поле draft.priceNote, тот же паттерн черновика,
 * что уже используют "приближённые"/"ориентировочные" цены в
 * src/catalog.js (умеет отображать src/app.js). Возвращает null, если
 * диапазона нет (обычный товар с фиксированной ценой). */
function buildPriceRangeNote(range, currency) {
  if (!range) return null;
  if (range.high != null && range.high !== range.low) {
    const countText = range.offerCount ? `, вариантов: ${range.offerCount}` : '';
    return `показана по нижней границе диапазона на сайте (от ${range.low} до ${range.high} `
      + `${currency}${countText}) — у товара есть варианты с разной ценой, уточните точную`
      + ' цену нужного варианта';
  }
  return 'показана по данным сайта для товара с несколькими вариантами — уточните точную'
    + ' цену нужного варианта';
}

function offerCurrency(offer) {
  if (!offer) return null;
  if (offer.priceCurrency) return offer.priceCurrency;
  if (Array.isArray(offer.priceSpecification) && offer.priceSpecification[0]
    && offer.priceSpecification[0].priceCurrency) {
    return offer.priceSpecification[0].priceCurrency;
  }
  return null;
}

/** offers.availability из schema.org -> boolean|null (см. mobilierMd.js —
 * тот же приём, независимая копия). */
function extractInStock(offer) {
  if (!offer || typeof offer.availability !== 'string') return null;
  const a = offer.availability.toLowerCase();
  if (a.includes('instock') || a.includes('preorder') || a.includes('limitedavailability')) return true;
  if (a.includes('outofstock') || a.includes('discontinued') || a.includes('soldout')) return false;
  return null;
}

/**
 * Читает первую (единственную нужную — см. комментарий вверху файла)
 * таблицу `table.woocommerce-product-attributes` в карту "метка ->
 * значение". Стандартная WooCommerce-разметка: `<tr><th>Метка</th>
 * <td><p>Значение</p></td></tr>`.
 */
function readAttributesTable($) {
  const map = {};
  $('.woocommerce-product-attributes').first().find('tr').each((_, tr) => {
    const label = $(tr).find('th').first().text().replace(/\s+/g, ' ').trim();
    const value = $(tr).find('td').first().text().replace(/\s+/g, ' ').trim();
    if (label && value && !(label in map)) {
      map[label] = value;
    }
  });
  return map;
}

function pick(map, candidates) {
  for (const c of candidates) {
    if (Object.prototype.hasOwnProperty.call(map, c)) return map[c];
  }
  const lower = {};
  Object.keys(map).forEach((k) => {
    lower[k.toLowerCase()] = map[k];
  });
  for (const c of candidates) {
    const v = lower[c.toLowerCase()];
    if (v != null) return v;
  }
  return null;
}

/** Родное поле WooCommerce "Артикул" (`.sku_wrapper .sku`). Возвращает
 * null, если элемента нет на странице ИЛИ там текст-заглушка вида "Н/Д"/
 * "N/A"/"-"/румынское "Nu se aplică" ("не применимо" — сайт румыноязычный,
 * `lang="ro-RO"`, тот же стандартный вывод WooCommerce для незаполненного
 * SKU, проверено на живой странице петли Blum) — продавец не заполнил
 * поле, см. комментарий вверху файла. Диакритику ("ă") делаем необязательной
 * в регэкспе на случай расхождений в кодировке между страницами. */
function extractNativeSku($) {
  const raw = $('.sku_wrapper .sku').first().text().replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  if (/^(н\/?д|n\/?a|-|—|nu se aplic[ăa])$/i.test(raw)) return null;
  return raw;
}

/** Видимая цена товара как fallback, если её нет в JSON-LD. Для товара со
 * скидкой WooCommerce рендерит и старую (`<del>`), и текущую (`<ins>`)
 * цену внутри одного `p.price` — берём именно `<ins>`, если она есть,
 * иначе первую найденную (товар без скидки). Область поиска — `.summary`
 * (блок карточки самого товара), чтобы не подцепить цены сопутствующих/
 * похожих товаров ниже на странице (у них другая разметка — `span.price`
 * внутри `span.price-wrapper`, не `p.price`, но на всякий случай всё равно
 * ограничиваем область поиска). */
function extractVisiblePrice($) {
  const scope = $('.summary').first();
  const insText = scope.find('p.price ins .woocommerce-Price-amount').first().text();
  if (insText) return toNumber(insText);
  const plainText = scope.find('p.price .woocommerce-Price-amount').first().text();
  if (plainText) return toNumber(plainText);
  return null;
}

/**
 * Парсит HTML страницы товара sebas.md в черновой объект для экрана
 * подтверждения на клиенте (см. mobilierMd.js — тот же контракт полей, но
 * без categoryPath — см. комментарий вверху файла).
 *
 * @param {string} html
 * @param {string} sourceUrl
 * @returns {object} черновик товара.
 * @throws {Error} с `.code = 'PARSE_FAILED'`, если не нашлись название или
 *   цена.
 */
function parse(html, sourceUrl) {
  const $ = cheerio.load(html);
  const blocks = readJsonLdBlocks($);
  const product = findAllByType(blocks, 'Product')[0] || null;
  const attrMap = readAttributesTable($);

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

  const offer = firstOffer(product);
  const priceRange = offerPriceRange(offer);
  let price = priceRange ? priceRange.low : offerPrice(offer);
  if (price == null) {
    price = extractVisiblePrice($);
  }

  if (price == null) {
    const err = new Error('Не удалось найти цену товара на странице.');
    err.code = 'PARSE_FAILED';
    throw err;
  }

  const currency = offerCurrency(offer) || 'MDL';
  const priceNote = buildPriceRangeNote(priceRange, currency);

  const unitRaw = pick(attrMap, ['Единица измерения']);
  const unit = normalizeUnit(unitRaw);

  const brand = pick(attrMap, ['Брэнд', 'Бренд', 'Brand']) || null;

  // article — см. "ВАЖНЫЙ НЮАНС" вверху файла: сначала родной WooCommerce
  // SKU (если реально заполнен), иначе атрибут "Код"/"Артикул" из таблицы
  // характеристик (может оказаться неполным для некоторых категорий).
  const article = extractNativeSku($) || pick(attrMap, ['Код', 'Артикул', 'Cod', 'SKU']) || null;

  let imageUrl = null;
  if (product && typeof product.image === 'string' && product.image) {
    imageUrl = product.image;
  }
  if (!imageUrl) {
    imageUrl = $('meta[property="og:image"]').attr('content') || null;
  }

  const inStock = extractInStock(offer);

  const draft = {
    name,
    price,
    currency,
    unit,
    sourceUrl,
  };
  if (imageUrl) draft.imageUrl = imageUrl;
  if (article) draft.article = article;
  if (brand) draft.brand = brand;
  if (inStock != null) draft.inStock = inStock;
  if (priceNote) draft.priceNote = priceNote;
  // categoryPath сознательно не заполняем — см. комментарий вверху файла.
  // sheetW/sheetH/thickness тоже не заполняем — сайт продаёт только
  // штучную фурнитуру, полей с размерами листа на странице нет.

  return draft;
}

module.exports = {
  parse, toNumber, normalizeUnit, extractNativeSku, offerPriceRange, buildPriceRangeNote,
};
