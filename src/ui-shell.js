/* =========================================================================
   Modul3D — UI Shell
   Слой интерфейса: темы, выдвижные панели, положение рейки панелей
   (в шапке / слева / справа сверху / слева снизу), положение панели режимов
   3D-вида (внизу по центру / слева / справа / в шапке), Focus Mode, HUD на модели,
   поиск по параметрам, горячие клавиши, мобильная шторка.

   ВАЖНО: файл не трогает параметрическое ядро. Он только:
   · читает и пишет значения в уже существующие поля панели (#m-width и т.п.)
     и посылает им штатное событие 'change' — ровно то, что делает пользователь;
   · перехватывает конструктор Viewer3D, чтобы знать экземпляр сцены и
     перекрашивать фон/пол/сетку под тему.
   Подключать ПОСЛЕ viewer.js и ДО app.js.
   ========================================================================= */
(function () {
'use strict';

var THEME_KEY = 'modul3d.theme';
var STATE_KEY = 'modul3d.ui';
var CURRENCY_KEY = 'modul3d.currency';
// Положение рейки панелей. Тот же ключ и те же значения читает короткий
// скрипт в <head> index.html (раннее чтение, чтобы не мигало) — менять вместе.
var RAIL_POS_KEY = 'modul3d.railPos';
// По умолчанию — 'header-end' (в шапке после логотипа), см. normalizeRailPos.
var RAIL_POSITIONS = ['left', 'header-start', 'header-end', 'top-right', 'bottom-left'];
var RAIL_POS_DEFAULT = 'header-end';

var viewerInstance = null;
var lastPointer = { x: 0, y: 0 };
var openPanel = null;
var hudModule = null;
// Раскрыт ли инлайн-степпер «Разделить на отсеки» в HUD (см. renderHud) —
// сбрасывается при каждом показе/скрытии HUD, чтобы степпер не оставался
// развёрнутым при переключении на другой модуль.
var hudSplitOpen = false;
var syncingDocs = false;
// Положение рейки панелей (см. раздел 3б) — одно из RAIL_POSITIONS; и текущий
// перелёт рейки (WAAPI-анимация), чтобы новый не накладывался на идущий.
var railPos = RAIL_POS_DEFAULT;
var railAnim = null;

/* ---------------------------------------------------------------------------
   0. Валюта проекта — единое глобальное состояние (window.Modul3D.currency).
   По умолчанию лей MDL — цены каталога (src/catalog.js) сверены с сайтом
   mobilier.md и реально указаны в молдавских леях, поэтому дефолт следует
   за источником цен, а не наоборот. Читается из app.js (спецификация,
   таблицы «Библиотеки») через getSymbol().
--------------------------------------------------------------------------- */
var CURRENCY_PRESETS = [
  { code: 'RUB', symbol: '₽', label: '₽ Российский рубль' },
  { code: 'USD', symbol: '$', label: '$ Доллар США' },
  { code: 'EUR', symbol: '€', label: '€ Евро' },
  { code: 'MDL', symbol: 'лей', label: 'лей Молдавский лей' }
];
var currencyState = { code: 'MDL', symbol: 'лей', custom: false };

function loadCurrency() {
  try {
    var saved = JSON.parse(localStorage.getItem(CURRENCY_KEY) || 'null');
    if (saved && saved.symbol) currencyState = saved;
  } catch (e) { /* приватный режим / битые данные — остаёмся на лей MDL */ }
}
function saveCurrencyState() {
  try { localStorage.setItem(CURRENCY_KEY, JSON.stringify(currencyState)); } catch (e) { /* ok */ }
}

// Принимает либо код пресета ('RUB'/'USD'/'EUR'/'MDL'), либо 'CUSTOM' + свой
// символ/название вторым аргументом, либо готовый объект {code,symbol,custom}.
function setCurrency(codeOrState, customSymbol) {
  if (codeOrState && typeof codeOrState === 'object') {
    currencyState = { code: codeOrState.code || 'CUSTOM', symbol: codeOrState.symbol || '', custom: !!codeOrState.custom };
  } else {
    var preset = null;
    for (var i = 0; i < CURRENCY_PRESETS.length; i++) {
      if (CURRENCY_PRESETS[i].code === codeOrState) { preset = CURRENCY_PRESETS[i]; break; }
    }
    currencyState = preset
      ? { code: preset.code, symbol: preset.symbol, custom: false }
      : { code: 'CUSTOM', symbol: customSymbol || codeOrState || '', custom: true };
  }
  saveCurrencyState();
  renderCurrencyOptions();
  // app.js перерисовывает только то, что показывает цену (спецификация,
  // таблицы «Библиотеки») — без полного recompute(), это дешевле и укладывается
  // в требование «не более 1-2 секунд».
  if (window.Modul3D.app && typeof window.Modul3D.app.refreshCurrency === 'function') {
    window.Modul3D.app.refreshCurrency();
  }
}
function getCurrency() { return currencyState; }
function getCurrencySymbol() { return currencyState.symbol; }

loadCurrency();
window.Modul3D = window.Modul3D || {};
window.Modul3D.currency = {
  get: getCurrency,
  set: setCurrency,
  getSymbol: getCurrencySymbol,
  PRESETS: CURRENCY_PRESETS
};

function renderCurrencyOptions() {
  var box = document.getElementById('currencyOptions');
  if (!box) return;
  var cur = currencyState;
  var html = '';
  for (var i = 0; i < CURRENCY_PRESETS.length; i++) {
    var c = CURRENCY_PRESETS[i];
    var checked = (!cur.custom && cur.code === c.code) ? ' checked' : '';
    html += '<label class="currency-opt"><input type="radio" name="currencyChoice" value="'
      + c.code + '"' + checked + '> ' + escapeHtml(c.label) + '</label>';
  }
  box.innerHTML = html;
  var customInput = document.getElementById('currencyCustomInput');
  if (customInput && document.activeElement !== customInput) customInput.value = cur.custom ? cur.symbol : '';
  // Заголовок сворачиваемого блока (см. #currencyCollapseToggle) — всегда
  // показывает текущую валюту, а не название последнего выбранного пункта.
  var collapseLabel = document.getElementById('currencyCollapseLabel');
  if (collapseLabel) collapseLabel.textContent = cur.symbol || '—';
}

function initCurrency() {
  var toggle = document.getElementById('currencyToggle');
  var pop = document.getElementById('currencyPopover');
  var options = document.getElementById('currencyOptions');
  var customInput = document.getElementById('currencyCustomInput');
  var collapseToggle = document.getElementById('currencyCollapseToggle');
  var collapseBody = document.getElementById('currencyCollapseBody');
  var collapseArrow = collapseToggle ? collapseToggle.querySelector('.currency-collapse-arrow') : null;
  // Строка «Горячие клавиши» — сворачиваемый блок по образцу валюты выше:
  // клик по кнопке #focusHintBtn или по всей строке разворачивает список
  // под ней (см. #hotkeysCollapseBody в index.html).
  var hotkeysRow = document.getElementById('hotkeysToggleRow');
  var hotkeysBody = document.getElementById('hotkeysCollapseBody');
  var hotkeysBtn = document.getElementById('focusHintBtn');
  if (!toggle || !pop) return;
  renderCurrencyOptions();

  function collapseCurrency() {
    if (collapseBody) collapseBody.style.display = 'none';
    if (collapseToggle) collapseToggle.setAttribute('aria-expanded', 'false');
    if (collapseArrow) collapseArrow.textContent = '▾';
  }
  function expandCurrency() {
    if (collapseBody) collapseBody.style.display = 'block';
    if (collapseToggle) collapseToggle.setAttribute('aria-expanded', 'true');
    if (collapseArrow) collapseArrow.textContent = '▴';
  }
  function collapseHotkeys() {
    if (hotkeysBody) hotkeysBody.style.display = 'none';
    if (hotkeysBtn) hotkeysBtn.setAttribute('aria-expanded', 'false');
  }
  function expandHotkeys() {
    if (hotkeysBody) hotkeysBody.style.display = 'block';
    if (hotkeysBtn) hotkeysBtn.setAttribute('aria-expanded', 'true');
  }

  toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    var willOpen = pop.style.display === 'none';
    pop.style.display = willOpen ? 'block' : 'none';
    // Панель настроек всегда открывается со свёрнутыми списком валют и
    // горячими клавишами — сама валюта видна и так, в заголовке блока.
    if (willOpen) { collapseCurrency(); collapseHotkeys(); collapseRailPos(); collapseVtPos(); }
  });
  pop.addEventListener('click', function (e) { e.stopPropagation(); });
  document.addEventListener('click', function (e) {
    if (pop.style.display !== 'none' && !pop.contains(e.target) && e.target !== toggle) {
      pop.style.display = 'none';
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') pop.style.display = 'none';
  });

  if (collapseToggle) collapseToggle.addEventListener('click', function () {
    if (collapseToggle.getAttribute('aria-expanded') === 'true') collapseCurrency();
    else expandCurrency();
  });

  // Клик по кнопке #focusHintBtn всплывает до строки — один обработчик
  // на всю строку покрывает оба способа клика (по кнопке и рядом с ней).
  if (hotkeysRow) hotkeysRow.addEventListener('click', function () {
    if (hotkeysBtn && hotkeysBtn.getAttribute('aria-expanded') === 'true') collapseHotkeys();
    else expandHotkeys();
  });

  if (options) options.addEventListener('change', function (e) {
    var el = e.target.closest && e.target.closest('input[name="currencyChoice"]');
    if (!el) return;
    setCurrency(el.value);
  });
  if (customInput) customInput.addEventListener('change', function () {
    var v = (customInput.value || '').trim();
    if (!v) return;
    setCurrency('CUSTOM', v);
  });
}

/* ---------------------------------------------------------------------------
   1. Перехват экземпляра Viewer3D (нужен только для перекраски сцены)
--------------------------------------------------------------------------- */
(function hookViewer() {
  var vw = window.Modul3D && window.Modul3D.viewer;
  if (!vw || !vw.Viewer3D) return;
  var Orig = vw.Viewer3D;
  function Wrapped(el, opts) {
    var inst = new Orig(el, opts);
    viewerInstance = inst;
    try { applyTheme3D(currentTheme()); } catch (e) { /* сцена не критична */ }
    return inst;
  }
  Wrapped.prototype = Orig.prototype;
  vw.Viewer3D = Wrapped;
})();

/* ---------------------------------------------------------------------------
   2. Темы
--------------------------------------------------------------------------- */
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}

var THEME_3D = {
  light: { bg: 0xeef2f7, floor: 0xdcdfe4, grid1: 0xa8b0ba, grid2: 0xc9d0d8 },
  dark:  { bg: 0x14171c, floor: 0x23272e, grid1: 0x39414c, grid2: 0x2a3037 }
};

function applyTheme3D(theme) {
  if (!viewerInstance || !window.THREE) return;
  var c = THEME_3D[theme] || THEME_3D.light;
  var scene = viewerInstance.scene;
  if (!scene) return;

  if (scene.background && scene.background.set) scene.background.set(c.bg);
  else scene.background = new window.THREE.Color(c.bg);

  if (viewerInstance._floor && viewerInstance._floor.material) {
    viewerInstance._floor.material.color.set(c.floor);
  }
  // GridHelper раскрашен по вершинам — перекрасить нельзя, пересоздаём.
  var old = null;
  for (var i = 0; i < scene.children.length; i++) {
    var ch = scene.children[i];
    if (ch && (ch.isGridHelper || ch.type === 'GridHelper')) { old = ch; break; }
  }
  if (old) {
    scene.remove(old);
    if (old.geometry && old.geometry.dispose) old.geometry.dispose();
    if (old.material && old.material.dispose) old.material.dispose();
  }
  var grid = new window.THREE.GridHelper(14, 56, c.grid1, c.grid2);
  scene.add(grid);
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* приватный режим */ }
  var sun = document.querySelector('#themeToggle .ic-sun');
  var moon = document.querySelector('#themeToggle .ic-moon');
  if (sun && moon) {
    sun.style.display = theme === 'dark' ? 'none' : '';
    moon.style.display = theme === 'dark' ? '' : 'none';
  }
  applyTheme3D(theme);
}

function initTheme() {
  var saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* нет доступа */ }
  if (!saved) {
    var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    saved = (mq && mq.matches) ? 'dark' : 'light';
  }
  setTheme(saved);
  var btn = document.getElementById('themeToggle');
  if (btn) btn.addEventListener('click', function () {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  });
}

/* ---------------------------------------------------------------------------
   3. Выдвижные панели (off-canvas)
--------------------------------------------------------------------------- */
function drawerOf(name) {
  return document.querySelector('[data-drawer-panel="' + name + '"]');
}

function syncTriggers() {
  // «Параметры проекта» (data-panelview="module") — общий вход в панель
  // params: подсвечивается и на экране «module», и на «materials» (у
  // экрана «Материалы» своей иконки в рейке нет). «Деталь»
  // (data-panelview="part") подсвечивается только на самом экране «part».
  var panelView = window.Modul3D.app && window.Modul3D.app.getPanelView && window.Modul3D.app.getPanelView();
  var all = document.querySelectorAll('[data-panel]');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el.getAttribute('data-scroll')) { el.classList.remove('active'); continue; }
    var panelMatch = el.getAttribute('data-panel') === openPanel;
    var pv = el.getAttribute('data-panelview');
    var active = panelMatch;
    if (panelMatch && pv) {
      active = pv === 'part' ? panelView === 'part' : panelView !== 'part';
    }
    el.classList.toggle('active', active);
  }
}

function openDrawer(name, scrollTo) {
  var el = drawerOf(name);
  if (!el) return;
  if (openPanel && openPanel !== name) closeDrawer(openPanel, true);
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  openPanel = name;
  document.body.classList.add('has-modal-drawer');
  syncTriggers();
  rememberUI();

  // «Документы» и вкладки app.js — один и тот же элемент .results
  if (name === 'docs') setResultsOpen(true);

  if (scrollTo) scrollToHeading(el, scrollTo);
}

function closeDrawer(name, silent) {
  var el = drawerOf(name || openPanel);
  if (!el) return;
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
  if (!name || name === openPanel) openPanel = null;
  if (!silent) {
    document.body.classList.remove('has-modal-drawer');
    syncTriggers();
    rememberUI();
  }
  if ((name || '') === 'docs') setResultsOpen(false);
  // Сброс режима подбора материала (см. app.js: state.libPickTarget/
  // clearLibraryPickTarget) — при ЛЮБОМ закрытии «Библиотеки», не только
  // после успешного выбора (тот путь сам обнуляет state и без этого хука).
  if ((name || '') === 'library' && window.Modul3D.app && window.Modul3D.app.clearLibraryPickTarget) {
    window.Modul3D.app.clearLibraryPickTarget();
  }
}

function toggleDrawer(name, scrollTo) {
  if (openPanel === name && !scrollTo) closeDrawer(name);
  else openDrawer(name, scrollTo);
}

function scrollToHeading(drawer, text) {
  var heads = drawer.querySelectorAll('h3, h4');
  for (var i = 0; i < heads.length; i++) {
    if ((heads[i].textContent || '').trim().toLowerCase().indexOf(String(text).toLowerCase()) === 0) {
      if (heads[i].scrollIntoView) heads[i].scrollIntoView({ block: 'start', behavior: 'smooth' });
      heads[i].animate && heads[i].animate(
        [{ opacity: .35 }, { opacity: 1 }], { duration: 600, easing: 'ease-out' });
      return;
    }
  }
}

/* .results — общий элемент с app.js: класс open ставит и он, и мы. */
function setResultsOpen(on) {
  var box = document.querySelector('.results');
  if (!box) return;
  syncingDocs = true;
  box.classList.toggle('open', !!on);
  setTimeout(function () { syncingDocs = false; }, 0);
  // Чертежи/деталировка/спецификация строятся лениво (app.js:
  // docsTabsDirty) — пока полоса свёрнута, их разметка намеренно
  // устаревшая. Панель «Документы» открывают и отсюда (кнопка HUD, горячая
  // клавиша D, восстановление состояния при загрузке), мимо setDocsTab,
  // поэтому просим приложение дособрать открывшуюся вкладку.
  if (on && window.Modul3D.app && window.Modul3D.app.ensureVisibleDocsTabBuilt) {
    window.Modul3D.app.ensureVisibleDocsTabBuilt();
  }
}

function watchResults() {
  var box = document.querySelector('.results');
  if (!box || !window.MutationObserver) return;
  new MutationObserver(function () {
    if (syncingDocs) return;
    var isOpen = box.classList.contains('open');
    if (isOpen && openPanel !== 'docs') openDrawer('docs');
    else if (!isOpen && openPanel === 'docs') closeDrawer('docs');
  }).observe(box, { attributes: true, attributeFilter: ['class'] });
}

function initDrawers() {
  document.addEventListener('click', function (e) {
    var trig = e.target.closest && e.target.closest('[data-panel]');
    if (trig) {
      e.preventDefault();
      var panelView = trig.getAttribute('data-panelview');
      // Кнопки с data-panelview (например «Материалы») переключают экран
      // внутри уже открытой панели — они всегда ОТКРЫВАЮТ панель, а не
      // тогглят её (иначе повторный клик закрывал бы уже открытую панель
      // вместо того, чтобы просто сменить в ней экран).
      if (panelView) openDrawer(trig.getAttribute('data-panel'));
      else toggleDrawer(trig.getAttribute('data-panel'), trig.getAttribute('data-scroll'));
      if (panelView && window.Modul3D.app && window.Modul3D.app.setPanelView) {
        window.Modul3D.app.setPanelView(panelView);
      }
      return;
    }
    var close = e.target.closest && e.target.closest('[data-close]');
    if (close) { closeDrawer(openPanel); return; }
    if (e.target.id === 'scrim') closeDrawer(openPanel);
  });
}

function rememberUI() {
  try { localStorage.setItem(STATE_KEY, JSON.stringify({ panel: openPanel })); } catch (e) { /* ok */ }
}

function restoreUI() {
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch (e) { saved = null; }
  var isNarrow = window.matchMedia && window.matchMedia('(max-width: 820px)').matches;
  // Первый запуск: на десктопе открываем параметры, на телефоне — чистый холст.
  var panel = saved ? saved.panel : (isNarrow ? null : 'params');
  // Пустой проект — панели «Параметры» нечего показать, кроме подсказки открыть
  // «Библиотеку» (см. emptyProjectBlock() в app.js). Открываем её сразу, не
  // заставляя пользователя догадываться. Работает и при первом запуске (нет
  // сохранённого состояния), и если позже удалить все модули и перезагрузить
  // страницу (запомненная панель была 'params', но модулей больше нет).
  var isEmpty = window.Modul3D.app && window.Modul3D.app.isProjectEmpty && window.Modul3D.app.isProjectEmpty();
  if (panel === 'params' && isEmpty) panel = 'library';
  if (panel) openDrawer(panel);
}

/* ---------------------------------------------------------------------------
   3б. Положение рейки триггеров: в шапке (перед логотипом или после
   него — по умолчанию) / слева / справа сверху / слева снизу
   Вся раскладка (где рейка, куда выезжают панели, подсказки, индикатор
   активной кнопки) — в CSS по атрибуту data-rail-pos на <html> (style.css,
   раздел 7б). Здесь только: выставить и запомнить атрибут, переставить саму
   рейку в DOM (в шапку или обратно на сцену — placeRailDom), плавно
   «перелететь» на новое место и обработать перетаскивание за ручку
   #railGrip. Поэтому новые положения не ломают openDrawer/closeDrawer —
   они про класс .open, а не про координаты; клики по кнопкам рейки ловит
   делегированный обработчик на document (initDrawers), так что перенос
   рейки в другой контейнер их не теряет.
--------------------------------------------------------------------------- */
// Кривая и длительность перелёта — те же, что --ease и --dur в style.css:
// Web Animations API не понимает var(), поэтому продублированы значением.
var RAIL_EASE = 'cubic-bezier(.22, .61, .36, 1)';
var RAIL_FLY_MS = 320;
// Сдвиг в px, с которого нажатие на ручку считается перетаскиванием. Меньше —
// это клик (или первая половина двойного клика), рейку не трогаем.
var RAIL_DRAG_THRESHOLD = 4;
// Пустышка на месте рейки в шапке, пока рейку тянут (см. initRailPosition:
// begin) — чтобы логотип не прыгал в момент, когда рейку «взяли в руки».
var railGhost = null;

function normalizeRailPos(v) {
  return RAIL_POSITIONS.indexOf(v) >= 0 ? v : RAIL_POS_DEFAULT;
}

// Положения, в которых рейка живёт в шапке (#topbar), а не на сцене
function isHeaderRailPos(p) {
  return p === 'header-start' || p === 'header-end';
}

function loadRailPos() {
  var saved = null;
  try { saved = localStorage.getItem(RAIL_POS_KEY); } catch (e) { /* нет доступа */ }
  // Положения «справа снизу» больше нет (v308: там навигационная гизма) —
  // сохранённое старое значение переезжает «слева снизу» и запоминается.
  // То же делает ранний скрипт в <head> index.html — менять вместе.
  if (saved === 'bottom-right') { saved = 'bottom-left'; saveRailPos(saved); }
  return normalizeRailPos(saved);
}

function saveRailPos(pos) {
  try { localStorage.setItem(RAIL_POS_KEY, pos); } catch (e) { /* приватный режим */ }
}

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// Отступ рейки от краёв сцены — тот же --sp-3, что в CSS (left/right/top/bottom
// у .rail), чтобы «якоря» перетаскивания совпадали с настоящими местами рейки.
function railMargin() {
  var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sp-3'));
  return isNaN(v) ? 12 : v;
}

// Физически переставляет рейку туда, где она должна жить при положении pos:
//   header-start — в шапку перед блоком логотипа (.brand);
//   header-end   — в шапку сразу после него;
//   остальные    — на сцену (#stage), в конец, как в разметке.
// В шапке рейка — обычный элемент flex-строки: логотип сдвигается сам, а
// кнопки справа не перекрываются (им место отдаёт margin-left: auto, см.
// style.css 7б). Тот же перенос до первой отрисовки делает короткий скрипт
// сразу после </nav> в index.html — менять вместе.
function placeRailDom(rail, pos) {
  if (!rail) return;
  if (isHeaderRailPos(pos)) {
    var bar = document.getElementById('topbar');
    var brand = bar && bar.querySelector('.brand');
    if (!brand) return;
    var ref = pos === 'header-start' ? brand : brand.nextElementSibling;
    if (ref === rail) return;
    if (pos === 'header-start' && rail.parentNode === bar && rail.nextElementSibling === brand) return;
    bar.insertBefore(rail, ref);
  } else {
    var stage = document.getElementById('stage');
    if (!stage || rail.parentNode === stage) return;
    stage.appendChild(rail);
  }
}

// Подсветка активного положения в настройках (шестерёнка) — при любом способе
// смены: клик по кнопке, перетаскивание, двойной клик по ручке.
// Строка-заголовок свёрнутого блока (#railPosCollapseToggle) — та же схема и
// подпись, что у выбранной миниатюры (см. syncPosButtons).
function syncRailPosButtons() {
  syncPosButtons('data-rail-set', railPos, 'railPosCollapseLabel', 'railPosCurrentIcon');
}

// Сворачивание блока «Положение панели» в шестерёнке — по образцу валюты
// (initCurrency: collapseCurrency/expandCurrency). Свёрнут при каждом
// открытии настроек и после выбора миниатюры.
// Общая для двух блоков «Положение …» (рейка и панель режимов 3D, см. 3в):
// сетка миниатюр segId и строка-заголовок toggleId.
function setPosSegExpanded(segId, toggleId, open) {
  var seg = document.getElementById(segId);
  var t = document.getElementById(toggleId);
  var arrow = t ? t.querySelector('.currency-collapse-arrow') : null;
  if (seg) seg.style.display = open ? 'grid' : 'none';
  if (t) t.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (arrow) arrow.textContent = open ? '▴' : '▾';
}
function setRailPosExpanded(open) { setPosSegExpanded('railPosSeg', 'railPosCollapseToggle', open); }
function collapseRailPos() { setRailPosExpanded(false); }
function expandRailPos() { setRailPosExpanded(true); }

// Подсветка выбранной миниатюры в блоке «Положение …» и копия её схемы и
// подписи в строку-заголовок свёрнутого блока. attr — data-атрибут миниатюр
// (data-rail-set / data-vt-set), value — выбранное положение.
function syncPosButtons(attr, value, labelId, iconId) {
  var btns = document.querySelectorAll('[' + attr + ']');
  for (var i = 0; i < btns.length; i++) {
    var on = btns[i].getAttribute(attr) === value;
    btns[i].classList.toggle('active', on);
    btns[i].setAttribute('aria-checked', on ? 'true' : 'false');
    if (on) {
      var lbl = document.getElementById(labelId);
      var icon = document.getElementById(iconId);
      var txt = btns[i].querySelector('span');
      var svg = btns[i].querySelector('svg');
      if (lbl && txt) lbl.textContent = txt.textContent;
      if (icon && svg) icon.innerHTML = svg.outerHTML;
    }
  }
}

// Плавный перелёт рейки из прежнего места на новое (приём FLIP): положение уже
// поменял CSS, здесь только «отматываем» рейку на старое место через transform
// и отпускаем. Рейка при смене положения меняет и форму (столбик ↔ строка),
// поэтому совмещаем ЦЕНТРЫ старого и нового прямоугольника — форма меняется
// «на месте», дальше рейка едет к углу.
//   fade — рейка сменила контейнер (шапка ↔ сцена): сцена обрезает всё, что
//   за её краем (overflow: clip), и кусок пути над шапкой не был бы виден —
//   поэтому такой перелёт ещё и проявляется из прозрачности, без «рывка».
// Сам FLIP — общий для рейки и панели режимов 3D (раздел 3в). Возвращает
// запущенную анимацию или null (нечего анимировать / без анимаций).
function flipFrom(el, first, fade) {
  if (!el.animate || prefersReducedMotion()) return null;
  var last = el.getBoundingClientRect();
  var dx = (first.left + first.width / 2) - (last.left + last.width / 2);
  var dy = (first.top + first.height / 2) - (last.top + last.height / 2);
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return null;
  // WAAPI подменяет transform целиком, а у рейки слева он свой (translateY(-50%)
  // — центровка по высоте), поэтому «до» и «после» строим от него
  var base = getComputedStyle(el).transform;
  if (!base || base === 'none') base = '';
  var from = { transform: 'translate(' + dx + 'px, ' + dy + 'px) ' + base };
  var to = { transform: base || 'none' };
  // проявление — до обычной прозрачности элемента в новом месте (на сцене в
  // покое рейка бледнее), иначе в конце анимации был бы рывок
  if (fade) { from.opacity = 0; to.opacity = getComputedStyle(el).opacity; }
  return el.animate([from, to], { duration: RAIL_FLY_MS, easing: RAIL_EASE });
}

function flyRail(rail, first, fade) {
  var a = flipFrom(rail, first, fade);
  if (!a) return;
  railAnim = a;
  a.onfinish = a.oncancel = function () { if (railAnim === a) railAnim = null; };
}

// Открытая панель при смене положения перескакивает на другую сторону (CSS
// переставляет её мгновенно, см. body.rail-moving) — чтобы это не выглядело
// как «моргнуло», короткое появление с небольшим сдвигом от нового края.
function replayOpenDrawer() {
  if (!openPanel || prefersReducedMotion()) return;
  var el = drawerOf(openPanel);
  if (!el || !el.animate) return;
  var from = el.classList.contains('drawer-bottom') ? 'translateY(24px)'
    : (railPos === 'top-right' ? 'translateX(24px)' : 'translateX(-24px)');
  el.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }],
    { duration: RAIL_FLY_MS, easing: RAIL_EASE });
}

// Единая точка смены положения: и для кликов в настройках, и для конца
// перетаскивания, и для двойного клика по ручке.
//   opts.fromDrag — рейка сейчас в руках у пользователя (висит в <body> с
//   классом .rail-floating, стоят inline-координаты и body.rail-dragging):
//   их надо снять и вернуть рейку в её контейнер, даже если положение то же
//   (отмена по Esc, отпустили возле прежнего места).
function setRailPos(pos, opts) {
  opts = opts || {};
  pos = normalizeRailPos(pos);
  var prev = railPos;
  var changed = pos !== prev;
  if (!changed && !opts.fromDrag) { syncRailPosButtons(); return; }

  var rail = document.getElementById('rail');
  var root = document.documentElement;
  // Откуда лететь: где рейка на экране прямо сейчас (в конце перетаскивания —
  // там, где её отпустили; при идущем перелёте — с учётом его transform).
  // Снимаем ДО любых изменений. Нулевая ширина — рейки нет (мобильная раскладка).
  var first = (rail && rail.offsetWidth) ? rail.getBoundingClientRect() : null;
  if (railAnim) { railAnim.cancel(); railAnim = null; }
  if (rail) {
    // координаты, которые ставило перетаскивание, — долой: дальше место
    // рейки задаёт только CSS по data-rail-pos
    rail.style.left = ''; rail.style.top = '';
    rail.style.right = ''; rail.style.bottom = '';
    rail.style.transform = '';
    rail.classList.remove('rail-floating');
  }
  if (railGhost) { if (railGhost.parentNode) railGhost.parentNode.removeChild(railGhost); railGhost = null; }
  document.body.classList.remove('rail-dragging');

  // Перенос в DOM и смена атрибута — при отключённых переходах панелей
  // (body.rail-moving); пересчёт стилей (offsetWidth) форсируем до снятия
  // класса — тогда панели встают на новые места сразу, а не «переезжают»
  // через весь экран.
  document.body.classList.add('rail-moving');
  placeRailDom(rail, pos);
  if (changed) {
    root.setAttribute('data-rail-pos', pos);
    railPos = pos;
    saveRailPos(pos);
  }
  void root.offsetWidth;
  document.body.classList.remove('rail-moving');
  syncRailPosButtons();

  // HUD запомнил, где его поставили, и мог оказаться под рейкой на новом месте.
  // До flyRail: после запуска перелёта рейка на первом кадре ещё на старом
  // месте, и placeHud мерил бы пересечение не с тем прямоугольником.
  if (changed && hudModule) placeHud();
  // После перетаскивания рейка летит из <body> (поверх всего) — обрезать
  // нечего; переключение в настройках между шапкой и сценой — с проявлением.
  var fade = !opts.fromDrag && isHeaderRailPos(prev) !== isHeaderRailPos(pos);
  if (first && rail && rail.offsetWidth) flyRail(rail, first, fade);
  if (changed && first) replayOpenDrawer();
  // Рейка ушла в шапку / из шапки — у панели режимов 3D могло поменяться,
  // помещается ли она в шапку (см. effectiveVtPos)
  if (changed) applyVtPlacement({ animate: true });
}

// «Якоря» — прямоугольники (в координатах окна), где рейка стояла бы в
// каждом из пяти положений. По ним рисуются контуры .rail-zone и ищется
// ближайшее положение при перетаскивании.
//   size.stage  — рейка-«плашка» на сцене: {w, h} столбика (строка справа
//                 сверху / слева снизу — тот же прямоугольник, повёрнутый на 90°);
//   size.header — плоская строка в шапке: {w, h}.
// Место в шапке: header-start — от левого края шапки (её левый отступ),
// header-end — сразу за логотипом, каким он виден СЕЙЧАС (плюс зазор
// flex-строки). Рейка в этот момент «в руках», а в шапке на её месте стоит
// пустышка, так что логотип не сдвинут: если рейку взяли из header-start,
// контур «после логотипа» и получается правее логотипа, не наезжая на
// контур «перед логотипом». Если рейку тянут со сцены, логотип стоит у
// левого края, и два контура в шапке частично перекрываются — ближайший
// всё равно определяется однозначно, по центрам.
function railAnchors(size, m) {
  var stage = document.getElementById('stage');
  var bar = document.getElementById('topbar');
  var brand = bar && bar.querySelector('.brand');
  var out = {};
  if (stage) {
    var sr = stage.getBoundingClientRect();
    var lo = Math.min(size.stage.w, size.stage.h), hi = Math.max(size.stage.w, size.stage.h);
    out['left'] = { x: sr.left + m, y: sr.top + (sr.height - hi) / 2, w: lo, h: hi };
    out['top-right'] = { x: sr.right - m - hi, y: sr.top + m, w: hi, h: lo };
    out['bottom-left'] = { x: sr.left + m, y: sr.bottom - m - lo, w: hi, h: lo };
  }
  if (bar && brand) {
    var tr = bar.getBoundingClientRect();
    var cs = getComputedStyle(bar);
    var pad = parseFloat(cs.paddingLeft) || 0;
    var gap = parseFloat(cs.columnGap) || 0;
    var hw = size.header.w, hh = size.header.h;
    var y = tr.top + (tr.height - hh) / 2;
    out['header-start'] = { x: tr.left + pad, y: y, w: hw, h: hh };
    out['header-end'] = { x: brand.getBoundingClientRect().right + gap, y: y, w: hw, h: hh };
  }
  return out;
}

// Ближайшее к центру рейки (cx, cy — в координатах окна) положение из якорей
function nearestRailPos(cx, cy, anchors, fallback) {
  var best = fallback, bestD = Infinity;
  for (var p in anchors) {
    if (!Object.prototype.hasOwnProperty.call(anchors, p)) continue;
    var a = anchors[p];
    var dx = a.x + a.w / 2 - cx, dy = a.y + a.h / 2 - cy;
    var d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function initRailPosition() {
  var rail = document.getElementById('rail');
  var grip = document.getElementById('railGrip');

  // Сохранённое положение (невалидное или пустое → header-end). Обычно атрибут уже выставлен
  // скриптом в <head>, а рейка уже перенесена в шапку скриптом после </nav>;
  // здесь — то же самое ещё раз, для синхронизации railPos и кнопок в настройках.
  railPos = loadRailPos();
  document.documentElement.setAttribute('data-rail-pos', railPos);
  placeRailDom(rail, railPos);
  syncRailPosButtons();

  // Переключатель в шестерёнке: то же самое, что и после перетаскивания
  var seg = document.getElementById('railPosSeg');
  if (seg) seg.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-rail-set]');
    if (!b) return;
    setRailPos(b.getAttribute('data-rail-set'));
    collapseRailPos();
    // выбранная кнопка скрылась вместе с сеткой — фокус на строку, а не в <body>
    var t = document.getElementById('railPosCollapseToggle');
    if (t) t.focus();
  });
  var railPosToggle = document.getElementById('railPosCollapseToggle');
  if (railPosToggle) railPosToggle.addEventListener('click', function () {
    if (railPosToggle.getAttribute('aria-expanded') === 'true') collapseRailPos();
    else expandRailPos();
  });

  if (!rail || !grip) return;

  var drag = null;     // { id, from, active, offX, offY, w, h, anchors, target } пока ручка зажата
  var dragEndedAt = 0; // когда закончилось последнее перетаскивание — см. dblclick ниже
  var zones = null;    // пять контуров-«магнитов», создаются при первом перетаскивании

  function ensureZones() {
    if (zones) return zones;
    zones = {};
    RAIL_POSITIONS.forEach(function (p) {
      var z = document.createElement('div');
      z.className = 'rail-zone';
      z.setAttribute('data-zone', p);
      z.setAttribute('aria-hidden', 'true');
      document.body.appendChild(z);
      zones[p] = z;
    });
    return zones;
  }

  function markTarget() {
    RAIL_POSITIONS.forEach(function (p) { zones[p].classList.toggle('is-target', p === drag.target); });
  }

  // Размеры рейки в двух её обликах: «плашка» на сцене и плоская строка в
  // шапке. Текущий облик мерим как есть, второй — на мгновение переключив
  // атрибут (в одном кадре, без отрисовки; переходы панелей и рейки в этот
  // момент выключены классами rail-moving/rail-dragging).
  function measureShapes() {
    var root = document.documentElement;
    var cur = root.getAttribute('data-rail-pos');
    var out = {};
    document.body.classList.add('rail-moving');
    root.setAttribute('data-rail-pos', 'left');
    out.stage = { w: rail.offsetWidth, h: rail.offsetHeight };
    root.setAttribute('data-rail-pos', 'header-start');
    out.header = { w: rail.offsetWidth, h: rail.offsetHeight };
    root.setAttribute('data-rail-pos', cur);
    void root.offsetWidth;
    document.body.classList.remove('rail-moving');
    return out;
  }

  // Esc во время перетаскивания — отмена. Слушатель в фазе перехвата и с
  // stopPropagation: иначе тот же Esc закрыл бы ещё и открытую панель/HUD
  // (см. initHotkeys) или окно настроек.
  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    finish(false);
  }
  function blockSelect(e) { e.preventDefault(); }

  // Первое заметное движение при зажатой ручке — рейка «берётся в руки»:
  // переезжает в <body> (класс .rail-floating — position: fixed поверх всего),
  // иначе её не вытащить ни из шапки, ни за край сцены (у сцены overflow: clip).
  function begin() {
    var r0 = rail.getBoundingClientRect();     // где рейка сейчас (в т.ч. с идущим перелётом)
    if (railAnim) { railAnim.cancel(); railAnim = null; }
    drag.active = true;
    drag.target = drag.from;

    // В шапке на месте рейки остаётся пустышка того же размера — логотип и
    // кнопки не прыгают, пока рейку несут
    if (rail.parentNode && rail.parentNode.id === 'topbar') {
      railGhost = document.createElement('div');
      railGhost.className = 'rail-ghost';
      railGhost.style.width = r0.width + 'px';
      railGhost.style.height = r0.height + 'px';
      rail.parentNode.insertBefore(railGhost, rail);
    }
    document.body.classList.add('rail-dragging');
    rail.classList.add('rail-floating');
    document.body.appendChild(rail);
    rail.style.left = r0.left + 'px';
    rail.style.top = r0.top + 'px';
    rail.style.right = 'auto';
    rail.style.bottom = 'auto';
    rail.style.transform = 'none';

    var size = measureShapes();
    drag.w = rail.offsetWidth; drag.h = rail.offsetHeight;
    drag.anchors = railAnchors(size, railMargin());

    // Контуры — ровно по якорям
    var z = ensureZones();
    RAIL_POSITIONS.forEach(function (p) {
      var a = drag.anchors[p];
      z[p].style.display = a ? '' : 'none';
      if (!a) return;
      z[p].style.left = a.x + 'px'; z[p].style.top = a.y + 'px';
      z[p].style.width = a.w + 'px'; z[p].style.height = a.h + 'px';
    });
    markTarget();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('selectstart', blockSelect, true);
  }

  function move(e) {
    // рейка идёт за курсором, но не выходит за границы окна (clamp) — так её
    // можно дотащить и до шапки, и до любого угла сцены
    var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    var left = Math.max(0, Math.min(e.clientX - drag.offX, vw - drag.w));
    var top = Math.max(0, Math.min(e.clientY - drag.offY, vh - drag.h));
    rail.style.left = left + 'px';
    rail.style.top = top + 'px';
    var target = nearestRailPos(left + drag.w / 2, top + drag.h / 2, drag.anchors, drag.from);
    if (target !== drag.target) { drag.target = target; markTarget(); }
  }

  // Движение и отпускание слушаем на document, а не захватом указателя на
  // ручке: в начале перетаскивания рейка переезжает в <body>, а перенос узла
  // в DOM снимает захват указателя (и прислал бы lostpointercapture).
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    // кнопку отпустили за пределами окна (pointerup не пришёл) — считаем,
    // что отпустили здесь
    if (e.pointerType === 'mouse' && e.buttons === 0) { finish(drag.active); return; }
    if (!drag.active) {
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < RAIL_DRAG_THRESHOLD) return;
      begin();
    }
    e.preventDefault();
    move(e);
  }
  function onUp(e) { if (drag && e.pointerId === drag.id) finish(true); }
  function onCancel(e) { if (drag && e.pointerId === drag.id) finish(false); }

  // commit=true — отпустили: прилипаем к ближайшему положению;
  // false — отмена (Esc, pointercancel): возвращаемся в прежнее
  function finish(commit) {
    if (!drag) return;
    var d = drag;
    drag = null;
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onCancel, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('selectstart', blockSelect, true);
    if (!d.active) return;       // нажали и отпустили без движения — ничего не делаем
    dragEndedAt = Date.now();
    setRailPos(commit ? d.target : d.from, { fromDrag: true });
  }

  grip.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    // Второй палец при уже идущем перетаскивании — игнорируем; а «залипшее»
    // перетаскивание того же указателя (потерянный pointerup) — сбрасываем
    if (drag) {
      if (drag.id !== e.pointerId) return;
      finish(false);
    }
    // рейка скрыта (мобильная раскладка, печать) — перетаскивать нечего
    if (!rail.offsetWidth) return;
    // Где именно за рейку схватились (offX/offY) — запоминаем сразу, при
    // нажатии: к моменту первого заметного движения курсор мог уже уйти
    // (быстрый рывок), и рейка «прыгала» бы, а не оставалась под рукой.
    var r0 = rail.getBoundingClientRect();
    drag = {
      id: e.pointerId, from: railPos, active: false,
      sx: e.clientX, sy: e.clientY,
      offX: e.clientX - r0.left, offY: e.clientY - r0.top
    };
    // Нажатие не должно дойти до холста 3D или начать выделение текста
    e.preventDefault();
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancel, true);
  });
  // Окно потеряло фокус посреди перетаскивания (Alt+Tab, системный диалог) —
  // отмена, иначе рейка «залипла» бы в руке. Без перетаскивания finish ничего
  // не делает, поэтому слушатель постоянный.
  window.addEventListener('blur', function () { finish(false); });
  // Двойной клик по ручке — вернуть рейку на место (в шапку после логотипа)
  // Сразу после перетаскивания (например, отменённого по Esc) браузер может
  // склеить его с быстрым кликом в двойной — такой dblclick не считаем.
  grip.addEventListener('dblclick', function () {
    if (Date.now() - dragEndedAt < 500) return;
    setRailPos(RAIL_POS_DEFAULT);
  });
}

/* ---------------------------------------------------------------------------
   3в. Панель режимов 3D-вида (#viewToolbar): прозрачный режим / скрыть
   фасады / проверка присадки. Сами переключатели — в app.js (toggleXray и
   др.); здесь только ГДЕ стоит панель. Подход тот же, что у рейки (3б):
   атрибут data-vt-pos на <html> (bottom-center — по умолчанию, bottom-left,
   bottom-right, header), вся раскладка — в CSS (style.css, раздел 6в);
   перенос в DOM (шапка ↔ сцена), перелёт FLIP (flipFrom), перетаскивание за
   ручку #viewToolbarGrip с прилипанием к ближайшему месту, выбор в
   настройках (сворачиваемый блок #vtPosSeg), запоминание в localStorage.
   Отличие от рейки: выбор пользователя (vtPos) и место на экране
   (effectiveVtPos) могут расходиться — «в шапке» на узком окне не
   помещается, и панель временно встаёт внизу по центру, а выбор остаётся.
--------------------------------------------------------------------------- */
// Тот же ключ, значения и правило ширины читает скрипт в <head> index.html
var VT_POS_KEY = 'modul3d.viewToolbarPos';
var VT_POSITIONS = ['bottom-center', 'bottom-left', 'bottom-right', 'header'];
var VT_POS_DEFAULT = 'bottom-center';
// До этой ширины окна при рейке в шапке панели режимов места в шапке нет
// (рейка ~270px + логотип + кнопки справа ~385px + панель ~140px)
var VT_HEADER_MIN_W = 1000;
var vtPos = VT_POS_DEFAULT;   // выбор пользователя
var vtAnim = null;            // идущий перелёт панели
var vtGhost = null;           // пустышка в шапке, пока панель из шапки тянут

function normalizeVtPos(v) {
  return VT_POSITIONS.indexOf(v) >= 0 ? v : VT_POS_DEFAULT;
}
function loadVtPos() {
  var saved = null;
  try { saved = localStorage.getItem(VT_POS_KEY); } catch (e) { /* нет доступа */ }
  return normalizeVtPos(saved);
}
function saveVtPos(pos) {
  try { localStorage.setItem(VT_POS_KEY, pos); } catch (e) { /* приватный режим */ }
}

// Где панель стоит на самом деле при выборе pos
function effectiveVtPos(pos) {
  if (pos !== 'header') return pos;
  var w = document.documentElement.clientWidth || window.innerWidth;
  if (w <= 820 || (isHeaderRailPos(railPos) && w <= VT_HEADER_MIN_W)) return VT_POS_DEFAULT;
  return pos;
}

// header — в шапку прямо перед кнопками справа (.header-actions); остальные —
// на сцену, перед HUD: обязательно ПОСЛЕ всех .drawer (CSS отодвигает панель
// от открытой выдвижной панели селектором «.drawer.open ~ .view-toolbar»).
// Тот же перенос до первой отрисовки делает скрипт после #viewToolbar в index.html.
function placeVtDom(tb, pos) {
  if (!tb) return;
  if (pos === 'header') {
    var bar = document.getElementById('topbar');
    var act = bar && bar.querySelector('.header-actions');
    if (!act || (tb.parentNode === bar && tb.nextElementSibling === act)) return;
    bar.insertBefore(tb, act);
  } else {
    var stage = document.getElementById('stage');
    if (!stage || tb.parentNode === stage) return;
    var hud = document.getElementById('partHud');
    if (hud && hud.parentNode === stage) stage.insertBefore(tb, hud);
    else stage.appendChild(tb);
  }
}

function syncVtPosButtons() {
  syncPosButtons('data-vt-set', vtPos, 'vtPosCollapseLabel', 'vtPosCurrentIcon');
}
function collapseVtPos() { setPosSegExpanded('vtPosSeg', 'vtPosCollapseToggle', false); }
function expandVtPos() { setPosSegExpanded('vtPosSeg', 'vtPosCollapseToggle', true); }

// Ставит панель туда, где она должна быть сейчас (effectiveVtPos(vtPos)).
//   opts.animate  — перелёт со старого места (FLIP);
//   opts.fromDrag — панель «в руках» (висит в <body>, .vt-floating, inline-
//                   координаты): снять и вернуть в контейнер даже при том же месте.
function applyVtPlacement(opts) {
  opts = opts || {};
  var tb = document.getElementById('viewToolbar');
  var root = document.documentElement;
  var prev = root.getAttribute('data-vt-pos');
  var eff = effectiveVtPos(vtPos);
  if (eff === prev && !opts.fromDrag && (!tb || tb.parentNode === (eff === 'header'
      ? document.getElementById('topbar') : document.getElementById('stage')))) return;

  var first = (opts.animate && tb && tb.offsetWidth) ? tb.getBoundingClientRect() : null;
  if (vtAnim) { vtAnim.cancel(); vtAnim = null; }
  if (tb) {
    tb.style.left = ''; tb.style.top = '';
    tb.style.right = ''; tb.style.bottom = '';
    tb.style.transform = '';
    tb.classList.remove('vt-floating');
  }
  if (vtGhost) { if (vtGhost.parentNode) vtGhost.parentNode.removeChild(vtGhost); vtGhost = null; }
  document.body.classList.remove('vt-dragging');

  // без переходов left/bottom (см. .view-toolbar в style.css) — иначе панель
  // «доезжала» бы сама поверх перелёта
  document.body.classList.add('vt-moving');
  placeVtDom(tb, eff);
  root.setAttribute('data-vt-pos', eff);
  void root.offsetWidth;
  document.body.classList.remove('vt-moving');

  if (hudModule) placeHud();
  if (first && tb && tb.offsetWidth) {
    var fade = !opts.fromDrag && ((prev === 'header') !== (eff === 'header'));
    var a = flipFrom(tb, first, fade);
    if (a) {
      vtAnim = a;
      a.onfinish = a.oncancel = function () { if (vtAnim === a) vtAnim = null; };
    }
  }
}

// Единая точка смены выбора: настройки, конец перетаскивания, двойной клик
function setVtPos(pos, opts) {
  opts = opts || {};
  pos = normalizeVtPos(pos);
  if (pos !== vtPos) { vtPos = pos; saveVtPos(pos); }
  applyVtPlacement({ animate: true, fromDrag: !!opts.fromDrag });
  syncVtPosButtons();
}

function initViewToolbarPosition() {
  var tb = document.getElementById('viewToolbar');
  var grip = document.getElementById('viewToolbarGrip');
  var root = document.documentElement;

  vtPos = loadVtPos();
  var eff0 = effectiveVtPos(vtPos);
  root.setAttribute('data-vt-pos', eff0);
  placeVtDom(tb, eff0);
  syncVtPosButtons();

  var seg = document.getElementById('vtPosSeg');
  if (seg) seg.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-vt-set]');
    if (!b) return;
    setVtPos(b.getAttribute('data-vt-set'));
    collapseVtPos();
    var t = document.getElementById('vtPosCollapseToggle');
    if (t) t.focus();
  });
  var toggle = document.getElementById('vtPosCollapseToggle');
  if (toggle) toggle.addEventListener('click', function () {
    if (toggle.getAttribute('aria-expanded') === 'true') collapseVtPos();
    else expandVtPos();
  });

  var drag = null;     // { id, from, active, sx, sy, offX, offY, w, h, anchors, target }

  // Узкое окно — «в шапке» временно внизу по центру, и обратно
  window.addEventListener('resize', function () { if (!drag) applyVtPlacement(); });

  if (!tb || !grip) return;

  var dragEndedAt = 0;
  var zones = null;

  function ensureZones() {
    if (zones) return zones;
    zones = {};
    VT_POSITIONS.forEach(function (p) {
      var z = document.createElement('div');
      z.className = 'vt-zone';
      z.setAttribute('data-zone', p === 'header' ? 'header-vt' : p);
      z.setAttribute('aria-hidden', 'true');
      document.body.appendChild(z);
      zones[p] = z;
    });
    return zones;
  }
  function markTarget() {
    VT_POSITIONS.forEach(function (p) { zones[p].classList.toggle('is-target', p === drag.target); });
  }

  // Якоря — прямоугольники панели во всех доступных местах, в координатах
  // окна. Мерим честно: ставим панель на каждое место в одном кадре (без
  // отрисовки и переходов — body.vt-moving) и берём её прямоугольник. Так
  // учтены и отступы от рейки/гизмы/открытых панелей из CSS (раздел 6в).
  // После замера панель возвращается ровно туда, где стояла.
  function measureAnchors() {
    var cur = root.getAttribute('data-vt-pos');
    var home = tb.parentNode, homeNext = tb.nextSibling;
    var out = {};
    document.body.classList.add('vt-moving');
    VT_POSITIONS.forEach(function (p) {
      if (p === 'header' && effectiveVtPos('header') !== 'header') return; // шапке не хватает места
      placeVtDom(tb, p);
      root.setAttribute('data-vt-pos', p);
      var r = tb.getBoundingClientRect();
      out[p] = { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    if (home) home.insertBefore(tb, homeNext);
    root.setAttribute('data-vt-pos', cur);
    void root.offsetWidth;
    document.body.classList.remove('vt-moving');
    return out;
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    finish(false);
  }
  function blockSelect(e) { e.preventDefault(); }

  function begin() {
    var r0 = tb.getBoundingClientRect();
    if (vtAnim) { vtAnim.cancel(); vtAnim = null; }
    drag.active = true;
    drag.target = drag.from;
    // Якоря — ДО пустышки: иначе контур «в шапке» сдвинулся бы на её ширину
    drag.anchors = measureAnchors();

    // Взяли из шапки — на её месте пустышка того же размера, чтобы кнопки
    // шапки не прыгали, пока панель несут
    if (tb.parentNode && tb.parentNode.id === 'topbar') {
      vtGhost = document.createElement('div');
      vtGhost.className = 'vt-ghost';
      vtGhost.style.width = r0.width + 'px';
      vtGhost.style.height = r0.height + 'px';
      tb.parentNode.insertBefore(vtGhost, tb);
    }

    document.body.classList.add('vt-dragging');
    tb.classList.add('vt-floating');
    document.body.appendChild(tb);
    tb.style.left = r0.left + 'px';
    tb.style.top = r0.top + 'px';
    tb.style.right = 'auto';
    tb.style.bottom = 'auto';
    tb.style.transform = 'none';
    drag.w = tb.offsetWidth; drag.h = tb.offsetHeight;

    var z = ensureZones();
    VT_POSITIONS.forEach(function (p) {
      var a = drag.anchors[p];
      z[p].style.display = a ? '' : 'none';
      if (!a) return;
      z[p].style.left = a.x + 'px'; z[p].style.top = a.y + 'px';
      z[p].style.width = a.w + 'px'; z[p].style.height = a.h + 'px';
    });
    markTarget();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('selectstart', blockSelect, true);
  }

  function move(e) {
    var vw = root.clientWidth, vh = root.clientHeight;
    var left = Math.max(0, Math.min(e.clientX - drag.offX, vw - drag.w));
    var top = Math.max(0, Math.min(e.clientY - drag.offY, vh - drag.h));
    tb.style.left = left + 'px';
    tb.style.top = top + 'px';
    var target = nearestRailPos(left + drag.w / 2, top + drag.h / 2, drag.anchors, drag.from);
    if (target !== drag.target) { drag.target = target; markTarget(); }
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) { finish(drag.active); return; }
    if (!drag.active) {
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < RAIL_DRAG_THRESHOLD) return;
      begin();
    }
    e.preventDefault();
    move(e);
  }
  function onUp(e) { if (drag && e.pointerId === drag.id) finish(true); }
  function onCancel(e) { if (drag && e.pointerId === drag.id) finish(false); }

  function finish(commit) {
    if (!drag) return;
    var d = drag;
    drag = null;
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onCancel, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('selectstart', blockSelect, true);
    if (!d.active) return;
    dragEndedAt = Date.now();
    // Отмена — вернуться к прежнему ВЫБОРУ (он мог быть «в шапке», хотя
    // стояла панель внизу по центру из-за узкого окна)
    setVtPos(commit ? d.target : vtPos, { fromDrag: true });
  }

  grip.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    if (drag) {
      if (drag.id !== e.pointerId) return;
      finish(false);
    }
    if (!tb.offsetWidth || !grip.offsetWidth) return;   // мобильная раскладка — ручки нет
    var r0 = tb.getBoundingClientRect();
    drag = {
      id: e.pointerId, from: root.getAttribute('data-vt-pos') || VT_POS_DEFAULT, active: false,
      sx: e.clientX, sy: e.clientY,
      offX: e.clientX - r0.left, offY: e.clientY - r0.top
    };
    e.preventDefault();
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancel, true);
  });
  window.addEventListener('blur', function () { finish(false); });
  // Двойной клик по ручке — вернуть панель на место по умолчанию (внизу по центру)
  grip.addEventListener('dblclick', function () {
    if (Date.now() - dragEndedAt < 500) return;
    setVtPos(VT_POS_DEFAULT);
  });
}

/* ---------------------------------------------------------------------------
   4. Focus Mode — при работе с моделью интерфейс растворяется
--------------------------------------------------------------------------- */
function initFocusMode() {
  var host = document.getElementById('viewer3d');
  if (!host) return;
  var down = null, active = false, offTimer = null;

  function enter() {
    if (active) return;
    active = true;
    document.body.classList.add('is-focus');
  }
  function leave(delay) {
    clearTimeout(offTimer);
    offTimer = setTimeout(function () {
      active = false;
      document.body.classList.remove('is-focus');
    }, delay);
  }

  host.addEventListener('pointerdown', function (e) {
    down = { x: e.clientX, y: e.clientY };
    lastPointer = { x: e.clientX, y: e.clientY };
  });
  host.addEventListener('pointermove', function (e) {
    if (!down) return;
    if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 6) enter();
  });
  host.addEventListener('pointerup', function (e) {
    lastPointer = { x: e.clientX, y: e.clientY };
    down = null;
    leave(450);
  });
  host.addEventListener('pointercancel', function () { down = null; leave(450); });
  host.addEventListener('wheel', function () { enter(); leave(900); }, { passive: true });
}

/* ---------------------------------------------------------------------------
   5. HUD — мини-меню прямо на детали в 3D
--------------------------------------------------------------------------- */
function hudEl() { return document.getElementById('partHud'); }

function fieldVal(id) {
  var el = document.getElementById(id);
  return el ? el.value : '';
}

function pushField(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function renderHud() {
  var box = hudEl();
  if (!box || !hudModule) return;
  var app = window.Modul3D.app;
  var hudState = (app && app.getModuleHudState) ? app.getModuleHudState(hudModule) : null;
  var rotations = (app && app.getRotations) ? app.getRotations() : [];
  var curRot = hudState ? hudState.rotation : 0;

  // Блок «Повернуть» — ОДНА кнопка вместо трёх (90/180/270°): каждый клик
  // доворачивает модуль ещё на 90° по кругу (см. app.js: rotateModuleStep),
  // так можно докрутить и обратно к «без поворота» без отдельной кнопки на
  // это значение. Текущее состояние подписано текстом рядом — иначе не
  // понятно, сколько раз кликать; подпись берётся из общего списка
  // ROTATIONS через мост, чтобы не дублировать текст.
  var curLabelRow = rotations.filter(function (r) { return r[0] === curRot; })[0];
  var curLabel = curLabelRow ? curLabelRow[1] : '';
  var rotateHtml = !rotations.length ? '' :
    '<div class="hud-group">Поворот: ' + escapeHtml(curLabel) + '</div>' +
    '<button type="button" class="btn hud-full" data-hud-rotate-step>⟳ Повернуть на 90°</button>';

  // Кнопка «Разделить на отсеки» — только когда в модуле ровно одна секция
  // и у неё есть фасад-дверь (см. app.js: getModuleHudState). По клику
  // раскрывается компактный инлайн-степпер вместо самой кнопки.
  var splitHtml = '';
  if (hudState && hudState.canSplitByHeight) {
    splitHtml = hudSplitOpen ?
      '<div class="hud-numrow">' +
        '<input type="number" min="1" max="4" value="' + (hudState.doorZoneCount || 1) + '" data-hud-split-input>' +
        '<button type="button" class="btn" data-hud-split-apply>Разделить</button>' +
      '</div>' :
      '<button type="button" class="btn hud-full" data-hud-split-open>Разделить на отсеки</button>';
  }

  box.innerHTML =
    '<div class="hud-title"><span>' + escapeHtml(hudModule) + '</span>' +
    '<button type="button" class="hud-close" data-hud-close aria-label="Закрыть">✕</button></div>' +
    '<div class="hud-dims">' +
      hudDim('В', 'm-height') + hudDim('Ш', 'm-width') + hudDim('Г', 'm-depth') +
    '</div>' +
    '<div class="hud-meta">Материал: ' + escapeHtml(selectedText('p-decor')) + '</div>' +
    rotateHtml +
    '<div class="hud-actions">' +
      '<button type="button" class="btn" data-hud-open="params">Параметры</button>' +
      '<button type="button" class="btn" data-hud-open="docs">Документы</button>' +
    '</div>' +
    '<button type="button" class="btn hud-full" data-hud-focus>Режим редактирования детали</button>' +
    splitHtml;
}

// Применяет «Разделить на отсеки» из инлайн-степпера HUD (см.
// renderHud/data-hud-split-apply) — читает число из поля и зовёт мост
// app.js: setModuleDoorZoneCount, затем сворачивает степпер обратно в
// кнопку и перерисовывает HUD, чтобы показать новое число отсеков.
function applyHudSplit() {
  var box = hudEl();
  var input = box && box.querySelector('[data-hud-split-input]');
  if (!input || !hudModule) return;
  var n = Number(input.value) || 1;
  if (window.Modul3D.app && window.Modul3D.app.setModuleDoorZoneCount) {
    window.Modul3D.app.setModuleDoorZoneCount(hudModule, n);
  }
  hudSplitOpen = false;
  renderHud();
}

function hudDim(label, id) {
  return '<label class="hud-dim"><span>' + label + '</span>' +
    '<input type="number" step="10" data-hud-field="' + id + '" value="' + escapeHtml(fieldVal(id)) + '"></label>';
}

function selectedText(id) {
  var el = document.getElementById(id);
  if (!el || el.selectedIndex < 0) return '—';
  var opt = el.options[el.selectedIndex];
  return opt ? opt.text : '—';
}

function showHud(name) {
  var box = hudEl();
  if (!box) return;
  hudModule = name;
  hudSplitOpen = false;
  renderHud();
  box.setAttribute('aria-hidden', 'false');
  box.classList.add('open');
  placeHud();
}

function placeHud() {
  var box = hudEl();
  var stage = document.getElementById('stage');
  if (!box || !stage) return;
  var r = stage.getBoundingClientRect();
  var w = box.offsetWidth || 220, h = box.offsetHeight || 140;
  var x = lastPointer.x - r.left + 14;
  var y = lastPointer.y - r.top + 14;
  x = Math.max(8, Math.min(x, r.width - w - 8));
  y = Math.max(8, Math.min(y, r.height - h - 8));
  // Горизонтальная рейка справа сверху / слева снизу лежит ПОВЕРХ HUD
  // (z-index 38 против 32): если HUD ставится под курсор у её угла, заголовок
  // или кнопки оказались бы под ней. Сдвигаем HUD за край рейки — вниз от неё
  // (рейка сверху) или вверх (снизу). Столбику слева это не нужно: HUD и
  // раньше не мешал ему — оставляем прежнее поведение. Рейка в шапке
  // (header-start/header-end) лежит над сценой и HUD не перекрывает вовсе.
  var rail = document.getElementById('rail');
  if (rail && rail.offsetWidth && (railPos === 'top-right' || railPos === 'bottom-left')) {
    var rr = rail.getBoundingClientRect();
    var gap = 8;
    var rl = rr.left - r.left, rt = rr.top - r.top, rrt = rr.right - r.left, rb = rr.bottom - r.top;
    if (x < rrt + gap && x + w > rl - gap && y < rb + gap && y + h > rt - gap) {
      y = railPos === 'top-right' ? rb + gap : rt - gap - h;
      y = Math.max(gap, Math.min(y, r.height - h - gap));
    }
  }
  // Панель режимов 3D внизу сцены (раздел 3в) лежит НИЖЕ HUD по z-index
  // (30 против 32): HUD у нижнего края закрыл бы её иконки — поднимаем HUD
  // над панелью.
  var tb = document.getElementById('viewToolbar');
  if (tb && tb.offsetWidth && tb.parentNode && tb.parentNode.id === 'stage') {
    var tr = tb.getBoundingClientRect();
    var g2 = 8;
    var tl = tr.left - r.left, tt = tr.top - r.top, trr = tr.right - r.left, tbm = tr.bottom - r.top;
    if (x < trr + g2 && x + w > tl - g2 && y < tbm + g2 && y + h > tt - g2) {
      y = Math.max(g2, tt - g2 - h);
    }
  }
  box.style.left = x + 'px';
  box.style.top = y + 'px';
}

function hideHud() {
  var box = hudEl();
  if (!box) return;
  hudModule = null;
  hudSplitOpen = false;
  box.classList.remove('open');
  box.setAttribute('aria-hidden', 'true');
}

function initHud() {
  var box = hudEl();
  if (!box) return;

  box.addEventListener('click', function (e) {
    if (e.target.closest('[data-hud-close]')) { hideHud(); return; }

    if (e.target.closest('[data-hud-rotate-step]')) {
      if (hudModule && window.Modul3D.app && window.Modul3D.app.rotateModuleStep) {
        window.Modul3D.app.rotateModuleStep(hudModule);
      }
      // Перерисовываем HUD, чтобы текст текущего поворота обновился на
      // только что применённое значение.
      renderHud();
      return;
    }

    if (e.target.closest('[data-hud-focus]')) {
      // То же самое, что двойной клик по модулю в 3D — вход в Focus Mode
      // (viewer.onIsolateModule уже обёрнут ниже так, чтобы сам скрыть
      // HUD, см. блок «Подключаемся к выбору модуля» дальше в этой функции).
      if (hudModule && viewerInstance && typeof viewerInstance.onIsolateModule === 'function') {
        viewerInstance.onIsolateModule(hudModule);
      }
      return;
    }

    if (e.target.closest('[data-hud-split-open]')) {
      hudSplitOpen = true;
      renderHud();
      return;
    }

    if (e.target.closest('[data-hud-split-apply]')) {
      applyHudSplit();
      return;
    }

    var open = e.target.closest('[data-hud-open]');
    if (open) {
      var target = open.getAttribute('data-hud-open');
      openDrawer(target);
      // «Параметры» из HUD должны вести на экран параметров МОДУЛЯ (тот,
      // что сейчас под курсором), а не оставлять прежний экран панели.
      if (target === 'params' && window.Modul3D.app && window.Modul3D.app.setPanelView) {
        window.Modul3D.app.setPanelView('module');
      }
      // Своё действие HUD уже выполнил (открыл нужную панель) — сам он
      // больше не нужен и не должен висеть поверх/рядом с открывшейся
      // панелью (см. баг: накопление панелей друг над другом).
      hideHud();
    }
  });
  box.addEventListener('keydown', function (e) {
    // Enter в поле инлайн-степпера применяет разделение — по образцу
    // числового пункта showFocusMenu в app.js (там та же клавиша так же
    // подтверждает значение вместо клика по кнопке).
    if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-hud-split-input]')) {
      applyHudSplit();
    }
  });
  box.addEventListener('change', function (e) {
    var f = e.target.getAttribute && e.target.getAttribute('data-hud-field');
    if (!f) return;
    pushField(f, e.target.value);
  });

  // Подключаемся к выбору модуля, не перебивая обработчик app.js
  var tries = 0;
  var timer = setInterval(function () {
    if (!viewerInstance) { if (++tries > 40) clearInterval(timer); return; }
    clearInterval(timer);
    var prev = viewerInstance.onSelectModule;
    viewerInstance.onSelectModule = function (name) {
      if (typeof prev === 'function') prev.call(viewerInstance, name);
      if (name) showHud(name); else hideHud();
    };
    // Двойной клик — вход в Focus Mode (изоляция модуля): своё меню поверх
    // 3D показывает уже app.js (showFocusMenu), а этот мини-HUD относится к
    // обычному режиму просмотра и там больше не нужен — иначе он остаётся
    // висеть под/над меню фокуса (см. баг: накопление панелей).
    var prevIsolate = viewerInstance.onIsolateModule;
    viewerInstance.onIsolateModule = function (name) {
      hideHud();
      if (typeof prevIsolate === 'function') prevIsolate.call(viewerInstance, name);
    };
    // Клик по отсеку (вне фокуса, см. app.js: viewer.onSelectZone) тоже
    // показывает своё меню поверх 3D (showFocusMenu) — тот же случай
    // накопления панелей, что и у onIsolateModule выше: если HUD уже был
    // открыт для этого модуля (клик до этого пришёлся мимо отсека), он
    // остался бы висеть под новым меню.
    var prevSelectZone = viewerInstance.onSelectZone;
    viewerInstance.onSelectZone = function (payload) {
      hideHud();
      if (typeof prevSelectZone === 'function') prevSelectZone.call(viewerInstance, payload);
    };
  }, 60);
}

/* ---------------------------------------------------------------------------
   6. Поиск по панели параметров
--------------------------------------------------------------------------- */
function applySearch() {
  var input = document.getElementById('paramSearch');
  var panel = document.getElementById('paramsPanel');
  if (!input || !panel) return;
  var q = (input.value || '').trim().toLowerCase();
  var kids = panel.children;

  if (!q) {
    for (var i = 0; i < kids.length; i++) kids[i].classList.remove('dim-out');
    return;
  }
  // Панель — плоский список: h3 открывает раздел, дальше идут его блоки.
  var group = [], head = null;
  var flush = function () {
    if (!head && !group.length) return;
    var text = (head ? head.textContent : '');
    for (var j = 0; j < group.length; j++) text += ' ' + group[j].textContent;
    var hit = text.toLowerCase().indexOf(q) >= 0;
    if (head) head.classList.toggle('dim-out', !hit);
    for (var k = 0; k < group.length; k++) group[k].classList.toggle('dim-out', !hit);
    group = [];
  };
  for (var n = 0; n < kids.length; n++) {
    var el = kids[n];
    if (el.tagName === 'H3') { flush(); head = el; }
    else group.push(el);
  }
  flush();
}

function initSearch() {
  var input = document.getElementById('paramSearch');
  var panel = document.getElementById('paramsPanel');
  if (!input || !panel) return;
  input.addEventListener('input', applySearch);
  if (window.MutationObserver) {
    new MutationObserver(function () {
      applySearch();
      if (hudModule) renderHud();
    }).observe(panel, { childList: true });
  }
}

/* ---------------------------------------------------------------------------
   7. Мобильная шторка — свайп вверх открывает панель параметров
--------------------------------------------------------------------------- */
function initSheet() {
  var bar = document.getElementById('mobileBar');
  if (!bar) return;
  var startY = null;
  bar.addEventListener('pointerdown', function (e) { startY = e.clientY; });
  bar.addEventListener('pointerup', function (e) {
    if (startY === null) return;
    var dy = startY - e.clientY;
    startY = null;
    if (dy > 24 && !openPanel) openDrawer('params');
  });

  // Свайп вниз по шапке листа — закрыть
  document.addEventListener('pointerdown', function (e) {
    var head = e.target.closest && e.target.closest('.drawer-head');
    if (!head) return;
    var y0 = e.clientY;
    var up = function (ev) {
      document.removeEventListener('pointerup', up);
      if (ev.clientY - y0 > 40) closeDrawer(openPanel);
    };
    document.addEventListener('pointerup', up);
  });
}

/* ---------------------------------------------------------------------------
   8. Горячие клавиши
--------------------------------------------------------------------------- */
function initHotkeys() {
  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape' && e.target.id === 'paramSearch') {
        e.target.value = ''; applySearch();
      }
      return;
    }
    if (e.key === 'Escape') {
      if (hudModule) { hideHud(); return; }
      if (openPanel) { closeDrawer(openPanel); return; }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    var views = { Digit1: 'front', Digit2: 'side', Digit3: 'top', Digit4: 'iso' };
    if (views[e.code]) {
      // Нижней панели видов больше нет — вид переключается гизмой в углу
      // 3D-сцены (viewer.js) или напрямую через app.setView (app.js: applyView).
      var app = window.Modul3D.app;
      if (app && typeof app.setView === 'function') { e.preventDefault(); app.setView(views[e.code]); }
      return;
    }
    if (e.code === 'KeyP') { e.preventDefault(); toggleDrawer('params'); }
    else if (e.code === 'KeyD') { e.preventDefault(); toggleDrawer('docs'); }
    else if (e.code === 'KeyF') { e.preventDefault(); toggleDrawer('studio'); }
    else if (e.code === 'KeyT') { e.preventDefault(); setTheme(currentTheme() === 'dark' ? 'light' : 'dark'); }
  });
}

/* ---------------------------------------------------------------------------
   9. Мелочи
--------------------------------------------------------------------------- */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------------------------------------------------------------------------
   Старт (вызывается из index.html после app.js)
--------------------------------------------------------------------------- */
function start() {
  initTheme();
  initCurrency();
  initDrawers();
  initRailPosition();
  initViewToolbarPosition();
  watchResults();
  initFocusMode();
  initHud();
  initSearch();
  initSheet();
  initHotkeys();
  restoreUI();
  window.addEventListener('resize', function () { if (hudModule) placeHud(); });

  // Страховка для браузеров без overflow:clip — сцена никогда не прокручивается
  var stage = document.getElementById('stage');
  if (stage) stage.addEventListener('scroll', function () {
    stage.scrollTop = 0; stage.scrollLeft = 0;
  });
}

window.Modul3D = window.Modul3D || {};
window.Modul3D.uiShell = {
  start: start,
  setTheme: setTheme,
  openDrawer: openDrawer,
  closeDrawer: closeDrawer,
  setRailPos: setRailPos,
  getRailPos: function () { return railPos; },
  // Панель режимов 3D: выбор пользователя и где она стоит на самом деле
  setViewToolbarPos: setVtPos,
  getViewToolbarPos: function () { return vtPos; },
  getViewToolbarPlacement: function () { return document.documentElement.getAttribute('data-vt-pos'); }
};
})();
