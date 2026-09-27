// Парсер страницы товара tehmob.md (OpenCart 3, другой шаблон/классы, чем
// mobilierMd.js/daskCentruMd.js/sebasMd.js) — см. ТЗ-ПАРСЕР-МАТЕРИАЛОВ.md,
// разделы 1, 2, 4. Как и остальные, разбирает уже скачанный HTML (скачивание
// и SSRF-защита — в ../catalogLinkFetch.js), сам сети не касается.
//
// ==========================================================================
// ВАЖНЫЙ НЮАНС — два языковых варианта URL на ОДИН и тот же товар, оба нужно
// поддерживать одним и тем же парсером (сайт не даёт отдельного стабильного
// /ru-корня, как mobilier.md — язык переключается кнопкой на сессии, но
// фактически определяется по ПАТТЕРНУ url без всякой cookie):
//   - Румынский: https://tehmob.md/aventos-hf-top-15541.html (слаг-ID.html)
//     — метка артикула "Cod produs: 22F2501".
//   - Русский:   https://tehmob.md/15541-aventos-hf-top.html (ID-слаг.html)
//     — метка артикула "Код товара: 22F2501".
// Оба формата ссылок валидны, разметка внутри #product идентична (см. ниже),
// расходится только текст меток — извлекаем артикул регэкспом, понимающим
// обе (см. extractArticle).
//
// Источники данных на странице (проверено на 5 реальных товарах разных
// категорий, 2026-09-25): фурнитура без скидки с фото
// (capace--terminatie-pu-profil-gola-15652.html), Aventos HF TOP со скидкой
// (aventos-hf-top-15541.html, есть price-old), профиль без явной единицы
// измерения (profil-gola-vertical--15637.html), профиль-хлыст с длиной
// "(5.8 m)" зашитой в название (mner-de-capt-pu-mobila--profil-gola-58-m-
// 15700.html), крепёж-саморез за 1 MDL (15709-euro-surub.html).
//
// НА СТРАНИЦЕ ТОВАРА НЕТ JSON-LD ВООБЩЕ (проверено:
// document.querySelectorAll('script[type="application/ld+json"]').length
// === 0 на всех 5 примерах) — весь разбор идёт по видимой вёрстке. Всё
// нужное лежит внутри `<div id="product" class="product-description">` —
// используем этот скоуп для имени/цены, чтобы не зацепить блоки похожих/
// рекомендуемых товаров ниже на странице (у тех своя разметка):
//
//   <div id="product" class="product-description">
//     <p class="product-model">Cod produs: G23</p>          <!-- или "Код товара: G23" на RU-варианте урла -->
//     <div class="product-title">Capace ( terminatie) pu profil Gola</div>
//     <div class="product-price">
//         <div class="price-new">115<b class="symbol"> mdl</b></div>
//         <!-- при скидке (проверено на Aventos HF TOP) дополнительно: -->
//         <span class="price-old">1.950<b class="symbol"> mdl</b></span>
//         <span class="pers">10%</span>
//     </div>
//     <div class="product-quantity">
//         <input id="input-quantity" ... data-original-title="În stoc: 1000">
//     </div>
//   </div>
//
// - name: `.product-title` внутри #product, fallback `h1` (как в
//   mobilierMd.js/sebasMd.js).
// - price: ВСЕГДА `.price-new` (текущая/акционная цена — если скидки нет,
//   там просто обычная цена). `.price-old`/`.pers` игнорируем — они только
//   информационные, не нужны в черновике. Проверено
//   `document.querySelectorAll('.price-new').length === 1` на странице
//   (скоуп #product избыточен для цены, но используем для консистентности и
//   на случай будущих карточек рекомендаций с такими же классами).
// - currency: жёстко 'MDL' — сайт молдавский, отдельного поля валюты на
//   странице нет (как и у остальных парсеров для этого рынка).
// - article: см. extractArticle() — regex по обеим меткам ("Cod produs"/
//   "Код товара"). ВАЖНО (как и в sebasMd.js — см. предупреждение там про
//   article): на странице крепежа (15709-euro-surub.html) "Cod produs: 6,3"
//   фактически содержит диаметр самореза (6,3 мм), а не артикул
//   производителя — сайт использует это поле не всегда строго как артикул.
//   Всё равно извлекаем его как есть — решает пользователь на экране
//   подтверждения, сервер ничего доп. не фильтрует/не угадывает.
// - unit: на сайте НЕТ отдельного поля единицы измерения нигде (ни атрибутов,
//   ни суффикса у цены) — весь ассортимент (включая хлысты профиля)
//   продаётся поштучно как есть (длина хлыста, если есть, зашита в название,
//   например "(5.8 m)", отдельно не парсим). Дефолт-константа 'шт', как в
//   sebasMd.js — отдельная normalizeUnit() тут не нужна.
// - imageUrl: см. extractImage() — meta[property="og:image"] НЕ используем,
//   он на этом сайте ВСЕГДА равен общему логотипу сайта
//   (https://tehmob.md/image/catalog/logo.jpg), даже у товаров с реальным
//   фото (проверено на нескольких товарах). Настоящее фото — первый <img>
//   внутри `.mySwiper2` (единственный слайдер с этим классом на странице,
//   содержит только фото товара — соседний `.labels` с иконкой "избранное"
//   сюда не попадает). `src` там ОТНОСИТЕЛЬНЫЙ (без домена и ведущего
//   слэша) — обязательно разрешаем через `new URL(src, sourceUrl)`.
// - categoryPath: см. extractCategoryPath() — хлебные крошки `ul.breadcrumb
//   li`, первый пункт всегда "Acasă"/"Главная" (корень сайта), последний —
//   сам товар (всегда `<span>` без ссылки, не `<a>`, в отличие от
//   dask-centru.md) — на этом сайте достаточно отбрасывать оба по позиции,
//   без проверки наличия ссылки (как в mobilierMd.js). Примеры:
//     Acasă > Profil din aluminiu > Profil GOLA > Capace ( terminatie) pu profil Gola
//     Acasă > BLUM Furnitura > Mecanisme de ridicare > Aventos HF TOP
//   → ["Profil din aluminiu", "Profil GOLA"] / ["BLUM Furnitura", "Mecanisme de ridicare"].
// - brand: НЕ заполняем — нет отдельного поля производителя на странице
//   товара (`.specification` — пустой div на всех 5 проверенных товарах).
//   Первый сегмент хлебных крошек иногда похож на бренд ("BLUM Furnitura"),
//   но это категория, а не структурированное поле производителя — не
//   выдумываем brand из этого (тот же принцип, что и у sebasMd.js для
//   categoryPath: раз нет надёжного источника, поле просто отсутствует).
// - inStock: НЕ заполняем — единственный намёк на наличие
//   (`data-original-title="În stoc: N"` на #input-quantity) не проверен для
//   товара НЕ в наличии (живого примера нет), гадать логику "0 = нет в
//   наличии" не будем — поле просто не добавляется в черновик.
// - sheetW/sheetH/thickness: НЕ заполняем — сайт продаёт только штучную
//   фурнитуру и хлысты профиля, данных о размерах листа на странице нет.

const cheerio = require('cheerio');

/** Единица измерения на этом сайте нигде не указана отдельным полем — весь
 * ассортимент продаётся поштучно (см. комментарий вверху файла), поэтому
 * это просто константа, а не функция нормализации, как у остальных
 * парсеров (там нормализация нужна, потому что на их сайтах поле реально
 * встречается в разных формулировках). */
const DEFAULT_UNIT = 'шт';

/**
 * Достаёт число из текста цены/цифрового поля. Сайт НЕ показывает копейки
 * нигде (проверено на всех примерах: "1" (за шуруп), "115", "720", "1.750",
 * "1.817" — либо целое 1-3-значное число, либо число с ОДНОЙ точкой,
 * отделяющей ровно 3 хвостовые цифры, то есть точка — разделитель ТЫСЯЧ:
 * "1.750" = 1750, а не 1.75). Реальной дробной копеечной цены нигде не
 * встретилось. Логика (без выдумывания сверх проверенного):
 *   - убираем всё, кроме цифр/точки/запятой/минуса (пробелы, "mdl" и т.п.);
 *   - если в остатке РОВНО ОДИН разделитель (`.` или `,`):
 *       - ровно 3 цифры после него -> разделитель тысяч, убираем его
 *         ("1.750" -> "1750" -> 1750, "1.817" -> 1817);
 *       - 1 или 2 цифры после него -> десятичный разделитель, заменяем на
 *         точку (например гипотетическое "42,50" -> 42.5 — на проверенных
 *         страницах не встретилось, но описано в задании как общее правило);
 *   - иначе (0 разделителей, больше одного, или иное количество цифр после
 *     единственного разделителя) — просто убираем все точки/запятые и берём
 *     целое число ("115" -> 115, "1" -> 1, "720" -> 720).
 */
function toNumber(str) {
  if (str === null || str === undefined) return null;
  const cleaned = String(str).replace(/[^0-9.,-]/g, '');
  if (!cleaned) return null;

  const seps = cleaned.match(/[.,]/g) || [];
  if (seps.length === 1) {
    const sepIndex = cleaned.search(/[.,]/);
    const digitsAfter = cleaned.length - sepIndex - 1;
    if (digitsAfter === 3) {
      // Разделитель тысяч, например "1.750" -> 1750.
      const n = parseFloat(cleaned.replace(/[.,]/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    if (digitsAfter === 1 || digitsAfter === 2) {
      // Десятичный разделитель.
      const n = parseFloat(cleaned.replace(/[.,]/, '.'));
      return Number.isFinite(n) ? n : null;
    }
  }
  // Иначе — не гадаем, просто убираем все точки/запятые и берём целое число.
  const n = parseFloat(cleaned.replace(/[.,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Артикул из `.product-model` (см. комментарий вверху файла про два
 * варианта метки — румынский и русский URL дают разный текст той же
 * разметки). Возвращает как есть (без доп. фильтрации/нормализации — см.
 * предупреждение про "Cod produs: 6,3" на странице крепежа), или null, если
 * метка не найдена. */
function extractArticle($product) {
  const text = $product.find('.product-model').first().text().replace(/\s+/g, ' ').trim();
  const m = text.match(/(?:Cod produs|Код товара):\s*(.+)/i);
  return m ? m[1].trim() : null;
}

/** Настоящее фото товара — первый `<img>` внутри `.mySwiper2` (см.
 * комментарий вверху файла — meta og:image на этом сайте бесполезен, всегда
 * общий логотип). `src` там относительный, разрешаем его через sourceUrl.
 * Возвращает null, если слайдер пуст (не встретилось на практике, но
 * подстраховываемся) или src не удалось разрешить в валидный URL. */
function extractImage($, sourceUrl) {
  const src = $('.mySwiper2').first().find('img').first().attr('src');
  if (!src) return null;
  try {
    return new URL(src, sourceUrl).href;
  } catch (_) {
    return null;
  }
}

/** Хлебные крошки `ul.breadcrumb li` -> черновой categoryPath. Первый пункт
 * (корень сайта, "Acasă"/"Главная") и последний (сам товар — на этом сайте
 * всегда `<span>` без ссылки) отбрасываем по позиции, как в mobilierMd.js —
 * см. комментарий вверху файла про то, почему тут проще, чем на
 * dask-centru.md. Возвращает null, если после отсечения не осталось ни
 * одного сегмента. */
function extractCategoryPath($) {
  const items = $('ul.breadcrumb li')
    .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter(Boolean);
  if (items.length <= 2) return null;
  const path = items.slice(1, -1);
  return path.length > 0 ? path : null;
}

/**
 * Парсит HTML страницы товара tehmob.md (любой из двух языковых вариантов
 * URL, см. комментарий вверху файла) в черновой объект для экрана
 * подтверждения на клиенте (см. mobilierMd.js/sebasMd.js — тот же контракт
 * полей).
 *
 * @param {string} html
 * @param {string} sourceUrl
 * @returns {object} черновик товара.
 * @throws {Error} с `.code = 'PARSE_FAILED'`, если не нашлись название или
 *   цена.
 */
function parse(html, sourceUrl) {
  const $ = cheerio.load(html);
  const $product = $('#product');

  const name = ($product.find('.product-title').first().text().replace(/\s+/g, ' ').trim())
    || $('h1').first().text().trim()
    || null;

  if (!name) {
    const err = new Error(
      'Не удалось найти название товара на странице — возможно, это не страница товара или изменилась вёрстка сайта.'
    );
    err.code = 'PARSE_FAILED';
    throw err;
  }

  const priceText = $product.find('.price-new').first().text();
  const price = priceText ? toNumber(priceText) : null;

  if (price == null) {
    const err = new Error('Не удалось найти цену товара на странице.');
    err.code = 'PARSE_FAILED';
    throw err;
  }

  // Валюта — сайт молдавский, отдельного поля на странице нет, дефолт MDL
  // (как у остальных парсеров для этого рынка).
  const currency = 'MDL';

  const article = extractArticle($product);
  const imageUrl = extractImage($, sourceUrl);
  const categoryPath = extractCategoryPath($);

  const draft = {
    name,
    price,
    currency,
    unit: DEFAULT_UNIT,
    sourceUrl,
  };
  if (imageUrl) draft.imageUrl = imageUrl;
  if (article) draft.article = article;
  if (categoryPath) draft.categoryPath = categoryPath;
  // brand, inStock, sheetW/sheetH/thickness сознательно не заполняем — см.
  // комментарий вверху файла (нет надёжного источника на странице).

  return draft;
}

module.exports = { parse, toNumber, extractArticle, extractImage, extractCategoryPath };
