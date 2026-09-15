// Парсер страницы товара dask-centru.md (OpenCart) — см.
// ТЗ-ПАРСЕР-МАТЕРИАЛОВ.md, разделы 1, 2, 4. Как и mobilierMd.js, разбирает
// уже скачанный HTML (скачивание — в ../catalogLinkFetch.js), сам сети не
// касается.
//
// Источники данных на странице (проверено на 8 реальных страницах товара,
// 2026-09-15: петля Blum, ЛДСП Swiss Krono, МДФ, фанера, столешница Swiss
// Krono, муфта опоры, ручка мебельная, все страницы из разных категорий
// каталога):
//
//   - <script type="application/ld+json"> "@type":"Product" — name, image
//     (одна строка, НЕ массив, в отличие от mobilier.md), offers.price/
//     offers.priceCurrency/offers.availability. Поля "brand"/"sku"/"mpn" на
//     этом сайте ВСЕГДА пустые строки (проверено во всех 8 категориях) —
//     не используем их. "model" совпадает с product_id из URL (внутренний
//     код магазина, НЕ артикул производителя) — тоже не используем.
//   - <script type="application/ld+json"> "@type":"BreadcrumbList" —
//     хлебные крошки. В ОТЛИЧИЕ от mobilier.md, здесь ПОСЛЕДНИЙ элемент
//     (сам товар) ВСЕГДА имеет поле "item" (ссылку на самого себя) —
//     поэтому условие mobilierMd.js "нет item = это сам товар" тут не
//     работает, последний элемент отбрасываем безусловно по позиции.
//   - Таблица характеристик товара `.product-data__item` (пары "<span
//     class="product-data__item-span">Метка</span> Значение" — см.
//     readProductDataItems()). Присутствует на странице ДВАЖДЫ (краткий
//     блок над описанием и полный под вкладкой "Характеристики") —
//     читаем оба, повторяющиеся ключи безвредны (то же значение). Это
//     САМЫЙ надёжный источник на сайте:
//       - "Производитель" -> brand (гораздо надёжнее, чем пытаться угадать
//         бренд из хлебных крошек — сравни: JSON-LD "category" у товара
//         иногда равен бренду, "Blum", иногда типу материала, "ДСП
//         ламинированное" — не годится как единое правило).
//       - "Толщина, мм" -> thickness (уже в мм).
//       - "Формат, мм" -> sheetW x sheetH (уже в мм, разделитель — то
//         латинское "x", то кириллическое "х", предусмотрены оба). Это
//         НАДЁЖНЕЕ, чем регэксп по названию товара, как в mobilierMd.js:
//         на дереве живой пример (МДФ) конкретно показал, что название
//         товара может быть УСТАРЕВШИМ ("2800*2070" в title) и расходиться
//         с реальным "Формат, мм" в таблице характеристик ("2800х1830") —
//         поэтому названию не доверяем вообще, только структурированному
//         полю, а если поля нет — sheetW/sheetH просто не заполняем (не
//         гадаем по названию).
//       - "Единица измерения" -> unit (текст вида "шт.", "м/п", "метр
//         квадратный, м2", а для петли-в-комплекте — "Петля+ответная
//         планка (к-т)" — последнее нормализуем как "шт", см.
//         normalizeUnit()).
//   - `.product-page__price[data-price]` — атрибут с чистым числом
//     (десятичная точка, без разделителя тысяч на всех проверенных
//     примерах) — используем как запасной источник цены, если её нет в
//     JSON-LD.
//
// Артикул производителя: на этом сайте НЕТ отдельного поля под него ни в
// одной из проверенных категорий. "Код Товара" в `.product-data__item.model`
// — это ВСЕГДА тот же internal product_id, что и в URL (см. выше), не
// артикул производителя. Иногда сам артикул виден как часть свободного
// текста в названии товара (например "...BLUMOTION 110° EXPANDO,
// 71B355E61 + ответная планка"), но не всегда в таком виде и не выделен в
// отдельное поле — специально НЕ извлекаем article для этого сайта, чтобы
// не собирать это эвристикой по названию (см. итоговое сообщение агента).
//
// Важный крайний случай (проверено на реальном товаре: фанера ФК 3/4, под
// заказ): у товара, которого сейчас нет в наличии, `data-price="0"` и
// offers.availability="OutOfStock" — сайт БУКВАЛЬНО показывает "0.00 MDL".
// Это не ошибка парсинга — передаём как есть (price: 0, inStock: false),
// сервер не решает за пользователя, актуальна ли позиция без цены.

const cheerio = require('cheerio');

/** См. mobilierMd.toNumber — тот же формат чисел на этой странице (точка
 * или запятая как десятичный разделитель, без группировки тысяч — во всех
 * проверенных примерах, включая столешницу за 613 MDL, разделителя тысяч
 * не было). */
function toNumber(str) {
  if (str === null || str === undefined) return null;
  const normalized = String(str).replace(/\s+/g, '').replace(/,/g, '.');
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = parseFloat(match[0]);
  return Number.isFinite(n) ? n : null;
}

/** Нормализует текст поля "Единица измерения" (см. примеры выше) к тем же
 * обозначениям, что использует src/catalog.js для штучной фурнитуры и
 * погонажа — 'шт' | 'пог.м' | 'м²' (у src/catalog.js есть ещё и 'лист' для
 * листовых материалов, но здесь эта функция его не производит — она только
 * разбирает конкретный текст атрибута "Единица измерения" на этом сайте,
 * где значение "лист" не встречалось; normalizeUnit() в этих случаях
 * подстраховывается фолбэком через return raw.trim(), а не выдаёт неверный
 * вариант из трёх перечисленных).
 * "к-т"/"компл" (комплект, например петля+ответная планка) трактуем как
 * "шт" — по смыслу это тоже штучный/дискретный товар (покупают N
 * комплектов), не натяжка. Если формулировка не распознана — возвращаем
 * её как есть (обрезав пробелы), не выдумывая соответствие. */
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

function findByType(blocks, type) {
  return blocks.find((b) => b && b['@type'] === type) || null;
}

/**
 * Читает все `.product-data__item` в карту "метка -> значение" (см.
 * комментарий в начале файла). Разметка вида:
 *   <div class="product-data__item">
 *     <div class="product-data__item-div">
 *       <span class="product-data__item-span">Толщина, мм</span>
 *     </div>
 *     18
 *   </div>
 * Значение — текст всего div без учёта текста метки (метка всегда идёт
 * первой, поэтому достаточно отрезать её как префикс после нормализации
 * пробелов). Блок встречается на странице дважды (см. выше) — при
 * повторении ключа оставляем первое найденное значение.
 */
function readProductDataItems($) {
  const map = {};
  $('.product-data__item').each((_, el) => {
    const rawLabel = $(el).find('.product-data__item-span').first().text();
    const label = rawLabel.replace(/\s+/g, ' ').trim().replace(/:$/, '');
    if (!label) return;
    const full = $(el).text().replace(/\s+/g, ' ').trim();
    let value = full.startsWith(label) ? full.slice(label.length) : full;
    value = value.replace(/^:/, '').trim();
    if (label && value && !(label in map)) {
      map[label] = value;
    }
  });
  return map;
}

/** Ищет значение по списку возможных названий метки (точное совпадение,
 * без учёта регистра) — на случай небольших расхождений в формулировках
 * между категориями (например "Толщина, мм" vs "Толщина"). */
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

/** Разбирает "Формат, мм" вида "2800x2070" / "1525х1525" (кириллическое
 * "х") на пару чисел. Возвращает null, если формат не распознан. */
function splitFormat(raw) {
  if (!raw) return null;
  const m = raw.match(/(\d{2,5}(?:[.,]\d+)?)\s*[x×хX]\s*(\d{2,5}(?:[.,]\d+)?)/);
  if (!m) return null;
  return { w: toNumber(m[1]), h: toNumber(m[2]) };
}

/** Хлебные крошки -> черновой categoryPath (см. ТЗ, раздел 3.3). Всегда
 * отбрасываем первый элемент (корень сайта) и последний (сам товар — на
 * этом сайте у него ВСЕГДА есть "item", в отличие от mobilier.md, поэтому
 * отбрасываем по позиции, а не по наличию поля). Возвращает null, если
 * после отсечения не осталось ни одного сегмента (проверено на реальном
 * товаре без категории — фанера ФК 3/4, где хлебные крошки состоят только
 * из корня и самого товара). */
function extractCategoryPath(breadcrumbBlock) {
  if (!breadcrumbBlock || !Array.isArray(breadcrumbBlock.itemListElement)) return null;
  const items = breadcrumbBlock.itemListElement;
  if (items.length <= 2) return null;

  const middle = items.slice(1, -1);
  const path = middle
    .map((it) => (typeof it.name === 'string' ? it.name.trim() : ''))
    .filter(Boolean);

  return path.length > 0 ? path : null;
}

/** offers.availability из schema.org -> boolean|null (см. mobilierMd.js —
 * тот же приём, независимая копия, чтобы модули парсеров оставались
 * самостоятельными). */
function extractInStock(offers) {
  if (!offers || typeof offers.availability !== 'string') return null;
  const a = offers.availability.toLowerCase();
  if (a.includes('instock') || a.includes('preorder') || a.includes('limitedavailability')) return true;
  if (a.includes('outofstock') || a.includes('discontinued') || a.includes('soldout')) return false;
  return null;
}

/**
 * Парсит HTML страницы товара dask-centru.md в черновой объект для экрана
 * подтверждения на клиенте (см. mobilierMd.js — тот же контракт полей).
 *
 * @param {string} html
 * @param {string} sourceUrl
 * @returns {object} черновик товара.
 * @throws {Error} с `.code = 'PARSE_FAILED'`, если не нашлись название или
 *   цена — см. mobilierMd.js.
 */
function parse(html, sourceUrl) {
  const $ = cheerio.load(html);
  const blocks = readJsonLdBlocks($);
  const product = findByType(blocks, 'Product');
  const breadcrumb = findByType(blocks, 'BreadcrumbList');
  const dataMap = readProductDataItems($);

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
  if (price == null) {
    const dataPriceAttr = $('.product-page__price').first().attr('data-price');
    if (dataPriceAttr != null) price = toNumber(dataPriceAttr);
  }
  if (price == null) {
    price = toNumber($('.product-page__price').first().text());
  }

  if (price == null) {
    const err = new Error('Не удалось найти цену товара на странице.');
    err.code = 'PARSE_FAILED';
    throw err;
  }

  // Валюта — сайт молдавский, JSON-LD везде подтверждает MDL (в т.ч. на
  // страницах без офферов это разумный дефолт).
  const currency = (product && product.offers && product.offers.priceCurrency) || 'MDL';

  const unitRaw = pick(dataMap, ['Единица измерения']);
  const unit = normalizeUnit(unitRaw);

  // brand — не входит в буквальный список полей из ТЗ (раздел 4), но JSON-LD
  // brand тут всегда пустой (см. комментарий вверху файла), поэтому берём
  // из таблицы характеристик — единственный надёжный источник на сайте.
  const brand = pick(dataMap, ['Производитель']) || null;

  const thicknessRaw = pick(dataMap, ['Толщина, мм', 'Толщина']);
  const thickness = thicknessRaw != null ? toNumber(thicknessRaw) : null;

  const formatRaw = pick(dataMap, ['Формат, мм', 'Формат']);
  const widthRaw = pick(dataMap, ['Ширина, мм', 'Ширина']);
  const lengthRaw = pick(dataMap, ['Длина, мм', 'Длина', 'Длина листа, мм']);

  let sheetW = null;
  let sheetH = null;
  const fmt = splitFormat(formatRaw);
  if (fmt) {
    sheetW = fmt.w;
    sheetH = fmt.h;
  } else if (widthRaw != null && lengthRaw != null) {
    sheetW = toNumber(lengthRaw);
    sheetH = toNumber(widthRaw);
  }

  let imageUrl = null;
  if (product && typeof product.image === 'string' && product.image) {
    imageUrl = product.image;
  } else if (product && Array.isArray(product.image) && product.image.length > 0) {
    imageUrl = product.image[0];
  }
  if (!imageUrl) {
    imageUrl = $('meta[property="og:image"]').attr('content') || null;
  }

  const categoryPath = extractCategoryPath(breadcrumb);
  const inStock = product ? extractInStock(product.offers) : null;

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
  if (brand) draft.brand = brand;
  if (categoryPath) draft.categoryPath = categoryPath;
  if (inStock != null) draft.inStock = inStock;
  // article сознательно не заполняем — см. комментарий вверху файла.

  return draft;
}

module.exports = { parse, toNumber, normalizeUnit, extractCategoryPath, splitFormat };
