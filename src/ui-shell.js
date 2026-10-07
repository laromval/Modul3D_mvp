/* =========================================================================
   Modul3D — UI Shell
   Слой интерфейса: темы, выдвижные панели, положение рейки панелей
   (в шапке / слева / справа сверху / слева снизу), положение панели режимов
   3D-вида (внизу по центру / слева / справа / в шапке), Focus Mode, HUD на модели,
   поиск по параметрам, горячие клавиши, мобильная шторка, регулировка высоты
   нижних листов на телефоне (раздел 7б) и панели «Документы» на компьютере
   (7б′), масштаб чертежей (7в).

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
// Размер надписей ручной разметки чертежа (src/markup.js), px — см. initMarkupFont.
var MARKUP_FONT_KEY = 'modul3d.markupFont';
var MARKUP_FONT_MIN = 6, MARKUP_FONT_MAX = 24, MARKUP_FONT_DEFAULT = 10;
var viewerInstance = null;
var lastPointer = { x: 0, y: 0 };
var openPanel = null;
var hudModule = null;
// Отсек, по которому кликнули в 3D ({sectionIndex, zoneIndex}) — блок
// «секция» HUD (деление, «Редактировать отсек») относится к нему. null —
// клик по другой части модуля: тогда блок работает с единственной секцией.
var hudZone = null;
var syncingDocs = false;
// Рейка панелей всегда стоит слева снизу (раздел 3б); значение дублирует
// data-rail-pos на <html> и нужно только тем, кто спрашивает «где рейка».
var railPos = 'bottom-left';

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
    if (willOpen) { collapseCurrency(); collapseHotkeys(); collapseVtPos(); }
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

/* Размер надписей ручной разметки чертежа (src/markup.js: setFontScale).
   Настройка интерфейса, а не проекта — хранится в браузере, как тема.
   markup.js грузится ПОСЛЕ этого файла, но start() зовётся уже после всех
   скриптов, так что к моменту initMarkupFont() он на месте. */
function clampMarkupFont(v) {
  v = Math.round(Number(v));
  if (!isFinite(v)) return MARKUP_FONT_DEFAULT;
  return Math.max(MARKUP_FONT_MIN, Math.min(MARKUP_FONT_MAX, v));
}

var markupFontRebuildTimer = null;
function applyMarkupFont(px, save) {
  px = clampMarkupFont(px);
  var mk = window.Modul3D && window.Modul3D.markup;
  if (mk && mk.setFontScale) mk.setFontScale(px);
  var range = document.getElementById('markupFontRange');
  if (range && String(range.value) !== String(px)) range.value = px;
  var out = document.getElementById('markupFontValue');
  if (out) out.textContent = px + ' px';
  if (save) {
    try { localStorage.setItem(MARKUP_FONT_KEY, String(px)); } catch (e) { /* приватный режим */ }
    // Рамка листа (drawings.js: svgFit) считается при сборке чертежа —
    // крупные подписи иначе обрезались бы краем. Модель не пересчитывается.
    // Ползунок шлёт input на каждый шаг — пересобираем с короткой задержкой.
    clearTimeout(markupFontRebuildTimer);
    markupFontRebuildTimer = setTimeout(function () {
      var app = window.Modul3D.app;
      if (app && typeof app.refreshDrawings === 'function') app.refreshDrawings();
    }, 120);
  }
}

function initMarkupFont() {
  var saved = null;
  try { saved = localStorage.getItem(MARKUP_FONT_KEY); } catch (e) { /* нет доступа */ }
  applyMarkupFont(saved == null || saved === '' ? MARKUP_FONT_DEFAULT : saved, false);
  var range = document.getElementById('markupFontRange');
  if (range) range.addEventListener('input', function () { applyMarkupFont(range.value, true); });
}

// Управление камерой пальцами (по умолчанию 'standard'; только телефон — блок виден лишь ≤820px):
// 'classic' — один палец по модели вращает, по пустому двигает; 'standard' —
// один палец вращает везде. Значение кладём на <html> (data-touch-scheme),
// его читает SimpleOrbitControl в viewer.js.
var TOUCH_SCHEME_KEY = 'modul3d.touchScheme';
function setTouchScheme(v, save) {
  v = v === 'classic' ? 'classic' : 'standard';   // по умолчанию — стандартное
  document.documentElement.setAttribute('data-touch-scheme', v);
  var btns = document.querySelectorAll('[data-touch-scheme]');
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].tagName !== 'BUTTON') continue;
    var on = btns[i].getAttribute('data-touch-scheme') === v;
    btns[i].classList.toggle('active', on);
    btns[i].setAttribute('aria-checked', on ? 'true' : 'false');
  }
  if (save) { try { localStorage.setItem(TOUCH_SCHEME_KEY, v); } catch (e) { /* нет доступа */ } }
}
function initTouchScheme() {
  var saved = null;
  try { saved = localStorage.getItem(TOUCH_SCHEME_KEY); } catch (e) { /* нет доступа */ }
  setTouchScheme(saved, false);
  var tgl = document.getElementById('touchSchemeToggle');
  if (tgl) tgl.addEventListener('click', function () {
    setPosSegExpanded('touchSchemeSeg', 'touchSchemeToggle', tgl.getAttribute('aria-expanded') !== 'true');
  });
  var btns = document.querySelectorAll('button[data-touch-scheme]');
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener('click', function (e) {
      setTouchScheme(e.currentTarget.getAttribute('data-touch-scheme'), true);
    });
  }
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
  // Переход с одной панели на другую — без «выезда»: старая пропадает, новая
  // появляется сразу (иначе одна уезжает влево, а другая выезжает — моргание).
  // Переходы выключаем классом .no-anim на один пересчёт стилей.
  var prevEl = (openPanel && openPanel !== name) ? drawerOf(openPanel) : null;
  if (prevEl) { prevEl.classList.add('no-anim'); el.classList.add('no-anim'); }
  if (openPanel && openPanel !== name) closeDrawer(openPanel, true);
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  openPanel = name;
  if (prevEl) {
    void el.offsetWidth;                   // применить новое состояние без перехода
    prevEl.classList.remove('no-anim'); el.classList.remove('no-anim');
  }
  syncRailUp();
  document.body.classList.add('has-modal-drawer');
  // Нижний лист на телефоне: вернуть запомненную высоту (после жеста «потянул
  // вниз, чтобы закрыть» она могла остаться урезанной) и сообщить 3D-вьюеру
  // отступ — см. раздел 7б. То же для панели «Документы» на компьютере (7б′).
  refreshSheetHeight();
  syncTriggers();
  rememberUI();

  // «Документы» и вкладки app.js — один и тот же элемент .results
  if (name === 'docs') setResultsOpen(true);

  if (scrollTo) scrollToHeading(el, scrollTo);
}

function closeDrawer(name, silent) {
  var el = drawerOf(name || openPanel);
  if (!el) return;
  // Идущее перетаскивание высоты «Документов» (7б′) обрываем: панели больше
  // нет, а жест без неё — «залипшая» подсветка курсора и захват указателя.
  if (docsDrag && (name || openPanel) === 'docs') endDocsDrag(true, true);
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
  if (!name || name === openPanel) openPanel = null;
  syncRailUp();
  if (!silent) {
    document.body.classList.remove('has-modal-drawer');
    // Панель закрыта — нижнего листа больше нет, отступ для 3D сбрасывается
    // в 0 (раздел 7б). При «тихом» закрытии (смена одной панели другой) этого
    // не делаем: следом сразу openDrawer, он сам сообщит итоговое значение.
    publishSheetInset(false);
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
   3б. Рейка панелей: всегда слева снизу, сворачивается в угол
   Положение не настраивается: data-rail-pos="bottom-left" стоит на <html> в
   index.html. Вся раскладка — в CSS (style.css, раздел 7б). Здесь:
   · ручка ⋮⋮ (#railGrip) сворачивает рейку до размера самой ручки и
     разворачивает обратно — ширину анимирует JS (width + transition),
     класс .is-collapsed прячет остальные кнопки; запуск всегда развёрнутым;
   · пока открыта боковая панель (всё, кроме «Документов»), рейка поднимается
     наверх и ложится над панелью — атрибут data-rail-up на <html>
     (syncRailUp, зовётся из openDrawer/closeDrawer), дальше всё делает CSS.
   Клики по кнопкам рейки ловит делегированный обработчик на document
   (initDrawers).
--------------------------------------------------------------------------- */
// Кривая и длительность перелёта — те же, что --ease и --dur в style.css:
// Web Animations API не понимает var(), поэтому продублированы значением.
var RAIL_EASE = 'cubic-bezier(.22, .61, .36, 1)';
var RAIL_FLY_MS = 320;
// Сдвиг в px, с которого нажатие на ручку считается перетаскиванием (панель
// режимов 3D, раздел 3в). Меньше — это клик, панель не трогаем.
var RAIL_DRAG_THRESHOLD = 4;

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

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

// Рейка слева снизу: пока открыта любая панель, она поднимается в её верхнюю
// строку — у боковой панели над ней, у «Документов» внутри верхней строки
// нижней панели. На телефоне рейки нет (там полоса кнопок поверх листа,
// style.css, раздел 17).
function syncRailUp() {
  var up = !!openPanel && !isMobileLayout();
  var root = document.documentElement;
  // 'side' — рейка над боковой панелью, 'docs' — в верхней строке нижней панели
  if (up) root.setAttribute('data-rail-up', openPanel === 'docs' ? 'docs' : 'side');
  else root.removeAttribute('data-rail-up');
  syncRailTitle();
}

// Название открытой панели — в строку рейки (CSS: .rail::before { content:
// attr(data-title) }, видно только при поднятой рейке). Название «Параметров»
// меняется само (модуль / деталь / материалы), поэтому initRail следит за
// заголовками панелей и зовёт это снова.
function syncRailTitle() {
  var rail = document.getElementById('rail');
  if (!rail) return;
  var el = openPanel ? drawerOf(openPanel) : null;
  var t = el && el.querySelector('.drawer-title');
  rail.setAttribute('data-title', t ? (t.textContent || '').trim() : '');
}

function initRail() {
  var rail = document.getElementById('rail');
  var grip = document.getElementById('railGrip');
  if (!rail || !grip) return;
  var collapsed = false;
  var fullW = 0;          // ширина развёрнутой рейки, px — для анимации

  function collapsedWidth() {
    var cs = getComputedStyle(rail);
    return grip.offsetWidth + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) +
      (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
  }
  // Ширина развёрнутой рейки «как есть» (width: auto) — мерим на лету
  function naturalWidth() {
    var keep = rail.style.width;
    rail.style.width = 'auto';
    var w = rail.offsetWidth;
    rail.style.width = keep;
    return w;
  }
  function done() { if (!collapsed) rail.style.width = ''; }

  function setCollapsed(c) {
    if (c === collapsed || !rail.offsetWidth) return;
    collapsed = c;
    var label = c ? 'Развернуть панель' : 'Свернуть панель';
    grip.setAttribute('aria-expanded', c ? 'false' : 'true');
    grip.setAttribute('aria-label', label);
    grip.setAttribute('data-tip', label);
    if (c) {
      fullW = rail.offsetWidth;
      rail.style.width = fullW + 'px';
      void rail.offsetWidth;                 // зафиксировать старт перехода
      rail.classList.add('is-collapsed');
      rail.style.width = collapsedWidth() + 'px';
    } else {
      rail.classList.remove('is-collapsed');
      var target = naturalWidth();
      rail.style.width = collapsedWidth() + 'px';
      void rail.offsetWidth;
      rail.style.width = target + 'px';
      // без анимаций (prefers-reduced-motion / тестовая среда) transitionend не
      // придёт — снимаем фиксированную ширину по таймеру тоже
      setTimeout(done, RAIL_FLY_MS + 80);
    }
  }
  grip.addEventListener('click', function () { setCollapsed(!collapsed); });
  // окно перешло границу 820px (телефон ↔ компьютер) — подъём рейки пересчитать
  window.addEventListener('resize', syncRailUp);
  // заголовок панели сменился (например «Параметры проекта» → «Деталь») —
  // обновить название в строке рейки
  if (window.MutationObserver) {
    var titles = document.querySelectorAll('.drawer-left .drawer-title');
    var mo = new MutationObserver(syncRailTitle);
    for (var i = 0; i < titles.length; i++) {
      mo.observe(titles[i], { childList: true, characterData: true, subtree: true });
    }
  }
  rail.addEventListener('transitionend', function (e) {
    if (e.target === rail && e.propertyName === 'width') done();
  });
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
var VT_POSITIONS = ['bottom-center', 'bottom-left', 'header-start', 'header'];
var VT_POS_DEFAULT = 'bottom-center';
// До этой ширины окна панели режимов в шапке места нет (логотип + панель
// ~200px + кнопки справа ~385px) — она временно встаёт внизу по центру.
// То же число — в раннем скрипте <head> index.html.
var VT_HEADER_MIN_W = 900;
function isVtHeaderPos(p) { return p === 'header' || p === 'header-start'; }
var vtPos = VT_POS_DEFAULT;   // выбор пользователя
var vtAnim = null;            // идущий перелёт панели
var vtGhost = null;           // пустышка в шапке, пока панель из шапки тянут

function normalizeVtPos(v) {
  if (v === 'bottom-right') return VT_POS_DEFAULT;   // «внизу справа» удалено — там гизма видов
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
  if (!isVtHeaderPos(pos)) return pos;
  var w = document.documentElement.clientWidth || window.innerWidth;
  if (w <= VT_HEADER_MIN_W) return VT_POS_DEFAULT;
  return pos;
}

// header — в шапку прямо перед кнопками справа (.header-actions); header-start —
// в шапку сразу после логотипа (.brand); остальные —
// на сцену, перед HUD: обязательно ПОСЛЕ всех .drawer (CSS отодвигает панель
// от открытой выдвижной панели селектором «.drawer.open ~ .view-toolbar»).
// Тот же перенос до первой отрисовки делает скрипт после #viewToolbar в index.html.
function placeVtDom(tb, pos) {
  if (!tb) return;
  if (isVtHeaderPos(pos)) {
    var bar = document.getElementById('topbar');
    var brand = bar && bar.querySelector('.brand');
    var ref = pos === 'header-start' ? (brand && brand.nextElementSibling)
                                     : (bar && bar.querySelector('.header-actions'));
    if (!ref || ref === tb || (pos === 'header-start' && tb.previousElementSibling === brand && tb.parentNode === bar)) return;
    if (pos === 'header' && tb.parentNode === bar && tb.nextElementSibling === ref) return;
    bar.insertBefore(tb, ref);
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
  if (eff === prev && !opts.fromDrag && (!tb || tb.parentNode === (isVtHeaderPos(eff)
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
    var fade = !opts.fromDrag && (isVtHeaderPos(prev) !== isVtHeaderPos(eff));
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
      z.setAttribute('data-zone', isVtHeaderPos(p) ? 'header-vt' : p);
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
      if (isVtHeaderPos(p) && effectiveVtPos(p) !== p) return; // шапке не хватает места
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
  var hudState = (app && app.getModuleHudState)
    ? app.getModuleHudState(hudModule, hudZone ? hudZone.sectionIndex : undefined) : null;
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

  // Блок секции: деление на отсеки + «Редактировать отсек» — для кликнутого
  // отсека или единственной секции с фасадом-дверью (см. app.js:
  // getModuleHudState).
  var splitHtml = '';
  if (hudState && hudState.canSplitByHeight) {
    splitHtml =
      '<div class="hud-group hud-sec-title">Разделить секцию на отсеки</div>' +
      '<div class="hud-numrow">' +
        '<input type="number" min="1" max="4" value="' + (hudState.doorZoneCount || 1) + '" data-hud-split-input>' +
        '<button type="button" class="btn" data-hud-split-apply>Разделить</button>' +
      '</div>' +
      '<button type="button" class="btn hud-full" data-hud-zone-edit>Редактировать отсек</button>';
  }

  box.innerHTML =
    '<div class="hud-title"><span>' + escapeHtml(hudModule) + '</span>' +
    '<button type="button" class="hud-close" data-hud-close aria-label="Закрыть">✕</button></div>' +
    '<div class="hud-dims">' +
      hudDim('В', 'm-height') + hudDim('Ш', 'm-width') + hudDim('Г', 'm-depth') +
    '</div>' +
    '<div class="hud-meta">Материал: ' + escapeHtml((hudState && hudState.materialName) || selectedText('p-decor')) + '</div>' +
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
    window.Modul3D.app.setModuleDoorZoneCount(hudModule, n, hudZone ? hudZone.sectionIndex : undefined);
  }
  renderHud();
}

function hudDim(label, id) {
  return '<label class="hud-dim"><span>' + label + '</span>' +
    '<input type="number" step="10" data-hud-field="' + id + '" value="' + escapeHtml(fieldVal(id)) + '"></label>';
}

// Подпись текущего значения поля панели: для <select> — текст выбранной
// опции; для плашки выбора материала (<button class="mat-pick">, см.
// app.js: matPickPlashkaHtml — #p-decor/#p-facadeDecor/#p-back теперь не
// <select>) — название из .alu-fill-name внутри кнопки, иначе data-code.
function selectedText(id) {
  var el = document.getElementById(id);
  if (!el) return '—';
  if (el.options && typeof el.selectedIndex === 'number') {
    var opt = el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
    return opt ? opt.text : '—';
  }
  var nameEl = el.querySelector ? el.querySelector('.alu-fill-name') : null;
  var txt = nameEl ? (nameEl.textContent || '').trim() : '';
  if (!txt && el.getAttribute) txt = el.getAttribute('data-code') || '';
  return txt || '—';
}

function showHud(name, zone) {
  var box = hudEl();
  if (!box) return;
  hudModule = name;
  hudZone = zone || null;
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
  // Рейка слева снизу (или наверху, пока открыта боковая панель) лежит ПОВЕРХ
  // HUD (z-index 38 против 32): если HUD ставится под курсор у её угла,
  // заголовок или кнопки оказались бы под ней. Сдвигаем HUD за край рейки —
  // вверх от неё (рейка внизу) или вниз (рейка наверху).
  var rail = document.getElementById('rail');
  if (rail && rail.offsetWidth) {
    var rr = rail.getBoundingClientRect();
    var gap = 8;
    var rl = rr.left - r.left, rt = rr.top - r.top, rrt = rr.right - r.left, rb = rr.bottom - r.top;
    if (x < rrt + gap && x + w > rl - gap && y < rb + gap && y + h > rt - gap) {
      y = document.documentElement.hasAttribute('data-rail-up') ? rb + gap : rt - gap - h;
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
  hudZone = null;
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

    if (e.target.closest('[data-hud-zone-edit]')) {
      var zm = hudModule, zs = hudZone ? hudZone.sectionIndex : 0, zz = hudZone ? hudZone.zoneIndex : 0;
      hideHud();
      if (zm && window.Modul3D.app && window.Modul3D.app.editModuleZone) {
        window.Modul3D.app.editModuleZone(zm, zs, zz);
      }
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
  // Если сцена уже создана (app.js поднимает её до uiShell.start()) —
  // подключаемся сразу, иначе ждём её по таймеру, как раньше.
  var tries = 0;
  var timer = null;
  function hookViewerEvents() {
    if (!viewerInstance) return false;
    // Какой кнопкой был последний клик по сцене: левая только выделяет модуль,
    // HUD (меню модуля) открывает правая. Слушатель в фазе capture срабатывает
    // раньше обработчика viewer.js, который вызывает onSelectModule с задержкой.
    var lastBtn = 0;
    var cv = viewerInstance.renderer && viewerInstance.renderer.domElement;
    if (cv) cv.addEventListener('pointerup', function (e) { lastBtn = e.button; }, true);
    var prev = viewerInstance.onSelectModule;
    viewerInstance.onSelectModule = function (name) {
      if (typeof prev === 'function') prev.call(viewerInstance, name);
      if (name && lastBtn === 2) showHud(name); else hideHud();
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
    // Теперь клик по отсеку показывает ТОТ ЖЕ HUD, что и клик по любой другой
    // части модуля, плюс блок секции для кликнутого отсека.
    var prevSelectZone = viewerInstance.onSelectZone;
    viewerInstance.onSelectZone = function (payload) {
      hideHud();
      if (typeof prevSelectZone === 'function') prevSelectZone.call(viewerInstance, payload);
      if (payload && payload.module && lastBtn === 2) {
        showHud(payload.module, { sectionIndex: payload.sectionIndex, zoneIndex: payload.zoneIndex });
      }
    };
    return true;
  }
  if (!hookViewerEvents()) {
    timer = setInterval(function () {
      if (hookViewerEvents() || ++tries > 40) clearInterval(timer);
    }, 60);
  }
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
  // Раньше здесь же был «свайп вниз по шапке листа — закрыть». Теперь шапка —
  // ручка регулировки высоты (раздел 7б): тот же жест тянет лист вниз, а
  // закрытием он становится только если потянуть заметно ниже минимума
  // (см. SHEET_CLOSE_PULL) — иначе он бы закрывал лист при любой попытке
  // просто сделать его пониже.
}

/* ---------------------------------------------------------------------------
   7б. Высота нижнего листа на телефоне (≤ 820px)

   Все панели-шторки (Библиотека, Параметры, Студия, Столешница, Документы —
   всё, что .drawer) на телефоне — нижние листы ОДНОЙ высоты. Её регулирует
   пользователь: тянет шапку листа (.drawer-head, кроме крестика) вверх — лист
   выше, вниз — ниже; двойной тап по шапке возвращает высоту по умолчанию
   (45% высоты окна). Границы — от 25% до 85% высоты окна (и не ниже
   SHEET_H_MIN_PX, чтобы шапка и пара строк содержимого всегда были видны).
   Если потянуть ниже минимума больше чем на SHEET_CLOSE_PULL px и отпустить —
   лист закрывается (замена прежнему «свайпу вниз по шапке»).

   Высота запоминается ДОЛЕЙ высоты окна (localStorage 'modul3d.sheetH', без
   хранилища — просто значение по умолчанию), поэтому при повороте экрана лист
   сохраняет пропорцию; при resize/повороте высота пересчитывается и
   зажимается в границы (ключ хранилища при этом не трогаем — иначе временное
   сжатие окна навсегда «съело» бы выбор пользователя).

   Высоту листа в CSS задаёт переменная --drawer-sheet-h (px, на <html>; см.
   style.css, раздел 17). Она есть ВСЕГДА, пока страница жива, даже когда
   панель закрыта — иначе при закрытии лист схлопывался бы посреди анимации.

   КОНТРАКТ для 3D-вьюера (камеру сдвигает viewer.js/geometry-engine, здесь мы
   её не трогаем — только публикуем):
   · CSS-переменная --mobile-drawer-h на <html>: высота ОТКРЫТОГО нижнего листа
     в px («420px»); «0px» — если панель закрыта или ширина окна > 820px
     (на компьютере переменная всегда 0 — она про телефонный лист).
     Текущее значение можно прочитать в любой момент (например, при подписке).
   · Событие 'modul3d:drawer-inset' на window (CustomEvent),
     detail: { bottom: <число px> } — то же значение числом: сколько пикселей
     снизу окна сцены закрыто листом. На телефоне — высота открытого листа; на
     компьютере (> 820px) — только пока открыта панель «Документы» (7б′): её
     высота плюс зазор до края сцены (и строка рейки при положении «слева
     снизу»); левые панели дают 0 — они сбоку и низ не закрывают. 0 — панели
     нет. Шлётся при открытии/закрытии/смене панели, повороте и resize окна,
     смене положения рейки, в ходе перетаскивания (не чаще раза за кадр —
     requestAnimationFrame) и всегда итоговым событием в конце жеста. Повторов
     с тем же значением подряд нет (кроме итогового события в конце жеста).
   · uiShell.getDrawerInset() отдаёт то же значение числом.
--------------------------------------------------------------------------- */
var SHEET_H_KEY = 'modul3d.sheetH';
var SHEET_H_DEFAULT = 0.45;     // высота по умолчанию — доля высоты окна
var SHEET_H_MIN = 0.25;         // границы — тоже доли высоты окна
var SHEET_H_MAX = 0.85;
var SHEET_H_MIN_PX = 96;        // но не ниже: шапка листа + пара строк содержимого
var SHEET_CLOSE_PULL = 48;      // потянули ниже минимума больше чем на столько px и отпустили — закрыть
var SHEET_TAP_MS = 450;         // окно двойного тапа по шапке (неспешный тап пальцем — 350–450 мс между отпусканиями)
var MOBILE_BAR_H = 40;          // высота полосы кнопок разделов (--sheet-h в style.css)
var SHEET_TAP_SLOP = 4;         // сдвиг меньше этого — не жест, а тап

var sheetRatio = SHEET_H_DEFAULT;   // запомненная высота листа, доля высоты окна
var sheetPx = 0;                    // высота листа в px «сейчас» (в ходе жеста может быть ниже минимума)
var sheetDrag = null;               // идущее перетаскивание: { id, head, y0, h0, raw, moved }
var sheetInsetRaf = 0;              // id запланированной публикации отступа (rAF-троттлинг)
var sheetInsetLast = null;          // последний опубликованный отступ (строка «низ|лево|право»)
var sheetLastTap = 0;               // время последнего тапа по шапке (для двойного тапа)

function isMobileLayout() {
  return !!(window.matchMedia && window.matchMedia('(max-width: 820px)').matches);
}

function windowHeight() {
  return window.innerHeight || document.documentElement.clientHeight || 600;
}

function sheetBounds() {
  var H = windowHeight();
  var min = Math.max(Math.round(H * SHEET_H_MIN), SHEET_H_MIN_PX);
  var max = Math.max(Math.round(H * SHEET_H_MAX), min);
  return { min: min, max: max, H: H };
}

function clampSheetPx(px) {
  var b = sheetBounds();
  return Math.min(b.max, Math.max(b.min, Math.round(px)));
}

function loadSheetRatio() {
  var v = NaN;
  try { v = parseFloat(localStorage.getItem(SHEET_H_KEY)); } catch (e) { /* нет хранилища — по умолчанию */ }
  if (isNaN(v)) return SHEET_H_DEFAULT;
  return Math.min(SHEET_H_MAX, Math.max(SHEET_H_MIN, v));
}

function saveSheetRatio() {
  try { localStorage.setItem(SHEET_H_KEY, String(sheetRatio)); } catch (e) { /* приватный режим */ }
}

// Единственное место, где высота листа попадает в CSS.
function setSheetPx(px) {
  sheetPx = px;
  document.documentElement.style.setProperty('--drawer-sheet-h', px + 'px');
}

// Сколько px снизу сцены сейчас закрыто листом (то, что видит 3D-вьюер):
// телефон — открытый нижний лист; компьютер — панель «Документы» (7б′).
function sheetInsetBottom() {
  if (!openPanel) return 0;
  // + полоса кнопок разделов (MOBILE_BAR_H): на открытом листе она лежит на его
  // верхней кромке и закрывает нижние пиксели видимой части сцены
  if (isMobileLayout()) return sheetPx + MOBILE_BAR_H;
  return openPanel === 'docs' ? docsInsetBottom() : 0;
}

// Публикует отступ для 3D-вьюера: переменная --mobile-drawer-h + событие
// 'modul3d:drawer-inset' (контракт — в шапке раздела). force — слать событие
// даже если значение не менялось (итог жеста).
function publishSheetInset(force) {
  var bottom = sheetInsetBottom();
  var sides = sheetInsetSides();
  // --mobile-drawer-h — про телефонный лист; на компьютере остаётся 0px
  document.documentElement.style.setProperty('--mobile-drawer-h',
    (isMobileLayout() ? bottom : 0) + 'px');
  var sig = bottom + '|' + sides.left + '|' + sides.right;
  if (!force && sig === sheetInsetLast) return;
  sheetInsetLast = sig;
  try {
    window.dispatchEvent(new CustomEvent('modul3d:drawer-inset', {
      detail: { bottom: bottom, left: sides.left, right: sides.right }
    }));
  } catch (e) { /* очень старый браузер без CustomEvent — вьюер просто не сдвинется */ }
}

// Боковые панели на компьютере (Библиотека, Параметры и т.д.) закрывают часть
// сцены слева или справа. Считаем по РАСКЛАДКЕ (offsetLeft/offsetWidth не
// зависят от transform, то есть от того, где панель на пути выезда): left —
// сколько px от ЛЕВОГО края окна закрыто, right — от ПРАВОГО. Панель «Документы»
// (нижняя) и телефонный лист боковых отступов не дают. + зазор до края панели.
var SIDE_PANEL_GAP = 8;
function sheetInsetSides() {
  var none = { left: 0, right: 0 };
  if (!openPanel || isMobileLayout() || openPanel === 'docs') return none;
  var el = drawerOf(openPanel);
  if (!el || !el.offsetParent || !el.offsetWidth) return none;
  var pr = el.offsetParent.getBoundingClientRect();
  var x0 = pr.left + el.offsetLeft, x1 = x0 + el.offsetWidth;
  var winW = window.innerWidth || document.documentElement.clientWidth || 1;
  if ((x0 + x1) / 2 < winW / 2) return { left: Math.round(x1 + SIDE_PANEL_GAP), right: 0 };
  return { left: 0, right: Math.round(winW - x0 + SIDE_PANEL_GAP) };
}

// В ходе перетаскивания — не чаще одного раза за кадр.
function scheduleSheetInset() {
  if (sheetInsetRaf) return;
  sheetInsetRaf = window.requestAnimationFrame(function () {
    sheetInsetRaf = 0;
    publishSheetInset(false);
  });
}

// Пересчёт высоты из запомненной доли: старт, открытие панели, resize/поворот,
// сброс по двойному тапу. Заодно пересчитывает высоту панели «Документы» на
// компьютере (7б′) и публикует отступ (force — см. publishSheetInset).
function refreshSheetHeight(force) {
  setSheetPx(clampSheetPx(sheetRatio * windowHeight()));
  refreshDocsHeight();
  publishSheetInset(!!force);
}

function onSheetPointerDown(e) {
  if (e.button > 0 || sheetDrag) return;             // только основная кнопка/касание
  if (!openPanel || !isMobileLayout()) return;
  var head = e.target.closest && e.target.closest('.drawer-head');
  if (!head || e.target.closest('.drawer-close')) return;   // крестик — обычная кнопка
  var drawer = head.closest('.drawer');
  if (!drawer || !drawer.classList.contains('open')) return;
  sheetDrag = { id: e.pointerId, head: head, y0: e.clientY, h0: sheetPx, raw: sheetPx, moved: false };
  // Указатель «прилипает» к шапке: жест не обрывается, когда палец уезжает с неё
  // (а он уезжает — лист движется вместе с пальцем).
  try { head.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
  head.addEventListener('pointermove', onSheetPointerMove);
  head.addEventListener('pointerup', onSheetPointerUp);
  head.addEventListener('pointercancel', onSheetPointerCancel);
  head.addEventListener('lostpointercapture', onSheetPointerCancel);
}

function onSheetPointerMove(e) {
  var d = sheetDrag;
  if (!d || e.pointerId !== d.id) return;
  var dy = d.y0 - e.clientY;                 // вверх — плюс: лист выше
  if (!d.moved) {
    if (Math.abs(dy) < SHEET_TAP_SLOP) return;   // дрожь пальца, не жест
    d.moved = true;
    document.body.classList.add('sheet-resizing');
  }
  var b = sheetBounds();
  d.raw = d.h0 + dy;
  // Выше максимума не растим; вниз — можно чуть ниже минимума («потяни, чтобы
  // закрыть»), на отпускании это либо закроет лист, либо вернёт его к минимуму.
  setSheetPx(Math.min(b.max, Math.max(Math.round(d.raw), b.min - 2 * SHEET_CLOSE_PULL)));
  scheduleSheetInset();
}

function onSheetPointerUp(e) {
  if (sheetDrag && e.pointerId === sheetDrag.id) endSheetDrag(false);
}

function onSheetPointerCancel(e) {
  if (sheetDrag && (!e || e.pointerId === sheetDrag.id)) endSheetDrag(true);
}

function endSheetDrag(cancelled) {
  var d = sheetDrag;
  if (!d) return;
  sheetDrag = null;
  d.head.removeEventListener('pointermove', onSheetPointerMove);
  d.head.removeEventListener('pointerup', onSheetPointerUp);
  d.head.removeEventListener('pointercancel', onSheetPointerCancel);
  d.head.removeEventListener('lostpointercapture', onSheetPointerCancel);
  try { d.head.releasePointerCapture(d.id); } catch (err) { /* уже отпущен */ }
  document.body.classList.remove('sheet-resizing');
  if (sheetInsetRaf) { window.cancelAnimationFrame(sheetInsetRaf); sheetInsetRaf = 0; }

  if (!d.moved) {
    // Тап по шапке. Два тапа подряд — вернуть высоту по умолчанию.
    if (cancelled) return;
    var now = Date.now();
    if (now - sheetLastTap < SHEET_TAP_MS) {
      sheetLastTap = 0;
      sheetRatio = SHEET_H_DEFAULT;
      saveSheetRatio();
      refreshSheetHeight(true);
    } else {
      sheetLastTap = now;
    }
    return;
  }

  var b = sheetBounds();
  if (!cancelled && openPanel && d.raw < b.min - SHEET_CLOSE_PULL) {
    // Потянули вниз «за минимум» — закрыть (closeDrawer сам сообщит отступ 0).
    // Урезанная высота вернётся при следующем открытии (openDrawer →
    // refreshSheetHeight), сохранённая доля при этом не менялась.
    closeDrawer(openPanel);
    return;
  }
  var px = clampSheetPx(sheetPx);
  setSheetPx(px);
  sheetRatio = Math.round((px / b.H) * 1000) / 1000;
  saveSheetRatio();
  publishSheetInset(true);        // итоговое событие жеста
}

function initSheetResize() {
  sheetRatio = loadSheetRatio();
  docsRatio = loadDocsRatio();
  // Переменные нужны до первого открытия панели (restoreUI в start()).
  refreshSheetHeight();
  document.addEventListener('pointerdown', onSheetPointerDown);
  initDocsResize();
  window.addEventListener('resize', function () {
    // Поворот экрана / смена размера окна / переход через 820px: пересчитать
    // высоту из запомненной доли, зажать в границы, пересообщить отступ.
    if (!sheetDrag && !docsDrag) refreshSheetHeight();
  });
  // Ширина боковой панели меняется анимацией (Библиотека: вкладки «Материалы»/
  // «Фурнитура» шире) — когда она дошла до конца, пересообщаем боковой отступ.
  document.addEventListener('transitionend', function (e) {
    if (e.propertyName === 'width' && e.target && e.target.classList &&
        e.target.classList.contains('drawer')) publishSheetInset(false);
  });
}

/* ---------------------------------------------------------------------------
   7б′. Высота панели «Документы» на компьютере (> 820px)

   Панель «Документы» — плавающая внизу сцены (style.css .drawer-bottom). Её
   высоту регулирует пользователь: тянет ВЕРХНЮЮ КРОМКУ (ручка #docsResize,
   полоса 10px) или пустую часть шапки (.drawer-head, кроме крестика) — вверх
   выше, вниз ниже. Двойной щелчок по ручке/шапке (на сенсорном экране —
   двойной тап) возвращает высоту по умолчанию min(62vh, 560px), как было до
   регулировки. Границы: от 25% до 90% высоты окна (и не ниже DOCS_H_MIN_PX),
   но так, чтобы панель со своими отступами (--sp-3 и строкой рейки при
   положении «слева снизу»/«справа сверху») не вылезала за верх сцены.

   Хранится ДОЛЯ высоты окна (localStorage 'modul3d.docsH'; нет значения или
   нет хранилища — высота по умолчанию). При resize окна высота пересчитывается
   и зажимается в границы, ключ хранилища при этом не трогаем.

   В CSS высота попадает переменной --docs-h (px, на <html>): height у
   .drawer-bottom и отступ панели режимов 3D (--vt-b) считаются от неё.

   3D над панелью: пока «Документы» открыты, вьюеру уходит тот же сигнал, что
   и от телефонного листа (контракт — в шапке 7б): 'modul3d:drawer-inset' с
   bottom = закрытая панелью нижняя часть сцены. Считаем по разметке, а не по
   getBoundingClientRect: панель «выезжает» переходом transform, и в момент
   открытия её прямоугольник ещё не на месте; offsetTop от transform не зависит.
--------------------------------------------------------------------------- */
var DOCS_H_KEY = 'modul3d.docsH';
var DOCS_H_DEFAULT_VH = 0.62;       // по умолчанию — min(62vh, 560px): как в CSS до регулировки
var DOCS_H_DEFAULT_MAX_PX = 560;
var DOCS_H_MIN = 0.25;              // границы — доли высоты окна
var DOCS_H_MAX = 0.90;
var DOCS_H_MIN_PX = 160;            // но не ниже: шапка, вкладки, строка масштаба и пара строк содержимого
var DOCS_DRAG_SLOP = 3;             // сдвиг меньше этого — не жест, а клик/тап
var DOCS_TAP_MS = 450;              // окно двойного тапа (сенсорный экран)

var docsRatio = null;               // запомненная высота — доля высоты окна; null — по умолчанию
var docsPx = 0;                     // высота панели в px «сейчас»
var docsDrag = null;                // идущее перетаскивание: { id, el, type, y0, h0, b (границы), moved }
var docsLastTap = 0;                // время последнего тапа по ручке/шапке (двойной тап)

// Значение CSS-переменной с <html> в px (--sp-3 → 12). Нет getComputedStyle
// (прогон tools/smoke.js без браузера) — запасное значение.
function rootCssPx(name, fallback) {
  if (typeof getComputedStyle !== 'function') return fallback;
  var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return isNaN(v) ? fallback : v;
}

// Отступы панели «Документы» от нижнего и верхнего края сцены — те же, что в
// style.css: --sp-3 у самой панели (рейка при открытых «Документах» стоит
// внутри её верхней строки, а не под ней).
function docsEdgeGaps() {
  var m = rootCssPx('--sp-3', 12);
  return { bottom: m, top: m };
}

function docsBounds() {
  var H = windowHeight();
  var stage = document.getElementById('stage');
  var stageH = (stage && stage.clientHeight) || (H - 52);   // 52 — высота шапки (--topbar-h)
  var g = docsEdgeGaps();
  var min = Math.max(Math.round(H * DOCS_H_MIN), DOCS_H_MIN_PX);
  var max = Math.min(Math.round(H * DOCS_H_MAX), Math.round(stageH - g.bottom - g.top));
  if (max < min) max = min;       // очень низкое окно: минимум важнее верхней границы
  return { min: min, max: max, H: H };
}

function clampDocsPx(px) {
  var b = docsBounds();
  return Math.min(b.max, Math.max(b.min, Math.round(px)));
}

function docsDefaultPx() {
  return Math.min(Math.round(windowHeight() * DOCS_H_DEFAULT_VH), DOCS_H_DEFAULT_MAX_PX);
}

function loadDocsRatio() {
  var v = NaN;
  try { v = parseFloat(localStorage.getItem(DOCS_H_KEY)); } catch (e) { /* нет хранилища — по умолчанию */ }
  if (isNaN(v)) return null;
  return Math.min(DOCS_H_MAX, Math.max(DOCS_H_MIN, v));
}

function saveDocsRatio() {
  try {
    if (docsRatio === null) localStorage.removeItem(DOCS_H_KEY);
    else localStorage.setItem(DOCS_H_KEY, String(docsRatio));
  } catch (e) { /* приватный режим */ }
}

// Единственное место, где высота «Документов» попадает в CSS.
function setDocsPx(px) {
  docsPx = px;
  document.documentElement.style.setProperty('--docs-h', px + 'px');
}

// Высота из запомненной доли (или по умолчанию), зажатая в границы. Без
// публикации отступа — её делает вызывающий (refreshSheetHeight/жест).
function refreshDocsHeight() {
  var want = docsRatio === null ? docsDefaultPx() : docsRatio * windowHeight();
  setDocsPx(clampDocsPx(want));
}

// Сколько px снизу окна сцены закрыто панелью «Документы»: от её верха до низа
// сцены — включает зазор --sp-3. Основной путь — по разметке
// (высота сцены минус offsetTop панели; она лежит прямо в #stage), запасной —
// высота + отступ снизу (нет разметки: прогон без браузера).
function docsInsetBottom() {
  var drawer = drawerOf('docs');
  var stage = document.getElementById('stage');
  var v = NaN;
  if (drawer && stage && drawer.offsetParent === stage && stage.clientHeight) {
    v = stage.clientHeight - drawer.offsetTop;
  }
  if (!(v > 0)) v = docsPx + docsEdgeGaps().bottom;
  return Math.max(0, Math.round(v));
}

// За что тянут: сама ручка #docsResize или шапка панели (кроме крестика).
function docsGrabEl(e) {
  var t = e.target;
  if (!t || !t.closest) return null;
  if (t.closest('.drawer-close')) return null;          // крестик — обычная кнопка
  var grip = t.closest('#docsResize');
  if (grip) return grip;
  var head = t.closest('.drawer-head');
  return (head && head.closest && head.closest('#drawer-docs')) ? head : null;
}

function onDocsPointerDown(e) {
  if (e.button > 0 || e.isPrimary === false) return;    // основная кнопка/первый палец
  if (isMobileLayout() || openPanel !== 'docs') return;
  var el = docsGrabEl(e);
  if (!el) return;
  var drawer = drawerOf('docs');
  if (!drawer || !drawer.classList.contains('open')) return;
  // «Залипший» жест: pointerup потерялся (окно потеряло фокус, системное меню…),
  // а новый pointerdown уже пришёл — старый жест протух, сбрасываем его и
  // начинаем новый, иначе панель осталась бы «приклеенной» до перезагрузки.
  if (docsDrag) endDocsDrag(true, false);
  // Границы считаем один раз на жест: по ходу перетаскивания они не меняются, а
  // их вычисление читает разметку (лишний пересчёт на каждое движение мыши).
  docsDrag = { id: e.pointerId, el: el, type: e.pointerType || 'mouse', y0: e.clientY,
               h0: docsPx, b: docsBounds(), moved: false };
  // Указатель «прилипает» к ручке: жест не обрывается, когда курсор уезжает с неё
  // (а он уезжает — панель движется вместе с ним).
  try { el.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
  el.addEventListener('pointermove', onDocsPointerMove);
  el.addEventListener('pointerup', onDocsPointerUp);
  el.addEventListener('pointercancel', onDocsPointerCancel);
  el.addEventListener('lostpointercapture', onDocsPointerCancel);
  // Текст не выделяется, курсор «изменение высоты» — с самого нажатия
  document.body.classList.add('docs-resizing');
}

function onDocsPointerMove(e) {
  var d = docsDrag;
  if (!d || e.pointerId !== d.id) return;
  // Кнопку отпустили где-то мимо окна, а pointerup не пришёл — жест закончен
  if (d.type === 'mouse' && e.buttons === 0) { endDocsDrag(false, false); return; }
  var dy = d.y0 - e.clientY;                 // вверх — плюс: панель выше
  if (!d.moved) {
    if (Math.abs(dy) < DOCS_DRAG_SLOP) return;   // дрожь руки, не жест
    d.moved = true;
  }
  setDocsPx(Math.min(d.b.max, Math.max(d.b.min, Math.round(d.h0 + dy))));
  scheduleSheetInset();
}

function onDocsPointerUp(e) {
  if (docsDrag && e.pointerId === docsDrag.id) endDocsDrag(false, false);
}

function onDocsPointerCancel(e) {
  if (docsDrag && (!e || e.pointerId === docsDrag.id)) endDocsDrag(true, false);
}

// quiet — не публиковать отступ (закрытие панели: closeDrawer сообщит 0 сам).
function endDocsDrag(cancelled, quiet) {
  var d = docsDrag;
  if (!d) return;
  docsDrag = null;
  d.el.removeEventListener('pointermove', onDocsPointerMove);
  d.el.removeEventListener('pointerup', onDocsPointerUp);
  d.el.removeEventListener('pointercancel', onDocsPointerCancel);
  d.el.removeEventListener('lostpointercapture', onDocsPointerCancel);
  try { d.el.releasePointerCapture(d.id); } catch (err) { /* уже отпущен */ }
  document.body.classList.remove('docs-resizing');
  if (sheetInsetRaf) { window.cancelAnimationFrame(sheetInsetRaf); sheetInsetRaf = 0; }

  if (!d.moved) {
    // Клик/тап без сдвига. Двойной щелчок мышью ловит dblclick (initDocsResize),
    // на сенсорном экране двойной щелчок не приходит — считаем два тапа сами.
    if (cancelled || quiet || d.type !== 'touch') return;
    var now = Date.now();
    if (now - docsLastTap < DOCS_TAP_MS) { docsLastTap = 0; resetDocsHeight(); }
    else docsLastTap = now;
    return;
  }

  var b = docsBounds();
  var px = clampDocsPx(docsPx);
  setDocsPx(px);
  docsRatio = Math.round((px / b.H) * 1000) / 1000;
  saveDocsRatio();
  if (!quiet) publishSheetInset(true);       // итоговое событие жеста
}

// Высота по умолчанию (двойной щелчок/тап по ручке или шапке).
function resetDocsHeight() {
  docsRatio = null;
  saveDocsRatio();
  refreshDocsHeight();
  publishSheetInset(false);
}

function initDocsResize() {
  document.addEventListener('pointerdown', onDocsPointerDown);
  document.addEventListener('dblclick', function (e) {
    if (isMobileLayout() || openPanel !== 'docs') return;
    if (docsGrabEl(e)) resetDocsHeight();
  });
}

/* ---------------------------------------------------------------------------
   7в. Масштаб чертежей (вкладка «Чертежи» панели «Документы»)

   Все чертежи вкладки — ОДИН лист (#dwSheet внутри #dwZoom; обёртку пишет
   app.js: renderDrawings → uiShell.setDrawingsContent), масштабируются они
   разом. 100% — вид, как чертежи нарисованы без масштаба (раскладка листа
   при любом масштабе одна и та же — как на 100%, меняется только размер).
   Верхняя граница 400%, нижняя 25% (на телефоне — меньшее из 25% и «по
   ширине», см. ниже). Отдельного ряда управления (ползунка, кнопок −/+) нет:
   всё место отдано чертежам. Способы:
   · клавиши + и − (шаг 10 п.п., по кругу «круглых» значений: 90 → 100 → 110),
     только пока «Документы» открыты на вкладке «Чертежи» и фокус не в поле
     ввода (Ctrl/Alt/Meta+± остаётся зумом браузера);
   · Ctrl + колесо мыши — плавно, вокруг курсора: один щелчок колеса
     (deltaY ≈ 100) = ×1.1. Щипок по тачпаду ноутбука браузер шлёт как то же
     wheel с ctrlKey и малыми deltaY — он работает тем же кодом. Колесо БЕЗ
     Ctrl ничего не перехватывает и по-прежнему прокручивает вкладку;
   · щипок двумя пальцами на сенсорном экране — вокруг точки между пальцами
     (эта же точка тянет лист за пальцами);
   · двойной щелчок мышью / двойной тап — стандартный вид и начало листа:
     100% на компьютере, «по ширине» на телефоне. Мышью лист можно «взять»
     левой кнопкой и двигать.

   Телефон: чертёж вписывается по ширине. «Телефон» — окно ≤ 820px
   (isMobileLayout, та же граница, что у нижнего листа). Раскладка листа от
   масштаба не зависит: её ширина всегда W (ширина области без отступов),
   блоки переносятся по ней, а SVG с фиксированными размерами выпирают за
   правый край. Самый широкий из них и определяет «естественную» ширину листа —
   это sheet.scrollWidth. Масштаб «по ширине» = W / scrollWidth (если та
   больше W; иначе 1 — мелкие чертежи не увеличиваем), округлённый ВНИЗ до
   0.001, чтобы правый край не вылез на долю пикселя. Пока пользователь не
   менял масштаб сам (клавиши, Ctrl+колесо, щипок, setDrawingsZoom), включён
   режим «авто»: масштаб = «по ширине» и пересчитывается при показе и каждой
   перерисовке чертежей (setDrawingsContent), при смене ширины области
   (ResizeObserver листа и resize окна — поворот экрана) и при переходе через
   820px. Ручное изменение режим выключает — масштаб больше не «прыгает» при
   перерисовке; двойной тап/щелчок включает его снова. Нижняя граница
   на телефоне — min(25%, «по ширине»): очень широкий чертёж вписывается и в
   масштаб меньше 25%, и вернуться к нему щипком можно без скачка к 25%.
   На компьютере автоматически ничего не вписывается: 100% — как отрисовано.

   Как это устроено. .dw-zoom получает ширину scale·100% (реальный размер →
   реальные полосы прокрутки) и высоту = высота листа·scale; сам .dw-sheet —
   transform: scale() от левого верхнего угла и ширину 100%/scale (то есть та
   же раскладочная ширина, что на 100%). transform, а не CSS zoom: одинаково
   во всех браузерах, а «точка под пальцами остаётся на месте» считается по
   getBoundingClientRect без оговорок про zoom. SVG при этом остаётся
   векторным — линии и текст чёткие на любом масштабе. Высота .dw-zoom
   пересчитывается по ResizeObserver листа (другая ширина панели, перерисовка,
   показ вкладки) — в следующем кадре, чтобы не ловить «ResizeObserver loop».

   Состояние — только в переменной модуля: при перерисовке чертежей
   (recompute) масштаб и позиция прокрутки сохраняются, после перезагрузки
   страницы — стандартный вид. Печать чертежей (app.js) берёт «сырую» разметку
   без обёртки и от масштаба не зависит.
--------------------------------------------------------------------------- */
var DW_ZOOM_MIN = 0.25;
var DW_ZOOM_MAX = 4;
var DW_ZOOM_STEP = 10;           // п.п. масштаба на одно нажатие +/−
var DW_WHEEL_NOTCH = 100;        // deltaY одного щелчка колеса мыши, px
var DW_WHEEL_BASE = 1.1;         // во сколько раз меняет масштаб один щелчок
var DW_WHEEL_MAX = 3;            // не больше стольких щелчков за одно событие (защита от скачка)
var DW_FIT_MIN = 0.001;          // «по ширине» не ниже этого (защита от нуля при абсурдно широком чертеже)
var DW_FIT_LOOP = 4;             // столько смен масштаба от смены раскладки за секунду — уже цикл, стоп
var DW_PAN_SLOP = 4;             // мышь: сдвиг меньше этого — клик, лист не двигаем
var DW_TAP_MOVE = 8;             // палец сдвинулся больше — это прокрутка, а не тап
var DW_TAP_MS = 450;             // двойной тап: два касания не дольше этого друг от друга (как SHEET_TAP_MS — неспешный тап пальцем)
var DW_TAP_DIST = 30;            // …и не дальше этого (px) друг от друга

var dwScale = 1;                 // текущий масштаб (1 = 100%)
var dwManual = false;            // масштаб менял пользователь — авто-вписывание по ширине выключено
var dwFit = 1;                   // «по ширине»: последний замер на телефоне (на компьютере и когда вписывать нечего — 1)
var dwWasMobile = false;         // раскладка при прошлой синхронизации (граница 820px)
var dwFitStamps = [];            // моменты (мс) последних смен масштаба от смены раскладки — страховка от цикла
var dwPan = null;                // мышиное перетаскивание листа: { id, x0, y0, sl0, st0, moved }
var dwPtrs = {};                 // касания на области чертежей: pointerId → { x, y }
var dwPinch = null;              // щипок: { ids: [id1, id2], d, mx, my } — прошлый кадр
var dwTap = null;                // касание, которое может оказаться тапом: { id, x, y, t }
var dwLastTap = null;            // предыдущий тап: { t, x, y }
var dwMouse = null;              // последняя позиция мыши над областью чертежей (для клавиш +/−)
var dwRo = null;                 // ResizeObserver листа
var dwSyncRaf = 0;               // отложенная пересинхронизация масштаба и высоты .dw-zoom

function dwPane() { return document.getElementById('tab-drawings'); }
function dwBox() { return document.getElementById('dwZoom'); }
function dwSheet() { return document.getElementById('dwSheet'); }

// cur — текущий масштаб: если он уже ниже границы (после поворота экрана в
// ручном режиме «по ширине» подросло), вверх его не подбрасываем.
function clampDwScale(s, cur) {
  if (!(s > 0)) s = 1;
  // Нижняя граница — меньшее из 25% и «по ширине»: широкий чертёж на узком
  // экране вписывается и в масштаб ниже 25%, «застревать» выше него нельзя.
  var lo = Math.min(DW_ZOOM_MIN, dwFit);
  if (cur > 0 && cur < lo) lo = cur;
  return Math.round(Math.min(DW_ZOOM_MAX, Math.max(lo, s)) * 10000) / 10000;
}

// Ставит текущий dwScale на разметку. При 100% inline-стили сняты — вкладка
// выглядит ровно так же, как до появления масштаба.
function applyDwScaleDom() {
  var box = dwBox(), sheet = dwSheet();
  if (!box || !sheet) return;
  // dw-scaled — метка «масштаб не 100%»: CSS снимает у шапок таблицы sticky
  // (под transform липкая шапка считается в непреобразованных координатах).
  box.classList.toggle('dw-scaled', dwScale !== 1);
  if (dwScale === 1) {
    box.style.width = ''; box.style.height = '';
    sheet.style.width = ''; sheet.style.transform = '';
    return;
  }
  box.style.width = (Math.round(dwScale * 10000) / 100) + '%';   // без хвоста 110.00000000000001
  sheet.style.width = (100 / dwScale) + '%';
  sheet.style.transform = 'scale(' + dwScale + ')';
  // Раскладочная высота листа (transform на неё не влияет) — нужна, чтобы
  // .dw-zoom занимал столько же места, сколько лист занимает на экране.
  var h = sheet.offsetHeight;
  box.style.height = h ? (h * dwScale) + 'px' : '';
}

// Пересчёт высоты .dw-zoom после того, как лист изменил размер сам (другая
// ширина панели → другая раскладка, вкладку показали, чертежи перерисовали).
function syncDwBox() {
  if (dwScale === 1) return;
  var box = dwBox(), sheet = dwSheet();
  if (!box || !sheet) return;
  var h = sheet.offsetHeight;
  if (h) box.style.height = (h * dwScale) + 'px';
}

/* --- телефон: вписать чертёж по ширине ----------------------------------- */

// Ширина области чертежей без горизонтальных отступов — ширина, в которой
// раскладывается лист.
function dwAvailWidth(pane) {
  var w = pane.clientWidth || 0;
  var cs = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(pane) : null;
  if (cs) w -= (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  return w;
}

// Масштаб «по ширине»: при нём самый широкий чертёж целиком помещается в
// область. 1 — вписывать нечего; 0 — измерить нельзя (вкладка не показана).
function measureDwFit() {
  var pane = dwPane(), sheet = dwSheet();
  if (!pane || !sheet) return 0;
  var w = dwAvailWidth(pane);
  var natural = sheet.scrollWidth || 0;       // ширина листа вместе с выпирающими чертежами
  if (!(w > 0) || !(natural > 0)) return 0;
  if (natural <= w + 1) return 1;             // +1px: округление scrollWidth, а не настоящий выход за край
  return Math.max(DW_FIT_MIN, Math.floor(w / natural * 1000) / 1000);
}

// Ставит масштаб f (уже в границах) как «по ширине»: прокрутка по X — в ноль
// (чертёж прижат влево), по Y — то же место листа остаётся сверху.
function applyDwFit(f) {
  var pane = dwPane();
  var old = dwScale;
  var st = pane ? (pane.scrollTop || 0) : 0;
  dwScale = f;
  applyDwScaleDom();
  if (pane) {
    pane.scrollLeft = 0;
    pane.scrollTop = Math.round(st * f / old);
  }
}

// Согласует масштаб с раскладкой: телефон ↔ компьютер, ширина области и
// ширина содержимого. Зовётся при показе/перерисовке чертежей, смене ширины
// области и повороте экрана. Режим «авто» (dwManual === false) на телефоне
// ставит «по ширине»; в ручном режиме масштаб не трогаем, только обновляем
// dwFit — от него зависит нижняя граница.
function syncDwFit() {
  var mobile = isMobileLayout();
  if (mobile !== dwWasMobile) {
    // Перешли через 820px: раскладка другая, прежний масштаб (и ручной тоже)
    // к ней уже не относится — начинаем заново: телефон — «по ширине»,
    // компьютер — 100%.
    dwWasMobile = mobile;
    dwManual = false;
    if (!mobile) {
      dwFit = 1;
      if (dwScale !== 1) applyDwFit(1);
      return;
    }
  }
  if (!mobile) { dwFit = 1; return; }
  var f = measureDwFit();
  if (!f) return;
  dwFit = f;
  if (!dwManual && f !== dwScale) applyDwFit(f);
}

// Отложенная (в следующем кадре) синхронизация: зовут ResizeObserver листа и
// resize окна. Разметку правим НЕ в самом колбэке ResizeObserver, а в кадре:
// иначе смена ширины из-за полосы прокрутки давала бы «ResizeObserver loop»,
// которое попадает в баннер ошибок.
function scheduleDwSync() {
  if (dwSyncRaf) return;
  dwSyncRaf = window.requestAnimationFrame(function () {
    dwSyncRaf = 0;
    // Страховка: если вписывание по ширине само меняет ширину области (полоса
    // прокрутки то появляется, то исчезает), оно могло бы дёргать масштаб
    // каждый кадр. Несколько смен подряд за секунду — стоп до следующего
    // настоящего изменения раскладки.
    var now = Date.now();
    while (dwFitStamps.length && now - dwFitStamps[0] > 1000) dwFitStamps.shift();
    var before = dwScale;
    if (dwFitStamps.length < DW_FIT_LOOP) syncDwFit();
    if (dwScale !== before) dwFitStamps.push(now);
    syncDwBox();
  });
}

function observeDwSheet() {
  if (typeof ResizeObserver !== 'function') return;
  if (!dwRo) dwRo = new ResizeObserver(scheduleDwSync);
  dwRo.disconnect();
  var sheet = dwSheet();
  if (sheet) dwRo.observe(sheet);
}

// Центр видимой части области чертежей (координаты окна) — точка, вокруг
// которой масштабируют клавиши +/−, когда мыши над чертежами нет.
function dwPaneCenter(pane) {
  var r = pane.getBoundingClientRect();
  return { x: r.left + pane.clientWidth / 2, y: r.top + pane.clientHeight / 2 };
}

// Новый масштаб РУКАМИ пользователя (клавиши, Ctrl+колесо, щипок,
// setDrawingsZoom): выключает авто-вписывание. anchor { x, y } — точка окна,
// которая должна остаться на месте (без неё — центр области). Точка листа под
// anchor запоминается ДО смены масштаба, после — прокруткой возвращается под
// anchor.
function setDwScale(s, anchor) {
  var old = dwScale;
  s = clampDwScale(s, old);
  if (s === old) return;                 // упёрлись в границу — ничего не изменилось, режим тоже
  dwManual = true;
  var pane = dwPane(), sheet = dwSheet();
  var canAnchor = !!(pane && sheet && pane.offsetWidth);
  var a = null, u = 0, v = 0;
  if (canAnchor) {
    a = anchor || dwPaneCenter(pane);
    var r0 = sheet.getBoundingClientRect();
    u = (a.x - r0.left) / old;
    v = (a.y - r0.top) / old;
  }
  dwScale = s;
  applyDwScaleDom();
  if (!canAnchor) return;
  var r1 = sheet.getBoundingClientRect();
  var dx = (r1.left + u * s) - a.x;
  var dy = (r1.top + v * s) - a.y;
  if (isFinite(dx)) pane.scrollLeft += dx;
  if (isFinite(dy)) pane.scrollTop += dy;
}

// Шаг +/− : по «круглым» значениям (90 → 100 → 110), а не «прибавить 10» —
// иначе из 25% в 100% попасть было бы нельзя (35, 45, … 95, 105).
function stepDwZoom(dir, anchor) {
  var pct = Math.round(dwScale * 100);
  var next = dir > 0
    ? (Math.floor(pct / DW_ZOOM_STEP) + 1) * DW_ZOOM_STEP
    : (Math.ceil(pct / DW_ZOOM_STEP) - 1) * DW_ZOOM_STEP;
  setDwScale(next / 100, anchor);
}

// Стандартный вид и начало листа (двойной щелчок/тап): компьютер — 100%,
// телефон — «по ширине» (и режим «авто» включается снова).
function resetDwZoom() {
  dwManual = false;
  dwWasMobile = isMobileLayout();
  var f = 1;
  if (dwWasMobile) f = measureDwFit() || 1;
  dwFit = f;
  dwScale = f;
  applyDwScaleDom();
  var pane = dwPane();
  if (pane) { pane.scrollLeft = 0; pane.scrollTop = 0; }
}

// Записывает чертежи в #tab-drawings в обёртке масштаба (её зовёт app.js:
// renderDrawings). Масштаб и позиция прокрутки при перерисовке сохраняются;
// на телефоне в режиме «авто» масштаб заново вписывается по ширине.
// false — нет области чертежей: вызывающий пишет разметку сам.
function setDrawingsContent(html) {
  var pane = dwPane();
  if (!pane) return false;
  var sl = pane.scrollLeft || 0, st = pane.scrollTop || 0;
  pane.innerHTML = '<div class="dw-zoom" id="dwZoom"><div class="dw-sheet" id="dwSheet">'
    + html + '</div></div>';
  applyDwScaleDom();
  observeDwSheet();
  if (sl || st) { pane.scrollLeft = sl; pane.scrollTop = st; }
  syncDwFit();
  return true;
}

// Точка внутри клиентской области (без полос прокрутки)?
function dwInsideClient(pane, e) {
  var r = pane.getBoundingClientRect();
  return (e.clientX - r.left) < pane.clientWidth && (e.clientY - r.top) < pane.clientHeight;
}

/* --- мышь: «взять» лист и двигать ---------------------------------------- */
function endDwPan() {
  var d = dwPan;
  if (!d) return;
  dwPan = null;
  // ПКМ в режиме разметки: запоминаем, тащили ли лист, — от этого зависит,
  // считать ли отпускание кнопки «простым щелчком ПКМ» (см. onDwContextMenu).
  if (d.mask === 2) {
    dwRmbLastMoved = d.moved;
    if (d.ctxPending && !d.moved) markupCancelDraft();   // macOS: contextmenu пришёл раньше, на нажатии
  }
  var pane = dwPane();
  if (!pane) return;
  pane.classList.remove('dw-panning');
  if (d.moved) { try { pane.releasePointerCapture(d.id); } catch (err) { /* уже отпущен */ } }
}

function moveDwPan(e) {
  var d = dwPan;
  var pane = dwPane();
  if (!pane) { endDwPan(); return; }
  if ((e.buttons & (d.mask || 1)) === 0) { endDwPan(); return; }   // кнопку отпустили мимо окна — pointerup не пришёл
  var dx = e.clientX - d.x0, dy = e.clientY - d.y0;
  if (!d.moved) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < DW_PAN_SLOP) return;   // клик, а не перетаскивание
    d.moved = true;
    pane.classList.add('dw-panning');
    try { pane.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
  }
  pane.scrollLeft = d.sl0 - dx;
  pane.scrollTop = d.st0 - dy;
}

/* --- колесо: Ctrl + колесо = масштаб вокруг курсора ---------------------- */
// Ctrl + колесо мыши (и щипок по тачпаду — браузер шлёт его как wheel с
// ctrlKey) меняет масштаб плавно, вокруг курсора. Без Ctrl не трогаем ничего:
// колесо прокручивает вкладку как обычно. Слушатель висит на самой области
// чертежей, поэтому работает только пока курсор над ней.
function onDwWheel(e) {
  if (!e.ctrlKey) return;
  e.preventDefault();                          // зум всей страницы браузером не нужен
  var dy = Number(e.deltaY) || 0;
  if (!dy) return;
  // В «щелчки» колеса: пиксели — по 100 на щелчок; строки (Firefox) — по 3;
  // страницы — страница на щелчок. Тачпад шлёт малые deltaY — доли щелчка.
  var n = e.deltaMode === 1 ? dy / 3 : (e.deltaMode === 2 ? dy : dy / DW_WHEEL_NOTCH);
  n = Math.max(-DW_WHEEL_MAX, Math.min(DW_WHEEL_MAX, n));
  var anchor = (typeof e.clientX === 'number' && typeof e.clientY === 'number')
    ? { x: e.clientX, y: e.clientY } : null;
  setDwScale(dwScale * Math.pow(DW_WHEEL_BASE, -n), anchor);   // вниз (deltaY > 0) — уменьшить
}

/* --- касание: щипок двумя пальцами и двойной тап ------------------------- */
function startDwPinch() {
  var ids = Object.keys(dwPtrs);
  if (ids.length !== 2) return;
  var a = dwPtrs[ids[0]], b = dwPtrs[ids[1]];
  dwPinch = {
    ids: ids,
    d: Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1),
    mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2
  };
}

// Кадр щипка: масштаб растёт как расстояние между пальцами (от прошлого
// кадра), точка под прошлой серединой остаётся на месте, а сдвиг середины
// тянет лист за пальцами.
function moveDwPinch() {
  var p = dwPinch;
  if (!p) return;
  var a = dwPtrs[p.ids[0]], b = dwPtrs[p.ids[1]];
  if (!a || !b) { dwPinch = null; return; }
  var d = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
  var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  var pane = dwPane();
  setDwScale(dwScale * d / p.d, { x: p.mx, y: p.my });
  if (pane) { pane.scrollLeft += p.mx - mx; pane.scrollTop += p.my - my; }
  p.d = d; p.mx = mx; p.my = my;
}

function dropDwPointer(id) {
  delete dwPtrs[id];
  if (dwPinch && dwPinch.ids.indexOf(String(id)) >= 0) dwPinch = null;
  if (dwTap && dwTap.id === id) dwTap = null;
}

// Включён ли режим ручной разметки чертежа (src/markup.js). Пока он включён,
// левая кнопка мыши на чертеже — инструмент разметки (точки, перетаскивание
// готового размера), поэтому лист мышью не тащим и двойным щелчком масштаб не
// сбрасываем: два быстрых щелчка по точкам размера иначе сбрасывали бы вид.
// Колесо с Ctrl, клавиши +/− и полосы прокрутки работают как обычно.
function markupModeOn() {
  var mk = window.Modul3D && window.Modul3D.markup;
  return !!(mk && mk.isActive && mk.isActive());
}

// ПРАВАЯ кнопка в режиме разметки — панорама листа (ЛКМ занята разметкой).
// Простой щелчок ПКМ без движения — отмена начатой постановки размера (как
// Esc). Контекстное меню браузера над областью чертежей в этом режиме
// подавляется. Вне режима разметки всё как раньше (ПКМ — меню браузера).
var dwRmbLastMoved = false;
function markupCancelDraft() {
  var mk = window.Modul3D && window.Modul3D.markup;
  if (mk && typeof mk.cancelDraft === 'function') mk.cancelDraft();
}
// macOS: Ctrl+клик тоже вызывает contextmenu (кнопка 0 с ctrlKey) — в режиме
// разметки меню так же подавится, а «щелчок без движения» отменит начатую
// постановку. Специально не обрабатываем: Ctrl+клик как инструмент разметки
// не предусмотрен, поведение согласовано с координатором.
function onDwContextMenu(e) {
  if (!markupModeOn()) return;
  e.preventDefault();
  // Windows/Linux: contextmenu приходит ПОСЛЕ отпускания кнопки (pan уже
  // завершён, dwRmbLastMoved известен); macOS — на нажатии, решаем в endDwPan.
  if (dwPan && dwPan.mask === 2) { dwPan.ctxPending = true; return; }
  if (!dwRmbLastMoved) markupCancelDraft();
  dwRmbLastMoved = false;
}

function onDwPointerDown(e) {
  var pane = dwPane();
  if (!pane) return;
  if (e.pointerType === 'mouse') {
    if (!dwInsideClient(pane, e)) return;                     // не полоса прокрутки
    // Обычно лист тащат левой кнопкой; в режиме разметки ЛКМ — инструмент
    // разметки, поэтому лист тащится ПРАВОЙ (см. onDwContextMenu).
    var panBtn = markupModeOn() ? 2 : 0;
    if (e.button !== panBtn) return;
    if (dwPan) endDwPan();                                    // «залипший» жест — сброс
    dwPan = { id: e.pointerId, x0: e.clientX, y0: e.clientY, sl0: pane.scrollLeft, st0: pane.scrollTop,
      moved: false, mask: panBtn === 2 ? 2 : 1 };
    return;
  }
  // Касание/перо. Первый палец новой серии — прежние касания протухли
  // (pointerup мог не дойти: разметку заменили под пальцем), начинаем с чистого листа.
  if (e.isPrimary) { dwPtrs = {}; dwPinch = null; dwTap = null; }
  dwPtrs[e.pointerId] = { x: e.clientX, y: e.clientY };
  var n = Object.keys(dwPtrs).length;
  if (n === 1) {
    dwTap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now() };
  } else {
    dwTap = null; dwLastTap = null;         // второй палец — точно не тап
    if (n === 2) startDwPinch();
  }
}

function onDwPointerMove(e) {
  if (e.pointerType === 'mouse') {
    dwMouse = { x: e.clientX, y: e.clientY };
    if (dwPan && e.pointerId === dwPan.id) moveDwPan(e);
    return;
  }
  var p = dwPtrs[e.pointerId];
  if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (dwTap && dwTap.id === e.pointerId
      && Math.max(Math.abs(p.x - dwTap.x), Math.abs(p.y - dwTap.y)) > DW_TAP_MOVE) {
    dwTap = null; dwLastTap = null;         // палец поехал — это прокрутка
  }
  if (dwPinch) moveDwPinch();
}

function onDwPointerUp(e) {
  if (e.pointerType === 'mouse') {
    if (dwPan && e.pointerId === dwPan.id) endDwPan();
    return;
  }
  if (!dwPtrs[e.pointerId]) return;
  var tap = (dwTap && dwTap.id === e.pointerId) ? dwTap : null;
  dropDwPointer(e.pointerId);
  if (!tap) return;
  // Одиночный короткий тап; два подряд рядом — вернуть стандартный вид.
  var now = Date.now();
  if (now - tap.t > DW_TAP_MS) { dwLastTap = null; return; }
  var prev = dwLastTap;
  if (prev && now - prev.t < DW_TAP_MS
      && Math.max(Math.abs(tap.x - prev.x), Math.abs(tap.y - prev.y)) < DW_TAP_DIST) {
    dwLastTap = null;
    resetDwZoom();
  } else {
    dwLastTap = { t: now, x: tap.x, y: tap.y };
  }
}

function onDwPointerCancel(e) {
  if (e.pointerType === 'mouse') {
    if (dwPan && e.pointerId === dwPan.id) endDwPan();
    return;
  }
  // Браузер забрал жест себе (родная прокрутка одним пальцем) — сбросить, что
  // успели насчитать. lostpointercapture после обычного pointerup сюда тоже
  // попадает, но записи уже нет — ничего не происходит.
  dropDwPointer(e.pointerId);
}

// Двумя пальцами родную прокрутку и приближение страницы гасим (иначе браузер
// забирает жест, и pointer events по щипку обрываются). Одним пальцем —
// не трогаем: лист прокручивается как обычно.
function onDwTouchMove(e) {
  if (e.touches && e.touches.length >= 2 && e.cancelable) e.preventDefault();
}

// Только Safari (gesturestart/gesturechange): подстраховка, если браузер не
// уважает touch-action и хочет приблизить всю страницу. Гасим ТОЛЬКО когда на
// области чертежей реально лежат два касания — щипок трекпада (касаний нет)
// остаётся обычным зумом страницы.
function onDwGesture(e) {
  if (Object.keys(dwPtrs).length >= 2 && e.cancelable !== false) e.preventDefault();
}

function onDwDblClick(e) {
  if (markupModeOn()) return;   // см. markupModeOn: два щелчка — это точки размера
  var pane = dwPane();
  if (pane && dwInsideClient(pane, e)) resetDwZoom();
}

// Клавиши + и −: +1 / −1 / 0 (не наша клавиша или зажат Ctrl/Alt/Meta —
// Ctrl+± остаётся зумом браузера). Shift допустим: «+» на большинстве
// раскладок — это Shift+«=». И код клавиши, и символ: раскладки разные.
function dwZoomKeyDir(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return 0;
  var k = e.key, c = e.code;
  if (k === '+' || k === '=' || c === 'NumpadAdd' || c === 'Equal') return 1;
  if (k === '-' || k === '_' || k === '−' || c === 'NumpadSubtract' || c === 'Minus') return -1;
  return 0;
}

// Работают ли +/− сейчас: панель «Документы» открыта на вкладке «Чертежи» и
// фокус не в поле ввода.
function dwHotkeysActive(target) {
  if (openPanel !== 'docs') return false;
  var pane = dwPane();
  if (!pane || !pane.classList.contains('active')) return false;
  if (target) {
    var tag = target.tagName || '';
    if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'INPUT') return false;
    if (target.isContentEditable) return false;
  }
  return true;
}

// Точка для клавиш +/−: под курсором, если он над чертежами, иначе центр области.
function dwKeyAnchor() {
  var pane = dwPane();
  if (!pane || !dwMouse) return null;
  var r = pane.getBoundingClientRect();
  var inside = dwMouse.x >= r.left && dwMouse.x < r.left + pane.clientWidth
    && dwMouse.y >= r.top && dwMouse.y < r.top + pane.clientHeight;
  return inside ? dwMouse : null;
}

// Окно редактора детали (app.js: openPartVisualEditor) — та же ПКМ-панорама в
// режиме разметки: область .part-editor-body прокручивается (overflow:auto).
function initEditorRmbPan() {
  var body = document.querySelector('#partEditorOverlay .part-editor-body');
  if (!body) return;
  var pan = null, lastMoved = false;
  body.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse' || e.button !== 2 || !markupModeOn()) return;
    pan = { id: e.pointerId, x0: e.clientX, y0: e.clientY, sl0: body.scrollLeft, st0: body.scrollTop, moved: false, ctx: false };
  });
  body.addEventListener('pointermove', function (e) {
    if (!pan || e.pointerId !== pan.id) return;
    if ((e.buttons & 2) === 0) { pan = null; return; }
    var dx = e.clientX - pan.x0, dy = e.clientY - pan.y0;
    if (!pan.moved) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DW_PAN_SLOP) return;
      pan.moved = true;
      try { body.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
    }
    body.scrollLeft = pan.sl0 - dx;
    body.scrollTop = pan.st0 - dy;
  });
  function end(e) {
    if (!pan || (e && e.pointerId !== pan.id)) return;
    lastMoved = pan.moved;
    if (pan.ctx && !pan.moved) markupCancelDraft();
    try { body.releasePointerCapture(pan.id); } catch (err) { /* уже отпущен */ }
    pan = null;
  }
  body.addEventListener('pointerup', end);
  body.addEventListener('pointercancel', end);
  body.addEventListener('contextmenu', function (e) {
    if (!markupModeOn()) return;
    e.preventDefault();
    if (pan) { pan.ctx = true; return; }
    if (!lastMoved) markupCancelDraft();
    lastMoved = false;
  });
}

function initDrawingsZoom() {
  dwWasMobile = isMobileLayout();

  // Область чертежей (#tab-drawings) живёт всегда — меняется только её
  // содержимое, поэтому слушатели вешаем на неё один раз.
  var pane = dwPane();
  if (!pane) return;
  pane.addEventListener('pointerdown', onDwPointerDown);
  pane.addEventListener('pointermove', onDwPointerMove);
  pane.addEventListener('pointerup', onDwPointerUp);
  pane.addEventListener('pointercancel', onDwPointerCancel);
  pane.addEventListener('lostpointercapture', onDwPointerCancel);
  pane.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') dwMouse = null; });
  pane.addEventListener('dblclick', onDwDblClick);
  pane.addEventListener('contextmenu', onDwContextMenu);
  // passive: false — иначе preventDefault() у Ctrl+колеса не сработает и
  // браузер приблизит всю страницу
  pane.addEventListener('wheel', onDwWheel, { passive: false });
  pane.addEventListener('touchmove', onDwTouchMove, { passive: false });
  pane.addEventListener('gesturestart', onDwGesture);
  pane.addEventListener('gesturechange', onDwGesture);
  // Поворот экрана и смена размера окна (в том числе переход через 820px) —
  // ResizeObserver листа подхватывает это же, но не везде он есть.
  window.addEventListener('resize', scheduleDwSync);
}

/* ---------------------------------------------------------------------------
   8. Горячие клавиши
--------------------------------------------------------------------------- */
function initHotkeys() {
  document.addEventListener('keydown', function (e) {
    // «+» и «−» — масштаб чертежей (7в), но только пока «Документы» открыты на
    // вкладке «Чертежи» и фокус не в поле ввода (это проверяет сама
    // dwHotkeysActive). Во всех остальных случаях клавиши идут дальше как
    // раньше (у них нет другого назначения).
    var zoomDir = dwZoomKeyDir(e);
    if (zoomDir && dwHotkeysActive(e.target)) {
      e.preventDefault();
      stepDwZoom(zoomDir, dwKeyAnchor());
      return;
    }
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
   Калькулятор в числовых полях. Любое <input type="number"> принимает
   выражение (1200/3, 2400-18*2, (600+50)/2): пока поле в фокусе, оно
   становится текстовым (в number браузер не даёт ввести * / ( )), по Enter
   или при уходе из поля выражение заменяется результатом, а поле снова
   number — остальной код видит обычное число и ничего о калькуляторе не
   знает. Поля создаются динамически, поэтому всё делегируется на document.
--------------------------------------------------------------------------- */
// Разбор + − × ÷ ( ) и унарного минуса без eval. Возвращает число или null.
function calcEval(src) {
  var s = String(src).replace(/\s+/g, '').replace(/,/g, '.')
    .replace(/[×хx*]/g, '*').replace(/[÷:\/]/g, '/').replace(/[−–—]/g, '-');
  if (!s || /[^0-9.+\-*\/()]/.test(s)) return null;
  var i = 0;
  function num() {
    var m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (!m) return NaN;
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function atom() {
    if (s[i] === '-') { i++; return -atom(); }
    if (s[i] === '+') { i++; return atom(); }
    if (s[i] === '(') {
      i++;
      var v = expr();
      if (s[i] !== ')') return NaN;
      i++;
      return v;
    }
    return num();
  }
  function term() {
    var v = atom();
    while (s[i] === '*' || s[i] === '/') {
      var op = s[i++];
      var r = atom();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function expr() {
    var v = term();
    while (s[i] === '+' || s[i] === '-') {
      var op = s[i++];
      var r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  var res = expr();
  if (i !== s.length || !isFinite(res)) return null;
  return res;
}

function initCalcFields() {
  var PLAIN = /^-?(\d+[.,]?\d*|[.,]\d+)$/;
  function isCalcTarget(el) {
    return !!(el && el.matches && el.matches('input[type="number"], input[data-calc]'));
  }
  function isActive(el) { return !!(el && el.matches && el.matches('input[data-calc]')); }
  // Знаков после запятой в результате выражения — по step поля
  // (any → 2, дробный шаг → столько же знаков, иначе целые).
  function decimalsOf(el) {
    var st = el.getAttribute('step');
    if (st === 'any') return 2;
    var m = /\.(\d+)/.exec(st || '');
    return m ? m[1].length : 0;
  }
  function flashError(el) {
    el.classList.add('calc-error');
    setTimeout(function () { el.classList.remove('calc-error'); }, 1200);
  }
  // Приводит текст поля к числу. Возвращает false, если выражение неверное
  // (значение откатывается к тому, что было при входе в поле).
  function commitExpr(el) {
    var t = el.value.trim();
    if (t === '' || PLAIN.test(t)) {
      if (t.indexOf(',') >= 0) el.value = t.replace(',', '.');
      return true;
    }
    var v = calcEval(t);
    if (v === null) {
      el.value = el.dataset.calcOrig || '';
      flashError(el);
      return false;
    }
    var k = Math.pow(10, decimalsOf(el));
    el.value = String(Math.round(v * k) / k);
    return true;
  }
  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (!isCalcTarget(el) || isActive(el) || el.readOnly || el.disabled) return;
    el.dataset.calcOrig = el.value;
    el.setAttribute('data-calc', '1');
    el.type = 'text';
    el.setAttribute('inputmode', 'decimal');
    el.setAttribute('autocomplete', 'off');
    try { el.select(); } catch (err) { /* ignore */ }
  }, true);
  // Пока введено незаконченное выражение, остальному коду input не показываем:
  // иначе пересчёт модуля запускался бы на каждом символе «1200/».
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!isActive(el)) return;
    var t = el.value.trim();
    if (t === '' || PLAIN.test(t)) {
      if (t.indexOf(',') >= 0) {
        var pos = el.selectionStart;
        el.value = t.replace(',', '.');
        try { el.setSelectionRange(pos, pos); } catch (err) { /* ignore */ }
      }
      return;
    }
    e.stopImmediatePropagation();
  }, true);
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!isActive(el)) return;
    if (!commitExpr(el)) { e.stopImmediatePropagation(); return; }
    el.dataset.calcOrig = el.value;
  }, true);
  document.addEventListener('keydown', function (e) {
    var el = e.target;
    if (e.key !== 'Enter' || !isActive(el)) return;
    var t = el.value.trim();
    if (t === '' || PLAIN.test(t)) return;
    // Результат считаем до того, как Enter увидит сам редактор поля
    // (ячейки Библиотеки сохраняют значение прямо по Enter).
    if (commitExpr(el)) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      try { el.select(); } catch (err) { /* ignore */ }
    }
  }, true);
  // blur не всплывает, но в фазе захвата доходит до document — раньше
  // обработчиков самого поля (редактор ячейки Библиотеки сохраняет по blur).
  document.addEventListener('blur', function (e) {
    var el = e.target;
    if (!isActive(el)) return;
    commitExpr(el);
    el.removeAttribute('data-calc');
    el.removeAttribute('inputmode');
    el.type = 'number';
    delete el.dataset.calcOrig;
  }, true);
}

/* ---------------------------------------------------------------------------
   Старт (вызывается из index.html после app.js)
--------------------------------------------------------------------------- */
function start() {
  initTheme();
  initCalcFields();
  initTouchScheme();
  initCurrency();
  initMarkupFont();
  initDrawers();
  initRail();
  initViewToolbarPosition();
  watchResults();
  initFocusMode();
  initHud();
  initSearch();
  initSheet();
  initSheetResize();   // до restoreUI: первой открытой панели нужна высота листа
  initDrawingsZoom();
  initEditorRmbPan();
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
  // Сколько px снизу сцены сейчас закрыто нижним листом: на телефоне — листом
  // любой панели, на компьютере — панелью «Документы» (0 — панели нет или
  // открыта левая панель). То же значение, что в событии
  // 'modul3d:drawer-inset' (разделы 7б и 7б′).
  getDrawerInset: sheetInsetBottom,
  getDrawerInsets: sheetInsetSides,
  // Высота панели «Документы» на компьютере, px (7б′)
  getDocsHeight: function () { return docsPx; },
  // Масштаб чертежей (7в): проценты (100 — как отрисовано; на телефоне в режиме
  // «авто» — «по ширине», см. 7в). setDrawingsZoom — «руками»: выключает авто.
  // resetDrawingsZoom — стандартный вид (компьютер 100%, телефон «по ширине»).
  // setDrawingsContent — запись чертежей в #tab-drawings в обёртке масштаба
  // (зовёт app.js).
  getDrawingsZoom: function () { return Math.round(dwScale * 100); },
  setDrawingsZoom: function (pct) { setDwScale(pct / 100); },
  resetDrawingsZoom: resetDwZoom,
  setDrawingsContent: setDrawingsContent,
  getRailPos: function () { return railPos; },
  // Панель режимов 3D: выбор пользователя и где она стоит на самом деле
  setViewToolbarPos: setVtPos,
  getViewToolbarPos: function () { return vtPos; },
  getViewToolbarPlacement: function () { return document.documentElement.getAttribute('data-vt-pos'); }
};
})();
