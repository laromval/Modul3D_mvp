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
//   - `<form class="variations_form cart" data-product_variations="[...]">` —
//     у ВАРИАТИВНОГО товара на странице лежит ещё и ПОЛНЫЙ список комбинаций
//     с их точными ценами (стандартный вывод WooCommerce; проверено на живой
//     странице https://sebas.md/ru/shop/opora-konusoobraznaya-reguliruemaya-
//     ozkardesler/ — 12 комбинаций H x Цвет, у которых AggregateOffer.lowPrice
//     = 19 MDL, а реальная цена, например, H=100 + Сатин = 31.00 MDL). Это
//     решает проблему нижней границы диапазона выше: сам draft.price
//     по-прежнему lowPrice (и priceNote по-прежнему выставляется), но рядом
//     кладётся draft.variants (см. extractVariants()) — клиент показывает
//     селекты, пользователь выбирает комбинацию, и клиент подставляет её
//     точную цену вместо нижней границы. Значение атрибута — HTML-
//     экранированный (`&quot;`) JSON, cheerio через .attr() отдаёт его уже
//     раскодированным, отдельный html-decode не нужен (JSON.parse всё равно
//     в try/catch — битую разметку молча игнорируем).
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

/** Отсев текстов-заглушек WooCommerce для незаполненного продавцом SKU:
 * "Н/Д"/"N/A"/"-"/румынское "Nu se aplică" ("не применимо" — сайт
 * румыноязычный, `lang="ro-RO"`, тот же стандартный вывод WooCommerce,
 * проверено на живой странице петли Blum). Диакритику ("ă") делаем
 * необязательной в регэкспе на случай расхождений в кодировке между
 * страницами. Возвращает очищенную строку или null. Общий helper для
 * артикула самого товара (extractNativeSku) и артикулов отдельных
 * комбинаций (extractVariants) — правило отсева должно быть одно. */
function cleanSku(raw) {
  if (raw === null || raw === undefined) return null;
  const clean = String(raw).replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (/^(н\/?д|n\/?a|-|—|nu se aplic[ăa])$/i.test(clean)) return null;
  return clean;
}

/** Родное поле WooCommerce "Артикул" (`.sku_wrapper .sku`). Возвращает
 * null, если элемента нет на странице ИЛИ там текст-заглушка (см.
 * cleanSku) — продавец не заполнил поле, см. комментарий вверху файла. */
function extractNativeSku($) {
  return cleanSku($('.sku_wrapper .sku').first().text());
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

/** Цена комбинации из её `price_html` — запасной источник, когда в JSON нет
 * числового `display_price`. Разметка там та же, что у видимой цены товара:
 * у варианта со скидкой внутри лежат и старая (`<del>`), и текущая (`<ins>`)
 * цена, поэтому при наличии `<ins>` берём ЕЁ, иначе весь текст (вариант без
 * скидки) — иначе первым числом в строке оказалась бы старая цена. Теги
 * вырезаем, `&nbsp;` и валюту toNumber() игнорирует сам (он выбирает первое
 * число, корректно понимая "1,034.00" как 1034 — запятая на ЭТОМ сайте
 * разделяет тысячи, см. комментарий у toNumber; если когда-нибудь появится
 * страница с десятичной запятой ("42,00"), это место даст 4200 и парсер
 * придётся учить различать оба формата — сейчас все проверенные страницы
 * используют точку). */
function priceFromVariationHtml(html) {
  if (typeof html !== 'string' || !html) return null;
  const ins = html.match(/<ins[^>]*>([\s\S]*?)<\/ins>/i);
  const chunk = ins ? ins[1] : html;
  return toNumber(chunk.replace(/<[^>]*>/g, ' '));
}

/**
 * Разбирает вариативный товар WooCommerce: комбинации с их ТОЧНЫМИ ценами
 * (`form.variations_form[data-product_variations]`) плюс человекочитаемые
 * метки атрибутов и опций (селекты той же формы) — см. комментарий вверху
 * файла.
 *
 * Возвращает `{ attributes, items }` либо null. null — это штатная ситуация,
 * а не ошибка, во ВСЕХ следующих случаях (парсер тогда ведёт себя как
 * раньше: draft.price = lowPrice + draft.priceNote, поля variants нет):
 *   - товар не вариативный (формы на странице нет вовсе);
 *   - вариантов больше порога WooCommerce (по умолчанию 30) — тогда сайт
 *     штатно рендерит `data-product_variations="false"`, самих комбинаций в
 *     HTML нет, они догружаются аяксом (в сеть мы не ходим);
 *   - JSON битый/не массив/пустой — молча игнорируем, исключений наружу не
 *     выпускаем;
 *   - не распознались ни атрибуты, ни одна цена (нечего показывать клиенту).
 *
 * Структура (ключи `attributes[].id` СОВПАДАЮТ с ключами `items[].values` и
 * со значением `name` у соответствующего селекта — на этом строится
 * сопоставление выбора пользователя с комбинацией на клиенте):
 *   attributes: [{ id: 'attribute_pa_h-%d0%bc%d0%bc', label: 'H, мм',
 *                  options: [{ value: '100', label: '100' }, ...] }]
 *   items:      [{ id, values, price, inStock, article, imageUrl? }]
 *
 * Нюансы, специально сохранённые «как есть»:
 *   - значения атрибутов — percent-encoded слаги WooCommerce (кириллица:
 *     '%d1%85%d1%80%d0%be%d0%bc' = "хром"). НЕ декодируем: это ключи, они
 *     должны один-в-один совпадать с `<option value="...">`, по которым
 *     клиент ищет комбинацию;
 *   - пустая строка в значении атрибута комбинации — штатное "любой"
 *     WooCommerce (комбинация подходит при ЛЮБОМ значении этого атрибута).
 *     Такие комбинации НЕ выбрасываем, пустое значение сохраняем как есть —
 *     сопоставлять с выбором пользователя (пустое = подходит всё) должен
 *     клиент;
 *   - пустая опция селекта ("Выбрать опцию", value="") — это плейсхолдер, а
 *     не вариант, её в options не кладём;
 *   - комбинации без цены (ни display_price, ни разборчивого price_html)
 *     тоже НЕ выбрасываем: клиент покажет такой вариант в списке, но
 *     подставить цену не сможет (price = null) — честнее, чем молча скрыть
 *     существующий на сайте вариант.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @param {string|null} mainImageUrl основное фото товара — фото варианта
 *   кладём в items[].imageUrl, только если оно ОТЛИЧАЕТСЯ от основного
 *   (WooCommerce дублирует основное фото во всех комбинациях, где у варианта
 *   своей картинки нет).
 * @returns {{attributes: Array, items: Array}|null}
 */
function extractVariants($, mainImageUrl) {
  const form = $('form.variations_form').first();
  if (!form.length) return null;

  const raw = form.attr('data-product_variations');
  if (!raw || raw === 'false') return null;

  let list = null;
  try {
    list = JSON.parse(raw);
  } catch (_) {
    return null; // Битый JSON — ведём себя как для обычного товара.
  }
  if (!Array.isArray(list) || !list.length) return null;

  // Атрибуты — в том же порядке, в каком селекты идут на странице.
  const attributes = [];
  const seenAttr = new Set();
  form.find('select[name^="attribute_"]').each((_, el) => {
    const sel = $(el);
    const id = sel.attr('name');
    if (!id || seenAttr.has(id)) return;
    seenAttr.add(id);

    // Метка: стандартная разметка WooCommerce — `<tr><th class="label">
    // <label for="pa_...">H, мм</label></th><td><select ...>`. Берём метку
    // из строки таблицы, где лежит сам селект; запасной вариант — поиск
    // <label for> по значению атрибута (без CSS-селектора: в for/name есть
    // '%', экранировать его в селекторе неудобно и легко ошибиться). Если
    // метки нет вообще — оставляем слаг, он хотя бы различает атрибуты.
    const forId = id.replace(/^attribute_/, '');
    let label = sel.closest('tr').find('th label').first().text().replace(/\s+/g, ' ').trim();
    if (!label) {
      label = form.find('label').filter((__, l) => $(l).attr('for') === forId)
        .first().text().replace(/\s+/g, ' ').trim();
    }
    if (!label) label = forId;

    const options = [];
    sel.find('option').each((__, o) => {
      const value = $(o).attr('value');
      if (!value) return; // "Выбрать опцию" (value="") — плейсхолдер.
      const optLabel = $(o).text().replace(/\s+/g, ' ').trim() || value;
      options.push({ value, label: optLabel });
    });
    if (!options.length) return;

    attributes.push({ id, label, options });
  });

  const items = [];
  list.forEach((v) => {
    if (!v || typeof v !== 'object') return;

    const values = {};
    const attrs = (v.attributes && typeof v.attributes === 'object') ? v.attributes : {};
    Object.keys(attrs).forEach((k) => {
      const val = attrs[k];
      // Пустая строка = "любой" (см. описание функции), сохраняем как есть.
      values[k] = (val === null || val === undefined) ? '' : String(val);
    });
    if (!Object.keys(values).length) return;

    let price = v.display_price != null ? toNumber(v.display_price) : null;
    if (price == null) price = priceFromVariationHtml(v.price_html);

    const idNum = Number(v.variation_id);
    const item = {
      id: Number.isFinite(idNum) ? idNum : null,
      values,
      price,
      inStock: typeof v.is_in_stock === 'boolean' ? v.is_in_stock : null,
      article: cleanSku(v.sku),
    };

    const img = (v.image && typeof v.image.src === 'string' && v.image.src) ? v.image.src : null;
    if (img && img !== mainImageUrl) item.imageUrl = img;

    items.push(item);
  });

  // Показывать нечего (нет ни одного атрибута или ни одной цены) — лучше
  // не класть поле вовсе, чем отдать клиенту пустой/бесполезный список.
  if (!attributes.length) return null;
  if (!items.some((it) => it.price != null)) return null;

  return { attributes, items };
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

  // Вариативный товар: точные цены комбинаций (см. extractVariants). Цену
  // самого черновика при этом НЕ трогаем — она остаётся нижней границей
  // диапазона с priceNote; заменить её на цену выбранного варианта (и убрать
  // предупреждение) — задача клиента, когда пользователь выберет комбинацию.
  const variants = extractVariants($, imageUrl);

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
  if (variants) draft.variants = variants;
  // categoryPath сознательно не заполняем — см. комментарий вверху файла.
  // sheetW/sheetH/thickness тоже не заполняем — сайт продаёт только
  // штучную фурнитуру, полей с размерами листа на странице нет.

  return draft;
}

module.exports = {
  parse, toNumber, normalizeUnit, extractNativeSku, offerPriceRange, buildPriceRangeNote,
  extractVariants,
};
