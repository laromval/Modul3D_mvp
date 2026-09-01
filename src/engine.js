// engine.js
// ============================================================================
// Parametric Core Engine — MVP (Этап 1: прямой корпусный шкаф).
//
// Единый источник истины: buildModel(params) строит список деталей (parts)
// с геометрией и позициями в 3D, из которого затем детерминированно выводятся
// 3D-визуализация, деталировка и спецификация. Ничего не вводится вручную.
//
// Единицы измерения: миллиметры. Ось Y — высота, X — ширина, Z — глубина.
// Z+ = перёд изделия (сторона фасадов), Z- = задняя стенка.
//
// --- КОНСТРУКТИВ (правила сборки корпусной мебели) ---------------------------
// Ключевое правило: в каждом углу корпуса одна деталь ПЕРЕКРЫВАЕТ торец другой.
//
// Крышка ВСЕГДА вкладная между боковинами (длина = W - 2t).
// Каждая боковина задаётся ОТДЕЛЬНО и бывает:
//   • 'floor'        — идёт ДО ПОЛА, дно вкладное между боковинами;
//   • 'onBottom'     — стоит НА ДНЕ, дно проходит под ней до наружной грани;
//   • 'besideBottom' — СБОКУ ДНА: дно вкладное, но боковина заканчивается
//                      вровень с низом дна и в зону цоколя не спускается.
//                      Это классическая «коробка» на отдельном подстолье:
//                      цоколь или ножки несут корпус, а не боковина.
//
// Отсюда 4 сочетания, и все они реально применяются в ряду корпусов с общим
// сквозным цоколем:
//   левая floor  + правая floor     — одиночный шкаф, дно вкладное
//   левая onBottom + правая onBottom — средний корпус ряда, дно накладное
//   левая floor  + правая onBottom  — крайний ЛЕВЫЙ корпус ряда
//   левая onBottom + правая floor   — крайний ПРАВЫЙ корпус ряда
//
// Длина дна выводится из этих флагов автоматически, поэтому пересечение
// деталей в углах невозможно ни в одном сочетании.
//
// Классический скрипт (без import/export) — публикует себя в window.Modul3D,
// чтобы приложение открывалось прямо с диска (file://) без локального сервера.
// ============================================================================
(function () {
const EDGE_FRONT = 'ПВХ 2 мм';   // кромка на видимых лицевых кромках
const EDGE_BACK  = 'ПВХ 0.4 мм'; // кромка на невидимых/технических кромках

const PLINTH_SETBACK = 50; // утопление цоколя от переднего края, мм (норма 50–70)
const SHELF_SETBACK  = 20; // отступ полки от переднего края корпуса, мм

function round1(v) { return Math.round(v * 10) / 10; }

// Приводит значение схемы к каноническому виду и поддерживает старые названия.
// Приводит конструктив боковин к паре {left,right} со значениями
// 'floor' (боковина идёт до пола) или 'onBottom' (стоит на дне).
// Поддерживает старые названия схем.
function normalizeSides(p) {
  const ok = (v) => (v === 'onBottom' || v === 'floor' || v === 'besideBottom') ? v : null;
  let left = ok(p.leftSide), right = ok(p.rightSide);
  if (!left || !right) {
    const legacyOnBottom = p.scheme === 'insetTop_overlayBottom' || p.scheme === 'overlayTop_overlayBottom';
    const def = legacyOnBottom ? 'onBottom' : 'floor';
    left = left || def;
    right = right || def;
  }
  return { left, right };
}

const SIDE_LABEL = { floor: 'до пола', onBottom: 'на дно', besideBottom: 'сбоку дна' };

function sidesLabel(s) {
  const t = (v) => SIDE_LABEL[v] || v;
  if (s.left === s.right) {
    if (s.left === 'floor') return 'Обе боковины до пола (дно вкладное)';
    if (s.left === 'besideBottom') return 'Обе боковины сбоку дна (дно вкладное)';
    return 'Обе боковины на дно (дно накладное)';
  }
  return `Левая ${t(s.left)}, правая ${t(s.right)}`;
}

// Раскладка секций по ширине: фиксированные берут свою ширину, остальные
// делят остаток поровну. Возвращает ширины и левые границы проёмов, а также
// величину нехватки места (overflow), если заданные ширины не влезли.
function layoutSections(sections, Wi, t) {
  const n = sections.length;
  const avail = Wi - (n - 1) * t;               // чистая ширина всех проёмов
  const fixed = sections.map((s) => {
    const v = Number(s.width);
    return (s.widthMode === 'fixed' && Number.isFinite(v) && v > 0) ? v : null;
  });
  const fixedSum = fixed.reduce((a, v) => a + (v || 0), 0);
  const autoCount = fixed.filter((v) => v === null).length;
  const rest = avail - fixedSum;
  const autoW = autoCount ? rest / autoCount : 0;

  const widths = fixed.map((v) => (v === null ? autoW : v));
  const x0 = [];
  let cur = -Wi / 2;
  for (let i = 0; i < n; i++) { x0.push(cur); cur += widths[i] + t; }

  return { widths, x0, overflow: autoCount ? Math.max(0, -rest) : Math.max(0, fixedSum - avail) };
}

// Подъём КОРОБА ящика над дном, мм.
// Это технологический зазор, чтобы ящик не задевал дно при выдвижении.
// ВАЖНО: поднимается только короб — ФАСАД по-прежнему закрывает фронт от
// самого низа секции, иначе внизу оставалась бы открытая щель.
// Минимальный технологический зазор от дна до нижнего короба: иначе при
// выдвижении ящик задевает дно корпуса.
const MIN_DRAWER_LIFT = 10;

function drawerLift(sec) {
  if (!sec.drawers) return 0;
  const v = Number(sec.drawerOffset);
  return Math.max(MIN_DRAWER_LIFT, Number.isFinite(v) ? v : 0);
}

/**
 * Высоты ФАСАДОВ ящиков секции.
 *
 * По умолчанию (режим 'auto') высоты распределяются автоматически по
 * доступной высоте фронта — так ящики никогда не вылезают за габарит модуля
 * при изменении его высоты.
 * В режиме 'manual' берутся заданные значения, но если их сумма не влезает,
 * они пропорционально ужимаются, а наружу выдаётся предупреждение.
 *
 * @param avail  доступная высота фронта под ящики, мм
 */
function getDrawerHeights(sec, drawerUnitH, avail, warn, secName) {
  const n = sec.drawers || 0;
  if (!n) return [];
  const usable = Math.max(0, avail);
  const STEP = 10;          // высоты кратны 10 мм — удобнее в производстве
  const MIN_DOOR = 250;     // минимальный просвет под дверь в той же секции

  // Ручной режим принимается, только если задано РОВНО n корректных высот.
  // Раньше короткий массив проходил проверку (every на срезе), и недостающие
  // элементы давали NaN во всей деталировке и на чертежах.
  const manualList = Array.isArray(sec.drawerHeights) ? sec.drawerHeights.slice(0, n) : [];
  const isManual = sec.drawerMode === 'manual' && manualList.length === n
    && manualList.every(v => Number.isFinite(Number(v)) && Number(v) > 0);

  if (!isManual) {
    const hasDoor = sectionHasAnyFacade(sec);
    if (!hasDoor) {
      // Ящики занимают весь фронт: делим поровну, кратно 10, остаток —
      // нижнему ящику, чтобы верх стопки был заподлицо с крышкой.
      const base = Math.max(STEP, Math.floor(usable / n / STEP) * STEP);
      const out = new Array(n).fill(base);
      out[0] = round1(base + (usable - base * n));
      return out;
    }
    // В секции есть и дверь: ящики берут типовую высоту снизу, остальное —
    // двери. Если типовая не влезает, ужимаем, оставив дверь не уже MIN_DOOR.
    const forDrawers = Math.max(0, usable - MIN_DOOR);
    let base = Math.round((drawerUnitH || 200) / STEP) * STEP;
    if (base * n > forDrawers) base = Math.max(STEP, Math.floor(forDrawers / n / STEP) * STEP);
    return new Array(n).fill(base);
  }

  const raw = manualList.map(Number);
  const sum = raw.reduce((a, v) => a + v, 0);
  if (sum <= usable + 0.5) return raw;

  const k = usable / sum;
  if (warn) {
    warn(`${secName}: заданные высоты фасадов (${Math.round(sum)} мм) не помещаются `
       + `в ${Math.round(usable)} мм — ужаты пропорционально.`);
  }
  return raw.map(v => Math.floor(v * k * 10) / 10);
}

// Секция считается «без фасада» (открытой), только если у неё нет ни
// одной непустой дверной зоны — при нескольких зонах (doorZoneCount > 1)
// одиночного sec.facade больше нет, поэтому такие места кода не могут
// читать его напрямую.
function sectionHasAnyFacade(sec) {
  if (Number(sec.doorZoneCount) > 1 && Array.isArray(sec.doorZones) && sec.doorZones.length) {
    return sec.doorZones.some((z) => z && z.facade !== 'open');
  }
  return sec.facade !== 'open';
}

// «Основной» фасад секции — для мест, которым нужно одно решение на всю
// секцию (например, к какому краю жмётся узкий фасад углового модуля).
// При нескольких зонах берём фасад НИЖНЕЙ (первой) зоны.
function primaryFacade(sec) {
  if (Number(sec.doorZoneCount) > 1 && Array.isArray(sec.doorZones) && sec.doorZones.length) {
    return (sec.doorZones[0] || {}).facade;
  }
  return sec.facade;
}

// Встраиваемая техника, которую можно назначить дверной зоне (см.
// zone.appliance). Влияет на то, строится ли фасад вообще и нужна ли под
// него обычная мебельная петля — три разных механизма крепления:
//   'none'              — обычная дверь, обычные петли (как раньше).
//   'oven'/'microwave'  — у техники своя лицевая панель, фасада корпуса тут
//                          нет вообще (как facade:'open'), поэтому направление
//                          навески (fac) для этих зон не имеет значения.
//   'fridge'             — фасад ЕСТЬ и крепится к БОКОВИНЕ пенала, но
//                          спец. петлями под встройку (не обычными
//                          мебельными) — и тем же фасадом через отдельную
//                          тягу открывается дверца самого холодильника.
//                          Координат этих спец. петель в проекте нет —
//                          обычную мебельную чашку не сверлим.
//   'washer'/'dishwasher'— фасад крепится не к корпусу, а к ДВЕРЦЕ САМОЙ
//                          техники, по шаблону производителя (иногда со
//                          своими петлями в комплекте машины) — это тоже
//                          не мебельная петля корпуса, чашку не сверлим.
const APPLIANCE_LABELS = {
  oven: 'духовой шкаф', microwave: 'СВЧ', fridge: 'холодильник',
  washer: 'стиральная машина', dishwasher: 'посудомоечная машина',
};
// Ниша без фасада корпуса вообще — техника показывает свою лицевую панель.
function applianceNicheOnly(appliance) {
  return appliance === 'oven' || appliance === 'microwave';
}
// Фасад есть, но НЕ на мебельной петле корпуса (см. таблицу выше) — обычную
// hingeHoles не сверлим, вместо этого честное предупреждение и заметка.
function applianceSkipsHinge(appliance) {
  return appliance === 'fridge' || appliance === 'washer' || appliance === 'dishwasher';
}
function applianceHingeNote(appliance) {
  if (appliance === 'fridge') {
    return 'крепится к боковине спец. петлями под встраиваемый холодильник — '
      + 'координаты уточнить у поставщика фурнитуры; тем же фасадом открывается дверца холодильника';
  }
  if (appliance === 'washer' || appliance === 'dishwasher') {
    return 'крепится к дверце техники по шаблону производителя — не мебельная петля корпуса';
  }
  return '';
}

/**
 * Раскладка НЕСКОЛЬКИХ дверных зон друг над другом внутри одного слота
 * (пеналы под встраиваемую технику — духовка/СВЧ/холодильник, либо просто
 * «две двери одна над другой»). Каждая зона окружена зазором gap со всех
 * сторон — тем же приёмом, что и створки doors2 по горизонтали: там слот
 * делится на leafW = (facadeW - 2*gap) / 2. По вертикали для N зон это
 * означает: полезный бюджет высоты = slotHeight - 2*gap*N (gap сверху
 * первой зоны, gap снизу последней и по 2*gap на каждой границе между
 * соседними зонами).
 *
 * zones[i].height === 0 — «взять остаток» (как sec.facadeWidth === 0 значит
 * «во всю секцию»): бюджет, оставшийся после явных высот, делится поровну
 * между такими зонами. Если сумма явных высот больше бюджета — все зоны
 * ужимаются пропорционально (тот же приём k = usable/sum, что и выше в
 * getDrawerHeights), с предупреждением.
 *
 * Совместимость: при ОДНОЙ зоне с height:0 возвращает ровно ту высоту,
 * что и старая формула doorZoneH = slotHeight - 2*gap.
 *
 * @return { heights: number[], bottoms: number[] } — bottoms[i] — нижняя
 *   граница i-й зоны относительно slotBot (низа слота).
 */
function layoutDoorZones(zones, slotHeight, gap, warn, secName) {
  const N = zones.length;
  const usableBudget = Math.max(0, slotHeight - 2 * gap * N);
  const explicit = zones.map((z) => Math.max(0, Number(z.height) || 0));
  const sumExplicit = explicit.reduce((a, v) => a + v, 0);
  const autoCount = explicit.filter((v) => v <= 0).length;

  let heights;
  if (sumExplicit > usableBudget + 0.5) {
    const k = usableBudget / sumExplicit;
    if (warn) {
      warn(`${secName}: заданные высоты зон фасада (${Math.round(sumExplicit)} мм) не помещаются `
         + `в ${Math.round(usableBudget)} мм — ужаты пропорционально.`);
    }
    heights = explicit.map((v) => v * k);
  } else {
    const rest = usableBudget - sumExplicit;
    const autoH = autoCount ? rest / autoCount : 0;
    heights = explicit.map((v) => (v > 0 ? v : autoH));
  }

  const bottoms = [];
  let acc = gap;
  for (let i = 0; i < N; i++) {
    bottoms.push(acc);
    acc += heights[i] + 2 * gap;
  }
  return { heights, bottoms };
}

// Возвращает координаты ЦЕНТРА полок по высоте.
// В ручном режиме sec.shelfHeights задаёт высоту НИЖНЕЙ плоскости полки от
// дна — именно на этой отметке стоит полкодержатель, так меряет сборщик.
// Поэтому к заданному значению прибавляем половину толщины детали.
//
// excludeRanges — диапазоны Y (та же система координат, что zoneBottomY),
// которые нужно обойти при АВТО-распределении: ниши под встраиваемую технику
// (doorZones[].appliance !== 'none') из фасадной части секции — полка не
// должна перегораживать место, отведённое под духовку/холодильник и т.п.
// В ручном режиме (shelfHeights) диапазоны не учитываются — там высоту
// задаёт сам пользователь, это его ответственность (см. комментарий у
// вызова из buildModuleParts).
function getShelfYs(sec, zoneBottomY, zoneH, t, originY, excludeRanges) {
  const n = sec.shelves || 0;
  if (!n) return [];
  const out = [];
  const isManual = sec.shelfMode === 'manual' && Array.isArray(sec.shelfHeights);
  // Ручная высота отсчитывается ОТ ДНА СЕКЦИИ — так её меряет сборщик и так
  // написано в панели. Раньше отсчёт шёл от верха ящиков, и в секции с
  // ящиками введённое значение означало совсем не то, что ожидал пользователь.
  const base = Number.isFinite(originY) ? originY : zoneBottomY;
  if (isManual) {
    for (let i = 0; i < n; i++) {
      const v = Number(sec.shelfHeights[i]);
      out.push(Number.isFinite(v)
        ? base + v + t / 2
        : zoneBottomY + (zoneH * (i + 1)) / (n + 1));
    }
    return out;
  }

  // Авто-режим: делим зону на свободные участки, обходя excludeRanges, и
  // распределяем полки пропорционально длине каждого участка — тот же
  // общий приём, что и раскладка нескольких дверных зон по высоте
  // (layoutDoorZones), только тут «зонами» выступают промежутки между
  // нишами техники. Без исключений (excludeRanges пуст) даёт РОВНО ту же
  // формулу, что была раньше — обратная совместимость.
  const zTop = zoneBottomY + zoneH;
  const ranges = (excludeRanges || [])
    .map(([a, b]) => [Math.max(zoneBottomY, Math.min(a, b)), Math.min(zTop, Math.max(a, b))])
    .filter(([a, b]) => b > a)
    .sort((r1, r2) => r1[0] - r2[0]);
  const segments = [];
  let cursor = zoneBottomY;
  for (const [a, b] of ranges) {
    if (a > cursor) segments.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < zTop) segments.push([cursor, zTop]);
  const totalFree = segments.reduce((s, [a, b]) => s + (b - a), 0);
  if (!segments.length || totalFree <= 0) {
    // Ниши занимают всю зону целиком — распределять полки некуда; отдаём
    // старую формулу как безопасный fallback, дальше по коду сработает уже
    // существующая проверка «полка выходит за пределы секции».
    for (let i = 0; i < n; i++) out.push(zoneBottomY + (zoneH * (i + 1)) / (n + 1));
    return out;
  }
  const counts = segments.map((seg) => Math.floor((n * (seg[1] - seg[0])) / totalFree));
  let assigned = counts.reduce((s, c) => s + c, 0);
  // Остаток (от округления вниз) раздаём участкам по убыванию длины —
  // крупный свободный участок получает лишнюю полку в первую очередь.
  const order = segments.map((_, idx) => idx)
    .sort((a, b) => (segments[b][1] - segments[b][0]) - (segments[a][1] - segments[a][0]));
  for (let k = 0; assigned < n; k = (k + 1) % order.length) { counts[order[k]]++; assigned++; }
  for (let s = 0; s < segments.length; s++) {
    const [a, b] = segments[s];
    const c = counts[s];
    for (let k = 0; k < c; k++) out.push(a + ((b - a) * (k + 1)) / (c + 1));
  }
  return out;
}

// Детали ящиков по формулам выбранной системы (см. catalog.DRAWER_SYSTEMS).
// Металлические царги в деталировку не попадают — они идут в спецификацию
// как комплект фурнитуры; из ЛДСП/ХДФ режется только дно и задняя стенка.
function buildDrawerBoxes(o) {
  const cat = window.Modul3D.catalog;
  const sysId = o.sec.drawerSystem || 'ballBearing';
  const sys = cat.DRAWER_SYSTEMS[sysId];
  if (!sys) return;
  const NL = cat.pickNL(sys, o.innerDepth);
  if (NL + 3 > o.innerDepth) {
    o.warnings.push(`${o.secName}: глубина корпуса мала для направляющих ${NL} мм (нужно ≥ ${NL + 3} мм внутри).`);
  }

  // Толщина дна короба нужна ещё до подбора высоты: у Quadro дно из ЛДСП
  // (16–18 мм), у остальных ХДФ (3 мм), и от этого зависит, какой короб влезет.
  const botChip = sys.bottom === 'chipboard';
  const botMat = botChip ? o.drawerDecor : o.back;
  const BOT = sys.metal ? o.drawerT : (botChip ? o.drawerT : o.backT);

  // Короб прилегает передней плоскостью к фасаду: он не «висит» посреди
  // корпуса, а придвинут вперёд — именно так фасад к нему и крепится.
  // У металлических систем дно короче NL (спереди стоит крепление фасада),
  // поэтому его передняя кромка честно остаётся немного позади фасада.
  const zc = Number.isFinite(o.frontZ) ? o.frontZ - NL / 2 : 0;

  let y = o.baseY;
  let maxTop = o.baseY;
  for (let i = 0; i < o.drawerHeights.length; i++) {
    const frontH = o.drawerHeights[i];
    // Высота царги/короба выводится ИЗ ВЫСОТЫ ФАСАДА.
    // Фасад накладной: он перекрывает короб сверху и снизу, плюс снизу нужен
    // зазор под направляющую. По каталогам металлических систем царга ниже
    // минимального фасада примерно на 30 мм (Blum: фасад 115 → царга 83,6;
    // фасад 205 → 172). Для короба из ЛДСП запас берём больше — 60 мм.
    // Короб поднят на технологический зазор (drawerLift), поэтому верхний
    // ящик может выйти за крышу, даже если по шагу фасадов он проходит.
    // Ограничиваем высоту короба ещё и остатком до внутреннего верха секции.
    // Просвет над верхним коробом до крышки/планок. 2 мм было слишком мало:
    // короб вставал впритык, руку между ним и верхом не просунуть.
    const TOP_GAP = 25;
    // ПРАВИЛО: короб ящика всегда НИЖЕ своего фасада минимум на BELOW_FRONT.
    // Фасад перекрывает короб сверху, иначе при закрывании он бьёт по кромке
    // соседнего фасада. Из этого правила и выводится высота короба.
    const BELOW_FRONT = 20;
    // Короб поднят над фасадом на технологический зазор от дна (drawerLift)
    // плюс толщина дна секции — это «lead». Его надо вычесть, иначе правило
    // 20 мм считается не от фасада, а от низа короба.
    const lead = Number.isFinite(o.facadeBaseY) ? (o.baseY - o.facadeBaseY) : 0;
    const maxBoxTotal = frontH - (o.gap || 1.5) - lead - BELOW_FRONT;
    const availTop = (o.innerTopY != null)
      ? Math.max(0, o.innerTopY - y - TOP_GAP)
      : Infinity;

    // Пользователь может ЗАДАТЬ высоту короба (царги) — тогда берём её,
    // а автоподбор оставляем на «авто».
    const wantCode = o.sec && o.sec.drawerBoxHeight;
    const picked = (wantCode && wantCode !== 'auto')
      ? sys.heights.filter((h) => h.code === String(wantCode))[0] : null;

    let hh;
    if (picked) {
      hh = picked;
      if (picked.minFront > frontH + 0.5) {
        o.warnings.push(`${o.secName}, ящик ${i + 1}: для царги ${picked.code} нужен фасад `
          + `не ниже ${picked.minFront} мм, а он ${Math.round(frontH)} мм.`);
      }
      if (BOT + picked.h > availTop) {
        o.warnings.push(`${o.secName}, ящик ${i + 1}: короб ${picked.code} не помещается `
          + `по высоте — не хватает ${Math.round(BOT + picked.h - availTop)} мм.`);
      }
      if (BOT + picked.h > maxBoxTotal) {
        o.warnings.push(`${o.secName}, ящик ${i + 1}: короб ${picked.code} выше фасада `
          + `меньше чем на ${BELOW_FRONT} мм — фасад должен перекрывать короб сверху.`);
      }
    } else if (sys.metal) {
      const fit = sys.heights.filter((h) => h.minFront <= frontH
        && BOT + h.h <= availTop && BOT + h.h <= maxBoxTotal);
      if (!fit.length) {
        // Фасад ниже минимума системы — такой ящик собрать нельзя: царга
        // выше шага фасадов и упирается в соседний ящик. Короб НЕ строим,
        // иначе в модель попала бы заведомо невозможная геометрия.
        o.warnings.push(`${o.secName}, ящик ${i + 1}: фасад ${Math.round(frontH)} мм ниже минимума `
          + `${sys.heights[0].minFront} мм для «${sys.name}» — короб не построен. `
          + `Уменьшите число ящиков, увеличьте высоту модуля или выберите другую систему.`);
        y += frontH;
        continue;
      }
      hh = fit[fit.length - 1];
    } else {
      // Короб из ЛДСП: фасад перекрывает его сверху и снизу, снизу нужен
      // зазор под направляющую — отсюда запас 60 мм. Дополнительно короб не
      // может быть выше шага фасадов, иначе упрётся в соседний ящик.
      const MIN_BOX = 70;
      // минус собственное дно и технологический зазор
      const maxByPitch = Math.min(maxBoxTotal - BOT, availTop - BOT);
      // Высоту берём из СТАНДАРТНОГО ряда системы — самую большую, что влезает.
      // Раньше считалось «фасад минус 60», и короб выходил неоправданно высоким.
      const fitList = sys.heights.filter((x) => x.minFront <= frontH && x.h <= maxByPitch);
      const std = fitList.length ? fitList[fitList.length - 1] : null;
      const h = std ? std.h : Math.max(MIN_BOX, Math.min(Math.round((frontH - 60) / 10) * 10, maxByPitch));
      if (maxByPitch < MIN_BOX) {
        o.warnings.push(`${o.secName}, ящик ${i + 1}: фасад ${Math.round(frontH)} мм слишком мал — `
          + `короб не построен. Уменьшите число ящиков или увеличьте высоту модуля.`);
        y += frontH;
        continue;
      }
      hh = std || { code: String(h), h, minFront: h + 60 };
    }
    const tag = `${o.secName}, ящик ${i + 1}`;

    // Сведения о коробе — из них потом считается присадка фасада
    if (o.boxInfo) o.boxInfo.push({ index: i, h: hh.h, code: hh.code, reling: hh.reling || 0,
      bot: BOT, metal: !!sys.metal });
    // ОСЬ КОРПУСНОГО ПРОФИЛЯ НАПРАВЛЯЮЩЕЙ:
    //   • металлическая царга (TANDEMBOX, LEGRABOX, InnoTech) — по низу царги;
    //   • СКРЫТЫЕ направляющие (Hettich Quadro) — ПОД ДНОМ короба: профиль
    //     живёт в зазоре под ящиком, поэтому крепёж идёт на уровне дна, а не
    //     по середине боковины;
    //   • шариковые боковые — по середине боковины короба, там и профиль.
    const hiddenRunner = !sys.metal && sys.bottom === 'chipboard';
    if (o.runnerYs) {
      o.runnerYs.push(round1(y + (sys.metal ? 20 : (hiddenRunner ? BOT / 2 : BOT + hh.h / 2))));
    }

    if (sys.metal) {
      const b = sys.bottom(o.sectionOpening, NL, sys, o.t);
      const bk = sys.back(o.sectionOpening, hh, sys, o.t);
      o.parts.push(makePart({
        name: 'Дно ящика', section: tag, material: o.drawerDecor.code, thickness: o.drawerT,
        length: b.length, width: b.width, qty: 1, kind: 'drawerBottom',
        note: `${sys.name}, NL ${NL}, царга ${hh.code}`,
        edging: { long1: null, long2: null, short1: null, short2: null },
        // Дно металлической системы ставим ПО ЕГО передней кромке: у разных
        // систем длина дна то короче NL (Blum), то длиннее (InnoTech), и
        // центрировать его по коробу нельзя — оно упрётся в фасад.
        x: o.secCenterX, y: y + o.drawerT / 2,
        z: Number.isFinite(o.frontZ) ? o.frontZ - b.length / 2 : 0,
        dims: { w: b.width, h: o.drawerT, d: b.length },
      }));
      o.parts.push(makePart({
        name: 'Задняя стенка ящика', section: tag, material: o.drawerDecor.code, thickness: o.drawerT,
        length: bk.length, width: bk.width, qty: 1, kind: 'drawerBack',
        edging: { long1: EDGE_FRONT, long2: null, short1: null, short2: null },
        note: `${sys.name}, царга ${hh.code}`,
        x: o.secCenterX, y: y + o.drawerT + bk.width / 2, z: zc - NL / 2 + o.drawerT / 2,
        dims: { w: bk.length, h: bk.width, d: o.drawerT },
      }));
    } else {
      // Ящик целиком из ЛДСП: 2 боковины, перед и зад, дно ХДФ.
      // Дно крепится СНИЗУ к стенкам, поэтому оно занимает первые tb мм по
      // высоте, а стенки начинаются над ним. Раньше дно и стенки стояли на
      // одной отметке и пересекались на толщину ХДФ.
      const clr = sys.clearanceFor ? sys.clearanceFor(o.t) : sys.clearancePerSide;
      // Серия EB задаёт и предельную толщину боковины КОРОБА
      if (sys.maxBoxSide && o.drawerT > sys.maxBoxSide) {
        o.warnings.push(`${o.secName}: боковина ящика ${o.drawerT} мм при `
          + `ограничении ${sys.maxBoxSide} мм для этой серии направляющих — `
          + 'возьмите исполнение EB23 или уменьшите толщину.');
      }
      // У систем, где зазор задан до ВНУТРЕННЕЙ грани боковины ящика
      // (Quadro), просвет короба = проём − 2×зазор, а наружная ширина
      // получается больше на две толщины боковины.
      const boxW = sys.clearanceToInner
        ? round1(o.sectionOpening - 2 * clr + 2 * o.drawerT)
        : o.sectionOpening - 2 * clr;
      const sideH = hh.h;
      // ДВЕ РАЗНЫЕ КОНСТРУКЦИИ КОРОБА:
      //   • боковые направляющие — дно ПОД стенками, стенки стоят на нём;
      //   • скрытые (Quadro) — дно МЕЖДУ стенками, в паз, а стенки опущены
      //     на 10 мм ниже дна: этим уступом короб и садится на механизм.
      const ledgeBox = sys.boxStyle === 'ledge';
      // НАДВИЖНОЙ КОРОБ:
      //   • боковины опущены на LEDGE ниже дна — упор направляющей;
      //   • ДНО идёт на всю длину и лежит ПОД передней и задней стенками;
      //   • стенки поэтому ниже боковин на (LEDGE + толщина дна).
      const LEDGE = Number(sys.boxLedge) || 12;
      const wallY = ledgeBox ? y : y + BOT;          // низ БОКОВИН
      const wallTopCut = ledgeBox ? round1(LEDGE + BOT) : 0;   // 12 + 16 = 28
      const panelY = ledgeBox ? y + wallTopCut : y + BOT;      // низ перед/зад
      const panelH = ledgeBox ? round1(sideH - wallTopCut) : sideH;
      // Две боковины отдельными деталями: у каждой свои координаты.
      // (Раньше стояло qty:2 при одном боксе — правая боковина не рисовалась.)
      // ПРИСАДКА БОКОВИНЫ ЯЩИКА. С боков ящика фурнитуры быть не видно:
      // сквозных отверстий нет вовсе, всё глухое.
      //   • снаружи — только под ответную планку направляющей (Ø3.5×10),
      //     её закрывает сама планка;
      //   • изнутри — дюбели Ø8 минификса, которым собран короб.
      const RUN_D = 3.5, RUN_DEPTH = 10;
      const runY = round1(Math.min(Math.max(sideH / 2, 12), sideH - 12));
      // ТОЧКИ СТЫКА БОКОВИНА ↔ ПЕРЕД/ЗАД — в МИРОВЫХ координатах по высоте.
      // У надвижного короба стенки на 28 мм ниже боковин, и одинаковый
      // локальный отступ давал разные точки: дюбель не совпадал со штоком.
      const joinRaw = jointPoints(panelH).filter((v) => v > 6 && v < panelH - 6);
      const joinWorldY = (joinRaw.length ? joinRaw : [round1(panelH / 2)])
        .map((v) => round1(panelY + v));
      for (const sgn of [-1, 1]) {
        const holes = [];
        // Ответная планка направляющей. У СКРЫТЫХ (Quadro) её на боковине
        // нет вовсе: направляющая живёт под дном, и короб крепится к ней
        // снизу. У боковых (шариковых) планка идёт по боковине.
        if (!hiddenRunner) {
          for (const rx of [37, 37 + 224].filter((v) => v < NL - 20)) {
            holes.push({ x: round1(rx), y: runY, d: RUN_D, depth: RUN_DEPTH,
                         through: false, side: 'back', kind: 'drawerRunner' });
          }
        }
        // дюбели минификса под сборку короба — с ВНУТРЕННЕЙ стороны
        for (const ex of [0, 1]) {
          // дюбель встаёт по оси стенки: на пол-толщины от торца боковины
          const dx = ex ? round1(NL - o.drawerT / 2) : round1(o.drawerT / 2);
          for (const wy of joinWorldY) {
            holes.push({ x: dx, y: round1(wy - wallY), d: RASTEX.dowelD,
                         depth: RASTEX.dowelDepth,
                         through: false, side: 'front', kind: 'minifixDowel' });
          }
        }
        o.parts.push(makePart({
          name: 'Боковина ящика', section: tag, material: o.drawerDecor.code, thickness: o.drawerT,
          length: NL, width: sideH, qty: 1, kind: 'drawerSide',
          note: `${sys.name}, NL ${NL}; присадка глухая — снаружи фурнитуры не видно`,
          holes,
          edging: { long1: EDGE_FRONT, long2: null, short1: null, short2: null },
          x: o.secCenterX + sgn * (boxW / 2 - o.drawerT / 2), y: wallY + sideH / 2, z: zc,
          dims: { w: o.drawerT, h: sideH, d: NL },
        }));
      }
      // Передняя и задняя стенки ящика — тоже двумя отдельными деталями.
      // ПЕРЕДНЯЯ несёт фасад: через неё изнутри идут четыре винта, поэтому
      // на ней сквозная присадка Ø5 — двумя рядами, иначе фасад держится
      // только по низу и «клюёт» носом.
      const FIX_IN = 32;                       // отступ от кромок стенки
      const fixSpreadX = Math.max(64, (boxW - 2 * o.drawerT) / 2 - 40);
      const fixRows = sideH >= 100
        ? [FIX_IN, round1(sideH - FIX_IN)]
        : [round1(sideH / 2)];
      // ТОЧКИ КРЕПЛЕНИЯ ФАСАДА — в мировых координатах. По ним сверлится и
      // стенка короба, и сам фасад: считать их отдельно для каждой детали
      // нельзя, отверстия расходятся и фасад не сесть.
      const fixWorld = [];
      for (const ry of fixRows) {
        for (const sx of [-1, 1]) {
          fixWorld.push({ x: round1(o.secCenterX + sx * fixSpreadX), y: round1(wallY + ry) });
        }
      }
      if (o.boxInfo && o.boxInfo.length) {
        o.boxInfo[o.boxInfo.length - 1].fixWorld = fixWorld;
      }
      for (const zs of [-1, 1]) {
        const isFront = zs > 0;
        const frontHoles = [];
        // Короб собран на минификсы: гнездо Ø15 в пласти передней/задней
        // стенки (изнутри), шток Ø8 — в её торец. В боковине только дюбель,
        // поэтому снаружи ящика ничего не видно.
        for (const ex of [0, 1]) {
          for (const wy of joinWorldY) {
            const jy = round1(wy - panelY);
            const cx = ex ? (boxW - 2 * o.drawerT) - RASTEX.camSetback : RASTEX.camSetback;
            if (cx <= 4 || cx >= (boxW - 2 * o.drawerT) - 4) continue;
            // Гнездо Ø15 выводим НАРУЖУ короба. У ПЕРЕДНЕЙ стенки наружу —
            // это сторона фасада (+Z, side 'front'), у ЗАДНЕЙ — сторона
            // задней стенки корпуса (−Z, side 'back'). Раньше обе стенки
            // сверлились одинаково, и у передней эксцентрик смотрел ВНУТРЬ
            // ящика — там лежат вещи, так нельзя.
            frontHoles.push({ x: round1(cx), y: jy, d: RASTEX.camD,
                              depth: RASTEX.camDepthFor(o.drawerT),
                              through: false, side: isFront ? 'front' : 'back',
                              kind: 'minifixCam' });
            frontHoles.push({ x: ex ? round1(boxW - 2 * o.drawerT) : 0, y: jy,
                              d: RASTEX.boltD, depth: RASTEX.boltDepth,
                              through: false, side: 'edge', kind: 'minifixBolt' });
          }
        }
        // ПЕРЕДНИЙ ДЕРЖАТЕЛЬ (скрытые направляющие). По инструкции он
        // прикручивается к ПЕРЕДНЕЙ стенке короба двумя шурупами 3,5×20;
        // оси — 26 и 48 мм над нижней кромкой стенки. Сзади короб ничем не
        // сверлится: он просто ложится уступом на направляющую.
        if (isFront && !sys.metal) {
          // Фасад держит шуруп 3,5×30: в стенке короба отверстие ПРОХОДНОЕ
          // Ø4 (шуруп проходит свободно и притягивает фасад), а в самом
          // фасаде — направляющее Ø2,5 под резьбу. Одинаковое Ø5 с обеих
          // сторон означало бы, что резьбе не за что держаться.
          const panelLeft = o.secCenterX - (boxW - 2 * o.drawerT) / 2;
          for (const fp of fixWorld) {
            frontHoles.push({
              x: round1(fp.x - panelLeft), y: round1(fp.y - panelY),
              d: 4, depth: o.drawerT, through: true, side: 'front', kind: 'frontFix',
            });
          }
        }
        o.parts.push(makePart({
          name: isFront ? 'Передняя стенка ящика' : 'Задняя стенка ящика',
          section: tag, material: o.drawerDecor.code, thickness: o.drawerT,
          length: boxW - 2 * o.drawerT, width: panelH, qty: 1, kind: 'drawerBack',
          holes: frontHoles,
          note: sys.name + (isFront && !sys.metal ? '; через неё фасад крепится винтами' : '')
            + (ledgeBox ? `; стоит НА дне, ниже боковины на ${wallTopCut} мм` : ''),
          edging: { long1: EDGE_FRONT, long2: null, short1: null, short2: null },
          x: o.secCenterX, y: panelY + panelH / 2,
          z: zc + zs * (NL / 2 - o.drawerT / 2),
          dims: { w: boxW - 2 * o.drawerT, h: panelH, d: o.drawerT },
        }));
      }
      // КАК ДЕРЖИТСЯ ДНО.
      //   • Скрытые направляющие (Quadro): дно вкладывается МЕЖДУ стенками
      //     в паз, а стенки опущены на 10 мм ниже него — этим уступом короб
      //     садится на механизм.
      //   • Боковые направляющие: дно лежит ПОД стенками и тянется
      //     конфирматом (по ХДФ 3 мм — саморезом).
      const botInGroove = false;   // паза нет: дно вкладывается между стенками
      const botConfirmat = !!botChip && !botInGroove;
      // Дно надвижного короба — ЛДСП 16 мм МЕЖДУ стенками, без паза:
      // режется точно в просвет, а держится минификсом (снаружи не видно).
      const botL = ledgeBox
        ? round1(NL)                                   // во всю длину короба
        : (sys.bottomLen ? round1(sys.bottomLen(NL)) : (NL - 2));
      // Ширина дна: у скрытых направляющих оно проходит МЕЖДУ профилями и
      // у́же короба (SKW = LB − 40 при плите до 16 мм), у боковых — просто
      // вкладывается между боковинами короба.
      // Дно режется В РАЗМЕР КОРОБА по ширине: оно лежит под боковинами и
      // перекрывает их торцы целиком. Технологический миллиметр по бокам,
      // который я закладывал раньше, убран — дно вровень с коробом.
      const botW = ledgeBox ? round1(boxW - 2 * o.drawerT) : round1(boxW);
      const fixX = [60, round1(botL / 2), round1(botL - 60)].filter((v) => v > 20 && v < botL - 20);
      const botHoles = [];
      // ЗАЦЕП НАПРАВЛЯЮЩЕЙ — Ø6×10 В ТОРЕЦ ДНА сзади. По разрезу ось лежит
      // в 11 мм от нижней плоскости короба и в 7 мм от внутренней грани
      // боковины: при дне 16 мм эта ось попадает в само дно, поэтому
      // сверлится оно, а не задняя стенка.
      if (sys.bottomPin) {
        const bp = sys.bottomPin;
        for (const yLoc of [round1(bp.fromSide), round1(botW - bp.fromSide)]) {
          if (yLoc <= 3 || yLoc >= botW - 3) continue;
          botHoles.push({ x: 0, y: yLoc, d: bp.d, depth: bp.depth,
                          through: false, side: 'edge', kind: 'runnerPinRear' });
        }
      }
      // ГНЁЗДА В ДНЕ (посадочные Ø6×4 и защёлка Ø6×11) НЕ сверлим: они
      // нужны только коробу с тонким дном из ДВП, а такого ящика в базе
      // нет — у Quadro дно всегда ЛДСП. Короб цепляется за направляющую
      // зацепами Ø6 в передней и задней стенках (см. ниже).
      // КРЕПЛЕНИЕ ДНА. Координаты берём от ФАКТИЧЕСКИХ плоскостей стенок,
      // а не от кромок дна: дно короче короба (NL − 10) и его кромка не
      // совпадает с осью стенки — раньше отверстия расходились на 5 мм.
      const botLeftZ = zc - botL / 2;          // задняя кромка дна
      const botLeftX = o.secCenterX - botW / 2; // левая кромка дна
      const sideAxisX = [o.secCenterX - (boxW / 2 - o.drawerT / 2),
                         o.secCenterX + (boxW / 2 - o.drawerT / 2)];
      for (const fx of (ledgeBox ? [] : fixX)) {
        for (const fy of sideAxisX.map((wx) => round1(wx - botLeftX))) {
          botHoles.push({
            x: fx, y: fy, d: botConfirmat ? 7 : 4.5, depth: BOT, through: true,
            side: 'back', kind: botConfirmat ? 'confirmatThrough' : 'boxBottomFix',
          });
        }
      }
      // ...и по КОРОТКИМ: в нижние торцы передней и задней стенок. Иначе дно
      // притянуто только с боков, а спереди и сзади отходит.
      const innerW = boxW - 2 * o.drawerT;               // длина перед/зад стенки
      const fixY = (innerW >= 500 ? [70, round1(innerW / 2), round1(innerW - 70)] : [60, round1(innerW - 60)])
        .filter((v) => v > 20 && v < innerW - 20);
      const wallFixWorld = fixY.map((v) => round1(o.secCenterX - innerW / 2 + v));
      // Оси передней и задней стенок в системе дна
      const wallAxisZ = [zc - (NL / 2 - o.drawerT / 2), zc + (NL / 2 - o.drawerT / 2)]
        .map((wz) => round1(wz - botLeftZ));
      for (const wx of (ledgeBox ? [] : wallFixWorld)) {
        for (const fx of wallAxisZ) {
          botHoles.push({
            x: fx, y: round1(wx - (o.secCenterX - botW / 2)),
            d: botConfirmat ? 7 : 4.5, depth: BOT, through: true,
            side: 'back', kind: botConfirmat ? 'confirmatThrough' : 'boxBottomFix',
          });
        }
      }
      // ответная присадка в нижних торцах передней и задней стенок
      for (const wp of (ledgeBox ? [] : o.parts.filter((q) => q.kind === 'drawerBack'
        && Math.abs(q.box.y - (wallY + sideH / 2)) < 0.6))) {
        for (const v of fixY) {
          wp.holes.push(botConfirmat
            ? { x: v, y: 0, d: 5, depth: 50, through: false, side: 'edge', kind: 'confirmatEdge' }
            : { x: v, y: 0, d: 3, depth: 12, through: false, side: 'edge', kind: 'boxBottomFix' });
        }
      }
      o.parts.push(makePart({
        name: 'Дно ящика', section: tag, material: botMat.code, thickness: BOT,
        length: botL, width: botW, qty: 1, kind: 'drawerBottom',
        holes: botHoles,
        note: botInGroove
          ? `${sys.name}, вкладное в паз ${BOT + 0.5}×4 мм по периметру короба`
          : `${sys.name}, притянуто снизу в торцы стенок `
            + (botConfirmat ? 'конфирматами, ЛДСП' : 'саморезами, ХДФ'),
        edging: { long1: null, long2: null, short1: null, short2: null },
        // У короба со скрытыми направляющими дно поднято на уступ 10 мм:
        // именно на этот выступ боковин и садится механизм.
        x: o.secCenterX, y: (ledgeBox ? y + LEDGE + BOT / 2 : y + BOT / 2), z: zc,
        dims: { w: botW, h: BOT, d: botL },
      }));
      // КРЕПЛЕНИЕ ДНА У НАДВИЖНОГО КОРОБА. Дно стоит между стенками, значит
      // тянется торцом — минификсом: гнездо Ø15 снизу дна (его не видно),
      // шток Ø8 в торец дна, дюбель Ø8 в пласть стенки изнутри. Конфирмат
      // тут не годится: его шляпка вылезла бы на наружную пласть боковины.
      if (ledgeBox) {
        const botMidY2 = y + LEDGE + BOT / 2;          // ось дна по высоте
        const botLeftX2 = o.secCenterX - botW / 2;
        const botBackZ2 = zc - botL / 2;

        // 1. ДНО ↔ ПЕРЕДНЯЯ и ЗАДНЯЯ СТЕНКИ — КОНФИРМАТ снизу через дно
        //    в нижний торец стенки: стенка стоит НА дне, шляпка снизу.
        const wallPts = jointPoints(botW).filter((v) => v > 30 && v < botW - 30);
        for (const wp of o.parts.filter((r) => r.kind === 'drawerBack'
          && Math.abs(r.box.y - (panelY + panelH / 2)) < 0.6)) {
          const wallZ = wp.box.z;
          const zLocal = round1(wallZ - botBackZ2);     // ось стенки в системе дна
          for (const v of (wallPts.length ? wallPts : [round1(botW / 2)])) {
            botHoles.push({ x: zLocal, y: round1(v), d: 7, depth: BOT,
                            through: true, side: 'back', kind: 'confirmatThrough' });
            wp.holes.push({ x: round1(botLeftX2 + v - (wp.box.x - wp.box.w / 2)), y: 0,
                            d: 5, depth: 50, through: false,
                            side: 'edge', kind: 'confirmatEdge' });
          }
        }

        // ПЕРЕДНИЙ ФИКСАТОР — прикручивается К ДНУ СНИЗУ двумя шурупами
        // 3,5×20: оси 26 и 48 мм от ПЕРЕДНЕГО края дна, по одному фиксатору
        // с каждой стороны (он прижат к боковине).
        {
          const br = sys.bracketScrew || { d: 3, depth: 15, fromSide: [26, 48], fromFront: 6 };
          const xLoc = round1(botL - br.fromFront);      // 6 мм от переднего края
          for (const fs2 of br.fromSide) {
            for (const yLoc of [round1(fs2), round1(botW - fs2)]) {
              if (yLoc <= 6 || yLoc >= botW - 6) continue;
              botHoles.push({ x: xLoc, y: yLoc, d: br.d, depth: br.depth,
                              through: false, side: 'back', kind: 'runnerBracket' });
            }
          }
        }

        // 2. ДНО ↔ БОКОВИНЫ и СТЕНКИ ↔ БОКОВИНЫ — РАСТЕКС (минификс):
        //    снаружи боковины ничего не видно.
        for (const sp of o.parts.filter((r) => r.kind === 'drawerSide'
          && Math.abs(r.box.y - (wallY + sideH / 2)) < 0.6)) {
          const spBack = sp.box.z - sp.box.d / 2;
          const nearLeft = sp.box.x < o.secCenterX;
          const pts3 = jointPoints(botL).filter((v) => v > 30 && v < botL - 30);
          for (const v of (pts3.length ? pts3 : [round1(botL / 2)])) {
            const worldZ = botBackZ2 + v;
            sp.holes.push({ x: round1(worldZ - spBack), y: round1(botMidY2 - (sp.box.y - sp.box.h / 2)),
                            d: RASTEX.dowelD, depth: RASTEX.dowelDepth,
                            through: false, side: 'front', kind: 'minifixDowel' });
            botHoles.push({ x: round1(v), y: round1(nearLeft ? RASTEX.camSetback : botW - RASTEX.camSetback),
                            d: RASTEX.camD, depth: RASTEX.camDepthFor(BOT),
                            through: false, side: 'back', kind: 'minifixCam' });
            botHoles.push({ x: round1(v), y: round1(nearLeft ? 0 : botW),
                            d: RASTEX.boltD, depth: RASTEX.boltDepth,
                            through: false, side: 'edge', kind: 'minifixBolt' });
          }
        }
      }
      // ПАЗ ПОД ДНО. Режется по периметру короба на уровне дна: боковины и
      // обе стенки. Ширина паза — толщина дна + 0,5 на посадку, глубина 4 мм
      // (именно она добирает LB−40 до просвета между боковинами короба).
      if (botInGroove) {
        const PAZ_D2 = PAZ_BOT, PAZ_W2 = round1(BOT + 0.5);
        const botMidY = y + LEDGE + BOT / 2;       // ось паза по высоте
        for (const q of o.parts.filter((r) => (r.kind === 'drawerSide' || r.kind === 'drawerBack')
          && Math.abs(r.box.y - (wallY + sideH / 2)) < 0.6)) {
          const yPaz = round1(botMidY - (q.box.y - q.box.h / 2));
          if (yPaz < 1 || yPaz > q.width - 1) continue;
          q.grooves.push({
            kind: 'bottomGroove', x0: 0, y0: yPaz, x1: round1(q.length), y1: yPaz,
            w: PAZ_W2, depth: PAZ_D2, side: 'inner', note: 'Паз под дно ящика',
          });
        }
      }
      // Ответная присадка в нижнем торце боковин. Координату пересчитываем
      // ЧЕРЕЗ МИР: боковина длиннее дна (NL против NL−10), поэтому один и
      // тот же локальный отступ даёт разные точки.
      for (const sp of (ledgeBox ? [] : o.parts.filter((q) => q.kind === 'drawerSide'
        && Math.abs(q.box.y - (wallY + sideH / 2)) < 0.6))) {
        const spBack = sp.box.z - sp.box.d / 2;
        for (const fx of fixX) {
          const worldZ = botLeftZ + fx;
          const lx = round1(worldZ - spBack);
          if (lx < 8 || lx > sp.length - 8) continue;
          sp.holes.push(botConfirmat
            ? { x: lx, y: 0, d: 5, depth: 50, through: false,
                side: 'edge', kind: 'confirmatEdge' }
            : { x: lx, y: 0, d: 3, depth: 12, through: false,
                side: 'edge', kind: 'boxBottomFix' });
        }
      }
    }
    maxTop = Math.max(maxTop, y + BOT + hh.h);
    y += frontH;
  }

  // Помещаемость проверяем по КОРОБАМ: именно они стоят внутри корпуса
  if (o.innerTopY && maxTop > o.innerTopY + 0.5) {
    o.warnings.push(`${o.secName}: короба ящиков не помещаются — не хватает `
      + `${Math.round(maxTop - o.innerTopY)} мм по высоте.`);
  }
}

// ---------------------------------------------------------------------------
// РУЧКИ И ПРИСАДКА ПОД НИХ
//
// Правила разметки (практика сборки, см. README):
//   • на ДВЕРИ ручка ставится у противоположного петлям края — отступ зависит
//     от конструкции фасада (см. doorHandleEdge ниже), тот же отступ и от
//     верха/низа;
//   • на ФАСАДЕ ЯЩИКА ручка ставится по центру ширины, по центру высоты;
//     у высоких фасадов — 50 мм от верхнего края;
//   • на ШИРОКОМ фасаде ставят ДВЕ ручки, симметрично от центра;
//   • скоба — два отверстия Ø5 на межосевом расстоянии, кнопка — одно.
//
// Отверстия описываются в системе координат ДЕТАЛИ: начало — левый нижний угол
// лицевой стороны, x вправо, y вверх. Именно так их ждёт станок присадки.
// ---------------------------------------------------------------------------
const HANDLE_EDGE = 50;        // отступ ручки от края фасада (ящик/откидной), мм
const HANDLE_EDGE_SHEET_DOOR = 30; // отступ ручки от края ЛИСТОВОЙ двери (ЛДСП/МДФ), мм — подтверждено пользователем
const TWO_HANDLES_FROM = 900;  // с этой ширины фасада ставим две ручки, мм

// Отступ ручки от края ДВЕРИ: правило зависит от конструкции фасада, а не
// единое число (подтверждено пользователем). У листового фасада (ЛДСП/МДФ —
// facadeType без frame) — фиксированные 30 мм. У рамочного (дерево/алюминиевый
// профиль — frameW у facadeType, см. catalog.js FACADE_TYPES) отверстие идёт
// строго по центру ширины видимого профиля рамки, иначе винт попадёт в паз
// или на стеклянную/филёнчатую вставку — поэтому берём frameW/2, а не число.
function doorHandleEdge(frameW) {
  return frameW > 0 ? frameW / 2 : HANDLE_EDGE_SHEET_DOOR;
}

// Чашки под петли: Ø35, глубина 12,5, сверлятся с ИЗНАНКИ фасада.
// Отступ от края открывания до центра чашки — 22 мм (накладная петля),
// крайние чашки — 100 мм от верхнего и нижнего торцов, промежуточные
// распределяются равномерно между ними.
const HINGE_CUP_D = 35;
const HINGE_CUP_DEPTH = 12.5;
const HINGE_EDGE = 22;      // от края фасада до центра чашки, мм
const HINGE_END = 100;      // от торца фасада до центра крайней чашки, мм

function hingeCount(h) {
  if (h <= 900) return 2;
  if (h <= 1600) return 3;
  if (h <= 2200) return 4;
  return 5;
}

// Чашка не должна попасть на высоту полки: ответная планка петли крепится
// к боковине ровно там, где стоит полкодержатель, и они мешают друг другу.
// Поэтому конфликтующую чашку сдвигаем на ближайшее свободное место.
const HINGE_SHELF_CLEAR = 60;   // минимальный просвет до плоскости полки, мм

function avoidShelves(y, H, shelves) {
  if (!shelves || !shelves.length) return y;
  const fits = (v) => v >= 60 && v <= H - 60
    && shelves.every((sy) => Math.abs(v - sy) >= HINGE_SHELF_CLEAR);
  if (fits(y)) return y;
  for (let d = 10; d <= 250; d += 10) {
    if (fits(y - d)) return y - d;
    if (fits(y + d)) return y + d;
  }
  return null;                  // места нет — сообщим наружу
}

function hingeHoles(W, H, hingeSide, shelves, warn, secName, glassDoor, railBottom) {
  const n = hingeCount(H);
  // У стеклянной двери отверстие ближе к краю — по каталогам стеклянных петель
  const edge = glassDoor ? 30 : HINGE_EDGE;
  const x = hingeSide === 'left' ? edge : W - edge;
  const y0 = HINGE_END;
  // Верхняя чашка не должна попасть в зону верхней планки/царги (см. railTopH
  // в buildModuleParts): планка идёт поперёк корпуса ровно там, где по
  // умолчанию (100 мм от торца) встала бы верхняя петля, — иначе ответную
  // планку петли физически некуда крепить. railBottom — нижняя граница этой
  // зоны в системе координат ДВЕРИ (от её нижнего торца); если он ниже
  // штатных H-HINGE_END, поджимаем верхнюю границу под него.
  const y1 = Number.isFinite(railBottom)
    ? Math.min(H - HINGE_END, railBottom - HINGE_SHELF_CLEAR)
    : H - HINGE_END;
  if (y1 <= y0) return [];
  const out = [];
  const placed = [];
  for (let i = 0; i < n; i++) {
    const ideal = n === 1 ? (y0 + y1) / 2 : y0 + ((y1 - y0) * i) / (n - 1);
    // мешают и полки, и уже поставленные чашки (между ними нужен просвет)
    const busy = (shelves || []).concat(placed);
    const y = avoidShelves(ideal, H, busy);
    if (y === null) {
      if (warn) {
        warn(`${secName}: петля на высоте ${Math.round(ideal)} мм попадает на полку, `
          + `а свободного места рядом нет — сдвиньте полку или уменьшите число петель.`);
      }
      continue;
    }
    placed.push(y);
    // Петля для стеклянной двери 4 мм: отверстие Ø26 СКВОЗЬ стекло,
    // чашки Ø35 в стекле не сверлят — оно лопнет.
    out.push(glassDoor
      ? { x: round1(x), y: round1(y), d: 26, depth: 0, through: true,
          side: 'front', kind: 'hingeGlass' }
      : { x: round1(x), y: round1(y), d: HINGE_CUP_D, depth: HINGE_CUP_DEPTH,
          through: false, side: 'back', kind: 'hingeCup' });
  }
  return out;
}

// Высота ручки на двери в координатах фасада. Считается от ПОЛА, поэтому
// у соседних фасадов разной высоты ручки оказываются на одном уровне.
const HAND_LEVEL = 1000;     // уровень руки от пола, мм
function handleLevel(o, H, edge) {
  const bottom = Number(o.floorY);           // низ фасада от пола
  if (!Number.isFinite(bottom)) return H > 900 ? H / 2 : H - edge;
  const top = bottom + H;
  if (top <= 1100) return H - edge;   // низкий фасад — берут сверху
  if (bottom >= 1200) return edge;    // навесной — берут снизу
  return Math.min(Math.max(HAND_LEVEL - bottom, edge), H - edge);
}

function handleHoles(o) {
  const cat = window.Modul3D.catalog;
  let h = cat.HANDLES[o.handleId] || cat.HANDLES.none;
  if (!h.holes) return { holes: [], mounts: [], handle: h, count: 0 };
  // Скоба с ручным межосевым: подставляем заданное пользователем значение.
  if (h.custom) {
    const cc = Math.round(Number(o.handleCC) || 0);
    if (!(cc >= 32 && cc <= 1200)) {
      return { holes: [], mounts: [], handle: h, count: 0, badCC: true };
    }
    h = Object.assign({}, h, { cc, name: `Ручка-скоба ${cc} мм (своё межосевое)` });
  }

  const W = o.width, H = o.height;
  const D = cat.HANDLE_HOLE_D;
  const holes = [];
  // mounts — куда встанет сама ручка (для 3D и чертежей), в координатах детали
  const mounts = [];
  const put = (cx, cy) => {
    mounts.push({ cx: round1(cx), cy: round1(cy), cc: h.cc || 0, vertical: false });
    if (h.holes === 1) holes.push({ x: round1(cx), y: round1(cy), d: D, through: true, kind: 'handle' });
    else {
      holes.push({ x: round1(cx - h.cc / 2), y: round1(cy), d: D, through: true, kind: 'handle' });
      holes.push({ x: round1(cx + h.cc / 2), y: round1(cy), d: D, through: true, kind: 'handle' });
    }
  };

  // Две ручки на широком фасаде ставятся симметрично: КРАЙНЕЕ ОТВЕРСТИЕ
  // каждой ручки — в 50 мм от своего торца, ровно как у одиночной ручки
  // на двери. Раньше они делили фасад на три части и уезжали к середине.
  const half = h.holes === 2 ? h.cc / 2 : 0;
  const pairX = () => {
    const left = HANDLE_EDGE + half;
    const right = W - HANDLE_EDGE - half;
    return (right - left > 20) ? [left, right] : [W / 2];
  };

  let count = 1;
  if (o.kind === 'drawerFront') {
    // Ящик: по центру высоты, у высокого фасада — 50 мм от верха.
    const cy = Math.min(Math.max(H > 250 ? H - HANDLE_EDGE : H / 2, 12), H - 12);
    if (W >= TWO_HANDLES_FROM) {
      const xs = pairX();
      count = xs.length;
      for (const cx of xs) put(cx, cy);
    } else {
      put(W / 2, cy);
    }
  } else if (o.kind === 'liftFront') {
    // Откидной фасад: ручка снизу по центру
    const cy = HANDLE_EDGE;
    if (W >= TWO_HANDLES_FROM) {
      const xs = pairX();
      count = xs.length;
      for (const cx of xs) put(cx, cy);
    } else {
      put(W / 2, cy);
    }
  } else {
    // Дверь: ручка у края, противоположного петлям.
    // По высоте ручка привязана к ПОЛУ, а не к самому фасаду — тогда на
    // смежных фасадах разной высоты ручки стоят на одном уровне:
    //   • фасад целиком внизу (верх ниже 1100) — ручка у верхнего края;
    //   • навесной фасад (низ выше 1200) — у нижнего края;
    //   • высокая дверь шкафа — на уровне руки, 1000 мм от пола.
    // Скоба на двери ставится вертикально, поэтому её центр обязательно
    // отодвигается от края так, чтобы оба отверстия остались на детали.
    // Отступ зависит от конструкции фасада — см. doorHandleEdge.
    const edge = doorHandleEdge(o.frame);
    const cx = o.hingeSide === 'left' ? W - edge : edge;
    const MIN_EDGE = 12;                       // минимум от отверстия до торца

    // Ориентация скобы: по умолчанию на двери вертикально, но можно поставить
    // и горизонтально — тогда ручка идёт вдоль верхнего края.
    const horizontal = h.holes === 2 && o.orient === 'horizontal';

    if (h.holes === 2 && !horizontal) {
      // ВЕРТИКАЛЬНО. Отступ отсчитывается до КРАЙНЕГО ОТВЕРСТИЯ, а не до
      // середины ручки: иначе у длинной скобы верхнее отверстие оказывается
      // почти у самого торца фасада.
      // Три случая — те же пороги, что и в handleLevel (низкий/навесной/по
      // уровню руки), но здесь считаем ОБА отверстия от того края, к
      // которому реально привязана ручка, а не всегда «сверху вниз»: раньше
      // единая формула top = handleLevel(...); bottom = top − cc считала,
      // что handleLevel всегда возвращает позицию ВЕРХНЕГО отверстия — верно
      // для низкого фасада, но для навесного и «по уровню руки» итоговое
      // нижнее отверстие проваливалось к аварийному минимуму MIN_EDGE вместо
      // заданного отступа — баг, подтверждённый пользователем на зонах пенала.
      const floorY = Number(o.floorY);
      let top, bottom;
      // Зона фасада внутри пенала (zoneCount>1): кроме САМОЙ НИЖНЕЙ зоны,
      // все остальные тянут ручку к своему НИЖНЕМУ краю (к шву с соседней
      // зоной снизу) — независимо от абсолютной высоты от пола. Это отдельно
      // подтверждено пользователем на реальном пенале: у него верхняя и
      // средняя зоны должны вести себя как навесной фасад, а не «по уровню
      // руки» (иначе средняя зона повисает по центру, не у шва). Нижняя зона
      // пенала (zoneIndex 0) продолжает жить по обычным трём случаям ниже —
      // для неё это уже подтверждено как корректное поведение.
      const isUpperZone = Number(o.zoneCount) > 1 && Number(o.zoneIndex) > 0;
      if (isUpperZone) {
        bottom = edge; top = bottom + h.cc;
      } else if (!Number.isFinite(floorY)) {
        if (H > 900) { const c = H / 2; bottom = c - half; top = c + half; }
        else { top = H - edge; bottom = top - h.cc; }
      } else if (floorY + H <= 1100) {
        top = H - edge; bottom = top - h.cc;                        // низкий — сверху
      } else if (floorY >= 1200) {
        bottom = edge; top = bottom + h.cc;                         // навесной — снизу
      } else {
        const c = HAND_LEVEL - floorY; bottom = c - half; top = c + half; // по уровню руки — по центру пары
      }
      // Пара не должна вылезать за деталь — сдвигаем ЦЕЛИКОМ (межосевое cc
      // не трогаем), а не пересчитываем от одного «верхнего» отверстия.
      // Сначала стараемся уложиться в edge (это и есть отступ по правилу
      // разметки), и только если совсем не хватает места на короткой зоне —
      // откатываемся к чисто конструктивному минимуму MIN_EDGE.
      if (bottom < edge) { top += edge - bottom; bottom = edge; }
      if (top > H - edge) { bottom -= top - (H - edge); top = H - edge; }
      if (bottom < MIN_EDGE) { top += MIN_EDGE - bottom; bottom = MIN_EDGE; }
      if (top > H - MIN_EDGE) { bottom -= top - (H - MIN_EDGE); top = H - MIN_EDGE; }
      const cy = (top + bottom) / 2;
      mounts.push({ cx: round1(cx), cy: round1(cy), cc: h.cc, vertical: true });
      holes.push({ x: round1(cx), y: round1(bottom), d: D, through: true, kind: 'handle' });
      holes.push({ x: round1(cx), y: round1(top), d: D, through: true, kind: 'handle' });
    } else if (horizontal) {
      // ГОРИЗОНТАЛЬНО: ручка вдоль верхнего края, ближним отверстием
      // в edge мм от края открывания.
      const cy = Math.min(Math.max(handleLevel(o, H, edge), MIN_EDGE), H - MIN_EDGE);
      const near = o.hingeSide === 'left' ? W - edge : edge;
      const far = o.hingeSide === 'left' ? near - h.cc : near + h.cc;
      const ccx = (near + far) / 2;
      mounts.push({ cx: round1(ccx), cy: round1(cy), cc: h.cc, vertical: false });
      holes.push({ x: round1(Math.min(near, far)), y: round1(cy), d: D, through: true, kind: 'handle' });
      holes.push({ x: round1(Math.max(near, far)), y: round1(cy), d: D, through: true, kind: 'handle' });
    } else {
      const cy = Math.min(Math.max(handleLevel(o, H, edge), MIN_EDGE), H - MIN_EDGE);
      mounts.push({ cx: round1(cx), cy: round1(cy), cc: 0, vertical: false });
      holes.push({ x: round1(cx), y: round1(cy), d: D, through: true, kind: 'handle' });
    }
  }

  // отверстия не должны вылезать за деталь
  const bad = holes.filter((p) => p.x < 8 || p.x > W - 8 || p.y < 8 || p.y > H - 8);
  return { holes, mounts, handle: h, count, overflow: bad.length > 0 };
}

// Создаёт «деталь» ручки для 3D и чертежей. В деталировку не попадает
// (hardware), в раскрой тоже — это фурнитура, но её надо видеть на фасаде.
function pushHandleParts(o) {
  const KNOB_D = 30, KNOB_OUT = 28;      // кнопка: диаметр и вылет от фасада
  const BOW_D = 14, BOW_OUT = 32;        // скоба: сечение и вылет
  for (const m of o.mounts) {
    const px = o.faceX - o.faceW / 2 + m.cx;      // центр ручки в координатах модуля
    const py = o.faceY - o.faceH / 2 + m.cy;
    const pz = o.faceZ + o.t / 2 + (m.cc ? BOW_OUT / 2 : KNOB_OUT / 2);
    const isBow = !!m.cc;
    const len = m.cc ? m.cc + 40 : KNOB_D;
    o.parts.push(makePart({
      name: isBow ? 'Ручка (скоба)' : 'Ручка (кнопка)', section: o.secName,
      material: 'HANDLE', thickness: 0,
      length: len, width: isBow ? BOW_D : KNOB_D, qty: 1, kind: 'handle',
      note: o.handleName,
      edging: { long1: null, long2: null, short1: null, short2: null },
      x: px, y: py, z: pz,
      dims: isBow
        ? (m.vertical ? { w: BOW_D, h: len, d: BOW_OUT } : { w: len, h: BOW_D, d: BOW_OUT })
        : { w: KNOB_D, h: KNOB_D, d: KNOB_OUT },
      shape: isBow ? (m.vertical ? 'handleBowV' : 'handleBowH') : 'handleKnob',
      cc: m.cc || 0,
      hardware: true,
    }));
  }
}

// Подбирает подъёмник: если выбранный не подходит по габариту фасада —
// предупреждаем, но НЕ подменяем молча.
function checkLift(liftId, frontH, bodyW) {
  const cat = window.Modul3D.catalog;
  const l = cat.LIFTS[liftId];
  if (!l) return null;
  const notes = [];
  if (frontH < l.minH || frontH > l.maxH) {
    notes.push(`фасад ${Math.round(frontH)} мм вне диапазона ${l.minH}–${l.maxH} мм`);
  }
  if (bodyW > l.maxW) notes.push(`ширина корпуса ${Math.round(bodyW)} мм больше допустимых ${l.maxW} мм`);
  return { lift: l, notes };
}

// Тип фасада секции: материал, толщина и способ отрисовки.
// Совместимость: старый флажок sec.glass = «стекло 4 мм».
// facadeDecor — ДЕКОР ФАСАДА, отдельный от корпуса: у кухни корпус обычно
// белый, а фасад в другом декоре. Если не задан — берётся декор корпуса.
function facadeTypeOf(sec, decor, t, facadeDecor, facadeThickness) {
  const cat = window.Modul3D.catalog;
  const id = sec.facadeType || (sec.glass ? 'glass4' : 'ldsp');
  const ft = cat.FACADE_TYPES[id] || cat.FACADE_TYPES.ldsp;
  const isDefault = ft.id === 'ldsp';
  const fdec = facadeDecor || decor;
  return {
    id: ft.id, name: ft.name, render: ft.render,
    frame: ft.frame || 0, insert: ft.insert || null,
    glassInside: !!ft.glassInside,
    // ЛДСП-фасад режется из декора проекта, остальные — из своего материала
    material: isDefault ? fdec.code : ft.material,
    // Толщина ЛДСП-фасада настраивается отдельно от корпуса (t — запасное
    // значение для старых сохранений без facadeThickness); у прочих типов
    // фасада толщина всегда своя, из каталога.
    thickness: isDefault ? (Number(facadeThickness) || t) : ft.thickness,
    edged: ft.render === 'panel',
  };
}

// ПРАВИЛО ВЫБОРА КРЕПЕЖА КОРПУСА.
// Крепёж не должен быть виден с лицевой стороны:
//   • боковина «до пола» или «сбоку дна» — дно вкладное, конфирмат пришлось бы
//     сверлить сквозь боковину и его шляпка смотрела бы наружу → МИНИФИКС;
//   • боковина «на дно» — дно накладное, конфирмат идёт снизу через дно,
//     шляпка оказывается на нижней плоскости и снаружи не видна → КОНФИРМАТ.
function jointForSide(sideMode) {
  return sideMode === 'onBottom' ? 'confirmat' : 'minifix';
}

// Присадка крепежа корпуса. Координаты — в системе каждой детали:
// x по длине, y по ширине (у панелей — по глубине от задней кромки).
//   Конфирмат: в пласти накладной детали Ø7 насквозь, в торце ответной Ø5×50.
//   Минификс:  в пласти боковины гнездо Ø15×12,5 на 34 мм от торца,
//              в торце ответной детали Ø8×25 под шток.
const JOINT_SETBACK = 50;     // отступ крайнего крепежа от кромки, мм
// ПРИСАДКА ПОД МИНИФИКС (Hettich Rastex 15) — по каталогу производителя
// «Connecting technology», раздел Rastex 15:
//   • гнездо эксцентрика Ø15 — в ПЛАСТИ присоединяемой детали (полка, дно,
//     заглушка), ось на 34 мм от торца при дюбеле 30 мм (24 мм при 20 мм);
//   • глубина гнезда зависит от толщины плиты: 15→12,2 · 16→12,7 ·
//     18→13,4 · 19→13,7 · 22→15,7;
//   • Ø8 в ТОРЕЦ той же детали, по центру толщины, до гнезда;
//   • в ответной детали (боковина) — Ø8 в пласти под дюбель Rapid S.
// Раньше гнездо Ø15 ставилось в боковину, а шток — в торец полки: это
// перевёрнутая схема, по ней узел не собирается.
const RASTEX = {
  camD: 15,
  camSetback: 34,          // ось гнезда от торца, дюбель 30 мм
  boltD: 8,
  boltDepth: 34,           // Ø8 в торец, до гнезда
  dowelD: 8,
  dowelDepth: 12,          // Ø8 в пласти ответной детали под Rapid S
  camDepthFor: (t) => (t >= 22 ? 15.7 : t >= 19 ? 13.7 : t >= 18 ? 13.4
    : t >= 16 ? 12.7 : 12.2),
};

function jointPoints(depth) {
  const a = JOINT_SETBACK, b = depth - JOINT_SETBACK;
  // Узкая деталь (например планка 100 мм) — один крепёж по центру: два
  // с отступом 50 мм от каждого края сошлись бы в одну точку.
  if (b - a < 32) return [round1(depth / 2)];
  const n = depth <= 400 ? 2 : (depth <= 700 ? 3 : 4);
  const out = [];
  for (let i = 0; i < n; i++) out.push(round1(a + ((b - a) * i) / (n - 1)));
  return out;
}

// Варианты боковины (крышка всегда вкладная между боковинами)

let _partSeq = 0;
function makePart(o) {
  _partSeq += 1;
  return {
    id: _partSeq,
    name: o.name,
    section: o.section,
    material: o.material,
    thickness: o.thickness,
    length: round1(o.length),
    width: round1(o.width),
    qty: o.qty,
    edging: o.edging || { long1: null, long2: null, short1: null, short2: null },
    grainDirection: !!o.grain,
    note: o.note || '',
    // Геометрия для 3D (мм): центр детали + габариты box
    box: {
      x: round1(o.x), y: round1(o.y), z: round1(o.z),
      w: round1(o.dims.w), h: round1(o.dims.h), d: round1(o.dims.d),
    },
    kind: o.kind, // side|top|bottom|divider|shelf|back|door|drawerFront|plinth|leg
    // true — это НЕ деталь из листа: не попадает в деталировку и в раскрой,
    // считается в спецификации как фурнитура (ножки).
    hardware: !!o.hardware,
    glass: !!o.glass,
    facadeType: o.facadeType || null,
    frameW: o.frameW || 0,
    insertMaterial: o.insertMaterial || null,
    // Форма для визуализации: 'box' (по умолчанию) или 'cylinder'.
    // На геометрию/пересечения не влияет — габарит остаётся описанным боксом.
    shape: o.shape || 'box',
    // Явное указание, с какой стороны у детали «лицо» (для присадки в 3D):
    // true/false — используется вместо эвристики по row.box.x в viewer.js.
    // Нужно смещённым деталям вне центра корпуса, где скрытая грань не
    // определяется положением относительно центра модуля (см. фальш-планку
    // углового узла — её скрытая грань всегда обращена к заглушке).
    // null/undefined — viewer.js использует свою эвристику как раньше.
    frontIsPlus: o.frontIsPlus === undefined ? null : !!o.frontIsPlus,
    plastic: !!o.plastic,
    legType: o.legType || null,   // 'metal' | 'kitchen' — какую опору рисовать в 3D
    hasClip: !!o.hasClip,         // кухонная опора у переднего ряда с цоколем — держит его клипсой
    cc: o.cc || 0,                 // межосевое ручки — по нему стоят её ножки
    // Присадка: отверстия в системе координат детали (левый нижний угол
    // лицевой стороны), готовые к выгрузке на станок.
    holes: o.holes || [],
    // ПАЗЫ: прямые канавки в системе координат детали. Нужны станку так же,
    // как отверстия: x0,y0 → x1,y1 — ось паза, w — ширина, depth — глубина.
    grooves: o.grooves || [],
    // Индекс секции/зоны фасада (у дверей — kind:'door', и у фасадов ящиков —
    // kind:'drawerFront'; zoneIndex осмыслен только у дверей) — числовые,
    // в отличие от текстового `section`, поэтому по ним безопасно искать
    // конкретную деталь программно (клик в 3D → контекстное меню/редактор
    // зоны, см. viewer.js/app.js). В mergeKey (mergeEqualParts ниже) не
    // участвуют — деталировка по-прежнему склеивает одинаковые двери из
    // разных зон в одну строку, эти поля только для 3D-клика по partsRaw.
    sectionIndex: Number.isFinite(o.sectionIndex) ? o.sectionIndex : null,
    zoneIndex: Number.isFinite(o.zoneIndex) ? o.zoneIndex : null,
    // Несъёмная полка-перегородка (на стыке зон фасада высокого пенала —
    // см. sec.shelfFixed[]) — во всю глубину корпуса, крепится минификсом
    // Rastex к боковинам, как дно/крыша, а не полкодержателями. Влияет на
    // то, попадёт ли деталь в контур присадки «ПРИСАДКА КРЕПЕЖА КОРПУСА»
    // ниже (см. фильтр horiz по kind==='shelf' && fixed).
    fixed: !!o.fixed,
  };
}

// ---------------------------------------------------------------------------
// РУЧНЫЕ ПРАВКИ ДЕТАЛИ (режим фокуса на модуле → «Редактировать», см. бриф
// «фикс панели Библиотека + режим фокуса»). Постобработка уже готового
// списка parts — НИЧЕГО не пересчитывает у соседних деталей: вырез/смена
// толщины одной боковины не должна требовать пересчёта дна/полок. Плата —
// при переопределении толщины несущей детали стык с соседями (посадочные
// места) может физически разойтись; пользователь предупреждается через
// warnings, но пересчёт не блокируется (решение пользователя — только
// предупреждение, не запрет).
//
// Идентификация детали — составной ключ kind|section|side|index, стабильный
// только для «одиночных» видов (боковина, дно, крыша, задняя стенка,
// цоколь): у них состав деталей группы не меняется при пересчёте параметров
// модуля. Полки/фасады/перегородки (их количество зависит от секций)
// намеренно НЕ поддержаны в этой итерации.
const OVERRIDABLE_KINDS = new Set(['side', 'bottom', 'top', 'back', 'plinth']);

// Сторона детали определяется так же, как в viewer.js (mesh.userData.side) —
// по имени: отдельного поля part.side в модели нет.
function partOverrideSide(part) {
  const nm = part.name || '';
  if (nm.indexOf('лев') >= 0) return 'left';
  if (nm.indexOf('прав') >= 0) return 'right';
  return null;
}

// Ось box (w|h|d), в которую у детали этого вида «упакована» толщина
// материала — нужна, чтобы override толщины двигал именно её, а не длину/
// ширину плиты (см. makePart: box.{w,h,d} и thickness — независимые поля,
// автоматической связи между ними нет). Для верхней планки «на ребро»
// (topType: 'railsEdge') толщина лежит в глубине (d), для остальных top —
// в высоте (h); различить варианты после сборки можно только по note
// (текст «НА РЕБРО» проставляется там же, где строится планка) — отдельного
// флага в part нет.
function thicknessBoxAxis(part) {
  switch (part.kind) {
    case 'side': return 'w';
    case 'bottom': return 'h';
    case 'back': return 'd';
    case 'plinth': return 'd';
    case 'top': return (part.note || '').indexOf('НА РЕБРО') >= 0 ? 'd' : 'h';
    default: return null;
  }
}

function applyPartOverrides(parts, partOverrides, warnings) {
  if (!partOverrides || !Object.keys(partOverrides).length) return;
  const counters = new Map();
  for (const part of parts) {
    if (!OVERRIDABLE_KINDS.has(part.kind)) continue;
    const side = partOverrideSide(part);
    const groupKey = [part.kind, part.section || '', side || ''].join('|');
    const index = counters.get(groupKey) || 0;
    counters.set(groupKey, index + 1);
    const key = [part.kind, part.section || '', side || '', index].join('|');
    const ov = partOverrides[key];
    if (!ov) continue;

    part.overridden = true;

    if (ov.thicknessOverride && ov.thicknessOverride > 0 && ov.thicknessOverride !== part.thickness) {
      const axis = thicknessBoxAxis(part);
      const isLoadBearing = part.kind === 'side' || part.kind === 'bottom' || part.kind === 'top';
      if (isLoadBearing) {
        warnings.push(`${part.name}: толщина переопределена вручную на ${ov.thicknessOverride} мм `
          + `(проектная — ${part.thickness} мм) — сопряжение с соседними деталями `
          + `(посадочные места дна/крышки/цоколя) не пересчитывается автоматически, проверьте стык.`);
      }
      part.thickness = ov.thicknessOverride;
      if (axis) part.box[axis] = round1(ov.thicknessOverride);
    }

    if (ov.materialOverride && ov.materialOverride !== part.material) {
      part.material = ov.materialOverride;
    }

    // kind всегда принудительно 'custom' — произвольное пользовательское
    // отверстие НЕ должно попадать под словарь kind'ов, которые
    // specification.js/cnc.js используют для подсчёта конкретной фурнитуры
    // (петли, нагели и т.п.), иначе смета «увидит» несуществующую позицию.
    if (Array.isArray(ov.extraHoles) && ov.extraHoles.length) {
      // Пользовательское отверстие всегда СКВОЗНОЕ — глухое на произвольной
      // глубине здесь не поддерживается (нет формулы, откуда брать глубину
      // осмысленно для любой детали и любого материала), и на тонкой ХДФ
      // задней стенке блайнд-отверстие всё равно визуально неотличимо от
      // отсутствия отверстия. through стоит ПОСЛЕ h нарочно (как и kind) —
      // если в сохранённом проекте ещё лежит старое h.through из прежней
      // версии панели (был чекбокс, его убрали), оно не должно перебить
      // текущее правило «всегда насквозь». depth не используется при
      // through:true (см. panelSlabs в viewer.js), оставлен для
      // единообразия с остальными holes-записями (фурнитура).
      const custom = ov.extraHoles.map((h) => Object.assign(
        { side: 'front', depth: part.thickness },
        h, { kind: 'custom', through: true },
      ));
      part.holes = (part.holes || []).concat(custom);
    }
  }
}

/**
 * @param {object} p
 * p.width, p.height, p.depth       — габариты ИЗДЕЛИЯ, мм (глубина — по корпусу)
 * p.bodyThickness                  — толщина ЛДСП корпуса, мм
 * p.backThickness                  — толщина ХДФ задней стенки, мм
 * p.facadeThickness                — толщина ЛДСП-фасада, мм (независима от корпуса;
 *                                     не влияет на фасады из МДФ/стекла/дерева — у них
 *                                     своя фиксированная толщина в FACADE_TYPES)
 * p.scheme                         — 'sidesFull' | 'overlayTopBottom'
 * p.decor / p.backMaterial         — {code, name, sheetPrice, sheetW, sheetH}
 * p.base                           — {type:'plinth'|'legs', plinthHeight, legHeight}
 * p.sections                       — [{shelves, drawers, facade}]
 * p.drawerUnitHeight               — высота фасада одного ящика, мм (по умолч. 300)
 * p.gap                            — зазор между фасадами, мм (по умолч. 3)
 * p.jointType                      — 'confirmat'|'minifix'|'dowel'
 * p.partOverrides                  — {[kind|section|side|index]: {thicknessOverride,
 *                                     materialOverride, extraHoles:[...]}} — см. applyPartOverrides выше
 *
 * Строит ОДИН модуль в собственных координатах (центр по X в нуле, низ в нуле).
 * Расстановкой модулей в ряд занимается buildModel ниже.
 */
function buildModuleParts(p) {
  _partSeq = 0;
  const parts = [];
  const warnings = [];

  const W = p.width, H = p.height, D = p.depth;
  const t = p.bodyThickness, tb = p.backThickness;
  const decor = p.decor, back = p.backMaterial;
  // Материал ящиков задаётся отдельно от корпуса: корпус обычно 18 мм,
  // ящики режут из 16 мм и часто другим декором (внутренний).
  const drawerDecor = p.drawerDecor || decor;
  const drawerT = Number(p.drawerThickness) || Number(p.bodyThickness) || 16;
  // gap — видимый просвет фасада НА СТОРОНУ. Фасад вписывается в свой «слот»
  // с отступом gap со всех четырёх сторон: от боковины, от крышки, от дна.
  // Между двумя соседними фасадами просвет получается 2*gap.
  const gap = p.gap ?? 1.5;
  const drawerUnitH = p.drawerUnitHeight ?? 200;   // типовая высота фасада ящика
  // Каждая боковина задаётся отдельно: идёт ДО ПОЛА или стоит НА ДНЕ.
  // Это нужно для ряда корпусов с общим сквозным цоколем: у крайнего левого
  // корпуса левая боковина до пола, а правая уже стоит на дне; у среднего обе
  // на дне; у крайнего правого — правая до пола, левая на дне.
  const sides = normalizeSides(p);
  // Дно ВКЛАДНОЕ с той стороны, где боковина не стоит на нём:
  // и «до пола», и «сбоку дна» упираются торцом дна в свою внутреннюю грань.
  const leftInset = sides.left !== 'onBottom';
  const rightInset = sides.right !== 'onBottom';
  const sections = p.sections;
  const n = sections.length;
  const dividers = n - 1;

  // Высота основания: у цоколя своя, у опор своя. У варианта «опоры с цоколем»
  // это одно и то же число — планка ровно закрывает опоры.
  const baseH = p.base.type === 'plinth'
    ? Number(p.base.plinthHeight || 0)
    : Number(p.base.legHeight || 0);

  // Внутренняя высота — от верхней плоскости дна до нижней плоскости крыши.
  // Одинакова в обеих схемах: дно лежит на высоте цоколя, крыша — под верхом.
  const innerH = H - baseH - 2 * t;
  const innerBottomY = baseH + t;   // верхняя плоскость дна
  const Wi = W - 2 * t;             // чистая ширина между боковинами

  // Верхняя планка/царга (topType 'rails'/'railsEdge') занимает по высоте
  // RAIL_W мм «на ребро» или t мм «плашмя», от самого верха корпуса вниз.
  // Дверь тоже доходит до самого верха, поэтому верхняя петля (её штатное
  // место — 100 мм от торца двери, см. HINGE_END) может провалиться прямо
  // в планку: ответная планка петли крепится к боковине НА ЭТОЙ высоте,
  // а планка идёт поперёк корпуса ровно там же — они физически сталкиваются.
  // railTopH — высота этой зоны (0, если верхней планки нет вовсе), нужна
  // при сверловке петель, чтобы отжать верхнюю чашку ниже планки.
  const railTopH = (p.topType === 'rails' || p.topType === 'railsEdge')
    ? (p.topType === 'railsEdge'
        ? Math.max(60, Math.min(Number(p.railWidth) || 100, D / 2 - 10))
        : t)
    : 0;

  if (innerH <= 50) warnings.push('Слишком малая высота корпуса для выбранной толщины материала.');
  if (Wi <= 100) warnings.push('Слишком малая ширина корпуса для выбранной толщины материала.');

  // Ширины секций. У секции ширина может быть ЗАДАНА (widthMode:'fixed',
  // width в мм — чистый проём) либо АВТО: такие секции делят между собой
  // остаток поровну. Так стойка между секциями встаёт в нужном месте, а не
  // обязательно по центру.
  const layout = layoutSections(sections, Wi, t);
  const sectionOpening = layout.widths[0];   // для совместимости
  for (const w of layout.widths) {
    if (w <= 100) {
      warnings.push('Секция уже 100 мм — проверьте заданные ширины секций.');
      break;
    }
  }
  if (layout.overflow > 0.5) {
    warnings.push(`Заданные ширины секций не помещаются: не хватает ${Math.round(layout.overflow)} мм.`);
  }

  // ---------- Боковины ----------
  // Боковина стоит по внешнему краю: её внешняя грань = габарит W.
  // Границы боковины по высоте зависят от того, накладные ли дно и крыша:
  // накладная деталь «съедает» торец боковины, вкладная — нет.
  // Низ боковины: до пола — 0 (при ножках отсчёт от верха ножки);
  // на дно — верхняя плоскость дна (baseH + t). Верх всегда H, так как
  // крышка вкладная между боковинами.
  const sideX = W / 2 - t / 2;
  // «До пола» означает ровно это при любом основании: боковина идёт до пола
  // и сама несёт корпус. Опоры при этом встают под дном между боковинами,
  // цоколь входит между ними. Если боковина не должна опускаться — есть
  // варианты «сбоку дна» и «на дно».
  const floorY = 0;
  const sideTop = H;

  // Низ боковины по вариантам:
  //   'floor'        — до пола (на ножках — до верха ножки);
  //   'besideBottom' — вровень с низом дна: боковина стоит на цоколе/ножках;
  //   'onBottom'     — на верхней плоскости дна.
  const sideBottomY = (v) => (v === 'floor' ? floorY : (v === 'besideBottom' ? baseH : baseH + t));
  const sideNote = (v) => (v === 'floor'
    ? (p.base.type === 'plinth' ? 'Несущая, до пола' : 'Несущая, на ножках')
    : (v === 'besideBottom' ? 'Сбоку дна, опирается на основание' : 'Стоит на дне'));

  // ВИДИМАЯ БОКОВИНА. Корпус кухни делают белым, а боковину, которую видно
  // в интерьере, — в материале фасада. Видимой считается та, что доходит
  // ДО ПОЛА или стоит СБОКУ ДНА (дно вкладное): её пласть открыта целиком.
  // Под деревянный фасад массив на боковину не ставят — берут МДФ в шпоне.
  const visibleSideMat = () => {
    const sec0 = (p.sections && p.sections[0]) || {};
    const ftv = facadeTypeOf(sec0, decor, t, p.facadeDecor, p.facadeThickness);
    if (ftv.id === 'wood' || ftv.id === 'woodGlass') {
      return { code: 'FAC-VENEER', name: 'МДФ шпон' };
    }
    // Стекло и алюминиевый профиль на боковину не годятся — ЛДСП фасадный
    if (ftv.id === 'glass4' || ftv.id === 'alu') return { code: 'FAC-LDSP', name: 'ЛДСП фасадный' };
    return { code: ftv.material, name: ftv.name.replace('Фасад ', '') };
  };

  // КРАЙНИЙ МОДУЛЬ. Видимая боковина стоит с торца ряда, и между корпусом и
  // стеной остаётся щель (корпус 510 при столешнице 600) — её видно. Поэтому
  // видимую боковину делают ГЛУБЖЕ: она доходит до стены и закрывает зазор.
  // Считаем от плоскости стены: столешница минус её свес над фасадом.
  const WORKTOP_OVERHANG = 20;
  const worktop = Number(p.worktopDepth || 0);
  const wallZ = worktop > 0
    ? (D / 2 + (p.facadeThicknessHint || p.facadeThickness || t) + WORKTOP_OVERHANG) - worktop
    : -D / 2;
  const sideDepth = Math.max(D, round1(D / 2 - Math.min(wallZ, -D / 2)));
  const sideZ = round1(D / 2 - sideDepth / 2);   // растёт назад, к стене

  for (const s of [
    { nm: 'Боковина левая', x: -sideX, v: sides.left },
    { nm: 'Боковина правая', x: sideX, v: sides.right },
  ]) {
    const bottomY = sideBottomY(s.v);
    const h = sideTop - bottomY;
    const visible = p.visibleSides !== false
      && (s.v === 'floor' || s.v === 'besideBottom');
    const vm = visible ? visibleSideMat() : null;
    parts.push(makePart({
      name: s.nm + (visible ? ' (видимая)' : ''), section: 'Корпус',
      material: vm ? vm.code : decor.code, thickness: t,
      length: h, width: visible ? sideDepth : D, qty: 1, grain: true, kind: 'side',
      facadeType: vm ? 'sidePanel' : null,
      note: sideNote(s.v) + (vm ? `; видимая — в материале фасада (${vm.name})` : ''),
      // Кромкуется передний торец (лицевой). Задний — технической кромкой.
      edging: { long1: EDGE_FRONT, long2: EDGE_BACK, short1: null, short2: null },
      x: s.x, y: (sideTop + bottomY) / 2, z: visible ? sideZ : 0,
      dims: { w: t, h, d: visible ? sideDepth : D },
    }));
  }
  const hasVisibleSide = p.visibleSides !== false
    && (sides.left === 'floor' || sides.left === 'besideBottom'
      || sides.right === 'floor' || sides.right === 'besideBottom');

  // ---------- Дно и крыша ----------
  // Накладная — во всю ширину W (перекрывает торцы боковин).
  // Вкладная — между боковинами, длина W - 2t.
  // Дно доходит до внутренней грани боковины, идущей до пола, и до наружной
  // грани боковины, стоящей на нём (та ложится сверху).
  const bottomLeft  = leftInset  ? (-W / 2 + t) : (-W / 2);
  const bottomRight = rightInset ? ( W / 2 - t) : ( W / 2);
  const bottomLen = bottomRight - bottomLeft;
  const bottomNote = (leftInset && rightInset) ? 'Вкладное между боковинами'
    : (!leftInset && !rightInset) ? 'Накладное, боковины стоят на нём'
    : 'Одна боковина на нём, вторая рядом с ним';

  parts.push(makePart({
    name: 'Дно', section: 'Корпус', material: decor.code, thickness: t,
    length: bottomLen, width: D, qty: 1, kind: 'bottom', note: bottomNote,
    edging: { long1: EDGE_FRONT, long2: null, short1: null, short2: null },
    x: (bottomLeft + bottomRight) / 2, y: baseH + t / 2, z: 0,
    dims: { w: bottomLen, h: t, d: D },
  }));
  // Верх модуля: либо цельная крышка, либо две планки (царги).
  // У кухонных нижних тумб цельной крышки не делают: ставят переднюю и заднюю
  // планки шириной 80–100 мм плашмя — они держат геометрию корпуса, а через
  // них шурупами крепится столешница. Экономит материал и открывает доступ
  // сверху (мойка, варочная панель, ящики).
  if (p.topType === 'rails' || p.topType === 'railsEdge') {
    // ПЛАНКИ НА РЕБРО — вариант под мойку. Плашмя планка съедает 100 мм
    // проёма сверху, и чаша мойки в корпус не заходит. Поставленная на ребро,
    // она занимает только свою толщину, а жёсткость даже выше.
    const onEdge = p.topType === 'railsEdge';
    const RAIL_W = onEdge ? railTopH : Math.max(60, Math.min(Number(p.railWidth) || 100, D / 2 - 10));
    // Передняя планка НА РЕБРО утоплена вглубь корпуса от переднего края —
    // иначе винты крепления ручки фасада (идут сзади фасада вперёд) упираются
    // в планку. Задняя планка на ребро (ниже) не трогаем — ей ручка не мешает.
    const FRONT_RAIL_EDGE_SETBACK = 4; // мм, фиксировано
    for (const r of [
      { nm: 'Планка верхняя передняя',
        z: onEdge ? D / 2 - t / 2 - FRONT_RAIL_EDGE_SETBACK : D / 2 - RAIL_W / 2, edge: EDGE_FRONT },
      { nm: 'Планка верхняя задняя',
        z: onEdge ? -D / 2 + t / 2 : -D / 2 + RAIL_W / 2, edge: null },
    ]) {
      parts.push(makePart({
        name: r.nm, section: 'Корпус', material: decor.code, thickness: t,
        length: Wi, width: RAIL_W, qty: 1, kind: 'top',
        note: onEdge
          ? 'Вкладная между боковинами, НА РЕБРО — проём сверху свободен под мойку'
          : 'Вкладная между боковинами, плашмя; через неё крепится столешница',
        edging: onEdge
          ? { long1: EDGE_FRONT, long2: null, short1: null, short2: null }
          : { long1: r.edge, long2: null, short1: null, short2: null },
        x: 0, y: onEdge ? H - RAIL_W / 2 : H - t / 2, z: r.z,
        dims: onEdge ? { w: Wi, h: RAIL_W, d: t } : { w: Wi, h: t, d: RAIL_W },
      }));
    }
  } else {
    // Крышка всегда вкладная между боковинами
    parts.push(makePart({
      name: 'Крыша (топ)', section: 'Корпус', material: decor.code, thickness: t,
      length: Wi, width: D, qty: 1, kind: 'top',
      note: 'Вкладная между боковинами',
      edging: { long1: EDGE_FRONT, long2: null, short1: null, short2: null },
      x: 0, y: H - t / 2, z: 0,
      dims: { w: Wi, h: t, d: D },
    }));
  }

  // ---------- Цоколь ----------
  // Планка спереди, утоплена вглубь на PLINTH_SETBACK (норма — под носок обуви).
  // Цоколь бывает несущий (боковины до пола) и навесной — на клипсах к
  // регулируемым опорам. Второй вариант — стандарт для кухонь и тумб.
  const hasPlinth = (p.base.type === 'plinth' || p.base.type === 'legsPlinth') && baseH > 0;
  const onLegs = p.base.type === 'legs' || p.base.type === 'legsPlinth';
  if (hasPlinth) {
    // В зону цоколя спускается только боковина «до пола» — она и ограничивает
    // планку. При «на дно» и «сбоку дна» низ свободен, планка идёт до габарита,
    // поэтому в ряду корпусов цоколь получается сквозным.
    // Планку ограничивает только та боковина, которая реально спускается в
    // зону цоколя, то есть «до пола». При «на дно» и «сбоку дна» низ свободен,
    // планка идёт до габарита и в ряду сливается в сквозную.
    const pLeft  = (sides.left === 'floor')  ? (-W / 2 + t) : (-W / 2);
    const pRight = (sides.right === 'floor') ? ( W / 2 - t) : ( W / 2);
    const plinthLen = pRight - pLeft;
    const plinthX = (pLeft + pRight) / 2;
    // ЦОКОЛЬ — ВИДИМАЯ ДЕТАЛЬ. Он идёт по всему фронту на уровне пола, его
    // видно всегда, поэтому режется он в материале и декоре ФАСАДА, а под
    // деревянный фасад — из МДФ в шпоне (как и видимая боковина).
    const plinthMat = visibleSideMat();
    parts.push(makePart({
      name: 'Цоколь (планка передняя)', section: 'Корпус',
      material: plinthMat.code, thickness: t, facadeType: 'plinthFace',
      length: plinthLen, width: baseH, qty: 1, kind: 'plinth',
      note: (onLegs
        ? `Навесной, на клипсах к опорам, утоплен от фасада на ${PLINTH_SETBACK} мм`
        : `Утоплен от фасада на ${PLINTH_SETBACK} мм`)
        + `; видимая деталь — в материале фасада (${plinthMat.name})`,
      edging: { long1: EDGE_FRONT, long2: null, short1: null, short2: null },
      x: plinthX, y: baseH / 2, z: D / 2 - t / 2 - PLINTH_SETBACK,
      dims: { w: plinthLen, h: baseH, d: t },
    }));
  }

  // ---------- Ножки ----------
  // Если модуль стоит НА НОЖКАХ, цокольной планки нет вовсе: её роль
  // выполняют регулируемые опоры. Ножки ставятся под дно, с отступом
  // LEG_INSET от краёв корпуса; при ширине больше LEG_SPAN добавляется
  // промежуточный ряд, чтобы дно не прогибалось.
  if (onLegs && baseH > 0) {
    const LEG_INSET = 50;    // отступ оси опоры от края корпуса, мм
    const LEG_SPAN  = 900;   // максимальный пролёт между опорами, мм
    const LEG_D     = 50;    // диаметр опоры, мм
    const LEG_PLATE = 65;    // монтажная площадка под дно металлической опоры, мм (АМЕТИСТ: 65×65, отв. 52×52)
    // Кухонная опора — по каталожному чертежу поставщика: Ø29 ствол,
    // регулировка 98–130 мм, площадка круглая Ø58, крепёж по кругу Ø47
    // (4 отв. Ø4), пятка Ø47. Центральное отверстие Ø10 в площадке —
    // сквозное под резьбовой шток самой опоры, к дну не крепится и не
    // сверлится в панели.
    const KITCHEN_BOLT_CIRCLE_D = 47;  // мм, диаметр окружности крепежа площадки
    const KITCHEN_HOLE_D = 2;          // мм, диаметр присадки под шуруп площадки (пилотное)
    // Клипса выступает от оси опоры заметно дальше, чем сам ствол: по
    // чертежу поставщика — реальный радиус ствола 14,5 мм (Ø29) + толщина
    // площадки клипсы 10 мм (площадка 38×30×10) = 24,5 мм от оси в нативных
    // (немасштабированных) единицах той же системы отсчёта, что и
    // LM.NATIVE_DIAMETER (см. viewer.js: legR и depth площадки клипсы там
    // считаются от тех же 14,5 и 10 мм, домноженных на тот же scale — числа
    // подобраны так, чтобы вылет здесь и в 3D-сцене совпадали). Раньше тут
    // стояло приблизительное значение 33,5 мм, снятое измерением по
    // координатам вершин старого baked-меша «опора с клипсой.obj» — чертёж
    // поставщика точнее, используем его. Если позиционировать клипсу так,
    // будто выступает только тело опоры (LEG_D/2), пластина «утапливается»
    // в цоколь — регрессия, пойманная ещё по старому 3D-меша.
    const CLIP_NATIVE_REACH = 24.5;    // мм, вылет пластины клипсы от оси (ствол 14,5 + площадка 10)
    const CLIP_NATIVE_D = 54;          // мм, видимый диаметр опоры по фланцу/флейтам (масштабный якорь baked-меша)
    // Верхняя монтажная площадка опоры (highGeo в viewer.js — квадрат со
    // скруглёнными углами в самом baked-меше, НЕ вырезается по радиусу)
    // выступает от оси опоры дальше, чем пластина клипсы: прямым замером
    // вершин меша (не по описательному «Ø58» в note ниже — сам меш хранит
    // площадку как квадрат 52×52, а не круг) прямой (не диагональный, у
    // квадрата угол выступает дальше по диагонали, но клипса развёрнута
    // кратно 90° — см. g.rotation.y в viewer.js makeKitchenLeg — и диагональ
    // площадки в сторону цоколя не смотрит) вылет площадки — 26 мм от оси в
    // тех же нативных единицах, что и CLIP_NATIVE_REACH. Раз площадка шире
    // клипсы (26 > 24,5), именно ОНА, а не пластина клипсы, первой
    // упирается в цоколь — позиционировать опору по одной лишь клипсе
    // (как раньше) значит утапливать площадку в цоколь на разницу (в 3D
    // это и давало видимое пересечение материалов у верхнего края опоры).
    const FLANGE_NATIVE_REACH = 26;    // мм, вылет верхней площадки опоры от оси (прямая грань, замер по мешу)
    const LEG_NATIVE_REACH = Math.max(CLIP_NATIVE_REACH, FLANGE_NATIVE_REACH); // мм, к цоколю встаёт более выступающая деталь
    const CLIP_REACH = LEG_NATIVE_REACH * LEG_D / CLIP_NATIVE_D; // мм, вылет при текущем LEG_D
    // Тип опоры выбирается отдельно от основания (см. UI «Тип опоры»):
    // «металлическая» — открытая никелированная, «кухонная» — пластиковая,
    // матовая, снизу клипса — ею опора держит цокольную планку.
    // «Опоры с цоколем» держит цоколь клипсой только кухонная опора — у
    // металлической клипсы нет и цоколь ей не удержать, поэтому это
    // сочетание принудительно кухонное независимо от p.legType (UI это же
    // правило соблюдает — «металлическая» там недоступна при цоколе).
    // Старые проекты и пресеты без явного legType (сохранены до появления
    // этого выбора) — «опоры с цоколем» по умолчанию были пластиковыми
    // кухонными, это тем же правилом и сохраняется.
    const kitchen = p.base.type === 'legsPlinth' || p.legType === 'kitchen';

    // Если боковина идёт до пола, опора не может стоять под ней — сдвигаем
    // крайние опоры внутрь на толщину такой боковины.
    const padL = LEG_INSET + (sides.left === 'floor' ? t : 0);
    const padR = LEG_INSET + (sides.right === 'floor' ? t : 0);
    const xFrom = -W / 2 + padL, xTo = W / 2 - padR;
    const cols = Math.max(2, Math.ceil((xTo - xFrom) / LEG_SPAN) + 1);
    // Передний ряд опор: стандартный отступ от края — как у обычных опор
    // без цоколя. Только кухонная опора умеет держать цоколь клипсой и
    // поэтому подтягивается вплотную за планку; у металлической опоры
    // такого крепления нет, монтаж у неё всегда «без цоколя», даже если
    // у модуля выбран цоколь как основание.
    // У кухонной опоры с цоколем позицию опоры относительно планки задаёт
    // САМАЯ ВЫСТУПАЮЩАЯ к цоколю деталь опоры — это не всегда пластина
    // клипсы: верхняя монтажная площадка опоры (см. FLANGE_NATIVE_REACH
    // выше) физически шире (26 мм от оси), чем вылет пластины клипсы
    // (24,5 мм) — LEG_NATIVE_REACH берёт большее из двух. Если считать
    // только по клипсе (как было раньше), площадка утапливается в цоколь на
    // разницу — видимое пересечение материалов у верхнего края опоры,
    // а не у клипсы. Сейчас площадка чуть шире клипсы, поэтому именно она
    // встаёт впритык к цоколю, а у пластины клипсы остаётся небольшой
    // (не «конструкторский», просто разница вылетов ≈1,4 мм при LEG_D=50)
    // зазор — это реальное следствие формы опоры, а не недоработка
    // позиционирования. Отдельно GAP_EPS — технический зазор против
    // z-fighting (грань детали и грань цоколя иначе оказываются в одной
    // плоскости, что в Three.js даёт мерцающие «просвечивающие» текстуры на
    // стыке) — тот же приём, что и hoopGap в viewer.js (там 0,4 мм между
    // хомутом клипсы и стволом опоры — по той же причине).
    const GAP_EPS = 0.5; // мм, технический зазор против z-fighting, не «конструкторский»
    const zFront = (kitchen && hasPlinth)
      ? (D / 2 - PLINTH_SETBACK - t) - CLIP_REACH - GAP_EPS
      : D / 2 - LEG_INSET;
    const zBack = -D / 2 + LEG_INSET;

    const LEG_HOLE_SPACING = 52;   // шаг крепёжных отверстий площадки, мм
    const bottomPart = parts.find((pt) => pt.kind === 'bottom');
    const plinthPart = parts.find((pt) => pt.kind === 'plinth');
    // Высота, на которой клипса держит цоколь (по образцу опора с клипсой):
    // примерно на середине высоты опоры, чуть ниже монтажной площадки.
    // По 3D-модели (опора с клипсой.obj) отверстия клипсы — РОВНО на
    // середине высоты опоры (0,05 м из 0,1 м высоты исходника) — это и
    // используем, без произвольного коэффициента.
    const CLIP_Y = baseH * 0.5;

    for (let c = 0; c < cols; c++) {
      const x = cols === 1 ? 0 : xFrom + ((xTo - xFrom) * c) / (cols - 1);
      for (const z of [zFront, zBack]) {
        const hasClip = kitchen && hasPlinth && z === zFront;
        parts.push(makePart({
          name: 'Опора регулируемая', section: 'Основание',
          material: kitchen ? 'LEG-PL' : 'LEG-100',
          thickness: 0, length: baseH, width: LEG_D, qty: 1, kind: 'leg',
          note: kitchen
            ? `Пластиковая кухонная Ø29 мм, регулируемая 98–130 мм (тек. высота ${Math.round(baseH)} мм), `
              + `площадка круглая Ø58, крепёж 4×Ø${KITCHEN_HOLE_D} по кругу Ø${KITCHEN_BOLT_CIRCLE_D}, пятка Ø47`
              + (hasClip ? ', с клипсой для цоколя (площадка клипсы 38×30, присадка 2×Ø2 с шагом 25)' : '')
            : `Никелированная (зеркальная) Ø${LEG_D} мм, регулируемая, высота ${Math.round(baseH)} мм, `
              + `площадка ${LEG_PLATE}×${LEG_PLATE} мм, пятка резиновая чёрная`,
          edging: { long1: null, long2: null, short1: null, short2: null },
          x, y: baseH / 2, z,
          dims: { w: LEG_D, h: baseH, d: LEG_D },
          shape: 'cylinder', legType: kitchen ? 'kitchen' : 'metal', hasClip, plastic: kitchen,
          hardware: true,
        }));

        // Присадка под опору в дне — пилотные отверстия под шурупы
        // площадки, сверлятся снизу (side 'back' — нижняя пласть дна),
        // насквозь не идут. Металлическая опора — по чертежу АМЕТИСТ:
        // квадрат 52×52, Ø2,5 (шуруп 3,5×16). Кухонная опора — по
        // каталожному чертежу поставщика: 4 отв. Ø4 по кругу Ø47.
        if (bottomPart) {
          if (kitchen) {
            // По 3D-модели (опора с клипсой.obj) отверстия площадки — не
            // по сторонам света, а по УГЛАМ квадрата, вписанного в круг Ø47
            // (±16,6 мм по X и Z от оси) — 45°/135°/225°/315°, не 0/90/180/270.
            const r = KITCHEN_BOLT_CIRCLE_D / 2;
            for (const ang of [45, 135, 225, 315]) {
              const rad = ang * Math.PI / 180;
              bottomPart.holes.push({
                x: round1((x + r * Math.cos(rad)) - bottomLeft),
                y: round1((z + r * Math.sin(rad)) + D / 2),
                d: KITCHEN_HOLE_D, depth: 12, through: false, side: 'back', kind: 'legFix',
              });
            }
          } else {
            for (const sx of [-1, 1]) {
              for (const sz of [-1, 1]) {
                bottomPart.holes.push({
                  x: round1((x + sx * LEG_HOLE_SPACING / 2) - bottomLeft),
                  y: round1((z + sz * LEG_HOLE_SPACING / 2) + D / 2),
                  d: 2, depth: 12, through: false, side: 'back', kind: 'legFix',
                });
              }
            }
          }
        }

        // Клипса кухонной опоры держит цоколь — крепится к нему двумя
        // шурупами через площадку клипсы (по каталожному чертежу: 38×30 мм,
        // присадка 2×Ø2 с шагом 25 мм, пилотное) в цоколь, с внутренней (задней) стороны,
        // напротив клипсы.
        if (hasClip && plinthPart) {
          const px = x - plinthPart.box.x + plinthPart.length / 2;
          for (const dx of [-12.5, 12.5]) {
            plinthPart.holes.push({
              x: round1(px + dx),
              y: round1(CLIP_Y),
              d: 2, depth: 12, through: false, side: 'back', kind: 'legFix',
            });
          }
        }
      }
    }
  }

  // ---------- Задняя стенка ----------
  // Одна цельная накладная панель ХДФ на весь корпус сзади (набивается на
  // задние торцы боковин, дна и крыши). Это стандарт для эконом-сборки.
  // Модуль под мойку идёт БЕЗ задней стенки: сзади проходят коммуникации —
  // сифон, гибкая подводка, а часто и розетки.
  // У КРАЙНЕГО МОДУЛЯ задняя стенка идёт В ПАЗ, а не набивается на торцы:
  // видимая боковина глубже корпуса и накладную стенку было бы видно с торца,
  // да и паз жёстче держит геометрию.
  // Глубина паза под заднюю стенку. 8 мм — производственный стандарт:
  // жёстче держит стенку и прощает погрешность раскроя (4 мм — минимум).
  const PAZ_D = Number(p.backGrooveDepth) || 8;
  const leftVisible = p.visibleSides !== false
    && (sides.left === 'floor' || sides.left === 'besideBottom');
  const rightVisible = p.visibleSides !== false
    && (sides.right === 'floor' || sides.right === 'besideBottom');
  // Стенка остаётся НАКЛАДНОЙ на задней плоскости корпуса. Разница лишь в
  // краях: обычную боковину она перекрывает по торцу, а видимую (она глубже
  // корпуса и идёт до стены) перекрыть нельзя — там стенка заходит В ПАЗ.
  // ДОПУСК В ПАЗУ. Стенка режется на 2 мм короче полного захода: иначе она
  // упирается в дно паза и корпус не стягивается по диагонали. Допуск даётся
  // только с той стороны, где стенка ВХОДИТ В ПАЗ.
  const PAZ_PLAY = 2;
  // Накладная стенка тоже режется с запасом: по 1 мм с каждой стороны, то
  // есть на 2 мм меньше по ширине и на 2 мм по высоте. Строго «в размер»
  // она цепляется за кромку и мешает выставить корпус по диагонали.
  const BACK_PLAY = 1;
  const leftEdge = leftVisible ? -(W / 2 - t + PAZ_D - PAZ_PLAY) : -(W / 2 - BACK_PLAY);
  const rightEdge = rightVisible ? (W / 2 - t + PAZ_D - PAZ_PLAY) : (W / 2 - BACK_PLAY);
  const backW = round1(rightEdge - leftEdge);
  const backHgt = round1(H - baseH - 2 * BACK_PLAY);
  const grooved = leftVisible || rightVisible;
  // Паз под заднюю стенку режется в ВИДИМОЙ боковине: стенка не может
  // перекрыть её торец, потому что боковина глубже корпуса.
  if (!p.noBack && grooved) {
    const backZ = -D / 2 - tb / 2;
    for (const sp of parts.filter((q) => q.kind === 'side')) {
      const vis = (sp.box.x < 0 ? leftVisible : rightVisible);
      if (!vis) continue;
      const yPaz = round1(backZ - (sp.box.z - sp.box.d / 2));   // от задней кромки панели
      sp.grooves.push({
        kind: 'backGroove', x0: 0, y0: yPaz, x1: round1(sp.length), y1: yPaz,
        w: round1(tb + 0.5), depth: PAZ_D, side: 'inner',
        note: 'Паз под заднюю стенку',
      });
    }
  }
  if (!p.noBack) parts.push(makePart({
    name: 'Задняя стенка', section: 'Корпус', material: back.code, thickness: tb,
    length: backW, width: backHgt, qty: 1, kind: 'back',
    note: grooved
      ? `Накладная; в видимую боковину входит В ПАЗ ${tb + 0.5}×${PAZ_D} мм, `
        + `допуск ${PAZ_PLAY} мм на сторону`
      : 'Накладная, крепится на задние торцы корпуса',
    edging: { long1: null, long2: null, short1: null, short2: null },
    x: round1((leftEdge + rightEdge) / 2), y: baseH + backHgt / 2, z: -D / 2 - tb / 2,
    dims: { w: backW, h: backHgt, d: tb },
  }));

  // ---------- Секции: стойки, полки ----------
  const drawerHardware = [];
  const doorHardware = [];
  const handleHardware = [];      // ручки: id + количество
  const liftHardware = [];        // подъёмные механизмы
  // Сведения о секциях для интерфейса: фактически посчитанные высоты фасадов
  // ящиков и доступный фронт. Панель берёт их как стартовые значения при
  // переходе в ручной режим и держит сумму равной доступной высоте.
  const secInfo = [];
  const rodFlanges = [];      // куда встали фланцы штанги — для присадки панелей
  const shelfPanelX = {};     // секция -> x панелей, к которым крепятся полки
  const drawerMounts = [];    // высоты направляющих и панели под них
  for (let i = 0; i < n; i++) {
    const sec = sections[i];
    const secName = `Секция ${i + 1}`;
    const secW = layout.widths[i];
    const secX0 = layout.x0[i];                 // левая граница проёма
    const secCenterX = secX0 + secW / 2;

    // Вертикальная стойка справа от секции (кроме последней).
    // Её положение задаётся ширинами секций — можно поставить не по центру.
    if (i < n - 1) {
      parts.push(makePart({
        name: 'Стойка вертикальная', section: 'Корпус', material: decor.code, thickness: t,
        length: innerH, width: D - tb, qty: 1, kind: 'divider',
        note: `Вкладная между дном и крышей, отступ слева ${Math.round(secX0 + secW + Wi / 2)} мм`,
        edging: { long1: EDGE_FRONT, long2: null, short1: null, short2: null },
        x: secX0 + secW + t / 2, y: innerBottomY + innerH / 2, z: tb / 2,
        dims: { w: t, h: innerH, d: D - tb },
      }));
    }

    // ----- Зона ящиков (снизу секции) -----
    // Доступная под ящики высота фронта: весь фронт, если двери нет,
    // иначе фронт минус зона двери (по умолчанию половина).
    const frontAvail = (H - baseH);
    const drawerHeights = getDrawerHeights(
      sec, drawerUnitH, frontAvail, (w) => warnings.push(w), secName);
    secInfo.push({ index: i, drawerAvail: frontAvail, drawerHeights: drawerHeights.slice(), shelfYs: [], boxes: [] });
    const infoRowBox = secInfo[secInfo.length - 1];
    // Фасады стоят СНАРУЖИ и занимают фронт, а не внутреннюю высоту —
    // сравнивать их с innerH нельзя. Помещаемость проверяется по фактическим
    // коробам внутри buildDrawerBoxes.
    const drawerZoneH = drawerHeights.reduce((s, v) => s + v, 0);
    const shelfZoneH = Math.max(0, innerBottomY + innerH - Math.max(innerBottomY, baseH + drawerZoneH));

    // Короб поднят на технологический зазор, фасад остаётся у низа секции
    const lift = drawerLift(sec);
    const drawerBaseY = innerBottomY + lift;

    // Детали самих ящиков по формулам выбранной системы
    const runnerYs = [];
    const boxInfo = [];
    if (drawerHeights.length) {
      buildDrawerBoxes({
        parts, warnings, sec, secName, secCenterX, drawerHeights,
        sectionOpening: secW, innerDepth: D - tb, t, decor, back, backT: tb,
        frontZ: D / 2, boxInfo,
        facadeBaseY: baseH, gap,
        drawerDecor, drawerT,
        baseY: drawerBaseY, innerTopY: innerBottomY + innerH,
        runnerYs,
      });
      // Направляющие крепятся по фактическим отметкам построенных коробов:
      // если короб не построен (не влез), то и присадки под него быть не должно.
      const drawSys = window.Modul3D.catalog.DRAWER_SYSTEMS[sec.drawerSystem || 'ballBearing'];
      for (const ry of runnerYs) {
        drawerMounts.push({ y: ry, panels: [secX0 - t / 2, secX0 + secW + t / 2],
          cabinetPin: drawSys && drawSys.cabinetPin });
      }
      if (infoRowBox) infoRowBox.boxes = boxInfo;
    }

    // ----- Полки: вкладные, с отступом от переднего края и от задней стенки -----
    const shelfDepth = D - tb - SHELF_SETBACK;
    // Полки идут выше ящиков, отсчёт от ВЕРХНЕГО КРАЯ ФАСАДА верхнего ящика
    // (фасады стоят от низа секции, поэтому это baseH + суммарная высота).
    const facadeTopY = baseH + drawerZoneH;
    const shelfZoneBottom = drawerZoneH
      ? Math.max(innerBottomY, facadeTopY, drawerBaseY + drawerZoneH)
      : innerBottomY;
    // Многозонный пенал (doorZoneCount>1) — у КАЖДОЙ зоны фасада свои
    // съёмные полки (sec.doorZones[zi].shelves/shelfMode/shelfHeights,
    // высота — от НИЗА этой зоны, тот же принцип, что и shelfHeights секции
    // целиком), плюс несъёмные полки-перегородки на стыках зон
    // (sec.zoneBoundaryShelves — высоты от дна секции, ставит
    // placeShelvesAtZoneBoundaries в app.js). Границы зон те же, что у
    // реальных дверей (layoutDoorZones, «второй цикл» ниже) — числа обязаны
    // совпасть, иначе полка и дверь разъедутся. Однозонная секция
    // (doorZoneCount<=1) не имеет понятия «зона» вовсе — там полки, как и
    // раньше, одним плоским набором на sec.shelves/shelfHeights/shelfFixed.
    const multiZone = Number(sec.doorZoneCount) > 1
      && Array.isArray(sec.doorZones) && sec.doorZones.length > 0;
    let shelfEntries = []; // { y, fixed }
    if (sec.shelves > 0 && !multiZone && shelfZoneH < t + 40) {
      // Если ящики заняли весь фронт, зоны под полки не остаётся — полки не
      // строим вовсе, иначе они попадали внутрь ящиков.
      warnings.push(`${secName}: под полки не осталось места — уменьшите число ящиков `
        + `или увеличьте высоту модуля.`);
    } else if (multiZone) {
      const azSlotBot = drawerZoneH ? baseH + drawerZoneH : baseH;
      const azSlotTop = baseH + frontAvail;
      const azZones = [];
      for (let zi = 0; zi < sec.doorZoneCount; zi++) {
        const z = sec.doorZones[zi];
        azZones.push({ height: (z && Number(z.height)) || 0, appliance: (z && z.appliance) || 'none' });
      }
      const azLayout = layoutDoorZones(azZones, azSlotTop - azSlotBot, gap, null, secName);
      for (const v of (sec.zoneBoundaryShelves || [])) {
        const bv = Number(v);
        if (Number.isFinite(bv)) shelfEntries.push({ y: innerBottomY + bv + t / 2, fixed: true });
      }
      // Ниша под технику (appliance !== 'none') не получает съёмных полок —
      // sec.doorZones[zi].shelves для неё в интерфейсе не показывается и
      // остаётся 0, отдельно исключать её диапазон не нужно.
      for (let zi = 0; zi < azZones.length; zi++) {
        const dz = sec.doorZones[zi] || {};
        if (!(Number(dz.shelves) > 0)) continue;
        const zBottom = azSlotBot + azLayout.bottoms[zi];
        const zHeight = azLayout.heights[zi];
        const zoneYs = getShelfYs(
          { shelves: dz.shelves, shelfMode: dz.shelfMode, shelfHeights: dz.shelfHeights },
          zBottom, zHeight, t, zBottom, null);
        for (const y of zoneYs) shelfEntries.push({ y, fixed: false });
      }
      shelfEntries.sort((a, b) => a.y - b.y);
    } else {
      const zoneYs = getShelfYs(sec, shelfZoneBottom, shelfZoneH, t, innerBottomY, []);
      // sec.shelfFixed[si] — полка на стыке зон фасада (старый, однозонный
      // путь placeShelvesAtZoneBoundaries до появления per-zone полок выше).
      // Индекс si совпадает с sec.shelfHeights[si] 1:1 (getShelfYs в ручном
      // режиме отдаёт ровно по одному Y на каждый элемент shelfHeights).
      const manualMode = sec.shelfMode === 'manual' && Array.isArray(sec.shelfFixed);
      shelfEntries = zoneYs.map((y, si) => ({ y, fixed: manualMode && !!sec.shelfFixed[si] }));
    }
    const shelfYs = shelfEntries.map((e) => e.y);
    // Запоминаем плоскости полок: по ним потом разводится присадка под петли
    // и ставятся полкодержатели.
    const infoRow = secInfo[secInfo.length - 1];
    if (infoRow) infoRow.shelfYs = shelfYs.slice();
    shelfPanelX[i] = [secX0 - t / 2, secX0 + secW + t / 2];
    for (let si = 0; si < shelfEntries.length; si++) {
      const y = shelfEntries[si].y;
      const isFixed = shelfEntries[si].fixed;
      if (y < innerBottomY + drawerZoneH - 1 || y > innerBottomY + innerH + 1) {
        warnings.push(`${secName}: полка на высоте ${Math.round(y - innerBottomY)} мм выходит за пределы секции.`);
        continue;
      }
      const width = isFixed ? D : shelfDepth;
      if (secW - 2 > 900 && t <= 16) {
        warnings.push(`${secName}: полка ${Math.round(secW - 2)} мм из ЛДСП ${t} мм прогнётся — добавьте стойку (раздел «Секции») или возьмите материал толще.`);
      }
      // За стеклянным фасадом полки делают из стекла 6 мм — их видно. Для
      // несъёмной Rastex-перегородки это не применимо: она держит корпус,
      // а не просто лежит на полкодержателях, стекло тут неуместно.
      const glassShelf = !isFixed
        && facadeTypeOf(sec, decor, t, p.facadeDecor, p.facadeThickness).glassInside;
      const GL = window.Modul3D.catalog.GLASS;
      parts.push(makePart({
        name: glassShelf ? 'Полка стеклянная' : 'Полка', section: secName,
        material: glassShelf ? GL.code : decor.code,
        thickness: glassShelf ? GL.thickness : t,
        length: secW - 2, width, qty: 1, kind: 'shelf',
        glass: glassShelf, fixed: isFixed,
        note: glassShelf
          ? 'Стекло 6 мм, на полкодержателях с силиконовой пяткой'
          : (isFixed
            ? 'Несъёмная, во всю глубину корпуса, крепится минификсами Rastex к боковинам — '
              + 'на стыке фасадов, для жёсткости пенала'
            : 'Съёмная, на полкодержателях'),
        edging: glassShelf
          ? { long1: null, long2: null, short1: null, short2: null }
          : { long1: EDGE_FRONT, long2: null, short1: null, short2: null },
        x: secCenterX, y, z: isFixed ? 0 : (D / 2 - SHELF_SETBACK) - shelfDepth / 2,
        dims: { w: secW - 2, h: glassShelf ? GL.thickness : t, d: width },
      }));
    }

    // ----- Штанга для одежды -----
    // Нормы установки (см. README):
    //   • просвет от штанги до полки над ней — 50–60 мм, иначе плечики
    //     не проходят; при отсутствии полки отсчёт от крыши;
    //   • от задней стенки до оси штанги — не менее 300 мм: плечики висят
    //     поперёк корпуса и упираются в заднюю стенку;
    //   • держатели (фланцы) крепятся к боковинам двумя саморезами.
    if (sec.rod) {
      const ROD_D = 25;
      const ROD_TOP_GAP = 60;      // просвет до полки/крыши над штангой, мм
      const ROD_BACK_MIN = 300;    // минимум от задней стенки до оси, мм

      // По глубине: ось по центру внутреннего пространства, но не ближе
      // ROD_BACK_MIN к задней стенке и не ближе 80 мм к фасаду.
      const innerBackZ = -D / 2 + tb;          // внутренняя плоскость задней стенки
      const innerFrontZ = D / 2;               // передняя плоскость корпуса
      let rodZ = (innerBackZ + innerFrontZ) / 2;
      const minZ = innerBackZ + ROD_BACK_MIN;
      if (rodZ < minZ) rodZ = minZ;
      if (rodZ > innerFrontZ - 80) rodZ = innerFrontZ - 80;
      const backClear = rodZ - innerBackZ;
      if (backClear < ROD_BACK_MIN - 0.5) {
        warnings.push(`${secName}: глубина корпуса ${Math.round(D)} мм мала для штанги — `
          + `от задней стенки до оси ${Math.round(backClear)} мм вместо ${ROD_BACK_MIN}; `
          + `плечики будут упираться.`);
      }

      // По высоте: под ближайшей полкой сверху (или под крышей) с просветом.
      const above = (infoRow && infoRow.shelfYs ? infoRow.shelfYs : [])
        .filter((y) => y > innerBottomY + 100);
      const ceiling = above.length ? Math.min.apply(null, above) - t / 2 : innerBottomY + innerH;
      const wanted = Number(sec.rodHeight);
      const manual = Number.isFinite(wanted) && wanted > 0;
      let rodY = manual ? innerBottomY + wanted : ceiling - ROD_TOP_GAP;
      const topLimit = ceiling - ROD_D / 2 - 10;
      if (rodY > topLimit) {
        warnings.push(`${secName}: штанга на ${Math.round(rodY - innerBottomY)} мм упирается в полку — `
          + `опущена до ${Math.round(topLimit - innerBottomY)} мм.`);
        rodY = topLimit;
      }
      if (manual && ceiling - rodY < 50) {
        warnings.push(`${secName}: просвет над штангой ${Math.round(ceiling - rodY)} мм — `
          + `для плечиков нужно 50–60 мм.`);
      }

      const rodLen = secW - 2;
      parts.push(makePart({
        name: 'Штанга для одежды', section: secName, material: 'ROD-D25', thickness: 0,
        length: rodLen, width: ROD_D, qty: 1, kind: 'rod',
        note: `Ø${ROD_D} мм, ${Math.round(rodY - innerBottomY)} мм от дна секции, `
          + `просвет сверху ${Math.round(ceiling - rodY)} мм, от задней стенки ${Math.round(backClear)} мм`,
        edging: { long1: null, long2: null, short1: null, short2: null },
        x: secCenterX, y: rodY, z: rodZ,
        dims: { w: rodLen, h: ROD_D, d: ROD_D },
        shape: 'cylinderX',
        hardware: true,
      }));

      // Фланцы на обеих ограничивающих панелях + присадка под их саморезы
      for (const sgn of [-1, 1]) {
        // Фланец стоит ВНУТРИ проёма, прижатый к панели: так он не «утоплен»
        // в боковину. Штанга входит в него — это нормально, они одно целое.
        const px = secCenterX + sgn * (secW / 2 - 3);
        parts.push(makePart({
          name: 'Держатель штанги (фланец)', section: secName, material: 'ROD-H25', thickness: 0,
          length: 40, width: 40, qty: 1, kind: 'rodFlange',
          note: 'Крепится к панели двумя саморезами',
          edging: { long1: null, long2: null, short1: null, short2: null },
          x: px, y: rodY, z: rodZ,
          dims: { w: 6, h: 40, d: 40 },
          shape: 'flange',
          hardware: true,
        }));
        rodFlanges.push({ panelX: secCenterX + sgn * (secW / 2 + t / 2), y: rodY, z: rodZ, secName });
      }
    }
  }

  // ---------- Присадка крепежа корпуса ----------
  // В каждом углу одна деталь перекрывает торец другой. Сверлится ПЛАСТЬ
  // перекрывающей детали и ТОРЕЦ перекрываемой:
  //   • дно накладное (боковина «на дно») — перекрывает дно: конфирмат идёт
  //     снизу через дно в нижний торец боковины;
  //   • дно вкладное — перекрывает боковина: минификс ставится в её пласть,
  //     ответное отверстие — в торец дна;
  //   • крышка и планки всегда вкладные — перекрывает боковина.
  const jointRows = [];
  {
    const sidePart = (x) => parts.filter((p) => p.kind === 'side'
      && Math.abs(p.box.x - x) < 1.5)[0];
    // Несъёмные полки-перегородки (fixed, см. цикл построения полок выше)
    // крепятся к боковинам ТЕМ ЖЕ узлом, что дно/крыша — во всю глубину
    // корпуса, минификс или конфирмат по тому же правилу jointForSide, что
    // и остальной корпус (не жёстко «всегда Rastex» — это дало бы разнобой
    // с реальной сборкой, если у секции сторона на конфирмате).
    const horiz = parts.filter((p) => p.kind === 'top' || p.kind === 'bottom'
      || (p.kind === 'shelf' && p.fixed));

    for (const sgn of [-1, 1]) {
      const mode = sgn < 0 ? sides.left : sides.right;
      const panel = sidePart(sgn * (W / 2 - t / 2));
      if (!panel) continue;
      // Видимая (декоративная — с цветом/текстурой, шпон, МДФ) боковина
      // нельзя сажать на конфирмат: у накладной боковины (mode==='onBottom')
      // конфирмат идёт СНАРУЖИ, через лицевую пласть боковины в торец дна
      // (см. ветку joint==='confirmat' ниже) — на декоративной поверхности
      // это оставляет видимую шляпку/заглушку. Минификс Rastex скрыт внутри
      // корпуса, поэтому декоративную боковину крепят только им — даже если
      // по способу установки (onBottom) обычно уместен конфирмат.
      // «Декоративная» — материал панели отличается от базового корпусного
      // decor.code: либо она уже посчитана видимой автоматически (доходит
      // до пола/сбоку дна — тогда material уже в decor фасада, см. vm выше),
      // либо клиент вручную назначил ей другой материал через редактор
      // детали («Материал / декор» в partBlock). Ручная правка применяется
      // САМОЙ ПОСЛЕДНЕЙ во всей сборке (applyPartOverrides, строго последний
      // шаг, см. её комментарий) — то есть на этом месте кода ещё НЕ
      // применена, а присадка уже нужна сейчас. Поэтому подглядываем в
      // p.partOverrides ТЕМ ЖЕ ключом, что и applyPartOverrides для этой же
      // детали (kind/section/side панели совпадают 1:1 — у боковины всегда
      // ровно одна деталь на сторону, index всегда 0).
      const ovKey = ['side', panel.section || '', partOverrideSide(panel) || '', 0].join('|');
      const ov = p.partOverrides && p.partOverrides[ovKey];
      const effectiveMaterial = (ov && ov.materialOverride) || panel.material;
      const joint = (mode === 'onBottom' && effectiveMaterial !== decor.code)
        ? 'minifix' : jointForSide(mode);
      const pBottom = panel.box.y - panel.box.h / 2;
      const pBackZ = panel.box.z - panel.box.d / 2;

      for (const hp of horiz) {
        // ДЕТАЛЬ ФИЗИЧЕСКИ ДОСТАЁТ ДО ЭТОЙ БОКОВИНЫ? Дно/крышка — цельные,
        // на всю ширину корпуса, всегда касаются обеих наружных боковин.
        // Несъёмная полка-перегородка (fixed) — деталь ОДНОЙ секции: в
        // многосекционном корпусе (несколько колонок через внутреннюю
        // стойку-divider) она может доставать только до ОДНОЙ наружной
        // боковины, а другим торцом упираться во внутреннюю стойку. Стойки
        // (divider) этот контур пока не обрабатывает (см. sidePart выше —
        // только kind:'side'), поэтому для дальнего торца присадку сюда
        // просто не кладём — лучше отсутствие отверстия, чем отверстие в
        // боковине, которой полка не касается.
        if (hp.kind === 'shelf'
            && Math.abs(panel.box.x - hp.box.x) > hp.box.w / 2 + panel.box.w / 2 + 5) {
          continue;
        }
        // Точки крепежа — по СОБСТВЕННОЙ глубине горизонтальной детали в 3D
        // (hp.box.d), а НЕ по полю width из деталировки: для дна и плашмя
        // планки они совпадают, но у планки НА РЕБРО (topType 'railsEdge')
        // width — это её ширина-стойка (100 мм, идёт в деталировку раскроя),
        // а реальная глубина в сборке — толщина плиты (обычно 18 мм). Взять
        // здесь width вместо box.d уводило точку крепежа за пределы детали.
        const pts = jointPoints(hp.box.d);
        // Кто кого перекрывает
        const bottomOverlays = (hp.kind === 'bottom') && (mode === 'onBottom');

        // У ОБЫЧНОЙ плашмя-лежащей детали (дно, крышка плашмя) сечение на
        // торце узкое (её высота = толщина плиты) — там присадку класть
        // некуда, поэтому её единственная осмысленная координата на торце —
        // глубина py. У планки НА РЕБРО (topType 'railsEdge') всё наоборот:
        // на торце как раз ВЫСОТА (box.h = ширина стойки, обычно 100 мм)
        // просторная, а глубина (box.d = толщина плиты, 18 мм) тесная. Для
        // такой детали координату на торце/3D-метке нужно вести по box.h,
        // иначе присадка утыкается в кромку стойки, как чашка глубиной 9 мм
        // при её высоте 100 мм.
        const crossH = hp.box.d < hp.box.h ? hp.box.h : null;
        const edgeY = (py) => crossH ? round1(crossH / 2) : round1(py);

        for (const py of pts) {
          // глубина стыка в системе панели и в системе горизонтальной детали
          const zAbs = (hp.box.z - hp.box.d / 2) + py;      // абсолютная координата Z
          const yOnPanel = zAbs - pBackZ;
          // Отверстие в ТОРЦЕ горизонтальной детали лежит ровно на её конце,
          // поэтому координата вдоль длины — 0 или длина, без «половинок».
          const atLeft = panel.box.x < hp.box.x;
          const xEdge = atLeft ? 0 : hp.length;
          // Отверстие в ПЛАСТИ (сквозное через дно) — под серединой боковины.
          const xFace = Math.min(Math.max(panel.box.x - (hp.box.x - hp.box.w / 2), 8), hp.length - 8);

          if (bottomOverlays) {
            // конфирмат снизу через дно в нижний торец боковины
            hp.holes.push({ x: round1(xFace), y: round1(py), d: 7, depth: 0,
                            through: true, side: 'front', kind: 'confirmatThrough' });
            panel.holes.push({ x: 0, y: round1(yOnPanel), d: 5, depth: 50,
                               through: false, side: 'edge', kind: 'confirmatEdge' });
          } else if (joint === 'confirmat') {
            // конфирмат снаружи через боковину в торец детали
            panel.holes.push({ x: round1(hp.box.y - pBottom), y: round1(yOnPanel), d: 7, depth: 0,
                               through: true, side: 'front', kind: 'confirmatThrough' });
            hp.holes.push({ x: round1(xEdge), y: edgeY(py), d: 5, depth: 50,
                            through: false, side: 'edge', kind: 'confirmatEdge' });
          } else {
            // Минификс Rastex 15: гнездо Ø15 и Ø8 в торец — на ОДНОЙ детали
            // (той, что примыкает торцом), в боковину идёт только дюбель Ø8.
            const camX = xEdge === 0 ? RASTEX.camSetback : hp.length - RASTEX.camSetback;
            // ГНЕЗДО СВЕРЛИТСЯ С НЕВИДИМОЙ СТОРОНЫ. У дна и полки рабочая
            // поверхность сверху — значит эксцентрик заходит СНИЗУ; у крыши
            // наоборот, изнутри смотрят снизу, поэтому гнездо сверху.
            const camSide = (hp.kind === 'top') ? 'front' : 'back';
            hp.holes.push({ x: round1(camX), y: edgeY(py), d: RASTEX.camD,
                            depth: RASTEX.camDepthFor(hp.thickness),
                            through: false, side: camSide, kind: 'minifixCam' });
            hp.holes.push({ x: round1(xEdge), y: edgeY(py), d: RASTEX.boltD,
                            depth: RASTEX.boltDepth,
                            through: false, side: 'edge', kind: 'minifixBolt' });
            panel.holes.push({ x: round1(hp.box.y - pBottom), y: round1(yOnPanel),
                               d: RASTEX.dowelD, depth: RASTEX.dowelDepth,
                               through: false, side: 'front', kind: 'minifixDowel' });
          }
        }
        // НАГЕЛЬ ПРОТИВ ПРОВОРОТА. Узкая деталь (верхняя планка-царга) держится
        // на ОДНОМ крепеже и может провернуться вокруг его оси.
        if (pts.length === 1) {
          const EDGE_SET = 25;    // отступ нагеля от края планки, мм (проект)
          if (crossH && crossH >= 2 * EDGE_SET + 16) {
            // Планка НА РЕБРО: вдоль глубины (18 мм) сместиться некуда —
            // ставим ДВА нагеля по высоте стойки (box.h), симметрично,
            // с отступом EDGE_SET от каждого края. Глубина (py) остаётся
            // той же, что у конфирмата/эксцентрика — центр толщины плиты.
            const py0 = pts[0];
            const zAbs0 = (hp.box.z - hp.box.d / 2) + py0;
            const yOnPanel0 = round1(zAbs0 - pBackZ);
            const atLeft2 = panel.box.x < hp.box.x;
            for (const hEdge of [EDGE_SET, crossH - EDGE_SET]) {
              const heightOff = hEdge - crossH / 2;   // смещение от центра планки
              hp.holes.push({ x: atLeft2 ? 0 : hp.length, y: round1(hEdge), d: 8, depth: 20,
                              through: false, side: 'edge', kind: 'dowelEdge' });
              panel.holes.push({ x: round1(hp.box.y - pBottom + heightOff), y: yOnPanel0,
                                 d: 8, depth: 13, through: false, side: 'front', kind: 'dowelFace' });
            }
          } else {
            const DOWEL_OFF = 32;                       // от оси крепежа, система 32
            const half = hp.box.d / 2;
            const dy = Math.min(DOWEL_OFF, Math.max(half - 12, 8));
            for (const sgnD of (dy >= 12 ? [-1, 1] : [1])) {
              const py2 = round1(pts[0] + sgnD * dy);
              if (py2 < 8 || py2 > hp.box.d - 8) continue;
              const zAbs2 = (hp.box.z - hp.box.d / 2) + py2;
              const atLeft2 = panel.box.x < hp.box.x;
              // ГЛУБИНА ПОД ШКАНТ 8×30. Суммарно 33 мм — на 3 мм больше самого
              // шканта: остаток уходит на клей и стружку, иначе шкант упрётся
              // в дно и деталь не сядет заподлицо. Делим 20 + 13: в пласти
              // 13 мм оставляет 3–5 мм тела плиты, наружу не выйдет.
              hp.holes.push({ x: atLeft2 ? 0 : hp.length, y: py2, d: 8, depth: 20,
                              through: false, side: 'edge', kind: 'dowelEdge' });
              panel.holes.push({ x: round1(hp.box.y - pBottom), y: round1(zAbs2 - pBackZ),
                                 d: 8, depth: 13, through: false, side: 'front', kind: 'dowelFace' });
              break;                                    // одного нагеля достаточно
            }
          }
        }
        jointRows.push({ joint: bottomOverlays ? 'confirmat' : joint, qty: pts.length });
      }
    }
  }

  // ПРАВИЛО ПРОЕКТА: под каждую единицу фурнитуры в модели обязана быть
  // присадка на той детали, к которой она крепится, — и она попадает
  // и в чертежи, и в файл для ЧПУ. Ниже присадка под полкодержатели,
  // направляющие ящиков и держатели штанги.
  //
  // Панель (боковина/стойка) в системе координат детали:
  //   x — по длине (высота панели), y — по ширине (глубина) от ЗАДНЕЙ кромки.
  const panelAt = (x) => parts.filter((p) => (p.kind === 'side' || p.kind === 'divider')
    && Math.abs(p.box.x - x) < 1.5)[0];
  const drillPanel = (x, localX, localY, hole) => {
    const panel = panelAt(x);
    if (!panel) return;
    panel.holes.push(Object.assign({ x: round1(localX), y: round1(localY),
      d: 5, depth: 12, through: false, side: 'front' }, hole || {}));
  };

  // Полкодержатели: по два отверстия на каждую сторону полки, отступ 37 мм
  // от переднего и заднего краёв полки — так стоит стандартный штифт Ø5.
  const SUP_SETBACK = 37;
  for (const row of secInfo) {
    const bounds = shelfPanelX[row.index];
    if (!bounds) continue;
    for (const sy of (row.shelfYs || [])) {
      // Полка ЛЕЖИТ на штифте, значит отверстие идёт НИЖЕ полки — по её
      // нижней плоскости, а не по середине толщины.
      const shelfPart = parts.filter((p) => p.kind === 'shelf'
        && Math.abs(p.box.y - sy) < 1)[0];
      // Несъёмная полка-перегородка (fixed) уже прикреплена к боковинам
      // минификсами Rastex — тем же узлом, что дно/крыша (см. блок
      // «ПРИСАДКА КРЕПЕЖА КОРПУСА» выше, фильтр horiz). Штифты-полкодержатели
      // ей не нужны и физически мешали бы: сверлить лишние отверстия Ø5 и
      // выпускать деталь-«Полкодержатель» для неразборного стыка не нужно.
      if (shelfPart && shelfPart.fixed) continue;
      const shelfT = shelfPart ? shelfPart.box.h : t;
      // Полка ЛЕЖИТ на штифте: и сам штифт, и отверстие под него целиком
      // ниже полки. Поэтому ось отверстия опускаем на его радиус — иначе
      // верхняя половина отверстия оказывается «в теле» полки.
      const PIN_D = 5;
      const pinY = sy - shelfT / 2 - PIN_D / 2;
      for (const px of bounds) {
        const panel = panelAt(px);
        if (!panel) continue;
        const localX = pinY - (panel.box.y - panel.box.h / 2);
        // Отсчёт ведём по ПОЛКЕ, а не по панели: у крайнего модуля видимая
        // боковина глубже корпуса, и задний штифт уезжал за корпус.
        const panelBack = panel.box.z - panel.box.d / 2;
        const shBack = shelfPart ? (shelfPart.box.z - shelfPart.box.d / 2) : (-D / 2);
        const shFront = shelfPart ? (shelfPart.box.z + shelfPart.box.d / 2) : (D / 2);
        const backY = round1(shBack - panelBack);
        const frontY = round1(shFront - panelBack);
        const glassPin = !!(shelfPart && shelfPart.glass);
        for (const ly of [backY + SUP_SETBACK, frontY - SUP_SETBACK]) {
          drillPanel(px, localX, ly, { kind: 'shelfSupport' });
          // Сам полкодержатель — фурнитура: виден в 3D, в деталировку не идёт
          const zAbs = (panel.box.z - panel.box.d / 2) + ly;
          parts.push(makePart({
            name: glassPin ? 'Полкодержатель для стекла' : 'Полкодержатель',
            section: 'Корпус', material: glassPin ? 'SUP-5G' : 'SUP-5', thickness: 0,
            length: 16, width: 5, qty: 1, kind: 'shelfPin',
            note: glassPin ? 'Штифт Ø5 с силиконовой пяткой' : 'Штифт Ø5',
            edging: { long1: null, long2: null, short1: null, short2: null },
            x: px + (px < 0 ? 8 : -8), y: pinY, z: zAbs,
            dims: { w: 16, h: 5, d: 5 },
            shape: 'pin', hardware: true,
          }));
        }
      }
    }
  }

  // Направляющие ящиков: крепятся к панели двумя саморезами Ø5 глубиной 12.
  // Отступ первого отверстия от переднего края — 37 мм, второе на 224 мм
  // дальше (кратно 32 — система присадки 32 мм).
  const RUN_FRONT = 37, RUN_STEP = 224;
  for (const d of drawerMounts) {
    for (const px of d.panels) {
      const panel = panelAt(px);
      if (!panel) continue;
      const localX = d.y - (panel.box.y - panel.box.h / 2);
      const frontY = panel.box.d;
      drillPanel(px, localX, frontY - RUN_FRONT, { kind: 'drawerRunner' });
      drillPanel(px, localX, frontY - RUN_FRONT - RUN_STEP, { kind: 'drawerRunner' });
      // Передний ШТИФТ направляющей: Ø6×11 в боковине корпуса, ось в 10 мм
      // от переднего края панели, на высоте профиля.
      if (d.cabinetPin) {
        drillPanel(px, localX, round1(frontY - d.cabinetPin.fromFront), {
          d: d.cabinetPin.d, depth: d.cabinetPin.depth, kind: 'runnerPinCabinet',
        });
      }
    }
  }

  // Присадка под держатели штанги: два самореза Ø5 глубиной 12 мм на панели,
  // по вертикали через 32 мм (система 32), ось совпадает с осью штанги.
  // Координаты панели: x — по её длине (высоте), y — по ширине (глубине)
  // от ЗАДНЕЙ кромки, как деталь и кладут на присадочный станок.
  // Фланец штангодержателя крепится ТРЕМЯ саморезами с потайной головкой,
  // расположенными по окружности вокруг оси трубы: один сверху, два снизу.
  const FLANGE_R = 22;          // радиус расположения саморезов, мм
  const FLANGE_HOLE_D = 4;      // отверстие под саморез 4 мм
  for (const f of rodFlanges) {
    const panel = parts.filter((p) => (p.kind === 'side' || p.kind === 'divider')
      && Math.abs(p.box.x - f.panelX) < 1.5)[0];
    if (!panel) continue;
    const localX = f.y - (panel.box.y - panel.box.h / 2);
    const localY = f.z - (panel.box.z - panel.box.d / 2);
    for (const a of [90, 210, 330]) {
      const rad = (a * Math.PI) / 180;
      panel.holes.push({
        x: round1(localX + FLANGE_R * Math.sin(rad)),
        y: round1(localY + FLANGE_R * Math.cos(rad)),
        d: FLANGE_HOLE_D, depth: 12, through: false, side: 'front', kind: 'rodFlange',
      });
    }
  }

  // Полки секции в системе координат ФАСАДА: начало — его нижний торец.
  // Нужно, чтобы чашка петли не встала на высоте полки.
  const shelvesOnFacade = (info, idx, faceCenterY, faceH) => {
    const row = (info || []).filter((x) => x.index === idx)[0];
    if (!row || !row.shelfYs || !row.shelfYs.length) return [];
    const bottom = faceCenterY - faceH / 2;
    return row.shelfYs.map((y) => y - bottom).filter((y) => y > -50 && y < faceH + 50);
  };

  // Нижняя граница верхней планки/царги (railTopH, см. выше) в системе
  // координат ФАСАДА — от его нижнего торца, так же как shelvesOnFacade.
  // Дверь всегда доходит до самого верха корпуса (slotTop === H), поэтому
  // достаточно знать высоту двери и её нижний торец в мировых координатах.
  // null, если верхней планки нет (topType 'panel').
  const railBottomOnFacade = (faceCenterY, faceH) => {
    if (!railTopH) return null;
    const faceBottom = faceCenterY - faceH / 2;
    return (H - railTopH) - faceBottom;
  };

  // ---------- Фасады (накладные, перекрывают торцы корпуса) ----------
  // Фасад закрывает свою секцию: от середины левой ограничивающей панели до
  // середины правой (у крайних — до наружной грани модуля), минус зазоры.
  // Поэтому при разной ширине секций фасады получаются разной ширины.
  const bnd = [-W / 2];
  for (let i = 1; i < n; i++) bnd.push(layout.x0[i] - t / 2);
  bnd.push(W / 2);

  const facadeZ = D / 2 + t / 2;   // фасад стоит перед корпусом
  const frontH = H - baseH;        // высота фронта (от верха цоколя до верха)

  for (let i = 0; i < n; i++) {
    const sec = sections[i];
    const secName = `Секция ${i + 1}`;
    const fullW = (bnd[i + 1] - bnd[i]) - 2 * gap;
    // Фасад может быть УЖЕ проёма — так устроен угловой модуль: корпус 900,
    // а фасад 400, остальное закрывает пристыкованный сбоку соседний модуль.
    // Фасад прижимается к стороне открывания: у левой двери — к левому краю.
    // У модуля с заглушкой ширину диктует НЕ фасад, а сама заглушка: к ней
    // пристыковывается перпендикулярный ряд, поэтому её ширина (плюс планки)
    // жёстко задана, а фасад забирает остаток. Стал корпус шире — шире стала
    // дверь, узел стыка остался на месте.
    const blindFT = facadeTypeOf(sec, decor, t, p.facadeDecor, p.facadeThickness);
    const BLIND_W = Number(p.blindWidth) || 560;
    const wantW = p.blindPanel
      ? round1(fullW - BLIND_W - blindFT.thickness - 2 * gap)
      : Number(sec.facadeWidth);
    const narrow = Number.isFinite(wantW) && wantW > 0 && wantW < fullW - 0.5;
    const facadeW = narrow ? wantW : fullW;
    const fX = !narrow ? (bnd[i] + bnd[i + 1]) / 2
      : (primaryFacade(sec) === 'doorRight' ? bnd[i + 1] - gap - facadeW / 2
                                    : bnd[i] + gap + facadeW / 2);
    // Рекомендация «не уже 350–400 мм» относится к НАПОЛЬНЫМ угловым модулям:
    // в глубокий корпус через узкий проём просто не подлезть. У верхнего
    // углового 600×600 фасад 300 мм — норма, там ширину диктует пристыкованный
    // сбоку шкаф глубиной 300, поэтому предупреждение только для глубоких.
    if (narrow && primaryFacade(sec) !== 'open' && facadeW < 350 && D >= 700) {
      warnings.push(`${secName}: фасад ${Math.round(facadeW)} мм при глубине ${Math.round(D)} мм — `
        + `в напольный угловой модуль не подлезть, рекомендуется 350–400 мм.`);
    }
    const secWi = layout.widths[i];

    const ft = facadeTypeOf(sec, decor, t, p.facadeDecor, p.facadeThickness);
    const dHeights = getDrawerHeights(sec, drawerUnitH, frontH, null, secName);
    const drawerZoneH = dHeights.reduce((s, v) => s + v, 0);

    // Фасады ящиков всегда начинаются от низа фронта секции: подъём короба
    // (drawerOffset) на фасад не влияет, иначе внизу зияла бы щель.
    let dy = baseH;
    for (let d = 0; d < dHeights.length; d++) {
      const fH = dHeights[d] - 2 * gap;
      const dh = handleHoles({ kind: 'drawerFront', width: facadeW, height: fH, handleId: sec.handle, handleCC: sec.handleCC });
      // Присадка под крепление фасада к коробу и под держатели релинга.
      // Точные шаблоны отличаются по сериям — здесь типовая схема: два
      // крепления по осям царг, релинги над ними.
      const bi = ((secInfo.filter((x) => x.index === i)[0] || {}).boxes || [])
        .filter((x) => x.index === d)[0];
      const fixHoles = [];
      if (bi) {
        const spread = Math.max(80, (secWi - 60) / 2);
        const yFix = Math.min(Math.max(bi.bot + 25, 20), fH - 20);
        // ЛДСП-короб: фасад держат ЧЕТЫРЕ винта через переднюю стенку —
        // два ряда по высоте короба. Двух точек по низу мало: фасад
        // проворачивается и «клюёт» носом.
        const metalBox = !!(bi.metal);
        // У ЛДСП-короба точки уже посчитаны при его сборке — берём их и
        // переводим в систему фасада. Так отверстия совпадают ровно.
        const facLeft = fX - facadeW / 2;
        const facBot = dy + dHeights[d] / 2 - fH / 2;
        const rows = metalBox ? [yFix] : null;
        // Диаметр в фасаде зависит от того, чем его тянут: у металлической
        // царги это винт через фронтальный держатель (Ø5), у ЛДСП-короба —
        // шуруп 3,5×30, значит направляющее Ø2,5 глубиной 12.
        const fixD = metalBox ? 5 : 2.5;
        if (metalBox) {
          for (const ry of rows) {
            for (const sgn of [-1, 1]) {
              fixHoles.push({ x: round1(facadeW / 2 + sgn * spread), y: ry,
                              d: fixD, depth: 12, through: false, side: 'back', kind: 'frontFix' });
            }
          }
        } else {
          for (const fp of (bi.fixWorld || [])) {
            const lx = round1(fp.x - facLeft), ly = round1(fp.y - facBot);
            if (lx < 10 || lx > facadeW - 10 || ly < 10 || ly > fH - 10) continue;
            fixHoles.push({ x: lx, y: ly, d: fixD, depth: 12,
                            through: false, side: 'back', kind: 'frontFix' });
          }
        }
        for (let k = 1; k <= (bi.reling || 0); k++) {
          const yRel = Math.min(yFix + (bi.h * k) / ((bi.reling || 0) + 1), fH - 20);
          for (const sgn of [-1, 1]) {
            fixHoles.push({ x: round1(facadeW / 2 + sgn * spread), y: round1(yRel),
                            d: 5, depth: 12, through: false, side: 'back', kind: 'relingFix' });
          }
        }
      }
      if (dh.overflow) {
        warnings.push(`${secName}, фасад ящика ${d + 1}: ручка «${dh.handle.name}» не помещается — `
          + `возьмите меньше межосевое расстояние.`);
      }
      if (dh.count) handleHardware.push({ id: dh.handle.id, qty: dh.count, name: dh.handle.name, cc: dh.handle.cc });
      if (dh.badCC) warnings.push(`${secName}: у ручки не задано межосевое расстояние — укажите его в секции.`);
      pushHandleParts({ parts, mounts: dh.mounts, secName, handleName: dh.handle.name,
        faceX: fX, faceY: dy + dHeights[d] / 2, faceW: facadeW, faceH: fH,
      faceZ: D / 2 + ft.thickness / 2, t: ft.thickness });
      parts.push(makePart({
        name: `Фасад ящика ${d + 1}`, section: secName, sectionIndex: i,
        material: ft.material, thickness: ft.thickness,
        facadeType: ft.id, frameW: ft.frame, insertMaterial: ft.insert, glass: ft.render === 'glass',
        length: facadeW, width: fH, qty: 1, kind: 'drawerFront', grain: true,
        holes: dh.holes.concat(fixHoles),
        note: 'Накладной' + (dh.count ? `, ручка ${dh.handle.name}` : ''),
        edging: { long1: EDGE_FRONT, long2: EDGE_FRONT, short1: EDGE_FRONT, short2: EDGE_FRONT },
        x: fX, y: dy + dHeights[d] / 2, z: D / 2 + ft.thickness / 2,
        dims: { w: facadeW, h: fH, d: ft.thickness },
      }));
      drawerHardware.push({ section: secName, width: secWi, depth: D, system: sec.drawerSystem || 'ballBearing', pushToOpen: !!sec.pushToOpen });
      dy += dHeights[d];
    }

    // Двери занимают фронт, свободный от ящиков. Границу считаем по
    // ФАКТИЧЕСКОМУ положению фасадов ящиков, а не по их суммарной высоте:
    // при смещённой стопке (drawerFrom = 'top' | 'offset') дверь иначе
    // налезала на ящики.
    // Слот двери — весь фронт, свободный от ящиков; внутри него может стоять
    // ОДНА дверная зона на весь слот (как раньше) либо НЕСКОЛЬКО зон одна
    // над другой (doorZoneCount > 1 — пеналы под встраиваемую технику или
    // просто «две двери одна над другой»). Каждая зона вписывается в свой
    // участок слота с отступом gap со всех сторон — по тому же принципу,
    // что и створки doors2 по горизонтали.
    const slotBot = drawerZoneH ? baseH + drawerZoneH : baseH;
    const slotTop = baseH + frontH;

    // Список зон "снизу вверх". По умолчанию (doorZoneCount <= 1, или без
    // заполненного sec.doorZones) — одна зона на весь слот: это в точности
    // старое поведение, обязательная обратная совместимость.
    let zonesRaw;
    if (Number(sec.doorZoneCount) > 1 && Array.isArray(sec.doorZones) && sec.doorZones.length) {
      zonesRaw = [];
      for (let zi = 0; zi < sec.doorZoneCount; zi++) {
        const z = sec.doorZones[zi];
        zonesRaw.push({
          facade: (z && z.facade) || 'doorLeft',
          height: (z && Number(z.height)) || 0,
          appliance: (z && z.appliance) || 'none',
          applianceW: (z && Number(z.applianceW)) || 0,
          applianceD: (z && Number(z.applianceD)) || 0,
          note: (z && z.note) || '',
        });
      }
    } else {
      zonesRaw = [{ facade: sec.facade, height: 0, appliance: 'none', applianceW: 0, applianceD: 0, note: '' }];
    }

    if (zonesRaw.length > 1 && p.blindPanel && narrow) {
      warnings.push(`${secName}: несколько зон по высоте с заглушкой углового модуля не `
        + `поддерживаются вместе — заглушка построена только для одной (нижней) зоны.`);
    }

    const zoneLayout = layoutDoorZones(zonesRaw, slotTop - slotBot, gap, (w) => warnings.push(w), secName);

    for (let zi = 0; zi < zonesRaw.length; zi++) {
      const zone = zonesRaw[zi];
      const doorZoneH = zoneLayout.heights[zi];
      if (doorZoneH <= 0) continue;  // предупреждение уже дал layoutDoorZones
      const doorY = slotBot + zoneLayout.bottoms[zi] + doorZoneH / 2;
      const isTopZone = zi === zonesRaw.length - 1;
      const fac = zone.facade === 'doors1' ? 'doorLeft' : zone.facade;  // старое имя
      const zoneSecName = zonesRaw.length > 1
        ? `${secName} (${zi === 0 ? 'нижняя зона' : (isTopZone ? 'верхняя зона' : `зона ${zi + 1}`)})`
        : secName;
      // Ниша под технику со своей лицевой панелью (духовка/СВЧ) — фасада
      // корпуса тут нет вообще, независимо от того, что выбрано в facade
      // (см. APPLIANCE_LABELS выше). Как и facade:'open' — просто ничего не
      // строим и переходим к следующей зоне.
      if (applianceNicheOnly(zone.appliance)) continue;
      // Фасад есть, но крепится НЕ на мебельную петлю корпуса (холодильник —
      // на боковину спец. петлями; стиральная/посудомоечная — на дверцу
      // самой техники по шаблону производителя) — обычную чашку не сверлим,
      // честно предупреждаем.
      const skipHinge = applianceSkipsHinge(zone.appliance);
      if (skipHinge && (fac === 'doorLeft' || fac === 'doorRight' || fac === 'doors2')) {
        warnings.push(`${zoneSecName}: фасад под ${APPLIANCE_LABELS[zone.appliance]} — `
          + `${applianceHingeNote(zone.appliance)}.`);
      }
      const applianceDimsNote = (zone.applianceW || zone.applianceD)
        ? `габариты техники (Ш×Г) ${zone.applianceW ? Math.round(zone.applianceW) : '—'}×`
          + `${zone.applianceD ? Math.round(zone.applianceD) : '—'} мм`
        : '';

      if (fac === 'doorLeft' || fac === 'doorRight') {
        const hingeSide = fac === 'doorLeft' ? 'петли слева' : 'петли справа';
        const dh = handleHoles({ kind: 'door', width: facadeW, height: doorZoneH,
          handleId: sec.handle, handleCC: sec.handleCC, orient: sec.handleOrient,
          hingeSide: fac === 'doorLeft' ? 'left' : 'right',
          floorY: doorY - doorZoneH / 2, frame: ft.frame,
          zoneIndex: zi, zoneCount: zonesRaw.length });
        if (dh.overflow) warnings.push(`${secName}: ручка «${dh.handle.name}» не помещается на двери.`);
        if (dh.badCC) warnings.push(`${secName}: у ручки не задано межосевое расстояние — укажите его в секции.`);
        if (dh.count) handleHardware.push({ id: dh.handle.id, qty: dh.count, name: dh.handle.name, cc: dh.handle.cc });
        pushHandleParts({ parts, mounts: dh.mounts, secName: zoneSecName, handleName: dh.handle.name,
          faceX: fX, faceY: doorY, faceW: facadeW, faceH: doorZoneH,
          faceZ: D / 2 + ft.thickness / 2, t: ft.thickness });
        const doorNoteParts = [`Накладная, ${hingeSide}` + (dh.count ? `, ручка ${dh.handle.name}` : '')];
        if (skipHinge) doorNoteParts.push(applianceHingeNote(zone.appliance));
        if (applianceDimsNote) doorNoteParts.push(applianceDimsNote);
        if (zone.note) doorNoteParts.push(zone.note);
        parts.push(makePart({
          name: `Дверь ${fac === 'doorLeft' ? 'левая' : 'правая'} (${ft.name.replace('Фасад ', '')})`,
          section: zoneSecName, sectionIndex: i, zoneIndex: zi, material: ft.material, thickness: ft.thickness,
          facadeType: ft.id, frameW: ft.frame, insertMaterial: ft.insert, glass: ft.render === 'glass',
          length: facadeW, width: doorZoneH, qty: 1, kind: 'door', grain: true,
          holes: skipHinge ? dh.holes : dh.holes.concat(hingeHoles(facadeW, doorZoneH,
            fac === 'doorLeft' ? 'left' : 'right',
            shelvesOnFacade(secInfo, i, doorY, doorZoneH),
            (w) => warnings.push(w), secName, ft.render === 'glass',
            isTopZone ? railBottomOnFacade(doorY, doorZoneH) : null)),
          note: doorNoteParts.join('; '),
          edging: { long1: EDGE_FRONT, long2: EDGE_FRONT, short1: EDGE_FRONT, short2: EDGE_FRONT },
          x: fX, y: doorY, z: D / 2 + ft.thickness / 2,
          dims: { w: facadeW, h: doorZoneH, d: ft.thickness },
        }));
        doorHardware.push({ section: zoneSecName, height: doorZoneH, leaves: 1, pushToOpen: !!sec.pushToOpen });

        // ЗАГЛУШКА УГЛОВОГО МОДУЛЯ. Фасад узкий, остальной фронт корпуса
        // закрывает вертикальная панель из КОРПУСНОГО ЛДСП: она же служит
        // опорой петель соседа и не даёт заглянуть в угол. К её правой
        // кромке ПОД 90° крепится фальш-планка из фасадного материала —
        // видимая снаружи полоса, добирающая фронт до соседнего ряда.
        // Несколько зон по высоте с заглушкой вместе не поддерживаются —
        // строим её только для нижней зоны (см. предупреждение выше).
        if (p.blindPanel && narrow && zi === 0) {
          const STRIP_W = Number(p.blindStrip) || 78;
          const BRACKET_W = Number(p.blindBracket) || 100;
          const ftk = ft.thickness;
          // ФРОНТ УГЛОВОГО МОДУЛЯ собирается так:
          //   дверь → фальш-планка (фасадный материал, уходит ВПЕРЁД под 90°)
          //   → заглушка (корпусной ЛДСП, во фронте, справа от планки)
          //   → планка крепёжная (корпусной ЛДСП, НАПРОТИВ заглушки, на
          //     переднем торце фальш-планки) — к ней и встаёт соседний ряд.
          // Все три детали связаны МИНИФИКСАМИ: гнездо эксцентрика Ø15
          // сверлится с ВНУТРЕННЕЙ стороны — снаружи его быть не должно.
          const stripX = round1(fX + facadeW / 2 + gap + ftk / 2);
          const blindX0 = round1(stripX + ftk / 2);
          const blindW = BLIND_W;   // фиксированная: к ней стыкуется соседний ряд
          const stripH = round1(frontH - 2 * gap);
          const CAM_SET = RASTEX.camSetback;       // ось эксцентрика от кромки
          const pts = jointPoints(stripH);        // точки крепежа по высоте

          const strip = makePart({
            name: 'Фальш-планка (добор)', section: zoneSecName,
            material: ft.material, thickness: ftk,
            facadeType: ft.id, grain: true,
            length: stripH, width: STRIP_W, qty: 1, kind: 'filler',
            note: `Из фасадного материала, ${STRIP_W} мм, под 90° слева от заглушки `
              + '— закрывает её торец; крепление на минификсы',
            edging: { long1: EDGE_FRONT, long2: EDGE_FRONT, short1: EDGE_FRONT, short2: EDGE_FRONT },
            x: stripX, y: baseH + frontH / 2,
            z: round1(D / 2 + STRIP_W / 2),
            dims: { w: ftk, h: stripH, d: STRIP_W },
            // Деталь смещена от центра модуля — общая эвристика стороны
            // ошибается (см. комментарий у frontIsPlus в viewer.js). Дюбели
            // должны открываться на грани, что касается заглушки/планки
            // крепёжной, а не на внешней стороне фальш-планки.
            frontIsPlus: false,
          });
          const blind = makePart({
            name: 'Заглушка (панель)', section: zoneSecName,
            material: decor.code, thickness: t,
            length: round1(frontH), width: blindW, qty: 1, kind: 'filler',
            note: 'Глухая панель фронта углового модуля, корпусной ЛДСП, на минификсах',
            edging: { long1: EDGE_FRONT, long2: EDGE_FRONT, short1: EDGE_FRONT, short2: EDGE_FRONT },
            x: round1(blindX0 + blindW / 2), y: baseH + frontH / 2, z: D / 2 + t / 2,
            dims: { w: blindW, h: frontH, d: t },
          });
          const bracket = makePart({
            name: 'Планка крепёжная (ЛДСП)', section: zoneSecName,
            material: decor.code, thickness: t,
            length: stripH, width: BRACKET_W, qty: 1, kind: 'filler',
            note: `Корпусной ЛДСП ${BRACKET_W} мм, напротив заглушки на переднем `
              + 'торце фальш-планки; минификсы, гнездо Ø15 внутрь корпуса',
            edging: { long1: EDGE_FRONT, long2: null, short1: null, short2: null },
            x: round1(stripX + ftk / 2 + BRACKET_W / 2), y: baseH + frontH / 2,
            // Планка утоплена на свою толщину: её передняя пласть вровень
            // с торцом фальш-планки, и кромка планки оказывается закрыта.
            z: round1(D / 2 + STRIP_W - t / 2),
            dims: { w: BRACKET_W, h: t, d: t },
          });
          bracket.box.w = BRACKET_W; bracket.box.h = stripH; bracket.box.d = t;

          for (const py of pts) {
            // Заглушка примыкает ТОРЦОМ к фальш-планке: гнездо Ø15 и Ø8 в торец
            // — на заглушке, дюбель Ø8 — в пласть фальш-планки (у ближнего края,
            // где заглушка своим торцом прилегает к пласти планки).
            blind.holes.push({ x: round1(py), y: round1(CAM_SET), d: RASTEX.camD,
                              depth: RASTEX.camDepthFor(t),
                              through: false, side: 'back', kind: 'minifixCam' });
            blind.holes.push({ x: round1(py), y: 0, d: RASTEX.boltD, depth: RASTEX.boltDepth,
                              through: false, side: 'edge', kind: 'minifixBolt' });
            strip.holes.push({ x: round1(py), y: round1(t / 2), d: RASTEX.dowelD,
                              depth: RASTEX.dowelDepth,
                              through: false, side: 'back', kind: 'minifixDowel' });
            // Планка крепёжная примыкает ТОРЦОМ к фальш-планке (симметрично
            // заглушке, но у дальнего края): гнездо Ø15 и шток Ø8 — в торец
            // планки крепёжной; дюбель Ø8 — в пласть фальш-планки НАПРОТИВ
            // штока, у того же (дальнего) края, где планка своим торцом
            // прилегает к пласти фальш-планки.
            // Гнездо — с ВНЕШНЕЙ стороны планки: по разметке заказчика и по
            // факту нулевого зазора с фальш-планкой с внутренней стороны
            // (отвёрткой туда не подобраться). Планку крепёжную в этом месте
            // закрывает соседний ряд после сборки — снаружи гнездо не остаётся.
            bracket.holes.push({ x: round1(py), y: round1(CAM_SET), d: RASTEX.camD,
                                depth: RASTEX.camDepthFor(t),
                                through: false, side: 'front', kind: 'minifixCam' });
            bracket.holes.push({ x: round1(py), y: 0, d: RASTEX.boltD, depth: RASTEX.boltDepth,
                                through: false, side: 'edge', kind: 'minifixBolt' });
            // Дюбель центруется по толщине ПЛАНКИ КРЕПЁЖНОЙ (t, корпусный
            // ЛДСП — по нему же проходит шток), а не фальш-планки (ftk):
            // именно там, по центру торца планки, входит её шток.
            strip.holes.push({ x: round1(py), y: round1(STRIP_W - t / 2), d: RASTEX.dowelD,
                              depth: RASTEX.dowelDepth,
                              through: false, side: 'back', kind: 'minifixDowel' });
          }
          jointRows.push({ joint: 'minifix', qty: pts.length * 2 });
          parts.push(strip, blind, bracket);
        }
      } else if (fac === 'doors2') {
        const leafW = (facadeW - 2 * gap) / 2;
        const doors2NoteParts = ['двустворчатая'];
        if (skipHinge) doors2NoteParts.push(applianceHingeNote(zone.appliance));
        if (applianceDimsNote) doors2NoteParts.push(applianceDimsNote);
        if (zone.note) doors2NoteParts.push(zone.note);
        for (let leaf = 0; leaf < 2; leaf++) {
          // У двустворчатой двери петли снаружи: ручки сходятся к середине,
          // поэтому у левой створки ручка справа, у правой — слева.
          const dh = handleHoles({ kind: 'door', width: leafW, height: doorZoneH,
            handleId: sec.handle, handleCC: sec.handleCC, orient: sec.handleOrient,
            hingeSide: leaf === 0 ? 'left' : 'right',
            floorY: doorY - doorZoneH / 2, frame: ft.frame,
            zoneIndex: zi, zoneCount: zonesRaw.length });
          if (dh.count) handleHardware.push({ id: dh.handle.id, qty: dh.count, name: dh.handle.name, cc: dh.handle.cc });
          const leafX = fX - facadeW / 2 + leafW / 2 + leaf * (leafW + 2 * gap);
          pushHandleParts({ parts, mounts: dh.mounts, secName: zoneSecName, handleName: dh.handle.name,
            faceX: leafX, faceY: doorY, faceW: leafW, faceH: doorZoneH,
            faceZ: D / 2 + ft.thickness / 2, t: ft.thickness });
          parts.push(makePart({
            name: `Дверь-створка (${ft.name.replace('Фасад ', '')})`,
            section: zoneSecName, sectionIndex: i, zoneIndex: zi, material: ft.material, thickness: ft.thickness,
            facadeType: ft.id, frameW: ft.frame, insertMaterial: ft.insert, glass: ft.render === 'glass',
            length: leafW, width: doorZoneH, qty: 1, kind: 'door', grain: true,
            holes: skipHinge ? dh.holes : dh.holes.concat(hingeHoles(leafW, doorZoneH,
              leaf === 0 ? 'left' : 'right',
              shelvesOnFacade(secInfo, i, doorY, doorZoneH),
              (w) => warnings.push(w), secName, ft.render === 'glass',
              isTopZone ? railBottomOnFacade(doorY, doorZoneH) : null)),
            note: 'Накладная, ' + doors2NoteParts.join('; ') + (dh.count ? `, ручка ${dh.handle.name}` : ''),
            edging: { long1: EDGE_FRONT, long2: EDGE_FRONT, short1: EDGE_FRONT, short2: EDGE_FRONT },
            x: fX - facadeW / 2 + leafW / 2 + leaf * (leafW + 2 * gap), y: doorY, z: facadeZ,
            dims: { w: leafW, h: doorZoneH, d: t },
          }));
        }
        doorHardware.push({ section: zoneSecName, height: doorZoneH, leaves: 2, pushToOpen: !!sec.pushToOpen });
      } else if (fac === 'liftUp') {
        // Фасад откидывается ВВЕРХ: петель нет, работает подъёмный механизм.
        const dh = handleHoles({ kind: 'liftFront', width: facadeW, height: doorZoneH, handleId: sec.handle, handleCC: sec.handleCC });
        if (dh.count) handleHardware.push({ id: dh.handle.id, qty: dh.count, name: dh.handle.name, cc: dh.handle.cc });
        pushHandleParts({ parts, mounts: dh.mounts, secName: zoneSecName, handleName: dh.handle.name,
          faceX: fX, faceY: doorY, faceW: facadeW, faceH: doorZoneH,
          faceZ: D / 2 + ft.thickness / 2, t: ft.thickness });
        const liftNoteParts = ['Накладной, открывание вверх' + (dh.count ? `, ручка ${dh.handle.name}` : '')];
        if (zone.note) liftNoteParts.push(zone.note);
        parts.push(makePart({
          name: 'Фасад откидной (вверх)', section: zoneSecName, sectionIndex: i, zoneIndex: zi,
          material: decor.code, thickness: t,
          length: facadeW, width: doorZoneH, qty: 1, kind: 'door', grain: true,
          holes: dh.holes,
          note: liftNoteParts.join('; '),
          edging: { long1: EDGE_FRONT, long2: EDGE_FRONT, short1: EDGE_FRONT, short2: EDGE_FRONT },
          x: fX, y: doorY, z: D / 2 + ft.thickness / 2,
          dims: { w: facadeW, h: doorZoneH, d: ft.thickness },
        }));
        const liftId = sec.lift || 'aventosHK';
        const chk = checkLift(liftId, doorZoneH, W);
        if (chk) {
          liftHardware.push({ id: liftId, section: zoneSecName, qty: 1 });
          for (const n of chk.notes) {
            warnings.push(`${secName}: подъёмник «${chk.lift.name}» — ${n}.`);
          }
        }
      }
      // zone.facade === 'open' → фасада нет (открытая зона)
    }
  }

  // Ручные правки конкретных деталей — см. applyPartOverrides выше. Строго
  // ПОСЛЕДНИЙ шаг: все формулы корпуса уже отработали, соседние детали
  // пересчитывать не нужно (и не будем).
  applyPartOverrides(parts, p.partOverrides, warnings);

  return {
    params: p,
    sides,
    sidesLabel: sidesLabel(sides),
    dims: {
      W, H, D, innerH, baseH, Wi, sectionOpening, t, tb, gap, innerBottomY, n,
      // Раскладка секций: ширина и левая граница проёма каждой
      sections: layout.widths.map((w, i) => Object.assign(
        { w, x0: layout.x0[i], x1: layout.x0[i] + w },
        secInfo.find((x) => x.index === i) || { drawerAvail: 0, drawerHeights: [] })),
    },
    parts,   // сырые детали модуля, в локальных координатах
    hardwareContext: { drawerHardware, doorHardware, handleHardware, liftHardware,
      jointRows,
      sectionsCount: n, jointCount: 2 + dividers },
    warnings,
  };
}

// ============================================================================
// Проект = набор МОДУЛЕЙ, стоящих в ряд слева направо.
//
// Почему так: внутри одного корпуса боковина общая для двух соседних секций
// (их разделяет одна стойка), поэтому «своя схема боковины у каждой секции»
// внутри корпуса невозможна. Кухня и не устроена как один корпус — это набор
// отдельных модулей, у каждого свои боковины, дно, крыша и цоколь. Отсюда:
//   Проект → Модули → Секции.
// Шкаф — проект из одного модуля. Кухня — из нескольких.
//
// project = {
//   bodyThickness, backThickness, decor, backMaterial, jointType, gap,
//   modules: [ { name, width, height, depth, scheme, base, sections:[...] } ]
// }
// Совместимость: если передан старый объект с полем sections — он трактуется
// как проект из одного модуля.
// ============================================================================
function buildModel(project) {
  const proj = project.modules ? project : toSingleModuleProject(project);
  const mods = proj.modules;

  // Пустой проект — нормальное состояние: программа стартует без модулей,
  // первый модуль пользователь выбирает сам. Возвращаем пустую, но полноценную
  // модель, чтобы 3D, чертежи и смета не спотыкались о её отсутствие.
  if (!mods || !mods.length) {
    return {
      project: proj, modules: [], isMulti: false,
      dims: { W: 0, H: 0, D: 0 },
      parts: [], partsRaw: [],
      hardwareContext: { drawerHardware: [], doorHardware: [], sectionsCount: 0, jointCount: 0 },
      warnings: [], isEmpty: true,
    };
  }

  const allParts = [];
  const warnings = [];
  const modules = [];
  const drawerHardware = [];
  const doorHardware = [];
  const handleHardware = [];
  const liftHardware = [];
  const jointRows = [];
  let jointCount = 0;

  // Поворот модуля вокруг вертикальной оси: 0 / 90 / 180 / 270°.
  const rotOf = (m) => {
    const v = Math.round(Number(m.rotation) || 0);
    return ((v % 360) + 360) % 360;
  };

  const tBody = Number(proj.bodyThickness || 16);
  const tBack = Number(proj.backThickness || 3);

  // Глубина модуля, который встаёт СЛЕДОМ (перпендикулярный ряд после угла).
  // По ней строится заглушка углового модуля: она закрывает фронт ровно на
  // ширину соседнего корпуса, иначе стык не сходится.
  const nextDepthOf = (m) => {
    const i = mods.indexOf(m);
    const nxt = i >= 0 ? mods[i + 1] : null;
    const d = nxt ? Number(nxt.depth || 0) : 0;
    return d > 0 ? d : (Number(m.blindWidth) || Number(m.depth) || 560);
  };

  // Место, которое модуль реально занимает в плане. Важно: фасад выступает
  // ВПЕРЁД на толщину ЛДСП, задняя стенка — НАЗАД на толщину ХДФ. У повёрнутого
  // модуля этот выступ приходится на соседа по ряду, поэтому раскладка ведётся
  // по полному занимаемому месту, иначе корпуса налезают друг на друга.
  const extent = (m) => {
    const W = Number(m.width || 0), D = Number(m.depth || 0);
    switch (rotOf(m)) {
      case 90:  return { x0: -D / 2 - tBack, x1: D / 2 + tBody, z0: -W / 2, z1: W / 2 };
      case 180: return { x0: -W / 2, x1: W / 2, z0: -D / 2 - tBody, z1: D / 2 + tBack };
      case 270: return { x0: -D / 2 - tBody, x1: D / 2 + tBack, z0: -W / 2, z1: W / 2 };
      default:  return { x0: -W / 2, x1: W / 2, z0: -D / 2 - tBack, z1: D / 2 + tBody };
    }
  };
  // Габарит по КОРПУСУ (без выступа фасада) — для размеров на чертежах.
  const carcass = (m) => {
    const W = Number(m.width || 0), D = Number(m.depth || 0);
    const sw = rotOf(m) === 90 || rotOf(m) === 270;
    return { w: sw ? D : W, d: sw ? W : D };
  };

  // --- РАСКЛАДКА ПРОЕКТА -----------------------------------------------------
  // Модули идут ПРОГОНАМИ. Обычный прогон — прямой ряд вдоль стены. Модуль,
  // помеченный как УГЛОВОЙ, завершает прогон: следующий пойдёт от него под 90°,
  // как в Г-образной кухне. Первый модуль нового прогона встаёт вплотную ПЕРЕД
  // угловым и своей боковиной закрывает ту часть его фронта, которая осталась
  // без фасада, — это стандартный угловой стык.
  //
  // Обход ведётся в координатах прогона: u — вдоль ряда, v — «в комнату»
  // (к фасадам). Для глобальных координат u и v разворачиваются по направлению.
  const DIR_U = [[1, 0], [0, 1], [-1, 0], [0, -1]];   // вдоль прогона
  const DIR_V = [[0, 1], [-1, 0], [0, -1], [1, 0]];   // к фасадам
  const DIR_ROT = [0, 270, 180, 90];                  // разворот модуля в прогоне
  // Угловой стык по цеховой схеме: фасадный элемент для стыка шириной 50 мм
  // плюс отступ 50 мм — этого хватает, чтобы дверцы и ручки двух корпусов
  // не задевали друг друга при открывании.
  const FILLER_W = 50;       // ширина стыковочной планки из фасадного материала
  const FILLER_GAP = 50;     // отступ перпендикулярного корпуса от планки
  const isCorner = (m) => !!m.corner;

  // Разбиваем модули на прогоны: угловой модуль — последний в своём прогоне.
  const runs = [];
  let cur = [];
  mods.forEach((m, i) => {
    cur.push(i);
    if (isCorner(m) && i < mods.length - 1) { runs.push(cur); cur = []; }
  });
  if (cur.length) runs.push(cur);

  // Стартовая точка и направление первого прогона
  let dir = 0;
  let originX = 0, originZ = 0;
  // Первый прогон центрируем по X, как раньше, чтобы одиночный шкаф стоял в нуле
  const firstRunLen = (runs[0] || []).reduce((sum, i) => {
    const e = extent(mods[i]); return sum + (e.x1 - e.x0);
  }, 0);
  originX = -firstRunLen / 2;
  // По глубине первый прогон центрируем так же, как раньше стоял одиночный
  // модуль (корпус вокруг нуля), — иначе сдвинулись бы все виды на чертежах.
  const firstRunDepth = Math.max.apply(null, (runs[0] || [0]).map((i) => {
    const e = extent(mods[i]); return e.z1 - e.z0;
  }));
  const firstRunFront = Math.max.apply(null, (runs[0] || [0]).map((i) => extent(mods[i]).z1));
  originZ = firstRunFront - firstRunDepth;

  const placed = [];   // фактические габариты корпусов на месте — для dims
  const cornerPlinths = [];   // угловые модули: их цоколь тянем до соседнего ряда

  runs.forEach((run) => {
    const U = DIR_U[dir], V = DIR_V[dir];
    const dirRot = DIR_ROT[dir];
    // В пределах прогона модули выравниваются по ПЕРЕДНЕМУ краю, а сам прогон
    // отсчитывается от СТЕНЫ: v = 0 — задняя плоскость самого глубокого модуля,
    // v = runDepth — общая фасадная плоскость. Так следующий прогон встаёт
    // ровно от наружной грани углового модуля, а не сквозь него.
    const runDepth = Math.max.apply(null, run.map((i) => {
      const e = extent(mods[i]); return e.z1 - e.z0;
    }));
    let cursor = 0;
    let lastCornerU = 0, lastCornerV = runDepth;

    run.forEach((idx) => {
      const m = mods[idx];
      const name = m.name || `Модуль ${idx + 1}`;
      const built = buildModuleParts({
        width: m.width, height: m.height, depth: m.depth,
        bodyThickness: proj.bodyThickness, backThickness: proj.backThickness,
        decor: m.carcassDecor || proj.decor, facadeDecor: proj.facadeDecor,
        facadeThickness: proj.facadeThickness,
        backMaterial: proj.backMaterial,
        drawerDecor: proj.drawerDecor, drawerThickness: proj.drawerThickness,
        base: m.base, legType: m.legType, leftSide: m.leftSide, rightSide: m.rightSide,
        topType: m.topType, railWidth: m.railWidth, noBack: !!m.noBack,
        worktopDepth: m.family === 'kitchen' ? Number(proj.worktopDepth || 0) : 0,
        family: m.family,
        blindPanel: !!m.blindPanel, blindStrip: m.blindStrip,
        // Ширина заглушки = ГЛУБИНА СОСЕДНЕГО модуля: к ней он и стыкуется.
        // Меняется глубина ряда — заглушка подстраивается сама.
        blindWidth: nextDepthOf(m),
        scheme: m.scheme, sections: m.sections,
        jointType: proj.jointType, gap: proj.gap,
        drawerUnitHeight: proj.drawerUnitHeight,
        // Ручные правки конкретных деталей этого модуля (режим фокуса →
        // «Редактировать»), см. applyPartOverrides. Живёт прямо в объекте
        // модуля — переживает Undo/Redo и сохранение проекта бесплатно,
        // т.к. snapshot()/serializeProject() сериализуют state.modules целиком.
        partOverrides: m.partOverrides || {},
      });

      const manualRot = rotOf(m);
      const e = extent(m);                       // габарит в системе прогона
      const offU = cursor - e.x0;                // левый край встаёт на курсор
      const offV = runDepth - e.z1;              // передние плоскости совпадают

      for (const part of built.parts) {
        const b = part.box;
        // 1) собственный поворот модуля — в системе прогона
        if (manualRot === 90)       { const x = b.x, w = b.w; b.x = b.z; b.z = -x; b.w = b.d; b.d = w; }
        else if (manualRot === 180) { b.x = -b.x; b.z = -b.z; }
        else if (manualRot === 270) { const x = b.x, w = b.w; b.x = -b.z; b.z = x; b.w = b.d; b.d = w; }
        const u = b.x + offU, v = b.z + offV;
        // 2) разворот прогона: (u,v) → глобальные (x,z)
        const gx = originX + U[0] * u + V[0] * v;
        const gz = originZ + U[1] * u + V[1] * v;
        if (dirRot === 90 || dirRot === 270) { const w = b.w; b.w = b.d; b.d = w; }
        b.x = round1(gx);
        b.z = round1(gz);
        // Итоговый разворот детали: в 3D по нему разворачивается вся деталь
        // целиком вместе с присадкой и ручкой, а не переставляются габариты.
        part.rot = (dirRot + manualRot) % 360;
        b.w = round1(b.w);
        b.d = round1(b.d);
        part.module = name;
        allParts.push(part);
      }
      for (const w of built.warnings) warnings.push(`${name}: ${w}`);
      built.hardwareContext.drawerHardware.forEach((d) => drawerHardware.push(d));
      built.hardwareContext.doorHardware.forEach((d) => doorHardware.push(d));
      (built.hardwareContext.handleHardware || []).forEach((d) => handleHardware.push(d));
      (built.hardwareContext.liftHardware || []).forEach((d) => liftHardware.push(d));
      (built.hardwareContext.jointRows || []).forEach((d) => jointRows.push(d));
      jointCount += built.hardwareContext.jointCount;

      const c = carcass(m);
      // Модуль строится с центром в локальном нуле, поэтому его центр
      // в системе прогона — это и есть смещение.
      const centerU = offU;
      const centerV = offV;
      const gcx = originX + U[0] * centerU + V[0] * centerV;
      const gcz = originZ + U[1] * centerU + V[1] * centerV;
      const cw = (dirRot === 90 || dirRot === 270) ? c.d : c.w;
      const cd = (dirRot === 90 || dirRot === 270) ? c.w : c.d;
      placed.push({ x0: gcx - cw / 2, x1: gcx + cw / 2, z0: gcz - cd / 2, z1: gcz + cd / 2 });

      modules.push({
        name, offsetX: gcx, offsetZ: gcz, rotation: (dirRot + manualRot) % 360,
        // dims.W/D — габарит корпуса НА МЕСТЕ (с учётом поворота и прогона);
        // dimsOwn — его СОБСТВЕННЫЕ ширина и глубина, без поворота: по ним
        // строится рабочий чертёж модуля.
        dims: Object.assign({}, built.dims, { W: cw, D: cd }),
        dimsOwn: Object.assign({}, built.dims, { W: c.w, D: c.d }),
        sides: built.sides, sidesLabel: built.sidesLabel,
        params: built.params,
      });

      cursor += (e.x1 - e.x0);
      if (isCorner(m)) {
        // УГЛОВОЙ СТЫК. Перпендикулярный ряд нельзя ставить вплотную: ящики
        // не выедут, а фасады и ручки столкнутся с соседом. Между ними ставят
        // ФАЛЬШ-ПЛАНКУ (доборную) из фасадного материала — она и держит зазор.
        const sec0 = (m.sections && m.sections[0]) || {};
        const ftc = facadeTypeOf(sec0, proj.decor, tBody, proj.facadeDecor, proj.facadeThickness);
        const mBaseH = m.base && m.base.type === 'plinth'
          ? Number(m.base.plinthHeight || 0) : Number(m.base.legHeight || 0);
        const frontH = Number(m.height || 0) - mBaseH;
        const uC = cursor - ftc.thickness / 2;
        const vC = runDepth + FILLER_W / 2;
        const gx = originX + U[0] * uC + V[0] * vC;
        const gz = originZ + U[1] * uC + V[1] * vC;
        const swap = dirRot === 90 || dirRot === 270;
        // У модуля со своей заглушкой стыковочную планку ставит он сам
        // (фальш-планка добора) — вторую в том же месте не делаем.
        if (!m.blindPanel) allParts.push(Object.assign(makePart({
          name: 'Фальш-планка угловая', section: 'Угловой стык',
          material: ftc.material, thickness: ftc.thickness,
          length: frontH, width: FILLER_W, qty: 1, kind: 'filler', grain: true,
          note: `Фасадный элемент для стыка в углу, ${FILLER_W} мм; `
            + `корпус соседнего ряда отставлен ещё на ${FILLER_GAP} мм`,
          edging: { long1: EDGE_FRONT, long2: EDGE_FRONT, short1: EDGE_FRONT, short2: EDGE_FRONT },
          x: round1(gx), y: mBaseH + frontH / 2, z: round1(gz),
          dims: swap
            ? { w: FILLER_W, h: frontH, d: ftc.thickness }
            : { w: ftc.thickness, h: frontH, d: FILLER_W },
        }), { module: name, rot: dirRot }));

        // цоколь этого модуля дотягиваем до цоколя следующего прогона
        cornerPlinths.push({ name, sign: U[0] !== 0 ? U[0] : 0 });

        lastCornerU = cursor;
        // Модуль со своей заглушкой уже несёт узел стыка: фальш-планку и
        // планку крепёжную. Следующий прогон встаёт ВПЛОТНУЮ к ним, без
        // дополнительного отступа — иначе в углу зияет щель.
        // Прогон отсчитывается по ЗАНИМАЕМОМУ месту (в него входит вылет
        // фасада на tBody), поэтому вычитаем эту толщину — иначе корпус
        // соседа встаёт с зазором в одну плиту.
        lastCornerV = m.blindPanel
          ? runDepth + (Number(m.blindStrip) || 78) - tBody
          : runDepth + FILLER_W + FILLER_GAP;
      }
    });

    // Поворот на следующий прогон: новое начало — у наружной грани углового
    // модуля, вплотную перед его фасадной плоскостью.
    const nx = originX + U[0] * lastCornerU + V[0] * lastCornerV;
    const nz = originZ + U[1] * lastCornerU + V[1] * lastCornerV;
    originX = nx; originZ = nz;
    dir = (dir + 1) % 4;
  });

  // Цоколь углового стыка. Цоколи двух прогонов идут перпендикулярно и
  // утоплены от фасада на PLINTH_SETBACK — без удлинения между ними остаётся
  // дыра. Удлиняем цоколь углового модуля на это утопление плюс фальш-планку,
  // чтобы в углу планки сошлись.
  // Цоколь углового модуля НЕ удлиняем за габарит: раньше его тянули
  // навстречу соседнему прогону, и планка выезжала за изделие. Стык в углу
  // закрывает поперечная планка второго прогона — она и доводится встык
  // (см. joinCornerPlinths).
  void cornerPlinths;

  // На стыке двух соседних модулей их ближние к стыку опоры стоят почти
  // впритык друг к другу (обе — у своего края, по LEG_INSET от шва) —
  // ставить клипсу на КАЖДУЮ из них незачем, одна и так держит цоколь и за
  // соседнюю опору. Снимаем клипсу с лишней ДО склейки планок (пока у
  // каждого модуля свой цоколь — с него же убираем и её отверстия).
  dedupeAdjacentClips(allParts);

  // В ряду модулей цоколь делается ОДНОЙ сквозной планкой, а не отдельной
  // у каждого корпуса — так его и режут, и ставят на производстве.
  mergePlinths(allParts);
  joinCornerPlinths(allParts);
  // У углового модуля цокольная планка короче корпуса (за угол её не тянут —
  // там боковина соседнего прогона), а опоры расставлены по ВСЕЙ ширине
  // корпуса. Крайняя опора углового модуля может оказаться там, где цоколя
  // уже нет — клипсе тогда нечем держать цоколь (некуда крепить и нечего
  // «утапливать» — планки там просто нет). Убираем клипсу с таких опор и
  // подчищаем «висящие» отверстия под неё, которые могли остаться на
  // планках после склейки/подрезки в углу.
  finalizePlinthClips(allParts);

  // Одинаковые предупреждения схлопываем — иначе список превращается в простыню
  const uniqueWarnings = warnings.filter((w, i) => warnings.indexOf(w) === i);

  const { merged, numByKey } = mergeEqualParts(allParts);
  // Несклеенный список: каждая деталь со своим модулем, секцией и боксом,
  // с номером позиции из деталировки. Нужен для чертежей.
  const partsRaw = allParts.map((part) => Object.assign({}, part, {
    num: numByKey.get(mergeKey(part)),
    boxes: [part.box],
  }));

  const maxH = Math.max.apply(null, mods.map(m => Number(m.height || 0)));
  const spanW = placed.length
    ? Math.max.apply(null, placed.map(p => p.x1)) - Math.min.apply(null, placed.map(p => p.x0)) : 0;
  const maxD = placed.length
    ? Math.max.apply(null, placed.map(p => p.z1)) - Math.min.apply(null, placed.map(p => p.z0)) : 0;

  return {
    project: proj,
    modules,
    isMulti: mods.length > 1,
    dims: { W: round1(spanW), H: maxH, D: round1(maxD) },
    parts: merged,
    partsRaw,
    hardwareContext: { drawerHardware, doorHardware, handleHardware, liftHardware, jointRows,
      sectionsCount: mods.length, jointCount },
    warnings: uniqueWarnings,
  };
}

/**
 * Сливает цоколи соседних модулей в одну сквозную планку.
 * Объединяются только те, что реально образуют единую деталь: одинаковая
 * высота, толщина, положение по высоте и глубине, и торцы соприкасаются.
 * Модули разной высоты цоколя или разной глубины остаются со своими планками.
 * Изменяет массив parts на месте.
 */
// Координаты отверстий детали (h.x у plinth.holes) заданы в ЛОКАЛЬНОЙ,
// ещё не повёрнутой системе координат самой детали (см. buildModuleParts) —
// а сама деталь в 3D/на чертеже разворачивается как жёсткое тело на угол
// part.rot = dirRot+manualRot (см. основной цикл buildModel выше). Код ниже
// (склейка и стыковка цоколя в углу) сопоставляет эти локальные h.x с
// ГЛОБАЛЬНЫМИ координатами других деталей (box.x/box.z) — для этого нужно
// знать, в какую сторону смотрит локальный «+x» детали после её разворота:
// при повороте на 0°/270° он совпадает с ростом глобальной координаты по
// своей оси, при 90°/180° — растёт в обратную сторону (чистый поворот без
// отражения, проверено по DIR_U/DIR_V/DIR_ROT и формулам поворота box.x/z
// выше). Без этой поправки отверстие под клипсу после поворота модуля
// «съезжает» вдоль планки в сторону от реальной ноги, хотя угол разворота
// у детали в целом остаётся верным.
function holeAxisSign(part) {
  const r = ((Math.round(part.rot || 0) % 360) + 360) % 360;
  return (r === 90 || r === 180) ? -1 : 1;
}

// Опоры двух соседних модулей у стыка стоят рядом (обе на LEG_INSET от
// шва — то есть друг от друга заметно ближе, чем обычный шаг опор внутри
// модуля, LEG_SPAN=900). Клипса одной из них и так держит цоколь по обе
// стороны шва — второй клипсе там держать нечего, только лишний крепёж.
// Работает ДО склейки цоколей (mergePlinths) — пока у каждого модуля свой
// плинтус, отверстия под снятую клипсу проще найти и убрать по месту.
function dedupeAdjacentClips(parts) {
  const SEAM_GAP = 250;   // мм — ближе этого считаем «у одного стыка»
  const HALF = 12.5;      // клипса ±12,5 мм от оси опоры (шаг отверстий 25 мм)
  const HOLE_EPS = 1;
  const legs = parts.filter((p) => p.kind === 'leg' && p.hasClip);
  const dropped = new Set();
  for (let i = 0; i < legs.length; i++) {
    if (dropped.has(legs[i])) continue;
    for (let j = i + 1; j < legs.length; j++) {
      if (dropped.has(legs[j])) continue;
      const dist = Math.hypot(legs[i].box.x - legs[j].box.x, legs[i].box.z - legs[j].box.z);
      if (dist < SEAM_GAP) dropped.add(legs[j]);
    }
  }
  for (const leg of dropped) {
    leg.hasClip = false;
    leg.note = leg.note.replace(/, с клипсой для цоколя[^,]*(\([^)]*\))?/, '');
    const clipY = leg.length * 0.5; // как при сверлении — половина высоты опоры
    const pl = parts.find((p) => p.kind === 'plinth' && p.module === leg.module);
    if (!pl) continue;
    // Планка может лежать вдоль глобального X (прямой ряд) или Z (повёрнутый
    // ряд/прогон) — определяем ось так же, как в mergePlinths/joinCornerPlinths.
    const ax = pl.box.d > pl.box.w ? 'z' : 'x';
    const px = pl.length / 2 + holeAxisSign(pl) * (leg.box[ax] - pl.box[ax]);
    pl.holes = pl.holes.filter((h) => !(Math.abs(h.y - clipY) < HOLE_EPS
      && (Math.abs(h.x - (px - HALF)) < HOLE_EPS || Math.abs(h.x - (px + HALF)) < HOLE_EPS)));
  }
}

function mergePlinths(parts) {
  const EPS = 1;                                  // допуск стыка, мм
  const plinths = parts.filter(p => p.kind === 'plinth');
  if (plinths.length < 2) return;

  // Планка может идти вдоль X (прямой ряд) или вдоль Z (прогон после
  // поворота). Склеиваем по своей оси в обоих случаях: раздельные цоколя
  // у повёрнутого ряда — брак, их режут одной планкой, как и в прямом ряду.
  const axisOf = (p) => (p.box.d > p.box.w ? 'z' : 'x');
  const sizeOn = (p, ax) => (ax === 'x' ? p.box.w : p.box.d);
  const setSize = (p, ax, v) => { if (ax === 'x') p.box.w = v; else p.box.d = v; };

  const groups = new Map();
  for (const p of plinths) {
    const ax = axisOf(p);
    const cross = ax === 'x' ? p.box.z : p.box.x;   // положение поперёк планки
    const key = [ax, p.material, p.thickness, round1(p.box.y), round1(cross),
                 round1(p.box.h)].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const removed = new Set();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const ax = axisOf(list[0]);
    list.sort((a, b) => a.box[ax] - b.box[ax]);

    // ДЛИНА РЕЗА ОГРАНИЧЕНА ЛИСТОМ (2800 мм по длинной стороне). Планку
    // длиннее физически не выпилить. Пока цоколь короче — он идёт ОДНОЙ
    // сквозной планкой; делим только тогда, когда в лист он не влезает, и
    // делим строго ПО СТЫКАМ МОДУЛЕЙ, а не посередине корпуса.
    const MAX_CUT = 2800;
    let run = [list[0]];
    const flush = () => {
      if (run.length < 2) { run = []; return; }
      const lo = run[0].box[ax] - sizeOn(run[0], ax) / 2;
      const last = run[run.length - 1];
      const hi = last.box[ax] + sizeOn(last, ax) / 2;
      const head = run[0];
      // У каждой планки в run — своя присадка под клипсу кухонной опоры
      // (см. буквально drilling в основании выше), координаты — от края
      // ЭТОЙ планки, СВОЕГО (см. holeAxisSign выше): при part.rot 0°/270°
      // это левый (нижний по ax) край, при 90°/180° — правый (верхний), т.к.
      // локальный «+x» детали после поворота смотрит в обратную сторону.
      // Голову растягиваем без сдвига её собственного «нулевого» края, а у
      // СКЛЕИВАЕМЫХ и удаляемых планок этот край уезжает — раньше их
      // отверстия просто терялись вместе с деталью: клипсы соседних модулей
      // оставались без присадки в цоколе (а без поправки на поворот —
      // переносились не туда). Переводим каждое отверстие в глобальную
      // координату по СВОЕЙ ориентации детали, а затем — в локальную
      // систему головы по ЕЁ ориентации.
      const signHead = holeAxisSign(head);
      const mergedHoles = [];
      for (const p of run) {
        const signP = holeAxisSign(p);
        const pLo = p.box[ax] - sizeOn(p, ax) / 2;
        const pHi = p.box[ax] + sizeOn(p, ax) / 2;
        for (const h of (p.holes || [])) {
          const g = signP === 1 ? (pLo + h.x) : (pHi - h.x);
          const merged = signHead === 1 ? (g - lo) : (hi - g);
          mergedHoles.push(Object.assign({}, h, { x: round1(merged) }));
        }
      }
      head.holes = mergedHoles;
      head.box[ax] = (lo + hi) / 2;
      setSize(head, ax, hi - lo);
      head.length = round1(hi - lo);
      head.note = 'Сквозной цоколь на весь ряд, утоплен от фасада';
      head.module = run.map(p => p.module).filter((v, i, a) => a.indexOf(v) === i).join(' + ');
      for (let i = 1; i < run.length; i++) removed.add(run[i]);
      run = [];
    };

    for (let i = 1; i < list.length; i++) {
      const prev = run[run.length - 1] || list[i - 1];
      const gap = (list[i].box[ax] - sizeOn(list[i], ax) / 2)
        - (prev.box[ax] + sizeOn(prev, ax) / 2);
      const grown = run.length
        ? (list[i].box[ax] + sizeOn(list[i], ax) / 2) - (run[0].box[ax] - sizeOn(run[0], ax) / 2)
        : sizeOn(list[i], ax);
      if (Math.abs(gap) <= EPS && grown <= MAX_CUT) run.push(list[i]);
      else { flush(); run = [list[i]]; }
    }
    flush();
  }

  if (removed.size) {
    for (let i = parts.length - 1; i >= 0; i--) {
      if (removed.has(parts[i])) parts.splice(i, 1);
    }
  }
}

// В УГЛУ цоколя двух прогонов должны сойтись: один идёт вдоль X, другой вдоль
// Z, и без доводки между ними остаётся щель (или, наоборот, планка не доходит
// до соседнего ряда). Дотягиваем поперечную планку до плоскости продольной —
// в цеху их так и подрезают «в ус»/встык.
function joinCornerPlinths(parts) {
  const EPS = 1;
  const along = (p) => (p.box.d > p.box.w ? 'z' : 'x');
  const xs = parts.filter(p => p.kind === 'plinth' && along(p) === 'x');
  const zs = parts.filter(p => p.kind === 'plinth' && along(p) === 'z');
  if (!xs.length || !zs.length) return;

  for (const z of zs) {
    for (const x of xs) {
      if (Math.abs(z.box.y - x.box.y) > EPS) continue;         // разные ярусы
      const xLo = x.box.x - x.box.w / 2, xHi = x.box.x + x.box.w / 2;
      if (z.box.x < xLo - 200 || z.box.x > xHi + 200) continue;
      const zLo = z.box.z - z.box.d / 2, zHi = z.box.z + z.box.d / 2;
      const xFace = x.box.z + x.box.d / 2;                     // передняя грань продольной
      const xBack = x.box.z - x.box.d / 2;                     // задняя грань продольной
      // Поперечная планка ДОВОДИТСЯ ДО ГРАНИ продольной и упирается в неё
      // встык — не насквозь: две планки в одном объёме это брак раскроя.
      let add = 0, dirZ = 0;
      if (zLo >= xFace - EPS) { add = zLo - xFace; dirZ = -1; }        // стоит дальше по Z
      else if (zHi <= xBack + EPS) { add = xBack - zHi; dirZ = 1; }    // стоит ближе по Z
      else continue;                                                   // уже пересекаются
      if (add <= EPS || add > 400) continue;
      // Тот же перенос отверстий под клипсу, что и у продольной планки ниже
      // (см. комментарий у signX) — свой край поперечной планки при
      // удлинении тоже уезжает, отверстия нужно тащить вместе с ним.
      const signZ = holeAxisSign(z);
      const zLoBefore = zLo, zHiBefore = zHi;
      z.box.d = round1(z.box.d + add);
      z.box.z = round1(z.box.z + dirZ * add / 2);
      z.length = round1(z.length + add);
      z.note = 'Цоколь доведён до цоколя соседнего ряда (угловой стык)';
      const zLoAfter = z.box.z - z.box.d / 2, zHiAfter = z.box.z + z.box.d / 2;
      const edgeShiftZ = signZ === 1 ? (zLoBefore - zLoAfter) : (zHiAfter - zHiBefore);
      if (edgeShiftZ && z.holes && z.holes.length) {
        const EPS_HOLE = 0.5;
        z.holes = z.holes
          .map((h) => Object.assign({}, h, { x: round1(h.x + edgeShiftZ) }))
          .filter((h) => h.x >= -EPS_HOLE && h.x <= z.length + EPS_HOLE);
      }

      // И встречное движение по продольной планке. За углом, ЗА поперечным
      // цоколем, продольного цоколя быть не должно: там стоит корпус второго
      // прогона и цоколь ему не нужен — планка только зря режется и вылезает
      // на чертеже. Продольную доводим ровно до ДАЛЬНЕЙ грани поперечной
      // (нахлёст), а всё, что за ней, отсекаем.
      const zLoX = z.box.x - z.box.w / 2, zHiX = z.box.x + z.box.w / 2;
      const overRight = xHi - zHiX;        // сколько продольной торчит за угол вправо
      const overLeft = zLoX - xLo;         // ... и влево
      const KEEP = 0;                      // нахлёст ровно до дальней грани
      // Отсекать надо ту сторону, что уходит ЗА угол, а не ту, где стоит
      // остальной ряд. Ряд определяем по всем планкам этого же уровня.
      const row = xs.filter((q) => Math.abs(q.box.y - x.box.y) <= EPS
        && Math.abs(q.box.z - x.box.z) <= EPS);
      let rowLo = Infinity, rowHi = -Infinity;
      for (const q of row) {
        rowLo = Math.min(rowLo, q.box.x - q.box.w / 2);
        rowHi = Math.max(rowHi, q.box.x + q.box.w / 2);
      }
      const cutRight = (rowHi - zHiX) <= (zLoX - rowLo);
      // Свой край планки (см. holeAxisSign выше: при part.rot 0°/270° это
      // левый край, при 90°/180° — правый, т.к. локальный «+x» детали после
      // поворота смотрит в обратную сторону) — начало отсчёта x у её
      // присадки. Отсекая или удлиняя планку с этого края, он уезжает —
      // отверстия раньше оставались на старом месте и «отрывались» от
      // клипсы (а без поправки на поворот — переносились не в ту сторону).
      // Ловим сдвиг СВОЕГО края ДО/ПОСЛЕ и переносим отверстия вместе с ним.
      const signX = holeAxisSign(x);
      const xLoBefore = x.box.x - x.box.w / 2;
      const xHiBefore = x.box.x + x.box.w / 2;
      if (cutRight && overRight > KEEP) {
        // ряд идёт слева, за угол вправо торчит лишнее — отсекаем
        const cut = overRight - KEEP;
        x.box.w = round1(x.box.w - cut);
        x.box.x = round1(x.box.x - cut / 2);
        x.length = round1(x.length - cut);
        x.note = 'Цоколь доведён в угол внахлёст с цоколем соседнего ряда';
      } else if (!cutRight && overLeft > KEEP) {
        const cut = overLeft - KEEP;
        x.box.w = round1(x.box.w - cut);
        x.box.x = round1(x.box.x + cut / 2);
        x.length = round1(x.length - cut);
        x.note = 'Цоколь доведён в угол внахлёст с цоколем соседнего ряда';
      } else if (xHi < zHiX && zHiX - xHi < 400) {
        const ext = zHiX - xHi;            // не дотягивается — наоборот, удлиняем
        x.box.w = round1(x.box.w + ext);
        x.box.x = round1(x.box.x + ext / 2);
        x.length = round1(x.length + ext);
        x.note = 'Цоколь доведён в угол внахлёст с цоколем соседнего ряда';
      } else if (xLo > zLoX && xLo - zLoX < 400) {
        const ext = xLo - zLoX;
        x.box.w = round1(x.box.w + ext);
        x.box.x = round1(x.box.x - ext / 2);
        x.length = round1(x.length + ext);
        x.note = 'Цоколь доведён в угол внахлёст с цоколем соседнего ряда';
      }
      const xLoAfter = x.box.x - x.box.w / 2;
      const xHiAfter = x.box.x + x.box.w / 2;
      const edgeShift = signX === 1 ? (xLoBefore - xLoAfter) : (xHiAfter - xHiBefore);
      if (edgeShift && x.holes && x.holes.length) {
        // Планку в углу порой ОТРЕЗАЮТ (см. ветки cutRight/cutLeft выше) —
        // угол уходит соседнему прогону, и отверстие, оказавшееся теперь
        // ЗА пределами укороченной планки, сверлить негде: там её больше
        // нет. Такое отверстие отбрасываем, а не оставляем координатой
        // вне детали (что раньше и ловил геометрический тест).
        const EPS_HOLE = 0.5;
        x.holes = x.holes
          .map((h) => Object.assign({}, h, { x: round1(h.x + edgeShift) }))
          .filter((h) => h.x >= -EPS_HOLE && h.x <= x.length + EPS_HOLE);
      }
    }
  }
}

// У углового модуля цокольная планка короче корпуса — за угол её не ведут,
// там место соседнего прогона. Опоры при этом расставлены по всей ширине
// корпуса (см. drilling выше), и крайняя опора углового модуля может
// оказаться там, где цоколя уже нет. Клипсе тогда нечем держать цоколь —
// снимаем hasClip с такой опоры и подчищаем «висящие» (без планки под
// ними) отверстия под клипсу, которые могли остаться после склейки/подрезки
// цоколя в углу (mergePlinths/joinCornerPlinths).
function finalizePlinthClips(parts) {
  const plinths = parts.filter((p) => p.kind === 'plinth');
  const HALF = 12.5;      // клипса ±12,5 мм от оси опоры (шаг отверстий 25 мм)
  const AXIS_EPS = 150;   // допуск по поперечной оси между цоколем и опорой, мм
  const HOLE_EPS = 0.5;
  const covers = (leg) => plinths.some((pl) => {
    const along = pl.box.d > pl.box.w ? 'z' : 'x';
    const size = along === 'z' ? pl.box.d : pl.box.w;
    const lo = pl.box[along] - size / 2, hi = pl.box[along] + size / 2;
    const legPos = leg.box[along];
    const cross = along === 'z' ? 'x' : 'z';
    if (Math.abs(leg.box[cross] - pl.box[cross]) > AXIS_EPS) return false;
    return (legPos - HALF) >= lo - HOLE_EPS && (legPos + HALF) <= hi + HOLE_EPS;
  });
  for (const leg of parts) {
    if (leg.kind !== 'leg' || !leg.hasClip) continue;
    if (!covers(leg)) {
      leg.hasClip = false;
      leg.note = leg.note.replace(/, с клипсой для цоколя[^,]*(\([^)]*\))?/, '');
    }
  }
  // Отверстия под клипсу, оказавшиеся вне своей планки (после склейки или
  // подрезки в углу), сверлить негде — убираем как «висящие».
  for (const pl of plinths) {
    pl.holes = pl.holes.filter((h) => h.x >= -HOLE_EPS && h.x <= pl.length + HOLE_EPS);
  }
}

// Старый формат (один корпус) → проект из одного модуля
function toSingleModuleProject(p) {
  return {
    bodyThickness: p.bodyThickness, backThickness: p.backThickness,
    decor: p.decor, backMaterial: p.backMaterial,
    jointType: p.jointType, gap: p.gap, drawerUnitHeight: p.drawerUnitHeight,
    modules: [{
      name: 'Изделие', width: p.width, height: p.height, depth: p.depth,
      scheme: p.scheme, leftSide: p.leftSide, rightSide: p.rightSide,
      base: p.base, sections: p.sections,
    }],
  };
}

// Ключ склейки: детали считаются одинаковыми, если совпадают все значимые
// поля. Секция в ключ НЕ входит — одинаковые полки из разных секций это одна
// строка деталировки.
function mergeKey(part) {
  return JSON.stringify([
    part.name, part.material, part.thickness, part.length, part.width,
    part.edging.long1, part.edging.long2, part.edging.short1, part.edging.short2,
    part.grainDirection, part.note,
    // Присадка/пазы/тип фасада — иначе две иначе одинаковые детали с разной
    // присадкой (например, деталь с ручными правками из part.overrides)
    // молча склеятся в одну строку и потеряют/задвоят отверстия.
    part.holes, part.grooves, part.facadeType,
  ]);
}

// Объединяет одинаковые детали суммируя qty — требование п.13 ТЗ
// ("корректно суммирует количество одинаковых деталей").
//
// ВАЖНО: склейка теряет принадлежность к секции (у склеенной строки остаётся
// секция первой встреченной детали). Поэтому для чертежей секций нужен
// НЕсклеенный список — он возвращается отдельно из buildModel как partsRaw,
// с проставленным номером позиции из склеенной деталировки.
function mergeEqualParts(parts) {
  const map = new Map();
  for (const part of parts) {
    const key = mergeKey(part);
    if (map.has(key)) {
      const existing = map.get(key);
      existing.qty += part.qty;
      existing._boxes.push(part.box);
    } else {
      map.set(key, Object.assign({}, part, { _boxes: [part.box] }));
    }
  }
  // Номера позиций проставляются только деталям из листа: фурнитура (ножки)
  // в деталировке не участвует, иначе в нумерации появлялись бы дыры.
  let idx = 0;
  const merged = Array.from(map.values()).map((row) => {
    const num = row.hardware ? null : (idx += 1);
    return Object.assign({}, row, { num, boxes: row._boxes });
  });
  // key -> номер позиции, чтобы проставить его несклеенным деталям
  const numByKey = new Map();
  for (const row of merged) numByKey.set(mergeKey(row), row.num);
  return { merged, numByKey };
}

window.Modul3D = window.Modul3D || {};
window.Modul3D.engine = {
  buildModel, buildModuleParts, EDGE_FRONT, EDGE_BACK, SIDE_LABEL, sidesLabel,
  // Чистая функция раскладки вертикальных зон фасада — переиспользуется в
  // app.js (контекстное «Разделить на секции» из 3D), чтобы не дублировать
  // формулу стыков между зонами.
  layoutDoorZones,
};
})();
