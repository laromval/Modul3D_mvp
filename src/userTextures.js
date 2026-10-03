// Пользовательские текстуры листов материалов («Добавить по ссылке» → ссылка на
// страницу декора у производителя). Готовая картинка хранится ТОЛЬКО на
// компьютере пользователя (IndexedDB браузера), на сервер и хостинг не уходит:
// в каталог/на сервер едут лишь textureUrl и textureSiteId самого материала.
//
// Запись в IndexedDB: ключ — code материала, значение {code, tileMM, tileMM2, k,
// src}. При старте init() регистрирует все записи в
// window.Modul3D.decorTiles.byCode в том же формате, что и встроенные плитки
// (sheet:true, mode:'mirror' — лист лежит длинной стороной по оси x текстуры),
// после чего зовёт колбэк onChange — app.js по нему делает recompute().
// Коды LINK-<timestamp> уникальны, конфликтов со встроенными плитками нет.
//
// Если IndexedDB недоступна (приватный режим, ограничения file://) — приложение
// молча работает без текстур, но уже загруженные в этом сеансе картинки живут в
// byCode до перезагрузки страницы.
(function () {
  'use strict';
  const root = (window.Modul3D = window.Modul3D || {});

  const DB_NAME = 'modul3dUserTextures';
  const STORE = 'tiles';
  const MAX_SIDE = 2560;       // длинная сторона готовой картинки, px
  const MAX_DATA_URI = 1.5e6;  // потолок размера data-URI, символов (~1.5 МБ)
  const PACK_FORMAT = 'modul3d-user-textures';
  // Фрагмент (Kronospan, kind:'fragment'): картинка небольшого куска декора без
  // известного физического масштаба — рисуем зеркальным повтором (sheet:false).
  // Масштаб подобран грубо, решение за пользователем: меняется только здесь.
  // Свои коды: LINK-/FAC-LINK-/CTOP-LINK- + метка времени. Встроенные плитки
  // (decorTiles.js) этим кодам не соответствуют и не затираются.
  const CODE_RE = /^(LINK|FAC-LINK|CTOP-LINK)-\d+$/;
  const FRAGMENT_TILE_MM = { x: 1300, y: 1950 };

  // Коды, чьи записи в byCode принадлежат нам (удалять из byCode можно только их).
  const userCodes = new Set();
  let dbPromise = null;
  let onChange = null;

  function tilesMap() {
    const dt = root.decorTiles;
    return dt && dt.byCode ? dt.byCode : null;
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined' || !indexedDB) { resolve(null); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'code' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (err) { resolve(null); }
    });
    return dbPromise;
  }

  // Обёртка над одной операцией хранилища; при любой ошибке отдаёт fallback —
  // отсутствие БД не должно ронять приложение.
  function dbRun(mode, fn, fallback) {
    return openDb().then((db) => {
      if (!db) return fallback;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE, mode);
          const result = fn(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(result && 'result' in result ? result.result : fallback);
          tx.onerror = () => resolve(fallback);
          tx.onabort = () => resolve(fallback);
        } catch (err) { resolve(fallback); }
      });
    });
  }

  function register(rec) {
    const map = tilesMap();
    if (!map || !rec || !CODE_RE.test(String(rec.code || '')) || !rec.src) return;
    map[rec.code] = { tileMM: rec.tileMM, tileMM2: rec.tileMM2, sheet: rec.sheet !== false, mode: 'mirror', k: rec.k, src: rec.src };
    userCodes.add(rec.code);
  }

  function notify() {
    if (typeof onChange === 'function') { try { onChange(); } catch (err) { console.error(err); } }
  }

  // Читает все записи, регистрирует их и зовёт колбэк. Возвращает промис (всегда
  // успешный), число загруженных текстур.
  function init(cb) {
    if (typeof cb === 'function') onChange = cb;
    return dbRun('readonly', (st) => st.getAll(), []).then((rows) => {
      (rows || []).forEach(register);
      if (rows && rows.length) notify();
      return rows ? rows.length : 0;
    }).catch(() => 0);
  }

  function has(code) { return !!code && userCodes.has(code); }

  function save(code, tile) {
    if (!CODE_RE.test(String(code || '')) || !tile || !tile.src) return Promise.resolve(false);
    const rec = { code, tileMM: tile.tileMM, tileMM2: tile.tileMM2, sheet: tile.sheet !== false, k: tile.k, src: tile.src };
    register(rec);   // в память сразу, даже если IndexedDB недоступна
    return dbRun('readwrite', (st) => { st.put(rec); return null; }, null).then(() => { notify(); return true; });
  }

  function remove(code) {
    if (!CODE_RE.test(String(code || ''))) return Promise.resolve(false);
    const map = tilesMap();
    if (userCodes.has(code)) {
      userCodes.delete(code);
      if (map) delete map[code];
    }
    return dbRun('readwrite', (st) => { st.delete(code); return null; }, null).then(() => true);
  }

  // Загружает blob как картинку (Image через object URL — работает и на file://).
  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть картинку (нужен JPEG или PNG).')); };
      img.src = url;
    });
  }

  // Картинка листа -> плитка для вьювера. sheetW/sheetH — размеры листа материала
  // из полей формы (мм). Вертикальный лист поворачивается на 90° (длинная сторона
  // по x), масштаб до длинной стороны <= 2560 px, JPEG 0.72; k приглушает яркий
  // декор (как в tools/texture-convert/bake_tile.py: min(1, 0.88*170/средняя_яркость)).
  function convertSheet(blob, dims) {
    const fragment = !!(dims && dims.kind === 'fragment');
    const w = fragment ? FRAGMENT_TILE_MM.x : Number(dims && dims.sheetW);
    const h = fragment ? FRAGMENT_TILE_MM.y : Number(dims && dims.sheetH);
    if (!(w > 0) || !(h > 0)) return Promise.reject(new Error('Укажите длину и ширину листа в мм.'));
    return loadImage(blob).then((img) => {
      const iw = img.naturalWidth, ih = img.naturalHeight;
      if (!iw || !ih) throw new Error('Пустая картинка.');
      const rotate = !fragment && ih > iw;   // фрагмент не поворачиваем
      const lw = rotate ? ih : iw, lh = rotate ? iw : ih;   // размер лежачего листа
      let scale = Math.min(1, MAX_SIDE / lw);
      let quality = 0.72;
      let src = '';
      let canvas;
      for (let attempt = 0; attempt < 6; attempt++) {
        const cw = Math.max(1, Math.round(lw * scale)), ch = Math.max(1, Math.round(lh * scale));
        canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (rotate) {
          // поворот на 90° по часовой: исходный верх -> право
          ctx.translate(cw, 0);
          ctx.rotate(Math.PI / 2);
          ctx.drawImage(img, 0, 0, ch, cw);
        } else {
          ctx.drawImage(img, 0, 0, cw, ch);
        }
        src = canvas.toDataURL('image/jpeg', quality);
        if (src.length <= MAX_DATA_URI) break;
        if (quality > 0.5) quality -= 0.1; else scale *= 0.8;
      }
      // Средняя яркость по уменьшенной копии (достаточно для множителя).
      const probe = document.createElement('canvas');
      probe.width = 64; probe.height = Math.max(1, Math.round(64 * canvas.height / canvas.width));
      const pctx = probe.getContext('2d');
      pctx.drawImage(canvas, 0, 0, probe.width, probe.height);
      const px = pctx.getImageData(0, 0, probe.width, probe.height).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const L = sum / (px.length / 4) || 170;
      const k = Math.round(Math.min(1, 0.88 * 170 / L) * 100) / 100;
      if (fragment) return { tileMM: w, tileMM2: h, sheet: false, k, src };
      // Соотношение сторон картинки главнее заявленного размера листа: при
      // расхождении больше 5% подгоняем tileMM2, иначе рисунок растянется.
      const tileMM = Math.max(w, h);
      let tileMM2 = Math.min(w, h);
      const real = lh / lw;
      const mismatch = Math.abs(real / (tileMM2 / tileMM) - 1) > 0.05;
      if (mismatch) tileMM2 = Math.round(tileMM * real);
      return { tileMM, tileMM2, sheet: true, k, src, mismatch };
    });
  }

  // Резервная копия: все пользовательские текстуры одним JSON-файлом.
  function exportPack() {
    return dbRun('readonly', (st) => st.getAll(), []).then((rows) => {
      const items = {};
      (rows || []).forEach((r) => { items[r.code] = { tileMM: r.tileMM, tileMM2: r.tileMM2, sheet: r.sheet !== false, k: r.k, src: r.src }; });
      // Если IndexedDB недоступна — берём то, что живёт в памяти.
      const map = tilesMap();
      userCodes.forEach((c) => { if (!items[c] && map && map[c]) items[c] = { tileMM: map[c].tileMM, tileMM2: map[c].tileMM2, sheet: map[c].sheet !== false, k: map[c].k, src: map[c].src }; });
      return new Blob([JSON.stringify({ format: PACK_FORMAT, version: 1, items })], { type: 'application/json' });
    });
  }

  // Загрузка набора из файла; возвращает { loaded, skipped }.
  function importPack(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('Не удалось прочитать файл.'));
      fr.onload = () => resolve(String(fr.result || ''));
      fr.readAsText(file);
    }).then((text) => {
      let data;
      try { data = JSON.parse(text); } catch (err) { throw new Error('Это не файл набора текстур.'); }
      if (!data || data.format !== PACK_FORMAT || !data.items || typeof data.items !== 'object') throw new Error('Это не файл набора текстур Modul3D.');
      const all = Object.keys(data.items);
      const codes = all.filter((c) => {
        const t = data.items[c];
        return CODE_RE.test(c) && t && typeof t.src === 'string' && t.src.length <= 3e6
          && /^data:image\/jpeg;base64,/.test(t.src)
          && Number.isFinite(t.k) && t.k > 0 && t.k <= 1
          && t.tileMM > 0 && t.tileMM <= 10000 && t.tileMM2 > 0 && t.tileMM2 <= 10000;
      });
      return Promise.all(codes.map((c) => save(c, data.items[c])))
        .then(() => ({ loaded: codes.length, skipped: all.length - codes.length }));
    });
  }

  root.userTextures = { init, convertSheet, save, remove, has, exportPack, importPack };
})();
