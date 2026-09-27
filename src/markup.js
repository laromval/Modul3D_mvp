// markup.js
// ============================================================================
// РУЧНАЯ РАЗМЕТКА — пользователь сам ставит размерные линии (в дополнение к
// автогенерируемым цепочкам в drawings.js) между ЛЮБЫМИ двумя точками
// деталей: угол, точка на грани, центр отверстия присадки.
//
// ЛИСТЫ. Разметка работает на ВСЕХ чертежах вкладки «Чертежи», у каждого
// листа (отдельного SVG) — СВОИ размеры (решение пользователя, «вариант Б»:
// размер с чертежа модуля не появляется на общем виде и наоборот).
// drawings.js на каждой сборке зовёт beginSheets(), затем attachSheet() для
// каждого листа: общий вид ('overview'), чертёж модуля ('module:<uid>'),
// чертёж детали — фасады и детали с присадкой ('part:<uid>|<ключ детали>';
// одинаковые детали там склеены в один чертёж, ключ — первой детали группы).
// Размер на листе детали принадлежит НЕ id листа, а своей детали: он
// показывается на том групповом листе, где эта деталь СЕЙЧАС есть среди
// членов группы (view.members) — какая бы деталь ни была представителем.
// Представитель сменился (добавили модуль с таким же фасадом раньше в
// ряду) — размер на месте; деталь ушла в другую группу (изменились её
// размеры) — размер уходит вместе с ней. Геометрия — по представителю
// (детали группы одинаковы). Поле sheet в записи остаётся исходным.

// Отдельно — окно визуального редактора детали (drawings.buildPartEditorView,
// app.js: renderPartEditorOverlay): лист 'editor:<uid>|<ключ детали>',
// привязан к САМОЙ детали; он живёт вне вкладки «Чертежи», поэтому
// beginSheets() его не сбрасывает, а app.js снимает его dropSheet() при
// закрытии окна. Вырезов как данных у детали пока нет — в редакторе
// привязки те же: углы/края детали и центры отверстий.
// id листа стабилен (uid модуля + ключ детали, не индекс/имя). Лист
// передаёт «контексты видов» (name/hAxis/vAxis/sx/sy/rows/region/noHoles и,
// если деталь нарисована в своих координатах, holeScreen) — ядро разметки
// не привязано к конкретной проекции и работает по тому, что реально
// нарисовано. Всё интерактивное (наведение, постановка, выделение, drag,
// магнит, предел выноса) — в пределах одного листа: того, над которым
// курсор, или того, где начата постановка/перетаскивание.
//
// КАК СТАВИТСЯ РАЗМЕР (как линейный размер в CAD):
//   1) щелчок по первой точке A;
//   2) щелчок по второй точке B — любой, не обязательно на одной оси с A.
//      С зажатым Shift резиновая линия от A идёт строго перпендикулярно
//      ребру детали, на котором стоит A (на угле/отверстии — по
//      преобладающему направлению мыши), а B привязывается к ближайшему
//      углу/ребру/отверстию на этой линии; ориентация размера при этом
//      фиксируется вдоль линии. Shift можно нажимать/отпускать по ходу;
//   3) вынос: размерная линия ПЛАВНО следует за курсором; щелчок фиксирует.
//      Курсор выше/ниже полосы между A и B — размер горизонтальный
//      (измеряет разницу по горизонтали), левее/правее — вертикальный;
//      внутри прямоугольника AB ориентация не меняется (как в CAD).
//      Размерная линия «магнитится» к линии соседнего ручного размера того
//      же листа и той же ориентации в пределах SNAP_PX экранных пикселей,
//      если их отрезки не перекрываются. Вынос ограничен рамкой листа.
//   Готовый размер: щелчок — выделить, Delete — удалить, перетаскивание —
//   плавно сменить вынос. Esc — отменить начатый размер/снять выделение.
//   Правая кнопка в режиме разметки — панорама листа (ui-shell.js), простой
//   щелчок ПКМ — отмена начатого размера (cancelDraft); точек ПКМ не ставит.
//
// МОДЕЛЬ ДАННЫХ (getData/setData — чистый JSON для файла проекта и истории
// отмены, см. app.js):
//   { id, sheet, view, a, b, orient:'h'|'v', offset }
//   sheet — id листа (см. выше); запись без sheet (старая) — 'overview'.
//     Лист исчез (модуль/деталь удалены) — размер не рисуется; данные
//     остаются (Ctrl+Z вернёт), при записи в файл app.js их отбрасывает.
//   view — вид на этом листе ('front'|'side'|'top').
//   orient — что измеряет размер: 'h' — разницу вдоль горизонтальной оси
//     вида (view.hAxis), размерная линия горизонтальна; 'v' — вдоль
//     вертикальной (view.vAxis). Длина = проекция AB на эту ось.
//   offset — положение размерной линии в ММ МОДЕЛИ (единицы вдоль оси,
//     перпендикулярной размеру), со знаком, ОТ ТОЧКИ A. Не пиксели и не
//     «уровни» — при другом масштабе листа/печати размер стоит там же
//     относительно детали. Выносные линии от A и от B разной длины, как в ЕСКД.
//   Старый формат (dir/level) — мигрирует при регистрации своего листа
//   (attachSheet), без лишнего шага истории отмены (onMigrate → app.js).
//
// ТОЧКА («анкор») ссылается на РЕАЛЬНУЮ деталь, а не на экранные пиксели:
//   { moduleUid, key, kind: 'corner'|'edgePoint'|'holeCenter', local: {...} }
// moduleUid — постоянный uid модуля (app.js: newModuleUid), key — ключ
// детали внутри модуля kind|section|side|index (engine.js проставляет
// part.moduleUid/part.anchorKey). НЕ part.id: engine.js нумерует детали
// заново для каждого модуля. Анкор разрешается по деталям, НАРИСОВАННЫМ на
// этом виде листа (view.rows) — деталь пропала/скрыта или длина стала
// нулевой — размер просто не рисуется, без ошибок.
//
// Формат local:
//   corner / edgePoint: { h, v } — доля (-1..1) от центра детали вдоль осей
//     h/v ЭТОГО вида; ±1 — угол, дробное значение — точка на грани. На
//     листе детали (фасад и т.п.) оси — длина/ширина самой детали.
//   holeCenter: { holeIndex, hx, hy, hd } — индекс в row.holes плюс
//     координаты центра и диаметр отверстия В СИСТЕМЕ САМОЙ ДЕТАЛИ (part.holes:
//     x/y/d). Индекс — быстрый путь; если по нему лежит другое отверстие
//     (порядок присадки поменялся, точка разрешается через представителя
//     группы одинаковых деталей), отверстие ищется по координатам (допуск
//     HOLE_EPS); не найдено — размер не рисуется. Старые анкоры без hx/hy —
//     только по индексу. Экранные координаты центра берутся
//     заново при каждой перерисовке (view.holeScreen листа детали или
//     drawings.resolveHoleScreen для проекций). Где отверстия не нарисованы
//     (view.noHoles — общий вид), они не ловятся.
//
// UI: кнопка «Разметка» / «Очистить всё» в полосе вкладок «Документы»
// (index.html #markupTools, app.js: initMarkupUI), размер шрифта — в окне
// настроек (index.html #markupFontRange, ui-shell.js: initMarkupFont),
// сохранение — поле markup в файле проекта и в истории отмены (app.js:
// serializeProject/snapshot).
// ============================================================================
(function () {

// --- Небольшие константы, согласованные с визуальным языком drawings.js ---
const HIT_RADIUS = 8;      // хит-тест наведения (в единицах листа)
// Угол детали мышью почти невозможно навести точь-в-точь (ближайшая ГРАНЬ
// всегда не дальше угла) — поэтому у угла свой, больший радиус захвата.
const CORNER_RADIUS = HIT_RADIUS + 6;
// Угол побеждает грань/отверстие только при ПРИМЕРНО равном расстоянии —
// иначе рядом с углом нельзя было бы поставить точку на грани.
const CORNER_MARGIN = 3;
const ALIGN_EPS = 0.6;     // мм: разница меньше — считаем нулевой (нулевой размер не строим)
const SNAP_PX = 6;         // ЭКРАННЫЕ px: допуск «магнита» к линии соседнего размера
const CLASH_CLEAR = 0.5;   // единицы листа: порог реального перекрытия отрезков (как в packDims)
const DRAG_PX = 3;         // экранные px: меньший сдвиг — щелчок, а не перетаскивание
const DEFAULT_FONT = 10;   // px — размер подписи как у обычных размеров чертежа
const MAX_OFFSET_MM = 100000;   // защита от мусора в файле проекта
const OVERVIEW = 'overview';
const HOLE_EPS = 0.5;      // мм: допуск совпадения центра отверстия (hx/hy) и диаметра

// --- Состояние модуля (единственный источник истины для сохранения в проект) ---
let active = false;
let fontScale = DEFAULT_FONT;
let dims = [];            // [{id, sheet, view, a, b, orient, offset}] (+ старые dir/level до миграции)
let nextId = 1;

let lastModel = null;     // модель последней сборки чертежей
// Реестр листов текущей сборки: { [sheetId]: { views:{front,side,top}, rect } }
// rect — рамка листа БЕЗ ручных размеров {x,y,w,h} (предел выноса).
let sheets = {};
// 'uid|anchorKey' детали → id группового листа детали, где она сейчас
// нарисована (заполняется attachSheet по view.members).
let partMemberSheet = {};
let unitPx = 1;           // экранных px на единицу листа (масштаб ui-shell учтён)

// draft: { sheet, view, a, phase:'pickB'|'pickOffset', b?, lock?, orient?, offset? }
let draft = null;
let hoverCandidate = null; // {sheet, view, anchor, sx, sy, dist}
let hoverSheet = null;     // лист под курсором (для «живой» группы)
let liveShownSheet = null; // в «живой» группе какого листа сейчас что-то нарисовано
let shiftGuide = null;     // при Shift в pickB: { axis:'h'|'v', px, py }
let lastMouse = null;      // {sx,sy} — последняя позиция курсора в координатах активного листа
let shiftDown = false;
let selectedId = null;
let dragState = null;      // {id, sheet, startX, startY, moved}
let justDragged = false;

let styleInjected = false;
let listenersBound = false;

// Подписчик на изменение набора размеров (см. onChange ниже). Нужен app.js:
// ручная разметка НЕ идёт через recompute() (это не параметр изделия), поэтому
// без уведомления история отмены, автосохранение и пересборка чертежа не
// узнали бы, что пользователь добавил/удалил/передвинул размер.
let changeListener = null;
let migrateListener = null;   // см. onMigrate
function notifyChange() {
  if (!changeListener) return;
  try { changeListener(); } catch (err) { console.error('markup onChange failed:', err); }
}

// Доступ к drawings.js — ЛЕНИВЫЙ: markup.js подключается в index.html ДО
// drawings.js, обращаться к нему можно только изнутри функций.
function dw() {
  return (window.Modul3D && window.Modul3D.drawings) || {};
}

function r2(v) { return Math.round(v * 100) / 100; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function escTxt(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return escTxt(s).replace(/"/g, '&quot;'); }
// Лист, на котором размер показывается СЕЙЧАС. Для листов деталей
// ('part:…') — по детали его точки A (см. шапку и partMemberSheet).
function sheetOf(d) {
  const s = (d && d.sheet) || OVERVIEW;
  if (s.indexOf('part:') === 0 && d.a) {
    const m = partMemberSheet[d.a.moduleUid + '|' + d.a.key];
    if (m) return m;
  }
  return s;
}
function viewOf(sheetId, viewName) {
  const sh = sheets[sheetId];
  return (sh && sh.views[viewName]) || null;
}

// ---------------------------------------------------------------------------
// Экран ↔ мир. view.sx/view.sy — линейные функции координаты (мм) → единицы
// листа; обратное преобразование нужно, чтобы хранить вынос в мм модели.
// ---------------------------------------------------------------------------
function linOf(f) {
  const f0 = f(0), f1 = f(1000);
  return { k: (f1 - f0) / 1000, b: f0 };
}
function worldFromScreen(view, axis, s) {
  const L = axis === 'h' ? (view._lh || (view._lh = linOf(view.sx))) : (view._lv || (view._lv = linOf(view.sy)));
  return L.k ? (s - L.b) / L.k : 0;
}

// ---------------------------------------------------------------------------
// Геометрия: разрешение анкора в экранные (sx,sy) и модельные (wh,wv, вдоль
// осей вида, мм) координаты по деталям, нарисованным на этом виде листа.
// ---------------------------------------------------------------------------
function findRow(view, anchor) {
  if (!view || !anchor || anchor.moduleUid == null || anchor.key == null) return null;
  // Групповой лист детали: точка любой детали группы разрешается по
  // представителю (одна строка листа) — детали группы одинаковы.
  if (view.members && view.members.indexOf(anchor.moduleUid + '|' + anchor.key) !== -1) {
    return (view.rows && view.rows[0]) || null;
  }
  const list = view.rows || [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    if (row.moduleUid === anchor.moduleUid && row.anchorKey === anchor.key) return row;
  }
  return null;
}

// Можно ли привязать точку к этой детали: у неё должен быть якорь (engine.js
// ставит его всем деталям модулей с uid).
function anchorable(row) {
  return row && !row.hardware && row.moduleUid != null && row.anchorKey != null;
}

function anchorOf(row, kind, local) {
  return { moduleUid: row.moduleUid, key: row.anchorKey, kind, local };
}

// Размеры бокса вдоль осей вида — ТЕМИ ЖЕ формулами, что drawParts() в
// drawings.js (hit-test должен видеть ровно нарисованное): ось 'x' → ширина,
// 'y' → высота, 'z' → глубина. Любая ось вида может быть любой мировой — у
// повёрнутого на 90/270° модуля вид сверху идёт по осям z и x.
function rowFrame(view, row) {
  const b = row.boxes && row.boxes[0];
  if (!b) return null;
  const size = (ax) => (ax === 'x' ? b.w : ax === 'y' ? b.h : b.d);
  const hs = size(view.hAxis);
  const vs = size(view.vAxis);
  return {
    b, hs, vs,
    worldH: (h) => b[view.hAxis] + h * hs / 2,
    worldV: (v) => b[view.vAxis] + v * vs / 2,
    localH: (wh) => (hs ? clamp((wh - b[view.hAxis]) / (hs / 2), -1, 1) : 0),
    localV: (wv) => (vs ? clamp((wv - b[view.vAxis]) / (vs / 2), -1, 1) : 0),
  };
}

// Центр отверстия на этом виде: у листа детали — своя проекция (деталь
// нарисована в своих координатах), у проекций — drawings.resolveHoleScreen.
function holeScreen(view, row, i) {
  if (view.noHoles) return null;
  if (typeof view.holeScreen === 'function') return view.holeScreen(row, i);
  const res = dw().resolveHoleScreen
    && dw().resolveHoleScreen(row, view.hAxis, view.vAxis, view.sx, view.sy, i);
  return res || null;
}

function resolveAnchor(view, anchor) {
  if (!view || !anchor || !anchor.local) return null;
  const row = findRow(view, anchor);
  if (!row) return null;                     // детали нет на этом виде — размер не рисуется
  if (anchor.kind === 'holeCenter') {
    const idx = holeIndexFor(row, anchor.local);
    if (idx < 0) return null;
    const res = holeScreen(view, row, idx);
    if (!res) return null;
    return { sx: res.x, sy: res.y, wh: res.wh, wv: res.wv };
  }
  const fr = rowFrame(view, row);
  if (!fr) return null;
  const h = typeof anchor.local.h === 'number' ? anchor.local.h : 0;
  const v = typeof anchor.local.v === 'number' ? anchor.local.v : 0;
  const wh = fr.worldH(h), wv = fr.worldV(v);
  return { sx: view.sx(wh), sy: view.sy(wv), wh, wv };
}

// Индекс отверстия анкора в row.holes: по holeIndex, если там то же самое
// отверстие (координаты/диаметр в системе детали), иначе — поиск по
// координатам. -1 — такого отверстия у детали больше нет.
function holeIndexFor(row, local) {
  const holes = (row && row.holes) || [];
  const i = local.holeIndex;
  if (typeof local.hx !== 'number' || typeof local.hy !== 'number') {
    return (typeof i === 'number' && holes[i]) ? i : -1;   // старый анкор — только индекс
  }
  const same = (h) => h && Math.abs(Number(h.x) - local.hx) <= HOLE_EPS
    && Math.abs(Number(h.y) - local.hy) <= HOLE_EPS
    && (typeof local.hd !== 'number' || Math.abs(Number(h.d) - local.hd) <= HOLE_EPS);
  if (typeof i === 'number' && same(holes[i])) return i;
  for (let k = 0; k < holes.length; k++) if (same(holes[k])) return k;
  return -1;
}

function sameAnchor(a, b) {
  if (!a || !b || a.moduleUid !== b.moduleUid || a.key !== b.key || a.kind !== b.kind) return false;
  return JSON.stringify(a.local) === JSON.stringify(b.local);
}

function pairUsable(pa, pb) {
  return Math.abs(pa.wh - pb.wh) >= ALIGN_EPS || Math.abs(pa.wv - pb.wv) >= ALIGN_EPS;
}

// Миграция записи старого формата (dir/level — «ступенчатый» вынос) в
// orient/offset. Нужен масштаб вида, поэтому не в setData, а при регистрации
// листа (attachSheet → migrateSheet). geom() запись НЕ меняет — только
// считает те же значения «на лету» (migratedValues), если лист почему-то
// ещё не мигрировал.
function migratedValues(d, view, pa, pb) {
  let orient;
  if (Math.abs(pa.wv - pb.wv) < ALIGN_EPS) orient = 'h';
  else if (Math.abs(pa.wh - pb.wh) < ALIGN_EPS) orient = 'v';
  else orient = Math.abs(pa.sx - pb.sx) >= Math.abs(pa.sy - pb.sy) ? 'h' : 'v';
  let offset = 0;
  if (typeof d.level === 'number') {
    const DF = dw().DIM_FIRST || 13, DS = dw().DIM_STEP || 14;
    const off = (d.dir === -1 ? -1 : 1) * (DF + d.level * DS);
    offset = orient === 'h'
      ? worldFromScreen(view, 'v', pa.sy + off) - pa.wv
      : worldFromScreen(view, 'h', pa.sx + off) - pa.wh;
  }
  return { orient, offset: Math.round(offset * 10) / 10 };
}

// Мигрирует старые записи ОДНОГО листа на месте. Возвращает true, если
// что-то изменилось (см. attachSheet: подписчик onMigrate в app.js
// переписывает верхний снимок истории, чтобы миграция не порождала
// лишний шаг отмены).
function migrateSheet(sheetId) {
  let changed = false;
  for (const d of dims) {
    if (sheetOf(d) !== sheetId || d.orient === 'h' || d.orient === 'v') continue;
    const view = viewOf(sheetId, d.view);
    const pa = resolveAnchor(view, d.a), pb = resolveAnchor(view, d.b);
    if (!pa || !pb) continue;   // детали сейчас нет — мигрирует, когда появится
    const m = migratedValues(d, view, pa, pb);
    d.orient = m.orient; d.offset = m.offset;
    delete d.dir; delete d.level;
    changed = true;
  }
  return changed;
}

// Полная экранная геометрия размера или null (не рисуется).
function geom(d) {
  const view = viewOf(sheetOf(d), d.view);
  if (!view) return null;
  const pa = resolveAnchor(view, d.a);
  const pb = resolveAnchor(view, d.b);
  if (!pa || !pb) return null;
  const legacy = (d.orient !== 'h' && d.orient !== 'v') ? migratedValues(d, view, pa, pb) : null;
  const orient = legacy ? legacy.orient : d.orient;
  const lenMM = orient === 'h' ? Math.abs(pa.wh - pb.wh) : Math.abs(pa.wv - pb.wv);
  if (lenMM < ALIGN_EPS) return null;
  const off = legacy ? legacy.offset : (Number(d.offset) || 0);
  const line = orient === 'h' ? view.sy(pa.wv + off) : view.sx(pa.wh + off);
  const span = orient === 'h'
    ? [Math.min(pa.sx, pb.sx), Math.max(pa.sx, pb.sx)]
    : [Math.min(pa.sy, pb.sy), Math.max(pa.sy, pb.sy)];
  return { orientation: orient, pa, pb, line, span, lenMM, view };
}

// ---------------------------------------------------------------------------
// Поиск ближайшего подходящего элемента рядом с курсором (координаты листа).
// ---------------------------------------------------------------------------
function holeCandidates(view, row, fn) {
  if (view.noHoles) return;
  const holes = row.holes || [];
  for (let i = 0; i < holes.length; i++) {
    const pos = holeScreen(view, row, i);
    const h0 = holes[i];
    if (!pos) continue;
    const local = { holeIndex: i, hx: Number(h0.x), hy: Number(h0.y) };
    // Диаметр кладём только если он есть: NaN в hd сломал бы поиск в holeIndexFor.
    if (isFinite(Number(h0.d))) local.hd = Number(h0.d);
    fn(anchorOf(row, 'holeCenter', local), pos.x, pos.y);
  }
}

function nearestCandidate(view, mx, my) {
  let bestOther = null, bestOtherD = Infinity;
  const considerOther = (anchor, sx, sy) => {
    const dx = sx - mx, dy = sy - my, d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestOtherD) { bestOtherD = d; bestOther = { anchor, sx, sy, dist: d }; }
  };
  let bestCorner = null, bestCornerD = Infinity;
  const considerCorner = (anchor, sx, sy) => {
    const dx = sx - mx, dy = sy - my, d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestCornerD) { bestCornerD = d; bestCorner = { anchor, sx, sy, dist: d }; }
  };

  for (const row of view.rows) {
    if (!anchorable(row)) continue;   // фурнитура/детали без якоря не размечаются
    const fr = rowFrame(view, row);
    if (!fr) continue;
    const corners = [];
    for (const h of [-1, 1]) {
      for (const v of [-1, 1]) {
        const sx = view.sx(fr.worldH(h)), sy = view.sy(fr.worldV(v));
        corners.push({ h, v, sx, sy });
        considerCorner(anchorOf(row, 'corner', { h, v }), sx, sy);
      }
    }
    const edges = [
      [corners[0], corners[1]], [corners[2], corners[3]],
      [corners[0], corners[2]], [corners[1], corners[3]],
    ];
    for (const pair of edges) {
      const p0 = pair[0], p1 = pair[1];
      const dx = p1.sx - p0.sx, dy = p1.sy - p0.sy;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((mx - p0.sx) * dx + (my - p0.sy) * dy) / len2 : 0;
      t = clamp(t, 0, 1);
      const sx = p0.sx + dx * t, sy = p0.sy + dy * t;
      const h = p0.h === p1.h ? p0.h : p0.h + (p1.h - p0.h) * t;
      const v = p0.v === p1.v ? p0.v : p0.v + (p1.v - p0.v) * t;
      considerOther(anchorOf(row, 'edgePoint', { h, v }), sx, sy);
    }
    holeCandidates(view, row, considerOther);
  }

  if (bestCorner && bestCornerD <= CORNER_RADIUS && bestCornerD <= bestOtherD + CORNER_MARGIN) return bestCorner;
  if (bestOther && bestOtherD <= HIT_RADIUS) return bestOther;
  return null;
}

// ---------------------------------------------------------------------------
// Shift: вторая точка на линии, перпендикулярной ребру детали под точкой A.
// ---------------------------------------------------------------------------
function shiftAxis(anchor, pa, mx, my) {
  if (anchor && anchor.kind === 'edgePoint' && anchor.local) {
    const onVert = Math.abs(Math.abs(anchor.local.h) - 1) < 1e-6;
    const onHorz = Math.abs(Math.abs(anchor.local.v) - 1) < 1e-6;
    if (onVert && !onHorz) return 'h';
    if (onHorz && !onVert) return 'v';
  }
  return Math.abs(mx - pa.sx) >= Math.abs(my - pa.sy) ? 'h' : 'v';
}

// Привязка на линии: углы и центры отверстий в пределах HIT_RADIUS от линии,
// плюс пересечения линии с рёбрами деталей. Берётся ближайшая к проекции
// курсора; ничего рядом — null (пустую точку вне детали не ставим).
function shiftCandidate(view, aAnchor, pa, axis, mx, my) {
  const px = axis === 'h' ? mx : pa.sx;
  const py = axis === 'h' ? pa.sy : my;
  let best = null, bestScore = Infinity;
  const consider = (anchor, sx, sy, radius, bias) => {
    const along = axis === 'h' ? Math.abs(sx - px) : Math.abs(sy - py);
    const perp = axis === 'h' ? Math.abs(sy - py) : Math.abs(sx - px);
    if (perp > HIT_RADIUS || along > radius) return;
    const len = axis === 'h' ? Math.abs(sx - pa.sx) : Math.abs(sy - pa.sy);
    if (len < 0.5 || sameAnchor(anchor, aAnchor)) return;
    const score = along - bias;
    if (score < bestScore) { bestScore = score; best = { anchor, sx, sy, dist: along }; }
  };
  for (const row of view.rows) {
    if (!anchorable(row)) continue;
    const fr = rowFrame(view, row);
    if (!fr) continue;
    for (const h of [-1, 1]) {
      for (const v of [-1, 1]) {
        consider(anchorOf(row, 'corner', { h, v }), view.sx(fr.worldH(h)), view.sy(fr.worldV(v)),
          CORNER_RADIUS, CORNER_MARGIN);
      }
    }
    if (axis === 'h') {
      const ya = view.sy(fr.worldV(-1)), yb = view.sy(fr.worldV(1));
      if (py >= Math.min(ya, yb) - 0.01 && py <= Math.max(ya, yb) + 0.01) {
        const v = fr.localV(worldFromScreen(view, 'v', py));
        for (const h of [-1, 1]) consider(anchorOf(row, 'edgePoint', { h, v }), view.sx(fr.worldH(h)), py, HIT_RADIUS, 0);
      }
    } else {
      const xa = view.sx(fr.worldH(-1)), xb = view.sx(fr.worldH(1));
      if (px >= Math.min(xa, xb) - 0.01 && px <= Math.max(xa, xb) + 0.01) {
        const h = fr.localH(worldFromScreen(view, 'h', px));
        for (const v of [-1, 1]) consider(anchorOf(row, 'edgePoint', { h, v }), px, view.sy(fr.worldV(v)), HIT_RADIUS, 0);
      }
    }
    holeCandidates(view, row, (anchor, sx, sy) => consider(anchor, sx, sy, HIT_RADIUS, 0));
  }
  return best;
}

// Запас вокруг границы региона вида (крайние точки деталей лежат ровно на
// границе region; обратное преобразование координат мыши даёт погрешность).
const VIEW_MARGIN = CORNER_RADIUS;

function viewAt(sheetId, mx, my) {
  const sh = sheets[sheetId];
  if (!sh) return null;
  for (const name of ['front', 'side', 'top']) {
    const v = sh.views[name];
    if (!v) continue;
    const rg = v.region;
    if (mx >= rg.x0 - VIEW_MARGIN && mx <= rg.x1 + VIEW_MARGIN
      && my >= rg.y0 - VIEW_MARGIN && my <= rg.y1 + VIEW_MARGIN) return v;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ориентация и вынос по курсору
// ---------------------------------------------------------------------------
// Как в CAD: курсор выше/ниже полосы между A и B — горизонтальный размер,
// левее/правее — вертикальный; за углом прямоугольника AB — куда ушёл
// дальше; внутри — прежняя ориентация. lock — ориентация от Shift.
function chooseOrient(pa, pb, mx, my, prev, lock) {
  const hOk = Math.abs(pa.wh - pb.wh) >= ALIGN_EPS;
  const vOk = Math.abs(pa.wv - pb.wv) >= ALIGN_EPS;
  if (!hOk && !vOk) return null;
  if (lock) return (lock === 'h' ? hOk : vOk) ? lock : null;
  if (!vOk) return 'h';
  if (!hOk) return 'v';
  const x0 = Math.min(pa.sx, pb.sx), x1 = Math.max(pa.sx, pb.sx);
  const y0 = Math.min(pa.sy, pb.sy), y1 = Math.max(pa.sy, pb.sy);
  const outX = mx < x0 ? x0 - mx : (mx > x1 ? mx - x1 : 0);
  const outY = my < y0 ? y0 - my : (my > y1 ? my - y1 : 0);
  if (outY > 0 && outX === 0) return 'h';
  if (outX > 0 && outY === 0) return 'v';
  if (outX > 0 && outY > 0) return outY >= outX ? 'h' : 'v';
  return prev || (x1 - x0 >= y1 - y0 ? 'h' : 'v');
}

// Вынос (мм модели от точки A) по положению курсора: плавно, в пределах
// рамки СВОЕГО листа, с «магнитом» к линии соседнего ручного размера того же
// вида этого листа и той же ориентации (в пределах SNAP_PX экранных px,
// если отрезки не перекрываются).
function offsetFromCursor(sheetId, viewName, pa, pb, orient, mx, my, excludeId) {
  const view = viewOf(sheetId, viewName);
  const rect = sheets[sheetId] && sheets[sheetId].rect;
  let L = orient === 'h' ? my : mx;
  if (rect) {
    L = orient === 'h'
      ? clamp(L, rect.y + fontScale + 4, rect.y + rect.h - 3)
      : clamp(L, rect.x + fontScale + 4, rect.x + rect.w - 3);
  }
  const span = orient === 'h'
    ? [Math.min(pa.sx, pb.sx), Math.max(pa.sx, pb.sx)]
    : [Math.min(pa.sy, pb.sy), Math.max(pa.sy, pb.sy)];
  const tol = SNAP_PX / (unitPx || 1);
  let snapTo = null, bestD = tol;
  for (const d of dims) {
    // магнит — только к размерам ТОГО ЖЕ вида того же листа
    if (d.id === excludeId || sheetOf(d) !== sheetId || d.view !== viewName) continue;
    const g = geom(d);
    if (!g || g.orientation !== orient) continue;
    const dd = Math.abs(g.line - L);
    if (dd > bestD) continue;
    const clash = Math.min(g.span[1], span[1]) - Math.max(g.span[0], span[0]) > CLASH_CLEAR;
    if (clash) continue;
    snapTo = g.line; bestD = dd;
  }
  if (snapTo != null) L = snapTo;
  const off = orient === 'h'
    ? worldFromScreen(view, 'v', L) - pa.wv
    : worldFromScreen(view, 'h', L) - pa.wh;
  return Math.round(off * 10) / 10;
}

// ---------------------------------------------------------------------------
// Отрисовка — классы dw-ext/dw-dim/dw-arrow/dw-dt, как у размеров drawings.js,
// но выносные линии своей длины от каждой точки до общей размерной линии.
// ---------------------------------------------------------------------------
function arrowSize() { return dw().ARROW || 3; }
function lineSVG(x1, y1, x2, y2, cls) {
  return `<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" class="${cls}"/>`;
}
function arrowH(x, y, dir) {
  const A = arrowSize();
  return `<polygon class="dw-arrow" points="${r2(x)},${r2(y)} ${r2(x - dir * A)},${r2(y - 1.2)} ${r2(x - dir * A)},${r2(y + 1.2)}"/>`;
}
function arrowV(x, y, dir) {
  const A = arrowSize();
  return `<polygon class="dw-arrow" points="${r2(x)},${r2(y)} ${r2(x - 1.2)},${r2(y - dir * A)} ${r2(x + 1.2)},${r2(y - dir * A)}"/>`;
}
function fontAttr() {
  return fontScale === DEFAULT_FONT ? '' : ` style="font-size:${fontScale}px"`;
}

function dimSVG(g) {
  const label = escTxt(String(Math.round(g.lenMM)));
  const L = g.line, A = arrowSize();
  let s = '';
  if (g.orientation === 'h') {
    for (const p of [g.pa, g.pb]) {
      const dd = L - p.sy, sg = dd >= 0 ? 1 : -1;
      if (Math.abs(dd) > 1.5) s += lineSVG(p.sx, p.sy + sg * 1.5, p.sx, L + sg * 2, 'dw-ext');
    }
    const x1 = g.span[0], x2 = g.span[1];
    s += lineSVG(x1, L, x2, L, 'dw-dim');
    s += (x2 - x1 > 2 * A + 2) ? arrowH(x1, L, -1) + arrowH(x2, L, 1) : arrowH(x1, L, 1) + arrowH(x2, L, -1);
    s += `<text x="${r2((x1 + x2) / 2)}" y="${r2(L - 2.5)}" class="dw-dt" text-anchor="middle"${fontAttr()}>${label}</text>`;
  } else {
    for (const p of [g.pa, g.pb]) {
      const dd = L - p.sx, sg = dd >= 0 ? 1 : -1;
      if (Math.abs(dd) > 1.5) s += lineSVG(p.sx + sg * 1.5, p.sy, L + sg * 2, p.sy, 'dw-ext');
    }
    const y1 = g.span[0], y2 = g.span[1];
    s += lineSVG(L, y1, L, y2, 'dw-dim');
    s += (y2 - y1 > 2 * A + 2) ? arrowV(L, y1, -1) + arrowV(L, y2, 1) : arrowV(L, y1, 1) + arrowV(L, y2, -1);
    const my = (y1 + y2) / 2, tx = L - 2.5;
    s += `<text x="${r2(tx)}" y="${r2(my)}" class="dw-dt" text-anchor="middle"`
      + ` transform="rotate(-90 ${r2(tx)} ${r2(my)})"${fontAttr()}>${label}</text>`;
  }
  return s;
}

function hitLineSVG(g) {
  return g.orientation === 'h'
    ? `<line x1="${r2(g.span[0])}" y1="${r2(g.line)}" x2="${r2(g.span[1])}" y2="${r2(g.line)}" class="mk-hit"/>`
    : `<line x1="${r2(g.line)}" y1="${r2(g.span[0])}" x2="${r2(g.line)}" y2="${r2(g.span[1])}" class="mk-hit"/>`;
}

// Невидимый прямоугольник-габарит размера вместе с подписью текущего шрифта —
// для рамки листа (drawings.js: svgFit). fill/stroke="none" в атрибутах —
// чтобы и в окне печати (без стилей mk-*) он оставался невидимым. Сам вынос
// ограничен рамкой листа БЕЗ ручных размеров, поэтому лист не растёт
// бесконечно от собственного выноса.
function extentRectSVG(g) {
  const label = String(Math.round(g.lenMM));
  const lw = label.length * fontScale * 0.62;
  const PADX = 3;
  const xs = [g.pa.sx, g.pb.sx], ys = [g.pa.sy, g.pb.sy];
  const mid = (g.span[0] + g.span[1]) / 2;
  if (g.orientation === 'h') {
    xs.push(mid - lw / 2, mid + lw / 2); ys.push(g.line - 2.5 - fontScale, g.line + 2);
  } else {
    ys.push(mid - lw / 2, mid + lw / 2); xs.push(g.line - 2.5 - fontScale, g.line + 2);
  }
  const x0 = Math.min.apply(null, xs) - PADX, x1 = Math.max.apply(null, xs) + PADX;
  const y0 = Math.min.apply(null, ys) - PADX, y1 = Math.max.apply(null, ys) + PADX;
  return `<rect x="${r2(x0)}" y="${r2(y0)}" width="${r2(x1 - x0)}" height="${r2(y1 - y0)}"`
    + ` fill="none" stroke="none" pointer-events="none" class="mk-ext"/>`;
}

function markerSVG(cls, x, y) {
  const rr = 4.2;
  return `<g class="${cls}">`
    + `<circle cx="${r2(x)}" cy="${r2(y)}" r="${rr}" class="mk-hl-mark"/>`
    + `<line x1="${r2(x - rr)}" y1="${r2(y)}" x2="${r2(x + rr)}" y2="${r2(y)}" class="mk-hl-mark"/>`
    + `<line x1="${r2(x)}" y1="${r2(y - rr)}" x2="${r2(x)}" y2="${r2(y + rr)}" class="mk-hl-mark"/>`
    + `</g>`;
}

function renderFinishedGroup(sheetId) {
  let out = '';
  for (const d of dims) {
    if (sheetOf(d) !== sheetId) continue;
    const g = geom(d);
    if (!g) continue;
    const cls = 'mk-dim' + (d.id === selectedId ? ' mk-dim-sel' : '');
    out += `<g class="${cls}" data-mk-id="${d.id}">${dimSVG(g)}${hitLineSVG(g)}${extentRectSVG(g)}</g>`;
  }
  return out;
}

// «Живая» группа — только на ОДНОМ листе: где идёт drag/постановка, иначе —
// под курсором.
function liveTargetSheet() {
  if (dragState) return dragState.sheet;
  if (draft) return draft.sheet;
  if (hoverCandidate) return hoverCandidate.sheet;
  return hoverSheet;
}

function renderLiveSVG(sheetId) {
  if (!active || !sheetId) return '';
  let out = '';

  if (dragState) {
    if (dragState.sheet !== sheetId) return '';
    const d = dims.filter((x) => x.id === dragState.id)[0];
    const g = d && dragState.moved ? geom(d) : null;
    if (g) out += `<g class="mk-draft">${dimSVG(g)}</g>`;
    return out;
  }

  if (draft) {
    if (draft.sheet !== sheetId) return '';
    const view = viewOf(draft.sheet, draft.view);
    const pa = resolveAnchor(view, draft.a);
    if (pa) out += markerSVG('mk-anchor', pa.sx, pa.sy);

    if (draft.phase === 'pickB') {
      if (pa && shiftGuide) {
        let ex = shiftGuide.px, ey = shiftGuide.py;
        if (hoverCandidate) {
          if (shiftGuide.axis === 'h') ex = hoverCandidate.sx; else ey = hoverCandidate.sy;
        }
        out += `<line x1="${r2(pa.sx)}" y1="${r2(pa.sy)}" x2="${r2(ex)}" y2="${r2(ey)}" class="mk-draft-line mk-shift-line"/>`;
      } else {
        const end = hoverCandidate ? { sx: hoverCandidate.sx, sy: hoverCandidate.sy } : lastMouse;
        if (pa && end) {
          out += `<line x1="${r2(pa.sx)}" y1="${r2(pa.sy)}" x2="${r2(end.sx)}" y2="${r2(end.sy)}" class="mk-draft-line"/>`;
        }
      }
      if (hoverCandidate && pa) {
        const pb = resolveAnchor(view, hoverCandidate.anchor);
        const ok = pb && !sameAnchor(draft.a, hoverCandidate.anchor) && pairUsable(pa, pb);
        out += markerSVG(ok ? 'mk-hl mk-hl-ok' : 'mk-hl mk-hl-bad', hoverCandidate.sx, hoverCandidate.sy);
      }
      return out;
    }

    if (draft.phase === 'pickOffset') {
      const pb = resolveAnchor(view, draft.b);
      if (pb) out += markerSVG('mk-anchor', pb.sx, pb.sy);
      if (draft.orient) {
        const g = geom({ sheet: draft.sheet, view: draft.view, a: draft.a, b: draft.b,
          orient: draft.orient, offset: draft.offset || 0 });
        if (g) out += `<g class="mk-draft">${dimSVG(g)}</g>`;
      }
      return out;
    }
  }

  if (hoverCandidate && hoverCandidate.sheet === sheetId) {
    out += markerSVG('mk-hl mk-hl-ok', hoverCandidate.sx, hoverCandidate.sy);
  }
  return out;
}

// ---------------------------------------------------------------------------
// DOM: листы — это <svg class="mk-root" data-mk-sheet="…"> (drawings.js:
// svgTagMk), их может быть много. Перевод координат мыши — через
// getScreenCTM() (учитывает масштаб чертежей ui-shell.js).
// ---------------------------------------------------------------------------
function allSheetSvgs() {
  return Array.prototype.slice.call(document.querySelectorAll('svg.mk-root') || []);
}
function sheetSvg(sheetId) {
  if (!sheetId) return null;
  const list = allSheetSvgs();
  for (let i = 0; i < list.length; i++) {
    if (list[i].getAttribute && list[i].getAttribute('data-mk-sheet') === sheetId) return list[i];
  }
  return null;
}
function svgOfTarget(target) {
  return (target && target.closest && target.closest('svg.mk-root')) || null;
}
function sheetIdOf(svg) {
  return (svg && svg.getAttribute && svg.getAttribute('data-mk-sheet')) || null;
}
function groupIn(svg, cls) {
  return (svg && svg.querySelector) ? svg.querySelector('g.' + cls) : null;
}

function svgPoint(svg, evt) {
  if (!svg || !svg.createSVGPoint || !svg.getScreenCTM) return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  unitPx = Math.hypot(ctm.a, ctm.b) || 1;
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

// Перерисовать готовые размеры всех листов (или одного).
function refreshFinished(onlySheet) {
  if (!lastModel) return;
  for (const svg of allSheetSvgs()) {
    const id = sheetIdOf(svg);
    if (!id || (onlySheet && id !== onlySheet)) continue;
    const el = groupIn(svg, 'mk-finished');
    if (el) el.innerHTML = renderFinishedGroup(id);
  }
  if (dragState && dragState.moved) setFinishedHidden(dragState.id, dragState.sheet, true);
}

function refreshLive() {
  const target = active ? liveTargetSheet() : null;
  if (liveShownSheet && liveShownSheet !== target) {
    const old = groupIn(sheetSvg(liveShownSheet), 'mk-live');
    if (old) old.innerHTML = '';
    liveShownSheet = null;
  }
  if (!target) return;
  const el = groupIn(sheetSvg(target), 'mk-live');
  if (!el) return;
  const html = renderLiveSVG(target);
  el.innerHTML = html;
  liveShownSheet = html ? target : null;
}

// Исходную группу перетаскиваемого размера на время drag прячем атрибутом,
// НЕ перерисовывая: иначе элемент под курсором выпал бы из DOM и браузер не
// прислал бы click (см. endDrag).
function setFinishedHidden(id, sheetId, hidden) {
  const svg = sheetSvg(sheetId);
  const el = svg && svg.querySelector && svg.querySelector(`[data-mk-id="${id}"]`);
  if (!el || !el.setAttribute) return;
  if (hidden) el.setAttribute('visibility', 'hidden');
  else if (el.removeAttribute) el.removeAttribute('visibility');
}

// ---------------------------------------------------------------------------
// Обработчики событий — навешаны один раз на document/window (делегирование):
// листы пересоздаются при каждой перерисовке чертежей.
// ---------------------------------------------------------------------------
function updateDrag(mx, my) {
  const d = dims.filter((x) => x.id === dragState.id)[0];
  if (!d) { dragState = null; return; }
  const dx = (mx - dragState.startX) * unitPx, dy = (my - dragState.startY) * unitPx;
  if (!dragState.moved && (Math.abs(dx) > DRAG_PX || Math.abs(dy) > DRAG_PX)) {
    dragState.moved = true;
    setFinishedHidden(d.id, dragState.sheet, true);
  }
  if (!dragState.moved) return;   // щелчок (выделение), не drag — вынос не трогаем
  const g = geom(d);
  if (!g) return;
  // Ориентация готового размера при перетаскивании не меняется — только вынос.
  d.offset = offsetFromCursor(sheetOf(d), d.view, g.pa, g.pb, d.orient, mx, my, d.id);
}

function updateHover(sheetId, mx, my) {
  shiftGuide = null;
  if (draft && draft.phase === 'pickB') {
    const view = viewOf(draft.sheet, draft.view);
    const pa = resolveAnchor(view, draft.a);
    if (!view || !pa) { hoverCandidate = null; return; }
    if (shiftDown) {
      const axis = shiftAxis(draft.a, pa, mx, my);
      shiftGuide = { axis, px: axis === 'h' ? mx : pa.sx, py: axis === 'h' ? pa.sy : my };
      const cand = shiftCandidate(view, draft.a, pa, axis, mx, my);
      hoverCandidate = cand ? Object.assign({ sheet: draft.sheet, view: view.name }, cand) : null;
      return;
    }
    const cand = nearestCandidate(view, mx, my);
    hoverCandidate = cand ? Object.assign({ sheet: draft.sheet, view: view.name }, cand) : null;
    return;
  }
  const view = viewAt(sheetId, mx, my);
  const cand = view ? nearestCandidate(view, mx, my) : null;
  hoverCandidate = cand ? Object.assign({ sheet: sheetId, view: view.name }, cand) : null;
}

function updateOffsetDraft(mx, my) {
  const view = viewOf(draft.sheet, draft.view);
  const pa = resolveAnchor(view, draft.a);
  const pb = resolveAnchor(view, draft.b);
  if (!pa || !pb) return;
  const o = chooseOrient(pa, pb, mx, my, draft.orient, draft.lock);
  if (!o) return;
  draft.orient = o;
  draft.offset = offsetFromCursor(draft.sheet, draft.view, pa, pb, o, mx, my, null);
}

function onMove(evt) {
  if (!active) return;
  shiftDown = !!evt.shiftKey;
  // Идёт drag/постановка — координаты всегда в листе, где их начали (курсор
  // может уйти за лист — вынос ограничится его рамкой).
  const busySheet = dragState ? dragState.sheet : (draft ? draft.sheet : null);
  if (busySheet) {
    const busySvg = sheetSvg(busySheet);
    if (!busySvg) { draft = null; dragState = null; refreshLive(); return; }   // лист исчез
    const p = svgPoint(busySvg, evt);
    if (!p) return;
    lastMouse = { sx: p.x, sy: p.y };
    if (dragState) updateDrag(p.x, p.y);
    else if (draft.phase === 'pickOffset') updateOffsetDraft(p.x, p.y);
    else updateHover(busySheet, p.x, p.y);
    refreshLive();
    return;
  }
  const svg = svgOfTarget(evt.target);
  const id = sheetIdOf(svg);
  if (!svg || !id || !sheets[id]) {
    if (hoverCandidate || hoverSheet) { hoverCandidate = null; hoverSheet = null; refreshLive(); }
    return;
  }
  const p = svgPoint(svg, evt);
  if (!p) return;
  lastMouse = { sx: p.x, sy: p.y };
  hoverSheet = id;
  updateHover(id, p.x, p.y);
  refreshLive();
}

function onDown(evt) {
  if (!active || draft) return;   // идёт постановка размера — щелчки принадлежат ей
  if (evt.button !== 0) return;   // ПКМ/колесо — панорама листа (ui-shell.js), не разметка
  const svg = svgOfTarget(evt.target);
  const sheetId = sheetIdOf(svg);
  if (!svg || !sheetId) return;
  const hit = evt.target.closest && evt.target.closest('.mk-dim');
  if (!hit) return;
  const id = Number(hit.getAttribute('data-mk-id'));
  if (!id) return;
  const p = svgPoint(svg, evt);
  if (!p) return;
  dragState = { id, sheet: sheetId, startX: p.x, startY: p.y, moved: false };
  evt.preventDefault();
}

function onUp(evt) {
  if (!active || !dragState) return;
  if (evt && evt.button != null && evt.button !== 0) return;   // отпустили не ЛКМ — drag идёт дальше
  endDrag();
}

// Завершение перетаскивания — по mouseup (на window: кнопку могли отпустить
// за пределами документа) и по потере фокуса окна (blur).
function endDrag() {
  if (!dragState) return;
  const id = dragState.id, sheetId = dragState.sheet;
  const moved = dragState.moved;
  justDragged = moved;
  dragState = null;
  // Перерисовку откладываем до окончания текущего ввода: браузер шлёт click
  // СРАЗУ после mouseup, и если здесь же заменить разметку, нажатый элемент
  // выпадает из DOM — Chrome/Edge тогда click не отправляют (проверено в
  // браузере). Заодно гасим justDragged, если click так и не пришёл.
  // notifyChange — тоже здесь: подписчик (app.js) пересобирает чертёж.
  setTimeout(() => {
    justDragged = false;
    setFinishedHidden(id, sheetId, false);
    refreshFinished(sheetId);
    refreshLive();
    if (moved) notifyChange();
  }, 0);
}

function onBlur() {
  shiftDown = false;
  if (dragState) endDrag();
}

function onClick(evt) {
  if (!active) return;
  if (justDragged) { justDragged = false; return; }
  shiftDown = !!evt.shiftKey;

  // Фаза выноса: щелчок засчитывается где угодно в области чертежей (вынос
  // можно увести за регион вида и даже за SVG листа — он ограничится рамкой
  // листа), координаты — в листе, где начата постановка.
  if (draft && draft.phase === 'pickOffset') {
    const svg = sheetSvg(draft.sheet);
    if (!svg) { draft = null; refreshLive(); return; }
    const pane = svg.closest && svg.closest('.tab-panel, .part-editor-body');
    if (!svg.contains(evt.target) && !(pane && pane.contains(evt.target))) return;
    const p = svgPoint(svg, evt);
    if (!p) return;
    updateOffsetDraft(p.x, p.y);
    if (!draft.orient) return;
    const rec = { id: nextId++, sheet: draft.sheet, view: draft.view, a: draft.a, b: draft.b,
      orient: draft.orient, offset: draft.offset || 0 };
    if (!geom(rec)) { nextId--; return; }   // нулевой размер не создаём
    const sheetId = draft.sheet;
    dims.push(rec);
    draft = null;
    refreshFinished(sheetId);
    refreshLive();
    notifyChange();
    return;
  }

  const svg = svgOfTarget(evt.target);
  const sheetId = sheetIdOf(svg);
  if (!svg || !sheetId || !sheets[sheetId]) return;
  // Вторая точка — только на листе, где поставлена первая.
  if (draft && draft.sheet !== sheetId) return;
  const p = svgPoint(svg, evt);
  if (!p) return;

  const hitDim = evt.target.closest && evt.target.closest('.mk-dim');
  if (hitDim && !draft) {
    const id = Number(hitDim.getAttribute('data-mk-id'));
    selectedId = (selectedId === id) ? null : id;
    refreshFinished();
    return;
  }

  if (!draft) {
    const view = viewAt(sheetId, p.x, p.y);
    const cand = view ? nearestCandidate(view, p.x, p.y) : null;
    if (cand) {
      draft = { sheet: sheetId, view: view.name, a: cand.anchor, phase: 'pickB' };
      selectedId = null;
      refreshFinished();
    } else if (selectedId != null) {
      selectedId = null;
      refreshFinished();
    }
    updateHover(sheetId, p.x, p.y);
    refreshLive();
    return;
  }

  if (draft.phase === 'pickB') {
    const view = viewOf(draft.sheet, draft.view);
    const pa = resolveAnchor(view, draft.a);
    if (!pa) { draft = null; refreshLive(); return; }
    let cand, lock = null;
    if (shiftDown) {
      lock = shiftAxis(draft.a, pa, p.x, p.y);
      cand = shiftCandidate(view, draft.a, pa, lock, p.x, p.y);
    } else {
      cand = nearestCandidate(view, p.x, p.y);
    }
    if (!cand) return;
    if (sameAnchor(draft.a, cand.anchor)) return;
    const pb = resolveAnchor(view, cand.anchor);
    if (!pb || !pairUsable(pa, pb)) return;
    const o = chooseOrient(pa, pb, p.x, p.y, null, lock);
    if (!o) return;
    draft.b = cand.anchor;
    draft.lock = lock;
    draft.phase = 'pickOffset';
    draft.orient = o;
    draft.offset = offsetFromCursor(draft.sheet, draft.view, pa, pb, o, p.x, p.y, null);
    hoverCandidate = null; shiftGuide = null;
    refreshLive();
  }
}

// Shift нажали/отпустили без движения мыши — перерисовать резиновую линию.
function onShiftChange(down) {
  if (shiftDown === down) return;
  shiftDown = down;
  if (draft && draft.phase === 'pickB' && lastMouse) {
    updateHover(draft.sheet, lastMouse.sx, lastMouse.sy);
    refreshLive();
  }
}

function onKey(evt) {
  if (!active) return;
  if (evt.key === 'Shift') { onShiftChange(true); return; }
  const tg = (evt.target && evt.target.tagName) || '';
  if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
  if (evt.target && evt.target.isContentEditable) return;

  if (evt.key === 'Delete' || evt.key === 'Backspace') {
    if (selectedId == null) return;   // ничего не выделено — не наша клавиша
    dims = dims.filter((d) => d.id !== selectedId);
    selectedId = null;
    refreshFinished();
    notifyChange();
    evt.preventDefault();
    // ВАЖНО: у app.js есть свой ГЛОБАЛЬНЫЙ обработчик keydown на Delete —
    // он удаляет активный 3D-модуль (app.js: deleteModule). preventDefault()
    // его не остановит — нужен stopImmediatePropagation(), иначе Delete по
    // выделенному размеру ОДНОВРЕМЕННО удалит и весь модуль.
    evt.stopImmediatePropagation();
  } else if (evt.key === 'Escape') {
    if (draft) { draft = null; shiftGuide = null; refreshLive(); evt.stopImmediatePropagation(); }
    else if (selectedId != null) { selectedId = null; refreshFinished(); evt.stopImmediatePropagation(); }
  }
}

function onKeyUp(evt) {
  if (!active) return;
  if (evt.key === 'Shift') onShiftChange(false);
}

function ensureListeners() {
  if (listenersBound) return;
  listenersBound = true;
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mousedown', onDown);
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onBlur);
  } else {
    document.addEventListener('mouseup', onUp);
  }
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);
}

// ---------------------------------------------------------------------------
// Стили — свой набор классов (mk-*), не трогает DRAWINGS_CSS в drawings.js.
// Синий — то, что сейчас редактируется/наведено, оранжевый — выбранный
// готовый размер, красный — эта точка не годится (совпадает с первой).
// ---------------------------------------------------------------------------
const MARKUP_CSS = `
.mk-hl,.mk-anchor,.mk-draft-line,.mk-draft{pointer-events:none}
.mk-hl-mark{fill:none;stroke-width:1.3}
.mk-hl-ok .mk-hl-mark{stroke:#1a73e8}
.mk-hl-bad .mk-hl-mark{stroke:#d63333}
.mk-anchor .mk-hl-mark{stroke:#1a73e8;stroke-width:1.8}
.mk-draft-line{stroke:#1a73e8;stroke-width:.9;stroke-dasharray:4 3}
.mk-shift-line{stroke-dasharray:none;stroke-width:1.1}
.mk-draft .dw-dim,.mk-draft .dw-ext{stroke:#1a73e8}
.mk-draft .dw-arrow{fill:#1a73e8}
.mk-draft .dw-dt{fill:#1a73e8}
.mk-dim{cursor:pointer}
.mk-dim .mk-hit{fill:none;stroke:transparent;stroke-width:10;cursor:move}
.mk-dim-sel .dw-dim,.mk-dim-sel .dw-ext{stroke:#d6820a}
.mk-dim-sel .dw-arrow{fill:#d6820a}
.mk-dim-sel .dw-dt{fill:#d6820a;font-weight:700}
`;

function ensureStyle() {
  if (styleInjected) return;
  if (typeof document === 'undefined' || !document.head
    || typeof document.createElement !== 'function') return;
  styleInjected = true;
  const style = document.createElement('style');
  style.id = 'mk-style';
  style.textContent = MARKUP_CSS;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Публичное API
// ---------------------------------------------------------------------------
function setActive(v) {
  active = !!v;
  if (!active) { draft = null; dragState = null; hoverCandidate = null; hoverSheet = null; shiftGuide = null; }
  refreshLive();
}
function isActive() { return active; }

function getData() { return dims.map((d) => JSON.parse(JSON.stringify(d))); }

const ANCHOR_KINDS = { corner: 1, edgePoint: 1, holeCenter: 1 };
function cleanAnchor(a) {
  if (!a || typeof a !== 'object') return null;
  if (typeof a.moduleUid !== 'string' || !a.moduleUid) return null;
  if (typeof a.key !== 'string' || !a.key) return null;
  if (!ANCHOR_KINDS[a.kind]) return null;
  if (!a.local || typeof a.local !== 'object') return null;
  const local = {};
  if (a.kind === 'holeCenter') {
    if (typeof a.local.holeIndex !== 'number' || !isFinite(a.local.holeIndex)) return null;
    local.holeIndex = a.local.holeIndex;
    for (const k of ['hx', 'hy', 'hd']) {
      const v = Number(a.local[k]);
      if (a.local[k] != null && isFinite(v)) local[k] = v;
    }
  } else {
    const h = Number(a.local.h), v = Number(a.local.v);
    if (!isFinite(h) || !isFinite(v)) return null;
    local.h = clamp(h, -1, 1); local.v = clamp(v, -1, 1);
  }
  return { moduleUid: a.moduleUid, key: a.key, kind: a.kind, local };
}

function setData(list) {
  const out = [];
  const used = new Set();
  const src = Array.isArray(list) ? list : [];
  for (const d of src) {
    if (!d || typeof d !== 'object') continue;
    if (d.view !== 'front' && d.view !== 'side' && d.view !== 'top') continue;
    const a = cleanAnchor(d.a), b = cleanAnchor(d.b);
    if (!a || !b) continue;
    let id = Number(d.id);
    if (!(id > 0) || Math.floor(id) !== id || used.has(id)) id = 0;
    if (id) used.add(id);
    const sheet = (typeof d.sheet === 'string' && d.sheet) ? d.sheet : OVERVIEW;
    const rec = { id, sheet, view: d.view, a, b };
    if (d.orient === 'h' || d.orient === 'v') {
      rec.orient = d.orient;
      const o = Number(d.offset);
      rec.offset = isFinite(o) ? clamp(o, -MAX_OFFSET_MM, MAX_OFFSET_MM) : 0;
    } else if (d.level != null || d.dir != null) {
      rec.dir = d.dir === -1 ? -1 : 1;
      rec.level = clamp(Math.round(Number(d.level)) || 0, 0, 40);
    } else {
      rec.offset = 0;
    }
    out.push(rec);
  }
  let maxId = 0;
  for (const d of out) maxId = Math.max(maxId, d.id);
  for (const d of out) if (!d.id) d.id = ++maxId;
  dims = out;
  nextId = maxId + 1;
  selectedId = null; draft = null; dragState = null; justDragged = false;
  hoverCandidate = null; shiftGuide = null;
  refreshFinished(); refreshLive();
}

function clearAll() {
  const had = dims.length > 0;
  dims = []; selectedId = null; draft = null; dragState = null;
  refreshFinished(); refreshLive();
  if (had) notifyChange();
}

// Сколько размеров сейчас ВИДНО на всех листах (для «Очистить всё»).
// Размеры исчезнувших листов/деталей хранятся (для Ctrl+Z), но не считаются.
// Пока чертежи ни разу не собирались — судить не по чему, считаем все.
function count() {
  if (!lastModel || !Object.keys(sheets).length) return dims.length;
  let n = 0;
  for (const d of dims) {
    const sh = sheetOf(d);
    if (sheets[sh]) { if (geom(d)) n++; continue; }
    // Лист редактора детали, когда окно закрыто, не зарегистрирован — но его
    // размеры живые, пока жива сама деталь (их тоже чистит «Очистить всё»).
    if (sh.indexOf('editor:') === 0 && editorPartExists(sh)) n++;
  }
  return n;
}
// Модель последнего пересчёта (app.js: recompute → setModel) — актуальнее
// lastModel, который обновляется только при сборке листов (вкладка
// «Чертежи» собирается лениво).
let latestModel = null;
function setModel(model) { if (model) latestModel = model; }

function editorPartExists(sheetId) {
  const rest = sheetId.slice('editor:'.length);
  const cut = rest.indexOf('|');
  if (cut < 0) return false;
  const uid = rest.slice(0, cut), key = rest.slice(cut + 1);
  const m = latestModel || lastModel;
  return ((m && m.partsRaw) || []).some((r) => r.moduleUid === uid && r.anchorKey === key);
}

function onChange(fn) { changeListener = typeof fn === 'function' ? fn : null; }
// Подписчик на ТЕХНИЧЕСКУЮ миграцию старых записей (смысл размера не
// меняется, меняется только форма записи). Не правка пользователя — app.js
// лишь переписывает верхний снимок истории, без нового шага отмены.
function onMigrate(fn) { migrateListener = typeof fn === 'function' ? fn : null; }

const MIN_FONT = 6, MAX_FONT = 24;   // тот же диапазон, что у ползунка в настройках
function setFontScale(px) {
  fontScale = clamp(Math.round(Number(px)) || DEFAULT_FONT, MIN_FONT, MAX_FONT);
  refreshFinished(); refreshLive();
}
function getFontScale() { return fontScale; }

// --- Интеграция с drawings.js ---
// beginSheets() — в начале каждой сборки чертежей (buildDrawings): реестр
// листов собирается заново, листы удалённых модулей/деталей исчезают.
function beginSheets() {
  // Лист редактора детали строится вне buildDrawings (своё окно) — его не
  // трогаем, иначе пересборка чертежей «отключала» бы открытый редактор.
  const keep = {};
  for (const id of Object.keys(sheets)) if (id.indexOf('editor:') === 0) keep[id] = sheets[id];
  sheets = keep;
  partMemberSheet = {};
  if (liveShownSheet && !sheets[liveShownSheet]) liveShownSheet = null;
  hoverSheet = null; hoverCandidate = null;
  // Начатая постановка/перетаскивание на листе, которого после пересборки
  // не стало, сбрасываются в onMove/onClick (sheetSvg() вернёт null).
}

// attachSheet(sheetId, model, views, rect) — вызывается ВНУТРИ построения
// каждого листа. views — контексты видов листа (name/hAxis/vAxis/sx/sy/rows/
// region/noHoles[/holeScreen]); rect — рамка листа {x,y,w,h} ДО ручных
// размеров (предел выноса). Возвращает SVG-фрагмент: группа готовых
// размеров листа + пустая «живая» группа для интерактива.
function attachSheet(sheetId, model, views, rect) {
  if (!sheetId) return '';
  if (model) lastModel = model;
  const map = {};
  for (const v of views || []) map[v.name] = v;
  sheets[sheetId] = { views: map, rect: (rect && isFinite(rect.x) && isFinite(rect.w)) ? rect : null };
  for (const v of views || []) {
    for (const m of v.members || []) partMemberSheet[m] = sheetId;
  }
  if (migrateSheet(sheetId) && migrateListener) {
    try { migrateListener(); } catch (err) { console.error('markup onMigrate failed:', err); }
  }
  ensureStyle();
  ensureListeners();
  const attr = escAttr(sheetId);
  return `<g class="mk-finished" data-mk-sheet="${attr}">${renderFinishedGroup(sheetId)}</g>`
    + `<g class="mk-live" data-mk-sheet="${attr}"></g>`;
}

// Отмена начатой постановки размера (как Esc) — ui-shell.js зовёт на простой
// щелчок ПКМ в режиме разметки. Возвращает true, если было что отменять.
function cancelDraft() {
  if (!draft) return false;
  draft = null; shiftGuide = null; hoverCandidate = null;
  refreshLive();
  return true;
}

// Снять лист с учёта (закрыто окно редактора детали): начатая на нём
// постановка/перетаскивание отменяются, данные размеров остаются.
function dropSheet(sheetId) {
  if (!sheets[sheetId]) return;
  delete sheets[sheetId];
  if (draft && draft.sheet === sheetId) draft = null;
  if (dragState && dragState.sheet === sheetId) dragState = null;
  if (hoverCandidate && hoverCandidate.sheet === sheetId) hoverCandidate = null;
  if (hoverSheet === sheetId) hoverSheet = null;
  if (liveShownSheet === sheetId) liveShownSheet = null;
}

// Совместимость: общий вид как один из листов.
function attachOverview(model, views, rect) {
  return attachSheet(OVERVIEW, model, views, rect);
}

// Слушатели вешаем СРАЗУ при загрузке этого файла: порядок регистрации на
// document.keydown решает исход stopImmediatePropagation() — он останавливает
// только обработчики, зарегистрированные ПОЗЖЕ. markup.js подключается в
// index.html раньше app.js, поэтому наш Delete гарантированно раньше
// глобального Delete-обработчика app.js (удаление активного 3D-модуля).
ensureListeners();

window.Modul3D = window.Modul3D || {};
window.Modul3D.markup = {
  setActive, isActive, getData, setData, clearAll, setFontScale, getFontScale,
  count, onChange, onMigrate, cancelDraft, setModel,
  // используется только drawings.js — не часть UI API
  beginSheets, attachSheet, attachOverview, dropSheet,
};
})();
