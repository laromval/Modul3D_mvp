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
const EDGE_MID   = 'ПВХ 0.8 мм'; // кромка периметра фасада НЕ из ЛДСП (МДФ/массив/алюминий)

// Кромка периметра фасада зависит от его материала (см. ПРАВИЛА-КОНСТРУИРОВАНИЯ.md, §4):
// ЛДСП-фасад — ПВХ 2 мм, как и любая видимая кромка детали без фасада; стекло
// вообще не кромкуется (торец шлифуется на стекольном производстве — см. GLASS
// в catalog.js); любой другой фасадный материал (МДФ, массив) — ПВХ 0.8 мм.
// ИСКЛЮЧЕНИЕ (решение пользователя 2026-09-25): алюминиевый рамочный фасад
// ('alu') НЕ кромится вообще — кромки на профиле нет.
function facadeEdgeType(ft) {
  if (ft.render === 'glass') return null;
  if (ft.id === 'alu') return null;
  return ft.id === 'ldsp' ? EDGE_FRONT : EDGE_MID;
}
// Кромка фальш-планки (добора) из «фасадного материала» секции. Планка — не
// рамка, а плита (у 'alu' — по-прежнему лист FAC-ALU), поэтому исключение
// алюминиевого профиля из кромки на неё не распространяется: ПВХ 0.8 мм,
// как было до v311.
function fillerEdgeType(ft) {
  if (ft.id === 'alu') return EDGE_MID;
  return facadeEdgeType(ft);
}

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
  // Навесной модуль не стоит на полу — «до пола» у него невозможно (решение
  // пользователя 2026-10-03): floor (старые проекты, умолчание) читается как
  // «сбоку дна» — у навесного (цоколь 0) геометрия та же, а в базе хранится
  // именно «сбоку дна».
  if (isWallHung(p)) {
    if (left === 'floor') left = 'besideBottom';
    if (right === 'floor') right = 'besideBottom';
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
// xStart — левая граница первого проёма (внутренняя грань левой боковины).
// По умолчанию -Wi/2 (боковины одной толщины, проёмы симметричны); при
// боковинах разной толщины (видимая боковина, ручная правка) — -W/2 + tL.
function layoutSections(sections, Wi, t, xStart) {
  const n = sections.length;
  const x00 = Number.isFinite(xStart) ? xStart : -Wi / 2;
  const avail = Wi - (n - 1) * t;               // чистая ширина всех проёмов

  // Секция ровно одна — делить и фиксировать нечего, ей всегда положена вся
  // доступная ширина проёма. Игнорируем sec.widthMode/sec.width, даже если
  // на секции остался залипший widthMode:'fixed' от прежней раскладки с
  // несколькими секциями (после удаления остальных секций контрол «Ширина
  // проёма секции» пропадает из UI, и сбросить fixed-режим руками больше
  // нечем) — иначе в раскладке возникает необъяснимый зазор или ложный
  // overflow-предупреждение.
  if (n === 1) {
    return { widths: [avail], x0: [x00], overflow: 0 };
  }

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
  let cur = x00;
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
    // Решение пользователя 2026-10-05: ящики растягиваются на весь фронт только
    // в секции, где больше ничего нет. Если над ящиками есть штанга или полки —
    // это отдельный отсек, ящики остаются типовой высоты, а содержимое отсека
    // не двигается (раньше после удаления фасада ящики раздувались на всю секцию).
    const hasOtherContent = !!sec.rod || Number(sec.shelves) > 0
      || (Array.isArray(sec.doorZones) && sec.doorZones.some((z) => z && (z.rod || z.pantograph || Number(z.shelves) > 0 || Number(z.drawers) > 0)));
    if (!hasDoor && !hasOtherContent) {
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

// Режим дверных зон: секция разделена на отсеки (doorZoneCount > 1) ЛИБО
// неразделённая секция со встроенной техникой — normalizeSingleZoneSection
// превращает её в одну зону (singleZone). Все места, читающие sec.doorZones,
// спрашивают это, а не голое «doorZoneCount > 1».
function zonesOn(sec) {
  return (Number(sec.doorZoneCount) > 1 || sec.singleZone === true)
    && Array.isArray(sec.doorZones) && sec.doorZones.length > 0;
}
// Неразделённая секция с техникой (sec.appliance, поле «Техника» в редакторе
// отсека) строится как секция из ОДНОЙ зоны: фасад, габариты техники и заметка
// переезжают в doorZones[0]. Без техники секция не меняется (прежний путь).
function normalizeSingleZoneSection(sec) {
  if (!sec || Number(sec.doorZoneCount) > 1) return sec;
  if (!sec.appliance || sec.appliance === 'none') return sec;
  return Object.assign({}, sec, {
    doorZoneCount: 1, singleZone: true,
    doorZones: [{
      facade: sec.facade, height: 0, appliance: sec.appliance,
      applianceW: Number(sec.applianceW) || 0, applianceD: Number(sec.applianceD) || 0,
      note: sec.note || '',
    }],
  });
}

// Секция считается «без фасада» (открытой), только если у неё нет ни
// одной непустой дверной зоны — при нескольких зонах (doorZoneCount > 1)
// одиночного sec.facade больше нет, поэтому такие места кода не могут
// читать его напрямую.
function sectionHasAnyFacade(sec) {
  if (zonesOn(sec)) {
    // Ящики отсека тоже закрывают передний торец, даже если дверь отсека 'open'.
    return sec.doorZones.some((z) => z && (z.facade !== 'open' || Number(z.drawers) > 0));
  }
  return sec.facade !== 'open';
}

// «Основной» фасад секции — для мест, которым нужно одно решение на всю
// секцию (например, к какому краю жмётся узкий фасад углового модуля).
// При нескольких зонах берём фасад НИЖНЕЙ (первой) зоны.
function primaryFacade(sec) {
  if (zonesOn(sec)) {
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
 * zones[i].height — высота НИШИ (светового проёма между полкой/днищем и
 * полкой/крышкой), а НЕ высота двери: дверь накладная и перекрывает нишу с
 * обычным заходом на кромку соседней полки-перегородки. Сборщик и техника
 * (духовка/СВЧ) меряются по нише, поэтому она первична — высота двери
 * выводится из неё (tAdjFor ниже), а не наоборот. 0 — «взять остаток» (как
 * sec.facadeWidth === 0 значит «во всю секцию»): бюджет, оставшийся после
 * явных ниш (уже переведённых в дверные величины), делится поровну между
 * такими зонами. Если сумма получившихся дверных высот больше бюджета —
 * все зоны ужимаются пропорционально (тот же приём k = usable/sum, что и
 * выше в getDrawerHeights), с предупреждением.
 *
 * Совместимость: при ОДНОЙ зоне с height:0 возвращает ровно ту высоту,
 * что и старая формула doorZoneH = slotHeight - 2*gap.
 *
 * @return { heights, bottoms, partitions, nicheBottoms, nicheHeights }
 *   heights/bottoms — высоты и нижние границы ДВЕРЕЙ относительно slotBot
 *   (как раньше — этим пользуются построение реальных дверей и выравнивание
 *   по соседнему модулю). partitions[k] (k=0..N-2) — координата ЦЕНТРА
 *   несъёмной полки-перегородки на стыке зон k/k+1, тоже относительно
 *   slotBot. nicheBottoms[i]/nicheHeights[i] — нижняя граница и высота
 *   РЕАЛЬНОЙ ниши i-й зоны (то, что видит сборщик/встраиваемая техника) —
 *   в тех же относительных координатах.
 */
// edge = { lo, hi } — толщина панели у нижнего и верхнего края слота (дно секции и
// крыша). Если задана, высота ниши КРАЙНЕГО отсека — внутренний размер между
// верхней пластью дна (нижней полкой) и низом верхней полки (крыши), как её меряет
// сборщик (решение пользователя 2026-10-08). Без edge — как раньше (до внешней грани).
function layoutDoorZones(zones, slotHeight, gap, t, warn, secName, edge) {
  const N = zones.length;
  const eLo = (edge && Number(edge.lo)) || 0;
  const eHi = (edge && Number(edge.hi)) || 0;
  const usableBudget = Math.max(0, slotHeight - 2 * gap * N);
  // Крайняя зона (i===0 или i===N-1, только при N>1) граничит лишь с ОДНОЙ
  // полкой-перегородкой — с другой стороны край корпуса (днище/крышка), там
  // компенсация толщины вдвое меньше средней зоны, которая зажата между
  // двумя перегородками. При N===1 полок-перегородок нет вообще — ниша и
  // дверь совпадают один в один (компенсация 0), это тот самый случай
  // обратной совместимости из комментария выше.
  const tAdjFor = (i) => {
    if (N <= 1) return 0;
    let a = (i === 0 || i === N - 1) ? t / 2 : t;
    if (i === 0) a += eLo;
    if (i === N - 1) a += eHi;
    return a;
  };
  const explicit = zones.map((z, i) => {
    const niche = Math.max(0, Number(z.height) || 0);
    // Отсек только из ящиков с авто-высотой (z.fitDoorH — см. planZoneLayout):
    // высота подгоняется под стопку фасадов, а не берёт «остаток».
    if (!(niche > 0) && Number(z.fitDoorH) > 0) return Number(z.fitDoorH);
    return niche > 0 ? Math.max(0, niche - 2 * gap + tAdjFor(i)) : 0;
  });
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

  // Полки-перегородки и реальные ниши — производные от ТЕХ ЖЕ bottoms[],
  // что и двери, поэтому structurally не могут разойтись между собой (см.
  // комментарий у @return выше).
  const partitions = [];
  for (let k = 1; k < N; k++) partitions.push(bottoms[k] - gap);
  const nicheBottoms = [];
  const nicheHeights = [];
  for (let i = 0; i < N; i++) {
    const nb = i === 0 ? eLo : bottoms[i] - gap + t / 2;
    const nt = i === N - 1 ? slotHeight - eHi : bottoms[i + 1] - gap - t / 2;
    nicheBottoms.push(nb);
    nicheHeights.push(Math.max(0, nt - nb));
  }
  return { heights, bottoms, partitions, nicheBottoms, nicheHeights };
}

// Обратная операция для КРАЙНЕЙ зоны (граничит с корпусом с одной стороны, с
// полкой-перегородкой — с другой, см. tAdjFor в layoutDoorZones): переводит
// высоту ДВЕРИ обратно в высоту НИШИ, которую нужно записать в
// zones[i].height. Нужна там, где нижнюю зону подгоняют под фактическую
// высоту фасада соседней секции/модуля (findNeighborBottomZoneHeight в
// app.js возвращает именно высоту двери — для выравнивания видимой линии
// фасадов по ряду), а хранить приходится в поле, которое теперь означает
// нишу, а не дверь.
function nicheFromEdgeDoorHeight(doorHeight, t, gap) {
  const g = gap ?? 1.5;
  // Нижний отсек над дном секции (без ящиков): ниша — внутренний размер от верха дна,
  // поэтому к половине толщины полки добавляется толщина дна.
  return Math.max(0, Number(doorHeight) + 2 * g - t / 2 - t);
}

// ---------------------------------------------------------------------------
// ЯЩИКИ ВНУТРИ ОТСЕКА (решение пользователя 2026-10-07). У отсека многозонной
// секции (sec.doorZones[zi]) могут быть свои ящики: zone.drawers (0..8) и
// зональные аналоги настроек секции (drawerMode/drawerHeights/drawerSystem/
// drawerThickness/drawerOffset/drawerDecorCode/drawerFacadeType/
// drawerFacadeMaterial/drawerBoxHeight). Стопка ставится ОТ НИЗА НИШИ отсека;
// выше неё остаётся дверь/полки/штанга отсека. Секционные ящики (sec.drawers)
// работают как раньше, отсеки идут выше них.
const ZONE_DRAWER_OWN_KEYS = ['drawerSystem', 'drawerThickness', 'drawerOffset', 'drawerDecorCode',
  'drawerFacadeType', 'drawerFacadeMaterial', 'drawerBoxHeight', 'pushToOpen', 'drawerColor'];

// «Виртуальная секция» отсека: поля секции + поля ящиков/содержимого самого
// отсека — чтобы переиспользовать getDrawerHeights/drawerLift/buildDrawerBoxes.
// Режим и ручные высоты берутся ТОЛЬКО из отсека (у секции свои ящики).
function zoneDrawerSection(sec, z) {
  const zz = z || {};
  const appliance = zz.appliance || 'none';
  const n = appliance === 'none' ? Math.max(0, Math.min(8, Math.floor(Number(zz.drawers) || 0))) : 0;
  const defFacade = sec.facade === 'doorRight' ? 'doorRight' : 'doorLeft';
  const v = Object.assign({}, sec, {
    drawers: n, drawerMode: zz.drawerMode, drawerHeights: zz.drawerHeights,
    facade: zz.facade || defFacade,
    rod: zz.rod, rod2: zz.rod2, pantograph: zz.pantograph, shelves: zz.shelves,
    doorZoneCount: 1, doorZones: undefined,
  });
  for (const k of ZONE_DRAWER_OWN_KEYS) {
    if (zz[k] !== undefined && zz[k] !== null && zz[k] !== '') v[k] = zz[k];
  }
  return v;
}

/**
 * Раскладка отсеков секции С УЧЁТОМ ящиков отсеков. Единая точка для всех мест
 * модели (полки, штанга, ящики, фасады) — раскладка не может разойтись.
 *
 * Отсек, в котором ТОЛЬКО ящики (facade 'open', нет полок/штанги/пантографа) и
 * высота ниши авто (0), подгоняется под стопку (типовая высота фасада, как у
 * секции, либо заданные вручную) — а не берёт «остаток». Остальные отсеки с
 * ящиками получают стопку внутри своей двери-эквивалента (heights[zi]); выше —
 * то, что задано в отсеке.
 *
 * @return { layout, stacks[zi] } stacks[zi] — null либо
 *   { heights, sum, virt, p0 } — p0: нижняя граница стопки фасадов
 *   относительно slotBot (= bottoms[zi] - gap).
 */
function planZoneLayout(sec, slotHeight, gap, t, drawerUnitH, warnLayout, warnStack, secName, edge) {
  const N = Number(sec.doorZoneCount);
  const zones = [];
  const virts = [];
  for (let zi = 0; zi < N; zi++) {
    const z = (sec.doorZones && sec.doorZones[zi]) || {};
    const virt = zoneDrawerSection(sec, z);
    virts.push(virt);
    const desc = { height: Number(z.height) || 0, appliance: z.appliance || 'none' };
    if (virt.drawers > 0 && !(desc.height > 0) && virt.facade === 'open'
      && !virt.rod && !virt.pantograph && !(Number(virt.shelves) > 0)) {
      const typ = getDrawerHeights(Object.assign({}, virt, { facade: 'doorLeft' }), drawerUnitH, 1e6, null, '');
      // typ — высоты ящиков С зазорами (как у секции), а fitDoorH — высота двери-
      // эквивалента без них: стопка отсека ниже занимает fitDoorH + 2·gap.
      desc.fitDoorH = typ.reduce((s, v) => s + v, 0) - 2 * gap;
    }
    zones.push(desc);
  }
  const layout = layoutDoorZones(zones, slotHeight, gap, t, warnLayout, secName, edge);
  const stacks = zones.map((d, zi) => {
    const virt = virts[zi];
    if (!(virt.drawers > 0) || !(layout.heights[zi] > 0)) return null;
    const label = `${secName}, отсек ${zi + 1}`;
    // Высота ящика — вместе с зазором gap сверху и снизу (фасад = высота − 2·gap),
    // как у секции, где стопка занимает весь фронт. Дверь отсека layout.heights[zi]
    // — уже БЕЗ зазоров, поэтому стопке отдаём её + 2·gap: верх верхнего фасада
    // ложится вровень с дверью/соседними секциями, а стык отсеков — gap·2, не gap·4.
    const avail = layout.heights[zi] + 2 * gap;
    const heights = getDrawerHeights(virt, drawerUnitH, avail, warnStack, label);
    return { heights, avail, sum: heights.reduce((s, v) => s + v, 0), virt, p0: layout.bottoms[zi] - gap };
  });
  return { layout, stacks, zones };
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
// Рекомендованные высоты по типу одежды, мм: ось штанги над опорой (дно секции / полка / нижняя штанга).
// Для пантографа — расстояние от оси его трубы вниз до полки под ним (решение пользователя 2026-10-06).
// Минимальный просвет между плоскостями соседних полок при перетаскивании в 3D, мм.
const SHELF_DRAG_CLEAR = 40;
const ROD_CLOTHES_HEIGHT = { long: 1500, mid: 1300, short: 1000 };

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
  const needDepth = Math.round(sys.minCorpusDepth ? sys.minCorpusDepth(NL) : NL + 3);
  if (needDepth > o.innerDepth) {
    // Даже наименьшая длина направляющих системы не помещается — по глубине ящик
    // этой системы поставить нельзя (геометрия строится по nl[0], чтобы модель не ломалась).
    o.warnings.push(`${o.secName}: ящик такой системы в этот корпус не встаёт: минимальная длина направляющих ${NL} мм, `
      + `нужна глубина внутри ≥ ${needDepth} мм (сейчас ${Math.round(o.innerDepth)} мм). Выберите другую систему.`);
  }

  // Толщина дна короба нужна ещё до подбора высоты: у Quadro дно из ЛДСП
  // (16–18 мм), у остальных ХДФ (3 мм), и от этого зависит, какой короб влезет.
  const botChip = sys.bottom === 'chipboard';
  const botMat = botChip ? o.drawerDecor : o.back;
  const BOT = sys.metal ? o.drawerT : (botChip ? o.drawerT : o.backT);
  // ВЫСОТА КОРОБА над его нижней отметкой. У обычного короба дно лежит ПОД
  // стенками, и полная высота = дно + стенка. У надвижного (boxStyle 'ledge')
  // боковины опущены ниже дна и дно стоит МЕЖДУ ними — полная высота равна
  // самой боковине, дно в неё входит. Раньше дно прибавлялось всегда, и у
  // Quadro надвижного короб выходил на 16 мм ниже, чем помещается (верхний
  // ящик 150 вместо 160 при просвете до планок 38 мм).
  const BOT_ABOVE = sys.boxStyle === 'ledge' ? 0 : BOT;

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
    // Просвет над верхним коробом до крышки/столешницы/планки: 5 мм
    // (решение пользователя 2026-10-08, для всех систем; было 25, потом 10), чтобы короб
    // можно было сделать выше.
    const TOP_GAP = 5;
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
      if (BOT_ABOVE + picked.h > availTop) {
        o.warnings.push(`${o.secName}, ящик ${i + 1}: короб ${picked.code} не помещается `
          + `по высоте — не хватает ${Math.round(BOT_ABOVE + picked.h - availTop)} мм.`);
      }
      if (BOT_ABOVE + picked.h > maxBoxTotal) {
        o.warnings.push(`${o.secName}, ящик ${i + 1}: короб ${picked.code} выше фасада `
          + `меньше чем на ${BELOW_FRONT} мм — фасад должен перекрывать короб сверху.`);
      }
    } else if (sys.metal) {
      const fit = sys.heights.filter((h) => h.minFront <= frontH
        && BOT_ABOVE + h.h <= availTop && BOT_ABOVE + h.h <= maxBoxTotal);
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
      const maxByPitch = Math.min(maxBoxTotal - BOT_ABOVE, availTop - BOT_ABOVE);
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
    if (o.boxInfo) o.boxInfo.push({ index: i, h: hh.h, code: hh.code, nl: NL, reling: hh.reling || 0,
      bot: BOT, metal: !!sys.metal });
    // ОСЬ КОРПУСНОГО ПРОФИЛЯ НАПРАВЛЯЮЩЕЙ:
    //   • металлическая царга (TANDEMBOX, LEGRABOX, InnoTech) — по низу царги;
    //   • СКРЫТЫЕ направляющие (Hettich Quadro) — ПОД ДНОМ короба: профиль
    //     живёт в зазоре под ящиком, поэтому крепёж идёт на уровне дна, а не
    //     по середине боковины;
    //   • шариковые боковые — по середине боковины короба, там и профиль.
    const hiddenRunner = !sys.metal && sys.bottom === 'chipboard';
    // Скрытые направляющие Quadro: ось шурупа в боковине корпуса — на 42 мм
    // над ВНУТРЕННИМ дном корпуса (37 мм по чертежу Hettich от низа профиля
    // + 5 мм зазор профиля над дном; решение пользователя 2026-10-04). Для
    // следующих ящиков отметка растёт вместе с их положением (y − baseY).
    const runnerFromFloor = (hiddenRunner && sys.runnerFromFloor && Number.isFinite(o.innerBottomY))
      ? o.innerBottomY + sys.runnerFromFloor + (y - o.baseY) : null;
    if (o.runnerYs) {
      o.runnerYs.push(round1(runnerFromFloor != null ? runnerFromFloor
        : y + (sys.metal ? 20 : (hiddenRunner ? BOT / 2 : BOT + hh.h / 2))));
    }
    if (o.runnerNLs) o.runnerNLs.push(NL);

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
        const bigger = sys.biggerSideSystem && cat.DRAWER_SYSTEMS[sys.biggerSideSystem];
        o.warnings.push(`${o.secName}: боковина ящика ${o.drawerT} мм при `
          + `ограничении ${sys.maxBoxSide} мм для этой серии направляющих — `
          + (bigger ? `выберите систему «${bigger.name}» или уменьшите толщину.`
                    : 'уменьшите толщину.'));
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
          // Позиции — от ПЕРЕДНЕГО торца боковины ящика по схеме производителя
          // (sys.boxHoles, GTV: 36 мм до первого, дальше шаг зависит от NL).
          // Локальный x детали отсчитывается от ЗАДНЕГО торца, поэтому NL − pos.
          const boxPos = sys.boxHoles ? sys.boxHoles(NL) : [36, 36 + 224];
          for (const fp of boxPos.filter((v) => v < NL - 20)) {
            holes.push({ x: round1(NL - fp), y: runY, d: RUN_D, depth: RUN_DEPTH,
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
      // ПЕРЕДНЯЯ несёт фасад: через неё изнутри идут шурупы (по два ряда у
      // высокого ящика, по одному у низкого), поэтому на ней сквозная
      // присадка — иначе фасад держится только по низу и «клюёт» носом.
      const FIX_IN = 32;                       // отступ от кромок стенки
      const FIX_TWO_ROWS_FROM = 120;           // высота стенки, с которой ряда два
      // ОТСТУП ШУРУПА ОТ УГЛА КОРОБА — 50 мм от торца передней стенки на ВСЕХ
      // ящиках (было 40). Ось эксцентрика — в 34 мм от торца, гнездо Ø15: при
      // 40 мм шуруп у низкого ящика цеплял гнездо. Отступ одинаковый для любой
      // обычной ширины; нижний предел лишь не даёт двум шурупам сойтись в одну
      // точку у совсем узкой стенки (короче 140 мм отступ уже меньше 50).
      const FIX_SETBACK = 50;
      const fixSpreadX = Math.max(20, (boxW - 2 * o.drawerT) / 2 - FIX_SETBACK);
      // Два ряда шурупов — при высоте стенки ящика ≥ 120 мм, иначе ОДИН по
      // центру высоты. Ряды считаем от ПЕРЕДНЕЙ СТЕНКИ (panelY/panelH), а не
      // от низа боковин: у надвижного короба стенка на 28 мм ниже боковин, и
      // нижний шуруп раньше оказывался в 4 мм от нижней кромки стенки.
      const fixRows = sideH >= FIX_TWO_ROWS_FROM
        ? [FIX_IN, round1(panelH - FIX_IN)]
        : [round1(panelH / 2)];
      // ТОЧКИ КРЕПЛЕНИЯ ФАСАДА — в мировых координатах. По ним сверлится и
      // стенка короба, и сам фасад: считать их отдельно для каждой детали
      // нельзя, отверстия расходятся и фасад не сесть.
      const fixWorld = [];
      for (const ry of fixRows) {
        for (const sx of [-1, 1]) {
          fixWorld.push({ x: round1(o.secCenterX + sx * fixSpreadX), y: round1(panelY + ry) });
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
          // Ось — в bp.overBottom мм от нижней плоскости дна (Hettich: 11), а не
          // по середине толщины: tz считается от центра дна вверх.
          botHoles.push({ x: 0, y: yLoc, d: bp.d, depth: bp.depth,
                          through: false, side: 'edge', kind: 'runnerPinRear',
                          tz: round1(bp.overBottom - BOT / 2) });
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
    maxTop = Math.max(maxTop, y + BOT_ABOVE + hh.h);
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

// Ссылка на ручку двери для перетаскивания в 3D: вертикальная или горизонтальная
// скоба и кнопка (половина длины по вертикали — только у вертикальной). Привязки (snaps) и диапазон
// достраивает applyHandleSnaps, когда положение всех ручек уже известно.
function makeHandleRef(dh, si, zi, leaf, doorY, H, p, ft, faceX, W, hingeSide) {
  if (!dh.count || dh.mounts.length !== 1) return null;
  const m = dh.mounts[0];
  const edge = doorHandleEdge(ft.frame);
  const hx = (!m.vertical && m.cc) ? m.cc / 2 : 0;   // полудлина горизонтальной скобы
  // По X ручка описывается расстоянием c от её центра до ДАЛЬНЕГО от петель
  // края двери (farRight — дальний край справа, т.е. петли слева).
  return { si, zi, leaf, faceBottomY: doorY - H / 2, floorOffset: Number(p.mountBottom) || 0,
    H, edge, half: m.vertical ? m.cc / 2 : 0, manual: !!dh.manual,
    yMin: 0, yMax: 0, snaps: [],
    W, faceLeftX: faceX - W / 2, farRight: hingeSide === 'left', hx,
    c0: round1(hingeSide === 'left' ? W - m.cx : m.cx),
    cMin: round1(edge + hx), cMax: round1(Math.max(edge + hx, Math.min(W - edge - hx, W / 2))), xSnaps: [] };
}
// Привязки при перетаскивании ручки: верх (крайнее отверстие в edge мм от
// верхнего торца двери), низ, середина двери и высота любой другой ручки модуля.
// y — центр ручки в координатах модуля, как box.y у детали-ручки.
function applyHandleSnaps(parts) {
  const hs = parts.filter((r) => r.kind === 'handle' && r.handleRef);
  if (!hs.length) return;
  for (const r of hs) {
    const f = r.handleRef;
    const lo = f.faceBottomY + f.edge + f.half, hi = f.faceBottomY + f.H - f.edge - f.half;
    f.yMin = round1(lo); f.yMax = round1(hi);
    f.snaps = [{ kind: 'bottom', y: round1(lo) }, { kind: 'center', y: round1(f.faceBottomY + f.H / 2) },
      { kind: 'top', y: round1(hi) }];
    if (!(hi >= lo)) { r.handleRef = null; continue; }
    // По X: дальний от петель край, центр двери и положение соседних ручек
    f.xSnaps = [{ kind: 'far', c: f.cMin }];
    if (f.W / 2 >= f.cMin && f.W / 2 <= f.cMax) f.xSnaps.push({ kind: 'center', c: round1(f.W / 2) });
    const seen = [], seenX = [];
    for (const o of hs) {
      if (o === r) continue;
      const y = o.box.y;
      if (!(y < lo - 0.5 || y > hi + 0.5 || seen.some((v) => Math.abs(v - y) < 0.5))) {
        seen.push(y);
        f.snaps.push({ kind: 'abs', y: round1(y) });
      }
      const c = round1(f.farRight ? f.faceLeftX + f.W - o.box.x : o.box.x - f.faceLeftX);
      if (c < f.cMin - 0.5 || c > f.cMax + 0.5 || f.xSnaps.some((v) => Math.abs(v.c - c) < 0.5)
        || seenX.some((v) => Math.abs(v - c) < 0.5)) continue;
      seenX.push(c);
      f.xSnaps.push({ kind: 'abs', c });
    }
  }
}

// Данные перетаскивания полки над стопкой ящиков (секции или отсека): тянут — меняется
// суммарная высота S фасадов n ящиков, они делятся поровну (ручной режим). Минимум
// высоты ящика — minFront самой низкой царги выбранной системы (или заданной царги).
function drawerStackDrag(kind, owner, n, S) {
  const sys = window.Modul3D.catalog.DRAWER_SYSTEMS[owner.drawerSystem || 'ballBearing'];
  const want = owner.drawerBoxHeight && owner.drawerBoxHeight !== 'auto'
    ? sys.heights.filter((h) => h.code === String(owner.drawerBoxHeight))[0] : null;
  return { kind, stack: true, n, S: round1(S), minFront: (want || sys.heights[0]).minFront };
}

// Привязки при перетаскивании полки: уровни полок ДРУГИХ секций модуля (чтобы
// полки соседних секций можно было поставить на одну линию), попавшие в
// допустимый диапазон. Уровни — центр полки (как box.y), в координатах модуля.
function applyShelfSnaps(parts) {
  const shelves = parts.filter((r) => r.kind === 'shelf');
  for (const r of shelves) {
    const f = r.shelfRef;
    if (!f) continue;
    f.snaps = [];
    for (const o of shelves) {
      if (o === r || o.section === r.section) continue;
      const y = round1(o.box.y);
      if (y < f.yMin - 0.05 || y > f.yMax + 0.05 || f.snaps.some((v) => Math.abs(v - y) < 0.5)) continue;
      f.snaps.push(y);
    }
  }
}

// ВЫРАВНИВАНИЕ РУЧЕК БОЛЬШИХ ДВЕРЕЙ ПО СЕКЦИИ С ОТСЕКАМИ (решение
// пользователя 2026-10-06). Ручка большой (неделёной) двери может стоять на
// высоте 850–1000 мм от пола (центр ручки). Если в модуле есть секция, поделённая
// на отсеки, ручки больших дверей встают на высоту ручки её отсека. Кандидаты:
//   • ручка отсека у своего места, если её центр уже в диапазоне 850–1000;
//   • иначе ручку отсека, примыкающего к этому уровню, поднимают к верхнему
//     краю фасада (верхнее отверстие в edge мм от края, как у нижнего отсека),
//     если центр после подъёма попадает в диапазон.
// Из кандидатов берётся ближайший к 1000 мм. Нет подходящих — всё как было.
const HANDLE_ALIGN_MIN = 850, HANDLE_ALIGN_MAX = 1000;
function registerDoorHandle(reg, dh, zoneCount, wallHung, floorY, H, hStart, hEnd, edge) {
  if (!dh.count || !dh.mounts.length) return;
  const m0 = dh.mounts[0];
  const cy = dh.mounts.reduce((a, m) => a + m.cy, 0) / dh.mounts.length;
  const rec = { floorY, H, hStart, hEnd, doorIdx: hEnd, cy };
  if (zoneCount > 1) {
    if (!dh.manual && !wallHung && Number.isFinite(floorY) && m0.cc && m0.vertical && dh.mounts.length === 1) {
      rec.altCy = H - edge - m0.cc / 2;       // ручка у верхнего края фасада
    }
    reg.divided.push(rec);
    return;
  }
  // «Уровень руки» — те же условия, что в handleLevel; горизонтальную скобу не трогаем
  if (wallHung || !Number.isFinite(floorY) || floorY + H <= 1100 || floorY >= 1200) return;
  if (m0.cc && !m0.vertical) return;
  if (dh.manual) return;                // вручную поставленную ручку не двигаем
  reg.big.push(rec);
}
function shiftHandle(parts, b, delta) {
  const door = parts[b.doorIdx];
  if (!door || door.kind !== 'door') return;
  (door.holes || []).filter((h) => h.kind === 'handle').forEach((h) => { h.y = round1(h.y + delta); });
  for (let k = b.hStart; k < b.hEnd; k++) parts[k].box.y = round1(parts[k].box.y + delta);
}
function alignBigDoorHandles(reg, parts) {
  const inRange = (c) => c >= HANDLE_ALIGN_MIN && c <= HANDLE_ALIGN_MAX;
  const cands = [];
  for (const d of reg.divided) {
    if (inRange(d.floorY + d.cy)) cands.push({ c: d.floorY + d.cy, d, lift: false });
    else if (d.altCy !== undefined && inRange(d.floorY + d.altCy)) cands.push({ c: d.floorY + d.altCy, d, lift: true });
  }
  if (!cands.length || !reg.big.length) return;
  const target = Math.max.apply(null, cands.map((x) => x.c));
  // отсек(ы) с поднятой ручкой (у двустворчатой — обе створки)
  cands.filter((x) => x.lift && Math.abs(x.c - target) < 0.5)
    .forEach((x) => shiftHandle(parts, x.d, x.d.altCy - x.d.cy));
  for (const b of reg.big) {
    const door = parts[b.doorIdx];
    if (!door || door.kind !== 'door') continue;
    const hh = (door.holes || []).filter((h) => h.kind === 'handle');
    if (!hh.length) continue;
    const lo = Math.min.apply(null, hh.map((h) => h.y));
    const hi = Math.max.apply(null, hh.map((h) => h.y));
    const EDGE = 30;                   // отверстие не ближе 30 мм к торцу двери
    const delta = Math.min(Math.max(target - (b.floorY + b.cy), EDGE - lo), b.H - EDGE - hi);
    if (Math.abs(delta) >= 0.05) shiftHandle(parts, b, delta);
  }
}

// Высота ручки на двери в координатах фасада. Считается от ПОЛА, поэтому
// у соседних фасадов разной высоты ручки оказываются на одном уровне.
const HAND_LEVEL = 1000;     // уровень руки от пола, мм
function handleLevel(o, H, edge) {
  // Навесной (верхний) модуль — ручка ВСЕГДА у нижнего края фасада, вне
  // зависимости от отметки (решение пользователя 2026-09-26).
  if (o.wallHung) return edge;
  const bottom = Number(o.floorY);           // низ фасада от пола
  if (!Number.isFinite(bottom)) return H > 900 ? H / 2 : H - edge;
  const top = bottom + H;
  if (top <= 1100) return H - edge;   // низкий фасад — берут сверху
  if (bottom >= 1200) return edge;    // навесной — берут снизу
  return Math.min(Math.max(HAND_LEVEL - bottom, edge), H - edge);
}

// РУЧНОЕ ПОЛОЖЕНИЕ РУЧКИ ДВЕРИ (перетаскивание в 3D, решение пользователя
// 2026-10-06). override: { mode: 'top'|'bottom'|'center'|'abs', floor } —
// 'abs' хранит высоту центра ручки от ПОЛА, остальные режимы привязаны к самой
// двери. Крайнее отверстие ближе edge к торцу двери не ставим. null — нет правки.
function manualHandleCy(ov, H, edge, half, floorY) {
  if (!ov) return null;
  const lo = edge + half, hi = H - edge - half;
  if (!(hi >= lo)) return null;
  let cy;
  if (ov.mode === 'top') cy = hi;
  else if (ov.mode === 'bottom') cy = lo;
  else if (ov.mode === 'center') cy = H / 2;
  else if (ov.mode === 'abs' && Number.isFinite(Number(ov.floor)) && Number.isFinite(floorY)) cy = Number(ov.floor) - floorY;
  else return null;
  return Math.min(Math.max(cy, lo), hi);
}
// То же по ширине: override.xMode 'far'|'center'|'abs', xd — расстояние от центра
// ручки до ДАЛЬНЕГО от петель края двери (для 'abs'). hx — полудлина горизонтальной
// скобы (крайнее отверстие не ближе edge к торцам). null — по X правки нет.
function manualHandleCd(ov, W, edge, hx) {
  if (!ov || !ov.xMode) return null;
  // Со стороны петель ручку не монтируем — дальше середины двери не пускаем
  const lo = edge + hx, hi = Math.max(lo, Math.min(W - edge - hx, W / 2));
  if (!(hi >= lo)) return null;
  let c;
  if (ov.xMode === 'far') c = lo;
  else if (ov.xMode === 'center') c = W / 2;
  else if (ov.xMode === 'abs' && Number.isFinite(Number(ov.xd))) c = Number(ov.xd);
  else return null;
  return Math.min(Math.max(c, lo), hi);
}
const HANDLE_SNAP_R = 40;   // радиус примагничивания ручки при перетаскивании, мм
function handleOverrideOf(p, si, zi, leaf) {
  const all = p.handleOverrides;
  return (all && all[si + '|' + zi + '|' + leaf]) || null;
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
  let manual = false;          // положение задано вручную (перетаскиванием)
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
    let cx = o.hingeSide === 'left' ? W - edge : edge;
    const MIN_EDGE = 12;                       // минимум от отверстия до торца

    // Ориентация скобы: по умолчанию на двери вертикально, но можно поставить
    // и горизонтально — тогда ручка идёт вдоль верхнего края.
    const horizontal = h.holes === 2 && o.orient === 'horizontal';
    // Ручное положение по ширине (перетаскивание в 3D): центр ручки.
    const ovC = manualHandleCd(o.override, W, edge, horizontal ? h.cc / 2 : 0);
    if (ovC !== null) { cx = o.hingeSide === 'left' ? W - ovC : ovC; manual = true; }

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
      if (isUpperZone || o.wallHung) {
        // Зона пенала выше нижней или навесной модуль (решение пользователя
        // 2026-09-26: у верхних модулей ручки дверей всегда внизу фасада).
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
      // Ручное положение (перетаскивание в 3D) — поверх всех правил выше.
      const ovCy = manualHandleCy(o.override, H, edge, half, floorY);
      if (ovCy !== null) { bottom = ovCy - half; top = ovCy + half; manual = true; }
      const cy = (top + bottom) / 2;
      mounts.push({ cx: round1(cx), cy: round1(cy), cc: h.cc, vertical: true });
      holes.push({ x: round1(cx), y: round1(bottom), d: D, through: true, kind: 'handle' });
      holes.push({ x: round1(cx), y: round1(top), d: D, through: true, kind: 'handle' });
    } else if (horizontal) {
      // ГОРИЗОНТАЛЬНО: ручка вдоль верхнего края, ближним отверстием
      // в edge мм от края открывания.
      let cy = Math.min(Math.max(handleLevel(o, H, edge), MIN_EDGE), H - MIN_EDGE);
      // Ручное положение (перетаскивание в 3D): горизонтальная скоба — «толщиной»
      // в одну линию, поэтому отступ от торцов двери считаем до самой оси (half = 0).
      const ovCy = manualHandleCy(o.override, H, edge, 0, Number(o.floorY));
      if (ovCy !== null) { cy = ovCy; manual = true; }
      // ccx — центр скобы; ближнее к дальнему краю отверстие — на cc/2 дальше от центра
      const ccx = ovC !== null ? cx : (o.hingeSide === 'left' ? W - edge - h.cc / 2 : edge + h.cc / 2);
      const near = o.hingeSide === 'left' ? ccx + h.cc / 2 : ccx - h.cc / 2;
      const far = o.hingeSide === 'left' ? near - h.cc : near + h.cc;
      mounts.push({ cx: round1(ccx), cy: round1(cy), cc: h.cc, vertical: false });
      holes.push({ x: round1(Math.min(near, far)), y: round1(cy), d: D, through: true, kind: 'handle' });
      holes.push({ x: round1(Math.max(near, far)), y: round1(cy), d: D, through: true, kind: 'handle' });
    } else {
      let cy = Math.min(Math.max(handleLevel(o, H, edge), MIN_EDGE), H - MIN_EDGE);
      const ovCy = h.holes === 1 ? manualHandleCy(o.override, H, edge, 0, Number(o.floorY)) : null;
      if (ovCy !== null) { cy = ovCy; manual = true; }
      mounts.push({ cx: round1(cx), cy: round1(cy), cc: 0, vertical: false });
      holes.push({ x: round1(cx), y: round1(cy), d: D, through: true, kind: 'handle' });
    }
  }

  // отверстия не должны вылезать за деталь
  const bad = holes.filter((p) => p.x < 8 || p.x > W - 8 || p.y < 8 || p.y > H - 8);
  return { holes, mounts, handle: h, count, overflow: bad.length > 0, manual };
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
      handleRef: o.ref || null,
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
// facadeMat — проектное поле «Материал фасада» (p.facadeMat, 2026-09-26):
// декор ЛДСП-фасада по умолчанию, когда у секции нет своего
// sec.facadeMaterial. С «Видимой боковиной» (p.facadeDecor) больше НЕ связано.
// Берётся только если это ЛДСП (см. ldspFacadeDefault); не задано или это
// МДФ/стекло — декор корпуса.
function facadeTypeOf(sec, decor, t, facadeMat, facadeThickness) {
  const cat = window.Modul3D.catalog;
  const id = sec.facadeType || (sec.glass ? 'glass4' : 'ldsp');
  const ft = cat.FACADE_TYPES[id] || cat.FACADE_TYPES.ldsp;
  const isDefault = ft.id === 'ldsp';
  const fdec = ldspFacadeDefault(facadeMat || decor, decor);
  // Алюминиевая рамка: ширина рамки — из профиля, заполнение — из секции,
  // стеклянные полки внутри — только если заполнение стекло (с глухим
  // заполнением-плитой торцы корпуса скрыты, как у обычного фасада).
  const alu = ft.id === 'alu' ? aluFacadeOf(sec) : null;
  // Материал фасада секции/отсека (sec.facadeMaterial, 2026-09-26) — только
  // у ldsp/mdf/glass4; нет/невалиден → умолчание вида (см. facadeMaterialPick).
  const pick = facadeMaterialPick(ft.id, sec.facadeMaterial, fdec.code);
  return {
    id: ft.id, name: ft.name, render: ft.render,
    frame: alu ? alu.frameW : (ft.frame || 0),
    insert: alu ? alu.fill : (ft.insert || null),
    glassInside: alu ? alu.fillType === 'glass' : !!ft.glassInside,
    // ЛДСП-фасад режется из декора проекта (или выбранного в секции декора),
    // МДФ/стекло — из выбранного материала, прочие — из своего материала.
    material: pick ? pick.code : (isDefault ? fdec.code : ft.material),
    // Толщина ЛДСП-фасада настраивается отдельно от корпуса (t — запасное
    // значение для старых сохранений без facadeThickness); у МДФ/стекла —
    // толщина выбранного материала (нет — из FACADE_TYPES); у прочих —
    // своя, из каталога (alu — глубина профиля).
    thickness: isDefault ? (Number(facadeThickness) || t)
      : (pick && pick.thickness ? pick.thickness
        : (alu && alu.depth ? alu.depth : ft.thickness)),
    edged: ft.render === 'panel',
    alu,
  };
}

// Фасады ящиков секции (решение владельца 2026-10-05, Focus Mode): у ящиков
// СВОЙ вид и материал — sec.drawerFacadeType / sec.drawerFacadeMaterial, один
// на все ящики секции. Допустимы только ЛДСП, МДФ и деревянный фасад (алюминий,
// стекло и фрезерованный МДФ для ящиков не годятся). Не задано (или вид не из
// списка) — фасады ящиков, как и раньше, повторяют вид секции (обратная
// совместимость старых проектов и «обычного» режима).
const DRAWER_FACADE_TYPES = ['ldsp', 'mdf', 'wood'];
function drawerFacadeTypeOf(sec, decor, t, facadeMat, facadeThickness) {
  const own = sec && sec.drawerFacadeType;
  if (!own || DRAWER_FACADE_TYPES.indexOf(own) < 0) return facadeTypeOf(sec, decor, t, facadeMat, facadeThickness);
  const eff = Object.assign({}, sec, { facadeType: own, facadeMaterial: sec.drawerFacadeMaterial });
  delete eff.glass;
  return facadeTypeOf(eff, decor, t, facadeMat, facadeThickness);
}

// ---------------------------------------------------------------------------
// МАТЕРИАЛ ФАСАДА СЕКЦИИ/ОТСЕКА (sec.facadeMaterial, решение 2026-09-26)
// Допустимые материалы по виду фасада — из Библиотеки (catalog.js):
//   ldsp   — ЛДСП/ДСП: DECORS (categoryPath[0] 'ДСП' или без категории) и
//            FACADE_MATERIALS с categoryPath[0] 'ДСП';
//   mdf    — МДФ-плиты: DECORS/FACADE_MATERIALS с categoryPath[0] 'МДФ-плита'
//            (включая шпонированные);
//   glass4 — стекло: categoryPath[0] 'Стекло' или код GLASS-*, плюс cat.GLASS.
// Прочие виды (mdfMilled, wood, woodGlass, alu) материал из секции не берут.
// Умолчание: ldsp — проектный «Материал фасада» (facadeMat), mdf — FAC-MDF, glass4 — GLASS-4.
// ---------------------------------------------------------------------------
const FACADE_MATERIAL_KINDS = { ldsp: 'ldsp', mdf: 'mdf', glass4: 'glass' };
// Тип листа ('mdf'|'veneer'|'ldsp'|null) по самой позиции: любой сегмент пути,
// название, источник. Используется ТОЛЬКО чтобы один раз проставить
// item.matKind (см. app.js libStampMatKinds) — дальше тип хранится в позиции
// и от названия раздела не зависит (раздел можно назвать хоть «1»).
function inferMatKind(m) {
  if (!m) return null;
  const cp = Array.isArray(m.categoryPath) ? m.categoryPath : [];
  const txt = cp.join(' ') + ' ' + (m.name || '') + ' ' + (m.sourceName || '') + ' ' + (m.sourceUrl || '');
  if (cp[0] === 'Стекло' || /^GLASS/i.test(String(m.code || ''))) return 'glass';
  if (cp[0] === 'Алюминий' || m.code === 'FAC-ALU') return 'alu';
  if (/шпон|veneer/i.test(txt)) return 'veneer';
  if (/мдф|mdf/i.test(txt)) return 'mdf';
  if (cp[0] === 'ДСП' || /дсп|dsp/i.test(txt)) return 'ldsp';
  return null;
}
function facadeMaterialKind(m) {
  if (!m) return null;
  if (isGlassMaterial(m)) return 'glass';
  const mk = m.matKind || inferMatKind(m);
  if (mk === 'mdf' || mk === 'veneer') return 'mdf';
  if (mk === 'ldsp') return 'ldsp';
  return null;
}
// Для UI: [{ code, name, thickness }] — допустимые материалы вида фасада
// (пусто — у вида выбора материала нет).
function facadeMaterialOptions(facadeTypeId) {
  const cat = window.Modul3D.catalog;
  const kind = FACADE_MATERIAL_KINDS[facadeTypeId];
  if (!kind) return [];
  const out = [];
  const seen = {};
  const push = (m) => {
    if (!m || !m.code || seen[m.code]) return;
    seen[m.code] = true;
    out.push({ code: m.code, name: m.name || m.code,
      thickness: Number(m.thickness) > 0 ? Number(m.thickness) : null });
  };
  (cat.DECORS || []).forEach((m) => {
    const cp = Array.isArray(m.categoryPath) ? m.categoryPath : [];
    // Декор корпуса без категории — старые/пользовательские позиции ЛДСП.
    const k = facadeMaterialKind(m) || (cp.length ? null : 'ldsp');
    if (k === kind) push(m);
  });
  Object.values(cat.FACADE_MATERIALS || {}).forEach((m) => {
    if (facadeMaterialKind(m) === kind) push(m);
  });
  if (kind === 'glass' && cat.GLASS) push(cat.GLASS);
  return out;
}
// { code, thickness } материала фасада вида ftId; null — вид без выбора
// материала. defLdspCode — код проектного «Материала фасада» (умолчание ldsp).
function facadeMaterialPick(ftId, code, defLdspCode) {
  const cat = window.Modul3D.catalog;
  if (!FACADE_MATERIAL_KINDS[ftId]) return null;
  const opts = facadeMaterialOptions(ftId);
  const o = code ? opts.find((x) => x.code === code) : null;
  if (o) return { code: o.code, thickness: o.thickness };
  // Умолчание берём как есть, даже если его нет в списке (проектный декор
  // может быть любым листом — как было до выбора материала в секции).
  const defCode = ftId === 'ldsp' ? defLdspCode : ((cat.FACADE_TYPES[ftId] || {}).material);
  const m = aluFillMaterial(defCode);
  return { code: defCode, thickness: m && Number(m.thickness) > 0 ? Number(m.thickness) : null };
}
// ---------------------------------------------------------------------------
// ВИДИМАЯ БОКОВИНА (решение пользователя 2026-09-26): «не важно, какой фасад
// выберет пользователь, материал видимых боковин должен выбрать
// пользователь». Видимая боковина и цоколь ВСЕГДА режутся из проектного
// facadeDecor (поле «Видимая боковина»), при любом виде фасада секции.
// Допустимы листовые ЛДСП/ДСП и фасадные МДФ-панели.
// ---------------------------------------------------------------------------
// Минимальная толщина листа видимой боковины, мм (решение пользователя
// 2026-09-26; крепёж корпуса — минификс Rastex в пласть боковины).
// Материалы тоньше (или без толщины в каталоге) в список выбора
// поля «Видимая боковина» не попадают; в старом проекте с уже выбранным
// тонким листом выбор не сбрасывается — только предупреждение ядра.
const VISIBLE_SIDE_MIN_T = 16;
// Для UI: [{ code, name, thickness }] — что можно выбрать в «Видимую боковину».
function visibleSideMaterialOptions() {
  const out = facadeMaterialOptions('ldsp').slice();
  const seen = {};
  out.forEach((o) => { seen[o.code] = true; });
  facadeMaterialOptions('mdf').forEach((o) => { if (!seen[o.code]) { seen[o.code] = true; out.push(o); } });
  return out.filter((o) => Number(o.thickness) >= VISIBLE_SIDE_MIN_T);
}
// Для UI экрана «Деталь» (фокусный режим, точечная правка материала ОДНОЙ
// детали — решение пользователя 2026-09-26): [{ code, name, thickness }] —
// листы, которыми можно заменить деталь вида kind (OVERRIDABLE_KINDS).
// Все листы DECORS (кроме стекла) + ЛДСП/МДФ-панели FACADE_MATERIALS
// (Библиотека: «Листовые материалы» и «Двери»); задней стенке —
// ТОЛЬКО BACK_MATERIALS. Только позиции с толщиной в каталоге (она подставляется в
// thicknessOverride детали). Стекло, алюм. профиль и массив на заказ в
// корпусную деталь не годятся — их нет. Боковине — не тоньше
// VISIBLE_SIDE_MIN_T (крепёж корпуса в пласть боковины, как у «Видимой боковины»).
function partMaterialOptions(kind) {
  const cat = window.Modul3D.catalog;
  const out = [];
  const seen = {};
  const push = (m) => {
    if (!m || !m.code || seen[m.code] || isGlassMaterial(m)) return;
    const th = Number(m.thickness);
    if (!(th > 0)) return;
    seen[m.code] = true;
    out.push({ code: m.code, name: m.name || m.code, thickness: th });
  };
  // Задней стенке — ТОЛЬКО BACK_MATERIALS (ХДФ/ДВП): лист ЛДСП/МДФ 16–19 мм
  // не входит в паз под стенку (ширина паза tb+0,5, resolveBackMount) и
  // залезает внутрь корпуса у накладной стенки.
  if (kind === 'back') {
    (cat.BACK_MATERIALS || []).forEach(push);
    return out;
  }
  (cat.DECORS || []).forEach(push);
  Object.values(cat.FACADE_MATERIALS || {}).forEach((m) => {
    const k = facadeMaterialKind(m);
    if (k === 'ldsp' || k === 'mdf') push(m);
  });
  return kind === 'side' ? out.filter((o) => o.thickness >= VISIBLE_SIDE_MIN_T) : out;
}
// Материал видимой боковины/цоколя: { code, name, kind, thickness }.
// thickness — РЕАЛЬНАЯ толщина выбранного листа из каталога для любого
// материала (ЛДСП 18,6 → 18,6; МДФ 19 → 19; решение 2026-09-26). Поле
// «Видимая боковина» пусто или у листа нет толщины — корпусная t.
// fdec — объект каталога.
function visibleSideMaterialOf(fdec, decor, t) {
  const m = fdec || decor;
  const kind = facadeMaterialKind(m) === 'mdf' ? 'mdf' : 'ldsp';
  const th = fdec && Number(fdec.thickness) > 0 ? Number(fdec.thickness) : t;
  return { code: m.code, name: kind === 'mdf' ? 'МДФ' : 'ЛДСП', kind, thickness: th };
}
// Умолчание ЛДСП-фасада — проектный «Материал фасада» (facadeMat), но только
// если это ЛДСП: ЛДСП-фасад из МДФ-/стекло-кода (с толщиной и кромкой ЛДСП)
// был бы неверен — тогда декор корпуса.
function ldspFacadeDefault(fdec, decor) {
  const k = facadeMaterialKind(fdec);
  return (k === 'mdf' || k === 'glass') ? decor : fdec;
}

// Для UI: материал фасада секции/отсека так, как его построит ядро.
// sec — эффективные настройки (для отсека — zoneFacadeSettings(sec, zi));
// proj — { decor, facadeMat, facadeThickness, t } (decor/facadeMat —
// объект каталога или код). → { code, name, thickness, facadeType }.
function facadeMaterialOf(sec, proj) {
  const cat = window.Modul3D.catalog;
  const pr = proj || {};
  const asObj = (d) => (d && typeof d === 'object') ? d
    : (d ? (aluFillMaterial(d) || { code: d }) : null);
  const decor = asObj(pr.decor) || (typeof cat.defaultDecor === 'function' ? cat.defaultDecor() : (cat.DECORS || [])[0]) || { code: '' };
  const fdec = asObj(pr.facadeMat) || decor;
  const t = Number(pr.t) || Number(decor.thickness) || 18;
  const ft = facadeTypeOf(sec || {}, decor, t, fdec, pr.facadeThickness);
  const m = aluFillMaterial(ft.material);
  return { code: ft.material, name: (m && m.name) || ft.material || '', thickness: ft.thickness, facadeType: ft.id };
}

// Для UI и ядра: эффективная толщина ЛДСП ящика секции — независимая от
// толщины корпуса величина (короб ящика режут отдельно, см.
// ПРАВИЛА-КОНСТРУИРОВАНИЯ.md, «Материал короба»): sec.drawerThickness →
// проектная p.drawerThickness → 16 мм. НЕ падает на bodyThickness корпуса —
// раньше падал (баг, толщина ящика молча становилась равной толщине
// корпуса, например 18 мм вместо 16), см. исправление 2026-09-29.
function effectiveDrawerThickness(sec, proj) {
  return Number(sec && sec.drawerThickness) || Number(proj && proj.drawerThickness) || 16;
}

// Эффективные настройки фасада отсека (дверной зоны) = поля зоны поверх
// полей секции, только ключи фасада (ZONE_FACADE_KEYS). Зоны действуют лишь
// при doorZoneCount > 1 (как и сама раскладка зон в buildModuleParts); зона
// хранится в sec.doorZones[zi]. zoneIdx вне диапазона / null → копия секции.
// Фасады ящиков — всегда по секции (у ящиков зон нет).
const ZONE_FACADE_KEYS = ['facadeType', 'facadeMaterial', 'aluProfile', 'aluColor', 'aluFill', 'aluPriceMode', 'aluMaker'];
function zoneFacadeSettings(sec, zoneIdx) {
  const s = sec || {};
  const out = Object.assign({}, s);
  const multi = zonesOn(s);
  const z = multi && zoneIdx !== null && zoneIdx !== undefined ? s.doorZones[zoneIdx] : null;
  if (!z || typeof z !== 'object') return out;
  const has = (k) => z[k] !== undefined && z[k] !== null && z[k] !== '';
  for (const k of ZONE_FACADE_KEYS) if (has(k)) out[k] = z[k];
  // Вид сменён в зоне, а материал не задан — материал секции от другого
  // вида не переносим (станет умолчанием вида зоны).
  if (has('facadeType') && z.facadeType !== s.facadeType && !has('facadeMaterial')) delete out.facadeMaterial;
  return out;
}

// ---------------------------------------------------------------------------
// АЛЮМИНИЕВЫЙ РАМОЧНЫЙ ФАСАД (facadeType 'alu'), решения пользователя
// 2026-09-25 (ПРАВИЛА-КОНСТРУИРОВАНИЯ.md §4):
//   • профиль не кромится (facadeEdgeType → null);
//   • размер заполнения (решение 2026-09-26) — по паспорту профиля:
//     заполнение = фасад − 2·fillStop − fillGap (fillStop — от наружного края
//     профиля до дна паза с каждой стороны, fillGap — общий зазор на размер);
//     null в fillStop или fillGap → размер null («уточняйте по паспорту»);
//   • петля 'aluFrame' — Blum CLIP top 95° для алюм. рамок: вместо чашки паз
//     под механизм + 2 отверстия под саморезы (aluHingeCuts); 'standard' —
//     чашка Ø35 как у всех фасадов;
//   • количество петель — стандартное.
// Параметры секции (для старых сохранений без них — умолчания ниже):
//   sec.aluProfile   — код из catalog.ALU_PROFILES (по умолч. ALU_PROFILE_ORDER[0])
//   sec.aluColor     — id из ALU_PROFILE_COLORS (по умолч. первый из
//                      ALU_PROFILE_COLOR_ORDER; старые id — ALU_LEGACY_COLOR_IDS)
//   sec.aluFill      — код материала заполнения: стекло или плита (по умолч. 'GLASS-4')
//   sec.aluPriceMode — 'buy' (покупной, по умолч.) | 'own' (собственное изготовление)
//   sec.aluMaker     — id из ALU_MAKERS (по умолч. ALU_MAKER_ORDER[0])
// ---------------------------------------------------------------------------
// Петля для узкой алюм. рамки — Blum CLIP top 95° (каталог Blum, DQDMBY; решение
// пользователя 2026-09-26): крепится к профилю на саморезы из комплекта, чашку Ø35
// в профиле не сверлим — вместо неё паз под пружинный механизм и 2 отверстия
// под саморезы (размеры — ALU_FRAME_EXTRAS.hinge.mount в catalog.js, см.
// aluHingeCuts ниже).
const ALU_HINGE_NOTE = 'Петля Blum CLIP top 95° для алюм. рамок — на саморезы по паспорту Blum: '
  + 'паз под механизм + 2 отверстия под саморезы вместо чашки Ø35';
const ALU_DEFAULT_FILL = 'GLASS-4';
// Цвета до перехода на палитру Tehmob (2026-09-26) → новые id, чтобы старые
// сохранения открывались с близким цветом, а не падали.
const ALU_LEGACY_COLOR_IDS = { silver: 'alu', gold: 'goldMat', black: 'blackMat', champagne: 'goldMat' };
// Число из паспорта профиля: null/''/нечисло → null (неизвестно).
function aluNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Материал заполнения по коду: декоры/задняя стенка/фасадные материалы
// (findMaterialByCode) плюс стекло полок GLASS, которого там нет.
function aluFillMaterial(code) {
  const cat = window.Modul3D.catalog;
  if (!code) return null;
  const m = cat.findMaterialByCode ? cat.findMaterialByCode(code) : null;
  if (m) return m;
  if (cat.GLASS && cat.GLASS.code === code) return cat.GLASS;
  return null;
}
// Стекло ли материал: категория «Стекло» Библиотеки или код GLASS-*.
function isGlassMaterial(m) {
  if (!m) return false;
  if (m.matKind) return m.matKind === 'glass';   // тип хранится в позиции (app.js libStampMatKinds)
  return inferMatKind(m) === 'glass';
}

function aluFacadeOf(sec) {
  const cat = window.Modul3D.catalog;
  const s = sec || {};
  const profiles = cat.ALU_PROFILES || {};
  const pOrder = cat.ALU_PROFILE_ORDER || Object.keys(profiles);
  const profileCode = profiles[s.aluProfile] ? s.aluProfile : (pOrder[0] || null);
  const prof = (profileCode && profiles[profileCode]) || {};
  const colors = cat.ALU_PROFILE_COLORS || {};
  const allowed = Array.isArray(prof.colors) && prof.colors.length ? prof.colors : null;
  const legacy = ALU_LEGACY_COLOR_IDS[s.aluColor];
  const wantColor = colors[s.aluColor] ? s.aluColor : (legacy && colors[legacy] ? legacy : null);
  let color = wantColor && (!allowed || allowed.indexOf(wantColor) !== -1) ? wantColor : null;
  if (!color) {
    color = (allowed ? allowed.find((c) => colors[c]) : null)
      || (cat.ALU_PROFILE_COLOR_ORDER || []).find((c) => colors[c]) || Object.keys(colors)[0] || null;
  }
  const colorItem = (color && colors[color]) || {};
  let fill = s.aluFill && aluFillMaterial(s.aluFill) ? s.aluFill : ALU_DEFAULT_FILL;
  const typeOfFill = (code) => {
    const it = aluFillMaterial(code);
    return isGlassMaterial(it) || (!it && /^GLASS/i.test(code)) ? 'glass' : 'sheet';
  };
  // Профиль принимает только свой вид заполнения (prof.fillType, напр. у
  // Tehmob — стекло 4 мм с уплотнителем): чужой (старое сохранение) → умолчание
  // для стекла, как и список заполнений в UI (app.js aluFillOptions).
  if (prof.fillType === 'glass' && typeOfFill(fill) !== 'glass') fill = ALU_DEFAULT_FILL;
  // Толщина заполнения задана паспортом профиля (Tehmob: 4 мм с уплотнителем) —
  // материал другой толщины в паз не встаёт → умолчание (UI его и не предлагает).
  const needT = Number(prof.fillThickness) > 0 ? Number(prof.fillThickness) : null;
  const fillT = Number((aluFillMaterial(fill) || {}).thickness);
  if (needT && fillT > 0 && fillT !== needT) fill = ALU_DEFAULT_FILL;
  const fillItem = aluFillMaterial(fill);
  const fillType = typeOfFill(fill);
  const makers = cat.ALU_MAKERS || {};
  const mOrder = cat.ALU_MAKER_ORDER || Object.keys(makers);
  const maker = makers[s.aluMaker] ? s.aluMaker : (mOrder[0] || null);
  const fillStop = aluNum(prof.fillStop);
  const fillGap = aluNum(prof.fillGap);
  const fillThickness = Number(prof.fillThickness) > 0 ? Number(prof.fillThickness)
    : (fillItem && Number(fillItem.thickness) > 0 ? Number(fillItem.thickness) : null);
  const ftAlu = (cat.FACADE_TYPES && cat.FACADE_TYPES.alu) || {};
  return {
    profile: profileCode,
    profileName: prof.name || '',
    color,
    colorName: colorItem.name || '',
    colorHex: colorItem.hex || null,
    fill,
    fillName: (fillItem && fillItem.name) || fill,
    fillType,
    fillThickness,
    fillStop, fillGap,
    kind: prof.kind === 'closed' || prof.kind === 'open' ? prof.kind : null,
    // Видимая ширина рамки: из профиля; нет данных — запасная FACADE_TYPES.alu.frame
    frameW: Number(prof.width) > 0 ? Number(prof.width) : (Number(ftAlu.frame) || 0),
    // Толщина фасада = толщина профиля по паспорту; нет данных — FACADE_TYPES.alu.thickness
    depth: Number(prof.depth) > 0 ? Number(prof.depth) : (Number(ftAlu.thickness) || null),
    priceMode: s.aluPriceMode === 'own' ? 'own' : 'buy',
    maker,
    hinge: prof.hinge === 'standard' ? 'standard' : 'aluFrame',
  };
}

// Петлю «для алюминиевой рамки» не сверлим чашкой (см. блок выше) — вместо
// неё aluHingeCuts.
function aluSkipsHingeCup(ft) {
  return !!(ft && ft.alu && ft.alu.hinge === 'aluFrame');
}

// Присадка под Blum CLIP top 95° для алюм. рамок (71T950A) на двери с профилем
// hinge 'aluFrame'. Оси петель по высоте и их число — те же, что у обычной
// чашки (hingeHoles: 100 мм от торцов, обход полок/верхней планки). На каждую
// петлю, с тыльной стороны, в координатах детали (x — по ширине двери от её
// левого края, y — по высоте от нижнего торца):
//   • паз под пружинный механизм — в part.grooves, формат как у паза под
//     заднюю стенку (ось x0,y0→x1,y1, ширина w): ось вдоль рамки длиной
//     slotH по центру оси петли, w = slotW поперёк рамки; паз от ВНУТРЕННЕГО
//     края рамки (frameW от наружного края со стороны петель) наружу;
//   • 2 отверстия Ø screwD насквозь с фаской до Ø screwCsk — в part.holes,
//     по ±screwPitch/2 от оси петли, в screwFromInner от внутреннего края рамки.
// Ширина рамки вне паспортных rbMin..rbMax (или нет данных mount) —
// присадку не ставим, предупреждаем. Возвращает { holes, grooves }.
function aluHingeCuts(W, H, hingeSide, frameW, shelves, warn, secName, railBottom) {
  const hinge = ((window.Modul3D.catalog.ALU_FRAME_EXTRAS || {}).hinge) || {};
  const m = hinge.mount || null;
  const out = { holes: [], grooves: [] };
  const name = `${hinge.name || 'Петля для алюм. рамок'}${hinge.article ? ` (${hinge.article})` : ''}`;
  if (!m || !(m.slotW > 0) || !(m.slotH > 0) || !(m.screwD > 0) || !(m.screwPitch > 0)
      || !(m.screwFromInner > 0)) {
    if (warn) warn(`${secName}: ${name} — нет паспортных размеров присадки, отверстия под петлю не поставлены.`);
    return out;
  }
  const fw = Number(frameW);
  if (!(fw > 0) || (Number.isFinite(m.rbMin) && fw < m.rbMin) || (Number.isFinite(m.rbMax) && fw > m.rbMax)) {
    if (warn) {
      warn(`${secName}: ${name} ставится на рамку шириной ${m.rbMin}–${m.rbMax} мм, `
        + `а у профиля ${fw > 0 ? fw : '—'} мм — присадка под петлю не поставлена, подберите другую петлю или профиль.`);
    }
    return out;
  }
  // Оси петель — ровно как у обычной двери (без стеклянного варианта).
  const axes = hingeHoles(W, H, hingeSide, shelves, warn, secName, false, railBottom).map((h) => h.y);
  const left = hingeSide === 'left';
  // Расстояние от наружного края двери (со стороны петель) → x детали.
  const X = (fromOuter) => round1(left ? fromOuter : W - fromOuter);
  const xScrew = X(fw - m.screwFromInner);
  const xSlot = X(fw - m.slotW / 2);
  const half = m.screwPitch / 2;
  for (const y of axes) {
    out.grooves.push({
      kind: 'aluHingeSlot', x0: xSlot, y0: round1(y - m.slotH / 2), x1: xSlot, y1: round1(y + m.slotH / 2),
      w: m.slotW, depth: m.wall || null, throughWall: true, side: 'back', hingeY: round1(y),
      note: `Паз ${m.slotW}×${m.slotH} под механизм петли ${hinge.article || ''}`.trim(),
    });
    for (const dy of [-half, half]) {
      // «насквозь» — сквозь тыльную стенку профиля (m.wall), а не через всю толщину фасада со стеклом
      out.holes.push({ x: xScrew, y: round1(y + dy), d: m.screwD, depth: m.wall || 0, through: false, throughWall: true,
        csk: m.screwCsk || null, cskAngle: m.screwCskAngle || null,
        side: 'back', kind: 'aluHingeScrew', hingeY: round1(y) });
    }
  }
  return out;
}

// Размер заполнения (стекла) алюм. фасада W×H, мм:
//   заполнение = фасад − 2·fillStop − fillGap (ПРАВИЛА §4, 2026-09-26).
// a — результат aluFacadeOf(). null в fillStop/fillGap → { fillW: null, fillH: null }.
function aluFillDims(a, W, H) {
  const known = !!a && a.fillStop !== null && a.fillGap !== null;
  const fw = known ? round1(W - 2 * a.fillStop - a.fillGap) : null;
  const fh = known ? round1(H - 2 * a.fillStop - a.fillGap) : null;
  return { fillW: fw > 0 ? fw : null, fillH: fh > 0 ? fh : null };
}
// Для UI: размер заполнения по параметрам секции и габариту фасада.
function aluFillSize(sec, W, H) {
  return aluFillDims(aluFacadeOf(sec), Number(W), Number(H));
}

// Поля детали-фасада, зависящие от типа фасада (frameW/insertMaterial/glass
// и у 'alu' — описание рамки aluFrame для 3D/чертежей/сметы). W×H — габарит
// фасада, мм (длина × ширина детали).
function facadePartFields(ft, W, H) {
  if (!ft.alu) {
    return { frameW: ft.frame, insertMaterial: ft.insert, glass: ft.render === 'glass' };
  }
  const a = ft.alu;
  const { fillW, fillH } = aluFillDims(a, W, H);
  return {
    frameW: a.frameW,
    insertMaterial: a.fill,
    glass: a.fillType === 'glass',
    aluFrame: {
      profile: a.profile, kind: a.kind, color: a.color, colorHex: a.colorHex,
      fill: a.fill, fillType: a.fillType, fillThickness: a.fillThickness,
      fillW, fillH,
      perimeterMm: round1(2 * (W + H)),
      corners: ((window.Modul3D.catalog.ALU_FRAME_EXTRAS || {}).corner || {}).perFacade || 4,
      seal: a.fillType === 'glass',
      priceMode: a.priceMode, maker: a.maker, hinge: a.hinge,
    },
  };
}

// Торец детали корпуса (боковина/дно/крыша/полка/стойка), обращённый к
// фасаду секции, СКРЫТ (не виден снаружи), если у секции есть фасад И этот
// фасад не стеклянный — сквозь стекло видно то, что за ним (см.
// ПРАВИЛА-КОНСТРУИРОВАНИЯ.md §4). Секция без фасада (открытая) — торец
// всегда виден.
// Отсеки с разными фасадами (sec.doorZones[i].facadeType и т.п.): торец скрыт,
// только если НИ за одним фасадом секции (зоны с дверью/фасадом ящиков по
// секции) не стекло — консервативно: торец один на всю высоту секции.
function sectionFrontHidden(sec, decor, t, facadeMat, facadeThickness) {
  if (!sectionHasAnyFacade(sec)) return false;
  return !sectionGlassInside(sec, decor, t, facadeMat, facadeThickness);
}
// Есть ли стекло хоть за одним фасадом секции: сама секция (фасады ящиков и
// однозонная дверь) или любая дверная зона, у которой реально есть фасад.
function sectionGlassInside(sec, decor, t, facadeMat, facadeThickness) {
  const multi = zonesOn(sec);
  if (!multi) return facadeTypeOf(sec, decor, t, facadeMat, facadeThickness).glassInside;
  if (Number(sec.drawers) > 0
    && facadeTypeOf(sec, decor, t, facadeMat, facadeThickness).glassInside) return true;
  for (let zi = 0; zi < sec.doorZoneCount; zi++) {
    const z = sec.doorZones[zi] || {};
    if ((z.facade || 'doorLeft') === 'open' || applianceNicheOnly(z.appliance)) continue;
    if (facadeTypeOf(zoneFacadeSettings(sec, zi), decor, t, facadeMat, facadeThickness).glassInside) return true;
  }
  return false;
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

// isShelf — несъёмная полка на Rastex: до 500 мм глубины два крепежа, свыше
// 500 — три (решение пользователя 2026-10-06; у полки 450 три — перебор).
function jointPoints(depth, isShelf) {
  const a = JOINT_SETBACK, b = depth - JOINT_SETBACK;
  // Узкая деталь (например планка 100 мм) — один крепёж по центру: два
  // с отступом 50 мм от каждого края сошлись бы в одну точку.
  if (b - a < 32) return [round1(depth / 2)];
  const n = depth <= (isShelf ? 500 : 400) ? 2 : (depth <= 700 ? 3 : 4);
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
    // Алюминиевый рамочный фасад (facadeType 'alu'): профиль/цвет/заполнение/
    // режим цены — см. facadePartFields(). null у всех прочих деталей.
    aluFrame: o.aluFrame || null,
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
    pantographColor: o.pantographColor || null, // цвет пантографа секции (null — как в Библиотеке)
    cc: o.cc || 0,                 // межосевое ручки — по нему стоят её ножки
    // Ручка двери, которую можно перетащить в 3D (см. HANDLE_SNAP_R, pushHandleParts
    // и applyHandleSnaps): { si, zi, leaf, faceBottomY, floorOffset, H, edge, half,
    // manual, yMin, yMax, snaps:[{kind,y}] } — y в координатах модуля. null — не двигается.
    handleRef: o.handleRef || null,
    // Полка, которую можно перетащить в 3D (ортогональный вид без фасадов, см.
    // applyShelfSnaps и viewer.js _initShelfDrag): { kind:'partition'|'zone'|'sec',
    // si, zi, k, y, yMin, yMax, snaps:[y] } — y в координатах модуля. null — не двигается.
    shelfRef: o.shelfRef || null,
    // Присадка: отверстия в системе координат детали (левый нижний угол
    // лицевой стороны), готовые к выгрузке на станок.
    holes: o.holes || [],
    // ПАЗЫ: прямые канавки в системе координат детали. Нужны станку так же,
    // как отверстия: x0,y0 → x1,y1 — ось паза, w — ширина, depth — глубина.
    grooves: o.grooves || [],
    // СКВОЗНЫЕ ПРЯМОУГОЛЬНЫЕ ВЫРЕЗЫ у кромки детали: [{ kind, x0, y0, x1, y1,
    // note }] в той же системе координат детали (x — по длине, y — по
    // ширине). Сейчас — вырезы задней стенки под крюк навески верхнего
    // модуля (kind 'hangerBackCut', см. applyWallHanger) и выпил под
    // монтажную шину в невидимой боковине навесного модуля (kind
    // 'railNotch', см. applyRailNotch). Площадь листа и кромка детали от
    // выреза не меняются (лист режется целым прямоугольником).
    notches: o.notches || [],
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
// ИСКЛЮЧЕНИЕ — боковины корпуса (решение пользователя 2026-09-26): их
// толщина из thicknessOverride / листа materialOverride учитывается ЕЩЁ ПРИ
// СБОРКЕ (buildModuleParts: sideT → tL/tR) — наружная грань на ±W/2,
// боковина растёт/худеет внутрь, дно/крыша/секции/присадка подгоняются.
// Здесь для боковины толщина уже совпадает, предупреждение не выводится.
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

// bm — режим задней стенки модуля (resolveBackMount): нужен для проверки
// толщины задней стенки с ручной правкой против ширины паза.
function applyPartOverrides(parts, partOverrides, warnings, bm) {
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
      // Боковина сюда с другой толщиной не попадает (см. комментарий выше).
      const isLoadBearing = part.kind === 'bottom' || part.kind === 'top';
      if (isLoadBearing) {
        warnings.push(`${part.name}: толщина переопределена вручную на ${ov.thicknessOverride} мм `
          + `(проектная — ${part.thickness} мм) — сопряжение с соседними деталями `
          + `(посадочные места дна/крышки/цоколя) не пересчитывается автоматически, проверьте стык.`);
      }
      // Задняя стенка толще проектной: в паз (ширина bm.w = tb+0,5) не
      // войдёт; накладная — выступит назад/внутрь корпуса сильнее расчётного.
      if (part.kind === 'back') {
        const grooved = bm && bm.mode === 'groove';
        const limit = grooved ? bm.w : part.thickness;
        if (ov.thicknessOverride > limit) {
          warnings.push(grooved
            ? `${part.name}: толщина переопределена вручную на ${ov.thicknessOverride} мм — `
              + `больше ширины паза под стенку (${limit} мм): стенка в паз не войдёт, `
              + `выберите материал задней стенки не толще ${part.thickness} мм.`
            : `${part.name}: толщина переопределена вручную на ${ov.thicknessOverride} мм `
              + `(проектная — ${limit} мм) — габарит модуля по глубине и посадка стенки `
              + `не пересчитываются автоматически, проверьте стык.`);
        }
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

// ---------------------------------------------------------------------------
// НАПРАВЛЕНИЕ ТЕКСТУРЫ (декоры с рисунком).
//
// Правило «Авто» (решение пользователя 2026-09-23):
//   • вертикальные детали — боковины, стойки, двери/фальш-планки — текстура
//     вдоль оси Y модуля (вертикально), первая цифра деталировки = размер
//     по высоте;
//   • горизонтальные — дно, крыша, полки — вдоль оси X модуля (по ширине
//     корпуса), первая цифра = размер по ширине корпуса;
//   • исключения — фасады ящиков, детали ящика, цоколь: вдоль длины, то есть
//     вдоль БОЛЬШЕЙ из двух сторон, она же первая цифра;
//   • столешница — вдоль оси X модуля (вдоль поля «Длина», как у дна).
// Оси привязаны к каркасу модуля: повернули модуль — оси повернулись вместе
// с ним, текстура относительно корпуса не меняется. Задняя стенка, стекло,
// МДФ и декоры без рисунка (белый/чёрный, камень) направления не имеют.
//
// Ручное переключение «Поперёк» поворачивает текстуру на 90° и меняет местами
// Длину и Ширину (и кромки L1/L2 ↔ S1/S2, чтобы кромка осталась на тех же
// торцах) — только в ДЕТАЛИРОВКЕ (part.cutLength/cutWidth/cutEdging).
// part.length/width/edging/holes остаются в геометрической системе детали:
// присадка и DXF для ЧПУ от них зависят и не меняются.
// Приоритет: настройка детали (mod.grainOverrides) → группы проекта
// (proj.grainGroups) → «Авто».
// ---------------------------------------------------------------------------
const GRAIN_GROUPS = [
  { id: 'facade',     label: 'Фасады' },
  { id: 'side',       label: 'Боковины' },
  { id: 'divider',    label: 'Стойки' },
  { id: 'shelf',      label: 'Полки' },
  { id: 'bottom',     label: 'Дно' },
  { id: 'top',        label: 'Крыша' },
  { id: 'plinth',     label: 'Цоколь' },
  { id: 'drawer',     label: 'Детали ящика' },
  { id: 'countertop', label: 'Столешница' },
];
// axis: 'y' | 'x' — ось модуля, вдоль которой идёт текстура в «Авто»;
// 'long' — вдоль большей из двух сторон детали.
const GRAIN_RULE_BY_KIND = {
  side:         { group: 'side',       axis: 'y' },
  divider:      { group: 'divider',    axis: 'y' },
  door:         { group: 'facade',     axis: 'y' },
  filler:       { group: 'facade',     axis: 'y' },
  drawerFront:  { group: 'facade',     axis: 'long' },
  bottom:       { group: 'bottom',     axis: 'x' },
  top:          { group: 'top',        axis: 'x' },
  shelf:        { group: 'shelf',      axis: 'x' },
  plinth:       { group: 'plinth',     axis: 'long' },
  drawerSide:   { group: 'drawer',     axis: 'long' },
  drawerBottom: { group: 'drawer',     axis: 'long' },
  drawerBack:   { group: 'drawer',     axis: 'long' },
  countertop:   { group: 'countertop', axis: 'x' },
};

// Есть ли у детали рисунок, у которого бывает направление: не стекло, не МДФ
// (плёнка/эмаль — гладкий), декор с рисунком (catalog.decorHasPattern). Тот же
// критерий, что «ldspLike» при выборе текстуры во viewer.js.
function partHasGrainPattern(part) {
  if (part.hardware || part.glass) return false;
  // МДФ (плёнка/эмаль), стекло и алюминиевый профиль — гладкие, рисунка нет.
  if (part.facadeType === 'mdf' || part.facadeType === 'mdfMilled'
    || part.facadeType === 'glass4' || part.facadeType === 'alu') return false;
  if (/^GLASS/i.test(part.material || '')) return false;
  const cat = window.Modul3D.catalog;
  return cat.decorHasPattern ? cat.decorHasPattern(part.material) : true;
}

// Расставляет на деталях модуля поля направления текстуры (см. блок выше).
// Вызывается на «чистом» списке деталей модуля: box.w/h/d — в собственной
// системе модуля (w — по X, h — по Y, d — по Z), до поворота в прогоне.
// localDims — необязательный пересчёт box в эту систему для деталей, которые
// строятся уже в мировой системе (угловая фальш-планка).
// Поля детали:
//   grainGroup, grainKey   — группа и ключ настройки детали (для UI);
//   grainOverride          — 'along' | 'across' | null (правка этой детали);
//   grainGroupMode         — 'auto' | 'across' (настройка группы проекта);
//   grainAcross            — итог: текстура повёрнута поперёк «Авто»;
//   grainAxis              — 'x'|'y'|'z' ось модуля, вдоль которой идёт текстура
//                            (только у деталей с рисунком);
//   grainRule, grainLenOnBase — служебные, для finalizeGrainDisplay.
// Ключ = kind|section|side|индекс в группе — как у applyPartOverrides, поэтому
// после добавления/удаления полки в секции правка остаётся за номером полки.
function applyGrainDirection(parts, groups, overrides, localDims) {
  const counters = new Map();
  for (const part of parts) {
    const rule = GRAIN_RULE_BY_KIND[part.kind];
    if (!rule || part.hardware) continue;
    const gk = [part.kind, part.section || '', partOverrideSide(part) || ''].join('|');
    const index = counters.get(gk) || 0;
    counters.set(gk, index + 1);
    part.grainGroup = rule.group;
    part.grainKey = gk + '|' + index;
    const ov = overrides && overrides[part.grainKey];
    part.grainOverride = (ov === 'along' || ov === 'across') ? ov : null;
    part.grainGroupMode = (groups && groups[rule.group] === 'across') ? 'across' : 'auto';
    part.grainAcross = part.grainOverride
      ? part.grainOverride === 'across'
      : part.grainGroupMode === 'across';
    part.grainDirection = false;
    if (!partHasGrainPattern(part)) continue;

    const b = localDims ? localDims(part.box) : part.box;
    const dims = { x: b.w, y: b.h, z: b.d };
    const axes = ['x', 'y', 'z'];
    // Толщина листа — самая малая сторона бокса; текстура лежит в плоскости
    // пласти, то есть на двух других осях.
    const thick = axes.reduce((a, c) => (dims[c] < dims[a] ? c : a));
    const plane = axes.filter((a) => a !== thick);
    let base = rule.axis;
    let kindRule = 'fixed';
    if (base === 'long' || base === thick) {
      kindRule = 'long';
      base = dims[plane[0]] >= dims[plane[1]] ? plane[0] : plane[1];
    }
    const other = plane.find((a) => a !== base);
    part.grainRule = kindRule;
    part.grainAxis = part.grainAcross ? other : base;
    part.grainDirection = true;
    // Лежит ли поле «Длина» вдоль базовой оси — по ближайшему размеру бокса
    // (допуски на паз и т.п. не мешают: они на миллиметры, а не на сторону).
    const d = dims[base];
    part.grainLenOnBase = Math.abs(d - part.length) <= Math.abs(d - part.width);
  }
}

// ФИНАЛЬНЫЙ проход по всем деталям проекта — после сборки модулей и слияния
// цоколей/столешниц (у слитых деталей длина уже итоговая) и до склейки
// одинаковых деталей в деталировку. Считает, надо ли показать Длину и Ширину
// в деталировке местами, и кладёт итог в part.cutLength/cutWidth/cutEdging
// (у деталей без направления они равны length/width/edging).
function finalizeGrainDisplay(parts) {
  for (const part of parts) {
    let swap = false;
    if (part.grainAxis) {
      if (part.grainRule === 'long') {
        // «Авто» — первой большая сторона; «Поперёк» — первой меньшая.
        // Равные стороны не переставляем.
        swap = part.grainAcross ? part.length > part.width : part.length < part.width;
      } else {
        // Первая цифра — размер вдоль текстуры: если «Длина» не вдоль неё,
        // цифры меняются местами.
        swap = part.grainLenOnBase ? part.grainAcross : !part.grainAcross;
      }
    }
    const e = part.edging || {};
    part.grainSwap = swap;
    part.cutLength = swap ? part.width : part.length;
    part.cutWidth = swap ? part.length : part.width;
    part.cutEdging = swap
      ? { long1: e.short1 || null, long2: e.short2 || null, short1: e.long1 || null, short2: e.long2 || null }
      : { long1: e.long1 || null, long2: e.long2 || null, short1: e.short1 || null, short2: e.short2 || null };
    if (part.grainKey !== undefined) {
      part.grainLabel = part.grainAxis
        ? (part.grainAcross ? 'вдоль длины (повёрнута)' : 'вдоль длины')
        : 'нет';
    }
  }
}

// Резолвер материала столешницы модуля (вынесен из buildModuleParts, чтобы
// тем же правилом пользоваться и в buildModel — см. skipTopPanelOf/resolveBackMount).
function countertopMatOf(ct) {
  const cat = window.Modul3D.catalog;
  // 1) готовая позиция каталога столешниц (CTOP-...) — СВОЙ резолвер,
  //    отдельно от общего findMaterialByCode() (см. catalog.js) — карточки
  //    столешниц не должны быть доступны там, где ожидается обычный лист
  //    декора корпуса/фасада, и наоборот. Проверяется ПЕРВОЙ, независимо
  //    от ct.double — готовая позиция каталога (ЛДСП38 постформинг/
  //    компакт-плита) уже готовый товар фиксированной конструкции,
  //    «сдвоение» для неё конструктивно бессмысленно и всегда
  //    игнорируется (isDouble всегда false для этой ветки), даже если
  //    галочка «Сдвоенная» случайно осталась включённой с прошлого выбора
  //    материала (юзер сначала поставил галочку у декора, потом сменил
  //    материал на готовую позицию, не сняв галочку) — подтверждено
  //    владельцем-мебельщиком 2026-09-07.
  const ctCat = ct.decorCode ? cat.findCountertopMaterialByCode(ct.decorCode) : null;
  if (ctCat) {
    return { found: true, code: ctCat.code, name: ctCat.name,
      isDouble: false, thickness: ctCat.thickness, depth: ctCat.depth, maxLength: ctCat.maxLength || null };
  }
  // 2) обычный лист декора из общей библиотеки материалов — DECORS,
  //    FACADE_MATERIALS (объект, не массив) или BACK_MATERIALS, БЕЗ
  //    копирования между ними (см. app.js: libPickMaterial/
  //    findAnyMaterialByCode — та же тройка, что уже ищет specification.js
  //    для листовых материалов, см. там `known`). Толщина — строго из
  //    каталожной записи (dec.thickness), поле «Толщина» на панели
  //    столешницы убрано ещё 2026-09-06.
  const dec = ct.decorCode ? cat.findMaterialByCode(ct.decorCode) : null;
  if (!dec) return { found: false, reason: 'noDecor' };
  const th = Number(dec.thickness) || 0;
  if (!(th > 0)) return { found: false, reason: 'noThickness' };
  if (ct.double) {
    // «Сдвоенная» — два склеенных листа ИМЕННО этого декора (dec,
    // резолвнутого из ct.decorCode выше) — того, что пользователь выбрал
    // кнопкой «Изменить» на панели столешницы, а НЕ общий декор корпуса
    // всего проекта (p.decor/decor). Исправлено 2026-09-07 по замечанию
    // владельца-мебельщика: раньше здесь ошибочно брались decor.code/
    // decor.name/decor.sheetW (декор корпуса), из-за чего название,
    // толщина и максимальная длина цельного куска не совпадали с реально
    // выбранным на панели материалом. thickness — толщина ОДНОГО листа
    // этого декора (число, не null, как было раньше) — ctResolvedThickness/
    // ctThickness ниже читают именно её (2×thickness), а не 2×t (толщину
    // корпуса). depth: null, как и у «своего материала» ниже — это не
    // готовая позиция каталога фиксированной глубины, глубина столешницы
    // считается от глубины корпуса модуля D (см. ctWidth ниже по файлу).
    return { found: true, code: dec.code, name: `${dec.name} (сдвоенное 2×, столешница)`,
      isDouble: true, thickness: th, depth: null, maxLength: dec.sheetW || null };
  }
  // Толщина ≤18мм (не толще стандартной корпусной ЛДСП) технически строится
  // — клеится по всей площади к цельной крышке корпуса (см. skipTopPanel
  // ниже, растикс в торец боковины только при >18). Способ крепления уже
  // однозначно указан в note самой детали «Столешница» ниже (клей vs
  // растикс) — отдельного предупреждения тут нет.
  return { found: true, code: dec.code, name: `${dec.name} (столешница, ${th} мм)`,
    isDouble: false, thickness: th, depth: null, maxLength: dec.sheetW || null };
}

// Целевая глубина столешницы модуля (от задней стены до фасада) — либо
// ручное переопределение p.countertop.depth (одно на связку стыкующихся
// тумб, см. resolveCountertopChainDepths в buildModel — при смене там пишется
// сразу во все модули связки, как и decorCode), либо фиксированная глубина
// готовой позиции каталога (ctMat.depth). null — нет фиксированной цели: свой
// материал/сдвоенная без переопределения, свес по-прежнему только вручную
// через overhangBack, как и раньше. ЕДИНЫЙ источник для autoOverhangBack ниже
// И для resolveCountertopChainDepths — иначе глубина «крайнего модуля» и
// реальная деталь «Столешница» могут разойтись.
function countertopTargetDepthOf(ct, ctMat) {
  const override = Number(ct && ct.depth) || 0;
  if (override > 0) return override;
  return (ctMat && ctMat.depth) || null;
}

// Эффективная толщина резолвнутой столешницы: «сдвоенная» — два листа.
function countertopThicknessOf(r) {
  return (r && r.found)
    ? (r.isDouble ? 2 * Number(r.thickness) : (Number(r.thickness) || 0)) : 0;
}

// Убирается ли цельная крышка корпуса под столешницей (толщина >18 мм —
// растикс в торец боковины, см. подробный комментарий у skipTopPanel в
// buildModuleParts). Одно правило и для buildModuleParts, и для buildModel
// (resolveBackMount → раскладка ряда), чтобы они не разошлись.
function skipTopPanelOf(p) {
  const bt = p.base && p.base.type;
  const floorStanding = bt === 'plinth' || bt === 'legsPlinth' || bt === 'legs';
  if (!floorStanding || !(p.countertop && p.countertop.enabled)) return false;
  if (p.topType === 'rails' || p.topType === 'railsEdge') return false;
  return countertopThicknessOf(countertopMatOf(p.countertop)) > 18;
}

// НАВЕСНОЙ модуль (верхний кухонный). Явное поле wallHung главнее; без него
// — кухонный модуль на «цоколе» нулевой высоты (так заведены верхние
// пресеты: plinthHeight 0, основания нет — висит на стене).
// Отметка ВЕРХА навесного модуля от пола по умолчанию, мм (решение
// пользователя 2026-09-26). Регулируется полем модуля mountTop; низ модуля =
// mountTop − высота модуля (см. buildModel, mountBottom).
const WALL_MOUNT_TOP_DEFAULT = 2400;

function isWallHung(p) {
  if (p.wallHung === true || p.wallHung === false) return p.wallHung;
  const b = p.base || {};
  return p.family === 'kitchen' && b.type === 'plinth' && !(Number(b.plinthHeight) > 0);
}

// ЗАДНЯЯ СТЕНКА: НАКЛАДНАЯ ИЛИ В ПАЗ (ПРАВИЛА-КОНСТРУИРОВАНИЯ.md, раздел 2,
// «Задняя стенка: накладная или в паз»). Все числа подтверждены
// пользователем 2026-09-23: паз шириной tb+0,5, глубиной 10, отступ 15 от
// заднего края детали, заход стенки в паз 8.
const BACK_GROOVE_DEFAULTS = { offset: 15, depth: 10, entry: 8 };
// ШКАФ в авто-режиме задней стенки — некухонный модуль выше этой высоты, мм
// (подтверждено пользователем 2026-09-23). У шкафа крыша БЕЗ паза (прежней
// глубины, стенка упирается в неё): он выше уровня глаз, зазор сзади сверху
// не виден. У модулей не выше (тумбы) паз и в крыше.
const BACK_GROOVE_TALL_H = 1600;

// Единственное место, где решается режим задней стенки модуля — его зовут и
// buildModuleParts (геометрия деталей), и buildModel (задний выступ модуля
// в раскладке ряда). Возвращает:
//   { mode: 'none' }                 — стенки нет (мойка, noBack);
//   { mode: 'overlay' }              — накладная, как было (включая паз
//                                      видимой боковины крайнего кухонного);
//   { mode: 'groove', parts, offset, depth, entry, w, E, manual }
//     parts — {left,right,top,bottom}: в каких деталях паз;
//     E = offset + w — насколько детали с пазом удлиняются НАЗАД.
// p — параметры модуля (поля те же, что у buildModuleParts), sides —
// normalizeSides(p), tb — толщина задней стенки.
// ВАЖНО: buildModel зовёт эту функцию ещё и из extent() (backOut) со своим
// набором полей модуля. Поля, которые здесь читаются (noBack, backMount,
// backGroove, wallHung, family, base, topType, countertop, height, а через
// normalizeSides — leftSide/rightSide/scheme), должны совпадать с тем, что
// buildModel передаёт в buildModuleParts, — иначе раскладка ряда и
// геометрия модуля разойдутся.
function resolveBackMount(p, sides, tb) {
  // 'none' у backMount — выбор пользователя «Без задней стенки»: деталь стенки
  // не строится, пазов нет; видимая боковина остаётся удлинённой (sideDepth),
  // но без паза (см. гард mode !== 'none' в buildModuleParts).
  if (p.noBack || p.backMount === 'none') return { mode: 'none', E: 0 };
  const overlay = { mode: 'overlay', E: 0 };
  const mount = (p.backMount === 'overlay' || p.backMount === 'groove') ? p.backMount : 'auto';
  if (mount === 'overlay') return overlay;
  const hung = isWallHung(p);
  let offset, depth, entry, parts;
  if (mount === 'auto') {
    // Нижняя кухня (тумбы, пенал) — прежнее поведение без изменений.
    if (p.family === 'kitchen' && !hung) return overlay;
    // Паз режется только в боковине, чья пласть открыта наружу целиком:
    // «до пола» или «сбоку дна». Боковины «на дно» — накладная стенка.
    // Исключение — НАВЕСНОЙ модуль: у него паз в дне не зависит от боковин
    // вовсе (parts.bottom = hung ниже), поэтому даже если ОБЕ боковины «на
    // дно» (ни одна не подходит под q()), стенка всё равно должна остаться
    // В ПАЗ (паз только в дне) — иначе весь корпус на дне переезжает в
    // «накладную» геометрию (extent()/backOut() считают иначе), и модуль
    // визуально рассинхронизируется с соседями по ряду: ломается определение
    // «закрыта ли боковина соседом» (sideCovered ниже), она красится в
    // материал видимой боковины, дно/ДВП меняют размеры, у фасадов появляется
    // перепад (баг 2026-09-27, обе боковины «на дно» на верхнем модуле).
    const q = (v) => v === 'floor' || v === 'besideBottom';
    // Боковина «на дно» (заданная, либо ставшая такой у видимой боковины на
    // металлических опорах — см. effSideFor) стоит на дне: дно идёт на всю
    // ширину и его задняя пласть открыта, поэтому стенка встаёт в паз и в
    // ДНЕ тоже (решение пользователя 2026-10-06). Считаем только по полям
    // модуля, без видимости боковин — этот же вызов делает extent().
    const baseType = (p.base && p.base.type) || p.baseType;
    const metalLegs = baseType === 'legs' && p.legType === 'metal';
    const sideOnBottom = (v) => v === 'onBottom' || (metalLegs && v !== 'besideBottom');
    const bottomGroove = hung || sideOnBottom(sides.left) || sideOnBottom(sides.right);
    if (!hung && !q(sides.left) && !q(sides.right)) return overlay;   // обе «на дно» — накладная, как прежде
    offset = BACK_GROOVE_DEFAULTS.offset;
    depth = BACK_GROOVE_DEFAULTS.depth;
    entry = BACK_GROOVE_DEFAULTS.entry;
    // Тумба — паз ещё и в крыше (дно прежней глубины, стенка набивается на
    // его торец); ШКАФ (выше BACK_GROOVE_TALL_H) — паз только в боковинах,
    // крыша прежней глубины; навесной — паз в дне, крыша прежней глубины.
    const tall = Number(p.height) > BACK_GROOVE_TALL_H;
    parts = { left: q(sides.left), right: q(sides.right), top: !hung && !tall, bottom: bottomGroove };
  } else {
    const g = p.backGroove || {};
    const num = (v, def, ok) => {
      const x = Number(v);
      return (v !== '' && v !== null && v !== undefined && Number.isFinite(x) && ok(x)) ? x : def;
    };
    offset = num(g.offset, BACK_GROOVE_DEFAULTS.offset, (x) => x >= 0);
    depth = num(g.depth, BACK_GROOVE_DEFAULTS.depth, (x) => x > 0);
    entry = num(g.entry, BACK_GROOVE_DEFAULTS.entry, (x) => x >= 0);
    const gp = g.parts || {};
    parts = { left: gp.left !== false, right: gp.right !== false,
      top: gp.top !== false, bottom: gp.bottom !== false };
  }
  // Паз в крыше — только если крыша реально цельная панель: у планок
  // (rails/railsEdge) и у корпуса без крыши под толстой столешницей верх
  // считается «без паза».
  const topIsPanel = !(p.topType === 'rails' || p.topType === 'railsEdge') && !skipTopPanelOf(p);
  // НАВЕСНОЙ модуль: крышка вкладная между боковинами и доходит прямо до
  // ДВП, паз в ней не режут никогда — то же правило, что и в АВТО-режиме
  // (parts.top = !hung && !tall выше), но там оно применялось только по
  // умолчанию. В РУЧНОМ режиме «В паз» чекбокс «крыша» ничем не блокировался
  // для навесных модулей (backGrooveTopBlockedReason в app.js проверяет
  // только topType/отсутствие крыши) — из-за этого ручной выбор паза у
  // верхнего модуля мог прорезать и крышку тоже (решение пользователя
  // 2026-09-27: паз в крышке — только у напольных модулей).
  if (!topIsPanel || hung) parts.top = false;
  if (!parts.left && !parts.right && !parts.top && !parts.bottom) return overlay;
  const w = round1(Number(tb) + 0.5);
  return { mode: 'groove', manual: mount === 'groove', parts, offset, depth, entry, w,
    E: round1(offset + w) };
}

// НАВЕСКА ВЕРХНЕГО МОДУЛЯ (ПРАВИЛА-КОНСТРУИРОВАНИЯ.md, раздел «Навеска
// верхних модулей»; числа — catalog.HANGER_SYSTEMS, чертёж Blum 48N0510,
// подтверждено пользователем 2026-09-27). Для навесного модуля
// (isWallHung(p)) с выбранной системой навески p.hangerSystem:
//  1) на ОБЕИХ боковинах, с внутренней пласти — две точки РАЗМЕТКИ под
//     саморезы навески (без сверления): линия на screwLineFromTop ниже
//     ВНУТРЕННЕЙ (нижней) плоскости крыши — крыша у нас вкладная, поэтому от
//     верха боковины это толщина крыши + 33 (решение 2026-09-27); 1-й саморез от СТЕНЫ = отступ задней стенки (паз —
//     bm.offset, накладная — 0) + её фактическая толщина + screwGapFromBack,
//     второй — на screwStep дальше вперёд. На детали y считается от её
//     ФАКТИЧЕСКОГО заднего края: боковина с пазом удлинена назад до стены
//     (y = от стены), у накладной стенки боковина стоит перед ней (y меньше
//     на толщину стенки);
//  2) в задней стенке — два угловых выреза backCut.w × backCut.h сверху
//     (w — от внутренней грани боковины, h — от внутренней плоскости крыши,
//     т.е. от верха модуля толщина крыши + h) под крюк;
//     хранятся в part.notches (координаты детали: x — по длине от левого
//     края, y — по ширине от низа); отрисовку делает следующий этап.
// Возвращает hangerHardware для сметы: [{ system, qty }] (пусто, если модуль
// не навесной или система не задана).
// Условный диаметр маркера точки разметки на чертеже/в DXF — не сверлится.
const HANGER_MARK_D = 2;
function applyWallHanger(p, parts, warnings, bm, backPart, D, H) {
  const sys = p.hangerSystem;
  if (!sys || !isWallHung(p)) return [];
  const tb = backPart ? Number(backPart.thickness) || 0 : 0;
  const backOffset = (bm && bm.mode === 'groove') ? Number(bm.offset) || 0 : 0;
  // 1-й саморез от стены (задней плоскости модуля) и сама плоскость стены
  // в локальных координатах модуля: у паза стена — задний край деталей,
  // удлинённых на E; у накладной — задняя пласть стенки.
  const fromWall = round1(backOffset + tb + sys.screwGapFromBack);
  const wallZ = (bm && bm.mode === 'groove') ? -D / 2 - bm.E : -D / 2 - tb;
  const reach = sys.hookReach || null;
  if (reach && (fromWall < reach.min || fromWall > reach.max)) {
    warnings.push(`Навеска: 1-й саморез навеса в ${fromWall} мм от стены — вне хода крюка `
      + `${reach.min}–${reach.max} мм, крюк навеса не достанет до шины — измените отступ задней стенки.`);
  }
  if (!sys.drawingVerified && sys.genericNote) {
    warnings.push(`Навеска «${sys.name}»: ${sys.genericNote}.`);
  }
  const sides = parts.filter((q) => q.kind === 'side');
  // Все вертикальные размеры Blum 48N0510 (линия саморезов, высота выреза)
  // отсчитываются от ВНУТРЕННЕЙ (нижней) плоскости крыши — у Blum крыша
  // лежит на боковинах. У нас крыша вкладная между боковинами (занимает
  // верхние t мм боковины), поэтому плоскость отсчёта = низ фактической
  // детали крыши (решение пользователя 2026-09-27). Нет крыши — верх модуля.
  const roofs = parts.filter((q) => q.kind === 'top' && q.box);
  let refY = null;
  for (const r of roofs) {
    const rTop = r.box.y + r.box.h / 2;
    const rBot = rTop - (Number(r.thickness) || r.box.h);
    if (refY === null || rBot > refY) refY = rBot;
  }
  if (refY === null) refY = H;
  const lineY = refY - sys.screwLineFromTop;
  for (const sp of sides) {
    const sideRear = sp.box.z - sp.box.d / 2;
    const y1 = round1(fromWall - (sideRear - wallZ));
    const y2 = round1(y1 + sys.screwStep);
    const sideBottom = sp.box.y - sp.box.h / 2;
    const x = round1(Math.min(lineY, sp.box.y + sp.box.h / 2 - sys.screwLineFromTop) - sideBottom);
    const marks = [y1, y2].map((y) => ({
      x, y, d: HANGER_MARK_D, depth: 0, through: false, side: 'front',
      kind: 'hangerScrew', mark: true,
    }));
    // Совпадение с уже существующей присадкой боковины (конфирмат/Rastex
    // крыши, полкодержатели...) — только предупреждаем, размеры не двигаем.
    const clash = (sp.holes || []).some((h) => h.side !== 'edge' && marks.some((m) =>
      Math.hypot(h.x - m.x, h.y - m.y) < (Number(h.d) || 0) / 2 + HANGER_MARK_D / 2));
    if (clash) {
      warnings.push(`Навеска: разметка саморезов навеса на детали «${sp.name}» попадает `
        + `в другое отверстие присадки — проверьте положение полок/крепежа.`);
    }
    if (y1 < 0 || y2 > sp.box.d) {
      warnings.push(`Навеска: разметка саморезов навеса выходит за деталь «${sp.name}».`);
    }
    sp.holes.push.apply(sp.holes, marks);
  }
  // Вырезы в задней стенке под крюк навеса.
  if (backPart && sys.backCut) {
    const bb = backPart.box;
    const backLeft = bb.x - bb.w / 2;
    const backBottom = bb.y - bb.h / 2;
    const L = backPart.length, Wd = backPart.width;
    const left = sides.filter((q) => q.box.x < 0)[0];
    const right = sides.filter((q) => q.box.x > 0)[0];
    // По высоте — до backCut.h ниже внутренней плоскости крыши (refY).
    const y0 = round1(Math.min(refY, H) - sys.backCut.h - backBottom);
    const cutH = round1(Wd - y0);
    const note = `Вырез ${sys.backCut.w}×${cutH} мм под крюк навески (${sys.backCut.h} мм ниже крыши)`;
    const notches = [];
    if (y0 > 0 && y0 < Wd) {
      if (left) {
        const x1 = round1((left.box.x + left.box.w / 2) - backLeft + sys.backCut.w);
        if (x1 > 0 && x1 < L) notches.push({ kind: 'hangerBackCut', x0: 0, y0, x1, y1: Wd, note });
      }
      if (right) {
        const x0 = round1((right.box.x - right.box.w / 2) - backLeft - sys.backCut.w);
        if (x0 > 0 && x0 < L) notches.push({ kind: 'hangerBackCut', x0, y0, x1: L, y1: Wd, note });
      }
    }
    if (notches.length) {
      backPart.notches = (backPart.notches || []).concat(notches);
      backPart.note = (backPart.note ? backPart.note + '; ' : '')
        + `вырезы ${sys.backCut.w}×${cutH} под крюк навески`;
    }
  }
  return [{ system: p.hangerSystemId || null, qty: 1 }];
}

// ВЫПИЛ ПОД МОНТАЖНУЮ ШИНУ у навесного модуля (решение пользователя
// 2026-09-26, ПРАВИЛА-КОНСТРУИРОВАНИЯ.md «Навеска верхних модулей»): на
// каждой НЕвидимой боковине навесного модуля — сквозной прямоугольный выпил
// в ВЕРХНЕМ ЗАДНЕМ углу: h мм по высоте (от верха боковины) × d мм по
// глубине (от заднего торца).
// Видимую боковину не пилим — выпил был бы виден снаружи.
// Торцы выпила НЕ кромятся (решение пользователя: прокрашиваются/
// шпаклюются/остаются как есть) — периметр кромки детали и площадь листа в
// смете не меняются, только пометка в note.
const RAIL_NOTCH = { h: 45, d: 20 }; // решение пользователя 2026-09-26
// Боковина «на дно» (sides[key] === 'onBottom') по умолчанию не режется: в
// АВТО-режиме она не удлинена в паз до стены (parts.left/right groove задаёт
// только floor/besideBottom, см. resolveBackMount), реально до шины не
// достаёт и мешать ей не может — выпил там был бы лишним отверстием без
// функции (решение пользователя 2026-09-27, баг с обеими боковинами «на
// дно» на верхнем модуле). НО если пользователь вручную поставил «Задняя
// стенка → В паз» и не снял галочку с этой боковины — она ТОЖЕ удлиняется
// в паз до стены (bm.parts[key] === true), и тогда выпил снова нужен: та
// же физическая причина (боковина реально дотягивается до шины), просто
// теперь она возникла по ручному выбору, а не по типу низа боковины
// (найдено пользователем 2026-09-27 — «В паз» добавился, боковины стали
// как дно, а выреза нет, хотя он там нужен).
function applyRailNotch(p, parts, sideVisible, sides, bm, warnings) {
  if (!isWallHung(p)) return;
  const inGroove = (key) => !!(bm && bm.mode === 'groove' && bm.parts && bm.parts[key]);
  for (const sp of parts.filter((q) => q.kind === 'side')) {
    const key = sp.box.x < 0 ? 'left' : 'right';
    if (sideVisible[key] !== false) continue;
    if (sides[key] === 'onBottom' && !inGroove(key)) continue;
    const len = Number(sp.length) || 0;
    const wid = Number(sp.width) || 0;
    if (len <= RAIL_NOTCH.h || wid <= RAIL_NOTCH.d) continue;
    // Координаты детали — как у drillPanel/hangerScrew: x — по длине
    // (высоте боковины) от её низа, y — по ширине от заднего края.
    const x0 = round1(len - RAIL_NOTCH.h);
    const nt = { kind: 'railNotch', x0, y0: 0, x1: round1(len), y1: RAIL_NOTCH.d,
      note: `Выпил под монтажную шину ${RAIL_NOTCH.h}×${RAIL_NOTCH.d}, торцы без кромки` };
    sp.notches = (sp.notches || []).concat([nt]);
    sp.note = (sp.note ? sp.note + '; ' : '')
      + `выпил ${RAIL_NOTCH.h}×${RAIL_NOTCH.d} под монтажную шину в верхнем заднем углу, торцы выпила без кромки`;
    // Паз под заднюю стенку не должен идти через вырезанную зону — обрезаем
    // его у низа выпила (полоса паза заходит в глубину выпила).
    for (const g of (sp.grooves || [])) {
      if (g.kind !== 'backGroove') continue;
      const gy0 = Math.min(g.y0, g.y1) - (Number(g.w) || 0) / 2;
      if (gy0 < RAIL_NOTCH.d && Math.max(g.x0, g.x1) > x0) {
        if (g.x1 >= g.x0) g.x1 = x0; else g.x0 = x0;
      }
    }
    // Разметка саморезов навеса / присадка внутри выпила — только предупреждаем.
    const inside = (sp.holes || []).some((h) => {
      const r = (Number(h.d) || 0) / 2;
      return h.side !== 'edge' && h.x + r > x0 && h.x - r < len
        && h.y + r >= 0 && h.y - r < RAIL_NOTCH.d;
    });
    if (inside) {
      warnings.push(`Навеска: на детали «${sp.name}» отверстие/разметка попадает в выпил `
        + `под шину ${RAIL_NOTCH.h}×${RAIL_NOTCH.d} мм — проверьте отступ задней стенки.`);
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
  // Материал ЛДСП-фасада по умолчанию — проектное поле «Материал фасада»
  // (p.facadeMat, решение 2026-09-26), ОТДЕЛЬНОЕ от «Видимой боковины»
  // (p.facadeDecor): смена боковины фасады не меняет. Не передано (старые
  // вызовы ядра) — декор корпуса. Свой материал секции (sec.facadeMaterial)
  // по-прежнему приоритетнее (см. facadeTypeOf/facadeMaterialPick).
  const facadeMat = p.facadeMat || decor;
  // Материал и толщина ящиков не зависят от корпуса — см. effectiveDrawerThickness.
  const drawerDecor = p.drawerDecor || decor;
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

  // ВИДИМАЯ БОКОВИНА. Корпус кухни делают белым, а боковину, которую видно
  // в интерьере, — в отдельном материале. Видимой считается та, что доходит
  // ДО ПОЛА или стоит СБОКУ ДНА (дно вкладное): её пласть открыта целиком.
  // p.sideCovered = { left, right } (true — боковину ПОЛНОСТЬЮ закрывает
  // боковина соседа, считает buildModel, решение пользователя 2026-09-27):
  //   • НАВЕСНОЙ модуль — видимая ровно та, что не закрыта полностью
  //     (торец ряда, сосед ниже/мельче); тип «до пола» видимость не задаёт;
  //   • НАПОЛЬНЫЙ — «до пола»/«сбоку дна» видимая всегда (её видно под
  //     фасадами в зоне цоколя), остальные — если не закрыты полностью.
  // Не передано (прямой вызов ядра без раскладки) — прежнее правило: только
  // по варианту установки боковины. p.visibleSides === false — невидимые обе.
  // Материал ВСЕГДА выбирает пользователь — проектный facadeDecor (поле
  // «Видимая боковина», решение 2026-09-26), независимо от вида фасада
  // секции (ldsp/mdf/wood/glass4/alu…): ЛДСП или фасадная МДФ-панель.
  // Один код на весь проект — у соседних модулей цоколь сливается в одну
  // планку (mergePlinths сверяет материал буквально).
  const visibleSideMat = () => visibleSideMaterialOf(p.facadeDecor, decor, t);
  const sideVisible = {};
  const hungModule = isWallHung(p);
  for (const key of ['left', 'right']) {
    const v = sides[key];
    const byType = v === 'floor' || v === 'besideBottom';
    const cov = p.sideCovered;
    let vis;
    if (p.visibleSides === false) vis = false;
    else if (!cov) vis = byType;
    else if (hungModule) vis = !cov[key];
    else vis = byType || !cov[key];
    sideVisible[key] = vis;
  }
  // РУЧНОЙ «на дно» (решение пользователя 2026-10-06): стен в проекте нет,
  // движок не знает, какая боковина у стены, поэтому ручной выбор «на дно»
  // делает боковину невидимой — корпусной материал, задняя стенка накладная
  // (как у закрытой соседом). Раньше видимость исходного положения нужна
  // только для предупреждения про опору (sideWasVisible).
  const sideWasVisible = { left: sideVisible.left, right: sideVisible.right };
  for (const key of ['left', 'right']) {
    if (!hungModule && p.sideUserSet && p.sideUserSet[key] && sides[key] === 'onBottom') {
      sideVisible[key] = false;
    }
  }
  // НАВЕСНОЙ: боковина, полностью закрытая соседом вплотную (невидимая),
  // становится «на дно» — задняя стенка у неё накладная, паза и выпила под
  // шину нет, остаётся только вырез в задней стенке под навес (решение
  // пользователя 2026-10-03). Видимость посчитана выше по заявленному типу.
  if (hungModule && p.sideCovered) {
    for (const key of ['left', 'right']) {
      if (p.sideCovered[key]) sides[key] = 'onBottom';
    }
  }
  // ЭФФЕКТИВНЫЙ ТИП БОКОВИНЫ (решение пользователя 2026-09-28, уточнено
  // 2026-09-28 после визуальной проверки — «опоры с цоколем» тоже до пола).
  // У оснований «опоры» и «опоры с цоколем» видимая боковина обязана
  // физически закрывать то, что у неё внизу — опору/ножку, иначе она видна
  // сбоку или торчит из-под цокольной планки. Декларированный sides.left/
  // right по-прежнему управляет НЕвидимой боковиной; для видимой:
  //   • чистые «опоры» с металлическим типом (legType==='metal') —
  //     декоративные, остаются на виду — боковина «на дно» (решение 2026-10-06;
  //     явно заданное «сбоку дна» сохраняется);
  //   • «опоры» с кухонными пластиковыми (legType!=='metal') и «опоры с
  //     цоколем» (там опора всегда пластиковая, см. kitchen ниже по файлу,
  //     legType не читается) — 'floor', закрыть полностью.
  // «Цоколь» (plinth, БЕЗ опор) не трогаем — там нет ножки, которая могла бы
  // торчать, цокольная планка и так закрывает весь низ сама по себе.
  // Навесные модули не трогаем — там видимость вообще не про пол.
  // С v379 (решение пользователя 2026-10-06): если боковину выбрали руками
  // (p.sideUserSet[key], ставит интерфейс при смене списка) — её тип
  // действует и у видимой боковины, а не подменяется; вместо подмены —
  // предупреждение, что опора останется на виду сбоку (скрывается кнопкой ×,
  // см. renderWarnings). Без ручного выбора (пресеты, старые проекты, где
  // «на дно» стоит по умолчанию) — прежняя подмена, чтобы они не поменялись.
  const userSide = (key) => !!(p.sideUserSet && p.sideUserSet[key]);
  const effSideFor = (key) => {
    if (hungModule || !sideVisible[key] || userSide(key)) return sides[key];
    if (p.base.type === 'legs') return p.legType === 'metal' ? (sides[key] === 'besideBottom' ? 'besideBottom' : 'onBottom') : 'floor';
    if (p.base.type === 'legsPlinth') return 'floor';
    return sides[key];
  };
  if (!hungModule && (p.base.type === 'legs' || p.base.type === 'legsPlinth')) {
    for (const key of ['left', 'right']) {
      // Металлические опоры — декоративные, на виду сбоку им не страшно (решение
      // 2026-10-06): при любом ручном выборе боковины не предупреждаем.
      const decorative = p.base.type === 'legs' && p.legType === 'metal';
      if (sideWasVisible[key] && userSide(key) && sides[key] !== 'floor' && !decorative) {
        warnings.push(`${key === 'left' ? 'левая' : 'правая'} боковина «${SIDE_LABEL[sides[key]]}» у края модуля — опора будет видна сбоку.`);
      }
    }
  }
  const effLeft = effSideFor('left');
  const effRight = effSideFor('right');

  // Режим задней стенки (накладная / в паз) — см. resolveBackMount(). Детали
  // с пазом (bm.parts) удлиняются НАЗАД на bm.E: передний край на месте,
  // задний уходит на -D/2 - E. Внутренние размеры корпуса не меняются —
  // полки, стойки, ящики, опоры считаются от прежней глубины D. Резолвер
  // получает ДЕКЛАРИРОВАННЫЙ (не эффективный) тип боковины — это решение
  // пользователя о конструктиве, а не о видимости; паз/накладная стенка не
  // были частью текущего запроса (только позиция видимой боковины у опор/
  // опор с цоколем), поэтому не переопределяются вместе с ней — так они не
  // задевают некухонную мебель (family !== 'kitchen'), где эта развилка
  // реально работает (для кухни resolveBackMount и так всегда 'overlay',
  // см. её начало).
  const bm = resolveBackMount(p, sides, tb);
  const inGroove = (key) => bm.mode === 'groove' && !!bm.parts[key];
  // Глубина детали с пазом: не меньше D + E (уже более глубокую видимую
  // боковину кухни не трогаем — паз встаёт по той же абсолютной позиции).
  const grooveDepth = (key, d0) => (inGroove(key) ? Math.max(d0, round1(D + bm.E)) : d0);
  // Центр удлинённой детали — БЕЗ округления: makePart округляет box.z до
  // 0,1 мм, а у глубины D + 18,5 центр лежит на 0,05 мм (-9,25 → -9,2), и
  // вся присадка, считаемая от box.z (полкодержатели, крепёж корпуса),
  // съезжала бы на 0,1 мм от переднего края. Передний край ровно на +D/2.
  const exactFrontZ = (part) => { part.box.z = D / 2 - part.box.d / 2; };
  // Дно ВКЛАДНОЕ с той стороны, где боковина не стоит на нём:
  // и «до пола», и «сбоку дна» упираются торцом дна в свою внутреннюю грань.
  // Считаем по ЭФФЕКТИВНОМУ типу — видимая боковина, принудительно ставшая
  // «до пола»/«сбоку дна», тоже делает дно вкладным с этой стороны.
  const leftInset = effLeft !== 'onBottom';
  const rightInset = effRight !== 'onBottom';
  const sections = p.sections.map(normalizeSingleZoneSection);
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

  // ТОЛЩИНА БОКОВИНЫ по сторонам (решение пользователя 2026-09-26).
  // Приоритет: ручная правка толщины (partOverrides, тот же ключ, что у
  // applyPartOverrides) → толщина листа ручной правки материала из каталога →
  // видимая — реальная толщина листа «Видимая боковина» → корпусная t.
  // НАРУЖНЫЙ размер модуля W не меняется: наружная пласть боковины всегда
  // на ±W/2, боковина растёт/худеет ВНУТРЬ, а дно, крыша, царги, секции,
  // присадка подгоняются под её внутреннюю грань.
  const sideOv = (key) => (p.partOverrides
    && p.partOverrides[['side', 'Корпус', key, 0].join('|')]) || null;
  const sideT = (key) => {
    const ov = sideOv(key);
    if (ov && Number(ov.thicknessOverride) > 0) return Number(ov.thicknessOverride);
    if (ov && ov.materialOverride) {
      const om = aluFillMaterial(ov.materialOverride);
      if (om && Number(om.thickness) > 0) return Number(om.thickness);
    }
    if (sideVisible[key]) return visibleSideMat().thickness;
    return t;
  };
  const tL = sideT('left'), tR = sideT('right');
  const Wi = W - tL - tR;           // чистая ширина между боковинами

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
  const layout = layoutSections(sections, Wi, t, -W / 2 + tL);
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
  // Центры боковин — от НАРУЖНОЙ грани ±W/2 внутрь на полтолщины своей
  // стороны (tL/tR). Поиск боковины по box.x ниже по файлу — только по этим
  // точным значениям, не по ±(W/2 - t/2).
  const sideXL = -(W / 2 - tL / 2);
  const sideXR = W / 2 - tR / 2;
  // Центр ограничивающей панели слева/справа от секции i: у крайних —
  // боковина (своя толщина), у внутренних — стойка толщиной t.
  const panelLX = (i) => (i === 0 ? sideXL : layout.x0[i] - t / 2);
  const panelRX = (i) => (i === n - 1 ? sideXR : layout.x0[i] + layout.widths[i] + t / 2);
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

  // Лист «Видимая боковина» тоньше минимума (старый проект — выбор не
  // сбрасываем, только предупреждаем; в список выбора такие листы не
  // попадают, см. VISIBLE_SIDE_MIN_T).
  if ((sideVisible.left || sideVisible.right) && p.facadeDecor
    && Number(p.facadeDecor.thickness) > 0 && Number(p.facadeDecor.thickness) < VISIBLE_SIDE_MIN_T) {
    warnings.push(`Лист «Видимая боковина» ${Number(p.facadeDecor.thickness)} мм тоньше минимума `
      + `${VISIBLE_SIDE_MIN_T} мм — выберите лист не тоньше ${VISIBLE_SIDE_MIN_T} мм.`);
  }

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

  for (const s of [
    { nm: 'Боковина левая', key: 'left', x: sideXL, th: tL, v: effLeft, sec: sections[0] },
    { nm: 'Боковина правая', key: 'right', x: sideXR, th: tR, v: effRight, sec: sections[n - 1] },
  ]) {
    const bottomY = sideBottomY(s.v);
    const h = sideTop - bottomY;
    const visible = sideVisible[s.key];
    const vm = visible ? visibleSideMat() : null;
    // Глубина боковины: видимая кухонная может быть глубже корпуса (до
    // стены), боковина с пазом под заднюю стенку — удлинена назад на E.
    const sDepth = grooveDepth(s.key, visible ? sideDepth : D);
    // Передний торец виден, только если он не закрыт фасадом секции (или
    // фасад стеклянный) — см. sectionFrontHidden. Флаг visible выше — про
    // ДРУГОЕ: открытую наружу ПЛАСТЬ крайней боковины (материал в тон
    // фасада), а не про её передний торец у проёма — торец за своей же
    // закрытой дверью прячется независимо от того, видна ли пласть боковины
    // снаружи корпуса.
    const frontHidden = sectionFrontHidden(s.sec, decor, t, facadeMat, p.facadeThickness);
    parts.push(makePart({
      name: s.nm + (visible ? ' (видимая)' : ''), section: 'Корпус',
      material: vm ? vm.code : decor.code, thickness: s.th,
      length: h, width: sDepth, qty: 1, grain: true, kind: 'side',
      facadeType: vm ? 'sidePanel' : null,
      note: sideNote(s.v) + (vm ? `; видимая — из материала «Видимая боковина» (${vm.name})` : ''),
      // Передний торец — 2мм, если реально виден (открыт или за стеклом),
      // иначе техническая кромка (закрыт фасадом). Остальные стороны —
      // техническая кромка по всему периметру (включая короткие торцы у
      // дна/крыши — по требованию: весь корпус кромится по периметру, без
      // исключения для стыков).
      edging: { long1: frontHidden ? EDGE_BACK : EDGE_FRONT, long2: EDGE_BACK, short1: EDGE_BACK, short2: EDGE_BACK },
      // Передний край всегда на +D/2, более глубокая боковина растёт назад.
      x: s.x, y: (sideTop + bottomY) / 2, z: round1(D / 2 - sDepth / 2),
      dims: { w: s.th, h, d: sDepth },
    }));
    if (inGroove(s.key)) exactFrontZ(parts[parts.length - 1]);
  }

  // ---------- Дно и крыша ----------
  // Накладная — во всю ширину W (перекрывает торцы боковин).
  // Вкладная — между боковинами, длина W - tL - tR.
  // Дно доходит до внутренней грани боковины, идущей до пола, и до наружной
  // грани боковины, стоящей на нём (та ложится сверху).
  const bottomLeft  = leftInset  ? (-W / 2 + tL) : (-W / 2);
  const bottomRight = rightInset ? ( W / 2 - tR) : ( W / 2);
  const bottomLen = bottomRight - bottomLeft;
  const bottomNote = (leftInset && rightInset) ? 'Вкладное между боковинами'
    : (!leftInset && !rightInset) ? 'Накладное, боковины стоят на нём'
    : 'Одна боковина на нём, вторая рядом с ним';

  // Дно/крыша/верхние планки идут на ВСЮ ширину модуля, то есть граничат
  // сразу со всеми секциями — их передний торец скрыт, только если фасад
  // есть у КАЖДОЙ секции (хотя бы одна открытая — и торец виден на её участке).
  const bodyFrontHidden = sections.every(
    (sec) => sectionFrontHidden(sec, decor, t, facadeMat, p.facadeThickness));

  // Дно с пазом под заднюю стенку удлинено назад на E (передний край на месте).
  const bottomD = grooveDepth('bottom', D);
  parts.push(makePart({
    name: 'Дно', section: 'Корпус', material: decor.code, thickness: t,
    length: bottomLen, width: bottomD, qty: 1, kind: 'bottom', note: bottomNote,
    edging: { long1: bodyFrontHidden ? EDGE_BACK : EDGE_FRONT, long2: EDGE_BACK, short1: EDGE_BACK, short2: EDGE_BACK },
    x: (bottomLeft + bottomRight) / 2, y: baseH + t / 2, z: round1(D / 2 - bottomD / 2),
    dims: { w: bottomLen, h: t, d: bottomD },
  }));
  if (inGroove('bottom')) exactFrontZ(parts[parts.length - 1]);
  // Верх модуля: либо цельная крышка, либо две планки (царги), либо —
  // у обычной (не кухонной) тумбы со столешницей — вообще ничего.
  // У кухонных нижних тумб цельной крышки не делают: ставят переднюю и заднюю
  // планки шириной 80–100 мм плашмя — они держат геометрию корпуса, а через
  // них шурупами крепится столешница. Экономит материал и открывает доступ
  // сверху (мойка, варочная панель, ящики).
  const isFloorStandingBase = p.base.type === 'plinth' || p.base.type === 'legsPlinth' || p.base.type === 'legs';
  // ---------- Столешница: резолвер материала ----------
  // Изменено 2026-09-06: выбор столешницы больше не разделён на «тип
  // материала» (было: select ldsp38/compact12/doubleLdsp/custom + отдельное
  // поле «Глубина, мм») — пользователь всегда просто выбирает МАТЕРИАЛ через
  // ту же Библиотеку, что и для декора корпуса/фасада (p.countertop.decorCode).
  // Им может стать:
  //  - готовая позиция каталога COUNTERTOP_MATERIALS (карточка товара с
  //    кодом "CTOP-..." — ЛДСП 38мм постформинг или компакт-плита 12мм HPL,
  //    продаётся погонным метром ФИКСИРОВАННОЙ глубины) — глубина/цена/
  //    макс. длина зашиты в самой карточке, другая глубина того же декора —
  //    это ДРУГАЯ карточка каталога (см. catalog.js: COUNTERTOP_MATERIALS,
  //    findCountertopMaterialByCode);
  //  - обычный лист декора из общей библиотеки материалов (DECORS/
  //    BACK_MATERIALS/FACADE_MATERIALS) — прежняя ветка material==='custom',
  //    глубина НЕ фиксирована (клеится/пилится из обычного листа декора).
  // «Сдвоенная» (было отдельным пунктом списка material==='doubleLdsp') —
  // теперь отдельная галочка p.countertop.double, а не материал: два листа
  // ДЕКОРА КОРПУСА проекта, склеенных вместе — decorCode при этом вообще не
  // читается (строка выбора материала на панели скрыта).
  //
  // Резолвер читает ИСКЛЮЧИТЕЛЬНО p.countertop, никогда topType/facadeType/
  // family (см. visibleSideMat выше и баг dbcbba0). Определён здесь (а не
  // ниже, у самой постройки детали «Столешница») и вызывается ОДИН раз в
  // ctResolved — тот же резолвнутый результат нужен уже сейчас, до постройки
  // крыши корпуса (skipTopPanel решает, убирать ли цельную крышку), и снова
  // ниже при постройке самой детали «Столешница» — единый источник, чтобы
  // решение «крышка есть/нет» и фактическая деталь не могли разойтись.
  const countertopMat = countertopMatOf;
  const ctEnabled = !!(p.countertop && p.countertop.enabled);
  const ctResolved = ctEnabled ? countertopMat(p.countertop) : null;
  // Эффективная толщина резолвнутого материала (countertopThicknessOf) —
  // «сдвоенная» это всегда 2 листа ИМЕННО выбранного на панели декора
  // столешницы, а не толщина корпуса (t) — исправлено 2026-09-07.
  // У обычной мебели (не кухня — там верх всегда планки-царги, см. выше)
  // цельная крышка под включённой столешницей — лишняя деталь ТОЛЬКО если
  // РЕАЛЬНАЯ толщина резолвнутого материала БОЛЬШЕ 18 мм (стандартной
  // корпусной ЛДСП): тогда стяжка-эксцентрик держит столешницу прямо в
  // торец боковины (растикс, см. присадку ниже). Единое правило для ВСЕХ
  // путей резолва (каталожная позиция ldsp38/compact12, сдвоенная, свой
  // материал) — БЕЗ хардкода по конкретному коду/materialId (подтверждено
  // владельцем-мебельщиком 2026-09-05/06: толщина ≤18мм — клеится к сплошной
  // опоре, толщина >18мм — растикс в торец боковины, независимо от того,
  // КАКАЯ это конкретно позиция каталога/декора). Материал ещё не выбран/не
  // найден (пустое поле, старый/битый проект) — безопасный дефолт: крышку
  // НЕ убираем (лучше лишняя деталь, чем корпус без опоры сверху).
  // Само правило — в skipTopPanelOf() (верх файла): им же пользуется
  // resolveBackMount(), решая, может ли крыша быть с пазом.
  const skipTopPanel = skipTopPanelOf(p);
  if (skipTopPanel) {
    // Деталь верха корпуса не строится.
  } else if (p.topType === 'rails' || p.topType === 'railsEdge') {
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
        z: onEdge ? D / 2 - t / 2 - FRONT_RAIL_EDGE_SETBACK : D / 2 - RAIL_W / 2, front: true },
      { nm: 'Планка верхняя задняя',
        z: onEdge ? -D / 2 + t / 2 : -D / 2 + RAIL_W / 2, front: false },
    ]) {
      parts.push(makePart({
        name: r.nm, section: 'Корпус', material: decor.code, thickness: t,
        length: Wi, width: RAIL_W, qty: 1, kind: 'top',
        note: onEdge
          ? 'Вкладная между боковинами, НА РЕБРО — проём сверху свободен под мойку'
          : 'Вкладная между боковинами, плашмя; через неё крепится столешница',
        // Планки НА РЕБРО стоят вертикально — их long1/long2 не смотрят
        // на фасад, это отдельная (редкая, под мойку) геометрия, видимость
        // фасада к ней не применяется (long1 — та же 2мм-кромка, что и
        // сейчас). Плашмя — передняя видна, только если не закрыта фасадом;
        // задняя всегда технической кромкой. В обоих случаях — весь
        // периметр минимум технической кромкой, без исключения для стыков.
        edging: onEdge
          ? { long1: EDGE_FRONT, long2: EDGE_BACK, short1: EDGE_BACK, short2: EDGE_BACK }
          : { long1: r.front ? (bodyFrontHidden ? EDGE_BACK : EDGE_FRONT) : EDGE_BACK,
              long2: EDGE_BACK, short1: EDGE_BACK, short2: EDGE_BACK },
        // Центр между внутренними гранями боковин (толщины сторон могут
        // различаться — видимая боковина, ручная правка).
        x: (tL - tR) / 2, y: onEdge ? H - RAIL_W / 2 : H - t / 2, z: r.z,
        dims: onEdge ? { w: Wi, h: RAIL_W, d: t } : { w: Wi, h: t, d: RAIL_W },
      }));
      // Столешница на планках крепится шурупами 3,5 СНИЗУ через планку: по 2
      // сквозных отверстия Ø4 (шуруп проходит свободно) на каждую планку, в
      // 100 мм от края боковины, по середине ширины планки (решение
      // пользователя 2026-10-04). Rastex в торец боковины ставится только
      // когда планок нет (skipTopPanel, см. ниже). Планка НА РЕБРО не
      // сверлится: сквозь неё шуруп не пройдёт (глубина = ширина стойки).
      if (ctEnabled && isFloorStandingBase && !onEdge) {
        const SCREW_EDGE = 100;
        const xs = (Wi - 2 * SCREW_EDGE >= 32) ? [SCREW_EDGE, Wi - SCREW_EDGE] : [Wi / 2];
        const rail = parts[parts.length - 1];
        for (const hx of xs) {
          rail.holes.push({ x: round1(hx), y: round1(RAIL_W / 2), d: 4, depth: t,
            through: true, side: 'front', kind: 'countertopScrew' });
        }
      }
    }
  } else {
    // Крышка всегда вкладная между боковинами. С пазом под заднюю стенку —
    // удлинена назад на E (передний край на месте).
    const topD = grooveDepth('top', D);
    parts.push(makePart({
      name: 'Крыша (топ)', section: 'Корпус', material: decor.code, thickness: t,
      length: Wi, width: topD, qty: 1, kind: 'top',
      note: 'Вкладная между боковинами',
      edging: { long1: bodyFrontHidden ? EDGE_BACK : EDGE_FRONT, long2: EDGE_BACK, short1: EDGE_BACK, short2: EDGE_BACK },
      x: (tL - tR) / 2, y: H - t / 2, z: round1(D / 2 - topD / 2),
      dims: { w: Wi, h: t, d: topD },
    }));
    if (inGroove('top')) exactFrontZ(parts[parts.length - 1]);
  }

  // ---------- Столешница ----------
  // Каждая тумба со включённой столешницей сначала строит СВОЮ деталь по
  // СВОЕЙ ширине + свесы — а соседние по прогону детали дальше СЛИВАЮТСЯ в
  // одну сквозную деталь через mergeCountertops() в buildModel() (по
  // аналогии с mergePlinths), пока не упрутся в максимальную длину плиты
  // материала (ctMaxLength ниже). Только когда длина реально превышает
  // плиту, остаётся настоящий стык — и он всегда приходится на границу
  // тумб (по построению: слияние идёт целыми деталями тумб, никогда не
  // режет деталь посередине). Крепёж таких стыков расставляет
  // joinCountertopSeams(), которая идёт следом за mergeCountertops(). Цитата
  // пользователя: «ДСП в один лист соединять между собой не надо [если и
  // так помещаются в один лист] … если длины не хватило — не соединяем где
  // попало, а в месте соединения двух модулей».
  //
  // Резолвер countertopMat() и его результат (ctResolved/ctResolvedThickness)
  // уже определены выше, перед skipTopPanel — здесь используем готовый
  // ctResolved, повторный вызов не нужен.

  if (ctEnabled && isFloorStandingBase) {
    const ct = p.countertop;
    const ctMat = ctResolved;
    if (!ctMat.found) {
      // Единый резолвер (см. countertopMat() выше) — причина всегда одна из
      // двух: decorCode не указан/не найден ни в одном каталоге, либо у
      // найденного декора нет валидной толщины.
      if (ctMat.reason === 'noThickness') {
        warnings.push('Столешница модуля: у выбранного материала не указана толщина в каталоге — деталь не построена. '
          + 'Заведите этот лист отдельной позицией в Библиотеке материалов с указанием толщины и выберите её заново с панели столешницы.');
      } else {
        warnings.push('Столешница модуля: материал не выбран из Библиотеки — деталь не построена.');
      }
    } else {
      // «Свес спереди» отсчитывается от ПЛОСКОСТИ ФАСАДА (как и в уже
      // существующем WORKTOP_OVERHANG=20 выше — та же логика «крайнего
      // модуля»), а не от сырой глубины корпуса D: иначе цифра в поле не
      // означает то, что написано (обнаружено пользователем на реальном
      // расчёте: корпус 510 + фасад 18 + свес 20 + столешница 600 → свес
      // сзади должен быть 52 мм, а не 0).
      const facadeThicknessResolved = p.facadeThicknessHint || p.facadeThickness || t;
      const oF = Number(ct.overhangFront) || 0, oL = Number(ct.overhangLeft) || 0,
            oR = Number(ct.overhangRight) || 0;
      const ctThickness = ctMat.isDouble ? 2 * Number(ctMat.thickness) : ctMat.thickness;
      // Задняя стенка (ХДФ) НАКЛАДНАЯ — крепится НА задний торец корпуса и
      // всегда выступает за него на свою толщину (см. ниже: z: -D/2-tb/2,
      // то есть физический задний край сборки — не -D/2, а -D/2-tb). Для
      // ОБЫЧНОЙ мебели (не кухня) свес сзади по умолчанию 0 означает
      // «заподлицо с корпусом», но корпус — это ещё не весь модуль: без
      // поправки столешница не закрывала заднюю стенку целиком (обнаружено
      // пользователем на реальном виде сбоку). Для КУХНИ поправка не нужна:
      // там свес сзади автоматически дотягивает глубину столешницы точно до
      // глубины купленного листа (реальная стена), это уже верно и без
      // поправки на ХДФ — трогать не нужно (подтверждено пользователем).
      // Стенка В ПАЗ (resolveBackMount): детали с пазом удлинены назад на E
      // = отступ паза + его ширина — столешница закрывает их целиком, +E.
      const backPanelExtra = (p.noBack || bm.mode === 'none' || p.family === 'kitchen') ? 0
        : (bm.mode === 'groove' ? bm.E : tb);
      // «Свес сзади» по умолчанию зависит от типа мебели, а не только от
      // материала:
      //  - КУХНЯ (family==='kitchen'): корпус нижней тумбы намеренно мельче
      //    столешницы фиксированной глубины (ldsp38/compact12) — стена там,
      //    где реально заканчивается купленный лист, а не там, где кончается
      //    корпус. Поэтому свес автоматически «доращивает» глубину столешницы
      //    точно до глубины листа (корпус+фасад+свес спереди+свес сзади =
      //    глубина материала).
      //  - ЛЮБАЯ ДРУГАЯ мебель (тумба, стол и т.п.): корпус УЖЕ стоит впритык
      //    к стене своей задней гранью (подтверждено пользователем на
      //    реальном примере) — растягивать столешницу дальше корпуса, чтобы
      //    непременно совпасть с глубиной листа, было бы неверно: свес сзади
      //    по умолчанию 0 (заподлицо с корпусом), лишний материал листа —
      //    отход при раскрое, как обычно бывает с плитными материалами.
      // В обоих случаях — свободно переопределяется вручную.
      const hasManualBack = ct.overhangBack !== undefined && ct.overhangBack !== null && ct.overhangBack !== '';
      // targetDepth — ctMat.depth (готовая позиция каталога) ИЛИ ручное
      // переопределение глубины связки (ct.depth, см. countertopTargetDepthOf)
      // — например остров 900/1200 мм из обычного листа декора, для которого
      // в каталоге нет готовой позиции нужной глубины. null — ни того ни
      // другого (свой материал/сдвоенная без переопределения): совпадать с
      // глубиной листа тут нечему, «доращивать» свес не нужно (см. warning
      // ниже), свес остаётся только ручным (overhangBack).
      const targetDepth = countertopTargetDepthOf(ct, ctMat);
      const autoOverhangBack = (!targetDepth || p.family !== 'kitchen') ? 0
        : round1(targetDepth - D - facadeThicknessResolved - oF);
      const oB = hasManualBack ? (Number(ct.overhangBack) || 0) : autoOverhangBack;
      // Свес слева/справа НЕ прибавляется к длине детали здесь — если эта
      // тумба потом сольётся с соседями (mergeCountertops), только КРАЙНИЕ
      // тумбы слитого ряда должны получить свой свес наружу, а не каждая
      // тумба посередине (иначе середина ряда становится шире фактического
      // корпуса, соседние детали перестают ровно соприкасаться границами, и
      // слияние либо не срабатывает, либо даёт нахлёст). Сам свес — в
      // ctOverhangLeft/Right ниже, mergeCountertops применяет его к ЛЕВОМУ
      // краю первой и ПРАВОМУ краю последней тумбы уже слитого ряда (для
      // одиночной, несливающейся тумбы — с тем же результатом, что и раньше).
      const ctLen = W;
      const ctWidth = round1(D + backPanelExtra + facadeThicknessResolved + oF + oB);
      if (ctMat.maxLength && ctLen > ctMat.maxLength) {
        warnings.push(`Столешница модуля (${Math.round(ctLen)} мм) длиннее максимальной цельной `
          + `полосы материала "${ctMat.name}" (${ctMat.maxLength} мм) — цельным куском не выпилить.`);
      }
      // Предупреждение о расхождении с глубиной листа имеет смысл ТОЛЬКО
      // там, где вообще ожидается точное совпадение — у кухни (см.
      // autoOverhangBack выше). У остальной мебели свес сзади по умолчанию
      // 0 и расхождение с глубиной листа — норма, а не повод для тревоги.
      if (!ctMat.isDouble && ctMat.depth && p.family === 'kitchen' && Math.abs(ctWidth - ctMat.depth) > 1) {
        warnings.push(`Столешница модуля: итоговая глубина ${Math.round(ctWidth)} мм не совпадает `
          + `с глубиной материала "${ctMat.name}" (${ctMat.depth} мм) — свес сзади переопределён `
          + `вручную (${oB} мм вместо автоматических ${autoOverhangBack} мм), потребуется `
          + `нестандартная резка или другая позиция материала.`);
      }
      const ctPart = makePart({
        name: 'Столешница', section: 'Столешница',
        // doubleLdsp физически — два склеенных листа декора корпуса; qty:2
        // при неизменных length/width корректно удваивает расход площади
        // листа в спецификации (лист считается по material+length*width*qty),
        // при этом толщина в 3D остаётся ОДНОЙ визуально слитой деталью
        // (2×t) — qty здесь чисто счётный множитель стоимости, а не число
        // отдельных объектов на сцене.
        material: ctMat.code, thickness: ctThickness,
        length: ctLen, width: ctWidth, qty: ctMat.isDouble ? 2 : 1, kind: 'countertop',
        edging: { long1: EDGE_FRONT, long2: EDGE_FRONT, short1: EDGE_FRONT, short2: EDGE_FRONT },
        x: 0, y: H + ctThickness / 2, z: round1((facadeThicknessResolved + oF - oB - backPanelExtra) / 2),
        dims: { w: ctLen, h: ctThickness, d: ctWidth },
        // Текст завязан на skipTopPanel (а не заново на ct.material), чтобы
        // не разойтись с фактом «крышка построена или нет» — у ещё не
        // выбранного материала (старый/битый проект) skipTopPanel=false
        // (безопасный дефолт, крышка есть), и текст должен это отражать так
        // же, как для явного compact12, а не врать про «крышки нет».
        note: (p.topType === 'rails' || p.topType === 'railsEdge')
          ? 'Крепится шурупами 3.5×30 через верхние планки'
          : (skipTopPanel
            ? 'Крепится стяжкой-эксцентриком напрямую в верхний торец боковин (цельной крышки/царг под столешницей нет)'
            : 'Клеится по всей площади к цельной крышке корпуса — крепёж в торец боковины для этого материала не применяется'),
      });
      // ctHasTopSupport/ctMaxLength — доп. поля для пассов buildModel()
      // (mergeCountertops/joinCountertopSeams): part.material уже
      // РЕЗОЛВНУТЫЙ код каталога/декора, по нему нельзя узнать максимальную
      // длину цельного куска (нужно для слияния). ctFamily больше не
      // нужен — joinCountertopSeams() с 2026-09-06 различает клеевой/
      // растиксовый узел по РЕАЛЬНОЙ part.thickness (>18мм — растикс, иначе
      // клей), той же, что уже лежит на этой детали (thickness: ctThickness
      // выше) — без отдельного поля-дублёра.
      // ctHasTopSupport — булево, а не topType строкой: после
      // mergeCountertops одна деталь может покрывать несколько тумб с
      // РАЗНЫМ topType, и mergeCountertops сводит это к «есть опора под ВСЕЙ
      // деталью» (AND по всем слитым тумбам) — см. флаг там же. «Опора» —
      // это ЛЮБАЯ сплошная поверхность сверху корпуса под столешницей
      // (планки-царги ИЛИ цельная крышка, см. skipTopPanel выше), а не
      // только планки: с skipTopPanel=true (толщина >18мм — крепёж в торец
      // боковины) опоры нет, во всех остальных случаях — есть.
      ctPart.ctHasTopSupport = !skipTopPanel;
      ctPart.ctMaxLength = ctMat.maxLength || null;
      // Свес слева/справа ЭТОЙ тумбы — mergeCountertops применяет их только
      // если эта тумба окажется крайней (первой/последней) в слитом ряду.
      ctPart.ctOverhangLeft = oL;
      ctPart.ctOverhangRight = oR;
      parts.push(ctPart);

      // ---------- Присадка растикс: боковина ↔ столешница ----------
      // Только когда крышки/царг нет (skipTopPanel) — при кухонных царгах
      // крепёж шурупами через планку, при компакт-плите — клей (см. note
      // выше), там растикса нет вообще.
      //
      // Узел ОБРАТНЫЙ общему правилу Rastex 15 (ПРАВИЛА-КОНСТРУИРОВАНИЯ.md,
      // «Минификс Hettich Rastex 15» — там гнездо Ø15 и Ø8-в-торец всегда на
      // детали, что примыкает ТОРЦОМ — полка/дно/крыша). Здесь торцом
      // примыкает БОКОВИНА (её верхний торец упирается в нижнюю пласть
      // столешницы) — значит по тому же правилу гнездо Ø15 и Ø8-в-торец идут
      // в БОКОВИНУ, а столешница получает только прямой дюбель Ø8 в пласть
      // (её нижнюю поверхность, side:'back' — тот же признак «низ листа»,
      // что у дна/полки, camSide ниже по файлу).
      //
      // Сторона гнезда Ø15: подтверждено владельцем-мебельщиком 2026-09-05 —
      // ВСЕГДА с ВНУТРЕННЕЙ стороны боковины (side:'front', тот же признак,
      // что у обычных полкодержателей — см. drillPanel ниже по файлу),
      // независимо от того, видна ли эта боковина снаружи корпуса. Это
      // осознанная практика цеха, а не вывод из общего правила «эксцентриков
      // не видно изнутри» — там описан другой узел (обратные роли деталей),
      // прямого запрета на именно этот случай правила не дают.
      //
      // Координаты — в СОБСТВЕННОЙ локальной системе каждой детали (см.
      // makePart: «отверстия в системе координат детали, левый нижний угол
      // лицевой стороны»). Этот код работает ДО глобального разворота и
      // размещения модуля в прогоне (buildModel применяет part.rot к box.x/z
      // уже после возврата отсюда) — поэтому box.x/y/z обеих деталей пока в
      // системе координат МОДУЛЯ, читать их напрямую безопасно. Две точки на
      // боковину (не через общий jointPoints() — у него другие пороги
      // масштабирования по глубине, 3-4 точки уже от 560мм, что не совпадает
      // с зафиксированным «всегда 2» от владельца) — количество и отступ
      // (JOINT_SETBACK) подтверждены 2026-09-05, specification.js считает их
      // по фактическим отверстиям (см. worktopRastexQty), не отдельной
      // формулой — не разойдётся при изменении числа точек здесь.
      //
      // При слиянии соседних тумб в одну сквозную столешницу (mergeCountertops
      // ниже по файлу) дюбельные отверстия столешницы переносятся и
      // сдвигаются отдельно (см. flush() там же) — здесь координаты верны
      // только для ЭТОЙ, ещё не слитой детали.
      if (skipTopPanel) {
        for (const sx of [sideXL, sideXR]) {
          const sidePanel = parts.filter((pp) => pp.kind === 'side'
            && Math.abs(pp.box.x - sx) < 1.5)[0];
          if (!sidePanel) continue; // подстраховка — по построению всегда найдётся
          const topEdgeX = sidePanel.length; // x=0 — низ боковины, x=length — верх
          // Два растикса на боковину, отступ JOINT_SETBACK (50мм, тот же
          // отступ крепежа от кромки, что уже используется по всему файлу —
          // не новое число) от переднего и заднего края глубины боковины.
          // Подтверждено владельцем-мебельщиком 2026-09-05 (было 1 в центре
          // до этой правки). Подстраховка на нетипично мелкую глубину — тот
          // же порог 32мм минимального зазора, что и в jointPoints() ниже по
          // файлу: сближенные точки схлопываются в одну по центру.
          const crossYs = (sidePanel.width - 2 * JOINT_SETBACK < 32)
            ? [round1(sidePanel.width / 2)]
            : [round1(JOINT_SETBACK), round1(sidePanel.width - JOINT_SETBACK)];
          const sideBackZ = sidePanel.box.z - sidePanel.box.d / 2; // задняя грань боковины
          const ctLeftX = ctPart.box.x - ctPart.box.w / 2;
          const ctBackZ = ctPart.box.z - ctPart.box.d / 2;
          for (const crossY of crossYs) {
            // forJoint:'countertop' — отличает эту присадку от любых других
            // minifix-соединений на той же боковине (например, глухая
            // накладная панель тоже вешается на боковину через minifixCam,
            // см. panelAt() выше по файлу) — specification.js считает
            // растиксы столешницы по этой метке, а не по одному kind,
            // иначе задвоил бы их с обычным jointRows-учётом того же узла.
            sidePanel.holes.push({
              x: round1(topEdgeX - RASTEX.camSetback), y: crossY,
              d: RASTEX.camD, depth: RASTEX.camDepthFor(sidePanel.thickness),
              through: false, side: 'front', kind: 'minifixCam', forJoint: 'countertop',
            });
            sidePanel.holes.push({
              x: round1(topEdgeX), y: crossY, d: RASTEX.boltD, depth: RASTEX.boltDepth,
              through: false, side: 'edge', kind: 'minifixBolt', forJoint: 'countertop',
            });
            ctPart.holes.push({
              x: round1(sidePanel.box.x - ctLeftX), y: round1(sideBackZ + crossY - ctBackZ),
              d: RASTEX.dowelD, depth: RASTEX.dowelDepth,
              through: false, side: 'back', kind: 'minifixDowel', forJoint: 'countertop',
            });
          }
        }
      }
    }
  }

  // ---------- Цоколь ----------
  // Планка спереди, утоплена вглубь на PLINTH_SETBACK (норма — под носок обуви).
  // Цоколь бывает несущий (боковины до пола) и навесной — на клипсах к
  // регулируемым опорам. Второй вариант — стандарт для кухонь и тумб.
  const hasPlinth = (p.base.type === 'plinth' || p.base.type === 'legsPlinth') && baseH > 0;
  // Толщина цоколя — реальная толщина листа «Видимая боковина» из каталога.
  const plinthT = visibleSideMat().thickness;
  const onLegs = p.base.type === 'legs' || p.base.type === 'legsPlinth';
  if (hasPlinth) {
    // В зону цоколя спускается только боковина «до пола» — она и ограничивает
    // планку. При «на дно» и «сбоку дна» низ свободен, планка идёт до габарита,
    // поэтому в ряду корпусов цоколь получается сквозным.
    // Планку ограничивает только та боковина, которая реально спускается в
    // зону цоколя, то есть «до пола». При «на дно» и «сбоку дна» низ свободен,
    // планка идёт до габарита и в ряду сливается в сквозную.
    const pLeft  = (effLeft === 'floor')  ? (-W / 2 + tL) : (-W / 2);
    const pRight = (effRight === 'floor') ? ( W / 2 - tR) : ( W / 2);
    const plinthLen = pRight - pLeft;
    const plinthX = (pLeft + pRight) / 2;
    // ЦОКОЛЬ — ВИДИМАЯ ДЕТАЛЬ. Он идёт по всему фронту на уровне пола, его
    // видно всегда, поэтому режется он из материала поля «Видимая боковина»
    // (p.facadeDecor: ЛДСП или МДФ-панель, см. visibleSideMaterialOf) — так
    // же, как и видимая боковина; толщина — plinthT выше.
    const plinthMat = visibleSideMat();
    parts.push(makePart({
      name: 'Цоколь (планка передняя)', section: 'Корпус',
      material: plinthMat.code, thickness: plinthT, facadeType: 'plinthFace',
      length: plinthLen, width: baseH, qty: 1, kind: 'plinth',
      note: (onLegs
        ? `Навесной, на клипсах к опорам, утоплен от фасада на ${PLINTH_SETBACK} мм`
        : `Утоплен от фасада на ${PLINTH_SETBACK} мм`)
        + `; видимая деталь — из материала «Видимая боковина» (${plinthMat.name})`,
      edging: { long1: EDGE_FRONT, long2: EDGE_BACK, short1: EDGE_BACK, short2: EDGE_BACK },
      // Лицевая грань — всегда на утоплении PLINTH_SETBACK; более толстый
      // лист (МДФ 19) растёт назад, к опорам (см. zFront клипс ниже).
      x: plinthX, y: baseH / 2, z: D / 2 - plinthT / 2 - PLINTH_SETBACK,
      dims: { w: plinthLen, h: baseH, d: plinthT },
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
    const padL = LEG_INSET + (effLeft === 'floor' ? tL : 0);
    const padR = LEG_INSET + (effRight === 'floor' ? tR : 0);
    const xFrom = -W / 2 + padL, xTo = W / 2 - padR;
    // Оси рядов опор: края + под каждой вертикальной стойкой (иначе вес стойки
    // с ящиками прогибает дно между опорами и ящик перестаёт выдвигаться —
    // решение пользователя 2026-10-06); оставшиеся пролёты длиннее LEG_SPAN
    // делятся поровну. Один проём — прежняя раскладка (края + равные шаги).
    const legXs = [xFrom, xTo];
    for (let i = 0; i < n - 1; i++) {
      const dx = layout.x0[i] + layout.widths[i] + t / 2;
      if (legXs.every((v) => Math.abs(v - dx) > 100)) legXs.push(dx);
    }
    legXs.sort((a, b) => a - b);
    for (let i = legXs.length - 2; i >= 0; i--) {
      const a = legXs[i], b = legXs[i + 1];
      const gaps = Math.ceil((b - a) / LEG_SPAN);
      for (let g = gaps - 1; g >= 1; g--) legXs.splice(i + 1, 0, a + ((b - a) * g) / gaps);
    }
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
      ? (D / 2 - PLINTH_SETBACK - plinthT) - CLIP_REACH - GAP_EPS
      : D / 2 - LEG_INSET;
    const zBack = -D / 2 + LEG_INSET;

    const LEG_HOLE_SPACING = 52;   // шаг крепёжных отверстий площадки, мм
    const bottomPart = parts.find((pt) => pt.kind === 'bottom');
    // y присадки в дне — от ЕГО задней кромки (у дна с пазом под заднюю
    // стенку она на E дальше -D/2).
    const bottomBackZ = bottomPart ? bottomPart.box.z - bottomPart.box.d / 2 : -D / 2;
    const plinthPart = parts.find((pt) => pt.kind === 'plinth');
    // Высота, на которой клипса держит цоколь (по образцу опора с клипсой):
    // примерно на середине высоты опоры, чуть ниже монтажной площадки.
    // По 3D-модели (опора с клипсой.obj) отверстия клипсы — РОВНО на
    // середине высоты опоры (0,05 м из 0,1 м высоты исходника) — это и
    // используем, без произвольного коэффициента.
    const CLIP_Y = baseH * 0.5;

    for (const x of legXs) {
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
                y: round1((z + r * Math.sin(rad)) - bottomBackZ),
                d: KITCHEN_HOLE_D, depth: 12, through: false, side: 'back', kind: 'legFix',
              });
            }
          } else {
            for (const sx of [-1, 1]) {
              for (const sz of [-1, 1]) {
                bottomPart.holes.push({
                  x: round1((x + sx * LEG_HOLE_SPACING / 2) - bottomLeft),
                  y: round1((z + sz * LEG_HOLE_SPACING / 2) - bottomBackZ),
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
  // Режим решает resolveBackMount() (см. верх файла и
  // ПРАВИЛА-КОНСТРУИРОВАНИЯ.md, «Задняя стенка: накладная или в паз»):
  //   • НАКЛАДНАЯ — одна цельная панель ХДФ набивается на задние торцы
  //     боковин, дна и крыши (стандарт эконом-сборки, нижняя кухня);
  //   • В ПАЗ — стенка заходит в пазы боковин/крыши/дна (тумбы, шкафы,
  //     навесные модули), детали с пазом удлинены назад на E;
  //   • без стенки — модуль под мойку: сзади коммуникации — сифон, гибкая
  //     подводка, а часто и розетки.
  // Накладная стенка режется с запасом: по 1 мм с каждой стороны, то есть на
  // 2 мм меньше по ширине и на 2 мм по высоте. Строго «в размер» она
  // цепляется за кромку и мешает выставить корпус по диагонали. Этот же
  // зазор 1 мм — у стенки в паз по краям, где паза нет.
  const BACK_PLAY = 1;
  let leftEdge, rightEdge, backBottomY, backTopY, backNote;
  if (bm.mode === 'groove') {
    // СТЕНКА В ПАЗ. Паз шириной w = tb + 0,5 занимает по Z интервал
    // [-D/2 - w, -D/2]: его передняя сторона — задняя плоскость корпуса
    // (-D/2), от нового заднего края детали с пазом — отступ bm.offset.
    // Стенка прижата к передней стороне паза: z центра = -D/2 - tb/2, как
    // у накладной. Паз сквозной по всей длине детали.
    const grooveAxisZ = -D / 2 - bm.w / 2;
    const sidePartAt = (sgn) => parts.filter((q) => q.kind === 'side'
      && Math.sign(q.box.x) === sgn)[0];
    const grooveTargets = {
      left: sidePartAt(-1),
      right: sidePartAt(1),
      // Крыша с пазом — только цельная панель (планки/отсутствие крыши
      // resolveBackMount уже отсёк).
      top: parts.filter((q) => q.kind === 'top' && q.name === 'Крыша (топ)')[0],
      bottom: parts.filter((q) => q.kind === 'bottom')[0],
    };
    const partNames = { left: 'лев. боковина', right: 'прав. боковина', top: 'крыша', bottom: 'дно' };
    const grooveList = [];
    for (const key of ['left', 'right', 'top', 'bottom']) {
      const gp = grooveTargets[key];
      if (!bm.parts[key] || !gp) continue;
      // y — ось паза от ЗАДНЕЙ кромки детали, как у паза видимой боковины.
      // Задняя кромка — от переднего края (+D/2) на ширину детали: так без
      // накопленной ошибки округления box.z (у D + 18,5 центр на 0,05 мм).
      const yPaz = round1(grooveAxisZ - (D / 2 - gp.width));
      gp.grooves.push({
        kind: 'backGroove', x0: 0, y0: yPaz, x1: round1(gp.length), y1: yPaz,
        w: bm.w, depth: bm.depth, side: 'inner',
        note: 'Паз под заднюю стенку',
      });
      grooveList.push(partNames[key]);
    }
    // Край без паза: зазор 1 мм от наружной грани. Но если боковина БЕЗ паза
    // глубже корпуса (видимая кухонная, ручной режим с её снятой галочкой) —
    // её торец не на задней плоскости, стенка встаёт между боковинами, чтобы
    // не врезаться в её тело.
    const plainSideEdge = (sp, th) => ((sp && sp.box.z - sp.box.d / 2 < -D / 2 - 0.5)
      ? (W / 2 - th - BACK_PLAY) : (W / 2 - BACK_PLAY));
    leftEdge = bm.parts.left ? -(W / 2 - tL + bm.entry) : -plainSideEdge(grooveTargets.left, tL);
    rightEdge = bm.parts.right ? (W / 2 - tR + bm.entry) : plainSideEdge(grooveTargets.right, tR);
    // Верх дна — baseH + t, низ крыши — H - t (см. их y выше).
    backBottomY = bm.parts.bottom ? (baseH + t) - bm.entry : baseH + BACK_PLAY;
    backTopY = bm.parts.top ? (H - t) + bm.entry : H - BACK_PLAY;
    backNote = `В паз ${bm.w}×${bm.depth} мм, отступ ${bm.offset} мм, заход ${bm.entry} мм`
      + (grooveList.length ? ` (${grooveList.join(', ')})` : '');
    // Нижний кухонный модуль в ручном режиме «в паз»: плоскость стены задаёт
    // столешница (sideDepth > D — видимая боковина доходит ровно до стены).
    // Удлинённая назад деталь может упереться в стену — размеры не подгоняем,
    // только предупреждаем.
    if (sideDepth > D && D + bm.E > sideDepth + 0.05) {
      const over = Math.round((D + bm.E - sideDepth) * 10) / 10;
      warnings.push(`Задняя стенка в паз: корпус выходит за стену на ${over} мм — уменьшите глубину модуля.`);
    }
    if (bm.entry >= bm.depth) {
      warnings.push(`Задняя стенка: заход в паз ${bm.entry} мм не меньше глубины паза ${bm.depth} мм — стенка упрётся в дно паза.`);
    }
    // Самая тонкая деталь с пазом: боковины — своей толщины (tL/tR), крыша/дно — t.
    const grooveMinT = Math.min.apply(null, [
      bm.parts.left ? tL : Infinity, bm.parts.right ? tR : Infinity,
      (bm.parts.top || bm.parts.bottom) ? t : Infinity]);
    if (Number.isFinite(grooveMinT) && bm.depth >= grooveMinT) {
      warnings.push(`Задняя стенка: глубина паза ${bm.depth} мм не меньше толщины детали с пазом ${grooveMinT} мм — паз прорежет деталь насквозь.`);
    }
  } else {
    // НАКЛАДНАЯ. У КРАЙНЕГО кухонного модуля видимая боковина глубже корпуса
    // (идёт до стены) — перекрыть её торец нельзя, туда стенка заходит В ПАЗ.
    // Глубина этого паза — 8 мм, производственный стандарт: жёстче держит
    // стенку и прощает погрешность раскроя (4 мм — минимум).
    const PAZ_D = 8;
    // Паз нужен НЕ у любой «до пола»/«сбоку дна» боковины, а только когда она
    // реально глубже корпуса (см. sideDepth выше — растёт только когда есть
    // столешница с свесом до стены, т.е. это кухонный крайний модуль ряда).
    // У одиночного шкафа (обе боковины «до пола», без столешницы) sideDepth
    // равен D, накладную стенку не видно с торца — она набивается на торцы,
    // как в height-формуле (BACK_PLAY), без паза. Раньше это условие проверяло
    // только тип боковины и накладную стенку резало ýже по ПАЗ-формуле даже
    // без реального выступа — отсюда лишние -12 мм на сторону по ширине при
    // корректных -1 мм по высоте.
    const hasOverhang = sideDepth > D;
    const leftVisible = hasOverhang && sideVisible.left;
    const rightVisible = hasOverhang && sideVisible.right;
    // ДОПУСК В ПАЗУ. Стенка режется на 2 мм короче полного захода: иначе она
    // упирается в дно паза и корпус не стягивается по диагонали. Допуск даётся
    // только с той стороны, где стенка ВХОДИТ В ПАЗ.
    const PAZ_PLAY = 2;
    leftEdge = leftVisible ? -(W / 2 - tL + PAZ_D - PAZ_PLAY) : -(W / 2 - BACK_PLAY);
    rightEdge = rightVisible ? (W / 2 - tR + PAZ_D - PAZ_PLAY) : (W / 2 - BACK_PLAY);
    // Положение по высоте — как было исторически (низ стенки на уровне
    // низа дна, высота H - baseH - 2): режим «накладная» не меняется.
    backBottomY = baseH;
    backTopY = H - 2 * BACK_PLAY;
    const grooved = leftVisible || rightVisible;
    // Паз под заднюю стенку режется в ВИДИМОЙ боковине: стенка не может
    // перекрыть её торец, потому что боковина глубже корпуса.
    if (bm.mode !== 'none' && grooved) {
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
    backNote = grooved
      ? `Накладная; в видимую боковину входит В ПАЗ ${tb + 0.5}×${PAZ_D} мм, `
        + `допуск ${PAZ_PLAY} мм на сторону`
      : 'Накладная, крепится на задние торцы корпуса';
  }
  const backW = round1(rightEdge - leftEdge);
  const backHgt = round1(backTopY - backBottomY);
  const backPart = (bm.mode === 'none') ? null : makePart({
    name: 'Задняя стенка', section: 'Корпус', material: back.code, thickness: tb,
    length: backW, width: backHgt, qty: 1, kind: 'back',
    note: backNote,
    edging: { long1: null, long2: null, short1: null, short2: null },
    x: round1((leftEdge + rightEdge) / 2), y: backBottomY + backHgt / 2, z: -D / 2 - tb / 2,
    dims: { w: backW, h: backHgt, d: tb },
  });
  if (backPart) parts.push(backPart);

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
  const pantographPanels = []; // куда встали корпуса пантографа — для присадки боковин
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
      // Стойка видна (2мм), только если хотя бы одна из двух секций,
      // которые она разделяет, открыта (без фасада или за стеклом) —
      // если обе закрыты, её передний торец не виден.
      const dividerHidden = sectionFrontHidden(sections[i], decor, t, facadeMat, p.facadeThickness)
        && sectionFrontHidden(sections[i + 1], decor, t, facadeMat, p.facadeThickness);
      parts.push(makePart({
        name: 'Стойка вертикальная', section: 'Корпус', material: decor.code, thickness: t,
        // Стойка во всю глубину корпуса D: передний край на +D/2, задний —
        // на задней плоскости корпуса (-D/2), вплотную к задней стенке (её
        // передняя пласть во всех режимах на -D/2). Требование пользователя
        // 2026-09-23; раньше была D - tb и не доходила до стенки на tb.
        length: innerH, width: D, qty: 1, kind: 'divider',
        note: `Вкладная между дном и крышей, отступ слева ${Math.round(secX0 + secW - (-W / 2 + tL))} мм`,
        edging: { long1: dividerHidden ? EDGE_BACK : EDGE_FRONT, long2: EDGE_BACK, short1: EDGE_BACK, short2: EDGE_BACK },
        x: secX0 + secW + t / 2, y: innerBottomY + innerH / 2, z: 0,
        dims: { w: t, h: innerH, d: D },
      }));
    }

    // ----- Зона ящиков (снизу секции) -----
    // Доступная под ящики высота фронта: весь фронт, если двери нет,
    // иначе фронт минус зона двери (по умолчанию половина).
    const frontAvail = (H - baseH);
    const drawerHeights = getDrawerHeights(
      sec, drawerUnitH, frontAvail, (w) => warnings.push(w), secName);
    secInfo.push({ index: i, drawerAvail: frontAvail, drawerHeights: drawerHeights.slice(), shelfYs: [], boxes: [],
      // Ящики ОТСЕКОВ (zone.drawers): по индексу отсека, как drawerAvail/drawerHeights/boxes секции.
      zoneDrawerAvail: {}, zoneDrawerHeights: {}, zoneDrawerBoxes: {} });
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
    const runnerNLs = [];
    const boxInfo = [];
    const boxPartsStart = parts.length;
    let boxPartsEnd = 0;   // конец деталей ящиков СЕКЦИИ (дальше — ящики отсеков)
    if (drawerHeights.length) {
      // Материал/толщина ящиков — по умолчанию проектные (drawerDecor/drawerT),
      // но секция может переопределить их своими sec.drawerDecorCode/
      // sec.drawerThickness (панель «Ящики» в UI). Fallback нужен для секций
      // без этих полей — старые пресеты (presets.js создаёт секции через
      // sec({...}) без них) и проекты, ещё не прошедшие миграцию.
      const secDrawerDecor = (sec.drawerDecorCode
        && window.Modul3D.catalog.DECORS.find((d) => d.code === sec.drawerDecorCode))
        || drawerDecor;
      const secDrawerT = effectiveDrawerThickness(sec, p);
      buildDrawerBoxes({
        parts, warnings, sec, secName, secCenterX, drawerHeights,
        sectionOpening: secW, innerDepth: D - tb, t, decor, back, backT: tb,
        frontZ: D / 2, boxInfo,
        facadeBaseY: baseH, gap,
        drawerDecor: secDrawerDecor, drawerT: secDrawerT,
        baseY: drawerBaseY, innerTopY: innerBottomY + innerH,
        runnerYs, runnerNLs, innerBottomY,
      });
      // Направляющие крепятся по фактическим отметкам построенных коробов:
      // если короб не построен (не влез), то и присадки под него быть не должно.
      const drawSys = window.Modul3D.catalog.DRAWER_SYSTEMS[sec.drawerSystem || 'ballBearing'];
      // Hettich InnoTech Atira: монтажный зазор EB зависит от толщины
      // боковины (catalog.js, ebFor), но считается по корпусной t. Если
      // ограничивающая секцию боковина другой толщины (видимая, ручная
      // правка) — формулу не меняем, только предупреждаем.
      if ((sec.drawerSystem || 'ballBearing') === 'innotech' && runnerYs.length) {
        const secSideT = [i === 0 ? tL : t, i === n - 1 ? tR : t];
        if (secSideT.some((v) => Math.abs(v - t) > 0.05)) {
          warnings.push(`${secName}: ящики Hettich InnoTech Atira — толщина боковины `
            + `${secSideT.filter((v) => Math.abs(v - t) > 0.05).join('/')} мм отличается от корпусной ${t} мм; `
            + `монтажный зазор EB и присадка Atira посчитаны по толщине корпуса ${t} мм — сверьте с каталогом Hettich.`);
        }
      }
      runnerYs.forEach((ry, ri) => {
        drawerMounts.push({ y: ry, panels: [panelLX(i), panelRX(i)], cx: secCenterX,
          nl: runnerNLs[ri], cabinetHoles: drawSys && drawSys.cabinetHoles,
          altShift: drawSys && drawSys.altHoleShift });
      });
      if (infoRowBox) infoRowBox.boxes = boxInfo;
    }
    boxPartsEnd = parts.length;

    // ----- Полки: вкладные, с отступом от переднего края, сзади до задней стенки -----
    // Съёмная полка: отступ SHELF_SETBACK от переднего края, задний край —
    // на задней плоскости корпуса (-D/2), вплотную к задней стенке (её
    // передняя пласть во всех режимах на -D/2). Требование пользователя
    // 2026-09-23; раньше было D - tb - SHELF_SETBACK (не доходила на tb).
    const shelfDepth = D - SHELF_SETBACK;
    // Полки идут выше ящиков, отсчёт от ВЕРХНЕГО КРАЯ ФАСАДА верхнего ящика
    // (фасады стоят от низа секции, поэтому это baseH + суммарная высота).
    const facadeTopY = baseH + drawerZoneH;
    const shelfZoneBottom = drawerZoneH
      ? Math.max(innerBottomY, facadeTopY, drawerBaseY + drawerZoneH)
      : innerBottomY;
    // Многозонный пенал (doorZoneCount>1) — у КАЖДОЙ зоны фасада свои
    // съёмные полки (sec.doorZones[zi].shelves/shelfMode/shelfHeights,
    // высота — от НИЗА РЕАЛЬНОЙ НИШИ этой зоны, тот же принцип, что и
    // shelfHeights секции целиком), плюс несъёмные полки-перегородки на
    // стыках зон — обе группы координат берём напрямую из layoutDoorZones
    // (partitions/nicheBottoms/nicheHeights), а не из отдельного кэша:
    // раньше полка-перегородка считалась отдельно в app.js
    // (placeShelvesAtZoneBoundaries → sec.zoneBoundaryShelves) и не всегда
    // пересчитывалась при правке «Высоты зоны» — полка «застревала» на
    // старом месте, а дверь уезжала вперёд. Теперь обе величины — из одного
    // вызова на каждой сборке модели, разойтись им нечем. Однозонная секция
    // (doorZoneCount<=1) не имеет понятия «зона» вовсе — там полки, как и
    // раньше, одним плоским набором на sec.shelves/shelfHeights/shelfFixed.
    const multiZone = zonesOn(sec);
    // Раскладка отсеков (+ ящики отсеков) — одна на все места модели.
    const zpSlotBot = drawerZoneH ? baseH + drawerZoneH : baseH;
    const zonePlan = multiZone
      ? planZoneLayout(sec, baseH + frontAvail - zpSlotBot, gap, t, drawerUnitH,
        null, (w) => warnings.push(w), secName, { lo: drawerZoneH ? 0 : t, hi: t })
      : null;
    if (zonePlan) {
      zonePlan.stacks.forEach((st, zi) => {
        if (!st) return;
        infoRowBox.zoneDrawerAvail[zi] = st.avail;
        infoRowBox.zoneDrawerHeights[zi] = st.heights.slice();
      });
    }
    let shelfEntries = []; // { y, fixed }
    if (sec.shelves > 0 && !multiZone && shelfZoneH < t + 40) {
      // Если ящики заняли весь фронт, зоны под полки не остаётся — полки не
      // строим вовсе, иначе они попадали внутрь ящиков.
      warnings.push(`${secName}: под полки не осталось места — уменьшите число ящиков `
        + `или увеличьте высоту модуля.`);
    } else if (multiZone) {
      const azSlotBot = zpSlotBot;
      const azLayout = zonePlan.layout;
      // drag — данные для перетаскивания полки в 3D (см. блок «ПЕРЕТАСКИВАНИЕ ПОЛОК» ниже).
      const pzAuto = zonePlan.zones.map((d) => !(d.height > 0) && !(Number(d.fitDoorH) > 0));
      azLayout.partitions.forEach((off, k) => {
        shelfEntries.push({ y: azSlotBot + off, fixed: true, fullDepth: true,
          drag: { kind: 'partition', group: 'p', k, floor: azSlotBot + azLayout.nicheBottoms[0],
            top: azSlotBot + azLayout.nicheBottoms[sec.doorZoneCount - 1] + azLayout.nicheHeights[sec.doorZoneCount - 1],
            hBelow: round1(azLayout.nicheHeights[k]), hAbove: round1(azLayout.nicheHeights[k + 1]),
            autoK: pzAuto[k], autoK1: pzAuto[k + 1], autoCount: pzAuto.filter(Boolean).length } });
      });
      // Ниша под технику (appliance !== 'none') не получает съёмных полок —
      // sec.doorZones[zi].shelves для неё в интерфейсе не показывается и
      // остаётся 0, отдельно исключать её диапазон не нужно.
      for (let zi = 0; zi < sec.doorZoneCount; zi++) {
        const dz = sec.doorZones[zi] || {};
        if (!(Number(dz.shelves) > 0)) continue;
        const zBottom = azSlotBot + azLayout.nicheBottoms[zi];
        const zHeight = azLayout.nicheHeights[zi];
        // Ящики отсека занимают низ ниши: полки — выше их стопки (ручная высота
        // по-прежнему от низа ниши, как у секции от её дна).
        const zst = zonePlan.stacks[zi];
        const zShelfBottom = zst ? Math.max(zBottom, azSlotBot + zst.p0 + zst.sum) : zBottom;
        const zShelfH = zst ? zBottom + zHeight - zShelfBottom : zHeight;
        if (zst && zShelfH < t + 40) {
          warnings.push(`${secName}, отсек ${zi + 1}: под полки не осталось места — уменьшите число ящиков `
            + `отсека или увеличьте высоту отсека.`);
          continue;
        }
        const zoneYs = getShelfYs(
          { shelves: dz.shelves, shelfMode: dz.shelfMode, shelfHeights: dz.shelfHeights },
          zShelfBottom, zShelfH, t, zBottom, null);
        // dz.shelfFixed[k] — «Жёсткая» полка вручную (индекс = shelfHeights[k]).
        const zoneFixedOk = dz.shelfMode === 'manual' && Array.isArray(dz.shelfFixed);
        zoneYs.forEach((y, k) => shelfEntries.push({
          y, fixed: zoneFixedOk && !!dz.shelfFixed[k], zi, zb: zBottom,
          drag: { kind: 'zone', group: 'z' + zi, zi, k, floor: zShelfBottom, top: zBottom + zHeight } }));
      }
      shelfEntries.sort((a, b) => a.y - b.y);
    } else {
      let zoneYs = getShelfYs(sec, shelfZoneBottom, shelfZoneH, t, innerBottomY, []);
      // Пантограф в секции: авто-полки не делят секцию «как пустую». Верхний отсек — под
      // одежду пантографа: от оси трубы вниз до полки ровно по типу одежды (1500/1300/1000 мм);
      // эта полка — верхняя из заданных, остальные ровно делят то, что ниже (решение 2026-10-06).
      const pgAuto = sec.pantograph && sec.shelves > 0 && !(sec.shelfMode === 'manual' && Array.isArray(sec.shelfHeights));
      if (pgAuto) {
        const roofY = innerBottomY + innerH;
        const wantedPgH = Number(sec.pantographHeight);
        const tubeY = (Number.isFinite(wantedPgH) && wantedPgH > 0) ? innerBottomY + wantedPgH : roofY - 30;
        const hang = ROD_CLOTHES_HEIGHT[sec.pantographClothes] || ROD_CLOTHES_HEIGHT.long;
        const topShelfY = tubeY - hang - t / 2;
        if (topShelfY > shelfZoneBottom + t + 40 && topShelfY < roofY) {
          const rest = sec.shelves > 1
            ? getShelfYs({ shelves: sec.shelves - 1, shelfMode: 'auto' }, shelfZoneBottom, topShelfY - shelfZoneBottom, t, innerBottomY, [])
            : [];
          zoneYs = rest.concat([topShelfY]);
        }
      }
      // sec.shelfFixed[si] — полка на стыке зон фасада (старый, однозонный
      // путь placeShelvesAtZoneBoundaries до появления per-zone полок выше).
      // Индекс si совпадает с sec.shelfHeights[si] 1:1 (getShelfYs в ручном
      // режиме отдаёт ровно по одному Y на каждый элемент shelfHeights).
      const manualMode = sec.shelfMode === 'manual' && Array.isArray(sec.shelfFixed);
      shelfEntries = zoneYs.map((y, si) => ({ y, fixed: manualMode && !!sec.shelfFixed[si],
        drag: { kind: 'sec', group: 's', k: si, floor: shelfZoneBottom, top: innerBottomY + innerH } }));
    }
    const shelfYs = shelfEntries.map((e) => e.y);
    // Запоминаем плоскости полок: по ним потом разводится присадка под петли
    // и ставятся полкодержатели.
    const infoRow = secInfo[secInfo.length - 1];
    if (infoRow) infoRow.shelfYs = shelfYs.slice();
    // Высоты НИЖНЕЙ плоскости полок так, как их вводят в режиме «Вручную»:
    // секция — от дна секции, зона фасада — от низа её ниши. UI подставляет их
    // в поля при переключении на «Вручную», чтобы 3D не «прыгал».
    if (infoRow) {
      infoRow.shelfManualHeights = multiZone ? []
        : shelfYs.map((y) => Math.round(y - t / 2 - innerBottomY));
      infoRow.zoneShelfManualHeights = {};
      if (multiZone) {
        for (const e of shelfEntries) {
          if (e.zi === undefined) continue;
          (infoRow.zoneShelfManualHeights[e.zi] = infoRow.zoneShelfManualHeights[e.zi] || [])
            .push(Math.round(e.y - t / 2 - e.zb));
        }
      }
    }
    shelfPanelX[i] = [panelLX(i), panelRX(i)];
    // ЖЁСТКАЯ ПОЛКА НАД ЯЩИКАМИ (решение пользователя 2026-10-05): если над
    // ящиками есть свободное место — несъёмная полка на Rastex во всю
    // глубину корпуса. Над ней дверь (или первая зона отсека) — центр полки
    // в зазоре между фасадом ящика и дверью. Над ящиками нет фасада (открытый
    // отсек, ниша под духовку/СВЧ) — верхняя пласть полки на 2 мм выше
    // верхней кромки фасада ящика. Нет места над ящиками (столешница прямо
    // на них) — полка не нужна. В shelfYs не попадает: ни штанга, ни петли,
    // ни полкодержатели её не учитывают.
    if (drawerZoneH > 0 && shelfZoneH >= t + 40) {
      const zone0 = multiZone ? (sec.doorZones[0] || {}) : {};
      const zone0Facade = multiZone ? (zone0.facade || 'doorLeft') : sec.facade;
      const facadeAbove = zone0Facade !== 'open'
        && !applianceNicheOnly(multiZone ? (zone0.appliance || 'none') : 'none');
      const drawerFacadeTopY = baseH + drawerZoneH - gap;
      // Короб ящика (особенно Quadro) бывает почти вровень с фасадом — нижняя
      // пласть полки не должна заходить в него: тогда полка поднимается до
      // верха самого высокого короба (физически иначе полка встала бы в ящик).
      const boxTopY = parts.slice(boxPartsStart, boxPartsEnd)
        .filter((q) => /^drawer/.test(q.kind) && q.kind !== 'drawerFront' && q.box)
        .reduce((m, q) => Math.max(m, q.box.y + q.box.h / 2), -Infinity);
      shelfEntries.push({
        y: Math.max(facadeAbove ? baseH + drawerZoneH : drawerFacadeTopY + 2 - t / 2,
          boxTopY + t / 2 + 0.6),
        fixed: true, fullDepth: true, drawerTop: true,
        // Полка над ящиками секции: тянется — меняется высота отсека ящиков (n ящиков
        // равной высоты, суммарно S), см. drawerStackDrag.
        drag: drawerStackDrag('drawers', sec, drawerHeights.length, drawerZoneH),
      });
      // Панель показывает такую секцию двумя отсеками: «ящики» и «над ящиками».
      if (infoRowBox) infoRowBox.drawerTopShelf = true;
    }

    // ----- Ящики ОТСЕКОВ (zone.drawers): стопка от низа ниши отсека -----
    // Короб поднят на drawerLift над «полом» отсека (верх полки-перегородки;
    // у нижнего отсека — верх полки над ящиками секции либо дно секции), фасады
    // начинаются от нижней границы отсека (p0), как у секции от низа фронта.
    // Выше стопки — несъёмная полка (если есть место и ниша не кончается тут же).
    if (zonePlan) {
      const roofY = innerBottomY + innerH;
      for (let zi = 0; zi < sec.doorZoneCount; zi++) {
        const st = zonePlan.stacks[zi];
        if (!st) continue;
        const lay = zonePlan.layout;
        const zLabel = `${secName} (${zi === 0 ? 'нижняя зона' : (zi === sec.doorZoneCount - 1 ? 'верхняя зона' : `зона ${zi + 1}`)})`;
        const zP0 = zpSlotBot + st.p0;
        let zFloor;
        if (zi === 0) {
          const dts = shelfEntries.filter((e) => e.drawerTop)[0];
          zFloor = dts ? dts.y + t / 2 : shelfZoneBottom;
        } else {
          zFloor = zpSlotBot + lay.nicheBottoms[zi];
        }
        const zNicheTop = Math.min(roofY, zpSlotBot + lay.nicheBottoms[zi] + lay.nicheHeights[zi]);
        const zv = st.virt;
        const zDecor = (zv.drawerDecorCode
          && window.Modul3D.catalog.DECORS.find((d) => d.code === zv.drawerDecorCode))
          || drawerDecor;
        const zRunnerYs = [], zRunnerNLs = [], zBoxInfo = [];
        const zStart = parts.length;
        buildDrawerBoxes({
          parts, warnings, sec: zv, secName: zLabel, secCenterX, drawerHeights: st.heights,
          sectionOpening: secW, innerDepth: D - tb, t, decor, back, backT: tb,
          frontZ: D / 2, boxInfo: zBoxInfo,
          facadeBaseY: zP0, gap,
          drawerDecor: zDecor, drawerT: effectiveDrawerThickness(zv, p),
          baseY: zFloor + drawerLift(zv), innerTopY: zNicheTop,
          runnerYs: zRunnerYs, runnerNLs: zRunnerNLs, innerBottomY: zFloor,
        });
        const zSys = window.Modul3D.catalog.DRAWER_SYSTEMS[zv.drawerSystem || 'ballBearing'];
        if ((zv.drawerSystem || 'ballBearing') === 'innotech' && zRunnerYs.length) {
          const secSideT = [i === 0 ? tL : t, i === n - 1 ? tR : t];
          if (secSideT.some((v) => Math.abs(v - t) > 0.05)) {
            warnings.push(`${zLabel}: ящики Hettich InnoTech Atira — толщина боковины `
              + `${secSideT.filter((v) => Math.abs(v - t) > 0.05).join('/')} мм отличается от корпусной ${t} мм; `
              + `монтажный зазор EB и присадка Atira посчитаны по толщине корпуса ${t} мм — сверьте с каталогом Hettich.`);
          }
        }
        zRunnerYs.forEach((ry, ri) => {
          drawerMounts.push({ y: ry, panels: [panelLX(i), panelRX(i)], cx: secCenterX,
            nl: zRunnerNLs[ri], cabinetHoles: zSys && zSys.cabinetHoles,
            altShift: zSys && zSys.altHoleShift });
        });
        infoRowBox.zoneDrawerBoxes[zi] = zBoxInfo;

        // Жёсткая полка над стопкой отсека: только если выше неё остаётся место
        // (граница отсека уже имеет полку-перегородку — не дублируем).
        const zFrontTop = zP0 + st.sum;
        st.floorAbove = zFrontTop;
        if (zNicheTop - Math.max(zFloor, zFrontTop) >= t + 40) {
          const zBoxTop = parts.slice(zStart)
            .filter((q) => /^drawer/.test(q.kind) && q.kind !== 'drawerFront' && q.box)
            .reduce((m, q) => Math.max(m, q.box.y + q.box.h / 2), -Infinity);
          const zy = Math.max(zv.facade !== 'open' ? zFrontTop : zFrontTop - gap + 2 - t / 2,
            zBoxTop + t / 2 + 0.6);
          shelfEntries.push({ y: zy, fixed: true, fullDepth: true, zdt: zi,
            drag: Object.assign(drawerStackDrag('zdrawers', zv, st.heights.length, st.sum), { zi }) });
          st.floorAbove = zy + t / 2;
        }
      }
    }
    // ПЕРЕТАСКИВАНИЕ ПОЛОК В 3D: допустимый диапазон каждой полки — между
    // соседями ТОЙ ЖЕ группы (перегородки секции / полки одного отсека / полки
    // секции) и границами группы; между плоскостями остаётся не менее
    // SHELF_DRAG_CLEAR мм (тот же запас 40 мм, что и в проверке «под полки не
    // осталось места» выше). heights — высоты НИЖНИХ плоскостей всех полок группы
    // в «ручном» виде (для зоны — от низа ниши, для секции — от дна), по индексу k.
    {
      const groups = {};
      // Полка над ящиками: диапазон — от минимальной высоты фасадов выбранной системы
      // до ближайшей полки выше (или крыши), группы нет.
      for (const e of shelfEntries) {
        const dd = e.drag;
        if (!dd || !dd.stack) continue;
        const above = shelfEntries.filter((o) => o !== e && o.y > e.y).map((o) => o.y);
        const hi = above.length ? Math.min.apply(null, above) - t - SHELF_DRAG_CLEAR
          : innerBottomY + innerH - SHELF_DRAG_CLEAR - t / 2;
        Object.assign(dd, { yMin: round1(e.y + dd.n * dd.minFront - dd.S), yMax: round1(hi), heights: null });
      }
      for (const e of shelfEntries) if (e.drag && !e.drag.stack) (groups[e.drag.group] = groups[e.drag.group] || []).push(e);
      for (const key of Object.keys(groups)) {
        const g = groups[key].slice().sort((a, b) => a.y - b.y);
        const heights = [];
        for (const e of g) heights[e.drag.k] = round1(e.y - t / 2 - (e.drag.kind === 'zone' ? e.zb : innerBottomY));
        g.forEach((e, gi) => {
          const lo = gi > 0 ? g[gi - 1].y + t + SHELF_DRAG_CLEAR : e.drag.floor + SHELF_DRAG_CLEAR + t / 2;
          const hi = gi < g.length - 1 ? g[gi + 1].y - t - SHELF_DRAG_CLEAR : e.drag.top - SHELF_DRAG_CLEAR - t / 2;
          Object.assign(e.drag, { yMin: round1(lo), yMax: round1(hi),
            heights: e.drag.kind === 'partition' ? null : heights.slice() });
        });
      }
    }
    for (let si = 0; si < shelfEntries.length; si++) {
      const y = shelfEntries[si].y;
      const isFixed = shelfEntries[si].fixed;
      if (!shelfEntries[si].drawerTop && shelfEntries[si].zdt === undefined
        && (y < innerBottomY + drawerZoneH - 1 || y > innerBottomY + innerH + 1)) {
        warnings.push(`${secName}: полка на высоте ${Math.round(y - innerBottomY)} мм выходит за пределы секции.`);
        continue;
      }
      // Во всю глубину корпуса — только полка-перегородка на стыке отсеков (фасады
      // упираются в неё) и полка над ящиками; жёсткая полка, заданная вручную,
      // по глубине как съёмная (решение пользователя 2026-10-06).
      const fullDepth = isFixed && !!shelfEntries[si].fullDepth;
      const width = fullDepth ? D : shelfDepth;
      if (secW - 2 > 900 && t <= 16) {
        warnings.push(`${secName}: полка ${Math.round(secW - 2)} мм из ЛДСП ${t} мм прогнётся — добавьте стойку (раздел «Секции») или возьмите материал толще.`);
      }
      // За стеклянным фасадом полки делают из стекла 6 мм — их видно. Для
      // несъёмной Rastex-перегородки это не применимо: она держит корпус,
      // а не просто лежит на полкодержателях, стекло тут неуместно.
      // Съёмная полка отсека (многозонный пенал) — по фасаду СВОЕЙ зоны
      // (sec.doorZones[zi] может переопределять вид фасада, см. zoneFacadeSettings).
      const shelfZi = shelfEntries[si].zi;
      const shelfSec = shelfZi !== undefined ? zoneFacadeSettings(sec, shelfZi) : sec;
      const shelfGlassBehind = facadeTypeOf(shelfSec, decor, t, facadeMat, p.facadeThickness).glassInside;
      const glassShelf = !isFixed && shelfGlassBehind;
      const GL = window.Modul3D.catalog.GLASS;
      // Полка видна (2мм), только если секция открыта или за стеклом —
      // закрытая фасадом полка кромится технической кромкой (не видна).
      // Несъёмная перегородка на стыке зон — по всей секции (консервативно).
      const shelfFrontHidden = shelfZi !== undefined
        ? (sectionHasAnyFacade(sec) && !shelfGlassBehind)
        : sectionFrontHidden(sec, decor, t, facadeMat, p.facadeThickness);
      parts.push(makePart({
        name: glassShelf ? 'Полка стеклянная' : 'Полка', section: secName,
        material: glassShelf ? GL.code : decor.code,
        thickness: glassShelf ? GL.thickness : t,
        length: isFixed ? secW : secW - 2, width, qty: 1, kind: 'shelf',
        glass: glassShelf, fixed: isFixed,
        shelfRef: shelfEntries[si].drag ? Object.assign({ si: i, y: round1(y), t }, shelfEntries[si].drag) : null,
        note: glassShelf
          ? 'Стекло 6 мм, на полкодержателях с силиконовой пяткой'
          : ((shelfEntries[si].drawerTop || shelfEntries[si].zdt !== undefined)
            ? 'Несъёмная, над ящиками, во всю глубину корпуса, крепится минификсами Rastex к боковинам'
            : isFixed && !fullDepth
            ? 'Жёсткая (несъёмная), глубина как у съёмной, крепится минификсами Rastex к боковинам и стойкам'
            : isFixed
            ? 'Несъёмная, во всю глубину корпуса, крепится минификсами Rastex к боковинам — '
              + 'на стыке фасадов, для жёсткости пенала'
            : 'Съёмная, на полкодержателях'),
        edging: glassShelf
          ? { long1: null, long2: null, short1: null, short2: null }
          : { long1: shelfFrontHidden ? EDGE_BACK : EDGE_FRONT, long2: EDGE_BACK, short1: EDGE_BACK, short2: EDGE_BACK },
        x: secCenterX, y, z: fullDepth ? 0 : (D / 2 - SHELF_SETBACK) - shelfDepth / 2,
        dims: { w: isFixed ? secW : secW - 2, h: glassShelf ? GL.thickness : t, d: width },
      }));
    }

    // Штанга и пантограф — два независимых выбора секции (можно оба сразу:
    // пантограф сверху, штанга ниже), у каждого своя высота от дна секции.
    // То же самое умеет ОТСЕК многозонной секции (sec.doorZones[zi].rod/rod2/
    // pantograph…) — те же правила, но границы = ниша отсека (решение 2026-10-07).
    // owner — секция либо отсек (читаем rod*/pantograph* из него), o — границы:
    // floorY — «дно» для высот (дно секции / низ ниши), secFloor — нижняя граница
    // свободного объёма пантографа, roofY — верх, rodShelfYs/shelfYsAll — плоскости
    // полок внутри, reachY0 — пол корпуса для проверки «выше 2100 от дна».
    const buildRodAndPantograph = (owner, o) => {
      const { label, floorWord, floorY, secFloor, roofY, rodShelfYs, shelfYsAll, reachY0, isZone } = o;
      const ROD_D = 25;
      const ROD_TOP_GAP = 50;      // просвет от ВЕРХНЕЙ КРОМКИ трубы до полки/крыши, мм (подтверждено 2026-10-05)
      // Минимальная высота оси штанги от дна секции по типу одежды
      const ROD_CLOTHES_MIN = ROD_CLOTHES_HEIGHT;   // и авто-высота оси при выборе «что вешаем» (решение 2026-10-06)
      const ROD_CLOTHES_NAME = { long: 'длинной одежды', mid: 'средней одежды', short: 'коротких вещей' };
      const ROD_BACK_MIN = 300;    // минимум от задней стенки до оси, мм
      // Нижний предел оси второй штанги (авто-высоты 1000/2050 — абсолютные, от пола корпуса):
      // в отсеке труба не ниже его дна (с просветом ROD_TOP_GAP).
      const lowestRodY = isZone ? floorY + ROD_TOP_GAP + ROD_D / 2 : -Infinity;

      // По высоте: под ближайшей полкой сверху (или под крышей).
      const above = rodShelfYs
        .filter((y) => y > floorY + 100);
      let ceiling = above.length ? Math.min.apply(null, above) - t / 2 : roofY;
      const innerBackZ = -D / 2 + tb;          // внутренняя плоскость задней стенки
      const innerFrontZ = D / 2;               // передняя плоскость корпуса
      // Зона механизма пантографа по высоте (для проверки столкновения со штангой).
      let pgZone = null;

      if (owner.pantograph) {
        // ----- Пантограф GTV PG-ST (опускающаяся штанга) -----
        // Размеры — инструкция GTV (assets/drawings/gtv-pantograf-pg-st*.png):
        // ось верхней трубы → низ корпуса механизма 836 мм; корпус механизма
        // 140×260 мм на каждой боковине, ось рычага — на 1/2 глубины; свободная
        // ширина A/B/C = 545–700 / 645–910 / 875–1200; от крыши/полки до оси
        // трубы ≥ 30; глубина G ≥ 140; вынос рычагов при опускании 710 мм.
        // По умолчанию встаёт максимально высоко — ось на 30 мм ниже крыши/полки.
        const PG_DROP = 836, PG_BODY_W = 140, PG_BODY_H = 260;
        const PG_MIN_W = 545, PG_MAX_W = 1200, PG_FRONT_REACH = 710, PG_TOP_GAP = 30;
        const pgZ = (innerBackZ + innerFrontZ) / 2;   // ось рычага — на 1/2 глубины
        const wantedPg = Number(owner.pantographHeight);
        const manualPg = Number.isFinite(wantedPg) && wantedPg > 0;
        // Свободные отсеки секции по высоте: между верхом ящиков/дном, полками
        // (в т.ч. жёсткой над ящиками) и крышей. Механизм висит на 836 мм ниже
        // оси трубы, поэтому ему нужен отсек высотой не менее 836 + 30 мм.
        // PG_NEED — механически минимум по чертежу GTV; PG_COMFORT — минимальный свободный
        // отсек для одежды на плечиках (решение пользователя 2026-10-06: 1000 мм).
        const PG_NEED = PG_DROP + PG_TOP_GAP;
        const PG_COMFORT = 1000;
        const shelfPlanes = shelfYsAll.filter((y) => y > secFloor).sort((x, y) => x - y);
        const pgComps = [];
        let cBottom = secFloor;
        for (const sy of shelfPlanes) {
          pgComps.push({ bottom: cBottom, top: sy - t / 2 });
          cBottom = sy + t / 2;
        }
        pgComps.push({ bottom: cBottom, top: roofY });
        const compH = (c) => c.top - c.bottom;
        const inSection = (c) => Math.round(c.bottom - floorY) + '–' + Math.round(c.top - floorY);
        let comp;
        let pgY;
        if (manualPg) {
          const wantY = floorY + wantedPg;
          // отсек, в котором стоит заданная высота; если она попала в полку — ближайший отсек ниже
          comp = pgComps.filter((c) => c.top >= wantY - 0.5)[0] || pgComps[pgComps.length - 1];
          if (wantY < comp.bottom) {
            const below = pgComps.filter((c) => c.top <= wantY + 0.5).pop();
            if (below) comp = below;
          }
          pgY = Math.min(wantY, comp.top - PG_TOP_GAP);
          if (wantY > comp.top - PG_TOP_GAP + 0.5) {
            warnings.push(`${label}: пантограф на ${Math.round(wantedPg)} мм упирается в полку/крышу — `
              + `опущен до ${Math.round(pgY - floorY)} мм (от оси трубы до крыши/полки не менее ${PG_TOP_GAP} мм).`);
          }
        } else {
          // Авто: самый верхний отсек, куда механизм помещается; если такого нет — самый высокий.
          const comfy = pgComps.filter((c) => compH(c) >= PG_COMFORT - 0.5);
          const fits = pgComps.filter((c) => compH(c) >= PG_NEED - 0.5);
          comp = comfy.length ? comfy[comfy.length - 1]
            : (fits.length ? fits[fits.length - 1]
              : pgComps.slice().sort((x, y) => compH(y) - compH(x))[0]);
          pgY = comp.top - PG_TOP_GAP;
        }
        if (compH(comp) < PG_NEED - 0.5) {
          warnings.push(`${label}: пантограф не помещается — в отсеке на высоте ${inSection(comp)} мм `
            + `свободно ${Math.round(compH(comp))} мм, а механизму нужно не менее ${PG_NEED} мм `
            + `(${PG_DROP} мм вниз от оси трубы + ${PG_TOP_GAP} мм до крыши/полки). `
            + `Уберите полки/ящики под ним или поставьте пантограф в другую секцию.`);
        } else if (compH(comp) < PG_COMFORT - 0.5) {
          warnings.push(`${label}: в отсеке пантографа на высоте ${inSection(comp)} мм свободно `
            + `${Math.round(compH(comp))} мм — механизм встаёт, но для одежды на плечиках нужно не менее ${PG_COMFORT} мм.`);
        }
        if (secW < PG_MIN_W || secW > PG_MAX_W) {
          warnings.push(`${label}: ширина секции ${Math.round(secW)} мм вне диапазона пантографа GTV `
            + `(${PG_MIN_W}–${PG_MAX_W} мм) — подходящего размера нет.`);
        }
        if (D < PG_BODY_W) {
          warnings.push(`${label}: глубина корпуса ${Math.round(D)} мм меньше 140 мм — пантограф не встанет.`);
        }
        const pgTop = pgY + ROD_D / 2, pgBottom = pgY - PG_DROP;
        pgZone = { top: pgTop, bottom: pgBottom };
        parts.push(makePart({
          name: 'Пантограф (опускающаяся штанга)', section: label, material: 'PANTOGRAPH', thickness: 0,
          length: secW, width: PG_DROP, qty: 1, kind: 'pantograph',
          note: `GTV PG-ST, ось трубы ${Math.round(pgY - floorY)} мм от ${floorWord}, `
            + `просвет сверху ${Math.round(comp.top - pgY)} мм; при опускании выносится на ${PG_FRONT_REACH} мм вперёд`
            + (owner.pantographColor ? `, цвет: ${owner.pantographColor}` : ''),
          edging: { long1: null, long2: null, short1: null, short2: null },
          x: secCenterX, y: (pgTop + pgBottom) / 2, z: pgZ,
          dims: { w: secW, h: pgTop - pgBottom, d: PG_BODY_W },
          shape: 'pantograph',
          pantographColor: owner.pantographColor || null,
          hardware: true,
        }));
        // Присадка боковин по шаблону GTV: две колонки по 6 точек (7,5 мм от
        // краёв шаблона 140 мм), шаг сверху вниз 45/45/50/45/45, снизу 10 мм.
        // Диаметр на шаблоне не указан — берём Ø4 по винтам комплекта (Ø4×20).
        for (const sgn of [-1, 1]) {
          pantographPanels.push({
            panelX: sgn < 0 ? panelLX(i) : panelRX(i), bottomY: pgBottom, z: pgZ, secName: label,
            bodyH: PG_BODY_H, bodyW: PG_BODY_W,
          });
        }
      }

      // ----- Штанга для одежды -----
      // Нормы установки (см. README):
      //   • просвет от верхней кромки штанги до полки над ней — 50 мм; при отсутствии
      //     полки отсчёт от крыши;
      //   • от задней стенки до оси штанги — не менее 300 мм: плечики висят
      //     поперёк корпуса и упираются в заднюю стенку;
      //   • держатели (фланцы) крепятся к боковинам двумя саморезами.
      if (owner.rod) {
        // По глубине: ось по центру внутреннего пространства, но не ближе
        // ROD_BACK_MIN к задней стенке и не ближе 80 мм к фасаду.
        let rodZ = (innerBackZ + innerFrontZ) / 2;
        const minZ = innerBackZ + ROD_BACK_MIN;
        if (rodZ < minZ) rodZ = minZ;
        if (rodZ > innerFrontZ - 80) rodZ = innerFrontZ - 80;
        const backClear = rodZ - innerBackZ;
        if (backClear < ROD_BACK_MIN - 0.5) {
          warnings.push(`${label}: глубина корпуса ${Math.round(D)} мм мала для штанги — `
            + `от задней стенки до оси ${Math.round(backClear)} мм вместо ${ROD_BACK_MIN}; `
            + `плечики будут упираться.`);
        }
        const wanted = Number(owner.rodHeight);
        const manual = Number.isFinite(wanted) && wanted > 0;
        // Авто-высота оси штанги: 1500 мм от дна секции одна штанга; 2050 мм верхняя при двух штангах (нижняя 1000, зазор между трубами
        // 1000 мм + толщина труб); 1300 мм под пантографом, но не ниже механизма.
        // Две штанги (без пантографа): нижняя считается раньше верхней — размер «что вешаем»
        // у ВЕРХНЕЙ откладывается от нижней штанги, а не от дна секции (решение 2026-10-06).
        const twoRods = !!owner.rod2 && !owner.pantograph;
        let rod2Y = 0;
        if (twoRods) {
          const w2 = Number(owner.rod2Height);
          rod2Y = Number.isFinite(w2) && w2 > 0 ? floorY + w2
            : (ROD_CLOTHES_MIN[owner.rod2Clothes] ? floorY + ROD_CLOTHES_MIN[owner.rod2Clothes] : 1000);   // авто — по типу одежды, иначе 1000 мм от пола
          rod2Y = Math.max(rod2Y, lowestRodY);
        }
        const clothesH = ROD_CLOTHES_MIN[owner.rodClothes] || 0;
        const clothesY = !clothesH ? 0 : (twoRods ? rod2Y + clothesH : floorY + clothesH);   // выбран тип одежды — высота по нему
        // Без выбранного типа одежды — как для длинной (1500 от дна секции, решение 2026-10-06);
        // две штанги — верхняя 2050 от пола; рядом с пантографом — не ниже механизма.
        const longY = floorY + ROD_CLOTHES_MIN.long;
        const rodDefaultY = pgZone ? Math.min(clothesY || longY, pgZone.bottom - 30) : (clothesY || (owner.rod2 ? 2050 : longY));
        // Отсек штанги определяется ЖЕЛАЕМОЙ высотой (заданной или авто), а не нижней полкой секции:
        // верх — ближайшая полка над желаемой осью, низ — ближайшая под ней (иначе при ручных
        // полках штанга 1550 уезжала под нижнюю полку на 318 мм).
        const wantY = manual ? floorY + wanted : rodDefaultY;
        const shelfAboveWant = above.filter((y) => y - t / 2 >= wantY - 0.5);
        ceiling = shelfAboveWant.length ? Math.min.apply(null, shelfAboveWant) - t / 2 : roofY;
        const shelfBelowWant = above.filter((y) => y - t / 2 < wantY - 0.5);
        const compBottom = shelfBelowWant.length ? Math.max.apply(null, shelfBelowWant) + t / 2 : -Infinity;
        let rodY = manual ? floorY + wanted : Math.min(rodDefaultY, ceiling - ROD_TOP_GAP - ROD_D / 2);
        if (rodY - ROD_D / 2 < compBottom) {
          if (manual) {
            warnings.push(`${label}: штанга на ${Math.round(rodY - floorY)} мм стоит на полке/внутри полки под ней — `
              + `поднимите штангу или уберите полку.`);
          } else {
            rodY = compBottom + ROD_D / 2;   // авто: поднимаем из полки на её верх
          }
        }
        if (twoRods && !manual && clothesY && clothesY > ceiling - ROD_TOP_GAP - ROD_D / 2 + 0.5) {
          warnings.push(`${label}: верхняя штанга на ${clothesH} мм над нижней встала бы на ${Math.round(clothesY - floorY)} мм `
            + `от ${floorWord} — выше секции (максимум ${Math.round(ceiling - ROD_TOP_GAP - ROD_D / 2 - floorY)} мм). `
            + `Установите пантограф или выберите размер меньше.`);
        }
        const topLimit = ceiling - ROD_D / 2 - 10;
        if (rodY > topLimit) {
          warnings.push(`${label}: штанга на ${Math.round(rodY - floorY)} мм упирается в полку — `
            + `опущена до ${Math.round(topLimit - floorY)} мм.`);
          rodY = topLimit;
        }
        if (isZone && rodY - ROD_D / 2 < floorY) {
          warnings.push(`${label}: отсек слишком низкий для штанги — труба Ø${ROD_D} мм не помещается между дном отсека и полкой/крышей.`);
        }
        const topGap = ceiling - rodY - ROD_D / 2;
        if (manual && topGap < ROD_TOP_GAP - 0.5) {
          warnings.push(`${label}: просвет от трубы до полки сверху ${Math.round(topGap)} мм — `
            + `для плечиков нужно не менее ${ROD_TOP_GAP} мм.`);
        }
        const clothesMin = ROD_CLOTHES_MIN[owner.rodClothes];
        if (clothesMin && !twoRods && rodY - floorY < clothesMin - 0.5) {
          warnings.push(`${label}: штанга на ${Math.round(rodY - floorY)} мм от ${floorWord} — `
            + `для ${ROD_CLOTHES_NAME[owner.rodClothes]} нужно не ниже ${clothesMin} мм.`);
        }
        if (!owner.pantograph && rodY - reachY0 > 2100) {
          warnings.push(`${label}: штанга выше 2100 мм от дна недоступна рукой — `
            + `нужен лифт-пантограф или опустите штангу.`);
        }

        // Штанга и пантограф в одной секции: держатели штанги не должны стоять
        // на корпусе механизма пантографа (он занимает 836 мм вниз от его трубы).
        if (pgZone && rodY + 20 > pgZone.bottom && rodY - 20 < pgZone.top) {
          warnings.push(`${label}: штанга на ${Math.round(rodY - floorY)} мм попадает в зону механизма `
            + `пантографа (${Math.round(pgZone.bottom - floorY)}–${Math.round(pgZone.top - floorY)} мм) — `
            + `опустите штангу ниже ${Math.round(pgZone.bottom - floorY)} мм.`);
        }

        const rodLen = secW - 2;
        const emitRod = (y, noteExtra) => {
          parts.push(makePart({
            name: 'Штанга для одежды', section: label, material: 'ROD-D25', thickness: 0,
            length: rodLen, width: ROD_D, qty: 1, kind: 'rod',
            note: `Ø${ROD_D} мм, ${Math.round(y - floorY)} мм от ${floorWord}, `
              + noteExtra + `от задней стенки ${Math.round(backClear)} мм`,
            edging: { long1: null, long2: null, short1: null, short2: null },
            x: secCenterX, y, z: rodZ,
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
              name: 'Держатель штанги (фланец)', section: label, material: 'ROD-H25', thickness: 0,
              length: 40, width: 40, qty: 1, kind: 'rodFlange',
              note: 'Крепится к панели двумя саморезами',
              edging: { long1: null, long2: null, short1: null, short2: null },
              x: px, y, z: rodZ,
              dims: { w: 6, h: 40, d: 40 },
              shape: 'flange',
              hardware: true,
            }));
            rodFlanges.push({ panelX: sgn < 0 ? panelLX(i) : panelRX(i), y, z: rodZ, secName: label });
          }
        };
        emitRod(rodY, `просвет от трубы до полки сверху ${Math.round(ceiling - rodY - ROD_D / 2)} мм, `);

        // Вторая (нижняя) штанга — двухъярусная схема: верхняя для длинного,
        // нижняя для коротких вещей. Расстояние между осями — не менее
        // ROD_PAIR_MIN (минимум для коротких вещей, подтверждено 2026-10-05).
        // Полки между штангами нет, правило 50 мм до полки к нижней не относится.
        if (twoRods) {
          const ROD_PAIR_MIN = 1000;
          if (rodY - rod2Y < ROD_PAIR_MIN - 0.5) {
            warnings.push(`${label}: расстояние между штангами ${Math.round(rodY - rod2Y)} мм — `
              + `для коротких вещей нужно не менее ${ROD_PAIR_MIN} мм.`);
          }
          emitRod(rod2Y, `нижняя штанга, до верхней ${Math.round(rodY - rod2Y)} мм, `);
        }
      }
    };
    if (sec.rod || sec.pantograph) {
      buildRodAndPantograph(sec, {
        label: secName, floorWord: 'дна секции', floorY: innerBottomY,
        secFloor: drawerZoneH > 0 ? Math.max(innerBottomY, baseH + drawerZoneH) : innerBottomY,
        roofY: innerBottomY + innerH,
        rodShelfYs: infoRow && infoRow.shelfYs ? infoRow.shelfYs : [],
        shelfYsAll: shelfEntries.map((e) => e.y),
        reachY0: innerBottomY, isZone: false,
      });
    }
    // Штанга/пантограф ОТСЕКОВ многозонной секции: границы — ниша отсека
    // (layoutDoorZones, как у полок отсека выше). Отсеку с техникой — не строим.
    if (multiZone && sec.doorZones.some((z, zi) => zi < sec.doorZoneCount && z && (z.rod || z.pantograph))) {
      const azSlotBot = zpSlotBot;
      const azLayout = zonePlan.layout;
      const azCount = Number(sec.doorZoneCount);
      for (let zi = 0; zi < azCount; zi++) {
        const dz = sec.doorZones[zi] || {};
        if (!(dz.rod || dz.pantograph) || (dz.appliance || 'none') !== 'none') continue;
        let zFloor = azSlotBot + azLayout.nicheBottoms[zi];
        const zTop = azSlotBot + azLayout.nicheBottoms[zi] + azLayout.nicheHeights[zi];
        // Отсек с ящиками: дно штанги/пантографа — верх стопки ящиков отсека
        // (или несъёмной полки над ней).
        const zStk = zonePlan.stacks[zi];
        if (zStk && zStk.floorAbove !== undefined) zFloor = Math.max(zFloor, zStk.floorAbove);
        // Нижний отсек над ящиками: дно — верх жёсткой полки над ящиками.
        const dtShelf = shelfEntries.filter((e) => e.drawerTop)[0];
        if (zi === 0 && dtShelf) zFloor = Math.max(zFloor, dtShelf.y + t / 2);
        const zPlanes = shelfEntries.map((e) => e.y).filter((y) => y > zFloor + 0.5 && y < zTop - 0.5);
        const zLabel = `${secName} (${zi === 0 ? 'нижняя зона' : (zi === azCount - 1 ? 'верхняя зона' : `зона ${zi + 1}`)})`;
        buildRodAndPantograph(dz, {
          label: zLabel, floorWord: 'низа отсека', floorY: zFloor, secFloor: zFloor, roofY: zTop,
          rodShelfYs: zPlanes, shelfYsAll: zPlanes, reachY0: innerBottomY, isZone: true,
        });
      }
    }
  }

  // ---------- Шурупы задней стенки ----------
  // Правило (подтверждено пользователем 2026-09-23, для ВСЕХ режимов):
  // шаг 150 мм; шурупы идут в каждую деталь, с которой стенка соприкасается,
  // КРОМЕ съёмных полок и деталей с пазом — то есть в боковины без паза,
  // крышу/дно без паза, заднюю планку (царгу), несъёмные полки и стойки.
  // На каждую линию контакта длиной L: n = ceil(L / 150) + 1. L — перекрытие
  // детали со стенкой: у вертикальных — по высоте, у горизонтальных — по
  // ширине. Итог — backPart.screws, specification.js берёт его оттуда.
  if (backPart) {
    const BACK_SCREW_STEP = 150;
    const bb = backPart.box;
    const bx0 = bb.x - bb.w / 2, bx1 = bb.x + bb.w / 2;
    const by0 = bb.y - bb.h / 2, by1 = bb.y + bb.h / 2;
    const ovl = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
    const hasBackGroove = (q) => (q.grooves || []).some((g) => g.kind === 'backGroove');
    // Торец детали на задней плоскости корпуса (-D/2) — к нему и прижата
    // стенка. Передняя планка, более глубокая видимая боковина — не касаются.
    const atBackPlane = (q) => Math.abs((q.box.z - q.box.d / 2) + D / 2) < 0.6;
    let screws = 0;
    for (const q of parts) {
      if (q === backPart || q.hardware || hasBackGroove(q)) continue;
      const b = q.box;
      const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y - b.h / 2, y1 = b.y + b.h / 2;
      let L = 0;
      if (q.kind === 'side') {
        if (!atBackPlane(q) || ovl(x0, x1, bx0, bx1) <= 0) continue;
        L = ovl(y0, y1, by0, by1);
      } else if (q.kind === 'divider') {
        // Стойка во всю глубину корпуса, торец на задней плоскости.
        if (!atBackPlane(q)) continue;
        L = ovl(y0, y1, by0, by1);
      } else if (q.kind === 'top' || q.kind === 'bottom' || (q.kind === 'shelf' && q.fixed)) {
        if (!atBackPlane(q) || ovl(y0, y1, by0, by1) <= 0) continue;
        L = ovl(x0, x1, bx0, bx1);
      } else {
        continue;
      }
      if (L > 0.5) screws += Math.ceil(L / BACK_SCREW_STEP) + 1;
    }
    backPart.screws = screws;
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
      const mode = sgn < 0 ? effLeft : effRight;
      const panel = sidePart(sgn < 0 ? sideXL : sideXR);
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
        // Крыша/дно С ПАЗОМ под заднюю стенку удлинены назад на E, но крепёж
        // к боковине расставляется по прежней глубине корпуса D от переднего
        // края (как у детали без паза): задний крепёж остаётся в 50 мм от
        // задней плоскости корпуса и не приближается к пазу, а расстояния
        // от переднего края не меняются. y считается от ЗАДНЕЙ кромки, поэтому
        // точки сдвигаются на удлинение.
        const grooveExtra = (hp.grooves || []).some((g) => g.kind === 'backGroove')
          ? Math.max(0, hp.box.d - D) : 0;
        const pts = grooveExtra
          ? jointPoints(D).map((v) => round1(v + grooveExtra))
          : jointPoints(hp.box.d, hp.kind === 'shelf');
        // Кто кого перекрывает
        const bottomOverlays = (hp.kind === 'bottom') && (mode === 'onBottom');
        // ДНО НАВЕСНОГО модуля (вкладное) — решение пользователя 2026-09-27:
        // низ верхнего модуля виден, поэтому крепёж по стороне зависит от
        // видимости боковины, а не от её типа:
        //   • закрытая соседом — КОНФИРМАТ (через боковину в торец дна,
        //     шляпку закрывает сосед);
        //   • видимая — RASTEX, гнездо эксцентрика в дне С ВНУТРЕННЕЙ
        //     (верхней) пласти, чтобы снизу эксцентриков не было видно;
        //     дюбель — в боковине изнутри, как обычно.
        // Крыша и полки — прежнее правило.
        const hungBottom = hungModule && hp.kind === 'bottom' && !bottomOverlays;
        const jointHere = hungBottom
          ? (sideVisible[sgn < 0 ? 'left' : 'right'] ? 'minifix' : 'confirmat')
          : joint;

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

          if (bottomOverlays && hungModule) {
            // НАВЕСНОЙ модуль, боковина «на дно» (решение пользователя
            // 2026-09-27): низ дна виден снизу в комнате, поэтому конфирмат
            // «снизу через дно» (ветка ниже, для напольных тумб) здесь не
            // годится — шляпка была бы видна. Тот же T-образный узел, что и
            // у столешницы на торце боковины (см. выше, forJoint:'countertop',
            // подтверждено владельцем-мебельщиком 2026-09-05), но
            // перевёрнутый: боковина сверху упирается ТОРЦОМ в ПЛАСТЬ дна.
            // Эксцентрик и болт — в боковине (её торец касается дна, x=0 —
            // низ боковины), дюбель — в дне со скрытой верхней пласти
            // (side:'front', внутри корпуса, как у обычного hungBottom выше).
            panel.holes.push({ x: round1(RASTEX.camSetback), y: round1(yOnPanel),
                               d: RASTEX.camD, depth: RASTEX.camDepthFor(panel.thickness),
                               through: false, side: 'front', kind: 'minifixCam' });
            panel.holes.push({ x: 0, y: round1(yOnPanel), d: RASTEX.boltD, depth: RASTEX.boltDepth,
                               through: false, side: 'edge', kind: 'minifixBolt' });
            hp.holes.push({ x: round1(xFace), y: round1(py), d: RASTEX.dowelD, depth: RASTEX.dowelDepth,
                            through: false, side: 'front', kind: 'minifixDowel' });
          } else if (bottomOverlays) {
            // Напольная тумба, боковина «на дно» — конфирмат снизу через
            // дно в нижний торец боковины: низ дна скрыт за цоколем, шляпку
            // не видно (см. jointForSide выше).
            hp.holes.push({ x: round1(xFace), y: round1(py), d: 7, depth: 0,
                            through: true, side: 'front', kind: 'confirmatThrough' });
            panel.holes.push({ x: 0, y: round1(yOnPanel), d: 5, depth: 50,
                               through: false, side: 'edge', kind: 'confirmatEdge' });
          } else if (jointHere === 'confirmat') {
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
            // Исключение — дно НАВЕСНОГО модуля (hungBottom): его низ виден,
            // гнездо сверху, внутри корпуса (решение пользователя 2026-09-27).
            const camSide = (hp.kind === 'top' || hungBottom) ? 'front' : 'back';
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
        // УСИЛЕНИЕ УЗЛА БОКОВИНА-ДНО ШКАНТАМИ (решение пользователя,
        // 2026-09-28): у НИЖНЕГО (напольного) модуля, когда боковина «сбоку
        // дна» или «до пола» (несущая или видимая — именно поэтому её
        // крепление важнее обычного), штатного минификса Rastex 15 в точках
        // pts недостаточно — добавляем ещё 2 шканта 8×30 (см. ПРАВИЛА-
        // КОНСТРУИРОВАНИЯ.md, «Шкант (нагель) 8×30» — Ø8 в торец глубиной 20
        // + Ø8 в пласть глубиной 13 = 33 мм на шкант 30, те же числа, что и у
        // dowelEdge/dowelFace ниже). Только узел ДНО (не крыша — так попросил
        // пользователь), только для floor/besideBottom (на onBottom дно
        // крепится конфирматом, это уже другой узел). НЕ для навесных
        // модулей (!hungModule) — просьба была именно про нижний модуль, и
        // у навесного нагрузка идёт через шину навески, а не через этот узел
        // (там же mode='besideBottom'/'floor' — обычный, не экзотический
        // выбор в панели, а не про упор в пол). Ставим МЕЖДУ существующими
        // точками jointPoints, где присадки минификса ещё нет — при n>=2
        // середины крайних пар точек гарантированно не совпадают ни с одной
        // из них (jointPoints кладёт точки равномерно от JOINT_SETBACK до
        // depth-JOINT_SETBACK).
        if (!hungModule && hp.kind === 'bottom' && (mode === 'floor' || mode === 'besideBottom') && pts.length >= 2) {
          const n = pts.length;
          const reinforceYs = n >= 3
            ? [round1((pts[0] + pts[1]) / 2), round1((pts[n - 2] + pts[n - 1]) / 2)]
            : [round1(pts[0] + (pts[1] - pts[0]) / 3),
               round1(pts[0] + 2 * (pts[1] - pts[0]) / 3)];
          const atLeftR = panel.box.x < hp.box.x;
          for (const pyR of reinforceYs) {
            const zAbsR = (hp.box.z - hp.box.d / 2) + pyR;
            const yOnPanelR = round1(zAbsR - pBackZ);
            hp.holes.push({ x: atLeftR ? 0 : hp.length, y: round1(pyR), d: 8, depth: 20,
                            through: false, side: 'edge', kind: 'dowelEdge' });
            panel.holes.push({ x: round1(hp.box.y - pBottom), y: yOnPanelR,
                               d: 8, depth: 13, through: false, side: 'front', kind: 'dowelFace' });
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
        jointRows.push({
          joint: bottomOverlays ? (hungModule ? 'minifix' : 'confirmat') : jointHere,
          qty: pts.length,
        });
      }
    }

    // НЕСЪЁМНАЯ ПОЛКА МЕЖДУ СТОЙКАМИ: цикл выше обходит только наружные
    // боковины, поэтому торцы, которыми жёсткая полка (в т.ч. над ящиками)
    // упирается во внутреннюю стойку, оставались без крепежа. Здесь тот же
    // минификс Rastex 15: гнездо и болт — в торце полки, дюбель — в стойке.
    // Полка стоит вплотную к стойке (ширина = внутренний размер секции).
    for (const hp of parts.filter((q) => q.kind === 'shelf' && q.fixed)) {
      for (const dv of parts.filter((q) => q.kind === 'divider')) {
        if (Math.abs(Math.abs(dv.box.x - hp.box.x) - (hp.box.w / 2 + dv.box.w / 2)) > 1.5) continue;
        if (Math.abs(dv.box.y - hp.box.y) > dv.box.h / 2) continue;
        const dvBottom = dv.box.y - dv.box.h / 2;
        const dvBackZ = dv.box.z - dv.box.d / 2;
        const atLeftD = dv.box.x < hp.box.x;
        const xEdgeD = atLeftD ? 0 : hp.length;
        const camXD = atLeftD ? RASTEX.camSetback : hp.length - RASTEX.camSetback;
        const ptsD = jointPoints(hp.box.d, true);
        for (const py of ptsD) {
          const yOnDv = (hp.box.z - hp.box.d / 2) + py - dvBackZ;
          hp.holes.push({ x: round1(camXD), y: round1(py), d: RASTEX.camD,
                          depth: RASTEX.camDepthFor(hp.thickness),
                          through: false, side: 'back', kind: 'minifixCam' });
          hp.holes.push({ x: round1(xEdgeD), y: round1(py), d: RASTEX.boltD,
                          depth: RASTEX.boltDepth,
                          through: false, side: 'edge', kind: 'minifixBolt' });
          // Дюбель — в пласть стойки, обращённую к секции этой полки.
          dv.holes.push({ x: round1(hp.box.y - dvBottom), y: round1(yOnDv),
                          d: RASTEX.dowelD, depth: RASTEX.dowelDepth, through: false,
                          side: atLeftD ? 'back' : 'front', kind: 'minifixDowel' });
        }
        jointRows.push({ joint: 'minifix', qty: ptsD.length });
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
  // Высота оси отверстия под полку на высоте sy (None — несъёмная полка без
  // полкодержателей). Нужна и для самой присадки, и чтобы найти пары полок
  // соседних секций на одной высоте на общей стойке.
  const pinShelfPart = (sy) => parts.filter((p) => p.kind === 'shelf'
    && Math.abs(p.box.y - sy) < 1)[0];
  const pinYOf = (sy) => {
    const sp = pinShelfPart(sy);
    if (sp && sp.fixed) return null;
    return sy - (sp ? sp.box.h : t) / 2 - 2.5;
  };
  for (const row of secInfo) {
    const bounds = shelfPanelX[row.index];
    if (!bounds) continue;
    const rowCx = (bounds[0] + bounds[1]) / 2;
    // Полки соседней секции СЛЕВА (с ней общая стойка bounds[0]).
    const leftRow = secInfo.filter((r) => r.index === row.index - 1)[0];
    const leftPinYs = leftRow
      ? (leftRow.shelfYs || []).map(pinYOf).filter((v) => v !== null) : [];
    for (const sy of (row.shelfYs || [])) {
      // Полка ЛЕЖИТ на штифте, значит отверстие идёт НИЖЕ полки — по её
      // нижней плоскости, а не по середине толщины.
      const shelfPart = pinShelfPart(sy);
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
        // Пласть, обращённая К СВОЕЙ секции (на общей стойке у правой секции —
        // «back», у левой — «front»; раньше всегда «front» и отверстия правой
        // секции оказывались во второй).
        const pinSide = (rowCx > px) === (px < 0) ? 'front' : 'back';
        // Общая стойка: если полка соседа слева на той же высоте, отверстия
        // двух сторон встретились бы в толще плиты — эту сторону сдвигаем
        // назад по глубине на 10 мм. На разной высоте сдвига нет.
        const sameHeight = panel.kind === 'divider' && Math.abs(px - bounds[0]) < 1.5
          && leftPinYs.some((v) => Math.abs(v - pinY) < 6);
        const pinShift = sameHeight ? 10 : 0;
        for (const ly0 of [backY + SUP_SETBACK, frontY - SUP_SETBACK]) {
          const ly = ly0 - pinShift;
          drillPanel(px, localX, ly, { kind: 'shelfSupport', side: pinSide });
          // Сам полкодержатель — фурнитура: виден в 3D, в деталировку не идёт
          const zAbs = (panel.box.z - panel.box.d / 2) + ly;
          parts.push(makePart({
            name: glassPin ? 'Полкодержатель для стекла' : 'Полкодержатель',
            section: 'Корпус', material: glassPin ? 'SUP-5G' : 'SUP-5', thickness: 0,
            length: 16, width: 5, qty: 1, kind: 'shelfPin',
            note: glassPin ? 'Штифт Ø5 с силиконовой пяткой' : 'Штифт Ø5',
            edging: { long1: null, long2: null, short1: null, short2: null },
            x: px + (pinSide === 'front' ? (px < 0 ? 8 : -8) : (px < 0 ? -8 : 8)), y: pinY, z: zAbs,
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
  // Сторона сверления: пласть панели, обращённая К СВОЕЙ секции. 'front'
  // у боковины/стойки — пласть к центру модуля (x=0), поэтому у левой
  // половины секция справа от панели → 'front', слева → 'back'; у правой —
  // наоборот. Раньше всегда 'front': на стойке между двумя секциями оба
  // ряда ложились на одну пласть.
  const runnerSide = (px, cx) => ((cx > px) === (px < 0) ? 'front' : 'back');
  for (const d of drawerMounts) {
    // Точки крепления профиля — от переднего края панели. У Quadro и GTV они
    // берутся из таблицы производителя (sys.cabinetHoles(NL)); у остальных —
    // прежние две точки 37 и 37+224.
    const pts = (d.cabinetHoles && Number.isFinite(d.nl)) ? d.cabinetHoles(d.nl)
      : [RUN_FRONT, RUN_FRONT + RUN_STEP];
    for (const px of d.panels) {
      const panel = panelAt(px);
      if (!panel) continue;
      const localX = d.y - (panel.box.y - panel.box.h / 2);
      const frontY = panel.box.d;
      const side = runnerSide(px, d.cx);
      // СТОЙКА МЕЖДУ СЕКЦИЯМИ: ряды двух сторон не должны попасть в одни и те
      // же точки (отверстия встретились бы в толще плиты). Секция справа от
      // стойки сверлится в СОСЕДНИХ отверстиях профиля — сдвиг altHoleShift
      // (Quadro: соседнее отверстие профиля, шаг 9 мм по чертежу Hettich; GTV: второе отверстие
      // слота, 15 мм) назад по глубине.
      const alt = panel.kind === 'divider' && d.cx > px;
      const shift = (alt && d.altShift) || 0;
      for (const fp of pts) {
        if (frontY - fp - shift < 6) continue;
        drillPanel(px, localX, frontY - fp - shift, { kind: 'drawerRunner', side });
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

  // Присадка под корпус пантографа GTV (шаблон из инструкции): 12 отверстий на
  // каждой боковине. Колонки — 7,5 и 132,5 мм от края шаблона 140 мм; ряды —
  // снизу 10, 55, 100, 150, 195, 240 мм (шаг сверху вниз 45/45/50/45/45).
  const PG_HOLE_D = 4;          // под винты комплекта Ø4×20 (диаметр на шаблоне не указан)
  const PG_ROWS = [10, 55, 100, 150, 195, 240];
  const PG_COLS = [7.5, 132.5];
  for (const f of pantographPanels) {
    const panel = parts.filter((p) => (p.kind === 'side' || p.kind === 'divider')
      && Math.abs(p.box.x - f.panelX) < 1.5)[0];
    if (!panel) continue;
    const baseX = f.bottomY - (panel.box.y - panel.box.h / 2);
    const baseY = (f.z - f.bodyW / 2) - (panel.box.z - panel.box.d / 2);
    for (const v of PG_ROWS) {
      for (const u of PG_COLS) {
        panel.holes.push({
          x: round1(baseX + v), y: round1(baseY + u),
          d: PG_HOLE_D, depth: 12, through: false, side: 'front', kind: 'pantographFix',
        });
      }
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

  // Выравнивание ручек больших дверей по ручке секции с отсеками (см.
  // alignBigDoorHandles): собираем кандидатов по ходу цикла, двигаем после него.
  const handleAlign = { big: [], divided: [] };
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
    // Заглушка строится только для нижней зоны (zi === 0) — толщина по ней.
    const blindFT = facadeTypeOf(zoneFacadeSettings(sec, 0), decor, t, facadeMat, p.facadeThickness);
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

    const ft = facadeTypeOf(sec, decor, t, facadeMat, p.facadeThickness);
    const ftSec = ft;
    // Фасады ящиков — свой вид/материал секции (sec.drawerFacadeType), иначе = ft.
    const dft = drawerFacadeTypeOf(sec, decor, t, facadeMat, p.facadeThickness);
    // Алюминиевая рамка на петле «для алюминиевой рамки» (profile.hinge ===
    // 'aluFrame'): чашку Ø35 не сверлим — вместо неё паз и 2 отверстия под
    // саморезы по паспорту Blum 71T950A (aluHingeCuts, 2026-09-26).
    // Количество петель в спецификации остаётся стандартным (doorHardware).
    const aluNoCup = aluSkipsHingeCup(ft);
    const dHeights = getDrawerHeights(sec, drawerUnitH, frontH, null, secName);
    const drawerZoneH = dHeights.reduce((s, v) => s + v, 0);

    // Фасады ящиков всегда начинаются от низа фронта секции: подъём короба
    // (drawerOffset) на фасад не влияет, иначе внизу зияла бы щель.
    // Тот же код строит и фасады ящиков ОТСЕКОВ (o.zoneIndex задан): o.owner —
    // секция либо её «виртуальная секция» отсека, o.y0 — низ стопки фасадов.
    const emitDrawerFronts = (o) => {
    const { heights: dHeights, label: secName, dft, owner: sec } = o;
    let dy = o.y0;
    for (let d = 0; d < dHeights.length; d++) {
      const fH = dHeights[d] - 2 * gap;
      const dh = handleHoles({ kind: 'drawerFront', width: facadeW, height: fH, handleId: o.handleId, handleCC: o.handleCC });
      // Присадка под крепление фасада к коробу и под держатели релинга.
      // Точные шаблоны отличаются по сериям — здесь типовая схема: два
      // крепления по осям царг, релинги над ними.
      const bi = (o.boxes || []).filter((x) => x.index === d)[0];
      const fixHoles = [];
      if (bi) {
        const spread = Math.max(80, (secWi - 60) / 2);
        const yFix = Math.min(Math.max(bi.bot + 25, 20), fH - 20);
        // ЛДСП-короб: фасад держат шурупы через переднюю стенку — два ряда
        // (высота стенки ≥ 120 мм) или один по центру. Одной точки по низу
        // мало: фасад проворачивается и «клюёт» носом.
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
      faceZ: D / 2 + dft.thickness / 2, t: dft.thickness });
      parts.push(makePart({
        name: `Фасад ящика ${d + 1}`, section: secName, sectionIndex: i,
        ...(o.zoneIndex !== undefined ? { zoneIndex: o.zoneIndex } : {}),
        material: dft.material, thickness: dft.thickness,
        facadeType: dft.id, ...facadePartFields(dft, facadeW, fH),
        length: facadeW, width: fH, qty: 1, kind: 'drawerFront', grain: true,
        holes: dh.holes.concat(fixHoles),
        note: 'Накладной' + (dh.count ? `, ручка ${dh.handle.name}` : ''),
        edging: { long1: facadeEdgeType(dft), long2: facadeEdgeType(dft), short1: facadeEdgeType(dft), short2: facadeEdgeType(dft) },
        x: fX, y: dy + dHeights[d] / 2, z: D / 2 + dft.thickness / 2,
        dims: { w: facadeW, h: fH, d: dft.thickness },
      }));
      drawerHardware.push({ section: secName, width: secWi, depth: D, system: sec.drawerSystem || 'ballBearing', pushToOpen: !!sec.pushToOpen,
        // Вариант комплекта: длина направляющих, код царги, цвет (sec.drawerColor — выбор пользователя; пусто у старых проектов)
        nl: bi ? bi.nl : undefined, heightCode: bi ? bi.code : undefined, color: sec.drawerColor || '' });
      dy += dHeights[d];
    }
    };
    emitDrawerFronts({ owner: sec, heights: dHeights, label: secName, dft, y0: baseH,
      boxes: (secInfo.filter((x) => x.index === i)[0] || {}).boxes,
      handleId: sec.handle, handleCC: sec.handleCC });

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
    if (zonesOn(sec)) {
      zonesRaw = [];
      for (let zi = 0; zi < sec.doorZoneCount; zi++) {
        const z = sec.doorZones[zi];
        zonesRaw.push({
          facade: (z && z.facade) || (sec.facade === 'doorRight' ? 'doorRight' : 'doorLeft'),
          height: (z && Number(z.height)) || 0,
          appliance: (z && z.appliance) || 'none',
          applianceW: (z && Number(z.applianceW)) || 0,
          applianceD: (z && Number(z.applianceD)) || 0,
          facadeWidth: (z && Number(z.facadeWidth)) || 0,
          note: (z && z.note) || '',
          // Ручка отсека: свои поля зоны поверх секции (пусто — как у секции).
          handle: (z && z.handle) || sec.handle,
          handleCC: (z && z.handle) ? z.handleCC : sec.handleCC,
          handleOrient: (z && z.handleOrient) || sec.handleOrient,
        });
      }
    } else {
      zonesRaw = [{ facade: sec.facade, height: 0, appliance: 'none', applianceW: 0, applianceD: 0, note: '',
        handle: sec.handle, handleCC: sec.handleCC, handleOrient: sec.handleOrient }];
    }

    if (zonesRaw.length > 1 && p.blindPanel && narrow) {
      warnings.push(`${secName}: несколько зон по высоте с заглушкой углового модуля не `
        + `поддерживаются вместе — заглушка построена только для одной (нижней) зоны.`);
    }

    // Несколько отсеков — раскладка вместе с ящиками отсеков (planZoneLayout),
    // иначе, как раньше, напрямую layoutDoorZones.
    const zonePlan = zonesRaw.length > 1
      ? planZoneLayout(sec, slotTop - slotBot, gap, t, drawerUnitH, (w) => warnings.push(w), null, secName,
        { lo: drawerZoneH ? 0 : t, hi: t })
      : null;
    const zoneLayout = zonePlan
      ? zonePlan.layout
      : layoutDoorZones(zonesRaw, slotTop - slotBot, gap, t, (w) => warnings.push(w), secName);

    // Ширина фасада ОТСЕКА (zone.facadeWidth, только выбранного отсека): уже
    // проёма секции — фасад прижимается к стороне открывания отсека, как у
    // узкого фасада секции. Не задана — ширина секции (secFacadeW/secFX).
    const secFacadeW = facadeW;
    const secFX = fX;
    for (let zi = 0; zi < zonesRaw.length; zi++) {
      const zone = zonesRaw[zi];
      const zoneFW = Number(zone.facadeWidth);
      const zoneNarrow = Number.isFinite(zoneFW) && zoneFW > 0 && zoneFW < fullW - 0.5;
      const facadeW = zoneNarrow ? zoneFW : secFacadeW;
      const fX = !zoneNarrow ? secFX
        : (zone.facade === 'doorRight' ? bnd[i + 1] - gap - facadeW / 2 : bnd[i] + gap + facadeW / 2);
      // Ящики отсека: фасады стопки от нижней границы отсека, над ними — дверь.
      const zStack = zonePlan ? zonePlan.stacks[zi] : null;
      if (zStack) {
        const zv = zStack.virt;
        const zNameSec = `${secName} (${zi === 0 ? 'нижняя зона' : (zi === zonesRaw.length - 1 ? 'верхняя зона' : `зона ${zi + 1}`)})`;
        const zDft = drawerFacadeTypeOf(
          Object.assign({}, zoneFacadeSettings(sec, zi), {
            drawerFacadeType: zv.drawerFacadeType, drawerFacadeMaterial: zv.drawerFacadeMaterial }),
          decor, t, facadeMat, p.facadeThickness);
        emitDrawerFronts({ owner: zv, heights: zStack.heights, label: zNameSec, dft: zDft,
          y0: slotBot + zStack.p0, zoneIndex: zi,
          boxes: ((secInfo.filter((x) => x.index === i)[0] || {}).zoneDrawerBoxes || {})[zi],
          handleId: zone.handle, handleCC: zone.handleCC });
      }
      const zStackS = zStack ? zStack.sum : 0;
      // Фасад ОТСЕКА: вид/материал/алюм. настройки зоны поверх секции
      // (zoneFacadeSettings). Затеняет ft/aluNoCup секции (фасады ящиков выше
      // остаются по секции). Однозонная секция — ровно настройки секции.
      const ft = zonesRaw.length > 1
        ? facadeTypeOf(zoneFacadeSettings(sec, zi), decor, t, facadeMat, p.facadeThickness)
        : ftSec;
      const aluNoCup = aluSkipsHingeCup(ft);
      // Дверь отсека — над стопкой его ящиков (без ящиков: весь отсек, как раньше).
      const doorZoneH = zoneLayout.heights[zi] - zStackS;
      if (doorZoneH <= (zStack ? 0.5 : 0)) continue;  // предупреждение уже дал layoutDoorZones
      const doorY = slotBot + zoneLayout.bottoms[zi] + zStackS + doorZoneH / 2;
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
      // aluNoCup: петля Blum для алюм. рамки на винтах — это не нехватка данных,
      // а штатный способ крепления, поэтому в warnings не выносим (только
      // пометка в двери, см. ALU_HINGE_NOTE ниже).
      const applianceDimsNote = (zone.applianceW || zone.applianceD)
        ? `габариты техники (Ш×Г) ${zone.applianceW ? Math.round(zone.applianceW) : '—'}×`
          + `${zone.applianceD ? Math.round(zone.applianceD) : '—'} мм`
        : '';

      if (fac === 'doorLeft' || fac === 'doorRight') {
        const hingeSide = fac === 'doorLeft' ? 'петли слева' : 'петли справа';
        const dh = handleHoles({ kind: 'door', width: facadeW, height: doorZoneH,
          handleId: zone.handle, handleCC: zone.handleCC, orient: zone.handleOrient,
          hingeSide: fac === 'doorLeft' ? 'left' : 'right',
          floorY: (Number(p.mountBottom) || 0) + doorY - doorZoneH / 2, frame: ft.frame,
          wallHung: isWallHung(p), override: handleOverrideOf(p, i, zi, 0),
          zoneIndex: zi, zoneCount: zonesRaw.length });
        if (dh.overflow) warnings.push(`${secName}: ручка «${dh.handle.name}» не помещается на двери.`);
        if (dh.badCC) warnings.push(`${secName}: у ручки не задано межосевое расстояние — укажите его в секции.`);
        if (dh.count) handleHardware.push({ id: dh.handle.id, qty: dh.count, name: dh.handle.name, cc: dh.handle.cc });
        const hStart = parts.length;
        pushHandleParts({ parts, mounts: dh.mounts, secName: zoneSecName, handleName: dh.handle.name,
          faceX: fX, faceY: doorY, faceW: facadeW, faceH: doorZoneH,
          faceZ: D / 2 + ft.thickness / 2, t: ft.thickness,
          ref: makeHandleRef(dh, i, zi, 0, doorY, doorZoneH, p, ft, fX, facadeW, fac === 'doorLeft' ? 'left' : 'right') });
        registerDoorHandle(handleAlign, dh, zonesRaw.length, isWallHung(p),
          (Number(p.mountBottom) || 0) + doorY - doorZoneH / 2, doorZoneH, hStart, parts.length,
          doorHandleEdge(ft.frame));
        const doorNoteParts = [`Накладная, ${hingeSide}` + (dh.count ? `, ручка ${dh.handle.name}` : '')];
        if (skipHinge) doorNoteParts.push(applianceHingeNote(zone.appliance));
        else if (aluNoCup) doorNoteParts.push(ALU_HINGE_NOTE);
        if (applianceDimsNote) doorNoteParts.push(applianceDimsNote);
        if (zone.note) doorNoteParts.push(zone.note);
        const aluCuts = (aluNoCup && !skipHinge)
          ? aluHingeCuts(facadeW, doorZoneH, fac === 'doorLeft' ? 'left' : 'right', ft.alu.frameW,
            shelvesOnFacade(secInfo, i, doorY, doorZoneH), (w) => warnings.push(w), secName,
            isTopZone ? railBottomOnFacade(doorY, doorZoneH) : null)
          : null;
        parts.push(makePart({
          name: `Дверь ${fac === 'doorLeft' ? 'левая' : 'правая'} (${ft.name.replace('Фасад ', '')})`,
          section: zoneSecName, sectionIndex: i, zoneIndex: zi, material: ft.material, thickness: ft.thickness,
          facadeType: ft.id, ...facadePartFields(ft, facadeW, doorZoneH),
          length: facadeW, width: doorZoneH, qty: 1, kind: 'door', grain: true,
          holes: aluCuts ? dh.holes.concat(aluCuts.holes)
            : (skipHinge || aluNoCup) ? dh.holes : dh.holes.concat(hingeHoles(facadeW, doorZoneH,
            fac === 'doorLeft' ? 'left' : 'right',
            shelvesOnFacade(secInfo, i, doorY, doorZoneH),
            (w) => warnings.push(w), secName, ft.render === 'glass',
            isTopZone ? railBottomOnFacade(doorY, doorZoneH) : null)),
          grooves: aluCuts ? aluCuts.grooves : [],
          note: doorNoteParts.join('; '),
          edging: { long1: facadeEdgeType(ft), long2: facadeEdgeType(ft), short1: facadeEdgeType(ft), short2: facadeEdgeType(ft) },
          x: fX, y: doorY, z: D / 2 + ft.thickness / 2,
          dims: { w: facadeW, h: doorZoneH, d: ft.thickness },
        }));
        doorHardware.push({ section: zoneSecName, height: doorZoneH, leaves: 1, pushToOpen: !!sec.pushToOpen,
          aluHinge: aluNoCup && !skipHinge });

        // ЗАГЛУШКА УГЛОВОГО МОДУЛЯ. Фасад узкий, остальной фронт корпуса
        // закрывает вертикальная панель из КОРПУСНОГО ЛДСП: она же служит
        // опорой петель соседа и не даёт заглянуть в угол. К её правой
        // кромке ПОД 90° крепится фальш-планка из фасадного материала —
        // видимая снаружи полоса, добирающая фронт до соседнего ряда.
        // Несколько зон по высоте с заглушкой вместе не поддерживаются —
        // строим её только для нижней зоны (см. предупреждение выше).
        if (p.blindPanel && narrow && zi === 0) {
          const STRIP_W = Number(p.blindStrip) || 68;
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
            edging: { long1: fillerEdgeType(ft), long2: fillerEdgeType(ft), short1: fillerEdgeType(ft), short2: fillerEdgeType(ft) },
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
        else if (aluNoCup) doors2NoteParts.push(ALU_HINGE_NOTE);
        if (applianceDimsNote) doors2NoteParts.push(applianceDimsNote);
        if (zone.note) doors2NoteParts.push(zone.note);
        for (let leaf = 0; leaf < 2; leaf++) {
          // У двустворчатой двери петли снаружи: ручки сходятся к середине,
          // поэтому у левой створки ручка справа, у правой — слева.
          const dh = handleHoles({ kind: 'door', width: leafW, height: doorZoneH,
            handleId: zone.handle, handleCC: zone.handleCC, orient: zone.handleOrient,
            hingeSide: leaf === 0 ? 'left' : 'right',
            floorY: (Number(p.mountBottom) || 0) + doorY - doorZoneH / 2, frame: ft.frame,
            wallHung: isWallHung(p), override: handleOverrideOf(p, i, zi, leaf),
            zoneIndex: zi, zoneCount: zonesRaw.length });
          if (dh.count) handleHardware.push({ id: dh.handle.id, qty: dh.count, name: dh.handle.name, cc: dh.handle.cc });
          const leafX = fX - facadeW / 2 + leafW / 2 + leaf * (leafW + 2 * gap);
          const aluCuts = (aluNoCup && !skipHinge)
            ? aluHingeCuts(leafW, doorZoneH, leaf === 0 ? 'left' : 'right', ft.alu.frameW,
              shelvesOnFacade(secInfo, i, doorY, doorZoneH), (w) => warnings.push(w), secName,
              isTopZone ? railBottomOnFacade(doorY, doorZoneH) : null)
            : null;
          const hStart = parts.length;
          pushHandleParts({ parts, mounts: dh.mounts, secName: zoneSecName, handleName: dh.handle.name,
            faceX: leafX, faceY: doorY, faceW: leafW, faceH: doorZoneH,
            faceZ: D / 2 + ft.thickness / 2, t: ft.thickness,
            ref: makeHandleRef(dh, i, zi, leaf, doorY, doorZoneH, p, ft, leafX, leafW, leaf === 0 ? 'left' : 'right') });
          registerDoorHandle(handleAlign, dh, zonesRaw.length, isWallHung(p),
            (Number(p.mountBottom) || 0) + doorY - doorZoneH / 2, doorZoneH, hStart, parts.length,
          doorHandleEdge(ft.frame));
          parts.push(makePart({
            name: `Дверь-створка (${ft.name.replace('Фасад ', '')})`,
            section: zoneSecName, sectionIndex: i, zoneIndex: zi, material: ft.material, thickness: ft.thickness,
            facadeType: ft.id, ...facadePartFields(ft, leafW, doorZoneH),
            length: leafW, width: doorZoneH, qty: 1, kind: 'door', grain: true,
            holes: aluCuts ? dh.holes.concat(aluCuts.holes)
              : (skipHinge || aluNoCup) ? dh.holes : dh.holes.concat(hingeHoles(leafW, doorZoneH,
              leaf === 0 ? 'left' : 'right',
              shelvesOnFacade(secInfo, i, doorY, doorZoneH),
              (w) => warnings.push(w), secName, ft.render === 'glass',
              isTopZone ? railBottomOnFacade(doorY, doorZoneH) : null)),
            grooves: aluCuts ? aluCuts.grooves : [],
            note: 'Накладная, ' + doors2NoteParts.join('; ') + (dh.count ? `, ручка ${dh.handle.name}` : ''),
            edging: { long1: facadeEdgeType(ft), long2: facadeEdgeType(ft), short1: facadeEdgeType(ft), short2: facadeEdgeType(ft) },
            x: fX - facadeW / 2 + leafW / 2 + leaf * (leafW + 2 * gap), y: doorY, z: facadeZ,
            dims: { w: leafW, h: doorZoneH, d: t },
          }));
        }
        doorHardware.push({ section: zoneSecName, height: doorZoneH, leaves: 2, pushToOpen: !!sec.pushToOpen,
          aluHinge: aluNoCup && !skipHinge });
      } else if (fac === 'liftUp') {
        // Фасад откидывается ВВЕРХ: петель нет, работает подъёмный механизм.
        const dh = handleHoles({ kind: 'liftFront', width: facadeW, height: doorZoneH, handleId: zone.handle, handleCC: zone.handleCC });
        if (dh.count) handleHardware.push({ id: dh.handle.id, qty: dh.count, name: dh.handle.name, cc: dh.handle.cc });
        pushHandleParts({ parts, mounts: dh.mounts, secName: zoneSecName, handleName: dh.handle.name,
          faceX: fX, faceY: doorY, faceW: facadeW, faceH: doorZoneH,
          faceZ: D / 2 + ft.thickness / 2, t: ft.thickness });
        const liftNoteParts = ['Накладной, открывание вверх' + (dh.count ? `, ручка ${dh.handle.name}` : '')];
        if (zone.note) liftNoteParts.push(zone.note);
        parts.push(makePart({
          name: 'Фасад откидной (вверх)', section: zoneSecName, sectionIndex: i, zoneIndex: zi,
          material: ft.material, thickness: ft.thickness,
          facadeType: ft.id, ...facadePartFields(ft, facadeW, doorZoneH),
          length: facadeW, width: doorZoneH, qty: 1, kind: 'door', grain: true,
          holes: dh.holes,
          note: liftNoteParts.join('; '),
          edging: { long1: facadeEdgeType(ft), long2: facadeEdgeType(ft), short1: facadeEdgeType(ft), short2: facadeEdgeType(ft) },
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
      } else if (fac === 'blindFacade') {
        // Глухая накладная панель: без ручки, без петель — handleHoles/
        // hingeHoles не зовём. Крепится к боковинам секции минификсом Rastex
        // напрямую (без промежуточных планок, в отличие от заглушки углового
        // модуля выше). Ролью «примыкает торцом» здесь выступает БОКОВИНА —
        // её передний торец садится на заднюю пласть заглушки, поэтому
        // гнездо Ø15 и шток Ø8-в-торец идут в боковину, а в заглушку —
        // только дюбель Ø8 (см. предупреждение у RASTEX: обратная раскладка
        // гнезда/штока не собирается).
        const blindNoteParts = ['Накладная, без ручки и петель, глухая'];
        if (zone.note) blindNoteParts.push(zone.note);
        const blind = makePart({
          name: 'Заглушка (глухой фасад)', section: zoneSecName, sectionIndex: i, zoneIndex: zi,
          material: ft.material, thickness: ft.thickness,
          facadeType: ft.id, ...facadePartFields(ft, facadeW, doorZoneH),
          length: facadeW, width: doorZoneH, qty: 1, kind: 'door', grain: true,
          holes: [],
          note: blindNoteParts.join('; '),
          edging: { long1: facadeEdgeType(ft), long2: facadeEdgeType(ft), short1: facadeEdgeType(ft), short2: facadeEdgeType(ft) },
          x: fX, y: doorY, z: D / 2 + ft.thickness / 2,
          dims: { w: facadeW, h: doorZoneH, d: ft.thickness },
        });
        parts.push(blind);
        const blindBounds = shelfPanelX[i] || [];
        const blindPts = jointPoints(doorZoneH);
        for (const px of blindBounds) {
          const panel = panelAt(px);
          if (!panel) continue;
          for (const py of blindPts) {
            const worldY = doorY - doorZoneH / 2 + py;
            const localX = round1(worldY - (panel.box.y - panel.box.h / 2));
            panel.holes.push({ x: localX, y: round1(panel.box.d - RASTEX.camSetback),
              d: RASTEX.camD, depth: RASTEX.camDepthFor(panel.box.w),
              through: false, side: 'front', kind: 'minifixCam' });
            panel.holes.push({ x: localX, y: round1(panel.box.d),
              d: RASTEX.boltD, depth: RASTEX.boltDepth,
              through: false, side: 'edge', kind: 'minifixBolt' });
            // У внутренней стойки между секциями центр лежит всего в gap
            // (1.5 мм) от кромки заглушки — почти на самом краю материала.
            // Зажимаем в границы детали тем же отступом 8 мм, что и xFace
            // в T-joint-присадке выше (см. :2249) — иначе Ø8 дюбель уходит
            // частично за пределы плиты.
            const rawX = px - (fX - facadeW / 2);
            blind.holes.push({ x: round1(Math.min(Math.max(rawX, 8), facadeW - 8)),
              y: round1(worldY - (doorY - doorZoneH / 2)),
              d: RASTEX.dowelD, depth: RASTEX.dowelDepth,
              through: false, side: 'back', kind: 'minifixDowel' });
          }
        }
        if (blindBounds.length) {
          jointRows.push({ joint: 'minifix', qty: blindPts.length * blindBounds.length });
        }
      }
      // zone.facade === 'open' → фасада нет (открытая зона)
    }
  }

  alignBigDoorHandles(handleAlign, parts);
  applyHandleSnaps(parts);
  applyShelfSnaps(parts);

  // Ручные правки конкретных деталей — см. applyPartOverrides выше. Строго
  // ПОСЛЕДНИЙ шаг: все формулы корпуса уже отработали, соседние детали
  // пересчитывать не нужно (и не будем).
  applyPartOverrides(parts, p.partOverrides, warnings, bm);
  // Навеска верхнего модуля — ПОСЛЕ ручных правок: разметка считается от
  // фактической толщины задней стенки (её могли переопределить вручную).
  const hangerHardware = applyWallHanger(p, parts, warnings, bm, backPart, D, H);
  // Выпил под монтажную шину — после разметки навеса (проверка попадания).
  applyRailNotch(p, parts, sideVisible, sides, bm, warnings);
  // Направление текстуры — тоже постобработка: только помечает детали
  // (см. блок «НАПРАВЛЕНИЕ ТЕКСТУРЫ»), размеров и присадки не трогает.
  applyGrainDirection(parts, p.grainGroups, p.grainOverrides);

  return {
    params: p,
    sides,
    // Тип боковин, реально применённый к деталям (с подменой видимой на опорах).
    effSides: { left: effLeft, right: effRight },
    sidesLabel: sidesLabel(sides),
    dims: {
      W, H, D, innerH, baseH, Wi, sectionOpening, t, tb, gap, innerBottomY, n,
      // Толщины левой/правой боковины (видимая — лист «Видимая боковина»,
      // ручная правка — partOverrides); наружная грань всегда на ±W/2.
      tL, tR,
      // Раскладка секций: ширина и левая граница проёма каждой
      sections: layout.widths.map((w, i) => Object.assign(
        { w, x0: layout.x0[i], x1: layout.x0[i] + w },
        secInfo.find((x) => x.index === i) || { drawerAvail: 0, drawerHeights: [] })),
    },
    parts,   // сырые детали модуля, в локальных координатах
    hardwareContext: { drawerHardware, doorHardware, handleHardware, liftHardware,
      jointRows, hangerHardware,
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
      hardwareContext: { drawerHardware: [], doorHardware: [], sectionsCount: 0, jointCount: 0,
        hangerHardware: [], wallRails: [] },
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
  const hangerHardware = [];
  let jointCount = 0;
  // Система навески верхних модулей — одна на проект (project.hangerSystem,
  // по умолчанию catalog.DEFAULT_HANGER_SYSTEM). Позиция удалена из каталога
  // — берётся первая доступная, с предупреждением (resolveHangerSystem).
  const catH = window.Modul3D.catalog || {};
  const hangerRes = (catH.resolveHangerSystem && mods.some((m) => isWallHung(m)))
    ? catH.resolveHangerSystem(proj.hangerSystem) : { id: null, sys: null, warning: null };

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
  // Сосед ищется в том же ряду (напольный / навесной): верхний и нижний
  // ряды раскладываются независимо, см. «НАВЕСНЫЕ модули» ниже.
  const nextDepthOf = (m) => {
    const gm = groupOfMod(m);
    const same = mods.filter((x) => isWallHung(x) === isWallHung(m) && groupOfMod(x) === gm);
    const i = same.indexOf(m);
    const nxt = i >= 0 ? same[i + 1] : null;
    const d = nxt ? Number(nxt.depth || 0) : 0;
    return d > 0 ? d : (Number(m.blindWidth) || Number(m.depth) || 560);
  };

  // Место, которое модуль реально занимает в плане. Важно: фасад выступает
  // ВПЕРЁД на толщину ЛДСП, задняя стенка — НАЗАД на толщину ХДФ. У повёрнутого
  // модуля этот выступ приходится на соседа по ряду, поэтому раскладка ведётся
  // по полному занимаемому месту, иначе корпуса налезают друг на друга.
  // Задний выступ модуля за корпус: у накладной стенки — её толщина, у стенки
  // В ПАЗ — удлинение деталей с пазом E (resolveBackMount — то же решение,
  // что и в buildModuleParts, поля модуля те же).
  const backOut = (m) => {
    const bmm = resolveBackMount({
      noBack: !!m.noBack, backMount: m.backMount, backGroove: m.backGroove,
      wallHung: m.wallHung, family: m.family, base: m.base,
      topType: m.topType, countertop: m.countertop, height: m.height,
    }, normalizeSides({ leftSide: m.leftSide, rightSide: m.rightSide, scheme: m.scheme,
      wallHung: m.wallHung, family: m.family, base: m.base }), tBack);
    if (bmm.mode === 'none' && !m.noBack) return 0;   // «Без задней стенки» — выступа нет
    return bmm.mode === 'groove' ? bmm.E : tBack;
  };
  const extent = (m) => {
    const W = Number(m.width || 0), D = Number(m.depth || 0);
    const tOut = backOut(m);
    switch (rotOf(m)) {
      case 90:  return { x0: -D / 2 - tOut, x1: D / 2 + tBody, z0: -W / 2, z1: W / 2 };
      case 180: return { x0: -W / 2, x1: W / 2, z0: -D / 2 - tBody, z1: D / 2 + tOut };
      case 270: return { x0: -D / 2 - tBody, x1: D / 2 + tOut, z0: -W / 2, z1: W / 2 };
      default:  return { x0: -W / 2, x1: W / 2, z0: -D / 2 - tOut, z1: D / 2 + tBody };
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

  // НАВЕСНЫЕ (верхние) модули — ОТДЕЛЬНЫЙ ряд над напольными (решение
  // пользователя 2026-09-26). У верхнего ряда свой курсор и свои угловые
  // повороты: он начинается от того же начала, что и нижний (первый верхний
  // встаёт над первым нижним), а по глубине прижимается ЗАДНЕЙ стороной к
  // стене (v = 0 — та же плоскость, что задняя грань самого глубокого нижнего
  // модуля), а не выравнивается по фасадам нижних. Напольные — как раньше.
  // ГРУППЫ (остров и т.п.): модуль с флагом groupStart начинает НОВУЮ группу —
  // самостоятельную раскладку со своим началом, не примыкающую к предыдущей.
  // Смещение группы по полу — поля gx/gz (мм) её первого модуля. Без флагов
  // группа одна — раскладка как раньше.
  const groupOf = new Array(mods.length);
  const groupStarts = [];
  mods.forEach((m, i) => {
    if (i === 0 || m.groupStart) groupStarts.push(i);
    groupOf[i] = groupStarts.length - 1;
  });
  const groupOfMod = (m) => groupOf[mods.indexOf(m)];
  const groups = groupStarts.map(() => ({ floorIdx: [], wallIdx: [] }));
  mods.forEach((m, i) => (isWallHung(m) ? groups[groupOf[i]].wallIdx : groups[groupOf[i]].floorIdx).push(i));
  // Разбиваем ряд на прогоны: угловой модуль — последний в своём прогоне.
  const splitRuns = (idxs) => {
    const out = [];
    let cur = [];
    idxs.forEach((i, k) => {
      cur.push(i);
      if (isCorner(mods[i]) && k < idxs.length - 1) { out.push(cur); cur = []; }
    });
    if (cur.length) out.push(cur);
    return out;
  };
  groups.forEach((g, gi) => {
    g.floorRuns = splitRuns(g.floorIdx);
    g.wallRuns = splitRuns(g.wallIdx);
    // Начало раскладки задаёт нижний ряд (если он есть), верхний — от него же.
    const primary = g.floorRuns.length ? g.floorRuns : g.wallRuns;
    // Первый прогон центрируем по X, как раньше, чтобы одиночный шкаф стоял в нуле
    const firstRunLen = (primary[0] || []).reduce((sum, i) => {
      const e = extent(mods[i]); return sum + (e.x1 - e.x0);
    }, 0);
    // По глубине первый прогон центрируем так же, как раньше стоял одиночный
    // модуль (корпус вокруг нуля), — иначе сдвинулись бы все виды на чертежах.
    // originZ0 — плоскость стены (задняя грань самого глубокого модуля).
    const firstRunDepth = Math.max.apply(null, (primary[0] || [0]).map((i) => {
      const e = extent(mods[i]); return e.z1 - e.z0;
    }));
    const firstRunFront = Math.max.apply(null, (primary[0] || [0]).map((i) => extent(mods[i]).z1));
    const head = mods[groupStarts[gi]] || {};
    g.originX0 = -firstRunLen / 2 + (Number(head.gx) || 0);
    g.originZ0 = firstRunFront - firstRunDepth + (Number(head.gz) || 0);
  });
  // Общие списки прогонов по всем группам (k — номер прогона внутри группы).
  const floorRuns = [], wallRuns = [];
  groups.forEach((g) => {
    g.floorRuns.forEach((r, k) => { r.k = k; floorRuns.push(r); });
    g.wallRuns.forEach((r, k) => { r.k = k; wallRuns.push(r); });
  });
  const floorIdx = groups.length ? groups[0].floorIdx : [];
  // Глубины столешницы связок — по каждой группе отдельно: соседство по
  // массиву в пределах группы и есть физическое (см. resolveCountertopChainDepths).
  const chainDepthsAll = () => {
    const out = [];
    groups.forEach((g) => {
      const r = resolveCountertopChainDepths(mods, g.floorIdx);
      g.floorIdx.forEach((i) => { out[i] = r[i]; });
    });
    return out;
  };

  // Раскладка каждого модуля (по индексу в mods): начало и направление его
  // прогона, смещение в системе прогона, данные угловой фальш-планки.
  const place = new Array(mods.length);
  // СТЕНА — там, где кончается столешница нижнего ряда (решение пользователя
  // 2026-10-03): корпус нижних отступает от стены на задний свес столешницы
  // за вычетом задней стенки (кухня 600 мм: 52 − 3 = 49), а верхние модули
  // задней стороной стоят на самой стене. Свес считается так же, как в
  // buildModuleParts: ручной overhangBack, иначе (кухня) глубина листа
  // минус корпус, фасад и свес спереди. Нет столешниц — 0, как раньше.
  const floorWallGap = (() => {
    const wallDepths = chainDepthsAll();
    let gap = 0;
    floorIdx.forEach((i) => {
      const m = mods[i], ct = m.countertop;
      if (!ct || !ct.enabled) return;
      const hasManual = ct.overhangBack !== undefined && ct.overhangBack !== null && ct.overhangBack !== '';
      const D = Number(m.depth || 0);
      const oF = Number(ct.overhangFront) || 0;
      const oB = hasManual ? (Number(ct.overhangBack) || 0)
        : (m.family === 'kitchen' && wallDepths[i]
          ? wallDepths[i] - D - (Number(proj.facadeThickness) || tBody) - oF : 0);
      gap = Math.max(gap, oB - backOut(m));
    });
    return Math.max(0, round1(gap));
  })();
  // frames[k] — начало k-го прогона ряда и положение его угла (u конца
  // углового модуля = стена следующего, перпендикулярного прогона).
  const layoutLayer = (g, gi, wall, floorFrames) => {
    const runs = wall ? g.wallRuns : g.floorRuns;
    const gapHere = gi === 0 ? floorWallGap : 0;   // стена — только у основной группы
    const frames = [];
    let dir = 0;
    let originX = g.originX0, originZ = g.originZ0;
    runs.forEach((run, k) => {
      const U = DIR_U[dir], V = DIR_V[dir];
      const dirRot = DIR_ROT[dir];
      // В пределах прогона напольные модули выравниваются по ПЕРЕДНЕМУ краю,
      // а сам прогон отсчитывается от СТЕНЫ: v = 0 — задняя плоскость самого
      // глубокого модуля, v = runDepth — общая фасадная плоскость. Так
      // следующий прогон встаёт ровно от наружной грани углового модуля, а
      // не сквозь него. Навесные — задней стороной по стене (v = 0).
      const runDepth = Math.max.apply(null, run.map((i) => {
        const e = extent(mods[i]); return e.z1 - e.z0;
      }));
      let cursor = 0;
      let lastCornerU = 0, lastCornerV = runDepth;
      let cornerU = null;
      // Угол нижнего ряда в этом же прогоне — там перпендикулярная стена.
      // Верхний угловой модуль встаёт концом в ту же стену, иначе верхний
      // ряд повернул бы не у стены, а где кончились верхние модули (у
      // нижнего и верхнего угловых разная ширина: 1000 и 600 в пресетах).
      const fl = wall && floorFrames ? floorFrames[k] : null;
      const wallCornerU = fl && fl.cornerU != null && fl.dir === dir
        ? fl.cornerU - ((originX - fl.originX) * U[0] + (originZ - fl.originZ) * U[1])
        : null;

      // Высокие напольные модули этого же прогона (пенал, колонка): они
      // занимают место и в верхнем ряду, поэтому верхний модуль не может
      // встать над ними — курсор уходит за их правую грань. Отрезки — в
      // сквозной координате вдоль прогона (начало прогонов нижнего и верхнего
      // рядов может различаться).
      const wallG = originX * U[0] + originZ * U[1];
      const talls = (wall && fl && fl.dir === dir && g.floorRuns[k])
        ? g.floorRuns[k].filter((i) => place[i]).map((i) => {
          const fg = fl.originX * U[0] + fl.originZ * U[1];
          return { top: Number(mods[i].height || 0), g0: fg + place[i].u0, g1: fg + place[i].u1 };
        }).sort((a, b) => a.g0 - b.g0)
        : [];

      run.forEach((idx) => {
        const m = mods[idx];
        const e = extent(m);                       // габарит в системе прогона
        if (talls.length && !isCorner(m)) {
          const mt = Number(m.mountTop) > 0 ? Number(m.mountTop) : WALL_MOUNT_TOP_DEFAULT;
          const bottom = Math.max(0, mt - Number(m.height || 0));
          const w = e.x1 - e.x0;
          for (const t of talls) {
            if (t.top <= bottom + 0.5) continue;      // ниже навесного — не мешает
            if (wallG + cursor < t.g1 - 0.5 && wallG + cursor + w > t.g0 + 0.5) {
              cursor = t.g1 - wallG;
            }
          }
        }
        if (wall && isCorner(m) && wallCornerU != null) {
          const snap = wallCornerU - (e.x1 - e.x0);
          if (snap >= cursor - 0.5) cursor = snap;
          else {
            warnings.push(`${m.name || `Модуль ${idx + 1}`}: верхние модули до угла `
              + `длиннее нижнего ряда на ${Math.round(cursor - snap)} мм — верхний угловой `
              + `не достаёт до угла, ряд поворачивает дальше стены.`);
          }
        }
        const offU = cursor - e.x0;                // левый край встаёт на курсор
        const offV = wall
          ? -e.z0 - gapHere                         // задняя сторона — по стене
          : runDepth - e.z1;                       // передние плоскости совпадают
        const frontV = offV + e.z1;                // фасадная плоскость модуля
        cursor += (e.x1 - e.x0);
        // u0/u1 — занятый модулем отрезок вдоль прогона: по ним шина
        // навесного ряда делится на НЕПРЕРЫВНЫЕ участки (см. wallRails).
        const pl = { U, V, dirRot, originX, originZ, offU, offV, corner: null,
          u0: offU + e.x0, u1: cursor };
        if (isCorner(m)) {
          pl.corner = { cursor, frontV };
          lastCornerU = cursor;
          cornerU = cursor;
          // Модуль со своей заглушкой уже несёт узел стыка: фальш-планку и
          // планку крепёжную. Следующий прогон встаёт ВПЛОТНУЮ к ним, без
          // дополнительного отступа — иначе в углу зияет щель.
          // Прогон отсчитывается по ЗАНИМАЕМОМУ месту (в него входит вылет
          // фасада на tBody), поэтому вычитаем эту толщину — иначе корпус
          // соседа встаёт с зазором в одну плиту.
          lastCornerV = m.blindPanel
            ? frontV + (Number(m.blindStrip) || 68) - tBody
            : frontV + FILLER_W + FILLER_GAP;
        }
        place[idx] = pl;
      });
      frames.push({ dir, originX, originZ, cornerU });

      // Поворот на следующий прогон: новое начало — у наружной грани углового
      // модуля, вплотную перед его фасадной плоскостью.
      const nx = originX + U[0] * lastCornerU + V[0] * lastCornerV;
      const nz = originZ + U[1] * lastCornerU + V[1] * lastCornerV;
      originX = nx; originZ = nz;
      dir = (dir + 1) % 4;
    });
    return frames;
  };
  groups.forEach((g, gi) => {
    const floorFrames = layoutLayer(g, gi, false, null);
    layoutLayer(g, gi, true, floorFrames);
  });

  // --- ВИДИМОСТЬ БОКОВИН ПО СОСЕДЯМ (решение пользователя 2026-09-27) -------
  // Боковина ЗАКРЫТА, если в её плоскости вплотную стоит боковина другого
  // модуля (любого ряда — навесной может граничить с пеналом) и её
  // прямоугольник целиком покрывает наш (допуск COVER_TOL). Прямоугольник
  // боковины: по высоте — [низ боковины, верх модуля] в абсолютных отметках
  // (с учётом подъёма навесного), по глубине — корпусная глубина D от
  // переднего края. Считается в ГЛОБАЛЬНЫХ координатах после раскладки —
  // поворот модуля (180° — боковины меняются местами) и прогоны учтены.
  // Угловой стык: боковина углового модуля со стороны угла (там стена
  // перпендикулярного ряда) и боковина первого модуля следующего прогона со
  // стороны углового — закрытые (решение по умолчанию).
  // Итог — sideCovered[idx] = { left, right } (true = закрыта полностью),
  // по нему buildModuleParts решает, видимая ли боковина.
  const COVER_TOL = 0.5;
  const mountBottomOf = (m) => {
    if (!isWallHung(m)) return 0;
    const top = Number(m.mountTop) > 0 ? Number(m.mountTop) : WALL_MOUNT_TOP_DEFAULT;
    return Math.max(0, top - Number(m.height || 0));
  };
  const sideFaces = mods.map((m, idx) => {
    const pl = place[idx];
    const W = Number(m.width || 0), D = Number(m.depth || 0), H = Number(m.height || 0);
    const sd = normalizeSides({ leftSide: m.leftSide, rightSide: m.rightSide, scheme: m.scheme,
      wallHung: m.wallHung, family: m.family, base: m.base });
    const b = m.base || {};
    const baseH = b.type === 'plinth' ? Number(b.plinthHeight || 0) : Number(b.legHeight || 0);
    const yb = mountBottomOf(m);
    const rot = rotOf(m);
    // Локальная точка модуля (x, z) → глобальная (как у деталей ниже).
    const toG = (x, z) => {
      let lx = x, lz = z;
      if (rot === 90) { lx = z; lz = -x; }
      else if (rot === 180) { lx = -x; lz = -z; }
      else if (rot === 270) { lx = -z; lz = x; }
      const u = lx + pl.offU, v = lz + pl.offV;
      return [pl.originX + pl.U[0] * u + pl.V[0] * v, pl.originZ + pl.U[1] * u + pl.V[1] * v];
    };
    const face = (key) => {
      const sx = key === 'left' ? -W / 2 : W / 2;
      const a = toG(sx, -D / 2), c = toG(sx, D / 2), o = toG(0, 0);
      const alongX = Math.abs(a[0] - c[0]) < 1e-6;   // плоскость x = const
      const coord = alongX ? a[0] : a[1];
      const v = sd[key];
      const bottomY = v === 'floor' ? 0 : (v === 'besideBottom' ? baseH : baseH + tBody);
      return {
        axis: alongX ? 'x' : 'z', c: coord,
        n: Math.sign(coord - (alongX ? o[0] : o[1])),   // наружу от центра модуля
        s0: Math.min(alongX ? a[1] : a[0], alongX ? c[1] : c[0]),
        s1: Math.max(alongX ? a[1] : a[0], alongX ? c[1] : c[0]),
        y0: yb + bottomY, y1: yb + H,
      };
    };
    return { left: face('left'), right: face('right') };
  });
  const coversFace = (B, A) => B.axis === A.axis && B.n === -A.n
    && Math.abs(B.c - A.c) <= COVER_TOL
    && B.s0 <= A.s0 + COVER_TOL && B.s1 >= A.s1 - COVER_TOL
    && B.y0 <= A.y0 + COVER_TOL && B.y1 >= A.y1 - COVER_TOL;
  const sideCovered = mods.map((m, idx) => {
    const out = {};
    for (const key of ['left', 'right']) {
      const A = sideFaces[idx][key];
      out[key] = sideFaces.some((f, j) => j !== idx
        && (coversFace(f.left, A) || coversFace(f.right, A)));
    }
    return out;
  });
  // Сторона модуля, чья боковина смотрит вдоль направления прогона dirSign
  // (+1 — к концу прогона, −1 — к началу).
  const sideTowards = (idx, dirSign) => {
    const U = place[idx].U;
    for (const key of ['left', 'right']) {
      const f = sideFaces[idx][key];
      const comp = f.axis === 'x' ? U[0] : U[1];
      if (comp !== 0 && f.n === dirSign * comp) return key;
    }
    return null;
  };
  for (const runs of [floorRuns, wallRuns]) {
    runs.forEach((run, k) => {
      const last = run[run.length - 1];
      if (isCorner(mods[last])) {
        const key = sideTowards(last, 1);
        if (key) sideCovered[last][key] = true;
      }
      if (run.k > 0) {
        const key = sideTowards(run[0], -1);
        if (key) sideCovered[run[0]][key] = true;
      }
    });
  }

  // Глубина столешницы КАЖДОЙ связки стыкующихся напольных кухонных тумб —
  // нужна ДО buildModuleParts (см. resolveCountertopChainDepths ниже по
  // файлу), от неё зависит, насколько видимая боковина крайнего модуля
  // дотягивается до стены.
  const worktopDepthByIdx = chainDepthsAll();

  const placed = [];   // фактические габариты корпусов на месте — для dims
  const cornerPlinths = [];   // угловые модули: их цоколь тянем до соседнего ряда

  // Сборка деталей — в ИСХОДНОМ порядке модулей (от него зависят нумерация
  // позиций деталировки и соответствие model.modules[i] ↔ state.modules[i]).
  mods.forEach((m, idx) => {
    const { U, V, dirRot, originX, originZ, offU, offV } = place[idx];
    const name = m.name || `Модуль ${idx + 1}`;
    // ВЫСОТА НАВЕСНОГО модуля: верх по умолчанию на отметке
    // WALL_MOUNT_TOP_DEFAULT от пола, регулируется полем mountTop; низ = верх −
    // высота модуля. Напольные стоят на полу (0).
    const hung = isWallHung(m);
    const mountTop = hung
      ? (Number(m.mountTop) > 0 ? Number(m.mountTop) : WALL_MOUNT_TOP_DEFAULT) : null;
    let mountBottom = hung ? mountTop - Number(m.height || 0) : 0;
    if (mountBottom < 0) {
      warnings.push(`${name}: верх навесного модуля на отметке ${Math.round(mountTop)} мм `
        + `ниже его высоты ${Math.round(Number(m.height || 0))} мм — низ ушёл бы под пол, `
        + `модуль поставлен на пол. Увеличьте «Верх модуля от пола».`);
      mountBottom = 0;
    }
    const built = buildModuleParts({
      width: m.width, height: m.height, depth: m.depth,
      bodyThickness: proj.bodyThickness, backThickness: proj.backThickness,
      decor: m.carcassDecor || proj.decor, facadeDecor: proj.facadeDecor,
      facadeMat: proj.facadeMat || proj.decor,
      facadeThickness: proj.facadeThickness,
      backMaterial: proj.backMaterial,
      drawerDecor: proj.drawerDecor, drawerThickness: proj.drawerThickness,
      base: m.base, legType: m.legType, leftSide: m.leftSide, rightSide: m.rightSide,
      sideUserSet: m.sideUserSet,
      topType: m.topType, railWidth: m.railWidth, noBack: !!m.noBack,
      // Задняя стенка: накладная / в паз (см. resolveBackMount) и признак
      // навесного модуля. Нет полей — 'auto' и правило по умолчанию.
      backMount: m.backMount, backGroove: m.backGroove, wallHung: m.wallHung,
      // Отметка низа модуля от пола — по ней ручки дверей считают высоту
      // от пола (handleHoles/handleLevel).
      mountBottom,
      countertop: m.countertop,
      // Навесному (верхнему) модулю столешница не положена: иначе его
      // видимая боковина «дотягивается до стены» по глубине столешницы
      // нижнего ряда (у верхнего 300 → 562 мм).
      worktopDepth: (m.family === 'kitchen' && !hung) ? Number(worktopDepthByIdx[idx] || 0) : 0,
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
      // Направление текстуры: настройки групп — общие на проект, правки
      // отдельных деталей — в объекте модуля (как partOverrides).
      grainGroups: proj.grainGroups || {},
      grainOverrides: m.grainOverrides || {},
      // Ручное положение ручек дверей (перетаскивание в 3D), см. manualHandleCy.
      handleOverrides: m.handleOverrides || {},
      // Навеска верхнего модуля (applyWallHanger): объект системы из
      // catalog.HANGER_SYSTEMS и её код — для сметы.
      hangerSystem: hangerRes.sys, hangerSystemId: hangerRes.id,
      // Какие боковины полностью закрыты соседями (см. «ВИДИМОСТЬ БОКОВИН
      // ПО СОСЕДЯМ» выше) — от этого материал/толщина/крепёж боковины.
      sideCovered: sideCovered[idx],
    });

    const manualRot = rotOf(m);

    // ЯКОРЬ ДЕТАЛИ ДЛЯ РУЧНОЙ РАЗМЕТКИ ЧЕРТЕЖА (src/markup.js) — только
    // метаданные, на геометрию и смету не влияют. part.id для этого не
    // годится: _partSeq обнуляется в начале КАЖДОГО buildModuleParts(),
    // поэтому id повторяются между модулями и сдвигаются, когда меняется
    // состав деталей. Вместо него — постоянный uid модуля (app.js хранит
    // его в state.modules) + ключ kind|section|side|index по той же схеме,
    // что applyPartOverrides(), но для ВСЕХ видов деталей; index считается
    // внутри группы kind|section|side В ПРЕДЕЛАХ модуля. Сквозь
    // mergeEqualParts()/partsRaw поля доходят как есть (Object.assign).
    const anchorCounters = new Map();

    for (const part of built.parts) {
      const aSide = partOverrideSide(part);
      const aGroup = [part.kind, part.section || '', aSide || ''].join('|');
      const aIndex = anchorCounters.get(aGroup) || 0;
      anchorCounters.set(aGroup, aIndex + 1);
      part.anchorKey = aGroup + '|' + aIndex;
      if (m.uid != null && m.uid !== '') part.moduleUid = String(m.uid);
      const b = part.box;
      // Присадка на боковинах/перегородках (viewer.js, row.frontIsPlus)
      // знает, с какой стороны «лицо» (интерьер корпуса), по знаку
      // ЛОКАЛЬНОГО x — ДО поворота модуля, который идёт ниже. Поворот на
      // 90/270° меняет местами оси x/z; если не зафиксировать сторону
      // ЗДЕСЬ, viewer.js смотрит на уже повёрнутый мировой box.x, который
      // после поворота модуля не имеет отношения к тому, какая грань
      // смотрит внутрь корпуса — присадка на всех боковинах разом уезжает
      // не на ту сторону при повороте модуля в плане.
      if (part.frontIsPlus == null && b.w === Math.min(b.w, b.h, b.d)) {
        part.frontIsPlus = b.x < 0;
      }
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
      // 3) подъём навесного модуля на его отметку
      if (mountBottom) b.y = round1(b.y + mountBottom);
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
    (built.hardwareContext.hangerHardware || []).forEach((d) => hangerHardware.push(d));
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
    placed.push({ x0: gcx - cw / 2, x1: gcx + cw / 2, z0: gcz - cd / 2, z1: gcz + cd / 2,
      top: mountBottom + Number(m.height || 0), bottom: mountBottom });

    modules.push({
      name, offsetX: gcx, offsetZ: gcz, rotation: (dirRot + manualRot) % 360,
      // offsetY — отметка низа модуля от пола (у навесного = mountTop − H,
      // у напольного 0); mountTop — отметка верха навесного (null у напольных).
      offsetY: mountBottom, mountTop: hung ? mountTop : null, wallHung: hung,
      // dims.W/D — габарит корпуса НА МЕСТЕ (с учётом поворота и прогона);
      // dimsOwn — его СОБСТВЕННЫЕ ширина и глубина, без поворота: по ним
      // строится рабочий чертёж модуля.
      dims: Object.assign({}, built.dims, { W: cw, D: cd }),
      dimsOwn: Object.assign({}, built.dims, { W: c.w, D: c.d }),
      sides: built.sides, sidesLabel: built.sidesLabel, effSides: built.effSides,
      params: built.params,
    });

    if (place[idx].corner) {
      // УГЛОВОЙ СТЫК. Перпендикулярный ряд нельзя ставить вплотную: ящики
      // не выедут, а фасады и ручки столкнутся с соседом. Между ними ставят
      // ФАЛЬШ-ПЛАНКУ (доборную) из фасадного материала — она и держит зазор.
      const { cursor, frontV } = place[idx].corner;
      const sec0 = (m.sections && m.sections[0]) || {};
      const ftc = facadeTypeOf(sec0, proj.decor, tBody, proj.facadeMat || proj.decor, proj.facadeThickness);
      const mBaseH = m.base && m.base.type === 'plinth'
        ? Number(m.base.plinthHeight || 0) : Number((m.base && m.base.legHeight) || 0);
      const frontH = Number(m.height || 0) - mBaseH;
      const uC = cursor - ftc.thickness / 2;
      const vC = frontV + FILLER_W / 2;
      const gx = originX + U[0] * uC + V[0] * vC;
      const gz = originZ + U[1] * uC + V[1] * vC;
      const swap = dirRot === 90 || dirRot === 270;
      // У модуля со своей заглушкой стыковочную планку ставит он сам
      // (фальш-планка добора) — вторую в том же месте не делаем.
      if (!m.blindPanel) {
        const cornerFiller = Object.assign(makePart({
          name: 'Фальш-планка угловая', section: 'Угловой стык',
          material: ftc.material, thickness: ftc.thickness,
          length: frontH, width: FILLER_W, qty: 1, kind: 'filler', grain: true,
          note: `Фасадный элемент для стыка в углу, ${FILLER_W} мм; `
            + `корпус соседнего ряда отставлен ещё на ${FILLER_GAP} мм`,
          edging: { long1: fillerEdgeType(ftc), long2: fillerEdgeType(ftc), short1: fillerEdgeType(ftc), short2: fillerEdgeType(ftc) },
          x: round1(gx), y: mountBottom + mBaseH + frontH / 2, z: round1(gz),
          dims: swap
            ? { w: FILLER_W, h: frontH, d: ftc.thickness }
            : { w: ftc.thickness, h: frontH, d: FILLER_W },
        }), { module: name, rot: dirRot,
          // якорь для ручной разметки чертежа — см. anchorCounters выше
          anchorKey: 'filler|Угловой стык||corner',
          moduleUid: (m.uid != null && m.uid !== '') ? String(m.uid) : undefined });
        // Планка строится сразу в мировой системе (габариты уже повёрнуты
        // прогоном) — для направления текстуры возвращаем их в систему модуля.
        applyGrainDirection([cornerFiller], proj.grainGroups, m.grainOverrides,
          swap ? (bb) => ({ w: bb.d, h: bb.h, d: bb.w }) : null);
        allParts.push(cornerFiller);
      }

      // цоколь этого модуля дотягиваем до цоколя следующего прогона
      cornerPlinths.push({ name, sign: U[0] !== 0 ? U[0] : 0 });
    }
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

  // Столешницы соседних тумб сливаются в одну сквозную деталь, пока
  // помещаются в один лист материала (по аналогии с mergePlinths выше) —
  // только когда упираются в максимальную длину, остаётся настоящий стык.
  //
  // Снимок столешниц по модулям СНИМАЕТСЯ ДО mergeCountertops — она (и
  // joinCountertopSeams следом) мутируют part.box на месте (setSize/
  // growPhysSize/trimSecondary и т.п.) и при слиянии убирают из allParts
  // все детали ряда, кроме головной, — принадлежность к отдельным модулям
  // после этого теряется. box копируется (а не берётся ссылкой), иначе
  // снимок «поехал» бы вместе с дальнейшими мутациями тех же объектов.
  // Нужен для computeCountertopChains() ниже — определяет, какие тумбы
  // физически стыкуются столешницами (для автосмены материала по цепочке
  // в UI), независимо от того, совпадает ли материал сейчас.
  // Столешницы разных групп (основной ряд и остров) не сливаются и не
  // сшиваются, даже если стоят вплотную: у каждой группы своя столешница.
  const groupByModName = {};
  mods.forEach((m, i) => { groupByModName[m.name || `Модуль ${i + 1}`] = groupOf[i]; });
  allParts.forEach((p) => { if (p.kind === 'countertop') p.ctGroup = groupByModName[p.module] || 0; });
  const countertopSegmentsRaw = allParts
    .filter((p) => p.kind === 'countertop')
    .map((p) => ({ module: p.module, group: p.ctGroup, box: Object.assign({}, p.box), topY: countertopTopY(p) }));

  // Высокий модуль в ряду (пенал, колонка): столешницы с обеих сторон
  // упираются в его боковины и заканчиваются на внешней грани, свеса и
  // «сшивки» через него нет.
  clipCountertopsAtTall(allParts, placed);
  mergeCountertops(allParts);
  const countertopJoints = joinCountertopSeams(allParts, proj, warnings, placed);

  // Одинаковые предупреждения схлопываем — иначе список превращается в простыню
  // ШИНА МОНТАЖНАЯ под навесные модули: по каждому НЕПРЕРЫВНОМУ участку
  // верхнего ряда (прогон до угла; разрыв — если модули не встык) длина
  // L = сумма ширин модулей, отрезков ceil(L / WALL_RAIL_LENGTH).
  const wallRails = [];
  if (hangerRes.warning) warnings.push(hangerRes.warning);
  if (hangerRes.sys && catH.FASTENER_PRICES && catH.FASTENER_PRICES[catH.WALL_RAIL_KEY]) {
    const railLen = Number(catH.WALL_RAIL_LENGTH) || 2000;
    for (const run of wallRuns) {
      let seg = null;
      const flush = () => {
        if (seg && seg.length > 0) {
          wallRails.push({ length: round1(seg.length), pieces: Math.ceil(seg.length / railLen - 1e-9) });
        }
        seg = null;
      };
      for (const i of run) {
        const pl = place[i];
        if (seg && Math.abs(pl.u0 - seg.u1) > 0.5) flush();
        if (!seg) seg = { length: 0, u1: pl.u0 };
        seg.length += Number(mods[i].width || 0);
        seg.u1 = pl.u1;
      }
      flush();
    }
  } else if (hangerRes.sys) {
    warnings.push('Шина монтажная для навесных модулей удалена из каталога — в смету не попадёт.');
  }

  const uniqueWarnings = warnings.filter((w, i) => warnings.indexOf(w) === i);

  // Направление текстуры → порядок Длина/Ширина и кромок в деталировке.
  // ПОСЛЕ слияния цоколей/столешниц (длина уже итоговая) и ДО склейки одинаковых
  // деталей: grainAxis/grainSwap/grainAcross входят в mergeKey.
  finalizeGrainDisplay(allParts);

  const { merged, numByKey } = mergeEqualParts(allParts);
  // Несклеенный список: каждая деталь со своим модулем, секцией и боксом,
  // с номером позиции из деталировки. Нужен для чертежей.
  const partsRaw = allParts.map((part) => Object.assign({}, part, {
    num: numByKey.get(mergeKey(part)),
    boxes: [part.box],
  }));

  // Высота проекта — до верха самого высокого модуля ОТ ПОЛА (навесные
  // подняты на свою отметку, см. mountBottom).
  const maxH = placed.length
    ? round1(Math.max.apply(null, placed.map(p => p.top)))
    : Math.max.apply(null, mods.map(m => Number(m.height || 0)));
  const spanW = placed.length
    ? Math.max.apply(null, placed.map(p => p.x1)) - Math.min.apply(null, placed.map(p => p.x0)) : 0;
  const maxD = placed.length
    ? Math.max.apply(null, placed.map(p => p.z1)) - Math.min.apply(null, placed.map(p => p.z0)) : 0;

  return {
    project: proj,
    modules,
    isMulti: mods.length > 1,
    moduleGroup: groupOf,   // номер группы (основная = 0, острова = 1…) по индексу модуля
    dims: { W: round1(spanW), H: maxH, D: round1(maxD) },
    parts: merged,
    partsRaw,
    hardwareContext: { drawerHardware, doorHardware, handleHardware, liftHardware, jointRows,
      countertopJoints, hangerHardware, wallRails,
      sectionsCount: mods.length, jointCount },
    warnings: uniqueWarnings,
    // Группы модулей, чьи столешницы физически соприкасаются (см.
    // computeCountertopChains ниже) — НЕ по совпадению материала, а по
    // геометрии стыка (тот же тест, что в joinCountertopSeams). Используется
    // в UI, чтобы при смене материала столешницы одной тумбы автоматически
    // применить его ко всей цепочке стыкующихся тумб, но не ко всем модулям
    // проекта (отдельно стоящая секция/остров со своим швом — не в цепочке).
    countertopChains: computeCountertopChains(countertopSegmentsRaw, placed),
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
      head.module = moduleListLabel(run.map(p => p.module));
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
    facadeDecor: p.facadeDecor, facadeMat: p.facadeMat, facadeThickness: p.facadeThickness,
    jointType: p.jointType, gap: p.gap, drawerUnitHeight: p.drawerUnitHeight,
    modules: [{
      name: 'Изделие', width: p.width, height: p.height, depth: p.depth,
      scheme: p.scheme, leftSide: p.leftSide, rightSide: p.rightSide,
      base: p.base, sections: p.sections,
      backMount: p.backMount, backGroove: p.backGroove, wallHung: p.wallHung,
      mountTop: p.mountTop,
    }],
  };
}

// Названия «Боковина левая/правая» и «Планка верхняя передняя/задняя» — это
// зеркальные детали ОДНОГО вида (kind: 'side'/'top'): при прочих равных
// (размер, материал, кромка, присадка) они физически одна и та же заготовка,
// левое/правое — не признак различия для раскроя, а подпись для чертежа
// (её сохраняет НЕсклеенный partsRaw). Без нормализации имени они никогда не
// склеятся в деталировке просто из-за слова в названии.
function mergeNameKey(part) {
  if (part.kind === 'side' || part.kind === 'top') {
    // \b не годится: в JS без /u он основан на \w, а кириллица в \w не входит,
    // поэтому граница слова после кириллического слова не определяется —
    // используем явный лукахед на «(» (для «...(видимая)») или конец строки.
    return part.name.replace(/\s*(левая|правая|передняя|задняя)(?=\s*\(|$)/, '');
  }
  return part.name;
}

// Ключ склейки: детали считаются одинаковыми, если совпадают все значимые
// поля. Секция в ключ НЕ входит — одинаковые полки из разных секций это одна
// строка деталировки.
function mergeKey(part) {
  return JSON.stringify([
    mergeNameKey(part), part.material, part.thickness, part.length, part.width,
    part.edging.long1, part.edging.long2, part.edging.short1, part.edging.short2,
    part.grainDirection, part.note,
    // Направление текстуры: две одинаковые по размеру детали с разным
    // направлением (одна повёрнута вручную) — разные строки деталировки.
    // grainAcross у детали без рисунка не учитываем: остаточная правка от
    // прежнего декора не должна разбивать одинаковые детали на две строки.
    part.grainAxis || null, part.grainSwap || false, part.grainAxis ? !!part.grainAcross : false,
    // Присадка/пазы/тип фасада — иначе две иначе одинаковые детали с разной
    // присадкой (например, деталь с ручными правками из part.overrides)
    // молча склеятся в одну строку и потеряют/задвоят отверстия.
    part.holes, part.grooves, part.notches || [], part.facadeType,
    // Алюм. фасады одного размера, но другого профиля/цвета/заполнения/
    // режима цены — разные строки (и разные позиции сметы).
    part.aluFrame ? [part.aluFrame.profile, part.aluFrame.color, part.aluFrame.fill,
      part.aluFrame.priceMode, part.aluFrame.maker] : null,
    // Деталь с ручной правкой (applyPartOverrides, part.overridden === true)
    // не склеивается вообще ни с чем — даже с другой такой же вручную
    // отредактированной деталью — у каждой своя причина отличия от проекта.
    // part.id — уникальный порядковый номер детали (см. makePart/_partSeq),
    // присвоенный ДО склейки/нумерации позиций, поэтому годится как «отпечаток
    // одного экземпляра»; part.num на этом этапе ещё не существует.
    part.overridden ? part.id : null,
  ]);
}

// Зеркальные детали (mergeNameKey уже свела «левая»/«правая»/«передняя»/
// «задняя» к общему ключу) после склейки показывать под старым частным
// именем нельзя — строка с qty=4 «Боковина левая» вводит в заблуждение
// (там на самом деле и левые, и правые). Если в группу попало больше одного
// исходного названия — заменяем на общее название вида, иначе оставляем
// исходное как есть (единственное название группы).
const MERGED_DISPLAY_NAME = { side: 'Боковины', top: 'Планки верхние' };
function mergeDisplayName(kind, names) {
  if (names.length <= 1) return names[0];
  return MERGED_DISPLAY_NAME[kind] || names.join(' / ');
}

// Для горизонтальной плиты (столешница) box.w изначально совпадает с
// length, box.d — с width; part.rot∈{90,270} эти оси в box меняет местами
// (см. основной цикл buildModel — манипуляции с b.w/b.d при
// manualRot/dirRot 90°/270°). Общий хелпер для mergeCountertops() и
// joinCountertopSeams() ниже — обоим нужно синхронно менять то box.w/box.d,
// то top-level length/width при одной и той же ориентации детали.
function countertopLenAxisIsW(p) {
  const r = ((Math.round(p.rot || 0) % 360) + 360) % 360;
  return !(r === 90 || r === 270);
}

// «Задняя» (пристенная) грань столешницы в ГЛОБАЛЬНЫХ координатах — та, что
// НЕ двигается от свеса спереди (oF), т.е. противоположна фасаду. Локально
// свес спереди всегда толкает деталь в сторону local+Z (см. z-формулу в
// buildModuleParts: чем больше oF, тем больше z), поэтому направление
// local+Z ВСЕГДА означает «перёд». При повороте (part.rot) эта локальная
// ось отображается в глобальную по чистой матрице поворота (без отражений,
// см. комментарий у holeAxisSign выше) — проверено эмпирически на реальных
// стыках (rot=0 → перёд = +Z; rot=270 → перёд = −X):
//   rot=0:   перёд +Z (высокий Z) → зад −Z (низкий Z), ось глубины Z (box.d)
//   rot=90:  перёд +X (высокий X) → зад −X (низкий X), ось глубины X (box.w)
//   rot=180: перёд −Z (низкий Z)  → зад +Z (высокий Z), ось глубины Z (box.d)
//   rot=270: перёд −X (низкий X)  → зад +X (высокий X), ось глубины X (box.w)
function countertopBackEdge(p) {
  const r = ((Math.round(p.rot || 0) % 360) + 360) % 360;
  if (r === 0) return p.box.z - p.box.d / 2;
  if (r === 180) return p.box.z + p.box.d / 2;
  if (r === 90) return p.box.x - p.box.w / 2;
  return p.box.x + p.box.w / 2; // 270
}

// Общие хелперы оси для mergeCountertops()/joinCountertopSeams() ниже — ось
// ряда по ориентации детали (countertopLenAxisIsW), а не по соотношению
// box.w/box.d, как у mergePlinths: у цоколя ширина всегда мала (высота
// планки), поэтому длинная сторона однозначно определяет ось, а у
// столешницы длина и глубина — величины одного порядка (глубина тоже сотни
// мм), так что такое сравнение для неё ненадёжно.
function countertopAxisOf(p) { return countertopLenAxisIsW(p) ? 'x' : 'z'; }
function countertopSizeOn(p, ax) { return ax === 'x' ? p.box.w : p.box.d; }
function countertopSetBoxSize(p, ax, v) { if (ax === 'x') p.box.w = v; else p.box.d = v; }
// top-level length/width — то, что реально читают деталировка/кромка/
// спецификация (не box.w/box.d) — должны меняться в ту же физическую
// сторону, что и box, с поправкой на ориентацию (см. countertopLenAxisIsW).
function countertopSetPhysSize(p, ax, v) {
  const wIsLen = countertopLenAxisIsW(p);
  if (ax === 'x') { if (wIsLen) p.length = v; else p.width = v; }
  else if (wIsLen) p.width = v; else p.length = v;
}

// ---------------------------------------------------------------------------
// СТОЛЕШНИЦА: СЛИЯНИЕ СОСЕДНИХ ТУМБ В ОДНУ СКВОЗНУЮ ДЕТАЛЬ.
// По аналогии с mergePlinths выше — но, в отличие от цоколя, у столешницы
// есть жёсткий физический потолок длины (максимальная длина плиты
// материала, ctMaxLength — реальные 4100 мм у постформинга/компакт-плиты
// mobilier.md, sheetW декора корпуса у сдвоенного ЛДСП). Пока ряд тумб в
// этот потолок помещается — столешница ОДНА сквозная деталь, без стыка и
// без крепежа стыка. Как только упирается — начинается новая деталь, и
// граница между ними ВСЕГДА приходится на стык тумб (мы никогда не режем
// деталь посередине корпуса — слияние идёт целыми деталями по возрастанию
// координаты). Настоящие стыки, что остаются после этого прохода,
// обрабатывает joinCountertopSeams() ниже — она их не сливает, только
// считает крепёж и подрезает угловые.
// Верх столешницы детали p (мм от пола).
function countertopTopY(p) { return p.box.y + p.thickness / 2; }

// Высокие напольные модули (корпус пересекает уровень столешницы и
// поднимается выше неё), у которых нет столешницы: пенал, колонка.
function tallModulesAt(placed, topY) {
  const EPS = 1;
  return (placed || []).filter((m) => m.bottom < topY - EPS && m.top > topY + EPS);
}

// Обнуляет свес торца столешницы, которым она упирается в высокий модуль:
// столешница идёт ровно до внешней грани его боковины.
function clipCountertopsAtTall(parts, placed) {
  const EPS = 1;
  for (const p of parts) {
    if (p.kind !== 'countertop') continue;
    const talls = tallModulesAt(placed, countertopTopY(p));
    if (!talls.length) continue;
    const ax = countertopAxisOf(p);
    const lo = p.box[ax] - countertopSizeOn(p, ax) / 2;
    const hi = p.box[ax] + countertopSizeOn(p, ax) / 2;
    const cLo = (ax === 'x' ? p.box.z - p.box.d / 2 : p.box.x - p.box.w / 2);
    const cHi = (ax === 'x' ? p.box.z + p.box.d / 2 : p.box.x + p.box.w / 2);
    for (const t of talls) {
      const tLo = ax === 'x' ? t.x0 : t.z0, tHi = ax === 'x' ? t.x1 : t.z1;
      const crossLo = ax === 'x' ? t.z0 : t.x0, crossHi = ax === 'x' ? t.z1 : t.x1;
      if (Math.min(cHi, crossHi) - Math.max(cLo, crossLo) <= EPS) continue;
      if (Math.abs(tLo - hi) <= EPS) p.ctOverhangRight = 0;
      if (Math.abs(tHi - lo) <= EPS) p.ctOverhangLeft = 0;
    }
  }
}

// Есть ли высокий модуль в щели между двумя столешницами A и B.
function countertopGapHasTall(A, B, ov, placed) {
  const EPS = 1;
  const talls = tallModulesAt(placed, countertopTopY(A));
  if (!talls.length) return false;
  const span = (aLo, aHi, bLo, bHi) => (Math.min(aHi, bHi) - Math.max(aLo, bLo) > 0
    ? [Math.max(aLo, bLo), Math.min(aHi, bHi)]
    : [Math.min(aHi, bHi), Math.max(aLo, bLo)]);
  const [gx0, gx1] = span(ov.aLoX, ov.aHiX, ov.bLoX, ov.bHiX);
  const [gz0, gz1] = span(ov.aLoZ, ov.aHiZ, ov.bLoZ, ov.bHiZ);
  return talls.some((t) => Math.min(gx1, t.x1) - Math.max(gx0, t.x0) > EPS
    && Math.min(gz1, t.z1) - Math.max(gz0, t.z0) > EPS);
}

function mergeCountertops(parts) {
  const EPS = 1;
  const tops = parts.filter((p) => p.kind === 'countertop');
  if (tops.length < 2) return;

  const axisOf = countertopAxisOf, sizeOn = countertopSizeOn, setSize = countertopSetBoxSize,
        growPhysSize = countertopSetPhysSize;

  const groups = new Map();
  for (const p of tops) {
    const ax = axisOf(p);
    const cross = ax === 'x' ? p.box.z : p.box.x;       // положение поперёк ряда
    const depthSize = ax === 'x' ? p.box.d : p.box.w;   // глубина столешницы
    const key = [ax, p.material, p.thickness, round1(p.box.y), round1(cross), round1(depthSize), p.ctGroup || 0].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const removed = new Set();
  for (const list of groups.values()) {
    const ax = axisOf(list[0]);
    list.sort((a, b) => a.box[ax] - b.box[ax]);

    const maxCut = list[0].ctMaxLength || Infinity;
    let run = [list[0]];
    // Применяется к КАЖДОЙ группе, даже одиночной (run.length===1) — свес
    // слева/справа этой тумбы (ctOverhangLeft/Right, см. buildModuleParts)
    // растягивает НАРУЖУ только истинные крайние грани готового ряда: левый
    // край — от ПЕРВОЙ (самой левой) тумбы ряда, правый — от ПОСЛЕДНЕЙ.
    // Свесы тумб В СЕРЕДИНЕ ряда сюда не попадают вообще — иначе середина
    // слитой столешницы становится шире фактического корпуса под ней.
    const flush = () => {
      if (!run.length) return;
      const lo = run[0].box[ax] - sizeOn(run[0], ax) / 2 - (Number(run[0].ctOverhangLeft) || 0);
      const last = run[run.length - 1];
      const hi = last.box[ax] + sizeOn(last, ax) / 2 + (Number(last.ctOverhangRight) || 0);
      const head = run[0];
      // Присадка растикс (kind:'minifixDowel', см. buildModuleParts) —
      // каждая деталь ряда получила её в СВОИХ локальных координатах
      // (x=0 — её собственный левый край, вдоль part.length; см. makePart).
      // После слияния локальный левый край головной детали (head) переезжает
      // на `lo` (с учётом свеса) — сдвигаем x КАЖДОГО дюбельного отверстия
      // (и головы, и склеиваемых в неё тумб) на разницу между СТАРЫМ
      // физическим левым краем этой конкретной детали и НОВЫМ (`lo`), чтобы
      // физическое положение отверстия не изменилось. Работает независимо от
      // поворота модуля (part.rot) — box[ax] уже в глобальных координатах
      // сцены, а сдвиг применяется к локальной x, которая всегда «вдоль
      // длины» независимо от того, как эта длина сейчас развёрнута.
      for (const part of run) {
        const partLeft = part.box[ax] - sizeOn(part, ax) / 2;
        const shift = round1(partLeft - lo);
        for (const h of part.holes) {
          if (h.kind === 'minifixDowel') h.x = round1(h.x + shift);
        }
        if (part !== head) {
          head.holes = head.holes.concat(part.holes.filter((h) => h.kind === 'minifixDowel'));
        }
      }
      head.box[ax] = (lo + hi) / 2;
      setSize(head, ax, round1(hi - lo));
      growPhysSize(head, ax, round1(hi - lo));
      if (run.length > 1) {
        // Слитая деталь может покрывать тумбы с разным способом крепления
        // (планки/крышка/Rastex) — единого текста тут больше нет, точный
        // крепёж по каждой тумбе — в спецификации (считается отдельно по
        // m.topType/m.countertop, не по этой детали).
        // ctHasTopSupport — AND по всем слитым тумбам (см. hasTopSupport в
        // joinCountertopSeams): под компакт-плитой сплошная опора должна
        // быть по всей длине, не только по краям.
        head.note = `Сквозная столешница на ${run.length} тумбы — крепёж каждой тумбы см. в спецификации.`;
        head.ctHasTopSupport = run.every((p) => p.ctHasTopSupport);
        for (let i = 1; i < run.length; i++) removed.add(run[i]);
      }
      run = [];
    };

    for (let i = 1; i < list.length; i++) {
      const prev = run[run.length - 1];
      const gap = (list[i].box[ax] - sizeOn(list[i], ax) / 2)
        - (prev.box[ax] + sizeOn(prev, ax) / 2);
      // Свесы слева/справа краёв ряда сюда намеренно не добавлены (только
      // «сырая» ширина корпусов) — они малы относительно maxCut (десятки мм
      // против 4100), а сам свес известен окончательно только когда ряд уже
      // сложился (какая тумба останется крайней).
      const grown = (list[i].box[ax] + sizeOn(list[i], ax) / 2) - (run[0].box[ax] - sizeOn(run[0], ax) / 2);
      if (Math.abs(gap) <= EPS && grown <= maxCut) run.push(list[i]);
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

// ---------------------------------------------------------------------------
// СТОЛЕШНИЦА: КРЕПЁЖ СТЫКОВ МЕЖДУ СОСЕДНИМИ ТУМБАМИ.
// Работает уже ПОСЛЕ mergeCountertops() (см. ниже) — то есть только на
// РЕАЛЬНО оставшихся стыках (либо превышена макс. длина плиты, либо это
// угловой Г-образный стык двух перпендикулярных прогонов). Расставляет
// крепёж стыка и в угловом 90° стыке подрезает «вторичный» прямоугольник по
// грани «основного» (тот, что построен раньше — с меньшим индексом модуля).
function joinCountertopSeams(parts, proj, warnings, placed) {
  const EPS = 1;
  // Максимальный шаг между стяжками стыка, мм — по данным профильной
  // статьи о безпланочном угловом соединении столешниц (еврозапил + стяжки):
  // https://shkafkupeprosto.ru/states2/Soedinenie-stoleshnits-pod-pryamym-uglom-bez-planki..htm
  // ("600 мм — максимальное расстояние между стяжками"). Не подтверждено
  // производителем напрямую — при появлении более точного источника поправить.
  const TIE_STEP = 600;
  const cornerJoinType = proj.countertopCornerJoint || 'strip';
  const tops = parts.filter((p) => p.kind === 'countertop');
  const joints = [];
  if (tops.length < 2) return joints;

  const rectX = (p) => [p.box.x - p.box.w / 2, p.box.x + p.box.w / 2];
  const rectZ = (p) => [p.box.z - p.box.d / 2, p.box.z + p.box.d / 2];
  // seamLenMm — длина САМОГО СТЫКА (вдоль линии соединения), а НЕ длина
  // детали столешницы целиком: у прямого стыка это глубина столешницы
  // (перпендикулярно оси ряда), у углового — перекрытие в обоих направлениях.
  const tieQty = (seamLenMm) => Math.max(2, Math.ceil((Number(seamLenMm) || 0) / TIE_STEP));
  // ctHasTopSupport — уже свёрнутый по ВСЕМ слитым тумбам этой детали флаг
  // (AND), см. mergeCountertops() ниже — не topType одной конкретной тумбы.
  // «Опора» — планки-царги ИЛИ цельная крышка корпуса (см. skipTopPanel в
  // buildModuleParts): и то и другое даёт сплошную поверхность под краем
  // столешницы, к которой можно приклеить компакт-плиту.
  const hasTopSupport = (p) => !!p.ctHasTopSupport;

  const seamHardware = (kind, A, B, seamLenMm) => {
    // Клеевой/растиксовый узел — по РЕАЛЬНОЙ толщине резолвнутого материала
    // (то же единое правило >18мм, что и skipTopPanel в buildModuleParts;
    // изменено 2026-09-06 — раньше проверялось имя семейства ct.material
    // ('compact12'/'ldsp38'), теперь разбора по названию каталожной позиции
    // нет вообще, только физическая толщина этой конкретной детали).
    const isGlued = A.thickness <= 18;
    const hw = [];
    if (isGlued) {
      if (!hasTopSupport(A) || !hasTopSupport(B)) {
        warnings.push(`Стык столешницы у тумб "${A.module}"/"${B.module}": материал ≤18мм крепится клеем — `
          + `под краем нет опоры (планки/крышки), край столешницы приклеить не к чему.`);
      }
      hw.push({ key: 'countertopSealant', qty: 1 });
      return hw;
    }
    if (kind === 'corner') {
      if (A.thickness !== 38) {
        warnings.push('Угловая стяжка LMB-KAT38-20M рассчитана под ЛДСП 38мм — '
          + `для столешницы толщиной ${A.thickness} мм цена/совместимость не подтверждены.`);
      }
      hw.push({ key: 'countertopCornerTie', qty: tieQty(seamLenMm) });
      if (cornerJoinType === 'eurogroove') hw.push({ key: 'countertopSealant', qty: 1 });
      return hw;
    }
    hw.push({ key: 'countertopStraightTie', qty: tieQty(seamLenMm) });
    return hw;
  };

  // axis передаётся ЯВНО вызывающим кодом (не подбирается перебором «какое
  // из 4 условий сработает первым») — это ОБЯЗАТЕЛЬНО должна быть ось с
  // МЕНЬШИМ перекрытием (узкий настоящий шов угла, обычно порядка глубины
  // столешницы), а не та, что подвернётся по порядку проверки. У Г-образного
  // стыка «широкая» ось (вдоль всей длины одного из прогонов) тоже нередко
  // формально удовлетворяет тем же условиям — если довериться порядку
  // проверки X→Z, можно срезать secondary почти в ноль по ШИРОКОЙ оси
  // вместо аккуратной подрезки по узкой (баг, пойманный на реальном стыке:
  // деталь ужалась до 19 мм вместо ожидаемых ~600).
  const trimSecondary = (primary, secondary, axis) => {
    const [pLoX, pHiX] = rectX(primary), [pLoZ, pHiZ] = rectZ(primary);
    const [sLoX, sHiX] = rectX(secondary), [sLoZ, sHiZ] = rectZ(secondary);
    let cutSize = null;
    if (axis === 'x') {
      if (pLoX > sLoX + EPS && pLoX < sHiX - EPS) {
        cutSize = pLoX - sLoX;
        secondary.box.x = round1(sLoX + cutSize / 2); secondary.box.w = round1(cutSize);
      } else if (pHiX > sLoX + EPS && pHiX < sHiX - EPS) {
        cutSize = sHiX - pHiX;
        secondary.box.x = round1(pHiX + cutSize / 2); secondary.box.w = round1(cutSize);
      }
    } else {
      if (pLoZ > sLoZ + EPS && pLoZ < sHiZ - EPS) {
        cutSize = pLoZ - sLoZ;
        secondary.box.z = round1(sLoZ + cutSize / 2); secondary.box.d = round1(cutSize);
      } else if (pHiZ > sLoZ + EPS && pHiZ < sHiZ - EPS) {
        cutSize = sHiZ - pHiZ;
        secondary.box.z = round1(pHiZ + cutSize / 2); secondary.box.d = round1(cutSize);
      }
    }
    if (cutSize == null) return false;
    const wIsLen = countertopLenAxisIsW(secondary);
    if (axis === 'x') { if (wIsLen) secondary.length = round1(cutSize); else secondary.width = round1(cutSize); }
    else if (wIsLen) secondary.width = round1(cutSize); else secondary.length = round1(cutSize);
    secondary.note = (secondary.note ? secondary.note + '; ' : '')
      + `обрезана в угол по стыку с "${primary.module}" (прямой стык 90°)`;
    return true;
  };

  // Растягивает secondary НАВСТРЕЧУ primary, когда между ними зазор (а не
  // нахлёст) — величина зазора уже точно известна геометрией, придумывать
  // её не нужно, поэтому строим стык сразу правильно, а не просим
  // пользователя вручную подбирать свес по тексту предупреждения. Растягиваем
  // на gap+margin (не ровно в стык) — тогда сразу после trimSecondary найдёт
  // небольшой нахлёст и аккуратно подрежет его до идеального стыка без зазора
  // и без нахлёста (иначе edge-case ровно нулевого перекрытия trimSecondary
  // не распознаёт — ей нужен строгий нахлёст хотя бы на EPS).
  const growSecondaryToMeet = (primary, secondary, axis) => {
    const margin = 2;
    const [pLoX, pHiX] = rectX(primary), [pLoZ, pHiZ] = rectZ(primary);
    const [sLoX, sHiX] = rectX(secondary), [sLoZ, sHiZ] = rectZ(secondary);
    let newSize;
    if (axis === 'x') {
      if (sLoX >= pHiX - EPS) {
        // secondary целиком правее primary — тянем его левую грань НАЗАД,
        // на margin ВНУТРЬ primary (нахлёст, не ещё один зазор), чтобы
        // ниже trimSecondary нашла строгое пересечение и подрезала его.
        const targetLo = pHiX - margin;
        newSize = sHiX - targetLo;
        secondary.box.x = round1(targetLo + newSize / 2); secondary.box.w = round1(newSize);
      } else {
        const targetHi = pLoX + margin;
        newSize = targetHi - sLoX;
        secondary.box.x = round1(sLoX + newSize / 2); secondary.box.w = round1(newSize);
      }
    } else if (sLoZ >= pHiZ - EPS) {
      const targetLo = pHiZ - margin;
      newSize = sHiZ - targetLo;
      secondary.box.z = round1(targetLo + newSize / 2); secondary.box.d = round1(newSize);
    } else {
      const targetHi = pLoZ + margin;
      newSize = targetHi - sLoZ;
      secondary.box.z = round1(sLoZ + newSize / 2); secondary.box.d = round1(newSize);
    }
    const wIsLen = countertopLenAxisIsW(secondary);
    if (axis === 'x') { if (wIsLen) secondary.length = round1(newSize); else secondary.width = round1(newSize); }
    else if (wIsLen) secondary.width = round1(newSize); else secondary.length = round1(newSize);
    secondary.note = (secondary.note ? secondary.note + '; ' : '')
      + `удлинена на угловом стыке с "${primary.module}", чтобы столешницы сошлись без зазора`;
  };

  // Само по себе смыкание шва (growSecondaryToMeet/trimSecondary выше) НЕ
  // означает, что столешница дотягивается до настоящей стены — между
  // корпусами тумб в углу специально оставлен зазор (доборная планка,
  // FILLER_GAP), так что «где сходятся корпуса» и «где стена» — разные
  // точки. Основная деталь (primary) должна доходить до ЗАДНЕЙ (пристенной)
  // грани вторичной по своей ДЛИННОЙ оси — это отдельная, независимая от
  // шва корректировка (обнаружено пользователем на реальном чертеже: длинная
  // столешница не доставала до стены, хотя сам шов уже сходился идеально).
  const extendPrimaryToWall = (primary, secondary) => {
    const ax = countertopAxisOf(primary);
    const target = countertopBackEdge(secondary);
    const lo = primary.box[ax] - countertopSizeOn(primary, ax) / 2;
    const hi = primary.box[ax] + countertopSizeOn(primary, ax) / 2;
    const growHi = Math.abs(target - hi) < Math.abs(target - lo);
    const newLo = growHi ? lo : target;
    const newHi = growHi ? target : hi;
    const newSize = newHi - newLo;
    if (newSize <= EPS) return false;
    primary.box[ax] = round1((newLo + newHi) / 2);
    countertopSetBoxSize(primary, ax, round1(newSize));
    countertopSetPhysSize(primary, ax, round1(newSize));
    primary.note = (primary.note ? primary.note + '; ' : '')
      + `дотянута до стены на угловом стыке с "${secondary.module}"`;
    return true;
  };

  for (let i = 0; i < tops.length; i++) {
    for (let j = i + 1; j < tops.length; j++) {
      const A = tops[i], B = tops[j];   // A построен раньше B (порядок allParts)
      if ((A.ctGroup || 0) !== (B.ctGroup || 0)) continue;   // разные группы не сшиваем
      if (A.material !== B.material || Math.abs(A.thickness - B.thickness) > EPS) {
        warnings.push(`Стык столешницы "${A.module}"/"${B.module}": разный материал/толщина `
          + `столешницы у соседних тумб — крепёж стыка не посчитан, стык нужно решать вручную.`);
        continue;
      }

      const overlaps = () => {
        const [aLoX, aHiX] = rectX(A), [bLoX, bHiX] = rectX(B);
        const [aLoZ, aHiZ] = rectZ(A), [bLoZ, bHiZ] = rectZ(B);
        return {
          aLoX, aHiX, bLoX, bHiX, aLoZ, aHiZ, bLoZ, bHiZ,
          xOverlap: Math.min(aHiX, bHiX) - Math.max(aLoX, bLoX),
          zOverlap: Math.min(aHiZ, bHiZ) - Math.max(aLoZ, bLoZ),
        };
      };
      let ov = overlaps();
      const touchX = Math.abs(ov.aHiX - ov.bLoX) < EPS || Math.abs(ov.bHiX - ov.aLoX) < EPS;
      const touchZ = Math.abs(ov.aHiZ - ov.bLoZ) < EPS || Math.abs(ov.bHiZ - ov.aLoZ) < EPS;

      if ((touchX && ov.zOverlap > Math.min(A.box.d, B.box.d) * 0.5)
          || (touchZ && ov.xOverlap > Math.min(A.box.w, B.box.w) * 0.5)) {
        if (Math.abs(A.box.y - B.box.y) > EPS) {
          warnings.push(`Стык столешницы "${A.module}"/"${B.module}": `
            + `разный уровень столешницы (${A.box.y} мм и ${B.box.y} мм) — стык не построен.`);
          continue;
        }
        // Длина стыка — вдоль линии соединения, а НЕ длина детали целиком:
        // для стыка в линию (touchX) шов идёт поперёк, вдоль оси Z (глубина
        // столешницы), для (touchZ) — вдоль оси X.
        const seamLen = touchX ? ov.zOverlap : ov.xOverlap;
        joints.push({ type: 'straight', material: A.material,
          hardware: seamHardware('straight', A, B, seamLen), modules: [A.module, B.module] });
        continue;
      }
      if (ov.xOverlap <= EPS || ov.zOverlap <= EPS) {
        // Кандидат на угловой стык двух перпендикулярных прогонов: по одной
        // оси прямоугольники столешницы всегда пересекаются существенно (обе
        // тумбы своей глубиной перекрывают угловую зону), по другой — либо
        // тоже пересекаются (тогда это ветка ниже), либо есть зазор —
        // типично из-за доборной планки/зазора углового модуля (FILLER_GAP,
        // blindStrip — см. основной цикл buildModel).
        const zGap = ov.zOverlap < -EPS ? -ov.zOverlap : 0;
        const xGap = ov.xOverlap < -EPS ? -ov.xOverlap : 0;
        const looksCorner = (ov.xOverlap > EPS && zGap > EPS && zGap < Math.max(A.box.d, B.box.d))
                          || (ov.zOverlap > EPS && xGap > EPS && xGap < Math.max(A.box.w, B.box.w));
        if (!looksCorner) continue;
        // Между столешницами стоит высокий модуль — это два отдельных
        // участка, а не угол: растягивать одну навстречу другой нельзя.
        if (countertopGapHasTall(A, B, ov, placed)) continue;
        // Зазор реален и его величина точно известна — растягиваем B
        // (secondary) навстречу A на эту величину, а не просим пользователя
        // подобрать свес вручную (величина уже посчитана, придумывать её
        // пользователю незачем).
        growSecondaryToMeet(A, B, zGap > 0 ? 'z' : 'x');
        ov = overlaps();
      }
      if (ov.xOverlap > EPS && ov.zOverlap > EPS) {
        if (Math.abs(A.box.y - B.box.y) > EPS) {
          warnings.push(`Угловой стык столешницы "${A.module}"/"${B.module}": `
            + `разный уровень столешницы (${A.box.y} мм и ${B.box.y} мм) — стык не построен.`);
          continue;
        }
        // Основная деталь дотягивается до задней (пристенной) грани
        // вторичной — независимо от того, сходится ли уже шов между ними
        // (см. extendPrimaryToWall выше). Пересчитываем перекрытия заново —
        // после растяжения «широкая» ось (obычно X) выросла ещё сильнее, но
        // именно она и была не менее узкой оси стыка, порядок не меняется.
        extendPrimaryToWall(A, B);
        ov = overlaps();
        // Ось подрезки — та, где перекрытие МЕНЬШЕ (настоящий узкий шов
        // угла), а не первая по порядку проверки внутри trimSecondary — см.
        // комментарий над её определением.
        const trimAxis = ov.xOverlap <= ov.zOverlap ? 'x' : 'z';
        if (!trimSecondary(A, B, trimAxis)) {
          warnings.push(`Угловой стык столешницы "${A.module}"/"${B.module}": `
            + `геометрия пересечения не подошла для прямой подрезки — проверьте свесы вручную.`);
          continue;
        }
        // Длина углового стыка ≈ меньшее из перекрытий по X/Z (по факту это
        // глубина столешницы в зоне угла) — до подрезки secondary это ещё
        // видно из исходных ov.xOverlap/ov.zOverlap.
        const cornerSeamLen = Math.min(ov.xOverlap, ov.zOverlap);
        joints.push({ type: 'corner', material: A.material,
          hardware: seamHardware('corner', A, B, cornerSeamLen), modules: [A.module, B.module] });
      }
    }
  }
  return joints;
}

// ---------------------------------------------------------------------------
// СТОЛЕШНИЦА: ЦЕПОЧКИ ФИЗИЧЕСКОГО СТЫКА (для автосмены материала в UI).
// Независимая от joinCountertopSeams функция — та решает, ставить ли крепёж
// стыка, и ругается на разный материал/уровень; эта — просто отвечает на
// геометрический вопрос «эти тумбы физически соприкасаются столешницами?»,
// БЕЗ фильтра по материалу (материал как раз и предстоит распространить по
// цепочке). EPS=1 и все пороги перекрытия — те же константы, что уже
// использует joinCountertopSeams, ничего нового не введено. segments —
// снимок { module, box }, снятый ДО mergeCountertops() в buildModel (см.
// countertopSegmentsRaw), пока у каждого модуля ещё своя отдельная деталь
// столешницы.
//
// Повторяет ВСЕ геометрические признаки стыка, которые joinCountertopSeams
// использует, чтобы вообще построить joint (см. её код выше) — сама
// подрезка/растяжение детали (trimSecondary/growSecondaryToMeet/
// extendPrimaryToWall) сюда не нужны, для связности модулей достаточно
// факта касания:
//   1) прямой стык впритык (touchX/touchZ + overlap > половины меньшей
//      глубины/ширины);
//   2) угловой стык, где сырые прямоугольники столешниц уже пересекаются по
//      ОБЕИМ осям без всякого растяжения (joinCountertopSeams строит
//      corner-joint сразу, минуя growSecondaryToMeet);
//   3) угловой стык через реальный зазор — доборная планка/FILLER_GAP
//      невставленного углового модуля (тест looksCorner: одна ось
//      перекрывается существенно, по другой — зазор меньше максимальной
//      глубины/ширины сегмента).
function computeCountertopChains(segments, placed) {
  const EPS = 1;
  const n = segments.length;
  const parent = segments.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (i, j) => {
    const ri = find(i), rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  };

  const rectX = (s) => [s.box.x - s.box.w / 2, s.box.x + s.box.w / 2];
  const rectZ = (s) => [s.box.z - s.box.d / 2, s.box.z + s.box.d / 2];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const A = segments[i], B = segments[j];
      if ((A.group || 0) !== (B.group || 0)) continue; // другая группа (остров) — не стык
      if (Math.abs(A.box.y - B.box.y) > EPS) continue; // разный уровень — не стык
      const [aLoX, aHiX] = rectX(A), [bLoX, bHiX] = rectX(B);
      const [aLoZ, aHiZ] = rectZ(A), [bLoZ, bHiZ] = rectZ(B);
      const xOverlap = Math.min(aHiX, bHiX) - Math.max(aLoX, bLoX);
      const zOverlap = Math.min(aHiZ, bHiZ) - Math.max(aLoZ, bLoZ);
      const touchX = Math.abs(aHiX - bLoX) < EPS || Math.abs(bHiX - aLoX) < EPS;
      const touchZ = Math.abs(aHiZ - bLoZ) < EPS || Math.abs(bHiZ - aLoZ) < EPS;
      // 1) прямой стык впритык — см. joinCountertopSeams, блок touchX/touchZ.
      if ((touchX && zOverlap > Math.min(A.box.d, B.box.d) * 0.5)
          || (touchZ && xOverlap > Math.min(A.box.w, B.box.w) * 0.5)) {
        union(i, j);
        continue;
      }
      // 2) угловой стык, где сырые прямоугольники УЖЕ пересекаются по ОБЕИМ
      // осям без растяжения — joinCountertopSeams строит corner-joint сразу
      // (ветка `ov.xOverlap > EPS && ov.zOverlap > EPS` после touchX/touchZ,
      // строка ~4567).
      if (xOverlap > EPS && zOverlap > EPS) {
        union(i, j);
        continue;
      }
      // 3) угловой стык через реальный зазор (доборная планка/FILLER_GAP
      // невставленного углового модуля) — тот же тест looksCorner, что в
      // joinCountertopSeams (строки ~4548-4559): одна ось пересекается
      // существенно, по другой — зазор меньше максимальной глубины/ширины
      // сегмента.
      const zGap = zOverlap < -EPS ? -zOverlap : 0;
      const xGap = xOverlap < -EPS ? -xOverlap : 0;
      const looksCorner = (xOverlap > EPS && zGap > EPS && zGap < Math.max(A.box.d, B.box.d))
                        || (zOverlap > EPS && xGap > EPS && xGap < Math.max(A.box.w, B.box.w));
      // Высокий модуль в щели между столешницами — это два отдельных участка.
      if (looksCorner && !countertopGapHasTall(
        { box: A.box, thickness: 2 * (A.topY - A.box.y) },
        null,
        { aLoX, aHiX, bLoX, bHiX, aLoZ, aHiZ, bLoZ, bHiZ }, placed)) union(i, j);
    }
  }

  // Схлопываем в группы по корню union-find, а внутри группы — имена
  // модулей через Set: у одного модуля теоретически может быть больше
  // одного сегмента столешницы (например, Г-образная столешница из двух
  // прямоугольников на одном модуле) — сейчас buildModuleParts строит на
  // модуль ровно одну деталь kind:'countertop' (проверено 2026-09-12), но
  // дублей имени на выходе быть не должно в любом случае.
  const groupsByRoot = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groupsByRoot.has(r)) groupsByRoot.set(r, new Set());
    groupsByRoot.get(r).add(segments[i].module);
  }
  return [...groupsByRoot.values()].map((set) => [...set]);
}

// Модули, чья столешница физически стыкуется со столешницей moduleName
// (включая сам moduleName) — для UI, который должен при смене материала
// столешницы одной тумбы применить его ко всей цепочке. Возвращает
// [moduleName] и когда группы нет (у модуля нет столешницы вовсе), и когда
// модуль в проекте один/не стыкуется ни с кем — вызывающему коду не нужно
// отдельно обрабатывать «пустой» случай.
function getCountertopChainModules(model, moduleName) {
  const chains = (model && model.countertopChains) || [];
  for (const group of chains) {
    if (group.indexOf(moduleName) !== -1) return group;
  }
  return [moduleName];
}

// Глубина столешницы для КАЖДОГО напольного модуля (по исходному индексу в
// mods) — одно значение на связку физически стыкующихся кухонных тумб, а не
// одно на весь проект (решение пользователя 2026-09-28: в одном проекте
// обычный ряд на 600 мм и остров посередине на 900/1200 мм — разные связки).
// Вызывается ИЗ buildModel ДО buildModuleParts — реальные built-сегменты
// столешниц (как в computeCountertopChains выше) ещё не существуют, но они
// и не нужны: floorIdx уже отфильтрован по напольным/навесным (см. выше,
// `mods.forEach((m, i) => (isWallHung(m) ? wallIdx : floorIdx).push(i))`) и
// сохраняет исходный порядок mods — а раскладка (layoutLayer выше) кладёт
// напольные модули строго ВПРИТЫК друг к другу в этом же порядке (никаких
// зазоров между ними), в том числе через угол (следующий прогон начинается
// от внешней грани углового модуля). Значит соседние элементы floorIdx —
// ВСЕГДА физические соседи, реальная геометрия для этого не нужна.
// Резолюция на модуль:
//  1) кухонный напольный (не навесной) со включённой столешницей — сосед по
//     цепочке подряд идущих таких же модулей; глубина связки = целевая
//     глубина (countertopTargetDepthOf — ручное p.countertop.depth или
//     ctMat.depth) первого члена связки, у кого она определена;
//  2) кухонный напольный без своей столешницы (пенал и т.п.) — глубина
//     ближайшего соседа по floorIdx, у которого столешница есть (сначала
//     предыдущий, потом следующий — если подряд несколько пеналов, каждый
//     следующий наследует уже вычисленную глубину предыдущего, то есть по
//     факту берётся глубина ближайшей связки СЛЕВА по всей цепочке пеналов);
//  3) ни своей, ни соседской столешницы нет (в проекте вообще нет ни одной
//     столешницы) — 0, без удлинения: дотягивать боковину до стены имеет
//     смысл только рядом с реальной столешницей (как и было раньше, когда
//     проектное значение по умолчанию просто не влияло на некухонные/
//     безстолешничные сборки).
// Навесные и некухонные модули явно не резолвятся (undefined) — вызывающий
// код (buildModel) и так домножает результат на `m.family==='kitchen' && !hung`.
function resolveCountertopChainDepths(mods, floorIdx) {
  const FALLBACK_DEPTH = 600;
  const isFloorStandingKitchen = (m) => m.family === 'kitchen' && !isWallHung(m);
  const hasOwnCountertop = (m) => !!(m.countertop && m.countertop.enabled);
  const result = [];
  // 1) связки подряд идущих модулей со своей столешницей.
  let i = 0;
  while (i < floorIdx.length) {
    const gi = floorIdx[i];
    if (!(isFloorStandingKitchen(mods[gi]) && hasOwnCountertop(mods[gi]))) { i += 1; continue; }
    let j = i;
    let depth = null;
    while (j < floorIdx.length) {
      const gj = floorIdx[j];
      if (!(isFloorStandingKitchen(mods[gj]) && hasOwnCountertop(mods[gj]))) break;
      if (depth == null) {
        depth = countertopTargetDepthOf(mods[gj].countertop, countertopMatOf(mods[gj].countertop));
      }
      j += 1;
    }
    const finalDepth = depth || FALLBACK_DEPTH;
    for (let k = i; k < j; k++) result[floorIdx[k]] = finalDepth;
    i = j;
  }
  // 2) кухонные напольные без своей столешницы — глубина ближайшего соседа.
  // Если соседа со столешницей нет вовсе (в проекте нигде нет ни одной
  // столешницы — обычная некухонная-по-факту мебель с family:'kitchen', или
  // тестовая сборка без countertop) — 0, БЕЗ запасных 600: нечего дотягивать
  // до стены, когда столешницы в принципе нет ни у одного модуля рядом.
  // FALLBACK_DEPTH здесь НЕ используется — она только для пункта 1 (своя
  // столешница ЕСТЬ, но у её материала нет чёткой глубины).
  for (let idx = 0; idx < floorIdx.length; idx++) {
    const gi = floorIdx[idx];
    if (result[gi] !== undefined || !isFloorStandingKitchen(mods[gi])) continue;
    const prev = idx > 0 ? result[floorIdx[idx - 1]] : undefined;
    const next = idx < floorIdx.length - 1 ? result[floorIdx[idx + 1]] : undefined;
    result[gi] = prev !== undefined ? prev : (next !== undefined ? next : 0);
  }
  return result;
}

// Список модулей-источников для колонки «Модуль» в деталировке — заголовок
// колонки уже говорит, что там модуль, поэтому «Модуль 1 + Модуль 2» —
// лишнее повторение слова и на десятке модулей займёт всю ширину колонки.
// Модуль по умолчанию называется «Модуль N» (см. buildModel, name = m.name
// || `Модуль ${idx+1}`) — для него оставляем только номер; у модуля с
// собственным именем (пользователь переименовал) префикса «Модуль » нет,
// показываем имя как есть.
function moduleListLabel(names) {
  const uniq = names.filter((v, i, a) => a.indexOf(v) === i);
  return uniq.map((n) => (n || '').replace(/^Модуль /, '')).join(', ');
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
      if (existing._names.indexOf(part.name) === -1) existing._names.push(part.name);
      if (existing._modules.indexOf(part.module) === -1) existing._modules.push(part.module);
    } else {
      map.set(key, Object.assign({}, part, {
        _boxes: [part.box], _names: [part.name], _modules: [part.module],
      }));
    }
  }
  // Номера позиций проставляются только деталям из листа: фурнитура (ножки)
  // в деталировке не участвует, иначе в нумерации появлялись бы дыры.
  // Важно: ключ для numByKey считаем ДО подмены имени/модуля на дисплейные
  // (mergeDisplayName/join) — partsRaw ищет номер по mergeKey() СВОЕГО
  // (исходного, ещё не склеенного) имени, и он должен совпасть с ключом,
  // под которым эта группа лежала в map, а не с тем, что показывается
  // в деталировке после склейки.
  let idx = 0;
  const merged = [];
  const numByKey = new Map();
  for (const row of map.values()) {
    const key = mergeKey(row);
    const num = row.hardware ? null : (idx += 1);
    numByKey.set(key, num);
    merged.push(Object.assign({}, row, {
      num, boxes: row._boxes,
      name: mergeDisplayName(row.kind, row._names),
      // Модуль(и), из которых реально пришли склеенные детали — см.
      // moduleListLabel: только номер для модулей по умолчанию, без слова
      // «Модуль» на каждый (иначе на десятке модулей колонка не влезает).
      module: moduleListLabel(row._modules),
    }));
  }
  return { merged, numByKey };
}

window.Modul3D = window.Modul3D || {};
window.Modul3D.engine = {
  buildModel, buildModuleParts, EDGE_FRONT, EDGE_BACK, EDGE_MID, SIDE_LABEL, sidesLabel,
  // Группы деталей для блока «Направление текстуры» (id + подпись); правило
  // «Авто» и поля детали — см. блок «НАПРАВЛЕНИЕ ТЕКСТУРЫ» выше.
  GRAIN_GROUPS,
  // Числа паза под заднюю стенку по умолчанию — UI берёт их отсюда, чтобы
  // не дублировать (см. resolveBackMount).
  BACK_GROOVE_DEFAULTS,
  // Высота, выше которой некухонный модуль — «шкаф» (крыша без паза в авто).
  BACK_GROOVE_TALL_H,
  // Навесной модуль: отметка верха по умолчанию (2400) и сам признак.
  WALL_MOUNT_TOP_DEFAULT, isWallHung, RAIL_NOTCH,
  // Алюминиевый рамочный фасад: нормализованные параметры секции (с
  // умолчаниями для старых сохранений) — одни и те же для UI/3D/сметы.
  aluFacadeOf, aluFillSize, ALU_HINGE_NOTE,
  // Материал фасада секции/отсека (ldsp/mdf/glass4) и эффективные настройки
  // фасада отсека — UI берёт список допустимых материалов и итог из ядра:
  //   facadeMaterialOptions(facadeTypeId) → [{ code, name, thickness }]
  //   facadeMaterialOf(sec, { decor, facadeMat, facadeThickness, t })
  //     → { code, name, thickness, facadeType }
  //   zoneFacadeSettings(sec, zoneIdx) → копия sec с полями фасада зоны поверх
  facadeMaterialOptions, facadeMaterialOf, zoneFacadeSettings, ZONE_FACADE_KEYS,
  drawerFacadeTypeOf, DRAWER_FACADE_TYPES,
  // Эффективная толщина ЛДСП ящика секции (sec.drawerThickness → проектная
  // → 16 мм, НЕ толщина корпуса) — единая формула для ядра и UI, чтобы
  // поле «Толщина ЛДСП ящиков» не расходилось с реальным расчётом.
  effectiveDrawerThickness,
  // Правило умолчания ЛДСП-фасада (миграция старых проектов в app.js).
  facadeMaterialKind, inferMatKind, isGlassMaterial, ldspFacadeDefault,
  // «Видимая боковина» (проектный facadeDecor): ЛДСП/ДСП + фасадные МДФ-панели.
  visibleSideMaterialOptions,
  // Экран «Деталь»: чем можно заменить материал ОДНОЙ детали вида kind.
  partMaterialOptions,
  // Чистая функция раскладки вертикальных зон фасада — переиспользуется в
  // app.js (контекстное «Разделить на секции» из 3D), чтобы не дублировать
  // формулу стыков между зонами.
  layoutDoorZones,
  nicheFromEdgeDoorHeight,
  // Цепочка модулей, чьи столешницы физически стыкуются с moduleName (см.
  // computeCountertopChains/model.countertopChains в buildModel) — для
  // автосмены материала столешницы по всей цепочке в UI.
  getCountertopChainModules,
  // Режим задней стенки (накладная/в паз) — UI решению пользователя 2026-09-28
  // не показывает отдельный вариант «Авто»: вместо него в select всегда
  // выбран РЕЗУЛЬТАТ этой функции (пока пользователь не переопределит вручную,
  // см. app.js backMountBlock/autoBackMountMode). normalizeSides — её
  // обязательный второй аргумент (sides), тоже нужен UI отдельно.
  resolveBackMount, normalizeSides,
};
})();
