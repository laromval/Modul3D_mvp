// cnc.js
// ============================================================================
// Выгрузка ПРИСАДКИ для станка с ЧПУ.
//
// Координаты отверстий берутся из деталей модели (part.holes) в системе
// координат самой детали: начало — левый нижний угол ЛИЦЕВОЙ стороны,
// ось X вправо по длине, ось Y вверх по ширине. Именно так деталь кладут
// на присадочный станок, поэтому пересчёт не нужен.
//
// Два формата:
//   • DXF — контур детали и окружности отверстий, каждая деталь своим блоком;
//     открывается в любой CAD/CAM-программе;
//   • CSV — плоский список отверстий для операторов и импорта в таблицы.
//
// Классический скрипт (без import/export) — публикует себя в window.Modul3D.
// ============================================================================
(function () {

// Человеческие названия операций — чтобы оператор понимал, что сверлит.
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

function download(name, text, mime) {
  const blob = new Blob(['﻿' + text], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

function exportDrillCsv(model) {
  download('присадка.csv', buildDrillCsv(model), 'text/csv;charset=utf-8');
}
function exportDrillDxf(model) {
  download('присадка.dxf', buildDrillDxf(model), 'application/dxf');
}

window.Modul3D = window.Modul3D || {};
window.Modul3D.cnc = { buildDrillCsv, buildDrillDxf, exportDrillCsv, exportDrillDxf, drilledParts };
})();
