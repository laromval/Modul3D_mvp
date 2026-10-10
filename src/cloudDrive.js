// Облачное хранилище пользователя для файлов проекта клиента (скриншоты, JPG,
// снимки 3D). Сейчас подключён только Google Диск; интерфейс (connect / upload /
// fetchBlob / ensurePath / label) сделан так, чтобы позже добавить другое облако
// (Яндекс Диск, Dropbox…) как ещё один объект в providers — экран «Файлы»
// (src/clientFiles.js) работает через window.Modul3D.cloud.active().
//
// Как работает Google Диск (всё прямо в браузере пользователя, наш сервер
// файлов и ключей доступа не видит и не хранит):
//  • вход — Google Identity Services, «token model»: короткий (≈1 час) токен
//    доступа живёт только в памяти страницы, refresh-токенов нет;
//  • область доступа — только drive.file: приложение видит лишь те файлы и
//    папки, которые создало само, остальной Диск пользователя ему недоступен;
//  • папки Modul3D / <Клиент> / <Проект> создаются при первой загрузке;
//  • файл уходит с телефона прямо в Google (multipart), к нам на сервер
//    попадает только карточка: название, ссылка и id файла (POST /files).
// Вход через Google работает только на https-адресах, разрешённых в Google
// Cloud (ai.modul3d.app, laromval.github.io), но не при открытии index.html с диска.
//
// Client ID — публичный (виден в любом сайте с «Войти через Google»), секрета
// в браузере нет и быть не должно.

(function () {
'use strict';

var GOOGLE_CLIENT_ID = '114766923932-t7kjmujib3o6sc1emunqhf8ede47uqgk.apps.googleusercontent.com';
var SCOPE = 'https://www.googleapis.com/auth/drive.file';
var GIS_SRC = 'https://accounts.google.com/gsi/client';
var API = 'https://www.googleapis.com/drive/v3/files';
var UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
var ROOT_FOLDER = 'Modul3D';
var FLAG_KEY = 'modul3d.cloud.google.connected';

function fail(message, code) {
  var e = new Error(message);
  e.code = code || 'error';
  return e;
}

// ---------- общие помощники для картинок ----------

// Имя папки/файла для Диска: без слэшей и управляющих символов, не пустое.
function cleanName(s, fallback) {
  var t = String(s == null ? '' : s).replace(/[\\/\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length > 100) t = t.slice(0, 100).trim();
  return t || fallback || 'Без названия';
}

function loadBitmap(blob) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(function () { return viaImage(blob); });
  }
  return viaImage(blob);
}

function viaImage(blob) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = function () { URL.revokeObjectURL(url); reject(fail('Не удалось прочитать картинку.', 'image')); };
    img.src = url;
  });
}

// Фото с телефона 4000+ px весят мегабайты — уменьшаем до maxSide по длинной
// стороне и сохраняем JPEG (прозрачность у PNG заливается белым).
function prepareImage(blob, maxSide, quality) {
  maxSide = maxSide || 1600;
  quality = quality || 0.85;
  return loadBitmap(blob).then(function (bmp) {
    var w = bmp.width || bmp.naturalWidth, hgt = bmp.height || bmp.naturalHeight;
    if (!w || !hgt) throw fail('Не удалось прочитать картинку.', 'image');
    var k = Math.min(1, maxSide / Math.max(w, hgt));
    var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(hgt * k));
    var canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(bmp, 0, 0, cw, ch);
    if (bmp.close) bmp.close();
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (out) {
        if (out) resolve(out); else reject(fail('Не удалось подготовить картинку.', 'image'));
      }, 'image/jpeg', quality);
    });
  });
}

function dataUrlToBlob(dataUrl) {
  var m = /^data:([^;,]+)(;base64)?,(.*)$/.exec(String(dataUrl || ''));
  if (!m) throw fail('Не удалось получить картинку.', 'image');
  var bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  var arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: m[1] });
}

// ---------- Google Диск ----------

var google = (function () {
  var token = null, expiresAt = 0;
  var tokenClient = null;
  var pending = null;            // { resolve, reject } текущего входа
  var gisPromise = null;
  var folderCache = {};          // 'Modul3D/Клиент/Проект' -> id папки

  function configured() { return !!GOOGLE_CLIENT_ID; }

  function hasToken() { return !!token && Date.now() < expiresAt - 60000; }

  function remembered() {
    try { return localStorage.getItem(FLAG_KEY) === '1'; } catch (e) { return false; }
  }
  function remember(on) {
    try { if (on) localStorage.setItem(FLAG_KEY, '1'); else localStorage.removeItem(FLAG_KEY); } catch (e) { /* приватный режим */ }
  }

  function loaded() { return !!(window.google && window.google.accounts && window.google.accounts.oauth2); }

  // Скрипт Google подгружается только когда понадобился (не тормозит старт приложения).
  function preload() {
    if (loaded()) return Promise.resolve();
    if (gisPromise) return gisPromise;
    gisPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = GIS_SRC; s.async = true; s.defer = true;
      s.onload = function () { loaded() ? resolve() : reject(fail('Вход Google недоступен.', 'gis')); };
      s.onerror = function () {
        gisPromise = null;
        reject(fail('Не удалось загрузить вход Google. Проверьте интернет.', 'gis'));
      };
      document.head.appendChild(s);
    });
    return gisPromise;
  }

  function hasAllScopes(resp) {
    try { return window.google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE); } catch (e) { return true; }
  }

  function ensureClient() {
    if (tokenClient) return tokenClient;
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: function (resp) {
        var p = pending; pending = null;
        if (!p) return;
        if (resp && resp.access_token && !hasAllScopes(resp)) {
          // В окне согласия сняли галочку «Диск»: токен есть, но прав нет.
          remember(false);
          p.reject(fail('Нужно разрешить доступ к файлам на Google Диске. Нажмите кнопку ещё раз и оставьте галочку.', 'denied'));
        } else if (resp && resp.access_token) {
          token = resp.access_token;
          expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
          remember(true);
          p.resolve();
        } else {
          p.reject(fail(resp && resp.error === 'access_denied'
            ? 'Доступ к Google Диску не разрешён.' : 'Не удалось войти в Google.', 'denied'));
        }
      },
      error_callback: function (err) {
        var p = pending; pending = null;
        if (!p) return;
        var t = err && err.type;
        p.reject(fail(t === 'popup_closed' ? 'Окно входа Google закрыто.'
          : t === 'popup_failed_to_open' ? 'Браузер заблокировал окно входа. Нажмите кнопку ещё раз.'
          : 'Не удалось войти в Google.', 'denied'));
      }
    });
    return tokenClient;
  }

  // ВАЖНО: вызывать прямо из обработчика нажатия кнопки — окно входа Google
  // браузер откроет только по жесту пользователя. Если токен ещё действует,
  // окна не будет вовсе.
  function connect() {
    if (!configured()) return Promise.reject(fail('Google Диск пока не настроен.', 'config'));
    if (hasToken()) return Promise.resolve();
    if (pending) return Promise.reject(fail('Вход уже идёт — завершите его в окне Google.', 'busy'));
    function ask() {
      return new Promise(function (resolve, reject) {
        pending = { resolve: resolve, reject: reject };
        try {
          ensureClient().requestAccessToken({ prompt: remembered() ? '' : 'consent' });
        } catch (e) {
          pending = null;
          reject(fail('Не удалось открыть вход Google.', 'gis'));
        }
      });
    }
    if (loaded()) return ask();
    return preload().then(ask);
  }

  function disconnect() {
    var t = token;
    token = null; expiresAt = 0; folderCache = {};
    remember(false);
    try { if (t && loaded()) window.google.accounts.oauth2.revoke(t, function () {}); } catch (e) { /* не страшно */ }
  }

  function describe(status, body) {
    var msg = '';
    try { msg = (body && body.error && body.error.message) || ''; } catch (e) { /* пусто */ }
    if (status === 401) return fail('Вход в Google истёк. Нажмите кнопку ещё раз.', 'auth');
    if (status === 403 && /rateLimit|userRateLimit/i.test(msg)) return fail('Google просит подождать. Повторите через минуту.', 'rate');
    if (status === 403 && /storageQuota|quota/i.test(msg)) return fail('На вашем Google Диске закончилось место.', 'quota');
    if (status === 403 && /not been used|disabled|accessNotConfigured/i.test(msg)) return fail('В Google Cloud не включён Drive API.', 'config');
    if (status === 403) return fail('Google Диск отказал в доступе. Попробуйте подключить его заново.', 'forbidden');
    if (status === 404) return fail('Файл или папка не найдены на Google Диске.', 'notfound');
    if (status === 429) return fail('Google просит подождать. Повторите через минуту.', 'rate');
    return fail('Google Диск вернул ошибку (' + status + ').', 'error');
  }

  function gfetch(url, opts) {
    if (!hasToken()) return Promise.reject(fail('Нужно подключить Google Диск.', 'auth'));
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers, { authorization: 'Bearer ' + token });
    return fetch(url, opts).catch(function () {
      throw fail('Нет связи с Google. Проверьте интернет.', 'network');
    }).then(function (res) {
      if (res.ok) return res;
      if (res.status === 401) { token = null; expiresAt = 0; }
      return res.json().catch(function () { return null; }).then(function (body) { throw describe(res.status, body); });
    });
  }

  function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

  function findOrCreateFolder(name, parentId) {
    var q = "mimeType='application/vnd.google-apps.folder' and name='" + esc(name) + "' and '" +
      parentId + "' in parents and trashed=false";
    var url = API + '?q=' + encodeURIComponent(q) + '&fields=' + encodeURIComponent('files(id)') + '&pageSize=1&spaces=drive';
    return gfetch(url).then(function (r) { return r.json(); }).then(function (j) {
      if (j.files && j.files.length) return j.files[0].id;
      return gfetch(API + '?fields=id', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
      }).then(function (r) { return r.json(); }).then(function (c) { return c.id; });
    });
  }

  // В кэше лежат промисы (а не готовые id): две загрузки подряд ждут одну и ту
  // же папку, а не создают две с одним именем. Неудача из кэша убирается.
  function folderAt(k, name, parentId) {
    if (folderCache[k]) return folderCache[k];
    var pr = findOrCreateFolder(name, parentId).catch(function (e) { delete folderCache[k]; throw e; });
    folderCache[k] = pr;
    return pr;
  }

  // ['Клиент', 'Проект'] -> id папки Modul3D/Клиент/Проект (создаёт недостающие).
  function ensurePath(names) {
    var parts = [ROOT_FOLDER].concat(names.map(function (n) { return cleanName(n); }));
    var chain = Promise.resolve('root'), acc = [];
    parts.forEach(function (name) {
      acc.push(name);
      var k = acc.join('/');
      chain = chain.then(function (parent) { return folderAt(k, name, parent); });
    });
    return chain;
  }

  function uploadTo(parentId, blob, name, mime) {
    var boundary = 'm3d' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    var meta = JSON.stringify({ name: name, parents: [parentId], mimeType: mime });
    var body = new Blob([
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n',
      '--' + boundary + '\r\nContent-Type: ' + mime + '\r\n\r\n',
      blob,
      '\r\n--' + boundary + '--'
    ]);
    var fields = 'id,name,mimeType,size,webViewLink';
    return gfetch(UPLOAD + '?uploadType=multipart&fields=' + fields, {
      method: 'POST',
      headers: { 'content-type': 'multipart/related; boundary=' + boundary },
      body: body
    }).then(function (r) { return r.json(); });
  }

  // Кладёт файл в Modul3D/<names…>. Если папку удалили на Диске вручную —
  // сбрасываем запомненные id и пробуем один раз заново.
  function upload(names, blob, fileName, mime) {
    function once() {
      return ensurePath(names).then(function (parentId) { return uploadTo(parentId, blob, fileName, mime); });
    }
    return once().catch(function (e) {
      if (e && e.code === 'notfound') { folderCache = {}; return once(); }
      throw e;
    }).then(function (f) {
      if (!f || !f.id) throw fail('Google Диск не вернул файл.', 'error');
      return {
        fileId: f.id,
        name: f.name,
        mime: f.mimeType || mime,
        size: Number(f.size) || blob.size,
        url: f.webViewLink || ('https://drive.google.com/file/d/' + f.id + '/view')
      };
    });
  }

  function fetchBlob(fileId) {
    return gfetch(API + '/' + encodeURIComponent(fileId) + '?alt=media').then(function (r) { return r.blob(); });
  }

  return {
    id: 'google',
    label: 'Google Диск',
    configured: configured,
    hasToken: hasToken,
    remembered: remembered,
    preload: preload,
    connect: connect,
    disconnect: disconnect,
    upload: upload,
    fetchBlob: fetchBlob
  };
})();

var providers = { google: google };

window.Modul3D = window.Modul3D || {};
window.Modul3D.cloud = {
  providers: providers,
  active: function () { return providers.google; },
  prepareImage: prepareImage,
  dataUrlToBlob: dataUrlToBlob,
  cleanName: cleanName
};
})();
