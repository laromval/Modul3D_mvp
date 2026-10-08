// specification.js
// ============================================================================
// Specification Module — формирует сводную спецификацию ИСКЛЮЧИТЕЛЬНО из
// деталировки (model.parts) и параметров фурнитуры/крепежа. Ручного
// дублирования ввода нет — это требование п.7 и критерий приёмки п.13.
//
// Классический скрипт (без import/export) — публикует себя в window.Modul3D,
// зависит от window.Modul3D.catalog (должен быть подключен раньше в index.html).
// ============================================================================
(function () {
const { EDGE_PRICES, HARDWARE_PRICES, FASTENER_PRICES, JOINT_LABEL, DRAWER_SYSTEMS,
        HANDLES, LIFTS, GLASS, FACADE_MATERIALS, DECORS, BACK_MATERIALS, COUNTERTOP_MATERIALS,
        findMaterialByCode, findCountertopMaterialByCode } = window.Modul3D.catalog;

function round2(v) { return Math.round(v * 100) / 100; }

function hingesPerDoor(heightMm) {
  if (heightMm <= 900) return 2;
  if (heightMm <= 1600) return 3;
  if (heightMm <= 2200) return 4;
  return 5;
}

function buildSpecification(model) {
  const { parts, hardwareContext, dims } = model;
  const proj = model.project;                 // общие материалы проекта
  const mods = proj.modules;
  const decor = proj.decor, back = proj.backMaterial;
  const drawerDecor = proj.drawerDecor || decor;

  // ---------- 1. Листовые материалы ----------
  const areaByMaterial = new Map(); // code -> {area_m2, priceInfo}
  // Известные листовые материалы: весь каталог декоров/задних стенок/фасадов,
  // а не только выбранные на уровне проекта — деталь с ручным override
  // материала (part.overrides, см. режим фокуса на модуле) может ссылаться
  // на любой каталожный код, не только на decor/back/drawerDecor проекта;
  // иначе её площадь молча выпадает из сметы (см. п.4 архитектуры override).
  const known = [decor, back, drawerDecor, GLASS]
    .concat(DECORS, BACK_MATERIALS)
    .concat(Object.keys(FACADE_MATERIALS).map((k) => FACADE_MATERIALS[k]))
    .filter(Boolean);
  for (const row of parts) {
    // Алюминиевый рамочный фасад — не деталь из листа: считается отдельным
    // блоком aluFacades ниже (покупной у производителя / своё изготовление).
    if (row.aluFrame) continue;
    const info = known.filter((x) => x.code === row.material)[0] || null;
    if (!info) continue;
    const areaM2 = (row.length * row.width * row.qty) / 1_000_000;
    const acc = areaByMaterial.get(row.material) || { area_m2: 0, info };
    acc.area_m2 += areaM2;
    areaByMaterial.set(row.material, acc);
  }
  const WASTE_FACTOR = 1.15; // технологический запас на раскрой/отходы
  const sheetMaterials = Array.from(areaByMaterial.entries()).map(([code, acc]) => {
    // customOrder (см. catalog.js: GLASS/GLASS-4/FAC-WOOD-*) — не плитный
    // материал, кроятся не из закупленных листов, а изготавливаются на
    // заказ точно по площади: без запаса на раскрой и без округления до
    // целых «листов» (sheetW/sheetH у таких позиций и не задаются).
    if (acc.info.customOrder) {
      // Цена не указана (зеркало MIRROR-4 до ответа поставщиков): sum null —
      // 0 не подставляем, позиция попадает в unpricedItems.
      const sp = acc.info.sheetPrice;
      const hasPrice = sp !== null && sp !== undefined && Number.isFinite(Number(sp));
      return {
        code, name: acc.info.name, area_m2: round2(acc.area_m2),
        sheetArea_m2: null, sheets: null, price: hasPrice ? sp : null,
        sum: hasPrice ? round2(acc.area_m2 * sp) : null,
        priceConfirmed: hasPrice,
        note: hasPrice ? '' : `Цена: ${acc.info.priceNote || 'уточняйте у поставщика'}`,
      };
    }
    const sheetArea = (acc.info.sheetW * acc.info.sheetH) / 1_000_000;
    const sheets = Math.ceil((acc.area_m2 * WASTE_FACTOR) / sheetArea);
    return {
      code, name: acc.info.name, area_m2: round2(acc.area_m2),
      sheetArea_m2: round2(sheetArea), sheets, price: acc.info.sheetPrice,
      sum: sheets * acc.info.sheetPrice,
    };
  });

  // ---------- 2. Кромочный материал ----------
  const edgeLenByType = new Map(); // type -> meters
  for (const row of parts) {
    const e = row.edging;
    const add = (type, lenMm) => {
      if (!type) return;
      edgeLenByType.set(type, (edgeLenByType.get(type) || 0) + (lenMm * row.qty) / 1000);
    };
    add(e.long1, row.length); add(e.long2, row.length);
    add(e.short1, row.width); add(e.short2, row.width);
  }
  const edging = Array.from(edgeLenByType.entries()).map(([type, length_m]) => {
    const price = EDGE_PRICES[type]?.price ?? 0;
    return { type, length_m: round2(length_m), price_per_m: price, sum: round2(length_m * price) };
  });

  // ---------- Столешница (погонный метр) ----------
  // Реальные позиции COUNTERTOP_MATERIALS продаются погонным метром, а не
  // листом — считаем длину, не площадь, тем же паттерном, что и кромка выше.
  // Сдвоенная столешница (p.countertop.double) сюда не попадает: это не
  // каталожная позиция COUNTERTOP_MATERIALS, её площадь уже посчитана в
  // листовом блоке выше (материал = dec.code декора, выбранного на панели
  // столешницы, qty:2).
  const ctLenByCode = new Map();
  for (const row of parts) {
    if (row.kind !== 'countertop') continue;
    const info = (COUNTERTOP_MATERIALS || []).find((m) => m.code === row.material);
    if (!info) continue;
    ctLenByCode.set(row.material, (ctLenByCode.get(row.material) || 0) + (row.length * row.qty) / 1000);
  }
  const countertopMaterials = Array.from(ctLenByCode.entries()).map(([code, length_m]) => {
    const info = COUNTERTOP_MATERIALS.find((m) => m.code === code);
    const price = info.pricePerMeter;
    return {
      code, name: info.name, length_m: round2(length_m),
      price_per_m: price, sum: price != null ? round2(length_m * price) : null,
      priceConfirmed: price != null,
    };
  });

  // ---------- 3. Фурнитура ----------
  const hardware = [];
  let hingeCount = 0;
  for (const d of hardwareContext.doorHardware) {
    hingeCount += hingesPerDoor(d.height) * d.leaves;
  }
  const doorLeaves = hardwareContext.doorHardware.reduce((s, d) => s + d.leaves, 0);
  const drawerCount = hardwareContext.drawerHardware.length;
  // Push-to-open: у таких фасадов ручек нет, вместо них ставится толкатель
  const pushDoors = hardwareContext.doorHardware.filter(d => d.pushToOpen).reduce((s, d) => s + d.leaves, 0);
  const pushDrawers = hardwareContext.drawerHardware.filter(d => d.pushToOpen).length;

  // Петли: для стеклянных дверей — свои, с отверстием Ø26 насквозь
  const glassHinges = parts.reduce((s2, r) =>
    s2 + (r.holes || []).filter((h) => h.kind === 'hingeGlass').length * r.qty, 0);
  const cupHinges = parts.reduce((s2, r) =>
    s2 + (r.holes || []).filter((h) => h.kind === 'hingeCup').length * r.qty, 0);
  if (cupHinges > 0) hardware.push(hwRow(HARDWARE_PRICES.hinge, cupHinges));
  if (glassHinges > 0) hardware.push(hwRow(HARDWARE_PRICES.hingeGlass, glassHinges));
  // Двери из алюм. рамки на петле «для алюминиевой рамки» (engine.js,
  // doorHardware.aluHinge): чашку под них не сверлим, поэтому по отверстиям
  // они не видны — считаем по стандартному числу петель на дверь. Позиция —
  // ALU_FRAME_EXTRAS.hinge (Blum 71T950A); пока цены нет — sum: null.
  const aluHingeCount = hardwareContext.doorHardware.filter((d) => d.aluHinge)
    .reduce((s, d) => s + hingesPerDoor(d.height) * d.leaves, 0);
  const stdHingeCount = hingeCount - aluHingeCount;
  if (!cupHinges && !glassHinges && stdHingeCount > 0) hardware.push(hwRow(HARDWARE_PRICES.hinge, stdHingeCount));
  if (aluHingeCount > 0) {
    const ah = (window.Modul3D.catalog.ALU_FRAME_EXTRAS || {}).hinge || {};
    const ahPrice = typeof ah.price === 'number' && ah.price >= 0 ? ah.price : null;
    hardware.push({ name: ah.name || 'Петля для алюминиевой рамки', article: ah.article || '', unit: 'шт', qty: aluHingeCount,
      price: ahPrice, sum: ahPrice !== null ? round2(ahPrice * aluHingeCount) : null, priceConfirmed: ahPrice !== null,
      note: ah.priceNote || 'уточняйте цену у поставщика' });
  }
  // Ручки считаются ниже — по фактически расставленным на фасадах, с учётом
  // выбранной модели и второй ручки на широком фасаде.
  const pushCount = pushDoors + pushDrawers;
  if (pushCount > 0) hardware.push(hwRow(HARDWARE_PRICES.pushToOpen, pushCount));
  // Направляющие отдельной строкой НЕ добавляем: они входят в комплект
  // выбранной ящичной системы (см. ниже), иначе получается двойной счёт.

  // Опоры и крепления цоколя считаем по каждому модулю отдельно —
  // основание у модулей может быть разное.
  // Ножки берём НЕ по формуле, а по факту построенных опор — тогда
  // спецификация и 3D-модель не могут разойтись.
  // Опоры берём по факту построенных и различаем металлические и пластиковые
  // кухонные — это разные позиции и разная цена.
  const legs = parts.filter((r) => r.kind === 'leg');
  const legChrome = legs.filter((r) => !r.plastic).reduce((s, r) => s + r.qty, 0);
  const legPlast = legs.filter((r) => r.plastic).reduce((s, r) => s + r.qty, 0);
  // Клипсы нужны там, где цоколь навесной или несущий: считаем по модулям с цоколем.
  let clipCount = 0;
  for (const m of mods) {
    const t = m.base && m.base.type;
    if (t === 'plinth' || t === 'legsPlinth') {
      clipCount += Math.max(2, Math.round(Number(m.width) / 400));
    }
  }
  // ОСТРОВ: у заднего цоколя свои клипсы (engine.js, leg.clipRear) — считаем
  // по факту построенных опор с клипсой заднего цоколя (передний ряд — формулой
  // выше, как и раньше). Боковые цоколи острова крепятся шкантами, не клипсами.
  // (partsRaw — до склейки одинаковых деталей: в склеенной строке опор признак
  // clipRear потерялся бы вместе с первой деталью.)
  clipCount += (model.partsRaw || parts)
    .filter((r) => r.kind === 'leg' && r.clipRear && r.hasClip)
    .reduce((s, r) => s + (r.qty || 1), 0);
  if (legChrome) hardware.push(hwRow(HARDWARE_PRICES.leg, legChrome));
  if (legPlast) hardware.push(hwRow(HARDWARE_PRICES.legPlastic, legPlast));
  if (clipCount) hardware.push(hwRow(HARDWARE_PRICES.plinthClip, clipCount));

  // Комплекты ящичных систем — по фактически применённым вариантам:
  // группа = (система, NL, высота царги, цвет). У позиции Библиотеки с options
  // (catalog.resolveOption) цена и артикул берутся из варианта; без вариантов
  // (старые проекты, ballBearing) — цена комплекта из позиции, как раньше.
  const cat = window.Modul3D.catalog;
  const drawerSets = new Map();
  for (const d of hardwareContext.drawerHardware) {
    const id = d.system || 'ballBearing';
    const sys = DRAWER_SYSTEMS[id];
    if (!sys) continue;
    const libItem = sys.priceKey && HARDWARE_PRICES[sys.priceKey];
    const hasOpts = !!(libItem && cat.itemOptions(libItem).length);
    let nlV = d.nl, hV = d.heightCode, color = '';
    if (hasOpts) {
      const colors = cat.optionColors(libItem);
      color = colors.indexOf(d.color) >= 0 ? d.color : (colors.indexOf(libItem.selColor) >= 0 ? libItem.selColor : (colors[0] || ''));
    } else if (sys.fixedColor) {
      color = sys.fixedColor;
    }
    if (!hasOpts) { nlV = null; hV = null; }
    const key = [id, nlV == null ? '' : nlV, hV == null ? '' : hV, color].join('|');
    let g = drawerSets.get(key);
    if (!g) { g = { id, sys, libItem, hasOpts, nl: nlV, heightCode: hV, color, qty: 0 }; drawerSets.set(key, g); }
    g.qty++;
  }
  for (const g of drawerSets.values()) {
    const { sys, libItem } = g;
    // Цена — позиция Библиотеки «Фурнитура» (sys.priceKey), чтобы её можно
    // было править там и обновлять с сайта; setPrice — у систем без позиции.
    let setPrice = Number(libItem ? libItem.price : sys.setPrice) || 0;
    let article = g.id;
    let note;
    const label = [];
    if (g.nl != null) label.push('NL ' + g.nl);
    if (g.heightCode != null && g.heightCode !== '') {
      label.push(sys.metal && /^[A-Z]$/.test(String(g.heightCode)) ? 'царга ' + g.heightCode : 'высота ' + g.heightCode);
    }
    if (g.color) label.push(g.color);
    if (g.hasOpts) {
      const hasH = cat.optionHeights(libItem).length > 0;
      const o = (g.nl != null && (g.heightCode != null || !hasH))
        ? cat.resolveOption(libItem, { length: g.nl, height: g.heightCode, color: g.color }) : null;
      const exact = o && o.length === g.nl && o.color === g.color && (!hasH || String(o.height) === String(g.heightCode));
      if (exact) {
        if (o.price != null) setPrice = Number(o.price) || 0;
        article = o.article || '';
      } else {
        article = libItem.article || '';
        note = 'нет карточки для ' + (g.nl != null ? 'NL ' + g.nl : 'этой длины')
          + (hasH && g.heightCode ? ' / высоты ' + g.heightCode : '') + ' — цена ориентировочная';
      }
    }
    const row = {
      name: label.length ? sys.setName + ', ' + label.join(', ') : sys.setName,
      article, unit: 'компл.',
      qty: g.qty, price: setPrice,
      sum: round2(g.qty * setPrice),
    };
    if (note) row.note = note;
    hardware.push(row);
  }

  // Полкодержатели: под стеклянную полку нужен держатель с силиконовой пяткой.
  // Несъёмные полки-перегородки (fixed, см. engine.js) держатся минификсами
  // Rastex, а не штифтами — их фурнитура уже учтена в jointRows ниже, сюда
  // не попадают, иначе штифты насчитались бы вдвойне.
  const shelvesAll = parts.filter(r => r.kind === 'shelf' && !r.fixed);
  const shelfCount = shelvesAll.filter(r => !r.glass).reduce((s, r) => s + r.qty, 0);
  const shelfGlassCount = shelvesAll.filter(r => r.glass).reduce((s, r) => s + r.qty, 0);
  if (shelfGlassCount > 0) hardware.push(hwRow(HARDWARE_PRICES.shelfSupportGlass, shelfGlassCount * 4));
  if (shelfCount > 0) hardware.push(hwRow(HARDWARE_PRICES.shelfSupport, shelfCount * 4));

  // Ручки: считаем по факту расставленных на фасадах, каждая модель — своей
  // строкой. Старая строка «ручка на каждый фасад» больше не нужна.
  const handleByModel = new Map();
  for (const h of (hardwareContext.handleHardware || [])) {
    handleByModel.set(h.id, (handleByModel.get(h.id) || 0) + (h.qty || 1));
  }
  for (const [id, qty] of handleByModel) {
    const info = HANDLES[id];
    if (info && info.holes) {
      hardware.push({ name: info.name, article: info.article, unit: 'шт', qty,
        price: info.price, sum: round2(qty * info.price) });
    }
  }

  // Подъёмные механизмы — по секциям с откидными фасадами
  const liftCount = new Map();
  for (const l of (hardwareContext.liftHardware || [])) {
    liftCount.set(l.id, (liftCount.get(l.id) || 0) + (l.qty || 1));
  }
  for (const [id, qty] of liftCount) {
    const info = LIFTS[id];
    if (info) {
      hardware.push({ name: info.name, article: info.article, unit: 'компл.', qty,
        price: info.price, sum: round2(qty * info.price) });
    }
  }

  // Штанги считаем по факту построенных: длина в пог. м и по паре держателей.
  const rods = parts.filter((r) => r.kind === 'rod');
  const rodMeters = rods.reduce((s, r) => s + (r.length * r.qty) / 1000, 0);
  if (rodMeters > 0) {
    hardware.push(hwRow(HARDWARE_PRICES.rod, Math.ceil(rodMeters * 100) / 100));
    hardware.push(hwRow(HARDWARE_PRICES.rodHolder, rods.reduce((s, r) => s + r.qty, 0)));
  }

  // Пантограф: один на секцию, вариант (длина) — по ширине секции (part.length),
  // цвет — выбранный в Библиотеке (item.selColor). У варианта своя цена/артикул.
  const pantoItem = HARDWARE_PRICES.pantograph;
  if (pantoItem) {
    for (const pg of parts.filter((r) => r.kind === 'pantograph')) {
      const cat = window.Modul3D.catalog;
      const o = (cat.resolveOption(pantoItem, { width: pg.length, color: pg.pantographColor })
        // ширина вне диапазонов — ближайший размер (в 3D уже есть предупреждение)
        || cat.resolveOption(pantoItem, { width: pg.length < 545 ? 545 : 1200, color: pg.pantographColor }));
      const info = o ? Object.assign({}, pantoItem, {
        price: o.price != null ? o.price : pantoItem.price,
        article: o.article || pantoItem.article,
        name: `${pantoItem.name}, ${o.length} мм, ${o.color}`,
      }) : pantoItem;
      hardware.push(hwRow(info, pg.qty));
    }
  }

  // ---------- 4. Крепёж / метизы ----------
  const fasteners = [];
  // Крепёж корпуса берём ПО ФАКТУ присадки: тип выбран по конструктиву
  // боковины (см. engine.jointForSide), поэтому в одном проекте могут быть
  // и минификсы, и конфирматы одновременно.
  const rows = hardwareContext.jointRows || [];
  const byJoint = new Map();
  for (const r of rows) byJoint.set(r.joint, (byJoint.get(r.joint) || 0) + r.qty);
  // Rastex (минификс) — на каждый узел один шток и один эксцентрик, в спецификации
  // это две отдельные позиции, а не общий «комплект».
  const pushJointFasteners = (jt, qty) => {
    if (!qty) return;
    if (jt === 'minifix') {
      fasteners.push(fRow(FASTENER_PRICES.minifixBolt, qty));
      fasteners.push(fRow(FASTENER_PRICES.minifixCam, qty));
      return;
    }
    const info = FASTENER_PRICES[jt];
    if (info) fasteners.push(fRow(info, qty));
  };
  for (const [jt, qty] of byJoint) pushJointFasteners(jt, qty);
  // НАГЕЛИ (шканты) считаем ПО ФАКТУ присадки: их ставят рядом с одиночным
  // крепежом, чтобы узкая планка не проворачивалась вокруг его оси.
  const dowelQty = parts.reduce((sum, p) => sum
    + ((p.holes || []).filter((h) => h.kind === 'dowelEdge').length) * (p.qty || 1), 0);
  if (dowelQty) fasteners.push(fRow(FASTENER_PRICES.dowel, dowelQty));
  if (!byJoint.size && hardwareContext.jointCount) {
    // старый проект без разбивки — считаем по общему числу стыков
    pushJointFasteners(proj.jointType || 'confirmat', hardwareContext.jointCount * 3);
  }
  const jointType = proj.jointType || 'confirmat';

  // Шурупы задней стенки: число на каждую стенку считает engine.js
  // (part.screws — шаг 150 мм по каждой линии контакта, см. «Шурупы задней
  // стенки» в buildModuleParts). Берём НЕсклеенный partsRaw: две одинаковые
  // по размеру стенки могут крепиться разным числом шурупов (стойки,
  // несъёмные полки), а в склеенной строке деталировки осталось бы число
  // только первой. Старая модель без поля screws — прежние 10 на стенку.
  const SCREWS_PER_BACK_FALLBACK = 10;
  const isBack = (r) => r.kind === 'back' || r.name === 'Задняя стенка';
  const backScrews = (model.partsRaw || parts).filter(isBack).reduce((s, r) => s
    + (Number.isFinite(r.screws) ? r.screws : SCREWS_PER_BACK_FALLBACK) * (r.qty || 1), 0);
  if (backScrews > 0) fasteners.push(fRow(FASTENER_PRICES.backPanelScrew, backScrews));

  // Навесы верхних модулей: по одному комплекту системы на навесной модуль
  // (engine.js applyWallHanger → hardwareContext.hangerHardware), состав
  // комплекта — catalog.HANGER_SYSTEMS[system].items; одинаковые позиции
  // суммируются. Шина монтажная — сумма отрезков по непрерывным участкам
  // верхнего ряда (hardwareContext.wallRails).
  const hangerSystems = window.Modul3D.catalog.HANGER_SYSTEMS || {};
  const hangerQty = new Map();
  for (const h of (hardwareContext.hangerHardware || [])) {
    const sys = hangerSystems[h.system];
    if (!sys) continue;
    for (const it of sys.items) {
      hangerQty.set(it.key, (hangerQty.get(it.key) || 0) + (it.perModule || 1) * (h.qty || 1));
    }
  }
  for (const [key, qty] of hangerQty) {
    if (FASTENER_PRICES[key] && qty > 0) fasteners.push(fRow(FASTENER_PRICES[key], qty));
  }
  const railKey = window.Modul3D.catalog.WALL_RAIL_KEY;
  const railPieces = (hardwareContext.wallRails || []).reduce((s, r) => s + (r.pieces || 0), 0);
  if (railPieces > 0 && FASTENER_PRICES[railKey]) {
    fasteners.push(fRow(FASTENER_PRICES[railKey], railPieces));
  }

  // ---------- Столешница: крепёж ----------
  // Шаг расчёта количества (ширина/400, минимум 2) намеренно повторяет
  // существующую формулу clipCount выше (крепление цоколя) — тот же принцип
  // редкого крепежа вдоль планки шириной модуля, а не новая придуманная
  // константа.
  // Компакт-плита (12мм HPL) тонкая и плохо сверлится — крепится ТОЛЬКО
  // клеем на сплошную опору (крышку/царги), растикс в торец боковины ей не
  // подходит (подтверждено пользователем-мебельщиком, 2026-09-05; см. тот
  // же принцип уже в joinCountertopSeams — там compact12 тоже всегда клей,
  // не стяжка). worktopGlueQty — счётчик количества модулей, не расход
  // клея по площади (формулы расхода нет ни в правилах, ни в каталоге).
  // Клей — только для материалов, где engine.js НЕ убирает крышку (толщина
  // резолвнутого материала ≤18мм) — БЕЛЫМ списком, а не "всё, что толще
  // X", иначе старый/битый проект без decorCode (engine.js в этом случае
  // оставляет крышку, безопасный дефолт) здесь ошибочно попал бы в "клей"
  // вместо факта, что крышка просто есть и крепёж — обычные шурупы/присадка
  // крышки.
  // Изменено 2026-09-06: столешница больше не делится на «тип материала»
  // (ldsp38/compact12/doubleLdsp/custom) — единый m.countertop.decorCode
  // (+ отдельная галочка double) для ЛЮБОГО пути. Правило то же, что и в
  // engine.js (countertopMat()/skipTopPanel) — единое для ВСЕХ путей
  // резолва, по РЕАЛЬНОЙ толщине найденного материала (>18мм), без
  // хардкода по коду/materialId позиции.
  const ctSkipsTopPanel = (m) => {
    if (m.countertop.double) return true;
    const ctCat = m.countertop.decorCode ? findCountertopMaterialByCode(m.countertop.decorCode) : null;
    if (ctCat) return Number(ctCat.thickness) > 18;
    const dec = m.countertop.decorCode ? findMaterialByCode(m.countertop.decorCode) : null;
    return !!dec && Number(dec.thickness) > 18;
  };
  let worktopScrewQty = 0, worktopGlueQty = 0;
  for (const m of mods) {
    if (!m.countertop || !m.countertop.enabled) continue;
    if (m.topType === 'railsEdge') {
      worktopScrewQty += Math.max(2, Math.round(Number(m.width) / 400));
    } else if (m.topType === 'rails') {
      // планки плашмя: шурупы считаем по реальным сквозным отверстиям (ниже)
    } else if (!ctSkipsTopPanel(m)) {
      worktopGlueQty += 1;
    }
  }
  for (const r of parts) {
    const n = (r.holes || []).filter((h) => h.kind === 'countertopScrew').length;
    if (n) worktopScrewQty += n * (r.qty || 1);
  }
  if (worktopScrewQty) fasteners.push(fRow(FASTENER_PRICES.worktopScrew, worktopScrewQty));
  // Растикс боковина-столешница — считаем по РЕАЛЬНЫМ отверстиям
  // (engine.js buildModuleParts), а не отдельной формулой: число точек на
  // боковину может зависеть от её глубины (см. crossYs/JOINT_SETBACK там же)
  // — фиксированная константа тут разошлась бы с фактической присадкой при
  // следующем изменении. Фильтр по forJoint==='countertop' ОБЯЗАТЕЛЕН, не
  // только по kind==='minifixCam' — на той же боковине может быть minifixCam
  // от СОВСЕМ ДРУГОГО узла (например, глухая накладная панель), который уже
  // учтён отдельно через hardwareContext.jointRows — без метки он задвоился
  // бы (найдено на ревью 2026-09-06). minifixBolt/minifixCam всегда 1:1 на
  // боковине (см. engine.js), считаем по любому из них.
  let worktopRastexQty = 0;
  for (const r of parts) {
    if (r.kind !== 'side') continue;
    const cams = (r.holes || []).filter((h) => h.kind === 'minifixCam' && h.forJoint === 'countertop').length;
    if (cams) worktopRastexQty += cams * (r.qty || 1);
  }
  if (worktopRastexQty) {
    fasteners.push(fRow(FASTENER_PRICES.minifixBolt, worktopRastexQty));
    fasteners.push(fRow(FASTENER_PRICES.minifixCam, worktopRastexQty));
  }
  if (worktopGlueQty) hardware.push(hwRow(HARDWARE_PRICES.countertopGlueToCarcass, worktopGlueQty));
  for (const j of (hardwareContext.countertopJoints || [])) {
    for (const h of j.hardware) {
      const info = HARDWARE_PRICES[h.key];
      if (info) hardware.push(hwRow(info, h.qty));
    }
  }

  // ---------- Зеркало как самостоятельный фасад: полировка кромки ----------
  // Кромка зеркала открыта — полировка по периметру каждого фасада (решение
  // пользователя 2026-10-05). Зеркало во вставке рамы не считается: у открытого
  // алюм. профиля полировку начисляет buildAluFacadeRows, у закрытого — не нужна.
  {
    const mEdge = (window.Modul3D.catalog.ALU_FRAME_EXTRAS || {}).mirrorEdge
      || { code: 'GLASS-MIRROR-EDGE', name: 'Полировка кромки зеркала', price: null, unit: 'пог.м',
           priceNote: 'цена уточняется — запрос в RADEVA и DETA отправлен 2026-10-05' };
    const isMirror = (code) => known.some((x) => x.code === code && x.mirror);
    const mirrorFacades = parts.filter((r) => !r.aluFrame && r.facadeType === 'glass4' && isMirror(r.material));
    const edgeM = round2(mirrorFacades.reduce((s2, r) => s2 + (2 * (r.length + r.width) * (r.qty || 1)) / 1000, 0));
    if (edgeM > 0) {
      const ok = mEdge.price !== null && mEdge.price !== undefined && Number.isFinite(Number(mEdge.price));
      hardware.push({ name: mEdge.name, article: mEdge.code || '', unit: mEdge.unit || 'пог.м', qty: edgeM,
        price: ok ? Number(mEdge.price) : null, sum: ok ? round2(edgeM * Number(mEdge.price)) : null,
        note: ok ? 'зеркало-фасад: кромка открыта' : `зеркало-фасад: кромка открыта; Цена: ${mEdge.priceNote || 'уточняйте у стекольщика'}` });
    }
  }

  // ---------- Алюминиевые рамочные фасады ----------
  const aluFacades = buildAluFacadeRows(parts, known);

  // ---------- Итог ----------
  // Строки с неизвестной ценой (sum === null: «уточняйте цену») в сумму не
  // входят — 0 молча не подставляем; вместо этого итог помечается флагом
  // totalIncomplete и списком unpricedItems (UI пишет «без учёта позиций
  // без цены»).
  const sumOf = (arr) => arr.reduce((s, r) => s + (r.sum || 0), 0);
  const totalCost = round2(
    sumOf(sheetMaterials) + sumOf(edging) + sumOf(countertopMaterials) + sumOf(hardware) + sumOf(fasteners)
    + sumOf(aluFacades)
  );
  const unpricedItems = [].concat(sheetMaterials, countertopMaterials, hardware, aluFacades)
    .filter((r) => r.sum === null || r.sum === undefined)
    .map((r) => r.name);

  return {
    sheetMaterials, edging, countertopMaterials, hardware, fasteners,
    aluFacades,
    jointTypeLabel: JOINT_LABEL[jointType],
    totalCost,
    totalIncomplete: unpricedItems.length > 0,
    unpricedItems,
    warnings: model.warnings,
  };
}

// АЛЮМИНИЕВЫЙ РАМОЧНЫЙ ФАСАД — строки сметы только из model.parts (поле
// part.aluFrame, см. engine.js facadePartFields) и каталога (ALU_*).
// Режим 'buy' — готовый фасад у производителя за м²; 'own' — собственное
// изготовление: профиль (пог.м), заполнение (м²), уголки, уплотнитель (только
// стекло), работа. Цена null → sum: null, priceConfirmed: false и пометка —
// ни 0, ни выдуманное число не подставляются (решение пользователя 2026-09-25).
// Поля строки: { name, article, unit, qty, price, sum, priceConfirmed, note,
//   mode: 'buy'|'own', count?, bars? } — count (число фасадов) у 'buy',
//   bars — число хлыстов профиля (priceUnit 'bar' или 'm' с barLength) и
//   число отрезков уплотнителя (seal.barLength).
function buildAluFacadeRows(parts, known) {
  const cat = window.Modul3D.catalog;
  const PROFILES = cat.ALU_PROFILES || {}, COLORS = cat.ALU_PROFILE_COLORS || {};
  const MAKERS = cat.ALU_MAKERS || {}, EXTRAS = cat.ALU_FRAME_EXTRAS || {};
  const alu = parts.filter((r) => r.aluFrame);
  if (!alu.length) return [];
  const out = [];
  const matOf = (code) => (known || []).filter((x) => x.code === code)[0]
    || (findMaterialByCode ? findMaterialByCode(code) : null) || null;
  const colorName = (id) => (COLORS[id] && COLORS[id].name) || id || '';
  const makerContacts = (m) => (m
    ? [m.name, m.phone, m.email].filter(Boolean).join(', ') : 'производитель не выбран');
  const qtyOf = (r) => Number(r.qty) || 1;
  const priced = (row, price, qty) => {
    const ok = price !== null && price !== undefined && Number.isFinite(Number(price));
    row.price = ok ? Number(price) : null;
    row.sum = ok ? round2(qty * Number(price)) : null;
    row.priceConfirmed = ok;
    return row;
  };

  // --- покупной у производителя: группы (профиль, цвет, заполнение, производитель)
  const buyGroups = new Map();
  for (const r of alu.filter((x) => x.aluFrame.priceMode !== 'own')) {
    const a = r.aluFrame;
    const key = [a.profile, a.color, a.fill, a.maker].join('|');
    const g = buyGroups.get(key) || { a, area: 0, count: 0 };
    g.area += (r.length * r.width * qtyOf(r)) / 1000000;
    g.count += qtyOf(r);
    buyGroups.set(key, g);
  }
  for (const g of buyGroups.values()) {
    const a = g.a, prof = PROFILES[a.profile] || {}, maker = MAKERS[a.maker] || null;
    const fillM = matOf(a.fill);
    const area = round2(g.area);
    const row = { mode: 'buy',
      name: `Фасад из алюм. профиля ${prof.name || a.profile}, ${colorName(a.color)}, `
        + `заполнение ${(fillM && fillM.name) || a.fill} — ${maker ? maker.name : '—'}`,
      article: prof.article || '', unit: 'м²', qty: area, count: g.count };
    priced(row, maker ? maker.pricePerM2 : null, area);
    row.note = row.priceConfirmed ? '' : `Уточняйте цену у производителя: ${makerContacts(maker)}`;
    out.push(row);
  }

  // --- собственное изготовление
  const own = alu.filter((x) => x.aluFrame.priceMode === 'own');
  if (own.length) {
    // Профиль: Σ периметр фасадов по (профиль, цвет)
    const profGroups = new Map();
    for (const r of own) {
      const a = r.aluFrame, key = a.profile + '|' + a.color;
      const g = profGroups.get(key) || { a, lenM: 0 };
      g.lenM += (a.perimeterMm * qtyOf(r)) / 1000;
      profGroups.set(key, g);
    }
    for (const g of profGroups.values()) {
      const a = g.a, prof = PROFILES[a.profile] || {};
      const lenM = round2(g.lenM);
      const base = prof.colorPrices && prof.colorPrices[a.color] != null
        ? prof.colorPrices[a.color] : prof.price;
      const notes = [];
      let perM = base;
      const row = { mode: 'own', name: `${prof.name || `Профиль ${a.profile}`}, ${colorName(a.color)}`,
        article: prof.article || '', unit: 'пог.м', qty: lenM };
      if (prof.priceUnit === 'bar') {
        const bl = Number(prof.barLength);
        if (bl > 0) {
          perM = base != null ? base / bl : null;
          row.bars = Math.ceil(lenM / bl);
          notes.push(`палок по ${bl} м: ${row.bars}`);
        } else {
          perM = null;
          notes.push('цена за палку, длина палки не указана — уточняйте у поставщика');
        }
      } else if (prof.priceUnit === 'm') {
        // Цена за пог.м; хлыст (barLength) — только для пометки о закупке.
        const bl = Number(prof.barLength);
        if (bl > 0) {
          row.bars = Math.ceil(lenM / bl);
          notes.push(`хлыстов по ${bl} м: ${row.bars}`);
        }
      } else {
        notes.push('единица цены не подтверждена — посчитано как за пог.м');
      }
      priced(row, perM != null ? round2(perM) : null, lenM);
      if (!row.priceConfirmed && prof.priceUnit !== 'bar') notes.push('Уточняйте цену у поставщика');
      if (prof.priceNote) notes.push(prof.priceNote);
      row.note = notes.join('; ');
      out.push(row);
    }
    // Заполнение: площадь по паспорту профиля (fillW×fillH)
    const fillGroups = new Map();
    for (const r of own) {
      const a = r.aluFrame;
      const g = fillGroups.get(a.fill) || { a, area: 0, unknown: 0 };
      if (a.fillW > 0 && a.fillH > 0) g.area += (a.fillW * a.fillH * qtyOf(r)) / 1000000;
      else g.unknown += qtyOf(r);
      fillGroups.set(a.fill, g);
    }
    for (const g of fillGroups.values()) {
      const fillM = matOf(g.a.fill);
      const row = { mode: 'own', name: `Заполнение алюм. фасада: ${(fillM && fillM.name) || g.a.fill}`,
        article: g.a.fill, unit: 'м²', qty: g.unknown ? null : round2(g.area) };
      let perM2 = null;
      if (fillM && fillM.sheetPrice != null && Number.isFinite(Number(fillM.sheetPrice))) {
        if (fillM.customOrder) perM2 = Number(fillM.sheetPrice);
        else if (Number(fillM.sheetW) > 0 && Number(fillM.sheetH) > 0) {
          perM2 = Number(fillM.sheetPrice) / ((fillM.sheetW * fillM.sheetH) / 1000000);
        }
      }
      const notes = [];
      if (g.unknown) {
        row.price = perM2 != null ? round2(perM2) : null;
        row.sum = null;
        row.priceConfirmed = false;
        notes.push('Размер заполнения уточняйте по паспорту профиля');
      } else {
        priced(row, perM2 != null ? round2(perM2) : null, row.qty);
        if (!row.priceConfirmed) notes.push('Цена материала не указана — уточняйте у поставщика');
      }
      row.note = notes.join('; ');
      out.push(row);
    }
    // Уголки монтажные
    const corner = EXTRAS.corner || null;
    const cornerQty = own.reduce((s, r) => s + (Number(r.aluFrame.corners) || 0) * qtyOf(r), 0);
    if (corner && cornerQty) {
      const row = priced({ mode: 'own', name: corner.name, article: corner.article || '',
        unit: corner.unit || 'шт', qty: cornerQty }, corner.price, cornerQty);
      row.note = row.priceConfirmed ? '' : 'Уточняйте цену у поставщика';
      out.push(row);
    }
    // Уплотнитель — только при заполнении стеклом, длина = периметр профиля
    const seal = EXTRAS.seal || null;
    const sealM = round2(own.filter((r) => r.aluFrame.seal)
      .reduce((s, r) => s + (r.aluFrame.perimeterMm * qtyOf(r)) / 1000, 0));
    if (seal && sealM > 0) {
      const row = priced({ mode: 'own', name: seal.name, article: seal.code || '',
        unit: seal.unit || 'пог.м', qty: sealM }, seal.price, sealM);
      const sealNotes = [];
      const sbl = Number(seal.barLength);
      if (sbl > 0) {
        row.bars = Math.ceil(sealM / sbl);
        sealNotes.push(`продаётся по ${sbl} м: ${row.bars} шт`);
      }
      if (!row.priceConfirmed) sealNotes.push(`Цена: ${seal.priceNote || 'уточняйте у поставщика'}`);
      row.note = sealNotes.join('; ');
      out.push(row);
    }
    // Полировка кромки стекла — только у открытого профиля (край стекла виден),
    // длина = периметр стекла 2·(fillW+fillH); размер стекла неизвестен — не считаем.
    const gEdge = EXTRAS.glassEdge || null;
    const edgeRows = own.filter((r) => r.aluFrame.kind === 'open' && r.aluFrame.fillType === 'glass');
    if (gEdge && edgeRows.length) {
      const unknownEdge = edgeRows.some((r) => !(r.aluFrame.fillW > 0 && r.aluFrame.fillH > 0));
      const edgeM = round2(edgeRows.reduce((s, r) => s + (r.aluFrame.fillW > 0 && r.aluFrame.fillH > 0
        ? (2 * (r.aluFrame.fillW + r.aluFrame.fillH) * qtyOf(r)) / 1000 : 0), 0));
      if (edgeM > 0 || unknownEdge) {
        const row = { mode: 'own', name: gEdge.name, article: gEdge.code || '', unit: gEdge.unit || 'пог.м',
          qty: unknownEdge ? null : edgeM };
        const edgeNotes = ['открытый профиль — край стекла виден'];
        if (unknownEdge) {
          row.price = gEdge.price; row.sum = null; row.priceConfirmed = false;
          edgeNotes.push('Размер стекла уточняйте по паспорту профиля');
        } else {
          priced(row, gEdge.price, edgeM);
        }
        if (!row.priceConfirmed) edgeNotes.push(`Цена: ${gEdge.priceNote || 'уточняйте у стекольщика'}`);
        row.note = edgeNotes.join('; ');
        out.push(row);
      }
    }
    // Работа — за каждый фасад
    const labour = EXTRAS.labour || null;
    const facadeQty = own.reduce((s, r) => s + qtyOf(r), 0);
    if (labour && facadeQty) {
      const row = priced({ mode: 'own', name: labour.name, article: labour.code || '',
        unit: labour.unit || 'шт', qty: facadeQty }, labour.price, facadeQty);
      row.note = row.priceConfirmed ? '' : `Цена: ${labour.priceNote || 'укажите стоимость работы'}`;
      out.push(row);
    }
  }
  return out;
}

function hwRow(info, qty) {
  return { name: info.name, article: info.article, unit: info.unit, qty, price: info.price, sum: round2(qty * info.price) };
}
function fRow(info, qty) {
  return { name: info.name, article: info.article, unit: info.unit, qty, price: info.price, sum: round2(qty * info.price) };
}

window.Modul3D = window.Modul3D || {};
// ПАСПОРТ СИСТЕМЫ ЯЩИКОВ: все числа, по которым считается короб, одной
// таблицей и с указанием источника. Нужен, чтобы проверить расчёт за
// полминуты, а не искать координаты по 3D и чертежам.
function buildDrawerPassport(systemId) {
  const sys = DRAWER_SYSTEMS[systemId];
  if (!sys) return null;
  const rows = [];
  const add = (name, value, note) => { if (value !== undefined && value !== null) rows.push({ name, value, note: note || '' }); };
  add('Система', sys.name);
  add('Источник размеров', sys.src || '— НЕ УКАЗАН —');
  add('Ряд NL, мм', (sys.nl || []).join(' / '));
  if (sys.minCorpusDepth) add('Мин. глубина корпуса', `NL + ${sys.minCorpusDepth(0)}`, 'KT из таблицы');
  if (sys.clearanceFor) {
    add('Зазор на сторону, плита 16', `${sys.clearanceFor(16)} мм`);
    add('Зазор на сторону, плита 18', `${sys.clearanceFor(18)} мм`);
  }
  if (sys.bottomLen) add('Длина дна', sys.bottomLen(500) === 500 ? 'NL' : `NL − ${500 - sys.bottomLen(500)}`);
  if (sys.thinBottomLen) add('Длина дна из ДВП', `NL − ${500 - sys.thinBottomLen(500)}`, 'в базе не используется');
  if (sys.boxStyle) {
    add('Сборка короба', sys.boxStyle === 'ledge'
      ? 'дно под стенками, боковины ниже дна (уступ)'
      : 'дно под стенками, крепление на штифты');
  }
  if (sys.boxLedge) add('Уступ боковины', `${sys.boxLedge} мм`, 'упор направляющей');
  if (sys.boxRearPin) add('Штифт задней стенки', `Ø${sys.boxRearPin.d}×${sys.boxRearPin.depth}`,
    `${sys.boxRearPin.overBottom} мм над дном, ${sys.boxRearPin.fromEnd} от торца`);
  if (sys.bottomPin) add('Зацеп направляющей', `Ø${sys.bottomPin.d}×${sys.bottomPin.depth} в торец дна`,
    `ось ${sys.bottomPin.overBottom} мм от низа короба, ${sys.bottomPin.fromSide} мм от боковины`);
  if (sys.bracketScrew) add('Отверстия для фиксатора', `Ø${sys.bracketScrew.d}×${sys.bracketScrew.depth}`,
    `${(sys.bracketScrew.fromSide || []).join(' и ')} мм от боковины, `
    + `${sys.bracketScrew.fromFront} мм от переднего края дна`);
  if (sys.heights) add('Высоты короба', sys.heights.map((h) => h.code).join(' / '));
  return { rows, assumed: sys.assumed || [] };
}

window.Modul3D.specification = { buildDrawerPassport, buildSpecification };
})();
