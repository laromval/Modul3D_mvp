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
const APP_VERSION = 'v336';

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
// Декор по умолчанию нового проекта (H1145 ST10, catalog.DEFAULT_DECOR_CODE,
// решение 2026-09-26) — объект/код. Не «DECORS[0]»: порядок каталога меняют
// в Библиотеке. Позицию удалили — запасной первый декор (см. defaultDecor).
function defaultDecorObj() {
  const cat = window.Modul3D.catalog;
  return (typeof cat.defaultDecor === 'function' && cat.defaultDecor()) || DECORS[0];
}
function defaultDecorCode() { return defaultDecorObj().code; }

// Материал ящиков секции (решение владельца 2026-09-26, дополнено 2026-09-29
// для Hettich Quadro V6). sec.drawerDecorCode хранит ТОЛЬКО ручной выбор из
// панели «Ящики»; пусто (null/undefined) — «авто»:
//   1) ящики на Hettich Quadro V6 (насадной/надвижной) — ВСЕГДА ЛДСП
//      «0110 SM Белый» (16 мм), независимо от семейства модуля и материала
//      корпуса: боковина короба этой направляющей по документации Hettich
//      (MTA_9) ограничена ≤16 мм — это требование направляющей, а не
//      предпочтение по декору;
//   2) кухонный модуль (ящики не на Quadro) — тот же декор «0110 SM Белый»
//      (catalog.defaultKitchenDrawerDecor);
//   3) всё остальное (шкафы/тумбы, ящики не на Quadro) — материал корпуса
//      модуля, и ящики следуют за ним при смене корпуса.
// Сохранённый в старых проектах код считается ручным выбором и не трогается.
function isKitchenModule(mod) { return !!mod && mod.family === 'kitchen'; }
// Только EB20 (боковина до 16 мм). EB23 (quadroSlide23, боковина до 19 мм)
// сюда НАМЕРЕННО не входит: белый 16-мм дефолт ему не нужен, у него обычные
// правила (кухня — белый, иначе как корпус).
function isQuadroDrawerSystem(sec) {
  return !!sec && (sec.drawerSystem === 'quadro' || sec.drawerSystem === 'quadroSlide');
}
function kitchenDrawerDecorObj() {
  const cat = window.Modul3D.catalog;
  return (typeof cat.defaultKitchenDrawerDecor === 'function' && cat.defaultKitchenDrawerDecor()) || defaultDecorObj();
}
// Тот же декор, что и kitchenDrawerDecorObj() (сейчас оба — «0110 SM
// Белый») — отдельная функция, а не переиспользование «кухонной» напрямую,
// чтобы не путать причину дефолта (кухня — по семейству модуля, Quadro V6 —
// по факту требования направляющей), если значения когда-нибудь разойдутся.
function quadroDrawerDecorObj() { return kitchenDrawerDecorObj(); }
function carcassDecorCodeOf(mod) {
  const code = (mod && mod.carcassDecor) || state.decorCode;
  return (DECORS.find((d) => d.code === code) || defaultDecorObj()).code;
}
function effectiveDrawerDecorCode(mod, sec) {
  if (sec && sec.drawerDecorCode) return sec.drawerDecorCode;
  if (isQuadroDrawerSystem(sec)) return quadroDrawerDecorObj().code;
  return isKitchenModule(mod) ? kitchenDrawerDecorObj().code : carcassDecorCodeOf(mod);
}
// Подпись причины автовыбора материала ящиков — для панели «Ящики» и для
// списка «где используется материал» в Библиотеке.
function drawerDecorAutoLabel(mod, sec) {
  if (isQuadroDrawerSystem(sec)) return 'по умолчанию для Quadro V6';
  return isKitchenModule(mod) ? 'по умолчанию для кухни' : 'как корпус';
}
// Секции модуля для buildModel(): у кухонных секций и у секций на Quadro V6
// без ручного выбора подставляем код ящиков по умолчанию (копией, state не
// мутируем) — ядро должно получить его явно, раз для Quadro это требование
// направляющей, а не совпадение с корпусом. У остальных пустой код ядро само
// заменяет декором корпуса модуля (engine.js: sec.drawerDecorCode ||
// drawerDecor, drawerDecor = decor) — так ящики гарантированно совпадают с
// тем корпусом, который реально строится.
function engineSectionsOf(mod) {
  const secs = (mod && mod.sections) || [];
  const kitchen = isKitchenModule(mod);
  return secs.map((sec) => {
    if (!sec || sec.drawerDecorCode) return sec;
    // Порядок проверки СОВПАДАЕТ с effectiveDrawerDecorCode (Quadro раньше
    // кухни): сейчас quadroDrawerDecorObj()/kitchenDrawerDecorObj() дают
    // одно и то же значение, но если они когда-нибудь разойдутся, здесь и в
    // UI (лейбл секции, список «где используется материал») должен
    // получиться один и тот же декор — держите порядок веток одинаковым.
    if (isQuadroDrawerSystem(sec)) return Object.assign({}, sec, { drawerDecorCode: quadroDrawerDecorObj().code });
    if (kitchen) return Object.assign({}, sec, { drawerDecorCode: kitchenDrawerDecorObj().code });
    return sec;
  });
}
const { PRESETS } = window.Modul3D.presets;
const { recognizeSketch } = window.Modul3D.sketchAI;
const { buildDrawings, buildViewSVG, DRAWINGS_CSS } = window.Modul3D.drawings;
const { exportDrillCsv, exportDrillDxf } = window.Modul3D.cnc;
// Ручная разметка чертежа общего вида (src/markup.js). Необязательна: нет
// файла — приложение работает как раньше, просто без кнопки «Разметка».
const markupApi = window.Modul3D.markup || null;

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
    // drawerDecorCode: null — «авто» (кухня и Quadro V6 — 0110 SM, иначе как
    // корпус), см. effectiveDrawerDecorCode; код пишется только ручным
    // выбором в «Ящиках».
    drawerDecorCode: null, drawerThickness: 16, drawerSystem: 'ballBearing',
    widthMode: 'auto', width: 400,
  };
}
// ПОСТОЯННЫЙ uid МОДУЛЯ — строка, живёт в state.modules (значит, сама
// попадает в историю отмены, файл проекта и автосохранение). Нужен ручной
// разметке чертежа (src/markup.js): её точки ссылаются на «модуль + ключ
// детали» (engine.js: part.moduleUid/part.anchorKey), а не на part.id,
// который engine.js перенумеровывает заново для каждого модуля. Имя модуля
// тоже не годится — модули перенумеровываются при вставке/удалении.
function newModuleUid() {
  return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
// Старые проекты/автосохранения/снимки истории без uid — дописываем лениво;
// повтор uid (модуль скопирован целиком вместе с uid) — второй экземпляр
// получает новый, чтобы разметка одного не «переезжала» на другой.
function ensureModuleUids() {
  const seen = new Set();
  (state.modules || []).forEach((m) => {
    if (!m || typeof m !== 'object') return;
    if (typeof m.uid !== 'string' || !m.uid || seen.has(m.uid)) m.uid = newModuleUid();
    seen.add(m.uid);
  });
}
function newModule(name) {
  return {
    uid: newModuleUid(),
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
  // Материалы нового проекта по умолчанию — H1145 ST10 (catalog.
  // DEFAULT_DECOR_CODE): корпус, видимая боковина и фасад одного цвета.
  decorCode: defaultDecorCode(),
  // «Видимая боковина» (исторически — facadeDecorCode): ТОЛЬКО видимые
  // боковины и цоколь, фасады от неё не зависят (2026-09-26).
  facadeDecorCode: defaultDecorCode(),
  // «Материал фасада» (2026-09-26): декор ЛДСП-фасада по умолчанию — для
  // секций без своего sec.facadeMaterial. Читает engine.js как
  // proj.facadeMat. Старые проекты без поля — см. migrateFacadeMatCode.
  facadeMatCode: defaultDecorCode(),
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
  // Навес для верхних (навесных) модулей — общий на проект (блок «Навес для
  // верхних модулей» на экране «Материалы», hangerSystemBlock). Код из
  // catalog.HANGER_SYSTEMS; читает engine.js как proj.hangerSystem
  // (присадка навески, вырезы задней стенки, смета навесов и шины).
  hangerSystem: window.Modul3D.catalog.DEFAULT_HANGER_SYSTEM,
  // Направление текстуры по группам деталей — общее на проект (блок
  // «Направление текстуры», materialsBlock ниже): { [groupId]: 'across' },
  // нет ключа = «Авто». Читает engine.js как proj.grainGroups. Настройка
  // ОТДЕЛЬНОЙ детали живёт в модуле: mod.grainOverrides[grainKey].
  grainGroups: {},
  hideFacades: false,
  // Режим проверки присадки: корпус прозрачный, отверстия подсвечены
  drillCheck: false,
  // «Прозрачный режим»: все детали полупрозрачные (viewer.js, opts.xray).
  // Три режима вида — xray / hideFacades / drillCheck — независимы и
  // совмещаются; переключаются только через toggleXray/toggleHideFacades/
  // toggleDrillCheck (кнопки «Студии» и панели #viewToolbar).
  xray: false,
  // Показывать метки только одного вида присадки (клик по строке легенды)
  drillFilter: null,
  view: 'iso',
  activeModule: 0,
  // Имя подсвеченного модуля. null — выделение снято (клик по пустому месту).
  selected: null,
  modules: [],          // проект стартует пустым — первый модуль выбирает пользователь
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
  // («Листовые материалы»/«Виды фасадов»/«Кромка»/«Стекло», см.
  // libTopCategoryHtml) — { sheet: false, facade: false, edge: false, glass:
  // false }. Отдельно от libCollapsed выше по той же причине (см. коммент
  // там): сама категория не сворачивается как единое целое, только кликом
  // раскрывает/прячет прямых детей. Отсутствие записи = false (свёрнуто) —
  // то самое «при первом входе видно только название категории». Чисто
  // UI-состояние, сессионное.
  libCatOpen: {},
  // Последняя корневая категория вкладки («Материалы»/«Фурнитура»/«Двери»),
  // строку которой пользователь только что трогал в дереве (клик по
  // заголовку/ветке/листу, см. bindLibraryEvents) — { materials: 'sheet',
  // hardware: 'hw:hinge', facades: 'facade' }. Единственная цель — новая
  // своя корневая категория (кнопка-плитка «Добавить категорию», см.
  // libAddMaterialCategory/libAddHwCategory/libAddFacadeCategory) встаёт
  // СРАЗУ ПОСЛЕ этой категории (через libPlaceTopAt/libTopInsertIndex), а не
  // в конец списка (задача 2026-09-21) — «рядом с тем, с чем сейчас
  // работали». Нет записи (ничего не трогали) — прежнее поведение, в конец.
  // Чисто UI-состояние, сессионное, как libCatOpen выше — в снимок каталога
  // не попадает, это не структура дерева, а лишь подсказка «куда вставить
  // следующую категорию».
  libLastFocusedTop: {},
  // То же самое, но для ПОДкатегорий внутри одного родителя (значок «+» в
  // строке дерева, см. libAddChildNode) — ключ: libNodeKey(topCode,
  // parentPath), значение — имя последнего дочернего сегмента, который
  // пользователь раскрывал/фокусировал СРЕДИ ДЕТЕЙ ИМЕННО ЭТОГО родителя.
  // Новая подкатегория встаёт сразу после него (см. libAddChildNode), а не в
  // конец. Чисто UI-состояние, сессионное, как libLastFocusedTop выше.
  libLastFocusedChild: {},
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
  libExtraNodes: {
  "edge": [],
  "glass": [],
  "sheet": [
    [
      "ДСП",
      "Egger"
    ]
  ],
  "facade": [],
  "hw:hinge": [
    [
      "Blum"
    ]
  ],
  "mod:base": [
    [
      "Камоды"
    ],
    [
      "Прикроватные тумбочки"
    ]
  ],
  "hw:runner": [],
  "mod:kitchen": [
    [
      "Верхние модули"
    ],
    [
      "Нижний модуль"
    ]
  ]
},
  // СВОЙ порядок подкатегорий в дереве «Библиотеки», заданный
  // перетаскиванием строки узла мышью/пальцем (см. libTreeDragStart ниже) —
  // по разделу: { sheet: { '': ['ДСП', 'ХДФ/ДВП'], 'ДСП': ['Egger',
  // 'Kronospan'] } }. Ключ внутренней карты — путь РОДИТЕЛЯ
  // (path.join('::'), у корня раздела это пустая строка), значение — имена
  // его прямых детей в нужном порядке.
  // Зачем: без этой карты порядок детей — это порядок появления путей в
  // данных (см. libChildSegments), то есть фактически порядок позиций в
  // catalog.js; задать свой пользователь не мог никак.
  // Карта НЕ обязана перечислять всех детей: перечисленные идут первыми в
  // указанном порядке, остальные (только что заведённые, ещё не
  // упорядоченные) — следом, в прежнем порядке появления. «Без бренда»
  // (NO_BRAND_SUBCAT) всё равно остаётся последним — это правило сильнее
  // пользовательского порядка (см. libChildSegments).
  // В отличие от libCollapsed/libCatOpen выше это НЕ сессионное состояние:
  // едет на сервер в общем снимке каталога (см. snapshotCatalogCollections)
  // и переживает перезагрузку, как libExtraNodes/libHwCatLabels.
  libNodeOrder: {
  "sheet": {
    "": [
      "ДСП",
      "МДФ-плита",
      "ХДФ/ДВП"
    ],
    "ДСП": [
      "Egger",
      "Kronospan"
    ],
    "МДФ-плита": [
      "Фасадные панели МДФ",
      "Шпонированные плиты"
    ]
  },
  "hw:hinge": {
    "": [
      "Blum",
      "петли для стекла"
    ]
  },
  "mod:base": {
    "": [
      "Камоды",
      "Прикроватные тумбочки"
    ]
  },
  "mod:kitchen": {
    "": [
      "Нижний модуль",
      "Верхние модули"
    ]
  }
},
  // То же самое, но для КОРНЕВЫХ категорий — по вкладке «Библиотеки»:
  // { materials: ['edge','sheet','glass','countertop'],
  //   hardware: ['hw:handle','hw:hinge', …], facades: ['facade'] }.
  // Значения — коды разделов (те же, что в data-top строки дерева, см.
  // libTabTopCodes), а НЕ пути: у корня раздела нет categoryPath, его
  // порядок ни с какими данными каталога не связан. Именно поэтому
  // 'countertop' здесь участвует на общих правах, хотя его СОБСТВЕННОЕ
  // дерево виртуальное и узлы внутри него перетаскивать нельзя.
  // Перечисленные разделы идут первыми в указанном порядке, не
  // перечисленные (новая своя категория фурнитуры) — следом, в заводском
  // порядке. Как libNodeOrder выше, едет на сервер в снимке каталога.
  libTopOrder: {
  "modules": [
    "mod:kitchen",
    "mod:wardrobe",
    "mod:base",
    "mod:modcustom-1790063101995",
    "mod:modcustom-1790063135803"
  ],
  "hardware": [
    "hw:hinge",
    "hw:runner",
    "hw:handle",
    "hw:leg",
    "hw:support",
    "hw:plinth",
    "hw:countertop",
    "hw:mechanism",
    "hw:rod",
    "hw:fastener",
    "hw:custom-1790008010310"
  ],
  "materials": [
    "sheet",
    "edge",
    "glass",
    "countertop"
  ]
},
  // Вложенность КОРНЕВЫХ категорий друг в друга — по вкладке:
  // { hardware: { 'hw:shelfSupport': 'hw:fastener' } }, ключ — код
  // вложенной категории, значение — код её родителя (те же коды, что в
  // data-top, см. libTabTopCodes). Пользователь задаёт это перетаскиванием
  // заголовка на СЕРЕДИНУ другого заголовка.
  // Это ТОЛЬКО раскладка на экране: сама категория остаётся собой — свой
  // topCode, свои позиции со своим item.category, своё дерево. Ни одна
  // позиция при вложении не переезжает, поэтому операция полностью
  // обратима: тем же перетаскиванием категорию вытаскивают обратно наверх,
  // и мигрировать ничего не нужно.
  // Осиротевший/зацикленный родитель безопасен: libTopParentOf считает
  // такую категорию корневой (см. там же защиту от цикла).
  // Как libTopOrder выше — не сессионное состояние, едет на сервер в снимке
  // каталога.
  libTopParent: {
  "modules": {},
  "hardware": {},
  "materials": {}
},
  // Свои ПОДПИСИ корневых категорий вкладки «Фурнитура» — { hinge: 'Петельки',
  // 'custom-1758...': 'Уплотнители' }: ключ — тот же item.category, по которому
  // engine.js/specification.js подбирают фурнитуру в расчёте, значение — только
  // то, что видно на экране. Переименование встроенной категории (✎ на её
  // строке, см. libRenameNode) МЕНЯЕТ ТОЛЬКО ПОДПИСЬ и никогда сам ключ —
  // иначе спецификация осталась бы без петель/направляющих. Читать эту карту
  // нужно исключительно через libHwCategoryLabel() (единственное место, где
  // пользовательская подпись перекрывает заводскую catalog.js:
  // HARDWARE_CATEGORY_LABEL). В отличие от libCollapsed/libCatOpen выше это
  // не сессионное UI-состояние: подписи переживают перезагрузку вместе с
  // остальными правками каталога (см. snapshotCatalogCollections).
  libHwCatLabels: {
  "mechanism": "Подъемные механизмы.",
  "custom-1790008010310": "фурнтитура кухни"
},
  // СВОИ корневые категории фурнитуры, заведённые кнопкой «+ Добавить
  // категорию» на вкладке «Фурнитура» (см. libAddHwCategory) — массив ключей
  // вида 'custom-<timestamp>' в порядке добавления, они дописываются к
  // заводским HARDWARE_CATEGORY_ORDER (см. libHwCategoryKeys). Подпись такой
  // категории лежит в libHwCatLabels выше, а её позиции — обычная фурнитура с
  // item.category === этому ключу (HARDWARE_PRICES, см. libAddHardwareRow).
  // Расчёт про такие ключи ничего не знает — это просто контейнер каталога.
  // Как и libHwCatLabels, сохраняется на сервере вместе с правками каталога.
  libHwCustomCats: [
  "custom-1790008010310"
],
  // СВОИ корневые категории вкладок «Материалы» и «Двери», заведённые той же
  // кнопкой-плиткой «Добавить категорию» (новый визуальный стиль — маленький
  // квадрат с пунктирной рамкой и синим «+», см. libAddCatTileHtml), что и
  // libHwCustomCats выше, — тот же паттерн, только раздельно по вкладкам.
  // У «Материалов» встроенные разделы жёстко привязаны к типу товара
  // (Листовые материалы/Кромка/Стекло/Столешницы), поэтому своя категория —
  // одна и та же decor-таблица (код/название/цена листа/размеры/картинка) у
  // ЛЮБОЙ своей категории; её позиции — обычные DECORS с проставленным
  // item.customRoot = ключ категории, которое отличает их от «настоящих»
  // позиций «Листовых материалов» (см. libTopEntries/libAddMaterialCategory/
  // libAddRow). У «Дверей» то же самое, но позиции лежат в FACADE_MATERIALS.
  // Ключи — 'matcustom-<timestamp>'/'faccustom-<timestamp>' в порядке
  // добавления, подписи — в libMatCatLabels/libFacCatLabels рядом. Как и
  // libHwCustomCats, сохраняется на сервере вместе с правками каталога.
  libMatCustomCats: [],
  libMatCatLabels: {},
  libFacCustomCats: [],
  libFacCatLabels: {},
  // Свои ВЕРХНЕУРОВНЕВЫЕ категории «Базы модулей» (кнопка-плитка
  // libAddCatTileHtml('modules'), см. libAddModuleGroup) — топ-уровень
  // общего дерева наравне с группами PRESETS (src/presets.js), только
  // переименовываемый/удаляемый (см. libTreeRowHtml/libRenameNode/
  // libDeleteModuleTopCategory), как своя категория «Материалов»/«Фурнитуры»
  // выше. { key: 'modcustom-<timestamp>', name: 'Название' } в порядке
  // добавления. Как и остальные свои категории Библиотеки выше, сохраняется
  // на сервере вместе с правками каталога.
  libModCustomGroups: [
  {
    "key": "modcustom-1790063101995",
    "name": "Гарнитур"
  },
  {
    "key": "modcustom-1790063135803",
    "name": "кухня угловая"
  }
],
  // Дерево «Базы модулей» (2026-09-21, задача «строки вместо кнопок») — у
  // каждой карточки пресета есть СВОЙ путь в дереве, независимый от исходной
  // группы PRESETS (см. libModAllPlacements/libModTopEntries). Хранятся
  // ТОЛЬКО отклонения от дефолта — { <groupId>::<itemId ПРЕСЕТА>: { group,
  // categoryPath, name, removed } }: group/categoryPath — где карточка
  // сейчас лежит (по умолчанию group = родная группа PRESETS, categoryPath —
  // пусто), name — подпись ЭТОЙ карточки, переопределённая значком ✎
  // (contextmenu на миниатюре, см. libModRenameCard) — не название пресета,
  // removed — карточку убрали значком × (сам пресет в presets.js не
  // трогается, см. libModDeleteCard). Материализуется лениво: пока
  // пользователь карточку не трогал, записи для неё нет вовсе (см.
  // libModRealPlacement). Сохраняется на сервере вместе с правками каталога.
  libModOverrides: {
  "base::bedside": {
    "categoryPath": [
      "Прикроватные тумбочки"
    ],
    "categoryPathEdited": true
  },
  "base::drawers": {
    "categoryPath": [
      "Камоды"
    ],
    "categoryPathEdited": true
  },
  "base::doorDrawer": {
    "categoryPath": [
      "Прикроватные тумбочки"
    ],
    "categoryPathEdited": true
  },
  "kitchen::sink800": {
    "group": "kitchen",
    "categoryPath": [
      "Нижний модуль"
    ],
    "categoryPathEdited": true
  },
  "kitchen::tall600": {
    "group": "kitchen",
    "categoryPath": [
      "Нижний модуль"
    ],
    "categoryPathEdited": true
  },
  "kitchen::lower600": {
    "group": "kitchen",
    "categoryPath": [
      "Нижний модуль"
    ],
    "categoryPathEdited": true
  },
  "kitchen::upper600": {
    "categoryPath": [
      "Верхние модули"
    ],
    "categoryPathEdited": true
  },
  "kitchen::upper800": {
    "categoryPath": [
      "Верхние модули"
    ],
    "categoryPathEdited": true
  },
  "kitchen::cornerSink": {
    "group": "kitchen",
    "categoryPath": [
      "Нижний модуль"
    ],
    "categoryPathEdited": true
  },
  "kitchen::cornerLower": {
    "removed": true
  },
  "kitchen::cornerUpper": {
    "categoryPath": [
      "Верхние модули"
    ],
    "categoryPathEdited": true
  },
  "kitchen::lower600drawers": {
    "group": "kitchen",
    "categoryPath": [
      "Нижний модуль"
    ],
    "categoryPathEdited": true
  }
},
  // НЕЗАВИСИМЫЕ копии карточек «Базы модулей», заведённые значком «+»
  // (копировать, см. libModCopyCard) — в отличие от libModOverrides выше это
  // не отклонение уже существующей карточки, а совсем НОВОЕ размещение того
  // же пресета: { id: 'modplace-<timestamp>-<rand>', presetId:
  // '<groupId>::<itemId>', group, categoryPath, name }. Одна карточка
  // presetId может иметь произвольное число таких копий одновременно в
  // разных местах дерева, независимо друг от друга и от её дефолтной
  // карточки. Сохраняется на сервере вместе с правками каталога.
  //
  // С 2026-09-22 сюда же попадают ПОЛНОСТЬЮ СВОИ карточки, заведённые
  // «Сохранить»/«Сохранить как…» (контекстное меню вкладки модуля, см.
  // showModuleMenu/libModSaveModule/libModSaveModuleAs) и кнопкой «Добавить
  // модуль» в шапке этой панели (см. libraryBlock/libModSaveProjectAsKit) —
  // presetId у них ОТСУТСТВУЕТ, вместо ссылки на presets.js карточка несёт
  // параметры сама:
  //  - одиночный модуль — { id, group, categoryPath, name, params }, params —
  //    те же поля, что у объекта в state.modules (name/width/height/depth/
  //    rotation/corner/family/leftSide/rightSide/baseType/plinthHeight/
  //    legHeight/topType/railWidth/sections/... — служебные UI-поля вроде
  //    activeSection сняты, см. libModCloneModuleParams);
  //  - комплект нескольких модулей — { id, group, categoryPath, name, kit:
  //    [{ params, x, z }, ...] }, порядок элементов kit — порядок модулей
  //    вдоль ряда (та же раскладка, что и в engine.js buildModel — модули
  //    расставляются строго по порядку массива, поворот/угол читаются из
  //    самого params); x/z — их взаимное смещение на момент сохранения
  //    (первый модуль всегда 0/0), это лишь справочные координаты для
  //    самодостаточности данных, при вставке в проект (см.
  //    addLibModCardToProject) не используются — раскладку и так
  //    воспроизводит порядок вставки.
  // Модуль, добавленный из такой карточки (или из старой, ссылающейся на
  // presetId), несёт на себе state.modules[i].libOrigin = id этой карточки
  // (кроме элементов комплекта — см. комментарий у addLibModCardToProject) —
  // по нему «Сохранить» находит, какую карточку перезаписать.
  // С 2026-09-28 такая карточка (одиночная и kit) несёт ещё materialSnapshot
  // — { decorCode, facadeDecorCode, facadeMatCode, backCode }, замороженные
  // на момент нажатия «Сохранить» (см. libModMaterialSnapshotOf) — превью
  // карточки рисует материалы ИЗ снимка, а не из текущего проекта (иначе
  // своя карточка «плавает» так же, как раньше плавали заводские, см.
  // libModCustomThumbDataUrl). У карточек, сохранённых раньше, поля нет —
  // превью для них по-прежнему берёт материалы из текущего проекта.
  libModPlacements: [
  {
    "id": "modplace-1790022541237-489qo9",
    "name": null,
    "group": "base",
    "presetId": "kitchen::lower600drawers",
    "categoryPath": [
      "Камоды"
    ]
  },
  {
    "id": "modplace-1790149508761-0sjz0u",
    "name": "комод для беллья",
    "group": "base",
    "params": {
      "name": "Модуль 1",
      "depth": 510,
      "width": 950,
      "corner": false,
      "family": "kitchen",
      "height": 820,
      "topType": "rails",
      "baseType": "legsPlinth",
      "leftSide": "floor",
      "rotation": 0,
      "sections": [
        {
          "rod": false,
          "lift": "aventosHK",
          "width": 400,
          "facade": "liftUp",
          "handle": "bow160",
          "drawers": 0,
          "shelves": 1,
          "handleCC": 160,
          "rodHeight": 1900,
          "shelfMode": "auto",
          "widthMode": "auto",
          "drawerMode": "auto",
          "pushToOpen": false,
          "drawerOffset": 10,
          "drawerPinned": [],
          "drawerSystem": "ballBearing",
          "handleOrient": "vertical",
          "shelfHeights": [],
          "drawerHeights": [],
          "drawerDecorCode": null,
          "drawerThickness": 16
        }
      ],
      "legHeight": 100,
      "railWidth": 100,
      "rightSide": "floor",
      "countertop": {
        "enabled": true,
        "decorCode": "H1180ST37",
        "overhangBack": 52,
        "overhangLeft": 0,
        "overhangFront": 0,
        "overhangRight": 0
      },
      "plinthHeight": 100
    },
    "categoryPath": [
      "Камоды"
    ]
  }
],
  // Режим подбора материала в Библиотеке (плашки экрана «Материалы», см.
  // matPickPlashkaHtml/openMaterialPicker/openFacadeMaterialPicker) или null,
  // когда подбор не идёт. Роли:
  //   { role: 'decor' | 'facadeDecor' | 'facadeMat' | 'back', returnTo: 'materials' } —
  //     материал корпуса / видимой боковины / фасада (ЛДСП по умолчанию) /
  //     задней стенки проекта;
  //   { role: 'countertopDecor' } — «свой материал» столешницы;
  //   { role: 'facadeMaterial', moduleIdx, moduleName, secIdx, zoneIdx,
  //     returnTo: 'materials' | 'module' } — материал фасада секции
  //     (zoneIdx null) или отсека; для alu — цель конструктора фасада;
  //   { role: 'partMaterial', moduleIdx, moduleName, key, kind, returnTo: 'part' } —
  //     материал ОДНОЙ детали с экрана «Деталь» (mod.partOverrides[key]);
  //   { role: 'aluFill', parent } — заполнение рамки в конструкторе
  //     (state.aluDraft), parent — цель facadeMaterial, к которой вернуться.
  // Пока не пуст, таблицы Библиотеки рисуют «Выбрать» у подходящих строк
  // (libPickRowAllowed). Чисто UI-состояние, как libraryTab выше: в историю
  // отмены/файл проекта не попадает.
  libPickTarget: null,
  // Черновик конструктора алюм. фасада (Библиотека → Двери → «Алюминиевые
  // фасады», см. libAluConstructorHtml): { aluProfile, aluColor, aluFill,
  // aluPriceMode, aluMaker } или null. UI-состояние, в проект не пишется.
  aluDraft: null,
  // Какой отсек активной секции выбран в поле «Фасад» экрана «Материалы»
  // (null — сама секция), см. matFacadeTarget. UI-состояние. matFacadeZoneFor —
  // для какой секции он выбран (matFacadeOwnerKey): сменилась активная
  // секция/модуль — выбор отсека сбрасывается на секцию.
  matFacadeZone: null,
  matFacadeZoneFor: null,
  // Разовое уведомление для панели «Столешница» (countertopPanelBlock) —
  // ставится сразу после того, как «Изменить» материал столешницы применил
  // его не только к активной тумбе, но и ко всей физически стыкующейся
  // цепочке (см. libPickMaterial, role: 'countertopDecor'). Строка текста
  // или null. countertopPanelBlock() показывает его один раз и тут же
  // обнуляет — следующий рендер панели (любое другое изменение) его больше
  // не покажет. Ставится, только когда в цепочке больше одного модуля —
  // на одиночную тумбу без соседей уведомление не показываем (поведение не
  // отличается от применения материала до появления цепочек). Чисто
  // UI-состояние, в историю отмены/файл проекта не попадает.
  countertopChainNotice: null,
  // Единица, в которой показана колонка «Цена» ВО ВСЕХ таблицах вкладки
  // «Материалы» одновременно (общий переключатель, выбирается прямо в шапке
  // любой из таблиц, см. libPriceUnitHeaderHtml) — 'perM2' (по умолчанию,
  // так цена подаётся у поставщика mobilier.md для листовых материалов) или
  // один из 'native' | 'perMeter' | 'perPiece' | 'perSheet' (см.
  // libPriceValueForUnit). 'native' — «как на сайте»: показывает цену в
  // РОДНОЙ единице конкретной позиции (см. libNativeUnitsOf/
  // libPriceEffectiveUnit) — ровно то число, что лежит в её catalog-поле,
  // без пересчёта; у разных позиций это может быть разная единица (лист vs
  // пог.метр). Остальные — принудительный пересчёт ВСЕХ позиций в одну и ту
  // же единицу, ручной выбор пользователя для сравнения материалов между
  // собой (см. libPricePerM2) — реальная стоимость проекта в спецификации
  // всё равно считается по своим правилам (за лист/пог.метр), эта колонка
  // их не подменяет. Чисто UI-состояние, как libraryTab выше: в историю
  // отмены/файл проекта не попадает.
  libPriceUnit: 'perM2',
  // То же самое, но для таблиц вкладки «Фурнитура» (см.
  // libHwPriceUnitHeaderHtml) — ОТДЕЛЬНОЕ поле, а не общее с libPriceUnit
  // выше: единицы у вкладок разные по смыслу (у материалов это «в чём
  // ПОКАЗАТЬ цену» с пересчётом лист↔м²↔пог.м, у фурнитуры пересчитывать
  // нечем — шт/пара/уп/пог.м между собой не переводятся, там это «показать
  // только позиции, которые продаются в этой единице»), и переключение на
  // одной вкладке не должно молча менять вид другой.
  // Хранится ПО КОРНЕВОЙ КАТЕГОРИИ — { 'hw:hinge': 'native', 'hw:slide':
  // 'пара' }, ключ тот же topCode, что у libCatOpen/libActiveLeaf выше.
  // Одного значения на всю вкладку не хватало (исправлено 2026-09-16):
  // «Цена/пара», выбранная в «Направляющих», превращала таблицу «Петель» в
  // сплошные «—», и соседняя категория выглядела сломанной.
  // Отсутствие ключа = 'native' — «как в позиции»: цена каждой строки как
  // есть, без отбора по единице; любое другое значение — одна из реальных
  // единиц фурнитуры (см. LIB_HW_UNIT_OPTIONS), тогда строки с ДРУГОЙ
  // единицей показывают «—» (так же поступают материалы, когда пересчитать
  // нечем, см. libPriceCellHtml). Чисто UI-состояние: в снимок каталога
  // (snapshotCatalogCollections) НЕ входит — в отличие от соседних
  // libHwCatLabels/libHwCustomCats — и в историю отмены/файл проекта тоже
  // не попадает.
  libHwPriceUnit: {},
  // Свёрнутость колонок Длина/Ширина/Толщина (кнопка «Характеристики
  // листа», см. libTableHead/libLeafTableHtml) — ОБЩАЯ на всю Библиотеку
  // (как libPriceUnit выше), а не своя у каждой открытой таблицы: одна и та
  // же кнопка в любой из одновременно открытых таблиц сворачивает/
  // разворачивает их все разом — цель именно в этом (высвободить место под
  // 3D-сцену, а не сравнивать таблицы между собой в разных режимах).
  // Дефолт true (свёрнуто) — при первом входе в Библиотеку панель уже и
  // компактна (см. .lib-wide.lib-chars-collapsed в style.css). Чисто
  // UI-состояние, сессионное.
  libCharsCollapsed: true,
  // Видимость колонки «Поставщик» (кнопка-тумблер «Поставщики», см.
  // libLeafTableHtml/libHardwareLeafTableHtml) — сайт, с которого добавлена
  // цена позиции (см. libSourceSiteLabel). НЕЗАВИСИМА от libCharsCollapsed
  // выше — свой отдельный тумблер, но так же общая на всю Библиотеку и
  // сессионная (в историю/файл проекта не попадает). Дефолт false: колонка
  // не всем нужна каждый день, не стоит занимать место сразу.
  libSuppliersVisible: false,
  // Видимость колонки «Чертёж» у таблицы ФУРНИТУРЫ (кнопка-тумблер
  // «Характеристики» рядом с «Поставщики», см. libHardwareLeafTableHtml) —
  // миниатюра чертежа присадки конкретной позиции (it.drawing). НЕЗАВИСИМА
  // ни от libSuppliersVisible выше, ни от libCharsCollapsed (та вообще про
  // другую таблицу — материалы, колонки Длина/Ширина/Толщина). Своя, потому
  // что у фурнитуры и материалов разный смысл «характеристик». Чисто
  // UI-состояние, сессионное, дефолт false — как и остальные тумблеры колонок.
  libHwCharsVisible: false,
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
  // Форма «Добавить по ссылке» (панель «Библиотека → Материалы»/«Фурнитура»,
  // см. openLibLinkForm/libLinkFormHtml) — null, пока форма закрыта, иначе
  // { kind: 'materials'|'hardware', top, group, path (у 'materials') |
  // hwCategory (у 'hardware'), step: 'input'|'loading'|'confirm', siteId,
  // url, error, draft } — draft приходит из POST /catalog-link-parse.
  // Значения полей самого экрана подтверждения ЗЕРКАЛЯТСЯ сюда же (values —
  // поля data-f, extra — инженерные поля data-ef, cat — раздел/новая
  // подкатегория, variantSel — выбранная комбинация вариативного товара,
  // touched — какие поля пользователь правил руками): раньше они жили только
  // в DOM, и любая перерисовка панели (выбор раздела фурнитуры, догрузка
  // списка сайтов) молча возвращала значения парсера поверх ввода
  // пользователя. Пишет их libLinkCaptureFormState на каждый input/change,
  // читает libLinkConfirmHtml при перерисовке. Это НЕ означает
  // перерисовку на каждое нажатие клавиши — DOM по-прежнему правится
  // точечно (см. libLinkRevalidate), иначе слетал бы фокус/курсор.
  // Чисто UI-состояние, в историю отмены/файл проекта не попадает.
  libLinkForm: null,
  // Список поддерживаемых сайтов для формы «Добавить по ссылке» (см.
  // loadLibLinkSites) — null, пока не загружен ни разу, [] — загружен (пуст
  // или запрос не удался, см. libLinkSitesError). Кэшируется на всю сессию.
  libLinkSites: null,
  libLinkSitesLoading: false,
  libLinkSitesError: null,
  // Промис текущей/последней загрузки списка сайтов (см. loadLibLinkSites) —
  // нужен, чтобы «Обновить цены с сайта» (refreshCatalogLinkedPrices) могла
  // ДОЖДАТЬСЯ список, если он ещё не подгружен (раньше грузился только при
  // открытии формы «Добавить по ссылке»), не запуская второй параллельный
  // запрос, если загрузка уже идёт.
  libLinkSitesPromise: null,
  // Сайты-источники текстур листа (GET /texture-sources, см. loadTextureSources)
  // — тот же принцип, что у libLinkSites: null до первой загрузки, [] при
  // ошибке. texBusy — коды материалов, у которых прямо сейчас идёт повторная
  // загрузка текстуры кнопкой «Загрузить» в таблице Библиотеки.
  texSources: null,
  texSourcesLoading: false,
  texSourcesError: null,
  texSourcesPromise: null,
  texBusy: {},
  // Статус кнопки «Обновить цены с сайта» (см. refreshCatalogLinkedPrices) —
  // libLinkRefreshBusy: запрос выполняется прямо сейчас; libLinkRefreshResult:
  // null, пока не запускали, иначе { updated, failed } или { error }.
  libLinkRefreshBusy: false,
  libLinkRefreshResult: null,
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
  // как и panelView выше.
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
// Правки каталога материалов И фурнитуры (панель «Библиотека → Материалы» /
// «Фурнитура»): заводской снимок + восстановление — общий механизм и для
// отката к заводским настройкам (см. logoutBtn ниже), и для подгрузки правок,
// сохранённых на сервере (см. fetchAccount() и scheduleCatalogSave() в
// разделе «Аккаунт» ниже). Четыре источника фурнитуры (HARDWARE_PRICES/
// HANDLES/LIFTS/FASTENER_PRICES) добавлены сюда вместе с фичей «Добавить по
// ссылке» (см. libLinkSaveHardware/refreshCatalogLinkedPrices) — раньше
// правки фурнитуры вообще не попадали в снимок (см. историю libSaveEdit/
// libAddRow: их специально пропускали для group.indexOf('hw:')==0/'hwadd:'),
// то есть жили только в памяти вкладки и терялись при перезагрузке; для
// позиций, добавленных по ссылке (sourceUrl/sourceSiteId должны переживать
// перезагрузку — иначе «Обновить цены с сайта» после неё было бы нечего
// обновлять), это уже не подходит, поэтому фурнитура теперь тоже часть
// снимка/восстановления наравне с материалами. Встроенные позиции (HANDLES.
// none, HANDLE_ORDER/LIFT_ORDER и т.п.) это не ломает — панель «Библиотека»
// не даёт их удалить (см. комментарий у libFindHardwareUsages), они всегда
// присутствуют в снимке. ВАЖНО: DECORS/BACK_MATERIALS и
// window.Modul3D.catalog.* — это ссылки на массивы/объекты, захваченные
// ОДИН РАЗ при загрузке скрипта (см. деструктуризацию выше) — восстановление
// обязано мутировать их НА МЕСТЕ (как и libSaveEdit/libAddRow), а не
// переприсваивать, иначе весь остальной код, читающий голые идентификаторы
// DECORS/BACK_MATERIALS/HANDLES/LIFTS, не увидит изменений.
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
    hardware: JSON.parse(JSON.stringify(cat.HARDWARE_PRICES)),
    handles: JSON.parse(JSON.stringify(cat.HANDLES)),
    lifts: JSON.parse(JSON.stringify(cat.LIFTS)),
    fasteners: JSON.parse(JSON.stringify(cat.FASTENER_PRICES)),
    libExtraNodes: JSON.parse(JSON.stringify(state.libExtraNodes)),
    // Свой порядок подкатегорий, заданный перетаскиванием (2026-09-17) —
    // тем же способом и по той же причине, что libExtraNodes выше: это
    // такая же правка дерева каталога, как заведённая руками пустая
    // категория, и пропадать при перезагрузке она не должна.
    libNodeOrder: JSON.parse(JSON.stringify(state.libNodeOrder)),
    // Порядок КОРНЕВЫХ категорий вкладок — тем же способом и по той же
    // причине, что libNodeOrder выше (см. state.libTopOrder).
    libTopOrder: JSON.parse(JSON.stringify(state.libTopOrder)),
    // Вложенность категорий друг в друга — тем же способом (см.
    // state.libTopParent).
    libTopParent: JSON.parse(JSON.stringify(state.libTopParent)),
    // Дерево категорий вкладки «Фурнитура» (2026-09-16): свои подписи
    // корневых категорий и свои корневые категории — те же правки каталога,
    // что и всё остальное в этом снимке, поэтому едут на сервер тем же
    // механизмом, без второго параллельного хранилища. Сами ПЕРЕНОСЫ/
    // переименования узлов ниже корня отдельного места в снимке не требуют:
    // они живут в item.categoryPath самих позиций (см. libSetEntryPath) и в
    // libExtraNodes (пустые категории-заглушки) — и то, и другое здесь уже есть.
    libHwCatLabels: JSON.parse(JSON.stringify(state.libHwCatLabels)),
    libHwCustomCats: JSON.parse(JSON.stringify(state.libHwCustomCats)),
    // Свои корневые категории «Материалов»/«Дверей» и «Базы модулей» (кнопка-
    // плитка «Добавить категорию», см. комментарий у state.libMatCustomCats) —
    // тем же способом и по той же причине, что libHwCatLabels/libHwCustomCats
    // выше: без этого свои категории пропадали бы при перезагрузке страницы,
    // ровно как уже один раз случилось с фурнитурой (см. комментарий над
    // snapshotCatalogCollections). Сами позиции внутри matcustom-/faccustom-
    // категорий (item.customRoot) отдельно регистрировать не нужно — они
    // обычные записи DECORS/FACADE_MATERIALS и так целиком попадают в decors/
    // facade выше.
    libMatCustomCats: JSON.parse(JSON.stringify(state.libMatCustomCats)),
    libMatCatLabels: JSON.parse(JSON.stringify(state.libMatCatLabels)),
    libFacCustomCats: JSON.parse(JSON.stringify(state.libFacCustomCats)),
    libFacCatLabels: JSON.parse(JSON.stringify(state.libFacCatLabels)),
    libModCustomGroups: JSON.parse(JSON.stringify(state.libModCustomGroups)),
    // Дерево «Базы модулей» (см. комментарий у state.libModOverrides/
    // libModPlacements выше) — тем же способом и по той же причине, что и
    // остальные свои правки каталога в этом снимке.
    libModOverrides: JSON.parse(JSON.stringify(state.libModOverrides)),
    libModPlacements: JSON.parse(JSON.stringify(state.libModPlacements)),
    // Алюминиевые рамочные фасады (Библиотека → Двери → «Алюминиевые
    // фасады», см. libAluFacadesHtml). Снимок — объекты целиком (так их
    // сможет подставить и публикация каталога, если на сервере добавят
    // эти ключи), но ВОССТАНАВЛИВАЮТСЯ только редактируемые поля (цена/
    // единица/длина палки/цена за м², своя картинка сечения) — см.
    // restoreAluCatalogFrom. sectionImage (картинка чертежа, загруженная
    // пользователем) едет в ЕГО правки каталога, но в базу по умолчанию не
    // публикуется — сервер при публикации берёт у aluProfiles только
    // price/priceUnit/barLength (см. libAluSectionImageBtnsHtml).
    aluProfiles: JSON.parse(JSON.stringify(cat.ALU_PROFILES || {})),
    aluFrameExtras: JSON.parse(JSON.stringify(cat.ALU_FRAME_EXTRAS || {})),
    aluMakers: JSON.parse(JSON.stringify(cat.ALU_MAKERS || {})),
  };
}

// Поля алюминиевых коллекций каталога, которые пользователь правит в
// Библиотеке. Остальное (сечение width/depth/section, тип kind, паз
// fillStop/fillGap, петля, контакты производителя) всегда берётся из свежего
// catalog.js — иначе старое сохранение навсегда прятало бы данные паспорта
// профиля, добавленные разработчиком позже.
// keepFresh — поля, у которых сохранённый null НЕ затирает значение из
// catalog.js: старые правки (до ответа поставщика) хранили priceUnit/
// barLength = null, и без этого у LXD3080 пропадали бы «за пог. м» и хлыст
// 5.8 м. Своё значение (не null) пользователя по-прежнему главнее.
const ALU_CATALOG_EDITABLE = {
  aluProfiles: { constName: 'ALU_PROFILES', fields: ['price', 'priceUnit', 'barLength', 'sectionImage'], keepFresh: ['priceUnit', 'barLength'] },
  aluFrameExtras: { constName: 'ALU_FRAME_EXTRAS', fields: ['price'] },
  aluMakers: { constName: 'ALU_MAKERS', fields: ['pricePerM2'] },
};
function restoreAluCatalogFrom(blob) {
  const cat = window.Modul3D.catalog;
  Object.keys(ALU_CATALOG_EDITABLE).forEach((key) => {
    const def = ALU_CATALOG_EDITABLE[key];
    const target = cat[def.constName];
    const fresh = CATALOG_DEFAULTS[key] || {};
    const saved = blob[key];
    if (!target || !saved) return;
    Object.keys(target).forEach((code) => {
      const item = target[code];
      def.fields.forEach((f) => {
        const freshVal = (fresh[code] || {})[f];
        const hasSaved = saved[code] && Object.prototype.hasOwnProperty.call(saved[code], f);
        let val = hasSaved ? saved[code][f] : freshVal;
        if (val == null && (def.keepFresh || []).indexOf(f) >= 0) val = freshVal;
        if (f === 'sectionImage' && !aluSectionImageOk(val)) val = null;
        item[f] = val === undefined ? null : val;
      });
    });
  });
}

// Заводской снимок каталога — снимается ОДИН раз при загрузке скрипта, до
// того как пользователь успеет что-либо отредактировать в «Библиотеке» и до
// первой попытки подгрузить сохранённые на сервере правки. Заодно служит
// «эталоном» для мержа при восстановлении сохранённого снимка — см.
// mergeCatalogItem/restoreCatalogFrom ниже.
const CATALOG_DEFAULTS = snapshotCatalogCollections();

// Поля, которые ВСЕГДА берём из свежего catalog.js (CATALOG_DEFAULTS), а не
// из сохранённого на сервере снимка, — для позиции, которая уже существует в
// заводском каталоге (сверяем по code/ключу), пользователь не может
// отредактировать их через UI (нет такой ячейки в libEditCell), это чисто
// метаданные разработчика. Без этого старый снимок, сохранённый ДО правки
// catalog.js, навсегда прятал бы любое будущее обновление (новое фото, новую
// ссылку, новую категорию) для каждого залогиненного пользователя — ровно то,
// что случилось с фото/русскими ссылками mobilier.md 2026-09-15.
const CATALOG_REFRESH_FIELDS = ['sourceUrl', 'categoryPath', 'subcategory', 'brand'];

// image — особый случай: в одном поле лежит и заводское фото (обычная
// http(s)-ссылка из catalog.js), и свой образец, загруженный пользователем
// (data:-URL, см. openLibImagePicker/FileReader.readAsDataURL). Различить их
// можно по формату значения. Если в снимке лежит http(s)-ссылка — это просто
// копия старого заводского фото на момент сохранения, а не то, что
// пользователь сам загрузил, поэтому её тоже обновляем на свежую; сам
// загруженный файл (data:) — всегда сохраняем как есть.
function mergeCatalogItem(savedItem, freshItem) {
  const merged = Object.assign({}, savedItem);
  CATALOG_REFRESH_FIELDS.forEach((f) => {
    if (freshItem[f] !== undefined) merged[f] = freshItem[f]; else delete merged[f];
  });
  const savedIsUpload = typeof savedItem.image === 'string' && savedItem.image.indexOf('data:') === 0;
  merged.image = savedIsUpload ? savedItem.image : freshItem.image;
  // Чертёж (колонка «Чертёж» под «Характеристики», см. libDrawingSwatchHtml) —
  // тот же приём: заводской путь к картинке в assets/drawings обновляем, а
  // загруженный пользователем файл (data:) не трогаем. У позиций, которым
  // заводской чертёж не заведён, сохранённое значение остаётся как есть.
  const savedDrawingIsUpload = typeof savedItem.drawing === 'string' && savedItem.drawing.indexOf('data:') === 0;
  if (!savedDrawingIsUpload && freshItem.drawing !== undefined) {
    merged.drawing = freshItem.drawing;
    if (freshItem.drawingFull !== undefined) merged.drawingFull = freshItem.drawingFull;
  }
  // priceNoteCleared — пользователь сам отредактировал цену этой позиции и
  // тем снял пометку о неточной цене (см. libClearPriceNote). У встроенных
  // позиций priceNote живёт в catalog.js, то есть freshItem всегда готов
  // принести её обратно — поэтому решение пользователя защищаем явно и
  // ПОСЛЕ цикла по CATALOG_REFRESH_FIELDS: что бы ни пришло из заводского
  // каталога, пометка остаётся снятой, пока он не сбросит каталог к
  // заводским настройкам целиком (см. restoreCatalogFrom(CATALOG_DEFAULTS)).
  if (merged.priceNoteCleared) delete merged.priceNote;
  // categoryPathEdited — пользователь САМ переименовал или перенёс категорию,
  // в которой лежит эта позиция (✎/⇄ в дереве «Библиотеки», см.
  // libSetEntryPath). Тот же приём и та же причина, что и у priceNoteCleared
  // выше: categoryPath/subcategory/brand входят в CATALOG_REFRESH_FIELDS, то
  // есть по умолчанию всегда перетираются свежим catalog.js — без этой
  // защиты любое переименование/перенос категории откатывалось бы назад при
  // следующей загрузке страницы (для встроенных позиций каталога — молча).
  // Ручная правка главнее заводских данных, ровно как с ценой.
  if (savedItem.categoryPathEdited) {
    merged.categoryPathEdited = true;
    ['categoryPath', 'subcategory', 'brand'].forEach((f) => {
      if (savedItem[f] !== undefined) merged[f] = savedItem[f]; else delete merged[f];
    });
  }
  return merged;
}

// Мержит сохранённый снимок МАССИВА (decors/back/countertop, позиции
// сверяются по item.code) со свежим заводским: позиции, которых нет в
// заводском наборе (пользователь добавил свои через «+ Добавить материал»),
// проходят как есть; общие позиции — через mergeCatalogItem; заводские
// позиции, которых нет в сохранённом снимке (появились в catalog.js уже
// после того, как пользователь последний раз сохранял правки), остаются
// заводскими, а не пропадают.
function mergeCatalogArray(savedArr, freshArr) {
  const freshByCode = {};
  (freshArr || []).forEach((it) => { freshByCode[it.code] = it; });
  const seen = {};
  const merged = (savedArr || []).map((it) => {
    seen[it.code] = true;
    const fresh = freshByCode[it.code];
    return fresh ? mergeCatalogItem(it, fresh) : it;
  });
  (freshArr || []).forEach((it) => { if (!seen[it.code]) merged.push(it); });
  return merged;
}

// То же самое для коллекций-СЛОВАРЕЙ (facade/edge/hardware/handles/lifts/
// fasteners — позиция сверяется по ключу объекта, не по code).
function mergeCatalogObject(savedObj, freshObj) {
  const merged = {};
  Object.keys(savedObj || {}).forEach((k) => {
    const fresh = (freshObj || {})[k];
    merged[k] = fresh ? mergeCatalogItem(savedObj[k], fresh) : savedObj[k];
  });
  Object.keys(freshObj || {}).forEach((k) => { if (!(k in merged)) merged[k] = freshObj[k]; });
  return merged;
}

// Мутирует все десять коллекций каталога + state.libExtraNodes из blob (той
// же формы, что CATALOG_DEFAULTS/snapshotCatalogCollections()) — источник
// blob может быть CATALOG_DEFAULTS (откат к заводским настройкам — тогда
// merge — это no-op, blob и «свежее» совпадают) или ответ сервера GET
// /catalog-overrides (подгрузка сохранённых правок, тогда merge реально
// подмешивает актуальные sourceUrl/image/categoryPath, см. mergeCatalogItem).
// Старые сохранённые blob'ы (до фичи «Добавить по ссылке») просто не
// содержат hardware/handles/lifts/fasteners — эти четыре ветки тогда
// остаются как в коде по умолчанию, без ошибок. cat.GLASS — единственная
// коллекция без ключей-позиций (один фиксированный материал, не
// массив/словарь, см. комментарий у canDelete в libLeafTableHtml), поэтому
// мержится напрямую через mergeCatalogItem, а не mergeCatalogObject.
function restoreCatalogFrom(blob) {
  if (!blob) return;
  // Полная подмена/merge DECORS/BACK_MATERIALS/FACADE_MATERIALS ниже может
  // вернуть для уже существующего code другие данные (например, другое имя
  // из сохранённых на сервере правок) — а именно по имени decorLook()
  // (viewer.js) определяет цвет миниатюры. Сбрасываем _thumbCache Библиотеки
  // целиком, чтобы не показать старую картинку под новыми данными каталога.
  _thumbCache.clear();
  const cat = window.Modul3D.catalog;
  const fresh = CATALOG_DEFAULTS;
  if (blob.decors) { DECORS.length = 0; DECORS.push.apply(DECORS, mergeCatalogArray(blob.decors, fresh.decors)); }
  if (blob.back) { BACK_MATERIALS.length = 0; BACK_MATERIALS.push.apply(BACK_MATERIALS, mergeCatalogArray(blob.back, fresh.back)); }
  if (blob.facade) {
    Object.keys(cat.FACADE_MATERIALS).forEach((k) => { delete cat.FACADE_MATERIALS[k]; });
    Object.assign(cat.FACADE_MATERIALS, mergeCatalogObject(blob.facade, fresh.facade));
  }
  if (blob.edge) {
    Object.keys(cat.EDGE_PRICES).forEach((k) => { delete cat.EDGE_PRICES[k]; });
    Object.assign(cat.EDGE_PRICES, mergeCatalogObject(blob.edge, fresh.edge));
  }
  if (blob.glass) {
    Object.keys(cat.GLASS).forEach((k) => { delete cat.GLASS[k]; });
    Object.assign(cat.GLASS, mergeCatalogItem(blob.glass, fresh.glass));
  }
  if (blob.countertop) {
    if (!cat.COUNTERTOP_MATERIALS) cat.COUNTERTOP_MATERIALS = [];
    cat.COUNTERTOP_MATERIALS.length = 0;
    cat.COUNTERTOP_MATERIALS.push.apply(cat.COUNTERTOP_MATERIALS, mergeCatalogArray(blob.countertop, fresh.countertop));
  }
  if (blob.hardware) {
    Object.keys(cat.HARDWARE_PRICES).forEach((k) => { delete cat.HARDWARE_PRICES[k]; });
    Object.assign(cat.HARDWARE_PRICES, mergeCatalogObject(blob.hardware, fresh.hardware));
  }
  if (blob.handles) {
    Object.keys(cat.HANDLES).forEach((k) => { delete cat.HANDLES[k]; });
    Object.assign(cat.HANDLES, mergeCatalogObject(blob.handles, fresh.handles));
  }
  if (blob.lifts) {
    Object.keys(cat.LIFTS).forEach((k) => { delete cat.LIFTS[k]; });
    Object.assign(cat.LIFTS, mergeCatalogObject(blob.lifts, fresh.lifts));
  }
  if (blob.fasteners) {
    Object.keys(cat.FASTENER_PRICES).forEach((k) => { delete cat.FASTENER_PRICES[k]; });
    Object.assign(cat.FASTENER_PRICES, mergeCatalogObject(blob.fasteners, fresh.fasteners));
  }
  if (blob.libExtraNodes) state.libExtraNodes = JSON.parse(JSON.stringify(blob.libExtraNodes));
  // Порядок подкатегорий, заданный перетаскиванием (см. state.libNodeOrder).
  // В снимках до 2026-09-17 этого ключа нет — тогда порядок остаётся
  // «как в данных», ровно как было до появления перетаскивания.
  if (blob.libNodeOrder) state.libNodeOrder = JSON.parse(JSON.stringify(blob.libNodeOrder));
  // Порядок корневых категорий вкладок. Ключа нет в снимках до 2026-09-17 —
  // тогда разделы просто рисуются в заводском порядке, как и раньше.
  if (blob.libTopOrder) state.libTopOrder = JSON.parse(JSON.stringify(blob.libTopOrder));
  // Вложенность категорий. Ключа нет в снимках до 2026-09-18 — тогда все
  // категории просто корневые, как и было.
  if (blob.libTopParent) state.libTopParent = JSON.parse(JSON.stringify(blob.libTopParent));
  // Дерево категорий «Фурнитуры» — как и libExtraNodes выше: в старых
  // сохранённых снимках (до 2026-09-16) этих двух ключей нет вовсе, тогда
  // просто остаётся заводской набор категорий без своих подписей.
  if (blob.libHwCatLabels) state.libHwCatLabels = JSON.parse(JSON.stringify(blob.libHwCatLabels));
  if (blob.libHwCustomCats) state.libHwCustomCats = JSON.parse(JSON.stringify(blob.libHwCustomCats));
  // Свои категории «Материалов»/«Дверей»/«Базы модулей» (кнопка-плитка
  // «Добавить категорию») — этих ключей нет в снимках до появления фичи,
  // тогда просто нет ни одной своей категории на этих трёх вкладках, как и
  // было раньше.
  if (blob.libMatCustomCats) state.libMatCustomCats = JSON.parse(JSON.stringify(blob.libMatCustomCats));
  if (blob.libMatCatLabels) state.libMatCatLabels = JSON.parse(JSON.stringify(blob.libMatCatLabels));
  if (blob.libFacCustomCats) state.libFacCustomCats = JSON.parse(JSON.stringify(blob.libFacCustomCats));
  if (blob.libFacCatLabels) state.libFacCatLabels = JSON.parse(JSON.stringify(blob.libFacCatLabels));
  if (blob.libModCustomGroups) state.libModCustomGroups = JSON.parse(JSON.stringify(blob.libModCustomGroups));
  // Дерево «Базы модулей» — этих ключей нет в снимках до появления фичи,
  // тогда просто нет ни одного переопределённого/скопированного размещения,
  // все карточки лежат в своих родных группах PRESETS.
  if (blob.libModOverrides) state.libModOverrides = JSON.parse(JSON.stringify(blob.libModOverrides));
  if (blob.libModPlacements) state.libModPlacements = JSON.parse(JSON.stringify(blob.libModPlacements));
  // Цены алюминиевых фасадов — ключей нет в снимках до v311, тогда
  // остаются заводские значения catalog.js.
  restoreAluCatalogFrom(blob);
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
    decorCode: state.decorCode, facadeDecorCode: state.facadeDecorCode, facadeMatCode: state.facadeMatCode,
    backCode: state.backCode,
    jointType: state.jointType, worktopDepth: state.worktopDepth,
    countertopCornerJoint: state.countertopCornerJoint,
    grainGroups: state.grainGroups,
    hangerSystem: state.hangerSystem,
    // Ручная разметка чертежа (src/markup.js) — в истории отмены вместе с
    // модулями: Ctrl+Z после удаления модуля возвращает и его размеры, а
    // добавление/удаление размера отменяется как любая правка. В state она
    // НЕ живёт (applySnapshot/restoreProjectData отдают её в markup.js).
    markup: markupApi ? markupApi.getData() : [],
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
  const mk = o.markup;
  delete o.markup;                         // не поле state — см. snapshot()
  // Шаг отмены, в котором менялась ТОЛЬКО ручная разметка (модули и прочее
  // состояние те же), не должен закрывать редактор детали и снимать
  // изоляцию — иначе Ctrl+Z по размеру в редакторе выкидывал бы из окна.
  const cur = JSON.parse(snapshot());
  delete cur.markup;
  const markupOnly = JSON.stringify(cur) === JSON.stringify(o);
  Object.keys(o).forEach((k) => { state[k] = o[k]; });
  if (markupApi) markupApi.setData(Array.isArray(mk) ? mk : []);
  // Снимок без этого поля (старый) не должен оставлять группы от другого проекта.
  if (!o.grainGroups) state.grainGroups = {};
  // Снимок/проект до выбора навеса (до v315) — навес по умолчанию.
  if (!o.hangerSystem) state.hangerSystem = window.Modul3D.catalog.DEFAULT_HANGER_SYSTEM;
  migrateFacadeMatCode(o);
  // state.modules целиком заменён — режим изоляции (по имени модуля) и
  // выбор детали внутри него могли устареть, снимаем (кроме шага, где
  // менялась только разметка, см. markupOnly выше).
  if (!markupOnly) exitIsolation();
  history.lock = true;
  try { renderParamsPanel(); recompute(); } finally { history.lock = false; }
  updateHistoryButtons();
  if (markupOnly) refreshPartEditorOverlay();
  syncMarkupUI();
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

// Разметка для файла/автосохранения: без «сирот» — размеров, чей модуль
// (moduleUid любой из двух точек) уже удалён из проекта. Чистим ТОЛЬКО здесь,
// а не при пересчёте: в памяти и в истории отмены они нужны, чтобы Ctrl+Z
// после удаления модуля вернул и его размеры.
function markupForFile() {
  if (!markupApi) return [];
  const uids = new Set(state.modules.map((m) => m && m.uid).filter(Boolean));
  return markupApi.getData().filter((d) => d && d.a && d.b
    && uids.has(d.a.moduleUid) && uids.has(d.b.moduleUid));
}

function serializeProject() {
  const st = JSON.parse(snapshot());
  delete st.markup;                        // в файле разметка лежит отдельным полем
  return {
    app: 'basis-mvp',
    fileVersion: PROJECT_FILE_VERSION,
    appVersion: APP_VERSION,
    savedAt: new Date().toISOString(),
    state: st,
    // Ручная разметка чертежа (src/markup.js) — рядом со state, а не внутри:
    // это не параметр изделия, а пометки пользователя на чертеже. Точки
    // ссылаются на «uid модуля + ключ детали» (engine.js: part.moduleUid/
    // part.anchorKey); размер, чьей детали больше нет, просто не рисуется.
    markup: markupForFile(),
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
  // Нет проектного кода в файле — оставляем «авто» (null), а не DECORS[0]:
  // см. effectiveDrawerDecorCode (кухня и Quadro V6 — 0110 SM, иначе как корпус).
  const fallbackDecor = legacy.drawerDecorCode || null;
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

// Старый проект/снимок без «Материала фасада» (до 2026-09-26): там декор
// ЛДСП-фасадов по умолчанию брался из «Видимой боковины» (facadeDecorCode),
// если это ЛДСП, иначе — из корпуса (engine.ldspFacadeDefault). Ставим то же
// самое, чтобы старый проект выглядел как раньше. src — сохранённый state.
function migrateFacadeMatCode(src) {
  if (!src || src.facadeMatCode) return;
  const engine = window.Modul3D.engine;
  const fd = src.facadeDecorCode ? findAnyMaterialByCode(src.facadeDecorCode) : null;
  // То же правило, что у ядра: ЛДСП-фасадом не режутся только МДФ-панели и
  // стекло (facadeMaterialKind) — любой другой лист, в т.ч. без категории, годится.
  const kind = fd && engine && typeof engine.facadeMaterialKind === 'function'
    ? engine.facadeMaterialKind(fd) : null;
  const usable = !!fd && kind !== 'mdf' && kind !== 'glass';
  state.facadeMatCode = usable ? fd.code : (src.decorCode || state.decorCode);
}

// Применяет сохранённое состояние проекта (из файла или автосохранения).
// В отличие от applySnapshot() (только для истории отмены), терпима к
// неполным/старым файлам: недостающие поля остаются как в текущем состоянии,
// а не обнуляются.
function restoreProjectData(data) {
  if (!data || typeof data !== 'object' || !data.state || !Array.isArray(data.state.modules)) {
    throw new Error('Файл не похож на проект «Modul3D» — нет списка модулей.');
  }
  Object.keys(data.state).forEach((k) => { if (k !== 'markup') state[k] = data.state[k]; });
  // Проект из файла до появления «Направления текстуры» — все группы «Авто»,
  // а не то, что было выставлено в предыдущем открытом проекте.
  if (!data.state.grainGroups) state.grainGroups = {};
  // Проект до выбора навеса — навес по умолчанию, а не из прошлого проекта.
  if (!data.state.hangerSystem) state.hangerSystem = window.Modul3D.catalog.DEFAULT_HANGER_SYSTEM;
  migrateFacadeMatCode(data.state);
  migrateDrawerFieldsToSections(data);
  // Ручная разметка чертежа — до recompute(), чтобы чертёж сразу собрался с
  // ней. Старый файл без поля markup — просто пустая разметка (а не размеры,
  // оставшиеся от предыдущего открытого проекта). Битые данные разметки не
  // должны мешать открыть сам проект — setData терпим к мусору, но на всякий
  // случай и здесь не даём ей уронить загрузку. Режим разметки выключаем:
  // открыт другой проект.
  if (markupApi) {
    try {
      markupApi.setActive(false);
      markupApi.setData(Array.isArray(data.markup) ? data.markup : []);
    } catch (err) {
      console.warn('Markup restore failed:', err);
      try { markupApi.setData([]); } catch (e2) { /* ok */ }
    }
  }
  // Открыт другой проект (или восстановлено автосохранение) — модули заменены
  // целиком, старая изоляция/выбор детали больше не имеют смысла.
  exitIsolation();
  history.lock = true;
  try { renderParamsPanel(); recompute(); } finally { history.lock = false; }
  // Загруженный проект — новая точка отсчёта истории отмены.
  history.past = [snapshot()];
  history.future = [];
  updateHistoryButtons();
  syncMarkupUI();
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
// У навесного модуля «до пола» нет (он не стоит на полу), текущее значение
// floor показываем как «сбоку дна» — так его читает и движок (normalizeSides).
function sideOptions(cur, wallHung) {
  const list = wallHung ? SIDE_VARIANTS.filter(x => x[0] !== 'floor') : SIDE_VARIANTS;
  const fallback = wallHung ? 'besideBottom' : 'floor';
  const v = list.some(x => x[0] === cur) ? cur : fallback;
  return list
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
  // Вставленный модуль — всегда НОВЫЙ: клон из пресета/библиотеки/комплекта
  // мог принести uid эталона (или другого модуля проекта), см. newModuleUid.
  m.uid = newModuleUid();
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

// Пакетная вставка НЕСКОЛЬКИХ модулей разом — та же логика, что у
// insertModule() выше (столешница по умолчанию, нумерация, довязка соседних
// зон), но recompute() вызывается один раз на весь набор, а не на каждый
// модуль отдельно. Нужна карточке-комплекту «Базы модулей» (см.
// addLibModCardToProject/libModSaveProjectAsKit) — порядок элементов `mods`
// сохраняется как есть: раскладка вдоль ряда в engine.js (buildModel) идёт
// строго по порядку массива state.modules, поэтому взаимное расположение
// модулей комплекта (с их поворотами/угловыми флагами из params) само
// воспроизводится по факту вставки в этом порядке — отдельных абсолютных
// координат для этого не нужно.
function insertModulesBatch(mods) {
  if (!mods || !mods.length) return;
  exitIsolation();
  mods.forEach((m) => {
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
  });
  mods.forEach((m) => { m.uid = newModuleUid(); });   // см. insertModule
  const at = Math.min(state.activeModule + 1, state.modules.length);
  state.modules.splice(at, 0, ...mods);
  renumberModules();
  state.activeModule = at;
  state.selected = state.modules[at].name;
  state.panelView = 'module';
  renderParamsPanel();
  recompute();
  let needsExtra = false;
  mods.forEach((_, i) => { if (resyncZoneHeightsForNewNeighbor(at + i)) needsExtra = true; });
  if (needsExtra) recompute();
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

// ---------------------------------------------------------------------------
// «База модулей» как дерево (2026-09-21) — та же архитектура, что у вкладок
// «Материалы»/«Фурнитура» (см. большой комментарий над libTopEntries):
// топ-уровень 'mod:<groupKey>' — группа PRESETS (заводская, groupKey — её
// id) ИЛИ своя категория (state.libModCustomGroups, groupKey — её key).
// «Позиция» дерева — не сама позиция каталога, а РАЗМЕЩЕНИЕ карточки
// пресета (group 'modplace') — у каждой карточки свой путь, независимый от
// исходной группы PRESETS (см. libModAllPlacements/state.libModOverrides/
// state.libModPlacements). Вся навигация по дереву (раскрытие/свёртывание,
// переименование/добавление/перенос/удаление ПОДКАТЕГОРИЙ, хлебные крошки,
// перетаскивание узлов) — общий код с материалами/фурнитурой, отдельного
// здесь почти нет: см. правки libTopEntries/libRealItemOf/libEntryTargetPath/
// libLeafTableHtmlAny/libTabTopCodesRaw/libTabOfTopCode/libTopCategoryDef/
// libTreeRowHtml/libNodeHtml/libTopCategoryHtml/libRenameNode/libDeleteNode/
// libRowMoveTargets/libMoveEntry дальше по файлу.
//
// В отличие от материалов/фурнитуры здесь НЕТ инварианта «есть подкатегории
// → своих позиций нет» (см. NO_BRAND_SUBCAT): карточка пресета по умолчанию
// лежит прямо в корне своей группы, и группа/подкатегория может ОДНОВРЕМЕННО
// иметь и вложенные категории, и свои карточки — как папка и файлы рядом в
// проводнике (см. правки libNodeHtml/libTopCategoryHtml/libEntryTargetPath).
// ---------------------------------------------------------------------------

function libModPresetId(groupId, itemId) { return groupId + '::' + itemId; }

// { group, item } исходного пресета по presetId, или null (пресет удалили
// из presets.js — отклонение/копия в state тогда просто не рисуется).
function libModPresetOf(presetId) {
  const parts = String(presetId).split('::');
  const g = PRESETS.find((x) => x.id === parts[0]);
  const it = g && g.items.find((x) => x.id === parts[1]);
  return it ? { group: g, item: it } : null;
}

function libModTopIsBuiltin(key) { return PRESETS.some((g) => g.id === key); }
function libModGroupExists(key) {
  return libModTopIsBuiltin(key) || (state.libModCustomGroups || []).some((g) => g.key === key);
}
// Подпись верхнеуровневой категории «Базы модулей» — имя группы PRESETS или
// своей категории (state.libModCustomGroups). В отличие от «Фурнитуры» у
// заводской группы нет отдельной «своей подписи» — переименовать её нельзя
// (см. libTreeRowHtml/libRenameNode), поэтому и хранить для неё нечего.
function libModTopLabel(key) {
  const preset = PRESETS.find((g) => g.id === key);
  if (preset) return preset.name;
  const custom = (state.libModCustomGroups || []).find((g) => g.key === key);
  return custom ? custom.name : key;
}

// Все карточки «Базы модулей» — и дефолтные (одна на каждый пресет, пока
// пользователь её не тронул), и независимые копии (значок «+», см.
// libModCopyCard). Дефолтная карточка материализуется лениво: если
// state.libModOverrides[presetId] нет, она просто лежит в корне своей
// родной группы под родным именем пресета.
function libModAllPlacements() {
  const out = [];
  PRESETS.forEach((g) => {
    g.items.forEach((it) => {
      const presetId = libModPresetId(g.id, it.id);
      const ov = state.libModOverrides[presetId];
      if (ov && ov.removed) return;   // убрана значком × — сам пресет не трогаем
      out.push({
        id: 'default:' + presetId,
        presetId,
        group: (ov && ov.group) || g.id,
        categoryPath: (ov && Array.isArray(ov.categoryPath)) ? ov.categoryPath.slice() : [],
        name: (ov && ov.name) || null,
      });
    });
  });
  (state.libModPlacements || []).forEach((p) => {
    out.push({
      id: p.id, presetId: p.presetId, group: p.group,
      categoryPath: (p.categoryPath || []).slice(), name: p.name || null,
      // Полностью своя карточка («Сохранить»/«Сохранить как…», см. большой
      // комментарий у state.libModPlacements выше) — params одиночного
      // модуля ИЛИ kit комплекта вместо ссылки на пресет. У карточек-ссылок
      // (presetId задан) оба поля просто undefined — безвредно для всего
      // остального кода этой секции, который их не читает.
      params: p.params, kit: p.kit,
    });
  });
  return out;
}
function libModPlacementById(id) {
  return libModAllPlacements().find((p) => p.id === id) || null;
}

// Записи ОДНОЙ верхнеуровневой категории (topCode 'mod:<groupKey>') — тот же
// приём, что и libHardwareTopEntries: карточки фильтруются по тому, в какой
// группе они сейчас лежат. item.name/item.note — РЕЗОЛВЛЕННЫЕ (переопределение
// карточки, если есть, иначе имя/примечание самого пресета) — весь остальной
// generic-код дерева (заголовки меню переноса и т.п.) читает it.name не зная
// о пресетах вовсе, так же, как читает его у декоров/фурнитуры.
function libModTopEntries(groupKey) {
  return libModAllPlacements()
    .filter((p) => p.group === groupKey)
    .map((p) => {
      const ref = libModPresetOf(p.presetId);
      const name = p.name || (ref ? ref.item.name : '') || '';
      const note = ref ? ref.item.note : '';
      return { group: 'modplace', item: Object.assign({ key: p.id }, p, { name, note }) };
    });
}

// «Живой» изменяемый объект карточки по её id — материализует запись
// отклонения для дефолтной карточки встроенного пресета при первом же
// изменении (переименование/перенос/удаление), тем же приёмом, что и
// остальные точки правки дерева каталога (см. libSetEntryPath/libRealItemOf
// ниже: категория пишется в it.categoryPath, это и есть тот самый объект).
function libModRealPlacement(id) {
  if (String(id).indexOf('default:') === 0) {
    const presetId = id.slice('default:'.length);
    if (!state.libModOverrides[presetId]) state.libModOverrides[presetId] = {};
    return state.libModOverrides[presetId];
  }
  return (state.libModPlacements || []).find((p) => p.id === id) || null;
}

// ---------------------------------------------------------------------------
// Миниатюры карточек — рендерятся СИНХРОННО только для видимых (раскрытых)
// узлов дерева, а не для всех пресетов сразу, и кэшируются в _thumbCache по
// ключу «пресет + декор/толщины, от которых реально зависит картинка» — тот
// же приём, что и раньше в libraryGridBlock (перенесено сюда без изменения
// логики самого рендера, см. комментарии внутри).
// ---------------------------------------------------------------------------
const _thumbCache = new Map();

function libModThumbBase() {
  return {
    bodyThickness: state.bodyThickness,
    backThickness: state.backThickness,
    facadeThickness: state.facadeThickness,
    // Запасной вариант (DECORS[0]/BACK_MATERIALS[0]) — на случай, если код
    // декора из сохранённого проекта/автосохранения устарел (каталог правят
    // отдельно от app.js, коды могут переименовать или убрать — так уже было
    // 2026-09-03). Без отката buildModel() падает на undefined.code и рвёт
    // всю инициализацию приложения (пустая библиотека, неработающие кнопки).
    decor: DECORS.find((d) => d.code === state.decorCode) || defaultDecorObj(),
    // «Видимая боковина» может ссылаться и на МДФ-панель из FACADE_MATERIALS.
    facadeDecor: findAnyMaterialByCode(state.facadeDecorCode)
      || DECORS.find((d) => d.code === state.decorCode) || defaultDecorObj(),
    // «Материал фасада» — декор ЛДСП-фасадов по умолчанию.
    facadeMat: findAnyMaterialByCode(state.facadeMatCode)
      || DECORS.find((d) => d.code === state.decorCode) || defaultDecorObj(),
    backMaterial: BACK_MATERIALS.find((d) => d.code === state.backCode) || BACK_MATERIALS[0],
    worktopDepth: state.worktopDepth,
    jointType: state.jointType,
  };
}

// Кухонные пресеты на миниатюре красим в БЕЛЫЙ корпус независимо от decor
// ТЕКУЩЕГО проекта (по умолчанию у нового проекта это дуб, не белый) — так
// попросил владелец 2026-09-21, только для превью категории «Кухонный
// модуль», «Шкаф»/«Тумба» по-прежнему красятся в decor проекта. Ищем декор/
// столешницу по коду через find(), а не хардкодим объект — код когда-нибудь
// могут переименовать/убрать в каталоге (см. thumbBase.decor выше).
function libModThumbDataUrl(groupId, it) {
  const thumbBase = libModThumbBase();
  // Фасад/видимая боковина/цоколь/корпус на карточках Библиотеки — ВСЕГДА в
  // дереве (декор проекта по умолчанию, H1145 ST10 Дуб Бардолино натуральный),
  // а не из thumbBase.decor/facadeDecor/facadeMat (state.decorCode/
  // facadeDecorCode/facadeMatCode ТЕКУЩЕГО открытого проекта) — иначе карточки
  // «плавают» цветом от проекта к проекту (владелец, 2026-09-28). Цоколь берёт
  // материал из того же facadeDecor (см. engine.js visibleSideMat()), поэтому
  // одной замены хватает и на него. Кухня поверх этого корпуса красится в
  // белый через carcassDecor модуля ниже (kitchenThumbDecor побеждает
  // proj.decor в engine.js) — эта ветка её не касается.
  const thumbWoodDecor = defaultDecorObj();
  const thumbKeyBase = [
    thumbBase.bodyThickness, thumbBase.backThickness, thumbBase.facadeThickness,
    thumbWoodDecor.code, thumbWoodDecor.code, thumbWoodDecor.code, thumbBase.backMaterial.code,
    thumbBase.worktopDepth, thumbBase.jointType,
  ].join('|');
  const cacheKey = `${libModPresetId(groupId, it.id)}|${thumbKeyBase}`;
  if (_thumbCache.has(cacheKey)) return _thumbCache.get(cacheKey);
  let dataUrl = null;
  try {
    const m = it.make();
    const isKitchen = (m.family || 'custom') === 'kitchen';
    const kitchenThumbDecor = isKitchen ? (DECORS.find((d) => d.code === 'H3450ST22') || null) : null;
    // Столешница нижнего яруса кухни на миниатюре — тоже только для наглядности
    // превью (owner: «почему модули кухни без столешницы»). Задаётся ОТДЕЛЬНЫМ
    // полем модуля p.countertop (см. engine.js countertopMat()/ctEnabled) —
    // proj.worktopDepth сам по себе столешницу не строит.
    const kitchenThumbCountertopCode = isKitchen && window.Modul3D.catalog.findCountertopMaterialByCode('CTOP-LDSP38-1063SQ')
      ? 'CTOP-LDSP38-1063SQ' : null;
    const project = Object.assign({}, thumbBase, {
      // Корпус + «видимая боковина» (и цоколь, который берёт материал отсюда
      // же) + «Материал фасада» — фиксированное дерево на превью, см.
      // thumbWoodDecor выше. Для ВСЕХ категорий, не только кухни (кухню поверх
      // перекрашивает carcassDecor модуля ниже).
      decor: thumbWoodDecor,
      facadeDecor: thumbWoodDecor,
      facadeMat: thumbWoodDecor,
      modules: [{
        name: m.name, width: m.width, height: m.height, depth: m.depth,
        rotation: m.rotation || 0, corner: !!m.corner, family: m.family || 'custom',
        topType: m.topType, railWidth: m.railWidth, noBack: !!m.noBack,
        backMount: m.backMount, backGroove: m.backGroove, wallHung: m.wallHung,
        // Отметка верха навесного модуля от пола (engine.js, mountBottom).
        mountTop: m.mountTop,
        blindPanel: !!m.blindPanel, blindStrip: m.blindStrip,
        leftSide: m.leftSide, rightSide: m.rightSide,
        base: m.baseType === 'plinth'
          ? { type: 'plinth', plinthHeight: m.plinthHeight }
          : { type: m.baseType, legHeight: m.legHeight },
        legType: m.legType || 'metal',
        sections: engineSectionsOf(m),
        // Переопределение декора корпуса ТОЛЬКО этого модуля превью —
        // побеждает proj.decor в engine.js (decor: m.carcassDecor || proj.decor),
        // сам decor проекта (state.decorCode) нигде не трогается.
        carcassDecor: kitchenThumbDecor || undefined,
        // Столешница — не у всего tier==='lower' (пенал tall600 тоже
        // «нижний», потому что стоит на полу, но он во всю высоту до потолка
        // и столешницы сверху не имеет — см. presets.js). Точный сигнал —
        // topType модели: 'rails'/'railsEdge' — это ИМЕННО рельсовый верх
        // нижней тумбы под столешницу (см. engine.js skipTopPanel/topType).
        countertop: (isKitchen && (m.topType === 'rails' || m.topType === 'railsEdge') && kitchenThumbCountertopCode)
          ? { enabled: true, decorCode: kitchenThumbCountertopCode } : undefined,
      }],
    });
    const model = buildModel(project);
    dataUrl = window.Modul3D.viewer.renderThumbnail(model, { size: 200, realistic: true });
  } catch (err) {
    dataUrl = null;
  }
  // Та же самоочистка, что и у _partGeoCache в viewer.js (см. там же, порог
  // 300) — без верхней границы кэш рос бы неограниченно за сеанс, например
  // при посимвольном вводе толщины плиты прямо в открытой панели (каждое
  // нажатие клавиши — новый thumbKeyBase, значит новые ключи).
  if (_thumbCache.size > 300) _thumbCache.clear();
  _thumbCache.set(cacheKey, dataUrl);
  return dataUrl;
}

// Модуль проекта (объект state.modules[i]) → «модуль project.modules» для
// buildModel() — тот же набор полей, что recompute() собирает для реальной
// сцены (см. этот же список там) и что libModThumbDataUrl выше — своя
// строго-заводская веха для превью пресетов. Общий helper для ДВУХ мест,
// которым нужен временный, ни на что не влияющий предпросмотр модулей,
// которых ещё нет в state.modules: превью карточки-«Сохранить» ниже
// (libModCustomThumbDataUrl) и подсчёт относительных x/z комплекта
// (libModSaveProjectAsKit). Сам живой пересчёт сцены (recompute()) эту
// функцию не использует и не обязан — совпадение полей поддерживается
// вручную, как и раньше между recompute()/libModThumbDataUrl.
function libModProjectModuleOf(m) {
  return {
    name: m.name, width: m.width, height: m.height, depth: m.depth,
    rotation: m.rotation || 0, corner: !!m.corner, family: m.family || 'custom',
    topType: m.topType, railWidth: m.railWidth, noBack: !!m.noBack,
    backMount: m.backMount, backGroove: m.backGroove, wallHung: m.wallHung,
    // Отметка верха навесного модуля от пола (engine.js, mountBottom).
    mountTop: m.mountTop,
    blindPanel: !!m.blindPanel, blindStrip: m.blindStrip,
    leftSide: m.leftSide, rightSide: m.rightSide,
    base: m.baseType === 'plinth'
      ? { type: 'plinth', plinthHeight: m.plinthHeight }
      : { type: m.baseType, legHeight: m.legHeight },
    legType: m.legType || 'metal',
    sections: engineSectionsOf(m),
    partOverrides: m.partOverrides || {},
    countertop: m.countertop,
  };
}

// Превью карточки БЕЗ presetId — самостоятельный модуль (p.params) или
// комплект (p.kit), сохранённые «Сохранить»/«Сохранить как…»/«Добавить
// модуль» (см. libModSaveModule/libModSaveModuleAs/libModSaveProjectAsKit).
// Тот же приём рендера, что и у libModThumbDataUrl (временный project →
// buildModel() → renderThumbnail()), но модули берутся прямо из карточки, а
// не из it.make() — карточка сама себе «пресет». В кэш добавлен JSON самих
// params/kit: у заводских пресетов данные неизменны, поэтому ключ там —
// просто id пресета, а здесь параметры МЕНЯЮТСЯ на том же id карточки
// (повторное «Сохранить» перезаписывает params) — без этого превью осталось
// бы от предыдущей версии.
function libModCustomThumbDataUrl(p) {
  const thumbBase = libModThumbBase();
  // Замороженный на момент «Сохранить» набор материалов (см. большой
  // комментарий у state.libModPlacements/libModMaterialSnapshotOf) — та же
  // логика поиска по коду с откатом, что и в libModThumbBase (коды каталога
  // могут быть переименованы/удалены между сохранением и открытием
  // Библиотеки). У карточек без снимка (сохранены до 2026-09-28) thumbMats —
  // это просто thumbBase, поведение не меняется.
  const snap = p.materialSnapshot;
  const thumbMats = snap ? {
    decor: DECORS.find((d) => d.code === snap.decorCode) || defaultDecorObj(),
    facadeDecor: findAnyMaterialByCode(snap.facadeDecorCode)
      || DECORS.find((d) => d.code === snap.decorCode) || defaultDecorObj(),
    facadeMat: findAnyMaterialByCode(snap.facadeMatCode)
      || DECORS.find((d) => d.code === snap.decorCode) || defaultDecorObj(),
    backMaterial: BACK_MATERIALS.find((d) => d.code === snap.backCode) || BACK_MATERIALS[0],
  } : thumbBase;
  const thumbKeyBase = [
    thumbBase.bodyThickness, thumbBase.backThickness, thumbBase.facadeThickness,
    thumbMats.decor.code, thumbMats.facadeDecor.code, thumbMats.facadeMat.code, thumbMats.backMaterial.code,
    thumbBase.worktopDepth, thumbBase.jointType,
  ].join('|');
  const dataKey = JSON.stringify((p.kit && p.kit.map((k) => k.params)) || p.params || null);
  const cacheKey = `custom:${p.id}|${thumbKeyBase}|${dataKey}`;
  if (_thumbCache.has(cacheKey)) return _thumbCache.get(cacheKey);
  let dataUrl = null;
  try {
    const srcMods = Array.isArray(p.kit) && p.kit.length
      ? p.kit.map((k) => k.params)
      : (p.params ? [p.params] : []);
    const project = Object.assign({}, thumbBase, thumbMats, {
      // Способ соединения столешниц на угловом стыке — тот же проектный
      // параметр, что и в recompute()/libModSaveProjectAsKit (не влияет на
      // геометрию joinCountertopSeams, только на подбор крепежа, но для
      // полноты проекта должен быть тем же, что видит пользователь).
      countertopCornerJoint: state.countertopCornerJoint,
      modules: srcMods.map((m) => libModProjectModuleOf(m)),
    });
    const model = buildModel(project);
    dataUrl = window.Modul3D.viewer.renderThumbnail(model, { size: 200, realistic: true });
  } catch (err) {
    dataUrl = null;
  }
  if (_thumbCache.size > 300) _thumbCache.clear();
  _thumbCache.set(cacheKey, dataUrl);
  return dataUrl;
}

// Одна карточка модуля — button.lib-item, как и раньше: ЛЕВЫЙ клик добавляет
// модуль в проект (см. bindLibraryEvents), ПРАВЫЙ открывает плашку ✎+⇄×
// (см. openLibModCardMenu). data-group/data-preset — id ИСХОДНОГО пресета
// (не меняются, где бы карточка ни лежала в дереве) — по ним левый клик
// находит it.make(), а data-placement — id ЭТОГО размещения (нужен
// контекстному меню/перетаскиванию, см. libModPlacementById). У карточки без
// presetId (см. libModAllPlacements/state.libModPlacements — «Сохранить»/
// «Сохранить как…») data-group/data-preset не пишем вовсе — по их
// отсутствию левый клик (bindLibraryEvents) отличает такую карточку и берёт
// параметры из неё самой (см. addLibModCardToProject).
function libModCardHtml(p) {
  const ref = libModPresetOf(p.presetId);
  if (p.presetId && !ref) return '';   // ссылка на пресет, которого больше нет в presets.js
  const displayName = p.name || (ref ? ref.item.name : '') || '';
  // Полное примечание пресета иногда длиной за сотню символов — для
  // всплывающей подсказки (узкая колонка, перенос по словам) обрезаем его.
  // У своей карточки (без presetId) примечания нет вовсе.
  const note = ref ? ref.item.note : '';
  const noteShort = note && note.length > 70 ? note.slice(0, 68) + '…' : note;
  const tip = `${displayName}${noteShort ? ` — ${noteShort}` : ''}`;
  const dataUrl = ref ? libModThumbDataUrl(ref.group.id, ref.item) : libModCustomThumbDataUrl(p);
  return `<button type="button" class="lib-item tip tip-down" data-placement="${esc(p.key)}"
      ${ref ? `data-group="${esc(ref.group.id)}" data-preset="${esc(ref.item.id)}"` : ''} data-tip="${esc(tip)}">
      ${dataUrl ? `<img class="lib-thumb" src="${dataUrl}" alt="">` : ''}
    </button>`;
}

// Грид карточек одного узла дерева (аналог таблицы листа у материалов, см.
// libLeafTableHtml/libLeafTableHtmlAny) — вызывается и для корня группы, и
// для любой подкатегории, и в режиме фокуса на листе (см. libTopCategoryHtml).
function libModLeafGridHtml(topCode, path, entries) {
  const tiles = entries.map((e) => libModCardHtml(e.item)).join('');
  const empty = entries.length ? '' : '<div class="hint lib-grid-empty">Пока нет модулей.</div>';
  return `<div class="lib-leaf-body"><div class="lib-grid">${tiles}${empty}</div></div>`;
}

function libraryBlock() {
  const catsHtml = libTabRootCodes('modules')
    .map((code) => libTopCategoryTreeHtml('modules', code, 0))
    .join('');
  // Заголовок раздела («База модулей») здесь намеренно не рисуем — он
  // дублировал название активной вкладки .lib-tabs прямо над ним (то же на
  // «Материалах»/«Фурнитуре»/«Дверях») и съедал место на телефоне.
  return `
    <div class="lib-link-refresh-bar">
      <button type="button" class="btn" data-lib-save-project="1" title="Сохранить текущий проект в «Базу модулей»">Сохранить в базу</button>
      ${libAddCatTileHtml('modules')}
    </div>
    ${catsHtml}
    <div class="hint">Раскройте категорию и нажмите на модуль — он добавится в проект. Правая кнопка мыши на модуле — переименовать/скопировать/переместить/удалить карточку (сам пресет при этом не меняется); перетащите миниатюру на строку категории, чтобы перенести её. «Сохранить в базу» выше сохраняет текущий проект в библиотеку: один модуль — обычной карточкой, несколько — карточкой-комплектом.</div>`;
}

// ---------------------------------------------------------------------------
// Плашка ✎ + ⇄ × по правому клику на карточке модуля — тот же порядок
// значков и тот же визуальный язык (.lib-tree-ic), что у строки категории
// (см. libTreeRowHtml), но адресована ОДНОЙ карточке-размещению, а не узлу
// дерева:
//  ✎ — переименовывает подпись ИМЕННО ЭТОЙ карточки (см. libModRenameCard),
//      не сам пресет и не другие её копии;
//  + — копирует: открывает тот же пикер цели, что и ⇄ (см.
//      openLibMoveMenu/libRowMoveTargets), но создаёт НОВОЕ независимое
//      размещение того же пресета, не трогая исходную карточку (см.
//      libModCopyCard);
//  ⇄ — переносит ЭТУ карточку (переиспользует libMoveEntry — тот же код,
//      что двигает позицию материала/фурнитуры между категориями);
//  × — убирает карточку из дерева (см. libModDeleteCard) — не сам пресет:
//      уже добавленные из него модули проекта не меняются, а если это была
//      последняя карточка встроенного пресета — он просто перестаёт быть
//      виден в библиотеке (ожидаемо, presets.js не трогается).
// ---------------------------------------------------------------------------
let libModCardMenuOutsideClick = null;
let libModCardMenuEscHandler = null;
function closeLibModCardMenu() {
  const menu = document.getElementById('libModCardMenu');
  if (menu) menu.remove();
  if (libModCardMenuOutsideClick) { document.removeEventListener('click', libModCardMenuOutsideClick); libModCardMenuOutsideClick = null; }
  if (libModCardMenuEscHandler) { document.removeEventListener('keydown', libModCardMenuEscHandler); libModCardMenuEscHandler = null; }
}

function openLibModCardMenu(x, y, placementId) {
  closeLibModCardMenu();
  if (!requireLibraryEditAuth()) return;
  const menu = document.createElement('div');
  menu.id = 'libModCardMenu';
  menu.className = 'ctx-menu lib-mod-card-menu';
  menu.innerHTML = `
    <span class="lib-tree-ic" data-mc-rename="1" title="Переименовать карточку">✎</span>
    <span class="lib-tree-ic" data-mc-copy="1" title="Копировать в категорию">+</span>
    <span class="lib-tree-ic" data-mc-move="1" title="Переместить в категорию">⇄</span>
    <span class="lib-tree-ic" data-mc-del="1" title="Убрать из библиотеки">×</span>`;
  document.body.appendChild(menu);
  menu.addEventListener('click', (e) => e.stopPropagation());
  const rect = menu.getBoundingClientRect();
  const left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4));
  const top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4));
  menu.style.left = Math.round(left) + 'px';
  menu.style.top = Math.round(top) + 'px';

  const on = (sel, handler) => { const el = menu.querySelector(sel); if (el) el.addEventListener('click', handler); };
  on('[data-mc-rename]', () => { closeLibModCardMenu(); libModRenameCard(placementId); });
  on('[data-mc-copy]', (e) => libModCopyCardMenu(e.currentTarget, placementId));
  on('[data-mc-move]', (e) => libModMoveCardMenu(e.currentTarget, placementId));
  on('[data-mc-del]', () => { closeLibModCardMenu(); libModDeleteCard(placementId); });

  setTimeout(() => {
    libModCardMenuOutsideClick = (e) => { if (!menu.contains(e.target)) closeLibModCardMenu(); };
    document.addEventListener('click', libModCardMenuOutsideClick);
  }, 0);
  libModCardMenuEscHandler = (e) => { if (e.key === 'Escape') closeLibModCardMenu(); };
  document.addEventListener('keydown', libModCardMenuEscHandler);
}

// Подпись карточки — своя (переопределена значком ✎) или имя пресета.
function libModCardDisplayName(id) {
  const p = libModPlacementById(id);
  if (!p) return '';
  const ref = libModPresetOf(p.presetId);
  return p.name || (ref ? ref.item.name : '') || '';
}

function libModRenameCard(id) {
  if (!requireLibraryEditAuth()) return;
  const cur = libModCardDisplayName(id);
  const raw = window.prompt('Название карточки в библиотеке:', cur);
  if (raw == null) return;
  const name = String(raw).trim();
  const real = libModRealPlacement(id);
  if (!real) return;
  const p = libModPlacementById(id);
  const ref = p && libModPresetOf(p.presetId);
  const presetName = ref ? ref.item.name : '';
  // Пустой ввод или совпадение с исходным именем пресета — возврат к
  // заводскому названию (снимаем переопределение), а не пустая подпись.
  real.name = (!name || name === presetName) ? null : name;
  scheduleCatalogSave();
  renderLibraryPanel();
}

// ⇄/+ карточки открывают ОДИН и тот же пикер целей, что и у позиций
// материалов/фурнитуры (см. libRowMoveTargets/openLibMoveMenu) — btnEl тут
// сам значок ✎/+/⇄/× плашки, под которым и встаёт список. Координаты
// значка читаем ДО closeLibModCardMenu(): она удаляет плашку (и сам значок)
// из DOM, а getBoundingClientRect() отсоединённого узла вернул бы нули —
// меню открылось бы в левом верхнем углу экрана вместо места клика.
function libModCopyCardMenu(btnEl, id) {
  const rect = btnEl.getBoundingClientRect();
  closeLibModCardMenu();
  const p = libModPlacementById(id);
  if (!p) return;
  const topCode = 'mod:' + p.group;
  const entry = { group: 'modplace', item: Object.assign({ key: p.id }, p) };
  const anchor = { getBoundingClientRect: () => rect };
  openLibMoveMenu(anchor, {
    titleHtml: `Копировать «${esc(libModCardDisplayName(id))}» в:`,
    targets: libRowMoveTargets(topCode, entry),
    rootLabel: 'В корень категории',
    labelOf: (target) => libRowMoveTargetLabel(topCode, target, 'В корень категории'),
    onPick: (target) => libModCopyCard(id, target),
  });
}
function libModMoveCardMenu(btnEl, id) {
  const rect = btnEl.getBoundingClientRect();
  closeLibModCardMenu();
  const p = libModPlacementById(id);
  if (!p) return;
  const topCode = 'mod:' + p.group;
  const entry = { group: 'modplace', item: Object.assign({ key: p.id }, p) };
  const anchor = { getBoundingClientRect: () => rect };
  openLibMoveMenu(anchor, {
    titleHtml: `Переместить «${esc(libModCardDisplayName(id))}» в:`,
    targets: libRowMoveTargets(topCode, entry),
    rootLabel: 'В корень категории',
    labelOf: (target) => libRowMoveTargetLabel(topCode, target, 'В корень категории'),
    onPick: (target) => libMoveEntry(topCode, 'modplace', p.id, target),
  });
}

// + — создаёт НЕЗАВИСИМУЮ копию карточки (свой id, та же ссылка на пресет
// ИЛИ те же params/kit, см. state.libModPlacements) в выбранной пользователем
// категории. Исходная карточка не трогается — именно поэтому копия ВСЕГДА
// уходит в libModPlacements, даже если id исходной карточки был 'default:…'.
function libModCopyCard(id, target) {
  if (!requireLibraryEditAuth()) return;
  const p = libModPlacementById(id);
  if (!p) return;
  const copy = {
    id: libModNewPlacementId(),
    group: target && target.top ? String(target.top).slice(4) : p.group,
    categoryPath: ((target && target.path) || []).slice(),
    // presetId-карточка: null падает на имя пресета (см. libModCardHtml/
    // libModCardDisplayName). У params/kit-карточки такого источника имени
    // нет — копируем название как есть, иначе копия осталась бы безымянной.
    name: p.presetId ? null : (p.name || null),
  };
  // Ссылка на пресет ИЛИ свои параметры (см. большой комментарий у
  // state.libModPlacements) — у карточки бывает ровно одно из трёх, копия
  // переносит то же самое поле, не подмешивая остальные.
  if (p.presetId) copy.presetId = p.presetId;
  else if (Array.isArray(p.kit)) copy.kit = JSON.parse(JSON.stringify(p.kit));
  else if (p.params) copy.params = JSON.parse(JSON.stringify(p.params));
  // Замороженный снимок материалов (см. libModMaterialSnapshotOf) — копия
  // своей карточки должна выглядеть так же, как оригинал, а не «уехать» в
  // live-проектное поведение из-за отсутствия снимка (владелец, 2026-09-28).
  // У presetId-карточки снимка не бывает — копия и так свежая заводская.
  if (p.materialSnapshot) copy.materialSnapshot = Object.assign({}, p.materialSnapshot);
  state.libModPlacements.push(copy);
  scheduleCatalogSave();
  renderLibraryPanel();
}

// × — убирает РАЗМЕЩЕНИЕ карточки из дерева, не сам пресет (см. большой
// комментарий над openLibModCardMenu).
function libModDeleteCard(id) {
  if (!requireLibraryEditAuth()) return;
  if (!window.confirm('Убрать эту карточку из библиотеки? Сам модуль и уже добавленные из него в проект копии не пострадают.')) return;
  if (String(id).indexOf('default:') === 0) {
    const presetId = id.slice('default:'.length);
    if (!state.libModOverrides[presetId]) state.libModOverrides[presetId] = {};
    state.libModOverrides[presetId].removed = true;
  } else {
    state.libModPlacements = (state.libModPlacements || []).filter((p) => p.id !== id);
  }
  scheduleCatalogSave();
  renderLibraryPanel();
}

// ---------------------------------------------------------------------------
// «Сохранить»/«Сохранить как…» модуля в «Базу модулей» (контекстное меню
// вкладки модуля, см. showModuleMenu) и «Добавить модуль» — сохранение ВСЕГО
// проекта одной карточкой/комплектом (кнопка в шапке libraryBlock). Все три
// пишут в state.libModPlacements карточки БЕЗ presetId — см. большой
// комментарий над этим полем в начале файла.
// ---------------------------------------------------------------------------

// Тот же генератор id, что у copy/move карточек выше (libModCopyCard) — общий
// формат для ЛЮБОГО нового элемента state.libModPlacements, независимо от
// того, что в нём лежит (ссылка на пресет, params одного модуля или kit).
function libModNewPlacementId() {
  return 'modplace-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

// Снимок материалов проекта НА МОМЕНТ сохранения карточки — только 4 кода
// декора (корпус/видимая боковина/материал фасада/задняя стенка), НЕ толщины
// и НЕ worktopDepth/jointType/countertopCornerJoint: те по-прежнему берутся
// из ТЕКУЩЕГО проекта при каждом рендере превью, замораживается именно вид
// «из чего сделан модуль», а не его геометрические настройки (владелец,
// 2026-09-28). Пишется рядом с params/kit на объект плейсмента
// (state.libModPlacements) — читает libModCustomThumbDataUrl; у карточек,
// сохранённых ДО этого изменения, поля нет, и превью по-прежнему берёт
// материалы из текущего проекта (thumbBase), без миграции задним числом.
function libModMaterialSnapshotOf() {
  return {
    decorCode: state.decorCode,
    facadeDecorCode: state.facadeDecorCode,
    facadeMatCode: state.facadeMatCode,
    backCode: state.backCode,
  };
}

// Параметры модуля для сохранения в карточку — снимает служебные UI-поля,
// которых не должно быть в самостоятельной карточке библиотеки: libOrigin —
// ссылка НА карточку (имеет смысл только внутри state.modules текущего
// проекта), activeSection — какая вкладка секции сейчас раскрыта в панели.
// Остальное (все декоры/фурнитура/сечения секций) сохраняется как есть —
// именно эта форма и есть params/kit[].params в state.libModPlacements.
function libModCloneModuleParams(mod) {
  const clone = JSON.parse(JSON.stringify(mod));
  delete clone.libOrigin;
  delete clone.activeSection;
  return clone;
}

// Категория, СЕЙЧАС выделенная (сфокусирован лист) в дереве «Базы модулей» —
// та, что пользователь только что раскрыл кликом по строке листа (см.
// state.libActiveLeaf/libTopCategoryHtml: в этом режиме дерево категории
// прячется, а на экране только хлебные крошки + грид карточек этого листа —
// с точки зрения пользователя это и есть «открытая» категория). Новая
// карточка при первом сохранении модуля/комплекта должна уходить именно сюда
// — раньше это выделение игнорировалось (см. libModOriginTarget/
// libModDefaultTarget ниже).
// Перебираем ВСЕ top-коды вкладки 'modules' через libTabTopCodes — не только
// корневые группы, но и свои категории, вложенные в другие через
// state.libTopParent.modules (см. libTabChildCodes/libTopParentOf): активный
// лист может быть у любого из них, а не только у корня. Активных листов
// одновременно может оказаться несколько (state.libActiveLeaf — независимый
// ключ на КАЖДЫЙ topCode) — приоритет отдаём тому, с которым пользователь
// работал последним (state.libLastFocusedTop['modules'] — тот же сигнал
// «последний тронутый раздел», что и у libPlaceNewTopAfterFocused). Ключ
// вкладки берём ФИКСИРОВАННЫМ, а не state.libraryTab — эта функция вызывается
// и из контекстного меню модуля в 3D-сцене (см. showModuleMenu), где текущая
// открытая вкладка Библиотеки может быть вообще не «Базой модулей» (баг
// нашёл code-reviewer 2026-09-22: state.libLastFocusedTop[state.libraryTab]
// на вкладке «Материалы»/«Фурнитура» искал топ-код среди activeCodes (все
// вида 'mod:...') и не находил, тай-брейк молча падал на activeCodes[0]).
// null, если ни одна категория сейчас не сфокусирована.
function libModActiveCategoryTarget() {
  const activeCodes = libTabTopCodes('modules').filter((c) => state.libActiveLeaf[c]);
  if (!activeCodes.length) return null;
  const lastTop = state.libLastFocusedTop.modules;
  const code = activeCodes.indexOf(lastTop) >= 0 ? lastTop : activeCodes[0];
  const path = String(state.libActiveLeaf[code]).split('::');
  return { group: code.slice(4), categoryPath: path };
}

// Где сейчас лежит карточка-происхождение модуля (mod.libOrigin) — группа и
// путь категории, куда ляжет ЗАМЕНЯЮЩАЯ её карточка (см. libModSaveModule)
// или новая карточка «Сохранить как…», унаследовавшая место старой. null,
// если у модуля происхождения нет вовсе (не из «Базы модулей» или карточка,
// откуда он был добавлен, с тех пор удалена).
function libModOriginTarget(mod) {
  const p = mod && mod.libOrigin ? libModPlacementById(mod.libOrigin) : null;
  return p ? { group: p.group, categoryPath: (p.categoryPath || []).slice() } : null;
}

// Куда класть НОВУЮ карточку, если у модуля нет происхождения (собран
// вручную, не из библиотеки) — своя группа PRESETS по семейству модуля:
// кухонный уходит в «Кухонный модуль», остальные — в «Тумба» (та же группа,
// где уже лежит большинство заготовок-тумб, см. presets.js).
function libModDefaultTarget(mod) {
  return { group: (mod && mod.family === 'kitchen') ? 'kitchen' : 'base', categoryPath: [] };
}

// «Сохранить» — заменяет параметры КАРТОЧКИ, из которой этот модуль был
// добавлен в проект (mod.libOrigin), текущими. Карточка остаётся на своём
// месте в дереве под тем же названием — меняется только содержимое.
// Заводская карточка (id вида 'default:<presetId>') сама params хранить не
// может (см. большой комментарий над libModAllPlacements — она лишь
// ссылается на presets.js), поэтому первое «Сохранить» на ней материализует
// НОВУЮ самостоятельную карточку на том же месте дерева и прячет заводскую
// (тем же приёмом, что и × в libModDeleteCard), а модуль получает libOrigin
// этой новой карточки — второе и последующие «Сохранить» уже просто
// перезаписывают её. Доступность пункта меню — см. showModuleMenu (canSave).
function libModSaveModule(mod) {
  if (!requireLibraryEditAuth()) return;
  const originId = mod.libOrigin;
  const p = originId ? libModPlacementById(originId) : null;
  if (!p) return;
  const params = libModCloneModuleParams(mod);
  // Имя карточки — если оно ещё не переопределено (p.name === null),
  // резолвим его ЧЕРЕЗ presetId, ПОКА ссылка на пресет ещё жива: и заводская
  // «default:»-карточка, и уже скопированная (см. libModCopyCard), которую
  // ещё ни разу не сохраняли своими параметрами, могут ссылаться на пресет
  // с null-именем (значит «имя пресета»). После «Сохранить» presetId у
  // карточки пропадёт (см. ветки ниже) — без этого её имя осталось бы
  // пустым НАВСЕГДА, падать будет уже не на что (см. код-ревью).
  const ref = p.presetId ? libModPresetOf(p.presetId) : null;
  const resolvedName = p.name || (ref ? ref.item.name : '') || null;
  if (String(originId).indexOf('default:') === 0) {
    const presetId = originId.slice('default:'.length);
    if (!state.libModOverrides[presetId]) state.libModOverrides[presetId] = {};
    state.libModOverrides[presetId].removed = true;
    const newId = libModNewPlacementId();
    state.libModPlacements.push({
      id: newId, group: p.group, categoryPath: (p.categoryPath || []).slice(),
      name: resolvedName, params, materialSnapshot: libModMaterialSnapshotOf(),
    });
    mod.libOrigin = newId;
  } else {
    const real = (state.libModPlacements || []).find((x) => x.id === originId);
    if (!real) return;
    delete real.presetId;
    delete real.kit;
    real.name = resolvedName;
    real.params = params;
    real.materialSnapshot = libModMaterialSnapshotOf();
  }
  scheduleCatalogSave();
  renderLibraryPanel();
}

// «Сохранить как…» — спрашивает название и добавляет НОВУЮ карточку с
// текущими параметрами модуля, не трогая старую (если она была). Новое место
// в дереве — сначала категория, сейчас выделенная (сфокусированный лист) в
// дереве «Базы модулей» (см. libModActiveCategoryTarget — пользователь явно
// её раскрыл, значит туда и ждёт карточку); если сейчас ничего не
// сфокусировано — там же, где лежит карточка-происхождение модуля, если она
// есть (логично класть рядом с «родителем»), иначе — свой дефолт по семейству
// (см. libModDefaultTarget). Модуль в сцене получает libOrigin НОВОЙ
// карточки — «Сохранить» сразу следом доступно и пишет уже в неё.
function libModSaveModuleAs(mod) {
  if (!requireLibraryEditAuth()) return;
  const target = libModActiveCategoryTarget() || libModOriginTarget(mod) || libModDefaultTarget(mod);
  const raw = window.prompt('Название модуля в «Базе модулей»:', mod.name || 'Модуль');
  if (raw == null) return;
  const name = String(raw).trim() || (mod.name || 'Модуль');
  const newId = libModNewPlacementId();
  state.libModPlacements.push({
    id: newId, group: target.group, categoryPath: target.categoryPath.slice(),
    name, params: libModCloneModuleParams(mod), materialSnapshot: libModMaterialSnapshotOf(),
  });
  mod.libOrigin = newId;
  scheduleCatalogSave();
  renderLibraryPanel();
}

// «Добавить модуль» в шапке «Базы модулей» (см. libraryBlock) — сохраняет
// ВЕСЬ текущий проект: один модуль ведёт себя как обычное «Сохранить как…»
// (libModSaveModuleAs), несколько — одной карточкой-комплектом (p.kit). Место
// в дереве — та же логика приоритета, что и у «Сохранить как…»: сначала
// сейчас выделенная категория (см. libModActiveCategoryTarget), иначе дефолт
// по семейству ПЕРВОГО модуля комплекта (см. libModDefaultTarget) — у
// комплекта, в отличие от одного модуля, нет единого mod.libOrigin, поэтому
// карточку-происхождение здесь не ищем.
// x/z каждого элемента — только СПРАВОЧНОЕ смещение относительно первого
// модуля комплекта на момент сохранения (для самодостаточности данных карты);
// сама вставка комплекта в проект (addLibModCardToProject/insertModulesBatch)
// их не читает — раскладку воспроизводит порядок модулей в kit, тот же
// принцип, по которому engine.js (buildModel) раскладывает state.modules.
function libModSaveProjectAsKit() {
  if (!requireLibraryEditAuth()) return;
  if (!state.modules.length) { window.alert('В проекте нет ни одного модуля.'); return; }
  if (state.modules.length === 1) { libModSaveModuleAs(state.modules[0]); return; }
  const raw = window.prompt('Название комплекта в «Базе модулей»:', '');
  if (raw == null) return;
  const name = String(raw).trim();
  if (!name) { window.alert('Введите название комплекта.'); return; }
  const target = libModActiveCategoryTarget() || libModDefaultTarget(state.modules[0]);
  const kitProject = Object.assign({}, libModThumbBase(), {
    countertopCornerJoint: state.countertopCornerJoint,
    modules: state.modules.map((m) => libModProjectModuleOf(m)),
  });
  const kitModel = buildModel(kitProject);
  const base = (kitModel.modules && kitModel.modules[0]) || { offsetX: 0, offsetZ: 0 };
  const kit = state.modules.map((m, i) => {
    const placed = kitModel.modules && kitModel.modules[i];
    return {
      params: libModCloneModuleParams(m),
      x: Math.round(((placed ? placed.offsetX : 0) - base.offsetX) * 10) / 10,
      z: Math.round(((placed ? placed.offsetZ : 0) - base.offsetZ) * 10) / 10,
    };
  });
  state.libModPlacements.push({
    id: libModNewPlacementId(), group: target.group, categoryPath: target.categoryPath.slice(),
    name, kit, materialSnapshot: libModMaterialSnapshotOf(),
  });
  scheduleCatalogSave();
  renderLibraryPanel();
}

// Удаление своей верхнеуровневой категории «Базы модулей» (× в строке
// дерева, см. libDeleteNode/libTreeRowHtml) — встроенную группу PRESETS
// сюда не пускаем (подстраховка, значка × у неё и так нет), непустую свою
// категорию не удаляем без предупреждения (та же причина, что и у
// libDeleteHwCategory/libDeleteMaterialCategory: массовое удаление карточек
// одним кликом слишком легко сделать случайно).
function libDeleteModuleTopCategory(topCode) {
  if (String(topCode).indexOf('mod:') !== 0) return;
  const key = topCode.slice(4);
  if (libModTopIsBuiltin(key)) return;
  if (libNodeHasItems(topCode, [])) {
    window.alert('Сначала удалите или перенесите модули из этой категории.');
    return;
  }
  state.libModCustomGroups = (state.libModCustomGroups || []).filter((g) => g.key !== key);
  delete state.libExtraNodes[topCode];
  delete state.libNodeOrder[topCode];
  if (Array.isArray(state.libTopOrder.modules)) {
    state.libTopOrder.modules = state.libTopOrder.modules.filter((c) => c !== topCode);
  }
  const parentMap = state.libTopParent.modules;
  if (parentMap) {
    delete parentMap[topCode];
    Object.keys(parentMap).forEach((c) => { if (parentMap[c] === topCode) delete parentMap[c]; });
  }
  delete state.libCatOpen[topCode];
  delete state.libActiveLeaf[topCode];
  const collapsedPrefix = topCode + '::';
  Object.keys(state.libCollapsed).forEach((k) => { if (k.indexOf(collapsedPrefix) === 0) delete state.libCollapsed[k]; });
  scheduleCatalogSave();
  renderLibraryPanel();
}

// «Добавить категорию» вкладки «База модулей» (кнопка-плитка libAddCatTileHtml)
// — своя ВЕРХНЕУРОВНЕВАЯ категория дерева наравне с группами PRESETS, как и
// libAddMaterialCategory/libAddHwCategory у соседних вкладок.
function libAddModuleGroup() {
  if (!requireLibraryEditAuth()) return;
  const name = libCleanNodeName(window.prompt('Название новой категории базы модулей:'));
  if (!name) return;
  const busy = PRESETS.map((g) => g.name.toLowerCase())
    .concat((state.libModCustomGroups || []).map((g) => g.name.toLowerCase()));
  if (busy.indexOf(name.toLowerCase()) >= 0) {
    window.alert('Категория с таким названием уже есть.');
    return;
  }
  const key = 'modcustom-' + Date.now();
  state.libModCustomGroups.push({ key, name });
  // Встаёт сразу после категории, которую пользователь только что трогал в
  // дереве этой вкладки — не в конец (см. libPlaceNewTopAfterFocused).
  libPlaceNewTopAfterFocused('modules', 'mod:' + key);
  state.libCatOpen['mod:' + key] = true;   // новая категория сразу раскрыта
  scheduleCatalogSave();
  renderLibraryPanel();
}

// ---------------------------------------------------------------------------
// Перетаскивание МИНИАТЮРЫ модуля на строку дерева категорий — меняет путь
// ЭТОЙ карточки (тот же эффект, что и ⇄ в контекстном меню, см.
// libModMoveCardMenu/libMoveEntry), без открытия пикера: бросили на строку —
// карточка переехала туда. По ощущениям и визуальному языку — тот же приём,
// что и перетаскивание узла дерева (см. большой комментарий над
// libTreeDragPointerDown): удержание/сдвиг запускают жест, призрак следует
// за курсором, строка-цель подсвечена тем же классом .lib-drop-into — но
// процесс отдельный и более простой: карточка не «встаёт по соседству» с
// точностью до позиции (в дереве модулей нет заданного пользователем
// порядка карточек внутри категории), только переезжает В узел, на который
// её бросили — поэтому Pointer Events здесь свои, не разделяемые с
// libDrag/libTreeDragPointerDown (тот адресует УЗЛЫ дерева по topCode+path
// одного и того же раздела, карточка адресуется отдельным id и может
// переехать в ЛЮБУЮ группу «Базы модулей»).
// ---------------------------------------------------------------------------
let libModCardDrag = null;
let libModCardDragClickGuard = false;
let libModCardDragClickGuardTimer = null;

function libModCardDragPointerDown(e) {
  if (libModCardDrag) libModCardDragFinish();
  if (e.button != null && e.button > 0) return;
  if (!e.target || !e.target.closest) return;
  if (state.libPickTarget) return;
  const card = e.target.closest('.lib-item[data-placement]');
  if (!card) return;
  libModCardDrag = {
    id: card.dataset.placement, card,
    pointerId: e.pointerId, touch: e.pointerType === 'touch',
    startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY,
    grabDX: 0, grabDY: 0,
    active: false, holdTimer: null, ghost: null, overRow: null, captured: false,
  };
  libModCardDrag.holdTimer = setTimeout(libModCardDragBegin, LIB_DRAG_HOLD_MS);
  document.addEventListener('pointermove', libModCardDragMove);
  document.addEventListener('pointerup', libModCardDragPointerUp);
  document.addEventListener('pointercancel', libModCardDragPointerCancel);
}

function libModCardDragBegin() {
  if (!libModCardDrag || libModCardDrag.active) return false;
  clearTimeout(libModCardDrag.holdTimer);
  libModCardDrag.holdTimer = null;
  if (!requireLibraryEditAuth()) { libModCardDragFinish(); return false; }
  libModCardDrag.active = true;
  const rect = libModCardDrag.card.getBoundingClientRect();
  libModCardDrag.grabDX = libModCardDrag.x - rect.left;
  libModCardDrag.grabDY = libModCardDrag.y - rect.top;
  try {
    if (libModCardDrag.pointerId != null && libModCardDrag.card.setPointerCapture) {
      libModCardDrag.card.setPointerCapture(libModCardDrag.pointerId);
      libModCardDrag.captured = true;
      libModCardDrag.card.addEventListener('lostpointercapture', libModCardDragPointerCancel);
    }
  } catch (err) { /* захват не обязателен: без него перетаскивание работает, просто менее надёжно */ }
  document.body.classList.add('lib-dragging');
  libModCardDrag.card.classList.add('lib-drag-src');
  const ghost = document.createElement('div');
  ghost.className = 'lib-drag-ghost lib-mod-drag-ghost';
  const img = libModCardDrag.card.querySelector('img');
  ghost.innerHTML = img ? `<img src="${img.getAttribute('src')}" alt="">` : '';
  document.body.appendChild(ghost);
  libModCardDrag.ghost = ghost;
  if (libModCardDrag.touch) document.addEventListener('touchmove', libDragBlockTouchScroll, { passive: false });
  libModCardDragMoveGhost();
  libModCardDragUpdateTarget();
  return true;
}

function libModCardDragMoveGhost() {
  if (!libModCardDrag || !libModCardDrag.ghost) return;
  libModCardDrag.ghost.style.left = (libModCardDrag.x - libModCardDrag.grabDX) + 'px';
  libModCardDrag.ghost.style.top = (libModCardDrag.y - libModCardDrag.grabDY) + 'px';
}

function libModCardDragMove(e) {
  if (!libModCardDrag) return;
  if (e.pointerId != null && libModCardDrag.pointerId != null && e.pointerId !== libModCardDrag.pointerId) return;
  libModCardDrag.x = e.clientX;
  libModCardDrag.y = e.clientY;
  if (!libModCardDrag.active) {
    const dx = e.clientX - libModCardDrag.startX;
    const dy = e.clientY - libModCardDrag.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (libModCardDrag.touch) {
      if (dist > LIB_DRAG_TOUCH_SLOP) libModCardDragFinish();
      return;
    }
    if (dist < LIB_DRAG_MOUSE_SLOP) return;
    if (!libModCardDragBegin()) return;
  }
  if (e.cancelable) e.preventDefault();
  libModCardDragMoveGhost();
  libModCardDragUpdateTarget();
}

// Цель — ЛЮБАЯ строка дерева «Базы модулей» (её topCode начинается с
// 'mod:') под курсором, независимо от того, какой группе принадлежит: в
// отличие от перетаскивания узла дерева, у карточки нет «своего раздела»,
// который нельзя покидать.
function libModCardDragUpdateTarget() {
  if (!libModCardDrag || !libModCardDrag.active) return;
  const el = document.elementFromPoint(libModCardDrag.x, libModCardDrag.y);
  const row = el && el.closest ? el.closest('[data-tree-node]') : null;
  const nextRow = (row && String(row.dataset.top || '').indexOf('mod:') === 0) ? row : null;
  if (libModCardDrag.overRow && libModCardDrag.overRow !== nextRow) libModCardDrag.overRow.classList.remove('lib-drop-into');
  if (nextRow) nextRow.classList.add('lib-drop-into');
  libModCardDrag.overRow = nextRow;
}

function libModCardDragPointerUp(e) {
  if (!libModCardDrag) return;
  if (e.pointerId != null && libModCardDrag.pointerId != null && e.pointerId !== libModCardDrag.pointerId) return;
  const wasActive = libModCardDrag.active;
  const row = libModCardDrag.overRow;
  const id = libModCardDrag.id;
  libModCardDragFinish();
  if (!wasActive) return;
  // Клик, который браузер шлёт следом за отпусканием кнопки в конце
  // перетаскивания, не должен ещё и добавить модуль в проект (тот же приём,
  // что у libDragClickGuard/libTreeDragFinish).
  libModCardDragClickGuard = true;
  clearTimeout(libModCardDragClickGuardTimer);
  libModCardDragClickGuardTimer = setTimeout(() => { libModCardDragClickGuard = false; }, 0);
  if (row) {
    const p = libModPlacementById(id);
    if (p) libMoveEntry('mod:' + p.group, 'modplace', id, { top: row.dataset.top, path: row.dataset.path ? row.dataset.path.split('::') : [] });
  }
}
function libModCardDragPointerCancel() { libModCardDragFinish(); }

function libModCardDragFinish() {
  if (!libModCardDrag) return;
  clearTimeout(libModCardDrag.holdTimer);
  document.removeEventListener('pointermove', libModCardDragMove);
  document.removeEventListener('pointerup', libModCardDragPointerUp);
  document.removeEventListener('pointercancel', libModCardDragPointerCancel);
  document.removeEventListener('touchmove', libDragBlockTouchScroll);
  if (libModCardDrag.captured && libModCardDrag.card.releasePointerCapture) {
    try { libModCardDrag.card.releasePointerCapture(libModCardDrag.pointerId); } catch (err) { /* захват уже снят */ }
  }
  if (libModCardDrag.card) libModCardDrag.card.classList.remove('lib-drag-src');
  if (libModCardDrag.overRow) libModCardDrag.overRow.classList.remove('lib-drop-into');
  if (libModCardDrag.ghost) libModCardDrag.ghost.remove();
  document.body.classList.remove('lib-dragging');
  libModCardDrag = null;
}

// ---------------------------------------------------------------------------
// Панель «Библиотека» (отдельная, самостоятельная — не путать с «Параметры
// проекта»): поиск + четыре вкладки. «База модулей» — существующий блок выше
// (libraryBlock/bindLibraryEvents), просто отрисован в
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
// «Характеристики материала», libIsCharsCollapsed).
// opts.title — подсказка по наведению на ячейку: нужна там, где из самой
// колонки уже не видно, ЧТО именно в ней написано (цена фурнитуры — за штуку
// или за пару, см. libHwPriceCellHtml: отдельной колонки «Ед. изм.» в
// таблице фурнитуры больше нет).
// opts.afterHtml — ГОТОВАЯ разметка, дописываемая в ячейку сразу за текстом
// (её не экранируем — это наша собственная разметка, а не данные каталога).
// Так значок ⇄ «перенести позицию» (см. libRowMoveIcHtml) живёт ВНУТРИ
// ячейки «Наименование» и не требует отдельной колонки, которой у таблицы
// фиксированной ширины взяться неоткуда. На инлайн-редактирование это не
// влияет: startCellEdit подставляет значение из data-raw, а не из текста
// ячейки, и заменяет её содержимое целиком.
function libEditCell(group, key, field, type, value, opts) {
  opts = opts || {};
  const raw = value == null ? '' : String(value);
  const shown = opts.displayText != null ? opts.displayText : raw;
  const cls = 'lib-edit-cell' + (opts.extraClass ? ' ' + opts.extraClass : '');
  const titleAttr = opts.title ? ` title="${esc(opts.title)}"` : '';
  return `<td class="${cls}" data-group="${esc(group)}" data-key="${esc(key)}" data-field="${field}" data-type="${type}" data-raw="${esc(raw)}"${titleAttr}>${esc(shown)}${opts.afterHtml || ''}</td>`;
}

// Дефолт для колонок Длина/Ширина/Толщина (см. libRowHtml) — как обычная
// libEditCell, только вместо пустой ячейки при отсутствующем значении
// (бывает, например, у декора без указанной толщины) показывает «—».
function libDashEditCell(group, key, field, value, extraClass) {
  return libEditCell(group, key, field, 'number', value, { displayText: value == null ? '—' : undefined, extraClass });
}

// Строки «Цены сверены с сайтом mobilier.md · обновлено ДД.ММ.ГГГГ» наверху
// вкладок Библиотеки больше нет (убрана 2026-09-16 по просьбе пользователя):
// она относилась к разовой сверке каталога целиком и быстро устаревала, а
// свежесть КОНКРЕТНОЙ позиции теперь видна точнее — по её собственной ссылке
// на карточку товара (клик по образцу, см. libSwatchHtml) и по кнопке
// «Обновить цены с сайта» (refreshCatalogLinkedPrices). Вместе с ней ушли
// рендерившие её libSourceHint() и вспомогательная formatDateRu() — сам
// CATALOG_SOURCE в catalog.js трогать не стали (это данные каталога, не UI).

// Карточка цвета/образца — превью из поля image (URL или dataURL) или
// заглушка «+». Клик (см. initLibraryPanel → .lib-swatch): если у позиции
// есть sourceUrl (см. catalog.js) — открывает карточку товара на сайте
// поставщика в новой вкладке (это заменяет собой прежнюю отдельную колонку-
// стрелку «↗», см. удалённую libSourceLinkCell — она стала избыточной, раз
// кликабелен сам образец); sourceUrl передаётся через data-swatch-url, чтобы
// обработчик клика не искал item повторно. Если sourceUrl нет — по-прежнему
// открывает системный выбор файла (см. openLibImagePicker) — так и остаётся
// для позиций без соответствия на сайте.
// data-swatch-src дублирует саму ссылку картинки (то же, что уходит в
// background-image) — читает лупа-зум при наведении (см.
// openLibSwatchZoomPreview/.lib-swatch-zoom-icon ниже), чтобы не разбирать
// background-image из вычисленного стиля. Значка лупы у пустой заглушки нет —
// увеличивать нечего.
function libSwatchHtml(group, key, image, sourceUrl) {
  // dataURL (base64) не содержит одинарных кавычек — безопасно подставлять
  // внутрь url('...') без экранирования; esc() экранирует внешний HTML-атрибут
  // (двойные кавычки), а не саму CSS-строку. Обычный https-URL (см. поле
  // image у большинства позиций catalog.js) по той же причине безопасен.
  const style = image ? ` style="background-image:url('${esc(image)}')"` : '';
  const urlAttr = sourceUrl ? ` data-swatch-url="${esc(sourceUrl)}"` : '';
  const srcAttr = image ? ` data-swatch-src="${esc(image)}"` : '';
  const title = sourceUrl ? 'Открыть карточку товара на сайте' : 'Загрузить образец';
  const zoomIcon = image ? '<span class="lib-swatch-zoom-icon" title="Увеличить превью">🔍</span>' : '';
  return `<span class="lib-swatch${image ? '' : ' empty'}" data-swatch-group="${esc(group)}" data-swatch-key="${esc(key)}"${style}${urlAttr}${srcAttr} title="${esc(title)}">${zoomIcon}</span>`;
}

// Миниатюра чертежа присадки конкретной позиции фурнитуры (поле it.drawing —
// URL/dataURL картинки, независимое от it.image, которое остаётся фото
// товара) — по образцу libSwatchHtml выше, но проще: без клика «открыть
// карточку товара»/«загрузить свой файл» (см. её пропуск в общем обработчике
// .lib-swatch — initLibraryPanel), просто миниатюра или пустая заглушка.
// Показывается колонкой «Чертёж» под тумблером «Характеристики» (см.
// state.libHwCharsVisible/libHardwareLeafTableHtml). Класс намеренно тот же
// .lib-swatch, что у обычного образца — так на неё распространяется общая
// лупа-зум по наведению (см. .lib-swatch-zoom-icon/openLibSwatchZoomPreview).
// drawingFull — тяжёлая версия того же чертежа (400 dpi) для клика «открыть в
// полном размере»; в таблице и в лупе показывается лёгкая drawing.
function libDrawingSwatchHtml(group, key, drawing, drawingFull, itemName) {
  const style = drawing ? ` style="background-image:url('${esc(drawing)}')"` : '';
  const srcAttr = (drawing ? ` data-swatch-src="${esc(drawing)}"` : '')
    + (drawing && drawingFull ? ` data-swatch-full="${esc(drawingFull)}"` : '')
    + (drawing && itemName ? ` data-swatch-title="${esc(itemName)}"` : '');
  const title = drawing ? 'Чертёж — клик открывает его в полном размере' : 'Чертёж не добавлен';
  const zoomIcon = drawing ? '<span class="lib-swatch-zoom-icon" title="Увеличить превью">🔍</span>' : '';
  return `<span class="lib-swatch lib-drawing-swatch${drawing ? '' : ' empty'}" data-swatch-group="${esc(group)}" data-swatch-key="${esc(key)}"${style}${srcAttr} title="${esc(title)}">${zoomIcon}</span>`;
}

// Touch-устройство (телефон/планшет) — определяем один раз по факту, без
// кэширования (вызывается только по клику, не в горячем пути рендера).
// Нужна, чтобы развести на .lib-swatch два разных действия по тапу (см.
// initLibraryPanel: клик по .lib-swatch) — раньше на touch и крошечная
// лупа-иконка в углу, и сама миниатюра рядом с ней были отдельными мишенями,
// палец промахивался между «зум» и «уйти на сайт» (задача 2026-09-26). На
// touch тап по самой миниатюре теперь сразу открывает зум-превью, а переход
// на сайт — явной кнопкой «Перейти на сайт» внутри превью (см.
// openLibSwatchZoomPreview); значок лупы там же прячется CSS-медиа-запросом
// (hover: none), см. .lib-swatch-zoom-icon в style.css.
function isTouchLibraryDevice() {
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

// -----------------------------------------------------------------------
// Лупа-зум миниатюр .lib-swatch (образец материала/фурнитуры — libSwatchHtml,
// чертёж присадки — libDrawingSwatchHtml) — общий для ВСЕХ таблиц Библиотеки
// приём на desktop: наведение на саму миниатюру показывает значок лупы в её
// углу (чисто CSS, .lib-swatch:hover .lib-swatch-zoom-icon, см. style.css), а
// наведение на саму лупу открывает вот это увеличенное превью — один
// переиспользуемый элемент #libSwatchZoomPreview, создаётся/удаляется по
// месту (тот же приём, что и #detailFilterMenu в openColumnFilterMenu/
// closeColumnFilterMenu выше). На touch (см. isTouchLibraryDevice) значка
// лупы нет вовсе — то же превью открывает тап по самой миниатюре (см. клик
// по .lib-swatch в initLibraryPanel). Делегированные mouseover/mouseout/click
// вешаются один раз на #libraryPanel в initLibraryPanel — переживают
// renderLibraryPanel (innerHTML целиком перерисовывается), поэтому саму
// разметку лупы искать заново не нужно.
// -----------------------------------------------------------------------
let libSwatchZoomOutsideHandler = null;
function closeLibSwatchZoomPreview() {
  const el = document.getElementById('libSwatchZoomPreview');
  if (el && el.remove) el.remove();
  if (libSwatchZoomOutsideHandler) {
    document.removeEventListener('click', libSwatchZoomOutsideHandler);
    document.removeEventListener('touchstart', libSwatchZoomOutsideHandler);
    libSwatchZoomOutsideHandler = null;
  }
}
// anchorEl — либо сам .lib-swatch-zoom-icon (desktop, наведение), либо сама
// .lib-swatch (touch, тап) — превью встаёт рядом с НИМ (тот же приём
// позиционирования, что и раньше, просто якорь разный). Картинку берём из
// data-swatch-src РОДИТЕЛЬСКОЙ .lib-swatch (та же ссылка, что уже
// используется как background-image миниатюры, см. libSwatchHtml/
// libDrawingSwatchHtml) — так превью показывает ИМЕННО ту картинку, что и
// сама миниатюра, без повторного чтения item из каталога. Размер бокса —
// ВСЕГДА фиксированные 250×250 (см. .lib-swatch-zoom-preview img в
// style.css, object-fit: contain сохраняет пропорции без искажений) — не
// зависит от natural-разрешения источника, чтобы превью разных позиций (у
// разных сайтов-парсеров разное исходное разрешение) не отличались по
// размеру визуально (задача 2026-09-26). opts.showLink — показать кнопку
// «Перейти на сайт» (только touch-сценарий, см. initLibraryPanel); кнопка
// добавляется, только если у миниатюры реально есть sourceUrl (data-swatch-
// url, см. libSwatchHtml) — у чертежа присадки (libDrawingSwatchHtml) его
// нет никогда, поэтому там кнопки не будет, даже если showLink запрошен.
function openLibSwatchZoomPreview(anchorEl, opts) {
  const isSwatchAnchor = anchorEl.classList && anchorEl.classList.contains('lib-swatch');
  const swatch = isSwatchAnchor ? anchorEl : anchorEl.closest('.lib-swatch');
  const src = swatch && swatch.dataset.swatchSrc;
  if (!src) return;
  closeLibSwatchZoomPreview();
  const box = document.createElement('div');
  box.id = 'libSwatchZoomPreview';
  box.className = 'lib-swatch-zoom-preview';
  const img = document.createElement('img');
  img.src = src;
  box.appendChild(img);
  const swatchUrl = swatch.dataset.swatchUrl;
  if (opts && opts.showLink && swatchUrl) {
    const link = document.createElement('a');
    link.className = 'btn btn-primary lib-swatch-zoom-link';
    link.href = swatchUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Перейти на сайт';
    box.appendChild(link);
  }
  document.body.appendChild(box);
  const anchorRect = anchorEl.getBoundingClientRect();
  const rect = box.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const left = Math.max(4, Math.min(anchorRect.right + 8, window.innerWidth - w - 4));
  const top = Math.max(4, Math.min(anchorRect.top + anchorRect.height / 2 - h / 2, window.innerHeight - h - 4));
  box.style.left = Math.round(left) + 'px';
  box.style.top = Math.round(top) + 'px';
  if (isSwatchAnchor) {
    // Touch: закрываем тапом В ЛЮБОМ месте — включая саму картинку внутри
    // превью, это и есть ожидаемый способ закрыть (не только «мимо» самого
    // бокса) — кроме тапа по кнопке «Перейти на сайт» (.lib-swatch-zoom-link,
    // ей нужно долистать до навигации, а не закрыться раньше) и по исходной
    // миниатюре-якорю (иначе тот же тап, что превью открыл, тут же его бы и
    // закрыл). У позиций без ссылки (opts.showLink=false или нет sourceUrl,
    // например чертёж присадки) .lib-swatch-zoom-link в разметке нет вовсе —
    // там тап по картинке закрывает превью так же, как по любому другому
    // месту. Тот же приём отложенной подписки на document, что и у
    // openLibMoveMenu выше (setTimeout 0, чтобы не поймать текущий, уже
    // идущий клик).
    setTimeout(() => {
      // Превью успели переоткрыть раньше этого тика — этот бокс уже удалён,
      // не вешаем для него обработчик (иначе он повиснет на document).
      if (!box.isConnected) return;
      libSwatchZoomOutsideHandler = (e) => {
        if (anchorEl.contains(e.target)) return;
        if (e.target.closest && e.target.closest('.lib-swatch-zoom-link')) return;
        // Тап по самой картинке закрываем только на click, не на touchstart:
        // иначе превью исчезает под пальцем раньше, чем браузер сгенерирует
        // click, и тот «проваливается» на строку таблицы под превью
        // (выделяет её или открывает другую миниатюру).
        if (e.type === 'touchstart' && box.contains(e.target)) return;
        closeLibSwatchZoomPreview();
      };
      document.addEventListener('click', libSwatchZoomOutsideHandler);
      document.addEventListener('touchstart', libSwatchZoomOutsideHandler);
    }, 0);
  } else {
    // Desktop: курсор может перейти с лупы прямо на само превью (они
    // соприкасаются, см. задачу) — свой mouseout, чтобы не закрывать
    // превью, пока курсор внутри него самого или ещё на исходной лупе.
    box.addEventListener('mouseout', (e) => {
      if (box.contains(e.relatedTarget) || anchorEl.contains(e.relatedTarget)) return;
      closeLibSwatchZoomPreview();
    });
  }
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
// материалы»/«Виды фасадов»/«Кромка»/«Стекло») не сворачивается сам,
// только раскрывает/прячет своих детей (см. state.libCatOpen).
//
// ИНВАРИАНТ ДЕРЕВА: если у узла ЕСТЬ подкатегории, собственных позиций у
// него не бывает — позиции «без фирмы» лежат в его подкатегории «Без
// бренда» (NO_BRAND_SUBCAT ниже), обычном узле дерева. Раньше такие позиции
// показывались прямо под строкой ветки, под подписью-псевдоузлом «Без
// подкатегории»: она выглядела как подкатегория, но ею не была — её нельзя
// было ни переименовать, ни перенести, ни удалить, и клик по ней ничего не
// делал. Теперь это настоящий узел со всеми значками (✎/⇄/×), а старые
// данные к инварианту приводит миграция libNormalizeOwnEntries.
// ---------------------------------------------------------------------------

// Имя подкатегории, в которую складываются позиции узла, у которого есть
// другие подкатегории (см. инвариант выше). Одна константа на все места,
// где это имя нужно: миграция (libNormalizeOwnEntries), цели переноса
// позиции (libEntryTargetPath/libRowMoveTargets) и виртуальное дерево
// столешниц (libTopEntries) — иначе переименование в одном месте дало бы
// две разные «безбрендовые» подкатегории рядом.
const NO_BRAND_SUBCAT = 'Без бренда';

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
    // Позиции своей категории (item.customRoot, см. libAddMaterialCategory/
    // libAddRow) сюда не входят — иначе одна и та же позиция задвоилась бы
    // и под «Листовыми материалами», и под своей категорией.
    const facadeAll = Object.values(cat.FACADE_MATERIALS);
    const facadeSheet = facadeAll.filter((it) => SHEET_FACADE_SUBCATS.indexOf((it.categoryPath || [])[0]) >= 0 && !it.customRoot);
    return []
      .concat(DECORS.filter((it) => !it.customRoot).map((it) => ({ group: 'decors', item: it })))
      .concat(facadeSheet.map((it) => ({ group: 'facade', item: it })))
      .concat(BACK_MATERIALS.map((it) => ({ group: 'back', item: it })));
  }
  if (topCode === 'facade') {
    // Та же защита от задвоения, что и у 'sheet' выше — своя категория
    // «Дверей» (item.customRoot, см. libAddFacadeCategory) сюда не входит.
    const facadeAll = Object.values(cat.FACADE_MATERIALS);
    return facadeAll
      .filter((it) => SHEET_FACADE_SUBCATS.indexOf((it.categoryPath || [])[0]) < 0 && !it.customRoot)
      .map((it) => ({ group: 'facade', item: it }));
  }
  // 'matcustom-<timestamp>'/'faccustom-<timestamp>' — своя корневая
  // категория «Материалов»/«Дверей», заведённая кнопкой-плиткой «Добавить
  // категорию» (см. state.libMatCustomCats/libFacCustomCats выше и
  // libAddMaterialCategory/libAddFacadeCategory ниже). В отличие от пяти
  // встроенных разделов выше, тип товара тут не фиксирован — все свои
  // категории «Материалов» используют одну и ту же decor-таблицу (см.
  // libAddRow: group 'decors'), свои категории «Дверей» — ту же таблицу, но
  // над FACADE_MATERIALS (group 'facade'); отличает их друг от друга только
  // item.customRoot, проставленный при добавлении позиции именно под этим
  // корнем.
  if (String(topCode).indexOf('matcustom-') === 0) {
    return DECORS.filter((it) => it.customRoot === topCode).map((it) => ({ group: 'decors', item: it }));
  }
  if (String(topCode).indexOf('faccustom-') === 0) {
    return Object.values(cat.FACADE_MATERIALS).filter((it) => it.customRoot === topCode).map((it) => ({ group: 'facade', item: it }));
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
      item: Object.assign({}, it, { categoryPath: [COUNTERTOP_MATERIAL_LABEL[it.materialId] || it.materialId, it.brand || NO_BRAND_SUBCAT] }),
    }));
  }
  // 'hw:<categoryKey>' — составной topCode вкладки «Фурнитура» (см. большой
  // комментарий над libHardwareTopEntries ниже): каждая категория (Петли/
  // Ручки/...) — своё НЕЗАВИСИМОЕ дерево верхнего уровня, как и у пяти веток
  // «Материалов» выше, без общей обёртки «Фурнитура» (убрана 2026-09-15).
  if (topCode.indexOf('hw:') === 0) return libHardwareTopEntries(cat, topCode.slice(3));
  // 'mod:<groupKey>' — «База модулей» (см. большой комментарий над
  // libModAllPlacements): каждая группа PRESETS/своя категория — своё
  // независимое дерево верхнего уровня, тем же приёмом, что и у 'hw:' выше.
  if (String(topCode).indexOf('mod:') === 0) return libModTopEntries(topCode.slice(4));
  return [];
}

// Записи ОДНОЙ категории вкладки «Фурнитура» (topCode 'hw:<categoryKey>',
// categoryKey — ключ из HARDWARE_CATEGORY_ORDER, например 'hinge'/'handle') —
// тот же приём, что и у 'edge'/'countertop' выше: позиции четырёх источников
// каталога (HARDWARE_PRICES/HANDLES/LIFTS/FASTENER_PRICES, HANDLES.none —
// служебная UI-заглушка «без ручки», в дерево не попадает) фильтруются по
// item.category === categoryKey и собираются в дерево ЭТОЙ ОДНОЙ категории —
// потому что у фурнитуры нет собственного поля categoryPath (как и у
// 'countertop'), его вычисляем на лету из item.subcategory (реальный бренд/
// линейка с сайта, см. catalog.js) либо item.brand (у LIFTS) — «фирма» в
// терминах пользователя. До 2026-09-15 категория (item.category →
// HARDWARE_CATEGORY_LABEL) была ПЕРВЫМ сегментом этого же categoryPath под
// единой обёрткой topCode 'hardware' — теперь она вынесена в сам topCode/
// заголовок (см. libraryHardwareBlock), поэтому categoryPath позиции — это
// уже ТОЛЬКО подкатегория/бренд, если он есть: [sub] либо [] (позиции без
// subcategory/brand, например hinge/hingeGlass, остаются с пустым путём и
// показываются как «свои» позиции корня дерева этой категории — см.
// libTopCategoryHtml, либо как обычный лист-заголовок, если во всей
// категории брендов вообще нет, например 'plinth'). group записи —
// 'hw:<src>', то же значение, что читают libFindItem/libSaveEdit ниже;
// item.key — ключ соответствующего объекта каталога (сам объект своего
// ключа не знает, тот же приём, что и у 'edge').
function libHardwareTopEntries(cat, categoryKey) {
  const sources = [
    ['hw', cat.HARDWARE_PRICES, null],
    ['handles', cat.HANDLES, ['none']],
    ['lifts', cat.LIFTS, null],
    ['fasteners', cat.FASTENER_PRICES, null],
  ];
  const out = [];
  sources.forEach(([src, obj, skipKeys]) => {
    Object.keys(obj || {}).forEach((key) => {
      if (skipKeys && skipKeys.indexOf(key) >= 0) return;
      const it = obj[key];
      if (it.category !== categoryKey) return;
      // С 2026-09-16 дерево категорий фурнитуры можно править так же, как у
      // материалов (переименование/добавление/перенос узлов, см.
      // libTreeRowHtml/libSetEntryPath), а произвольную вложенность одно
      // плоское поле subcategory/brand уже не опишет — поэтому у позиции,
      // которую пользователь переносил или чью категорию переименовывал,
      // появляется НАСТОЯЩЕЕ поле item.categoryPath (как у декоров), и оно
      // главнее. subcategory/brand остаются как были: это и исходное значение
      // для всех непотроганных позиций каталога, и человекочитаемая «фирма» в
      // данных (libSetEntryPath держит её в синхроне с последним сегментом).
      const sub = it.subcategory || it.brand || null;
      const categoryPath = Array.isArray(it.categoryPath) ? it.categoryPath.slice() : (sub ? [sub] : []);
      out.push({ group: 'hw:' + src, item: Object.assign({ key }, it, { categoryPath }) });
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Корневые категории вкладки «Фурнитура» — заводские (catalog.js:
// HARDWARE_CATEGORY_ORDER/HARDWARE_CATEGORY_LABEL) ПЛЮС свои, заведённые
// пользователем (state.libHwCustomCats), плюс свои подписи к любым из них
// (state.libHwCatLabels). Единственный набор функций, через который весь
// остальной код узнаёт, какие категории показывать и как они называются —
// напрямую HARDWARE_CATEGORY_LABEL для ПОКАЗА больше нигде не читаем (для
// логики — item.category — читаем как раньше, ключи неизменны).
// ---------------------------------------------------------------------------

// Встроенная ли это категория (есть в заводском HARDWARE_CATEGORY_ORDER).
// Такую нельзя удалить: по её ключу item.category движок подбирает фурнитуру
// в расчёте (engine.js/specification.js — 'hinge'/'runner'/'leg'/...), без неё
// спецификация осталась бы без петель и направляющих. Переименовать (сменить
// подпись) её при этом можно — ключ от этого не меняется.
function libHwCategoryIsBuiltin(categoryKey) {
  const order = (window.Modul3D.catalog.HARDWARE_CATEGORY_ORDER || []);
  return order.indexOf(categoryKey) >= 0;
}

// Полный порядок категорий вкладки: сначала заводские в их обычном порядке,
// затем свои — в порядке добавления.
function libHwCategoryKeys() {
  const order = (window.Modul3D.catalog.HARDWARE_CATEGORY_ORDER || []).slice();
  (state.libHwCustomCats || []).forEach((k) => { if (order.indexOf(k) < 0) order.push(k); });
  return order;
}

// Подпись категории на экране: своя (если пользователь переименовал или это
// его собственная категория) → заводская → сам ключ как последний резерв.
function libHwCategoryLabel(categoryKey) {
  const own = (state.libHwCatLabels || {})[categoryKey];
  if (own) return own;
  return (window.Modul3D.catalog.HARDWARE_CATEGORY_LABEL || {})[categoryKey] || categoryKey;
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

// Прямые дочерние сегменты узла prefixPath (путь без топ-кода) — в порядке,
// который задал пользователь перетаскиванием (см. state.libNodeOrder), а для
// не упорядоченного им остатка — в порядке первого появления в данных; но
// «Без бренда» (NO_BRAND_SUBCAT) ВСЕГДА последний.
// Пустой результат = узел лист (см. libNodeHtml).
// Почему подкатегория без фирмы прибита к концу: это ведро для позиций, у
// которых бренда нет вовсе, а не равноправная фирма. В порядке появления в
// данных она вклинивалась между настоящими брендами («Механизмы»: перед
// Blum/Hettich/Samet, «Крепёж»: между GTV и REJS) и читалась как ещё один
// бренд с таким названием. Правило живёт ЗДЕСЬ, в единственной функции,
// которая отвечает на вопрос «кто дети этого узла», поэтому одинаково
// действует и на отрисовку дерева (libNodeHtml/libTopCategoryHtml), и на
// списки целей переноса (libTreeAllNodePaths/libMoveTargets/
// libRowMoveTargets), и на хлебные крошки. Это ТОЛЬКО порядок вывода —
// categoryPath позиций не трогаем, лишних сохранений отсюда не возникает.
function libChildSegments(topCode, prefixPath) {
  const seen = [];
  libAllPaths(topCode).forEach((p) => {
    if (p.length <= prefixPath.length) return;
    for (let i = 0; i < prefixPath.length; i += 1) { if (p[i] !== prefixPath[i]) return; }
    const seg = p[prefixPath.length];
    if (seen.indexOf(seg) < 0) seen.push(seg);
  });
  // Свой порядок пользователя (см. state.libNodeOrder): перечисленные там
  // дети идут первыми и ровно в указанном порядке, всё остальное (категории,
  // заведённые уже после перетаскивания) — следом, в прежнем порядке
  // появления в данных. Так новая подкатегория не «телепортируется» в
  // середину списка и не рушит расстановку, которую пользователь сделал
  // руками.
  const order = libNodeOrderList(topCode, prefixPath);
  const listed = order.filter((seg) => seen.indexOf(seg) >= 0)
    .concat(seen.filter((seg) => order.indexOf(seg) < 0));
  // Повторы выбрасываем ЗДЕСЬ — в единственной функции, которая отвечает на
  // вопрос «кто дети этого узла», поэтому от дублей разом защищены и дерево,
  // и списки целей переноса, и снимок каталога. Откуда они берутся:
  // переименование узла в имя уже существующего соседа (libRenameNode такое
  // не запрещает — раньше две категории просто сливались в одну строку) и
  // испорченный порядок из старого сохранённого снимка. Без этой строки
  // категория рисовалась бы дважды, дважды предлагалась в «Перенести … в:»
  // и дубль уезжал бы обратно на сервер.
  const ordered = [];
  listed.forEach((seg) => { if (ordered.indexOf(seg) < 0) ordered.push(seg); });
  // Сравнение без учёта регистра — как везде, где имя узла сверяется с
  // NO_BRAND_SUBCAT (libEntryTargetPath/libMoveNode): «без бренда» и «Без
  // бренда» для пользователя одна и та же категория.
  // «Без бренда» прибивается к концу ПОСЛЕ применения своего порядка —
  // правило «ведро для позиций без фирмы стоит последним» сильнее ручной
  // расстановки (поэтому перетаскивание и не предлагает поставить узел ниже
  // него, см. libDragResolveTarget).
  const isNoBrand = (seg) => String(seg).toLowerCase() === NO_BRAND_SUBCAT.toLowerCase();
  return ordered.filter((seg) => !isNoBrand(seg)).concat(ordered.filter(isNoBrand));
}

// ---------------------------------------------------------------------------
// Пользовательский порядок детей узла (state.libNodeOrder) — три функции:
// прочитать, поставить узел на место, убрать мусор. Больше state.libNodeOrder
// нигде напрямую не трогается, кроме снимка каталога и его восстановления.
// ---------------------------------------------------------------------------

// Сохранённый порядок детей узла parentPath — массив имён (копия) или пустой
// массив, если порядок этому родителю не задавали.
function libNodeOrderList(topCode, parentPath) {
  const byTop = state.libNodeOrder[topCode] || {};
  const list = byTop[parentPath.join('::')];
  return Array.isArray(list) ? list.slice() : [];
}

// Ставит сегмент seg в порядке детей parentPath на позицию index. index
// считается по списку детей БЕЗ самого seg — так его и считает
// перетаскивание: на экране перетаскиваемый узел в этот момент ещё стоит на
// прежнем месте (возможно, у другого родителя). null/отрицательный/слишком
// большой index — «в конец», это же поведение у переноса значком ⇄ и у
// броска ВНУТРЬ узла.
// Порядок материализуется ЦЕЛИКОМ (все текущие дети, а не только
// переставленный): если записать одно имя, все остальные соседи стали бы
// «неупорядоченными» и уехали в хвост списка, хотя пользователь их не трогал.
function libPlaceChildAt(topCode, parentPath, seg, index) {
  const rest = libChildSegments(topCode, parentPath).filter((s) => s !== seg);
  const pos = (index == null || index < 0 || index > rest.length) ? rest.length : index;
  rest.splice(pos, 0, seg);
  // Object.create(null), а не {}: ключ карты — путь из названий категорий,
  // которые вводит пользователь, и запись вида order['__proto__'] в обычном
  // объекте не создала бы собственного свойства (она меняет прототип) —
  // порядок такой подкатегории молча пропал бы. Тот же приём, что в
  // libPruneNodeOrder/libTreeDragBegin.
  if (!state.libNodeOrder[topCode]) state.libNodeOrder[topCode] = Object.create(null);
  state.libNodeOrder[topCode][parentPath.join('::')] = rest;
}

// Индекс, на который встанет узел movedName среди детей parentPath, если
// бросить его РЯДОМ с соседом refName (before — выше него, иначе ниже).
// Считается по АКТУАЛЬНОМУ списку соседей и только в момент применения
// правки: между наведением мыши и броском дерево успевает измениться (узел
// уехал к другому родителю, вернулась заглушка опустевшего родителя), и
// запомненное заранее число указало бы не туда, куда показывала линия.
// null — соседа больше нет, вставлять не от чего.
function libChildInsertIndex(topCode, parentPath, movedName, refName, before) {
  const sibs = libChildSegments(topCode, parentPath).filter((s) => s !== movedName);
  const at = sibs.indexOf(refName);
  if (at < 0) return null;
  return before ? at : at + 1;
}

// Чистка осиротевших записей: узла с таким путём больше нет (удалили или
// перенесли всё поддерево) или в списке остались имена, которых среди детей
// уже нет. Без неё карта порядка только пухла бы — и вместе с ней каждый
// снимок каталога, уходящий на сервер.
function libPruneNodeOrder(topCode) {
  const byTop = state.libNodeOrder[topCode];
  if (!byTop) return;
  // Порядок детей имеет смысл только у существующих узлов раздела и у его
  // корня (ключ '' — дети верхнего уровня).
  // Object.create(null), а не {}: ключ здесь — имя категории от пользователя,
  // и такое имя, как «constructor»/«toString», в обычном объекте нашлось бы
  // само собой (прототип), то есть мёртвая запись выглядела бы живой.
  const alive = Object.create(null);
  alive[''] = true;
  libTreeAllNodePaths(topCode).forEach((p) => { alive[p.join('::')] = true; });
  Object.keys(byTop).forEach((key) => {
    if (!alive[key]) { delete byTop[key]; return; }
    const kids = libChildSegments(topCode, key ? key.split('::') : []);
    // Заодно выбрасываем ПОВТОРЫ: одно и то же имя попадает в список, если
    // узел переименовали в имя уже существующего соседа (см. дедупликацию в
    // libChildSegments — она чинит показ, а здесь чинится само хранилище,
    // чтобы дубль не уезжал в снимок на сервер).
    const kept = [];
    (byTop[key] || []).forEach((seg) => {
      if (kids.indexOf(seg) >= 0 && kept.indexOf(seg) < 0) kept.push(seg);
    });
    if (kept.length) byTop[key] = kept;
    else delete byTop[key];
  });
  if (!Object.keys(byTop).length) delete state.libNodeOrder[topCode];
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

// ---------------------------------------------------------------------------
// Поддержка ИНВАРИАНТА ДЕРЕВА (см. большой комментарий над libTopEntries):
// узел с подкатегориями своих позиций не имеет — они лежат в его «Без
// бренда». Инвариант нужен и показу (ветка рисует только детей, см.
// libNodeHtml), и переносу позиции (libRowMoveTargets), поэтому обе стороны
// считают одно и то же ОДНОЙ функцией libEntryTargetPath ниже.
// ---------------------------------------------------------------------------

// Куда на самом деле ляжет ПОЗИЦИЯ, если целью выбран узел path: сам path,
// если подкатегорий у него нет, иначе его «Без бренда». Уже существующий
// узел с таким именем переиспользуем (сравнение без учёта регистра — как в
// libMoveNode: «без бренда» и «Без бренда» для пользователя одна и та же
// категория), иначе он появится сам — от записи пути позиции (libAllPaths
// собирает форму дерева из путей позиций, отдельно заводить узел не нужно).
function libEntryTargetPath(topCode, path) {
  // «База модулей» не подчиняется этому инварианту (см. большой комментарий
  // над libModAllPlacements) — карточка пресета может лежать прямо в узле,
  // даже если у него уже есть подкатегории, путь не подменяется.
  if (String(topCode).indexOf('mod:') === 0) return path.slice();
  const children = libChildSegments(topCode, path);
  if (!children.length) return path.slice();
  const existing = children.find((seg) => String(seg).toLowerCase() === NO_BRAND_SUBCAT.toLowerCase());
  return path.concat([existing || NO_BRAND_SUBCAT]);
}

// Разделы, дерево которых приводится к инварианту. 'countertop' сюда не
// входит: его categoryPath виртуальный, собирается на лету из materialId/
// brand (см. libTopEntries), записать позиции новый путь физически некуда:
// запись ушла бы в одноразовую копию и пропала, а миграция на КАЖДОЙ
// отрисовке считала бы, что позицию снова надо перенести, и без толку слала
// бы снимок каталога на сервер.
function libNormalizableTopCodes() {
  return ['sheet', 'edge', 'glass', 'facade']
    .concat(state.libMatCustomCats || [])
    .concat(state.libFacCustomCats || [])
    .concat(libHwCategoryKeys().map((c) => 'hw:' + c));
}

// Собственно миграция: у каждого узла раздела (включая корень), у которого
// есть И подкатегории, И свои позиции, переносит эти позиции в его «Без
// бренда». Из коробки это задевает категории фурнитуры, где рядом с
// брендами лежала пара позиций без фирмы («Механизмы», «Направляющие»).
// Путь пишем единственной точкой записи categoryPath (libSetEntryPath) —
// она же держит в синхроне subcategory/brand; расчёту это не мешает, оба
// поля чисто UI-шные (в engine/specification/cnc/viewer не используются).
// Возвращает true, если что-то реально переехало — вызывающая сторона по
// этому флагу решает, нужно ли сохранять каталог. На уже нормализованном
// дереве возвращает false и ничего не трогает: иначе каждая отрисовка
// панели дёргала бы сохранение.
function libNormalizeOwnEntries(topCode) {
  let moved = false;
  [[]].concat(libTreeAllNodePaths(topCode)).forEach((path) => {
    if (!libChildSegments(topCode, path).length) return;
    const own = libEntriesAtPath(topCode, path);
    if (!own.length) return;
    const target = libEntryTargetPath(topCode, path);
    own.forEach((e) => {
      // Позиция, за которой не стоит реального объекта каталога, записи пути
      // не переживёт (см. libRealItemOf) — такую честнее оставить на месте,
      // чем каждый раз считать её «перенесённой».
      if (!libRealItemOf(e)) return;
      libSetEntryPath(e, target);
      moved = true;
    });
  });
  return moved;
}

// Общая санация названия узла дерева — ОДНА на все места, где имя вводит
// пользователь (libAddChildNode, libAddHwCategory и инлайн-переименование
// startTreeRename → libRenameNode). Убирает «::» — это разделитель сегментов
// пути (см. libNodeKey ниже и data-path в libTreeRowHtml), имя с ним
// развалило бы адресацию узла: «А::Б» прочиталось бы как два уровня дерева.
// Заодно схлопывает лишние пробелы. Возвращает '' (отказ), если после
// очистки ничего не осталось; про непустой ввод, от которого ничего не
// осталось, говорим прямо — иначе клик по ✎ выглядел бы «не сработавшим».
function libCleanNodeName(raw) {
  const rawName = String(raw == null ? '' : raw);
  const name = rawName.replace(/:{2,}/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name && rawName.trim()) {
    window.alert('Такое название использовать нельзя — знак «::» в названии категории зарезервирован.');
  }
  return name;
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

// ---------------------------------------------------------------------------
// Правка САМОГО ДЕРЕВА категорий (переименование узла ✎ и перенос узла ⇄) —
// общий движок libRepathNode ниже. И то, и другое — одна и та же операция:
// «у всех позиций и заглушек, что лежат в этом узле или глубже, поменять
// начало пути», меняется только то, на что именно меняем начало. Поэтому
// обход написан ОДИН раз, а libRenameNode/libMoveNode — две тонкие обёртки
// над ним.
// ---------------------------------------------------------------------------

// Настоящий объект каталога записи дерева ({ group, item } из libTopEntries).
// Нужен потому, что часть категорий отдаёт в дерево не сам объект каталога,
// а его одноразовую копию (Object.assign): 'edge' (ключ — имя кромки),
// 'hw:*' (путь вычисляется из subcategory/brand). Писать путь в копию
// бессмысленно — после ближайшей перерисовки изменение исчезнет, поэтому
// адресуем позицию так же, как инлайн-редактирование ячеек (libFindItem по
// group + ключу/коду).
function libRealItemOf(entry) {
  const it = (entry && entry.item) || null;
  if (!it) return null;
  // 'modplace' — карточка «Базы модулей»: у неё нет записи в catalog.js,
  // «настоящий» объект — размещение в state.libModOverrides/libModPlacements
  // (см. libModRealPlacement).
  if (entry.group === 'modplace') return libModRealPlacement(it.key);
  const key = it.key !== undefined ? it.key : it.code;
  return libFindItem(entry.group, key) || null;
}

// Записывает позиции НОВЫЙ путь в дереве — единственная точка, где вообще
// меняется item.categoryPath. Флаг categoryPathEdited защищает правку от
// отката заводским каталогом при следующей загрузке (см. mergeCatalogItem).
function libSetEntryPath(entry, newPath) {
  const it = libRealItemOf(entry);
  if (!it) return;
  it.categoryPath = newPath.slice();
  it.categoryPathEdited = true;
  // У фурнитуры «фирма» исторически лежит в отдельном поле (brand у LIFTS,
  // subcategory у остальных, см. libHardwareTopEntries/libAddHardwareRow).
  // Само дерево теперь читает categoryPath, но поле держим в синхроне с
  // последним сегментом пути, чтобы в данных не осталось названия старой,
  // уже несуществующей подкатегории.
  if (String(entry.group).indexOf('hw:') === 0) {
    const last = newPath.length ? newPath[newPath.length - 1] : '';
    const field = it.category === 'mechanism' ? 'brand' : 'subcategory';
    // Путь пуст (позиция лежит прямо в корне категории) — фирмы у неё нет, и
    // поле надо УБРАТЬ, а не записать в него пустую строку: пустая строка
    // осталась бы мусором в данных и уехала бы в снимок каталога на сервер.
    if (last) it[field] = last; else delete it[field];
  }
}

// Переезд ключей UI-состояния вслед за узлом: свёрнутость поддерева
// (state.libCollapsed), фокус на листе (state.libActiveLeaf) и свой порядок
// подкатегорий (state.libNodeOrder, см. libRemapNodeOrder ниже) адресуются
// ПУТЁМ узла — после переименования/переноса старые ключи указывали бы в
// пустоту (перенесённая ветка схлопывалась бы, сфокусированный лист
// показывал бы пустую таблицу, а расставленный руками порядок её детей
// пропал бы).
function libRemapTreeStateKeys(topCode, oldPath, newPath) {
  if (!oldPath.length) return;
  const oldPrefix = libNodeKey(topCode, oldPath);
  const newPrefix = libNodeKey(topCode, newPath);
  const nextCollapsed = {};
  Object.keys(state.libCollapsed).forEach((k) => {
    const moved = (k === oldPrefix || k.indexOf(oldPrefix + '::') === 0);
    nextCollapsed[moved ? newPrefix + k.slice(oldPrefix.length) : k] = state.libCollapsed[k];
  });
  state.libCollapsed = nextCollapsed;
  const oldKey = oldPath.join('::');
  const active = state.libActiveLeaf[topCode];
  if (active && (active === oldKey || active.indexOf(oldKey + '::') === 0)) {
    state.libActiveLeaf[topCode] = newPath.join('::') + active.slice(oldKey.length);
  }
  libRemapNodeOrder(topCode, oldPath, newPath);
  // Чистки осиротевших записей порядка (libPruneNodeOrder) здесь НЕТ
  // намеренно: посреди переноса дерево в промежуточном состоянии — родитель,
  // из которого только что ушёл последний ребёнок, ещё не возвращён
  // заглушкой (libKeepOrphanParent), и прун вычеркнул бы его имя из порядка
  // деда, после чего вернувшаяся категория уехала бы в конец списка.
  // Поэтому прун зовут САМИ операции, когда дерево уже устоялось, —
  // libRenameNode/libMoveNode/libDeleteNode.
}

// Та же операция для карты своего порядка (state.libNodeOrder), у которой
// ПУТЬ узла встречается в двух видах сразу — и как ключ (порядок ЕГО детей),
// и как имя внутри списка РОДИТЕЛЯ. Обе стороны чинятся тут:
//  1) ключи самого узла и всего, что лежало под ним, переписываются на новый
//     путь — иначе расставленный порядок детей перенесённой ветки пропал бы;
//  2) имя в списке родителя: при ПЕРЕИМЕНОВАНИИ меняется на месте (узел
//     остаётся там же, где стоял), при ПЕРЕНОСЕ убирается из старого списка —
//     на новое место его ставит libPlaceChildAt (см. libMoveNode), который
//     один знает нужную позицию.
function libRemapNodeOrder(topCode, oldPath, newPath) {
  const byTop = state.libNodeOrder[topCode];
  if (!byTop) return;
  const oldKey = oldPath.join('::');
  const newKey = newPath.join('::');
  // Object.create(null) — та же причина, что и в libPlaceChildAt: ключ
  // собирается из названий категорий, введённых пользователем, и «__proto__»
  // в обычном объекте не стал бы собственным свойством.
  const next = Object.create(null);
  Object.keys(byTop).forEach((k) => {
    const moved = (k === oldKey || k.indexOf(oldKey + '::') === 0);
    next[moved ? newKey + k.slice(oldKey.length) : k] = byTop[k];
  });
  const oldParent = oldPath.slice(0, -1).join('::');
  const newParent = newPath.slice(0, -1).join('::');
  const list = next[oldParent];
  if (Array.isArray(list)) {
    const at = list.indexOf(oldPath[oldPath.length - 1]);
    if (at >= 0) {
      if (oldParent === newParent) list[at] = newPath[newPath.length - 1];
      else list.splice(at, 1);
    }
  }
  state.libNodeOrder[topCode] = next;
}

// Меняет начало пути с oldPath на newPath у ВСЕГО, что лежит в узле или
// глубже: у реальных позиций каталога (см. libSetEntryPath) и у пустых
// категорий-заглушек (state.libExtraNodes — без них пустая подкатегория
// просто исчезла бы при переносе родителя). Сохранение на сервере —
// на вызывающей стороне (libRenameNode/libMoveNode), чтобы не слать
// два запроса подряд.
function libRepathNode(topCode, oldPath, newPath) {
  const depth = oldPath.length;
  const inside = (p) => p.length >= depth && oldPath.every((seg, i) => p[i] === seg);
  const rebuilt = (p) => newPath.concat(p.slice(depth));
  libTopEntries(topCode).forEach((e) => {
    const p = (e.item && e.item.categoryPath) || [];
    if (inside(p)) libSetEntryPath(e, rebuilt(p));
  });
  // Пустой массив здесь не заводим: раньше ЛЮБОЕ переименование создавало
  // state.libExtraNodes['hw:<cat>'] = [], и эти пустые ключи уезжали в снимок
  // каталога на сервер (см. snapshotCatalogCollections), ничего не значая.
  const extra = state.libExtraNodes[topCode];
  if (extra && extra.length) state.libExtraNodes[topCode] = extra.map((p) => (inside(p) ? rebuilt(p) : p));
  libRemapTreeStateKeys(topCode, oldPath, newPath);
}

// Переименование узла (значок ✎ в libTreeRowHtml) — тот же путь, но с другим
// последним сегментом. Особый случай — КОРЕНЬ дерева (path пуст): у ВСТРОЕННЫХ
// разделов «Материалов»/«Дверей» переименования нет вовсе (набор фиксирован,
// тип товара завязан на группу каталога), а у категории «Фурнитуры» и у СВОИХ
// категорий «Материалов»/«Дверей» (кнопка-плитка «Добавить категорию») меняется
// ТОЛЬКО подпись на экране (state.libHwCatLabels/libMatCatLabels/
// libFacCatLabels) — сам ключ категории, от которого у фурнитуры зависит
// подбор в расчёте (item.category), остаётся прежним.
function libRenameNode(topCode, path, newName) {
  newName = libCleanNodeName(newName);
  if (!newName) return;
  if (!path.length) {
    if (topCode.indexOf('hw:') === 0) {
      const catKey = topCode.slice(3);
      // Та же проверка на дубликат ПОДПИСИ и то же сообщение, что и при
      // создании своей категории (см. libAddHwCategory): ключи у категорий
      // разные всегда, а вот двух одинаково названных «Петель» в списке
      // пользователь не различит.
      const busy = libHwCategoryKeys()
        .filter((k) => k !== catKey)
        .map((k) => libHwCategoryLabel(k).toLowerCase());
      if (busy.indexOf(newName.toLowerCase()) >= 0) {
        window.alert('Категория с таким названием уже есть.');
        return;
      }
      state.libHwCatLabels[catKey] = newName;
      scheduleCatalogSave();
      return;
    }
    // Своя категория «Материалов»/«Дверей» — та же проверка на дубликат
    // ПОДПИСИ среди ВСЕХ разделов вкладки (встроенных и своих), что и у
    // фурнитуры выше, только источник подписей другой (см.
    // libTopCategoryDef/libMatCategoryLabel/libFacCategoryLabel).
    if (topCode.indexOf('matcustom-') === 0 || topCode.indexOf('faccustom-') === 0) {
      const tabKey = topCode.indexOf('matcustom-') === 0 ? 'materials' : 'facades';
      const labels = tabKey === 'materials' ? state.libMatCatLabels : state.libFacCatLabels;
      const busy = libTabTopCodesRaw(tabKey)
        .filter((c) => c !== topCode)
        .map((c) => { const def = libTopCategoryDef(tabKey, c); return def ? def.title.toLowerCase() : ''; });
      if (busy.indexOf(newName.toLowerCase()) >= 0) {
        window.alert('Категория с таким названием уже есть.');
        return;
      }
      labels[topCode] = newName;
      scheduleCatalogSave();
      return;
    }
    // Своя категория «Базы модулей» — в отличие от «Материалов»/«Дверей»
    // выше подпись хранится прямо в state.libModCustomGroups (та же форма,
    // что и раньше у пилюль, см. libAddModuleGroup), не в отдельной карте
    // labels. Группа PRESETS сюда не доходит — значка ✎ у неё нет (см.
    // libTreeRowHtml), return — только подстраховка.
    if (topCode.indexOf('mod:') === 0) {
      const key = topCode.slice(4);
      if (libModTopIsBuiltin(key)) return;
      const group = (state.libModCustomGroups || []).find((g) => g.key === key);
      if (!group) return;
      const busy = PRESETS.map((g) => g.name.toLowerCase())
        .concat((state.libModCustomGroups || []).filter((g) => g.key !== key).map((g) => g.name.toLowerCase()));
      if (busy.indexOf(newName.toLowerCase()) >= 0) {
        window.alert('Категория с таким названием уже есть.');
        return;
      }
      group.name = newName;
      scheduleCatalogSave();
      return;
    }
    return;
  }
  libRepathNode(topCode, path, path.slice(0, -1).concat([newName]));
  // Дерево устоялось — можно убрать записи порядка, оставшиеся от старых
  // путей (сам libRepathNode этого не делает намеренно, см. комментарий в
  // libRemapTreeStateKeys).
  libPruneNodeOrder(topCode);
  scheduleCatalogSave();
}

// Перенос узла в другого родителя (значок ⇄, см. openLibTreeMoveMenu, и
// бросок узла при перетаскивании, см. libDragDrop) — newParentPath всегда из
// ТОГО ЖЕ раздела (см. libMoveTargets: между разными корневыми разделами
// переносить нельзя, это сменило бы тип товара/ключ категории, от которого
// зависит расчёт), пустой массив — «в корень раздела».
// Конфликт имён решаем ОТКАЗОМ с понятным сообщением, а не молчаливым
// слиянием двух категорий: слияние необратимо (обратно их уже не разделить
// одним кликом), а переименовать одну из них пользователь может сам.
// anchor — рядом с кем встать среди детей нового родителя: { ref: 'имя
// соседа', before: true|false }. Не передан — в конец: так ведёт себя и меню
// ⇄, и бросок ВНУТРЬ узла при перетаскивании. Передаём именно СОСЕДА, а не
// готовый номер позиции: номер пришлось бы считать заранее (в момент
// наведения), а к моменту применения список соседей уже другой — см.
// libChildInsertIndex.
// Возвращает true, если перенос состоялся (перетаскиванию нужно знать, что
// дальше делать: на отказе из-за дубликата имени порядок трогать нельзя).
function libMoveNode(topCode, path, newParentPath, anchor) {
  const name = path[path.length - 1];
  const busy = libChildSegments(topCode, newParentPath).map((s) => s.toLowerCase());
  if (busy.indexOf(String(name).toLowerCase()) >= 0) {
    const where = newParentPath.length ? `«${newParentPath.join(' › ')}»` : 'корне раздела';
    window.alert(`В ${where} уже есть категория «${name}». Сначала переименуйте одну из них, потом переносите.`);
    return false;
  }
  const newPath = newParentPath.concat([name]);
  const oldParent = path.slice(0, -1);
  libRepathNode(topCode, path, newPath);
  // Родитель, который существовал ТОЛЬКО за счёт этого ребёнка (своих
  // позиций нет, в заглушках не числится), после переноса исчез бы из дерева
  // — со стороны это выглядит как «категория пропала сама собой».
  // ВАЖНО, что это происходит ДО расчёта места и до чистки порядка ниже:
  // пока заглушка не вернулась, дерево неполное, и любой расчёт по нему
  // (номер позиции, живые ли записи порядка) отвечал бы про промежуточное
  // состояние, а не про итоговое.
  libKeepOrphanParent(topCode, oldParent);
  // Место среди новых соседей задаём явно, а не полагаемся на порядок
  // появления в данных: он идёт от порядка позиций в catalog.js, и
  // перенесённая ветка вклинилась бы в середину списка непредсказуемо.
  // Номер позиции считаем ЗДЕСЬ, по уже перестроенному дереву (см.
  // libChildInsertIndex), а не берём заранее посчитанным снаружи.
  const index = anchor ? libChildInsertIndex(topCode, newParentPath, name, anchor.ref, anchor.before) : null;
  libPlaceChildAt(topCode, newParentPath, name, index);
  // Теперь дерево окончательное — самое время выбросить записи порядка,
  // оставшиеся от старых путей (см. комментарий в libRemapTreeStateKeys).
  libPruneNodeOrder(topCode);
  // Показываем результат там, куда перенесли: раскрываем сам раздел и весь
  // путь до перенесённого узла включительно, иначе он «пропал бы» внутри
  // свёрнутого родителя и выглядело бы это как потеря категории.
  state.libCatOpen[topCode] = true;
  for (let i = 1; i <= newPath.length; i += 1) {
    state.libCollapsed[libNodeKey(topCode, newPath.slice(0, i))] = false;
  }
  scheduleCatalogSave();
  renderLibraryPanel();
  return true;
}

// Ветка, которая держалась только на своих детях (сама позиций не имеет и в
// state.libExtraNodes не записана), после ухода последнего ребёнка (перенос
// ⇄ или удаление ×) пропала бы из дерева вместе с ним. Оставляем её пустой
// заглушкой — пользователь сам решит, удалить её значком × или наполнить
// заново. Сохранение на сервере — на вызывающей стороне (она всё равно зовёт
// scheduleCatalogSave после своей правки).
function libKeepOrphanParent(topCode, parentPath) {
  if (!parentPath || !parentPath.length) return;
  const stillThere = libAllPaths(topCode)
    .some((p) => p.length >= parentPath.length && parentPath.every((seg, i) => p[i] === seg));
  if (stillThere) return;
  if (!state.libExtraNodes[topCode]) state.libExtraNodes[topCode] = [];
  state.libExtraNodes[topCode].push(parentPath.slice());
}

// Все узлы дерева раздела (каждый путь и каждый его префикс, без повторов) —
// нужны списку «куда перенести» (libMoveTargets ниже). Набор тот же, что и
// раньше, а порядок — обхода дерева сверху вниз: родитель, потом его дети.
// Собираем именно рекурсией по libChildSegments, а не проходом по плоским
// путям, чтобы список целей наследовал единственное правило порядка детей
// («Без бренда» последний, см. libChildSegments) — иначе в меню «Перенести
// … в:» ведро без фирмы снова оказалось бы в середине списка брендов.
function libTreeAllNodePaths(topCode) {
  const out = [];
  const walk = (path) => {
    libChildSegments(topCode, path).forEach((seg) => {
      const child = path.concat([seg]);
      out.push(child);
      walk(child);
    });
  };
  walk([]);
  return out;
}

// Возможные новые родители узла path: «в корень раздела» ([]) + все узлы
// ЭТОГО ЖЕ раздела, кроме самого узла (перенос в себя), его потомков (цикл:
// ветка оказалась бы внутри самой себя) и его текущего родителя (перенос в
// никуда). Пустой результат — переносить некуда, меню так и скажет.
function libMoveTargets(topCode, path) {
  const selfKey = path.join('::');
  const parentKey = path.slice(0, -1).join('::');
  const name = path[path.length - 1];
  // Ветка с материалами фасадов (см. libSubtreeHasSheetFacade) обязана
  // остаться под «плитным» корневым сегментом — иначе её позиции молча
  // уедут с «Материалов» на вкладку «Двери». Корневым сегментом результата
  // у переноса «в корень раздела» становится имя самого узла, у переноса
  // внутрь цели — первый сегмент цели.
  const lockSheetFacade = libSubtreeHasSheetFacade(topCode, path);
  const rootAllowed = (rootSeg) => !lockSheetFacade || SHEET_FACADE_SUBCATS.indexOf(rootSeg) >= 0;
  const targets = (parentKey === '' || !rootAllowed(name)) ? [] : [[]];
  libTreeAllNodePaths(topCode).forEach((p) => {
    const key = p.join('::');
    if (key === selfKey || key.indexOf(selfKey + '::') === 0) return;
    if (key === parentKey) return;
    if (!rootAllowed(p[0])) return;
    targets.push(p);
  });
  return targets;
}

// Лежат ли под узлом позиции «Видов фасадов», попавшие в дерево «Листовых
// материалов»? Такие позиции физически хранятся в FACADE_MATERIALS, а к
// «Материалам» их относит ТОЛЬКО первый сегмент пути (см.
// SHEET_FACADE_SUBCATS/libTopEntries: «ДСП»/«МДФ-плита»/«Шпонированные
// плиты»). Перенос их ветки под чужой корневой сегмент сменил бы
// categoryPath[0], и позиции исчезли бы из «Материалов», всплыв на вкладке
// «Двери», — со стороны это выглядит как потеря категории. Поэтому список
// целей переноса (libMoveTargets выше) такие цели не предлагает, а
// openLibTreeMoveMenu объясняет, почему их там нет.
function libSubtreeHasSheetFacade(topCode, path) {
  if (topCode !== 'sheet') return false;
  return libTopEntries(topCode).some((e) => {
    if (e.group !== 'facade') return false;
    const p = (e.item && e.item.categoryPath) || [];
    return p.length >= path.length && path.every((seg, i) => p[i] === seg);
  });
}

// ---------------------------------------------------------------------------
// Перенос ОДНОЙ ПОЗИЦИИ в другой узел дерева (значок ⇄ в строке таблицы, см.
// libRowMoveIcHtml/openLibRowMoveMenu) — младший брат переноса узла целиком
// (libMoveNode выше). Раньше переносить умели только узлы: завести
// подкатегорию «Blum» внутри «Петель» было можно, а перетащить в неё уже
// существующие позиции — нет, приходилось заводить их заново руками.
// ---------------------------------------------------------------------------

// Ключ позиции в её объекте/массиве каталога — ровно то же правило, по
// которому адресуется libRealItemOf (it.key у 'edge' и всей фурнитуры, где
// каталог хранит позиции объектом {ключ → позиция} и сам объект своего ключа
// не знает; it.code у остальных). Нужен потому, что значок ⇄ несёт в разметке
// именно ключ, а не индекс строки: строки таблицы фильтруются и сортируются
// (см. libFilterRowsCache/applyColumnFilterAndSort), да и сам item у части
// разделов — одноразовая копия, по которой позицию потом не найти.
function libEntryKeyOf(entry) {
  const it = (entry && entry.item) || null;
  if (!it) return '';
  return it.key !== undefined ? it.key : it.code;
}

// Запись дерева { group, item } по паре group+key — обратная операция к
// libEntryKeyOf: по данным из значка ⇄ находит позицию заново на момент
// КЛИКА, а не на момент отрисовки таблицы.
function libFindTreeEntry(topCode, group, key) {
  return libTopEntries(topCode)
    .find((e) => e.group === group && String(libEntryKeyOf(e)) === String(key)) || null;
}

// Возможные цели переноса ПОЗИЦИИ: корень категории + все узлы ЭТОГО ЖЕ
// раздела, кроме того, где позиция лежит сейчас (перенос в никуда).
// Потомков, в отличие от переноса узла (libMoveTargets), исключать не надо —
// у позиции их нет. Часть целей отсекает libRowSheetFacadeLock ниже.
// Каждая цель прогоняется через libEntryTargetPath: положить позицию НА
// узел, у которого есть подкатегории (в том числе на корень раздела),
// нельзя — это нарушило бы инвариант дерева, и ближайшая же миграция
// (libNormalizeOwnEntries) молча увезла бы её в «Без бренда». Поэтому такую
// цель сразу подменяем на её «Без бренда»: в списке видно то, что реально
// произойдёт. Дубликаты после подмены (сам узел «Без бренда» и его родитель
// дают один и тот же путь) убираем по ключу пути.
// Обход — рекурсией СНИЗУ ВВЕРХ (сначала подкатегории узла, потом сам узел):
// так подменённая цель родителя встаёт ПОСЛЕ его брендов, а не перед ними —
// то же правило, что и у порядка детей в дереве (см. libChildSegments).
// Ведро корня раздела по той же причине оказывается в самом низу списка.
// Цели переноса ПОЗИЦИИ — { top, path }: код дерева и путь в нём.
// На «Фурнитуре» это деревья ВСЕХ категорий вкладки, а не только своей:
// отдельный полкодержатель должен уметь переехать в «Крепёж и метизы». Так
// можно, потому что item.category у фурнитуры на расчёт не влияет —
// спецификация адресует позиции по ключам каталога (HARDWARE_PRICES.<ключ>),
// а категория задаёт только раскладку в «Библиотеке».
// На «Материалах» и «Дверях» цели по-прежнему ограничены своим разделом:
// там раздел определяет ТИП товара (декор/кромка/стекло/столешница), и
// перенос между ними сменил бы саму суть позиции (см. также
// libRowSheetFacadeLock — ограничение по материалам фасадов внутри вкладки).
function libRowMoveTargets(topCode, entry) {
  // «База модулей» — как «Фурнитура»: карточка может переехать в ЛЮБУЮ
  // группу дерева, а не только внутри своей (у модуля нет «типа товара»,
  // который перенос между группами мог бы случайно сменить).
  const codes = String(topCode).indexOf('hw:') === 0 ? libTabTopCodes('hardware')
    : String(topCode).indexOf('mod:') === 0 ? libTabTopCodes('modules')
    : [topCode];
  const out = [];
  codes.forEach((code) => {
    libRowMoveTargetsIn(code, entry, code === topCode)
      .forEach((path) => out.push({ top: code, path }));
  });
  return out;
}

// Подпись цели в меню. Внутри своей категории — привычный путь («Blum» или
// «В корень категории»), в чужой — обязательно с названием категории: в одном
// списке рядом лежат «Blum» из «Петель» и «Blum» из «Механизмов», и без
// категории их не различить.
function libRowMoveTargetLabel(topCode, target, rootLabel) {
  const path = target.path || [];
  if (target.top === topCode) return path.length ? path.join(' › ') : rootLabel;
  const catLabel = String(target.top).indexOf('hw:') === 0
    ? libHwCategoryLabel(target.top.slice(3))
    : String(target.top).indexOf('mod:') === 0
      ? libModTopLabel(target.top.slice(4))
      : target.top;
  return path.length ? catLabel + ' › ' + path.join(' › ') : catLabel;
}

// Цели внутри ОДНОГО дерева. isCurrent — это дерево, в котором позиция лежит
// сейчас: только там имеет смысл исключать её нынешнее место.
function libRowMoveTargetsIn(topCode, entry, isCurrent) {
  const curKey = isCurrent ? ((entry.item && entry.item.categoryPath) || []).join('::') : null;
  const lock = libRowSheetFacadeLock(topCode, entry);
  const rootAllowed = (rootSeg) => {
    const isSheetSeg = SHEET_FACADE_SUBCATS.indexOf(rootSeg) >= 0;
    if (lock === 'sheet') return isSheetSeg;
    if (lock === 'facade') return !isSheetSeg;
    return true;
  };
  // Пустой путь («В корень категории») запрещён только при блокировке
  // 'sheet': первого сегмента у него нет вовсе, и позиция уехала бы на
  // «Двери». При блокировке 'facade' он, наоборот, безопасен — «плитным» от
  // этого не станет. Подменённый корень (['Без бренда']) проверяется как
  // обычный путь, по своему первому сегменту, — и при блокировке 'sheet'
  // так же не проходит.
  const allowed = (p) => (p.length ? rootAllowed(p[0]) : lock !== 'sheet');
  const targets = [];
  const seen = {};
  const add = (p) => {
    const key = p.join('::');
    if (key === curKey || seen[key] || !allowed(p)) return;
    seen[key] = true;
    targets.push(p);
  };
  // У листа libEntryTargetPath вернёт его самого, у ветки — её «Без бренда»;
  // добавляем ПОСЛЕ детей, поэтому ведро всегда ниже брендов.
  const walk = (path) => {
    libChildSegments(topCode, path).forEach((seg) => walk(path.concat([seg])));
    add(libEntryTargetPath(topCode, path));
  };
  walk([]);
  return targets;
}

// Куда позицию переносить НЕЛЬЗЯ из-за того, что её принадлежность вкладке
// определяется ПЕРВЫМ сегментом пути — та же связка, что описана у
// libSubtreeHasSheetFacade, только для одной позиции и сразу с обеих сторон:
//   'sheet'  — материал фасада, показанный в дереве «Листовых материалов»
//              (группа 'facade' в разделе 'sheet'): его первый сегмент обязан
//              остаться «плитным» (SHEET_FACADE_SUBCATS), иначе позиция молча
//              уедет с «Материалов» на вкладку «Двери»;
//   'facade' — зеркальная дыра на самой вкладке «Двери»: пользователь волен
//              завести там корневую категорию с названием ровно «ДСП»/
//              «МДФ-плита»/«Шпонированные плиты», и перенос в неё так же
//              молча увёз бы позицию в обратную сторону — на «Материалы»
//              (см. libTopEntries: раздел позиции целиком выводится из
//              categoryPath[0], отдельного поля «вкладка» у неё нет);
//   ''       — ограничений нет.
function libRowSheetFacadeLock(topCode, entry) {
  if (topCode === 'sheet' && entry.group === 'facade') return 'sheet';
  if (topCode === 'facade') return 'facade';
  return '';
}

// «Плитные» корневые сегменты списком для подсказок меню переноса. Собираем
// из самой константы, а не пишем в тексте руками: подсказку показывают ДВА
// разных меню (узел и позиция), и при правке SHEET_FACADE_SUBCATS тексты
// разъехались бы с реальным поведением. Названия в кавычках оставлены в
// именительном падеже — иначе их не подставить из константы механически.
function libSheetFacadeSubcatsText() {
  return SHEET_FACADE_SUBCATS.map((s) => `«${esc(s)}»`).join(', ');
}

// Пояснение, почему часть целей в меню переноса ПОЗИЦИИ не показана (см.
// libRowSheetFacadeLock). Без него короткий список выглядел бы как сбой.
function libRowMoveHintHtml(topCode, entry) {
  const lock = libRowSheetFacadeLock(topCode, entry);
  const list = libSheetFacadeSubcatsText();
  if (lock === 'sheet') {
    return `<div class="lib-move-hint">Это материал фасада — переносить его можно только внутрь разделов ${list}. Иначе позиция ушла бы с «Материалов» на вкладку «Двери».</div>`;
  }
  // На «Дверях» ограничение действует всегда, но сказать о нём есть смысл,
  // только если такие категории там реально заведены: иначе подсказка висела
  // бы в КАЖДОМ меню, объясняя отсутствие целей, которых и так нет.
  const hasSheetNamedNode = libTreeAllNodePaths(topCode).some((p) => SHEET_FACADE_SUBCATS.indexOf(p[0]) >= 0);
  if (lock === 'facade' && hasSheetNamedNode) {
    return `<div class="lib-move-hint">Категории ${list} здесь недоступны: по такому названию материал относят к «Листовым материалам», и позиция ушла бы с «Дверей» туда.</div>`;
  }
  return '';
}

// Сам перенос позиции. Путь пишем единственной точкой записи categoryPath
// (libSetEntryPath), как и перенос узла.
// target — { top, path }: дерево, в которое переносим, и путь в нём (см.
// libRowMoveTargets). На «Фурнитуре» top может быть ДРУГОЙ категорией, тогда
// у позиции меняется ещё и item.category — по нему дерево раскладывает
// позиции (libHardwareTopEntries). Сама позиция при этом остаётся в своей
// коллекции каталога (HARDWARE_PRICES/HANDLES/LIFTS/FASTENER_PRICES) —
// переносить её между коллекциями не нужно и нельзя: по ключу в этой
// коллекции её находит расчёт.
function libMoveEntry(topCode, group, key, target) {
  const targetTop = (target && target.top) || topCode;
  const targetPath = ((target && target.path) || []).slice();
  const entry = libFindTreeEntry(topCode, group, key);
  if (!entry) return;
  const oldPath = ((entry.item && entry.item.categoryPath) || []).slice();
  if (targetTop !== topCode && String(targetTop).indexOf('hw:') === 0) {
    const it = libRealItemOf(entry);
    if (!it) return;
    it.category = targetTop.slice(3);
    // «Фирма» у фурнитуры лежит в РАЗНЫХ полях: у категории 'mechanism' — в
    // brand, у остальных — в subcategory (см. libSetEntryPath, оно же
    // запишет нужное поле следующей строкой). Поле «с другой стороны» после
    // смены категории осталось бы с названием старой фирмы — это мусор в
    // данных, убираем сразу.
    if (it.category === 'mechanism') delete it.subcategory; else delete it.brand;
  }
  // «База модулей»: аналогично 'hw:' выше, только меняется it.group — по
  // нему libModTopEntries раскладывает карточки на группы (см.
  // libModAllPlacements).
  if (targetTop !== topCode && String(targetTop).indexOf('mod:') === 0) {
    const it = libRealItemOf(entry);
    if (!it) return;
    it.group = targetTop.slice(4);
  }
  libSetEntryPath(entry, targetPath);
  // Узел, который держался ТОЛЬКО на этой позиции, после её ухода исчез бы
  // из дерева — со стороны это выглядит как «категория пропала сама собой»
  // (та же причина, что и при переносе узла, см. libKeepOrphanParent).
  libKeepOrphanParent(topCode, oldPath);
  // Показываем, КУДА уехала позиция. Таблица конечного листа видна только в
  // фокусе (см. state.libActiveLeaf/libNodeHtml — у листа в дереве своей
  // таблицы нет), поэтому на лист фокусируемся. Ветка целью не бывает вовсе
  // (libEntryTargetPath вместо неё отдаёт её «Без бренда»), так что второй
  // случай — только корень раздела без подкатегорий: его таблица видна прямо
  // в дереве, достаточно выйти из фокуса и раскрыть раздел.
  const targetIsLeaf = !!targetPath.length && !libChildSegments(targetTop, targetPath).length;
  if (targetIsLeaf) {
    state.libActiveLeaf[targetTop] = targetPath.join('::');
  } else {
    state.libActiveLeaf[targetTop] = null;
    state.libCatOpen[targetTop] = true;
    for (let i = 1; i <= targetPath.length; i += 1) {
      state.libCollapsed[libNodeKey(targetTop, targetPath.slice(0, i))] = false;
    }
  }
  // Целевая категория может быть вложена в другую (см. state.libTopParent) —
  // раскрываем всю цепочку её родителей, иначе результат переноса окажется
  // внутри свёрнутого раздела и будет выглядеть как пропажа позиции.
  let parentCode = libTopParentOf(libTabOfTopCode(targetTop), targetTop);
  while (parentCode) {
    state.libCatOpen[parentCode] = true;
    parentCode = libTopParentOf(libTabOfTopCode(targetTop), parentCode);
  }
  scheduleCatalogSave();
  renderLibraryPanel();
}

// Значок ⇄ «Перенести в другую категорию» в строке таблицы — тот же
// визуальный язык, что у значков узла дерева (класс .lib-tree-ic: обычный
// текст без рамки, проявляется по наведению на строку). Живёт ВНУТРИ ячейки
// «Наименование», абсолютным позиционированием у её правого края (см.
// .lib-row-move-ic в style.css): отдельная колонка под него забрала бы
// ширину у остальных (таблицы фиксированной ширины, table-layout:fixed +
// colgroup, см. libColgroup), а значок в потоке текста дёргал бы перенос
// длинного названия по словам в момент наведения.
// 'countertop' значка не получает вовсе: его categoryPath виртуальный,
// выводится из materialId/brand (см. libTopEntries), и запись пути просто
// не сохранилась бы — та же причина, по которой у него нет и значков дерева
// (см. комментарий над libTreeRowHtml).
// В режиме подбора материала для проекта (state.libPickTarget, см.
// openMaterialPicker) значка нет ни в одной таблице: пользователь сейчас
// ВЫБИРАЕТ материал, а не правит библиотеку, и клик по ⇄ потребовал бы от
// него авторизации (см. requireLibraryEditAuth) прямо посреди подбора.
function libRowMoveIcHtml(topCode, group, key) {
  if (!topCode || topCode === 'countertop') return '';
  if (state.libPickTarget) return '';
  return `<span class="lib-tree-ic lib-row-move-ic" data-row-move="1"`
    + ` data-move-top="${esc(topCode)}" data-move-group="${esc(group)}" data-move-key="${esc(key)}"`
    + ` title="Перенести в другую категорию">⇄</span>`;
}

// «+» узла дерева (не у самого глубокого листа — см. libTreeRowHtml) — та
// же логика подтверждения, что была у прежнего libAddSubcategory: prompt на
// название, пустой ввод — отмена, дубликат среди уже существующих ПРЯМЫХ
// детей (данные + плейсхолдеры) — alert и выход. Новый узел — пустая
// заглушка (см. state.libExtraNodes), сразу раскрываем родителя, чтобы он
// не потерялся среди свёрнутых.
function libAddChildNode(topCode, parentPath) {
  if (!requireLibraryEditAuth()) return;
  const name = libCleanNodeName(window.prompt('Название новой категории:'));
  if (!name) return;
  const existing = libChildSegments(topCode, parentPath).map((s) => s.toLowerCase());
  if (existing.indexOf(name.toLowerCase()) >= 0) {
    window.alert('Категория с таким названием уже есть.');
    return;
  }
  if (!state.libExtraNodes[topCode]) state.libExtraNodes[topCode] = [];
  state.libExtraNodes[topCode].push(parentPath.concat([name]));
  // Новая подкатегория встаёт СРАЗУ ПОСЛЕ той, что пользователь только что
  // раскрывал/фокусировал среди детей ЭТОГО ЖЕ родителя (см.
  // state.libLastFocusedChild), а не в конец списка — задача 2026-09-21.
  // libChildInsertIndex — та же функция, что считает место при перетаскивании
  // (см. libTreeDragEnd): movedName ещё не значится в чужом порядке, поэтому
  // безопасно передать его и для только что созданного узла. Ref не найден
  // (ничего не трогали, или сосед уже переименован/удалён) — оставляем как
  // раньше, порядок не трогаем, новый узел уйдёт в конец (см. libChildSegments).
  const parentKey = libNodeKey(topCode, parentPath);
  const ref = state.libLastFocusedChild[parentKey];
  if (ref) {
    const idx = libChildInsertIndex(topCode, parentPath, name, ref, false);
    if (idx != null) libPlaceChildAt(topCode, parentPath, name, idx);
  }
  state.libLastFocusedChild[parentKey] = name;
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
  if (!requireLibraryEditAuth()) return;
  // Пустой путь — это сам КОРЕНЬ раздела. Значок × там есть только у СВОЕЙ
  // категории (фурнитуры, «Материалов» или «Дверей», см. libTreeRowHtml), у
  // каждой — своя отдельная процедура удаления: убрать нужно не путь внутри
  // дерева, а саму категорию из соответствующего state.lib*CustomCats.
  if (!path.length) {
    if (topCode.indexOf('hw:') === 0) { libDeleteHwCategory(topCode); return; }
    if (topCode.indexOf('matcustom-') === 0) { libDeleteMaterialCategory(topCode); return; }
    if (topCode.indexOf('faccustom-') === 0) { libDeleteFacadeCategory(topCode); return; }
    if (topCode.indexOf('mod:') === 0) { libDeleteModuleTopCategory(topCode); return; }
    return;
  }
  if (libNodeHasItems(topCode, path)) {
    window.alert(topCode.indexOf('mod:') === 0
      ? 'Сначала удалите или перенесите модули из этой категории.'
      : 'Сначала удалите или перенесите позиции из этой категории — в ней есть товары.');
    return;
  }
  const extra = state.libExtraNodes[topCode] || [];
  state.libExtraNodes[topCode] = extra.filter((p) => !(p.length >= path.length && path.every((seg, i) => p[i] === seg)));
  // Удалили единственного ребёнка — сам родитель остаётся на месте (см.
  // libKeepOrphanParent): пользователь удалял подкатегорию, а не её.
  libKeepOrphanParent(topCode, path.slice(0, -1));
  // Узла больше нет — его запись в порядке соседей и порядок его собственных
  // детей уже ни к чему не относятся (см. libPruneNodeOrder).
  libPruneNodeOrder(topCode);
  scheduleCatalogSave();
  renderLibraryPanel();
}

// «+ Добавить категорию» вкладки «Фурнитура» (кнопка уровня вкладки, см.
// libLinkTopBarHtml) — СВОЯ корневая категория: обычный контейнер для
// позиций с ключом 'custom-<timestamp>'. Расчёт про такие ключи ничего не
// знает (см. комментарий у state.libHwCustomCats), поэтому заводить их
// безопасно в любом количестве. Проверка на дубликат — по ПОДПИСИ (ключ
// уникален всегда по построению): две одинаково названные категории в одном
// списке пользователь всё равно не различит.
function libAddHwCategory() {
  if (!requireLibraryEditAuth()) return;
  const name = libCleanNodeName(window.prompt('Название новой категории фурнитуры:'));
  if (!name) return;
  const busy = libHwCategoryKeys().map((k) => libHwCategoryLabel(k).toLowerCase());
  if (busy.indexOf(name.toLowerCase()) >= 0) {
    window.alert('Категория с таким названием уже есть.');
    return;
  }
  const key = 'custom-' + Date.now();
  state.libHwCustomCats.push(key);
  state.libHwCatLabels[key] = name;
  // Встаёт сразу после категории, которую пользователь только что трогал в
  // дереве этой вкладки — не в конец (см. libPlaceNewTopAfterFocused).
  libPlaceNewTopAfterFocused('hardware', 'hw:' + key);
  state.libCatOpen['hw:' + key] = true;   // новая категория сразу раскрыта — видно, куда добавлять позиции
  scheduleCatalogSave();
  renderLibraryPanel();
}

// Удаление СВОЕЙ корневой категории фурнитуры (× в её строке). Встроенную
// категорию сюда не пускаем совсем — по её ключу движок подбирает фурнитуру
// в расчёте, значка × у неё поэтому и нет (см. libTreeRowHtml), это лишь
// страховка. Непустую категорию не удаляем по той же причине, что и любой
// другой узел дерева с товарами (см. libDeleteNode выше): удаление
// нескольких позиций каталога разом одним кликом слишком легко сделать
// случайно, а отменить его нечем — сначала пусть уберёт позиции.
function libDeleteHwCategory(topCode) {
  if (topCode.indexOf('hw:') !== 0) return;
  const key = topCode.slice(3);
  if (libHwCategoryIsBuiltin(key)) {
    window.alert('Встроенную категорию фурнитуры удалить нельзя — по ней рассчитывается спецификация. Её можно только переименовать.');
    return;
  }
  if (libNodeHasItems(topCode, [])) {
    window.alert('Сначала удалите или перенесите позиции из этой категории — в ней есть товары.');
    return;
  }
  state.libHwCustomCats = (state.libHwCustomCats || []).filter((k) => k !== key);
  delete state.libHwCatLabels[key];
  delete state.libExtraNodes[topCode];
  // Свой порядок подкатегорий этой категории (см. state.libNodeOrder) — как
  // и заглушки выше: категории больше нет, а запись иначе осталась бы
  // навсегда и уезжала бы в каждый снимок каталога на сервер.
  delete state.libNodeOrder[topCode];
  // И место самой категории в порядке заголовков вкладки (см.
  // state.libTopOrder): libTabTopCodes несуществующий код и так отфильтрует,
  // но держать в снимке мусор незачем.
  if (Array.isArray(state.libTopOrder.hardware)) {
    state.libTopOrder.hardware = state.libTopOrder.hardware.filter((c) => c !== topCode);
  }
  // И вложенность (state.libTopParent): убираем и саму категорию, и ссылки
  // на неё как на родителя — вложенные в неё категории снова становятся
  // корневыми, а не пропадают вместе с ней.
  const parentMap = state.libTopParent.hardware;
  if (parentMap) {
    delete parentMap[topCode];
    Object.keys(parentMap).forEach((c) => { if (parentMap[c] === topCode) delete parentMap[c]; });
  }
  delete state.libCatOpen[topCode];
  delete state.libActiveLeaf[topCode];
  if (state.libHwPriceUnit) delete state.libHwPriceUnit[topCode];
  // Свёрнутость узлов удалённой категории адресуется её же topCode (см.
  // libNodeKey: '<topCode>::<путь>') — без уборки эти ключи копились бы в
  // state навсегда и «оживали» бы на новой категории с тем же topCode.
  const collapsedPrefix = topCode + '::';
  Object.keys(state.libCollapsed).forEach((k) => {
    if (k.indexOf(collapsedPrefix) === 0) delete state.libCollapsed[k];
  });
  scheduleCatalogSave();
  renderLibraryPanel();
}

// ---------------------------------------------------------------------------
// «Добавить категорию» вкладок «Материалы» и «Двери» (кнопка-плитка, см.
// libAddCatTileHtml) — тот же паттерн, что и libAddHwCategory/
// libDeleteHwCategory выше, СВОЯ корневая категория с ключом
// 'matcustom-<timestamp>'/'faccustom-<timestamp>'. В отличие от фурнитуры
// здесь нет понятия «встроенная нельзя удалить, можно только переименовать»
// — своя категория либо есть целиком (и удаляется целиком), либо её нет:
// встроенные четыре раздела «Материалов»/один раздел «Дверей» вообще не
// проходят через эти функции (у них нет ключа topCode с нужным префиксом).
// ---------------------------------------------------------------------------
function libAddMaterialCategory() {
  if (!requireLibraryEditAuth()) return;
  const name = libCleanNodeName(window.prompt('Название новой категории материалов:'));
  if (!name) return;
  // Дубликат проверяем среди ВСЕХ разделов вкладки (встроенных и своих) —
  // та же причина и тот же приём, что у libRenameNode.
  const busy = libTabTopCodesRaw('materials').map((c) => {
    const def = libTopCategoryDef('materials', c);
    return def ? def.title.toLowerCase() : '';
  });
  if (busy.indexOf(name.toLowerCase()) >= 0) {
    window.alert('Категория с таким названием уже есть.');
    return;
  }
  const key = 'matcustom-' + Date.now();
  state.libMatCustomCats.push(key);
  state.libMatCatLabels[key] = name;
  // Встаёт сразу после категории, которую пользователь только что трогал в
  // дереве этой вкладки — не в конец (см. libPlaceNewTopAfterFocused).
  libPlaceNewTopAfterFocused('materials', key);
  state.libCatOpen[key] = true;   // новая категория сразу раскрыта — видно, куда добавлять позиции
  scheduleCatalogSave();
  renderLibraryPanel();
}

function libDeleteMaterialCategory(topCode) {
  if (String(topCode).indexOf('matcustom-') !== 0) return;
  if (libNodeHasItems(topCode, [])) {
    window.alert('Сначала удалите или перенесите позиции из этой категории — в ней есть товары.');
    return;
  }
  state.libMatCustomCats = (state.libMatCustomCats || []).filter((c) => c !== topCode);
  delete state.libMatCatLabels[topCode];
  delete state.libExtraNodes[topCode];
  delete state.libNodeOrder[topCode];
  if (Array.isArray(state.libTopOrder.materials)) {
    state.libTopOrder.materials = state.libTopOrder.materials.filter((c) => c !== topCode);
  }
  const parentMap = state.libTopParent.materials;
  if (parentMap) {
    delete parentMap[topCode];
    Object.keys(parentMap).forEach((c) => { if (parentMap[c] === topCode) delete parentMap[c]; });
  }
  delete state.libCatOpen[topCode];
  delete state.libActiveLeaf[topCode];
  const collapsedPrefix = topCode + '::';
  Object.keys(state.libCollapsed).forEach((k) => {
    if (k.indexOf(collapsedPrefix) === 0) delete state.libCollapsed[k];
  });
  scheduleCatalogSave();
  renderLibraryPanel();
}

function libAddFacadeCategory() {
  if (!requireLibraryEditAuth()) return;
  const name = libCleanNodeName(window.prompt('Название новой категории фасадов:'));
  if (!name) return;
  const busy = libTabTopCodesRaw('facades').map((c) => {
    const def = libTopCategoryDef('facades', c);
    return def ? def.title.toLowerCase() : '';
  });
  if (busy.indexOf(name.toLowerCase()) >= 0) {
    window.alert('Категория с таким названием уже есть.');
    return;
  }
  const key = 'faccustom-' + Date.now();
  state.libFacCustomCats.push(key);
  state.libFacCatLabels[key] = name;
  // Встаёт сразу после категории, которую пользователь только что трогал в
  // дереве этой вкладки — не в конец (см. libPlaceNewTopAfterFocused).
  libPlaceNewTopAfterFocused('facades', key);
  state.libCatOpen[key] = true;
  scheduleCatalogSave();
  renderLibraryPanel();
}

function libDeleteFacadeCategory(topCode) {
  if (String(topCode).indexOf('faccustom-') !== 0) return;
  if (libNodeHasItems(topCode, [])) {
    window.alert('Сначала удалите или перенесите позиции из этой категории — в ней есть товары.');
    return;
  }
  state.libFacCustomCats = (state.libFacCustomCats || []).filter((c) => c !== topCode);
  delete state.libFacCatLabels[topCode];
  delete state.libExtraNodes[topCode];
  delete state.libNodeOrder[topCode];
  if (Array.isArray(state.libTopOrder.facades)) {
    state.libTopOrder.facades = state.libTopOrder.facades.filter((c) => c !== topCode);
  }
  const parentMap = state.libTopParent.facades;
  if (parentMap) {
    delete parentMap[topCode];
    Object.keys(parentMap).forEach((c) => { if (parentMap[c] === topCode) delete parentMap[c]; });
  }
  delete state.libCatOpen[topCode];
  delete state.libActiveLeaf[topCode];
  const collapsedPrefix = topCode + '::';
  Object.keys(state.libCollapsed).forEach((k) => {
    if (k.indexOf(collapsedPrefix) === 0) delete state.libCollapsed[k];
  });
  scheduleCatalogSave();
  renderLibraryPanel();
}

// «Добавить категорию» и «×» своей категории «Базы модулей» теперь часть
// общего дерева — см. libAddModuleGroup/libDeleteModuleTopCategory рядом с
// остальными функциями «Базы модулей» (libModAllPlacements и далее, начало
// файла).

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
// найденную. Вызывается и из libLeafTableHtml (материалы), и из
// libHardwareLeafTableHtml (фурнитура).
// Позиции, добавленные «по ссылке», свои пометки тут больше НЕ показывают:
// пользователь 2026-09-17 попросил убрать из таблиц длинное предупреждение
// парсера про диапазон цен («цена показана по нижней границе диапазона…
// вариантов: 12») — в готовой библиотеке оно только мешает. В форме
// «Добавить по ссылке» это же предупреждение осталось (.lib-link-price-note):
// там позиция ещё не сохранена и цену можно уточнить.
// Признак «пришла по ссылке» — it.sourceSiteId (id сайта-парсера, его ставят
// ТОЛЬКО libLinkSaveMaterial/libLinkSaveHardware и обновление цен), а НЕ
// it.sourceUrl: ссылка есть и у заводских позиций catalog.js — у тех самых
// GLASS/FAC-WOOD-FILON она ведёт на статью-источник цены, и по sourceUrl мы
// заодно спрятали бы их «приближённая — уточняйте у поставщика», которое
// показывать надо. Отсеиваем при ОТОБРАЖЕНИИ, а не только при сохранении,
// чтобы сохранённые раньше позиции (у них priceNote уже лежит в данных)
// перестали показывать эту строку сразу, без ручной чистки библиотеки.
// ОГРАНИЧЕНИЕ признака: «Обновить цены с сайта» проставляет sourceSiteId и
// встроенной позиции каталога (см. там же), так что заводская пометка у неё
// после обновления тоже спрячется. Сегодня это не всплывает: заводской
// priceNote есть только у четырёх customOrder-позиций (glassinterior.md и
// arama.md), а парсеров для этих доменов нет — обновление цен их не берёт.
// Если парсер такого сайта появится, хранить заводскую пометку нужно будет
// в отдельном поле, а не в общем priceNote.
function libPriceNoteHtml(items) {
  const withNote = items.find((it) => it && it.priceNote && !it.sourceSiteId);
  if (!withNote) return '';
  return `<p class="hint">Цена ${esc(withNote.priceNote)}.</p>`;
}

// Поля каталога, в которых реально лежит ЦЕНА позиции — ровно то, что может
// вернуть libPriceFieldOf у материалов ('sheetPrice' у листов и
// customOrder-позиций, 'pricePerMeter' у столешниц, 'price' у кромки), плюс
// 'price' у фурнитуры (см. libHardwareLeafTableHtml). Нужны, чтобы libSaveEdit
// отличала правку цены от правки названия/размеров/единицы измерения.
const LIB_PRICE_EDIT_FIELDS = ['price', 'sheetPrice', 'pricePerMeter'];

// Ручная правка цены снимает пометку о неточной цене (item.priceNote, см.
// libPriceNoteHtml выше): пользователь сам посмотрел цену и подтвердил её —
// даже если вписал то же самое число, это осознанное «я проверил», — значит
// ни предупреждение парсера про диапазон вариантов («цена от 19 до 38.5 MDL,
// вариантов: 12»), ни заводское «приближённая — уточняйте у поставщика»
// больше не про эту позицию.
// byUser — правка руками в таблице «Библиотеки» (см. libSaveEdit), а не
// обновление цен с сайта: только тогда дополнительно ставим флаг
// priceNoteCleared. Флаг нужен ВСТРОЕННЫМ позициям каталога (GLASS,
// FAC-WOOD-FILON и т.п.): у них priceNote задан прямо в catalog.js, то есть
// заводской «эталон» в принципе умеет принести пометку обратно при каждой
// загрузке страницы. Сегодня mergeCatalogItem берёт значения полей из
// сохранённого снимка (всё, кроме CATALOG_REFRESH_FIELDS), поэтому одного
// delete хватило бы и так — но флаг делает решение пользователя явным,
// переживает возможное расширение CATALOG_REFRESH_FIELDS и позволяет
// mergeCatalogItem защитить снятую пометку прямо (см. там же). У позиций,
// добавленных «по ссылке», заводского прототипа нет — им флаг безразличен.
// ОГРАНИЧЕНИЕ флага: он глушит у этой позиции не только ту пометку, что была
// на момент правки, а ЛЮБУЮ будущую из catalog.js. Сегодня все заводские
// priceNote — про приблизительность цены, и это правильно (цену пользователь
// уже подтвердил сам). Но если когда-нибудь в catalog.js появится пометка
// другого смысла («цена за комплект» и т.п.), тот, кто её добавит, должен
// знать: пользователь, однажды поправивший цену этой позиции, её не увидит —
// такую пометку нужно будет хранить в отдельном поле, а не в priceNote.
function libClearPriceNote(it, byUser) {
  if (!it || !it.priceNote) return;
  delete it.priceNote;
  if (byUser) it.priceNoteCleared = true;
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
// Признак 'area' — ТОЛЬКО it.customOrder (ровно то же поле, на которое
// делится specification.js, см. sheetArea/customOrder там) — раньше сюда
// же подмешивался it.unit === 'м²' как «более дешёвая» замена, но это
// ложный сигнал: сайт-источник может показывать цену листового материала
// «за м²» ради удобства (см. FAC-MDF/mobilier.md), при этом физический
// лист фиксированного размера у него есть и sheetW/sheetH обязаны быть
// заполнены — такая позиция обязана остаться 'sheet', иначе колонки
// «Длина»/«Ширина» пропадают из таблицы и становятся нередактируемыми,
// хотя сами данные на месте.
function libItemKind(group, it) {
  if (group === 'edge') return 'edge';
  if (group === 'countertop') return 'countertop';
  if (it && it.customOrder) return 'area';
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
// Цена в ячейке округляется до целого (без копеек) и получает валюту
// (curSym()) СПРАВА от числа — сама валюта раньше жила в заголовке столбца
// (см. libPriceUnitHeaderHtml), теперь только в каждой строке. Округление и
// валюта — только в displayText (см. opts.displayText у libEditCell): клик
// по ячейке для редактирования по-прежнему открывает точное нецелое
// сохранённое значение из data-raw, реальное it[field] не трогаем.
function libPriceCellHtml(group, key, kind, it, unit) {
  const effUnit = libPriceEffectiveUnit(kind, unit);
  if (libNativeUnitsOf(kind).indexOf(effUnit) >= 0) {
    const field = libPriceFieldOf(kind);
    const priceVal = it[field];
    const display = priceVal != null ? `${Math.round(priceVal)} ${curSym()}` : undefined;
    return libEditCell(group, key, field, 'number', priceVal, { displayText: display, extraClass: 'lib-price-cell' });
  }
  const val = libPriceValueForUnit(kind, it, effUnit);
  return `<td class="lib-price-cell">${val != null ? esc(`${Math.round(val)} ${curSym()}`) : '—'}</td>`;
}
// То же значение, что рисует libPriceCellHtml, но простой строкой — читает
// поповер сортировки/фильтра колонки «Цена» (см. openColumnFilterMenu/
// libFilterRowsCache): единственный источник правды для «что показано в
// ячейке» один и тот же для обеих функций (libPriceEffectiveUnit), включая
// округление и валюту.
function libPriceDisplayValue(kind, it, unit) {
  const effUnit = libPriceEffectiveUnit(kind, unit);
  if (libNativeUnitsOf(kind).indexOf(effUnit) >= 0) {
    const v = it[libPriceFieldOf(kind)];
    return v != null ? `${Math.round(v)} ${curSym()}` : '';
  }
  const val = libPriceValueForUnit(kind, it, effUnit);
  return val != null ? `${Math.round(val)} ${curSym()}` : '—';
}

// Единицы измерения цены — общий переключатель на ВСЮ «Библиотеку» (см.
// state.libPriceUnit): меняешь в шапке одной таблицы, пересчитываются все
// остальные открытые таблицы (renderLibraryPanel — полная перерисовка).
// 'native' стоит первым пунктом списка (порядок в select), но дефолт
// state.libPriceUnit — 'perM2' (см. там же); 'native' остаётся доступен для
// ручного переключения на просмотр «как на сайте»/за лист, без пересчёта
// (см. libPriceEffectiveUnit).
// Подписи единиц — теми же сокращениями, какими единицы записаны в самих
// позициях каталога и на соседней вкладке «Фурнитура» (см. LIB_UNIT_OPTIONS/
// LIB_HW_UNIT_OPTIONS): «шт» и «пог.м», без точки. Было «шт.»/«м.п.» — одна и
// та же единица подписывалась в двух соседних таблицах по-разному.
const LIB_PRICE_UNITS = [
  { id: 'native', label: 'как на сайте' },
  { id: 'perMeter', label: 'пог.м' },
  { id: 'perPiece', label: 'шт' },
  { id: 'perM2', label: 'м²' },
  { id: 'perSheet', label: 'лист' },
];
function libPriceUnitHeaderHtml() {
  const opts = LIB_PRICE_UNITS.map((u) => {
    const label = u.id === 'native' ? `Цена (${esc(u.label)})` : `Цена/${esc(u.label)}`;
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

// Тип листового материала в name не всегда совпадает по написанию с
// categoryPath[0] дерева (напр. «ЛДСП» в имени vs «ДСП» в дереве,
// «Алюминиевый» vs «Алюминий») — таблица ниже даёт варианты написания типа,
// встречающиеся в catalog.js, для каждого верхнего сегмента пути.
const SHEET_TYPE_NAME_ALIASES = {
  'ДСП': ['лдсп', 'дсп'],
  'МДФ-плита': ['мдф'],
  'Шпонированные плиты': ['мдф шпонированный', 'шпонированные плиты', 'шпон'],
  'ХДФ/ДВП': ['хдф', 'двп'],
  'Массив': ['массив'],
  'Алюминий': ['алюминиевый', 'алюминий'],
  'Стекло': ['стекло'],
};

// Короткое название для колонки «Наименование» (decors/back/facade/glass) —
// убирает из начала name тип материала и бренд, если они там буквально
// повторяют путь дерева categoryPath (уже виден в хлебных крошках над
// таблицей, см. libBreadcrumbHtml) — «ЛДСП Egger H1180 ST37 Дуб Халифакс
// натуральный» → «H1180 ST37 Дуб Халифакс натуральный». Само item.name НЕ
// трогаем — нужно как есть для спецификации/экспорта, это только
// отображение (тот же принцип, что у libCountertopShortName выше). Если имя
// не начинается с типа/бренда (как у части позиций ARAMA — «Фасад из
// массива с филёнкой» вообще без «Массив»/ARAMA в начале) — ничего не
// убираем, отдаём name как есть.
function libSheetShortName(it) {
  const name = String(it.name || '');
  const path = it.categoryPath;
  if (!path || !path.length) return name;
  let words = name.split(' ');
  const lower = words.map((w) => w.toLowerCase());
  const aliases = SHEET_TYPE_NAME_ALIASES[path[0]] || [];
  let matched = null;
  aliases.forEach((alias) => {
    if (matched != null) return;
    const aliasWords = alias.split(' ');
    if (aliasWords.length > lower.length) return;
    if (aliasWords.every((w, i) => lower[i] === w)) matched = aliasWords.length;
  });
  if (matched == null) return name;
  words = words.slice(matched);
  if (path[1] && words[0] && words[0].toLowerCase() === path[1].toLowerCase()) words = words.slice(1);
  const rest = words.join(' ').trim();
  if (!rest) return name;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
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
// (см. libLeafTableHtml — теперь это отдельная кнопка НАД таблицей, как
// «+ Добавить материал» под ней), чтобы <thead> ни в одном состоянии не
// нуждался в colspan/rowspan — тогда физическое число колонок в шапке и
// теле совпадает тривиально, само собой. Ширины 76px (Длина/Ширина/Толщина)
// и 82px (Цена) — раньше были 84/84/84/118px, рассчитаны под ЗАГЛАВНЫЕ
// (capslock, вес 600) подписи; после того как заголовки Длина/Ширина/
// Толщина визуально приравняли к «Цене» — вес 400, без капслока (см.
// .lib-table th.lib-char-col .dth-label в style.css, задача 2026-09-12) —
// подписи стали заметно уже (самая длинная, «Толщина», в браузере ≈45px), и
// колонки сузили следом: 76px = текст + отступ слева 5px + резерв под
// кнопку-треугольник 22px (.lib-th-filter) с небольшим запасом. «Цена»
// сужена до 82px — полный текст текущей опции select («Цена (как на
// сайте)») в неё уже не помещается и обрезается многоточием (см. overflow/
// text-overflow у .lib-price-unit-select) — так и задумано; более узкие
// значения (60-74px) заставляли нативную стрелку select налезать на текст
// без видимого «…», 82px — минимум, при котором ещё читается «Цен…».
// Освободившееся место уходит колонке «Наименование» (у неё нет явной
// ширины, см. выше) — так длинные названия decors умещаются в 2 строки, а
// не в 3+ (пример «H1180 ST37 Дуб Халифакс натуральный», см. catalog.js).
// suppliersVisible — колонка «Поставщик» (кнопка-тумблер «Поставщики», см.
// data-suppliers-toggle/state.libSuppliersVisible ниже) — независимый от
// collapsed переключатель: показывает, с какого сайта добавлена цена
// позиции (libSourceSiteLabel). Добавлена ПОСЛЕ «Цены», перед колонкой
// «Выбрать» — как и её <td> в libRowHtml.
function libColgroup(pickMode, collapsed, suppliersVisible) {
  const charCols = collapsed ? '' : `<col class="lib-char-col" style="width:76px"><col class="lib-char-col" style="width:76px"><col class="lib-char-col" style="width:76px">`;
  const supplierCol = suppliersVisible ? `<col class="lib-supplier-col" style="width:92px">` : '';
  return `<colgroup><col><col style="width:72px">`
    + charCols
    + `<col style="width:82px">`
    + supplierCol
    + `${pickMode ? '<col style="width:76px">' : ''}</colgroup>`;
}
// Заголовок — ОДНА строка <thead> (никаких rowspan/colspan, см. коммент у
// libColgroup выше — кнопка «Характеристики материала» больше не здесь), Длина/
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
// suppliersVisible — заголовок «Поставщик» (colIndex 5, см. libColgroup/
// libRowHtml выше и vals[5] в libFilterRowsCache ниже) — своя кнопка-
// треугольник сортировки/фильтра, тот же общий поповер openColumnFilterMenu.
function libTableHead(pickMode, collapsed, tableKey, suppliersVisible) {
  const filterBtn = (colIndex) => `<button type="button" class="dth-filter-btn" data-filter-key="${esc(tableKey)}" data-col="${colIndex}" title="Сортировка и фильтр">▾</button>`;
  const charsHeadCells = collapsed ? '' : `
      <th class="lib-char-col lib-th-filter" title="Длина, мм"><span class="dth-label">Длина</span>${filterBtn(1)}</th>
      <th class="lib-char-col lib-th-filter" title="Ширина, мм"><span class="dth-label">Ширина</span>${filterBtn(2)}</th>
      <th class="lib-char-col lib-th-filter" title="Толщина, мм"><span class="dth-label">Толщина</span>${filterBtn(3)}</th>`;
  const supplierHeadCell = suppliersVisible
    ? `<th class="lib-supplier-col lib-th-filter"><span class="dth-label">Поставщик</span>${filterBtn(5)}</th>`
    : '';
  return `<thead>
    <tr>
      <th class="lib-th-filter"><span class="dth-label">Наименование</span>${filterBtn(0)}</th>
      <th>Образец</th>
      ${charsHeadCells}
      <th class="lib-th-filter"><span class="dth-label">${libPriceUnitHeaderHtml()}</span>${filterBtn(4)}</th>
      ${supplierHeadCell}
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
// libColgroup). opts.collapsed — «Характеристики материала» (см. libLeafTableHtml):
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
  const suppliersVisible = !!opts.suppliersVisible;
  const unit = state.libPriceUnit;
  const sel = state.libSelectedRow;
  const isSelected = !!(sel && sel.group === group && sel.key === key);
  const searchText = String((group === 'edge' ? it.key : it.name) || '').toLowerCase();
  const dims = libDimsOf(kind, it);
  // Название кромки — ключ объекта EDGE_PRICES (см. catalog.js). Переименовывать
  // его на месте рискованно (specification.js читает EDGE_PRICES[type] по
  // значению из секции) — поэтому название НЕредактируемо, новая кромка
  // добавляется вводом уникального названия (см. libAddRow).
  const nameDisplay = group === 'edge' ? String(it.key || '') : group === 'countertop' ? libCountertopShortName(it) : libSheetShortName(it);
  // Значок ⇄ «перенести позицию» — в самой ячейке «Наименование» (см.
  // libRowMoveIcHtml, почему не отдельной колонкой). opts.moveTop — раздел
  // дерева, внутри которого можно переносить; его передаёт таблица
  // (libLeafTableHtml), сама строка своего раздела не знает: у объединённых
  // «Листовых материалов» строки одной таблицы приходят из decors/back/facade
  // одновременно, и group строки разделу не равен.
  const moveIc0 = libRowMoveIcHtml(opts.moveTop, group, libEntryKeyOf(entry));
  // FAC-ALU «Алюминиевый профиль (рамка)» — не лист, а вход в конструктор
  // алюминиевого фасада (см. openAluConstructorFromLibrary).
  const aluCtorBtn = group === 'facade' && key === 'FAC-ALU'
    ? ' <button type="button" class="link-btn lib-alu-open-ctor" data-alu-open-ctor="1" title="Открыть конструктор алюминиевого фасада для активной секции">Выбрать</button>' : '';
  const moveIc = moveIc0 + aluCtorBtn + libTexMissingHtml(group, it);
  const nameCell = group === 'edge'
    ? `<td${moveIc ? ' class="lib-name-cell"' : ''}>${esc(nameDisplay)}${moveIc}</td>`
    : libEditCell(group, key, 'name', 'text', it.name, { displayText: nameDisplay, afterHtml: moveIc, extraClass: moveIc ? 'lib-name-cell' : '' });
  const lenField = libLengthFieldOf(kind);
  const widField = libWidthFieldOf(kind);
  const lengthCell = collapsed ? '' : (lenField ? libDashEditCell(group, key, lenField, dims.length, 'lib-char-col') : '<td class="lib-char-col">—</td>');
  const widthCell = collapsed ? '' : (widField ? libDashEditCell(group, key, widField, dims.width, 'lib-char-col') : '<td class="lib-char-col">—</td>');
  const thicknessCell = collapsed ? '' : libDashEditCell(group, key, 'thickness', dims.thickness, 'lib-char-col');
  const priceCell = libPriceCellHtml(group, key, kind, it, unit);
  const priceDisplay = libPriceDisplayValue(kind, it, unit);
  // Подбор заполнения алюм. рамки — «Выбрать» только у подходящих профилю
  // материалов; у остальных строк ячейка пустая (колонка общая на таблицу).
  const pickAllowed = pickMode && libPickRowAllowed(opts.topCode, entry);
  // supplierDisplay — считается ВСЕГДА (даже когда колонка скрыта), как и
  // остальные vals ниже: applyColumnFilterAndSort может держать активный
  // фильтр/сортировку по колонке 5, пока сама колонка временно спрятана
  // тумблером «Поставщики» (см. libColgroup/libTableHead/state.libSuppliersVisible).
  const supplierDisplay = libSourceSiteLabel(it);
  const supplierCell = suppliersVisible
    ? `<td class="lib-supplier-col" title="${esc(supplierDisplay)}">${esc(supplierDisplay)}</td>`
    : '';
  const pickCell = pickMode
    ? (pickAllowed
      ? `<td><button type="button" class="link-btn lib-pick-btn" data-pick-group="${esc(group)}" data-pick-code="${esc(key)}">Выбрать</button></td>`
      : '<td></td>')
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
        supplierDisplay,
      ],
    });
  }
  return `
    <tr data-search="${esc(searchText)}" data-row-group="${esc(group)}" data-row-key="${esc(key)}"
        data-row-idx="${opts.rowIdx != null ? opts.rowIdx : ''}"
        class="${isSelected ? 'lib-row-selected' : ''}">
      ${nameCell}
      <td>${libSwatchHtml(group, key, it.image, it.sourceUrl)}</td>
      ${lengthCell}
      ${widthCell}
      ${thicknessCell}
      ${priceCell}
      ${supplierCell}
      ${pickCell}
    </tr>`;
}

// Подсказка на неактивной кнопке «− Удалить материал» / «− Удалить позицию»
// (см. libLeafTableHtml/libHardwareLeafTableHtml/libApplyRowSelection) — пока
// в таблице ничего не выделено кликом.
const LIB_ROW_DEL_HINT = 'Сначала выберите строку в таблице';

// Таблица позиций одного листа (или «своих» позиций ветки — см. HDF-8 в
// комментарии выше libTopEntries): фильтры → подсказка о примерной цене →
// таблица → «+ Добавить материал» / «− Удалить материал» (опц.).
// addGroupMap/addDefaultGroup решают, в какой массив каталога уйдёт новая
// позиция — см. libraryMaterialsBlock, там же объяснение выбора значения по
// умолчанию.
function libLeafTableHtml(topCode, path, entries, opts) {
  // У столешниц кнопка «Выбрать» появляется только когда подбирают материал
  // СПЕЦИАЛЬНО для столешницы (role 'countertopDecor') — карточка столешницы
  // (продаётся погонным метром) не годится ни корпусу, ни фасаду.
  // С 2026-09-26 колонка «Выбрать» есть у любой таблицы, где хоть одна строка
  // годится текущей цели подбора (libPickRowAllowed), кнопка — только у
  // подходящих строк: роли фасада (facadeMaterial) нужны и «Стекло», и
  // «Двери → Виды фасадов», а задней стенке — только «ХДФ/ДВП».
  const target = state.libPickTarget;
  const pickMode = !!target && entries.some((e) => libPickRowAllowed(topCode, e));
  const charsKey = libNodeKey(topCode, path);
  const collapsed = !!state.libCharsCollapsed;
  // Колонка «Поставщик» (кнопка-тумблер «Поставщики» ниже) — НЕЗАВИСИМА от
  // collapsed: своё отдельное общее на всю Библиотеку состояние
  // (state.libSuppliersVisible), по умолчанию скрыта.
  const suppliersVisible = !!state.libSuppliersVisible;
  // Кэш этого листа пересобирается с нуля на каждый рендер (см.
  // libFilterRowsCache/libRowHtml) — иначе после удаления/добавления
  // позиции в нём остались бы "хвостовые" записи от прошлого рендера с
  // бо́льшим числом строк (безвредно для applyColumnFilterAndSort — она
  // смотрит только на реальные tr[data-row-idx] — но лишняя память и путаница).
  libFilterRowsCache[charsKey] = [];
  const rowsHtml = entries.map((e, i) => libRowHtml(e, { pickMode, collapsed, suppliersVisible, tableKey: charsKey, rowIdx: i, moveTop: topCode, topCode })).join('');
  const items = entries.map((e) => e.item);
  const colCount = (collapsed ? 3 : 6) + (pickMode ? 1 : 0) + (suppliersVisible ? 1 : 0);
  const emptyRow = entries.length ? '' : `<tr><td colspan="${colCount}" class="hint">Пока нет позиций</td></tr>`;
  const addGroup = topCode === 'edge' ? 'edge' : ((opts.addGroupMap && opts.addGroupMap[path[0]]) || opts.addDefaultGroup || topCode);
  // data-add-top — сам topCode (а не addGroup, который для СВОИХ категорий
  // «Материалов»/«Дверей» всегда 'decors'/'facade', см. libTopCategoryDef) —
  // нужен libAddRow, чтобы проставить новой позиции item.customRoot, когда
  // добавление идёт внутрь matcustom-/faccustom- категории (см. там же).
  const addHtml = opts.addLabel
    ? `<button type="button" class="link-btn lib-add" data-add="${esc(addGroup)}" data-add-path="${esc(path.join('::'))}" data-add-top="${esc(topCode)}">${esc(opts.addLabel)}</button>`
    : '';
  // «+ Добавить по ссылке» (см. openLibLinkForm/libLinkFormHtml) — рядом с
  // обычным «+ Добавить материал», тот же контекст (topCode/addGroup/path)
  // определяет, в какой массив каталога попадёт позиция и какая ветка
  // дерева предложена по умолчанию. Сама форма рисуется один раз вверху
  // вкладки «Материалы» (см. libraryMaterialsBlock), а не здесь — проще,
  // чем целиться конкретно в место клика среди произвольно раскрытых ветвей
  // дерева.
  const linkAddHtml = opts.addLabel
    ? `<button type="button" class="link-btn lib-add-by-link" data-link-kind="materials" data-link-top="${esc(topCode)}" data-link-group="${esc(addGroup)}" data-link-path="${esc(path.join('::'))}">+ Добавить по ссылке</button>`
    : '';
  // «− Удалить материал» — только там, где вообще есть массив/объект
  // каталога, из которого можно удалить строку. «Стекло» (topCode 'glass') —
  // единственное исключение: cat.GLASS не массив, а один фиксированный
  // объект, удалять там нечего (у GLASS-4 внутри «Видов фасадов» такое
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
  const actionsHtml = (addHtml || linkAddHtml || delHtml) ? `<div class="lib-leaf-actions">${addHtml}${linkAddHtml}${delHtml}</div>` : '';
  // Кнопка «Характеристики материала» — НАД таблицей, а не заголовок внутри
  // <thead> (см. коммент у libColgroup/libTableHead, почему): общий на всю
  // Библиотеку тумблер (state.libCharsCollapsed), клик в любой из открытых
  // таблиц сворачивает/разворачивает колонки Длина/Ширина/Толщина везде
  // разом (обработчик — делегированный click на .lib-chars-toggle, см.
  // initLibraryPanel, ему всё равно, внутри таблицы кнопка или снаружи).
  // Подпись статична («Характеристики материала», без +/− префикса) —
  // текущее состояние (характеристики показаны/скрыты) отражает класс
  // .active на самой кнопке, не текст (см. .lib-chars-btn в style.css).
  // Названа не «...листа» (было так до 2026-09-21): кнопка общая для ЛЮБОЙ
  // таблицы каталога (материалы/кромка/фурнитура), «лист» неуместен для
  // кромки, погонажных материалов и фурнитуры.
  const charsToggleHtml = `<button type="button" class="lib-chars-btn lib-chars-toggle${collapsed ? '' : ' active'}" data-chars-toggle="1" title="Показать/скрыть длину, ширину, толщину">Характеристики материала</button>`;
  // Кнопка «Поставщики» — рядом с «Характеристики материала», тот же
  // визуальный паттерн (.lib-chars-btn/.active), но независимый тумблер
  // (см. state.libSuppliersVisible/обработчик .lib-suppliers-toggle в
  // initLibraryPanel): показывает/прячет колонку «Поставщик» — сайт, с
  // которого добавлена цена позиции (см. libSourceSiteLabel).
  const suppliersToggleHtml = `<button type="button" class="lib-chars-btn lib-suppliers-toggle${suppliersVisible ? ' active' : ''}" data-suppliers-toggle="1" title="Показать/скрыть, с какого сайта добавлена цена">Поставщики</button>`;
  return `
    <div class="lib-leaf-body">
      ${charsToggleHtml}
      ${suppliersToggleHtml}
      ${libPriceNoteHtml(items)}
      <table class="lib-table${collapsed ? ' chars-collapsed' : ''}" style="table-layout:fixed" data-chars-key="${esc(charsKey)}">${libColgroup(pickMode, collapsed, suppliersVisible)}${libTableHead(pickMode, collapsed, charsKey, suppliersVisible)}<tbody>${rowsHtml}${emptyRow}</tbody></table>
      ${actionsHtml}
    </div>`;
}

// Диспетчер таблицы листа/ветки по topCode — единственное место, где дерево
// категорий (libNodeHtml/libTopCategoryHtml, общее для «Материалов» и
// «Фурнитуры») решает, КАКОЙ рендерер таблицы вызвать: у материалов есть
// колонки листа/декора (Длина/Ширина/Толщина под тумблером «Характеристики
// листа», см. libLeafTableHtml), у фурнитуры их нет вовсе (см.
// libHardwareLeafTableHtml ниже) — сами узлы дерева, раскрытие/свёртывание,
// хлебные крошки и фокус на листе общие и НЕ дублируются, различается только
// содержимое таблицы конкретного листа.
function libLeafTableHtmlAny(topCode, path, entries, opts) {
  if (topCode.indexOf('hw:') === 0) return libHardwareLeafTableHtml(topCode, path, entries, opts);
  // «База модулей» — грид карточек вместо таблицы (см. libModLeafGridHtml).
  if (String(topCode).indexOf('mod:') === 0) return libModLeafGridHtml(topCode, path, entries);
  return libLeafTableHtml(topCode, path, entries, opts);
}

// Единицы измерения, в которых реально продаётся фурнитура (сверено с
// catalog.js 2026-09-16: 'шт' у подавляющего большинства позиций и у всех
// HANDLES/LIFTS, где поля unit нет вовсе; 'пара' у направляющих и
// штанго-держателей; 'уп' у крепежа столешницы; 'пог.м' у самой штанги).
// Список задан явно, а не только собирается из каталога, потому что нужен и
// на ВЫБОР единицы новой позиции (см. libLinkConfirmHtml) — иначе единицу,
// которой пока нет ни у одной позиции, нельзя было бы указать в принципе.
const LIB_HW_UNIT_OPTIONS = ['шт', 'пара', 'уп', 'пог.м'];

// Та же единица в винительном падеже — для подсказки «Цена за пару» на ячейке
// цены (см. libHwPriceCellHtml). Подставлять сокращение как есть нельзя: «Цена
// за пара» читается как опечатка. Единица, которой в таблице нет (пришла с
// позицией «по ссылке»), выводится сокращением — это честнее, чем угадывать
// её падеж.
const LIB_HW_UNIT_ACCUSATIVE = {
  'шт': 'штуку',
  'пара': 'пару',
  'уп': 'упаковку',
  'пог.м': 'погонный метр',
};

// Единица одной позиции фурнитуры — 'шт' по умолчанию, ровно то же значение,
// которое подставляют libAddHardwareRow/libLinkSaveHardware, когда единицу не
// указали (у HANDLES/LIFTS поля unit нет исторически).
function libHwUnitOf(it) {
  return (it && it.unit) || 'шт';
}

// Компактный список единиц ОДНОЙ позиции фурнитуры — открывается рядом с
// полем цены при инлайн-правке ячейки (см. startCellEdit) и сохраняется
// вместе с ценой. Это единственное место, где единицу УЖЕ добавленной
// позиции можно исправить: отдельной колонки «Ед. изм.» в таблице больше нет
// (она распирала таблицу шире панели, см. libHardwareLeafTableHtml), а форма
// «Добавить по ссылке» задаёт единицу только новой позиции — без этого
// редактора позицию, заведённую кнопкой «+ Добавить позицию», нельзя было бы
// перевести из «шт» в «пара»/«уп» вообще нигде.
// Список — ПОЛНЫЙ LIB_HW_UNIT_OPTIONS (в отличие от шапки колонки, где
// предлагаются только встречающиеся в таблице единицы, см.
// libHwTablePriceUnits): здесь единицу ЗАДАЮТ, и перевести позицию в
// единицу, которой в этой таблице пока нет ни у кого, — обычное дело.
// Единица, пришедшая с позицией по ссылке и не входящая в список,
// дописывается в конец — иначе открытие редактора молча сменило бы её.
function libHwUnitEditorHtml(unit) {
  const cur = unit || 'шт';
  const list = LIB_HW_UNIT_OPTIONS.indexOf(cur) >= 0 ? LIB_HW_UNIT_OPTIONS : LIB_HW_UNIT_OPTIONS.concat([cur]);
  const opts = list
    .map((u) => `<option value="${esc(u)}" ${u === cur ? 'selected' : ''}>за ${esc(LIB_HW_UNIT_ACCUSATIVE[u] || u)}</option>`)
    .join('');
  return `<select class="lib-hw-unit-edit" title="Единица измерения позиции">${opts}</select>`;
}

// Выбранная единица колонки «Цена» ОДНОЙ корневой категории фурнитуры (см.
// state.libHwPriceUnit) — отсутствие записи означает 'native' («как в
// позиции»).
function libHwPriceUnitOf(topCode) {
  return (state.libHwPriceUnit || {})[topCode] || 'native';
}

// Единицы для выпадающего списка в шапке колонки «Цена» КОНКРЕТНОЙ таблицы:
// только те, что реально встречаются в ЕЁ строках, плюс текущая выбранная,
// даже если она из таблицы пропала (иначе select потерял бы показанное
// значение и молча перескочил бы на первый пункт).
// Общего списка «все единицы каталога» здесь больше нет (исправлено
// 2026-09-16): в «Петлях» он предлагал «Цена/пара», после выбора которой вся
// таблица показывала «—» — пункт, который заведомо ничего не покажет,
// предлагать нельзя. Полный набор LIB_HW_UNIT_OPTIONS по-прежнему нужен там,
// где единицу ЗАДАЮТ (редактор цены, см. libHwUnitEditorHtml, и форма
// «Добавить по ссылке»), а не отбирают по ней строки.
function libHwTablePriceUnits(items, current) {
  const out = [];
  (items || []).forEach((it) => {
    const u = libHwUnitOf(it);
    if (out.indexOf(u) < 0) out.push(u);
  });
  if (current && current !== 'native' && out.indexOf(current) < 0) out.push(current);
  return out;
}

// Переключатель единицы цены в шапке таблиц «Фурнитуры» — тот же класс
// .lib-price-unit-select, что и у материалов (см. libPriceUnitHeaderHtml):
// общий CSS (компактный select, обрезка длинной подписи многоточием) и та же
// ширина колонки 82px. Своё состояние — state.libHwPriceUnit, поэтому в
// разметке есть и второй класс .lib-hw-price-unit-select: по нему
// делегированный обработчик change (см. initLibraryPanel) отличает
// переключатель фурнитуры от переключателя материалов.
// 'native' («как в позиции») — значение по умолчанию: никакого отбора, цена
// каждой строки как есть. Остальные пункты — не пересчёт (у фурнитуры
// переводить шт↔пара↔уп↔пог.м нечем, коэффициентов для этого не существует),
// а «покажи цены только тех позиций, что продаются в этой единице»: у строки
// с другой единицей в колонке будет «—».
// items/topCode — позиции ИМЕННО ЭТОЙ таблицы и её корневая категория:
// список опций свой у каждой таблицы (см. libHwTablePriceUnits), а выбранное
// значение — своё у каждой корневой категории (см. libHwPriceUnitOf).
// data-top — та же корневая категория для обработчика change (см.
// initLibraryPanel): по самому <select> иначе не понять, к какой таблице он
// относится, и выбор «Цена/пара» в «Направляющих» переписал бы единицу всей
// вкладке разом.
function libHwPriceUnitHeaderHtml(items, topCode) {
  const current = libHwPriceUnitOf(topCode);
  const nativeOpt = `<option value="native" ${current === 'native' ? 'selected' : ''}>Цена (как в позиции)</option>`;
  const opts = libHwTablePriceUnits(items, current)
    .map((u) => `<option value="${esc(u)}" ${u === current ? 'selected' : ''}>Цена/${esc(u)}</option>`)
    .join('');
  return `<select class="lib-price-unit-select lib-hw-price-unit-select" data-top="${esc(topCode)}">${nativeOpt}${opts}</select>`;
}

// Ячейка «Цена» одной позиции фурнитуры. Цена НЕ округляется до целого (в
// отличие от материалов, см. libPriceCellHtml): у метизов она копеечная
// (шкант 0.2, конфирмат 0.5 — см. catalog.js), и округление показало бы «0».
// title — единица позиции: отдельной колонки «Ед. изм.» в таблице больше нет
// (она распирала таблицу шире панели), и без подсказки «за пару»/«за
// упаковку» цена читалась бы неверно.
function libHwPriceCellHtml(group, key, it, unit) {
  const itemUnit = libHwUnitOf(it);
  // Выбрана конкретная единица, а у позиции она другая — цену не показываем
  // и не даём править: так же ведут себя материалы, когда пересчитать цену в
  // выбранную единицу нечем (см. libPriceValueForUnit → null → «—»).
  if (unit !== 'native' && unit !== itemUnit) return '<td class="lib-price-cell">—</td>';
  const display = it.price != null ? `${it.price} ${curSym()}` : undefined;
  return libEditCell(group, key, 'price', 'number', it.price,
    { displayText: display, extraClass: 'lib-price-cell', title: `Цена за ${LIB_HW_UNIT_ACCUSATIVE[itemUnit] || itemUnit}` });
}
// То же значение простой строкой — для поповера сортировки/фильтра колонки
// «Цена» (libFilterRowsCache): единственный источник правды «что показано в
// ячейке» общий с libHwPriceCellHtml выше.
function libHwPriceDisplayValue(it, unit) {
  const itemUnit = libHwUnitOf(it);
  if (unit !== 'native' && unit !== itemUnit) return '—';
  return it.price != null ? `${it.price} ${curSym()}` : '';
}

// Таблица позиций одного листа/ветки вкладки «Фурнитура» — тот же каркас и
// тот же НАБОР КОЛОНОК, что у материалов со свёрнутыми характеристиками (см.
// libLeafTableHtml/libColgroup): Наименование / Образец / Цена, те же ширины
// 72px и 82px, те же кнопки-треугольники сортировки/фильтра (.dth-filter-btn)
// и тот же переключатель единицы цены в шапке. До 2026-09-16 у неё был свой
// набор (Наименование / Образец / Ед. изм. / Цена шириной 90+110px), из-за
// которого таблица вылезала за правый край панели, а сама панель выглядела
// иначе, чем на соседней вкладке. Отдельная колонка «Ед. изм.» убрана:
// редактировать единицу прямо в таблице больше нельзя, она задаётся при
// добавлении позиции (см. libLinkConfirmHtml) и видна в подсказке ячейки
// цены (см. libHwPriceCellHtml).
// entries — { group: 'hw:<src>', item } (см. libHardwareTopEntries) — все
// позиции одного листа/ветки гарантированно одной и той же исходной
// категории (topCode 'hw:<categoryKey>' сам её и задаёт, item.category
// только подтверждает), поэтому raw-ключ категории для кнопок добавления
// безопасно берём из первой записи; opts.hwCategory — тот же самый ключ,
// передаётся явно из libraryHardwareBlock и подстраховывает пустой лист
// (когда entries вообще нет).
function libHardwareLeafTableHtml(topCode, path, entries, opts) {
  opts = opts || {};
  const category = (entries[0] && entries[0].item && entries[0].item.category) || opts.hwCategory || '';
  const items = entries.map((e) => e.item);
  const unit = libHwPriceUnitOf(topCode);
  // Колонка «Поставщик» — то же общее на всю Библиотеку состояние, что и у
  // материалов (см. libLeafTableHtml/state.libSuppliersVisible), у фурнитуры
  // своего тумблера «Характеристики...» нет, но «Поставщики» показана и тут
  // (см. suppliersToggleHtml ниже).
  const suppliersVisible = !!state.libSuppliersVisible;
  // Колонка «Чертёж» — своя кнопка-тумблер «Характеристики» (state.
  // libHwCharsVisible), НЕЗАВИСИМАЯ от suppliersVisible выше и от
  // state.libCharsCollapsed (та вообще про таблицу материалов) — миниатюра
  // чертежа присадки конкретной позиции (it.drawing, см. libDrawingSwatchHtml).
  const hwCharsVisible = !!state.libHwCharsVisible;
  // Колонка «Выбрать» — режим подбора Библиотеки (state.libPickTarget), тот
  // же приём, что и у листовых материалов (см. libLeafTableHtml/
  // libPickRowAllowed): видна, если хоть одна строка листа годится текущей
  // цели подбора (сейчас — только роль 'hangerSystem', «Навес для верхних
  // модулей» на экране «Материалы»).
  const pickTarget = state.libPickTarget;
  const pickMode = !!pickTarget && entries.some((e) => libPickRowAllowed(topCode, e));
  // Выделение строки кликом (см. state.libSelectedRow/libApplyRowSelection) —
  // тот же приём, что и у материалов (см. libRowHtml/libLeafTableHtml), нужен
  // здесь ради кнопки «− Удалить позицию» ниже.
  const sel = state.libSelectedRow;
  // tableKey — тот же libNodeKey(topCode, path), что и charsKey у материалов:
  // одновременно открытых таблиц в Библиотеке может быть много, у каждой свой
  // независимый фильтр. Кэш строк пересобирается с нуля на каждый рендер — по
  // той же причине, что и у материалов (см. libLeafTableHtml).
  const tableKey = libNodeKey(topCode, path);
  libFilterRowsCache[tableKey] = [];
  const rowsHtml = entries.map((e, i) => {
    const group = e.group;
    const it = e.item;
    const key = it.key;
    const searchText = String(it.name || '').toLowerCase();
    const priceDisplay = libHwPriceDisplayValue(it, unit);
    // supplierDisplay — считается ВСЕГДА, как и у материалов (см. libRowHtml):
    // applyColumnFilterAndSort может держать фильтр/сортировку по колонке 3,
    // пока сама колонка спрятана тумблером «Поставщики».
    const supplierDisplay = libSourceSiteLabel(it);
    // vals — по одному значению на КАЖДУЮ колонку строки, ФИКСИРОВАННЫЙ
    // логический порядок (0 — Наименование, 1 — Образец, 2 — Цена, 3 —
    // Поставщик, 4 — Чертёж), НЕ обязанный совпадать с визуальным порядком
    // <td> ниже (Чертёж отрисован сразу после Образца, но здесь остаётся
    // индексом 4 — filterBtn(0)/filterBtn(2) ссылаются на эти номера, а не на
    // позицию в разметке): поповер фильтра адресуется номером колонки (см.
    // data-col у .dth-filter-btn), поэтому пустая строка для нефильтруемых
    // «Образца»/«Чертежа» — не мусор, а обязательная заглушка, держащая
    // нумерацию (у «Чертежа» тоже нет кнопки-фильтра, см. filterBtn ниже).
    libFilterRowsCache[tableKey].push({
      idx: i,
      vals: [String(it.name || ''), '', priceDisplay, supplierDisplay, it.drawing || ''],
    });
    // Значок ⇄ «перенести позицию» — тот же, что и у материалов (см.
    // libRowMoveIcHtml): внутри ячейки «Наименование», без своей колонки.
    // Ради него и заведена подкатегория «Blum» внутри «Петель» — раньше
    // переносить умели только узлы дерева целиком.
    const moveIc = libRowMoveIcHtml(topCode, group, libEntryKeyOf(e));
    // data-row-group/data-row-key — тот же атрибут, что и у материалов (см.
    // libRowHtml), клик по строке выделяет её для кнопки «− Удалить позицию».
    const isSelected = !!(sel && sel.group === group && sel.key === key);
    const pickAllowed = pickMode && libPickRowAllowed(topCode, e);
    const pickCell = pickMode
      ? (pickAllowed
        ? `<td><button type="button" class="link-btn lib-pick-btn" data-pick-group="${esc(group)}" data-pick-code="${esc(key)}">Выбрать</button></td>`
        : '<td></td>')
      : '';
    return `
      <tr data-search="${esc(searchText)}" data-row-group="${esc(group)}" data-row-key="${esc(key)}"
          data-row-idx="${i}" class="${isSelected ? 'lib-row-selected' : ''}">
        ${libEditCell(group, key, 'name', 'text', it.name, { afterHtml: moveIc, extraClass: 'lib-name-cell' })}
        <td>${libSwatchHtml(group, key, it.image, it.sourceUrl)}</td>
        ${hwCharsVisible ? `<td>${libDrawingSwatchHtml(group, key, it.drawing, it.drawingFull, it.name)}</td>` : ''}
        ${libHwPriceCellHtml(group, key, it, unit)}
        ${suppliersVisible ? `<td class="lib-supplier-col" title="${esc(supplierDisplay)}">${esc(supplierDisplay)}</td>` : ''}
        ${pickCell}
      </tr>`;
  }).join('');
  // colCount — 3 базовых (Наименование/Образец/Цена) + Поставщик + Чертёж +
  // Выбрать, каждый только если его тумблер/режим сейчас включён (см.
  // suppliersVisible/hwCharsVisible/pickMode выше) — тот же приём, что и
  // colCount у материалов (см. libLeafTableHtml).
  const colCount = 3 + (suppliersVisible ? 1 : 0) + (hwCharsVisible ? 1 : 0) + (pickMode ? 1 : 0);
  const emptyRow = entries.length ? '' : `<tr><td colspan="${colCount}" class="hint">Пока нет позиций</td></tr>`;
  // data-add-path — тот же путь листа/ветки, что и у материалов (см.
  // libLeafTableHtml/libAddRow): позволяет новой позиции сразу попасть в ту
  // подкатегорию/фирму (сама категория вынесена в topCode, см.
  // libHardwareTopEntries), под которой нажали кнопку, а не всегда в
  // «безбрендовый» уровень категории (см. libAddHardwareRow). Путь передаём
  // целиком: с 2026-09-16 в дереве фурнитуры бывает больше одного уровня.
  const addHtml = category
    ? `<button type="button" class="link-btn lib-add" data-add="hwadd:${esc(category)}" data-add-path="${esc(path.join('::'))}">+ Добавить позицию</button>`
    : '';
  // data-link-path — тот же путь ветки, что и у data-add-path кнопки «+
  // Добавить позицию» выше: без него позиция «по ссылке» попадала бы в
  // категорию БЕЗ бренда, даже если кнопку нажали прямо под конкретной
  // фирмой (см. libLinkSaveHardware).
  const linkAddHtml = category
    ? `<button type="button" class="link-btn lib-add-by-link" data-link-kind="hardware" data-link-hwcat="${esc(category)}" data-link-path="${esc(path.join('::'))}">+ Добавить по ссылке</button>`
    : '';
  // «− Удалить позицию» — тот же паттерн, что и «− Удалить материал» у
  // листовых материалов (см. libLeafTableHtml/LIB_ROW_DEL_HINT): активна,
  // только если строка ИЗ ЭТОЙ таблицы выделена кликом (state.libSelectedRow,
  // см. libApplyRowSelectionDom). Само удаление и его ограничения — в
  // libDeleteSelectedHardwareRow (вызывается из общей libDeleteSelectedRow по
  // клику на .lib-row-del, см. initLibraryPanel): для «родных» ключей
  // HARDWARE_PRICES/FASTENER_PRICES удаление вообще заблокировано (их читает
  // напрямую specification.js), для ручек/подъёмников — разрешено, если
  // позиция сейчас нигде не используется в проекте.
  const selectedHere = !!sel && entries.some((e) => e.group === sel.group && e.item.key === sel.key);
  const delHtml = `<button type="button" class="link-btn lib-row-del" ${selectedHere ? '' : 'disabled'}${selectedHere ? '' : ` title="${esc(LIB_ROW_DEL_HINT)}"`}>− Удалить позицию</button>`;
  const actionsHtml = (addHtml || linkAddHtml || delHtml) ? `<div class="lib-leaf-actions">${addHtml}${linkAddHtml}${delHtml}</div>` : '';
  // Кнопка-треугольник сортировки/фильтра — на тех же колонках, что и у
  // материалов: «Наименование» и «Цена» (у «Образца» фильтровать нечего).
  // Номер колонки обязан совпадать с позицией <td> в строке и с индексом в
  // vals кэша (см. libFilterRowsCache выше).
  const filterBtn = (colIndex) => `<button type="button" class="dth-filter-btn" data-filter-key="${esc(tableKey)}" data-col="${colIndex}" title="Сортировка и фильтр">▾</button>`;
  // data-chars-key — тот же атрибут, по которому renderLibraryPanel находит
  // таблицы и заново применяет к ним сохранённый фильтр. Название атрибута
  // историческое (у материалов ключ заодно обслуживает тумблер
  // «Характеристики материала»), у фурнитуры характеристик нет — это просто
  // ключ таблицы, других значений он не несёт.
  const supplierColHtml = suppliersVisible ? '<col class="lib-supplier-col" style="width:92px">' : '';
  const supplierHeadHtml = suppliersVisible
    ? `<th class="lib-supplier-col lib-th-filter"><span class="dth-label">Поставщик</span>${filterBtn(3)}</th>`
    : '';
  // Колонка «Чертёж» (см. state.libHwCharsVisible/libDrawingSwatchHtml выше) —
  // тот же приём, что и «Поставщик»: своя <col>/<th>, рисуются только когда
  // тумблер включён. Без кнопки-фильтра (.dth-filter-btn) — по аналогии с
  // «Образцом», фильтровать по картинке нечего.
  const drawingColHtml = hwCharsVisible ? '<col style="width:72px">' : '';
  const drawingHeadHtml = hwCharsVisible ? '<th>Чертёж</th>' : '';
  // Колонка «Выбрать» (см. pickMode выше) — без заголовка и без фильтра, как
  // и «Образец», просто пустая шапка над кнопками строк.
  const pickColHtml = pickMode ? '<col style="width:76px">' : '';
  const pickHeadHtml = pickMode ? '<th></th>' : '';
  // Кнопка «Поставщики» — та же общая (state.libSuppliersVisible), что и у
  // таблиц материалов (см. libLeafTableHtml).
  const suppliersToggleHtml = `<button type="button" class="lib-chars-btn lib-suppliers-toggle${suppliersVisible ? ' active' : ''}" data-suppliers-toggle="1" title="Показать/скрыть, с какого сайта добавлена цена">Поставщики</button>`;
  // Кнопка «Характеристики» — НОВАЯ, рядом с «Поставщики» (тот же визуальный
  // паттерн .lib-chars-btn, что и «Характеристики материала»/«Поставщики»,
  // см. libLeafTableHtml), но свой независимый тумблер (state.
  // libHwCharsVisible) и своя колонка «Чертёж» вместо Длины/Ширины/Толщины —
  // у фурнитуры этих размеров в таком виде нет, а чертёж присадки нужен.
  const hwCharsToggleHtml = `<button type="button" class="lib-chars-btn lib-hw-chars-toggle${hwCharsVisible ? ' active' : ''}" data-hw-chars-toggle="1" title="Показать/скрыть чертёж присадки">Характеристики</button>`;
  return `
    <div class="lib-leaf-body">
      ${hwCharsToggleHtml}
      ${suppliersToggleHtml}
      ${libPriceNoteHtml(items)}
      <table class="lib-table" style="table-layout:fixed" data-chars-key="${esc(tableKey)}">
        <colgroup><col><col style="width:72px">${drawingColHtml}<col style="width:82px">${supplierColHtml}${pickColHtml}</colgroup>
        <thead><tr>
          <th class="lib-th-filter"><span class="dth-label">Наименование</span>${filterBtn(0)}</th>
          <th>Образец</th>
          ${drawingHeadHtml}
          <th class="lib-th-filter"><span class="dth-label">${libHwPriceUnitHeaderHtml(items, topCode)}</span>${filterBtn(2)}</th>
          ${supplierHeadHtml}
          ${pickHeadHtml}
        </tr></thead>
        <tbody>${rowsHtml}${emptyRow}</tbody>
      </table>
      ${actionsHtml}
    </div>`;
}

// Отступ строки дерева на один уровень вложенности. Одна константа на два
// места: саму строку (libTreeRowHtml ниже) и линию-индикатор броска при
// перетаскивании (libDragShowIndicator) — она рисуется поверх панели по
// своим координатам и обязана совпадать с отступом строк, иначе однажды
// молча съедет относительно дерева.
const LIB_TREE_INDENT = 16;

// Строка одного узла дерева — общая и для верхнеуровневой категории (kind
// 'top'), и для ветки ('branch'), и для листа ('leaf'). Отступ слева
// пропорционален глубине пути (LIB_TREE_INDENT на уровень); ✎/+/⇄/× —
// обычный текст без рамки/фона, видны по наведению на строку (см.
// .lib-tree-actions в style.css).
//
// Кто какие значки получает:
// - ✎ «Переименовать» — у всех узлов, кроме разделов «Материалов» (их набор
//   фиксирован: тип товара завязан на группу каталога) и кроме 'countertop'
//   (см. ниже). У КОРНЯ категории фурнитуры ✎ есть: он меняет только подпись
//   на экране, не ключ категории (см. libRenameNode).
// - + «Добавить категорию» — у всего, кроме листа (единственное добавление у
//   листа — «+ Добавить материал/позицию» под его таблицей, см.
//   libLeafTableHtml/libHardwareLeafTableHtml) и кроме 'countertop'.
// - ⇄ «Переместить» — у всего, кроме корня раздела (корню некуда переезжать:
//   перенос между РАЗНЫМИ разделами запрещён, он сменил бы тип товара/ключ
//   категории, от которого зависит расчёт) и кроме 'countertop'.
// - × «Удалить» — у всех узлов ниже корня; у самого корня — только если это
//   СВОЯ категория фурнитуры (см. libHwCategoryIsBuiltin/libDeleteHwCategory):
//   встроенную удалять нельзя, по её ключу движок подбирает фурнитуру в
//   расчёте, и без неё спецификация осталась бы без петель/направляющих.
//
// 'countertop' — единственный раздел вообще без правки дерева: его
// categoryPath виртуальный, выводится из item.materialId (закрытый список,
// см. COUNTERTOP_MATERIAL_LABEL), а не хранится как поле каталога — правка
// меняла бы одноразовую копию из libTopEntries и молча пропадала бы после
// перерисовки, правильнее не показывать значок вовсе, чем давать нерабочую
// кнопку. × ему оставлен — на реальных листьях он и так блокируется алертом
// (см. libNodeHasItems), а плейсхолдерам здесь взяться неоткуда без +.
// Фурнитура ('hw:<categoryKey>') до 2026-09-16 была в том же положении, но
// теперь её путь — настоящее поле item.categoryPath (см.
// libHardwareTopEntries/libSetEntryPath), поэтому все четыре значка у неё
// работают так же, как у материалов.
// depthOffset — глубина САМОГО РАЗДЕЛА, если он вложен в другой раздел (см.
// state.libTopParent/libTopCategoryTreeHtml). У корневого раздела и всего его
// дерева это 0, и отступ считается как раньше — по длине пути.
function libTreeRowHtml(topCode, path, name, kind, collapsed, depthOffset) {
  const depth = path.length + (depthOffset || 0);
  const isTop = kind === 'top';
  // Заголовочный вид (крупный жирный акцентный текст, класс .lib-tree-top) —
  // только у раздела, который стоит НА ВЕРХНЕМ УРОВНЕ вкладки (depthOffset 0).
  // Стоит его вложить в другой раздел — и он оказывается в одном ряду с
  // подкатегориями родителя («GTV», «REJS»), с тем же отступом слева, и по
  // смыслу читается как одна из них; заголовок раздела посреди списка
  // подкатегорий выглядел бы чужеродно (пользователь попросил 2026-09-18).
  // Меняется ТОЛЬКО оформление строки: data-kind="top" и все значки ✎/+/⇄/×
  // остаются прежними, поэтому вынос обратно наверх (тем же жестом) вернёт
  // и заголовочный вид.
  const isTopHeading = isTop && !(depthOffset || 0);
  const isLeaf = kind === 'leaf';
  const isCountertop = topCode === 'countertop';
  const isHardware = topCode.indexOf('hw:') === 0;
  // Встроенная корневая категория фурнитуры — единственный корень, который
  // можно переименовать, но нельзя удалить (см. комментарий выше).
  const isBuiltinHwTop = isTop && isHardware && libHwCategoryIsBuiltin(topCode.slice(3));
  // Своя корневая категория «Материалов»/«Дверей» (кнопка-плитка «Добавить
  // категорию», см. state.libMatCustomCats/libFacCustomCats) — как и своя
  // категория фурнитуры выше, её можно и переименовать, и удалить: встроенные
  // четыре раздела «Материалов»/один раздел «Дверей» по-прежнему нет (тип
  // товара у них завязан на группу каталога).
  const isMatCustomTop = isTop && String(topCode).indexOf('matcustom-') === 0;
  const isFacCustomTop = isTop && String(topCode).indexOf('faccustom-') === 0;
  // «База модулей» — своя верхнеуровневая категория (кнопка-плитка, см.
  // state.libModCustomGroups) переименовывается/удаляется как и у соседних
  // вкладок; группа PRESETS (заводская) — как встроенный раздел «Материалов»,
  // ни то ни другое.
  const isModules = topCode.indexOf('mod:') === 0;
  const isModCustomTop = isTop && isModules && !libModTopIsBuiltin(topCode.slice(4));
  // «База модулей»: лист раскрывается кликом (показывает миниатюры), как ветка
  // — поэтому стрелка есть и у него.
  const arrowHtml = (isLeaf && !isModules) ? '<span class="lib-tree-arrow"></span>' : `<span class="lib-tree-arrow">${collapsed ? '▸' : '▾'}</span>`;
  const canRename = !isCountertop && (!isTop || isHardware || isMatCustomTop || isFacCustomTop || isModCustomTop);
  // «База модулей» не подчиняется инварианту «есть подкатегории → своих
  // позиций нет» (см. libEntryTargetPath/libModAllPlacements) — карточки
  // пресета могут лежать прямо в узле, даже если у него уже есть свои
  // подкатегории, поэтому «+» остаётся кликабельным даже у листа: узел
  // просто обзаводится первой подкатегорией, не теряя своих карточек.
  const canAdd = !isCountertop && (!isLeaf || isModules);
  const canMove = !isCountertop && !isTop;
  const canDelete = !isTop || (isHardware && !isBuiltinHwTop) || isMatCustomTop || isFacCustomTop || isModCustomTop;
  const renameIc = canRename ? '<span class="lib-tree-ic" data-tree-rename="1" title="Переименовать">✎</span>' : '';
  const addIc = canAdd ? '<span class="lib-tree-ic" data-tree-add="1" title="Добавить подкатегорию">+</span>' : '';
  const moveIc = canMove ? '<span class="lib-tree-ic" data-tree-move="1" title="Переместить">⇄</span>' : '';
  const delIc = canDelete ? '<span class="lib-tree-ic" data-tree-del="1" title="Удалить">×</span>' : '';
  return `<div class="lib-tree-row${isTopHeading ? ' lib-tree-top' : ''}" style="padding-left:${depth * LIB_TREE_INDENT}px"
      data-tree-node="1" data-kind="${kind}" data-top="${esc(topCode)}" data-path="${esc(path.join('::'))}">
    ${arrowHtml}<span class="lib-tree-name" data-tree-label="1">${esc(name)}</span><span class="lib-tree-actions">${renameIc}${addIc}${moveIc}${delIc}</span>
  </div>`;
}

// Один узел дерева (ветка или лист) с его поддеревом — вызывается рекурсивно
// для каждого дочернего сегмента (см. libChildSegments). Лист в обычном
// режиме навигации показывает только свою строку — таблица открывается
// кликом по нему (см. state.libActiveLeaf/libTopCategoryHtml), а не здесь.
// У ВЕТКИ — только её подкатегории и ничего больше: по инварианту дерева
// (см. NO_BRAND_SUBCAT) собственных позиций у неё нет, они лежат в её
// подкатегории «Без бренда» — обычном дочернем узле, который рисуется тем
// же рекурсивным вызовом, что и остальные. Никакого отдельного блока
// «свои позиции ветки» (и подписи «Без подкатегории» над ним) больше нет.
function libNodeHtml(topCode, path, opts) {
  const name = path[path.length - 1];
  const children = libChildSegments(topCode, path);
  // Глубина раздела (0, если он корневой) — она же добавка к отступу всех
  // строк его дерева, см. libTreeRowHtml/libTopCategoryTreeHtml.
  const off = (opts && opts.depthOffset) || 0;
  if (!children.length) {
    // «База модулей»: настоящий лист (без своих подкатегорий) — карточки
    // пресета лежащие прямо в этом узле показываем инлайн под строкой дерева
    // ТОЛЬКО когда лист раскрыт кликом (state.libCollapsed, по умолчанию
    // свёрнут), как у веток; фокус-режим state.libActiveLeaf здесь не
    // используется (в отличие от «Материалов»/«Фурнитуры»).
    if (String(topCode).indexOf('mod:') === 0) {
      const modCollapsed = libIsNodeCollapsed(topCode, path);
      const rowHtml = libTreeRowHtml(topCode, path, name, 'leaf', modCollapsed, off);
      const ownEntries = libEntriesAtPath(topCode, path);
      if (ownEntries.length && !modCollapsed) return rowHtml + libModLeafGridHtml(topCode, path, ownEntries);
      return rowHtml;
    }
    return libTreeRowHtml(topCode, path, name, 'leaf', false, off);
  }
  const collapsed = libIsNodeCollapsed(topCode, path);
  let childrenHtml = children.map((seg) => libNodeHtml(topCode, path.concat([seg]), opts)).join('');
  // «База модулей»: узел может иметь ОДНОВРЕМЕННО и подкатегории, и свои
  // карточки (см. комментарий у libTreeRowHtml/libEntryTargetPath) — грид
  // карточек показываем НАД списком подкатегорий.
  if (String(topCode).indexOf('mod:') === 0) {
    const ownEntries = libEntriesAtPath(topCode, path);
    if (ownEntries.length) childrenHtml = libModLeafGridHtml(topCode, path, ownEntries) + childrenHtml;
  }
  return libTreeRowHtml(topCode, path, name, 'branch', collapsed, off)
    + `<div class="lib-tree-children${collapsed ? ' lib-collapsed' : ''}">${childrenHtml}</div>`;
}

// Хлебные крошки над таблицей сфокусированного листа (см. state.libActiveLeaf/
// libTopCategoryHtml ниже) — раньше там была только строка с именем самого
// листа (libTreeRowHtml), и после фокуса на конечной категории родительские
// сегменты пути («Листовые материалы» → «ДСП») терялись, было непонятно, где
// находишься. Показывает путь «...› Лист» начиная со следующего уровня ПОСЛЕ
// заголовка раздела (сам заголовок раздела — title — уже показан отдельной
// строкой выше, см. libTopCategoryHtml, крошки его не повторяют): все
// сегменты, кроме последнего (сам лист — текущее место), кликабельны и
// возвращают в то место дерева, по которому кликнули (снимают фокус +
// раскрывают путь до него, см. обработчик .lib-breadcrumb-seg в
// initLibraryPanel).
function libBreadcrumbHtml(topCode, path) {
  const partsHtml = path.map((seg, i) => {
    const isCurrent = i === path.length - 1;
    const segPath = path.slice(0, i + 1).join('::');
    const sepHtml = i > 0 ? '<span class="lib-breadcrumb-sep">›</span>' : '';
    const segHtml = isCurrent
      ? `<span class="lib-breadcrumb-current">${esc(seg)}</span>`
      : `<button type="button" class="link-btn lib-breadcrumb-seg" data-bc-top="${esc(topCode)}" data-bc-path="${esc(segPath)}">${esc(seg)}</button>`;
    return sepHtml + segHtml;
  }).join('');
  return `<div class="lib-breadcrumb">${partsHtml}</div>`;
}

// Верхнеуровневая категория целиком («Листовые материалы»/«Материалы
// фасадов»/«Кромка»/«Стекло», либо, начиная с 2026-09-15, каждая отдельная
// категория фурнитуры «Петли»/«Ручки»/... — см. libraryHardwareBlock) —
// заголовок (сам никогда не прячется, кликом раскрывает/прячет прямых детей,
// см. state.libCatOpen) → либо ПОЛНОЕ дерево (обычная навигация), либо, если
// на этой категории сфокусирован лист (см. state.libActiveLeaf), ТОЛЬКО
// хлебные крошки его пути + таблица — вся остальная структура дерева этой
// категории скрыта.
//
// Корень раздела живёт по общему инварианту дерева (см. NO_BRAND_SUBCAT):
// ЕСТЬ подкатегории — показываем только их, своих позиций у корня не бывает
// (позиции без бренда лежат в его подкатегории «Без бренда», куда их
// складывает libNormalizeOwnEntries). НЕТ подкатегорий — корень сам себе
// лист: таблица рисуется прямо под заголовком, даже если позиций пока нет,
// иначе в такую категорию («Крепление цоколя» у «Фурнитуры» — она не
// делится на бренды вовсе) негде было бы добавить первую позицию.
//
// ИСКЛЮЧЕНИЕ — своя корневая категория «Материалов»/«Дверей» (кнопка-плитка
// «Добавить категорию», см. state.libMatCustomCats/libFacCustomCats, ключ
// узнаётся по libIsCustomRootTop ниже): у ВСТРОЕННЫХ разделов
// (sheet/edge/glass/countertop/facade) «нет подкатегорий → сам себе лист»
// оправдано — тип товара известен заранее, только эта категория имеет право
// хранить такие позиции. У свежесозданной своей категории типа товара нет
// вовсе — пока в ней нет ни одной подкатегории, показывать пустую таблицу и
// «+ Добавить материал»/«+ Добавить по ссылке» читалось бы как «категория
// уже готова принимать позиции», хотя по ожиданию это просто папка, которая
// раскладывается на подкатегории (задача 2026-09-21). Поэтому такая
// категория — ЧИСТАЯ папка без таблицы (см. пустое состояние ниже); как
// только появляется первая подкатегория (значок «+» строки дерева,
// libAddChildNode), инвариант выше снова работает как обычно — таблица
// появляется у НЕЁ, а не у родителя.
function libIsCustomRootTop(topCode) {
  return String(topCode).indexOf('matcustom-') === 0 || String(topCode).indexOf('faccustom-') === 0;
}
function libTopCategoryHtml(topCode, title, opts) {
  // Глубина самого раздела и готовая разметка вложенных в него разделов —
  // их подставляет libTopCategoryTreeHtml, у обычного корневого раздела это
  // 0 и пустая строка.
  const depth = (opts && opts.depthOffset) || 0;
  const nestedHtml = (opts && opts.nestedHtml) || '';
  const activeKey = state.libActiveLeaf[topCode] || null;
  let bodyHtml;
  if (activeKey) {
    const path = activeKey.split('::');
    // Вложенные РАЗДЕЛЫ рисуем и в режиме фокуса — под крошками и таблицей.
    // Фокус прячет ДЕРЕВО этой категории (в том и смысл: видно только один
    // лист), но вложенный раздел деревом родителя не является: это отдельная
    // категория со своими позициями, и вместе с фокусом она пропадала бы с
    // экрана целиком — попасть в неё было бы нельзя, пока не выйдешь из
    // фокуса. Со стороны это выглядит ровно как «категория потерялась».
    // Порядок важен: сначала крошки и таблица листа, потом вложенные разделы,
    // — так ни то, ни другое не съезжает.
    bodyHtml = libBreadcrumbHtml(topCode, path)
      + libLeafTableHtmlAny(topCode, path, libEntriesAtPath(topCode, path), opts)
      + (nestedHtml ? `<div class="lib-tree-children">${nestedHtml}</div>` : '');
  } else {
    const open = !!state.libCatOpen[topCode];
    const topSegments = libChildSegments(topCode, []);
    let ownHtml;
    if (topSegments.length) {
      ownHtml = topSegments.map((seg) => libNodeHtml(topCode, [seg], opts)).join('');
      // «База модулей»: корень группы тоже может держать карточки ПРЯМО в
      // себе, даже уже обзаведясь подкатегориями (см. комментарий у
      // libTreeRowHtml/libNodeHtml/libEntryTargetPath) — грид карточек
      // показываем НАД деревом подкатегорий.
      if (String(topCode).indexOf('mod:') === 0) {
        const rootEntries = libEntriesAtPath(topCode, []);
        if (rootEntries.length) ownHtml = libModLeafGridHtml(topCode, [], rootEntries) + ownHtml;
      }
    } else if (libIsCustomRootTop(topCode)) {
      // Своя категория без единой подкатегории — «папка», а не лист (см.
      // комментарий выше): без таблицы, без «+ Добавить материал/по
      // ссылке», значок «+» самой строки категории (libTreeRowHtml) по-
      // прежнему кликабелен как обычно и заводит первую подкатегорию.
      ownHtml = '<div class="hint lib-empty-folder-hint">В этой категории пока нет подкатегорий — добавьте её значком «+».</div>';
    } else {
      ownHtml = libLeafTableHtmlAny(topCode, [], libEntriesAtPath(topCode, []), opts);
    }
    // Вложенные РАЗДЕЛЫ (см. state.libTopParent) — в том же списке, что и
    // подкатегории, но ПОСЛЕ них: «Без бренда» обязан оставаться последним
    // среди подкатегорий (см. libChildSegments), а раздел — это уже другая
    // сущность, и вклинивать его в середину брендов незачем.
    // Раздел без подкатегорий показывает прямо здесь свою таблицу — вложенные
    // в него категории идут следом за ней, инвариант дерева это не трогает:
    // позиции раздела остаются в нём, у вложенного раздела свои.
    bodyHtml = `<div class="lib-tree-children${open ? '' : ' lib-collapsed'}">${ownHtml}${nestedHtml}</div>`;
  }
  return `
    <div class="lib-category${depth ? ' lib-category-nested' : ''}" data-top-code="${esc(topCode)}">
      ${libTreeRowHtml(topCode, [], title, 'top', !state.libCatOpen[topCode], depth)}
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
// «Виды фасадов» (вкладка «Двери», см. libraryFacadesBlock).
const SHEET_FACADE_SUBCATS = ['ДСП', 'МДФ-плита', 'Шпонированные плиты'];

// Новая позиция листа объединённой категории «Листовые материалы» кладётся
// в ОДИН конкретный исходный массив каталога по умолчанию — по первому
// сегменту его пути (path[0]): «ДСП» чаще всего заводят как декор корпуса
// (DECORS — самый частый случай), «МДФ-плита»/«Шпонированные плиты» —
// позиции есть только в FACADE_MATERIALS, «ХДФ/ДВП» — только в
// BACK_MATERIALS. Для СОВСЕМ нового (заведённого кнопкой «+», ещё не
// встречавшегося) первого сегмента используем addDefaultGroup (см.
// libLeafTableHtml) — decors, тот же самый частый случай. Категорию
// «Виды фасадов» это не касается — там addGroupMap не передаётся, всегда
// FACADE_MATERIALS (см. libAddRow: group === 'facade').
const SHEET_ADD_GROUP_MAP = { 'ДСП': 'decors', 'МДФ-плита': 'facade', 'Шпонированные плиты': 'facade', 'ХДФ/ДВП': 'back' };

// ---------------------------------------------------------------------------
// Корневые категории вкладки «Библиотеки» («Листовые материалы»/«Кромка»/…,
// «Петли»/«Направляющие»/…, «Виды фасадов») — их НАБОР и их ПОРЯДОК.
// Порядок пользователь меняет перетаскиванием заголовка (см. state.libTopOrder
// и libDragResolveTarget, ветка mode 'top'), поэтому и отрисовка вкладок, и
// перетаскивание обязаны спрашивать один и тот же список — libTabTopCodes.
// ---------------------------------------------------------------------------

// Заводской набор и порядок разделов по вкладкам. Коды те же, что уходят в
// data-top строки дерева (см. libTreeRowHtml). У «Фурнитуры» набор не
// фиксирован (пользователь заводит свои категории), поэтому он считается на
// лету — см. libTabTopCodesRaw.
const LIB_TAB_TOP_CODES = {
  materials: ['sheet', 'edge', 'glass', 'countertop'],
  facades: ['facade'],
};

// tabKey 'modules' — «База модулей» (см. libraryBlock ниже): группы PRESETS
// (topCode 'mod:<groupId>') вперемешку со своими категориями (topCode
// 'mod:<key>', см. state.libModCustomGroups), в ОДНОМ общем порядке — тот же
// приём, что у libHwCategoryKeys для «Фурнитуры» (заводские коды первыми,
// дальше свои по мере добавления, а окончательный порядок всё равно решает
// libTabTopCodes через state.libTopOrder.modules ниже). У каждого кода —
// своё независимое дерево карточек (см. libTopEntries/libModTopEntries),
// ровно как у каждой категории 'hw:<key>' «Фурнитуры».
function libTabTopCodesRaw(tabKey) {
  if (tabKey === 'hardware') return libHwCategoryKeys().map((c) => 'hw:' + c);
  if (tabKey === 'modules') return PRESETS.map((g) => 'mod:' + g.id).concat((state.libModCustomGroups || []).map((g) => 'mod:' + g.key));
  const base = (LIB_TAB_TOP_CODES[tabKey] || []).slice();
  // Свои категории «Материалов»/«Дверей» (кнопка-плитка «Добавить категорию»,
  // см. state.libMatCustomCats/libFacCustomCats) — дописываются к заводскому
  // набору в порядке добавления, тем же приёмом, что и libHwCategoryKeys выше.
  if (tabKey === 'materials') return base.concat(state.libMatCustomCats || []);
  if (tabKey === 'facades') return base.concat(state.libFacCustomCats || []);
  return base;
}

// Разделы вкладки в том порядке, в каком их надо рисовать: сначала
// перечисленные в сохранённом порядке, затем те, которых там нет (только что
// заведённая своя категория фурнитуры), — в заводском порядке. Ровно тот же
// принцип, что у libChildSegments для подкатегорий, включая защиту от
// повторов в сохранённом списке.
function libTabTopCodes(tabKey) {
  const all = libTabTopCodesRaw(tabKey);
  const order = state.libTopOrder[tabKey] || [];
  const listed = order.filter((c) => all.indexOf(c) >= 0)
    .concat(all.filter((c) => order.indexOf(c) < 0));
  const out = [];
  listed.forEach((c) => { if (out.indexOf(c) < 0) out.push(c); });
  return out;
}

// Ставит раздел code на позицию index среди разделов вкладки (index — по
// списку БЕЗ самого code, null — в конец). Порядок материализуется целиком и
// только из существующих кодов: заодно из него выпадают разделы, которых уже
// нет (удалённая своя категория фурнитуры). Тот же приём и та же причина,
// что у libPlaceChildAt.
function libPlaceTopAt(tabKey, code, index) {
  const rest = libTabTopCodes(tabKey).filter((c) => c !== code);
  const pos = (index == null || index < 0 || index > rest.length) ? rest.length : index;
  rest.splice(pos, 0, code);
  state.libTopOrder[tabKey] = rest;
}

// Индекс, на который встанет раздел code, если бросить его рядом с разделом
// ref (before — выше него). Считается в момент применения, по актуальному
// списку — та же причина, что у libChildInsertIndex.
function libTopInsertIndex(tabKey, code, ref, before) {
  const rest = libTabTopCodes(tabKey).filter((c) => c !== code);
  const at = rest.indexOf(ref);
  if (at < 0) return null;
  return before ? at : at + 1;
}

// Ставит code сразу после раздела ref в общем порядке вкладки (или в конец,
// если ref пуст/уже не существует — libTopInsertIndex тогда вернёт null).
// Общая основа для libPlaceNewTopAfterFocused (материалы/фурнитура/двери/
// модули, ref — state.libLastFocusedTop).
function libPlaceTopAfterRef(tabKey, code, ref) {
  const idx = ref ? libTopInsertIndex(tabKey, code, ref, false) : null;
  libPlaceTopAt(tabKey, code, idx);
}

// Ставит только что созданную свою корневую категорию (code — уже добавлен в
// её custom-массив, см. libAddHwCategory/libAddMaterialCategory/
// libAddFacadeCategory) сразу после последней категории этой вкладки, с
// которой пользователь только что работал (см. state.libLastFocusedTop) — а
// не в конец списка, как раньше (задача 2026-09-21). Заодно запоминает саму
// новую категорию как «последнюю тронутую» — следующая категория, заведённая
// без клика по дереву между ними, встанет рядом с ней.
function libPlaceNewTopAfterFocused(tabKey, code) {
  libPlaceTopAfterRef(tabKey, code, state.libLastFocusedTop[tabKey]);
  state.libLastFocusedTop[tabKey] = code;
}

// ---------------------------------------------------------------------------
// ВЛОЖЕННОСТЬ разделов друг в друга (state.libTopParent) — «Полкодержатели»
// внутри «Крепежа». Это раскладка на экране, а не перенос данных: у вложенной
// категории остаются свой topCode и свои позиции со своим item.category.
// Поэтому её можно вытащить обратно наверх тем же жестом, и ничего
// мигрировать не нужно.
// ---------------------------------------------------------------------------

// Код родительской категории или null (категория корневая). Осиротевший
// родитель (категорию удалили) и зацикленная цепочка трактуются как «корневая»
// — испорченный сохранённый снимок не должен ронять отрисовку и не должен
// прятать категорию совсем.
function libTopParentOf(tabKey, code) {
  const map = (state.libTopParent || {})[tabKey] || {};
  const parent = map[code];
  if (!parent || parent === code) return null;
  if (libTabTopCodesRaw(tabKey).indexOf(parent) < 0) return null;
  const seen = Object.create(null);
  seen[code] = true;
  let cur = parent;
  while (cur) {
    if (seen[cur]) return null;   // цикл — считаем категорию корневой
    seen[cur] = true;
    cur = map[cur];
  }
  return parent;
}

// Глубина вложенности категории (0 — корневая). Нужна отступам строк и линии
// индикатора при перетаскивании.
function libTopDepth(tabKey, code) {
  let depth = 0;
  let cur = libTopParentOf(tabKey, code);
  while (cur && depth < 50) { depth += 1; cur = libTopParentOf(tabKey, cur); }
  return depth;
}

// Разделы вкладки, которые рисуются на ВЕРХНЕМ уровне, и разделы, вложенные
// в конкретный раздел. И те, и другие — в порядке libTabTopCodes, то есть
// вложенные категории упорядочиваются ровно тем же механизмом, что и корневые
// (state.libTopOrder — один плоский список на вкладку, из которого каждая
// группа берёт свои элементы, сохраняя относительный порядок).
function libTabRootCodes(tabKey) {
  return libTabTopCodes(tabKey).filter((c) => !libTopParentOf(tabKey, c));
}
function libTabChildCodes(tabKey, parentCode) {
  return libTabTopCodes(tabKey).filter((c) => libTopParentOf(tabKey, c) === parentCode);
}

// Можно ли вложить категорию code в parentCode: нельзя в саму себя и нельзя
// в собственного потомка (иначе ветка оказалась бы внутри самой себя и
// пропала бы с экрана). Та же по смыслу проверка, что у переноса узла дерева
// (см. libMoveTargets), только по цепочке родителей категорий.
function libTopCanNest(tabKey, code, parentCode) {
  if (!parentCode || parentCode === code) return false;
  const seen = Object.create(null);
  let cur = parentCode;
  while (cur) {
    if (cur === code || seen[cur]) return false;
    seen[cur] = true;
    cur = libTopParentOf(tabKey, cur);
  }
  return true;
}

// Единственная точка записи вложенности. parentCode пуст — категория снова
// корневая.
function libSetTopParent(tabKey, code, parentCode) {
  if (!state.libTopParent[tabKey]) state.libTopParent[tabKey] = {};
  if (parentCode) state.libTopParent[tabKey][code] = parentCode;
  else delete state.libTopParent[tabKey][code];
}

// Вкладка, которой принадлежит раздел, — нужна тем местам, что знают только
// код раздела (перенос позиции значком ⇄ в другую категорию).
function libTabOfTopCode(code) {
  const c = String(code);
  if (c.indexOf('hw:') === 0) return 'hardware';
  if (c.indexOf('mod:') === 0) return 'modules';
  // Свои категории «Материалов»/«Дверей» не входят в LIB_TAB_TOP_CODES
  // (заводской фиксированный набор) — их вкладку различает только префикс
  // ключа (см. libAddMaterialCategory/libAddFacadeCategory).
  if (c.indexOf('matcustom-') === 0) return 'materials';
  if (c.indexOf('faccustom-') === 0) return 'facades';
  return LIB_TAB_TOP_CODES.materials.indexOf(c) >= 0 ? 'materials' : 'facades';
}

// Бросок ЗАГОЛОВКА категории (см. libDragApplyDrop): 'topInto' — вложить в
// целевую категорию (встаёт последней среди вложенных в неё), 'top' — встать
// рядом с целью, то есть к тому же родителю, что и она (в том числе «снова
// наверх», если цель корневая). Место в общем порядке считаем по актуальному
// списку — как libChildInsertIndex для подкатегорий.
function libDropTopCategory(tabKey, code, target) {
  const nesting = target.mode === 'topInto';
  const parent = nesting ? target.ref : libTopParentOf(tabKey, target.ref);
  if (parent && !libTopCanNest(tabKey, code, parent)) return;
  libSetTopParent(tabKey, code, parent);
  let index;
  if (nesting) {
    // «Последней среди вложенных»: якорь — последняя из уже вложенных в цель
    // категорий, а если их нет — сама цель.
    const kids = libTabChildCodes(tabKey, parent).filter((c) => c !== code);
    index = libTopInsertIndex(tabKey, code, kids.length ? kids[kids.length - 1] : parent, false);
  } else {
    index = libTopInsertIndex(tabKey, code, target.ref, target.before);
  }
  libPlaceTopAt(tabKey, code, index);
  // Раскрываем всю цепочку родителей: иначе вложенная категория «пропала бы»
  // внутри свёрнутого раздела — со стороны это выглядит как её потеря (та же
  // причина, что и в libMoveNode).
  let cur = parent;
  while (cur) { state.libCatOpen[cur] = true; cur = libTopParentOf(tabKey, cur); }
  scheduleCatalogSave();
  renderLibraryPanel();
}

// Подписи и настройки разделов «Материалов» и «Дверей» — набор фиксированный,
// поэтому лежит рядом с LIB_TAB_TOP_CODES, а не собирается в функции
// отрисовки: его спрашивает и вкладка, и рекурсия по вложенным категориям
// (libTopCategoryTreeHtml). У «Фурнитуры» подписи свои (libHwCategoryLabel).
const LIB_TAB_TOP_DEFS = {
  materials: {
    sheet: ['Листовые материалы', {
      pickable: true,
      addLabel: '+ Добавить материал', addGroupMap: SHEET_ADD_GROUP_MAP, addDefaultGroup: 'decors',
    }],
    edge: ['Кромка', { addLabel: '+ Добавить кромку' }],
    glass: ['Стекло', {}],
    countertop: ['Столешницы', { addLabel: '+ Добавить столешницу', pickable: true }],
  },
  facades: {
    facade: ['Виды фасадов', { addLabel: '+ Добавить материал' }],
  },
};

// Подпись своей категории «Материалов»/«Дверей» — своя (введена при
// создании, см. libAddMaterialCategory/libAddFacadeCategory) → сам ключ как
// резерв (не должно случаться в норме, только на испорченных данных). Та же
// роль, что у libHwCategoryLabel, только у этих двух категорий подпись —
// единственное, что вообще есть (ключ никогда не меняется и нигде не
// показывается пользователю напрямую).
function libMatCategoryLabel(code) {
  return (state.libMatCatLabels || {})[code] || code;
}
function libFacCategoryLabel(code) {
  return (state.libFacCatLabels || {})[code] || code;
}

// { title, opts } раздела или null, если такого раздела на вкладке нет.
function libTopCategoryDef(tabKey, code) {
  if (tabKey === 'hardware') {
    if (String(code).indexOf('hw:') !== 0) return null;
    const key = code.slice(3);
    if (libHwCategoryKeys().indexOf(key) < 0) return null;
    return { title: libHwCategoryLabel(key), opts: { hwCategory: key } };
  }
  // Своя категория «Материалов»/«Дверей» (кнопка-плитка «Добавить
  // категорию») — не входит в LIB_TAB_TOP_DEFS ниже (набор там фиксированный),
  // всегда одна и та же decor-таблица (см. комментарий у
  // state.libMatCustomCats): addDefaultGroup сразу определяет, в какой
  // массив каталога уйдёт новая позиция (decors/facade), addGroupMap не
  // нужен — своих подкатегорий по типу товара тут нет.
  if (tabKey === 'materials' && String(code).indexOf('matcustom-') === 0) {
    if ((state.libMatCustomCats || []).indexOf(code) < 0) return null;
    // pickable — как у 'sheet' (её позиции тоже DECORS): в режиме подбора
    // материала корпуса/фасада/задней стенки (см. state.libPickTarget) своя
    // категория должна предлагать «Выбрать» точно так же, как «Листовые
    // материалы» — иначе позиции, заведённые сюда пользователем, были бы
    // недоступны для подбора без веской причины.
    return { title: libMatCategoryLabel(code), opts: { addLabel: '+ Добавить материал', addDefaultGroup: 'decors', pickable: true } };
  }
  if (tabKey === 'facades' && String(code).indexOf('faccustom-') === 0) {
    if ((state.libFacCustomCats || []).indexOf(code) < 0) return null;
    return { title: libFacCategoryLabel(code), opts: { addLabel: '+ Добавить материал', addDefaultGroup: 'facade' } };
  }
  // «База модулей» — группа PRESETS или своя категория (см.
  // state.libModCustomGroups), обе в одном общем дереве (см.
  // libTabTopCodesRaw). Своих opts.addLabel/pickable тут нет — у листа/ветки
  // нет кнопки «+ Добавить…», карточки добавляются не через каталог, а
  // копированием/переносом уже существующих (см. libModCopyCard).
  if (tabKey === 'modules') {
    if (String(code).indexOf('mod:') !== 0) return null;
    const key = code.slice(4);
    if (!libModGroupExists(key)) return null;
    return { title: libModTopLabel(key), opts: {} };
  }
  const def = (LIB_TAB_TOP_DEFS[tabKey] || {})[code];
  return def ? { title: def[0], opts: def[1] } : null;
}

// Раздел целиком: его заголовок, его дерево и вложенные в него РАЗДЕЛЫ —
// рекурсивно. depth — глубина самого раздела (0 у корневого): от неё считается
// отступ его строк, чтобы вложенная категория стояла в одном ряду с
// подкатегориями родителя.
function libTopCategoryTreeHtml(tabKey, code, depth) {
  const def = libTopCategoryDef(tabKey, code);
  if (!def) return '';
  const nestedHtml = libTabChildCodes(tabKey, code)
    .map((child) => libTopCategoryTreeHtml(tabKey, child, depth + 1))
    .join('');
  // Копия opts, а не сам объект из LIB_TAB_TOP_DEFS: depthOffset/nestedHtml
  // у каждого места свои, портить общий набор настроек нельзя.
  return libTopCategoryHtml(code, def.title, Object.assign({}, def.opts, { depthOffset: depth, nestedHtml }));
}

function libraryMaterialsBlock() {
  const catsHtml = libTabRootCodes('materials')
    .map((code) => libTopCategoryTreeHtml('materials', code, 0))
    .join('');
  return `
    ${libLinkTopBarHtml('materials')}
    ${state.libLinkForm && state.libLinkForm.kind === 'materials' ? libLinkFormHtml(state.libLinkForm) : ''}
    ${catsHtml}`;
}

// Фурнитура — та же архитектура дерева, что и «Материалы» (см. большой
// комментарий над libTopEntries/libHardwareTopEntries): категория (Петли/
// Ручки/...) → подкатегория/фирма (если есть) → таблица позиций. Раньше
// здесь был плоский список h4-секций по HARDWARE_CATEGORY_ORDER, каждая —
// одна таблица со всеми позициями категории разом; затем один общий
// libTopCategoryHtml('hardware', 'Фурнитура', ...), под которым категории
// открывались вторым уровнем — из-за этого над ними был лишний узел дерева
// «Фурнитура», дублирующий заголовок <h3>Фурнитура</h3> над ним, и увидеть
// сами категории (Петли/Направляющие/Ручки/...) можно было только раскрыв
// его. С 2026-09-15 (по просьбе пользователя, полное соответствие
// архитектуре «Материалов») каждая категория HARDWARE_CATEGORY_ORDER — СВОЁ
// НЕЗАВИСИМОЕ дерево верхнего уровня со своим составным topCode
// 'hw:<categoryKey>' (см. libTopEntries/libHardwareTopEntries), точно как
// пять веток libraryMaterialsBlock — общей обёртки нет, категории видно
// сразу без лишнего клика. Каждая категория держит свои НЕЗАВИСИМЫЕ
// state.libCatOpen/state.libActiveLeaf/state.libCollapsed (ключ включает её
// topCode) — не делят состояние открытости друг с другом, как было раньше.
function libraryHardwareBlock() {
  // Набор категорий и их подписи — только через libHwCategoryKeys/
  // libHwCategoryLabel: заводские категории идут первыми в порядке
  // HARDWARE_CATEGORY_ORDER, за ними свои (state.libHwCustomCats), а подпись
  // любой из них пользователь мог переименовать (state.libHwCatLabels).
  // Порядок категорий берём у libTabTopCodes (внутри — тот же
  // libHwCategoryKeys, поверх которого лёг порядок, заданный пользователем
  // перетаскиванием заголовков, см. state.libTopOrder).
  const categoriesHtml = libTabRootCodes('hardware')
    .map((code) => libTopCategoryTreeHtml('hardware', code, 0))
    .join('');
  return `
    ${libLinkTopBarHtml('hardware')}
    ${state.libLinkForm && state.libLinkForm.kind === 'hardware' ? libLinkFormHtml(state.libLinkForm) : ''}
    ${categoriesHtml}`;
}

// ---------------------------------------------------------------------------
// «Добавить по ссылке» — материалы и фурнитура берутся прямо с сайта
// поставщика (сервер парсит страницу и присылает черновик, см.
// server/src/routes/catalogLinks.js: GET /catalog-link-sources, POST
// /catalog-link-parse, POST /catalog-link-refresh), а не вводятся вручную
// «на глаз», как в libAddRow/libAddHardwareRow. Позиция всё равно требует
// подтверждения пользователем (экран с редактируемыми полями) — парсинг
// может ошибиться, а инженерные поля сложной фурнитуры (holes/cc/
// hardwareModelSlot/minH/maxH/maxW) сайт вообще не публикует.
//
// Форма — ОДНА на вкладку («Материалы» или «Фурнитура»), рисуется вверху
// (см. libraryMaterialsBlock/libraryHardwareBlock), а не под каждой кнопкой
// «+ Добавить по ссылке»: дерево категорий/список разделов фурнитуры может
// показывать сразу несколько раскрытых веток, и целиться конкретно в место
// клика было бы отдельной задачей ради минимального выигрыша в UX. Кнопка
// лишь передаёт КОНТЕКСТ (topCode/addGroup/path у материалов, категория у
// фурнитуры, см. data-link-* атрибуты в libLeafTableHtml/libraryHardwareBlock).
//
// Пока форма открыта (state.libLinkForm), значения полей экрана
// подтверждения правятся точечно, БЕЗ полной перерисовки панели на каждое
// нажатие клавиши (см. libLinkRevalidate — иначе слетал бы фокус/курсор).
// Но само состояние полей при этом зеркалится в state.libLinkForm
// (libLinkCaptureFormState) — перерисовка панели может случиться в любой
// момент и по чужому поводу (догрузился список сайтов, сменили раздел
// фурнитуры), и без зеркала ввод пользователя стирался бы значениями
// парсера.
// ---------------------------------------------------------------------------

// Список сайтов для выпадающего списка — ЕДИНСТВЕННЫЙ источник правды
// сервер (см. п.1.2 ТЗ): список парсеров может расшириться позже без правок
// клиента. Кэшируется на сессию, перезапрашивать незачем (список не меняется
// на лету) — грузится один раз при первом открытии Библиотеки (см. вызов в
// renderLibraryPanel — не только по клику «Добавить по ссылке», как было
// раньше: список нужен и колонке «Поставщик», см. libSourceSiteLabel, а её
// видно и без открытия формы). Возвращает промис со списком сайтов — уже
// загруженным (state.libLinkSites), уже идущим в фоне
// (state.libLinkSitesPromise, повторный вызов не дублирует запрос) или
// свежезапущенным. Раньше функция была fire-and-forget (сама перерисовывала
// форму по готовности и ничего не возвращала) — теперь этого недостаточно:
// «Обновить цены с сайта» (см. refreshCatalogLinkedPrices) должна ДОЖДАТЬСЯ
// список, чтобы определить sourceSiteId встроенных позиций каталога по
// домену (см. libLinkResolveSiteId), а не только показать его в уже открытой
// форме «Добавить по ссылке».
function loadLibLinkSites() {
  if (state.libLinkSites) return Promise.resolve(state.libLinkSites);
  if (state.libLinkSitesLoading) return state.libLinkSitesPromise || Promise.resolve([]);
  const token = getAuthToken();
  if (!token) return Promise.resolve([]);
  state.libLinkSitesLoading = true;
  state.libLinkSitesPromise = fetch(`${AUTH_API_BASE}/catalog-link-sources`, { headers: { authorization: 'Bearer ' + token } })
    .then((res) => res.json().catch(() => ({})).then((data) => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      state.libLinkSites = ok && Array.isArray(data.sites) ? data.sites : [];
      state.libLinkSitesError = ok ? null : ((data && data.error) || 'Не удалось получить список сайтов.');
    })
    .catch((err) => {
      state.libLinkSites = [];
      state.libLinkSitesError = err.message;
    })
    .finally(() => {
      state.libLinkSitesLoading = false;
      // Форма «Добавить по ссылке» больше не единственная, кому нужен этот
      // список (см. колонку «Поставщик»/libSourceSiteLabel выше) — если панель
      // вообще на странице, перерисовываем её в любом случае, иначе уже
      // отрисованные строки с «…» в этой колонке остались бы висеть до
      // следующей перерисовки панели по случайному другому поводу.
      if (document.getElementById('libraryPanel')) renderLibraryPanel();
    })
    .then(() => state.libLinkSites || []);
  return state.libLinkSitesPromise;
}

// «Сайт-источник» — КАСТОМНЫЙ выпадающий список (кнопка-переключатель +
// свой <ul>), а не нативный <select>. Каждый пункт списка — настоящая
// ссылка <a target="_blank">: вкладку с сайтом открывает сам браузер
// нативной навигацией. window.open здесь не используется СОЗНАТЕЛЬНО — на
// file:// (пользователь открывает index.html двойным кликом с диска)
// Chrome молча блокирует его и не возвращает null, так что даже alert-
// подстраховка не срабатывает; проверено вживую трижды разными способами
// (2026-09-15/16). У сайта без browseUrl атрибута href нет вообще — такой
// пункт просто выбирает сайт, никуда не уводя страницу.
// См. клик по .lib-link-site-item в делегированном click-обработчике
// панели и openLibLinkSiteMenu/closeLibLinkSiteMenu ниже (открытие/
// закрытие самого списка).
function libLinkSitePickerHtml(form) {
  const loading = state.libLinkSitesLoading || state.libLinkSites == null;
  // kinds — что сайт продаёт (см. registry.js на сервере). Сайт без kinds
  // (старый закэшированный ответ сервера, ещё не отдающего это поле) считаем
  // подходящим для любого раздела — та же защита от рассинхрона клиент/сервер,
  // что уже применена к browseUrl чуть ниже по файлу.
  const sites = (state.libLinkSites || [])
    .filter((s) => !Array.isArray(s.kinds) || s.kinds.includes(form.kind));
  return libSitePickerHtml({ sites, selectedId: form.siteId, loading, label: 'Сайт-источник',
    emptyText: state.libLinkSitesError || 'Нет доступных сайтов' });
}

// Общий рендер выпадающего списка сайтов (пикер продавцов формы и пикер сайтов
// с текстурами — один вид, один обработчик клика). opts: sites, selectedId,
// loading, emptyText, label, kind ('' — продавцы, 'tex' — текстуры: по этому
// data-picker клик пишет выбор в form.tex.siteId, а не в form.siteId).
function libSiteLabelOf(s) { return s.name === s.domain ? s.name : `${s.name} (${s.domain})`; }
function libSitePickerHtml(opts) {
  const { sites, loading } = opts;
  const empty = !loading && !sites.length;
  const labelOf = libSiteLabelOf;
  const site = sites.find((s) => s.id === opts.selectedId);
  const toggleLabelRaw = loading ? 'Загрузка списка сайтов…'
    : empty ? opts.emptyText
    : site ? labelOf(site)
    : '— выберите сайт —';
  const itemsHtml = sites.map((s) => {
    // Адрес, на который ведёт пункт. browseUrl приходит с сервера (там он
    // указывает на нужную языковую версию, напр. mobilier.md/ru), но НА НЕГО
    // НЕЛЬЗЯ РАССЧИТЫВАТЬ: задеплоенный сервер может быть старее клиента и
    // это поле не отдавать — ровно из-за этого фича «открыть сайт по клику»
    // трижды «не работала» (2026-09-15/16), хотя код был верный: адрес был
    // undefined, и перехода просто не происходило. Домен в списке есть
    // всегда, поэтому при отсутствии browseUrl собираем адрес из него.
    // Схему проверяем явно: подставлять в документ произвольную строку из
    // ответа API (javascript:/data:) нельзя.
    const browseUrl = /^https?:\/\//i.test(s.browseUrl || '') ? s.browseUrl
      : /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s.domain || '') ? 'https://' + s.domain
      : '';
    // Без адреса пункт остаётся кнопкой выбора — тогда возвращаем ему то,
    // что <a href> даёт даром: фокус с клавиатуры и роль кнопки.
    const attrs = browseUrl
      ? ` href="${esc(browseUrl)}" target="_blank" rel="noopener noreferrer"`
      : ' tabindex="0" role="button"';
    return `
      <li><a class="lib-link-site-item${s.id === opts.selectedId ? ' active' : ''}"${attrs} data-site-id="${esc(s.id)}">${esc(labelOf(s))}</a></li>`;
  }).join('');
  return `
    <div class="field lib-link-site-picker"${opts.kind ? ` data-picker="${esc(opts.kind)}"` : ''}>
      <label>${esc(opts.label)}</label>
      <button type="button" class="lib-link-site-toggle" ${loading || empty ? 'disabled' : ''}>
        <span class="lib-link-site-toggle-label">${esc(toggleLabelRaw)}</span>
        <span class="lib-link-site-toggle-caret">▾</span>
      </button>
      <ul class="lib-link-site-list" hidden>${itemsHtml}</ul>
    </div>`;
}

// Открытие/закрытие самого списка (не выбора сайта — см. клик по
// .lib-link-site-item) — по образцу openColumnFilterMenu/closeColumnFilterMenu
// ниже по файлу (тот же приём: слушатель «клик вне — закрыть» вешаем НЕ
// сразу, а следующим тиком через setTimeout, иначе тот же клик по кнопке-
// переключателю, который список открыл, тут же — пока событие ещё
// всплывает к document — его бы и закрыл). Escape тоже закрывает список.
// Оба слушателя — на document, а не на panel: клик может случиться где
// угодно на странице, не только внутри «Библиотеки».
let libLinkSiteMenuOutsideClick = null;
let libLinkSiteMenuEscHandler = null;
function closeLibLinkSiteMenu() {
  const list = document.querySelector('.lib-link-site-list:not([hidden])');
  if (list) list.hidden = true;
  if (libLinkSiteMenuOutsideClick) {
    document.removeEventListener('click', libLinkSiteMenuOutsideClick);
    libLinkSiteMenuOutsideClick = null;
  }
  if (libLinkSiteMenuEscHandler) {
    document.removeEventListener('keydown', libLinkSiteMenuEscHandler);
    libLinkSiteMenuEscHandler = null;
  }
}
// Точечно обновляет подпись переключателя и «active»-пункт пикера сайтов.
function libSitePickerMark(picker, site, selectedId) {
  if (!picker) return;
  const labelEl = picker.querySelector('.lib-link-site-toggle-label');
  if (labelEl && site) labelEl.textContent = libSiteLabelOf(site);
  picker.querySelectorAll('.lib-link-site-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.siteId === selectedId);
  });
}
function openLibLinkSiteMenu(picker) {
  closeLibLinkSiteMenu();
  const list = picker && picker.querySelector('.lib-link-site-list');
  if (!list) return;
  list.hidden = false;
  setTimeout(() => {
    libLinkSiteMenuOutsideClick = (e) => { if (!picker.contains(e.target)) closeLibLinkSiteMenu(); };
    document.addEventListener('click', libLinkSiteMenuOutsideClick);
  }, 0);
  libLinkSiteMenuEscHandler = (e) => { if (e.key === 'Escape') closeLibLinkSiteMenu(); };
  document.addEventListener('keydown', libLinkSiteMenuEscHandler);
}

// ---------------------------------------------------------------------------
// Меню «Перенести … в:» — ОДНО на два действия: перенос узла дерева целиком
// (значок ⇄ в строке дерева, см. libTreeRowHtml) и перенос одной позиции
// таблицы (значок ⇄ в строке, см. libRowMoveIcHtml). Отличаются они только
// заголовком, списком целей и тем, что делать с выбранной целью — всё
// остальное (вид, позиционирование, закрытие) обязано совпадать, поэтому
// написано здесь один раз, а openLibTreeMoveMenu/openLibRowMoveMenu ниже —
// две тонкие обёртки над ним.
// Каркас — тот же, что у поповера сортировки/фильтра колонки
// (openColumnFilterMenu ниже по файлу) и у меню фокуса: .ctx-menu, position:
// fixed с клампом к вьюпорту, закрытие по клику мимо (слушатель вешаем
// следующим тиком, иначе тот же клик, что открыл меню, его бы и закрыл) и по
// Escape. Отдельного своего вида у меню нет специально — оно должно выглядеть
// как остальные меню панели.
// ---------------------------------------------------------------------------
let libMoveMenuOutsideClick = null;
let libMoveMenuEscHandler = null;
function closeLibMoveMenu() {
  const menu = document.getElementById('libMoveMenu');
  if (menu) menu.remove();
  if (libMoveMenuOutsideClick) {
    document.removeEventListener('click', libMoveMenuOutsideClick);
    libMoveMenuOutsideClick = null;
  }
  if (libMoveMenuEscHandler) {
    document.removeEventListener('keydown', libMoveMenuEscHandler);
    libMoveMenuEscHandler = null;
  }
}

// btnEl — сам значок ⇄ (меню встаёт под ним). cfg:
//   titleHtml — заголовок, УЖЕ экранированный вызывающей стороной;
//   targets   — массив путей-целей (пустой путь = корень раздела);
//   rootLabel — подпись пункта с пустым путём;
//   hintHtml  — пояснение, почему часть целей в списке не показана (опц.);
//   onPick(target) — что сделать с выбранной целью.
// Проверку входа делаем ЗДЕСЬ, один раз на всё действие — сами переносы
// (libMoveNode/libMoveEntry) её уже не повторяют, иначе пользователь увидел
// бы одно и то же предупреждение дважды.
function openLibMoveMenu(btnEl, cfg) {
  closeLibMoveMenu();
  if (!requireLibraryEditAuth()) return;
  const targets = cfg.targets || [];
  const menu = document.createElement('div');
  menu.id = 'libMoveMenu';
  menu.className = 'ctx-menu lib-move-menu';
  // Подпись пункта: по умолчанию цель — это ПУТЬ в дереве (перенос узла), но
  // у переноса позиции цель может лежать и в другой категории вкладки, там
  // одного пути мало — такое меню передаёт свою labelOf (см.
  // libRowMoveTargetLabel). Экранируем здесь, одинаково для обоих случаев.
  const labelOf = cfg.labelOf || ((p) => (p.length ? p.join(' › ') : cfg.rootLabel));
  const itemsHtml = targets.length
    ? targets.map((t, i) => `<button type="button" class="ctx-item" data-move-idx="${i}">${esc(labelOf(t))}</button>`).join('')
    : '<div class="df-empty">Некуда переносить</div>';
  menu.innerHTML = `
    <div class="ctx-title">${cfg.titleHtml}</div>
    ${cfg.hintHtml || ''}
    <div class="lib-move-list">${itemsHtml}</div>`;
  document.body.appendChild(menu);
  // Клик внутри меню не должен доходить ни до обработчика «клик мимо —
  // закрыть» ниже, ни до обработчика клика по строке дерева/таблицы в
  // initLibraryPanel (меню лежит в body, но событие всплывает до document).
  menu.addEventListener('click', (e) => e.stopPropagation());

  const btnRect = btnEl.getBoundingClientRect();
  const rect = menu.getBoundingClientRect();
  const left = Math.max(4, Math.min(btnRect.left, window.innerWidth - rect.width - 4));
  let top = btnRect.bottom + 4;
  if (top + rect.height > window.innerHeight - 4) top = Math.max(4, btnRect.top - rect.height - 4);
  menu.style.left = Math.round(left) + 'px';
  menu.style.top = Math.round(top) + 'px';

  menu.querySelectorAll('[data-move-idx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = targets[Number(btn.dataset.moveIdx)];
      closeLibMoveMenu();
      if (target) cfg.onPick(target);
    });
  });

  setTimeout(() => {
    libMoveMenuOutsideClick = (e) => { if (!menu.contains(e.target)) closeLibMoveMenu(); };
    document.addEventListener('click', libMoveMenuOutsideClick);
  }, 0);
  libMoveMenuEscHandler = (e) => { if (e.key === 'Escape') closeLibMoveMenu(); };
  document.addEventListener('keydown', libMoveMenuEscHandler);
}

// Перенос УЗЛА дерева целиком. Список целей считает libMoveTargets: только
// узлы ЭТОГО ЖЕ раздела, без самого узла, его потомков и его текущего
// родителя. Часть целей в список не попала намеренно (см. libMoveTargets/
// libSubtreeHasSheetFacade) — без объяснения это выглядело бы как случайно
// короткий список.
function openLibTreeMoveMenu(btnEl, topCode, path) {
  const hintHtml = libSubtreeHasSheetFacade(topCode, path)
    ? `<div class="lib-move-hint">В этой категории есть материалы фасадов — переносить её можно только внутрь разделов ${libSheetFacadeSubcatsText()}. Иначе её позиции ушли бы на вкладку «Двери».</div>`
    : '';
  openLibMoveMenu(btnEl, {
    titleHtml: `Перенести «${esc(path[path.length - 1])}» в:`,
    targets: libMoveTargets(topCode, path),
    rootLabel: 'В корень раздела',
    hintHtml,
    onPick: (target) => libMoveNode(topCode, path, target),
  });
}

// Перенос ОДНОЙ ПОЗИЦИИ таблицы (значок ⇄ в строке, см. libRowMoveIcHtml).
// Позицию ищем заново по group+key (см. libFindTreeEntry): между отрисовкой
// таблицы и кликом она могла уехать из-под фильтра/сортировки, а у части
// разделов item в дереве — вообще одноразовая копия.
// В заголовке — ПОЛНОЕ имя позиции из каталога, а не укороченное название из
// ячейки (см. libSheetShortName): в меню важно не перепутать, что именно
// переносишь.
function openLibRowMoveMenu(btnEl, topCode, group, key) {
  const entry = libFindTreeEntry(topCode, group, key);
  if (!entry) return;
  const it = entry.item;
  const name = String(it.name || it.key || it.code || '');
  openLibMoveMenu(btnEl, {
    titleHtml: `Перенести «${esc(name)}» в:`,
    targets: libRowMoveTargets(topCode, entry),
    rootLabel: 'В корень категории',
    labelOf: (target) => libRowMoveTargetLabel(topCode, target, 'В корень категории'),
    hintHtml: libRowMoveHintHtml(topCode, entry),
    onPick: (target) => libMoveEntry(topCode, group, key, target),
  });
}

// Проверка домена ДО отправки на сервер (п.5 ТЗ) — чисто клиентская подсказка,
// сервер всё равно перепроверяет сам (защита от SSRF), это не замена той
// проверки, а более быстрая обратная связь пользователю.
function libLinkDomainMatches(url, domain) {
  if (!url || !domain) return false;
  let host;
  try { host = new URL(String(url).trim()).hostname.toLowerCase(); } catch (err) { return false; }
  host = host.replace(/^www\./, '');
  const dom = String(domain).toLowerCase().replace(/^www\./, '');
  return host === dom || host.endsWith('.' + dom);
}

// Определяет id сайта (см. state.libLinkSites) по домену sourceUrl позиции —
// переиспользует ТУ ЖЕ проверку домена, что и libLinkDomainMatches выше, не
// вторую отдельную. Нужна для «Обновить цены с сайта» (см. libLinkedItemsList
// ниже): позиции, добавленные через форму «Добавить по ссылке», уже несут
// sourceSiteId явно, но 72 встроенные позиции каталога (DECORS/BACK_MATERIALS/
// FACADE_MATERIALS/HARDWARE_PRICES/HANDLES/LIFTS и т.д. из catalog.js, цены
// сверены с mobilier.md ещё до появления формы) — только sourceUrl без
// sourceSiteId, id сайта для них нужно вычислить на лету. Ни с одним
// известным сайтом домен не совпал (например, сайт для этого магазина пока
// не подключён/не поддерживается парсером) — возвращает null, вызывающий код
// такую позицию просто пропускает.
function libLinkResolveSiteId(url) {
  const sites = state.libLinkSites || [];
  const site = sites.find((s) => libLinkDomainMatches(url, s.domain));
  return site ? site.id : null;
}

// Название сайта-источника цены — для колонки «Поставщик» (кнопка-тумблер
// «Поставщики», см. libLeafTableHtml/libHardwareLeafTableHtml,
// state.libSuppliersVisible). Тот же список сайтов, что и «Сайт-источник»
// формы «Добавить по ссылке» (state.libLinkSites, см. loadLibLinkSites,
// которая теперь грузится уже при открытии Библиотеки — см. renderLibraryPanel
// — а не только по клику «+ Добавить по ссылке»). Порядок проверки:
//  1) it.sourceSiteId — позиция добавлена через форму «Добавить по ссылке» и
//     уже несёт id сайта явно;
//  2) it.sourceUrl без sourceSiteId — 72 встроенные позиции каталога (см.
//     коммент у libLinkResolveSiteId выше) несут только адрес, домен сверяем
//     с известными сайтами через ТУ ЖЕ libLinkDomainMatches;
//  3) домен не совпал ни с одним подключённым магазином (например,
//     каталожная страница производителя вроде blum.com/hettich.com — не один
//     из сайтов-поставщиков) — показываем голый хост как есть: это честнее,
//     чем промолчать или выдумать несуществующий сайт;
//  4) ни sourceSiteId, ни sourceUrl нет вовсе (позиция добавлена вручную) —
//     «—».
// Пока state.libLinkSites ещё не загружен, случаи 1 и 2 неразличимы (не с чем
// сверять домен) — временная метка «…» (тот же приём, что и toggleLabelRaw
// у самой формы, см. libLinkSitePickerHtml).
function libSourceSiteLabel(it) {
  if (!it) return '—';
  const hasSiteId = !!it.sourceSiteId;
  const url = it.sourceUrl;
  if (!hasSiteId && !url) return '—';
  // Гость (нет токена входа) никогда не дождётся списка сайтов — loadLibLinkSites
  // для гостя выходит рано, не запуская запрос (см. её начало), поэтому
  // state.libLinkSites так и останётся null навсегда. Ждать вечно бессмысленно: считаем
  // список сайтов пустым сразу и идём в тот же путь, что и после
  // неудачной загрузки (голый хост из sourceUrl или «—»), а не показываем
  // «…» до бесконечности. Для залогиненного (есть токен) поведение
  // не меняется — ждём реальной загрузки, как раньше.
  if (state.libLinkSites == null && getAuthToken()) return '…';
  const sites = state.libLinkSites || [];
  if (hasSiteId) {
    const site = sites.find((s) => s.id === it.sourceSiteId);
    if (site) return site.name;
  }
  if (url) {
    const site = sites.find((s) => libLinkDomainMatches(url, s.domain));
    if (site) return site.name;
    try {
      const host = new URL(String(url).trim()).hostname.replace(/^www\./i, '');
      if (host) return host;
    } catch (err) { /* битый URL позиции — падаем на «—» ниже, не роняем рендер */ }
  }
  return '—';
}

// Открывает форму — kind: 'materials' (opts: top/group/path — тот же
// контекст, что у «+ Добавить материал», см. libLeafTableHtml) или
// 'hardware' (opts: hwCategory — раздел фурнитуры, см. libraryHardwareBlock).
function openLibLinkForm(kind, opts) {
  if (!requireLibraryEditAuth()) return;
  // values/extra/cat/variantSel/touched — зеркало полей экрана подтверждения
  // (см. libLinkCaptureFormState); у только что открытой формы его ещё нет.
  state.libLinkForm = Object.assign({ kind, step: 'input', siteId: '', url: '', error: '', draft: null,
    values: null, extra: null, cat: null, variantSel: null, touched: {} }, opts || {});
  loadLibLinkSites();
  // Прошлая попытка получить список сайтов текстур не удалась — пробуем снова.
  if (state.texSourcesError && !state.texSourcesLoading) { state.texSources = null; state.texSourcesError = null; }
  if (kind === 'materials') loadTextureSources();
  renderLibraryPanel();
  const panel = document.getElementById('libraryPanel');
  if (panel) panel.scrollTop = 0;   // форма рисуется вверху вкладки — прокручиваем к ней
}
function closeLibLinkForm() {
  closeLibLinkSiteMenu();
  libTexRelease(state.libLinkForm);
  state.libLinkForm = null;
  renderLibraryPanel();
}

// «Проверить» (step: 'input' → 'loading' → 'confirm'/обратно на 'input' при
// ошибке) — siteId/url к этому моменту уже актуальны в state.libLinkForm
// (см. libLinkRevalidate, обновляет их на каждое изменение поля).
async function libLinkCheckSubmit(panel) {
  const form = state.libLinkForm;
  if (!form) return;
  const site = (state.libLinkSites || []).find((s) => s.id === form.siteId);
  if (!site || !libLinkDomainMatches(form.url, site.domain)) return;
  const token = getAuthToken();
  if (!token) { form.error = 'Войдите в аккаунт, чтобы проверить ссылку.'; renderLibraryPanel(); return; }
  form.error = '';
  form.step = 'loading';
  renderLibraryPanel();
  try {
    const res = await fetch(`${AUTH_API_BASE}/catalog-link-parse`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ siteId: form.siteId, url: form.url }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Не удалось получить данные с сайта.');
    form.draft = data.draft || {};
    // Зеркало полей экрана подтверждения относится к КОНКРЕТНОМУ черновику
    // (см. libLinkCaptureFormState): пользователь мог уже один раз дойти до
    // подтверждения, вернуться по ошибке на шаг ввода и проверить другую
    // ссылку — старые значения тогда перекрыли бы данные нового товара.
    libLinkResetFormValues(form);
    form.step = 'confirm';
  } catch (err) {
    form.error = err.message;
    form.step = 'input';
  }
  // Пользователь мог закрыть форму, пока шёл запрос (closeLibLinkForm
  // обнуляет state.libLinkForm целиком) — не воскрешаем её после ответа.
  if (state.libLinkForm === form) renderLibraryPanel();
  // Адрес страницы декора указан — скачиваем лист в фоне, пока пользователь
  // правит поля экрана подтверждения (результат покажет libTexBlockHtml).
  if (state.libLinkForm === form && form.step === 'confirm' && libTexApplies(form)) {
    const tex = libTexState(form);
    if (tex.url.trim() && tex.siteId && !(tex.blob && tex.blobSrc === tex.url.trim())) libTexDownload(form);
  }
}

// Известные пути дерева категории topCode (см. libAllPaths) как готовый
// список <option> «Раздел каталога» экрана подтверждения — переиспользует
// ТУ ЖЕ структуру дерева, что и вся остальная «Библиотека» (libAddChildNode/
// libChildSegments), без параллельного механизма выбора категории (п.5 ТЗ).
function libLinkParentOptionsHtml(topCode, selectedJoined) {
  const seen = new Set();
  const uniq = [];
  (topCode ? libAllPaths(topCode) : []).forEach((p) => {
    const j = p.join('::');
    if (!seen.has(j)) { seen.add(j); uniq.push(p); }
  });
  uniq.sort((a, b) => a.join('/').localeCompare(b.join('/'), 'ru', { sensitivity: 'base' }));
  const rootSelected = selectedJoined === '' ? 'selected' : '';
  const rootOpt = `<option value="" ${rootSelected}>— без раздела (верхний уровень) —</option>`;
  const restOpt = uniq.map((p) => {
    const j = p.join('::');
    return `<option value="${esc(j)}" ${selectedJoined === j ? 'selected' : ''}>${esc(p.join(' › '))}</option>`;
  }).join('');
  return rootOpt + restOpt;
}

// Раздел (существующий путь дерева) + новая подкатегория по умолчанию (п.3.3
// ТЗ).
//
// Если форма открыта ИЗНУТРИ конкретной ветки дерева (form.path непустой —
// его подставляет openLibLinkForm из opts.path, которым нажали «+ Добавить
// по ссылке» в libLeafTableHtml, т.е. это заведомо существующий путь: чтобы
// нажать кнопку, пользователь уже должен был туда дойти) — по умолчанию
// предлагаем ИМЕННО её, а не пытаемся сматчить draft.categoryPath (хлебные
// крошки сайта-источника) против дерева: у mobilier.md они почти всегда на
// румынском/английском и практически никогда не совпадут по строке с
// русским деревом каталога — раньше это заканчивалось предложением
// создать нелепую категорию верхнего уровня из иностранных слов почти при
// каждом добавлении. Хлебные крошки/бренд с сайта используются только как
// подсказка для НОВОЙ подкатегории (обычно бренд) ПОД этой же веткой — и
// только если есть основания думать, что это ДРУГОЙ бренд, чем уже открыт
// (последний сегмент открытой ветки не совпадает без учёта регистра с
// последним сегментом хлебных крошек/draft.brand); если бренд тот же —
// предлагаем ветку как есть, без домысливания новой подкатегории.
//
// Если контекста нет (form.path пуст — форма открыта не из конкретной
// ветки) — ищем в дереве этой же вкладки самый длинный УЖЕ существующий
// префикс хлебных крошек сайта; он становится разделом, а остаток (обычно
// бренд) — новой подкатегорией. Ничего не нашли вовсе — раздел не
// предлагается, категория верхнего уровня из иностранных слов не создаётся.
function libLinkDefaultCategorySplit(form) {
  const draft = form.draft || {};
  const formPath = Array.isArray(form.path) ? form.path.map((s) => String(s || '').trim()).filter(Boolean) : [];
  const draftPath = Array.isArray(draft.categoryPath)
    ? draft.categoryPath.map((s) => String(s || '').trim()).filter(Boolean) : [];
  if (formPath.length) {
    const canGuessBrand = form.group !== 'edge' && form.group !== 'countertop';
    const openBrand = formPath[formPath.length - 1].toLowerCase();
    const draftBrandGuess = draftPath.length ? draftPath[draftPath.length - 1]
      : (!isBlankValue(draft.brand) ? String(draft.brand).trim() : '');
    const isDifferentBrand = canGuessBrand && draftBrandGuess && draftBrandGuess.toLowerCase() !== openBrand;
    return { parent: formPath.join('::'), newSegment: isDifferentBrand ? draftBrandGuess : '' };
  }
  const known = (form.top ? libAllPaths(form.top) : []).map((p) => p.join('::'));
  if (draftPath.length) {
    for (let cut = draftPath.length; cut >= 0; cut -= 1) {
      const prefix = draftPath.slice(0, cut).join('::');
      if (cut === 0 || known.indexOf(prefix) >= 0) {
        return { parent: prefix, newSegment: draftPath.slice(cut).join(' / ') };
      }
    }
  }
  return { parent: '', newSegment: '' };
}
function libLinkCategoryPreviewLabel(split) {
  const parentSegs = split.parent ? split.parent.split('::').filter(Boolean) : [];
  const full = split.newSegment ? parentSegs.concat([split.newSegment]) : parentSegs;
  return full.length ? full.join(' › ') : '(без раздела)';
}

// Раздел фурнитуры (Петли/Ручки/Механизмы/...) — тот же набор и те же
// подписи, что и у дерева вкладки (libHwCategoryKeys/libHwCategoryLabel,
// см. libraryHardwareBlock), как список <option> для экрана подтверждения. Нужен, ТОЛЬКО когда форма
// открыта без контекста конкретного раздела (см. libLinkTopBarHtml — точка
// входа сверху вкладки «Фурнитура», hwCategory там не проставлен): из
// конкретного раздела (кнопка «+ Добавить по ссылке» под его таблицей)
// категория уже известна заранее и этот выбор не показывается.
function libLinkHwCategoryOptionsHtml(selected) {
  const placeholder = `<option value="" ${selected ? '' : 'selected'}>— выберите раздел —</option>`;
  // Тот же список и те же подписи, что и в дереве вкладки (см.
  // libHwCategoryKeys/libHwCategoryLabel) — включая СВОИ категории
  // пользователя: иначе в собственную категорию нельзя было бы положить
  // позицию по ссылке.
  const opts = libHwCategoryKeys()
    .map((c) => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(libHwCategoryLabel(c))}</option>`).join('');
  return placeholder + opts;
}

// Значения по умолчанию, с которыми РЕАЛЬНО рендерится <select>/<input> в
// libLinkHardwareExtraFieldsHtml ниже (например, «holes» у ручки открывается
// уже с выбранным «2») — используются ТОЛЬКО чтобы посчитать первоначальное
// disabled кнопки «Сохранить» ДО первого взаимодействия пользователя (см.
// initialMissing в libLinkConfirmHtml), не расходясь с тем, что видно на
// экране: без этого хинт «Заполните: количество отверстий» показывался бы
// даже когда select уже показывает «2».
function libLinkHardwareExtraDefaults(category) {
  if (category === 'handle') return { holes: '2', cc: '' };
  if (category === 'hinge') return { hardwareModelSlot: '' };
  if (category === 'mechanism') return { minH: '', maxH: '', maxW: '' };
  return {};
}
// Инженерные поля, которых нет на странице магазина (п.3.2 ТЗ) — набор полей
// зависит от категории и совпадает с тем, что у этой категории уже реально
// хранится в catalog.js (см. HANDLES/LIFTS/HARDWARE_PRICES.hinge выше по
// файлу), а не выдуман заново. extra — уже введённые пользователем значения
// (зеркало form.extra, см. libLinkCaptureFormState): без них смена «Раздела
// фурнитуры» или любая другая перерисовка панели стирала бы заполненные
// инженерные поля.
function libLinkHardwareExtraFieldsHtml(category, extra) {
  const v = Object.assign(libLinkHardwareExtraDefaults(category), extra || {});
  if (category === 'handle') {
    return `
      <div class="field"><label>Количество отверстий</label>
        <select class="lib-link-extra" data-ef="holes">
          <option value="1" ${String(v.holes) === '1' ? 'selected' : ''}>1 (например, кнопка)</option>
          <option value="2" ${String(v.holes) === '1' ? '' : 'selected'}>2 (скоба)</option>
        </select>
      </div>
      <div class="field"><label>Межосевое расстояние (cc), мм</label>
        <input type="number" class="lib-link-extra" data-ef="cc" value="${esc(v.cc != null ? v.cc : '')}" placeholder="например, 128">
      </div>`;
  }
  if (category === 'hinge') {
    return `
      <div class="field"><label>Тип присадки (модель в 3D)</label>
        <select class="lib-link-extra" data-ef="hardwareModelSlot">
          <option value="" ${v.hardwareModelSlot ? '' : 'selected'}>— выберите —</option>
          <option value="hingeCup" ${v.hardwareModelSlot === 'hingeCup' ? 'selected' : ''}>Стандартная — чашка Ø35</option>
          <option value="hingeGlass" ${v.hardwareModelSlot === 'hingeGlass' ? 'selected' : ''}>Для стеклянного фасада — Ø26</option>
        </select>
      </div>`;
  }
  if (category === 'mechanism') {
    return `
      <div class="field-row3">
        <div class="field"><label>Мин. высота фасада, мм</label><input type="number" class="lib-link-extra" data-ef="minH" value="${esc(v.minH != null ? v.minH : '')}"></div>
        <div class="field"><label>Макс. высота фасада, мм</label><input type="number" class="lib-link-extra" data-ef="maxH" value="${esc(v.maxH != null ? v.maxH : '')}"></div>
        <div class="field"><label>Макс. ширина корпуса, мм</label><input type="number" class="lib-link-extra" data-ef="maxW" value="${esc(v.maxW != null ? v.maxW : '')}"></div>
      </div>`;
  }
  return '';
}
// Каких инженерных полей не хватает, чтобы разрешить сохранение (п.3.2 ТЗ —
// без них позиция не сохраняется). isBlank отдельно от «не число ≥ 0»:
// 0 — законное значение minH (у обычного подъёмника «от пола проёма»),
// поэтому пустое поле и поле со значением 0 нужно различать явно.
function libLinkHardwareMissing(category, extra) {
  const missing = [];
  const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
  if (category === 'handle') {
    const holes = Number(extra.holes);
    if (isBlank(extra.holes) || (holes !== 1 && holes !== 2)) missing.push('количество отверстий');
    if (holes === 2 && (isBlank(extra.cc) || !(Number(extra.cc) > 0))) missing.push('межосевое расстояние (cc)');
  } else if (category === 'hinge') {
    if (extra.hardwareModelSlot !== 'hingeCup' && extra.hardwareModelSlot !== 'hingeGlass') missing.push('тип присадки петли (модель в 3D)');
  } else if (category === 'mechanism') {
    if (isBlank(extra.minH) || !(Number(extra.minH) >= 0)) missing.push('мин. высота фасада');
    if (isBlank(extra.maxH) || !(Number(extra.maxH) > 0)) missing.push('макс. высота фасада');
    if (isBlank(extra.maxW) || !(Number(extra.maxW) > 0)) missing.push('макс. ширина корпуса');
    if (!isBlank(extra.minH) && !isBlank(extra.maxH) && Number(extra.minH) >= Number(extra.maxH)) missing.push('мин. высота должна быть меньше макс.');
  }
  return missing;
}
// Базовая проверка, общая для материалов и простой фурнитуры — название и
// корректная цена. priceRaw === '' проверяется ОТДЕЛЬНО от Number(...): пустая
// строка приводится к 0, что иначе молча прошло бы как «цена указана».
function libLinkMissingBasic(values) {
  const missing = [];
  if (!values.name || !String(values.name).trim()) missing.push('наименование');
  const priceRaw = values.price;
  const price = Number(priceRaw);
  if (isBlankValue(priceRaw) || !Number.isFinite(price) || price < 0) missing.push('цена');
  return missing;
}
function isBlankValue(v) { return v === undefined || v === null || String(v).trim() === ''; }

// Группы материалов, для которых sheetW/sheetH — не просто колонка таблицы
// для справки, а обязательные данные движку: specification.js считает
// sheetArea = info.sheetW * info.sheetH / 1e6 БЕЗ проверки на undefined
// (см. ~строка 63) для любой позиции без customOrder — без этих полей
// вся смета проекта, где использован такой материал, молча превращается в
// NaN. Кромка (EDGE_PRICES.width) и столешница (COUNTERTOP_MATERIALS.
// maxLength/depth) в engine.js читаются только под явной truthy-проверкой —
// без них лишь отключаются вторичные подсказки (предупреждение о нецельном
// куске, автосвес), смета не ломается, поэтому там поля остаются
// необязательными.
function libLinkSheetDimsGroup(group) {
  return group === 'decors' || group === 'back' || group === 'facade';
}
// «Длина»/«Ширина» обязательны только у групп из libLinkSheetDimsGroup —
// проверяется и на первом рендере экрана подтверждения (initialMissing), и
// на каждое изменение поля (libLinkRevalidate), и ещё раз перед самим
// сохранением (libLinkSaveSubmit) — по той же трёхточечной схеме, что уже
// работает для инженерных полей сложной фурнитуры (libLinkHardwareMissing).
function libLinkMaterialDimsMissing(form, values) {
  if (!form || form.kind !== 'materials' || !libLinkSheetDimsGroup(form.group)) return [];
  const missing = [];
  const w = Number(values.sheetW);
  if (isBlankValue(values.sheetW) || !(w > 0)) missing.push('длина листа');
  const h = Number(values.sheetH);
  if (isBlankValue(values.sheetH) || !(h > 0)) missing.push('ширина листа');
  return missing;
}

function libLinkReadFormValues(box) {
  const vals = {};
  box.querySelectorAll('[data-f]').forEach((el) => { vals[el.dataset.f] = el.value; });
  return vals;
}
function libLinkReadExtraValues(box) {
  const vals = {};
  box.querySelectorAll('[data-ef]').forEach((el) => { vals[el.dataset.ef] = el.value; });
  return vals;
}
function libLinkReadVariantSelection(box) {
  const sel = {};
  box.querySelectorAll('.lib-link-variant-select').forEach((el) => {
    if (el.dataset.attr) sel[el.dataset.attr] = el.value;
  });
  return sel;
}

// ---------------------------------------------------------------------------
// Зеркало полей экрана подтверждения в state.libLinkForm (см. комментарий у
// state.libLinkForm). Панель «Библиотека» перерисовывается целиком по поводам,
// которые к вводу пользователя отношения не имеют, — догрузился список сайтов
// (loadLibLinkSites), сменили «Раздел фурнитуры» (меняется НАБОР полей ниже,
// точечной правкой не обойтись). Раньше значения жили только в DOM, и любая
// такая перерисовка молча возвращала данные парсера поверх того, что человек
// уже исправил (в каталог уходило исходное наименование и исходная цена).
// Поэтому: на каждый input/change снимаем срез полей сюда, а libLinkConfirmHtml
// рисует поля ИЗ ЭТОГО среза, откатываясь на form.draft только пока среза нет
// (первый рендер экрана подтверждения).
// ---------------------------------------------------------------------------
function libLinkCaptureFormState(box) {
  const form = state.libLinkForm;
  if (!form || !box || form.step !== 'confirm') return;
  form.values = libLinkReadFormValues(box);
  form.extra = libLinkReadExtraValues(box);
  form.variantSel = libLinkReadVariantSelection(box);
  const parentSel = box.querySelector('.lib-link-cat-parent');
  const newSeg = box.querySelector('.lib-link-cat-new');
  // Выбор категории есть только у материалов — у фурнитуры этих полей в DOM
  // нет, и затирать срез пустышкой не надо.
  if (parentSel || newSeg) {
    form.cat = { parent: parentSel ? parentSel.value : '', newSegment: newSeg ? newSeg.value : '' };
  }
}
// Срез относится к КОНКРЕТНОМУ черновику — при получении нового его нужно
// сбросить (см. libLinkCheckSubmit), иначе значения прошлого товара
// перекроют данные нового.
function libLinkResetFormValues(form) {
  form.values = null;
  form.extra = null;
  form.cat = null;
  form.variantSel = null;
  form.touched = {};
}
// Отмечает поле как «правил пользователь» (form.touched) — вызывается из
// делегированных input/change, то есть ТОЛЬКО на живой ввод: программная
// подстановка значения (el.value = ... в libLinkApplyVariant) событий не
// бросает и сюда не попадает. Нужно, чтобы выбор варианта не затирал
// наименование/артикул, которые человек уже исправил под себя.
function libLinkMarkFieldTouched(el) {
  const form = state.libLinkForm;
  if (!form || !el || !el.dataset || !el.dataset.f) return;
  if (!form.touched) form.touched = {};
  form.touched[el.dataset.f] = true;
}

// Значение поля для перерисовки: сначала то, что уже ввёл пользователь,
// и только потом — то, что распознал парсер.
function libLinkFieldValue(form, key, fallback) {
  const vals = form.values;
  return vals && vals[key] !== undefined ? vals[key] : fallback;
}

// ---------------------------------------------------------------------------
// Вариативный товар (draft.variants, см. server/src/services/
// catalogLinkParsers/sebasMd.js: extractVariants) — один URL = несколько
// комбинаций атрибутов («H, мм» × «Цвет»), у каждой своя цена. draft.price у
// такого товара — НИЖНЯЯ граница диапазона (это всё, что страница показывает
// до выбора), поэтому пока комбинация не выбрана, сохранять позицию нельзя:
// в каталог уехала бы цена самой дешёвой опоры вместо той, что нужна.
// Значения атрибутов (values) — непрозрачные слаги сайта (кириллица в
// percent-encoding), пользователю их не показываем, для этого есть label.
// ---------------------------------------------------------------------------

// ЕДИНСТВЕННАЯ функция сопоставления «выбранные значения → комбинация»:
// используется и на экране подтверждения, и в «Обновить цены с сайта» (см.
// refreshCatalogLinkedPrices) — цена варианта в обоих местах определяется по
// одному и тому же правилу, а не двумя похожими.
function libLinkFindVariant(variants, selected) {
  if (!variants || !Array.isArray(variants.attributes) || !Array.isArray(variants.items)) return null;
  const attrs = variants.attributes;
  if (!attrs.length) return null;
  const sel = selected || {};
  // Не выбран хоть один атрибут — комбинация ещё не определена. Это «рано
  // искать», а не «не нашли»: вернуть первую подходящую значило бы снова
  // подставить случайную цену из диапазона.
  if (attrs.some((a) => !sel[a.id])) return null;
  let best = null;
  let bestScore = -1;
  variants.items.forEach((it) => {
    const vals = (it && it.values) || {};
    let exact = 0;
    for (let i = 0; i < attrs.length; i += 1) {
      const id = attrs[i].id;
      const v = vals[id] == null ? '' : String(vals[id]);
      if (v === '') continue;   // «любое значение этого атрибута» — подходит под любой выбор
      // Регистр слага сравниваем нестрого: percent-encoding кириллицы сайт
      // отдаёт то в верхнем, то в нижнем регистре (%D1 против %d1) для одного
      // и того же значения — в селекте и в JSON комбинаций.
      if (v.toLowerCase() !== String(sel[id]).toLowerCase()) return;
      exact += 1;
    }
    // Чем меньше у комбинации «любых» значений, тем точнее совпадение —
    // при нескольких подходящих берём самую конкретную.
    if (exact > bestScore) { bestScore = exact; best = it; }
  });
  return best;
}

// Человекочитаемая подпись выбранного варианта («H, мм: 100, Цвет: Сатин») —
// из label'ов, а не из слагов. Она же уходит в позицию каталога (item.variant.
// label) и в суффикс наименования.
function libLinkVariantLabel(variants, selected) {
  if (!variants || !Array.isArray(variants.attributes)) return '';
  const sel = selected || {};
  const parts = [];
  variants.attributes.forEach((a) => {
    const val = sel[a.id];
    if (!val) return;
    const opt = (a.options || []).find((o) => String(o.value).toLowerCase() === String(val).toLowerCase());
    parts.push(`${a.label || a.id}: ${opt ? opt.label : val}`);
  });
  return parts.join(', ');
}

// Суффикс варианта всегда достраивается к БАЗОВОМУ имени товара (draft.name),
// а не к тому, что сейчас лежит в поле, — иначе при каждой смене варианта он
// бы накапливался («Опора — H: 50 — H: 100»).
function libLinkNameWithVariant(baseName, label) {
  const base = String(baseName == null ? '' : baseName).trim();
  if (!label) return base;
  return base ? `${base} — ${label}` : label;
}

// Чего не хватает по варианту — ТОТ ЖЕ механизм «Заполните: …» + disabled на
// «Сохранить», что и у остальных обязательных полей (libLinkMissingBasic/
// libLinkHardwareMissing), отдельной второй валидации у вариантов нет.
function libLinkVariantMissing(form) {
  const variants = form && form.draft && form.draft.variants;
  if (!variants || !Array.isArray(variants.attributes) || !variants.attributes.length) return [];
  const sel = form.variantSel || {};
  const missing = variants.attributes.filter((a) => !sel[a.id]).map((a) => a.label || a.id);
  if (missing.length) return missing;
  // Все атрибуты выбраны, но такого сочетания на сайте нет (сняли с продажи) —
  // сохранять по-прежнему нельзя: в поле цены осталась бы нижняя граница.
  return libLinkFindVariant(variants, sel) ? [] : ['вариант товара'];
}

const LIB_LINK_VARIANT_NO_STOCK = 'На странице указано: этого варианта нет в наличии — уточните перед сохранением.';

// Цена ВЫБРАННОЙ комбинации реально известна. Это, а не сам факт выбора
// варианта, решает судьбу предупреждения draft.priceNote про диапазон:
// сайт не всегда отдаёт цену комбинации (price === null), и тогда число в
// поле «Цена» вписывает руками пользователь — прятать «цена от …» в этом
// случае нельзя, иначе позиция уедет в каталог с чужой ценой и без единой
// пометки о том, откуда она взялась.
function libLinkVariantPriceKnown(form) {
  const draft = (form && form.draft) || {};
  const chosen = libLinkFindVariant(draft.variants, form && form.variantSel);
  return !!(chosen && chosen.price != null);
}

// Подсказка рядом с полем «Цена» (показывается, только если сайт сообщил
// валюту). Пока вариант не выбран — это единственный источник числа с сайта.
// Как только цена комбинации известна, число из неё убираем: его уже говорит
// строка под селектами варианта (libLinkVariantNoteText), а два разных числа
// на одном экране противоречат друг другу. Предупреждение про непересчёт
// валюты остаётся в обоих случаях — оно не про конкретное число.
function libLinkPriceHintText(form) {
  const draft = (form && form.draft) || {};
  if (!draft.currency) return '';
  const tail = 'Валюта проекта здесь не пересчитывается — при необходимости поправьте число сами.';
  if (libLinkVariantPriceKnown(form)) return `Цены на сайте указаны в ${draft.currency}. ${tail}`;
  return `На сайте цена указана как: ${draft.price != null ? String(draft.price) : '—'} ${draft.currency}. ${tail}`;
}

// Наличие КОНКРЕТНОЙ комбинации: если сайт о ней что-то знает, показываем
// именно её (см. libLinkVariantsHtml), а общетоварную строку про наличие
// прячем — «товар в наличии» рядом с «этого варианта нет в наличии» сбивает
// с толку, наличие варианта важнее.
function libLinkVariantStockInfo(chosen) {
  if (!chosen || chosen.inStock == null) return { text: '', warn: false };
  if (chosen.inStock === false) return { text: LIB_LINK_VARIANT_NO_STOCK, warn: true };
  return { text: 'На странице: этот вариант в наличии.', warn: false };
}

// Пояснение под селектами варианта — оно же заменяет предупреждение
// draft.priceNote про диапазон, когда цена комбинации уже известна.
function libLinkVariantNoteText(form, chosen) {
  const variants = form.draft && form.draft.variants;
  if (!variants) return '';
  const sel = form.variantSel || {};
  if ((variants.attributes || []).some((a) => !sel[a.id])) {
    return 'Выберите вариант — до выбора сайт показывает цену «от», она не точная.';
  }
  if (!chosen) return 'Такого сочетания на сайте нет — выберите другое.';
  const label = libLinkVariantLabel(variants, sel);
  if (chosen.price == null) return `Цену варианта ${label} сайт не отдал — впишите её вручную.`;
  return `Цена варианта ${label} по данным сайта: ${chosen.price} ${form.draft.currency || curSym()}.`;
}

// Блок выбора варианта — НАД полем «Цена»: пока он не заполнен, цена в поле
// заведомо не та, которая нужна.
function libLinkVariantsHtml(form) {
  const variants = form.draft && form.draft.variants;
  if (!variants || !Array.isArray(variants.attributes) || !variants.attributes.length) return '';
  const sel = form.variantSel || {};
  const fieldsHtml = variants.attributes.map((a) => {
    const optsHtml = (a.options || []).map((o) => {
      const on = String(o.value).toLowerCase() === String(sel[a.id] || '').toLowerCase() && sel[a.id];
      return `<option value="${esc(o.value)}" ${on ? 'selected' : ''}>${esc(o.label)}</option>`;
    }).join('');
    return `
      <div class="field"><label>${esc(a.label || a.id)}</label>
        <select class="lib-link-variant-select" data-attr="${esc(a.id)}">
          <option value="" ${sel[a.id] ? '' : 'selected'}>— выберите —</option>${optsHtml}
        </select>
      </div>`;
  }).join('');
  const chosen = libLinkFindVariant(variants, sel);
  const stock = libLinkVariantStockInfo(chosen);
  return `
    <div class="lib-link-variants">
      <b>Вариант товара</b>
      ${fieldsHtml}
      <p class="hint lib-link-variant-note">${esc(libLinkVariantNoteText(form, chosen))}</p>
      <p class="hint lib-link-variant-stock${stock.warn ? ' lib-link-warning' : ''}">${esc(stock.text)}</p>
    </div>`;
}

// Выбранный вариант в том виде, в каком он ложится в позицию каталога.
// values — ВЫБОР ПОЛЬЗОВАТЕЛЯ, а не values самой комбинации: у неё бывают
// пустые «любые» значения, по которым потом не найти ту же комбинацию заново
// (см. refreshCatalogLinkedPrices).
function libLinkSelectedVariantInfo(form) {
  const variants = form && form.draft && form.draft.variants;
  if (!variants) return null;
  const sel = form.variantSel || {};
  if (!libLinkFindVariant(variants, sel)) return null;
  const values = {};
  (variants.attributes || []).forEach((a) => { values[a.id] = sel[a.id]; });
  return { values, label: libLinkVariantLabel(variants, sel) };
}

// Фото для сохранения/показа: своё фото комбинации, если сайт его отдал
// (WooCommerce кладёт его в вариант, только когда оно отличается от
// основного), иначе — основное фото товара.
function libLinkSelectedImageUrl(form) {
  const draft = (form && form.draft) || {};
  const chosen = libLinkFindVariant(draft.variants, form && form.variantSel);
  return (chosen && chosen.imageUrl) || draft.imageUrl || null;
}

// Значения, которые форма подставила В ПОЛЯ С САЙТА (с учётом выбранного
// варианта) — сохраняются рядом с самой позицией каталога как sourceName/
// sourceArticle. Это НЕ то же самое, что сохранённые name/article:
// пользователь мог переименовать позицию прямо на экране подтверждения.
// Нужны, чтобы «Обновить цены с сайта» позже отличило его правку от
// сайтового значения и не затирало её (см. libLinkApplyRefreshedDraft).
function libLinkSourceFields(form) {
  const draft = (form && form.draft) || {};
  const chosen = libLinkFindVariant(draft.variants, form && form.variantSel);
  const label = chosen ? libLinkVariantLabel(draft.variants, form.variantSel) : '';
  return {
    sourceName: libLinkNameWithVariant(draft.name || '', label),
    sourceArticle: (chosen && chosen.article) || draft.article || '',
  };
}

// Обновляет поле позиции свежим значением с сайта, ТОЛЬКО если пользователь
// это поле сам не менял (текущее значение совпадает с сохранённым сайтовым).
// srcField у позиции нет вовсе — она сохранена до появления этого механизма,
// и правил ли её человек, уже не узнать: значение не трогаем (безопаснее
// оставить то, что есть), но сайтовое запоминаем — со следующего обновления
// сравнение заработает.
function libLinkApplyIfUntouched(it, field, srcField, freshValue) {
  if (freshValue == null) return;
  const norm = (v) => String(v == null ? '' : v).trim();
  if (it[srcField] !== undefined && norm(it[field]) === norm(it[srcField])) it[field] = freshValue;
  it[srcField] = freshValue;
}

// Смена варианта — точечная правка DOM (как в libLinkRevalidate), без
// renderLibraryPanel(): перерисовка сбросила бы фокус с только что выбранного
// селекта.
function libLinkApplyVariant(panel, box) {
  const form = state.libLinkForm;
  if (!form || form.step !== 'confirm') return;
  const draft = form.draft || {};
  form.variantSel = libLinkReadVariantSelection(box);
  const chosen = libLinkFindVariant(draft.variants, form.variantSel);
  const label = libLinkVariantLabel(draft.variants, form.variantSel);
  if (chosen) {
    // Цену при ЯВНОЙ смене варианта обновляем всегда — в этом и смысл
    // выбора. Наименование и артикул — только пока пользователь их сам не
    // правил: его правка главнее любой автоподстановки (иначе получается тот
    // же баг, что и с перерисовкой формы, только изнутри).
    //
    // Цены у комбинации нет (сайт её не отдал) — поле ОЧИЩАЕМ, а не
    // оставляем как есть: иначе в нём осталась бы нижняя граница диапазона
    // или цена предыдущего варианта, и она уехала бы в каталог под меткой
    // совсем другой комбинации. Пустое поле само блокирует «Сохранить» через
    // libLinkMissingBasic («цена»), и пользователь впишет число руками.
    const priceEl = box.querySelector('.lib-link-f[data-f="price"]');
    if (priceEl) priceEl.value = chosen.price != null ? chosen.price : '';
    const nameEl = box.querySelector('.lib-link-f[data-f="name"]');
    if (nameEl && !(form.touched && form.touched.name)) nameEl.value = libLinkNameWithVariant(draft.name, label);
    const artEl = box.querySelector('.lib-link-f[data-f="article"]');
    if (artEl && chosen.article && !(form.touched && form.touched.article)) artEl.value = chosen.article;
  }
  const photoEl = box.querySelector('.lib-link-photo');
  if (photoEl) {
    const src = libLinkSelectedImageUrl(form);
    photoEl.hidden = !src;
    if (src) photoEl.src = src;
  }
  // draft.priceNote («цена от …») перестаёт соответствовать действительности,
  // только когда цена комбинации ИЗВЕСТНА — тогда вместо него говорит
  // .lib-link-variant-note. Если сайт цену варианта не отдал, предупреждение
  // остаётся: число в поле цены — не с сайта.
  const priceKnown = libLinkVariantPriceKnown(form);
  const noteEl = box.querySelector('.lib-link-price-note');
  if (noteEl) noteEl.hidden = priceKnown;
  const priceHintEl = box.querySelector('.lib-link-price-hint');
  if (priceHintEl) priceHintEl.textContent = libLinkPriceHintText(form);
  const varNoteEl = box.querySelector('.lib-link-variant-note');
  if (varNoteEl) varNoteEl.textContent = libLinkVariantNoteText(form, chosen);
  const stock = libLinkVariantStockInfo(chosen);
  const stockEl = box.querySelector('.lib-link-variant-stock');
  if (stockEl) {
    stockEl.textContent = stock.text;
    stockEl.classList.toggle('lib-link-warning', stock.warn);
  }
  // Общетоварное «товар в наличии/нет в наличии» уступает место строке про
  // конкретную комбинацию, как только сайт что-то о ней сообщил.
  const itemStockEl = box.querySelector('.lib-link-stock');
  if (itemStockEl) itemStockEl.hidden = !!stock.text;
  libLinkRevalidate(panel);
}

// Экран подтверждения (step: 'confirm') — все распознанные поля редактируемы
// (парсинг мог ошибиться, п.1.5 ТЗ). Толщина/Длина/Ширина показываются, только
// если у этого вида позиций такое поле вообще существует (см. libLengthFieldOf/
// libWidthFieldOf — те же helpers, что и у таблиц «Библиотеки»).
//
// ВАЖНО: значения полей берутся из зеркала form.values/form.extra/form.cat
// (см. libLinkCaptureFormState) и только при его отсутствии — из form.draft.
// Функция вызывается при КАЖДОЙ перерисовке панели, в том числе по поводам,
// не связанным с формой, — рисовать всегда из draft значило бы терять всё,
// что пользователь уже исправил.
function libLinkConfirmHtml(form) {
  const draft = form.draft || {};
  const isHw = form.kind === 'hardware';
  const fv = (key, fallback) => libLinkFieldValue(form, key, fallback);
  // ВАЖНО: kind здесь НЕ должен зависеть от draft.unit. Сайт-источник может
  // показывать цену «за м²» (как у листового МДФ на mobilier.md) для
  // ОБЫЧНОГО листа фиксированного размера — это способ показать цену, а не
  // признак customOrder-позиции без фиксированного листа (тот считается по
  // area_m2, см. specification.js). decors/back/facade — всегда 'sheet'
  // (нужны sheetW/sheetH), иначе поля «Длина»/«Ширина» молча пропадали бы с
  // экрана подтверждения именно для позиций, которых это касается сильнее
  // всего.
  const kind = isHw ? null : (form.group === 'edge' ? 'edge' : form.group === 'countertop' ? 'countertop' : 'sheet');
  const showLen = !isHw && libLengthFieldOf(kind) != null;
  const showWid = !isHw && libWidthFieldOf(kind) != null;
  // Фото: у вариативного товара — фото выбранной комбинации, если у неё своё
  // (см. libLinkSelectedImageUrl). Пустой <img hidden> нужен на случай, когда
  // основного фото нет, а у комбинаций оно есть: libLinkApplyVariant правит
  // src точечно и должен иметь, что править.
  const photoSrc = libLinkSelectedImageUrl(form);
  const anyVariantPhoto = !!(draft.variants && (draft.variants.items || []).some((it) => it && it.imageUrl));
  const photoHtml = photoSrc ? `<img class="lib-link-photo" src="${esc(photoSrc)}" alt="Фото с сайта">`
    : anyVariantPhoto ? '<img class="lib-link-photo" alt="Фото с сайта" hidden>' : '';
  // Текст подсказки зависит от того, известна ли уже цена варианта (см.
  // libLinkPriceHintText) — при смене варианта её правит точечно
  // libLinkApplyVariant по классу .lib-link-price-hint.
  const priceHintHtml = draft.currency
    ? `<p class="hint lib-link-price-hint">${esc(libLinkPriceHintText(form))}</p>`
    : '';
  // draft.priceNote — предупреждение парсера про диапазон цен у вариативных
  // товаров (см. sebasMd.js: buildPriceRangeNote), показанная цена — нижняя
  // граница, не точная цена. Тот же текстовый шаблон, что и у
  // libPriceNoteHtml (item.priceNote из catalog.js) — но живёт оно только
  // здесь, в форме: в сохраняемую позицию это значение больше не копируется и
  // в таблицах «Библиотеки» не показывается (см. libLinkSaveMaterial/
  // libLinkSaveHardware и libPriceNoteHtml) — уточнять цену имеет смысл
  // именно сейчас, до сохранения. Когда цена выбранной комбинации ИЗВЕСТНА,
  // она точная — предупреждение прячем. Если сайт цену варианта не отдал,
  // предупреждение остаётся: число в поле цены вписано руками, а не с сайта.
  const variantChosen = libLinkFindVariant(draft.variants, form.variantSel);
  const priceNoteHtml = draft.priceNote
    ? `<p class="hint lib-link-price-note" ${libLinkVariantPriceKnown(form) ? 'hidden' : ''}>Цена ${esc(draft.priceNote)}.</p>`
    : '';
  // Общетоварную строку про наличие прячем, как только сайт сказал что-то про
  // наличие ВЫБРАННОЙ комбинации (см. libLinkVariantStockInfo): два разных
  // ответа про наличие на одном экране противоречат друг другу.
  const itemStockHidden = !!libLinkVariantStockInfo(variantChosen).text;
  const stockHtml = draft.inStock === true ? `<p class="hint lib-link-stock" ${itemStockHidden ? 'hidden' : ''}>На странице: товар в наличии.</p>`
    : draft.inStock === false ? `<p class="hint lib-link-warning lib-link-stock" ${itemStockHidden ? 'hidden' : ''}>На странице указано: товара нет в наличии — уточните перед сохранением.</p>` : '';
  // Листовые материалы магазины продают с ценой за м² — это и умолчание, если
  // сайт единицу не отдал (см. libLinkSheetPriceFromSite).
  const unitDefault = fv('unit', isHw ? (draft.unit || 'шт') : (draft.unit === 'лист' || draft.unit === 'пог.м' ? draft.unit : 'м²'));
  // У фурнитуры свой список единиц (LIB_HW_UNIT_OPTIONS: шт/пара/уп/пог.м) —
  // «лист»/«м²» материалов ей не подходят, зато нужны «пара» и «уп», которых
  // в общем списке нет. Раньше единицу можно было доправить прямо в таблице
  // «Фурнитуры», теперь колонки «Ед. изм.» там нет (см.
  // libHardwareLeafTableHtml), и эта форма — единственное место, где единица
  // задаётся, поэтому список должен покрывать реальные случаи.
  const unitList = isHw ? LIB_HW_UNIT_OPTIONS : LIB_UNIT_OPTIONS;
  const unitOptions = unitList.map((o) => `<option value="${esc(o)}" ${o === unitDefault ? 'selected' : ''}>${esc(o)}</option>`).join('');
  const thicknessVal = fv('thickness', draft.thickness != null ? draft.thickness : '');
  const sheetWVal = fv('sheetW', draft.sheetW != null ? draft.sheetW : '');
  const sheetHVal = fv('sheetH', draft.sheetH != null ? draft.sheetH : '');
  const thicknessFieldHtml = !isHw
    ? `<div class="field"><label>Толщина, мм</label><input type="number" class="lib-link-f" data-f="thickness" value="${esc(thicknessVal)}"></div>` : '';
  const dimsFieldsHtml = (showLen || showWid)
    ? `<div class="field-row3">
        ${showLen ? `<div class="field"><label>Длина, мм</label><input type="number" class="lib-link-f" data-f="sheetW" value="${esc(sheetWVal)}"></div>` : '<div></div>'}
        ${showWid ? `<div class="field"><label>Ширина, мм</label><input type="number" class="lib-link-f" data-f="sheetH" value="${esc(sheetHVal)}"></div>` : '<div></div>'}
        <div>${thicknessFieldHtml}</div>
      </div>`
    : thicknessFieldHtml;
  // form.cat — уже сделанный пользователем выбор раздела (зеркало, см.
  // libLinkCaptureFormState); libLinkDefaultCategorySplit только предлагает
  // его в первый раз.
  const catSplit = !isHw ? (form.cat || libLinkDefaultCategorySplit(form)) : null;
  const catHtml = !isHw ? `
    <div class="field"><label>Раздел каталога</label>
      <select class="lib-link-cat-parent">${libLinkParentOptionsHtml(form.top, catSplit.parent)}</select>
    </div>
    <div class="field"><label>Новая подкатегория (например, бренд) — необязательно</label>
      <input type="text" class="lib-link-cat-new" value="${esc(catSplit.newSegment)}" placeholder="например, GTV">
    </div>
    <p class="hint">Категория: <b class="lib-link-cat-preview">${esc(libLinkCategoryPreviewLabel({ parent: catSplit.parent, newSegment: String(catSplit.newSegment || '').trim() }))}</b></p>` : '';
  // «Раздел фурнитуры» — только когда форма открыта без контекста (см.
  // libLinkTopBarHtml/hwCatHtml, form.hwCategory ещё не известен): из
  // конкретного раздела (кнопка под его же таблицей в libraryHardwareBlock)
  // категория всегда уже задана, этот выбор там не нужен и не показывается.
  // Инженерные поля (extraHtml) до выбора раздела тоже не показываем — они
  // зависят от категории (у «Крепежа»/«Полкодержателей» и т.п. их вообще
  // нет, см. libLinkHardwareExtraFieldsHtml).
  const hwCatHtml = isHw && !form.hwCategory
    ? `<div class="field"><label>Раздел фурнитуры</label>
        <select class="lib-link-hw-cat-select">${libLinkHwCategoryOptionsHtml(form.hwCategory)}</select>
      </div>`
    : '';
  // Инженерные поля рисуются из того же зеркала form.extra — иначе смена
  // «Раздела фурнитуры» (единственная правка формы с полной перерисовкой)
  // стирала бы уже введённые cc/минимальную высоту и т.п.
  const extraVals = Object.assign(libLinkHardwareExtraDefaults(form.hwCategory), form.extra || {});
  const extraHtml = isHw && form.hwCategory
    ? `<div class="lib-link-hw-extra"><b>Инженерные параметры — на сайте их нет, заполните вручную</b>${libLinkHardwareExtraFieldsHtml(form.hwCategory, form.extra)}</div>`
    : '';
  const nameVal = fv('name', draft.name || '');
  const articleVal = fv('article', draft.article || '');
  const priceVal = fv('price', draft.price != null ? draft.price : '');
  // Тот же порядок проверок, что и в libLinkRevalidate/libLinkSaveSubmit —
  // подсказка «Заполните: …» не должна расходиться между первым рендером и
  // последующими пересчётами.
  const initialMissing = libLinkMissingBasic({ name: nameVal, price: priceVal })
    .concat(isHw && !form.hwCategory ? ['раздел фурнитуры'] : [])
    .concat(isHw ? libLinkHardwareMissing(form.hwCategory, extraVals) : [])
    .concat(libLinkMaterialDimsMissing(form, { sheetW: sheetWVal, sheetH: sheetHVal }))
    .concat(libLinkVariantMissing(form));
  return `
    <div class="lib-link-confirm">
      ${photoHtml}
      <div class="field"><label>Наименование</label><input type="text" class="lib-link-f" data-f="name" value="${esc(nameVal)}"></div>
      <div class="field"><label>Артикул</label><input type="text" class="lib-link-f" data-f="article" value="${esc(articleVal)}"></div>
      ${libLinkVariantsHtml(form)}
      <div class="field"><label>Цена, ${esc(curSym())}</label><input type="number" step="any" class="lib-link-f" data-f="price" value="${esc(priceVal)}"></div>
      ${priceHintHtml}
      ${priceNoteHtml}
      <div class="field"><label>Ед. изм.</label><select class="lib-link-f" data-f="unit">${unitOptions}</select></div>
      ${dimsFieldsHtml}
      ${stockHtml}
      ${catHtml}
      ${hwCatHtml}
      ${extraHtml}
      ${libTexBlockHtml(form)}
      <p class="hint lib-link-missing-hint">${initialMissing.length ? 'Заполните: ' + esc(initialMissing.join(', ')) + '.' : ''}</p>
      ${form.error ? `<p class="hint lib-link-error">${esc(form.error)}</p>` : ''}
      <div class="lib-leaf-actions">
        <button type="button" class="link-btn lib-link-save" ${initialMissing.length || libTexLoading(form) ? 'disabled' : ''}${libTexLoading(form) ? ' title="Дождитесь загрузки текстуры"' : ''}>Сохранить</button>
        <button type="button" class="link-btn lib-link-cancel">Отмена</button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Текстура листа в форме «Добавить по ссылке» (необязательный блок для
// материалов, кроме кромки). Пользователь указывает страницу декора у
// производителя (Egger, Kronospan) — сервер отдаёт картинку листа
// (POST /texture-sheet), клиент превращает её в плитку (userTextures.js) и
// кладёт ТОЛЬКО на этот компьютер (IndexedDB). В сам материал уходят лишь
// textureUrl и textureSiteId. Неудача с текстурой никогда не блокирует
// сохранение материала — он остаётся с плоским цветом. Состояние блока —
// form.tex: { siteId, url, status: idle|loading|ok|error, error, blob,
// blobSrc (адрес, с которого получен blob; '' если файл выбран вручную),
// previewUrl, sheetW, sheetH (размер листа из заголовков сервера) }.
// ---------------------------------------------------------------------------
function libTexApplies(form) {
  return !!form && form.kind === 'materials' && form.group !== 'edge';
}
function libTexState(form) {
  if (!form.tex) form.tex = { siteId: '', url: '', status: 'idle', error: '', blob: null, blobSrc: '', previewUrl: '', sheetW: null, sheetH: null };
  return form.tex;
}
// Освобождает превью (object URL) — при закрытии формы и после сохранения.
function libTexRelease(form) {
  if (!form || !form.tex) return;
  if (form.tex.previewUrl) { try { URL.revokeObjectURL(form.tex.previewUrl); } catch (err) { /* не критично */ } }
  form.tex.previewUrl = '';
}
function libTexSetBlob(form, blob, src, w, h, kind) {
  const tex = libTexState(form);
  tex.reqId = (tex.reqId || 0) + 1;   // выбранный файл отменяет идущую загрузку
  libTexRelease(form);
  tex.blob = blob;
  tex.blobSrc = src || '';
  tex.sheetW = w || null;
  tex.sheetH = h || null;
  tex.kind = kind || '';
  tex.previewUrl = URL.createObjectURL(blob);
  tex.status = 'ok';
  tex.error = '';
  tex.warn = '';
  libTexCheckProportions(form);
}
// Предупреждение, если пропорции картинки не совпадают с размером листа
// (сервер/поля формы). Сама плитка при сохранении подгоняется под картинку
// (userTextures.convertSheet), это только сигнал пользователю.
function libTexCheckProportions(form) {
  const tex = libTexState(form);
  if (tex.kind === 'fragment' || !tex.previewUrl) return;
  const vals = form.values || {};
  const w = Number(tex.sheetW || vals.sheetW), h = Number(tex.sheetH || vals.sheetH);
  if (!(w > 0) || !(h > 0)) return;
  const img = new Image();
  img.onload = () => {
    if (state.libLinkForm !== form || !img.naturalWidth) return;
    const real = Math.max(img.naturalWidth, img.naturalHeight) / Math.min(img.naturalWidth, img.naturalHeight);
    const want = Math.max(w, h) / Math.min(w, h);
    tex.warn = Math.abs(real / want - 1) > 0.05 ? 'Пропорции картинки не совпадают с размером листа — рисунок будет подогнан под картинку.' : '';
    const st = document.querySelector('#libraryPanel .lib-tex-status');
    if (st) st.innerHTML = libTexStatusHtml(form);
  };
  img.src = tex.previewUrl;
}

// Список сайтов-источников текстур — по образцу loadLibLinkSites (тот же токен
// и базовый адрес), но без привязки к перерисовке всей панели: перерисовываем
// только пока открыта форма.
function loadTextureSources() {
  if (state.texSources) return Promise.resolve(state.texSources);
  if (state.texSourcesLoading) return state.texSourcesPromise || Promise.resolve([]);
  const token = getAuthToken();
  if (!token) return Promise.resolve([]);
  state.texSourcesLoading = true;
  state.texSourcesPromise = fetch(`${AUTH_API_BASE}/texture-sources`, { headers: { authorization: 'Bearer ' + token } })
    .then((res) => res.json().catch(() => null).then((data) => ({ ok: res.ok, status: res.status, data })))
    .then(({ ok, status, data }) => {
      const list = Array.isArray(data) ? data : (data && Array.isArray(data.sources) ? data.sources : null);
      state.texSources = ok && list ? list : [];
      state.texSourcesError = ok && list ? null
        : status === 404 ? 'Сервер пока не поддерживает загрузку текстур.'
        : ((data && data.error) || 'Не удалось получить список сайтов с текстурами.');
    })
    .catch(() => {
      state.texSources = [];
      state.texSourcesError = 'Нет связи с сервером — список сайтов с текстурами недоступен.';
    })
    .finally(() => {
      state.texSourcesLoading = false;
      if (state.libLinkForm && document.getElementById('libraryPanel')) libTexRerender();
    })
    .then(() => state.texSources || []);
  return state.texSourcesPromise;
}

// Скачивает лист с сервера -> { blob, w, h } или бросает Error с понятным
// русским текстом (общая функция для формы и для кнопки «Загрузить» в таблице).
async function libTexFetchSheet(siteId, url) {
  const token = getAuthToken();
  if (!token) throw new Error('Войдите в аккаунт, чтобы загрузить текстуру.');
  let res;
  try {
    res = await fetch(`${AUTH_API_BASE}/texture-sheet`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ siteId, url }),
    });
  } catch (err) {
    throw new Error('Нет связи с сервером. Выберите файл с картинкой листа вручную.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error('Слишком много запросов за минуту (не больше 12). Подождите немного и повторите.');
    if (res.status === 404 && !(data && data.error)) throw new Error('Сервер пока не поддерживает загрузку текстур. Выберите файл вручную.');
    throw new Error((data && data.error) || 'Сервер не смог получить картинку листа. Выберите файл вручную.');
  }
  const type = String(res.headers.get('content-type') || '').toLowerCase();
  if (type.indexOf('image/') !== 0) throw new Error('Сервер вернул не картинку. Выберите файл вручную.');
  const blob = await res.blob();
  const w = Number(res.headers.get('x-sheet-width-mm')), h = Number(res.headers.get('x-sheet-height-mm'));
  // kind: 'sheet' (лист/полоса с известным размером) или 'fragment' (кусок декора
  // без масштаба, Kronospan); размеры в заголовках — размеры ИЗОБРАЖЕНИЯ.
  const kind = String(res.headers.get('x-texture-kind') || '').toLowerCase() === 'fragment' ? 'fragment' : 'sheet';
  return { blob, w: w > 0 ? w : null, h: h > 0 ? h : null, kind };
}

// Перерисовка панели с сохранением введённого на экране подтверждения (на шаге
// ввода всё уже зеркалится в form.url/form.tex.url).
function libTexRerender() {
  const box = document.querySelector('#libraryPanel .lib-link-form');
  if (box) libLinkCaptureFormState(box);
  renderLibraryPanel();
}

async function libTexDownload(form) {
  const tex = libTexState(form);
  const site = (state.texSources || []).find((s) => s.id === tex.siteId);
  const url = tex.url.trim();
  if (!site || !url || tex.status === 'loading') return;
  if (!libLinkDomainMatches(url, site.domain)) {
    tex.status = 'error'; tex.error = `Похоже, это не сайт ${site.domain} — проверьте ссылку на декор.`;
    libTexRerender(); return;
  }
  tex.status = 'loading'; tex.error = '';
  tex.loadingSrc = url;
  const reqId = tex.reqId = (tex.reqId || 0) + 1;   // устаревший ответ игнорируем
  libTexRerender();
  try {
    const sheet = await libTexFetchSheet(tex.siteId, url);
    if (state.libLinkForm !== form || tex.reqId !== reqId) return;
    const srcKind = ((state.texSources || []).find((s) => s.id === tex.siteId) || {}).kind;
    libTexSetBlob(form, sheet.blob, url, sheet.w, sheet.h, sheet.kind === 'fragment' || srcKind === 'fragment' ? 'fragment' : 'sheet');
  } catch (err) {
    if (state.libLinkForm !== form || tex.reqId !== reqId) return;
    tex.status = 'error'; tex.error = err.message;
  }
  libTexRerender();
}
function libTexLoading(form) {
  return libTexApplies(form) && !!form.tex && form.tex.status === 'loading';
}

// Код декора Egger (H1145 ST10, F206 ST9, U702 ST9) из наименования/артикула —
// для подсказки «Найти декор … на egger.com». Только подсказка: поиск открывается
// в новой вкладке, ничего не скачивается.
function libTexDecorCode(form) {
  const draft = form.draft || {};
  const text = `${libLinkFieldValue(form, 'name', draft.name || '')} ${libLinkFieldValue(form, 'article', draft.article || '')}`;
  const m = /(?:^|[^A-Za-z0-9])([HFUW]\d{3,4})(?:\s*(ST\s?\d{1,2}))?(?![0-9])/i.exec(text);
  return m ? { code: m[1].toUpperCase(), st: m[2] ? m[2].replace(/\s+/g, '').toUpperCase() : '' } : null;
}

// Строка статуса под полями (точечно обновляется при вводе адреса).
function libTexStatusHtml(form) {
  const tex = libTexState(form);
  if (tex.status === 'loading') return '<span class="hint">Загружаем лист…</span>';
  if (tex.status === 'ok') {
    return `<img class="lib-tex-preview" src="${esc(tex.previewUrl)}" alt="Лист"><span class="hint">Текстура загружена — сохранится на этом компьютере.${tex.warn ? ' <span class="lib-link-warning">' + esc(tex.warn) + '</span>' : ''}</span>`;
  }
  if (tex.status === 'error') return `<span class="hint lib-link-error">${esc(tex.error)}</span>`;
  return '';
}

function libTexBlockHtml(form) {
  if (!libTexApplies(form)) return '';
  const tex = libTexState(form);
  const confirm = form.step === 'confirm';
  const sources = state.texSources || [];
  const loading = state.texSourcesLoading || (state.texSources == null && !!getAuthToken());
  const site = sources.find((s) => s.id === tex.siteId);
  const hint = site ? (site.hint || '') : 'Откройте страницу декора на сайте производителя, найдите вид листа (Plattenansicht) и скопируйте адрес страницы сюда.';
  const domainWarn = tex.url.trim() && site && !libLinkDomainMatches(tex.url, site.domain) ? `Похоже, это не сайт ${site.domain} — проверьте ссылку.` : '';
  let sourcesHtml;
  if (loading) sourcesHtml = '<p class="hint">Загрузка списка сайтов с текстурами…</p>';
  else if (!sources.length) {
    sourcesHtml = `<p class="hint">${esc(getAuthToken() ? (state.texSourcesError || 'Нет доступных сайтов с текстурами.') : 'Войдите в аккаунт, чтобы загрузить текстуру по ссылке.')}</p>`;
  } else {
    // Тот же список, что у продавцов: пункт — ссылка на сайт производителя
    // (открывается в новой вкладке) и одновременно выбор сайта.
    sourcesHtml = `
      ${libSitePickerHtml({ sites: sources, selectedId: tex.siteId, loading: false, label: 'Сайт производителя', emptyText: '', kind: 'tex' })}
      <div class="field"><label>Добавьте ссылку на страницу декора</label>
        <input type="url" class="lib-tex-url" placeholder="${esc((site && site.exampleUrl) || 'https://...')}" value="${esc(tex.url)}">
      </div>
      <p class="hint lib-tex-hint">${esc(hint)}</p>
      <p class="hint lib-link-warning lib-tex-warning">${esc(domainWarn)}</p>`;
  }
  // Подсказка-поиск декора Egger по коду из наименования (после «Проверить»).
  const dc = confirm ? libTexDecorCode(form) : null;
  const findHtml = dc
    ? `<p class="hint"><a class="lib-tex-find" href="${esc('https://www.google.com/search?q=' + encodeURIComponent('site:egger.com ' + dc.code + (dc.st ? ' ' + dc.st : '')))}" target="_blank" rel="noopener">Найти декор ${esc(dc.code)} на egger.com</a></p>`
    : '';
  const canFetch = !!site && !!tex.url.trim() && tex.status !== 'loading';
  const fetchHtml = confirm && sources.length
    ? `<button type="button" class="link-btn lib-tex-fetch" ${canFetch ? '' : 'disabled'}>${tex.status === 'error' ? 'Повторить' : 'Загрузить по ссылке'}</button>` : '';
  // Запасной вариант: сервер не смог скачать лист — картинку можно выбрать файлом.
  const fileHtml = confirm
    ? `<label class="link-btn lib-tex-file-label">Выбрать файл…<input type="file" accept="image/*" class="lib-tex-file" hidden></label>` : '';
  return `
    <div class="lib-tex-block">
      <b>Текстура листа (необязательно)</b>
      ${sourcesHtml}
      ${findHtml}
      <div class="lib-tex-actions">${fetchHtml}${fileHtml}</div>
      <div class="lib-tex-status">${libTexStatusHtml(form)}</div>
    </div>`;
}

// Читает поля блока из DOM в form.tex и точечно правит подсказки/кнопки (без
// перерисовки — иначе слетал бы фокус в поле адреса). Если адрес изменился
// после загрузки листа — загруженная картинка снимается.
function libTexSync(box) {
  const form = state.libLinkForm;
  if (!form || !box || !libTexApplies(form)) return;
  const tex = libTexState(form);
  const urlInput = box.querySelector('.lib-tex-url');
  if (!urlInput) return;
  tex.url = urlInput.value;
  const sources = state.texSources || [];
  // Адрес с домена известного сайта сам выбирает этот сайт.
  if (!sources.some((s) => s.id === tex.siteId && libLinkDomainMatches(tex.url, s.domain))) {
    const byUrl = sources.find((s) => libLinkDomainMatches(tex.url, s.domain));
    if (byUrl) {
      tex.siteId = byUrl.id;
      libSitePickerMark(box.querySelector('.lib-link-site-picker[data-picker="tex"]'), byUrl, tex.siteId);
    }
  }
  const site = sources.find((s) => s.id === tex.siteId);
  if (tex.status === 'loading' && tex.loadingSrc !== tex.url.trim()) {
    tex.reqId = (tex.reqId || 0) + 1;   // ответ на старую ссылку больше не нужен
    tex.status = 'idle'; tex.error = '';
    const st = box.querySelector('.lib-tex-status');
    if (st) st.innerHTML = libTexStatusHtml(form);
  }
  if (tex.blob && tex.blobSrc && tex.blobSrc !== tex.url.trim()) {
    libTexRelease(form);
    tex.blob = null; tex.blobSrc = ''; tex.status = 'idle'; tex.error = '';
    const st = box.querySelector('.lib-tex-status');
    if (st) st.innerHTML = libTexStatusHtml(form);
  }
  const hintEl = box.querySelector('.lib-tex-hint');
  if (hintEl && site && site.hint) hintEl.textContent = site.hint;
  if (urlInput && site && site.exampleUrl) urlInput.placeholder = site.exampleUrl;
  const warnEl = box.querySelector('.lib-tex-warning');
  const domainOk = !!site && libLinkDomainMatches(tex.url, site.domain);
  if (warnEl) warnEl.textContent = tex.url.trim() && site && !domainOk ? `Похоже, это не сайт ${site.domain} — проверьте ссылку.` : '';
  const fetchBtn = box.querySelector('.lib-tex-fetch');
  if (fetchBtn) fetchBtn.disabled = !(domainOk && tex.status !== 'loading');
}

// После добавления материала: сохраняет плитку локально (если лист получен) и
// перерисовывает сцену. Неудача конвертации не отменяет уже сохранённый материал.
function libTexAfterSave(form, group, code, values) {
  const tex = form.tex;
  const ut = window.Modul3D.userTextures;
  if (!tex || !tex.blob || !code || !ut) { libTexRelease(form); return; }
  const blob = tex.blob;
  // Правило выбора размеров (то же в libTexReload): размеры из заголовков
  // сервера — это размеры ИЗОБРАЖЕНИЯ (у Egger полоса 1300x2800, а не весь
  // лист), поэтому они главнее; иначе берём размеры материала из формы (у
  // столешницы это длина/глубина). Пропорции дополнительно сверяет и
  // подгоняет convertSheet по самой картинке.
  const dims = tex.sheetW && tex.sheetH
    ? { sheetW: tex.sheetW, sheetH: tex.sheetH, kind: tex.kind } : { sheetW: values.sheetW, sheetH: values.sheetH, kind: tex.kind };
  libTexRelease(form);
  ut.convertSheet(blob, dims)
    // Материал могли удалить, пока шла конвертация — тогда плитку не сохраняем.
    .then((tile) => (libFindItem(group, code) ? ut.save(code, tile) : null))
    .then(() => renderLibraryPanel())
    .catch((err) => {
      console.warn('Текстура не сохранена:', err);
      window.alert('Материал сохранён, но текстуру листа создать не удалось: ' + err.message);
    });
}

// Резервная копия пользовательских текстур одним файлом (кнопки в верхней
// панели вкладки «Материалы»): картинки лежат только в браузере этого
// компьютера, при очистке данных браузера они пропадут.
function libTexPackBarHtml() {
  return `<span class="lib-tex-pack">
    <button type="button" class="link-btn lib-tex-pack-save" title="Скачать файл со всеми загруженными текстурами листов">Сохранить набор текстур</button>
    <button type="button" class="link-btn lib-tex-pack-load" title="Загрузить ранее сохранённый набор текстур">Загрузить набор текстур</button>
    <input type="file" accept=".json,application/json" class="lib-tex-pack-input" hidden>
  </span>`;
}
function libTexPackSave() {
  const ut = window.Modul3D.userTextures;
  if (!ut) return;
  ut.exportPack().then((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'modul3d-textures.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }).catch((err) => window.alert('Не удалось сохранить набор: ' + err.message));
}
function libTexPackLoad(input) {
  const ut = window.Modul3D.userTextures;
  const file = input.files && input.files[0];
  input.value = '';
  if (!ut || !file) return;
  ut.importPack(file)
    .then((r) => { window.alert(`Загружено: ${r.loaded}, пропущено: ${r.skipped}.`); renderLibraryPanel(); })
    .catch((err) => window.alert('Не удалось загрузить набор: ' + err.message));
}

// Кнопка «Загрузить» рядом с материалом, у которого есть textureUrl, а картинки
// на этом компьютере нет (проект/каталог открыт на другом компьютере).
async function libTexReload(group, key) {
  const it = libFindItem(group, key);
  const ut = window.Modul3D.userTextures;
  if (!it || !it.textureUrl || !it.textureSiteId || !ut) return;
  const code = it.code || key;
  if (state.texBusy[code]) return;
  if (!getAuthToken()) { window.alert('Войдите в аккаунт, чтобы загрузить текстуру.'); return; }
  state.texBusy[code] = true;
  renderLibraryPanel();
  try {
    const sheet = await libTexFetchSheet(it.textureSiteId, it.textureUrl);
    const own = group === 'countertop' ? { sheetW: it.maxLength, sheetH: it.depth } : { sheetW: it.sheetW, sheetH: it.sheetH };
    const dims = sheet.w && sheet.h ? { sheetW: sheet.w, sheetH: sheet.h, kind: sheet.kind } : Object.assign(own, { kind: sheet.kind });
    const tile = await ut.convertSheet(sheet.blob, dims);
    await ut.save(code, tile);
  } catch (err) {
    window.alert('Не удалось загрузить текстуру: ' + err.message);
  } finally {
    delete state.texBusy[code];
    renderLibraryPanel();
  }
}

// Пометка в ячейке названия: текстура задана ссылкой, но картинки на этом
// компьютере нет — материал пока рисуется плоским цветом.
function libTexMissingHtml(group, it) {
  if (!it || !it.textureUrl || !it.textureSiteId || group === 'edge') return '';
  const ut = window.Modul3D.userTextures;
  if (ut && ut.has(it.code)) return '';
  const busy = !!state.texBusy[it.code];
  return `<span class="lib-tex-missing" title="Картинки листа нет на этом компьютере — материал рисуется плоским цветом">нет текстуры на этом компьютере <button type="button" class="link-btn lib-tex-load" data-tex-group="${esc(group)}" data-tex-code="${esc(it.code)}" ${busy ? 'disabled' : ''}>${busy ? 'Загрузка…' : 'Загрузить'}</button></span>`;
}

function libLinkInputStepHtml(form) {
  const site = (state.libLinkSites || []).find((s) => s.id === form.siteId);
  const domainOk = !!site && libLinkDomainMatches(form.url, site.domain);
  const warning = form.url.trim() && site && !domainOk ? `Похоже, это не сайт ${site.domain} — проверьте ссылку.`
    : form.url.trim() && !site ? 'Сначала выберите сайт из списка.' : '';
  return `
    ${libLinkSitePickerHtml(form)}
    <div class="field"><label>Добавьте ссылку на товар</label>
      <input type="url" class="lib-link-url-input" placeholder="https://..." value="${esc(form.url)}">
    </div>
    <p class="hint lib-link-warning">${esc(warning)}</p>
    ${libTexBlockHtml(form)}
    ${form.error ? `<p class="hint lib-link-error">${esc(form.error)}</p>` : ''}
    <div class="lib-leaf-actions">
      <button type="button" class="link-btn lib-link-check" ${domainOk && form.url.trim() ? '' : 'disabled'}>Проверить</button>
      <button type="button" class="link-btn lib-link-cancel">Отмена</button>
    </div>`;
}

function libLinkFormHtml(form) {
  const stepHtml = form.step === 'confirm' ? libLinkConfirmHtml(form)
    : form.step === 'loading' ? '<p class="hint">Получаем данные с сайта…</p>'
    : libLinkInputStepHtml(form);
  return `<div class="lib-link-form">
    <div class="lib-link-form-head"><b>Добавить по ссылке</b>
      <button type="button" class="link-btn lib-link-close" title="Закрыть">Закрыть ×</button>
    </div>
    ${stepHtml}
  </div>`;
}

// Реактивная разблокировка «Проверить»/«Сохранить» (п.5/3.2 ТЗ — кнопка
// сохранения должна быть заблокирована, пока не заполнены обязательные
// поля) — читает значения ПРЯМО из DOM формы при каждом input/change внутри
// неё (и там же зеркалит их в state, см. libLinkCaptureFormState), точечно
// правит disabled/текст подсказки, БЕЗ renderLibraryPanel():
// полная перерисовка на каждое нажатие клавиши стирала бы фокус/курсор в
// текстовом поле (тот же принцип, что и у startCellEdit/libApplyRowSelectionDom
// в других местах этого файла).
function libLinkRevalidate(panel) {
  const form = state.libLinkForm;
  if (!form) return;
  const box = panel.querySelector('.lib-link-form');
  if (!box) return;
  libTexSync(box);   // необязательный блок «Текстура листа» — на оба шага
  if (form.step === 'input') {
    // form.siteId сюда пишет клик по .lib-link-site-item (см.
    // libLinkSitePickerHtml/делегированный click ниже) — здесь его только
    // читаем, DOM-поля для сайта больше нет (не <select>).
    const urlInput = box.querySelector('.lib-link-url-input');
    if (urlInput) form.url = urlInput.value;
    const site = (state.libLinkSites || []).find((s) => s.id === form.siteId);
    const domainOk = !!site && libLinkDomainMatches(form.url, site.domain);
    const warnEl = box.querySelector('.lib-link-warning');
    if (warnEl) {
      warnEl.textContent = form.url.trim() && site && !domainOk ? `Похоже, это не сайт ${site.domain} — проверьте ссылку.`
        : form.url.trim() && !site ? 'Сначала выберите сайт из списка.' : '';
    }
    const checkBtn = box.querySelector('.lib-link-check');
    if (checkBtn) checkBtn.disabled = !(domainOk && form.url.trim());
    return;
  }
  if (form.step === 'confirm') {
    // Сначала зеркалим то, что сейчас в полях, в state (см.
    // libLinkCaptureFormState): revalidate вызывается на каждый input/change
    // внутри формы, поэтому именно здесь ввод пользователя и «закрепляется»
    // так, чтобы пережить любую последующую перерисовку панели.
    libLinkCaptureFormState(box);
    const values = form.values;
    const extra = form.extra;
    const missing = libLinkMissingBasic(values);
    if (form.kind === 'hardware' && !form.hwCategory) missing.push('раздел фурнитуры');
    if (form.kind === 'hardware') missing.push(...libLinkHardwareMissing(form.hwCategory, extra));
    missing.push(...libLinkMaterialDimsMissing(form, values));
    missing.push(...libLinkVariantMissing(form));
    if (form.kind === 'materials' && form.group === 'edge') {
      const cat = window.Modul3D.catalog;
      const nm = (values.name || '').trim();
      if (nm && cat.EDGE_PRICES[nm]) missing.push('кромка с таким названием уже есть');
    }
    const saveBtn = box.querySelector('.lib-link-save');
    const texWait = libTexLoading(form);
    if (saveBtn) {
      saveBtn.disabled = missing.length > 0 || texWait;
      saveBtn.title = texWait ? 'Дождитесь загрузки текстуры' : '';
    }
    const hintEl = box.querySelector('.lib-link-missing-hint');
    if (hintEl) hintEl.textContent = missing.length ? `Заполните: ${missing.join(', ')}.` : '';
    if (form.kind === 'materials') {
      const parentSel = box.querySelector('.lib-link-cat-parent');
      const newSeg = box.querySelector('.lib-link-cat-new');
      const previewEl = box.querySelector('.lib-link-cat-preview');
      if (previewEl) {
        previewEl.textContent = libLinkCategoryPreviewLabel({
          parent: parentSel ? parentSel.value : '',
          newSegment: newSeg ? newSeg.value.trim() : '',
        });
      }
    }
  }
}

// Цена листового материала с сайта -> sheetPrice (цена ЗА ЛИСТ, её делит на
// площадь libPricePerM2 и умножает на число листов specification.js).
// Магазины (mobilier.md и др.) показывают цену ЛДСП/МДФ за м², поэтому по
// умолчанию умножаем на площадь листа; как есть берём, только если единица
// явно «лист» («шт» не считаем: парсеры сервера ставят «шт» и тогда, когда
// сайт единицу не указал вовсе). Раньше цена за м² писалась в sheetPrice напрямую — и
// колонка «за м²» делила её на площадь второй раз (v309).
function libLinkSheetPriceFromSite(price, unit, sheetW, sheetH) {
  if (price == null || !Number.isFinite(Number(price))) return price;
  if (unit === 'лист') return Number(price);
  const area = (Number(sheetW) / 1000) * (Number(sheetH) / 1000);
  if (!(area > 0)) return Number(price);
  return Math.round(Number(price) * area * 100) / 100;
}

// Сохранение материала «по ссылке» — та же ветвь по group, что и в libAddRow,
// только значения берутся из формы (values/categoryPath), а не из дефолтов
// «Новый материал», плюс sourceUrl/sourceSiteId/verifiedAt (п.1.7/5 ТЗ).
function libLinkSaveMaterial(form, values, categoryPath) {
  const cat = window.Modul3D.catalog;
  // «Раздел каталога» на экране подтверждения предлагает ЛЮБой путь всего
  // дерева form.top (см. libLinkParentOptionsHtml/libAllPaths), а не только
  // детей той ветки, из которой открыли форму (или вообще без ветки — см.
  // libLinkTopBarHtml, точка входа сверху вкладки «Материалы» всегда
  // top:'sheet'/group:'decors'). Внутри объединённой категории «Листовые
  // материалы» (top === 'sheet') пользователь мог выбрать/вписать совсем
  // другую ветку — берём группу ПО ИТОГОВОМУ первому сегменту выбранного
  // пути (та же карта SHEET_ADD_GROUP_MAP, что и у «+ Добавить материал» в
  // libLeafTableHtml), иначе позиция ушла бы не в тот массив каталога
  // (например, МДФ-плита осела бы в DECORS) и не находилась бы там, где её
  // ждут роль-специфичные подборы материала (декор корпуса/фасада/задней
  // стенки). Для facade/edge/countertop такой неоднозначности нет — там
  // group всегда однозначно равна top.
  const group = form.top === 'sheet' ? (SHEET_ADD_GROUP_MAP[categoryPath[0]] || form.group || 'decors') : form.group;
  const name = values.name.trim();
  const price = Number(values.price);
  const unit = values.unit || 'м²';
  const article = (values.article || '').trim();
  const brand = (values.brand || '').trim();
  // Фото комбинации, если у выбранного варианта оно своё (см.
  // libLinkSelectedImageUrl) — то же, что показано на экране подтверждения.
  const image = libLinkSelectedImageUrl(form);
  // variant — выбранная комбинация вариативного товара (см.
  // libLinkSelectedVariantInfo): по её values «Обновить цены с сайта» позже
  // найдёт ИМЕННО эту комбинацию, а не нижнюю границу диапазона.
  const variant = libLinkSelectedVariantInfo(form);
  // Предупреждение парсера про диапазон цен (draft.priceNote) в саму позицию
  // не кладём: с 2026-09-17 в таблицах «Библиотеки» оно не показывается
  // (см. libPriceNoteHtml), а копить в данных поле, которого нигде не видно,
  // незачем. В форме «Добавить по ссылке» оно осталось — там цену ещё можно
  // уточнить до сохранения.
  const numOr = (v, def) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : def; };
  const numOrNull = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  // sourceName/sourceArticle — что именно подставилось с сайта (см.
  // libLinkSourceFields): без них «Обновить цены с сайта» не отличит ручное
  // переименование позиции от сайтового имени и затрёт правку пользователя.
  const common = Object.assign({ sourceUrl: form.url, sourceSiteId: form.siteId, verifiedAt: new Date().toISOString() },
    libLinkSourceFields(form));
  if (variant) common.variant = variant;
  // Текстура листа (необязательный блок формы): в материал уходят только адрес
  // страницы декора и сайт; сама картинка — в IndexedDB этого компьютера
  // (см. libTexAfterSave). Для кромки текстуры нет.
  const tex = libTexApplies(form) && group !== 'edge' ? libTexState(form) : null;
  const texSite = tex ? (state.texSources || []).find((s) => s.id === tex.siteId) : null;
  if (tex && texSite && tex.url.trim() && libLinkDomainMatches(tex.url, texSite.domain)) {
    common.textureUrl = tex.url.trim();
    common.textureSiteId = tex.siteId;
  }
  let newCode = null;   // code новой позиции — под ним же лежит текстура
  // decors/back/facade: values.sheetW/sheetH к этому моменту уже проверены
  // libLinkMaterialDimsMissing (кнопка «Сохранить» и не дала бы дойти сюда
  // без них) — numOr(...) ниже больше не «угадывает» реальный размер листа,
  // это лишь защита от гонки (как и проверка cat.EDGE_PRICES[name] у edge
  // ниже), а не рабочий путь.
  if (group === 'decors') {
    const sheetW = numOr(values.sheetW, 2750), sheetH = numOr(values.sheetH, 1830);
    newCode = 'LINK-' + Date.now();
    DECORS.push(Object.assign({ code: newCode, name,
      sheetPrice: libLinkSheetPriceFromSite(price, unit, sheetW, sheetH), sheetW, sheetH,
      thickness: numOrNull(values.thickness), unit, image, article, categoryPath }, common));
  } else if (group === 'back') {
    const sheetW = numOr(values.sheetW, 2440), sheetH = numOr(values.sheetH, 1220);
    newCode = 'LINK-' + Date.now();
    BACK_MATERIALS.push(Object.assign({ code: newCode, name,
      sheetPrice: libLinkSheetPriceFromSite(price, unit, sheetW, sheetH), sheetW, sheetH,
      thickness: numOr(values.thickness, 3), unit, image, article, categoryPath }, common));
  } else if (group === 'facade') {
    const code = newCode = 'FAC-LINK-' + Date.now();
    const sheetW = numOr(values.sheetW, 2750), sheetH = numOr(values.sheetH, 1830);
    cat.FACADE_MATERIALS[code] = Object.assign({ code, name,
      sheetPrice: libLinkSheetPriceFromSite(price, unit, sheetW, sheetH), sheetW, sheetH,
      thickness: numOrNull(values.thickness), unit, image, article, categoryPath }, common);
  } else if (group === 'edge') {
    if (cat.EDGE_PRICES[name]) return; // защита от гонки — кнопка и так должна была быть disabled
    cat.EDGE_PRICES[name] = Object.assign({ price, unit: 'пог.м',
      width: numOrNull(values.sheetH), thickness: numOrNull(values.thickness),
      image, article, categoryPath }, common);
  } else if (group === 'countertop') {
    if (!cat.COUNTERTOP_MATERIALS) cat.COUNTERTOP_MATERIALS = [];
    const materialId = COUNTERTOP_MATERIAL_LABEL_TO_ID[categoryPath[0]] || 'ldsp38';
    const ctBrand = categoryPath[1] || brand || 'Новый бренд';
    newCode = 'CTOP-LINK-' + Date.now();
    cat.COUNTERTOP_MATERIALS.push(Object.assign({ code: newCode, materialId, brand: ctBrand,
      name, thickness: numOr(values.thickness, 38), depth: numOr(values.sheetH, 600),
      pricePerMeter: price, maxLength: numOr(values.sheetW, 4100), unit: 'пог.м', image, article }, common));
  } else {
    return;
  }
  if (tex) libTexAfterSave(form, group, newCode, values);
  state.libLinkForm = null;
  recompute();
  scheduleCatalogSave();
  renderLibraryPanel();
}

// Сохранение фурнитуры «по ссылке» — та же ветвь по категории, что и в
// libAddHardwareRow, плюс инженерные поля из формы (п.3.2 ТЗ) и sourceUrl/
// sourceSiteId/verifiedAt. Ключ 'link_<категория>_<timestamp>' — тот же
// принцип, что у 'custom_<категория>_<timestamp>' в libAddHardwareRow, просто
// с другим префиксом, чтобы отличать в данных, откуда взялась позиция.
// subField — та же логика, что и в libAddHardwareRow: form.path (см.
// data-link-path в libHardwareLeafTableHtml) — путь ветки, под которой
// нажали «+ Добавить по ссылке»; у 'mechanism' (LIFTS) фирма хранится в поле
// brand, у остальных — в subcategory (см. libHardwareTopEntries).
function libLinkSaveHardware(form, values, extra) {
  const cat = window.Modul3D.catalog;
  const category = form.hwCategory;
  const name = values.name.trim();
  const price = Number(values.price) || 0;
  const article = (values.article || '').trim();
  const unit = values.unit || 'шт';
  const key = 'link_' + category + '_' + Date.now();
  // Путь ветки, под которой нажали «+ Добавить по ссылке» — целиком, а не
  // только form.path[0]: с 2026-09-16 дерево фурнитуры может быть глубже
  // одного уровня (см. libAddHardwareRow/libHardwareTopEntries), и позиция
  // должна попасть ровно туда, откуда её добавляли.
  const hwPath = Array.isArray(form.path) ? form.path.slice() : [];
  const subcategory = hwPath.length ? hwPath[hwPath.length - 1] : '';
  const subField = Object.assign({ categoryPath: hwPath },
    subcategory ? (category === 'mechanism' ? { brand: subcategory } : { subcategory }) : {});
  // variant — выбранная комбинация вариативного товара, как и у материалов
  // (см. libLinkSaveMaterial): по ней «Обновить цены с сайта» позже найдёт
  // ИМЕННО эту комбинацию. А предупреждение парсера про диапазон цен
  // (draft.priceNote) не сохраняем — в таблице фурнитуры его больше не
  // показывают (см. libPriceNoteHtml), только в форме добавления по ссылке.
  const variant = libLinkSelectedVariantInfo(form);
  // sourceName/sourceArticle — то же, что у материалов (см.
  // libLinkSourceFields/libLinkSaveMaterial): «Обновить цены с сайта» по ним
  // отличает ручное переименование позиции от сайтового имени.
  const common = Object.assign({ name, article, price, unit, category,
    sourceUrl: form.url, sourceSiteId: form.siteId, verifiedAt: new Date().toISOString() },
    libLinkSourceFields(form), variant ? { variant } : {}, subField);
  if (category === 'mechanism') {
    cat.LIFTS[key] = Object.assign({ id: key, brand: '', minH: Number(extra.minH) || 0,
      maxH: Number(extra.maxH) || 0, maxW: Number(extra.maxW) || 0, note: '' }, common);
  } else if (category === 'handle') {
    cat.HANDLES[key] = Object.assign({ id: key, holes: Number(extra.holes) || 2, cc: Number(extra.cc) || 0 }, common);
  } else if (category === 'fastener') {
    cat.FASTENER_PRICES[key] = common;
  } else if (category === 'hinge') {
    cat.HARDWARE_PRICES[key] = Object.assign({ hardwareModelSlot: extra.hardwareModelSlot }, common);
  } else {
    cat.HARDWARE_PRICES[key] = common;
  }
  state.libLinkForm = null;
  recompute();
  scheduleCatalogSave();
  renderLibraryPanel();
}

// «Сохранить» экрана подтверждения — снимает последний срез полей формы в
// state (libLinkCaptureFormState) и дальше работает уже с ним (form.values/
// form.extra/form.variantSel), перепроверяет обязательные поля (защита от
// гонки, кнопка и так должна быть disabled) и передаёт в нужную ветку
// сохранения.
function libLinkSaveSubmit(panel) {
  const form = state.libLinkForm;
  if (!form || form.step !== 'confirm') return;
  if (libTexLoading(form)) return;   // текстура ещё грузится — «Сохранить» заблокирована
  const box = panel.querySelector('.lib-link-form');
  if (!box) return;
  // Перед самой записью ещё раз снимаем срез полей (libLinkCaptureFormState) —
  // так сохраняется РОВНО то, что видно на экране, включая выбранный вариант.
  libLinkCaptureFormState(box);
  const values = form.values;
  const extra = form.extra;
  const missing = libLinkMissingBasic(values)
    .concat(form.kind === 'hardware' && !form.hwCategory ? ['раздел фурнитуры'] : [])
    .concat(form.kind === 'hardware' ? libLinkHardwareMissing(form.hwCategory, extra) : [])
    .concat(libLinkMaterialDimsMissing(form, values))
    .concat(libLinkVariantMissing(form));
  if (form.kind === 'materials' && form.group === 'edge') {
    const cat = window.Modul3D.catalog;
    if (cat.EDGE_PRICES[(values.name || '').trim()]) missing.push('кромка с таким названием уже есть');
  }
  if (missing.length) { libLinkRevalidate(panel); return; }
  if (form.kind === 'hardware') {
    libLinkSaveHardware(form, values, extra);
    return;
  }
  const parentSel = box.querySelector('.lib-link-cat-parent');
  const newSegInput = box.querySelector('.lib-link-cat-new');
  const parentPath = parentSel && parentSel.value ? parentSel.value.split('::') : [];
  const newSeg = newSegInput ? newSegInput.value.trim() : '';
  const categoryPath = newSeg ? parentPath.concat([newSeg]) : parentPath;
  libLinkSaveMaterial(form, values, categoryPath);
}

// Все позиции каталога (все шесть материальных массивов/объектов + четыре
// источника фурнитуры), у которых есть непустой sourceUrl — то, что умеет
// обновить «Обновить цены с сайта» (п.1.8/5 ТЗ). Возвращает { item, siteId }
// — item ссылка на САМ объект каталога (мутируется на месте, как и везде в
// этом файле), siteId — либо уже сохранённый it.sourceSiteId (позиция
// добавлена через форму «Добавить по ссылке», см. libLinkSaveMaterial/
// libLinkSaveHardware), либо вычисленный на лету по домену sourceUrl (см.
// libLinkResolveSiteId) — 72 встроенные позиции каталога (DECORS/
// BACK_MATERIALS/FACADE_MATERIALS/HARDWARE_PRICES/HANDLES/LIFTS и т.д. из
// catalog.js, цены сверены с mobilier.md ещё до появления формы «Добавить по
// ссылке») несут sourceUrl без sourceSiteId. Ни с одним известным сайтом
// (state.libLinkSites — должен быть уже загружен ДО вызова, см.
// refreshCatalogLinkedPrices) домен не совпал — позицию молча пропускаем, а
// не считаем ошибкой (например, будущая ссылка на магазин без парсера).
function libLinkedItemsList() {
  const cat = window.Modul3D.catalog;
  const list = [];
  const add = (it) => {
    if (!it || !it.sourceUrl) return;
    const siteId = it.sourceSiteId || libLinkResolveSiteId(it.sourceUrl);
    if (!siteId) return;
    list.push({ item: it, siteId });
  };
  const addArr = (arr) => (arr || []).forEach(add);
  const addObj = (obj) => Object.keys(obj || {}).forEach((k) => add(obj[k]));
  addArr(DECORS);
  addArr(BACK_MATERIALS);
  addObj(cat.FACADE_MATERIALS);
  addObj(cat.EDGE_PRICES);
  addArr(cat.COUNTERTOP_MATERIALS);
  addObj(cat.HARDWARE_PRICES);
  addObj(cat.HANDLES);
  addObj(cat.LIFTS);
  addObj(cat.FASTENER_PRICES);
  return list;
}

// Сервер принимает не больше ~60 позиций за один запрос (п.1.8 ТЗ, см.
// server/src/routes/catalogLinks.js: MAX_REFRESH_ITEMS, по умолчанию 60) —
// при большем каталоге режем на партии этого размера и шлём последовательно,
// а не падаем целиком с «слишком много позиций». 50, а не 60 — небольшой
// запас на случай, если сервер настроен на меньший лимит (переменная
// окружения CATALOG_LINK_MAX_REFRESH_ITEMS), клиент не может узнать её заранее.
const LIB_LINK_REFRESH_CHUNK = 50;

// Переносит свежий черновик с сайта в позицию каталога — общий «хвост»
// «Обновить цены с сайта» (см. ниже). Возвращает true, если позицию реально
// удалось обновить.
//
// Вариативный товар (it.variant — комбинация, выбранная при добавлении, см.
// libLinkSelectedVariantInfo): цену берём ИМЕННО у этой комбинации, а не из
// draft.price — там нижняя граница диапазона, и «обновление» молча уронило
// бы цену до самой дешёвой комбинации. Ищем ту же комбинацию ТОЙ ЖЕ
// libLinkFindVariant, что и экран подтверждения, — второго правила
// сопоставления в проекте нет. Комбинация исчезла с сайта (вариант сняли с
// продажи) или сайт не отдал её цену — позицию не трогаем вовсе: выдумывать
// цену нельзя, пусть попадёт в «не найдено» отчёта и пользователь решит сам.
//
// Наименование и артикул: ЦЕНУ пользователь просил обновлять всегда, а вот
// СВОЁ название — не трогать (ровно с этой жалобы и началась задача: ручная
// правка «Опора …, 100мм» затиралась сайтовой при каждом обновлении). Отличить
// своё название от сайтового позволяет it.sourceName/it.sourceArticle — копия
// того, что подставилось с сайта в момент сохранения (см. libLinkSourceFields):
// совпадает с текущим значением — пользователь его не менял, подтягиваем
// свежее; не совпадает — это его правка, оставляем как есть. Сам sourceName
// в любом случае приводим к актуальному сайтовому, иначе после первого же
// расхождения сравнение навсегда осталось бы ложным.
function libLinkApplyRefreshedDraft(it, d, siteId) {
  const variantSel = it.variant && it.variant.values;
  let chosen = null;
  if (variantSel) {
    chosen = libLinkFindVariant(d.variants, variantSel);
    if (!chosen || chosen.price == null) return false;
  }
  const price = chosen ? chosen.price : d.price;
  // Имя вариативной позиции хранится с суффиксом комбинации («… — H, мм: 100,
  // Цвет: Сатин») — достраиваем его заново из сохранённой подписи, иначе
  // обновление схлопнуло бы названия всех вариантов товара в одно общее.
  const freshName = d.name != null ? (variantSel ? libLinkNameWithVariant(d.name, it.variant.label) : d.name) : null;
  const freshArticle = chosen && chosen.article ? chosen.article : d.article;
  libLinkApplyIfUntouched(it, 'name', 'sourceName', freshName);
  libLinkApplyIfUntouched(it, 'article', 'sourceArticle', freshArticle);
  if (price != null) {
    if (it.sheetPrice !== undefined) {
      // customOrder (стекло/массив под заказ) хранит в sheetPrice цену за м²
      // сам по себе — пересчёт в лист только у обычных листов (см.
      // libLinkSheetPriceFromSite).
      if (it.customOrder || !it.sheetW || !it.sheetH) it.sheetPrice = price;
      else {
        const siteUnit = d.unit === 'лист' ? 'лист' : 'м²';
        it.sheetPrice = libLinkSheetPriceFromSite(price, siteUnit, it.sheetW, it.sheetH);
        it.unit = siteUnit;
      }
    } else if (it.pricePerMeter !== undefined) it.pricePerMeter = price;
    else it.price = price;
  }
  // Пометку о неточной цене (item.priceNote) обновление НИКОГДА не ставит
  // заново — иначе оно возвращало бы предупреждение, которое пользователь уже
  // снял ручной правкой цены (см. libClearPriceNote). Наоборот: если у позиции
  // выбран вариант, его цена только что пришла с сайта точной (см. проверку
  // chosen.price выше) — предупреждение про диапазон («цена от … до …») стало
  // неправдой, снимаем. Нужно это только позициям, сохранённым ДО v279:
  // libLinkSaveMaterial/libLinkSaveHardware такую пометку в позицию больше
  // вообще не пишут. Без byUser: это не ручная проверка пользователем.
  if (chosen) libClearPriceNote(it);
  // Позиция могла быть без sourceSiteId (встроенный каталог из mobilier.md,
  // см. libLinkedItemsList) — теперь, когда она сама подтвердилась по домену
  // и успешно обновилась, фиксируем id сайта явно: дальше её уже не нужно
  // резолвить заново.
  it.sourceSiteId = siteId;
  it.verifiedAt = new Date().toISOString();
  return true;
}

// «Обновить цены с сайта» — ОДНА кнопка на весь каталог пользователя (п.1.8
// ТЗ, не по кнопке на каждую позицию): собирает все sourceUrl-позиции разом
// и обновляет результатом те же объекты каталога. Поле цены определяем по
// тому, какое у позиции реально есть (sheetPrice/pricePerMeter/price) — тот
// же набор полей, что использует вся остальная «Библиотека» (см.
// libPriceFieldOf). Если партий несколько и одна из них упала по сети —
// то, что успело обновиться в предыдущих партиях, всё равно пересчитывается
// и сохраняется (см. finally), а не откатывается целиком.
async function refreshCatalogLinkedPrices() {
  if (!requireLibraryEditAuth()) return;
  if (state.libLinkRefreshBusy) return;
  state.libLinkRefreshBusy = true;
  state.libLinkRefreshResult = null;
  renderLibraryPanel();
  // Список сайтов (state.libLinkSites) обычно уже загружен к этому моменту —
  // форма «Добавить по ссылке» подгружает его при первом открытии (см.
  // loadLibLinkSites). Но пользователь мог нажать «Обновить цены с сайта»,
  // ни разу не открыв ту форму, — тогда libLinkedItemsList() ниже не сможет
  // вычислить sourceSiteId встроенных позиций каталога (у них его никогда не
  // было, см. комментарий там же) и молча пропустит вообще всё. Дожидаемся
  // загрузки явно, прежде чем считать список позиций для обновления.
  if (!state.libLinkSites) await loadLibLinkSites();
  const entries = libLinkedItemsList();
  if (!entries.length) {
    state.libLinkRefreshBusy = false;
    renderLibraryPanel();
    window.alert('В каталоге нет позиций со ссылкой на известный сайт-источник — обновлять нечего.');
    return;
  }
  const token = getAuthToken();
  let updated = 0;
  let failed = 0;
  let requestError = null;
  try {
    for (let i = 0; i < entries.length; i += LIB_LINK_REFRESH_CHUNK) {
      const chunk = entries.slice(i, i + LIB_LINK_REFRESH_CHUNK);
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${AUTH_API_BASE}/catalog-link-refresh`, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ items: chunk.map((e) => ({ url: e.item.sourceUrl, siteId: e.siteId })) }),
      });
      // eslint-disable-next-line no-await-in-loop
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Не удалось обновить цены.');
      const results = Array.isArray(data.results) ? data.results : [];
      results.forEach((r) => {
        const matches = chunk.filter((e) => e.item.sourceUrl === r.url && e.siteId === r.siteId);
        if (r.ok && r.draft) {
          matches.forEach((e) => {
            // Позиция могла не обновиться и при успешном ответе — если у неё
            // выбран вариант, а комбинация с сайта пропала (см.
            // libLinkApplyRefreshedDraft): считаем её такой же неудачной, как
            // и позицию, которую сервер вообще не смог прочитать.
            if (libLinkApplyRefreshedDraft(e.item, r.draft, e.siteId)) updated += 1;
            else failed += 1;
          });
        } else {
          failed += matches.length || 1;
        }
      });
    }
  } catch (err) {
    requestError = err.message;
  } finally {
    // Хоть что-то успело обновиться (в т.ч. если упала не первая партия) —
    // пересчитываем и сохраняем сразу, не дожидаясь следующей правки каталога.
    // libLinkApplyRefreshedDraft может незаметно обновить и НАЗВАНИЕ позиции
    // (если пользователь его не трогал, см. libLinkApplyIfUntouched) — код при
    // этом не меняется, а decorLook() (viewer.js) красит миниатюру именно по
    // имени, поэтому _thumbCache Библиотеки тоже сбрасываем.
    if (updated > 0) { recompute(); _thumbCache.clear(); scheduleCatalogSave(); }
    state.libLinkRefreshResult = requestError ? { updated, failed, error: requestError } : { updated, failed };
    state.libLinkRefreshBusy = false;
    renderLibraryPanel();
  }
}

// Содержимое кнопки «Обновить цены с сайта» + статус — сама «настоящая»
// кнопка (класс .btn, тот же, что у #saveProjectBtn/#openProjectBtn в
// шапке, см. style.css), а не мелкая текстовая ссылка .link-btn: это
// primary-действие уровня вкладки («перепроверить цены во всём каталоге»),
// а не построчная правка. Обёртку-контейнер рисует libLinkTopBarHtml ниже —
// там же вторая такая кнопка, «+ Добавить по ссылке» без контекста.
function libLinkRefreshBarHtml() {
  const busy = state.libLinkRefreshBusy;
  const result = state.libLinkRefreshResult;
  let statusHtml = '';
  if (busy) statusHtml = '<span class="hint">Обновляем цены…</span>';
  else if (result && result.error) {
    // Партиями по LIB_LINK_REFRESH_CHUNK (см. refreshCatalogLinkedPrices) —
    // если упала не первая партия, часть позиций уже успела обновиться,
    // показываем и то, и другое, а не только ошибку.
    const partial = result.updated || result.failed ? ` (успели обновить: ${result.updated}, не найдено: ${result.failed})` : '';
    statusHtml = `<span class="hint lib-link-error">Не удалось обновить всё: ${esc(result.error)}${esc(partial)}</span>`;
  } else if (result) statusHtml = `<span class="hint">Обновлено: ${result.updated} · не найдено: ${result.failed}.</span>`;
  return `<button type="button" class="btn lib-link-refresh-btn" ${busy ? 'disabled' : ''}>Обновить цены с сайта</button>${statusHtml}`;
}

// Верхняя панель вкладки «Материалы»/«Фурнитура» — ОДНА явная, заметная
// точка входа «+ Добавить по ссылке» СРАЗУ под заголовком вкладки, рядом с
// «Обновить цены с сайта» (см. libLinkRefreshBarHtml выше). Раньше кнопку
// добавления по ссылке было видно, только провалившись в конкретный лист
// дерева материалов/раздел фурнитуры (см. .lib-add-by-link в
// libLeafTableHtml/libraryHardwareBlock, эти кнопки остаются как есть, это
// ДОПОЛНИТЕЛЬНАЯ точка входа, не замена) — пользователь, открывший вкладку
// впервые, не понимал, куда вставить ссылку на товар.
//
// У материалов — фиксированный контекст top:'sheet'/group:'decors' (самый
// частый случай, см. addDefaultGroup в libraryMaterialsBlock): «Раздел
// каталога» на экране подтверждения всё равно предложит выбрать/вписать
// ЛЮБую ветку дерева «Листовые материалы» (см. libLinkParentOptionsHtml —
// список не ограничен детьми одной ветки), а итоговый массив каталога
// (decors/facade/back) пересчитывается по факту выбора — см.
// libLinkSaveMaterial. У фурнитуры контекста нет вовсе (data-link-hwcat не
// проставлен) — раздел («Петли»/«Ручки»/... ) выбирается на самом экране
// подтверждения, см. hwCatHtml в libLinkConfirmHtml.
//
// «Добавить категорию» стоит в этом же ряду у обеих вкладок — это тоже
// действие уровня вкладки, а не строки таблицы: заводит СВОЮ корневую
// категорию (см. libAddHwCategory/libAddMaterialCategory). У «Материалов»
// это одна и та же decor-таблица для ЛЮБОЙ своей категории (см.
// state.libMatCustomCats) — встроенные четыре раздела (Листовые материалы /
// Кромка / Стекло / Столешницы) по-прежнему нет, там тип товара завязан на
// группу каталога; всё, что ниже корня встроенного раздела, там по-прежнему
// заводится значком «+» на самой строке дерева.
function libLinkTopBarHtml(kind) {
  const addAttrs = kind === 'hardware'
    ? 'data-link-kind="hardware"'
    : 'data-link-kind="materials" data-link-top="sheet" data-link-group="decors"';
  return `<div class="lib-link-refresh-bar">
    <button type="button" class="btn lib-add-by-link" ${addAttrs}>+ Добавить по ссылке</button>
    ${libAddCatTileHtml(kind)}
    ${libLinkRefreshBarHtml()}
    ${kind === 'materials' ? libTexPackBarHtml() : ''}
  </div>`;
}

// Кнопка-плитка «Добавить категорию» — маленький квадрат с пунктирной рамкой
// и синим «+» по центру (тот же визуальный язык, что у «+ Добавить модуль»/
// «+ Добавить секцию», см. .mod-add/.sec-add в style.css), без подписи
// текстом: сама операция (завести пустую именованную категорию) настолько
// простая, что не нуждается в тексте, а текстовая кнопка рядом с «+ Добавить
// по ссылке»/«Обновить цены с сайта» спорила бы с ними за внимание. Раньше
// была текстовой ТОЛЬКО у «Фурнитуры» (.lib-add-hw-cat) — теперь один и тот
// же стиль и один обработчик (см. .lib-add-cat-tile в initLibraryPanel) у всех
// четырёх вкладок «Библиотеки», включая «Базу модулей» (см. libraryBlock),
// у которой нет ни каталога, ни дерева, только своя пустая категория.
// kind — 'hardware'|'materials'|'facades'|'modules', читает обработчик клика.
function libAddCatTileHtml(kind) {
  return `<button type="button" class="lib-add-cat-tile" data-add-cat="${esc(kind)}" title="Добавить категорию" aria-label="Добавить категорию">+</button>`;
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
  // Миниатюры Библиотеки (_thumbCache, см. libModThumbDataUrl) кэшируются по
  // коду материала, а не по имени — но реальный цвет/текстуру в renderThumbnail
  // определяет decorLook() (viewer.js) по РЕГЭКСПУ ИМЕНИ («дуб»/«лдсп»/«бел» и
  // т.п.), а код при переименовании не меняется. Правка любого поля здесь
  // (не только name — categoryPath/image тоже видны в других местах) может
  // сделать закэшированную картинку неактуальной, поэтому сбрасываем кэш
  // целиком: дёшево, и не нужно гадать, какая именно правка задела регэксп.
  _thumbCache.clear();
  // Правка ЦЕНЫ (а не названия/размеров/единицы измерения) снимает пометку о
  // неточной цене — см. libClearPriceNote/LIB_PRICE_EDIT_FIELDS. Проверяем сам
  // факт подтверждения ячейки, а не изменение значения: подтвердить то же
  // число — тоже «я проверил цену». С экрана пометка уходит сразу, её рисует
  // renderLibraryPanel() в конце этой же функции.
  if (LIB_PRICE_EDIT_FIELDS.indexOf(field) >= 0) libClearPriceNote(it, true);
  // Толщина задней стенки кэшируется в state.backThickness в момент выбора
  // материала (см. libPickMaterial, роль 'back') — если сейчас правят толщину
  // именно того материала, что уже выбран как задняя стенка проекта, нужно
  // обновить и state.backThickness той же точкой, иначе правка через
  // «Библиотеку» применится только после повторного выбора материала.
  if (group === 'back' && field === 'thickness' && key === state.backCode) {
    state.backThickness = value;
  }
  // Каталог — не часть snapshot()/файла проекта, полный recompute() не
  // обязателен для пересчёта чисел, но нужен, чтобы обновить спецификацию
  // (новая цена) и деталировку (переименованный материал) на лету.
  recompute();
  // Фурнитура (group вида 'hw:*') с 2026-09-15 тоже входит в снимок каталога
  // (см. snapshotCatalogCollections/restoreCatalogFrom — добавлено вместе с
  // фичей «Добавить по ссылке», иначе позиции фурнитуры, добавленные по
  // ссылке, не переживали бы перезагрузку страницы), поэтому сохраняем
  // безусловно, как и остальные группы.
  scheduleCatalogSave();
  renderLibraryPanel();
}

// Роли подбора материала проекта (см. state.libPickTarget/openMaterialPicker)
// с копированием читают только ДВА массива каталога: decor — DECORS (декор
// корпуса), back — BACK_MATERIALS; выбранная строка из другого массива
// копируется в целевой (см. libPickMaterial ниже). facadeDecor,
// countertopDecor, facadeMaterial и aluFill сюда НЕ входят — они ссылаются
// на код из ЛЮБОГО списка каталога напрямую, без копирования (копия раньше
// плодила видимый дубль в Библиотеке, 2026-09-06). Кнопок «Удалить материал»
// под полями больше нет (2026-09-26) — удаление только в самой Библиотеке.
// facadeDecor («Видимая боковина», 2026-09-26) тоже ссылается на код
// напрямую: можно выбрать ЛДСП или фасадную МДФ-панель из FACADE_MATERIALS
// (engine.visibleSideMaterialOptions), ядро находит его по коду во всех
// списках (findMaterialByCode, см. buildProject/recompute: facadeDecor).
const LIB_PICK_ROLE_GROUP = { decor: 'decors', back: 'back' };
// Что можно выбрать в «Видимую боковину» — из ядра (ЛДСП/ДСП + МДФ-панели).
function visibleSideOptionsOf() {
  const engine = window.Modul3D.engine;
  return engine && typeof engine.visibleSideMaterialOptions === 'function' ? engine.visibleSideMaterialOptions() : [];
}
// Что можно выбрать в проектный «Материал фасада» (state.facadeMatCode) —
// это умолчание именно ЛДСП-фасада, поэтому список вида 'ldsp' из ядра.
function facadeMatOptionsOf() {
  return facadeMaterialOptionsOf('ldsp');
}

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
  if (target.role === 'aluFill') {
    // Заполнение рамки в КОНСТРУКТОРЕ алюм. фасада (state.aluDraft, см.
    // libAluConstructorHtml) — код пишется в черновик, в проект он попадёт
    // только по «Выбрать» конструктора. После выбора — обратно в конструктор,
    // цель подбора фасада (target.parent — секция/отсек) восстанавливается.
    if (!aluFillPickAllowed(code)) return;
    const draft = aluDraftGet();
    draft.aluFill = code;
    aluDraftNormalize();
    state.libPickTarget = target.parent && facadeTargetInfo(target.parent) ? target.parent : null;
    libShowAluConstructor();
    return;
  }
  if (target.role === 'partMaterial') {
    // Материал ОДНОЙ детали с экрана «Деталь» (фокусный режим) — код НАПРЯМУЮ
    // в mod.partOverrides[key].materialOverride (ядро ищет код во всех
    // списках: applyPartOverrides/sideT → aluFillMaterial), без копии в
    // другой массив. Толщина — из каталога в thicknessOverride (потом её
    // можно поправить вручную полем «Толщина»). Другие детали не трогаем.
    const opt = partMaterialOptionsOf(target.kind).filter((o) => o.code === code)[0];
    if (!opt) return;
    const mod = partPickTargetModule(target);
    if (!mod) { state.libPickTarget = null; renderLibraryPanel(); return; }
    mod.partOverrides = mod.partOverrides || {};
    const ov = mod.partOverrides[target.key] = mod.partOverrides[target.key] || {};
    ov.materialOverride = code;
    if (opt.thickness > 0) ov.thicknessOverride = opt.thickness; else delete ov.thicknessOverride;
    state.activeModule = state.modules.indexOf(mod);
    libPickReturnToParams(target, null);
    return;
  }
  if (target.role === 'facadeMaterial') {
    // Материал фасада секции/отсека (ldsp/mdf/glass4) — код пишется НАПРЯМУЮ
    // в sec.facadeMaterial или sec.doorZones[zi].facadeMaterial (ядро ищет
    // материал по коду во всех списках, см. engine.facadeMaterialPick), без
    // копии в другой массив.
    const info = facadeTargetInfo(target);
    if (!info) { state.libPickTarget = null; renderLibraryPanel(); return; }
    if (!facadeMaterialOptionsOf(info.ftId).some((o) => o.code === code)) return;
    const store = info.zi == null ? info.sec : ensureDoorZone(info.sec, info.zi);
    if (!store) { state.libPickTarget = null; renderLibraryPanel(); return; }
    store.facadeMaterial = code;
    libPickReturnToParams(target, info);
    return;
  }
  if (target.role === 'facadeMat') {
    // «Материал фасада» проекта — код НАПРЯМУЮ в state.facadeMatCode, без
    // копии в DECORS (как у facadeDecor ниже). Только ЛДСП (вид 'ldsp').
    const facadeOpt = facadeMatOptionsOf().find((o) => o.code === code);
    if (!facadeOpt) return;
    state.facadeMatCode = code;
    // Поле «Толщина фасада» убрано (2026-09-28) — толщина всегда берётся из
    // самого выбранного материала, как и у толщины задней стенки ниже.
    if (facadeOpt.thickness) state.facadeThickness = facadeOpt.thickness;
    libPickReturnToParams(target, null);
    return;
  }
  if (target.role === 'facadeDecor') {
    // «Видимая боковина» — код НАПРЯМУЮ в state.facadeDecorCode, без копии в
    // DECORS (копия плодила бы дубль в Библиотеке, как у countertopDecor
    // 2026-09-06).
    if (!visibleSideOptionsOf().some((o) => o.code === code)) return;
    state.facadeDecorCode = code;
    libPickReturnToParams(target, null);
    return;
  }
  if (target.role === 'hangerSystem') {
    // «Навес для верхних модулей» — code это item.key одной из 4 позиций
    // навеса (см. HANGER_SYSTEM_PICK_KEYS/libPickRowAllowed), а не code
    // материала. Система навеса — та, чей items[].key содержит выбранный
    // ключ (у GTV Forza — 2 ключа Л/П на одну систему).
    const cat = window.Modul3D.catalog;
    const found = (cat.HANGER_SYSTEM_ORDER || []).find((id) =>
      ((cat.HANGER_SYSTEMS[id] || {}).items || []).some((it) => it.key === code));
    if (!found) return;
    state.hangerSystem = found;
    libPickReturnToParams(target, null);
    return;
  }
  if (target.role === 'countertopDecor') {
    // «Свой материал» столешницы ссылается на код НАПРЯМУЮ, без копии в
    // другой массив — decorCode может указывать на позицию из ЛЮБОГО
    // списка (DECORS/FACADE_MATERIALS/BACK_MATERIALS), countertopMat() в
    // engine.js и specification.js уже ищут материал по коду во всех трёх
    // (см. findAnyMaterialByCode выше). Копирование, как у decor/
    // facadeDecor/back ниже, здесь не нужно — оно оправдано ТОЛЬКО там, где
    // поле жёстко читает один конкретный массив; здесь такого ограничения
    // нет, а копия просто плодит дубль в Библиотеке (баг, найденный
    // пользователем 2026-09-06). Применяется к АКТИВНОЙ тумбе и, вместе с
    // ней, ко всей физически стыкующейся цепочке столешниц (см.
    // window.Modul3D.engine.getCountertopChainModules) — это не то же самое,
    // что старая групповая правка по отмеченным чекбоксом тумбам (см.
    // комментарий у activeCountertopModule): группа здесь определяется
    // геометрией (реально касающиеся друг друга столешницы выглядят единой
    // сплошной поверхностью), а не произвольной отметкой пользователя.
    // Отдельно стоящая тумба/остров без соседей просто вернётся цепочкой из
    // одного себя же — поведение не отличается от применения к одной тумбе.
    const mod = activeCountertopModule();
    if (mod && mod.countertop) {
      const engineApi = window.Modul3D.engine;
      let chainNames = [mod.name];
      if (currentModel && engineApi && typeof engineApi.getCountertopChainModules === 'function') {
        try {
          const chain = engineApi.getCountertopChainModules(currentModel, mod.name);
          if (Array.isArray(chain) && chain.length) chainNames = chain;
        } catch (e) {
          // Геометрия могла ещё не пересчитаться (currentModel null при самом
          // первом вызове) — тихо откатываемся на одиночную тумбу, а не роняем
          // подбор материала из-за вспомогательной функции.
        }
      }
      const chainSet = new Set(chainNames);
      let appliedCount = 0;
      state.modules.forEach((m) => {
        if (chainSet.has(m.name) && m.countertop) {
          m.countertop.decorCode = code;
          appliedCount += 1;
        }
      });
      state.countertopChainNotice = appliedCount > 1
        ? `Материал применён к ${appliedCount} тумбам стыкующейся цепочки столешницы.`
        : null;
    }
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
    // берётся из неё, см. libPickMaterial, роль 'back') — если у скопированной
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
  if (target.role === 'decor') {
    state.decorCode = finalCode;
    // Поле «Толщина ЛДСП» убрано (2026-09-28) — толщина корпуса всегда
    // берётся из самого выбранного материала, как и у толщины задней
    // стенки ниже.
    const decorItem = findAnyMaterialByCode(finalCode);
    if (decorItem && decorItem.thickness) state.bodyThickness = decorItem.thickness;
  } else if (target.role === 'back') {
    state.backCode = finalCode;
    const back = BACK_MATERIALS.find((m) => m.code === finalCode);
    if (back) state.backThickness = back.thickness;
  }
  libPickReturnToParams(target, null);
}

// Завершение подбора: цель снята, Библиотека перерисована без «Выбрать»,
// панель «Параметры» — снова открыта на том экране, откуда начинали
// (target.returnTo: 'materials' — «Материалы модуля», 'module' — секция в
// «Конструктиве»), и прокручена к тому же полю (scrollIntoView). info — цель
// фасада (facadeTargetInfo) или null для материалов проекта.
function libPickReturnToParams(target, info) {
  state.libPickTarget = null;
  if (info) {
    state.activeModule = state.modules.indexOf(info.mod);
    info.mod.activeSection = info.mod.sections.indexOf(info.sec);
    if (target.returnTo === 'materials') setMatFacadeZone(info.zi);
  }
  if (target.returnTo === 'materials' || target.returnTo === 'module') state.panelView = target.returnTo;
  // Экран «Деталь» — только если выбранная деталь всё ещё в этом модуле
  // (иначе renderParamsPanel сам откатит на параметры модуля).
  if (target.returnTo === 'part' && state.selectedPart) state.panelView = 'part';
  renderLibraryPanel();   // убирает колонку «Выбрать» сразу, не дожидаясь повторного открытия
  // openDrawer сам закроет Библиотеку.
  if (window.Modul3D.uiShell) {
    if (target.returnTo) window.Modul3D.uiShell.openDrawer('params');
    else window.Modul3D.uiShell.closeDrawer('library');
  }
  recompute();
  renderParamsPanel();
  let el = null;
  if (target.returnTo === 'materials') {
    el = info ? document.getElementById('matFacadeField') : document.querySelector(`#paramsPanel [data-mat-pick="${target.role}"]`);
  } else if (target.returnTo === 'part') {
    el = document.getElementById('partMaterial');
  } else if (target.returnTo === 'module' && info) {
    el = document.querySelector(`[data-alu-open="${target.secIdx}"]`)
      || document.querySelector(`[data-sec-facade-pick="${target.secIdx}"]`);
  }
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
}

// path — путь ВНУТРИ дерева категории (см. libHardwareLeafTableHtml:
// data-add-path на кнопке «+ Добавить позицию»; сама категория с 2026-09-15
// вынесена в topCode 'hw:<categoryKey>', см. libraryHardwareBlock), то есть
// подкатегория/фирма и, если пользователь завёл вложенные, её подкатегории
// («Направляющие › GTV › Скрытые»). Пустой путь — позиция ложится прямо на
// корень категории, без фирмы, как и раньше. У 'mechanism' (LIFTS) фирма
// хранится в поле brand (см. catalog.js: LIFTS.aventosHK и т.п.), у
// остальных категорий — в subcategory (см. HARDWARE_PRICES/HANDLES/
// FASTENER_PRICES): libHardwareTopEntries читает оба поля одинаково
// (item.subcategory || item.brand) — при создании пишем то поле, которое
// реально читает соответствующий исходный массив.
function libAddHardwareRow(category, path) {
  const cat = window.Modul3D.catalog;
  const key = 'custom_' + category + '_' + Date.now();
  // Единица новой позиции — та, что выбрана в шапке колонки «Цена» ЭТОЙ же
  // таблицы (см. libHwPriceUnitOf/libHwPriceUnitHeaderHtml): если таблица
  // сейчас показывает «Цена/пара», позиция со «шт» тут же показала бы в
  // колонке «—» и выглядела бы сломанной. «Как в позиции» (native) — отбора
  // нет, берём самую частую единицу каталога, 'шт'. Поправить единицу потом
  // можно в редакторе цены (см. libHwUnitEditorHtml).
  const headUnit = libHwPriceUnitOf('hw:' + category);
  const unit = headUnit === 'native' ? 'шт' : headUnit;
  // path — ПОЛНЫЙ путь листа/ветки внутри дерева категории (с 2026-09-16 в
  // нём может быть больше одного уровня: пользователь заводит подкатегории
  // значком «+» прямо в дереве, см. libAddChildNode). Дерево читает
  // item.categoryPath, поэтому пишем его целиком; subcategory/brand
  // заполняем последним сегментом — так же, как их держит в синхроне
  // libSetEntryPath при переименовании/переносе.
  path = path || [];
  const last = path.length ? path[path.length - 1] : '';
  const subField = last ? (category === 'mechanism' ? { brand: last } : { subcategory: last }) : {};
  const pathField = { categoryPath: path.slice() };
  if (category === 'mechanism') {
    cat.LIFTS[key] = Object.assign({ id: key, brand: '', name: 'Новая позиция', article: '', price: 0,
      minH: 0, maxH: 100000, maxW: 100000, note: '', category: 'mechanism', unit: unit }, subField, pathField);
  } else if (category === 'handle') {
    cat.HANDLES[key] = Object.assign({ id: key, name: 'Новая позиция', holes: 2, cc: 0, price: 0,
      article: '', unit: unit, category: 'handle' }, subField, pathField);
  } else if (category === 'fastener') {
    cat.FASTENER_PRICES[key] = Object.assign({ name: 'Новая позиция', article: '', price: 0, unit: unit, category: 'fastener' }, subField, pathField);
  } else {
    // Сюда же попадают позиции СВОИХ категорий пользователя (ключ
    // 'custom-<timestamp>', см. libAddHwCategory) — для каталога это обычная
    // фурнитура, просто расчёт по такому ключу ничего не ищет.
    cat.HARDWARE_PRICES[key] = Object.assign({ name: 'Новая позиция', article: '', price: 0, unit: unit, category }, subField, pathField);
  }
}

// path — путь листа дерева, в который попадёт новая позиция (кнопка «+
// Добавить материал» листа, см. libLeafTableHtml: data-add-path на кнопке,
// массив строк или undefined) — не используется для 'countertop' (там
// дерева категорий нет). Для 'decors'/'back'/'facade' пишем path целиком в
// item.categoryPath новой позиции; 'edge' сохраняет прежний UX (имя кромки
// — это ключ объекта EDGE_PRICES, вводится отдельным prompt), но тоже
// получает categoryPath = path. 'hwadd:*' (фурнитура) с 2026-09-16 тоже
// получает path целиком — её дерево категорий стало таким же полноценным,
// как у материалов (см. libAddHardwareRow/libHardwareTopEntries).
// topCode — сам раздел дерева, из которого нажали кнопку (см. data-add-top в
// libLeafTableHtml) — отличается от group ТОЛЬКО у своих категорий
// «Материалов»/«Дверей» (matcustom-/faccustom-, см.
// libAddMaterialCategory/libAddFacadeCategory): у остальных разделов group и
// topCode либо совпадают, либо topCode не нужен вовсе. Проставляет новой
// позиции item.customRoot, чтобы libTopEntries отличал её от «настоящих»
// позиций «Листовых материалов»/«Видов фасадов» (см. там же).
function libAddRow(group, path, topCode) {
  if (!requireLibraryEditAuth()) return;
  const cat = window.Modul3D.catalog;
  path = path || [];
  const isMatCustom = topCode && (state.libMatCustomCats || []).indexOf(topCode) >= 0;
  const isFacCustom = topCode && (state.libFacCustomCats || []).indexOf(topCode) >= 0;
  if (group.indexOf('hwadd:') === 0) {
    libAddHardwareRow(group.slice(6), path);
  } else if (group === 'decors') {
    const item = { code: 'NEW-' + Date.now(), name: 'Новый материал', sheetPrice: 0, sheetW: 2750, sheetH: 1830, unit: 'лист', image: null, categoryPath: path.slice() };
    if (isMatCustom) item.customRoot = topCode;
    DECORS.push(item);
  } else if (group === 'back') {
    // thickness обязателен: это единственный источник state.backThickness
    // при выборе материала в «Параметрах проекта» (ручного поля-дублёра
    // больше нет) — без него расчёт в engine.js получит undefined.
    BACK_MATERIALS.push({ code: 'NEW-' + Date.now(), name: 'Новый материал', sheetPrice: 0, sheetW: 2440, sheetH: 1220, thickness: 3, unit: 'лист', image: null, categoryPath: path.slice() });
  } else if (group === 'facade') {
    const code = 'FAC-NEW-' + Date.now();
    const item = { code, name: 'Новый материал фасада', sheetPrice: 0, sheetW: 2750, sheetH: 1830, unit: 'лист', image: null, categoryPath: path.slice() };
    if (isFacCustom) item.customRoot = topCode;
    cat.FACADE_MATERIALS[code] = item;
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
  // с 2026-09-15 тоже сохраняется (см. комментарий в libSaveEdit про
  // расширение snapshotCatalogCollections/restoreCatalogFrom).
  scheduleCatalogSave();
  renderLibraryPanel();
}

// ---------------------------------------------------------------------------
// «− Удалить материал» под таблицей листа (см. libLeafTableHtml/
// state.libSelectedRow) — единственная точка удаления материала (ссылок
// «Удалить материал» под полями «Материалов модуля» больше нет, там плашки
// выбора, см. matPickPlashkaHtml). Работает с ЛЮБОЙ из пяти
// удаляемых категорий каталога (decors/back/facade/edge/countertop —
// «Стекло» неудаляемо в принципе, см. canDelete в libLeafTableHtml). Перед
// самим удалением (кроме edge — см. libFindMaterialUsages) проверяет через
// libFindMaterialUsages, не назначена ли позиция хоть где-то в проекте — если
// да, удаление блокируется целиком и показывается showLibUsageModal() со
// списком мест использования, без молчаливой замены на другой материал.
// ---------------------------------------------------------------------------

// Коды FACADE_MATERIALS, жёстко зашитые в FACADE_TYPES (.material/.insert) —
// каждый тип фасада (ldsp/mdf/glass4/wood/...) ссылается на конкретный код
// напрямую, спецификация ищет материал по нему без проверки на
// существование. Удаление любого из этих кодов молча сломало бы стоимость
// у всех модулей с соответствующим типом фасада — блокируем в
// libDeleteSelectedRow. (FAC-VENEER раньше тоже был здесь — engine.js
// возвращал его литералом для видимой боковины; теперь боковина берёт код
// из поля «Видимая боковина» (state.facadeDecorCode), и если там выбрана
// МДФ-панель, её удаление блокирует libFindMaterialUsages.) Позиции фасада, добавленные пользователем через «+
// Добавить материал» (коды вида FAC-NEW-*), в этот список не попадают и
// удаляются свободно.
function libFacadeReservedCodes() {
  const set = {};
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

// Ключи HARDWARE_PRICES/FASTENER_PRICES, заведённые САМИМ пользователем через
// «+ Добавить позицию» (libAddHardwareRow) или «+ Добавить по ссылке»
// (libLinkSaveHardware) — единственные позиции этих двух объектов, которые
// точно безопасно удалять. specification.js читает большинство ОСТАЛЬНЫХ
// («родных») ключей напрямую по литеральному имени (hinge, hingeGlass,
// pushToOpen, leg, legPlastic, plinthClip, shelfSupport, shelfSupportGlass,
// rod, rodHolder, countertopGlueToCarcass, countertopSealant,
// countertopCornerTie, countertopStraightTie — из HARDWARE_PRICES; confirmat,
// minifixBolt, minifixCam, dowel, backPanelScrew, worktopScrew — из
// FASTENER_PRICES, ВСЕ 6 ключей; плюс навесы верхних модулей и шина —
// hangerBlum48N0510, hangerGtvR1, hangerGtvForzaL/R, wallRailGtv2m, их читает
// смета через catalog.HANGER_SYSTEMS; и цены ящичных систем — drawerHettich*/
// drawerBlum*, их смета берёт через DRAWER_SYSTEMS[...].priceKey), и удаление
// любого из них либо уронит расчёт
// TypeError'ом, либо молча обнулит строку стоимости. Пара ключей
// HARDWARE_PRICES (handle, drawerRunnerPair) технически нигде в расчёте не
// читается, но защищена наравне со всеми остальными — иначе в UI возникла бы
// необъяснимая пользователю асимметрия «эту встроенную позицию удалить можно,
// а вот эту нет», и это же одной строкой подстраховывает от изменений
// расчёта в будущем. См. libDeleteSelectedHardwareRow ниже.
function libHardwareKeyIsCustom(key) {
  const s = String(key || '');
  return s.indexOf('custom_') === 0 || s.indexOf('link_') === 0;
}

// ---------------------------------------------------------------------------
// Блокировка удаления материала/фурнитуры, если он назначен хоть где-то в
// текущем проекте (изменено 2026-09-12 по просьбе пользователя — раньше
// libResetCountertopRefs здесь же молча переключала все найденные ссылки на
// первый оставшийся материал каталога, без предупреждения; теперь вместо
// тихой замены удаление ПОЛНОСТЬЮ блокируется, и модальное окно
// showLibUsageModal() показывает список мест использования — пользователь
// должен сам поменять материал в этих местах, прежде чем удалить позицию).
// ---------------------------------------------------------------------------

// Единая точка поиска «где используется код X» для декора/фасада/задней
// стенки/столешницы — используется libDeleteSelectedRow (кнопка «−
// Удалить материал» в «Библиотеке»), чтобы не дублировать проверку для
// каждой роли отдельно. group — ИСТИННОЕ происхождение удаляемой позиции
// (то же значение, что у entry.group в libTopEntries / sel.group в
// libDeleteSelectedRow):
// 'decors' | 'back' | 'facade' | 'countertop'. Кромка ('edge') сюда
// сознательно не входит — по требованию пользователя edgeCode при удалении
// не проверяется. Возвращает массив { moduleName, part } — по одной записи
// на каждое найденное место использования (весь state.modules, а не только
// активный/выделенный модуль).
function libFindMaterialUsages(group, code) {
  const usages = [];
  if (!code) return usages;
  // decor/facadeDecor/back — ОБЩИЕ на весь проект поля (state.decorCode/
  // state.facadeDecorCode/state.backCode, см. materialsBlock) — применяются
  // разом ко ВСЕМ модулям проекта, поэтому здесь одна запись «Проект
  // целиком», а не по записи на каждый модуль. facadeDecorCode («Видимая
  // боковина») может ссылаться и на ЛДСП (DECORS), и на МДФ-панель
  // (FACADE_MATERIALS) — ядро ищет код во всех списках, поэтому, как у
  // столешницы/фасада секции ниже, проверяем независимо от group.
  if (state.facadeDecorCode === code) usages.push({ moduleName: 'Проект целиком', part: 'видимая боковина (общая на весь проект)' });
  // «Материал фасада» (state.facadeMatCode) — так же, код из любого списка.
  if (state.facadeMatCode === code) usages.push({ moduleName: 'Проект целиком', part: 'материал фасада (ЛДСП по умолчанию, общий на весь проект)' });
  if (group === 'decors') {
    if (state.decorCode === code) usages.push({ moduleName: 'Проект целиком', part: 'материал корпуса (общий на весь проект)' });
  } else if (group === 'back') {
    if (state.backCode === code) usages.push({ moduleName: 'Проект целиком', part: 'задняя стенка (общая на весь проект)' });
  }
  state.modules.forEach((mod, i) => {
    const name = mod.name || `Модуль ${i + 1}`;
    // mod.carcassDecor — индивидуальное переопределение декора корпуса
    // конкретного модуля (см. engine.js: `decor: m.carcassDecor || proj.decor`
    // в сборке проекта из нескольких модулей) — своего UI-поля в app.js под
    // него сейчас нет, но engine.js его читает, если оно задано (например,
    // проектом, сохранённым другим инструментом), поэтому проверяем на
    // всякий случай.
    if (group === 'decors' && mod.carcassDecor === code) {
      usages.push({ moduleName: name, part: 'материал корпуса (индивидуальный для модуля)' });
    }
    // Материал ящиков секции: ручной выбор (sec.drawerDecorCode) — всегда;
    // «авто» (кухня и Quadro V6 — 0110 SM, иначе как корпус, см.
    // effectiveDrawerDecorCode) — только у секций, где ящики реально есть.
    if (group === 'decors') {
      (mod.sections || []).forEach((sec, si) => {
        const manual = !!sec.drawerDecorCode;
        if (!manual && !(Number(sec.drawers) > 0)) return;
        if (effectiveDrawerDecorCode(mod, sec) === code) {
          usages.push({ moduleName: name, part: `материал ящиков — секция ${si + 1}${manual ? '' : ' (' + drawerDecorAutoLabel(mod, sec) + ')'}` });
        }
      });
    }
    // mod.countertop.decorCode («свой материал» столешницы) может ссылаться
    // на код из ЛЮБОГО из четырёх массивов — DECORS/BACK_MATERIALS/
    // FACADE_MATERIALS/COUNTERTOP_MATERIALS (см. findAnyMaterialByCode/
    // countertopMat в engine.js) — проверяем при удалении из любого из них,
    // независимо от group.
    if (mod.countertop && mod.countertop.decorCode === code) {
      usages.push({ moduleName: name, part: 'столешница' });
    }
    // Фасад секции/отсека: sec.facadeMaterial (ЛДСП/МДФ/стекло) и заполнение
    // алюминиевой рамки sec.aluFill — ядро ищет код во всех списках
    // материалов (engine.facadeMaterialPick/aluFillMaterial), поэтому, как и
    // у столешницы, проверяем независимо от group. То же у отсеков
    // (sec.doorZones[zi], см. engine.zoneFacadeSettings).
    (mod.sections || []).forEach((sec, si) => {
      if (!sec) return;
      if (sec.facadeMaterial === code) usages.push({ moduleName: name, part: `материал фасада — секция ${si + 1}` });
      if (sec.aluFill === code) usages.push({ moduleName: name, part: `заполнение алюминиевого фасада — секция ${si + 1}` });
      (Array.isArray(sec.doorZones) ? sec.doorZones : []).forEach((z, zi) => {
        if (!z) return;
        if (z.facadeMaterial === code) usages.push({ moduleName: name, part: `материал фасада — секция ${si + 1}, отсек ${zi + 1}` });
        if (z.aluFill === code) usages.push({ moduleName: name, part: `заполнение алюминиевого фасада — секция ${si + 1}, отсек ${zi + 1}` });
      });
    });
    // mod.partOverrides[key].materialOverride — ручное переопределение
    // материала ОДНОЙ детали с экрана «Деталь» (плашка #partMaterial,
    // libPickMaterial роль 'partMaterial'). Код может быть из любого списка
    // (DECORS/BACK_MATERIALS/FACADE_MATERIALS — engine.partMaterialOptions),
    // ядро ищет его во всех, поэтому, как у столешницы/фасада выше, проверяем
    // независимо от group. key — `kind|section|side|index` (applyPartOverrides
    // в engine.js).
    Object.keys(mod.partOverrides || {}).forEach((key) => {
      const ov = mod.partOverrides[key];
      if (!ov || ov.materialOverride !== code) return;
      const bits = key.split('|');
      const title = PART_KIND_TITLES[bits[0]] || bits[0];
      const sideTxt = bits[2] === 'left' ? ' левая' : bits[2] === 'right' ? ' правая' : '';
      usages.push({ moduleName: name, part: `деталь «${title}${sideTxt}» — свой материал (фокусный режим)` });
    });
  });
  return usages;
}

// Тот же поиск для фурнитуры, выбираемой per-секционно — sec.handle (ручка,
// см. HANDLES/HANDLE_ORDER в catalog.js) и sec.lift (подъёмный механизм,
// см. LIFTS/LIFT_ORDER) — единственные два источника фурнитуры каталога,
// которые пользователь выбирает САМ по коду позиции (renderSectionsList:
// селекты «Ручка»/«Подъёмный механизм» у секции). Используется
// libDeleteSelectedHardwareRow (кнопка «− Удалить позицию» у «Ручек»/
// «Подъёмников» в Библиотеке, см. libHardwareLeafTableHtml) — там, в отличие
// от HARDWARE_PRICES/FASTENER_PRICES (петли, направляющие, опоры, крепёж —
// считаются в specification.js по фиксированным литеральным ключам, а не по
// per-модульному выбору, поэтому для них удаление вместо проверки
// использования просто запрещено для «родных» ключей каталога, см.
// libHardwareKeyIsCustom), удалять можно любую позицию — и родную, и
// добавленную пользователем — если она сейчас нигде не назначена. src — тот
// же ключ, что и в group 'hw:*' у libFindItem: 'handles' | 'lifts'.
function libFindHardwareUsages(src, key) {
  const usages = [];
  if (!key) return usages;
  state.modules.forEach((mod, i) => {
    const name = mod.name || `Модуль ${i + 1}`;
    (mod.sections || []).forEach((sec, si) => {
      if (src === 'handles' && sec.handle === key) {
        usages.push({ moduleName: name, part: `ручка — секция ${si + 1}` });
      }
      // engine.js читает sec.lift ТОЛЬКО у секций с откидным фасадом (ветка
      // `else if (fac === 'liftUp')`, engine.js:3322-3342) — тем же условием
      // (secEffectiveFacades(sec).some(f => f === 'liftUp')) сам UI решает,
      // показывать ли секции селект «Подъёмный механизм» вообще (см. ~7661).
      // У ЛЮБОЙ другой секции (обычная дверь и т.п.) sec.lift не читается
      // расчётом никогда, даже если там случайно осталось значение — без
      // этой проверки почти все секции проекта (у которых lift не задан,
      // см. newSection()) ложно засчитывались бы как «использующие»
      // 'aventosHK', хотя реально она им не подставляется. sec.lift пуст у
      // секций, заведённых вручную через панель — реальный дефолт подъёмника
      // для откидного фасада подставляет engine.js (`sec.lift || 'aventosHK'`),
      // поэтому фолбэк здесь нужен именно ВНУТРИ ветки liftUp.
      if (src === 'lifts' && secEffectiveFacades(sec).some((f) => f === 'liftUp') && (sec.lift || 'aventosHK') === key) {
        usages.push({ moduleName: name, part: `подъёмный механизм — секция ${si + 1}` });
      }
    });
  });
  return usages;
}

// Показывает модальное окно «используется в проекте» (см. index.html:
// #libUsageModal) со списком мест использования — единственное действие
// внутри окна «Понятно» (закрыть), обхода блокировки нет: пользователь сам
// меняет материал в перечисленных местах и повторяет удаление. name —
// название удаляемой позиции для заголовка сообщения.
function showLibUsageModal(name, usages) {
  const overlay = document.getElementById('libUsageModal');
  const body = document.getElementById('libUsageModalBody');
  if (!overlay || !body) {
    // Разметка почему-то не нашлась (не должно случаться в норме) — не
    // оставляем пользователя вообще без объяснения, но это НЕ обход
    // блокировки (сама функция вызывается только вместо удаления, см.
    // вызовы ниже), просто запасной путь сообщить то же самое.
    window.alert(`«${name}» используется в проекте и не может быть удалена. Сначала замените её вручную в перечисленных местах.`);
    return;
  }
  const itemsHtml = usages.map((u) => `<li><b>${esc(u.moduleName)}</b> — ${esc(u.part)}</li>`).join('');
  // Если среди мест использования есть запись «Проект целиком» — материал
  // сейчас выбран в «Материалах модуля» как state.decorCode/facadeDecorCode/
  // backCode. Подсказываем путь: сначала выбрать там другой материал
  // (плашка → Библиотека → «Выбрать»), затем повторить удаление.
  const isActiveProjectMaterial = usages.some((u) => u.moduleName === 'Проект целиком');
  const hintHtml = isActiveProjectMaterial
    ? `<p class="hint">Этот материал сейчас выбран в «Материалах модуля» (корпус, видимая боковина, материал фасада или задняя стенка). Сначала выберите там другой материал — нажмите на поле и затем «Выбрать» в Библиотеке, — а потом повторите удаление «${esc(name)}».</p>`
    : `<p class="hint">Сначала замените материал в перечисленных местах вручную (в «Материалах модуля» или в секциях модуля), затем повторите удаление.</p>`;
  body.innerHTML = `
    <p>«<b>${esc(name)}</b>» нельзя удалить — она используется в проекте:</p>
    <ul class="lib-usage-list">${itemsHtml}</ul>
    ${hintHtml}`;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeLibUsageModal() {
  const overlay = document.getElementById('libUsageModal');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

// Вешается один раз при старте (см. запуск в конце файла, рядом с
// initPartEditorOverlay) — сама разметка статична в index.html, не
// пересоздаётся при рендере.
function initLibUsageModal() {
  const overlay = document.getElementById('libUsageModal');
  if (!overlay) return;
  const closeBtn = document.getElementById('libUsageModalClose');
  const okBtn = document.getElementById('libUsageModalOk');
  if (closeBtn) closeBtn.addEventListener('click', closeLibUsageModal);
  if (okBtn) okBtn.addEventListener('click', closeLibUsageModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeLibUsageModal(); });
}

function libDeleteSelectedRow() {
  if (!requireLibraryEditAuth()) return;
  const sel = state.libSelectedRow;
  if (!sel) return;
  // Фурнитура (group 'hw:*') — своя, ощутимо другая логика защиты (см.
  // libDeleteSelectedHardwareRow ниже), вынесена отдельной функцией, а не
  // ещё одной веткой этого if/else, потому что критерий блокировки для неё
  // не «используется ли материал в проекте», а для двух из четырёх
  // источников (HARDWARE_PRICES/FASTENER_PRICES) — «это не своя, а родная
  // позиция каталога» (см. libHardwareKeyIsCustom).
  if (sel.group.indexOf('hw:') === 0) { libDeleteSelectedHardwareRow(sel); return; }
  const cat = window.Modul3D.catalog;
  const lastAlert = () => window.alert('Нельзя удалить последнюю позицию — иначе не из чего будет выбирать.');
  if (sel.group === 'decors') {
    if (DECORS.length <= 1) { lastAlert(); return; }
    const idx = DECORS.findIndex((x) => x.code === sel.key);
    if (idx < 0) return;
    const usages = libFindMaterialUsages('decors', sel.key);
    if (usages.length) { showLibUsageModal(DECORS[idx].name, usages); return; }
    if (!window.confirm(`Удалить материал «${DECORS[idx].name}» из каталога?`)) return;
    DECORS.splice(idx, 1);
  } else if (sel.group === 'back') {
    if (BACK_MATERIALS.length <= 1) { lastAlert(); return; }
    const idx = BACK_MATERIALS.findIndex((x) => x.code === sel.key);
    if (idx < 0) return;
    const usages = libFindMaterialUsages('back', sel.key);
    if (usages.length) { showLibUsageModal(BACK_MATERIALS[idx].name, usages); return; }
    if (!window.confirm(`Удалить материал «${BACK_MATERIALS[idx].name}» из каталога?`)) return;
    BACK_MATERIALS.splice(idx, 1);
  } else if (sel.group === 'facade') {
    if (libFacadeReservedCodes()[sel.key]) {
      window.alert('Этот материал фасада используется системными типами фасадов (см. «Тип фасада» у секции) и не может быть удалён.');
      return;
    }
    const keys = Object.keys(cat.FACADE_MATERIALS);
    if (keys.length <= 1) { lastAlert(); return; }
    const it = cat.FACADE_MATERIALS[sel.key];
    if (!it) return;
    const usages = libFindMaterialUsages('facade', sel.key);
    if (usages.length) { showLibUsageModal(it.name, usages); return; }
    if (!window.confirm(`Удалить материал «${it.name}» из каталога?`)) return;
    delete cat.FACADE_MATERIALS[sel.key];
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
    // edgeCode сознательно не проверяется на использование в проекте (см.
    // libFindMaterialUsages) — по требованию пользователя.
  } else if (sel.group === 'countertop') {
    const arr = cat.COUNTERTOP_MATERIALS || [];
    if (arr.length <= 1) { lastAlert(); return; }
    const idx = arr.findIndex((x) => x.code === sel.key);
    if (idx < 0) return;
    const usages = libFindMaterialUsages('countertop', sel.key);
    if (usages.length) { showLibUsageModal(arr[idx].name, usages); return; }
    if (!window.confirm(`Удалить столешницу «${arr[idx].name}» из каталога?`)) return;
    arr.splice(idx, 1);
  } else {
    return;
  }
  // Картинка листа живёт только на этом компьютере — удаляем вместе с материалом.
  if (sel.group !== 'edge' && window.Modul3D.userTextures) window.Modul3D.userTextures.remove(sel.key);
  state.libSelectedRow = null;
  recompute();
  scheduleCatalogSave();
  renderLibraryPanel();
}

// «− Удалить позицию» под таблицей листа вкладки «Фурнитура» (см.
// libHardwareLeafTableHtml) — вызывается из libDeleteSelectedRow для всех
// групп 'hw:*'. sel.group — 'hw:hw' | 'hw:handles' | 'hw:lifts' |
// 'hw:fasteners' (см. libHardwareTopEntries), sel.key — item.key
// соответствующего объекта каталога. Два принципиально разных случая:
// - hw:hw / hw:fasteners (HARDWARE_PRICES/FASTENER_PRICES) — большинство
//   ключей читает specification.js напрямую по литеральному имени, поэтому
//   удалять можно ТОЛЬКО позиции, заведённые самим пользователем (ключ
//   'custom_'/'link_', см. libHardwareKeyIsCustom) — остальные блокируются
//   с объяснением, без исключений для орфанных ключей (см. комментарий у
//   libHardwareKeyIsCustom).
// - hw:handles / hw:lifts (HANDLES/LIFTS) — выбираются пользователем
//   поштучно на каждой секции (sec.handle/sec.lift), поэтому удалить можно
//   любую позицию (и родную, и custom_/link_), если она сейчас нигде не
//   используется — проверяем через libFindHardwareUsages, как и материалы
//   через libFindMaterialUsages, и точно так же блокируем удаление целиком
//   через showLibUsageModal(), без тихой замены.
function libDeleteSelectedHardwareRow(sel) {
  const cat = window.Modul3D.catalog;
  const src = sel.group.slice(3);
  if (src === 'hw' || src === 'fasteners') {
    const obj = src === 'hw' ? cat.HARDWARE_PRICES : cat.FASTENER_PRICES;
    const it = obj[sel.key];
    if (!it) return;
    if (!libHardwareKeyIsCustom(sel.key)) {
      window.alert(`«${it.name}» — базовая позиция для расчёта себестоимости, её нельзя удалить.`);
      return;
    }
    if (!window.confirm(`Удалить позицию «${it.name}» из каталога?`)) return;
    delete obj[sel.key];
  } else if (src === 'handles' || src === 'lifts') {
    const obj = src === 'handles' ? cat.HANDLES : cat.LIFTS;
    const it = obj[sel.key];
    if (!it) return;
    const usages = libFindHardwareUsages(src, sel.key);
    if (usages.length) { showLibUsageModal(it.name, usages); return; }
    if (!window.confirm(`Удалить позицию «${it.name}» из каталога?`)) return;
    delete obj[sel.key];
  } else {
    return;
  }
  state.libSelectedRow = null;
  recompute();
  scheduleCatalogSave();
  renderLibraryPanel();
}

// Загрузка образца (карточки цвета) — чисто клиентская: input[type=file] →
// FileReader → canvas (сжатие) → dataURL, без бэкенда. Само изображение
// синхронизируется на сервер целиком как часть state (см. scheduleCatalogSave/
// PUT /catalog-overrides), поэтому важно не тащить в базу мегабайтные фото
// с телефона «как есть» — при многих пользователях это быстро съедает
// лимиты дешёвых тарифов хостинга.
let pendingLibImageTarget = null;
function openLibImagePicker(group, key) {
  if (!requireLibraryEditAuth()) return;
  const input = document.getElementById('libImageInput');
  if (!input) return;
  pendingLibImageTarget = { group, key };
  input.value = '';
  input.click();
}

// Реально образец сейчас показывается лишь маленькой карточкой-превью в
// таблице «Материалы» (см. libSwatchHtml/.lib-swatch — 36×24 CSS px);
// текстурой на деталях в 3D-сцене декор не рисуется — viewer.js красит
// детали процедурно по названию материала (см. decorLook), само фото не
// используется как текстура. 800 px по большей стороне — с запасом на
// ретину-экраны и возможный будущий крупный просмотр/зум карточки, но
// далеко от исходных 2-5 МБ с телефона.
const LIB_IMAGE_MAX_SIDE = 800;
const LIB_IMAGE_JPEG_QUALITY = 0.85;

// Сжимает выбранный файл перед сохранением в state: вписывает в
// LIB_IMAGE_MAX_SIDE по большей стороне (сохраняя пропорции, без апскейла
// маленьких фото) и перекодирует в JPEG с качеством ~0.85.
// Возвращает Promise<string> — готовый dataURL для libSaveEdit(...,'image',…).
function compressLibImage(file, opts) {
  const maxSide = (opts && opts.maxSide) || LIB_IMAGE_MAX_SIDE;
  const mime = (opts && opts.mime) || 'image/jpeg';
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать файл.'));
    reader.onload = () => {
      const originalDataUrl = String(reader.result);
      const img = new Image();
      // Не удалось декодировать как изображение — не блокируем загрузку,
      // сохраняем как есть (libSaveEdit ниже всё равно ждёт dataURL).
      img.onerror = () => resolve(originalDataUrl);
      img.onload = () => {
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (!w || !h || Math.max(w, h) <= maxSide) {
          // Фото уже компактное — не апскейлим, canvas не нужен.
          resolve(originalDataUrl);
          return;
        }
        const scale = maxSide / Math.max(w, h);
        const targetW = Math.max(1, Math.round(w * scale));
        const targetH = Math.max(1, Math.round(h * scale));
        try {
          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          // JPEG не хранит альфа-канал — прозрачные области при экспорте
          // иначе могут стать чёрными; заливаем белым фоном (образцы
          // декора — непрозрачные фото/текстуры, белая подложка для них
          // естественна).
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, targetW, targetH);
          ctx.drawImage(img, 0, 0, targetW, targetH);
          // PNG — для чертежей (линии без артефактов JPEG); если PNG вышел
          // тяжёлым (фото, а не чертёж) — всё же JPEG.
          let out = mime === 'image/png' ? canvas.toDataURL('image/png') : '';
          if (!out || out.length > 350000) out = canvas.toDataURL('image/jpeg', LIB_IMAGE_JPEG_QUALITY);
          resolve(out);
        } catch (err) {
          // canvas не сработал (напр. заблокирован окружением) — не теряем
          // загрузку, сохраняем оригинал.
          resolve(originalDataUrl);
        }
      };
      img.src = originalDataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function initLibImageInput() {
  const input = document.getElementById('libImageInput');
  if (!input) return;
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    const target = pendingLibImageTarget;
    if (!file || !target) return;
    compressLibImage(file)
      .then((dataUrl) => libSaveEdit(target.group, target.key, 'image', dataUrl))
      .catch((err) => {
        console.error('Не удалось обработать изображение образца материала:', err);
        window.alert('Не удалось загрузить изображение. Попробуйте другой файл.');
      });
  });
}

// Единица измерения материала — фиксированный список, а не свободный текст:
// реальные товары каталога измеряются только так (листы декоров/фасадов/
// задней стенки — «лист», кромка — «пог.м», м² — стекло/массив под заказ;
// набор согласован с пользователем). Используется формой «Добавить по
// ссылке» (libLinkConfirmHtml); у фурнитуры свой список — LIB_HW_UNIT_OPTIONS.
const LIB_UNIT_OPTIONS = ['лист', 'м²', 'пог.м', 'шт'];

// Клик по ячейке → инлайн-инпут; Enter/blur — сохранить, Esc — отменить.
// Отдельной колонки-списка «Ед. изм.» в таблицах больше нет (была только у
// «Фурнитуры», убрана 2026-09-16 вместе с приведением набора колонок к
// «Материалам»), но САМА единица позиции фурнитуры редактируется здесь же:
// у ячейки ЦЕНЫ рядом с полем ввода открывается компактный список единиц
// (см. libHwUnitEditorHtml), сохраняются оба значения разом. У материалов
// такого списка нет: их единица («лист»/«м²») завязана на расчёт листа и
// задаётся при добавлении материала (см. LIB_UNIT_OPTIONS).
function startCellEdit(cell) {
  if (!requireLibraryEditAuth()) return;
  if (cell.querySelector('input') || cell.querySelector('select')) return;
  const type = cell.dataset.type === 'number' ? 'number' : 'text';
  const cur = cell.dataset.raw != null ? cell.dataset.raw : cell.textContent;
  const withUnit = String(cell.dataset.group || '').indexOf('hw:') === 0 && cell.dataset.field === 'price';
  const unitWas = withUnit ? libHwUnitOf(libFindItem(cell.dataset.group, cell.dataset.key)) : '';
  cell.innerHTML = `<input type="${type}" ${type === 'number' ? 'step="any"' : ''} value="${esc(cur)}">`
    + (withUnit ? libHwUnitEditorHtml(unitWas) : '');
  const input = cell.querySelector('input');
  const unitSel = withUnit ? cell.querySelector('.lib-hw-unit-edit') : null;
  input.focus();
  if (input.select) input.select();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const val = type === 'number' ? (Number(input.value) || 0) : input.value;
    // Единицу пишем в позицию ДО libSaveEdit, а не вторым его вызовом:
    // каждый вызов тянет за собой recompute + перерисовку панели +
    // сохранение каталога на сервере, делать это дважды ради одной правки
    // ячейки незачем.
    if (unitSel && unitSel.value && unitSel.value !== unitWas) {
      const it = libFindItem(cell.dataset.group, cell.dataset.key);
      if (it) it.unit = unitSel.value;
    }
    libSaveEdit(cell.dataset.group, cell.dataset.key, cell.dataset.field, val);
  };
  // Клик по списку единиц забирает фокус у поля цены — сохранение прямо по
  // blur закрыло бы редактор раньше, чем пользователь успел выбрать единицу.
  // Поэтому там, где список есть, решение отложено на такт: остался фокус
  // ВНУТРИ той же ячейки (перешёл на соседний контрол редактора) — не
  // сохраняем. Где списка нет (все таблицы материалов), поведение прежнее —
  // сохранение прямо на blur.
  const commitIfFocusLeft = () => setTimeout(() => {
    if (done) return;
    const act = document.activeElement;
    if (act && cell.contains && cell.contains(act)) return;
    commit();
  }, 0);
  const onKey = (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); done = true; renderLibraryPanel(); }
  };
  input.addEventListener('blur', unitSel ? commitIfFocusLeft : commit);
  input.addEventListener('keydown', onKey);
  if (unitSel) {
    unitSel.addEventListener('blur', commitIfFocusLeft);
    unitSel.addEventListener('keydown', onKey);
  }
}

// Инлайн-переименование узла дерева категорий (значок ✎, см.
// libTreeRowHtml/libRenameNode) — тот же паттерн, что и startCellEdit выше:
// клик превращает название в <input>, Enter/blur сохраняет, Esc отменяет.
function startTreeRename(row) {
  if (!requireLibraryEditAuth()) return;
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
    const val = libCleanNodeName(input.value);
    if (val && val !== cur) libRenameNode(topCode, path, val);
    renderLibraryPanel();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); done = true; renderLibraryPanel(); }
  });
}

// ---------------------------------------------------------------------------
// ПЕРЕТАСКИВАНИЕ строк «Библиотеки» — мышью и пальцем.
// Позволяет то, чего не умеет меню ⇄: менять ПОРЯДОК категорий между собой,
// а не только родителя. Тащить можно двумя способами, и они не смешиваются:
//  - ПОДКАТЕГОРИЮ (строка дерева ниже корня) — переставить среди соседей или
//    вложить в другой узел своего же раздела (state.libNodeOrder,
//    libPlaceChildAt + libMoveNode);
//  - РАЗДЕЛ (строка-заголовок, kind 'top': «Петли», «Кромка», …) — только
//    переставить среди разделов своей вкладки (state.libTopOrder,
//    libPlaceTopAt). Подкатегорией раздел стать не может и наоборот.
//
// Почему Pointer Events, а не нативный HTML5 drag-and-drop (draggable/
// dragstart/dragover/drop): нативный DnD на мобильных браузерах не работает
// вовсе — палец там всегда прокручивает страницу, событий drag* просто нет. А
// «Библиотеку» правят и с телефона. Pointer Events описывают мышь, палец и
// стилус ОДНИМ набором обработчиков, поэтому здесь один код на все устройства
// и никакого второго пути «для тача».
//
// Как жест начинается. Входа два, и срабатывает тот, что случился раньше:
//  - УДЕРЖАНИЕ (~400 мс на месте) — и у пальца, и у мыши;
//  - СМЕЩЕНИЕ (~8 px) — только у мыши.
// Пальцу смещение в старт не годится: палец, ведённый по строке, — это в
// первую очередь прокрутка длинного списка категорий, и если начинать таскать
// по сдвигу, прокрутить панель стало бы нечем; поэтому раннее движение
// пальцем, наоборот, СНИМАЕТ кандидата.
// Мыши удержание нужно по другой причине — ради подтверждения «взял»: пока
// жест не начался, на экране ничего не происходит, и пользователь не знает,
// можно ли уже вести. С таймером он зажимает строку, видит, что она
// «поднялась» (призрак под курсором, источник приглушён), и только потом
// ведёт. Смещение при этом остаётся вторым входом — кто сразу повёл мышь, тот
// ждать не обязан.
//
// Почему «внутрь» по середине строки, а «между» по её краям: так устроены
// файловые менеджеры и почтовые клиенты — ближе к границе с соседом значит
// «встать рядом с ним», по центру значит «положить внутрь него». Отдельного
// переключателя режима для этого не нужно.
// ---------------------------------------------------------------------------

// Текущее перетаскивание ИЛИ кандидат на него (pointerdown был, но порог/
// удержание ещё не пройдены — см. поле active). Одно на всю страницу: двумя
// пальцами одновременно таскать две категории смысла нет.
let libDrag = null;
// Клик, который браузер шлёт следом за отпусканием кнопки после броска, не
// должен ещё и раскрыть/свернуть узел, с которого начали тащить. Таймер —
// страховка на случай, когда клика следом не будет (тач), и он же не даёт
// жестам мешать друг другу: перед каждым новым флагом старый таймер снимаем.
let libDragClickGuard = false;
let libDragClickGuardTimer = null;
// Порог для мыши намеренно НЕ маленький: на тачпаде палец при обычном клике
// по строке смещается на два-три пикселя, и при пороге в 4 px гость получал
// окно «зарегистрируйтесь» (перетаскивание требует прав, см.
// libTreeDragBegin) вместо раскрытия категории.
const LIB_DRAG_MOUSE_SLOP = 8;    // px: сдвиг мыши, после которого это уже перетаскивание, а не клик
const LIB_DRAG_TOUCH_SLOP = 8;    // px: палец «дрожит» сильнее мыши — до этого порога считаем, что он стоит на месте
// Мс удержания до начала жеста — ОДНО число и для пальца, и для мыши.
// Пальцу удержание нужно, чтобы отличить перетаскивание от прокрутки списка;
// мыши — чтобы пользователь увидел подтверждение «взял» (призрак появляется
// сразу по истечении этого времени, ещё до всякого движения) и понял, что
// можно вести. Разводить эти два случая разными числами незачем: ощущение
// жеста должно быть одинаковым на любом устройстве.
const LIB_DRAG_HOLD_MS = 400;
const LIB_DRAG_EDGE = 44;         // px от края панели, где включается автопрокрутка
const LIB_DRAG_SPEED = 10;        // px за кадр автопрокрутки
// Разметка строки по высоте под цель броска (см. libDragRowZone): краевые
// зоны «встать ПЕРЕД / ПОСЛЕ» — по 40 % высоты каждая, «вложить ВНУТРЬ» —
// только узкая середина (~20 %).
// Почему «внутрь» — узкая середина, а не половина строки: сначала зоны
// делились по четвертям (25 % / 50 % / 25 %), но строка дерева ~28 px, и на
// краевую зону приходилось по 7 px — попасть в них мышью человек не может,
// поэтому мышь почти всегда давала «вложить внутрь», а переставить
// категорию между соседями было практически невозможно. Цена ошибки у
// сторон разная: промахнуться «внутрь» не страшно (это видно по подсветке и
// правится обратным перетаскиванием), а промахнуться мимо перестановки
// обиднее — порядок иначе задать нечем.
const LIB_DRAG_EDGE_RATIO = 0.4;
// ...но не меньше этого числа пикселей на краевую зону: на низкой строке
// 40 % снова превратились бы в неприцеливаемую полоску.
const LIB_DRAG_EDGE_MIN_PX = 9;
// ...и не больше, чем позволяет оставить середину: на очень низкой строке
// две краевые зоны иначе съели бы «внутрь» целиком, а вложенность нужна не
// меньше порядка — она должна оставаться достижимой при любой высоте.
const LIB_DRAG_CENTER_MIN_PX = 6;

function libDragIsNoBrand(seg) {
  return String(seg).toLowerCase() === NO_BRAND_SUBCAT.toLowerCase();
}

// В какую зону строки попал указатель: 'before' — встать ПЕРЕД ней среди её
// соседей, 'after' — ПОСЛЕ неё, 'into' — вложить ВНУТРЬ неё (см. константы
// LIB_DRAG_EDGE_RATIO/LIB_DRAG_EDGE_MIN_PX/LIB_DRAG_CENTER_MIN_PX выше —
// там же, почему середина узкая).
// Зоны НЕПРЕРЫВНЫ на стыке двух строк: у верхней строки самый низ — 'after'
// (это «после неё»), у нижней самый верх — 'before' (это «перед ней»), а для
// двух соседей одного родителя обе цели — одно и то же место вставки и одна
// и та же линия в одной и той же точке экрана. Поэтому индикатор на границе
// не мигает и «мёртвой» полосы между строками нет.
// Правило одно на все строки, включая заголовки разделов: у них зона
// «внутрь» тоже работает и означает «вложить раздел в раздел» (см.
// state.libTopParent) — при этом ни одна позиция не меняет свой item.category,
// меняется только раскладка на экране.
function libDragRowZone(rect, y) {
  const h = rect.height || 0;
  if (h <= 0) return 'into';
  const edge = Math.min(
    Math.max(h * LIB_DRAG_EDGE_RATIO, LIB_DRAG_EDGE_MIN_PX),
    Math.max(0, (h - LIB_DRAG_CENTER_MIN_PX) / 2),
  );
  if (edge <= 0) return 'into';   // строка ниже, чем нужно даже одной середине
  const off = y - rect.top;
  if (off < edge) return 'before';
  if (off > h - edge) return 'after';
  return 'into';
}

// Прокручиваемый контейнер, в котором лежит дерево — тело выдвижной панели
// (см. .drawer-body в style.css), а не сам #libraryPanel.
function libDragScroller(row) {
  return (row.closest && row.closest('.drawer-body')) || document.getElementById('libraryPanel');
}

// pointerdown на строке дерева — ещё не перетаскивание, а только кандидат:
// обычный клик по строке (раскрыть/свернуть узел, открыть таблицу листа)
// должен работать как раньше.
function libTreeDragPointerDown(e) {
  // Хвост прошлого жеста (pointerup потерялся — отпустили за окном, поверх
  // выскочило системное меню) не должен намертво заблокировать следующий:
  // снимаем его и работаем дальше. Обычно до этого не доходит — есть захват
  // указателя и lostpointercapture (см. libTreeDragBegin), это последний
  // рубеж.
  if (libDrag) libTreeDragFinish(false);
  if (e.button != null && e.button > 0) return;           // правая/средняя кнопка — не перетаскивание
  if (!e.target || !e.target.closest) return;
  if (e.target.closest('.lib-tree-ic')) return;           // ✎/+/⇄/× — у них свои действия
  if (e.target.closest('.lib-tree-name input')) return;   // идёт инлайн-переименование узла
  // В режиме подбора материала для проекта (state.libPickTarget, см.
  // openMaterialPicker) перетаскивания нет вовсе — ровно по той же причине, по
  // которой в таблицах прячется значок ⇄ (см. libRowMoveIcHtml): пользователь
  // сейчас ВЫБИРАЕТ материал, а не правит библиотеку, и удержание на строке
  // выбросило бы ему окно «зарегистрируйтесь» (см. requireLibraryEditAuth в
  // libTreeDragBegin) прямо посреди подбора.
  if (state.libPickTarget) return;
  const row = e.target.closest('[data-tree-node]');
  if (!row) return;
  const topCode = row.dataset.top || '';
  const path = row.dataset.path ? row.dataset.path.split('::') : [];
  // Строку РАЗДЕЛА (kind 'top') тоже можно тащить — но только чтобы
  // переставить её среди таких же разделов своей вкладки (см.
  // libDragResolveTarget, ветка mode 'top'); подкатегорией она стать не
  // может. Её порядок живёт отдельно от categoryPath (state.libTopOrder),
  // поэтому сюда попадает и 'countertop' — виртуальность ЕГО дерева мешает
  // таскать узлы ВНУТРИ него, но не мешает переставить сам раздел.
  const isTopRow = row.dataset.kind === 'top';
  if (!isTopRow) {
    // 'countertop' не участвует в перетаскивании УЗЛОВ: его дерево
    // виртуальное (собирается на лету из materialId/brand), записать туда
    // порядок или новый путь физически некуда — правка молча пропала бы
    // после ближайшей перерисовки.
    if (topCode === 'countertop') return;
    if (!path.length) return;
  }
  // Подпись для «призрака» берём прямо со строки: у раздела имени в path нет
  // (path пуст), а у категории фурнитуры оно вообще не равно коду (см.
  // libHwCategoryLabel).
  const labelEl = row.querySelector('[data-tree-label]');
  const label = (labelEl && labelEl.textContent) || path[path.length - 1] || '';
  libDrag = {
    topCode, path, row, label,
    isTop: isTopRow,
    // Вкладка, чьи разделы сейчас на экране: только среди них и можно
    // переставлять заголовок (см. state.libTopOrder — порядок хранится по
    // вкладке). Для узлов дерева поле не используется.
    tabKey: state.libraryTab,
    pointerId: e.pointerId,
    touch: e.pointerType === 'touch',
    startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY,
    grabDX: 0, grabDY: 0,
    active: false, holdTimer: null, ghost: null, line: null, intoRow: null,
    target: null, allowedKeys: null, captured: false,
    scroller: libDragScroller(row), scrollDir: 0, raf: 0,
  };
  // Таймер удержания ставим ЛЮБОМУ указателю (см. LIB_DRAG_HOLD_MS): жест
  // начнётся сам, без единого движения, и строка сразу «поднимется». Второй
  // вход — смещение мыши (libTreeDragMove); что сработает первым, то и
  // начнёт, а таймер в любом случае снимается в libTreeDragBegin/
  // libTreeDragFinish, так что висящих таймеров не остаётся.
  libDrag.holdTimer = setTimeout(libTreeDragBegin, LIB_DRAG_HOLD_MS);
  document.addEventListener('pointermove', libTreeDragMove);
  document.addEventListener('pointerup', libTreeDragPointerUp);
  document.addEventListener('pointercancel', libTreeDragPointerCancel);
  document.addEventListener('keydown', libTreeDragKeyDown);
}

// Собственно старт перетаскивания: права, призрак под курсором, список
// допустимых целей. Возвращает false, если начать не удалось (гость без
// входа) — вызывающая сторона тогда просто выходит.
function libTreeDragBegin() {
  if (!libDrag || libDrag.active) return false;
  clearTimeout(libDrag.holdTimer);
  libDrag.holdTimer = null;
  // Права спрашиваем ОДИН раз, ровно здесь — как это делает открытие меню
  // переноса (requireLibraryEditAuth перед openLibTreeMoveMenu). На каждом
  // движении мыши/пальца показывать окно входа было бы невыносимо, а после
  // броска — поздно: пользователь уже проделал работу впустую.
  if (!requireLibraryEditAuth()) { libTreeDragFinish(false); return false; }
  libDrag.active = true;
  // Набор допустимых новых родителей считаем ОДИН раз на всё перетаскивание:
  // дерево за это время не меняется, а libMoveTargets обходит его целиком —
  // дёргать её на каждое движение мыши незачем.
  // Object.create(null) — та же осторожность, что и в libPruneNodeOrder:
  // путь-цель складывается из названий категорий, которые вводит
  // пользователь, и у обычного объекта «constructor» оказался бы
  // «разрешённой целью» просто потому, что так устроен прототип.
  libDrag.allowedKeys = Object.create(null);
  // У РАЗДЕЛА целей внутри дерева не бывает вовсе: он переставляется только
  // среди соседних разделов вкладки, и проверка там своя, короткая (см.
  // libDragResolveTarget). libMoveTargets — про узлы дерева, ему тут нечего
  // считать (да и path у раздела пуст).
  if (!libDrag.isTop) {
    libMoveTargets(libDrag.topCode, libDrag.path).forEach((p) => { libDrag.allowedKeys[p.join('::')] = true; });
    // Собственный родитель узла: меню ⇄ его не предлагает («перенос в
    // никуда»), а перетаскиванием это как раз перестановка среди соседей —
    // главный сценарий этой фичи.
    libDrag.allowedKeys[libDrag.path.slice(0, -1).join('::')] = true;
  }
  const rect = libDrag.row.getBoundingClientRect();
  libDrag.grabDX = libDrag.x - rect.left;
  libDrag.grabDY = libDrag.y - rect.top;
  // Захват указателя строкой-источником: пока он держится, браузер шлёт нам
  // все pointermove/pointerup, даже если палец/курсор ушёл за пределы окна;
  // а если захват всё-таки потерян (системное меню, переключение окна),
  // придёт lostpointercapture — и мы уберём призрак и разблокируем жест.
  // Без этого после «потерянного» pointerup на экране навсегда оставались бы
  // призрак и body.lib-dragging, а libDrag !== null не давал бы начать
  // следующее перетаскивание.
  try {
    if (libDrag.pointerId != null && libDrag.row.setPointerCapture) {
      libDrag.row.setPointerCapture(libDrag.pointerId);
      libDrag.captured = true;
      libDrag.row.addEventListener('lostpointercapture', libTreeDragPointerCancel);
    }
  } catch (err) { /* захват не обязателен: без него перетаскивание работает, просто менее надёжно */ }
  document.body.classList.add('lib-dragging');
  libDrag.row.classList.add('lib-drag-src');
  // Призрак — копия строки под курсором/пальцем: «что именно я тащу».
  // Значки ✎/+/⇄/× в него не переносим — нажать их всё равно нельзя (у
  // призрака отключены события мыши), а взгляд они отвлекают.
  // Заголовочный вид берём с самой строки-источника, а не из libDrag.isTop:
  // раздел, вложенный в другой раздел, рисуется как обычная подкатегория (см.
  // libTreeRowHtml), хотя kind у него по-прежнему 'top' — призрак обязан
  // выглядеть ровно так же, как то, что подняли с экрана.
  const ghostIsHeading = libDrag.row.classList && libDrag.row.classList.contains('lib-tree-top');
  const ghost = document.createElement('div');
  ghost.className = 'lib-drag-ghost';
  ghost.style.width = rect.width + 'px';
  ghost.innerHTML = '<div class="lib-tree-row' + (ghostIsHeading ? ' lib-tree-top' : '') + '">'
    + '<span class="lib-tree-arrow"></span>'
    + '<span class="lib-tree-name">' + esc(libDrag.label) + '</span></div>';
  document.body.appendChild(ghost);
  libDrag.ghost = ghost;
  const line = document.createElement('div');
  line.className = 'lib-drop-line';
  line.style.display = 'none';
  document.body.appendChild(line);
  libDrag.line = line;
  // Пальцем: touch-action браузер прочитал ещё в момент касания, поэтому
  // одного класса на body мало — прокрутку на время жеста гасим ещё и
  // preventDefault'ом в НЕпассивном touchmove, иначе панель уедет вместе с
  // перетаскиваемой строкой.
  if (libDrag.touch) document.addEventListener('touchmove', libDragBlockTouchScroll, { passive: false });
  // Ставим призрак и считаем цель ПРЯМО СЕЙЧАС, по координатам с pointerdown,
  // не дожидаясь первого движения: жест мог начаться от удержания, указатель
  // при этом стоит на месте, и без этих двух строк пользователь увидел бы,
  // что строка «взялась», только когда повёл мышь, — то есть ровно тогда,
  // когда подтверждение уже не нужно.
  libDragMoveGhost();
  libDragUpdateTarget();
  return true;
}

function libDragBlockTouchScroll(e) {
  if (libDrag && libDrag.active && e.cancelable) e.preventDefault();
}

function libTreeDragMove(e) {
  if (!libDrag) return;
  if (e.pointerId != null && libDrag.pointerId != null && e.pointerId !== libDrag.pointerId) return;
  libDrag.x = e.clientX;
  libDrag.y = e.clientY;
  if (!libDrag.active) {
    const dx = e.clientX - libDrag.startX;
    const dy = e.clientY - libDrag.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (libDrag.touch) {
      // Палец поехал РАНЬШЕ, чем истекло удержание, — это прокрутка списка,
      // а не перетаскивание: снимаем кандидата (вместе с его таймером
      // удержания) и больше браузеру не мешаем.
      if (dist > LIB_DRAG_TOUCH_SLOP) libTreeDragFinish(false);
      return;
    }
    // Мышь: мелкое дрожание кандидата не снимает и таймер удержания не
    // сбрасывает — «держу на месте» с точностью до порога это и есть.
    if (dist < LIB_DRAG_MOUSE_SLOP) return;
    // Повели раньше, чем истекло удержание — начинаем сразу (сам старт снимет
    // таймер, см. libTreeDragBegin).
    if (!libTreeDragBegin()) return;
  }
  // Пока тащим — ни выделения текста мышью, ни прокрутки «за компанию».
  if (e.cancelable) e.preventDefault();
  libDragMoveGhost();
  libDragUpdateTarget();
  libDragUpdateAutoScroll();
}

function libDragMoveGhost() {
  if (!libDrag || !libDrag.ghost) return;
  libDrag.ghost.style.left = (libDrag.x - libDrag.grabDX) + 'px';
  libDrag.ghost.style.top = (libDrag.y - libDrag.grabDY) + 'px';
}

// Можно ли сделать parentPath новым родителем перетаскиваемого узла. Своих
// правил здесь НЕТ: набор целей тот же самый, что предлагает меню ⇄ (см.
// libMoveTargets — бросок в себя и в своего потомка, чужой раздел, ветка с
// материалами фасадов вне «плитного» корня), он посчитан в libTreeDragBegin.
function libDragAllowedParent(parentPath) {
  return !!(libDrag && libDrag.allowedKeys && libDrag.allowedKeys[parentPath.join('::')]);
}

// Куда попадёт узел, если отпустить прямо сейчас: { mode: 'into' | 'between',
// parentPath, index } либо null — цели нет (курсор мимо дерева, чужой раздел,
// недопустимая цель). index считается по списку детей БЕЗ самого узла — см.
// libPlaceChildAt.
function libDragResolveTarget(x, y) {
  if (!libDrag) return null;
  // Призрак висит ровно под курсором и перехватил бы попадание — у него
  // pointer-events: none (см. .lib-drag-ghost в style.css).
  const el = document.elementFromPoint(x, y);
  const row = el && el.closest ? el.closest('[data-tree-node]') : null;
  if (!row) return null;
  // Между РАЗНЫМИ разделами дерево не переносится (сменился бы тип товара/
  // ключ категории, от которого зависит расчёт) — чужой раздел просто не
  // подсвечиваем, как и любую другую недопустимую цель.
  const rect = row.getBoundingClientRect();
  const isTopRow = row.dataset.kind === 'top';
  // Тащим РАЗДЕЛ: цель — только другой раздел ТОЙ ЖЕ вкладки. По краям его
  // строки — «встать рядом» (к тому же родителю, что и цель), по середине —
  // «вложить раздел в раздел» (см. ветку mode 'topInto' ниже и
  // state.libTopParent: вложение меняет только раскладку на экране, тип
  // позиций остаётся прежним). Строка ВНУТРИ дерева целью не бывает: раздел
  // не может стать подкатегорией — у фурнитуры его ключ задаёт тип позиций,
  // у материалов раздел определяет тип товара.
  if (libDrag.isTop) {
    if (!isTopRow) return null;
    const code = row.dataset.top || '';
    if (code === libDrag.topCode) return null;                      // сам на себя
    if (libTabTopCodes(libDrag.tabKey).indexOf(code) < 0) return null;   // раздел не этой вкладки
    const zoneTop = libDragRowZone(rect, y);
    if (zoneTop === 'into') {
      // Вложить раздел в раздел. Запрещён только цикл — в себя или в
      // собственного потомка (см. libTopCanNest); тип позиций от вложения не
      // меняется, поэтому больше ограничений нет.
      if (!libTopCanNest(libDrag.tabKey, libDrag.topCode, code)) return null;
      return { mode: 'topInto', parentPath: [], ref: code, row, rect, before: false };
    }
    // «Встать рядом» = к тому же родителю, что и цель. Для корневой цели это
    // возврат наверх, для вложенной — соседство внутри её родителя.
    const refParent = libTopParentOf(libDrag.tabKey, code);
    if (refParent && !libTopCanNest(libDrag.tabKey, libDrag.topCode, refParent)) return null;
    return { mode: 'top', parentPath: [], ref: code, row, rect, before: zoneTop === 'before' };
  }
  // Тащим ПОДКАТЕГОРИЮ. Строка раздела целью не является ни в каком виде:
  // «встать рядом» нельзя (подкатегория не становится разделом), а
  // «вложить внутрь» с неё убрано намеренно — одна и та же строка не должна
  // означать сразу и «переставь раздел», и «положи сюда подкатегорию».
  // Перенос подкатегории в корень раздела по-прежнему делается значком ⇄
  // («В корень раздела»).
  if (isTopRow) return null;
  if ((row.dataset.top || '') !== libDrag.topCode) return null;
  const refPath = row.dataset.path ? row.dataset.path.split('::') : [];
  const zone = libDragRowZone(rect, y);
  if (zone === 'into') {
    if (!libDragAllowedParent(refPath)) return null;
    return { mode: 'into', parentPath: refPath, ref: null, row, rect, before: false };
  }
  const parentPath = refPath.slice(0, -1);
  if (!libDragAllowedParent(parentPath)) return null;
  const dragName = libDrag.path[libDrag.path.length - 1];
  // «Без бренда» порядок всё равно прибьёт к концу списка (см.
  // libChildSegments — это ведро для позиций без фирмы, а не равноправная
  // подкатегория). Обещать линией место среди соседей нельзя: результат
  // оказался бы другим. Вложить её внутрь узла (mode 'into') при этом можно.
  if (libDragIsNoBrand(dragName)) return null;
  const refName = refPath[refPath.length - 1];
  const sibs = libChildSegments(libDrag.topCode, parentPath).filter((s) => s !== dragName);
  const at = sibs.indexOf(refName);
  if (at < 0) return null;   // навели на сам перетаскиваемый узел — ставить рядом с собой нечего
  const before = zone === 'before';
  // По той же причине не предлагаем встать НИЖЕ «Без бренда»: узел всё равно
  // оказался бы выше него, не там, где показала линия.
  if (sibs.slice(0, before ? at : at + 1).some(libDragIsNoBrand)) return null;
  // Запоминаем СОСЕДА, а не номер позиции: номер к моменту броска может
  // устареть (см. libChildInsertIndex), а «встать над/под этой категорией»
  // остаётся верным описанием того, что показала линия.
  return { mode: 'between', parentPath, ref: refName, row, rect, before };
}

function libDragUpdateTarget() {
  if (!libDrag || !libDrag.active) return;
  libDrag.target = libDragResolveTarget(libDrag.x, libDrag.y);
  libDragShowIndicator(libDrag.target);
}

// Индикатор цели: подсветка строки целиком — «вложить внутрь этого узла»,
// линия между строками — «встать на это место среди соседей». Недопустимая
// цель не показывается никак (target === null) — это и есть подсказка
// «сюда нельзя».
function libDragShowIndicator(target) {
  if (!libDrag) return;
  // 'into' — вложить узел в узел, 'topInto' — раздел в раздел: показываются
  // одинаково (подсветка всей строки-цели).
  const intoRow = target && (target.mode === 'into' || target.mode === 'topInto') ? target.row : null;
  if (libDrag.intoRow && libDrag.intoRow !== intoRow) libDrag.intoRow.classList.remove('lib-drop-into');
  if (intoRow) intoRow.classList.add('lib-drop-into');
  libDrag.intoRow = intoRow;
  const line = libDrag.line;
  if (!line) return;
  if (!target || target.mode === 'into' || target.mode === 'topInto') { line.style.display = 'none'; return; }
  // Отступ линии — по глубине БУДУЩЕГО места узла (уровень его новых
  // соседей), чтобы сразу было видно, на каком уровне вложенности он
  // встанет. У раздела (mode 'top') это глубина самой цели: рядом с корневым
  // разделом линия во всю ширину, рядом с вложенным — с его отступом.
  const indent = target.mode === 'top'
    ? libTopDepth(libDrag.tabKey, target.ref) * LIB_TREE_INDENT
    : (target.parentPath.length + 1) * LIB_TREE_INDENT;
  line.style.display = 'block';
  line.style.left = (target.rect.left + indent) + 'px';
  line.style.width = Math.max(40, target.rect.width - indent) + 'px';
  line.style.top = ((target.before ? target.rect.top : target.rect.bottom) - 1) + 'px';
}

// Автопрокрутка у краёв панели: без неё на телефоне (да и на коротком экране)
// невозможно дотащить категорию до места, которое сейчас за пределами видимой
// части списка — бросить её «на полпути» нельзя, жест один.
function libDragUpdateAutoScroll() {
  if (!libDrag || !libDrag.active) return;
  const sc = libDrag.scroller;
  if (!sc || !sc.getBoundingClientRect) { libDrag.scrollDir = 0; return; }
  const r = sc.getBoundingClientRect();
  let dir = 0;
  if (libDrag.y < r.top + LIB_DRAG_EDGE) dir = -1;
  else if (libDrag.y > r.bottom - LIB_DRAG_EDGE) dir = 1;
  libDrag.scrollDir = dir;
  if (dir && !libDrag.raf && typeof requestAnimationFrame === 'function') {
    libDrag.raf = requestAnimationFrame(libDragScrollStep);
  }
}

function libDragScrollStep() {
  if (!libDrag || !libDrag.active) return;
  libDrag.raf = 0;
  if (!libDrag.scrollDir) return;
  const sc = libDrag.scroller;
  const before = sc.scrollTop;
  sc.scrollTop = before + libDrag.scrollDir * LIB_DRAG_SPEED;
  // Содержимое уехало под неподвижным курсором — под ним уже другая строка,
  // цель нужно пересчитать, иначе индикатор «залипнет» на прежней.
  if (sc.scrollTop !== before) libDragUpdateTarget();
  libDrag.raf = requestAnimationFrame(libDragScrollStep);
}

function libTreeDragPointerUp(e) {
  if (!libDrag) return;
  if (e.pointerId != null && libDrag.pointerId != null && e.pointerId !== libDrag.pointerId) return;
  // Бросок мимо дерева или на недопустимую цель — target пуст, применять
  // нечего (см. libTreeDragFinish), ничего не меняется.
  libTreeDragFinish(true);
}

function libTreeDragPointerCancel() {
  // Система забрала указатель (системный жест, звонок, палец «уехал» в
  // прокрутку) — это отмена, а не бросок.
  libTreeDragFinish(false);
}

function libTreeDragKeyDown(e) {
  if (e.key === 'Escape') libTreeDragFinish(false);
}

// Снимает перетаскивание (или кандидата на него) и, если apply и цель есть,
// применяет бросок. Порядок важен: сначала полная уборка (слушатели,
// призрак, подсветка), только потом сама правка — она перерисовывает панель,
// и все ссылки на строки после неё уже недействительны.
function libTreeDragFinish(apply) {
  if (!libDrag) return;
  const d = libDrag;
  libDrag = null;
  clearTimeout(d.holdTimer);
  if (d.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(d.raf);
  document.removeEventListener('pointermove', libTreeDragMove);
  document.removeEventListener('pointerup', libTreeDragPointerUp);
  document.removeEventListener('pointercancel', libTreeDragPointerCancel);
  document.removeEventListener('keydown', libTreeDragKeyDown);
  document.removeEventListener('touchmove', libDragBlockTouchScroll, { passive: false });
  if (d.captured && d.row) {
    d.row.removeEventListener('lostpointercapture', libTreeDragPointerCancel);
    // Повторный вход сюда через lostpointercapture не страшен: libDrag уже
    // обнулён выше, и второй вызов выйдет на первой же строке.
    try {
      if (d.row.releasePointerCapture && d.row.hasPointerCapture && d.row.hasPointerCapture(d.pointerId)) {
        d.row.releasePointerCapture(d.pointerId);
      }
    } catch (err) { /* указатель уже отпущен браузером — ничего делать не нужно */ }
  }
  if (!d.active) return;   // до перетаскивания дело не дошло — это был обычный клик/прокрутка
  document.body.classList.remove('lib-dragging');
  if (d.row) d.row.classList.remove('lib-drag-src');
  if (d.intoRow) d.intoRow.classList.remove('lib-drop-into');
  if (d.ghost) d.ghost.remove();
  if (d.line) d.line.remove();
  // Гасим следующий клик, если жест ДОШЁЛ до перетаскивания и завершился
  // отпусканием кнопки (apply): вслед за ним браузер шлёт click, и без
  // подавления он ещё и раскрыл бы/свернул узел, с которого начали тащить.
  // Важно, что это не зависит от того, был ли бросок применён: если жест
  // начался от удержания, а пользователь отпустил кнопку не сдвинувшись, он
  // уже увидел, что строка «взята», — и обычным кликом это отпускание для
  // него не является, узел трогать нельзя.
  // При ОТМЕНЕ (Escape, pointercancel) флаг не поднимаем: там клика следом
  // не будет, а поднятый флаг съел бы первый настоящий клик пользователя.
  if (apply) {
    libDragClickGuard = true;
    // Таймер прошлого жеста снимаем: иначе он погасил бы guard текущего.
    clearTimeout(libDragClickGuardTimer);
    // Страховка: если клика следом не будет (на тач-устройствах его часто и
    // нет), флаг не должен дожить до следующего настоящего клика.
    libDragClickGuardTimer = setTimeout(() => { libDragClickGuard = false; }, 300);
    if (d.target) libDragApplyDrop(d);
  }
}

// Применение броска. Смена родителя — это ТА ЖЕ операция, что и значок ⇄:
// зовём libMoveNode (проверка дубликата имени у нового родителя, перезапись
// путей позиций и заглушек, спасение осиротевшего родителя, раскрытие пути до
// перенесённого узла, сохранение и перерисовка), добавляя к ней только место
// в порядке. Второй копии этой логики здесь нет намеренно.
function libDragApplyDrop(d) {
  const t = d.target;
  // Раздел: меняется ТОЛЬКО его место среди разделов вкладки. Ни дерево, ни
  // categoryPath позиций, ни свёрнутость/фокус при этом не трогаются —
  // поэтому и раскрытая категория, и открытая таблица листа переживают
  // перестановку как были.
  if (t.mode === 'top' || t.mode === 'topInto') { libDropTopCategory(d.tabKey, d.topCode, t); return; }
  const name = d.path[d.path.length - 1];
  const anchor = t.mode === 'between' ? { ref: t.ref, before: t.before } : null;
  const sameParent = t.parentPath.join('::') === d.path.slice(0, -1).join('::');
  if (sameParent) {
    // Родитель тот же — меняется только порядок среди соседей, трогать
    // categoryPath позиций незачем (это и быстрее, и не плодит лишних
    // «правленых» полей в каталоге). Бросок ВНУТРЬ собственного родителя
    // (anchor === null) — это «встать последним среди его детей».
    const index = anchor ? libChildInsertIndex(d.topCode, t.parentPath, name, anchor.ref, anchor.before) : null;
    // Соседа, рядом с которым целились, к моменту броска не стало —
    // обещанного линией места больше нет, а придумывать другое нечестно:
    // честнее не менять ничего.
    if (anchor && index == null) return;
    libPlaceChildAt(d.topCode, t.parentPath, name, index);
    libPruneNodeOrder(d.topCode);
    scheduleCatalogSave();
    renderLibraryPanel();
    return;
  }
  libMoveNode(d.topCode, d.path, t.parentPath, anchor);
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
  // Список сайтов-поставщиков (см. libSourceSiteLabel/колонка «Поставщик», а
  // также форма «Добавить по ссылке») — грузим уже здесь, при ЛЮБОЙ
  // перерисовке Библиотеки, а не только по клику «+ Добавить по ссылке»
  // (openLibLinkForm тоже его дёргает): иначе колонка «Поставщик» висела бы
  // на «…» до первого открытия этой формы, даже если пользователь просто
  // листает каталог. loadLibLinkSites() сама не шлёт повторных запросов, пока
  // список уже загружен/грузится (см. её начало) — лишний вызов на каждую
  // перерисовку ничего не стоит.
  loadLibLinkSites();
  // Полная перерисовка вот-вот заменит innerHTML целиком — открытый поповер
  // сортировки/фильтра колонки (см. openColumnFilterMenu) держит ссылку на
  // кнопку/таблицу, которые сейчас пропадут из DOM, закрываем его заранее
  // (тот же приём, что и renderDetailingTable/closeColumnFilterMenu).
  closeColumnFilterMenu();
  // И увеличенное превью лупы-зума (см. openLibSwatchZoomPreview) — держит
  // ссылку на .lib-swatch-zoom-icon конкретной миниатюры, которая сейчас
  // пропадёт вместе с innerHTML; иначе превью осталось бы висеть сиротой.
  closeLibSwatchZoomPreview();
  // Та же причина — открытый кастомный список «Сайт-источник» формы
  // «Добавить по ссылке» (см. libLinkSitePickerHtml/openLibLinkSiteMenu)
  // держит ссылку на DOM-узел, который вот-вот пропадёт.
  closeLibLinkSiteMenu();
  // И меню «Перенести … в:» (см. openLibMoveMenu) — оно привязано к значку ⇄
  // конкретной строки дерева/таблицы, которая сейчас перерисуется.
  closeLibMoveMenu();
  // По той же причине снимаем начатое перетаскивание узла дерева (см.
  // libTreeDragFinish): панель перерисовывают из десятка мест, в том числе
  // фоновая подгрузка правок каталога с сервера, и жест пережить это не
  // может — он держит ссылки на строки, которые сейчас исчезнут вместе с
  // innerHTML. Оставили бы как есть — на экране зависли бы призрак и
  // подсветка цели. Рекурсии тут нет: сам бросок обнуляет перетаскивание
  // ДО того, как позовёт перерисовку.
  libTreeDragFinish(false);
  // То же самое — перетаскивание миниатюры модуля (см. libModCardDragFinish)
  // и её контекстное меню ✎+⇄× (см. closeLibModCardMenu): оба держат ссылки
  // на карточку/строку, которые сейчас пропадут вместе с innerHTML.
  libModCardDragFinish();
  closeLibModCardMenu();
  document.querySelectorAll('.lib-tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.libtab === state.libraryTab);
  });
  // На «Материалах»/«Фурнитуре»/«Дверях» таблицы шире панели «Базы модулей»
  // — #drawer-library переключается на свою (тоже фиксированную, но большую)
  // ширину (см. .lib-wide в style.css: одна и та же ширина для всех таблиц
  // раздела, а не «под самую широкую», как раньше); на «Базе модулей»
  // ширина панели остаётся стандартной. .lib-chars-collapsed — доп. сужение
  // при свёрнутых характеристиках (state.libCharsCollapsed, см.
  // #drawer-library.lib-wide.lib-chars-collapsed в style.css) — реально
  // освобождает место под 3D-сцену, а не просто ужимает ячейки в той же
  // ширине панели.
  const drawer = document.getElementById('drawer-library');
  if (drawer) {
    const wide = state.libraryTab === 'materials' || state.libraryTab === 'hardware' || state.libraryTab === 'facades';
    drawer.classList.toggle('lib-wide', wide);
    drawer.classList.toggle('lib-chars-collapsed', wide && !!state.libCharsCollapsed);
  }
  // Приводим дерево категорий к инварианту ДО построения разметки (см.
  // libNormalizeOwnEntries): позиции узла, у которого есть подкатегории,
  // переезжают в его «Без бренда». Точка одна и общая на все разделы —
  // перерисовка панели случается и при первом открытии «Библиотеки», и после
  // асинхронной подгрузки правок каталога с сервера, и после отката каталога
  // к заводскому при выходе из аккаунта (см. loadCatalogOverrides/
  // restoreCatalogFrom), так что мигрировать успевают любые данные. На уже
  // нормализованном дереве функция ничего не делает и сохранение не дёргает,
  // поэтому лишней перерисовки/записи на сервер по кругу не будет.
  let libTreeNormalized = false;
  libNormalizableTopCodes().forEach((t) => { if (libNormalizeOwnEntries(t)) libTreeNormalized = true; });
  if (libTreeNormalized) scheduleCatalogSave();
  if (state.libraryTab === 'materials') panel.innerHTML = libraryMaterialsBlock();
  else if (state.libraryTab === 'hardware') panel.innerHTML = libraryHardwareBlock();
  else if (state.libraryTab === 'facades') panel.innerHTML = libraryFacadesBlock();
  else panel.innerHTML = libraryBlock();   // 'modules' — «База модулей», дерево категорий (см. libraryBlock)
  bindLibraryEvents();
  applyLibrarySearch();
  // Применяет уже сохранённое состояние поповера сортировки/фильтра (см.
  // openColumnFilterMenu/columnFilterStates) к каждой заново отрисованной
  // таблице листа отдельно (ключ — data-chars-key, тот же, что и у кнопки
  // «Характеристики материала») — иначе после переключения дерева/добавления позиции
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

// Раздел «Алюминиевые фасады» вкладки «Двери» — свой блок, а не ветка
// общего дерева категорий (libTopCategoryHtml): у профилей/комплектующих/
// производителей другие колонки, чем у листовых материалов. Раскрыт ли —
// чисто UI-состояние вкладки, в проект/каталог не попадает. Раскрыт по
// умолчанию и стоит первым на вкладке — иначе конструктор фасада трудно найти.
let libAluOpen = true;

const ALU_FILL_TYPE_LABEL = { glass: 'стекло', sheet: 'плита' };

// Ячейка-инпут цены/длины: пусто = цена не указана (null), никаких
// подстановок нуля. Сохраняется по change (см. libAluApplyEdit).
function libAluNumInput(kind, key, prop, value, opts) {
  const o = opts || {};
  return `<input type="number" class="lib-alu-input" min="${o.min != null ? o.min : 0}" step="${o.step || 0.01}"
    data-alu-edit="${esc(kind)}" data-alu-key="${esc(key)}" data-alu-prop="${esc(prop)}"
    value="${value != null ? esc(value) : ''}" placeholder="${esc(o.placeholder || '—')}"${o.disabled ? ' disabled' : ''}
    title="${esc(o.title || '')}">`;
}

// Пометки profile.priceNote вида «часть; часть» — части, общие для ВСЕХ
// профилей, показываем одной строкой над таблицей, остальное — в строке.
function libAluSplitNotes(items) {
  const partsOf = (it) => String((it && it.priceNote) || '').split(';').map((s) => s.trim()).filter(Boolean);
  const lists = items.map(partsOf);
  const common = lists.length ? lists[0].filter((p) => lists.every((l) => l.indexOf(p) >= 0)) : [];
  return { common, rest: lists.map((l) => l.filter((p) => common.indexOf(p) < 0)) };
}

// Картинка сечения профиля (Библиотеке → Двери → Алюминиевые фасады →
// Профили): своя картинка пользователя вместо векторного чертежа. Хранится в
// profile.sectionImage (data URL, сжатая до ALU_SECTION_IMAGE_MAX_SIDE) —
// в правках каталога пользователя (snapshotCatalogCollections →
// PUT /catalog-overrides, восстановление — restoreAluCatalogFrom). В базу по
// умолчанию (публикация каталога) НЕ попадает: сервер публикует у aluProfiles
// только price/priceUnit/barLength (server catalogPublishCodegen
// ALU_EDITABLE_FIELDS) — чертёж производителя видит только тот, кто загрузил.
const ALU_SECTION_IMAGE_MAX_SIDE = 600;
let aluSectionImageInput = null;
let aluSectionImageTarget = null;
function libAluSectionImageBtnsHtml(p) {
  const has = aluSectionImageOk(p.sectionImage);
  return `<div class="lib-alu-img-btns">
    <button type="button" class="link-btn" data-alu-img="pick" data-alu-key="${esc(p.code)}" title="Картинка чертежа сечения (png, jpg, webp) — покажется вместо векторного чертежа">${has ? 'Заменить' : 'Загрузить чертёж'}</button>
    ${has ? `<button type="button" class="link-btn lib-alu-img-del" data-alu-img="del" data-alu-key="${esc(p.code)}" title="Удалить картинку — вернётся векторный чертёж">Удалить</button>` : ''}
  </div>`;
}
function libAluPickSectionImage(code) {
  if (!aluProfileByCode(code)) return;
  if (!requireLibraryEditAuth()) return;
  if (!aluSectionImageInput) {
    aluSectionImageInput = document.createElement('input');
    aluSectionImageInput.type = 'file';
    aluSectionImageInput.accept = 'image/png,image/jpeg,image/webp';
    aluSectionImageInput.style.display = 'none';
    aluSectionImageInput.addEventListener('change', () => {
      const file = aluSectionImageInput.files && aluSectionImageInput.files[0];
      const target = aluSectionImageTarget;
      if (!file || !target) return;
      if (!/^image\/(png|jpeg|webp)$/i.test(file.type || '')) {
        window.alert('Нужна картинка в формате PNG, JPG или WEBP.');
        return;
      }
      compressLibImage(file, { maxSide: ALU_SECTION_IMAGE_MAX_SIDE, mime: 'image/png' })
        .then((dataUrl) => {
          if (!aluSectionImageOk(dataUrl)) throw new Error('не картинка');
          libAluSetSectionImage(target, dataUrl);
        })
        .catch((err) => {
          console.error('Не удалось обработать картинку сечения профиля:', err);
          window.alert('Не удалось загрузить картинку. Попробуйте другой файл.');
        });
    });
    document.body.appendChild(aluSectionImageInput);
  }
  aluSectionImageTarget = code;
  aluSectionImageInput.value = '';
  aluSectionImageInput.click();
}
function libAluSetSectionImage(code, dataUrl) {
  const prof = aluProfileByCode(code);
  if (!prof) return;
  if (dataUrl == null && !requireLibraryEditAuth()) return;
  prof.sectionImage = dataUrl || null;
  scheduleCatalogSave();
  renderLibraryPanel();
  if (state.panelView === 'module') renderSectionsList();
}

function libAluFacadesHtml() {
  const cat = aluCat();
  const profiles = cat.ALU_PROFILES;
  if (!profiles) return '';
  const head = `<div class="lib-tree-row lib-tree-top lib-alu-head" data-alu-lib-toggle="1">
      <span class="lib-tree-arrow">${libAluOpen ? '▾' : '▸'}</span><span class="lib-tree-name">Алюминиевые фасады</span>
    </div>`;
  if (!libAluOpen) return head;
  const sym = curSym();

  // --- Профили ---
  const pCodes = (cat.ALU_PROFILE_ORDER || Object.keys(profiles)).filter((c) => profiles[c]);
  const pItems = pCodes.map((c) => profiles[c]);
  const notes = libAluSplitNotes(pItems);
  const profRows = pItems.map((p, idx) => {
    const known = Number(p.width) > 0 && Number(p.depth) > 0;
    const fill = ALU_FILL_TYPE_LABEL[p.fillType] || 'любое';
    const rest = notes.rest[idx];
    return `<tr data-search="${esc([p.name, p.article, p.code, p.supplier].join(' ').toLowerCase())}">
      <td>${esc(p.name)} <button type="button" class="link-btn lib-alu-prof-pick" data-alu-pick-profile="${esc(p.code)}" title="Подставить этот профиль в конструктор фасада выше">Выбрать</button><div class="dim">арт. ${esc(p.article || p.code)}${p.sourceUrl ? ` · <a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">${esc(p.supplier || 'поставщик')}</a>` : (p.supplier ? ` · ${esc(p.supplier)}` : '')}</div>${ALU_KIND_LABEL[p.kind] ? `<div class="dim">Тип: ${esc(ALU_KIND_LABEL[p.kind])} — ${esc(ALU_KIND_HINT[p.kind])}</div>` : ''}<div class="dim">Заполнение: ${esc(fill)}${p.fillThickness ? ` ${esc(p.fillThickness)} мм` : ''}</div>${rest.length ? `<div class="dim">${esc(rest.join('; '))}</div>` : ''}</td>
      <td class="lib-alu-schema-cell">${aluProfileSectionHtml(p, { small: true })}<div class="dim">${known ? `${esc(p.width)}×${esc(p.depth)} мм` : 'по паспорту'}</div>${libAluSectionImageBtnsHtml(p)}</td>
      <td>
        ${libAluNumInput('profile', p.code, 'price', p.price, { title: p.colorPrices ? 'Базовая цена; для части цветов цена своя (задана в каталоге)' : '' })}
        <select class="lib-alu-input lib-alu-unit" title="Единица цены" data-alu-edit="profile" data-alu-key="${esc(p.code)}" data-alu-prop="priceUnit">
          <option value="" ${p.priceUnit == null ? 'selected' : ''} title="Единица цены не подтверждена поставщиком">не указана</option>
          <option value="m" ${p.priceUnit === 'm' ? 'selected' : ''}>за пог. м</option>
          <option value="bar" ${p.priceUnit === 'bar' ? 'selected' : ''}>за палку</option>
        </select>
        ${p.priceUnit === 'bar' ? `<div class="lib-alu-bar">длина, м ${libAluNumInput('profile', p.code, 'barLength', p.barLength, { step: 0.1, min: 0.1, placeholder: '?' })}</div>` : ''}
      </td>
    </tr>`;
  }).join('');
  const profTable = `
    <div class="lib-alu-sub">Профили</div>
    ${notes.common.length ? `<p class="hint">Цена: ${esc(notes.common.join('; '))}. Пока единица не подтверждена, смета считает цену за метр.</p>` : ''}
    <table class="lib-table lib-alu-table" style="table-layout:fixed">
      <colgroup><col><col style="width:92px"><col style="width:112px"></colgroup>
      <thead><tr><th>Профиль</th><th>Сечение</th><th>Цена, ${esc(sym)}</th></tr></thead>
      <tbody>${profRows || '<tr><td colspan="3" class="hint">Пока нет позиций</td></tr>'}</tbody>
    </table>`;

  // --- Цвета ---
  const colors = cat.ALU_PROFILE_COLORS || {};
  const cIds = (cat.ALU_PROFILE_COLOR_ORDER || Object.keys(colors)).filter((id) => colors[id]);
  const colorTable = `
    <div class="lib-alu-sub">Цвета профиля</div>
    <table class="lib-table lib-alu-table" style="table-layout:fixed">
      <colgroup><col><col style="width:90px"></colgroup>
      <thead><tr><th>Цвет</th><th>Образец</th></tr></thead>
      <tbody>${cIds.map((id) => `<tr data-search="${esc(String(colors[id].name).toLowerCase())}"><td>${esc(colors[id].name)}</td><td><span class="alu-swatch alu-swatch-lg" style="background:${esc(colors[id].hex)}" title="${esc(colors[id].hex)}"></span></td></tr>`).join('')}</tbody>
    </table>`;

  // --- Комплектующие и работа ---
  const extras = cat.ALU_FRAME_EXTRAS || {};
  const extraRows = Object.keys(extras).map((k) => {
    const x = extras[k];
    const unit = x.unit === 'шт' && x.perFacade ? `шт (${x.perFacade} на фасад)` : (x.unit || '');
    return `<tr data-search="${esc([x.name, x.article, x.code].join(' ').toLowerCase())}">
      <td>${esc(x.name)}${x.article || x.sourceUrl ? `<div class="dim">${x.article ? `арт. ${esc(x.article)}` : ''}${x.sourceUrl ? ` · <a href="${esc(x.sourceUrl)}" target="_blank" rel="noopener">${esc(x.supplier || 'поставщик')}</a>` : ''}</div>` : ''}${x.price == null && x.priceNote ? `<div class="dim">Цена: ${esc(x.priceNote)}</div>` : ''}</td>
      <td>${libAluNumInput('extra', k, 'price', x.price)}<div class="dim">${esc(unit)}</div></td>
    </tr>`;
  }).join('');
  const extrasTable = `
    <div class="lib-alu-sub">Комплектующие и работа <span class="dim">(для собственного изготовления)</span></div>
    <table class="lib-table lib-alu-table" style="table-layout:fixed">
      <colgroup><col><col style="width:112px"></colgroup>
      <thead><tr><th>Позиция</th><th>Цена, ${esc(sym)}</th></tr></thead>
      <tbody>${extraRows}</tbody>
    </table>`;

  // --- Производители ---
  const makers = cat.ALU_MAKERS || {};
  const mIds = (cat.ALU_MAKER_ORDER || Object.keys(makers)).filter((id) => makers[id]);
  const makerRows = mIds.map((id) => {
    const m = makers[id];
    return `<tr data-search="${esc([m.name, m.city, m.phone, m.email].join(' ').toLowerCase())}">
      <td>${esc(m.name)}<div class="dim">${esc([m.city, m.address].filter(Boolean).join(', '))}</div><div class="dim lib-alu-contacts">${aluMakerContactsHtml(m)}</div></td>
      <td>${libAluNumInput('maker', id, 'pricePerM2', m.pricePerM2, { placeholder: '—' })}${m.pricePerM2 == null ? '<div class="dim">Уточняйте цену у производителя</div>' : ''}</td>
    </tr>`;
  }).join('');
  const makersTable = `
    <div class="lib-alu-sub">Производители готовых фасадов</div>
    <table class="lib-table lib-alu-table" style="table-layout:fixed">
      <colgroup><col><col style="width:112px"></colgroup>
      <thead><tr><th>Производитель</th><th>Цена за м², ${esc(sym)}</th></tr></thead>
      <tbody>${makerRows || '<tr><td colspan="2" class="hint">Пока нет производителей</td></tr>'}</tbody>
    </table>`;

  return `${head}<div class="lib-leaf-body lib-alu-body">${libAluConstructorHtml()}${profTable}${colorTable}${extrasTable}${makersTable}</div>`;
}

// Правка цены/единицы/длины палки/цены за м² в таблицах «Алюминиевых
// фасадов». Пусто = null («Уточняйте цену…» в смете), отрицательное/не
// число — не сохраняем, подсвечиваем поле. Правка пишется прямо в объект
// каталога (как и у остальных таблиц Библиотеки), дальше — общий
// scheduleCatalogSave() и recompute().
function libAluApplyEdit(el) {
  const cat = aluCat();
  const kind = el.dataset.aluEdit;
  const key = el.dataset.aluKey;
  const prop = el.dataset.aluProp;
  const coll = kind === 'profile' ? cat.ALU_PROFILES : kind === 'extra' ? cat.ALU_FRAME_EXTRAS : kind === 'maker' ? cat.ALU_MAKERS : null;
  const item = coll && coll[key];
  const allowed = { profile: ['price', 'priceUnit', 'barLength'], extra: ['price'], maker: ['pricePerM2'] }[kind] || [];
  if (!item || allowed.indexOf(prop) < 0) return;
  // Как и у остальных таблиц Библиотеки — правка только для вошедших;
  // иначе возвращаем в поле прежнее значение.
  if (!requireLibraryEditAuth()) { renderLibraryPanel(); return; }
  let val;
  if (prop === 'priceUnit') {
    val = el.value === 'm' || el.value === 'bar' ? el.value : null;
  } else {
    const raw = String(el.value || '').trim().replace(',', '.');
    if (raw === '') val = null;
    else {
      const n = Number(raw);
      const bad = !isFinite(n) || n < 0 || (prop === 'barLength' && n <= 0);
      el.classList.toggle('invalid', bad);
      if (bad) { el.title = prop === 'barLength' ? 'Длина палки — число больше 0 (в метрах)' : 'Цена — число не меньше 0'; return; }
      val = n;
    }
  }
  el.classList.remove('invalid');
  item[prop] = val;
  scheduleCatalogSave();
  recompute();
  // Единица цены меняет состав строки (поле длины палки), цена за м²
  // производителя — пометку «Уточняйте цену» и текст в карточке секции.
  if (prop === 'priceUnit' || prop === 'pricePerM2') renderLibraryPanel();
  if (state.panelView === 'module') renderSectionsList();
}

// «Двери» (вкладка data-libtab="facades", см. index.html) — с 2026-09-15
// содержит категорию «Виды фасадов» (декоры/цвета для фасадов, topCode
// 'facade', те же данные FACADE_MATERIALS, что раньше жили под «Материалы
// фасадов» на вкладке «Материалы», см. libraryMaterialsBlock — оттуда
// категорию убрали, сюда перенесли без изменения группы/данных). Фасад как
// отдельное изделие со своими параметрами (толщина, тип, врезка стекла и
// т.п., а не только материал) — полноценная панель под это остаётся
// отдельной задачей на будущее.
//
// Форму «Добавить по ссылке» (kind: 'materials' — тот же формат парсинга,
// что и у остальных материалов, см. openLibLinkForm/libLinkFormHtml)
// рисуем здесь же, а не только в libraryMaterialsBlock — кнопка «+
// Добавить по ссылке» у листа категории «Виды фасадов» (см. linkAddHtml в
// libLeafTableHtml) открывает форму, оставаясь на вкладке «Двери»
// (renderLibraryPanel перерисовывает тот же state.libraryTab), поэтому
// рисовать форму нужно там, где она реально окажется видна. Тумблер
// верхнего уровня «+ Добавить по ссылке» (libLinkTopBarHtml) сюда
// сознательно не переносим — он для всей вкладки «Материалы» с фиксированным
// дефолтом top:'sheet'/group:'decors' (см. коммент у libLinkTopBarHtml),
// категории «Виды фасадов» это не подходит, а своя, правильно
// заполненная кнопка «+ Добавить по ссылке» у неё уже есть на уровне листа.
// «Добавить категорию»-плитка (см. libAddCatTileHtml) при этом здесь всё
// же нужна — заводит СВОЮ корневую категорию «Дверей» (см.
// libAddFacadeCategory/state.libFacCustomCats), это не привязано к форме
// «Добавить по ссылке» выше, отдельный маленький ряд.
function libraryFacadesBlock() {
  // Раздел здесь пока один плюс, возможно, свои категории пользователя —
  // список строится так же, как на соседних вкладках (libTabRootCodes/
  // libTopCategoryTreeHtml), чтобы порядок и вложенность заголовков работали
  // одинаково везде.
  const catsHtml = libTabRootCodes('facades')
    .map((code) => libTopCategoryTreeHtml('facades', code, 0))
    .join('');
  return `
    <div class="lib-link-refresh-bar">${libAddCatTileHtml('facades')}</div>
    ${state.libLinkForm && state.libLinkForm.kind === 'materials' ? libLinkFormHtml(state.libLinkForm) : ''}
    ${libAluFacadesHtml()}
    ${catsHtml}`;
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
    // Форма «Добавить по ссылке» тоже привязана к конкретной вкладке (см.
    // state.libLinkForm.kind) — открытая форма материалов, оставленная
    // незаполненной, не должна неожиданно всплыть при возврате на вкладку.
    state.libLinkForm = null;
    renderLibraryPanel();
  });
  const search = document.getElementById('librarySearch');
  if (search) search.addEventListener('input', applyLibrarySearch);
  const publishBtn = document.getElementById('libPublishBtn');
  if (publishBtn) publishBtn.addEventListener('click', () => { if (!publishBtn.disabled) requestCatalogPublish(); });
  // Поля цен «Алюминиевых фасадов» (см. libAluFacadesHtml/libAluApplyEdit) —
  // делегировано на #libraryPanel, переживает перерисовки содержимого.
  panel.addEventListener('change', (e) => {
    const draftEl = e.target.closest && e.target.closest('[data-alu-draft]');
    if (draftEl) { libAluDraftEdit(draftEl); return; }
    const el = e.target.closest && e.target.closest('[data-alu-edit]');
    if (el) libAluApplyEdit(el);
  });

  // Перетаскивание строк дерева категорий мышью/пальцем (см. большой
  // комментарий над libTreeDragPointerDown) — отдельный pointerdown на той
  // же панели: слушатель висит на самом #libraryPanel, поэтому перерисовка
  // содержимого (renderLibraryPanel заменяет innerHTML целиком) его не
  // теряет, как и делегированный click ниже.
  panel.addEventListener('pointerdown', libTreeDragPointerDown);
  // То же самое для карточек «Базы модулей» (см. большой комментарий над
  // libModCardDragPointerDown) — отдельный, более простой жест: миниатюру
  // можно бросить на ЛЮБУЮ строку дерева модулей, не только своего раздела.
  panel.addEventListener('pointerdown', libModCardDragPointerDown);

  // Лупа-зум миниатюр .lib-swatch (см. openLibSwatchZoomPreview выше) —
  // делегированные mouseover/mouseout на самом #libraryPanel (mouseenter/
  // mouseleave не всплывают, делегировать ими нельзя), переживают
  // renderLibraryPanel так же, как pointerdown-слушатели выше. На «Базе
  // модулей» .lib-swatch-zoom-icon в разметке нет вообще (там обычные
  // карточки без превью) — обработчик там просто ничего не находит.
  panel.addEventListener('mouseover', (e) => {
    const icon = e.target.closest('.lib-swatch-zoom-icon');
    if (icon && !icon.contains(e.relatedTarget)) openLibSwatchZoomPreview(icon);
  });
  panel.addEventListener('mouseout', (e) => {
    const icon = e.target.closest('.lib-swatch-zoom-icon');
    if (!icon || icon.contains(e.relatedTarget)) return;
    // Курсор мог уйти прямо на само превью (соприкасаются) — не закрываем,
    // за это отвечает mouseout самого превью (см. openLibSwatchZoomPreview).
    const preview = document.getElementById('libSwatchZoomPreview');
    if (preview && preview.contains(e.relatedTarget)) return;
    closeLibSwatchZoomPreview();
  });

  panel.addEventListener('click', (e) => {
    // Клик, который браузер шлёт следом за отпусканием кнопки в конце
    // ПЕРЕТАСКИВАНИЯ строки дерева (см. libTreeDragFinish), не должен ещё и
    // раскрыть/свернуть узел, с которого перетаскивание начали.
    if (libDragClickGuard) { libDragClickGuard = false; return; }
    // Клик внутри активного инпута инлайн-переименования узла дерева (см.
    // startTreeRename) — не должен провалиться в обработку клика по строке
    // ниже (иначе строка переключилась бы посреди редактирования).
    if (e.target.closest('.lib-tree-name input')) return;
    // «Алюминиевые фасады» вкладки «Двери» (см. libAluFacadesHtml) — свой
    // блок вне общего дерева: заголовок раскрывает/сворачивает его, клики по
    // полям/ссылкам внутри блока обрабатывает сам браузер (правка — по
    // change, см. libAluApplyEdit), в ветки дерева/таблиц ниже не пускаем.
    if (e.target.closest('[data-alu-lib-toggle]')) {
      libAluOpen = !libAluOpen;
      renderLibraryPanel();
      return;
    }
    const aluImgBtn = e.target.closest('[data-alu-img]');
    if (aluImgBtn) {
      const code = aluImgBtn.dataset.aluKey;
      if (aluImgBtn.dataset.aluImg === 'pick') libAluPickSectionImage(code);
      else if (aluImgBtn.dataset.aluImg === 'del') libAluSetSectionImage(code, null);
      return;
    }
    // Конструктор фасада (libAluConstructorHtml): плашка «Заполнение» —
    // подбор в Библиотеке, «Выбрать» — поставить фасад в цель подбора.
    if (e.target.closest('[data-alu-draft-fill]')) { openAluFillPicker(); return; }
    const draftApply = e.target.closest('[data-alu-draft-apply]');
    if (draftApply) { if (!draftApply.disabled) libAluDraftApply(); return; }
    // «Выбрать» в строке таблицы профилей — профиль в черновик конструктора.
    const profPick = e.target.closest('[data-alu-pick-profile]');
    if (profPick) { libAluPickProfile(profPick.dataset.aluPickProfile); return; }
    // Лист FAC-ALU «Алюминиевый профиль (рамка)» дерева «Виды фасадов» —
    // не листовой материал, а вход в конструктор алюминиевого фасада.
    if (e.target.closest('[data-alu-open-ctor]')) { openAluConstructorFromLibrary(); return; }
    if (e.target.closest('.lib-alu-body')) return;
    // ⇄ ОДНОЙ ПОЗИЦИИ таблицы (см. libRowMoveIcHtml) — ПЕРВЫМ: значок носит
    // тот же класс .lib-tree-ic ради общего вида, но лежит не в строке
    // дерева, а в ячейке «Наименование», поэтому ветка значков дерева ниже
    // его не опознала бы (там обязателен [data-tree-node]), а ветка клика по
    // редактируемой ячейке вместо переноса открыла бы правку названия.
    const rowMoveIc = e.target.closest('[data-row-move]');
    if (rowMoveIc) {
      // Меню открывается поверх страницы (см. openLibMoveMenu) — этот же
      // клик не должен дойти до document, иначе слушатель «клик мимо —
      // закрыть» закрыл бы меню сразу.
      e.stopPropagation();
      openLibRowMoveMenu(rowMoveIc, rowMoveIc.dataset.moveTop, rowMoveIc.dataset.moveGroup, rowMoveIc.dataset.moveKey);
      return;
    }
    // ✎/+/⇄/× узла дерева категорий (см. libTreeRowHtml) — ПЕРЕД обработкой
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
      else if (treeIcon.dataset.treeMove != null) {
        // Меню «куда перенести» открывается поверх страницы (см.
        // openLibTreeMoveMenu) — этот же клик не должен дойти до document,
        // иначе слушатель «клик мимо — закрыть» закрыл бы меню сразу.
        e.stopPropagation();
        openLibTreeMoveMenu(treeIcon, topCode, path);
      }
      else if (treeIcon.dataset.treeDel != null) libDeleteNode(topCode, path);
      return;
    }
    // «Добавить категорию» — кнопка-плитка уровня вкладки (см.
    // libAddCatTileHtml), заводит СВОЮ корневую категорию. kind различает,
    // какой из четырёх вкладок она принадлежит — «База модулей» её тоже
    // использует (см. libraryBlock), хотя там нет ни каталога, ни дерева.
    const addCatTile = e.target.closest('.lib-add-cat-tile');
    if (addCatTile) {
      const kind = addCatTile.dataset.addCat;
      if (kind === 'hardware') libAddHwCategory();
      else if (kind === 'materials') libAddMaterialCategory();
      else if (kind === 'facades') libAddFacadeCategory();
      else if (kind === 'modules') libAddModuleGroup();
      return;
    }
    // «Добавить модуль» — кнопка в шапке «Базы модулей» (см. libraryBlock):
    // сохраняет ТЕКУЩИЙ проект в библиотеку одной карточкой (или комплектом,
    // если модулей несколько, см. libModSaveProjectAsKit).
    const saveProjectBtn = e.target.closest('[data-lib-save-project]');
    if (saveProjectBtn) { libModSaveProjectAsKit(); return; }
    // Хлебная крошка над таблицей сфокусированного листа (см.
    // libBreadcrumbHtml) — клик по любому сегменту, кроме текущего
    // (последнего — сам лист), снимает фокус категории и раскрывает дерево
    // ровно настолько, чтобы этот сегмент стал виден: саму категорию (см.
    // state.libCatOpen) и всех СОБСТВЕННЫХ предков сегмента (см.
    // libNodeKey/state.libCollapsed) — сам сегмент, если это ветка, остаётся
    // в текущем состоянии свёрнутости.
    const bcSeg = e.target.closest('.lib-breadcrumb-seg');
    if (bcSeg) {
      const topCode = bcSeg.dataset.bcTop;
      const segPath = bcSeg.dataset.bcPath ? bcSeg.dataset.bcPath.split('::') : [];
      state.libActiveLeaf[topCode] = null;
      state.libCatOpen[topCode] = true;
      for (let j = 1; j < segPath.length; j++) {
        state.libCollapsed[libNodeKey(topCode, segPath.slice(0, j))] = false;
      }
      state.libSelectedRow = null;
      // См. state.libLastFocusedTop/libLastFocusedChild — тот же сигнал
      // «что пользователь только что трогал», что и у клика по строке дерева
      // ниже, крошка — такое же перемещение по дереву.
      state.libLastFocusedTop[state.libraryTab] = topCode;
      if (segPath.length) {
        state.libLastFocusedChild[libNodeKey(topCode, segPath.slice(0, -1))] = segPath[segPath.length - 1];
      }
      renderLibraryPanel();
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
      // Запоминаем, что пользователь только что трогал именно этот узел —
      // см. state.libLastFocusedTop/libLastFocusedChild выше (нужно
      // «Добавить категорию»/«+» подкатегории, задача 2026-09-21). Для
      // корневой категории — она сама; для ветки/листа — ещё и место среди
      // детей ЕЁ родителя (kind === 'top' самого родителя не имеет).
      state.libLastFocusedTop[state.libraryTab] = topCode;
      if (kind !== 'top' && path.length) {
        state.libLastFocusedChild[libNodeKey(topCode, path.slice(0, -1))] = path[path.length - 1];
      }
      // Смена того, какая таблица(-ы) сейчас видна — выделенная строка (см.
      // state.libSelectedRow) больше не обязательно принадлежит видимой
      // таблице, сбрасываем в обоих случаях (клик по категории целиком и
      // клик по листу — единственные места, где набор видимых таблиц
      // реально меняется; клик по обычной ветке только раскрывает/сворачивает
      // поддерево, таблицы внутри как были видны, так и остаются).
      if (kind === 'top') {
        // Если сейчас показана таблица сфокусированного листа (см.
        // state.libActiveLeaf) — клик по заголовку категории выходит из
        // фокуса и раскрывает дерево, а не молча переключает libCatOpen
        // (который в режиме фокуса не влияет на рендер, см.
        // libTopCategoryHtml, ветка if (activeKey)).
        if (state.libActiveLeaf[topCode]) {
          state.libActiveLeaf[topCode] = null;
          state.libCatOpen[topCode] = true;
        } else {
          state.libCatOpen[topCode] = !state.libCatOpen[topCode];
        }
        state.libSelectedRow = null;
      }
      else if (kind === 'leaf' && String(topCode).indexOf('mod:') === 0) {
        libToggleNode(topCode, path);
      }
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
    // Кнопка-тумблер «Характеристики материала» (см. libLeafTableHtml) — общий
    // на всю Библиотеку (state.libCharsCollapsed — булево, не по ключу таблицы):
    // клик в ЛЮБОЙ из одновременно открытых таблиц сворачивает/разворачивает
    // колонки Длина/Ширина/Толщина сразу везде и сужает саму панель (см.
    // .lib-chars-collapsed в renderLibraryPanel/style.css).
    const charsToggle = e.target.closest('.lib-chars-toggle');
    if (charsToggle) {
      state.libCharsCollapsed = !state.libCharsCollapsed;
      renderLibraryPanel();
      return;
    }
    // Кнопка-тумблер «Поставщики» (см. libLeafTableHtml/
    // libHardwareLeafTableHtml) — НЕЗАВИСИМЫЙ от «Характеристики материала»
    // тумблер (state.libSuppliersVisible), тоже общий на всю Библиотеку:
    // показывает/прячет колонку «Поставщик» сразу во всех открытых таблицах
    // (и материалов, и фурнитуры).
    const suppliersToggle = e.target.closest('.lib-suppliers-toggle');
    if (suppliersToggle) {
      state.libSuppliersVisible = !state.libSuppliersVisible;
      renderLibraryPanel();
      return;
    }
    // Кнопка-тумблер «Характеристики» таблицы ФУРНИТУРЫ (см.
    // libHardwareLeafTableHtml/state.libHwCharsVisible) — показывает/прячет
    // колонку «Чертёж» (миниатюра чертежа присадки, it.drawing). Независим от
    // «Поставщики» выше и от «Характеристики материала» (та вообще про
    // таблицу материалов).
    const hwCharsToggle = e.target.closest('.lib-hw-chars-toggle');
    if (hwCharsToggle) {
      state.libHwCharsVisible = !state.libHwCharsVisible;
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
    // «+ Добавить материал/кромку/столешницу/позицию» под таблицей листа (см.
    // libLeafTableHtml/libHardwareLeafTableHtml/libAddRow) — data-add-path
    // несёт полный путь листа, одинаково у материалов и у фурнитуры.
    const addBtn = e.target.closest('.lib-add');
    if (addBtn) {
      const pathStr = addBtn.dataset.addPath || '';
      libAddRow(addBtn.dataset.add, pathStr ? pathStr.split('::') : [], addBtn.dataset.addTop || '');
      return;
    }
    // «+ Добавить по ссылке» (см. openLibLinkForm/libLinkFormHtml) — та же
    // логика контекста, что и у «+ Добавить материал»/«+ Добавить позицию»
    // рядом, только открывает встроенную форму вместо мгновенного добавления
    // строки с заглушками.
    const linkAddBtn = e.target.closest('.lib-add-by-link');
    if (linkAddBtn) {
      if (linkAddBtn.dataset.linkKind === 'hardware') {
        openLibLinkForm('hardware', {
          hwCategory: linkAddBtn.dataset.linkHwcat,
          path: linkAddBtn.dataset.linkPath ? linkAddBtn.dataset.linkPath.split('::') : [],
        });
      } else {
        openLibLinkForm('materials', {
          top: linkAddBtn.dataset.linkTop,
          group: linkAddBtn.dataset.linkGroup,
          path: linkAddBtn.dataset.linkPath ? linkAddBtn.dataset.linkPath.split('::') : [],
        });
      }
      return;
    }
    // Кастомный выпадающий список «Сайт-источник» (см. libLinkSitePickerHtml)
    // — переключатель только открывает/закрывает список, без сайд-эффектов.
    const siteToggle = e.target.closest('.lib-link-site-toggle');
    if (siteToggle) {
      if (siteToggle.disabled) return;
      const picker = siteToggle.closest('.lib-link-site-picker');
      if (!picker) return;
      const list = picker.querySelector('.lib-link-site-list');
      if (list && !list.hidden) closeLibLinkSiteMenu();
      else openLibLinkSiteMenu(picker);
      return;
    }
    // Клик по пункту списка сайтов: запоминаем выбор и закрываем список.
    // Сайт в новой вкладке открывает САМ БРАУЗЕР — пункт списка это
    // <a target="_blank"> (см. libLinkSitePickerHtml), нативная навигация
    // под popup-блокировку не попадает. Поэтому здесь НЕТ ни window.open
    // (на file:// Chrome его молча блокирует), ни e.preventDefault() —
    // preventDefault погасил бы сам переход по ссылке. Найти товар и
    // скопировать его URL — единственное, что остаётся сделать
    // пользователю руками, отдельной ссылки-подсказки под списком не нужно.
    const siteItem = e.target.closest('.lib-link-site-item');
    if (siteItem && siteItem.closest('.lib-link-site-picker[data-picker="tex"]')) {
      // Сайт производителя текстуры: браузер сам открывает его в новой вкладке
      // (пункт — <a target=_blank>), здесь только запоминаем выбор.
      const form = state.libLinkForm;
      if (!form) return;
      const tex = libTexState(form);
      tex.siteId = siteItem.dataset.siteId || '';
      closeLibLinkSiteMenu();
      const site = (state.texSources || []).find((s) => s.id === tex.siteId);
      libSitePickerMark(siteItem.closest('.lib-link-site-picker'), site, tex.siteId);
      libLinkRevalidate(panel);
      return;
    }
    if (siteItem) {
      const form = state.libLinkForm;
      if (!form) return;
      form.siteId = siteItem.dataset.siteId || '';
      closeLibLinkSiteMenu();
      const site = (state.libLinkSites || []).find((s) => s.id === form.siteId);
      // Точечно обновляем подпись переключателя и «active»-пункт — не
      // renderLibraryPanel() целиком: она стёрла бы фокус/курсор в соседнем
      // поле «Ссылка на товар», если пользователь уже там печатал.
      const picker = siteItem.closest('.lib-link-site-picker');
      if (picker && site) {
        const labelEl = picker.querySelector('.lib-link-site-toggle-label');
        if (labelEl) labelEl.textContent = site.name === site.domain ? site.name : `${site.name} (${site.domain})`;
        picker.querySelectorAll('.lib-link-site-item').forEach((item) => {
          item.classList.toggle('active', item.dataset.siteId === form.siteId);
        });
      }
      libLinkRevalidate(panel);
      return;
    }
    const linkCloseBtn = e.target.closest('.lib-link-close, .lib-link-cancel');
    if (linkCloseBtn) { closeLibLinkForm(); return; }
    const linkCheckBtn = e.target.closest('.lib-link-check');
    if (linkCheckBtn) { if (!linkCheckBtn.disabled) libLinkCheckSubmit(panel); return; }
    const linkSaveBtn = e.target.closest('.lib-link-save');
    if (linkSaveBtn) { if (!linkSaveBtn.disabled) libLinkSaveSubmit(panel); return; }
    const texFetchBtn = e.target.closest('.lib-tex-fetch');
    if (texFetchBtn) { if (!texFetchBtn.disabled && state.libLinkForm) libTexDownload(state.libLinkForm); return; }
    const texLoadBtn = e.target.closest('.lib-tex-load');
    if (texLoadBtn) { if (!texLoadBtn.disabled) libTexReload(texLoadBtn.dataset.texGroup, texLoadBtn.dataset.texCode); return; }
    const texPackSave = e.target.closest('.lib-tex-pack-save');
    if (texPackSave) { libTexPackSave(); return; }
    const texPackLoad = e.target.closest('.lib-tex-pack-load');
    if (texPackLoad) { const inp = panel.querySelector('.lib-tex-pack-input'); if (inp) inp.click(); return; }
    const linkRefreshBtn = e.target.closest('.lib-link-refresh-btn');
    if (linkRefreshBtn) { if (!linkRefreshBtn.disabled) refreshCatalogLinkedPrices(); return; }
    // «− Удалить материал» / «− Удалить позицию» под таблицей листа (см.
    // libLeafTableHtml/libHardwareLeafTableHtml) — работает только с уже
    // выделенной кликом по строке позицией (см. ветку ниже), кнопка
    // неактивна (disabled), пока ничего не выбрано.
    const delRowBtn = e.target.closest('.lib-row-del');
    if (delRowBtn) { libDeleteSelectedRow(); return; }
    const swatch = e.target.closest('.lib-swatch');
    if (swatch) {
      // Touch (телефон/планшет, см. isTouchLibraryDevice) — лупа-иконка и
      // сама миниатюра слишком мелкие и близкие мишени для пальца, поэтому
      // там нет отдельного «навести на лупу»: тап по самой миниатюре сразу
      // открывает то же увеличенное превью 250×250 (см.
      // openLibSwatchZoomPreview), а переход на сайт (если есть sourceUrl) —
      // явной кнопкой «Перейти на сайт» внутри превью, не самим тапом по
      // миниатюре (задача 2026-09-26).
      if (isTouchLibraryDevice()) {
        if (swatch.dataset.swatchSrc) { openLibSwatchZoomPreview(swatch, { showLink: true }); return; }
        // Картинки нет, но есть sourceUrl — бывает у позиций «по ссылке»,
        // если парсер сайта не нашёл фото товара (см. libLinkSelectedImageUrl,
        // может вернуть null, а позиция всё равно сохраняется). Превью
        // показывать нечего — как на desktop, сразу открываем карточку
        // товара, а не системный выбор файла (иначе на телефоне для таких
        // позиций переход на сайт был бы вообще недостижим).
        if (swatch.dataset.swatchUrl) { window.open(swatch.dataset.swatchUrl, '_blank', 'noopener'); return; }
        // Ни картинки, ни sourceUrl — пустая заглушка «+», как на desktop,
        // открыть системный выбор файла (у пустого чертежа присадки клика
        // нет и на desktop, см. ветку ниже — здесь просто ничего не делаем).
        if (!swatch.classList.contains('lib-drawing-swatch')) openLibImagePicker(swatch.dataset.swatchGroup, swatch.dataset.swatchKey);
        return;
      }
      // Миниатюра чертежа присадки (.lib-drawing-swatch, см.
      // libDrawingSwatchHtml) — только просмотр: лупа-зум по наведению (см.
      // .lib-swatch-zoom-icon), а клик открывает чертёж в полном размере в
      // новой вкладке (в превью целая страница документа не читается). Загрузки
      // файла у неё нет: у неё нет sourceUrl, а openLibImagePicker ниже писал бы
      // выбранный файл в it.image — чужое поле, предназначенное для фото
      // товара, а не для чертежа (it.drawing).
      if (swatch.classList.contains('lib-drawing-swatch')) {
        const full = swatch.dataset.swatchFull || swatch.dataset.swatchSrc;
        if (!full) return;
        // Свой просмотрщик (drawing.html): масштаб колёсиком и сдвиг
        // перетаскиванием — в обычной вкладке браузера увеличенная картинка
        // уходила за край, и сдвинуть её было нечем. Картинки не из
        // assets/drawings (если когда-нибудь появятся загруженные) — как раньше.
        const viewable = /^assets\/drawings\/[A-Za-z0-9._-]+\.(png|jpe?g|webp)$/.test(full);
        const url = viewable
          ? 'drawing.html?src=' + encodeURIComponent(full) + '&t=' + encodeURIComponent(swatch.dataset.swatchTitle || '')
          : full;
        window.open(url, '_blank', 'noopener');
        return;
      }
      // sourceUrl (data-swatch-url, см. libSwatchHtml) — открыть карточку
      // товара на сайте поставщика вместо загрузки своего файла.
      const swatchUrl = swatch.dataset.swatchUrl;
      if (swatchUrl) { window.open(swatchUrl, '_blank', 'noopener'); return; }
      openLibImagePicker(swatch.dataset.swatchGroup, swatch.dataset.swatchKey);
      return;
    }
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
    // Переключатель единицы цены у ФУРНИТУРЫ (см. libHwPriceUnitHeaderHtml) —
    // проверяется ПЕРВЫМ: у него оба класса сразу (.lib-price-unit-select
    // нужен ради общего CSS шапки), и по общему классу его нельзя отличить от
    // переключателя материалов. Состояние своё (state.libHwPriceUnit), чтобы
    // вкладки не влияли друг на друга.
    const hwPriceUnitSel = e.target.closest('.lib-hw-price-unit-select');
    if (hwPriceUnitSel) {
      // Пишем в КЛЮЧ корневой категории (data-top у самого select, см.
      // libHwPriceUnitHeaderHtml), а не в поле целиком: state.libHwPriceUnit —
      // объект { 'hw:hinge': 'шт', ... }, и присвоение строкой сбросило бы
      // выбор на всех остальных категориях сразу.
      if (!state.libHwPriceUnit || typeof state.libHwPriceUnit !== 'object') state.libHwPriceUnit = {};
      const hwTop = hwPriceUnitSel.dataset.top;
      if (hwTop) state.libHwPriceUnit[hwTop] = hwPriceUnitSel.value;
      renderLibraryPanel();
      return;
    }
    const priceUnitSel = e.target.closest('.lib-price-unit-select');
    if (priceUnitSel) {
      state.libPriceUnit = priceUnitSel.value;
      renderLibraryPanel();
      return;
    }
    // «Раздел фурнитуры» на экране подтверждения (см. hwCatHtml в
    // libLinkConfirmHtml) — показывается, только когда форма открыта БЕЗ
    // готового hwCategory (см. libLinkTopBarHtml). В отличие от остальных
    // полей формы, выбор раздела меняет НАБОР полей ниже (инженерные поля
    // конкретной категории — см. libLinkHardwareExtraFieldsHtml), точечной
    // правкой не обойтись — нужна полная перерисовка панели, не просто
    // libLinkRevalidate. Поэтому ДО перерисовки снимаем срез полей: иначе
    // уже исправленные наименование/цена вернулись бы к значениям парсера.
    const hwCatSel = e.target.closest('.lib-link-hw-cat-select');
    if (hwCatSel && state.libLinkForm) {
      libLinkCaptureFormState(hwCatSel.closest('.lib-link-form'));
      state.libLinkForm.hwCategory = hwCatSel.value;
      renderLibraryPanel();
      return;
    }
    // Запасной вариант блока «Текстура листа»: картинка листа выбрана файлом.
    const texFile = e.target.closest('.lib-tex-file');
    if (texFile && state.libLinkForm) {
      const f = texFile.files && texFile.files[0];
      if (f) {
        if (!/^image\//.test(f.type)) { window.alert('Нужна картинка (JPEG или PNG).'); return; }
        libTexSetBlob(state.libLinkForm, f, '', null, null, '');
        libTexRerender();
      }
      return;
    }
    // Набор текстур из файла (кнопка «Загрузить набор текстур»).
    const texPackInput = e.target.closest('.lib-tex-pack-input');
    if (texPackInput) { libTexPackLoad(texPackInput); return; }
    // Выбор варианта вариативного товара (см. libLinkVariantsHtml) — своя
    // ветка ДО общей: кроме перевалидации нужно подставить цену/артикул/
    // название выбранной комбинации, и всё это точечно, без перерисовки.
    const variantSel = e.target.closest('.lib-link-variant-select');
    if (variantSel && state.libLinkForm) {
      libLinkApplyVariant(panel, variantSel.closest('.lib-link-form'));
      return;
    }
    // Форма «Добавить по ссылке» (см. libLinkRevalidate) — <select>-поля
    // (единица измерения, категория, «Количество отверстий» и т.п.) не
    // всегда надёжно бросают 'input' во всех браузерах, 'change' — точно.
    // «Сайт-источник» сюда больше не относится — это не <select>, а
    // кастомный список (см. libLinkSitePickerHtml), выбор сайта целиком
    // обрабатывает клик по .lib-link-site-item в делегированном click выше.
    if (e.target.closest('.lib-link-form')) {
      // Выбор существующего раздела из выпадающего списка «Раздел каталога»
      // обнуляет «Новую подкатегорию» — иначе там могло остаться название,
      // предложенное для СОВСЕМ ДРУГОГО раздела (например, хлебные крошки
      // сайта на румынском, см. libLinkDefaultCategorySplit) и превратить
      // категорию в бессмыслицу вида «МДФ-плита › Egger › Materiale plăci…».
      if (e.target.classList.contains('lib-link-cat-parent')) {
        const box = e.target.closest('.lib-link-form');
        const newSegInput = box && box.querySelector('.lib-link-cat-new');
        if (newSegInput) newSegInput.value = '';
      }
      libLinkMarkFieldTouched(e.target);
      libLinkRevalidate(panel);
      return;
    }
  });
  // Реактивная разблокировка «Проверить»/«Сохранить» формы «Добавить по
  // ссылке» по мере ввода (см. libLinkRevalidate) — текстовые/числовые поля
  // бросают 'input' на каждое нажатие клавиши, без полной перерисовки панели
  // (иначе терялся бы фокус/курсор посреди набора текста).
  panel.addEventListener('input', (e) => {
    if (e.target.closest('.lib-link-form')) {
      libLinkMarkFieldTouched(e.target);
      libLinkRevalidate(panel);
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
// вызова (arr[0].code). Пустой каталог столешниц — вырожденный случай (последнюю
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
    // depth — ручное переопределение целевой глубины столешницы ЭТОГО модуля
    // (и, через синхронизацию по связке в bindCountertopEvents, всей стыкующейся
    // связки тумб). БЕЗ дефолта: undefined означает «взять из материала
    // автоматически» (engine.js: resolveCountertopChainDepths).
    depth: src.depth,
  };
}

// Материал столешницы «свой материал» может ссылаться на код из ЛЮБОГО из
// трёх списков каталога (DECORS, FACADE_MATERIALS, BACK_MATERIALS) — та же
// тройка, что уже ищет specification.js для листовых материалов (см. там
// `known`), и то же самое ищет countertopMat() в engine.js. Без копирования
// в отдельный массив (см. libPickMaterial) —
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
  // Разовая обратная связь после «Изменить» материал столешницы, когда его
  // применили не только к активной тумбе, но и ко всей стыкующейся цепочке
  // (см. libPickMaterial, state.countertopChainNotice). Читаем и сразу
  // обнуляем — следующий рендер панели (любое другое изменение) уже не
  // покажет её повторно, как и обычные статусы-подтверждения в приложении
  // (см. setEmailVerifyStatus/setReviewStatus — та же идея «показать один раз»,
  // только без отдельного DOM-элемента, тут панель целиком перерисовывается).
  const chainNotice = state.countertopChainNotice;
  state.countertopChainNotice = null;
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
        ${chainNotice ? `<div class="sketch-status ok">${esc(chainNotice)}</div>` : ''}
      </div>
      <div class="field">
        <label>Глубина столешницы, мм</label>
        <input id="ctopWorktopDepth" type="number" step="1" placeholder="авто"
          value="${s.depth !== undefined && s.depth !== null ? s.depth : ''}">
        <div class="hint">Одно значение на всю стыкующуюся связку тумб — по нему видимая боковина крайнего
          модуля дотягивается до стены. Пусто — берётся глубина выбранного материала столешницы (если это
          готовая позиция каталога). Задайте вручную, если материал «свой» (без фиксированной глубины) —
          например, столешница острова 900/1200 мм.</div>
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
  // нет (убрано по просьбе пользователя 2026-09-06; удаление материала —
  // только в Библиотеке, libDeleteSelectedRow) —
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

  // «Глубина столешницы» — ручное переопределение целевой глубины ЭТОГО
  // модуля (engine.js: resolveCountertopChainDepths), пустое поле = «взять
  // из материала автоматически». Применяется, как и смена материала
  // столешницы выше (role: 'countertopDecor'), ко всей физически
  // стыкующейся цепочке тумб — не только к активной — чтобы связка держала
  // одно общее число, а не «первое попавшееся» (engine иначе просто возьмёт
  // значение первого члена цепочки).
  const worktopDepthEl = document.getElementById('ctopWorktopDepth');
  if (worktopDepthEl) worktopDepthEl.addEventListener('change', (e) => {
    const raw = e.target.value.trim();
    const value = raw === '' ? undefined : (Number(e.target.value) || 0);
    const engineApi = window.Modul3D.engine;
    let chainNames = [activeMod.name];
    if (currentModel && engineApi && typeof engineApi.getCountertopChainModules === 'function') {
      try {
        const chain = engineApi.getCountertopChainModules(currentModel, activeMod.name);
        if (Array.isArray(chain) && chain.length) chainNames = chain;
      } catch (err) {
        // Геометрия могла ещё не пересчитаться — тихо откатываемся на одну тумбу.
      }
    }
    const chainSet = new Set(chainNames);
    state.modules.forEach((m) => {
      if (chainSet.has(m.name) && m.countertop) {
        if (value === undefined) delete m.countertop.depth;
        else m.countertop.depth = value;
      }
    });
    recompute();
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
        <select id="m-leftSide">${sideOptions(mod.leftSide, moduleIsWallHung(mod))}</select>
      </div>
      <div class="field">
        <label>Правая боковина</label>
        <select id="m-rightSide">${sideOptions(mod.rightSide, moduleIsWallHung(mod))}</select>
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
    ${mountTopBlock(mod)}
    ${moduleIsWallHung(mod) ? hangerSystemBlock() : ''}

    <div id="sectionsList"></div>`;
}

// Отметка ВЕРХА навесного модуля от пола (решение пользователя 2026-09-26):
// по умолчанию engine.WALL_MOUNT_TOP_DEFAULT (2400), своё число — mod.mountTop.
// Низ модуля = верх − высота модуля (считает engine.js, buildModel).
function wallMountTopDefault() {
  const v = Number(window.Modul3D.engine.WALL_MOUNT_TOP_DEFAULT);
  return Number.isFinite(v) && v > 0 ? v : '';
}
function mountTopBlock(mod) {
  if (!moduleIsWallHung(mod)) return '';
  const top = Number(mod.mountTop) > 0 ? Number(mod.mountTop) : wallMountTopDefault();
  return `
    <div class="field-row">
      <div class="field">
        <label>Верх модуля от пола, мм</label>
        <input id="m-mountTop" type="number" step="10" min="0" value="${top}">
      </div>
    </div>
    <div class="hint">Навесной модуль: низ = верх − высота модуля.</div>`;
}

// Дефолты паза под заднюю стенку берём из движка (engine.js,
// BACK_GROOVE_DEFAULTS — те же числа, что в resolveBackMount), своих чисел
// здесь нет. Читаем лениво, при отрисовке: engine.js грузится раньше app.js.
function backGrooveDefaults() {
  // Без экспорта (рассинхрон версий файлов) — пустые поля вместо падения
  // всей панели модуля; своих чисел не подставляем.
  return window.Modul3D.engine.BACK_GROOVE_DEFAULTS || { offset: '', depth: '', entry: '' };
}

// Текущие настройки паза модуля с подставленными дефолтами (для формы).
function backGrooveOf(mod) {
  const def = backGrooveDefaults();
  const g = mod.backGroove || {};
  const gp = g.parts || {};
  const val = (v, d) => (v === undefined || v === null || v === '' ? d : v);
  return {
    offset: val(g.offset, def.offset),
    depth: val(g.depth, def.depth),
    entry: val(g.entry, def.entry),
    parts: { left: gp.left !== false, right: gp.right !== false,
      top: gp.top !== false, bottom: gp.bottom !== false },
  };
}

// Навесной модуль — тот же признак, что isWallHung() в engine.js: явное
// поле wallHung главнее, без него — кухонный на «цоколе» нулевой высоты.
// Здесь только для UI (текст подсказки, поле «Верх модуля от пола»), в
// расчёт не идёт — движок решает сам по тем же полям.
function moduleIsWallHung(mod) {
  if (mod.wallHung === true || mod.wallHung === false) return mod.wallHung;
  return mod.family === 'kitchen' && mod.baseType === 'plinth' && !(Number(mod.plinthHeight) > 0);
}

// Почему паз в крыше недоступен (движок его всё равно отбросит, см.
// resolveBackMount: topIsPanel). null — крыша цельная, паз возможен.
// «Крыши нет» (под толстой столешницей) не вычисляем сами, а смотрим по
// последней модели: у модуля нет ни одной детали вида 'top'.
function backGrooveTopBlockedReason(mod) {
  if (moduleIsWallHung(mod)) return 'навесной модуль';
  if (mod.topType === 'rails' || mod.topType === 'railsEdge') return 'верх — планки';
  const rows = (currentModel && currentModel.partsRaw) || [];
  const own = rows.filter((r) => r.module === mod.name);
  if (own.length && !own.some((r) => r.kind === 'top')) return 'крыши нет';
  return null;
}

// Есть ли хоть одна деталь с пазом (с учётом недоступной крыши) — если нет,
// движок сделает стенку накладной.
function backGrooveHasAnyPart(parts, topBlocked) {
  return !!(parts.left || parts.right || (parts.top && !topBlocked) || parts.bottom);
}

// Режим задней стенки, который выберет движок сам, пока пользователь не
// переопределил его вручную (mod.backMount не 'overlay'/'groove') — решение
// пользователя 2026-09-28: в select «Задняя стенка» больше нет отдельного
// варианта «Авто», вместо него всегда выбран РЕЗУЛЬТАТ этой автоматики (как
// и раньше), только явно виден как «Накладная»/«В паз», а не спрятан за
// третьим пунктом. Считаем ЧЕРЕЗ движок (engine.resolveBackMount), а не
// повторяем его условия здесь — тут легко разойтись с реальной логикой (сама
// resolveBackMount учитывает больше нюансов, например обе боковины «на дно»
// у обычной мебели, чем прежний текстовый хинт ниже).
function autoBackMountMode(mod) {
  const engine = window.Modul3D.engine;
  if (!engine || typeof engine.resolveBackMount !== 'function') return 'overlay';
  try {
    const sides = engine.normalizeSides(Object.assign({}, mod, { wallHung: moduleIsWallHung(mod) }));
    return engine.resolveBackMount(Object.assign({ backMount: undefined }, mod), sides, state.backThickness).mode;
  } catch (err) {
    return 'overlay';
  }
}

// Блок «Задняя стенка» (режим крепления m.backMount: 'overlay' | 'groove' —
// пусто/что угодно ещё читается как «ещё не выбрано вручную», см.
// autoBackMountMode выше — и, при «В паз», параметры паза m.backGroove) — с
// 2026-09-28 на экране «Материалы», сразу под плашкой материала задней
// стенки (перенесён с «Конструктива модуля», где был раньше — обработчики
// полей ниже в bindPanelEvents() привязываются по id независимо от текущего
// panelView, поэтому переезд экрана их не затрагивает). У модуля без задней
// стенки (noBack — мойка) блок не показывается.
function backMountBlock(mod) {
  if (mod.noBack) return '';
  // mode — что показывает сам select (авторезолв, пока пользователь не
  // выбрал вручную). manualGroove — показывать ли подробности паза (отступ/
  // глубина/чек-боксы деталей): ТОЛЬКО когда пользователь САМ явно выбрал «В
  // паз» (mod.backMount === 'groove'), а не когда до этого просто дошла
  // автоматика — иначе чек-боксы (backGrooveOf по умолчанию — все 4 «true»,
  // см. её комментарий) показали бы не те детали, что реально уйдут в паз по
  // авто-правилу (оно смотрит на боковины/высоту/навес, а не «все подряд»),
  // вводя в заблуждение ещё до того как пользователь вообще что-то выбрал.
  const mode = (mod.backMount === 'overlay' || mod.backMount === 'groove') ? mod.backMount : autoBackMountMode(mod);
  const manualGroove = mod.backMount === 'groove';
  const g = backGrooveOf(mod);
  const topBlocked = backGrooveTopBlockedReason(mod);
  const chk = (key, label, blocked) => `<label class="checkbox-inline"><input type="checkbox" data-back-groove-part="${key}" ${g.parts[key] && !blocked ? 'checked' : ''} ${blocked ? 'disabled' : ''}> ${label}${blocked ? ` <span class="dim">(${blocked})</span>` : ''}</label>`;
  return `
    <div class="field-row">
      <div class="field">
        <label>Задняя стенка</label>
        <select id="m-backMount">
          <option value="overlay" ${mode === 'overlay' ? 'selected' : ''}>Накладная</option>
          <option value="groove" ${mode === 'groove' ? 'selected' : ''}>В паз</option>
        </select>
      </div>
    </div>
    ${manualGroove ? `
    <div class="field-row3 back-groove-row">
      <div class="field"><label>Отступ от края, мм</label><input id="m-grooveOffset" type="number" min="0" step="1" value="${g.offset}"></div>
      <div class="field"><label>Глубина паза, мм</label><input id="m-grooveDepth" type="number" min="1" step="1" value="${g.depth}"></div>
      <div class="field"><label>Заход стенки, мм</label><input id="m-grooveEntry" type="number" min="0" step="1" value="${g.entry}"></div>
    </div>
    <div class="field">
      <label>Паз в:</label>
      <div class="field-row">
        ${chk('left', 'левая боковина')}
        ${chk('right', 'правая боковина')}
        ${chk('top', 'крыша', topBlocked)}
        ${chk('bottom', 'дно')}
      </div>
      <div class="hint back-groove-warn" id="backGrooveNoneWarn" ${backGrooveHasAnyPart(g.parts, topBlocked) ? 'hidden' : ''}>Паз не выбран ни в одной детали — стенка будет накладной.</div>
    </div>` : ''}`;
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

  // Клик в 3D приносит ключ именно кликнутой детали (engine.js grainKey — та же
  // схема, что и ключ кандидата): им находится ровно она, даже когда деталей
  // одного вида много (полки, ящики). Не нашёлся (деталь пропала после
  // пересчёта, клик по отсеку без ключа) — прежняя логика ниже.
  if (sp.partKey) {
    const byKey = candidates.findIndex((c) => (c.part.grainKey || c.key) === sp.partKey);
    if (byKey >= 0) return { candidates, chosenIdx: byKey, chosen: candidates[byKey] };
  }

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

// Селектор «Какая деталь» экрана «Деталь» (общий для partBlock и
// partKindPlaceholderBlock). Клик в 3D теперь приносит partKey и выбирает
// деталь сам, но список нужен, когда деталей вида несколько, а нужна другая.
// У одноимённых деталей (полки разных секций) к названию добавляется секция и
// номер — иначе пункты списка не отличить.
function partPickerBlock(candidates, chosenIdx, kindTitle) {
  if (candidates.length < 2) return '';
  const label = (c, i) => {
    const nm = c.part.name || (kindTitle + ' ' + (i + 1));
    const same = candidates.filter((x) => (x.part.name || '') === (c.part.name || ''));
    if (same.length < 2) return nm;
    return `${nm} — ${c.part.section ? c.part.section + ', ' : ''}№${same.indexOf(c) + 1}`;
  };
  return `
    <div class="field">
      <label>Какая деталь</label>
      <select id="partSubIndex">
        ${candidates.map((c, i) => `<option value="${i}" ${i === chosenIdx ? 'selected' : ''}>${esc(label(c, i))}</option>`).join('')}
      </select>
    </div>`;
}

// Поле «Направление текстуры» ОДНОЙ детали (экран «Деталь», любой вид). Пишет
// mod.grainOverrides[grainKey] — не partOverrides: тот помечает деталь
// «изменённой вручную» и ограничен OVERRIDABLE_PART_KINDS. Ключ и текущее
// состояние берутся из ПОСЧИТАННОЙ детали (engine.js applyGrainDirection);
// обработчик — on('partGrain') в bindPanelEvents. Деталям без правила
// (задняя стенка, опоры — grainKey нет) поле не показывается.
function partGrainField(part) {
  if (!part || part.grainKey === undefined) return '';
  const hasPattern = !!part.grainAxis;
  const cur = part.grainOverride || '';
  const groupText = part.grainGroupMode === 'across' ? 'Поперёк' : 'Авто';
  const opt = (v, text) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${text}</option>`;
  return `
    <div class="field">
      <label>Направление текстуры</label>
      <select id="partGrain" data-key="${esc(part.grainKey)}" ${hasPattern ? '' : 'disabled'}>
        ${opt('', 'Как у группы: ' + groupText)}
        ${opt('along', 'Вдоль длины')}
        ${opt('across', 'Поперёк')}
      </select>
      <div class="hint">${hasPattern
        ? 'Текстура идёт вдоль первой цифры (Длина) в деталировке; «Поперёк» меняет цифры местами.'
        : 'У этого декора нет рисунка — направление текстуры не применяется.'}</div>
    </div>`;
}

// «Деталь не найдена» — общий ответ partBlock/partKindPlaceholderBlock.
function partNotFoundBlock(kindTitle) {
  return `
      ${backLinkBlock()}
      <h3>${esc(kindTitle)}</h3>
      <div class="hint">Деталь не найдена в текущей модели — возможно, она объединена
      с соседним модулем (например, цоколь идёт сквозной планкой на весь ряд) или
      параметры модуля изменились. Закройте фокус и выберите деталь заново.</div>`;
}

// Экран «Деталь»: открывается пунктом «Редактировать» контекстного меню
// фокуса (см. showFocusMenu/openPartEditor ниже), которое, в свою очередь,
// открывается кликом по детали внутри изолированного в 3D модуля
// (viewer.onSelectPart). Полноценные поля (толщина/материал/доп. отверстия,
// см. OVERRIDABLE_PART_KINDS выше) — для боковины, дна, крыши, задней стенки
// и цоколя; для остальных видов деталей — partKindPlaceholderBlock (только
// направление текстуры, см. renderParamsPanel). Для боковины показывается
// ещё и «Конструктив» — тот же самый инпут, что и в общих параметрах модуля
// (id m-leftSide/m-rightSide): существующий обработчик в bindPanelEvents()
// слушает эти id и продолжает работать без изменений, где бы они ни были
// отрисованы.
function partBlock(mod) {
  const sp = state.selectedPart;
  const kind = sp.kind;
  const kindTitle = PART_KIND_TITLES[kind] || 'Деталь';
  const { candidates, chosenIdx, chosen } = resolveSelectedPart(mod);

  if (!chosen) return partNotFoundBlock(kindTitle);

  const part = chosen.part;
  const ov = (mod.partOverrides && mod.partOverrides[chosen.key]) || {};
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
      <select id="${selectId}">${sideOptions(cur, moduleIsWallHung(mod))}</select>
    </div>
    ${visible && !ov.materialOverride ? `
    <div class="hint">Эта боковина видимая — режется из материала «Видимая боковина» проекта.
    Материал ТОЛЬКО этой боковины меняется полем «Материал этой детали» ниже.</div>` : ''}`;
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

  // Больше одной детали одного вида в модуле — крыша из двух планок, обе
  // боковины. Кликнутую деталь определяет partKey (см. resolveSelectedPart),
  // но выбрать другую можно и селектором.
  const subIndexBlock = partPickerBlock(candidates, chosenIdx, kindTitle);

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
        <label>Материал этой детали</label>
        ${matPickPlashkaHtml('part', 'partMaterial', part.material)}
        <div class="hint">Меняется только эта деталь. Толщина подставляется из каталога —
        её можно поправить вручную.${kind === 'side' ? ' Наружный размер модуля не меняется: боковина растёт внутрь, внутренние детали подгоняются.' : ''}</div>
        ${(ov.materialOverride || ov.thicknessOverride) ? `
        <button class="link-btn" id="partMaterialReset" type="button">Сбросить к материалу модуля</button>` : ''}
        ${kind === 'side' && part.facadeType === 'sidePanel' ? `
        <button class="link-btn dim" id="partToFacadeDecor" type="button">Изменить материал всех видимых боковин проекта →</button>` : ''}
      </div>
      ${partGrainField(part)}

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
    (толщина, материал и отверстия — у боковины, дна, крыши, задней стенки и цоколя;
    направление текстуры — у любой детали с рисунком).</div>`;
}

// Экран «Деталь» для видов деталей, у которых ещё нет полноценного экрана
// (сейчас он есть у боковины/дна/крыши/задней стенки/цоколя — см.
// OVERRIDABLE_PART_KINDS и partBlock выше). Открывается через «Редактировать»
// в контекстном меню фокуса (openPartEditor), когда выбранная деталь — из
// остальных видов (полка, фасад, стойка, детали ящика и т.п.). Пока здесь одно
// рабочее поле — «Направление текстуры» (не зависит от OVERRIDABLE_PART_KINDS,
// пишет в mod.grainOverrides). Когда появится общий редактор геометрии детали
// — эта функция и есть точка, которую нужно будет заменить/расширить,
// вызывающий код (openPartEditor) менять не придётся.
function partKindPlaceholderBlock(mod) {
  const kind = state.selectedPart.kind;
  const kindTitle = PART_KIND_TITLES[kind] || kind;
  const { candidates, chosenIdx, chosen } = resolveSelectedPart(mod);
  // Деталь в модели не нашлась (у вида нет строк в partsRaw) — прежняя заглушка.
  if (!chosen) {
    return `
    ${backLinkBlock()}
    <h3>Деталь</h3>
    <div class="hint">Редактор для этого вида детали (${esc(kindTitle)}) появится отдельным этапом.</div>`;
  }
  return `
    ${backLinkBlock()}
    <h3>${esc(chosen.part.name || kindTitle)}</h3>
    ${partPickerBlock(candidates, chosenIdx, kindTitle)}
    ${partGrainField(chosen.part)}
    <div class="hint">Остальные поля (толщина, материал, присадка) для этого вида
    детали появятся отдельным этапом.</div>`;
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
          <label>Открывание фасадов</label>
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
function openPartEditor(module, kind, side, sectionIndex, zoneIndex, asPart, partKey) {
  state.selectedPart = {
    module, kind, side, subIndex: 0,
    // engine.js grainKey кликнутой детали (viewer.onSelectPart) — по нему
    // resolveSelectedPart находит ровно её. null — открыто без клика по детали.
    partKey: partKey || null,
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
  // Лист ручной разметки редактора — привязан к самой детали (drawings.js:
  // buildPartEditorView → 'editor:<uid>|<ключ>'); запоминаем, чтобы снять его
  // с учёта при закрытии окна.
  const newSheet = (part.moduleUid && part.anchorKey) ? `editor:${part.moduleUid}|${part.anchorKey}` : null;
  // Другая деталь — прежний лист редактора снимаем с учёта (иначе он висел
  // бы в реестре разметки с устаревшими контекстами видов).
  if (state.partEditorSheet && state.partEditorSheet !== newSheet && markupApi && markupApi.dropSheet) {
    markupApi.dropSheet(state.partEditorSheet);
  }
  state.partEditorSheet = newSheet;
  if (typeof drawings.buildPartEditorView === 'function') {
    try {
      // model — для ручной разметки (markup.js считает по ней «живые» размеры)
      canvas.innerHTML = drawings.buildPartEditorView(part, { model: currentModel });
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
  syncMarkupUI();
}

// Перерисовать открытый редактор (та же деталь по state.selectedPart) —
// после правки ручной разметки: рамка листа (svgFit) считается при сборке,
// и новый размер за её краем обрезался бы. Вырезы/присадка не меняются.
function refreshPartEditorOverlay() {
  if (!state.partEditorOpen) return;
  const mod = state.modules.find((m) => m.name === (state.selectedPart || {}).module);
  const resolved = resolveSelectedPart(mod);
  if (resolved.chosen) renderPartEditorOverlay(resolved.chosen.part);
}

// Закрывает оверлей и возвращает в режим фокуса на модуле (экран «Деталь») —
// НЕ выходит из изоляции модуля целиком, только закрывает этот полноэкранный
// режим (см. бриф про фокус-режим: выход из самого фокуса — отдельный пункт
// контекстного меню, не красный крестик здесь).
function closePartVisualEditor() {
  state.partEditorOpen = false;
  // Режим разметки в редакторе при закрытии окна выключается, лист снимается
  // с учёта (данные размеров остаются — откроют редактор, они на месте).
  // Выключаем только «режим редактора»: если под окном видна вкладка
  // «Чертежи», разметка на ней остаётся включённой.
  if (markupApi) {
    // Выключаем только режим, включённый В РЕДАКТОРЕ: включённый с вкладки
    // «Чертежи» или в 3D живёт по своему контексту (syncMarkupUI).
    if (markupOrigin === 'editor') { markupApi.setActive(false); markupOrigin = null; }
    if (state.partEditorSheet && markupApi.dropSheet) markupApi.dropSheet(state.partEditorSheet);
  }
  state.partEditorSheet = null;
  const overlay = document.getElementById('partEditorOverlay');
  if (overlay) {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  }
  syncMarkupUI();
}

// Оверлей статичный (разметка index.html), не пересоздаётся при каждом
// renderParamsPanel() — как и шапка (см. initHeaderControls), обработчик
// закрытия вешается один раз здесь.
function initPartEditorOverlay() {
  const closeBtn = document.getElementById('partEditorClose');
  if (closeBtn) closeBtn.addEventListener('click', closePartVisualEditor);
  // Переключатель ручной разметки в самом окне. Своих инструментов у
  // редактора пока нет (Этап 1 — статичный вид), так что перехватывать нечего;
  // будущие инструменты вырезов обязаны проверять markupApi.isActive() и
  // молчать, пока режим включён (как это делает панорама чертежей ui-shell.js).
  const mkBtn = document.getElementById('partEditorMarkupToggle');
  if (mkBtn) {
    if (!markupApi) mkBtn.style.display = 'none';
    else mkBtn.addEventListener('click', () => {
      const on = !markupApi.isActive();
      markupApi.setActive(on);
      markupOrigin = on ? 'editor' : null;
      syncMarkupUI();
    });
  }
}

// Экран «Материалы»: общие на весь проект декор/толщины/фурнитура —
// не привязаны к конкретному модулю, плюс поле «Фасад» активной секции.
// Решение пользователя 2026-09-26: во всех полях выбора материала — не
// выпадающий список, а плашка с выбранным материалом (название + образец);
// клик открывает Библиотеку в режиме подбора (state.libPickTarget) сразу в
// нужной категории. Ссылок «+ Добавить материал»/«Удалить материал» под
// полями больше нет — добавление/удаление только в самой Библиотеке.
// data-mat-pick — роль подбора ('decor'/'facadeDecor'/'back'/'facade'),
// по нему же libPickMaterial прокручивает панель обратно к полю.
function matPickPlashkaHtml(role, id, code, fallbackName, extraAttrs) {
  const it = code ? (findAnyMaterialByCode(code) || ((aluCat().GLASS || {}).code === code ? aluCat().GLASS : null)) : null;
  const name = (it && it.name) || fallbackName || code || 'Не выбрано';
  const img = it && typeof it.image === 'string' && it.image ? it.image : '';
  const isGlass = !!(it && ((Array.isArray(it.categoryPath) && it.categoryPath[0] === 'Стекло') || /^GLASS/i.test(it.code || '')));
  const swCls = img ? '' : (isGlass ? ' alu-fill-sw-glass' : ' alu-fill-sw-sheet');
  const swStyle = img ? ` style="background-image:url('${esc(img)}')"` : '';
  return `<button type="button" class="alu-fill-pick mat-pick"${id ? ` id="${esc(id)}"` : ''}${role ? ` data-mat-pick="${esc(role)}"` : ''} data-code="${esc(code || '')}"${extraAttrs || ''}
          title="Выбрать в Библиотеке" aria-label="${esc(`${name}. Выбрать в Библиотеке`)}">
          <span class="alu-fill-sw${swCls}"${swStyle}></span>
          <span class="alu-fill-txt"><span class="alu-fill-name">${esc(name)}</span><span class="alu-fill-sub">Выбрать в Библиотеке →</span></span>
        </button>`;
}

function materialsBlock(mod) {
  return `
    <h3>Материалы (общие на проект)</h3>
    <div class="field">
      <label>Материал корпуса</label>
      ${matPickPlashkaHtml('decor', 'p-decor', state.decorCode)}
    </div>
    <div class="field">
      <label>Видимая боковина</label>
      ${matPickPlashkaHtml('facadeDecor', 'p-facadeDecor', state.facadeDecorCode)}
    </div>
    <div class="field">
      <label>Материал фасада (ЛДСП, по умолчанию)</label>
      ${matPickPlashkaHtml('facadeMat', 'p-facadeMat', state.facadeMatCode)}
    </div>
    <div class="field">
      <label>Задняя стенка</label>
      ${matPickPlashkaHtml('back', 'p-back', state.backCode)}
    </div>
    ${backMountBlock(mod)}`;
}

// ---------------------------------------------------------------------------
// Поле «Фасад» экрана «Материалы» — вид и материал фасада АКТИВНОЙ секции
// активного модуля или её отсека (дверной зоны sec.doorZones[zi], действует
// только при doorZoneCount > 1 — как в engine.zoneFacadeSettings). Какой
// отсек выбран переключателем — state.matFacadeZone (null — секция), чисто
// UI-состояние, в проект не пишется. Допустимые материалы вида — только
// engine.facadeMaterialOptions (пусто — у вида выбора материала нет),
// итоговый материал — engine.facadeMaterialOf (как построит ядро).
// ---------------------------------------------------------------------------
function matFacadeProj() {
  return { decor: state.decorCode, facadeMat: state.facadeMatCode, facadeThickness: state.facadeThickness, t: state.bodyThickness };
}
// Число отсеков секции ровно так, как их использует ядро (engine.js:
// раскладка зон в buildModuleParts и zoneFacadeSettings) — отсеки действуют
// только при doorZoneCount > 1 И непустом массиве sec.doorZones; иначе у
// секции один фасад на весь проём, и «Отсек N» не показываем.
function secZoneCount(sec) {
  const n = Number(sec && sec.doorZoneCount) || 1;
  const hasZones = !!sec && Array.isArray(sec.doorZones) && sec.doorZones.length > 0;
  return n > 1 && hasZones ? n : 1;
}
// Отсек секции для записи переопределений фасада — тот же объект-умолчание,
// что заводит bindZoneFieldEvents (ensureZone), если отсек ещё пуст (ядро
// так же подставляет эти значения на месте пустого элемента). Отсеков, которых
// нет в геометрии (см. secZoneCount), не создаёт — возвращает null.
function ensureDoorZone(sec, zi) {
  if (!sec || !(secZoneCount(sec) > 1 && zi >= 0 && zi < secZoneCount(sec))) return null;
  if (!sec.doorZones[zi]) {
    sec.doorZones[zi] = { facade: 'doorLeft', height: 0, appliance: 'none', applianceW: 0, applianceD: 0, note: '' };
  }
  return sec.doorZones[zi];
}
// Цель подбора фасада { moduleIdx, moduleName, secIdx, zoneIdx } → { mod, sec,
// zi, eff, ftId } или null, если цель протухла (модуль удалён/сдвинулся,
// секция пропала, отсеков стало меньше) — «Выбрать» такой цели ничего не
// пишет.
function facadeTargetInfo(t) {
  if (!t) return null;
  const mod = state.modules[t.moduleIdx];
  if (!mod || (t.moduleName != null && mod.name !== t.moduleName)) return null;
  const sec = mod.sections && mod.sections[t.secIdx];
  if (!sec) return null;
  const zi = t.zoneIdx == null ? null : Number(t.zoneIdx);
  if (zi != null && !(secZoneCount(sec) > 1 && zi >= 0 && zi < secZoneCount(sec))) return null;
  const engine = window.Modul3D.engine;
  const eff = zi != null && engine && typeof engine.zoneFacadeSettings === 'function'
    ? engine.zoneFacadeSettings(sec, zi) : sec;
  return { mod, sec, zi, eff, ftId: effFacadeTypeId(eff) };
}
// Вид фасада так же, как его определяет ядро (engine.js facadeTypeOf):
// старый флажок sec.glass из ранних сохранений = «стекло 4 мм».
function effFacadeTypeId(s) {
  return (s && (s.facadeType || (s.glass ? 'glass4' : ''))) || 'ldsp';
}
function facadeTargetLabel(info) {
  if (!info) return '';
  return `${info.mod.name} · Секция ${info.sec ? info.mod.sections.indexOf(info.sec) + 1 : ''}${info.zi != null ? ` · Отсек ${info.zi + 1}` : ''}`;
}
function facadeMaterialOptionsOf(ftId) {
  const engine = window.Modul3D.engine;
  return engine && typeof engine.facadeMaterialOptions === 'function' ? engine.facadeMaterialOptions(ftId) : [];
}
// Цель фасада на экране «Материалы»: активная секция активного модуля и
// (если выбран переключателем и ещё существует) её отсек.
// Ключ «чей» выбор отсека: активный модуль (индекс + имя) и его активная
// секция. Отличается от сохранённого — отсек сбрасывается (см. matFacadeTarget).
function matFacadeOwnerKey() {
  const mod = state.modules[state.activeModule];
  if (!mod) return '';
  const n = (mod.sections || []).length;
  const secIdx = Math.max(0, Math.min(Number(mod.activeSection) || 0, n - 1));
  return `${state.activeModule}|${mod.name}|${secIdx}`;
}
function setMatFacadeZone(zi) {
  state.matFacadeZone = zi == null ? null : zi;
  state.matFacadeZoneFor = matFacadeOwnerKey();
}
function matFacadeTarget() {
  const mod = state.modules[state.activeModule];
  if (!mod || !mod.sections || !mod.sections.length) return null;
  const secIdx = Math.max(0, Math.min(Number(mod.activeSection) || 0, mod.sections.length - 1));
  const sec = mod.sections[secIdx];
  let zi = state.matFacadeZoneFor === matFacadeOwnerKey() ? state.matFacadeZone : null;
  if (zi != null && !(secZoneCount(sec) > 1 && zi >= 0 && zi < secZoneCount(sec))) zi = null;
  setMatFacadeZone(zi);
  return { moduleIdx: state.activeModule, moduleName: mod.name, secIdx, zoneIdx: zi };
}

// Плашка-итог алюминиевого фасада «LXD-1204 открытый · Алюминий · Стекло
// сатин бронз 4 мм» — клик открывает конструктор фасада в Библиотеке (см.
// openAluConstructor). eff — эффективные настройки секции/отсека.
function aluSummaryText(eff) {
  const cat = aluCat();
  const st = aluSecSettings(Object.assign({}, eff, { facadeType: 'alu' }));
  const prof = st.prof;
  const color = (cat.ALU_PROFILE_COLORS || {})[st.color];
  const engine = window.Modul3D.engine;
  let a = null;
  if (engine && typeof engine.aluFacadeOf === 'function') {
    try { a = engine.aluFacadeOf(Object.assign({}, eff, { facadeType: 'alu' })); } catch (err) { a = null; }
  }
  const fillItem = st.fill ? (findAnyMaterialByCode(st.fill) || ((cat.GLASS || {}).code === st.fill ? cat.GLASS : null)) : null;
  const fillName = (a && a.fillName) || (fillItem && fillItem.name) || st.fill || '';
  const profTxt = prof ? [prof.article || prof.code, ALU_KIND_LABEL[prof.kind] || ''].filter(Boolean).join(' ') : 'Профиль не выбран';
  return { text: [profTxt, color ? color.name : '', fillName].filter(Boolean).join(' · '), hex: color && color.hex, st };
}
function aluSummaryPlashkaHtml(eff, attrs) {
  const s = aluSummaryText(eff);
  const hex = s.hex && /^#[0-9a-f]{3,8}$/i.test(s.hex) ? s.hex : '';
  return `<button type="button" class="alu-fill-pick alu-summary"${attrs}
          title="Настроить алюминиевый фасад в Библиотеке" aria-label="${esc(`Алюминиевый фасад: ${s.text}. Настроить в Библиотеке`)}">
          <span class="alu-fill-sw alu-fill-sw-sheet"${hex ? ` style="background:${esc(hex)}"` : ''}></span>
          <span class="alu-fill-txt"><span class="alu-fill-name">${esc(s.text)}</span><span class="alu-fill-sub">Настроить в Библиотеке →</span></span>
        </button>`;
}

function matFacadeFieldHtml() {
  const t = matFacadeTarget();
  const info = facadeTargetInfo(t);
  if (!info) return '';
  const secNo = t.secIdx + 1;
  const zc = secZoneCount(info.sec);
  const targetsHtml = zc > 1 ? `
      <div class="mat-facade-targets" role="group" aria-label="Для чего выбирается фасад">
        <button type="button" class="mat-facade-target${info.zi == null ? ' active' : ''}" data-mat-facade-target="sec">Секция ${secNo}</button>
        ${Array.from({ length: zc }, (_, k) => `<button type="button" class="mat-facade-target${info.zi === k ? ' active' : ''}" data-mat-facade-target="${k}">Отсек ${k + 1}</button>`).join('')}
      </div>` : '';
  const secFt = effFacadeTypeId(info.sec);
  const secFtName = (FACADE_TYPES[secFt] || FACADE_TYPES.ldsp).name;
  let typeHtml;
  if (info.zi != null) {
    const zone = (info.sec.doorZones || [])[info.zi] || {};
    const own = zone.facadeType && FACADE_TYPES[zone.facadeType] ? zone.facadeType : '';
    typeHtml = `
      <label class="mt6" for="p-zoneFacadeType">Вид фасада отсека</label>
      <select id="p-zoneFacadeType">
        <option value="" ${own ? '' : 'selected'}>как у секции (${esc(secFtName)})</option>
        ${FACADE_TYPE_ORDER.map((id) => `<option value="${id}" ${own === id ? 'selected' : ''}>${esc(FACADE_TYPES[id].name)}</option>`).join('')}
      </select>`;
  } else {
    typeHtml = `
      <label class="mt6" for="p-secFacadeType">Вид фасада</label>
      <select id="p-secFacadeType">
        ${FACADE_TYPE_ORDER.map((id) => `<option value="${id}" ${secFt === id ? 'selected' : ''}>${esc(FACADE_TYPES[id].name)}</option>`).join('')}
      </select>`;
  }
  let matHtml;
  if (info.ftId === 'alu') {
    matHtml = `<label class="mt6">Алюминиевый фасад</label>${aluSummaryPlashkaHtml(info.eff, ' data-mat-pick="facade"')}`;
  } else if (!facadeMaterialOptionsOf(info.ftId).length) {
    matHtml = '<div class="hint">Материал для этого вида фасада — доработаем позже.</div>';
  } else {
    const engine = window.Modul3D.engine;
    let fm = null;
    try { fm = engine.facadeMaterialOf(info.eff, matFacadeProj()); } catch (err) { fm = null; }
    matHtml = `<label class="mt6">Материал фасада</label>${matPickPlashkaHtml('facade', '', fm && fm.code, fm && fm.name)}
      ${fm && fm.thickness ? `<div class="hint">Толщина фасада ${esc(fm.thickness)} мм</div>` : ''}`;
  }
  return `
    <h3>Фасад · ${esc(info.mod.name)}, секция ${secNo}</h3>
    <div class="field" id="matFacadeField">
      ${targetsHtml}
      ${typeHtml}
      ${matHtml}
      <button type="button" class="btn mat-facade-all" id="p-facadeApplyAll"
              title="Поставить этот вид и материал фасада во все секции и отсеки всех модулей">Заменить фасады на весь проект</button>
    </div>`;
}

// Клик по плашке «Фасад»: alu — конструктор в Библиотеке, прочие виды с
// выбором материала — нужная категория Библиотеки в режиме подбора (роль
// 'facadeMaterial'), где «Выбрать» есть только у допустимых материалов.
function openFacadeMaterialPicker(t, returnTo) {
  const info = facadeTargetInfo(t);
  if (!info) return;
  const target = { role: 'facadeMaterial', moduleIdx: t.moduleIdx, moduleName: info.mod.name, secIdx: t.secIdx, zoneIdx: info.zi, returnTo: returnTo || 'materials' };
  if (info.ftId === 'alu') { openAluConstructor(target); return; }
  const opts = facadeMaterialOptionsOf(info.ftId);
  if (!opts.length) return;
  let cur = null;
  try { cur = window.Modul3D.engine.facadeMaterialOf(info.eff, matFacadeProj()); } catch (err) { cur = null; }
  const code = cur && opts.some((o) => o.code === cur.code) ? cur.code : opts[0].code;
  const loc = libLocateMaterial(code) || { topCode: 'sheet', path: [] };
  state.libPickTarget = target;
  libOpenPickLocation(loc.topCode, loc.path);
}

// «Заменить фасады на весь проект»: вид + материал + настройки алюм. фасада
// активной цели (секции/отсека) — во все секции всех модулей, переопределения
// отсеков удаляются. Один recompute() — один шаг «Отменить».
function applyFacadeToWholeProject() {
  const engine = window.Modul3D.engine;
  const info = facadeTargetInfo(matFacadeTarget());
  if (!info || !engine) return;
  // Ключи фасада отсека — из ядра (одна точка правды); запасной минимум —
  // только на случай старого engine.js без этого экспорта.
  const keys = Array.isArray(engine.ZONE_FACADE_KEYS) ? engine.ZONE_FACADE_KEYS : ['facadeType', 'facadeMaterial'];
  const src = Object.assign({}, info.eff);
  if (info.ftId === 'alu') {
    const st = aluSecSettings(src);
    Object.assign(src, { aluProfile: st.profile, aluColor: st.color, aluFill: st.fill, aluPriceMode: st.priceMode, aluMaker: st.maker });
  }
  const ftName = (FACADE_TYPES[info.ftId] || FACADE_TYPES.ldsp).name;
  let what = ftName;
  if (info.ftId === 'alu') what += ` (${aluSummaryText(src).text})`;
  else if (facadeMaterialOptionsOf(info.ftId).length) {
    try { what += ` — ${engine.facadeMaterialOf(src, matFacadeProj()).name}`; } catch (err) { /* без названия */ }
  }
  if (!window.confirm(`Поставить фасад «${what}» во все секции и отсеки всех модулей проекта?`)) return;
  state.modules.forEach((m) => (m.sections || []).forEach((s) => {
    keys.forEach((k) => {
      if (src[k] === undefined || src[k] === null || src[k] === '') delete s[k];
      else s[k] = src[k];
    });
    if (!s.facadeType) s.facadeType = info.ftId;
    // Старый флажок «стекло» (ранние сохранения) больше не нужен: вид
    // задан явно в facadeType, и флажок не должен с ним спорить.
    delete s.glass;
    (s.doorZones || []).forEach((z) => { if (z) keys.forEach((k) => { delete z[k]; }); });
  }));
  recompute();
  renderParamsPanel();
  const fld = document.getElementById('matFacadeField');
  if (fld && fld.scrollIntoView) fld.scrollIntoView({ block: 'center' });
}

// Блок «Направление текстуры» под материалами: настройка ГРУППЫ деталей на
// весь проект (state.grainGroups → proj.grainGroups в движке). Список групп
// берётся из engine.GRAIN_GROUPS, чтобы не расходиться с правилами движка.
// Обработчики — on('p-grain-<id>') в bindPanelEvents. Настройка отдельной
// детали — на экране «Деталь» (partGrainField) и приоритетнее группы.
// Блок «Навес для верхних модулей» — фурнитура, поэтому с 2026-09-28 живёт
// на экране «Конструктив модуля» (moduleFieldsBlock), а не «Материалы» — и
// показывается только у навесного модуля (moduleIsWallHung), как и
// mountTopBlock рядом. Само значение по-прежнему общее на проект
// (state.hangerSystem → proj.hangerSystem в движке), а не по модулям — сменить
// его можно с экрана ЛЮБОГО навесного модуля. С 2026-09-28 — плашка (как у
// материалов, см. matPickPlashkaHtml), а не <select>: клик открывает
// Библиотеку на вкладке «Фурнитура» → «Крепёж и метизы» → «Навесы» (см.
// openHangerSystemPicker/hangerPickPlashkaHtml ниже). Предупреждение о
// присадке по чужому чертежу (drawingVerified:false) больше не дублируется
// текстом здесь — его показывает общая панель предупреждений (см.
// engine.js: warnings.push при !sys.drawingVerified).
// Ключи HARDWARE_PRICES четырёх позиций навеса (3 системы, GTV Forza — Л+П,
// см. catalog.HANGER_SYSTEMS) — только у них в Библиотеке есть «Выбрать»
// (см. libPickRowAllowed).
const HANGER_SYSTEM_PICK_KEYS = new Set(['hangerBlum48N0510', 'hangerGtvR1', 'hangerGtvForzaL', 'hangerGtvForzaR']);
function hangerPickPlashkaHtml() {
  const cat = window.Modul3D.catalog;
  const id = state.hangerSystem || cat.DEFAULT_HANGER_SYSTEM;
  const sys = cat.HANGER_SYSTEMS[id];
  const name = (sys && sys.name) || 'Не выбрано';
  return `<button type="button" class="alu-fill-pick mat-pick" id="p-hangerSystem" data-mat-pick="hangerSystem"
          title="Выбрать в Библиотеке" aria-label="${esc(`${name}. Выбрать в Библиотеке`)}">
          <span class="alu-fill-sw alu-fill-sw-sheet"></span>
          <span class="alu-fill-txt"><span class="alu-fill-name">${esc(name)}</span><span class="alu-fill-sub">Выбрать в Библиотеке →</span></span>
        </button>`;
}
function hangerSystemBlock() {
  const cat = window.Modul3D.catalog;
  const ids = (cat.HANGER_SYSTEM_ORDER || []).filter((id) => cat.hangerSystemAvailable(id));
  if (!ids.length) return '';
  return `
    <h3>Навес для верхних модулей</h3>
    <div class="field">
      <label>Навес</label>
      ${hangerPickPlashkaHtml()}
    </div>`;
}
// Клик по плашке «Навес» → Библиотека, вкладка «Фурнитура», категория
// «Крепёж и метизы» (fastener) → узел «Навесы» (обе фирмы — Blum/GTV — его
// подкатегории). «Навесы» сам по себе — ветка, а не лист (лежит на нём же
// уровне 2 фирмы), поэтому, как и у остальных плашек материалов (см.
// openMaterialPicker: сразу на листе ТЕКУЩЕГО материала), открываем сразу
// на подкатегории (фирме) ТЕКУЩЕЙ выбранной системы навеса — «Выбрать»
// виден без лишнего клика по дереву. Путь фирмы берём из самого товара
// (item.categoryPath/subcategory), а не хардкодим строку «Blum»/«GTV»:
// пользователь мог переименовать подкатегорию в своей Библиотеке
// (libSetEntryPath). Завершение подбора — libPickMaterial (роль 'hangerSystem').
function openHangerSystemPicker() {
  const cat = window.Modul3D.catalog;
  state.libPickTarget = { role: 'hangerSystem', returnTo: 'module' };
  const id = state.hangerSystem || cat.DEFAULT_HANGER_SYSTEM;
  const firstKey = (((cat.HANGER_SYSTEMS[id] || {}).items || [])[0] || {}).key;
  const it = firstKey && cat.HARDWARE_PRICES[firstKey];
  const sub = it && (it.subcategory || it.brand);
  const path = it && Array.isArray(it.categoryPath) && it.categoryPath.length ? it.categoryPath
    : (sub ? ['Навесы', sub] : ['Навесы']);
  libOpenPickLocation('hw:fastener', path);
}

function grainGroupsBlock() {
  const groups = window.Modul3D.engine.GRAIN_GROUPS || [];
  const cur = state.grainGroups || {};
  const field = (g) => `
      <div class="field">
        <label>${esc(g.label)}</label>
        <select id="p-grain-${esc(g.id)}">
          <option value="auto" ${cur[g.id] === 'across' ? '' : 'selected'}>Вдоль</option>
          <option value="across" ${cur[g.id] === 'across' ? 'selected' : ''}>Поперёк</option>
        </select>
      </div>`;
  let rows = '';
  for (let i = 0; i < groups.length; i += 2) {
    rows += `<div class="field-row">${field(groups[i])}${groups[i + 1] ? field(groups[i + 1]) : ''}</div>`;
  }
  return `
    <h3>Направление текстуры</h3>
    ${rows}
    <div class="hint">Только для декоров с рисунком. «Вдоль»: вертикальные детали
    (боковины, стойки, двери) — вдоль высоты, горизонтальные (дно, крыша, полки) —
    вдоль ширины шкафа, ящики и цоколь — вдоль большей стороны. «Поперёк» поворачивает
    текстуру на 90° у всех деталей группы. Отдельную деталь можно переопределить:
    режим фокуса → «Редактировать деталь».</div>`;
}

// Плашки экрана «Материалы» (см. matPickPlashkaHtml) и «Изменить» у
// столешницы — переключают «Библиотеку» в режим подбора материала: пока
// state.libPickTarget не пуст, таблицы рисуют кнопку «Выбрать» у подходящих
// роли строк (см. libPickRowAllowed/libRowHtml/libPickMaterial), которая и
// завершает подбор. Библиотека открывается сразу на нужной категории:
// корпус — «Листовые материалы», видимая боковина — «Листовые материалы →
// ДСП», задняя стенка — «Листовые материалы → ХДФ/ДВП» (первый сегмент пути
// BACK_MATERIALS, без хардкода названия узла).
function openMaterialPicker(role) {
  if (role === 'countertopDecor') {
    state.libPickTarget = { role };
    state.libraryTab = 'materials';
    renderLibraryPanel();
    if (window.Modul3D.uiShell) window.Modul3D.uiShell.openDrawer('library', 'Листовые материалы');
    return;
  }
  state.libPickTarget = { role, returnTo: 'materials' };
  // Сразу на листе ТЕКУЩЕГО материала поля (его таблица с «Выбрать» видна
  // без лишнего клика, крошки ведут выше), если он лежит в нужной категории;
  // иначе — на самой категории.
  const curCode = role === 'decor' ? state.decorCode : role === 'facadeDecor' ? state.facadeDecorCode
    : role === 'facadeMat' ? state.facadeMatCode : state.backCode;
  const loc = libLocateMaterial(curCode);
  let path = [];
  if (role === 'decor') {
    if (loc && loc.topCode === 'sheet') path = loc.path;
  } else if (role === 'facadeDecor') {
    // На листе текущего материала (ЛДСП в «Листовых материалах» или
    // МДФ-панель там, где она лежит), иначе — «Листовые материалы» → ДСП.
    if (loc && loc.topCode !== 'countertop') { libOpenPickLocation(loc.topCode, loc.path); return; }
    path = ['ДСП'];
  } else if (role === 'facadeMat') {
    // «Материал фасада» проекта — ЛДСП-фасад: на листе текущего декора, если
    // он в «Листовых материалах», иначе — «Листовые материалы» → ДСП.
    path = loc && loc.topCode === 'sheet' ? loc.path : ['ДСП'];
  } else if (role === 'back') {
    const b0 = BACK_MATERIALS[0] && Array.isArray(BACK_MATERIALS[0].categoryPath) ? BACK_MATERIALS[0].categoryPath : [];
    path = loc && loc.topCode === 'sheet' && loc.path[0] === b0[0] ? loc.path : b0.slice(0, 1);
  }
  libOpenPickLocation('sheet', path);
}

// Экран «Деталь» (фокусный режим) → плашка «Материал этой детали»: подбор в
// Библиотеке материала ОДНОЙ детали (решение пользователя 2026-09-26 —
// «хирургическая» правка: меняется только выбранная деталь, никаких переходов
// в «Материалы модуля»). «Выбрать» (libPickMaterial, роль 'partMaterial')
// пишет mod.partOverrides[key].materialOverride + thicknessOverride из
// каталога и возвращает на экран этой же детали. Список допустимых листов —
// из ядра (engine.partMaterialOptions).
function partMaterialOptionsOf(kind) {
  const engine = window.Modul3D.engine;
  return engine && typeof engine.partMaterialOptions === 'function' ? engine.partMaterialOptions(kind) : [];
}
function openPartMaterialPicker() {
  const mod = state.modules[state.activeModule];
  const sp = state.selectedPart;
  if (!mod || !sp || !OVERRIDABLE_PART_KINDS.has(sp.kind)) return;
  const { chosen } = resolveSelectedPart(mod);
  if (!chosen) return;
  state.libPickTarget = { role: 'partMaterial', moduleIdx: state.activeModule, moduleName: mod.name,
    key: chosen.key, kind: sp.kind, returnTo: 'part' };
  // На листе текущего материала детали, если он есть в Библиотеке; иначе —
  // «Листовые материалы» → ДСП (задняя стенка — раздел ХДФ/ДВП).
  const loc = libLocateMaterial(chosen.part.material);
  if (loc && loc.topCode !== 'countertop' && loc.topCode !== 'glass') { libOpenPickLocation(loc.topCode, loc.path); return; }
  const b0 = BACK_MATERIALS[0] && Array.isArray(BACK_MATERIALS[0].categoryPath) ? BACK_MATERIALS[0].categoryPath : [];
  libOpenPickLocation('sheet', sp.kind === 'back' ? b0.slice(0, 1) : ['ДСП']);
}
// Модуль цели подбора материала детали или null, если модуль удалён/
// переименован (тогда «Выбрать» ничего не пишет).
function partPickTargetModule(t) {
  const mod = t && state.modules[t.moduleIdx];
  return mod && mod.name === t.moduleName ? mod : null;
}

// Где материал лежит в дереве Библиотеки: { topCode, path } (путь — полный
// categoryPath позиции) или null. Порядок — как строит деревья libTopEntries:
// FACADE_MATERIALS с первым сегментом из SHEET_FACADE_SUBCATS — «Листовые
// материалы», остальные — «Двери → Виды фасадов»; DECORS/BACK_MATERIALS —
// «Листовые материалы» (или своя категория по customRoot); cat.GLASS —
// «Материалы → Стекло».
function libLocateMaterial(code) {
  const cat = aluCat();
  if (!code) return null;
  const cpOf = (it) => (Array.isArray(it.categoryPath) ? it.categoryPath.slice() : []);
  const dec = DECORS.find((d) => d.code === code);
  if (dec) return { topCode: dec.customRoot || 'sheet', path: cpOf(dec) };
  const back = BACK_MATERIALS.find((d) => d.code === code);
  if (back) return { topCode: 'sheet', path: cpOf(back) };
  const fac = (cat.FACADE_MATERIALS || {})[code] || Object.values(cat.FACADE_MATERIALS || {}).find((f) => f.code === code);
  if (fac) {
    if (fac.customRoot) return { topCode: fac.customRoot, path: cpOf(fac) };
    const cp = cpOf(fac);
    return { topCode: SHEET_FACADE_SUBCATS.indexOf(cp[0]) >= 0 ? 'sheet' : 'facade', path: cp };
  }
  if (cat.GLASS && cat.GLASS.code === code) return { topCode: 'glass', path: cpOf(cat.GLASS) };
  return null;
}

// Открывает Библиотеку на разделе topCode и узле path внутри него: раздел
// раскрыт, узел-лист (без подкатегорий) — сразу в фокусе со своей таблицей
// (state.libActiveLeaf), узел-ветка — развёрнут вместе со всеми предками
// (state.libCollapsed), фокус прежнего листа раздела снят, чтобы нужная ветка
// была видна. Прокрутка — к строке узла (или к разделу). Тот же приём, что
// и у подбора заполнения алюм. рамки раньше (openAluFillPicker).
function libOpenPickLocation(topCode, path) {
  const tabKey = topCode === 'facade' || String(topCode).indexOf('faccustom-') === 0 ? 'facades'
    : String(topCode).indexOf('hw:') === 0 ? 'hardware' : 'materials';
  state.libraryTab = tabKey;
  state.libSelectedRow = null;
  state.libLinkForm = null;
  state.libCatOpen[topCode] = true;
  // Вложенный раздел — раскрываем и всех его родителей.
  let par = typeof libTopParentOf === 'function' ? libTopParentOf(tabKey, topCode) : null;
  while (par) { state.libCatOpen[par] = true; par = libTopParentOf(tabKey, par); }
  state.libActiveLeaf[topCode] = null;
  const p = (path || []).filter((s) => s != null && s !== '');
  let valid = [];
  for (let i = 0; i < p.length; i += 1) {
    if (libChildSegments(topCode, valid).indexOf(p[i]) < 0) break;
    valid = valid.concat([p[i]]);
  }
  if (valid.length) {
    if (!libChildSegments(topCode, valid).length) {
      state.libActiveLeaf[topCode] = valid.join('::');
    } else {
      for (let i = 1; i <= valid.length; i += 1) state.libCollapsed[libNodeKey(topCode, valid.slice(0, i))] = false;
    }
  }
  renderLibraryPanel();
  if (window.Modul3D.uiShell) window.Modul3D.uiShell.openDrawer('library');
  const root = document.querySelector(`#drawer-library .lib-category[data-top-code="${topCode}"]`);
  let el = root;
  if (root && valid.length && root.querySelectorAll) {
    const want = valid.join('::');
    el = Array.from(root.querySelectorAll('[data-tree-node]')).filter((r) => r.dataset && r.dataset.path === want)[0] || root;
  }
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
}

// Какие строки Библиотеки годятся текущей цели подбора — «Выбрать» только у
// них (решение пользователя 2026-09-26: только у подходящих позиций).
// topCode — раздел, в чьей таблице стоит строка (group строки может с ним не
// совпадать — см. libTopEntries).
function libPickRowAllowed(topCode, entry) {
  const t = state.libPickTarget;
  if (!t || !entry || entry.group === 'edge') return false;
  const it = entry.item || {};
  const code = libRowKeyOf(entry.group, it);
  const cp = Array.isArray(it.categoryPath) ? it.categoryPath : [];
  const sheetLike = topCode === 'sheet' || String(topCode).indexOf('matcustom-') === 0;
  if (t.role === 'aluFill') return topCode !== 'countertop' && aluFillPickAllowed(code);
  if (t.role === 'partMaterial') return topCode !== 'countertop' && partMaterialOptionsOf(t.kind).some((o) => o.code === code);
  if (t.role === 'hangerSystem') {
    // Фурнитура (HARDWARE_PRICES) хранит позиции по ключу объекта (it.key,
    // см. libHardwareTopEntries), а не it.code — libRowKeyOf выше для этой
    // категории кода не даёт, поэтому здесь сверяем именно it.key. «Выбрать»
    // только у 4 конкретных позиций навеса (3 системы, GTV Forza — Л+П).
    return HANGER_SYSTEM_PICK_KEYS.has(it.key);
  }
  if (t.role === 'countertopDecor') return topCode === 'countertop' || sheetLike;
  if (topCode === 'countertop') return false;
  if (t.role === 'decor') return sheetLike && entry.group !== 'back';
  if (t.role === 'facadeDecor') return entry.group !== 'back' && visibleSideOptionsOf().some((o) => o.code === code);
  if (t.role === 'facadeMat') return entry.group !== 'back' && facadeMatOptionsOf().some((o) => o.code === code);
  if (t.role === 'back') {
    const b0 = BACK_MATERIALS[0] && Array.isArray(BACK_MATERIALS[0].categoryPath) ? BACK_MATERIALS[0].categoryPath[0] : null;
    return sheetLike && (entry.group === 'back' || (!!b0 && cp[0] === b0));
  }
  if (t.role === 'facadeMaterial') {
    const info = facadeTargetInfo(t);
    return !!info && facadeMaterialOptionsOf(info.ftId).some((o) => o.code === code);
  }
  return false;
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
        <input id="drawersThickness" type="number" step="1" value="${window.Modul3D.engine.effectiveDrawerThickness(sec, null)}">
        ${(DRAWER_SYSTEMS[sys] || {}).maxBoxSide
          ? `<div class="hint">Эта система направляющих держит боковину короба не толще ${DRAWER_SYSTEMS[sys].maxBoxSide} мм.</div>`
          : ''}
      </div>
      <div class="field">
        <label>Материал ящиков</label>
        <select id="drawersDecor">
          <option value="" ${!sec.drawerDecorCode ? 'selected' : ''}>${isQuadroDrawerSystem(sec)
            ? `По умолчанию для Quadro V6 (${esc(quadroDrawerDecorObj().name)})`
            : (isKitchenModule(mod)
              ? `По умолчанию (${esc(kitchenDrawerDecorObj().name)})`
              : `Как корпус (${esc((DECORS.find((d) => d.code === carcassDecorCodeOf(mod)) || {}).name || '')})`)}</option>
          ${DECORS.map(d => `<option value="${d.code}" ${sec.drawerDecorCode && d.code === sec.drawerDecorCode ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
        </select>
        <div class="hint">${isQuadroDrawerSystem(sec)
          ? `Направляющие Hettich Quadro V6 держат боковину короба не толще 16 мм — ящики по умолчанию из белого ЛДСП ${esc(quadroDrawerDecorObj().name)}. Выбрали другой материал — он сохраняется.`
          : (isKitchenModule(mod)
            ? `На кухне ящики по умолчанию из белого ЛДСП ${esc(kitchenDrawerDecorObj().name)}. Выбрали другой материал — он сохраняется.`
            : 'По умолчанию ящики из того же материала, что и корпус, и меняются вместе с ним. Выбрали другой материал — он сохраняется.')}</div>
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
    screen = materialsBackLinkBlock() + matFacadeFieldHtml() + materialsBlock(mod) + grainGroupsBlock();
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
      screen = partKindPlaceholderBlock(mod);
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
    <label class="mt6">Открывание фасадов</label>
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
function getModuleHudState(moduleName, sectionIndex) {
  const mod = state.modules.find((m) => m.name === moduleName);
  if (!mod) return null;
  const rotation = Number(mod.rotation) || 0;
  const singleSection = Array.isArray(mod.sections) && mod.sections.length === 1;
  // Блок «секция» HUD: секция кликнутого отсека, а при клике по другой части
  // модуля — единственная секция (у многосекционного модуля без явного
  // отсека блока нет: неоднозначно, какую делить).
  const si = sectionIndex !== undefined ? sectionIndex : (singleSection ? 0 : -1);
  const sec = si >= 0 && Array.isArray(mod.sections) ? mod.sections[si] : null;
  const doorZoneCount = sec ? (Number(sec.doorZoneCount) || 1) : 1;
  const rows = (currentModel && currentModel.partsRaw) || [];
  const canSplitByHeight = !!(sec && rows.some(
    (r) => r.module === moduleName && r.kind === 'door' && r.sectionIndex === si
  ));
  // Материал корпуса для строки «Материал:» HUD — как берёт ядро
  // (m.carcassDecor || proj.decor), а не из поля панели: экран «Материалы»
  // может быть закрыт, а #p-decor — не <select>, а плашка.
  const decorCode = mod.carcassDecor || state.decorCode;
  const decorItem = decorCode ? findAnyMaterialByCode(decorCode) : null;
  const materialName = (decorItem && decorItem.name) || decorCode || '';
  return { rotation, canSplitByHeight, doorZoneCount, materialName };
}

// Мост для ui-shell.js: «Разделить на отсеки» из HUD в 3D — та же логика,
// что применяет числовой пункт «Разделить на отсеки» в viewer.onSelectZone
// выше (setDoorZoneCount + подгонка высоты нижнего отсека под соседа), но
// без клика по конкретному отсеку: секция здесь однозначна — единственная,
// sectionIndex 0 (см. getModuleHudState — кнопка в HUD видна только тогда).
// Полки-перегородки на стыках отсеков отдельно расставлять не нужно —
// engine.js считает их прямо из sec.doorZones при каждой сборке модели
// (см. layoutDoorZones).
function setModuleDoorZoneCount(moduleName, n, sectionIndex) {
  const mod = state.modules.find((m) => m.name === moduleName);
  if (!mod || !Array.isArray(mod.sections)) return;
  // Секция не указана — только для однозонного модуля (как раньше);
  // указана (клик по отсеку в 3D) — любая секция модуля.
  const si = sectionIndex === undefined ? 0 : sectionIndex;
  if (sectionIndex === undefined && mod.sections.length !== 1) return;
  const sec = mod.sections[si];
  if (!sec) return;
  const applied = setDoorZoneCount(sec, n);
  if (applied >= 2) {
    // Нижний отсек по умолчанию — вровень с фасадом соседа (единая
    // горизонтальная линия по ряду), если высота ещё не задана вручную;
    // уже настроенную высоту не трогаем.
    if (!sec.doorZones[0].height) {
      const neighborH = findNeighborBottomZoneHeight(mod, si);
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

// ---------------------------------------------------------------------------
// Алюминиевый рамочный фасад (sec.facadeType === 'alu'): профиль, цвет,
// заполнение, способ изготовления/цены. Поля секции — sec.aluProfile/
// aluColor/aluFill/aluPriceMode/aluMaker. Данные — window.Modul3D.catalog
// (ALU_PROFILES/ALU_PROFILE_COLORS/ALU_MAKERS/...), расчёт — engine.js и
// specification.js. Здесь только выбор значений и их проверка: хранится
// всегда допустимое значение (профиль из каталога, цвет, доступный этому
// профилю, заполнение подходящего профилю вида).
// ---------------------------------------------------------------------------
function aluCat() { return window.Modul3D.catalog || {}; }

// Значение поля из результата engine.aluFacadeOf — может прийти кодом или
// объектом каталога целиком, берём код в обоих случаях.
function aluCodeOf(v) {
  if (v && typeof v === 'object') return v.code || v.id || null;
  return v || null;
}

function aluProfileByCode(code) {
  const profiles = aluCat().ALU_PROFILES || {};
  return profiles[code] || null;
}

// Цвета, доступные профилю: profile.colors === null — все цвета каталога.
function aluAllowedColors(prof) {
  const cat = aluCat();
  const colors = cat.ALU_PROFILE_COLORS || {};
  const order = cat.ALU_PROFILE_COLOR_ORDER || Object.keys(colors);
  return order.filter((id) => colors[id] && (!prof || !Array.isArray(prof.colors) || prof.colors.indexOf(id) >= 0));
}

// Материалы заполнения рамки: «Стекло» (позиции каталога категории «Стекло»)
// и «Листовые материалы» (декоры ЛДСП — тот же список DECORS, что у
// «Декор фасада», плюс плитные позиции FACADE_MATERIALS: МДФ/ЛДСП/шпон).
// Только материалы, которые принимает ядро (engine.aluFillMaterial:
// catalog.findMaterialByCode плюс стекло полок catalog.GLASS) — иначе ядру
// нечем было бы посчитать заполнение. profile.fillType ограничивает
// список одной группой.
function aluFillAccepted(code) {
  const cat = aluCat();
  if (!code) return false;
  if (typeof cat.findMaterialByCode === 'function' && cat.findMaterialByCode(code)) return true;
  return !!(cat.GLASS && cat.GLASS.code === code);
}
function aluFillOptions(prof) {
  const cat = aluCat();
  const seen = {};
  const glass = [];
  const sheet = [];
  const push = (arr, it) => {
    if (!it || !it.code || seen[it.code]) return;
    if (!aluFillAccepted(it.code)) return;
    seen[it.code] = true;
    arr.push({ code: it.code, name: it.name || it.code });
  };
  const fac = Object.values(cat.FACADE_MATERIALS || {});
  const isGlass = (it) => (Array.isArray(it.categoryPath) && it.categoryPath[0] === 'Стекло') || /^GLASS/i.test(it.code || '');
  const isAlu = (it) => it.code === 'FAC-ALU' || (Array.isArray(it.categoryPath) && it.categoryPath[0] === 'Алюминий');
  // Толщина заполнения из паспорта профиля (у Tehmob — 4 мм с уплотнителем):
  // стекло другой толщины в такой профиль не встаёт — в выбор не пускаем
  // (то же правило в engine.aluFacadeOf).
  const needT = prof && Number(prof.fillThickness) > 0 ? Number(prof.fillThickness) : null;
  const fitsT = (it) => !needT || !(Number(it.thickness) > 0) || Number(it.thickness) === needT;
  fac.filter(isGlass).filter(fitsT).forEach((it) => push(glass, it));
  if (cat.GLASS && fitsT(cat.GLASS)) push(glass, cat.GLASS);
  (cat.DECORS || DECORS).forEach((it) => push(sheet, it));
  fac.filter((it) => !isGlass(it) && !isAlu(it) && !it.customOrder && it.sheetW && it.sheetH)
    .forEach((it) => push(sheet, it));
  const ft = prof && prof.fillType;
  return { glass: ft === 'sheet' ? [] : glass, sheet: ft === 'glass' ? [] : sheet };
}

// Нормализованные настройки алюминиевого фасада секции. Умолчания —
// только из ядра (engine.aluFacadeOf — единственный источник): первое
// допустимое из нормализации ядра → записанного в секции → первой позиции
// списка каталога (последнее — лишь запасной вариант, если engine.js не
// загрузился). UI дополнительно сужает выбор: цвет — доступные профилю,
// заполнение — подходящего профилю вида (profile.fillType).
function aluSecSettings(sec) {
  const cat = aluCat();
  const profiles = cat.ALU_PROFILES || {};
  const pOrder = (cat.ALU_PROFILE_ORDER || Object.keys(profiles)).filter((c) => profiles[c]);
  const makers = cat.ALU_MAKERS || {};
  const mOrder = (cat.ALU_MAKER_ORDER || Object.keys(makers)).filter((id) => makers[id]);
  let eng = null;
  const engine = window.Modul3D.engine;
  if (engine && typeof engine.aluFacadeOf === 'function') {
    try { eng = engine.aluFacadeOf(sec) || null; } catch (err) { eng = null; }
  }
  const e = eng || {};
  const firstValid = (cands, ok) => cands.map(aluCodeOf).filter((v) => v && ok(v))[0] || null;

  const profile = firstValid([e.profile, sec.aluProfile, pOrder[0]], (c) => !!profiles[c]);
  const prof = profiles[profile] || null;
  const colors = aluAllowedColors(prof);
  const color = firstValid([e.color, sec.aluColor, colors[0]], (c) => colors.indexOf(c) >= 0);
  const fo = aluFillOptions(prof);
  const fillCodes = fo.glass.concat(fo.sheet).map((o) => o.code);
  const fill = firstValid([e.fill, sec.aluFill, fillCodes[0]], (c) => fillCodes.indexOf(c) >= 0);
  const priceMode = firstValid([e.priceMode, sec.aluPriceMode, 'buy'], (m) => m === 'buy' || m === 'own');
  const maker = firstValid([e.maker, sec.aluMaker, mOrder[0]], (id) => !!makers[id]);
  // Стекло ли заполнение — как решает ядро (fillType), а не по списку UI.
  const fillIsGlass = eng && fill === aluCodeOf(e.fill) ? e.fillType === 'glass' : fo.glass.some((o) => o.code === fill);
  return { profile, prof, color, fill, fillIsGlass, priceMode, maker };
}

// Чертёж сечения профиля. Источник — по приоритету:
//   1) prof.sectionImage — картинка, загруженная пользователем в Библиотеке
//      (Двери → Алюминиевые фасады → Профили, см. libAluPickSectionImage);
//   2) prof.section — векторный контур из catalog.js (обведён по паспорту
//      производителя): тело стенок с лёгкой заливкой, полости пустые
//      (fill-rule evenodd), положение стекла — голубая полоса, размеры —
//      только паспортные числа из section.dims;
//   3) ни того, ни другого — рамка-заглушка «по паспорту профиля».
// Масштаб — по viewBox (мм), толщина линий не зависит от масштаба
// (vector-effect), цвета — через CSS-переменные темы (style.css .alu-sec-*).
// opts.small — миниатюра для таблицы Библиотеки (без размеров);
// opts.colorHex — цвет профиля для заливки тела стенок.
function aluSectionImageOk(src) {
  return typeof src === 'string' && /^data:image\/(png|jpe?g|webp);base64,/i.test(src);
}
function aluSectionValid(s) {
  return !!(s && Number(s.w) > 0 && Number(s.h) > 0 && Array.isArray(s.outlines) && s.outlines.length
    && s.outlines.every((c) => Array.isArray(c) && c.length >= 3));
}
function aluProfileSectionHtml(prof, opts) {
  const o = opts || {};
  const sm = o.small ? ' alu-schema-sm' : '';
  const art = prof ? (prof.article || prof.code || '') : '';
  if (prof && aluSectionImageOk(prof.sectionImage)) {
    return `<img class="alu-schema alu-schema-img${sm}" src="${esc(prof.sectionImage)}" alt="${esc(`Чертёж сечения профиля ${art} (загружен пользователем)`)}" title="Чертёж сечения — загруженная картинка">`;
  }
  const s = prof && prof.section;
  if (!aluSectionValid(s)) {
    return `<div class="alu-schema alu-schema-empty${sm}" role="img" aria-label="Чертёж сечения — по паспорту профиля">Чертёж сечения — по паспорту профиля</div>`;
  }
  const f = (n) => Math.round(n * 100) / 100;
  const w = Number(s.w);
  const h = Number(s.h);
  const g = Array.isArray(s.glass) && s.glass.length === 4 && s.glass.every((v) => Number.isFinite(Number(v)))
    ? s.glass.map(Number) : null;
  const dims = o.small ? [] : (Array.isArray(s.dims) ? s.dims : []).filter((d) =>
    d && Array.isArray(d.from) && Array.isArray(d.to) && Number.isFinite(Number(d.at)) && d.label != null);
  // Габарит без подписей: сам профиль, стекло, размерные линии.
  let x0 = 0, y0 = 0, x1 = w, y1 = h;
  if (g) { x0 = Math.min(x0, g[0]); x1 = Math.max(x1, g[2]); y0 = Math.min(y0, g[1]); y1 = Math.max(y1, g[3]); }
  dims.forEach((d) => {
    const at = Number(d.at);
    if (d.side === 'top' || d.side === 'bottom') { y0 = Math.min(y0, at); y1 = Math.max(y1, at); }
    else { x0 = Math.min(x0, at); x1 = Math.max(x1, at); }
  });
  // Кегль подписи/стрелки — доля габарита, чтобы на экране цифры были одного
  // размера у узкого и широкого профиля (SVG вписан в одну ширину).
  const fs = Math.max(x1 - x0, y1 - y0) * 0.055;
  const arr = fs * 0.75;
  const pad = o.small ? fs * 0.4 : fs * 1.25;
  // Подпись, не влезающая между выносными линиями, выносится за конец размера.
  const txtW = (label) => String(label).length * fs * 0.58;
  const dimSvg = [];
  const tri = (tx, ty, dx, dy) => {
    // стрелка остриём в (tx,ty), направлена вдоль (dx,dy)
    const bx = tx - dx * arr, by = ty - dy * arr;
    const nx = -dy * arr * 0.28, ny = dx * arr * 0.28;
    return `<path class="alu-sec-arrow" d="M${f(tx)} ${f(ty)} L${f(bx + nx)} ${f(by + ny)} L${f(bx - nx)} ${f(by - ny)} Z"/>`;
  };
  dims.forEach((d) => {
    const at = Number(d.at);
    const label = String(d.label);
    const horiz = d.side === 'top' || d.side === 'bottom';
    const a = horiz ? Math.min(d.from[0], d.to[0]) : Math.min(d.from[1], d.to[1]);
    const b = horiz ? Math.max(d.from[0], d.to[0]) : Math.max(d.from[1], d.to[1]);
    const out = horiz ? (d.side === 'bottom' ? 1 : -1) : (d.side === 'right' ? 1 : -1);
    const over = fs * 0.35; // выносная линия заходит за размерную
    [d.from, d.to].forEach((p) => {
      if (horiz) dimSvg.push(`<line class="alu-sec-ext" x1="${f(p[0])}" y1="${f(p[1])}" x2="${f(p[0])}" y2="${f(at + out * over)}"/>`);
      else dimSvg.push(`<line class="alu-sec-ext" x1="${f(p[0])}" y1="${f(p[1])}" x2="${f(at + out * over)}" y2="${f(p[1])}"/>`);
    });
    const span = b - a;
    const fits = span >= txtW(label) + fs * 0.4;
    const arrowsIn = span >= arr * 2.4;
    const tail = arrowsIn ? 0 : arr * 1.6;
    const textEnd = fits ? 0 : txtW(label) + fs * 0.5;
    const la = a - tail;
    const lb = b + Math.max(tail, textEnd);
    if (horiz) {
      dimSvg.push(`<line class="alu-sec-dim" x1="${f(la)}" y1="${f(at)}" x2="${f(lb)}" y2="${f(at)}"/>`);
      dimSvg.push(arrowsIn ? tri(a, at, -1, 0) + tri(b, at, 1, 0) : tri(a, at, 1, 0) + tri(b, at, -1, 0));
      const tx = fits ? (a + b) / 2 : b + fs * 0.4;
      dimSvg.push(`<text class="alu-sec-txt" x="${f(tx)}" y="${f(at - fs * 0.3)}" font-size="${f(fs)}" stroke-width="${f(fs * 0.28)}" text-anchor="${fits ? 'middle' : 'start'}">${esc(label)}</text>`);
      if (!fits) x1 = Math.max(x1, lb);
    } else {
      dimSvg.push(`<line class="alu-sec-dim" x1="${f(at)}" y1="${f(la)}" x2="${f(at)}" y2="${f(lb)}"/>`);
      dimSvg.push(arrowsIn ? tri(at, a, 0, -1) + tri(at, b, 0, 1) : tri(at, a, 0, 1) + tri(at, b, 0, -1));
      const ty = fits ? (a + b) / 2 : b + fs * 0.4;
      const tx = at - fs * 0.3;
      dimSvg.push(`<text class="alu-sec-txt" x="${f(tx)}" y="${f(ty)}" font-size="${f(fs)}" stroke-width="${f(fs * 0.28)}" text-anchor="${fits ? 'middle' : 'end'}" transform="rotate(-90 ${f(tx)} ${f(ty)})">${esc(label)}</text>`);
      if (!fits) y1 = Math.max(y1, lb);
    }
  });
  // Подписи стоят снаружи размерных линий — запас под кегль со всех сторон.
  const vbX = x0 - pad;
  const vbY = y0 - pad;
  const vbW = (x1 - x0) + pad * 2;
  const vbH = (y1 - y0) + pad * 2;
  const pathD = s.outlines.map((c) => 'M' + c.map((p) => `${f(Number(p[0]))} ${f(Number(p[1]))}`).join(' L') + ' Z').join(' ');
  let glassSvg = '';
  if (g) {
    // Стекло: заливка + кромки; дальний конец — линия обрыва (стекло
    // продолжается к центру фасада).
    const zz = Math.min(fs * 0.5, (g[3] - g[1]) / 3);
    const mid = (g[1] + g[3]) / 2;
    glassSvg = `<rect class="alu-sec-glass" x="${f(g[0])}" y="${f(g[1])}" width="${f(g[2] - g[0])}" height="${f(g[3] - g[1])}"/>`
      + `<path class="alu-sec-glass-edge" d="M${f(g[2])} ${f(g[1])} L${f(g[0])} ${f(g[1])} L${f(g[0])} ${f(g[3])} L${f(g[2])} ${f(g[3])}"/>`
      + `<path class="alu-sec-break" d="M${f(g[2])} ${f(g[1] - zz)} L${f(g[2])} ${f(mid - zz)} L${f(g[2] + zz)} ${f(mid)} L${f(g[2] - zz)} ${f(mid)} L${f(g[2])} ${f(mid + zz)} L${f(g[2])} ${f(g[3] + zz)}"/>`;
  }
  const hex = o.colorHex && /^#[0-9a-f]{3,8}$/i.test(o.colorHex) ? o.colorHex : '';
  const title = `Чертёж сечения профиля ${art} — по паспорту производителя${g ? ', голубым — положение стекла' : ''}`;
  return `<svg class="alu-schema alu-sec${sm}" viewBox="${f(vbX)} ${f(vbY)} ${f(vbW)} ${f(vbH)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>
    ${glassSvg}<path class="alu-sec-body" fill-rule="evenodd" d="${pathD}"${hex ? ` style="fill:${esc(hex)}"` : ''}/>${dimSvg.join('')}</svg>`;
}

// Тип профиля (catalog ALU_PROFILES.kind) — подпись в секции и Библиотеке.
const ALU_KIND_LABEL = { closed: 'закрытый', open: 'открытый' };
const ALU_KIND_HINT = { closed: 'край стекла спрятан под нахлёст профиля', open: 'край стекла не закрыт профилем' };

// Размер стекла фасадов секции — числа из построенной модели (part.aluFrame.
// fillW/fillH, ядро: фасад − 2·fillStop − fillGap) и правило из профиля
// (engine.aluFacadeOf → fillStop/fillGap). Сами размеры здесь не считаем:
// габарит фасада восстанавливается обратно из того же правила только для
// подписи «(фасад 600 × 700 − 2×12.5 − 3)». loc — { moduleName, secIdx,
// zoneIdx } фасадов, чьи размеры показать (null — только правило): в
// конструкторе фасада (libAluConstructorHtml) это цель подбора, и только
// пока у неё тот же профиль, что в черновике (иначе числа модели — от
// другого профиля).
function aluSecGlassSizeHtml(sec, loc) {
  const engine = window.Modul3D.engine;
  let a = null;
  if (engine && typeof engine.aluFacadeOf === 'function') {
    try { a = engine.aluFacadeOf(sec); } catch (err) { a = null; }
  }
  const stop = a && a.fillStop != null ? Number(a.fillStop) : null;
  const gap = a && a.fillGap != null ? Number(a.fillGap) : null;
  if (stop == null || gap == null) return 'Размер стекла уточняйте по паспорту профиля.';
  const rule = `фасад − 2×${stop} − ${gap}`;
  const rows = loc ? ((currentModel && currentModel.partsRaw) || []) : [];
  const sizes = new Map();
  rows.forEach((pt) => {
    const af = pt && pt.aluFrame;
    if (pt.module !== loc.moduleName || pt.sectionIndex !== loc.secIdx || !af || af.fillType !== 'glass') return;
    if (loc.zoneIdx != null && pt.zoneIndex !== loc.zoneIdx) return;
    const key = af.fillW > 0 && af.fillH > 0 ? `${af.fillW}×${af.fillH}` : '?';
    const cur = sizes.get(key) || { af, pt, n: 0 };
    cur.n += Number(pt.qty) || 1;
    sizes.set(key, cur);
  });
  if (!sizes.size) return `Стекло: ${esc(rule)} по ширине и по высоте.`;
  const r1 = (n) => Math.round(n * 10) / 10;
  const list = Array.from(sizes.values()).map(({ af, pt, n }) => {
    if (!(af.fillW > 0 && af.fillH > 0)) return 'размер уточняйте по паспорту профиля';
    const fw = r1(Number(pt.length) > 0 ? Number(pt.length) : af.fillW + 2 * stop + gap);
    const fh = r1(Number(pt.width) > 0 ? Number(pt.width) : af.fillH + 2 * stop + gap);
    return `${af.fillW} × ${af.fillH} мм${n > 1 ? ` (${n} шт)` : ''} — фасад ${fw} × ${fh} − 2×${stop} − ${gap}`;
  });
  return `Стекло ${esc(String((a && a.fillThickness) || ''))}${a && a.fillThickness ? ' мм' : ''}: ${list.map(esc).join('; ')}`;
}

// «2 хлыста по 5.8 м» / «4 отрезка по 3 м» — подпись row.bars в смете.
// Длина — из каталога (профиль по артикулу строки, уплотнитель — по коду).
function aluBarsLabel(r) {
  const n = Number(r && r.bars);
  if (!(n > 0)) return '';
  const cat = aluCat();
  const seal = (cat.ALU_FRAME_EXTRAS || {}).seal;
  let len = null;
  let words;
  if (seal && r.article && r.article === seal.code) {
    len = seal.barLength;
    words = ['отрезок', 'отрезка', 'отрезков'];
  } else {
    const prof = Object.values(cat.ALU_PROFILES || {}).filter((pp) => pp.article === r.article)[0];
    len = prof && prof.barLength;
    words = prof && prof.priceUnit === 'bar' ? ['палка', 'палки', 'палок'] : ['хлыст', 'хлыста', 'хлыстов'];
  }
  if (!(Number(len) > 0)) return '';
  const m10 = n % 10, m100 = n % 100;
  const form = m10 === 1 && m100 !== 11 ? 0 : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 1 : 2);
  return `${n} ${words[form]} по ${len} м`;
}

function aluPhoneHref(phone) { return 'tel:' + String(phone || '').replace(/[^\d+]/g, ''); }

// Контакты производителя: телефон (tel:), почта (mailto:), сайт.
function aluMakerContactsHtml(maker) {
  if (!maker) return '';
  const parts = [];
  if (maker.phone) parts.push(`<a href="${esc(aluPhoneHref(maker.phone))}">${esc(maker.phone)}</a>`);
  if (maker.email) parts.push(`<a href="mailto:${esc(maker.email)}">${esc(maker.email)}</a>`);
  if (maker.url) parts.push(`<a href="${esc(maker.url)}" target="_blank" rel="noopener">${esc(String(maker.url).replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>`);
  return `<span class="alu-contacts">${parts.join(' · ')}</span>`;
}

// «4 уголка на фасад» — число из каталога (ALU_FRAME_EXTRAS.corner.perFacade).
function aluCornersLabel() {
  const corner = (aluCat().ALU_FRAME_EXTRAS || {}).corner;
  const n = corner && Number(corner.perFacade) > 0 ? Number(corner.perFacade) : null;
  if (n == null) return 'уголки';
  const m10 = n % 10, m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? 'уголок' : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'уголка' : 'уголков');
  return `${n} ${word} на фасад`;
}

function aluPriceUnitLabel(prof) {
  if (!prof) return '';
  if (prof.priceUnit === 'm') return 'за пог. м';
  if (prof.priceUnit === 'bar') return `за палку${prof.barLength ? ` ${prof.barLength} м` : ''}`;
  return 'единица не подтверждена';
}

// ---------------------------------------------------------------------------
// КОНСТРУКТОР АЛЮМИНИЕВОГО ФАСАДА (решение пользователя 2026-09-26): профиль,
// цвет, заполнение, цена/производитель, схема сечения, размер стекла — не в
// карточке секции, а в Библиотеке → Двери → «Алюминиевые фасады» (вверху
// раздела). Настройки собираются в черновике state.aluDraft ({ aluProfile,
// aluColor, aluFill, aluPriceMode, aluMaker } — те же ключи, что у секции/
// отсека) и попадают в проект только по «Выбрать» конструктора — в цель
// подбора фасада (state.libPickTarget role 'facadeMaterial': секция или
// отсек). Без цели конструктор можно смотреть, «Выбрать» неактивна.
// ---------------------------------------------------------------------------
const ALU_DRAFT_KEYS = ['aluProfile', 'aluColor', 'aluFill', 'aluPriceMode', 'aluMaker'];
function aluDraftSec() { return Object.assign({}, state.aluDraft || {}, { facadeType: 'alu' }); }
// Черновик приводится к допустимому (aluSecSettings — умолчания из ядра):
// например, при смене профиля цвет/заполнение, недоступные новому профилю,
// заменяются на допустимые, как раньше в карточке секции.
function aluDraftNormalize() {
  const d = state.aluDraft || (state.aluDraft = {});
  const st = aluSecSettings(aluDraftSec());
  d.aluProfile = st.profile;
  d.aluColor = st.color;
  d.aluFill = st.fill;
  d.aluPriceMode = st.priceMode;
  d.aluMaker = st.maker;
  return st;
}
function aluDraftGet() {
  if (!state.aluDraft) aluDraftNormalize();
  return state.aluDraft;
}
function aluDraftFromEff(eff) {
  const d = {};
  ALU_DRAFT_KEYS.forEach((k) => { if (eff && eff[k] != null && eff[k] !== '') d[k] = eff[k]; });
  state.aluDraft = d;
  aluDraftNormalize();
}
// Цель подбора фасада, к которой относится конструктор: сама цель или, пока
// идёт подбор заполнения (role 'aluFill'), её родитель.
// Без цели подбора (конструктор открыт прямо из Библиотеки) — «свободная»
// цель: активная секция (или выбранный отсек) активного модуля, как у поля
// «Фасад» (matFacadeTarget); setAlu — «Выбрать» заодно ставит вид фасада
// «Фасад из алюминиевого профиля».
function aluCtorOuterTarget() {
  const t = state.libPickTarget;
  if (!t) return aluFreeTarget();
  if (t.role === 'facadeMaterial') return t;
  if (t.role === 'aluFill') return t.parent || aluFreeTarget();
  return null;
}
// Секция без фасада: все двери «открыто» и нет ящиков — та же проверка,
// что прячет блок «Вид фасада» в «Конструктиве» (renderSections).
function secIsOpenNoFacade(sec) {
  return !!sec && secEffectiveFacades(sec).every((f) => f === 'open') && !sec.drawers;
}
// Конструктор работает со «свободной» целью (активная секция), а не с целью
// подбора из секции/поля «Фасад» — см. aluCtorOuterTarget.
function aluCtorUsesFreeTarget() {
  const t = state.libPickTarget;
  return !t || (t.role === 'aluFill' && !t.parent);
}
// Почему у свободной цели нечего ставить: 'noModule' | 'noSections' |
// 'openSection' | null (цель есть).
function aluFreeBlockReason() {
  if (!state.modules.length) return 'noModule';
  const mod = state.modules[state.activeModule];
  if (!mod || !mod.sections || !mod.sections.length) return 'noSections';
  const secIdx = Math.max(0, Math.min(Number(mod.activeSection) || 0, mod.sections.length - 1));
  if (secIsOpenNoFacade(mod.sections[secIdx])) return 'openSection';
  return null;
}
const ALU_FREE_BLOCK_MSG = {
  noModule: { title: 'Сначала добавьте модуль',
    hint: 'Сначала добавьте модуль — тогда фасад можно будет поставить в его секцию.' },
  noSections: { title: 'Сначала добавьте секцию в модуль',
    hint: 'У модуля нет секций — сначала добавьте секцию, тогда можно поставить алюминиевый фасад.' },
  openSection: { title: 'Сначала выберите дверь у секции — тогда можно поставить алюминиевый фасад',
    hint: 'Сначала выберите дверь у секции — тогда можно поставить алюминиевый фасад.' },
};
function aluFreeTarget() {
  if (aluFreeBlockReason()) return null;
  const t = matFacadeTarget();
  if (!t) return null;
  // returnTo — всегда «Материалы» (2026-09-29): «Вид фасада»/плашка
  // алюминиевого фасада секции/отсека показываются только там (см.
  // matFacadeFieldHtml) — раньше секция без отсеков возвращала на «Конструктив
  // модуля», где жила своя плашка (убрана, экран больше не знает про фасад).
  return Object.assign({ role: 'facadeMaterial', returnTo: 'materials', setAlu: true }, t);
}
// «Выбрать» у профиля в таблице «Алюминиевых фасадов»: профиль → черновик
// конструктора (проект не меняется до «Выбрать» в конструкторе).
function libAluPickProfile(code) {
  const profiles = aluCat().ALU_PROFILES || {};
  if (!profiles[code]) return;
  aluDraftGet().aluProfile = code;
  aluDraftNormalize();
  libAluOpen = true;
  renderLibraryPanel();
  const el = document.getElementById('libAluCtor');
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
}
// Лист FAC-ALU в «Двери → Виды фасадов»: открыть конструктор. Цель подбора
// фасада (открыли Библиотеку из поля «Фасад»/секции) сохраняется и получает
// setAlu; без неё — свободная цель (активная секция).
function openAluConstructorFromLibrary() {
  const t = state.libPickTarget;
  if (t && t.role === 'facadeMaterial' && facadeTargetInfo(t)) {
    openAluConstructor(Object.assign({}, t, { setAlu: true }));
    return;
  }
  state.libPickTarget = null;
  const info = facadeTargetInfo(aluFreeTarget());
  if (info && info.ftId === 'alu') aluDraftFromEff(info.eff);
  libShowAluConstructor();
}

// «Заполнение» рамки — не выпадающий список, а плашка с текущим материалом
// черновика: клик открывает Библиотеку в режиме подбора (роль 'aluFill', см.
// openAluFillPicker/libPickMaterial). Название — из ядра (engine.aluFacadeOf
// → fillName), образец — картинка материала, если есть, иначе голубоватый
// квадрат у стекла / нейтральный у листа.
function aluFillPickButtonHtml(sec, st) {
  const engine = window.Modul3D.engine;
  let a = null;
  if (engine && typeof engine.aluFacadeOf === 'function') {
    try { a = engine.aluFacadeOf(sec); } catch (err) { a = null; }
  }
  const cat = aluCat();
  let item = null;
  if (st.fill) {
    if (typeof cat.findMaterialByCode === 'function') item = cat.findMaterialByCode(st.fill) || null;
    if (!item && cat.GLASS && cat.GLASS.code === st.fill) item = cat.GLASS;
  }
  const name = (a && a.fillName) || (item && item.name) || st.fill || 'Не выбрано';
  const img = item && typeof item.image === 'string' && item.image ? item.image : '';
  const swCls = img ? '' : (st.fillIsGlass ? ' alu-fill-sw-glass' : ' alu-fill-sw-sheet');
  const swStyle = img ? ` style="background-image:url('${esc(img)}')"` : '';
  return `<button type="button" class="alu-fill-pick" data-alu-draft-fill="1"
          title="Выбрать заполнение в Библиотеке" aria-label="${esc(`Заполнение: ${name}. Выбрать в Библиотеке`)}">
          <span class="alu-fill-sw${swCls}"${swStyle}></span>
          <span class="alu-fill-txt"><span class="alu-fill-name">${esc(name)}</span><span class="alu-fill-sub">Выбрать в Библиотеке →</span></span>
        </button>`;
}

// Какие строки Библиотеки годятся в заполнение рамки черновика — ровно тот
// же список, что проверяет aluSecSettings (aluFillOptions: принимает ядро +
// подходит profile.fillType), иначе выбранный код тут же был бы заменён.
function aluFillPickAllowed(code) {
  if (!code) return false;
  const st = aluSecSettings(aluDraftSec());
  const fo = aluFillOptions(st.prof);
  return fo.glass.concat(fo.sheet).some((o) => o.code === code);
}

// Клик по плашке «Заполнение» конструктора: Библиотека → раздел по виду
// заполнения профиля: только стекло — «Стекло» (сразу таблица листа),
// только лист — «Листовые материалы»; профиль без ограничения — по
// текущему заполнению. Стёкла лежат в двух местах Библиотеки: «Материалы →
// Стекло» (cat.GLASS, 6 мм) и «Двери → Виды фасадов → Стекло» (GLASS-4 в
// FACADE_MATERIALS) — если первое профилю не подходит (толщина по паспорту,
// см. aluFillOptions), открываем «Двери». Отмена — закрытие Библиотеки.
function openAluFillPicker() {
  const st = aluSecSettings(aluDraftSec());
  const ft = st.prof && st.prof.fillType;
  const toGlass = ft === 'glass' || (ft !== 'sheet' && st.fillIsGlass);
  const gMat = aluCat().GLASS;
  const glassOpts = toGlass ? aluFillOptions(st.prof).glass : [];
  const toDoorsGlass = toGlass && glassOpts.length > 0 && !(gMat && glassOpts.some((o2) => o2.code === gMat.code));
  let topCode = 'sheet';
  let path = [];
  if (toDoorsGlass) {
    const f0 = (aluCat().FACADE_MATERIALS || {})[glassOpts[0].code];
    topCode = 'facade';
    path = f0 && Array.isArray(f0.categoryPath) ? f0.categoryPath : [];
  } else if (toGlass) {
    topCode = 'glass';
    path = gMat && Array.isArray(gMat.categoryPath) ? gMat.categoryPath : [];
  }
  state.libPickTarget = { role: 'aluFill', parent: aluCtorOuterTarget() };
  libOpenPickLocation(topCode, path);
}

// Плашка алюм. фасада в секции/поле «Фасад» → конструктор с текущими
// настройками этой секции/отсека (target — цель role 'facadeMaterial').
function openAluConstructor(target) {
  const info = facadeTargetInfo(target);
  if (!info) return;
  aluDraftFromEff(info.eff);
  state.libPickTarget = target;
  libShowAluConstructor();
}
function libShowAluConstructor() {
  state.libraryTab = 'facades';
  state.libSelectedRow = null;
  state.libLinkForm = null;
  libAluOpen = true;
  renderLibraryPanel();
  if (window.Modul3D.uiShell) window.Modul3D.uiShell.openDrawer('library');
  const el = document.getElementById('libAluCtor');
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
}

// Размер стекла в конструкторе — числа модели только у цели подбора и только
// пока у неё тот же профиль, что в черновике (см. aluSecGlassSizeHtml).
function aluCtorGlassLoc(info, st) {
  if (!info || info.ftId !== 'alu') return null;
  const cur = aluSecSettings(Object.assign({}, info.eff, { facadeType: 'alu' }));
  if (cur.profile !== st.profile) return null;
  return { moduleName: info.mod.name, secIdx: info.mod.sections.indexOf(info.sec), zoneIdx: info.zi };
}
// Для кого «Выбрать» конструктора: подпись «Для: …» и активна ли кнопка.
// Без явной цели — активная секция (aluFreeTarget), без модулей — неактивна.
function aluCtorTargetState() {
  const outer = aluCtorOuterTarget();
  const info = facadeTargetInfo(outer);
  const canApply = !!(info && (info.ftId === 'alu' || (outer && outer.setAlu)));
  if (canApply) {
    const willSetAlu = info.ftId !== 'alu';
    return { canApply, title: '', hintHtml: `Для: <b>${esc(facadeTargetLabel(info))}</b>${willSetAlu ? '<br>Вид фасада станет «Фасад из алюминиевого профиля».' : ''}` };
  }
  const reason = aluCtorUsesFreeTarget() ? aluFreeBlockReason()
    : (!state.modules.length ? 'noModule' : null);
  if (reason) {
    const m = ALU_FREE_BLOCK_MSG[reason];
    return { canApply, title: m.title, hintHtml: esc(m.hint) };
  }
  return { canApply, title: 'Сначала откройте конструктор из секции или поля «Фасад»',
    hintHtml: 'Можно посмотреть варианты. Чтобы поставить фасад, нажмите плашку алюминиевого фасада в секции («Конструктив модуля») или в поле «Фасад» («Материалы модуля»).' };
}
// Активная секция/модуль сменились, пока Библиотека открыта, — подпись «Для:»
// и кнопку обновляем на месте, не перерисовывая всю Библиотеку.
function refreshAluCtorTarget() {
  const hint = document.getElementById('libAluCtorTarget');
  const btn = document.getElementById('libAluCtorApply');
  if (!hint || !btn) return;
  const tgt = aluCtorTargetState();
  hint.innerHTML = tgt.hintHtml;
  btn.disabled = !tgt.canApply;
  btn.title = tgt.canApply ? '' : tgt.title;
}
// После recompute() числа размера стекла могли измениться — обновляем только
// эту строку конструктора, не всю Библиотеку.
function refreshAluCtorGlassHint() {
  refreshAluCtorTarget();
  const el = document.getElementById('libAluCtorGlass');
  if (!el || !state.aluDraft) return;
  const st = aluSecSettings(aluDraftSec());
  el.innerHTML = aluSecGlassSizeHtml(aluDraftSec(), aluCtorGlassLoc(facadeTargetInfo(aluCtorOuterTarget()), st));
}

function libAluConstructorHtml() {
  const cat = aluCat();
  const profiles = cat.ALU_PROFILES || {};
  if (!Object.keys(profiles).length) {
    return '<div class="hint">Каталог алюминиевых профилей не загружен — обновите страницу.</div>';
  }
  aluDraftGet();
  const st = aluDraftNormalize();
  const sec = aluDraftSec();
  const prof = st.prof;
  const pOrder = (cat.ALU_PROFILE_ORDER || Object.keys(profiles)).filter((c) => profiles[c]);
  const colorsCat = cat.ALU_PROFILE_COLORS || {};
  const colorIds = aluAllowedColors(prof);
  const curColor = colorsCat[st.color] || null;
  const makers = cat.ALU_MAKERS || {};
  const mOrder = (cat.ALU_MAKER_ORDER || Object.keys(makers)).filter((id) => makers[id]);
  const maker = makers[st.maker] || null;
  const info = facadeTargetInfo(aluCtorOuterTarget());
  const tgt = aluCtorTargetState();

  const profLabel = (p) => [p.name, p.article, p.width ? `${p.width} мм` : ''].filter(Boolean).join(' · ');
  const fillHint = prof && prof.fillType === 'glass' ? 'Этот профиль — только под стекло.'
    : prof && prof.fillType === 'sheet' ? 'Этот профиль — только под листовой материал.' : '';
  const sectionKnown = prof && Number(prof.width) > 0 && Number(prof.depth) > 0;
  const hinge = (cat.ALU_FRAME_EXTRAS || {}).hinge || {};

  let priceHtml;
  if (st.priceMode === 'buy') {
    const priced = maker && maker.pricePerM2 != null && Number(maker.pricePerM2) >= 0;
    priceHtml = `
        <label class="mt6">Производитель</label>
        <select data-alu-draft="aluMaker">
          ${mOrder.map((id) => `<option value="${esc(id)}" ${id === st.maker ? 'selected' : ''}>${esc(makers[id].name)}${makers[id].city ? ` (${esc(makers[id].city)})` : ''}</option>`).join('')}
        </select>
        ${priced
          ? `<div class="hint">Цена готового фасада: ${esc(maker.pricePerM2)} ${esc(curSym())}/м²</div>`
          : `<div class="hint alu-ask-price">Уточняйте цену у производителя${maker ? `: ${aluMakerContactsHtml(maker)}` : ''}</div>`}`;
  } else {
    const unitNote = prof && prof.priceUnit == null ? ' · смета считает за метр' : '';
    priceHtml = `
        <div class="hint">Смета посчитает профиль по периметру, заполнение, ${esc(aluCornersLabel())}${st.fillIsGlass ? ', уплотнитель' : ''} и сборку — по ценам таблиц ниже.</div>
        ${prof ? `<div class="hint">Профиль: ${prof.price != null ? `${esc(prof.price)} ${esc(curSym())} ${esc(aluPriceUnitLabel(prof))}` : 'цена не указана'}${esc(unitNote)}</div>` : ''}`;
  }
  const glassHtml = st.fillIsGlass
    ? `<br><span id="libAluCtorGlass">${aluSecGlassSizeHtml(sec, aluCtorGlassLoc(info, st))}</span>` : '';
  const applyAttrs = tgt.canApply ? '' : ` disabled title="${esc(tgt.title)}"`;
  // Подсказка «цель подбора пропала» (libAluDraftApply) — показываем один раз.
  const staleNotice = libAluStaleNotice;
  libAluStaleNotice = '';

  return `
    <div class="alu-block alu-ctor" id="libAluCtor">
      <div class="lib-alu-sub">Конструктор фасада</div>
      ${staleNotice ? `<div class="hint alu-ask-price" role="status">${esc(staleNotice)}</div>` : ''}
      <div class="hint alu-ctor-target" id="libAluCtorTarget">${tgt.hintHtml}</div>
      <label class="mt6">Профиль</label>
      <select data-alu-draft="aluProfile">
        ${pOrder.map((c) => `<option value="${esc(c)}" ${c === st.profile ? 'selected' : ''}>${esc(profLabel(profiles[c]))}</option>`).join('')}
      </select>
      <div class="alu-schema-wrap">
        ${aluProfileSectionHtml(prof, { colorHex: curColor && curColor.hex })}
        <div class="hint">${sectionKnown ? `Ширина рамки ${esc(prof.width)} мм, толщина ${esc(prof.depth)} мм` : 'Сечение — по паспорту профиля'}${prof && ALU_KIND_LABEL[prof.kind] ? `<br>Тип профиля: ${esc(ALU_KIND_LABEL[prof.kind])} — ${esc(ALU_KIND_HINT[prof.kind])}` : ''}${glassHtml}${prof && prof.hinge === 'aluFrame' ? `<br>Петля: ${esc(hinge.name || 'для алюминиевой рамки')} (${esc(hinge.article || '—')}) — крепится на винты, чашка Ø35 не сверлится.` : ''}</div>
      </div>
      <label class="mt6">Цвет профиля</label>
      <div class="alu-select-row">
        <span class="alu-swatch" style="background:${esc(curColor ? curColor.hex : 'transparent')}"></span>
        <select data-alu-draft="aluColor">
          ${colorIds.map((id) => `<option value="${esc(id)}" ${id === st.color ? 'selected' : ''}>${esc(colorsCat[id].name)}</option>`).join('')}
        </select>
      </div>
      <label class="mt6">Заполнение</label>
      ${aluFillPickButtonHtml(sec, st)}
      ${fillHint ? `<div class="hint">${esc(fillHint)}</div>` : ''}
      <label class="mt6">Цена</label>
      <select data-alu-draft="aluPriceMode">
        <option value="buy" ${st.priceMode === 'buy' ? 'selected' : ''}>Покупной у производителя</option>
        <option value="own" ${st.priceMode === 'own' ? 'selected' : ''}>Собственное изготовление</option>
      </select>
      ${priceHtml}
      <div class="alu-ctor-actions">
        <button type="button" class="btn btn-primary" id="libAluCtorApply" data-alu-draft-apply="1"${applyAttrs}>Выбрать</button>
      </div>
    </div>`;
}

// Правка поля черновика (select data-alu-draft) — только state.aluDraft,
// проект не меняется до «Выбрать».
function libAluDraftEdit(el) {
  const f = el.dataset.aluDraft;
  if (ALU_DRAFT_KEYS.indexOf(f) < 0) return;
  aluDraftGet()[f] = el.value;
  aluDraftNormalize();
  renderLibraryPanel();
}

// «Выбрать» конструктора: alu*-поля черновика → секция (sec.alu*) или отсек
// (sec.doorZones[zi].alu*), возврат на экран, откуда открыли конструктор.
// Цель могла устареть, пока конструктор был открыт (модуль/секция удалены,
// отсеков стало меньше, вид фасада сменён не на алюминиевый) — тогда подбор
// снимается, Библиотека перерисовывается с короткой подсказкой, в проект
// ничего не пишется.
let libAluStaleNotice = '';
function libAluDraftApply() {
  const outer = aluCtorOuterTarget();
  const info = facadeTargetInfo(outer);
  const setAlu = !!(outer && outer.setAlu);
  const store = info && (info.ftId === 'alu' || setAlu)
    ? (info.zi == null ? info.sec : ensureDoorZone(info.sec, info.zi)) : null;
  // Свободная цель (активная секция) недоступна: модулей/секций нет или
  // секция открытая — кнопка и так неактивна, «цель пропала» тут ни к чему.
  const freeReason = !store && aluCtorUsesFreeTarget() ? aluFreeBlockReason() : null;
  if (freeReason) {
    if (freeReason !== 'noModule') {
      libAluStaleNotice = ALU_FREE_BLOCK_MSG[freeReason].hint;
      renderLibraryPanel();
    }
    return;
  }
  if (!store) {
    state.libPickTarget = null;
    libAluStaleNotice = 'Секция или отсек, для которых открывали конструктор, изменились. Откройте его заново из поля «Фасад».';
    renderLibraryPanel();
    return;
  }
  aluDraftNormalize();
  if (setAlu && info.ftId !== 'alu') {
    store.facadeType = 'alu';
    if (info.zi == null) delete store.glass;   // старый флажок не спорит с видом
  }
  ALU_DRAFT_KEYS.forEach((k) => { store[k] = state.aluDraft[k]; });
  libPickReturnToParams(outer, info);
}

// Толщина фасада секции — как построит ядро (engine.facadeMaterialOf: у
// МДФ/стекла — толщина выбранного материала, у alu — профиля), запасной
// вариант — паспортная толщина вида фасада.
function secFacadeThickness(sec, ftInfo) {
  const engine = window.Modul3D.engine;
  if (engine && typeof engine.facadeMaterialOf === 'function') {
    try {
      const fm = engine.facadeMaterialOf(sec, matFacadeProj());
      if (fm && Number(fm.thickness) > 0) return fm.thickness;
    } catch (err) { /* ниже — по виду фасада */ }
  }
  return ftInfo.thickness;
}

// Секции модуля показываются вкладками-«закладками» (как у moduleTabsBlock
// выше, но с горизонтальной прокруткой вместо переноса строк — при 5-6+
// секциях ряд скроллится по горизонтали, а не растягивает панель — и с
// крестиком-удалением только на РАСКРЫТОЙ вкладке, не на свёрнутых). Видна
// одновременно только ОДНА раскрытая секция — иначе панель превращается в
// длинную простыню при 2+ секциях. Какая секция раскрыта — хранится на самом
// объекте модуля (mod.activeSection), по аналогии с state.activeModule.
// Стеклянные ли полки в секции — как решает ядро (facadeTypeOf: у 'alu'
// по фактическому заполнению рамки, у остальных — FACADE_TYPES.glassInside).
function secGlassInside(sec, ftId, ftInfo) {
  if (ftId === 'alu') {
    const engine = window.Modul3D.engine;
    if (engine && typeof engine.aluFacadeOf === 'function') {
      try { return engine.aluFacadeOf(sec).fillType === 'glass'; } catch (err) { /* ниже — по списку UI */ }
    }
    return aluSecSettings(sec).fillIsGlass;
  }
  return !!(ftInfo && ftInfo.glassInside);
}


function renderSectionsList() {
  const mod = state.modules[state.activeModule];
  const list = document.getElementById('sectionsList');
  if (!mod || !list) return;      // пустой проект — секций нет

  // Клэмп индекса раскрытой секции — на случай, если секция, которая была
  // активна, успела исчезнуть (удаление секции, смена модуля, undo/redo),
  // тот же принцип, что и у клэмпа state.activeModule в deleteModule().
  if (!Number.isInteger(mod.activeSection)) mod.activeSection = 0;
  mod.activeSection = Math.max(0, Math.min(mod.activeSection, mod.sections.length - 1));
  // Конструктор алюм. фасада без явной цели ставит фасад в активную секцию —
  // подпись «Для: …» в Библиотеке должна следовать за переключением секций.
  refreshAluCtorTarget();
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
    const ftId = effFacadeTypeId(sec);
    const ftInfo = FACADE_TYPES[ftId] || FACADE_TYPES.ldsp;
    // Вид фасада и материал фасада секции выбираются на экране «Материалы»
    // (см. matFacadeFieldHtml, блок «Фасад» наверху экрана) — здесь, в
    // «Конструктиве модуля», дублировать эти же поля больше не нужно
    // (решение пользователя 2026-09-29). Из прежнего блока остаётся только
    // то, чего на «Материалы» нет: подсказка «сначала выберите дверь» для
    // секции без фасада и предупреждение про стеклянные полки внутри.
    const glassBlock = (secEffectiveFacades(sec).every((f) => f === 'open') && !sec.drawers)
      ? '<div class="sub"><div class="hint sec-facade-type-hint">Сначала выберите дверь — тогда появится вид фасада.</div></div>'
      : (secGlassInside(sec, ftId, ftInfo)
        ? '<div class="sub"><div class="hint">Полки в секции — стекло 6 мм на держателях с силиконовой пяткой.</div></div>'
        : '');

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
          <label>Открывание фасадов</label>
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
      // Вид фасада задан явно — старый флажок sec.glass (ранние сохранения)
      // больше не должен с ним спорить (ядро: facadeType || glass).
      if (f === 'facadeType') delete sec.glass;
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
// placementId — id КАРТОЧКИ (см. libModPlacementById), с которой кликнули, а
// не самого пресета — presetId может встречаться у нескольких карточек
// сразу (см. libModCopyCard). Пишем его на модуль как mod.libOrigin — по
// нему «Сохранить» контекстного меню модуля (см. showModuleMenu/
// libModSaveModule) находит, какую карточку заменить.
function addPresetToProject(catId, presetId, placementId) {
  const group = PRESETS.filter((g) => g.id === catId)[0];
  const item = group && group.items.filter((i) => i.id === presetId)[0];
  if (!item) return;
  // Имя модулю даёт проект — «Модуль N», как у добавленных вручную.
  const m = item.make();
  m.name = '';
  if (placementId) m.libOrigin = placementId;
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
      // Декор уходит и в «Материал фасада» (ЛДСП-фасады), и в «Видимую
      // боковину» — поля независимы (2026-09-26), здесь просто оба
      // получают прежний декор корпуса.
      if (state.decorCode !== white.code) {
        state.facadeDecorCode = state.decorCode;
        state.facadeMatCode = state.decorCode;
        // Толщина фасада наследует толщину прежнего декора корпуса — та же
        // синхронизация, что и при ручном выборе материала в Библиотеке.
        state.facadeThickness = state.bodyThickness;
      }
      state.decorCode = white.code;
      if (white.thickness) state.bodyThickness = white.thickness;
      // Материал ящиков кухни сюда не пишем: пустой sec.drawerDecorCode у
      // кухонного модуля = «0110 SM Белый» (effectiveDrawerDecorCode).
    }
  }
  insertModule(m);
}

// Клик по карточке «Базы модулей» БЕЗ presetId (см. libModCardHtml) —
// самостоятельный модуль (p.params) или комплект (p.kit), сохранённые
// «Сохранить»/«Сохранить как…»/«Добавить модуль» (см. libModSaveModule/
// libModSaveModuleAs/libModSaveProjectAsKit). Клонируем params/kit, чтобы
// вставленный в проект модуль не делил объект с эталоном в библиотеке —
// insertModule()/insertModulesBatch() дальше мутируют его (например,
// проставляют столешницу по умолчанию), тот же приём, что и у item.make() в
// addPresetToProject выше. Элементы комплекта libOrigin НЕ получают — одной
// карточке-комплекту соответствует сразу НЕСКОЛЬКО модулей, «Сохранить»
// (замена ровно ОДНОЙ карточки) для них не определено однозначно; доступно
// только «Сохранить как…» — она заведёт для такого модуля отдельную карточку.
function addLibModCardToProject(placementId) {
  const p = libModPlacementById(placementId);
  if (!p) return;
  if (Array.isArray(p.kit) && p.kit.length) {
    const mods = p.kit.map((k) => JSON.parse(JSON.stringify(k.params)));
    insertModulesBatch(mods);
  } else if (p.params) {
    const m = JSON.parse(JSON.stringify(p.params));
    m.libOrigin = placementId;
    insertModule(m);
  }
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

// Контекстное меню модуля: переименование + сохранение в «Базу модулей».
// Поворот переехал в HUD-меню в 3D (клик по модулю, см.
// ui-shell.js/rotateModule выше), удаление — в иконку в шапке программы
// (delBtn, см. ниже). Вызывается правой кнопкой по вкладке модуля в левом
// верхнем углу панели.
// «Сохранить» (замена карточки-происхождения текущими параметрами модуля) —
// видно, только если mod.libOrigin указывает на карточку, которая реально
// ещё существует в дереве (см. libModSaveModule/libModOriginTarget); иначе
// (модуль собран вручную либо карточка-происхождение с тех пор удалена)
// доступно только «Сохранить как…» (libModSaveModuleAs).
function showModuleMenu(modIndex, x, y) {
  closeModuleMenu();
  const mod = state.modules[modIndex];
  if (!mod) return;
  const canSave = !!(mod.libOrigin && libModPlacementById(mod.libOrigin));

  const menu = document.createElement('div');
  menu.id = 'moduleMenu';
  menu.className = 'ctx-menu';
  menu.style.left = Math.round(x) + 'px';
  menu.style.top = Math.round(y) + 'px';
  menu.innerHTML = `<input class="ctx-title ctx-title-input" id="ctxModName" type="text" value="${esc(mod.name)}">
    ${canSave ? '<button type="button" class="ctx-item" data-mm-save="1">Сохранить</button>' : ''}
    <button type="button" class="ctx-item" data-mm-save-as="1">Сохранить как…</button>`;
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

  const saveBtn = menu.querySelector('[data-mm-save]');
  if (saveBtn) saveBtn.addEventListener('click', () => { closeModuleMenu(); libModSaveModule(mod); });
  const saveAsBtn = menu.querySelector('[data-mm-save-as]');
  if (saveAsBtn) saveAsBtn.addEventListener('click', () => { closeModuleMenu(); libModSaveModuleAs(mod); });
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

// Карточки модулей внутри вкладки «Библиотека» (дерево категорий рисуется и
// обрабатывается общим кодом с «Материалами»/«Фурнитурой», см.
// initLibraryPanel/libTreeRowHtml) — левый клик по миниатюре добавляет
// модуль в проект, правый открывает плашку ✎+⇄× (см. openLibModCardMenu).
// renderLibraryPanel() зовёт это после каждой перерисовки вкладки «modules»
// — элементы .lib-item каждый раз новые, слушатели нужно вешать заново.
// data-preset есть только у карточек-ссылок на presets.js (см.
// libModCardHtml) — у самостоятельных карточек («Сохранить»/«Сохранить
// как…», см. большой комментарий над state.libModPlacements) его нет, левый
// клик по ним идёт отдельным путём (addLibModCardToProject).
function bindLibraryEvents() {
  document.querySelectorAll('.lib-item').forEach((b) => {
    b.addEventListener('click', () => {
      // Клик, которым браузер завершает перетаскивание миниатюры (см.
      // libModCardDragPointerUp/libModCardDragClickGuard), не должен ещё и
      // добавить модуль в проект.
      if (libModCardDragClickGuard) { libModCardDragClickGuard = false; return; }
      if (b.dataset.preset) {
        addPresetToProject(b.dataset.group, b.dataset.preset, b.dataset.placement);
      } else {
        addLibModCardToProject(b.dataset.placement);
      }
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openLibModCardMenu(e.clientX || 0, e.clientY || 0, b.dataset.placement);
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
  // Отметка верха навесного модуля (mountTopBlock). Пустое/неположительное —
  // возвращаем прежнее значение; история отмены — через recompute().
  on('m-mountTop', 'change', (e) => {
    const raw = String(e.target.value).trim();
    const x = Number(raw);
    if (raw === '' || !Number.isFinite(x) || x <= 0) {
      e.target.value = Number(mod.mountTop) > 0 ? mod.mountTop : wallMountTopDefault();
      return;
    }
    mod.mountTop = x;
    recompute();
  });
  // Блок «Задняя стенка» (backMountBlock): режим крепления и параметры паза.
  // Смена режима перерисовывает панель — поля паза видны только при «В паз».
  on('m-backMount', 'change', (e) => {
    const v = e.target.value;
    if (v === 'overlay' || v === 'groove') mod.backMount = v; else delete mod.backMount;
    // Поля паза заводим сразу с дефолтами — чтобы сохранённый модуль/проект
    // нёс явные числа, которые видит пользователь, а не «пусто».
    if (v === 'groove' && !mod.backGroove) mod.backGroove = backGrooveOf(mod);
    renderParamsPanel();
    recompute();
  });
  // Числа паза: пустое/отрицательное (у глубины — нулевое) значение не
  // пропускаем в движок — возвращаем в поле прежнее значение.
  const bindGrooveNum = (id, key, minExclusive) => {
    on(id, 'change', (e) => {
      const g = mod.backGroove = backGrooveOf(mod);
      const raw = String(e.target.value).trim();
      const x = Number(raw);
      const ok = raw !== '' && Number.isFinite(x) && (minExclusive ? x > 0 : x >= 0);
      if (!ok) { e.target.value = g[key]; return; }
      g[key] = x;
      recompute();
    });
  };
  bindGrooveNum('m-grooveOffset', 'offset', false);
  bindGrooveNum('m-grooveDepth', 'depth', true);
  bindGrooveNum('m-grooveEntry', 'entry', false);
  document.querySelectorAll('[data-back-groove-part]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const g = mod.backGroove = backGrooveOf(mod);
      g.parts[cb.dataset.backGroovePart] = cb.checked;
      // Предупреждение «паз не выбран» — без перерисовки панели.
      const warn = document.getElementById('backGrooveNoneWarn');
      if (warn) warn.hidden = backGrooveHasAnyPart(g.parts, backGrooveTopBlockedReason(mod));
      recompute();
    });
  });
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

  // «Направление текстуры» по группам (grainGroupsBlock): 'across' пишем,
  // 'auto' — удаляем ключ (нет ключа = «Авто», как ждёт движок).
  (window.Modul3D.engine.GRAIN_GROUPS || []).forEach((g) => {
    on('p-grain-' + g.id, 'change', (e) => {
      state.grainGroups = state.grainGroups || {};
      if (e.target.value === 'across') state.grainGroups[g.id] = 'across'; else delete state.grainGroups[g.id];
      recompute();
    });
  });

  // Плашки материалов экрана «Материалы» (см. matPickPlashkaHtml/
  // matFacadeFieldHtml): корпус/видимая боковина/задняя стенка — подбор в
  // Библиотеке по роли (openMaterialPicker), «Фасад» — по виду фасада
  // активной цели (openFacadeMaterialPicker; alu — конструктор). Запрос
  // СКОУПЛЕН на #paramsPanel (а не document) — у панели «Столешница» своя
  // привязка кнопки «Изменить» в bindCountertopEvents(); без скоупа клик ловил
  // бы ВТОРОЙ обработчик при каждом renderParamsPanel() (реальный баг такого
  // рода уже был найден на ревью 2026-09-06).
  const paramsPanelEl = document.getElementById('paramsPanel');
  if (paramsPanelEl) {
    paramsPanelEl.querySelectorAll('[data-mat-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const role = btn.dataset.matPick;
        if (role === 'facade') openFacadeMaterialPicker(matFacadeTarget(), 'materials');
        else if (role === 'part') openPartMaterialPicker();
        else if (role === 'hangerSystem') openHangerSystemPicker();
        else openMaterialPicker(role);
      });
    });
    // Переключатель цели «Секция N» / «Отсек K» поля «Фасад» — только UI.
    paramsPanelEl.querySelectorAll('[data-mat-facade-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.matFacadeTarget;
        setMatFacadeZone(v === 'sec' ? null : Number(v));
        renderParamsPanel();
        const fld = document.getElementById('matFacadeField');
        if (fld && fld.scrollIntoView) fld.scrollIntoView({ block: 'center' });
      });
    });
  }
  // Свой вид фасада отсека: пусто — «как у секции» (переопределение
  // удаляется). Материал отсека от прежнего вида не переносим — он станет
  // умолчанием нового вида (как решает engine.zoneFacadeSettings).
  on('p-zoneFacadeType', 'change', (e) => {
    const info = facadeTargetInfo(matFacadeTarget());
    if (!info || info.zi == null) return;
    const zone = ensureDoorZone(info.sec, info.zi);
    if (!zone) return;
    const v = e.target.value;
    if (v && FACADE_TYPES[v]) zone.facadeType = v; else delete zone.facadeType;
    delete zone.facadeMaterial;
    recompute();
    renderParamsPanel();
    const fld = document.getElementById('matFacadeField');
    if (fld && fld.scrollIntoView) fld.scrollIntoView({ block: 'center' });
  });
  // Вид фасада секции прямо на экране «Материалы модуля» — то же поле
  // sec.facadeType, что и select «Вид фасада» в «Конструктиве модуля».
  on('p-secFacadeType', 'change', (e) => {
    const info = facadeTargetInfo(matFacadeTarget());
    if (!info || info.zi != null) return;
    const v = e.target.value;
    if (!FACADE_TYPES[v]) return;
    info.sec.facadeType = v;
    delete info.sec.glass;
    recompute();
    renderParamsPanel();
    const fld = document.getElementById('matFacadeField');
    if (fld && fld.scrollIntoView) fld.scrollIntoView({ block: 'center' });
  });
  on('p-facadeApplyAll', 'click', applyFacadeToWholeProject);

  // Добавление секции переехало в ряд вкладок секций (кнопка «+» рядом с
  // ними) — обработчик делегирован внутри renderSectionsList() на
  // [data-add-section], как и переключение/удаление секций, поскольку эта
  // кнопка перерисовывается вместе со списком, а не живёт статическим id.

  // Экран «Деталь»: переключение конкретной детали, когда деталей одного
  // вида в модуле несколько (крыша из двух планок) — см. partBlock/
  // overridablePartCandidates. Смена выбора ничего не меняет в проекте,
  // только какая деталь сейчас редактируется — recompute() не нужен.
  on('partSubIndex', 'change', (e) => {
    const sp = state.selectedPart;
    if (!sp) return;
    sp.subIndex = Number(e.target.value) || 0;
    // Выбор в списке главнее ключа кликнутой детали: подменяем его ключом
    // выбранной, иначе resolveSelectedPart (partKey первым) вернул бы прежнюю.
    const cand = resolveSelectedPart(mod).candidates[sp.subIndex];
    if (cand) { sp.partKey = cand.key; sp.side = cand.side || sp.side; }
    renderParamsPanel();
    // Подсветка в 3D идёт за выбранной деталью (viewOpts → resolveSelectedPart).
    if (viewer && currentModel) viewer.render(currentModel, viewOpts());
  });

  // Экран «Деталь» → «Направление текстуры» ОДНОЙ детали (partGrainField).
  // Пишем в mod.grainOverrides по ключу детали из data-key; пустое значение —
  // «как у группы», ключ удаляется. recompute() запишет и историю (Undo).
  on('partGrain', 'change', (e) => {
    const key = e.target.dataset.key;
    if (!key) return;
    const v = e.target.value;
    mod.grainOverrides = mod.grainOverrides || {};
    if (v === 'along' || v === 'across') mod.grainOverrides[key] = v; else delete mod.grainOverrides[key];
    recompute();
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
    // Материал детали выбирается в Библиотеке (плашка #partMaterial →
    // openPartMaterialPicker → libPickMaterial, роль 'partMaterial'). Здесь —
    // только «Сбросить к материалу модуля»: снимаем материал и толщину этой
    // детали (отверстия и прочие правки остаются).
    on('partMaterialReset', 'click', () => {
      const ov = mod.partOverrides && mod.partOverrides[key];
      if (!ov) return;
      delete ov.materialOverride;
      delete ov.thicknessOverride;
      if (!Object.keys(ov).some((k) => k !== 'extraHoles' || (Array.isArray(ov.extraHoles) && ov.extraHoles.length))) {
        delete mod.partOverrides[key];
      }
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
        // Пустое значение — пункт «Как корпус»/«По умолчанию»: снова авто.
        sec.drawerDecorCode = e.target.value || null;
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
  // uid модулей — до снимка истории, чтобы он попал и в историю, и в файл.
  ensureModuleUids();
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
    decor: DECORS.find(d => d.code === state.decorCode) || defaultDecorObj(),
    // «Видимая боковина» может ссылаться и на МДФ-панель из FACADE_MATERIALS.
    facadeDecor: findAnyMaterialByCode(state.facadeDecorCode)
      || DECORS.find(d => d.code === state.decorCode) || defaultDecorObj(),
    // «Материал фасада» (2026-09-26) — декор ЛДСП-фасадов по умолчанию,
    // независимый от «Видимой боковины». Читает engine.js как proj.facadeMat.
    facadeMat: findAnyMaterialByCode(state.facadeMatCode)
      || DECORS.find(d => d.code === state.decorCode) || defaultDecorObj(),
    backMaterial: BACK_MATERIALS.find(d => d.code === state.backCode) || BACK_MATERIALS[0],
    worktopDepth: state.worktopDepth,
    jointType: state.jointType,
    // Способ соединения столешниц на угловом стыке — общий на проект (панель
    // «Столешница»), читает joinCountertopSeams() в engine.js.
    countertopCornerJoint: state.countertopCornerJoint,
    // Направление текстуры по группам деталей (блок «Направление текстуры»
    // на экране параметров) — читает applyGrainDirection() в engine.js.
    grainGroups: state.grainGroups,
    // Навес верхних модулей (hangerSystemBlock) — engine.js applyWallHanger.
    hangerSystem: state.hangerSystem,
    modules: state.modules.map(m => ({
      // uid — только для якорей ручной разметки (engine.js: part.moduleUid)
      uid: m.uid,
      name: m.name, width: m.width, height: m.height, depth: m.depth,
      rotation: m.rotation || 0, corner: !!m.corner, family: m.family || 'custom',
      topType: m.topType, railWidth: m.railWidth, noBack: !!m.noBack,
      backMount: m.backMount, backGroove: m.backGroove, wallHung: m.wallHung,
      // Отметка верха навесного модуля от пола (engine.js, mountBottom).
      mountTop: m.mountTop,
      blindPanel: !!m.blindPanel, blindStrip: m.blindStrip,
      leftSide: m.leftSide, rightSide: m.rightSide,
      base: m.baseType === 'plinth'
        ? { type: 'plinth', plinthHeight: m.plinthHeight }
        : { type: m.baseType, legHeight: m.legHeight },
      legType: m.legType || 'metal',
      sections: engineSectionsOf(m),
      // Ручные правки конкретных деталей (толщина/материал/доп. отверстия) —
      // см. applyPartOverrides() в engine.js и partBlock()/bindPanelEvents()
      // выше, где этот объект заполняется с экрана «Деталь».
      partOverrides: m.partOverrides || {},
      // Направление текстуры отдельных деталей модуля (поле на экране «Деталь»):
      // { [grainKey]: 'along' | 'across' }. Отдельно от partOverrides — оно не
      // должно помечать деталь «изменённой вручную».
      grainOverrides: m.grainOverrides || {},
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
  state.facadeMatCode = project.facadeMat.code;
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
  // Ручной разметке — модель этого пересчёта (живые размеры для count()).
  if (markupApi && markupApi.setModel) markupApi.setModel(currentModel);

  // Чертежи, деталировка и спецификация — лениво: строится только та
  // вкладка, что сейчас на виду, остальные помечаются устаревшими и
  // соберутся при показе (см. invalidateDocsTabs/ensureTabBuilt).
  invalidateDocsTabs();
  renderWarnings(currentModel.warnings);
  renderDrillLegend();
  refreshAluCtorGlassHint();
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
  // Открытый редактор детали перерисовывается по новой модели (геометрия,
  // присадка и его лист разметки — от актуальной детали).
  if (state.partEditorOpen) refreshPartEditorOverlay();
  autosaveProject();
}

// Ортогональные виды: модель остаётся ЦВЕТНОЙ 3D-сценой, а размеры рисуются
// прозрачным SVG-слоем поверх неё. Координаты берутся проецированием точек
// модели через камеру (viewer.project), поэтому размеры точно ложатся на
// изделие в любом виде и при любом зуме.
const OVERLAY_VIEWS = ['front', 'side', 'top'];
function renderViewOverlay() {
  const el = document.getElementById('viewOverlay');
  if (!el) return;
  // Размеры поверх сцены умеем рисовать только для видов спереди/справа/
  // сверху. Остальные плоские виды гизмы (слева/сзади/снизу) — без размеров:
  // иначе ветка «сверху» легла бы на изделие с неверной стороны.
  if (!viewer || OVERLAY_VIEWS.indexOf(state.view) < 0 || !currentModel || !currentModel.modules.length) {
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
    // Навесной модуль поднят на свою отметку (mod.offsetY — низ от пола):
    // его ширина — по его низу, подпись — над его верхом.
    for (const mod of m.modules) {
      const y0 = Number(mod.offsetY) || 0;
      if (m.modules.length > 1) {
        const md = mod.dims;
        g += hDim(P(mod.offsetX - md.W / 2, y0, zf), P(mod.offsetX + md.W / 2, y0, zf), 24, `${Math.round(md.W)}`);
      }
      // Подпись — над верхом САМОГО модуля (низ + его высота). Раньше у
      // напольных бралась высота всего проекта d.H, и при верхнем ряде
      // подписи нижних модулей налезали на подписи верхних.
      const yTopMod = y0 + (Number(mod.dims.H) || 0);
      g += txtEl(P(mod.offsetX, yTopMod, zf), mod.name, -12);
    }
    // фасады видны — размечаем сами фасады; скрыты — внутреннюю начинку
    g += state.hideFacades ? innerHeightDims(P, zf) : facadeDims(P, zf);
  } else if (state.view === 'side') {
    const xEdge = -d.W / 2;                            // ближняя боковина
    g += hDim(P(xEdge, 0, -d.D / 2), P(xEdge, 0, d.D / 2), 46, `${Math.round(d.D)}`);
    g += vDim(P(xEdge, 0, zf), P(xEdge, d.H, zf), -46, `${Math.round(d.H)}`);
    if (state.hideFacades) g += innerHeightDims(P, zf);
  } else if (state.view === 'top') {
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
    // Отметки md.* — в координатах модуля; навесной поднят на mod.offsetY.
    const y0 = Number(mod.offsetY) || 0;
    for (let i = 0; i < md.n; i++) {
      const secL = md.sections[i];
      const x0 = mod.offsetX + secL.x0;
      const cx = x0 + secL.w / 2;

      // отметки: дно, низ/верх каждой полки и ящика, крыша
      const marks = [y0 + md.innerBottomY];
      for (const p of m.partsRaw) {
        if (p.module !== mod.name) continue;
        const b = p.boxes[0];
        if (b.x < x0 - 1 || b.x > x0 + secL.w + 1) continue;
        if (p.kind === 'shelf') { marks.push(b.y - b.h / 2, b.y + b.h / 2); }
        if (p.kind === 'drawerFront') { marks.push(b.y - b.h / 2, b.y + b.h / 2); }
      }
      marks.push(y0 + md.innerBottomY + md.innerH);
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
    xray: state.xray,
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

// ---------------------------------------------------------------------------
// Режимы 3D-вида: «Прозрачный режим» (xray), «Скрыть фасады», «Проверка
// присадки». Независимы и совмещаются в любых сочетаниях. Две пары кнопок —
// в панели «Студия» (#xrayBtn/#hideFacadesBtn/#drillCheckBtn) и иконки на
// плавающей панели (#vtXrayBtn/#vtHideFacadesBtn/#vtDrillCheckBtn) — зовут
// одни и те же функции, поэтому состояние у них всегда общее. Модель заново
// не строится: режимы влияют только на то, КАК рисуются уже посчитанные
// детали (viewer.render с viewOpts), а «Скрыть фасады» — ещё и на чертежи.
// ---------------------------------------------------------------------------
function syncViewModeButtons() {
  const set = (id, on, text) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('active', !!on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (text) el.textContent = text;
  };
  set('xrayBtn', state.xray);
  set('vtXrayBtn', state.xray);
  set('hideFacadesBtn', state.hideFacades, state.hideFacades ? 'Показать фасады' : 'Скрыть фасады');
  set('vtHideFacadesBtn', state.hideFacades);
  const vf = document.getElementById('vtHideFacadesBtn');
  if (vf) vf.title = state.hideFacades ? 'Показать фасады' : 'Скрыть фасады';
  set('drillCheckBtn', state.drillCheck);
  set('vtDrillCheckBtn', state.drillCheck);
}

function rerenderViewModes() {
  if (viewer && currentModel) viewer.render(currentModel, viewOpts());
  syncViewModeButtons();
}

function toggleXray() {
  state.xray = !state.xray;
  rerenderViewModes();
}

function toggleHideFacades() {
  state.hideFacades = !state.hideFacades;
  rerenderViewModes();
  // От «скрыть фасады» зависят только чертежи — помечаем устаревшей одну
  // эту вкладку; если она открыта, перерисуется тут же, как раньше.
  invalidateDocsTabs(['drawings']);
}

function toggleDrillCheck() {
  state.drillCheck = !state.drillCheck;
  rerenderViewModes();
  renderDrillLegend();
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
      // Отверстие сквозь тонкую стенку алюм. профиля (throughWall, петля
      // рамки aluHingeScrew): глубина — толщина стенки, с зенковкой.
      const spec = h.throughWall
        ? `Ø${h.d}${h.csk ? `, зенк.${h.cskAngle ? ` ${h.cskAngle}°` : ''} до Ø${h.csk}` : ''} — сквозь тыльную стенку профиля ${h.depth || 0}`
        : `Ø${h.d} · ${depth} · ${where}`;
      const key = `${h.kind}|${spec}`;
      count.set(key, (count.get(key) || 0) + 1);
    }
  }
  const grooves = new Map();
  for (const p of (currentModel.partsRaw || [])) {
    for (const g of (p.grooves || [])) {
      // Паз под механизм петли алюм. рамки — свой вид (фильтр по data-kind,
      // как у отверстий), подпись из note ядра; прочие — под заднюю стенку.
      const key = g.kind === 'aluHingeSlot'
        ? `aluHingeSlot|${g.note || `Паз ${g.w}`}${g.throughWall ? ` — сквозь тыльную стенку профиля ${g.depth || 0}` : ''}`
        : `|паз ${g.w}×${g.depth} мм`;
      grooves.set(key, (grooves.get(key) || 0) + 1);
    }
  }
  // Сквозные вырезы (part.notches: выпил под шину, вырез под крюк навески) —
  // своей строкой по виду и размеру; фильтр по data-kind, как у отверстий.
  for (const p of (currentModel.partsRaw || [])) {
    for (const n of (p.notches || [])) {
      const w = Math.round(Math.abs(n.x1 - n.x0) * 10) / 10;
      const h = Math.round(Math.abs(n.y1 - n.y0) * 10) / 10;
      const key = `${n.kind}|вырез ${w}×${h} · насквозь`;
      count.set(key, (count.get(key) || 0) + 1);
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
  + Array.from(grooves.keys()).map((key) => {
    const [kind, spec] = key.split('|');
    if (!kind) {
      return `<div class="dl-row"><i style="background:#888"></i>`
        + `<span>Паз под заднюю стенку<br><small>${esc(spec)}</small></span>`
        + `<b>${grooves.get(key)}</b></div>`;
    }
    const c = ((DRILL_COLOR[kind] || 0x888888)).toString(16).padStart(6, '0');
    const on = state.drillFilter === kind ? ' on' : '';
    return `<div class="dl-row${on}" data-kind="${esc(kind)}" title="Показать только эту присадку">`
      + `<i style="background:#${c}"></i>`
      + `<span>${esc(DRILL_TITLE[kind] || 'Паз под механизм петли')}<br><small>${esc(spec)}</small></span>`
      + `<b>${grooves.get(key)}</b></div>`;
  }).join('');

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

// «Сырая» разметка чертежей — ровно то, что вернул buildDrawings, БЕЗ обёртки
// масштаба (ui-shell.js, раздел 7в). Печать чертежей берёт её, а не
// innerHTML вкладки: печать не должна зависеть от масштаба на экране.
let drawingsRawHtml = '';

function renderDrawings(model) {
  const el = document.getElementById('tab-drawings');
  let html;
  try {
    html = buildDrawings(model, !state.hideFacades);
  } catch (err) {
    console.error('Drawings render failed:', err);
    html = `<div style="color:#a33;font-size:13px;padding:10px">Не удалось построить чертежи: ${esc(err.message)}</div>`;
  }
  drawingsRawHtml = html;
  // Чертежи пишутся в обёртке масштаба (ui-shell.js: setDrawingsContent —
  // держит масштаб и позицию прокрутки при перерисовке). Нет ui-shell — пишем
  // разметку как есть: чертежи те же, просто без масштаба.
  const shell = window.Modul3D.uiShell;
  if (shell && typeof shell.setDrawingsContent === 'function' && shell.setDrawingsContent(html)) return;
  el.innerHTML = html;
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
    <input type="text" class="df-search-input" placeholder="Поиск…" autocomplete="off">
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
  // Строка поиска — ЖИВОЙ фильтр строк .df-check-row внутри .df-values-list
  // по подстроке (регистронезависимо, по тому же тексту, что видит
  // пользователь в <span>). Только показывает/прячет строки — сами чекбоксы/
  // выбор она не трогает: commitHiddenValues ниже читает ВСЕ valueCbs, а не
  // только видимые, поэтому скрытый поиском выбор не теряется. «(Выделить
  // всё)» (.df-check-all) сознательно вне .df-values-list — под фильтр не
  // попадает и остаётся видимой всегда.
  const searchInput = menu.querySelector('.df-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();
      menu.querySelectorAll('.df-values-list .df-check-row').forEach((row) => {
        const span = row.querySelector('span');
        const text = (span ? span.textContent : '').toLowerCase();
        // .df-check-row держит "display: flex !important" в style.css (нужен
        // для выравнивания чекбокса — !important там намеренно, см. правило)
        // — обычный row.style.display НЕ может его перебить, строка осталась
        // бы видимой несмотря на "скрытие" (проверено вживую в браузере:
        // inline-стиль выставлялся, а строка не пряталась). Класс с тем же
        // !important (.df-search-hidden ниже) перебивает правило корректно.
        row.classList.toggle('df-search-hidden', !(!q || text.indexOf(q) >= 0));
      });
    });
  }

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
  // Длина/Ширина/кромки — в порядке деталировки (первая цифра — вдоль текстуры,
  // при «Поперёк» цифры и кромки L↔S переставлены движком: cutLength/cutWidth/
  // cutEdging). У деталей без направления они равны length/width/edging.
  // Фильтр и сортировка столбцов работают по этим же значениям (vals).
  const edg = r.cutEdging || r.edging || {};
  return [
    String(r.num), r.module || '', r.name, r.section,
    `${materialName(r.material)}, ${r.thickness} мм`,
    String(r.cutLength != null ? r.cutLength : r.length),
    String(r.cutWidth != null ? r.cutWidth : r.width), String(r.qty),
    edg.long1 || '—', edg.long2 || '—', edg.short1 || '—', edg.short2 || '—',
    r.grainLabel || (r.grainDirection ? 'да' : 'нет'), r.note || '',
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
  // Цена/сумма может быть null — «цену уточняйте» (петли для алюм. рамки,
  // строки алюминиевых фасадов, см. specification.js): показываем «—» и
  // пометку row.note, 0 не подставляем.
  const money = (v) => (v === null || v === undefined ? '—' : v);
  const noteHtml = (r) => (r && r.note ? `<div class="spec-note">${esc(r.note)}</div>` : '');
  const hwRows = spec.hardware.map((h, i) =>
    `<tr><td>${i + 1}</td><td>${esc(h.name)}${noteHtml(h)}</td><td>${esc(h.article || '')}</td><td>${h.qty} ${esc(h.unit || '')}</td><td>${money(h.price)}</td><td>${money(h.sum)}</td></tr>`).join('');
  const aluRows = (spec.aluFacades || []).map((r, i) => {
    const qty = r.qty === null || r.qty === undefined ? '—' : `${r.qty} ${esc(r.unit || '')}`;
    // row.bars — сколько купить хлыстов профиля / отрезков уплотнителя
    // (specification.js). Показываем в «Кол-во»; та же цифра в пометке
    // («хлыстов по 5.8 м: 2», «продаётся по 3 м: 4 шт») тогда не повторяется.
    const barsRe = /^(хлыстов|палок) по [\d.,]+ м: \d+$|^продаётся по [\d.,]+ м: \d+ шт$/;
    const barsTxt = aluBarsLabel(r);
    const note = barsTxt ? (r.note || '').split('; ').filter((t) => !barsRe.test(t)).join('; ') : r.note;
    const extra = (r.mode === 'buy' && r.count ? ` <span class="dim">(${r.count} шт)</span>` : '')
      + (barsTxt ? `<div class="dim">${esc(barsTxt)}</div>` : '');
    const mode = r.mode === 'own' ? 'своё изготовление' : 'покупной';
    return `<tr><td>${i + 1}</td><td>${esc(r.name)}${noteHtml({ note })}</td><td>${esc(r.article || '')}</td><td>${esc(mode)}</td><td>${qty}${extra}</td><td>${money(r.price)}</td><td>${money(r.sum)}</td></tr>`;
  }).join('');
  const unpricedN = Array.isArray(spec.unpricedItems) ? spec.unpricedItems.length : 0;
  const incompleteHtml = spec.totalIncomplete
    ? ` <span class="spec-total-note" title="${esc((spec.unpricedItems || []).join('\n'))}">без учёта позиций без цены (${unpricedN})</span>`
    : '';
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
    (aluRows ? section('5. Алюминиевые фасады', aluRows, ['№', 'Позиция', 'Артикул', 'Способ', 'Кол-во', `Цена, ${cur}`, `Сумма, ${cur}`]) : '') +
    `<div class="total-line">ИТОГО: ${spec.totalCost.toLocaleString('ru-RU')} ${cur}${incompleteHtml}</div>`
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

// ЛЕНИВАЯ СБОРКА ДОКУМЕНТОВ. Чертежи/деталировка/спецификация раньше
// строились на КАЖДЫЙ recompute(), даже когда полоса документов свёрнута.
// При 8 модулях один только SVG чертежей весит под 200 КБ разметки: на
// десктопе это терпимо, а на телефоне парсинг и память заметно тормозят
// добавление модуля — и всё ради разметки, которую никто не видит. Теперь
// recompute() только помечает вкладку устаревшей, а собирается она в момент
// показа. ЧТО именно рисуется — не изменилось, изменилось только КОГДА.
const DOCS_TABS = ['drawings', 'detailing', 'spec'];
const docsTabsDirty = { drawings: true, detailing: true, spec: true };

// «На виду» — это раскрытая полоса документов (класс open на .results ставит
// и setDocsTab, и ui-shell при открытии панели «Документы») И выбранная
// именно эта вкладка: у свёрнутой полосы класс active всё равно висит на
// последней открытой вкладке, по нему одному судить нельзя.
function isDocsTabVisible(name) {
  const box = document.querySelector('.results');
  if (!box || !box.classList.contains('open')) return false;
  const panel = document.getElementById('tab-' + name);
  return !!(panel && panel.classList.contains('active'));
}

// Собирает вкладку, если она устарела. Зовётся при показе вкладки и
// принудительно — перед тем как кто-то прочитает готовый DOM вкладки
// (печать чертежей, dev-прогон tools/smoke.js). Пока модель не построена
// (самый первый проход, до recompute()), строить нечего: пометка
// «устарела» сохраняется и вкладка соберётся позже.
function ensureTabBuilt(name) {
  if (!docsTabsDirty[name]) return;
  if (name === 'spec') {
    if (!currentSpec) return;
    renderSpecTable(currentSpec);
  } else if (name === 'drawings') {
    if (!currentModel) return;
    renderDrawings(currentModel);
    // Общий вид пересобран — видимых ручных размеров могло стать меньше/
    // больше (модуль удалён или возвращён Ctrl+Z): обновить «Очистить всё».
    syncMarkupUI();
  } else if (name === 'detailing') {
    if (!currentModel) return;
    renderDetailingTable(currentModel);
  } else {
    return;
  }
  docsTabsDirty[name] = false;
}

// Досбор той вкладки, что открыта прямо сейчас. Нужен не только после
// пересчёта, но и когда панель «Документы» открывают мимо setDocsTab —
// кнопкой HUD, горячей клавишей или восстановлением состояния при загрузке
// (ui-shell.js: setResultsOpen → мост window.Modul3D.app).
function ensureVisibleDocsTabBuilt() {
  DOCS_TABS.forEach((n) => { if (isDocsTabVisible(n)) ensureTabBuilt(n); });
}

// Помечает вкладки устаревшими и сразу пересобирает открытую: пользователь,
// стоящий на «Деталировке» и меняющий габарит, обязан видеть свежие числа
// немедленно, без переключения туда-обратно.
function invalidateDocsTabs(names) {
  const list = names || DOCS_TABS;
  // Поповер фильтра деталировки ссылается на значения прошлого рендера, и
  // закрывал его раньше сам renderDetailingTable на каждом пересчёте.
  // Теперь таблица может и не перестроиться (вкладка скрыта) — закрываем
  // здесь, чтобы поведение осталось прежним.
  if (list.indexOf('detailing') !== -1) closeColumnFilterMenu();
  list.forEach((n) => { docsTabsDirty[n] = true; });
  ensureVisibleDocsTabBuilt();
}

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
  // Содержимое собираем ровно здесь, в момент показа: пока вкладка свёрнута,
  // её разметка намеренно устаревшая (см. docsTabsDirty выше). Строим до
  // прокрутки к началу, чтобы scrollTop попал уже на свежую разметку.
  if (open) ensureTabBuilt(name);
  if (open && panel) {
    panel.scrollTop = 0;                       // документы всегда с начала
    panel.scrollLeft = 0;                      // и по горизонтали — после масштаба >100%
    if (panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest' });
  }
  if (viewer && viewer.resize) viewer.resize();  // 3D перестроить под новую высоту
  syncMarkupUI();
}

// ---------------------------------------------------------------------------
// Ручная разметка чертежа общего вида (src/markup.js)
// ---------------------------------------------------------------------------
// Кнопки — в полосе вкладок «Документы» (index.html #markupTools). Режим
// имеет смысл только пока на виду вкладка «Чертежи»: при переходе на другую
// вкладку или закрытии панели «Документы» он выключается сам, чтобы
// разметка не перехватывала клики и клавиши (Delete/Esc) в остальном
// приложении. Размеры не пересчитывают модель — recompute() не нужен.
// Третий законный контекст разметки — 3D-вьювер в плоском виде (спереди,
// справа, слева, сзади, сверху, снизу): размеры ставятся прямо поверх сцены
// (оверлей рисует viewer.js по API markup.js). В перспективе ('iso') — нет.
// Список видов — локальный: syncMarkupUI зовётся раньше, чем объявлен
// VIEW_NAMES ниже (initMarkupUI на загрузке).
function isFlat3DView() {
  if (!viewer) return false;
  return ['front', 'side', 'left', 'back', 'top', 'bottom'].indexOf(state.view) >= 0;
}

// Откуда включён режим разметки: 'drawings' (кнопка вкладки «Чертежи»),
// 'editor' (кнопка в окне редактора детали), '3d' (кнопка на панели видов
// 3D) или null (выключен). Режим живёт, пока на виду контекст СВОЕГО
// источника, и не «переезжает» молча в другой: иначе, например, режим с
// чертежей после закрытия «Документов» в плоском 3D-виде продолжал бы
// перехватывать ЛКМ, и модуль переставал бы выбираться.
var markupOrigin = null;   // var: syncMarkupUI зовётся и до этой строки (загрузка)
function markupOriginVisible(origin) {
  if (origin === 'drawings') return isDocsTabVisible('drawings');
  if (origin === 'editor') return !!state.partEditorOpen;
  if (origin === '3d') return isFlat3DView();
  return false;
}

function syncMarkupUI() {
  if (!markupApi) return;
  const drawingsOn = isDocsTabVisible('drawings');
  const editorOn = !!state.partEditorOpen;
  const view3dOn = isFlat3DView();
  // Пропал контекст источника включения — режим гаснет.
  if (markupApi.isActive() && !markupOriginVisible(markupOrigin)) markupApi.setActive(false);
  // Выключен кем угодно (загрузка проекта, Esc, …) — источник забываем.
  if (!markupApi.isActive()) markupOrigin = null;
  const tools = document.getElementById('markupTools');
  if (tools && tools.style) tools.style.display = drawingsOn ? '' : 'none';
  const on = markupApi.isActive();
  const btn = document.getElementById('markupToggle');
  if (btn) {
    btn.classList.toggle('active', on);
    if (btn.setAttribute) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  const pane = document.getElementById('tab-drawings');
  if (pane) pane.classList.toggle('markup-on', on && drawingsOn);
  const edBtn = document.getElementById('partEditorMarkupToggle');
  if (edBtn) {
    edBtn.classList.toggle('active', on);
    if (edBtn.setAttribute) edBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  const edCanvas = document.getElementById('partEditorCanvas');
  if (edCanvas) edCanvas.classList.toggle('markup-on', on && editorOn);
  // Кнопка на панели режимов 3D-вида: доступна только в плоском виде.
  const vtBtn = document.getElementById('vtMarkupBtn');
  const on3d = on && markupOrigin === '3d' && view3dOn;
  if (vtBtn) {
    vtBtn.disabled = !view3dOn;
    vtBtn.classList.toggle('active', on3d);
    if (vtBtn.setAttribute) vtBtn.setAttribute('aria-pressed', on3d ? 'true' : 'false');
  }
  // Вьювер сам рисует оверлей разметки и снимает выбор модуля ЛКМ, пока
  // разметка в 3D включена — только когда режим включён именно в 3D.
  // (Готовые размеры в плоском 3D-виде вьювер показывает всегда сам.)
  if (viewer && typeof viewer.setMarkupMode === 'function') {
    try { viewer.setMarkupMode(on3d); } catch (err) { console.error('viewer.setMarkupMode failed:', err); }
  }
  const clr = document.getElementById('markupClear');
  if (clr) {
    if (clr.style) clr.style.display = on ? '' : 'none';
    clr.disabled = !(markupApi.count && markupApi.count());
  }
}

function initMarkupUI() {
  const tools = document.getElementById('markupTools');
  if (!markupApi) {
    if (tools && tools.style) tools.style.display = 'none';
    const vt = document.getElementById('vtMarkupBtn');
    if (vt && vt.style) vt.style.display = 'none';
    return;
  }
  const btn = document.getElementById('markupToggle');
  if (btn) btn.addEventListener('click', () => {
    // Режим уже включён, но из другого источника (3D) — не выключаем, а
    // «привязываем» к чертежам: теперь он живёт, пока видна вкладка.
    const on = !(markupApi.isActive() && markupOrigin === 'drawings');
    // Включать разметку без открытого чертежа бессмысленно — сначала
    // показываем вкладку «Чертежи» (она же соберёт общий вид).
    if (on && !isDocsTabVisible('drawings')) setDocsTab('drawings', false);
    markupApi.setActive(on);
    markupOrigin = on ? 'drawings' : null;
    syncMarkupUI();
  });
  // Та же разметка, но прямо в 3D (плоские виды). Данные отдельные от
  // чертежей (лист 'view3d', решение пользователя 2026-09-28),
  // источник включения — свой ('3d'); в перспективе кнопка недоступна.
  const vtBtn = document.getElementById('vtMarkupBtn');
  if (vtBtn) vtBtn.addEventListener('click', () => {
    if (!isFlat3DView()) { syncMarkupUI(); return; }
    // Включён с чертежей/редактора — переключаем источник на 3D, не гасим.
    const on = !(markupApi.isActive() && markupOrigin === '3d');
    markupApi.setActive(on);
    markupOrigin = on ? '3d' : null;
    syncMarkupUI();
  });
  const clr = document.getElementById('markupClear');
  if (clr) clr.addEventListener('click', () => {
    const n = markupApi.count ? markupApi.count() : 0;
    if (!n) return;
    // confirm в некоторых встроенных превью подавлен (возвращает false или
    // его нет вовсе) — не падаем; там просто ничего не удаляется.
    let ok = false;
    try { ok = typeof window.confirm === 'function' && !!window.confirm(`Удалить все свои размеры со всех чертежей (${n} шт.)?`); }
    catch (err) { ok = false; }
    if (!ok) return;
    markupApi.clearAll();
    syncMarkupUI();
  });
  // Размер добавлен/удалён/передвинут — это правка проекта, но НЕ параметр
  // изделия: recompute() не нужен (модель не меняется). Пишем шаг истории
  // отмены, автосохраняем и пересобираем ТОЛЬКО чертежи — рамка листа
  // (drawings.js: svgFit) считается при сборке, и новый размер за краем
  // прежней рамки иначе обрезался бы.
  // Техническая миграция старых записей разметки при сборке чертежа (форма
  // записи, не смысл) — не шаг отмены: переписываем верхний снимок истории
  // на месте, иначе следующий pushHistory() добавил бы «пустой» шаг.
  if (markupApi.onMigrate) markupApi.onMigrate(() => {
    if (history.past.length) history.past[history.past.length - 1] = snapshot();
  });
  if (markupApi.onChange) markupApi.onChange(() => {
    pushHistory();
    updateHistoryButtons();
    autosaveProject();
    invalidateDocsTabs(['drawings']);
    refreshPartEditorOverlay();
    syncMarkupUI();
  });
  // Панель «Документы» закрывают и мимо setDocsTab (крестик, Esc, клавиша D,
  // открытие другой панели — ui-shell.js ставит/снимает класс open на
  // .results) — ловим смену класса, чтобы режим разметки выключился и там.
  const box = document.querySelector('.results');
  if (box && window.MutationObserver) {
    new MutationObserver(syncMarkupUI).observe(box, { attributes: true, attributeFilter: ['class'] });
  }
  syncMarkupUI();
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => setDocsTab(btn.dataset.tab, true));
});
// На старте документы свёрнуты — 3D во весь экран.
setDocsTab('drawings', false);
const docsBox = document.querySelector('.results');
if (docsBox) docsBox.classList.remove('open');
initMarkupUI();

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
  // Печать читает готовую разметку вкладки, а вкладка может быть свёрнутой
  // и потому устаревшей (см. docsTabsDirty) — собираем принудительно, иначе
  // в печать уйдёт пустая или старая страница. Пересобираем ВСЕГДА: ручная
  // разметка (src/markup.js) и размер её шрифта меняются без recompute(),
  // прямо в DOM, а drawingsRawHtml — снимок с прошлой сборки.
  docsTabsDirty.drawings = true;
  ensureTabBuilt('drawings');
  // Сырая разметка чертежей (без обёртки масштаба) — печатается всегда в
  // стандартном виде, что бы ни стояло на экране.
  const html = drawingsRawHtml;
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
// Вид камеры: 'front' | 'side' (справа) | 'left' | 'back' | 'top' | 'bottom' |
// 'iso'. Единая точка программного переключения вида (горячие клавиши в
// ui-shell.js, dev-прогон tools/smoke.js). Жесты на гизме идут мимо —
// через viewer.onViewChange (см. initHeaderControls).
// ---------------------------------------------------------------------------
const VIEW_NAMES = ['front', 'side', 'left', 'back', 'top', 'bottom', 'iso'];
function applyView(name) {
  if (VIEW_NAMES.indexOf(name) < 0) name = 'iso';
  state.view = name;
  if (viewer) viewer.setView(name);
  renderViewOverlay();
  syncMarkupUI();   // разметка в 3D — только в плоских видах
}

// ---------------------------------------------------------------------------
// Кнопки шапки: скрытие фасадов, отмена/повтор; синхронизация вида с гизмой
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

  // Виды камеры переключаются навигационной гизмой в углу 3D-сцены (её
  // рисует viewer.js, см. ViewGizmo) и горячими клавишами 1–4 (ui-shell.js
  // через window.Modul3D.app.setView → applyView). Гизма сама уже повернула
  // камеру, поэтому здесь только синхронизируем state.view и размеры поверх
  // сцены — без повторного viewer.setView (иначе сбился бы ракурс, с которого
  // пользователь потянул гизму в 3D).
  if (viewer) {
    viewer.onViewChange = (name) => {
      state.view = name;
      renderViewOverlay();
      // Гизма/вращение из плоского вида в перспективу — разметка в 3D
      // недоступна (и режим гаснет, если нет чертежей/редактора на виду).
      syncMarkupUI();
    };
    // Подгонка кадра под нижний лист на телефоне (viewer.setBottomInset) двигает
    // камеру без жеста пользователя — плоским видам нужно пересчитать оверлей размеров.
    viewer.onCameraFit = () => {
      if (state.view !== 'iso') renderViewOverlay();
    };
  }

  // Оверлей размеров пересчитываем при любом движении камеры
  if (viewer) {
    const host = document.getElementById('viewer3d');
    ['pointermove', 'wheel', 'pointerup'].forEach((ev) =>
      host.addEventListener(ev, () => { if (state.view !== 'iso') renderViewOverlay(); }));
  }

  // Режимы 3D-вида: одна и та же функция и для кнопки в «Студии», и для
  // иконки на плавающей панели #viewToolbar (см. toggleXray и др. ниже).
  const bindMode = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };
  bindMode('xrayBtn', toggleXray);
  bindMode('vtXrayBtn', toggleXray);
  bindMode('hideFacadesBtn', toggleHideFacades);
  bindMode('vtHideFacadesBtn', toggleHideFacades);
  bindMode('drillCheckBtn', toggleDrillCheck);
  bindMode('vtDrillCheckBtn', toggleDrillCheck);
  syncViewModeButtons();

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
    viewer.onSelectPart = ({ module, kind, side, sectionIndex, zoneIndex, partKey, clientX, clientY }) => {
      // Деталь подсвечивается в 3D СРАЗУ по клику — ещё до того, как открыто
      // само меню и тем более выбран его пункт (см. viewOpts/viewer.render
      // ниже). panelView здесь НЕ трогаем — панель «Деталь» по-прежнему
      // открывается только явным выбором пункта меню (openPartEditor).
      // partKey — ключ именно кликнутой детали (у деталей без ключа null).
      state.selectedPart = { module, kind, side, subIndex: 0, sectionIndex, zoneIndex, partKey: partKey || null, asPart: false };
      viewer.render(currentModel, viewOpts());
      showFocusMenu(clientX, clientY, [
        { label: 'Редактировать деталь', action: () => openPartEditor(module, kind, side, sectionIndex, zoneIndex, true, partKey) },
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
      // Клик по отсеку выбирает и МОДУЛЬ (как клик по любой его части), и
      // отсек — единая панель-HUD (ui-shell.js: onSelectZone → showHud) с
      // параметрами модуля, делением секции и «Редактировать отсек». Модуль
      // выбираем здесь, чтобы поля размеров HUD относились к нему.
      closeFocusMenu();
      exitIsolation();
      selectModuleByName(module);
      state.panelView = 'module';
      renderParamsPanel();
      state.selectedPart = { module, kind: 'door', side: undefined, subIndex: 0, sectionIndex, zoneIndex, asPart: false };
      viewer.render(currentModel, viewOpts());
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

// localStorage может быть недоступен (приватный режим части браузеров,
// политика безопасности, иногда — open по file://, см. autosaveProject/
// offerAutosaveRestore выше, где ровно по этой причине уже стоит try/catch)
// — тогда чтение/запись бросает SecurityError. Раньше здесь не было защиты:
// исключение из getAuthToken() внутри scheduleCatalogSave() (её вызывает,
// среди прочего, libDeleteSelectedRow — «− Удалить материал» в Библиотеке)
// прерывало функцию ДО финального renderLibraryPanel(), и удалённая позиция
// пропадала из каталога, но не с экрана — кнопка выглядела нерабочей на
// любой строке. Без токена (недоступен или гость) — тот же результат, что и
// раньше: null/отсутствие действия, дальше код и так трактует это как
// «гость».
function getAuthToken() {
  try { return localStorage.getItem(AUTH_TOKEN_KEY); } catch (err) { return null; }
}

function setAuthToken(token) {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch (err) { console.warn('Auth token save failed:', err); }
}

// Гость (без токена входа) правки в каталоге всё равно никуда не сохраняет
// (см. scheduleCatalogSave) — молча позволять ему открывать редактирование
// было бессмысленно: после перезагрузки всё пропадало без предупреждения.
// Единая проверка перед ЛЮБЫМ действием, меняющим каталог, — вызывается
// самой первой строкой в каждой из функций, что открывают/выполняют правку
// (не только там, где данные отправляются на сервер).
function requireLibraryEditAuth() {
  if (getAuthToken()) return true;
  window.alert('Для редактирования библиотеки зарегистрируйтесь или войдите в аккаунт');
  return false;
}

// Панель «Библиотека» реально ВИДНА (drawer открыт классом .open, см.
// ui-shell.js: openDrawer/closeDrawer) и открыта на вкладке, содержимое
// которой зависит от каталога («Материалы», «Двери», «Фурнитура», «База
// модулей») — используется, чтобы решить, нужно ли перерисовывать её
// содержимое сразу после фоновой подгрузки/отката правок каталога
// (restoreCatalogFrom мутирует и FACADE_MATERIALS — с 2026-09-15 это данные
// категории «Виды фасадов» на вкладке «Двери», а не только «Материалов», см.
// libraryFacadesBlock — и все четыре источника фурнитуры вместе с деревом её
// категорий, см. state.libHwCatLabels/libHwCustomCats). «modules» добавлена
// 2026-09-21: без неё своя категория «Базы модулей» (state.libModCustomGroups,
// тоже приходит из restoreCatalogFrom) не появлялась на экране после F5/
// перелогина, пока панель уже открыта на этой вкладке — «Библиотека» на
// пустом проекте открывается сама (см. ui-shell.js: restoreUI) ДО того, как
// успевает прийти фоновый GET /catalog-overrides, а после его прихода
// перерисовку без «modules» в списке никто не заказывал.
function isLibraryMaterialsPanelOpen() {
  const drawer = document.getElementById('drawer-library');
  return !!drawer && drawer.classList.contains('open')
    && (state.libraryTab === 'materials' || state.libraryTab === 'facades'
      || state.libraryTab === 'hardware' || state.libraryTab === 'modules');
}

// Статус последней фоновой попытки сохранить правки каталога — крутится
// рядом с вкладками панели «Библиотека» (#librarySaveStatus в index.html,
// вне #libraryPanel — не пропадает при полной перерисовке содержимого
// вкладки, см. renderLibraryPanel). Тот же паттерн, что setAuthStatus/
// #authStatus, но для отдельного индикатора: пользователь правил каталог
// ночью, выключил компьютер раньше, чем сработал debounce — правка тихо
// потерялась и это заметили только на следующий день. Теперь у пользователя
// есть на что посмотреть перед тем как закрыть вкладку.
function setLibrarySaveStatus(message, kind) {
  const el = document.getElementById('librarySaveStatus');
  if (!el) return;
  el.textContent = message || '';
  el.className = 'sketch-status lib-save-status' + (kind ? ` ${kind}` : '');
}

// Статус кнопки «Опубликовать как базу по умолчанию» (#libPublishBar в
// index.html) — свой индикатор, отдельный от setLibrarySaveStatus выше: та
// строка занята автосохранением правок пользователя на сервер, публикация
// в общий дефолт — отдельное действие со своим результатом, писать поверх
// друг друга нельзя.
function setLibPublishStatus(message, kind) {
  const el = document.getElementById('libPublishStatus');
  if (!el) return;
  el.textContent = message || '';
  el.className = 'sketch-status' + (kind ? ` ${kind}` : '');
}

// Публикация текущего (сохранённого на сервере) каталога пользователя как
// нового каталога по умолчанию для всех — кнопка видна только админу (см.
// renderAccountUI/authAccount.isAdmin), сервер сам сверяет email ещё раз.
// Кнопка и статус живут вне #libraryPanel (не пересоздаются при смене
// вкладки/renderLibraryPanel), поэтому disabled и текст статуса правим
// напрямую через DOM, без отдельного поля в state.
async function requestCatalogPublish() {
  const btn = document.getElementById('libPublishBtn');
  const token = getAuthToken();
  if (!token) { setLibPublishStatus('Войдите в аккаунт заново.', 'error'); return; }
  if (btn) btn.disabled = true;
  setLibPublishStatus('Публикуем…', '');
  try {
    const res = await fetch(`${AUTH_API_BASE}/catalog-publish`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token },
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const changed = Array.isArray(data.changed) ? data.changed : [];
      if (!changed.length) setLibPublishStatus('Публиковать нечего — каталог уже совпадает с базой по умолчанию.', '');
      else setLibPublishStatus(`Опубликовано: ${changed.join(', ')}.`, 'ok');
    } else if (res.status === 400 || res.status === 403 || res.status === 422 || res.status === 503) {
      // Все четыре — осмысленные сообщения от сервера (см. описание кодов в
      // задаче): 400 «нечего публиковать», 403 «доступ закрыт», 422 «код не
      // прошёл валидацию» (публикация не произошла, ничего не сломано), 503
      // «не настроено на сервере». Показываем текст сервера как есть.
      setLibPublishStatus(data.error || 'Не удалось опубликовать.', 'error');
    } else {
      setLibPublishStatus('Не удалось опубликовать — попробуйте позже.', 'error');
    }
  } catch (err) {
    setLibPublishStatus('Не удалось опубликовать — проверьте подключение.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Фоновое сохранение правок каталога материалов на сервере (см.
// libSaveEdit/libAddRow/libRenameNode/libAddChildNode/libDeleteNode ниже —
// единственные точки, где реально меняются данные каталога). Задержка нужна,
// чтобы не слать запрос на каждое нажатие клавиши при инлайн-редактировании,
// а один раз после того, как пользователь остановился. Гость (без токена)
// ничего не сохраняет — те же правки просто живут в памяти вкладки до
// перезагрузки, как и раньше.
//
// Задержка снижена с 1500 до 700мс (2026-09-17) — уменьшает окно, в котором
// правка ещё не отправлена и может потеряться при мгновенном закрытии
// вкладки (см. flushCatalogSaveOnUnload ниже — доп. страховка при pagehide,
// но не гарантия для больших снимков с фото, см. её комментарий). Совсем
// убирать debounce нельзя — иначе запрос уйдёт на каждое нажатие клавиши в
// инлайн-редактировании.
const CATALOG_SAVE_DEBOUNCE_MS = 700;
let catalogSaveTimer = null;
// true между моментом, когда обычный (не keepalive) fetch запущен, и
// моментом, когда он завершился (успешно, с ошибкой или исключением) —
// отдельно от catalogSaveTimer, который означает только «есть правка,
// ещё ждущая debounce». Без этого флага было узкое окно гонки: таймер
// уже сработал и обнулил catalogSaveTimer, а fetch ещё летит к серверу —
// если вкладку закрыть именно в этот момент, flushCatalogSaveOnUnload
// видел catalogSaveTimer === null, считал, что досылать нечего, и правка
// терялась вместе с оборванным без keepalive запросом (см. баг 2026-09-18:
// создали категорию в Библиотеке → Фурнитура, тут же закрыли — категория
// пропала).
let catalogSaveInFlight = false;
// true, как только стало ясно, что больше нечего (или не получилось)
// подгрузить с сервера: гость (нет токена) — сразу; залогиненный —
// после того как loadCatalogOverrides() отработала, успешно или с
// ошибкой (см. её finally). Пока false, scheduleCatalogSave() ничего не
// делает: не ставит debounce-таймер, не трогает статус. Без этого флага
// была гонка — первая отрисовка панели «Библиотека» сразу после загрузки
// страницы (ДО того как успел прийти GET /catalog-overrides) видит ещё
// заводские, не восстановленные данные, находит в них «несоответствие»
// (см. libNormalizeOwnEntries в renderLibraryPanel) и планирует сохранение;
// если сервер (Railway) отвечает на GET дольше 700мс (CATALOG_SAVE_
// DEBOUNCE_MS), таймер срабатывает раньше и затирает на сервере реальные
// правки пользователя заводским снимком — тот пропадал после обычного F5
// (баг 2026-09-18).
let initialCatalogLoadSettled = false;
function scheduleCatalogSave() {
  if (!initialCatalogLoadSettled) return;
  if (!getAuthToken()) return;
  clearTimeout(catalogSaveTimer);
  setLibrarySaveStatus('Сохранение…', '');
  catalogSaveTimer = setTimeout(async () => {
    // Таймер сработал — дальше он не «ожидающий», это важно для
    // flushCatalogSaveOnUnload (проверяет catalogSaveTimer, чтобы понять,
    // есть ли несохранённая правка, которую надо досылать принудительно).
    catalogSaveTimer = null;
    // Перепроверяем токен прямо перед отправкой — за время ожидания
    // пользователь мог выйти (или на этой же вкладке войти другим
    // аккаунтом), и слать чужой/пустой токен с устаревшим снимком нельзя.
    const tokenNow = getAuthToken();
    if (!tokenNow) return;
    catalogSaveInFlight = true;
    try {
      const blob = snapshotCatalogCollections();
      const res = await fetch(`${AUTH_API_BASE}/catalog-overrides`, {
        method: 'PUT',
        headers: { authorization: 'Bearer ' + tokenNow, 'content-type': 'application/json' },
        body: JSON.stringify({ data: blob }),
      });
      if (!res.ok) {
        console.error('[catalogOverrides] не удалось сохранить:', await res.text().catch(() => ''));
        setLibrarySaveStatus('Не удалось сохранить — проверьте подключение', 'error');
        return;
      }
      setLibrarySaveStatus('Сохранено', 'ok');
    } catch (err) {
      console.error('[catalogOverrides] сеть недоступна, правки не сохранены:', err.message);
      setLibrarySaveStatus('Не удалось сохранить — проверьте подключение', 'error');
    } finally {
      catalogSaveInFlight = false;
    }
  }, CATALOG_SAVE_DEBOUNCE_MS);
}

// Браузеры режут тело keepalive-запроса примерно на 64KB (Chrome) — снимок
// каталога может быть заметно больше из-за base64 data URL фото материалов
// (см. лимит express.json({ limit: '8mb' }) на самом роуте — он именно из-за
// этого больше стандартного). Раз гарантии для больших снимков нет, отправку
// в flushCatalogSaveOnUnload ниже даже не пробуем — заведомо не пройдёт.
const CATALOG_SAVE_KEEPALIVE_LIMIT = 60000; // байт, с запасом от ~64KB лимита

// Принудительная досылка ожидающей правки каталога при закрытии/уходе
// вкладки в фон — иначе она ждёт CATALOG_SAVE_DEBOUNCE_MS и, если вкладку
// закрыли раньше, не уходит никогда (см. комментарий у scheduleCatalogSave
// и историю бага: правки ночью пропали без следа, узнали только утром).
// pagehide, а не beforeunload — надёжнее для мобильных/сворачивания в фон,
// и не показывает пользователю лишний диалог подтверждения. fetch с
// keepalive:true, а не navigator.sendBeacon — sendBeacon не умеет
// произвольные заголовки, а серверный роут (requireAuth, см.
// server/src/middleware/auth.js) принимает токен ТОЛЬКО в заголовке
// Authorization, не в теле — значит sendBeacon здесь не подходит без правок
// сервера, а трогать сервер не в этой задаче. keepalive:true — тот же fetch,
// но переживает выгрузку страницы и поддерживает обычные заголовки.
//
// Это best-effort, не гарантия: если снимок больше ~60KB (см.
// CATALOG_SAVE_KEEPALIVE_LIMIT), браузер запрос всё равно обрежет/отклонит —
// тогда основная защита от потери данных — видимый статус в панели
// «Библиотека» (setLibrarySaveStatus), по которому пользователь должен
// дождаться «Сохранено» перед закрытием вкладки, а не эта подстраховка.
function flushCatalogSaveOnUnload() {
  // Досылаем принудительно, если ЛИБО правка ещё ждёт debounce
  // (catalogSaveTimer), ЛИБО обычное (не keepalive) сохранение уже в
  // процессе прямо сейчас (catalogSaveInFlight) — такой fetch браузер
  // может оборвать при закрытии вкладки, не долетев до сервера. Снимок
  // ниже (snapshotCatalogCollections) в любом случае берётся заново из
  // актуального состояния каталога, так что повторная отправка поверх
  // уже долетевшего обычного запроса не страшна — это upsert одним и тем
  // же полным снимком, а не инкремент.
  if (!catalogSaveTimer && !catalogSaveInFlight) return; // нет ожидающей и нет летящей правки — досылать нечего
  clearTimeout(catalogSaveTimer);
  catalogSaveTimer = null;
  const token = getAuthToken();
  if (!token) return;
  try {
    const blob = snapshotCatalogCollections();
    const body = JSON.stringify({ data: blob });
    if (new Blob([body]).size > CATALOG_SAVE_KEEPALIVE_LIMIT) return;
    fetch(`${AUTH_API_BASE}/catalog-overrides`, {
      method: 'PUT',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch (err) {
    // Страница уже закрывается — здесь больше нечего сделать.
  }
}
window.addEventListener('pagehide', flushCatalogSaveOnUnload);

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
    // Реальные данные с сервера уже применены к state — с этого момента
    // сохранение можно разрешать. Выставляем ДО повторной отрисовки панели
    // «Библиотека» ниже: она может снова вызвать libNormalizeOwnEntries →
    // scheduleCatalogSave() (см. её комментарий в renderLibraryPanel), и на
    // этот раз это уже сохранение поверх настоящих восстановленных данных
    // пользователя, а не заводских — его глотать нельзя, в отличие от
    // самой первой (см. initialCatalogLoadSettled выше).
    initialCatalogLoadSettled = true;
    if (isLibraryMaterialsPanelOpen()) renderLibraryPanel();
    recompute();
    renderParamsPanel();
  } catch (err) {
    console.error('[catalogOverrides] сеть недоступна, правки не загружены:', err.message);
  } finally {
    // Страховка для остальных выходов (!res.ok, нет payload.data, сетевая
    // ошибка выше) — там реальных данных не было и ждать больше нечего,
    // сохранение нужно разблокировать в любом случае, иначе одна неудачная
    // попытка загрузки навсегда запрещает сохранять правки до перезагрузки
    // страницы. Если флаг уже true (успешный путь выше) — повторное
    // присваивание безвредно.
    initialCatalogLoadSettled = true;
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
  // Кнопка «Опубликовать как базу по умолчанию» (меню настроек-шестерёнка,
  // #currencyPopover) — сервер сам проверяет email при самом запросе, здесь
  // только видимость.
  const libPublishBar = document.getElementById('libPublishBar');
  if (libPublishBar) {
    const isAdmin = !!(authAccount && authAccount.isAdmin);
    libPublishBar.style.display = isAdmin ? 'flex' : 'none';
    // Кнопка скрыта — сбрасываем статус прошлой попытки, иначе при
    // следующем входе админа мелькнёт устаревший результат.
    if (!isAdmin) setLibPublishStatus('', '');
  }

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
  // Гость — с сервера точно нечего ждать, сохранение (заблокированное
  // initialCatalogLoadSettled, см. scheduleCatalogSave) можно разблокировать
  // сразу же (хотя для гостя оно и так не уйдёт дальше — нет токена).
  if (!token) { authAccount = null; initialCatalogLoadSettled = true; renderAccountUI(); return; }
  try {
    const res = await fetch(`${AUTH_API_BASE}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      // Токен истёк/невалиден — тихо разлогиниваем, без всплывающей ошибки
      // при обычной загрузке страницы. loadCatalogOverrides ниже не
      // вызовется, поэтому флаг нужно выставить здесь же.
      setAuthToken(null);
      authAccount = null;
      initialCatalogLoadSettled = true;
      renderAccountUI();
      return;
    }
    if (!res.ok) throw new Error('Не удалось получить статус аккаунта.');
    authAccount = await res.json();
    // Пользователь точно залогинен — подгружаем правки каталога материалов,
    // сохранённые с прошлого раза (см. loadCatalogOverrides выше); у неё
    // свой try/catch/finally, ошибка сети сюда не всплывёт, и именно она
    // сама выставляет initialCatalogLoadSettled по итогу (успешному или
    // нет) — здесь дублировать не нужно.
    await loadCatalogOverrides(token);
  } catch (err) {
    console.error('Не удалось получить статус аккаунта:', err);
    authAccount = null;
    // /auth/me не дошёл до loadCatalogOverrides (сеть недоступна, ответ не
    // ok, битый JSON) — она не вызвалась и не выставит флаг сама, делаем
    // это здесь, иначе сохранение останется заблокированным навсегда.
    initialCatalogLoadSettled = true;
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
      catalogSaveTimer = null;
      setLibrarySaveStatus('', '');
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
      state.backThickness = r.backThickness;
      mod.plinthHeight = r.baseHeight;
      mod.sections = r.sections.map(s => Object.assign(newSection(), s));

      const decorCode = guessDecorCode(r.decorHint);
      if (decorCode) {
        state.decorCode = decorCode;
        // Поле «Толщина ЛДСП» убрано (2026-09-28) — толщина корпуса берётся
        // из найденного материала, а не из «сырого» числа, распознанного ИИ
        // по эскизу (иначе толщина молча разойдётся с реальным декором).
        const decorItem = findAnyMaterialByCode(decorCode);
        if (decorItem && decorItem.thickness) state.bodyThickness = decorItem.thickness;
      } else {
        // Материал не опознан — декор (и его толщина) не меняем, используем
        // распознанную ИИ толщину как есть.
        state.bodyThickness = r.bodyThickness;
      }

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
  invalidateDocsTabs(['spec']);
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
  // Переключить вид камеры (горячие клавиши 1–4 в ui-shell.js) — см. applyView.
  setView: applyView,
  getView: function () { return state.view; },
  refreshCurrency: refreshCurrency,
  // Режимы 3D-вида (те же функции, что у кнопок «Студии» и панели
  // #viewToolbar) и их текущее состояние.
  toggleXray: toggleXray,
  toggleHideFacades: toggleHideFacades,
  toggleDrillCheck: toggleDrillCheck,
  getViewModes: function () {
    return { xray: state.xray, hideFacades: state.hideFacades, drillCheck: state.drillCheck };
  },
  // ui-shell.js зовёт при ЛЮБОМ закрытии панели «Библиотека» (крестик,
  // Escape, вытягивание листа вниз на телефоне, открытие другой панели поверх) — без этого «Выбрать» у
  // «Листовых материалов» могла остаться включённой до следующего открытия
  // (пользователь нажал «+ Добавить материал», передумал, закрыл крестиком —
  // при обычном открытии Библиотеки позже колонка «Выбрать» была бы всё ещё
  // видна, и случайный клик по ней молча подменил бы материал проекта).
  // Перерисовка — чтобы колонка «Выбрать» не осталась в закрытой Библиотеке
  // и не всплыла при следующем открытии (кнопки без цели подбора мертвы).
  clearLibraryPickTarget: function () {
    if (!state.libPickTarget) return;
    state.libPickTarget = null;
    renderLibraryPanel();
  },
  isProjectEmpty: function () { return state.modules.length === 0; },
  getRotations: function () { return ROTATIONS.map((r) => r.slice()); },
  rotateModule: rotateModule,
  rotateModuleStep: rotateModuleStep,
  getModuleHudState: getModuleHudState,
  setModuleDoorZoneCount: setModuleDoorZoneCount,
  // «Редактировать отсек» из HUD (клик по отсеку в 3D).
  editModuleZone: function (moduleName, sectionIndex, zoneIndex) {
    openPartEditor(moduleName, 'door', undefined, sectionIndex, zoneIndex);
  },
  // Вкладки документов строятся лениво (см. docsTabsDirty/ensureTabBuilt).
  // ensureVisibleDocsTabBuilt зовёт ui-shell.js, когда панель «Документы»
  // открывают мимо setDocsTab (кнопка HUD, горячая клавиша D,
  // восстановление состояния при загрузке). ensureTabBuilt — для тех, кому
  // нужна готовая разметка конкретной вкладки, не показывая её
  // (dev-прогон tools/smoke.js).
  ensureTabBuilt: ensureTabBuilt,
  ensureVisibleDocsTabBuilt: ensureVisibleDocsTabBuilt,
  // Пересобрать чертежи без пересчёта модели — ui-shell.js зовёт после смены
  // размера шрифта ручной разметки (рамка листа должна вместить подписи).
  refreshDrawings: () => invalidateDocsTabs(['drawings']),
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
  // Пользовательские текстуры листов (IndexedDB этого компьютера) читаются
  // асинхронно — по готовности сцена перерисовывается; без IndexedDB молча
  // остаёмся с плоскими цветами.
  if (window.Modul3D.userTextures) {
    window.Modul3D.userTextures.init(() => { recompute(); renderLibraryPanel(); });
  }
  offerAutosaveRestore();
  initAccountPanel();
  initPaddle();
  initSketchPanel();
  initHeaderControls();
  initPartEditorOverlay();
  initLibUsageModal();
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
    // closeColumnFilterMenu, а не closeDetailFilterMenu: поповер сортировки/
    // фильтра стал общим для «Деталировки» и Библиотеки, старая функция при
    // этом исчезла, а вызов остался — каждое нажатие Esc роняло
    // ReferenceError, и строка ниже (закрытие «где используется») уже не
    // выполнялась (найдено 2026-09-16).
    closeColumnFilterMenu();
    closeLibUsageModal();
  });

  // Delete — удалить выделенный модуль. В поле ввода клавиша работает
  // штатно (удаляет символ), поэтому там её не перехватываем.
  // ВАЖНО (см. src/markup.js): у ручной разметки чертежей (markup.js) есть
  // СВОЙ document-обработчик keydown на Delete — он удаляет выделенный
  // ручной размер и останавливает событие через stopImmediatePropagation(),
  // чтобы оно НЕ доходило досюда и заодно не удаляло активный модуль.
  // Это работает только потому, что markup.js подключён в index.html РАНЬШЕ
  // app.js (порядок addEventListener на одном target = порядок регистрации).
  // Не переставляй порядок этих <script> тегов и не переноси этот обработчик
  // в другой файл, не сверившись с markup.js — иначе Delete по ручному
  // размеру снова начнёт заодно удалять весь модуль.
  document.addEventListener('keydown', (e) => {
    const tg = (e.target && e.target.tagName) || '';
    if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
    if (e.key !== 'Delete' && e.key !== 'Del') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!state.modules.length) return;
    // В режиме разметки чертежа Delete — клавиша разметки: выделенный размер
    // удаляет markup.js (и сюда событие не доходит), а если ничего не
    // выделено — не удаляем молча весь модуль, пользователь явно целился в размер.
    if (markupApi && markupApi.isActive()) return;
    e.preventDefault();
    deleteModule(state.activeModule);
  });

  // Отмена, возврат, сохранение и открытие проекта.
  // Клавишу определяем по e.code (физическая клавиша), а НЕ по e.key: e.key
  // зависит от раскладки — при русской раскладке для Z приходит 'я', для Y —
  // 'н', для X — 'ч', для S — 'ы', для O — 'щ', и сравнение с латинской буквой
  // молча не срабатывает (горячие клавиши «не работают по-русски»). e.code от
  // раскладки не зависит: 'KeyZ', 'KeyY', 'KeyX', 'KeyS', 'KeyO' — так же
  // сделано в ui-shell.js (initHotkeys). Фолбэк на e.key оставлен на редкий
  // случай, когда e.code не приходит (виртуальные клавиатуры, синтетические
  // события): латинская буква из e.key приводится к тому же виду 'KeyZ'.
  // Ctrl+X перехватываем только вне полей ввода — внутри поля это штатное
  // «вырезать», ломать его нельзя. Ctrl+Z/Ctrl+Y/Ctrl+Shift+Z в поле ввода
  // тоже не перехватываем: там браузер должен отменять набранный текст, а не
  // действие над проектом. Ctrl+S и Ctrl+O, наоборот, перехватываем везде,
  // включая поля ввода, иначе браузер сохранит/откроет саму страницу.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    // AltGr на Windows = Ctrl+Alt: на раскладках, где AltGr+буква даёт
    // символ, это не Ctrl-шорткат. Так же отсекается в ui-shell.js.
    if (e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const key = String(e.key || '');
    const code = String(e.code || '') || (/^[a-zA-Z]$/.test(key) ? `Key${key.toUpperCase()}` : '');
    if (!inField) {
      if (code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (code === 'KeyY' || (code === 'KeyZ' && e.shiftKey)) { e.preventDefault(); redo(); return; }
      if (code === 'KeyX') { e.preventDefault(); redo(); return; }
    }
    if (code === 'KeyS') { e.preventDefault(); saveProjectToFile(); return; }
    if (code === 'KeyO') { e.preventDefault(); document.getElementById('openProjectBtn').click(); }
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
