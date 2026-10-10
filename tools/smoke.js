// tools/smoke.js
// ============================================================================
// Headless-прогон приложения БЕЗ браузера.
//
// Зачем: `node --check` проверяет только синтаксис и НЕ ловит обращения к
// несуществующим функциям (например, «sideOptions is not defined») — такая
// ошибка вылезает лишь в момент выполнения, уже у пользователя.
//
// Здесь поднимается минимальный DOM-стенд, на нём реально исполняются скрипты
// из index.html, а затем дёргаются обработчики панели: габариты, конструктив
// боковин, основание, секции, ящики, фасады, виды и вкладки.
//
// Запуск:  node tools/smoke.js
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const errors = [];
const registry = new Map();

class El {
  constructor(id, tag = 'div', attrs = {}) {
    this.id = id || '';
    this.tagName = tag.toUpperCase();
    this.attrs = attrs;
    this.dataset = {};
    for (const k of Object.keys(attrs)) {
      // Настоящий DOM переводит «data-drawers-open» в dataset.drawersOpen
      // (camelCase) — без этого Number(e.target.dataset.drawersOpen) даёт
      // NaN на любом составном имени (поймано на клике «Редактировать
      // ящики →», который из-за этого откатывал экран назад).
      if (k.indexOf('data-') === 0) {
        const camel = k.slice(5).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
        this.dataset[camel] = attrs[k];
      }
    }
    this.style = {};
    this.value = attrs.value !== undefined ? attrs.value : '';
    this.checked = attrs.checked !== undefined;
    this.textContent = '';
    this.files = [];
    this.children = [];
    this.className = attrs.class || '';
    const set = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    this.classList = {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      toggle: (c, on) => { if (on === undefined) { set.has(c) ? set.delete(c) : set.add(c); } else if (on) set.add(c); else set.delete(c); },
      contains: (c) => set.has(c),
    };
    this._html = '';
    this._els = null;
    this._listeners = new Map();
  }
  set innerHTML(v) { this._html = String(v); this._els = null; harvest(this._html); }
  get innerHTML() { return this._html; }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener() {}
  dispatch(type, ev) {
    // Снимок СПИСКА, а не живая ссылка на массив: id, отсутствующий в новой
    // разметке после innerHTML, в registry не забывается (см. harvest ниже)
    // — обработчик вроде «Материалы модуля» вешается на тот же устаревший
    // объект заново при каждом renderParamsPanel(). Без снимка push() внутри
    // ещё выполняющегося listener'а дописывает элемент в ТОТ ЖЕ массив, что
    // уже перебирает этот for-of, и цикл никогда не заканчивается — ровно
    // так поймали реальное зависание на клике по «Материалы модуля».
    // Настоящий DOM ведёт себя так же: слушатели, добавленные во время
    // диспетчеризации, в неё уже не попадают.
    const list = (this._listeners.get(type) || []).slice();
    // currentTarget — элемент, на который повешен слушатель (всегда this для
    // прямого addEventListener, в отличие от делегирования); часть кода
    // (например, обработчик «Редактировать →») читает именно его, а не
    // target, — см. e.currentTarget.dataset в app.js/bindPanelEvents.
    for (const fn of list) {
      fn(Object.assign({ target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} }, ev || {}));
    }
    return list.length;
  }
  click() { return this.dispatch('click'); }
  // Запоминаем родителя: без него el.remove() ниже убирал элемент только из
  // registry, а в children родителя он оставался навсегда — проверить, что
  // приложение убрало за собой временный элемент (например, «призрак»
  // перетаскивания), было нечем.
  appendChild(c) { this.children.push(c); if (c) c._parent = this; if (c && c.id) registry.set(c.id, c); return c; }
  // insertBefore нужен переносу панели режимов 3D в шапку (ui-shell.js: placeVtDom).
  insertBefore(c, ref) {
    if (c && c._parent) c._parent.children = c._parent.children.filter((x) => x !== c);
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i >= 0) this.children.splice(i, 0, c); else this.children.push(c);
    if (c) c._parent = this;
    if (c && c.id) registry.set(c.id, c);
    return c;
  }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); if (c) c._parent = null; }
  contains() { return false; }
  getContext() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 600, right: 900, bottom: 600 }; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    // Вложенный контейнер (напр. #drawersPanelRoot внутри #paramsPanel)
    // получает разметку не своим innerHTML, а innerHTML РОДИТЕЛЯ — здесь у
    // него самого _html остаётся пустой. Настоящий DOM в этом случае всё
    // равно находит вложенные элементы (это единое дерево); наш плоский
    // regex-разбор — нет, поэтому без отката обработчики вроде change на
    // высотах ящиков молча не вешались бы ни на что (поймано на сценарии
    // ящиков — правка поля не двигала соседей). Откатываемся на глобальный
    // поиск, как уже делает document.querySelectorAll ниже.
    if (!this._html) return document.querySelectorAll(sel);
    // Разбираем один раз на перерисовку: приложение вешает обработчики на
    // полученные отсюда объекты, и прогон должен дёргать ИМЕННО их — причём
    // по любому селектору, каким бы элемент ни искали.
    if (!this._els) this._els = parseElements(this._html);
    return queryAll(this._els, sel);
  }
  // Делегированные обработчики приложения почти всегда начинаются с
  // e.target.closest('...') (см. app.js: initLibraryPanel, bindLibraryEvents).
  // Плоский regex-разбор HTML связей «родитель–потомок» не хранит, поэтому
  // closest здесь умеет ровно одно: ответить, подходит ли САМ элемент под
  // селектор (нулевой шаг подъёма настоящего closest). Прогону этого хватает,
  // если диспетчеризовать событие с target = именно тот элемент, по которому
  // «кликнули»: el.dispatch('click', { target: btn }) — см. проверки панели
  // «Библиотека» ниже. Подъём к предку вернёт null, а не найдёт его.
  closest(sel) { return matchesSel(this, sel) ? this : null; }
  focus() {} blur() {} scrollIntoView() {}
  remove() {
    if (this._parent) this._parent.children = this._parent.children.filter((x) => x !== this);
    this._parent = null;
    if (this.id) registry.delete(this.id);
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
  removeAttribute(k) { delete this.attrs[k]; }
  insertAdjacentHTML(_pos, html) { this._html += html; harvest(html); }
}

// Разбирает выданный приложением HTML и регистрирует элементы по id, чтобы
// getElementById после innerHTML находил их, как в настоящем браузере.
const TAG_SRC = '<(\\w+)([^>]*)>';
function parseAttrs(str) {
  const out = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)(?=[\s>]|$)/g;
  let m;
  while ((m = re.exec(str))) {
    if (m[1]) out[m[1]] = m[2];
    else if (m[3]) out[m[3]] = '';
  }
  return out;
}
function harvest(html) {
  const re = new RegExp(TAG_SRC, 'g');
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1];
    const attrs = parseAttrs(m[2]);
    if (!attrs.id) continue;
    const el = new El(attrs.id, tag, attrs);
    if (tag === 'select') {
      const seg = html.slice(m.index);
      const end = seg.indexOf('</select>');
      const opts = seg.slice(0, end < 0 ? seg.length : end);
      const sel = /<option value="([^"]*)"[^>]*selected/.exec(opts);
      const first = /<option value="([^"]*)"/.exec(opts);
      el.value = sel ? sel[1] : (first ? first[1] : '');
      el._options = (opts.match(/<option value="([^"]*)"/g) || []).map((x) => /value="([^"]*)"/.exec(x)[1]);
    }
    registry.set(attrs.id, el);
  }
}
// Разбор html в СТАБИЛЬНЫЙ список элементов. Важно: один и тот же элемент
// обязан возвращаться одним и тем же объектом для любого селектора — иначе
// обработчик, повешенный приложением через один селектор, не найдётся при
// обращении через другой (в приложении вкладки ищутся как [data-mod],
// а в прогоне как .mod-tab).
function parseElements(html) {
  const list = [];
  const re = new RegExp(TAG_SRC, 'g');
  let m;
  while ((m = re.exec(html))) {
    const attrs = parseAttrs(m[2]);
    const el = attrs.id ? (registry.get(attrs.id) || new El(attrs.id, m[1], attrs))
                        : new El('', m[1], attrs);
    list.push({ tag: m[1], attrs, el });
  }
  return list;
}
// [attr] / [attr="value"] — сравнивать нужно ИМЯ и ЗНАЧЕНИЕ атрибута, а не
// искать имя атрибута подстрокой внутри текста селектора: старая проверка
// `sel.indexOf(k) !== -1` считала совпадением любой элемент с атрибутом,
// чья буква встречается где-то в селекторе (напр. атрибут SVG-пути `d`
// матчился селектором «[data-field="shelves"]», ведь буква «d» в нём есть) —
// поймано на «отмена возвращает число полок»: селектор находил 34 левых
// элемента вместо нужного поля.
const ATTR_SEL = /^\[([\w-]+)(?:="([^"]*)")?\]$/;
function queryAll(list, sel) {
  const attrMatch = sel.startsWith('[') ? ATTR_SEL.exec(sel) : null;
  return list.filter((x) => {
    const cls = (x.attrs.class || '').split(/\s+/);
    if (sel.startsWith('.')) return cls.indexOf(sel.slice(1)) !== -1;
    if (sel.startsWith('#')) return x.attrs.id === sel.slice(1);
    if (attrMatch) {
      const [, name, val] = attrMatch;
      if (!(name in x.attrs)) return false;
      return val === undefined ? true : x.attrs[name] === val;
    }
    return x.tag.toLowerCase() === sel.toLowerCase();
  }).map((x) => x.el);
}
// Подходит ли ОДИН элемент под простой селектор — та же грамматика, что и у
// queryAll выше (.класс / #id / [атрибут] / [атрибут="значение"] / тег),
// только для готового El, а не для разобранной записи {tag, attrs}. Нужна
// El.closest (см. выше).
function matchesSel(el, sel) {
  if (!el) return false;
  const attrs = el.attrs || {};
  const cls = String(attrs.class || el.className || '').split(/\s+/);
  if (sel.startsWith('.')) return cls.indexOf(sel.slice(1)) !== -1;
  if (sel.startsWith('#')) return (attrs.id || el.id) === sel.slice(1);
  if (sel.startsWith('[')) {
    const m = ATTR_SEL.exec(sel);
    if (!m || !(m[1] in attrs)) return false;
    return m[2] === undefined ? true : attrs[m[1]] === m[2];
  }
  return String(el.tagName || '').toLowerCase() === sel.toLowerCase();
}
function $(id) {
  if (!registry.has(id)) registry.set(id, new El(id));
  return registry.get(id);
}

// Вкладки документов (чертежи/деталировка/спецификация) приложение строит
// ЛЕНИВО — только когда полоса документов раскрыта на этой вкладке (см.
// app.js: docsTabsDirty/ensureTabBuilt). Прогон же читает их разметку, не
// открывая панель, поэтому берёт вкладку через этот помощник: он сначала
// просит приложение собрать её принудительно. Прямой $('tab-...') здесь
// вернул бы разметку прошлого пересчёта или вовсе пустую.
function docsTab(name) {
  const api = typeof sandbox !== 'undefined' && sandbox.Modul3D && sandbox.Modul3D.app;
  if (api && api.ensureTabBuilt) api.ensureTabBuilt(name);
  return $('tab-' + name);
}

// «База модулей» (2026-09-21) — категории (группы PRESETS/свои) стали
// строками дерева, как у «Материалов»/«Фурнитуры» (см. app.js libraryBlock/
// libTreeRowHtml), вместо кнопок-пилюль .lib-cat. Строка кликается через
// ДЕЛЕГИРОВАННЫЙ обработчик на #libraryPanel (app.js initLibraryPanel) —
// row.click() сработал бы только для слушателей, повешенных НА САМУ строку
// (таких нет), поэтому открываем/закрываем её так же, как остальные
// проверки дерева «Библиотеки» ниже: lib.dispatch('click', { target: row })
// (см. комментарий у El.closest в начале файла). Карточки модулей
// (.lib-item[data-preset]) по-прежнему кликаются напрямую (item.click()) —
// у них остался свой addEventListener (см. app.js bindLibraryEvents).
// ВАЖНО: в отличие от прежних пилюль (только ОДНА категория когда-либо была
// в разметке — see state.libraryOpenCat), грид карточек КАЖДОЙ группы теперь
// всегда есть в HTML (закрытость — только CSS-класс .lib-collapsed на
// обёртке, харнесс его не учитывает), поэтому modGridItems() ищет по ВСЕЙ
// панели сразу — карточки одной группы нужно отбирать по data-group
// (id родной группы пресета, не меняется от переносов/копий, см.
// app.js libModCardHtml).
function libPanelEl() { return document.getElementById('libraryPanel'); }
function modGroupRows() {
  return libPanelEl().querySelectorAll('[data-tree-node]')
    .filter((r) => r.dataset.kind === 'top' && String(r.dataset.top || '').indexOf('mod:') === 0);
}
function modGroupRow(groupId) {
  return modGroupRows().filter((r) => r.dataset.top === 'mod:' + groupId)[0];
}
function toggleModGroup(row) {
  if (row) libPanelEl().dispatch('click', { target: row });
}
// Лист категории базы модулей показывает свой грид карточек ТОЛЬКО раскрытым
// кликом (state.libCollapsed, по умолчанию свёрнут — см. libNodeHtml в
// app.js), поэтому перед поиском карточек группы раскрываем её листья. Клик
// — переключатель, потому запоминаем уже раскрытые (идемпотентно).
const modOpenedLeaves = {};
function openModLeaves(groupId) {
  const leaves = libPanelEl().querySelectorAll('[data-tree-node]')
    .filter((r) => r.dataset.kind === 'leaf' && r.dataset.top === 'mod:' + groupId)
    .map((r) => r.dataset.path);
  leaves.forEach((p) => {
    const key = groupId + '/' + p;
    if (modOpenedLeaves[key]) return;
    const row = libPanelEl().querySelectorAll('[data-tree-node]')
      .filter((r) => r.dataset.kind === 'leaf' && r.dataset.top === 'mod:' + groupId && r.dataset.path === p)[0];
    if (row) { libPanelEl().dispatch('click', { target: row }); modOpenedLeaves[key] = true; }
  });
}
function modGridItems(groupId) {
  if (groupId != null) openModLeaves(groupId);
  const all = libPanelEl().querySelectorAll('[data-preset]');
  return groupId == null ? all : all.filter((el) => el.dataset.group === groupId);
}
// Раскрыта ли категория верхнего уровня — читаем класс .lib-collapsed на
// <div class="lib-tree-children"> сразу под её строкой (см. libTopCategoryHtml
// в app.js), тем же приёмом, что и остальные regex-проверки разметки в этом
// файле (см. SEL_RE/parseSel ниже): харнесс не даёт настоящего scoped
// querySelectorAll на вложенный без-id узел.
function modGroupOpen(groupId) {
  const html = String(libPanelEl().innerHTML || '');
  const re = new RegExp('data-top="mod:' + groupId + '"[\\s\\S]*?<div class="lib-tree-children([^"]*)"');
  const m = re.exec(html);
  return !!m && m[1].indexOf('lib-collapsed') < 0;
}

const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
harvest(INDEX);
const INDEX_ELS = parseElements(INDEX);

const document = {
  title: '',
  body: new El('body', 'body'),
  // style.setProperty нужен ui-shell (переменные --drawer-sheet-h/--mobile-drawer-h
  // высоты нижнего листа на телефоне, v314, и --docs-h высоты панели «Документы»
  // на компьютере, v315)
  documentElement: (() => {
    const html = new El('html', 'html');
    html.style.setProperty = function (k, v) { this[k] = v; };
    return html;
  })(),
  getElementById: (id) => registry.get(id) || null,
  // Ищем не только по каркасу страницы, но и по всему, что приложение
  // отрисовало в контейнеры, — иначе элементы панели «не видны» прогону.
  querySelector: (sel) => document.querySelectorAll(sel)[0] || null,   // eslint-disable-line
  querySelectorAll: (sel) => {
    const seen = new Set();
    const out = [];
    const add = (list) => list.forEach((el) => {
      const key = el.id || (el.tagName + JSON.stringify(el.attrs));
      if (seen.has(key)) return;
      seen.add(key);
      out.push(el);
    });
    add(queryAll(INDEX_ELS, sel));
    for (const el of Array.from(registry.values())) if (el._html) add(el.querySelectorAll(sel));
    return out;
  },
  createElement: (tag) => new El('', tag),
  _register: (el) => { if (el.id) registry.set(el.id, el); },
  // Глобальные обработчики (Esc, Ctrl+Z, клик мимо меню) надо уметь дёргать:
  // без этого горячие клавиши в прогоне не проверить.
  _docListeners: new Map(),
  addEventListener: (type, fn) => {
    const m = document._docListeners;                                   // eslint-disable-line
    if (!m.has(type)) m.set(type, []);
    m.get(type).push(fn);
  },
  removeEventListener: () => {},
  dispatch: (type, ev) => {
    const list = document._docListeners.get(type) || [];                // eslint-disable-line
    for (const fn of list) {
      fn(Object.assign({ target: document.body, preventDefault() {}, stopPropagation() {} }, ev || {}));  // eslint-disable-line
    }
    return list.length;
  },
};

const sandbox = {
  document,
  console: { log: () => {}, warn: () => {}, error: (...a) => errors.push(a.map(String).join(' ')) },
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  devicePixelRatio: 1, innerWidth: 1600, innerHeight: 900,
  addEventListener: () => {}, removeEventListener: () => {},
  alert: () => {}, prompt: () => null, confirm: () => true,
  fetch: () => Promise.reject(new Error('нет сети в прогоне')),
  FileReader: class { readAsDataURL() {} },
  Blob: class {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  XLSX: { utils: { book_new: () => ({}), aoa_to_sheet: () => ({}), book_append_sheet: () => {} }, writeFile: () => {} },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// Порядок подключения берём ИЗ index.html — тогда прогон не разъедется с
// реальной страницей, если в неё добавят новый скрипт.
// К адресам скриптов приписан ?vNN (сброс кеша браузера) — при разборе его
// отбрасываем, читаем файлы с диска.
const SRC_ORDER = (fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .match(/src="src\/([\w.-]+\.js)(?:\?[\w.-]+)?"/g) || [])
  .map((x) => /src\/([\w.-]+\.js)/.exec(x)[1])
  .filter((f) => f !== 'viewer.js' && f !== 'app.js');
// viewer.js требует WebGL — подменяем заглушкой: приложение создаёт его в
// try/catch и обязано работать даже без 3D. Заглушку ставим на МЕСТО
// viewer.js (до ui-shell.js), как в index.html: ui-shell.js при загрузке
// оборачивает Viewer3D (hookViewer), чтобы подцепить HUD к клику по модулю —
// без этого HUD в прогоне вообще не участвовал.
const UI_SHELL_AT = SRC_ORDER.indexOf('ui-shell.js');
for (const f of SRC_ORDER.slice(0, UI_SHELL_AT < 0 ? SRC_ORDER.length : UI_SHELL_AT)) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'), sandbox, { filename: f });
}
sandbox.Modul3D.viewer = {
  Viewer3D: class {
    // viewName/onViewChange — как у настоящего Viewer3D (гизма видов):
    // экземпляр запоминаем, чтобы проверить переключение видов ниже.
    constructor() {
      this.onSelectModule = null; this.onViewChange = null; this.viewName = 'iso'; sandbox.__viewer = this;
      // Холст с событиями: ui-shell.js слушает pointerup, чтобы отличить правый клик (HUD) от левого.
      const ls = [];
      this.renderer = { domElement: { addEventListener: (t, fn) => { if (t === 'pointerup') ls.push(fn); } } };
      this.__click = (button) => ls.forEach((fn) => fn({ button }));
    }
    // Последняя отрисованная модель — сценарии проверяют по ней детали.
    render(model) { if (model) sandbox.__lastModel = model; } setView(name) { this.viewName = name; } dispose() {}
    project() { return { x: 0, y: 0 }; }
    canvasSize() { return { w: 900, h: 600 }; }
  },
};
for (const f of UI_SHELL_AT < 0 ? [] : SRC_ORDER.slice(UI_SHELL_AT)) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'), sandbox, { filename: f });
}
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });

// ---------------------------------------------------------------------------
const fails = [];
function closeAllMenus() {
  const m = document.getElementById('moduleMenu');
  if (m && m.remove) m.remove();
}
// Строгое сравнение с `false` маскировало реальные провалы: проверка вида
// `el && Number(el.attrs.value) === 18` при отсутствующем el вернёт `null`,
// а не `false`, и молча считалась пройденной — так пропала часть проверок
// после переезда полей в отдельные экраны панели. Любой «ложный» результат
// (null/undefined/0/'') теперь тоже провал, как и должно быть у assert.
const check = (name, fn) => {
  try { if (!fn()) fails.push(name); } catch (e) { fails.push(name + ': ' + e.message); }
};

const panel = $('paramsPanel');
if (/Ошибка запуска/.test(panel.innerHTML)) {
  fails.push('ПРИЛОЖЕНИЕ НЕ ЗАПУСТИЛОСЬ: ' + panel.innerHTML.replace(/<[^>]*>/g, '').trim());
}

check('заголовок с версией', () => /^Modul3D v\d+/.test(document.title));

// --- старт: проект пуст, первый модуль выбирает пользователь ---------------
check('стартует без модулей', () => document.querySelectorAll('.mod-tab').length === 0);
// «База модулей» теперь в отдельной панели «Библиотека» (#libraryPanel),
// не в #paramsPanel — см. app.js libraryBlock/renderLibraryPanel.
// Заголовка <h3>База модулей</h3> под вкладками больше нет (2026-09-26, v314) —
// о том, что вкладка отрисована, говорит кнопка «Сохранить в базу».
check('на старте видна база модулей', () => /data-lib-save-project/.test($('libraryPanel').innerHTML));
check('на старте есть подсказка о пустом проекте', () => /Проект пуст/.test(panel.innerHTML));
check('на чертежах написано, что проект пуст', () => /Проект пуст/.test(docsTab('drawings').innerHTML));
check('пустой проект не даёт ошибок', () => panel.innerHTML.indexOf('Ошибка') === -1);
check('первый модуль добавляется кнопкой «+»', () => {
  const b = document.getElementById('addModule');
  if (!b) return false;
  b.click();
  return document.querySelectorAll('.mod-tab').length === 1;
});

check('панель отрисована', () => panel.innerHTML.length > 500);
check('деталировка не пуста', () => docsTab('detailing').innerHTML.indexOf('<table') !== -1);
check('в деталировке напечатано название материала', () =>
  /ЛДСП|ХДФ/.test(docsTab('detailing').innerHTML));
check('в чертежах напечатан материал деталей', () =>
  /<th>Материал<\/th>/.test(docsTab('drawings').innerHTML));
check('спецификация не пуста', () => docsTab('spec').innerHTML.indexOf('<table') !== -1);
check('чертежи не пусты', () => docsTab('drawings').innerHTML.length > 200);

// Материалы (декор/толщины/соединение корпуса) — отдельный экран панели
// (state.panelView:'materials', см. materialsBlock), открывается кнопкой
// #materialsLinkBtn на экране модуля, назад — кнопкой #panelBack.
check('кнопка «Материалы модуля» открывает экран материалов', () => {
  const b = document.getElementById('materialsLinkBtn');
  if (!b) return false;
  b.click();
  return !!document.getElementById('p-decor');
});
// Поле «Толщина ЛДСП» убрано (2026-09-28, v323) — толщина корпуса больше не
// отдельный ввод, а берётся из самого выбранного материала (см. app.js:
// libPickMaterial, ветка role==='decor'). Проверяем тот же факт (декор по
// умолчанию — 18 мм) через сам каталог, а не через удалённый #p-bodyThickness.
check('корпус по умолчанию 18 мм (толщина декора по умолчанию)', () => {
  const cat = sandbox.Modul3D.catalog;
  const def = (cat.DECORS || []).filter((x) => x.code === cat.DEFAULT_DECOR_CODE)[0];
  return !!def && Number(def.thickness) === 18;
});
// Материал нового проекта по умолчанию (2026-09-26) — H1145 ST10
// (catalog.DEFAULT_DECOR_CODE): корпус, видимая боковина и материал фасада.
check('материалы по умолчанию: корпус/боковина/фасад — H1145 ST10', () => {
  const cat = sandbox.Modul3D.catalog;
  const def = cat.DEFAULT_DECOR_CODE;
  const d = cat.DECORS.filter((x) => x.code === def)[0];
  const codeOf = (id) => { const el = document.getElementById(id); return el && el.dataset.code; };
  return !!d && /H1145 ST10/.test(d.name)
    && ['p-decor', 'p-facadeDecor', 'p-facadeMat'].every((id) => codeOf(id) === def);
});
// Материалы (2026-09-26): не выпадающие списки, а плашки с выбранным
// материалом (data-mat-pick) — клик открывает Библиотеку в режиме подбора
// сразу в нужной категории, «Выбрать» только у подходящих строк; ссылок
// «+ Добавить материал»/«Удалить материал» под полями больше нет.
{
  const panelHtml = () => String($('paramsPanel').innerHTML || '');
  const libHtml = () => String(libPanelEl().innerHTML || '');
  const pickBtns = () => libPanelEl().querySelectorAll('.lib-pick-btn');
  const pickBy = (code) => pickBtns().filter((x) => x.attrs['data-pick-code'] === code)[0];
  const choose = (pb) => { if (!pb) return false; libPanelEl().dispatch('click', { target: pb }); return true; };
  check('материалы: плашки корпус/боковина/задняя стенка/фасад, без списков и ссылок', () =>
    ['decor', 'facadeDecor', 'back', 'facade'].every((r) => panelHtml().indexOf(`data-mat-pick="${r}"`) !== -1)
    && !/<select id="p-(decor|facadeDecor|back)"/.test(panelHtml())
    && !/data-material-(add|del)/.test(panelHtml()) && /Видимая боковина/.test(panelHtml()));
  check('материалы: корпус — «Выбрать» в «Листовых материалах», без ХДФ', () => {
    const b = document.getElementById('p-decor');
    if (!b) return false;
    b.click();
    return pickBtns().length > 0 && !/data-pick-group="back"/.test(libHtml());
  });
  check('материалы: корпус — выбор пишется в проект, подбор снят', () => {
    const pb = pickBtns().filter((x) => x.attrs['data-pick-group'] === 'decors')[1] || pickBtns()[0];
    const code = pb && pb.attrs['data-pick-code'];
    return choose(pb) && new RegExp(`id="p-decor" data-mat-pick="decor" data-code="${code}"`).test(panelHtml())
      && !/lib-pick-btn/.test(libHtml());
  });
  check('материалы: задняя стенка — «Выбрать» только у ХДФ', () => {
    const b = document.getElementById('p-back');
    if (!b) return false;
    b.click();
    const btns = pickBtns();
    return btns.length > 0 && btns.every((x) => x.attrs['data-pick-group'] === 'back');
  });
  check('материалы: задняя стенка — выбор пишется в проект', () => {
    const pb = pickBtns()[0];
    const code = pb && pb.attrs['data-pick-code'];
    return choose(pb) && new RegExp(`id="p-back" data-mat-pick="back" data-code="${code}"`).test(panelHtml());
  });
  // «Видимая боковина» (2026-09-26): ЛДСП/ДСП или фасадная МДФ-панель —
  // «Выбрать» только у engine.visibleSideMaterialOptions(); код пишется
  // напрямую в state.facadeDecorCode, без копии в DECORS.
  check('материалы: видимая боковина — «Выбрать» только у ЛДСП и МДФ-панелей', () => {
    const b = document.getElementById('p-facadeDecor');
    if (!b) return false;
    b.click();
    const allowed = sandbox.Modul3D.engine.visibleSideMaterialOptions().map((o) => o.code);
    const btns = pickBtns();
    return btns.length > 0 && btns.every((x) => allowed.indexOf(x.attrs['data-pick-code']) !== -1);
  });
  check('материалы: видимая боковина — выбор МДФ-панели, без копии в каталог', () => {
    const cat = sandbox.Modul3D.catalog;
    const allowed = sandbox.Modul3D.engine.visibleSideMaterialOptions().map((o) => o.code);
    const mdf = cat.DECORS.filter((m) => /мдф/i.test((m.categoryPath || [])[0])
      && allowed.indexOf(m.code) !== -1)[0];
    if (!mdf) return false;
    // Подбор открыт на листе «ДСП» (фокус листа) — клик по строке раздела
    // возвращает дерево, в нём — лист МДФ-плит.
    const top = libPanelEl().querySelectorAll('[data-tree-node]').filter((r) => r.dataset.kind === 'top' && r.dataset.top === 'sheet')[0];
    if (top) libPanelEl().dispatch('click', { target: top });
    const leaf = libPanelEl().querySelectorAll('[data-tree-node]').filter((r) => r.dataset.kind === 'leaf'
      && r.dataset.top === 'sheet' && r.dataset.path === mdf.categoryPath.join('::'))[0];
    if (!leaf) return false;
    libPanelEl().dispatch('click', { target: leaf });
    const nDecors = cat.DECORS.length;
    return choose(pickBy(mdf.code))
      && new RegExp(`id="p-facadeDecor" data-mat-pick="facadeDecor" data-code="${mdf.code}"`).test(panelHtml())
      && cat.DECORS.length === nDecors && !/lib-pick-btn/.test(libHtml());
  });
  // «Материал фасада» проекта (2026-09-26) — умолчание ЛДСП-фасадов,
  // независимое от «Видимой боковины»: «Выбрать» только у ЛДСП
  // (engine.facadeMaterialOptions('ldsp')), код — в state.facadeMatCode.
  check('материалы: «Материал фасада» — «Выбрать» только у ЛДСП', () => {
    const b = document.getElementById('p-facadeMat');
    if (!b) return false;
    b.click();
    const allowed = sandbox.Modul3D.engine.facadeMaterialOptions('ldsp').map((o) => o.code);
    const btns = pickBtns();
    return btns.length > 0 && btns.every((x) => allowed.indexOf(x.attrs['data-pick-code']) !== -1);
  });
  check('материалы: «Материал фасада» — выбор пишется в поле, видимая боковина не меняется', () => {
    const vis = document.getElementById('p-facadeDecor');
    const visCode = vis && vis.dataset.code;
    const cur = document.getElementById('p-facadeMat').dataset.code;
    const pb = pickBtns().filter((x) => x.attrs['data-pick-code'] !== cur)[0];
    const code = pb && pb.attrs['data-pick-code'];
    return choose(pb) && new RegExp(`id="p-facadeMat" data-mat-pick="facadeMat" data-code="${code}"`).test(panelHtml())
      && document.getElementById('p-facadeDecor').dataset.code === visCode && !/lib-pick-btn/.test(libHtml());
  });
  // Поле «Фасад» активной секции: вид ЛДСП → «Выбрать» только у допустимых
  // материалов вида (engine.facadeMaterialOptions), выбор — в sec.facadeMaterial.
  check('материалы: фасад секции — «Выбрать» только у материалов вида', () => {
    const b = document.getElementById('paramsPanel').querySelectorAll('[data-mat-pick]').filter((x) => x.attrs['data-mat-pick'] === 'facade')[0];
    if (!b) return false;
    b.click();
    const allowed = sandbox.Modul3D.engine.facadeMaterialOptions('ldsp').map((o) => o.code);
    const btns = pickBtns();
    return btns.length > 0 && btns.every((x) => allowed.indexOf(x.attrs['data-pick-code']) !== -1);
  });
  // Код не зашит: берём первую доступную кнопку — пользователь удаляет листы из каталога.
  let chosenFacadeCode = null;
  check('материалы: фасад секции — выбранный материал в поле «Фасад»', () => {
    const pb = pickBtns()[0];
    const code = pb && pb.attrs['data-pick-code'];
    chosenFacadeCode = code;
    return choose(pb) && new RegExp(`data-mat-pick="facade" data-code="${code}"`).test(panelHtml());
  });
  check('материалы: «Заменить фасады на весь проект» есть и не падает', () => {
    const b = document.getElementById('p-facadeApplyAll');
    if (!b) return false;
    b.click();
    return !/Ошибка/.test(panelHtml()) && new RegExp(`data-mat-pick="facade" data-code="${chosenFacadeCode}"`).test(panelHtml());
  });
  // Отсеки: при doorZoneCount > 1 — переключатель «Секция N / Отсек K» и свой
  // вид фасада отсека (p-zoneFacadeType), «как у секции» — без переопределения.
  check('материалы: отсек — свой вид фасада', () => {
    const api = sandbox.Modul3D.app;
    const names = (panelHtml().match(/<h3>Фасад · ([^,<]+),/) || [])[1];
    if (!api || !api.setModuleDoorZoneCount || !names) return false;
    api.setModuleDoorZoneCount(names, 2);
    const mb = document.getElementById('materialsLinkBtn');
    if (mb && !/data-mat-facade-target/.test(panelHtml())) mb.click();
    const t = document.getElementById('paramsPanel').querySelectorAll('[data-mat-facade-target]').filter((x) => x.attrs['data-mat-facade-target'] === '1')[0];
    if (!t) return false;
    t.click();
    const s = document.getElementById('p-zoneFacadeType');
    if (!s) return false;
    s.value = 'glass4';
    s.dispatch('change', { target: s });
    const ok = /Толщина фасада 4 мм/.test(panelHtml());
    const s2 = document.getElementById('p-zoneFacadeType');
    s2.value = '';
    s2.dispatch('change', { target: s2 });
    const back = !/Толщина фасада 4 мм/.test(panelHtml());
    api.setModuleDoorZoneCount(names, 1);
    return ok && back;
  });
  check('материалы: Библиотека обратно на «Базу модулей»', () => {
    const tabs = document.getElementById('libTabs');
    const modTab = Array.from(document.querySelectorAll('.lib-tab-btn')).filter((b) => b.dataset.libtab === 'modules')[0];
    if (!tabs || !modTab) return false;
    tabs.dispatch('click', { target: modTab });
    // Заголовка «База модулей» с v314 нет — о вкладке говорит кнопка «Сохранить в базу».
    return /data-lib-save-project/.test(libHtml());
  });
}
check('кнопка «назад» возвращает на экран модуля', () => {
  const b = document.getElementById('panelBack');
  if (!b) return false;
  b.click();
  // Регистр DOM-заглушки не забывает id старых элементов между рендерами —
  // отсутствие проверяем по самой HTML-разметке панели, а не по registry.
  const html = $('paramsPanel').innerHTML;
  return html.indexOf('id="p-decor"') === -1 && html.indexOf('id="sectionsList"') !== -1;
});
// Материал/толщина ящиков раньше были общими на проект (p-drawerDecor/
// p-drawerThickness), теперь — поля секции (#drawersDecor/#drawersThickness
// на экране «Ящики», см. drawersPanelBlock); проверка — ниже, в сценарии
// ящиков (drawerScenario).
check('вариант «до пола» есть при любом основании', () => {
  const bt = document.getElementById('m-baseType');
  if (!bt) return false;
  let ok = true;
  for (const v of ['legsPlinth', 'legs', 'plinth']) {
    const el = document.getElementById('m-baseType');
    el.value = v;
    el.dispatch('change', { target: el });
    const sel = document.getElementById('m-leftSide');
    if (!sel || (sel._options || []).indexOf('floor') === -1) ok = false;
  }
  return ok;
});
check('тип опоры выбирается, когда есть ножки', () => {
  const bt = document.getElementById('m-baseType');
  if (!bt) return false;
  bt.value = 'legs';
  bt.dispatch('change', { target: bt });
  const lt = document.getElementById('m-legType');
  if (!lt) return false;
  let ok = true;
  for (const v of ['metal', 'kitchen']) {
    const cur = document.getElementById('m-legType');
    if (!cur) { ok = false; continue; }
    cur.value = v;
    cur.dispatch('change', { target: cur });
  }
  return ok;
});
check('тип опоры пропадает при цоколе без ножек', () => {
  const bt = document.getElementById('m-baseType');
  if (!bt) return false;
  bt.value = 'plinth';
  bt.dispatch('change', { target: bt });
  // Регистр DOM-заглушки не забывает id старых элементов между рендерами —
  // отсутствие проверяем по самой HTML-разметке панели, а не по registry.
  return !/id="m-legType"/.test($('paramsPanel').innerHTML);
});
check('тип опоры при цоколе с ножками — только кухонная, без выбора', () => {
  const bt = document.getElementById('m-baseType');
  if (!bt) return false;
  bt.value = 'legsPlinth';
  bt.dispatch('change', { target: bt });
  // Держать цоколь клипсой умеет только кухонная опора — при этом
  // основании выбор типа опоры не показывается (нечего выбирать).
  return !/id="m-legType"/.test($('paramsPanel').innerHTML);
});
// Карточка секции — неразделённая секция — одна панель с карточкой отсека (app.js renderSectionsList):
// ручки и ширины на вкладке «Секция», открывание/ящики/полки/штанга — на «Отсеки».
const secMode = (m) => { if (m !== 'zones') { return true; } const b = document.querySelectorAll('[data-sec-zone="0"]')[0]; if (b) b.click(); return true; };
check('в секции есть выбор ручек', () => /data-sechandle/.test($('sectionsList').innerHTML));
check('в списке фасадов есть открывание вверх', () => secMode('zones') && /value="liftUp"/.test($('sectionsList').innerHTML) && secMode('section'));
// Алюминиевый рамочный фасад (2026-09-26; вход переехал на экран «Материалы»
// 2026-09-29 вместе с «Вид фасада»/«Материал фасада» секции, см.
// matFacadeFieldHtml — дубль этих же полей в «Конструктиве модуля» убран):
// «Вид фасада» = alu даёт одну плашку-итог (data-mat-pick="facade", класс
// alu-summary), а профиль/схема/цвет/заполнение/цена — в конструкторе фасада
// Библиотеки (Двери → Алюминиевые фасады, app.js libAluConstructorHtml):
// черновик state.aluDraft, «Выбрать» пишет его в секцию. В конце возвращаем
// ЛДСП и экран «Конструктив модуля» (кнопка «Назад»), чтобы не влиять на
// остальные проверки — они ждут #sectionsList/#m-leftSide и т.п.
{
  const mb = document.getElementById('materialsLinkBtn');
  if (mb) mb.click();
  const panelHtml = () => String($('paramsPanel').innerHTML || '');
  const facadeTypeSel = () => document.getElementById('p-secFacadeType');
  const aluSet = (v) => { const el = facadeTypeSel(); if (!el) return false; el.value = v; el.dispatch('change', { target: el }); return true; };
  const matPick = () => document.getElementById('paramsPanel').querySelectorAll('[data-mat-pick="facade"]')[0];
  const libHtml = () => String(libPanelEl().innerHTML || '');
  const ctorEl = (sel, val) => libPanelEl().querySelectorAll(sel).filter((x) => val === undefined || Object.values(x.attrs).indexOf(val) !== -1)[0];
  const ctorSet = (field, v) => {
    const el = libPanelEl().querySelectorAll('[data-alu-draft]').filter((x) => x.attrs['data-alu-draft'] === field)[0];
    if (!el) return false;
    el.value = v;
    libPanelEl().dispatch('change', { target: el });
    return true;
  };
  // «Материал фасада» секции на экране «Материалы» (2026-09-29): вид фасада
  // выбирается в select «Вид фасада» (p-secFacadeType), плашка материала
  // (data-mat-pick="facade") открывает Библиотеку в разделе материалов ЭТОГО
  // вида — «Выбрать» только у engine.facadeMaterialOptions(вид), выбор
  // пишется в sec.facadeMaterial и виден на плашке.
  {
    const pickBtns = () => libPanelEl().querySelectorAll('.lib-pick-btn');
    for (const ft of ['mdf', 'glass4', 'ldsp']) {
      check(`материал фасада секции (${ft}): «Выбрать» только у материалов вида`, () => {
        if (!aluSet(ft)) return false;
        const b = matPick();
        if (!b || !/<label class="mt6">Материал фасада<\/label>/.test(panelHtml())) return false;
        b.click();
        const allowed = sandbox.Modul3D.engine.facadeMaterialOptions(ft).map((o) => o.code);
        const btns = pickBtns();
        if (!btns.length || !btns.every((x) => allowed.indexOf(x.attrs['data-pick-code']) !== -1)) return false;
        const pb = btns[btns.length - 1];
        const code = pb.attrs['data-pick-code'];
        libPanelEl().dispatch('click', { target: pb });
        return new RegExp(`data-mat-pick="facade" data-code="${code}"`).test(panelHtml()) && !/lib-pick-btn/.test(libHtml());
      });
    }
    check('материал фасада секции: у фрезерованного МДФ плашки нет', () =>
      aluSet('mdfMilled') && !/data-mat-pick="facade"/.test(panelHtml()) && aluSet('ldsp'));
  }
  check('алюм. фасад: выбирается в «Вид фасада»', () =>
    /<label class="mt6" for="p-secFacadeType">Вид фасада<\/label>/.test(panelHtml()) && aluSet('alu'));
  check('алюм. фасад: в секции одна плашка-итог, без полей профиля', () =>
    /class="alu-fill-pick alu-summary" data-mat-pick="facade"/.test(panelHtml()) && !/data-field="alu/.test(panelHtml()) && /LXD-1204/.test(panelHtml()));
  check('алюм. фасад: плашка открывает конструктор в Библиотеке', () => {
    const b = matPick();
    if (!b) return false;
    b.click();
    return /id="libAluCtor"/.test(libHtml())
      && ['aluProfile', 'aluColor', 'aluPriceMode', 'aluMaker'].every((f) => libHtml().indexOf(`data-alu-draft="${f}"`) !== -1)
      && /data-alu-draft-fill="1"/.test(libHtml()) && /Для: <b>/.test(libHtml())
      && !/data-alu-draft-apply="1" disabled/.test(libHtml());
  });
  check('алюм. фасад: чертёж сечения с паспортными размерами', () => /class="alu-schema alu-sec/.test(libHtml()) && />45</.test(libHtml()) && /Ширина рамки 45 мм/.test(libHtml()));
  check('алюм. фасад: размер стекла по правилу профиля', () => /Стекло[^<]*2×1.2 − 3/.test(libHtml()));
  // профили Tehmob — только стекло 4 мм (catalog fillType 'glass'): листовых нет.
  // «Заполнение» — не список, а плашка: клик открывает Библиотеку в режиме
  // подбора (роль aluFill), «Выбрать» — только у стёкол; выбор пишет код в
  // черновик и возвращает в конструктор.
  check('алюм. фасад: заполнение — выбор в Библиотеке, только стекло', () => {
    const b = ctorEl('[data-alu-draft-fill]');
    if (!b) return false;
    libPanelEl().dispatch('click', { target: b });
    // Профиль Tehmob — стекло 4 мм: GLASS-4 («Двери → Виды фасадов → Стекло»)
    // выбрать можно, стекло 6 мм — нет (толщина по паспорту профиля).
    return /data-pick-code="GLASS-4"/.test(libHtml()) && !/data-pick-code="GLASS-6"/.test(libHtml())
      && !/data-pick-group="decors"/.test(libHtml()) && !/data-pick-group="back"/.test(libHtml());
  });
  check('алюм. фасад: «Выбрать» стекло 4 мм — в черновике конструктора', () => {
    const pb = libPanelEl().querySelectorAll('.lib-pick-btn').filter((x) => x.attrs['data-pick-code'] === 'GLASS-4')[0];
    if (!pb) return false;
    libPanelEl().dispatch('click', { target: pb });
    return /id="libAluCtor"/.test(libHtml()) && /class="alu-fill-name">Стекло сатин бронз 4 мм/.test(libHtml())
      && !/lib-pick-btn/.test(libHtml()) && /Для: <b>/.test(libHtml());
  });
  check('алюм. фасад: цена производителя не выдумана', () => /Уточняйте цену у производителя/.test(libHtml()) && /href="tel:/.test(libHtml()));
  check('алюм. фасад: смена профиля — сечение LXD-1204', () => ctorSet('aluProfile', 'ALU-LXD-1204') && /Ширина рамки 45 мм/.test(libHtml()));
  check('алюм. фасад: собственное изготовление', () => ctorSet('aluPriceMode', 'own') && !/data-alu-draft="aluMaker"/.test(libHtml()));
  check('алюм. фасад: покупной снова с производителем', () => ctorSet('aluPriceMode', 'buy') && /data-alu-draft="aluMaker"/.test(libHtml()));
  check('алюм. фасад: «Выбрать» конструктора — фасад в секции', () => {
    const b = ctorEl('[data-alu-draft-apply]');
    if (!b) return false;
    libPanelEl().dispatch('click', { target: b });
    return /class="alu-fill-pick alu-summary" data-mat-pick="facade"[\s\S]*LXD-1204 открытый · [^<]+ · Стекло сатин бронз 4 мм/.test(panelHtml()) && !/lib-pick-btn/.test(libHtml());
  });
  check('алюм. фасад: в спецификации свой блок, итог помечен неполным', () => {
    const html = String(docsTab('spec').innerHTML || '');
    return /Алюминиевые фасады/.test(html) && /без учёта позиций без цены/.test(html) && !/>null</.test(html);
  });
  // Конструктор без цели подбора (открыт прямо из Библиотеки) — «Выбрать»
  // активна и ставит фасад в активную секцию активного модуля, заодно
  // переключая её «Вид фасада» на алюминиевый (app.js aluFreeTarget).
  // Перерисовать вкладку «Двери» (заглушка DOM не отражает правки
  // innerHTML вложенных элементов в innerHTML панели).
  const openFacTab = () => {
    const tabs = document.getElementById('libTabs');
    const facTab = Array.from(document.querySelectorAll('.lib-tab-btn')).filter((x) => x.dataset.libtab === 'facades')[0];
    if (!tabs || !facTab) return false;
    tabs.dispatch('click', { target: facTab });
    return true;
  };
  check('алюм. фасад: без цели «Выбрать» активна, цель — активная секция', () =>
    aluSet('ldsp') && !/alu-summary/.test(panelHtml()) && openFacTab()
    && /id="libAluCtor"/.test(libHtml()) && !/data-alu-draft-apply="1" disabled/.test(libHtml())
    && /Для: <b>[^<]*Секция 1<\/b>/.test(libHtml()) && /Вид фасада станет/.test(libHtml()));
  check('алюм. фасад: «Выбрать» у профиля в таблице — профиль в конструкторе', () => {
    const b = ctorEl('[data-alu-pick-profile]', 'ALU-LXD3080');
    if (!b) return false;
    libPanelEl().dispatch('click', { target: b });
    return /id="libAluCtor"/.test(libHtml()) && /<option value="ALU-LXD3080" selected/.test(libHtml());
  });
  check('алюм. фасад: из Библиотеки без цели — alu в активной секции', () => {
    const b = ctorEl('[data-alu-draft-apply]');
    if (!b) return false;
    libPanelEl().dispatch('click', { target: b });
    return /class="alu-fill-pick alu-summary" data-mat-pick="facade"/.test(panelHtml()) && /LXD3080/.test(panelHtml());
  });
  check('алюм. фасад: лист FAC-ALU в «Видах фасадов» открывает конструктор', () => {
    if (!openFacTab()) return false;
    // Лист «Алюминий» раздела «Виды фасадов» (topCode 'facade').
    const nodes = (kind) => libPanelEl().querySelectorAll('[data-tree-node]').filter((r) => r.dataset.kind === kind && r.dataset.top === 'facade');
    let leaf = nodes('leaf').filter((r) => r.dataset.path === 'Алюминий')[0];
    if (!leaf) { const top = nodes('top')[0]; if (top) libPanelEl().dispatch('click', { target: top }); }
    leaf = nodes('leaf').filter((r) => r.dataset.path === 'Алюминий')[0];
    if (!leaf) return false;
    if (!libPanelEl().querySelectorAll('[data-alu-open-ctor]').length) libPanelEl().dispatch('click', { target: leaf });
    const b = libPanelEl().querySelectorAll('[data-alu-open-ctor]')[0];
    if (!b) return false;
    libPanelEl().dispatch('click', { target: b });
    return /id="libAluCtor"/.test(libHtml()) && /Для: <b>/.test(libHtml());
  });
  // Подбор переключил Библиотеку на «Двери» — возвращаем «Базу модулей»,
  // её ждут проверки ниже.
  check('алюм. фасад: Библиотека обратно на «Базу модулей»', () => {
    const tabs = document.getElementById('libTabs');
    const modTab = Array.from(document.querySelectorAll('.lib-tab-btn')).filter((b) => b.dataset.libtab === 'modules')[0];
    if (!tabs || !modTab) return false;
    tabs.dispatch('click', { target: modTab });
    // Заголовка «База модулей» с v314 нет — о вкладке говорит кнопка «Сохранить в базу».
    return /data-lib-save-project/.test(libHtml());
  });
  check('алюм. фасад: вернуть ЛДСП', () => aluSet('ldsp') && !/alu-summary/.test(panelHtml()));
  // Назад на «Конструктив модуля» для следующих проверок (#sectionsList и т.п.).
  const backBtn = document.getElementById('panelBack');
  if (backBtn) backBtn.click();
}
check('есть кнопки выгрузки присадки', () =>
  !!document.getElementById('exportDrillCsv') && !!document.getElementById('exportDrillDxf'));
check('кнопка «скрыть фасады» переключается', () => {
  const b = document.getElementById('hideFacadesBtn');
  if (!b) return false;
  b.click();
  const on = /Показать фасады/.test(b.textContent || '');
  b.click();
  return on;
});
// Иерархия в подписях: заголовок «Модуль N — секции» над списком секций
// убран (v213, дублировал активную вкладку модуля) — хватает подписи
// карточки секции «Модуль N · Секция M», где имя модуля тоже видно.
check('карточка секции: неразделённая секция — одна панель с карточкой отсека', () =>
  /Отсек 1/.test($('sectionsList').innerHTML));

for (const id of ['m-leftSide', 'm-rightSide', 'm-baseType']) {
  const el0 = document.getElementById(id);
  if (!el0) { fails.push('нет элемента #' + id); continue; }
  for (const v of (el0._options || [el0.value])) {
    check(id + ' = ' + v, () => {
      const cur = document.getElementById(id);   // панель могла перерисоваться
      if (!cur) return false;
      cur.value = v;
      cur.dispatch('change', { target: cur });
      return !/Ошибка/.test($('paramsPanel').innerHTML);
    });
  }
}
// Имя модуля больше не поле панели (m-name удалён) — переименование только
// через контекстное меню правой кнопкой (#ctxModName), см. moduleMenuScenario.
for (const pair of [['m-width', 1200], ['m-height', 600], ['m-depth', 350],
                    ['m-baseHeight', 150], ['m-baseHeight', 0]]) {
  check(pair[0] + ' = ' + pair[1], () => {
    const el = document.getElementById(pair[0]);
    if (!el) return false;
    el.value = pair[1];
    el.dispatch('change', { target: el });
    return true;
  });
}

// Секции теперь переключаются вкладками (renderSectionsList в app.js) —
// видна только раскрытая (mod.activeSection), «+» больше не статический
// #addSection, а делегированная кнопка [data-add-section] в ряду вкладок.
check('добавление секции', () => {
  const b = document.querySelector('[data-add-section]');
  return b ? (b.click(), true) : false;
});
check('вкладки секций: после добавления раскрыта новая (Секция 2)', () =>
  /class="sec-tab active"\s+data-sec="1"/.test($('sectionsList').innerHTML));
check('вкладки секций: переключение на первую вкладку раскрывает Секцию 1', () => {
  const tabs = document.querySelectorAll('.sec-tab');
  if (!tabs.length) return false;
  tabs[0].click();
  return /class="sec-tab active"\s+data-sec="0"/.test($('sectionsList').innerHTML);
});
check('вкладки секций: крестик есть только у активной вкладки', () => {
  const removers = document.querySelectorAll('[data-remove-sec]');
  return removers.length === 1;
});
check('вкладки секций: крестик убирает секцию', () => {
  const before = document.querySelectorAll('.sec-tab').length;
  const b = document.querySelector('[data-remove-sec]');
  if (!b) return false;
  b.click();
  return document.querySelectorAll('.sec-tab').length === before - 1;
});
for (const id of Array.from(registry.keys())) {
  if (!/^s\d+-/.test(id)) continue;
  const el = registry.get(id);
  check('секция: ' + id, () => {
    if (el._options && el._options.length) el.value = el._options[el._options.length - 1];
    else el.value = 2;
    el.dispatch('change', { target: el });
    return true;
  });
}

// --- сценарий ящиков: автораспределение, ручной режим, подстройка соседей ---
// Модуль приводим к заведомо известному состоянию: фронт 800-100 = 700 мм,
// три ящика без дверей. Автораспределение обязано дать 240/230/230.
(function drawerScenario() {
  const fld = (name) => document.getElementById('sectionsList')
    .querySelectorAll('[data-field]').filter((e) => e.attrs['data-field'] === name)[0];
  const set = (name, v) => { const el = fld(name); if (!el) return false; el.value = v; el.dispatch('change', { target: el }); return true; };
  const setTop = (id, v) => { const el = document.getElementById(id); if (!el) return false; el.value = v; el.dispatch('change', { target: el }); return true; };
  // Экран «Ящики» рисуется внутри #paramsPanel (см. app.js drawersPanelBlock),
  // не внутри #sectionsList — а querySelectorAll('[data-drawer]') должен
  // читать из элемента с АКТУАЛЬНЫМ _html, иначе попадёт на пустую заглушку
  // registry (см. комментарий у document.querySelectorAll выше в файле).
  const inputs = () => $('paramsPanel').querySelectorAll('[data-drawer]');
  const AVAIL = 700;
  const G2 = 2 * ((((sandbox.__lastModel || {}).modules || [{}])[0].dims || {}).gap ?? 1.5);

  check('подготовка модуля', () => setTop('m-height', 800) && setTop('m-baseType', 'plinth') && setTop('m-baseHeight', 100));
  check('секция: 3 ящика без дверей', () => secMode('zones') && set('facade', 'open') && set('shelves', 0) && set('drawers', 3));
  check('нет NaN в деталировке (авто)', () => docsTab('detailing').innerHTML.indexOf('NaN') === -1);

  // «Редактировать →» в карточке секции открывает отдельную панель
  // «Ящики» (state.panelView:'drawers', см. openDrawersPanel/drawersPanelBlock)
  // вместо старого инлайн-блока в #sectionsList.
  check('«Редактировать →» открывает панель ящиков', () => {
    const b = document.getElementById('sectionsList').querySelectorAll('[data-drawers-open]')[0];
    if (!b) return false;
    b.click();
    return $('paramsPanel').innerHTML.indexOf('id="drawersPanelRoot"') !== -1;
  });
  // Материал/толщина ящиков — теперь поля СЕКЦИИ на этом экране (были общими
  // на проект, см. #drawersDecor/#drawersThickness в drawersPanelBlock).
  check('ящики по умолчанию 16 мм', () => {
    const el = document.getElementById('drawersThickness');
    return !!el && Number(el.attrs.value) === 16;
  });
  check('есть выбор декора ящиков', () => !!document.getElementById('drawersDecor'));

  check('переход в ручной режим', () => setTop('drawersMode', 'manual'));
  check('поля ручных высот заполнены', () => {
    const el = inputs();
    return el.length === 3 && el.every((x) => Number(x.attrs.value) > 0);
  });
  check('ручной режим не обнулил ящики', () => docsTab('detailing').innerHTML.indexOf('NaN') === -1);
  check('стартовые высоты = автораспределение, остаток нижнему', () => {
    const v = inputs().map((x) => Number(x.attrs.value) + G2);
    // поля идут сверху вниз, неделимый остаток достаётся НИЖНЕМУ ящику
    return v.length === 3 && Math.abs(v.reduce((a, b) => a + b, 0) - AVAIL) < 1.5 && v[2] === 240;
  });

  // Поля идут сверху вниз, поэтому для сравнения приводим их к порядку модели
  const setDrawer = (d, v) => { const el = inputs()[d]; if (!el) return; el.value = v - G2; el.dispatch('change', { target: el }); };
  // поля показывают реальный фасад (шаг − 2·gap); тесты считают в шаге
  const heights = () => inputs().map((x) => Number(x.attrs.value) + G2);

  check('поля высот идут сверху вниз', () => {
    const idx = inputs().map((x) => Number(x.attrs['data-drawer']));
    // верхнее поле — самый большой индекс модели (ящики считаются снизу)
    return idx.length === 3 && idx[0] === 2 && idx[2] === 0;
  });
  check('правка одного ящика подстраивает соседние', () => {
    setDrawer(0, 150);
    const v = heights();
    return v.length === 3 && v[0] === 150 && Math.abs(v.reduce((a, b) => a + b, 0) - AVAIL) < 1.5;
  });
  // Ключевое требование: заданный вручную ящик фиксируется. Правка второго
  // не должна сдвигать первый — остаток разбирает только третий.
  check('первый ящик 100 → остальные делят остаток', () => {
    setDrawer(0, 100);
    const v = heights();
    return v[0] === 100 && v[1] === 300 && v[2] === 300;
  });
  check('второй ящик 100 → первый НЕ меняется, остаток уходит третьему', () => {
    setDrawer(1, 100);
    const v = heights();
    return v[0] === 100 && v[1] === 100 && v[2] === 500;
  });
  check('зафиксированные помечены в интерфейсе', () => {
    const cls = inputs().map((x) => x.attrs.class || '');
    return cls[0].indexOf('pinned') !== -1 && cls[1].indexOf('pinned') !== -1 && cls[2].indexOf('pinned') === -1;
  });
  check('смена высоты модуля двигает только свободный ящик', () => {
    setTop('m-height', 900);                       // фронт стал 800
    // m-height принадлежит экрану «Модуль», его обработчик (см. app.js)
    // зовёт только recompute(), без renderParamsPanel() — панель «Ящики»
    // сама не перерисуется. Форсируем её обновление тем же переключателем
    // экрана, что и HUD в 3D (sandbox.Modul3D.app.setPanelView — вне vm
    // window не определён, обращаемся к песочнице напрямую).
    sandbox.Modul3D.app.setPanelView('drawers');
    const v = heights();
    return v[0] === 100 && v[1] === 100 && Math.abs(v.reduce((a, b) => a + b, 0) - 800) < 1.5;
  });
  check('сброс фиксации возвращает авторежим', () => {
    const b = document.getElementById('drawersUnpinBtn');
    if (!b) return false;
    b.click();
    return $('paramsPanel').querySelectorAll('[data-drawer]').length === 0;
  });
  check('после сброса вернулись к ручному режиму для остальных проверок', () => {
    setTop('m-height', 800);
    return setTop('drawersMode', 'manual');
  });
  check('нет NaN после правки', () => docsTab('detailing').innerHTML.indexOf('NaN') === -1);
  check('подъём ящика от дна не меньше 10 мм', () => {
    if (!setTop('drawersOffset', 0)) return false;
    return Number(document.getElementById('drawersOffset').attrs.value) >= 10;
  });

  // --- смена ЧИСЛА ящиков при ручных высотах (2026-10-08) ---
  const app = sandbox.Modul3D.app;
  const gotoPanel = (v) => app.setPanelView(v);
  const sumOk = (v, n) => v.length === n && Math.abs(v.reduce((a, b) => a + b, 0) - AVAIL) < 1.5;
  const warnHtml = () => document.getElementById('sectionsList').innerHTML;
  const choose = (kind) => {
    const b = document.getElementById('sectionsList').querySelectorAll('[data-drawer-add-choice]')
      .filter((x) => x.attrs['data-drawer-add-choice'] === kind)[0];
    if (!b) return false;
    document.dispatch('click', { target: b });
    return true;
  };
  check('счёт: 3 ящика, верхний задан вручную 150', () => {
    gotoPanel('module'); set('drawers', 0); set('drawers', 3);
    gotoPanel('drawers'); setTop('drawersMode', 'manual');
    setDrawer(0, 150);
    const v = heights();
    return sumOk(v, 3) && v[0] === 150;
  });
  check('+1 ящик: ручной 150 остаётся, остальные делят поровну', () => {
    gotoPanel('module'); set('drawers', 4); gotoPanel('drawers');
    const v = heights();
    const cls = inputs().map((x) => x.attrs.class || '');
    // правили ВЕРХНИЙ ящик -> он остаётся верхним (поле 0), новый добавлен снизу
    return sumOk(v, 4) && v[0] === 150 && cls[0].indexOf('pinned') !== -1
      && cls.filter((c) => c.indexOf('pinned') !== -1).length === 1
      && Math.abs(v[1] - v[2]) <= 10 && Math.abs(v[2] - v[3]) <= 10;
  });
  check('-1 ящик: ручной 150 остаётся, остаток делят автоматические', () => {
    gotoPanel('module'); set('drawers', 3); gotoPanel('drawers');
    const v = heights();
    const cls = inputs().map((x) => x.attrs.class || '');
    return sumOk(v, 3) && v[0] === 150 && cls[0].indexOf('pinned') !== -1;
  });
  check('правили нижний ящик: +1 -> новый сверху, нижний остаётся 150', () => {
    gotoPanel('module'); set('drawers', 0); set('drawers', 3);
    gotoPanel('drawers'); setTop('drawersMode', 'manual');
    setDrawer(2, 150);                       // нижнее поле
    gotoPanel('module'); set('drawers', 4); gotoPanel('drawers');
    let v = heights();
    const cls = inputs().map((x) => x.attrs.class || '');
    const ok = sumOk(v, 4) && v[3] === 150 && cls[3].indexOf('pinned') !== -1;
    gotoPanel('module'); set('drawers', 3); gotoPanel('drawers');
    v = heights();
    // восстановить состояние для следующей проверки: верхний 150
    return ok && sumOk(v, 3) && v[2] === 150;
  });
  check('вернуть: верхний ручной 150', () => {
    gotoPanel('module'); set('drawers', 0); set('drawers', 3);
    gotoPanel('drawers'); setTop('drawersMode', 'manual'); setDrawer(0, 150);
    return heights()[0] === 150;
  });
  check('не хватает места: число не меняется, показано предупреждение', () => {
    setDrawer(1, 300); setDrawer(2, 300);
    // конфликт: три ручных ящика занимают весь фронт
    const before = heights().length;
    gotoPanel('module');
    set('drawers', 8);
    const html = warnHtml();
    gotoPanel('drawers');
    return before === 3 && inputs().length === 3 && /data-drawer-add-choice="cancel"/.test(html)
      && /data-drawer-add-choice="shrink"/.test(html) && /data-drawer-add-choice="equal"/.test(html);
  });
  check('«Отменить добавление» оставляет всё как было', () => {
    gotoPanel('module');
    const ok = choose('cancel');
    gotoPanel('drawers');
    return ok && inputs().length === 3 && !/data-drawer-add-choice/.test(warnHtml());
  });
  check('«Уменьшить ручные пропорционально» добавляет ящик, все >= 50', () => {
    gotoPanel('module'); set('drawers', 8);
    const ok = choose('shrink');
    gotoPanel('drawers');
    const v = heights();
    return ok && sumOk(v, 8) && v.every((x) => x >= 50 - 0.01);
  });
  check('«Разделить все поровну» сбрасывает ручные и добавляет ящик', () => {
    gotoPanel('module'); set('drawers', 3); gotoPanel('drawers'); setTop('drawersMode', 'manual');
    setDrawer(0, 300); setDrawer(1, 300);
    gotoPanel('module'); set('drawers', 8);
    const ok = choose('equal');
    gotoPanel('drawers');
    const cls = inputs().map((x) => x.attrs.class || '');
    return ok && !/data-drawer-add-choice/.test(warnHtml()) && cls.length === 0;
  });
  check('нет NaN после смены числа ящиков', () => docsTab('detailing').innerHTML.indexOf('NaN') === -1);
  // вернуть состояние, которое ждут следующие сценарии: 3 ящика на всю секцию
  gotoPanel('module'); set('drawers', 3); gotoPanel('drawers'); setTop('drawersMode', 'manual'); gotoPanel('module');
})();

// --- материал ящиков шкафа/тумбы (2026-09-26): «как корпус», пока его не
// выбрали вручную в панели «Ящики»; ручной выбор смена корпуса не трогает.
(function drawerDecorFollowsCarcassScenario() {
  const model = () => sandbox.__lastModel;
  const partsOf = (m) => (m && (m.partsRaw || m.parts)) || [];
  const drawerMats = () => partsOf(model()).filter((q) => /ящика/.test(q.name || '') && /Боковина|Задняя/.test(q.name || ''))
    .map((q) => q.material);
  const carcassMat = () => { const s0 = partsOf(model()).filter((q) => q.kind === 'bottom')[0]; return s0 && s0.material; };
  const allAre = (code) => { const a = drawerMats(); return a.length > 0 && a.every((c) => c === code); };
  const pickBtns = () => libPanelEl().querySelectorAll('.lib-pick-btn');
  const setCarcass = (notCode) => {
    sandbox.Modul3D.app.setPanelView('module');
    const mb = document.getElementById('materialsLinkBtn');
    if (mb) mb.click();
    const b = document.getElementById('p-decor');
    if (!b) return null;
    b.click();
    const pb = pickBtns().filter((x) => x.attrs['data-pick-group'] === 'decors' && x.attrs['data-pick-code'] !== notCode)[0];
    if (!pb) return null;
    libPanelEl().dispatch('click', { target: pb });
    return pb.attrs['data-pick-code'];
  };
  const setDrawerDecor = (v) => {
    sandbox.Modul3D.app.setPanelView('drawers');
    const el = document.getElementById('drawersDecor');
    if (!el) return false;
    el.value = v; el.dispatch('change', { target: el });
    return true;
  };
  check('шкаф: ящики по умолчанию из материала корпуса', () => {
    if (!setDrawerDecor('')) return false;
    return !!carcassMat() && allAre(carcassMat());
  });
  let c1 = null;
  check('шкаф: при смене корпуса ящики меняются вместе с ним', () => {
    const before = carcassMat();
    c1 = setCarcass(before);
    return !!c1 && c1 !== before && carcassMat() === c1 && allAre(c1);
  });
  check('шкаф: ручной выбор материала ящиков не меняется при смене корпуса', () => {
    const manual = (sandbox.Modul3D.catalog.DECORS || []).filter((d) => d.code !== c1)[0];
    if (!manual || !setDrawerDecor(manual.code) || !allAre(manual.code)) return false;
    const c2 = setCarcass(carcassMat() === manual.code ? '' : carcassMat());
    return !!c2 && allAre(manual.code);
  });
  check('шкаф: «Как корпус» возвращает ящики к корпусу', () => setDrawerDecor('') && allAre(carcassMat()));
  // Подбор корпуса переключил Библиотеку на материалы — вернуть «Базу модулей».
  const tabs = document.getElementById('libTabs');
  const modTab = Array.from(document.querySelectorAll('.lib-tab-btn')).filter((b) => b.dataset.libtab === 'modules')[0];
  if (tabs && modTab) tabs.dispatch('click', { target: modTab });
})();

// --- ящики ВНУТРИ отсека: карточка отсека, экран «Ящики» отсека, «Назад» ---
(function zoneDrawersScenario() {
  const app = sandbox.Modul3D.app;
  const panel = () => $('paramsPanel').innerHTML;
  app.setPanelView('drawers');
  const name = (panel().match(/<h3>Ящики — (.+?) — Секция/) || [])[1];
  app.setPanelView('module');
  check('отсеки: ящики отсека — поле в карточке, экран и «Назад»', () => {
    if (!name) return false;
    app.setModuleDoorZoneCount(name, 3, 0);
    app.editModuleZone(name, 0, 1);
    const inp = $('paramsPanel').querySelectorAll('[data-zonedrawers]')[0];
    if (!inp) return false;
    inp.value = 2;
    inp.dispatch('change', { target: inp });
    const btn = $('paramsPanel').querySelectorAll('[data-zonedrawers-open]')[0];
    if (!btn || /disabled/.test(String(btn.attrs.disabled !== undefined ? 'disabled' : ''))) return false;
    btn.click();
    if (panel().indexOf('id="drawersPanelRoot"') === -1 || !/Отсек 2/.test(panel())) return false;
    const mode = document.getElementById('drawersMode');
    mode.value = 'manual';
    mode.dispatch('change', { target: mode });
    const hs = $('paramsPanel').querySelectorAll('[data-drawer]');
    if (hs.length !== 2 || hs.some((x) => !(Number(x.attrs.value) > 0))) return false;
    document.getElementById('panelBack').click();
    const back = panel().indexOf('data-zonedrawers=') !== -1;
    app.setModuleDoorZoneCount(name, 1, 0);
    app.setPanelView('module');
    return back;
  });
})();

// --- панель: у кухонного модуля нет штанги, выбора верха нет ни у кого -----
(function panelFieldsScenario() {
  sandbox.Modul3D.app.setPanelView('module');   // вернулись с экрана «Ящики»
  const panelHtml = () => $('paramsPanel').innerHTML;
  check('в панели нет выбора «Верх модуля»', () => panelHtml().indexOf('m-topType') === -1);
  check('в панели нет «Ширина планки»', () => panelHtml().indexOf('m-railWidth') === -1);
  const sectionsHtml = () => $('sectionsList').innerHTML;
  const secField = (name) => $('sectionsList').querySelectorAll('[data-field]').filter((e) => e.attrs['data-field'] === name)[0];
  const setSec = (name, v) => { const el = secField(name); if (!el) return false; el.value = v; el.dispatch('change', { target: el }); return true; };
  // К этому месту секция осталась с тремя ящиками на весь фронт (сценарий ящиков выше).
  check('ящики на всю секцию: отсеков нет, подсказка вместо фасада/полок/штанги', () => {
    const h = sectionsHtml();
    return /Ящики занимают всю секцию/.test(h) && !/data-sec-sub=/.test(h) && !/Штанга для одежды/.test(h);
  });
  // два ящика и свободное место над ними: несъёмная полка делит секцию на два отсека-вкладки
  check('два ящика: вкладки «Отсек 1 (ящики)» / «Отсек 2»', () => {
    if (!setSec('drawers', 2)) return false;
    const h = sectionsHtml();
    return /data-sec-sub="drawers"/.test(h) && /data-sec-sub="upper"/.test(h) && /Редактировать ящики/.test(h) && !/Штанга для одежды/.test(h);
  });
  check('у обычного модуля штанга предлагается (вкладка «Отсек 2»)', () => {
    const up = $('sectionsList').querySelectorAll('[data-sec-sub]').filter((e) => e.dataset.secSub === 'upper')[0];
    if (!up) return false;
    up.click();
    return /Штанга для одежды/.test(sectionsHtml());
  });

  // ставим кухонный модуль из базы и проверяем, что штанги там нет
  // чистим проект, чтобы в деталировке остался ТОЛЬКО модуль под мойку
  let guard = 60;
  while (document.querySelectorAll('.mod-tab').length && guard-- > 0) {
    const d = document.getElementById('delModule');
    if (!d) break;
    d.click();
  }
  const kitchen = modGroupRow('kitchen');
  check('категория «Кухонный модуль» есть', () => !!kitchen);
  check('у кухонного модуля штанги нет', () => {
    if (!kitchen) return false;
    // Категория раскрывается ИНЛАЙН в #libraryPanel (грид карточек
    // .lib-item[data-preset] внутри строки дерева), без плавающего
    // #moduleMenu — клик по миниатюре сразу добавляет модуль в проект
    // (см. app.js bindLibraryEvents). Берём КОНКРЕТНЫЙ вариант 'lower600'
    // (нижний с полкой, topType: 'rails' — см. presets.js), а не первый
    // попавшийся: с 2026-09-21 карточки кухни разложены по подкатегориям
    // «Верхние модули»/«Нижний модуль» (см. state.libModOverrides), и
    // первой в гриде теперь оказывается карточка ВЕРХНЕГО модуля (без
    // planок — сплошная крышка, topType не задан), а не нижнего.
    toggleModGroup(kitchen);
    const item = modGridItems('kitchen').filter((b) => b.dataset.preset === 'lower600')[0];
    if (!item) return false;
    item.click();
    return sectionsHtml().indexOf('Штанга для одежды') === -1;
  });
  // «Планка верхняя ...» (раздельно) или «Планки верхние» (если передняя и
  // задняя одинаковы и склеились в деталировке в одну строку — см.
  // mergeEqualParts/mergeNameKey в engine.js) — оба варианта означают, что
  // построены планки, а не цельная крышка. Проверяем тот же 'lower600',
  // добавленный проверкой выше.
  check('кухонный модуль всё равно строится с двумя планками', () =>
    /Планк[аи] верхн/.test(docsTab('detailing').innerHTML));
  // Закрыть категорию за собой: иначе следующий сценарий (presetScenario
  // ниже) находит «Кухонный модуль» уже открытым — с 2026-09-21 он первый
  // в списке категорий (см. state.libTopOrder) — и его собственный
  // toggleModGroup(modGroupRow(firstGroupId)) СВОРАЧИВАЕТ категорию вместо
  // ожидаемого раскрытия.
  toggleModGroup(kitchen);
})();

// --- база готовых модулей: категория → вариант → модуль в проекте ----------
// Категория — строка дерева (data-kind="top", topCode 'mod:<id>', см. app.js
// libraryBlock/libTreeRowHtml), открывается делегированным кликом по
// #libraryPanel (см. modGroupRow/toggleModGroup выше). Сама карточка
// (.lib-item[data-preset]) кликается напрямую — плавающего #moduleMenu для
// выбора пресета нет, клик по миниатюре сразу добавляет модуль (см. app.js
// bindLibraryEvents).
(function presetScenario() {
  check('строки категорий базы есть', () => modGroupRows().length >= 2);

  const tabsCount = () => document.querySelectorAll('.mod-tab').length;
  const before = tabsCount();
  const firstRow = modGroupRows()[0];
  const firstGroupId = firstRow ? firstRow.dataset.top.slice(4) : '';

  check('категория открывает список вариантов', () => {
    toggleModGroup(modGroupRow(firstGroupId));
    return modGroupOpen(firstGroupId) && modGridItems(firstGroupId).length >= 2;
  });
  check('выбор варианта добавляет модуль в проект', () => {
    const item = modGridItems(firstGroupId)[0];
    if (!item) return false;
    item.click();
    return tabsCount() === before + 1;
  });
  check('модуль из базы построился без ошибок', () =>
    docsTab('detailing').innerHTML.indexOf('NaN') === -1 && docsTab('detailing').innerHTML.indexOf('<table') !== -1);
  check('в деталировке появились детали шкафа', () => /Боковина|Полка/.test(docsTab('detailing').innerHTML));
  toggleModGroup(modGroupRow(firstGroupId));   // закрыть категорию, открытую проверками выше (клик — переключатель)
  check('закрытие категории снимает .lib-collapsed', () => !modGroupOpen(firstGroupId));

  // все варианты всех категорий добавляются без исключений
  let added = 0;
  for (const groupId of modGroupRows().map((r) => r.dataset.top.slice(4))) {
    toggleModGroup(modGroupRow(groupId));          // открыть категорию
    const items = modGridItems(groupId);
    // Своя категория (state.libModCustomGroups, ключ 'modcustom-…') создаётся
    // пустой кнопкой «Добавить категорию» и может оставаться пустой в
    // опубликованном каталоге — это не поломка. Встроенные группы PRESETS
    // пустыми быть не должны.
    if (!items.length) {
      if (groupId.indexOf('modcustom-') !== 0) fails.push('база: список вариантов пуст для mod:' + groupId);
      toggleModGroup(modGroupRow(groupId));        // закрыть категорию перед следующей
      continue;
    }
    for (const it of items) {
      const n = tabsCount();
      it.click();
      if (tabsCount() !== n + 1) { fails.push('база: вариант не добавился — ' + it.attrs['data-preset']); }
      else added += 1;
    }
    toggleModGroup(modGroupRow(groupId));          // закрыть категорию перед следующей
  }
  check('добавились все варианты базы', () => added >= 8);
  check('после всех вариантов деталировка цела', () => docsTab('detailing').innerHTML.indexOf('NaN') === -1);
})();

// --- нумерация и место вставки модулей -------------------------------------
(function moduleOrderScenario() {
  const count = () => document.querySelectorAll('.mod-tab').length;
  // Имя активного модуля больше не читается из поля m-name (его убрали,
  // переименование только через контекстное меню) и больше не из заголовка
  // секций (убран в v213) — берём прямо из подписи активной вкладки модуля:
  // `<button class="mod-tab ... active" ...>${esc(m.name)}${rotation}</button>`
  // (см. app.js moduleTabsBlock). Хвост «↻N°» (поворот) отрезаем отдельно.
  const activeModuleName = () => {
    const r = /<button class="mod-tab[^"]*\bactive\b[^"]*"[\s\S]*?>([^<]*)(?:<span[\s\S]*?<\/span>)?<\/button>/.exec($('paramsPanel').innerHTML);
    return r ? r[1].replace(/\s*↻\d+°\s*$/, '') : '';
  };

  // сводим проект к одному модулю — удаление теперь иконкой в шапке
  // (#delModule), в контекстном меню (см. moduleMenuScenario ниже) остался
  // только пункт переименования (см. app.js showModuleMenu).
  const delOnce2 = () => {
    const d = document.getElementById('delModule');
    if (d) d.click();
  };
  let guard = 40;
  while (count() > 1 && guard-- > 0) delOnce2();

  // Элементы берём заново перед каждым действием: панель перерисовывается,
  // и прежние объекты остаются без обработчиков.
  const add = () => document.getElementById('addModule');
  check('добавление даёт имя «Модуль 2»', () => {
    add().click();
    return count() === 2 && /Модуль 2/.test(activeModuleName());
  });
  check('ещё один модуль — «Модуль 3»', () => {
    add().click();
    return count() === 3 && /Модуль 3/.test(activeModuleName());
  });
  check('новый модуль встаёт за выделенным, а не в конец', () => {
    // делаем активным первый модуль и добавляем — он должен стать вторым
    const first = document.querySelectorAll('.mod-tab')[0];
    first.click();
    add().click();
    return count() === 4 && /Модуль 2/.test(activeModuleName());
  });
  check('имена из базы не попадают в модули', () => {
    // чистим проект, чтобы в деталировке остался ТОЛЬКО модуль под мойку
    let guard2 = 60;
    while (document.querySelectorAll('.mod-tab').length && guard2-- > 0) {
      const d = document.getElementById('delModule');
      if (!d) break;
      d.click();
    }
    const row = modGroupRows()[0];
    toggleModGroup(row);
    const item = row ? modGridItems(row.dataset.top.slice(4))[0] : null;
    if (!item) return false;
    item.click();
    return /^Модуль \d+$/.test(activeModuleName());
  });
})();

// --- контекстное меню модуля: поворот и удаление правой кнопкой -----------
(function moduleMenuScenario() {
  const add = document.getElementById('addModule');
  check('добавление второго модуля', () => { if (!add) return false; add.click(); return true; });

  const tabs = () => document.querySelectorAll('.mod-tab');
  check('вкладки модулей есть', () => tabs().length >= 2);

  // Контекстное меню модуля теперь — только переименование (поворот переехал
  // в HUD 3D, удаление — в иконку в шапке, см. app.js showModuleMenu).
  check('правая кнопка открывает меню переименования', () => {
    const t = tabs()[0];
    t.click();                       // активный модуль — тот же, что дальше сверяем по имени
    t.dispatch('contextmenu', { target: t, clientX: 40, clientY: 60 });
    return !!document.getElementById('moduleMenu') && !!document.getElementById('ctxModName');
  });
  closeAllMenus();

  // Поворот — мост sandbox.Modul3D.app.rotateModule/getRotations/
  // getModuleHudState для HUD-меню в 3D (см. app.js/ui-shell.js), а не
  // пункт меню. Подписи обязаны совпадать с фактическим разворотом деталей
  // (проверяется отдельно в tools/geometry.js).
  check('в списке поворотов 4 варианта, подписи 90°/270° верные', () => {
    const app = sandbox.Modul3D.app;
    if (!app || typeof app.getRotations !== 'function') return false;
    const rot = app.getRotations();
    const r90 = rot.filter((r) => r[0] === 90)[0];
    const r270 = rot.filter((r) => r[0] === 270)[0];
    return rot.length === 4 && !!r90 && /вправо/.test(r90[1]) && !!r270 && /влево/.test(r270[1]);
  });
  // Поворот проверяем по факту: у проекта меняется габарит в ряду, потому что
  // повёрнутый модуль занимает свою глубину, а не ширину.
  const projSize = () => {
    const r = /Габарит проекта ([\d.]+)×([\d.]+)×([\d.]+)/.exec(docsTab('drawings').innerHTML);
    return r ? r[1] + 'x' + r[3] : '';
  };
  // Имя активной вкладки модуля — см. тот же приём и комментарий в
  // moduleOrderScenario() выше (заголовок секций с именем модуля убран в v213).
  const activeModuleName = () => {
    const r = /<button class="mod-tab[^"]*\bactive\b[^"]*"[\s\S]*?>([^<]*)(?:<span[\s\S]*?<\/span>)?<\/button>/.exec($('paramsPanel').innerHTML);
    return r ? r[1].replace(/\s*↻\d+°\s*$/, '') : '';
  };
  const before = projSize();
  check('поворот на 90° применяется', () => {
    const name = activeModuleName();
    const app = sandbox.Modul3D.app;
    if (!name || !app) return false;
    app.rotateModule(name, 90);
    const rotOk = app.getModuleHudState(name).rotation === 90;
    const after = projSize();
    return rotOk && before !== '' && after !== '' && after !== before;
  });

  // Кнопка удаления активного модуля и история (Ctrl+Z / Ctrl+Y)
  check('кнопка «Удалить модуль» убирает активный модуль', () => {
    const before = document.querySelectorAll('.mod-tab').length;
    const del = document.getElementById('delModule');
    if (!del) return false;
    del.click();
    return document.querySelectorAll('.mod-tab').length === before - 1;
  });
  check('отмена возвращает удалённый модуль', () => {
    const before = document.querySelectorAll('.mod-tab').length;
    const u = document.getElementById('undoBtn');
    if (!u) return false;
    u.click();
    return document.querySelectorAll('.mod-tab').length === before + 1;
  });
  check('возврат снова удаляет модуль', () => {
    const before = document.querySelectorAll('.mod-tab').length;
    const rr = document.getElementById('redoBtn');
    if (!rr) return false;
    rr.click();
    return document.querySelectorAll('.mod-tab').length === before - 1;
  });
  check('Ctrl+Z отменяет с клавиатуры', () => {
    const before = document.querySelectorAll('.mod-tab').length;
    document.dispatch('keydown', { key: 'z', ctrlKey: true, target: document.body,
      preventDefault() {}, shiftKey: false });
    return document.querySelectorAll('.mod-tab').length === before + 1;
  });
  check('Ctrl+Y возвращает с клавиатуры', () => {
    const before = document.querySelectorAll('.mod-tab').length;
    document.dispatch('keydown', { key: 'y', ctrlKey: true, target: document.body,
      preventDefault() {}, shiftKey: false });
    return document.querySelectorAll('.mod-tab').length === before - 1;
  });
  check('отмена восстанавливает высоту модуля', () => {
    const el = document.getElementById('m-height');
    if (!el) return false;
    const was = el.value;
    el.value = String(Number(was) + 50);
    el.dispatch('change', { target: el });
    document.getElementById('undoBtn').click();
    return String(document.getElementById('m-height').value) === String(was);
  });
  check('отмена возвращает число полок в секции', () => {
    const el = document.querySelectorAll('[data-field="shelves"]')[0];
    if (!el) return false;
    const was = el.value;
    el.value = String(Number(was) + 2);
    el.dispatch('change', { target: el });
    document.getElementById('undoBtn').click();
    const now = document.querySelectorAll('[data-field="shelves"]')[0];
    return String(now.value) === String(was);
  });
  check('отмена убирает добавленный модуль', () => {
    const before = document.querySelectorAll('.mod-tab').length;
    document.getElementById('addModule').click();
    if (document.querySelectorAll('.mod-tab').length !== before + 1) return false;
    document.getElementById('undoBtn').click();
    return document.querySelectorAll('.mod-tab').length === before;
  });
  check('Delete удаляет выделенный модуль', () => {
    const before = document.querySelectorAll('.mod-tab').length;
    document.dispatch('keydown', { key: 'Delete', target: document.body });
    return document.querySelectorAll('.mod-tab').length === before - 1;
  });
  check('после Delete отмена возвращает модуль', () => {
    const before = document.querySelectorAll('.mod-tab').length;
    document.dispatch('keydown', { key: 'z', ctrlKey: true, shiftKey: false, target: document.body });
    return document.querySelectorAll('.mod-tab').length === before + 1;
  });

  check('отмена восстанавливает изменённый размер', () => {
    const w = document.getElementById('m-width');
    if (!w) return false;
    const was = w.value;
    w.value = String(Number(was) + 137);
    w.dispatch('change', { target: w });
    document.getElementById('undoBtn').click();
    return String(document.getElementById('m-width').value) === String(was);
  });

  // Удаление — иконка в шапке (#delModule), в контекстном меню (правая
  // кнопка по вкладке) остался только пункт переименования, см.
  // moduleMenuScenario выше и app.js showModuleMenu.
  const delOnce = () => {
    const d = document.getElementById('delModule');
    if (d) d.click();
  };
  check('удаляются все модули, включая последний', () => {
    let guard = 60;
    while (document.querySelectorAll('.mod-tab').length > 0 && guard-- > 0) delOnce();
    return document.querySelectorAll('.mod-tab').length === 0;
  });
  check('после удаления всех снова видна подсказка', () => /Проект пуст/.test($('paramsPanel').innerHTML));
  check('пустой проект не ломает чертежи', () => docsTab('drawings').innerHTML.indexOf('NaN') === -1);
  check('модуль добавляется обратно', () => {
    document.getElementById('addModule').click();
    return document.querySelectorAll('.mod-tab').length === 1;
  });
})();

for (const id of ['hideFacades', 'addModule', 'saveProjectBtn', 'openProjectBtn']) {
  const el = document.getElementById(id);
  if (el) check('клик ' + id, () => { el.click(); return true; });
}
// Виды камеры: нижней панели кнопок больше нет — вид переключает гизма в
// 3D (viewer.js, здесь заглушка), горячие клавиши 1–4 (ui-shell.js) и мост
// window.Modul3D.app.setView (app.js: applyView).
(function viewSwitchScenario() {
  const app = sandbox.Modul3D.app;
  const v = sandbox.__viewer;
  check('вид: есть app.setView/getView', () => typeof app.setView === 'function' && typeof app.getView === 'function');
  for (const name of ['front', 'side', 'left', 'back', 'top', 'bottom', 'iso']) {
    check('вид: ' + name, () => {
      app.setView(name);
      return app.getView() === name && (!v || v.viewName === name);
    });
  }
  // Горячие клавиши вешает uiShell.start() (его зовёт inline-скрипт index.html
  // после app.js) — здесь поднимаем его явно, иначе keydown некому ловить.
  check('вид: uiShell.start() в заглушке DOM', () => { sandbox.Modul3D.uiShell.start(); return true; });
  const keys = { Digit1: 'front', Digit2: 'side', Digit3: 'top', Digit4: 'iso' };
  app.setView('back');   // стартуем не с iso, чтобы Digit4 проверялся честно
  for (const code of Object.keys(keys)) {
    check('вид: клавиша ' + code + ' → ' + keys[code], () => {
      document.dispatch('keydown', { code: code, key: code.slice(-1), target: document.body, preventDefault() {} });
      return app.getView() === keys[code] && (!v || v.viewName === keys[code]);
    });
  }
  // Жест на гизме: viewer сам сменил вид и дёрнул onViewChange — app только
  // синхронизирует state.view, повторно setView не зовёт.
  check('вид: гизма → onViewChange синхронизирует состояние', () => {
    if (!v || typeof v.onViewChange !== 'function') return false;
    let calls = 0;
    const orig = v.setView;
    v.setView = function (n) { calls++; return orig.call(this, n); };
    v.viewName = 'back';
    v.onViewChange('back');
    v.setView = orig;
    return app.getView() === 'back' && calls === 0;
  });
  app.setView('iso');
})();
// HUD модуля в 3D (ui-shell.js renderHud) подписывает «Материал:» по полю
// #p-decor. С 2026-09-26 это не <select>, а плашка-кнопка (app.js
// matPickPlashkaHtml) — клик по модулю в 3D при открытых «Материалах модуля»
// раньше ронял HUD с TypeError (selectedText читал el.options).
(function hudWithMaterialsOpenScenario() {
  const v = sandbox.__viewer;
  // Имя берём с вкладки модуля ДО перехода в «Материалы» (там вкладок нет) —
  // тот же приём, что activeModuleName() в сценарии поворота выше.
  const r = /<button class="mod-tab[^"]*\bactive\b[^"]*"[\s\S]*?>([^<]*)(?:<span[\s\S]*?<\/span>)?<\/button>/.exec(String($('paramsPanel').innerHTML || ''));
  const name = r ? r[1].replace(/\s*↻\d+°\s*$/, '').trim() : '';
  const openBtn = document.getElementById('materialsLinkBtn');
  if (openBtn) openBtn.click();
  check('HUD: «Материалы модуля» открыты (#p-decor — плашка)', () => !!name && !!document.getElementById('p-decor'));
  check('HUD: клик по модулю в 3D при открытых материалах — без ошибки', () => {
    if (!v || typeof v.onSelectModule !== 'function') return false;
    v.__click(0);                       // левый клик только выделяет — HUD не открывается
    v.onSelectModule(name);
    const left = $('partHud').classList.contains('open');
    v.__click(2);                       // правый клик — выделяет и открывает HUD
    v.onSelectModule(name);
    const hud = String($('partHud').innerHTML || '');
    return !left && /Материал: [^<—]/.test(hud);
  });
  if (v && typeof v.onSelectModule === 'function') v.onSelectModule(null);
  const back = document.getElementById('panelBack');
  if (back && document.getElementById('p-decor')) back.click();
})();
// Фокусный режим — точечная правка материала ОДНОЙ детали (2026-09-26):
// изолировать модуль → клик по левой боковине → «Редактировать деталь» →
// плашка «Материал этой детали» → Библиотека → «Выбрать» у МДФ-панели.
// Меняется только левая боковина (материал и толщина из каталога), правая и
// другие модули — как были, наружная ширина модуля та же; возврат — на экран
// этой же детали; «Сбросить к материалу модуля» возвращает всё назад.
(function partMaterialFocusScenario() {
  const v = sandbox.__viewer;
  const eng = sandbox.Modul3D.engine;
  const cat = sandbox.Modul3D.catalog;
  const panelHtml = () => String($('paramsPanel').innerHTML || '');
  const pickBtns = () => libPanelEl().querySelectorAll('.lib-pick-btn');
  const r = /<button class="mod-tab[^"]*\bactive\b[^"]*"[\s\S]*?>([^<]*)(?:<span[\s\S]*?<\/span>)?<\/button>/.exec(panelHtml());
  const name = r ? r[1].replace(/\s*↻\d+°\s*$/, '').trim() : '';
  const model = () => sandbox.__lastModel;
  const sideOf = (m, mod, side) => (m.partsRaw || []).filter((q) => q.module === mod && q.kind === 'side'
    && q.name.indexOf(side === 'left' ? 'лев' : 'прав') >= 0)[0];
  const snap = (m) => (m.partsRaw || []).filter((q) => !(q.module === name && q.kind === 'side' && q.name.indexOf('лев') >= 0))
    .map((q) => [q.module, q.name, q.material, q.thickness].join('|')).sort().join('\n');
  const outer = (m) => {
    const l = sideOf(m, name, 'left'), rr = sideOf(m, name, 'right');
    return l && rr ? (rr.box.x + rr.box.w / 2) - (l.box.x - l.box.w / 2) : NaN;
  };
  const mdf = Object.values(cat.FACADE_MATERIALS).filter((m) => /мдф/i.test((m.categoryPath || [])[0])
    && eng.partMaterialOptions('side').some((o) => o.code === m.code))[0];
  let before = null, left0 = null;
  check('фокус/деталь: вход в редактор левой боковины', () => {
    if (!v || !name || !mdf || typeof v.onIsolateModule !== 'function') return false;
    v.onIsolateModule(name);
    before = model();
    left0 = before && sideOf(before, name, 'left');
    if (!left0) return false;
    v.onSelectPart({ module: name, kind: 'side', side: 'left', partKey: left0.grainKey || null, clientX: 10, clientY: 10 });
    const menu = document.getElementById('focusMenu');
    const item = menu && menu.querySelector('[data-i="0"]');
    if (!item) return false;
    item.click();
    return /Боковина левая/.test(panelHtml()) && /id="partMaterial" data-mat-pick="part"/.test(panelHtml());
  });
  check('фокус/деталь: «Выбрать» только у листов для боковины, без стекла', () => {
    const b = document.getElementById('partMaterial');
    if (!b) return false;
    b.click();
    const allowed = eng.partMaterialOptions('side').map((o) => o.code);
    const btns = pickBtns();
    return btns.length > 0 && btns.every((x) => allowed.indexOf(x.attrs['data-pick-code']) !== -1)
      && !allowed.some((c) => /^GLASS|^FAC-ALU|^FAC-WOOD/.test(c));
  });
  check('фокус/деталь: МДФ-панель — только на левую боковину, толщина из каталога, ширина модуля та же', () => {
    const top = libPanelEl().querySelectorAll('[data-tree-node]').filter((x) => x.dataset.kind === 'top' && x.dataset.top === 'sheet')[0];
    if (top) libPanelEl().dispatch('click', { target: top });
    const leaf = libPanelEl().querySelectorAll('[data-tree-node]').filter((x) => x.dataset.kind === 'leaf'
      && x.dataset.top === 'sheet' && x.dataset.path === mdf.categoryPath.join('::'))[0];
    if (!leaf) return false;
    libPanelEl().dispatch('click', { target: leaf });
    const pb = pickBtns().filter((x) => x.attrs['data-pick-code'] === mdf.code)[0];
    if (!pb) return false;
    libPanelEl().dispatch('click', { target: pb });
    const after = model();
    const l = sideOf(after, name, 'left');
    return !!l && l.material === mdf.code && l.thickness === Number(mdf.thickness) && l.box.w === Number(mdf.thickness)
      && snap(after) === snap(before)
      && Math.abs(outer(after) - outer(before)) < 0.11
      && new RegExp(`id="partMaterial" data-mat-pick="part" data-code="${mdf.code}"`).test(panelHtml())
      && /Сбросить к материалу модуля/.test(panelHtml())
      && JSON.stringify(sandbox.Modul3D.specification.buildSpecification(after).sheetMaterials).indexOf(mdf.code) !== -1;
  });
  check('фокус/деталь: «Сбросить к материалу модуля» возвращает боковину', () => {
    const b = document.getElementById('partMaterialReset');
    if (!b) return false;
    b.click();
    const l = sideOf(model(), name, 'left');
    return !!l && l.material === left0.material && l.thickness === left0.thickness && snap(model()) === snap(before)
      && !/partMaterialReset/.test(panelHtml());
  });
  // Задняя стенка: в «Выбрать» только BACK_MATERIALS — лист ЛДСП/МДФ 16–19 мм
  // в паз под стенку не входит (engine.partMaterialOptions('back')).
  check('фокус/деталь: у задней стенки «Выбрать» только у BACK_MATERIALS', () => {
    const backCodes = (cat.BACK_MATERIALS || []).map((m) => m.code);
    const opts = eng.partMaterialOptions('back').map((o) => o.code);
    if (!opts.length || !opts.every((c) => backCodes.indexOf(c) !== -1)) return false;
    if (opts.some((c) => (cat.DECORS || []).some((d) => d.code === c && backCodes.indexOf(c) === -1))) return false;
    const back0 = (model().partsRaw || []).filter((q) => q.module === name && q.kind === 'back')[0];
    if (!v || !back0) return false;
    v.onSelectPart({ module: name, kind: 'back', side: null, partKey: back0.grainKey || null, clientX: 10, clientY: 10 });
    const menu = document.getElementById('focusMenu');
    const item = menu && menu.querySelector('[data-i="0"]');
    if (!item) return false;
    item.click();
    const b = document.getElementById('partMaterial');
    if (!b || !/Задняя стенка/.test(panelHtml())) return false;
    b.click();
    const btns = pickBtns();
    const ok = btns.length > 0 && btns.every((x) => opts.indexOf(x.attrs['data-pick-code']) !== -1);
    // Подбор не оставляем висеть (дальше по прогону Библиотека нужна обычной):
    // выбираем прежний материал стенки и сбрасываем правку детали.
    const same = btns.filter((x) => x.attrs['data-pick-code'] === back0.material)[0] || btns[0];
    if (same) libPanelEl().dispatch('click', { target: same });
    const rb = document.getElementById('partMaterialReset');
    if (rb) rb.click();
    const b1 = (model().partsRaw || []).filter((q) => q.module === name && q.kind === 'back')[0];
    return ok && !!b1 && b1.material === back0.material && b1.thickness === back0.thickness;
  });
  // Библиотеку — обратно на «Базу модулей» (дальше по прогону её ждут там).
  const modTab = Array.from(document.querySelectorAll('.lib-tab-btn')).filter((b) => b.dataset.libtab === 'modules')[0];
  const libTabs = document.getElementById('libTabs');
  if (libTabs && modTab) libTabs.dispatch('click', { target: modTab });
  // Выход из фокуса — пунктом «Выйти из фокуса» (exitFocusMode).
  if (v && name && left0) {
    v.onSelectPart({ module: name, kind: 'side', side: 'left', partKey: left0.grainKey || null, clientX: 10, clientY: 10 });
    const menu = document.getElementById('focusMenu');
    const item = menu && menu.querySelector('[data-i="1"]');
    if (item) item.click();
  }
})();
for (const el of document.querySelectorAll('.tab-btn')) {
  check('вкладка: ' + (el.dataset.tab || el.id), () => { el.click(); return true; });
}


// --- отдельный прогон: файл из src не загрузился ---------------------------
// Приложение обязано показать, ЧТО именно не загрузилось, а не молчать
// пустым окном (так выглядел запуск index.html прямо из архива).
(function missingModuleScenario() {
  const reg2 = new Map();
  const sandbox2 = Object.assign({}, sandbox, {
    console: { log: () => {}, warn: () => {}, error: () => {} },
  });
  // отдельный контекст с урезанным набором модулей
  const box = { html: '', title: '' };
  const doc2 = {
    title: '',
    body: { appendChild: () => {}, addEventListener: () => {} },
    getElementById: (id) => (id === 'paramsPanel'
      ? { set innerHTML(v) { box.html = v; }, get innerHTML() { return box.html; } }
      : { textContent: '', addEventListener: () => {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
          querySelectorAll: () => [], innerHTML: '' }),
    querySelectorAll: () => [], querySelector: () => null,
    createElement: () => ({ innerHTML: '', style: {}, querySelectorAll: () => [], addEventListener: () => {} }),
    addEventListener: () => {},
  };
  const s2 = {
    document: doc2, console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout, clearTimeout, requestAnimationFrame: () => 0,
    addEventListener: () => {}, XLSX: {},
  };
  s2.window = s2; s2.globalThis = s2;
  vm.createContext(s2);
  // грузим всё, КРОМЕ presets.js
  for (const f of SRC_ORDER.filter((x) => x !== 'presets.js')) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'), s2, { filename: f });
  }
  s2.Modul3D.viewer = { Viewer3D: class { render() {} setView() {} } };
  try {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8'), s2, { filename: 'app.js' });
  } catch (e) {
    fails.push('без одного файла приложение падает без объяснения: ' + e.message);
    return;
  }
  check('версия выводится даже при сбое загрузки', () => /^Modul3D v\d+/.test(doc2.title));
  check('сообщение называет недостающий файл', () => /src\/presets\.js/.test(box.html));
  check('сообщение подсказывает распаковать архив', () => /распаку/i.test(box.html));
})();

// Версия в адресах скриптов обязана совпадать с APP_VERSION: иначе браузер
// отдаст закешированный старый файл, и правки «не работают» у пользователя.
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ver = /const APP_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8'));
  const tags = html.match(/(?:src="src\/[\w.-]+\.js|href="style\.css)(\?[\w.-]+)?"/g) || [];
  const bad = tags.filter((t) => t.indexOf('?' + (ver ? ver[1] : 'x') + '"') === -1);
  if (bad.length) {
    fails.push(`сброс кеша: ${bad.length} тег(ов) без ?${ver ? ver[1] : '??'} — браузер отдаст старый файл`);
  }
}

// Пресет «Нижний угловой под мойку» должен доехать до модели ЧЕРЕЗ приложение:
// поля topType/noBack легко потерять по дороге (панель → state → recompute).
{
  // чистим проект, чтобы в деталировке остался ТОЛЬКО модуль под мойку
  let guard = 60;
  while (document.querySelectorAll('.mod-tab').length && guard-- > 0) {
    const d = document.getElementById('delModule');
    if (!d) break;
    d.click();
  }
  const kitchen = modGroupRow('kitchen');
  if (!kitchen) fails.push('база модулей: нет категории «Кухонный модуль»');
  else {
    // Категория раскрывается ИНЛАЙН в #libraryPanel — без плавающего
    // #moduleMenu, см. app.js libraryBlock/bindLibraryEvents.
    toggleModGroup(kitchen);
    const item = modGridItems('kitchen').filter((b) => b.dataset.preset === 'cornerSink')[0];
    if (!item) fails.push('база модулей: нет варианта «под мойку»');
    else {
      item.click();
      const tabs = docsTab('detailing').innerHTML;
      if (/Задняя стенка/.test(tabs)) {
        fails.push('под мойку: в деталировке осталась задняя стенка');
      }
      if (!/Планка верхняя передняя[\s\S]{0,400}?НА РЕБРО/.test(tabs)
        && !/НА РЕБРО/.test(tabs)) {
        fails.push('под мойку: планки не встали на ребро (нет отметки в деталировке)');
      }
    }
    toggleModGroup(kitchen);                      // закрыть категорию за собой
  }
}

// Кухонный пресет должен ставить белый корпус 18, ящики из белого 16, а декор
// пользователя переносить на фасад.
{
  const kitchen = modGroupRow('kitchen');
  if (kitchen) {
    let guard = 60;
    while (document.querySelectorAll('.mod-tab').length && guard-- > 0) {
      const d = document.getElementById('delModule');
      if (!d) break;
      d.click();
    }
    // Удаление последнего модуля = проект начат заново: ручной выбор корпуса
    // из ранних проверок первую кухню уже не защищает.
    toggleModGroup(kitchen);
    const item = modGridItems('kitchen').filter((b) => b.dataset.preset === 'lower600drawers')[0];
    if (!item) fails.push('кухня: нет пресета lower600drawers в Библиотеке');
    if (item) {
      item.click();
      // Код «белого» декора не хардкодим (раньше тут был /U702|бел/i под
      // конкретный код — сломалось, когда U702ST9 переименовали в «Серый
      // кашемир», реальный белый декор внезапно оказался под другим кодом:
      // H3450ST22 «Флитвуд белый»). Берём ту же логику, что и app.js
      // (см. «Первый кухонный модуль...» — DECORS.filter(/бел/i.test(name))[0]),
      // чтобы тест не рассыпался при следующей смене каталога.
      const whiteDecor = sandbox.Modul3D.catalog.defaultKitchenCarcassDecor();
      const isWhite = (v) => !!whiteDecor && String(v || '') === whiteDecor.code;
      // Материалы корпуса/фасада — экран «Материалы» (см. #materialsLinkBtn).
      const mb = document.getElementById('materialsLinkBtn');
      if (mb) mb.click();
      const body = document.getElementById('p-decor');
      const facade = document.getElementById('p-facadeDecor');
      // Поля — плашки (не <select>): выбранный код — в data-code.
      if (!isWhite(body && body.dataset.code)) fails.push('кухня: корпус не стал белым');
      if (facade && isWhite(facade.dataset.code)) fails.push('кухня: видимая боковина тоже побелела');
      const facadeMat = document.getElementById('p-facadeMat');
      if (facadeMat && isWhite(facadeMat.dataset.code)) fails.push('кухня: материал фасада тоже побелел');
      const back = document.getElementById('panelBack');
      if (back) back.click();
      // Материал ящиков — поле СЕКЦИИ на экране «Ящики» (#drawersDecor,
      // были общими на проект — см. drawersPanelBlock).
      const openBtn = document.getElementById('sectionsList').querySelectorAll('[data-drawers-open]')[0];
      if (openBtn) {
        openBtn.click();
        // Материал ящиков кухни — по умолчанию из каталога
        // (catalog.defaultKitchenDrawerDecor, с 2026-10-10 «8681 SM Белый
        // бриллиант» 16): в панели пункт «По умолчанию», в модели ящики из него.
        // Название листа в тесте не зашито — каталог пользователь правит.
        const drawer = document.getElementById('drawersDecor');
        if (!drawer || drawer.value) fails.push('кухня: материал ящиков не «По умолчанию»');
        const kd = sandbox.Modul3D.catalog.defaultKitchenDrawerDecor();
        if (!kd) fails.push('кухня: нет материала ящиков по умолчанию');
        const lm = sandbox.__lastModel;
        const dm = ((lm && (lm.partsRaw || lm.parts)) || []).filter((q) => /ящика/.test(q.name || '') && /Боковина|Задняя/.test(q.name || ''));
        if (!dm.length || !kd || !dm.every((q) => q.material === kd.code)) fails.push('кухня: ящики не из материала по умолчанию');
      }
    }
    toggleModGroup(kitchen);
  }
}

// Кухня и шкаф в ОДНОМ проекте: корпус кухни — белый, шкафа — дуб (каждый модуль
// со своим корпусом, решение владельца 2026-10-10). Названия листов не зашиты —
// берём умолчания каталога.
{
  const kitchen = modGroupRow('kitchen');
  const wardrobe = modGroupRow('wardrobe');
  if (kitchen && wardrobe) {
    let guard = 60;
    while (document.querySelectorAll('.mod-tab').length && guard-- > 0) {
      const d = document.getElementById('delModule');
      if (!d) break;
      d.click();
    }
    const cat = sandbox.Modul3D.catalog;
    toggleModGroup(kitchen);
    const k = modGridItems('kitchen').filter((b) => b.dataset.preset === 'lower600drawers')[0];
    if (k) k.click();
    toggleModGroup(kitchen);
    toggleModGroup(wardrobe);
    const w = modGridItems('wardrobe').filter((b) => b.dataset.preset === 'hallway')[0];
    if (!k || !w) fails.push('кухня+шкаф: нет карточек для проверки');
    else {
      w.click();
      const sides = ((sandbox.__lastModel && (sandbox.__lastModel.partsRaw || sandbox.__lastModel.parts)) || [])
        .filter((q) => q.kind === 'side' && q.moduleUid);
      const uids = [];
      sides.forEach((q) => { if (uids.indexOf(q.moduleUid) < 0) uids.push(q.moduleUid); });
      const matOf = (uid) => sides.filter((q) => q.moduleUid === uid).map((q) => q.material);
      const white = cat.defaultKitchenCarcassDecor().code, wood = cat.defaultDecor().code;
      if (uids.length !== 2) fails.push(`кухня+шкаф: ожидалось 2 модуля с боковинами, найдено ${uids.length}`);
      else {
        // у кухни видимая боковина — дуб, поэтому смотрим на ВНУТРЕННИЕ детали: дно
        const bottoms = ((sandbox.__lastModel.partsRaw || sandbox.__lastModel.parts) || []).filter((q) => q.kind === 'bottom' && q.moduleUid);
        const bm = (uid) => (bottoms.filter((q) => q.moduleUid === uid)[0] || {}).material;
        if (bm(uids[0]) !== white) fails.push('кухня+шкаф: корпус кухни не белый');
        if (bm(uids[1]) !== wood) fails.push('кухня+шкаф: корпус шкафа не из дуба по умолчанию');
      }
    }
    toggleModGroup(wardrobe);
  }
}

// Режим проверки присадки: кнопка есть, включается и строит легенду
{
  const btn = document.getElementById('drillCheckBtn');
  if (!btn) fails.push('нет кнопки «Проверка присадки»');
  else {
    btn.click();
    const legend = document.getElementById('drillLegend');
    if (!legend) fails.push('проверка присадки: не появилась легенда');
    else if (!/Присадка/.test(legend.innerHTML)) fails.push('легенда присадки пустая');
    else {
      // В легенде обязаны быть диаметр и глубина каждого режима сверления
      if (!/Ø\d/.test(legend.innerHTML)) fails.push('легенда: нет диаметров сверления');
      if (!/глуб\.|насквозь/.test(legend.innerHTML)) fails.push('легенда: нет глубины сверления');
      if (!/с лица|с изнанки|в торец|снизу|сверху/.test(legend.innerHTML)) {
        fails.push('легенда: не указана сторона сверления');
      }
    }
    btn.click();                       // выключаем обратно
    const gone = document.getElementById('drillLegend');
    if (gone && gone.innerHTML) fails.push('легенда присадки не убирается');
  }
}

// Выбор модуля кликом по 3D: деталь собирается из слоёв внутри группы,
// поэтому луч обязан идти рекурсивно, а имя модуля — искаться по родителям.
{
  const src = fs.readFileSync(path.join(ROOT, 'src', 'viewer.js'), 'utf8');
  if (/intersectObjects\((?:[^)]*), false\)/.test(src)) {
    fails.push('3D-выбор: луч не рекурсивный — по слоям детали не попасть');
  }
  if (src.indexOf('for (let o = obj; o; o = o.parent)') === -1) {
    fails.push('3D-выбор: имя модуля не ищется вверх по родителям');
  }
}

// Документы внизу: 3D во весь экран, вкладка раскрывается по клику и
// сворачивается повторным кликом.
{
  const box = document.querySelector('.results');
  const btn = Array.from(document.querySelectorAll('.tab-btn'))
    .filter((b) => b.dataset.tab === 'drawings')[0];
  if (!box || !btn) fails.push('вкладки документов не найдены');
  else {
    // К этому месту прогон уже кликал по всем вкладкам, поэтому состояние
    // приводим к свёрнутому явно и дальше проверяем именно поведение.
    const active = Array.from(document.querySelectorAll('.tab-btn'))
      .filter((b) => b.classList.contains('active'))[0];
    if (box.classList.contains('open') && active) active.click();
    if (box.classList.contains('open')) fails.push('панель документов не сворачивается');
    btn.click();
    if (!box.classList.contains('open')) fails.push('клик по вкладке не раскрыл документы');
    const panel = document.getElementById('tab-drawings');
    if (panel && !panel.classList.contains('active')) fails.push('панель чертежей не стала активной');
    btn.click();
    if (box.classList.contains('open')) fails.push('повторный клик не свернул документы');
    // Деталировка и спецификация раскрываются так же, как чертежи, и их
    // содержимое не должно быть скрыто инлайновым display:none.
    for (const tab of ['detailing', 'spec', 'drawings']) {
      const b = Array.from(document.querySelectorAll('.tab-btn'))
        .filter((x) => x.dataset.tab === tab)[0];
      if (!b) { fails.push(`нет вкладки «${tab}»`); continue; }
      b.click();
      if (!box.classList.contains('open')) fails.push(`вкладка «${tab}» не раскрыла документы`);
      const panel = document.getElementById('tab-' + tab);
      if (!panel) { fails.push(`нет панели «${tab}»`); continue; }
      if (!panel.classList.contains('active')) fails.push(`панель «${tab}» не активна`);
      if (panel.style && panel.style.display === 'none') {
        fails.push(`панель «${tab}» скрыта инлайновым стилем`);
      }
      if (!String(panel.innerHTML || '').trim()) fails.push(`панель «${tab}» пустая`);
    }
    // и в разметке не должно остаться инлайнового display у панелей
    if (/id="tab-(detailing|spec)"[^>]*display:\s*none/.test(
      fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'))) {
      fails.push('в разметке у панелей остался display:none');
    }
  }
}

// Документы строятся ЛЕНИВО (app.js: docsTabsDirty/ensureTabBuilt): при
// восьми модулях один SVG чертежей весит под 200 КБ, и собирать его на
// каждое изменение параметра, пока вкладка свёрнута, — заметная задержка на
// телефоне. Здесь намеренно читаем $('tab-drawings') НАПРЯМУЮ, а не через
// docsTab(): помощник собрал бы вкладку сам и проверять было бы нечего.
{
  const box = document.querySelector('.results');
  const h = document.getElementById('m-height');
  const drawBtn = Array.from(document.querySelectorAll('.tab-btn'))
    .filter((b) => b.dataset.tab === 'drawings')[0];
  if (!box || !h || !drawBtn) fails.push('ленивые вкладки: нет поля высоты или вкладки чертежей');
  else {
    const restore = String(h.value);
    const bump = (d) => {
      const el = document.getElementById('m-height');
      el.value = String(Number(el.value) + d);
      el.dispatch('change', { target: el });
    };
    const active = Array.from(document.querySelectorAll('.tab-btn'))
      .filter((b) => b.classList.contains('active'))[0];
    if (box.classList.contains('open') && active) active.click();   // свернули
    const collapsed = String($('tab-drawings').innerHTML || '');
    bump(40);
    if (String($('tab-drawings').innerHTML || '') !== collapsed) {
      fails.push('свёрнутая вкладка чертежей перестраивается на каждый пересчёт');
    }
    drawBtn.click();                                                // раскрыли
    const opened = String($('tab-drawings').innerHTML || '');
    if (opened === collapsed) fails.push('вкладка чертежей не собралась при открытии');
    bump(40);
    if (String($('tab-drawings').innerHTML || '') === opened) {
      fails.push('открытая вкладка чертежей не обновилась после смены габарита');
    }
    // Возвращаем проект в прежний вид и сворачиваем документы: дальше идут
    // проверки, рассчитанные на исходные размеры.
    const el = document.getElementById('m-height');
    el.value = restore;
    el.dispatch('change', { target: el });
    drawBtn.click();
  }
}

// Панель «Документы» на компьютере: настраиваемая высота и отступ для 3D
// (ui-shell.js, раздел 7б′) и масштаб чертежей (раздел 7в). Прогон без
// браузера — проверяем логику и разметку, а не пиксели: границы высоты,
// запоминание доли окна, двойной щелчок, событие modul3d:drawer-inset, клавиши
// +/−, Ctrl+колесо (вокруг курсора), обёртку масштаба, сохранение масштаба при
// перерисовке, то, что печать чертежей от масштаба не зависит, и вписывание
// чертежа по ширине на телефоне (авто-режим, щипок, двойной тап, поворот,
// переход через 820px). Ряда с ползунком и кнопками −/+ больше нет.
{
  const shell = sandbox.Modul3D.uiShell;
  const insetEvents = [];
  // Заглушки окна: CustomEvent/dispatchEvent в песочнице нет — ставим свои и
  // убираем в конце, чтобы остальные проверки шли в прежней среде.
  sandbox.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } };
  sandbox.dispatchEvent = (ev) => { if (ev && ev.type === 'modul3d:drawer-inset') insetEvents.push(ev.detail.bottom); return true; };
  const lastInset = () => insetEvents[insetEvents.length - 1];
  const key = (ev) => document.dispatch('keydown', Object.assign({ target: document.body }, ev));
  const tabBtn = (name) => Array.from(document.querySelectorAll('.tab-btn')).filter((b) => b.dataset.tab === name)[0];
  const stored = {};
  const origSet = sandbox.localStorage.setItem, origRemove = sandbox.localStorage.removeItem;
  sandbox.localStorage.setItem = (k, v) => { stored[k] = String(v); };
  sandbox.localStorage.removeItem = (k) => { delete stored[k]; };

  // --- разметка ---
  check('разметка: ручка высоты «Документов» есть', () => !!document.getElementById('docsResize'));
  check('разметка: ряда масштаба (ползунок, −/+, процент) больше нет ни в HTML, ни в CSS', () => {
    const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
    return !document.getElementById('dwZoomBar') && !document.getElementById('dwZoomRange')
      && !document.getElementById('dwZoomPct') && !document.getElementById('dwZoomOut')
      && !document.getElementById('dwZoomIn')
      && !/dwZoom(Bar|Range|Pct|In|Out)|dw-zoombar|data-docs-tab/.test(INDEX)
      && !/dw-zoombar|dw-zoom-(btn|range|pct)|data-docs-tab/.test(css);
  });
  check('разметка: в горячих клавишах есть «+ / −»', () =>
    /hotkeys-key">\+ \/ [−-]<\/span><span class="hotkeys-desc">Масштаб чертежей/.test(INDEX));
  check('разметка: в горячих клавишах есть Ctrl+колесо и щипок', () =>
    /hotkeys-key">Ctrl\+колесо<\/span><span class="hotkeys-desc">Масштаб чертежей/.test(INDEX)
    && /hotkeys-key">Щипок<\/span><span class="hotkeys-desc">Масштаб чертежей/.test(INDEX));
  check('разметка: двойной клик — стандартный вид, на телефоне по ширине', () =>
    /hotkeys-key">2× клик<\/span><span class="hotkeys-desc">[^<]*по ширине/.test(INDEX));

  // --- высота панели «Документы» на компьютере ---
  check('компьютер: левая панель не закрывает низ 3D', () => shell.getDrawerInset() === 0);
  shell.openDrawer('docs');
  const hDefault = shell.getDocsHeight();
  check('компьютер: высота по умолчанию min(62vh, 560px)', () =>
    hDefault === Math.min(Math.round(900 * 0.62), 560));
  check('компьютер: «Документы» → отступ для 3D не меньше высоты панели', () =>
    shell.getDrawerInset() >= hDefault && lastInset() === shell.getDrawerInset());
  // рейка всегда слева снизу (с v361 положение не настраивается); у открытых
  // панелей она поднимается в их верхнюю строку (data-rail-up)
  check('компьютер: у «Документов» рейка в верхней строке панели (data-rail-up="docs")', () =>
    document.documentElement.getAttribute('data-rail-up') === 'docs');
  shell.openDrawer('library');
  check('компьютер: боковая панель — рейка над ней (data-rail-up="side")', () =>
    document.documentElement.getAttribute('data-rail-up') === 'side');
  shell.openDrawer('docs');

  const grip = {
    _l: {},
    closest(s) { return s === '#docsResize' ? this : null; },
    setPointerCapture() {}, releasePointerCapture() {},
    addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
    removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter((x) => x !== f); },
    fire(t, e) { (this._l[t] || []).slice().forEach((f) => f(e)); },
  };
  const drag = (dy) => {
    document.dispatch('pointerdown', { target: grip, button: 0, pointerId: 7, pointerType: 'mouse', isPrimary: true, clientY: 500 });
    grip.fire('pointermove', { pointerId: 7, buttons: 1, clientY: 500 - dy });
    grip.fire('pointerup', { pointerId: 7 });
  };
  drag(100);
  check('высота «Документов»: тянем вверх — выше на столько же', () => shell.getDocsHeight() === hDefault + 100);
  check('высота «Документов»: итоговое событие отступа после жеста', () =>
    lastInset() === shell.getDrawerInset() && lastInset() >= hDefault + 100);
  check('высота «Документов» запоминается долей окна (modul3d.docsH)', () =>
    Math.abs(parseFloat(stored['modul3d.docsH']) - (hDefault + 100) / 900) < 0.002);
  drag(5000);
  check('высота «Документов»: не выше 90% окна', () => shell.getDocsHeight() === Math.round(900 * 0.9));
  drag(-5000);
  check('высота «Документов»: не ниже 25% окна', () => shell.getDocsHeight() === Math.round(900 * 0.25));
  document.dispatch('dblclick', { target: grip });
  check('двойной щелчок по ручке — высота по умолчанию', () => shell.getDocsHeight() === hDefault);
  check('после сброса ключ modul3d.docsH снят (по умолчанию)', () => stored['modul3d.docsH'] === undefined);
  check('после сброса отступ для 3D соответствует высоте', () => lastInset() === shell.getDrawerInset());
  shell.openDrawer('params');
  check('компьютер: сменили панель на левую — отступ 0', () => shell.getDrawerInset() === 0 && lastInset() === 0);
  shell.openDrawer('docs');
  shell.closeDrawer('docs');
  check('компьютер: «Документы» закрыты — отступ 0', () => shell.getDrawerInset() === 0 && lastInset() === 0);

  // --- масштаб чертежей: компьютер ---
  const pane = $('tab-drawings');
  // Ctrl+колесо приходит на область чертежей (#tab-drawings), как в браузере;
  // spy.prevented — сколько раз погасили родное действие браузера (зум страницы).
  const wheel = (ev) => {
    const spy = { prevented: 0 };
    pane.dispatch('wheel', Object.assign({
      deltaY: 0, deltaMode: 0, ctrlKey: true, clientX: 300, clientY: 200,
      preventDefault() { spy.prevented++; },
    }, ev));
    return spy;
  };
  // Касание — pointer events с pointerType 'touch', как у настоящего браузера.
  const touch = (type, id, x, y) => pane.dispatch(type, {
    pointerType: 'touch', pointerId: id, isPrimary: id === 1, clientX: x, clientY: y,
  });
  shell.openDrawer('docs');
  tabBtn('detailing').click();
  tabBtn('drawings').click();          // вкладка «Чертежи» активна и раскрыта
  check('масштаб чертежей: старт 100%', () => shell.getDrawingsZoom() === 100);
  check('чертежи лежат в обёртке масштаба', () => {
    const html = String(docsTab('drawings').innerHTML || '');
    return /id="dwZoom"/.test(html) && /id="dwSheet"/.test(html) && /Габарит проекта/.test(html);
  });
  key({ key: '+', code: 'Equal', shiftKey: true });
  check('клавиша «+» — 110%', () => shell.getDrawingsZoom() === 110);
  check('масштаб 110% выставлен на обёртку и лист', () =>
    $('dwZoom').style.width === '110%' && /^scale\(1\.1\)$/.test($('dwSheet').style.transform || ''));
  key({ key: '-', code: 'Minus' });
  check('клавиша «−» — снова 100%', () => shell.getDrawingsZoom() === 100);
  check('при 100% inline-стили обёртки сняты', () =>
    $('dwZoom').style.width === '' && $('dwSheet').style.transform === '');
  key({ key: '-', code: 'NumpadSubtract' });
  check('NumpadSubtract — 90%', () => shell.getDrawingsZoom() === 90);
  key({ key: '+', code: 'Equal', ctrlKey: true });
  key({ key: '+', code: 'NumpadAdd', metaKey: true });
  key({ key: '+', code: 'NumpadAdd', altKey: true });
  check('Ctrl/Meta/Alt + «+» масштаб не трогают (остаётся зум браузера)', () => shell.getDrawingsZoom() === 90);
  key({ key: '+', code: 'NumpadAdd', target: { tagName: 'INPUT', id: 'm-width' } });
  key({ key: '-', code: 'Minus', target: { tagName: 'TEXTAREA', id: 'x' } });
  key({ key: '+', code: 'NumpadAdd', target: { tagName: 'DIV', id: 'x', isContentEditable: true } });
  check('в полях ввода/contenteditable клавиши ± масштаб не трогают', () => shell.getDrawingsZoom() === 90);
  key({ key: '+', code: 'NumpadAdd', target: { tagName: 'BUTTON', id: 'x' } });
  check('на кнопке (не поле ввода) клавиша «+» работает', () => shell.getDrawingsZoom() === 100);

  shell.setDrawingsZoom(150);
  check('setDrawingsZoom(150): обёртка и лист', () => shell.getDrawingsZoom() === 150
    && $('dwZoom').style.width === '150%' && /^scale\(1\.5\)$/.test($('dwSheet').style.transform || ''));
  key({ key: '+', code: 'NumpadAdd' });
  check('клавиша «+»: шаг 10 п.п.', () => shell.getDrawingsZoom() === 160);
  key({ key: '-', code: 'Minus' });
  key({ key: '-', code: 'Minus' });
  check('клавиша «−»: шаг 10 п.п.', () => shell.getDrawingsZoom() === 140);
  shell.setDrawingsZoom(9999);
  key({ key: '+', code: 'NumpadAdd' });
  check('верхняя граница 400%', () => shell.getDrawingsZoom() === 400);
  shell.setDrawingsZoom(1);
  key({ key: '-', code: 'Minus' });
  check('нижняя граница на компьютере 25%', () => shell.getDrawingsZoom() === 25);
  for (let i = 0; i < 8; i++) key({ key: '+', code: 'NumpadAdd' });
  check('из 25% восемь «+» ровно в 100% (шаг по круглым значениям)', () => shell.getDrawingsZoom() === 100);

  // --- Ctrl + колесо мыши ---
  check('колесо БЕЗ Ctrl масштаб не трогает и не перехватывается', () => {
    const s = wheel({ ctrlKey: false, deltaY: -100 });
    return s.prevented === 0 && shell.getDrawingsZoom() === 100;
  });
  check('Ctrl+колесо вверх: щелчок = ×1.1 (110%), зум страницы гасится', () => {
    const s = wheel({ deltaY: -100 });
    return s.prevented === 1 && shell.getDrawingsZoom() === 110;
  });
  check('Ctrl+колесо вниз: обратно 100%, inline-стили сняты', () => {
    const s = wheel({ deltaY: 100 });
    return s.prevented === 1 && shell.getDrawingsZoom() === 100
      && $('dwZoom').style.width === '' && $('dwSheet').style.transform === '';
  });
  check('Ctrl+колесо в строках (deltaMode 1, 3 строки = щелчок): 110%', () => {
    wheel({ deltaY: -3, deltaMode: 1 });
    return shell.getDrawingsZoom() === 110;
  });
  shell.setDrawingsZoom(100);
  check('тачпад: малое deltaY — плавно, доля щелчка (−10 → 101%)', () => {
    wheel({ deltaY: -10 });
    return shell.getDrawingsZoom() === 101;
  });
  check('Ctrl+колесо с deltaY 0: масштаб на месте, зум страницы всё равно гасится', () => {
    const z = shell.getDrawingsZoom();
    const s = wheel({ deltaY: 0 });
    return s.prevented === 1 && shell.getDrawingsZoom() === z;
  });
  shell.setDrawingsZoom(100);
  check('одно событие колеса — не больше 3 щелчков (нет скачка)', () => {
    wheel({ deltaY: -100000 });
    return shell.getDrawingsZoom() === 133;
  });
  for (let i = 0; i < 40; i++) wheel({ deltaY: -100 });
  check('Ctrl+колесо: верхняя граница 400%', () => shell.getDrawingsZoom() === 400);
  for (let i = 0; i < 80; i++) wheel({ deltaY: 100 });
  check('Ctrl+колесо: нижняя граница 25%', () => shell.getDrawingsZoom() === 25);
  shell.setDrawingsZoom(100);

  // Масштаб вокруг курсора: точка листа под курсором остаётся на месте.
  // Раскладку браузера подменяем моделью: область — в (100,50) размером 800×500,
  // лист в ней с отступом (16,12), сдвинутый прокруткой; масштаб — из transform.
  {
    const origRect = El.prototype.getBoundingClientRect;
    Object.assign(pane, { offsetWidth: 800, clientWidth: 800, clientHeight: 500, scrollLeft: 0, scrollTop: 0 });
    El.prototype.getBoundingClientRect = function () {
      if (this.id === 'tab-drawings') return { left: 100, top: 50, width: 800, height: 500, right: 900, bottom: 550 };
      if (this.id === 'dwSheet') {
        const m = /scale\(([\d.]+)\)/.exec(this.style.transform || '');
        const s = m ? parseFloat(m[1]) : 1;
        const l = 100 + 16 - (pane.scrollLeft || 0), t = 50 + 12 - (pane.scrollTop || 0);
        return { left: l, top: t, width: 768 * s, height: 1000 * s, right: l + 768 * s, bottom: t + 1000 * s };
      }
      return origRect.call(this);
    };
    try {
      const under = (x, y) => {   // какая точка листа (в единицах листа) сейчас под точкой окна (x, y)
        const r = $('dwSheet').getBoundingClientRect();
        const s = shell.getDrawingsZoom() / 100;
        return { x: (x - r.left) / s, y: (y - r.top) / s };
      };
      const near = (a, b) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
      const p1 = under(300, 200);
      wheel({ deltaY: -100, clientX: 300, clientY: 200 });
      check('Ctrl+колесо вверх: точка под курсором остаётся на месте', () => shell.getDrawingsZoom() === 110 && near(p1, under(300, 200)));
      const p2 = under(640, 90);
      wheel({ deltaY: 100, clientX: 640, clientY: 90 });
      check('Ctrl+колесо вниз: точка под курсором остаётся на месте', () => shell.getDrawingsZoom() === 100 && near(p2, under(640, 90)));
    } finally {
      El.prototype.getBoundingClientRect = origRect;
      ['offsetWidth', 'clientWidth', 'clientHeight', 'scrollLeft', 'scrollTop'].forEach((k) => { delete pane[k]; });
    }
  }

  // Перерисовка чертежей (правка габарита) масштаб не сбрасывает.
  shell.setDrawingsZoom(150);
  const hEl = document.getElementById('m-height');
  if (!hEl) fails.push('масштаб чертежей: нет поля высоты для проверки перерисовки');
  else {
    const hRestore = String(hEl.value);
    const before = String($('tab-drawings').innerHTML || '');
    hEl.value = String(Number(hEl.value) + 40);
    hEl.dispatch('change', { target: hEl });
    check('перерисовка чертежей: разметка обновилась, масштаб 150% на месте', () =>
      String($('tab-drawings').innerHTML || '') !== before && shell.getDrawingsZoom() === 150
      && $('dwZoom').style.width === '150%' && /^scale\(1\.5\)$/.test($('dwSheet').style.transform || ''));
    hEl.value = hRestore;
    hEl.dispatch('change', { target: hEl });
  }

  // Печать чертежей — всегда стандартный вид, без обёртки масштаба.
  {
    let printed = '';
    sandbox.open = () => ({ document: { write: (h) => { printed += h; }, close() {} }, focus() {}, print() {} });
    document.getElementById('printDrawings').click();
    delete sandbox.open;
    check('печать чертежей при масштабе 150%: те же чертежи', () => /Габарит проекта/.test(printed) && /<svg/.test(printed));
    check('печать чертежей: без обёртки масштаба', () =>
      !/dw-zoom|dwSheet|dwZoom|dw-sheet/.test(printed));
  }

  // Вне вкладки «Чертежи» и при закрытых «Документах» клавиши ± ничего не делают.
  tabBtn('detailing').click();
  key({ key: '+', code: 'NumpadAdd' });
  check('на вкладке «Деталировка» клавиша «+» масштаб чертежей не трогает', () => shell.getDrawingsZoom() === 150);
  shell.closeDrawer('docs');
  key({ key: '-', code: 'Minus' });
  check('при закрытых «Документах» клавиша «−» масштаб не трогает', () => shell.getDrawingsZoom() === 150);
  shell.resetDrawingsZoom();
  check('сброс масштаба на компьютере — 100%', () => shell.getDrawingsZoom() === 100
    && $('dwZoom').style.width === '' && $('dwSheet').style.transform === '');
  {
    // двойной щелчок мышью по чертежам — тот же сброс (на компьютере 100%)
    Object.assign(pane, { clientWidth: 800, clientHeight: 500 });
    try {
      shell.setDrawingsZoom(200);
      pane.dispatch('dblclick', { clientX: 10, clientY: 10 });
      check('двойной щелчок по чертежам на компьютере — 100%', () => shell.getDrawingsZoom() === 100);
    } finally {
      delete pane.clientWidth; delete pane.clientHeight;
    }
  }

  // --- масштаб чертежей: телефон (окно ≤ 820px) — чертёж вписывается по ширине ---
  // Окружение подменяем на время блока и в finally возвращаем: media-запрос
  // (820px), ширину области и отступы, ширину самого широкого чертежа
  // (scrollWidth листа), ResizeObserver и кадры анимации.
  shell.openDrawer('docs');
  tabBtn('drawings').click();
  {
    let phone = false;               // сейчас «телефон»?
    let natural = 800;               // ширина листа вместе с выпирающими чертежами (scrollWidth)
    let roCb = null;                 // колбэк ResizeObserver листа
    const origRaf = sandbox.requestAnimationFrame;
    const rafQ = [];
    const areaW = (client) => client - 32;                       // минус отступы 16+16
    const fitOf = (n, w) => (n <= w + 1 ? 1 : Math.floor(w / n * 1000) / 1000);
    const tf = () => {                                           // масштаб листа из его transform
      const m = /scale\(([\d.]+)\)/.exec($('dwSheet').style.transform || '');
      return m ? parseFloat(m[1]) : 1;
    };
    const redraw = (n) => {                                      // чертежи перерисовали, ширина стала n
      natural = n;
      shell.setDrawingsContent('<div class="dw-block">чертёж</div>');
    };
    // «Размер листа изменился»: колбэк ResizeObserver → кадр → пересчёт.
    const fire = () => {
      sandbox.requestAnimationFrame = (f) => { rafQ.push(f); return rafQ.length; };
      try { if (roCb) roCb([]); } finally { sandbox.requestAnimationFrame = origRaf; }
      rafQ.splice(0).forEach((f) => f());
    };
    sandbox.matchMedia = (q) => ({ matches: phone && /max-width:\s*820px/.test(q) });
    sandbox.getComputedStyle = () => ({ paddingLeft: '16px', paddingRight: '16px' });
    sandbox.ResizeObserver = class { constructor(cb) { roCb = cb; } observe() {} disconnect() {} };
    Object.defineProperty(El.prototype, 'scrollWidth', {
      configurable: true, get() { return this.id === 'dwSheet' ? natural : undefined; },
    });
    Object.assign(pane, { clientWidth: 375, clientHeight: 500 });
    const hEl2 = document.getElementById('m-height');
    const h2Restore = hEl2 ? String(hEl2.value) : '';
    try {
      const W = areaW(375);          // 343
      // Вход в раскладку телефона — через настоящую перерисовку (app.js →
      // renderDrawings → setDrawingsContent), а не прямым вызовом.
      phone = true; natural = 800;
      if (!hEl2) fails.push('телефон: нет поля высоты для проверки перерисовки');
      else {
        hEl2.value = String(Number(hEl2.value) + 40);
        hEl2.dispatch('change', { target: hEl2 });
      }
      check('телефон: ResizeObserver листа создан', () => typeof roCb === 'function');
      check('телефон: чертёж при появлении вписан по ширине', () =>
        tf() === fitOf(800, W) && shell.getDrawingsZoom() === Math.round(fitOf(800, W) * 100));
      check('телефон: правый край чертежа не выходит за область, прокрутка по X в начале', () =>
        tf() * 800 <= W + 1e-6 && !(pane.scrollLeft > 0) && !(pane.scrollTop > 0));
      redraw(1000);
      check('телефон: перерисовка с более широким чертежом пересчитывает вписывание', () => tf() === fitOf(1000, W));
      redraw(300);
      check('телефон: всё помещается — 100%, inline-стили сняты', () =>
        shell.getDrawingsZoom() === 100 && $('dwZoom').style.width === '' && $('dwSheet').style.transform === '');
      redraw(3000);
      check('телефон: очень широкий чертёж — масштаб ниже 25%', () =>
        tf() === fitOf(3000, W) && shell.getDrawingsZoom() < 25);
      shell.setDrawingsZoom(1);
      check('телефон: нижняя граница — «по ширине», а не 25%', () => tf() === fitOf(3000, W));
      shell.setDrawingsZoom(9999);
      check('телефон: верхняя граница 400%', () => shell.getDrawingsZoom() === 400);
      redraw(2000);
      check('телефон: ручной масштаб при перерисовке не «прыгает» (даже если сам ушёл к 400%)', () => shell.getDrawingsZoom() === 400);

      // Сброс возвращает режим «авто».
      shell.resetDrawingsZoom();
      check('телефон: сброс — «по ширине», прокрутка в начале', () =>
        tf() === fitOf(2000, W) && !(pane.scrollLeft > 0) && !(pane.scrollTop > 0));
      redraw(1000);
      check('телефон: после сброса режим «авто» снова следует за шириной чертежа', () => tf() === fitOf(1000, W));

      // Щипок при «по ширине» ниже 25%: без скачка к 25% при первом касании.
      redraw(3000);
      const fit3 = fitOf(3000, W);
      touch('pointerdown', 1, 100, 300);
      touch('pointerdown', 2, 200, 300);
      touch('pointermove', 1, 100, 300);
      check('щипок при «по ширине» <25%: первое касание не подбрасывает к 25%', () => tf() === fit3 && shell.getDrawingsZoom() < 25);
      redraw(1000);
      check('касание без смены расстояния режим «авто» не выключает', () => tf() === fitOf(1000, W));
      redraw(3000);
      touch('pointermove', 2, 300, 300);             // разводим пальцы: расстояние ×2
      check('щипок разводит: масштаб растёт вдвое', () => Math.abs(tf() - fit3 * 2) < 0.0006);
      touch('pointermove', 2, 150, 300);             // сводим сильнее, чем можно
      check('щипок сводит: ниже «по ширине» не опускается', () => tf() === fit3);
      touch('pointerup', 2, 150, 300);
      touch('pointerup', 1, 100, 300);
      redraw(1000);                                  // «авто» дало бы 34%, а после щипка масштаб ручной
      check('после щипка масштаб ручной: перерисовка его не трогает', () => tf() === fit3);

      // Двойной тап — вернуть «по ширине» и режим «авто».
      touch('pointerdown', 1, 50, 60); touch('pointerup', 1, 50, 60);
      touch('pointerdown', 1, 52, 62); touch('pointerup', 1, 52, 62);
      check('двойной тап на телефоне — «по ширине»', () => tf() === fitOf(1000, W) && !(pane.scrollTop > 0));
      redraw(2500);
      check('после двойного тапа режим «авто» снова включён', () => tf() === fitOf(2500, W));

      // Клавиши +/− и Ctrl+колесо тоже выключают «авто».
      key({ key: '+', code: 'NumpadAdd' });
      const afterKey = shell.getDrawingsZoom();
      redraw(1200);
      check('клавиша «+» на телефоне выключает «авто»', () => afterKey > Math.round(fitOf(2500, W) * 100) && shell.getDrawingsZoom() === afterKey);
      pane.dispatch('dblclick', { clientX: 10, clientY: 10 });
      check('двойной щелчок мышью на телефоне — «по ширине»', () => tf() === fitOf(1200, W));
      wheel({ deltaY: -100 });
      const afterWheel = shell.getDrawingsZoom();
      redraw(900);
      check('Ctrl+колесо на телефоне выключает «авто»', () => afterWheel > Math.round(fitOf(1200, W) * 100) && shell.getDrawingsZoom() === afterWheel);
      shell.resetDrawingsZoom();

      // Смена ширины области (поворот экрана) пересчитывает «по ширине».
      redraw(1000);
      pane.clientWidth = 812;                        // альбомная ориентация
      fire();
      check('телефон: поворот экрана — «по ширине» пересчитано под новую ширину', () => tf() === fitOf(1000, areaW(812)));
      shell.setDrawingsZoom(200);
      pane.clientWidth = 375;
      fire();
      check('ручной масштаб при повороте экрана не трогаем', () => shell.getDrawingsZoom() === 200);
      shell.resetDrawingsZoom();

      // Граница 820px: компьютер → 100% и ничего не вписывается; обратно — снова «по ширине».
      shell.setDrawingsZoom(200);
      phone = false;
      fire();
      check('переход на компьютер (>820px): масштаб 100%', () => shell.getDrawingsZoom() === 100 && $('dwSheet').style.transform === '');
      redraw(3000);
      check('компьютер: широкий чертёж автоматически НЕ вписывается', () => shell.getDrawingsZoom() === 100);
      shell.setDrawingsZoom(200);
      phone = true;
      fire();
      check('переход на телефон (≤820px): «по ширине», ручной масштаб прошлой раскладки сброшен', () => tf() === fitOf(3000, W));

      // Страховка от цикла: если ширина «прыгает» при каждом вписывании
      // (полоса прокрутки то есть, то нет), масштаб не дёргается бесконечно.
      let flips = 0, lastZ = shell.getDrawingsZoom();
      for (let i = 0; i < 12; i++) {
        pane.clientWidth = i % 2 ? 375 : 812;
        fire();
        if (shell.getDrawingsZoom() !== lastZ) { flips++; lastZ = shell.getDrawingsZoom(); }
      }
      check('страховка: смены масштаба от смены раскладки не бесконечны', () => flips <= 4);
    } finally {
      if (hEl2) { hEl2.value = h2Restore; hEl2.dispatch('change', { target: hEl2 }); }
      phone = false;
      delete sandbox.matchMedia;
      delete sandbox.getComputedStyle;
      delete sandbox.ResizeObserver;
      sandbox.requestAnimationFrame = origRaf;
      delete El.prototype.scrollWidth;
      delete pane.clientWidth; delete pane.clientHeight;
      shell.resetDrawingsZoom();
    }
    check('после блока телефона: стандартный вид 100%', () => shell.getDrawingsZoom() === 100);
  }

  // --- ручная разметка чертежа общего вида (src/markup.js, v317) ---
  {
    const mk = sandbox.Modul3D.markup;
    const mkTools = document.getElementById('markupTools');
    const mkBtn = document.getElementById('markupToggle');
    const mkClr = document.getElementById('markupClear');
    const mkRange = document.getElementById('markupFontRange');
    const resBox = document.querySelector('.results');
    // Клик по уже активной раскрытой вкладке её сворачивает — открываем наверняка.
    const showTab = (n) => { tabBtn(n).click(); if (!resBox.classList.contains('open')) tabBtn(n).click(); };
    check('разметка чертежа: кнопки «Разметка», «Очистить всё» и ползунок шрифта есть',
      () => !!(mk && mkTools && mkBtn && mkClr && mkRange));
    if (mk && mkTools && mkBtn && mkClr) {
      showTab('detailing');
      check('разметка чертежа: кнопки скрыты не на вкладке «Чертежи»', () => mkTools.style.display === 'none');
      showTab('drawings');
      check('разметка чертежа: кнопки видны на вкладке «Чертежи»', () => mkTools.style.display !== 'none');
      check('разметка чертежа: «Очистить всё» скрыта, пока режим выключен', () => mkClr.style.display === 'none');
      mkBtn.click();
      check('разметка чертежа: кнопка включает режим и подсвечивается',
        () => mk.isActive() && mkBtn.classList.contains('active') && mkClr.style.display !== 'none');
      mkBtn.click();
      check('разметка чертежа: повторный клик выключает режим', () => !mk.isActive() && !mkBtn.classList.contains('active'));
      mkBtn.click();
      showTab('detailing');
      check('разметка чертежа: переход на другую вкладку выключает режим',
        () => !mk.isActive() && !mkBtn.classList.contains('active'));
    }
    // Разметка в 3D: кнопка на панели режимов вида, только в плоских видах.
    const vtMk = document.getElementById('vtMarkupBtn');
    const app3 = sandbox.Modul3D.app;
    check('разметка в 3D: кнопка #vtMarkupBtn есть', () => !!vtMk);
    if (mk && vtMk && app3 && typeof app3.setView === 'function') {
      app3.setView('iso');
      check('разметка в 3D: в перспективе кнопка недоступна', () => vtMk.disabled === true);
      app3.setView('front');
      check('разметка в 3D: в плоском виде кнопка доступна', () => vtMk.disabled === false);
      showTab('detailing');
      vtMk.click();
      check('разметка в 3D: кнопка включает режим без вкладки «Чертежи»',
        () => mk.isActive() && vtMk.classList.contains('active'));
      app3.setView('top');
      check('разметка в 3D: смена плоского вида режим не гасит', () => mk.isActive());
      // Источник включения: режим живёт по контексту СВОЕЙ кнопки.
      showTab('drawings');
      mkBtn.click();
      check('разметка: кнопка чертежей при режиме из 3D не гасит его, а привязывает к чертежам',
        () => mk.isActive() && mkBtn.classList.contains('active') && !vtMk.classList.contains('active'));
      tabBtn('drawings').click();   // клик по активной раскрытой вкладке — свернуть «Документы»
      check('разметка: режим с чертежей гаснет при закрытии «Документов» даже в плоском 3D-виде',
        () => !resBox.classList.contains('open') && !mk.isActive() && !vtMk.classList.contains('active'));
      showTab('drawings');
      mkBtn.click();
      vtMk.click();
      check('разметка: #vtMarkupBtn при режиме с чертежей переключает источник на 3D',
        () => mk.isActive() && vtMk.classList.contains('active'));
      tabBtn('drawings').click();
      check('разметка: режим из 3D переживает закрытие «Документов»',
        () => !resBox.classList.contains('open') && mk.isActive() && vtMk.classList.contains('active'));
      app3.setView('iso');
      check('разметка в 3D: переход в перспективу гасит режим',
        () => !mk.isActive() && vtMk.disabled === true && !vtMk.classList.contains('active'));
      check('разметка в 3D: у ядра есть refreshSheet для внешнего листа',
        () => typeof mk.refreshSheet === 'function');
    }
    if (mk && mkRange) {
      mkRange.value = '30';
      mkRange.dispatch('input', { target: mkRange });
      check('разметка чертежа: шрифт ограничен 24 px и запоминается',
        () => mk.getFontScale() === 24 && stored['modul3d.markupFont'] === '24');
      mkRange.value = '10';
      mkRange.dispatch('input', { target: mkRange });
      check('разметка чертежа: шрифт возвращается к 10 px', () => mk.getFontScale() === 10);
    }
    if (mk) {
      mk.setFontScale(99);
      check('разметка чертежа: setFontScale ограничен сверху 24 px', () => mk.getFontScale() === 24);
      mk.setFontScale(10);
      const anc = (key) => ({ moduleUid: 'mA', key, kind: 'corner', local: { h: -1, v: 1 } });
      let threw = null;
      try {
        mk.setData([null, 5, 'x', { view: 'front' }, { id: 1, view: 'front', a: { partId: 3, kind: 'corner', local: {} }, b: anc('b') },
          { id: 2, view: 'front', a: anc('a'), b: anc('b'), dir: 1, level: 1 },
          { id: 2, view: 'front', a: anc('a'), b: anc('c'), dir: -1, level: 2 },
          { view: 'side', a: anc('a'), b: anc('d'), level: 'мусор' }]);
      } catch (e) { threw = e; }
      const got = threw ? [] : mk.getData();
      const ids = got.map((d) => d.id);
      check('разметка чертежа: setData терпит мусор и перенумеровывает дубли id',
        () => !threw && got.length === 3 && new Set(ids).size === 3 && ids.every((i) => i > 0));
      check('разметка чертежа: запись без листа относится к общему виду, свой лист сохраняется',
        () => !threw && got.every((d) => d.sheet === 'overview')
          && (mk.setData([{ id: 1, sheet: 'module:mA', view: 'side', a: anc('a'), b: anc('b'), orient: 'v', offset: 12 }]),
            mk.getData()[0].sheet === 'module:mA' && mk.getData()[0].offset === 12));
      check('разметка чертежа: API листов для drawings.js есть',
        () => typeof mk.beginSheets === 'function' && typeof mk.attachSheet === 'function');
      mk.setData([]);
    }
  }

  tabBtn('detailing').click();
  shell.closeDrawer('docs');

  // Возвращаем среду прогона.
  delete sandbox.CustomEvent;
  delete sandbox.dispatchEvent;
  sandbox.localStorage.setItem = origSet;
  sandbox.localStorage.removeItem = origRemove;
}

// Паспорт системы ящиков виден в спецификации и предупреждает о
// неподтверждённых размерах.
{
  const spec = docsTab('spec');
  const html = spec ? String(spec.innerHTML || '') : '';
  if (!/Паспорт системы ящиков/.test(html)) fails.push('в спецификации нет паспорта системы');
  if (!/Источник размеров/.test(html)) fails.push('в паспорте нет источника размеров');
  if (!/passport-warn|passport-ok/.test(html)) {
    fails.push('в паспорте нет отметки о подтверждённости размеров');
  }
}

// Панель «Библиотека» → вкладка «Фурнитура». Раньше прогон Библиотеку не
// открывал вовсе: любая ошибка ВРЕМЕНИ ВЫПОЛНЕНИЯ при рендере её вкладок
// (вызов удалённой функции, обращение к полю не того типа) доходила до
// пользователя при зелёном check.sh — ровно так уехала недоделанная правка
// «единица цены своя у каждой корневой категории» (2026-09-16).
{
  const tabs = document.getElementById('libTabs');
  const hwTab = Array.from(document.querySelectorAll('.lib-tab-btn'))
    .filter((b) => b.dataset.libtab === 'hardware')[0];
  const lib = document.getElementById('libraryPanel');
  // Ошибка рендера вкладки — это не «упал прогон», а обычный провал проверки
  // с понятным текстом: иначе на месте аккуратного списка провалов оказался
  // бы стектрейс, а остальные проверки вообще не отработали бы.
  const step = (name, fn) => {
    try { fn(); return true; } catch (e) { fails.push(name + ': ' + e.message); return false; }
  };
  if (!tabs || !hwTab || !lib) fails.push('Библиотека: не найдена вкладка «Фурнитура»');
  // target = сама кнопка вкладки: обработчик делегированный
  // (e.target.closest('.lib-tab-btn'), см. app.js initLibraryPanel).
  else if (step('Фурнитура: вкладка не открывается', () => tabs.dispatch('click', { target: hwTab }))) {
    // Заголовка <h3>Фурнитура</h3> под вкладками больше нет (v314) — признак
    // отрисовки вкладки: кнопка «+ Добавить по ссылке» (libLinkTopBarHtml('hardware')).
    if (!/data-link-kind="hardware"/.test(String(lib.innerHTML || ''))) {
      fails.push('Фурнитура: вкладка не отрисовалась');
    }
    // Лист дерева — клик по нему открывает таблицу позиций этой ветки
    // (state.libActiveLeaf, см. libTopCategoryHtml).
    const leaf = lib.querySelectorAll('[data-tree-node]')
      .filter((r) => r.dataset.kind === 'leaf' && String(r.dataset.top || '').indexOf('hw:') === 0)[0];
    if (!leaf) fails.push('Фурнитура: в дереве нет ни одного листа с позициями');
    else step('Фурнитура: таблица листа не открывается', () => lib.dispatch('click', { target: leaf }));
    // Перетаскивание узлов дерева (app.js: libTreeDragPointerDown и соседние,
    // v281). Само перетаскивание в прогоне не воспроизвести — у стенда нет ни
    // координат указателя, ни elementFromPoint, — но вход в него проверить
    // надо: pointerdown на строке дерева должен лишь ЗАПОМНИТЬ кандидата
    // (перетаскивание начинается позже — по сдвигу мыши или удержанию
    // пальцем), а pointerup без сдвига — снять его, ничего не меняя. Ровно так
    // выглядит обычный клик по строке, и если обработчик сломан (опечатка в
    // имени функции, обращение к несуществующему полю), дерево перестанет
    // открываться вообще.
    if (leaf) {
      step('Дерево: pointerdown на строке узла', () => lib.dispatch('pointerdown', { target: leaf }));
      step('Дерево: pointerup после pointerdown', () => document.dispatch('pointerup', {}));
    }

    const SEL_RE = /<select class="lib-price-unit-select lib-hw-price-unit-select"[^>]*>[\s\S]*?<\/select>/g;
    const parseSel = (s) => ({
      top: (/data-top="([^"]+)"/.exec(s) || [])[1],
      picked: (/<option value="([^"]*)"\s*selected/.exec(s) || [])[1],
      units: (s.match(/<option value="([^"]*)"/g) || []).map((x) => /value="([^"]*)"/.exec(x)[1]),
    });
    const html = String(lib.innerHTML || '');
    if (!/<table class="lib-table"/.test(html)) fails.push('Фурнитура: таблица позиций не отрисовалась');
    // Набор колонок тот же, что у «Материалов» со свёрнутыми характеристиками:
    // Наименование / Образец / Цена — три, не больше (колонка «Ед. изм.»
    // распирала таблицу шире панели и убрана, единица правится в ячейке цены).
    const colgroups = html.match(/<colgroup>[\s\S]*?<\/colgroup>/g) || [];
    if (!colgroups.length) fails.push('Фурнитура: у таблицы нет colgroup');
    // /<col(\s|>)/ — именно сами <col>, без открывающего <colgroup>, который
    // тоже начинается с «<col».
    if (colgroups.some((g) => (g.match(/<col(?:\s|>)/g) || []).length !== 3)) {
      fails.push('Фурнитура: в таблице не 3 колонки');
    }
    if (/Ед\. изм\./.test(html)) fails.push('Фурнитура: в таблице снова колонка «Ед. изм.»');
    const selects = (html.match(SEL_RE) || []).map(parseSel);
    if (!selects.length) fails.push('Фурнитура: в шапке «Цена» нет переключателя единицы');
    if (selects.some((s) => !s.top || s.top.indexOf('hw:') !== 0)) {
      fails.push('Фурнитура: у переключателя единицы нет data-top с корневой категорией');
    }
    // Выбранная единица — СВОЯ у каждой корневой категории (state.libHwPriceUnit
    // — объект по topCode): выбор в одной таблице не должен менять соседнюю.
    const mineSel = selects[0];
    const otherSel = selects.filter((s) => s.top !== (mineSel || {}).top)[0];
    const pick = mineSel ? mineSel.units.filter((u) => u !== 'native')[0] : null;
    const selEl = mineSel && lib.querySelectorAll('.lib-hw-price-unit-select')
      .filter((x) => x.attrs['data-top'] === mineSel.top)[0];
    if (pick && selEl) {
      selEl.value = pick;
      step('Фурнитура: переключатель единицы цены', () => lib.dispatch('change', { target: selEl }));
      const after = (String(lib.innerHTML || '').match(SEL_RE) || []).map(parseSel);
      const mineNow = after.filter((s) => s.top === mineSel.top)[0];
      if (!mineNow || mineNow.picked !== pick) fails.push('Фурнитура: выбранная единица цены не сохранилась');
      if (otherSel) {
        const otherNow = after.filter((s) => s.top === otherSel.top)[0];
        if (otherNow && otherNow.picked !== 'native') {
          fails.push('Фурнитура: единица цены протекла в соседнюю категорию');
        }
      }
    }
  }
}

// Библиотека → «Материалы»: единица цены в шапке таблицы — СВОЯ у каждой
// таблицы (v339, state.libPriceUnit по charsKey, data-table-key на select).
{
  const tabs = document.getElementById('libTabs');
  const matTab = Array.from(document.querySelectorAll('.lib-tab-btn'))
    .filter((b) => b.dataset.libtab === 'materials')[0];
  const lib = document.getElementById('libraryPanel');
  try {
    if (tabs && matTab && lib) {
      tabs.dispatch('click', { target: matTab });
      lib.querySelectorAll('[data-tree-node]')
        .filter((r) => r.dataset.kind === 'leaf')
        .slice(0, 2)
        .forEach((leaf) => lib.dispatch('click', { target: leaf }));
      const selRe = /<select class="lib-price-unit-select" data-table-key="([^"]*)">[\s\S]*?<\/select>/g;
      const read = () => {
        const out = {};
        let m;
        const h = String(lib.innerHTML || '');
        while ((m = selRe.exec(h))) out[m[1]] = (/<option value="([^"]*)"\s*selected/.exec(m[0]) || [])[1];
        return out;
      };
      const before = read();
      const keys = Object.keys(before);
      if (keys.length) {
        const el = lib.querySelectorAll('.lib-price-unit-select').filter((x) => x.attrs['data-table-key'] === keys[0])[0];
        el.value = 'perMeter';
        lib.dispatch('change', { target: el });
        const after = read();
        if (after[keys[0]] !== 'perMeter') fails.push('Материалы: единица цены не сохранилась для своей таблицы');
        keys.slice(1).forEach((k) => {
          if (after[k] !== before[k]) fails.push('Материалы: единица цены протекла в соседнюю таблицу');
        });
        console.log('  (материалы: таблиц с переключателем ' + keys.length + ')');
      }
    }
  } catch (e) { fails.push('Материалы: единица цены по таблицам: ' + e.message); }
}

// Библиотека → «Двери» → «Алюминиевые фасады» (v311, app.js:
// libAluFacadesHtml): заголовок раздела раскрывает четыре таблицы.
{
  const tabs = document.getElementById('libTabs');
  const facTab = Array.from(document.querySelectorAll('.lib-tab-btn'))
    .filter((b) => b.dataset.libtab === 'facades')[0];
  const lib = document.getElementById('libraryPanel');
  try {
    if (!tabs || !facTab || !lib) fails.push('Библиотека: не найдена вкладка «Двери»');
    else {
      tabs.dispatch('click', { target: facTab });
      const head = lib.querySelectorAll('[data-alu-lib-toggle]')[0];
      if (!head) fails.push('Двери: нет раздела «Алюминиевые фасады»');
      else {
        // Раздел мог остаться раскрытым после проверок конструктора фасада
        // (плашка секции раскрывает его сама) — щёлкаем, только если свёрнут.
        if (String(lib.innerHTML || '').indexOf('lib-alu-body') < 0) lib.dispatch('click', { target: head });
        const html = String(lib.innerHTML || '');
        if (html.indexOf('Конструктор фасада') < 0 || html.indexOf('Конструктор фасада') > html.indexOf('Профили'))
          fails.push('Алюминиевые фасады: нет «Конструктора фасада» над таблицами');
        ['Профили', 'Цвета профиля', 'Комплектующие и работа', 'Производители готовых фасадов'].forEach((t) => {
          if (html.indexOf(t) < 0) fails.push('Алюминиевые фасады: нет таблицы «' + t + '»');
        });
        if (!/data-alu-edit="profile"/.test(html)) fails.push('Алюминиевые фасады: цена профиля не редактируется');
        if (!/class="alu-schema alu-sec alu-schema-sm/.test(html)) fails.push('Алюминиевые фасады: нет чертежа сечения профиля');
        if (!/data-alu-img="pick"/.test(html)) fails.push('Алюминиевые фасады: нет кнопки «Загрузить чертёж» сечения');
      }
    }
  } catch (e) { fails.push('Двери / Алюминиевые фасады: ' + e.message); }
  // Дальше прогон проверяет вкладку «Фурнитура» — возвращаемся на неё.
  const hwBack = Array.from(document.querySelectorAll('.lib-tab-btn'))
    .filter((b) => b.dataset.libtab === 'hardware')[0];
  if (tabs && hwBack) tabs.dispatch('click', { target: hwBack });
}

// Перетаскивание подкатегории на новое место среди соседей (app.js v281:
// libTreeDragPointerDown → libTreeDragBegin → libDragResolveTarget →
// libDragApplyDrop → libPlaceChildAt/state.libNodeOrder). Проверяем самое
// ценное и самое хрупкое — что порядок реально меняется и переживает
// перерисовку панели.
// Стенду для этого нужны две вещи, которых у него нет по умолчанию:
// elementFromPoint (какая строка сейчас под указателем) и токен входа
// (правка каталога гостям запрещена, см. requireLibraryEditAuth) — оба
// подменяем только на время этой проверки и возвращаем как было.
{
  const lib = document.getElementById('libraryPanel');
  const step = (name, fn) => {
    try { fn(); return true; } catch (e) { fails.push(name + ': ' + e.message); return false; }
  };
  const treeRows = () => (lib ? lib.querySelectorAll('[data-tree-node]') : []);
  // Ищем двух соседей одного родителя: перетаскиваем первого под второго.
  // «Без бренда» в пару не берём — его порядок всё равно прибит к концу
  // списка (см. libChildSegments), перетаскивание такую цель не предлагает.
  const byParent = {};
  treeRows().forEach((r) => {
    const kind = r.dataset.kind;
    if (kind !== 'leaf' && kind !== 'branch') return;
    const pathStr = r.dataset.path || '';
    if (!pathStr) return;
    const segs = pathStr.split('::');
    if (segs[segs.length - 1].toLowerCase() === 'без бренда') return;
    const key = (r.dataset.top || '') + '|' + segs.slice(0, -1).join('::');
    (byParent[key] = byParent[key] || []).push(r);
  });
  const pair = Object.keys(byParent).map((k) => byParent[k]).filter((l) => l.length >= 2)[0];
  if (!pair) fails.push('Дерево: не нашлось двух соседних подкатегорий — порядок проверить не на чем');
  else {
    // Двигаем ВТОРОГО соседа относительно первого: так любой из двух бросков
    // обязан реально поменять порядок, и проверка не проходит «сама собой».
    const movedPath = pair[1].dataset.path;
    const refPath = pair[0].dataset.path;
    const savedGetItem = sandbox.localStorage.getItem;
    sandbox.localStorage.getItem = () => 'smoke-token';   // гостю правку каталога не дают
    // Строка стенда по умолчанию «высотой» 600 px — целиться в такую
    // бессмысленно: зоны броска считаются от РЕАЛЬНОЙ высоты строки (см.
    // libDragRowZone в app.js), а на экране это ~28 px. Подставляем именно
    // её, чтобы прогон бил туда же, куда рука, и краснел, если зоны снова
    // станут неприцеливаемыми (на четвертях от 28 px на «встать рядом»
    // приходилось по 7 px, и мышью в них было не попасть — v281).
    const ROW_TOP = 100;
    const ROW_H = 28;
    const rowRect = { left: 0, top: ROW_TOP, right: 900, bottom: ROW_TOP + ROW_H, width: 900, height: ROW_H };
    const rowByPath = (p) => treeRows().filter((r) => (r.dataset.path || '') === p)[0];
    // Одно перетаскивание: тянем узел fromPath на строку toPath и отпускаем
    // на высоте ratio (доля высоты строки: 0.2 — верхняя зона «встать
    // ПЕРЕД», 0.8 — нижняя «встать ПОСЛЕ», середина — «вложить внутрь»).
    const dragOnto = (fromPath, toPath, ratio, label) => {
      const from = rowByPath(fromPath);
      const to = rowByPath(toPath);
      if (!from || !to) { fails.push('Дерево: не найдена строка для перетаскивания (' + label + ')'); return; }
      from.getBoundingClientRect = () => rowRect;
      to.getBoundingClientRect = () => rowRect;
      document.elementFromPoint = () => to;
      const y = ROW_TOP + Math.round(ROW_H * ratio);
      step('Дерево: pointerdown (' + label + ')', () => lib.dispatch('pointerdown', { target: from, clientX: 10, clientY: ROW_TOP + 14 }));
      step('Дерево: pointermove (' + label + ')', () => document.dispatch('pointermove', { clientX: 40, clientY: y }));
      step('Дерево: бросок (' + label + ')', () => document.dispatch('pointerup', { clientX: 40, clientY: y }));
      delete document.elementFromPoint;
    };
    const posOf = (p) => treeRows().map((r) => r.dataset.path || '').indexOf(p);
    // Целимся в 30 % и 70 % высоты строки — это заведомо внутри нынешних
    // краевых зон (40 %), но заведомо ВНЕ прежних четвертей: если зоны
    // когда-нибудь снова ужмут до 25 %, обе проверки покраснеют, а не
    // продолжат проходить на границе. И это честная точка прицеливания: на
    // строке 28 px это 8 px от края, попасть мышью можно.
    dragOnto(movedPath, refPath, 0.3, 'встать перед соседом');
    if (posOf(movedPath) < 0 || posOf(refPath) < 0) {
      fails.push('Дерево: бросок в верхнюю зону строки увёл узел из списка (вложил внутрь вместо перестановки?)');
    } else if (posOf(movedPath) > posOf(refPath)) {
      fails.push('Дерево: бросок в верхнюю зону строки не поставил узел перед соседом');
    }
    // 70 % высоты той же строки — НИЖНЯЯ зона: тот же узел уезжает ПОСЛЕ
    // соседа. Вместе с проверкой выше это значит, что обе краевые зоны
    // реально достижимы на строке обычной высоты.
    dragOnto(movedPath, refPath, 0.7, 'встать после соседа');
    if (posOf(movedPath) < 0 || posOf(refPath) < 0) {
      fails.push('Дерево: бросок в нижнюю зону строки увёл узел из списка (вложил внутрь вместо перестановки?)');
    } else if (posOf(movedPath) < posOf(refPath)) {
      fails.push('Дерево: бросок в нижнюю зону строки не поставил узел после соседа');
    }
    // УДЕРЖАНИЕ БЕЗ ДВИЖЕНИЯ (v281): зажал строку, подождал — и она сразу
    // «взята»: под курсором «призрак», источник приглушён. Раньше визуал
    // появлялся только с первым pointermove, и пользователь не понимал, когда
    // уже можно вести. Прогон синхронный, ждать реальные 400 мс нечем —
    // подменяем setTimeout в песочнице, ловим отложенный старт и дёргаем его
    // сами; заодно это проверяет, что таймер вообще ставится (иначе мышью
    // жест начинался бы только от смещения).
    const ghostCount = () => document.body.children
      .filter((c) => String(c.className || '').indexOf('lib-drag-ghost') >= 0).length;
    const holdRow = rowByPath(movedPath);
    if (!holdRow) fails.push('Дерево: нет строки для проверки удержания');
    else {
      // Холостой клик «в пустое место» панели: он снимает подавление клика,
      // оставшееся от предыдущих бросков в этом же прогоне (флаг гасится
      // первым же кликом, см. libDragClickGuard). Без него проверка ниже
      // «клик после удержания ничего не сделал» прошла бы по чужой причине —
      // из-за старого флага, а не из-за нового жеста.
      lib.dispatch('click', { target: lib });
      holdRow.getBoundingClientRect = () => rowRect;
      document.elementFromPoint = () => holdRow;   // указатель стоит на самой взятой строке
      const realSetTimeout = sandbox.setTimeout;
      let heldStart = null;
      sandbox.setTimeout = (fn, ms) => {
        if (heldStart === null) { heldStart = fn; return 1; }
        return realSetTimeout(fn, ms);
      };
      step('Дерево: pointerdown под удержание', () => lib.dispatch('pointerdown', { target: holdRow, clientX: 10, clientY: ROW_TOP + 14 }));
      sandbox.setTimeout = realSetTimeout;
      if (!heldStart) {
        fails.push('Дерево: pointerdown не ставит таймер удержания — мышью жест начнётся только от движения');
      } else {
        step('Дерево: старт жеста по удержанию', () => heldStart());   // как будто прошло 400 мс
        if (!ghostCount()) fails.push('Дерево: после удержания нет «призрака» — строка не выглядит взятой до первого движения');
        if (!holdRow.classList.contains('lib-drag-src')) fails.push('Дерево: после удержания строка-источник не подсвечена');
      }
      // Отпускание без движения после сработавшего удержания — отмена жеста,
      // а НЕ клик по строке: узел раскрываться/сворачиваться не должен.
      const htmlBefore = String(lib.innerHTML || '');
      step('Дерево: отпускание после удержания', () => document.dispatch('pointerup', { clientX: 10, clientY: ROW_TOP + 14 }));
      if (ghostCount()) fails.push('Дерево: «призрак» остался на экране после отпускания');
      step('Дерево: клик следом за отпусканием', () => lib.dispatch('click', { target: holdRow }));
      if (String(lib.innerHTML || '') !== htmlBefore) {
        fails.push('Дерево: отпускание после удержания сработало как обычный клик по узлу');
      }
      delete document.elementFromPoint;
    }

    // Перестановка КОРНЕВЫХ категорий вкладки (v281: строки data-kind="top"
    // — «Петли», «Направляющие», …). Порядок разделов живёт отдельно от
    // дерева (state.libTopOrder, см. libTabTopCodes/libPlaceTopAt), поэтому
    // проверяется отдельным сценарием. Строка раздела размечена так же, как
    // строка подкатегории: КРАЯ — «встать рядом» (проверяются здесь),
    // СЕРЕДИНА — «вложить раздел в раздел» (сценарий вложения ниже).
    const topRows = () => lib.querySelectorAll('[data-tree-node]')
      .filter((r) => r.dataset.kind === 'top');
    const topCodes = topRows().map((r) => r.dataset.top || '');
    if (topCodes.length < 2) fails.push('Библиотека: на вкладке меньше двух корневых категорий — перестановку проверить не на чем');
    else {
      const movedTop = topCodes[1];
      const refTop = topCodes[0];
      const topRowBy = (code) => topRows().filter((r) => (r.dataset.top || '') === code)[0];
      const dragTopOnto = (fromCode, toCode, ratio, label) => {
        const from = topRowBy(fromCode);
        const to = topRowBy(toCode);
        if (!from || !to) { fails.push('Библиотека: не найдена строка раздела (' + label + ')'); return; }
        from.getBoundingClientRect = () => rowRect;
        to.getBoundingClientRect = () => rowRect;
        document.elementFromPoint = () => to;
        const y = ROW_TOP + Math.round(ROW_H * ratio);
        step('Разделы: pointerdown (' + label + ')', () => lib.dispatch('pointerdown', { target: from, clientX: 10, clientY: ROW_TOP + 14 }));
        step('Разделы: pointermove (' + label + ')', () => document.dispatch('pointermove', { clientX: 40, clientY: y }));
        step('Разделы: бросок (' + label + ')', () => document.dispatch('pointerup', { clientX: 40, clientY: y }));
        delete document.elementFromPoint;
      };
      const topPos = (code) => topRows().map((r) => r.dataset.top || '').indexOf(code);
      // Верхняя половина строки — встать ПЕРЕД разделом.
      dragTopOnto(movedTop, refTop, 0.25, 'раздел перед соседним');
      if (topPos(movedTop) < 0 || topPos(refTop) < 0) {
        fails.push('Библиотека: после перестановки раздел пропал со вкладки');
      } else if (topPos(movedTop) > topPos(refTop)) {
        fails.push('Библиотека: бросок в верхнюю краевую зону строки раздела не переставил его выше соседа');
      }
      // Нижняя краевая зона той же строки — ПОСЛЕ неё. Обе краевые зоны
      // должны работать; середина у раздела занята вложением (см. ниже).
      dragTopOnto(movedTop, refTop, 0.75, 'раздел после соседнего');
      if (topPos(movedTop) < 0 || topPos(refTop) < 0) {
        fails.push('Библиотека: после перестановки раздел пропал со вкладки');
      } else if (topPos(movedTop) < topPos(refTop)) {
        fails.push('Библиотека: бросок в нижнюю половину строки раздела не переставил его ниже соседа');
      }
      // Раздел не должен уметь становиться подкатегорией: бросок заголовка
      // на СЕРЕДИНУ строки обычного узла дерева не делает ничего.
      const anyNode = treeRows().filter((r) => r.dataset.kind !== 'top' && (r.dataset.path || ''))[0];
      if (anyNode) {
        const before = topRows().map((r) => r.dataset.top || '').join('|');
        const movedRow = topRowBy(movedTop);
        if (movedRow) {
          movedRow.getBoundingClientRect = () => rowRect;
          anyNode.getBoundingClientRect = () => rowRect;
          document.elementFromPoint = () => anyNode;
          step('Разделы: бросок на узел дерева', () => {
            lib.dispatch('pointerdown', { target: movedRow, clientX: 10, clientY: ROW_TOP + 14 });
            document.dispatch('pointermove', { clientX: 40, clientY: ROW_TOP + 14 });
            document.dispatch('pointerup', { clientX: 40, clientY: ROW_TOP + 14 });
          });
          delete document.elementFromPoint;
          if (topRows().map((r) => r.dataset.top || '').join('|') !== before) {
            fails.push('Библиотека: бросок раздела на узел дерева изменил порядок разделов');
          }
          if (topPos(movedTop) < 0) fails.push('Библиотека: раздел пропал после броска на узел дерева (стал подкатегорией?)');
        }
      }

      // ВЛОЖЕНИЕ РАЗДЕЛА В РАЗДЕЛ (2026-09-18): бросок заголовка на СЕРЕДИНУ
      // другого заголовка делает категорию его подкатегорией — но только на
      // экране (state.libTopParent). Позиции при этом остаются своими:
      // item.category не меняется, иначе перенос был бы необратим.
      const hwItemsWith = (categoryKey) => {
        const cat = sandbox.window.Modul3D.catalog;
        let n = 0;
        [cat.HARDWARE_PRICES, cat.HANDLES, cat.LIFTS, cat.FASTENER_PRICES].forEach((obj) => {
          Object.keys(obj || {}).forEach((k) => { if (obj[k] && obj[k].category === categoryKey) n += 1; });
        });
        return n;
      };
      // Отступ строки раздела: 0 у корневого, больше нуля у вложенного (см.
      // libTreeRowHtml — padding-left по глубине).
      const topPad = (code) => {
        const r = topRowBy(code);
        return r ? Number(String(r.attrs.style || '').replace(/[^0-9]/g, '')) : -1;
      };
      // Вид строки раздела: заголовочный (класс lib-tree-top — крупный жирный
      // акцентный текст) или обычный, как у подкатегории. С 2026-09-18
      // вложенный раздел заголовочного вида не имеет (см. libTreeRowHtml).
      const topIsHeading = (code) => {
        const r = topRowBy(code);
        return !!r && String(r.attrs.class || r.className || '').split(/\s+/).indexOf('lib-tree-top') >= 0;
      };
      // Отступ прямой подкатегории раздела — с ним должен совпадать отступ
      // вложенного в этот раздел другого раздела (оба стоят на одном уровне).
      const subPad = (code) => {
        const r = treeRows().filter((x) => (x.dataset.top || '') === code
          && x.dataset.kind !== 'top' && (x.dataset.path || '').indexOf('::') < 0 && (x.dataset.path || ''))[0];
        return r ? Number(String(r.attrs.style || '').replace(/[^0-9]/g, '')) : -1;
      };
      const nestedKey = String(movedTop).indexOf('hw:') === 0 ? movedTop.slice(3) : '';
      const itemsBefore = nestedKey ? hwItemsWith(nestedKey) : 0;
      // Вкладываем в категорию, у которой ЕСТЬ листья: только на такой можно
      // проверить, что вложенный раздел остаётся виден, когда у родителя
      // открыт лист в фокусе (см. ниже).
      const withLeaf = {};
      treeRows().forEach((r) => {
        if (r.dataset.kind === 'leaf' && (r.dataset.top || '')) withLeaf[r.dataset.top] = true;
      });
      const hostTop = topRows().map((r) => r.dataset.top || '').filter((c) => c !== movedTop && withLeaf[c])[0];
      if (!hostTop) fails.push('Библиотека: не нашлось категории с листьями — вложение проверить не на чем');
      else {
        dragTopOnto(movedTop, hostTop, 0.5, 'вложить раздел в раздел');
        if (topPad(movedTop) <= 0) {
          fails.push('Библиотека: бросок на середину заголовка не вложил раздел в раздел');
        }
        if (topPos(movedTop) < topPos(hostTop)) {
          fails.push('Библиотека: вложенный раздел рисуется не внутри родителя');
        }
        // Вложенный раздел стоит в одном ряду с подкатегориями родителя и
        // читается как одна из них — значит и выглядит как они: обычный текст
        // (без .lib-tree-top) и тот же отступ слева (2026-09-18).
        if (topIsHeading(movedTop)) {
          fails.push('Библиотека: вложенный раздел сохранил вид заголовка (крупный жирный текст)');
        }
        if (subPad(hostTop) >= 0 && topPad(movedTop) !== subPad(hostTop)) {
          fails.push('Библиотека: вложенный раздел стоит не в один ряд с подкатегориями родителя');
        }
        if (nestedKey && hwItemsWith(nestedKey) !== itemsBefore) {
          fails.push('Библиотека: вложение раздела изменило категорию его позиций (должно менять только раскладку)');
        }
        // Фокус на листе РОДИТЕЛЯ прячет его дерево — но не вложенный раздел:
        // иначе в него нельзя было бы попасть, пока фокус не снят, и выглядело
        // бы это как пропажа категории (починено 2026-09-18).
        const hostLeaf = treeRows().filter((r) => r.dataset.kind === 'leaf' && (r.dataset.top || '') === hostTop)[0];
        if (hostLeaf) {
          // Холостой клик «в пустое место»: гасим подавление клика, которое
          // осталось от только что выполненного броска (см. libDragClickGuard),
          // иначе следующий клик по листу будет съеден и фокус не включится —
          // проверка ниже прошла бы по чужой причине.
          lib.dispatch('click', { target: lib });
          step('Библиотека: фокус на листе родителя', () => lib.dispatch('click', { target: hostLeaf }));
          const shown = topRows().filter((r) => (r.dataset.top || '') === movedTop).length;
          if (!shown) fails.push('Библиотека: вложенная категория пропала, пока у родителя открыт лист в фокусе');
          if (shown > 1) fails.push('Библиотека: вложенная категория нарисована дважды');
          // Таблица самого листа при этом никуда не делась.
          if (String(lib.innerHTML || '').indexOf('lib-breadcrumb') < 0) {
            fails.push('Библиотека: при фокусе на листе пропали хлебные крошки');
          }
          // Снимаем фокус кликом по заголовку родителя — дальше проверяем
          // обычное дерево.
          step('Библиотека: выход из фокуса', () => lib.dispatch('click', { target: topRowBy(hostTop) }));
        }
        // ...и обратно наверх: бросок на КРАЙ заголовка родителя возвращает
        // категорию на верхний уровень — вложение обязано быть обратимым.
        dragTopOnto(movedTop, hostTop, 0.3, 'вынести раздел обратно наверх');
        if (topPad(movedTop) !== 0) {
          fails.push('Библиотека: раздел не вынесся обратно на верхний уровень');
        }
        if (!topIsHeading(movedTop)) {
          fails.push('Библиотека: вынесенный обратно наверх раздел не вернул вид заголовка');
        }
      }
    }

    // ПЕРЕНОС ПОЗИЦИИ В ЧУЖУЮ КАТЕГОРИЮ значком ⇄ (2026-09-18). На
    // «Фурнитуре» цели — деревья всех категорий вкладки: полкодержатель
    // должен уметь переехать в «Крепёж». У позиции при этом меняется
    // item.category (на расчёт оно не влияет — спецификация адресует
    // фурнитуру по ключам каталога).
    {
      const cat = sandbox.window.Modul3D.catalog;
      const findHwItem = (k) => {
        let found = null;
        [cat.HARDWARE_PRICES, cat.HANDLES, cat.LIFTS, cat.FASTENER_PRICES].forEach((obj) => {
          if (!found && obj && obj[k]) found = obj[k];
        });
        return found;
      };
      // Значок ⇄ есть только в строке таблицы, а таблица видна у листа в
      // фокусе — открываем любой лист фурнитуры.
      const anyLeaf = treeRows().filter((r) => r.dataset.kind === 'leaf' && String(r.dataset.top || '').indexOf('hw:') === 0)[0];
      if (anyLeaf) step('Фурнитура: открытие листа под перенос позиции', () => lib.dispatch('click', { target: anyLeaf }));
      const moveIc = lib.querySelectorAll('[data-row-move]')[0];
      if (!moveIc) fails.push('Фурнитура: в таблице нет значка ⇄ — перенести позицию нечем');
      else {
        const srcTop = moveIc.dataset.moveTop || '';
        const itemKey = moveIc.dataset.moveKey;
        step('Фурнитура: меню переноса позиции', () => lib.dispatch('click', { target: moveIc }));
        const menu = document.getElementById('libMoveMenu');
        if (!menu) fails.push('Фурнитура: меню «Перенести … в:» не открылось');
        else {
          const btns = menu.querySelectorAll('[data-move-idx]');
          const labels = (String(menu.innerHTML || '').match(/data-move-idx="\d+">([^<]*)</g) || [])
            .map((s) => s.replace(/.*>/, '').replace(/<$/, ''));
          // Ищем цель в ЧУЖОЙ категории — по её заводской подписи; берём лист
          // («Категория › фирма»), чтобы результат был виден в таблице.
          let picked = null;
          (cat.HARDWARE_CATEGORY_ORDER || []).forEach((k) => {
            if (picked || 'hw:' + k === srcTop) return;
            const label = (cat.HARDWARE_CATEGORY_LABEL || {})[k];
            if (!label) return;
            const idx = labels.findIndex((l) => l.indexOf(label + ' › ') === 0);
            if (idx >= 0) picked = { key: k, idx, label: labels[idx] };
          });
          if (!picked) {
            fails.push('Фурнитура: в меню переноса позиции нет ни одной цели из другой категории');
          } else {
            const name = String((findHwItem(itemKey) || {}).name || '');
            step('Фурнитура: перенос позиции в чужую категорию', () => btns[picked.idx].dispatch('click'));
            const moved = findHwItem(itemKey) || {};
            if (moved.category !== picked.key) {
              fails.push('Фурнитура: у перенесённой позиции не сменилась категория (' + moved.category + ' вместо ' + picked.key + ')');
            }
            // Поле «фирмы» у фурнитуры одно из двух (brand у 'mechanism',
            // subcategory у остальных) — второе после смены категории должно
            // быть пустым, иначе в данных остаётся старая фирма.
            const stale = picked.key === 'mechanism' ? moved.subcategory : moved.brand;
            if (stale) fails.push('Фурнитура: после смены категории осталось старое поле фирмы (' + stale + ')');
            // И позиция реально видна в дереве новой категории.
            const html = String(lib.innerHTML || '');
            const seg = html.slice(html.indexOf('data-top-code="hw:' + picked.key + '"'));
            const end = seg.indexOf('data-top-code=', 40);
            const block = end > 0 ? seg.slice(0, end) : seg;
            if (name && block.indexOf(name) < 0) {
              fails.push('Фурнитура: перенесённая позиция не показывается в новой категории');
            }
          }
        }
      }
    }
    // Токен снимаем ДО того, как сработает отложенное сохранение каталога
    // (scheduleCatalogSave, 1.5 с): в прогоне сети нет, слать запрос некуда.
    sandbox.localStorage.getItem = savedGetItem;
  }
}

const realErrors = errors.filter((e) => !/3D viewer init failed/.test(e));
if (realErrors.length) fails.push.apply(fails, realErrors.map((e) => 'console.error: ' + e));

if (fails.length) {
  console.log('SMOKE: ПРОВАЛ');
  fails.forEach((f) => console.log('  x ' + f));
  process.exit(1);
}
console.log('SMOKE: приложение поднялось, все элементы управления отработали — ОК');
