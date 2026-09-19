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

// Отверстия должны быть В САМОЙ ГЕОМЕТРИИ детали, а не наклеены поверх.
// Раньше деталь резалась булевым вычитанием (csg.js) и в заглушке всегда
// уходила на запасной путь — проверить было нечего. Теперь геометрия
// считается аналитически (buildSlabGeometry во viewer.js), поэтому здесь
// можно смотреть на настоящие треугольники: у детали с присадкой их
// заметно больше, чем у простого кубика (12), но и не десятки тысяч, как
// было при булевом вычитании.
check('присадка вырезана в геометрии детали', () => {
  let withCuts = 0, heaviest = 0;
  viewer.group.children.forEach((o) => {
    let tris = 0;
    o.children.forEach((c) => {
      const a = c.isMesh && c.geometry && c.geometry.attributes
        && c.geometry.attributes.position && c.geometry.attributes.position.array;
      if (a) tris += a.length / 9;
    });
    if (tris > 12) withCuts += 1;
    heaviest = Math.max(heaviest, tris);
  });
  if (!withCuts) { fails.push('ни у одной детали нет вырезов в геометрии'); return false; }
  if (heaviest > 8000) { fails.push(`деталь на ${heaviest} треугольников — топология поехала`); return false; }
  return true;
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

// ===========================================================================
// ГЕОМЕТРИЯ ВЫРЕЗОВ ПО ВСЕМ РЕАЛЬНЫМ ДЕТАЛЯМ
// ===========================================================================
// Два класса ошибок раньше проходили мимо прогонов, потому что смотрели
// только «сколько треугольников у детали»:
//   • вырез уезжал ЗА габарит детали (лунка в торец, построенная наружу,
//     висела трубой в воздухе рядом с деталью; паз-четверть по кромке
//     рисовал полоску дна за пластью);
//   • отверстие молча ПРОПАДАЛО — его считали «утопленным» в соседнее
//     крупное гнездо по одному лишь центру, хотя край отверстия выходил
//     наружу (так исчезало крепление фасада Ø4 рядом с эксцентриком Ø15).
// Поэтому теперь проверяем саму геометрию каждой детали модели: вершины —
// внутри габарита, у каждого отверстия детали есть свой вырез, и ни один
// кусок геометрии не оторван от поверхности.
const MMs = 0.001;
// Детали, которые рисуются не пластью, а отдельной моделью (опора, ручка,
// штифт, штанга) — у них своей присадки нет.
const NOT_SLAB = new Set(['cylinder', 'handleKnob', 'handleBowH', 'handleBowV', 'pin', 'flange', 'cylinderX']);

// Модель специально пошире, чем сцена выше: кухня с ящиками и столешницей,
// шкаф с перегородкой, полками и штангой, повёрнутый угловой узел — чтобы
// под проверку попали все виды присадки (эксцентрик, дюбель, лунка в торец,
// полкодержатель, петля, крепление фасада) и все ориентации детали.
const drillModel = B.engine.buildModel({
  bodyThickness: 18, backThickness: 3,
  decor: DECORS[1], facadeDecor: DECORS[0], backMaterial: BACK_MATERIALS[0],
  drawerDecor: DECORS[1], drawerThickness: 16, jointType: 'minifix', worktopDepth: 600,
  modules: [
    { name: 'Кухня 800', family: 'kitchen', width: 800, height: 820, depth: 560, topType: 'solid',
      leftSide: 'floor', rightSide: 'floor', base: { type: 'legsPlinth', legHeight: 100 },
      countertop: { enabled: true, decorCode: ((B.catalog.COUNTERTOP_MATERIALS || [])[0] || {}).code,
        overhangFront: 20, overhangLeft: 0, overhangRight: 0 },
      sections: [{ shelves: 0, drawers: 3, facade: 'drawers', drawerSystem: 'quadro', handle: 'bow160' }] },
    { name: 'Угловой', family: 'kitchen', width: 900, height: 820, depth: 560, topType: 'rails', corner: true,
      leftSide: 'floor', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft', handle: 'bow160' }] },
    { name: 'Шкаф', family: 'case', width: 1600, height: 2200, depth: 600, topType: 'panel',
      leftSide: 'floor', rightSide: 'floor', base: { type: 'plinth', plinthHeight: 100 },
      sections: [{ shelves: 4, drawers: 0, facade: 'doorLeft' },
        { shelves: 2, drawers: 3, facade: 'drawers' },
        { shelves: 1, drawers: 0, facade: 'doorRight', rod: true, rodHeight: 1900 }] },
  ],
});

// Собираем по одной детали: описание вырезов (slabCutsForPart) + сама
// геометрия (buildSlabGeometry) — ровно то же, что делает Viewer3D.render().
function slabParts(m) {
  const out = [];
  for (const row of m.parts) {
    if (NOT_SLAB.has(row.shape)) continue;
    if ((row.frameW || 0) > 0 && row.facadeType !== 'mdfMilled') continue;   // рамочный фасад — другая сборка
    const sw = (row.rot || 0) === 90 || (row.rot || 0) === 270;
    const cuts = B.viewer.slabCutsForPart(row, sw ? row.box.d : row.box.w, sw ? row.box.w : row.box.d);
    // Координаты отверстий запоминаем ДО сборки: buildSlabGeometry дописывает
    // в них кольца и при вырожденных данных подвинет центр внутрь детали —
    // проверять надо по тому, что просила присадка, а не по итогу.
    const want = {
      holes: cuts.holes.map((h) => ({ u: h.u, v: h.v, r: h.r, dir: h.dir, depth: h.depth, through: !!h.through })),
      edges: cuts.edgeHoles.map((h) => ({ alongU: h.alongU, atStart: h.atStart, uPos: h.uPos, vPos: h.vPos, r: h.r, len: h.len })),
    };
    const built = B.viewer.buildSlabGeometry({
      uSize: cuts.uSize, vSize: cuts.vSize, tSize: cuts.tSize,
      holes: cuts.holes, edgeHoles: cuts.edgeHoles, grooves: cuts.grooves, uv: false,
    });
    const arr = built.geometry.attributes.position.array;
    const pts = [];
    for (let i = 0; i < arr.length; i += 3) pts.push([arr[i] / MMs, arr[i + 1] / MMs, arr[i + 2] / MMs]);
    out.push({ row, cuts, want, pts, tris: built.triangles });
  }
  return out;
}
const slabs = [].concat(slabParts(model), slabParts(drillModel));

check('вырезы не выходят за габарит детали', () => {
  const bad = [];
  for (const s of slabs) {
    const lim = [s.cuts.uSize / 2, s.cuts.vSize / 2, s.cuts.tSize / 2];
    let worst = 0;
    for (const p of s.pts) for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(p[k]) - lim[k]);
    if (worst > 0.05) bad.push(`${s.row.name} (${s.row.module}) на ${worst.toFixed(2)} мм`);
  }
  if (bad.length) { fails.push('геометрия вылезла за деталь: ' + bad.slice(0, 4).join('; ')); return false; }
  return true;
});

check('каждое отверстие детали попало в геометрию', () => {
  const bad = [];
  for (const s of slabs) {
    const nHoles = (s.row.holes || []).filter((h) => h.d > 0).length;
    if (nHoles !== s.want.holes.length + s.want.edges.length) {
      bad.push(`${s.row.name}: отверстий ${nHoles}, вырезов ${s.want.holes.length + s.want.edges.length}`);
      continue;
    }
    const ht = s.cuts.tSize / 2, hu = s.cuts.uSize / 2, hv = s.cuts.vSize / 2;
    // Есть ли в геометрии кольцо радиуса r вокруг точки (cx,cy) на плоскости
    // axis=plane: именно кольцо на УСТЬЕ, иначе соседнее соосное отверстие с
    // другой пласти засчиталось бы за это.
    const ringAt = (axis, plane, cx, cy, r) => {
      const o1 = axis === 0 ? 1 : 0, o2 = axis === 2 ? 1 : 2;
      for (const p of s.pts) {
        if (Math.abs(p[axis] - plane) > 0.05) continue;
        if (Math.abs(Math.hypot(p[o1] - cx, p[o2] - cy) - r) < 0.2) return true;
      }
      return false;
    };
    s.want.holes.forEach((h) => {
      // Отверстие, целиком утопленное в более крупное гнездо с той же
      // стороны, на поверхность не выходит — его «вырез» и есть это гнездо.
      const sunk = s.want.holes.some((g) => g !== h && g.r >= h.r
        && (g.through || g.dir === h.dir)
        && Math.hypot(g.u - h.u, g.v - h.v) + h.r <= g.r + 1e-6);
      if (sunk) return;
      if (!ringAt(2, h.dir * ht, h.u - hu, h.v - hv, h.r)) {
        bad.push(`${s.row.name}: Ø${(h.r * 2).toFixed(1)} в пласти (u=${h.u.toFixed(0)}, v=${h.v.toFixed(0)}) без выреза`);
      }
    });
    s.want.edges.forEach((h) => {
      const atStart = h.atStart != null ? h.atStart : (h.alongU ? h.uPos < 0 : h.vPos < 0);
      const axis = h.alongU ? 0 : 1;
      const plane = h.alongU ? (atStart ? -hu : hu) : (atStart ? -hv : hv);
      const cx = h.alongU ? h.vPos : h.uPos;
      if (!ringAt(axis, plane, cx, 0, h.r)) {
        bad.push(`${s.row.name}: Ø${(h.r * 2).toFixed(1)} в торец (u=${h.uPos.toFixed(0)}, v=${h.vPos.toFixed(0)}) без выреза`);
      }
    });
  }
  if (bad.length) { fails.push(`отверстий без выреза ${bad.length}: ` + bad.slice(0, 4).join('; ')); return false; }
  return true;
});

// Отдельная страховка на вырожденные данные (их в обычной модели нет, но
// вручную заданное отверстие такое даёт): лунка глубже самой детали, отверстие
// у самой кромки и отверстие крупнее детали не должны ни вылезать наружу, ни
// уходить от чужой кромки.
check('вырожденная присадка остаётся внутри детали', () => {
  const ed = B.viewer.edgeDrill(0, 30, 40, 100, 50);     // планка 40 мм, сверление на 50
  if (ed.atStart !== true) { fails.push('edgeDrill потерял кромку сверления'); return false; }
  const cases = [
    { name: 'лунка глубже детали', spec: { uSize: 40, vSize: 100, tSize: 18, holes: [], grooves: [],
      edgeHoles: [{ alongU: ed.alongU, atStart: ed.atStart, uPos: ed.uPos, vPos: ed.vPos, len: ed.len, r: 2.5, N: 6 }] } },
    { name: 'отверстие на кромке', spec: { uSize: 200, vSize: 100, tSize: 18, edgeHoles: [], grooves: [],
      holes: [{ u: 0, v: 50, r: 7.5, N: 16, dir: 1, depth: 12, through: false }] } },
    { name: 'паз за габаритом', spec: { uSize: 500, vSize: 300, tSize: 18, holes: [], edgeHoles: [],
      grooves: [{ u0: -5, u1: 3, v0: -10, v1: 310, depth: 8, dir: 1 }] } },
  ];
  for (const c of cases) {
    const g = B.viewer.buildSlabGeometry(c.spec).geometry.attributes.position.array;
    const lim = [c.spec.uSize / 2, c.spec.vSize / 2, c.spec.tSize / 2];
    let worst = 0;
    for (let i = 0; i < g.length; i += 3) for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(g[i + k] / MMs) - lim[k]);
    if (worst > 0.05) { fails.push(`${c.name}: геометрия вышла за деталь на ${worst.toFixed(2)} мм`); return false; }
  }
  return true;
});

check('у детали нет геометрии, оторванной от поверхности', () => {
  const bad = [];
  for (const s of slabs) {
    // Склеиваем вершины по координатам (0,01 мм) и считаем связные куски:
    // лунка, построенная мимо поверхности, окажется отдельным куском.
    const id = new Map(); const vid = [];
    for (const p of s.pts) {
      const k = p.map((q) => Math.round(q * 100)).join(',');
      if (!id.has(k)) id.set(k, id.size);
      vid.push(id.get(k));
    }
    const par = []; for (let i = 0; i < id.size; i++) par.push(i);
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let t = 0; t + 2 < vid.length; t += 3) {
      const a = find(vid[t]), b = find(vid[t + 1]), c = find(vid[t + 2]);
      if (a !== b) par[b] = a;
      if (a !== c) par[find(c)] = a;
    }
    const roots = new Set();
    for (let t = 0; t + 2 < vid.length; t += 3) roots.add(find(vid[t]));
    if (roots.size > 1) bad.push(`${s.row.name}: кусков ${roots.size}`);
  }
  if (bad.length) { fails.push('оторванная геометрия: ' + bad.slice(0, 4).join('; ')); return false; }
  return true;
});

if (fails.length) {
  console.log('VIEWER: ПРОВАЛ');
  fails.forEach((f) => console.log('  x ' + f));
  process.exit(1);
}
console.log(`VIEWER: сцена строится, детали режутся (${slabs.length} деталей: вырезы в габарите, присадка на месте), выбор мышью работает — ОК`);
