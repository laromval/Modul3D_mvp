// drawings.js
// ============================================================================
// Модуль чертежей.
//
// Что где показывается:
//  • ОБЩИЙ ВИД — изделие «снаружи»: только то, что реально видно с этой
//    стороны. Внутренности не рисуются, и вдобавок отсекаются детали,
//    закрытые более близкими (на виде сбоку боковина закрывает дно, крышу и
//    цоколь — иначе получился бы разрез, а не вид).
//    Размеры: габарит и ширины модулей.
//  • ЧЕРТЁЖ МОДУЛЯ — наоборот, БЕЗ фасадов, но с полным каркасом и в трёх
//    видах (спереди, сбоку, сверху): боковины, дно, крыша, стойки, полки,
//    ящики, задняя стенка, цоколь. Отсечение невидимого здесь НЕ применяется —
//    это рабочий чертёж. В таблице — все детали модуля.
//  • ФАСАДЫ — отдельным разделом, каждый со своими размерами.
//
// Принципы: единый масштаб (SVG с ЯВНЫМИ размерами, без width:100%, иначе
// браузер растянет вид и масштаб развалится), проекционная связь по ЕСКД,
// размеры с выносными линиями и стрелками, чёрно-белое.
//
// Геометрия — проекции тех же боксов деталей, что идут в 3D и деталировку.
// ============================================================================
(function () {

const FACADE_KINDS = { door: 1, drawerFront: 1 };
const IN_DRAWER = { drawerBottom: 1, drawerBack: 1, drawerSide: 1 };
// Всё, что не видно снаружи при закрытых фасадах
const INTERIOR_KINDS = { shelf: 1, divider: 1, back: 1, drawerBottom: 1, drawerBack: 1, drawerSide: 1 };

const DIM_FIRST = 13;
const DIM_STEP = 14;
const ARROW = 3;
const GAP = 62;
const TARGET = 560;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function r(v) { return Math.round(v * 100) / 100; }
function rect(x, y, w, h, cls) {
  return `<rect x="${r(x)}" y="${r(y)}" width="${r(Math.max(w, 0.1))}" height="${r(Math.max(h, 0.1))}" class="${cls}"/>`;
}
function line(x1, y1, x2, y2, cls) {
  return `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" class="${cls || 'dw-thin'}"/>`;
}
function text(x, y, s, cls, anchor) {
  return `<text x="${r(x)}" y="${r(y)}" class="${cls || 'dw-t'}" text-anchor="${anchor || 'middle'}">${esc(s)}</text>`;
}
function arrowH(x, y, dir) {
  return `<polygon class="dw-arrow" points="${r(x)},${r(y)} ${r(x - dir * ARROW)},${r(y - 1.2)} ${r(x - dir * ARROW)},${r(y + 1.2)}"/>`;
}
function arrowV(x, y, dir) {
  return `<polygon class="dw-arrow" points="${r(x)},${r(y)} ${r(x - 1.2)},${r(y - dir * ARROW)} ${r(x + 1.2)},${r(y - dir * ARROW)}"/>`;
}

function dimH(x1, x2, yBase, level, label, dir) {
  const d = dir || 1;
  const y = yBase + d * (DIM_FIRST + level * DIM_STEP);
  let s = line(x1, yBase + d * 1.5, x1, y + d * 2, 'dw-ext')
        + line(x2, yBase + d * 1.5, x2, y + d * 2, 'dw-ext')
        + line(x1, y, x2, y, 'dw-dim');
  s += (Math.abs(x2 - x1) > 2 * ARROW + 2)
    ? arrowH(x1, y, -1) + arrowH(x2, y, 1)
    : arrowH(x1, y, 1) + arrowH(x2, y, -1);
  if (label !== '') s += text((x1 + x2) / 2, y - 2.5, label, 'dw-dt', 'middle');
  return s;
}

function dimV(y1, y2, xBase, level, label, dir) {
  const d = dir || 1;
  const x = xBase + d * (DIM_FIRST + level * DIM_STEP);
  let s = line(xBase + d * 1.5, y1, x + d * 2, y1, 'dw-ext')
        + line(xBase + d * 1.5, y2, x + d * 2, y2, 'dw-ext')
        + line(x, y1, x, y2, 'dw-dim');
  s += (Math.abs(y2 - y1) > 2 * ARROW + 2)
    ? arrowV(x, y1, -1) + arrowV(x, y2, 1)
    : arrowV(x, y1, 1) + arrowV(x, y2, -1);
  const my = (y1 + y2) / 2;
  if (label !== '') s += `<text x="${r(x - 2.5)}" y="${r(my)}" class="dw-dt" text-anchor="middle" transform="rotate(-90 ${r(x - 2.5)} ${r(my)})">${esc(label)}</text>`;
  return s;
}

function callout(x, y, label) {
  return `<circle cx="${r(x)}" cy="${r(y)}" r="5" class="dw-pos"/>`
       + text(x, y + 2, label, 'dw-post', 'middle');
}

// Рамка листа никогда не режет чертёж: перед выводом сканируем построенную
// графику и, если что-то вышло за расчётное поле (размерная линия, выноска,
// сквозной цоколь), раздвигаем viewBox под фактическое содержимое.
function svgFit(w, h, body) {
  let x0 = 0, y0 = 0, x1 = w, y1 = h, m;
  const re = /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g;
  while ((m = re.exec(body))) {
    x0 = Math.min(x0, +m[1]); y0 = Math.min(y0, +m[2]);
    x1 = Math.max(x1, +m[1] + +m[3]); y1 = Math.max(y1, +m[2] + +m[4]);
  }
  const rc = /<(?:circle|ellipse) cx="(-?[\d.]+)" cy="(-?[\d.]+)" r(?:x)?="([\d.]+)"/g;
  while ((m = rc.exec(body))) {
    x0 = Math.min(x0, +m[1] - +m[3]); y0 = Math.min(y0, +m[2] - +m[3]);
    x1 = Math.max(x1, +m[1] + +m[3]); y1 = Math.max(y1, +m[2] + +m[3]);
  }
  const rl = /<line x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)"/g;
  while ((m = rl.exec(body))) {
    x0 = Math.min(x0, +m[1], +m[3]); y0 = Math.min(y0, +m[2], +m[4]);
    x1 = Math.max(x1, +m[1], +m[3]); y1 = Math.max(y1, +m[2], +m[4]);
  }
  // тексты таблиц (dw-lt/dw-lth) не считаем: они лежат внутри своих прямоугольников
  const rt = /<text x="(-?[\d.]+)" y="(-?[\d.]+)"(?! class="dw-lth?")/g;
  while ((m = rt.exec(body))) {
    x0 = Math.min(x0, +m[1] - 28); y0 = Math.min(y0, +m[2] - 10);
    x1 = Math.max(x1, +m[1] + 28); y1 = Math.max(y1, +m[2] + 4);
  }
  const PAD = 4;
  return { x: x0 - PAD, y: y0 - PAD, w: (x1 - x0) + 2 * PAD, h: (y1 - y0) + 2 * PAD };
}

function svgTag(w, h, body, extraClass) {
  const v = svgFit(w, h, body);
  return `<svg width="${r(v.w)}" height="${r(v.h)}" viewBox="${r(v.x)} ${r(v.y)} ${r(v.w)} ${r(v.h)}" class="dw-svg ${extraClass || ''}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}
// РУЧНАЯ РАЗМЕТКА (src/markup.js) на листе чертежа. У каждого листа — свои
// размеры (решение пользователя: размер, поставленный на чертеже модуля, не
// появляется на общем виде и наоборот), поэтому лист получает стабильный id
// (НЕ индекс/имя модуля — они меняются при вставке/удалении/перенумерации):
//   'overview'                  — общий вид;
//   'module:<uid модуля>'       — чертёж модуля (каркас);
//   'part:<uid модуля>|<ключ>'  — чертёж детали (фасады, детали с присадкой);
//                                 ключ — part.anchorKey детали-представителя
//                                 группы одинаковых деталей.
// views — контексты видов этого листа: те же sx/sy/hAxis/vAxis и тот же
// список деталей (rows), что реально рисует drawParts()/buildPartDrawings,
// — hit-testing видит РОВНО нарисованное. Рамка листа передаётся ДО ручных
// размеров (предел выноса; с ними рамка росла бы от каждого перетаскивания).
function mkAttach(sheetId, model, views, w, h, body) {
  const mk = window.Modul3D && window.Modul3D.markup;
  if (!mk || !mk.attachSheet || !sheetId) return '';
  return mk.attachSheet(sheetId, model, views, svgFit(w, h, body));
}
function mkAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// Контекст вида для листа ОДНОЙ детали (чертёж фасада/детали с присадкой,
// редактор детали): деталь нарисована в СВОИХ координатах (длина × ширина,
// снизу вверх, как в facadeHoles), а не мировым боксом. Поэтому для
// markup.js — одна «строка» с боксом в этих локальных координатах и своя
// проекция центров отверстий (holeScreen) — ровно по px/py facadeHoles.
// members — ключи 'uid|anchorKey' ВСЕХ деталей группы одинаковых деталей,
// нарисованных этим листом (buildPartDrawings); markup.js по ним находит
// лист для размера, какая бы деталь группы ни была представителем.
function partLocalViews(p, x0, y0, fw, fh, scale, members) {
  const pxL = (v) => x0 + v * scale;
  const pyL = (v) => y0 + fh - v * scale;
  const localRow = Object.assign({}, p, {
    boxes: [{ x: p.length / 2, y: p.width / 2, z: 0, w: p.length, h: p.width, d: p.thickness || 1 }],
  });
  return [{
    name: 'front', noHoles: false, hAxis: 'x', vAxis: 'y', sx: pxL, sy: pyL, rows: [localRow],
    region: { x0, y0, x1: x0 + fw, y1: y0 + fh },
    members: members || null,
    holeScreen: (row, i) => {
      const h0 = row.holes && row.holes[i];
      if (!h0 || h0.side === 'edge') return null;   // в торец — на пласти не нарисовано
      return { x: pxL(h0.x), y: pyL(h0.y), wh: h0.x, wv: h0.y };
    },
  }];
}

// SVG листа с разметкой: класс mk-root + data-mk-sheet — по ним markup.js
// находит лист под курсором. Атрибут ставится ПОСЛЕ viewBox — unifyBlocks()
// ниже ищет «<svg width height viewBox» строго в этом порядке.
function svgTagMk(w, h, body, sheetId) {
  const svg = svgTag(w, h, body, sheetId ? 'mk-root' : '');
  return sheetId ? svg.replace(' xmlns=', ` data-mk-sheet="${mkAttr(sheetId)}" xmlns=`) : svg;
}

function svgBlock(w, h, body, title) {
  return `<div class="dw-block"><div class="dw-title">${esc(title)}</div>${svgTag(w, h, body)}</div>`;
}

function partClass(row, wire) {
  // wire = чертёж каркаса: рисуем ТОЛЬКО контуры. С белой заливкой крупные
  // панели (задняя стенка, крыша) перекрывали боковины и дно, и каркас
  // визуально пропадал.
  if (wire) return row.kind === 'back' ? 'dw-wire-back' : 'dw-wire';
  if (FACADE_KINDS[row.kind]) return 'dw-facade';
  if (row.kind === 'back') return 'dw-back';
  if (IN_DRAWER[row.kind]) return 'dw-drawer';
  return 'dw-part';
}

/**
 * Отсекает НЕВИДИМЫЕ снаружи детали для наружных видов.
 *
 * На виде сбоку боковина закрывает собой дно, крышу, полки и цоколь — рисовать
 * их линиями нельзя, это уже разрез, а не вид. Правило простое и точное для
 * прямоугольной геометрии: деталь скрыта, если её проекция целиком попадает
 * внутрь проекции другой детали, которая ближе к наблюдателю.
 *
 * @param view 'front' | 'side' | 'top'
 */
// Точка пробы внутри отрезка с отступом от краёв
function lerpInset(a, b, i, n, inset) {
  const lo = a + Math.min(inset, (b - a) / 3);
  const hi = b - Math.min(inset, (b - a) / 3);
  return n === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (n - 1);
}

function visibleParts(parts, view) {
  const cfg = {
    front: { h: 'x', v: 'y', depth: (b) => -b.z },   // смотрим спереди: ближе — больше z
    side:  { h: 'z', v: 'y', depth: (b) => b.x },    // смотрим слева: ближе — меньше x
    top:   { h: 'x', v: 'z', depth: (b) => -b.y },   // смотрим сверху: ближе — больше y
  }[view];
  if (!cfg) return parts;

  const items = [];
  for (const row of parts) {
    for (const b of row.boxes) {
      const hs = cfg.h === 'x' ? b.w : b.d;
      const vs = cfg.v === 'y' ? b.h : b.d;
      items.push({
        row, b, depth: cfg.depth(b),
        x0: b[cfg.h] - hs / 2, x1: b[cfg.h] + hs / 2,
        y0: b[cfg.v] - vs / 2, y1: b[cfg.v] + vs / 2,
      });
    }
  }
  items.sort((a, z) => a.depth - z.depth);          // от ближних к дальним

  // Деталь считается скрытой, если ВСЯ её площадь перекрыта совокупностью
  // более близких деталей. Проверяем по сетке точек: одной деталью проверять
  // нельзя — дно, например, перекрывается крышей И боковиной вместе.
  const INSET = 2;   // отступ проб от края: полоски уже зазора фасада не в счёт
  const N = 7;       // сетка проб
  const kept = [];
  const shown = [];
  for (const it of items) {
    let covered = true;
    for (let i = 0; i < N && covered; i++) {
      for (let j = 0; j < N && covered; j++) {
        const px = lerpInset(it.x0, it.x1, i, N, INSET);
        const py = lerpInset(it.y0, it.y1, j, N, INSET);
        if (!shown.some(s => px >= s.x0 - s.pad && px <= s.x1 + s.pad
          && py >= s.y0 - s.pad && py <= s.y1 + s.pad)) {
          covered = false;
        }
      }
    }
    if (covered && shown.length) continue;
    // Фурнитура на чертеже не рисуется (см. drawParts) — значит, и заслонять
    // ничего не должна, иначе под ручкой осталась бы «дыра».
    if (it.row.hardware) { kept.push(it); continue; }
    // Фасад заслоняет с запасом INSET на сторону: щель между соседними
    // фасадами — технологический зазор (в engine.js gap = 1,5 мм на сторону,
    // между двумя фасадами 3 мм). Сквозь такую щель дно, крыша и полки
    // «видны» лишь полоской в 3 мм — на виде это не деталь, а шум. Раньше
    // проба посередине дна попадала ровно в щель между створками, и дно с
    // крышей рисовались целиком поверх дверей.
    it.pad = FACADE_KINDS[it.row.kind] ? INSET : 0;
    shown.push(it);
    kept.push(it);
  }
  // ПОРЯДОК РИСОВАНИЯ — ОТ ДАЛЬНИХ К БЛИЖНИМ. Детали рисуются с белой
  // заливкой, поэтому ближняя деталь, нарисованная позже, закрывает ту часть
  // дальней, которая за ней. Раньше порядок был обратный (ближние первыми):
  // боковина, у которой видна только полоска под дверью (на опорах/цоколе),
  // рисовалась целиком ПОВЕРХ двери — торцы боковин просвечивали сквозь фасад.
  // Разворачиваем порядок СТРОК, а не боксов: внутри детали боксы остаются
  // от ближних к дальним, как раньше (boxes[0] — по нему ручная разметка
  // markup.js строит углы и грани детали).
  // возвращаем в формате «строка + только видимые боксы»
  const byRow = new Map();
  for (const it of kept) {
    if (!byRow.has(it.row)) byRow.set(it.row, Object.assign({}, it.row, { boxes: [] }));
    byRow.get(it.row).boxes.push(it.b);
  }
  return Array.from(byRow.values()).reverse();
}

// Размер бокса детали вдоль мировой оси: 'x' → ширина, 'y' → высота,
// 'z' → глубина.
function axisSize(b, ax) {
  return ax === 'x' ? b.w : ax === 'y' ? b.h : b.d;
}

// Рисует детали в проекции; labels — куда собрать позиции для выносок
// Стоячая панель (боковина, стойка): локальный x отверстия идёт ВВЕРХ по
// высоте детали, y — по глубине, поэтому оси при проекции меняются местами.
// Исключение — боковина ЯЩИКА: она тоже «панель», но её длина лежит вдоль
// глубины (по горизонтали), x — вдоль неё, y — вверх; без этой проверки
// присадка ящиков улетала над корпусом («отверстия в воздухе»). Длину детали
// сравниваем с её размерами на виде: к которому ближе — вдоль того она и идёт.
function panelLenVertical(row, hSize, vSize) {
  const L = Number(row.length);
  if (!(L > 0)) return true;
  return Math.abs(L - vSize) <= Math.abs(L - hSize);
}

function drawParts(parts, sx, sy, hAxis, vAxis, labels, wire, noHoles) {
  let body = '';
  for (const row of parts) {
    // ПРАВИЛО: на чертежах фурнитуры не видно. Показываем только детали и
    // присадку под крепление фурнитуры — сами ручки, опоры, штанги, фланцы
    // и полкодержатели не изображаются (они есть в спецификации и в 3D).
    if (row.hardware) continue;
    for (const b of row.boxes) {
      // Размер бокса вдоль оси вида: 'x' → ширина, 'y' → высота, 'z' → глубина.
      // Любая ось вида может быть любой мировой: у модуля, повёрнутого на
      // 90/270°, вид сверху идёт по осям z (гориз.) и x (верт.).
      // ТА ЖЕ формула стоит в markup.js → rowFrame() (привязка разметки должна
      // совпадать с нарисованным) — менять только вместе.
      const hs = axisSize(b, hAxis);
      const vs = axisSize(b, vAxis);
      const x0 = sx(b[hAxis] - hs / 2), x1 = sx(b[hAxis] + hs / 2);
      const yA = sy(b[vAxis] - vs / 2), yB = sy(b[vAxis] + vs / 2);
      const y0 = Math.min(yA, yB), y1 = Math.max(yA, yB);
      // Круглые детали (опоры) на виде СВЕРХУ показываем окружностью, а не
      // квадратом — иначе чертёж вводит в заблуждение при разметке присадки.
      // Круглое сечение видно, когда смотрим ВДОЛЬ оси цилиндра, т.е. ни одна
      // из осей вида не совпадает с его осью: опора (ось Y) — на виде сверху,
      // штанга (ось X) — на виде сбоку. Так верно и для вида сверху
      // повёрнутого модуля, где оси вида — z и x.
      const isRound = (row.shape === 'cylinder' && hAxis !== 'y' && vAxis !== 'y')
        || (row.shape === 'cylinderX' && hAxis !== 'x' && vAxis !== 'x');
      body += isRound
        ? `<ellipse cx="${r((x0 + x1) / 2)}" cy="${r((y0 + y1) / 2)}" rx="${r((x1 - x0) / 2)}" `
          + `ry="${r((y1 - y0) / 2)}" class="${partClass(row, wire)}"/>`
        : rect(x0, y0, x1 - x0, y1 - y0, partClass(row, wire));

      // Присадка. Деталь показываем с присадкой только на том виде, где она
      // видна ПЛАШМЯ. У повёрнутого модуля плоскость детали разворачивается
      // вместе с ним, поэтому плоскость считаем с учётом row.rot — иначе
      // отверстия «улетают» мимо детали и на чертеже появляется мусор.
      // Плоскость детали — по её ТОНКОЙ оси, а не по названию типа: доборные
      // планки и заглушки стоят в разных плоскостях и по kind не различаются.
      const thinAx = Math.min(b.w, b.h, b.d);
      const panel = (row.kind === 'side' || row.kind === 'divider') || b.w === thinAx;
      const flat = !panel && (row.kind === 'bottom' || row.kind === 'top'
        || row.kind === 'shelf' || b.h === thinAx);
      const turned = row.rot === 90 || row.rot === 270;
      // мировая ось, вдоль которой лежит ДЛИНА детали в её плоскости
      const hw = turned ? 'z' : 'x';        // «горизонталь» детали в мире
      const dw = turned ? 'x' : 'z';        // «глубина» детали в мире
      const sizeOf = (ax) => (ax === 'x' ? b.w : ax === 'z' ? b.d : b.h);
      // Дно/полка всегда видны плашмя СВЕРХУ — вид один и тот же, меняется
      // лишь то, вдоль какой мировой оси лежит длина детали.
      const face = flat ? { h: 'x', v: 'z', plane: 'top' }
        : panel ? { h: dw, v: 'y', plane: 'side' }
        : { h: hw, v: 'y', plane: 'front' };
      const drawable = !noHoles && row.holes && row.holes.length
        && hAxis === face.h && vAxis === face.v;
      if (drawable) {
        // локальные оси детали: у боковины X — по высоте, Y — по глубине;
        // у дна/полки X — по длине, Y — по глубине; у фасада X и Y как есть
        const px = (v) => sx(b[face.h] - sizeOf(face.h) / 2 + v);
        const py = (v) => sy(b[face.v] - sizeOf(face.v) / 2 + v);
        for (const h0 of row.holes) {
          // Присадка в торец на пласти не изображается — её место
          // в документации для ЧПУ (там указана сторона «в торец»).
          if (h0.side === 'edge') continue;
          const h = ((panel && panelLenVertical(row, sizeOf(face.h), sizeOf(face.v))) || (flat && turned))
            ? { x: h0.y, y: h0.x, d: h0.d } : h0;
          const cx = px(h.x), cy = py(h.y);
          const rr = Math.max(Math.abs(sx(h.d) - sx(0)) / 2, 1.1);
          body += `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(rr)}" class="dw-hole"/>`;
          body += line(cx - rr * 2, cy, cx + rr * 2, cy, 'dw-axis');
          body += line(cx, cy - rr * 2, cx, cy + rr * 2, 'dw-axis');
        }
      }
      // Выноску ставим только детали из листа: у фурнитуры (ножки) номера
      // позиции нет — она идёт в спецификацию, а не в деталировку.
      if (labels && row.num != null && (x1 - x0) > 12 && (y1 - y0) > 12) {
        labels.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, n: row.num });
      }
    }
  }
  return body;
}

// Проекция ОДНОГО отверстия присадки (part.holes[i]) на экран для заданного
// вида (hAxis/vAxis) — та же логика определения плоскости детали (панель/
// плашмя/повёрнутый модуль), что и выше в drawParts(), вынесена отдельно и
// экспортирована ниже: ручной разметке (markup.js) нужно привязываться к
// центру отверстия, не копируя эту логику вслепую. Если на ЭТОМ виде
// отверстие не видно плашмя (деталь стоит на ребре) — вернёт null.
// Возвращает и экранные (x,y), и мировые (wh,wv, вдоль hAxis/vAxis, в мм) —
// вторые нужны markup.js, чтобы считать реальную длину размера в мм.
function resolveHoleScreen(row, hAxis, vAxis, sx, sy, holeIndex) {
  const b = row.boxes && row.boxes[0];
  const h0 = row.holes && row.holes[holeIndex];
  if (!b || !h0 || h0.side === 'edge') return null;
  const thinAx = Math.min(b.w, b.h, b.d);
  const panel = (row.kind === 'side' || row.kind === 'divider') || b.w === thinAx;
  const flat = !panel && (row.kind === 'bottom' || row.kind === 'top'
    || row.kind === 'shelf' || b.h === thinAx);
  const turned = row.rot === 90 || row.rot === 270;
  const hw = turned ? 'z' : 'x';
  const dw = turned ? 'x' : 'z';
  const sizeOf = (ax) => (ax === 'x' ? b.w : ax === 'z' ? b.d : b.h);
  const face = flat ? { h: 'x', v: 'z' } : panel ? { h: dw, v: 'y' } : { h: hw, v: 'y' };
  if (hAxis !== face.h || vAxis !== face.v) return null;
  const h = ((panel && panelLenVertical(row, sizeOf(face.h), sizeOf(face.v))) || (flat && turned))
    ? { x: h0.y, y: h0.x } : { x: h0.x, y: h0.y };
  const wh = b[face.h] - sizeOf(face.h) / 2 + h.x;
  const wv = b[face.v] - sizeOf(face.v) / 2 + h.y;
  return { x: sx(wh), y: sy(wv), wh, wv };
}

// ---------------------------------------------------------------------------
// Размеры вида спереди (используются и в чертеже, и в 3D-оверлее)
// ---------------------------------------------------------------------------
// На общем виде проставляются ТОЛЬКО габаритные размеры по корпусу:
// ширины модулей и общий габарит. Размеры фасадов на общий вид не выносятся —
// они есть в разделе «Фасады» и в спецификации, иначе чертёж перегружается.
// На ОБЩЕМ ВИДЕ ставим только габариты изделия — цепочки ярусов и модулей
// идут на чертежах модулей, где они и нужны сборщику.
// Размеры на виде СБОКУ. Ставятся так же, как спереди: сначала цепочка
// модулей по глубине, за ней — общий габарит. Повторы (модули одного ряда
// проецируются друг на друга) отбрасываются.
function sideDims(model, S, bottomY, zMin, zMax) {
  const mods = model.modules;
  let s = '', lv = 0;
  if (mods.length > 1) {
    const seen = {}, chain = [];
    for (const m of mods) {
      const a = S.x(m.offsetZ - m.dims.D / 2);
      const b = S.x(m.offsetZ + m.dims.D / 2);
      const label = String(Math.round(m.dims.D));
      const key = `${Math.round(a)}/${Math.round(b)}/${label}`;
      if (seen[key]) continue;
      seen[key] = 1;
      chain.push({ a, b, label });
    }
    for (const it of packDims(chain, 0)) {
      s += dimH(it.a, it.b, bottomY, it.level, it.label);
      lv = Math.max(lv, it.level + 1);
    }
  }
  s += dimH(S.x(zMin), S.x(zMax), bottomY, lv, String(Math.round(zMax - zMin)));
  return s;
}

function overallDims(model, F, bottomY, leftX) {
  const d = model.dims, mods = model.modules;
  let s = '';
  // Ширина каждого модуля — цепочкой в одну линию, общий габарит за ней.
  // Модули повёрнутого прогона на вид спереди проецируются один на другой:
  // их ширины совпадают и наслаиваются столбиком одинаковых чисел, из-за
  // чего теряется главный — габаритный — размер. Такие повторы отбрасываем:
  // размер этих модулей читается на виде сбоку и на их чертежах.
  let lv = 0;
  if (mods.length > 1) {
    const seenSpan = {};
    const chain = [];
    for (const m of mods) {
      // Глубина модулей повёрнутого прогона на виде спереди не читается —
      // её место на виде СВЕРХУ, там она и проставляется.
      if (m.rotation === 90 || m.rotation === 270) continue;
      const a = F.x(m.offsetX - m.dims.W / 2);
      const b = F.x(m.offsetX + m.dims.W / 2);
      const label = String(Math.round(m.dims.W));
      const key = `${Math.round(a)}/${Math.round(b)}/${label}`;
      if (seenSpan[key]) continue;              // тот же размер на том же месте
      seenSpan[key] = 1;
      chain.push({ a, b, label });
    }
    for (const it of packDims(chain, 0)) {
      s += dimH(it.a, it.b, bottomY, it.level, it.label);
      lv = Math.max(lv, it.level + 1);
    }
  }
  s += dimH(F.x(-d.W / 2), F.x(d.W / 2), bottomY, lv, String(Math.round(d.W)));
  // Навесные модули (m.offsetY > 0 — низ от пола): цепочка отметок по высоте
  // — верх нижнего ряда, низ и верх верхних, — общий габарит за ней.
  let lvH = 0;
  if (mods.some((m) => Number(m.offsetY) > 0)) {
    const marks = [0, d.H];
    const floorTop = Math.max.apply(null, [0].concat(mods
      .filter((m) => !(Number(m.offsetY) > 0)).map((m) => Number(m.dims.H) || 0)));
    if (floorTop > 0) marks.push(floorTop);
    for (const m of mods) {
      const oy = Number(m.offsetY) || 0;
      if (oy > 0) marks.push(oy, oy + (Number(m.dims.H) || 0));
    }
    const uniq = marks.map((v) => Math.round(v)).filter((v, i, a) => a.indexOf(v) === i)
      .sort((x, y) => x - y);
    const chain = [];
    for (let i = 0; i < uniq.length - 1; i++) {
      const h = uniq[i + 1] - uniq[i];
      if (h < 10) continue;
      chain.push({ a: F.y(uniq[i + 1]), b: F.y(uniq[i]), label: String(h) });
    }
    if (chain.length > 1) {
      for (const it of packDims(chain, 0)) {
        s += dimV(it.a, it.b, leftX, it.level, it.label, -1);
        lvH = Math.max(lvH, it.level + 1);
      }
    }
  }
  s += dimV(F.y(0), F.y(d.H), leftX, lvH, String(Math.round(d.H)), -1);
  return s;
}

// Размеры на виде спереди строятся ЦЕПОЧКОЙ, как на чертеже фасада:
// сначала последовательные звенья (модуль за модулем, ярус за ярусом)
// в одну линию, и только за ними — общий габарит.
function frontDims(model, F, bottomY, leftX) {
  const d = model.dims, mods = model.modules;
  let s = '';

  // По ширине: цепочка модулей
  const wide = [];
  if (mods.length > 1) {
    for (const m of mods) {
      wide.push({ a: F.x(m.offsetX - m.dims.W / 2), b: F.x(m.offsetX + m.dims.W / 2),
                  label: String(Math.round(m.dims.W)) });
    }
  }
  let lvW = 0;
  for (const it of packDims(wide, 0)) { s += dimH(it.a, it.b, bottomY, it.level, it.label); lvW = Math.max(lvW, it.level + 1); }
  s += dimH(F.x(-d.W / 2), F.x(d.W / 2), bottomY, lvW, String(Math.round(d.W)));

  // По высоте: цепочка ярусов — цоколь, полки, ящики, верх
  const marks = [0];
  const m0 = mods[0].dims;
  const oy0 = Number(mods[0].offsetY) || 0;
  if (m0.baseH > 0) marks.push(oy0 + m0.baseH);
  for (const p of model.partsRaw) {
    if (p.module !== mods[0].name) continue;
    const b = p.boxes[0];
    if (p.kind === 'shelf') marks.push(b.y - b.h / 2);
    if (p.kind === 'drawerFront') marks.push(b.y + b.h / 2);
  }
  // Навесные модули: отметки их низа и верха от пола (у первого модуля —
  // и верх напольного, иначе цепочка перескочила бы от него сразу к 2400).
  if (mods.some((m) => Number(m.offsetY) > 0)) {
    marks.push(oy0 + (Number(m0.H) || 0));
    for (const m of mods) {
      const oy = Number(m.offsetY) || 0;
      if (oy > 0) marks.push(oy, oy + (Number(m.dims.H) || 0));
    }
  }
  marks.push(d.H);
  const uniq = marks.map((v) => Math.round(v)).filter((v, i, a) => a.indexOf(v) === i)
    .sort((x, y) => x - y);
  const tall = [];
  for (let i = 0; i < uniq.length - 1; i++) {
    const h = uniq[i + 1] - uniq[i];
    if (h < 10) continue;
    tall.push({ a: F.y(uniq[i + 1]), b: F.y(uniq[i]), label: String(h) });
  }
  let lvH = 0;
  for (const it of packDims(tall, 0)) { s += dimV(it.a, it.b, leftX, it.level, it.label, -1); lvH = Math.max(lvH, it.level + 1); }
  s += dimV(F.y(0), F.y(d.H), leftX, lvH, String(Math.round(d.H)), -1);
  return s;
}

// ---------------------------------------------------------------------------
// Общий вид: корпус + ФАСАДЫ, без внутренностей. Три проекции в связи.
// ---------------------------------------------------------------------------
// Фактический габарит содержимого чертежа (с учётом сквозного цоколя и
// повёрнутых прогонов) — по нему считаются и масштаб, и рамка.
// Человеческое название материала по коду: корпусные декоры, задние стенки,
// фасадные материалы и стекло лежат в разных справочниках каталога.
function materialTitle(code) {
  const cat = (typeof window !== 'undefined' && window.Modul3D && window.Modul3D.catalog) || {};
  const fac = cat.FACADE_MATERIALS || {};
  const all = [].concat(cat.DECORS || [], cat.BACK_MATERIALS || [],
    Object.keys(fac).map((k) => fac[k]), cat.GLASS ? [cat.GLASS] : []);
  const it = all.filter((x) => x && x.code === code)[0];
  return it ? it.name : (code || '');
}

function contentExtent(model) {
  const outer = model.partsRaw.filter(p => !INTERIOR_KINDS[p.kind] && !p.hardware);
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity,
      zMin = Infinity, zMax = -Infinity;
  for (const row of outer) for (const b of row.boxes) {
    xMin = Math.min(xMin, b.x - b.w / 2); xMax = Math.max(xMax, b.x + b.w / 2);
    yMin = Math.min(yMin, b.y - b.h / 2); yMax = Math.max(yMax, b.y + b.h / 2);
    zMin = Math.min(zMin, b.z - b.d / 2); zMax = Math.max(zMax, b.z + b.d / 2);
  }
  const d = model.dims;
  if (!isFinite(xMin)) return { xMin: -d.W / 2, xMax: d.W / 2, yMin: 0, yMax: d.H, zMin: -d.D / 2, zMax: d.D / 2 };
  return { xMin, xMax, yMin, yMax, zMin, zMax };
}

// Все чертежи одного раздела приводим к ОДНОМУ формату листа: рамки должны
// стоять ровным рядом, а не «лесенкой» по высоте содержимого. Содержимое при
// этом центрируется внутри общего поля.
function unifyBlocks(html) {
  const re = /<svg width="([\d.]+)" height="([\d.]+)" viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/g;
  let m, maxW = 0, maxH = 0;
  while ((m = re.exec(html))) { maxW = Math.max(maxW, +m[5]); maxH = Math.max(maxH, +m[6]); }
  if (!maxW) return html;
  return html.replace(re, (all, w, h, vx, vy, vw, vh) => {
    const nx = +vx - (maxW - +vw) / 2;
    const ny = +vy - (maxH - +vh) / 2;
    return `<svg width="${r(maxW)}" height="${r(maxH)}" viewBox="${r(nx)} ${r(ny)} ${r(maxW)} ${r(maxH)}"`;
  });
}

function buildOverview(model, scale, headText) {
  const d = model.dims;
  // Снаружи видно корпус и фасады. Полки и стойки тоже берём: закрыты ли они
  // фасадом, решает visibleParts() по геометрии — у открытого модуля (без
  // двери) полки видны спереди и должны быть на общем виде, а за дверью
  // отсекаются сами. Заднюю стенку и детали ящиков на общем виде не
  // показываем, как и раньше (контур задней стенки спереди всё равно за
  // корпусом, ящики закрыты своими фасадами).
  const OVERVIEW_OPEN = { shelf: 1, divider: 1 };
  const outer = model.partsRaw.filter(p => !INTERIOR_KINDS[p.kind] || OVERVIEW_OPEN[p.kind]);
  const mods = model.modules;

  // РАМКА СЧИТАЕТСЯ ПО ФАКТИЧЕСКОМУ СОДЕРЖИМОМУ, а не по габариту изделия.
  // Сквозной цоколь выступает за корпус, повёрнутый прогон уходит в глубину —
  // если брать W/H/D, чертёж вылезает за рамку листа.
  const { xMin, xMax, yMin, yMax, zMin, zMax } = contentExtent(model);
  const exW = xMax - xMin, exH = yMax - yMin, exD = zMax - zMin;

  const fw = exW * scale, fh = exH * scale, dd = exD * scale;
  const PAD_L = DIM_FIRST + 5 * DIM_STEP + 16;
  const PAD_T = 24, PAD_R = 16, PAD_B = DIM_FIRST + 3 * DIM_STEP + 12;
  const totalW = PAD_L + fw + GAP + dd + PAD_R;
  const totalH = PAD_T + fh + GAP + dd + PAD_B;

  const fx0 = PAD_L, fy0 = PAD_T;
  const sx0 = PAD_L + fw + GAP;
  const ty0 = PAD_T + fh + GAP;

  const F = { x: (v) => fx0 + (v - xMin) * scale, y: (v) => fy0 + (yMax - v) * scale };
  const S = { x: (v) => sx0 + (v - zMin) * scale, y: (v) => fy0 + (yMax - v) * scale };
  const T = { x: (v) => fx0 + (v - xMin) * scale };
  const topSy = (v) => ty0 + (v - zMin) * scale;

  let body = '';
  // Контексты видов для РУЧНОЙ РАЗМЕТКИ (markup.js): те же sx/sy/hAxis/vAxis
  // и тот же список видимых деталей, что использует drawParts() ниже — так
  // hit-testing курсора видит РОВНО то, что нарисовано, не больше и не меньше.
  const mkViews = [];
  // Глубина детали для разметки (view.depthOf в markup.js): меньше = ближе к
  // зрителю. Нужна потому, что visibleParts() отдаёт детали от дальних к
  // ближним (для правильной заливки), а ядро разметки при совпадающих углах
  // без подсказки выбрало бы первую — т.е. ДАЛЬНЮЮ деталь (боковину под
  // столешницей вместо самой столешницы). Берём БЛИЖНЮЮ к зрителю грань
  // бокса (как near в viewer.js MK_VIEWS). Бокс — первый (boxes[0]): именно
  // по нему markup.js (rowFrame) строит углы и грани детали.
  const mkDepth = (near) => (row) => {
    const b = row.boxes && row.boxes[0];
    const z = b ? near(b) : 0;
    return Number.isFinite(z) ? z : 0;
  };
  const depthFront = mkDepth((b) => -(b.z + b.d / 2));   // смотрим спереди (с +Z)
  const depthSide  = mkDepth((b) => b.x - b.w / 2);      // смотрим слева (с −X)
  const depthTop   = mkDepth((b) => -(b.y + b.h / 2));   // смотрим сверху (с +Y)

  // ПРАВИЛО: общий вид — только габариты. Присадку на нём не показываем,
  // она есть на чертежах каркаса, фасадов и в файлах для ЧПУ.
  const frontVisible = visibleParts(outer, 'front');
  body += drawParts(frontVisible, F.x, F.y, 'x', 'y', null, false, true);
  body += text(fx0 + fw / 2, fy0 - 10, 'ВИД СПЕРЕДИ', 'dw-vname', 'middle');
  for (const m of mods) body += moduleLabel(m, F);
  body += overallDims(model, F, fy0 + fh, fx0);
  mkViews.push({ name: 'front', noHoles: true, hAxis: 'x', vAxis: 'y', sx: F.x, sy: F.y, rows: frontVisible, depthOf: depthFront,
    region: { x0: fx0, y0: fy0, x1: fx0 + fw, y1: fy0 + fh } });

  const sideVisible = visibleParts(outer, 'side');
  body += drawParts(sideVisible, S.x, S.y, 'z', 'y', null, false, true);
  body += text(sx0 + dd / 2, fy0 - 10, 'ВИД СБОКУ', 'dw-vname', 'middle');
  body += sideDims(model, S, fy0 + fh, zMin, zMax);
  mkViews.push({ name: 'side', noHoles: true, hAxis: 'z', vAxis: 'y', sx: S.x, sy: S.y, rows: sideVisible, depthOf: depthSide,
    region: { x0: sx0, y0: fy0, x1: sx0 + dd, y1: fy0 + fh } });

  const topVisible = visibleParts(outer, 'top');
  body += drawParts(topVisible, T.x, topSy, 'x', 'z', null, false, true);
  body += text(fx0 + fw / 2, ty0 - 8, 'ВИД СВЕРХУ', 'dw-vname', 'middle');
  mkViews.push({ name: 'top', noHoles: true, hAxis: 'x', vAxis: 'z', sx: T.x, sy: topSy, rows: topVisible, depthOf: depthTop,
    region: { x0: fx0, y0: ty0, x1: fx0 + fw, y1: ty0 + dd } });
  // На виде сверху общий габарит по глубине не дублируем — он уже стоит на
  // виде сбоку. Здесь нужна только глубина корпусов.
  const front = mods.filter((m) => !(m.rotation === 90 || m.rotation === 270))[0] || mods[0];
  let topLv = 0;
  if (front) {
    body += dimV(topSy(front.offsetZ - front.dims.D / 2), topSy(front.offsetZ + front.dims.D / 2),
      fx0, 0, String(Math.round(front.dims.D)), -1);
    topLv = 1;
  }
  // Модули повёрнутого прогона: их габарит виден именно сверху — цепочкой
  // вдоль Z, как ширины модулей на виде спереди.
  const turnedSeen = {}, turnedChain = [];
  for (const m of mods) {
    if (!(m.rotation === 90 || m.rotation === 270)) continue;
    const a = topSy(m.offsetZ - m.dims.D / 2);
    const b = topSy(m.offsetZ + m.dims.D / 2);
    const label = String(Math.round(m.dims.D));
    const key = `${Math.round(a)}/${Math.round(b)}/${label}`;
    if (turnedSeen[key]) continue;
    turnedSeen[key] = 1;
    turnedChain.push({ a, b, label });
  }
  for (const it of packDims(turnedChain, topLv)) {
    body += dimV(it.a, it.b, fx0, it.level, it.label, -1);
  }

  body += line(fx0, fy0 + fh + GAP * 0.5, fx0 + fw, fy0 + fh + GAP * 0.5, 'dw-axis');

  // Ручная разметка (markup.js, см. этот файл): передаём контексты видов —
  // получаем обратно готовые пользовательские размеры + пустую «живую»
  // группу для интерактивной перерисовки по наведению/клику. Вызывается на
  // КАЖДОЙ перерисовке чертежа (recompute), поэтому разметка не теряется.
  // Третий аргумент — рамка листа, посчитанная ДО ручных размеров: в её
  // пределах markup.js ограничивает вынос. Считать её вместе с ручными
  // размерами нельзя — рамка раздвигается под их же вынос (svgFit), и лист
  // «рос» бы от каждого перетаскивания (обратная связь).
  const mkBody = mkAttach('overview', model, mkViews, totalW, totalH, body);
  body += mkBody;

  // Без подзаголовка: над блоком уже стоит заголовок раздела «Общий вид»
  // Заголовок и габарит — только для печати: на листе с рамкой шапка вкладки
  // (dw-head) скрыта, и эта строка стоит внутри рамки.
  return `<div class="dw-block dw-overview"><div class="dw-title dw-printonly">Общий вид · ${esc(headText || '')}</div>${svgTagMk(totalW, totalH, body, mkBody ? 'overview' : '')}</div>`;
}

// ---------------------------------------------------------------------------
// Отдельная проекция с размерами — для оверлея над 3D («вид как на чертеже»)
// ---------------------------------------------------------------------------
function buildViewSVG(model, view, maxW, maxH) {
  const d = model.dims;
  const showFacades = view === 'front';
  const parts = model.partsRaw.filter(p => (view === 'front' ? !INTERIOR_KINDS[p.kind] : !FACADE_KINDS[p.kind]));

  const hSize = (view === 'side') ? d.D : d.W;
  const vSize = (view === 'top') ? d.D : d.H;
  const PAD_L = DIM_FIRST + 3 * DIM_STEP + 18, PAD_T = 26, PAD_R = 18;
  const PAD_B = DIM_FIRST + 3 * DIM_STEP + 18;

  const scale = Math.min((maxW - PAD_L - PAD_R) / hSize, (maxH - PAD_T - PAD_B) / vSize);
  const w = hSize * scale, h = vSize * scale;
  const totalW = w + PAD_L + PAD_R, totalH = h + PAD_T + PAD_B;

  let body = '', title = '';
  if (view === 'front') {
    const F = { x: (v) => PAD_L + (v + d.W / 2) * scale, y: (v) => PAD_T + (d.H - v) * scale };
    body += drawParts(parts, F.x, F.y, 'x', 'y', null);
    body += frontDims(model, F, PAD_T + h, PAD_L);
    for (const m of model.modules) body += moduleLabel(m, F);
    title = 'ВИД СПЕРЕДИ';
  } else if (view === 'side') {
    const S = { x: (v) => PAD_L + (v + d.D / 2) * scale, y: (v) => PAD_T + (d.H - v) * scale };
    body += drawParts(parts, S.x, S.y, 'z', 'y', null);
    body += dimH(S.x(-d.D / 2), S.x(d.D / 2), PAD_T + h, 0, String(Math.round(d.D)));
    body += dimV(S.y(0), S.y(d.H), PAD_L, 0, String(Math.round(d.H)), -1);
    title = 'ВИД СБОКУ';
  } else {
    const X = (v) => PAD_L + (v + d.W / 2) * scale;
    const Y = (v) => PAD_T + (d.D / 2 + v) * scale;
    body += drawParts(parts, X, Y, 'x', 'z', null);
    body += dimH(X(-d.W / 2), X(d.W / 2), PAD_T + h, 0, String(Math.round(d.W)));
    body += dimV(Y(-d.D / 2), Y(d.D / 2), PAD_L, 0, String(Math.round(d.D)), -1);
    title = 'ВИД СВЕРХУ';
  }
  body += text(PAD_L + w / 2, 11, title, 'dw-vname', 'middle');
  return svgTag(totalW, totalH, body);
}

// ---------------------------------------------------------------------------
// Чертёж МОДУЛЯ: весь каркас без фасадов, в трёх видах (спереди / сбоку /
// сверху) в проекционной связи. Здесь отсечение невидимого НЕ применяется —
// это рабочий чертёж каркаса, на нём должны быть видны все детали корпуса:
// боковины, дно, крыша, стойки, полки, ящики, задняя стенка и цоколь.
// ---------------------------------------------------------------------------
function buildModuleDrawing(model, mod, scale) {
  // Габариты берём СОБСТВЕННЫЕ (до поворота): на рабочем чертеже ширина
  // модуля — это его ширина, а не то, сколько он занимает по стене.
  const md = mod.dimsOwn || mod.dims;
  // ЧЕРТЁЖ МОДУЛЯ СТРОИТСЯ ОТ ЕГО СОБСТВЕННОГО ФРОНТА. У повёрнутого на 90°
  // модуля ширина идёт вдоль мировой Z, а глубина — вдоль X; если рисовать
  // «как стоит в комнате», модуль выходит на чертеже боком и по нему нельзя
  // работать. Поэтому оси проекций выбираются по повороту модуля.
  const turned = mod.rotation === 90 || mod.rotation === 270;
  const HA = turned ? 'z' : 'x';          // ось ШИРИНЫ модуля
  const DA = turned ? 'x' : 'z';          // ось ГЛУБИНЫ модуля
  const centerH = turned ? mod.offsetZ : mod.offsetX;
  const x0 = centerH - md.W / 2;          // край модуля по его ширине

  // Все детали модуля кроме фасадов. Сквозной цоколь принадлежит нескольким
  // модулям сразу («М1 + М2»), поэтому сравниваем не строго, а по вхождению.
  const belongs = (p) => p.module === mod.name
    || String(p.module || '').split(' + ').indexOf(mod.name) !== -1;
  // На чертёж модуля идут только детали корпуса: фасады и фурнитура не в счёт
  // Сквозной цоколь ряда — деталь общая для нескольких модулей (её и режут
  // одной планкой). На чертёж отдельного модуля она не идёт: планка длиннее
  // корпуса и вылезает за рамку. Её место — общий вид и деталировка.
  const runWide = (p) => p.kind === 'plinth' && String(p.module || '').indexOf(' + ') !== -1;
  // Навесной модуль поднят на свою отметку (mod.offsetY — низ от пола): его
  // рабочий чертёж строится от низа МОДУЛЯ, как у напольного, иначе он
  // «вырастает» до отметки верха (2400). Боксы копируем со сдвигом по Y —
  // модель не трогаем, габариты md.* и так в координатах модуля.
  const oy = Number(mod.offsetY) || 0;
  const parts = model.partsRaw.filter(p => belongs(p) && !FACADE_KINDS[p.kind]
    && !p.hardware && !runWide(p))
    .map((p) => (oy ? Object.assign({}, p, {
      boxes: p.boxes.map((b) => Object.assign({}, b, { y: b.y - oy })),
    }) : p));
  if (!parts.length) return '';

  // Глубина и Z-центр берём по фактическим деталям — модули выровнены по фронту
  const sizeOn = (b, ax) => (ax === 'x' ? b.w : b.d);
  let zMin = Infinity, zMax = -Infinity, mxMin = Infinity, mxMax = -Infinity,
      myMax = -Infinity;
  for (const p of parts) for (const b of p.boxes) {
    zMin = Math.min(zMin, b[DA] - sizeOn(b, DA) / 2);
    zMax = Math.max(zMax, b[DA] + sizeOn(b, DA) / 2);
    mxMin = Math.min(mxMin, b[HA] - sizeOn(b, HA) / 2);
    mxMax = Math.max(mxMax, b[HA] + sizeOn(b, HA) / 2);
    myMax = Math.max(myMax, b.y + b.h / 2);
  }
  const dDepth = zMax - zMin;
  const dWidth = Math.max(mxMax - mxMin, md.W);
  const dHeight = Math.max(myMax, md.H);

  const fw = dWidth * scale, fh = dHeight * scale, dd = dDepth * scale;
  const PAD_L = DIM_FIRST + 4 * DIM_STEP + 16;
  const PAD_T = 22;
  const PAD_R = DIM_FIRST + 8 * DIM_STEP + 18;
  const PAD_B = DIM_FIRST + 2 * DIM_STEP + 18;
  const totalW = PAD_L + fw + GAP + dd + PAD_R;
  const totalH = PAD_T + fh + GAP + dd + PAD_B;

  const fx0 = PAD_L, fy0 = PAD_T;
  const sx0 = PAD_L + fw + GAP;
  const ty0 = PAD_T + fh + GAP;

  const FX = (v) => fx0 + (v - Math.min(x0, mxMin)) * scale;   // вид спереди, X
  const FY = (v) => fy0 + (dHeight - v) * scale;               // высота (спереди/сбоку)
  const SX = (v) => sx0 + (v - zMin) * scale;            // вид сбоку, глубина
  const TY = (v) => ty0 + (v - zMin) * scale;            // вид сверху, глубина

  let body = '';
  const labels = [];
  const rows = [], seen = {};

  // --- три проекции ---
  body += drawParts(parts, FX, FY, HA, 'y', labels, true);
  // Номера позиций на самом чертеже не ставим: они путаются с размерами,
  // а связь с деталировкой даёт таблица под чертежом.
  body += text(fx0 + fw / 2, fy0 - 9, 'ВИД СПЕРЕДИ', 'dw-vname', 'middle');

  body += drawParts(parts, SX, FY, DA, 'y', null, true);
  body += text(sx0 + dd / 2, fy0 - 9, 'ВИД СБОКУ', 'dw-vname', 'middle');

  body += drawParts(parts, FX, TY, HA, DA, null, true);
  body += text(fx0 + fw / 2, ty0 - 7, 'ВИД СВЕРХУ', 'dw-vname', 'middle');

  // линия проекционной связи
  body += line(fx0, fy0 + fh + GAP * 0.5, fx0 + fw, fy0 + fh + GAP * 0.5, 'dw-axis');

  // Контексты видов для ручной разметки — ровно те же оси/функции/детали,
  // что у трёх drawParts() выше; присадка здесь нарисована (noHoles:false).
  const modUid = (parts.filter((p) => p.module === mod.name && p.moduleUid)[0] || {}).moduleUid;
  const mkSheet = modUid ? 'module:' + modUid : '';
  const mkViews = [
    { name: 'front', noHoles: false, hAxis: HA, vAxis: 'y', sx: FX, sy: FY, rows: parts,
      region: { x0: fx0, y0: fy0, x1: fx0 + fw, y1: fy0 + fh } },
    { name: 'side', noHoles: false, hAxis: DA, vAxis: 'y', sx: SX, sy: FY, rows: parts,
      region: { x0: sx0, y0: fy0, x1: sx0 + dd, y1: fy0 + fh } },
    { name: 'top', noHoles: false, hAxis: HA, vAxis: DA, sx: FX, sy: TY, rows: parts,
      region: { x0: fx0, y0: ty0, x1: fx0 + fw, y1: ty0 + dd } },
  ];

  // --- состав деталей ---
  for (const row of parts) {
    if (row.num == null) continue;            // фурнитура — не деталь из листа
    if (seen[row.num]) seen[row.num].qty += 1;
    else {
      seen[row.num] = { num: row.num, name: row.name, material: row.material,
        // Размер — в порядке деталировки (первой цифрой размер вдоль текстуры,
        // engine.js cutLength/cutWidth): под одним номером позиции чертёж и
        // деталировка не должны показывать разные цифры.
        size: `${row.cutLength != null ? row.cutLength : row.length}×${row.cutWidth != null ? row.cutWidth : row.width}`,
        th: row.thickness, qty: 1 };
      rows.push(seen[row.num]);
    }
  }
  rows.sort((a, b) => a.num - b.num);

  // --- размеры вида спереди ---
  const yb = fy0 + fh;
  // проёмы секций
  for (let i = 0; i < md.n; i++) {
    const sc = md.sections[i];
    body += dimH(FX(centerH + sc.x0), FX(centerH + sc.x1), yb, 0, String(Math.round(sc.w)));
  }
  body += dimH(FX(x0), FX(x0 + md.W), yb, 1, String(Math.round(md.W)));

  // Высоты — ЦЕПОЧКОЙ: расстояние между соседними полками и ящиками, а не
  // «каждая отметка от дна». Так сборщику видно, какой просвет между полками.
  const rightX = fx0 + fw;
  const marksY = [md.innerBottomY];
  for (const p of parts) {
    const b = p.boxes[0];
    if (p.kind === 'shelf') marksY.push(b.y - b.h / 2, b.y + b.h / 2);
    if (p.kind === 'drawerBottom') marksY.push(b.y - b.h / 2);
  }
  marksY.push(md.innerBottomY + md.innerH);
  const uniqY = marksY.map((v) => Math.round(v)).filter((v, i, a) => a.indexOf(v) === i)
    .sort((x, y) => x - y);
  const chain = [];
  for (let i = 0; i < uniqY.length - 1; i++) {
    const h = uniqY[i + 1] - uniqY[i];
    if (h < 10) continue;
    chain.push({ a: FY(uniqY[i + 1]), b: FY(uniqY[i]), label: String(h) });
  }
  let lvl = 0;
  for (const it of packDims(chain, 0)) {
    body += dimV(it.a, it.b, rightX, it.level, it.label);
    lvl = Math.max(lvl, it.level + 1);
  }
  body += dimV(FY(md.innerBottomY), FY(md.innerBottomY + md.innerH), rightX, lvl++, String(Math.round(md.innerH)));
  body += dimV(FY(0), FY(md.baseH), fx0, 0, String(Math.round(md.baseH)), -1);
  body += dimV(FY(0), FY(md.H), fx0, 1, String(Math.round(md.H)), -1);

  // --- размеры вида сбоку и сверху ---
  // Координаты присадки здесь НЕ проставляем: чертёж каркаса нужен для
  // сборки — из чего он состоит и какие просветы между полками. Координаты
  // отверстий уходят в документацию для ЧПУ (CSV и DXF), там им и место.
  body += dimH(SX(zMin), SX(zMax), yb, 0, String(Math.round(dDepth)));
  body += dimV(TY(zMin), TY(zMax), fx0, 0, String(Math.round(dDepth)), -1);

  const mkBody = mkAttach(mkSheet, model, mkViews, totalW, totalH, body);
  body += mkBody;

  // Таблица деталей — внутри чертежа, в правом нижнем углу листа. Если в этом
  // углу она не налезает на виды (под видом сбоку и правее вида сверху), то
  // стоит там; иначе чертёж удлиняется вниз и таблица идёт под видами.
  const tbl = svgTable(0, 0, [30, 170, 250, 80, 36, 34],
    ['Поз.', 'Деталь', 'Материал', 'Размер, мм', 'Толщ.', 'Кол.'],
    rows.map((x) => [String(x.num), x.name, materialTitle(x.material), x.size, String(x.th), String(x.qty)]));
  let sheetW = Math.max(totalW, tbl.w + 12), sheetH = totalH;
  let tx = sheetW - tbl.w - 6, ty = sheetH - tbl.h - 4;
  const clearOfTop = tx > fx0 + fw + 14 || ty > ty0 + dd + 40;
  const clearOfSide = ty > fy0 + fh + 40 || tx > sx0 + dd + 8;
  if (!(clearOfTop && clearOfSide)) {
    sheetH = totalH + tbl.h + 10;
    ty = sheetH - tbl.h - 4;
  }
  // Холст подгоняется под пропорции рамки листа (поле чертежа 269×190 мм):
  // чертёж не прижимается к краю, а таблица остаётся строго в правом нижнем
  // углу листа после масштабирования. Узкий холст расширяем в стороны
  // (виды остаются посередине), низкий — добавляем высоты сверху.
  const SHEET_ASPECT = 269 / 190;
  let leftExt = 0;
  if (sheetW / sheetH < SHEET_ASPECT) {
    const nw = sheetH * SHEET_ASPECT, dx = (nw - sheetW) / 2;
    leftExt = -dx; sheetW += dx; tx = sheetW - tbl.w - 6;
    body += `<rect x="${r(leftExt)}" y="0" width="1" height="1" style="fill:none;stroke:none"/>`;
  } else {
    const nh = sheetW / SHEET_ASPECT;
    ty += nh - sheetH; sheetH = nh;
  }
  body += svgTable(tx, ty, [30, 170, 250, 80, 36, 34],
    ['Поз.', 'Деталь', 'Материал', 'Размер, мм', 'Толщ.', 'Кол.'],
    rows.map((x) => [String(x.num), x.name, materialTitle(x.material), x.size, String(x.th), String(x.qty)])).svg;

  return `<div class="dw-block dw-modsheet">
    <div class="dw-title">${esc(mod.name)} — каркас без фасадов</div>
    ${svgTagMk(sheetW, sheetH, body, mkBody ? mkSheet : '')}
  </div>`;
}

// ---------------------------------------------------------------------------
// Фасады
// ---------------------------------------------------------------------------
// Короткая сводка по присадке для подписи под чертежом фасада.
// Число без хвоста «.0»: 6.9 → «6.9», 28 → «28» (для размеров присадки
// алюм. рамки, где десятые доли — не округление, а паспорт петли).
function mm1(v) { return String(Math.round(v * 10) / 10); }

// Петля для алюм. рамки из каталога (Blum 71T950A) — для подписей чертежа.
function aluHingeTitle() {
  const hg = (window.Modul3D && window.Modul3D.catalog && window.Modul3D.catalog.ALU_FRAME_EXTRAS
    && window.Modul3D.catalog.ALU_FRAME_EXTRAS.hinge) || {};
  const brand = /blum/i.test(hg.name || '') ? 'Blum ' : '';
  return `${brand}${hg.article || ''}`.trim() || 'для алюм. рамок';
}
// Описание отверстия под саморез петли алюм. рамки (engine.js aluHingeCuts):
// «Ø5, зенк. 90° до Ø7, сквозь тыльную стенку профиля 1.2».
function aluScrewText(h) {
  let t = `Ø${mm1(h.d)}`;
  if (h.csk > h.d) t += `, зенк.${h.cskAngle ? ` ${h.cskAngle}°` : ''} до Ø${mm1(h.csk)}`;
  t += h.throughWall ? `, сквозь тыльную стенку профиля${h.depth ? ` ${mm1(h.depth)}` : ''}`
    : (h.through ? ' насквозь' : ` глуб. ${h.depth}`);
  return t;
}
// Размеры паза под механизм петли по его оси (x0,y0)-(x1,y1) и ширине w:
// { a — поперёк оси (ширина), b — вдоль оси (длина) }.
function slotSize(g) {
  return { a: g.w, b: Math.round(Math.hypot(g.x1 - g.x0, g.y1 - g.y0) * 10) / 10 };
}
function aluSlotText(g) {
  const z = slotSize(g);
  return `паз ${mm1(z.a)}×${mm1(z.b)} под механизм петли ${aluHingeTitle()}`
    + (g.throughWall ? `, сквозь тыльную стенку профиля${g.depth ? ` ${mm1(g.depth)}` : ''}` : '');
}

function holeSummary(p) {
  const byD = {};
  for (const h of (p.holes || [])) {
    const key = h.kind === 'aluHingeScrew' ? aluScrewText(h)
      : `Ø${h.d}${h.through ? ' насквозь' : ' глуб. ' + h.depth}`;
    byD[key] = (byD[key] || 0) + 1;
  }
  return Object.keys(byD).map((k) => `${byD[k]}×${k}`).join(', ');
}

// Разметка отверстий на чертеже фасада: сами отверстия с осями и размеры
// до них от ближайших торцов, плюс межосевое расстояние ручки.
// Раскладка размерных линий по уровням.
// Размеры, которые не перекрываются, ставим НА ОДНУ линию; перекрывающиеся
// разносим: сначала короткие (ближе к детали), длинные выносим дальше.
// Так цепочка читается и линии не наезжают друг на друга.
function packDims(items, baseLevel) {
  const sorted = items.slice().sort((a, b) => (a.b - a.a) - (b.b - b.a));
  const rows = [];
  // Звенья одной цепочки стыкуются торцами — это норма, они должны стоять
  // в одну линию. Клашем считаем только настоящее наложение.
  const CLEAR = 0.5;
  for (const it of sorted) {
    let lv = 0;
    for (;; lv++) {
      if (!rows[lv]) rows[lv] = [];
      // Касание торцами (перекрытие 0) — это цепочка, она в одну линию.
      const clash = rows[lv].some((s) =>
        Math.min(s.b, it.b) - Math.max(s.a, it.a) > CLEAR);
      if (!clash) { rows[lv].push(it); it.level = (baseLevel || 0) + lv; break; }
    }
  }
  return sorted;
}

// ---------------------------------------------------------------------------
// Таблица в самом чертеже (SVG): масштабируется вместе с видами, поэтому на
// печатном листе всегда остаётся в своём углу и не налезает на чертёж.
// cols — ширины колонок, head — заголовки, rows — строки. Слишком длинный
// текст сжимается по ширине колонки (textLength), а не вылезает за неё.
// ---------------------------------------------------------------------------
function svgTable(x, y, cols, head, rows) {
  const RH = 14, FS = 9;
  const w = cols.reduce((a, c) => a + c, 0), h = (rows.length + 1) * RH;
  let s2 = `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" class="dw-legbg"/>`
    + `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${RH}" class="dw-legh"/>`;
  let cx = x;
  for (let i = 0; i < cols.length - 1; i++) { cx += cols[i]; s2 += line(cx, y, cx, y + h, 'dw-thin'); }
  for (let k = 1; k <= rows.length; k++) s2 += line(x, y + k * RH, x + w, y + k * RH, 'dw-thin');
  const cell = (tx, ty, str, cw, cls) => {
    const t = String(str);
    const need = t.length * FS * 0.55;
    const fit = need > cw - 6 ? ` textLength="${r(cw - 6)}" lengthAdjust="spacingAndGlyphs"` : '';
    return `<text x="${r(tx + 3)}" y="${r(ty + RH - 4)}" class="${cls}"${fit}>${esc(t)}</text>`;
  };
  cx = x;
  head.forEach((t, i) => { s2 += cell(cx, y, t, cols[i], 'dw-lth'); cx += cols[i]; });
  rows.forEach((row, k) => {
    cx = x;
    row.forEach((t, i) => {
      if (t && typeof t === 'object') {
        s2 += `<circle cx="${r(cx + cols[i] / 2)}" cy="${r(y + (k + 1) * RH + RH / 2)}" r="4" style="stroke:${t.swatch};fill:${t.swatch};fill-opacity:.3;stroke-width:1.4"/>`;
      } else s2 += cell(cx, y + (k + 1) * RH, t, cols[i], 'dw-lt');
      cx += cols[i];
    });
  });
  return { svg: s2, w, h };
}

// Названия присадки для таблицы обозначений на листе детали. Только
// назначение — размеры (Ø, глубина) берутся из самого отверстия.
const HOLE_LABELS = {
  minifixCam: 'Эксцентрик минификса',
  minifixBolt: 'Стяжка минификса, в торец',
  minifixDowel: 'Шкант минификса',
  dowelFace: 'Шкант, в пласть',
  dowelEdge: 'Шкант, в торец',
  confirmatEdge: 'Конфирмат, в торец',
  confirmatThrough: 'Конфирмат, сквозное',
  legFix: 'Крепление опоры',
  frontFix: 'Крепление фасада',
  boxBottomFix: 'Крепление дна ящика',
  shelfSupport: 'Полкодержатель',
  drawerRunner: 'Направляющая ящика',
  runnerPinRear: 'Штифт направляющей (задний)',
  runnerPinCabinet: 'Штифт направляющей (корпус)',
  runnerBracket: 'Кронштейн направляющей',
  relingFix: 'Крепление рейлинга',
  rodFlange: 'Фланец штанги',
  hangerScrew: 'Шуруп навесной шины',
  handle: 'Ручка',
  hingeCup: 'Чашка петли',
  hingeGlass: 'Чашка петли (стекло)',
  custom: 'Пользовательское',
};
// Цвета групп присадки на чертеже детали: буквы у отверстий в тесной присадке
// сливались с размерами, цвет читается сразу (в таблице — тот же кружок).
const HOLE_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#00a6b8',
  '#c9a200', '#d81b8c', '#8d6e63', '#00897b', '#7cb342', '#5e35b1'];

// Группы одинаковой присадки детали (вид, Ø, глубина, сторона) с буквенным
// обозначением. Отверстия под саморезы алюм. рамки не входят — у них своя
// таблица (aluHingeTable). null — размечать нечего.
function holeGroups(p) {
  const list = [];
  const byKey = {};
  for (const h of (p.holes || [])) {
    if (h.kind === 'aluHingeScrew') continue;
    const key = [h.kind, h.d, h.through ? 'T' : h.depth, h.side || '', h.tz || 0].join('|');
    if (!byKey[key]) {
      // zb — высота оси отверстия в торец от нижней пласти (h.tz считается от
      // середины толщины вверх): так же, как в 3D и в файле для ЧПУ.
      byKey[key] = { key, kind: h.kind, d: h.d, depth: h.depth, through: !!h.through,
        side: h.side || '', zb: Number.isFinite(h.tz) ? h.tz + p.thickness / 2 : null, count: 0, color: HOLE_COLORS[list.length % HOLE_COLORS.length] };
      list.push(byKey[key]);
    }
    byKey[key].count += 1;
  }
  if (!list.length) return null;
  const keyOf = (h) => [h.kind, h.d, h.through ? 'T' : h.depth, h.side || '', h.tz || 0].join('|');
  return { list, colorOf: (h) => (byKey[keyOf(h)] || {}).color || '' };
}

function holeLegendSvg(hg, x0, y0) {
  x0 = x0 || 0; y0 = y0 || 0;
  const rows = hg.list.map((g) => [
    { swatch: g.color },
    (HOLE_LABELS[g.kind] || g.kind) + (g.side === 'back' ? ', с тыла' : '')
      + (g.zb != null ? `, ось ${mm1(g.zb)} мм от низа` : ''),
    'Ø' + mm1(g.d),
    g.through ? 'насквозь' : mm1(g.depth),
    String(g.count),
  ]);
  // Сноска (если есть) — НАД таблицей, чтобы сама таблица стояла вплотную к углу.
  const note = hg.list.some((g) => g.kind === 'legFix');
  const off = note ? 13 : 0;
  const t = svgTable(x0, y0 + off, [24, 128, 30, 44, 24], ['Об.', 'Присадка', 'Ø', 'Глуб.', 'Шт.'], rows);
  if (note) t.svg += text(x0, y0 + 9, 'Крепление опоры: размеры отверстий — в файле для ЧПУ', 'dw-lt', 'start');
  t.h += off;
  return t;
}

// Метка отверстия в торец: показываем его вход на краю детали —
// штриховой прямоугольник глубиной с отверстие. Координаты: x=0 или
// x=длина — торцы по длине, y — положение вдоль торца.
function edgeHoleMark(p, h, px, py, scale, color) {
  const eps = 0.01;
  let rx, ry, rw, rh;
  const wid = Math.max(h.d * scale, 2), len = Math.max(h.depth * scale, 3);
  if (h.x <= eps || h.x >= p.length - eps) {
    const right = h.x > p.length / 2;
    rx = right ? px(p.length) - len : px(0); ry = py(h.y) - wid / 2; rw = len; rh = wid;

  } else if (h.y <= eps || h.y >= p.width - eps) {
    const top = h.y > p.width / 2;
    rx = px(h.x) - wid / 2; ry = top ? py(p.width) : py(0) - len; rw = wid; rh = len;
  } else return '';
  const c = color || 'currentColor';
  return `<rect x="${r(rx)}" y="${r(ry)}" width="${r(rw)}" height="${r(rh)}" class="dw-thin" style="fill:${c};fill-opacity:.25;stroke:${c};stroke-width:1.2"/>`;
}

function facadeHoles(p, x0, y0, fw, fh, scale, hg) {
  const holes = p.holes || [];
  const aluSlots = (p.grooves || []).filter((g) => g.kind === 'aluHingeSlot');
  if (!holes.length && !aluSlots.length) return '';
  const px = (v) => x0 + v * scale;
  const py = (v) => y0 + fh - v * scale;   // деталь снизу вверх
  const LEFT = x0, RIGHT = x0 + fw, TOP = y0, BOTTOM = y0 + fh;
  let body = '';

  for (const h of holes) {
    // Присадка в торец на пласти не изображается — её место в документации
    // для ЧПУ (см. такую же проверку в drawParts()).
    if (h.side === 'edge') {
      if (hg) body += edgeHoleMark(p, h, px, py, scale, hg.colorOf(h));
      continue;
    }
    const cx = px(h.x), cy = py(h.y);
    const rr = Math.max((h.d * scale) / 2, 1.6);
    if (h.kind === 'aluHingeScrew' && h.csk > h.d) {
      // фаска (зенковка) — концентрическая окружность Ø фаски
      body += `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(Math.max((h.csk * scale) / 2, rr + 0.8))}" class="dw-thin" style="fill:none"/>`;
    }
    const hc = hg && h.kind !== 'aluHingeScrew' ? hg.colorOf(h) : '';
    body += `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(rr)}" class="dw-hole"${hc ? ` style="stroke:${hc};fill:${hc};fill-opacity:.25;stroke-width:1.4"` : ''}/>`;
    body += line(cx - rr - 4, cy, cx + rr + 4, cy, 'dw-axis');
    body += line(cx, cy - rr - 4, cx, cy + rr + 4, 'dw-axis');
  }
  // Паз под механизм петли алюм. рамки — прямоугольник по его оси и ширине
  // (с тыльной стороны, как и чашки петель у обычных дверей).
  for (const g of aluSlots) {
    const half = g.w / 2;
    const vert = Math.abs(g.x1 - g.x0) < 0.01;
    const xa = vert ? g.x0 - half : Math.min(g.x0, g.x1), xb = vert ? g.x0 + half : Math.max(g.x0, g.x1);
    const ya = vert ? Math.min(g.y0, g.y1) : g.y0 - half, yb = vert ? Math.max(g.y0, g.y1) : g.y0 + half;
    body += rect(px(xa), py(yb), (xb - xa) * scale, (yb - ya) * scale, 'dw-hole');
  }

  const dims = { bottom: [], top: [], left: [], right: [] };
  // Цепочка: край → отверстие → отверстие → … → край. Все звенья не
  // перекрываются, поэтому встают в ОДНУ линию — как на чертеже из цеха.
  // fine — подпись с десятыми (присадка алюм. рамки по паспорту петли:
  // 12.8 — это не 13); у остальной присадки — как раньше, целые мм.
  const lab = (d, fine) => (fine ? mm1(d) : String(Math.round(d)));
  const chainY = (vals, side, fine) => {
    const ys = vals.slice().sort((a, b) => a - b);
    const pts = [0].concat(ys, [p.width]);
    for (let k = 0; k < pts.length - 1; k++) {
      const d = pts[k + 1] - pts[k];
      if (d < 1) continue;
      dims[side].push({ a: py(pts[k + 1]), b: py(pts[k]), label: lab(d, fine) });
    }
  };
  const chainX = (vals, side, fine) => {
    const xs = vals.slice().sort((a, b) => a - b);
    const pts = [0].concat(xs, [p.length]);
    for (let k = 0; k < pts.length - 1; k++) {
      const d = pts[k + 1] - pts[k];
      if (d < 1) continue;
      dims[side].push({ a: px(pts[k]), b: px(pts[k + 1]), label: lab(d, fine) });
    }
  };
  // Размер всегда от БЛИЖНЕГО края детали
  const addX = (xv, side) => {
    const nearRight = xv > p.length / 2;
    const a = nearRight ? px(xv) : px(0);
    const b = nearRight ? px(p.length) : px(xv);
    dims[side].push({ a: Math.min(a, b), b: Math.max(a, b),
                      label: String(Math.round(nearRight ? p.length - xv : xv)) });
  };
  const addY = (yv, side) => {
    const nearTop = yv > p.width / 2;
    const a = nearTop ? py(p.width) : py(yv);
    const b = nearTop ? py(yv) : py(0);
    dims[side].push({ a: Math.min(a, b), b: Math.max(a, b),
                      label: String(Math.round(nearTop ? p.width - yv : yv)) });
  };
  const addSpanX = (x1, x2, side) => {
    dims[side].push({ a: px(Math.min(x1, x2)), b: px(Math.max(x1, x2)),
                      label: String(Math.round(Math.abs(x2 - x1))) });
  };
  const addSpanY = (y1, y2, side) => {
    dims[side].push({ a: py(Math.max(y1, y2)), b: py(Math.min(y1, y2)),
                      label: String(Math.round(Math.abs(y2 - y1))) });
  };

  const hand = holes.filter((h) => h.kind === 'handle');
  const cups = holes.filter((h) => h.kind === 'hingeCup' || h.kind === 'hingeGlass');
  // Отверстия под саморезы петли алюм. рамки — своя разметка ниже.
  const aluScrews = holes.filter((h) => h.kind === 'aluHingeScrew');
  const other = holes.filter((h) => h.kind !== 'handle' && h.kind !== 'hingeCup' && h.kind !== 'hingeGlass'
    && h.kind !== 'aluHingeScrew');
  // Пользовательские отверстия (экран «Деталь», добавлены вручную, kind:'custom')
  // размечаем полноценными размерными цепочками, как ручку/петли — иначе
  // на чертеже видно только первое из них, а остальные без размеров и подписи.
  const custom = other.filter((h) => h.kind === 'custom');
  const otherRest = other.filter((h) => h.kind !== 'custom');

  // ПЕТЛИ — размеры со стороны петель
  let hingeLeft = true;
  if (cups.length) {
    const c0 = cups[0], cN = cups[cups.length - 1];
    hingeLeft = c0.x < p.length / 2;
    const vside = hingeLeft ? 'left' : 'right';
    chainX([c0.x], 'bottom');
    chainY(cups.map((c) => c.y), vside);
    const label = c0.through ? `Ø${c0.d} насквозь` : `Ø${c0.d} глуб. ${c0.depth}`;
    // С таблицей обозначений (hg) подпись Ø/глубины дублировала бы её.
    if (!hg) body += text(px(c0.x) + (hingeLeft ? 10 : -10), py(c0.y) - 6, label, 'dw-t',
                 hingeLeft ? 'start' : 'end');
  }

  // ПЕТЛИ АЛЮМ. РАМКИ (Blum 71T950A): как у чашек — цепочка осей петель по
  // высоте со стороны петель и ОДИН размер от края фасада до оси саморезов
  // (он у всех петель одинаковый — на каждой не повторяем). Шаг 28, 6.9 от
  // внутреннего края рамки и размеры паза — на выносном элементе «А»
  // (aluHingeNode), в масштабе всего фасада их не прочитать.
  if (aluScrews.length && !cups.length) {
    hingeLeft = aluScrews[0].x < p.length / 2;
    const vside = hingeLeft ? 'left' : 'right';
    const axes = [];
    for (const h of aluScrews) {
      const y = h.hingeY != null ? h.hingeY : h.y;
      if (!axes.some((a) => Math.abs(a - y) < 0.05)) axes.push(y);
    }
    chainY(axes, vside, true);
    chainX([aluScrews[0].x], 'bottom', true);
    // Обозначение выносного элемента «А» — тонкая окружность вокруг первой
    // (нижней) петли и буква на полке линии-выноски.
    const a0 = Math.min.apply(null, axes);
    const xc = px(aluScrews[0].x), yc = py(a0);
    const rr = Math.max(22 * scale, 9);
    body += `<circle cx="${r(xc)}" cy="${r(yc)}" r="${r(rr)}" class="dw-thin" style="fill:none"/>`;
    const lx = xc + (hingeLeft ? rr * 0.7 : -rr * 0.7), ly = yc - rr * 0.7;
    const tx = lx + (hingeLeft ? 10 : -10), ty = ly - 8;
    body += line(lx, ly, tx, ty, 'dw-thin') + line(tx, ty, tx + (hingeLeft ? 9 : -9), ty, 'dw-thin');
    body += text(tx + (hingeLeft ? 4.5 : -4.5), ty - 2, 'А', 'dw-t', 'middle');
  }

  // РУЧКА
  if (hand.length) {
    const xs = hand.map((h) => h.x), ys = hand.map((h) => h.y);
    const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    const rightSide = maxX > p.length / 2;
    const hinged = cups.length || aluScrews.length;
    const vside = hinged ? (hingeLeft ? 'right' : 'left') : (rightSide ? 'right' : 'left');
    if (maxY - minY > 0.5) chainY(ys, vside); else chainY([minY], vside);
    if (maxX - minX > 0.5) chainX(xs, 'top'); else chainX([minX], 'top');
  }

  // ПОЛЬЗОВАТЕЛЬСКИЕ ОТВЕРСТИЯ: цепочка по X и по Y от краёв детали + подпись
  // диаметра/сквозности у КАЖДОГО отверстия (не только у первого).
  if (custom.length) {
    const xs = custom.map((h) => h.x), ys = custom.map((h) => h.y);
    // Горизонтальная сторона: 'top' занята цепочкой ручки — если ручка есть,
    // уходим на 'bottom' (её частично занимает только один короткий сегмент
    // цепочки петель — не критично, packDims разведёт по уровням).
    const hside = hand.length ? 'bottom' : 'top';
    chainX(xs, hside);
    // Вертикальная сторона: смотрим, что уже занято петлями/ручкой, и берём
    // свободную; если свободной нет — ориентируемся на то, к какому краю
    // сами кастомные отверстия ближе (тот же принцип, что у ручки выше).
    const usedV = new Set();
    const hinged = cups.length || aluScrews.length;
    if (hinged) usedV.add(hingeLeft ? 'left' : 'right');
    if (hand.length) {
      const handRight = Math.max.apply(null, hand.map((h) => h.x)) > p.length / 2;
      usedV.add(hinged ? (hingeLeft ? 'right' : 'left') : (handRight ? 'right' : 'left'));
    }
    const avgX = xs.reduce((s, v) => s + v, 0) / xs.length;
    const preferred = avgX > p.length / 2 ? 'right' : 'left';
    const fallback = preferred === 'right' ? 'left' : 'right';
    const vsideCustom = !usedV.has(preferred) ? preferred : (!usedV.has(fallback) ? fallback : preferred);
    chainY(ys, vsideCustom);
    for (const h of (hg ? [] : custom)) {
      const label = h.through ? `Ø${h.d} насквозь` : `Ø${h.d} глуб. ${h.depth}`;
      body += text(px(h.x), py(h.y) - 6, label, 'dw-t', 'middle');
    }
  }

  // Остальная присадка (минификс, шканты, опоры, направляющие…): раньше на
  // чертеже было видно только первое отверстие без размеров. Теперь — полная
  // цепочка размеров от краёв по X и по Y (одной линией по каждой оси), а
  // буквы у отверстий отсылают к таблице обозначений на листе.
  if (hg && otherRest.length) {
    const uniq = (arr) => arr.map((v) => Math.round(v * 10) / 10)
      .filter((v, i, a) => a.indexOf(v) === i);
    // Пилотные отверстия Ø2 под опоры (legFix) кучкуются по 4 в углах и дают
    // десятки коротких размеров, в которых тонет остальная присадка. Их
    // положение — в файлах для ЧПУ (CSV/DXF), как и раньше; на листе они
    // только показаны цветом (см. сноску под таблицей).
    const dimmable = otherRest.filter((h) => h.kind !== 'legFix');
    const face = dimmable.filter((h) => h.side !== 'edge');
    if (face.length) chainX(uniq(face.map((h) => h.x)), 'bottom');
    if (dimmable.length) chainY(uniq(dimmable.map((h) => h.y)), 'left');
  }

  // Раскладываем по уровням и рисуем. Уровень 0 занят габаритом детали
  // снизу и справа, поэтому там начинаем с первого.
  const draw = {
    bottom: (d) => dimH(d.a, d.b, BOTTOM, d.level, d.label, 1),
    top: (d) => dimH(d.a, d.b, TOP, d.level, d.label, -1),
    right: (d) => dimV(d.a, d.b, RIGHT, d.level, d.label, 1),
    left: (d) => dimV(d.a, d.b, LEFT, d.level, d.label, -1),
  };
  // Сначала цепочка присадки (уровень 0 — ближе всего к детали), габарит
  // детали вынесет наружу вызывающий код, см. levels.
  const levels = { bottom: 0, top: 0, right: 0, left: 0 };
  for (const side of ['bottom', 'top', 'right', 'left']) {
    const items = packDims(dims[side], 0);
    let L = 0;
    for (const d of items) L = Math.max(L, d.level + 1);
    // Подписи, которые не помещаются на своём звене (короткие размеры),
    // выносим наружу за все размерные линии, в свои ряды: каждая подпись —
    // в первом ряду, где не налезает на соседние. Тонкая выноска ведёт к звену.
    const horiz = side === 'bottom' || side === 'top';
    const dirS = (side === 'bottom' || side === 'right') ? 1 : -1;
    const tight = items.filter((d) => Math.abs(d.b - d.a) < String(d.label).length * 5.6 + 3)
      .sort((u, v) => (u.a + u.b) - (v.a + v.b));
    const rowsOcc = [];
    for (const d of tight) {
      const w = String(d.label).length * 5.6 + 3, mid = (d.a + d.b) / 2;
      let k = 0;
      for (;; k++) {
        if (!rowsOcc[k]) rowsOcc[k] = [];
        if (!rowsOcc[k].some((o) => mid - w / 2 < o[1] + 1 && mid + w / 2 > o[0] - 1)) break;
      }
      rowsOcc[k].push([mid - w / 2, mid + w / 2]);
      d.row = k + 1;
    }
    for (const d of items) {
      if (!d.row) { body += draw[side](d); continue; }
      const lbl = d.label;
      d.label = '';
      body += draw[side](d);
      const mid = (d.a + d.b) / 2;
      const off = DIM_FIRST + L * DIM_STEP + (d.row - 1) * 10;
      const lineOff = DIM_FIRST + d.level * DIM_STEP;
      if (horiz) {
        const yBase = side === 'bottom' ? BOTTOM : TOP;
        body += line(mid, yBase + dirS * lineOff, mid, yBase + dirS * (off + 1), 'dw-ext');
        body += text(mid, yBase + dirS * off + (dirS > 0 ? 9 : -2), lbl, 'dw-dt', 'middle');
      } else {
        const xBase = side === 'right' ? RIGHT : LEFT;
        body += line(xBase + dirS * lineOff, mid, xBase + dirS * (off + 1), mid, 'dw-ext');
        const tx = xBase + dirS * off + (dirS > 0 ? 9 : -2);
        body += `<text x="${r(tx)}" y="${r(mid)}" class="dw-dt" text-anchor="middle" transform="rotate(-90 ${r(tx)} ${r(mid)})">${esc(lbl)}</text>`;
      }
    }
    levels[side] = L + (rowsOcc.length ? Math.ceil(rowsOcc.length * 10 / DIM_STEP) : 0);
  }
  facadeHoles.levels = levels;

  if (otherRest.length && !hg) {
    const o0 = otherRest[0];
    const label = o0.through ? `Ø${o0.d} насквозь` : `Ø${o0.d} глуб. ${o0.depth}`;
    body += text(px(o0.x), py(o0.y) - 6, label, 'dw-t', 'middle');
  }
  return body;
}

// ВЫНОСНОЙ ЭЛЕМЕНТ «А» — узел крепления петли алюм. рамки (Blum 71T950A)
// в увеличенном виде: кусок стойки рамки у нижней петли, паз под механизм,
// 2 отверстия под саморезы с фаской и их размеры. На всём фасаде эти
// 5–16 мм не прочитать, а цеху/заказу профиля они нужны точно.
// Все числа — из самой детали (p.holes / p.grooves / p.frameW), не константы.
// Возвращает '' если у детали нет такой присадки.
function aluHingeNode(p) {
  const screws = (p.holes || []).filter((h) => h.kind === 'aluHingeScrew');
  const slots = (p.grooves || []).filter((g) => g.kind === 'aluHingeSlot');
  if (!screws.length || !(p.frameW > 0)) return '';
  const hyOf = (h) => (h.hingeY != null ? h.hingeY : h.y);
  const hy = Math.min.apply(null, screws.map(hyOf));
  const sc = screws.filter((h) => Math.abs(hyOf(h) - hy) < 0.05);
  const sl = slots.filter((g) => Math.abs((g.hingeY != null ? g.hingeY : (g.y0 + g.y1) / 2) - hy) < 0.05)[0] || null;
  const left = sc[0].x < p.length / 2;
  const xIn = left ? p.frameW : p.length - p.frameW;      // внутренний край рамки
  const xOut = left ? 0 : p.length;                       // наружный край фасада
  // Окно узла (мм детали): стойка рамки + 8 мм заполнения, ±22 мм от оси петли.
  const xmin = left ? 0 : p.length - p.frameW - 8;
  const xmax = left ? p.frameW + 8 : p.length;
  const ymin = hy - 22, ymax = hy + 22;
  const S = 6;                                            // px на мм
  const PADX = 60, PADY = 52;
  const NX = (x) => PADX + (x - xmin) * S;
  const NY = (y) => PADY + (ymax - y) * S;
  const W = (xmax - xmin) * S + 2 * PADX, H = (ymax - ymin) * S + 2 * PADY;
  let b = '';
  // Наружный край фасада — основная линия, внутренний край рамки (граница
  // с заполнением) — тонкая; сверху и снизу — линии обрыва (тонкие).
  b += line(NX(xOut), NY(ymax), NX(xOut), NY(ymin), 'dw-wire');
  b += line(NX(xIn), NY(ymax), NX(xIn), NY(ymin), 'dw-thin');
  b += line(NX(xmin), NY(ymax), NX(xmax), NY(ymax), 'dw-thin');
  b += line(NX(xmin), NY(ymin), NX(xmax), NY(ymin), 'dw-thin');
  // ось петли
  b += line(NX(xmin) - 6, NY(hy), NX(xmax) + 6, NY(hy), 'dw-axis');
  // паз
  let slA = null, slB = null;   // края паза по X (мм детали)
  if (sl) {
    const half = sl.w / 2;
    slA = sl.x0 - half; slB = sl.x0 + half;
    const ya = Math.min(sl.y0, sl.y1), yb = Math.max(sl.y0, sl.y1);
    b += rect(NX(slA), NY(yb), (slB - slA) * S, (yb - ya) * S, 'dw-hole');
  }
  // отверстия: Ø отверстия + концентрическая Ø фаски
  const xs = sc[0].x;
  for (const h of sc) {
    const cx = NX(h.x), cy = NY(h.y);
    const rc = (h.csk > h.d ? h.csk : h.d) / 2 * S;
    if (h.csk > h.d) b += `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(rc)}" class="dw-thin" style="fill:none"/>`;
    b += `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(h.d / 2 * S)}" class="dw-hole"/>`;
    b += line(cx - rc - 4, cy, cx + rc + 4, cy, 'dw-axis');
  }
  const ysc = sc.map((h) => h.y).sort((a, c) => a - c);
  b += line(NX(xs), NY(ysc[ysc.length - 1]) - 26, NX(xs), NY(ysc[0]) + 26, 'dw-axis');

  // --- размеры ---
  const TOP = NY(ymax), BOT = NY(ymin);
  const fillSide = left ? NX(xmax) : NX(xmin);            // сторона заполнения
  const dirV = left ? 1 : -1;
  // от внутреннего края рамки до центров отверстий (сверху)
  b += line(NX(xs), NY(ysc[ysc.length - 1]), NX(xs), TOP, 'dw-ext');
  b += dimH(Math.min(NX(xs), NX(xIn)), Math.max(NX(xs), NX(xIn)), TOP, 0, mm1(Math.abs(xIn - xs)), -1);
  if (sl) {
    // ширина паза — от внутреннего края рамки (снизу)
    const xFar = left ? slA : slB;
    const ya = Math.min(sl.y0, sl.y1), yb = Math.max(sl.y0, sl.y1);
    b += line(NX(xFar), NY(ya), NX(xFar), BOT, 'dw-ext');
    // подпись — сама ширина паза w (паз по паспорту идёт от внутреннего края
    // рамки; координата оси в engine.js округлена до 0.1, и разность дала бы
    // 16.4 вместо 16.5)
    b += dimH(Math.min(NX(xFar), NX(xIn)), Math.max(NX(xFar), NX(xIn)), BOT, 0, mm1(sl.w), 1);
    // длина паза — со стороны заполнения, ближе к детали
    const xNear = left ? slB : slA;
    b += line(NX(xNear), NY(yb), fillSide, NY(yb), 'dw-ext') + line(NX(xNear), NY(ya), fillSide, NY(ya), 'dw-ext');
    b += dimV(NY(yb), NY(ya), fillSide, 0, mm1(yb - ya), dirV);
  }
  if (sc.length > 1) {
    // шаг саморезов — там же, следующим уровнем
    const y0 = ysc[0], y1 = ysc[ysc.length - 1];
    b += line(NX(xs), NY(y1), fillSide, NY(y1), 'dw-ext') + line(NX(xs), NY(y0), fillSide, NY(y0), 'dw-ext');
    b += dimV(NY(y1), NY(y0), fillSide, sl ? 1 : 0, mm1(y1 - y0), dirV);
  }
  // линия-выноска на верхнее отверстие: «2 отв. Ø5»
  const h0 = sc[sc.length - 1];
  const rc0 = (h0.csk > h0.d ? h0.csk : h0.d) / 2 * S;
  const lx0 = NX(h0.x) + (left ? -1 : 1) * rc0 * 0.7, ly0 = NY(h0.y) - rc0 * 0.7;
  const lx1 = NX(xOut) + (left ? -18 : 18), ly1 = TOP - 30;
  const shelf = left ? -44 : 44;
  b += line(lx0, ly0, lx1, ly1, 'dw-thin') + line(lx1, ly1, lx1 + shelf, ly1, 'dw-thin');
  b += text(lx1 + shelf / 2, ly1 - 3, `${sc.length} отв. Ø${mm1(h0.d)}`, 'dw-t', 'middle');
  // Атрибут перед width — чтобы unifyBlocks() не растягивал выносной
  // элемент до формата листа соседних чертежей (он у нас свой, маленький).
  const svg = svgTag(W, H, b).replace('<svg width=', '<svg data-node="A" width=');
  return `<div class="dw-note">А (увеличено) — узел петли ${esc(aluHingeTitle())}, присадка с тыльной стороны</div>${svg}`;
}

// Таблица присадки алюм. рамки под петлю — что и сколько делать на этом
// фасаде (для заказа у производителя или цеха). '' — такой присадки нет.
function aluHingeTable(p) {
  const screws = (p.holes || []).filter((h) => h.kind === 'aluHingeScrew');
  const slots = (p.grooves || []).filter((g) => g.kind === 'aluHingeSlot');
  if (!screws.length && !slots.length) return '';
  const wallTxt = (o) => (o.throughWall ? `сквозь тыльную стенку профиля${o.depth ? ` ${mm1(o.depth)}` : ''}` : '');
  const rows = [];
  if (slots.length) {
    const z = slotSize(slots[0]);
    rows.push(['▭', `Паз ${mm1(z.a)}×${mm1(z.b)} под механизм петли ${aluHingeTitle()}`, slots.length, wallTxt(slots[0])]);
  }
  if (screws.length) {
    const h = screws[0];
    let t = `Ø${mm1(h.d)}`;
    if (h.csk > h.d) t += `, зенк.${h.cskAngle ? ` ${h.cskAngle}°` : ''} до Ø${mm1(h.csk)}`;
    rows.push(['◎', `Отверстие под саморез ${t}`, screws.length, wallTxt(h)]);
  }
  return `<table class="dw-legend"><thead><tr><th>Обозн.</th><th>Присадка (с тыльной стороны)</th>`
    + `<th>Кол.</th><th>Примечание</th></tr></thead><tbody>`
    + rows.map((x) => `<tr><td>${x[0]}</td><td>${esc(x[1])}</td><td>${x[2]}</td><td>${esc(x[3])}</td></tr>`).join('')
    + `</tbody></table>`;
}

// СКВОЗНЫЕ ВЫРЕЗЫ ДЕТАЛИ (part.notches, engine.js): выпил под монтажную
// шину в верхнем заднем углу боковины навесного модуля (railNotch) и вырезы
// под крюк навески в задней стенке (hangerBackCut). Координаты — те же, что
// у присадки на чертеже детали: x — по длине слева, y — по ширине снизу.
const NOTCH_TITLE = {
  railNotch: 'Выпил под монтажную шину',
  hangerBackCut: 'Вырез под крюк навески',
};
function partNotches(p) {
  const L = Number(p.length) || 0, Wd = Number(p.width) || 0;
  const out = [];
  for (const n of (p.notches || [])) {
    const cl = (v, m) => Math.min(Math.max(v, 0), m);
    const xa = cl(Math.min(n.x0, n.x1), L), xb = cl(Math.max(n.x0, n.x1), L);
    const ya = cl(Math.min(n.y0, n.y1), Wd), yb = cl(Math.max(n.y0, n.y1), Wd);
    if (xb - xa > 0.01 && yb - ya > 0.01) out.push({ kind: n.kind, note: n.note, xa, xb, ya, yb });
  }
  return out;
}
// Размер выреза на детали (то, что фрезеруется): по длине × по ширине.
function notchSizeText(n) { return `${mm1(n.xb - n.xa)}×${mm1(n.yb - n.ya)}`; }
// Сводка вырезов для подписи под чертежом: «2× Вырез под крюк навески 30×33».
function notchSummary(p) {
  const by = {};
  for (const n of partNotches(p)) {
    const k = `${NOTCH_TITLE[n.kind] || 'Вырез'} ${notchSizeText(n)} насквозь`;
    by[k] = (by[k] || 0) + 1;
  }
  return Object.keys(by).map((k) => `${by[k]}×${k}`).join(', ');
}
// Контур детали: прямоугольник, а при сквозных вырезах — ломаная по их
// краям (контур собирается из отрезков сторон минус участки вырезов и
// внутренних сторон вырезов, отрезки сцепляются в замкнутые петли).
function partContour(p, x0, y0, fw, fh, scale, cls) {
  const ns = partNotches(p);
  if (!ns.length) return rect(x0, y0, fw, fh, cls);
  const L = Number(p.length) || 0, Wd = Number(p.width) || 0;
  const E = 0.01;
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
  cut(0, L, ns.filter((n) => n.yb >= Wd - E).map((n) => [n.xa, n.xb])).forEach((g) => segs.push([[g[0], Wd], [g[1], Wd]]));
  cut(0, Wd, ns.filter((n) => n.xa <= E).map((n) => [n.ya, n.yb])).forEach((g) => segs.push([[0, g[0]], [0, g[1]]]));
  cut(0, Wd, ns.filter((n) => n.xb >= L - E).map((n) => [n.ya, n.yb])).forEach((g) => segs.push([[L, g[0]], [L, g[1]]]));
  for (const n of ns) {
    if (n.xa > E) segs.push([[n.xa, n.ya], [n.xa, n.yb]]);
    if (n.xb < L - E) segs.push([[n.xb, n.ya], [n.xb, n.yb]]);
    if (n.ya > E) segs.push([[n.xa, n.ya], [n.xb, n.ya]]);
    if (n.yb < Wd - E) segs.push([[n.xa, n.yb], [n.xb, n.yb]]);
  }
  const key = (q) => `${Math.round(q[0] * 10)}|${Math.round(q[1] * 10)}`;
  const used = segs.map(() => false);
  const X = (v) => x0 + v * scale, Y = (v) => y0 + fh - v * scale;
  let d = '';
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
    d += 'M' + pts.map((q) => `${r(X(q[0]))},${r(Y(q[1]))}`).join(' L') + ' Z ';
  }
  return `<path class="${cls}" fill-rule="evenodd" d="${d.trim()}"/>`;
}
// Размеры сквозных вырезов — внутри детали, от сторон выреза вглубь: длина
// выреза (по x) и его ширина (по y).
function notchDims(p, x0, y0, fw, fh, scale) {
  const ns = partNotches(p);
  if (!ns.length) return '';
  const L = Number(p.length) || 0;
  const X = (v) => x0 + v * scale, Y = (v) => y0 + fh - v * scale;
  let b = '';
  for (const n of ns) {
    // Горизонтальный размер — у той стороны выреза, что внутри детали.
    const atBottom = n.ya <= 0.01;
    const yIn = atBottom ? n.yb : n.ya;
    b += dimH(X(n.xa), X(n.xb), Y(yIn), 0, mm1(n.xb - n.xa), atBottom ? -1 : 1);
    const atRight = n.xb >= L - 0.01;
    const xIn = atRight ? n.xa : n.xb;
    b += dimV(Y(n.yb), Y(n.ya), X(xIn), 0, mm1(n.yb - n.ya), atRight ? -1 : 1);
  }
  return b;
}

// Чертежи ДЕТАЛЕЙ: фасады и любые другие детали с присадкой или пазом.
// Раньше свой лист был только у фасада, и присадку остальных деталей
// (стенки ящика, боковины, планки) на чертежах было просто не видно.
// Размер «ячейки» листа детали в px — вся рамка листа (530×340 с границей):
// надписей сверху нет, всё (позиция, материал, кромка, масштаб) — в таблице
// в правом нижнем углу, так чертёж получается крупнее.
const PART_CELL_W = 528, PART_CELL_H = 338;
// Масштаб листов деталей — ОДИН на все детали (чтобы не путать размеры), из
// ряда круглых знаменателей (чем мельче шаг, тем крупнее деталь). Мм бумаги на один px чертежа (при печати 100%).
const PART_MM = 25.4 / 96;
const PART_STD_N = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 25, 30, 35, 40, 50, 75, 100];
// Детали длиннее этого (столешница, длинная планка, цоколь) не тянут общий
// масштаб вниз: они получают свой, мельче, и он явно написан в таблице.
const PART_NORMAL_LEN = 1200;
// Две таблицы внизу листа РЯДОМ: присадка слева, штамп справа; вместе — во всю ширину ячейки.
const HOLE_TBL_W = 250, STAMP_W = 278, STAMP_LABEL_W = 54;

const FACADE_PICK = (p) => FACADE_KINDS[p.kind];
const DRILLED_PICK = (p) => !FACADE_KINDS[p.kind] && !p.hardware
  && (((p.holes || []).length) || ((p.grooves || []).length) || ((p.notches || []).length));

// Знаменатель стандартного масштаба, при котором деталь ещё влезает
// (fit — наибольший масштаб в px/мм, при котором она влезает в ячейку).
function stdN(fit) {
  const need = 1 / (Math.max(fit, 1e-6) * PART_MM);
  for (const n of PART_STD_N) if (n >= need - 1e-9) return n;
  return PART_STD_N[PART_STD_N.length - 1];
}
const nToScale = (n) => 1 / (n * PART_MM);

// Одинаковые детали — один чертёж. Одинаковыми считаются детали с тем же
// габаритом, материалом, толщиной И той же присадкой: сверлить их будут
// по одному шаблону. В таблице перечисляются все их позиции.
function partGroupsOf(model, pick) {
  const list = model.partsRaw.filter(pick);
  const sign = (f) => [
    Math.round(f.length), Math.round(f.width), f.thickness, f.material,
    // Алюминиевые фасады с разной рамкой/заполнением — разные чертежи.
    f.aluFrame ? `alu:${f.aluFrame.profile}:${f.frameW}:${f.aluFrame.fill}` : '',
    (f.holes || []).map((h) => `${h.kind}:${h.x}:${h.y}:${h.d}:${h.depth || 0}`)
      .sort().join('|'),
    // Сквозные вырезы (выпил под шину, вырез под крюк) — тоже по шаблону.
    (f.notches || []).map((n) => `${n.kind}:${n.x0}:${n.y0}:${n.x1}:${n.y1}`).sort().join('|'),
  ].join('/');
  const groups = {};
  const order = [];
  for (const f of list) {
    const k = sign(f);
    if (!groups[k]) { groups[k] = { part: f, qty: 0, nums: [], members: [] }; order.push(k); }
    groups[k].qty += 1;
    if (f.moduleUid && f.anchorKey) groups[k].members.push(`${f.moduleUid}|${f.anchorKey}`);
    if (f.num != null && groups[k].nums.indexOf(f.num) === -1) groups[k].nums.push(f.num);
  }
  return order.map((k) => groups[k]);
}

// Таблица «ключ — значение» (штамп листа детали): позиция, материал, модуль,
// кромка, масштаб. Лежит под таблицей присадки, вплотную к углу рамки.
function svgKV(x, y, w, labelW, rows) {
  const RH = 14, FS = 9;
  const h = rows.length * RH;
  let o = `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" class="dw-legbg"/>`
    + `<rect x="${r(x)}" y="${r(y)}" width="${r(labelW)}" height="${r(h)}" class="dw-legh"/>`
    + line(x + labelW, y, x + labelW, y + h, 'dw-thin');
  rows.forEach((row, i) => {
    if (i) o += line(x, y + i * RH, x + w, y + i * RH, 'dw-thin');
    const t = String(row[1]);
    const fit = t.length * FS * 0.55 > w - labelW - 6
      ? ` textLength="${r(w - labelW - 6)}" lengthAdjust="spacingAndGlyphs"` : '';
    o += `<text x="${r(x + 3)}" y="${r(y + i * RH + RH - 4)}" class="dw-lth">${esc(row[0])}</text>`
      + `<text x="${r(x + labelW + 3)}" y="${r(y + i * RH + RH - 4)}" class="dw-lt"${fit}>${esc(t)}</text>`;
  });
  return { svg: o, w, h };
}

// Строки штампа детали.
function partStampRows(p, g, scaleText) {
  const mat = p.material ? materialTitle(p.material) : '';
  const aluProf = p.aluFrame && window.Modul3D && window.Modul3D.catalog
    && window.Modul3D.catalog.ALU_PROFILES
    ? window.Modul3D.catalog.ALU_PROFILES[p.aluFrame.profile] : null;
  const aluKnownW = !!(aluProf && aluProf.width > 0);
  const aluSl = (p.grooves || []).filter((q) => q.kind === 'aluHingeSlot');
  const otherGr = (p.grooves || []).filter((q) => q.kind !== 'aluHingeSlot');
  const extra = [
    (p.holes || []).length && !holeGroups(p) ? `присадка: ${holeSummary(p)}` : '',
    partNotches(p).length ? `вырезы: ${notchSummary(p)}` : '',
    otherGr.length ? `паз ${otherGr[0].w}×${otherGr[0].depth} мм` : '',
    aluSl.length ? `${aluSl.length}×${aluSlotText(aluSl[0])}` : '',
  ].filter(Boolean).join(' · ');
  const rows = [
    ['Деталь', `Поз. ${g.nums.slice().sort((a, b) => a - b).join(', ')} · ${p.name} · ${g.qty} шт`],
    ['Материал', mat || '—'],
    ['Модуль', `${p.module} · ${p.section}`],
    p.aluFrame
      ? ['Профиль', `алюм. ${p.aluFrame.profile || ''}, ${aluKnownW ? `рамка ${Math.round((p.frameW || 0) * 10) / 10} мм` : 'рамка — по паспорту'}, без кромки`]
      : ['Кромка', `${(p.edging && p.edging.long1) || '—'} по периметру`],
  ];
  if (extra) rows.push(['Доп.', extra]);
  rows.push(['Масштаб', scaleText]);
  return rows;
}

// Раскладка листа детали: масштаб и поля подбираем итерациями — число
// размерных линий (а с ним и поля) зависит от масштаба. cap — наибольший
// допустимый масштаб (px/мм); tbl — размер блока таблиц в правом углу.
function partLayout(p, hg, tbl, cap) {
  const padOf = (n) => (n ? DIM_FIRST + n * DIM_STEP + 14 : 16);
  const probeLv = (sc) => {
    facadeHoles.levels = null;
    facadeHoles(p, 0, 0, p.length * sc, p.width * sc, sc, hg);
    return facadeHoles.levels || { bottom: 0, top: 0, right: 0, left: 0 };
  };
  const layoutFor = (sc) => {
    const lvl = probeLv(sc);
    const PL0 = padOf(lvl.left), PT0 = padOf(lvl.top);
    const PR0 = padOf(lvl.right + 1), PB0 = padOf(lvl.bottom + 1);
    // Таблицы всегда внизу листа (в правом нижнем углу), чертёж над ними.
    const fitScale = (extraW, extraH) => Math.max(0.02, Math.min(cap,
      (PART_CELL_W - PL0 - PR0 - extraW) / Math.max(p.length, 1),
      (PART_CELL_H - PT0 - PB0 - extraH) / Math.max(p.width, 1)));
    return { PL0, PT0, PR0, PB0, scale: fitScale(0, tbl.h + 8) };
  };
  let scale = Math.max(0.02, Math.min(cap,
    (PART_CELL_W - 30) / Math.max(p.length, 1),
    (PART_CELL_H - tbl.h - 30) / Math.max(p.width, 1)));
  let lay = layoutFor(scale);
  for (let it = 0; it < 6 && lay.scale < scale - 0.0005; it++) {
    scale = lay.scale;
    lay = layoutFor(scale);
  }
  lay.scale = Math.min(scale, lay.scale);
  return lay;
}

// Размер блока таблиц детали: таблица присадки (если есть) и штамп рядом;
// высота блока — по более высокой из них.
function partTblSize(p, g, hg) {
  const stamp = partStampRows(p, g, '1:1');
  const hl = hg ? holeLegendSvg(hg) : null;
  const sh = stamp.length * 14;
  const hh = hl ? hl.h : 0;
  return { w: STAMP_W + (hl ? HOLE_TBL_W : 0), h: Math.max(sh, hh), hh, sh };
}

// Общий знаменатель масштаба листов деталей проекта (см. PART_NORMAL_LEN).
function commonPartN(model) {
  const items = [];
  for (const pick of [FACADE_PICK, DRILLED_PICK]) {
    for (const g of partGroupsOf(model, pick)) {
      const p = g.part, hg = holeGroups(p);
      const lay = partLayout(p, hg, partTblSize(p, g, hg), Infinity);
      items.push({ n: stdN(lay.scale), len: p.length });
    }
  }
  if (!items.length) return 1;
  const normal = items.filter((it) => it.len <= PART_NORMAL_LEN);
  return Math.max.apply(null, (normal.length ? normal : items).map((it) => it.n));
}

function buildPartDrawings(model, baseScale, pick, emptyText) {
  const grps = partGroupsOf(model, pick);
  if (!grps.length) return `<div class="dw-empty">${emptyText}</div>`;
  const nCommon = commonPartN(model);

  return grps.map((g) => {
    const p = g.part;
    // Лист детали — ячейка ОДНОГО размера (PART_CELL_*): все рамки одинаковые,
    // на A4 помещается 2×2. Масштаб — общий на все детали (или свой, мельче,
    // для очень длинных); он вписан в таблицу в углу листа.
    const hg = holeGroups(p);
    const tbl = partTblSize(p, g, hg);
    const fitLay = partLayout(p, hg, tbl, Infinity);
    const N = Math.max(nCommon, stdN(fitLay.scale));
    const scale = nToScale(N);
    const lay = partLayout(p, hg, tbl, scale);
    const { PL0, PT0, PR0, PB0 } = lay;
    const scaleText = `1:${N}`;
    // Чертёж ДЕТАЛИ строится по её собственным габаритам (длина × ширина),
    // а не по мировому боксу: у модуля, повёрнутого на 90°, бокс развёрнут
    // вместе с корпусом, и фасад выходил на чертеже «на боку».
    const fw = p.length * scale, fh = p.width * scale;
    // Холст — вся ячейка листа: чертёж стоит по центру свободной области, а
    // таблицы — строго в правом нижнем углу ячейки.
    const W = PART_CELL_W, H = PART_CELL_H;
    const availW = W;
    const availH = H - (tbl.h + 8);
    const PAD_L = PL0 + Math.max(0, (availW - (PL0 + fw + PR0)) / 2);
    const PAD_T = PT0 + Math.max(0, (availH - (PT0 + fh + PB0)) / 2);
    // Контур детали — с учётом сквозных вырезов (part.notches).
    let body = partContour(p, PAD_L, PAD_T, fw, fh, scale, 'dw-facade');
    // Алюминиевый фасад из профиля (engine.js, part.aluFrame): внутренний
    // контур рамки шириной frameW — граница профиля и заполнения. Рисуем его
    // только если ширина рамки реально указана у профиля в каталоге
    // (ALU_PROFILES[код].width): иначе engine.js берёт запасную ширину, и
    // рисовать по ней контур (и писать её в подписи) было бы выдумкой.
    const aluProf = p.aluFrame && window.Modul3D && window.Modul3D.catalog
      && window.Modul3D.catalog.ALU_PROFILES
      ? window.Modul3D.catalog.ALU_PROFILES[p.aluFrame.profile] : null;
    const aluKnownW = !!(aluProf && aluProf.width > 0);
    const aluFw = (p.aluFrame && aluKnownW && p.frameW > 0) ? p.frameW * scale : 0;
    if (aluFw > 0 && fw > 2 * aluFw && fh > 2 * aluFw) {
      body += rect(PAD_L + aluFw, PAD_T + aluFw, fw - 2 * aluFw, fh - 2 * aluFw, 'dw-drawer');
    }
    body += callout(PAD_L + fw / 2, PAD_T + fh / 2, p.num);
    // Сначала цепочка присадки — она ближе к детали, потом габарит снаружи.
    body += facadeHoles(p, PAD_L, PAD_T, fw, fh, scale, hg);
    const usedLv = facadeHoles.levels || { bottom: 0, right: 0 };
    body += notchDims(p, PAD_L, PAD_T, fw, fh, scale);
    body += dimH(PAD_L, PAD_L + fw, PAD_T + fh, usedLv.bottom || 0, String(p.length));
    body += dimV(PAD_T, PAD_T + fh, PAD_L + fw, usedLv.right || 0, String(p.width));
    // Ручная разметка: деталь нарисована в СВОИХ координатах (длина × ширина,
    // снизу вверх, как в facadeHoles), а не мировым боксом. Поэтому для
    // markup.js — одна «строка» с боксом в этих локальных координатах и своя
    // проекция центров отверстий (holeScreen) — ровно по px/py facadeHoles.
    const mkSheet = p.moduleUid && p.anchorKey ? `part:${p.moduleUid}|${p.anchorKey}` : '';
    const mkBody = mkAttach(mkSheet, model, partLocalViews(p, PAD_L, PAD_T, fw, fh, scale, g.members), W, H, body);
    body += mkBody;
    // Таблицы в правом нижнем углу листа: присадка слева, штамп справа
    // (координаты абсолютные, без transform: svgFit считает границы по ним).
    if (hg) body += holeLegendSvg(hg, W - STAMP_W - HOLE_TBL_W, H - tbl.hh).svg;
    body += svgKV(W - STAMP_W, H - tbl.sh, STAMP_W, STAMP_LABEL_W, partStampRows(p, g, scaleText)).svg;
    // Выносной элемент «А» и таблица присадки петли алюм. рамки (если есть).
    const aluNode = aluHingeNode(p);
    const aluTable = aluHingeTable(p);
    // Холст листа детали — ровно размер ячейки (viewBox 0 0 W H, без полей
    // svgFit): таблицы лежат вплотную к углу рамки.
    const exact = (tag) => tag.replace(/<svg width="[^"]+" height="[^"]+" viewBox="[^"]+"/,
      `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"`);
    const svgOut = exact(svgTagMk(W, H, body, mkBody ? mkSheet : ''));
    return `<div class="dw-block dw-partsheet${(aluNode || aluTable) ? ' dw-partwide' : ''}">
      ${(aluNode || aluTable)
        ? `<div class="dw-secrow">${svgOut}<div class="dw-node">${aluNode}${aluTable}</div></div>`
        : svgOut}
    </div>`;
  }).join('');
}

function buildFacadeDrawings(model, scale) {
  return buildPartDrawings(model, scale, FACADE_PICK, 'Фасадов в проекте нет.');
}

// Все НЕфасадные детали, на которых есть присадка или паз: боковины, дно,
// планки, стенки ящиков. По ним сверлят, значит им нужен свой чертёж.
function buildDrilledPartDrawings(model, scale) {
  return buildPartDrawings(model, scale, DRILLED_PICK, 'Деталей с присадкой в проекте нет.');
}

// ---------------------------------------------------------------------------
// РЕДАКТОР ДЕТАЛИ — Этап 1 (см. общий план визуального редактора вырезов).
// Статичный плоский вид ОДНОЙ детали в реальных пропорциях: контур, размеры
// длины/ширины, уже посчитанная присадка и пазы. Кликов/перетаскивания тут
// нет — это фундамент, на который лягут направляющие линии, привязки и
// построение фигур (следующие этапы). Геометрия и стиль — те же помощники,
// что и в buildPartDrawings/facadeHoles, чтобы вид не отличался от печатных
// чертежей.
// ---------------------------------------------------------------------------

// Прямоугольник паза по его оси (x0,y0)-(x1,y1) и ширине w: паз идёт по
// половине ширины в каждую сторону от оси — тот же принцип, что использует
// 3D-вьюер при вырезании паза из меша (см. viewer.js, «along ? … : … ± half»).
// Отдельного SVG-примитива для паза раньше не было в этом файле, поэтому
// он вынесен маленьким переиспользуемым помощником.
function grooveRects(p, x0, y0, fw, fh, scale) {
  const grooves = p.grooves || [];
  if (!grooves.length) return '';
  const px = (v) => x0 + v * scale;
  const py = (v) => y0 + fh - v * scale;   // деталь снизу вверх, как в facadeHoles
  let body = '';
  for (const g of grooves) {
    const half = (g.w || 4) / 2;
    // Паз почти всегда идёт вдоль одной из осей детали (x0===x1 либо
    // y0===y1) — по оси откладываем длину паза, поперёк — половину ширины.
    const horiz = Math.abs(g.y1 - g.y0) < 0.01;
    let xa, xb, ya, yb;
    if (horiz) {
      xa = Math.min(g.x0, g.x1); xb = Math.max(g.x0, g.x1);
      ya = g.y0 - half; yb = g.y0 + half;
    } else {
      ya = Math.min(g.y0, g.y1); yb = Math.max(g.y0, g.y1);
      xa = g.x0 - half; xb = g.x0 + half;
    }
    const gx = px(xa), gy = py(yb), gw = (xb - xa) * scale, gh = (yb - ya) * scale;
    body += rect(gx, gy, gw, gh, 'dw-open');
    body += text(gx + gw / 2, gy - 3, g.kind === 'aluHingeSlot' ? `паз ${mm1(g.w)}×${mm1(slotSize(g).b)}`
      : `${g.note || 'паз'} ${g.w}×${g.depth}`, 'dw-t', 'middle');
  }
  return body;
}

// Декоративная фоновая сетка — ТОЛЬКО зрительная подсказка масштаба и
// пропорций детали. Она НЕ имеет отношения к системе 32 мм и НЕ участвует в
// привязке курсора: точность в редакторе будут давать направляющие линии и
// ввод точных чисел (следующие этапы), не эта сетка. Поэтому линии сделаны
// тонкими и полупрозрачными и помечены pointer-events:none — они не должны
// перехватывать клики, когда в следующих этапах появится интерактив.
function partGrid(x0, y0, fw, fh, lenMM, widMM, scale, minorMM, majorMM) {
  const styleFor = (major) =>
    `stroke:var(--border-strong);stroke-width:${major ? 0.6 : 0.3};` +
    `opacity:${major ? 0.5 : 0.22};pointer-events:none`;
  let body = '';
  for (let mm = minorMM; mm < lenMM - 0.5; mm += minorMM) {
    const x = x0 + mm * scale;
    const major = Math.round(mm) % majorMM === 0;
    body += `<line x1="${r(x)}" y1="${r(y0)}" x2="${r(x)}" y2="${r(y0 + fh)}" style="${styleFor(major)}"/>`;
  }
  for (let mm = minorMM; mm < widMM - 0.5; mm += minorMM) {
    const y = y0 + fh - mm * scale;
    const major = Math.round(mm) % majorMM === 0;
    body += `<line x1="${r(x0)}" y1="${r(y)}" x2="${r(x0 + fw)}" y2="${r(y)}" style="${styleFor(major)}"/>`;
  }
  return body;
}

// Собственно вид детали для редактора. Принимает ОДИН объект детали (как
// хранится в model.partsRaw: p.length/p.width/p.holes/p.grooves) и опции:
//   opts.scale     — px на мм (по умолчанию подбирается по большей стороне
//                     детали под ~560px; сам подбор под контейнер экрана —
//                     дело вызывающего кода, это лишь разумный дефолт);
//   opts.showGrid  — false, чтобы отключить декоративную сетку (по умолчанию true);
//   opts.gridMinor — шаг тонких линий сетки в мм (по умолчанию 50);
//   opts.gridMajor — шаг контрастных линий сетки в мм (по умолчанию 250).
// Возвращает готовую строку <svg …>…</svg> (как svgTag), без обёртки
// dw-block/заголовка — макет экрана редактора собирает вызывающий код.
function buildPartEditorView(part, opts) {
  opts = opts || {};
  const p = part;
  const scale = opts.scale || Math.min(4, TARGET / Math.max(p.length, p.width, 1));
  const fw = p.length * scale, fh = p.width * scale;

  // Поля вокруг детали — под размерные цепочки присадки (если она есть) и
  // под сами габаритные размеры снизу/справа, как в buildPartDrawings.
  const lv = (p.holes && p.holes.length) ? 4 : 0;
  const PAD = DIM_FIRST + lv * DIM_STEP + 22;
  const PAD_L = lv ? PAD : 20;
  const PAD_T = lv ? PAD : 20;
  const PAD_R = PAD;
  const PAD_B = PAD;
  const W = fw + PAD_L + PAD_R, H = fh + PAD_T + PAD_B;

  let body = '';
  if (opts.showGrid !== false) {
    body += partGrid(PAD_L, PAD_T, fw, fh, p.length, p.width, scale,
      opts.gridMinor || 50, opts.gridMajor || 250);
  }
  // Контур детали — тот же класс dw-facade, что у печатного чертежа детали,
  // чтобы редактор визуально не отличался от остальных чертежей проекта.
  body += partContour(p, PAD_L, PAD_T, fw, fh, scale, 'dw-facade');
  // Присадка и пазы — переиспользуем те же расчёты, что идут в деталировку
  // и в 3D (facadeHoles уже строит размерные цепочки от кромок до отверстий).
  body += facadeHoles(p, PAD_L, PAD_T, fw, fh, scale);
  const usedLv = facadeHoles.levels || { bottom: 0, right: 0 };
  body += grooveRects(p, PAD_L, PAD_T, fw, fh, scale);
  body += notchDims(p, PAD_L, PAD_T, fw, fh, scale);
  // Габаритные размеры детали — длина и ширина, тем же стилем dimH/dimV,
  // что и везде в проекте.
  body += dimH(PAD_L, PAD_L + fw, PAD_T + fh, usedLv.bottom || 0, String(p.length));
  body += dimV(PAD_T, PAD_T + fh, PAD_L + fw, usedLv.right || 0, String(p.width));

  // Ручная разметка — свой лист редактора, привязанный к САМОЙ детали (не к
  // группе одинаковых деталей, как чертёж детали): 'editor:<uid>|<ключ>'.
  // Размеры этого листа видны только в редакторе. Вырезов как данных у детали
  // пока нет (редактор — Этап 1, статичный вид), поэтому привязки — углы/края
  // детали и центры отверстий.
  const mkSheet = opts.markup !== false && p.moduleUid && p.anchorKey
    ? `editor:${p.moduleUid}|${p.anchorKey}` : '';
  const mkBody = mkAttach(mkSheet, opts.model || null, partLocalViews(p, PAD_L, PAD_T, fw, fh, scale), W, H, body);
  body += mkBody;

  return svgTagMk(W, H, body, mkBody ? mkSheet : '');
}

// ---------------------------------------------------------------------------
// Подпись модуля ставится в ЕГО собственный левый верхний угол: у модулей
// разной высоты подписи идут по своим верхам, а не одной строкой по верху
// всего чертежа — так сразу видно, где чей корпус.
function moduleLabel(m, F) {
  const x = F.x(m.offsetX - (m.dims.W || 0) / 2) + 5;
  // Навесной модуль поднят на отметку m.offsetY — подпись в его верхнем углу.
  const y = F.y((Number(m.offsetY) || 0) + (m.dims.H || 0)) + 12;
  return text(x, y, m.name, 'dw-sec', 'start');
}

// Название материала по коду детали. В цех уходит именно название декора,
// а не внутренний артикул, поэтому в таблице печатаем его целиком.
function materialLabel(model, code) {
  const proj = model.project || {};
  for (const info of [proj.decor, proj.facadeDecor, proj.facadeMat, proj.backMaterial, proj.drawerDecor]) {
    if (info && info.code === code) return info.name;
  }
  // Фасадные материалы, шпон и стекло лежат в каталоге, а не в проекте
  return materialTitle(code) || code || '—';
}

function buildPartsTable(model) {
  // Объединение одинаковых деталей (сумма qty, общий номер позиции) уже
  // сделано в engine.js — mergeEqualParts/mergeKey — model.parts приходит
  // сюда уже склеенным, повторно группировать не нужно.
  const rows = model.parts.filter(p => !p.hardware).map(p =>
    `<tr><td>${p.num}</td><td>${esc(p.module || '')}</td><td>${esc(p.name)}</td>`
    + `<td>${esc(p.section)}</td><td>${esc(materialLabel(model, p.material))}</td>`
    + `<td>${p.cutLength != null ? p.cutLength : p.length}×${p.cutWidth != null ? p.cutWidth : p.width}</td>`
    + `<td>${p.thickness}</td><td>${p.qty}</td>`
    + `<td>${esc(edgeLabel(p))}</td></tr>`
  ).join('');
  return `<table class="dw-legend dw-wide">
    <thead><tr><th>Поз.</th><th>Модуль</th><th>Деталь</th><th>Секция</th><th>Материал</th>
      <th>Размер, мм</th><th>Толщ.</th><th>Кол.</th><th>Кромка</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

// Кромка коротко: какие стороны кромятся и чем. «—» — без кромки.
function edgeLabel(p) {
  // Кромки — в порядке деталировки (cutEdging: дл1/дл2 — вдоль первой цифры).
  const e = p.cutEdging || p.edging || {};
  const parts = [];
  const add = (label, v) => { if (v) parts.push(`${label} ${v}`); };
  add('дл1', e.long1); add('дл2', e.long2); add('кор1', e.short1); add('кор2', e.short2);
  return parts.length ? parts.join(', ') : '—';
}

function buildDrawings(model, showFacades) {
  // Ручная разметка: реестр листов собирается заново на каждую сборку —
  // лист удалённого модуля/детали пропадает, его размеры не рисуются. До
  // раннего выхода пустого проекта: иначе в реестре остались бы листы
  // прошлой сборки, и count() считал бы уже невидимые размеры.
  if (window.Modul3D && window.Modul3D.markup && window.Modul3D.markup.beginSheets) {
    window.Modul3D.markup.beginSheets();
  }
  // Пустой проект — штатное состояние при запуске: чертить нечего.
  if (!model.modules.length) {
    return '<div class="dw-empty">Проект пуст. Выберите модуль в разделе '
      + '«База модулей» или добавьте свой кнопкой «+».</div>';
  }
  const d = model.dims;
  // Масштаб один на все чертежи и подбирается так, чтобы в лист влезли ОБЕ
  // проекции: вид спереди плюс вид сбоку по ширине и вид сверху по высоте.
  // Раньше он считался только по ширине изделия, и глубокая Г-образная кухня
  // вылезала за поле листа.
  // Общий вид — главный чертёж, он занимает лист целиком. Масштаб подбирается
  // по полю листа, а не по фиксированной ширине: спецификация ушла в самый
  // низ, поэтому место рядом с чертежом больше никто не занимает.
  const SHEET_W = 1120, SHEET_H = 820;
  const ex = contentExtent(model);
  const exW = ex.xMax - ex.xMin, exH = ex.yMax - ex.yMin, exD = ex.zMax - ex.zMin;
  const needW = exW + GAP + exD + 130;
  const needH = exH + GAP + exD + 130;
  const scale = Math.min(SHEET_W / Math.max(needW, 1), SHEET_H / Math.max(needH, 1));
  const denom = Math.max(1, Math.round(1 / scale));

  const headText = `Габарит проекта ${Math.round(d.W)}×${Math.round(d.H)}×${Math.round(d.D)} мм · `
    + `модулей: ${model.modules.length} · единый масштаб 1:${denom} · `
    + `все размеры в мм · номера в кружках — позиции деталировки`;
  let html = `<div class="dw-head">`
    + `Габарит проекта ${Math.round(d.W)}×${Math.round(d.H)}×${Math.round(d.D)} мм · `
    + `модулей: ${model.modules.length} · единый масштаб 1:${denom} · `
    + `все размеры в мм · номера в кружках — позиции деталировки</div>`;

  html += `<h4 class="dw-h dw-h-ov">Общий вид</h4><div class="dw-grid">${buildOverview(model, scale, headText)}</div>`;

  // Чертежи модулей и фасадов крупнее общего вида: они рабочие, по ним
  // читают размеры в цеху, и мелкий масштаб там мешает.
  const DETAIL_ZOOM = 1.15;
  // Фасады — самые простые чертежи, места на листе у них много: их можно
  // увеличить сильнее, чтобы читались межосевые и присадка под петли.
  const FACADE_ZOOM = 1.4;
  // Лист модуля (чертёж + таблица деталей справа) должен целиком помещаться
  // на печатной странице A4: если самый высокий чертёж выше, уменьшаем масштаб.
  const MOD_SHEET_MAX_H = 880;
  let modScale = scale * DETAIL_ZOOM;
  let modHtml = '';
  for (let pass = 0; pass < 3; pass++) {
    modHtml = '';
    for (const mod of model.modules) modHtml += buildModuleDrawing(model, mod, modScale);
    const re = /<svg width="[\d.]+" height="[\d.]+" viewBox="-?[\d.]+ -?[\d.]+ [\d.]+ ([\d.]+)"/g;
    let mm, maxH = 0;
    while ((mm = re.exec(modHtml))) maxH = Math.max(maxH, +mm[1]);
    if (maxH <= MOD_SHEET_MAX_H) break;
    modScale *= MOD_SHEET_MAX_H / maxH * 0.98;
  }
  html += `<h4 class="dw-h dw-h-mod">Чертежи модулей (каркас)</h4><div class="dw-grid">${modHtml}</div>`;

  if (showFacades) {
    const facHtml = buildFacadeDrawings(model, scale * FACADE_ZOOM);
    html += `<h4 class="dw-h">Фасады</h4><div class="dw-grid">${facHtml}</div>`;
  }
  // Детали с присадкой — каждая своим чертежом: по ним сверлят, и координаты
  // отверстий должны быть видны, а не тонуть в общем чертеже модуля.
  const drilledHtml = buildDrilledPartDrawings(model, scale * FACADE_ZOOM);
  html += `<h4 class="dw-h">Детали с присадкой</h4><div class="dw-grid">${drilledHtml}</div>`;
  // Спецификация деталей — в самый низ, после всех чертежей.
  html += `<h4 class="dw-h">Спецификация деталей</h4>${buildPartsTable(model)}`;
  return html;
}

const DRAWINGS_CSS = `
.dw-printonly{display:none}
.dw-head{font:12px sans-serif;color:#333;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #000}
.dw-h{margin:18px 0 10px;font:600 13px sans-serif;color:#000;text-transform:uppercase;letter-spacing:.04em}
.dw-grid{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start}
.dw-block{border:1px solid #000;padding:8px 10px;background:#fff}
.dw-title{font:600 12px sans-serif;margin-bottom:6px;color:#000}
.dw-note{font:10.5px sans-serif;color:#333;margin-top:4px}
.dw-svg{display:block;max-width:none;overflow:visible}
.dw-secrow{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}
.dw-wire{fill:none;stroke:#000;stroke-width:1}
.dw-wire-back{fill:none;stroke:#000;stroke-width:.5;stroke-dasharray:5 3}
.dw-part{fill:#fff;stroke:#000;stroke-width:1}
.dw-back{fill:#fff;stroke:#000;stroke-width:.5;stroke-dasharray:4 2}
.dw-drawer{fill:#fff;stroke:#000;stroke-width:.7}
.dw-facade{fill:#fff;stroke:#000;stroke-width:1.2}
.dw-open{fill:none;stroke:#000;stroke-width:1.4}
.dw-dim{stroke:#000;stroke-width:.5}
.dw-ext{stroke:#000;stroke-width:.35}
.dw-axis{stroke:#000;stroke-width:.35;stroke-dasharray:12 3 2 3}
.dw-arrow{fill:#000}
.dw-thin{stroke:#000;stroke-width:.5}
.dw-dt{font:10px sans-serif;fill:#000}
.dw-t{font:10px sans-serif;fill:#000}
.dw-vname{font:600 10px sans-serif;fill:#000;letter-spacing:.06em}
.dw-sec{font:600 10px sans-serif;fill:#000}
.dw-hole{fill:#fff;stroke:#000;stroke-width:.8}
.dw-handle{fill:none;stroke:#000;stroke-width:1}
.dw-pos{fill:#fff;stroke:#000;stroke-width:.7}
.dw-post{font:600 8px sans-serif;fill:#000}
.dw-legend{border-collapse:collapse;font:11px sans-serif;width:auto}
.dw-legend th,.dw-legend td{border:1px solid #000;padding:3px 6px;white-space:nowrap}
.dw-legend th{background:#eee}
.dw-legbg{fill:#fff;stroke:#000;stroke-width:.8}
.dw-legh{fill:#eee;stroke:none}
.dw-lt{font:9px sans-serif;fill:#000}
.dw-lth{font:600 9px sans-serif;fill:#000}
.dw-partsheet{box-sizing:border-box;width:530px;height:340px;display:flex;flex-direction:column;overflow:hidden;padding:0}
.dw-partsheet>svg{margin:0}
.dw-partsheet.dw-partwide{width:auto;min-width:530px}
.dw-wide{width:100%}
.dw-empty{font:11px sans-serif;color:#333}
`;

window.Modul3D = window.Modul3D || {};
window.Modul3D.drawings = {
  buildDrawings, buildViewSVG, DRAWINGS_CSS, visibleParts, buildPartEditorView,
  // Переиспользуются модулем ручной разметки (markup.js): тот же визуальный
  // язык размеров (dimH/dimV, сетка уровней DIM_FIRST/DIM_STEP) и проекция
  // присадки на плоскость детали (resolveHoleScreen) — см. комментарий там.
  dimH, dimV, DIM_FIRST, DIM_STEP, ARROW, resolveHoleScreen,
};
})();
