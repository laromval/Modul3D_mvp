// Задачи клиентов: срок, напоминание и push-уведомления от самой программы.
// Расширяет src/clients.js (подключается после него и берёт общий набор
// window.Modul3D.clientsKit). Сервер: routes/tasks.js, routes/push.js,
// services/taskReminders.js (миграция 009). Service worker — sw.js в корне.
//
// Весь текст пользователя вставляется через textContent — никакого innerHTML.

(function () {
'use strict';

var kit = window.Modul3D && window.Modul3D.clientsKit;
if (!kit) return;
var h = kit.h, call = kit.call, S = kit.S, plural = kit.plural;

var REMIND_OPTIONS = [
  ['', 'Не напоминать'], ['0', 'В момент срока'], ['15', 'За 15 минут'], ['60', 'За 1 час'],
  ['180', 'За 3 часа'], ['1440', 'За 1 день'], ['2880', 'За 2 дня']
];

var T = {
  key: null,        // какой список загружен: 'c:<id>' | 'p:<id>' | 'all'
  items: [],
  loading: false,
  error: '',
  form: null,       // { id|null, key, title, details, date, time, remind } — открытая форма
  showDone: false,  // на экране «Все задачи» показывать и выполненные
  summary: null,    // { open, overdue } для значка на кнопке «Все задачи»
  push: { state: 'unknown', busy: false, msg: '' }
};

// ------------------------------------------------------------------- время

function pad(n) { return (n < 10 ? '0' : '') + n; }
function dateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function timeStr(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

function dueLabel(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  var now = new Date();
  var t = timeStr(d);
  var dayDiff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) -
    new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (dayDiff === 0) return 'Сегодня, ' + t;
  if (dayDiff === 1) return 'Завтра, ' + t;
  if (dayDiff === -1) return 'Вчера, ' + t;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }) + ', ' + t;
}

function remindLabel(min) {
  if (min === null || min === undefined) return '';
  if (min === 0) return 'в момент срока';
  if (min % 1440 === 0) return 'за ' + (min / 1440) + ' ' + plural(min / 1440, 'день', 'дня', 'дней');
  if (min % 60 === 0) return 'за ' + (min / 60) + ' ' + plural(min / 60, 'час', 'часа', 'часов');
  return 'за ' + min + ' мин';
}

function isOverdue(t) { return t.status !== 'done' && t.dueAt && new Date(t.dueAt).getTime() < Date.now(); }

// ------------------------------------------------------------------ загрузка

function scopeOf(key) {
  if (key === 'all') return '/tasks?status=' + (T.showDone ? 'all' : 'open');
  var kind = key.charAt(0), id = key.slice(2);
  if (kind === 'p') return '/tasks?status=all&client=' + S.client.id + '&project=' + id;
  return '/tasks?status=all&client=' + id + '&project=none';
}

async function load(key) {
  T.loading = true; T.error = '';
  try {
    var r = await call('GET', scopeOf(key));
    if (T.key === key) T.items = r.tasks;
  } catch (e) {
    if (T.key === key) T.error = e.message || 'Не удалось загрузить задачи.';
  } finally {
    T.loading = false;
    kit.render();
  }
  loadSummary();
}

async function loadSummary() {
  try {
    var before = JSON.stringify(T.summary);
    T.summary = await call('GET', '/tasks/summary');
    if (S.view === 'list' && JSON.stringify(T.summary) !== before) kit.render();
  } catch (e) { /* значок необязателен */ }
}

function ensure(key) {
  if (T.key === key) return;
  T.key = key; T.items = []; T.error = ''; T.form = null;
  load(key);
}

async function act(fn) {
  T.error = '';
  try { await fn(); }
  catch (e) { T.error = e.message || 'Не удалось выполнить операцию.'; }
  await load(T.key);
}

// ------------------------------------------------------------------ действия

function toggleDone(t) {
  return act(function () { return call('PATCH', '/tasks/' + t.id, { status: t.status === 'done' ? 'todo' : 'done' }); });
}

function removeTask(t) {
  if (!window.confirm('Удалить задачу «' + t.title + '»?')) return;
  return act(function () { return call('DELETE', '/tasks/' + t.id); });
}

function openForm(scope, task) {
  var f = { id: task ? task.id : null, clientId: scope.clientId, projectId: scope.projectId,
    title: task ? task.title : '', details: task && task.details ? task.details : '',
    date: '', time: '', remind: '', error: '' };
  if (task && task.dueAt) {
    var d = new Date(task.dueAt);
    f.date = dateStr(d); f.time = timeStr(d);
    f.remind = task.remindBeforeMin === null || task.remindBeforeMin === undefined ? '' : String(task.remindBeforeMin);
  }
  T.form = f;
  kit.render();
}

function closeForm() { T.form = null; kit.render(); }

async function submitForm() {
  var f = T.form;
  var title = f.title.trim();
  if (!title) { f.error = 'Введите название задачи.'; kit.render(); return; }
  var dueAt = null;
  if (f.date) {
    var d = new Date(f.date + 'T' + (f.time || '09:00'));
    if (isNaN(d.getTime())) { f.error = 'Неверная дата.'; kit.render(); return; }
    dueAt = d.toISOString();
    if (f.remind !== '') {
      var at = d.getTime() - Number(f.remind) * 60000;
      if (at < Date.now() - 60000) { f.error = 'Время напоминания уже прошло — выберите меньший интервал или более поздний срок.'; kit.render(); return; }
    }
  } else if (f.remind !== '') {
    f.error = 'Чтобы поставить напоминание, укажите срок.'; kit.render(); return;
  }
  var remind = f.remind === '' || !dueAt ? null : Number(f.remind);
  var body = { title: title, details: f.details.trim() || null, dueAt: dueAt, remindBeforeMin: remind };
  f.error = '';
  T.error = '';
  try {
    if (f.id) {
      await call('PATCH', '/tasks/' + f.id, body);
    } else {
      body.clientId = f.clientId;
      if (f.projectId) body.projectId = f.projectId;
      await call('POST', '/tasks', body);
    }
    T.form = null;
  } catch (e) {
    f.error = e.message || 'Не удалось сохранить задачу.';
    kit.render();
    return;
  }
  await load(T.key);
}

// ---------------------------------------------------------------- виджеты

function field(label, el) { return h('label', { class: 'cl-field' }, h('span', { class: 'cl-field-label', text: label }), el); }

function taskForm() {
  var f = T.form;
  var title = h('input', { type: 'text', class: 'cl-input', maxlength: '200', placeholder: 'Что нужно сделать', autocomplete: 'off',
    'data-role': 'task-title', oninput: function (e) { f.title = e.target.value; } });
  title.value = f.title;
  var details = h('textarea', { class: 'cl-input cl-textarea', rows: '2', maxlength: '5000', placeholder: 'Подробности (по желанию)',
    oninput: function (e) { f.details = e.target.value; } });
  details.value = f.details;
  var date = h('input', { type: 'date', class: 'cl-input', 'data-role': 'task-date',
    oninput: function (e) { f.date = e.target.value; if (f.date && !f.time) { f.time = '09:00'; time.value = '09:00'; } } });
  date.value = f.date;
  var time = h('input', { type: 'time', class: 'cl-input', 'data-role': 'task-time',
    oninput: function (e) { f.time = e.target.value; } });
  time.value = f.time;
  var sel = h('select', { class: 'cl-input', 'data-role': 'task-remind',
    onchange: function (e) { f.remind = e.target.value; } });
  REMIND_OPTIONS.forEach(function (o) { sel.appendChild(h('option', { value: o[0], text: o[1] })); });
  sel.value = f.remind;
  title.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); submitForm(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeForm(); }
  });
  setTimeout(function () { if (!f.id && document.activeElement === document.body) title.focus(); }, 0);
  return h('div', { class: 'cl-form cl-task-form' },
    title, details,
    h('div', { class: 'cl-row2' }, field('Срок', date), field('Время', time)),
    field('Напоминание', sel),
    f.error ? h('div', { class: 'cl-error', role: 'alert', text: f.error }) : null,
    h('div', { class: 'cl-form-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: submitForm, text: f.id ? 'Сохранить' : 'Добавить' }),
      h('button', { type: 'button', class: 'btn', onclick: closeForm, text: 'Отмена' })));
}

function taskRow(t, scope, showWhere) {
  var overdue = isOverdue(t);
  var meta = [];
  if (t.dueAt) meta.push(h('span', { class: 'cl-due' + (overdue ? ' is-overdue' : ''), text: (overdue ? 'Просрочено · ' : '') + dueLabel(t.dueAt) }));
  if (t.dueAt && t.remindBeforeMin !== null && t.remindBeforeMin !== undefined) {
    meta.push(h('span', { class: 'cl-muted', text: '🔔 ' + remindLabel(t.remindBeforeMin) + (t.reminded ? ' · отправлено' : '') }));
  }
  var where = null;
  if (showWhere) {
    where = h('button', { type: 'button', class: 'cl-link cl-where', text: t.clientName + (t.projectName ? ' · ' + t.projectName : ''),
      onclick: function () { goTo(t); } });
  }
  var check = h('button', { type: 'button', class: 'cl-check' + (t.status === 'done' ? ' is-done' : ''), role: 'checkbox',
    'aria-checked': t.status === 'done' ? 'true' : 'false', 'aria-label': t.status === 'done' ? 'Вернуть в работу' : 'Выполнено',
    onclick: function () { toggleDone(t); }, text: t.status === 'done' ? '✓' : '' });
  var body = h('div', { class: 'cl-task-body' },
    h('div', { class: 'cl-task-title', text: t.unreadable ? 'Не удалось расшифровать задачу' : t.title }),
    t.details && !t.unreadable ? h('div', { class: 'cl-task-details', text: t.details }) : null,
    meta.length ? h.apply(null, ['div', { class: 'cl-task-meta' }].concat(meta)) : null,
    where,
    h('div', { class: 'cl-note-actions' },
      t.unreadable ? null : h('button', { type: 'button', class: 'cl-link', text: 'Изменить', onclick: function () { openForm(scope || { clientId: t.clientId, projectId: t.projectId }, t); } }),
      h('button', { type: 'button', class: 'cl-link cl-danger', text: 'Удалить', onclick: function () { removeTask(t); } })));
  return h('div', { class: 'cl-task' + (t.status === 'done' ? ' is-done' : '') + (overdue ? ' is-overdue' : '') }, check, body);
}

function goTo(t) {
  // Перейти к клиенту этой задачи.
  T.key = null;
  S.clients = S.clients || [];
  kit.openClient(t.clientId);
}

// Блок задач для экрана клиента (projectId = null) или проекта.
function tasksBlock(scope) {
  var key = scope.projectId ? 'p:' + scope.projectId : 'c:' + scope.clientId;
  ensure(key);
  var kids = [h('div', { class: 'cl-section-head' }, h('h3', { class: 'drawer-section', text: scope.title }),
    T.form ? null : h('button', { type: 'button', class: 'cl-link', text: '＋ Задача', onclick: function () { openForm(scope, null); } }))];
  if (T.error) kids.push(h('div', { class: 'cl-error', role: 'alert', text: T.error }));
  if (T.form && !T.form.id) kids.push(taskForm());
  var items = T.items.slice().sort(function (a, b) {
    if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1;
    if (a.dueAt && b.dueAt) return new Date(a.dueAt) - new Date(b.dueAt);
    return a.dueAt ? -1 : (b.dueAt ? 1 : 0);
  });
  if (!items.length && !T.form && !T.loading) kids.push(h('div', { class: 'cl-empty', text: 'Задач пока нет. Можно указать срок и включить напоминание.' }));
  items.forEach(function (t) {
    if (T.form && T.form.id === t.id) kids.push(taskForm());
    else kids.push(taskRow(t, scope, false));
  });
  if (T.key === key) kids.push(pushBox());
  return h.apply(null, ['div', { class: 'cl-block', 'data-role': 'tasks-block' }].concat(kids));
}

// --------------------------------------------------------- экран «Все задачи»

function openAll() {
  S.view = 'tasks'; S.adding = null; S.draft = null; S.error = '';
  T.key = null;
  kit.render();
  var drawerOpen = document.getElementById('drawer-clients');
  if (!drawerOpen || !drawerOpen.classList.contains('open')) kit.open();
}

function viewAll() {
  ensure('all');
  var wrap = h('div', { class: 'cl-view' });
  wrap.appendChild(h('button', { type: 'button', class: 'cl-back', onclick: function () { T.key = null; S.view = 'list'; kit.loadList(); } },
    h('span', { 'aria-hidden': 'true', text: '←' }), ' Все клиенты'));
  wrap.appendChild(h('h3', { class: 'cl-title', text: 'Все задачи' }));
  wrap.appendChild(h('label', { class: 'cl-check-row' },
    h('input', { type: 'checkbox', checked: T.showDone ? 'checked' : null, 'data-role': 'show-done',
      onchange: function (e) { T.showDone = e.target.checked; T.key = null; kit.render(); } }),
    ' Показывать выполненные'));
  if (T.error) wrap.appendChild(h('div', { class: 'cl-error', role: 'alert', text: T.error }));
  var items = T.items;
  if (!items.length && !T.loading) wrap.appendChild(h('div', { class: 'cl-empty', text: 'Задач нет. Добавить задачу можно на странице клиента или проекта.' }));
  var groups = [['Просрочено', function (t) { return isOverdue(t); }],
    ['Сегодня', function (t) { return t.status !== 'done' && !isOverdue(t) && t.dueAt && dateStr(new Date(t.dueAt)) === dateStr(new Date()); }],
    ['Позже', function (t) { return t.status !== 'done' && !isOverdue(t) && t.dueAt && dateStr(new Date(t.dueAt)) > dateStr(new Date()); }],
    ['Без срока', function (t) { return t.status !== 'done' && !t.dueAt; }],
    ['Выполнено', function (t) { return t.status === 'done'; }]];
  groups.forEach(function (g) {
    var list = items.filter(g[1]);
    if (!list.length) return;
    wrap.appendChild(h('h3', { class: 'drawer-section cl-group' + (g[0] === 'Просрочено' ? ' is-overdue' : ''), text: g[0] + ' · ' + list.length }));
    list.forEach(function (t) {
      if (T.form && T.form.id === t.id) wrap.appendChild(taskForm());
      else wrap.appendChild(taskRow(t, { clientId: t.clientId, projectId: t.projectId }, true));
    });
  });
  wrap.appendChild(pushBox());
  return wrap;
}

// Кнопка «Все задачи» над списком клиентов.
function listTop() {
  loadSummary();
  var s = T.summary;
  var btn = h('button', { type: 'button', class: 'btn cl-all-tasks', 'data-role': 'all-tasks', onclick: openAll },
    '☑ Все задачи');
  if (s && s.open) {
    btn.appendChild(h('span', { class: 'cl-badge' + (s.overdue ? ' is-overdue' : ''), text: String(s.overdue || s.open),
      title: s.overdue ? 'Просрочено: ' + s.overdue : 'Открытых: ' + s.open }));
  }
  return btn;
}

// --------------------------------------------------------- push-уведомления

function pushSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window.PushManager !== 'undefined' &&
    typeof Notification !== 'undefined';
}

function urlB64ToUint8(b64) {
  var pad2 = '='.repeat((4 - b64.length % 4) % 4);
  var raw = atob((b64 + pad2).replace(/-/g, '+').replace(/_/g, '/'));
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function currentSub() {
  var reg = await navigator.serviceWorker.getRegistration('/sw.js').catch(function () { return null; }) ||
    await navigator.serviceWorker.getRegistration().catch(function () { return null; });
  if (!reg || !reg.pushManager) return null;
  return reg.pushManager.getSubscription();
}

async function refreshPush() {
  var p = T.push;
  if (!pushSupported()) { p.state = 'unsupported'; return; }
  if (Notification.permission === 'denied') { p.state = 'denied'; return; }
  try {
    var sub = await currentSub();
    p.state = sub && Notification.permission === 'granted' ? 'on' : 'off';
  } catch (e) { p.state = 'off'; }
}

async function enablePush() {
  var p = T.push;
  p.busy = true; p.msg = ''; kit.render();
  try {
    var perm = await Notification.requestPermission();
    if (perm !== 'granted') { p.state = perm === 'denied' ? 'denied' : 'off'; p.msg = 'Разрешение на уведомления не выдано.'; return; }
    var reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    var cfg = await call('GET', '/push/config');
    var sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(cfg.publicKey) });
    var j = sub.toJSON();
    await call('POST', '/push/subscribe', { endpoint: j.endpoint, keys: j.keys });
    p.state = 'on'; p.msg = 'Уведомления включены на этом устройстве.';
  } catch (e) {
    p.msg = 'Не удалось включить уведомления: ' + (e && e.message ? e.message : 'ошибка');
  } finally {
    p.busy = false; kit.render();
  }
}

async function disablePush() {
  var p = T.push;
  p.busy = true; p.msg = ''; kit.render();
  try {
    var sub = await currentSub();
    if (sub) {
      var endpoint = sub.endpoint;
      await call('POST', '/push/unsubscribe', { endpoint: endpoint }).catch(function () {});
      await sub.unsubscribe();
    }
    p.state = 'off'; p.msg = 'Уведомления на этом устройстве выключены.';
  } catch (e) {
    p.msg = 'Не удалось выключить: ' + (e && e.message ? e.message : 'ошибка');
  } finally {
    p.busy = false; kit.render();
  }
}

async function testPush() {
  var p = T.push;
  p.busy = true; p.msg = ''; kit.render();
  try {
    await call('POST', '/push/test');
    p.msg = 'Тестовое уведомление отправлено — оно должно прийти через несколько секунд.';
  } catch (e) {
    p.msg = e.message || 'Не удалось отправить тестовое уведомление.';
  } finally {
    p.busy = false; kit.render();
  }
}

var pushChecked = false;
function pushBox() {
  var p = T.push;
  if (!pushChecked) { pushChecked = true; refreshPush().then(function () { kit.render(); }); }
  var kids = [h('div', { class: 'cl-push-title', text: '🔔 Уведомления о сроках' })];
  var disabled = p.busy ? 'disabled' : null;
  if (p.state === 'unsupported') {
    kids.push(h('div', { class: 'cl-muted', text: 'Этот браузер не поддерживает уведомления. На iPhone добавьте сайт на экран «Домой» и откройте его оттуда; на Android и компьютере подойдёт Chrome.' }));
  } else if (p.state === 'denied') {
    kids.push(h('div', { class: 'cl-muted', text: 'Уведомления запрещены в настройках браузера для этого сайта. Разрешите их в настройках сайта и вернитесь сюда.' }));
  } else if (p.state === 'on') {
    kids.push(h('div', { class: 'cl-muted', text: 'Включены на этом устройстве: напоминание придёт, даже если программа закрыта.' }));
    kids.push(h('div', { class: 'cl-form-actions' },
      h('button', { type: 'button', class: 'btn', disabled: disabled, 'data-role': 'push-test', onclick: testPush, text: 'Проверить' }),
      h('button', { type: 'button', class: 'btn', disabled: disabled, 'data-role': 'push-off', onclick: disablePush, text: 'Выключить' })));
  } else {
    kids.push(h('div', { class: 'cl-muted', text: 'Включите, чтобы получать напоминания о задачах на это устройство.' }));
    kids.push(h('div', { class: 'cl-form-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', disabled: disabled, 'data-role': 'push-on', onclick: enablePush, text: 'Включить уведомления' })));
  }
  if (p.msg) kids.push(h('div', { class: 'cl-hint', role: 'status', text: p.msg }));
  return h.apply(null, ['div', { class: 'cl-push', 'data-role': 'push-box' }].concat(kids));
}

// ----------------------------------------------- вход из уведомления и ссылок

function openFromNotification() { if (kit.getToken()) openAll(); }

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker.addEventListener) {
  navigator.serviceWorker.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'open-tasks') openFromNotification();
  });
}

try {
  var params = new URLSearchParams(window.location.search);
  if (params.get('open') === 'clients') setTimeout(openFromNotification, 600);
} catch (e) { /* ничего страшного */ }

kit.EXT.tasksBlock = tasksBlock;
kit.EXT.viewAll = viewAll;
kit.EXT.listTop = listTop;
kit.EXT.reset = function () { T.key = null; T.form = null; };
kit.EXT.reload = function () { T.key = null; };

window.Modul3D.clientTasks = { openAll: openAll, dueLabel: dueLabel };
})();
