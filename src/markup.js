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
//   view — вид на этом листе ('front'|'side'|'top'; у 3D-листа 'view3d' —
//     'front'|'side'|'top'|'right'|'back'|'bottom', см. «3D-ОВЕРЛЕЙ»).
//   orient — что измеряет размер: 'h' — разницу вдоль горизонтальной оси
//     вида (view.hAxis), размерная линия горизонтальна; 'v' — вдоль
//     вертикальной (view.vAxis). Длина = проекция AB на эту ось.
//   offset — положение размерной линии в ММ МОДЕЛИ (единицы вдоль оси,
//     перпендикулярной размеру), со знаком, ОТ ТОЧКИ A. Не пиксели и не
//     «уровни» — при другом масштабе листа/печати размер стоит там же
//     относительно детали. Выносные линии от A и от B разной длины, как в ЕСКД.
//     Исключение — вид с полем view.offsetOutside (3D-оверлей): за габаритом
//     деталей вида линия стоит на постоянном экранном расстоянии от края
//     изделия, не завися от зума (как авто-размеры вьювера); в записи вынос
//     всё равно хранится в мм от A.
//     См. lineFromOffset/offsetFromLine.
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
// ЛИСТ ОТОБРАЖЕНИЯ И ЛИСТ ДАННЫХ. Обычно это одно и то же (id листа = поле
// sheet записи). Внешний лист может хранить записи под ДРУГИМ id: attachSheet(id,
// model, views, rect, { dataSheet, external }) — лист id показывает и создаёт
// записи с sheet = dataSheet, но геометрию считает по СВОИМ контекстам видов.
// Так 3D-вьювер (лист отображения 'viewer3d') хранит свои размеры в листе
// данных 'view3d'. Разметка 3D и чертежей ПОЛНОСТЬЮ РАЗДЕЛЬНА (решение
// пользователя 2026-09-28): поставленное в 3D не появляется на «Общем виде»,
// а размеры «Общего вида» ('overview') не показываются в 3D. Внутри ядра:
//   dataKey(листОтображения) — лист данных; sheetOf(запись) — лист данных
//   записи; запись видна на листе S, если sheetOf(d) === dataKey(S) (и у S
//   есть вид с именем d.view); geom(d, S) — геометрия записи по видам листа S.
//
// 3D-ОВЕРЛЕЙ (viewer.js; ядро о Three.js ничего не знает):
//   • <svg class="mk-root" data-mk-sheet="viewer3d"> поверх canvas, 1 единица
//     = 1 CSS px. Внутрь — строка, которую вернул attachSheet (группы
//     g.mk-finished и g.mk-live). Пока режим разметки включён, svg должен
//     получать события мыши (evt.target — внутри svg), иначе наведение/клики
//     не дойдут до ядра (ядро слушает document и ищет closest('svg.mk-root')).
//   • Контейнер, внутри которого клик фазы выноса засчитывается (как
//     .tab-panel у чертежей), помечается классом 'mk-pane'.
//   • Регистрируется ОДИН вид — текущий: attachSheet('viewer3d', model,
//     [view], null, { dataSheet: 'view3d', external: true }).
//     rect = null — вынос без ограничения рамкой. Все 6 видов 3D пишут в
//     лист данных 'view3d'; вид камеры → имя вида в данных:
//       3D 'front' → 'front'   3D 'side' (камера справа) → 'right'
//       3D 'left'  → 'side'    3D 'back'                 → 'back'
//       3D 'top'   → 'top'     3D 'bottom'               → 'bottom'
//     Записи 'view3d' видны только в 3D,
//     сохраняются в проект/историю как все остальные.
//   • Камера сдвинулась (зум/панорама) — вьювер заново вызывает attachSheet с
//     новыми sx/sy и кладёт результат в свой svg, затем refreshSheet(id,
//     { skipFinished: true }) (дорисовать «живой» слой; готовые размеры уже
//     нарисованы attachSheet — второй раз их не рисуем). Смена имени вида/листа данных отменяет
//     начатую на этом листе постановку. Уход в перспективу — dropSheet(id).
//     beginSheets() (пересборка чертежей) внешние листы не трогает.
//   • Необязательные хуки контекста вида (у чертежей их нет, кроме
//     depthOf у видов общего вида — drawings.js buildOverview):
//       view.pickFilter(row, wh, wv, kind, draftAnchor) → boolean — можно ли
//         ловить точку (kind: 'corner'|'edgePoint'|'holeCenter'; wh/wv — мм
//         вдоль hAxis/vAxis; draftAnchor — точка A при выборе B, иначе null);
//       view.depthOf(row) → number — глубина детали (меньше = ближе к
//         зрителю): при почти равном экранном расстоянии (< DEPTH_TIE единиц
//         листа) побеждает более близкая деталь.
//     view.holeScreen(row, i) → {x, y, wh, wv} | null — как у листа детали.
//     view.offsetOutside = { K, h:{min,max}, v:{min,max} } — кусочная
//       проекция размерной линии (мм → экран). min/max — габарит нарисованных
//       деталей вида вдоль hAxis/vAxis (мм), K — px на 1 мм выноса ЗА ним.
//       Линия W = A + offset: внутри [min,max] — view.sx/sy(W) (с зумом),
//       снаружи — экран(края) ± dir × расстояние_до_края × K (зазор от края
//       изделия постоянен при зуме). Постановка/перетаскивание/магнит —
//       обратным преобразованием (axisFromScreen), offset = W − A в мм.
//
// UI: кнопка «Разметка» / «Очистить всё» в полосе вкладок «Документы»
// (index.html #markupTools, app.js: initMarkupUI), кнопка «Разметка» на
// панели режимов 3D-вида (#vtMarkupBtn, только в плоских видах), размер шрифта — в окне
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
const VIEW3D = 'view3d';   // лист данных всех размеров 3D-вьювера (см. шапку)
const HOLE_EPS = 0.5;      // мм: допуск совпадения центра отверстия (hx/hy) и диаметра
const DEPTH_TIE = 0.5;     // единицы листа: кандидаты «на одном месте» — решает view.depthOf
// Имена видов в данных: чертежи ('front'|'side'|'top') и 3D-лист 'view3d'.
const VIEW_NAMES = { front: 1, side: 1, top: 1, right: 1, back: 1, bottom: 1 };
const VIEW_ORDER = ['front', 'side', 'top', 'right', 'back', 'bottom'];

// --- Состояние модуля (единственный источник истины для сохранения в проект) ---
let active = false;
let fontScale = DEFAULT_FONT;
let dims = [];            // [{id, sheet, view, a, b, orient, offset}] (+ старые dir/level до миграции)
let nextId = 1;

let lastModel = null;     // модель последней сборки чертежей
// Реестр листов текущей сборки:
//   { [sheetId]: { views:{<имя вида>: ctx}, rect, dataSheet, external } }
// rect — рамка листа БЕЗ ручных размеров {x,y,w,h} (предел выноса) или null.
// dataSheet — лист данных (null — сам sheetId); external — лист живёт вне
// вкладки «Чертежи» (beginSheets его не сбрасывает).
let sheets = {};
// 'uid|anchorKey' детали → id группового листа детали, где она сейчас
// нарисована (заполняется attachSheet по view.members).
let partMemberSheet = {};
let unitPx = 1;           // экранных px на единицу листа (масштаб ui-shell учтён)

// draft: { sheet, data, view, a, phase:'pickB'|'pickOffset', b?, lock?, orient?, offset? }
// sheet — лист ОТОБРАЖЕНИЯ (где идёт постановка), data — лист данных новой записи.
// dragState.sheet, hoverCandidate.sheet, hoverSheet — тоже листы отображения.
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
// Лист данных для листа отображения (см. шапку). Для обычных листов — сам id.
function dataKey(sheetId) {
  const sh = sheets[sheetId];
  return (sh && sh.dataSheet) || sheetId;
}
// Показывается ли запись на листе отображения sheetId.
function shownOn(d, sheetId) {
  return sheetOf(d) === dataKey(sheetId);
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
function linAxis(view, axis) {
  return axis === 'h' ? (view._lh || (view._lh = linOf(view.sx))) : (view._lv || (view._lv = linOf(view.sy)));
}
function worldFromScreen(view, axis, s) {
  const L = linAxis(view, axis);
  return L.k ? (s - L.b) / L.k : 0;
}

// Вынос размерной линии: offset (мм от точки A) ↔ экранная координата линии.
// Мировая координата линии (мм вдоль оси, перпендикулярной размеру) —
// W = A + offset. Обычно (чертежи, лист детали) линия просто там, где на
// листе лежит W, и вместе с листом масштабируется.
// Если у вида задан view.offsetOutside = { K, h:{min,max}, v:{min,max} }
// (3D-оверлей, см. шапку) — проекция КУСОЧНАЯ: внутри габарита [min, max]
// нарисованных деталей по этой оси — обычная (линия движется с геометрией),
// а за габаритом — от края габарита в ПОСТОЯННЫХ экранных единицах:
// экран(max) + dir × (W − max) × K (и зеркально ниже min), dir — куда на
// экране растёт ось. Так зазор от края изделия не меняется при зуме, как у
// авто-размеров вьювера. Сами A/B и длина размера — по геометрии.
function axisToScreen(view, axis, W) {
  const L = linAxis(view, axis);
  const oo = view.offsetOutside, r = oo && oo[axis];
  const K = oo ? Number(oo.K) : 0;
  if (r && isFinite(K) && K > 0 && isFinite(r.min) && isFinite(r.max)) {
    const dir = L.k < 0 ? -1 : 1;
    if (W > r.max) return L.k * r.max + L.b + dir * (W - r.max) * K;
    if (W < r.min) return L.k * r.min + L.b - dir * (r.min - W) * K;
  }
  return axis === 'h' ? view.sx(W) : view.sy(W);   // как было — точная проекция вида
}
function axisFromScreen(view, axis, s) {
  const L = linAxis(view, axis);
  const oo = view.offsetOutside, r = oo && oo[axis];
  const K = oo ? Number(oo.K) : 0;
  if (r && isFinite(K) && K > 0 && isFinite(r.min) && isFinite(r.max)) {
    const dir = L.k < 0 ? -1 : 1;
    const beyondMax = (s - (L.k * r.max + L.b)) * dir;   // px за краем max
    if (beyondMax > 0) return r.max + beyondMax / K;
    const beyondMin = ((L.k * r.min + L.b) - s) * dir;   // px за краем min
    if (beyondMin > 0) return r.min - beyondMin / K;
  }
  return L.k ? (s - L.b) / L.k : 0;
}
function lineFromOffset(view, orient, pa, off) {
  return orient === 'h' ? axisToScreen(view, 'v', pa.wv + off) : axisToScreen(view, 'h', pa.wh + off);
}
function offsetFromLine(view, orient, pa, line) {
  return orient === 'h' ? axisFromScreen(view, 'v', line) - pa.wv : axisFromScreen(view, 'h', line) - pa.wh;
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
    offset = offsetFromLine(view, orient, pa, (orient === 'h' ? pa.sy : pa.sx) + off);
  }
  return { orient, offset: Math.round(offset * 10) / 10 };
}

// Мигрирует старые записи ОДНОГО листа на месте. Возвращает true, если
// что-то изменилось (см. attachSheet: подписчик onMigrate в app.js
// переписывает верхний снимок истории, чтобы миграция не порождала
// лишний шаг отмены).
function migrateSheet(sheetId) {
  // Старый формат бывает только у чертежей; вынос считался в единицах
  // чертежа — по чужому (3D) масштабу мигрировать нельзя.
  if (sheets[sheetId] && sheets[sheetId].dataSheet) return false;
  let changed = false;
  for (const d of dims) {
    if (!shownOn(d, sheetId) || d.orient === 'h' || d.orient === 'v' || d.orient === 'dia') continue;
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

// Полная экранная геометрия размера или null (не рисуется). dispSheet — лист
// отображения, по видам которого считать (по умолчанию — лист данных записи).
function geom(d, dispSheet) {
  if (d.orient === 'dia') return null;   // выноска диаметра — см. diaGeom
  const view = viewOf(dispSheet || sheetOf(d), d.view);
  if (!view) return null;
  const pa = resolveAnchor(view, d.a);
  const pb = resolveAnchor(view, d.b);
  if (!pa || !pb) return null;
  const legacy = (d.orient !== 'h' && d.orient !== 'v') ? migratedValues(d, view, pa, pb) : null;
  const orient = legacy ? legacy.orient : d.orient;
  const lenMM = orient === 'h' ? Math.abs(pa.wh - pb.wh) : Math.abs(pa.wv - pb.wv);
  if (lenMM < ALIGN_EPS) return null;
  const off = legacy ? legacy.offset : (Number(d.offset) || 0);
  const line = lineFromOffset(view, orient, pa, off);
  const span = orient === 'h'
    ? [Math.min(pa.sx, pb.sx), Math.max(pa.sx, pb.sx)]
    : [Math.min(pa.sy, pb.sy), Math.max(pa.sy, pb.sy)];
  return { orientation: orient, pa, pb, line, span, lenMM, view };
}

// Выноска диаметра отверстия (запись orient 'dia': a — центр отверстия, b = a,
// lh/lv — положение конца выноски в мм от центра вдоль осей вида). Ставится
// вторым щелчком по тому же отверстию. Возвращает экранную геометрию или null.
function diaGeom(d, dispSheet) {
  const view = viewOf(dispSheet || sheetOf(d), d.view);
  if (!view || !d.a || d.a.kind !== 'holeCenter') return null;
  const pa = resolveAnchor(view, d.a);
  const row = findRow(view, d.a);
  if (!pa || !row) return null;
  const idx = holeIndexFor(row, d.a.local);
  const dia = idx >= 0 ? Number(row.holes[idx].d) : NaN;
  if (!isFinite(dia) || dia <= 0) return null;
  return diaGeomAt(view, pa, dia, Number(d.lh) || 0, Number(d.lv) || 0);
}
function diaGeomAt(view, pa, dia, lh, lv) {
  const ex = view.sx(pa.wh + lh), ey = view.sy(pa.wv + lv);
  const rs = Math.abs(view.sx(pa.wh + dia / 2) - view.sx(pa.wh));   // радиус на экране
  return { pa, dia, ex, ey, rs, label: 'Ø' + String(Math.round(dia * 10) / 10) };
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
    fn(anchorOf(row, 'holeCenter', local), pos.x, pos.y, row, pos.wh, pos.wv);
  }
}

// Хуки вида (3D-оверлей, см. шапку). Без хуков — поведение чертежей.
function pickOk(view, row, wh, wv, kind, draftAnchor) {
  if (typeof view.pickFilter !== 'function') return true;
  try { return !!view.pickFilter(row, wh, wv, kind, draftAnchor || null); }
  catch (err) { console.error('markup pickFilter failed:', err); return false; }
}
function depthOfRow(view, row) {
  if (typeof view.depthOf !== 'function') return 0;
  const z = Number(view.depthOf(row));
  return isFinite(z) ? z : 0;
}
// Лучше ли кандидат (расстояние d, деталь row) текущего лучшего. Без
// view.depthOf — строго меньшее расстояние (как раньше); с ним при почти
// равном расстоянии побеждает деталь ближе к зрителю («передний уголок»).
function beats(view, d, row, bestD, bestZ) {
  if (typeof view.depthOf !== 'function') return d < bestD;
  if (d < bestD - DEPTH_TIE) return true;
  if (d > bestD + DEPTH_TIE) return false;
  const z = depthOfRow(view, row);
  if (z !== bestZ) return z < bestZ;
  return d < bestD;
}

// draftAnchor — точка A, если сейчас выбирается B (для view.pickFilter).
function nearestCandidate(view, mx, my, draftAnchor) {
  let bestOther = null, bestOtherD = Infinity, bestOtherZ = Infinity;
  const considerOther = (anchor, sx, sy, row, wh, wv) => {
    const dx = sx - mx, dy = sy - my, d = Math.sqrt(dx * dx + dy * dy);
    if (!beats(view, d, row, bestOtherD, bestOtherZ)) return;
    if (!pickOk(view, row, wh, wv, anchor.kind, draftAnchor)) return;
    bestOtherD = d; bestOtherZ = depthOfRow(view, row);
    bestOther = { anchor, sx, sy, dist: d };
  };
  let bestCorner = null, bestCornerD = Infinity, bestCornerZ = Infinity;
  const considerCorner = (anchor, sx, sy, row, wh, wv) => {
    const dx = sx - mx, dy = sy - my, d = Math.sqrt(dx * dx + dy * dy);
    if (!beats(view, d, row, bestCornerD, bestCornerZ)) return;
    if (!pickOk(view, row, wh, wv, 'corner', draftAnchor)) return;
    bestCornerD = d; bestCornerZ = depthOfRow(view, row);
    bestCorner = { anchor, sx, sy, dist: d };
  };

  for (const row of view.rows) {
    if (!anchorable(row)) continue;   // фурнитура/детали без якоря не размечаются
    const fr = rowFrame(view, row);
    if (!fr) continue;
    const corners = [];
    for (const h of [-1, 1]) {
      for (const v of [-1, 1]) {
        const wh = fr.worldH(h), wv = fr.worldV(v);
        const sx = view.sx(wh), sy = view.sy(wv);
        corners.push({ h, v, sx, sy });
        considerCorner(anchorOf(row, 'corner', { h, v }), sx, sy, row, wh, wv);
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
      considerOther(anchorOf(row, 'edgePoint', { h, v }), sx, sy, row, fr.worldH(h), fr.worldV(v));
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
  let best = null, bestScore = Infinity, bestZ = Infinity;
  const consider = (anchor, sx, sy, radius, bias, row, wh, wv) => {
    const along = axis === 'h' ? Math.abs(sx - px) : Math.abs(sy - py);
    const perp = axis === 'h' ? Math.abs(sy - py) : Math.abs(sx - px);
    if (perp > HIT_RADIUS || along > radius) return;
    const len = axis === 'h' ? Math.abs(sx - pa.sx) : Math.abs(sy - pa.sy);
    if (len < 0.5 || sameAnchor(anchor, aAnchor)) return;
    const score = along - bias;
    if (!beats(view, score, row, bestScore, bestZ)) return;
    if (!pickOk(view, row, wh, wv, anchor.kind, aAnchor)) return;
    bestScore = score; bestZ = depthOfRow(view, row);
    best = { anchor, sx, sy, dist: along };
  };
  for (const row of view.rows) {
    if (!anchorable(row)) continue;
    const fr = rowFrame(view, row);
    if (!fr) continue;
    for (const h of [-1, 1]) {
      for (const v of [-1, 1]) {
        const wh = fr.worldH(h), wv = fr.worldV(v);
        consider(anchorOf(row, 'corner', { h, v }), view.sx(wh), view.sy(wv),
          CORNER_RADIUS, CORNER_MARGIN, row, wh, wv);
      }
    }
    if (axis === 'h') {
      const ya = view.sy(fr.worldV(-1)), yb = view.sy(fr.worldV(1));
      if (py >= Math.min(ya, yb) - 0.01 && py <= Math.max(ya, yb) + 0.01) {
        const v = fr.localV(worldFromScreen(view, 'v', py));
        for (const h of [-1, 1]) {
          consider(anchorOf(row, 'edgePoint', { h, v }), view.sx(fr.worldH(h)), py, HIT_RADIUS, 0,
            row, fr.worldH(h), fr.worldV(v));
        }
      }
    } else {
      const xa = view.sx(fr.worldH(-1)), xb = view.sx(fr.worldH(1));
      if (px >= Math.min(xa, xb) - 0.01 && px <= Math.max(xa, xb) + 0.01) {
        const h = fr.localH(worldFromScreen(view, 'h', px));
        for (const v of [-1, 1]) {
          consider(anchorOf(row, 'edgePoint', { h, v }), px, view.sy(fr.worldV(v)), HIT_RADIUS, 0,
            row, fr.worldH(h), fr.worldV(v));
        }
      }
    }
    holeCandidates(view, row, (anchor, sx, sy, r, wh, wv) => consider(anchor, sx, sy, HIT_RADIUS, 0, r, wh, wv));
  }
  return best;
}

// Запас вокруг границы региона вида (крайние точки деталей лежат ровно на
// границе region; обратное преобразование координат мыши даёт погрешность).
const VIEW_MARGIN = CORNER_RADIUS;

function viewAt(sheetId, mx, my) {
  const sh = sheets[sheetId];
  if (!sh) return null;
  for (const name of VIEW_ORDER) {
    const v = sh.views[name];
    if (!v) continue;
    const rg = v.region;
    if (!rg) return v;   // вид без региона (3D-оверлей) — весь лист
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
// рамки СВОЕГО листа (rect = null — без ограничения), с «магнитом» к линии
// соседнего ручного размера того же вида и того же листа данных и той же
// ориентации (в пределах SNAP_PX экранных px, если отрезки не перекрываются).
// sheetId — лист ОТОБРАЖЕНИЯ: геометрия соседей считается по его видам.
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
    if (d.id === excludeId || !shownOn(d, sheetId) || d.view !== viewName) continue;
    const g = geom(d, sheetId);
    if (!g || g.orientation !== orient) continue;
    const dd = Math.abs(g.line - L);
    if (dd > bestD) continue;
    const clash = Math.min(g.span[1], span[1]) - Math.max(g.span[0], span[0]) > CLASH_CLEAR;
    if (clash) continue;
    snapTo = g.line; bestD = dd;
  }
  if (snapTo != null) L = snapTo;
  const off = offsetFromLine(view, orient, pa, L);
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

// Выноска диаметра: стрелка на кромке отверстия, линия к концу, полка с
// подписью «Ø8». Возвращает { svg, hit } — рисунок и невидимая зона щелчка.
function diaSVG(g) {
  const A = arrowSize();
  let dx = g.ex - g.pa.sx, dy = g.ey - g.pa.sy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) { dx = 1; dy = -1; }
  const L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;      // от центра к концу
  const tx = g.pa.sx + ux * g.rs, ty = g.pa.sy + uy * g.rs;    // точка на кромке
  const ex = len < g.rs + 1 ? g.pa.sx + ux * (g.rs + 12) : g.ex;
  const ey = len < g.rs + 1 ? g.pa.sy + uy * (g.rs + 12) : g.ey;
  const lw = g.label.length * fontScale * 0.62 + 4;
  const dir = ex >= tx ? 1 : -1;                                // полка уходит от отверстия
  const sx2 = ex + dir * lw;
  let s = lineSVG(tx, ty, ex, ey, 'dw-dim');
  s += lineSVG(ex, ey, sx2, ey, 'dw-dim');
  // Стрелка остриём в кромку (от конца выноски к отверстию).
  s += `<polygon class="dw-arrow" points="${r2(tx)},${r2(ty)} `
    + `${r2(tx + ux * A - uy * 1.2)},${r2(ty + uy * A + ux * 1.2)} `
    + `${r2(tx + ux * A + uy * 1.2)},${r2(ty + uy * A - ux * 1.2)}"/>`;
  s += `<text x="${r2((ex + sx2) / 2)}" y="${r2(ey - 2.5)}" class="dw-dt" text-anchor="middle"${fontAttr()}>${escTxt(g.label)}</text>`;
  const hit = `<polyline points="${r2(tx)},${r2(ty)} ${r2(ex)},${r2(ey)} ${r2(sx2)},${r2(ey)}" class="mk-hit" fill="none" style="cursor:pointer"/>`;
  const x0 = Math.min(tx, ex, sx2), x1 = Math.max(tx, ex, sx2);
  const y0 = Math.min(ty, ey) - fontScale - 3, y1 = Math.max(ty, ey) + 3;
  const ext = `<rect x="${r2(x0 - 3)}" y="${r2(y0)}" width="${r2(x1 - x0 + 6)}" height="${r2(y1 - y0)}"`
    + ` fill="none" stroke="none" pointer-events="none" class="mk-ext"/>`;
  return { svg: s, hit, ext };
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
    if (!shownOn(d, sheetId)) continue;
    const cls = 'mk-dim' + (d.id === selectedId ? ' mk-dim-sel' : '');
    if (d.orient === 'dia') {
      const dg = diaGeom(d, sheetId);
      if (!dg) continue;
      const ds = diaSVG(dg);
      out += `<g class="${cls}" data-mk-id="${d.id}">${ds.svg}${ds.hit}${ds.ext}</g>`;
      continue;
    }
    const g = geom(d, sheetId);
    if (!g) continue;
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

// Второй щелчок по тому же отверстию, что и первый — ставим выноску диаметра.
function isDiaPick(a, b) {
  return !!a && !!b && a.kind === 'holeCenter' && sameAnchor(a, b);
}
// Положение конца выноски (мм от центра) по курсору.
function updateLeaderDraft(mx, my) {
  const view = viewOf(draft.sheet, draft.view);
  const pa = view && resolveAnchor(view, draft.a);
  if (!pa) return;
  const kx = view.sx(1) - view.sx(0), ky = view.sy(1) - view.sy(0);
  if (!kx || !ky) return;
  draft.lh = Math.round(((mx - pa.sx) / kx) * 10) / 10;
  draft.lv = Math.round(((my - pa.sy) / ky) * 10) / 10;
}
function diaPreview() {
  const rec = { sheet: draft.data, view: draft.view, a: draft.a, orient: 'dia', lh: draft.lh, lv: draft.lv };
  return diaGeom(rec, draft.sheet);
}

function renderLiveSVG(sheetId) {
  if (!active || !sheetId) return '';
  let out = '';

  if (dragState) {
    if (dragState.sheet !== sheetId) return '';
    const d = dims.filter((x) => x.id === dragState.id)[0];
    const g = d && dragState.moved ? geom(d, dragState.sheet) : null;
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
        // Тот же центр отверстия — выноска диаметра (второй щелчок по нему).
        const ok = pb && (isDiaPick(draft.a, hoverCandidate.anchor)
          || (!sameAnchor(draft.a, hoverCandidate.anchor) && pairUsable(pa, pb)));
        out += markerSVG(ok ? 'mk-hl mk-hl-ok' : 'mk-hl mk-hl-bad', hoverCandidate.sx, hoverCandidate.sy);
      }
      return out;
    }

    if (draft.phase === 'pickLeader') {
      const g = diaPreview();
      if (g) out += `<g class="mk-draft">${diaSVG(g).svg}</g>`;
      return out;
    }

    if (draft.phase === 'pickOffset') {
      const pb = resolveAnchor(view, draft.b);
      if (pb) out += markerSVG('mk-anchor', pb.sx, pb.sy);
      if (draft.orient) {
        const g = geom({ sheet: draft.data, view: draft.view, a: draft.a, b: draft.b,
          orient: draft.orient, offset: draft.offset || 0 }, draft.sheet);
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

// Перерисовать готовые размеры всех листов (или тех, что показывают те же
// данные, что лист onlySheet).
function refreshFinished(onlySheet) {
  // Судим по реестру листов, а не только по lastModel: 3D-оверлей может быть
  // единственным листом (вкладка «Чертежи» ни разу не открывалась), и
  // поставленный/удалённый в 3D размер обязан перерисоваться сразу.
  if (!lastModel && !latestModel && !Object.keys(sheets).length) return;
  const key = onlySheet ? dataKey(onlySheet) : null;
  const shares = (id) => dataKey(id) === key;
  for (const svg of allSheetSvgs()) {
    const id = sheetIdOf(svg);
    if (!id || (onlySheet && id !== onlySheet && !shares(id))) continue;
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
  const g = geom(d, dragState.sheet);
  if (!g) return;
  // Ориентация готового размера при перетаскивании не меняется — только вынос.
  d.offset = offsetFromCursor(dragState.sheet, d.view, g.pa, g.pb, d.orient, mx, my, d.id);
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
    const cand = nearestCandidate(view, mx, my, draft.a);
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
    else if (draft.phase === 'pickLeader') updateLeaderDraft(p.x, p.y);
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
  // Запись старого формата (dir/level без orient) ещё не мигрирована — так
  // бывает на внешнем листе (3D: по чужому масштабу не мигрируем). Тянуть её
  // нельзя: updateDrag записал бы в offset мусор и лишний шаг истории.
  const rec = dims.filter((x) => x.id === id)[0];
  if (!rec || (rec.orient !== 'h' && rec.orient !== 'v')) return;
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
  if (draft && (draft.phase === 'pickOffset' || draft.phase === 'pickLeader')) {
    const svg = sheetSvg(draft.sheet);
    if (!svg) { draft = null; refreshLive(); return; }
    // Область листа: вкладка чертежей, окно редактора детали или любой
    // контейнер с классом mk-pane (3D-вьювер).
    const pane = svg.closest && svg.closest('.tab-panel, .part-editor-body, .mk-pane');
    if (!svg.contains(evt.target) && !(pane && pane.contains(evt.target))) return;
    const p = svgPoint(svg, evt);
    if (!p) return;
    let rec;
    if (draft.phase === 'pickLeader') {
      updateLeaderDraft(p.x, p.y);
      rec = { id: nextId++, sheet: dataKey(draft.sheet), view: draft.view,
        a: draft.a, b: draft.a, orient: 'dia', lh: draft.lh || 0, lv: draft.lv || 0 };
      if (!diaGeom(rec, draft.sheet)) { nextId--; return; }
    } else {
      updateOffsetDraft(p.x, p.y);
      if (!draft.orient) return;
      rec = { id: nextId++, sheet: dataKey(draft.sheet), view: draft.view,
        a: draft.a, b: draft.b, orient: draft.orient, offset: draft.offset || 0 };
      if (!geom(rec, draft.sheet)) { nextId--; return; }   // нулевой размер не создаём
    }
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
      draft = { sheet: sheetId, data: dataKey(sheetId), view: view.name, a: cand.anchor, phase: 'pickB' };
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
      cand = nearestCandidate(view, p.x, p.y, draft.a);
    }
    if (!cand) return;
    if (isDiaPick(draft.a, cand.anchor)) {
      // Повторный щелчок по тому же отверстию — выноска диаметра.
      draft.phase = 'pickLeader';
      draft.lh = 0; draft.lv = 0;
      updateLeaderDraft(p.x, p.y);
      hoverCandidate = null; shiftGuide = null;
      refreshLive();
      return;
    }
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
    if (!VIEW_NAMES[d.view]) continue;
    const a = cleanAnchor(d.a), b = cleanAnchor(d.b);
    if (!a || !b) continue;
    let id = Number(d.id);
    if (!(id > 0) || Math.floor(id) !== id || used.has(id)) id = 0;
    if (id) used.add(id);
    const sheet = (typeof d.sheet === 'string' && d.sheet) ? d.sheet : OVERVIEW;
    const rec = { id, sheet, view: d.view, a, b };
    if (d.orient === 'dia') {
      if (a.kind !== 'holeCenter') continue;
      rec.orient = 'dia';
      rec.b = a;
      const lh = Number(d.lh), lv = Number(d.lv);
      rec.lh = isFinite(lh) ? clamp(lh, -MAX_OFFSET_MM, MAX_OFFSET_MM) : 0;
      rec.lv = isFinite(lv) ? clamp(lv, -MAX_OFFSET_MM, MAX_OFFSET_MM) : 0;
    } else if (d.orient === 'h' || d.orient === 'v') {
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
// Пока ни один лист не регистрировался — судить не по чему, считаем все.
// Правило для записи:
//   1) видна хотя бы на одном зарегистрированном листе отображения (включая
//      3D-оверлей 'viewer3d') — считается;
//   2) иначе, если какой-то зарегистрированный лист ПОКАЗЫВАЕТ её (лист
//      данных и вид совпадают) и мог бы нарисовать, но не нарисовал —
//      деталь пропала/размер вырожден — не считается;
//   3) иначе (её пару «лист данных + вид» сейчас не показывает никто:
//      вкладка «Чертежи» не собиралась, 3D в другом виде, окно редактора
//      закрыто, или размер от отверстия при выключенной проверке присадки)
//      — считается, пока в последней модели живы детали обеих точек.
// Так результат не зависит от того, открывали ли «Чертежи».
function count() {
  if (!(latestModel || lastModel) || !Object.keys(sheets).length) return dims.length;
  const ids = Object.keys(sheets);
  let n = 0;
  for (const d of dims) {
    let covered = false, seen = false;
    for (const id of ids) {
      if (!shownOn(d, id)) continue;
      const view = viewOf(id, d.view);
      if (!view) continue;
      // Отверстия на этом виде сейчас не рисуются — судить по нему нельзя.
      if (view.noHoles && (d.a.kind === 'holeCenter' || d.b.kind === 'holeCenter')) continue;
      covered = true;
      if (d.orient === 'dia' ? diaGeom(d, id) : geom(d, id)) { seen = true; break; }
    }
    if (seen) { n++; continue; }
    if (covered) continue;
    const sh = sheetOf(d);
    // Лист редактора детали, когда окно закрыто, не зарегистрирован — но его
    // размеры живые, пока жива сама деталь (их тоже чистит «Очистить всё»).
    if (sh.indexOf('editor:') === 0) { if (editorPartExists(sh)) n++; continue; }
    if (partExists(d.a) && partExists(d.b)) n++;
  }
  return n;
}
function partExists(anchor) {
  const m = latestModel || lastModel;
  return !!anchor && ((m && m.partsRaw) || []).some((r) => r.moduleUid === anchor.moduleUid && r.anchorKey === anchor.key);
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
  // Лист редактора детали и внешние листы (attachSheet с opts.external —
  // 3D-оверлей) строятся вне buildDrawings — их не трогаем, иначе пересборка
  // чертежей «отключала» бы открытый редактор/разметку в 3D.
  const keep = {};
  for (const id of Object.keys(sheets)) {
    if (id.indexOf('editor:') === 0 || sheets[id].external) keep[id] = sheets[id];
  }
  sheets = keep;
  partMemberSheet = {};
  if (liveShownSheet && !sheets[liveShownSheet]) liveShownSheet = null;
  // Наведение на внешнем листе (курсор над 3D) пересборка чертежей не сбивает.
  const isExt = (id) => !!(id && sheets[id] && sheets[id].external);
  if (!isExt(hoverSheet)) hoverSheet = null;
  if (hoverCandidate && !isExt(hoverCandidate.sheet)) hoverCandidate = null;
  // Начатая постановка/перетаскивание на листе, которого после пересборки
  // не стало, сбрасываются в onMove/onClick (sheetSvg() вернёт null).
}

// attachSheet(sheetId, model, views, rect) — вызывается ВНУТРИ построения
// каждого листа. views — контексты видов листа (name/hAxis/vAxis/sx/sy/rows/
// region/noHoles[/holeScreen]); rect — рамка листа {x,y,w,h} ДО ручных
// размеров (предел выноса) или null — без ограничения. Возвращает
// SVG-фрагмент: группа готовых размеров листа + пустая «живая» группа для
// интерактива.
// opts (необязательно): { dataSheet: 'view3d'|…, external: true } —
//   dataSheet: лист данных (см. шапку «Лист отображения и лист данных»);
//   external: лист вне вкладки «Чертежи», beginSheets() его не сбрасывает.
// Повторный вызов с тем же sheetId заменяет регистрацию (так 3D-оверлей
// обновляет проекцию после движения камеры). Если у листа сменился лист
// данных или пропал вид начатой постановки/перетаскивания — они отменяются.
function attachSheet(sheetId, model, views, rect, opts) {
  if (!sheetId) return '';
  if (model) lastModel = model;
  const o = opts || {};
  const map = {};
  for (const v of views || []) map[v.name] = v;
  const dataSheet = (typeof o.dataSheet === 'string' && o.dataSheet) ? o.dataSheet : null;
  const prevData = sheets[sheetId] ? dataKey(sheetId) : null;
  sheets[sheetId] = {
    views: map,
    rect: (rect && isFinite(rect.x) && isFinite(rect.w)) ? rect : null,
    dataSheet,
    external: !!o.external,
  };
  const dataChanged = prevData != null && prevData !== dataKey(sheetId);
  if (draft && draft.sheet === sheetId && (dataChanged || !map[draft.view])) {
    draft = null; shiftGuide = null;
  }
  if (dragState && dragState.sheet === sheetId) {
    const dd = dims.filter((x) => x.id === dragState.id)[0];
    if (dataChanged || !dd || !map[dd.view]) dragState = null;
  }
  if (hoverCandidate && hoverCandidate.sheet === sheetId && (dataChanged || !map[hoverCandidate.view])) {
    hoverCandidate = null;
  }
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

// Лист заново нарисован снаружи (3D-вьювер после движения камеры положил в
// свой svg свежий результат attachSheet) — перерисовать готовые размеры и
// «живой» слой этого листа. Наведение/вынос пересчитываются по последней
// позиции курсора: мышь стоит, а картинка под ней уехала (зум колесом).
// opts.skipFinished — готовые размеры в svg уже свежие (их только что
// вернул attachSheet): не рисовать их второй раз за кадр.
function refreshSheet(sheetId, opts) {
  if (!sheetId || !sheets[sheetId]) return;
  const svg = sheetSvg(sheetId);
  const el = (opts && opts.skipFinished) ? null : groupIn(svg, 'mk-finished');
  if (el) el.innerHTML = renderFinishedGroup(sheetId);
  if (dragState && dragState.sheet === sheetId && dragState.moved) setFinishedHidden(dragState.id, sheetId, true);
  if (active && lastMouse && !dragState) {
    if (draft && draft.sheet === sheetId) {
      if (draft.phase === 'pickOffset') updateOffsetDraft(lastMouse.sx, lastMouse.sy);
      else if (draft.phase === 'pickLeader') updateLeaderDraft(lastMouse.sx, lastMouse.sy);
      else updateHover(sheetId, lastMouse.sx, lastMouse.sy);
    } else if (!draft && hoverSheet === sheetId) {
      updateHover(sheetId, lastMouse.sx, lastMouse.sy);
    }
  }
  // Живую группу листа только что заменили пустой — рисуем заново.
  if (liveShownSheet === sheetId) liveShownSheet = null;
  refreshLive();
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
  // внешние листы (3D-оверлей viewer.js, см. шапку)
  refreshSheet,
  SHEET_OVERVIEW: OVERVIEW, SHEET_VIEW3D: VIEW3D,
};
})();
