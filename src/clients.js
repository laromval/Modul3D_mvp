// Раздел «Клиенты»: клиент → несколько проектов → заметки. Личные данные
// каждого пользователя на сервере (server/src/routes/clients.js, миграция
// 008_clients.sql) — не путать с workflow.html (доска владельца проекта).
//
// Файл самодостаточный и без зависимостей от app.js: берёт адрес сервера и
// ключ JWT из window.Modul3D.sketchAI (как export.js/cnc.js), рисует себя в
// #clientsPanel (панель-ящик drawer-clients из index.html), весь текст
// пользователя вставляется через textContent — никакого innerHTML.
//
// Экраны: list (список клиентов) → client (проекты клиента + заметки на
// весь клиент) → project (вкладки Заметки / Файлы / Задачи). «Файлы»
// (Google Диск) и «Задачи» — следующие этапы, пока заглушки.

(function () {
'use strict';

var root = document.getElementById('clientsPanel');
var drawer = document.getElementById('drawer-clients');
if (!root || !drawer || typeof root.setAttribute !== 'function' || !drawer.classList) return;

// Расширения, которые регистрирует src/clientTasks.js (задачи и уведомления).
var EXT = {};

var STATUS_LABEL = { active: 'В работе', done: 'Готов' };

var S = {
  view: 'list',          // 'list' | 'client' | 'project' | 'tasks' (все задачи)
  tab: 'notes',          // вкладка проекта
  clients: null,         // список клиентов (null — ещё не грузили)
  client: null,          // открытый клиент
  projects: [],          // проекты открытого клиента
  project: null,         // открытый проект
  notes: [],             // заметки текущего экрана (клиента или проекта)
  loading: false,
  error: '',
  filter: '',
  adding: null,          // 'client' | 'project' | 'note' — какая форма добавления открыта
  editingNote: null,     // id заметки в режиме правки
  editingName: false,    // переименование клиента/проекта
  draft: null,           // введённый, но не отправленный текст формы { kind, a, b }
  lastToken: undefined
};

function api() { return (window.Modul3D && window.Modul3D.sketchAI) || {}; }

function getToken() {
  try { return localStorage.getItem(api().AUTH_TOKEN_KEY || 'modul3dAuthToken'); } catch (e) { return null; }
}

async function call(method, path, body) {
  var token = getToken();
  var base = api().API_BASE || '';
  var res;
  try {
    res = await fetch(base + path, {
      method: method,
      headers: Object.assign({ authorization: 'Bearer ' + token },
        body === undefined ? {} : { 'content-type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (e) {
    var offline = new Error('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
    offline.status = 0;
    throw offline;
  }
  var json = null;
  try { json = await res.json(); } catch (e) { /* пустой ответ */ }
  if (!res.ok) {
    var err = new Error((json && json.error) || ('Ошибка сервера (' + res.status + ').'));
    err.status = res.status;
    throw err;
  }
  return json;
}

// --- маленький конструктор DOM: весь текст — только через textContent ---
function h(tag, attrs) {
  var el = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
  }
  for (var i = 2; i < arguments.length; i++) {
    var c = arguments[i];
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

function plural(n, one, few, many) {
  var m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}

// ------------------------------------------------------------------ загрузка

// renderFirst — для переходов между экранами (сразу показать новый экран,
// пока грузятся данные). Для правок формы НЕ перерисовываем в начале и в
// случае ошибки оставляем введённый текст в S.draft (иначе сетевой сбой
// стирал бы длинную заметку).
async function guarded(fn, renderFirst) {
  S.loading = true; S.error = '';
  if (renderFirst) render(); else root.classList.add('is-loading');
  try { await fn(); S.draft = null; }
  catch (e) { S.error = e.message || 'Не удалось выполнить операцию.'; if (e.status === 401) S.lastToken = undefined; }
  finally { S.loading = false; render(); }
}

function loadList() {
  return guarded(async function () {
    S.clients = (await call('GET', '/clients')).clients;
  }, true);
}

function openClient(id) {
  if (EXT.reset) EXT.reset();
  S.view = 'client'; S.adding = null; S.editingNote = null; S.editingName = false; S.draft = null;
  S.client = (S.clients || []).filter(function (c) { return c.id === id; })[0] || null;
  S.projects = []; S.notes = []; S.project = null;
  return guarded(async function () {
    var info = await call('GET', '/clients/' + id);
    S.client = info.client; S.projects = info.projects;
    S.notes = (await call('GET', '/clients/' + id + '/notes?project=none')).notes;
  }, true);
}

function openProject(p) {
  if (EXT.reset) EXT.reset();
  S.view = 'project'; S.tab = 'notes'; S.adding = null; S.editingNote = null; S.editingName = false; S.draft = null;
  S.project = p; S.notes = [];
  return guarded(async function () {
    S.notes = (await call('GET', '/clients/' + S.client.id + '/notes?project=' + p.id)).notes;
  }, true);
}

function backToList() {
  S.view = 'list'; S.client = null; S.project = null; S.adding = null; S.editingName = false; S.error = ''; S.draft = null;
  return loadList();
}

function backToClient() {
  return openClient(S.client.id);
}

// ------------------------------------------------------------------ действия

function addClient(name, phone, email) {
  return guarded(async function () {
    var body = { name: name };
    if (phone) body.phone = phone;
    if (email) body.email = email;
    var r = await call('POST', '/clients', body);
    S.adding = null;
    S.clients = (await call('GET', '/clients')).clients;
    S.view = 'client'; S.client = r.client; S.projects = []; S.notes = [];
  });
}

function addProject(name) {
  return guarded(async function () {
    var r = await call('POST', '/clients/' + S.client.id + '/projects', { name: name });
    S.projects.push(r.project);
    S.adding = null;
  });
}

function addNote(text) {
  return guarded(async function () {
    var body = { body: text };
    if (S.view === 'project') body.projectId = S.project.id;
    var r = await call('POST', '/clients/' + S.client.id + '/notes', body);
    S.notes.unshift(r.note);
    S.adding = null;
  });
}

function saveNote(note, text) {
  return guarded(async function () {
    var r = await call('PATCH', '/clients/' + S.client.id + '/notes/' + note.id, { body: text });
    S.notes = S.notes.map(function (n) { return n.id === note.id ? r.note : n; });
    S.editingNote = null;
  });
}

function deleteNote(note) {
  if (!window.confirm('Удалить заметку?')) return;
  return guarded(async function () {
    await call('DELETE', '/clients/' + S.client.id + '/notes/' + note.id);
    S.notes = S.notes.filter(function (n) { return n.id !== note.id; });
  });
}

function renameClient(name) {
  return guarded(async function () {
    S.client = (await call('PATCH', '/clients/' + S.client.id, { name: name })).client;
    S.editingName = false;
  });
}

function saveContact(phone, email) {
  return guarded(async function () {
    // Пустая строка очищает поле на сервере.
    S.client = (await call('PATCH', '/clients/' + S.client.id, { phone: phone, email: email })).client;
    S.adding = null;
  });
}

function toggleArchive() {
  return guarded(async function () {
    S.client = (await call('PATCH', '/clients/' + S.client.id, { archived: !S.client.archived })).client;
  });
}

function deleteClient() {
  var n = S.projects.length;
  var msg = 'Удалить клиента «' + S.client.name + '» вместе с проектами (' + n + ') и заметками? Это нельзя отменить.' +
    '\n\nФайлы на вашем Google Диске (если вы их сохраняли) останутся на месте.';
  if (!window.confirm(msg)) return;
  return guarded(async function () {
    await call('DELETE', '/clients/' + S.client.id);
    S.view = 'list'; S.client = null; S.projects = [];
    S.clients = (await call('GET', '/clients')).clients;
  });
}

function renameProject(name) {
  return guarded(async function () {
    var p = (await call('PATCH', '/clients/' + S.client.id + '/projects/' + S.project.id, { name: name })).project;
    S.project = Object.assign({}, S.project, p);
    S.editingName = false;
  });
}

function toggleProjectStatus() {
  var next = S.project.status === 'done' ? 'active' : 'done';
  return guarded(async function () {
    var p = (await call('PATCH', '/clients/' + S.client.id + '/projects/' + S.project.id, { status: next })).project;
    S.project = Object.assign({}, S.project, p);
  });
}

function deleteProject() {
  if (!window.confirm('Удалить проект «' + S.project.name + '» и его заметки? Это нельзя отменить.')) return;
  return guarded(async function () {
    await call('DELETE', '/clients/' + S.client.id + '/projects/' + S.project.id);
    S.project = null;
    S.view = 'client';
    var info = await call('GET', '/clients/' + S.client.id);
    S.client = info.client; S.projects = info.projects;
    S.notes = (await call('GET', '/clients/' + S.client.id + '/notes?project=none')).notes;
  });
}

// ------------------------------------------------------------------- виджеты

function backBtn(label, fn) {
  return h('button', { type: 'button', class: 'cl-back', onclick: fn },
    h('span', { 'aria-hidden': 'true', text: '←' }), ' ', label);
}

// Строка ввода с кнопками «Добавить / Отмена»; Enter — отправить, Esc — закрыть.
function draftFor(kind) { return S.draft && S.draft.kind === kind ? S.draft : null; }

function inlineForm(opts) {
  var d = draftFor(opts.kind);
  var input = h('input', { type: 'text', class: 'cl-input', maxlength: String(opts.max || 120),
    placeholder: opts.placeholder, autocomplete: 'off' });
  input.value = d ? d.a : (opts.value || '');
  function submit() {
    var v = input.value.trim();
    if (!v) { input.focus(); return; }
    S.draft = { kind: opts.kind, a: v, b: '' };
    opts.onSubmit(v);
  }
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') { e.preventDefault(); opts.onCancel(); }
  });
  setTimeout(function () { input.focus(); }, 0);
  return h('div', { class: 'cl-form' }, input,
    h('div', { class: 'cl-form-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: submit, text: opts.submitLabel || 'Добавить' }),
      h('button', { type: 'button', class: 'btn', onclick: opts.onCancel, text: 'Отмена' })));
}

// ------------------------------------------------- телефон и почта клиента

// Цифры номера. Для ссылок мессенджеров нужен международный формат: если
// номер не начинается с «+» или «00», код страны неизвестен — не гадаем
// и возвращаем null (тогда показывается только «Позвонить»).
function intlDigits(phone) {
  var t = String(phone || '').trim();
  var digits = t.replace(/\D/g, '');
  if (t.charAt(0) === '+') return digits;
  if (digits.indexOf('00') === 0) return digits.slice(2);
  return null;
}

function dialHref(phone) {
  var t = String(phone || '').trim();
  return 'tel:' + (t.charAt(0) === '+' ? '+' : '') + t.replace(/\D/g, '');
}

function vcardEscape(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

// Имя файла только латиницей: кириллица и пробелы в именах скачиваемых
// файлов на части телефонов и браузеров теряются («download»).
var TRANSLIT = { 'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya','ă':'a','â':'a','î':'i','ș':'s','ț':'t' };
function vcfFileName(name) {
  var out = String(name || '').toLowerCase().split('').map(function (ch) {
    return Object.prototype.hasOwnProperty.call(TRANSLIT, ch) ? TRANSLIT[ch] : ch;
  }).join('');
  out = out.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (out || 'client') + '.vcf';
}

// Карточка контакта (vCard 3.0): телефон открывает системное «Сохранить в
// контакты». Напрямую писать в книгу контактов из браузера нельзя.
function downloadVcard(c) {
  var lines = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:' + vcardEscape(c.name), 'N:' + vcardEscape(c.name) + ';;;;'];
  if (c.phone) lines.push('TEL;TYPE=CELL:' + vcardEscape(c.phone));
  if (c.email) lines.push('EMAIL:' + vcardEscape(c.email));
  lines.push('END:VCARD');
  var blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/vcard;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = h('a', { href: url, download: vcfFileName(c.name) });
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

// Выбор человека из книги контактов телефона (Chrome на Android, только по
// нажатию и только того, кого выберет пользователь).
function pickerSupported() {
  return !!(window.isSecureContext && navigator.contacts && typeof navigator.contacts.select === 'function');
}

async function pickContact() {
  var res = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: false });
  var r = res && res[0];
  if (!r) return null;
  function first(a) { return a && a.length ? String(a[0]) : ''; }
  return {
    name: first(r.name).trim(),
    phone: first(r.tel).replace(/[^+\d\s()\-.]/g, '').trim().slice(0, 40),
    email: first(r.email).trim().slice(0, 120)
  };
}

// Форма «имя (необязательно) + телефон + почта + выбор из контактов».
function contactForm(opts) {
  var d = draftFor(opts.kind);
  var name = opts.withName
    ? h('input', { type: 'text', class: 'cl-input', maxlength: '120', placeholder: 'Имя клиента', autocomplete: 'off' })
    : null;
  var phone = h('input', { type: 'tel', inputmode: 'tel', class: 'cl-input', maxlength: '40',
    placeholder: 'Телефон, например +373 69 123 456', autocomplete: 'off' });
  var email = h('input', { type: 'email', inputmode: 'email', class: 'cl-input', maxlength: '120',
    placeholder: 'Почта', autocomplete: 'off' });
  if (name) name.value = d ? d.a : '';
  phone.value = d ? d.b : (opts.phone || '');
  email.value = d ? d.c : (opts.email || '');

  function submit() {
    var n = name ? name.value.trim() : '';
    if (name && !n) { name.focus(); return; }
    S.draft = { kind: opts.kind, a: n, b: phone.value.trim(), c: email.value.trim() };
    opts.onSubmit(n, phone.value.trim(), email.value.trim());
  }
  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') { e.preventDefault(); opts.onCancel(); }
  }
  [name, phone, email].forEach(function (el) { if (el) el.addEventListener('keydown', onKey); });

  var pickRow = null;
  if (pickerSupported()) {
    pickRow = h('button', { type: 'button', class: 'btn cl-pick', text: '📇 Выбрать из контактов телефона',
      onclick: function () {
        pickContact().then(function (c) {
          if (!c) return;
          if (name && !name.value.trim() && c.name) name.value = c.name;
          if (c.phone) phone.value = c.phone;
          if (c.email) email.value = c.email;
        }).catch(function () { /* закрыл окно выбора — ничего не делаем */ });
      } });
  }
  setTimeout(function () { (name || phone).focus(); }, 0);
  return h('div', { class: 'cl-form' }, name, pickRow, phone, email,
    pickRow ? null : h('div', { class: 'cl-hint', text: 'Выбор из контактов телефона доступен в Chrome на Android.' }),
    h('div', { class: 'cl-form-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: submit, text: opts.submitLabel || 'Сохранить' }),
      h('button', { type: 'button', class: 'btn', onclick: opts.onCancel, text: 'Отмена' })));
}

// Показ контакта: телефон с кнопками «позвонить/написать», почта, сохранение
// в контакты.
function contactView(c) {
  var wrap = h('div', { class: 'cl-contact-box' });
  if (c.contactUnreadable) {
    wrap.appendChild(h('div', { class: 'cl-contact' }, h('span', { class: 'cl-muted', text: 'Контакт не расшифровался' }),
      h('button', { type: 'button', class: 'cl-link', text: 'Указать заново', onclick: function () { S.adding = 'contact'; render(); } })));
    return wrap;
  }
  if (!c.phone && !c.email) {
    wrap.appendChild(h('div', { class: 'cl-contact' }, h('span', { class: 'cl-muted', text: 'Телефон и почта не указаны' }),
      h('button', { type: 'button', class: 'cl-link', text: 'Указать', onclick: function () { S.adding = 'contact'; render(); } })));
    return wrap;
  }
  if (c.phone) {
    var intl = intlDigits(c.phone);
    var acts = [h('a', { class: 'cl-act cl-act-main', href: dialHref(c.phone), text: '📞 Позвонить' })];
    if (intl) {
      acts.push(h('a', { class: 'cl-act', href: 'https://wa.me/' + intl, target: '_blank', rel: 'noopener', text: 'WhatsApp' }));
      acts.push(h('a', { class: 'cl-act', href: 'viber://chat?number=%2B' + intl, text: 'Viber' }));
      acts.push(h('a', { class: 'cl-act', href: 'https://t.me/+' + intl, target: '_blank', rel: 'noopener', text: 'Telegram' }));
    }
    var actsBox = h('div', { class: 'cl-acts' });
    acts.forEach(function (a) { actsBox.appendChild(a); });
    wrap.appendChild(h('div', { class: 'cl-contact-row' }, h('span', { class: 'cl-contact-val', text: c.phone }), actsBox));
  }
  if (c.email) {
    wrap.appendChild(h('div', { class: 'cl-contact-row' }, h('span', { class: 'cl-contact-val', text: c.email }),
      h('div', { class: 'cl-acts' }, h('a', { class: 'cl-act cl-act-main', href: 'mailto:' + encodeURI(c.email), text: '✉ Написать' }))));
  }
  wrap.appendChild(h('div', { class: 'cl-contact-foot' },
    h('button', { type: 'button', class: 'cl-link', text: 'Сохранить в контакты', onclick: function () { downloadVcard(c); } }),
    h('button', { type: 'button', class: 'cl-link', text: 'Изменить', onclick: function () { S.adding = 'contact'; render(); } })));
  return wrap;
}

function noteForm(opts) {
  var ta = h('textarea', { class: 'cl-input cl-textarea', rows: '4', maxlength: '20000',
    placeholder: opts.placeholder || 'Текст заметки…' });
  var d = draftFor(opts.kind);
  ta.value = d ? d.a : (opts.value || '');
  function submit() {
    var v = ta.value.trim();
    if (!v) { ta.focus(); return; }
    S.draft = { kind: opts.kind, a: v, b: '' };
    opts.onSubmit(v);
  }
  ta.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') { e.preventDefault(); opts.onCancel(); }
  });
  setTimeout(function () { ta.focus(); }, 0);
  return h('div', { class: 'cl-form' }, ta,
    h('div', { class: 'cl-form-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: submit, text: opts.submitLabel || 'Сохранить' }),
      h('button', { type: 'button', class: 'btn', onclick: opts.onCancel, text: 'Отмена' }),
      h('span', { class: 'cl-hint', text: 'Ctrl+Enter — сохранить' })));
}

function noteCard(note) {
  if (S.editingNote === note.id) {
    return noteForm({ kind: 'note-edit-' + note.id, value: note.body || '', submitLabel: 'Сохранить',
      onSubmit: function (v) { saveNote(note, v); },
      onCancel: function () { S.editingNote = null; S.draft = null; render(); } });
  }
  return h('div', { class: 'cl-note' },
    note.unreadable
      ? h('div', { class: 'cl-note-body cl-muted', text: 'Не удалось расшифровать заметку (изменился ключ шифрования на сервере).' })
      : h('div', { class: 'cl-note-body', text: note.body }),
    h('div', { class: 'cl-note-foot' },
      h('span', { class: 'cl-muted', text: fmtDate(note.updatedAt || note.createdAt) }),
      h('span', { class: 'cl-note-actions' },
        note.unreadable ? null : h('button', { type: 'button', class: 'cl-link', text: 'Изменить',
          onclick: function () { S.editingNote = note.id; render(); } }),
        h('button', { type: 'button', class: 'cl-link cl-danger', text: 'Удалить',
          onclick: function () { deleteNote(note); } }))));
}

function notesBlock(title) {
  var head = h('div', { class: 'cl-section-head' },
    h('h3', { class: 'drawer-section', text: title }),
    S.adding === 'note' ? null : h('button', { type: 'button', class: 'cl-link', text: '＋ Заметка',
      onclick: function () { S.adding = 'note'; S.editingNote = null; render(); } }));
  var kids = [head];
  if (S.adding === 'note') {
    kids.push(noteForm({ kind: 'note-new', submitLabel: 'Добавить', onSubmit: addNote,
      onCancel: function () { S.adding = null; S.draft = null; render(); } }));
  }
  if (!S.notes.length && S.adding !== 'note') {
    kids.push(h('div', { class: 'cl-empty', text: 'Заметок пока нет.' }));
  }
  S.notes.forEach(function (n) { kids.push(noteCard(n)); });
  return h.apply(null, ['div', { class: 'cl-block' }].concat(kids));
}

function nameHeader(name, onRename) {
  if (S.editingName) {
    return inlineForm({ kind: 'rename', value: name, placeholder: 'Название', submitLabel: 'Сохранить',
      onSubmit: onRename, onCancel: function () { S.editingName = false; S.draft = null; render(); } });
  }
  return h('div', { class: 'cl-title-row' },
    h('h3', { class: 'cl-title', text: name }),
    h('button', { type: 'button', class: 'cl-link', text: 'Переименовать',
      onclick: function () { S.editingName = true; render(); } }));
}

// ------------------------------------------------------------------- экраны

function viewList() {
  var wrap = h('div', { class: 'cl-view' });
  var q = S.filter.trim().toLowerCase();
  var clients = (S.clients || []).filter(function (c) { return !q || c.name.toLowerCase().indexOf(q) !== -1; });

  wrap.appendChild(h('div', { class: 'drawer-search' },
    h('input', { type: 'search', placeholder: 'Поиск клиента…', autocomplete: 'off', value: S.filter,
      oninput: function (e) { S.filter = e.target.value; renderListOnly(); } })));

  if (S.adding === 'client') {
    wrap.appendChild(contactForm({ kind: 'client-new', withName: true, submitLabel: 'Добавить',
      onSubmit: addClient, onCancel: function () { S.adding = null; S.draft = null; render(); } }));
  } else {
    wrap.appendChild(h('button', { type: 'button', class: 'btn btn-primary cl-add', text: '＋ Добавить клиента',
      onclick: function () { S.adding = 'client'; render(); } }));
  }

  if (EXT.listTop) wrap.appendChild(EXT.listTop());

  var list = h('div', { class: 'cl-list', id: 'clList' });
  wrap.appendChild(list);
  fillList(list, clients);
  return wrap;
}

function fillList(list, clients) {
  list.textContent = '';
  if (S.clients && !S.clients.length) {
    list.appendChild(h('div', { class: 'cl-empty', text: 'Клиентов пока нет. Добавьте первого — для него можно будет вести проекты и заметки.' }));
  } else if (S.clients && !clients.length) {
    list.appendChild(h('div', { class: 'cl-empty', text: 'Никого не найдено.' }));
  }
  clients.forEach(function (c) {
    var meta = c.projectsCount + ' ' + plural(c.projectsCount, 'проект', 'проекта', 'проектов') +
      ' · ' + c.notesCount + ' ' + plural(c.notesCount, 'заметка', 'заметки', 'заметок');
    list.appendChild(h('button', { type: 'button', class: 'cl-card' + (c.archived ? ' is-archived' : ''),
      onclick: function () { openClient(c.id); } },
      h('span', { class: 'cl-card-name', text: c.name }),
      h('span', { class: 'cl-card-meta', text: meta + (c.archived ? ' · в архиве' : '') })));
  });
}

// Поиск перерисовывает только список, чтобы не терять фокус в поле.
function renderListOnly() {
  var list = document.getElementById('clList');
  if (!list) return;
  var q = S.filter.trim().toLowerCase();
  fillList(list, (S.clients || []).filter(function (c) { return !q || c.name.toLowerCase().indexOf(q) !== -1; }));
}

function viewClient() {
  var c = S.client;
  var wrap = h('div', { class: 'cl-view' });
  wrap.appendChild(backBtn('Все клиенты', backToList));
  if (!c) return wrap;

  wrap.appendChild(nameHeader(c.name, renameClient));

  // контакт
  if (S.adding === 'contact') {
    wrap.appendChild(contactForm({ kind: 'contact', phone: c.phone || '', email: c.email || '',
      onSubmit: function (n, phone, email) { saveContact(phone, email); },
      onCancel: function () { S.adding = null; S.draft = null; render(); } }));
  } else {
    wrap.appendChild(contactView(c));
  }

  // проекты
  var phead = h('div', { class: 'cl-section-head' }, h('h3', { class: 'drawer-section', text: 'Проекты' }),
    S.adding === 'project' ? null : h('button', { type: 'button', class: 'cl-link', text: '＋ Проект',
      onclick: function () { S.adding = 'project'; render(); } }));
  wrap.appendChild(phead);
  if (S.adding === 'project') {
    wrap.appendChild(inlineForm({ kind: 'project-new', placeholder: 'Название проекта (например, «Кухня»)',
      onSubmit: addProject, onCancel: function () { S.adding = null; S.draft = null; render(); } }));
  }
  if (!S.projects.length && S.adding !== 'project') {
    wrap.appendChild(h('div', { class: 'cl-empty', text: 'У клиента пока нет проектов. У одного клиента их может быть сколько угодно.' }));
  }
  var plist = h('div', { class: 'cl-list' });
  S.projects.forEach(function (p) {
    plist.appendChild(h('button', { type: 'button', class: 'cl-card', onclick: function () { openProject(p); } },
      h('span', { class: 'cl-card-name', text: p.name }),
      h('span', { class: 'cl-card-meta' },
        h('span', { class: 'cl-chip cl-chip-' + p.status, text: STATUS_LABEL[p.status] || p.status }),
        ' ' + (p.notesCount || 0) + ' ' + plural(p.notesCount || 0, 'заметка', 'заметки', 'заметок'))));
  });
  wrap.appendChild(plist);

  if (EXT.tasksBlock) wrap.appendChild(EXT.tasksBlock({ clientId: c.id, projectId: null, title: 'Задачи по клиенту' }));

  wrap.appendChild(notesBlock('Заметки по клиенту'));

  wrap.appendChild(h('div', { class: 'cl-footer' },
    h('button', { type: 'button', class: 'btn', text: c.archived ? 'Вернуть из архива' : 'В архив', onclick: toggleArchive }),
    h('button', { type: 'button', class: 'btn cl-btn-danger', text: 'Удалить клиента', onclick: deleteClient })));
  return wrap;
}

function viewProject() {
  var p = S.project;
  var wrap = h('div', { class: 'cl-view' });
  wrap.appendChild(backBtn(S.client ? S.client.name : 'Клиент', backToClient));
  if (!p) return wrap;

  wrap.appendChild(nameHeader(p.name, renameProject));
  wrap.appendChild(h('div', { class: 'cl-contact' },
    h('span', { class: 'cl-chip cl-chip-' + p.status, text: STATUS_LABEL[p.status] || p.status }),
    h('button', { type: 'button', class: 'cl-link', text: p.status === 'done' ? 'Вернуть в работу' : 'Отметить готовым',
      onclick: toggleProjectStatus })));

  var tabs = h('div', { class: 'cl-tabs', role: 'tablist' });
  [['notes', 'Заметки', true], ['files', 'Файлы', false], ['tasks', 'Задачи', !!EXT.tasksBlock]].forEach(function (t) {
    tabs.appendChild(h('button', { type: 'button', role: 'tab', 'aria-selected': S.tab === t[0] ? 'true' : 'false',
      class: 'cl-tab' + (S.tab === t[0] ? ' active' : ''),
      onclick: function () { S.tab = t[0]; render(); } }, t[1], t[2] ? null : h('span', { class: 'cl-soon', text: 'скоро' })));
  });
  wrap.appendChild(tabs);

  if (S.tab === 'notes') {
    wrap.appendChild(notesBlock('Заметки по проекту'));
  } else if (S.tab === 'files') {
    wrap.appendChild(h('div', { class: 'cl-empty', text: 'Здесь будут готовые файлы проекта (Excel, DXF, чертежи) — они сохранятся на вашем Google Диске. Появится в следующем обновлении.' }));
  } else if (EXT.tasksBlock) {
    wrap.appendChild(EXT.tasksBlock({ clientId: S.client.id, projectId: p.id, title: 'Задачи по проекту' }));
  } else {
    wrap.appendChild(h('div', { class: 'cl-empty', text: 'Задачи недоступны.' }));
  }

  wrap.appendChild(h('div', { class: 'cl-footer' },
    h('button', { type: 'button', class: 'btn cl-btn-danger', text: 'Удалить проект', onclick: deleteProject })));
  return wrap;
}

function viewSignIn() {
  return h('div', { class: 'cl-view' },
    h('div', { class: 'cl-empty' },
      h('p', { text: 'Раздел «Клиенты» личный: у каждого пользователя свои клиенты, проекты и заметки. Войдите в аккаунт, чтобы начать.' }),
      h('button', { type: 'button', class: 'btn btn-primary', text: 'Войти или зарегистрироваться',
        onclick: function () {
          var t = document.getElementById('accountToggle');
          if (t) t.click();
          // После входа панель сама подхватит аккаунт (ждём токен до 3 минут).
          var tries = 0;
          var timer = setInterval(function () {
            tries++;
            if (getToken()) { clearInterval(timer); sync(); }
            else if (tries > 180) clearInterval(timer);
          }, 1000);
        } })));
}

// ------------------------------------------------------------------- рендер

function render() {
  var title = document.getElementById('clientsDrawerTitle');
  if (title) title.textContent = 'Клиенты';

  root.textContent = '';
  if (!getToken()) { root.appendChild(viewSignIn()); return; }

  if (S.error) {
    root.appendChild(h('div', { class: 'cl-error', role: 'alert', text: S.error }));
  }
  if (S.loading) root.classList.add('is-loading'); else root.classList.remove('is-loading');

  if (S.view === 'tasks' && EXT.viewAll) root.appendChild(EXT.viewAll());
  else if (S.view === 'client') root.appendChild(viewClient());
  else if (S.view === 'project') root.appendChild(viewProject());
  else root.appendChild(viewList());
}

// Панель могла быть открыта до/после входа или выхода из аккаунта —
// сбрасываем состояние, когда токен поменялся, и подгружаем свежие данные
// при каждом открытии панели.
function sync() {
  var token = getToken();
  if (token !== S.lastToken) {
    S.lastToken = token;
    S.view = 'list'; S.clients = null; S.client = null; S.project = null; S.projects = []; S.notes = [];
    S.adding = null; S.error = ''; S.filter = '';
  }
  if (!token) { render(); return; }
  if (S.view === 'tasks' && EXT.viewAll) { if (EXT.reload) EXT.reload(); render(); }
  else if (S.view === 'client' && S.client) openClient(S.client.id);
  else if (S.view === 'project' && S.project) openProject(S.project);
  else loadList();
}

var wasOpen = false;
if (typeof MutationObserver === 'function') new MutationObserver(function () {
  var isOpen = drawer.classList.contains('open');
  if (isOpen && !wasOpen) sync();
  wasOpen = isOpen;
}).observe(drawer, { attributes: true, attributeFilter: ['class'] });

render();

window.Modul3D = window.Modul3D || {};
window.Modul3D.clients = { refresh: sync };
// Набор для расширений (clientTasks.js): общее состояние и помощники.
window.Modul3D.clientsKit = {
  S: S, EXT: EXT, h: h, call: call, plural: plural, render: render, getToken: getToken, api: api,
  openClient: openClient, openProject: openProject, loadList: loadList,
  open: function () { var b = document.querySelector('.rail-btn[data-panel="clients"]'); if (b) b.click(); }
};
})();
