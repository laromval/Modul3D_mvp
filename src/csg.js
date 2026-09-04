// csg.js
// ============================================================================
// CSG — булевы операции над солидами (вычитание/объединение/пересечение) по
// алгоритму BSP-дерева (Evan Wallace, csg.js, 2011, общественное достояние —
// это самая известная и многократно воспроизведённая реализация, адаптирована
// здесь под THREE.BufferGeometry напрямую: в Three.js r128 класса
// THREE.Geometry с его vertices/faces уже нет, только буферы).
//
// Зачем: раньше отверстия и пазы резались приближённо — вручную считанные
// «слои по толщине» (slabs) с дырами в 2D-контуре каждого слоя. Это ломалось
// всякий раз, когда два выреза оказывались рядом (лишние швы-кольца на
// соседних отверстиях) или физически пересекались (Rastex эксцентрик+шток —
// показывало обрубленный эксцентрик). Настоящее булево вычитание не имеет
// этого класса багов в принципе: результат — один цельный кусок геометрии,
// без внутренних швов, вне зависимости от того, сколько вырезов и как они
// расположены друг относительно друга.
//
// Используется отовсюду, где нужно вычесть одну геометрию из другой — не
// только под присадку в viewer.js: то же самое понадобится для выреза под
// мойку/варочную панель в столешнице и т.п.
//
// Классический скрипт (без import/export) — публикует себя в window.Modul3D.
// ============================================================================
(function () {
  const EPSILON = 1e-5;

  function CVertex(pos, normal) {
    this.pos = pos.clone();
    this.normal = normal.clone();
  }
  CVertex.prototype.clone = function () { return new CVertex(this.pos, this.normal); };
  CVertex.prototype.flip = function () { this.normal.multiplyScalar(-1); };
  CVertex.prototype.interpolate = function (other, t) {
    return new CVertex(this.pos.clone().lerp(other.pos, t), this.normal.clone().lerp(other.normal, t));
  };

  function CPlane(normal, w) { this.normal = normal; this.w = w; }
  CPlane.fromPoints = function (a, b, c) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    return new CPlane(n, n.dot(a));
  };
  CPlane.prototype.clone = function () { return new CPlane(this.normal.clone(), this.w); };
  CPlane.prototype.flip = function () { this.normal.multiplyScalar(-1); this.w = -this.w; };
  // Режет polygon этой плоскостью, раскладывая результат по четырём спискам:
  // coplanarFront/Back — лежит В плоскости (той же или обратной стороной),
  // front/back — целиком по одну сторону, а если пересекает плоскость —
  // делится на две части и обрезки добавляются в front и back одновременно.
  CPlane.prototype.splitPolygon = function (polygon, coplanarFront, coplanarBack, front, back) {
    const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;
    let polygonType = 0;
    const types = [];
    for (let i = 0; i < polygon.vertices.length; i++) {
      const t = this.normal.dot(polygon.vertices[i].pos) - this.w;
      const type = t < -EPSILON ? BACK : t > EPSILON ? FRONT : COPLANAR;
      polygonType |= type;
      types.push(type);
    }
    switch (polygonType) {
      case COPLANAR:
        (this.normal.dot(polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
        break;
      case FRONT:
        front.push(polygon);
        break;
      case BACK:
        back.push(polygon);
        break;
      default: { // SPANNING
        const f = [], b = [];
        for (let i = 0; i < polygon.vertices.length; i++) {
          const j = (i + 1) % polygon.vertices.length;
          const ti = types[i], tj = types[j];
          const vi = polygon.vertices[i], vj = polygon.vertices[j];
          if (ti !== BACK) f.push(vi);
          if (ti !== FRONT) b.push(ti !== BACK ? vi.clone() : vi);
          if ((ti | tj) === SPANNING) {
            const t = (this.w - this.normal.dot(vi.pos)) / this.normal.dot(new THREE.Vector3().subVectors(vj.pos, vi.pos));
            const v = vi.interpolate(vj, t);
            f.push(v);
            b.push(v.clone());
          }
        }
        if (f.length >= 3) front.push(new CPolygon(f));
        if (b.length >= 3) back.push(new CPolygon(b));
      }
    }
  };

  function CPolygon(vertices) {
    this.vertices = vertices;
    this.plane = CPlane.fromPoints(vertices[0].pos, vertices[1].pos, vertices[2].pos);
  }
  CPolygon.prototype.clone = function () {
    return new CPolygon(this.vertices.map((v) => v.clone()));
  };
  CPolygon.prototype.flip = function () {
    this.vertices.reverse();
    this.vertices.forEach((v) => v.flip());
    this.plane.flip();
  };

  function CNode(polygons) {
    this.plane = null;
    this.front = null;
    this.back = null;
    this.polygons = [];
    if (polygons) this.build(polygons);
  }
  CNode.prototype.clone = function () {
    const node = new CNode();
    node.plane = this.plane && this.plane.clone();
    node.front = this.front && this.front.clone();
    node.back = this.back && this.back.clone();
    node.polygons = this.polygons.map((p) => p.clone());
    return node;
  };
  CNode.prototype.invert = function () {
    for (let i = 0; i < this.polygons.length; i++) this.polygons[i].flip();
    this.plane.flip();
    if (this.front) this.front.invert();
    if (this.back) this.back.invert();
    const t = this.front; this.front = this.back; this.back = t;
  };
  CNode.prototype.clipPolygons = function (polygons) {
    if (!this.plane) return polygons.slice();
    let front = [], back = [];
    for (let i = 0; i < polygons.length; i++) {
      this.plane.splitPolygon(polygons[i], front, back, front, back);
    }
    if (this.front) front = this.front.clipPolygons(front);
    back = this.back ? this.back.clipPolygons(back) : [];
    return front.concat(back);
  };
  CNode.prototype.clipTo = function (bsp) {
    this.polygons = bsp.clipPolygons(this.polygons);
    if (this.front) this.front.clipTo(bsp);
    if (this.back) this.back.clipTo(bsp);
  };
  CNode.prototype.allPolygons = function () {
    let polygons = this.polygons.slice();
    if (this.front) polygons = polygons.concat(this.front.allPolygons());
    if (this.back) polygons = polygons.concat(this.back.allPolygons());
    return polygons;
  };
  CNode.prototype.build = function (polygons) {
    if (!polygons.length) return;
    if (!this.plane) this.plane = polygons[0].plane.clone();
    const front = [], back = [];
    for (let i = 0; i < polygons.length; i++) {
      this.plane.splitPolygon(polygons[i], this.polygons, this.polygons, front, back);
    }
    if (front.length) {
      if (!this.front) this.front = new CNode();
      this.front.build(front);
    }
    if (back.length) {
      if (!this.back) this.back = new CNode();
      this.back.build(back);
    }
  };

  function CSolid(polygons) { this.polygons = polygons || []; }
  CSolid.prototype.clone = function () {
    return new CSolid(this.polygons.map((p) => p.clone()));
  };
  CSolid.prototype.subtract = function (other) {
    const a = new CNode(this.clone().polygons);
    const b = new CNode(other.clone().polygons);
    a.invert();
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allPolygons());
    a.invert();
    return new CSolid(a.allPolygons());
  };
  CSolid.prototype.union = function (other) {
    const a = new CNode(this.clone().polygons);
    const b = new CNode(other.clone().polygons);
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allPolygons());
    return new CSolid(a.allPolygons());
  };

  // BufferGeometry (+ мировая/локальная матрица) → набор выпуклых треугольных
  // полигонов CSG. Матрица приходит уже применённой к позиции/нормали —
  // так вызывающий код может резать в любой удобной системе координат
  // (обычно — в локальной системе самой детали, ДО поворота в мировые оси).
  function fromBufferGeometry(geometry, matrix) {
    const polygons = [];
    const posAttr = geometry.attributes.position;
    const normAttr = geometry.attributes.normal;
    const index = geometry.index;
    const normalMat = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
    const readVertex = (i) => {
      const pos = new THREE.Vector3().fromBufferAttribute(posAttr, i);
      const nrm = normAttr
        ? new THREE.Vector3().fromBufferAttribute(normAttr, i)
        : new THREE.Vector3(0, 0, 1);
      if (matrix) {
        pos.applyMatrix4(matrix);
        if (normalMat) nrm.applyMatrix3(normalMat).normalize();
      }
      return new CVertex(pos, nrm);
    };
    const triCount = index ? index.count : posAttr.count;
    for (let i = 0; i < triCount; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      const v0 = readVertex(ia), v1 = readVertex(ib), v2 = readVertex(ic);
      // Вырожденный треугольник (нулевая площадь — совпадающие/коллинеарные
      // вершины) роняет CPlane.fromPoints (normalize() нулевого вектора даёт
      // NaN) — такое изредка бывает на швах примитивов Three.js, пропускаем.
      const cross = new THREE.Vector3().subVectors(v1.pos, v0.pos)
        .cross(new THREE.Vector3().subVectors(v2.pos, v0.pos));
      if (cross.lengthSq() < 1e-14) continue;
      polygons.push(new CPolygon([v0, v1, v2]));
    }
    return new CSolid(polygons);
  }

  // CSG-солид → BufferGeometry (позиция + нормаль, без индекса). Полигон
  // после булевых операций может стать НЕ треугольником (splitPolygon режет
  // по плоскостям, вершин может прибавиться) — но всегда остаётся выпуклым
  // (резали изначально выпуклые прямоугольники/окружности плоскостями,
  // невыпуклым такой полигон стать не может), поэтому веерная триангуляция
  // от первой вершины корректна.
  //
  // Деталь режется несколькими отверстиями подряд (solid.subtract() вызывается
  // по одному разу на каждый инструмент) — численная погрешность плавающей
  // точки от повторных splitPolygon накапливается, и точка, которая должна
  // быть ОДНОЙ и той же на границе двух соседних граней, у них расходится на
  // доли микрона. THREE.EdgesGeometry сверяет вершины соседних треугольников
  // по округлённому хешу (точность ~0.1мм) — если из-за такого шума хеши не
  // совпали, ребро считается "внешним" и рисуется линией, хотя внутри детали
  // его быть не должно: в реальном рендере это выглядело как звёздчатый пучок
  // тонких линий вокруг вырезов. Лечится привязкой финальных координат к сетке
  // (0.1мм — грубее, чем реальный допуск станка ЧПУ, поэтому геометрию не
  // портит) и отбрасыванием треугольников, которые из-за этого выродились.
  function toBufferGeometry(solid) {
    const SNAP = 1e-4; // 0.1 мм в метрах
    const snap = (v) => {
      v.x = Math.round(v.x / SNAP) * SNAP;
      v.y = Math.round(v.y / SNAP) * SNAP;
      v.z = Math.round(v.z / SNAP) * SNAP;
      return v;
    };
    const positions = [];
    const normals = [];
    for (const poly of solid.polygons) {
      const verts = [];
      for (const v of poly.vertices) {
        const pos = snap(v.pos.clone());
        const prev = verts[verts.length - 1];
        if (prev && prev.pos.distanceToSquared(pos) < 1e-12) continue;
        verts.push({ pos, normal: v.normal });
      }
      if (verts.length > 1 && verts[0].pos.distanceToSquared(verts[verts.length - 1].pos) < 1e-12) {
        verts.pop();
      }
      if (verts.length < 3) continue;
      for (let i = 2; i < verts.length; i++) {
        const a = verts[0], b = verts[i - 1], c = verts[i];
        const ab = new THREE.Vector3().subVectors(b.pos, a.pos);
        const ac = new THREE.Vector3().subVectors(c.pos, a.pos);
        if (ab.cross(ac).lengthSq() < 1e-14) continue; // вырожденный после привязки к сетке
        positions.push(a.pos.x, a.pos.y, a.pos.z, b.pos.x, b.pos.y, b.pos.z, c.pos.x, c.pos.y, c.pos.z);
        normals.push(
          a.normal.x, a.normal.y, a.normal.z,
          b.normal.x, b.normal.y, b.normal.z,
          c.normal.x, c.normal.y, c.normal.z
        );
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return geo;
  }

  // Публичный API. base/tools — { geometry: THREE.BufferGeometry, matrix?:
  // THREE.Matrix4 } — matrix переводит геометрию инструмента в систему
  // координат base ДО вычитания (обычно так и нужно: инструмент строится в
  // своих естественных координатах — например, цилиндр вдоль своей оси Y —
  // а матрица кладёт его в нужное место и с нужным поворотом относительно
  // детали). Возвращает обычный THREE.BufferGeometry, готовый в new
  // THREE.Mesh(geo, mat) — как любая другая геометрия.
  function subtractMany(base, tools) {
    let solid = fromBufferGeometry(base.geometry, base.matrix || null);
    for (const t of tools) {
      const toolSolid = fromBufferGeometry(t.geometry, t.matrix || null);
      solid = solid.subtract(toolSolid);
    }
    return toBufferGeometry(solid);
  }

  window.Modul3D = window.Modul3D || {};
  window.Modul3D.csg = { subtractMany, fromBufferGeometry, toBufferGeometry, CSolid };
})();
