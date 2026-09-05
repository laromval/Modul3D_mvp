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
        HANDLES, LIFTS, GLASS, FACADE_MATERIALS, DECORS, BACK_MATERIALS, COUNTERTOP_MATERIALS } = window.Modul3D.catalog;

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
      return {
        code, name: acc.info.name, area_m2: round2(acc.area_m2),
        sheetArea_m2: null, sheets: null, price: acc.info.sheetPrice,
        sum: round2(acc.area_m2 * acc.info.sheetPrice),
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
  // doubleLdsp сюда не попадает: это не каталожная позиция, её площадь уже
  // посчитана в листовом блоке выше (материал = decor.code проекта, qty:2).
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
  if (!cupHinges && !glassHinges && hingeCount > 0) hardware.push(hwRow(HARDWARE_PRICES.hinge, hingeCount));
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
  if (legChrome) hardware.push(hwRow(HARDWARE_PRICES.leg, legChrome));
  if (legPlast) hardware.push(hwRow(HARDWARE_PRICES.legPlastic, legPlast));
  if (clipCount) hardware.push(hwRow(HARDWARE_PRICES.plinthClip, clipCount));

  // Комплекты ящичных систем — по фактически применённым системам
  const drawerSets = {};
  for (const d of hardwareContext.drawerHardware) {
    const id = d.system || 'ballBearing';
    drawerSets[id] = (drawerSets[id] || 0) + 1;
  }
  for (const id of Object.keys(drawerSets)) {
    const sys = DRAWER_SYSTEMS[id];
    if (!sys) continue;
    hardware.push({
      name: sys.setName, article: id, unit: 'компл.',
      qty: drawerSets[id], price: sys.setPrice,
      sum: round2(drawerSets[id] * sys.setPrice),
    });
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

  const backCount = parts.filter(r => r.kind === 'back' || r.name === 'Задняя стенка').reduce((s, r) => s + r.qty, 0);
  const screwsPerBack = 10;
  if (backCount > 0) fasteners.push(fRow(FASTENER_PRICES.backPanelScrew, backCount * screwsPerBack));

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
  // Клей — только для материалов, где engine.js НЕ убирает крышку (см.
  // skipTopPanel: ldsp38/doubleLdsp/«свой материал» толще 18мм) — тот же
  // список БЕЛЫМ списком, а не "всё, что не compact12", иначе старый/битый
  // проект без material (engine.js в этом случае оставляет крышку,
  // безопасный дефолт) здесь ошибочно попал бы в "клей" вместо факта, что
  // крышка просто есть и крепёж — обычные шурупы/присадка крышки.
  const ctSkipsTopPanel = (m) => m.countertop.material === 'ldsp38'
    || m.countertop.material === 'doubleLdsp'
    || (m.countertop.material === 'custom' && Number(m.countertop.thickness) > 18);
  let worktopScrewQty = 0, worktopGlueQty = 0;
  for (const m of mods) {
    if (!m.countertop || !m.countertop.enabled) continue;
    if (m.topType === 'rails' || m.topType === 'railsEdge') {
      worktopScrewQty += Math.max(2, Math.round(Number(m.width) / 400));
    } else if (!ctSkipsTopPanel(m)) {
      worktopGlueQty += 1;
    }
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

  // ---------- Итог ----------
  const sumOf = (arr) => arr.reduce((s, r) => s + (r.sum || 0), 0);
  const totalCost = round2(
    sumOf(sheetMaterials) + sumOf(edging) + sumOf(countertopMaterials) + sumOf(hardware) + sumOf(fasteners)
  );

  return {
    sheetMaterials, edging, countertopMaterials, hardware, fasteners,
    jointTypeLabel: JOINT_LABEL[jointType],
    totalCost,
    warnings: model.warnings,
  };
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
  if (sys.cabinetPin) add('Штифт в боковине корпуса', `Ø${sys.cabinetPin.d}×${sys.cabinetPin.depth}`,
    `${sys.cabinetPin.fromFront} мм от переднего края панели`);
  if (sys.bracketScrew) add('Отверстия для фиксатора', `Ø${sys.bracketScrew.d}×${sys.bracketScrew.depth}`,
    `${(sys.bracketScrew.fromSide || []).join(' и ')} мм от боковины, `
    + `${sys.bracketScrew.fromFront} мм от переднего края дна`);
  if (sys.heights) add('Высоты короба', sys.heights.map((h) => h.code).join(' / '));
  return { rows, assumed: sys.assumed || [] };
}

window.Modul3D.specification = { buildDrawerPassport, buildSpecification };
})();
