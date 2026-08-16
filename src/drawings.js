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
  s += text((x1 + x2) / 2, y - 2.5, label, 'dw-dt', 'middle');
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
  s += `<text x="${r(x - 2.5)}" y="${r(my)}" class="dw-dt" text-anchor="middle" transform="rotate(-90 ${r(x - 2.5)} ${r(my)})">${esc(label)}</text>`;
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
  const rt = /<text x="(-?[\d.]+)" y="(-?[\d.]+)"/g;
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
        if (!shown.some(s => px >= s.x0 && px <= s.x1 && py >= s.y0 && py <= s.y1)) {
          covered = false;
        }
      }
    }
    if (covered && shown.length) continue;
    shown.push(it);
    kept.push(it);
  }
  // возвращаем в формате «строка + только видимые боксы»
  const byRow = new Map();
  for (const it of kept) {
    if (!byRow.has(it.row)) byRow.set(it.row, Object.assign({}, it.row, { boxes: [] }));
    byRow.get(it.row).boxes.push(it.b);
  }
  return Array.from(byRow.values());
}

// Рисует детали в проекции; labels — куда собрать позиции для выносок
function drawParts(parts, sx, sy, hAxis, vAxis, labels, wire, noHoles) {
  let body = '';
  for (const row of parts) {
    // ПРАВИЛО: на чертежах фурнитуры не видно. Показываем только детали и
    // присадку под крепление фурнитуры — сами ручки, опоры, штанги, фланцы
    // и полкодержатели не изображаются (они есть в спецификации и в 3D).
    if (row.hardware) continue;
    for (const b of row.boxes) {
      const hs = hAxis === 'x' ? b.w : b.d;
      const vs = vAxis === 'y' ? b.h : b.d;
      const x0 = sx(b[hAxis] - hs / 2), x1 = sx(b[hAxis] + hs / 2);
      const yA = sy(b[vAxis] - vs / 2), yB = sy(b[vAxis] + vs / 2);
      const y0 = Math.min(yA, yB), y1 = Math.max(yA, yB);
      // Круглые детали (опоры) на виде СВЕРХУ показываем окружностью, а не
      // квадратом — иначе чертёж вводит в заблуждение при разметке присадки.
      // Круглое сечение: опора — сверху, штанга — спереди и сбоку
      const isRound = (row.shape === 'cylinder' && vAxis === 'z')
        || (row.shape === 'cylinderX' && hAxis === 'z');
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
          const h = (panel || (flat && turned))
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
  s += dimV(F.y(0), F.y(d.H), leftX, 0, String(Math.round(d.H)), -1);
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
  if (m0.baseH > 0) marks.push(m0.baseH);
  for (const p of model.partsRaw) {
    if (p.module !== mods[0].name) continue;
    const b = p.boxes[0];
    if (p.kind === 'shelf') marks.push(b.y - b.h / 2);
    if (p.kind === 'drawerFront') marks.push(b.y + b.h / 2);
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

function buildOverview(model, scale) {
  const d = model.dims;
  // Снаружи видно только корпус и фасады
  const outer = model.partsRaw.filter(p => !INTERIOR_KINDS[p.kind]);
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

  // ПРАВИЛО: общий вид — только габариты. Присадку на нём не показываем,
  // она есть на чертежах каркаса, фасадов и в файлах для ЧПУ.
  body += drawParts(visibleParts(outer, 'front'), F.x, F.y, 'x', 'y', null, false, true);
  body += text(fx0 + fw / 2, fy0 - 10, 'ВИД СПЕРЕДИ', 'dw-vname', 'middle');
  for (const m of mods) body += moduleLabel(m, F);
  body += overallDims(model, F, fy0 + fh, fx0);

  body += drawParts(visibleParts(outer, 'side'), S.x, S.y, 'z', 'y', null, false, true);
  body += text(sx0 + dd / 2, fy0 - 10, 'ВИД СБОКУ', 'dw-vname', 'middle');
  body += sideDims(model, S, fy0 + fh, zMin, zMax);

  body += drawParts(visibleParts(outer, 'top'), T.x, topSy, 'x', 'z', null, false, true);
  body += text(fx0 + fw / 2, ty0 - 8, 'ВИД СВЕРХУ', 'dw-vname', 'middle');
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

  // Без подзаголовка: над блоком уже стоит заголовок раздела «Общий вид»
  return `<div class="dw-block">${svgTag(totalW, totalH, body)}</div>`;
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
  const parts = model.partsRaw.filter(p => belongs(p) && !FACADE_KINDS[p.kind]
    && !p.hardware && !runWide(p));
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
  const PAD_T = 22, PAD_R = DIM_FIRST + 8 * DIM_STEP + 18;
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

  // --- состав деталей ---
  for (const row of parts) {
    if (row.num == null) continue;            // фурнитура — не деталь из листа
    if (seen[row.num]) seen[row.num].qty += 1;
    else {
      seen[row.num] = { num: row.num, name: row.name, material: row.material,
        size: `${row.length}×${row.width}`, th: row.thickness, qty: 1 };
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

  const legend = `<table class="dw-legend"><thead><tr>
      <th>Поз.</th><th>Деталь</th><th>Материал</th><th>Размер, мм</th>
      <th>Толщ.</th><th>Кол.</th></tr></thead><tbody>`
    + rows.map(x => `<tr><td>${x.num}</td><td>${esc(x.name)}</td>`
      + `<td>${esc(materialTitle(x.material))}</td>`
      + `<td>${esc(x.size)}</td><td>${x.th}</td><td>${x.qty}</td></tr>`).join('')
    + `</tbody></table>`;

  return `<div class="dw-block">
    <div class="dw-title">${esc(mod.name)} — каркас без фасадов</div>
    <div class="dw-secrow">${svgTag(totalW, totalH, body)}${legend}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Фасады
// ---------------------------------------------------------------------------
// Короткая сводка по присадке для подписи под чертежом фасада.
function holeSummary(p) {
  const byD = {};
  for (const h of (p.holes || [])) {
    const key = `Ø${h.d}${h.through ? ' насквозь' : ' глуб. ' + h.depth}`;
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

function facadeHoles(p, x0, y0, fw, fh, scale) {
  const holes = p.holes || [];
  if (!holes.length) return '';
  const px = (v) => x0 + v * scale;
  const py = (v) => y0 + fh - v * scale;   // деталь снизу вверх
  const LEFT = x0, RIGHT = x0 + fw, TOP = y0, BOTTOM = y0 + fh;
  let body = '';

  for (const h of holes) {
    const cx = px(h.x), cy = py(h.y);
    const rr = Math.max((h.d * scale) / 2, 1.6);
    body += `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(rr)}" class="dw-hole"/>`;
    body += line(cx - rr - 4, cy, cx + rr + 4, cy, 'dw-axis');
    body += line(cx, cy - rr - 4, cx, cy + rr + 4, 'dw-axis');
  }

  const dims = { bottom: [], top: [], left: [], right: [] };
  // Цепочка: край → отверстие → отверстие → … → край. Все звенья не
  // перекрываются, поэтому встают в ОДНУ линию — как на чертеже из цеха.
  const chainY = (vals, side) => {
    const ys = vals.slice().sort((a, b) => a - b);
    const pts = [0].concat(ys, [p.width]);
    for (let k = 0; k < pts.length - 1; k++) {
      const d = pts[k + 1] - pts[k];
      if (d < 1) continue;
      dims[side].push({ a: py(pts[k + 1]), b: py(pts[k]), label: String(Math.round(d)) });
    }
  };
  const chainX = (vals, side) => {
    const xs = vals.slice().sort((a, b) => a - b);
    const pts = [0].concat(xs, [p.length]);
    for (let k = 0; k < pts.length - 1; k++) {
      const d = pts[k + 1] - pts[k];
      if (d < 1) continue;
      dims[side].push({ a: px(pts[k]), b: px(pts[k + 1]), label: String(Math.round(d)) });
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
  const other = holes.filter((h) => h.kind !== 'handle' && h.kind !== 'hingeCup' && h.kind !== 'hingeGlass');

  // ПЕТЛИ — размеры со стороны петель
  let hingeLeft = true;
  if (cups.length) {
    const c0 = cups[0], cN = cups[cups.length - 1];
    hingeLeft = c0.x < p.length / 2;
    const vside = hingeLeft ? 'left' : 'right';
    chainX([c0.x], 'bottom');
    chainY(cups.map((c) => c.y), vside);
    const label = c0.through ? `Ø${c0.d} насквозь` : `Ø${c0.d} глуб. ${c0.depth}`;
    body += text(px(c0.x) + (hingeLeft ? 10 : -10), py(c0.y) - 6, label, 'dw-t',
                 hingeLeft ? 'start' : 'end');
  }

  // РУЧКА
  if (hand.length) {
    const xs = hand.map((h) => h.x), ys = hand.map((h) => h.y);
    const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    const rightSide = maxX > p.length / 2;
    const vside = cups.length ? (hingeLeft ? 'right' : 'left') : (rightSide ? 'right' : 'left');
    if (maxY - minY > 0.5) chainY(ys, vside); else chainY([minY], vside);
    if (maxX - minX > 0.5) chainX(xs, 'top'); else chainX([minX], 'top');
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
    for (const d of packDims(dims[side], 0)) {
      body += draw[side](d);
      levels[side] = Math.max(levels[side], d.level + 1);
    }
  }
  facadeHoles.levels = levels;

  if (other.length) {
    const o0 = other[0];
    body += text(px(o0.x), py(o0.y) - 6, `Ø${o0.d} глуб. ${o0.depth}`, 'dw-t', 'middle');
  }
  return body;
}

// Чертежи ДЕТАЛЕЙ: фасады и любые другие детали с присадкой или пазом.
// Раньше свой лист был только у фасада, и присадку остальных деталей
// (стенки ящика, боковины, планки) на чертежах было просто не видно.
function buildPartDrawings(model, scale, pick, emptyText) {
  const facades = model.partsRaw.filter(pick);
  if (!facades.length) return `<div class="dw-empty">${emptyText}</div>`;

  // Одинаковые фасады — один чертёж. Одинаковыми считаются детали с тем же
  // габаритом, материалом, толщиной И той же присадкой: сверлить их будут
  // по одному шаблону. В заголовке перечисляются все их позиции.
  const sign = (f) => [
    Math.round(f.length), Math.round(f.width), f.thickness, f.material,
    (f.holes || []).map((h) => `${h.kind}:${h.x}:${h.y}:${h.d}:${h.depth || 0}`)
      .sort().join('|'),
  ].join('/');

  const groups = {};
  const order = [];
  for (const f of facades) {
    const k = sign(f);
    if (!groups[k]) { groups[k] = { part: f, qty: 0, nums: [] }; order.push(k); }
    groups[k].qty += 1;
    if (f.num != null && groups[k].nums.indexOf(f.num) === -1) groups[k].nums.push(f.num);
  }

  return order.map((key) => {
    const g = groups[key], p = g.part;
    // Чертёж ДЕТАЛИ строится по её собственным габаритам (длина × ширина),
    // а не по мировому боксу: у модуля, повёрнутого на 90°, бокс развёрнут
    // вместе с корпусом, и фасад выходил на чертеже «на боку».
    const fw = p.length * scale, fh = p.width * scale;
    // Под размеры присадки нужны дополнительные размерные линии, поэтому
    // поля справа и снизу считаем по числу уровней, а не берём фиксированные.
    const lv = (p.holes && p.holes.length) ? 4 : 0;
    const PAD = DIM_FIRST + lv * DIM_STEP + 22;
    const PAD_L = lv ? PAD : 16;
    const PAD_T = lv ? PAD : 16;
    const PAD_R = PAD;
    const PAD_B = PAD;
    const W = fw + PAD_L + PAD_R, H = fh + PAD_T + PAD_B;
    let body = rect(PAD_L, PAD_T, fw, fh, 'dw-facade');
    body += callout(PAD_L + fw / 2, PAD_T + fh / 2, p.num);
    // Сначала цепочка присадки — она ближе к детали, потом габарит снаружи.
    body += facadeHoles(p, PAD_L, PAD_T, fw, fh, scale);
    const usedLv = facadeHoles.levels || { bottom: 0, right: 0 };
    body += dimH(PAD_L, PAD_L + fw, PAD_T + fh, usedLv.bottom || 0, String(p.length));
    body += dimV(PAD_T, PAD_T + fh, PAD_L + fw, usedLv.right || 0, String(p.width));
    const drill = (p.holes || []).length
      ? ` · присадка: ${holeSummary(p)}`
      : '';
    const paz = (p.grooves || []).length
      ? ` · паз ${p.grooves[0].w}×${p.grooves[0].depth} мм`
      : '';
    return `<div class="dw-block">
      <div class="dw-title">Поз. ${g.nums.sort((a, b2) => a - b2).join(', ')} · ${esc(p.name)} · ${g.qty} шт</div>
      ${svgTag(W, H, body)}
      <div class="dw-note">${esc(p.module)} · ${esc(p.section)} · кромка ${esc(p.edging.long1 || '—')} по периметру${drill}${paz}</div>
    </div>`;
  }).join('');
}

function buildFacadeDrawings(model, scale) {
  return buildPartDrawings(model, scale, (p) => FACADE_KINDS[p.kind],
    'Фасадов в проекте нет.');
}

// Все НЕфасадные детали, на которых есть присадка или паз: боковины, дно,
// планки, стенки ящиков. По ним сверлят, значит им нужен свой чертёж.
function buildDrilledPartDrawings(model, scale) {
  return buildPartDrawings(model, scale,
    (p) => !FACADE_KINDS[p.kind] && !p.hardware
      && (((p.holes || []).length) || ((p.grooves || []).length)),
    'Деталей с присадкой в проекте нет.');
}

// ---------------------------------------------------------------------------
// Подпись модуля ставится в ЕГО собственный левый верхний угол: у модулей
// разной высоты подписи идут по своим верхам, а не одной строкой по верху
// всего чертежа — так сразу видно, где чей корпус.
function moduleLabel(m, F) {
  const x = F.x(m.offsetX - (m.dims.W || 0) / 2) + 5;
  const y = F.y(m.dims.H || 0) + 12;
  return text(x, y, m.name, 'dw-sec', 'start');
}

// Название материала по коду детали. В цех уходит именно название декора,
// а не внутренний артикул, поэтому в таблице печатаем его целиком.
function materialLabel(model, code) {
  const proj = model.project || {};
  for (const info of [proj.decor, proj.facadeDecor, proj.backMaterial, proj.drawerDecor]) {
    if (info && info.code === code) return info.name;
  }
  // Фасадные материалы, шпон и стекло лежат в каталоге, а не в проекте
  return materialTitle(code) || code || '—';
}

function buildPartsTable(model) {
  const rows = model.parts.filter(p => !p.hardware).map(p =>
    `<tr><td>${p.num}</td><td>${esc(p.module || '')}</td><td>${esc(p.name)}</td>`
    + `<td>${esc(p.section)}</td><td>${esc(materialLabel(model, p.material))}</td>`
    + `<td>${p.length}×${p.width}</td><td>${p.thickness}</td><td>${p.qty}</td>`
    + `<td>${esc(edgeLabel(p))}</td></tr>`
  ).join('');
  return `<table class="dw-legend dw-wide">
    <thead><tr><th>Поз.</th><th>Модуль</th><th>Деталь</th><th>Секция</th><th>Материал</th>
      <th>Размер, мм</th><th>Толщ.</th><th>Кол.</th><th>Кромка</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

// Кромка коротко: какие стороны кромятся и чем. «—» — без кромки.
function edgeLabel(p) {
  const e = p.edging || {};
  const parts = [];
  const add = (label, v) => { if (v) parts.push(`${label} ${v}`); };
  add('дл1', e.long1); add('дл2', e.long2); add('кор1', e.short1); add('кор2', e.short2);
  return parts.length ? parts.join(', ') : '—';
}

function buildDrawings(model, showFacades) {
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

  let html = `<div class="dw-head">`
    + `Габарит проекта ${Math.round(d.W)}×${Math.round(d.H)}×${Math.round(d.D)} мм · `
    + `модулей: ${model.modules.length} · единый масштаб 1:${denom} · `
    + `все размеры в мм · номера в кружках — позиции деталировки</div>`;

  html += `<h4 class="dw-h">Общий вид</h4><div class="dw-grid">${buildOverview(model, scale)}</div>`;

  // Чертежи модулей и фасадов крупнее общего вида: они рабочие, по ним
  // читают размеры в цеху, и мелкий масштаб там мешает.
  const DETAIL_ZOOM = 1.15;
  // Фасады — самые простые чертежи, места на листе у них много: их можно
  // увеличить сильнее, чтобы читались межосевые и присадка под петли.
  const FACADE_ZOOM = 1.4;
  let modHtml = '';
  for (const mod of model.modules) modHtml += buildModuleDrawing(model, mod, scale * DETAIL_ZOOM);
  html += `<h4 class="dw-h">Чертежи модулей (каркас)</h4><div class="dw-grid">${unifyBlocks(modHtml)}</div>`;

  if (showFacades) {
    const facHtml = buildFacadeDrawings(model, scale * FACADE_ZOOM);
    html += `<h4 class="dw-h">Фасады</h4><div class="dw-grid">${unifyBlocks(facHtml)}</div>`;
  }
  // Детали с присадкой — каждая своим чертежом: по ним сверлят, и координаты
  // отверстий должны быть видны, а не тонуть в общем чертеже модуля.
  const drilledHtml = buildDrilledPartDrawings(model, scale * FACADE_ZOOM);
  html += `<h4 class="dw-h">Детали с присадкой</h4><div class="dw-grid">${unifyBlocks(drilledHtml)}</div>`;
  // Спецификация деталей — в самый низ, после всех чертежей.
  html += `<h4 class="dw-h">Спецификация деталей</h4>${buildPartsTable(model)}`;
  return html;
}

const DRAWINGS_CSS = `
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
.dw-wide{width:100%}
.dw-empty{font:11px sans-serif;color:#333}
`;

window.Modul3D = window.Modul3D || {};
window.Modul3D.drawings = { buildDrawings, buildViewSVG, DRAWINGS_CSS, visibleParts };
})();
