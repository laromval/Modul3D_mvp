// «Снимок 3D-вида в проект клиента»: кнопка с фотоаппаратом на панели режимов
// 3D (#vtSnapBtn в index.html). Снимает то, что сейчас на экране, спрашивает,
// в какой проект какого клиента положить, отправляет картинку на Google Диск
// пользователя (src/cloudDrive.js) и создаёт карточку в «Файлах» проекта
// (src/clientFiles.js: kit.files.saveImage). Подключается после clientFiles.js.
//
// Весь текст пользователя — только через textContent, как в остальном разделе.

(function () {
'use strict';

var kit = window.Modul3D && window.Modul3D.clientsKit;
var btn = document.getElementById('vtSnapBtn');
if (!kit || !btn || !kit.files) return;
var h = kit.h, call = kit.call;

var DEST_KEY = 'modul3d.snap.dest';
var M = null;            // состояние окна или null, если закрыто
var overlay = null;

function cloud() { return window.Modul3D && window.Modul3D.cloud; }
function drive() { var c = cloud(); return c && c.active(); }

function pad(n) { return (n < 10 ? '0' : '') + n; }
function defaultTitle() {
  var d = new Date();
  return 'Вид 3D ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function lastDest() {
  try { return JSON.parse(localStorage.getItem(DEST_KEY)) || {}; } catch (e) { return {}; }
}
function rememberDest(clientId, projectId) {
  try { localStorage.setItem(DEST_KEY, JSON.stringify({ clientId: clientId, projectId: projectId || '' })); } catch (e) { /* приватный режим */ }
}

function close() {
  if (M && M.preview) { try { URL.revokeObjectURL(M.preview); } catch (e) { /* ничего */ } }
  M = null;
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  overlay = null;
  document.removeEventListener('keydown', onKey, true);
}

function onKey(e) {
  if (e.key === 'Escape' && M && !M.busy) { e.stopPropagation(); close(); }
}

function clientName(id) {
  var c = (M.clients || []).filter(function (x) { return x.id === id; })[0];
  return c ? c.name : '';
}
function projectName(id) {
  var p = (M.projects || []).filter(function (x) { return x.id === id; })[0];
  return p ? p.name : '';
}

async function loadProjects(clientId, wantProject) {
  M.projects = []; M.projectId = '';
  if (!clientId) { render(); return; }
  var mine = M;
  M.loadingProjects = true; render();
  try {
    var info = await call('GET', '/clients/' + clientId);
    if (M !== mine || M.clientId !== clientId) return;
    M.projects = info.projects || [];
    var ok = M.projects.filter(function (p) { return p.id === wantProject; })[0];
    M.projectId = ok ? ok.id : '';
  } catch (e) {
    if (M === mine) M.error = e.message || 'Не удалось загрузить проекты.';
  }
  if (M === mine && M.clientId === clientId) { M.loadingProjects = false; render(); }
}

async function save() {
  if (!M || M.busy) return;
  var d = drive();
  if (!d || !M.clientId || !M.blob) return;
  var title = (M.title || '').trim() || defaultTitle();
  // Вход в Google — сразу, из обработчика нажатия (иначе окно входа заблокируют).
  var ready = d.connect();
  M.busy = true; M.error = '';
  render();
  var mine = M;
  try {
    await ready;
    var scope = { clientId: M.clientId, projectId: M.projectId || null,
      clientName: clientName(M.clientId), projectName: projectName(M.projectId) };
    await kit.files.saveImage(scope, M.blob, title, M.item);
    rememberDest(M.clientId, M.projectId);
    kit.files.invalidate();
    if (M !== mine) return;
    M.done = 'Снимок сохранён: «' + scope.clientName + (scope.projectId ? ' / ' + scope.projectName : '') + '». Он лежит на вашем Google Диске, в проекте — во вкладке «Файлы».';
  } catch (e) {
    if (M !== mine) return;
    M.error = e.message || 'Не удалось сохранить снимок.';
  }
  M.busy = false;
  render();
}

function render() {
  if (!M || !overlay) return;
  while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
  var kids = [h('h3', { class: 'cl-modal-title', text: 'Снимок 3D-вида в проект клиента' })];

  if (M.noAuth) {
    kids.push(h('p', { text: 'Чтобы сохранять снимки в проекты клиентов, войдите в свой аккаунт.' }));
  } else if (M.done) {
    kids.push(h('p', { class: 'cl-ok', role: 'status', text: M.done }));
  } else {
    if (M.preview) kids.push(h('img', { class: 'cl-snap-preview', alt: 'Снимок 3D-вида', src: M.preview }));
    else kids.push(h('div', { class: 'cl-hint', text: M.error && !M.blob ? '' : 'Готовлю снимок…' }));
    if (M.clients && !M.clients.length) {
      kids.push(h('p', { class: 'cl-hint', text: 'Пока нет ни одного клиента. Создайте клиента и проект в разделе «Клиенты» и повторите.' }));
    } else if (M.clients) {
      var cs = h('select', { class: 'cl-input', 'data-role': 'snap-client', disabled: M.busy ? '' : null, 'aria-label': 'Клиент',
        onchange: function (e) { M.clientId = e.target.value; M.error = ''; loadProjects(M.clientId, ''); } });
      M.clients.forEach(function (c) {
        var o = h('option', { value: c.id, text: c.name });
        if (c.id === M.clientId) o.selected = true;
        cs.appendChild(o);
      });
      var ps = h('select', { class: 'cl-input', 'data-role': 'snap-project', disabled: M.busy ? '' : null, 'aria-label': 'Проект',
        onchange: function (e) { M.projectId = e.target.value; } });
      var none = h('option', { value: '', text: 'Без проекта (общее для клиента)' });
      ps.appendChild(none);
      M.projects.forEach(function (p) {
        var o = h('option', { value: p.id, text: p.name });
        if (p.id === M.projectId) o.selected = true;
        ps.appendChild(o);
      });
      var title = h('input', { type: 'text', class: 'cl-input', maxlength: '200', autocomplete: 'off', 'data-role': 'snap-title',
        placeholder: 'Название снимка', disabled: M.busy ? '' : null, oninput: function (e) { M.title = e.target.value; } });
      title.value = M.title;
      kids.push(cs, ps, title);
    } else if (!M.error) {
      kids.push(h('div', { class: 'cl-hint', text: 'Загружаю список клиентов…' }));
    }
    if (M.error) kids.push(h('div', { class: 'cl-error', role: 'alert', text: M.error }));
  }

  var canSave = !M.noAuth && !M.done && M.blob && M.clients && M.clients.length && M.clientId && !M.loadingProjects;
  var d = drive();
  kids.push(h('div', { class: 'cl-form-actions' },
    canSave ? h('button', { type: 'button', class: 'btn btn-primary', 'data-role': 'snap-save', disabled: M.busy ? '' : null, onclick: save,
      text: M.busy ? 'Сохраняю…' : (d && d.hasToken() ? 'Сохранить на Google Диск' : 'Войти в Google и сохранить') }) : null,
    h('button', { type: 'button', class: 'btn', 'data-role': 'snap-close', disabled: M.busy ? '' : null, onclick: close, text: M.done || M.noAuth ? 'Закрыть' : 'Отмена' })));

  overlay.appendChild(h.apply(null, ['div', { class: 'cl-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Снимок 3D-вида в проект клиента' }].concat(kids)));
}

async function start() {
  if (M) return;
  var c = cloud(), v = window.Modul3D.viewer && window.Modul3D.viewer.current;
  overlay = h('div', { class: 'cl-modal-overlay', 'data-role': 'snap-overlay', onclick: function (e) { if (e.target === overlay && M && !M.busy) close(); } });
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey, true);
  M = { noAuth: !kit.getToken(), clients: null, projects: [], clientId: '', projectId: '', title: defaultTitle(),
    blob: null, preview: '', busy: false, error: '', done: '', item: {} };
  var mine = M;
  render();
  if (M.noAuth) return;

  // Кадр снимаем СРАЗУ, пока холст свежий; сжатие и список клиентов — потом.
  var shot = null;
  try { shot = v && v.captureImage ? v.captureImage() : null; } catch (e) { shot = null; }
  if (!shot || !c) { M.error = 'Не удалось сделать снимок 3D-вида.'; render(); return; }
  var d = drive();
  if (d && d.preload) d.preload().catch(function () { /* ошибка будет при входе */ });
  try {
    var jpeg = await c.prepareImage(c.dataUrlToBlob(shot), 1600, 0.9);
    if (M !== mine) return;
    M.blob = jpeg; M.preview = URL.createObjectURL(jpeg);
  } catch (e) {
    if (M !== mine) return;
    M.error = e.message || 'Не удалось подготовить снимок.'; render(); return;
  }
  render();
  try {
    var list = (await call('GET', '/clients')).clients || [];
    if (M !== mine) return;
    M.clients = list;
    var last = lastDest();
    var pick = list.filter(function (x) { return x.id === last.clientId; })[0] || list[0];
    M.clientId = pick ? pick.id : '';
    if (M.clientId) { await loadProjects(M.clientId, last.clientId === M.clientId ? last.projectId : ''); return; }
  } catch (e) {
    if (M !== mine) return;
    M.error = e.message || 'Не удалось загрузить клиентов.';
  }
  render();
}

btn.addEventListener('click', start);
})();
