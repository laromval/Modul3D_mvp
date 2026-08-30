// src/hardwareMeshes.js
// ============================================================================
// Библиотека 3D-моделей фурнитуры (петли и т.п.) — реестр по строковому id,
// в отличие от legMeshes.js (там всего одна опора с двумя вариантами).
// Меши так же запечены в base64 (позиции + нормали, треугольники, без
// индексации) прямо в код — отдельного файла на диске приложение не грузит
// (нет сервера, весь конструктор — статичные .js через <script>).
//
// Формат данных для каждой записи в BUILTIN_MODELS — тот же, что у опор в
// legMeshes.js: { pos: base64(Float32Array позиций XYZ), norm: base64(Float32Array
// нормалей XYZ) }. Единицы и система координат — как в исходном .obj, который
// запекали (см. комментарий у конкретной модели, когда она появится).
//
// Реальные модели петель добавляются отдельным шагом — агент вручную
// запекает присланный пользователем .obj и кладёт запись в BUILTIN_MODELS.
// ============================================================================
(function () {
  'use strict';

  // Реестр встроенных моделей фурнитуры по id. Пока пусто — заполняется
  // отдельными задачами по мере запекания присланных .obj-файлов.
  const BUILTIN_MODELS = {
    // 'blum-clip-110': { pos: '...base64...', norm: '...base64...' },
  };

  // Декодирует base64-строку "сырых" байт Float32Array — 1:1 копия из
  // legMeshes.js (см. src/legMeshes.js:31-42): двойная совместимость с
  // atob (браузер) и Buffer (Node, для tools/smoke.js).
  function base64ToFloat32(b64) {
    let bytes;
    if (typeof atob === 'function') {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      // Node (headless-тесты) — atob нет в старых версиях, читаем через Buffer.
      bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    }
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  }

  const cache = {};

  // Есть ли встроенная модель фурнитуры с таким id.
  function has(id) {
    return Object.prototype.hasOwnProperty.call(BUILTIN_MODELS, id);
  }

  // Список id всех встроенных моделей — понадобится для UI выбора
  // "встроенная модель" (выпадающий список и т.п.).
  function list() {
    return Object.keys(BUILTIN_MODELS);
  }

  // Строит (и кеширует) THREE.BufferGeometry для модели фурнитуры по id.
  // Та же логика, что getGeometry(kind, THREE) в legMeshes.js — без index,
  // без uv, только position/normal. Масштаб и позиционирование в сцене
  // задаёт вызывающий код (viewer.js), а не эта модель.
  function getGeometry(id, THREE) {
    if (!has(id)) {
      throw new Error('hardwareMeshes: нет встроенной модели с id "' + id + '"');
    }
    if (cache[id]) return cache[id];
    const src = BUILTIN_MODELS[id];
    const positions = base64ToFloat32(src.pos);
    const normals = base64ToFloat32(src.norm);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    cache[id] = geo;
    return geo;
  }

  window.Modul3D = window.Modul3D || {};
  window.Modul3D.hardwareMeshes = { has, list, getGeometry };
})();
