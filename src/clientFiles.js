// «Файлы» проекта клиента: картинки, снимки 3D-вида и файлы проекта на Google
// Диске самого пользователя (сам файл лежит на Диске, у нас — только карточка:
// название, ссылка, id). Кнопка «＋» открывает меню добавления.
// Подключение к облаку — src/cloudDrive.js (window.Modul3D.cloud). Расширяет
// src/clients.js (подключается после него, берёт общий набор
// window.Modul3D.clientsKit). Сервер: routes/files.js (миграция 010).
//
// Весь текст пользователя вставляется через textContent — никакого innerHTML;
// ссылкой делается только адрес, начинающийся с http:// или https://.

(function () {
'use strict';

var kit = window.Modul3D && window.Modul3D.clientsKit;
if (!kit) return;
var h = kit.h, call = kit.call, S = kit.S, plural = kit.plural;

var MAX_PICK = 10;          // за один раз — не больше стольки картинок

var F = {
  key: null,     // 'p:<id>' — чьи файлы загружены
  items: [],
  loading: false,
  error: '',
  form: null,    // { id|null, kind, title, url, error }
  add: null,     // панель добавления картинок: { items:[], busy, error, uid }
  menu: false,   // открыто ли меню «＋»
  filter: 'all', // что показывать: all | project | image | table | dxf
  shareFor: null, // id файла, у которого открыто запасное меню «Поделиться»
  shareCache: {}, // id -> blob файла, уже скачанный с Диска для отправки
  notice: '',    // сообщение об успешном сохранении
  thumbs: {},    // id карточки -> blob-адрес превью ('' — файла нет на Диске)
  thumbBusy: {},
  thumbFail: {}, // id -> когда превью не загрузилось из-за сбоя (повтор через паузу)
  stale: false   // список надо перечитать (картинку добавили из другого места)
};

function cloud() { return window.Modul3D && window.Modul3D.cloud; }
function drive() { var c = cloud(); return c && c.active(); }

function safeHref(u) { return /^https?:\/\//i.test(String(u || '')) ? u : null; }

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

function fmtDay(iso) {
  try { return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; }
}

function fmtSize(n) {
  if (!n && n !== 0) return '';
  return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ';
}

function pad(n) { return (n < 10 ? '0' : '') + n; }

function defaultTitle(i, total) {
  var d = new Date();
  var t = 'Фото ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  return total > 1 ? t + ' (' + (i + 1) + ')' : t;
}

// Тип файла по mime: project — файл проекта 3D, image — картинки, table — Excel/CSV, dxf — присадка.
function fileType(f) {
  var m = String(f.mime || '').toLowerCase();
  if (!m || /^image\//.test(m)) return 'image';       // старые карточки без mime — это картинки
  if (m === 'application/json') return 'project';
  if (/dxf/.test(m)) return 'dxf';
  return 'table';
}
var TYPE_ICON = { project: '🧊', image: '🖼', table: '📊', dxf: '📐' };
var FILTERS = [['all', 'Все файлы'], ['project', 'Проекты 3D'], ['image', 'Картинки'], ['table', 'Excel и CSV'], ['dxf', 'ЧПУ (DXF)']];
var MIME_EXT = { 'application/json': 'json', 'image/jpeg': 'jpg', 'image/png': 'png', 'text/csv': 'csv', 'application/dxf': 'dxf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx' };

function clearThumbs() {
  Object.keys(F.thumbs).forEach(function (k) { if (F.thumbs[k]) { try { URL.revokeObjectURL(F.thumbs[k]); } catch (e) { /* ничего */ } } });
  F.thumbs = {}; F.thumbBusy = {}; F.thumbFail = {};
}

function freeAddItems() {
  if (!F.add) return;
  F.add.items.forEach(function (it) { if (it.preview) { try { URL.revokeObjectURL(it.preview); } catch (e) { /* ничего */ } } });
}

function closeAdd() {
  freeAddItems();
  F.add = null;
  document.removeEventListener('paste', onPaste);
}

async function load(key, scope) {
  F.loading = true; F.error = '';
  try {
    var q = '/files?client=' + scope.clientId + '&project=' + (scope.projectId || 'none');
    var r = await call('GET', q);
    if (F.key === key) F.items = r.files;
  } catch (e) {
    if (F.key === key) F.error = e.message || 'Не удалось загрузить файлы.';
  } finally {
    F.loading = false;
    kit.render();
  }
}

function scopeKey(scope) { return 'p:' + (scope.projectId || 'none:' + scope.clientId); }

function ensure(scope) {
  var key = scopeKey(scope);
  if (F.key === key) {
    if (F.stale) { F.stale = false; load(key, scope); }
    return key;
  }
  closeAdd(); clearThumbs();
  F.stale = false;
  F.key = key; F.items = []; F.error = ''; F.form = null;
  load(key, scope);
  return key;
}

// Перечитывает список, только если на экране всё ещё тот же проект (пока шла
// операция, пользователь мог перейти в другой — его список не трогаем).
async function reload(scope) { if (F.key === scopeKey(scope)) await load(F.key, scope); }

async function act(scope, fn) {
  F.error = '';
  try { await fn(); } catch (e) { F.error = e.message || 'Не удалось выполнить операцию.'; }
  await reload(scope);
}

function removeFile(scope, f) {
  var msg = f.kind === 'drive'
    ? 'Удалить «' + f.title + '» из проекта? Сам файл останется на вашем Google Диске.'
    : 'Удалить «' + f.title + '» из проекта? Саму страницу в интернете это не затронет.';
  if (!window.confirm(msg)) return;
  return act(scope, function () { return call('DELETE', '/files/' + f.id); });
}

async function submitForm(scope) {
  var f = F.form;
  var isDrive = f.kind === 'drive';
  var url = f.url.trim();
  if (!isDrive && !url) { f.error = 'Вставьте адрес ссылки.'; kit.render(); return; }
  if (isDrive && !f.title.trim()) { f.error = 'Введите название.'; kit.render(); return; }
  try {
    if (f.id && isDrive) await call('PATCH', '/files/' + f.id, { title: f.title.trim() });
    else if (f.id) await call('PATCH', '/files/' + f.id, { url: url, title: f.title.trim() || hostOf(/^[a-z]+:/i.test(url) ? url : 'https://' + url) || url });
    else {
      var body = { clientId: scope.clientId, url: url };
      if (scope.projectId) body.projectId = scope.projectId;
      if (f.title.trim()) body.title = f.title.trim();
      await call('POST', '/files', body);
    }
    F.form = null;
  } catch (e) {
    f.error = e.message || 'Не удалось сохранить.';
    kit.render();
    return;
  }
  await reload(scope);
}

function openForm(file) {
  closeAdd();
  F.form = { id: file ? file.id : null, kind: file ? file.kind : 'link', title: file ? file.title : '', url: file ? file.url : '', error: '' };
  kit.render();
}

function closeForm() { F.form = null; kit.render(); }

function linkForm(scope) {
  var f = F.form;
  var isDrive = f.kind === 'drive';
  var url = isDrive ? null : h('input', { type: 'url', inputmode: 'url', class: 'cl-input', maxlength: '2000', autocomplete: 'off',
    placeholder: 'Адрес ссылки: https://…', 'data-role': 'file-url', oninput: function (e) { f.url = e.target.value; } });
  if (url) url.value = f.url;
  var title = h('input', { type: 'text', class: 'cl-input', maxlength: '200', autocomplete: 'off',
    placeholder: isDrive ? 'Название' : 'Название (по желанию)', 'data-role': 'file-title', oninput: function (e) { f.title = e.target.value; } });
  title.value = f.title;
  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); submitForm(scope); }
    else if (e.key === 'Escape') { e.preventDefault(); closeForm(); }
  }
  if (url) url.addEventListener('keydown', onKey);
  title.addEventListener('keydown', onKey);
  setTimeout(function () { if (document.activeElement === document.body) (url || title).focus(); }, 0);
  return h('div', { class: 'cl-form cl-task-form' }, url, title,
    f.error ? h('div', { class: 'cl-error', role: 'alert', text: f.error }) : null,
    h('div', { class: 'cl-form-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { submitForm(scope); }, text: f.id ? 'Сохранить' : 'Добавить' }),
      h('button', { type: 'button', class: 'btn', onclick: closeForm, text: 'Отмена' })));
}

// ------------------------------------------------------------ картинки → Диск

function scopeNames(scope) {
  return [scope.clientName || 'Клиент', scope.projectId ? (scope.projectName || 'Проект') : 'Общее'];
}

// Загружает уже подготовленный JPEG на Диск и создаёт карточку в проекте.
// Нужен действующий вход в Google (drive().connect() — из обработчика нажатия).
// it.uploaded хранит результат загрузки: если карточку не удалось записать,
// повтор не отправит файл на Диск второй раз.
async function saveFile(scope, blob, title, fileName, mime, it) {
  var c = cloud(), d = drive();
  if (!c || !d) throw new Error('Google Диск недоступен.');
  var rec = it && it.uploaded;
  var dest = scopeNames(scope).join('/');
  if (rec && it.uploadedTo !== dest) rec = null;   // выбрали другое место — файл надо положить туда
  if (!rec) {
    rec = await d.upload(scopeNames(scope), blob, fileName, mime);
    if (it) { it.uploaded = rec; it.uploadedTo = dest; }
  }
  var body = { clientId: scope.clientId, kind: 'drive', title: title, url: rec.url,
    driveFileId: rec.fileId, mime: rec.mime, sizeBytes: rec.size };
  if (scope.projectId) body.projectId = scope.projectId;
  try {
    return (await call('POST', '/files', body)).file;
  } catch (e) {
    e.message = 'Файл сохранён на Google Диске, но не добавлен в проект: ' + e.message;
    throw e;
  }
}

function saveImage(scope, jpeg, title, it) {
  return saveFile(scope, jpeg, title, cloud().cleanName(title, 'Фото') + '.jpg', 'image/jpeg', it);
}

// ------------------------------------------------------------------ меню «＋»

document.addEventListener('click', function (e) {
  if (F.menu && !(e.target.closest && e.target.closest('.cl-menu-wrap'))) { F.menu = false; kit.render(); }
});

// Файлы, которые собирает сервер (Excel, DXF, CSV): получаем и кладём на Диск.
// Нужна активная подписка — иначе сервер ответит понятной ошибкой.
var GEN = {
  detailing: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', what: 'Деталировка',
    build: function (x, ex) { return ex.buildDetailing(x.model); } },
  specification: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', what: 'Спецификация',
    build: function (x, ex) { return ex.buildSpecification(x.spec); } },
  dxf: { mime: 'application/dxf', what: 'Присадка DXF', build: function (x, ex, cnc) { return cnc.buildDrillDxf(x.model); } },
  csv: { mime: 'text/csv', what: 'Присадка CSV', build: function (x, ex, cnc) { return cnc.buildDrillCsv(x.model); } }
};

async function saveGenerated(scope, kind) {
  var d = drive(), g = GEN[kind], M3 = window.Modul3D || {};
  var x = M3.app && M3.app.getExportInputs && M3.app.getExportInputs();
  if (!d || !g || !x || !x.model) { F.error = 'Сначала постройте модуль в 3D — выгружать пока нечего.'; kit.render(); return; }
  var ready = d.connect();          // вход в Google — сразу, из нажатия
  F.error = ''; F.notice = g.what + ': готовлю файл…'; kit.render();
  try {
    await ready;
    var f = await g.build(x, M3.exportModule || {}, M3.cnc || {});
    var name = f.name, stamp = new Date();
    name = name.replace(/(\.[a-z0-9]+)$/i, '-' + stamp.getFullYear() + '-' + pad(stamp.getMonth() + 1) + '-' + pad(stamp.getDate()) + '$1');
    await saveFile(scope, f.blob, name.replace(/\.[a-z0-9]+$/i, ''), name, g.mime, null);
    F.notice = g.what + ' сохранена на ваш Google Диск и добавлена в «Файлы».';
  } catch (e) {
    F.notice = ''; F.error = e.message || 'Не удалось сохранить файл.';
  }
  await reload(scope);
  kit.render();
}

// «Сохранить проект»: файл проекта из 3D-вида уходит на Диск и в «Файлы».
async function saveProjectFile(scope) {
  var d = drive(), app = window.Modul3D && window.Modul3D.app;
  if (!d || !app || !app.getProjectFile) { F.error = 'Сохранение проекта недоступно.'; kit.render(); return; }
  var ready = d.connect();          // вход в Google — сразу, из нажатия (иначе окно заблокируют)
  var f = app.getProjectFile();
  var title = f.name.replace(/\.json$/i, '');
  F.error = ''; F.notice = 'Сохраняю проект…'; kit.render();
  try {
    await ready;
    await saveFile(scope, f.blob, title, f.name, 'application/json', null);
    F.notice = 'Проект сохранён на ваш Google Диск и добавлен в «Файлы».';
  } catch (e) {
    F.notice = ''; F.error = e.message || 'Не удалось сохранить проект.';
  }
  await reload(scope);
  kit.render();
}

// «Снимок 3D-вида»: кадр берём СРАЗУ, пока холст свежий, и кладём в панель загрузки.
async function addSnapshot(scope) {
  var v = window.Modul3D.viewer && window.Modul3D.viewer.current, c = cloud(), shot = null;
  try { shot = v && v.captureImage ? v.captureImage() : null; } catch (e) { shot = null; }
  openAdd(scope);
  var A = F.add;
  if (!shot || !c) { A.error = 'Не удалось сделать снимок 3D-вида.'; kit.render(); return; }
  try {
    var jpeg = await c.prepareImage(c.dataUrlToBlob(shot), 1600, 0.9);
    if (F.add !== A) return;
    var d = new Date();
    A.items.push({ id: ++A.uid, title: 'Вид 3D ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()),
      blob: jpeg, preview: URL.createObjectURL(jpeg), status: 'ready', error: '', uploaded: null });
  } catch (e) {
    A.error = e.message || 'Не удалось подготовить снимок.';
  }
  kit.render();
}

function plusMenu(scope) {
  var items = [
    ['save-project', '🧊 Сохранить проект', function () { saveProjectFile(scope); }],
    ['detailing', '📊 Деталировка (Excel)', function () { saveGenerated(scope, 'detailing'); }],
    ['specification', '📊 Спецификация (Excel)', function () { saveGenerated(scope, 'specification'); }],
    ['dxf', '📐 Присадка для ЧПУ (DXF)', function () { saveGenerated(scope, 'dxf'); }],
    ['csv', '📋 Присадка (CSV)', function () { saveGenerated(scope, 'csv'); }],
    ['pick-photo', '🖼 Фото с устройства', function () { openAdd(scope); pick(scope, false); }],
    ['take-photo', '📷 Снять на камеру', function () { openAdd(scope); pick(scope, true); }],
    ['snap-3d', '📸 Снимок 3D-вида', function () { addSnapshot(scope); }]
  ];
  var btn = h('button', { type: 'button', class: 'cl-link cl-plus', 'data-role': 'files-plus', 'aria-label': 'Добавить файл',
    'aria-haspopup': 'true', 'aria-expanded': F.menu ? 'true' : 'false', text: '＋',
    onclick: function () { F.menu = !F.menu; F.fileMenu = null; F.notice = ''; kit.render(); } });
  var box = h('div', { class: 'cl-menu-wrap' }, btn);
  if (F.menu) {
    var pop = h('div', { class: 'popover cl-menu-pop', role: 'menu' },
      h('div', { class: 'cl-menu-cap', text: 'Сохранить на Google Диск:' }));
    items.forEach(function (it) {
      pop.appendChild(h('button', { type: 'button', class: 'ctx-item', role: 'menuitem', 'data-role': 'menu-' + it[0], text: it[1],
        onclick: function () { F.menu = false; it[2](); } }));
    });
    box.appendChild(pop);
  }
  return box;
}

async function addPicked(scope, fileList) {
  var A = F.add;
  if (!A) return;
  var files = Array.prototype.slice.call(fileList || []);
  var c = cloud();
  if (!c) { A.error = 'Загрузка картинок недоступна.'; kit.render(); return; }
  var room = MAX_PICK - A.items.length;
  if (files.length > room) { A.error = 'За один раз — не больше ' + MAX_PICK + ' картинок.'; files = files.slice(0, Math.max(0, room)); }
  else A.error = '';
  var total = A.items.length + files.length;
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (!/^image\//i.test(f.type || '')) { A.error = 'Можно добавлять только картинки (JPG, PNG…).'; continue; }
    try {
      var jpeg = await c.prepareImage(f, 1600, 0.85);
      if (F.add !== A) return;   // панель закрыли, пока готовилась картинка
      A.items.push({ id: ++A.uid, title: defaultTitle(A.items.length, total), blob: jpeg,
        preview: URL.createObjectURL(jpeg), status: 'ready', error: '', uploaded: null });
    } catch (e) {
      A.error = e.message || 'Не удалось подготовить картинку.';
    }
  }
  kit.render();
}

function pick(scope, camera) {
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  if (camera) inp.setAttribute('capture', 'environment'); else inp.multiple = true;
  inp.style.display = 'none';
  inp.addEventListener('change', function () {
    var files = inp.files;
    if (inp.parentNode) inp.parentNode.removeChild(inp);
    addPicked(scope, files);
  });
  document.body.appendChild(inp);
  inp.click();
}

var pasteScope = null;
function onPaste(e) {
  if (!F.add || !pasteScope) return;
  var t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;   // вставка текста в поле названия
  var cd = e.clipboardData, files = [];
  if (cd && cd.files && cd.files.length) files = cd.files;
  else if (cd && cd.items) {
    for (var i = 0; i < cd.items.length; i++) {
      if (cd.items[i].kind === 'file') { var f = cd.items[i].getAsFile(); if (f) files.push(f); }
    }
  }
  if (!files.length) return;
  e.preventDefault();
  addPicked(pasteScope, files);
}

function openAdd(scope) {
  F.form = null;
  F.add = { items: [], busy: false, error: '', uid: 0 };
  pasteScope = scope;
  document.addEventListener('paste', onPaste);
  var d = drive();
  if (d && d.preload) d.preload().catch(function () { /* покажем ошибку при входе */ });
  kit.render();
}

async function startUpload(scope) {
  var A = F.add, d = drive();
  if (!A || !d || A.busy) return;
  var todo = A.items.filter(function (i) { return i.status !== 'done'; });
  if (!todo.length) return;
  // Вход в Google — СРАЗУ, из обработчика нажатия (иначе браузер заблокирует окно).
  var ready = d.connect();
  A.busy = true; A.error = '';
  todo.forEach(function (i) { i.error = ''; });
  kit.render();
  try { await ready; }
  catch (e) { A.busy = false; A.error = e.message || 'Не удалось войти в Google.'; kit.render(); return; }
  for (var n = 0; n < todo.length; n++) {
    var it = todo[n];
    it.status = 'uploading'; kit.render();
    try {
      await saveImage(scope, it.blob, it.title.trim() || 'Фото', it);
      it.status = 'done';
    } catch (e) {
      it.status = 'error'; it.error = e.message || 'Не удалось загрузить.';
      if (e.code === 'auth') { A.error = it.error; break; }
    }
  }
  A.busy = false;
  var left = A.items.filter(function (i) { return i.status !== 'done'; });
  var same = F.add === A;     // пользователь мог уйти в другой проект — тогда его панель не трогаем
  A.items.filter(function (i) { return i.status === 'done'; }).forEach(function (i) { if (i.preview) URL.revokeObjectURL(i.preview); });
  if (same && !left.length) closeAdd();
  else A.items = left;
  if (!same) left.forEach(function (i) { if (i.preview) URL.revokeObjectURL(i.preview); });
  await reload(scope);
  loadThumbs();
}

function addPanel(scope) {
  var A = F.add;
  var d = drive();
  var kids = [];
  kids.push(h('div', { class: 'cl-pick-row' },
    h('button', { type: 'button', class: 'btn', 'data-role': 'pick-gallery', disabled: A.busy ? '' : null, text: '🖼 Выбрать фото', onclick: function () { pick(scope, false); } }),
    h('button', { type: 'button', class: 'btn', 'data-role': 'pick-camera', disabled: A.busy ? '' : null, text: '📷 Снять', onclick: function () { pick(scope, true); } })));
  kids.push(h('div', { class: 'cl-hint', text: 'Скриншот можно вставить сочетанием Ctrl+V. Картинка уменьшится до 1600 px и сохранится на ваш Google Диск, в папку Modul3D.' }));
  A.items.forEach(function (it) {
    var title = h('input', { type: 'text', class: 'cl-input', maxlength: '200', autocomplete: 'off', 'data-role': 'img-title',
      disabled: A.busy ? '' : null, oninput: function (e) { it.title = e.target.value; } });
    title.value = it.title;
    kids.push(h('div', { class: 'cl-pend', 'data-role': 'pending-img' },
      h('img', { class: 'cl-file-thumb', alt: '', src: it.preview }),
      h('div', { class: 'cl-task-body' }, title,
        h('div', { class: 'cl-muted cl-file-meta', text: fmtSize(it.blob.size) + (it.status === 'uploading' ? ' · загружается…' : it.status === 'error' ? '' : ' · готово к загрузке') }),
        it.error ? h('div', { class: 'cl-error', role: 'alert', text: it.error }) : null,
        A.busy ? null : h('button', { type: 'button', class: 'cl-link cl-danger', text: 'Убрать', onclick: function () {
          if (it.preview) URL.revokeObjectURL(it.preview);
          A.items = A.items.filter(function (x) { return x !== it; });
          kit.render();
        } }))));
  });
  if (A.error) kids.push(h('div', { class: 'cl-error', role: 'alert', text: A.error }));
  var n = A.items.length;
  kids.push(h('div', { class: 'cl-form-actions' },
    n ? h('button', { type: 'button', class: 'btn btn-primary', 'data-role': 'upload-imgs', disabled: A.busy ? '' : null, onclick: function () { startUpload(scope); },
      text: A.busy ? 'Загружаю…' : ((d && d.hasToken() ? 'Загрузить на Google Диск' : 'Войти в Google и загрузить') + (n > 1 ? ' (' + n + ')' : '')) }) : null,
    h('button', { type: 'button', class: 'btn', disabled: A.busy ? '' : null, onclick: function () { closeAdd(); kit.render(); }, text: 'Закрыть' })));
  return h.apply(null, ['div', { class: 'cl-form cl-task-form', 'data-role': 'add-panel' }].concat(kids));
}

// ------------------------------------------------------------------- превью

function loadThumbs() {
  var d = drive();
  if (!d || !d.hasToken()) return;
  var now = Date.now();
  var todo = F.items.filter(function (f) {
    return f.kind === 'drive' && f.driveFileId && (!f.mime || /^image\//i.test(f.mime)) && !(f.id in F.thumbs) && !F.thumbBusy[f.id] &&
      !(F.thumbFail[f.id] && now - F.thumbFail[f.id] < 30000);
  });
  if (!todo.length) return;
  var key = F.key;
  var queue = todo.slice(), active = 0;
  function next() {
    while (active < 3 && queue.length) {
      (function (f) {
        active++; F.thumbBusy[f.id] = true;
        d.fetchBlob(f.driveFileId).then(function (b) {
          if (F.key === key) F.thumbs[f.id] = URL.createObjectURL(b);
        }).catch(function (e) {
          if (F.key !== key) return;
          if (e && (e.code === 'notfound' || e.code === 'forbidden')) F.thumbs[f.id] = '';   // файла нет — значок насовсем
          else F.thumbFail[f.id] = Date.now();                                              // сбой сети — повторим позже
        }).then(function () {
          active--; delete F.thumbBusy[f.id];
          if (F.key === key) kit.render();
          next();
        });
      })(queue.shift());
    }
  }
  next();
}

function showPreviews() {
  var d = drive();
  if (!d) return;
  d.connect().then(function () { loadThumbs(); kit.render(); }).catch(function (e) {
    F.error = e.message || 'Не удалось войти в Google.'; kit.render();
  });
}

// --------------------------------------------------------------------- список

function fileRow(scope, f) {
  var isDrive = f.kind === 'drive';
  var href = f.unreadable ? null : safeHref(f.url);
  var titleEl = href
    ? h('a', { class: 'cl-file-title', href: href, target: '_blank', rel: 'noopener noreferrer', text: f.title })
    : h('span', { class: 'cl-file-title', text: f.unreadable ? 'Не удалось расшифровать ссылку' : f.title });
  var lead;
  if (isDrive && F.thumbs[f.id]) {
    var img = h('img', { class: 'cl-file-thumb', alt: f.title, src: F.thumbs[f.id] });
    lead = href ? h('a', { href: href, target: '_blank', rel: 'noopener noreferrer', class: 'cl-file-thumb-link', 'data-role': 'file-thumb' }, img) : img;
  } else {
    lead = h('span', { class: 'cl-file-ico', 'aria-hidden': 'true', text: isDrive ? TYPE_ICON[fileType(f)] : '🔗' });
  }
  var meta = isDrive
    ? 'Google Диск' + (f.sizeBytes ? ' · ' + fmtSize(f.sizeBytes) : '') + ' · ' + fmtDay(f.createdAt)
    : (hostOf(f.url) ? hostOf(f.url) + ' · ' : '') + fmtDay(f.createdAt);
  return h('div', { class: 'cl-file', 'data-role': 'file-row', 'data-kind': f.kind },
    lead,
    h('div', { class: 'cl-task-body' },
      titleEl,
      h('div', { class: 'cl-muted cl-file-meta', text: meta })),
    fileMenu(scope, f, isDrive));
}

// ------------------------------------------------------------ «Поделиться»

function fileMenu(scope, f, isDrive) {
  var open = F.fileMenu === f.id;
  var btn = h('button', { type: 'button', class: 'cl-kebab', 'data-role': 'file-menu', 'aria-label': 'Действия с файлом: ' + f.title,
    'aria-haspopup': 'true', 'aria-expanded': open ? 'true' : 'false',
    onclick: function () { F.fileMenu = open ? null : f.id; F.shareFor = null; F.notice = ''; kit.render(); } });
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>';
  var box = h('div', { class: 'cl-menu-wrap cl-file-menu' }, btn);
  if (!open) return box;
  var pop = h('div', { class: 'popover cl-menu-pop', role: 'menu' });
  if (F.shareFor === f.id) {
    pop.appendChild(shareMenu(f));
  } else {
    var item = function (role, text, fn, cls) {
      pop.appendChild(h('button', { type: 'button', class: 'ctx-item' + (cls ? ' ' + cls : ''), role: 'menuitem', 'data-role': role, text: text, onclick: fn }));
    };
    if (isDrive && !f.unreadable) item('file-share', '↗ Поделиться', function () { shareFile(f); });
    if (!f.unreadable) item('file-rename', '✎ Переименовать', function () { F.fileMenu = null; openForm(f); });
    item('file-delete', '🗑 Удалить', function () { F.fileMenu = null; removeFile(scope, f); }, 'cl-danger');
  }
  box.appendChild(pop);
  return box;
}

// Клик мимо меню файла закрывает его.
document.addEventListener('click', function (e) {
  if (F.fileMenu && !(e.target.closest && e.target.closest('.cl-file-menu'))) { F.fileMenu = null; F.shareFor = null; kit.render(); }
});

function shareName(f) {
  var ext = MIME_EXT[String(f.mime || 'image/jpeg').toLowerCase()] || 'bin';
  var base = String(f.title || 'файл').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'файл';
  return /\.[a-z0-9]{2,4}$/i.test(base) ? base : base + '.' + ext;
}

// Сначала пробуем «родное» окно «Поделиться» телефона/планшета и отдаём САМ файл:
// ссылка на Диск закрыта для посторонних, а файл дойдёт до WhatsApp, Telegram,
// почты и т. д. Если устройство так не умеет — показываем запасное меню со ссылками.
async function shareFile(f) {
  var d = drive();
  F.error = ''; F.notice = ''; F.fileMenu = null;
  if (navigator.canShare && navigator.share && d && f.driveFileId) {
    var ready = d.connect();     // вход в Google — сразу, из нажатия
    F.notice = 'Готовлю файл…'; kit.render();
    try {
      await ready;
      var blob = F.shareCache[f.id] || await d.fetchBlob(f.driveFileId);
      F.shareCache[f.id] = blob;
      var file = new File([blob], shareName(f), { type: f.mime || blob.type || 'application/octet-stream' });
      if (navigator.canShare({ files: [file] })) {
        F.notice = ''; kit.render();
        await navigator.share({ files: [file], title: f.title });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') { F.notice = ''; kit.render(); return; }   // сами закрыли окно
      if (e && e.name === 'NotAllowedError') { F.notice = 'Файл готов — нажмите «Поделиться» ещё раз.'; kit.render(); return; }
      /* иначе — запасной путь ниже */
    }
    F.notice = '';
  }
  F.fileMenu = f.id; F.shareFor = f.id;
  kit.render();
}

function shareMenu(f) {
  var url = safeHref(f.url) || '';
  var text = f.title + (url ? ' — ' + url : '');
  var enc = encodeURIComponent;
  var links = [
    ['WhatsApp', 'https://wa.me/?text=' + enc(text), true],
    ['Telegram', 'https://t.me/share/url?url=' + enc(url) + '&text=' + enc(f.title), true],
    ['Viber', 'viber://forward?text=' + enc(text), false],
    ['Почта', 'mailto:?subject=' + enc(f.title) + '&body=' + enc(text), false]
  ];
  var box = h('div', { class: 'cl-share-menu', 'data-role': 'share-menu' });
  links.forEach(function (l) {
    box.appendChild(h('a', { class: 'cl-act', href: l[1], target: l[2] ? '_blank' : null, rel: l[2] ? 'noopener noreferrer' : null, text: l[0] }));
  });
  box.appendChild(h('button', { type: 'button', class: 'cl-act', 'data-role': 'share-copy', text: 'Копировать ссылку', onclick: function () {
    var done = function () { F.notice = 'Ссылка скопирована.'; kit.render(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt('Скопируйте ссылку:', url); });
    else window.prompt('Скопируйте ссылку:', url);
  } }));
  return h('div', { class: 'cl-share-wrap' }, box,
    h('div', { class: 'cl-hint', text: 'Отправится ссылка на файл на Google Диске: откроется только у тех, у кого есть доступ.' }));
}

function filesBlock(scope) {
  ensure(scope);
  var d = drive();
  var busy = !!(F.form || F.add);
  // Ссылки теперь живут в заметках (там они кликабельны); в «Файлах» только файлы с Диска.
  var items = F.items.filter(function (f) { return f.kind === 'drive'; });
  var counts = { all: items.length };
  items.forEach(function (f) { var t = fileType(f); counts[t] = (counts[t] || 0) + 1; });
  var filterSel = null;
  if (items.length) {
    filterSel = h('select', { class: 'cl-filter', 'data-role': 'files-filter', 'aria-label': 'Какие файлы показывать',
      onchange: function (e) { F.filter = e.target.value; F.shareFor = null; kit.render(); } });
    FILTERS.forEach(function (o) { filterSel.appendChild(h('option', { value: o[0], text: o[1] + ' (' + (counts[o[0]] || 0) + ')' })); });
    filterSel.value = F.filter;
  }
  var kids = [h('div', { class: 'cl-section-head' }, h('h3', { class: 'drawer-section', text: 'Файлы' }), filterSel,
    busy ? null : plusMenu(scope))];
  var shown = items.filter(function (f) { return F.filter === 'all' || fileType(f) === F.filter; });
  if (F.error) kids.push(h('div', { class: 'cl-error', role: 'alert', text: F.error }));
  if (F.notice) kids.push(h('div', { class: 'cl-hint', role: 'status', text: F.notice }));
  if (F.add) kids.push(addPanel(scope));
  if (items.length && !shown.length && !F.add && !F.loading) {
    kids.push(h('div', { class: 'cl-empty', text: 'В этой категории пока ничего нет.' }));
  }
  if (!items.length && !F.form && !F.add && !F.loading) {
    kids.push(h('div', { class: 'cl-empty', text: 'Пока пусто. Нажмите «＋»: можно сохранить проект, Excel, DXF, добавить фото, снять на камеру или сделать снимок 3D-вида — всё попадёт на ваш Google Диск. Ссылки на сайты пишите в заметках.' }));
  }
  var hasDrive = items.some(function (f) { return f.kind === 'drive'; });
  if (hasDrive && d && !d.hasToken()) {
    kids.push(h('div', { class: 'cl-hint' }, 'Чтобы увидеть превью картинок, ',
      h('button', { type: 'button', class: 'cl-link', 'data-role': 'show-previews', text: 'подключите Google Диск', onclick: showPreviews }), '.'));
  }
  shown.forEach(function (f) {
    if (F.form && F.form.id === f.id) kids.push(linkForm(scope));
    else kids.push(fileRow(scope, f));
  });
  if (hasDrive || F.add) kids.push(h('div', { class: 'cl-hint', text: 'Файлы лежат на вашем Google Диске в папке Modul3D. У нас хранится только ссылка на них.' }));
  if (d && d.hasToken()) {
    kids.push(h('div', { class: 'cl-hint' }, h('button', { type: 'button', class: 'cl-link', 'data-role': 'disconnect-drive', text: 'Отключить Google Диск',
      onclick: function () { d.disconnect(); clearThumbs(); kit.render(); } })));
  }
  setTimeout(loadThumbs, 0);
  return h.apply(null, ['div', { class: 'cl-block', 'data-role': 'files-block' }].concat(kids));
}

var prevReset = kit.EXT.reset;
kit.EXT.reset = function () { if (prevReset) prevReset(); closeAdd(); clearThumbs(); F.key = null; F.form = null; F.menu = false; F.fileMenu = null; F.shareFor = null; F.notice = ''; };
kit.EXT.filesBlock = filesBlock;

kit.files = {
  saveImage: saveImage,
  invalidate: function () { F.stale = true; }   // список файлов перечитается при следующем показе
};
})();
