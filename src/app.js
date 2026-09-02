// app.js
// ============================================================================
// UI/UX Layer — единственное место, где параметры превращаются в состояние.
// При любом изменении параметра вызывается recompute(): заново строится модель
// (engine.js) и спецификация (specification.js), и синхронно обновляются
// 3D-вьюер, чертежи, деталировка и спецификация — единый источник истины.
//
// Структура состояния: Проект → Модули → Секции.
// Материалы и тип крепежа общие на проект; габариты, схема корпуса и основание
// задаются для каждого модуля отдельно (кухня = несколько модулей в ряд).
//
// Классический скрипт (без import/export) — зависимости из window.Modul3D.
// ============================================================================
(function () {
// Версия сборки — показывается во вкладке браузера и в шапке.
// При выпуске новой версии меняется только эта строка.
const APP_VERSION = 'v203';

// Номер версии выводим ПЕРВЫМ делом: если дальше что-то упадёт, по нему сразу
// видно, какая сборка открыта.
document.title = `Modul3D ${APP_VERSION} — конструктор мебели`;
const _verEl = document.getElementById('appVersion');
if (_verEl) _verEl.textContent = APP_VERSION;

// Проверка загрузки модулей. Самая частая причина пустого окна — index.html
// открыт БЕЗ папки src (например, прямо из архива: Windows распаковывает во
// временную папку только сам файл). Тогда раньше страница оставалась пустой
// вообще без объяснений — теперь пишем, какой файл не загрузился.
const REQUIRED = [
  ['catalog', 'src/catalog.js'],
  ['cnc', 'src/cnc.js'],
  ['presets', 'src/presets.js'],
  ['engine', 'src/engine.js'],
  ['specification', 'src/specification.js'],
  ['viewer', 'src/viewer.js'],
  ['drawings', 'src/drawings.js'],
  ['exportModule', 'src/export.js'],
  ['sketchAI', 'src/sketchAI.js'],
];
const _missing = REQUIRED.filter((x) => !(window.Modul3D && window.Modul3D[x[0]]));
if (_missing.length) {
  const box = document.getElementById('paramsPanel');
  const list = _missing.map((x) => x[1]).join(', ');
  const msg = `Не загрузились файлы: ${list}.<br><br>`
    + 'Скорее всего <b>index.html открыт не из распакованной папки</b> — например, '
    + 'прямо из ZIP-архива: Windows в этом случае распаковывает во временную папку '
    + 'только сам файл, без папки <b>src</b>.<br><br>'
    + 'Распакуйте архив целиком (папка <b>basis-mvp</b> вместе с подпапкой <b>src</b>) '
    + 'и откройте index.html уже из неё.';
  if (box) box.innerHTML = `<div style="color:#a33;font-size:13px;line-height:1.5;padding:10px">${msg}</div>`;
  console.error('Не загружены модули:', list);
  return;
}

const { buildModel } = window.Modul3D.engine;
const { buildSpecification } = window.Modul3D.specification;
const { Viewer3D } = window.Modul3D.viewer;
const { exportDetailing, exportSpecification } = window.Modul3D.exportModule;
const { DECORS, BACK_MATERIALS, DRAWER_SYSTEMS, DRAWER_SYSTEM_ORDER,
        HANDLES, HANDLE_ORDER, LIFTS, LIFT_ORDER,
        FACADE_TYPES, FACADE_TYPE_ORDER } = window.Modul3D.catalog;
const { PRESETS } = window.Modul3D.presets;
const { recognizeSketch } = window.Modul3D.sketchAI;
const { buildDrawings, buildViewSVG, DRAWINGS_CSS } = window.Modul3D.drawings;
const { exportDrillCsv, exportDrillDxf } = window.Modul3D.cnc;

function newSection() {
  return {
    shelves: 3, drawers: 0, facade: 'doorLeft',
    shelfMode: 'auto', shelfHeights: [],
    rod: false, rodHeight: 1900,
    drawerMode: 'auto', drawerHeights: [], drawerPinned: [], pushToOpen: false,
    drawerBoxHeight: 'auto',   // высота короба ящика: 'auto' или код из каталога
    drawerOffset: 10,   // технологический зазор от дна, чтобы ящик не тёрся
    // Материал/толщина/система ящиков — настройка ПО СЕКЦИИ (панель «Ящики»,
    // см. drawersPanelBlock ниже), а не общая на проект: у секции могут стоять
    // ящики другого декора/толщины, чем у соседней. Дефолты те же, что раньше
    // были общепроектными в state.
    drawerDecorCode: DECORS[0].code, drawerThickness: 16, drawerSystem: 'ballBearing',
    widthMode: 'auto', width: 400,
  };
}
function newModule(name) {
  return {
    name: name || 'Модуль', width: 800, height: 2100, depth: 560,
    leftSide: 'floor', rightSide: 'floor',
    baseType: 'plinth', plinthHeight: 100, legHeight: 100, legType: 'metal',
    family: 'custom',                   // 'kitchen' — кухонный, у него нет штанги
    topType: 'panel', railWidth: 100,   // верх: цельная крышка или две планки
    corner: false,      // угловой: после него ряд поворачивает на 90°
    rotation: 0,        // поворот вокруг вертикальной оси: 0/90/180/270°
    sections: [newSection()],
  };
}

const state = {
  bodyThickness: 18, backThickness: 3, facadeThickness: 18,
  decorCode: DECORS[0].code,
  // Декор фасада отдельный: у кухни корпус белый, фасад в своём декоре
  facadeDecorCode: DECORS[0].code,
  // Глубина столешницы: по ней видимая боковина дотягивается до стены
  worktopDepth: 600,
  backCode: BACK_MATERIALS[0].code,
  jointType: 'confirmat',
  hideFacades: false,
  // Режим проверки присадки: корпус прозрачный, отверстия подсвечены
  drillCheck: false,
  // Показывать метки только одного вида присадки (клик по строке легенды)
  drillFilter: null,
  view: 'iso',
  activeModule: 0,
  // Имя подсвеченного модуля. null — выделение снято (клик по пустому месту).
  selected: null,
  modules: [],          // проект стартует пустым — первый модуль выбирает пользователь
  // Какая категория «Базы модулей» сейчас развёрнута сеткой миниатюр внутри
  // панели (id группы из PRESETS или null — все свёрнуты). Чисто UI-состояние,
  // в историю отмены/файл проекта не попадает (не перечислено в snapshot()).
  libraryOpenCat: null,
  // Какая вкладка сейчас открыта в панели «Библиотека» (отдельная панель —
  // см. renderLibraryPanel()): 'modules' — база модулей, 'materials' —
  // редактируемые таблицы каталога материалов, 'hardware' — фурнитура.
  // Чисто UI-состояние, в историю отмены/файл проекта не попадает.
  libraryTab: 'modules',
  // Какой экран сейчас показан в панели «Параметры проекта» (панель
  // «Библиотека» — отдельная, самостоятельная, за неё отвечает libraryTab
  // выше): 'module' — поля активного модуля, 'materials' — общие на проект
  // материалы, 'part' — параметры одной детали внутри изолированного
  // модуля. Чисто UI-состояние, в историю отмены/файл проекта не попадает.
  panelView: 'module',
  // Имя модуля, изолированного двойным кликом в 3D (см. viewer.onIsolateModule
  // ниже), или null — режим изоляции выключен. Чисто UI-состояние режима
  // просмотра, не часть данных проекта — в snapshot()/файл не попадает,
  // как и panelView/libraryOpenCat выше.
  isolatedModule: null,
  // Деталь, выбранная через «Редактировать» в контекстном меню фокуса
  // (см. openPartEditor): { module, kind, side } — side есть только у
  // боковины (kind === 'side'), у остальных видов деталей undefined — или
  // null. Полноценный экран (partBlock) есть для видов из OVERRIDABLE_PART_KINDS
  // (side/bottom/top/back/plinth), для остальных — заглушка
  // (partKindPlaceholderBlock). Тоже чисто UI-состояние.
  selectedPart: null,
  // Индекс секции активного модуля, для которой открыта панель «Ящики» (см.
  // openDrawersPanel/drawersPanelBlock ниже) — число или null (панель
  // закрыта). Тоже чисто UI-состояние, как selectedPart выше: не часть
  // данных проекта, в snapshot()/файл не попадает.
  drawersSectionIndex: null,
  // Открыт ли полноэкранный визуальный редактор вырезов детали (см.
  // openPartVisualEditor/closePartVisualEditor) — новый режим ПОВЕРХ экрана
  // «Деталь», не замена partBlock(). Закрытие (красный крестик) возвращает
  // именно сюда, в false, не трогая selectedPart/panelView/isolatedModule.
  // Чисто UI-состояние, в историю/файл проекта не попадает.
  partEditorOpen: false,
};

// Снимает режим изоляции модуля (двойной клик в 3D) и выбор детали внутри
// него. Имя изолированного модуля и выбранная деталь — чисто UI-состояние,
// не привязанное к жизненному циклу state.modules: любое место, которое
// удаляет/переставляет/переименовывает/заменяет модули (удаление, вставка,
// undo/redo, открытие проекта) или явно переключает пользователя на другой
// модуль, обязано вызвать этот helper — иначе isolatedModule/selectedPart
// могут указывать на модуль, которого больше нет (или уже другой), и вьюер
// притушит всю сцену, ни с чем не совпав по имени.
function exitIsolation() {
  state.isolatedModule = null;
  state.selectedPart = null;
  // Панель «Ящики» открыта для конкретной секции конкретного модуля — та же
  // защита: если модуль/секция пропадает (удаление, undo/redo, открытие
  // другого проекта), панели больше нечего показывать.
  state.drawersSectionIndex = null;
  // Визуальный редактор вырезов открыт для конкретной детали конкретного
  // модуля — если сам модуль/фокус пропадает (удаление, undo/redo, открытие
  // другого проекта), редактору больше нечего показывать, закрываем и его.
  if (state.partEditorOpen) closePartVisualEditor();
}

// ---------------------------------------------------------------------------
// История: отмена (Ctrl+Z) и возврат (Ctrl+Y / Ctrl+Shift+Z / Ctrl+X)
// ---------------------------------------------------------------------------
// Снимок делается в единой точке пересчёта, поэтому в историю попадает ЛЮБОЕ
// изменение проекта — не нужно помнить про каждый обработчик отдельно.
const HISTORY_LIMIT = 100;
const history = { past: [], future: [], lock: false };

function snapshot() {
  return JSON.stringify({
    modules: state.modules, activeModule: state.activeModule, selected: state.selected,
    bodyThickness: state.bodyThickness, backThickness: state.backThickness, facadeThickness: state.facadeThickness,
    decorCode: state.decorCode, facadeDecorCode: state.facadeDecorCode, backCode: state.backCode,
    jointType: state.jointType, worktopDepth: state.worktopDepth,
  });
}

function pushHistory() {
  if (history.lock) return;
  const snap = snapshot();
  if (history.past[history.past.length - 1] === snap) return;   // ничего не поменялось
  history.past.push(snap);
  if (history.past.length > HISTORY_LIMIT) history.past.shift();
  history.future.length = 0;                                    // новая ветка
}

function applySnapshot(snap) {
  const o = JSON.parse(snap);
  Object.keys(o).forEach((k) => { state[k] = o[k]; });
  // state.modules целиком заменён — режим изоляции (по имени модуля) и
  // выбор детали внутри него могли устареть, снимаем безусловно.
  exitIsolation();
  history.lock = true;
  try { renderParamsPanel(); recompute(); } finally { history.lock = false; }
  updateHistoryButtons();
}

function undo() {
  if (history.past.length < 2) return;
  history.future.push(history.past.pop());
  applySnapshot(history.past[history.past.length - 1]);
}

function redo() {
  if (!history.future.length) return;
  const snap = history.future.pop();
  history.past.push(snap);
  applySnapshot(snap);
}

// undoBtn/redoBtn/delModule живут статикой в шапке (index.html), а не
// перерисовываются вместе с панелью — поэтому здесь только переключаем
// disabled, сама привязка обработчиков делается один раз в initHeaderControls().
function updateHistoryButtons() {
  const u = document.getElementById('undoBtn'), r = document.getElementById('redoBtn');
  if (u) u.disabled = history.past.length < 2;
  if (r) r.disabled = !history.future.length;
  const d = document.getElementById('delModule');
  if (d) d.disabled = !state.modules.length;
}

// ---------------------------------------------------------------------------
// Хранение проекта: сохранение/открытие файлом .json + автосохранение
// ---------------------------------------------------------------------------
// Формат файла — обёртка вокруг того же снимка состояния, которым уже
// пользуется история отмены (snapshot()/applySnapshot()): один источник
// истины на то, «что считается проектом», — что для истории, что для файла,
// что для автосохранения.
const PROJECT_FILE_VERSION = 1;
const AUTOSAVE_KEY = 'basisAutosaveProject';

function serializeProject() {
  return {
    app: 'basis-mvp',
    fileVersion: PROJECT_FILE_VERSION,
    appVersion: APP_VERSION,
    savedAt: new Date().toISOString(),
    state: JSON.parse(snapshot()),
  };
}

function projectFileName() {
  const first = state.modules[0];
  const base = first && first.name ? first.name.replace(/[\\/:*?"<>|]+/g, '_') : 'проект';
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${base}-${stamp}.json`;
}

function saveProjectToFile() {
  const blob = new Blob([JSON.stringify(serializeProject(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = projectFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Миграция старых файлов проекта (до v199): материал/толщина/система ящиков
// раньше были ОДНИМИ на весь проект (data.state.drawerDecorCode/
// drawerThickness/drawerSystem), теперь — поле каждой секции (см. newSection()
// и drawersPanelBlock). Проставляет их только там, где у секции этих полей
// ещё нет (новые/уже мигрированные проекты не трогает) — приоритет отдаём
// старому проектному значению из файла, если оно там было (значит,
// пользователь его реально настраивал), иначе тем же дефолтам, что и у новой
// секции.
function migrateDrawerFieldsToSections(data) {
  const legacy = (data && data.state) || {};
  const fallbackDecor = legacy.drawerDecorCode || DECORS[0].code;
  const fallbackThickness = Number(legacy.drawerThickness) || 16;
  const fallbackSystem = legacy.drawerSystem || 'ballBearing';
  (state.modules || []).forEach((m) => {
    (m.sections || []).forEach((sec) => {
      if (sec.drawerDecorCode === undefined) sec.drawerDecorCode = fallbackDecor;
      if (sec.drawerThickness === undefined) sec.drawerThickness = fallbackThickness;
      if (sec.drawerSystem === undefined) sec.drawerSystem = fallbackSystem;
    });
  });
}

// Применяет сохранённое состояние проекта (из файла или автосохранения).
// В отличие от applySnapshot() (только для истории отмены), терпима к
// неполным/старым файлам: недостающие поля остаются как в текущем состоянии,
// а не обнуляются.
function restoreProjectData(data) {
  if (!data || typeof data !== 'object' || !data.state || !Array.isArray(data.state.modules)) {
    throw new Error('Файл не похож на проект «Modul3D» — нет списка модулей.');
  }
  Object.keys(data.state).forEach((k) => { state[k] = data.state[k]; });
  migrateDrawerFieldsToSections(data);
  // Открыт другой проект (или восстановлено автосохранение) — модули заменены
  // целиком, старая изоляция/выбор детали больше не имеют смысла.
  exitIsolation();
  history.lock = true;
  try { renderParamsPanel(); recompute(); } finally { history.lock = false; }
  // Загруженный проект — новая точка отсчёта истории отмены.
  history.past = [snapshot()];
  history.future = [];
  updateHistoryButtons();
}

function openProjectFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      restoreProjectData(JSON.parse(String(reader.result)));
      renderWarnings([]);
    } catch (err) {
      console.error('Open project failed:', err);
      renderWarnings(['Не удалось открыть файл проекта: ' + err.message]);
    }
  };
  reader.onerror = () => renderWarnings(['Не удалось прочитать файл проекта.']);
  reader.readAsText(file, 'utf-8');
}

// Автосохранение в localStorage — подстраховка от случайного закрытия вкладки
// без ручного сохранения. Не заменяет файл: живёт только в этом браузере и
// перезаписывается при каждом изменении проекта (с debounce).
let autosaveTimer = null;
function autosaveProject() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      if (!state.modules.length) { localStorage.removeItem(AUTOSAVE_KEY); return; }
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeProject()));
    } catch (err) {
      console.warn('Autosave failed:', err);   // напр. localStorage переполнен/недоступен
    }
  }, 400);
}

// При старте, если вкладка раньше закрылась без ручного сохранения,
// предлагаем восстановить последнее автосохранённое состояние.
function offerAutosaveRestore() {
  let raw;
  try { raw = localStorage.getItem(AUTOSAVE_KEY); } catch (err) { return; }
  if (!raw) return;
  let data;
  try { data = JSON.parse(raw); } catch (err) { return; }
  if (!data || !data.state || !Array.isArray(data.state.modules) || !data.state.modules.length) return;
  const when = data.savedAt ? new Date(data.savedAt).toLocaleString('ru-RU') : 'неизвестно когда';
  const ok = window.confirm(
    `Найден несохранённый проект от ${when} (автосохранение).\nВосстановить его?\n\n` +
    `«Отмена» — начать с пустого проекта.`
  );
  if (ok) restoreProjectData(data);
  else localStorage.removeItem(AUTOSAVE_KEY);
}

// Удаление активного модуля — и кнопкой, и из контекстного меню.
function deleteModule(idx) {
  if (!state.modules[idx]) return;
  // Удаляется любой модуль — не только изолированный: проще и надёжнее
  // всегда снимать изоляцию/выбор детали, чем определять, задело ли удаление
  // именно изолированный модуль.
  exitIsolation();
  state.modules.splice(idx, 1);
  renumberModules();
  state.activeModule = Math.min(state.activeModule, state.modules.length - 1);
  if (state.activeModule < 0) state.activeModule = 0;
  state.selected = (state.modules[state.activeModule] || {}).name || null;
  renderParamsPanel();
  recompute();
}

let currentModel = null;
let currentSpec = null;
let viewer = null;
try {
  viewer = new Viewer3D(document.getElementById('viewer3d'));
} catch (err) {
  console.error('3D viewer init failed:', err);
  document.getElementById('viewer3d').innerHTML =
    `<div style="padding:20px;color:#a33;font-size:13px">Не удалось инициализировать 3D-просмотр: ${err.message}. Чертежи и деталировка работают.</div>`;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// Панель параметров
// ---------------------------------------------------------------------------
// Три варианта конструктива боковины — общий список для обоих выпадающих
// списков, чтобы подписи не расходились между собой и с движком.
const SIDE_VARIANTS = [
  ['floor', 'до пола'],
  ['onBottom', 'на дно'],
  ['besideBottom', 'сбоку дна'],
];
function sideOptions(cur) {
  const v = SIDE_VARIANTS.some(x => x[0] === cur) ? cur : 'floor';
  return SIDE_VARIANTS
    .map(([id, label]) => `<option value="${id}" ${id === v ? 'selected' : ''}>${label}</option>`)
    .join('');
}

// Модули нумеруются подряд: «Модуль 1», «Модуль 2»… Переименованные вручную
// не трогаем — только те, что носят стандартное имя.
function renumberModules() {
  const isAuto = (nm) => !nm || nm === 'Модуль' || /^Модуль \d+$/.test(nm);
  state.modules.forEach((m, i) => { if (isAuto(m.name)) m.name = `Модуль ${i + 1}`; });
}

// Новый модуль встаёт СРАЗУ ЗА выделенным, а не в конец ряда: правее стоящие
// модули сдвигаются дальше. Так добавляют модуль в середину гарнитура.
function insertModule(m) {
  // Вставка сдвигает и может переименовать соседние модули (renumberModules
  // ниже) — изоляция всё равно не имеет смысла в момент добавления нового
  // модуля, снимаем её на всякий случай ДО вставки.
  exitIsolation();
  const at = Math.min(state.activeModule + 1, state.modules.length);
  state.modules.splice(at, 0, m);
  renumberModules();
  state.activeModule = at;
  state.selected = state.modules[at].name;
  // Добавили модуль — сразу открываем экран с его параметрами, чтобы можно
  // было тут же настроить, а не оставаться на экране базы модулей.
  state.panelView = 'module';
  renderParamsPanel();
  recompute();
  // Досчитываем «авто»-зоны соседнего пенала ПОСЛЕ recompute(), а не до —
  // findNeighborBottomZoneHeight/placeShelvesAtZoneBoundaries читают
  // currentModel.modules[mi].dims нового соседа, а currentModel строится
  // только внутри recompute(); до него dims ещё не существует.
  if (resyncZoneHeightsForNewNeighbor(at)) recompute();
}

// Переключатель экрана панели «Параметры проекта» — точка связи с
// ui-shell.js (кнопка «Параметры» в HUD ведёт на экран 'module').
function setPanelView(view) {
  // Уход с экрана «Деталь» на любой другой — снимаем выбор (и вместе с ним
  // 3D-подсветку, см. viewOpts): иначе деталь/секция осталась бы подсвечена
  // бирюзовым в 3D, хотя панель её больше не показывает.
  if (view !== 'part') state.selectedPart = null;
  state.panelView = view;
  renderParamsPanel();
  // Смена panelView/selectedPart меняет opts.axisHintRow/highlightSection в
  // viewOpts() — без re-render 3D не подхватит новое значение до следующего
  // не связанного с этим действия (см. тот же вызов в openPartEditor/
  // exitFocusMode/onSelectPart/onFocusMiss).
  if (viewer && currentModel) viewer.render(currentModel, viewOpts());
}

// Открывает панель «Ящики» для секции `secIndex` активного модуля — кнопка
// «Редактировать ящики →» в renderSectionsList(). Сама панель — отдельный
// экран panelView:'drawers' (см. drawersPanelBlock/renderParamsPanel), не
// инлайн-блок внутри списка секций.
function openDrawersPanel(secIndex) {
  state.drawersSectionIndex = secIndex;
  state.panelView = 'drawers';
  renderParamsPanel();
}

function libraryBlock() {
  return `
    <h3>База модулей</h3>
    <div class="lib-row">
      ${PRESETS.map((g) =>
        `<button class="lib-cat ${g.id === state.libraryOpenCat ? 'on' : ''}" type="button"
                 data-cat="${g.id}">${esc(g.name)} ▾</button>`
      ).join('')}
    </div>
    ${libraryGridBlock()}
    <div class="hint">Выберите категорию, затем вариант — готовый модуль добавится в проект и появится в 3D.</div>`;
}

// Сетка миниатюр открытой категории. Рендерится СИНХРОННО только для пунктов
// текущей открытой группы (несколько штук), а не для всех 16 пресетов сразу —
// иначе панель тормозила бы при каждой перерисовке.
function libraryGridBlock() {
  const group = PRESETS.filter((g) => g.id === state.libraryOpenCat)[0];
  if (!group) return '';

  // Материалы для превью берём из ТЕКУЩЕГО проекта (те же источники, что и
  // recompute()) — миниатюра сразу показывает модуль в декоре, в котором он
  // реально появится у пользователя. Сам вид миниатюры при этом нейтральный
  // (см. renderThumbnail({ neutral: true })) — декор на неё не влияет, но
  // прочие поля (толщины и т.п.) должны быть настоящими, не выдуманными.
  const thumbBase = {
    bodyThickness: state.bodyThickness,
    backThickness: state.backThickness,
    facadeThickness: state.facadeThickness,
    decor: DECORS.find(d => d.code === state.decorCode),
    facadeDecor: DECORS.find(d => d.code === state.facadeDecorCode) || DECORS.find(d => d.code === state.decorCode),
    backMaterial: BACK_MATERIALS.find(d => d.code === state.backCode),
    worktopDepth: state.worktopDepth,
    jointType: state.jointType,
  };

  const tiles = group.items.map((it) => {
    let dataUrl = null;
    try {
      const m = it.make();
      const project = Object.assign({}, thumbBase, {
        modules: [{
          name: m.name, width: m.width, height: m.height, depth: m.depth,
          rotation: m.rotation || 0, corner: !!m.corner, family: m.family || 'custom',
          topType: m.topType, railWidth: m.railWidth, noBack: !!m.noBack,
          blindPanel: !!m.blindPanel, blindStrip: m.blindStrip,
          leftSide: m.leftSide, rightSide: m.rightSide,
          base: m.baseType === 'plinth'
            ? { type: 'plinth', plinthHeight: m.plinthHeight }
            : { type: m.baseType, legHeight: m.legHeight },
          legType: m.legType || 'metal',
          sections: m.sections || [],
        }],
      });
      const model = buildModel(project);
      dataUrl = window.Modul3D.viewer.renderThumbnail(model, { size: 200, neutral: true });
    } catch (err) {
      dataUrl = null;
    }
    // Полное примечание пресета иногда длиной за сотню символов — для
    // всплывающей подсказки (узкая колонка, перенос по словам) обрезаем его,
    // иначе подсказка растягивается на добрый десяток строк. Полный текст
    // примечания по-прежнему виден в самом контекстном меню категории (см.
    // раньше — до переноса в сетку миниатюр), здесь это только краткая метка.
    const noteShort = it.note && it.note.length > 70 ? it.note.slice(0, 68) + '…' : it.note;
    const tip = `${it.name}${noteShort ? ` — ${noteShort}` : ''}`;
    return `<button type="button" class="lib-item tip tip-down" data-preset="${it.id}" data-tip="${esc(tip)}">
        ${dataUrl ? `<img class="lib-thumb" src="${dataUrl}" alt="">` : ''}
      </button>`;
  }).join('');

  return `<div class="lib-grid">${tiles}</div>`;
}

// ---------------------------------------------------------------------------
// Панель «Библиотека» (отдельная, самостоятельная — не путать с «Параметры
// проекта»): поиск + три вкладки. «База модулей» — существующий блок выше
// (libraryBlock/libraryGridBlock/bindLibraryEvents), просто отрисован в
// #libraryPanel вместо #paramsPanel. «Материалы» и «Фурнитура» — редактируемые
// таблицы каталога (window.Modul3D.catalog.*): правки пишутся НАПРЯМУЮ в
// объекты каталога (никакой копии состояния в app.js/ui-shell.js), поэтому
// engine.js/specification.js подхватывают их без какой-либо синхронизации.
// ---------------------------------------------------------------------------
function curSym() {
  const c = window.Modul3D.currency;
  return (c && typeof c.getSymbol === 'function' && c.getSymbol()) || '₽';
}

// Инлайн-редактируемая ячейка: пока не кликнули — обычный текст, клик
// (см. initLibraryPanel → делегирование на #libraryPanel) превращает её
// в <input>, сохранение — по Enter/blur (см. startCellEdit).
function libEditCell(group, key, field, type, value) {
  return `<td class="lib-edit-cell" data-group="${esc(group)}" data-key="${esc(key)}" data-field="${field}" data-type="${type}">${esc(value == null ? '' : String(value))}</td>`;
}

// Карточка цвета/образца — превью из поля image (dataURL) или заглушка «+»,
// клик открывает системный выбор файла (см. openLibImagePicker).
function libSwatchHtml(group, key, image) {
  // dataURL (base64) не содержит одинарных кавычек — безопасно подставлять
  // внутрь url('...') без экранирования; esc() экранирует внешний HTML-атрибут
  // (двойные кавычки), а не саму CSS-строку.
  const style = image ? ` style="background-image:url('${esc(image)}')"` : '';
  return `<span class="lib-swatch${image ? '' : ' empty'}" data-swatch-group="${esc(group)}" data-swatch-key="${esc(key)}"${style} title="Загрузить образец"></span>`;
}

function libSheetTable(title, group, items) {
  const rows = items.map((it) => `
    <tr data-search="${esc(String(it.name || '').toLowerCase())}">
      ${libEditCell(group, it.code, 'name', 'text', it.name)}
      ${libEditCell(group, it.code, 'unit', 'text', it.unit || 'лист')}
      <td>${libSwatchHtml(group, it.code, it.image)}</td>
      ${libEditCell(group, it.code, 'sheetPrice', 'number', it.sheetPrice)}
    </tr>`).join('');
  return `
    <h4 class="mat-sub">${esc(title)}</h4>
    <table class="lib-table"><thead><tr>
      <th>Наименование</th><th>Ед. изм.</th><th>Образец</th><th>Цена, ${esc(curSym())}</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <button type="button" class="link-btn lib-add" data-add="${group}">+ Добавить материал</button>`;
}

// Кромка: ключ объекта EDGE_PRICES — это и есть название (см. catalog.js).
// Переименовывать его на месте рискованно (specification.js читает
// EDGE_PRICES[type] по значению из секции) — поэтому название НЕредактируемо,
// а новая кромка добавляется вводом уникального названия (см. libAddRow).
function libEdgeTable() {
  const cat = window.Modul3D.catalog;
  const rows = Object.keys(cat.EDGE_PRICES).map((name) => {
    const it = cat.EDGE_PRICES[name];
    return `
    <tr data-search="${esc(name.toLowerCase())}">
      <td>${esc(name)}</td>
      ${libEditCell('edge', name, 'unit', 'text', it.unit || 'пог.м')}
      <td>${libSwatchHtml('edge', name, it.image)}</td>
      ${libEditCell('edge', name, 'price', 'number', it.price)}
    </tr>`;
  }).join('');
  return `
    <h4 class="mat-sub">Кромка</h4>
    <table class="lib-table"><thead><tr>
      <th>Наименование</th><th>Ед. изм.</th><th>Образец</th><th>Цена, ${esc(curSym())}</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <button type="button" class="link-btn lib-add" data-add="edge">+ Добавить кромку</button>`;
}

// Стекло — единственный объект каталога (не массив), поэтому таблица из
// одной строки и без кнопки «Добавить» — добавлять в этой таблице нечего.
function libGlassTable() {
  const g = window.Modul3D.catalog.GLASS;
  return `
    <h4 class="mat-sub">Стекло</h4>
    <table class="lib-table"><thead><tr>
      <th>Наименование</th><th>Ед. изм.</th><th>Образец</th><th>Цена, ${esc(curSym())}</th>
    </tr></thead><tbody>
      <tr data-search="${esc(String(g.name).toLowerCase())}">
        ${libEditCell('glass', g.code, 'name', 'text', g.name)}
        ${libEditCell('glass', g.code, 'unit', 'text', g.unit || 'лист')}
        <td>${libSwatchHtml('glass', g.code, g.image)}</td>
        ${libEditCell('glass', g.code, 'sheetPrice', 'number', g.sheetPrice)}
      </tr>
    </tbody></table>`;
}

function libraryMaterialsBlock() {
  const cat = window.Modul3D.catalog;
  return `
    <h3>Материалы</h3>
    ${libSheetTable('Материалы корпуса', 'decors', DECORS)}
    ${libSheetTable('Материалы задней стенки', 'back', BACK_MATERIALS)}
    ${libSheetTable('Материалы фасадов', 'facade', Object.values(cat.FACADE_MATERIALS))}
    ${libEdgeTable()}
    ${libGlassTable()}`;
}

// Фурнитура собрана из ЧЕТЫРЁХ источников каталога (HARDWARE_PRICES,
// HANDLES, LIFTS, FASTENER_PRICES) и сгруппирована по полю category —
// порядок разделов и подписи берём из справочника каталога, чтобы не
// разойтись с ним. HANDLES.none — служебная UI-заглушка «без ручки»
// с ценой 0, а не закупочная позиция, поэтому в таблицу не попадает.
function libraryHardwareBlock() {
  const cat = window.Modul3D.catalog;
  const order = cat.HARDWARE_CATEGORY_ORDER;
  const label = cat.HARDWARE_CATEGORY_LABEL;
  const grouped = {};
  order.forEach((c) => { grouped[c] = []; });
  const pushSrc = (srcObj, srcName, skipKeys) => {
    Object.keys(srcObj || {}).forEach((k) => {
      if (skipKeys && skipKeys.indexOf(k) >= 0) return;
      const it = srcObj[k];
      if (!grouped[it.category]) grouped[it.category] = [];
      grouped[it.category].push({ src: srcName, key: k, item: it });
    });
  };
  pushSrc(cat.HARDWARE_PRICES, 'hw');
  pushSrc(cat.HANDLES, 'handles', ['none']);
  pushSrc(cat.LIFTS, 'lifts');
  pushSrc(cat.FASTENER_PRICES, 'fasteners');

  const sections = order.map((c) => {
    const items = grouped[c] || [];
    const rows = items.map(({ src, key, item }) => `
      <tr data-search="${esc(String(item.name || '').toLowerCase())}">
        ${libEditCell('hw:' + src, key, 'name', 'text', item.name)}
        ${libEditCell('hw:' + src, key, 'unit', 'text', item.unit || 'шт')}
        ${libEditCell('hw:' + src, key, 'price', 'number', item.price)}
      </tr>`).join('');
    return `
      <h4 class="mat-sub">${esc(label[c] || c)}</h4>
      <table class="lib-table"><thead><tr>
        <th>Наименование</th><th>Ед. изм.</th><th>Цена, ${esc(curSym())}</th>
      </tr></thead><tbody>${rows || '<tr><td colspan="3" class="hint">Пока нет позиций</td></tr>'}</tbody></table>
      <button type="button" class="link-btn lib-add" data-add="hwadd:${c}">+ Добавить позицию</button>`;
  }).join('');

  return `<h3>Фурнитура</h3>${sections}`;
}

// ---------------------------------------------------------------------------
// Сохранение правок каталога — единственная точка записи в объекты
// window.Modul3D.catalog.*. Мутируем существующие объекты/массивы на месте
// (не подменяем ссылку), поэтому engine.js/specification.js, которые держат
// эти же объекты через деструктуризацию при загрузке, видят новые значения
// без какой-либо отдельной синхронизации.
// ---------------------------------------------------------------------------
function libFindItem(group, key) {
  const cat = window.Modul3D.catalog;
  if (group === 'decors') return DECORS.find((x) => x.code === key) || null;
  if (group === 'back') return BACK_MATERIALS.find((x) => x.code === key) || null;
  if (group === 'facade') return cat.FACADE_MATERIALS[key] || null;
  if (group === 'edge') return cat.EDGE_PRICES[key] || null;
  if (group === 'glass') return cat.GLASS;
  if (group.indexOf('hw:') === 0) {
    const src = group.slice(3);
    const obj = src === 'hw' ? cat.HARDWARE_PRICES
      : src === 'handles' ? cat.HANDLES
      : src === 'lifts' ? cat.LIFTS
      : src === 'fasteners' ? cat.FASTENER_PRICES : null;
    return obj ? (obj[key] || null) : null;
  }
  return null;
}

function libSaveEdit(group, key, field, value) {
  const it = libFindItem(group, key);
  if (!it) return;
  it[field] = value;
  // Каталог — не часть snapshot()/файла проекта, полный recompute() не
  // обязателен для пересчёта чисел, но нужен, чтобы обновить спецификацию
  // (новая цена) и деталировку (переименованный материал) на лету.
  recompute();
  renderLibraryPanel();
}

function libAddHardwareRow(category) {
  const cat = window.Modul3D.catalog;
  const key = 'custom_' + category + '_' + Date.now();
  if (category === 'mechanism') {
    cat.LIFTS[key] = { id: key, brand: '', name: 'Новая позиция', article: '', price: 0,
      minH: 0, maxH: 100000, maxW: 100000, note: '', category: 'mechanism', unit: 'шт' };
  } else if (category === 'handle') {
    cat.HANDLES[key] = { id: key, name: 'Новая позиция', holes: 2, cc: 0, price: 0,
      article: '', unit: 'шт', category: 'handle' };
  } else if (category === 'fastener') {
    cat.FASTENER_PRICES[key] = { name: 'Новая позиция', article: '', price: 0, unit: 'шт', category: 'fastener' };
  } else {
    cat.HARDWARE_PRICES[key] = { name: 'Новая позиция', article: '', price: 0, unit: 'шт', category };
  }
}

function libAddRow(group) {
  const cat = window.Modul3D.catalog;
  if (group.indexOf('hwadd:') === 0) {
    libAddHardwareRow(group.slice(6));
  } else if (group === 'decors') {
    DECORS.push({ code: 'NEW-' + Date.now(), name: 'Новый материал', sheetPrice: 0, sheetW: 2750, sheetH: 1830, unit: 'лист', image: null });
  } else if (group === 'back') {
    BACK_MATERIALS.push({ code: 'NEW-' + Date.now(), name: 'Новый материал', sheetPrice: 0, sheetW: 2440, sheetH: 1220, unit: 'лист', image: null });
  } else if (group === 'facade') {
    const code = 'FAC-NEW-' + Date.now();
    cat.FACADE_MATERIALS[code] = { code, name: 'Новый материал фасада', sheetPrice: 0, sheetW: 2750, sheetH: 1830, unit: 'лист', image: null };
  } else if (group === 'edge') {
    const name = (window.prompt('Название новой кромки:') || '').trim();
    if (!name) return;
    if (cat.EDGE_PRICES[name]) { window.alert('Кромка с таким названием уже есть в каталоге.'); return; }
    cat.EDGE_PRICES[name] = { price: 0, unit: 'пог.м', image: null };
  } else {
    return;
  }
  recompute();
  renderLibraryPanel();
}

// Загрузка образца (карточки цвета) — чисто клиентская: input[type=file] →
// FileReader → dataURL, без бэкенда.
let pendingLibImageTarget = null;
function openLibImagePicker(group, key) {
  const input = document.getElementById('libImageInput');
  if (!input) return;
  pendingLibImageTarget = { group, key };
  input.value = '';
  input.click();
}
function initLibImageInput() {
  const input = document.getElementById('libImageInput');
  if (!input) return;
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    const target = pendingLibImageTarget;
    if (!file || !target) return;
    const reader = new FileReader();
    reader.onload = () => libSaveEdit(target.group, target.key, 'image', String(reader.result));
    reader.readAsDataURL(file);
  });
}

// Клик по ячейке → инлайн-инпут; Enter/blur — сохранить, Esc — отменить.
function startCellEdit(cell) {
  if (cell.querySelector('input')) return;
  const type = cell.dataset.type === 'number' ? 'number' : 'text';
  const cur = cell.textContent;
  cell.innerHTML = `<input type="${type}" ${type === 'number' ? 'step="any"' : ''} value="${esc(cur)}">`;
  const input = cell.querySelector('input');
  input.focus();
  if (input.select) input.select();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const val = type === 'number' ? (Number(input.value) || 0) : input.value;
    libSaveEdit(cell.dataset.group, cell.dataset.key, cell.dataset.field, val);
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); done = true; renderLibraryPanel(); }
  });
}

// Поиск в «Библиотеке» — та же логика, что и у поиска по панели параметров
// (ui-shell.js: applySearch/class dim-out), адаптирована под содержимое
// активной вкладки: карточки базы модулей (.lib-item, по data-tip) и строки
// таблиц материалов/фурнитуры (tr[data-search], по атрибуту).
function applyLibrarySearch() {
  const input = document.getElementById('librarySearch');
  const panel = document.getElementById('libraryPanel');
  if (!input || !panel) return;
  const q = (input.value || '').trim().toLowerCase();
  panel.querySelectorAll('tr[data-search]').forEach((tr) => {
    tr.classList.toggle('dim-out', !!q && tr.getAttribute('data-search').indexOf(q) < 0);
  });
  panel.querySelectorAll('.lib-item').forEach((el) => {
    const text = (el.getAttribute('data-tip') || '').toLowerCase();
    el.classList.toggle('dim-out', !!q && text.indexOf(q) < 0);
  });
}

function renderLibraryPanel() {
  const panel = document.getElementById('libraryPanel');
  if (!panel) return;
  document.querySelectorAll('.lib-tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.libtab === state.libraryTab);
  });
  // На «Материалах»/«Фурнитуре» таблицы шире панели «Базы модулей» — даём
  // #drawer-library подстроить ширину под содержимое (см. .lib-wide в
  // style.css); на «Базе модулей» ширина панели остаётся фиксированной.
  const drawer = document.getElementById('drawer-library');
  if (drawer) {
    drawer.classList.toggle('lib-wide', state.libraryTab === 'materials' || state.libraryTab === 'hardware');
  }
  if (state.libraryTab === 'materials') panel.innerHTML = libraryMaterialsBlock();
  else if (state.libraryTab === 'hardware') panel.innerHTML = libraryHardwareBlock();
  else panel.innerHTML = libraryBlock();   // 'modules' — существующая база модулей, без изменений
  bindLibraryEvents();
  applyLibrarySearch();
}

// Слушатели вешаются один раз (контейнер #libraryPanel и строка вкладок
// переживают перерисовки — меняется только их содержимое/класс active),
// поэтому в отличие от bindPanelEvents() это не нужно звать заново.
function initLibraryPanel() {
  const panel = document.getElementById('libraryPanel');
  if (!panel) return;
  const tabsRow = document.getElementById('libTabs');
  if (tabsRow) tabsRow.addEventListener('click', (e) => {
    const b = e.target.closest('.lib-tab-btn');
    if (!b) return;
    state.libraryTab = b.dataset.libtab;
    renderLibraryPanel();
  });
  const search = document.getElementById('librarySearch');
  if (search) search.addEventListener('input', applyLibrarySearch);

  panel.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.lib-add');
    if (addBtn) { libAddRow(addBtn.dataset.add); return; }
    const swatch = e.target.closest('.lib-swatch');
    if (swatch) { openLibImagePicker(swatch.dataset.swatchGroup, swatch.dataset.swatchKey); return; }
    const cell = e.target.closest('.lib-edit-cell');
    if (cell) { startCellEdit(cell); return; }
  });

  initLibImageInput();
  renderLibraryPanel();
}

// Якорь навигации: вкладки модулей (Модуль 1/Модуль 2/«+»). Виден ВСЕГДА,
// независимо от того, какой экран (panelView) сейчас показан ниже.
// Отменить/Вернуть/Удалить модуль переехали в шапку программы (иконки рядом
// с «Сохранить»/«Открыть» — см. index.html и initHeaderControls() ниже);
// «Библиотека» — отдельная панель со своей кнопкой на рейке.
function moduleTabsBlock(mod) {
  return `
    <h3>Модули проекта</h3>
    <div class="mod-tabs" id="modTabs">
      ${state.modules.map((m, i) =>
        `<button class="mod-tab tip tip-down ${i === state.activeModule ? 'active' : ''}" data-mod="${i}" type="button"
                 data-tip="ПКМ: переименование">${esc(m.name)}${m.rotation ? ` ↻${m.rotation}°` : ''}</button>`
      ).join('')}
      <button class="mod-add tip tip-down" id="addModule" type="button" data-tip="Добавить модуль" aria-label="Добавить модуль">+</button>
    </div>`;
}

// Экран пустого проекта: показывается вместо параметров модуля, пока в
// проекте нет ни одного модуля (панель «Библиотека» теперь отдельная —
// с рейки на неё есть своя кнопка, здесь только подсказка).
function emptyProjectBlock() {
  return `<div class="hint">Проект пуст. Откройте «Библиотеку» на рейке слева, чтобы выбрать
    готовый модуль, или добавьте свой кнопкой «+» выше.</div>`;
}

// Маленькая ссылка «← Назад» сверху служебных экранов «Деталь»
// (partBlock/partPlaceholderBlock/partKindPlaceholderBlock) — ведёт на
// «Параметры модуля» (этот экран показывается только когда модуль есть,
// см. renderParamsPanel). Экран «Материалы» использует отдельную акцентную
// кнопку — см. materialsBackLinkBlock() ниже: туда и обратно ведёт парная
// навигация («Материалы модуля →» / «← Конструктив модуля») одного
// визуального веса, а экраны «Деталь» — второстепенные точки входа
// (контекстное меню в 3D, рейка), где обычная неприметная ссылка уместнее.
function backLinkBlock() {
  return `<button class="link-btn panel-back" id="panelBack" type="button">← Назад</button>`;
}

// Акцентная кнопка возврата с экрана «Материалы модуля» на «Конструктив
// модуля» — визуальная пара к «Материалы модуля →» в moduleFieldsBlock()
// (тот же .materials-link-btn, полная ширина, акцентный цвет), но с
// модификатором .back-link-btn: стрелка и текст идут одной группой у левого
// края, а не разъезжаются по краям, как у кнопки «вперёд» (см. комментарий
// к .back-link-btn в style.css). id остаётся panelBack — обработчик в
// bindPanelEvents() как и раньше ведёт на setPanelView('module').
function materialsBackLinkBlock() {
  return `<button class="btn materials-link-btn back-link-btn" id="panelBack" type="button"><span class="arrow">←</span> Конструктив модуля</button>`;
}

// Экран «Параметры модуля»: название/габариты/конструктив/секции активного
// модуля. Показывается только когда есть выбранный модуль.
function moduleFieldsBlock(mod) {
  return `
    <button class="btn materials-link-btn" id="materialsLinkBtn" type="button">Материалы модуля <span class="arrow">→</span></button>

    <h3>Габариты модуля, мм</h3>
    <div class="field-row3">
      <div class="field"><label>Высота</label><input id="m-height" type="number" step="10" value="${mod.height}"></div>
      <div class="field"><label>Ширина</label><input id="m-width" type="number" step="10" value="${mod.width}"></div>
      <div class="field"><label>Глубина</label><input id="m-depth" type="number" step="10" value="${mod.depth}"></div>
    </div>

    <h3>Конструктив модуля</h3>
    <div class="field-row">
      <div class="field">
        <label>Левая боковина</label>
        <select id="m-leftSide">${sideOptions(mod.leftSide)}</select>
      </div>
      <div class="field">
        <label>Правая боковина</label>
        <select id="m-rightSide">${sideOptions(mod.rightSide)}</select>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Основание</label>
        <select id="m-baseType">
          <option value="legsPlinth" ${mod.baseType === 'legsPlinth' ? 'selected' : ''}>опоры с цоколем</option>
          <option value="plinth" ${mod.baseType === 'plinth' ? 'selected' : ''}>цоколь</option>
          <option value="legs" ${mod.baseType === 'legs' ? 'selected' : ''}>опоры</option>
        </select>
      </div>
      <div class="field">
        <label>${mod.baseType === 'plinth' ? 'Высота цоколя, мм' : 'Высота опор, мм'}</label>
        <input id="m-baseHeight" type="number" step="10" value="${mod.baseType === 'plinth' ? mod.plinthHeight : mod.legHeight}">
      </div>
    </div>
    ${mod.baseType === 'legs' ? `
    <div class="field-row">
      <div class="field">
        <label>Тип опоры</label>
        <select id="m-legType">
          <option value="metal" ${mod.legType !== 'kitchen' ? 'selected' : ''}>металлическая</option>
          <option value="kitchen" ${mod.legType === 'kitchen' ? 'selected' : ''}>кухонная</option>
        </select>
      </div>
    </div>` : ''}

    <h3>${esc(mod.name)} — секции</h3>
    <div id="sectionsList"></div>
    <button class="add-section-btn" id="addSection" type="button">+ Добавить секцию</button>`;
}

// Виды деталей, для которых движок (engine.js, applyPartOverrides) умеет
// применять ручные правки — толщина/материал/доп. отверстия (см.
// OVERRIDABLE_KINDS в engine.js). Список ДОЛЖЕН совпадать буквально — иначе
// экран покажет поля, которые движок тихо проигнорирует.
const OVERRIDABLE_PART_KINDS = new Set(['side', 'bottom', 'top', 'back', 'plinth']);
const PART_KIND_TITLES = {
  side: 'Боковина', bottom: 'Дно', top: 'Крыша / планка', back: 'Задняя стенка', plinth: 'Цоколь',
  door: 'Фасад', drawerFront: 'Фасад ящика',
};

// Определение стороны по имени детали — ТОЧНО как partOverrideSide() в
// engine.js и userData.side в viewer.js. Меняешь одно — меняй все три места.
function partOverrideSideOf(part) {
  const nm = (part && part.name) || '';
  if (nm.indexOf('лев') >= 0) return 'left';
  if (nm.indexOf('прав') >= 0) return 'right';
  return null;
}

// Находит в currentModel.partsRaw все «сырые» детали активного модуля
// заданного вида и считает для каждой её ключ override — ТОЧНО той же
// логикой (группировка kind+section+side, номер — порядковый внутри
// группы), что applyPartOverrides() в engine.js. Порядок возврата совпадает
// с порядком появления детали в модели.
function overridablePartCandidates(mod, kind) {
  const rows = (currentModel && currentModel.partsRaw) || [];
  const counters = {};
  const list = [];
  for (const r of rows) {
    if (r.module !== mod.name || r.kind !== kind) continue;
    const side = partOverrideSideOf(r);
    const groupKey = [r.kind, r.section || '', side || ''].join('|');
    const index = counters[groupKey] || 0;
    counters[groupKey] = index + 1;
    list.push({ part: r, side, key: [r.kind, r.section || '', side || '', index].join('|') });
  }
  return list;
}

// Общий выбор «текущей» сырой детали по state.selectedPart — той же логикой
// (кандидаты + индекс), которой раньше пользовался только partBlock() ниже.
// Вынесено отдельно, чтобы визуальный редактор вырезов (openPartVisualEditor)
// указывал ТОЧНО на ту же деталь, что и показанная в partBlock(), без
// дублирования и риска разойтись.
function resolveSelectedPart(mod) {
  const sp = state.selectedPart;
  if (!mod || !sp) return { candidates: [], chosenIdx: -1, chosen: null };
  const candidates = overridablePartCandidates(mod, sp.kind);

  // Для боковины сторона уже известна из клика (sp.side). Для остальных
  // видов деталь в модуле почти всегда одна (index 0) — исключение крыша
  // из двух планок (topType: 'rails'/'railsEdge', см. ниже subIndex).
  let chosenIdx;
  if (sp.kind === 'side') {
    chosenIdx = candidates.findIndex((c) => c.side === sp.side);
    if (chosenIdx < 0) chosenIdx = 0;
  } else if (sp.kind === 'door') {
    // У модуля почти всегда несколько дверей (по секции/зоне) — subIndex
    // здесь всегда 0 (openPartEditor его не считает для door), поэтому
    // ищем ту же деталь по sectionIndex+zoneIndex, а не по порядку.
    chosenIdx = candidates.findIndex((c) =>
      c.part.sectionIndex === sp.sectionIndex && c.part.zoneIndex === sp.zoneIndex);
    if (chosenIdx < 0) chosenIdx = 0;
  } else {
    chosenIdx = Number.isFinite(sp.subIndex) ? sp.subIndex : 0;
    if (chosenIdx < 0 || chosenIdx >= candidates.length) chosenIdx = 0;
  }
  return { candidates, chosenIdx, chosen: candidates[chosenIdx] || null };
}

// Экран «Деталь»: открывается пунктом «Редактировать» контекстного меню
// фокуса (см. showFocusMenu/openPartEditor ниже), которое, в свою очередь,
// открывается кликом по детали внутри изолированного в 3D модуля
// (viewer.onSelectPart). Полноценные поля (толщина/материал/доп. отверстия,
// см. OVERRIDABLE_PART_KINDS выше) — для боковины, дна, крыши, задней стенки
// и цоколя; для остальных видов деталей по-прежнему показывается заглушка
// partKindPlaceholderBlock (см. renderParamsPanel). Для боковины показывается
// ещё и «Конструктив» — тот же самый инпут, что и в общих параметрах модуля
// (id m-leftSide/m-rightSide): существующий обработчик в bindPanelEvents()
// слушает эти id и продолжает работать без изменений, где бы они ни были
// отрисованы.
function partBlock(mod) {
  const sp = state.selectedPart;
  const kind = sp.kind;
  const kindTitle = PART_KIND_TITLES[kind] || 'Деталь';
  const { candidates, chosenIdx, chosen } = resolveSelectedPart(mod);

  if (!chosen) {
    return `
      ${backLinkBlock()}
      <h3>${esc(kindTitle)}</h3>
      <div class="hint">Деталь не найдена в текущей модели — возможно, она объединена
      с соседним модулем (например, цоколь идёт сквозной планкой на весь ряд) или
      параметры модуля изменились. Закройте фокус и выберите деталь заново.</div>`;
  }

  const part = chosen.part;
  const ov = (mod.partOverrides && mod.partOverrides[chosen.key]) || {};
  const decorList = kind === 'back' ? BACK_MATERIALS : DECORS;
  const extraHoles = Array.isArray(ov.extraHoles) ? ov.extraHoles : [];

  let kindSpecific;
  if (kind === 'side') {
    const isLeft = sp.side === 'left';
    const label = isLeft ? 'левая' : 'правая';
    const cur = isLeft ? mod.leftSide : mod.rightSide;
    const selectId = isLeft ? 'm-leftSide' : 'm-rightSide';
    // «Видимая» боковина читается из уже ПОСЧИТАННОЙ модели, а не
    // пересчитывается здесь заново — единый источник истины остаётся
    // engine.js (см. buildModel: боковина получает facadeType: 'sidePanel',
    // когда она видима и режется в декоре фасада).
    const visible = !!(part.facadeType === 'sidePanel');
    kindSpecific = `
    <h3>Боковина ${label}</h3>
    <div class="field">
      <label>Конструктив</label>
      <select id="${selectId}">${sideOptions(cur)}</select>
    </div>
    ${visible ? `
    <div class="hint">Эта боковина видимая — режется в декоре фасада.</div>
    <button class="link-btn" id="partToFacadeDecor" type="button">Изменить декор фасада →</button>` : ''}`;
  } else if (kind === 'top' && (mod.topType === 'rails' || mod.topType === 'railsEdge')) {
    // Верх модуля из двух планок можно положить плашмя (толщина детали
    // лежит по вертикали) или поставить на ребро (толщина лежит по
    // глубине) — сама геометрия обоих вариантов уже в engine.js
    // (buildModel, topType 'rails'/'railsEdge'), кнопка только переключает
    // mod.topType между ними (см. bindPanelEvents ниже).
    const onEdge = mod.topType === 'railsEdge';
    kindSpecific = `
    <h3>${esc(part.name || kindTitle)}</h3>
    <button class="btn part-top-edge-btn${onEdge ? ' active' : ''}" id="partTopOnEdgeToggle" type="button">Расположить на ребро</button>`;
  } else {
    kindSpecific = `<h3>${esc(part.name || kindTitle)}</h3>`;
  }

  // Единственный случай больше одной детали одного вида в модуле — крыша из
  // двух планок (topType: 'rails'/'railsEdge'). Клик в 3D не даёт различить,
  // по какой именно планке кликнули (viewer.js передаёт только kind, не
  // индекс — см. onSelectPart), поэтому даём выбрать деталь селектором.
  const subIndexBlock = candidates.length > 1 ? `
    <div class="field">
      <label>Какая деталь</label>
      <select id="partSubIndex">
        ${candidates.map((c, i) => `<option value="${i}" ${i === chosenIdx ? 'selected' : ''}>${esc(c.part.name || (kindTitle + ' ' + (i + 1)))}</option>`).join('')}
      </select>
    </div>` : '';

  return `
    ${backLinkBlock()}
    ${kindSpecific}
    ${subIndexBlock}
    ${part.overridden ? '<div class="hint">⚠ Эта деталь отличается от проектных настроек — переопределена вручную.</div>' : ''}
    <div id="partOverridePanel" data-key="${esc(chosen.key)}">
      <div class="field">
        <label>Толщина, мм</label>
        <input id="partThickness" type="number" min="1" step="0.5" value="${part.thickness}">
      </div>
      <div class="field">
        <label>Материал / декор</label>
        <select id="partMaterial">${decorList.map(d => `<option value="${d.code}" ${d.code === part.material ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
      </div>

      <h4 class="mat-sub">Дополнительные отверстия</h4>
      <div class="hint">Координаты — в системе координат самой детали: начало в левом
      нижнем углу лицевой стороны, X вправо по длине, Y вверх по ширине, в мм
      (та же система, что и в присадке для ЧПУ). Отступы от края не проверяются —
      за расположение отвечаете вы.</div>
      <div id="extraHolesList">
        ${extraHoles.length ? extraHoles.map((h, i) => `
          <div class="extra-hole-row">
            <div class="field-row3">
              <div class="field"><label class="axis-label-x">X, мм</label><input type="number" step="1" value="${h.x}" data-hole-field="x" data-hole-idx="${i}"></div>
              <div class="field"><label class="axis-label-y">Y, мм</label><input type="number" step="1" value="${h.y}" data-hole-field="y" data-hole-idx="${i}"></div>
              <div class="field"><label>⌀, мм</label><input type="number" step="0.5" min="0" value="${h.d}" data-hole-field="d" data-hole-idx="${i}"></div>
            </div>
            <button type="button" class="remove-section" data-remove-hole="${i}">✕ убрать отверстие ${i + 1}</button>
          </div>`).join('') : '<div class="hint">Отверстий нет</div>'}
      </div>
      <button class="add-section-btn" id="addExtraHole" type="button">+ Добавить отверстие</button>

      <button class="link-btn" id="openPartVisualEditorBtn" type="button">Открыть визуальный редактор вырезов →</button>
    </div>`;
}

// Заглушка экрана «Деталь», когда на него перешли с рейки напрямую (кнопка
// «Деталь»), а не через контекстное меню фокуса — редактировать пока нечего,
// но и откатывать на другой экран не нужно: рейка должна вести именно сюда.
// Полноценный редактор геометрии (вырезы/пазы) — задача другого этапа, здесь
// только подсказка, как выбрать деталь для редактирования.
function partPlaceholderBlock() {
  return `
    ${backLinkBlock()}
    <h3>Деталь</h3>
    <div class="hint">Чтобы отредактировать деталь: дважды кликните по модулю в 3D-сцене,
    кликните по нужной детали, затем выберите «Редактировать» в открывшемся меню
    (полноценный экран есть для боковины, дна, крыши, задней стенки и цоколя).</div>`;
}

// Заглушка экрана «Деталь» для видов деталей, у которых ещё нет полноценного
// экрана (сейчас поддерживаются боковина/дно/крыша/задняя стенка/цоколь —
// см. OVERRIDABLE_PART_KINDS и partBlock выше). Открывается через
// «Редактировать» в контекстном меню фокуса (openPartEditor), когда
// выбранная деталь — из остальных видов (полка, фасад, перегородка и т.п.).
// Когда появится общий редактор геометрии детали — эта функция и есть точка,
// которую нужно будет заменить/расширить, вызывающий код (openPartEditor)
// менять не придётся.
function partKindPlaceholderBlock(kind) {
  const title = PART_KIND_TITLES[kind] || kind;
  return `
    ${backLinkBlock()}
    <h3>Деталь</h3>
    <div class="hint">Редактор для этого вида детали (${esc(title)}) появится отдельным этапом.</div>`;
}

// Компактный редактор ОДНОЙ зоны фасада — открывается «Редактировать» в
// контекстном меню фокуса (openPartEditor) для kind:'door'. Это единственное
// место, где настраиваются зоны многозонного фасада (в сайдбаре, см.
// renderSectionsList, для такой секции — только подсказка со ссылкой сюда):
// показывает поля только той зоны, по которой кликнули в 3D. Модель данных
// фасада (sec.facade / sec.doorZones[]) — не в mod.partOverrides, поэтому
// это отдельная от partBlock() функция, не через OVERRIDABLE_PART_KINDS.
function doorZoneEditorScreen(mod, sectionIndex, zoneIndex) {
  const sec = mod.sections[sectionIndex];
  if (!sec) {
    return `
      ${backLinkBlock()}
      <h3>Фасад</h3>
      <div class="hint">Секция не найдена — возможно, параметры модуля изменились.
      Закройте фокус и выберите фасад заново.</div>`;
  }
  const doorZoneCount = Number(sec.doorZoneCount) || 1;
  // Однозонный режим — в модели данных нет высоты/техники/заметки на уровне
  // секции (только sec.facade), zoneCardHtml сюда не подходит: показываем
  // минимальный select, как в сайдбаре для того же случая.
  if (doorZoneCount <= 1) {
    return `
      ${backLinkBlock()}
      <h3>Фасад · Секция ${sectionIndex + 1}</h3>
      <div id="doorZoneEditorRoot">
        <div class="field">
          <label>Фасад</label>
          <select data-singlefacade="${sectionIndex}">
            <option value="doorLeft" ${(sec.facade === 'doorLeft' || sec.facade === 'doors1') ? 'selected' : ''}>Дверь левая</option>
            <option value="doorRight" ${sec.facade === 'doorRight' ? 'selected' : ''}>Дверь правая</option>
            <option value="doors2" ${sec.facade === 'doors2' ? 'selected' : ''}>Две двери</option>
            <option value="liftUp" ${sec.facade === 'liftUp' ? 'selected' : ''}>Открывание вверх</option>
            <option value="blindFacade" ${sec.facade === 'blindFacade' ? 'selected' : ''}>Заглушка</option>
            <option value="open" ${sec.facade === 'open' ? 'selected' : ''}>Без дверей</option>
          </select>
        </div>
        <div class="hint">Материал фасада и ручка — на экране «Параметры проекта»
        этого модуля. Число зон по высоте меняется через «Разделить на секции
        по вертикали» в контекстном меню фасада в 3D.</div>
        <div class="field"><label>Полки, шт</label><input type="number" min="0" max="12" value="${sec.shelves}" data-field="shelves" data-idx="${sectionIndex}"></div>
        ${shelfDetailBlock(sec, sectionIndex)}
      </div>`;
  }
  const zi = Number.isFinite(zoneIndex) && zoneIndex >= 0 && zoneIndex < doorZoneCount ? zoneIndex : 0;
  return `
    ${backLinkBlock()}
    <h3>Фасад · Секция ${sectionIndex + 1}</h3>
    <div id="doorZoneEditorRoot">
      ${zoneCardHtml(sec, sectionIndex, zi, doorZoneCount)}
    </div>`;
}

// Точка входа в экран редактирования детали — сюда ведёт пункт
// «Редактировать» контекстного меню фокуса (см. showFocusMenu). Когда
// появится полноценный редактор геометрии (вырезы/пазы, орто-вид, сетка
// 32мм, материал/толщина конкретной детали — отдельная задача с отдельной
// архитектурой хранения ручных правок), менять нужно будет только то, ЧТО
// показывается на экране «part» (partBlock/partKindPlaceholderBlock и
// renderParamsPanel ниже), саму точку вызова из меню — не нужно.
function openPartEditor(module, kind, side, sectionIndex, zoneIndex, asPart) {
  state.selectedPart = {
    module, kind, side, subIndex: 0,
    // У фасадов (kind:'door'/'drawerFront') — числовой индекс секции/зоны фасада,
    // которую кликнули в 3D (см. viewer.js userData.sectionIndex/zoneIndex).
    // Undefined для остальных видов деталей — им это поле не нужно.
    sectionIndex, zoneIndex,
    // Для kind:'door' — true, если открыли именно как деталь (пункт меню
    // «Редактировать деталь», второй у фасада), а не как зону фасада
    // (пункт «Редактировать секцию» → doorZoneEditorScreen). Остальным
    // видам деталей не нужно.
    asPart: !!asPart,
  };
  state.panelView = 'part';
  renderParamsPanel();
  // viewOpts() теперь учитывает state.panelView/selectedPart (см. highlightSection) —
  // без явного re-render 3D-сцена остаётся в прежнем виде, пока что-то ещё
  // не вызовет recompute()/render() (как это уже сделано в exitFocusMode).
  if (viewer && currentModel) viewer.render(currentModel, viewOpts());
  // Экран «Деталь» рисуется в #paramsPanel, но сам дровер «Параметры проекта»
  // открывается только рейкой (ui-shell.js). Вход сюда — из контекстного меню
  // в 3D, а не с рейки, и дровер в этот момент может быть закрыт (например,
  // если до этого была открыта «Библиотека» и закрыта) — тогда контент рисуется,
  // но невидим. Открываем дровер явно, иначе «Редактировать» выглядит так,
  // будто ничего не произошло.
  if (window.Modul3D.uiShell) window.Modul3D.uiShell.openDrawer('params');
}

// ---------------------------------------------------------------------------
// Визуальный редактор вырезов детали — Этап 1: полноэкранный контейнер +
// статичный вид, без интерактива (направляющие, построение фигур — отдельные
// следующие этапы). Открывается кнопкой «Открыть визуальный редактор вырезов»
// в partBlock() поверх экрана «Деталь», для ТОЙ ЖЕ детали, что там показана
// (см. resolveSelectedPart). Это ДОПОЛНИТЕЛЬНЫЙ способ работы с деталью, а не
// замена partBlock() — толщина/материал/простые отверстия по-прежнему через
// обычную форму.
// ---------------------------------------------------------------------------

// Заголовок + вид детали внутри уже открытого оверлея. Сам SVG строит
// window.Modul3D.drawings.buildPartEditorView(part, opts) (см. drawings.js —
// принимает «сырую» деталь из model.partsRaw и необязательные opts.scale/
// showGrid/gridMinor/gridMajor, возвращает готовую строку <svg>). Функция
// умеет отсутствовать (например, если этот контейнер грузится раньше, чем
// собран drawings.js) — тогда показываем понятную заглушку вместо ошибки.
function renderPartEditorOverlay(part) {
  const title = document.getElementById('partEditorTitle');
  const canvas = document.getElementById('partEditorCanvas');
  if (!canvas) return;
  if (title) title.textContent = `Редактор выреза — ${part.name || PART_KIND_TITLES[part.kind] || 'Деталь'}`;

  const drawings = window.Modul3D.drawings || {};
  if (typeof drawings.buildPartEditorView === 'function') {
    try {
      canvas.innerHTML = drawings.buildPartEditorView(part, {});
    } catch (err) {
      console.error('Part editor view failed:', err);
      canvas.innerHTML = `<div class="hint">Не удалось построить вид детали: ${esc(err.message)}</div>`;
    }
  } else {
    canvas.innerHTML = `<div class="hint">Визуальный вид детали появится здесь — строит его
      window.Modul3D.drawings.buildPartEditorView(part, opts), которая пока готовится
      отдельно.</div>`;
  }
}

// Открывает полноэкранный оверлей для детали, выбранной сейчас на экране
// «Деталь» (state.selectedPart) — той же самой, что показывает partBlock().
function openPartVisualEditor() {
  const mod = state.modules.find((m) => m.name === (state.selectedPart || {}).module);
  const resolved = resolveSelectedPart(mod);
  if (!resolved.chosen) return;
  state.partEditorOpen = true;
  renderPartEditorOverlay(resolved.chosen.part);
  const overlay = document.getElementById('partEditorOverlay');
  if (overlay) {
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
  }
}

// Закрывает оверлей и возвращает в режим фокуса на модуле (экран «Деталь») —
// НЕ выходит из изоляции модуля целиком, только закрывает этот полноэкранный
// режим (см. бриф про фокус-режим: выход из самого фокуса — отдельный пункт
// контекстного меню, не красный крестик здесь).
function closePartVisualEditor() {
  state.partEditorOpen = false;
  const overlay = document.getElementById('partEditorOverlay');
  if (overlay) {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  }
}

// Оверлей статичный (разметка index.html), не пересоздаётся при каждом
// renderParamsPanel() — как и шапка (см. initHeaderControls), обработчик
// закрытия вешается один раз здесь.
function initPartEditorOverlay() {
  const closeBtn = document.getElementById('partEditorClose');
  if (closeBtn) closeBtn.addEventListener('click', closePartVisualEditor);
}

// Экран «Материалы»: общие на весь проект декор/толщины/фурнитура —
// не привязаны к конкретному модулю.
function materialsBlock() {
  return `
    <h3>Материалы (общие на проект)</h3>
    <div class="field">
      <label>Материал корпуса</label>
      <select id="p-decor">${DECORS.map(d => `<option value="${d.code}" ${d.code === state.decorCode ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
    </div>
    <div class="field">
      <label>Материал фасада</label>
      <select id="p-facadeDecor">${DECORS.map(d => `<option value="${d.code}" ${d.code === state.facadeDecorCode ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
      <div class="hint">Видимая боковина (до пола или сбоку дна) режется в этом декоре</div>
    </div>
    <div class="field-row">
      <div class="field"><label>Толщина ЛДСП</label><input id="p-bodyThickness" type="number" value="${state.bodyThickness}"></div>
      <div class="field"><label>Толщина фасада, мм</label><input id="p-facadeThickness" type="number" value="${state.facadeThickness}"></div>
    </div>
    <div class="field">
      <label>Глубина столешницы, мм</label>
      <input id="p-worktop" type="number" value="${state.worktopDepth}">
      <div class="hint">Видимая боковина крайнего модуля дотягивается до стены по этому размеру</div>
    </div>
    <div class="field">
      <label>Задняя стенка</label>
      <select id="p-back">${BACK_MATERIALS.map(d => `<option value="${d.code}" ${d.code === state.backCode ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Толщина ХДФ</label><input id="p-backThickness" type="number" value="${state.backThickness}"></div>

    <div class="field">
      <label>Тип соединения корпуса</label>
      <select id="p-joint">
        <option value="confirmat" ${state.jointType === 'confirmat' ? 'selected' : ''}>Конфирмат</option>
        <option value="minifix" ${state.jointType === 'minifix' ? 'selected' : ''}>Эксцентриковая стяжка</option>
        <option value="dowel" ${state.jointType === 'dowel' ? 'selected' : ''}>Шкант</option>
      </select>
    </div>`;
}

// Экран «Ящики» — отдельная панель для ОДНОЙ секции ОДНОГО модуля (не список,
// как renderSectionsList): открывается кнопкой «Редактировать ящики →» под
// полем «Ящики, шт» (см. openDrawersPanel). Материал/толщина/система ящиков
// раньше были общими на весь проект (state.drawerDecorCode/drawerThickness/
// drawerSystem) — теперь это поля секции (sec.drawerDecorCode/drawerThickness/
// drawerSystem, см. newSection()), потому что у разных секций одного проекта
// могут стоять разные ящики. Поля используют простые уникальные id (а не
// делегированный обработчик [data-field] из renderSectionsList, который
// слушает только #sectionsList — этот экран отрисован в другом месте DOM).
function drawersPanelBlock(mod, secIndex) {
  const sec = mod.sections[secIndex];
  const sys = sec.drawerSystem || 'ballBearing';

  // 1. Высота фасадов ящиков — режим auto/manual + список высот сверху вниз
  // (перенесено как есть из старого инлайн-блока renderSectionsList, включая
  // разворот индекса и кнопку «сбросить фиксацию»).
  const heightsBlock = `
    <h3>Высота фасадов ящиков</h3>
    <div class="field">
      <select id="drawersMode">
        <option value="auto" ${sec.drawerMode !== 'manual' ? 'selected' : ''}>распределить автоматически</option>
        <option value="manual" ${sec.drawerMode === 'manual' ? 'selected' : ''}>задать вручную</option>
      </select>
    </div>
    ${sec.drawerMode === 'manual' ? `
    <div class="field">
      <label>Высота фасада каждого ящика, мм <span class="dim">(сверху вниз)</span></label>
      <div class="mini-row">
        ${Array.from({ length: sec.drawers }, (_, k) => {
          // Поля идут СВЕРХУ ВНИЗ, как на самой мебели. В модели ящики
          // считаются снизу, поэтому индекс разворачиваем — иначе правка
          // «верхнего» уходила в нижний ящик.
          const d = sec.drawers - 1 - k;
          const pinned = !!(sec.drawerPinned && sec.drawerPinned[d]);
          return `<input type="number" step="10" min="50" value="${manualHeights(secIndex, sec)[d]}"
                  class="${pinned ? 'pinned' : ''}" data-drawer="${d}"
                  title="${k === 0 ? 'Верхний ящик' : (k === sec.drawers - 1 ? 'Нижний ящик' : 'Ящик ' + (k + 1) + ' сверху')}${pinned ? ' — задан вручную, автоматически не меняется' : ' — подстраивается автоматически'}">`;
        }).join('')}
      </div>
      <div class="hint">Сумма высот равна фронту секции: правите один ящик — остаток
        разбирают только те, что ещё не задавали вручную.</div>
      <div class="hint">Заданный вручную ящик выделяется и больше не меняется автоматически —
        остаток разбирают только незафиксированные.
        <button type="button" class="link-btn" id="drawersUnpinBtn">сбросить фиксацию</button></div>` : ''}`;

  return `
    ${materialsBackLinkBlock()}
    <h3>Ящики — ${esc(mod.name)} — Секция ${secIndex + 1}</h3>
    <div id="drawersPanelRoot">
      ${heightsBlock}

      <h3>Материал ящиков</h3>
      <div class="field">
        <label>Толщина ЛДСП ящиков</label>
        <input id="drawersThickness" type="number" step="1" value="${Number(sec.drawerThickness) || 16}">
      </div>
      <div class="field">
        <label>Материал ящиков</label>
        <select id="drawersDecor">${DECORS.map(d => `<option value="${d.code}" ${d.code === sec.drawerDecorCode ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label>Высота короба ящика</label>
        <select id="drawersBoxHeight">
          <option value="auto" ${(sec.drawerBoxHeight || 'auto') === 'auto' ? 'selected' : ''}>подобрать автоматически</option>
          ${(DRAWER_SYSTEMS[sys] || {}).heights
            ? DRAWER_SYSTEMS[sys].heights.map((h) =>
                `<option value="${h.code}" ${sec.drawerBoxHeight === h.code ? 'selected' : ''}>${h.code} — ${h.h} мм${h.reling ? ', с релингом' : ''} (фасад от ${h.minFront})</option>`).join('')
            : ''}
        </select>
        <div class="hint">Просвет над верхним коробом — не менее 25 мм.</div>
      </div>
      <div class="field">
        <label>Высота ящика от дна, мм</label>
        <input id="drawersOffset" type="number" step="10" min="10" value="${drawerOffsetOf(sec)}">
      </div>
      <div class="field">
        <label class="checkbox-inline"><input type="checkbox" id="drawersPushToOpen" ${sec.pushToOpen ? 'checked' : ''}> Push-to-open (без ручек)</label>
      </div>
      <div class="field">
        <label>Система ящиков</label>
        <select id="drawersSystem">
          ${DRAWER_SYSTEM_ORDER.map(id =>
            `<option value="${id}" ${id === sys ? 'selected' : ''}>${esc(DRAWER_SYSTEMS[id].name)}</option>`
          ).join('')}
        </select>
      </div>
    </div>`;
}

function renderParamsPanel() {
  const panel = document.getElementById('paramsPanel');
  if (state.activeModule >= state.modules.length) state.activeModule = state.modules.length - 1;
  if (state.activeModule < 0) state.activeModule = 0;
  const mod = state.modules[state.activeModule];

  // Экран «Деталь» показывает содержимое только пока выбранная деталь
  // принадлежит ИМЕННО активному модулю — если модуль пропал, или деталь
  // принадлежит другому модулю (доп. защита поверх exitIsolation() на случай
  // рассинхронизации), откатываем на параметры модуля. Вид детали (kind)
  // здесь больше не проверяем — теперь через меню фокуса можно выбрать любую
  // деталь, не только боковину; какой именно экран показать для данного kind
  // решается ниже (partBlock для боковины, partKindPlaceholderBlock —
  // заглушка для остальных видов, пока для них нет полноценного редактора).
  if (state.panelView === 'part' && state.selectedPart
      && (!mod || state.selectedPart.module !== mod.name)) {
    state.panelView = 'module';
  }

  // Экран «Ящики» (см. drawersPanelBlock ниже) привязан к конкретной секции
  // конкретного модуля — если модуль пропал, или индекс секции протух
  // (секцию удалили, сменили активный модуль, undo/redo), откатываем на
  // параметры модуля: та же защита, что и у экрана «Деталь» выше.
  if (state.panelView === 'drawers'
      && (!mod || !Number.isInteger(state.drawersSectionIndex)
          || state.drawersSectionIndex < 0 || state.drawersSectionIndex >= mod.sections.length)) {
    state.panelView = 'module';
  }

  // Пустой проект (или потеря последнего модуля) — параметрам модуля/детали/
  // материалов показывать нечего, панель «Библиотека» теперь отдельная и
  // сама панель параметров сюда пользователя не перекидывает.
  let screen;
  if (!mod) {
    screen = emptyProjectBlock();
  } else if (state.panelView === 'materials') {
    screen = materialsBackLinkBlock() + materialsBlock();
  } else if (state.panelView === 'drawers') {
    screen = drawersPanelBlock(mod, state.drawersSectionIndex);
  } else if (state.panelView === 'part') {
    if (!state.selectedPart) {
      screen = partPlaceholderBlock();
    } else if (state.selectedPart.kind === 'door' && !state.selectedPart.asPart) {
      screen = doorZoneEditorScreen(mod, state.selectedPart.sectionIndex, state.selectedPart.zoneIndex);
    } else if (OVERRIDABLE_PART_KINDS.has(state.selectedPart.kind)) {
      screen = partBlock(mod);
    } else {
      screen = partKindPlaceholderBlock(state.selectedPart.kind);
    }
  } else {
    // 'module' (и любое неизвестное/начальное значение)
    screen = moduleFieldsBlock(mod);
  }

  panel.innerHTML = moduleTabsBlock(mod) + screen;

  const drawerTitleEl = document.getElementById('paramsDrawerTitle');
  if (drawerTitleEl) {
    // «Редактор секции» — только для doorZoneEditorScreen (зона фасада).
    // Всё остальное на экране «part» (partBlock/partKindPlaceholderBlock,
    // включая дверь, открытую как деталь через asPart) — «Редактор детали»,
    // это другой, более старый экран, не про зоны фасада.
    const onSectionScreen = state.panelView === 'part' && state.selectedPart
      && state.selectedPart.kind === 'door' && !state.selectedPart.asPart;
    // state.selectedPart может обнулиться (undo/redo, удаление модуля,
    // открытие другого проекта — все через exitIsolation()) БЕЗ отката
    // panelView на 'module' — тогда экран уже откатился на подсказку
    // partPlaceholderBlock(), а заголовок без этой проверки остался бы
    // «Редактор детали».
    const onPartScreen = state.panelView === 'part' && !!state.selectedPart && !onSectionScreen;
    drawerTitleEl.textContent = onSectionScreen ? 'Редактор секции'
      : (onPartScreen ? 'Редактор детали' : 'Параметры проекта');
  }

  if (mod && state.panelView === 'module') renderSectionsList();
  bindPanelEvents();
}

// Подъём ящика от дна: меньше MIN_LIFT нельзя — иначе при выдвижении
// ящик задевает дно корпуса.
const MIN_LIFT = 10;
function drawerOffsetOf(sec) {
  const v = Number(sec.drawerOffset);
  return Math.max(MIN_LIFT, Number.isFinite(v) ? v : MIN_LIFT);
}

// Сведения о секции из ПОСЧИТАННОЙ модели: доступный фронт и фактические
// высоты фасадов ящиков. Панель опирается на них, а не считает заново.
function secCalc(secIndex) {
  const m = currentModel && currentModel.modules[state.activeModule];
  const info = m && m.dims && m.dims.sections && m.dims.sections[secIndex];
  return info || { drawerAvail: 0, drawerHeights: [] };
}

// Значения полей ручного режима. Если пользователь ещё ничего не задавал,
// берутся высоты, только что распределённые автоматически, — переключение
// режима больше не обнуляет ящики.
function manualHeights(secIndex, sec) {
  const auto = secCalc(secIndex).drawerHeights || [];
  const out = [];
  for (let d = 0; d < sec.drawers; d++) {
    const v = Number(sec.drawerHeights && sec.drawerHeights[d]);
    out.push(Number.isFinite(v) && v > 0 ? v : Math.round(Number(auto[d]) || 200));
  }
  return out;
}

// Раскладывает высоты фасадов так, чтобы их сумма равнялась доступному
// фронту. Ящики из списка `fixed` не трогаются вовсе — остаток делится только
// между свободными. Если свободных нет, значения остаются как заданы.
const MIN_DRAWER_H = 50;
function fitDrawerHeights(cur, fixed, avail) {
  const out = cur.slice();
  const free = [];
  for (let d = 0; d < out.length; d++) if (fixed.indexOf(d) === -1) free.push(d);
  if (!free.length || avail <= 0) return out;

  const fixedSum = fixed.reduce((a, d) => a + out[d], 0);
  const rest = avail - fixedSum;
  const base = Math.max(MIN_DRAWER_H, Math.floor(rest / free.length / 10) * 10);
  free.forEach((d) => { out[d] = base; });
  // неделимый остаток отдаём первому свободному ящику
  const diff = Math.round((avail - out.reduce((a, v) => a + v, 0)) * 10) / 10;
  out[free[0]] = Math.max(MIN_DRAWER_H, out[free[0]] + diff);
  return out;
}

// Пользователь поменял высоту фасада вручную. Этот ящик и все, которые он
// правил раньше, ФИКСИРУЮТСЯ и больше автоматически не меняются — остаток
// разбирают только те, к которым пользователь ещё не притрагивался.
function redistributeDrawers(secIndex, sec, changed, value) {
  const avail = Number(secCalc(secIndex).drawerAvail) || 0;
  const n = sec.drawers;
  const cur = manualHeights(secIndex, sec);

  sec.drawerPinned = (sec.drawerPinned || []).slice(0, n);
  sec.drawerPinned[changed] = true;

  const fixed = [];
  for (let d = 0; d < n; d++) if (sec.drawerPinned[d]) fixed.push(d);

  // Заданное значение ограничиваем так, чтобы свободным ящикам осталось
  // хотя бы по минимуму.
  const freeCount = n - fixed.length;
  const otherFixed = fixed.filter((d) => d !== changed).reduce((a, d) => a + cur[d], 0);
  const maxForChanged = Math.max(MIN_DRAWER_H, avail - otherFixed - MIN_DRAWER_H * freeCount);
  cur[changed] = Math.min(Math.max(MIN_DRAWER_H, Math.round(value)), maxForChanged);

  return fitDrawerHeights(cur, fixed, avail);
}

// После пересчёта модели (изменилась высота модуля, цоколь, число ящиков)
// свободные ящики подстраиваются под новый фронт, зафиксированные — нет.
// Возвращает true, если что-то поменялось и модель надо пересобрать.
function reflowManualDrawers() {
  if (!currentModel) return false;
  let changed = false;
  state.modules.forEach((m, mi) => {
    const mm = currentModel.modules[mi];
    const info = mm && mm.dims && mm.dims.sections;
    if (!info) return;
    m.sections.forEach((sec, si) => {
      if (sec.drawerMode !== 'manual' || !sec.drawers) return;
      const avail = Number(info[si] && info[si].drawerAvail) || 0;
      if (avail <= 0) return;
      const cur = (sec.drawerHeights || []).slice(0, sec.drawers).map(Number);
      if (cur.length !== sec.drawers || cur.some((v) => !Number.isFinite(v) || v <= 0)) return;
      if (Math.abs(cur.reduce((a, b) => a + b, 0) - avail) < 0.5) return;

      const fixed = [];
      const pin = sec.drawerPinned || [];
      for (let d = 0; d < sec.drawers; d++) if (pin[d]) fixed.push(d);
      if (fixed.length >= sec.drawers) return;      // всё задано вручную — не трогаем

      const next = fitDrawerHeights(cur, fixed, avail);
      if (next.some((v, i) => Math.abs(v - cur[i]) > 0.05)) {
        sec.drawerHeights = next;
        changed = true;
      }
    });
  });
  return changed;
}

// Список фасадов, реально применённых к секции: обычно один (sec.facade),
// но при нескольких вертикальных зонах (doorZoneCount > 1, пенал под
// встроенную технику) — по одному на каждую зону. Условные блоки
// (материал/ручки/подъёмник) должны учитывать ВСЕ зоны, а не только
// «общий» sec.facade, который в этом режиме не используется.
function secEffectiveFacades(sec) {
  const n = Number(sec.doorZoneCount) || 1;
  return (n > 1 && Array.isArray(sec.doorZones) && sec.doorZones.length)
    ? sec.doorZones.slice(0, n).map((z) => (z && z.facade) || 'open')
    : [sec.facade];
}

// Разметка ОДНОЙ карточки зоны фасада (техника/фасад/высота/габариты/
// заметка) — чистая функция рендера без побочных эффектов и завязки на
// замыкание конкретного места вызова. Используется в компактном контекстном
// редакторе одной зоны, открываемом кликом по фасаду в 3D
// (doorZoneEditorScreen, карточка только КОНКРЕТНОЙ зоны) — это единственный
// способ настроить зоны многозонного фасада, поэтому сайдбар для такой
// секции ограничивается подсказкой (см. renderSectionsList).
// `i` — индекс секции в mod.sections (для data-idx у полей), `zi` — индекс
// зоны в sec.doorZones, `doorZoneCount` — общее число зон секции (для
// заголовка «Нижняя/Верхняя/Зона N»).
function zoneCardHtml(sec, i, zi, doorZoneCount) {
  const zone = sec.doorZones[zi] || {};
  const isBottom = zi === 0;
  const isTop = zi === doorZoneCount - 1;
  const title = isBottom ? 'Нижняя зона' : (isTop ? 'Верхняя зона' : `Зона ${zi + 1}`);
  const appliance = zone.appliance || 'none';
  // Духовка/СВЧ показывают свою лицевую панель — фасада корпуса в
  // этой зоне нет вообще, выбор «Фасад» тут ни на что не влияет
  // (см. applianceNicheOnly в engine.js), поэтому прячем его в UI.
  const nicheOnly = appliance === 'oven' || appliance === 'microwave';
  const zoneShelves = Number(zone.shelves) || 0;
  // Полки внутри зоны со встроенной техникой неуместны — там либо ниша под
  // прибор, либо фасад скрывает прибор (appliance !== 'none' в обоих
  // случаях), поэтому блок «Полки» показываем только для обычной зоны.
  const zoneShelfDetail = zoneShelves > 0 ? `
    <div class="sub">
      <label>Полки</label>
      <select data-zoneshelfmode="${zi}" data-idx="${i}">
        <option value="auto" ${zone.shelfMode !== 'manual' ? 'selected' : ''}>Распределить равномерно</option>
        <option value="manual" ${zone.shelfMode === 'manual' ? 'selected' : ''}>Задать высоту вручную</option>
      </select>
      ${zone.shelfMode === 'manual' ? `
        <label class="mt6">Высота каждой полки от низа зоны, мм</label>
        <div class="mini-row">
          ${Array.from({ length: zoneShelves }, (_, s) =>
            `<input type="number" step="10" min="0" value="${(zone.shelfHeights && zone.shelfHeights[s]) || (300 * (s + 1))}"
                    data-zoneshelfheight="${zi}" data-idx="${i}" data-zshelf="${s}" title="Полка ${s + 1}">`
          ).join('')}
        </div>` : ''}
    </div>` : '';
  return `
  <div class="sub">
    <label><strong>${esc(title)}</strong></label>
    <label class="mt6">Встраиваемая техника</label>
    <select data-zoneappliance="${zi}" data-idx="${i}">
      <option value="none" ${appliance === 'none' ? 'selected' : ''}>Нет (обычный фасад)</option>
      <option value="oven" ${appliance === 'oven' ? 'selected' : ''}>Духовой шкаф</option>
      <option value="microwave" ${appliance === 'microwave' ? 'selected' : ''}>СВЧ</option>
      <option value="fridge" ${appliance === 'fridge' ? 'selected' : ''}>Холодильник</option>
      <option value="washer" ${appliance === 'washer' ? 'selected' : ''}>Стиральная машина</option>
      <option value="dishwasher" ${appliance === 'dishwasher' ? 'selected' : ''}>Посудомоечная машина</option>
    </select>
    ${!nicheOnly ? `
    <label class="mt6">Фасад</label>
    <select data-zonefacade="${zi}" data-idx="${i}">
      <option value="doorLeft" ${(zone.facade === 'doorLeft' || zone.facade === 'doors1') ? 'selected' : ''}>Дверь левая</option>
      <option value="doorRight" ${zone.facade === 'doorRight' ? 'selected' : ''}>Дверь правая</option>
      <option value="doors2" ${zone.facade === 'doors2' ? 'selected' : ''}>Две двери</option>
      <option value="liftUp" ${zone.facade === 'liftUp' ? 'selected' : ''}>Открывание вверх</option>
      <option value="blindFacade" ${zone.facade === 'blindFacade' ? 'selected' : ''}>Заглушка</option>
      <option value="open" ${zone.facade === 'open' ? 'selected' : ''}>Без дверей</option>
    </select>` : '<div class="hint">Ниша без фасада — техника показывает свою лицевую панель.</div>'}
    <label class="mt6">Высота зоны (ниши), мм</label>
    <div class="mini-row"><input type="number" min="0" step="10" value="${zone.height || ''}" placeholder="авто (остаток)" data-zoneheight="${zi}" data-idx="${i}"></div>
    ${appliance === 'none' ? `
    <label class="mt6">Полки, шт</label>
    <div class="mini-row"><input type="number" min="0" max="12" value="${zoneShelves}" data-zoneshelves="${zi}" data-idx="${i}"></div>
    ${zoneShelfDetail}` : ''}
    ${appliance !== 'none' ? `
    <label class="mt6">Габариты техники, мм (для памяти — ниша считается по высоте зоны выше)</label>
    <div class="field-row">
      <div class="field"><label>Ширина</label><input type="number" min="0" step="10" value="${zone.applianceW || ''}" data-zoneappw="${zi}" data-idx="${i}"></div>
      <div class="field"><label>Глубина</label><input type="number" min="0" step="10" value="${zone.applianceD || ''}" data-zoneappd="${zi}" data-idx="${i}"></div>
    </div>` : ''}
    <label class="mt6">Заметка</label>
    <div class="mini-row"><input type="text" value="${esc(zone.note || '')}" placeholder="например: модель по паспорту техники" data-zonenote="${zi}" data-idx="${i}"></div>
  </div>`;
}

// Число вертикальных зон фасада (пенал под встроенную технику): клампит
// 1..4 и подгоняет длину sec.doorZones под новое количество, не теряя уже
// настроенные зоны (уменьшение НЕ усекает массив — «лишние» элементы просто
// не используются, пока doorZoneCount не увеличат обратно; engine.js и
// zoneCardHtml читают только первые doorZoneCount элементов).
// Вызывается кнопкой «Разделить на секции по вертикали» в контекстном меню
// фасада в 3D (единственный способ задать это число, см. viewer.onSelectPart).
function setDoorZoneCount(sec, value) {
  const n = Math.max(1, Math.min(4, Math.round(Number(value)) || 1));
  sec.doorZoneCount = n;
  if (n > 1 && (!Array.isArray(sec.doorZones) || !sec.doorZones.length)) {
    sec.doorZones = [{ facade: sec.facade || 'doorLeft', height: 0, appliance: 'none', applianceW: 0, applianceD: 0, note: '' }];
  }
  if (Array.isArray(sec.doorZones)) {
    while (sec.doorZones.length < n) {
      sec.doorZones.push({ facade: 'doorLeft', height: 0, appliance: 'none', applianceW: 0, applianceD: 0, note: '' });
    }
  }
  return n;
}

// Высота НИЖНЕЙ зоны фасада секции, как она реально построится в engine.js
// (учитывает уже заданные в sec.doorZones явные высоты — а не наивное
// равное деление, если, например, нижняя зона уже подогнана под соседа,
// см. findNeighborBottomZoneHeight). null — не удалось посчитать (нет ещё
// посчитанной модели, или у секции есть ящики — тогда бюджет зоны сдвинут
// на drawerZoneH, которую здесь сознательно не учитываем, см. тот же guard
// в placeShelvesAtZoneBoundaries ниже).
function sectionBottomZoneHeight(mod, sectionIndex) {
  const sec = mod.sections[sectionIndex];
  if (!sec) return null;
  const mi = state.modules.indexOf(mod);
  const dims = currentModel && currentModel.modules[mi] && currentModel.modules[mi].dims;
  if (!dims) return null;
  const secDims = dims.sections && dims.sections[sectionIndex];
  if (secDims && Array.isArray(secDims.drawerHeights) && secDims.drawerHeights.length) return null;
  const { layoutDoorZones } = window.Modul3D.engine;
  const n = Number(sec.doorZoneCount) || 1;
  const zones = (n > 1 && Array.isArray(sec.doorZones) && sec.doorZones.length)
    ? sec.doorZones.slice(0, n).map((z) => ({ height: (z && Number(z.height)) || 0 }))
    : [{ height: 0 }];
  const layout = layoutDoorZones(zones, dims.H - dims.baseH, dims.gap, null, '');
  return Math.round(layout.heights[0]) || null;
}

// Высота нижней зоны СОСЕДНЕЙ секции — чтобы при разбиении на несколько
// зон нижний фасад лёг вровень с фасадом соседа по верхней кромке (единая
// горизонтальная линия по ряду, как в реальной кухне — стандартный приём
// дизайна). Порядок поиска: сначала соседняя секция ТОГО ЖЕ модуля (общий
// корпус — H/baseH гарантированно совпадают, самый надёжный случай), потом
// сосед по ряду через границу модуля (`state.modules` — «набор модулей,
// стоящих в ряд слева направо», см. комментарий в engine.js buildModel).
// v1: сосед по ряду учитывается только если ни он, ни текущий модуль не
// повёрнуты (rotation) и между ними нет углового стыка (corner) — при
// развороте фасад соседа физически смотрит в другую сторону, совпадение
// по высоте не имеет дизайнерского смысла. Возвращает null, если ни один
// сосед не найден/не посчитан — тогда зона просто остаётся авто (как раньше).
function findNeighborBottomZoneHeight(mod, sectionIndex) {
  if (sectionIndex > 0) {
    const h = sectionBottomZoneHeight(mod, sectionIndex - 1);
    if (h) return h;
  }
  if (sectionIndex < mod.sections.length - 1) {
    const h = sectionBottomZoneHeight(mod, sectionIndex + 1);
    if (h) return h;
  }
  // Дальше — только для крайних секций модуля (у средней секции соседей
  // за пределами своего же модуля физически нет).
  if (sectionIndex !== 0 && sectionIndex !== mod.sections.length - 1) return null;
  const mi = state.modules.indexOf(mod);
  if (mi < 0) return null;
  const rotated = (m) => !!(m && m.rotation);
  if (sectionIndex === 0 && mi > 0 && !state.modules[mi - 1].corner
      && !rotated(mod) && !rotated(state.modules[mi - 1])) {
    const leftMod = state.modules[mi - 1];
    const h = sectionBottomZoneHeight(leftMod, leftMod.sections.length - 1);
    if (h) return h;
  }
  if (sectionIndex === mod.sections.length - 1 && !mod.corner && mi < state.modules.length - 1
      && !rotated(mod) && !rotated(state.modules[mi + 1])) {
    const rightMod = state.modules[mi + 1];
    const h = sectionBottomZoneHeight(rightMod, 0);
    if (h) return h;
  }
  return null;
}

// После «Разделить на секции» из 3D (см. viewer.onSelectPart) — ставит
// полку РОВНО на каждый стык между соседними зонами, используя ТУ ЖЕ
// функцию раскладки (layoutDoorZones), что и реальные двери в engine.js —
// не дублирует формулу, только координаты пересчитывает в конвенцию
// sec.zoneBoundaryShelves (отсчёт от dims.innerBottomY, см. getShelfYs). Берёт
// РЕАЛЬНЫЕ высоты из sec.doorZones (в т.ч. нижнюю, если она подогнана под
// соседа, — не наивное равное деление); если пользователь потом задаст
// зонам явные высоты вручную — полки НЕ пересчитываются автоматически,
// только через повторный вызов этой же кнопки.
//
// Секции с ящиками — пропускаем: слот зон в engine.js начинается ВЫШЕ
// ящиков (slotBot = baseH + сумма drawerHeights), а не прямо с baseH;
// сумма высот ящиков уже посчитана в dims.sections[i].drawerHeights, но
// в v1 сознательно не подключаем этот случай — TODO: прибавить
// sum(drawerHeights) к slotBot ниже, когда понадобится снять ограничение.
function placeShelvesAtZoneBoundaries(mod, sectionIndex) {
  const sec = mod.sections[sectionIndex];
  if (!sec) return;
  const n = Number(sec.doorZoneCount) || 1;
  if (n < 2) return;
  const mi = state.modules.indexOf(mod);
  const dims = currentModel && currentModel.modules[mi] && currentModel.modules[mi].dims;
  if (!dims) return;
  const secDims = dims.sections && dims.sections[sectionIndex];
  if (secDims && Array.isArray(secDims.drawerHeights) && secDims.drawerHeights.length) return;
  const { layoutDoorZones } = window.Modul3D.engine;
  const zones = Array.isArray(sec.doorZones)
    ? sec.doorZones.slice(0, n).map((z) => ({ height: (z && Number(z.height)) || 0 }))
    : Array.from({ length: n }, () => ({ height: 0 }));
  const slotBot = dims.baseH;
  const layout = layoutDoorZones(zones, dims.H - slotBot, dims.gap, null, '');
  const heights = [];
  for (let k = 1; k < n; k++) {
    const boundaryY = slotBot + layout.bottoms[k] - dims.gap;
    // sec.shelfHeights хранит высоту НИЖНЕЙ ГРАНИ полки от дна секции —
    // engine.js (getShelfYs) сам прибавляет t/2, чтобы получить центр
    // (см. комментарий у getShelfYs: «в ручном режиме shelfHeights задаёт
    // высоту нижней плоскости... прибавляем половину толщины детали»).
    // boundaryY выше — это уже АБСОЛЮТНЫЙ Y центра стыка между фасадами;
    // если положить его в shelfHeights как есть, getShelfYs прибавит t/2
    // ЕЩЁ РАЗ поверх — полка встанет на t/2 выше нужного. Поэтому здесь
    // заранее вычитаем t/2, переводя «центр» в «низ», как и ждёт функция.
    const bottomFaceY = boundaryY - dims.t / 2;
    heights.push(Math.round(bottomFaceY - dims.innerBottomY));
  }
  // Полки на стыках зон держат корпус пенала (боковины на всю высоту — это
  // единственные жёсткие связи между секциями фасада) — несъёмные, на
  // минификсах Rastex, во всю глубину корпуса. Отдельное поле от
  // sec.shelves/shelfHeights: те теперь принадлежат съёмным полкам ВНУТРИ
  // конкретной зоны (sec.doorZones[zi].shelves, см. engine.js buildModuleParts)
  // и не должны стираться при каждом «Разделить на секции».
  sec.zoneBoundaryShelves = heights;
}

// Мост для ui-shell.js (HUD в 3D, см. renderHud/initHud): состояние модуля,
// нужное HUD и для подсветки текущего поворота, и для решения — показывать
// ли кнопку «Разделить на секции по высоте» (по явному решению — только
// когда в модуле ровно одна секция, иначе неоднозначно какую делить, и
// пользователь идёт через Focus Mode как раньше). Применимость самой кнопки
// проверяем ТОЙ ЖЕ логикой, что определяет её в showFocusMenu выше (клик по
// фасаду — kind === 'door', см. viewer.onSelectPart) — только не по клику
// на конкретную деталь, а по уже построенной модели (currentModel.partsRaw,
// см. overridablePartCandidates выше — тот же источник для 3D→деталь).
function getModuleHudState(moduleName) {
  const mod = state.modules.find((m) => m.name === moduleName);
  if (!mod) return null;
  const rotation = Number(mod.rotation) || 0;
  const singleSection = Array.isArray(mod.sections) && mod.sections.length === 1;
  const sec = singleSection ? mod.sections[0] : null;
  const doorZoneCount = sec ? (Number(sec.doorZoneCount) || 1) : 1;
  const rows = (currentModel && currentModel.partsRaw) || [];
  const canSplitByHeight = !!(singleSection && rows.some(
    (r) => r.module === moduleName && r.kind === 'door' && r.sectionIndex === 0
  ));
  return { rotation, canSplitByHeight, doorZoneCount };
}

// Мост для ui-shell.js: «Разделить на секции по высоте» из HUD в 3D — та же
// логика, что применяет числовой пункт «Разделить на секции по вертикали» в
// showFocusMenu выше (setDoorZoneCount + подгонка высоты нижней зоны под
// соседа + расстановка полок на стыках), но без обязательного клика по
// конкретному фасаду в Focus Mode: секция здесь однозначна — единственная,
// sectionIndex 0 (см. getModuleHudState — кнопка в HUD видна только тогда).
function setModuleDoorZoneCount(moduleName, n) {
  const mod = state.modules.find((m) => m.name === moduleName);
  if (!mod || !Array.isArray(mod.sections) || mod.sections.length !== 1) return;
  const sec = mod.sections[0];
  const applied = setDoorZoneCount(sec, n);
  if (applied >= 2) {
    // Нижняя зона по умолчанию — вровень с фасадом соседа (единая
    // горизонтальная линия по ряду), если высота ещё не задана вручную;
    // уже настроенную высоту не трогаем.
    if (!sec.doorZones[0].height) {
      const neighborH = findNeighborBottomZoneHeight(mod, 0);
      if (neighborH) sec.doorZones[0].height = neighborH;
    }
    placeShelvesAtZoneBoundaries(mod, 0);
  }
  renderParamsPanel();
  recompute();
}

// Довязка «задним числом»: когда рядом со СВЕЖЕВСТАВЛЕННЫМ модулем (индекс
// `at` в state.modules ПОСЛЕ вставки) уже стоит пенал с разбивкой на зоны,
// у которого нижняя зона осталась «авто» (высота не задана — соседа не было
// в момент разбиения), — досчитываем её сейчас, когда сосед уже появился.
// Проверяем только двух непосредственных соседей нового модуля: у левого —
// последнюю секцию, у правого — первую (это единственные секции, для
// которых новый модуль вообще может быть соседом по findNeighborBottomZoneHeight).
function resyncZoneHeightsForNewNeighbor(at) {
  let changed = false;
  // Array.isArray(...sections) - защита от аномальных данных (повреждённый
  // файл проекта без sections у модуля): без неё .sections.length упал бы
  // с исключением ещё до основной проверки ниже.
  const left = state.modules[at - 1];
  const right = state.modules[at + 1];
  const candidates = [
    left && Array.isArray(left.sections) && left.sections.length
      && [left, left.sections.length - 1],
    right && Array.isArray(right.sections) && right.sections.length && [right, 0],
  ];
  for (const cand of candidates) {
    if (!cand) continue;
    const [mod, sectionIndex] = cand;
    const sec = mod.sections && mod.sections[sectionIndex];
    if (!sec || !(Number(sec.doorZoneCount) > 1)) continue;
    if (!Array.isArray(sec.doorZones) || !sec.doorZones[0]) continue;
    if (sec.doorZones[0].height) continue; // уже подогнана или задана вручную — не трогаем
    const h = findNeighborBottomZoneHeight(mod, sectionIndex);
    if (!h) continue;
    sec.doorZones[0].height = h;
    placeShelvesAtZoneBoundaries(mod, sectionIndex);
    changed = true;
  }
  return changed;
}

// Обработчики полей карточки(-ек) зоны фасада — делегированы на `container`
// (а не жёстко на #sectionsList), чтобы одинаково работать и в общем списке
// секций сайдбара, и в компактном контекстном редакторе одной зоны
// (doorZoneEditorScreen). `mod` — текущий модуль (карточки внутри container
// всегда только из его секций). `refresh` — что вызвать, когда правка меняет
// СОСТАВ видимых полей (например появление/исчезновение select «Фасад» при
// выборе духовки/СВЧ) — у сайдбара это лёгкий renderSectionsList() (весь
// #sectionsList), у контекстного редактора — renderParamsPanel() (там нет
// более точечной функции перерисовки одной карточки). По умолчанию —
// renderSectionsList, чтобы вызов без 3-го аргумента не менял поведение
// существующего сайдбара.
function bindZoneFieldEvents(container, mod, refresh) {
  const refreshScreen = refresh || renderSectionsList;
  function ensureZone(sec, zi) {
    sec.doorZones = sec.doorZones || [];
    if (!sec.doorZones[zi]) {
      sec.doorZones[zi] = { facade: 'doorLeft', height: 0, appliance: 'none', applianceW: 0, applianceD: 0, note: '' };
    }
    return sec.doorZones[zi];
  }
  container.querySelectorAll('[data-zonefacade]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const sec = mod.sections[Number(e.target.dataset.idx)];
      const zi = Number(e.target.dataset.zonefacade);
      ensureZone(sec, zi).facade = e.target.value;
      refreshScreen();
      recompute();
    });
  });
  container.querySelectorAll('[data-zoneheight]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const sec = mod.sections[Number(e.target.dataset.idx)];
      const zi = Number(e.target.dataset.zoneheight);
      ensureZone(sec, zi).height = Number(e.target.value) || 0;
      recompute();
    });
  });
  container.querySelectorAll('[data-zoneappliance]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const sec = mod.sections[Number(e.target.dataset.idx)];
      const zi = Number(e.target.dataset.zoneappliance);
      ensureZone(sec, zi).appliance = e.target.value;
      // Меняет видимость select «Фасад» (ниша под духовку/СВЧ его прячет)
      // и полей габаритов техники — нужна перерисовка карточек.
      refreshScreen();
      recompute();
    });
  });
  container.querySelectorAll('[data-zoneappw]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const sec = mod.sections[Number(e.target.dataset.idx)];
      const zi = Number(e.target.dataset.zoneappw);
      ensureZone(sec, zi).applianceW = Number(e.target.value) || 0;
      recompute();
    });
  });
  container.querySelectorAll('[data-zoneappd]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const sec = mod.sections[Number(e.target.dataset.idx)];
      const zi = Number(e.target.dataset.zoneappd);
      ensureZone(sec, zi).applianceD = Number(e.target.value) || 0;
      recompute();
    });
  });
  container.querySelectorAll('[data-zonenote]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const sec = mod.sections[Number(e.target.dataset.idx)];
      const zi = Number(e.target.dataset.zonenote);
      ensureZone(sec, zi).note = e.target.value;
      recompute();
    });
  });
  container.querySelectorAll('[data-zoneshelves]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const sec = mod.sections[Number(e.target.dataset.idx)];
      const zi = Number(e.target.dataset.zoneshelves);
      const zone = ensureZone(sec, zi);
      zone.shelves = Number(e.target.value);
      // Сброс на авторежим при смене количества — та же логика, что и у
      // sec.shelves (bindShelfFieldEvents): новая полка честно делит высоту
      // зоны поровну, а не наследует случайные ручные значения.
      zone.shelfMode = 'auto';
      zone.shelfHeights = [];
      refreshScreen();
      recompute();
    });
  });
  container.querySelectorAll('[data-zoneshelfmode]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const sec = mod.sections[Number(e.target.dataset.idx)];
      const zi = Number(e.target.dataset.zoneshelfmode);
      ensureZone(sec, zi).shelfMode = e.target.value;
      refreshScreen();
      recompute();
    });
  });
  container.querySelectorAll('[data-zoneshelfheight]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const sec = mod.sections[Number(e.target.dataset.idx)];
      const zi = Number(e.target.dataset.zoneshelfheight);
      const zone = ensureZone(sec, zi);
      zone.shelfHeights = zone.shelfHeights || [];
      zone.shelfHeights[Number(e.target.dataset.zshelf)] = Number(e.target.value);
      recompute();
    });
  });
}

// Блок «Полки» (режим авто/вручную + высоты) — полки принадлежат секции
// целиком (sec.shelves/shelfMode/shelfHeights), а не отдельной зоне фасада,
// поэтому один и тот же блок используется и в карточке секции сайдбара
// (renderSectionsList), и в компактном контекстном редакторе фасада
// (doorZoneEditorScreen), независимо от doorZoneCount/zoneIndex.
function shelfDetailBlock(sec, i) {
  return sec.shelves > 0 ? `
    <div class="sub">
      <label>Полки</label>
      <select data-field="shelfMode" data-idx="${i}">
        <option value="auto" ${sec.shelfMode !== 'manual' ? 'selected' : ''}>Распределить равномерно</option>
        <option value="manual" ${sec.shelfMode === 'manual' ? 'selected' : ''}>Задать высоту вручную</option>
      </select>
      ${sec.shelfMode === 'manual' ? `
        <label class="mt6">Высота каждой полки от дна, мм</label>
        <div class="mini-row">
          ${Array.from({ length: sec.shelves }, (_, s) =>
            `<input type="number" step="10" min="0" value="${(sec.shelfHeights && sec.shelfHeights[s]) || (300 * (s + 1))}"
                    data-shelf="${s}" data-idx="${i}" title="Полка ${s + 1}">`
          ).join('')}
        </div>` : ''}
    </div>` : '';
}

// Обработчики поля «Полки, шт» и shelfDetailBlock() — делегированы на
// `container`, тот же паттерн переиспользования между сайдбаром
// (renderSectionsList → #sectionsList, через общий делегат [data-field]
// ниже) и компактным контекстным редактором (doorZoneEditorScreen →
// #doorZoneEditorRoot), что и у bindZoneFieldEvents выше.
function bindShelfFieldEvents(container, mod, refresh) {
  const refreshScreen = refresh || renderSectionsList;
  container.querySelectorAll('[data-field="shelves"]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const sec = mod.sections[Number(e.target.dataset.idx)];
      sec.shelves = Number(e.target.value);
      // Сброс на авторежим при смене количества — см. комментарий у того же
      // поля в общем делегате [data-field] сайдбара (renderSectionsList).
      sec.shelfMode = 'auto';
      sec.shelfHeights = [];
      refreshScreen();
      recompute();
    });
  });
  container.querySelectorAll('[data-field="shelfMode"]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const sec = mod.sections[Number(e.target.dataset.idx)];
      sec.shelfMode = e.target.value;
      refreshScreen();
      recompute();
    });
  });
  container.querySelectorAll('[data-shelf]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const sec = mod.sections[Number(e.target.dataset.idx)];
      sec.shelfHeights = sec.shelfHeights || [];
      sec.shelfHeights[Number(e.target.dataset.shelf)] = Number(e.target.value);
      recompute();
    });
  });
}

function renderSectionsList() {
  const mod = state.modules[state.activeModule];
  const list = document.getElementById('sectionsList');
  if (!mod || !list) return;      // пустой проект — секций нет

  list.innerHTML = mod.sections.map((sec, i) => {
    const ftId = sec.facadeType || 'ldsp';
    const ftInfo = FACADE_TYPES[ftId] || FACADE_TYPES.ldsp;
    const glassBlock = (secEffectiveFacades(sec).every((f) => f === 'open') && !sec.drawers) ? '' : `
      <div class="sub">
        <label>Материал фасада</label>
        <select data-field="facadeType" data-idx="${i}">
          ${FACADE_TYPE_ORDER.map((id) => `<option value="${id}" ${ftId === id ? 'selected' : ''}>${esc(FACADE_TYPES[id].name)}</option>`).join('')}
        </select>
        <div class="hint">${ftInfo.thickness} мм${ftInfo.glassInside ? ' · полки в секции — стекло 6 мм на держателях с силиконовой пяткой' : ''}</div>
      </div>`;

    const handleBlock = secEffectiveFacades(sec).every((f) => f === 'open') && !sec.drawers ? '' : `
      <div class="sub">
        <label>Ручки</label>
        <select data-field="handle" data-idx="${i}">
          ${HANDLE_ORDER.map((id) => `<option value="${id}" ${sec.handle === id ? 'selected' : ''}>${esc(HANDLES[id].name)}</option>`).join('')}
        </select>
        ${(HANDLES[sec.handle] || {}).holes === 2 && secEffectiveFacades(sec).some((f) => f !== 'open') ? `
        <label class="mt6">Скоба на двери</label>
        <select data-field="handleOrient" data-idx="${i}">
          <option value="vertical" ${sec.handleOrient !== 'horizontal' ? 'selected' : ''}>вертикально</option>
          <option value="horizontal" ${sec.handleOrient === 'horizontal' ? 'selected' : ''}>горизонтально</option>
        </select>` : ''}
        ${sec.handle === 'custom' ? `
        <label class="mt6">Межосевое расстояние, мм</label>
        <div class="mini-row"><input type="number" step="1" min="32" max="1200" value="${sec.handleCC || 160}" data-field="handleCC" data-idx="${i}"></div>` : ''}
        <div class="hint">Отверстия Ø5 насквозь. На фасаде шире 900 мм ставятся две ручки.</div>
      </div>`;

    const liftBlock = secEffectiveFacades(sec).some((f) => f === 'liftUp') ? `
      <div class="sub">
        <label>Подъёмный механизм</label>
        <select data-field="lift" data-idx="${i}">
          ${LIFT_ORDER.map((id) => `<option value="${id}" ${sec.lift === id ? 'selected' : ''}>${esc(LIFTS[id].name)}</option>`).join('')}
        </select>
        <div class="hint">${esc((LIFTS[sec.lift] || LIFTS.aventosHK).note)} · фасад ${(LIFTS[sec.lift] || LIFTS.aventosHK).minH}–${(LIFTS[sec.lift] || LIFTS.aventosHK).maxH} мм</div>
      </div>` : '';

    const facadeWidthBlock = sec.facade === 'open' ? '' : `
      <div class="sub">
        <label>Ширина фасада, мм <span class="dim">(0 — во всю секцию)</span></label>
        <div class="mini-row"><input type="number" step="10" min="0" value="${sec.facadeWidth || 0}" data-field="facadeWidth" data-idx="${i}"></div>
      </div>`;

    // Штанга для одежды в кухонном модуле не бывает — блок не показываем.
    const rodBlock = mod.family === 'kitchen' ? '' : `
      <div class="sub">
        <label class="checkbox-inline"><input type="checkbox" data-field="rod" data-idx="${i}" ${sec.rod ? 'checked' : ''}> Штанга для одежды</label>
        ${sec.rod ? `<label class="mt6">Высота штанги от дна секции, мм</label>
        <div class="mini-row"><input type="number" step="10" min="300" value="${sec.rodHeight || 1900}" data-field="rodHeight" data-idx="${i}"></div>` : ''}
      </div>`;

    // Вертикальные зоны фасада (пенал под встроенную технику): деление на
    // зоны и карточка каждой зоны живут только в 3D-фокусе (клик по фасаду →
    // doorZoneEditorScreen/zoneCardHtml), здесь для многозонной секции —
    // просто ссылка на этот способ, без общего select «Фасад».
    const doorZoneCount = Number(sec.doorZoneCount) || 1;
    // Многозонная секция — полки настраиваются по зонам в zoneCardHtml
    // (доступно кликом по фасаду в 3D, см. doorZoneEditorScreen); engine.js
    // игнорирует sec.shelves при multiZone, плоский блок на всю секцию для
    // неё смысла не имеет.
    const shelfBlock = doorZoneCount <= 1 ? shelfDetailBlock(sec, i) : '';

    return `
      <div class="section-card">
        <div class="section-card-title">
          <span>${esc(mod.name)} · Секция ${i + 1}</span>
          ${mod.sections.length > 1 ? `<button class="remove-section" data-remove="${i}" type="button">убрать</button>` : ''}
        </div>
        <div class="field-row">
          ${doorZoneCount <= 1 ? `<div class="field"><label>Полки, шт</label><input type="number" min="0" max="12" value="${sec.shelves}" data-field="shelves" data-idx="${i}"></div>` : ''}
          <div class="field"><label>Ящики, шт</label><input type="number" min="0" max="8" value="${sec.drawers}" data-field="drawers" data-idx="${i}"></div>
        </div>
        ${sec.drawers > 0 ? `<button class="btn materials-link-btn" data-drawers-open="${i}" type="button">Редактировать ящики <span class="arrow">→</span></button>` : ''}
        <div class="field">
          <label>Ширина проёма секции</label>
          <select data-field="widthMode" data-idx="${i}">
            <option value="auto" ${sec.widthMode !== 'fixed' ? 'selected' : ''}>авто (делить поровну)</option>
            <option value="fixed" ${sec.widthMode === 'fixed' ? 'selected' : ''}>задать в мм</option>
          </select>
          ${sec.widthMode === 'fixed'
            ? `<div class="mini-row mt6"><input type="number" step="10" min="50" value="${sec.width || 400}" data-field="width" data-idx="${i}"></div>`
            : ''}
        </div>
        ${doorZoneCount <= 1 ? `
        <div class="field">
          <label>Фасад</label>
          <select data-field="facade" data-idx="${i}">
            <option value="doorLeft" ${(sec.facade === 'doorLeft' || sec.facade === 'doors1') ? 'selected' : ''}>Дверь левая</option>
            <option value="doorRight" ${sec.facade === 'doorRight' ? 'selected' : ''}>Дверь правая</option>
            <option value="doors2" ${sec.facade === 'doors2' ? 'selected' : ''}>Две двери</option>
          <option value="liftUp" ${sec.facade === 'liftUp' ? 'selected' : ''}>Открывание вверх</option>
            <option value="blindFacade" ${sec.facade === 'blindFacade' ? 'selected' : ''}>Заглушка</option>
            <option value="open" ${sec.facade === 'open' ? 'selected' : ''}>Без дверей</option>
          </select>
        </div>` : `
        <div class="field">
          <div class="hint">Секция разделена на зоны по высоте. Деление и настройка зон (фасад, встраиваемая техника, полки) — кликом по фасаду в 3D в режиме фокуса: двойной клик по модулю → клик по фасаду → «Разделить на секции по вертикали» / «Редактировать секцию».</div>
        </div>`}
        ${facadeWidthBlock}
        ${glassBlock}
        ${handleBlock}
        ${liftBlock}
        ${shelfBlock}
        ${rodBlock}
      </div>`;
  }).join('');

  // поля секции
  list.querySelectorAll('[data-field]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const sec = mod.sections[Number(e.target.dataset.idx)];
      const f = e.target.dataset.field;
      sec[f] = (f === 'facade' || f === 'shelfMode'
                || f === 'widthMode'
                || f === 'handle' || f === 'lift' || f === 'handleOrient'
                || f === 'facadeType')
        ? e.target.value
        : (e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value));
      // Смена количества ящиков снимает все фиксации высот фасадов (панель
      // «Ящики» этой секции переоткрывается с чистого автораспределения).
      if (f === 'drawers') {
        sec.drawerPinned = [];
        sec.drawerHeights = [];
      }
      // Смена числа полок сбрасывает ручные высоты и возвращает в авторежим —
      // иначе новая полка наследует чужие/устаревшие значения (см. историю
      // секции) вместо равного деления доступной высоты, как ожидает
      // пользователь (тот же принцип, что и сброс фиксаций у ящиков выше).
      if (f === 'shelves') {
        sec.shelfMode = 'auto';
        sec.shelfHeights = [];
      }
      // менялось количество/режим — перерисовываем блок, чтобы поля появились
      renderSectionsList();
      recompute();
    });
  });
  // высоты полок
  list.querySelectorAll('[data-shelf]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const sec = mod.sections[Number(e.target.dataset.idx)];
      sec.shelfHeights = sec.shelfHeights || [];
      sec.shelfHeights[Number(e.target.dataset.shelf)] = Number(e.target.value);
      recompute();
    });
  });
  // зоны фасада по высоте (пенал под встроенную технику) — сами обработчики
  // вынесены в bindZoneFieldEvents(), переиспользуется и здесь (карточки на
  // все зоны секции), и в компактном контекстном редакторе одной зоны
  // (doorZoneEditorScreen, открывается кликом по фасаду в 3D).
  bindZoneFieldEvents(list, mod);
  list.querySelectorAll('[data-remove]').forEach((el) => {
    el.addEventListener('click', (e) => {
      mod.sections.splice(Number(e.target.dataset.remove), 1);
      renderSectionsList();
      recompute();
    });
  });
  // «Редактировать ящики →» — открывает отдельную панель «Ящики» для этой
  // секции (см. openDrawersPanel/drawersPanelBlock). e.currentTarget, а не
  // e.target: клик может попасть на внутренний <span class="arrow">.
  list.querySelectorAll('[data-drawers-open]').forEach((el) => {
    el.addEventListener('click', (e) => {
      openDrawersPanel(Number(e.currentTarget.dataset.drawersOpen));
    });
  });
}

// Клик по миниатюре в сетке «База модулей» внутри панели: ДОБАВЛЯЕТ модуль в
// проект (не заменяет текущий) и делает его активным — он сразу виден в 3D.
// Логика перенесена без изменений из бывшего плавающего меню showPresetMenu().
function addPresetToProject(catId, presetId) {
  const group = PRESETS.filter((g) => g.id === catId)[0];
  const item = group && group.items.filter((i) => i.id === presetId)[0];
  if (!item) return;
  // Имя модулю даёт проект — «Модуль N», как у добавленных вручную.
  const m = item.make();
  m.name = '';
  // «Нижние» модули (включая пенал — он стоит на полу и опирается на цоколь
  // так же, как нижний ярус) держат единую глубину ряда: берём её у соседа,
  // а не у дефолта пресета. Левый сосед (после которого встанет модуль)
  // приоритетнее правого — как и в findNeighborBottomZoneHeight.
  if (item.tier === 'lower' && state.modules.length) {
    const left = state.modules[state.activeModule];
    const right = state.modules[state.activeModule + 1];
    const neighborDepth = (left && left.depth) || (right && right.depth);
    if (neighborDepth) m.depth = neighborDepth;
  }
  // Первый кухонный модуль задаёт материалы «как на производстве»:
  // корпус белый, фасад в декоре. Дальше пользователь меняет вручную.
  if (m.family === 'kitchen' && !state.modules.length) {
    const white = DECORS.filter((d) => /бел/i.test(d.name))[0];
    if (white) {
      // Декор, который стоял на корпусе, уезжает на ФАСАД, а корпус и
      // ящики становятся белыми. Если корпус уже белый — фасадный декор
      // не трогаем, иначе кухня получится целиком белой.
      if (state.decorCode !== white.code) state.facadeDecorCode = state.decorCode;
      state.decorCode = white.code;
      // Материал ящиков — поле секции (см. newSection()/drawersPanelBlock),
      // красим ящики нового кухонного модуля в тот же белый, что и корпус.
      (m.sections || []).forEach((sec) => { sec.drawerDecorCode = white.code; });
    }
  }
  insertModule(m);
}

// Повороты модуля вокруг вертикальной оси — общий список подписей для
// HUD-меню в 3D (клик по модулю, см. ui-shell.js: renderHud() берёт его
// через window.Modul3D.app.getRotations(), чтобы не дублировать список).
// Подписи соответствуют фактическому развороту деталей в модели
// (проверяется в tools/geometry.js): 90° уводит фасад ВПРАВО, 270° — ВЛЕВО.
// Запись [0, ...] здесь ТОЛЬКО для текста текущего состояния в HUD — сама
// кнопка поворота в HUD одна и работает инкрементально (см. rotateModuleStep
// ниже), отдельной кнопки на «без поворота» больше нет.
const ROTATIONS = [
  [0,   'без поворота — фасад вперёд'],
  [90,  'на 90° — фасад вправо'],
  [180, 'на 180° — фасад назад'],
  [270, 'на 270° — фасад влево'],
];

// Применяет поворот модуля — общая логика для HUD-меню в 3D (см.
// window.Modul3D.app.rotateModule/rotateModuleStep ниже).
function rotateModule(moduleName, deg) {
  const mod = state.modules.find((m) => m.name === moduleName);
  if (!mod) return;
  mod.rotation = Number(deg) || 0;
  renderParamsPanel();
  recompute();
}

// Поворот «на шаг» — одна кнопка в HUD (см. ui-shell.js) вместо трёх
// отдельных 90/180/270: каждый клик доворачивает ЕЩЁ на 90° по кругу
// (270° + 90° = 360° = 0°, то есть так же можно вернуться к «без поворота»,
// без отдельной кнопки на это значение — так попросил пользователь).
function rotateModuleStep(moduleName) {
  const mod = state.modules.find((m) => m.name === moduleName);
  if (!mod) return;
  const cur = Number(mod.rotation) || 0;
  rotateModule(moduleName, (cur + 90) % 360);
}

function closeModuleMenu() {
  const old = document.getElementById('moduleMenu');
  if (old && old.remove) old.remove();
}

// Контекстное меню модуля: только переименование. Поворот переехал в
// HUD-меню в 3D (клик по модулю, см. ui-shell.js/rotateModule выше),
// удаление — в иконку в шапке программы (delBtn, см. ниже).
// Вызывается правой кнопкой по вкладке модуля в левом верхнем углу панели.
function showModuleMenu(modIndex, x, y) {
  closeModuleMenu();
  const mod = state.modules[modIndex];
  if (!mod) return;

  const menu = document.createElement('div');
  menu.id = 'moduleMenu';
  menu.className = 'ctx-menu';
  menu.style.left = Math.round(x) + 'px';
  menu.style.top = Math.round(y) + 'px';
  menu.innerHTML = `<input class="ctx-title ctx-title-input" id="ctxModName" type="text" value="${esc(mod.name)}">`;
  document.body.appendChild(menu);

  // Переименование модуля прямо из контекстного меню (поле в заголовке).
  const nameInput = menu.querySelector('#ctxModName');
  if (nameInput) {
    // Клик/фокус в поле не должен закрывать меню — глобальный слушатель
    // ниже (см. document.addEventListener('click', closeModuleMenu))
    // закрывает меню по ЛЮБОМУ клику на странице без проверки цели.
    nameInput.addEventListener('click', (e) => e.stopPropagation());
    nameInput.addEventListener('mousedown', (e) => e.stopPropagation());
    const applyName = () => {
      mod.name = nameInput.value.trim() || 'Модуль';
      state.selected = mod.name;
      renderParamsPanel();
      recompute();
    };
    nameInput.addEventListener('change', applyName);
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        applyName();
        closeModuleMenu();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Контекстное меню фокуса (изоляция модуля, двойной клик в 3D)
// ---------------------------------------------------------------------------
// Пока модуль изолирован, клик внутри сцены (viewer.onSelectPart — по любой
// детали, viewer.onFocusMiss — мимо любой детали) больше не переключает
// панель напрямую и не снимает изоляцию сам по себе — вместо этого в точке
// клика открывается это меню, и ТОЛЬКО его пункт «Выйти из фокуса» снимает
// изоляцию (см. exitFocusMode ниже). Так пользователь не проваливается в
// режим просмотра случайно, но всегда может из него выйти явным действием.

// Слушатель «клик мимо меню — закрыть», навешивается заново на каждое
// открытие (см. showFocusMenu) и снимается при закрытии.
let focusMenuOutsideHandler = null;

function closeFocusMenu() {
  const old = document.getElementById('focusMenu');
  if (old && old.remove) old.remove();
  if (focusMenuOutsideHandler) {
    document.removeEventListener('click', focusMenuOutsideHandler);
    focusMenuOutsideHandler = null;
  }
}

// items: [{ label, action }] — action вызывается уже ПОСЛЕ закрытия меню.
// items — обычно {label, action}. Дополнительно поддерживает составной
// пункт {type:'numberInput', label, value, min, max, buttonLabel, onApply} —
// число + кнопка в одной строке (например «Разделить на секции по
// вертикали» у фасада), которая НЕ закрывает меню при вводе числа, только
// по нажатию своей кнопки — по образцу переименования модуля в
// showModuleMenu (поле в меню, stopPropagation на click/mousedown).
function showFocusMenu(x, y, items) {
  closeFocusMenu();
  const menu = document.createElement('div');
  menu.id = 'focusMenu';
  menu.className = 'ctx-menu';
  menu.innerHTML = items.map((it, i) => it.type === 'numberInput'
    ? `<div class="ctx-group">${esc(it.label)}</div>
       <div class="ctx-numrow" data-i="${i}">
         <input type="number" min="${it.min}" max="${it.max}" value="${it.value}">
         <button type="button" class="ctx-item">${esc(it.buttonLabel)}</button>
       </div>`
    : `<button type="button" class="ctx-item" data-i="${i}">${esc(it.label)}</button>`
  ).join('');
  document.body.appendChild(menu);

  // Позиционируем в точке клика (position: fixed из .ctx-menu), но клампим
  // к вьюпорту — клик по детали у самого края экрана не должен раскрывать
  // меню за пределы окна.
  const rect = menu.getBoundingClientRect();
  const left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4));
  const top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4));
  menu.style.left = Math.round(left) + 'px';
  menu.style.top = Math.round(top) + 'px';

  items.forEach((it, i) => {
    if (it.type === 'numberInput') {
      const row = menu.querySelector(`.ctx-numrow[data-i="${i}"]`);
      if (!row) return;
      const input = row.querySelector('input');
      const btn = row.querySelector('button');
      // Клик/фокус в поле не должен закрывать меню — глобальный слушатель
      // ниже (клик мимо .ctx-menu) закрывает по любому клику без разбора цели.
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('mousedown', (e) => e.stopPropagation());
      const apply = () => { closeFocusMenu(); it.onApply(Number(input.value)); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
      btn.addEventListener('click', apply);
      return;
    }
    const el = menu.querySelector(`[data-i="${i}"]`);
    if (el) el.addEventListener('click', () => { closeFocusMenu(); it.action(); });
  });

  // Клик мимо меню закрывает его без действия. Слушатель вешаем не сразу,
  // а следующим тиком: клик по 3D-сцене, который только что ОТКРЫЛ это меню,
  // сам всплывёт до document как нативное 'click'-событие сразу вслед за
  // pointerup — если слушатель уже будет висеть, он мгновенно закроет только
  // что открытое меню тем же кликом.
  setTimeout(() => {
    focusMenuOutsideHandler = (e) => {
      if (!menu.contains(e.target)) closeFocusMenu();
    };
    document.addEventListener('click', focusMenuOutsideHandler);
  }, 0);
}

// Единственный способ выйти из режима фокуса (см. комментарий выше) — вызов
// отсюда, из пункта меню «Выйти из фокуса». Последовательность вызовов та
// же, что раньше делал клик мимо модели (viewer.onSelectModule(null)) —
// полный сброс выделения, не только изоляции.
function exitFocusMode() {
  const changed = state.selected !== null || state.isolatedModule !== null || state.selectedPart !== null;
  state.selected = null;
  state.selectedPart = null;
  state.panelView = 'module';
  exitIsolation();
  renderParamsPanel();
  if (changed && viewer && currentModel) viewer.render(currentModel, viewOpts());
}

// База модулей внутри вкладки «Библиотека»: клик по кнопке категории
// открывает/закрывает под ней сетку миниатюр её пресетов, клик по миниатюре
// добавляет модуль в проект (renderLibraryPanel() зовёт это после каждой
// перерисовки вкладки «modules» — элементы .lib-cat/.lib-item каждый раз
// новые, слушатели нужно вешать заново).
function bindLibraryEvents() {
  document.querySelectorAll('.lib-cat').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const cat = b.dataset.cat;
      // Повторный клик по уже открытой категории — закрыть; клик по другой —
      // переключить; сетка одной категории видна за раз.
      state.libraryOpenCat = state.libraryOpenCat === cat ? null : cat;
      renderLibraryPanel();
    });
  });
  document.querySelectorAll('.lib-item').forEach((b) => {
    b.addEventListener('click', () => {
      addPresetToProject(state.libraryOpenCat, b.dataset.preset);
    });
  });
}

function bindPanelEvents() {
  const mod = state.modules[state.activeModule];
  const on = (id, ev, h) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, h); };
  // Якорь навигации (кнопка «Материалы») и ссылка «← Назад» — их элементы
  // отрисованы не на каждом экране, но привязка безопасна и для отсутствующих.
  on('materialsLinkBtn', 'click', () => setPanelView('materials'));
  on('panelBack', 'click', () => setPanelView('module'));
  // Экран «Деталь» → быстрый переход к полю, которое красит видимую боковину.
  on('partToFacadeDecor', 'click', () => setPanelView('materials'));
  // Экран «Деталь» → полноэкранный визуальный редактор вырезов (см.
  // openPartVisualEditor ниже) для той же самой детали, что показана в
  // partBlock() — resolveSelectedPart() внутри найдёт её той же логикой.
  on('openPartVisualEditorBtn', 'click', () => openPartVisualEditor());

  // Без модулей в панели есть только подсказка (emptyProjectBlock) и «+» на
  // вкладках модулей — остальные поля не отрисованы, обращаться к ним нельзя.
  if (!mod) {
    on('addModule', 'click', () => insertModule(newModule()));
    updateHistoryButtons();
    return;
  }

  // переключение модулей
  document.querySelectorAll('[data-mod]').forEach((b) => {
    b.addEventListener('click', () => {
      state.activeModule = Number(b.dataset.mod);
      state.selected = (state.modules[state.activeModule] || {}).name || null;
      state.panelView = 'module';
      // Обычный клик по вкладке модуля в панели — тот же случай, что и
      // обычный клик по модулю в 3D (viewer.onSelectModule): снимает
      // изоляцию, без стекирования.
      exitIsolation();
      renderParamsPanel();
      if (viewer && currentModel) viewer.render(currentModel, viewOpts());
    });
  });

  // Правая кнопка на вкладке модуля — меню переименования (поворот — в
  // HUD в 3D, удаление — иконкой в шапке программы, см. rotateModule/delBtn).
  document.querySelectorAll('.mod-tab').forEach((b) => {
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showModuleMenu(Number(b.dataset.mod), e.clientX || 0, e.clientY || 0);
    });
  });
  on('addModule', 'click', () => insertModule(newModule()));
  updateHistoryButtons();

  on('m-width', 'change', (e) => { mod.width = Number(e.target.value); recompute(); });
  on('m-height', 'change', (e) => { mod.height = Number(e.target.value); recompute(); });
  on('m-depth', 'change', (e) => { mod.depth = Number(e.target.value); recompute(); });
  on('m-leftSide', 'change', (e) => { mod.leftSide = e.target.value; recompute(); });
  on('m-rightSide', 'change', (e) => { mod.rightSide = e.target.value; recompute(); });
  on('m-baseType', 'change', (e) => {
    mod.baseType = e.target.value;
    // «Опоры с цоколем» держит цоколь клипсой только кухонная опора — у
    // металлической клипсы нет, цоколь ей не удержать. Поэтому при выборе
    // этого основания тип опоры принудительно кухонная.
    if (mod.baseType === 'legsPlinth') mod.legType = 'kitchen';
    renderParamsPanel();
    recompute();
  });
  on('m-legType', 'change', (e) => { mod.legType = e.target.value; recompute(); });
  on('m-baseHeight', 'change', (e) => {
    const v = Number(e.target.value);
    // Цокольная планка идёт непрерывной линией по всему помещению — если у
    // соседних модулей разная высота основания, на стыке образуется
    // физически невозможный уступ. Поэтому высоту синхронизируем сразу по
    // ВСЕМ модулям проекта (не только по текущему ряду/семейству — так
    // попросил пользователь), каждому пишем в то поле, что у него сейчас
    // активно по его собственному baseType, чтобы полная высота от пола до
    // низа корпуса совпала независимо от того, чем реализовано основание —
    // цоколем или опорами.
    state.modules.forEach((m) => {
      if (m.baseType === 'plinth') m.plinthHeight = v; else m.legHeight = v;
    });
    recompute();
  });

  on('p-decor', 'change', (e) => { state.decorCode = e.target.value; recompute(); });
  on('p-facadeDecor', 'change', (e) => { state.facadeDecorCode = e.target.value; recompute(); });
  on('p-worktop', 'change', (e) => { state.worktopDepth = Number(e.target.value) || 0; recompute(); });
  on('p-back', 'change', (e) => { state.backCode = e.target.value; recompute(); });
  on('p-bodyThickness', 'change', (e) => { state.bodyThickness = Number(e.target.value); recompute(); });
  on('p-facadeThickness', 'change', (e) => { state.facadeThickness = Number(e.target.value); recompute(); });
  on('p-backThickness', 'change', (e) => { state.backThickness = Number(e.target.value); recompute(); });
  on('p-joint', 'change', (e) => { state.jointType = e.target.value; recompute(); });

  on('addSection', 'click', () => {
    mod.sections.push(newSection());
    renderSectionsList();
    recompute();
  });

  // Экран «Деталь»: переключение конкретной детали, когда деталей одного
  // вида в модуле несколько (крыша из двух планок) — см. partBlock/
  // overridablePartCandidates. Смена выбора ничего не меняет в проекте,
  // только какая деталь сейчас редактируется — recompute() не нужен.
  on('partSubIndex', 'change', (e) => {
    if (state.selectedPart) state.selectedPart.subIndex = Number(e.target.value) || 0;
    renderParamsPanel();
  });

  // Экран «Деталь» → крыша из планок: переключатель «плашмя ⇄ на ребро».
  // Меняет геометрию всего верха модуля (обе планки), поэтому — recompute()
  // как для обычного параметра модуля, а не override отдельной детали.
  on('partTopOnEdgeToggle', 'click', () => {
    mod.topType = mod.topType === 'railsEdge' ? 'rails' : 'railsEdge';
    recompute();
    renderParamsPanel();
  });

  // Экран «Деталь»: ручные правки конкретной детали (толщина/материал/доп.
  // отверстия) — см. applyPartOverrides() в engine.js. Общий блок несёт ключ
  // override в data-key, вычисленный уже в partBlock() той же самой логикой,
  // что и в движке (overridablePartCandidates) — здесь его не пересчитываем,
  // чтобы не разойтись с движком.
  const ovPanel = document.getElementById('partOverridePanel');
  if (ovPanel) {
    const key = ovPanel.dataset.key;
    const ensureOverride = () => {
      mod.partOverrides = mod.partOverrides || {};
      mod.partOverrides[key] = mod.partOverrides[key] || {};
      return mod.partOverrides[key];
    };
    on('partThickness', 'change', (e) => {
      const v = Number(e.target.value);
      if (!(v > 0)) return;
      ensureOverride().thicknessOverride = v;
      recompute();
      renderParamsPanel();
    });
    on('partMaterial', 'change', (e) => {
      ensureOverride().materialOverride = e.target.value;
      recompute();
      renderParamsPanel();
    });
    on('addExtraHole', 'click', () => {
      const ov = ensureOverride();
      ov.extraHoles = ov.extraHoles || [];
      ov.extraHoles.push({ x: 0, y: 0, d: 0 });
      recompute();
      renderParamsPanel();
    });
    ovPanel.querySelectorAll('[data-hole-field]').forEach((el) => {
      el.addEventListener('change', (e) => {
        const ov = ensureOverride();
        const idx = Number(e.target.dataset.holeIdx);
        const field = e.target.dataset.holeField;
        if (!ov.extraHoles || !ov.extraHoles[idx]) return;
        ov.extraHoles[idx][field] = Number(e.target.value) || 0;
        recompute();
      });
    });
    ovPanel.querySelectorAll('[data-remove-hole]').forEach((el) => {
      el.addEventListener('click', (e) => {
        const ov = ensureOverride();
        const idx = Number(e.currentTarget.dataset.removeHole);
        if (ov.extraHoles) ov.extraHoles.splice(idx, 1);
        recompute();
        renderParamsPanel();
      });
    });
  }

  // Экран «Деталь» для фасада (kind:'door') — компактный редактор ОДНОЙ
  // зоны, открытый кликом по фасаду в 3D (см. doorZoneEditorScreen,
  // renderParamsPanel). Многозонный случай переиспользует те же поля/
  // обработчики, что и сайдбар (bindZoneFieldEvents), только с refresh =
  // renderParamsPanel (у этого экрана нет более точечной перерисовки одной
  // карточки, в отличие от renderSectionsList для сайдбара).
  const doorZoneRoot = document.getElementById('doorZoneEditorRoot');
  if (doorZoneRoot) {
    bindZoneFieldEvents(doorZoneRoot, mod, renderParamsPanel);
    bindShelfFieldEvents(doorZoneRoot, mod, renderParamsPanel);
  }
  // Однозонный случай (doorZoneCount<=1) — тот же select «Фасад», что и в
  // сайдбаре, но привязан к sec.facade напрямую (не через общий делегат
  // [data-field], который слушает только #sectionsList).
  document.querySelectorAll('[data-singlefacade]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const sec = mod.sections[Number(e.target.dataset.singlefacade)];
      if (!sec) return;
      sec.facade = e.target.value;
      recompute();
    });
  });

  // Экран «Ящики» (drawersPanelBlock) — поля привязаны напрямую к
  // mod.sections[state.drawersSectionIndex] по простым уникальным id
  // (экран показывает ровно одну секцию, делегат [data-field] сайдбара
  // здесь не подходит — он слушает только #sectionsList).
  const drawersRoot = document.getElementById('drawersPanelRoot');
  if (drawersRoot) {
    const si = state.drawersSectionIndex;
    const sec = mod.sections[si];
    if (sec) {
      on('drawersMode', 'change', (e) => {
        sec.drawerMode = e.target.value;
        // Переход в ручной режим фиксирует то, что только что было
        // распределено автоматически (не обнуляет ящики); возврат в авто —
        // снимает все фиксации. Та же логика, что и раньше в делегате
        // renderSectionsList для 'drawerMode'.
        if (e.target.value === 'manual') sec.drawerHeights = manualHeights(si, sec);
        else sec.drawerPinned = [];
        renderParamsPanel();
        recompute();
      });
      drawersRoot.querySelectorAll('[data-drawer]').forEach((el) => {
        el.addEventListener('change', (e) => {
          sec.drawerHeights = redistributeDrawers(si, sec, Number(e.target.dataset.drawer), Number(e.target.value));
          renderParamsPanel();
          recompute();
        });
      });
      on('drawersUnpinBtn', 'click', () => {
        sec.drawerPinned = [];
        sec.drawerHeights = [];
        sec.drawerMode = 'auto';
        renderParamsPanel();
        recompute();
      });
      on('drawersThickness', 'change', (e) => {
        sec.drawerThickness = Number(e.target.value) || 16;
        recompute();
      });
      on('drawersDecor', 'change', (e) => {
        sec.drawerDecorCode = e.target.value;
        recompute();
      });
      on('drawersBoxHeight', 'change', (e) => {
        sec.drawerBoxHeight = e.target.value;
        recompute();
      });
      on('drawersOffset', 'change', (e) => {
        sec.drawerOffset = Math.max(MIN_LIFT, Number(e.target.value) || MIN_LIFT);
        recompute();
      });
      on('drawersPushToOpen', 'change', (e) => {
        sec.pushToOpen = e.target.checked;
        recompute();
      });
      on('drawersSystem', 'change', (e) => {
        sec.drawerSystem = e.target.value;
        // Список опций «Высота короба ящика» зависит от системы — как и у
        // drawerMode выше, перерисовываем экран целиком, чтобы список сразу
        // совпал с новой системой.
        renderParamsPanel();
        recompute();
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Единая точка пересчёта
// ---------------------------------------------------------------------------
function recompute(isRetry) {
  // Любое изменение проходит через пересчёт — здесь и снимаем состояние
  // для истории. Повтор (undo/redo) историю не пишет: стоит замок.
  if (!isRetry) pushHistory();
  const project = {
    bodyThickness: state.bodyThickness,
    backThickness: state.backThickness,
    facadeThickness: state.facadeThickness,
    decor: DECORS.find(d => d.code === state.decorCode),
    facadeDecor: DECORS.find(d => d.code === state.facadeDecorCode) || DECORS.find(d => d.code === state.decorCode),
    backMaterial: BACK_MATERIALS.find(d => d.code === state.backCode),
    worktopDepth: state.worktopDepth,
    jointType: state.jointType,
    modules: state.modules.map(m => ({
      name: m.name, width: m.width, height: m.height, depth: m.depth,
      rotation: m.rotation || 0, corner: !!m.corner, family: m.family || 'custom',
      topType: m.topType, railWidth: m.railWidth, noBack: !!m.noBack,
      blindPanel: !!m.blindPanel, blindStrip: m.blindStrip,
      leftSide: m.leftSide, rightSide: m.rightSide,
      base: m.baseType === 'plinth'
        ? { type: 'plinth', plinthHeight: m.plinthHeight }
        : { type: m.baseType, legHeight: m.legHeight },
      legType: m.legType || 'metal',
      sections: m.sections,
      // Ручные правки конкретных деталей (толщина/материал/доп. отверстия) —
      // см. applyPartOverrides() в engine.js и partBlock()/bindPanelEvents()
      // выше, где этот объект заполняется с экрана «Деталь».
      partOverrides: m.partOverrides || {},
    })),
  };

  currentModel = buildModel(project);

  // Изменились габариты или основание — свободные (незафиксированные) ящики
  // подстраиваются под новый фронт, после чего модель пересобирается один раз.
  if (!isRetry && reflowManualDrawers()) {
    renderSectionsList();
    recompute(true);
    return;
  }

  currentSpec = buildSpecification(currentModel);

  renderDrawings(currentModel);
  renderDetailingTable(currentModel);
  renderSpecTable(currentSpec);
  renderWarnings(currentModel.warnings);
  renderDrillLegend();

  if (viewer) {
    try { viewer.render(currentModel, viewOpts()); }
    catch (err) { console.error('3D render failed:', err); }
  }
  renderViewOverlay();
  autosaveProject();
}

// Ортогональные виды: модель остаётся ЦВЕТНОЙ 3D-сценой, а размеры рисуются
// прозрачным SVG-слоем поверх неё. Координаты берутся проецированием точек
// модели через камеру (viewer.project), поэтому размеры точно ложатся на
// изделие в любом виде и при любом зуме.
function renderViewOverlay() {
  const el = document.getElementById('viewOverlay');
  if (!el) return;
  if (!viewer || state.view === 'iso' || !currentModel || !currentModel.modules.length) {
    el.style.display = 'none'; el.innerHTML = ''; return;
  }
  try {
    el.innerHTML = buildOverlayDims();
    el.style.display = 'block';
  } catch (err) {
    console.error('Overlay failed:', err);
    el.style.display = 'none';
  }
}

function buildOverlayDims() {
  const m = currentModel, d = m.dims;
  const size = viewer.canvasSize();
  const P = (x, y, z) => viewer.project(x, y, z);
  const zf = d.D / 2;                       // передняя плоскость изделия
  let g = '';

  const lineEl = (a, b, cls) => `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="${cls}"/>`;
  const txtEl = (p, s, dy) => `<text x="${p.x.toFixed(1)}" y="${(p.y + (dy || 0)).toFixed(1)}" class="ov-t">${esc(s)}</text>`;

  // Размерная цепочка по вертикали в экранных координатах
  function vDim(x1y1, x2y2, offsetX, label) {
    const a = { x: x1y1.x + offsetX, y: x1y1.y };
    const b = { x: x2y2.x + offsetX, y: x2y2.y };
    let out = lineEl(x1y1, a, 'ov-ext') + lineEl(x2y2, b, 'ov-ext') + lineEl(a, b, 'ov-dim');
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    out += `<text x="${mid.x.toFixed(1)}" y="${mid.y.toFixed(1)}" class="ov-t" transform="rotate(-90 ${mid.x.toFixed(1)} ${mid.y.toFixed(1)})">${esc(label)}</text>`;
    return out;
  }
  function hDim(p1, p2, offsetY, label) {
    const a = { x: p1.x, y: p1.y + offsetY };
    const b = { x: p2.x, y: p2.y + offsetY };
    let out = lineEl(p1, a, 'ov-ext') + lineEl(p2, b, 'ov-ext') + lineEl(a, b, 'ov-dim');
    out += txtEl({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, label, -4);
    return out;
  }

  if (state.view === 'front') {
    // габарит по ширине и высоте
    g += hDim(P(-d.W / 2, 0, zf), P(d.W / 2, 0, zf), 46, `${Math.round(d.W)}`);
    g += vDim(P(-d.W / 2, 0, zf), P(-d.W / 2, d.H, zf), -46, `${Math.round(d.H)}`);
    // Ширины модулей — только если модулей больше одного. При единственном
    // модуле его ширина совпадает с габаритом, и размер дублировался.
    for (const mod of m.modules) {
      if (m.modules.length > 1) {
        const md = mod.dims;
        g += hDim(P(mod.offsetX - md.W / 2, 0, zf), P(mod.offsetX + md.W / 2, 0, zf), 24, `${Math.round(md.W)}`);
      }
      g += txtEl(P(mod.offsetX, d.H, zf), mod.name, -12);
    }
    // фасады видны — размечаем сами фасады; скрыты — внутреннюю начинку
    g += state.hideFacades ? innerHeightDims(P, zf) : facadeDims(P, zf);
  } else if (state.view === 'side') {
    const xEdge = -d.W / 2;                            // ближняя боковина
    g += hDim(P(xEdge, 0, -d.D / 2), P(xEdge, 0, d.D / 2), 46, `${Math.round(d.D)}`);
    g += vDim(P(xEdge, 0, zf), P(xEdge, d.H, zf), -46, `${Math.round(d.H)}`);
    if (state.hideFacades) g += innerHeightDims(P, zf);
  } else {
    // Вид сверху. Размеры ведём по КРАЯМ изделия, а не через его середину —
    // иначе линии ложатся поверх модели и вид превращается в кашу.
    // Смотрим вниз: перёд (z = +D/2) оказывается внизу экрана, левый край
    // (x = -W/2) — слева.
    const yTop = d.H;                                  // плоскость крыши
    g += hDim(P(-d.W / 2, yTop, d.D / 2), P(d.W / 2, yTop, d.D / 2), 46, `${Math.round(d.W)}`);
    g += vDim(P(-d.W / 2, yTop, -d.D / 2), P(-d.W / 2, yTop, d.D / 2), -46, `${Math.round(d.D)}`);
    // ширины модулей — вторым уровнем под габаритом
    if (m.modules.length > 1) {
      for (const mod of m.modules) {
        g += hDim(P(mod.offsetX - mod.dims.W / 2, yTop, d.D / 2),
                  P(mod.offsetX + mod.dims.W / 2, yTop, d.D / 2), 24, `${Math.round(mod.dims.W)}`);
      }
    }
  }

  // Пока пользователь добавляет/редактирует доп. отверстие на экране
  // «Деталь», показываем его координаты X/Y и диаметр прямо на чертеже —
  // не только цветными рёбрами в 3D (см. viewer.getAxisHint()).
  if (viewer.getAxisHint) {
    const hint = viewer.getAxisHint();
    if (hint && hint.holes && hint.holes.length) {
      const originP = P(hint.origin.x, hint.origin.y, hint.origin.z);
      for (const h of hint.holes) {
        const hp = P(h.world.x, h.world.y, h.world.z);
        g += lineEl(originP, hp, 'ov-ext');
        g += `<text x="${hp.x.toFixed(1)}" y="${(hp.y - 10).toFixed(1)}" class="ov-t" text-anchor="middle">`
          + `<tspan fill="#e03131">X${Math.round(h.x)}</tspan> `
          + `<tspan fill="#2f9e44">Y${Math.round(h.y)}</tspan> `
          + `<tspan>⌀${Math.round(h.d)}</tspan></text>`;
      }
    }
  }

  return `<svg width="${size.w}" height="${size.h}" viewBox="0 0 ${size.w} ${size.h}" class="ov-svg" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
}

// Разметка фасадов: ширина и высота каждого фасада прямо на нём.
function facadeDims(P, zf) {
  const m = currentModel;
  let g = '';
  const lineEl = (a, b, cls) => `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="${cls}"/>`;
  const zFace = zf + 20;   // фасад стоит перед корпусом

  for (const p of m.partsRaw) {
    if (p.kind !== 'door' && p.kind !== 'drawerFront') continue;
    const b = p.boxes[0];
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2;
    const y0 = b.y - b.h / 2, y1 = b.y + b.h / 2;

    // ширина — по нижней кромке фасада
    const a1 = P(x0, y0 + 30, zFace), a2 = P(x1, y0 + 30, zFace);
    g += lineEl(a1, a2, 'ov-dim');
    g += `<text x="${((a1.x + a2.x) / 2).toFixed(1)}" y="${((a1.y + a2.y) / 2 - 3).toFixed(1)}" class="ov-t ov-inner">${Math.round(p.length)}</text>`;

    // высота — по левой кромке фасада
    const c1 = P(x0 + 30, y0, zFace), c2 = P(x0 + 30, y1, zFace);
    g += lineEl(c1, c2, 'ov-dim');
    const mid = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };
    g += `<text x="${mid.x.toFixed(1)}" y="${mid.y.toFixed(1)}" class="ov-t ov-inner" transform="rotate(-90 ${mid.x.toFixed(1)} ${mid.y.toFixed(1)})">${Math.round(p.width)}</text>`;
  }
  return g;
}

// Разметка по высоте внутри секций: просветы между полками и высоты ящиков.
// Ради этого и нужен режим «спереди со скрытыми фасадами».
function innerHeightDims(P, zf) {
  const m = currentModel;
  let g = '';
  const lineEl = (a, b, cls) => `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="${cls}"/>`;

  for (const mod of m.modules) {
    const md = mod.dims;
    for (let i = 0; i < md.n; i++) {
      const secL = md.sections[i];
      const x0 = mod.offsetX + secL.x0;
      const cx = x0 + secL.w / 2;

      // отметки: дно, низ/верх каждой полки и ящика, крыша
      const marks = [md.innerBottomY];
      for (const p of m.partsRaw) {
        if (p.module !== mod.name) continue;
        const b = p.boxes[0];
        if (b.x < x0 - 1 || b.x > x0 + secL.w + 1) continue;
        if (p.kind === 'shelf') { marks.push(b.y - b.h / 2, b.y + b.h / 2); }
        if (p.kind === 'drawerFront') { marks.push(b.y - b.h / 2, b.y + b.h / 2); }
      }
      marks.push(md.innerBottomY + md.innerH);
      marks.sort((a, b) => a - b);

      // просветы больше 20 мм подписываем
      for (let k = 0; k < marks.length - 1; k++) {
        const h = marks[k + 1] - marks[k];
        if (h < 20) continue;
        const a = P(cx, marks[k], zf), b = P(cx, marks[k + 1], zf);
        g += lineEl(a, b, 'ov-dim');
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        g += `<text x="${mid.x.toFixed(1)}" y="${mid.y.toFixed(1)}" class="ov-t ov-inner">${Math.round(h)}</text>`;
      }
    }
  }
  return g;
}

// Параметры отображения 3D: скрытие фасадов + подсветка активного модуля,
// чтобы было видно, какой именно модуль сейчас редактируется.
function viewOpts() {
  // Подсказка осей и бирюзовая подсветка детали держатся на state.selectedPart
  // САМОМ ПО СЕБЕ, а не на state.panelView==='part' — деталь должна
  // подсвечиваться сразу по клику в 3D (viewer.onSelectPart ставит
  // selectedPart в момент открытия контекстного меню, ДО того как
  // пользователь выбрал конкретный пункт), а не только когда открыт сам
  // экран редактирования. state.selectedPart корректно обнуляется во всех
  // точках выхода (exitFocusMode, onFocusMiss, setPanelView при уходе с
  // экрана «Деталь»), так что подсветка не залипает.
  let axisHintRow = null;
  if (state.selectedPart) {
    const mod = state.modules.find((m) => m.name === state.selectedPart.module);
    const resolved = resolveSelectedPart(mod);
    if (resolved.chosen) axisHintRow = resolved.chosen.part;
  }
  // Секция (фасад), которую сейчас редактируют или только что выбрали в 3D,
  // подсвечивается бирюзовым — сигнал для viewer.js, какую именно
  // подсвечивать. zoneIndex передаём отдельно: если секция разбита на зоны
  // по высоте («Разделить на секции по вертикали» — доверь-пенал под технику),
  // редактируется ОДНА конкретная зона, и подсвечивать нужно только её дверь,
  // а не все зоны стопки — viewer.js сверяет zoneIndex наравне с sectionIndex.
  const highlightSection = (state.selectedPart
      && Number.isFinite(state.selectedPart.sectionIndex))
    ? { module: state.selectedPart.module, sectionIndex: state.selectedPart.sectionIndex,
        zoneIndex: Number.isFinite(state.selectedPart.zoneIndex) ? state.selectedPart.zoneIndex : null }
    : null;
  return {
    hideFacades: state.hideFacades,
    drillCheck: state.drillCheck,
    drillFilter: state.drillFilter,
    // Пока идёт изоляция, подсветку синим отключаем — изолированный модуль
    // и так выделен тем, что остальные притушены, а подсветка мешала бы
    // видеть его настоящую текстуру (см. Этап 3 плана).
    highlightModule: state.isolatedModule ? null : state.selected,
    isolateModule: state.isolatedModule,
    axisHintRow,
    highlightSection,
  };
}

// Легенда режима проверки присадки: что за отверстия в проекте, каким
// цветом подсвечены и сколько их. Без неё цветные штыри — просто мозаика.
function renderDrillLegend() {
  const box = document.getElementById('drillLegend');
  if (!box) return;
  if (!state.drillCheck || !currentModel) {
    box.innerHTML = '';
    return;
  }
  // Если 3D не поднялся, справочники цветов могут отсутствовать — легенда
  // всё равно должна строиться: она читается и без картинки.
  const vw = window.Modul3D.viewer || {};
  const DRILL_COLOR = vw.DRILL_COLOR || {};
  const DRILL_TITLE = vw.DRILL_TITLE || {};
  // Считаем не просто по назначению, а по РЕЖИМУ СВЕРЛЕНИЯ: диаметр,
  // глубина и сторона. Одно назначение может давать разные отверстия
  // (у ручки Ø5 насквозь, у петли Ø35 глухое и Ø5 под шурупы) — в легенде
  // это должно быть видно, иначе по ней нельзя проверить присадку.
  const count = new Map();
  for (const p of (currentModel.partsRaw || [])) {
    for (const h of (p.holes || [])) {
      const depth = h.through ? 'насквозь' : `глуб. ${h.depth || 0}`;
      const where = h.side === 'edge' ? 'в торец'
        : h.side === 'back'
          ? ((p.kind === 'bottom' || p.kind === 'shelf' || p.kind === 'drawerBottom') ? 'снизу'
            : p.kind === 'drawerSide' ? 'снаружи ящика' : 'с изнанки')
          : (p.kind === 'top' ? 'сверху'
            : (p.kind === 'drawerSide' || p.kind === 'drawerBack') ? 'изнутри ящика' : 'с лица');
      const key = `${h.kind}|Ø${h.d} · ${depth} · ${where}`;
      count.set(key, (count.get(key) || 0) + 1);
    }
  }
  const grooves = new Map();
  for (const p of (currentModel.partsRaw || [])) {
    for (const g of (p.grooves || [])) {
      const key = `паз ${g.w}×${g.depth} мм`;
      grooves.set(key, (grooves.get(key) || 0) + 1);
    }
  }
  const rows = Array.from(count.keys()).sort().map((key) => {
    const [kind, spec] = key.split('|');
    const c = ((DRILL_COLOR[kind] || 0x555555)).toString(16).padStart(6, '0');
    const on = state.drillFilter === kind ? ' on' : '';
    return `<div class="dl-row${on}" data-kind="${esc(kind)}" title="Показать только эту присадку">`
      + `<i style="background:#${c}"></i>`
      + `<span>${esc(DRILL_TITLE[kind] || kind)}<br><small>${esc(spec)}</small></span>`
      + `<b>${count.get(key)}</b></div>`;
  }).join('')
  + Array.from(grooves.keys()).map((key) =>
    `<div class="dl-row"><i style="background:#888"></i>`
    + `<span>Паз под заднюю стенку<br><small>${esc(key)}</small></span>`
    + `<b>${grooves.get(key)}</b></div>`).join('');

  box.innerHTML = `<b>Присадка</b>${rows || '<div class="dl-row">отверстий нет</div>'}`
    + (state.drillFilter ? '<div class="dl-hint">показан один вид — кликните ещё раз, чтобы снять</div>' : '');
  // Клик по строке легенды оставляет в сцене только эту присадку
  box.querySelectorAll('[data-kind]').forEach((el) => {
    el.addEventListener('click', () => {
      const k = el.dataset.kind;
      state.drillFilter = (state.drillFilter === k) ? null : k;
      if (viewer && currentModel) viewer.render(currentModel, viewOpts());
      renderDrillLegend();
    });
  });
}

function renderWarnings(warnings) {
  document.getElementById('warnings').innerHTML = warnings.map(w => `⚠ ${esc(w)}`).join('<br>');
}

function renderDrawings(model) {
  const el = document.getElementById('tab-drawings');
  try {
    el.innerHTML = buildDrawings(model, !state.hideFacades);
  } catch (err) {
    console.error('Drawings render failed:', err);
    el.innerHTML = `<div style="color:#a33;font-size:13px;padding:10px">Не удалось построить чертежи: ${esc(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Деталировка
// ---------------------------------------------------------------------------
// Материал детали для человека: полное название декора, а не код.
function materialName(code) {
  const d = DECORS.filter((x) => x.code === code)[0];
  if (d) return d.name;
  const b = BACK_MATERIALS.filter((x) => x.code === code)[0];
  if (b) return b.name;
  // Фасадные материалы, шпон и стекло — из каталога, иначе в деталировке
  // печатался внутренний код вроде FAC-VENEER
  const cat = window.Modul3D.catalog || {};
  const fac = cat.FACADE_MATERIALS || {};
  const f = Object.keys(fac).filter((k) => k === code)[0];
  if (f) return fac[f].name;
  if (cat.GLASS && cat.GLASS.code === code) return cat.GLASS.name;
  return code || '—';
}

// Ключ группировки для экранной деталировки (не путать с mergeKey в
// engine.js). Одинаковые детали из разных модулей схлопываются в одну
// строку — но только если совпадает и присадка (holes/grooves): деталь
// с иначе расположенными отверстиями сверлится по другому шаблону, значит
// это другая заготовка, а не дубликат. Список полей — общий для трёх мест
// в коде (эта таблица, таблица под общим чертежом в src/drawings.js и
// Excel-экспорт в server/src/services/exportGeneration.js), поэтому набор
// менять нельзя без синхронизации со всеми тремя.
function detailingHolesSignature(r) {
  return (r.holes || [])
    .map((h) => `${h.kind}:${h.x}:${h.y}:${h.d}:${h.depth || 0}:${h.through ? 1 : 0}:${h.side || ''}`)
    .sort().join('|');
}
function detailingGroovesSignature(r) {
  return (r.grooves || [])
    .map((g) => `${g.kind}:${g.x0}:${g.y0}:${g.x1}:${g.y1}:${g.w}:${g.depth}:${g.side || ''}`)
    .sort().join('|');
}
function detailingGroupKey(r) {
  return JSON.stringify([
    r.name, r.material, r.thickness, r.length, r.width,
    r.edging.long1, r.edging.long2, r.edging.short1, r.edging.short2,
    r.grainDirection, detailingHolesSignature(r), detailingGroovesSignature(r),
    // Деталь с ручной правкой (part.overrides в engine.js) получает своё
    // отдельное примечание и не должна молча склеиваться ни с чем — даже
    // с другой такой же вручную отредактированной деталью, поэтому в ключ
    // подмешивается её собственный номер позиции.
    r.overridden ? `override:${r.num}` : '',
  ]);
}

function renderDetailingTable(model) {
  const el = document.getElementById('tab-detailing');
  // Ножки — фурнитура, а не деталь из листа: в деталировку не попадают,
  // их количество считается в спецификации.
  // Группируем по ВСЕМУ проекту (across все модули), а не по одному модулю:
  // одинаковые детали из разных модулей должны стать одной строкой с
  // суммарным количеством.
  const groups = {};
  const order = [];
  for (const r of model.parts.filter(r => !r.hardware)) {
    const key = detailingGroupKey(r);
    if (!groups[key]) {
      groups[key] = { part: r, qty: 0, nums: [], modules: [], sections: [], notes: [] };
      order.push(key);
    }
    const g = groups[key];
    g.qty += r.qty;
    if (r.num != null && g.nums.indexOf(r.num) === -1) g.nums.push(r.num);
    if (g.modules.indexOf(r.module || '') === -1) g.modules.push(r.module || '');
    if (g.sections.indexOf(r.section || '') === -1) g.sections.push(r.section || '');
    const note = r.note || '';
    if (note && g.notes.indexOf(note) === -1) g.notes.push(note);
  }

  const rows = order.map((key) => {
    const g = groups[key], r = g.part;
    const numStr = g.nums.slice().sort((a, b) => a - b).join(', ');
    // Модуль/секция — как у всех деталей группы, если он один и тот же;
    // если детали пришли из разных модулей/секций, перечисляем их через
    // запятую в порядке первого появления (без дублей).
    const moduleStr = g.modules.join(', ');
    const sectionStr = g.sections.join(', ');
    return `
    <tr>
      <td>${esc(numStr)}</td>
      <td>${esc(moduleStr)}</td>
      <td>${esc(r.name)}</td>
      <td>${esc(sectionStr)}</td>
      <td>${esc(materialName(r.material))}, ${r.thickness} мм</td>
      <td>${r.length}</td>
      <td>${r.width}</td>
      <td>${g.qty}</td>
      <td>${r.edging.long1 || '—'}</td>
      <td>${r.edging.long2 || '—'}</td>
      <td>${r.edging.short1 || '—'}</td>
      <td>${r.edging.short2 || '—'}</td>
      <td>${r.grainDirection ? 'да' : 'нет'}</td>
      <td>${esc(g.notes.join('; '))}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `
    <table>
      <thead><tr>
        <th>№</th><th>Модуль</th><th>Наименование</th><th>Секция</th><th>Материал</th>
        <th>Длина</th><th>Ширина</th><th>Кол-во</th>
        <th>Кромка L1</th><th>Кромка L2</th><th>Кромка S1</th><th>Кромка S2</th>
        <th>Текстура</th><th>Примечание</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ---------------------------------------------------------------------------
// Спецификация
// ---------------------------------------------------------------------------
function renderSpecTable(spec) {
  const el = document.getElementById('tab-spec');
  const section = (title, rows, cols) => `
    <h4 class="spec-title">${title}</h4>
    <table><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody></table>`;

  const sheetRows = spec.sheetMaterials.map((m, i) =>
    `<tr><td>${i + 1}</td><td>${esc(m.name)}</td><td>${esc(m.code)}</td><td>${m.area_m2} м²</td><td>${m.sheets}</td><td>${m.price}</td><td>${m.sum}</td></tr>`).join('');
  const edgeRows = spec.edging.map((e, i) =>
    `<tr><td>${i + 1}</td><td>Кромка ${esc(e.type)}</td><td>${e.length_m} пог.м</td><td>${e.price_per_m}</td><td>${e.sum}</td></tr>`).join('');
  const hwRows = spec.hardware.map((h, i) =>
    `<tr><td>${i + 1}</td><td>${esc(h.name)}</td><td>${esc(h.article)}</td><td>${h.qty} ${esc(h.unit)}</td><td>${h.price}</td><td>${h.sum}</td></tr>`).join('');
  const fRows = spec.fasteners.map((f, i) =>
    `<tr><td>${i + 1}</td><td>${esc(f.name)}</td><td>${esc(f.article)}</td><td>${f.qty} ${esc(f.unit)}</td><td>${f.price}</td><td>${f.sum}</td></tr>`).join('');

  // Символ валюты — глобальная настройка проекта (шестерёнка в шапке,
  // см. ui-shell.js: window.Modul3D.currency), а не захардкоженный ₽.
  const cur = curSym();
  el.innerHTML =
    section('1. Листовые материалы', sheetRows, ['№', 'Позиция', 'Артикул', 'Площадь', 'Листов', `Цена, ${cur}`, `Сумма, ${cur}`]) +
    section('2. Кромочный материал', edgeRows, ['№', 'Позиция', 'Кол-во', `Цена, ${cur}/м`, `Сумма, ${cur}`]) +
    section('3. Фурнитура', hwRows, ['№', 'Позиция', 'Артикул', 'Кол-во', `Цена, ${cur}`, `Сумма, ${cur}`]) +
    section(`4. Крепёж и метизы (${esc(spec.jointTypeLabel)})`, fRows, ['№', 'Позиция', 'Артикул', 'Кол-во', `Цена, ${cur}`, `Сумма, ${cur}`]) +
    `<div class="total-line">ИТОГО: ${spec.totalCost.toLocaleString('ru-RU')} ${cur}</div>`
    + drawerPassportHtml();
}

// ПАСПОРТ СИСТЕМЫ ЯЩИКОВ. Все числа, по которым считается короб, одной
// таблицей и с указанием источника: проверять расчёт по ней быстрее, чем
// искать координаты в 3D. Неподтверждённые значения выводятся отдельно —
// правило проекта: выдуманных размеров в модели быть не должно.
function drawerPassportHtml() {
  const { buildDrawerPassport } = window.Modul3D.specification || {};
  if (!buildDrawerPassport) return '';
  // Система ящиков — теперь настройка ПО СЕКЦИИ (sec.drawerSystem, см.
  // newSection()/drawersPanelBlock), а не одна на весь проект — собираем
  // множество РЕАЛЬНО используемых систем (только там, где в секции есть
  // ящики) и выводим паспорт на каждую отдельно, без дублей.
  const systemIds = [];
  state.modules.forEach((m) => {
    (m.sections || []).forEach((sec) => {
      if (!(Number(sec.drawers) > 0)) return;
      const sysId = sec.drawerSystem || 'ballBearing';
      if (systemIds.indexOf(sysId) === -1) systemIds.push(sysId);
    });
  });
  if (!systemIds.length) return '';

  const passports = systemIds.map((sysId) => {
    const pass = buildDrawerPassport(sysId);
    if (!pass) return '';
    const rows = pass.rows.map((r) =>
      `<tr><td>${esc(r.name)}</td><td>${esc(String(r.value))}</td><td>${esc(r.note)}</td></tr>`).join('');
    const warn = pass.assumed.length
      ? `<div class="passport-warn">⚠ Не подтверждено документом: ${
        pass.assumed.map((a) => esc(a)).join('; ')}. Сверьте с инструкцией производителя.</div>`
      : '<div class="passport-ok">Все размеры взяты из документа производителя.</div>';
    const sysName = (DRAWER_SYSTEMS[sysId] || {}).name || sysId;
    return `<h5>${esc(sysName)}</h5>${warn}
      <table><thead><tr><th>Параметр</th><th>Значение</th><th>Примечание</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }).join('');

  return `<h4 class="spec-title">5. Паспорт системы ящиков</h4>${passports}`;
}

// ---------------------------------------------------------------------------
// Вкладки
// ---------------------------------------------------------------------------
// ВКЛАДКИ ДОКУМЕНТОВ. Внизу лежит свёрнутая полоса: 3D занимает весь экран.
// Клик по вкладке раскрывает её и прокручивает содержимое к началу; повторный
// клик по активной вкладке сворачивает обратно и возвращает высоту 3D.
function setDocsTab(name, toggle) {
  const box = document.querySelector('.results');
  if (!box) return;
  // Кнопку ищем перебором, а не селектором по атрибуту: так работает и в
  // браузере, и в прогоне, где движок селекторов упрощённый.
  const btn = Array.prototype.filter.call(document.querySelectorAll('.tab-btn'),
    (b) => b.dataset && b.dataset.tab === name)[0];
  const wasOpen = box.classList.contains('open');
  const wasActive = btn && btn.classList.contains('active');
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  // Инлайновый display от старой разметки перебивал классы — снимаем его,
  // иначе деталировка и спецификация не раскрывались вовсе.
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.remove('active');
    if (p.style) p.style.display = '';
  });
  if (btn) btn.classList.add('active');
  const panel = document.getElementById('tab-' + name);
  if (panel) panel.classList.add('active');
  const open = (toggle && wasOpen && wasActive) ? false : true;
  box.classList.toggle('open', open);
  if (open && panel) {
    panel.scrollTop = 0;                       // документы всегда с начала
    if (panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest' });
  }
  if (viewer && viewer.resize) viewer.resize();  // 3D перестроить под новую высоту
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => setDocsTab(btn.dataset.tab, true));
});
// На старте документы свёрнуты — 3D во весь экран.
setDocsTab('drawings', false);
const docsBox = document.querySelector('.results');
if (docsBox) docsBox.classList.remove('open');

// ---------------------------------------------------------------------------
// Экспорт и печать
// ---------------------------------------------------------------------------
// Деталировка/спецификация формируются на сервере (см. ТЗ-МОНЕТИЗАЦИЯ.md 4.3) —
// exportDetailing/exportSpecification асинхронные и бросают Error с err.code
// = HTTP-статус (401/402) при отказе доступа; handleExportError переводит
// это в понятный текст + кнопку действия (см. ниже, раздел «Гейт доступа»).
function wireExportButton(id, action) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await action();
    } catch (err) {
      handleExportError(err);
    } finally {
      btn.disabled = false;
    }
  });
}
wireExportButton('exportDetailing', () => exportDetailing(currentModel));
wireExportButton('exportSpec', () => exportSpecification(currentSpec));

// Сохранение/открытие проекта файлом .json — рядом с экспортом, тот же принцип:
// файл строится из единого состояния, ничего не собирается вручную.
document.getElementById('saveProjectBtn').addEventListener('click', saveProjectToFile);
const openProjectFileInput = document.getElementById('openProjectFile');
document.getElementById('openProjectBtn').addEventListener('click', () => {
  if (state.modules.length && !window.confirm(
    'Открыть другой проект? Несохранённые изменения текущего будут потеряны (кроме автосохранения).'
  )) return;
  openProjectFileInput.value = '';
  openProjectFileInput.click();
});
openProjectFileInput.addEventListener('change', () => {
  const file = openProjectFileInput.files && openProjectFileInput.files[0];
  if (file) openProjectFromFile(file);
});

// Присадка: координаты отверстий под ручки — таблицей и файлом для станка.
const onClick = (id, fn) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
};
onClick('exportDrillCsv', async () => {
  if (!currentModel || !currentModel.modules.length) { renderWarnings(['Проект пуст — присаживать нечего.']); return; }
  const n = window.Modul3D.cnc.drilledParts(currentModel).length;
  if (!n) { renderWarnings(['Ни на одной детали нет присадки: выберите ручки в секциях.']); return; }
  const btn = document.getElementById('exportDrillCsv');
  if (btn) btn.disabled = true;
  try {
    await exportDrillCsv(currentModel);
  } catch (err) {
    handleExportError(err);
  } finally {
    if (btn) btn.disabled = false;
  }
});
onClick('exportDrillDxf', async () => {
  if (!currentModel || !currentModel.modules.length) { renderWarnings(['Проект пуст — присаживать нечего.']); return; }
  const n = window.Modul3D.cnc.drilledParts(currentModel).length;
  if (!n) { renderWarnings(['Ни на одной детали нет присадки: выберите ручки в секциях.']); return; }
  const btn = document.getElementById('exportDrillDxf');
  if (btn) btn.disabled = true;
  try {
    await exportDrillDxf(currentModel);
  } catch (err) {
    handleExportError(err);
  } finally {
    if (btn) btn.disabled = false;
  }
});

document.getElementById('printDrawings').addEventListener('click', () => {
  const html = document.getElementById('tab-drawings').innerHTML;
  const w = window.open('', '_blank');
  if (!w) { alert('Разрешите всплывающие окна, чтобы напечатать чертежи.'); return; }
  // Стили встраиваем: окно открывается как about:blank, где относительная
  // ссылка на style.css не разрешилась бы и чертёж напечатался бы пустым.
  w.document.write(`<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
    <title>Чертежи</title><style>${DRAWINGS_CSS}
      body{background:#fff;padding:10mm;font-family:sans-serif}
      .dw-block{page-break-inside:avoid}
      @page{size:A3 landscape;margin:10mm}
    </style></head><body>${html}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
});

// ---------------------------------------------------------------------------
// Кнопки шапки: виды камеры и скрытие фасадов
// ---------------------------------------------------------------------------
function initHeaderControls() {
  // Отменить/Вернуть/Удалить модуль — статичные иконки в шапке (index.html),
  // в отличие от остального содержимого панели параметров не пересоздаются
  // при каждом renderParamsPanel(), поэтому обработчики вешаются один раз
  // здесь, а не в bindPanelEvents(). Сама логика (undo/redo/deleteModule) —
  // прежняя, без изменений; disabled-состояние держит updateHistoryButtons().
  const undoBtn = document.getElementById('undoBtn');
  if (undoBtn) undoBtn.addEventListener('click', undo);
  const redoBtn = document.getElementById('redoBtn');
  if (redoBtn) redoBtn.addEventListener('click', redo);
  const delBtn = document.getElementById('delModule');
  if (delBtn) delBtn.addEventListener('click', () => deleteModule(state.activeModule));

  document.querySelectorAll('.view-btn').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.view = b.dataset.view;
      if (viewer) viewer.setView(state.view);
      renderViewOverlay();
    });
  });

  // Оверлей размеров пересчитываем при любом движении камеры
  if (viewer) {
    const host = document.getElementById('viewer3d');
    ['pointermove', 'wheel', 'pointerup'].forEach((ev) =>
      host.addEventListener(ev, () => { if (state.view !== 'iso') renderViewOverlay(); }));
  }

  const hf = document.getElementById('hideFacadesBtn');
  hf.addEventListener('click', () => {
    state.hideFacades = !state.hideFacades;
    hf.classList.toggle('active', state.hideFacades);
    hf.textContent = state.hideFacades ? 'Показать фасады' : 'Скрыть фасады';
    if (viewer && currentModel) viewer.render(currentModel, viewOpts());
    if (currentModel) renderDrawings(currentModel);
  });

  const dc = document.getElementById('drillCheckBtn');
  if (dc) {
    dc.addEventListener('click', () => {
      state.drillCheck = !state.drillCheck;
      dc.classList.toggle('active', state.drillCheck);
      if (viewer && currentModel) viewer.render(currentModel, viewOpts());
      renderDrillLegend();
    });
  }

  // Делает модуль активным в панели по имени — общая логика для обычного
  // выбора кликом (onSelectModule) и для входа в изоляцию двойным кликом
  // (onIsolateModule), чтобы не дублировать поиск индекса модуля.
  function selectModuleByName(name) {
    state.selected = name;
    const idx = state.modules.findIndex(m => m.name === name);
    if (idx >= 0) state.activeModule = idx;
  }

  // Клик по модулю в 3D выбирает его в панели слева
  if (viewer) {
    viewer.onSelectModule = (name) => {
      if (!name) {                       // клик мимо модели — снять выделение
        const changed = state.selected !== null || state.isolatedModule !== null;
        state.selected = null;
        state.panelView = 'module';
        // Клик мимо снимает и режим изоляции — стекирования изоляций не бывает.
        exitIsolation();
        renderParamsPanel();
        if (changed) viewer.render(currentModel, viewOpts());
        return;
      }
      // Любой обычный (одиночный) клик по модулю снимает изоляцию — даже если
      // это тот же самый изолированный модуль: одно предсказуемое правило,
      // без стекирования изоляций (см. Этап 3 плана).
      exitIsolation();
      selectModuleByName(name);
      state.panelView = 'module';
      renderParamsPanel();
      viewer.render(currentModel, viewOpts());
    };

    // Двойной клик по модулю в 3D — «изолировать»: соседние модули гаснут
    // прозрачностью (opts.isolateModule в viewOpts()), этот остаётся в
    // реальной текстуре, панель переключается на его параметры.
    viewer.onIsolateModule = (name) => {
      if (!name) return;
      selectModuleByName(name);
      state.isolatedModule = name;
      state.selectedPart = null;
      state.panelView = 'module';
      renderParamsPanel();
      viewer.render(currentModel, viewOpts());
    };

    // Клик по ЛЮБОЙ детали ВНУТРИ уже изолированного модуля — открывает
    // контекстное меню фокуса в точке клика (см. showFocusMenu выше), а не
    // сразу экран «Деталь»: «Редактировать» ведёт на openPartEditor,
    // «Выйти из фокуса» — на exitFocusMode.
    viewer.onSelectPart = ({ module, kind, side, sectionIndex, zoneIndex, clientX, clientY }) => {
      // Деталь подсвечивается в 3D СРАЗУ по клику — ещё до того, как открыто
      // само меню и тем более выбран его пункт (см. viewOpts/viewer.render
      // ниже). panelView здесь НЕ трогаем — панель «Деталь»/«Секция» по-
      // прежнему открывается только явным выбором пункта меню (openPartEditor).
      state.selectedPart = { module, kind, side, subIndex: 0, sectionIndex, zoneIndex, asPart: false };
      viewer.render(currentModel, viewOpts());
      const items = [];
      // Клик по фасаду — сверху пункт быстрого разбиения секции на N зон
      // по вертикали (пенал под встроенную технику) — единственный способ
      // задать это число (в сайдбаре поля больше нет, см. renderSectionsList):
      // доступен прямо в 3D, где сразу видно фасад, который делим. При
      // применении заодно расставляет полки на стыках новых зон (см.
      // placeShelvesAtZoneBoundaries).
      if (kind === 'door' && Number.isFinite(sectionIndex)) {
        const mm = state.modules.find((m) => m.name === module);
        const sec = mm && mm.sections[sectionIndex];
        if (sec) {
          items.push({
            type: 'numberInput', label: 'Разделить на секции по вертикали',
            value: Number(sec.doorZoneCount) || 1, min: 1, max: 4, buttonLabel: 'Разделить',
            onApply: (n) => {
              const applied = setDoorZoneCount(sec, n);
              if (applied >= 2) {
                // Нижняя зона по умолчанию — вровень с фасадом соседа
                // (единая горизонтальная линия по ряду), если высота ещё
                // не задана вручную; уже настроенную высоту не трогаем.
                if (!sec.doorZones[0].height) {
                  const neighborH = findNeighborBottomZoneHeight(mm, sectionIndex);
                  if (neighborH) sec.doorZones[0].height = neighborH;
                }
                placeShelvesAtZoneBoundaries(mm, sectionIndex);
              }
              renderParamsPanel();
              recompute();
            },
          });
        }
      }
      // У фасада (kind:'door') первый пункт ведёт на редактор ЗОНЫ фасада
      // (doorZoneEditorScreen) — поэтому подпись «...секцию»; у остальных
      // видов деталей (боковина/дно и т.п.) этот же пункт — единственный и
      // ведёт сразу на общий редактор ОДНОЙ детали, подпись — «...деталь».
      items.push({
        label: kind === 'door' ? 'Редактировать секцию' : 'Редактировать деталь',
        action: () => openPartEditor(module, kind, side, sectionIndex, zoneIndex),
      });
      // Для фасада — отдельно ещё и «Редактировать деталь» (asPart:true), пока
      // честная заглушка (partKindPlaceholderBlock), но с корректной 3D-
      // подсветкой именно этой двери (см. resolveSelectedPart ниже).
      if (kind === 'door') {
        items.push({ label: 'Редактировать деталь', action: () => openPartEditor(module, kind, side, sectionIndex, zoneIndex, true) });
      }
      items.push({ label: 'Выйти из фокуса', action: exitFocusMode });
      showFocusMenu(clientX, clientY, items);
    };

    // Клик МИМО любой детали, пока изоляция активна — то же меню, но только
    // с пунктом выхода: редактировать здесь нечего.
    viewer.onFocusMiss = ({ module, clientX, clientY }) => {
      // Клик мимо любой детали — снимаем подсветку, оставленную предыдущим
      // кликом по детали (см. onSelectPart выше): раз ничего конкретного не
      // выбрано, светить в 3D больше нечему.
      if (state.selectedPart) {
        state.selectedPart = null;
        viewer.render(currentModel, viewOpts());
      }
      showFocusMenu(clientX, clientY, [
        { label: 'Выйти из фокуса', action: exitFocusMode },
      ]);
    };
  }
}

// ---------------------------------------------------------------------------
// Аккаунт: вход/регистрация, баланс токенов, статус подписки
// (см. ТЗ-МОНЕТИЗАЦИЯ.md, раздел 4.2 — минимальный вход, без него токены не
// к чему привязать для ИИ-распознавания эскиза). API_BASE и ключ localStorage
// под JWT — общие с sketchAI.js, чтобы не разъезжались (window.Modul3D.sketchAI).
// ---------------------------------------------------------------------------
const AUTH_API_BASE = window.Modul3D.sketchAI.API_BASE;
const AUTH_TOKEN_KEY = window.Modul3D.sketchAI.AUTH_TOKEN_KEY;

// Текущий статус аккаунта (null, пока не залогинены/не проверили токен) —
// { email, subscription: { status, currentPeriodEnd }, tokenBalance }
let authAccount = null;

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setAuthToken(token) {
  if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
  else localStorage.removeItem(AUTH_TOKEN_KEY);
}

function setAuthStatus(message, kind) {
  const el = document.getElementById('authStatus');
  if (!el) return;
  el.textContent = message || '';
  el.className = 'sketch-status' + (kind ? ` ${kind}` : '');
}

async function authRequest(path, body) {
  let res;
  try {
    res = await fetch(`${AUTH_API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new Error('Не удалось связаться с сервером — проверьте подключение к интернету.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Не удалось выполнить запрос, попробуйте ещё раз.');
  return data;
}

// Обновляет и попап «Аккаунт» в шапке, и подсказку рядом с загрузкой эскиза
// (см. index.html: sketchAuthNote) — единая точка отрисовки статуса входа.
function renderAccountUI() {
  const authForm = document.getElementById('authForm');
  const accountInfo = document.getElementById('accountInfo');
  const plansPanel = document.getElementById('plansPanel');
  const accountToggle = document.getElementById('accountToggle');
  const sketchNote = document.getElementById('sketchAuthNote');

  // Панель тарифов — временный экран поверх формы входа/аккаунта (см.
  // showPlansPanel); при любой обычной перерисовке возвращаемся к обычному
  // виду формы входа или карточки аккаунта.
  if (plansPanel) plansPanel.style.display = 'none';

  if (authAccount) {
    if (authForm) authForm.style.display = 'none';
    if (accountInfo) accountInfo.style.display = 'block';
    const emailEl = document.getElementById('accountEmail');
    const tokensEl = document.getElementById('accountTokens');
    const subEl = document.getElementById('accountSubStatus');
    if (emailEl) emailEl.textContent = authAccount.email;
    const nicknameEl = document.getElementById('accountNickname');
    const nicknameRow = document.getElementById('accountNicknameRow');
    if (nicknameRow) {
      if (authAccount.nickname) {
        if (nicknameEl) nicknameEl.textContent = authAccount.nickname;
        nicknameRow.style.display = 'flex';
      } else {
        nicknameRow.style.display = 'none';
      }
    }
    const accountAvatarEl = document.getElementById('accountAvatarPreview');
    if (accountAvatarEl) {
      if (authAccount.avatarUrl) {
        accountAvatarEl.style.backgroundImage = `url(${AUTH_API_BASE}${authAccount.avatarUrl})`;
        accountAvatarEl.classList.add('has-image');
      } else {
        accountAvatarEl.style.backgroundImage = '';
        accountAvatarEl.classList.remove('has-image');
      }
    }
    if (tokensEl) tokensEl.textContent = String(authAccount.tokenBalance);
    if (subEl) {
      const st = authAccount.subscription && authAccount.subscription.status;
      // Сервер уже схлопывает Paddle-статус 'trialing' в 'active' при записи в
      // БД (см. billing.js: mapPaddleSubscriptionStatus) — здесь всегда либо
      // 'active', либо нет.
      const active = st === 'active';
      subEl.textContent = active ? 'активна' : 'нет';
      const upgradeBtn = document.getElementById('accountUpgradeBtn');
      if (upgradeBtn) upgradeBtn.style.display = active ? 'none' : 'block';
    }
    if (accountToggle) accountToggle.classList.add('active');
    if (sketchNote) {
      sketchNote.textContent = `Вы вошли как ${authAccount.email} · токенов: ${authAccount.tokenBalance}`;
      sketchNote.className = 'sketch-status' + (authAccount.tokenBalance > 0 ? '' : ' error');
    }
  } else {
    if (authForm) authForm.style.display = 'block';
    if (accountInfo) accountInfo.style.display = 'none';
    if (accountToggle) accountToggle.classList.remove('active');
    if (sketchNote) {
      sketchNote.textContent = 'Войдите в аккаунт (кнопка «Аккаунт» в шапке), чтобы распознавать эскизы через ИИ.';
      sketchNote.className = 'sketch-status';
    }
  }
}

// Панель сравнения тарифов (см. index.html: #plansPanel) — общий экран для
// двух сценариев: сразу после успешной регистрации и по клику «Оформить
// подписку» в уже заполненной карточке аккаунта. Состав пунктов и кнопка
// оплаты переиспользуют существующие данные/функцию, не дублируют их.
function showPlansPanel() {
  const popover = document.getElementById('accountPopover');
  const authForm = document.getElementById('authForm');
  const accountInfo = document.getElementById('accountInfo');
  const plansPanel = document.getElementById('plansPanel');
  if (authForm) authForm.style.display = 'none';
  if (accountInfo) accountInfo.style.display = 'none';
  if (plansPanel) plansPanel.style.display = 'block';
  if (popover) popover.style.display = 'block';
}

// «Продолжить бесплатно» — просто возвращает попап к обычному виду (форма
// входа или карточка аккаунта, в зависимости от того, вошёл ли пользователь).
function hidePlansPanel() {
  renderAccountUI();
}

// Дёргает /auth/me и обновляет authAccount по сохранённому JWT — вызывается
// при загрузке страницы (если токен уже есть) и сразу после входа/регистрации.
async function fetchAccount() {
  const token = getAuthToken();
  if (!token) { authAccount = null; renderAccountUI(); return; }
  try {
    const res = await fetch(`${AUTH_API_BASE}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      // Токен истёк/невалиден — тихо разлогиниваем, без всплывающей ошибки
      // при обычной загрузке страницы.
      setAuthToken(null);
      authAccount = null;
      renderAccountUI();
      return;
    }
    if (!res.ok) throw new Error('Не удалось получить статус аккаунта.');
    authAccount = await res.json();
  } catch (err) {
    console.error('Не удалось получить статус аккаунта:', err);
    authAccount = null;
  }
  renderAccountUI();
}

// Ограничения на аватар при регистрации — те же, что сервер уже проверяет
// сам (см. ТЗ выше), дублируем на клиенте только чтобы не ждать зря ответ.
const AVATAR_MAX_SIZE = 2 * 1024 * 1024; // 2 МБ
const AVATAR_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function initAccountPanel() {
  const toggle = document.getElementById('accountToggle');
  const popover = document.getElementById('accountPopover');
  const formEl = document.getElementById('authForm');
  const emailInput = document.getElementById('authEmail');
  const nicknameInput = document.getElementById('authNickname');
  const avatarInput = document.getElementById('authAvatar');
  const avatarPreview = document.getElementById('authAvatarPreview');
  const passwordInput = document.getElementById('authPassword');
  const passwordToggle = document.getElementById('authPasswordToggle');
  const termsCheckbox = document.getElementById('authTerms');
  const loginBtn = document.getElementById('authLoginBtn');
  const registerBtn = document.getElementById('authRegisterBtn');
  const logoutBtn = document.getElementById('authLogoutBtn');
  if (!toggle || !popover) return;

  function resetAvatarPreview() {
    if (!avatarPreview) return;
    avatarPreview.style.backgroundImage = '';
    avatarPreview.classList.remove('has-image');
  }

  // Превью аватарки сразу при выборе файла, без похода на сервер — заодно
  // здесь же валидируем формат/размер, чтобы не ждать ответа сервера с
  // заведомо невалидным файлом (submit() ниже перепроверяет то же самое
  // на случай, если файл выбрали, а потом изменили условия).
  if (avatarInput && avatarPreview) {
    avatarInput.addEventListener('change', () => {
      const file = avatarInput.files && avatarInput.files[0];
      if (!file) { resetAvatarPreview(); return; }
      if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
        setAuthStatus('Аватар должен быть в формате JPEG, PNG или WEBP.', 'error');
        avatarInput.value = '';
        resetAvatarPreview();
        return;
      }
      if (file.size > AVATAR_MAX_SIZE) {
        setAuthStatus('Аватар слишком большой — максимум 2 МБ.', 'error');
        avatarInput.value = '';
        resetAvatarPreview();
        return;
      }
      setAuthStatus('', '');
      avatarPreview.style.backgroundImage = `url(${URL.createObjectURL(file)})`;
      avatarPreview.classList.add('has-image');
    });
  }

  toggle.addEventListener('click', () => {
    popover.style.display = popover.style.display === 'none' ? 'block' : 'none';
  });
  popover.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', (e) => {
    if (!popover.contains(e.target) && !toggle.contains(e.target)) popover.style.display = 'none';
  });

  // Глазик показа/скрытия пароля — обычный паттерн, переключает type поля
  // и меняет иконку (см. index.html: .ic-eye/.ic-eye-off).
  if (passwordToggle && passwordInput) {
    passwordToggle.addEventListener('click', () => {
      const showing = passwordInput.type === 'text';
      passwordInput.type = showing ? 'password' : 'text';
      const eyeIcon = passwordToggle.querySelector('.ic-eye');
      const eyeOffIcon = passwordToggle.querySelector('.ic-eye-off');
      if (eyeIcon) eyeIcon.style.display = showing ? '' : 'none';
      if (eyeOffIcon) eyeOffIcon.style.display = showing ? 'none' : '';
      const label = showing ? 'Показать пароль' : 'Скрыть пароль';
      passwordToggle.setAttribute('aria-label', label);
      passwordToggle.title = label;
    });
  }

  // Кнопка «Зарегистрироваться» заблокирована, пока не отмечен чекбокс
  // согласия с условиями использования (входа это не касается).
  if (termsCheckbox && registerBtn) {
    registerBtn.disabled = !termsCheckbox.checked;
    termsCheckbox.addEventListener('change', () => {
      registerBtn.disabled = !termsCheckbox.checked;
    });
  }

  async function submit(path, successMessage) {
    const email = (emailInput.value || '').trim();
    const password = passwordInput.value || '';
    if (!email || !password) {
      setAuthStatus('Укажите email и пароль.', 'error');
      return;
    }
    if (path === '/auth/register' && termsCheckbox && !termsCheckbox.checked) {
      setAuthStatus('Подтвердите согласие с условиями использования.', 'error');
      return;
    }

    // Никнейм и аватар нужны только при регистрации — /auth/login их не
    // принимает и не должен спотыкаться, даже если поля что-то содержат.
    let nickname = '';
    let avatarFile = null;
    if (path === '/auth/register') {
      nickname = (nicknameInput && nicknameInput.value || '').trim();
      if (nickname.length < 2 || nickname.length > 40) {
        setAuthStatus('Никнейм должен быть от 2 до 40 символов.', 'error');
        return;
      }
      avatarFile = (avatarInput && avatarInput.files && avatarInput.files[0]) || null;
      if (avatarFile) {
        if (!AVATAR_ALLOWED_TYPES.includes(avatarFile.type)) {
          setAuthStatus('Аватар должен быть в формате JPEG, PNG или WEBP.', 'error');
          return;
        }
        if (avatarFile.size > AVATAR_MAX_SIZE) {
          setAuthStatus('Аватар слишком большой — максимум 2 МБ.', 'error');
          return;
        }
      }
    }

    loginBtn.disabled = true;
    registerBtn.disabled = true;
    setAuthStatus(path === '/auth/login' ? 'Входим…' : 'Регистрируем…', '');
    try {
      let data;
      if (path === '/auth/register') {
        // Сервер принимает регистрацию как multipart/form-data (поле avatar —
        // файл), поэтому здесь не используем authRequest() (он всегда шлёт
        // JSON) — собираем FormData и не проставляем content-type вручную,
        // браузер сам добавит корректный boundary.
        const formData = new FormData();
        formData.append('email', email);
        formData.append('password', password);
        formData.append('nickname', nickname);
        if (avatarFile) formData.append('avatar', avatarFile);
        let res;
        try {
          res = await fetch(`${AUTH_API_BASE}${path}`, { method: 'POST', body: formData });
        } catch (networkErr) {
          throw new Error('Не удалось связаться с сервером — проверьте подключение к интернету.');
        }
        const resData = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(resData.error || 'Не удалось выполнить запрос, попробуйте ещё раз.');
        data = resData;
      } else {
        data = await authRequest(path, { email, password });
      }
      setAuthToken(data.token);
      passwordInput.value = '';
      if (path === '/auth/register') {
        if (nicknameInput) nicknameInput.value = '';
        if (avatarInput) avatarInput.value = '';
        resetAvatarPreview();
      }
      setAuthStatus('', '');
      await fetchAccount();
      if (path === '/auth/register') showPlansPanel();
    } catch (err) {
      setAuthStatus('Ошибка: ' + err.message, 'error');
    } finally {
      loginBtn.disabled = false;
      registerBtn.disabled = !(termsCheckbox && termsCheckbox.checked);
    }
  }

  // #authForm теперь настоящий <form> (нужно для автозаполнения браузера);
  // «Войти» — type="submit", поэтому и Enter в полях, и клик по кнопке идут
  // через один и тот же submit-обработчик. «Зарегистрироваться» остаётся
  // type="button" — у него отдельное условие (чекбокс), Enter его не должен
  // вызывать по умолчанию.
  if (formEl) {
    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      submit('/auth/login');
    });
  }
  registerBtn.addEventListener('click', () => submit('/auth/register'));

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      setAuthToken(null);
      authAccount = null;
      emailInput.value = '';
      passwordInput.value = '';
      const reviewTextEl = document.getElementById('reviewText');
      if (reviewTextEl) reviewTextEl.value = '';
      setReviewStatus('', '');
      renderAccountUI();
    });
  }

  // Отзыв о приложении (POST /reviews, требует вход) — уходит на модерацию,
  // поэтому после успешной отправки показываем не «опубликовано», а понятное
  // объяснение, что отзыв появится на сайте после проверки.
  const reviewText = document.getElementById('reviewText');
  const reviewSubmitBtn = document.getElementById('reviewSubmitBtn');
  function setReviewStatus(message, kind) {
    const el = document.getElementById('reviewStatus');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'sketch-status' + (kind ? ` ${kind}` : '');
  }
  if (reviewSubmitBtn && reviewText) {
    reviewSubmitBtn.addEventListener('click', async () => {
      const text = (reviewText.value || '').trim();
      if (!text) {
        setReviewStatus('Напишите текст отзыва, прежде чем отправить.', 'error');
        return;
      }
      reviewSubmitBtn.disabled = true;
      setReviewStatus('Отправляем…', '');
      try {
        let res;
        try {
          res = await fetch(`${AUTH_API_BASE}/reviews`, {
            method: 'POST',
            headers: { authorization: `Bearer ${getAuthToken()}`, 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
          });
        } catch (networkErr) {
          throw new Error('Не удалось связаться с сервером — проверьте подключение к интернету.');
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Не удалось отправить отзыв, попробуйте ещё раз.');
        reviewText.value = '';
        setReviewStatus('Спасибо! Отзыв отправлен на проверку — после одобрения он появится на сайте.', 'ok');
      } catch (err) {
        setReviewStatus('Ошибка: ' + err.message, 'error');
      } finally {
        reviewSubmitBtn.disabled = false;
      }
    });
  }

  const upgradeBtn = document.getElementById('accountUpgradeBtn');
  if (upgradeBtn) upgradeBtn.addEventListener('click', showPlansPanel);

  const planFreeBtn = document.getElementById('planFreeBtn');
  if (planFreeBtn) planFreeBtn.addEventListener('click', hidePlansPanel);

  const planPaidBtn = document.getElementById('planPaidBtn');
  if (planPaidBtn) planPaidBtn.addEventListener('click', requestCheckout);

  renderAccountUI();
  if (getAuthToken()) fetchAccount();
}

// ---------------------------------------------------------------------------
// Гейт доступа: подписка (Paddle) и обработка 401/402 при экспорте
// (см. ТЗ-МОНЕТИЗАЦИЯ.md, разделы 4.3-4.4). Пользователю никогда не
// показывается голый код ошибки — только понятный текст и кнопка действия.
// ---------------------------------------------------------------------------

// Публичный клиентский токен Paddle (Dashboard → Developer Tools →
// Authentication → Client-side tokens) — НЕ секрет, безопасен в клиентском
// коде (в отличие от серверного PADDLE_API_KEY). Плейсхолдер для песочницы —
// перед боевым запуском заменить на реальный live_... токен и переключить
// initPaddle() ниже на Environment.set('production').
const PADDLE_CLIENT_TOKEN = 'test_REPLACE_WITH_REAL_PADDLE_CLIENT_TOKEN';

function initPaddle() {
  // Скрипт мог не загрузиться (блокировщик рекламы, офлайн) — страницу это
  // ронять не должно, оформление подписки просто покажет понятную ошибку.
  if (!window.Paddle) return;
  try {
    window.Paddle.Environment.set('sandbox'); // сменить на 'production' в бою
    window.Paddle.Initialize({ token: PADDLE_CLIENT_TOKEN });
  } catch (err) {
    console.error('Paddle init failed:', err);
  }
}

// Открывает уже существующий попап «Аккаунт» на форме входа (401-сценарий).
// Открытие отложено на макротаск (setTimeout 0) — иначе тот же клик, что
// вызвал эту функцию (кнопка «Открыть аккаунт» лежит вне #accountPopover),
// долетает по всплытию до document-обработчика initAccountPanel(), который
// закрывает попап по клику снаружи, и попап открывается и тут же гаснет.
function openAccountPanel() {
  setTimeout(() => {
    const popover = document.getElementById('accountPopover');
    if (popover) popover.style.display = 'block';
    const emailInput = document.getElementById('authEmail');
    if (emailInput && !authAccount) emailInput.focus();
  }, 0);
}

// «Оформить подписку»: POST /billing/checkout → переход на checkoutUrl,
// либо (если сервер просит оформить прямо на месте) оверлей Paddle.js.
async function requestCheckout() {
  const token = getAuthToken();
  if (!token) { openAccountPanel(); return; }
  try {
    const res = await fetch(`${AUTH_API_BASE}/billing/checkout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Не удалось выполнить запрос, попробуйте ещё раз.');
    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
      return;
    }
    if (window.Paddle && data.transactionId) {
      window.Paddle.Checkout.open({ transactionId: data.transactionId });
    } else {
      showAccessGate('Не удалось открыть окно оплаты — обновите страницу и попробуйте снова.', null, null);
    }
  } catch (err) {
    console.error('Checkout request failed:', err);
    showAccessGate('Не удалось начать оформление подписки: ' + err.message, null, null);
  }
}

// Плавающая плашка «нужно действие» — сообщение и опциональная кнопка
// (см. index.html: #accessGate). Один и тот же элемент переиспользуется для
// всех гейтов (401/402/сеть), поэтому обработчик кнопки перевешивается заново
// при каждом вызове.
function showAccessGate(message, actionLabel, actionFn) {
  const box = document.getElementById('accessGate');
  const msgEl = document.getElementById('accessGateMessage');
  const actionBtn = document.getElementById('accessGateActionBtn');
  if (!box || !msgEl || !actionBtn) return;
  msgEl.textContent = message;
  if (actionLabel && actionFn) {
    actionBtn.textContent = actionLabel;
    actionBtn.style.display = '';
    actionBtn.onclick = () => { hideAccessGate(); actionFn(); };
  } else {
    actionBtn.style.display = 'none';
    actionBtn.onclick = null;
  }
  box.style.display = 'flex';
}
function hideAccessGate() {
  const box = document.getElementById('accessGate');
  if (box) box.style.display = 'none';
}

// Единая обработка ошибок экспорта (деталировка/спецификация/присадка) —
// сервер (см. src/export.js, src/cnc.js) бросает Error с err.code =
// HTTP-статус при отказе доступа; здесь код превращается в понятную фразу
// и рабочую кнопку, а не остаётся видимым пользователю числом.
function handleExportError(err) {
  console.error('Export failed:', err);
  const code = err && Number(err.code);
  if (code === 401) {
    showAccessGate('Войдите в аккаунт, чтобы скачать файл.', 'Открыть аккаунт', openAccountPanel);
  } else if (code === 402) {
    showAccessGate('Для экспорта нужна активная подписка.', 'Оформить подписку', requestCheckout);
  } else {
    showAccessGate((err && err.message) || 'Не удалось сформировать файл — попробуйте ещё раз.', null, null);
  }
}

(function initAccessGateUI() {
  const closeBtn = document.getElementById('accessGateCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', hideAccessGate);
})();

// ---------------------------------------------------------------------------
// Эскиз → 3D (Claude Vision, через сервер — см. sketchAI.js)
// ---------------------------------------------------------------------------
let selectedSketchFile = null;

function setSketchStatus(message, kind) {
  const el = document.getElementById('sketchStatus');
  el.textContent = message;
  el.className = 'sketch-status' + (kind ? ` ${kind}` : '');
}

function guessDecorCode(hint) {
  if (!hint) return null;
  const h = hint.toLowerCase();
  const found = DECORS.find((d) => h.includes(d.name.toLowerCase()) || d.name.toLowerCase().includes(h));
  return found ? found.code : null;
}

function initSketchPanel() {
  const uploadBtn = document.getElementById('sketchUploadBtn');
  const fileInput = document.getElementById('sketchFile');
  const popover = document.getElementById('sketchPopover');
  const preview = document.getElementById('sketchPreview');
  const recognizeBtn = document.getElementById('recognizeBtn');

  uploadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    selectedSketchFile = file || null;
    if (file) {
      preview.src = URL.createObjectURL(file);
      preview.style.display = 'block';
      popover.style.display = 'block';
      setSketchStatus('Файл выбран. Нажмите «Распознать эскиз».', '');
    } else {
      preview.style.display = 'none';
      popover.style.display = 'none';
    }
  });

  recognizeBtn.addEventListener('click', async () => {
    if (!selectedSketchFile) { setSketchStatus('Сначала выберите файл эскиза.', 'error'); return; }
    if (!authAccount) {
      setSketchStatus('Войдите в аккаунт (кнопка «Аккаунт» в шапке), чтобы распознать эскиз через ИИ.', 'error');
      return;
    }
    if (authAccount.tokenBalance <= 0) {
      setSketchStatus('Токены на распознавание эскиза закончились — пополните баланс.', 'error');
      return;
    }
    recognizeBtn.disabled = true;
    setSketchStatus('Распознаём эскиз через Claude…', '');
    try {
      // Контракт сервера (см. server/src/routes/sketch.js): { params, tokenBalance }.
      const { params: r, tokenBalance } = await recognizeSketch(selectedSketchFile);
      // Результат применяем к активному модулю
      const mod = state.modules[state.activeModule];
      mod.width = r.width; mod.height = r.height; mod.depth = r.depth;
      state.bodyThickness = r.bodyThickness;
      state.backThickness = r.backThickness;
      mod.plinthHeight = r.baseHeight;
      mod.sections = r.sections.map(s => Object.assign(newSection(), s));

      const decorCode = guessDecorCode(r.decorHint);
      if (decorCode) state.decorCode = decorCode;

      renderParamsPanel();
      recompute();

      // Сервер возвращает актуальный остаток токенов вместе с результатом —
      // обновляем локальный статус аккаунта без лишнего похода на /auth/me.
      if (typeof tokenBalance === 'number' && authAccount) {
        authAccount.tokenBalance = tokenBalance;
        renderAccountUI();
      }

      const decorNote = r.decorHint && !decorCode
        ? ` Материал «${r.decorHint}» не найден в справочнике — поправьте вручную.` : '';
      setSketchStatus(`Готово, параметры применены к модулю «${mod.name}» — проверьте их.${r.notes ? ' ' + r.notes : ''}${decorNote}`, 'ok');
    } catch (err) {
      console.error('Sketch recognition failed:', err);
      setSketchStatus('Ошибка: ' + err.message, 'error');
    } finally {
      recognizeBtn.disabled = false;
    }
  });

  document.addEventListener('click', (e) => {
    if (!popover.contains(e.target) && !uploadBtn.contains(e.target)) popover.style.display = 'none';
  });
  popover.addEventListener('click', (e) => e.stopPropagation());
}

// Смена валюты (ui-shell.js: currencyToggle → setCurrency) не меняет ни одно
// число в проекте — перерисовываем только то, что показывает цену рядом с
// символом валюты (спецификация, таблицы «Материалы»/«Фурнитура» в
// «Библиотеке»), а не весь recompute() (3D/чертежи/деталировка не зависят
// от валюты) — укладывается в требование «не более 1-2 секунд» тривиально.
function refreshCurrency() {
  if (currentSpec) renderSpecTable(currentSpec);
  if (document.getElementById('libraryPanel')) renderLibraryPanel();
}

// Мост для ui-shell.js: кнопка «Параметры» в HUD переключает экран панели
// параметров, не зная её внутреннего устройства; currencyToggle зовёт
// refreshCurrency() после смены валюты (см. ui-shell.js: setCurrency);
// isProjectEmpty() нужен restoreUI(), чтобы при пустом проекте открывать
// «Библиотеку» вместо панели «Параметры», где иначе видна только заглушка
// (см. emptyProjectBlock()). getRotations/rotateModule/getModuleHudState/
// setModuleDoorZoneCount — для HUD-меню в 3D (клик по модулю): поворот и
// разделение секции по высоте прямо из HUD, без захода в контекстное меню
// или Focus Mode (см. renderHud/initHud в ui-shell.js).
window.Modul3D.app = {
  setPanelView: setPanelView,
  refreshCurrency: refreshCurrency,
  isProjectEmpty: function () { return state.modules.length === 0; },
  getRotations: function () { return ROTATIONS.map((r) => r.slice()); },
  rotateModule: rotateModule,
  rotateModuleStep: rotateModuleStep,
  getModuleHudState: getModuleHudState,
  setModuleDoorZoneCount: setModuleDoorZoneCount,
};

// ---------------------------------------------------------------------------
// Запуск
// ---------------------------------------------------------------------------
try {
  document.title = `Modul3D ${APP_VERSION} — конструктор мебели`;
  const verEl = document.getElementById('appVersion');
  if (verEl) verEl.textContent = APP_VERSION;

  renderParamsPanel();
  initLibraryPanel();
  recompute();
  offerAutosaveRestore();
  initAccountPanel();
  initPaddle();
  initSketchPanel();
  initHeaderControls();
  initPartEditorOverlay();
  // Контекстное меню модуля закрывается кликом мимо и по Esc. Контекстное
  // меню фокуса (см. showFocusMenu) закрывается по Esc так же — само своим
  // клик-мимо-слушателем оно уже закрывается (см. showFocusMenu).
  // ВАЖНО: Esc больше НЕ выходит из режима изоляции напрямую — единственный
  // способ выйти из фокуса теперь пункт «Выйти из фокуса» в контекстном
  // меню (см. exitFocusMode) — так по брифу, чтобы пользователь не проваливался
  // из фокуса случайно, нажав Esc по другому поводу (например, чтобы закрыть
  // само меню, оставшись при этом в фокусе).
  document.addEventListener('click', closeModuleMenu);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeModuleMenu();
    closeFocusMenu();
  });

  // Отмена и возврат. Ctrl+X перехватываем только вне полей ввода — внутри
  // поля это штатное «вырезать», ломать его нельзя.
  // Delete — удалить выделенный модуль. В поле ввода клавиша работает
  // штатно (удаляет символ), поэтому там её не перехватываем.
  document.addEventListener('keydown', (e) => {
    const tg = (e.target && e.target.tagName) || '';
    if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
    if (e.key !== 'Delete' && e.key !== 'Del') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!state.modules.length) return;
    e.preventDefault();
    deleteModule(state.activeModule);
  });

  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const tag = (e.target && e.target.tagName) || '';
    const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const k = String(e.key || '').toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
    if (k === 'x' && !inField) { e.preventDefault(); redo(); return; }
    if (k === 's') { e.preventDefault(); saveProjectToFile(); return; }
    if (k === 'o') { e.preventDefault(); document.getElementById('openProjectBtn').click(); }
  });

  // Клик/Tab в числовое поле → значение выделяется целиком, чтобы первая
  // введённая цифра заменяла его. Делегируем на document (полей десятки,
  // многие рендерятся динамически). preventDefault на mouseup обязателен —
  // иначе браузер сразу после select() сам переносит курсор в точку клика.
  document.addEventListener('mousedown', (e) => {
    const el = e.target;
    if (!el || !el.matches || !el.matches('input[type="number"]')) return;
    document.addEventListener('mouseup', (ev) => { if (ev.target === el) ev.preventDefault(); },
      { once: true, capture: true });
  }, true);
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!el || !el.matches || !el.matches('input[type="number"]')) return;
    el.select();
  });

  updateHistoryButtons();
} catch (err) {
  console.error('App init failed:', err);
  document.getElementById('paramsPanel').innerHTML =
    `<div style="color:#a33;font-size:13px;padding:8px">Ошибка запуска: ${esc(err.message)}. Откройте консоль (F12) для деталей.</div>`;
}
})();
