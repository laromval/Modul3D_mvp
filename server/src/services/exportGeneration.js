// exportGeneration.js
// ============================================================================
// Этап 3 монетизации (см. ТЗ-МОНЕТИЗАЦИЯ.md, раздел 4.3) — серверная генерация
// файлов деталировки/спецификации/присадки. Раньше это делал браузер
// (src/export.js, src/cnc.js) полностью на клиенте — код был открыт, платный
// гейт легко обходился через консоль разработчика. Теперь клиент лишь
// присылает уже посчитанные данные (model.parts / spec из engine.js и
// specification.js — единственного источника истины, который остаётся
// клиентским и не портируется на сервер), а сервер только сериализует их в
// файл — геометрию не пересчитывает и не проверяет.
//
// Логика формирования содержимого (колонки, форматы, единицы измерения,
// разметка DXF/CSV) перенесена БЕЗ ИЗМЕНЕНИЙ из src/export.js и src/cnc.js —
// это зона `export-cutting`, даже когда код физически на сервере (см.
// ТЗ-МОНЕТИЗАЦИЯ.md, 4.3). Роуты (server/src/routes/export.js) и проверка
// подписки — не этот файл, это зона `backend-monetization`.
//
// Обычный CommonJS-модуль Node (не браузерный IIFE — здесь нет window).
// ============================================================================

const XLSX = require('xlsx');

// Символ валюты — на сервере нет клиентского window.Modul3D.currency
// (это чисто UI-состояние браузера), поэтому клиент кладёт его прямо в
// присланный spec (spec.currencySymbol) перед отправкой. Если поле не
// пришло — используем прежнее поведение по умолчанию (₽ RUB).
const DEFAULT_CURRENCY_SYMBOL = '₽';

// --- Деталировка -----------------------------------------------------------
// 1:1 копия exportDetailing() из src/export.js, только вместо
// XLSX.writeFile(...) (браузерное скачивание) — XLSX.write(..., { type:
// 'buffer' }), которое возвращает Buffer для тела HTTP-ответа. Объединение
// одинаковых деталей (сумма qty, общий номер позиции) уже сделано в
// engine.js — mergeEqualParts/mergeKey — model.parts приходит сюда уже
// склеенным, повторно группировать не нужно.
function buildDetailingWorkbook(model, projectName) {
  const rows = (model.parts || [])
    .filter((r) => !r.hardware) // фурнитура (опоры и т.п.) — не лист, пропускаем
    .map((r) => {
      const ed = r.cutEdging || r.edging || {};
      return {
        '№ п/п': r.num,
        'Наименование детали': r.name,
        'Изделие/секция': r.section,
        'Материал': r.material,
        'Толщина, мм': r.thickness,
        // Длина/Ширина/кромки — в порядке деталировки: первой цифрой идёт
        // размер ВДОЛЬ текстуры (engine.js, finalizeGrainDisplay; у детали без
        // направления cut* равны length/width/edging). Модель от старого
        // клиента без cut* — как раньше, по length/width.
        'Длина, мм': r.cutLength != null ? r.cutLength : r.length,
        'Ширина, мм': r.cutWidth != null ? r.cutWidth : r.width,
        'Количество, шт': r.qty,
        'Кромка длинная сторона 1': ed.long1 || 'без кромки',
        'Кромка длинная сторона 2': ed.long2 || 'без кромки',
        'Кромка короткая сторона 1': ed.short1 || 'без кромки',
        'Кромка короткая сторона 2': ed.short2 || 'без кромки',
        'Направление текстуры': r.grainLabel || (r.grainDirection ? 'да' : 'нет'),
        'Примечание': r.note || '',
      };
    });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 6 }, { wch: 26 }, { wch: 16 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 10 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 16 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Деталировка');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// --- Спецификация ------------------------------------------------------------
// Основа — exportSpecification() из src/export.js (те же листы и колонки),
// плюс лист «Алюминиевые фасады» (spec.aluFacades, v311) и пометка у ИТОГО
// при spec.totalIncomplete. sym — см. DEFAULT_CURRENCY_SYMBOL выше.
//
// Цена/сумма/кол-во могут быть null («уточняйте цену» — петли для алюм.
// рамки в spec.hardware, строки spec.aluFacades): пишем «—» и текст
// пометки row.note в колонку «Примечание», 0 не подставляем. В суммы
// разделов такие строки не входят (как и в spec.totalCost на клиенте).
const DASH = '—';
function sumOf(arr) {
  const total = (arr || []).reduce((s, r) => {
    const v = r && r.sum !== null && r.sum !== undefined ? Number(r.sum) : 0;
    return s + (Number.isFinite(v) ? v : 0);
  }, 0);
  return Math.round(total * 100) / 100;
}
function orDash(v) { return v === null || v === undefined ? DASH : v; }

function addSheet(wb, rows, name) {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Нет позиций': '' }]);
  XLSX.utils.book_append_sheet(wb, ws, name);
}

function buildSpecificationWorkbook(spec, projectName) {
  const wb = XLSX.utils.book_new();
  const sym = spec.currencySymbol || DEFAULT_CURRENCY_SYMBOL;

  const sheetRows = (spec.sheetMaterials || []).map((m, i) => ({
    '№': i + 1, 'Позиция': m.name, 'Артикул': m.code, 'Ед. изм.': 'лист',
    'Площадь, м²': m.area_m2, 'Кол-во листов': m.sheets, [`Цена, ${sym}`]: orDash(m.price), [`Сумма, ${sym}`]: orDash(m.sum),
  }));
  addSheet(wb, sheetRows, '1. Листовые материалы');

  const edgeRows = (spec.edging || []).map((e, i) => ({
    '№': i + 1, 'Позиция': `Кромка ${e.type}`, 'Ед. изм.': 'пог.м',
    'Кол-во': e.length_m, [`Цена, ${sym}`]: e.price_per_m, [`Сумма, ${sym}`]: e.sum,
  }));
  addSheet(wb, edgeRows, '2. Кромка');

  // Колонка «Примечание» — только если хоть у одной строки есть пометка,
  // иначе лист как раньше.
  const hwList = spec.hardware || [];
  const hwHasNote = hwList.some((h) => h && h.note);
  const hwRows = hwList.map((h, i) => {
    const row = {
      '№': i + 1, 'Позиция': h.name, 'Артикул': h.article, 'Ед. изм.': h.unit,
      'Кол-во': orDash(h.qty), [`Цена, ${sym}`]: orDash(h.price), [`Сумма, ${sym}`]: orDash(h.sum),
    };
    if (hwHasNote) row['Примечание'] = h.note || '';
    return row;
  });
  addSheet(wb, hwRows, '3. Фурнитура');

  const fRows = (spec.fasteners || []).map((f, i) => ({
    '№': i + 1, 'Позиция': f.name, 'Артикул': f.article, 'Ед. изм.': f.unit,
    'Кол-во': f.qty, [`Цена, ${sym}`]: f.price, [`Сумма, ${sym}`]: f.sum,
  }));
  addSheet(wb, fRows, '4. Крепёж и метизы');

  // Алюминиевые фасады — лист есть, только если в проекте есть такие фасады
  // (старые проекты/клиенты без spec.aluFacades получают прежние 5 листов).
  const alu = Array.isArray(spec.aluFacades) ? spec.aluFacades : [];
  let n = 5;
  if (alu.length) {
    const aluRows = alu.map((r, i) => ({
      '№': i + 1, 'Позиция': r.name, 'Артикул': r.article || '',
      'Вариант': r.mode === 'own' ? 'своё изготовление' : 'покупной',
      'Ед. изм.': r.unit || '', 'Кол-во': orDash(r.qty),
      'Фасадов, шт': r.count != null ? r.count : '',
      'Хлыстов/отрезков, шт': r.bars != null ? r.bars : '',
      [`Цена, ${sym}`]: orDash(r.price), [`Сумма, ${sym}`]: orDash(r.sum),
      'Примечание': r.note || '',
    }));
    addSheet(wb, aluRows, `${n}. Алюминиевые фасады`);
    n += 1;
  }

  const unpricedN = Array.isArray(spec.unpricedItems) ? spec.unpricedItems.length : 0;
  const totalRows = [
    { 'Раздел': '1. Листовые материалы', [`Сумма, ${sym}`]: sumOf(spec.sheetMaterials) },
    { 'Раздел': '2. Кромка', [`Сумма, ${sym}`]: sumOf(spec.edging) },
    { 'Раздел': '3. Фурнитура', [`Сумма, ${sym}`]: sumOf(spec.hardware) },
    { 'Раздел': '4. Крепёж и метизы', [`Сумма, ${sym}`]: sumOf(spec.fasteners) },
  ];
  if (alu.length) totalRows.push({ 'Раздел': '5. Алюминиевые фасады', [`Сумма, ${sym}`]: sumOf(alu) });
  const totalRow = { 'Раздел': 'ИТОГО', [`Сумма, ${sym}`]: spec.totalCost };
  if (spec.totalIncomplete) {
    totalRow['Примечание'] = `без учёта позиций без цены (${unpricedN})`
      + (unpricedN ? ': ' + spec.unpricedItems.join('; ') : '');
  }
  totalRows.push(totalRow);
  addSheet(wb, totalRows, `${n}. Итог`);

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// --- Присадка для ЧПУ (перенесено из src/cnc.js без изменений) -------------
// Координаты отверстий берутся из деталей модели (part.holes) в системе
// координат самой детали: начало — левый нижний угол ЛИЦЕВОЙ стороны,
// ось X вправо по длине, ось Y вверх по ширине. Именно так деталь кладут
// на присадочный станок, поэтому пересчёт не нужен.

const PURPOSE = {
  handle: 'ручка',
  hingeCup: 'чашка петли',
  shelfSupport: 'полкодержатель',
  drawerRunner: 'направляющая ящика',
  rodFlange: 'держатель штанги',
  frontFix: 'крепление фасада к ящику',
  relingFix: 'держатель релинга',
  minifixCam: 'Rastex, эксцентрик',
  minifixBolt: 'Rastex, шток',
  minifixDowel: 'Rastex, дюбель Rapid S',
  boxBottomFix: 'крепление дна ящика',
  runnerLocator: 'посадка короба на направляющую',
  runnerLatch: 'гнездо защёлки короба',
  runnerBracket: 'отверстия для фиксатора (шуруп 3,5×20)',
  runnerPinRear: 'задний штифт направляющей',
  runnerPinFront: 'зацеп фиксатора',
  runnerPinCabinet: 'передний штифт направляющей (в боковине корпуса)',
  dowelEdge: 'нагель Ø8, в торец',
  dowelFace: 'нагель Ø8, в пласть',
  confirmatThrough: 'конфирмат, сквозное',
  confirmatEdge: 'конфирмат, в торец',
  legFix: 'крепление опоры (пилотное под шуруп 3,5×16)',
  hangerScrew: 'разметка саморез навески',
  countertopScrew: 'крепление столешницы, сквозное Ø4 под шуруп 3,5',
};

// Назначение сквозных вырезов детали (part.notches, engine.js).
const NOTCH_PURPOSE = {
  railNotch: 'Выпил под шину',
  hangerBackCut: 'Вырез под крюк навески',
};

// Контур детали L×W со сквозными прямоугольными вырезами у кромки
// (part.notches: {x0,y0,x1,y1} в координатах детали — x по длине, y по
// ширине от левого нижнего угла). Возвращает замкнутые петли точек
// [[x,y],...]: стороны прямоугольника минус участки вырезов плюс
// внутренние стороны вырезов, сцепленные в обход.
function notchedContour(L, W, notches) {
  const E = 0.01;
  const ns = [];
  for (const n of (notches || [])) {
    const cl = (v, m) => Math.min(Math.max(Number(v) || 0, 0), m);
    const xa = cl(Math.min(n.x0, n.x1), L), xb = cl(Math.max(n.x0, n.x1), L);
    const ya = cl(Math.min(n.y0, n.y1), W), yb = cl(Math.max(n.y0, n.y1), W);
    if (xb - xa > E && yb - ya > E) ns.push({ xa, xb, ya, yb });
  }
  if (!ns.length) return [[[0, 0], [L, 0], [L, W], [0, W]]];
  const cut = (a, b, list) => {
    let segs = [[a, b]];
    for (const c of list) {
      const nx = [];
      for (const sg of segs) {
        if (c[1] <= sg[0] + E || c[0] >= sg[1] - E) { nx.push(sg); continue; }
        if (c[0] - sg[0] > E) nx.push([sg[0], c[0]]);
        if (sg[1] - c[1] > E) nx.push([c[1], sg[1]]);
      }
      segs = nx;
    }
    return segs;
  };
  const segs = [];
  cut(0, L, ns.filter((n) => n.ya <= E).map((n) => [n.xa, n.xb])).forEach((g) => segs.push([[g[0], 0], [g[1], 0]]));
  cut(0, L, ns.filter((n) => n.yb >= W - E).map((n) => [n.xa, n.xb])).forEach((g) => segs.push([[g[0], W], [g[1], W]]));
  cut(0, W, ns.filter((n) => n.xa <= E).map((n) => [n.ya, n.yb])).forEach((g) => segs.push([[0, g[0]], [0, g[1]]]));
  cut(0, W, ns.filter((n) => n.xb >= L - E).map((n) => [n.ya, n.yb])).forEach((g) => segs.push([[L, g[0]], [L, g[1]]]));
  for (const n of ns) {
    if (n.xa > E) segs.push([[n.xa, n.ya], [n.xa, n.yb]]);
    if (n.xb < L - E) segs.push([[n.xb, n.ya], [n.xb, n.yb]]);
    if (n.ya > E) segs.push([[n.xa, n.ya], [n.xb, n.ya]]);
    if (n.yb < W - E) segs.push([[n.xa, n.yb], [n.xb, n.yb]]);
  }
  const key = (q) => `${Math.round(q[0] * 10)}|${Math.round(q[1] * 10)}`;
  const used = segs.map(() => false);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const pts = [segs[i][0], segs[i][1]];
    const startK = key(pts[0]);
    for (let guard = 0; guard < segs.length && key(pts[pts.length - 1]) !== startK; guard++) {
      const endK = key(pts[pts.length - 1]);
      let j = -1;
      for (let k = 0; k < segs.length; k++) {
        if (used[k]) continue;
        if (key(segs[k][0]) === endK) { j = k; pts.push(segs[k][1]); break; }
        if (key(segs[k][1]) === endK) { j = k; pts.push(segs[k][0]); break; }
      }
      if (j < 0) break;
      used[j] = true;
    }
    if (key(pts[pts.length - 1]) === startK) pts.pop();
    // Лишние точки посреди прямой стороны (стыки отрезков) контуру не нужны.
    const clean = pts.filter((q, idx) => {
      const a = pts[(idx - 1 + pts.length) % pts.length], b = pts[(idx + 1) % pts.length];
      return Math.abs((q[0] - a[0]) * (b[1] - q[1]) - (q[1] - a[1]) * (b[0] - q[0])) > E;
    });
    loops.push(clean.length >= 3 ? clean : pts);
  }
  return loops;
}

// Стекло на присадочный станок не идёт: отверстия в нём делают стеклорезчики
// своим инструментом. Поэтому стеклянные детали в выгрузку не попадают.
function isGlassPart(p) {
  return !!p.glass || /^GLASS/.test(String(p.material || ''));
}

function drilledParts(model) {
  // Деталь идёт на станок, если у неё есть присадка, паз ИЛИ сквозной вырез
  // (part.notches: выпил под шину, вырез под крюк навески) — это такие же
  // операции, их тоже режут на ЧПУ.
  return (model.parts || []).filter((p) => !p.hardware && !isGlassPart(p)
    && ((p.holes && p.holes.length) || (p.grooves && p.grooves.length)
      || (p.notches && p.notches.length)));
}

// --- CSV -------------------------------------------------------------------
function buildDrillCsv(model) {
  const rows = [['Поз.', 'Модуль', 'Деталь', 'Секция', 'Материал', 'Толщина',
                 'Длина', 'Ширина', 'Кол-во', 'X', 'Y', 'Диаметр', 'Глубина',
                 'Сторона', 'Назначение', 'Ось от низа, мм']];
  for (const p of drilledParts(model)) {
    for (const h of (p.holes || [])) {
      rows.push([
        p.num, p.module || '', p.name, p.section, p.material, p.thickness,
        p.length, p.width, p.qty,
        h.x, h.y, h.mark ? '' : h.d,
        h.through ? p.thickness : (h.depth || 0),
        // Точка разметки (h.mark, напр. саморез навески) — НЕ сверлится.
        h.mark ? 'разметка, не сверлить'
        : h.side === 'edge' ? 'в торец'
          // У дна и полки «изнанка» — это НИЗ детали: гнездо эксцентрика
          // прячут снизу, чтобы его не было видно внутри корпуса.
          : (h.through ? 'насквозь'
            : h.side === 'back'
              ? (p.kind === 'bottom' || p.kind === 'shelf' || p.kind === 'drawerBottom'
                ? 'снизу'
                : p.kind === 'drawerSide' ? 'снаружи ящика' : 'с изнанки')
              : (p.kind === 'top' ? 'сверху'
                : p.kind === 'drawerSide' || p.kind === 'drawerBack' ? 'изнутри ящика' : 'с лица')),
        PURPOSE[h.kind] || h.kind || '',
        // Отверстие в торец с заданной высотой оси (Ø6 зацепа в торце дна
        // Quadro): расстояние от нижней пласти. h.tz — от середины толщины.
        Number.isFinite(h.tz) ? Math.round((h.tz + p.thickness / 2) * 10) / 10 : '',
      ]);
    }
    // ПАЗЫ. Формат тот же: X/Y — начало оси паза, дальше конец, ширина и
    // глубина. Станку этого достаточно, чтобы выбрать фрезу и пройти канавку.
    for (const g of (p.grooves || [])) {
      rows.push([
        p.num, p.module || '', p.name, p.section, p.material, p.thickness,
        p.length, p.width, p.qty,
        g.x0, g.y0, `паз ${g.w} мм`, g.depth,
        `до ${g.x1};${g.y1}`,
        (g.note || 'паз') + (g.side === 'inner' ? ', с внутренней стороны' : ''),
        '',
      ]);
    }
    // СКВОЗНЫЕ ВЫРЕЗЫ (выпил под шину, вырез под крюк навески): X/Y — угол
    // выреза, размер по длине×ширине, глубина — на всю толщину.
    for (const n of (p.notches || [])) {
      const w = Math.round(Math.abs(n.x1 - n.x0) * 10) / 10;
      const h = Math.round(Math.abs(n.y1 - n.y0) * 10) / 10;
      rows.push([
        p.num, p.module || '', p.name, p.section, p.material, p.thickness,
        p.length, p.width, p.qty,
        n.x0, n.y0, `вырез ${w}×${h} мм`, p.thickness,
        `вырез ${n.x0};${n.y0}–${n.x1};${n.y1} насквозь`,
        [NOTCH_PURPOSE[n.kind] || 'Вырез', n.note].filter(Boolean).join(': '),
        '',
      ]);
    }
  }
  // разделитель «;» — так Excel в русской локали открывает файл без плясок
  return rows.map((r) => r.join(';')).join('\r\n');
}

// --- DXF -------------------------------------------------------------------
// Минимальный DXF R12: только ENTITIES, LINE и CIRCLE. Этого достаточно
// станкам и CAD-программам, а файл остаётся читаемым.
function dxfHeader() {
  return ['0', 'SECTION', '2', 'ENTITIES'];
}
function dxfLine(x1, y1, x2, y2, layer) {
  return ['0', 'LINE', '8', layer,
          '10', x1.toFixed(2), '20', y1.toFixed(2), '30', '0.0',
          '11', x2.toFixed(2), '21', y2.toFixed(2), '31', '0.0'];
}
function dxfCircle(x, y, r, layer) {
  return ['0', 'CIRCLE', '8', layer,
          '10', x.toFixed(2), '20', y.toFixed(2), '30', '0.0',
          '40', r.toFixed(2)];
}
// Замкнутая полилиния (R12: POLYLINE + VERTEX + SEQEND, флаг 70=1).
function dxfPolyline(pts, dy, layer) {
  const out = ['0', 'POLYLINE', '8', layer, '66', '1',
               '10', '0.0', '20', '0.0', '30', '0.0', '70', '1'];
  for (const q of pts) {
    out.push('0', 'VERTEX', '8', layer,
             '10', q[0].toFixed(2), '20', (q[1] + dy).toFixed(2), '30', '0.0');
  }
  out.push('0', 'SEQEND', '8', layer);
  return out;
}
function dxfText(x, y, h, text, layer) {
  return ['0', 'TEXT', '8', layer,
          '10', x.toFixed(2), '20', y.toFixed(2), '30', '0.0',
          '40', h.toFixed(2), '1', String(text)];
}

function buildDrillDxf(model) {
  const out = dxfHeader();
  const GAP = 60;                 // зазор между деталями в файле, мм
  let cursorY = 0;

  for (const p of drilledParts(model)) {
    const L = p.length, W = p.width;
    // контур детали: без вырезов — прямоугольник четырьмя LINE, как
    // раньше; со сквозными вырезами (part.notches) — замкнутой полилинией
    // по фактическому контуру, чтобы станок сразу резал деталь с вырезом.
    if ((p.notches || []).length) {
      for (const loop of notchedContour(L, W, p.notches)) {
        out.push.apply(out, dxfPolyline(loop, cursorY, 'CONTOUR'));
      }
    } else {
      out.push.apply(out, dxfLine(0, cursorY, L, cursorY, 'CONTOUR'));
      out.push.apply(out, dxfLine(L, cursorY, L, cursorY + W, 'CONTOUR'));
      out.push.apply(out, dxfLine(L, cursorY + W, 0, cursorY + W, 'CONTOUR'));
      out.push.apply(out, dxfLine(0, cursorY + W, 0, cursorY, 'CONTOUR'));
    }
    // подпись
    out.push.apply(out, dxfText(0, cursorY - 22, 14,
      `${p.num} ${p.name} ${L}x${W} ${p.thickness}mm x${p.qty}`, 'TEXT'));
    // отверстия: слой с диаметром, чтобы оператор видел инструмент
    for (const h of (p.holes || [])) {
      // Слой несёт диаметр и сторону — станку этого достаточно, чтобы
      // выбрать инструмент и понять, с какой стороны сверлить.
      // Слой несёт диаметр и операцию: сквозное, с изнанки или в торец.
      // Точка разметки (h.mark) — не сверление: свой слой MARK_<назначение>.
      const layer = h.mark ? `MARK_${String(h.kind || 'POINT').toUpperCase()}`
        : h.side === 'edge' ? `DRILL_D${h.d}_EDGE${Number.isFinite(h.tz) ? `_Z${Math.round((h.tz + p.thickness / 2) * 10) / 10}` : ''}`
        : (h.through ? `DRILL_D${h.d}_THROUGH` : `DRILL_D${h.d}_BACK`);
      out.push.apply(out, dxfCircle(h.x, cursorY + h.y, h.d / 2, layer));
    }
    // ПАЗЫ рисуем двумя линиями по краям канавки на своём слое — так их видно
    // и в CAD, и в CAM, и не спутать с контуром или присадкой.
    for (const g of (p.grooves || [])) {
      const layer = `GROOVE_W${g.w}_D${g.depth}`;
      const half = g.w / 2;
      const vertical = Math.abs(g.x1 - g.x0) > Math.abs(g.y1 - g.y0);
      const ox = vertical ? 0 : half, oy = vertical ? half : 0;
      out.push.apply(out, dxfLine(g.x0 - ox, cursorY + g.y0 - oy,
        g.x1 - ox, cursorY + g.y1 - oy, layer));
      out.push.apply(out, dxfLine(g.x0 + ox, cursorY + g.y0 + oy,
        g.x1 + ox, cursorY + g.y1 + oy, layer));
    }
    cursorY += W + GAP;
  }

  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\r\n');
}

module.exports = {
  buildDetailingWorkbook,
  buildSpecificationWorkbook,
  buildDrillCsv,
  buildDrillDxf,
  notchedContour,
};
