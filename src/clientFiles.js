// «Файлы» проекта клиента: ссылки из интернета (хранятся у нас, в базе,
// зашифрованно) и картинки/скриншоты на Google Диске самого пользователя
// (сам файл лежит на Диске, у нас — только карточка: название, ссылка, id).
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
  add: null,     // панель «＋ Картинка»: { items:[], busy, error, uid }
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
    ? 'Убрать «' + f.title + '» из проекта? Сам файл останется на вашем Google Диске.'
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
async function saveImage(scope, jpeg, title, it) {
  var c = cloud(), d = drive();
  if (!c || !d) throw new Error('Google Диск недоступен.');
  var rec = it && it.uploaded;
  var dest = scopeNames(scope).join('/');
  if (rec && it.uploadedTo !== dest) rec = null;   // выбрали другое место — файл надо положить туда
  if (!rec) {
    rec = await d.upload(scopeNames(scope), jpeg, c.cleanName(title, 'Фото') + '.jpg', 'image/jpeg');
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
    return f.kind === 'drive' && f.driveFileId && !(f.id in F.thumbs) && !F.thumbBusy[f.id] &&
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
    lead = h('span', { class: 'cl-file-ico', 'aria-hidden': 'true', text: isDrive ? '🖼' : '🔗' });
  }
  var meta = isDrive
    ? 'Google Диск' + (f.sizeBytes ? ' · ' + fmtSize(f.sizeBytes) : '') + ' · ' + fmtDay(f.createdAt)
    : (hostOf(f.url) ? hostOf(f.url) + ' · ' : '') + fmtDay(f.createdAt);
  return h('div', { class: 'cl-file', 'data-role': 'file-row', 'data-kind': f.kind },
    lead,
    h('div', { class: 'cl-task-body' },
      titleEl,
      h('div', { class: 'cl-muted cl-file-meta', text: meta }),
      h('div', { class: 'cl-note-actions' },
        f.unreadable ? null : h('button', { type: 'button', class: 'cl-link', text: isDrive ? 'Переименовать' : 'Изменить', onclick: function () { openForm(f); } }),
        h('button', { type: 'button', class: 'cl-link cl-danger', text: isDrive ? 'Убрать' : 'Удалить', onclick: function () { removeFile(scope, f); } }))));
}

function filesBlock(scope) {
  ensure(scope);
  var d = drive();
  var busy = !!(F.form || F.add);
  var kids = [h('div', { class: 'cl-section-head' }, h('h3', { class: 'drawer-section', text: 'Ссылки и файлы' }),
    busy ? null : h('span', { class: 'cl-head-actions' },
      h('button', { type: 'button', class: 'cl-link', 'data-role': 'add-image', text: '＋ Картинка', onclick: function () { openAdd(scope); } }),
      h('button', { type: 'button', class: 'cl-link', 'data-role': 'add-link', text: '＋ Ссылка', onclick: function () { openForm(null); } })))];
  if (F.error) kids.push(h('div', { class: 'cl-error', role: 'alert', text: F.error }));
  if (F.add) kids.push(addPanel(scope));
  if (F.form && !F.form.id) kids.push(linkForm(scope));
  if (!F.items.length && !F.form && !F.add && !F.loading) {
    kids.push(h('div', { class: 'cl-empty', text: 'Пока пусто. Добавьте картинку или скриншот (они сохранятся на ваш Google Диск) либо ссылку на сайт, пример или поставщика.' }));
  }
  var hasDrive = F.items.some(function (f) { return f.kind === 'drive'; });
  if (hasDrive && d && !d.hasToken()) {
    kids.push(h('div', { class: 'cl-hint' }, 'Чтобы увидеть превью картинок, ',
      h('button', { type: 'button', class: 'cl-link', 'data-role': 'show-previews', text: 'подключите Google Диск', onclick: showPreviews }), '.'));
  }
  F.items.forEach(function (f) {
    if (F.form && F.form.id === f.id) kids.push(linkForm(scope));
    else kids.push(fileRow(scope, f));
  });
  if (hasDrive || F.add) kids.push(h('div', { class: 'cl-hint', text: 'Картинки лежат на вашем Google Диске в папке Modul3D. У нас хранится только ссылка на них.' }));
  if (d && d.hasToken()) {
    kids.push(h('div', { class: 'cl-hint' }, h('button', { type: 'button', class: 'cl-link', 'data-role': 'disconnect-drive', text: 'Отключить Google Диск',
      onclick: function () { d.disconnect(); clearThumbs(); kit.render(); } })));
  }
  setTimeout(loadThumbs, 0);
  return h.apply(null, ['div', { class: 'cl-block', 'data-role': 'files-block' }].concat(kids));
}

var prevReset = kit.EXT.reset;
kit.EXT.reset = function () { if (prevReset) prevReset(); closeAdd(); clearThumbs(); F.key = null; F.form = null; };
kit.EXT.filesBlock = filesBlock;

// Для «Снимка 3D-вида» (src/clientSnap.js): сохранить картинку в любой проект.
kit.files = {
  saveImage: saveImage,
  invalidate: function () { F.stale = true; }   // список файлов перечитается при следующем показе
};
})();
