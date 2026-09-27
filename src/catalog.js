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
  {
    "code": "H1180ST37",
    "name": "ЛДСП Egger H1180 ST37 Дуб Халифакс натуральный",
    "unit": "м²",
    "image": "https://mobilier.md/image/cache/catalog/products/23949/37de281fd09df8ce907afbcf155ae164-520x350.png",
    "sheetH": 2070,
    "sheetW": 2800,
    "sourceUrl": "https://mobilier.md/ru/plitnye-materialy/dsp/dsp_egger/h1180-st37-dub-galifaks-naturalnyy-2800x2070x186-eg-dsp-laminirovannyy.html",
    "thickness": 18.6,
    "sheetPrice": 3535.56,
    "sourceName": "H1180 ST37 Дуб Галифакс натуральный 2800x2070x18.6 (EG) Дсп ламинированный",
    "verifiedAt": "2026-09-24T17:35:55.811Z",
    "categoryPath": [
      "ДСП",
      "Egger"
    ],
    "sourceSiteId": "mobilierMd",
    "categoryPathEdited": true
  },
  {
    "code": "U702ST9",
    "name": "ЛДСП Egger U702 ST9 Серый кашемир",
    "unit": "м²",
    "image": "https://mobilier.md/image/cache/catalog/products/24843/d75f1d225f2eec6b4c720a64dfb30bb6-250x250.png",
    "sheetH": 2070,
    "sheetW": 2800,
    "sourceUrl": "https://mobilier.md/ru/plitnye-materialy/dsp/dsp_egger/u702-st9-kashemir-seryy-2800x2070x18-eg-dsp-laminirovannyy.html",
    "thickness": 18,
    "sheetPrice": 1767.78,
    "sourceName": "U702 ST9  Кашемир серый 2800x2070x18 (EG) Дсп ламинированный",
    "verifiedAt": "2026-09-24T17:35:55.811Z",
    "categoryPath": [
      "ДСП",
      "Egger"
    ],
    "sourceSiteId": "mobilierMd",
    "categoryPathEdited": true
  },
  {
    "code": "H3450ST22",
    "name": "ЛДСП Egger H3450 ST22 Флитвуд белый",
    "unit": "м²",
    "image": "https://mobilier.md/image/cache/catalog/products/23946/c36efb9474cd6c437c97eac5c2de641c-800x800.png",
    "sheetH": 2070,
    "sheetW": 2800,
    "sourceUrl": "https://mobilier.md/ru/plitnye-materialy/dsp/dsp_egger/h3450-st22-flitvud-belyy-2800x2070x18-eg-dsp-laminirovannyy.html",
    "thickness": 18,
    "sheetPrice": 1895.29,
    "sourceName": "H3450 ST22 Флитвуд белый 2800x2070x18 (EG) Дсп ламинированный",
    "verifiedAt": "2026-09-24T17:35:55.811Z",
    "categoryPath": [
      "ДСП",
      "Egger"
    ],
    "sourceSiteId": "mobilierMd",
    "categoryPathEdited": true
  },
  {
    "code": "U999ST7",
    "name": "ЛДСП Egger U999 ST7 Чёрный",
    "unit": "м²",
    "image": "https://mobilier.md/image/cache/catalog/products/24403/e693f3cec257bc4973ec56868872ea9b-768x1087.png",
    "sheetH": 2070,
    "sheetW": 2800,
    "sourceUrl": "https://mobilier.md/ru/plitnye-materialy/dsp/dsp_egger/u999-st7-chiornyy-2800x2070x18-eg-dsp-laminirovannyy.html",
    "thickness": 18,
    "sheetPrice": 1715.62,
    "sourceName": "U999 ST7 Чёрный 2800x2070x18 (EG) Дсп ламинированный",
    "verifiedAt": "2026-09-24T17:35:55.811Z",
    "categoryPath": [
      "ДСП",
      "Egger"
    ],
    "sourceSiteId": "mobilierMd",
    "categoryPathEdited": true
  },
  {
    "code": "LINK-1790014004794",
    "name": "H1145 ST10 Дуб Бардолино натуральный",
    "unit": "м²",
    "image": "https://mobilier.md/image/cache/catalog/products/24750/6390e2cc89e9a4392f1f31ffd03bb28a-768x1089.png",
    "sheetH": 2070,
    "sheetW": 2800,
    "article": "",
    "sourceUrl": "https://mobilier.md/ru/plitnye-materialy/dsp/dsp_egger/h1145-st10-dub-bardolino-naturalnyy-2800x2070x18-eg-dsp-laminirovannyy.html",
    "thickness": 18,
    "sheetPrice": 1715.62,
    "sourceName": "H1145 ST10 Дуб Бардолино натуральный  2800x2070x18 (EG) Дсп ламинированный",
    "verifiedAt": "2026-09-24T17:35:55.811Z",
    "categoryPath": [
      "ДСП",
      "Egger"
    ],
    "sourceSiteId": "mobilierMd",
    "sourceArticle": "",
    "categoryPathEdited": true
  },
  {
    "code": "FAC-LINK-1790026940937",
    "name": "U399 PM/ST9 Гранатовый красный  PerfectSense",
    "unit": "м²",
    "image": "https://mobilier.md/image/cache/catalog/products/33774/3a6657e1a126a1ce7a242017fd45749c-768x1087.png",
    "sheetH": 2070,
    "sheetW": 2800,
    "sourceUrl": "https://mobilier.md/ru/plitnye-materialy/fasadnye-paneli-mdf/mdf-egger/df-u399-pmst9-granatovyy-krasnyy-19-2800x2070-eg-perfectsense.html",
    "thickness": 19,
    "sheetPrice": 5199.01,
    "sourceName": "МДФ U399 PM/ST9 Гранатовый красный (19) 2800x2070 (EG) PerfectSense",
    "verifiedAt": "2026-09-24T17:35:55.811Z",
    "categoryPath": [
      "МДФ-плита",
      "Egger"
    ],
    "sourceSiteId": "mobilierMd"
  },
  {
    "code": "LINK-1790200284959",
    "name": "8681 SM Белый бриллиант",
    "unit": "м²",
    "image": "https://mobilier.md/image/cache/catalog/products/18991/8526b8dd515310160ceca6c00fb308ab-768x1090.png",
    "sheetH": 2070,
    "sheetW": 2800,
    "article": "",
    "sourceUrl": "https://mobilier.md/ru/plitnye-materialy/dsp/kronospan/dsp-laminirovanny-8681-sm-belyy-brilliant-16-2800x2070-ku.html",
    "thickness": 16,
    "sheetPrice": 1002.71,
    "sourceName": "Дсп ламинированны 8681 SM Белый бриллиант (16) 2800x2070 (KU)",
    "verifiedAt": "2026-09-24T17:35:55.811Z",
    "categoryPath": [
      "ДСП",
      "Kronospan"
    ],
    "sourceSiteId": "mobilierMd",
    "sourceArticle": "",
    "categoryPathEdited": true
  },
  {
    "code": "LINK-1790249477980",
    "name": "F206 ST9 Пьетра Гриджиа черный",
    "unit": "м²",
    "image": "https://mobilier.md/image/cache/catalog/products/24516/a7f38e75dad98898267ccfb0d189a275-768x1087.png",
    "sheetH": 2070,
    "sheetW": 2800,
    "article": "",
    "sourceUrl": "https://mobilier.md/ru/plitnye-materialy/dsp/dsp_egger/f206-st9-petra-gridzhia-chernyy-2800x2070x18-eg-dsp-laminirovannyy.html",
    "thickness": 18,
    "sheetPrice": 2295.22,
    "sourceName": "F206 ST9 Пьетра Гриджиа черный 2800x2070x18 (EG)  Дсп ламинированный",
    "verifiedAt": "2026-09-24T17:35:55.811Z",
    "categoryPath": [
      "ДСП",
      "Egger"
    ],
    "sourceSiteId": "mobilierMd",
    "sourceArticle": ""
  }
];

  const BACK_MATERIALS = [
  {
    "code": "HDF-3",
    "name": "ХДФ белый 3мм",
    "unit": "м²",
    "image": "https://mobilier.md/image/cache/catalog/products/29869/ac26853536e04c7b11f0b8e72d9f87e5-553x553.png",
    "sheetH": 2070,
    "sheetW": 2850,
    "sourceUrl": "https://mobilier.md/ru/plitnye-materialy/hdf-dvp-ru/dvp-110-belyy-3-2850x2070.html",
    "thickness": 3,
    "sheetPrice": 383.47,
    "sourceName": "ДВП 110 Белый (3) 2850x2070",
    "verifiedAt": "2026-09-24T17:35:55.811Z",
    "categoryPath": [
      "ХДФ/ДВП"
    ],
    "sourceSiteId": "mobilierMd"
  }
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
  {
    "code": "CTOP-LDSP38-600",
    "name": "Столешница ЛДСП 38мм постформинг, глубина 600, мрамор белый (Kronospan K552SU White Iceberg)",
    "unit": "пог.м",
    "brand": "Kronospan",
    "depth": 600,
    "image": "https://mobilier.md/image/cache/catalog/products/25046/edc850ca56663b9662b2d5ee1b34d7f1-800x800.png",
    "maxLength": 4100,
    "sourceUrl": "https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-postforming/kronospan-1/kuhonnaya-stoleshnitsa-k552-su-belyy-aysberg-ramornyy-38-4100x600-ku.html",
    "thickness": 38,
    "materialId": "ldsp38",
    "sourceName": "Кухонная столешница K552 SU Белый Айсберг Мраморный (38) 4100x600 (KU)",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "sourceSiteId": "mobilierMd",
    "pricePerMeter": 567
  },
  {
    "code": "CTOP-LDSP38-1063SQ",
    "name": "Столешница ЛДСП 38мм постформинг, глубина 600, мрамор Bianco Bello (SwissKrono 1063 SQ)",
    "unit": "пог.м",
    "brand": "SwissKrono",
    "depth": 600,
    "image": "https://mobilier.md/image/cache/catalog/products/25053/f0499007a6a03b7858946f3d630d39c7-590x1200.png",
    "maxLength": 4100,
    "sourceUrl": "https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-postforming/swisskrono/kuhonnaya-stoleshnitsa-1063-sq-ramor-byanko-bello-38-4100x600-su.html",
    "thickness": 38,
    "materialId": "ldsp38",
    "sourceName": "Кухонная столешница 1063 SQ Мрамор Бьянко Белло (38) 4100x600 (SU)",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "sourceSiteId": "mobilierMd",
    "pricePerMeter": 898
  },
  {
    "code": "CTOP-LDSP38-H1145ST10",
    "name": "Столешница ЛДСП 38мм постформинг, глубина 600, дуб Бардолино натуральный (Egger H1145 ST10)",
    "unit": "пог.м",
    "brand": "Egger",
    "depth": 600,
    "image": "https://mobilier.md/image/cache/catalog/products/25489/6390e2cc89e9a4392f1f31ffd03bb28a-768x1089.png",
    "maxLength": 4100,
    "sourceUrl": "https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-postforming/egger-1/kuhonnaya-stoleshnitsa-h1145-st10-dub-bardolino-naturalnyy-38-4100x600-eg.html",
    "thickness": 38,
    "materialId": "ldsp38",
    "sourceName": "Кухонная столешница H1145 ST10 Дуб Бардолино натуральный (38) 4100x600 (EG)",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "sourceSiteId": "mobilierMd",
    "pricePerMeter": 641
  },
  {
    "code": "CTOP-LDSP38-2061RA",
    "name": "Столешница ЛДСП 38мм постформинг, глубина 600, чёрная (SwissKrono 2061 RA Negru)",
    "unit": "пог.м",
    "brand": "SwissKrono",
    "depth": 600,
    "image": "https://mobilier.md/image/cache/catalog/products/33880/3e45fc23634b374571cca05ecc5707d4-1400x1773.png",
    "maxLength": 4100,
    "sourceUrl": "https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-postforming/swisskrono/kuhonnaya-stoleshnitsa-2061-ra-chernyy-38-4100x600-su.html",
    "thickness": 38,
    "materialId": "ldsp38",
    "sourceName": "Кухонная столешница 2061 RA Черный (38) 4100x600 (SU)",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "sourceSiteId": "mobilierMd",
    "pricePerMeter": 664
  },
  {
    "code": "CTOP-LDSP38-920",
    "name": "Столешница ЛДСП 38мм постформинг, глубина 920, тёмный сланец (Egger F235 ST76 Ardezie Scivaro)",
    "note": "На сайте отмечена как «нет в наличии» — уточнять срок поставки у mobilier.md.",
    "unit": "пог.м",
    "brand": "Egger",
    "depth": 920,
    "image": "https://mobilier.md/image/cache/catalog/products/32284/4ef827b2524b36b22ac2dddb62d5b523-768x1087.png",
    "maxLength": 4100,
    "sourceUrl": "https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-postforming/egger-1/kuhonnaya-stoleshnitsa-f235-st76-slanets-scivaro-38-4100x920-eg.html",
    "thickness": 38,
    "materialId": "ldsp38",
    "sourceName": "Кухонная столешница F235 ST76 Сланец Scivaro (38) 4100x920 (EG)",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "sourceSiteId": "mobilierMd",
    "pricePerMeter": 1227
  },
  {
    "code": "CTOP-COMPACT12-650",
    "name": "Столешница компакт-плита HPL 12мм, глубина 650, дуб Санта-Фе винтаж (Egger H1330 ST10, нейтральный)",
    "unit": "пог.м",
    "brand": "Egger",
    "depth": 650,
    "image": "https://mobilier.md/image/cache/catalog/products/24132/4a61df401f36faf0a6b765640443a328-768x1087.png",
    "maxLength": 4100,
    "sourceUrl": "https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-iz-kompakt-plity/stoleshnica-kompakt-h1330-st10-dub-santa-fe-vintazh-12-4100x650-eg.html",
    "thickness": 12,
    "materialId": "compact12",
    "sourceName": "Столешница HPL Компакт H1330 ST10 Дуб Санта-Фе Винтаж (12) 4100x650 (EG)",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "sourceSiteId": "mobilierMd",
    "pricePerMeter": 2248
  },
  {
    "code": "CTOP-COMPACT12-F221ST87",
    "name": "Столешница компакт-плита HPL 12мм, глубина 650, керамика крем (Egger F221 ST87 Tessina)",
    "unit": "пог.м",
    "brand": "Egger",
    "depth": 650,
    "image": "https://mobilier.md/image/cache/catalog/products/34232/dcdac2e673992a71d037326ad93ba34f-768x1091.png",
    "maxLength": 4100,
    "sourceUrl": "https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-iz-kompakt-plity/stoleshnitsa-hpl-kompakt-f221-st87-tessina-keramicheskiy-kremovyy-12-4100x650.html",
    "thickness": 12,
    "materialId": "compact12",
    "sourceName": "Столешница HPL Компакт F221 ST87 Тессина керамический кремовый (12) 4100x650",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "sourceSiteId": "mobilierMd",
    "pricePerMeter": 2248
  },
  {
    "code": "CTOP-COMPACT12-F8001ST9",
    "name": "Столешница компакт-плита HPL 12мм, глубина 650, мрамор светлый (Egger F8001 ST9 Marmură Crystal)",
    "unit": "пог.м",
    "brand": "Egger",
    "depth": 650,
    "image": "https://mobilier.md/image/cache/catalog/products/33959/e1e91a7f54701d4f077461feac6608ac-768x1087.png",
    "maxLength": 4100,
    "sourceUrl": "https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-iz-kompakt-plity/stoleshnitsa-hpl-kompakt-f8001-st9-kristallicheskiy-mramor-12-4100x650-eg.html",
    "thickness": 12,
    "materialId": "compact12",
    "sourceName": "Столешница HPL Компакт F8001 ST9 Кристаллический мрамор (12) 4100x650 (EG)",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "sourceSiteId": "mobilierMd",
    "pricePerMeter": 3375
  },
  {
    "code": "CTOP-COMPACT12-F206ST9",
    "name": "Столешница компакт-плита HPL 12мм, глубина 650, камень чёрный (Egger F206 ST9 Pietra Grigia negru)",
    "unit": "пог.м",
    "brand": "Egger",
    "depth": 650,
    "image": "https://mobilier.md/image/cache/catalog/products/33966/a7f38e75dad98898267ccfb0d189a275-768x1087.png",
    "maxLength": 4100,
    "sourceUrl": "https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-iz-kompakt-plity/stoleshnitsa-hpl-kompakt-f206-st9-petra-gridzhia-chernyy-12-4100x650-eg.html",
    "thickness": 12,
    "materialId": "compact12",
    "sourceName": "Столешница HPL Компакт F206 ST9 Пьетра Гриджиа Черный (12) 4100x650 (EG)",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "sourceSiteId": "mobilierMd",
    "pricePerMeter": 2248
  },
  {
    "code": "CTOP-COMPACT12-U999ST76",
    "name": "Столешница компакт-плита HPL 12мм, глубина 650, антрацит (Egger U999 ST76)",
    "unit": "пог.м",
    "brand": "Egger",
    "depth": 650,
    "image": "https://mobilier.md/image/cache/catalog/products/24226/e693f3cec257bc4973ec56868872ea9b-768x1087.png",
    "maxLength": 4100,
    "sourceUrl": "https://mobilier.md/ru/stoleshnicy-i-sten-paneli/stoleshnicy-iz-kompakt-plity/stoleshnitsa-hpl-kompakt-u999-st76-chernyy-12-4100x650-eg.html",
    "thickness": 12,
    "materialId": "compact12",
    "sourceName": "Столешница HPL Компакт U999 ST76 Черный (12) 4100x650 (EG)",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "sourceSiteId": "mobilierMd",
    "pricePerMeter": 2248
  }
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
  const GLASS = {
  "code": "GLASS-6",
  "name": "Стекло 6 мм (полки, фасады)",
  "unit": "м²",
  "image": null,
  "priceNote": "приближённая — уточняйте у поставщика",
  "sourceUrl": "https://glassinterior.md/blog/cat-costa-sticla-securizata-in-republica-moldova-in-2026/",
  "thickness": 6,
  "sheetPrice": 750,
  "customOrder": true,
  "categoryPath": [
    "Стекло"
  ]
};

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
  "FAC-ALU": {
    "code": "FAC-ALU",
    "name": "Алюминиевый профиль (рамка)",
    "unit": "лист",
    "image": null,
    "sheetH": 1000,
    "sheetW": 2000,
    "sheetPrice": 9800,
    "categoryPath": [
      "Алюминий"
    ]
  },
  "FAC-MDF": {
    "code": "FAC-MDF",
    "name": "U250 PM/ST9 Бежевая карамель PerfectSense",
    "unit": "м²",
    "image": "https://mobilier.md/image/cache/catalog/products/33771/fa16c069b7ad4abdec263f6adff04801-768x1087.png",
    "sheetH": 2070,
    "sheetW": 2800,
    "sourceUrl": "https://mobilier.md/ru/plitnye-materialy/fasadnye-paneli-mdf/mdf-egger/df-u250-pmst9-bezhevaya-karamel-19-2800x2070-eg-perfectsense.html",
    "thickness": 19,
    "sheetPrice": 5199.01,
    "sourceName": "МДФ U250 PM/ST9 Бежевая карамель (19) 2800x2070 (EG) PerfectSense",
    "verifiedAt": "2026-09-24T17:35:55.811Z",
    "categoryPath": [
      "МДФ-плита",
      "Egger"
    ],
    "sourceSiteId": "mobilierMd"
  },
  "GLASS-4": {
    "code": "GLASS-4",
    "name": "Стекло сатин бронз 4 мм",
    "unit": "м²",
    "image": null,
    "priceNote": "приближённая — уточняйте у поставщика",
    "sourceUrl": "https://glassinterior.md/blog/cat-costa-sticla-securizata-in-republica-moldova-in-2026/",
    "thickness": 4,
    "sheetPrice": 750,
    "customOrder": true,
    "categoryPath": [
      "Стекло"
    ]
  },
  "FAC-LDSP": {
    "code": "FAC-LDSP",
    "name": "W1000 ST9 Белый Премиум",
    "unit": "м²",
    "image": "https://mobilier.md/image/cache/catalog/products/24677/59fa523e0348a50dba8422059f9fe9d6-250x250.png",
    "sheetH": 2070,
    "sheetW": 2800,
    "sourceUrl": "https://mobilier.md/ru/plitnye-materialy/dsp/dsp_egger/w1000-st9-belyy-premium-2800x2070x18-eg-dsp-laminirovannyy.html",
    "thickness": 18,
    "sheetPrice": 1767.78,
    "sourceName": "W1000 ST9 Белый Премиум 2800x2070x18 (EG) Дсп ламинированный",
    "verifiedAt": "2026-09-24T17:35:55.811Z",
    "categoryPath": [
      "ДСП",
      "Egger"
    ],
    "sourceSiteId": "mobilierMd",
    "categoryPathEdited": true
  },
  "FAC-VENEER": {
    "code": "FAC-VENEER",
    "name": "МДФ Шпон Дуб Натур",
    "unit": "м²",
    "image": "https://mobilier.md/image/cache/catalog/products/30073/8bb6eb475f7e6ca545558881176cacf4-1400x1400.png",
    "sheetH": 2070,
    "sheetW": 2800,
    "sourceUrl": "https://mobilier.md/ru/plitnye-materialy/shponirovannye-plity/df-shpon-dub-natur-19-2800x2070-mk-avstriya.html",
    "thickness": 19,
    "sheetPrice": 5796,
    "sourceName": "МДФ Шпон Дуб Натур (19) 2800X2070 (MK) АВСТРИЯ",
    "verifiedAt": "2026-09-24T17:35:55.811Z",
    "categoryPath": [
      "МДФ-плита",
      "Шпонированные плиты"
    ],
    "sourceSiteId": "mobilierMd",
    "categoryPathEdited": true
  },
  "FAC-WOOD-FILON": {
    "code": "FAC-WOOD-FILON",
    "name": "Фасад из массива с филёнкой",
    "unit": "м²",
    "image": null,
    "priceNote": "ориентировочная — уточняйте у изготовителя",
    "sourceUrl": "https://arama.md/images/price/servicii_general_arama.pdf",
    "sheetPrice": 3000,
    "customOrder": true,
    "categoryPath": [
      "Массив",
      "ARAMA"
    ]
  },
  "FAC-WOOD-FRAME": {
    "code": "FAC-WOOD-FRAME",
    "name": "Фасад из массива рамочный, под стекло/витраж",
    "unit": "м²",
    "image": null,
    "priceNote": "ориентировочная — уточняйте у изготовителя",
    "sourceUrl": "https://arama.md/images/price/servicii_general_arama.pdf",
    "sheetPrice": 2400,
    "customOrder": true,
    "categoryPath": [
      "Массив",
      "ARAMA"
    ]
  },
  "FAC-LINK-1790202402674": {
    "code": "FAC-LINK-1790202402674",
    "name": "МДФ Шпон Ясень Элегант РАДИАЛЬНЫЙ",
    "unit": "м²",
    "image": "https://mobilier.md/image/cache/catalog/products/30030/a01cd7b9f928b1c9e7d72fb7f70e2729-1400x1400.png",
    "sheetH": 2070,
    "sheetW": 2800,
    "article": "",
    "sourceUrl": "https://mobilier.md/ru/plitnye-materialy/shponirovannye-plity/df-shpon-yasen-elegant-19-2800x2070-mk-avstriya.html",
    "thickness": 19,
    "sheetPrice": 5216.4,
    "sourceName": "МДФ Шпон Ясень Элегант (19) 2800X2070 (MK) АВСТРИЯ",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "categoryPath": [
      "МДФ-плита",
      "Шпонированные плиты"
    ],
    "sourceSiteId": "mobilierMd",
    "sourceArticle": ""
  },
  "FAC-LINK-1790202592343": {
    "code": "FAC-LINK-1790202592343",
    "name": "Ясень Натур ТАНГЕНЦАЛЬНЫЙ",
    "unit": "м²",
    "image": "https://mobilier.md/image/cache/catalog/products/30033/82187546b512a1b79ac71c4e60e1b28e-1400x1400.png",
    "sheetH": 2070,
    "sheetW": 2800,
    "article": "",
    "sourceUrl": "https://mobilier.md/ru/plitnye-materialy/shponirovannye-plity/df-shpon-yasen-natur-19-2800x2070-mk-avstriya.html",
    "thickness": 19,
    "sheetPrice": 5216.4,
    "sourceName": "МДФ Шпон Ясень Натур (19) 2800X2070 (MK) АВСТРИЯ",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "categoryPath": [
      "МДФ-плита",
      "Шпонированные плиты"
    ],
    "sourceSiteId": "mobilierMd",
    "sourceArticle": ""
  }
};

  const FACADE_TYPES = {
    ldsp:      { id: 'ldsp', name: 'Фасад ЛДСП', material: 'FAC-LDSP', thickness: 18,
                 render: 'panel', glassInside: false },
    mdf:       { id: 'mdf', name: 'Фасадные панели МДФ', material: 'FAC-MDF', thickness: 19,
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

  // ---------------------------------------------------------------------------
  // АЛЮМИНИЕВЫЙ РАМОЧНЫЙ ФАСАД (facadeType 'alu') — решения пользователя
  // 2026-09-25. Профиль НЕ кромится. Нормализация параметров секции
  // (sec.aluProfile/aluColor/aluFill/aluPriceMode/aluMaker) — aluFacadeOf()
  // в engine.js; смета — specification.js (фасад не идёт в раскрой листа).
  // null в цене/размере = неизвестно: ничего не подставляем, пишем пометку.
  // ---------------------------------------------------------------------------
  // Цвета профиля — по ответу Tehmob (письмо 2026-09-25): алюминий, алюминий
  // браш, золото мат, золото браш, белый, чёрный мат. hex — только для
  // отображения в 3D/UI (не паспортные). Цена зависит от цвета, но цифры
  // поставщик не дал → colorPrices у профилей null.
  // Старые id (silver/champagne/gold/black) переводятся в новые в
  // aluFacadeOf() (engine.js, ALU_LEGACY_COLOR_IDS).
  const ALU_PROFILE_COLORS = {
    alu:       { id: 'alu',       name: 'Алюминий',        hex: '#c3c6c9' },
    aluBrush:  { id: 'aluBrush',  name: 'Алюминий браш',   hex: '#b4b8bb' },
    goldMat:   { id: 'goldMat',   name: 'Золото матовое',  hex: '#c8a45a' },
    goldBrush: { id: 'goldBrush', name: 'Золото браш',     hex: '#bf9a52' },
    white:     { id: 'white',     name: 'Белый',           hex: '#f1f1ef' },
    blackMat:  { id: 'blackMat',  name: 'Чёрный матовый',  hex: '#2a2a2c' },
  };
  const ALU_PROFILE_COLOR_ORDER = ['alu', 'aluBrush', 'goldMat', 'goldBrush', 'white', 'blackMat'];

  // Реальные позиции Tehmob.md (сайт 2026-09-25 + ответ поставщика 2026-09-25,
  // решения пользователя 2026-09-26; ПРАВИЛА-КОНСТРУИРОВАНИЯ.md §4).
  //   width/depth   — видимая ширина рамки / толщина профиля по паспорту, мм
  //   kind          — 'closed' (закрытый: край стекла под нахлёстом паза) |
  //                   'open' (открытый: край стекла не закрыт профилем) | null
  //   fillType      — 'glass' | 'sheet' | null (не указано — допускаем любое)
  //   fillThickness — толщина заполнения по паспорту, мм
  //   fillStop      — от наружного края профиля до дна паза, мм С КАЖДОЙ стороны
  //   fillGap       — общий зазор на размер, мм (всего, НЕ с каждой стороны)
  //                   Размер заполнения = фасад − 2·fillStop − fillGap;
  //                   null в любом из двух — размер заполнения не считаем
  //   priceUnit     — 'm' (за пог.м) | 'bar' (за хлыст) | null (не подтверждено →
  //                   считаем как за метр с пометкой)
  //   barLength     — длина хлыста, м: при 'bar' цена делится на неё; при 'm' —
  //                   только для пометки «хлыстов по N м»
  //   colorPrices   — {colorId: price}, если цена зависит от цвета; null — одна цена
  //   colors        — доступные colorId; null — все
  //   hinge         — 'standard' (обычная мебельная петля, чашка Ø35 как у всех
  //                   фасадов) | 'aluFrame' (спец. петля для узкого алюм.
  //                   профиля: присадки в правилах нет — не сверлим)
  //   section       — чертёж сечения для UI (app.js aluProfileSectionHtml), только
  //                   отображение (чертёж в UI и
  //                   экструзия рамки в 3D, viewer.js aluSectionOf), в расчёт НЕ идёт. Обведено по паспорту Tehmob:
  //                   X — в плоскости фасада от наружного края (0) к центру
  //                   фасада, Y — по толщине, мм. outlines — замкнутые контуры
  //                   (первый — наружный, остальные — полости; рисуются с
  //                   fill-rule evenodd); glass — [x1, y1, x2, y2] прямоугольник
  //                   стекла (x2 > w — стекло уходит за профиль); dims — размеры
  //                   { from:[x,y], to:[x,y], label, side:'top'|'bottom'|'left'|
  //                   'right', at } (at — координата размерной линии, мм).
  //                   Подписи — ТОЛЬКО числа из паспорта; где контур между
  //                   образмеренными точками в паспорте не задан, форма приближённая.
  const ALU_SECTION_1203_1204_TUBE = [[1.2, 9.1], [43.8, 9.1], [43.8, 16.2], [42.3, 16.2], [42.3, 17.4], [43.8, 17.4],
    [43.8, 19.8], [1.2, 19.8], [1.2, 17.4], [2.7, 17.4], [2.7, 16.2], [1.2, 16.2]];
  const ALU_PRICE_NOTE = 'цена зависит от цвета — уточняйте у поставщика на момент заказа (Tehmob, 060 233 325)';
  const ALU_PROFILES = {
    'ALU-LXD3080': { code: 'ALU-LXD3080', name: 'Профиль рамочный 20×20 алюминий', article: 'LXD3080',
      supplier: 'Tehmob', sourceUrl: 'https://tehmob.md/15633-profil-ramochnyj-2020-alyuminij.html',
      width: 19.7, depth: 21.1, kind: null,
      fillType: 'glass', fillThickness: 4, fillStop: 12.5, fillGap: 3,
      price: 60, priceUnit: 'm', barLength: 5.8, colorPrices: null, colors: null,
      hinge: 'aluFrame', priceNote: ALU_PRICE_NOTE,
      // Паспорт: 21.1 × 19.7, стенки 1.2, стекло входит в паз, дно паза — 12.5
      // от наружного края (показано в повёрнутом виде, как на схеме со стеклом).
      section: { w: 19.7, h: 21.1,
        outlines: [
          [[0, 21.1], [0, 0], [19.7, 0], [19.7, 2.025], [18.5, 2.025], [18.5, 1.2], [12.5, 1.2], [12.5, 8],
            [18.5, 8], [18.5, 7.175], [19.7, 7.175], [19.7, 21.1]],
          [[1.2, 19.9], [1.2, 15.4], [3.7, 15.4], [3.7, 14.1], [1.2, 14.1], [1.2, 1.2], [11.3, 1.2], [11.3, 9.2],
            [18.5, 9.2], [18.5, 14.1], [16, 14.1], [16, 15.4], [18.5, 15.4], [18.5, 19.9]],
        ],
        glass: [14, 2.6, 26, 6.6],
        dims: [
          { from: [0, 21.1], to: [19.7, 21.1], label: '19.7', side: 'bottom', at: 24 },
          { from: [0, 0], to: [0, 21.1], label: '21.1', side: 'left', at: -3 },
          { from: [0, 0], to: [12.5, 1.2], label: '12.5', side: 'top', at: -2.6 },
          { from: [19.7, 2.025], to: [19.7, 7.175], label: '5.15', side: 'right', at: 23 },
        ] } },
    'ALU-LXD-1203': { code: 'ALU-LXD-1203', name: 'Профиль рамочный алюминиевый (закрытый)', article: 'LXD-1203',
      supplier: 'Tehmob', sourceUrl: 'https://tehmob.md/15636-profil-ramochnyj-alyuminievyj-.html',
      width: 45, depth: 21, kind: 'closed',
      fillType: 'glass', fillThickness: 4, fillStop: 1.2, fillGap: 3,
      price: 100, priceUnit: null, barLength: null, colorPrices: null, colors: null,
      hinge: 'standard', priceNote: ALU_PRICE_NOTE + '; единица цены не названа',
      // Паспорт: 45 × 21, короб 13.8 (полка 13.1), карман 8 с нахлёстом 1.1,
      // паз под стекло 5.2.
      section: { w: 45, h: 21,
        outlines: [
          [[0, 0], [9.1, 0], [9.1, 2.7], [8, 2.7], [8, 1.2], [1.2, 1.2], [1.2, 7.9], [43.8, 7.9], [43.8, 7.2],
            [45, 7.2], [45, 21], [0, 21]],
          ALU_SECTION_1203_1204_TUBE,
        ],
        glass: [2.7, 3.3, 54, 7.3],
        dims: [
          { from: [0, 21], to: [45, 21], label: '45', side: 'bottom', at: 25.5 },
          { from: [0, 0], to: [0, 21], label: '21', side: 'left', at: -9 },
          { from: [1.2, 7.9], to: [0, 21], label: '13.1', side: 'left', at: -4.5 },
          { from: [45, 7.2], to: [45, 21], label: '13.8', side: 'right', at: 49.5 },
          { from: [0, 0], to: [8, 0], label: '8', side: 'top', at: -4.5 },
          { from: [8, 0], to: [9.1, 0], label: '1.1', side: 'top', at: -4.5 },
          { from: [9.1, 2.7], to: [9.1, 7.9], label: '5.2', side: 'right', at: 14 },
        ] } },
    'ALU-LXD-1204': { code: 'ALU-LXD-1204', name: 'Профиль рамочный алюминий (открытый)', article: 'LXD-1204',
      supplier: 'Tehmob', sourceUrl: 'https://tehmob.md/15635-profil-ramochnyj-alyuminij-.html',
      width: 45, depth: 17.1, kind: 'open',
      fillType: 'glass', fillThickness: 4, fillStop: 1.2, fillGap: 3,
      price: 100, priceUnit: null, barLength: null, colorPrices: null, colors: null,
      hinge: 'standard', priceNote: ALU_PRICE_NOTE + '; единица цены не названа',
      // Паспорт: как LXD-1203, но без кармана/нахлёста — стекло лежит на
      // полке 13.1 и упирается в стенку 1.2. Стенка выступает над полкой
      // на 4 мм — вровень со стеклом, выше стекла не торчит (уточнение
      // пользователя 2026-09-26; «21» с чертежа 1203 к 1204 не относится,
      // толщина 13.1 + 4 = 17.1).
      section: { w: 45, h: 21,
        outlines: [
          [[0, 3.9], [1.2, 3.9], [1.2, 7.9], [43.8, 7.9], [43.8, 7.2], [45, 7.2], [45, 21], [0, 21]],
          ALU_SECTION_1203_1204_TUBE,
        ],
        glass: [2.7, 3.9, 54, 7.9],
        dims: [
          { from: [0, 21], to: [45, 21], label: '45', side: 'bottom', at: 25.5 },
          { from: [0, 3.9], to: [0, 7.9], label: '4', side: 'left', at: -9 },
          { from: [1.2, 7.9], to: [0, 21], label: '13.1', side: 'left', at: -4.5 },
          { from: [45, 7.2], to: [45, 21], label: '13.8', side: 'right', at: 49.5 },
        ] } },
  };
  const ALU_PROFILE_ORDER = ['ALU-LXD3080', 'ALU-LXD-1203', 'ALU-LXD-1204'];

  const ALU_FRAME_EXTRAS = {
    corner: { code: 'ALU-CORNER-AF04', name: 'Уголок монтажный рамочный', article: 'AF 04', supplier: 'Tehmob',
              sourceUrl: 'https://tehmob.md/15653-ugolok-montazhnyj-ramochnyj-.html', price: 12, unit: 'шт', perFacade: 4 },
    // Пластиковый, продаётся длиной 3 м (Tehmob, 2026-09-25); цена не указана.
    seal:   { code: 'ALU-SEAL', name: 'Уплотнитель для стекла', supplier: 'Tehmob', price: null, unit: 'пог.м',
              barLength: 3, priceNote: 'уточняйте у поставщика' },
    // Петля для узкого алюм. профиля (LXD3080, hinge 'aluFrame'): Blum CLIP top 95°
    // для алюминиевых рамок, накладная, с пружиной (каталог Blum, веб-код DQDMBY).
    // Варианты: 71T950AB — под доводчик BLUMOTION 973A (973A0500.01), 70T950A.TL — без
    // пружины; полунакладная 71T960A, вкладная 71T970A. Паспорт Blum (DQDMBY):
    // ширина рамки RB 19–22 мм (LXD3080 — 19.7), монтаж на саморезы.
    // Реальная позиция: sebas.md (Accemob), 110 MDL/шт, 2026-09-26; ответная
    // планка в комплект НЕ входит — заказывается отдельно.
    hinge:  { code: 'ALU-HINGE-BLUM-71T950A', name: 'Петля Blum CLIP top 95° для алюм. рамок, накладная', article: '71T950A',
              supplier: 'Sebas (Accemob)', sourceUrl: 'https://sebas.md/ru/shop/petlya-dlya-alyuminievykh-ramok-blum/',
              price: 110, unit: 'шт', priceNote: 'крепится на винты (в комплекте); ответная планка — отдельно',
              // Присадка в профиле под эту петлю (паспорт Blum 71T950A, «Монтаж на
              // саморезы», sebas.md/wp-content/uploads/2024/11/71T950A_ru.pdf стр. 2 +
              // уточнение пользователя 2026-09-26), с тыльной стороны фасада, мм:
              //   паз под пружинный механизм slotW (поперёк рамки, от ВНУТРЕННЕГО края
              //   рамки наружу) × slotH (вдоль рамки, по центру оси петли);
              //   2 отверстия под саморезы Ø screwD насквозь, фаска 90° до Ø screwCsk,
              //   шаг screwPitch (по ±pitch/2 от оси петли), центр — screwFromInner от
              //   внутреннего края рамки; ширина рамки RB — от rbMin до rbMax.
              mount: { slotW: 16.5, slotH: 14, screwD: 5, screwCsk: 7, screwCskAngle: 90,
                       screwPitch: 28, screwFromInner: 6.9, rbMin: 19, rbMax: 22,
                       // профиль полый: паз и отверстия — сквозь ТЫЛЬНУЮ стенку профиля
                       // (стенка 1.2 мм по паспорту Tehmob LXD3080), не через весь фасад
                       wall: 1.2 } },
    // Полировка кромки стекла по периметру — у ОТКРЫТОГО профиля (kind 'open',
    // LXD-1204) край стекла виден (решение пользователя 2026-09-26). Открытых цен
    // за пог.м у молдавских стекольщиков нет (проверено 2026-09-26) — цена null.
    glassEdge: { code: 'ALU-GLASS-EDGE', name: 'Полировка кромки стекла по периметру', price: null, unit: 'пог.м',
                 priceNote: 'уточняйте у стекольщика (RADEVA +373 68 111 020, Geam Ess Sistem +373 60 004 489)' },
    labour: { code: 'ALU-LABOUR', name: 'Сборка алюминиевого фасада', price: null, unit: 'шт', priceNote: 'укажите свою стоимость работы' },
  };

  // Производители готовых алюминиевых фасадов (режим «покупной»).
  const ALU_MAKERS = {
    furnimob: { id: 'furnimob', name: 'Furnimob', city: 'Кишинёв', address: 'ул. Узинелор, 21',
                phone: '+373 78 00 99 70', email: 'info@furnimob.md', url: 'https://furnimob.md/',
                pricePerM2: null, priceNote: 'Уточняйте цену у производителя' },
  };
  const ALU_MAKER_ORDER = ['furnimob'];

  // Значение — объект {price, unit, image}, а не голое число: библиотека
  // (вкладка «Материалы») редактирует price/image на месте, единственная
  // точка чтения цены — specification.js (`EDGE_PRICES[type]?.price`).
  // width/thickness (мм) — разобраны из slug sourceUrl вида
  // "<ширина>x<толщина*10>" (напр. "23x20" → 23мм/2мм), совпадают с числом
  // в названии ключа. Только для отображения в Библиотеке — на расчёт
  // присадки/спецификации не влияют.
  const EDGE_PRICES = {
  "ПВХ 2 мм": {
    "unit": "пог.м",
    "image": "https://mobilier.md/image/cache/catalog/products/26230/ce0e0716652affb47c8cb90922d63a60-900x300.png",
    "price": 15,
    "width": 23,
    "sourceUrl": "https://mobilier.md/ru/plitnye-materialy/kromka/egger/abs-kromka-w1000-st9-23x20-uw.html",
    "thickness": 2,
    "sourceName": "АБС кромка W1000 ST9 23x2.0 UW",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "categoryPath": [
      "ПВХ"
    ],
    "sourceSiteId": "mobilierMd"
  },
  "ПВХ 0.4 мм": {
    "unit": "пог.м",
    "image": "https://mobilier.md/image/cache/catalog/products/26208/ce0e0716652affb47c8cb90922d63a60-900x300.png",
    "price": 5,
    "width": 22,
    "sourceUrl": "https://mobilier.md/ru/plitnye-materialy/kromka/egger/abs-kromka-w1000-st9-22x04.html",
    "thickness": 0.4,
    "sourceName": "АБС кромка W1000 ST9 22x0.4",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "categoryPath": [
      "ПВХ"
    ],
    "sourceSiteId": "mobilierMd"
  },
  "ПВХ 0.8 мм": {
    "unit": "пог.м",
    "image": "https://mobilier.md/image/cache/catalog/products/25719/ce0e0716652affb47c8cb90922d63a60-900x300.png",
    "price": 10,
    "width": 23,
    "sourceUrl": "https://mobilier.md/ru/plitnye-materialy/kromka/egger/abs-kromka-w1000-st9-23x08.html",
    "thickness": 0.8,
    "sourceName": "АБС кромка W1000 ST9 23x0.8",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "categoryPath": [
      "ПВХ"
    ],
    "sourceSiteId": "mobilierMd"
  }
};

  const HARDWARE_PRICES = {
  "leg": {
    "name": "Опора мебельная алюминиевая Ø50, регулируемая h100",
    "unit": "шт",
    "image": "https://mobilier.md/image/cache/catalog/products/16315/9082a5fd288ae5c90dbf11ac2579d3c2-1200x800.png",
    "price": 105,
    "article": "LEG-D50-100",
    "category": "leg",
    "sourceUrl": "https://mobilier.md/index.php?route=product/product&product_id=16315&language=ru-ru",
    "sourceName": "NM-BD-739-05 Picior BD-739, H-100, aluminiu",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "sourceSiteId": "mobilierMd",
    "sourceArticle": "NM-BD-739-05"
  },
  "rod": {
    "name": "Штанга для одежды хромированная Ø25",
    "unit": "пог.м",
    "image": "https://mobilier.md/image/cache/catalog/products/33494/241a10024a8ffd6e06f06e272c8cad2f-1200x800.png",
    "price": 97,
    "article": "ROD-D25",
    "category": "rod",
    "sourceUrl": "https://mobilier.md/ru/mebelnaya-furnitura/funkcionalnaya-furnitura/napolnenie-dlya-shkafov/rr-250630h01-truba-d-25-tolshchina-metala-08mm-l-3m-hrom.html",
    "sourceName": "RR-250630H01 Труба D-25, толщина метала 0,8мм, L- 3м, хром",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "sourceSiteId": "mobilierMd"
  },
  "hinge": {
    "name": "Петля накладная Blum CLIP 110°",
    "unit": "шт",
    "price": 210,
    "article": "BLUM-CLIP",
    "category": "hinge",
    "sourceUrl": "https://www.blum.com/us/en/products/hingesystems/clip-top/programme/",
    "subcategory": "Blum",
    "categoryPath": [
      "Blum"
    ],
    "hardwareModelSlot": "hingeCup",
    "categoryPathEdited": true
  },
  "handle": {
    "name": "Ручка мебельная скоба 128мм",
    "unit": "шт",
    "image": "https://mobilier.md/image/cache/catalog/products/23266/9345c2a74166028f3546d248401de3ca-800x800.png",
    "price": 76,
    "article": "RH-128",
    "category": "handle",
    "sourceUrl": "https://mobilier.md/ru/mebelnaya-furnitura/licevaya-furnitura/mebelnye-ruchki/modern-1/ua-b31112806mj-ruchka-ua-b311-128mm-shlifovannaya-stal.html",
    "sourceName": "UA-B31112806MJ Ручка UA-B311, 128mm, шлифованная сталь",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "subcategory": "Модерн",
    "sourceSiteId": "mobilierMd"
  },
  "rodHolder": {
    "name": "Держатель штанги Ø25 (пара)",
    "unit": "пара",
    "image": "https://mobilier.md/image/cache/catalog/products/16263/0e4ca43c964112a0a7c2cbd08077956f-1200x800.png",
    "price": 19,
    "article": "ROD-H25",
    "category": "rod",
    "sourceUrl": "https://mobilier.md/index.php?route=product/product&product_id=16263&language=ru-ru",
    "sourceName": "MR-WP-010-01 Suport reglabil WP-10 pentru bara cu D-25, crom",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "sourceSiteId": "mobilierMd",
    "sourceArticle": "MR-WP-010-01"
  },
  "hingeGlass": {
    "name": "Петля для стеклянной двери (отверстие Ø26)",
    "unit": "шт",
    "price": 520,
    "article": "HNG-GLASS",
    "category": "hinge",
    "sourceUrl": "https://www.blum.com/us/en/products/hingesystems/clip-top/programme/",
    "subcategory": "петли для стекла",
    "categoryPath": [
      "петли для стекла"
    ],
    "hardwareModelSlot": "hingeGlass",
    "categoryPathEdited": true
  },
  "legPlastic": {
    "name": "Опора пластиковая регулируемая h100 (кухонная)",
    "unit": "шт",
    "image": "https://mobilier.md/image/cache/catalog/products/22485/831467e86d0ce9b83be7bb7932aa0572-1200x800.png",
    "price": 32,
    "article": "LEG-PL-100",
    "category": "leg",
    "sourceUrl": "https://mobilier.md/ru/mebelnaya-furnitura/licevaya-furnitura/mebelnye-nozhki-i-kolesnye-opory-roliki/nm-dak27-100-10-nozhka-mebelnaya-dak-27-dak-26-h-100-s-regulirovkoy-belyy.html",
    "sourceName": "NM-DAK27-100-10 Ножка мебельная DAK-27 / DAK-26, H-100, с регулировкой, белый",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "sourceSiteId": "mobilierMd"
  },
  "plinthClip": {
    "name": "Крепление цоколя",
    "unit": "шт",
    "image": "https://mobilier.md/image/cache/catalog/products/16385/26ca5f3dd46ef1b0d0d57387b3a6df1a-1200x800.png",
    "price": 2,
    "article": "PLC-1",
    "category": "plinth",
    "sourceUrl": "https://mobilier.md/index.php?route=product/product&product_id=16385&language=ru-ru",
    "sourceName": "NM-KL-DPA-20 Clipsa picior bucatarie DPA, H-100/150, negru",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "sourceSiteId": "mobilierMd",
    "sourceArticle": "NM-KL-DPA-20"
  },
  "pushToOpen": {
    "name": "Механизм Push-to-open (толкатель)",
    "unit": "шт",
    "brand": "Без бренда",
    "image": "https://mobilier.md/image/cache/catalog/products/22616/c51017e4983679491f170b4cf5ae3270-595x596.png",
    "price": 14,
    "article": "PTO-1",
    "category": "mechanism",
    "sourceUrl": "https://mobilier.md/ru/mebelnaya-furnitura/funkcionalnaya-furnitura/amortizatory/am-bocz01-60-amortizator-reguliruemyj-s-pryamym-adapterom.html",
    "sourceName": "AM-BOCZ01-60 Амортизатор регулируемый с прямым адаптером",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "categoryPath": [
      "Без бренда"
    ],
    "sourceSiteId": "mobilierMd",
    "categoryPathEdited": true
  },
  "shelfSupport": {
    "name": "Полкодержатель штифт 5мм",
    "unit": "шт",
    "image": "https://mobilier.md/image/cache/catalog/products/31691/d1ed55635d1051ecefa9539fe094b15d-600x600.png",
    "price": 0.5,
    "article": "SUP-5",
    "category": "support",
    "sourceUrl": "https://mobilier.md/ru/mebelnaya-furnitura/furnitura-rejs/td01020401062-polkoderzhatel-metallicheskiy-rejs.html",
    "sourceName": "TD01.0204.01.062 Полкодержатель металлический (REJS)",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "subcategory": "REJS",
    "sourceSiteId": "mobilierMd"
  },
  "drawerRunnerPair": {
    "name": "Направляющие шариковые 500мм (пара)",
    "unit": "пара",
    "image": "https://mobilier.md/image/cache/catalog/products/17414/3b29aa24ba017bb8da3327544e43f714-1200x800.png",
    "price": 108,
    "article": "DR-500",
    "category": "runner",
    "sourceUrl": "https://mobilier.md/index.php?route=product/product&product_id=17414&language=ru-ru",
    "sourceName": "PK-0H45500GX1 Glisiere cu bila GTV GX1, H-45, L-500mm",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "subcategory": "GTV",
    "sourceSiteId": "mobilierMd",
    "sourceArticle": "PK-0H45500GX1"
  },
  "countertopSealant": {
    "name": "Клей/герметик для стыка столешницы",
    "unit": "уп",
    "price": 0,
    "article": "CTOP-SEAL",
    "category": "countertop"
  },
  "shelfSupportGlass": {
    "name": "Полкодержатель для стекла с силиконовой пяткой Ø5",
    "unit": "шт",
    "image": "https://mobilier.md/image/cache/catalog/products/32219/cbe4be945e6dce085581653415b74cb5-300x200.png",
    "price": 6,
    "article": "SUP-5G",
    "category": "support",
    "sourceUrl": "https://mobilier.md/ru/mebelnaya-furnitura/funkcionalnaya-furnitura/soedinitelnye-elementy/pp-gl-b48-01-polkoderzhatel-dlya-steklyannyh-polok-4-8mm-kreplenie-pod-press-a48-hrom.html",
    "sourceName": "PP-GL-B48-01 Полкодержатель для стеклянных полок 4-8мм, крепление под пресс, A48, хром",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "subcategory": "Без бренда",
    "categoryPath": [
      "Без бренда"
    ],
    "sourceSiteId": "mobilierMd",
    "categoryPathEdited": true
  },
  "countertopCornerTie": {
    "name": "Угловая стяжка для столешницы Egger 38 (LMB-KAT38-20M)",
    "unit": "шт",
    "image": "https://mobilier.md/image/cache/catalog/products/32214/b521ad1a5415992e1598430d686c48d3-1400x929.png",
    "price": 75,
    "article": "LMB-KAT38-20M",
    "category": "countertop",
    "sourceUrl": "https://mobilier.md/ru/mebelnaya-furnitura/funkcionalnaya-furnitura/soedinitelnye-elementy/lmb-kat38-20m-planka-dlya-stoleshnitsy-uglovaya-egger-38mm-chernaya.html",
    "sourceName": "LMB-KAT38-20M Планка для столешницы угловая EGGER 38мм, черная",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "sourceSiteId": "mobilierMd"
  },
  "countertopStraightTie": {
    "name": "Стяжка для прямого стыка столешницы (эксцентрик Ø20)",
    "unit": "шт",
    "price": 0,
    "article": "CTOP-TIE-20",
    "category": "countertop"
  },
  "countertopGlueToCarcass": {
    "name": "Клей для приклейки столешницы к корпусу (компакт-плита)",
    "unit": "уп",
    "price": 0,
    "article": "CTOP-GLUE-CARCASS",
    "category": "countertop"
  },
  "link_runner_1790013629486": {
    "name": "PB-3D0SHX18-250-PRO Направляющая нижнего монтажа с доводчиком 0SHX-18 3D, L-250",
    "unit": "шт",
    "price": 234,
    "article": "PB-3D0SHX18-250-PRO",
    "category": "runner",
    "sourceUrl": "https://mobilier.md/index.php?route=product/product&path=288_1397_339&product_id=34599",
    "sourceName": "PB-3D0SHX18-250-PRO Glisiere sub sertar cu amortizator 0SHX-18 3D, L-250",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "subcategory": "GTV",
    "categoryPath": [
      "GTV"
    ],
    "sourceSiteId": "mobilierMd",
    "sourceArticle": "PB-3D0SHX18-250-PRO"
  }
};

  const FASTENER_PRICES = {
  "dowel": {
    "name": "Шкант 8х30",
    "unit": "шт",
    "image": "https://mobilier.md/image/cache/catalog/products/31719/6fa8e8560e0aafc29a0f11b117a4507e-492x493.png",
    "price": 0.2,
    "article": "DWL-30",
    "category": "fastener",
    "sourceUrl": "https://mobilier.md/ru/mebelnaya-furnitura/furnitura-rejs/tk01758117000-shkant-8x30-mm.html",
    "sourceName": "TK01.7581.17.000 Шкант 8x30 мм",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "subcategory": "REJS",
    "sourceSiteId": "mobilierMd"
  },
  "confirmat": {
    "name": "Конфирмат 7х50",
    "unit": "шт",
    "image": "https://mobilier.md/image/cache/catalog/products/18604/cdb0b8caac46eecd76ab0042e5021eca-1200x800.png",
    "price": 0.5,
    "article": "CONF-50",
    "category": "fastener",
    "sourceUrl": "https://mobilier.md/index.php?route=product/product&product_id=18604&language=ru-ru",
    "sourceName": "WK-CF0750-01 Eurosurub GTV, 7.0x50 mm",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "subcategory": "GTV",
    "sourceSiteId": "mobilierMd",
    "sourceArticle": "WK-CF0750-01-A"
  },
  "minifixCam": {
    "name": "Rastex эксцентрик",
    "unit": "шт",
    "image": "https://mobilier.md/image/cache/catalog/products/18603/7050eb11594814eb02a6aef3193910b9-1200x800.png",
    "price": 1,
    "article": "RASTEX-CAM-15",
    "category": "fastener",
    "sourceUrl": "https://mobilier.md/index.php?route=product/product&product_id=18603&language=ru-ru",
    "sourceName": "WK-CAM-15-13-D Cama minifix D-15, L-13mm",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "subcategory": "Без бренда",
    "categoryPath": [
      "Без бренда"
    ],
    "sourceSiteId": "mobilierMd",
    "sourceArticle": "WK-CAM-15-13-D",
    "categoryPathEdited": true
  },
  "minifixBolt": {
    "name": "Rastex шток",
    "unit": "шт",
    "image": "https://mobilier.md/image/cache/catalog/products/17692/3586bd04286f60b28cb6fd0ec6396a2c-1200x800.png",
    "price": 3,
    "article": "RASTEX-BOLT-8",
    "category": "fastener",
    "sourceUrl": "https://mobilier.md/index.php?route=product/product&product_id=17692&language=ru-ru",
    "sourceName": "SZ-008-00-01T Surub de legatura intre corpuri D-8 mm, crom",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "subcategory": "Без бренда",
    "categoryPath": [
      "Без бренда"
    ],
    "sourceSiteId": "mobilierMd",
    "sourceArticle": "SZ-008-00-01T",
    "categoryPathEdited": true
  },
  "worktopScrew": {
    "name": "Шуруп 3.5×35 (крепление столешницы к планке)",
    "unit": "шт",
    "price": 0,
    "article": "SCR-35-CTOP",
    "category": "fastener",
    "subcategory": "Без бренда",
    "categoryPath": [
      "Без бренда"
    ],
    "categoryPathEdited": true
  },
  "backPanelScrew": {
    "name": "Шуруп-стяжка задней стенки",
    "unit": "шт",
    "price": 0.5,
    "article": "SCR-15",
    "category": "fastener",
    "sourceUrl": "https://mobilier.md/index.php?route=product/product&product_id=18763&language=ru-ru",
    "sourceName": "WZ-SCTYLPR-WK Suport spate PFL cu surub 3.5x20mm",
    "verifiedAt": "2026-09-24T17:35:56.809Z",
    "subcategory": "Без бренда",
    "categoryPath": [
      "Без бренда"
    ],
    "sourceSiteId": "mobilierMd",
    "sourceArticle": "WZ-SCTYLPR-WK",
    "categoryPathEdited": true
  },
  "hangerBlum48N0510": {
    "name": "Навеска Blum на саморезы 48N0510 (Л+П)",
    "unit": "компл. (Л+П)",
    "price": 54,
    "article": "48N0510.02/.03",
    "category": "fastener",
    "sourceUrl": "https://tehmob.md/15645-naves-kukhonnyj-blum-lr.html",
    "subcategory": "Blum",
    "categoryPath": [
      "Навесы",
      "Blum"
    ],
    "categoryPathEdited": true
  },
  "hangerGtvR1": {
    "name": "Навес кухонный GTV R1 ZK-R1-KPL-10 (Л+П)",
    "unit": "компл. (Л+П)",
    "price": 24,
    "article": "ZK-R1-KPL-10",
    "category": "fastener",
    "sourceUrl": "https://mobilier.md/accesorii-pentru-mobilier/furnitura-functionala/elemente-de-asamblare/zk-r1-kpl-10-suport-corp-suspendat-set-stigadreapta-alb.html",
    "subcategory": "GTV",
    "categoryPath": [
      "Навесы",
      "GTV"
    ],
    "sourceSiteId": "mobilierMd",
    "sourceArticle": "ZK-R1-KPL-10",
    "categoryPathEdited": true
  },
  "hangerGtvForzaL": {
    "name": "Навес кухонный GTV FORZA ZK-FORZA-ZAW-KPL, левый",
    "unit": "шт",
    "price": 14,
    "article": "ZK-FORZA-ZAW-KPL-L",
    "category": "fastener",
    "sourceUrl": "https://mobilier.md/ru/mebelnaya-furnitura/funkcionalnaya-furnitura/soedinitelnye-elementy/zk-forza-zaw-kpl-naves-kuhonnyy-forza-levyy.html",
    "subcategory": "GTV",
    "categoryPath": [
      "Навесы",
      "GTV"
    ],
    "sourceSiteId": "mobilierMd",
    "categoryPathEdited": true
  },
  "hangerGtvForzaR": {
    "name": "Навес кухонный GTV FORZA ZK-FORZA-ZAW-KPL, правый",
    "unit": "шт",
    "price": 14,
    "article": "ZK-FORZA-ZAW-KPL-R",
    "category": "fastener",
    "sourceUrl": "https://mobilier.md/ru/mebelnaya-furnitura/funkcionalnaya-furnitura/soedinitelnye-elementy/zk-forza-zaw-kpl-naves-kuhonnyy-forza-pravyy.html",
    "subcategory": "GTV",
    "categoryPath": [
      "Навесы",
      "GTV"
    ],
    "sourceSiteId": "mobilierMd",
    "categoryPathEdited": true
  },
  "wallRailGtv2m": {
    "name": "Шина монтажная для навесных модулей GTV LO-M2M-00-125-A, 2 м",
    "unit": "шт",
    "price": 65,
    "article": "LO-M2M-00-125-A",
    "category": "fastener",
    "sourceUrl": "https://mobilier.md/accesorii-pentru-mobilier/furnitura-functionala/elemente-de-asamblare/lo-m2m-00-125-a-bara-suport-corp-suspendat-l-2m.html",
    "subcategory": "GTV",
    "categoryPath": [
      "Навесы",
      "GTV"
    ],
    "sourceSiteId": "mobilierMd",
    "sourceArticle": "LO-M2M-00-125-A",
    "categoryPathEdited": true
  }
};
  // hangerBlum48N0510: сайт tehmob.md пока НЕ подключён в реестр парсеров
  // (server/src/services/catalogLinkParsers/registry.js) — «Обновить цены»
  // эту позицию не обновит. Альтернативный источник из реестра — sebas.md
  // (https://sebas.md/ru/shop/naveska-na-samorezy-blum/), 30 MDL, но единица
  // (шт или комплект Л+П) на сайте не указана, поэтому цена — с tehmob.md.

  // СИСТЕМЫ НАВЕСКИ ВЕРХНИХ МОДУЛЕЙ — технические данные для присадки
  // (engine.js, buildModuleParts → «НАВЕСКА ВЕРХНЕГО МОДУЛЯ») и состав
  // комплекта для сметы (specification.js). Держим ОТДЕЛЬНО от
  // FASTENER_PRICES: серверная публикация каталога (catalogPublishCodegen.js)
  // перезаписывает FASTENER_PRICES целиком, техданные там потерялись бы.
  // Размеры — по чертежу Blum 48N0510 (https://sebas.md/wp-content/uploads/
  // 2025/11/48N0510_RU.pdf, каталог Blum 2024/25 стр. 598), подтверждены
  // пользователем-технологом 2026-09-27 (ПРАВИЛА-КОНСТРУИРОВАНИЯ.md, раздел
  // «Навеска верхних модулей»):
  //   screwLineFromTop — линия саморезов ниже верха боковины, мм;
  //   screwGapFromBack — 1-й саморез от внутренней пласти задней стенки, мм
  //     (1-й саморез от стены = отступ стенки + её толщина + 14);
  //   screwStep — шаг между двумя саморезами, мм (система 32);
  //   backCut — вырез в задней стенке под крюк у каждой боковины:
  //     w — по ширине от внутренней грани боковины, h — по высоте от верха;
  //   hookReach — ход крюка: допустимое положение 1-го самореза от стены.
  // GTV — ЧЕРТЕЖА ПРОИЗВОДИТЕЛЯ НЕТ: присадка по числам Blum
  // (drawingVerified:false, в предупреждении модуля — genericNote).
  const HANGER_BLUM_GEOMETRY = {
    screwLineFromTop: 33, screwGapFromBack: 14, screwStep: 32,
    backCut: { w: 22, h: 33 }, hookReach: { min: 31, max: 45 },
  };
  const HANGER_GENERIC_NOTE = 'присадка по чертежу Blum 48N0510, не по чертежу GTV';
  const HANGER_SYSTEMS = {
    blum48N0510: Object.assign({
      name: 'Blum 48N0510 на саморезы',
      items: [{ key: 'hangerBlum48N0510', perModule: 1 }],
      drawingVerified: true,
    }, HANGER_BLUM_GEOMETRY),
    gtvR1: Object.assign({
      name: 'GTV R1 ZK-R1-KPL-10',
      items: [{ key: 'hangerGtvR1', perModule: 1 }],
      drawingVerified: false,
      genericNote: HANGER_GENERIC_NOTE,
    }, HANGER_BLUM_GEOMETRY),
    gtvForza: Object.assign({
      name: 'GTV FORZA ZK-FORZA-ZAW-KPL',
      items: [{ key: 'hangerGtvForzaL', perModule: 1 }, { key: 'hangerGtvForzaR', perModule: 1 }],
      drawingVerified: false,
      genericNote: HANGER_GENERIC_NOTE,
    }, HANGER_BLUM_GEOMETRY),
  };
  const HANGER_SYSTEM_ORDER = ['blum48N0510', 'gtvR1', 'gtvForza'];
  const DEFAULT_HANGER_SYSTEM = 'blum48N0510';
  // Шина монтажная — одна позиция на все системы навески; длина отрезка, мм.
  const WALL_RAIL_KEY = 'wallRailGtv2m';
  const WALL_RAIL_LENGTH = 2000;
  // Система доступна, только пока ВСЕ позиции её комплекта есть в каталоге
  // (ловушка как у HANDLE_ORDER/LIFT_ORDER: позицию удалили из Библиотеки —
  // ссылаться на неё нельзя). resolveHangerSystem(id) → { id, sys, warning }:
  // запрошенная недоступна — первая доступная из HANGER_SYSTEM_ORDER и
  // предупреждение; нет ни одной — sys null.
  function hangerSystemAvailable(id) {
    const s = HANGER_SYSTEMS[id];
    return !!(s && s.items.every((it) => FASTENER_PRICES[it.key]));
  }
  function resolveHangerSystem(id) {
    const want = id || DEFAULT_HANGER_SYSTEM;
    if (hangerSystemAvailable(want)) return { id: want, sys: HANGER_SYSTEMS[want], warning: null };
    const alt = HANGER_SYSTEM_ORDER.find(hangerSystemAvailable) || null;
    const nm = (HANGER_SYSTEMS[want] && HANGER_SYSTEMS[want].name) || want;
    return {
      id: alt, sys: alt ? HANGER_SYSTEMS[alt] : null,
      warning: `Навес «${nm}» удалён из каталога — `
        + (alt ? `используется «${HANGER_SYSTEMS[alt].name}».` : 'навес и его присадка не считаются.'),
    };
  }

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
  "knob": {
    "cc": 0,
    "id": "knob",
    "name": "Ручка-кнопка",
    "note": "Одно отверстие Ø5",
    "holes": 1,
    "image": "https://mobilier.md/image/cache/catalog/products/25202/372a34519f2d10b08bef212f35a9ecf8-1200x800.png",
    "price": 39,
    "article": "H-KNOB",
    "category": "handle",
    "sourceUrl": "https://mobilier.md/ru/mebelnaya-furnitura/licevaya-furnitura/mebelnye-ruchki/klassicheskie/gz-point-1-06-ruchka-knopka-point-shlifovannaya-stal.html",
    "sourceName": "GZ-POINT-1-06 Ручка-кнопка POINT, шлифованная сталь",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "subcategory": "Классика",
    "sourceSiteId": "mobilierMd"
  },
  "none": {
    "id": "none",
    "name": "Без ручек",
    "holes": 0,
    "price": 0,
    "category": "handle"
  },
  "bow96": {
    "cc": 96,
    "id": "bow96",
    "name": "Ручка-скоба 96 мм",
    "holes": 2,
    "image": "https://mobilier.md/image/cache/catalog/products/22474/9345c2a74166028f3546d248401de3ca-800x800.png",
    "price": 70,
    "article": "H-96",
    "category": "handle",
    "sourceUrl": "https://mobilier.md/ru/mebelnaya-furnitura/licevaya-furnitura/mebelnye-ruchki/modern-1/ua-b31109606mj-ruchka-ua-b311-96mm-shlifovannaya-stal.html",
    "sourceName": "UA-B31109606MJ Ручка UA-B311, 96mm, шлифованная сталь",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "subcategory": "Модерн",
    "sourceSiteId": "mobilierMd"
  },
  "bow128": {
    "cc": 128,
    "id": "bow128",
    "name": "Ручка-скоба 128 мм",
    "holes": 2,
    "image": "https://mobilier.md/image/cache/catalog/products/23266/9345c2a74166028f3546d248401de3ca-800x800.png",
    "price": 76,
    "article": "H-128",
    "category": "handle",
    "sourceUrl": "https://mobilier.md/ru/mebelnaya-furnitura/licevaya-furnitura/mebelnye-ruchki/modern-1/ua-b31112806mj-ruchka-ua-b311-128mm-shlifovannaya-stal.html",
    "sourceName": "UA-B31112806MJ Ручка UA-B311, 128mm, шлифованная сталь",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "subcategory": "Модерн",
    "sourceSiteId": "mobilierMd"
  },
  "bow160": {
    "cc": 160,
    "id": "bow160",
    "name": "Ручка-скоба 160 мм",
    "holes": 2,
    "image": "https://mobilier.md/image/cache/catalog/products/23223/9345c2a74166028f3546d248401de3ca-800x800.png",
    "price": 81,
    "article": "H-160",
    "category": "handle",
    "sourceUrl": "https://mobilier.md/ru/mebelnaya-furnitura/licevaya-furnitura/mebelnye-ruchki/modern-1/ua-b31116006mj-ruchka-ua-b311-160mm-shlifovannaya-stal.html",
    "sourceName": "UA-B31116006MJ Ручка UA-B311, 160mm, шлифованная сталь",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "subcategory": "Модерн",
    "sourceSiteId": "mobilierMd"
  },
  "bow192": {
    "cc": 192,
    "id": "bow192",
    "name": "Ручка-скоба 192 мм",
    "holes": 2,
    "image": "https://mobilier.md/image/cache/catalog/products/23223/9345c2a74166028f3546d248401de3ca-800x800.png",
    "price": 81,
    "article": "H-192",
    "category": "handle",
    "sourceUrl": "https://mobilier.md/ru/mebelnaya-furnitura/licevaya-furnitura/mebelnye-ruchki/modern-1/ua-b31116006mj-ruchka-ua-b311-160mm-shlifovannaya-stal.html",
    "sourceName": "UA-B31116006MJ Ручка UA-B311, 160mm, шлифованная сталь",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "subcategory": "Модерн",
    "sourceSiteId": "mobilierMd"
  },
  "bow224": {
    "cc": 224,
    "id": "bow224",
    "name": "Ручка-скоба 224 мм",
    "holes": 2,
    "image": "https://mobilier.md/image/cache/catalog/products/22540/9345c2a74166028f3546d248401de3ca-800x800.png",
    "price": 105,
    "article": "H-224",
    "category": "handle",
    "sourceUrl": "https://mobilier.md/ru/mebelnaya-furnitura/licevaya-furnitura/mebelnye-ruchki/modern-1/ua-b31125606mj-ruchka-ua-b311-256mm-shlifovannaya-stal.html",
    "sourceName": "UA-B31125606MJ Ручка UA-B311, 256mm, шлифованная сталь",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "subcategory": "Модерн",
    "sourceSiteId": "mobilierMd"
  },
  "bow320": {
    "cc": 320,
    "id": "bow320",
    "name": "Ручка-скоба 320 мм",
    "holes": 2,
    "image": "https://mobilier.md/image/cache/catalog/products/22549/9345c2a74166028f3546d248401de3ca-800x800.png",
    "price": 120,
    "article": "H-320",
    "category": "handle",
    "sourceUrl": "https://mobilier.md/ru/mebelnaya-furnitura/licevaya-furnitura/mebelnye-ruchki/modern-1/ua-b31132006mj-ruchka-ua-b311-320mm-shlifovannaya-stal.html",
    "sourceName": "UA-B31132006MJ Ручка UA-B311, 320mm, шлифованная сталь",
    "verifiedAt": "2026-09-24T17:35:55.812Z",
    "subcategory": "Модерн",
    "sourceSiteId": "mobilierMd"
  },
  "custom": {
    "cc": 0,
    "id": "custom",
    "name": "Скоба — задать межосевое",
    "holes": 2,
    "price": 200,
    "custom": true,
    "article": "H-CUSTOM",
    "category": "handle",
    "subcategory": "Без бренда",
    "categoryPath": [
      "Без бренда"
    ],
    "categoryPathEdited": true
  }
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
  "aventosHF": {
    "id": "aventosHF",
    "maxH": 1040,
    "maxW": 1800,
    "minH": 480,
    "name": "Blum AVENTOS HF (складной, два фасада)",
    "note": "Складывается пополам — для высоких антресолей",
    "brand": "Blum",
    "price": 8900,
    "article": "AVENTOS-HF",
    "category": "mechanism",
    "sourceUrl": "https://www.blum.com/us/en/products/liftsystems/aventos-hf/programme/"
  },
  "aventosHK": {
    "id": "aventosHK",
    "maxH": 600,
    "maxW": 1800,
    "minH": 240,
    "name": "Blum AVENTOS HK (откидной)",
    "note": "Фасад откидывается вверх одной плоскостью",
    "brand": "Blum",
    "price": 4200,
    "article": "AVENTOS-HK",
    "category": "mechanism",
    "sourceUrl": "https://www.blum.com/eu/en/products/liftsystems/aventos-hk/programme/"
  },
  "aventosHL": {
    "id": "aventosHL",
    "maxH": 580,
    "maxW": 1800,
    "minH": 300,
    "name": "Blum AVENTOS HL (параллельный подъём)",
    "note": "Фасад уходит параллельно вверх, открывая весь проём",
    "brand": "Blum",
    "price": 9800,
    "article": "AVENTOS-HL",
    "category": "mechanism",
    "sourceUrl": "https://www.blum.com/us/en/products/liftsystems/aventos-hl/programme/"
  },
  "aventosHS": {
    "id": "aventosHS",
    "maxH": 800,
    "maxW": 1800,
    "minH": 350,
    "name": "Blum AVENTOS HS (подъём над корпусом)",
    "note": "Единый фасад поднимается над корпусом",
    "brand": "Blum",
    "price": 10500,
    "article": "AVENTOS-HS",
    "category": "mechanism",
    "sourceUrl": "https://www.blum.com/us/en/products/liftsystems/aventos-hs/programme/"
  },
  "hettichHF": {
    "id": "hettichHF",
    "maxH": 1000,
    "maxW": 1200,
    "minH": 480,
    "name": "Hettich Lift Advanced HF (складной)",
    "note": "Складной фасад из двух частей",
    "brand": "Hettich",
    "price": 7600,
    "article": "HT-LIFT-HF",
    "category": "mechanism",
    "sourceUrl": "https://shop.hettich.com/us_EN/Further-products/Flap-fittings/Folding-flap-fittings/Folding-flap-fitting-Lift-Advanced-HF,-440---550/p/9079605"
  },
  "hettichHL": {
    "id": "hettichHL",
    "maxH": 700,
    "maxW": 1200,
    "minH": 200,
    "name": "Hettich Lift Advanced HL",
    "note": "Откидной подъёмник для навесных шкафов",
    "brand": "Hettich",
    "price": 3900,
    "article": "HT-LIFT-HL",
    "category": "mechanism",
    "sourceUrl": "https://shop.hettich.com/us_EN/Further-products/Flap-fittings/Flap-lift-fittings/Flap-lift-fitting-Lift-Advanced-HL,-403---462/p/9079600"
  },
  "sametRapid": {
    "id": "sametRapid",
    "maxH": 500,
    "maxW": 900,
    "minH": 200,
    "name": "Samet Rapid Lift (газовый)",
    "note": "Газовый упор с доводчиком",
    "brand": "Samet",
    "price": 1600,
    "article": "SM-RAPID",
    "category": "mechanism"
  },
  "sametSmart": {
    "id": "sametSmart",
    "maxH": 600,
    "maxW": 1000,
    "minH": 240,
    "name": "Samet Smart Lift",
    "note": "Бюджетный откидной подъёмник",
    "brand": "Samet",
    "price": 2400,
    "article": "SM-SMART",
    "category": "mechanism"
  }
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

  // Есть ли у декора рисунок (волокно), у которого вообще бывает направление.
  // Белый/чёрный ЛДСП, камень, МДФ в плёнке/эмали — гладкие, направления у них
  // нет. Тот же разбор названия, что decorLook() во viewer.js (поле wood):
  // 3D рисует текстуру ровно там, где деталировка считает, что направление
  // есть. Меняешь одно — меняй оба места. Материал не найден в каталоге —
  // true, как и во viewer.js (неизвестный декор рисуется «под древесину»).
  function decorHasPattern(code) {
    const it = findMaterialByCode(code) || findCountertopMaterialByCode(code);
    const nm = (it && it.name) || '';
    if (!nm) return true;
    if (/бел/i.test(nm)) return false;
    if (/чёрн|черн/i.test(nm)) return false;
    if (/мрамор|камень|керамика/i.test(nm)) return false;
    if (/шпон|дуб|сонома|крафт|массив|орех|ясен/i.test(nm)) return true;
    if (/крашен|эмал|плёнк|пленк|мдф/i.test(nm)) return false;
    if (/лдсп|дсп/i.test(nm) && !/стенк/i.test(nm)) return true;
    if (/компакт-плит/i.test(nm)) return true;
    return true;
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

  // Материал по умолчанию для НОВОГО/пустого проекта (решение
  // пользователя-технолога 2026-09-26): ЛДСП Egger H1145 ST10 «Дуб Бардолино
  // натуральный» — корпус, «Видимая боковина», «Материал фасада» и ящики
  // новой секции. Одна точка правды — app.js/engine.js берут его отсюда
  // (defaultDecor), а не «первым элементом DECORS»: порядок каталога
  // пользователь меняет в Библиотеке. Старые проекты со своим сохранённым
  // кодом это НЕ затрагивает.
  const DEFAULT_DECOR_CODE = 'LINK-1790014004794';
  // Объект декора по умолчанию; если позицию удалили из каталога — первый
  // оставшийся декор (запасной вариант, чтобы ядро не падало).
  function defaultDecor() {
    return DECORS.find((d) => d.code === DEFAULT_DECOR_CODE) || DECORS[0];
  }
  // Материал ящиков КУХОННЫХ модулей по умолчанию — ЛДСП «8681 SM Белый
  // бриллиант» (решение владельца 2026-09-26). У шкафов/тумб отдельного
  // дефолта нет: ящики «как корпус» (см. app.js effectiveDrawerDecorCode).
  // Действует, только пока пользователь не выбрал материал ящиков вручную
  // (sec.drawerDecorCode пуст). Если позицию удалили из каталога — ищем
  // тот же декор по названию, затем — декор по умолчанию.
  const DEFAULT_KITCHEN_DRAWER_DECOR_CODE = 'LINK-1790200284959';
  function defaultKitchenDrawerDecor() {
    return DECORS.find((d) => d.code === DEFAULT_KITCHEN_DRAWER_DECOR_CODE)
      || DECORS.find((d) => /8681/.test(d.name || ''))
      || defaultDecor();
  }

  window.Modul3D = window.Modul3D || {};
  window.Modul3D.catalog = {
    CATALOG_SOURCE,
    DECORS, BACK_MATERIALS, COUNTERTOP_MATERIALS, EDGE_PRICES, HARDWARE_PRICES, FASTENER_PRICES, JOINT_LABEL,
    DRAWER_SYSTEMS, DRAWER_SYSTEM_ORDER, pickNL, GLASS,
    FACADE_TYPES, FACADE_TYPE_ORDER, FACADE_MATERIALS,
    ALU_PROFILE_COLORS, ALU_PROFILE_COLOR_ORDER, ALU_PROFILES, ALU_PROFILE_ORDER,
    ALU_FRAME_EXTRAS, ALU_MAKERS, ALU_MAKER_ORDER,
    HANDLES, HANDLE_ORDER, HANDLE_HOLE_D, LIFTS, LIFT_ORDER,
    HANGER_SYSTEMS, HANGER_SYSTEM_ORDER, DEFAULT_HANGER_SYSTEM, WALL_RAIL_KEY, WALL_RAIL_LENGTH,
    hangerSystemAvailable, resolveHangerSystem,
    HARDWARE_CATEGORY_LABEL, HARDWARE_CATEGORY_ORDER,
    findMaterialByCode, findCountertopMaterialByCode, decorHasPattern,
    DEFAULT_DECOR_CODE, defaultDecor,
    DEFAULT_KITCHEN_DRAWER_DECOR_CODE, defaultKitchenDrawerDecor,
  };
})();
