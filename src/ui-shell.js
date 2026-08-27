/* =========================================================================
   Modul3D — UI Shell
   Слой интерфейса: темы, выдвижные панели, Focus Mode, HUD на модели,
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

var viewerInstance = null;
var lastPointer = { x: 0, y: 0 };
var openPanel = null;
var hudModule = null;
var syncingDocs = false;

/* ---------------------------------------------------------------------------
   0. Валюта проекта — единое глобальное состояние (window.Modul3D.currency).
   По умолчанию ₽ RUB — прежнее поведение, чтобы у существующих пользователей
   ничего не изменилось при первом открытии после обновления. Читается из
   app.js (спецификация, таблицы «Библиотеки») через getSymbol().
--------------------------------------------------------------------------- */
var CURRENCY_PRESETS = [
  { code: 'RUB', symbol: '₽', label: '₽ Российский рубль' },
  { code: 'USD', symbol: '$', label: '$ Доллар США' },
  { code: 'EUR', symbol: '€', label: '€ Евро' },
  { code: 'MDL', symbol: 'лей', label: 'лей Молдавский лей' }
];
var currencyState = { code: 'RUB', symbol: '₽', custom: false };

function loadCurrency() {
  try {
    var saved = JSON.parse(localStorage.getItem(CURRENCY_KEY) || 'null');
    if (saved && saved.symbol) currencyState = saved;
  } catch (e) { /* приватный режим / битые данные — остаёмся на ₽ RUB */ }
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
}

function initCurrency() {
  var toggle = document.getElementById('currencyToggle');
  var pop = document.getElementById('currencyPopover');
  var options = document.getElementById('currencyOptions');
  var customInput = document.getElementById('currencyCustomInput');
  if (!toggle || !pop) return;
  renderCurrencyOptions();

  toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    pop.style.display = pop.style.display === 'none' ? 'block' : 'none';
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
  box.innerHTML =
    '<div class="hud-title"><span>' + escapeHtml(hudModule) + '</span>' +
    '<button type="button" class="hud-close" data-hud-close aria-label="Закрыть">✕</button></div>' +
    '<div class="hud-dims">' +
      hudDim('В', 'm-height') + hudDim('Ш', 'm-width') + hudDim('Г', 'm-depth') +
    '</div>' +
    '<div class="hud-meta">Материал: ' + escapeHtml(selectedText('p-decor')) + '</div>' +
    '<div class="hud-actions">' +
      '<button type="button" class="btn" data-hud-open="params">Параметры</button>' +
      '<button type="button" class="btn" data-hud-open="docs">Документы</button>' +
    '</div>';
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
  box.style.left = x + 'px';
  box.style.top = y + 'px';
}

function hideHud() {
  var box = hudEl();
  if (!box) return;
  hudModule = null;
  box.classList.remove('open');
  box.setAttribute('aria-hidden', 'true');
}

function initHud() {
  var box = hudEl();
  if (!box) return;

  box.addEventListener('click', function (e) {
    if (e.target.closest('[data-hud-close]')) { hideHud(); return; }
    var open = e.target.closest('[data-hud-open]');
    if (open) {
      var target = open.getAttribute('data-hud-open');
      openDrawer(target);
      // «Параметры» из HUD должны вести на экран параметров МОДУЛЯ (тот,
      // что сейчас под курсором), а не оставлять прежний экран панели.
      if (target === 'params' && window.Modul3D.app && window.Modul3D.app.setPanelView) {
        window.Modul3D.app.setPanelView('module');
      }
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
      var b = document.querySelector('.view-btn[data-view="' + views[e.code] + '"]');
      if (b) { e.preventDefault(); b.click(); }
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
  closeDrawer: closeDrawer
};
})();
