// tools/three-stub.js
// ============================================================================
// Заглушка Three.js для прогона 3D-слоя БЕЗ браузера и без самой библиотеки
// (её нет в песочнице). Реализует ровно тот минимум, который вызывает
// viewer.js: объекты сцены, геометрии, материалы и луч выбора.
//
// Задача заглушки — не рисовать, а проверить ЛОГИКУ: что деталь собралась,
// что у каждого куска есть имя модуля и что клик по нему находит владельца.
// ============================================================================
'use strict';

class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
}
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new Vector3(this.x, this.y, this.z); }
  lerp() { return this; }
  add() { return this; }
  sub() { return this; }
  applyAxisAngle() { return this; }
  normalize() { return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
}
class Euler extends Vector3 {}
// Matrix4/Matrix3 — тем же приёмом, что и Vector3 выше: методы, которые бы
// считали настоящий поворот/перенос, просто возвращают this без изменений.
// Нужны только затем, чтобы `new THREE.Matrix4()...` в viewer.js (см.
// csgTools — инструменты для булева вычитания, csg.js) не падал с «is not a
// constructor»; сама резка (csg.js) реальных position/normal в этой
// заглушке всё равно не получит (BoxGeometry/CylinderGeometry здесь —
// геометрия-пустышка geo(), без вершин), поэтому render() и так уходит по
// try/catch на запасной путь — заглушке достаточно не мешать этому дойти.
class Matrix4 {
  constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  makeRotationX() { return this; }
  makeRotationY() { return this; }
  makeRotationZ() { return this; }
  setPosition(x, y, z) { this.elements[12] = x; this.elements[13] = y; this.elements[14] = z; return this; }
  multiply() { return this; }
}
class Matrix3 {
  constructor() { this.elements = [1, 0, 0, 0, 1, 0, 0, 0, 1]; }
  getNormalMatrix() { return this; }
}

class Object3D {
  constructor() {
    this.up = new Vector3(0, 1, 0);
    this.position = new Vector3();
    this.rotation = new Euler();
    this.scale = new Vector3(1, 1, 1);
    this.userData = {};
    this.children = [];
    this.parent = null;
    this.visible = true;
  }
  add(o) { if (o) { o.parent = this; this.children.push(o); } return this; }
  remove(o) { this.children = this.children.filter((c) => c !== o); return this; }
  lookAt() {}
  updateMatrixWorld() {}
  traverse(fn) { fn(this); this.children.forEach((c) => c.traverse(fn)); }
}
class Group extends Object3D {}
class Scene extends Object3D { constructor() { super(); this.background = null; } }
class Mesh extends Object3D {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; this.isMesh = true; }
}
class LineSegments extends Mesh { constructor(g, m) { super(g, m); this.isMesh = false; this.isLine = true; } }

class Geometry {
  constructor(kind, params) { this.kind = kind; this.params = params || {}; }
  translate() { return this; }
  rotateX() { return this; }
  rotateY() { return this; }
  rotateZ() { return this; }
  computeVertexNormals() { return this; }
  dispose() {}
}
const geo = (kind) => class extends Geometry { constructor(...a) { super(kind, a); } };

class Path {
  constructor() { this.ops = []; }
  moveTo(...a) { this.ops.push(['m', a]); }
  lineTo(...a) { this.ops.push(['l', a]); }
  absarc(...a) { this.ops.push(['a', a]); }
  quadraticCurveTo(...a) { this.ops.push(['q', a]); }
  closePath(...a) { this.ops.push(['z', a]); }
}
class Shape extends Path { constructor() { super(); this.holes = []; } }

class ExtrudeGeometry extends Geometry {
  constructor(shape, opts) {
    super('extrude', [opts]);
    this.shape = shape;
    this.holes = (shape && shape.holes) ? shape.holes.length : 0;
    this.depth = (opts && opts.depth) || 0;
  }
}

class BufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; }
}
class BufferGeometry extends Geometry {
  constructor() { super('buffer', {}); this.attributes = {}; }
  setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  computeVertexNormals() { return this; }
  computeBoundingBox() { return this; }
}
class Material { constructor(p) { Object.assign(this, p || {}); } dispose() {} }
class Color { constructor(c) { this.value = c; } }

class Raycaster {
  constructor() { this.params = { Line: { threshold: 1 }, Points: { threshold: 1 } }; }
  setFromCamera() {}
  // Настоящий Three возвращает и ЛИНИИ контура, причём с порогом в целую
  // единицу они часто оказываются ближе детали. Заглушка ставит их ПЕРВЫМИ:
  // если код не отсеивает контуры, прогон это увидит.
  intersectObjects(list, recursive) {
    const meshes = [];
    const lines = [];
    const walk = (o) => {
      if (o.isLine) lines.push({ object: o, point: new Vector3() });
      else if (o.isMesh) meshes.push({ object: o, point: new Vector3() });
      if (recursive) o.children.forEach(walk);
    };
    (list || []).forEach(walk);
    return lines.concat(meshes);
  }
}

function fakeCanvas() {
  const listeners = new Map();
  return {
    style: {}, width: 800, height: 600, clientWidth: 800, clientHeight: 600,
    addEventListener: (t, fn) => {
      if (!listeners.has(t)) listeners.set(t, []);
      listeners.get(t).push(fn);
    },
    removeEventListener: () => {},
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    getContext: () => null,
    _fire: (t, ev) => (listeners.get(t) || []).forEach((fn) => fn(ev || {})),
    _has: (t) => (listeners.get(t) || []).length,
  };
}

class WebGLRenderer {
  constructor() { this.domElement = fakeCanvas(); this.shadowMap = {}; }
  setSize() {} setPixelRatio() {} setClearColor() {} render() {} dispose() {}
}

const THREE = {
  Vector2, Vector3, Euler, Matrix4, Matrix3, Object3D, Group, Scene, Mesh, LineSegments,
  BoxGeometry: geo('box'), CylinderGeometry: geo('cyl'), CircleGeometry: geo('circle'),
  PlaneGeometry: geo('plane'), SphereGeometry: geo('sphere'), EdgesGeometry: geo('edges'),
  ExtrudeGeometry, Shape, Path, BufferGeometry, BufferAttribute, Float32BufferAttribute: BufferAttribute,
  MeshStandardMaterial: Material, MeshPhongMaterial: Material, MeshBasicMaterial: Material, LineBasicMaterial: Material,
  Color, Raycaster, WebGLRenderer,
  PerspectiveCamera: class extends Object3D { constructor() { super(); this.aspect = 1; } updateProjectionMatrix() {} },
  OrthographicCamera: class extends Object3D { constructor() { super(); } updateProjectionMatrix() {} },
  AmbientLight: class extends Object3D {}, DirectionalLight: class extends Object3D {},
  HemisphereLight: class extends Object3D {}, GridHelper: class extends Object3D {},
  CanvasTexture: class { constructor() { this.wrapS = 0; this.wrapT = 0; this.repeat = new Vector2(1, 1); } clone() { return new THREE.CanvasTexture(); } },
  RepeatWrapping: 1000, DoubleSide: 2, sRGBEncoding: 3, PCFSoftShadowMap: 1,
  MathUtils: { clamp: (v, a, b) => Math.min(Math.max(v, a), b) },
};
module.exports = { THREE, fakeCanvas };
