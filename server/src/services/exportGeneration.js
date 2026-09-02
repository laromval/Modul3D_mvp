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
    .map((r) => ({
    '№ п/п': r.num,
    'Наименование детали': r.name,
    'Изделие/секция': r.section,
    'Материал': r.material,
    'Толщина, мм': r.thickness,
    'Длина, мм': r.length,
    'Ширина, мм': r.width,
    'Количество, шт': r.qty,
    'Кромка длинная сторона 1': (r.edging && r.edging.long1) || 'без кромки',
    'Кромка длинная сторона 2': (r.edging && r.edging.long2) || 'без кромки',
    'Кромка короткая сторона 1': (r.edging && r.edging.short1) || 'без кромки',
    'Кромка короткая сторона 2': (r.edging && r.edging.short2) || 'без кромки',
    'Направление текстуры': r.grainDirection ? 'да' : 'нет',
    'Примечание': r.note || '',
  }));
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
// 1:1 копия exportSpecification() из src/export.js — те же 5 листов, те же
// названия колонок. sym — см. DEFAULT_CURRENCY_SYMBOL выше.
function sumOf(arr) { return (arr || []).reduce((s, r) => s + r.sum, 0); }

function addSheet(wb, rows, name) {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Нет позиций': '' }]);
  XLSX.utils.book_append_sheet(wb, ws, name);
}

function buildSpecificationWorkbook(spec, projectName) {
  const wb = XLSX.utils.book_new();
  const sym = spec.currencySymbol || DEFAULT_CURRENCY_SYMBOL;

  const sheetRows = (spec.sheetMaterials || []).map((m, i) => ({
    '№': i + 1, 'Позиция': m.name, 'Артикул': m.code, 'Ед. изм.': 'лист',
    'Площадь, м²': m.area_m2, 'Кол-во листов': m.sheets, [`Цена, ${sym}`]: m.price, [`Сумма, ${sym}`]: m.sum,
  }));
  addSheet(wb, sheetRows, '1. Листовые материалы');

  const edgeRows = (spec.edging || []).map((e, i) => ({
    '№': i + 1, 'Позиция': `Кромка ${e.type}`, 'Ед. изм.': 'пог.м',
    'Кол-во': e.length_m, [`Цена, ${sym}`]: e.price_per_m, [`Сумма, ${sym}`]: e.sum,
  }));
  addSheet(wb, edgeRows, '2. Кромка');

  const hwRows = (spec.hardware || []).map((h, i) => ({
    '№': i + 1, 'Позиция': h.name, 'Артикул': h.article, 'Ед. изм.': h.unit,
    'Кол-во': h.qty, [`Цена, ${sym}`]: h.price, [`Сумма, ${sym}`]: h.sum,
  }));
  addSheet(wb, hwRows, '3. Фурнитура');

  const fRows = (spec.fasteners || []).map((f, i) => ({
    '№': i + 1, 'Позиция': f.name, 'Артикул': f.article, 'Ед. изм.': f.unit,
    'Кол-во': f.qty, [`Цена, ${sym}`]: f.price, [`Сумма, ${sym}`]: f.sum,
  }));
  addSheet(wb, fRows, '4. Крепёж и метизы');

  const totalRows = [
    { 'Раздел': '1. Листовые материалы', [`Сумма, ${sym}`]: sumOf(spec.sheetMaterials) },
    { 'Раздел': '2. Кромка', [`Сумма, ${sym}`]: sumOf(spec.edging) },
    { 'Раздел': '3. Фурнитура', [`Сумма, ${sym}`]: sumOf(spec.hardware) },
    { 'Раздел': '4. Крепёж и метизы', [`Сумма, ${sym}`]: sumOf(spec.fasteners) },
    { 'Раздел': 'ИТОГО', [`Сумма, ${sym}`]: spec.totalCost },
  ];
  addSheet(wb, totalRows, '5. Итог');

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
};

// Стекло на присадочный станок не идёт: отверстия в нём делают стеклорезчики
// своим инструментом. Поэтому стеклянные детали в выгрузку не попадают.
function isGlassPart(p) {
  return !!p.glass || /^GLASS/.test(String(p.material || ''));
}

function drilledParts(model) {
  // Деталь идёт на станок, если у неё есть присадка ИЛИ паз: паз — такая же
  // операция, её тоже режут на ЧПУ.
  return (model.parts || []).filter((p) => !p.hardware && !isGlassPart(p)
    && ((p.holes && p.holes.length) || (p.grooves && p.grooves.length)));
}

// --- CSV -------------------------------------------------------------------
function buildDrillCsv(model) {
  const rows = [['Поз.', 'Модуль', 'Деталь', 'Секция', 'Материал', 'Толщина',
                 'Длина', 'Ширина', 'Кол-во', 'X', 'Y', 'Диаметр', 'Глубина',
                 'Сторона', 'Назначение']];
  for (const p of drilledParts(model)) {
    for (const h of p.holes) {
      rows.push([
        p.num, p.module || '', p.name, p.section, p.material, p.thickness,
        p.length, p.width, p.qty,
        h.x, h.y, h.d,
        h.through ? p.thickness : (h.depth || 0),
        h.side === 'edge' ? 'в торец'
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
    // контур детали
    out.push.apply(out, dxfLine(0, cursorY, L, cursorY, 'CONTOUR'));
    out.push.apply(out, dxfLine(L, cursorY, L, cursorY + W, 'CONTOUR'));
    out.push.apply(out, dxfLine(L, cursorY + W, 0, cursorY + W, 'CONTOUR'));
    out.push.apply(out, dxfLine(0, cursorY + W, 0, cursorY, 'CONTOUR'));
    // подпись
    out.push.apply(out, dxfText(0, cursorY - 22, 14,
      `${p.num} ${p.name} ${L}x${W} ${p.thickness}mm x${p.qty}`, 'TEXT'));
    // отверстия: слой с диаметром, чтобы оператор видел инструмент
    for (const h of p.holes) {
      // Слой несёт диаметр и сторону — станку этого достаточно, чтобы
      // выбрать инструмент и понять, с какой стороны сверлить.
      // Слой несёт диаметр и операцию: сквозное, с изнанки или в торец.
      const layer = h.side === 'edge' ? `DRILL_D${h.d}_EDGE`
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
};
