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
const APP_VERSION = 'v251';

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

// EDGE_FRONT/EDGE_BACK/EDGE_MID — три фиксированных названия кромки
// (совпадают с ключами каталога EDGE_PRICES), которыми ВЕСЬ engine.js
// проставляет присадку по умолчанию (см. libDeleteSelectedRow ниже — эти
// три позиции нельзя удалить из каталога, иначе часть деталей молча
// осталась бы без учтённой кромки в стоимости).
const { buildModel, EDGE_FRONT, EDGE_BACK, EDGE_MID } = window.Modul3D.engine;
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
    shelves: 3, drawers: 0, facade: 'doorLeft', handle: 'bow160',
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
    baseType: 'legsPlinth', plinthHeight: 100, legHeight: 100, legType: 'kitchen',
    family: 'custom',                   // 'kitchen' — кухонный, у него нет штанги
    topType: 'panel', railWidth: 100,   // верх: цельная крышка или две планки
    corner: false,      // угловой: после него ряд поворачивает на 90°
    rotation: 0,        // поворот вокруг вертикальной оси: 0/90/180/270°
    sections: [newSection()],
    activeSection: 0,   // какая вкладка секции сейчас раскрыта (renderSectionsList)
  };
}
// Симметричная навеска фасадов: левая половина секций модуля открывается
// влево, правая — вправо (единственная секция — всегда влево). Перезаписывает
// sec.facade у ВСЕХ секций модуля по позиции — вызывать сразу после
// добавления/удаления секции, до renderSectionsList()/recompute(). Отдельные
// дверные зоны секции (sec.doorZones[].facade) этим правилом не затрагиваются.
function rebalanceSectionFacades(mod) {
  const n = mod.sections.length;
  if (n === 1) { mod.sections[0].facade = 'doorLeft'; return; }
  mod.sections.forEach((sec, i) => {
    sec.facade = i < Math.floor(n / 2) ? 'doorLeft' : 'doorRight';
  });
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
  // Способ соединения столешниц в угловом (Г-образном) стыке между тумбами —
  // общий на проект, настраивается на панели «Столешница» (см.
  // countertopPanelBlock ниже). Прямые стыки в линию всегда идут через
  // стяжку автоматически, это переключает только угол; читает engine.js
  // (joinCountertopSeams) как proj.countertopCornerJoint.
  countertopCornerJoint: 'strip',
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
  // Свёрнутость узлов дерева категорий вкладки «Материалы» (см.
  // libNodeHtml/libToggleNode/libIsNodeCollapsed ниже) — ключ узла:
  // topCode + '::' + path.join('::'), path — item.categoryPath (или его
  // префикс) на глубине узла, считая от 1: { 'sheet::ДСП': false,
  // 'sheet::ДСП::Egger': true, ... }. Значение true/false — явно свёрнут/
  // развёрнут. Отсутствие записи = СВЁРНУТ — при первом входе на вкладку
  // видно только сами узлы дерева, без их содержимого (пользователь
  // раскрывает нужное кликами). Узел глубины 0 (сама верхнеуровневая
  // категория — «Листовые материалы» и т.п.) в этой карте не участвует —
  // она никогда не прячется целиком, только раскрывает/прячет своих детей,
  // см. state.libCatOpen ниже. Чисто UI-состояние, как libraryTab выше: в
  // историю отмены/файл проекта не попадает.
  libCollapsed: {},
  // Показаны ли дочерние узлы ПЕРВОГО уровня верхнеуровневой категории
  // («Листовые материалы»/«Материалы фасадов»/«Кромка»/«Стекло», см.
  // libTopCategoryHtml) — { sheet: false, facade: false, edge: false, glass:
  // false }. Отдельно от libCollapsed выше по той же причине (см. коммент
  // там): сама категория не сворачивается как единое целое, только кликом
  // раскрывает/прячет прямых детей. Отсутствие записи = false (свёрнуто) —
  // то самое «при первом входе видно только название категории». Чисто
  // UI-состояние, сессионное.
  libCatOpen: {},
  // «Фокус» на одном листе дерева одной верхнеуровневой категории (см.
  // libTopCategoryHtml/libLeafTableHtml) — { sheet: 'ДСП::Egger', ... }:
  // путь листа (join('::')) или отсутствие ключа/null — фокуса нет, дерево
  // показывается целиком (с учётом libCollapsed выше). Клик по листу
  // включает фокус (прячет всю остальную структуру категории, показывает
  // только этот лист и его таблицу), повторный клик по нему же снимает
  // фокус. Чисто UI-состояние, сессионное.
  libActiveLeaf: {},
  // Пустые узлы-«заглушки» дерева категорий, которые пользователь завёл
  // значком «+» (см. libAddChildNode), но ещё не добавил в них ни одной
  // позиции каталога — { sheet: [['Пластик']], facade: [], edge: [], glass:
  // [] }: массив ПУТЕЙ (путь — массив строк, тот же формат, что и
  // item.categoryPath) по коду верхнеуровневой категории. Как только в
  // таком узле появляется хотя бы одна реальная позиция каталога (см.
  // libAddRow), путь и так виден в дереве по данным (libChildSegments) —
  // запись здесь только не даёт ПУСТОМУ узлу пропасть из панели, пока в
  // него не добавили ни одного материала. Заменяет прежний
  // state.libExtraSubcats (был только один уровень вложенности —
  // subcategory). Чисто UI-состояние, как libCollapsed выше: в историю
  // отмены/файл проекта не попадает.
  libExtraNodes: { sheet: [], facade: [], edge: [], glass: [] },
  // Режим подбора материала из «Параметры проекта» (кнопка «+ Добавить
  // материал» у Материал корпуса/Материал фасада/Задняя стенка, см.
  // materialPickActionsHtml/openMaterialPicker) — { role: 'decor' | 'facadeDecor'
  // | 'back' } или null, когда подбор не идёт. Пока не пуст, вкладка
  // «Библиотека → Материалы» рисует у каждой строки «Листовых материалов»
  // дополнительную кнопку «Выбрать» (см. libRowHtml/libPickMaterial).
  // Чисто UI-состояние, как libraryTab выше: в историю отмены/файл проекта
  // не попадает.
  libPickTarget: null,
  // Единица, в которой показана колонка «Цена» ВО ВСЕХ таблицах вкладки
  // «Материалы» одновременно (общий переключатель, выбирается прямо в шапке
  // любой из таблиц, см. libPriceUnitHeaderHtml) — 'native' (по умолчанию)
  // или один из 'perMeter' | 'perPiece' | 'perM2' | 'perSheet' (см.
  // libPriceValueForUnit). 'native' — «как на сайте»: показывает цену в
  // РОДНОЙ единице конкретной позиции (см. libNativeUnitsOf/
  // libPriceEffectiveUnit) — ровно то число, что лежит в её catalog-поле,
  // без пересчёта; у разных позиций это может быть разная единица (лист vs
  // пог.метр). Остальные четыре — принудительный пересчёт ВСЕХ позиций в
  // одну и ту же единицу, ручной выбор пользователя для сравнения
  // материалов между собой (см. libPricePerM2) — реальная стоимость проекта
  // в спецификации всё равно считается по своим правилам (за лист/
  // пог.метр), эта колонка их не подменяет. Чисто UI-состояние, как
  // libraryTab выше: в историю отмены/файл проекта не попадает.
  libPriceUnit: 'native',
  // Свёрнутость колонок Длина/Ширина/Толщина («± характеристики», см.
  // libTableHead/libLeafTableHtml) — ОБЩАЯ на всю Библиотеку (как
  // libPriceUnit выше), а не своя у каждой открытой таблицы: одна и та же
  // кнопка в любой из одновременно открытых таблиц сворачивает/разворачивает
  // их все разом — цель именно в этом (высвободить место под 3D-сцену, а не
  // сравнивать таблицы между собой в разных режимах). Чисто UI-состояние,
  // сессионное.
  libCharsCollapsed: false,
  // Строка таблицы материалов, выделенная кликом (см. libRowHtml/
  // initLibraryPanel) — { group, key } или null. group/key — то же, что
  // читает libFindItem (group — истинное происхождение позиции: decors/
  // back/facade/edge/countertop, key — it.code или, у кромки, it.key).
  // Используется кнопкой «− Удалить материал» под таблицей (см.
  // libDeleteSelectedRow) — активна, только если выбранная строка
  // принадлежит именно этой таблице. Сбрасывается при переключении вкладки
  // Библиотеки и при фокусе на другом листе дерева (см. initLibraryPanel).
  // Чисто UI-состояние, в историю/файл проекта не попадает.
  libSelectedRow: null,
  // Текст в строке поиска по вкладкам модулей проекта (moduleTabsBlock,
  // поле видно только когда модулей больше 8 — см. там же). Чисто
  // UI-состояние, как libraryTab выше: в историю отмены/файл проекта не
  // попадает.
  moduleSearchQuery: '',
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

// ---------------------------------------------------------------------------
// Правки каталога материалов (панель «Библиотека → Материалы»): заводской
// снимок + восстановление — общий механизм и для отката к заводским
// настройкам (см. logoutBtn ниже), и для подгрузки правок, сохранённых на
// сервере (см. fetchAccount() и scheduleCatalogSave() в разделе «Аккаунт»
// ниже). ВАЖНО: DECORS/BACK_MATERIALS и window.Modul3D.catalog.* — это
// ссылки на массивы/объекты, захваченные ОДИН РАЗ при загрузке скрипта (см.
// деструктуризацию выше) — восстановление обязано мутировать их НА МЕСТЕ
// (как и libSaveEdit/libAddRow), а не переприсваивать, иначе весь остальной
// код, читающий голые идентификаторы DECORS/BACK_MATERIALS, не увидит
// изменений.
// ---------------------------------------------------------------------------
function snapshotCatalogCollections() {
  const cat = window.Modul3D.catalog;
  return {
    decors: JSON.parse(JSON.stringify(DECORS)),
    back: JSON.parse(JSON.stringify(BACK_MATERIALS)),
    facade: JSON.parse(JSON.stringify(cat.FACADE_MATERIALS)),
    edge: JSON.parse(JSON.stringify(cat.EDGE_PRICES)),
    glass: JSON.parse(JSON.stringify(cat.GLASS)),
    countertop: JSON.parse(JSON.stringify(cat.COUNTERTOP_MATERIALS || [])),
    libExtraNodes: JSON.parse(JSON.stringify(state.libExtraNodes)),
  };
}

// Заводской снимок каталога — снимается ОДИН раз при загрузке скрипта, до
// того как пользователь успеет что-либо отредактировать в «Библиотеке» и до
// первой попытки подгрузить сохранённые на сервере правки.
const CATALOG_DEFAULTS = snapshotCatalogCollections();

// Мутирует все шесть коллекций каталога + state.libExtraNodes из blob (той
// же формы, что CATALOG_DEFAULTS/snapshotCatalogCollections()) — источник
// blob может быть CATALOG_DEFAULTS (откат к заводским настройкам) или ответ
// сервера GET /catalog-overrides (подгрузка сохранённых правок).
function restoreCatalogFrom(blob) {
  if (!blob) return;
  const cat = window.Modul3D.catalog;
  if (blob.decors) { DECORS.length = 0; DECORS.push.apply(DECORS, blob.decors); }
  if (blob.back) { BACK_MATERIALS.length = 0; BACK_MATERIALS.push.apply(BACK_MATERIALS, blob.back); }
  if (blob.facade) {
    Object.keys(cat.FACADE_MATERIALS).forEach((k) => { delete cat.FACADE_MATERIALS[k]; });
    Object.assign(cat.FACADE_MATERIALS, blob.facade);
  }
  if (blob.edge) {
    Object.keys(cat.EDGE_PRICES).forEach((k) => { delete cat.EDGE_PRICES[k]; });
    Object.assign(cat.EDGE_PRICES, blob.edge);
  }
  if (blob.glass) {
    Object.keys(cat.GLASS).forEach((k) => { delete cat.GLASS[k]; });
    Object.assign(cat.GLASS, blob.glass);
  }
  if (blob.countertop) {
    if (!cat.COUNTERTOP_MATERIALS) cat.COUNTERTOP_MATERIALS = [];
    cat.COUNTERTOP_MATERIALS.length = 0;
    cat.COUNTERTOP_MATERIALS.push.apply(cat.COUNTERTOP_MATERIALS, blob.countertop);
  }
  if (blob.libExtraNodes) state.libExtraNodes = JSON.parse(JSON.stringify(blob.libExtraNodes));
}

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
    countertopCornerJoint: state.countertopCornerJoint,
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
  // Столешница включается сразу при добавлении напольной тумбы — раньше
  // нужно было отдельно зайти в панель «Столешница» и отметить чекбокс на
  // каждой новой тумбе вручную. Фиксированные дефолты (не наследование от
  // других тумб проекта — с 2026-09-06 у каждой тумбы своя, независимая
  // столешница, см. activeCountertopModule/countertopFieldsOf в app.js).
  // Два фильтра отсекают ложные срабатывания:
  //  - высота ≤1000 мм — пенал (во всю высоту гарнитура, ~2100 мм) тоже
  //    стоит на полу (moduleHasFloorBase это не различает), но столешница
  //    на уровне потолка не нужна;
  //  - baseType==='plinth' с plinthHeight===0 — это «Верхний» пресет
  //    (навесной, tier:'upper' в presets.js): mod() даёт baseType:'plinth'
  //    по умолчанию всем пресетам, у навесных явно обнулён только
  //    plinthHeight, а baseType они не переопределяют — по высоте (720 мм)
  //    его от нижней тумбы не отличить, а вот «цоколь нулевой высоты» у
  //    настоящей напольной тумбы не бывает (нет опоры вообще).
  const noRealSupport = m.baseType === 'plinth' && Number(m.plinthHeight) === 0;
  if (moduleHasFloorBase(m) && !noRealSupport && !m.countertop && Number(m.height) <= 1000) {
    m.countertop = {
      enabled: true,
      decorCode: defaultCountertopDecorCode(),
      overhangFront: defaultCountertopOverhangFront(m),
      overhangLeft: 0,
      overhangRight: 0,
    };
  }
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
  // findNeighborBottomZoneHeight читает currentModel.modules[mi].dims нового
  // соседа, а currentModel строится только внутри recompute(); до него dims
  // ещё не существует.
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
// «Редактировать →» в renderSectionsList(). Сама панель — отдельный
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
    // Запасной вариант (DECORS[0]/BACK_MATERIALS[0]) — на случай, если код
    // декора из сохранённого проекта/автосохранения устарел (каталог правят
    // отдельно от app.js, коды могут переименовать или убрать — так уже было
    // 2026-09-03). Без отката buildModel() падает на undefined.code и рвёт
    // всю инициализацию приложения (пустая библиотека, неработающие кнопки).
    decor: DECORS.find(d => d.code === state.decorCode) || DECORS[0],
    facadeDecor: DECORS.find(d => d.code === state.facadeDecorCode)
      || DECORS.find(d => d.code === state.decorCode) || DECORS[0],
    backMaterial: BACK_MATERIALS.find(d => d.code === state.backCode) || BACK_MATERIALS[0],
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
// opts.displayText — что показать вместо самого value (например, укороченное
// название столешницы, см. libCountertopShortName, или «—» для отсутствующего
// значения, см. libDashEditCell) — РЕАЛЬНОЕ значение для редактирования всё
// равно берётся из data-raw (см. startCellEdit), поэтому клик по такой ячейке
// открывает инпут с полным/настоящим значением, а не с тем, что нарисовано.
// opts.extraClass — доп. класс на <td> (см. .lib-char-col — тумблер
// «± характеристики», libIsCharsCollapsed).
function libEditCell(group, key, field, type, value, opts) {
  opts = opts || {};
  const raw = value == null ? '' : String(value);
  const shown = opts.displayText != null ? opts.displayText : raw;
  const cls = 'lib-edit-cell' + (opts.extraClass ? ' ' + opts.extraClass : '');
  return `<td class="${cls}" data-group="${esc(group)}" data-key="${esc(key)}" data-field="${field}" data-type="${type}" data-raw="${esc(raw)}">${esc(shown)}</td>`;
}

// Дефолт для колонок Длина/Ширина/Толщина (см. libRowHtml) — как обычная
// libEditCell, только вместо пустой ячейки при отсутствующем значении
// (бывает, например, у декора без указанной толщины) показывает «—».
function libDashEditCell(group, key, field, value, extraClass) {
  return libEditCell(group, key, field, 'number', value, { displayText: value == null ? '—' : undefined, extraClass });
}

// Дата ISO ('2026-09-03', см. catalog.js: CATALOG_SOURCE.lastSync) → русский
// формат ДД.ММ.ГГГГ. Разбор строки вручную, а не через new Date(), — чтобы
// не словить сдвиг на сутки из-за часового пояса браузера при дате без времени.
function formatDateRu(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || '');
}

// Подсказка о синхронизации цен с сайтом-источником (см. CATALOG_SOURCE в
// catalog.js) — выводится наверху вкладок «Материалы» и «Фурнитура».
function libSourceHint() {
  const src = window.Modul3D.catalog.CATALOG_SOURCE;
  if (!src || !src.site) return '';
  return `<p class="hint">Цены сверены с сайтом <a href="https://${esc(src.site)}" target="_blank" rel="noopener">${esc(src.site)}</a> · обновлено ${esc(formatDateRu(src.lastSync))}</p>`;
}

// Компактная ссылка-иконка на карточку товара у поставщика (item.sourceUrl,
// см. catalog.js) — только когда она есть в каталоге (не у всех позиций
// нашлось соответствие на сайте). Отдельная маленькая <td>, НЕ часть
// .lib-edit-cell: клик по ней должен открыть sourceUrl в новой вкладке, а не
// провалиться в делегированный обработчик инлайн-редактирования (см.
// initLibraryPanel → panel.addEventListener('click', ...) → startCellEdit) —
// closest('.lib-edit-cell') на этой ячейке не сработает, конфликта нет.
function libSourceLinkCell(item) {
  if (!item || !item.sourceUrl) return '<td class="lib-source-cell"></td>';
  return `<td class="lib-source-cell"><a class="lib-source-link" href="${esc(item.sourceUrl)}" target="_blank" rel="noopener" title="Открыть карточку товара на сайте поставщика">↗</a></td>`;
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

// ---------------------------------------------------------------------------
// Таблицы вкладки «Материалы» — дерево категорий ПРОИЗВОЛЬНОЙ глубины по
// полю item.categoryPath (массив строк — путь узла вниз от корня раздела,
// например ['ДСП', 'Egger'] у декора, ['ПВХ'] у кромки, ['Стекло'] у стекла).
// Узел — ВЕТКА, если под ним есть узлы глубже (см. libChildSegments), клик
// по ней разворачивает/сворачивает НЕПОСРЕДСТВЕННЫХ детей (аккордеон), сама
// ветка не исчезает. Узел — ЛИСТ, если глубже никто не заходит: в обычном
// режиме навигации показывает только своё название (см. libNodeHtml), клик
// по нему прячет всю остальную структуру дерева этой верхнеуровневой
// категории (кроме её заголовка) и показывает таблицу позиций, чей
// categoryPath точно равен пути листа (см. state.libActiveLeaf/
// libLeafTableHtml). Верхнеуровневый узел (сама категория — «Листовые
// материалы»/«Материалы фасадов»/«Кромка»/«Стекло») не сворачивается сам,
// только раскрывает/прячет своих детей (см. state.libCatOpen). Реальные
// каталожные item могут иметь путь РАВНЫЙ пути ветки (не только листа) —
// например позиция без бренда (categoryPath ['ДСП']), оказавшаяся в одной
// категории с брендованными декорами (categoryPath ['ДСП', 'Egger']),
// из-за чего 'ДСП' — ветка, но у неё самой тоже есть собственная позиция;
// такие «свои» позиции ветки показываются
// прямо под её строкой, когда она раскрыта (см. libNodeHtml), тем же
// рендерером таблицы, что и у листьев — умышленно без отдельного концепта.
// ---------------------------------------------------------------------------

// Записи { group, item } одной верхнеуровневой категории дерева — group у
// записи ИСТИННОЕ происхождение позиции (decors/back/facade/edge/glass),
// не обязательно совпадает с topCode объединённой категории «sheet» (см.
// SHEET_FACADE_SUBCATS ниже) — от него зависит, в какой массив каталога
// уйдёт правка инлайн-редактирования (см. libSaveEdit/libFindItem) и в какой
// массив попадёт новая позиция (см. libAddRow). 'edge' — единственная
// категория, где каталог хранит позиции объектом {имя → цена}, а не
// массивом: оборачиваем в тот же вид записи, it.key — имя-ключ объекта (сам
// объект своего ключа не знает).
function libTopEntries(topCode) {
  const cat = window.Modul3D.catalog;
  if (topCode === 'sheet') {
    const facadeAll = Object.values(cat.FACADE_MATERIALS);
    const facadeSheet = facadeAll.filter((it) => SHEET_FACADE_SUBCATS.indexOf((it.categoryPath || [])[0]) >= 0);
    return []
      .concat(DECORS.map((it) => ({ group: 'decors', item: it })))
      .concat(facadeSheet.map((it) => ({ group: 'facade', item: it })))
      .concat(BACK_MATERIALS.map((it) => ({ group: 'back', item: it })));
  }
  if (topCode === 'facade') {
    const facadeAll = Object.values(cat.FACADE_MATERIALS);
    return facadeAll
      .filter((it) => SHEET_FACADE_SUBCATS.indexOf((it.categoryPath || [])[0]) < 0)
      .map((it) => ({ group: 'facade', item: it }));
  }
  if (topCode === 'edge') {
    return Object.keys(cat.EDGE_PRICES).map((name) => ({ group: 'edge', item: Object.assign({ key: name }, cat.EDGE_PRICES[name]) }));
  }
  if (topCode === 'glass') return [{ group: 'glass', item: cat.GLASS }];
  if (topCode === 'countertop') {
    // COUNTERTOP_MATERIALS (catalog.js) не имеет поля categoryPath — в
    // отличие от decors/back/facade/edge/glass, здесь дерево строится не по
    // отдельному полю данных, а виртуально из уже существующих materialId/
    // brand (как и у decors/facade, второй уровень дерева — фирма): [ldsp38,
    // Kronospan] → ['ЛДСП 38мм постформинг', 'Kronospan'] и т.п. item —
    // мелкая копия (Object.assign), НЕ сама позиция каталога: та же техника,
    // что уже применена к 'edge' выше (Object.assign({ key: name }, ...)) —
    // инлайн-правки всё равно идут по it.code через libFindItem/libSaveEdit,
    // читающие исходный массив напрямую, а не эту копию, так что
    // редактирование остаётся рабочим.
    return (cat.COUNTERTOP_MATERIALS || []).map((it) => ({
      group: 'countertop',
      item: Object.assign({}, it, { categoryPath: [COUNTERTOP_MATERIAL_LABEL[it.materialId] || it.materialId, it.brand || 'Без бренда'] }),
    }));
  }
  return [];
}

// Все известные пути узлов категории — из реальных позиций каталога
// (item.categoryPath) + пустые заглушки, заведённые кнопкой «+» (см.
// state.libExtraNodes/libAddChildNode). Только на этих путях строится форма
// дерева (libChildSegments) — сама позиция каталога может лежать глубже или
// на любом уровне, форма дерева от этого не зависит.
function libAllPaths(topCode) {
  const fromItems = libTopEntries(topCode)
    .map((e) => (e.item && e.item.categoryPath) || [])
    .filter((p) => p.length);
  return fromItems.concat(state.libExtraNodes[topCode] || []);
}

// Прямые дочерние сегменты узла prefixPath (путь без топ-кода) — в порядке
// первого появления. Пустой результат = узел лист (см. libNodeHtml).
function libChildSegments(topCode, prefixPath) {
  const seen = [];
  libAllPaths(topCode).forEach((p) => {
    if (p.length <= prefixPath.length) return;
    for (let i = 0; i < prefixPath.length; i += 1) { if (p[i] !== prefixPath[i]) return; }
    const seg = p[prefixPath.length];
    if (seen.indexOf(seg) < 0) seen.push(seg);
  });
  return seen;
}

// Реальные позиции каталога, чей categoryPath ТОЧНО равен path (см.
// libLeafTableHtml — таблица листа, и libNodeHtml — «свои» позиции ветки,
// см. комментарий у HDF-8 выше).
function libEntriesAtPath(topCode, path) {
  return libTopEntries(topCode).filter((e) => {
    const p = (e.item && e.item.categoryPath) || [];
    return p.length === path.length && path.every((seg, i) => p[i] === seg);
  });
}

// Есть ли под path (включая сам path) хотя бы одна РЕАЛЬНАЯ позиция каталога
// — используется только для защиты от удаления непустого узла (см.
// libDeleteNode), плейсхолдеры (state.libExtraNodes) в расчёт не берём: их
// как раз можно удалять свободно.
function libNodeHasItems(topCode, path) {
  return libTopEntries(topCode).some((e) => {
    const p = (e.item && e.item.categoryPath) || [];
    return p.length >= path.length && path.every((seg, i) => p[i] === seg);
  });
}

// Ключ узла для state.libCollapsed (см. коммент у state выше) — только для
// depth ≥ 1, глубина 0 (сама категория) через state.libCatOpen отдельно.
function libNodeKey(topCode, path) {
  return topCode + '::' + path.join('::');
}
function libIsNodeCollapsed(topCode, path) {
  const v = state.libCollapsed[libNodeKey(topCode, path)];
  return v === undefined ? true : !!v;
}
function libToggleNode(topCode, path) {
  state.libCollapsed[libNodeKey(topCode, path)] = !libIsNodeCollapsed(topCode, path);
}

// Переименование СЕГМЕНТА пути на глубине узла path — у ВСЕХ реальных
// позиций каталога и плейсхолдеров, чей путь на этой глубине совпадает (тот
// же префикс до узла + тот же сегмент), см. значок ✎ в libTreeRowHtml.
// Мутирует item.categoryPath НА МЕСТЕ (тот же массив, что хранится в
// каталоге) — универсально для decors/back/facade/edge/glass, без привязки
// к конкретному массиву данных.
function libRenameNode(topCode, path, newName) {
  newName = (newName || '').trim();
  if (!newName) return;
  const depth = path.length;
  const prefix = path.slice(0, depth - 1);
  const oldSeg = path[depth - 1];
  const matches = (p) => p.length >= depth && prefix.every((seg, i) => p[i] === seg) && p[depth - 1] === oldSeg;
  libTopEntries(topCode).forEach((e) => {
    const p = e.item && e.item.categoryPath;
    if (p && matches(p)) p[depth - 1] = newName;
  });
  (state.libExtraNodes[topCode] || []).forEach((p) => { if (matches(p)) p[depth - 1] = newName; });
  scheduleCatalogSave();
}

// «+» узла дерева (не у самого глубокого листа — см. libTreeRowHtml) — та
// же логика подтверждения, что была у прежнего libAddSubcategory: prompt на
// название, пустой ввод — отмена, дубликат среди уже существующих ПРЯМЫХ
// детей (данные + плейсхолдеры) — alert и выход. Новый узел — пустая
// заглушка (см. state.libExtraNodes), сразу раскрываем родителя, чтобы он
// не потерялся среди свёрнутых.
function libAddChildNode(topCode, parentPath) {
  const name = (window.prompt('Название новой категории:') || '').trim();
  if (!name) return;
  const existing = libChildSegments(topCode, parentPath).map((s) => s.toLowerCase());
  if (existing.indexOf(name.toLowerCase()) >= 0) {
    window.alert('Категория с таким названием уже есть.');
    return;
  }
  if (!state.libExtraNodes[topCode]) state.libExtraNodes[topCode] = [];
  state.libExtraNodes[topCode].push(parentPath.concat([name]));
  if (!parentPath.length) state.libCatOpen[topCode] = true;
  else state.libCollapsed[libNodeKey(topCode, parentPath)] = false;
  scheduleCatalogSave();
  renderLibraryPanel();
}

// «×» узла дерева — если под ним (включая сам узел) есть хотя бы одна
// РЕАЛЬНАЯ позиция каталога (см. libNodeHasItems), ничего не удаляем и
// предупреждаем: правки каталога здесь без бэкенда, случайное стирание цен
// недопустимо. Иначе узел — чистый плейсхолдер (свой + все более глубокие,
// если под ним успели завести вложенные пустые категории) — просто убираем
// пути из state.libExtraNodes.
function libDeleteNode(topCode, path) {
  if (libNodeHasItems(topCode, path)) {
    window.alert('Сначала удалите или перенесите материалы из этой категории — в ней есть товары.');
    return;
  }
  const extra = state.libExtraNodes[topCode] || [];
  state.libExtraNodes[topCode] = extra.filter((p) => !(p.length >= path.length && path.every((seg, i) => p[i] === seg)));
  scheduleCatalogSave();
  renderLibraryPanel();
}

// Фильтр Длина/Ширина/Толщина таблиц Библиотеки раньше был отдельным набором
// плоских <select> (libFilterValues/LIB_FILTER_FIELD_DEFS/libFiltersHtml) —
// заменён 2026-09-11 на тот же поповер сортировки/фильтра, что и в
// «Деталировке» (кнопки-треугольники в шапке таблицы, см. libTableHead/
// openColumnFilterMenu), старый механизм убран целиком, не оставляя двух
// параллельных способов фильтрации.

// «Цена приближённая/ориентировочная — уточняйте у...» — ОДИН раз перед
// таблицей подкатегории, а не в каждой строке (см. item.priceNote в
// catalog.js: GLASS, GLASS-4, FAC-WOOD-FILON, FAC-WOOD-FRAME). Внутри одной
// подкатегории у customOrder-позиций формулировка совпадает — берём первую
// найденную.
function libPriceNoteHtml(items) {
  const withNote = items.find((it) => it && it.priceNote);
  if (!withNote) return '';
  return `<p class="hint">Цена ${esc(withNote.priceNote)}.</p>`;
}

// ---------------------------------------------------------------------------
// Единый набор колонок ВСЕХ таблиц вкладки «Материалы»: Наименование /
// (иконка источника) / Образец / Длина / Ширина / Толщина / Цена /
// (опционально «Выбрать» в режиме подбора). Раньше у decors/back/facade,
// edge и countertop были РАЗНЫЕ наборы колонок (hasM2/hasThickness/
// isCountertop-ветвления) — теперь один рендерер на все шесть категорий,
// различия только в том, ИЗ КАКОГО ПОЛЯ каталога берётся каждая колонка (см.
// libItemKind/libDimsOf/libPriceValueForUnit ниже).
// ---------------------------------------------------------------------------

// kind — какой набор полей каталога читает позиция: 'sheet' (decors/back/
// facade — обычный лист, sheetW/sheetH/sheetPrice), 'area' (стекло/массив
// под заказ — customOrder, цена уже за м², без фиксированного листа),
// 'edge' (EDGE_PRICES — width/thickness/price за пог.м), 'countertop'
// (COUNTERTOP_MATERIALS — maxLength/depth/pricePerMeter).
function libItemKind(group, it) {
  if (group === 'edge') return 'edge';
  if (group === 'countertop') return 'countertop';
  if (it && (it.customOrder || it.unit === 'м²')) return 'area';
  return 'sheet';
}
// Поле каталога, отвечающее за колонку «Длина» / «Ширина» — null, если у
// этого вида позиций такого поля вообще не существует (кромка продаётся
// размотанной лентой без фиксированной длины, стекло/массив под заказ режут
// по месту — ни длины, ни ширины листа нет).
function libLengthFieldOf(kind) {
  if (kind === 'sheet') return 'sheetW';
  if (kind === 'countertop') return 'maxLength';
  return null;
}
function libWidthFieldOf(kind) {
  if (kind === 'sheet') return 'sheetH';
  if (kind === 'countertop') return 'depth';
  if (kind === 'edge') return 'width';
  return null;
}
// Нормализованные Длина/Ширина/Толщина одной позиции — числа или null
// (поля нет вовсе, см. выше, либо конкретная позиция его не заполнила, как
// H1180ST37 без thickness). Толщина у ВСЕХ шести категорий хранится в одном
// и том же поле it.thickness.
function libDimsOf(kind, it) {
  const lenField = libLengthFieldOf(kind);
  const widField = libWidthFieldOf(kind);
  return {
    length: lenField && it[lenField] != null ? it[lenField] : null,
    width: widField && it[widField] != null ? it[widField] : null,
    thickness: it && it.thickness != null ? it.thickness : null,
  };
}
// Ключ позиции для libEditCell/libFindItem/выбора строки (см.
// state.libSelectedRow) — it.code у всех категорий, кроме кромки: там
// каталог хранит позиции объектом {имя → цена}, ключ — само имя (it.key,
// проставляется в libTopEntries).
function libRowKeyOf(group, it) {
  return group === 'edge' ? it.key : it.code;
}

// Цена за м² — ТОЛЬКО для сравнения материалов между собой (реальная
// стоимость проекта в спецификации по-прежнему считается по листам с
// технологическим запасом, см. specification.js — эта колонка её не
// подменяет). Сеточный расчёт из sheetPrice/sheetW/sheetH; если хотя бы
// одного из трёх нет, возвращает null.
function libPricePerM2(it) {
  if (!it || !it.sheetPrice || !it.sheetW || !it.sheetH) return null;
  const area = (it.sheetW / 1000) * (it.sheetH / 1000);
  if (!area) return null;
  return Math.round((it.sheetPrice / area) * 100) / 100;
}

// Поле каталога, которое реально ХРАНИТ цену (единственный источник для
// engine.js/specification.js) — единственное, что остаётся редактируемым
// напрямую в колонке «Цена» (см. libPriceCellHtml): остальные единицы —
// пересчёт «на лету», не редактируются.
function libPriceFieldOf(kind) {
  if (kind === 'countertop') return 'pricePerMeter';
  if (kind === 'edge') return 'price';
  return 'sheetPrice'; // 'sheet' и 'area' — оба хранят цену в sheetPrice
}
// В какой ЕДИНИЦЕ хранится «родная» цена данного вида позиций — колонка
// «Цена» редактируема, только когда текущий переключатель (state.libPriceUnit)
// совпадает с одной из этих единиц; для остальных единиц значение только
// пересчитывается для отображения (см. libPriceCellHtml).
function libNativeUnitsOf(kind) {
  if (kind === 'sheet') return ['perSheet', 'perPiece']; // один лист = одна штука
  if (kind === 'area') return ['perM2']; // sheetPrice customOrder-позиций уже цена за м²
  if (kind === 'countertop') return ['perMeter'];
  if (kind === 'edge') return ['perMeter'];
  return [];
}
// Пересчёт цены в выбранную единицу — формулы см. в постановке задачи
// (libraryMaterialsBlock/state.libPriceUnit): null, если для этого вида
// позиций и этой единицы посчитать нечем (не тот тип товара/не хватает
// полей) — ячейка тогда покажет «—», а не 0.
function libPriceValueForUnit(kind, it, unit) {
  if (kind === 'sheet') {
    if (unit === 'perSheet' || unit === 'perPiece') return it.sheetPrice != null ? it.sheetPrice : null;
    if (unit === 'perM2') return libPricePerM2(it);
    return null; // perMeter — для листа смысла не имеет
  }
  if (kind === 'area') {
    return unit === 'perM2' && it.sheetPrice != null ? it.sheetPrice : null;
  }
  if (kind === 'countertop') {
    if (unit === 'perMeter') return it.pricePerMeter != null ? it.pricePerMeter : null;
    if (unit === 'perSheet' || unit === 'perPiece') {
      if (it.pricePerMeter == null || !it.maxLength) return null;
      return Math.round(it.pricePerMeter * (it.maxLength / 1000) * 100) / 100;
    }
    if (unit === 'perM2') {
      if (it.pricePerMeter == null || !it.depth) return null;
      return Math.round((it.pricePerMeter / (it.depth / 1000)) * 100) / 100;
    }
    return null;
  }
  if (kind === 'edge') {
    if (unit === 'perMeter') return it.price != null ? it.price : null;
    if (unit === 'perM2') {
      if (it.price == null || !it.width) return null;
      return Math.round((it.price / (it.width / 1000)) * 100) / 100;
    }
    return null; // perSheet/perPiece — нет фиксированной длины ленты
  }
  return null;
}
// 'native' (см. state.libPriceUnit) — не настоящая единица, а «как на
// сайте»: подставляем вместо него ПЕРВУЮ родную единицу конкретного вида
// позиций (libNativeUnitsOf(kind)[0]) и дальше везде работаем с ней, как
// если бы её выбрали явно — в т.ч. редактируемость ячейки (см.
// libPriceCellHtml) остаётся как у родной единицы.
function libPriceEffectiveUnit(kind, unit) {
  return unit === 'native' ? libNativeUnitsOf(kind)[0] : unit;
}
function libPriceCellHtml(group, key, kind, it, unit) {
  const effUnit = libPriceEffectiveUnit(kind, unit);
  if (libNativeUnitsOf(kind).indexOf(effUnit) >= 0) {
    const field = libPriceFieldOf(kind);
    return libEditCell(group, key, field, 'number', it[field]);
  }
  const val = libPriceValueForUnit(kind, it, effUnit);
  return `<td>${val != null ? esc(String(val)) : '—'}</td>`;
}
// То же значение, что рисует libPriceCellHtml, но простой строкой — читает
// поповер сортировки/фильтра колонки «Цена» (см. openColumnFilterMenu/
// libFilterRowsCache): единственный источник правды для «что показано в
// ячейке» один и тот же для обеих функций (libPriceEffectiveUnit).
function libPriceDisplayValue(kind, it, unit) {
  const effUnit = libPriceEffectiveUnit(kind, unit);
  if (libNativeUnitsOf(kind).indexOf(effUnit) >= 0) {
    const v = it[libPriceFieldOf(kind)];
    return v != null ? String(v) : '';
  }
  const val = libPriceValueForUnit(kind, it, effUnit);
  return val != null ? String(val) : '—';
}

// Единицы измерения цены — общий переключатель на ВСЮ «Библиотеку» (см.
// state.libPriceUnit): меняешь в шапке одной таблицы, пересчитываются все
// остальные открытые таблицы (renderLibraryPanel — полная перерисовка).
// 'native' первым пунктом — дефолт (см. state.libPriceUnit), показывает
// цену «как на сайте», без пересчёта (см. libPriceEffectiveUnit).
const LIB_PRICE_UNITS = [
  { id: 'native', label: 'как на сайте' },
  { id: 'perMeter', label: 'м.п.' },
  { id: 'perPiece', label: 'шт.' },
  { id: 'perM2', label: 'м²' },
  { id: 'perSheet', label: 'лист' },
];
function libPriceUnitHeaderHtml() {
  const sym = curSym();
  const opts = LIB_PRICE_UNITS.map((u) => {
    const label = u.id === 'native' ? `Цена, ${esc(sym)} (${esc(u.label)})` : `Цена, ${esc(sym)}/${esc(u.label)}`;
    return `<option value="${esc(u.id)}" ${u.id === state.libPriceUnit ? 'selected' : ''}>${label}</option>`;
  }).join('');
  return `<select class="lib-price-unit-select">${opts}</select>`;
}

// Укороченное название столешницы для колонки «Наименование» — убирает
// служебный префикс «Столешница …, глубина N,» (тип и глубина и так видны
// из новых колонок Толщина/Ширина) и бренд из скобок (он уже виден из
// дерева/it.brand): «...мрамор белый (Kronospan K552SU White Iceberg)» →
// «...мрамор белый (K552SU White Iceberg)». Само поле it.name НЕ трогаем —
// нужно как есть для спецификации/экспорта, это только отображение (правки
// инлайн всё равно идут по полному it.name, см. data-raw в libEditCell).
function libCountertopShortName(it) {
  let s = String((it && it.name) || '');
  s = s.replace(/^Столешница.*?глубина\s*\d+,\s*/, '');
  if (it && it.brand) s = s.split(`(${it.brand} `).join('(');
  return s;
}

// Ширины колонок фиксированы через <colgroup> (table-layout:fixed — инлайн
// на самой таблице, см. libLeafTableHtml), чтобы длинное название
// материала переносилось по словам, а не растягивало таблицу и вслед за ней
// панель (см. #drawer-library.lib-wide/.lib-table в style.css). Колонка
// «Наименование» — без явной ширины, забирает весь остаток. Длина/Ширина/
// Толщина (класс .lib-char-col) при свёрнутых характеристиках (collapsed,
// см. state.libCharsCollapsed) вообще НЕ выводятся в разметку — раньше их
// прятали одним CSS-правилом (display:none на <col>+<th>/<td>), но тумблер
// «± характеристики» жил ВНУТРИ <thead> общим заголовком (colspan=3) и не
// сжимался вместе с ними, из-за чего шапка и тело расходились по ширине
// (баг, найден 2026-09-11). Исправление — не только НЕ рисовать сами
// колонки в разметке при collapsed, но и вынести тумблер ИЗ <thead> вообще
// (см. libLeafTableHtml — теперь это отдельная кнопка-ссылка НАД таблицей,
// как «+ Добавить материал» под ней), чтобы <thead> ни в одном состоянии не
// нуждался в colspan/rowspan — тогда физическое число колонок в шапке и
// теле совпадает тривиально, само собой. Ширина 84px у каждой из трёх
// колонок (а не 76px, как было рассчитано под одну-единственную
// «Толщина, мм») — три подписи в шапке (см. libTableHead) уместились без
// наезда друг на друга в самой широкой из них, «ТОЛЩИНА» (заголовки —
// capslock, .lib-table th).
function libColgroup(pickMode, collapsed) {
  const charCols = collapsed ? '' : `<col class="lib-char-col" style="width:84px"><col class="lib-char-col" style="width:84px"><col class="lib-char-col" style="width:84px">`;
  return `<colgroup><col><col style="width:26px"><col style="width:72px">`
    + charCols
    + `<col style="width:118px">`
    + `${pickMode ? '<col style="width:76px">' : ''}</colgroup>`;
}
// Заголовок — ОДНА строка <thead> (никаких rowspan/colspan, см. коммент у
// libColgroup выше — тумблер «± характеристики» больше не здесь), Длина/
// Ширина/Толщина рисуются, только когда !collapsed — раз колонок в теле нет
// (см. libColgroup/libRowHtml), то и заголовков под ними быть не должно.
// Подписи Длина/Ширина/Толщина — БЕЗ «, мм»: при трёх колонках по 84px
// полный текст «Ширина, мм»/«Толщина, мм» не помещался и наезжал на
// соседнюю колонку (баг, найден code-review 2026-09-07); единица вынесена в
// title-подсказку на каждой ячейке. Каждый фильтруемый столбец (см. п.3
// задачи 2026-09-11) несёт кнопку-треугольник .dth-filter-btn — тот же
// поповер сортировки/фильтра, что и в «Деталировке» (см.
// openColumnFilterMenu), tableKey — тот же charsKey, что различает
// одновременно открытые таблицы Библиотеки между собой.
function libTableHead(pickMode, collapsed, tableKey) {
  const filterBtn = (colIndex) => `<button type="button" class="dth-filter-btn" data-filter-key="${esc(tableKey)}" data-col="${colIndex}" title="Сортировка и фильтр">▾</button>`;
  const charsHeadCells = collapsed ? '' : `
      <th class="lib-char-col lib-th-filter" title="Длина, мм"><span class="dth-label">Длина</span>${filterBtn(1)}</th>
      <th class="lib-char-col lib-th-filter" title="Ширина, мм"><span class="dth-label">Ширина</span>${filterBtn(2)}</th>
      <th class="lib-char-col lib-th-filter" title="Толщина, мм"><span class="dth-label">Толщина</span>${filterBtn(3)}</th>`;
  return `<thead>
    <tr>
      <th class="lib-th-filter"><span class="dth-label">Наименование</span>${filterBtn(0)}</th>
      <th></th>
      <th>Образец</th>
      ${charsHeadCells}
      <th class="lib-th-filter"><span class="dth-label">${libPriceUnitHeaderHtml()}</span>${filterBtn(4)}</th>
      ${pickMode ? '<th></th>' : ''}
    </tr>
  </thead>`;
}

// Кэш строк для поповера сортировки/фильтра колонок Наименование/Длина/
// Ширина/Толщина/Цена (см. openColumnFilterMenu/libLeafTableHtml) — по
// ОДНОМУ массиву [{ idx, vals }] на каждую открытую таблицу листа, ключ —
// тот же charsKey/tableKey, что и у data-chars-key на самой <table>
// (несколько таблиц может быть открыто в Библиотеке одновременно, у каждой
// свой независимый фильтр). Заполняется здесь же, в libRowHtml (opts.tableKey/
// opts.rowIdx из libLeafTableHtml), а не отдельным проходом по entries — так
// значение колонки «Цена» гарантированно совпадает с тем, что реально
// нарисовано в ячейке (единый источник — libPriceDisplayValue).
const libFilterRowsCache = {};

// Одна строка таблицы — общая для ВСЕХ шести категорий (decors/back/facade/
// glass/edge/countertop). entry — { group, item }: group САМОЙ ЗАПИСИ, а не
// категории целиком — в объединённой подкатегории «Листовые материалы» (см.
// libraryMaterialsBlock) строки одной таблицы приходят из decors/back/facade
// одновременно, и каждая правится через libEditCell(entry.group, ...), а не
// через код категории. opts.pickMode — доп. кнопка «Выбрать» (см.
// libColgroup). opts.collapsed — «± характеристики» (см. libLeafTableHtml):
// при true ячейки Длина/Ширина/Толщина вообще не выводятся (не просто
// прячутся CSS — см. коммент у libColgroup, почему). data-row-group/
// data-row-key — клик по строке выделяет её (см. state.libSelectedRow/
// initLibraryPanel), data-row-idx (opts.tableKey/opts.rowIdx) — то, что
// читает applyColumnFilterAndSort для этой же таблицы.
function libRowHtml(entry, opts) {
  const group = entry.group;
  const it = entry.item;
  const kind = libItemKind(group, it);
  const key = libRowKeyOf(group, it);
  const pickMode = !!opts.pickMode;
  const collapsed = !!opts.collapsed;
  const unit = state.libPriceUnit;
  const sel = state.libSelectedRow;
  const isSelected = !!(sel && sel.group === group && sel.key === key);
  const searchText = String((group === 'edge' ? it.key : it.name) || '').toLowerCase();
  const dims = libDimsOf(kind, it);
  // Название кромки — ключ объекта EDGE_PRICES (см. catalog.js). Переименовывать
  // его на месте рискованно (specification.js читает EDGE_PRICES[type] по
  // значению из секции) — поэтому название НЕредактируемо, новая кромка
  // добавляется вводом уникального названия (см. libAddRow).
  const nameDisplay = group === 'edge' ? String(it.key || '') : group === 'countertop' ? libCountertopShortName(it) : String(it.name || '');
  const nameCell = group === 'edge'
    ? `<td>${esc(nameDisplay)}</td>`
    : group === 'countertop'
      ? libEditCell(group, key, 'name', 'text', it.name, { displayText: nameDisplay })
      : libEditCell(group, key, 'name', 'text', it.name);
  const lenField = libLengthFieldOf(kind);
  const widField = libWidthFieldOf(kind);
  const lengthCell = collapsed ? '' : (lenField ? libDashEditCell(group, key, lenField, dims.length, 'lib-char-col') : '<td class="lib-char-col">—</td>');
  const widthCell = collapsed ? '' : (widField ? libDashEditCell(group, key, widField, dims.width, 'lib-char-col') : '<td class="lib-char-col">—</td>');
  const thicknessCell = collapsed ? '' : libDashEditCell(group, key, 'thickness', dims.thickness, 'lib-char-col');
  const priceCell = libPriceCellHtml(group, key, kind, it, unit);
  const priceDisplay = libPriceDisplayValue(kind, it, unit);
  const pickCell = pickMode
    ? `<td><button type="button" class="link-btn lib-pick-btn" data-pick-group="${esc(group)}" data-pick-code="${esc(key)}">Выбрать</button></td>`
    : '';
  if (opts.tableKey != null && opts.rowIdx != null) {
    if (!libFilterRowsCache[opts.tableKey]) libFilterRowsCache[opts.tableKey] = [];
    libFilterRowsCache[opts.tableKey].push({
      idx: opts.rowIdx,
      vals: [
        nameDisplay,
        dims.length != null ? String(dims.length) : '',
        dims.width != null ? String(dims.width) : '',
        dims.thickness != null ? String(dims.thickness) : '',
        priceDisplay,
      ],
    });
  }
  return `
    <tr data-search="${esc(searchText)}" data-row-group="${esc(group)}" data-row-key="${esc(key)}"
        data-row-idx="${opts.rowIdx != null ? opts.rowIdx : ''}"
        class="${isSelected ? 'lib-row-selected' : ''}">
      ${nameCell}
      ${libSourceLinkCell(it)}
      <td>${libSwatchHtml(group, key, it.image)}</td>
      ${lengthCell}
      ${widthCell}
      ${thicknessCell}
      ${priceCell}
      ${pickCell}
    </tr>`;
}

// Подсказка на неактивной кнопке «− Удалить материал» (см. libLeafTableHtml/
// libApplyRowSelection) — пока в таблице ничего не выделено кликом.
const LIB_ROW_DEL_HINT = 'Сначала выберите строку в таблице';

// Таблица позиций одного листа (или «своих» позиций ветки — см. HDF-8 в
// комментарии выше libTopEntries): фильтры → подсказка о примерной цене →
// таблица → «+ Добавить материал» / «− Удалить материал» (опц.).
// addGroupMap/addDefaultGroup решают, в какой массив каталога уйдёт новая
// позиция — см. libraryMaterialsBlock, там же объяснение выбора значения по
// умолчанию.
function libLeafTableHtml(topCode, path, entries, opts) {
  const isCountertop = topCode === 'countertop';
  // У столешниц кнопка «Выбрать» появляется НЕ на любой подбор (в отличие
  // от «Листовых материалов», где любая из ролей decor/facadeDecor/back
  // годится, т.к. это всё обычные листы) — только когда подбирают материал
  // СПЕЦИАЛЬНО для столешницы (role: 'countertopDecor', см.
  // openMaterialPicker/libPickMaterial). Для decor/facadeDecor/back карточка
  // столешницы (продаётся погонным метром) не годится.
  const pickMode = isCountertop
    ? !!(state.libPickTarget && state.libPickTarget.role === 'countertopDecor')
    : !!(opts.pickable && state.libPickTarget);
  const charsKey = libNodeKey(topCode, path);
  const collapsed = !!state.libCharsCollapsed;
  // Кэш этого листа пересобирается с нуля на каждый рендер (см.
  // libFilterRowsCache/libRowHtml) — иначе после удаления/добавления
  // позиции в нём остались бы "хвостовые" записи от прошлого рендера с
  // бо́льшим числом строк (безвредно для applyColumnFilterAndSort — она
  // смотрит только на реальные tr[data-row-idx] — но лишняя память и путаница).
  libFilterRowsCache[charsKey] = [];
  const rowsHtml = entries.map((e, i) => libRowHtml(e, { pickMode, collapsed, tableKey: charsKey, rowIdx: i })).join('');
  const items = entries.map((e) => e.item);
  const colCount = (collapsed ? 4 : 7) + (pickMode ? 1 : 0);
  const emptyRow = entries.length ? '' : `<tr><td colspan="${colCount}" class="hint">Пока нет позиций</td></tr>`;
  const addGroup = topCode === 'edge' ? 'edge' : ((opts.addGroupMap && opts.addGroupMap[path[0]]) || opts.addDefaultGroup || topCode);
  const addHtml = opts.addLabel
    ? `<button type="button" class="link-btn lib-add" data-add="${esc(addGroup)}" data-add-path="${esc(path.join('::'))}">${esc(opts.addLabel)}</button>`
    : '';
  // «− Удалить материал» — только там, где вообще есть массив/объект
  // каталога, из которого можно удалить строку. «Стекло» (topCode 'glass') —
  // единственное исключение: cat.GLASS не массив, а один фиксированный
  // объект, удалять там нечего (у GLASS-4 внутри «Материалов фасадов» такое
  // ограничение уже не действует — FACADE_MATERIALS обычный объект-каталог).
  const canDelete = topCode !== 'glass';
  const sel = state.libSelectedRow;
  const selectedHere = canDelete && !!sel && entries.some((e) => e.group === sel.group && libRowKeyOf(e.group, e.item) === sel.key);
  // title — только пока кнопка disabled (см. LIB_ROW_DEL_HINT/
  // libApplyRowSelection, который держит его в синхроне с disabled и после
  // точечного, без полной перерисовки, выделения строки).
  const delHtml = canDelete
    ? `<button type="button" class="link-btn lib-row-del" ${selectedHere ? '' : 'disabled'}${selectedHere ? '' : ` title="${esc(LIB_ROW_DEL_HINT)}"`}>− Удалить материал</button>`
    : '';
  const actionsHtml = (addHtml || delHtml) ? `<div class="lib-leaf-actions">${addHtml}${delHtml}</div>` : '';
  // «± характеристики» — ссылка НАД таблицей, а не заголовок внутри <thead>
  // (см. коммент у libColgroup/libTableHead, почему): общий на всю
  // Библиотеку тумблер (state.libCharsCollapsed), клик в любой из открытых
  // таблиц сворачивает/разворачивает колонки Длина/Ширина/Толщина везде
  // разом (обработчик — делегированный click на .lib-chars-toggle, см.
  // initLibraryPanel, ему всё равно, внутри таблицы кнопка или снаружи).
  const charsToggleLabel = (collapsed ? '+' : '−') + ' характеристики';
  const charsToggleHtml = `<button type="button" class="link-btn lib-chars-toggle" data-chars-toggle="1" title="Показать/скрыть длину, ширину, толщину">${esc(charsToggleLabel)}</button>`;
  return `
    <div class="lib-leaf-body">
      ${charsToggleHtml}
      ${libPriceNoteHtml(items)}
      <table class="lib-table${collapsed ? ' chars-collapsed' : ''}" style="table-layout:fixed" data-chars-key="${esc(charsKey)}">${libColgroup(pickMode, collapsed)}${libTableHead(pickMode, collapsed, charsKey)}<tbody>${rowsHtml}${emptyRow}</tbody></table>
      ${actionsHtml}
    </div>`;
}

// Строка одного узла дерева — общая и для верхнеуровневой категории (kind
// 'top'), и для ветки ('branch'), и для листа ('leaf'). Отступ слева
// пропорционален глубине пути (16px/уровень); ✎/+/× — обычный текст без
// рамки/фона, видны по наведению на строку (см. .lib-tree-actions в
// style.css). У 'top' нет ✎/× (нельзя переименовать/удалить категорию
// целиком), у 'leaf' нет + (единственное добавление у листа — «+ Добавить
// материал» под его таблицей, см. libLeafTableHtml). У 'countertop' нет ни
// ✎, ни + ни на одном уровне — его categoryPath виртуальный, выводится из
// item.materialId (закрытый список, см. COUNTERTOP_MATERIAL_LABEL), а не
// хранится как реальное поле каталога: libRenameNode/libAddChildNode
// мутировали бы одноразовую копию из libTopEntries и молча ничего не meняли
// бы после перерисовки — правильнее не показывать эти значки вовсе, чем
// давать нерабочую кнопку. × оставлен — на реальных листьях он и так всегда
// блокируется алертом (см. libNodeHasItems), а плейсхолдеры здесь взяться
// неоткуда без +.
function libTreeRowHtml(topCode, path, name, kind, collapsed) {
  const depth = path.length;
  const isTop = kind === 'top';
  const isLeaf = kind === 'leaf';
  const isCountertop = topCode === 'countertop';
  const arrowHtml = isLeaf ? '<span class="lib-tree-arrow"></span>' : `<span class="lib-tree-arrow">${collapsed ? '▸' : '▾'}</span>`;
  const renameIc = (isTop || isCountertop) ? '' : '<span class="lib-tree-ic" data-tree-rename="1" title="Переименовать">✎</span>';
  const addIc = (isLeaf || isCountertop) ? '' : '<span class="lib-tree-ic" data-tree-add="1" title="Добавить категорию">+</span>';
  const delIc = isTop ? '' : '<span class="lib-tree-ic" data-tree-del="1" title="Удалить">×</span>';
  return `<div class="lib-tree-row${isTop ? ' lib-tree-top' : ''}" style="padding-left:${depth * 16}px"
      data-tree-node="1" data-kind="${kind}" data-top="${esc(topCode)}" data-path="${esc(path.join('::'))}">
    ${arrowHtml}<span class="lib-tree-name" data-tree-label="1">${esc(name)}</span><span class="lib-tree-actions">${renameIc}${addIc}${delIc}</span>
  </div>`;
}

// Один узел дерева (ветка или лист) с его поддеревом — вызывается рекурсивно
// для каждого дочернего сегмента (см. libChildSegments). Лист в обычном
// режиме навигации показывает только свою строку — таблица открывается
// кликом по нему (см. state.libActiveLeaf/libTopCategoryHtml), а не здесь.
// У ветки, если под её собственным путём (а не только глубже) есть реальные
// позиции каталога (см. HDF-8 в комментарии у libTopEntries), они показаны
// сразу под её строкой при раскрытии — тем же рендерером таблицы, что и у
// листа, специально без отдельного концепта («не усложняй»).
function libNodeHtml(topCode, path, opts) {
  const name = path[path.length - 1];
  const children = libChildSegments(topCode, path);
  if (!children.length) return libTreeRowHtml(topCode, path, name, 'leaf', false);
  const collapsed = libIsNodeCollapsed(topCode, path);
  const ownEntries = libEntriesAtPath(topCode, path);
  const ownTableHtml = ownEntries.length ? libLeafTableHtml(topCode, path, ownEntries, opts) : '';
  const childrenHtml = children.map((seg) => libNodeHtml(topCode, path.concat([seg]), opts)).join('');
  return libTreeRowHtml(topCode, path, name, 'branch', collapsed)
    + `<div class="lib-tree-children${collapsed ? ' lib-collapsed' : ''}">${ownTableHtml}${childrenHtml}</div>`;
}

// Верхнеуровневая категория целиком («Листовые материалы»/«Материалы
// фасадов»/«Кромка»/«Стекло») — заголовок (сам никогда не прячется, кликом
// раскрывает/прячет прямых детей, см. state.libCatOpen) → либо ПОЛНОЕ дерево
// (обычная навигация), либо, если на этой категории сфокусирован лист (см.
// state.libActiveLeaf), ТОЛЬКО его строка + таблица — вся остальная
// структура дерева этой категории скрыта.
function libTopCategoryHtml(topCode, title, opts) {
  const activeKey = state.libActiveLeaf[topCode] || null;
  let bodyHtml;
  if (activeKey) {
    const path = activeKey.split('::');
    const name = path[path.length - 1];
    bodyHtml = libTreeRowHtml(topCode, path, name, 'leaf', false)
      + libLeafTableHtml(topCode, path, libEntriesAtPath(topCode, path), opts);
  } else {
    const open = !!state.libCatOpen[topCode];
    const topSegments = libChildSegments(topCode, []);
    const childrenHtml = topSegments.map((seg) => libNodeHtml(topCode, [seg], opts)).join('');
    bodyHtml = `<div class="lib-tree-children${open ? '' : ' lib-collapsed'}">${childrenHtml}</div>`;
  }
  return `
    <div class="lib-category" data-top-code="${esc(topCode)}">
      ${libTreeRowHtml(topCode, [], title, 'top', !state.libCatOpen[topCode])}
      ${bodyHtml}
    </div>`;
}

// Столешницы (window.Modul3D.catalog.COUNTERTOP_MATERIALS) продаются
// погонным метром фиксированной глубины (см. комментарий у самого массива
// в catalog.js) и, в отличие от decors/back/facade/edge/glass, не имеют
// собственного поля categoryPath — пятая ветка дерева «Материалы» строится
// виртуально из уже существующих materialId/brand (см. libTopEntries: топ
// 'countertop', второй уровень пути — бренд, как у decors/facade). materialId
// группирует линейку (ldsp38 постформинг / compact12 компакт-плита) —
// человекочитаемое название берём тут же, чтобы не плодить код в catalog.js
// ради одной подписи в дереве/таблице.
const COUNTERTOP_MATERIAL_LABEL = { ldsp38: 'ЛДСП 38мм постформинг', compact12: 'Компакт-плита HPL 12мм', doubleLdsp: 'Сдвоенное ЛДСП (по декору корпуса)' };
// Обратный словарь (метка листа дерева → materialId) — нужен «+ Добавить
// столешницу» (см. libAddRow), чтобы новая позиция попадала в ту же линейку
// материала, под чьим листом нажали кнопку, а не всегда в первую по умолчанию.
const COUNTERTOP_MATERIAL_LABEL_TO_ID = {};
Object.keys(COUNTERTOP_MATERIAL_LABEL).forEach((id) => { COUNTERTOP_MATERIAL_LABEL_TO_ID[COUNTERTOP_MATERIAL_LABEL[id]] = id; });

// Первый сегмент categoryPath называет ТИП листового материала (ДСП/
// МДФ-плита/Шпонированные плиты), а не его роль в проекте (корпус/фасад/
// задняя стенка) — см. catalog.js. Эти три значения и выделяют «плитную»
// часть FACADE_MATERIALS, которая переезжает в объединённую категорию
// «Листовые материалы» вместе с decors/back (см. libTopEntries выше);
// «Массив»/«Алюминий»/«Стекло» — не плитные материалы, остаются в
// «Материалы фасадов».
const SHEET_FACADE_SUBCATS = ['ДСП', 'МДФ-плита', 'Шпонированные плиты'];

// Новая позиция листа объединённой категории «Листовые материалы» кладётся
// в ОДИН конкретный исходный массив каталога по умолчанию — по первому
// сегменту его пути (path[0]): «ДСП» чаще всего заводят как декор корпуса
// (DECORS — самый частый случай), «МДФ-плита»/«Шпонированные плиты» —
// позиции есть только в FACADE_MATERIALS, «ХДФ/ДВП» — только в
// BACK_MATERIALS. Для СОВСЕМ нового (заведённого кнопкой «+», ещё не
// встречавшегося) первого сегмента используем addDefaultGroup (см.
// libLeafTableHtml) — decors, тот же самый частый случай. Категорию
// «Материалы фасадов» это не касается — там addGroupMap не передаётся,
// всегда FACADE_MATERIALS (см. libAddRow: group === 'facade').
const SHEET_ADD_GROUP_MAP = { 'ДСП': 'decors', 'МДФ-плита': 'facade', 'Шпонированные плиты': 'facade', 'ХДФ/ДВП': 'back' };

function libraryMaterialsBlock() {
  return `
    <h3>Материалы</h3>
    ${libSourceHint()}
    ${libTopCategoryHtml('sheet', 'Листовые материалы', {
      pickable: true,
      addLabel: '+ Добавить материал', addGroupMap: SHEET_ADD_GROUP_MAP, addDefaultGroup: 'decors',
    })}
    ${libTopCategoryHtml('facade', 'Материалы фасадов', { addLabel: '+ Добавить материал' })}
    ${libTopCategoryHtml('edge', 'Кромка', { addLabel: '+ Добавить кромку' })}
    ${libTopCategoryHtml('glass', 'Стекло', {})}
    ${libTopCategoryHtml('countertop', 'Столешницы', { addLabel: '+ Добавить столешницу', pickable: true })}`;
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
        ${libSourceLinkCell(item)}
        ${libEditCell('hw:' + src, key, 'unit', 'text', item.unit || 'шт')}
        ${libEditCell('hw:' + src, key, 'price', 'number', item.price)}
      </tr>`).join('');
    return `
      <h4 class="mat-sub">${esc(label[c] || c)}</h4>
      <table class="lib-table"><thead><tr>
        <th>Наименование</th><th></th><th>Ед. изм.</th><th>Цена, ${esc(curSym())}</th>
      </tr></thead><tbody>${rows || '<tr><td colspan="4" class="hint">Пока нет позиций</td></tr>'}</tbody></table>
      <button type="button" class="link-btn lib-add" data-add="hwadd:${c}">+ Добавить позицию</button>`;
  }).join('');

  return `<h3>Фурнитура</h3>${libSourceHint()}${sections}`;
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
  if (group === 'countertop') return (cat.COUNTERTOP_MATERIALS || []).find((x) => x.code === key) || null;
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
  // Толщина задней стенки кэшируется в state.backThickness в момент выбора
  // материала (см. bindPanelEvents → #p-back) — если сейчас правят толщину
  // именно того материала, что уже выбран как задняя стенка проекта, нужно
  // обновить и state.backThickness той же точкой, иначе правка через
  // «Библиотеку» применится только после повторного выбора в выпадающем списке.
  if (group === 'back' && field === 'thickness' && key === state.backCode) {
    state.backThickness = value;
  }
  // Каталог — не часть snapshot()/файла проекта, полный recompute() не
  // обязателен для пересчёта чисел, но нужен, чтобы обновить спецификацию
  // (новая цена) и деталировку (переименованный материал) на лету.
  recompute();
  // Фурнитура (group вида 'hw:*') не входит в снимок каталога материалов
  // (snapshotCatalogCollections/restoreCatalogFrom её не знают) — сохранять
  // здесь нечего, а лишний PUT только грузил бы сервер бесполезным запросом.
  if (group.indexOf('hw:') !== 0) scheduleCatalogSave();
  renderLibraryPanel();
}

// Роли подбора материала (см. state.libPickTarget/materialPickActionsHtml)
// читают только ДВА массива каталога: decor/facadeDecor/countertopDecor —
// DECORS (декор корпуса, декор видимой боковины фасада и «свой материал»
// столешницы — все три поля выбирают из одного и того же списка), back —
// BACK_MATERIALS. Общий для libPickMaterial и deleteMaterialPick ниже.
// countertopDecor («свой материал» столешницы) сюда НЕ входит — у него нет
// единого целевого массива: он может ссылаться на код из ЛЮБОГО списка
// каталога напрямую, без копирования (см. отдельная ветка в libPickMaterial
// ниже — изменено 2026-09-06, копия раньше плодила видимый дубль в
// Библиотеке). Своей ветки в deleteMaterialPick у этой роли больше нет —
// удаление материала столешницы убрано из UI, см. countertopPanelBlock.
const LIB_PICK_ROLE_GROUP = { decor: 'decors', facadeDecor: 'decors', back: 'back' };

// Клик «Выбрать» на строке «Листовых материалов» в режиме подбора.
// rowGroup/code — ИСТИННОЕ происхождение строки (см. libRowHtml: entry.group),
// может не совпадать с массивом нужной роли — например,
// пользователь подбирает «Материал корпуса» (читает DECORS), но кликнул по
// строке FAC-LDSP, которая физически лежит в FACADE_MATERIALS. В этом
// случае саму позицию не переносим (она там нужна и для типа фасада), а
// копируем её данные в целевой массив под тем же (или, при совпадении кода,
// уникальным) кодом.
function libPickMaterial(rowGroup, code) {
  const target = state.libPickTarget;
  if (!target) return;
  if (target.role === 'countertopDecor') {
    // «Свой материал» столешницы ссылается на код НАПРЯМУЮ, без копии в
    // другой массив — decorCode может указывать на позицию из ЛЮБОГО
    // списка (DECORS/FACADE_MATERIALS/BACK_MATERIALS), countertopMat() в
    // engine.js и specification.js уже ищут материал по коду во всех трёх
    // (см. findAnyMaterialByCode выше). Копирование, как у decor/
    // facadeDecor/back ниже, здесь не нужно — оно оправдано ТОЛЬКО там, где
    // поле жёстко читает один конкретный массив; здесь такого ограничения
    // нет, а копия просто плодит дубль в Библиотеке (баг, найденный
    // пользователем 2026-09-06). Применяется к АКТИВНОЙ тумбе (не к группе
    // отмеченных — см. activeCountertopModule).
    const mod = activeCountertopModule();
    if (mod && mod.countertop) mod.countertop.decorCode = code;
    state.libPickTarget = null;
    renderLibraryPanel();
    // Возвращаемся на панель «Столешница», а не просто закрываем Библиотеку
    // (по просьбе пользователя 2026-09-06 — раньше пользователь оставался
    // без открытой панели вообще).
    if (window.Modul3D.uiShell) window.Modul3D.uiShell.openDrawer('countertop');
    recompute();
    return;
  }
  const targetGroup = LIB_PICK_ROLE_GROUP[target.role];
  if (!targetGroup) return;
  let finalCode = code;
  if (rowGroup !== targetGroup) {
    const src = libFindItem(rowGroup, code);
    if (!src) return;
    const targetArr = targetGroup === 'back' ? BACK_MATERIALS : DECORS;
    const copy = {};
    ['name', 'sheetPrice', 'sourceUrl', 'sheetW', 'sheetH', 'unit', 'thickness', 'image']
      .forEach((f) => { if (src[f] !== undefined) copy[f] = src[f]; });
    // categoryPath — свой массив-копия, а не общая ссылка с источником:
    // дальше её можно переименовать (см. libRenameNode) независимо от узла,
    // из которого материал скопировали.
    if (src.categoryPath) copy.categoryPath = src.categoryPath.slice();
    // Задняя стенка обязательно требует числовую толщину (state.backThickness
    // берётся из неё, см. bindPanelEvents → #p-back) — если у скопированной
    // позиции (например, декора корпуса) поля thickness нет, спрашиваем
    // явно, а не подставляем число самим (тот же принцип, что и у добавления
    // новой кромки — см. libAddRow: group === 'edge').
    if (targetGroup === 'back' && copy.thickness == null) {
      const raw = window.prompt('Толщина этого материала для задней стенки, мм:');
      const val = Number(raw);
      if (!raw || !Number.isFinite(val) || val <= 0) return; // отмена/некорректный ввод — подбор не завершаем
      copy.thickness = val;
    }
    // Суффикс с растущим счётчиком, а не фиксированный «-copy»: тот же
    // материал могут подобрать несколько раз подряд (например, и для
    // decor, и для facadeDecor — оба пишут в DECORS) — фиксированный
    // суффикс на третий раз столкнулся бы с уже занятым «-copy» и дал
    // дублирующийся code (find() находил бы только первую запись).
    let newCode = src.code;
    let attempt = 1;
    while (targetArr.some((x) => x.code === newCode)) {
      attempt += 1;
      newCode = attempt === 2 ? `${src.code}-copy` : `${src.code}-copy${attempt}`;
    }
    copy.code = newCode;
    targetArr.push(copy);
    finalCode = newCode;
    // Копия материала физически ушла в DECORS/BACK_MATERIALS — это правка
    // каталога наравне с libSaveEdit/libAddRow, сохраняем и её.
    scheduleCatalogSave();
  }
  if (target.role === 'decor') state.decorCode = finalCode;
  else if (target.role === 'facadeDecor') state.facadeDecorCode = finalCode;
  else if (target.role === 'back') {
    state.backCode = finalCode;
    const back = BACK_MATERIALS.find((m) => m.code === finalCode);
    if (back) state.backThickness = back.thickness;
  }
  state.libPickTarget = null;
  renderLibraryPanel();   // убирает колонку «Выбрать» сразу, не дожидаясь повторного открытия
  if (window.Modul3D.uiShell) window.Modul3D.uiShell.closeDrawer('library');
  recompute();
  renderParamsPanel();
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

// path — путь листа дерева, в который попадёт новая позиция (кнопка «+
// Добавить материал» листа, см. libLeafTableHtml: data-add-path на кнопке,
// массив строк или undefined) — не используется для 'hwadd:*'/'countertop'
// (там дерева категорий нет). Для 'decors'/'back'/'facade' пишем path целиком
// в item.categoryPath новой позиции; 'edge' сохраняет прежний UX (имя кромки
// — это ключ объекта EDGE_PRICES, вводится отдельным prompt), но тоже
// получает categoryPath = path.
function libAddRow(group, path) {
  const cat = window.Modul3D.catalog;
  path = path || [];
  if (group.indexOf('hwadd:') === 0) {
    libAddHardwareRow(group.slice(6));
  } else if (group === 'decors') {
    DECORS.push({ code: 'NEW-' + Date.now(), name: 'Новый материал', sheetPrice: 0, sheetW: 2750, sheetH: 1830, unit: 'лист', image: null, categoryPath: path.slice() });
  } else if (group === 'back') {
    // thickness обязателен: это единственный источник state.backThickness
    // при выборе материала в «Параметрах проекта» (ручного поля-дублёра
    // больше нет) — без него расчёт в engine.js получит undefined.
    BACK_MATERIALS.push({ code: 'NEW-' + Date.now(), name: 'Новый материал', sheetPrice: 0, sheetW: 2440, sheetH: 1220, thickness: 3, unit: 'лист', image: null, categoryPath: path.slice() });
  } else if (group === 'facade') {
    const code = 'FAC-NEW-' + Date.now();
    cat.FACADE_MATERIALS[code] = { code, name: 'Новый материал фасада', sheetPrice: 0, sheetW: 2750, sheetH: 1830, unit: 'лист', image: null, categoryPath: path.slice() };
  } else if (group === 'edge') {
    const name = (window.prompt('Название новой кромки:') || '').trim();
    if (!name) return;
    if (cat.EDGE_PRICES[name]) { window.alert('Кромка с таким названием уже есть в каталоге.'); return; }
    cat.EDGE_PRICES[name] = { price: 0, unit: 'пог.м', image: null, categoryPath: path.slice() };
  } else if (group === 'countertop') {
    // materialId/brand берём по листу дерева, под которым нажали «+
    // Добавить столешницу» — path[0] метка типа (COUNTERTOP_MATERIAL_LABEL,
    // см. COUNTERTOP_MATERIAL_LABEL_TO_ID выше и libTopEntries), path[1]
    // бренд (второй уровень дерева, см. libTopEntries: item.categoryPath у
    // столешниц). Если кнопка нажата не под конкретным листом (path пуст)
    // или метка не распознана, 'ldsp38' по умолчанию как самая частая
    // линейка. Глубину и цену пользователь правит инлайн сразу после
    // добавления строки.
    if (!cat.COUNTERTOP_MATERIALS) cat.COUNTERTOP_MATERIALS = [];
    const materialId = COUNTERTOP_MATERIAL_LABEL_TO_ID[path[0]] || 'ldsp38';
    const brand = path[1] || 'Новый бренд';
    cat.COUNTERTOP_MATERIALS.push({ code: 'CTOP-NEW-' + Date.now(), materialId, brand,
      name: 'Новая столешница', thickness: 38, depth: 600, pricePerMeter: 0, maxLength: 4100,
      unit: 'пог.м', image: null });
  } else {
    return;
  }
  recompute();
  // Добавление фурнитуры (group === 'hwadd:*', см. libAddHardwareRow выше) —
  // вне снимка каталога материалов, сохранять на сервер нечего (см. тот же
  // комментарий в libSaveEdit).
  if (group.indexOf('hwadd:') !== 0) scheduleCatalogSave();
  renderLibraryPanel();
}

// ---------------------------------------------------------------------------
// «− Удалить материал» под таблицей листа (см. libLeafTableHtml/
// state.libSelectedRow) — в отличие от deleteMaterialPick (кнопки «Удалить
// материал» в «Параметрах проекта» у Материал корпуса/фасада/Задняя стенка,
// которые знают ТОЛЬКО про decor/back), эта работает с ЛЮБОЙ из пяти
// удаляемых категорий каталога (decors/back/facade/edge/countertop —
// «Стекло» неудаляемо в принципе, см. canDelete в libLeafTableHtml).
// ---------------------------------------------------------------------------

// Коды FACADE_MATERIALS, жёстко зашитые в FACADE_TYPES (.material/.insert) —
// каждый тип фасада (ldsp/mdf/glass4/wood/...) ссылается на конкретный код
// напрямую, спецификация ищет материал по нему без проверки на
// существование. Плюс 'FAC-VENEER' — engine.js (visibleSideMat) возвращает
// этот код НАПРЯМУЮ литералом, в обход FACADE_TYPES. Удаление любого из этих
// кодов молча сломало бы стоимость (и, для FAC-VENEER, деталировку боковины)
// у всех модулей с соответствующим типом фасада — блокируем в
// libDeleteSelectedRow. Позиции фасада, добавленные пользователем через «+
// Добавить материал» (коды вида FAC-NEW-*), в этот список не попадают и
// удаляются свободно.
function libFacadeReservedCodes() {
  const set = { 'FAC-VENEER': true };
  Object.values(FACADE_TYPES || {}).forEach((t) => {
    if (t.material) set[t.material] = true;
    if (t.insert) set[t.insert] = true;
  });
  return set;
}
// Три названия кромки, которыми ВЕСЬ engine.js проставляет присадку по
// умолчанию (EDGE_FRONT/EDGE_BACK/EDGE_MID, см. деструктуризацию в начале
// файла) — specification.js при отсутствующем EDGE_PRICES[type] тихо
// подставляет цену 0 (`EDGE_PRICES[type]?.price ?? 0`), поэтому удаление не
// уронит приложение, но незаметно обнулит реальную стоимость кромки по
// всему проекту — блокируем. Кромка, добавленная пользователем под другим
// названием, удаляется свободно.
const LIB_EDGE_RESERVED_NAMES = [EDGE_FRONT, EDGE_BACK, EDGE_MID];

// Столешница «своего материала» (mod.countertop.decorCode) может ссылаться
// на код из ЛЮБОГО из четырёх массивов — DECORS/BACK_MATERIALS/
// FACADE_MATERIALS/COUNTERTOP_MATERIALS (см. findAnyMaterialByCode/
// countertopMat в engine.js) — при удалении позиции из любого из них
// проверяем ВСЕ модули проекта (не только активный, как делает более старая
// deleteMaterialPick — здесь это дёшево, поле одно и то же для всех четырёх
// категорий) и переключаем совпавшие на первый оставшийся код той же
// категории.
function libResetCountertopRefs(removedCode, fallbackCode) {
  state.modules.forEach((mod) => {
    if (mod.countertop && mod.countertop.decorCode === removedCode) {
      mod.countertop.decorCode = fallbackCode;
    }
  });
}

function libDeleteSelectedRow() {
  const sel = state.libSelectedRow;
  if (!sel) return;
  const cat = window.Modul3D.catalog;
  const lastAlert = () => window.alert('Нельзя удалить последнюю позицию — иначе не из чего будет выбирать.');
  if (sel.group === 'decors') {
    if (DECORS.length <= 1) { lastAlert(); return; }
    const idx = DECORS.findIndex((x) => x.code === sel.key);
    if (idx < 0) return;
    if (!window.confirm(`Удалить материал «${DECORS[idx].name}» из каталога?`)) return;
    const removedCode = DECORS[idx].code;
    DECORS.splice(idx, 1);
    const firstCode = DECORS[0].code;
    if (state.decorCode === removedCode) state.decorCode = firstCode;
    if (state.facadeDecorCode === removedCode) state.facadeDecorCode = firstCode;
    libResetCountertopRefs(removedCode, firstCode);
  } else if (sel.group === 'back') {
    if (BACK_MATERIALS.length <= 1) { lastAlert(); return; }
    const idx = BACK_MATERIALS.findIndex((x) => x.code === sel.key);
    if (idx < 0) return;
    if (!window.confirm(`Удалить материал «${BACK_MATERIALS[idx].name}» из каталога?`)) return;
    const removedCode = BACK_MATERIALS[idx].code;
    BACK_MATERIALS.splice(idx, 1);
    const first = BACK_MATERIALS[0];
    if (state.backCode === removedCode) { state.backCode = first.code; state.backThickness = first.thickness; }
    libResetCountertopRefs(removedCode, first.code);
  } else if (sel.group === 'facade') {
    if (libFacadeReservedCodes()[sel.key]) {
      window.alert('Этот материал фасада используется системными типами фасадов (см. «Тип фасада» у секции) и не может быть удалён.');
      return;
    }
    const keys = Object.keys(cat.FACADE_MATERIALS);
    if (keys.length <= 1) { lastAlert(); return; }
    const it = cat.FACADE_MATERIALS[sel.key];
    if (!it) return;
    if (!window.confirm(`Удалить материал «${it.name}» из каталога?`)) return;
    delete cat.FACADE_MATERIALS[sel.key];
    const firstCode = Object.keys(cat.FACADE_MATERIALS)[0];
    libResetCountertopRefs(sel.key, firstCode);
  } else if (sel.group === 'edge') {
    if (LIB_EDGE_RESERVED_NAMES.indexOf(sel.key) >= 0) {
      window.alert('Эта кромка используется расчётом присадки по умолчанию и не может быть удалена.');
      return;
    }
    const keys = Object.keys(cat.EDGE_PRICES);
    if (keys.length <= 1) { lastAlert(); return; }
    if (!cat.EDGE_PRICES[sel.key]) return;
    if (!window.confirm(`Удалить кромку «${sel.key}» из каталога?`)) return;
    delete cat.EDGE_PRICES[sel.key];
    // Кромка хранится по имени-ключу, а не по стабильному коду — кроме трёх
    // защищённых констант выше (EDGE_FRONT/EDGE_BACK/EDGE_MID), других мест
    // в коде, которые бы ссылались на конкретное имя кромки, не нашлось.
  } else if (sel.group === 'countertop') {
    const arr = cat.COUNTERTOP_MATERIALS || [];
    if (arr.length <= 1) { lastAlert(); return; }
    const idx = arr.findIndex((x) => x.code === sel.key);
    if (idx < 0) return;
    if (!window.confirm(`Удалить столешницу «${arr[idx].name}» из каталога?`)) return;
    const removedCode = arr[idx].code;
    arr.splice(idx, 1);
    libResetCountertopRefs(removedCode, arr[0].code);
  } else {
    return;
  }
  state.libSelectedRow = null;
  recompute();
  scheduleCatalogSave();
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

// Единица измерения — фиксированный список, а не свободный текст: реальные
// товары каталога измеряются только так (листы декоров/фасадов/задней стенки
// — «лист», кромка — «пог.м», фурнитура — «шт», м² пока не занят ни одной
// позицией, но оставлен на будущее — набор согласован с пользователем).
const LIB_UNIT_OPTIONS = ['лист', 'м²', 'пог.м', 'шт'];

// Клик по ячейке → инлайн-инпут (или <select> для поля «unit», см.
// LIB_UNIT_OPTIONS выше); Enter/blur — сохранить, Esc — отменить.
function startCellEdit(cell) {
  if (cell.querySelector('input') || cell.querySelector('select')) return;
  if (cell.dataset.field === 'unit') {
    const cur = cell.dataset.raw != null ? cell.dataset.raw : cell.textContent.trim();
    cell.innerHTML = `<select>${LIB_UNIT_OPTIONS.map((o) => `<option value="${esc(o)}" ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    const select = cell.querySelector('select');
    select.focus();
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      libSaveEdit(cell.dataset.group, cell.dataset.key, cell.dataset.field, select.value);
    };
    select.addEventListener('change', commit);
    select.addEventListener('blur', commit);
    return;
  }
  const type = cell.dataset.type === 'number' ? 'number' : 'text';
  const cur = cell.dataset.raw != null ? cell.dataset.raw : cell.textContent;
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

// Инлайн-переименование узла дерева категорий (значок ✎, см.
// libTreeRowHtml/libRenameNode) — тот же паттерн, что и startCellEdit выше:
// клик превращает название в <input>, Enter/blur сохраняет, Esc отменяет.
function startTreeRename(row) {
  const label = row.querySelector('[data-tree-label]');
  if (!label || label.querySelector('input')) return;
  const cur = label.textContent;
  label.innerHTML = `<input type="text" value="${esc(cur)}">`;
  const input = label.querySelector('input');
  input.focus();
  if (input.select) input.select();
  const topCode = row.dataset.top;
  const path = row.dataset.path ? row.dataset.path.split('::') : [];
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const val = (input.value || '').trim();
    if (val && val !== cur) libRenameNode(topCode, path, val);
    renderLibraryPanel();
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
  // Полная перерисовка вот-вот заменит innerHTML целиком — открытый поповер
  // сортировки/фильтра колонки (см. openColumnFilterMenu) держит ссылку на
  // кнопку/таблицу, которые сейчас пропадут из DOM, закрываем его заранее
  // (тот же приём, что и renderDetailingTable/closeColumnFilterMenu).
  closeColumnFilterMenu();
  document.querySelectorAll('.lib-tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.libtab === state.libraryTab);
  });
  // На «Материалах»/«Фурнитуре» таблицы шире панели «Базы модулей» —
  // #drawer-library переключается на свою (тоже фиксированную, но большую)
  // ширину (см. .lib-wide в style.css: одна и та же ширина для всех таблиц
  // раздела, а не «под самую широкую», как раньше); на «Базе модулей»
  // ширина панели остаётся стандартной. .lib-chars-collapsed — доп. сужение
  // при свёрнутых характеристиках (state.libCharsCollapsed, см.
  // #drawer-library.lib-wide.lib-chars-collapsed в style.css) — реально
  // освобождает место под 3D-сцену, а не просто ужимает ячейки в той же
  // ширине панели.
  const drawer = document.getElementById('drawer-library');
  if (drawer) {
    const wide = state.libraryTab === 'materials' || state.libraryTab === 'hardware';
    drawer.classList.toggle('lib-wide', wide);
    drawer.classList.toggle('lib-chars-collapsed', wide && !!state.libCharsCollapsed);
  }
  if (state.libraryTab === 'materials') panel.innerHTML = libraryMaterialsBlock();
  else if (state.libraryTab === 'hardware') panel.innerHTML = libraryHardwareBlock();
  else if (state.libraryTab === 'facades') panel.innerHTML = libraryFacadesStubBlock();
  else panel.innerHTML = libraryBlock();   // 'modules' — существующая база модулей, без изменений
  bindLibraryEvents();
  applyLibrarySearch();
  // Применяет уже сохранённое состояние поповера сортировки/фильтра (см.
  // openColumnFilterMenu/columnFilterStates) к каждой заново отрисованной
  // таблице листа отдельно (ключ — data-chars-key, тот же, что и у «±
  // характеристики») — иначе после переключения дерева/добавления позиции
  // ранее выбранный фильтр сбросился бы визуально, хотя состояние осталось.
  panel.querySelectorAll('table.lib-table[data-chars-key]').forEach((table) => {
    const tableKey = table.dataset.charsKey;
    const rowsCache = libFilterRowsCache[tableKey] || [];
    const colspan = table.querySelectorAll('colgroup col').length || 1;
    applyColumnFilterAndSort(table, tableKey, rowsCache, colspan, 'Нет позиций, соответствующих фильтру');
  });
  refreshColumnFilterHeaderIndicators(panel);
}

// Точечное применение выделения строки в DOM — общая часть между
// libApplyRowSelection (тумблер, см. ниже) и libSelectRow (только
// установка, без снятия — см. ниже). БЕЗ полной renderLibraryPanel(): она
// случилась бы ПОСЛЕ того, как startCellEdit уже синхронно вставил <input>
// в кликнутую ячейку (см. initLibraryPanel), и стёрла бы его раньше, чем
// пользователь успел бы что-то набрать. Поэтому точечно: снять
// .lib-row-selected со старой строки, поставить на новую (next === null —
// просто снятие), и синхронизировать disabled/title у КАЖДОЙ видимой кнопки
// «− Удалить материал» (у каждого листа своя таблица внутри .lib-leaf-body,
// см. libLeafTableHtml — таблиц одновременно открыто может быть несколько).
function libApplyRowSelectionDom(panel, next) {
  state.libSelectedRow = next;
  panel.querySelectorAll('tr[data-row-key]').forEach((tr) => {
    const isSel = !!next && tr.dataset.rowGroup === next.group && tr.dataset.rowKey === next.key;
    tr.classList.toggle('lib-row-selected', isSel);
  });
  panel.querySelectorAll('.lib-row-del').forEach((btn) => {
    const body = btn.closest('.lib-leaf-body');
    const table = body ? body.querySelector('table.lib-table') : null;
    const hasSel = !!(next && table && Array.from(table.querySelectorAll('tr[data-row-key]'))
      .some((tr) => tr.dataset.rowGroup === next.group && tr.dataset.rowKey === next.key));
    btn.disabled = !hasSel;
    if (hasSel) btn.removeAttribute('title');
    else btn.title = LIB_ROW_DEL_HINT;
  });
}

// Клик по «остальной части» строки — НЕ редактируемая ячейка (название
// кромки, «—» в отсутствующей колонке и т.п., см. initLibraryPanel) —
// тумблер: повторный клик по уже выделенной строке снимает выделение, как
// и раньше. Используется только там, где второго клика по той же строке
// заведомо означает «отменить выбор», а не «поправить что-то ещё в ней».
function libApplyRowSelection(panel, group, key) {
  const sel = state.libSelectedRow;
  const same = !!(sel && sel.group === group && sel.key === key);
  libApplyRowSelectionDom(panel, same ? null : { group, key });
}

// Клик по РЕДАКТИРУЕМОЙ ячейке (Наименование/Длина/Ширина/Толщина/Цена, см.
// initLibraryPanel/startCellEdit) — ТОЛЬКО устанавливает выделение на эту
// строку, никогда не снимает его. Строка почти целиком состоит из
// редактируемых ячеек, поэтому клик по второй (и следующей) ячейке уже
// выделенной строки — например, сначала «Наименование», потом «Толщина» —
// должен просто подтвердить выделение и открыть редактирование ячейки, а
// не сбросить его тумблером (для явного снятия есть клик по остальной части
// строки, см. libApplyRowSelection выше).
function libSelectRow(panel, group, key) {
  const sel = state.libSelectedRow;
  if (sel && sel.group === group && sel.key === key) return;
  libApplyRowSelectionDom(panel, { group, key });
}

// «Двери» (вкладка data-libtab="facades", см. index.html) — заглушка: фасад
// не материал, а отдельное изделие со своими параметрами (толщина, тип,
// врезка стекла и т.п.), полноценная панель — отдельная задача на будущее.
// Пока только заголовок (тот же текст, что на кнопке вкладки — раньше
// расходился с ней: кнопка «Фасады-двери» стала «Двери», а этот заголовок
// нет) и подпись.
function libraryFacadesStubBlock() {
  return `<h3>Двери</h3><p class="hint">Этот раздел скоро появится.</p>`;
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
    // Переключили вкладку — открытые таблицы прежней вкладки скрылись,
    // выделенная строка (см. state.libSelectedRow) больше ни к чему не
    // относится.
    state.libSelectedRow = null;
    renderLibraryPanel();
  });
  const search = document.getElementById('librarySearch');
  if (search) search.addEventListener('input', applyLibrarySearch);

  panel.addEventListener('click', (e) => {
    // Клик внутри активного инпута инлайн-переименования узла дерева (см.
    // startTreeRename) — не должен провалиться в обработку клика по строке
    // ниже (иначе строка переключилась бы посреди редактирования).
    if (e.target.closest('.lib-tree-name input')) return;
    // ✎/+/× узла дерева категорий (см. libTreeRowHtml) — ПЕРЕД обработкой
    // клика по всей строке ниже, иначе клик по значку ещё и переключил бы
    // сам узел.
    const treeIcon = e.target.closest('.lib-tree-ic');
    if (treeIcon) {
      const row = treeIcon.closest('[data-tree-node]');
      if (!row) return;
      const topCode = row.dataset.top;
      const path = row.dataset.path ? row.dataset.path.split('::') : [];
      if (treeIcon.dataset.treeRename != null) startTreeRename(row);
      else if (treeIcon.dataset.treeAdd != null) libAddChildNode(topCode, path);
      else if (treeIcon.dataset.treeDel != null) libDeleteNode(topCode, path);
      return;
    }
    // Клик по всей строке узла дерева (см. libTreeRowHtml) — смысл зависит
    // от вида узла: категория/ветка разворачивает-сворачивает своих прямых
    // детей, лист включает/выключает фокус на себе (см. state.libCatOpen/
    // libCollapsed/libActiveLeaf и коммент у libTopCategoryHtml).
    const treeRow = e.target.closest('[data-tree-node]');
    if (treeRow) {
      const topCode = treeRow.dataset.top;
      const path = treeRow.dataset.path ? treeRow.dataset.path.split('::') : [];
      const kind = treeRow.dataset.kind;
      // Смена того, какая таблица(-ы) сейчас видна — выделенная строка (см.
      // state.libSelectedRow) больше не обязательно принадлежит видимой
      // таблице, сбрасываем в обоих случаях (клик по категории целиком и
      // клик по листу — единственные места, где набор видимых таблиц
      // реально меняется; клик по обычной ветке только раскрывает/сворачивает
      // поддерево, таблицы внутри как были видны, так и остаются).
      if (kind === 'top') { state.libCatOpen[topCode] = !state.libCatOpen[topCode]; state.libSelectedRow = null; }
      else if (kind === 'leaf') {
        const key = path.join('::');
        state.libActiveLeaf[topCode] = state.libActiveLeaf[topCode] === key ? null : key;
        state.libSelectedRow = null;
      } else {
        libToggleNode(topCode, path);
      }
      renderLibraryPanel();
      return;
    }
    // Заголовок-тумблер «± характеристики» (см. libTableHead) — общий на всю
    // Библиотеку (state.libCharsCollapsed — булево, не по ключу таблицы):
    // клик в ЛЮБОЙ из одновременно открытых таблиц сворачивает/разворачивает
    // колонки Длина/Ширина/Толщина сразу везде и сужает саму панель (см.
    // .lib-chars-collapsed в renderLibraryPanel/style.css).
    const charsToggle = e.target.closest('.lib-chars-toggle');
    if (charsToggle) {
      state.libCharsCollapsed = !state.libCharsCollapsed;
      renderLibraryPanel();
      return;
    }
    // Кнопка-треугольник сортировки/фильтра столбца (Наименование/Длина/
    // Ширина/Толщина/Цена, см. libTableHead) — тот же поповер, что и в
    // «Деталировке» (см. openColumnFilterMenu), только tableKey свой у
    // каждой открытой таблицы (data-filter-key === data-chars-key листа).
    const filterBtn = e.target.closest('.dth-filter-btn');
    if (filterBtn) {
      e.stopPropagation();
      const tableKey = filterBtn.dataset.filterKey;
      const colIndex = Number(filterBtn.dataset.col);
      const rowsCache = libFilterRowsCache[tableKey] || [];
      const uniqueValues = Array.from(new Set(rowsCache.map((row) => row.vals[colIndex])))
        .sort((a, b) => a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' }));
      openColumnFilterMenu({
        tableKey,
        colIndex,
        btnEl: filterBtn,
        uniqueValues,
        onChange: () => {
          const table = filterBtn.closest('table.lib-table');
          if (table) {
            const colspan = table.querySelectorAll('colgroup col').length || 1;
            applyColumnFilterAndSort(table, tableKey, libFilterRowsCache[tableKey] || [], colspan, 'Нет позиций, соответствующих фильтру');
          }
          refreshColumnFilterHeaderIndicators(panel);
        },
      });
      return;
    }
    // «+ Добавить материал/кромку/столешницу» под таблицей листа (см.
    // libLeafTableHtml/libAddRow) — data-add-path несёт полный путь листа
    // (пуст только у 'hwadd:*' — у фурнитуры дерева категорий нет).
    const addBtn = e.target.closest('.lib-add');
    if (addBtn) {
      const pathStr = addBtn.dataset.addPath || '';
      libAddRow(addBtn.dataset.add, pathStr ? pathStr.split('::') : []);
      return;
    }
    // «− Удалить материал» под таблицей листа (см. libLeafTableHtml) —
    // работает только с уже выделенной кликом по строке позицией (см. ветку
    // ниже), кнопка неактивна (disabled), пока ничего не выбрано.
    const delRowBtn = e.target.closest('.lib-row-del');
    if (delRowBtn) { libDeleteSelectedRow(); return; }
    const swatch = e.target.closest('.lib-swatch');
    if (swatch) { openLibImagePicker(swatch.dataset.swatchGroup, swatch.dataset.swatchKey); return; }
    // «Выбрать» — только в режиме подбора материала из «Параметры проекта»
    // (см. state.libPickTarget/libPickMaterial): у «Листовых материалов»
    // колонка видна для любой роли подбора, у «Столешниц» — только когда
    // подбирают роль countertopDecor (см. pickMode для isCountertop в
    // libLeafTableHtml).
    const pickBtn = e.target.closest('.lib-pick-btn');
    if (pickBtn) { libPickMaterial(pickBtn.dataset.pickGroup, pickBtn.dataset.pickCode); return; }
    // Клик по редактируемой ячейке (Наименование/Длина/Ширина/Толщина/Цена —
    // почти вся строка) теперь ОДНОВРЕМЕННО выделяет строку (см.
    // libSelectRow — только УСТАНОВКА, не тумблер: клик по второй ячейке уже
    // выделенной строки, например сначала «Наименование», потом «Толщина»,
    // не должен снимать выделение) И открывает инлайн-редактирование (см.
    // startCellEdit) — раньше делалось только второе, и выделить строку
    // (чтобы разблокировать «− Удалить материал») было практически негде.
    // Клик ВНУТРИ уже открытого <input>/<select> (например, переставить
    // курсор) — не должен ещё и трогать выделение: startCellEdit сам не
    // пересоздаёт уже открытый инпут (см. его же ранний return).
    const cell = e.target.closest('.lib-edit-cell');
    if (cell) {
      if (!cell.querySelector('input') && !cell.querySelector('select')) {
        const row = cell.closest('tr[data-row-key]');
        if (row) libSelectRow(panel, row.dataset.rowGroup, row.dataset.rowKey);
      }
      startCellEdit(cell);
      return;
    }
    // Ссылка-источник (см. libSourceLinkCell) открывается сама (обычная
    // <a target="_blank">) — не должна ЕЩЁ и выделять строку под собой.
    if (e.target.closest('.lib-source-link')) return;
    // Клик по остальной части строки таблицы (нередактируемые ячейки —
    // например, название кромки или «—» в отсутствующей колонке) —
    // выделение для «− Удалить материал» выше (см. libApplyRowSelection).
    // Повторный клик по уже выделенной строке снимает выделение.
    const dataRow = e.target.closest('tr[data-row-key]');
    if (dataRow) { libApplyRowSelection(panel, dataRow.dataset.rowGroup, dataRow.dataset.rowKey); return; }
  });

  // Переключатель единицы цены (см. libPriceUnitHeaderHtml) — общий на всю
  // Библиотеку (state.libPriceUnit), поэтому полная перерисовка, а не
  // точечное обновление одной таблицы. Фильтр по столбцам (Длина/Ширина/
  // Толщина/Наименование/Цена) теперь не отдельный <select> с `change`, а
  // поповер сортировки/фильтра (см. .dth-filter-btn выше, в делегированном
  // `click`) — старый механизм убран целиком.
  panel.addEventListener('change', (e) => {
    const priceUnitSel = e.target.closest('.lib-price-unit-select');
    if (priceUnitSel) {
      state.libPriceUnit = priceUnitSel.value;
      renderLibraryPanel();
      return;
    }
  });

  initLibImageInput();
  renderLibraryPanel();
}

// ---------------------------------------------------------------------------
// Панель «Столешница» — отдельный самостоятельный инструмент (по образцу
// «Библиотеки»: своя кнопка на рейке data-panel="countertop", свой drawer
// #drawer-countertop, свой контейнер #countertopPanel), а не поле в обычной
// панели «Параметры» текущего модуля. Показывает НАПОЛЬНЫЕ тумбы всего
// проекта чекбоксами и применяет общие настройки (материал/глубина/свесы)
// сразу ко ВСЕМ отмеченным модулям — массовая правка на группу, а не на весь
// проект и не на одну тумбу. Данные пишутся напрямую в mod.countertop
// (см. newModule()/state.modules — обычное поле модуля, поэтому переживает
// Undo/Redo и сохранение проекта бесплатно, как и partOverrides) и в
// project-level state.countertopCornerJoint (см. объявление state выше).
// Расчёт (материал не найден, разная глубина у соседей, компакт без верхней
// планки под стыком и т.п.) — целиком в engine.js, сюда прилетает готовым
// через currentModel.warnings (см. renderWarnings) и
// currentModel.hardwareContext.countertopJoints — эта панель ничего не
// считает сама.
// ---------------------------------------------------------------------------

// Тумба подходит под столешницу, если стоит на полу — ТА ЖЕ проверка, что и
// isFloorStandingBase в engine.js (buildModuleParts: p.base.type). Модуль без
// такого основания (например, будущий навесной шкаф) в список кандидатов не
// попадает — показывается серым с пояснением «не тумба» (countertopModuleRow).
function moduleHasFloorBase(mod) {
  return !!mod && (mod.baseType === 'plinth' || mod.baseType === 'legsPlinth' || mod.baseType === 'legs');
}

// Дефолт свеса СПЕРЕДИ при первом включении столешницы (когда наследовать
// не у кого — группа отмеченных тумб ещё пуста) зависит от типа мебели, как
// и свес сзади (см. engine.js: autoOverhangBack): у кухни (family:'kitchen')
// столешница по норме выступает над фасадом на 20 мм; у любой другой мебели
// (тумба, комод) — заподлицо с фасадом, свеса не бывает (подтверждено
// пользователем). Один источник правды для обоих мест, где нужен этот
// дефолт — insertModule() и чекбокс включения в панели «Столешница».
function defaultCountertopOverhangFront(mod) {
  return mod && mod.family === 'kitchen' ? 20 : 0;
}

// Дефолтный код столешницы при первом включении — раньше был захардкожен
// как 'CTOP-LDSP38-600' (позиция каталога, которая гарантированно
// существовала). С появлением кнопки «− Удалить материал» в Библиотеке
// пользователь может удалить именно её — литерал стал бы ссылкой на
// несуществующий код. Берём первую доступную позицию каталога на момент
// вызова (тот же приём, что и в deleteMaterialPick — arr[0].code после
// удаления). Пустой каталог столешниц — вырожденный случай (последнюю
// позицию удалить нельзя нигде в UI), но на всякий случай возвращаем
// undefined, а не падаем.
function defaultCountertopDecorCode() {
  const arr = (window.Modul3D.catalog && window.Modul3D.catalog.COUNTERTOP_MATERIALS) || [];
  return (arr[0] || {}).code;
}

// Тумба, чью столешницу сейчас показывает/редактирует панель — ВСЕГДА
// текущий активный модуль (state.activeModule), тот же, что подсвечен в 3D
// и в «Параметры проекта» — единое понятие «какая тумба сейчас в фокусе» на
// всё приложение. До 2026-09-06 было иначе: настройки применялись сразу ко
// ВСЕЙ группе отмеченных чекбоксом тумб — пользователь путался, меняя
// материал одной тумбы и молча меняя его у всех остальных отмеченных.
// null — активный модуль не тумба (навесной) и столешницу поставить нельзя.
function activeCountertopModule() {
  const mod = state.modules[state.activeModule];
  return moduleHasFloorBase(mod) ? mod : null;
}

// Текущие значения полей — читаются НАПРЯМУЮ из countertop активной тумбы
// (никакого «общего для группы» смысла, в отличие от старого
// countertopPrimarySettings). mod может быть null (нет активной тумбы под
// столешницу) — тогда возвращаем дефолты, но вызывающий код их не покажет
// (settings рендерится только когда activeCountertopModule() не null).
function countertopFieldsOf(mod) {
  const src = (mod && mod.countertop) || {};
  return {
    // double — сдвоенная столешница (2 листа ТОГО ЖЕ материала, что выбран в
    // decorCode, склеенных вместе). decorCode — код позиции каталога: либо
    // готовая столешница (COUNTERTOP_MATERIALS, коды CTOP-...) — для неё
    // сдвоение неприменимо, галочка в UI не показывается (см.
    // isCatalogCountertop в countertopPanelBlock), либо обычный лист декора
    // (DECORS/FACADE_MATERIALS/BACK_MATERIALS) — только для него доступна
    // галочка «Сдвоенная». Без дефолта на пустое значение: undefined
    // означает «пользователь ещё не выбрал». Толщина/глубина отдельно тут не
    // хранятся — берутся живьём из каталога по decorCode и показываются в
    // countertopPanelBlock() рядом с названием материала.
    double: !!src.double,
    decorCode: src.decorCode,
    overhangFront: src.overhangFront !== undefined ? src.overhangFront : defaultCountertopOverhangFront(mod),
    overhangLeft: src.overhangLeft !== undefined ? src.overhangLeft : 0,
    overhangRight: src.overhangRight !== undefined ? src.overhangRight : 0,
    // overhangBack БЕЗ дефолта — undefined означает «посчитать автоматически»
    // (engine.js: глубина материала минус корпус минус фасад минус свес
    // спереди), см. countertopModuleRow/поле ctopOverhangBack ниже.
    overhangBack: src.overhangBack,
  };
}

// Материал столешницы «свой материал» может ссылаться на код из ЛЮБОГО из
// трёх списков каталога (DECORS, FACADE_MATERIALS, BACK_MATERIALS) — та же
// тройка, что уже ищет specification.js для листовых материалов (см. там
// `known`), и то же самое ищет countertopMat() в engine.js. Без копирования
// в отдельный массив (см. libPickMaterial/deleteMaterialPick ниже) —
// копирование раньше плодило видимый дубль в Библиотеке (найдено
// пользователем 2026-09-06).
function findAnyMaterialByCode(code) {
  if (!code) return null;
  const facade = window.Modul3D.catalog.FACADE_MATERIALS || {};
  return [].concat(DECORS, BACK_MATERIALS, Object.values(facade)).find((d) => d.code === code) || null;
}

// Короткая сводка «Стыков: N прямых, M угловых» — из уже готового
// currentModel.hardwareContext.countertopJoints (joinCountertopSeams в
// engine.js). Не критично для панели: если модели ещё нет или стыков нет —
// просто ничего не показываем.
function countertopJointsSummaryBlock() {
  const joints = (currentModel && currentModel.hardwareContext && currentModel.hardwareContext.countertopJoints) || [];
  if (!joints.length) return '';
  const straight = joints.filter((j) => j.type === 'straight').length;
  const corner = joints.filter((j) => j.type === 'corner').length;
  return `<div class="hint">Стыков столешницы: ${straight} прямых, ${corner} угловых.</div>`;
}

// Одна строка списка модулей: чекбокс для напольной тумбы (вкл/выкл
// столешницу ИМЕННО у неё), серая неактивная строка с пояснением — для
// всего остального (см. moduleHasFloorBase). Клик по строке (не по
// чекбоксу) делает тумбу активной — её материал/свесы показывает settings
// ниже (см. bindCountertopEvents: data-ctop-select).
function countertopModuleRow(mod, i) {
  if (!moduleHasFloorBase(mod)) {
    return `<div class="ctop-mod-row disabled" title="Не тумба — столешница ставится только на напольное основание (цоколь/опоры)">
      <input type="checkbox" disabled>
      <span>${esc(mod.name)} <span class="dim">— не тумба</span></span>
    </div>`;
  }
  const checked = !!(mod.countertop && mod.countertop.enabled);
  const active = i === state.activeModule;
  return `<div class="ctop-mod-row ${active ? 'active' : ''}" data-ctop-select="${i}">
    <label class="checkbox-inline"><input type="checkbox" data-ctop-toggle="${i}" ${checked ? 'checked' : ''}></label>
    <span>${esc(mod.name)}</span>
  </div>`;
}

function countertopPanelBlock() {
  if (!state.modules.length) {
    return `<div class="hint">Проект пуст. Сначала добавьте тумбы — кнопкой «Библиотека» на рейке слева.</div>`;
  }
  const rows = state.modules.map((m, i) => countertopModuleRow(m, i)).join('');
  const mod = activeCountertopModule();
  const enabled = !!(mod && mod.countertop && mod.countertop.enabled);

  let settings = '';
  if (mod && enabled) {
    const s = countertopFieldsOf(mod);
    const decorItem = findAnyMaterialByCode(s.decorCode) || window.Modul3D.catalog.findCountertopMaterialByCode(s.decorCode);
    const isCatalogCountertop = !!(s.decorCode && window.Modul3D.catalog.findCountertopMaterialByCode(s.decorCode));
    const isPlainDecor = !!decorItem && !isCatalogCountertop;

    settings = `
      <h3>Материал столешницы — ${esc(mod.name)}</h3>
      <div class="field">
        <div class="ctop-decor-current-row">
          <div class="ctop-decor-current" title="${decorItem ? esc(decorItem.name) : ''}">${decorItem ? esc(decorItem.name) : '<span class="dim">не выбран</span>'}</div>
          <button type="button" class="link-btn" data-material-add="countertopDecor">Изменить</button>
        </div>
        ${decorItem && decorItem.thickness !== undefined
          ? `<div class="ctop-decor-thickness">Толщина листа: ${decorItem.thickness} мм${decorItem.depth !== undefined ? `, глубина ${decorItem.depth} мм` : ''}</div>` : ''}
      </div>
      ${isPlainDecor ? `
      <div class="field">
        <label class="checkbox-inline"><input type="checkbox" id="ctopDouble" ${s.double ? 'checked' : ''}> Сдвоенная (2 листа этого материала)</label>
      </div>` : ''}
      <div class="hint">Если толщина БОЛЬШЕ 18 мм — крышка корпуса убирается, столешница крепится
        растиксами в торец боковин (как обычная столешница). Если толщина 18 мм и меньше — крышка
        корпуса остаётся, а столешница садится на клей, как компакт-плита.</div>

      <h3>Свесы, мм</h3>
      <div class="field-row4">
        <div class="field"><label>Спереди</label><input id="ctopOverhangFront" type="number" step="1" value="${s.overhangFront}"></div>
        <div class="field"><label>Слева</label><input id="ctopOverhangLeft" type="number" step="1" value="${s.overhangLeft}"></div>
        <div class="field"><label>Справа</label><input id="ctopOverhangRight" type="number" step="1" value="${s.overhangRight}"></div>
        <div class="field"><label>Сзади</label><input id="ctopOverhangBack" type="number" step="1"
          placeholder="авто" value="${s.overhangBack !== undefined && s.overhangBack !== null ? s.overhangBack : ''}"></div>
      </div>
      <div class="hint">«Спереди» — свес над фасадом: для кухни типично 20 мм, для остальной мебели
        (тумба, комод) — обычно 0, заподлицо с фасадом. «Сзади» пустое поле — глубина считается
        автоматически: у кухни — чтобы совпасть с глубиной купленного листа материала (корпус там
        специально мельче столешницы), у остальной мебели — 0, заподлицо с корпусом (он уже стоит
        вплотную к стене). Оба поля можно переопределить вручную — например, для стола.</div>`;
  }

  // «Соединение на углу» — настройка ОБЩАЯ на проект (влияет на любой
  // угловой стык между двумя тумбами), а не свойство конкретной тумбы —
  // показываем всегда, независимо от того, у какой тумбы сейчас открыты
  // настройки материала выше (или открыты ли вообще).
  const cornerBlock = `
    <h3>Соединение на углу</h3>
    <div class="field">
      <select id="ctopCornerJoint">
        <option value="strip" ${state.countertopCornerJoint !== 'eurogroove' ? 'selected' : ''}>Соединительная планка</option>
        <option value="eurogroove" ${state.countertopCornerJoint === 'eurogroove' ? 'selected' : ''}>Еврозапил + стяжки</option>
      </select>
      <div class="hint">Влияет только на угловые Г-образные стыки столешницы между тумбами —
        прямые стыки в линию всегда идут через стяжку автоматически. Для компакт-плиты стык
        всегда клей/герметик, вариантов нет.</div>
    </div>
    ${countertopJointsSummaryBlock()}`;

  let statusHint;
  if (!mod) statusHint = `<div class="hint">Выберите тумбу в списке выше — навесные модули под столешницу не годятся.</div>`;
  else if (!enabled) statusHint = `<div class="hint">У тумбы «${esc(mod.name)}» столешница выключена — отметьте галочку слева от названия, чтобы задать материал.</div>`;

  return `
    <h3>Тумбы проекта</h3>
    <div class="hint">Отметьте галочкой тумбы, которым нужна столешница, и выберите тумбу кликом —
      материал и свесы ниже относятся только к ВЫБРАННОЙ тумбе, а не ко всем отмеченным.</div>
    <div class="ctop-mod-list">${rows}</div>
    ${settings || statusHint}
    ${cornerBlock}`;
}

function renderCountertopPanel() {
  const panel = document.getElementById('countertopPanel');
  if (!panel) return;
  panel.innerHTML = countertopPanelBlock();
  bindCountertopEvents();
}

// Слушатели перевешиваются на каждый renderCountertopPanel() (как и у
// drawersPanelBlock/bindPanelEvents — элементы каждый раз новые после
// innerHTML) — сам recompute() уже перерисовывает панель за нас (см. хук в
// конце recompute()), поэтому обработчики здесь только меняют состояние и
// зовут recompute(), а не renderCountertopPanel() напрямую.
function bindCountertopEvents() {
  const panel = document.getElementById('countertopPanel');
  if (!panel) return;

  // Клик по строке тумбы (не по чекбоксу — у него своя обработка ниже)
  // делает её активной (state.activeModule) — то же самое понятие «тумба в
  // фокусе», что и вкладки модулей/клик по 3D, поэтому синхронизируем и
  // подсветку в 3D. Панель остаётся открытой на Столешнице (в отличие от
  // клика по вкладке модуля, здесь НЕ переключаем state.panelView).
  panel.querySelectorAll('[data-ctop-select]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('input')) return;
      const idx = Number(row.dataset.ctopSelect);
      if (idx === state.activeModule) return;
      state.activeModule = idx;
      state.selected = (state.modules[idx] || {}).name || null;
      exitIsolation();
      if (viewer && currentModel) viewer.render(currentModel, viewOpts());
      renderCountertopPanel();
    });
  });

  panel.querySelectorAll('[data-ctop-toggle]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const idx = Number(e.currentTarget.dataset.ctopToggle);
      const mod = state.modules[idx];
      if (!mod || !moduleHasFloorBase(mod)) return;
      if (!mod.countertop) mod.countertop = {};
      mod.countertop.enabled = e.currentTarget.checked;
      if (mod.countertop.enabled) {
        // Дефолты ПРИ ПЕРВОМ включении на ЭТОЙ тумбе, только если поля ещё
        // не заданы (тумбу могли включать/выключать раньше). Больше НЕ
        // наследуем у других отмеченных тумб — у каждой свои настройки
        // (см. activeCountertopModule/countertopFieldsOf выше, изменено
        // 2026-09-06 по просьбе пользователя — раньше значения приходили
        // от группы, это путало).
        if (!mod.countertop.decorCode && !mod.countertop.double) mod.countertop.decorCode = defaultCountertopDecorCode();
        if (mod.countertop.overhangFront === undefined) mod.countertop.overhangFront = defaultCountertopOverhangFront(mod);
        if (mod.countertop.overhangLeft === undefined) mod.countertop.overhangLeft = 0;
        if (mod.countertop.overhangRight === undefined) mod.countertop.overhangRight = 0;
      }
      // Включили столешницу на тумбе — логично сразу показать её настройки
      // ниже, а не оставлять открытой ту, что была выбрана до этого.
      state.activeModule = idx;
      state.selected = mod.name || null;
      recompute();
    });
  });

  // Дальше — поля материала/свесов АКТИВНОЙ тумбы. Если активной тумбы нет
  // или у неё столешница выключена, этих элементов в DOM просто нет —
  // document.getElementById вернёт null, и все `if (xxxEl)` ниже безопасно
  // ничего не сделают.
  const activeMod = activeCountertopModule();
  const activeCt = activeMod && activeMod.countertop;

  // «Сдвоенная» — два листа ВЫБРАННОГО материала столешницы (decorCode),
  // склеенных вместе; строка материала видна независимо от галочки (см.
  // countertopPanelBlock) — сама галочка в DOM есть, только когда decorCode
  // указывает на обычный лист декора (isPlainDecor), а не на готовую позицию
  // каталога столешниц (CTOP-код), поэтому здесь просто переключаем double.
  const doubleEl = document.getElementById('ctopDouble');
  if (doubleEl) doubleEl.addEventListener('change', (e) => {
    activeCt.double = e.target.checked;
    recompute();
  });

  // «Изменить» под текущим материалом столешницы (см. countertopPanelBlock,
  // data-material-add="countertopDecor") — открывает Библиотеку в режиме
  // подбора (openMaterialPicker), тот же обработчик, что и у «+ Добавить
  // материал» в materialsBlock, но привязка ограничена ЭТОЙ панелью
  // (querySelectorAll на panel, не на весь document — задваивать обработчики
  // на чужих кнопках не нужно; аналогично bindPanelEvents теперь скоуплен на
  // #paramsPanel — см. правку от 2026-09-06). Своей кнопки «Удалить» здесь
  // нет (убрано по просьбе пользователя 2026-09-06, см. deleteMaterialPick) —
  // обычного select'а декора («ctopDecor») тоже больше нет, текущий материал
  // показывается текстом (ctop-decor-current), выбор только через
  // библиотеку, без промежуточного дропдауна.
  panel.querySelectorAll('[data-material-add]').forEach((btn) => {
    btn.addEventListener('click', () => openMaterialPicker(btn.dataset.materialAdd));
  });

  const OVERHANG_FIELD_BY_ID = {
    ctopOverhangFront: 'overhangFront', ctopOverhangLeft: 'overhangLeft',
    ctopOverhangRight: 'overhangRight', ctopOverhangBack: 'overhangBack',
  };
  Object.keys(OVERHANG_FIELD_BY_ID).forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', (e) => {
      const field = OVERHANG_FIELD_BY_ID[id];
      // «Сзади» — пустое поле означает «считать автоматически» (engine.js),
      // это НЕ то же самое, что явные 0 (заподлицо с корпусом) — поэтому
      // очистка поля должна удалять переопределение, а не записывать 0.
      if (field === 'overhangBack' && e.target.value.trim() === '') {
        delete activeCt.overhangBack;
      } else {
        activeCt[field] = Number(e.target.value) || 0;
      }
      recompute();
    });
  });

  const cornerEl = document.getElementById('ctopCornerJoint');
  if (cornerEl) cornerEl.addEventListener('change', (e) => {
    state.countertopCornerJoint = e.target.value;
    recompute();
  });
}

// Вызывается один раз при старте (см. блок «Запуск» в конце файла), как и
// initLibraryPanel() — контейнер #countertopPanel статичен в index.html,
// дальше содержимое живёт через renderCountertopPanel()/recompute().
function initCountertopPanel() {
  if (!document.getElementById('countertopPanel')) return;
  renderCountertopPanel();
}

// Якорь навигации: вкладки модулей (Модуль 1/Модуль 2/«+»). Виден ВСЕГДА,
// независимо от того, какой экран (panelView) сейчас показан ниже.
// Отменить/Вернуть/Удалить модуль переехали в шапку программы (иконки рядом
// с «Сохранить»/«Открыть» — см. index.html и initHeaderControls() ниже);
// «Библиотека» — отдельная панель со своей кнопкой на рейке.
// Ряд не переносится на вторую строку — при большом числе модулей (и так
// бывает: 50+) перенос заполнил бы всю панель. Вместо этого ряд скроллится
// по горизонтали (nowrap + overflow-x, колесо мыши — см. bindPanelEvents),
// как и .sec-tabs у секций ниже. «+» вынесена из скроллящегося ряда в
// отдельную ячейку .mod-tabs-row, чтобы всегда быть на виду, а не уезжать
// за край при прокрутке; строка поиска (тоже вне фильтруемого ряда) видна,
// только когда модулей больше 8 — для меньших проектов она не нужна.
function moduleTabsBlock(mod) {
  const showSearch = state.modules.length > 8;
  return `
    <h3>Модули проекта</h3>
    ${showSearch ? `
    <div class="drawer-search mod-search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6"/><path d="M15.5 15.5 20 20"/></svg>
      <input type="search" id="moduleSearch" placeholder="Поиск модуля…" autocomplete="off" value="${esc(state.moduleSearchQuery || '')}">
    </div>` : ''}
    <div class="mod-tabs-row">
      <div class="mod-tabs" id="modTabs">
        ${state.modules.map((m, i) =>
          `<button class="mod-tab tip tip-down ${i === state.activeModule ? 'active' : ''}" data-mod="${i}"
                   data-search="${esc(m.name.toLowerCase())}" type="button"
                   data-tip="ПКМ: переименование">${esc(m.name)}${m.rotation ? ` ↻${m.rotation}°` : ''}</button>`
        ).join('')}
      </div>
      <button class="mod-add tip tip-down" id="addModule" type="button" data-tip="Добавить модуль" aria-label="Добавить модуль">+</button>
    </div>`;
}

// Фильтр строки поиска над вкладками модулей — та же логика, что и
// applyLibrarySearch() у панели «Библиотека»: скрывает несовпавшие кнопки
// через .dim-out, без перерисовки панели (иначе поле теряло бы фокус на
// каждом введённом символе). Значение сохраняем в state.moduleSearchQuery,
// чтобы пережить следующую перерисовку панели (recompute() дальше по коду
// перерисовывает её целиком).
function applyModuleSearch() {
  const input = document.getElementById('moduleSearch');
  const list = document.getElementById('modTabs');
  if (!input || !list) return;
  state.moduleSearchQuery = input.value || '';
  const q = state.moduleSearchQuery.trim().toLowerCase();
  list.querySelectorAll('.mod-tab').forEach((el) => {
    el.classList.toggle('dim-out', !!q && el.getAttribute('data-search').indexOf(q) < 0);
  });
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

    <h3>Конструктив модуля</h3>
    <div class="field-row3">
      <div class="field"><label>Высота</label><input id="m-height" type="number" step="10" value="${mod.height}"></div>
      <div class="field"><label>Ширина</label><input id="m-width" type="number" step="10" value="${mod.width}"></div>
      <div class="field"><label>Глубина</label><input id="m-depth" type="number" step="10" value="${mod.depth}"></div>
    </div>

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

    <div id="sectionsList"></div>`;
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
    // Фолбэк на chosenIdx:0 (как у остальных kind) здесь НЕ годится: если
    // именно этот отсек только что лишили фасада (facade:'open' — открыли в
    // редакторе отсека и убрали дверь, не закрывая панель), engine.js больше
    // не строит для него дверь вообще — candidates её не найдёт ни под каким
    // индексом. chosenIdx:0 в таком случае молча подставил бы ПЕРВУЮ ПОПАВШУЮСЯ
    // дверь другой секции/отсека, и бирюзовая подсветка (isPartHi ниже по
    // viewOpts) перескочила бы на неё — заметный баг, раз теперь отсек можно
    // менять без входа в фокус. Ничего не найдено — оставляем -1 (chosen:null,
    // подсветки нет), это честнее случайной чужой двери.
    chosenIdx = candidates.findIndex((c) =>
      c.part.sectionIndex === sp.sectionIndex && c.part.zoneIndex === sp.zoneIndex);
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

// Компактный редактор ОДНОГО отсека — открывается пунктом «Редактировать
// отсек» в контекстном меню клика по отсеку в 3D (viewer.onSelectZone, вне
// Focus Mode, см. openPartEditor(module, 'door', ...) без asPart). Это
// единственное место, где настраиваются отсеки многозонного фасада (в
// сайдбаре, см. renderSectionsList, для такой секции — только подсказка со
// ссылкой сюда): показывает поля только того отсека, по которому кликнули в
// 3D. Модель данных фасада (sec.facade / sec.doorZones[]) — не в
// mod.partOverrides, поэтому это отдельная от partBlock() функция, не через
// OVERRIDABLE_PART_KINDS.
function doorZoneEditorScreen(mod, sectionIndex, zoneIndex) {
  const sec = mod.sections[sectionIndex];
  if (!sec) {
    return `
      ${backLinkBlock()}
      <h3>Фасад</h3>
      <div class="hint">Секция не найдена — возможно, параметры модуля изменились.
      Кликните по отсеку в 3D ещё раз.</div>`;
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
        этого модуля. Число отсеков по высоте меняется кнопкой «Разделить на
        отсеки» — кликните по отсеку прямо в 3D, Focus Mode не нужен.</div>
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
// «Редактировать деталь» контекстного меню фокуса (см. showFocusMenu,
// viewer.onSelectPart) и, отдельно для отсека, пункт «Редактировать отсек»
// вне фокуса (viewer.onSelectZone). Когда появится полноценный редактор
// геометрии (вырезы/пазы, орто-вид, сетка 32мм, материал/толщина конкретной
// детали — отдельная задача с отдельной архитектурой хранения ручных
// правок), менять нужно будет только то, ЧТО показывается на экране «part»
// (partBlock/partKindPlaceholderBlock и renderParamsPanel ниже), саму точку
// вызова из меню — не нужно.
function openPartEditor(module, kind, side, sectionIndex, zoneIndex, asPart) {
  state.selectedPart = {
    module, kind, side, subIndex: 0,
    // У фасадов (kind:'door'/'drawerFront') — числовой индекс секции/отсека
    // фасада, по которому кликнули в 3D (см. viewer.js
    // userData.sectionIndex/zoneIndex). Undefined для остальных видов
    // деталей — им это поле не нужно.
    sectionIndex, zoneIndex,
    // Для kind:'door' — true, если открыли именно как деталь (пункт меню
    // «Редактировать деталь» в Focus Mode, всегда asPart:true), а не как
    // отсек фасада (пункт «Редактировать отсек» вне фокуса →
    // doorZoneEditorScreen, asPart не передаётся). Остальным видам деталей
    // не нужно.
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
// «+ Добавить материал»/«Удалить материал» под выбором декора/задней стенки
// в «Параметрах проекта» — тот же стиль ссылок, что и «+ Добавить материал»/
// «+ Добавить кромку» в «Библиотеке» (.link-btn). role — один из ключей
// LIB_PICK_ROLE_GROUP ('decor'/'facadeDecor'/'back'), см. openMaterialPicker/
// deleteMaterialPick ниже.
function materialPickActionsHtml(role) {
  return `<div class="lib-pick-actions">
    <button type="button" class="link-btn" data-material-add="${esc(role)}">+ Добавить материал</button>
    <button type="button" class="link-btn" data-material-del="${esc(role)}">Удалить материал</button>
  </div>`;
}

function materialsBlock() {
  return `
    <h3>Материалы (общие на проект)</h3>
    <div class="field">
      <label>Материал корпуса</label>
      <select id="p-decor">${DECORS.map(d => `<option value="${d.code}" ${d.code === state.decorCode ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
      ${materialPickActionsHtml('decor')}
    </div>
    <div class="field">
      <label>Материал фасада</label>
      <select id="p-facadeDecor">${DECORS.map(d => `<option value="${d.code}" ${d.code === state.facadeDecorCode ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
      <div class="hint">Видимая боковина (до пола или сбоку дна) режется в этом декоре</div>
      ${materialPickActionsHtml('facadeDecor')}
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
      ${materialPickActionsHtml('back')}
    </div>`;
}

// «+ Добавить материал» (см. materialPickActionsHtml) — переключает
// «Библиотеку» в режим подбора материала: пока state.libPickTarget не пуст,
// «Листовые материалы» рисуют у каждой строки доп. кнопку «Выбрать» (см.
// libRowHtml/libPickMaterial), которая и завершает подбор.
function openMaterialPicker(role) {
  state.libPickTarget = { role };
  state.libraryTab = 'materials';
  renderLibraryPanel();
  if (window.Modul3D.uiShell) window.Modul3D.uiShell.openDrawer('library', 'Листовые материалы');
}

// «Удалить материал» (см. materialPickActionsHtml) — убирает ТЕКУЩИЙ
// выбранный код из своего массива каталога. decor/facadeDecor читают ОДИН и
// тот же массив DECORS — если удаляемый материал сейчас выбран и для второй
// роли тоже (одинаковый декор корпуса и фасада), переключаем обе, иначе одно
// из полей осталось бы ссылкой на уже удалённую позицию. Столешница (у
// АКТИВНОЙ тумбы, не у группы — см. activeCountertopModule) тоже могла
// ссылаться на удалённый код — сбрасываем её при любой роли удаления ниже
// (см. конец функции). Роли 'countertopDecor' здесь больше нет: «Изменить» у
// столешницы (см. countertopPanelBlock) вызывает только openMaterialPicker,
// без варианта удаления — убрано по просьбе пользователя 2026-09-06.
function deleteMaterialPick(role) {
  const targetGroup = LIB_PICK_ROLE_GROUP[role];
  if (!targetGroup) return;
  const arr = targetGroup === 'back' ? BACK_MATERIALS : DECORS;
  const curCode = role === 'decor' ? state.decorCode : role === 'facadeDecor' ? state.facadeDecorCode : state.backCode;
  if (arr.length <= 1) {
    window.alert('Нельзя удалить последний материал — иначе не из чего будет выбирать');
    return;
  }
  const idx = arr.findIndex((x) => x.code === curCode);
  if (idx < 0) return;
  if (!window.confirm(`Удалить материал «${arr[idx].name}» из каталога?`)) return;
  arr.splice(idx, 1);
  const firstCode = arr[0].code;
  if (targetGroup === 'back') {
    state.backCode = firstCode;
    state.backThickness = arr[0].thickness;
  } else {
    if (state.decorCode === curCode) state.decorCode = firstCode;
    if (state.facadeDecorCode === curCode) state.facadeDecorCode = firstCode;
  }
  // «Свой материал» столешницы АКТИВНОЙ тумбы — та же удалённая позиция
  // могла быть выбрана и для неё, независимо от роли, с которой удаление
  // вызвали (как decor/facadeDecor сбрасывают друг друга выше).
  const activeMod = activeCountertopModule();
  if (activeMod && activeMod.countertop && activeMod.countertop.decorCode === curCode) {
    delete activeMod.countertop.decorCode;
  }
  recompute();
  renderParamsPanel();
}

// Экран «Ящики» — отдельная панель для ОДНОЙ секции ОДНОГО модуля (не список,
// как renderSectionsList): открывается кнопкой «Редактировать →» под
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
    // «Редактор отсека» — только для doorZoneEditorScreen (отсек фасада,
    // открывается «Редактировать отсек» из onSelectZone вне Focus Mode).
    // Всё остальное на экране «part» (partBlock/partKindPlaceholderBlock,
    // включая дверь, открытую как деталь через asPart из Focus Mode) —
    // «Редактор детали», это другой, более старый экран, не про отсеки.
    const onSectionScreen = state.panelView === 'part' && state.selectedPart
      && state.selectedPart.kind === 'door' && !state.selectedPart.asPart;
    // state.selectedPart может обнулиться (undo/redo, удаление модуля,
    // открытие другого проекта — все через exitIsolation()) БЕЗ отката
    // panelView на 'module' — тогда экран уже откатился на подсказку
    // partPlaceholderBlock(), а заголовок без этой проверки остался бы
    // «Редактор детали».
    const onPartScreen = state.panelView === 'part' && !!state.selectedPart && !onSectionScreen;
    drawerTitleEl.textContent = onSectionScreen ? 'Редактор отсека'
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

// Реальная построенная ширина фасада секции — источник для плейсхолдера поля
// «Ширина фасада, мм» в режиме авто (sec.facadeWidth не задан), чтобы
// пользователь видел фактическое число вместо голого «0». Источник —
// currentModel.partsRaw (та же построенная модель) — первая деталь-фасад
// (дверь или фасад ящика — откидной фасад и заглушка тоже строятся с
// kind:'door', см. makePart в engine.js) нужного модуля и секции.
// Возвращает null, если модель ещё не построена или деталь не найдена
// (пустой проект, только что добавленная секция до пересчёта и т.п.).
function secActualFacadeWidth(mod, i) {
  const rows = (currentModel && currentModel.partsRaw) || [];
  const kinds = ['door', 'drawerFront'];
  const part = rows.find((p) => p.module === mod.name && p.sectionIndex === i && kinds.includes(p.kind));
  return (part && part.box && Number.isFinite(part.box.w)) ? Math.round(part.box.w) : null;
}

// Разметка ОДНОЙ карточки отсека фасада (техника/фасад/высота/габариты/
// заметка) — чистая функция рендера без побочных эффектов и завязки на
// замыкание конкретного места вызова. Используется в компактном контекстном
// редакторе одного отсека, открываемом кликом по отсеку в 3D в обычном
// режиме (doorZoneEditorScreen, карточка только КОНКРЕТНОГО отсека) — это
// единственный способ настроить отсеки многозонного фасада, поэтому сайдбар
// для такой секции ограничивается подсказкой (см. renderSectionsList).
// `i` — индекс секции в mod.sections (для data-idx у полей), `zi` — индекс
// отсека в sec.doorZones, `doorZoneCount` — общее число отсеков секции (для
// заголовка «Нижний/Верхний/Отсек N»).
function zoneCardHtml(sec, i, zi, doorZoneCount) {
  const zone = sec.doorZones[zi] || {};
  const isBottom = zi === 0;
  const isTop = zi === doorZoneCount - 1;
  const title = isBottom ? 'Нижний отсек' : (isTop ? 'Верхний отсек' : `Отсек ${zi + 1}`);
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
        <option value="auto" ${zone.shelfMode !== 'manual' ? 'selected' : ''}>Равномерно</option>
        <option value="manual" ${zone.shelfMode === 'manual' ? 'selected' : ''}>Вручную</option>
      </select>
      ${zone.shelfMode === 'manual' ? `
        <label class="mt6">Высота каждой полки от низа отсека, мм</label>
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
    <label class="mt6">Высота отсека (ниши), мм</label>
    <div class="mini-row"><input type="number" min="0" step="10" value="${zone.height || ''}" placeholder="авто (остаток)" data-zoneheight="${zi}" data-idx="${i}"></div>
    ${appliance === 'none' ? `
    <label class="mt6">Полки, шт</label>
    <div class="mini-row"><input type="number" min="0" max="12" value="${zoneShelves}" data-zoneshelves="${zi}" data-idx="${i}"></div>
    ${zoneShelfDetail}` : ''}
    ${appliance !== 'none' ? `
    <label class="mt6">Габариты техники, мм (для памяти — ниша считается по высоте отсека выше)</label>
    <div class="field-row">
      <div class="field"><label>Ширина</label><input type="number" min="0" step="10" value="${zone.applianceW || ''}" data-zoneappw="${zi}" data-idx="${i}"></div>
      <div class="field"><label>Глубина</label><input type="number" min="0" step="10" value="${zone.applianceD || ''}" data-zoneappd="${zi}" data-idx="${i}"></div>
    </div>` : ''}
    <label class="mt6">Заметка</label>
    <div class="mini-row"><input type="text" value="${esc(zone.note || '')}" placeholder="например: модель по паспорту техники" data-zonenote="${zi}" data-idx="${i}"></div>
  </div>`;
}

// Число вертикальных отсеков фасада (пенал под встроенную технику): клампит
// 1..4 и подгоняет длину sec.doorZones под новое количество, не теряя уже
// настроенные отсеки (уменьшение НЕ усекает массив — «лишние» элементы
// просто не используются, пока doorZoneCount не увеличат обратно; engine.js
// и zoneCardHtml читают только первые doorZoneCount элементов).
// Вызывается кнопкой «Разделить на отсеки» в контекстном меню отсека в 3D
// (единственный способ задать это число, см. viewer.onSelectZone) — либо,
// для однозонного модуля, кнопкой «Разделить на отсеки» в HUD (см.
// setModuleDoorZoneCount).
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
// на drawerZoneH, которую здесь сознательно не учитываем — секции с
// ящиками из выравнивания по соседу выпадают), а также если у самой секции
// sectionIndex нет реального деления на зоны (doorZoneCount отсутствует
// или === 1, обычная цельная дверь на всю высоту) — тогда у неё физически
// нет «нижней зоны» как отдельной величины, и подставлять её полную высоту
// фасада как ориентир для выравнивания соседа неверно (баг: одна зона
// «съедала» почти всю высоту новой секции, остальным зонам не хватало
// места — см. findNeighborBottomZoneHeight).
function sectionBottomZoneHeight(mod, sectionIndex) {
  const sec = mod.sections[sectionIndex];
  if (!sec) return null;
  const n = Number(sec.doorZoneCount) || 1;
  if (n <= 1) return null;
  const mi = state.modules.indexOf(mod);
  const dims = currentModel && currentModel.modules[mi] && currentModel.modules[mi].dims;
  if (!dims) return null;
  const secDims = dims.sections && dims.sections[sectionIndex];
  if (secDims && Array.isArray(secDims.drawerHeights) && secDims.drawerHeights.length) return null;
  const { layoutDoorZones } = window.Modul3D.engine;
  const zones = (Array.isArray(sec.doorZones) && sec.doorZones.length)
    ? sec.doorZones.slice(0, n).map((z) => ({ height: (z && Number(z.height)) || 0 }))
    : [{ height: 0 }];
  const layout = layoutDoorZones(zones, dims.H - dims.baseH, dims.gap, dims.t, null, '');
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

// Мост для ui-shell.js (HUD в 3D, см. renderHud/initHud): состояние модуля,
// нужное HUD и для подсветки текущего поворота, и для решения — показывать
// ли кнопку «Разделить на отсеки» (по явному решению — только когда в
// модуле ровно одна секция, иначе неоднозначно какую делить, и пользователь
// делит через клик по нужной секции в 3D — viewer.onSelectZone). Есть ли у
// секции фасад (kind === 'door'), проверяем по уже построенной модели
// (currentModel.partsRaw, см. overridablePartCandidates выше — тот же
// источник для 3D→деталь).
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

// Мост для ui-shell.js: «Разделить на отсеки» из HUD в 3D — та же логика,
// что применяет числовой пункт «Разделить на отсеки» в viewer.onSelectZone
// выше (setDoorZoneCount + подгонка высоты нижнего отсека под соседа), но
// без клика по конкретному отсеку: секция здесь однозначна — единственная,
// sectionIndex 0 (см. getModuleHudState — кнопка в HUD видна только тогда).
// Полки-перегородки на стыках отсеков отдельно расставлять не нужно —
// engine.js считает их прямо из sec.doorZones при каждой сборке модели
// (см. layoutDoorZones).
function setModuleDoorZoneCount(moduleName, n) {
  const mod = state.modules.find((m) => m.name === moduleName);
  if (!mod || !Array.isArray(mod.sections) || mod.sections.length !== 1) return;
  const sec = mod.sections[0];
  const applied = setDoorZoneCount(sec, n);
  if (applied >= 2) {
    // Нижний отсек по умолчанию — вровень с фасадом соседа (единая
    // горизонтальная линия по ряду), если высота ещё не задана вручную;
    // уже настроенную высоту не трогаем.
    if (!sec.doorZones[0].height) {
      const neighborH = findNeighborBottomZoneHeight(mod, 0);
      // findNeighborBottomZoneHeight отдаёт высоту ДВЕРИ соседа (для
      // выравнивания видимой линии фасадов); doorZones[0].height хранит
      // высоту НИШИ — переводим, иначе сама эта подгонка создаст рассинхрон.
      if (neighborH) {
        sec.doorZones[0].height = window.Modul3D.engine.nicheFromEdgeDoorHeight(neighborH, state.bodyThickness);
      }
    }
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
    // h — высота ДВЕРИ соседа; doorZones[0].height хранит высоту НИШИ (см.
    // тот же перевод в setModuleDoorZoneCount выше).
    sec.doorZones[0].height = window.Modul3D.engine.nicheFromEdgeDoorHeight(h, state.bodyThickness);
    changed = true;
  }
  return changed;
}

// Обработчики полей карточки(-ек) отсека фасада — делегированы на `container`
// (а не жёстко на #sectionsList), чтобы одинаково работать и в общем списке
// секций сайдбара, и в компактном контекстном редакторе одного отсека
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

// select режима распределения полок (авто/вручную) и список инпутов высоты
// каждой полки — вынесены из shelfDetailBlock() отдельными функциями, чтобы
// карточка секции сайдбара (renderSectionsList) могла расположить сам select
// В ОДНОЙ СТРОКЕ с полем «Полки, шт» (см. там), а не под ним. shelfDetailBlock()
// ниже по-прежнему собирает их в исходную разметку (label «Полки» + select +
// список высот внутри одного .sub) — этим она пользуется компактный
// контекстный редактор фасада (doorZoneEditorScreen), вид которого менять не
// нужно.
// Текст опций короткий («Равномерно»/«Вручную», а не «Распределить
// равномерно»/«Задать высоту вручную») — этот select стоит рядом с полем
// «Полки, шт» в узкой половинной колонке .field-row (~140px в панели), и
// полная фраза обрезалась серединой слова прямо в закрытом состоянии.
function shelfModeSelect(sec, i) {
  return `
    <select data-field="shelfMode" data-idx="${i}">
      <option value="auto" ${sec.shelfMode !== 'manual' ? 'selected' : ''}>Равномерно</option>
      <option value="manual" ${sec.shelfMode === 'manual' ? 'selected' : ''}>Вручную</option>
    </select>`;
}

function shelfHeightsInputs(sec, i) {
  return `
    <div class="mini-row">
      ${Array.from({ length: sec.shelves }, (_, s) =>
        `<input type="number" step="10" min="0" value="${(sec.shelfHeights && sec.shelfHeights[s]) || (300 * (s + 1))}"
                data-shelf="${s}" data-idx="${i}" title="Полка ${s + 1}">`
      ).join('')}
    </div>`;
}

// Блок «Полки» (режим авто/вручную + высоты) — полки принадлежат секции
// целиком (sec.shelves/shelfMode/shelfHeights), а не отдельной зоне фасада,
// поэтому один и тот же блок используется и в карточке секции сайдбара
// (renderSectionsList — там она собирает select/высоты сама, см. выше), и в
// компактном контекстном редакторе фасада (doorZoneEditorScreen),
// независимо от doorZoneCount/zoneIndex.
function shelfDetailBlock(sec, i) {
  return sec.shelves > 0 ? `
    <div class="sub">
      <label>Полки</label>
      ${shelfModeSelect(sec, i)}
      ${sec.shelfMode === 'manual' ? `
        <label class="mt6">Высота каждой полки от дна, мм</label>
        ${shelfHeightsInputs(sec, i)}` : ''}
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

// Секции модуля показываются вкладками-«закладками» (как у moduleTabsBlock
// выше, но с горизонтальной прокруткой вместо переноса строк — при 5-6+
// секциях ряд скроллится по горизонтали, а не растягивает панель — и с
// крестиком-удалением только на РАСКРЫТОЙ вкладке, не на свёрнутых). Видна
// одновременно только ОДНА раскрытая секция — иначе панель превращается в
// длинную простыню при 2+ секциях. Какая секция раскрыта — хранится на самом
// объекте модуля (mod.activeSection), по аналогии с state.activeModule.
function renderSectionsList() {
  const mod = state.modules[state.activeModule];
  const list = document.getElementById('sectionsList');
  if (!mod || !list) return;      // пустой проект — секций нет

  // Клэмп индекса раскрытой секции — на случай, если секция, которая была
  // активна, успела исчезнуть (удаление секции, смена модуля, undo/redo),
  // тот же принцип, что и у клэмпа state.activeModule в deleteModule().
  if (!Number.isInteger(mod.activeSection)) mod.activeSection = 0;
  mod.activeSection = Math.max(0, Math.min(mod.activeSection, mod.sections.length - 1));
  const activeIdx = mod.activeSection;

  const tabsHtml = `
    <div class="sec-tabs-row">
      <div class="sec-tabs" id="secTabs">
        ${mod.sections.map((s, si) => `
          <button class="sec-tab ${si === activeIdx ? 'active' : ''}" data-sec="${si}" type="button">
            Секция ${si + 1}${si === activeIdx && mod.sections.length > 1
              ? `<span class="sec-tab-remove" data-remove-sec="${si}" title="Убрать секцию">✕</span>` : ''}
          </button>`).join('')}
      </div>
      <button class="sec-add tip tip-down" data-add-section type="button"
              data-tip="Добавить секцию" aria-label="Добавить секцию">+</button>
    </div>`;

  // Раскрыта только ОДНА секция — остальные свёрнуты в узкие вкладки выше.
  const i = activeIdx;
  const sec = mod.sections[i];
  const contentHtml = (() => {
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
        <label class="mt6">Присадка ручки</label>
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

    const facadeWidthActual = secActualFacadeWidth(mod, i);
    const facadeWidthBlock = sec.facade === 'open' ? '' : `
      <div class="sub">
        <label>Ширина фасада, мм <span class="dim">(пусто — во всю секцию)</span></label>
        <div class="mini-row"><input type="number" step="10" min="0" value="${sec.facadeWidth > 0 ? sec.facadeWidth : ''}" placeholder="${facadeWidthActual != null ? facadeWidthActual : ''}" data-field="facadeWidth" data-idx="${i}"></div>
      </div>`;

    // Показываем только когда секций 2+ — если секция одна, делить нечего.
    const widthModeBlock = mod.sections.length <= 1 ? '' : `
      <div class="field">
        <label>Ширина проёма секции</label>
        <select data-field="widthMode" data-idx="${i}">
          <option value="auto" ${sec.widthMode !== 'fixed' ? 'selected' : ''}>авто</option>
          <option value="fixed" ${sec.widthMode === 'fixed' ? 'selected' : ''}>задать в мм</option>
        </select>
        ${sec.widthMode === 'fixed'
          ? `<div class="mini-row mt6"><input type="number" step="10" min="50" value="${sec.width || 400}" data-field="width" data-idx="${i}"></div>`
          : ''}
      </div>`;

    // Штанга для одежды в кухонном модуле не бывает — блок не показываем.
    const rodBlock = mod.family === 'kitchen' ? '' : `
      <div class="sub">
        <label class="checkbox-inline"><input type="checkbox" data-field="rod" data-idx="${i}" ${sec.rod ? 'checked' : ''}> Штанга для одежды</label>
        ${sec.rod ? `<label class="mt6">Высота штанги от дна секции, мм</label>
        <div class="mini-row"><input type="number" step="10" min="300" value="${sec.rodHeight || 1900}" data-field="rodHeight" data-idx="${i}"></div>` : ''}
      </div>`;

    // Вертикальные отсеки фасада (пенал под встроенную технику): деление на
    // отсеки и карточка каждого отсека живут только в 3D (клик по отсеку →
    // doorZoneEditorScreen/zoneCardHtml, Focus Mode не нужен), здесь для
    // многозонной секции — просто ссылка на этот способ, без общего select
    // «Фасад».
    const doorZoneCount = Number(sec.doorZoneCount) || 1;

    // Строка «Ящики, шт» — при наличии ящиков рядом (не под полем, а сбоку
    // от него) стоит кнопка перехода в отдельный редактор ящиков, чтобы обе
    // связанные настройки читались одной строкой. Текст кнопки полный
    // («Редактировать ящики →», не сокращённый), поэтому колонки — не 50/50,
    // а .field-row-wide-action (см. style.css), как и у строки «Полки, шт».
    const drawersRow = `
      <div class="field-row field-row-wide-action">
        <div class="field"><label>Ящики, шт</label><input type="number" min="0" max="8" value="${sec.drawers}" data-field="drawers" data-idx="${i}"></div>
        <div class="field field-row-action">
          <label>&nbsp;</label>
          <button class="btn materials-link-btn field-row-btn" data-drawers-open="${i}" type="button" ${sec.drawers > 0 ? '' : 'disabled'}>Редактировать ящики <span class="arrow">→</span></button>
        </div>
      </div>`;

    // Строка «Полки, шт» — тем же приёмом: при наличии полок рядом с полем
    // стоит select режима распределения (shelfModeSelect), а не под ним
    // отдельным блоком. Список высот вручную (при shelfMode:'manual') —
    // отдельным блоком сразу под этой строкой. Многозонная секция — полки
    // настраиваются по отсекам в zoneCardHtml (доступно кликом по отсеку в
    // 3D, см. doorZoneEditorScreen); engine.js игнорирует sec.shelves при
    // multiZone, эта строка для неё не показывается вовсе.
    // .field-row-wide-action — колонки не 50/50: полю «Полки, шт» хватает
    // ширины под 1-2 цифры, а select/кнопке с текстом («Равномерно»/
    // «Вручную», «Редактировать ящики →» у строки «Ящики, шт» выше) нужно
    // больше места, иначе текст обрезается или переносится (см. style.css).
    // Тот же модификатор у обеих строк — чтобы кнопка и select были одной
    // ширины друг с другом.
    const shelvesRow = sec.shelves > 0 ? `
      <div class="field-row field-row-wide-action">
        <div class="field"><label>Полки, шт</label><input type="number" min="0" max="12" value="${sec.shelves}" data-field="shelves" data-idx="${i}"></div>
        <div class="field field-row-action">
          <label>&nbsp;</label>
          ${shelfModeSelect(sec, i)}
        </div>
      </div>
      ${sec.shelfMode === 'manual' ? `
      <div class="sub">
        <label>Высота каждой полки от дна, мм</label>
        ${shelfHeightsInputs(sec, i)}
      </div>` : ''}` : `
      <div class="field"><label>Полки, шт</label><input type="number" min="0" max="12" value="${sec.shelves}" data-field="shelves" data-idx="${i}"></div>`;

    return `
      <div class="section-card">
        <div class="section-card-title">
          <span>${esc(mod.name)} · Секция ${i + 1}</span>
        </div>
        ${widthModeBlock}
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
          <div class="hint">Секция разделена на отсеки по высоте. Деление и настройка отсеков (фасад, встраиваемая техника, полки) — кликом по отсеку прямо в 3D (Focus Mode не нужен): «Разделить секцию на отсеки» / «Редактировать отсек».</div>
        </div>`}
        ${glassBlock}
        ${handleBlock}
        ${liftBlock}
        ${facadeWidthBlock}
        ${drawersRow}
        ${doorZoneCount <= 1 ? shelvesRow : ''}
        ${rodBlock}
      </div>`;
  })();

  list.innerHTML = tabsHtml + contentHtml;

  // Секций может быть больше, чем помещается по ширине ряда — .sec-tabs
  // скроллится по горизонтали (overflow-x: auto, см. style.css). После
  // каждой перерисовки подкручиваем ряд так, чтобы активная вкладка была
  // видна целиком, иначе при добавлении/переключении на вкладку за
  // пределами видимой области пользователь не видит, что вообще открылась
  // другая секция. block: 'nearest' не даёт задеть вертикальный скролл
  // панели параметров — тот же приём, что и в setDocsTab() ниже.
  const activeTabEl = list.querySelector('.sec-tab.active');
  if (activeTabEl && activeTabEl.scrollIntoView) {
    activeTabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Колесо мыши над рядом вкладок секций — по умолчанию браузер скроллит по
  // вертикали всю панель параметров (у самого ряда вертикального overflow
  // нет). Переводим вертикальную дельту колеса в горизонтальный скролл
  // ряда и глушим событие, чтобы панель под курсором не дёргалась вверх/
  // вниз. Перевешивается при каждой перерисовке — list.innerHTML выше
  // каждый раз пересоздаёт #secTabs.
  const secTabsEl = document.getElementById('secTabs');
  if (secTabsEl) {
    secTabsEl.addEventListener('wheel', (e) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      secTabsEl.scrollLeft += e.deltaY;
    }, { passive: false });
  }

  // переключение вкладок секций — просто перерисовка панели, без recompute():
  // геометрия не меняется, меняется только то, что показано в панели (тот же
  // принцип, что и у переключения partSubIndex — см. bindPanelEvents).
  list.querySelectorAll('.sec-tab').forEach((el) => {
    el.addEventListener('click', (e) => {
      mod.activeSection = Number(e.currentTarget.dataset.sec);
      renderSectionsList();
    });
  });
  // «+» в ряду вкладок — добавляет секцию и сразу раскрывает её.
  list.querySelectorAll('[data-add-section]').forEach((el) => {
    el.addEventListener('click', () => {
      mod.sections.push(newSection());
      mod.activeSection = mod.sections.length - 1;
      rebalanceSectionFacades(mod);
      renderSectionsList();
      recompute();
    });
  });
  // крестик на активной вкладке — убирает секцию; e.stopPropagation() не даёт
  // клику всплыть до обработчика переключения вкладки (span лежит внутри
  // <button class="sec-tab">, по тому же принципу, что и поле переименования
  // модуля в showModuleMenu — см. комментарий там).
  list.querySelectorAll('[data-remove-sec]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(e.currentTarget.dataset.removeSec);
      mod.sections.splice(idx, 1);
      // После удаления активной секции переключаемся на соседнюю — тот же
      // клэмп, что и у state.activeModule в deleteModule().
      mod.activeSection = Math.min(idx, mod.sections.length - 1);
      rebalanceSectionFacades(mod);
      renderSectionsList();
      recompute();
    });
  });

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
  // отсеки фасада по высоте (пенал под встроенную технику) — сами
  // обработчики вынесены в bindZoneFieldEvents(), переиспользуется и здесь
  // (карточки на все отсеки секции), и в компактном контекстном редакторе
  // одного отсека (doorZoneEditorScreen, открывается кликом по отсеку в 3D).
  bindZoneFieldEvents(list, mod);
  // «Редактировать →» — открывает отдельную панель «Ящики» для этой
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
// Контекстное меню (showFocusMenu) — универсальное всплывающее меню в точке
// клика в 3D. Изначально только для режима фокуса (изоляция модуля, двойной
// клик в 3D), но переиспользуется и вне фокуса — для клика по отсеку в
// обычном режиме (viewer.onSelectZone, см. ниже), отсюда и общее имя функции.
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
// число + кнопка в одной строке (например «Разделить на отсеки» у отсека,
// см. viewer.onSelectZone), которая НЕ закрывает меню при вводе числа, только
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

  // Поиск по вкладкам модулей (виден только когда модулей больше 8 — см.
  // moduleTabsBlock) и прокрутка их ряда колесом мыши — оба независимы от
  // того, есть ли активный модуль, поэтому привязываются до ранних return
  // ниже. Ряд #modTabs — moduleTabsBlock() каждый раз пересоздаёт его,
  // слушатель нужно вешать заново при каждом вызове bindPanelEvents(), тот
  // же приём, что и у #secTabs в renderSectionsList().
  on('moduleSearch', 'input', applyModuleSearch);
  applyModuleSearch();
  const modTabsEl = document.getElementById('modTabs');
  if (modTabsEl) {
    modTabsEl.addEventListener('wheel', (e) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      modTabsEl.scrollLeft += e.deltaY;
    }, { passive: false });
    // Подкручиваем ряд так, чтобы активная вкладка была видна целиком —
    // без этого смена активного модуля НЕ кликом по видимой кнопке
    // (insertModule() при добавлении, undo/redo, выбор в 3D, переименование
    // через контекстное меню) могла бы оставить подсветку .active за
    // пределами видимой области длинного скроллящегося ряда. Тот же приём
    // и по той же причине, что и у #secTabs в renderSectionsList().
    const activeModTabEl = modTabsEl.querySelector('.mod-tab.active');
    if (activeModTabEl && activeModTabEl.scrollIntoView) {
      activeModTabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

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
  on('p-back', 'change', (e) => {
    state.backCode = e.target.value;
    // Толщина ХДФ больше не вводится вручную — берём из выбранного материала
    // (у каждого элемента BACK_MATERIALS теперь есть числовое поле thickness).
    const back = BACK_MATERIALS.find(m => m.code === state.backCode);
    if (back) state.backThickness = back.thickness;
    recompute();
  });
  on('p-bodyThickness', 'change', (e) => { state.bodyThickness = Number(e.target.value); recompute(); });
  on('p-facadeThickness', 'change', (e) => { state.facadeThickness = Number(e.target.value); recompute(); });

  // «+ Добавить материал»/«Удалить материал» под Материал корпуса/Материал
  // фасада/Задняя стенка (см. materialPickActionsHtml) — три пары кнопок,
  // перерисовываются вместе с экраном «Материалы», как и остальные поля
  // panelView === 'materials' выше. Запрос СКОУПЛЕН на #paramsPanel (а не
  // document) — тот же атрибут data-material-add теперь есть и в панели
  // «Столешница» (countertopPanelBlock, кнопка «Изменить»; своей
  // «Удалить материал» у столешницы больше нет, см. deleteMaterialPick), у
  // которой своя отдельная привязка в bindCountertopEvents(); без скоупа
  // здесь клик по ней ловил бы ВТОРОЙ обработчик при каждом
  // renderParamsPanel() (реальный баг такого рода уже был найден на ревью
  // 2026-09-06).
  const paramsPanelEl = document.getElementById('paramsPanel');
  if (paramsPanelEl) {
    paramsPanelEl.querySelectorAll('[data-material-add]').forEach((btn) => {
      btn.addEventListener('click', () => openMaterialPicker(btn.dataset.materialAdd));
    });
    paramsPanelEl.querySelectorAll('[data-material-del]').forEach((btn) => {
      btn.addEventListener('click', () => deleteMaterialPick(btn.dataset.materialDel));
    });
  }

  // Добавление секции переехало в ряд вкладок секций (кнопка «+» рядом с
  // ними) — обработчик делегирован внутри renderSectionsList() на
  // [data-add-section], как и переключение/удаление секций, поскольку эта
  // кнопка перерисовывается вместе со списком, а не живёт статическим id.

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

  // Экран «Деталь» для фасада (kind:'door') — компактный редактор ОДНОГО
  // отсека, открытый кликом по отсеку в 3D в обычном режиме (см.
  // doorZoneEditorScreen, renderParamsPanel). Многозонный случай переиспользует
  // те же поля/обработчики, что и сайдбар (bindZoneFieldEvents), только с refresh =
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
    // Запасной вариант (DECORS[0]/BACK_MATERIALS[0]) — на случай, если код
    // декора из сохранённого проекта/автосохранения устарел (каталог правят
    // отдельно от app.js, коды могут переименовать или убрать — так уже было
    // 2026-09-03). Без отката buildModel() падает на undefined.code и рвёт
    // всю инициализацию приложения (пустая библиотека, неработающие кнопки).
    decor: DECORS.find(d => d.code === state.decorCode) || DECORS[0],
    facadeDecor: DECORS.find(d => d.code === state.facadeDecorCode)
      || DECORS.find(d => d.code === state.decorCode) || DECORS[0],
    backMaterial: BACK_MATERIALS.find(d => d.code === state.backCode) || BACK_MATERIALS[0],
    worktopDepth: state.worktopDepth,
    jointType: state.jointType,
    // Способ соединения столешниц на угловом стыке — общий на проект (панель
    // «Столешница»), читает joinCountertopSeams() в engine.js.
    countertopCornerJoint: state.countertopCornerJoint,
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
      // Столешница модуля (панель «Столешница», см. countertopPanelBlock) —
      // читает buildModuleParts() в engine.js как p.countertop.
      countertop: m.countertop,
    })),
  };
  // Если код декора был устаревшим (см. комментарий у отката DECORS[0] выше)
  // и project.decor уехал на запасной вариант — подтягиваем state.decorCode/
  // facadeDecorCode/backCode следом, иначе селектор в панели будет молча
  // показывать несуществующий код, а автосохранение — раз за разом
  // сохранять всё тот же битый код вместо реально применённого.
  state.decorCode = project.decor.code;
  state.facadeDecorCode = project.facadeDecor.code;
  state.backCode = project.backMaterial.code;

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
  // Панель «Столешница» (countertopPanelBlock ниже) показывает список
  // модулей проекта и сводку по стыкам currentModel.hardwareContext —
  // обновляем вместе с остальными «документами», а не только по своим
  // внутренним событиям: иначе список/сводка протухают, если модуль
  // переименовали, добавили или удалили с другого экрана панели, пока эта
  // панель была открыта. Контейнер #countertopPanel есть в DOM всегда (см.
  // index.html), даже когда сам drawer сейчас не показан.
  if (document.getElementById('countertopPanel')) renderCountertopPanel();

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
  // подсвечивать. zoneIndex передаём отдельно: если секция разбита на отсеки
  // по высоте («Разделить на отсеки» — пенал под встроенную технику),
  // редактируется ОДИН конкретный отсек, и подсвечивать нужно только его
  // дверь, а не все отсеки стопки — viewer.js сверяет zoneIndex наравне с
  // sectionIndex.
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

// -----------------------------------------------------------------------
// Универсальный автофильтр+сортировка одного столбца — Excel-style: общий
// «движок», используемый и вкладкой «Деталировка» (одна таблица, ключ
// 'detailing'), и панелью «Библиотека → Материалы» (одновременно может
// быть открыто несколько таблиц — свой ключ у каждой, см.
// libLeafTableHtml/data-chars-key). Один и тот же поповер (треугольник в
// заголовке → сортировка/чекбоксы уникальных значений столбца) и одна и та
// же логика скрытия/сортировки строк по DOM — то, ЧТО именно фильтровать
// (набор столбцов, откуда брать значения строки), решает вызывающий код
// через rowsCache/uniqueValues, здесь только хранилище состояния и сам
// поповер. Это ЧИСТО визуальный фильтр над уже отрисованным <table> — саму
// модель/каталог он не трогает, строки только визуально переставляются/
// скрываются. Состояние живёт в замыкании (НЕ localStorage, НЕ state
// проекта) и переживает recompute()/перерисовку — каждый рендер таблицы
// заново применяет уже сохранённое состояние к свежим строкам (см.
// applyColumnFilterAndSort).
// -----------------------------------------------------------------------
const columnFilterStates = {}; // { [tableKey]: { sortCol, sortDir, hidden: {colIndex: Set<string>} } }
let columnFilterMenuOutsideHandler = null;

function getColumnFilterState(tableKey) {
  if (!columnFilterStates[tableKey]) columnFilterStates[tableKey] = { sortCol: null, sortDir: 'asc', hidden: {} };
  return columnFilterStates[tableKey];
}
function columnFilterHasActiveState(tableKey) {
  const st = columnFilterStates[tableKey];
  if (!st) return false;
  if (st.sortCol !== null) return true;
  return Object.keys(st.hidden).some((k) => st.hidden[k] && st.hidden[k].size > 0);
}
function resetColumnFilterState(tableKey) {
  delete columnFilterStates[tableKey];
}
function closeColumnFilterMenu() {
  const old = document.getElementById('detailFilterMenu');
  if (old && old.remove) old.remove();
  if (columnFilterMenuOutsideHandler) {
    document.removeEventListener('click', columnFilterMenuOutsideHandler);
    columnFilterMenuOutsideHandler = null;
  }
}
// Обновляет только иконку/подсветку кнопок-треугольников (во ВСЕХ таблицах
// внутри scopeEl разом — в Библиотеке их может быть открыто несколько
// одновременно) — без пересоздания слушателей, каждая кнопка несёт свои
// data-filter-key/data-col.
function refreshColumnFilterHeaderIndicators(scopeEl) {
  if (!scopeEl) return;
  scopeEl.querySelectorAll('.dth-filter-btn').forEach((btn) => {
    const tableKey = btn.dataset.filterKey;
    const ci = Number(btn.dataset.col);
    const st = columnFilterStates[tableKey];
    const filterActive = !!(st && st.hidden[ci] && st.hidden[ci].size > 0);
    const sortActive = !!(st && st.sortCol === ci);
    btn.classList.toggle('active', filterActive || sortActive);
    btn.textContent = sortActive ? (st.sortDir === 'desc' ? '↓' : '↑') : '▾';
  });
}
// Применяет сохранённое состояние (фильтр + сортировка) к УЖЕ отрисованной
// таблице tableEl: скрывает строки, чьи значения сняты в поповере, и
// переставляет оставшиеся <tr> по активной сортировке. Работает прямо по
// DOM (tr[data-row-idx] внутри tableEl), не трогая innerHTML целиком, —
// так поповер может оставаться открытым при каждом клике по чекбоксу.
// rowsCache — [{ idx, vals }], vals[ci] — значение колонки ci ровно в том
// виде, что напечатано в ячейке.
function applyColumnFilterAndSort(tableEl, tableKey, rowsCache, emptyColspan, emptyMessage) {
  const tbody = tableEl && tableEl.querySelector('tbody');
  if (!tbody) return;
  const oldEmpty = tbody.querySelector('.detail-empty-row');
  if (oldEmpty) oldEmpty.remove();

  const trs = Array.prototype.slice.call(tbody.querySelectorAll('tr[data-row-idx]'));
  if (!trs.length) return; // строк нет вообще — это не про фильтр

  const st = getColumnFilterState(tableKey);
  let visibleCount = 0;
  trs.forEach((tr) => {
    const row = rowsCache[Number(tr.dataset.rowIdx)];
    let hide = false;
    if (row) {
      for (const ciStr in st.hidden) {
        const hiddenSet = st.hidden[ciStr];
        if (hiddenSet && hiddenSet.size && hiddenSet.has(row.vals[Number(ciStr)])) { hide = true; break; }
      }
    }
    tr.style.display = hide ? 'none' : '';
    if (!hide) visibleCount += 1;
  });

  if (st.sortCol !== null) {
    const ci = st.sortCol;
    const dir = st.sortDir === 'desc' ? -1 : 1;
    trs.sort((a, b) => {
      const ra = rowsCache[Number(a.dataset.rowIdx)];
      const rb = rowsCache[Number(b.dataset.rowIdx)];
      const va = ra ? ra.vals[ci] : '';
      const vb = rb ? rb.vals[ci] : '';
      return va.localeCompare(vb, 'ru', { numeric: true, sensitivity: 'base' }) * dir;
    });
    trs.forEach((tr) => tbody.appendChild(tr));
  }

  if (!visibleCount) {
    const tr = document.createElement('tr');
    tr.className = 'detail-empty-row';
    tr.innerHTML = `<td colspan="${emptyColspan}">${esc(emptyMessage || 'Нет строк, соответствующих фильтру')}</td>`;
    tbody.appendChild(tr);
  }
}
// Поповер сортировки+фильтра одного столбца — по образцу showFocusMenu
// (.ctx-menu, position: fixed, закрытие по клику вне себя и по Esc).
// params: { tableKey, colIndex, btnEl, uniqueValues, onChange } — uniqueValues
// уже отсортированный список строк-значений столбца (вызывающий код сам
// решает, откуда их брать — см. openDetailFilterMenu/initLibraryPanel),
// onChange зовётся после каждого изменения (сортировка/чекбокс/сброс),
// чтобы вызывающий код применил applyColumnFilterAndSort к СВОЕЙ таблице и
// обновил индикаторы/кнопку сброса.
function openColumnFilterMenu(params) {
  closeColumnFilterMenu();
  const { tableKey, colIndex, btnEl, uniqueValues, onChange } = params;
  const st = getColumnFilterState(tableKey);
  const hiddenSet = st.hidden[colIndex] || new Set();
  const allChecked = uniqueValues.every((v) => !hiddenSet.has(v));

  const menu = document.createElement('div');
  menu.id = 'detailFilterMenu';
  menu.className = 'ctx-menu detail-filter-menu';
  menu.innerHTML = `
    <button type="button" class="ctx-item" data-action="sort-asc">▲ Сортировать по возрастанию</button>
    <button type="button" class="ctx-item" data-action="sort-desc">▼ Сортировать по убыванию</button>
    <div class="ctx-sep"></div>
    <label class="df-check-row df-check-all">
      <input type="checkbox" id="dfSelectAll" ${allChecked ? 'checked' : ''}>
      <span>(Выделить всё)</span>
    </label>
    <div class="df-values-list">${uniqueValues.length ? uniqueValues.map((v, i) => `
      <label class="df-check-row">
        <input type="checkbox" data-vi="${i}" ${hiddenSet.has(v) ? '' : 'checked'}>
        <span title="${esc(v)}">${esc(v) || '—'}</span>
      </label>`).join('') : '<div class="df-empty">нет значений</div>'}</div>
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item" data-action="clear-filter">Сбросить фильтр столбца</button>`;
  document.body.appendChild(menu);
  // Клик по любому месту внутри поповера не должен доходить до глобального
  // обработчика «клик вне — закрыть» ниже (иначе клик по подписи чекбокса,
  // а не по самому квадратику, закрывал бы меню).
  menu.addEventListener('click', (e) => e.stopPropagation());

  // Позиционируем под кнопкой-треугольником, с клампом к вьюпорту.
  const btnRect = btnEl.getBoundingClientRect();
  const rect = menu.getBoundingClientRect();
  const left = Math.max(4, Math.min(btnRect.right - rect.width, window.innerWidth - rect.width - 4));
  let top = btnRect.bottom + 4;
  if (top + rect.height > window.innerHeight - 4) top = Math.max(4, btnRect.top - rect.height - 4);
  menu.style.left = Math.round(left) + 'px';
  menu.style.top = Math.round(top) + 'px';

  const selectAllCb = menu.querySelector('#dfSelectAll');
  const valueCbs = Array.prototype.slice.call(menu.querySelectorAll('.df-values-list input[type="checkbox"]'));
  const commitHiddenValues = () => {
    const newHidden = new Set();
    valueCbs.forEach((cb, i) => { if (!cb.checked) newHidden.add(uniqueValues[i]); });
    if (newHidden.size) st.hidden[colIndex] = newHidden;
    else delete st.hidden[colIndex];
  };
  if (selectAllCb) {
    selectAllCb.addEventListener('change', () => {
      valueCbs.forEach((cb) => { cb.checked = selectAllCb.checked; });
      commitHiddenValues();
      onChange();
    });
  }
  valueCbs.forEach((cb) => {
    cb.addEventListener('change', () => {
      if (selectAllCb) selectAllCb.checked = valueCbs.every((c) => c.checked);
      commitHiddenValues();
      onChange();
    });
  });

  const bindAction = (sel, fn) => {
    const b = menu.querySelector(sel);
    if (b) b.addEventListener('click', () => { closeColumnFilterMenu(); fn(); });
  };
  bindAction('[data-action="sort-asc"]', () => { st.sortCol = colIndex; st.sortDir = 'asc'; onChange(); });
  bindAction('[data-action="sort-desc"]', () => { st.sortCol = colIndex; st.sortDir = 'desc'; onChange(); });
  bindAction('[data-action="clear-filter"]', () => { delete st.hidden[colIndex]; onChange(); });

  // Клик мимо меню закрывает его без действия — слушатель вешаем следующим
  // тиком, иначе клик по треугольнику, который ОТКРЫЛ это меню, сам же его
  // мгновенно и закроет (см. showFocusMenu — тот же приём).
  setTimeout(() => {
    columnFilterMenuOutsideHandler = (e) => {
      if (!menu.contains(e.target)) closeColumnFilterMenu();
    };
    document.addEventListener('click', columnFilterMenuOutsideHandler);
  }, 0);
}

// -----------------------------------------------------------------------
// «Деталировка» — тонкая обёртка над общим движком выше: ключ таблицы
// фиксированный ('detailing', на экране она всегда одна, в отличие от
// Библиотеки), сам движок не трогает model.parts/экспорт (exportDetailing)/
// № детали (r.num) — только визуальное отображение уже готовой таблицы.
// -----------------------------------------------------------------------
const DETAIL_TABLE_KEY = 'detailing';
const DETAIL_COLUMNS = [
  { label: '№' }, { label: 'Модуль' }, { label: 'Наименование' }, { label: 'Секция' },
  { label: 'Материал' }, { label: 'Длина' }, { label: 'Ширина' }, { label: 'Кол-во' },
  { label: 'Кромка L1' }, { label: 'Кромка L2' }, { label: 'Кромка S1' }, { label: 'Кромка S2' },
  { label: 'Текстура' }, { label: 'Примечание' },
];
// Строки текущего рендера таблицы — [{ idx, vals }], vals — по одному
// значению на столбец DETAIL_COLUMNS, ровно в том виде, что напечатан в
// ячейке (для «Материала» — полное название + толщина, а не код).
let detailRowsCache = [];

function detailRowValues(r) {
  return [
    String(r.num), r.module || '', r.name, r.section,
    `${materialName(r.material)}, ${r.thickness} мм`,
    String(r.length), String(r.width), String(r.qty),
    r.edging.long1 || '—', r.edging.long2 || '—', r.edging.short1 || '—', r.edging.short2 || '—',
    r.grainDirection ? 'да' : 'нет', r.note || '',
  ];
}

function detailHasActiveState() {
  return columnFilterHasActiveState(DETAIL_TABLE_KEY);
}

function refreshDetailHeaderIndicators(el) {
  el = el || document.getElementById('tab-detailing');
  refreshColumnFilterHeaderIndicators(el);
}

function refreshDetailResetButton() {
  const btn = document.getElementById('detailResetFilters');
  if (btn) btn.style.display = detailHasActiveState() ? '' : 'none';
}

function applyDetailFilterAndSort(el) {
  el = el || document.getElementById('tab-detailing');
  const table = el && el.querySelector('table');
  applyColumnFilterAndSort(table, DETAIL_TABLE_KEY, detailRowsCache, DETAIL_COLUMNS.length, 'Нет деталей, соответствующих фильтру');
}

function openDetailFilterMenu(colIndex, btnEl) {
  // Уникальные значения — из ТЕКУЩИХ строк (detailRowsCache), не из ранее
  // сохранённого фильтра: значение, пропавшее из модели после изменения
  // параметров, само перестаёт попадать в список чекбоксов.
  const uniqueValues = Array.from(new Set(detailRowsCache.map((row) => row.vals[colIndex])))
    .sort((a, b) => a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' }));
  openColumnFilterMenu({
    tableKey: DETAIL_TABLE_KEY,
    colIndex,
    btnEl,
    uniqueValues,
    onChange: () => {
      applyDetailFilterAndSort();
      refreshDetailHeaderIndicators();
      refreshDetailResetButton();
    },
  });
}

function bindDetailFilterHeaders(el) {
  refreshDetailHeaderIndicators(el);
  el.querySelectorAll('.dth-filter-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDetailFilterMenu(Number(btn.dataset.col), btn);
    });
  });
}

function renderDetailingTable(model) {
  const el = document.getElementById('tab-detailing');
  // Если модель поменялась (recompute из другого места), пока висел поповер
  // фильтра — закрываем его: он ссылается на список значений устаревшего
  // рендера, оставлять открытым поверх новой таблицы не нужно.
  closeColumnFilterMenu();
  // Ножки — фурнитура, а не деталь из листа: в деталировку не попадают,
  // их количество считается в спецификации. Объединение одинаковых деталей
  // (сумма qty, общий номер позиции) уже сделано в engine.js — mergeEqualParts/
  // mergeKey — model.parts приходит СЮДА уже склеенным, повторно группировать
  // не нужно.
  const parts = model.parts.filter(r => !r.hardware);
  detailRowsCache = parts.map((r, i) => ({ idx: i, vals: detailRowValues(r) }));

  const headCells = DETAIL_COLUMNS.map((c, ci) => `
    <th data-col="${ci}"><span class="dth-label">${esc(c.label)}</span>
      <button type="button" class="dth-filter-btn" data-filter-key="${DETAIL_TABLE_KEY}" data-col="${ci}" title="Сортировка и фильтр">▾</button>
    </th>`).join('');
  const rows = detailRowsCache.map(({ idx, vals }) => `
    <tr data-row-idx="${idx}">
      <td>${vals[0]}</td>
      <td>${esc(vals[1])}</td>
      <td>${esc(vals[2])}</td>
      <td>${esc(vals[3])}</td>
      <td>${esc(vals[4])}</td>
      <td>${vals[5]}</td>
      <td>${vals[6]}</td>
      <td>${vals[7]}</td>
      <td>${esc(vals[8])}</td>
      <td>${esc(vals[9])}</td>
      <td>${esc(vals[10])}</td>
      <td>${esc(vals[11])}</td>
      <td>${esc(vals[12])}</td>
      <td>${esc(vals[13])}</td>
    </tr>`).join('');
  el.innerHTML = `
    <button type="button" class="detail-reset-filters" id="detailResetFilters"
      style="display:${detailHasActiveState() ? '' : 'none'}">Сбросить фильтры и сортировку</button>
    <table>
      <thead><tr>${headCells}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  bindDetailFilterHeaders(el);
  applyDetailFilterAndSort(el);

  const resetBtn = document.getElementById('detailResetFilters');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    resetColumnFilterState(DETAIL_TABLE_KEY);
    renderDetailingTable(model);
  });
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
    // sheets === null — изделие под заказ (стекло, фасад из массива, см.
    // catalog.js: customOrder), считается по площади, а не по листам.
    `<tr><td>${i + 1}</td><td>${esc(m.name)}</td><td>${esc(m.code)}</td><td>${m.area_m2} м²</td><td>${m.sheets == null ? '—' : m.sheets}</td><td>${m.price}</td><td>${m.sum}</td></tr>`).join('');
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
    section('4. Крепёж и метизы', fRows, ['№', 'Позиция', 'Артикул', 'Кол-во', `Цена, ${cur}`, `Сумма, ${cur}`]) +
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
        const changed = state.selected !== null || state.isolatedModule !== null || state.selectedPart !== null;
        state.selected = null;
        state.selectedPart = null;
        state.panelView = 'module';
        // Клик мимо снимает и режим изоляции — стекирования изоляций не бывает.
        exitIsolation();
        renderParamsPanel();
        if (changed) viewer.render(currentModel, viewOpts());
        return;
      }
      // Любой обычный (одиночный) клик по модулю снимает изоляцию — даже если
      // это тот же самый изолированный модуль: одно предсказуемое правило,
      // без стекирования изоляций (см. Этап 3 плана). Снимает и подсветку
      // отсека (state.selectedPart), оставленную предыдущим кликом по отсеку
      // (viewer.onSelectZone) — иначе бирюзовая подсветка «зависала» бы на
      // старом отсеке при обычном клике мимо него по тому же/другому модулю.
      exitIsolation();
      selectModuleByName(name);
      state.selectedPart = null;
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
      state.panelView = 'part';
      renderParamsPanel();
      viewer.render(currentModel, viewOpts());
      // Этот же обработчик вызывает и кнопка HUD «Режим редактирования детали»
      // (клик по модулю без входа в Focus Mode) — в этот момент дровер
      // «Параметры проекта» может быть закрыт, тогда экран «Деталь» рисуется,
      // но невидим. Открываем дровер явно, иначе кнопка выглядит так, будто
      // ничего не произошло.
      if (window.Modul3D.uiShell) window.Modul3D.uiShell.openDrawer('params');
    };

    // Клик по ЛЮБОЙ детали ВНУТРИ уже изолированного модуля — открывает
    // контекстное меню фокуса в точке клика (см. showFocusMenu выше), а не
    // сразу экран «Деталь»: «Редактировать деталь» ведёт на openPartEditor
    // (всегда как деталь, asPart:true — общий редактор одной детали, вне
    // зависимости от kind), «Выйти из фокуса» — на exitFocusMode. Пункты про
    // отсек (разбиение по высоте, редактор отсека) сюда больше не входят —
    // они переехали в viewer.onSelectZone ниже, который работает только ВНЕ
    // изоляции (см. комментарий там).
    viewer.onSelectPart = ({ module, kind, side, sectionIndex, zoneIndex, clientX, clientY }) => {
      // Деталь подсвечивается в 3D СРАЗУ по клику — ещё до того, как открыто
      // само меню и тем более выбран его пункт (см. viewOpts/viewer.render
      // ниже). panelView здесь НЕ трогаем — панель «Деталь» по-прежнему
      // открывается только явным выбором пункта меню (openPartEditor).
      state.selectedPart = { module, kind, side, subIndex: 0, sectionIndex, zoneIndex, asPart: false };
      viewer.render(currentModel, viewOpts());
      showFocusMenu(clientX, clientY, [
        { label: 'Редактировать деталь', action: () => openPartEditor(module, kind, side, sectionIndex, zoneIndex, true) },
        { label: 'Выйти из фокуса', action: exitFocusMode },
      ]);
    };

    // Клик по ОТСЕКУ (секция, при делении по высоте — конкретный отсек) ВНЕ
    // изоляции — обычный режим, где видны все модули сразу (см. viewer.js,
    // onSelectZone/_resolveZoneHit): срабатывает и по фасаду отсека, и по
    // любой другой видимой детали внутри него (полка, кусок задней стенки),
    // если фасада нет (открытая полка, ниша под встроенную технику). Это
    // новый короткий путь к отсеку — раньше попасть в него можно было только
    // через Focus Mode (двойной клик → onSelectPart выше), а для отсека без
    // фасада вообще не было по чему кликнуть.
    viewer.onSelectZone = ({ module, sectionIndex, zoneIndex, clientX, clientY }) => {
      const mm = state.modules.find((m) => m.name === module);
      const sec = mm && mm.sections[sectionIndex];
      if (!sec) return;
      // Отсек подсвечивается в 3D СРАЗУ по клику — ещё до выбора пункта меню
      // (по тому же принципу, что и onSelectPart в фокусе выше). Без этого
      // подсветка появлялась только после «Редактировать отсек», а сам клик
      // по отсеку выглядел так, будто ничего не произошло.
      state.selectedPart = { module, kind: 'door', side: undefined, subIndex: 0, sectionIndex, zoneIndex, asPart: false };
      viewer.render(currentModel, viewOpts());
      const items = [];
      // Число отсеков по высоте (пенал под встроенную технику) — единственный
      // способ задать его (в сайдбаре поля больше нет, см. renderSectionsList).
      // Полки-перегородки на стыках новых отсеков отдельно расставлять не
      // нужно — engine.js считает их сам при каждой сборке модели
      // (layoutDoorZones).
      items.push({
        type: 'numberInput', label: 'Разделить секцию на отсеки',
        value: Number(sec.doorZoneCount) || 1, min: 1, max: 4, buttonLabel: 'Разделить',
        onApply: (n) => {
          const applied = setDoorZoneCount(sec, n);
          // Нижний отсек по умолчанию — вровень с фасадом соседа (единая
          // горизонтальная линия по ряду), если высота ещё не задана вручную;
          // уже настроенную высоту не трогаем.
          if (applied >= 2 && !sec.doorZones[0].height) {
            const neighborH = findNeighborBottomZoneHeight(mm, sectionIndex);
            // Перевод «высота двери → высота ниши», см. setModuleDoorZoneCount.
            if (neighborH) sec.doorZones[0].height = window.Modul3D.engine.nicheFromEdgeDoorHeight(neighborH, state.bodyThickness);
          }
          renderParamsPanel();
          recompute();
        },
      });
      items.push({ label: 'Редактировать отсек', action: () => openPartEditor(module, 'door', undefined, sectionIndex, zoneIndex) });
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

// Панель «Библиотека» реально ВИДНА (drawer открыт классом .open, см.
// ui-shell.js: openDrawer/closeDrawer) и открыта именно на вкладке
// «Материалы» — используется, чтобы решить, нужно ли перерисовывать её
// содержимое сразу после фоновой подгрузки/отката правок каталога.
function isLibraryMaterialsPanelOpen() {
  const drawer = document.getElementById('drawer-library');
  return !!drawer && drawer.classList.contains('open') && state.libraryTab === 'materials';
}

// Фоновое сохранение правок каталога материалов на сервере (см.
// libSaveEdit/libAddRow/libRenameNode/libAddChildNode/libDeleteNode ниже —
// единственные точки, где реально меняются данные каталога). Задержка нужна,
// чтобы не слать запрос на каждое нажатие клавиши при инлайн-редактировании,
// а один раз после того, как пользователь остановился. Гость (без токена)
// ничего не сохраняет — те же правки просто живут в памяти вкладки до
// перезагрузки, как и раньше.
let catalogSaveTimer = null;
function scheduleCatalogSave() {
  if (!getAuthToken()) return;
  clearTimeout(catalogSaveTimer);
  catalogSaveTimer = setTimeout(async () => {
    // Перепроверяем токен прямо перед отправкой — за 1.5с ожидания
    // пользователь мог выйти (или на этой же вкладке войти другим
    // аккаунтом), и слать чужой/пустой токен с устаревшим снимком нельзя.
    const tokenNow = getAuthToken();
    if (!tokenNow) return;
    try {
      const blob = snapshotCatalogCollections();
      const res = await fetch(`${AUTH_API_BASE}/catalog-overrides`, {
        method: 'PUT',
        headers: { authorization: 'Bearer ' + tokenNow, 'content-type': 'application/json' },
        body: JSON.stringify({ data: blob }),
      });
      if (!res.ok) console.error('[catalogOverrides] не удалось сохранить:', await res.text().catch(() => ''));
    } catch (err) {
      console.error('[catalogOverrides] сеть недоступна, правки не сохранены:', err.message);
    }
  }, 1500);
}

// Подгрузка правок каталога, сохранённых на сервере — вызывается сразу
// после успешного fetchAccount() (пользователь точно залогинен). Сетевые
// ошибки — только в консоль, это фоновая синхронизация, не должна мешать
// работе. { data: null } — пользователь ещё не сохранял правки, оставляем
// заводской/текущий каталог как есть.
async function loadCatalogOverrides(token) {
  try {
    const res = await fetch(`${AUTH_API_BASE}/catalog-overrides`, {
      headers: { authorization: 'Bearer ' + token },
    });
    if (!res.ok) { console.error('[catalogOverrides] не удалось загрузить:', await res.text().catch(() => '')); return; }
    const payload = await res.json().catch(() => ({}));
    if (!payload || !payload.data) return;
    restoreCatalogFrom(payload.data);
    if (isLibraryMaterialsPanelOpen()) renderLibraryPanel();
    recompute();
    renderParamsPanel();
  } catch (err) {
    console.error('[catalogOverrides] сеть недоступна, правки не загружены:', err.message);
  }
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
  const sketchNote = document.getElementById('sketchAuthNote'); const workflowLink = document.getElementById('workflowLink'); if (workflowLink) workflowLink.style.display = (authAccount && authAccount.email === 'laromval@gmail.com') ? 'flex' : 'none';

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
    const emailVerifyBlock = document.getElementById('emailVerifyBlock');
    if (emailVerifyBlock) emailVerifyBlock.style.display = authAccount.emailVerified === false ? 'block' : 'none';
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
    // Пользователь точно залогинен — подгружаем правки каталога материалов,
    // сохранённые с прошлого раза (см. loadCatalogOverrides выше); у неё
    // свой try/catch, ошибка сети сюда не всплывёт.
    await loadCatalogOverrides(token);
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
    const opening = popover.style.display === 'none';
    popover.style.display = opening ? 'block' : 'none';
    // При открытии подтягиваем свежий статус аккаунта — иначе если email
    // подтвердили по ссылке из письма в другой вкладке, #emailVerifyBlock
    // остаётся показан до перелогина (authAccount не обновлялся сам собой).
    if (opening && getAuthToken()) fetchAccount();
  });
  popover.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', (e) => {
    if (!popover.contains(e.target) && !toggle.contains(e.target)) popover.style.display = 'none';
  });
  // Тот же сценарий (подтверждение по ссылке в другой вкладке), но когда
  // панель аккаунта уже была открыта и осталась открытой, пока пользователь
  // переключался на почту и обратно — по возврату на вкладку тоже подтягиваем
  // статус, если email ещё не подтверждён.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (popover.style.display === 'none') return;
    if (authAccount && authAccount.emailVerified === false) fetchAccount();
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

  // «Забыли пароль?» — POST /auth/forgot-password всегда отвечает 200 с
  // одинаковым сообщением независимо от того, найден email или нет (сервер
  // не палит зарегистрированные адреса), поэтому просто показываем ответ
  // сервера как обычный (не error) статус.
  const forgotBtn = document.getElementById('authForgotBtn');
  if (forgotBtn) {
    forgotBtn.addEventListener('click', async () => {
      const email = (emailInput.value || '').trim();
      if (!email) {
        setAuthStatus('Сначала введите email', 'error');
        return;
      }
      forgotBtn.disabled = true;
      setAuthStatus('Отправляем…', '');
      try {
        const data = await authRequest('/auth/forgot-password', { email });
        setAuthStatus(data.message || 'Если такой email зарегистрирован, на него отправлено письмо со ссылкой для сброса пароля.', '');
      } catch (err) {
        setAuthStatus('Ошибка: ' + err.message, 'error');
      } finally {
        forgotBtn.disabled = false;
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      // Отменяем отложенное сохранение каталога — иначе оно сработает через
      // 1.5с уже без токена (или, того хуже, с токеном другого аккаунта,
      // если за это время успели войти заново кем-то ещё) и отправит на
      // сервер устаревший снимок не от того пользователя (см.
      // scheduleCatalogSave выше).
      clearTimeout(catalogSaveTimer);
      setAuthToken(null);
      authAccount = null;
      emailInput.value = '';
      passwordInput.value = '';
      const reviewTextEl = document.getElementById('reviewText');
      if (reviewTextEl) reviewTextEl.value = '';
      setReviewStatus('', '');
      // Откат каталога материалов к заводским настройкам — следующий человек
      // за этим же браузером (или тот же пользователь как гость) не должен
      // видеть чужие правки (см. CATALOG_DEFAULTS/restoreCatalogFrom выше).
      restoreCatalogFrom(CATALOG_DEFAULTS);
      if (isLibraryMaterialsPanelOpen()) renderLibraryPanel();
      recompute();
      renderAccountUI();
    });
  }

  // Повторная отправка письма подтверждения email (POST
  // /auth/resend-verification, требует вход) — кнопка появляется в
  // #emailVerifyBlock, пока authAccount.emailVerified === false (см.
  // renderAccountUI выше).
  const resendVerificationBtn = document.getElementById('resendVerificationBtn');
  function setEmailVerifyStatus(message, kind) {
    const el = document.getElementById('emailVerifyStatus');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'sketch-status' + (kind ? ` ${kind}` : '');
  }
  if (resendVerificationBtn) {
    resendVerificationBtn.addEventListener('click', async () => {
      resendVerificationBtn.disabled = true;
      setEmailVerifyStatus('Отправляем…', '');
      try {
        let res;
        try {
          res = await fetch(`${AUTH_API_BASE}/auth/resend-verification`, {
            method: 'POST',
            headers: { authorization: `Bearer ${getAuthToken()}` },
          });
        } catch (networkErr) {
          throw new Error('Не удалось связаться с сервером — проверьте подключение к интернету.');
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // 400 здесь означает, что email уже подтверждён (см. POST
          // /auth/resend-verification на сервере) — значит просто не успели
          // обновить authAccount после подтверждения по ссылке из письма.
          // Подтягиваем статус заново, чтобы блок сразу скрылся сам.
          if (res.status === 400) {
            await fetchAccount();
            return;
          }
          throw new Error(data.error || 'Не удалось отправить письмо, попробуйте ещё раз.');
        }
        setEmailVerifyStatus(data.message || 'Письмо отправлено — проверьте почту.', 'ok');
      } catch (err) {
        setEmailVerifyStatus('Ошибка: ' + err.message, 'error');
      } finally {
        resendVerificationBtn.disabled = false;
      }
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
        if (!res.ok) {
          // 403 здесь означает именно неподтверждённый email (см.
          // server/src/middleware/emailVerification.js) — сырой текст ошибки
          // сервера упоминает API-эндпоинт, пользователю показываем понятную
          // подсказку со ссылкой на кнопку выше вместо него.
          if (res.status === 403) {
            setReviewStatus('Подтвердите email, чтобы оставить отзыв — воспользуйтесь кнопкой «Отправить письмо подтверждения ещё раз» выше.', 'error');
            return;
          }
          throw new Error(data.error || 'Не удалось отправить отзыв, попробуйте ещё раз.');
        }
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
  // ui-shell.js зовёт при ЛЮБОМ закрытии панели «Библиотека» (крестик, скрим,
  // Escape, свайп, открытие другой панели поверх) — без этого «Выбрать» у
  // «Листовых материалов» могла остаться включённой до следующего открытия
  // (пользователь нажал «+ Добавить материал», передумал, закрыл крестиком —
  // при обычном открытии Библиотеки позже колонка «Выбрать» была бы всё ещё
  // видна, и случайный клик по ней молча подменил бы материал проекта).
  clearLibraryPickTarget: function () { state.libPickTarget = null; },
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
  initCountertopPanel();
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
    closeDetailFilterMenu();
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
