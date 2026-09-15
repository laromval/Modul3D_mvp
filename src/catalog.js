// catalog.js
// ============================================================================
// Справочник материалов, фурнитуры и крепежа со стоимостью (п.3 Material &
// Hardware Library). Цены сверены с сайтом mobilier.md (см.
// CATALOG_SOURCE.lastSync); позиции без sourceUrl — цены условные,
// соответствие на сайте не найдено.
//
// Классический скрипт (без import/export): подключается через <script src>
// без type="module", чтобы приложение открывалось прямо с диска (file://)
// двойным кликом, без локального сервера. Публикует себя в window.Modul3D.
// ============================================================================
(function () {
  const CATALOG_SOURCE = { site: 'mobilier.md', lastSync: '2026-09-03' };

  // Изначальные H1180 ST10, H3450 ST36 и U999 ST2 на mobilier.md не
  // продаются — магазин держит эти декоры только в других структурах
  // поверхности (сам декор/цвет тот же, отличается только тиснение
  // плёнки). Заменены на реально продающиеся структуры того же декора,
  // код и название приведены в соответствие с реальным товаром (как и
  // с U702ST9 выше — старое название по коду ST10/ST36/ST2 было просто
  // неверным, реальный декор Egger называется иначе).
  const DECORS = [
    // H1180ST37: число в конце slug sourceUrl ("...natur-2800x2070x186-eg-...")
    // не парсится однозначно как толщина (соседние позиции дают чистое "x18",
    // тут "x186") — thickness не добавлен, чтобы не гадать.
    { code: 'H1180ST37', name: 'ЛДСП Egger H1180 ST37 Дуб Халифакс натуральный', sheetPrice: 3070, sourceUrl: 'https://mobilier.md/ru/plitnye-materialy/dsp/dsp_egger/h1180-st37-dub-galifaks-naturalnyy-2800x2070x186-eg-dsp-laminirovannyy.html', sheetW: 2750, sheetH: 1830, unit: 'лист', image: 'https://mobilier.md/image/cache/catalog/products/23949/37de281fd09df8ce907afbcf155ae164-520x350.png', categoryPath: ['ДСП', 'Egger'] },
    { code: 'U702ST9',   name: 'ЛДСП Egger U702 ST9 Серый кашемир', sheetPrice: 1535, sourceUrl: 'https://mobilier.md/ru/plitnye-materialy/dsp/dsp_egger/u702-st9-kashemir-seryy-2800x2070x18-eg-dsp-laminirovannyy.html', sheetW: 2750, sheetH: 1830, unit: 'лист', image: 'https://mobilier.md/image/cache/catalog/products/24843/d75f1d225f2eec6b4c720a64dfb30bb6-250x250.png', categoryPath: ['ДСП', 'Egger'], thickness: 18 },
    { code: 'H3450ST22',  name: 'ЛДСП Egger H3450 ST22 Флитвуд белый', sheetPrice: 1646, sourceUrl: 'https://mobilier.md/ru/plitnye-materialy/dsp/dsp_egger/h3450-st22-flitvud-belyy-2800x2070x18-eg-dsp-laminirovannyy.html', sheetW: 2750, sheetH: 1830, unit: 'лист', image: 'https://mobilier.md/image/cache/catalog/products/23946/c36efb9474cd6c437c97eac5c2de641c-800x800.png', categoryPath: ['ДСП', 'Egger'], thickness: 18 },
    // ST19 (более выраженная текстура) на сайте тоже есть, но дороже
    // (1993 против 1490) — взята более бюджетная ST7 как более
    // сопоставимая по цене с исходной заглушкой.
    { code: 'U999ST7',   name: 'ЛДСП Egger U999 ST7 Чёрный',       sheetPrice: 1490, sourceUrl: 'https://mobilier.md/ru/plitnye-materialy/dsp/dsp_egger/u999-st7-chiornyy-2800x2070x18-eg-dsp-laminirovannyy.html', sheetW: 2750, sheetH: 1830, unit: 'лист', image: 'https://mobilier.md/image/cache/catalog/products/24403/e693f3cec257bc4973ec56868872ea9b-768x1087.png', categoryPath: ['ДСП', 'Egger'], thickness: 18 },
  ];

  const BACK_MATERIALS = [
    { code: 'HDF-3', name: 'ХДФ белый 3мм', sheetPrice: 193, sourceUrl: 'https://mobilier.md/ru/plitnye-materialy/hdf-dvp-ru/dvp-110-belyy-3-2850x2070.html', sheetW: 2440, sheetH: 1220, thickness: 3, unit: 'лист', image: 'https://mobilier.md/image/cache/catalog/products/29869/ac26853536e04c7b11f0b8e72d9f87e5-553x553.png', categoryPath: ['ХДФ/ДВП'] },
  ];

  // Столешницы на mobilier.md продаются ПОГОННЫМ метром — готовой полосой
  // фиксированной глубины и толщины, а не листом произвольного размера, как
  // декоры корпуса (DECORS) выше. Поэтому вместо sheetW/sheetH/sheetPrice —
  // pricePerMeter + фиксированная depth (глубина полосы, мм). specification.js
  // считает эти позиции по ДЛИНЕ детали (пог.м), как EDGE_PRICES, а не по
  // площади листа, как DECORS.
  // materialId — семейство линии позиции ('ldsp38'/'compact12'), НЕ то же,
  // что code: у одной линии может быть несколько позиций разной depth (см.
  // findCountertopMaterialByCode()/countertopMat() в engine.js). С 2026-09-06
  // m.countertop.material в проекте больше нет — код позиции (m.countertop.
  // decorCode) резолвится напрямую по code, без промежуточного materialId.
  // Подбор цветов по просьбе владельца: постформинг — 2 тёмных, 2 светлых/
  // под мрамор, 1 под дерево (5 шт); компакт-плита — 2 светлых, 2 тёмных,
  // 1 нейтральный (5 шт). Все — реальные позиции с mobilier.md, глубина
  // (600 у постформинга, 650 у компакта) взята одинаковой у всей линейки,
  // кроме Ardezie Scivaro — она была в каталоге ещё до этой правки только
  // в глубине 920, отдельно докупать позицию 600 не стали, просто уточнили
  // ей цену (было null).
  const COUNTERTOP_MATERIALS = [
    // --- Постформинг ЛДСП 38мм (5): 2 тёмных, 2 светлых/мрамор, 1 дерево ---
    { code: 'CTOP-LDSP38-600', materialId: 'ldsp38', brand: 'Kronospan',
      name: 'Столешница ЛДСП 38мм постформинг, глубина 600, мрамор белый (Kronospan K552SU White Iceberg)',
      thickness: 38, depth: 600, pricePerMeter: 567, maxLength: 4100, unit: 'пог.м',
      sourceUrl: 'https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-postforming/kronospan-1/kuhonnaya-stoleshnitsa-k552-su-belyy-aysberg-ramornyy-38-4100x600-ku.html', image: 'https://mobilier.md/image/cache/catalog/products/25046/edc850ca56663b9662b2d5ee1b34d7f1-800x800.png' },
    { code: 'CTOP-LDSP38-1063SQ', materialId: 'ldsp38', brand: 'SwissKrono',
      name: 'Столешница ЛДСП 38мм постформинг, глубина 600, мрамор Bianco Bello (SwissKrono 1063 SQ)',
      thickness: 38, depth: 600, pricePerMeter: 898, maxLength: 4100, unit: 'пог.м',
      sourceUrl: 'https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-postforming/swisskrono/kuhonnaya-stoleshnitsa-1063-sq-ramor-byanko-bello-38-4100x600-su.html', image: 'https://mobilier.md/image/cache/catalog/products/25053/f0499007a6a03b7858946f3d630d39c7-590x1200.png' },
    { code: 'CTOP-LDSP38-H1145ST10', materialId: 'ldsp38', brand: 'Egger',
      name: 'Столешница ЛДСП 38мм постформинг, глубина 600, дуб Бардолино натуральный (Egger H1145 ST10)',
      thickness: 38, depth: 600, pricePerMeter: 641, maxLength: 4100, unit: 'пог.м',
      sourceUrl: 'https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-postforming/egger-1/kuhonnaya-stoleshnitsa-h1145-st10-dub-bardolino-naturalnyy-38-4100x600-eg.html', image: 'https://mobilier.md/image/cache/catalog/products/25489/6390e2cc89e9a4392f1f31ffd03bb28a-768x1089.png' },
    { code: 'CTOP-LDSP38-2061RA', materialId: 'ldsp38', brand: 'SwissKrono',
      name: 'Столешница ЛДСП 38мм постформинг, глубина 600, чёрная (SwissKrono 2061 RA Negru)',
      thickness: 38, depth: 600, pricePerMeter: 664, maxLength: 4100, unit: 'пог.м',
      sourceUrl: 'https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-postforming/swisskrono/kuhonnaya-stoleshnitsa-2061-ra-chernyy-38-4100x600-su.html', image: 'https://mobilier.md/image/cache/catalog/products/33880/3e45fc23634b374571cca05ecc5707d4-1400x1773.png' },
    // Цена была не подтверждена (null) — уточнена (1227 MDL/пог.м). На
    // сайте у карточки товара стоит отметка «outstock» (нет в наличии на
    // складе) — перед заказом уточнять у поставщика срок поставки.
    { code: 'CTOP-LDSP38-920', materialId: 'ldsp38', brand: 'Egger',
      name: 'Столешница ЛДСП 38мм постформинг, глубина 920, тёмный сланец (Egger F235 ST76 Ardezie Scivaro)',
      thickness: 38, depth: 920, pricePerMeter: 1227, maxLength: 4100, unit: 'пог.м',
      note: 'На сайте отмечена как «нет в наличии» — уточнять срок поставки у mobilier.md.',
      sourceUrl: 'https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-postforming/egger-1/kuhonnaya-stoleshnitsa-f235-st76-slanets-scivaro-38-4100x920-eg.html', image: 'https://mobilier.md/image/cache/catalog/products/32284/4ef827b2524b36b22ac2dddb62d5b523-768x1087.png' },

    // --- Компакт-плита HPL 12мм (5): 2 светлых, 2 тёмных, 1 нейтральный ---
    { code: 'CTOP-COMPACT12-650', materialId: 'compact12', brand: 'Egger',
      name: 'Столешница компакт-плита HPL 12мм, глубина 650, дуб Санта-Фе винтаж (Egger H1330 ST10, нейтральный)',
      thickness: 12, depth: 650, pricePerMeter: 2248, maxLength: 4100, unit: 'пог.м',
      sourceUrl: 'https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-iz-kompakt-plity/stoleshnica-kompakt-h1330-st10-dub-santa-fe-vintazh-12-4100x650-eg.html', image: 'https://mobilier.md/image/cache/catalog/products/24132/4a61df401f36faf0a6b765640443a328-768x1087.png' },
    { code: 'CTOP-COMPACT12-F221ST87', materialId: 'compact12', brand: 'Egger',
      name: 'Столешница компакт-плита HPL 12мм, глубина 650, керамика крем (Egger F221 ST87 Tessina)',
      thickness: 12, depth: 650, pricePerMeter: 2248, maxLength: 4100, unit: 'пог.м',
      sourceUrl: 'https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-iz-kompakt-plity/stoleshnitsa-hpl-kompakt-f221-st87-tessina-keramicheskiy-kremovyy-12-4100x650.html', image: 'https://mobilier.md/image/cache/catalog/products/34232/dcdac2e673992a71d037326ad93ba34f-768x1091.png' },
    { code: 'CTOP-COMPACT12-F8001ST9', materialId: 'compact12', brand: 'Egger',
      name: 'Столешница компакт-плита HPL 12мм, глубина 650, мрамор светлый (Egger F8001 ST9 Marmură Crystal)',
      thickness: 12, depth: 650, pricePerMeter: 3375, maxLength: 4100, unit: 'пог.м',
      sourceUrl: 'https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-iz-kompakt-plity/stoleshnitsa-hpl-kompakt-f8001-st9-kristallicheskiy-mramor-12-4100x650-eg.html', image: 'https://mobilier.md/image/cache/catalog/products/33959/e1e91a7f54701d4f077461feac6608ac-768x1087.png' },
    { code: 'CTOP-COMPACT12-F206ST9', materialId: 'compact12', brand: 'Egger',
      name: 'Столешница компакт-плита HPL 12мм, глубина 650, камень чёрный (Egger F206 ST9 Pietra Grigia negru)',
      thickness: 12, depth: 650, pricePerMeter: 2248, maxLength: 4100, unit: 'пог.м',
      sourceUrl: 'https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-iz-kompakt-plity/stoleshnitsa-hpl-kompakt-f206-st9-petra-gridzhia-chernyy-12-4100x650-eg.html', image: 'https://mobilier.md/image/cache/catalog/products/33966/a7f38e75dad98898267ccfb0d189a275-768x1087.png' },
    { code: 'CTOP-COMPACT12-U999ST76', materialId: 'compact12', brand: 'Egger',
      name: 'Столешница компакт-плита HPL 12мм, глубина 650, антрацит (Egger U999 ST76)',
      thickness: 12, depth: 650, pricePerMeter: 2248, maxLength: 4100, unit: 'пог.м',
      sourceUrl: 'https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-iz-kompakt-plity/stoleshnitsa-hpl-kompakt-u999-st76-chernyy-12-4100x650-eg.html', image: 'https://mobilier.md/image/cache/catalog/products/24226/e693f3cec257bc4973ec56868872ea9b-768x1087.png' },
  ];

  // Стекло для полок и фасадов: считается по площади, кромка не нужна —
  // торцы шлифуются на производстве стекла. На mobilier.md листовое стекло
  // под мебель не продаётся — его режут на заказ у стекольщиков, поэтому
  // это не «лист определённого размера», а изделие по площади (customOrder,
  // см. specification.js — для такого материала не применяется технологический
  // запас 15% и округление до целых листов, только area_m2 × sheetPrice).
  // Цена ПРИБЛИЗИТЕЛЬНАЯ: точных расценок на мебельное стекло 4-6мм в
  // Молдове найти не удалось, взята нижняя граница диапазона на ЗАКАЛЁННОЕ
  // стекло 8мм (750-1100 MDL/м²) как ориентир — источник glassinterior.md,
  // статья 2026 года. Наше стекло тоньше, реальная цена может быть ниже.
  const GLASS = { code: 'GLASS-6', name: 'Стекло 6 мм (полки, фасады)',
                  sheetPrice: 750, customOrder: true, priceNote: 'приближённая — уточняйте у поставщика',
                  sourceUrl: 'https://glassinterior.md/blog/cat-costa-sticla-securizata-in-republica-moldova-in-2026/',
                  unit: 'м²', thickness: 6, image: null, categoryPath: ['Стекло'] };

  // ---------------------------------------------------------------------------
  // ТИПЫ ФАСАДОВ
  // render: как фасад выглядит в 3D
  //   panel      — цельная плита (ЛДСП, МДФ)
  //   glass      — цельное стекло
  //   frame      — рамка с филёнкой из того же материала
  //   frameGlass — рамка со стеклянной вставкой (витраж, алюминиевый профиль)
  // glassInside: за таким фасадом полки делаются из стекла
  // ---------------------------------------------------------------------------
  const FACADE_MATERIALS = {
    'FAC-LDSP': { code: 'FAC-LDSP', name: 'ЛДСП 18 мм (фасад)', sheetPrice: 1535, sourceUrl: 'https://mobilier.md/ru/plitnye-materialy/dsp/dsp_egger/w1000-st9-belyy-premium-2800x2070x18-eg-dsp-laminirovannyy.html', sheetW: 2750, sheetH: 1830, unit: 'лист', image: 'https://mobilier.md/image/cache/catalog/products/24677/59fa523e0348a50dba8422059f9fe9d6-250x250.png', categoryPath: ['ДСП', 'Egger'], thickness: 18 },
    'FAC-MDF':  { code: 'FAC-MDF',  name: 'МДФ крашеный 19 мм', sheetPrice: 5199, sourceUrl: 'https://mobilier.md/ru/plitnye-materialy/fasadnye-paneli-mdf/mdf-egger/df-u250-pmst9-bezhevaya-karamel-19-2800x2070-eg-perfectsense.html', sheetW: 2800, sheetH: 2070, unit: 'лист', image: 'https://mobilier.md/image/cache/catalog/products/33771/fa16c069b7ad4abdec263f6adff04801-768x1087.png', categoryPath: ['МДФ-плита', 'Egger'], thickness: 19 },
    // Массив дуба листами не продаётся — это не плитный материал, а
    // рамочное столярное изделие (рама + филёнка/стекло) под заказ.
    // Цена — ОРИЕНТИР по прайсу молдавской фабрики ARAMA (arama.md,
    // прайс-лист от 01.09.2026, породу дерева не уточняют — брать окрашенный
    // вариант). Курс ≈20 MDL/€ (BNM). customOrder: true — как и стекло выше,
    // считается area_m2 × sheetPrice без запаса на раскрой (это не лист).
    // 'FAC-WOOD-FILON' — рама с цельной филёнкой (тип фасада `wood`,
    // render:'frame'): ARAMA «Fronturi cu filon vopsit», 150 €/м² → ≈3000 MDL.
    // Толщина в прайсе ARAMA не указана — thickness не добавлен.
    'FAC-WOOD-FILON': { code: 'FAC-WOOD-FILON', name: 'Фасад из массива с филёнкой',
                         sheetPrice: 3000, customOrder: true, priceNote: 'ориентировочная — уточняйте у изготовителя',
                         sourceUrl: 'https://arama.md/images/price/servicii_general_arama.pdf',
                         unit: 'м²', image: null, categoryPath: ['Массив', 'ARAMA'] },
    // 'FAC-WOOD-FRAME' — просто рама, вставка (стекло/витраж) отдельно
    // (тип фасада `woodGlass`, render:'frameGlass'): ARAMA «Fronturi ramă
    // vopsit», 120 €/м² → ≈2400 MDL. Толщина в прайсе ARAMA не указана —
    // thickness не добавлен.
    'FAC-WOOD-FRAME': { code: 'FAC-WOOD-FRAME', name: 'Фасад из массива рамочный, под стекло/витраж',
                         sheetPrice: 2400, customOrder: true, priceNote: 'ориентировочная — уточняйте у изготовителя',
                         sourceUrl: 'https://arama.md/images/price/servicii_general_arama.pdf',
                         unit: 'м²', image: null, categoryPath: ['Массив', 'ARAMA'] },
    // Алюминиевый профиль для рамочных фасадов — узкоспециализированный
    // товар, в Молдове не нашли ни одного продавца с открытыми ценой или
    // чертежом сечения (проверены mobilier.md, numina.md, ARAMA, дилеры
    // Rehau/Samet — профильной системы под фасады нет ни у кого). Цена
    // осталась условной.
    'FAC-ALU':  { code: 'FAC-ALU',  name: 'Алюминиевый профиль (рамка)', sheetPrice: 9800, sheetW: 2000, sheetH: 1000, unit: 'лист', image: null, categoryPath: ['Алюминий'] },
    // Видимая боковина под деревянный фасад: массивом её не делают —
    // ставят МДФ в шпоне того же дерева. thickness взят из названия (18мм);
    // sourceUrl-слаг даёт "19" — расхождение источника, не разрешено молча.
    'FAC-VENEER': { code: 'FAC-VENEER', name: 'МДФ шпонированный 18 мм (видимая боковина)',
                    sheetPrice: 5796, sourceUrl: 'https://mobilier.md/ru/plitnye-materialy/shponirovannye-plity/df-shpon-dub-natur-19-2800x2070-mk-avstriya.html', sheetW: 2800, sheetH: 2070, unit: 'лист', image: 'https://mobilier.md/image/cache/catalog/products/30073/8bb6eb475f7e6ca545558881176cacf4-1400x1400.png', categoryPath: ['Шпонированные плиты'], thickness: 18 },
    // Листовое стекло на mobilier.md не продаётся (см. GLASS выше) — та же
    // приближённая цена и тот же источник (glassinterior.md), customOrder.
    'GLASS-4':  { code: 'GLASS-4',  name: 'Стекло сатин бронз 4 мм (фасад)',
                  sheetPrice: 750, customOrder: true, priceNote: 'приближённая — уточняйте у поставщика',
                  sourceUrl: 'https://glassinterior.md/blog/cat-costa-sticla-securizata-in-republica-moldova-in-2026/',
                  unit: 'м²', image: null, categoryPath: ['Стекло'], thickness: 4 },
  };

  const FACADE_TYPES = {
    ldsp:      { id: 'ldsp', name: 'Фасад ЛДСП', material: 'FAC-LDSP', thickness: 18,
                 render: 'panel', glassInside: false },
    mdf:       { id: 'mdf', name: 'Фасад МДФ (плёнка/эмаль)', material: 'FAC-MDF', thickness: 19,
                 render: 'panel', glassInside: false },
    mdfMilled: { id: 'mdfMilled', name: 'Фасад МДФ фрезерованный', material: 'FAC-MDF', thickness: 19,
                 render: 'milled', frame: 80, glassInside: false },
    glass4:    { id: 'glass4', name: 'Фасад стекло 4 мм', material: 'GLASS-4', thickness: 4,
                 render: 'glass', glassInside: true },
    wood:      { id: 'wood', name: 'Фасад деревянный', material: 'FAC-WOOD-FILON', thickness: 20,
                 render: 'frame', frame: 70, glassInside: false },
    woodGlass: { id: 'woodGlass', name: 'Фасад деревянный с витражом', material: 'FAC-WOOD-FRAME', thickness: 20,
                 render: 'frameGlass', frame: 70, insert: 'GLASS-4', glassInside: true },
    alu:       { id: 'alu', name: 'Фасад из алюминиевого профиля', material: 'FAC-ALU', thickness: 20,
                 render: 'frameGlass', frame: 24, insert: 'GLASS-4', glassInside: true },
  };
  const FACADE_TYPE_ORDER = ['ldsp', 'mdf', 'mdfMilled', 'glass4', 'wood', 'woodGlass', 'alu'];

  // Значение — объект {price, unit, image}, а не голое число: библиотека
  // (вкладка «Материалы») редактирует price/image на месте, единственная
  // точка чтения цены — specification.js (`EDGE_PRICES[type]?.price`).
  // width/thickness (мм) — разобраны из slug sourceUrl вида
  // "<ширина>x<толщина*10>" (напр. "23x20" → 23мм/2мм), совпадают с числом
  // в названии ключа. Только для отображения в Библиотеке — на расчёт
  // присадки/спецификации не влияют.
  const EDGE_PRICES = {
    'ПВХ 2 мм': { price: 15, width: 23, thickness: 2, sourceUrl: 'https://mobilier.md/ru/plitnye-materialy/kromka/egger/abs-kromka-w1000-st9-23x20-uw.html', unit: 'пог.м', image: 'https://mobilier.md/image/cache/catalog/products/26230/ce0e0716652affb47c8cb90922d63a60-900x300.png', categoryPath: ['ПВХ'] },
    'ПВХ 0.8 мм': { price: 10, width: 23, thickness: 0.8, sourceUrl: 'https://mobilier.md/ru/plitnye-materialy/kromka/egger/abs-kromka-w1000-st9-23x08.html', unit: 'пог.м', image: 'https://mobilier.md/image/cache/catalog/products/25719/ce0e0716652affb47c8cb90922d63a60-900x300.png', categoryPath: ['ПВХ'] },
    'ПВХ 0.4 мм': { price: 5, width: 22, thickness: 0.4, sourceUrl: 'https://mobilier.md/ru/plitnye-materialy/kromka/egger/abs-kromka-w1000-st9-22x04.html', unit: 'пог.м', image: 'https://mobilier.md/image/cache/catalog/products/26208/ce0e0716652affb47c8cb90922d63a60-900x300.png', categoryPath: ['ПВХ'] },
  };

  const HARDWARE_PRICES = {
    // Блюм на mobilier.md не продаётся вообще (0 совпадений по бренду) —
    // цена оставлена условной. sourceUrl — официальная страница линейки
    // Blum CLIP top (включает исполнение 110°); цены на этой странице нет,
    // проверить актуальную цену у поставщика.
    hinge: { name: 'Петля накладная Blum CLIP 110°', article: 'BLUM-CLIP', price: 210, sourceUrl: 'https://www.blum.com/us/en/products/hingesystems/clip-top/programme/', unit: 'шт', category: 'hinge', hardwareModelSlot: 'hingeCup' },
    handle: { name: 'Ручка мебельная скоба 128мм', article: 'RH-128', price: 76, sourceUrl: 'https://mobilier.md/ru/mebelnaya-furnitura/licevaya-furnitura/mebelnye-ruchki/modern-1/ua-b31112806mj-ruchka-ua-b311-128mm-shlifovannaya-stal.html', image: 'https://mobilier.md/image/cache/catalog/products/23266/9345c2a74166028f3546d248401de3ca-800x800.png', unit: 'шт', category: 'handle', subcategory: 'Модерн' },
    // Цена — пара штук по цене за 1 шт (GTV GX1 H45 L500, бренд Blum
    // на сайте отсутствует, направляющая эконом-класса).
    drawerRunnerPair: { name: 'Направляющие шариковые 500мм (пара)', article: 'DR-500', price: 216, sourceUrl: 'https://mobilier.md/index.php?route=product/product&product_id=17414&language=ru-ru', image: 'https://mobilier.md/image/cache/catalog/products/17414/3b29aa24ba017bb8da3327544e43f714-1200x800.png', unit: 'пара', category: 'runner', subcategory: 'GTV' },
    leg: { name: 'Опора мебельная алюминиевая Ø50, регулируемая h100', article: 'LEG-D50-100', price: 105, sourceUrl: 'https://mobilier.md/index.php?route=product/product&product_id=16315&language=ru-ru', image: 'https://mobilier.md/image/cache/catalog/products/16315/9082a5fd288ae5c90dbf11ac2579d3c2-1200x800.png', unit: 'шт', category: 'leg' },
    legPlastic: { name: 'Опора пластиковая регулируемая h100 (кухонная)', article: 'LEG-PL-100', price: 32, sourceUrl: 'https://mobilier.md/ru/mebelnaya-furnitura/licevaya-furnitura/mebelnye-nozhki-i-kolesnye-opory-roliki/nm-dak27-100-10-nozhka-mebelnaya-dak-27-dak-26-h-100-s-regulirovkoy-belyy.html', image: 'https://mobilier.md/image/cache/catalog/products/22485/831467e86d0ce9b83be7bb7932aa0572-1200x800.png', unit: 'шт', category: 'leg' },
    shelfSupport: { name: 'Полкодержатель штифт 5мм', article: 'SUP-5', price: 0.5, sourceUrl: 'https://mobilier.md/ru/mebelnaya-furnitura/furnitura-rejs/td01020401062-polkoderzhatel-metallicheskiy-rejs.html', image: 'https://mobilier.md/image/cache/catalog/products/31691/d1ed55635d1051ecefa9539fe094b15d-600x600.png', unit: 'шт', category: 'support', subcategory: 'REJS' },
    shelfSupportGlass: { name: 'Полкодержатель для стекла с силиконовой пяткой Ø5',
                         article: 'SUP-5G', price: 6, sourceUrl: 'https://mobilier.md/ru/mebelnaya-furnitura/funkcionalnaya-furnitura/soedinitelnye-elementy/pp-gl-b48-01-polkoderzhatel-dlya-steklyannyh-polok-4-8mm-kreplenie-pod-press-a48-hrom.html', image: 'https://mobilier.md/image/cache/catalog/products/32219/cbe4be945e6dce085581653415b74cb5-300x200.png', unit: 'шт', category: 'support' },
    // На сайте есть только зажимная петля для стекла без Ø26 (GTV
    // ZP-CIG-07UZE, 16 MDL) — другой тип крепления, не аналог, поэтому
    // не подставлена; цена осталась условной. sourceUrl — та же страница
    // линейки Blum CLIP top, в её разделе «Glass door applications»
    // описана петля именно под высверленное отверстие Ø26.
    hingeGlass: { name: 'Петля для стеклянной двери (отверстие Ø26)',
                  article: 'HNG-GLASS', price: 520, sourceUrl: 'https://www.blum.com/us/en/products/hingesystems/clip-top/programme/', unit: 'шт', category: 'hinge', hardwareModelSlot: 'hingeGlass' },
    plinthClip: { name: 'Крепление цоколя', article: 'PLC-1', price: 2, sourceUrl: 'https://mobilier.md/index.php?route=product/product&product_id=16385&language=ru-ru', image: 'https://mobilier.md/image/cache/catalog/products/16385/26ca5f3dd46ef1b0d0d57387b3a6df1a-1200x800.png', unit: 'шт', category: 'plinth' },
    countertopCornerTie: { name: 'Угловая стяжка для столешницы Egger 38 (LMB-KAT38-20M)', article: 'LMB-KAT38-20M', price: 75, sourceUrl: 'https://mobilier.md/ru/mebelnaya-furnitura/funkcionalnaya-furnitura/soedinitelnye-elementy/lmb-kat38-20m-planka-dlya-stoleshnitsy-uglovaya-egger-38mm-chernaya.html', image: 'https://mobilier.md/image/cache/catalog/products/32214/b521ad1a5415992e1598430d686c48d3-1400x929.png', unit: 'шт', category: 'countertop' },
    // ЦЕНА-ЗАГЛУШКА, не найдена на mobilier.md, подтвердить у пользователя
    countertopStraightTie: { name: 'Стяжка для прямого стыка столешницы (эксцентрик Ø20)', article: 'CTOP-TIE-20', price: 0, unit: 'шт', category: 'countertop' },
    // ЦЕНА-ЗАГЛУШКА, не найдена на mobilier.md, подтвердить у пользователя
    countertopSealant: { name: 'Клей/герметик для стыка столешницы', article: 'CTOP-SEAL', price: 0, unit: 'уп', category: 'countertop' },
    // ЦЕНА-ЗАГЛУШКА, не найдена на mobilier.md, подтвердить у пользователя.
    // Отдельная позиция от countertopSealant: там клей для шва МЕЖДУ двумя
    // столешницами (стык), здесь — проклейка компакт-плиты по всей площади
    // К КРЫШКЕ КОРПУСА (она тонкая и плохо сверлится, крепёж в торец
    // боковины ей не подходит, см. engine.js skipTopPanel/ctPart.note).
    countertopGlueToCarcass: { name: 'Клей для приклейки столешницы к корпусу (компакт-плита)', article: 'CTOP-GLUE-CARCASS', price: 0, unit: 'уп', category: 'countertop' },
    pushToOpen: { name: 'Механизм Push-to-open (толкатель)', article: 'PTO-1', price: 14, sourceUrl: 'https://mobilier.md/ru/mebelnaya-furnitura/funkcionalnaya-furnitura/amortizatory/am-bocz01-60-amortizator-reguliruemyj-s-pryamym-adapterom.html', image: 'https://mobilier.md/image/cache/catalog/products/22616/c51017e4983679491f170b4cf5ae3270-595x596.png', unit: 'шт', category: 'mechanism' },
    // На сайте штанга продаётся хлыстом 3м за 97 MDL — цена пересчитана
    // на 1 пог.м (97/3 ≈ 32).
    rod: { name: 'Штанга для одежды хромированная Ø25', article: 'ROD-D25', price: 32, sourceUrl: 'https://mobilier.md/ru/mebelnaya-furnitura/funkcionalnaya-furnitura/napolnenie-dlya-shkafov/rr-250630h01-truba-d-25-tolshchina-metala-08mm-l-3m-hrom.html', image: 'https://mobilier.md/image/cache/catalog/products/33494/241a10024a8ffd6e06f06e272c8cad2f-1200x800.png', unit: 'пог.м', category: 'rod' },
    rodHolder: { name: 'Держатель штанги Ø25 (пара)', article: 'ROD-H25', price: 38, sourceUrl: 'https://mobilier.md/index.php?route=product/product&product_id=16263&language=ru-ru', image: 'https://mobilier.md/image/cache/catalog/products/16263/0e4ca43c964112a0a7c2cbd08077956f-1200x800.png', unit: 'пара', category: 'rod' },
  };

  const FASTENER_PRICES = {
    confirmat: { name: 'Конфирмат 7х50', article: 'CONF-50', price: 0.5, sourceUrl: 'https://mobilier.md/index.php?route=product/product&product_id=18604&language=ru-ru', image: 'https://mobilier.md/image/cache/catalog/products/18604/cdb0b8caac46eecd76ab0042e5021eca-1200x800.png', unit: 'шт', category: 'fastener', subcategory: 'GTV' },
    minifixBolt: { name: 'Rastex шток', article: 'RASTEX-BOLT-8', price: 3, sourceUrl: 'https://mobilier.md/index.php?route=product/product&product_id=17692&language=ru-ru', image: 'https://mobilier.md/image/cache/catalog/products/17692/3586bd04286f60b28cb6fd0ec6396a2c-1200x800.png', unit: 'шт', category: 'fastener' },
    minifixCam: { name: 'Rastex эксцентрик', article: 'RASTEX-CAM-15', price: 1, sourceUrl: 'https://mobilier.md/index.php?route=product/product&product_id=18603&language=ru-ru', image: 'https://mobilier.md/image/cache/catalog/products/18603/7050eb11594814eb02a6aef3193910b9-1200x800.png', unit: 'шт', category: 'fastener' },
    dowel: { name: 'Шкант 8х30', article: 'DWL-30', price: 0.2, sourceUrl: 'https://mobilier.md/ru/mebelnaya-furnitura/furnitura-rejs/tk01758117000-shkant-8x30-mm.html', image: 'https://mobilier.md/image/cache/catalog/products/31719/6fa8e8560e0aafc29a0f11b117a4507e-492x493.png', unit: 'шт', category: 'fastener', subcategory: 'REJS' },
    // На сайте у этой позиции карточка товара без фотографии — «образец»
    // оставлен пустым (см. libSwatchHtml: пустой image = можно загрузить
    // свой файл), в отличие от остальных строк FASTENER_PRICES/HARDWARE_PRICES.
    backPanelScrew: { name: 'Шуруп-стяжка задней стенки', article: 'SCR-15', price: 0.5, sourceUrl: 'https://mobilier.md/index.php?route=product/product&product_id=18763&language=ru-ru', unit: 'шт', category: 'fastener' },
    // ЦЕНА-ЗАГЛУШКА: на mobilier.md нашёлся только шуруп 3.5×30мм по 159 лей
    // за упаковку (не за штуку) — не подставлена как цена за 1 шт.
    worktopScrew: { name: 'Шуруп 3.5×35 (крепление столешницы к планке)', article: 'SCR-35-CTOP', price: 0, unit: 'шт', category: 'fastener' },
  };

  const JOINT_LABEL = {
    confirmat: 'Конфирмат',
    minifix: 'Эксцентриковая стяжка (минификс)',
    dowel: 'Шкант',
  };

  // ==========================================================================
  // Ящичные системы. Формулы раскроя дна и задней стенки — из технических
  // каталогов производителей. ICW / LB = чистый проём секции по ширине,
  // NL = номинальная длина направляющей.
  //
  // ВНИМАНИЕ: производители меняют серии и размеры. Перед запуском в
  // производство сверять с актуальным каталогом конкретной серии.
  // ==========================================================================
  // Blum и Hettich на mobilier.md не продаются вообще (0 совпадений по
  // каждому бренду) — setPrice для tandembox/legrabox/innotech/quadro/
  // quadroSlide ниже остались условными, с mobilier.md не сверялись.
  // sourceUrl у каждой системы ниже ведёт на официальную страницу Blum/
  // Hettich — цены там не публикуются (маркетинговые/каталожные страницы
  // производителя, не магазин), поэтому setPrice по-прежнему требует
  // проверки, сам sourceUrl подтверждён (открыт и проверен).
  const DRAWER_SYSTEMS = {
    tandembox: {
      src: 'Blum, каталог TANDEMBOX antaro, раздел «Cutting»',
      sourceUrl: 'https://www.blum.com/eu/en/products/boxsystems/tandembox-antaro/overview/',
      assumed: [],
      // Раскрой по каталогу Blum (TANDEMBOX antaro, раздел «Cutting»):
      //   дно  — ширина LW − 75, длина NL − 24 (ХДФ/ЛДСП-задняя стенка)
      //          или NL − 22 при стальной задней стенке;
      //   задняя стенка — ширина LW − 87, высота по высоте царги.
      name: 'Blum TANDEMBOX antaro',
      metal: true,                                   // царги металлические
      nl: [270, 300, 350, 400, 450, 500, 550, 650],
      heights: [
        { code: 'N', h: 68.5,  minFront: 100, backH: 69 },
        { code: 'M', h: 83.6,  minFront: 115, backH: 84 },
        { code: 'K', h: 115.5, minFront: 147, backH: 116 },
        // C и D — исполнения с продольным релингом (gallery)
        { code: 'C', h: 172,   minFront: 205, backH: 167, reling: 1 },
        { code: 'D', h: 204,   minFront: 237, backH: 199, reling: 2 },
      ],
      bottom: (icw, nl) => ({ length: nl - 24, width: icw - 75 }),
      back:   (icw, hh) => ({ length: icw - 87, width: hh.backH }),
      setPrice: 2400,
      setName: 'Комплект TANDEMBOX antaro (царги + направляющие)',
    },
    legrabox: {
      src: 'Blum, каталог LEGRABOX',
      sourceUrl: 'https://www.blum.com/us/en/products/boxsystems/legrabox/programme/',
      assumed: [],
      name: 'Blum LEGRABOX',
      metal: true,
      nl: [270, 350, 400, 450, 500, 550, 600],
      heights: [
        { code: 'M', h: 90.5, minFront: 120, backH: 63 },
        { code: 'C', h: 177,  minFront: 205, backH: 148, reling: 1 },
      ],
      bottom: (icw, nl) => ({ length: nl - 10, width: icw - 35 }),
      back:   (icw, hh) => ({ length: icw - 38, width: hh.backH }),
      setPrice: 4200,
      setName: 'Комплект LEGRABOX (царги + направляющие)',
    },
    innotech: {
      src: 'Hettich, каталог InnoTech Atira',
      sourceUrl: 'https://www.hettich.com/en-us/products/drawer-systems/innotech-atira',
      assumed: [],
      // Раскрой по каталогу Hettich (InnoTech Atira):
      //   BL = NL + 10;  BB = LB − 2·EB − 51,5;  RB = LB − 2·EB − 63.
      // EB (монтажный зазор на сторону) зависит от толщины боковины:
      //   16 мм → 12,5   ·   18 мм → 10,5   ·   19 мм → 9,5
      name: 'Hettich InnoTech Atira',
      metal: true,
      nl: [260, 300, 350, 420, 470, 520],
      ebFor: (t) => (t >= 19 ? 9.5 : (t >= 18 ? 10.5 : 12.5)),
      eb: 10.5,
      heights: [
        { code: '70',  h: 70,  minFront: 100, backH: 57 },
        { code: '144', h: 144, minFront: 176, backH: 131, reling: 1 },
        { code: '176', h: 176, minFront: 208, backH: 163, reling: 2 },
      ],
      bottom: (icw, nl, sys, t) => {
        const eb = sys.ebFor ? sys.ebFor(t) : sys.eb;
        return { length: nl + 10, width: icw - 2 * eb - 51.5 };
      },
      back: (icw, hh, sys, t) => {
        const eb = sys.ebFor ? sys.ebFor(t) : sys.eb;
        return { length: icw - 2 * eb - 63, width: hh.backH };
      },
      setPrice: 2100,
      setName: 'Комплект InnoTech Atira (царги + Quadro)',
    },
    quadro: {
      name: 'Hettich Quadro V6 Silent System, насадной монтаж, EB20',
      // ИСТОЧНИК размеров. Правило проекта: число в каталоге либо взято из
      // документа, либо помечено в assumed — выдумывать нельзя.
      src: 'Hettich MTA_9 302 560 00 от 15.03.2021',
      // Официальная страница именно насадного (plug-on) исполнения EB20
      // (толщина боковины ≤16мм) в eShop Hettich — подтверждена открытием.
      sourceUrl: 'https://shop.hettich.com/fi_EN/-/Quadro-V6-with-Silent-System,-plug-on-installation,-EB20-(drawer-side-profile-thickness-≤-16-mm)/bp/variant9396745349412',
      assumed: [],
      metal: false,                                  // ящик режется из ЛДСП
      // Ряд NL по инструкции монтажа MTA_9 302 560 00 (V6, насадной монтаж)
      nl: [250, 300, 350, 400, 450, 500],
      // ЗАЗОР 20 мм — от боковины КОРПУСА до ВНУТРЕННЕЙ грани боковины
      // ящика. Значит SKW = LB − 40 задаёт ЧИСТЫЙ ПРОСВЕТ короба, а его
      // наружная ширина = просвет + две толщины боковины ящика. Толщина
      // боковины (16 или 18) на размер 20 не влияет — короб просто
      // становится шире на 4 мм.
      clearanceFor: () => 20,
      clearancePerSide: 20,
      clearanceToInner: true,
      maxBoxSide: 16,          // толще боковина короба — нужна серия EB23
      // ДЛИНА ДНА = NL, в размер короба. Пометка «NL − 10» в инструкции
      // относится к коробу с ТОНКИМ дном из ДВП — у нас дно из ЛДСП.
      bottomLen: (nl) => nl,
      thinBottomLen: (nl) => nl - 10,     // если дно ДВП (в базе не используется)
      // Минимальная ГЛУБИНА КОРПУСА (KT) под эту NL — из таблицы инструкции
      minCorpusDepth: (nl) => nl + 13,
      // Точки крепления короба к направляющей: D — от переднего края,
      // C — от него же до задней (C = NL − 45)
      boxFixD: 45,
      boxFixC: (nl) => nl - 45,
      // Присадка ДНА (посадочные Ø6×4 и защёлка Ø6×11) в инструкции есть,
      // но она для короба с ТОНКИМ дном из ДВП. У нас дно всегда ЛДСП,
      // такого ящика в базе нет — поэтому в модели эти гнёзда не ставятся.
      // Размеры оставлены на случай, если такой короб понадобится.
      // Присадка СТЕНОК короба (та же инструкция):
      //   задняя  — Ø6×11, ось 10 мм над дном: в неё входит задний зацеп
      //             направляющей, он держит короб от подъёма;
      //   передняя — Ø6×10, ось 9,5 мм над дном: штифт переднего держателя.
      // Отступ от торца стенки — 20 мм (размер «20» на чертеже узла).
      // НАСАДНОЙ монтаж: механизм надевается на ШТИФТЫ в стенках короба,
      // уступа у боковин нет — дно лежит под стенками.
      boxStyle: 'pins',
      cabinetPin: { d: 6, depth: 11, fromFront: 10 },
      bottomPin: { d: 6, depth: 10, overBottom: 11, fromSide: 7 },
      // Стандартный ряд высот короба из ЛДСП
      heights: [
        { code: '80',  h: 80,  minFront: 110 },
        { code: '100', h: 100, minFront: 130 },
        { code: '120', h: 120, minFront: 150 },
        { code: '150', h: 150, minFront: 180 },
        { code: '160', h: 160, minFront: 190 },
        { code: '200', h: 200, minFront: 230 },
      ],
      // У Quadro ящик собирается как коробка из ЛДСП с дном ИЗ ЛДСП: направляющая
      // держит короб под дном, и тонкое ХДФ там не годится.
      bottom: 'chipboard',
      setPrice: 1250,
      setName: 'Направляющие Hettich Quadro V6 Silent System, насадные, EB20 (пара)',
    },
    // ------------------------------------------------------------------
    // Quadro V6 Stop Control / Silent System, НАДВИЖНОЙ монтаж (Slide-on),
    // EB20 (плита до 16 мм). Источник: MTA_9 296 800 00 от 13.10.2020.
    // Отличия от насадного: дно НА 12 мм короче NL (а не на 10), шире ряд
    // NL и передний держатель садится на штифт Ø8 (а не Ø6).
    // ------------------------------------------------------------------
    quadroSlide: {
      name: 'Hettich Quadro V6 Stop Control / Silent System, надвижной монтаж, EB20',
      src: 'Hettich MTA_9 296 800 00 от 13.10.2020',
      // Тот самый документ MTA_9 296 800 00 — официальная инструкция
      // монтажа Hettich «Quadro V6 Stop Control / Silent System Slide-on,
      // EB 20 (≤16мм)» от 13.10.2020, открыта и сверена.
      sourceUrl: 'https://web2.hettich.com/hbh/addon/montage/MTA_929680000_QV6_SFG_SFD_EB20.pdf',
      // Не подтверждено документом — показывается предупреждением в панели
      assumed: [],
      metal: false,
      nl: [250, 280, 300, 320, 350, 380, 400, 420, 450, 480, 500, 550, 580, 600],
      clearanceFor: () => 20,     // 20 мм до ВНУТРЕННЕЙ грани боковины ящика
      clearancePerSide: 20,
      clearanceToInner: true,
      maxBoxSide: 16,
      // Дно ЛДСП — в размер короба; «NL − 12» из инструкции — для ДВП.
      bottomLen: (nl) => nl,
      thinBottomLen: (nl) => nl - 12,
      minCorpusDepth: (nl) => nl + 13,            // ≥ KT из таблицы
      boxFixD: 45,
      boxFixC: (nl) => nl - 45,
      // НАДВИЖНОЙ монтаж: короб СДВИГАЕТСЯ на направляющую сверху. Дно
      // вкладывается МЕЖДУ стенками в паз, а боковины опущены на 10 мм
      // ниже дна — этим уступом короб и садится на механизм. Штифтов нет,
      // спереди держатель прикручивается шурупами 3,5×20 (оси 26 и 48 мм
      // над нижней кромкой стенки).
      boxStyle: 'ledge',
      // В БОКОВИНЕ КОРПУСА — Ø6×11 под передний штифт направляющей,
      // ось в 10 мм от переднего края панели, на высоте профиля.
      cabinetPin: { d: 6, depth: 11, fromFront: 10 },
      boxLedge: 12,        // боковины ниже дна на 12 мм — упор направляющей
      // ПЕРЕДНИЙ ФИКСАТОР. Стоит вплотную к фасаду, прикручивается К ДНУ
      // СНИЗУ двумя шурупами 3,5×20. Оси идут ВДОЛЬ ПЕРЕДНЕЙ СТЕНКИ, а
      // размеры на чертеже — цепочкой по самому фиксатору (длина 80):
      // 26 до первого шурупа, +48 до второго, +6 до конца. От переднего
      // края дна ось отстоит на 7,5 мм.
      bracketScrew: { d: 2.5, depth: 12, fromSide: [26, 74], fromFront: 7.5 },
      // ЗАЦЕП НАПРАВЛЯЮЩЕЙ. По разрезу: ось в 11 мм от НИЖНЕЙ плоскости
      // короба и в 7 мм от внутренней грани боковины. При дне 16 мм эта
      // ось попадает в само ДНО, поэтому Ø6×10 сверлится В ТОРЕЦ ДНА,
      // а не в стенку.
      bottomPin: { d: 6, depth: 10, overBottom: 11, fromSide: 7 },
      heights: [
        { code: '80',  h: 80,  minFront: 110 },
        { code: '100', h: 100, minFront: 130 },
        { code: '120', h: 120, minFront: 150 },
        { code: '150', h: 150, minFront: 180 },
        { code: '160', h: 160, minFront: 190 },
        { code: '200', h: 200, minFront: 230 },
      ],
      bottom: 'chipboard',
      setPrice: 1390,
      setName: 'Направляющие Hettich Quadro V6 Stop Control, надвижные, EB20 (пара)',
    },
    ballBearing: {
      src: 'практика цеха: шариковые направляющие, ящик из ЛДСП',
      assumed: [],
      name: 'Ящик из ЛДСП на шариковых направляющих',
      metal: false,                                  // ящик собирается из ЛДСП
      nl: [250, 300, 350, 400, 450, 500, 550, 600],
      clearancePerSide: 13,                          // проём − 26 мм на пару
      heights: [
        { code: '80',  h: 80,  minFront: 110 },
        { code: '100', h: 100, minFront: 130 },
        { code: '120', h: 120, minFront: 150 },
        { code: '150', h: 150, minFront: 180 },
        { code: '200', h: 200, minFront: 230 },
        { code: '250', h: 250, minFront: 280 },
      ],
      // Готового комплекта короб+направляющие на сайте нет — цена взята
      // как пара направляющих GTV GX1 H45 L500 (эконом-класс, бренд не
      // указан у производителя), тот же товар, что и HARDWARE_PRICES.drawerRunnerPair.
      setPrice: 216,
      sourceUrl: 'https://mobilier.md/index.php?route=product/product&product_id=17414&language=ru-ru',
      image: 'https://mobilier.md/image/cache/catalog/products/17414/3b29aa24ba017bb8da3327544e43f714-1200x800.png',
      setName: 'Направляющие шариковые полного выдвижения (пара)',
    },
  };

  const DRAWER_SYSTEM_ORDER = ['tandembox', 'legrabox', 'innotech',
    'quadro', 'quadroSlide', 'ballBearing'];

  // ---------------------------------------------------------------------------
  // РУЧКИ
  // Межосевые расстояния идут по системе 32 мм: 32, 64, 96, 128, 160, 192, 224,
  // 256, 320, 352, 384, 448, 480, 512, 576, 640, 768. Кнопка — одно отверстие,
  // скоба — два. Отверстие под винт M4 сверлится Ø5 мм насквозь.
  // ---------------------------------------------------------------------------
  const HANDLE_HOLE_D = 5;          // диаметр отверстия под винт ручки, мм
  const HANDLES = {
    none:    { id: 'none', name: 'Без ручек', holes: 0, price: 0, category: 'handle' },
    knob:    { id: 'knob', name: 'Ручка-кнопка', holes: 1, cc: 0, price: 39,
               sourceUrl: 'https://mobilier.md/ru/mebelnaya-furnitura/licevaya-furnitura/mebelnye-ruchki/klassicheskie/gz-point-1-06-ruchka-knopka-point-shlifovannaya-stal.html',
               image: 'https://mobilier.md/image/cache/catalog/products/25202/372a34519f2d10b08bef212f35a9ecf8-1200x800.png',
               article: 'H-KNOB', note: 'Одно отверстие Ø5', category: 'handle', subcategory: 'Классика' },
    bow96:   { id: 'bow96', name: 'Ручка-скоба 96 мм', holes: 2, cc: 96, price: 70, sourceUrl: 'https://mobilier.md/ru/mebelnaya-furnitura/licevaya-furnitura/mebelnye-ruchki/modern-1/ua-b31109606mj-ruchka-ua-b311-96mm-shlifovannaya-stal.html', image: 'https://mobilier.md/image/cache/catalog/products/22474/9345c2a74166028f3546d248401de3ca-800x800.png', article: 'H-96', category: 'handle', subcategory: 'Модерн' },
    bow128:  { id: 'bow128', name: 'Ручка-скоба 128 мм', holes: 2, cc: 128, price: 76, sourceUrl: 'https://mobilier.md/ru/mebelnaya-furnitura/licevaya-furnitura/mebelnye-ruchki/modern-1/ua-b31112806mj-ruchka-ua-b311-128mm-shlifovannaya-stal.html', image: 'https://mobilier.md/image/cache/catalog/products/23266/9345c2a74166028f3546d248401de3ca-800x800.png', article: 'H-128', category: 'handle', subcategory: 'Модерн' },
    bow160:  { id: 'bow160', name: 'Ручка-скоба 160 мм', holes: 2, cc: 160, price: 81, sourceUrl: 'https://mobilier.md/ru/mebelnaya-furnitura/licevaya-furnitura/mebelnye-ruchki/modern-1/ua-b31116006mj-ruchka-ua-b311-160mm-shlifovannaya-stal.html', image: 'https://mobilier.md/image/cache/catalog/products/23223/9345c2a74166028f3546d248401de3ca-800x800.png', article: 'H-160', category: 'handle', subcategory: 'Модерн' },
    // Точного 192мм на сайте нет — взята ближайшая доступная 160мм (та же
    // линейка UA-B311) вместо 192мм.
    bow192:  { id: 'bow192', name: 'Ручка-скоба 192 мм', holes: 2, cc: 192, price: 81, sourceUrl: 'https://mobilier.md/ru/mebelnaya-furnitura/licevaya-furnitura/mebelnye-ruchki/modern-1/ua-b31116006mj-ruchka-ua-b311-160mm-shlifovannaya-stal.html', image: 'https://mobilier.md/image/cache/catalog/products/23223/9345c2a74166028f3546d248401de3ca-800x800.png', article: 'H-192', category: 'handle', subcategory: 'Модерн' },
    // Точного 224мм на сайте нет — взята ближайшая доступная 256мм (та же
    // линейка UA-B311) вместо 224мм.
    bow224:  { id: 'bow224', name: 'Ручка-скоба 224 мм', holes: 2, cc: 224, price: 105, sourceUrl: 'https://mobilier.md/ru/mebelnaya-furnitura/licevaya-furnitura/mebelnye-ruchki/modern-1/ua-b31125606mj-ruchka-ua-b311-256mm-shlifovannaya-stal.html', image: 'https://mobilier.md/image/cache/catalog/products/22540/9345c2a74166028f3546d248401de3ca-800x800.png', article: 'H-224', category: 'handle', subcategory: 'Модерн' },
    bow320:  { id: 'bow320', name: 'Ручка-скоба 320 мм', holes: 2, cc: 320, price: 120, sourceUrl: 'https://mobilier.md/ru/mebelnaya-furnitura/licevaya-furnitura/mebelnye-ruchki/modern-1/ua-b31132006mj-ruchka-ua-b311-320mm-shlifovannaya-stal.html', image: 'https://mobilier.md/image/cache/catalog/products/22549/9345c2a74166028f3546d248401de3ca-800x800.png', article: 'H-320', category: 'handle', subcategory: 'Модерн' },
    // Межосевое задаётся вручную: нестандартная или дизайнерская скоба.
    custom:  { id: 'custom', name: 'Скоба — задать межосевое', holes: 2, cc: 0, price: 200,
               article: 'H-CUSTOM', custom: true, category: 'handle' },
  };
  const HANDLE_ORDER = ['none', 'knob', 'bow96', 'bow128', 'bow160', 'bow192', 'bow224', 'bow320', 'custom'];

  // ---------------------------------------------------------------------------
  // ПОДЪЁМНЫЕ МЕХАНИЗМЫ (фасад откидывается вверх)
  // Область применения — по высоте фасада и ширине корпуса, по каталогам
  // производителей. minH/maxH — высота фасада, maxW — ширина корпуса, мм.
  // ---------------------------------------------------------------------------
  // Blum, Hettich и Samet на mobilier.md не продаются вообще (0 совпадений
  // по каждому бренду) — цены во всех восьми позициях ниже условные, с
  // mobilier.md не сверялись. sourceUrl проставлен на официальные страницы
  // Blum/Hettich там, где нашлась модель с точно таким названием — цены на
  // этих страницах не публикуются (это каталожные/маркетинговые страницы,
  // не магазин), поэтому цена так и остаётся условной и требует проверки.
  // Для Samet (sametSmart/sametRapid) на samet.com.tr и sametglobal.com
  // товаров с названиями «Smart Lift»/«Rapid Lift» не нашлось — реальная
  // линейка называется иначе (Multi Mech/Solo Mech/Slim Mech/Gas Spring/
  // D-Lite Lift), выдумывать соответствие не стали, sourceUrl не добавлен.
  const LIFTS = {
    aventosHK:  { id: 'aventosHK', brand: 'Blum', name: 'Blum AVENTOS HK (откидной)',
                  article: 'AVENTOS-HK', price: 4200, sourceUrl: 'https://www.blum.com/eu/en/products/liftsystems/aventos-hk/programme/', minH: 240, maxH: 600, maxW: 1800,
                  note: 'Фасад откидывается вверх одной плоскостью', category: 'mechanism' },
    aventosHF:  { id: 'aventosHF', brand: 'Blum', name: 'Blum AVENTOS HF (складной, два фасада)',
                  article: 'AVENTOS-HF', price: 8900, sourceUrl: 'https://www.blum.com/us/en/products/liftsystems/aventos-hf/programme/', minH: 480, maxH: 1040, maxW: 1800,
                  note: 'Складывается пополам — для высоких антресолей', category: 'mechanism' },
    aventosHL:  { id: 'aventosHL', brand: 'Blum', name: 'Blum AVENTOS HL (параллельный подъём)',
                  article: 'AVENTOS-HL', price: 9800, sourceUrl: 'https://www.blum.com/us/en/products/liftsystems/aventos-hl/programme/', minH: 300, maxH: 580, maxW: 1800,
                  note: 'Фасад уходит параллельно вверх, открывая весь проём', category: 'mechanism' },
    aventosHS:  { id: 'aventosHS', brand: 'Blum', name: 'Blum AVENTOS HS (подъём над корпусом)',
                  article: 'AVENTOS-HS', price: 10500, sourceUrl: 'https://www.blum.com/us/en/products/liftsystems/aventos-hs/programme/', minH: 350, maxH: 800, maxW: 1800,
                  note: 'Единый фасад поднимается над корпусом', category: 'mechanism' },
    hettichHL:  { id: 'hettichHL', brand: 'Hettich', name: 'Hettich Lift Advanced HL',
                  article: 'HT-LIFT-HL', price: 3900, sourceUrl: 'https://shop.hettich.com/us_EN/Further-products/Flap-fittings/Flap-lift-fittings/Flap-lift-fitting-Lift-Advanced-HL,-403---462/p/9079600', minH: 200, maxH: 700, maxW: 1200,
                  note: 'Откидной подъёмник для навесных шкафов', category: 'mechanism' },
    hettichHF:  { id: 'hettichHF', brand: 'Hettich', name: 'Hettich Lift Advanced HF (складной)',
                  article: 'HT-LIFT-HF', price: 7600, sourceUrl: 'https://shop.hettich.com/us_EN/Further-products/Flap-fittings/Folding-flap-fittings/Folding-flap-fitting-Lift-Advanced-HF,-440---550/p/9079605', minH: 480, maxH: 1000, maxW: 1200,
                  note: 'Складной фасад из двух частей', category: 'mechanism' },
    sametSmart: { id: 'sametSmart', brand: 'Samet', name: 'Samet Smart Lift',
                  article: 'SM-SMART', price: 2400, minH: 240, maxH: 600, maxW: 1000,
                  note: 'Бюджетный откидной подъёмник', category: 'mechanism' },
    sametRapid: { id: 'sametRapid', brand: 'Samet', name: 'Samet Rapid Lift (газовый)',
                  article: 'SM-RAPID', price: 1600, minH: 200, maxH: 500, maxW: 900,
                  note: 'Газовый упор с доводчиком', category: 'mechanism' },
  };
  const LIFT_ORDER = ['aventosHK', 'aventosHF', 'aventosHL', 'aventosHS',
                      'hettichHL', 'hettichHF', 'sametSmart', 'sametRapid'];

  // Подбирает ближайшую снизу номинальную длину направляющей под глубину корпуса
  // Подбор NL под глубину корпуса. У систем со СВОЕЙ таблицей минимальной
  // глубины (Quadro V6: KT = NL + 13) берём её — иначе направляющая просто
  // не встанет, хотя «по числам» кажется, что помещается.
  function pickNL(system, innerDepth) {
    const need = system.minCorpusDepth || ((v) => v + 3);
    const fit = system.nl.filter((v) => need(v) <= innerDepth);
    return fit.length ? fit[fit.length - 1] : system.nl[0];
  }

  // Ищет позицию листового материала по коду сразу во ВСЕХ трёх каталогах,
  // куда пользователь может добавить свой лист через Библиотеку материалов —
  // DECORS (декор корпуса), BACK_MATERIALS (задняя стенка), FACADE_MATERIALS
  // (материал фасада, объект, не массив). Общий резолвер для мест, где код
  // материала известен, а категория — нет (engine.js: countertopMat()/
  // ctResolvedThickness для столешницы «свой материал»; specification.js:
  // ctSkipsTopPanel).
  function findMaterialByCode(code) {
    return [].concat(DECORS, BACK_MATERIALS, Object.values(FACADE_MATERIALS))
      .find((d) => d.code === code) || null;
  }

  // Ищет позицию ГОТОВОГО каталога столешниц (COUNTERTOP_MATERIALS, коды
  // "CTOP-...") — ОТДЕЛЬНО от findMaterialByCode() выше: карточки столешниц
  // продаются погонным метром фиксированной глубины (свои поля depth/
  // pricePerMeter/maxLength) и не должны быть доступны там, где ожидается
  // обычный лист декора (декор корпуса/фасада/задней стенки) — попадание
  // CTOP-кода в DECORS/BACK_MATERIALS/FACADE_MATERIALS сломало бы площадное
  // ценообразование листа (см. countertopMat() в engine.js — сначала пробует
  // этот резолвер, и только если не нашёл — общий findMaterialByCode()).
  function findCountertopMaterialByCode(code) {
    return (COUNTERTOP_MATERIALS || []).find((m) => m.code === code) || null;
  }

  // Категории фурнитуры для вкладки «Фурнитура» панели «Библиотека» —
  // группировка полностью покрывает HARDWARE_PRICES + HANDLES + LIFTS + FASTENER_PRICES.
  const HARDWARE_CATEGORY_LABEL = {
    hinge: 'Петли',
    runner: 'Направляющие',
    handle: 'Ручки',
    leg: 'Опоры',
    support: 'Полкодержатели',
    plinth: 'Крепление цоколя',
    countertop: 'Крепёж столешницы',
    mechanism: 'Механизмы (подъёмные, push-to-open)',
    rod: 'Штанга для одежды',
    fastener: 'Крепёж и метизы',
  };
  const HARDWARE_CATEGORY_ORDER = ['hinge', 'runner', 'handle', 'leg', 'support', 'plinth', 'countertop', 'mechanism', 'rod', 'fastener'];

  window.Modul3D = window.Modul3D || {};
  window.Modul3D.catalog = {
    CATALOG_SOURCE,
    DECORS, BACK_MATERIALS, COUNTERTOP_MATERIALS, EDGE_PRICES, HARDWARE_PRICES, FASTENER_PRICES, JOINT_LABEL,
    DRAWER_SYSTEMS, DRAWER_SYSTEM_ORDER, pickNL, GLASS,
    FACADE_TYPES, FACADE_TYPE_ORDER, FACADE_MATERIALS,
    HANDLES, HANDLE_ORDER, HANDLE_HOLE_D, LIFTS, LIFT_ORDER,
    HARDWARE_CATEGORY_LABEL, HARDWARE_CATEGORY_ORDER,
    findMaterialByCode, findCountertopMaterialByCode,
  };
})();
