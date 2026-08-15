// catalog.js
// ============================================================================
// Справочник материалов, фурнитуры и крепежа со стоимостью (п.3 Material &
// Hardware Library). Цены условные — заменяются на реальный прайс закупки.
//
// Классический скрипт (без import/export): подключается через <script src>
// без type="module", чтобы приложение открывалось прямо с диска (file://)
// двойным кликом, без локального сервера. Публикует себя в window.Basis.
// ============================================================================
(function () {
  const DECORS = [
    { code: 'H1180ST10', name: 'ЛДСП Egger H1180 ST10 Дуб Сонома', sheetPrice: 2800, sheetW: 2750, sheetH: 1830 },
    { code: 'U702ST9',   name: 'ЛДСП Egger U702 ST9 Белый',        sheetPrice: 2450, sheetW: 2750, sheetH: 1830 },
    { code: 'H3450ST36',  name: 'ЛДСП Egger H3450 ST36 Дуб Крафт', sheetPrice: 3100, sheetW: 2750, sheetH: 1830 },
    { code: 'U999ST2',   name: 'ЛДСП Egger U999 ST2 Чёрный',       sheetPrice: 2900, sheetW: 2750, sheetH: 1830 },
  ];

  const BACK_MATERIALS = [
    { code: 'HDF-3', name: 'ХДФ белый 3мм', sheetPrice: 900, sheetW: 2440, sheetH: 1220 },
    { code: 'HDF-8', name: 'ЛДСП 8мм (усиленная задняя стенка)', sheetPrice: 1500, sheetW: 2750, sheetH: 1830 },
  ];

  // Стекло для полок и фасадов: считается по площади, кромка не нужна —
  // торцы шлифуются на производстве стекла.
  const GLASS = { code: 'GLASS-6', name: 'Стекло 6 мм (полки, фасады)',
                  sheetPrice: 3200, sheetW: 2000, sheetH: 1000, thickness: 6 };

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
    'FAC-LDSP': { code: 'FAC-LDSP', name: 'ЛДСП 18 мм (фасад)', sheetPrice: 2800, sheetW: 2750, sheetH: 1830 },
    'FAC-MDF':  { code: 'FAC-MDF',  name: 'МДФ крашеный 19 мм', sheetPrice: 6900, sheetW: 2800, sheetH: 2070 },
    'FAC-WOOD': { code: 'FAC-WOOD', name: 'Массив дуба 20 мм', sheetPrice: 18500, sheetW: 2000, sheetH: 1000 },
    'FAC-ALU':  { code: 'FAC-ALU',  name: 'Алюминиевый профиль (рамка)', sheetPrice: 9800, sheetW: 2000, sheetH: 1000 },
    // Видимая боковина под деревянный фасад: массивом её не делают —
    // ставят МДФ в шпоне того же дерева.
    'FAC-VENEER': { code: 'FAC-VENEER', name: 'МДФ шпонированный 18 мм (видимая боковина)',
                    sheetPrice: 7400, sheetW: 2800, sheetH: 2070 },
    'GLASS-4':  { code: 'GLASS-4',  name: 'Стекло 4 мм (фасад)', sheetPrice: 2600, sheetW: 2000, sheetH: 1000 },
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
    wood:      { id: 'wood', name: 'Фасад деревянный', material: 'FAC-WOOD', thickness: 20,
                 render: 'frame', frame: 70, glassInside: false },
    woodGlass: { id: 'woodGlass', name: 'Фасад деревянный с витражом', material: 'FAC-WOOD', thickness: 20,
                 render: 'frameGlass', frame: 70, insert: 'GLASS-4', glassInside: true },
    alu:       { id: 'alu', name: 'Фасад из алюминиевого профиля', material: 'FAC-ALU', thickness: 20,
                 render: 'frameGlass', frame: 24, insert: 'GLASS-4', glassInside: true },
  };
  const FACADE_TYPE_ORDER = ['ldsp', 'mdf', 'mdfMilled', 'glass4', 'wood', 'woodGlass', 'alu'];

  const EDGE_PRICES = {
    'ПВХ 2 мм': 15,
    'ПВХ 0.4 мм': 6,
  };

  const HARDWARE_PRICES = {
    hinge: { name: 'Петля накладная Blum CLIP 110°', article: 'BLUM-CLIP', price: 210, unit: 'шт' },
    handle: { name: 'Ручка мебельная скоба 128мм', article: 'RH-128', price: 90, unit: 'шт' },
    drawerRunnerPair: { name: 'Направляющие шариковые 500мм (пара)', article: 'DR-500', price: 350, unit: 'пара' },
    leg: { name: 'Опора мебельная никелированная Ø50, регулируемая h100', article: 'LEG-D50-100', price: 145, unit: 'шт' },
    legPlastic: { name: 'Опора пластиковая регулируемая h100 (кухонная)', article: 'LEG-PL-100', price: 45, unit: 'шт' },
    shelfSupport: { name: 'Полкодержатель штифт 5мм', article: 'SUP-5', price: 5, unit: 'шт' },
    shelfSupportGlass: { name: 'Полкодержатель для стекла с силиконовой пяткой Ø5',
                         article: 'SUP-5G', price: 28, unit: 'шт' },
    hingeGlass: { name: 'Петля для стеклянной двери (отверстие Ø26)',
                  article: 'HNG-GLASS', price: 520, unit: 'шт' },
    plinthClip: { name: 'Крепление цоколя', article: 'PLC-1', price: 25, unit: 'шт' },
    pushToOpen: { name: 'Механизм Push-to-open (толкатель)', article: 'PTO-1', price: 320, unit: 'шт' },
    rod: { name: 'Штанга для одежды хромированная Ø25', article: 'ROD-D25', price: 120, unit: 'пог.м' },
    rodHolder: { name: 'Держатель штанги Ø25 (пара)', article: 'ROD-H25', price: 70, unit: 'пара' },
  };

  const FASTENER_PRICES = {
    confirmat: { name: 'Конфирмат 7х50', article: 'CONF-50', price: 3, unit: 'шт' },
    minifixBolt: { name: 'Rastex шток', article: 'RASTEX-BOLT-8', price: 6, unit: 'шт' },
    minifixCam: { name: 'Rastex эксцентрик', article: 'RASTEX-CAM-15', price: 12, unit: 'шт' },
    dowel: { name: 'Шкант 8х30', article: 'DWL-30', price: 1, unit: 'шт' },
    backPanelScrew: { name: 'Шуруп-стяжка задней стенки', article: 'SCR-15', price: 1.5, unit: 'шт' },
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
  const DRAWER_SYSTEMS = {
    tandembox: {
      src: 'Blum, каталог TANDEMBOX antaro, раздел «Cutting»',
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
      setPrice: 350,
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
    none:    { id: 'none', name: 'Без ручек', holes: 0, price: 0 },
    knob:    { id: 'knob', name: 'Ручка-кнопка', holes: 1, cc: 0, price: 120,
               article: 'H-KNOB', note: 'Одно отверстие Ø5' },
    bow96:   { id: 'bow96', name: 'Ручка-скоба 96 мм', holes: 2, cc: 96, price: 90, article: 'H-96' },
    bow128:  { id: 'bow128', name: 'Ручка-скоба 128 мм', holes: 2, cc: 128, price: 100, article: 'H-128' },
    bow160:  { id: 'bow160', name: 'Ручка-скоба 160 мм', holes: 2, cc: 160, price: 120, article: 'H-160' },
    bow192:  { id: 'bow192', name: 'Ручка-скоба 192 мм', holes: 2, cc: 192, price: 140, article: 'H-192' },
    bow224:  { id: 'bow224', name: 'Ручка-скоба 224 мм', holes: 2, cc: 224, price: 160, article: 'H-224' },
    bow320:  { id: 'bow320', name: 'Ручка-скоба 320 мм', holes: 2, cc: 320, price: 210, article: 'H-320' },
    // Межосевое задаётся вручную: нестандартная или дизайнерская скоба.
    custom:  { id: 'custom', name: 'Скоба — задать межосевое', holes: 2, cc: 0, price: 200,
               article: 'H-CUSTOM', custom: true },
  };
  const HANDLE_ORDER = ['none', 'knob', 'bow96', 'bow128', 'bow160', 'bow192', 'bow224', 'bow320', 'custom'];

  // ---------------------------------------------------------------------------
  // ПОДЪЁМНЫЕ МЕХАНИЗМЫ (фасад откидывается вверх)
  // Область применения — по высоте фасада и ширине корпуса, по каталогам
  // производителей. minH/maxH — высота фасада, maxW — ширина корпуса, мм.
  // ---------------------------------------------------------------------------
  const LIFTS = {
    aventosHK:  { id: 'aventosHK', brand: 'Blum', name: 'Blum AVENTOS HK (откидной)',
                  article: 'AVENTOS-HK', price: 4200, minH: 240, maxH: 600, maxW: 1800,
                  note: 'Фасад откидывается вверх одной плоскостью' },
    aventosHF:  { id: 'aventosHF', brand: 'Blum', name: 'Blum AVENTOS HF (складной, два фасада)',
                  article: 'AVENTOS-HF', price: 8900, minH: 480, maxH: 1040, maxW: 1800,
                  note: 'Складывается пополам — для высоких антресолей' },
    aventosHL:  { id: 'aventosHL', brand: 'Blum', name: 'Blum AVENTOS HL (параллельный подъём)',
                  article: 'AVENTOS-HL', price: 9800, minH: 300, maxH: 580, maxW: 1800,
                  note: 'Фасад уходит параллельно вверх, открывая весь проём' },
    aventosHS:  { id: 'aventosHS', brand: 'Blum', name: 'Blum AVENTOS HS (подъём над корпусом)',
                  article: 'AVENTOS-HS', price: 10500, minH: 350, maxH: 800, maxW: 1800,
                  note: 'Единый фасад поднимается над корпусом' },
    hettichHL:  { id: 'hettichHL', brand: 'Hettich', name: 'Hettich Lift Advanced HL',
                  article: 'HT-LIFT-HL', price: 3900, minH: 200, maxH: 700, maxW: 1200,
                  note: 'Откидной подъёмник для навесных шкафов' },
    hettichHF:  { id: 'hettichHF', brand: 'Hettich', name: 'Hettich Lift Advanced HF (складной)',
                  article: 'HT-LIFT-HF', price: 7600, minH: 480, maxH: 1000, maxW: 1200,
                  note: 'Складной фасад из двух частей' },
    sametSmart: { id: 'sametSmart', brand: 'Samet', name: 'Samet Smart Lift',
                  article: 'SM-SMART', price: 2400, minH: 240, maxH: 600, maxW: 1000,
                  note: 'Бюджетный откидной подъёмник' },
    sametRapid: { id: 'sametRapid', brand: 'Samet', name: 'Samet Rapid Lift (газовый)',
                  article: 'SM-RAPID', price: 1600, minH: 200, maxH: 500, maxW: 900,
                  note: 'Газовый упор с доводчиком' },
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

  window.Basis = window.Basis || {};
  window.Basis.catalog = {
    DECORS, BACK_MATERIALS, EDGE_PRICES, HARDWARE_PRICES, FASTENER_PRICES, JOINT_LABEL,
    DRAWER_SYSTEMS, DRAWER_SYSTEM_ORDER, pickNL, GLASS,
    FACADE_TYPES, FACADE_TYPE_ORDER, FACADE_MATERIALS,
    HANDLES, HANDLE_ORDER, HANDLE_HOLE_D, LIFTS, LIFT_ORDER,
  };
})();
