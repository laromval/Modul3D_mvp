// «Файлы» проекта клиента: пока ссылки из интернета (хранятся у нас, в базе,
// зашифрованно). Скриншоты и файлы на Google Диске пользователя — следующий
// этап. Расширяет src/clients.js (подключается после него, берёт общий набор
// window.Modul3D.clientsKit). Сервер: routes/files.js (миграция 010).
//
// Весь текст пользователя вставляется через textContent — никакого innerHTML;
// ссылкой делается только адрес, начинающийся с http:// или https://.

(function () {
'use strict';

var kit = window.Modul3D && window.Modul3D.clientsKit;
if (!kit) return;
var h = kit.h, call = kit.call, S = kit.S, plural = kit.plural;

var F = {
  key: null,     // 'p:<id>' — чьи файлы загружены
  items: [],
  loading: false,
  error: '',
  form: null     // { id|null, title, url, error }
};

function safeHref(u) { return /^https?:\/\//i.test(String(u || '')) ? u : null; }

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

function fmtDay(iso) {
  try { return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; }
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

function ensure(scope) {
  var key = 'p:' + (scope.projectId || 'none:' + scope.clientId);
  if (F.key === key) return key;
  F.key = key; F.items = []; F.error = ''; F.form = null;
  load(key, scope);
  return key;
}

async function reload(scope) { await load(F.key, scope); }

async function act(scope, fn) {
  F.error = '';
  try { await fn(); } catch (e) { F.error = e.message || 'Не удалось выполнить операцию.'; }
  await reload(scope);
}

function removeFile(scope, f) {
  if (!window.confirm('Удалить «' + f.title + '» из проекта? Саму страницу в интернете это не затронет.')) return;
  return act(scope, function () { return call('DELETE', '/files/' + f.id); });
}

async function submitForm(scope) {
  var f = F.form;
  var url = f.url.trim();
  if (!url) { f.error = 'Вставьте адрес ссылки.'; kit.render(); return; }
  try {
    if (f.id) await call('PATCH', '/files/' + f.id, { url: url, title: f.title.trim() || hostOf(/^[a-z]+:/i.test(url) ? url : 'https://' + url) || url });
    else {
      var body = { clientId: scope.clientId, url: url };
      if (scope.projectId) body.projectId = scope.projectId;
      if (f.title.trim()) body.title = f.title.trim();
      await call('POST', '/files', body);
    }
    F.form = null;
  } catch (e) {
    f.error = e.message || 'Не удалось сохранить ссылку.';
    kit.render();
    return;
  }
  await reload(scope);
}

function openForm(file) {
  F.form = { id: file ? file.id : null, title: file ? file.title : '', url: file ? file.url : '', error: '' };
  kit.render();
}

function closeForm() { F.form = null; kit.render(); }

function linkForm(scope) {
  var f = F.form;
  var url = h('input', { type: 'url', inputmode: 'url', class: 'cl-input', maxlength: '2000', autocomplete: 'off',
    placeholder: 'Адрес ссылки: https://…', 'data-role': 'file-url', oninput: function (e) { f.url = e.target.value; } });
  url.value = f.url;
  var title = h('input', { type: 'text', class: 'cl-input', maxlength: '200', autocomplete: 'off',
    placeholder: 'Название (по желанию)', 'data-role': 'file-title', oninput: function (e) { f.title = e.target.value; } });
  title.value = f.title;
  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); submitForm(scope); }
    else if (e.key === 'Escape') { e.preventDefault(); closeForm(); }
  }
  url.addEventListener('keydown', onKey);
  title.addEventListener('keydown', onKey);
  setTimeout(function () { if (document.activeElement === document.body) url.focus(); }, 0);
  return h('div', { class: 'cl-form cl-task-form' }, url, title,
    f.error ? h('div', { class: 'cl-error', role: 'alert', text: f.error }) : null,
    h('div', { class: 'cl-form-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { submitForm(scope); }, text: f.id ? 'Сохранить' : 'Добавить' }),
      h('button', { type: 'button', class: 'btn', onclick: closeForm, text: 'Отмена' })));
}

function fileRow(scope, f) {
  var href = f.unreadable ? null : safeHref(f.url);
  var titleEl = href
    ? h('a', { class: 'cl-file-title', href: href, target: '_blank', rel: 'noopener noreferrer', text: f.title })
    : h('span', { class: 'cl-file-title', text: f.unreadable ? 'Не удалось расшифровать ссылку' : f.title });
  return h('div', { class: 'cl-file', 'data-role': 'file-row' },
    h('span', { class: 'cl-file-ico', 'aria-hidden': 'true', text: '🔗' }),
    h('div', { class: 'cl-task-body' },
      titleEl,
      h('div', { class: 'cl-muted cl-file-meta', text: (hostOf(f.url) ? hostOf(f.url) + ' · ' : '') + fmtDay(f.createdAt) }),
      h('div', { class: 'cl-note-actions' },
        f.unreadable ? null : h('button', { type: 'button', class: 'cl-link', text: 'Изменить', onclick: function () { openForm(f); } }),
        h('button', { type: 'button', class: 'cl-link cl-danger', text: 'Удалить', onclick: function () { removeFile(scope, f); } }))));
}

function filesBlock(scope) {
  ensure(scope);
  var kids = [h('div', { class: 'cl-section-head' }, h('h3', { class: 'drawer-section', text: 'Ссылки и файлы' }),
    F.form ? null : h('button', { type: 'button', class: 'cl-link', 'data-role': 'add-link', text: '＋ Ссылка', onclick: function () { openForm(null); } }))];
  if (F.error) kids.push(h('div', { class: 'cl-error', role: 'alert', text: F.error }));
  if (F.form && !F.form.id) kids.push(linkForm(scope));
  if (!F.items.length && !F.form && !F.loading) {
    kids.push(h('div', { class: 'cl-empty', text: 'Пока пусто. Добавьте ссылку на сайт, пример или поставщика — она будет под рукой в проекте.' }));
  }
  F.items.forEach(function (f) {
    if (F.form && F.form.id === f.id) kids.push(linkForm(scope));
    else kids.push(fileRow(scope, f));
  });
  kids.push(h('div', { class: 'cl-hint', text: 'Скриншоты и файлы с Google Диска появятся в следующем обновлении.' }));
  return h.apply(null, ['div', { class: 'cl-block', 'data-role': 'files-block' }].concat(kids));
}

var prevReset = kit.EXT.reset;
kit.EXT.reset = function () { if (prevReset) prevReset(); F.key = null; F.form = null; };
kit.EXT.filesBlock = filesBlock;
})();
