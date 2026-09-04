// tools/viewer.js
// ============================================================================
// Прогон 3D-СЛОЯ без браузера: на заглушке Three.js реально строится сцена
// по модели и проверяется то, что глазами видно на экране, — что деталь
// собралась, что у каждого куска есть имя модуля (иначе не выделить кликом)
// и что клик по детали действительно находит её модуль.
//
// Запуск:  node tools/viewer.js
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { THREE } = require('./three-stub.js');

const ROOT = path.join(__dirname, '..');
const fails = [];
const check = (name, fn) => {
  try { if (fn() !== true) fails.push(name); } catch (e) { fails.push(`${name}: ${e.message}`); }
};

// --- минимальный DOM для woodTexture и контейнера ---------------------------
const host = {
  style: {}, clientWidth: 900, clientHeight: 600, children: [],
  appendChild(c) { this.children.push(c); return c; },
  addEventListener() {}, removeEventListener() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 600 }),
};
const document = {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => null }),
  addEventListener() {}, removeEventListener() {},
};

const sandbox = { window: {}, document, THREE, console, Math, Date, Buffer, requestAnimationFrame: () => 0 };
sandbox.window.THREE = THREE;      // viewer.js берёт библиотеку из window
sandbox.window.window = sandbox.window;
sandbox.window.document = document;
sandbox.window.addEventListener = () => {};
sandbox.window.devicePixelRatio = 1;
vm.createContext(sandbox);

for (const f of ['catalog.js', 'presets.js', 'engine.js', 'specification.js', 'legMeshes.js', 'csg.js', 'viewer.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'), sandbox, { filename: f });
}
const B = sandbox.window.Modul3D;

const { DECORS, BACK_MATERIALS } = B.catalog;
const model = B.engine.buildModel({
  bodyThickness: 18, backThickness: 3,
  decor: DECORS[1], facadeDecor: DECORS[0], backMaterial: BACK_MATERIALS[0],
  drawerDecor: DECORS[1], drawerThickness: 16, jointType: 'minifix', worktopDepth: 600,
  modules: [
    { name: 'Модуль 1', family: 'kitchen', width: 600, height: 820, depth: 510, topType: 'rails',
      leftSide: 'floor', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft', handle: 'bow160' }] },
    { name: 'Модуль 2', family: 'kitchen', width: 800, height: 820, depth: 510, topType: 'rails',
      leftSide: 'onBottom', rightSide: 'floor', base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 0, drawers: 3, facade: 'drawers', handle: 'bow160', drawerSystem: 'quadro' }] },
  ],
});

const viewer = new B.viewer.Viewer3D(host);
let rendered = true;
try {
  viewer.render(model, { hideFacades: false, drillCheck: false, highlightModule: 'Модуль 2' });
} catch (e) {
  rendered = false;
  fails.push('render упал: ' + e.message);
}

check('сцена не пустая', () => rendered && viewer.group.children.length > 0);

// Каждая видимая деталь обязана знать свой модуль — иначе её не выделить
check('у всех объектов сцены есть имя модуля', () => {
  let bad = 0;
  viewer.group.children.forEach((o) => { if (!o.userData.module) bad += 1; });
  if (bad) fails.push(`объектов без модуля: ${bad}`);
  return bad === 0;
});

// Клик: луч должен вернуть кусок детали, а по нему — найтись модуль
check('клик по детали находит модуль', () => {
  const rc = new THREE.Raycaster();
  const hits = rc.intersectObjects(viewer.group.children, true)
    .filter((h) => h.object && h.object.isMesh);   // как в самом вьювере
  if (!hits.length) { fails.push('луч не нашёл ни одной детали'); return false; }
  const ownerOf = (obj) => {
    for (let o = obj; o; o = o.parent) if (o.userData && o.userData.module) return o.userData.module;
    return null;
  };
  const named = hits.filter((h) => ownerOf(h.object));
  if (named.length !== hits.length) {
    fails.push(`без владельца ${hits.length - named.length} из ${hits.length} попаданий`);
    return false;
  }
  return true;
});

// Деталь с присадкой собирается из НЕСКОЛЬКИХ слоёв — значит отверстия
// вырезаны в геометрии, а не наклеены поверх
check('деталь с присадкой режется на слои', () => {
  let layered = 0;
  viewer.group.children.forEach((o) => {
    const meshes = o.children.filter((c) => c.isMesh && c.geometry && c.geometry.kind === 'extrude');
    if (meshes.length > 1) layered += 1;
  });
  if (!layered) fails.push('ни одна деталь не разрезана на слои');
  return layered > 0;
});

// Контуры деталей не должны участвовать в выборе: у линий в Three порог
// попадания — целая единица, и клик «цепляется» за чужой модуль.
check('выбор игнорирует контуры деталей', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'viewer.js'), 'utf8');
  if (src.indexOf('isMesh') === -1) { fails.push('во вьювере нет отбора попаданий по деталям'); return false; }
  if (!/params\.Line/.test(src)) { fails.push('порог попадания по линиям не уменьшен'); return false; }
  return true;
});

// Режим проверки присадки: метки появляются и тоже принадлежат модулю
check('режим проверки присадки строит метки', () => {
  viewer.render(model, { hideFacades: false, drillCheck: true, highlightModule: null });
  let markers = 0;
  viewer.group.children.forEach((o) => o.traverse((c) => {
    if (c.isMesh && c.geometry && c.geometry.kind === 'cyl') markers += 1;
  }));
  if (markers < 4) fails.push(`меток присадки ${markers} — слишком мало`);
  return markers >= 4;
});

// В режиме проверки пол должен становиться прозрачным — иначе присадку
// снизу (гнёзда в дне, крепление дна ящика) не рассмотреть.
check('пол прозрачный в режиме проверки', () => {
  viewer.render(model, { drillCheck: true });
  const f = viewer._floor;
  if (!f) { fails.push('пол не найден'); return false; }
  if (!f.material.transparent || f.material.opacity >= 0.5) {
    fails.push('пол не стал прозрачным'); return false;
  }
  viewer.render(model, { drillCheck: false });
  if (viewer._floor.material.transparent) { fails.push('пол остался прозрачным вне режима'); return false; }
  return true;
});

// Метки присадки должны быть видны СКВОЗЬ полупрозрачные детали, иначе
// мелкие отверстия внутри корпуса не рассмотреть.
check('метки присадки рисуются поверх деталей', () => {
  viewer.render(model, { drillCheck: true });
  let markers = 0, onTop = 0;
  viewer.group.children.forEach((o) => o.traverse((c) => {
    if (c.userData && c.userData.drill) {
      markers += 1;
      if (c.material && c.material.depthTest === false && c.renderOrder > 0) onTop += 1;
    }
  }));
  if (!markers) { fails.push('меток присадки нет'); return false; }
  if (onTop !== markers) { fails.push(`меток поверх ${onTop} из ${markers}`); return false; }
  return true;
});

// Зацепы направляющей в стенках короба обязаны попасть в 3D
check('зацепы направляющей есть в сцене', () => {
  const pins = model.partsRaw
    .reduce((n, p) => n + (p.holes || []).filter((h) => /runnerPin/.test(h.kind)).length, 0);
  if (!pins) return true;                  // в этой модели скрытых направляющих нет
  viewer.render(model, { drillCheck: true });
  let drawn = 0;
  viewer.group.children.forEach((o) => o.traverse((c) => {
    if (c.userData && /runnerPin/.test(c.userData.drill || '')) drawn += 1;
  }));
  if (drawn < pins) { fails.push(`меток зацепов ${drawn} при ${pins} отверстиях`); return false; }
  return true;
});

// Фильтр присадки: в сцене остаются метки только выбранного вида
check('фильтр присадки оставляет один вид', () => {
  // Берём вид присадки, который в этой модели точно есть
  const anyKind = (model.partsRaw.filter((p) => (p.holes || []).length)[0].holes[0] || {}).kind;
  viewer.render(model, { drillCheck: true, drillFilter: anyKind });
  const kinds = new Set();
  viewer.group.children.forEach((o) => o.traverse((c) => {
    if (c.userData && c.userData.drill) kinds.add(c.userData.drill);
  }));
  if (!kinds.size) { fails.push('фильтр убрал вообще все метки'); return false; }
  if (kinds.size !== 1 || !kinds.has(anyKind)) {
    fails.push('фильтр оставил лишние виды: ' + Array.from(kinds).join(','));
    return false;
  }
  viewer.render(model, { drillCheck: true });
  return true;
});

if (fails.length) {
  console.log('VIEWER: ПРОВАЛ');
  fails.forEach((f) => console.log('  x ' + f));
  process.exit(1);
}
console.log('VIEWER: сцена строится, детали режутся, выбор мышью работает — ОК');
