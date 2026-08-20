// viewer.js
// ============================================================================
// 3D Viewer / Renderer — визуализирует model.parts (из engine.js) в реальном
// времени. Ничего не хранит независимо: при каждом пересчёте параметров
// сцена полностью перестраивается из тех же parts, что идут в деталировку.
//
// ВАЖНО: Three.js подключается в index.html классическим <script src="...">
// (глобальная переменная window.THREE), а не через ES-import с import-map.
// Import maps не поддерживаются частью браузеров/встроенных webview — при их
// отсутствии весь модульный граф не грузится, и страница остаётся пустой.
// Глобальный скрипт работает везде, поэтому здесь THREE берётся из window.
// Управление камерой (вращение/зум) реализовано без внешней зависимости от
// OrbitControls.js, чтобы не тянуть ещё один внешний файл с CDN.
// Классический скрипт (без import/export) — публикует себя в window.Modul3D.
// ============================================================================
(function () {
const THREE = window.THREE;
const MM = 0.001; // мм -> м

// Текстура ЛДСП рисуется прямо в браузере: полосы «под древесину». Так не
// нужны внешние файлы, а фасад из ЛДСП визуально отличается от гладкого МДФ.
let _woodTex = null;
function woodTexture() {
  if (_woodTex) return _woodTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#d8c8a8';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 140; i++) {
    const y = Math.random() * 256;
    const a = 0.05 + Math.random() * 0.10;
    g.strokeStyle = `rgba(120, 92, 54, ${a})`;
    g.lineWidth = 0.5 + Math.random() * 1.6;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + (Math.random() - 0.5) * 6);
    g.stroke();
  }
  _woodTex = new THREE.CanvasTexture(c);
  _woodTex.wrapS = THREE.RepeatWrapping;
  _woodTex.wrapT = THREE.RepeatWrapping;
  return _woodTex;
}

// Цвет детали по её МАТЕРИАЛУ: белый корпус должен быть белым и в 3D, а не
// «древесным» по типу детали. Ищем материал в каталоге и смотрим на название.
function decorLook(code) {
  const cat = (typeof window !== 'undefined' && window.Modul3D && window.Modul3D.catalog) || {};
  const fac = cat.FACADE_MATERIALS || {};
  const all = [].concat(cat.DECORS || [], cat.BACK_MATERIALS || [],
    Object.keys(fac).map((k) => fac[k]));
  const it = all.filter((x) => x && x.code === code)[0];
  const nm = (it && it.name) || '';
  if (!nm) return null;
  if (/бел/i.test(nm)) return { color: 0xf3f1ec, wood: false };
  if (/чёрн|черн/i.test(nm)) return { color: 0x35332f, wood: false };
  if (/шпон|дуб|сонома|крафт|массив|орех|ясен/i.test(nm)) return { color: 0xc9a76a, wood: true };
  if (/крашен|эмал|плёнк|пленк|мдф/i.test(nm)) return { color: 0xf2efe9, wood: false };
  return null;
}


// ---------------------------------------------------------------------------
// ГЕОМЕТРИЯ ДЕТАЛИ С ВЫРЕЗАМИ
// ---------------------------------------------------------------------------
// Раньше деталь была простым кубом, а присадка и паз рисовались наклейками
// поверх граней: отверстие выглядело чёрной точкой, а задняя стенка просто
// пересекала боковину. Теперь деталь режется по-настоящему: она собирается
// из слоёв по толщине, и в каждом слое вырезаны те отверстия и пазы, которые
// на эту глубину заходят. Глухое отверстие получает дно, паз — реальную
// канавку, сквозное отверстие видно насквозь.
//
//   uSize/vSize — габариты ПЛАСТИ детали, tSize — её толщина;
//   cuts        — вырезы в координатах пласти: {u,v,r} или {u0,v0,u1,v1};
//   каждый вырез знает глубину и с какой стороны он сделан.
// Как ложится локальная система координат детали на её пласть: у двери
// длина горизонтальна, у боковины и доборной планки — вертикальна.
// Возвращает true, если локальная ось X идёт вдоль «u» (первой оси пласти).
function lengthAlongU(partLength, uSize, vSize) {
  return Math.abs(partLength - uSize) <= Math.abs(partLength - vSize);
}

// Куда сверлится отверстие «в торец»: от какой кромки и вдоль какой оси.
function edgeDrill(u, v, uSize, vSize, depth) {
  const atU = (u <= 0.5) || (u >= uSize - 0.5);
  const dLen = Math.max(depth || 30, 8);
  const uPos = atU ? ((u <= 0.5 ? dLen / 2 : uSize - dLen / 2) - uSize / 2) : (u - uSize / 2);
  const vPos = atU ? (v - vSize / 2) : ((v <= 0.5 ? dLen / 2 : vSize - dLen / 2) - vSize / 2);
  return { alongU: atU, uPos, vPos, len: dLen };
}

function panelSlabs(uSize, vSize, tSize, cuts) {
  const bounds = new Set([0, tSize]);
  for (const c of cuts) {
    const d = c.through ? tSize : Math.min(c.depth || 0, tSize);
    if (d <= 0) continue;
    bounds.add(c.fromFront ? d : tSize - d);
  }
  const list = Array.from(bounds).sort((a, b) => a - b);
  const slabs = [];
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i], b = list[i + 1];
    if (b - a < 0.05) continue;
    const active = cuts.filter((c) => {
      if (c.through) return true;
      const d = Math.min(c.depth || 0, tSize);
      return c.fromFront ? (b <= d + 0.01) : (a >= tSize - d - 0.01);
    });
    slabs.push({ a, b, cuts: active });
  }
  return slabs;
}

function slabGeometry(uSize, vSize, thick, cuts, MMv) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(uSize * MMv, 0);
  shape.lineTo(uSize * MMv, vSize * MMv);
  shape.lineTo(0, vSize * MMv);
  shape.lineTo(0, 0);
  for (const c of cuts) {
    const path = new THREE.Path();
    if (c.r) {
      path.absarc(c.u * MMv, c.v * MMv, Math.max(c.r * MMv, 0.0005), 0, Math.PI * 2, true);
    } else {
      const u0 = Math.max(Math.min(c.u0, c.u1), 0) * MMv;
      const u1 = Math.min(Math.max(c.u0, c.u1), uSize) * MMv;
      const v0 = Math.max(Math.min(c.v0, c.v1), 0) * MMv;
      const v1 = Math.min(Math.max(c.v0, c.v1), vSize) * MMv;
      if (u1 - u0 < 1e-6 || v1 - v0 < 1e-6) continue;
      path.moveTo(u0, v0);
      path.lineTo(u0, v1);
      path.lineTo(u1, v1);
      path.lineTo(u1, v0);
      path.lineTo(u0, v0);
    }
    shape.holes.push(path);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thick * MMv, bevelEnabled: false, curveSegments: 16,
  });
  // Центрируем слой по всем трём осям: дальше его останется только
  // развернуть в мировые оси и сдвинуть на свою глубину.
  geo.translate(-uSize * MMv / 2, -vSize * MMv / 2, -thick * MMv / 2);
  return geo;
}

// РЕЖИМ ПРОВЕРКИ ПРИСАДКИ: цвет метки по назначению отверстия. Оператору
// достаточно взгляда, чтобы понять, что за отверстие и куда оно смотрит.
const DRILL_COLOR = {
  minifixCam: 0xd94040,
  minifixBolt: 0xe08a2e,
  minifixDowel: 0x2f7fd9,
  confirmatThrough: 0x7a4fd9,
  confirmatEdge: 0x9b6bff,
  hingeCup: 0x17a06a,
  hingePlate: 0x3ec98a,
  shelfSupport: 0xb59a10,
  drawerRunner: 0xd94fb0,
  frontFix: 0x0f9bb5,
  relingFix: 0x6ec6d6,
  handle: 0x2b2b2b,
  rodFlange: 0x8a5a2b,
  legFix: 0x777777,
  boxBottomFix: 0x8fae3a,
  runnerLocator: 0xc0468f,
  runnerLatch: 0x8e2f6b,
  runnerBracket: 0x2f8e6d,
  runnerPinRear: 0x6d2f8e,
  runnerPinFront: 0x8e6d2f,
  runnerPinCabinet: 0x2f6d8e,
  dowelEdge: 0xb07a2b,
  dowelFace: 0xd9a05b,
};
const DRILL_TITLE = {
  minifixCam: 'Rastex, эксцентрик Ø15',
  minifixBolt: 'Rastex, шток Ø8 в торец',
  minifixDowel: 'Rastex, дюбель Ø8',
  confirmatThrough: 'Конфирмат, сквозное Ø7',
  confirmatEdge: 'Конфирмат, в торец Ø5',
  hingeCup: 'Петля, чашка Ø35',
  hingePlate: 'Петля, ответная планка',
  shelfSupport: 'Полкодержатель Ø5',
  drawerRunner: 'Направляющая ящика',
  frontFix: 'Крепление фасада к ящику',
  relingFix: 'Держатель релинга',
  handle: 'Ручка',
  rodFlange: 'Держатель штанги',
  legFix: 'Опора',
  boxBottomFix: 'Крепление дна ящика',
  runnerLocator: 'Посадка короба на направляющую',
  runnerLatch: 'Гнездо защёлки короба',
  runnerBracket: 'Отверстия для фиксатора',
  runnerPinRear: 'Задний штифт направляющей',
  runnerPinFront: 'Зацеп фиксатора',
  runnerPinCabinet: 'Передний штифт направляющей',
  dowelEdge: 'Нагель Ø8 в торец',
  dowelFace: 'Нагель Ø8 в пласть',
};

const KIND_COLOR = {
  side: 0xd8c8a8, top: 0xd8c8a8, bottom: 0xd8c8a8, divider: 0xd8c8a8, plinth: 0xb9a67e,
  shelf: 0xe0d2b4, back: 0xf2efe6,
  door: 0xc9a76a, drawerFront: 0xc9a76a,
  drawerBottom: 0xded2bb, drawerBack: 0xded2bb, drawerSide: 0xded2bb,
  leg: 0x5a5a5a,
};

// Подсказка осей на экране «Дополнительные отверстия»: X-ребро детали —
// красным, Y-ребро — зелёным, чтобы было видно, куда физически смотрит
// каждая ось при вводе кастомных координат X/Y.
const AXIS_X_COLOR = 0xe03131;
const AXIS_Y_COLOR = 0x2f9e44;

// Цвета активного (редактируемого) модуля — синий, чтобы сразу было видно,
// какой именно модуль сейчас меняется в панели слева.
const HIGHLIGHT_COLOR = {
  side: 0x7fb0d8, top: 0x7fb0d8, bottom: 0x7fb0d8, divider: 0x7fb0d8, plinth: 0x5f95c0,
  shelf: 0x9cc4e2, back: 0xdfeaf4,
  door: 0x6fa3cd, drawerFront: 0x6fa3cd,
  drawerBottom: 0x9cc4e2, drawerBack: 0x9cc4e2, drawerSide: 0x9cc4e2,
  leg: 0x41667f,
};

// Рамочный фасад: четыре бруска рамки и вставка. У витражных и алюминиевых
// вставка стеклянная и прозрачная, у глухого деревянного — филёнка из того же
// материала, утопленная в рамку.
function makeFramedFacade(box, row, isActive, ghost) {
  const g = new THREE.Group();
  const sw = row.rot === 90 || row.rot === 270;
  const W = (sw ? box.d : box.w) * MM, H = box.h * MM, T = (sw ? box.w : box.d) * MM;
  const fw = Math.min((row.frameW || 70) * MM, Math.min(W, H) / 2 - 0.005);
  const frameColor = isActive ? 0x6fa3cd : (row.insertMaterial === 'GLASS-4' && row.facadeType === 'alu' ? 0x8d9296 : 0xc9a76a);
  const matFrame = new THREE.MeshStandardMaterial({
    color: frameColor, roughness: row.facadeType === 'alu' ? 0.3 : 0.7,
    metalness: row.facadeType === 'alu' ? 0.8 : 0.05,
    transparent: ghost, opacity: ghost ? 0.22 : 1, depthWrite: !ghost,
  });
  const addBar = (w, h, x, y) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.001), Math.max(h, 0.001), T), matFrame);
    m.position.set(x, y, 0);
    g.add(m);
  };
  addBar(W, fw, 0, H / 2 - fw / 2);          // верх
  addBar(W, fw, 0, -H / 2 + fw / 2);         // низ
  addBar(fw, H - 2 * fw, -W / 2 + fw / 2, 0); // левая стойка
  addBar(fw, H - 2 * fw, W / 2 - fw / 2, 0);  // правая стойка

  // вставка
  const iw = Math.max(W - 2 * fw + 0.006, 0.001);
  const ih = Math.max(H - 2 * fw + 0.006, 0.001);
  const isGlass = row.insertMaterial === 'GLASS-4';
  const matIns = new THREE.MeshStandardMaterial({
    color: isGlass ? 0xbfe3ea : (isActive ? 0x7fb0d8 : 0xd8c8a8),
    roughness: isGlass ? 0.08 : 0.7, metalness: 0.02,
    transparent: isGlass || ghost, opacity: ghost ? 0.2 : (isGlass ? 0.35 : 1),
    depthWrite: !(isGlass || ghost),
  });
  const ins = new THREE.Mesh(new THREE.BoxGeometry(iw, ih, T * (isGlass ? 0.25 : 0.6)), matIns);
  ins.position.z = isGlass ? 0 : -T * 0.15;
  g.add(ins);

  g.position.set(box.x * MM, box.y * MM, box.z * MM);
  g.rotation.y = ((row.rot || 0) * Math.PI) / 180;
  g.userData.module = row.module;
  g.traverse((o) => { o.userData.module = row.module; });
  return g;
}

// Ручка на фасаде: кнопка — грибок на ножке, скоба — перекладина на двух
// стойках. Габарит берётся из детали, поэтому ручка стоит ровно там, где
// посчитаны отверстия присадки.
function makeHandle(box, shape, moduleName, isActive, cc, rotDeg, dimmed) {
  const g = new THREE.Group();
  const swapped = rotDeg === 90 || rotDeg === 270;
  box = swapped ? Object.assign({}, box, { w: box.d, d: box.w }) : box;
  const mat = new THREE.MeshStandardMaterial({
    color: isActive ? 0x9fc3de : 0xc9ccd0, roughness: 0.25, metalness: 0.9,
    emissive: isActive ? 0x14314a : 0x000000,
    transparent: !!dimmed, opacity: dimmed ? 0.22 : 1, depthWrite: !dimmed,
  });
  const out = box.d * MM;                       // вылет от фасада

  if (shape === 'handleKnob') {
    const d = box.w * MM;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(d * 0.16, d * 0.16, out * 0.6, 12), mat);
    stem.rotation.x = Math.PI / 2;
    stem.position.z = -out * 0.2;
    g.add(stem);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(d / 2, 16, 12), mat);
    cap.scale.z = 0.6;
    cap.position.z = out * 0.25;
    g.add(cap);
  } else {
    const vertical = shape === 'handleBowV';
    const len = (vertical ? box.h : box.w) * MM;
    const sec = (vertical ? box.w : box.h) * MM;   // сечение прутка
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(sec / 2, sec / 2, len - sec, 12), mat);
    if (!vertical) bar.rotation.z = Math.PI / 2;
    bar.position.z = out / 2 - sec / 2;
    g.add(bar);
    // Две стойки стоят РОВНО на межосевом расстоянии: их оси совпадают
    // с отверстиями присадки в фасаде. Раньше они считались от длины
    // перекладины и уезжали от отверстий на несколько миллиметров.
    const half = ((Number(cc) || 0) * MM) / 2 || (len / 2 - sec);
    const postLen = out - sec;
    for (const sgn of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(sec * 0.35, sec * 0.35, postLen, 10), mat);
      post.rotation.x = Math.PI / 2;
      post.position.z = -sec / 2;
      if (vertical) post.position.y = sgn * half;
      else post.position.x = sgn * half;
      g.add(post);
    }
  }

  g.position.set(box.x * MM, box.y * MM, box.z * MM);
  // Ручка разворачивается вместе со своим модулем: скоба должна идти вдоль
  // фасада, а не торчать из него поперёк.
  g.rotation.y = ((rotDeg || 0) * Math.PI) / 180;
  g.userData.module = moduleName;
  g.traverse((o) => { o.userData.module = moduleName; });
  return g;
}

// Штанга для одежды: хромированная труба поперёк секции (вдоль оси X).
function makeRod(box, moduleName, isActive, rotDeg, dimmed) {
  const sw = rotDeg === 90 || rotDeg === 270;
  const d = Math.max(box.h, sw ? box.w : box.d) * MM;
  const len = Math.max((sw ? box.d : box.w) * MM, 0.001);
  const steel = new THREE.MeshStandardMaterial({
    color: isActive ? 0x9fc3de : 0xd9dde0, roughness: 0.18, metalness: 0.95,
    emissive: isActive ? 0x14314a : 0x000000,
    transparent: !!dimmed, opacity: dimmed ? 0.22 : 1, depthWrite: !dimmed,
  });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, len, 20), steel);
  mesh.rotation.z = Math.PI / 2;            // ось трубы — вдоль X
  mesh.rotation.y = ((rotDeg || 0) * Math.PI) / 180;
  mesh.position.set(box.x * MM, box.y * MM, box.z * MM);
  mesh.userData.module = moduleName;
  return mesh;
}

// Опора мебельная: труба Ø d, монтажная площадка сверху (крепится к дну)
// и декоративное расширение у пола. Габарит по высоте — ровно h из модели,
// поэтому ножка не вылезает за расчётную высоту основания.
// Монтажная площадка 65×65 под дно, крепёжные отверстия 52×52 по углам —
// у металлической и у кухонной опоры одинаковые (см. АМЕТИСТ): переиспользуем
// одну и ту же геометрию для обеих.
function addLegMountPlate(g, material, h, PLATE_T, dimmed) {
  const p = 65 * MM;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(p, PLATE_T, p), material);
  plate.position.y = h / 2 - PLATE_T / 2;
  g.add(plate);

  const holeMat = new THREE.MeshStandardMaterial({
    color: 0x1c1d1e, roughness: 0.7, metalness: 0.1,
    transparent: !!dimmed, opacity: dimmed ? 0.22 : 1, depthWrite: !dimmed,
  });
  const holeD = 4 * MM;
  const holeDepth = PLATE_T * 0.65;
  const spacing = 52 * MM;
  const holeEps = 0.01 * MM;          // приподнять над пластью, чтобы не мерцало (мм-масштаб, не метры)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(holeD / 2, holeD / 2, holeDepth, 12), holeMat);
      hole.position.set(sx * spacing / 2, h / 2 - holeDepth / 2 + holeEps, sz * spacing / 2);
      g.add(hole);
    }
  }
}

function legRubberMaterial(isActive, dimmed) {
  return new THREE.MeshStandardMaterial({
    color: isActive ? 0x1c2733 : 0x101112, roughness: 0.9, metalness: 0,
    emissive: isActive ? 0x0a1a2a : 0x000000,
    transparent: !!dimmed, opacity: dimmed ? 0.22 : 1, depthWrite: !dimmed,
  });
}

// Опора «Металлическая» — открытая, никелированная (зеркальная), пятка
// резиновая чёрная.
function makeLeg(box, moduleName, isActive, dimmed) {
  const g = new THREE.Group();
  const d = Math.max(box.w, box.d) * MM;      // диаметр трубы
  const h = Math.max(box.h * MM, 0.001);
  const PLATE_T = 2 * MM;                     // толщина площадки
  const FLANGE_H = Math.min(h * 0.14, 10 * MM);

  // В сцене нет карты окружения — PBR-металл (MeshStandardMaterial с высокой
  // metalness) в принципе не даёт яркого блеска без отражений, сколько ни
  // крути числа. Берём Phong — его блик (specular) не зависит от окружения,
  // светится от направленных источников сцены напрямую.
  const steel = new THREE.MeshPhongMaterial({
    color: isActive ? 0x9fc7d6 : 0xdedad0,
    specular: 0xffffff, shininess: 110,
    emissive: isActive ? 0x14314a : 0x000000,
    transparent: !!dimmed, opacity: dimmed ? 0.22 : 1, depthWrite: !dimmed,
  });
  const rubber = legRubberMaterial(isActive, dimmed);

  const tubeH = Math.max(h - PLATE_T, 0.001);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, tubeH, 24), steel);
  tube.position.y = -h / 2 + tubeH / 2;
  g.add(tube);

  // Пятка у пола — резиновая (глушитель/протектор), не хромированная деталь.
  const flange = new THREE.Mesh(
    new THREE.CylinderGeometry(d / 2 * 1.35, d / 2 * 1.45, FLANGE_H, 24), rubber);
  flange.position.y = -h / 2 + FLANGE_H / 2;
  g.add(flange);

  addLegMountPlate(g, steel, h, PLATE_T, dimmed);

  g.position.set(box.x * MM, box.y * MM, box.z * MM);
  g.userData.module = moduleName;
  g.traverse((o) => { o.userData.module = moduleName; });
  return g;
}

// Опора «Кухонная» — настоящая модель заказчика (опора.obj / опора с
// клипсой.obj), а не параметрическое приближение: меш запечён в
// src/legMeshes.js и подставляется как есть, отмасштабированный под нужную
// высоту/диаметр опоры. Сплошной чёрный матовый пластик — как в файле
// (там всего один материал, plastic_matte, отдельной резиновой пятки нет).
function makeKitchenLeg(box, moduleName, isActive, hasClip, dimmed) {
  const g = new THREE.Group();
  const d = Math.max(box.w, box.d) * MM;
  const h = Math.max(box.h * MM, 0.001);

  // Цвет — из присланного опора.mtl (Kd 0,0091 0,0075 0,0048 → #020201,
  // фактически чистый чёрный с едва тёплым оттенком), Ks/Ns говорят о
  // некотором — не нулевом — блике, roughness чуть ниже прежнего под это.
  const plastic = new THREE.MeshStandardMaterial({
    color: isActive ? 0x232a30 : 0x020201, roughness: 0.5, metalness: 0.02,
    emissive: isActive ? 0x0d1a26 : 0x000000,
    transparent: !!dimmed, opacity: dimmed ? 0.22 : 1, depthWrite: !dimmed,
  });

  const LM = window.Modul3D.legMeshes;
  const geo = LM.getGeometry(hasClip ? 'clip' : 'plain', THREE);
  const mesh = new THREE.Mesh(geo, plastic);
  // Исходник — в метрах, низ опоры при y=0, верх площадки при y=NATIVE_HEIGHT.
  // Масштабируем под целевые высоту/диаметр и сдвигаем так, чтобы центр
  // группы (как у box.y) пришёлся на середину высоты опоры.
  mesh.scale.set(d / LM.NATIVE_DIAMETER, h / LM.NATIVE_HEIGHT, d / LM.NATIVE_DIAMETER);
  mesh.position.y = -h / 2;
  g.add(mesh);

  g.position.set(box.x * MM, box.y * MM, box.z * MM);
  if (hasClip) g.rotation.y = -Math.PI / 2;   // клипса развёрнута к цоколю, к +Z
  g.userData.module = moduleName;
  g.traverse((o) => { o.userData.module = moduleName; });
  return g;
}

/**
 * Управление камерой:
 *   Мышь:  ЛКМ — панорамирование, ПКМ — вращение, колесо — зум с фокусом
 *          в точке под курсором.
 *   Тач:   один палец — вращение (самый интуитивный жест на планшете/
 *          телефоне), два пальца — панорамирование средней точкой между
 *          пальцами + pinch-zoom (сведение/разведение — отдаление/
 *          приближение), как в большинстве 3D-просмотрщиков.
 * Определяем тач по e.pointerType === 'touch' и ведём несколько активных
 * pointerId через Map — на тач-устройстве при жесте двумя пальцами events
 * приходят с разными id одновременно.
 */
// Порог "протухания" записи о пальце в this._pointers: если для pointerId
// дольше этого времени не пришло вообще ни одного события (ни pointerdown,
// ни pointermove), считаем, что палец давно отпущен, а браузер просто не
// прислал pointerup/pointercancel. Значение сознательно большое — sweep
// применяется только в момент НОВОГО pointerdown (см. ниже), то есть между
// разными жестами пользователя, а не посреди текущего, так что запас по
// времени тут ничего не портит и лучше перестраховаться.
const STALE_TOUCH_POINTER_MS = 3000;

class SimpleOrbitControl {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;
    this.target = new THREE.Vector3(0, 1, 0);
    this.radius = 4;
    this.theta = Math.PI / 4;   // азимут
    this.phi = Math.PI / 2.6;   // полярный угол
    this._dragging = false;
    this._lastX = 0;
    this._lastY = 0;

    this.moved = 0;   // накопленный сдвиг — чтобы отличить клик/тап от протяжки
    this.mode = null; // 'pan' | 'rotate' | 'pinch'

    // Активные указатели тач-жеста: pointerId -> {x, y}. Нужны, чтобы отличать
    // одно- и двухпальцевые жесты и считать смещение средней точки/расстояния
    // между пальцами для панорамирования и pinch-zoom.
    this._pointers = new Map();
    this._pinchDist = 0;  // расстояние между пальцами на предыдущем кадре
    this._pinchMidX = 0;  // средняя точка между пальцами на предыдущем кадре
    this._pinchMidY = 0;

    // Ставит снаружи Viewer3D: проверяет, попал ли палец на саму 3D-модель
    // (raycast). Нужен, чтобы решить режим одиночного касания — вращение
    // или панорамирование (см. pointerdown ниже). Пока не задан (например,
    // в момент создания контрола, до того как Viewer3D его подключит) —
    // ведём себя как раньше и всегда вращаем.
    this.hitTestProvider = null;

    // Контекстное меню по ПКМ отключаем — правая кнопка занята вращением
    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());

    this.dom.addEventListener('pointerdown', (e) => {
      this.dom.setPointerCapture(e.pointerId);

      if (e.pointerType === 'touch') {
        // Защитная очистка "протухших" записей — sweep по возрасту, а НЕ по
        // this._dragging. Раньше чистили всю карту при `!this._dragging`, но
        // это логически не могло сработать: для touch этот флаг становится
        // false ТОЛЬКО внутри endPointer, синхронно с тем же
        // pointerup/pointercancel, которого как раз и не хватает — то есть
        // именно в сценарии утечки _dragging никогда не сбросится сам, и
        // условие `!this._dragging` никогда не срабатывает.
        //
        // Вместо флага храним в каждой записи this._pointers метку времени t
        // последнего события (pointerdown или pointermove) для этого
        // pointerId. НО одного только возраста t недостаточно: если первый
        // палец лежит на экране неподвижно дольше STALE_TOUCH_POINTER_MS
        // (держат модель, чтобы рассмотреть), pointermove по нему браузер не
        // шлёт, t не обновляется — а затем ставят второй палец для pinch.
        // Новый pointerdown для второго пальца запускает этот sweep, и по
        // одному только возрасту первый палец выглядел бы "протухшим", хотя
        // физически он всё ещё прижат к экрану. Поэтому запись удаляем,
        // только если ОБА условия верны: по времени давно не было события
        // И браузер уже не считает этот pointerId захваченным элементом
        // (Element.hasPointerCapture) — то есть указатель либо реально
        // отпущен/отменён, либо capture был снят браузером implicitly, а
        // событие pointerup/pointercancel потерялось. Пока палец физически
        // прижат, hasPointerCapture остаётся true независимо от того,
        // двигается палец или нет — так что неподвижный, но реально прижатый
        // палец sweep не тронет, а по-настоящему потерянный указатель
        // по-прежнему будет выметен.
        const now = Date.now();
        const hasCapture = typeof this.dom.hasPointerCapture === 'function'
          ? (id) => this.dom.hasPointerCapture(id)
          // Старые браузеры без Element.hasPointerCapture — fallback на
          // прежнее поведение (только по возрасту), чтобы не отключать
          // sweep совсем. В таких браузерах edge-case с неподвижным пальцем
          // теоретически возможен снова, но актуальные мобильные
          // Chrome/Safari метод поддерживают, так что это приемлемый
          // компромисс только для устаревших сред.
          : () => false;
        for (const [id, p] of this._pointers) {
          if (id !== e.pointerId && now - p.t > STALE_TOUCH_POINTER_MS && !hasCapture(id)) {
            this._pointers.delete(id);
          }
        }
        this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: now });
        this.moved = 0;
        if (this._pointers.size === 1) {
          // Первый палец: если попал на саму модель — вращаем сцену вокруг
          // цели, если мимо (пустое место/сетка) — панорамируем. Без
          // provider (hitTestProvider не задан) — как раньше, всегда rotate.
          const onObject = this.hitTestProvider ? this.hitTestProvider(e) : true;
          this._dragging = true;
          this.mode = onObject ? 'rotate' : 'pan';
          this._lastX = e.clientX;
          this._lastY = e.clientY;
        } else if (this._pointers.size >= 2) {
          // Появился второй палец — переключаемся на пинч (зум + пан),
          // одиночное вращение приостанавливаем до отрыва пальца.
          this._dragging = true;
          this.mode = 'pinch';
          this._setPinchBaseline();
        }
        return;
      }

      // Мышь/перо: как раньше — ЛКМ пан, ПКМ вращение. Multi-pointer логикой
      // (this._pointers.size) мышь не пользуется, но запись в карту всё равно
      // нужна — её удаляет endPointer при pointerup/pointercancel. Поле t
      // здесь не используется (sweep — только для touch-ветки), но пишем
      // его для единообразия формы записи.
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: Date.now() });
      this._dragging = true;
      this.mode = (e.button === 2) ? 'rotate' : 'pan';
      this.moved = 0;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    });

    const endPointer = (e) => {
      this._pointers.delete(e.pointerId);
      if (e.pointerType === 'touch') {
        if (this._pointers.size === 0) {
          this._dragging = false;
          this.mode = null;
        } else if (this._pointers.size === 1) {
          // Остался один палец после пинча — переходим на вращение без
          // скачка камеры: берём базовую точку заново, а не продолжаем
          // старую дельту.
          const p = this._pointers.values().next().value;
          this.mode = 'rotate';
          this._lastX = p.x;
          this._lastY = p.y;
        }
        return;
      }
      this._dragging = false;
      this.mode = null;
    };
    this.dom.addEventListener('pointerup', endPointer);
    this.dom.addEventListener('pointercancel', endPointer);
    // lostpointercapture сюда намеренно НЕ добавляем: на части Android
    // WebView/браузеров это событие ненадёжно — может сработать само по себе
    // посреди активного перетаскивания (например, из-за внутренней
    // перепривязки capture при перерисовке WebGL-канвы), а не только когда
    // палец реально оторвался от экрана. Раз endPointer сбрасывает
    // _dragging/mode, такое ложное срабатывание обрывало жест на середине:
    // модель проворачивалась на десяток градусов и "залипала" — pointermove
    // продолжали приходить, но отбрасывались проверкой `!this._dragging`.
    // Вместо него "протухшие" pointerId (для которых так и не пришёл
    // pointerup/pointercancel) подчищаются sweep'ом по возрасту записи
    // (STALE_TOUCH_POINTER_MS) в начале pointerdown — см. комментарий там.
    // pointerleave тоже не добавляем: при захваченном pointer'е (после
    // setPointerCapture) события обязаны продолжать приходить на исходный
    // элемент, даже когда палец физически ушёл за его границы во время
    // активного жеста — но некоторые движки всё равно шлют pointerleave в
    // этот момент, и обработка такого события как «отпускания» преждевременно
    // обрывала бы ещё идущий жест.

    this.dom.addEventListener('pointermove', (e) => {
      if (!this._dragging || !this._pointers.has(e.pointerId)) return;
      // Обновляем t при каждом move (даже если dx/dy малы) — это и есть
      // признак "палец всё ещё реально на экране", на который опирается
      // sweep в pointerdown выше.
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: Date.now() });

      if (this.mode === 'pinch') {
        this._applyPinch();
        return;
      }

      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this.moved += Math.abs(dx) + Math.abs(dy);
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      if (this.mode === 'rotate') {
        this.theta -= dx * 0.006;
        this.phi = Math.min(Math.PI - 0.03, Math.max(0.03, this.phi - dy * 0.006));
      } else {
        this.pan(dx, dy);
      }
      this.update();
    });
    // Зум колесом с фокусом в точке под курсором: цель камеры подтягивается
    // к тому месту модели, на которое смотрит мышь.
    this.zoomPointProvider = null;   // ставит Viewer3D: возвращает точку под курсором
    this.dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = 1 + e.deltaY * 0.001;
      const pt = this.zoomPointProvider ? this.zoomPointProvider(e) : null;
      this._zoomBy(k, pt);
      this.update();
    }, { passive: false });
  }

  /** Записываем стартовое расстояние и середину между двумя пальцами. */
  _setPinchBaseline() {
    const pts = Array.from(this._pointers.values());
    if (pts.length < 2) return;
    const [a, b] = pts;
    this._pinchDist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    this._pinchMidX = (a.x + b.x) / 2;
    this._pinchMidY = (a.y + b.y) / 2;
  }

  /**
   * Двухпальцевый жест за один кадр: пинч меняет расстояние между пальцами
   * (масштаб), сдвиг средней точки между пальцами — панорамирование.
   * Считаем от значений, сохранённых на предыдущем вызове (не от стартовых),
   * чтобы жест был плавным на всей длине протяжки.
   */
  _applyPinch() {
    const pts = Array.from(this._pointers.values());
    if (pts.length < 2) return;
    const [a, b] = pts;
    const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;

    // Разведение пальцев (дистанция растёт) — приближение, сведение — отдаление.
    const k = this._pinchDist / dist;
    const pt = this.zoomPointProvider
      ? this.zoomPointProvider({ clientX: midX, clientY: midY })
      : null;
    this._zoomBy(k, pt);

    // Панорамирование — сдвиг средней точки между пальцами со времени
    // предыдущего кадра.
    this.pan(midX - this._pinchMidX, midY - this._pinchMidY);

    this.moved += Math.abs(dist - this._pinchDist) + Math.abs(midX - this._pinchMidX) + Math.abs(midY - this._pinchMidY);
    this._pinchDist = dist;
    this._pinchMidX = midX;
    this._pinchMidY = midY;
    this.update();
  }

  /** Общий шаг масштабирования (используется и колесом мыши, и pinch-зумом). */
  _zoomBy(k, pt) {
    const newR = Math.max(0.15, Math.min(60, this.radius * k));
    if (pt && k < 1) {
      // приближение — тянем цель к точке под курсором/пальцами пропорционально шагу
      const f = 1 - newR / this.radius;
      this.target.lerp(pt, Math.min(0.9, Math.max(0, f)));
    }
    this.radius = newR;
    if (this.onZoom) this.onZoom(k, pt);
  }

  /**
   * Панорамирование: сдвигаем точку, вокруг которой смотрит камера, вдоль её
   * собственных осей «вправо» и «вверх». Величина сдвига в мире на пиксель
   * считается по текущему зуму, чтобы модель шла ровно за курсором.
   */
  pan(dx, dy) {
    const cam = this.camera, el = this.dom;
    const h = el.clientHeight || 1;
    const worldPerPx = cam.isOrthographicCamera
      ? (cam.top - cam.bottom) / h
      : 2 * this.radius * Math.tan((cam.fov * Math.PI) / 360) / h;

    cam.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    this.target.addScaledVector(right, -dx * worldPerPx);
    this.target.addScaledVector(up, dy * worldPerPx);
  }

  setFromDistance(radius, targetY) {
    this.radius = radius;
    this.target.set(0, targetY, 0);
    this.update();
  }

  /** Ортогональные предустановки камеры: спереди / сбоку / сверху / 3D. */
  setView(name) {
    if (name === 'front')      { this.theta = 0;            this.phi = Math.PI / 2; }
    else if (name === 'side')  { this.theta = Math.PI / 2;  this.phi = Math.PI / 2; }
    // Вид сверху — строго вертикально (phi = 0). Наклона быть не должно,
    // иначе получается аксонометрия и виден передний торец.
    else if (name === 'top')   { this.theta = 0;            this.phi = 0; }
    else                       { this.theta = Math.PI / 4;  this.phi = Math.PI / 2.6; }
    this.update();
  }

  update() {
    const x = this.target.x + this.radius * Math.sin(this.phi) * Math.sin(this.theta);
    const y = this.target.y + this.radius * Math.cos(this.phi);
    const z = this.target.z + this.radius * Math.sin(this.phi) * Math.cos(this.theta);
    this.camera.position.set(x, y, z);

    // При взгляде строго вниз (или вверх) вектор «вверх» (0,1,0) совпадает с
    // направлением взгляда и lookAt вырождается — камера не знает, куда
    // повернуть кадр. Поэтому для вертикальных видов задаём «вверх» вдоль -Z:
    // тогда перёд изделия оказывается внизу кадра, как на чертеже.
    const EPS = 0.02;
    if (this.phi < EPS) this.camera.up.set(0, 0, -1);
    else if (this.phi > Math.PI - EPS) this.camera.up.set(0, 0, 1);
    else this.camera.up.set(0, 1, 0);

    this.camera.lookAt(this.target);
  }
}

class Viewer3D {
  constructor(container) {
    if (!THREE) {
      container.innerHTML = '<div style="padding:20px;color:#a33;font-size:13px">Three.js не загрузился с CDN. Проверьте подключение к интернету и обновите страницу.</div>';
      this._broken = true;
      return;
    }

    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf3f4f6);

    // Две камеры: перспектива для 3D и ОРТОГРАФИЧЕСКАЯ для видов спереди/
    // сбоку/сверху — иначе вид «спереди» выглядит аксонометрией (видны боковые
    // грани), а на чертеже так быть не должно.
    this.persp = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
    this.camera = this.persp;
    this.isOrtho = false;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    container.appendChild(this.renderer.domElement);

    this.controls = new SimpleOrbitControl(this.camera, this.renderer.domElement);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Выбор модуля кликом по 3D-модели. Клик отличаем от вращения по тому,
    // сдвигалась ли мышь между нажатием и отпусканием.
    this.onSelectModule = null;
    // Двойной клик по модулю — переход в режим изоляции (см. render() ниже,
    // opts.isolateModule). Колбэк получает имя модуля строкой.
    this.onIsolateModule = null;
    // Клик по ЛЮБОЙ детали (боковина, полка, дно, фасад и т.д. — любой
    // userData.kind) ВНУТРИ изолированного модуля. Колбэк получает
    // { module, kind, side, clientX, clientY } — side есть только у боковины,
    // у остальных деталей будет undefined. Координаты клика — чтобы app.js
    // мог поставить контекстное меню в точку клика.
    this.onSelectPart = null;
    // Клик МИМО любой детали, пока активна изоляция: либо луч вообще ни во
    // что не попал (пустое место — пол и сетка лежат в this.scene, а не в
    // this.group, и в рейкаст не участвуют), либо попал в меш без
    // userData.kind — это опоры/ручки/штанги/полкодержатели/фланцы, у них
    // есть только userData.module, своего вида детали для контекстного меню
    // у них нет. Колбэк получает { module, clientX, clientY }. Пока изоляция
    // активна, обычный onSelectModule(null) для промаха НЕ вызывается —
    // выход из изоляции теперь идёт только через явный вызов exitIsolation()
    // из app.js.
    this.onFocusMiss = null;
    // Имя модуля, изолированного в последнем render() — нужно pointerup-
    // обработчику, чтобы понимать, что клик пришёлся внутрь изоляции.
    this._isolateModule = null;
    // Таймер отложенного одиночного клика (анти-дребезг двойного клика,
    // см. pointerup/dblclick ниже). Храним в поле экземпляра, чтобы
    // dblclick-обработчик мог его погасить.
    this._clickTimer = null;
    this._raycaster = new THREE.Raycaster();
    // У линий порог попадания по умолчанию — 1 единица, а у нас это ЦЕЛЫЙ
    // МЕТР: луч цеплялся за контур детали в метре от курсора и возвращал
    // чужой модуль (или «попадание» по пустому месту). Порог убираем,
    // а ниже отбираем только сами детали, без контуров.
    if (this._raycaster.params && this._raycaster.params.Line) {
      this._raycaster.params.Line.threshold = 0.0005;
    }
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (this.controls.moved > 6) return;
      if (!this.onSelectModule && !this.onSelectPart && !this.onFocusMiss) return;
      // Деталь теперь собирается из нескольких слоёв внутри группы, поэтому
      // луч пускаем РЕКУРСИВНО, а имя модуля ищем вверх по родителям.
      const hits = this._hitTestAt(e);      // контуры не в счёт (см. _hitTestAt)
      const hitModule = (hits.length && this._moduleOwnerOf(hits[0].object)) || null;
      // Режим изоляции: пока она активна, сцена вообще не содержит чужих
      // модулей (см. render()), поэтому ЛЮБОЙ клик внутри неё обрабатываем
      // только через onSelectPart/onFocusMiss — никогда не проваливаемся в
      // обычный onSelectModule (выход из изоляции теперь только по явной
      // команде из app.js через exitIsolation(), а не по клику мимо).
      if (this._isolateModule) {
        let kindOwner = null;
        if (hits.length) {
          for (let o = hits[0].object; o; o = o.parent) {
            if (o.userData && o.userData.kind) { kindOwner = o; break; }
          }
        }
        if (kindOwner) {
          if (this.onSelectPart) {
            this.onSelectPart({
              module: this._isolateModule,
              kind: kindOwner.userData.kind,
              side: kindOwner.userData.side,
              clientX: e.clientX,
              clientY: e.clientY,
            });
          }
        } else if (this.onFocusMiss) {
          this.onFocusMiss({ module: this._isolateModule, clientX: e.clientX, clientY: e.clientY });
        }
        return;
      }
      // Промах по модели (клик по пустому месту) — снимаем выделение,
      // поэтому передаём null, а не выходим молча. Сам вызов откладываем:
      // браузер при двойном клике успевает прислать pointerup ДВАЖДЫ ещё
      // ДО dblclick, и если звать onSelectModule сразу, видно мигание
      // (выбор/сброс) перед входом в изоляцию. Ждём стандартный интервал
      // распознавания двойного клика — если за это время придёт dblclick,
      // он сам погасит этот таймер (см. ниже), и мигания не будет.
      if (this._clickTimer) clearTimeout(this._clickTimer);
      this._clickTimer = setTimeout(() => {
        this._clickTimer = null;
        if (this.onSelectModule) this.onSelectModule(hitModule);
      }, 230);
    });

    // Двойной клик по модулю — вход в режим изоляции (opts.isolateModule
    // у render()). Та же защита от срабатывания во время вращения камеры,
    // что и у одиночного клика: moved > 6 — вращали, клик не считается.
    this.renderer.domElement.addEventListener('dblclick', (e) => {
      if (!this.onIsolateModule || this.controls.moved > 6) return;
      // Гасим отложенный одиночный клик от pointerup (см. выше) — иначе он
      // выстрелит следом за изоляцией и собьёт состояние (лишний
      // select/deselect после того, как модуль уже изолирован).
      if (this._clickTimer) { clearTimeout(this._clickTimer); this._clickTimer = null; }
      const hits = this._hitTestAt(e);
      const hitModule = (hits.length && this._moduleOwnerOf(hits[0].object)) || null;
      if (hitModule) this.onIsolateModule(hitModule);
      // Промах по пустому месту — ничего не делаем. Если уже была активна
      // изоляция другого модуля — она остаётся как есть: выход из изоляции
      // теперь идёт только по явной команде из app.js (exitIsolation()), а
      // не по клику/двойному клику мимо (см. pointerup выше).
    });

    // Зум в ортогональных видах меняет рамку камеры (радиус там не работает)
    this._orthoZoom = 1;
    this.controls.onZoom = (k, pt) => {
      if (!this.isOrtho) return;
      this._orthoZoom = Math.max(0.2, Math.min(12, this._orthoZoom / k));
      if (pt && k < 1) this.controls.target.lerp(pt, 0.25);  // фокус к курсору
      this._fitOrtho();
    };

    // Точка модели под курсором — для зума с фокусом в курсоре
    this.controls.zoomPointProvider = (e) => {
      const hits = this._hitTestAt(e);
      return hits.length ? hits[0].point : null;
    };

    // Попал ли палец/курсор на саму модель — используется тач-контролом,
    // чтобы решить: вращать сцену (палец на детали) или панорамировать
    // (палец мимо, по пустому месту).
    this.controls.hitTestProvider = (e) => this._hitTestAt(e).length > 0;

    this._addLights();
    this._addGrid();
    this._resize();
    window.addEventListener('resize', () => this._resize());

    this._animate();
  }

  /**
   * Общий raycast из точки экрана (clientX/clientY) в меши модели.
   * Используется и для выбора модуля кликом, и для зума с фокусом в
   * курсоре, и для hit-test тач-жестов — чтобы не дублировать одну и ту же
   * NDC-логику в нескольких местах.
   */
  _hitTestAt(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this._raycaster.setFromCamera(ndc, this.camera);
    return this._raycaster.intersectObjects(this.group.children, true)
      .filter((h) => h.object && h.object.isMesh);   // контуры/линии не в счёт
  }

  // Поднимается по родителям от объекта попадания до первого, у кого
  // проставлен userData.module — так находим имя модуля независимо от того,
  // на какой вложенный слой/меш детали попал луч.
  _moduleOwnerOf(obj) {
    for (let o = obj; o; o = o.parent) {
      if (o.userData && o.userData.module) return o.userData.module;
    }
    return null;
  }

  _addLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(3, 5, 4);
    this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.4);
    dir2.position.set(-3, 2, -4);
    this.scene.add(dir2);
  }

  _addGrid() {
    // Пол: видимая плоскость + сетка, чтобы изделие не висело в пустоте
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xdadada, roughness: 0.95, metalness: 0,
      side: THREE.DoubleSide,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.002;          // чуть ниже нуля, чтобы не мерцало
    this.scene.add(floor);
    this._floor = floor;                // в режиме проверки делаем прозрачным

    const grid = new THREE.GridHelper(14, 56, 0xa8a8a8, 0xc8c8c8);
    this.scene.add(grid);
  }

  // Публичный пересчёт размера: нужен, когда меняется высота контейнера
  // (свернули/раскрыли панель документов), а окно не менялось.
  resize() { this._resize(); }

  _resize() {
    if (this._broken) return;
    const w = this.container.clientWidth || 600;
    const h = this.container.clientHeight || 500;
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this._fitOrtho();
  }

  _animate() {
    if (this._broken) return;
    requestAnimationFrame(() => this._animate());
    this._updateFloorVisibility();
    this.renderer.render(this.scene, this.camera);
  }

  // Пол прозрачный, если включена проверка присадки ИЛИ камера ушла ниже
  // уровня пола (пользователь покрутил вид и смотрит снизу вверх) — иначе
  // сплошная плоскость пола закрывает корпус снизу. Небольшой отрицательный
  // порог (не 0) — чтобы не мерцало ровно на границе при взгляде почти сбоку.
  _updateFloorVisibility() {
    if (!this._floor || !this._floor.material) return;
    const below = this.camera && this.camera.position.y < -5;
    const wantTransparent = !!this._drillCheck || below;
    const mat = this._floor.material;
    const targetOpacity = this._drillCheck ? 0.12 : (below ? 0.1 : 1);
    if (mat.transparent === wantTransparent && mat.opacity === targetOpacity) return;
    mat.transparent = wantTransparent;
    mat.opacity = targetOpacity;
    mat.depthWrite = !wantTransparent;
    mat.needsUpdate = true;
  }

  /**
   * Мировые координаты (в мм) подсказки осей на экране «Деталь»: начало
   * координат детали, концы рёбер осей X/Y и мировые точки кастомных
   * отверстий. Заполняется в render() внутри блока opts.axisHintRow —
   * используется оверлеем размеров поверх видов спереди/сбоку/сверху.
   * Возвращает null, если подсказка сейчас не активна.
   */
  getAxisHint() {
    return this._axisHint;
  }

  /** Размер канвы в пикселях — для позиционирования оверлея. */
  canvasSize() {
    const el = this.renderer.domElement;
    return { w: el.clientWidth, h: el.clientHeight };
  }

  /**
   * Проецирует точку модели (в МИЛЛИМЕТРАХ) в пиксели канвы.
   * Используется для отрисовки размерных линий поверх цветной 3D-сцены —
   * так виды «спереди/сбоку/сверху» получают размеры как на чертеже,
   * но модель остаётся в цвете.
   */
  project(xmm, ymm, zmm) {
    const v = new THREE.Vector3(xmm * MM, ymm * MM, zmm * MM).project(this.camera);
    const el = this.renderer.domElement;
    return { x: (v.x + 1) / 2 * el.clientWidth, y: (-v.y + 1) / 2 * el.clientHeight };
  }

  /** Предустановка камеры: 'front' | 'side' | 'top' | 'iso'. */
  setView(name) {
    if (this._broken) return;
    this.isOrtho = (name !== 'iso');
    this.viewName = name;
    this.camera = this.isOrtho ? this.ortho : this.persp;
    this.controls.camera = this.camera;
    this._fitOrtho();
    this.controls.setView(name);
    this._resize();
  }

  // Подгоняет рамку ортокамеры под габарит изделия В ТЕКУЩЕМ виде:
  // спереди — ширина×высота, сбоку — глубина×высота, сверху — ширина×глубина.
  // По наибольшему габариту считать нельзя: план высокого шкафа выходил мелким.
  _fitOrtho() {
    if (!this._lastDims) return;
    // Пустой проект: габарит нулевой — берём условную рамку, иначе рамка
    // схлопывается и вид ломается.
    const W = this._lastDims.W || 1000;
    const H = this._lastDims.H || 1000;
    const D = this._lastDims.D || 1000;
    const el = this.renderer.domElement;
    const aspect = (el.clientWidth || 1) / (el.clientHeight || 1);
    const ext = this.viewName === 'side' ? { w: D, h: H }
              : this.viewName === 'top'  ? { w: W, h: D }
              : { w: W, h: H };
    // рамку берём по большей из потребностей с учётом пропорций окна
    const need = Math.max(ext.h, ext.w / Math.max(aspect, 0.01));
    const span = need * MM * 1.2 / (this._orthoZoom || 1);
    let hw = span * aspect / 2, hh = span / 2;
    this.ortho.left = -hw; this.ortho.right = hw;
    this.ortho.top = hh; this.ortho.bottom = -hh;
    this.ortho.updateProjectionMatrix();
  }

  /**
   * Перестраивает сцену из parts, вычисленных Parametric Core Engine.
   * @param {object} opts.hideFacades — скрыть двери и фасады ящиков, показав
   *   только корпус (боковины, дно, крыша, стойки, полки, задняя стенка).
   *   Скрытие только визуальное: деталировка и спецификация не меняются.
   */
  render(model, opts) {
    if (this._broken) return;
    const hideFacades = !!(opts && opts.hideFacades);
    // Режим проверки присадки: корпус полупрозрачный, отверстия подсвечены
    const drillCheck = !!(opts && opts.drillCheck);
    // Фильтр присадки: показать метки только одного вида. Иначе нужное
    // отверстие (например гнездо защёлки Ø6) теряется среди сотни других.
    const drillOnly = (opts && opts.drillFilter) || null;
    // Пол прозрачный в режиме проверки присадки (иначе гнёзда в дне,
    // крепление дна ящика и опоры не рассмотреть — они смотрят в пол) — и
    // ТАКЖЕ когда камера смотрит из-под пола (иначе снизу видна только
    // сплошная серая плоскость, а не сам корпус). Второе условие живёт не
    // здесь, а в _animate(): оно должно пересчитываться каждый кадр при
    // орбите камеры, а не только при пересчёте модели.
    this._drillCheck = drillCheck;
    // Подсказка осей (см. блок с opts.axisHintRow ниже) отдаёт мировые
    // координаты наружу — сбрасываем перед пересчётом, иначе после того как
    // деталь убрали с экрана «Деталь», здесь остались бы устаревшие данные.
    this._axisHint = null;
    this._updateFloorVisibility();
    const highlight = opts && opts.highlightModule;
    // Режим изоляции (двойной клик по модулю, см. dblclick-обработчик выше):
    // имя модуля, который остаётся «живым», все остальные — притушены.
    // Запоминаем в поле экземпляра — pointerup-обработчик читает его, чтобы
    // понять, что клик пришёлся внутрь изолированного модуля.
    const isolateModule = (opts && opts.isolateModule) || null;
    this._isolateModule = isolateModule;
    while (this.group.children.length) this.group.remove(this.group.children[0]);

    const { W, H, D } = model.dims;
    // Рисуем из несклеенного списка: у него каждая деталь знает свой модуль,
    // поэтому активный модуль можно подсветить отдельным цветом.
    const source = model.partsRaw || model.parts;
    for (const row of source) {
      // «Скрыть фасады»: сам фасад остаётся, но становится полупрозрачным —
      // видно и наполнение корпуса, и присадку на фасаде. Ручки при этом
      // убираются, чтобы не загораживали.
      const isFacade = row.kind === 'door' || row.kind === 'drawerFront';
      if (hideFacades && row.kind === 'handle') continue;
      const ghost = hideFacades && isFacade;
      // Модули, НЕ участвующие в изоляции, раньше просто гасли прозрачностью
      // (opacity), теперь — не рисуются вовсе: детали чужого модуля не
      // долетают до сцены (continue до создания мешей), чтобы полностью
      // убрать их из вида и не тратить на них геометрию/рейкаст. Изолированный
      // модуль остаётся полностью непрозрачным, как и раньше.
      if (isolateModule && row.module !== isolateModule) continue;
      // dimmed раньше означал «модуль погашен изоляцией» и включал
      // полупрозрачность; теперь такие детали отсеяны выше (continue), так
      // что dimmed всегда false. Оставляем константой, чтобы не переписывать
      // сигнатуры вспомогательных функций (makeLeg/makeHandle/makeRod и т.д.),
      // которые принимают этот флаг для СВОЕЙ, отдельной, полупрозрачности.
      const dimmed = false;
      const ghostLike = ghost;
      const glass = !!row.glass;                 // стекло рисуем прозрачным
      const framed = (row.frameW || 0) > 0 && row.facadeType !== 'mdfMilled';
      const milled = row.facadeType === 'mdfMilled';   // фрезеровка на пласти
      const isActive = highlight && row.module === highlight;
      // Доборные детали (фальш-планки, заглушки) красим по МАТЕРИАЛУ:
      // сделана из фасадного — выглядит как фасад, из корпусного ЛДСП —
      // как корпус. Раньше они уходили в серую заглушку по умолчанию.
      const asFacade = !!row.facadeType;
      const look = decorLook(row.material);
      const baseColor = look ? look.color
        : (KIND_COLOR[row.kind] ?? (asFacade ? KIND_COLOR.door : KIND_COLOR.side));
      const hiColor = HIGHLIGHT_COLOR[row.kind]
        ?? (asFacade ? HIGHLIGHT_COLOR.door : HIGHLIGHT_COLOR.side);
      const color = isActive ? hiColor : baseColor;
      // Опоры рисуем как настоящую мебельную ножку: «металлическая» — открытая
      // никелированная (зеркальная) труба; «кухонная» — матовый пластик, с
      // клипсой у переднего ряда, когда есть цоколь (по образцу АМЕТИСТ).
      if (row.shape === 'cylinder') {
        for (const box of row.boxes) {
          this.group.add(row.legType === 'kitchen'
            ? makeKitchenLeg(box, row.module, isActive, !!row.hasClip, dimmed)
            : makeLeg(box, row.module, isActive, dimmed));
        }
        continue;
      }
      // Ручки: кнопка и скоба рисуются металлом перед фасадом.
      if (row.shape === 'handleKnob' || row.shape === 'handleBowH' || row.shape === 'handleBowV') {
        for (const box of row.boxes) {
          const g = makeHandle(box, row.shape, row.module, isActive, row.cc, row.rot || 0, dimmed);
          this.group.add(g);
        }
        continue;
      }
      // Полкодержатель — штифт Ø5, торчащий из панели внутрь секции.
      if (row.shape === 'pin') {
        for (const box of row.boxes) {
          const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(2.5 * MM, 2.5 * MM,
              Math.max(((row.rot === 90 || row.rot === 270) ? box.d : box.w) * MM, 0.001), 10),
            new THREE.MeshStandardMaterial({
              color: 0xb9bec3, roughness: 0.35, metalness: 0.8,
              transparent: dimmed, opacity: dimmed ? 0.22 : 1, depthWrite: !dimmed,
            })
          );
          mesh.rotation.z = Math.PI / 2;
          mesh.rotation.y = ((row.rot || 0) * Math.PI) / 180;
          mesh.position.set(box.x * MM, box.y * MM, box.z * MM);
          mesh.userData.module = row.module;
          this.group.add(mesh);
        }
        continue;
      }
      // Фланец штанги — диск на панели, плоскостью к боковине.
      if (row.shape === 'flange') {
        for (const box of row.boxes) {
          const d = Math.max(box.h, box.d) * MM;
          const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(d / 2, d / 2, Math.max(box.w * MM, 0.001), 20),
            new THREE.MeshStandardMaterial({
              color: isActive ? 0x9fc3de : 0xd9dde0, roughness: 0.25, metalness: 0.9,
              transparent: dimmed, opacity: dimmed ? 0.22 : 1, depthWrite: !dimmed,
            })
          );
          mesh.rotation.z = Math.PI / 2;                 // ось диска — вдоль X
          mesh.rotation.y = ((row.rot || 0) * Math.PI) / 180;
          mesh.position.set(box.x * MM, box.y * MM, box.z * MM);
          mesh.userData.module = row.module;
          this.group.add(mesh);
        }
        continue;
      }
      // Штанга — труба вдоль оси X, поперёк проёма секции.
      if (row.shape === 'cylinderX') {
        for (const box of row.boxes) this.group.add(makeRod(box, row.module, isActive, row.rot, dimmed));
        continue;
      }

      // Рамочный фасад (деревянный, витраж, алюминий) собирается из четырёх
      // брусков и вставки — так он и выглядит на самом деле.
      if (framed) {
        for (const box of row.boxes) {
          this.group.add(makeFramedFacade(box, row, isActive, ghostLike));
        }
        continue;
      }

      // Повёрнутая деталь строится в СВОИХ локальных размерах и разворачивается
      // целиком — тогда присадка и ручка едут вместе с ней, а не остаются
      // в старой системе координат.
      const rotDeg = row.rot || 0;
      const swapped = rotDeg === 90 || rotDeg === 270;
      const locW = swapped ? row.box.d : row.box.w;
      const locD = swapped ? row.box.w : row.box.d;
      // ПЛОСКОСТЬ ДЕТАЛИ (по тонкой оси) — от неё зависит, как ложатся
      // вырезы: паз и присадка живут в системе координат пласти.
      const thinSize = Math.min(locW, row.box.h, locD);
      const planeIsX = locW === thinSize;                       // боковина
      const planeIsY = !planeIsX && row.box.h === thinSize;     // дно/полка
      const uSize = planeIsX ? locD : locW;                     // «длина» пласти
      const vSize = planeIsX ? row.box.h : (planeIsY ? locD : row.box.h);
      const tSize = thinSize;

      // Вырезы в координатах пласти. Присадка задана в системе детали:
      //   боковина  — x по высоте, y по глубине;
      //   дно/полка — x по длине,  y по глубине;
      //   фасад     — x по длине,  y по высоте.
      const cuts = [];
      // «Лицо» детали обычно определяется по её позиции (row.box.x < 0 для
      // тонких-по-X деталей типа боковины: считаем, что интерьер корпуса
      // смотрит к центру). Для смещённых деталей вне центра корпуса (напр.
      // фальш-планка углового узла, где скрытая грань — всегда к соседней
      // детали, а не к центру всего модуля) эта эвристика ошибается — тогда
      // engine.js явно проставляет row.frontIsPlus, и он в приоритете.
      const frontIsPlus = row.frontIsPlus != null ? row.frontIsPlus : (!planeIsX || row.box.x < 0);
      // Куда смотрит локальная ось X детали, решаем ПО ЕЁ РАЗМЕРАМ: у двери
      // длина горизонтальна, у боковины и доборной планки — вертикальна.
      // Раньше это угадывалось по типу, и присадка ложилась поперёк.
      const lenIsU = lengthAlongU(row.length, uSize, vSize);
      const toU = (h) => (lenIsU ? h.x : h.y);
      const toV = (h) => (lenIsU ? h.y : h.x);
      for (const h of (row.holes || [])) {
        if (h.side === 'edge') continue;                // торцевую не режем
        // Отверстие без диаметра (только что добавленное на экране «Деталь»,
        // пользователь ещё не ввёл ⌀) ничего не режет — не только по смыслу
        // (нулевой вырез), но и потому что slabGeometry() ниже отличает
        // круглый вырез от прямоугольного по truthy c.r: при r=0 код уходит
        // в ветку прямоугольного паза и читает несуществующие c.u0/c.u1,
        // получая NaN-геометрию.
        if (!(h.d > 0)) continue;
        const u = toU(h);
        const v = toV(h);
        const fromFront = h.side === 'back' ? !frontIsPlus : frontIsPlus;
        cuts.push({ u, v, r: h.d / 2, depth: h.depth || 0, through: !!h.through, fromFront });
      }
      for (const g of (row.grooves || [])) {
        const u0 = toU({ x: g.x0, y: g.y0 }), v0 = toV({ x: g.x0, y: g.y0 });
        const u1 = toU({ x: g.x1, y: g.y1 }), v1 = toV({ x: g.x1, y: g.y1 });
        const half = (g.w || 4) / 2;
        const along = Math.abs(u1 - u0) >= Math.abs(v1 - v0);
        cuts.push({
          u0: along ? u0 : u0 - half, u1: along ? u1 : u1 + half,
          v0: along ? v0 - half : v0, v1: along ? v1 + half : v1,
          depth: g.depth || 4, through: false, fromFront: frontIsPlus,
        });
      }

      // Материал по типу детали: ЛДСП — с текстурой «под древесину»,
      // МДФ в плёнке/эмали — гладкий и глянцевый, стекло — прозрачное.
      const isMdf = row.facadeType === 'mdf' || row.facadeType === 'mdfMilled';
      // Текстуру «под древесину» кладём только на древесные декоры: на белом
      // и чёрном ЛДСП её быть не должно.
      const ldspLike = !glass && !isMdf && (look ? look.wood : true);
      const tex = (ldspLike && !isActive) ? woodTexture() : null;
      const mat = new THREE.MeshStandardMaterial({
        color: glass ? 0xbfe3ea : (isMdf ? (isActive ? 0x7fb0d8 : 0xf2efe9) : color),
        map: tex || null,
        roughness: glass ? 0.1 : (isMdf ? 0.12 : 0.75),
        metalness: isMdf ? 0.05 : 0.02,
        emissive: isActive ? 0x14314a : 0x000000,
        transparent: ghostLike || glass || drillCheck,
        opacity: ghostLike ? 0.22 : (glass ? 0.35 : (drillCheck ? 0.22 : 1)),
        depthWrite: !(ghostLike || glass || drillCheck),
      });
      if (tex) {
        // масштабируем рисунок под размер детали, чтобы полосы не растягивались
        mat.map = tex.clone();
        mat.map.needsUpdate = true;
        mat.map.wrapS = THREE.RepeatWrapping;
        mat.map.wrapT = THREE.RepeatWrapping;
        mat.map.repeat.set(Math.max(row.box.w / 600, 0.4), Math.max(row.box.h / 600, 0.4));
      }
      // Собираем деталь из слоёв: в каждом вырезаны те отверстия и пазы,
      // что доходят до этой глубины. Если резать нечего — обычный куб.
      const slabs = cuts.length
        ? panelSlabs(uSize, vSize, tSize, cuts)
        : [{ a: 0, b: tSize, cuts: [] }];
      const partGeos = [];
      try {
        for (const sl of slabs) {
          const g = slabGeometry(uSize, vSize, sl.b - sl.a, sl.cuts, MM);
          // Слой разворачивается в мировые оси. Ориентация ФИКСИРОВАНА:
          // «лицо» геометрии смотрит в +X у панелей, в +Y у горизонтальных
          // деталей и в +Z у фасадов. С какой стороны резать — решает флаг
          // fromFront у самого выреза, а не разворот детали.
          const mid = (sl.a + sl.b) / 2;               // от лицевой грани
          const shift = (tSize / 2 - mid) * MM;
          if (planeIsX) {
            g.rotateY(-Math.PI / 2);                   // u → +Z, толщина → +X
            g.translate(shift, 0, 0);
          } else if (planeIsY) {
            g.rotateX(Math.PI / 2);                    // v → +Z, толщина → +Y
            g.translate(0, shift, 0);
          } else {
            g.translate(0, 0, shift);
          }
          partGeos.push(g);
        }
      } catch (err) {
        partGeos.length = 0;
      }
      if (!partGeos.length) {
        partGeos.push(new THREE.BoxGeometry(
          Math.max(locW * MM, 0.001), Math.max(row.box.h * MM, 0.001), Math.max(locD * MM, 0.001)
        ));
      }

      for (const box of row.boxes) {
        const mesh = new THREE.Group();
        for (const g of partGeos) {
          const piece = new THREE.Mesh(g, mat);
          piece.userData.module = row.module;
          mesh.add(piece);
        }
        mesh.userData.module = row.module;   // для выбора модуля кликом
        // Вид детали — для клика по детали внутри изоляции (см. pointerup
        // выше). Лево/право боковины определяем по её имени из engine.js
        // ('Боковина левая'/'Боковина правая') — engine.js уже даёт понятные
        // русские названия, отдельного поля не заводим.
        mesh.userData.kind = row.kind;
        if (row.kind === 'side') {
          mesh.userData.side = (row.name || '').indexOf('лев') >= 0 ? 'left'
            : (row.name || '').indexOf('прав') >= 0 ? 'right' : null;
        }
        mesh.position.set(box.x * MM, box.y * MM, box.z * MM);
        mesh.rotation.y = (rotDeg * Math.PI) / 180;
        // Фрезерованный МДФ: рисуем контур фрезеровки рамкой по лицу
        if (milled && !hideFacades) {
          // Фрезерованное поле УТОПЛЕНО в пласть на 3 мм и отодвинуто от краёв
          // так, чтобы не попадать под ручку (она стоит в 50 мм от края).
          const inset = Math.max((row.frameW || 80), 95) * MM;
          const w = Math.max(box.w * MM - 2 * inset, 0.02);
          const h = Math.max(box.h * MM - 2 * inset, 0.02);
          const depth = Math.min(3 * MM, box.d * MM * 0.35);
          const fieldMat = new THREE.MeshStandardMaterial({
            color: isActive ? 0x6fa3cd : 0xe6e2da,
            roughness: 0.14, metalness: 0.05,
          });
          const field = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), fieldMat);
          field.position.z = box.d / 2 * MM - depth / 2;   // утоплено внутрь
          mesh.add(field);
        }
        // РЕЖИМ ПРОВЕРКИ: в каждое отверстие вставляем цветной штырь по его
        // оси и на его глубину. Корпус при этом полупрозрачный, поэтому
        // видно и присадку внутри детали, и с какой стороны она сделана.
        if (drillCheck && (row.holes || []).length) {
          for (const h of row.holes) {
            if (drillOnly && h.kind !== drillOnly) continue;
            const dep = h.through ? tSize : Math.max(h.depth || 6, 4);
            // При включённом фильтре метку укрупняем — её ищут глазами.
            const rr = Math.max(h.d / 2, 1.2) * (drillOnly ? 2.2 : 1) * MM;
            const marker = new THREE.Mesh(
              new THREE.CylinderGeometry(rr, rr, dep * MM, 14),
              new THREE.MeshStandardMaterial({
                color: DRILL_COLOR[h.kind] || 0x555555,
                roughness: 0.35, metalness: 0.1,
                // Метка рисуется ПОВЕРХ полупрозрачных деталей: иначе мелкая
                // присадка внутри корпуса (гнездо защёлки под ящиком, гнёзда
                // в дне) тонет за несколькими слоями и её не видно.
                depthTest: false, transparent: true, opacity: 0.98,
              })
            );
            marker.renderOrder = 999;
            marker.userData.drill = h.kind;      // метка присадки — для прогона
            const u = toU(h);
            const v = toV(h);
            const uc = (u - uSize / 2) * MM;
            const vc = (v - vSize / 2) * MM;
            const fromFront = h.side === 'back' ? !frontIsPlus : frontIsPlus;
            const off = (h.through ? 0 : (tSize / 2 - dep / 2) * (fromFront ? 1 : -1)) * MM;
            if (h.side === 'edge') {
              // ОТВЕРСТИЕ В ТОРЕЦ идёт ОТ КРОМКИ ВГЛУБЬ детали, а не наружу.
              // С какой кромки — видно по самой присадке: координата, которая
              // попала на край пласти, и задаёт ось сверления.
              const ed = edgeDrill(u, v, uSize, vSize, h.depth);
              const atU = ed.alongU, uPos = ed.uPos, vPos = ed.vPos, dLen = ed.len;
              // ось сверления — вдоль u или вдоль v, в мировых осях
              const axis = atU ? (planeIsX ? 'z' : 'x') : (planeIsX ? 'y' : (planeIsY ? 'z' : 'y'));
              if (axis === 'x') marker.rotation.z = Math.PI / 2;
              else if (axis === 'z') marker.rotation.x = Math.PI / 2;
              marker.scale.set(1, dLen / Math.max(dep, 0.001), 1);
              if (planeIsX) marker.position.set(0, vPos * MM, uPos * MM);
              else if (planeIsY) marker.position.set(uPos * MM, 0, vPos * MM);
              else marker.position.set(uPos * MM, vPos * MM, 0);
            } else if (planeIsX) {
              marker.rotation.z = Math.PI / 2;
              marker.position.set(off, vc, uc);
            } else if (planeIsY) {
              marker.position.set(uc, off, vc);
            } else {
              marker.rotation.x = Math.PI / 2;
              marker.position.set(uc, vc, off);
            }
            marker.userData.module = row.module;
            mesh.add(marker);
          }
        }
        // ПОДСКАЗКА ОСЕЙ на экране «Дополнительные отверстия»: рисуем два
        // цветных ребра ПРЯМО НА ЛИЦЕВОЙ ГРАНИ детали — ось X красным (низ
        // грани, от (0,0) до (uSize,0)), ось Y зелёным (левый край, от (0,0)
        // до (0,vSize)) — чтобы было видно, куда физически смотрит каждая
        // ось при вводе координат вручную. Работает независимо от drillCheck
        // — это не про проверку присадки, а про ориентацию детали. row
        // сравнивается по ссылке с opts.axisHintRow — тот же объект
        // model.partsRaw, что резолвит экран «Деталь» в app.js, поэтому
        // подбор детали здесь не дублируется.
        if (opts && opts.axisHintRow && row === opts.axisHintRow) {
          const dep = 2; // мм — чуть приподнимаем индикатор над поверхностью
          // off — та же формула выноса от лицевой грани, что и у маркеров
          // присадки чуть выше (h.through ? 0 : ...), но здесь не сквозное,
          // поэтому просто «вплотную к лицу, со стороны frontIsPlus».
          const off = (tSize / 2 - dep / 2) * (frontIsPlus ? 1 : -1) * MM;
          // Переводим координаты пласти (u,v) в мировые оси — та же логика
          // ветвления planeIsX/planeIsY/else, что и у marker.position.set
          // выше, просто оформленная как функция для двух рёбер сразу.
          const toWorld = (u, v) => {
            const uc = (u - uSize / 2) * MM;
            const vc = (v - vSize / 2) * MM;
            if (planeIsX) return new THREE.Vector3(off, vc, uc);
            if (planeIsY) return new THREE.Vector3(uc, off, vc);
            return new THREE.Vector3(uc, vc, off);
          };
          const p00 = toWorld(0, 0);
          const buildAxisEdge = (p1, color) => {
            const dir = new THREE.Vector3().subVectors(p1, p00);
            const len = Math.max(dir.length(), 0.001);
            const bar = new THREE.Mesh(
              new THREE.CylinderGeometry(1.5 * MM, 1.5 * MM, len, 10),
              new THREE.MeshStandardMaterial({
                color, roughness: 0.3, metalness: 0.1,
                // Рисуем поверх детали (как и маркеры присадки), иначе
                // индикатор тонет за материалом панели.
                depthTest: false, transparent: true, opacity: 0.98,
              })
            );
            bar.position.copy(p00).addScaledVector(dir, 0.5);
            // CylinderGeometry по умолчанию вытянут вдоль своей оси Y —
            // разворачиваем её на направление ребра в мировых координатах.
            bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
            bar.renderOrder = 999;
            bar.userData.axisHint = true;
            mesh.add(bar);
          };
          // Какое ребро (u или v) физически соответствует полю X, а какое —
          // полю Y, решает тот же lenIsU, что и toU/toV выше (строки ~1254-1256):
          // у боковины h.x — это высота (v), а не длина пласти (u), иначе
          // подсказка красит рёбра наоборот тому, что реально сдвинет ввод.
          buildAxisEdge(toWorld(uSize, 0), lenIsU ? AXIS_X_COLOR : AXIS_Y_COLOR);
          buildAxisEdge(toWorld(0, vSize), lenIsU ? AXIS_Y_COLOR : AXIS_X_COLOR);
          // Отдаём те же точки наружу (в МИРОВЫХ мм) — оверлей размеров на
          // видах спереди/сбоку/сверху рисует размерные линии по ним поверх
          // цветной 3D-сцены. mesh ещё не добавлен в this.group, но
          // position/rotation.y на нём уже выставлены выше по коду, поэтому
          // localToWorld() на основе собственной матрицы даёт верный результат.
          mesh.updateMatrixWorld(true);
          const originW = mesh.localToWorld(p00.clone());
          const xEndW = mesh.localToWorld(toWorld(uSize, 0).clone());
          const yEndW = mesh.localToWorld(toWorld(0, vSize).clone());
          const holesW = (row.holes || [])
            .filter((h) => h.kind === 'custom')
            .map((h) => {
              const hp = toWorld(toU(h), toV(h));
              const hw = mesh.localToWorld(hp.clone());
              return { x: h.x, y: h.y, d: h.d, world: { x: hw.x / MM, y: hw.y / MM, z: hw.z / MM } };
            });
          this._axisHint = {
            origin: { x: originW.x / MM, y: originW.y / MM, z: originW.z / MM },
            xEnd: { x: xEndW.x / MM, y: xEndW.y / MM, z: xEndW.z / MM },
            yEnd: { x: yEndW.x / MM, y: yEndW.y / MM, z: yEndW.z / MM },
            holes: holesW,
          };
        }
        // Контур детали. Присадку наклейками больше НЕ рисуем: отверстия и
        // пазы вырезаны в самой геометрии, у глухого отверстия есть дно.
        for (const g of partGeos) {
          const line = new THREE.LineSegments(new THREE.EdgesGeometry(g),
            new THREE.LineBasicMaterial({ color: isActive ? 0x1d5c8f : 0x8a7a5a }));
          mesh.add(line);
        }
        this.group.add(mesh);
      }
    }

    // Камеру подгоняем под габарит только когда габарит изменился — иначе
    // зум пользователя сбрасывался бы при каждой правке параметра.
    this._lastDims = { W, H, D };
    this._fitOrtho();
    const key = `${W}|${H}|${D}`;
    if (key !== this._fitKey) {
      this._fitKey = key;
      const maxDim = Math.max(W, H, D, 1000) * MM;
      this.controls.setFromDistance(maxDim * 1.6, Math.max(H, 800) * MM * 0.45);
    }
  }
}

// ---------------------------------------------------------------------------
// ОФСКРИН-МИНИАТЮРА (PNG) ДЛЯ ПЛИТКИ ГАЛЕРЕИ ПРЕСЕТОВ
// ---------------------------------------------------------------------------
// Отдельная лёгкая функция, НЕ связанная с классом Viewer3D и его канвой:
// галерея пресетов должна показать маленькую картинку готового модуля ДО
// того, как пользователь его выбрал (Viewer3D в этот момент занят текущим
// проектом). Полный конвейер render() у Viewer3D режет каждую деталь на
// слои с вырезами под присадку, паз, рамочные фасады, фрезеровку МДФ,
// реальные меши опор и т.д. — для иконки 140×140 этого не видно, а строить
// это было бы дорого и рискованно дублировать. Поэтому здесь — упрощённый
// путь: каждая деталь рисуется одним THREE.BoxGeometry по её собственному
// row.box (те же поля, что использует Viewer3D.render, — расхождения по
// размерам и позициям исключены, так как это одни и те же model.partsRaw),
// а вся фурнитура (опоры, ручки, штанги, полкодержатели, фланцы — все
// row.shape !== 'box') для силуэта не критична и пропускается.
function renderThumbnail(model, opts) {
  if (!THREE || !model || !model.dims) return null;
  const source = model.partsRaw || model.parts || [];
  if (!source.length) return null;

  const size = (opts && opts.size) || 140;
  const geoms = [];   // всё, что создали здесь, — освобождаем в finally
  const mats = [];
  let renderer = null;

  try {
    const scene = new THREE.Scene();
    scene.background = null;   // прозрачный фон — подложку задаёт CSS плитки

    // Минимальный свет: рассеянный + один направленный, только чтобы грани
    // читались объёмно (полный вариант — Viewer3D._addLights()).
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(3, 5, 4);
    scene.add(dir);

    const group = new THREE.Group();
    scene.add(group);

    for (const row of source) {
      // Фурнитуру (опоры/ручки/штанги/полкодержатели/фланцы) для маленькой
      // иконки не рисуем — силуэт модуля определяют только листовые детали.
      // Сюда же попадает и опора: она использует src/legMeshes.js, который
      // по правилам проекта не читаем и не трогаем.
      if (row.shape && row.shape !== 'box') continue;
      const box = row.box;
      if (!box || !(box.w > 0) || !(box.h > 0) || !(box.d > 0)) continue;

      // Цвет — по материалу детали (тот же decorLook/KIND_COLOR, что и в
      // основной сцене), без текстур: для иконки достаточно плоского тона.
      // В нейтральном режиме (opts.neutral) реальный декор игнорируем —
      // все детали красим одним светлым тоном, а силуэт читается по
      // контуру (EdgesGeometry), а не по цвету материала.
      const neutral = !!(opts && opts.neutral);
      const look = decorLook(row.material);
      const asFacade = !!row.facadeType;
      const color = look ? look.color
        : (KIND_COLOR[row.kind] ?? (asFacade ? KIND_COLOR.door : KIND_COLOR.side));

      const geo = new THREE.BoxGeometry(
        Math.max(box.w * MM, 0.001), Math.max(box.h * MM, 0.001), Math.max(box.d * MM, 0.001));
      const mat = new THREE.MeshStandardMaterial({
        color: row.glass ? 0xbfe3ea : (neutral ? 0xf1efe8 : color),
        roughness: 0.7, metalness: 0.03,
        transparent: !!row.glass, opacity: row.glass ? 0.4 : 1,
      });
      geoms.push(geo); mats.push(mat);

      const mesh = new THREE.Mesh(geo, mat);
      // Позиция и поворот — те же поля box.x/y/z и rot, что даёт engine.js
      // и что использует Viewer3D.render (row.box уже в системе координат
      // модуля, mesh.rotation.y довершает разворот целиком).
      mesh.position.set(box.x * MM, box.y * MM, box.z * MM);
      mesh.rotation.y = ((row.rot || 0) * Math.PI) / 180;

      if (neutral) {
        // Контур детали — та же техника, что и в основном 3D-виде
        // (Viewer3D.render): EdgesGeometry поверх боксовой геометрии, тем
        // же mesh.position/rotation (edges — дочерний объект mesh).
        const edgesGeo = new THREE.EdgesGeometry(geo);
        const edgesMat = new THREE.LineBasicMaterial({ color: 0x33302a });
        geoms.push(edgesGeo); mats.push(edgesMat);
        const edges = new THREE.LineSegments(edgesGeo, edgesMat);
        mesh.add(edges);
      }

      group.add(mesh);
    }

    if (!group.children.length) return null;   // нечего показывать

    // Bounding box всей модели — под него подгоняем камеру так, чтобы модуль
    // был виден целиком с небольшим отступом по краям.
    const box3 = new THREE.Box3().setFromObject(group);
    if (box3.isEmpty()) return null;
    const sphere = box3.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center;
    const radius = Math.max(sphere.radius, 0.05);

    // Изометрический ракурс — тот же угол, что и вид «3D» по умолчанию в
    // основном вьювере (см. SimpleOrbitControl: theta=PI/4, phi=PI/2.6).
    const theta = Math.PI / 4;
    const phi = Math.PI / 2.6;
    const fovDeg = 35;
    // Расстояние, на котором вся ограничивающая сфера модели укладывается
    // в поле зрения камеры, плюс запас на отступ по краям иконки.
    const dist = (radius / Math.sin((fovDeg * Math.PI) / 360)) * 1.15;
    const camera = new THREE.PerspectiveCamera(fovDeg, 1, 0.01, Math.max(dist * 4, 100));
    camera.position.set(
      center.x + dist * Math.sin(phi) * Math.sin(theta),
      center.y + dist * Math.cos(phi),
      center.z + dist * Math.sin(phi) * Math.cos(theta)
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(center);

    // Канва одноразовая и НЕ добавляется в document: в three.js r128
    // WebGL-контекст создаётся прямо на переданном canvas-элементе, ему не
    // нужно быть частью DOM, чтобы отрендерить кадр и прочитать его через
    // toDataURL — так меньше уборки за собой (не нужно ничего вынимать из
    // страницы после рендера).
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, preserveDrawingBuffer: true, alpha: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);

    return renderer.domElement.toDataURL('image/png');
  } catch (err) {
    return null;
  } finally {
    // Освобождаем ВСЁ: геометрию и материалы деталей и сам WebGL-контекст.
    // Функция вызывается подряд по числу пресетов в галерее (десяток+) —
    // если не закрывать контекст явно, браузер быстро упрётся в лимит
    // одновременных WebGL-контекстов, и дальнейшие иконки перестанут
    // рендериться.
    for (const g of geoms) g.dispose();
    for (const m of mats) m.dispose();
    if (renderer) {
      renderer.dispose();
      if (typeof renderer.forceContextLoss === 'function') renderer.forceContextLoss();
    }
  }
}

window.Modul3D = window.Modul3D || {};
// panelSlabs выносим наружу: это чистая математика раскладки слоёв,
// её проверяет tools/geometry.js без браузера и без Three.js.
window.Modul3D.viewer = {
  Viewer3D, panelSlabs, lengthAlongU, edgeDrill, DRILL_COLOR, DRILL_TITLE,
  renderThumbnail,
};
})();
