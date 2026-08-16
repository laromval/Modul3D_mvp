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
const APP_VERSION = 'v187';

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
    drawerBoxHeight: 'auto',   // высота короба (царги): 'auto' или код из каталога
    drawerOffset: 10,   // технологический зазор от дна, чтобы ящик не тёрся
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
  bodyThickness: 18, backThickness: 3,
  decorCode: DECORS[0].code,
  // Декор фасада отдельный: у кухни корпус белый, фасад в своём декоре
  facadeDecorCode: DECORS[0].code,
  // Глубина столешницы: по ней видимая боковина дотягивается до стены
  worktopDepth: 600,
  backCode: BACK_MATERIALS[0].code,
  // Ящики — отдельный материал: обычно 16 мм и часто другой (внутренний) декор
  drawerDecorCode: DECORS[0].code,
  drawerThickness: 16,
  jointType: 'confirmat',
  drawerSystem: 'ballBearing',
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
  // Какой экран сейчас показан в панели «Параметры проекта»:
  // 'library' — база модулей, 'module' — поля активного модуля,
  // 'materials' — общие на проект материалы, 'part' — параметры одной
  // детали внутри изолированного модуля. Чисто UI-состояние, в историю
  // отмены/файл проекта не попадает.
  panelView: 'library',
  // Имя модуля, изолированного двойным кликом в 3D (см. viewer.onIsolateModule
  // ниже), или null — режим изоляции выключен. Чисто UI-состояние режима
  // просмотра, не часть данных проекта — в snapshot()/файл не попадает,
  // как и panelView/libraryOpenCat выше.
  isolatedModule: null,
  // Деталь, выбранная кликом внутри изолированного модуля: { module, kind,
  // side } (сейчас kind всегда 'side') или null. Тоже чисто UI-состояние.
  selectedPart: null,
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
    bodyThickness: state.bodyThickness, backThickness: state.backThickness,
    decorCode: state.decorCode, facadeDecorCode: state.facadeDecorCode, backCode: state.backCode,
    drawerDecorCode: state.drawerDecorCode, drawerThickness: state.drawerThickness,
    jointType: state.jointType, drawerSystem: state.drawerSystem, worktopDepth: state.worktopDepth,
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

function updateHistoryButtons() {
  const u = document.getElementById('undoBtn'), r = document.getElementById('redoBtn');
  if (u) u.disabled = history.past.length < 2;
  if (r) r.disabled = !history.future.length;
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

// Применяет сохранённое состояние проекта (из файла или автосохранения).
// В отличие от applySnapshot() (только для истории отмены), терпима к
// неполным/старым файлам: недостающие поля остаются как в текущем состоянии,
// а не обнуляются.
function restoreProjectData(data) {
  if (!data || typeof data !== 'object' || !data.state || !Array.isArray(data.state.modules)) {
    throw new Error('Файл не похож на проект «Modul3D» — нет списка модулей.');
  }
  Object.keys(data.state).forEach((k) => { state[k] = data.state[k]; });
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
}

// Переключатель экрана панели «Параметры проекта» — единственная точка
// связи с ui-shell.js (кнопка «Материалы» на боковой полосе и в HUD).
function setPanelView(view) {
  state.panelView = view;
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
    decor: DECORS.find(d => d.code === state.decorCode),
    facadeDecor: DECORS.find(d => d.code === state.facadeDecorCode) || DECORS.find(d => d.code === state.decorCode),
    backMaterial: BACK_MATERIALS.find(d => d.code === state.backCode),
    drawerDecor: DECORS.find(d => d.code === state.drawerDecorCode),
    drawerThickness: state.drawerThickness,
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
          sections: (m.sections || []).map(sc => Object.assign({}, sc, { drawerSystem: state.drawerSystem })),
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

// Якорь навигации: вкладки модулей + Отменить/Вернуть/Удалить/«Материалы».
// Виден ВСЕГДА, независимо от того, какой экран (panelView) сейчас показан
// ниже — иначе пользователь теряется, из какого экрана выбраться некуда.
// Переход на «Библиотеку модулей» вынесен на отдельную кнопку рейки, здесь
// вместо неё — быстрая ссылка на общие материалы проекта (декор, толщины,
// фурнитура), т.к. с рейки на этот экран напрямую больше не попасть.
function moduleTabsBlock(mod) {
  return `
    <h3>Модули проекта</h3>
    <div class="mod-tabs" id="modTabs">
      ${state.modules.map((m, i) =>
        `<button class="mod-tab tip tip-down ${i === state.activeModule ? 'active' : ''}" data-mod="${i}" type="button"
                 data-tip="ПКМ: поворот, удаление">${esc(m.name)}${m.rotation ? ` ↻${m.rotation}°` : ''}</button>`
      ).join('')}
      <button class="mod-add tip tip-down" id="addModule" type="button" data-tip="Добавить модуль" aria-label="Добавить модуль">+</button>
    </div>
    <div class="mod-actions">
      <button id="undoBtn" class="tip tip-down" type="button" data-tip="Отменить (Ctrl+Z)">↶ Отменить</button>
      <button id="redoBtn" class="tip tip-down" type="button" data-tip="Вернуть (Ctrl+Y, Ctrl+Shift+Z)">↷ Вернуть</button>
      ${mod ? `<button id="delModule" type="button" class="danger tip tip-down"
              data-tip="Удалить активный модуль">✕ Удалить модуль</button>` : ''}
      <button id="materialsLinkBtn" class="tip tip-down" type="button" data-tip="Общие материалы проекта">Материалы</button>
    </div>`;
}

// Маленькая ссылка «← Назад» сверху экранов, которые не являются точкой
// входа («Материалы», в будущем «Деталь») — ведёт на «Параметры модуля»,
// если какой-то модуль выбран, иначе на «Базу модулей».
function backLinkBlock() {
  return `<button class="link-btn panel-back" id="panelBack" type="button">← Назад</button>`;
}

// Экран «Параметры модуля»: название/габариты/конструктив/секции активного
// модуля. Показывается только когда есть выбранный модуль.
function moduleFieldsBlock(mod) {
  return `
    <div class="field">
      <label>Название модуля</label>
      <input id="m-name" type="text" value="${esc(mod.name)}">
    </div>

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
    ${mod.baseType === 'legsPlinth' ? `
    <div class="field-row">
      <div class="field">
        <label>Тип опоры</label>
        <div class="hint">кухонная (пластик, держит цоколь клипсой — у металлической клипсы нет)</div>
      </div>
    </div>` : ''}


    <div class="field checkbox-field">
      <label><input id="m-corner" type="checkbox" ${mod.corner ? 'checked' : ''}> Угловой — дальше ряд идёт под 90°</label>
    </div>

    <h3>${esc(mod.name)} — секции</h3>
    <div id="sectionsList"></div>
    <button class="add-section-btn" id="addSection" type="button">+ Добавить секцию</button>`;
}

// Экран «Деталь»: открывается кликом по боковине внутри изолированного в 3D
// модуля (viewer.onSelectPart). Пилотная реализация только для боковины —
// не общий фреймворк на все виды деталей (см. Этап 3 плана). Инпут — тот же
// самый, что и в «Конструктиве модуля» (id m-leftSide/m-rightSide), просто
// показан отдельно: существующий обработчик в bindPanelEvents() слушает эти
// id и продолжает работать без изменений, где бы они ни были отрисованы.
function partBlock(mod) {
  const part = state.selectedPart;
  const isLeft = part.side === 'left';
  const label = isLeft ? 'левая' : 'правая';
  const cur = isLeft ? mod.leftSide : mod.rightSide;
  const selectId = isLeft ? 'm-leftSide' : 'm-rightSide';
  // «Видимая» боковина читается из уже ПОСЧИТАННОЙ модели, а не пересчитывается
  // здесь заново — единый источник истины остаётся engine.js (см. buildModel:
  // боковина получает facadeType: 'sidePanel', когда она видима и режется
  // в декоре фасада). Если формула видимости в engine.js когда-нибудь
  // изменится, эта панель не должна тихо разойтись с ней.
  const sideName = isLeft ? 'Боковина левая' : 'Боковина правая';
  const rows = (currentModel && currentModel.partsRaw) || [];
  const row = rows.find((r) => r.module === mod.name && r.kind === 'side'
    && r.name && r.name.indexOf(sideName) === 0);
  const visible = !!(row && row.facadeType === 'sidePanel');
  return `
    ${backLinkBlock()}
    <h3>Боковина ${label}</h3>
    <div class="field">
      <label>Конструктив</label>
      <select id="${selectId}">${sideOptions(cur)}</select>
    </div>
    ${visible ? `
    <div class="hint">Эта боковина видимая — режется в декоре фасада.</div>
    <button class="link-btn" id="partToFacadeDecor" type="button">Изменить декор фасада →</button>` : ''}`;
}

// Заглушка экрана «Деталь», когда на него перешли с рейки напрямую (кнопка
// «Деталь»), а не кликом по боковине в изолированном модуле — редактировать
// пока нечего, но и откатывать на другой экран не нужно: рейка должна вести
// именно сюда. Полноценный редактор геометрии (вырезы/пазы) — задача другого
// этапа, здесь только подсказка, как выбрать деталь для редактирования.
function partPlaceholderBlock() {
  return `
    ${backLinkBlock()}
    <h3>Деталь</h3>
    <div class="hint">Чтобы отредактировать деталь: дважды кликните по модулю в 3D-сцене,
    затем кликните по нужной детали (пока поддерживается только боковина).</div>`;
}

// Экран «Материалы»: общие на весь проект декор/толщины/фурнитура —
// не привязаны к конкретному модулю.
function materialsBlock() {
  return `
    <h3>Материалы (общие на проект)</h3>
    <div class="field">
      <label>Декор корпуса</label>
      <select id="p-decor">${DECORS.map(d => `<option value="${d.code}" ${d.code === state.decorCode ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
    </div>
    <div class="field">
      <label>Декор фасада</label>
      <select id="p-facadeDecor">${DECORS.map(d => `<option value="${d.code}" ${d.code === state.facadeDecorCode ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
      <div class="hint">Видимая боковина (до пола или сбоку дна) режется в этом декоре</div>
    </div>
    <div class="field-row">
      <div class="field"><label>Толщина ЛДСП</label><input id="p-bodyThickness" type="number" value="${state.bodyThickness}"></div>
      <div class="field"><label>Толщина ХДФ</label><input id="p-backThickness" type="number" value="${state.backThickness}"></div>
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

    <h4 class="mat-sub">Ящики (материал отдельно от корпуса)</h4>
    <div class="field">
      <label>Декор ящиков</label>
      <select id="p-drawerDecor">${DECORS.map(d => `<option value="${d.code}" ${d.code === state.drawerDecorCode ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
    </div>
    <div class="field-row">
      <div class="field"><label>Толщина ЛДСП ящиков</label><input id="p-drawerThickness" type="number" step="1" value="${state.drawerThickness}"></div>
      <div class="field"><label>&nbsp;</label><input type="text" value="—" disabled></div>
    </div>
    <div class="field">
      <label>Система ящиков (на весь проект)</label>
      <select id="p-drawerSystem">
        ${DRAWER_SYSTEM_ORDER.map(id =>
          `<option value="${id}" ${id === state.drawerSystem ? 'selected' : ''}>${esc(DRAWER_SYSTEMS[id].name)}</option>`
        ).join('')}
      </select>
    </div>
    <div class="field">
      <label>Тип соединения корпуса</label>
      <select id="p-joint">
        <option value="confirmat" ${state.jointType === 'confirmat' ? 'selected' : ''}>Конфирмат</option>
        <option value="minifix" ${state.jointType === 'minifix' ? 'selected' : ''}>Эксцентриковая стяжка</option>
        <option value="dowel" ${state.jointType === 'dowel' ? 'selected' : ''}>Шкант</option>
      </select>
    </div>`;
}

function renderParamsPanel() {
  const panel = document.getElementById('paramsPanel');
  if (state.activeModule >= state.modules.length) state.activeModule = state.modules.length - 1;
  if (state.activeModule < 0) state.activeModule = 0;
  const mod = state.modules[state.activeModule];

  // Экран «Параметры модуля» имеет смысл только когда модуль есть — пустой
  // проект (или потеря последнего модуля) откатывает на базу. Так же ведёт
  // себя переход на этот экран напрямую с рейки (setPanelView('module')) —
  // это ожидаемый fallback, а не баг.
  if (state.panelView === 'module' && !mod) state.panelView = 'library';
  // Экран «Деталь» показывает содержимое только пока жива изоляция и выбрана
  // боковина ИМЕННО активного модуля — если модуль пропал, выбор детали
  // устарел (сброс изоляции и т.п.), или деталь принадлежит другому модулю
  // (доп. защита поверх exitIsolation() на случай рассинхронизации),
  // откатываем на параметры модуля (или на базу, если и модуля не осталось).
  // Но если выбора детали просто ещё НЕ было (пришли на экран прямо с
  // кнопки рейки «Деталь») — с экрана не уходим, а показываем заглушку-
  // подсказку ниже (см. partPlaceholderBlock).
  if (state.panelView === 'part' && state.selectedPart && (!mod
      || state.selectedPart.kind !== 'side' || state.selectedPart.module !== mod.name)) {
    state.panelView = mod ? 'module' : 'library';
  }

  let screen;
  if (state.panelView === 'materials') {
    screen = backLinkBlock() + materialsBlock();
  } else if (state.panelView === 'part') {
    screen = state.selectedPart ? partBlock(mod) : partPlaceholderBlock();
  } else if (state.panelView === 'module') {
    screen = moduleFieldsBlock(mod);
  } else {
    // 'library' (и любое неизвестное/начальное значение)
    screen = libraryBlock() + (!mod
      ? `<div class="hint">Проект пуст. Выберите готовый модуль в базе выше или добавьте свой кнопкой «+».</div>`
      : '');
  }

  panel.innerHTML = moduleTabsBlock(mod) + screen;

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

function renderSectionsList() {
  const mod = state.modules[state.activeModule];
  const list = document.getElementById('sectionsList');
  if (!mod || !list) return;      // пустой проект — секций нет

  list.innerHTML = mod.sections.map((sec, i) => {
    const drawerBlock = sec.drawers > 0 ? `
      <div class="sub">
        <label>Высота ящика от дна, мм</label>
        <div class="mini-row"><input type="number" step="10" min="10" value="${drawerOffsetOf(sec)}" data-field="drawerOffset" data-idx="${i}"></div>
        <label class="mt6 checkbox-inline"><input type="checkbox" data-field="pushToOpen" data-idx="${i}" ${sec.pushToOpen ? 'checked' : ''}> Push-to-open (без ручек)</label>
        <label class="mt6">Высота короба (царги)</label>
        <select data-field="drawerBoxHeight" data-idx="${i}">
          <option value="auto" ${(sec.drawerBoxHeight || 'auto') === 'auto' ? 'selected' : ''}>подобрать автоматически</option>
          ${(DRAWER_SYSTEMS[state.drawerSystem] || {}).heights
            ? DRAWER_SYSTEMS[state.drawerSystem].heights.map((h) =>
                `<option value="${h.code}" ${sec.drawerBoxHeight === h.code ? 'selected' : ''}>${h.code} — ${h.h} мм${h.reling ? ', с релингом' : ''} (фасад от ${h.minFront})</option>`).join('')
            : ''}
        </select>
        <div class="hint">Просвет над верхним коробом — не менее 25 мм.</div>

        <label class="mt6">Высоты фасадов ящиков</label>
        <select data-field="drawerMode" data-idx="${i}">
          <option value="auto" ${sec.drawerMode !== 'manual' ? 'selected' : ''}>распределить автоматически</option>
          <option value="manual" ${sec.drawerMode === 'manual' ? 'selected' : ''}>задать вручную</option>
        </select>
        ${sec.drawerMode === 'manual' ? `
        <label class="mt6">Высота фасада каждого ящика, мм <span class="dim">(сверху вниз)</span></label>
        <div class="mini-row">
          ${Array.from({ length: sec.drawers }, (_, k) => {
            // Поля идут СВЕРХУ ВНИЗ, как на самой мебели. В модели ящики
            // считаются снизу, поэтому индекс разворачиваем — иначе правка
            // «верхнего» уходила в нижний ящик.
            const d = sec.drawers - 1 - k;
            const pinned = !!(sec.drawerPinned && sec.drawerPinned[d]);
            return `<input type="number" step="10" min="50" value="${manualHeights(i, sec)[d]}"
                    class="${pinned ? 'pinned' : ''}" data-drawer="${d}" data-idx="${i}"
                    title="${k === 0 ? 'Верхний ящик' : (k === sec.drawers - 1 ? 'Нижний ящик' : 'Ящик ' + (k + 1) + ' сверху')}${pinned ? ' — задан вручную, автоматически не меняется' : ' — подстраивается автоматически'}">`;
          }).join('')}
        </div>
        <div class="hint">Сумма высот равна фронту секции: правите один ящик — остаток
          разбирают только те, что ещё не задавали вручную.</div>
        <div class="hint">Заданный вручную ящик выделяется и больше не меняется автоматически —
          остаток разбирают только незафиксированные.
          <button type="button" class="link-btn" data-unpin="${i}">сбросить фиксацию</button></div>` : ''}
      </div>` : '';

    const ftId = sec.facadeType || 'ldsp';
    const ftInfo = FACADE_TYPES[ftId] || FACADE_TYPES.ldsp;
    const glassBlock = (sec.facade === 'open' && !sec.drawers) ? '' : `
      <div class="sub">
        <label>Материал фасада</label>
        <select data-field="facadeType" data-idx="${i}">
          ${FACADE_TYPE_ORDER.map((id) => `<option value="${id}" ${ftId === id ? 'selected' : ''}>${esc(FACADE_TYPES[id].name)}</option>`).join('')}
        </select>
        <div class="hint">${ftInfo.thickness} мм${ftInfo.glassInside ? ' · полки в секции — стекло 6 мм на держателях с силиконовой пяткой' : ''}</div>
      </div>`;

    const handleBlock = sec.facade === 'open' && !sec.drawers ? '' : `
      <div class="sub">
        <label>Ручки</label>
        <select data-field="handle" data-idx="${i}">
          ${HANDLE_ORDER.map((id) => `<option value="${id}" ${sec.handle === id ? 'selected' : ''}>${esc(HANDLES[id].name)}</option>`).join('')}
        </select>
        ${(HANDLES[sec.handle] || {}).holes === 2 && sec.facade !== 'open' ? `
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

    const liftBlock = sec.facade === 'liftUp' ? `
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

    const shelfBlock = sec.shelves > 0 ? `
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

    return `
      <div class="section-card">
        <div class="section-card-title">
          <span>${esc(mod.name)} · Секция ${i + 1}</span>
          ${mod.sections.length > 1 ? `<button class="remove-section" data-remove="${i}" type="button">убрать</button>` : ''}
        </div>
        <div class="field-row">
          <div class="field"><label>Полки, шт</label><input type="number" min="0" max="12" value="${sec.shelves}" data-field="shelves" data-idx="${i}"></div>
          <div class="field"><label>Ящики, шт</label><input type="number" min="0" max="8" value="${sec.drawers}" data-field="drawers" data-idx="${i}"></div>
        </div>
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
        <div class="field">
          <label>Фасад</label>
          <select data-field="facade" data-idx="${i}">
            <option value="doorLeft" ${(sec.facade === 'doorLeft' || sec.facade === 'doors1') ? 'selected' : ''}>Дверь левая</option>
            <option value="doorRight" ${sec.facade === 'doorRight' ? 'selected' : ''}>Дверь правая</option>
            <option value="doors2" ${sec.facade === 'doors2' ? 'selected' : ''}>Две двери</option>
          <option value="liftUp" ${sec.facade === 'liftUp' ? 'selected' : ''}>Открывание вверх</option>
            <option value="open" ${sec.facade === 'open' ? 'selected' : ''}>Без дверей</option>
          </select>
        </div>
        ${facadeWidthBlock}
        ${glassBlock}
        ${handleBlock}
        ${liftBlock}
        ${drawerBlock}
        ${shelfBlock}
        ${rodBlock}
      </div>`;
  }).join('');

  // поля секции
  list.querySelectorAll('[data-field]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const sec = mod.sections[Number(e.target.dataset.idx)];
      const f = e.target.dataset.field;
      sec[f] = (f === 'facade' || f === 'drawerSystem' || f === 'shelfMode'
                || f === 'widthMode' || f === 'drawerMode'
                || f === 'handle' || f === 'lift' || f === 'handleOrient'
                || f === 'drawerBoxHeight' || f === 'facadeType')
        ? e.target.value
        : (e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value));
      // Переход в ручной режим не должен обнулять ящики: фиксируем то, что
      // только что было распределено автоматически.
      if (f === 'drawerMode' && e.target.value === 'manual') {
        sec.drawerHeights = manualHeights(Number(e.target.dataset.idx), sec);
      }
      // Возврат в авторежим и смена количества ящиков снимают все фиксации.
      if ((f === 'drawerMode' && e.target.value !== 'manual') || f === 'drawers') {
        sec.drawerPinned = [];
        if (f === 'drawers') sec.drawerHeights = [];
      }
      if (f === 'drawerOffset') sec.drawerOffset = Math.max(MIN_LIFT, Number(e.target.value) || MIN_LIFT);
      // менялось количество/режим — перерисовываем блок, чтобы поля появились
      renderSectionsList();
      recompute();
    });
  });
  // высоты ящиков
  list.querySelectorAll('[data-drawer]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const si = Number(e.target.dataset.idx);
      const sec = mod.sections[si];
      sec.drawerHeights = redistributeDrawers(si, sec, Number(e.target.dataset.drawer), Number(e.target.value));
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
  list.querySelectorAll('[data-unpin]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const sec = mod.sections[Number(e.target.dataset.unpin)];
      sec.drawerPinned = [];
      sec.drawerHeights = [];
      sec.drawerMode = 'auto';
      renderSectionsList();
      recompute();
    });
  });
  list.querySelectorAll('[data-remove]').forEach((el) => {
    el.addEventListener('click', (e) => {
      mod.sections.splice(Number(e.target.dataset.remove), 1);
      renderSectionsList();
      recompute();
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
      state.drawerDecorCode = white.code;
    }
  }
  insertModule(m);
}

// Контекстное меню модуля: поворот вокруг вертикальной оси и удаление.
// Вызывается правой кнопкой по вкладке модуля в левом верхнем углу панели.
// Подписи соответствуют фактическому развороту деталей в модели
// (проверяется в tools/geometry.js): 90° уводит фасад ВПРАВО, 270° — ВЛЕВО.
const ROTATIONS = [
  [0,   'без поворота — фасад вперёд'],
  [90,  'на 90° — фасад вправо'],
  [180, 'на 180° — фасад назад'],
  [270, 'на 270° — фасад влево'],
];

function closeModuleMenu() {
  const old = document.getElementById('moduleMenu');
  if (old && old.remove) old.remove();
}

function showModuleMenu(modIndex, x, y) {
  closeModuleMenu();
  const mod = state.modules[modIndex];
  if (!mod) return;
  const cur = Number(mod.rotation) || 0;

  const menu = document.createElement('div');
  menu.id = 'moduleMenu';
  menu.className = 'ctx-menu';
  menu.style.left = Math.round(x) + 'px';
  menu.style.top = Math.round(y) + 'px';
  menu.innerHTML = `
    <div class="ctx-title">${esc(mod.name)}</div>
    <div class="ctx-group">Повернуть</div>
    ${ROTATIONS.map(([deg, label]) =>
      `<button type="button" class="ctx-item ${deg === cur ? 'on' : ''}" data-rot="${deg}">${label}</button>`
    ).join('')}
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item danger" data-del="1"
      title="${state.modules.length <= 1 ? 'В проекте должен остаться хотя бы один модуль' : ''}"
      >Удалить модуль</button>`;
  document.body.appendChild(menu);

  menu.querySelectorAll('[data-rot]').forEach((el) => {
    el.addEventListener('click', () => {
      mod.rotation = Number(el.dataset.rot) || 0;
      closeModuleMenu();
      renderParamsPanel();
      recompute();
    });
  });
  menu.querySelectorAll('[data-del]').forEach((el) => {
    el.addEventListener('click', () => {
      closeModuleMenu();
      deleteModule(modIndex);
    });
  });
}

// База модулей внутри панели: клик по кнопке категории открывает/закрывает
// под ней сетку миниатюр её пресетов, клик по миниатюре добавляет модуль.
// Общая для обеих веток bindPanelEvents() (пустой проект и проект с модулями).
function bindLibraryEvents() {
  document.querySelectorAll('.lib-cat').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const cat = b.dataset.cat;
      // Повторный клик по уже открытой категории — закрыть; клик по другой —
      // переключить; сетка одной категории видна за раз.
      state.libraryOpenCat = state.libraryOpenCat === cat ? null : cat;
      renderParamsPanel();
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
  on('panelBack', 'click', () => setPanelView(state.selected ? 'module' : 'library'));
  // Экран «Деталь» → быстрый переход к полю, которое красит видимую боковину.
  on('partToFacadeDecor', 'click', () => setPanelView('materials'));

  // Без модулей в панели есть только база и «+» — остальные поля не отрисованы,
  // и обращаться к полям несуществующего модуля нельзя.
  if (!mod) {
    bindLibraryEvents();
    on('addModule', 'click', () => insertModule(newModule()));
    on('undoBtn', 'click', undo);
    on('redoBtn', 'click', redo);
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
  // База модулей: категория → сетка миниатюр под ней
  bindLibraryEvents();

  // Правая кнопка на вкладке модуля — меню с поворотом и удалением.
  document.querySelectorAll('.mod-tab').forEach((b) => {
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showModuleMenu(Number(b.dataset.mod), e.clientX || 0, e.clientY || 0);
    });
  });
  on('addModule', 'click', () => insertModule(newModule()));
  on('undoBtn', 'click', undo);
  on('redoBtn', 'click', redo);
  on('delModule', 'click', () => deleteModule(state.activeModule));
  updateHistoryButtons();

  on('m-name', 'change', (e) => {
    mod.name = e.target.value || 'Модуль';
    state.selected = mod.name;
    renderParamsPanel(); recompute();
  });
  on('m-width', 'change', (e) => { mod.width = Number(e.target.value); recompute(); });
  on('m-height', 'change', (e) => { mod.height = Number(e.target.value); recompute(); });
  on('m-depth', 'change', (e) => { mod.depth = Number(e.target.value); recompute(); });
  on('m-leftSide', 'change', (e) => { mod.leftSide = e.target.value; recompute(); });
  on('m-rightSide', 'change', (e) => { mod.rightSide = e.target.value; recompute(); });
  on('m-corner', 'change', (e) => { mod.corner = e.target.checked; recompute(); });
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
    if (mod.baseType === 'plinth') mod.plinthHeight = v; else mod.legHeight = v;
    recompute();
  });

  on('p-decor', 'change', (e) => { state.decorCode = e.target.value; recompute(); });
  on('p-facadeDecor', 'change', (e) => { state.facadeDecorCode = e.target.value; recompute(); });
  on('p-worktop', 'change', (e) => { state.worktopDepth = Number(e.target.value) || 0; recompute(); });
  on('p-back', 'change', (e) => { state.backCode = e.target.value; recompute(); });
  on('p-bodyThickness', 'change', (e) => { state.bodyThickness = Number(e.target.value); recompute(); });
  on('p-backThickness', 'change', (e) => { state.backThickness = Number(e.target.value); recompute(); });
  on('p-drawerDecor', 'change', (e) => { state.drawerDecorCode = e.target.value; recompute(); });
  on('p-drawerThickness', 'change', (e) => { state.drawerThickness = Number(e.target.value) || 16; recompute(); });
  on('p-joint', 'change', (e) => { state.jointType = e.target.value; recompute(); });
  on('p-drawerSystem', 'change', (e) => { state.drawerSystem = e.target.value; recompute(); });

  on('addSection', 'click', () => {
    mod.sections.push(newSection());
    renderSectionsList();
    recompute();
  });
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
    decor: DECORS.find(d => d.code === state.decorCode),
    facadeDecor: DECORS.find(d => d.code === state.facadeDecorCode) || DECORS.find(d => d.code === state.decorCode),
    backMaterial: BACK_MATERIALS.find(d => d.code === state.backCode),
    drawerDecor: DECORS.find(d => d.code === state.drawerDecorCode),
    drawerThickness: state.drawerThickness,
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
      sections: m.sections.map(sc => Object.assign({}, sc, { drawerSystem: state.drawerSystem })),
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
  return {
    hideFacades: state.hideFacades,
    drillCheck: state.drillCheck,
    drillFilter: state.drillFilter,
    // Пока идёт изоляция, подсветку синим отключаем — изолированный модуль
    // и так выделен тем, что остальные притушены, а подсветка мешала бы
    // видеть его настоящую текстуру (см. Этап 3 плана).
    highlightModule: state.isolatedModule ? null : state.selected,
    isolateModule: state.isolatedModule,
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

function renderDetailingTable(model) {
  const el = document.getElementById('tab-detailing');
  // Ножки — фурнитура, а не деталь из листа: в деталировку не попадают,
  // их количество считается в спецификации.
  const rows = model.parts.filter(r => !r.hardware).map(r => `
    <tr>
      <td>${r.num}</td>
      <td>${esc(r.module || '')}</td>
      <td>${esc(r.name)}</td>
      <td>${esc(r.section)}</td>
      <td>${esc(materialName(r.material))}, ${r.thickness} мм</td>
      <td>${r.length}</td>
      <td>${r.width}</td>
      <td>${r.qty}</td>
      <td>${r.edging.long1 || '—'}</td>
      <td>${r.edging.long2 || '—'}</td>
      <td>${r.edging.short1 || '—'}</td>
      <td>${r.edging.short2 || '—'}</td>
      <td>${r.grainDirection ? 'да' : 'нет'}</td>
      <td>${esc(r.note || '')}</td>
    </tr>`).join('');
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

  el.innerHTML =
    section('1. Листовые материалы', sheetRows, ['№', 'Позиция', 'Артикул', 'Площадь', 'Листов', 'Цена, ₽', 'Сумма, ₽']) +
    section('2. Кромочный материал', edgeRows, ['№', 'Позиция', 'Кол-во', 'Цена, ₽/м', 'Сумма, ₽']) +
    section('3. Фурнитура', hwRows, ['№', 'Позиция', 'Артикул', 'Кол-во', 'Цена, ₽', 'Сумма, ₽']) +
    section(`4. Крепёж и метизы (${esc(spec.jointTypeLabel)})`, fRows, ['№', 'Позиция', 'Артикул', 'Кол-во', 'Цена, ₽', 'Сумма, ₽']) +
    `<div class="total-line">ИТОГО: ${spec.totalCost.toLocaleString('ru-RU')} ₽</div>`
    + drawerPassportHtml();
}

// ПАСПОРТ СИСТЕМЫ ЯЩИКОВ. Все числа, по которым считается короб, одной
// таблицей и с указанием источника: проверять расчёт по ней быстрее, чем
// искать координаты в 3D. Неподтверждённые значения выводятся отдельно —
// правило проекта: выдуманных размеров в модели быть не должно.
function drawerPassportHtml() {
  const { buildDrawerPassport } = window.Modul3D.specification || {};
  if (!buildDrawerPassport) return '';
  const pass = buildDrawerPassport(state.drawerSystem);
  if (!pass) return '';
  const rows = pass.rows.map((r) =>
    `<tr><td>${esc(r.name)}</td><td>${esc(String(r.value))}</td><td>${esc(r.note)}</td></tr>`).join('');
  const warn = pass.assumed.length
    ? `<div class="passport-warn">⚠ Не подтверждено документом: ${
      pass.assumed.map((a) => esc(a)).join('; ')}. Сверьте с инструкцией производителя.</div>`
    : '<div class="passport-ok">Все размеры взяты из документа производителя.</div>';
  return `<h4 class="spec-title">5. Паспорт системы ящиков</h4>${warn}
    <table><thead><tr><th>Параметр</th><th>Значение</th><th>Примечание</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
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
document.getElementById('exportDetailing').addEventListener('click', () => exportDetailing(currentModel));
document.getElementById('exportSpec').addEventListener('click', () => exportSpecification(currentSpec));

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
onClick('exportDrillCsv', () => {
  if (!currentModel || !currentModel.modules.length) { renderWarnings(['Проект пуст — присаживать нечего.']); return; }
  const n = window.Modul3D.cnc.drilledParts(currentModel).length;
  if (!n) { renderWarnings(['Ни на одной детали нет присадки: выберите ручки в секциях.']); return; }
  exportDrillCsv(currentModel);
});
onClick('exportDrillDxf', () => {
  if (!currentModel || !currentModel.modules.length) { renderWarnings(['Проект пуст — присаживать нечего.']); return; }
  const n = window.Modul3D.cnc.drilledParts(currentModel).length;
  if (!n) { renderWarnings(['Ни на одной детали нет присадки: выберите ручки в секциях.']); return; }
  exportDrillDxf(currentModel);
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
      if (!name) {                       // клик мимо модели — снять выделение и уйти к базе
        const changed = state.selected !== null || state.isolatedModule !== null;
        state.selected = null;
        state.panelView = 'library';
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

    // Клик по боковине ВНУТРИ уже изолированного модуля — открывает экран
    // «Деталь». Состав деталей от этого не меняется, сцену перерисовывать
    // не нужно — достаточно панели.
    viewer.onSelectPart = ({ module, kind, side }) => {
      state.selectedPart = { module, kind, side };
      state.panelView = 'part';
      renderParamsPanel();
    };
  }
}

// ---------------------------------------------------------------------------
// Эскиз → 3D (Claude Vision)
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
    const apiKey = (document.getElementById('apiKey').value || '').trim();
    if (!selectedSketchFile) { setSketchStatus('Сначала выберите файл эскиза.', 'error'); return; }
    recognizeBtn.disabled = true;
    setSketchStatus('Распознаём эскиз через Claude…', '');
    try {
      const r = await recognizeSketch(selectedSketchFile, apiKey);
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

      const decorNote = r.decorHint && !decorCode
        ? ` Декор «${r.decorHint}» не найден в справочнике — поправьте вручную.` : '';
      setSketchStatus(`Готово, параметры применены к модулю «${mod.name}» — проверьте их.${r.notes ? ' ' + r.notes : ''}${decorNote}`, 'ok');
    } catch (err) {
      console.error('Sketch recognition failed:', err);
      setSketchStatus('Ошибка: ' + err.message, 'error');
    } finally {
      recognizeBtn.disabled = false;
    }
  });

  const apiKeyToggle = document.getElementById('apiKeyToggle');
  const apiKeyPopover = document.getElementById('apiKeyPopover');
  const apiKeyInput = document.getElementById('apiKey');
  const savedKey = localStorage.getItem('basisApiKey');
  if (savedKey) apiKeyInput.value = savedKey;
  apiKeyToggle.addEventListener('click', () => {
    apiKeyPopover.style.display = apiKeyPopover.style.display === 'none' ? 'block' : 'none';
  });
  apiKeyInput.addEventListener('input', () => localStorage.setItem('basisApiKey', apiKeyInput.value.trim()));

  document.addEventListener('click', (e) => {
    if (!popover.contains(e.target) && e.target !== uploadBtn) popover.style.display = 'none';
    if (!apiKeyPopover.contains(e.target) && e.target !== apiKeyToggle) apiKeyPopover.style.display = 'none';
  });
  popover.addEventListener('click', (e) => e.stopPropagation());
  apiKeyPopover.addEventListener('click', (e) => e.stopPropagation());
}

// Мост для ui-shell.js: кнопка «Материалы» (боковая полоса, HUD) переключает
// экран панели, не зная её внутреннего устройства.
window.Modul3D.app = { setPanelView: setPanelView };

// ---------------------------------------------------------------------------
// Запуск
// ---------------------------------------------------------------------------
try {
  document.title = `Modul3D ${APP_VERSION} — конструктор мебели`;
  const verEl = document.getElementById('appVersion');
  if (verEl) verEl.textContent = APP_VERSION;

  renderParamsPanel();
  recompute();
  offerAutosaveRestore();
  initSketchPanel();
  initHeaderControls();
  // Контекстное меню модуля закрывается кликом мимо и по Esc
  document.addEventListener('click', closeModuleMenu);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeModuleMenu();
    // Esc — ещё и штатный выход из режима изоляции модуля (Этап 3 плана).
    if (state.isolatedModule) {
      exitIsolation();
      state.panelView = state.selected ? 'module' : 'library';
      renderParamsPanel();
      if (viewer && currentModel) viewer.render(currentModel, viewOpts());
    }
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
  updateHistoryButtons();
} catch (err) {
  console.error('App init failed:', err);
  document.getElementById('paramsPanel').innerHTML =
    `<div style="color:#a33;font-size:13px;padding:8px">Ошибка запуска: ${esc(err.message)}. Откройте консоль (F12) для деталей.</div>`;
}
})();
