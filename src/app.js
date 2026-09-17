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
const APP_VERSION = 'v280';

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
  // («Листовые материалы»/«Виды фасадов»/«Кромка»/«Стекло», см.
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
  libHwCatLabels: {},
  // СВОИ корневые категории фурнитуры, заведённые кнопкой «+ Добавить
  // категорию» на вкладке «Фурнитура» (см. libAddHwCategory) — массив ключей
  // вида 'custom-<timestamp>' в порядке добавления, они дописываются к
  // заводским HARDWARE_CATEGORY_ORDER (см. libHwCategoryKeys). Подпись такой
  // категории лежит в libHwCatLabels выше, а её позиции — обычная фурнитура с
  // item.category === этому ключу (HARDWARE_PRICES, см. libAddHardwareRow).
  // Расчёт про такие ключи ничего не знает — это просто контейнер каталога.
  // Как и libHwCatLabels, сохраняется на сервере вместе с правками каталога.
  libHwCustomCats: [],
  // Режим подбора материала из «Параметры проекта» (кнопка «+ Добавить
  // материал» у Материал корпуса/Материал фасада/Задняя стенка, см.
  // materialPickActionsHtml/openMaterialPicker) — { role: 'decor' | 'facadeDecor'
  // | 'back' } или null, когда подбор не идёт. Пока не пуст, вкладка
  // «Библиотека → Материалы» рисует у каждой строки «Листовых материалов»
  // дополнительную кнопку «Выбрать» (см. libRowHtml/libPickMaterial).
  // Чисто UI-состояние, как libraryTab выше: в историю отмены/файл проекта
  // не попадает.
  libPickTarget: null,
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
    // Дерево категорий вкладки «Фурнитура» (2026-09-16): свои подписи
    // корневых категорий и свои корневые категории — те же правки каталога,
    // что и всё остальное в этом снимке, поэтому едут на сервер тем же
    // механизмом, без второго параллельного хранилища. Сами ПЕРЕНОСЫ/
    // переименования узлов ниже корня отдельного места в снимке не требуют:
    // они живут в item.categoryPath самих позиций (см. libSetEntryPath) и в
    // libExtraNodes (пустые категории-заглушки) — и то, и другое здесь уже есть.
    libHwCatLabels: JSON.parse(JSON.stringify(state.libHwCatLabels)),
    libHwCustomCats: JSON.parse(JSON.stringify(state.libHwCustomCats)),
  };
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
  // Дерево категорий «Фурнитуры» — как и libExtraNodes выше: в старых
  // сохранённых снимках (до 2026-09-16) этих двух ключей нет вовсе, тогда
  // просто остаётся заводской набор категорий без своих подписей.
  if (blob.libHwCatLabels) state.libHwCatLabels = JSON.parse(JSON.stringify(blob.libHwCatLabels));
  if (blob.libHwCustomCats) state.libHwCustomCats = JSON.parse(JSON.stringify(blob.libHwCustomCats));
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
// «Характеристики листа», libIsCharsCollapsed).
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
function libSwatchHtml(group, key, image, sourceUrl) {
  // dataURL (base64) не содержит одинарных кавычек — безопасно подставлять
  // внутрь url('...') без экранирования; esc() экранирует внешний HTML-атрибут
  // (двойные кавычки), а не саму CSS-строку. Обычный https-URL (см. поле
  // image у большинства позиций catalog.js) по той же причине безопасен.
  const style = image ? ` style="background-image:url('${esc(image)}')"` : '';
  const urlAttr = sourceUrl ? ` data-swatch-url="${esc(sourceUrl)}"` : '';
  const title = sourceUrl ? 'Открыть карточку товара на сайте' : 'Загрузить образец';
  return `<span class="lib-swatch${image ? '' : ' empty'}" data-swatch-group="${esc(group)}" data-swatch-key="${esc(key)}"${style}${urlAttr} title="${esc(title)}"></span>`;
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
      item: Object.assign({}, it, { categoryPath: [COUNTERTOP_MATERIAL_LABEL[it.materialId] || it.materialId, it.brand || NO_BRAND_SUBCAT] }),
    }));
  }
  // 'hw:<categoryKey>' — составной topCode вкладки «Фурнитура» (см. большой
  // комментарий над libHardwareTopEntries ниже): каждая категория (Петли/
  // Ручки/...) — своё НЕЗАВИСИМОЕ дерево верхнего уровня, как и у пяти веток
  // «Материалов» выше, без общей обёртки «Фурнитура» (убрана 2026-09-15).
  if (topCode.indexOf('hw:') === 0) return libHardwareTopEntries(cat, topCode.slice(3));
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

// Прямые дочерние сегменты узла prefixPath (путь без топ-кода) — в порядке
// первого появления, но «Без бренда» (NO_BRAND_SUBCAT) ВСЕГДА последний.
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
  // Сравнение без учёта регистра — как везде, где имя узла сверяется с
  // NO_BRAND_SUBCAT (libEntryTargetPath/libMoveNode): «без бренда» и «Без
  // бренда» для пользователя одна и та же категория.
  const isNoBrand = (seg) => String(seg).toLowerCase() === NO_BRAND_SUBCAT.toLowerCase();
  return seen.filter((seg) => !isNoBrand(seg)).concat(seen.filter(isNoBrand));
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
  return ['sheet', 'edge', 'glass', 'facade'].concat(libHwCategoryKeys().map((c) => 'hw:' + c));
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
    if (it.category === 'mechanism') it.brand = last; else it.subcategory = last;
  }
}

// Переезд ключей UI-состояния вслед за узлом: свёрнутость поддерева
// (state.libCollapsed) и фокус на листе (state.libActiveLeaf) адресуются
// ПУТЁМ узла — после переименования/переноса старые ключи указывали бы в
// пустоту (перенесённая ветка схлопывалась бы, а сфокусированный лист
// показывал бы пустую таблицу).
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
// последним сегментом. Особый случай — КОРЕНЬ дерева (path пуст): у разделов
// «Материалов» переименования нет вовсе (набор разделов фиксирован, тип
// товара завязан на группу каталога), а у категории «Фурнитуры» меняется
// ТОЛЬКО подпись на экране (state.libHwCatLabels) — сам ключ категории
// (item.category), по которому движок подбирает фурнитуру в расчёте,
// остаётся прежним.
function libRenameNode(topCode, path, newName) {
  newName = libCleanNodeName(newName);
  if (!newName) return;
  if (!path.length) {
    if (topCode.indexOf('hw:') !== 0) return;
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
  libRepathNode(topCode, path, path.slice(0, -1).concat([newName]));
  scheduleCatalogSave();
}

// Перенос узла в другого родителя (значок ⇄, см. openLibTreeMoveMenu) —
// newParentPath всегда из ТОГО ЖЕ раздела (см. libMoveTargets: между разными
// корневыми разделами переносить нельзя, это сменило бы тип товара/ключ
// категории, от которого зависит расчёт), пустой массив — «в корень раздела».
// Конфликт имён решаем ОТКАЗОМ с понятным сообщением, а не молчаливым
// слиянием двух категорий: слияние необратимо (обратно их уже не разделить
// одним кликом), а переименовать одну из них пользователь может сам.
function libMoveNode(topCode, path, newParentPath) {
  const name = path[path.length - 1];
  const busy = libChildSegments(topCode, newParentPath).map((s) => s.toLowerCase());
  if (busy.indexOf(String(name).toLowerCase()) >= 0) {
    const where = newParentPath.length ? `«${newParentPath.join(' › ')}»` : 'корне раздела';
    window.alert(`В ${where} уже есть категория «${name}». Сначала переименуйте одну из них, потом переносите.`);
    return;
  }
  const newPath = newParentPath.concat([name]);
  const oldParent = path.slice(0, -1);
  libRepathNode(topCode, path, newPath);
  // Родитель, который существовал ТОЛЬКО за счёт этого ребёнка (своих
  // позиций нет, в заглушках не числится), после переноса исчез бы из дерева
  // — со стороны это выглядит как «категория пропала сама собой».
  libKeepOrphanParent(topCode, oldParent);
  // Показываем результат там, куда перенесли: раскрываем сам раздел и весь
  // путь до перенесённого узла включительно, иначе он «пропал бы» внутри
  // свёрнутого родителя и выглядело бы это как потеря категории.
  state.libCatOpen[topCode] = true;
  for (let i = 1; i <= newPath.length; i += 1) {
    state.libCollapsed[libNodeKey(topCode, newPath.slice(0, i))] = false;
  }
  scheduleCatalogSave();
  renderLibraryPanel();
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
function libRowMoveTargets(topCode, entry) {
  const curKey = ((entry.item && entry.item.categoryPath) || []).join('::');
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
function libMoveEntry(topCode, group, key, targetPath) {
  const entry = libFindTreeEntry(topCode, group, key);
  if (!entry) return;
  const oldPath = ((entry.item && entry.item.categoryPath) || []).slice();
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
  const targetIsLeaf = !!targetPath.length && !libChildSegments(topCode, targetPath).length;
  if (targetIsLeaf) {
    state.libActiveLeaf[topCode] = targetPath.join('::');
  } else {
    state.libActiveLeaf[topCode] = null;
    state.libCatOpen[topCode] = true;
    for (let i = 1; i <= targetPath.length; i += 1) {
      state.libCollapsed[libNodeKey(topCode, targetPath.slice(0, i))] = false;
    }
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
  // категории фурнитуры (см. libTreeRowHtml), у неё отдельная процедура
  // удаления: убрать нужно не путь внутри дерева, а саму категорию из
  // state.libHwCustomCats.
  if (!path.length) { libDeleteHwCategory(topCode); return; }
  if (libNodeHasItems(topCode, path)) {
    window.alert('Сначала удалите или перенесите позиции из этой категории — в ней есть товары.');
    return;
  }
  const extra = state.libExtraNodes[topCode] || [];
  state.libExtraNodes[topCode] = extra.filter((p) => !(p.length >= path.length && path.every((seg, i) => p[i] === seg)));
  // Удалили единственного ребёнка — сам родитель остаётся на месте (см.
  // libKeepOrphanParent): пользователь удалял подкатегорию, а не её.
  libKeepOrphanParent(topCode, path.slice(0, -1));
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
function libColgroup(pickMode, collapsed) {
  const charCols = collapsed ? '' : `<col class="lib-char-col" style="width:76px"><col class="lib-char-col" style="width:76px"><col class="lib-char-col" style="width:76px">`;
  return `<colgroup><col><col style="width:72px">`
    + charCols
    + `<col style="width:82px">`
    + `${pickMode ? '<col style="width:76px">' : ''}</colgroup>`;
}
// Заголовок — ОДНА строка <thead> (никаких rowspan/colspan, см. коммент у
// libColgroup выше — кнопка «Характеристики листа» больше не здесь), Длина/
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
// libColgroup). opts.collapsed — «Характеристики листа» (см. libLeafTableHtml):
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
  const nameDisplay = group === 'edge' ? String(it.key || '') : group === 'countertop' ? libCountertopShortName(it) : libSheetShortName(it);
  // Значок ⇄ «перенести позицию» — в самой ячейке «Наименование» (см.
  // libRowMoveIcHtml, почему не отдельной колонкой). opts.moveTop — раздел
  // дерева, внутри которого можно переносить; его передаёт таблица
  // (libLeafTableHtml), сама строка своего раздела не знает: у объединённых
  // «Листовых материалов» строки одной таблицы приходят из decors/back/facade
  // одновременно, и group строки разделу не равен.
  const moveIc = libRowMoveIcHtml(opts.moveTop, group, libEntryKeyOf(entry));
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
      <td>${libSwatchHtml(group, key, it.image, it.sourceUrl)}</td>
      ${lengthCell}
      ${widthCell}
      ${thicknessCell}
      ${priceCell}
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
  const rowsHtml = entries.map((e, i) => libRowHtml(e, { pickMode, collapsed, tableKey: charsKey, rowIdx: i, moveTop: topCode })).join('');
  const items = entries.map((e) => e.item);
  const colCount = (collapsed ? 3 : 6) + (pickMode ? 1 : 0);
  const emptyRow = entries.length ? '' : `<tr><td colspan="${colCount}" class="hint">Пока нет позиций</td></tr>`;
  const addGroup = topCode === 'edge' ? 'edge' : ((opts.addGroupMap && opts.addGroupMap[path[0]]) || opts.addDefaultGroup || topCode);
  const addHtml = opts.addLabel
    ? `<button type="button" class="link-btn lib-add" data-add="${esc(addGroup)}" data-add-path="${esc(path.join('::'))}">${esc(opts.addLabel)}</button>`
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
  // Кнопка «Характеристики листа» — НАД таблицей, а не заголовок внутри
  // <thead> (см. коммент у libColgroup/libTableHead, почему): общий на всю
  // Библиотеку тумблер (state.libCharsCollapsed), клик в любой из открытых
  // таблиц сворачивает/разворачивает колонки Длина/Ширина/Толщина везде
  // разом (обработчик — делегированный click на .lib-chars-toggle, см.
  // initLibraryPanel, ему всё равно, внутри таблицы кнопка или снаружи).
  // Подпись статична («Характеристики листа», без +/− префикса) — текущее
  // состояние (характеристики показаны/скрыты) отражает класс .active на
  // самой кнопке, не текст (см. .lib-chars-btn в style.css).
  const charsToggleHtml = `<button type="button" class="lib-chars-btn lib-chars-toggle${collapsed ? '' : ' active'}" data-chars-toggle="1" title="Показать/скрыть длину, ширину, толщину">Характеристики листа</button>`;
  return `
    <div class="lib-leaf-body">
      ${charsToggleHtml}
      ${libPriceNoteHtml(items)}
      <table class="lib-table${collapsed ? ' chars-collapsed' : ''}" style="table-layout:fixed" data-chars-key="${esc(charsKey)}">${libColgroup(pickMode, collapsed)}${libTableHead(pickMode, collapsed, charsKey)}<tbody>${rowsHtml}${emptyRow}</tbody></table>
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
  return topCode.indexOf('hw:') === 0 ? libHardwareLeafTableHtml(topCode, path, entries, opts) : libLeafTableHtml(topCode, path, entries, opts);
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
    // vals — по одному значению на КАЖДУЮ колонку строки, в том же порядке,
    // что и <td> ниже (0 — Наименование, 1 — Образец, 2 — Цена): поповер
    // фильтра адресуется номером колонки (см. data-col у .dth-filter-btn),
    // поэтому пустая строка для нефильтруемого «Образца» — не мусор, а
    // обязательная заглушка, держащая нумерацию.
    libFilterRowsCache[tableKey].push({
      idx: i,
      vals: [String(it.name || ''), '', priceDisplay],
    });
    // Значок ⇄ «перенести позицию» — тот же, что и у материалов (см.
    // libRowMoveIcHtml): внутри ячейки «Наименование», без своей колонки.
    // Ради него и заведена подкатегория «Blum» внутри «Петель» — раньше
    // переносить умели только узлы дерева целиком.
    const moveIc = libRowMoveIcHtml(topCode, group, libEntryKeyOf(e));
    // data-row-group/data-row-key — тот же атрибут, что и у материалов (см.
    // libRowHtml), клик по строке выделяет её для кнопки «− Удалить позицию».
    const isSelected = !!(sel && sel.group === group && sel.key === key);
    return `
      <tr data-search="${esc(searchText)}" data-row-group="${esc(group)}" data-row-key="${esc(key)}"
          data-row-idx="${i}" class="${isSelected ? 'lib-row-selected' : ''}">
        ${libEditCell(group, key, 'name', 'text', it.name, { afterHtml: moveIc, extraClass: 'lib-name-cell' })}
        <td>${libSwatchHtml(group, key, it.image, it.sourceUrl)}</td>
        ${libHwPriceCellHtml(group, key, it, unit)}
      </tr>`;
  }).join('');
  const emptyRow = entries.length ? '' : '<tr><td colspan="3" class="hint">Пока нет позиций</td></tr>';
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
  // «Характеристики листа»), у фурнитуры характеристик нет — это просто
  // ключ таблицы, других значений он не несёт.
  return `
    <div class="lib-leaf-body">
      ${libPriceNoteHtml(items)}
      <table class="lib-table" style="table-layout:fixed" data-chars-key="${esc(tableKey)}">
        <colgroup><col><col style="width:72px"><col style="width:82px"></colgroup>
        <thead><tr>
          <th class="lib-th-filter"><span class="dth-label">Наименование</span>${filterBtn(0)}</th>
          <th>Образец</th>
          <th class="lib-th-filter"><span class="dth-label">${libHwPriceUnitHeaderHtml(items, topCode)}</span>${filterBtn(2)}</th>
        </tr></thead>
        <tbody>${rowsHtml}${emptyRow}</tbody>
      </table>
      ${actionsHtml}
    </div>`;
}

// Строка одного узла дерева — общая и для верхнеуровневой категории (kind
// 'top'), и для ветки ('branch'), и для листа ('leaf'). Отступ слева
// пропорционален глубине пути (16px/уровень); ✎/+/⇄/× — обычный текст без
// рамки/фона, видны по наведению на строку (см. .lib-tree-actions в
// style.css).
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
function libTreeRowHtml(topCode, path, name, kind, collapsed) {
  const depth = path.length;
  const isTop = kind === 'top';
  const isLeaf = kind === 'leaf';
  const isCountertop = topCode === 'countertop';
  const isHardware = topCode.indexOf('hw:') === 0;
  // Встроенная корневая категория фурнитуры — единственный корень, который
  // можно переименовать, но нельзя удалить (см. комментарий выше).
  const isBuiltinHwTop = isTop && isHardware && libHwCategoryIsBuiltin(topCode.slice(3));
  const arrowHtml = isLeaf ? '<span class="lib-tree-arrow"></span>' : `<span class="lib-tree-arrow">${collapsed ? '▸' : '▾'}</span>`;
  const canRename = !isCountertop && (!isTop || isHardware);
  const canAdd = !isCountertop && !isLeaf;
  const canMove = !isCountertop && !isTop;
  const canDelete = !isTop || (isHardware && !isBuiltinHwTop);
  const renameIc = canRename ? '<span class="lib-tree-ic" data-tree-rename="1" title="Переименовать">✎</span>' : '';
  const addIc = canAdd ? '<span class="lib-tree-ic" data-tree-add="1" title="Добавить категорию">+</span>' : '';
  const moveIc = canMove ? '<span class="lib-tree-ic" data-tree-move="1" title="Переместить">⇄</span>' : '';
  const delIc = canDelete ? '<span class="lib-tree-ic" data-tree-del="1" title="Удалить">×</span>' : '';
  return `<div class="lib-tree-row${isTop ? ' lib-tree-top' : ''}" style="padding-left:${depth * 16}px"
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
  if (!children.length) return libTreeRowHtml(topCode, path, name, 'leaf', false);
  const collapsed = libIsNodeCollapsed(topCode, path);
  const childrenHtml = children.map((seg) => libNodeHtml(topCode, path.concat([seg]), opts)).join('');
  return libTreeRowHtml(topCode, path, name, 'branch', collapsed)
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
function libTopCategoryHtml(topCode, title, opts) {
  const activeKey = state.libActiveLeaf[topCode] || null;
  let bodyHtml;
  if (activeKey) {
    const path = activeKey.split('::');
    bodyHtml = libBreadcrumbHtml(topCode, path)
      + libLeafTableHtmlAny(topCode, path, libEntriesAtPath(topCode, path), opts);
  } else {
    const open = !!state.libCatOpen[topCode];
    const topSegments = libChildSegments(topCode, []);
    const innerHtml = topSegments.length
      ? topSegments.map((seg) => libNodeHtml(topCode, [seg], opts)).join('')
      : libLeafTableHtmlAny(topCode, [], libEntriesAtPath(topCode, []), opts);
    bodyHtml = `<div class="lib-tree-children${open ? '' : ' lib-collapsed'}">${innerHtml}</div>`;
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

function libraryMaterialsBlock() {
  return `
    <h3>Материалы</h3>
    ${libLinkTopBarHtml('materials')}
    ${state.libLinkForm && state.libLinkForm.kind === 'materials' ? libLinkFormHtml(state.libLinkForm) : ''}
    ${libTopCategoryHtml('sheet', 'Листовые материалы', {
      pickable: true,
      addLabel: '+ Добавить материал', addGroupMap: SHEET_ADD_GROUP_MAP, addDefaultGroup: 'decors',
    })}
    ${libTopCategoryHtml('edge', 'Кромка', { addLabel: '+ Добавить кромку' })}
    ${libTopCategoryHtml('glass', 'Стекло', {})}
    ${libTopCategoryHtml('countertop', 'Столешницы', { addLabel: '+ Добавить столешницу', pickable: true })}`;
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
  const categoriesHtml = libHwCategoryKeys()
    .map((c) => libTopCategoryHtml('hw:' + c, libHwCategoryLabel(c), { hwCategory: c }))
    .join('');
  return `
    <h3>Фурнитура</h3>
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
// на лету) — грузится один раз при первом открытии формы «Добавить по ссылке».
// Возвращает промис со списком сайтов — уже загруженным (state.libLinkSites),
// уже идущим в фоне (state.libLinkSitesPromise, повторный вызов не дублирует
// запрос) или свежезапущенным. Раньше функция была fire-and-forget (сама
// перерисовывала форму по готовности и ничего не возвращала) — теперь этого
// недостаточно: «Обновить цены с сайта» (см. refreshCatalogLinkedPrices)
// должна ДОЖДАТЬСЯ список, чтобы определить sourceSiteId встроенных позиций
// каталога по домену (см. libLinkResolveSiteId), а не только показать его в
// уже открытой форме «Добавить по ссылке».
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
      if (state.libLinkForm) renderLibraryPanel();
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
  const sites = state.libLinkSites || [];
  const empty = !loading && !sites.length;
  const labelOf = (s) => (s.name === s.domain ? s.name : `${s.name} (${s.domain})`);
  const site = sites.find((s) => s.id === form.siteId);
  const toggleLabelRaw = loading ? 'Загрузка списка сайтов…'
    : empty ? (state.libLinkSitesError || 'Нет доступных сайтов')
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
      <li><a class="lib-link-site-item${s.id === form.siteId ? ' active' : ''}"${attrs} data-site-id="${esc(s.id)}">${esc(labelOf(s))}</a></li>`;
  }).join('');
  return `
    <div class="field lib-link-site-picker">
      <label>Сайт-источник</label>
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
  const itemsHtml = targets.length
    ? targets.map((p, i) => `<button type="button" class="ctx-item" data-move-idx="${i}">${p.length ? esc(p.join(' › ')) : esc(cfg.rootLabel)}</button>`).join('')
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
  renderLibraryPanel();
  const panel = document.getElementById('libraryPanel');
  if (panel) panel.scrollTop = 0;   // форма рисуется вверху вкладки — прокручиваем к ней
}
function closeLibLinkForm() {
  closeLibLinkSiteMenu();
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
  const unitDefault = fv('unit', draft.unit || (isHw ? 'шт' : 'лист'));
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
      <p class="hint lib-link-missing-hint">${initialMissing.length ? 'Заполните: ' + esc(initialMissing.join(', ')) + '.' : ''}</p>
      ${form.error ? `<p class="hint lib-link-error">${esc(form.error)}</p>` : ''}
      <div class="lib-leaf-actions">
        <button type="button" class="link-btn lib-link-save" ${initialMissing.length ? 'disabled' : ''}>Сохранить</button>
        <button type="button" class="link-btn lib-link-cancel">Отмена</button>
      </div>
    </div>`;
}

function libLinkInputStepHtml(form) {
  const site = (state.libLinkSites || []).find((s) => s.id === form.siteId);
  const domainOk = !!site && libLinkDomainMatches(form.url, site.domain);
  const warning = form.url.trim() && site && !domainOk ? `Похоже, это не сайт ${site.domain} — проверьте ссылку.`
    : form.url.trim() && !site ? 'Сначала выберите сайт из списка.' : '';
  return `
    ${libLinkSitePickerHtml(form)}
    <div class="field"><label>Ссылка на товар</label>
      <input type="url" class="lib-link-url-input" placeholder="https://..." value="${esc(form.url)}">
    </div>
    <p class="hint lib-link-warning">${esc(warning)}</p>
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
    if (saveBtn) saveBtn.disabled = missing.length > 0;
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
  const unit = values.unit || 'лист';
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
  // decors/back/facade: values.sheetW/sheetH к этому моменту уже проверены
  // libLinkMaterialDimsMissing (кнопка «Сохранить» и не дала бы дойти сюда
  // без них) — numOr(...) ниже больше не «угадывает» реальный размер листа,
  // это лишь защита от гонки (как и проверка cat.EDGE_PRICES[name] у edge
  // ниже), а не рабочий путь.
  if (group === 'decors') {
    DECORS.push(Object.assign({ code: 'LINK-' + Date.now(), name, sheetPrice: price,
      sheetW: numOr(values.sheetW, 2750), sheetH: numOr(values.sheetH, 1830),
      thickness: numOrNull(values.thickness), unit, image, article, categoryPath }, common));
  } else if (group === 'back') {
    BACK_MATERIALS.push(Object.assign({ code: 'LINK-' + Date.now(), name, sheetPrice: price,
      sheetW: numOr(values.sheetW, 2440), sheetH: numOr(values.sheetH, 1220),
      thickness: numOr(values.thickness, 3), unit, image, article, categoryPath }, common));
  } else if (group === 'facade') {
    const code = 'FAC-LINK-' + Date.now();
    cat.FACADE_MATERIALS[code] = Object.assign({ code, name, sheetPrice: price,
      sheetW: numOr(values.sheetW, 2750), sheetH: numOr(values.sheetH, 1830),
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
    cat.COUNTERTOP_MATERIALS.push(Object.assign({ code: 'CTOP-LINK-' + Date.now(), materialId, brand: ctBrand,
      name, thickness: numOr(values.thickness, 38), depth: numOr(values.sheetH, 600),
      pricePerMeter: price, maxLength: numOr(values.sheetW, 4100), unit: 'пог.м', image, article }, common));
  } else {
    return;
  }
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
    if (it.sheetPrice !== undefined) it.sheetPrice = price;
    else if (it.pricePerMeter !== undefined) it.pricePerMeter = price;
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
    if (updated > 0) { recompute(); scheduleCatalogSave(); }
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
// «+ Добавить категорию» (только «Фурнитура») стоит в этом же ряду — это
// тоже действие уровня вкладки, а не строки таблицы: заводит СВОЮ корневую
// категорию фурнитуры (см. libAddHwCategory). На «Материалах» такой кнопки
// нет сознательно — там набор корневых разделов фиксирован (Листовые
// материалы / Кромка / Стекло / Столешницы), тип товара завязан на группу
// каталога; всё, что ниже корня, там по-прежнему заводится значком «+» на
// самой строке дерева.
function libLinkTopBarHtml(kind) {
  const addAttrs = kind === 'hardware'
    ? 'data-link-kind="hardware"'
    : 'data-link-kind="materials" data-link-top="sheet" data-link-group="decors"';
  const addCatHtml = kind === 'hardware'
    ? '<button type="button" class="btn lib-add-hw-cat">+ Добавить категорию</button>'
    : '';
  return `<div class="lib-link-refresh-bar">
    <button type="button" class="btn lib-add-by-link" ${addAttrs}>+ Добавить по ссылке</button>
    ${addCatHtml}
    ${libLinkRefreshBarHtml()}
  </div>`;
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
  // Правка ЦЕНЫ (а не названия/размеров/единицы измерения) снимает пометку о
  // неточной цене — см. libClearPriceNote/LIB_PRICE_EDIT_FIELDS. Проверяем сам
  // факт подтверждения ячейки, а не изменение значения: подтвердить то же
  // число — тоже «я проверил цену». С экрана пометка уходит сразу, её рисует
  // renderLibraryPanel() в конце этой же функции.
  if (LIB_PRICE_EDIT_FIELDS.indexOf(field) >= 0) libClearPriceNote(it, true);
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
  // Фурнитура (group вида 'hw:*') с 2026-09-15 тоже входит в снимок каталога
  // (см. snapshotCatalogCollections/restoreCatalogFrom — добавлено вместе с
  // фичей «Добавить по ссылке», иначе позиции фурнитуры, добавленные по
  // ссылке, не переживали бы перезагрузку страницы), поэтому сохраняем
  // безусловно, как и остальные группы.
  scheduleCatalogSave();
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
function libAddRow(group, path) {
  if (!requireLibraryEditAuth()) return;
  const cat = window.Modul3D.catalog;
  path = path || [];
  if (group.indexOf('hwadd:') === 0) {
    libAddHardwareRow(group.slice(6), path);
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
  // с 2026-09-15 тоже сохраняется (см. комментарий в libSaveEdit про
  // расширение snapshotCatalogCollections/restoreCatalogFrom).
  scheduleCatalogSave();
  renderLibraryPanel();
}

// ---------------------------------------------------------------------------
// «− Удалить материал» под таблицей листа (см. libLeafTableHtml/
// state.libSelectedRow) — в отличие от deleteMaterialPick (кнопки «Удалить
// материал» в «Параметрах проекта» у Материал корпуса/фасада/Задняя стенка,
// которые знают ТОЛЬКО про decor/back), эта работает с ЛЮБОЙ из пяти
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

// Ключи HARDWARE_PRICES/FASTENER_PRICES, заведённые САМИМ пользователем через
// «+ Добавить позицию» (libAddHardwareRow) или «+ Добавить по ссылке»
// (libLinkSaveHardware) — единственные позиции этих двух объектов, которые
// точно безопасно удалять. specification.js читает большинство ОСТАЛЬНЫХ
// («родных») ключей напрямую по литеральному имени (hinge, hingeGlass,
// pushToOpen, leg, legPlastic, plinthClip, shelfSupport, shelfSupportGlass,
// rod, rodHolder, countertopGlueToCarcass, countertopSealant,
// countertopCornerTie, countertopStraightTie — из HARDWARE_PRICES; confirmat,
// minifixBolt, minifixCam, dowel, backPanelScrew, worktopScrew — из
// FASTENER_PRICES, ВСЕ 6 ключей), и удаление любого из них либо уронит расчёт
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
// стенки/столешницы — используется и deleteMaterialPick (кнопка «Удалить
// материал» в «Параметрах проекта»), и libDeleteSelectedRow (кнопка «−
// Удалить материал» в «Библиотеке»), чтобы не дублировать проверку для
// каждой роли отдельно. group — ИСТИННОЕ происхождение удаляемой позиции
// (то же значение, что у entry.group в libTopEntries / sel.group в
// libDeleteSelectedRow, либо LIB_PICK_ROLE_GROUP[role] у deleteMaterialPick):
// 'decors' | 'back' | 'facade' | 'countertop'. Кромка ('edge') сюда
// сознательно не входит — по требованию пользователя edgeCode при удалении
// не проверяется. Возвращает массив { moduleName, part } — по одной записи
// на каждое найденное место использования (весь state.modules, а не только
// активный/выделенный модуль).
function libFindMaterialUsages(group, code) {
  const usages = [];
  if (!code) return usages;
  // decor/facadeDecor/back — ОБЩИЕ на весь проект поля (state.decorCode/
  // state.facadeDecorCode/state.backCode, см. materialsBlock) — decorCode
  // корпуса и фасада применяется разом ко ВСЕМ модулям проекта, поэтому
  // здесь одна запись «Проект целиком», а не по записи на каждый модуль.
  if (group === 'decors') {
    if (state.decorCode === code) usages.push({ moduleName: 'Проект целиком', part: 'материал корпуса (общий на весь проект)' });
    if (state.facadeDecorCode === code) usages.push({ moduleName: 'Проект целиком', part: 'материал фасада (общий на весь проект)' });
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
    // sec.drawerDecorCode — материал ящиков конкретной секции (переопределяет
    // проектный drawerDecorCode, см. drawersPanelBlock/newSection).
    if (group === 'decors') {
      (mod.sections || []).forEach((sec, si) => {
        if (sec.drawerDecorCode === code) {
          usages.push({ moduleName: name, part: `материал ящиков — секция ${si + 1}` });
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
    // mod.partOverrides[key].materialOverride — ручное переопределение
    // материала конкретной детали с экрана «Деталь» (#partMaterial, см.
    // ensureOverride().materialOverride ниже по файлу). key — это
    // `[kind, section, side, index].join('|')` (applyPartOverrides в
    // engine.js), поэтому kind = key.split('|')[0] всегда один из
    // OVERRIDABLE_KINDS ('side'/'bottom'/'top'/'back'/'plinth'). Каталог,
    // из которого выбирается код, зависит от kind: 'back' → BACK_MATERIALS
    // (группа 'back'), любой другой overridable kind → DECORS (группа
    // 'decors') — см. `const decorList = kind === 'back' ? BACK_MATERIALS
    // : DECORS;` в partEditorBlock. Сравниваем только с той группой,
    // которая реально соответствует kind, иначе переопределение задней
    // стенки ложно всплывёт при удалении из «decors» и наоборот.
    if (group === 'decors' || group === 'back') {
      Object.keys(mod.partOverrides || {}).forEach((key) => {
        const ov = mod.partOverrides[key];
        if (!ov || ov.materialOverride !== code) return;
        const kind = key.split('|')[0];
        const ovGroup = kind === 'back' ? 'back' : 'decors';
        if (ovGroup !== group) return;
        const title = PART_KIND_TITLES[kind] || kind;
        usages.push({ moduleName: name, part: `деталь «${title}» — ручное переопределение материала` });
      });
    }
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
  // сейчас активен как state.decorCode/facadeDecorCode/backCode. Кнопка
  // «Удалить материал» (deleteMaterialPick) всегда удаляет ТЕКУЩЕЕ значение
  // этого поля, а не тот код, который был активен в момент открытия этого
  // окна — значит переключение соседнего селекта на другой материал и
  // повторное нажатие той же кнопки удалит уже НОВЫЙ материал, а не «${name}».
  // Подсказываем явный путь через «Библиотека → Листовые материалы»
  // (libDeleteSelectedRow), где выбор строки не привязан к активному
  // значению проекта.
  const isActiveProjectMaterial = usages.some((u) => u.moduleName === 'Проект целиком');
  const hintHtml = isActiveProjectMaterial
    ? `<p class="hint">Этот материал сейчас выбран как активный (материал корпуса / фасада / задней стенки проекта) — кнопка «Удалить материал» всегда удаляет ТЕКУЩЕЕ выбранное значение, поэтому переключение соседнего селекта и повторное нажатие этой же кнопки удалит уже другой, новый материал, а не «${esc(name)}». Чтобы удалить именно «${esc(name)}»: сначала выберите в соседнем селекте параметров проекта любой ДРУГОЙ материал, а затем удалите «${esc(name)}» через «Библиотека → Листовые материалы» — там выбор строки не привязан к активному значению проекта.</p>`
    : `<p class="hint">Сначала замените материал в перечисленных местах вручную (в «Параметрах проекта» или на нужном модуле), затем повторите удаление.</p>`;
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
// FileReader → dataURL, без бэкенда.
let pendingLibImageTarget = null;
function openLibImagePicker(group, key) {
  if (!requireLibraryEditAuth()) return;
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
  // Та же причина — открытый кастомный список «Сайт-источник» формы
  // «Добавить по ссылке» (см. libLinkSitePickerHtml/openLibLinkSiteMenu)
  // держит ссылку на DOM-узел, который вот-вот пропадёт.
  closeLibLinkSiteMenu();
  // И меню «Перенести … в:» (см. openLibMoveMenu) — оно привязано к значку ⇄
  // конкретной строки дерева/таблицы, которая сейчас перерисуется.
  closeLibMoveMenu();
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
  else panel.innerHTML = libraryBlock();   // 'modules' — существующая база модулей, без изменений
  bindLibraryEvents();
  applyLibrarySearch();
  // Применяет уже сохранённое состояние поповера сортировки/фильтра (см.
  // openColumnFilterMenu/columnFilterStates) к каждой заново отрисованной
  // таблице листа отдельно (ключ — data-chars-key, тот же, что и у кнопки
  // «Характеристики листа») — иначе после переключения дерева/добавления позиции
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
function libraryFacadesBlock() {
  return `
    <h3>Двери</h3>
    ${state.libLinkForm && state.libLinkForm.kind === 'materials' ? libLinkFormHtml(state.libLinkForm) : ''}
    ${libTopCategoryHtml('facade', 'Виды фасадов', { addLabel: '+ Добавить материал' })}`;
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

  panel.addEventListener('click', (e) => {
    // Клик внутри активного инпута инлайн-переименования узла дерева (см.
    // startTreeRename) — не должен провалиться в обработку клика по строке
    // ниже (иначе строка переключилась бы посреди редактирования).
    if (e.target.closest('.lib-tree-name input')) return;
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
    // «+ Добавить категорию» — кнопка уровня вкладки «Фурнитура» (см.
    // libLinkTopBarHtml/libAddHwCategory), заводит СВОЮ корневую категорию.
    if (e.target.closest('.lib-add-hw-cat')) { libAddHwCategory(); return; }
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
    // Кнопка-тумблер «Характеристики листа» (см. libLeafTableHtml) — общий
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
      libAddRow(addBtn.dataset.add, pathStr ? pathStr.split('::') : []);
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
// выбранный в этом же селекте код из своего массива каталога (decor/
// facadeDecor читают ОДИН и тот же массив DECORS). Изменено 2026-09-12: перед
// удалением проверяем через libFindMaterialUsages, не используется ли этот
// код хоть где-то в проекте — если да, удаление блокируется целиком и
// показывается showLibUsageModal() со списком мест использования (никакой
// молчаливой замены на другой материал, как раньше). ВАЖНО: curCode здесь —
// это ВСЕГДА текущее значение state.decorCode/facadeDecorCode/backCode самого
// проекта, то есть по определению «используется» как материал корпуса/
// фасада/задней стенки — значит эта кнопка теперь блокируется практически
// всегда, пока пользователь сам не выберет в соседнем селекте ДРУГОЙ материал
// (тогда curCode станет этим новым кодом, а старый перестанет быть активным
// значением проекта и, если не используется больше нигде, будет доступен для
// удаления через «Библиотеку» — см. libDeleteSelectedRow, у которой выбор
// строки не привязан к активному значению проекта). Роли 'countertopDecor'
// здесь больше нет: «Изменить» у столешницы (см. countertopPanelBlock)
// вызывает только openMaterialPicker, без варианта удаления — убрано по
// просьбе пользователя 2026-09-06.
function deleteMaterialPick(role) {
  if (!requireLibraryEditAuth()) return;
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
  const usages = libFindMaterialUsages(targetGroup, curCode);
  if (usages.length) { showLibUsageModal(arr[idx].name, usages); return; }
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
// которой зависит от каталога («Материалы», «Двери», «Фурнитура») —
// используется, чтобы решить, нужно ли перерисовывать её содержимое сразу
// после фоновой подгрузки/отката правок каталога (restoreCatalogFrom мутирует
// и FACADE_MATERIALS — с 2026-09-15 это данные категории «Виды фасадов» на
// вкладке «Двери», а не только «Материалов», см. libraryFacadesBlock — и все
// четыре источника фурнитуры вместе с деревом её категорий, см.
// state.libHwCatLabels/libHwCustomCats).
function isLibraryMaterialsPanelOpen() {
  const drawer = document.getElementById('drawer-library');
  return !!drawer && drawer.classList.contains('open')
    && (state.libraryTab === 'materials' || state.libraryTab === 'facades' || state.libraryTab === 'hardware');
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
  document.addEventListener('keydown', (e) => {
    const tg = (e.target && e.target.tagName) || '';
    if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
    if (e.key !== 'Delete' && e.key !== 'Del') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!state.modules.length) return;
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
