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
    // (например, обработчик «Редактировать ящики →») читает именно его, а не
    // target, — см. e.currentTarget.dataset в app.js/bindPanelEvents.
    for (const fn of list) {
      fn(Object.assign({ target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} }, ev || {}));
    }
    return list.length;
  }
  click() { return this.dispatch('click'); }
  appendChild(c) { this.children.push(c); if (c && c.id) registry.set(c.id, c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); }
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
  focus() {} blur() {} scrollIntoView() {}
  remove() { if (this.id) registry.delete(this.id); }
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
function $(id) {
  if (!registry.has(id)) registry.set(id, new El(id));
  return registry.get(id);
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
    constructor() { this.onSelectModule = null; }
    render() {} setView() {} dispose() {}
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
check('на чертежах написано, что проект пуст', () => /Проект пуст/.test($('tab-drawings').innerHTML));
check('пустой проект не даёт ошибок', () => panel.innerHTML.indexOf('Ошибка') === -1);
check('первый модуль добавляется кнопкой «+»', () => {
  const b = document.getElementById('addModule');
  if (!b) return false;
  b.click();
  return document.querySelectorAll('.mod-tab').length === 1;
});

check('панель отрисована', () => panel.innerHTML.length > 500);
check('деталировка не пуста', () => $('tab-detailing').innerHTML.indexOf('<table') !== -1);
check('в деталировке напечатано название материала', () =>
  /ЛДСП|ХДФ/.test($('tab-detailing').innerHTML));
check('в чертежах напечатан материал деталей', () =>
  /<th>Материал<\/th>/.test($('tab-drawings').innerHTML));
check('спецификация не пуста', () => $('tab-spec').innerHTML.indexOf('<table') !== -1);
check('чертежи не пусты', () => $('tab-drawings').innerHTML.length > 200);

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
for (const id of ['p-decor', 'p-back', 'p-joint']) {
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
// Иерархия в подписях: сначала модуль, потом секция внутри него
check('заголовок секций начинается с модуля', () => /Модуль \d+ — секции/.test($('paramsPanel').innerHTML));
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

check('добавление секции', () => {
  const b = document.getElementById('addSection');
  return b ? (b.click(), true) : false;
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
  check('нет NaN в деталировке (авто)', () => $('tab-detailing').innerHTML.indexOf('NaN') === -1);

  // «Редактировать ящики →» в карточке секции открывает отдельную панель
  // «Ящики» (state.panelView:'drawers', см. openDrawersPanel/drawersPanelBlock)
  // вместо старого инлайн-блока в #sectionsList.
  check('«Редактировать ящики →» открывает панель ящиков', () => {
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
  check('ручной режим не обнулил ящики', () => $('tab-detailing').innerHTML.indexOf('NaN') === -1);
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
  check('нет NaN после правки', () => $('tab-detailing').innerHTML.indexOf('NaN') === -1);
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
  const cats = document.querySelectorAll('.lib-cat');
  const kitchen = cats.filter((c) => c.attrs['data-cat'] === 'kitchen')[0];
  check('категория «Кухонный модуль» есть', () => !!kitchen);
  check('у кухонного модуля штанги нет', () => {
    if (!kitchen) return false;
    // Категория теперь раскрывается ИНЛАЙН в #libraryPanel (сетка миниатюр
    // .lib-item[data-preset]), без плавающего #moduleMenu — клик по миниатюре
    // сразу добавляет модуль в проект (см. app.js bindLibraryEvents).
    kitchen.click();
    const item = document.getElementById('libraryPanel').querySelectorAll('[data-preset]')[0];
    if (!item) return false;
    item.click();
    return sectionsHtml().indexOf('Штанга для одежды') === -1;
  });
  check('кухонный модуль всё равно строится с двумя планками', () =>
    /Планка верхняя/.test($('tab-detailing').innerHTML));
})();

// --- база готовых модулей: категория → вариант → модуль в проекте ----------
// Категория раскрывается ИНЛАЙН в #libraryPanel (сетка миниатюр
// .lib-item[data-preset]) — плавающего #moduleMenu для выбора пресета больше
// нет, клик по миниатюре сразу добавляет модуль (см. app.js libraryBlock/
// libraryGridBlock/bindLibraryEvents).
(function presetScenario() {
  const cats = () => document.querySelectorAll('.lib-cat');
  check('кнопки категорий базы есть', () => cats().length >= 2);

  const tabsCount = () => document.querySelectorAll('.mod-tab').length;
  const before = tabsCount();
  const gridItems = () => document.getElementById('libraryPanel').querySelectorAll('[data-preset]');

  check('категория открывает список вариантов', () => {
    cats()[0].click();
    return gridItems().length >= 2;
  });
  check('выбор варианта добавляет модуль в проект', () => {
    const item = gridItems()[0];
    if (!item) return false;
    item.click();
    return tabsCount() === before + 1;
  });
  check('модуль из базы построился без ошибок', () =>
    $('tab-detailing').innerHTML.indexOf('NaN') === -1 && $('tab-detailing').innerHTML.indexOf('<table') !== -1);
  check('в деталировке появились детали шкафа', () => /Боковина|Полка/.test($('tab-detailing').innerHTML));
  cats()[0].click();   // закрыть категорию, открытую проверками выше (клик — переключатель)

  // все варианты всех категорий добавляются без исключений
  let added = 0;
  for (const c of cats()) {
    c.click();                                    // открыть категорию
    const items = gridItems();
    if (!items.length) { fails.push('база: список вариантов пуст для ' + (c.attrs['data-cat'] || '?')); continue; }
    for (const it of items) {
      const n = tabsCount();
      it.click();
      if (tabsCount() !== n + 1) { fails.push('база: вариант не добавился — ' + it.attrs['data-preset']); }
      else added += 1;
    }
    c.click();                                    // закрыть категорию перед следующей
  }
  check('добавились все варианты базы', () => added >= 8);
  check('после всех вариантов деталировка цела', () => $('tab-detailing').innerHTML.indexOf('NaN') === -1);
})();

// --- нумерация и место вставки модулей -------------------------------------
(function moduleOrderScenario() {
  const count = () => document.querySelectorAll('.mod-tab').length;
  // Имя активного модуля больше не читается из поля m-name (его убрали,
  // переименование только через контекстное меню) — берём из заголовка
  // секций: `<h3>${esc(mod.name)} — секции</h3>` (см. app.js moduleFieldsBlock).
  const activeModuleName = () => {
    const r = /<h3>([^<]*) — секции<\/h3>/.exec($('paramsPanel').innerHTML);
    return r ? r[1] : '';
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
    const cats = document.querySelectorAll('.lib-cat');
    cats[0].click();
    const item = document.getElementById('libraryPanel').querySelectorAll('[data-preset]')[0];
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
    const r = /Габарит проекта ([\d.]+)×([\d.]+)×([\d.]+)/.exec($('tab-drawings').innerHTML);
    return r ? r[1] + 'x' + r[3] : '';
  };
  const activeModuleName = () => {
    const r = /<h3>([^<]*) — секции<\/h3>/.exec($('paramsPanel').innerHTML);
    return r ? r[1] : '';
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
  check('пустой проект не ломает чертежи', () => $('tab-drawings').innerHTML.indexOf('NaN') === -1);
  check('модуль добавляется обратно', () => {
    document.getElementById('addModule').click();
    return document.querySelectorAll('.mod-tab').length === 1;
  });
})();

for (const id of ['hideFacades', 'addModule', 'saveProjectBtn', 'openProjectBtn']) {
  const el = document.getElementById(id);
  if (el) check('клик ' + id, () => { el.click(); return true; });
}
for (const el of document.querySelectorAll('.view-btn')) {
  check('вид: ' + (el.dataset.view || el.id), () => { el.click(); return true; });
}
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
  const cats = document.querySelectorAll('.lib-cat');
  const kitchen = cats.filter((c) => c.dataset.cat === 'kitchen')[0];
  if (!kitchen) fails.push('база модулей: нет категории «Кухонный модуль»');
  else {
    // Категория раскрывается ИНЛАЙН в #libraryPanel — без плавающего
    // #moduleMenu, см. app.js libraryBlock/bindLibraryEvents.
    kitchen.click();
    const item = document.getElementById('libraryPanel').querySelectorAll('[data-preset]')
      .filter((b) => b.dataset.preset === 'cornerSink')[0];
    if (!item) fails.push('база модулей: нет варианта «под мойку»');
    else {
      item.click();
      const tabs = $('tab-detailing').innerHTML;
      if (/Задняя стенка/.test(tabs)) {
        fails.push('под мойку: в деталировке осталась задняя стенка');
      }
      if (!/Планка верхняя передняя[\s\S]{0,400}?НА РЕБРО/.test(tabs)
        && !/НА РЕБРО/.test(tabs)) {
        fails.push('под мойку: планки не встали на ребро (нет отметки в деталировке)');
      }
    }
    kitchen.click();                              // закрыть категорию за собой
  }
}

// Кухонный пресет должен ставить белый корпус и белые ящики, а декор
// пользователя переносить на фасад.
{
  const kitchen = document.querySelectorAll('.lib-cat').filter((c) => c.dataset.cat === 'kitchen')[0];
  if (kitchen) {
    let guard = 60;
    while (document.querySelectorAll('.mod-tab').length && guard-- > 0) {
      const d = document.getElementById('delModule');
      if (!d) break;
      d.click();
    }
    kitchen.click();
    const item = document.getElementById('libraryPanel').querySelectorAll('[data-preset]')
      .filter((b) => b.dataset.preset === 'lower600drawers')[0];
    if (item) {
      item.click();
      const isWhite = (v) => /U702|бел/i.test(String(v || ''));
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
    kitchen.click();
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

// Паспорт системы ящиков виден в спецификации и предупреждает о
// неподтверждённых размерах.
{
  const spec = document.getElementById('tab-spec');
  const html = spec ? String(spec.innerHTML || '') : '';
  if (!/Паспорт системы ящиков/.test(html)) fails.push('в спецификации нет паспорта системы');
  if (!/Источник размеров/.test(html)) fails.push('в паспорте нет источника размеров');
  if (!/passport-warn|passport-ok/.test(html)) {
    fails.push('в паспорте нет отметки о подтверждённости размеров');
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
