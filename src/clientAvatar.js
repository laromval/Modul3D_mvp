// Аватар клиента: фото с телефона (галерея или камера) хранится на Google
// Диске пользователя (папка Modul3D/<клиент>/Общее), у нас — только карточка
// файла с пометкой «аватар» (сервер: routes/files.js, миграция 011).
// Показывается в карточке клиента и в списке, попадает в vCard при «Сохранить
// в контакты». Расширяет src/clients.js через window.Modul3D.clientsKit.
// Весь текст — через textContent; картинка — blob-адрес из своего же Диска.

(function () {
'use strict';

var kit = window.Modul3D && window.Modul3D.clientsKit;
if (!kit) return;
var h = kit.h, call = kit.call, S = kit.S;

var AV = {
  blobs: {},   // driveFileId -> Blob
  urls: {},    // driveFileId -> blob-адрес ('' — файла нет на Диске)
  busy: {},
  fail: {},    // driveFileId -> когда не загрузилось из-за сбоя сети
  menu: false,
  busyUpload: false,
  notice: '',
  error: ''
};

function cloud() { return window.Modul3D && window.Modul3D.cloud; }
function drive() { var c = cloud(); return c && c.active(); }

function initials(name) {
  var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  var a = parts[0].charAt(0), b = parts.length > 1 ? parts[1].charAt(0) : '';
  return (a + b).toUpperCase();
}

function repaint() {
  var ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;   // не мешаем вводу
  kit.render();
}

// Фото грузим только если вход в Google уже есть: окно входа само не выскакивает.
function ensure(c) {
  var id = c && c.avatarFileId, d = drive();
  if (!id || id in AV.urls || AV.busy[id] || !d || !d.hasToken()) return;
  if (AV.fail[id] && Date.now() - AV.fail[id] < 30000) return;
  AV.busy[id] = true;
  d.fetchBlob(id).then(function (b) {
    AV.blobs[id] = b; AV.urls[id] = URL.createObjectURL(b);
  }, function (e) {
    if (e && (e.code === 'notfound' || e.code === 'forbidden')) AV.urls[id] = '';
    else AV.fail[id] = Date.now();
  }).then(function () { delete AV.busy[id]; repaint(); });
}

function circle(c, size) {
  ensure(c);
  var url = c.avatarFileId ? AV.urls[c.avatarFileId] : '';
  var box = h('span', { class: 'cl-avatar cl-avatar-' + size, 'data-role': 'avatar' });
  if (url) box.appendChild(h('img', { src: url, alt: '' }));
  else box.appendChild(h('span', { class: 'cl-avatar-ini', 'aria-hidden': 'true', text: initials(c.name) }));
  return box;
}

function patchClient(id, fields) {
  if (S.client && S.client.id === id) Object.assign(S.client, fields);
  (S.clients || []).forEach(function (x) { if (x.id === id) Object.assign(x, fields); });
}

function pick(c, camera) {
  var d = drive();
  if (!d) { AV.error = 'Google Диск недоступен.'; kit.render(); return; }
  if (!d.hasToken()) {
    // Окно входа Google открываем отдельным нажатием, фото выбираем следующим.
    d.connect().then(function () { AV.notice = 'Google Диск подключён — выберите фото ещё раз.'; AV.error = ''; kit.render(); },
      function (e) { AV.error = (e && e.message) || 'Не удалось войти в Google.'; kit.render(); });
    return;
  }
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  if (camera) inp.setAttribute('capture', 'user');
  inp.style.display = 'none';
  inp.addEventListener('change', function () {
    var f = inp.files && inp.files[0];
    if (inp.parentNode) inp.parentNode.removeChild(inp);
    if (f) upload(c, f);
  });
  document.body.appendChild(inp);
  inp.click();
}

async function upload(c, file) {
  var cl = cloud(), d = drive();
  if (!/^image\//i.test(file.type || '')) { AV.error = 'Нужна картинка (JPG, PNG…).'; kit.render(); return; }
  AV.error = ''; AV.notice = 'Загружаю фото…'; AV.busyUpload = true; kit.render();
  try {
    var jpeg = await cl.prepareImage(file, 512, 0.85);
    var rec = await d.upload([c.name || 'Клиент', 'Общее'], jpeg, cl.cleanName('Фото клиента', 'Фото') + '.jpg', 'image/jpeg');
    var r;
    try {
      r = await call('POST', '/files', { clientId: c.id, kind: 'drive', title: 'Фото клиента', url: rec.url,
        driveFileId: rec.fileId, mime: rec.mime || 'image/jpeg', sizeBytes: rec.size, avatar: true });
    } catch (e) {
      e.message = 'Фото сохранено на Google Диске, но не привязано к клиенту: ' + e.message;
      throw e;
    }
    AV.blobs[rec.fileId] = jpeg; AV.urls[rec.fileId] = URL.createObjectURL(jpeg);
    patchClient(c.id, { avatarId: r.file.id, avatarFileId: rec.fileId });
    AV.notice = 'Фото сохранено на ваш Google Диск.';
  } catch (e) {
    AV.notice = ''; AV.error = (e && e.message) || 'Не удалось загрузить фото.';
  }
  AV.busyUpload = false;
  kit.render();
}

async function removeAvatar(c) {
  if (!window.confirm('Убрать фото клиента? Сам файл останется на вашем Google Диске.')) return;
  AV.error = ''; AV.notice = '';
  try {
    await call('DELETE', '/files/' + c.avatarId);
    patchClient(c.id, { avatarId: null, avatarFileId: null });
  } catch (e) { AV.error = (e && e.message) || 'Не удалось убрать фото.'; }
  kit.render();
}

// Большой аватар в карточке клиента: по нажатию — меню.
function node(c, size) {
  if (size !== 'lg') return circle(c, size);
  var btn = h('button', { type: 'button', class: 'cl-avatar-btn', 'data-role': 'avatar-btn', 'aria-label': 'Фото клиента',
    'aria-haspopup': 'true', 'aria-expanded': AV.menu ? 'true' : 'false',
    onclick: function () { AV.menu = !AV.menu; AV.notice = ''; AV.error = ''; kit.render(); } }, circle(c, 'lg'));
  var box = h('div', { class: 'cl-menu-wrap cl-avatar-wrap' }, btn);
  if (AV.menu) {
    var pop = h('div', { class: 'popover cl-menu-pop cl-avatar-pop', role: 'menu' });
    var item = function (role, text, fn, cls) {
      pop.appendChild(h('button', { type: 'button', class: 'ctx-item' + (cls ? ' ' + cls : ''), role: 'menuitem', 'data-role': role, text: text,
        onclick: function () { AV.menu = false; fn(); } }));
    };
    item('avatar-pick', '🖼 Фото из галереи', function () { pick(c, false); });
    item('avatar-camera', '📷 Снять на камеру', function () { pick(c, true); });
    if (c.avatarId) item('avatar-remove', '🗑 Убрать фото', function () { removeAvatar(c); }, 'cl-danger');
    box.appendChild(pop);
  }
  return box;
}

// Сообщение под именем (загрузка / ошибка).
function status() {
  if (AV.error) return h('div', { class: 'cl-error', role: 'alert', text: AV.error });
  if (AV.notice) return h('div', { class: 'cl-hint', role: 'status', text: AV.notice });
  return null;
}

function blobToBase64(blob) {
  return new Promise(function (resolve, reject) {
    var fr = new FileReader();
    fr.onload = function () { resolve(String(fr.result).split(',')[1] || ''); };
    fr.onerror = function () { reject(fr.error); };
    fr.readAsDataURL(blob);
  });
}

// Фото для vCard (base64 JPEG) или null — без входа в Google просто не добавляем.
async function photoBase64(c) {
  var id = c && c.avatarFileId, d = drive();
  if (!id) return null;
  try {
    var b = AV.blobs[id];
    if (!b && d && d.hasToken()) { b = await d.fetchBlob(id); AV.blobs[id] = b; }
    return b ? await blobToBase64(b) : null;
  } catch (e) { return null; }
}

document.addEventListener('click', function (e) {
  if (AV.menu && !(e.target.closest && e.target.closest('.cl-avatar-wrap'))) { AV.menu = false; kit.render(); }
});

kit.avatar = { node: node, status: status, photoBase64: photoBase64 };
})();
