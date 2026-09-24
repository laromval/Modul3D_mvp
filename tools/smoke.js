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
function modGridItems(groupId) {
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
  documentElement: new El('html', 'html'),
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
for (const f of SRC_ORDER) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'), sandbox, { filename: f });
}
// viewer.js требует WebGL — подменяем заглушкой: приложение создаёт его в
// try/catch и обязано работать даже без 3D.
sandbox.Modul3D.viewer = {
  Viewer3D: class {
    // viewName/onViewChange — как у настоящего Viewer3D (гизма видов):
    // экземпляр запоминаем, чтобы проверить переключение видов ниже.
    constructor() { this.onSelectModule = null; this.onViewChange = null; this.viewName = 'iso'; sandbox.__viewer = this; }
    render() {} setView(name) { this.viewName = name; } dispose() {}
    project() { return { x: 0, y: 0 }; }
    canvasSize() { return { w: 900, h: 600 }; }
  },
};
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
check('на старте видна база модулей', () => /База модулей/.test($('libraryPanel').innerHTML));
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
check('корпус по умолчанию 18 мм', () => {
  const el = document.getElementById('p-bodyThickness');
  return !!el && Number(el.attrs.value) === 18;
});
for (const id of ['p-decor', 'p-back']) {
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
check('в секции есть выбор ручек', () => /data-field="handle"/.test($('sectionsList').innerHTML));
check('в списке фасадов есть открывание вверх', () => /value="liftUp"/.test($('sectionsList').innerHTML));
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
check('карточка секции подписана «Модуль N · Секция M»', () =>
  /Модуль \d+ · Секция 1/.test($('sectionsList').innerHTML));

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
  /Модуль \d+ · Секция 2/.test($('sectionsList').innerHTML));
check('вкладки секций: переключение на первую вкладку раскрывает Секцию 1', () => {
  const tabs = document.querySelectorAll('.sec-tab');
  if (!tabs.length) return false;
  tabs[0].click();
  return /Модуль \d+ · Секция 1/.test($('sectionsList').innerHTML);
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

  check('подготовка модуля', () => setTop('m-height', 800) && setTop('m-baseType', 'plinth') && setTop('m-baseHeight', 100));
  check('секция: 3 ящика без дверей', () => set('facade', 'open') && set('shelves', 0) && set('drawers', 3));
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
    const v = inputs().map((x) => Number(x.attrs.value));
    // поля идут сверху вниз, неделимый остаток достаётся НИЖНЕМУ ящику
    return v.length === 3 && Math.abs(v.reduce((a, b) => a + b, 0) - AVAIL) < 1.5 && v[2] === 240;
  });

  // Поля идут сверху вниз, поэтому для сравнения приводим их к порядку модели
  const setDrawer = (d, v) => { const el = inputs()[d]; if (!el) return; el.value = v; el.dispatch('change', { target: el }); };
  const heights = () => inputs().map((x) => Number(x.attrs.value));

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
})();

// --- панель: у кухонного модуля нет штанги, выбора верха нет ни у кого -----
(function panelFieldsScenario() {
  sandbox.Modul3D.app.setPanelView('module');   // вернулись с экрана «Ящики»
  const panelHtml = () => $('paramsPanel').innerHTML;
  check('в панели нет выбора «Верх модуля»', () => panelHtml().indexOf('m-topType') === -1);
  check('в панели нет «Ширина планки»', () => panelHtml().indexOf('m-railWidth') === -1);
  const sectionsHtml = () => $('sectionsList').innerHTML;
  check('у обычного модуля штанга предлагается', () => /Штанга для одежды/.test(sectionsHtml()));

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
    const r = /<button class="mod-tab[^"]*\bactive\b[^"]*"[\s\S]*?>([^<]*)<\/button>/.exec($('paramsPanel').innerHTML);
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
    const r = /<button class="mod-tab[^"]*\bactive\b[^"]*"[\s\S]*?>([^<]*)<\/button>/.exec($('paramsPanel').innerHTML);
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

// Кухонный пресет должен ставить белый корпус и белые ящики, а декор
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
    toggleModGroup(kitchen);
    const item = modGridItems('kitchen').filter((b) => b.dataset.preset === 'lower600drawers')[0];
    if (item) {
      item.click();
      // Код «белого» декора не хардкодим (раньше тут был /U702|бел/i под
      // конкретный код — сломалось, когда U702ST9 переименовали в «Серый
      // кашемир», реальный белый декор внезапно оказался под другим кодом:
      // H3450ST22 «Флитвуд белый»). Берём ту же логику, что и app.js
      // (см. «Первый кухонный модуль...» — DECORS.filter(/бел/i.test(name))[0]),
      // чтобы тест не рассыпался при следующей смене каталога.
      const whiteDecor = (sandbox.Modul3D.catalog.DECORS || []).filter((d) => /бел/i.test(d.name))[0];
      const isWhite = (v) => !!whiteDecor && String(v || '') === whiteDecor.code;
      // Материалы корпуса/фасада — экран «Материалы» (см. #materialsLinkBtn).
      const mb = document.getElementById('materialsLinkBtn');
      if (mb) mb.click();
      const body = document.getElementById('p-decor');
      const facade = document.getElementById('p-facadeDecor');
      if (!isWhite(body && body.value)) fails.push('кухня: корпус не стал белым');
      if (facade && isWhite(facade.value)) fails.push('кухня: декор фасада тоже побелел');
      const back = document.getElementById('panelBack');
      if (back) back.click();
      // Материал ящиков — поле СЕКЦИИ на экране «Ящики» (#drawersDecor,
      // были общими на проект — см. drawersPanelBlock).
      const openBtn = document.getElementById('sectionsList').querySelectorAll('[data-drawers-open]')[0];
      if (openBtn) {
        openBtn.click();
        const drawer = document.getElementById('drawersDecor');
        if (!isWhite(drawer && drawer.value)) fails.push('кухня: ящики не стали белыми');
      }
    }
    toggleModGroup(kitchen);
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
    if (!/<h3>Фурнитура<\/h3>/.test(String(lib.innerHTML || ''))) {
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
