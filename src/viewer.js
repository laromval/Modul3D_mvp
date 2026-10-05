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
// Сколько метров РЕАЛЬНОЙ детали укладывается в один тайл canvas-текстуры
// «под древесину» — см. применение в блоке mat.map.repeat ниже: густота
// волокна (линий на мм) должна быть одной и той же у любой детали одной
// породы, независимо от её размера. Значение — отправная точка (даёт для
// двери примерно тот же масштаб по ширине, что и раньше); точное число
// декоративное и его можно потом подправить визуально по вкусу.
const WOOD_TILE_M = 0.6;

// Растровая плитка декора (src/decorTiles.js): настоящий бесшовный фрагмент листа
// производителя (дуб Бардолино H1145). Волокно в ней идёт вдоль оси x текстуры — как
// у woodTexture(), поэтому направление волокна (grainAxis), сдвиг фазы между деталями
// и uvSwap работают ровно так же. Картинка грузится асинхронно (data:-URI), текстура
// обновляется по готовности — сцена перерисовывается сама (_animate).
const _tileTexCache = {};
function decorTileSpec(code) {
  const dt = window.Modul3D && window.Modul3D.decorTiles;
  return (dt && code && dt.byCode[code]) || null;
}
function tileColor(k) {
  const v = Math.round(255 * (k || 0.88));
  return (v << 16) | (v << 8) | v;
}
function tileTexture(spec) {
  if (_tileTexCache[spec.src]) return _tileTexCache[spec.src];
  const img = new Image();
  const t = new THREE.Texture(img);
  // Клоны (на материалы деталей) могут появиться ДО окончания загрузки картинки:
  // запоминаем их и после onload просим перезагрузить на GPU (иначе у клона version
  // не меняется и three каждый кадр ругается «image is not complete»).
  let pending = [t];
  const track = (tex) => {
    tex.clone = function () {
      const c = THREE.Texture.prototype.clone.call(this);
      if (pending) pending.push(c);
      track(c);
      return c;
    };
  };
  track(t);
  img.onload = () => { const list = pending; pending = null; list.forEach((x) => { x.needsUpdate = true; }); };
  img.src = spec.src;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  markShared(t);
  _tileTexCache[spec.src] = t;
  return t;
}

// НЕ ПОВТОРЯТЬ РИСУНОК ЧЕРЕЗ ПЕРИОД. Плитка бесшовна, но у 1300 мм повторяется один в
// один — на ряде одинаковых модулей это видно «через раз». Поэтому в шейдере каждая
// клетка плитки зеркалится: по x — по хэшу номера её СТОЛБЦА, по y — по хэшу номера
// СТРОКИ (spec.mode 'hash'; у непериодичных листов — 'mirror': чередование, зеркальный
// стык клеток непрерывен всегда). Так стык клеток остаётся непрерывным (зеркало границы периодической плитки
// совпадает с самой границей, а у соседей по столбцу/строке одинаковое отражение), а
// последовательность клеток перестаёт быть периодической. Нужен WebGL2 (textureGrad —
// чтобы на стыках клеток не было шва от скачка производных). Иначе — как раньше.
let _tileFlipOk = null;
function tileFlipSupported() {
  if (_tileFlipOk === null) {
    try { _tileFlipOk = !!document.createElement('canvas').getContext('webgl2'); } catch (e) { _tileFlipOk = false; }
  }
  return _tileFlipOk;
}
function applyTileFlip(mat, mode) {
  if (!tileFlipSupported()) return;
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec2 tcell = floor(vUv);
        vec2 tf = vUv - tcell;
        vec2 tdx = dFdx(vUv), tdy = dFdy(vUv);
        ${mode === 'mirror'
          ? 'float thx = mod(tcell.x, 2.0), thy = mod(tcell.y, 2.0);'
          : 'float thx = fract(sin(tcell.x * 12.9898 + 4.1) * 43758.5453), thy = fract(sin(tcell.y * 78.233 + 9.7) * 43758.5453);'}
        if (thx > 0.5) { tf.x = 1.0 - tf.x; tdx.x = -tdx.x; tdy.x = -tdy.x; }
        if (thy > 0.5) { tf.y = 1.0 - tf.y; tdx.y = -tdx.y; tdy.y = -tdy.y; }
        vec4 texelColor = textureGrad(map, tf, tdx, tdy);
        texelColor = mapTexelToLinear(texelColor);
        diffuseColor *= texelColor;
      #endif`);
  };
  mat.customProgramCacheKey = () => 'tileFlip' + mode;
}

// Текстура ЛДСП рисуется прямо в браузере: полосы «под древесину». Так не
// нужны внешние файлы, а фасад из ЛДСП визуально отличается от гладкого МДФ.
//
// БЕСШОВНОСТЬ: плитка повторяется (RepeatWrapping) по обеим осям, поэтому
// рисунок должен «замыкаться» на краях, иначе на стыке плиток виден шов:
//  - по x смещения излома периодичны с периодом SIZE (правый конец линии
//    совпадает с левым), линия рисуется от -STEP до SIZE+STEP — без срезов;
//  - по y каждая линия рисуется трижды со сдвигом -SIZE, 0, +SIZE: что
//    вылезло за верхний/нижний край, дорисовывается с противоположной
//    стороны (лишнее за canvas браузер обрезает сам).
let _woodTex = null;
function woodTexture() {
  if (_woodTex) return _woodTex;
  const SIZE = 256;   // сторона плитки, px
  const STEP = 32;    // шаг излома линии по x, px (SIZE / STEP = 8 сегментов)
  const SEG = SIZE / STEP;
  const c = document.createElement('canvas');
  c.width = SIZE; c.height = SIZE;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#d8c8a8';
  g.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 140; i++) {
    const y = Math.random() * SIZE;
    const a = 0.05 + Math.random() * 0.10;
    g.strokeStyle = `rgba(120, 92, 54, ${a})`;
    g.lineWidth = 0.5 + Math.random() * 1.6;
    // Случайные смещения излома — SEG штук на период; точка k и k+SEG имеют
    // одно и то же смещение, поэтому линия периодична по x.
    const off = [];
    for (let k = 0; k < SEG; k++) off.push((Math.random() - 0.5) * 6);
    for (let dy = -SIZE; dy <= SIZE; dy += SIZE) {
      g.beginPath();
      for (let k = -1; k <= SEG + 1; k++) {
        const px = k * STEP;
        const py = y + dy + off[((k % SEG) + SEG) % SEG];
        if (k === -1) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();
    }
  }
  _woodTex = new THREE.CanvasTexture(c);
  _woodTex.wrapS = THREE.RepeatWrapping;
  _woodTex.wrapT = THREE.RepeatWrapping;
  // Общая на всё приложение: материалы деталей кладут себе её КЛОН
  // (tex.clone()), а саму её освобождать нельзя никогда.
  markShared(_woodTex);
  return _woodTex;
}

// Общая текстура «под древесину» для листового заполнения алюминиевых
// фасадов. Создаётся один раз (клон woodTexture с repeat = 1 тайл на
// WOOD_TILE_M метров) и дальше переиспользуется всеми такими фасадами при
// каждом пересчёте — новой GPU-текстуры на каждый пересчёт не появляется.
// Размер конкретной вставки учитывается в UV её геометрии (makeFramedFacade).
let _aluInsTex = null;
function aluInsetWoodTexture() {
  if (_aluInsTex) return _aluInsTex;
  const base = woodTexture();
  if (!base) return null;
  _aluInsTex = base.clone();
  _aluInsTex.needsUpdate = true;
  _aluInsTex.wrapS = THREE.RepeatWrapping;
  _aluInsTex.wrapT = THREE.RepeatWrapping;
  _aluInsTex.repeat.set(1 / WOOD_TILE_M, 1 / WOOD_TILE_M);
  // Общая на все алюм. фасады — disposeObjectTree() её не освобождает.
  markShared(_aluInsTex);
  return _aluInsTex;
}

// ОСВОБОЖДЕНИЕ ПАМЯТИ ВИДЕОКАРТЫ.
// Three.js не освобождает память видеокарты сам, когда меш просто убрали из
// сцены: геометрия, материал и текстура остаются загруженными на GPU, пока
// у них не вызвали .dispose(). Сцена перестраивается на каждый пересчёт —
// без очистки память росла с каждой правкой параметра.
//
// Но освобождать можно ТОЛЬКО то, что создано именно для этой перестройки.
// Часть ресурсов общая и живёт всю сессию (текстура «под древесину», кэш
// геометрии деталей, куски кухонной опоры и клипсы) — её следующая
// перестройка сразу возьмёт снова. Такие ресурсы помечаем через markShared()
// в месте создания, и disposeObjectTree() их пропускает.
// Метка хранится в отдельном WeakSet, а НЕ в userData: material.clone()
// копирует userData, и клон общего материала/текстуры по ошибке тоже
// считался бы общим (и никогда не освобождался).
const SHARED_GPU = new WeakSet();
function markShared(res) {
  if (res) SHARED_GPU.add(res);
  return res;
}
function isShared(res) {
  return !!res && SHARED_GPU.has(res);
}
// Все слоты текстур, которые бывают у материалов Three.js r128.
const MATERIAL_TEXTURE_SLOTS = [
  'map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap',
  'envMap', 'lightMap', 'metalnessMap', 'normalMap', 'roughnessMap',
  'specularMap', 'gradientMap', 'clearcoatMap', 'clearcoatNormalMap',
  'clearcoatRoughnessMap', 'transmissionMap',
];
function disposeRes(res) {
  if (res && typeof res.dispose === 'function') res.dispose();
}
// Освобождает геометрию, материалы (в т.ч. массивы материалов) и текстуры
// внутри материалов у объекта и всех его потомков — кроме общих (markShared).
// seen — чтобы ресурс, который делят несколько мешей (один материал на все
// бруски рамочного фасада и т.п.), не обрабатывался повторно.
function disposeObjectTree(root) {
  if (!root || typeof root.traverse !== 'function') return;
  const seen = new Set();
  root.traverse((o) => {
    const geo = o.geometry;
    if (geo && !seen.has(geo)) {
      seen.add(geo);
      if (!isShared(geo)) disposeRes(geo);
    }
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      if (isShared(m)) continue;   // общий материал — не трогаем и его текстуры
      for (const slot of MATERIAL_TEXTURE_SLOTS) {
        const tex = m[slot];
        if (!tex || seen.has(tex)) continue;
        seen.add(tex);
        // Клон общей текстуры (tex.clone()) — отдельная GPU-текстура этой
        // перестройки, её освобождаем; саму общую — нет.
        if (!isShared(tex)) disposeRes(tex);
      }
      disposeRes(m);
    }
  });
}

// НЕПРЕРЫВНОСТЬ РИСУНКА ВОЛОКНА МЕЖДУ СОСЕДНИМИ ДЕТАЛЯМИ.
// UV детали в buildSlabGeometry — «сырые» координаты ЕЁ ПЛАСТИ в метрах,
// от центра детали (см. spec.uv там же): это специально, чтобы густота
// волокна не зависела от размера детали. Но у двух соседних деталей одного
// модуля (например, двух дверей корпуса) центры стоят в разных точках
// корпуса — и без поправки фаза узора «переезжает» на стыке (виден шов).
// Чтобы узор был как бы вырезан из одного большого листа, нужно сдвинуть
// UV каждой детали на ЕЁ положение в корпусе — тогда одна и та же мировая
// точка всегда даёт одну и ту же фазу узора, независимо от того, какой
// детали она принадлежит.
//
// Ось u/v детали живёт в системе ГЕОМЕТРИИ уже ПОСЛЕ разворота пласти в
// мировые оси (rotateY/rotateX в месте вызова buildSlabGeometry), но ДО
// общего поворота детали (mesh.rotation.y = rotDeg). planeAxisDirs() как
// раз и даёт направление осей u/v в этой системе координат:
//   боковина (planeIsX)  — u (глубина) вдоль Z, v (высота) вдоль Y;
//   гориз. деталь (planeIsY) — u (длина) вдоль X, v (глубина) вдоль Z;
//   фасад/вертикаль (иначе)  — u (ширина) вдоль X, v (высота) вдоль Y.
function planeAxisDirs(planeIsX, planeIsY) {
  if (planeIsX) return { u: [0, 0, 1], v: [0, 1, 0] };
  if (planeIsY) return { u: [1, 0, 0], v: [0, 0, 1] };
  return { u: [1, 0, 0], v: [0, 1, 0] };
}
// Тот же поворот вокруг Y, что применяет THREE к геометрии/мешу
// (rotateY/mesh.rotation.y) — нужен, чтобы направления осей u/v пересчитать
// в МИРОВЫЕ оси и корректно спроецировать на них положение детали.
function rotateYVec(v, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}
// Смещение UV (в «сырых» метрах пласти, до repeat) для детали с центром
// (box.x, box.y, box.z в мм) и разворотом rotDeg — проекция мировой позиции
// центра детали на мировые направления её осей u/v. Прибавленное к «сырому»
// локальному UV детали (см. buildSlabGeometry), оно превращает его в
// координату, единую для всего корпуса: соседние детали продолжают узор
// друг друга, а не начинают его заново от своего угла.
//
// swapUv — волокно детали идёт вдоль v (см. grainRunsAlongV): UV её геометрии
// тогда переставлены местами (spec.uvSwap в buildSlabGeometry), и смещение
// фазы обязано получить ту же перестановку. Иначе фаза по каждой оси считалась
// бы от чужой координаты, и шов на стыке деталей вернулся бы. Поля u/v в
// результате — это компоненты смещения В ТЕКСТУРНЫХ координатах (x и y плитки).
function woodUvOrigin(box, rotDeg, planeIsX, planeIsY, swapUv) {
  const dirs = planeAxisDirs(planeIsX, planeIsY);
  const rad = ((rotDeg || 0) * Math.PI) / 180;
  const wu = rotateYVec(dirs.u, rad);
  const wv = rotateYVec(dirs.v, rad);
  const bx = box.x * MM, by = box.y * MM, bz = box.z * MM;
  const ou = bx * wu[0] + by * wu[1] + bz * wu[2];
  const ov = bx * wv[0] + by * wv[1] + bz * wv[2];
  return swapUv ? { u: ov, v: ou } : { u: ou, v: ov };
}

// НАПРАВЛЕНИЕ ВОЛОКНА. Движок (engine.js) кладёт в деталь с рисунком поле
// grainAxis — 'x' | 'y' | 'z': ось СИСТЕМЫ МОДУЛЯ (x — ширина, y — высота,
// z — глубина, до общего поворота детали), вдоль которой идёт волокно. Линии
// на woodTexture() идут вдоль её оси x, а UV слэба кладутся так, что x
// текстуры = u пласти (см. planeAxisDirs). Значит:
//   grainAxis совпала с осью u пласти — ничего не делаем (как было);
//   совпала с осью v — волокно надо повернуть на 90° (true из этой функции);
//   не задана / ось толщины / что-то непонятное — «без изменений» (false).
// Детали без рисунка (белый/чёрный декор, МДФ, стекло) поля grainAxis не
// имеют — для них поведение прежнее.
function grainAxisIndex(grainAxis) {
  return grainAxis === 'x' ? 0 : (grainAxis === 'y' ? 1 : (grainAxis === 'z' ? 2 : -1));
}
function grainRunsAlongV(grainAxis, planeIsX, planeIsY) {
  const idx = grainAxisIndex(grainAxis);
  if (idx < 0) return false;
  return planeAxisDirs(planeIsX, planeIsY).v[idx] === 1;
}

// То же для BoxGeometry (миниатюры в renderThumbnail): её родные UV — 0..1 на
// каждую грань, без привязки к метрам и к направлению. Переписываем их в метры
// детали (как у слэба основной сцены), причём для КАЖДОЙ грани по её нормали:
// грань ⟂X — u=Z, v=Y; ⟂Y — u=X, v=Z; ⟂Z — u=X, v=Y (те же planeAxisDirs).
// Если волокно идёт вдоль v грани — u и v меняются местами; торцы, в плоскости
// которых оси волокна нет, остаются как есть.
function applyGrainBoxUv(geo, grainAxis) {
  const idx = grainAxisIndex(grainAxis);
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  if (idx < 0 || !pos || !nor || !uv) return;
  for (let i = 0; i < pos.count; i++) {
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const dirs = planeAxisDirs(Math.abs(nor.getX(i)) > 0.5, Math.abs(nor.getY(i)) > 0.5);
    const iu = dirs.u.indexOf(1), iv = dirs.v.indexOf(1);
    if (idx === iv) uv.setXY(i, p[iv], p[iu]); else uv.setXY(i, p[iu], p[iv]);
  }
  uv.needsUpdate = true;
}

// Цвет детали по её МАТЕРИАЛУ: белый корпус должен быть белым и в 3D, а не
// «древесным» по типу детали. Ищем материал в каталоге и смотрим на название.
function decorLook(code) {
  const base = decorLookBase(code);
  const tile = decorTileSpec(code);
  return tile ? Object.assign({}, base || { color: 0xc9a76a }, { wood: true, tile }) : base;
}
function decorLookBase(code) {
  const cat = (typeof window !== 'undefined' && window.Modul3D && window.Modul3D.catalog) || {};
  const fac = cat.FACADE_MATERIALS || {};
  // COUNTERTOP_MATERIALS — отдельный список каталога (столешницы ЛДСП 38мм и
  // компакт-плита HPL 12мм, коды CTOP-*), раньше сюда не попадал — столешница
  // рендерилась серой заглушкой из KIND_COLOR вместо декора материала.
  const all = [].concat(cat.DECORS || [], cat.BACK_MATERIALS || [], cat.COUNTERTOP_MATERIALS || [],
    Object.keys(fac).map((k) => fac[k]));
  const it = all.filter((x) => x && x.code === code)[0];
  const nm = (it && it.name) || '';
  if (!nm) return null;
  // Однотонные декоры Egger: цвет — средний по официальному листу (egger.com), как
  // есть, ×0.78 (свет сцены усиливает цвет — как у остальных тайлов). Без отдельной ветки «лдсп»/«мдф» в названии красили их как дерево (U702 «серый
  // кашемир» выходил жёлто-оранжевым в полоску).
  if (/U702/i.test(nm)) return { color: 0xa79c92, wood: false };   // 214,200,187 ×0.78
  if (/U250/i.test(nm)) return { color: 0x856f57, wood: false };   // 171,142,112 ×0.78
  if (/U399/i.test(nm)) return { color: 0x491719, wood: false };   // 94,29,33 ×0.78
  if (/бел/i.test(nm)) return { color: 0xf3f1ec, wood: false };
  if (/чёрн|черн/i.test(nm)) return { color: 0x35332f, wood: false };
  // Камень/мрамор/керамика (столешницы CTOP-*, напр. «мрамор Bianco Bello»,
  // «керамика крем») — раньше без отдельной ветки такие декоры попадали в
  // «лдсп»- или «компакт-плита»-фолбэк ниже и красились ДЕРЕВОМ (бежевый цвет
  // + текстура волокна), хотя визуально это гладкий холодный камень. Ветка
  // стоит ДО «дерева»/«лдсп»/«компакт-плиты», но ПОСЛЕ бел/чёрн — уже белый
  // или уже чёрный мрамор/камень должен остаться в тех более точных ветках.
  if (/мрамор|камень|керамика/i.test(nm)) return { color: 0xd9d3c7, wood: false };
  if (/шпон|дуб|сонома|крафт|массив|орех|ясен/i.test(nm)) return { color: 0xc9a76a, wood: true };
  if (/крашен|эмал|плёнк|пленк|мдф/i.test(nm)) return { color: 0xf2efe9, wood: false };
  if (/лдсп|дсп/i.test(nm) && !/стенк/i.test(nm)) return { color: 0xc9a76a, wood: true };
  // Компакт-плита HPL (столешница CTOP-COMPACT12-*): в названии нет «лдсп»/
  // «дсп» (см. регэксп выше), поэтому без отдельной ветки уходила бы в
  // серый fallback. По факту это декоративный HPL-пластик, имитирующий тот
  // же древесный/каменный рисунок (см. каталог — «vintage santa fe oak»),
  // визуально ближе к дереву, чем к гладкому крашеному МДФ — красим так же.
  if (/компакт-плит/i.test(nm)) return { color: 0xc9a76a, wood: true };
  return null;
}

// Лево/право боковины определяем по её имени из engine.js ('Боковина
// левая'/'Боковина правая') — engine.js уже даёт понятные русские названия,
// отдельного поля row.side не заводим. Используется и при разметке
// mesh.userData.side (клик по детали внутри Focus Mode), и в подсчёте
// границ отсека для подсветки без фасада (см. _computeSectionHiBounds) —
// вынесено в одну функцию, чтобы не дублировать этот разбор имени дважды.
function sideOfPartName(name) {
  const n = name || '';
  if (n.indexOf('лев') >= 0) return 'left';
  if (n.indexOf('прав') >= 0) return 'right';
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
// Возвращает:
//   alongU  — ось сверления идёт вдоль «длины» пласти (иначе вдоль «глубины»);
//   atStart — сверлят от НАЧАЛЬНОЙ кромки оси (u=0 / v=0), иначе от конечной;
//   uPos/vPos — центр лунки от центра детали;
//   len     — длина лунки (глубина сверления).
// atStart отдаётся ЯВНО и больше не вычисляется потребителями по знаку uPos:
// при глубине сверления больше самой детали знак переворачивался, лунка
// строилась от противоположной кромки и вылезала наружу.
function edgeDrill(u, v, uSize, vSize, depth) {
  const atU = (u <= 0.5) || (u >= uSize - 0.5);
  // Сверлят от той кромки, к которой прижата координата отверстия. Если
  // отверстие не на кромке вовсе (так бывает у вручную добавленного
  // отверстия со стороной «в торец»), считаем его отнесённым к дальней
  // кромке — ровно как было раньше.
  const atStart = atU ? (u <= 0.5) : (v <= 0.5);
  // Глубже самой детали сверлить некуда: длину лунки ограничиваем размером
  // детали вдоль оси сверления, иначе труба лунки вышла бы с другого конца
  // наружу. Ограничение общее и для метки присадки, и для выреза — они
  // строятся по одному и тому же len.
  const span = Math.max((atU ? uSize : vSize) - 0.5, 1);
  const dLen = Math.min(Math.max(depth || 30, 8), span);
  const uPos = atU ? ((atStart ? dLen / 2 : uSize - dLen / 2) - uSize / 2) : (u - uSize / 2);
  const vPos = atU ? (v - vSize / 2) : ((atStart ? dLen / 2 : vSize - dLen / 2) - vSize / 2);
  return { alongU: atU, atStart, uPos, vPos, len: dLen };
}

// ---------------------------------------------------------------------------
// ЛОУ-ПОЛИ ГЕОМЕТРИЯ ДЕТАЛИ (вместо булева вычитания)
// ---------------------------------------------------------------------------
// Раньше отверстия и пазы вырезались настоящим булевым вычитанием (csg.js).
// Результат был правильный, но чудовищно тяжёлый: каждая грань цилиндра-
// инструмента работает как БЕСКОНЕЧНАЯ секущая плоскость и дробит всю пласть
// на тысячи осколков в одной плоскости. Одно дно с 28 отверстиями выходило
// 22 700 треугольников и 0,4 секунды работы — на телефоне добавление модуля
// из-за этого заметно подвисало (84% всего времени сборки сцены).
//
// Теперь та же деталь собирается АНАЛИТИЧЕСКИ, сразу нужной топологией:
//   • пласть режется горизонтальными полосами;
//   • вокруг каждого отверстия — КВАДРАТНАЯ ячейка со стороной 2×диаметра,
//     от кольца отверстия к границам ячейки идёт пояс четырёхугольников;
//   • свободное место внутри полосы добирается прямоугольниками;
//   • стенка отверстия — труба из N граней, у глухого отверстия есть дно;
//   • паз — прямоугольная выемка: дно + стенки, а торец детали в месте
//     выхода паза получает такую же прямоугольную «ячейку».
// Лучи кольца НИКОГДА не выходят за свою ячейку, поэтому мелкое отверстие
// не режет пласть насквозь линиями через всю деталь. Математика взята
// один в один из рабочего наброска _topology-demo.html (режим 'square').
// ---------------------------------------------------------------------------

const TAU2 = Math.PI * 2;
const GEO_EPS = 1e-6;
// Базовый угол первой вершины кольца. 45° — это угол КВАДРАТНОЙ ячейки:
// при N, кратном четырём, вершины кольца садятся ровно на углы ячейки и
// весь пояс состоит из четырёхугольников. Угол фиксированный (не зависит
// от самой ячейки) — тогда у сквозного отверстия кольца на обеих пластях
// совпадают вершина в вершину и труба стенки стыкуется с ними без щелей.
const RING_BASE = Math.PI / 4;

// Сколько граней у отверстия. Правило согласовано с пользователем:
//   Ø0…4 — 6, Ø5…7 — 8, Ø8…10 — 12, Ø11…15 — 16, крупнее — ⌀×16/15 вверх до
//   кратного четырём (Ø35 → 40). У глухих отверстий столько же, сколько у
//   сквозных.
function segmentsForHole(d) {
  if (d <= 4) return 6;
  if (d <= 7) return 8;
  if (d <= 10) return 12;
  if (d <= 15) return 16;
  return Math.ceil((d * (16 / 15)) / 4) * 4;
}

const normAng = (a) => ((a % TAU2) + TAU2) % TAU2;

// Вершины кольца отверстия в 2D-системе той плоскости, где оно открывается.
function ringPoints(cx, cy, r, N) {
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = RING_BASE + (i / N) * TAU2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

// Точка контура ПРЯМОУГОЛЬНОЙ ячейки на луче из (cx,cy) под углом a.
// Ячейка задаётся как есть (x0..x1, y0..y1) и может быть НЕ центрирована на
// отверстии: у края детали или рядом с соседним вырезом её подрезают.
function onRectRay(cx, cy, x0, y0, x1, y1, a) {
  const c = Math.cos(a), s = Math.sin(a);
  const kx = c >= 0 ? (x1 - cx) / Math.max(c, 1e-9) : (x0 - cx) / Math.min(c, -1e-9);
  const ky = s >= 0 ? (y1 - cy) / Math.max(s, 1e-9) : (y0 - cy) / Math.min(s, -1e-9);
  const k = Math.max(Math.min(kx, ky), 0);
  return [cx + c * k, cy + s * k];
}

// Плоская раскладка — набор треугольников в 2D. Порядок обхода вершин здесь
// не важен: при переносе в 3D он выправляется по нужной нормали (SlabMesh).
function Surface2D() { this.tris = []; }
Surface2D.prototype.tri = function (a, b, c) { this.tris.push([a, b, c]); };
Surface2D.prototype.quad = function (a, b, c, d) { this.tris.push([a, b, c], [a, c, d]); };
Surface2D.prototype.rect = function (x0, y0, x1, y1) {
  if (x1 - x0 <= GEO_EPS || y1 - y0 <= GEO_EPS) return;   // вырожденный кусок не нужен
  this.quad([x0, y0], [x1, y0], [x1, y1], [x0, y1]);
};

// Пояс от кольца отверстия к границам его прямоугольной ячейки.
// Углы ячейки ВСЕГДА попадают в контур: если угол пришёлся между вершинами
// кольца (N не кратно 4 либо ячейку подрезали), сектор замыкается
// четырёхугольником плюс треугольником — T-вершин и щелей не остаётся.
function ringToRect(surf, ringIn, cx, cy, x0, y0, x1, y1) {
  const N = ringIn.length;
  if (N < 3) return;
  // Кольцо может прийти ЗЕРКАЛЬНЫМ (перевёрнутая раскладка, когда паз идёт
  // вдоль V — см. swap в layoutFace). Обходим его в ту сторону, в которую
  // растёт угол, иначе пояс «перекручивается» сам через себя.
  let sa = 0;
  for (let i = 0; i < N; i++) {
    const p = ringIn[i], q = ringIn[(i + 1) % N];
    sa += (p[0] - cx) * (q[1] - cy) - (q[0] - cx) * (p[1] - cy);
  }
  const ring = sa >= 0 ? ringIn : ringIn.slice().reverse();
  // Углы берём у самих точек кольца, а не «по формуле» — тогда раскладка не
  // зависит от того, как кольцо было построено и переставлено.
  const ang = ring.map((p) => normAng(Math.atan2(p[1] - cy, p[0] - cx)));
  const corners = [[x1, y1], [x0, y1], [x0, y0], [x1, y0]];
  const cornerA = corners.map((p) => normAng(Math.atan2(p[1] - cy, p[0] - cx)));
  const outer = ring.map((p, i) => onRectRay(cx, cy, x0, y0, x1, y1, ang[i]));
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const a0 = ang[i];
    const span = normAng(ang[j] - a0) || TAU2;
    // Углы ячейки, попавшие строго внутрь сектора (обычно ноль или один).
    const inSec = [];
    for (let k = 0; k < 4; k++) {
      const rel = normAng(cornerA[k] - a0);
      if (rel > 1e-6 && rel < span - 1e-6) inSec.push([rel, corners[k]]);
    }
    inSec.sort((p, q) => p[0] - q[0]);
    const chain = [outer[i]];
    for (const it of inSec) chain.push(it[1]);
    chain.push(outer[j]);
    surf.quad(ring[i], chain[0], chain[1], ring[j]);
    for (let k = 1; k < chain.length - 1; k++) surf.tri(ring[j], chain[k], chain[k + 1]);
  }
}

// Раскладка участка плоскости между пазами: полосы по Y, в каждой полосе —
// ячейки отверстий и добор прямоугольниками.
// H — полная высота плоскости: ячейку отверстия в неё же и зажимаем, чтобы
// ни один её угол не вышел за деталь (у самой кромки ячейка чуть шире
// кольца — из-за запаса rr — и без этого вылезала бы на доли миллиметра).
function layoutStrip(surf, W, sy0, sy1, circles, H) {
  if (sy1 - sy0 <= GEO_EPS) return;
  if (!circles.length) { surf.rect(0, sy0, W, sy1); return; }
  // Полосы по высоте. Ячейки соседних отверстий часто перекрываются краями
  // (например мелкие гнёзда опор рядом с крупным эксцентриком Ø15) — такую
  // ячейку просто ПОДРЕЗАЕМ предыдущей полосой, а не сваливаем оба
  // отверстия в одну полосу: иначе по ширине их ячейки налезут друг на
  // друга и в одной плоскости окажется два слоя поверхности.
  // В одну полосу объединяем только те отверстия, которые стоят вплотную
  // по высоте — когда после подрезки кольцу уже не хватает места.
  const rows = [];
  let top = sy0;
  // Идём по началу ячейки, а не по центру отверстия: если в одном ряду
  // стоят мелкое и крупное отверстия, полосу должно открывать крупное —
  // иначе его кольцо не поместится в полосу, открытую мелким.
  for (const c of circles.slice().sort((a, b) => (a.y - a.cell / 2) - (b.y - b.cell / 2))) {
    const half = c.cell / 2;
    const y0 = Math.max(top, c.y - half), y1 = Math.min(sy1, c.y + half);
    const last = rows[rows.length - 1];
    if (last && y0 > c.y - c.r - 0.05) {
      last.y1 = Math.max(last.y1, y1); last.cs.push(c);
    } else rows.push({ y0, y1, cs: [c] });
    top = rows[rows.length - 1].y1;
  }
  let prevY = sy0;
  for (const row of rows) {
    // Полоса не может вылезти за свой участок (страховка на вырожденный
    // ввод — например отверстие, попавшее ровно в паз).
    const by0 = Math.min(Math.max(sy0, row.y0), sy1);
    const by1 = Math.min(Math.max(by0, row.y1), sy1);
    if (by0 - prevY > GEO_EPS) surf.rect(0, prevY, W, by0);
    let prevX = 0;
    for (const c of row.cs.slice().sort((a, b) => a.x - b.x)) {
      const half = c.cell / 2;
      const rr = c.r + 0.05;      // ячейка не может быть уже самого отверстия
      // Ячейка идёт от края предыдущей до своего края, но всегда вмещает
      // кольцо: если соседнее отверстие стоит вплотную, берём минимум —
      // так налезание получается минимально возможным, а не в полячейки.
      let x0 = Math.max(prevX, c.x - half);
      if (x0 > c.x - rr) x0 = c.x - rr;
      let x1 = Math.min(W, c.x + half);
      if (x1 < c.x + rr) x1 = c.x + rr;
      x0 = Math.max(x0, 0); x1 = Math.min(x1, W);          // ячейка не вылезает за деталь
      if (x0 - prevX > GEO_EPS) surf.rect(prevX, by0, x0, by1);
      // Квадратная ячейка + добор сверху и снизу внутри полосы.
      const top1 = H == null ? Infinity : H;
      const cy0 = Math.max(Math.min(Math.max(by0, c.y - half), c.y - rr), 0);
      const cy1 = Math.min(Math.max(Math.min(by1, c.y + half), c.y + rr), top1);
      if (cy0 - by0 > GEO_EPS) surf.rect(x0, by0, x1, cy0);
      if (by1 - cy1 > GEO_EPS) surf.rect(x0, cy1, x1, by1);
      ringToRect(surf, c.ring, c.x, c.y, x0, cy0, x1, cy1);
      prevX = Math.max(prevX, x1);
    }
    if (W - prevX > GEO_EPS) surf.rect(prevX, by0, W, by1);
    prevY = Math.max(prevY, by1);
  }
  if (sy1 - prevY > GEO_EPS) surf.rect(0, prevY, W, sy1);
}

// Раскладка целой плоскости: сначала полосы пазов (они идут через всю
// деталь), между ними — участки с отверстиями.
//   W,H     — габариты плоскости, начало координат в её углу;
//   circles — отверстия на этой плоскости: {x, y, r, cell, ring};
//   bands   — прямоугольные вырезы-пазы {x0, y0, x1, y1};
//   swap    — считать в перевёрнутых координатах (паз идёт вдоль Y).
function layoutFace(W, H, circles, bands, swap) {
  const sw = (p) => [p[1], p[0]];
  const fw = swap ? H : W, fh = swap ? W : H;
  const cs = swap
    ? circles.map((c) => ({ x: c.y, y: c.x, r: c.r, cell: c.cell, ring: c.ring.map(sw) }))
    : circles;
  const bs = swap
    ? bands.map((b) => ({ x0: b.y0, y0: b.x0, x1: b.y1, y1: b.x1 }))
    : bands;
  const surf = new Surface2D();

  const strips = [];
  let y = 0;
  for (const g of bs.slice().sort((a, b) => a.y0 - b.y0)) {
    const gy0 = Math.max(0, Math.min(fh, g.y0)), gy1 = Math.max(0, Math.min(fh, g.y1));
    if (gy1 - gy0 <= GEO_EPS) continue;
    if (gy0 - y > GEO_EPS) strips.push([y, gy0]);
    // В самой полосе паза плоскими остаются только куски слева и справа.
    surf.rect(0, gy0, Math.max(0, Math.min(fw, g.x0)), gy1);
    surf.rect(Math.max(0, Math.min(fw, g.x1)), gy0, fw, gy1);
    y = Math.max(y, gy1);
  }
  if (fh - y > GEO_EPS) strips.push([y, fh]);
  if (!strips.length) strips.push([0, fh]);

  // Каждое отверстие попадает в свой участок (или в ближайший, если его
  // угораздило оказаться ровно в полосе паза — вырожденный случай).
  const groups = strips.map(() => []);
  for (const c of cs) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < strips.length; i++) {
      const d = Math.max(strips[i][0] - c.y, c.y - strips[i][1], 0);
      if (d < bestD) { bestD = d; best = i; }
    }
    groups[best].push(c);
  }
  for (let i = 0; i < strips.length; i++) layoutStrip(surf, fw, strips[i][0], strips[i][1], groups[i], fh);

  if (swap) for (const t of surf.tris) { t[0] = sw(t[0]); t[1] = sw(t[1]); t[2] = sw(t[2]); }
  return surf;
}

// Накопитель треугольников детали. Координаты приходят в МИЛЛИМЕТРАХ
// локальной системы пласти и складываются уже в метрах (MM).
function SlabMesh() { this.pos = []; this.nor = []; }
// Треугольник с плоской нормалью: порядок вершин разворачивается так, чтобы
// лицевая сторона смотрела туда же, куда нормаль (Three отсекает грани по
// обходу вершин, а не по атрибуту normal).
SlabMesh.prototype.tri = function (a, b, c, n) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  let p = b, q = c;
  if (cx * n[0] + cy * n[1] + cz * n[2] < 0) { p = c; q = b; }
  this.pos.push(a[0] * MM, a[1] * MM, a[2] * MM, p[0] * MM, p[1] * MM, p[2] * MM, q[0] * MM, q[1] * MM, q[2] * MM);
  this.nor.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
};
// Треугольник со СВОЕЙ нормалью в каждой вершине — для стенки отверстия,
// чтобы цилиндр выглядел круглым, а не гранёным.
SlabMesh.prototype.triS = function (a, b, c, na, nb, nc) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  const mx = na[0] + nb[0] + nc[0], my = na[1] + nb[1] + nc[1], mz = na[2] + nb[2] + nc[2];
  let p = b, q = c, np = nb, nq = nc;
  if (cx * mx + cy * my + cz * mz < 0) { p = c; q = b; np = nc; nq = nb; }
  this.pos.push(a[0] * MM, a[1] * MM, a[2] * MM, p[0] * MM, p[1] * MM, p[2] * MM, q[0] * MM, q[1] * MM, q[2] * MM);
  this.nor.push(na[0], na[1], na[2], np[0], np[1], np[2], nq[0], nq[1], nq[2]);
};
SlabMesh.prototype.quad = function (a, b, c, d, n) { this.tri(a, b, c, n); this.tri(a, c, d, n); };
// Перенос плоской раскладки на плоскость в 3D: map переводит 2D-точку в
// точку детали, n — наружная нормаль этой плоскости.
SlabMesh.prototype.plane = function (surf, map, n) {
  for (const t of surf.tris) this.tri(map(t[0]), map(t[1]), map(t[2]), n);
};

// Стенка цилиндрического выреза — труба из N граней по точкам кольца.
// map(точка кольца, глубина) переводит её в координаты детали; ex/ey —
// оси 2D-системы кольца в координатах детали (нужны только для нормалей).
function tubeWall(mesh, ring, cx, cy, map, depth, ex, ey) {
  if (!(depth > GEO_EPS)) return;
  const N = ring.length;
  const nrm = ring.map((p) => {
    const dx = p[0] - cx, dy = p[1] - cy;
    const L = Math.hypot(dx, dy) || 1;
    // Нормаль смотрит ВНУТРЬ отверстия, на его ось: стенку видно изнутри.
    return [
      -(ex[0] * dx + ey[0] * dy) / L,
      -(ex[1] * dx + ey[1] * dy) / L,
      -(ex[2] * dx + ey[2] * dy) / L,
    ];
  });
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const a = map(ring[i], 0), b = map(ring[j], 0);
    const c = map(ring[j], depth), d = map(ring[i], depth);
    mesh.triS(a, b, c, nrm[i], nrm[j], nrm[j]);
    mesh.triS(a, c, d, nrm[i], nrm[j], nrm[i]);
  }
}

// Плоское дно глухого отверстия — веер треугольников от центра.
function fanBottom(mesh, ring, cx, cy, map, depth, n) {
  const N = ring.length;
  const c0 = map([cx, cy], depth);
  for (let i = 0; i < N; i++) mesh.tri(c0, map(ring[i], depth), map(ring[(i + 1) % N], depth), n);
}

// СКВОЗНЫЕ ПРЯМОУГОЛЬНЫЕ ВЫРЕЗЫ ДЕТАЛИ (part.notches: выпил под монтажную
// шину в боковине, вырез под крюк навески в задней стенке). Плоские
// раскладки (пласть, торец, дно паза) строятся как для целой детали, а
// потом из них вычитается прямоугольник выреза: каждый треугольник режется
// полуплоскостями (Сазерленд — Ходжмен) на выпуклые куски СНАРУЖИ
// прямоугольника. Вырезы — по краю детали и редкие, лишние вершины от
// подрезки на внешний вид не влияют (всё в одной плоскости).
function clipHalf(poly, axis, val, keepLess) {
  const out = [];
  const inside = (p) => (keepLess ? p[axis] <= val + GEO_EPS : p[axis] >= val - GEO_EPS);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (val - a[axis]) / (b[axis] - a[axis]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}
function polyArea2(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s);
}
// Куски выпуклого многоугольника вне прямоугольника r {x0,y0,x1,y1}.
function polyMinusRect(poly, r) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  if (maxX <= r.x0 + GEO_EPS || minX >= r.x1 - GEO_EPS
    || maxY <= r.y0 + GEO_EPS || minY >= r.y1 - GEO_EPS) return [poly];
  const left = clipHalf(poly, 0, r.x0, true);
  const rest = clipHalf(poly, 0, r.x0, false);
  const right = clipHalf(rest, 0, r.x1, false);
  const mid = clipHalf(rest, 0, r.x1, true);
  const low = clipHalf(mid, 1, r.y0, true);
  const mid2 = clipHalf(mid, 1, r.y0, false);
  const high = clipHalf(mid2, 1, r.y1, false);
  return [left, right, low, high].filter((q) => q.length >= 3 && polyArea2(q) > 1e-6);
}
// Вычитает прямоугольники rects из плоской раскладки surf (на месте).
function surfMinusRects(surf, rects) {
  if (!rects.length) return surf;
  const tris = [];
  for (const t of surf.tris) {
    let pieces = [t];
    for (const r of rects) {
      const next = [];
      for (const pc of pieces) for (const q of polyMinusRect(pc, r)) next.push(q);
      pieces = next;
      if (!pieces.length) break;
    }
    for (const pc of pieces) {
      if (pc === t) { tris.push(t); continue; }
      for (let k = 1; k < pc.length - 1; k++) tris.push([pc[0], pc[k], pc[k + 1]]);
    }
  }
  surf.tris = tris;
  return surf;
}
// Отрезок [a,b] минус набор отрезков — для рёбер контура с вырезами.
function subtractIntervals(a, b, cuts) {
  let segs = [[a, b]];
  for (const c of cuts) {
    const next = [];
    for (const sg of segs) {
      if (c[1] <= sg[0] + GEO_EPS || c[0] >= sg[1] - GEO_EPS) { next.push(sg); continue; }
      if (c[0] - sg[0] > GEO_EPS) next.push([sg[0], c[0]]);
      if (sg[1] - c[1] > GEO_EPS) next.push([c[1], sg[1]]);
    }
    segs = next;
  }
  return segs;
}
// Контур детали со сквозными вырезами (в метрах): рёбра прямоугольника
// минус участки вырезов, внутренние стороны вырезов — на обеих пластях, и
// вертикальные рёбра во всех углах получившегося контура.
function slabNotchedOutline(U, V, T, notches) {
  const hu = U / 2, hv = V / 2, ht = T / 2;
  const segs = [];   // [[u,v],[u,v]] в координатах пласти 0..U, 0..V
  const touch = (n, id) => (id === 'u0' ? n.u0 <= GEO_EPS : id === 'u1' ? n.u1 >= U - GEO_EPS
    : id === 'v0' ? n.v0 <= GEO_EPS : n.v1 >= V - GEO_EPS);
  const vCuts = (id) => notches.filter((n) => touch(n, id)).map((n) => [n.v0, n.v1]);
  const uCuts = (id) => notches.filter((n) => touch(n, id)).map((n) => [n.u0, n.u1]);
  subtractIntervals(0, U, uCuts('v0')).forEach((g) => segs.push([[g[0], 0], [g[1], 0]]));
  subtractIntervals(0, U, uCuts('v1')).forEach((g) => segs.push([[g[0], V], [g[1], V]]));
  subtractIntervals(0, V, vCuts('u0')).forEach((g) => segs.push([[0, g[0]], [0, g[1]]]));
  subtractIntervals(0, V, vCuts('u1')).forEach((g) => segs.push([[U, g[0]], [U, g[1]]]));
  for (const n of notches) {
    if (n.u0 > GEO_EPS) segs.push([[n.u0, n.v0], [n.u0, n.v1]]);
    if (n.u1 < U - GEO_EPS) segs.push([[n.u1, n.v0], [n.u1, n.v1]]);
    if (n.v0 > GEO_EPS) segs.push([[n.u0, n.v0], [n.u1, n.v0]]);
    if (n.v1 < V - GEO_EPS) segs.push([[n.u0, n.v1], [n.u1, n.v1]]);
  }
  const out = [];
  const put = (a, za, b, zb) => out.push((a[0] - hu) * MM, (a[1] - hv) * MM, za * MM,
    (b[0] - hu) * MM, (b[1] - hv) * MM, zb * MM);
  const corners = new Map();
  for (const sg of segs) {
    put(sg[0], -ht, sg[1], -ht);
    put(sg[0], ht, sg[1], ht);
    for (const p of sg) corners.set(`${p[0].toFixed(3)}|${p[1].toFixed(3)}`, p);
  }
  corners.forEach((p) => put(p, -ht, p, ht));
  return out;
}

// 12 рёбер прямоугольного короба детали (в метрах) — всегда корректны,
// не зависят от вырезов.
function slabBoxOutline(U, V, T) {
  const hu = U / 2, hv = V / 2, ht = T / 2;
  const cn = [
    [-hu, -hv, -ht], [hu, -hv, -ht], [hu, hv, -ht], [-hu, hv, -ht],
    [-hu, -hv, ht], [hu, -hv, ht], [hu, hv, ht], [-hu, hv, ht],
  ];
  const out = [];
  [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
    .forEach((e) => {
      const ia = e[0], ib = e[1];
      out.push(cn[ia][0] * MM, cn[ia][1] * MM, cn[ia][2] * MM, cn[ib][0] * MM, cn[ib][1] * MM, cn[ib][2] * MM);
    });
  return out;
}

// ---------------------------------------------------------------------------
// СБОРКА ДЕТАЛИ ЦЕЛИКОМ.
// Всё приходит уже в координатах пласти (мм): x=u («длина»), y=v («глубина»),
// z=толщина, центр детали в нуле.
//   holes     — отверстия в пласть: {u, v, r, N, dir, depth, through},
//               dir = +1/−1 — с какой пласти сверлят;
//   edgeHoles — отверстия в торец: {alongU, uPos, vPos, len, r, N}
//               (координаты от центра детали, как их отдаёт edgeDrill);
//   grooves   — пазы: {u0, u1, v0, v1, depth, dir};
//   notches   — сквозные прямоугольные вырезы у кромки: {u0, u1, v0, v1}
//               (выпил под шину, вырез под крюк навески);
//   uv        — нужны ли UV для текстуры «под древесину»;
//   uvSwap    — (только вместе с uv) поменять u и v местами в UV: волокно
//               текстуры идёт вдоль её оси x, так что при uvSwap оно ляжет
//               вдоль v пласти, а не вдоль u (см. grainRunsAlongV).
// Возвращает готовую BufferGeometry и позиции линий контура (в метрах).
// ---------------------------------------------------------------------------
function buildSlabGeometry(spec) {
  const U = spec.uSize, V = spec.vSize, T = spec.tSize;
  const hu = U / 2, hv = V / 2, ht = T / 2;
  const holes = spec.holes || [];
  const edges = spec.edgeHoles || [];
  const grooves = spec.grooves || [];
  const notches = (spec.notches || []).filter((n) => n.u1 - n.u0 > GEO_EPS && n.v1 - n.v0 > GEO_EPS);
  const notchRects = notches.map((n) => ({ x0: n.u0, y0: n.v0, x1: n.u1, y1: n.v1 }));
  // Отверстие, центр которого попал в сквозной вырез, резать уже нечего.
  const inNotch = (u, v) => notches.some((n) => u > n.u0 + GEO_EPS && u < n.u1 - GEO_EPS
    && v > n.v0 + GEO_EPS && v < n.v1 - GEO_EPS);
  if (notches.length) {
    for (let i = holes.length - 1; i >= 0; i--) if (inNotch(holes[i].u, holes[i].v)) holes.splice(i, 1);
  }
  const mesh = new SlabMesh();
  const outline = [];
  const seg = (a, b) => outline.push(a[0] * MM, a[1] * MM, a[2] * MM, b[0] * MM, b[1] * MM, b[2] * MM);
  const loop = (pts, map) => {
    for (let i = 0; i < pts.length; i++) seg(map(pts[i]), map(pts[(i + 1) % pts.length]));
  };

  // ВЫРЕЗ НЕ ИМЕЕТ ПРАВА ВЫЙТИ ЗА ГАБАРИТ ДЕТАЛИ. Если отверстие стоит к
  // кромке ближе собственного радиуса (кривые данные, вручную введённые
  // координаты, слишком крупный диаметр), его кольцо и труба вылезли бы
  // наружу и висели бы в воздухе рядом с деталью. Радиус ограничиваем
  // половиной детали, а центр подвигаем внутрь: отверстие получается
  // вплотную к кромке, но вся геометрия остаётся внутри детали.
  const keepInside = (val, r, size) => (size <= 2 * r ? size / 2 : Math.min(Math.max(val, r), size - r));
  for (const h of holes) {
    h.r = Math.max(Math.min(h.r, U / 2, V / 2), 0.05);
    h.u = keepInside(h.u, h.r, U);
    h.v = keepInside(h.v, h.r, V);
  }
  // То же и для паза: четверть по кромке (паз под заднюю стенку у кухонной
  // боковины) по расчёту начинается на 1,25 мм ЗА пластью — без обрезки её
  // дно рисовало бы полоску геометрии в воздухе за деталью.
  for (const g of grooves) {
    g.u0 = Math.min(Math.max(g.u0, 0), U); g.u1 = Math.min(Math.max(g.u1, 0), U);
    g.v0 = Math.min(Math.max(g.v0, 0), V); g.v1 = Math.min(Math.max(g.v1, 0), V);
  }

  // Кольца считаем ОДИН раз на отверстие: у сквозного они общие для обеих
  // пластей, и труба стенки стыкуется с обоими кольцами без щелей.
  for (const h of holes) h.ring = ringPoints(h.u, h.v, h.r, h.N);

  // УТОПЛЕННЫЕ ОТВЕРСТИЯ. Мелкое отверстие может стоять ВНУТРИ крупного
  // гнезда и физически с ним пересекаться — так стоят Rastex-эксцентрик
  // Ø15 и крепление фасада Ø4 в передней стенке ящика. На пласти такое
  // отверстие не открывается вовсе (его вход уже в глубине гнезда),
  // поэтому кольца там нет, а стенка начинается со дна гнезда. Раньше это
  // разруливало булево вычитание объединением вырезов.
  //   depthFrom[dir] — с какой глубины от пласти dir начинается отверстие
  //   (0 — открывается прямо на поверхности).
  const sunkFrom = (h, hi, dir) => {
    let deepest = 0;
    for (let gi = 0; gi < holes.length; gi++) {
      const g = holes[gi];
      // «Крупнее» при равных диаметрах решаем по порядку в списке — иначе
      // два одинаковых отверстия в одной точке утопили бы друг друга и не
      // нарисовались бы вовсе.
      if (g === h || g.r < h.r || (g.r === h.r && gi > hi)) continue;
      if (!(g.through || g.dir === dir)) continue;
      // Утопленным считаем ТОЛЬКО отверстие, которое целиком помещается в
      // крупное. Раньше хватало «центр внутри крупного» — и отверстие,
      // задевшее край гнезда, пропадало целиком, хотя часть его стенки
      // реально выходит на поверхность. Так исчезало крепление фасада Ø4
      // рядом с эксцентриком Ø15 в передней стенке ящика (центр в пределах
      // Ø15, а край торчит наружу) и мелкие гнёзда рядом с дюбелем Ø8.
      if (Math.hypot(g.u - h.u, g.v - h.v) + h.r > g.r + GEO_EPS) continue;
      const gd = g.through ? T : Math.min(g.depth, T);
      if (gd > deepest) deepest = gd;
    }
    return deepest;
  };
  holes.forEach((h, hi) => {
    h.sunkFront = sunkFrom(h, hi, h.dir);                      // со стороны сверления
    h.sunkBack = h.through ? sunkFrom(h, hi, -h.dir) : 0;      // с обратной стороны
  });

  // --- 1. Пласти: лицо (dir=+1) и тыл (dir=−1) ---
  for (const dir of [1, -1]) {
    const circles = [];
    for (const h of holes) {
      if (!(h.through || h.dir === dir)) continue;
      if (dir === h.dir ? h.sunkFront : h.sunkBack) continue;  // утоплено в соседнее гнездо
      circles.push({ x: h.u, y: h.v, r: h.r, cell: h.r * 4, ring: h.ring });  // ячейка = 2 диаметра
    }
    const bands = [];
    let swap = false;
    for (const g of grooves) {
      if (g.dir !== dir) continue;
      bands.push({ x0: g.u0, y0: g.v0, x1: g.u1, y1: g.v1 });
      if ((g.v1 - g.v0) > (g.u1 - g.u0)) swap = true;     // паз идёт вдоль V
    }
    const surf = surfMinusRects(layoutFace(U, V, circles, bands, swap), notchRects);
    mesh.plane(surf, (p) => [p[0] - hu, p[1] - hv, dir * ht], [0, 0, dir]);
  }

  // --- 2. Стенки и дно отверстий в пласть ---
  for (const h of holes) {
    const depth = h.through ? T : Math.min(h.depth, T);
    // Ось сверления: от пласти dir вглубь детали. s — глубина от пласти,
    // с которой стенка начинается (0, если отверстие открыто наружу).
    const map = (p, s) => [p[0] - hu, p[1] - hv, h.dir * ht - h.dir * s];
    const from = h.sunkFront;                       // вход утоплен в гнездо?
    const to = depth - h.sunkBack;                  // выход тоже?
    if (to - from > GEO_EPS) {
      tubeWall(mesh, h.ring, h.u, h.v, (p, s) => map(p, from + s), to - from, [1, 0, 0], [0, 1, 0]);
      if (!h.through) fanBottom(mesh, h.ring, h.u, h.v, map, depth, [0, 0, h.dir]);
    }
    // Контур: кольцо на входе (и на выходе, если отверстие сквозное).
    if (!from) loop(h.ring, (p) => map(p, 0));
    if (h.through && !h.sunkBack) loop(h.ring, (p) => map(p, T));
  }

  // --- 3. Торцы (четыре кромки детали) ---
  // У каждой кромки своя 2D-система: x идёт вдоль кромки, y — поперёк
  // толщины (0…T); map переводит её в координаты детали.
  const edgeFaces = [];   // {from, to, alongIdx} — вершины торца и ось вдоль кромки (0=x, 1=y)
  const sides = [
    { id: 'u0', W: V, H: T, n: [-1, 0, 0], ax: [1, 0, 0], ex: [0, 1, 0], ey: [0, 0, 1], map: (p) => [-hu, p[0] - hv, p[1] - ht] },
    { id: 'u1', W: V, H: T, n: [1, 0, 0], ax: [-1, 0, 0], ex: [0, 1, 0], ey: [0, 0, 1], map: (p) => [hu, p[0] - hv, p[1] - ht] },
    { id: 'v0', W: U, H: T, n: [0, -1, 0], ax: [0, 1, 0], ex: [1, 0, 0], ey: [0, 0, 1], map: (p) => [p[0] - hu, -hv, p[1] - ht] },
    { id: 'v1', W: U, H: T, n: [0, 1, 0], ax: [0, -1, 0], ex: [1, 0, 0], ey: [0, 0, 1], map: (p) => [p[0] - hu, hv, p[1] - ht] },
  ];
  for (const sd of sides) {
    // Участки этой кромки, срезанные сквозным вырезом (в 2D-системе торца:
    // x — вдоль кромки, y — по толщине, вырез на всю толщину).
    const alongE = (sd.id === 'u0' || sd.id === 'u1');
    const edgeCuts = notches.filter((n) => (sd.id === 'u0' ? n.u0 <= GEO_EPS
      : sd.id === 'u1' ? n.u1 >= U - GEO_EPS : sd.id === 'v0' ? n.v0 <= GEO_EPS : n.v1 >= V - GEO_EPS))
      .map((n) => ({ x0: alongE ? n.v0 : n.u0, x1: alongE ? n.v1 : n.u1, y0: -1, y1: T + 1 }));
    const circles = [];
    for (const h of edges) {
      // От какой кромки сверлят, говорит САМА присадка (atStart из
      // edgeDrill), а не знак смещения центра лунки: при глубине сверления
      // больше детали знак переворачивался, и лунка уходила от чужой кромки
      // наружу. atStart != null — страховка для старых вызовов.
      const atStart = h.atStart != null ? h.atStart : (h.alongU ? h.uPos < 0 : h.vPos < 0);
      const id = h.alongU ? (atStart ? 'u0' : 'u1') : (atStart ? 'v0' : 'v1');
      if (id !== sd.id) continue;
      // Лунка целиком лежит в детали: радиус не больше половины толщины
      // (иначе кольцо вышло бы за пласти), центр — не ближе радиуса к концам
      // кромки, длина — не глубже самой детали вдоль оси сверления.
      const r = Math.max(Math.min(h.r, ht), 0.05);
      const raw = h.alongU ? h.vPos + hv : h.uPos + hu;
      const cx = sd.W <= 2 * r ? sd.W / 2 : Math.min(Math.max(raw, r), sd.W - r);
      // Лунка на участке кромки, срезанном вырезом, — сверлить некуда.
      if (edgeCuts.some((c) => cx > c.x0 && cx < c.x1)) continue;
      h.r = r;
      h.len = Math.min(Math.max(h.len, 0), (h.alongU ? U : V));
      // Центр по толщине: середина плюс смещение tOff, но так, чтобы круг
      // целиком лежал в детали.
      const cy = Math.min(Math.max(ht + (h.tOff || 0), r), sd.H - r);
      h.ring = ringPoints(cx, cy, r, h.N);
      h.cx = cx; h.cy = cy; h.side = sd;
      circles.push({ x: cx, y: cy, r, cell: r * 4, ring: h.ring });
    }
    // Паз, выходящий на эту кромку, оставляет в ней прямоугольную выемку.
    const bands = [];
    for (const g of grooves) {
      const opens = sd.id === 'u0' ? g.u0 <= GEO_EPS : (sd.id === 'u1' ? g.u1 >= U - GEO_EPS
        : (sd.id === 'v0' ? g.v0 <= GEO_EPS : g.v1 >= V - GEO_EPS));
      if (!opens) continue;
      const alongEdge = (sd.id === 'u0' || sd.id === 'u1');
      bands.push({
        x0: alongEdge ? g.v0 : g.u0,
        x1: alongEdge ? g.v1 : g.u1,
        y0: g.dir > 0 ? T - g.depth : 0,
        y1: g.dir > 0 ? T : g.depth,
      });
    }
    const from = mesh.pos.length / 3;
    mesh.plane(surfMinusRects(layoutFace(sd.W, sd.H, circles, bands, false), edgeCuts), sd.map, sd.n);
    // Диапазон вершин торца — для UV ниже (волокно кромки идёт ВДОЛЬ кромки).
    edgeFaces.push({ from, to: mesh.pos.length / 3, alongIdx: sd.ex[0] === 1 ? 0 : 1 });
  }

  // --- 3а. Стенки сквозных вырезов (новые торцы детали по контуру выреза,
  // на всю толщину). UV — как у торцов: волокно вдоль стенки.
  for (const n of notches) {
    const wallU = (u, n0) => {
      const from = mesh.pos.length / 3;
      mesh.quad([u - hu, n.v0 - hv, -ht], [u - hu, n.v1 - hv, -ht],
        [u - hu, n.v1 - hv, ht], [u - hu, n.v0 - hv, ht], [n0, 0, 0]);
      edgeFaces.push({ from, to: mesh.pos.length / 3, alongIdx: 1 });
    };
    const wallV = (v, n1) => {
      const from = mesh.pos.length / 3;
      mesh.quad([n.u0 - hu, v - hv, -ht], [n.u1 - hu, v - hv, -ht],
        [n.u1 - hu, v - hv, ht], [n.u0 - hu, v - hv, ht], [0, n1, 0]);
      edgeFaces.push({ from, to: mesh.pos.length / 3, alongIdx: 0 });
    };
    if (n.u0 > GEO_EPS) wallU(n.u0, 1);
    if (n.u1 < U - GEO_EPS) wallU(n.u1, -1);
    if (n.v0 > GEO_EPS) wallV(n.v0, 1);
    if (n.v1 < V - GEO_EPS) wallV(n.v1, -1);
  }

  // --- 4. Стенки и дно отверстий в торец ---
  for (const h of edges) {
    if (!h.side) continue;
    const sd = h.side;
    const map = (p, s) => {
      const b = sd.map(p);
      return [b[0] + sd.ax[0] * s, b[1] + sd.ax[1] * s, b[2] + sd.ax[2] * s];
    };
    tubeWall(mesh, h.ring, h.cx, h.cy, map, h.len, sd.ex, sd.ey);
    fanBottom(mesh, h.ring, h.cx, h.cy, map, h.len, [-sd.ax[0], -sd.ax[1], -sd.ax[2]]);
    loop(h.ring, (p) => map(p, 0));
  }

  // --- 5. Пазы: дно и боковые стенки выемки ---
  for (const g of grooves) {
    const zTop = g.dir * ht, zBot = g.dir * (ht - g.depth);
    const bottom = new Surface2D();
    bottom.rect(g.u0, g.v0, g.u1, g.v1);
    mesh.plane(surfMinusRects(bottom, notchRects), (p) => [p[0] - hu, p[1] - hv, zBot], [0, 0, g.dir]);
    // Стенку строим только там, где паз НЕ выходит на кромку детали.
    const wall = (ua, va, ub, vb, n) => mesh.quad(
      [ua - hu, va - hv, zTop], [ub - hu, vb - hv, zTop],
      [ub - hu, vb - hv, zBot], [ua - hu, va - hv, zBot], n
    );
    if (g.u0 > GEO_EPS) wall(g.u0, g.v0, g.u0, g.v1, [1, 0, 0]);
    if (g.u1 < U - GEO_EPS) wall(g.u1, g.v0, g.u1, g.v1, [-1, 0, 0]);
    if (g.v0 > GEO_EPS) wall(g.u0, g.v0, g.u1, g.v0, [0, 1, 0]);
    if (g.v1 < V - GEO_EPS) wall(g.u0, g.v1, g.u1, g.v1, [0, -1, 0]);
    // Контур — прямоугольник выхода паза на пласть.
    loop([[g.u0, g.v0], [g.u1, g.v0], [g.u1, g.v1], [g.u0, g.v1]], (p) => [p[0] - hu, p[1] - hv, zTop]);
  }

  // --- 6. Контур короба детали (12 рёбер; с вырезами — по их контуру) ---
  const box = notches.length ? slabNotchedOutline(U, V, T, notches) : slabBoxOutline(U, V, T);
  for (let i = 0; i < box.length; i++) outline.push(box[i]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.nor, 3));
  if (spec.uv) {
    // Текстура «под древесину» — обычное повторяющееся полотно: UV кладём
    // напрямую по «сырым» координатам пласти в метрах (ровно как раньше на
    // результате булева вычитания), тогда густота волокна одинакова у любой
    // детали. На стенках вырезов это плоская проекция — они узкие и почти
    // не видны, для древесного узора не критично.
    // Линии волокна на самой текстуре идут вдоль её оси x. Если у детали
    // волокно должно идти вдоль v (spec.uvSwap), просто меняем координаты
    // местами: транспонированная бесшовная плитка остаётся бесшовной, а
    // поворачивать саму текстуру (map.rotation) не нужно.
    const n = mesh.pos.length / 3;
    const uv = new Float32Array(n * 2);
    const iu = spec.uvSwap ? 1 : 0, iv = spec.uvSwap ? 0 : 1;
    for (let i = 0; i < n; i++) {
      uv[i * 2] = mesh.pos[i * 3 + iu];
      uv[i * 2 + 1] = mesh.pos[i * 3 + iv];
    }
    // ТОРЦЫ (кромка). Плоская проекция пласти на торец вырождается: одна из
    // координат постоянна на всей грани, и рисунок идёт поперёк кромки.
    // Кромка — лента, у неё волокно всегда вдоль длины: x текстуры — вдоль
    // кромки, y — поперёк толщины (z), независимо от направления волокна
    // самой пласти (uvSwap).
    for (const ef of edgeFaces) {
      for (let i = ef.from; i < ef.to; i++) {
        uv[i * 2] = mesh.pos[i * 3 + ef.alongIdx];
        uv[i * 2 + 1] = mesh.pos[i * 3 + 2];
      }
    }
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  }
  return { geometry, outline, triangles: mesh.pos.length / 9 };
}

// ---------------------------------------------------------------------------
// ОПИСАНИЕ ВЫРЕЗОВ ДЕТАЛИ В СИСТЕМЕ КООРДИНАТ ЕЁ ПЛАСТИ
// ---------------------------------------------------------------------------
// Переводит присадку детали (row.holes/row.grooves из engine.js, заданные в
// системе самой детали) в описание вырезов для buildSlabGeometry: размеры
// пласти, куда смотрит её «лицо», отверстия в пласть, лунки в торец и пазы.
// Вынесено из render() отдельной функцией не ради красоты: ровно ту же
// раскладку прогоняет tools/viewer.js и проверяет, что каждое отверстие
// детали попало в геометрию и ни один вырез не вылез за габарит детали.
//   row       — строка детали из model.parts;
//   locW/locD — ширина и глубина детали С УЧЁТОМ её поворота в сборке.
function slabCutsForPart(row, locW, locD) {
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
  // «Лицо» детали обычно определяется по её позиции (row.box.x < 0 для
  // тонких-по-X деталей типа боковины: считаем, что интерьер корпуса
  // смотрит к центру). Для смещённых деталей вне центра корпуса (напр.
  // фальш-планка углового узла, где скрытая грань — всегда к соседней
  // детали, а не к центру всего модуля) эта эвристика ошибается — тогда
  // engine.js явно проставляет row.frontIsPlus, и он в приоритете.
  const frontIsPlus = row.frontIsPlus != null ? row.frontIsPlus : (!planeIsX || row.box.x < 0);
  // Разворот детали в мировые оси в render() (geometry.rotateY(-90°) у
  // боковины, rotateX(+90°) у горизонтали) переворачивает знак ЛОКАЛЬНОЙ
  // толщины: локальный +Z уходит в мировой МИНУС X (боковина) или
  // МИНУС Y (горизонталь) — проверено эмпирически. Метка присадки
  // (marker.position.set в render) кладёт off НАПРЯМУЮ в нужную мировую
  // ось, без этого поворота, поэтому она всегда была права; вырез — нет, его
  // локальный Z нужно взять с обратным знаком, чтобы после поворота он
  // совпал с меткой. У фасада (третья ветка, planeIsX=planeIsY=false)
  // поворота нет вообще — там знак и так верный.
  const zSign = (planeIsX || planeIsY) ? -1 : 1;
  // Куда смотрит локальная ось X детали, решаем ПО ЕЁ РАЗМЕРАМ: у двери
  // длина горизонтальна, у боковины и доборной планки — вертикальна.
  // Раньше это угадывалось по типу, и присадка ложилась поперёк.
  const lenIsU = lengthAlongU(row.length, uSize, vSize);
  const toU = (h) => (lenIsU ? h.x : h.y);
  const toV = (h) => (lenIsU ? h.y : h.x);

  // ВЫРЕЗЫ ДЕТАЛИ В КООРДИНАТАХ ПЛАСТИ: x=u («длина»), y=v («глубина»),
  // z=толщина, всё центрировано вокруг нуля. Здесь мы только ОПИСЫВАЕМ
  // вырезы, а саму геометрию по этому описанию собирает
  // buildSlabGeometry() (см. выше) — сразу нужной лоу-поли топологией.
  // Булева вычитания (csg.js) в построении деталей больше нет: оно
  // давало корректную форму, но дробило пласть на тысячи осколков и
  // съедало 84% времени сборки сцены.
  const faceHoles = [];    // отверстия в пласть
  const edgeHoles = [];    // отверстия в торец
  const slabGrooves = [];  // пазы (под заднюю стенку, под дно ящика)
  for (const h of (row.holes || [])) {
    // Отверстие без диаметра (только что добавленное на экране «Деталь»,
    // пользователь ещё не ввёл ⌀) ничего не режет.
    if (!(h.d > 0)) continue;
    const u = toU(h);
    const v = toV(h);
    const r = h.d / 2;
    const N = segmentsForHole(h.d);
    if (h.side === 'edge') {
      // ТОРЦЕВОЕ ОТВЕРСТИЕ (Rastex-шток minifixBolt, конфирмат/шкант в
      // торец): ось сверления идёт ВДОЛЬ кромки детали (u или v), а не
      // поперёк пласти. edgeDrill() — та же функция, что рисует и метку
      // ниже, чтобы вырез и метка совпадали по оси/позиции/глубине.
      const ed = edgeDrill(u, v, uSize, vSize, h.depth);
      // h.tz — смещение оси от СЕРЕДИНЫ толщины детали вдоль мировой оси
      // толщины (у дна/полки — вверх). Нужно, когда производитель задаёт высоту
      // оси от нижней плоскости (Quadro: Ø6 в торце дна — 11 мм от низа).
      // В локальном Z детали знак обратный мировому — тот же zSign.
      const tz = Number.isFinite(h.tz) ? h.tz : 0;
      edgeHoles.push({
        alongU: ed.alongU, atStart: ed.atStart,
        uPos: ed.uPos, vPos: ed.vPos, len: ed.len, r, N,
        tOff: zSign * tz, tz,
      });
      continue;
    }
    const fromFront = h.side === 'back' ? !frontIsPlus : frontIsPlus;
    // dir — с какой ПЛАСТИ сверлят, в локальных координатах детали.
    // Разворот geometry.rotateY(-90°)/rotateX(+90°) ниже переворачивает
    // знак локальной толщины при переносе в мировые оси, поэтому здесь
    // учитываем zSign — иначе вырез уехал бы на другую сторону от метки.
    const dir = (fromFront ? 1 : -1) * zSign;
    const dep = Math.max(h.depth || 6, 4);
    faceHoles.push({
      u, v, r, N, dir,
      depth: Math.min(dep, tSize),
      // Глубже толщины детали сверлить некуда — считаем сквозным.
      through: !!h.through || dep >= tSize - 0.01,
    });
  }
  for (const g of (row.grooves || [])) {
    const u0 = toU({ x: g.x0, y: g.y0 }), v0 = toV({ x: g.x0, y: g.y0 });
    const u1 = toU({ x: g.x1, y: g.y1 }), v1 = toV({ x: g.x1, y: g.y1 });
    const half = (g.w || 4) / 2;
    const along = Math.abs(u1 - u0) >= Math.abs(v1 - v0);
    const gu0 = along ? u0 : u0 - half, gu1 = along ? u1 : u1 + half;
    const gv0 = along ? v0 - half : v0, gv1 = along ? v1 + half : v1;
    // Паз под заднюю стенку (боковины, крыша, дно) — это паз в пласти с
    // отступом от задней кромки детали (деталь с пазом удлинена назад), а
    // паз под дно ящика — на боковинах короба. Если по расчёту паз всё же
    // выйдет за край детали, лишнее обрежет сама buildSlabGeometry — здесь
    // координаты остаются «как посчитано».
    //
    // С КАКОЙ ПЛАСТИ ВРЕЗАН ПАЗ. side:'inner' — со стороны ВНУТРЕННОСТИ
    // корпуса:
    //   • боковина/перегородка (тонкая по X) — «лицо» frontIsPlus как раз и
    //     есть сторона, обращённая внутрь корпуса (левая боковина — к +X,
    //     правая — к -X), так было и раньше;
    //   • горизонталь (тонкая по Y) — у ДНА внутренность корпуса СВЕРХУ
    //     (мировой +Y), а у КРЫШИ — СНИЗУ (мировой -Y). «Лицо» горизонтали
    //     (frontIsPlus) — всегда верхняя пласть, поэтому для крыши паз
    //     переворачиваем на нижнюю.
    // side:'outer' — обратная сторона. worldPlus — «паз на пласти,
    // смотрящей в плюс мировой оси»; zSign переводит это в локальный знак
    // толщины (см. комментарий к zSign выше), как у отверстий.
    let worldPlus = frontIsPlus;
    if (planeIsY) worldPlus = row.kind !== 'top';
    if (g.side === 'outer') worldPlus = !worldPlus;
    // side:'back' — тыльная грань детали (у фасада — сторона, обращённая
    // внутрь шкафа), как у отверстий с side:'back' выше.
    if (g.side === 'back') worldPlus = !frontIsPlus;
    slabGrooves.push({
      u0: Math.min(gu0, gu1), u1: Math.max(gu0, gu1),
      v0: Math.min(gv0, gv1), v1: Math.max(gv0, gv1),
      depth: Math.min(g.depth || 4, tSize * 0.9),
      dir: (worldPlus ? 1 : -1) * zSign,
    });
  }
  // СКВОЗНЫЕ ВЫРЕЗЫ (part.notches, engine.js: railNotch — выпил под
  // монтажную шину в боковине, hangerBackCut — вырез под крюк навески в
  // задней стенке): прямоугольник в координатах детали → в координатах
  // пласти тем же toU/toV, что и отверстия/пазы; за габарит не выходит.
  const slabNotches = [];
  for (const n of (row.notches || [])) {
    const a = { x: n.x0, y: n.y0 }, b = { x: n.x1, y: n.y1 };
    const cl = (x, size) => Math.min(Math.max(x, 0), size);
    const u0 = cl(Math.min(toU(a), toU(b)), uSize), u1 = cl(Math.max(toU(a), toU(b)), uSize);
    const v0 = cl(Math.min(toV(a), toV(b)), vSize), v1 = cl(Math.max(toV(a), toV(b)), vSize);
    if (!(u1 - u0 > 0.01) || !(v1 - v0 > 0.01)) continue;
    slabNotches.push({ u0, u1, v0, v1, kind: n.kind || null });
  }
  return {
    planeIsX, planeIsY, uSize, vSize, tSize,
    frontIsPlus, zSign, lenIsU, toU, toV,
    holes: faceHoles, edgeHoles, grooves: slabGrooves, notches: slabNotches,
  };
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
  // Алюм. рамка под петлю Blum 71T950A (engine.js aluHingeCuts)
  aluHingeScrew: 0xe0402a,
  aluHingeSlot: 0x1f6fd1,
  // Разметка саморезов навески верхнего модуля (engine.js applyWallHanger)
  hangerScrew: 0x0a7d2c,
  countertopScrew: 0x1f8f8f,
  // Сквозные вырезы (part.notches): выпил под монтажную шину в боковине
  // навесного модуля и вырез под крюк навески в задней стенке.
  railNotch: 0xc2410c,
  hangerBackCut: 0x7c3aed,
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
  aluHingeScrew: 'Петля алюм. рамки, саморез Ø5 (зенк. до Ø7)',
  aluHingeSlot: 'Петля алюм. рамки, паз под механизм',
  hangerScrew: 'Навеска, разметка самореза (не сверлить)',
  countertopScrew: 'Крепление столешницы, сквозное Ø4 под шуруп 3,5',
  railNotch: 'Выпил под монтажную шину (насквозь)',
  hangerBackCut: 'Вырез под крюк навески (насквозь)',
};

// Стеклянный фасад (материал GLASS-4, «сатин бронз») — тёплый тонированный
// бежево-бронзовый цвет двери/вставки, заметный в 3D. Один и тот же тон и
// прозрачность используются везде, где рисуется именно фасад из GLASS-4
// (сплошная стеклянная дверь и стеклянная вставка в рамке woodGlass/alu).
// НЕ путать со стеклянной полкой (материал GLASS-6, за таким фасадом) — она
// рисуется тем же флагом row.glass, но остаётся прозрачно-голубоватой, это
// другой материал, его тут не трогаем.
const GLASS4_COLOR = 0xbe9669;
const GLASS4_OPACITY = 0.6;

const KIND_COLOR = {
  side: 0xd8c8a8, top: 0xd8c8a8, bottom: 0xd8c8a8, divider: 0xd8c8a8, plinth: 0xb9a67e,
  shelf: 0xe0d2b4, back: 0xf2efe6,
  door: 0xc9a76a, drawerFront: 0xc9a76a,
  drawerBottom: 0xded2bb, drawerBack: 0xded2bb, drawerSide: 0xded2bb,
  leg: 0x5a5a5a,
  // Подстраховка на случай, если decorLook() не нашёл материал столешницы
  // (код вне каталога) — тёплый серо-бежевый, темнее корпуса, светлее
  // цоколя: столешница визуально «читается» как отдельный горизонтальный
  // слой над тумбами, даже без текстуры декора.
  countertop: 0xc7bba8,
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
  countertop: 0x6fa0c4,
};

// Прозрачность ВСЕГО выделенного модуля (клик по модулю/вкладке в панели) —
// поверх синей подсветки, чтобы видно было наполнение корпуса (полки, ящики
// за фасадом).
const ACTIVE_MODULE_OPACITY = 0.4;

// Подсветка фасада ВЫБРАННОГО ОТСЕКА (клик по отсеку в 3D вне Focus Mode →
// «Редактировать отсек»): плотная бирюзовая полупрозрачная заливка поверх
// обычного цвета фасада — грани и контур детали видны сквозь неё. В отличие
// от highlightModule (подсветка всего модуля синим) это подсветка одной
// конкретной секции модуля, и только её фасада — не корпуса.
const SECTION_HI_COLOR = 0x35c9e0;
const SECTION_HI_EMISSIVE = 0x0d4b57;
const SECTION_HI_OPACITY = 0.75;

// Если у выбранного отсека нет фасада вовсе (facade:'open' — открытая полка,
// или ниша под встроенную технику — engine.js для такой зоны не строит ни
// двери, ни фасада ящика), красить бирюзовым нечего — см. render(),
// sectionHiBounds/_computeSectionHiBounds. Вместо фасада подсвечиваем то, что
// физически лежит внутри отсека (полки и т.п.), КРОМЕ деталей, которые не
// привязаны к ОДНОМУ отсеку, а общие на весь модуль или на всю секцию сразу:
// боковины, дно, крыша, цоколь, столешница (все — одна деталь на весь
// модуль), задняя стенка (тоже одна на весь модуль — подсветить её целиком
// ради одного отсека визуально неверно) и вертикальная стойка (стоит МЕЖДУ
// двумя секциями, однозначного владельца-отсека у неё нет).
const SECTION_SCOPED_EXCLUDE = new Set(['side', 'top', 'bottom', 'plinth', 'back', 'divider', 'countertop']);

// ---------------------------------------------------------------------------
// Алюминиевая рамка по РЕАЛЬНОМУ сечению профиля (catalog.ALU_PROFILES[код].
// section). Сечение задано в мм: X — от наружного края профиля к центру
// фасада, Y — по толщине, меньший Y — лицевая (наружная) сторона. Каждая из
// четырёх сторон рамки — это сечение, «протянутое» вдоль стороны
// (ExtrudeGeometry), с запилом на ус 45° на обоих концах.
// ---------------------------------------------------------------------------

// Сечение профиля по коду из каталога (или null, если чертежа сечения нет —
// тогда рамка рисуется упрощённо, четырьмя брусками).
function aluSectionOf(code) {
  const cat = (typeof window !== 'undefined' && window.Modul3D && window.Modul3D.catalog) || {};
  const prof = (cat.ALU_PROFILES || {})[code];
  const s = prof && prof.section;
  if (!s || !(s.w > 0) || !Array.isArray(s.outlines) || !s.outlines.length
      || !Array.isArray(s.outlines[0]) || s.outlines[0].length < 3) return null;
  return s;
}

// Форма сечения (THREE.Shape: наружный контур + полости) — одна на профиль и
// толщину фасада, кешируется. Координаты формы — уже в метрах:
//   x формы = расстояние от наружного края профиля (к центру фасада),
//   y формы = положение по толщине фасада (+T/2 — лицо, −T/2 — тыл).
const _aluShapeCache = new Map();
function aluSectionShape(code, section, T) {
  const key = code + '|' + T.toFixed(5);
  if (_aluShapeCache.has(key)) return _aluShapeCache.get(key);
  const outer = section.outlines[0];
  let yMin = Infinity, yMax = -Infinity;
  for (const p of outer) { yMin = Math.min(yMin, p[1]); yMax = Math.max(yMax, p[1]); }
  // Толщина профиля по чертежу (yMax − yMin) должна совпадать с толщиной
  // детали из engine.js; если нет — подгоняем сечение по толщине детали.
  const k = (yMax - yMin) > 0 ? (T / MM) / (yMax - yMin) : 1;
  const toZ = (y) => (T / 2) - (y - yMin) * k * MM;   // Y сечения → Z фасада
  const trace = (path, pts) => {
    path.moveTo(pts[0][0] * MM, toZ(pts[0][1]));
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0] * MM, toZ(pts[i][1]));
    path.closePath();
  };
  const shape = new THREE.Shape();
  trace(shape, outer);
  for (let i = 1; i < section.outlines.length; i++) {
    const h = section.outlines[i];
    if (!Array.isArray(h) || h.length < 3) continue;
    const hole = new THREE.Path();
    trace(hole, h);
    shape.holes.push(hole);
  }
  const res = { shape, toZ, k };
  _aluShapeCache.set(key, res);
  return res;
}

// Брусок рамки длиной L (м, по наружному краю) — геометрия кешируется по
// (профиль, толщина, длина): у одинаковых фасадов она общая, при пересчёте
// не создаётся заново. Система координат бруска:
//   X — вдоль стороны (0..L), Y — от наружного края к центру фасада,
//   Z — по толщине (+Z — лицо фасада).
// Запил 45°: вершина сечения, стоящая на расстоянии x от наружного края,
// на каждом конце сдвигается внутрь бруска на x — торцы становятся косыми,
// и четыре бруска сходятся на углах без щелей и нахлёстов.
const _aluBarCache = new Map();
function aluBarGeometry(code, section, T, L) {
  const key = code + '|' + T.toFixed(5) + '|' + L.toFixed(4);
  if (_aluBarCache.has(key)) return _aluBarCache.get(key);
  // Ограничиваем кеш: при переполнении освобождаем всё (меши текущей сцены
  // при необходимости просто перезальют геометрию на видеокарту).
  if (_aluBarCache.size > 300) {
    for (const g of _aluBarCache.values()) if (g && g.dispose) g.dispose();
    _aluBarCache.clear();
  }
  const { shape } = aluSectionShape(code, section, T);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: L, steps: 1, bevelEnabled: false, curveSegments: 1 });
  const pos = geo.attributes && geo.attributes.position;
  if (pos && pos.array) {
    // ExtrudeGeometry кладёт сечение в плоскость XY и тянет по Z. Переставляем
    // оси по кругу (x,y,z) → (z,x,y): это поворот, а не зеркало, поэтому
    // лицевые стороны треугольников остаются наружу.
    const a = pos.array;
    for (let i = 0; i < a.length; i += 3) {
      const sx = a[i], sz = a[i + 1], e = a[i + 2];
      const along = e < L / 2 ? sx : L - sx;          // запил на ус
      a[i] = along; a[i + 1] = sx; a[i + 2] = sz;
    }
    pos.needsUpdate = true;
    // Нормали пересчитываем после перестановки; «плоские» (у каждой грани
    // своя), т.к. ExtrudeGeometry без индекса — рёбра профиля остаются чёткими.
    if (geo.computeVertexNormals) geo.computeVertexNormals();
    if (geo.computeBoundingBox) geo.computeBoundingBox();
    if (geo.computeBoundingSphere) geo.computeBoundingSphere();
  }
  // Общая на все рамки — disposeObjectTree() её не освобождает.
  _aluBarCache.set(key, markShared(geo));
  return geo;
}

// Собирает рамку по сечению в группу g фасада W×H×T (м, центр группы — центр
// фасада, +Z — лицо). Возвращает { glassZ, glassT } — где по толщине лежит
// стекло/заполнение (из section.glass), или null, если строить нечем
// (фасад слишком мал для этого профиля — тогда рисуем упрощённо).
function addAluSectionFrame(g, code, section, W, H, T, matFrame) {
  const w = section.w * MM;
  if (!(W > 2 * w + 0.002 && H > 2 * w + 0.002 && T > 0)) return null;
  // Четыре бруска: у всех «наружный край» — по габариту фасада, X бруска
  // идёт вдоль стороны, Y бруска — к центру фасада.
  const sides = [
    { L: W, x: -W / 2, y: -H / 2, rz: 0 },             // низ
    { L: W, x: W / 2, y: H / 2, rz: Math.PI },         // верх
    { L: H, x: -W / 2, y: H / 2, rz: -Math.PI / 2 },   // левая стойка
    { L: H, x: W / 2, y: -H / 2, rz: Math.PI / 2 },    // правая стойка
  ];
  for (const s of sides) {
    const m = new THREE.Mesh(aluBarGeometry(code, section, T, s.L), matFrame);
    m.position.set(s.x, s.y, 0);
    m.rotation.z = s.rz;
    g.add(m);
  }
  const { toZ, k } = aluSectionShape(code, section, T);
  const gl = Array.isArray(section.glass) && section.glass.length === 4 ? section.glass : null;
  if (!gl) return { glassFrontZ: null, glassT: null };
  return {
    glassFrontZ: Math.max(toZ(gl[1]), toZ(gl[3])),   // лицо стекла (ближе к наружной стороне)
    glassT: Math.abs(gl[3] - gl[1]) * k * MM,
  };
}

// Рамочный фасад: четыре бруска рамки и вставка. У витражных и алюминиевых
// вставка стеклянная и прозрачная, у глухого деревянного — филёнка из того же
// материала, утопленная в рамку.
function makeFramedFacade(box, row, isActive, ghost, sectionHi, drillCheck, drillOnly) {
  const g = new THREE.Group();
  const sw = row.rot === 90 || row.rot === 270;
  const W = (sw ? box.d : box.w) * MM, H = box.h * MM, T = (sw ? box.w : box.d) * MM;
  const fw = Math.min((row.frameW || 70) * MM, Math.min(W, H) / 2 - 0.005);
  // Алюминиевый фасад из профиля (engine.js, part.aluFrame): цвет рамки —
  // выбранный цвет профиля (серебро/шампань/золото/чёрный), заполнение —
  // стекло или листовой материал. Старые данные без aluFrame — как раньше.
  const alu = row.facadeType === 'alu' && row.aluFrame ? row.aluFrame : null;
  let aluColor = null;
  if (alu && typeof alu.colorHex === 'string' && /^#[0-9a-f]{6}$/i.test(alu.colorHex)) {
    aluColor = new THREE.Color(alu.colorHex).getHex();
  }
  const frameColor = sectionHi ? SECTION_HI_COLOR
    : isActive ? 0x6fa3cd
    : (aluColor !== null ? aluColor
      : (row.insertMaterial === 'GLASS-4' && row.facadeType === 'alu' ? 0x8d9296 : 0xc9a76a));
  // Металл рамки — умеренный: карты окружения (envMap) в сцене нет, и при
  // высокой metalness профиль отражал бы «пустоту» и выглядел почти чёрным
  // при любом цвете. С metalness 0.35 и roughness 0.45 цвет профиля читается
  // (серебро — светло-серое, золото/шампань — тёплые, чёрный — чёрный), а
  // лёгкий металлический отблеск от источников света остаётся.
  const matFrame = new THREE.MeshStandardMaterial({
    color: frameColor, roughness: row.facadeType === 'alu' ? 0.45 : 0.7,
    metalness: row.facadeType === 'alu' ? 0.35 : 0.05,
    emissive: sectionHi ? SECTION_HI_EMISSIVE : 0x000000,
    transparent: ghost || sectionHi || isActive,
    opacity: sectionHi ? SECTION_HI_OPACITY : (ghost ? 0.22 : (isActive ? ACTIVE_MODULE_OPACITY : 1)),
    depthWrite: !(ghost || sectionHi || isActive),
  });
  const addBar = (w, h, x, y) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.001), Math.max(h, 0.001), T), matFrame);
    m.position.set(x, y, 0);
    g.add(m);
  };
  // Алюминиевый фасад с чертежом сечения профиля — рамка по реальному
  // сечению (с уступом/карманом/пазом под стекло), см. addAluSectionFrame.
  // Нет чертежа (старые данные) или фасад слишком мал — упрощённые бруски.
  const aluSection = alu ? aluSectionOf(alu.profile) : null;
  const aluFit = aluSection ? addAluSectionFrame(g, alu.profile, aluSection, W, H, T, matFrame) : null;
  if (!aluFit) {
    addBar(W, fw, 0, H / 2 - fw / 2);          // верх
    addBar(W, fw, 0, -H / 2 + fw / 2);         // низ
    addBar(fw, H - 2 * fw, -W / 2 + fw / 2, 0); // левая стойка
    addBar(fw, H - 2 * fw, W / 2 - fw / 2, 0);  // правая стойка
  }

  // вставка. У рамки по сечению — ровно посчитанный размер стекла/заполнения
  // (aluFrame.fillW × fillH из engine.js), по центру фасада.
  const fillOk = aluFit && alu.fillW > 0 && alu.fillH > 0;
  const iw = fillOk ? alu.fillW * MM : Math.max(W - 2 * fw + 0.006, 0.001);
  const ih = fillOk ? alu.fillH * MM : Math.max(H - 2 * fw + 0.006, 0.001);
  // Стекло: у алюминиевого фасада — по типу заполнения (любой код стекла
  // рисуется тем же видом, что GLASS-4), у остальных рамочных — как раньше.
  const isGlass = alu ? alu.fillType === 'glass' : row.insertMaterial === 'GLASS-4';
  // Листовое заполнение алюминиевой рамки (ЛДСП/МДФ): цвет декора по коду
  // материала (тот же decorLook, что у обычных панелей), у древесных декоров —
  // ещё и текстура «под древесину».
  const sheetLook = (alu && !isGlass) ? decorLook(row.insertMaterial) : null;
  const insColor = isGlass ? GLASS4_COLOR
    : (isActive ? 0x7fb0d8 : (sheetLook ? sheetLook.color : 0xd8c8a8));
  // Текстура одна на все вставки (aluInsetWoodTexture) — чтобы не плодить
  // новую GPU-текстуру на каждом пересчёте. Размер вставки учитываем не в
  // текстуре, а в UV самой геометрии (см. ниже, после создания вставки).
  const insTex = (sheetLook && sheetLook.wood && !isActive && !sectionHi && !ghost)
    ? aluInsetWoodTexture() : null;
  const matIns = new THREE.MeshStandardMaterial({
    color: sectionHi ? SECTION_HI_COLOR : insColor,
    map: insTex,
    roughness: isGlass ? 0.08 : 0.7, metalness: 0.02,
    emissive: sectionHi ? SECTION_HI_EMISSIVE : 0x000000,
    transparent: isGlass || ghost || sectionHi || isActive,
    opacity: sectionHi ? SECTION_HI_OPACITY
      : (ghost ? 0.2 : (isGlass ? GLASS4_OPACITY : (isActive ? ACTIVE_MODULE_OPACITY : 1))),
    depthWrite: !(isGlass || ghost || sectionHi || isActive),
  });
  // Толщина и глубина вставки. Рамка по сечению: толщина — из чертежа
  // (section.glass, 4 мм), глубина — там же: у LXD-1204 стекло лежит на полке
  // вровень с наружной стенкой, у LXD-1203 — в кармане под нахлёстом, у
  // LXD3080 — в пазу. Иначе — как раньше (доля толщины фасада).
  // Листовое заполнение (ЛДСП/МДФ) — своей толщины fillThickness, лицом
  // на том же месте, где лицо стекла.
  let insT = T * (isGlass ? 0.25 : 0.6);
  if (aluFit) {
    if (isGlass && aluFit.glassT > 0) insT = aluFit.glassT;
    else if (alu.fillThickness > 0) insT = alu.fillThickness * MM;
    else if (aluFit.glassT > 0) insT = aluFit.glassT;
  }
  const insGeo = new THREE.BoxGeometry(iw, ih, insT);
  if (insTex) {
    // UV у BoxGeometry 0..1 на грань — растягиваем их до метров вставки:
    // вместе с repeat = 1/WOOD_TILE_M у общей текстуры густота волокна
    // получается такой же, как у остальных деталей.
    const uv = insGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * iw, uv.getY(i) * ih);
    uv.needsUpdate = true;
  }
  const ins = new THREE.Mesh(insGeo, matIns);
  ins.position.z = (aluFit && aluFit.glassFrontZ != null) ? aluFit.glassFrontZ - insT / 2
    : (isGlass ? 0 : -T * 0.15);
  g.add(ins);

  // Паз и отверстия под петлю алюм. рамки — на тыльной грани (см. addAluHingeCuts).
  if (alu) addAluHingeCuts(g, row, W, H, T, drillCheck, drillOnly);

  g.position.set(box.x * MM, box.y * MM, box.z * MM);
  g.rotation.y = ((row.rot || 0) * Math.PI) / 180;
  g.userData.module = row.module;
  g.traverse((o) => { o.userData.module = row.module; });
  return g;
}

// ПРИСАДКА В АЛЮМИНИЕВОЙ РАМКЕ под петлю Blum 71T950A (engine.js
// aluHingeCuts): паз под механизм (row.grooves, kind 'aluHingeSlot') и два
// отверстия под саморезы с фаской (row.holes, kind 'aluHingeScrew'). Всё —
// с тыльной стороны фасада (side 'back'), сквозь тыльную стенку профиля.
// Экструзию профиля мы НЕ режем (булево вычитание дорогое и дробит
// геометрию) — вместо этого на тыльной грани рамки рисуем тёмные «проёмы»
// точно по размерам выреза: так их видно, если развернуть модуль спиной
// или открыть дверь. В режиме «Проверка присадки» поверх ставим цветные
// метки, как у остальной присадки.
// Геометрия и материалы общие на всю сцену (кеш ниже) — меняется только
// положение меша, поэтому на десятке дверей не плодим новых буферов.
const _aluCutGeoCache = new Map();
function aluCutGeo(key, make) {
  if (!_aluCutGeoCache.has(key)) _aluCutGeoCache.set(key, markShared(make()));
  return _aluCutGeoCache.get(key);
}
let _aluCutMats = null;
function aluCutMaterials() {
  if (_aluCutMats) return _aluCutMats;
  // Проём в металле — почти чёрный, фаска — чуть светлее (видна как ободок).
  _aluCutMats = {
    hole: markShared(new THREE.MeshBasicMaterial({ color: 0x151515, side: THREE.DoubleSide })),
    csk: markShared(new THREE.MeshBasicMaterial({ color: 0x6b6b6b, side: THREE.DoubleSide })),
    drill: {},   // метки режима проверки — по цвету назначения
  };
  return _aluCutMats;
}
function aluDrillMat(kind, dim) {
  const mats = aluCutMaterials();
  const key = dim ? kind + '|dim' : kind;
  if (!mats.drill[key]) {
    mats.drill[key] = markShared(new THREE.MeshStandardMaterial({
      color: DRILL_COLOR[kind] || 0x555555, roughness: 0.35, metalness: 0.1,
      // как у остальных меток — поверх полупрозрачных деталей
      depthTest: false, transparent: true, opacity: dim ? 0.12 : 0.98,
    }));
  }
  return mats.drill[key];
}
//   g   — группа рамочного фасада (makeFramedFacade): центр — центр фасада,
//         +Z — лицо, −Z — тыл; W/H/T — её размеры в метрах;
//   row — деталь из engine.js (координаты присадки: x — от левого края
//         двери по ширине, y — от нижнего торца по высоте, мм).
function addAluHingeCuts(g, row, W, H, T, drillCheck, drillOnly) {
  const holes = (row.holes || []).filter((h) => h.kind === 'aluHingeScrew' && h.d > 0);
  const slots = (row.grooves || []).filter((s) => s.kind === 'aluHingeSlot' && s.w > 0);
  if (!holes.length && !slots.length) return;
  const mats = aluCutMaterials();
  const LX = (x) => -W / 2 + x * MM;    // координата детали → локальная X группы
  const LY = (y) => -H / 2 + y * MM;
  const zBack = -T / 2 - 0.0002;        // чуть за тыльной гранью, чтобы не мерцало
  const wall = (v) => Math.max(v || 0, 0);
  for (const s of slots) {
    const half = s.w / 2;
    const vert = Math.abs(s.x1 - s.x0) < 0.01;          // ось паза вдоль высоты
    const xa = vert ? s.x0 - half : Math.min(s.x0, s.x1);
    const xb = vert ? s.x0 + half : Math.max(s.x0, s.x1);
    const ya = vert ? Math.min(s.y0, s.y1) : s.y0 - half;
    const yb = vert ? Math.max(s.y0, s.y1) : s.y0 + half;
    const sw = (xb - xa) * MM, sh = (yb - ya) * MM;
    if (!(sw > 0 && sh > 0)) continue;
    const cx = LX((xa + xb) / 2), cy = LY((ya + yb) / 2);
    const m = new THREE.Mesh(aluCutGeo(`slot|${sw.toFixed(5)}|${sh.toFixed(5)}`,
      () => new THREE.PlaneGeometry(sw, sh)), mats.hole);
    m.position.set(cx, cy, zBack);
    m.userData.aluCut = s.kind;
    g.add(m);
    if (drillCheck) {
      const dim = !!drillOnly && drillOnly !== s.kind;
      // метка паза: брусок на глубину стенки профиля (не меньше 4 мм — иначе
      // её не видно), от тыльной грани внутрь
      const dep = Math.max(wall(s.depth), 4) * MM;
      const k = 1;
      const mk = new THREE.Mesh(aluCutGeo(`slotMk|${(sw * k).toFixed(5)}|${(sh * k).toFixed(5)}|${dep.toFixed(5)}`,
        () => new THREE.BoxGeometry(sw * k, sh * k, dep)), aluDrillMat(s.kind, dim));
      mk.position.set(cx, cy, -T / 2 + dep / 2);
      mk.renderOrder = 999;
      mk.userData.drill = s.kind;
      g.add(mk);
    }
  }
  for (const h of holes) {
    const r = (h.d / 2) * MM;
    const cx = LX(h.x), cy = LY(h.y);
    const hole = new THREE.Mesh(aluCutGeo(`hole|${r.toFixed(5)}`,
      () => new THREE.CircleGeometry(r, 20)), mats.hole);
    hole.position.set(cx, cy, zBack - 0.0001);
    hole.userData.aluCut = h.kind;
    g.add(hole);
    if (h.csk > h.d) {
      // фаска (зенковка) — кольцо от Ø отверстия до Ø фаски
      const rc = (h.csk / 2) * MM;
      const ring = new THREE.Mesh(aluCutGeo(`csk|${r.toFixed(5)}|${rc.toFixed(5)}`,
        () => new THREE.RingGeometry(r, rc, 20)), mats.csk);
      ring.position.set(cx, cy, zBack);
      g.add(ring);
    }
    if (drillCheck) {
      const dim = !!drillOnly && drillOnly !== h.kind;
      const dep = Math.max(wall(h.depth), 4) * MM;
      const rr = Math.max(h.d / 2, 1.2) * MM;
      const mk = new THREE.Mesh(aluCutGeo(`holeMk|${rr.toFixed(5)}|${dep.toFixed(5)}`,
        () => new THREE.CylinderGeometry(rr, rr, dep, 14)), aluDrillMat(h.kind, dim));
      mk.rotation.x = Math.PI / 2;               // ось цилиндра — по толщине фасада
      mk.position.set(cx, cy, -T / 2 + dep / 2);
      mk.renderOrder = 999;
      mk.userData.drill = h.kind;               // метка присадки — для прогона
      g.add(mk);
    }
  }
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
    transparent: !!dimmed || isActive,
    opacity: dimmed ? 0.22 : (isActive ? ACTIVE_MODULE_OPACITY : 1),
    depthWrite: !(dimmed || isActive),
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
    transparent: !!dimmed || isActive,
    opacity: dimmed ? 0.22 : (isActive ? ACTIVE_MODULE_OPACITY : 1),
    depthWrite: !(dimmed || isActive),
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
    transparent: !!dimmed || isActive,
    opacity: dimmed ? 0.22 : (isActive ? ACTIVE_MODULE_OPACITY : 1),
    depthWrite: !(dimmed || isActive),
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
    transparent: !!dimmed || isActive,
    opacity: dimmed ? 0.22 : (isActive ? ACTIVE_MODULE_OPACITY : 1),
    depthWrite: !(dimmed || isActive),
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
// клипсой.obj), запечённая в src/legMeshes.js, БЕЗ групп/подмешей (просто
// облако треугольников). Раньше весь меш растягивался по Y одним
// mesh.scale — от этого при смене высоты опоры «плыла» и верхняя площадка,
// и нижняя пятка, и резьба.
//
// По требованию заказчика (чертёж регулируемой опоры 98–130 мм) резьбу не
// моделируем — она не видна в сборке. Вместо неё меш разрезан на две
// НЕИЗМЕНЯЕМЫЕ по размеру части — верхнюю площадку и нижнюю пятку, — а
// между ними вставлен гладкий процедурный цилиндр, длина которого и
// меняется при изменении box.h. Границы среза (в нативных метрах
// исходника, где 0 — низ пятки, NATIVE_HEIGHT=0.1 — верх площадки) найдены
// разведочным анализом координат треугольников меша: у обоих вариантов
// (plain/clip) РОВНО на Y=0,020 и Y=0,080 нет ни одного треугольника,
// пересекающего границу — то есть в самой исходной модели там уже проходит
// шов между пяткой, стволом/резьбой и площадкой, резать можно без дыр.
const LEG_MID_CUT_LOW = 0.020;   // м — верх пятки / низ ствола (низ = 0..0,020)
const LEG_MID_CUT_HIGH = 0.080;  // м — верх ствола / низ площадки (верх = 0,080..0,1)

// «Ушко» клипсы РАНЬШЕ пытались вырезать из baked-меша сравнением радиальных
// профилей 'clip' и 'plain' (диапазон Y 0,046..0,054) — оказалось ненадёжно:
// в этом диапазоне у 'clip' лежит не изолированный маленький выступ, а
// широкий пояс той же спиральной резьбы/рифления, что и везде на стволе
// (просто с другими координатами вершин) — вырезка «всех треугольников с
// Y в диапазоне» без учёта X/Z захватывала треугольники по всей окружности
// под разными углами наклона спирали, из-за чего на реальном рендере
// появлялась крупная чёрная масса из каскада «колец», а не маленькая
// деталь. Кроме того, физически цоколь в этом движке — плоская планка
// (kind: 'plinth', см. engine.js), а не круглый пруток, так что и «хомут
// вокруг трубы» с чертежа сюда не подошёл бы даже при точной вырезке.
// Поэтому клипсу больше не вырезаем из baked-геометрии, а строим отдельным
// маленьким процедурным мешом — см. makeClipTabMesh ниже, по числам из
// engine.js (площадка клипсы 38×30 мм, вылет от оси CLIP_NATIVE_REACH/
// CLIP_NATIVE_D), которые там же используются для расчёта присадки и
// позиционирования цоколя относительно опоры.

// Кеш разрезанных геометрий по варианту ('plain' | 'clip') — резать
// треугольники накладно, а ножек с этой опорой на сцене может быть много.
const kitchenLegSplitCache = {};
function splitKitchenLegParts(kind, THREE) {
  if (kitchenLegSplitCache[kind]) return kitchenLegSplitCache[kind];

  const LM = window.Modul3D.legMeshes;
  const full = LM.getGeometry(kind, THREE);
  const pos = full.attributes.position.array;
  const norm = full.attributes.normal.array;
  const EPS = 1e-6;

  const lowPos = [], lowNorm = [], highPos = [], highNorm = [];
  const triCount = pos.length / 9;
  for (let t = 0; t < triCount; t++) {
    const b = t * 9;
    const y0 = pos[b + 1], y1 = pos[b + 4], y2 = pos[b + 7];
    if (y0 <= LEG_MID_CUT_LOW + EPS && y1 <= LEG_MID_CUT_LOW + EPS && y2 <= LEG_MID_CUT_LOW + EPS) {
      for (let k = 0; k < 9; k++) { lowPos.push(pos[b + k]); lowNorm.push(norm[b + k]); }
    } else if (y0 >= LEG_MID_CUT_HIGH - EPS && y1 >= LEG_MID_CUT_HIGH - EPS && y2 >= LEG_MID_CUT_HIGH - EPS) {
      for (let k = 0; k < 9; k++) { highPos.push(pos[b + k]); highNorm.push(norm[b + k]); }
    }
    // иначе — треугольник ствола/резьбы между границами: отбрасываем
    // (у варианта 'clip' сюда же попадает и «ушко» — его больше не вырезаем
    // из этого меша, см. комментарий выше и makeClipTabMesh).
  }

  // Радиус ствола ровно в точках среза — чтобы цилиндр состыковался с
  // пяткой/площадкой без видимой ступеньки. Берём только вершины самого
  // ствола (радиус 10..20 мм) — шире этого диапазона на срезе лежит уже
  // край диска пятки/площадки, а не ствол.
  let sumRLow = 0, cntRLow = 0, sumRHigh = 0, cntRHigh = 0;
  const R_MIN = 0.010, R_MAX = 0.020, Y_EPS = 1e-4;
  for (let i = 0; i < pos.length; i += 3) {
    const y = pos[i + 1], x = pos[i], z = pos[i + 2];
    const r = Math.sqrt(x * x + z * z);
    if (r < R_MIN || r > R_MAX) continue;
    if (Math.abs(y - LEG_MID_CUT_LOW) < Y_EPS) { sumRLow += r; cntRLow++; }
    else if (Math.abs(y - LEG_MID_CUT_HIGH) < Y_EPS) { sumRHigh += r; cntRHigh++; }
  }

  const lowGeo = new THREE.BufferGeometry();
  lowGeo.setAttribute('position', new THREE.Float32BufferAttribute(lowPos, 3));
  lowGeo.setAttribute('normal', new THREE.Float32BufferAttribute(lowNorm, 3));
  const highGeo = new THREE.BufferGeometry();
  highGeo.setAttribute('position', new THREE.Float32BufferAttribute(highPos, 3));
  highGeo.setAttribute('normal', new THREE.Float32BufferAttribute(highNorm, 3));
  // Кэш на всю сессию — при перестройке сцены не освобождать (см. markShared).
  markShared(lowGeo);
  markShared(highGeo);
  markShared(full);   // исходный меш из legMeshes.js (у него свой кэш)

  const result = {
    lowGeo, highGeo,
    lowH: LEG_MID_CUT_LOW,                       // высота нижнего куска, нативные м
    highH: LM.NATIVE_HEIGHT - LEG_MID_CUT_HIGH,  // высота верхнего куска, нативные м
    // паспортный радиус ствола Ø29 мм — подстраховка, если на срезе вдруг
    // не нашлось ни одной подходящей вершины (на текущей модели такого нет).
    radiusBottom: cntRLow ? sumRLow / cntRLow : 0.0145,
    radiusTop: cntRHigh ? sumRHigh / cntRHigh : 0.0145,
  };
  kitchenLegSplitCache[kind] = result;
  return result;
}

// Клипса кухонной опоры для крепления цоколя — процедурная сборка (не
// вырезается из baked-меша, см. комментарий выше splitKitchenLegParts) из
// двух частей:
//   1) хомут (защёлка) — частичный цилиндр, обхватывающий ствол опоры
//      снаружи, как реальная пластиковая защёлка на круглый профиль;
//   2) монтажная пластина — плоская, торцом упирается в цоколь и несёт
//      2 сквозных «отверстия» присадки на лицевой грани (визуальные,
//      светлые цилиндры насквозь через толщину пластины).
// Цоколь в этом движке — плоская планка (engine.js, kind: 'plinth'), а не
// круглый пруток, поэтому крепится к нему именно плоская пластина, а не
// хомут — хомут только держит клипсу на стволе опоры. Присадка в
// пластине — те же числа, что engine.js реально сверлит в цоколе (см.
// finalizePlinthClips, HALF = 12,5: «площадка клипсы 38×30, присадка
// 2×Ø2 с шагом 25»), отмасштабированные тем же коэффициентом, что и
// вылет клипсы CLIP_REACH — чтобы пропорции не менялись при другом
// диаметре опоры.
// Кольцевой сектор РЕАЛЬНОЙ толщины стенки (innerR..outerR) в горизонтальной
// плоскости XZ (та же плоскость, где CylinderGeometry опоры откладывает
// x = r·sinθ, z = r·cosθ), экструдированный по вертикали на высоту height —
// используется для хомута клипсы (см. ниже), чтобы это было настоящее тело
// с толщиной стенки, а не нулевая скорлупа. Тот же приём Shape +
// ExtrudeGeometry, что и у остальной геометрии с вырезами в этом файле,
// только контур строим сразу в координатах (X, Z) и экструдируем
// «горизонтально».
function ringSectorGeometry(innerR, outerR, thetaStart, thetaLength, height, THREE) {
  // Сегменты дуги: у полного круга похожие мелкие цилиндры в этом файле
  // (площадка опоры, отверстия присадки) используют 12–24 сегмента на 360°.
  // Здесь дуга охватывает 210°, а не 360°, и в собранном виде оказывается
  // близко к камере (хомут, надетый прямо на ствол опоры) — на глаз при 24
  // сегментах на 210° (что per-градус реже, чем 20 сегментов на 360° у
  // похожих деталей) дуга читалась гранёной. 48 сегментов на 210° дают
  // плотность заметно выше «эталонных» 20/360°, визуально гладкую дугу, и
  // остаются дешёвыми — это по-прежнему один маленький меш на клипсу.
  const segs = 48;
  const shape = new THREE.Shape();
  // Внешняя дуга контура (от начала охвата к концу). Вторую координату
  // берём со знаком минус — компенсирует geo.rotateX(-90°) ниже, который
  // разворачивает локальный Z экструзии в мировой Y, а локальный Y шейпа —
  // в мировой -Z; после компенсации итоговый мировой Z получается ровно
  // r·cosθ, как и везде в файле для этой опоры.
  for (let i = 0; i <= segs; i++) {
    const t = thetaStart + (thetaLength * i) / segs;
    const x = outerR * Math.sin(t);
    const z = -(outerR * Math.cos(t));
    if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
  }
  // Внутренняя дуга — обратным ходом (от конца охвата к началу), чтобы
  // контур замкнулся в кольцевой сектор («банан» заданной толщины), а не
  // в две несвязанные дуги. Прямые между дугами (торцы хомута в местах его
  // открытого зазора) получаются сами собой в точках стыка.
  for (let i = segs; i >= 0; i--) {
    const t = thetaStart + (thetaLength * i) / segs;
    const x = innerR * Math.sin(t);
    const z = -(innerR * Math.cos(t));
    shape.lineTo(x, z);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2);       // экструзия (глубина height) ложится на мировую вертикаль Y
  geo.translate(0, -height / 2, 0); // центрируем по высоте, как и остальные детали клипсы
  return geo;
}

// Площадка клипсы со скруглёнными углами — по чертежу поставщика (вид
// спереди) прямоугольник 38×30 отлит со скруглёнными, а не острыми углами
// (типично для литья под давлением). Three.js r128 не имеет встроенной
// RoundedBoxGeometry, поэтому строим скруглённый контур сами: Shape в
// плоскости (ширина×высота) с четырьмя скруглёнными углами через
// quadraticCurveTo, экструдированный на depth (вылет площадки от ствола
// опоры) — тот же приём Shape + ExtrudeGeometry, что и у ringSectorGeometry
// выше.
//
// Итоговые локальные оси геометрии — те же, что были у заменяемого
// BoxGeometry(depth, height, width): X — вылет (depth), Y — высота
// площадки (height, «плоскость чертежа спереди» по вертикали), Z — ширина
// площадки (width, по горизонтали). Контур рисуем в координатах шейпа
// (shape.x = ширина, shape.y = высота), а после экструзии по умолчанию
// вдоль локального Z шейпа разворачиваем geo.rotateY(+90°): при этой
// повороте локальный Z экструзии (0..depth) уходит в мировой X, шейповый
// Y (высота) остаётся мировым Y, а шейповый X (ширина) уходит в мировой
// -Z — знак минус не важен, контур симметричен относительно нуля по обеим
// осям, поэтому зеркалирование ширины никак не искажает форму.
function roundedPlateGeometry(depth, height, width, cornerR, THREE) {
  const hw = width / 2, hh = height / 2;
  // Радиус скругления не может быть больше половины меньшей стороны —
  // иначе дуги соседних углов наложатся друг на друга.
  const r = Math.max(Math.min(cornerR, hw, hh), 0);
  const shape = new THREE.Shape();
  if (r < 1e-6) {
    // Вырожденный случай (радиус ~0) — обычный прямоугольник без скруглений.
    shape.moveTo(-hw, -hh);
    shape.lineTo(hw, -hh);
    shape.lineTo(hw, hh);
    shape.lineTo(-hw, hh);
    shape.closePath();
  } else {
    shape.moveTo(-hw + r, -hh);
    shape.lineTo(hw - r, -hh);
    shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
    shape.lineTo(hw, hh - r);
    shape.quadraticCurveTo(hw, hh, hw - r, hh);
    shape.lineTo(-hw + r, hh);
    shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
    shape.lineTo(-hw, -hh + r);
    shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
    shape.closePath();
  }

  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 });
  geo.rotateY(Math.PI / 2);
  geo.translate(-depth / 2, 0, 0); // центрируем вылет (X), как и у прежнего BoxGeometry
  return geo;
}

// Кеш геометрии по диаметру опоры d — в одном проекте диаметр опоры один
// на все ножки, а клипс на сцене может быть несколько (передний ряд).
const clipTabGeoCache = {};
function makeClipTabGeo(d, THREE) {
  const key = Math.round(d * 1e6);
  if (clipTabGeoCache[key]) return clipTabGeoCache[key];
  const LM = window.Modul3D.legMeshes;
  // Масштаб под текущий диаметр опоры — тот же коэффициент, что и у
  // остальных размеров клипсы ниже (площадка, хомут, отверстия), приведённых
  // к номинальному диаметру опоры LM.NATIVE_DIAMETER = 0,054 м.
  const scale = d / LM.NATIVE_DIAMETER;
  // Радиус ствола, а НЕ d/2 (d — номинальный диаметр опоры по фланцу/пятке,
  // LM.NATIVE_DIAMETER = 0,054 м — см. комментарий у этой константы в
  // legMeshes.js: «видимый диаметр опоры по флейтам/фланцу»). Реальный ствол
  // заметно тоньше — его нативный радиус уже измерен эмпирически по вершинам
  // baked-меша в splitKitchenLegParts (кеш 'clip' там же используется чуть
  // выше в makeKitchenLeg, поэтому вызов здесь — просто попадание в кеш, не
  // повторный разбор меша). Без этой поправки хомут клипсы обхватывал
  // радиус фланца — вдвое больше реального ствола, отсюда был видимый зазор.
  const cut = splitKitchenLegParts('clip', THREE);
  const legR = (cut.radiusTop + cut.radiusBottom) / 2 * scale;
  const plateW = 0.038; // м — ширина площадки клипсы (чертёж поставщика: площадка 38×30×10 мм)
  const plateH = 0.030; // м — высота площадки клипсы
  // Толщина площадки — независимое реальное число с чертежа поставщика
  // (38×30×10 мм), а НЕ результат подгонки под то, докуда пластина должна
  // дотягиваться от оси опоры (раньше depth считали как reach - legR, где
  // reach — вылет от оси; это смешивало два разных числа с чертежа — толщину
  // детали и её вылет — и толщина «плавала» при разных диаметрах опоры).
  // Нижняя граница — чисто защитная подстраховка на вырожденно маленький
  // scale, при реалистичном scale (~0,9–1) она никогда не срабатывает.
  const depth = Math.max(0.010 * scale, 0.003);
  // Скруглённые углы площадки (вид спереди по чертежу поставщика) — см.
  // roundedPlateGeometry выше. Радиус скругления не указан в чертеже
  // читаемо цифрой — небольшое значение на глаз (~2,5 мм в номинальном
  // масштабе, тот же scale, что и остальные размеры клипсы), это чисто
  // декоративная деталь формы литья, не влияющая на присадку.
  const plateCornerR = 0.0025 * scale;
  const plateGeo = roundedPlateGeometry(depth, plateH, plateW, plateCornerR, THREE);

  // Хомут (защёлка) — кольцевой сектор РЕАЛЬНОЙ толщины стенки (не нулевая
  // скорлупа, как раньше через открытый CylinderGeometry: у той версии
  // внутренний и внешний радиус совпадали, поэтому хомут читался как
  // плоская пластина, а не как деталь, обхватывающая ствол). Внутренний
  // радиус — почти впритык к стволу (только зазор против z-fighting),
  // внешний — на толщину стенки дальше; толщина завязана на тот же
  // коэффициент scale, что и остальные размеры клипсы, чтобы пропорции не
  // менялись при другом диаметре опоры. Точных мм для этой формы нет ни в
  // чертеже, ни в присадке engine.js — это чисто визуальный элемент
  // механизма крепления (само крепление считается по площадке и её
  // отверстиям ниже), толщина и охват дуги подобраны на глаз под реальную
  // пластиковую P-клипсу. Центрируем дугу на угле, где x = r·sinθ, z = r·cosθ
  // даёт θ=90° → +X — ровно та сторона, где ниже стоит пластина.
  const hoopGap = 0.0004;                  // м, зазор от поверхности трубы (без z-fighting)
  const hoopWallT = 0.0022 * scale;        // м, толщина стенки хомута (~2,2 мм в номинальном масштабе)
  const hoopInnerR = legR + hoopGap;
  const hoopOuterR = hoopInnerR + hoopWallT;
  // Охват дуги — заметно больше полукруга (не 130°, как раньше, и не ровно
  // 180°), чтобы хомут визуально «защёлкивался» на стволе, а не просто
  // облегал его меньше чем наполовину. Открытый зазор (360° - span = 150°)
  // остаётся на стороне, ПРОТИВОПОЛОЖНОЙ пластине (дуга центрирована на той
  // же оси θ=90°, что и пластина) — там, где у реальной пластиковой клипсы
  // пружинят «губки» при надевании на трубу.
  const hoopSpan = 210 * Math.PI / 180;
  // Высота хомута — самостоятельный размер, не связанный с высотой пластины
  // (plateH = площадка клипсы 38×30, engine.js). По чертежу поставщика
  // хомут (защёлка на стволе) высотой 8 мм в номинальном масштабе — тот же
  // scale, что и у остальных размеров клипсы, чтобы пропорции не менялись
  // при другом диаметре опоры.
  const hoopH = 0.008 * scale;
  const hoopGeo = ringSectorGeometry(
    hoopInnerR, hoopOuterR, Math.PI / 2 - hoopSpan / 2, hoopSpan, hoopH, THREE);

  // Отверстия присадки в пластине — визуальный аналог отверстий в САМОЙ
  // пластиковой клипсе (шаг 25 мм = ±12,5 мм от оси, см. выше, число не
  // трогаем — оно уже верное), отмасштабированный тем же коэффициентом
  // scale, что и вылет клипсы.
  // Диаметр — Ø5,5 мм по чертежу поставщика (сквозное отверстие в пластике
  // под шляпку/тело самореза). Это НЕ то же число, что KITCHEN_HOLE_D = 2 мм
  // в engine.js (finalizePlinthClips) — тот диаметр относится к ПИЛОТНОМУ
  // отверстию, которое реально сверлится в ДЕРЕВЕ цоколя, а не к отверстию
  // в пластиковой клипсе. Деревянное пилотное 2 мм в engine.js не менять —
  // это отдельное, действующее число присадки; здесь правим только
  // визуальную дырку в самой клипсе.
  //
  // Отверстия — на лицевой грани площадки (38×30, нормаль по X — той самой,
  // что на чертеже поставщика показана спереди с двумя отверстиями), а НЕ
  // на верхней Y-грани, как было раньше. Эта грань физически зажата между
  // стволом опоры и цоколем и не видна ни с одного ракурса камеры, но
  // отверстия геометрически расположены именно там — рисуем деталь такой,
  // какая она есть, а не такой, какую удобнее увидеть. Сквозные: цилиндр
  // проходит через ВСЮ толщину площадки (depth) насквозь, с небольшим
  // запасом holeEps на каждый срез против z-fighting (тот же приём, что и в
  // addLegMountPlate). Ось цилиндра по умолчанию — Y, поэтому геометрию
  // строим «вдоль» depth, а на разворот в мировой X её ставит
  // hole.rotation.z = Math.PI/2 в месте создания меша (makeKitchenLeg).
  //
  // Декоративные рёбра/насечки по верхнему и нижнему краю площадки (видны
  // на чертеже, по 3 штуки с каждой стороны) сознательно НЕ добавлены —
  // чисто декоративная деталь литья, не влияющая на присадку; цена/присадку
  // они не затрагивают.
  const holeD = 0.0055 * scale;
  const holeHalfSpacing = 0.0125 * scale;
  const holeEps = 0.01 * MM; // запас с каждого среза против z-fighting (как в addLegMountPlate)
  const holeGeo = new THREE.CylinderGeometry(holeD / 2, holeD / 2, depth + 2 * holeEps, 12);

  // Кэш на всю сессию — при перестройке сцены не освобождать (см. markShared).
  markShared(plateGeo);
  markShared(hoopGeo);
  markShared(holeGeo);

  const geo = {
    plateGeo, hoopGeo, holeGeo,
    legR, depth, plateW, plateH, holeHalfSpacing,
  };
  clipTabGeoCache[key] = geo;
  return geo;
}

function makeKitchenLeg(box, moduleName, isActive, hasClip, dimmed, rot) {
  const g = new THREE.Group();
  const d = Math.max(box.w, box.d) * MM;
  const h = Math.max(box.h * MM, 0.001);

  // Цвет — из присланного опора.mtl (Kd 0,0091 0,0075 0,0048 → #020201,
  // фактически чистый чёрный с едва тёплым оттенком), Ks/Ns говорят о
  // некотором — не нулевом — блике, roughness чуть ниже прежнего под это.
  const plastic = new THREE.MeshStandardMaterial({
    color: isActive ? 0x232a30 : 0x020201, roughness: 0.5, metalness: 0.02,
    emissive: isActive ? 0x0d1a26 : 0x000000,
    transparent: !!dimmed || isActive,
    opacity: dimmed ? 0.22 : (isActive ? ACTIVE_MODULE_OPACITY : 1),
    depthWrite: !(dimmed || isActive),
  });

  const LM = window.Modul3D.legMeshes;
  const kind = hasClip ? 'clip' : 'plain';
  const cut = splitKitchenLegParts(kind, THREE);
  const scaleXZ = d / LM.NATIVE_DIAMETER;

  // Нижняя пятка — форма и высота как в исходнике, БЕЗ растяжения по Y
  // (scale.y = 1): меняется только высота опоры box.h, форма пятки — нет.
  const lowMesh = new THREE.Mesh(cut.lowGeo, plastic);
  lowMesh.scale.set(scaleXZ, 1, scaleXZ);
  lowMesh.position.y = -h / 2;
  g.add(lowMesh);

  // Верхняя площадка с крепёжными отверстиями — тоже без растяжения по Y.
  // Формула сдвига не зависит от места среза: вершина исходника при
  // y=NATIVE_HEIGHT (самый верх площадки) всегда должна попасть в +h/2.
  const highMesh = new THREE.Mesh(cut.highGeo, plastic);
  highMesh.scale.set(scaleXZ, 1, scaleXZ);
  highMesh.position.y = h / 2 - LM.NATIVE_HEIGHT;
  g.add(highMesh);

  // Средняя часть — гладкий процедурный цилиндр без резьбы. Единственная
  // деталь, чья длина зависит от box.h. Радиусы на концах — фактический
  // радиус ствола в точках среза (см. splitKitchenLegParts), поэтому стыки
  // с пяткой и площадкой не дают видимой ступеньки. openEnded — торцы уже
  // закрыты соседними кусками, свои крышки цилиндру не нужны.
  const midH = Math.max(h - cut.lowH - cut.highH, 0.001);
  const midGeo = new THREE.CylinderGeometry(
    cut.radiusTop * scaleXZ, cut.radiusBottom * scaleXZ, midH, 24, 1, true);
  const midMesh = new THREE.Mesh(midGeo, plastic);
  // Центр цилиндра: низ группы на -h/2, нижний кусок высотой lowH над ним,
  // верхний кусок высотой highH под верхом группы (+h/2) — цилиндр
  // заполняет ровно то, что осталось между ними.
  midMesh.position.y = (cut.lowH - cut.highH) / 2;
  g.add(midMesh);

  // Клипса (только у варианта с клипсой) — хомут на стволе + пластина с
  // 2 отверстиями, см. makeClipTabGeo. Высота: середина ГРУППЫ (локальный
  // y=0) — при любой высоте опоры это ровно CLIP_Y = baseH*0,5 из
  // engine.js, на которую инженерный расчёт ставит планку цоколя. Глубина
  // (X) пластины: от поверхности ствола (legR) наружу на фиксированную
  // толщину depth (10 мм по чертежу поставщика, см. makeClipTabGeo) — центр
  // пластины на legR + depth/2. Поворот всей группы ниже (g.rotation.y =
  // -90° + поворот модуля) уводит локальную +X в глобальную +Z (к цоколю
  // НЕповёрнутого модуля) — тот же разворот, что раньше ориентировал
  // baked-«ушко»; при повороте модуля (row.rot из engine.js) к нему
  // добавляется тот же угол, что и у самого модуля/цоколя, иначе клипса на
  // повёрнутом модуле «смотрит» в старом мировом направлении, а не на
  // цоколь рядом с ней (см. makeRod/pin/flange ниже — тот же приём:
  // rotation.y = row.rot в радианах).
  if (hasClip) {
    const clip = makeClipTabGeo(d, THREE);

    // Хомут — сидит прямо на стволе, в той же вертикальной середине
    // группы, что и пластина (обе части одной детали).
    const hoopMesh = new THREE.Mesh(clip.hoopGeo, plastic);
    hoopMesh.position.set(0, 0, 0);
    g.add(hoopMesh);

    // Пластина крепления к цоколю.
    const plateMesh = new THREE.Mesh(clip.plateGeo, plastic);
    const plateCenterX = clip.legR + clip.depth / 2;
    plateMesh.position.set(plateCenterX, 0, 0);
    g.add(plateMesh);

    // 2 отверстия присадки — визуальная имитация на лицевой грани площадки
    // (38×30, нормаль по X — та самая грань с чертежа поставщика с двумя
    // отверстиями), сквозные через всю толщину depth. Ось цилиндра
    // (clip.holeGeo) по умолчанию — Y; разворачиваем на 90° вокруг Z, чтобы
    // она легла на X — «насквозь» через толщину площадки. Длина цилиндра в
    // геометрии уже включает depth + запас с обеих сторон (см.
    // makeClipTabGeo), поэтому по X центрируем ровно на середине площадки
    // (plateCenterX), а по Y — на вертикальном центре площадки (0), как на
    // чертеже (отверстия между рёбрами сверху и снизу полосы 30 мм). По Z —
    // как и раньше, ±holeHalfSpacing (шаг 25 мм между центрами).
    // Цвет — светлее, чем у addLegMountPlate (0x1c1d1e): там он
    // контрастирует со светлой площадкой опоры, а здесь пластина клипсы
    // почти чёрная (0x020201) — тот же тёмный оттенок был бы неразличим.
    // Берём светлый металлик — как настоящая шляпка шурупа на тёмном
    // пластике.
    const holeMat = new THREE.MeshStandardMaterial({
      color: 0x9a9ea3, roughness: 0.4, metalness: 0.5,
      transparent: !!dimmed, opacity: dimmed ? 0.22 : 1, depthWrite: !dimmed,
    });
    for (const sz of [-1, 1]) {
      const hole = new THREE.Mesh(clip.holeGeo, holeMat);
      hole.rotation.z = Math.PI / 2; // ось цилиндра Y -> X, отверстие сквозь толщину площадки
      hole.position.set(plateCenterX, 0, sz * clip.holeHalfSpacing);
      g.add(hole);
    }
  }

  g.position.set(box.x * MM, box.y * MM, box.z * MM);
  // Клипса развёрнута к цоколю (-90°, локальная +X → мировая +Z) ПЛЮС
  // поворот самого модуля (rot, градусы, 0/90/180/270) — box.x/box.z уже
  // пересчитаны в мировые координаты в engine.js, а вот ориентацию
  // асимметричной клипсы (в отличие от круглого ствола опоры) нужно
  // довернуть отдельно, иначе на повёрнутом модуле она продолжает смотреть
  // в старом мировом направлении, а не на цоколь рядом с ней.
  if (hasClip) g.rotation.y = -Math.PI / 2 + ((rot || 0) * Math.PI) / 180;
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
// Сдвиг (px, сумма |dx|+|dy| за жест), после которого нажатие на сцене — уже
// протяжка, а не клик. То же число проверяет выбор модуля/детали кликом
// (pointerup в Viewer3D: `controls.moved > SCENE_DRAG_PX`), поэтому клик,
// выбирающий модуль, никогда не переключит плоский вид в 3D.
const SCENE_DRAG_PX = 6;
// Полюсный порог: ближе к вертикали (phi < POLE_EPS или > π − POLE_EPS) вектор
// «вверх» камеры берём вдоль ∓Z — иначе lookAt вырождается (см. update()).
const POLE_EPS = 0.02;

// ---------------------------------------------------------------------------
// КАДР ПОД НИЖНИЙ ЛИСТ (телефон ≤ 820 px; на десктопе — панель «Документы»)
// ---------------------------------------------------------------------------
// Пока внизу открыта панель (Библиотека, Параметры… на телефоне; «Документы»
// на десктопе), она закрывает нижнюю часть холста. ui-shell.js (разделы 7б и
// 7б′) сообщает её высоту событием 'modul3d:drawer-inset'
// ({ detail: { bottom: px } }, 0 — панели нет; левые панели десктопа тоже
// дают 0). Viewer3D.setBottomInset() делает две вещи:
//   1) сдвигает проекцию камеры (camera.setViewOffset), так что точка, куда
//      смотрит камера, оказывается в центре ВИДИМОЙ части холста (над листом);
//   2) подгоняет расстояние камеры так, чтобы вся композиция модулей целиком
//      влезла в видимую часть с полями — углы обзора не сбрасываются.
const INSET_FIT_MARGIN = 0.08;   // поле с КАЖДОЙ стороны видимой части (доля её размера)
const INSET_MIN_VISIBLE = 48;    // px: меньше этого видимой части холста не оставляем
const INSET_TWEEN_MS = 240;      // плавная подгонка при открытии/закрытии листа
const INSET_BURST_MS = 120;      // события чаще этого — лист тянут пальцем: без анимации, сразу

function nowMs() {
  return (window.performance && typeof window.performance.now === 'function')
    ? window.performance.now() : Date.now();
}

function prefersReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { return false; }
}

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

    // Ставит снаружи Viewer3D: вызывается ОДИН раз за жест, когда вращение
    // сцены в плоском (ортографическом) виде переросло клик. Там вьювер
    // переходит в 3D-перспективу с теми же углами. Возвращает true, если
    // переход случился (см. ветку 'rotate' в pointermove).
    this.onOrthoRotateStart = null;
    // Сдвиг, накопленный в плоском виде, пока жест ещё похож на клик: камеру
    // не крутим (иначе вид «спереди» слегка перекосится, оставаясь «спереди»),
    // а после порога отдаём весь накопленный сдвиг одним шагом — без рывка.
    this._orthoPendX = 0;
    this._orthoPendY = 0;

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
        this._orthoPendX = this._orthoPendY = 0;
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
      this._orthoPendX = this._orthoPendY = 0;
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
      this.userMoved = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      if (this.mode === 'rotate') {
        let stepX = dx, stepY = dy;
        // Вращение в плоском виде («спереди», «сверху»…): пока сдвиг не
        // перерос клик — копим его и камеру не трогаем. После порога просим
        // вьювер перейти в 3D с теми же углами (как при протяжке гизмы) и
        // сразу применяем весь накопленный сдвиг — сцена идёт за курсором.
        // Панорамирование и зум (колесо/пинч) вид не меняют.
        if (this.camera.isOrthographicCamera && this.onOrthoRotateStart) {
          this._orthoPendX += dx;
          this._orthoPendY += dy;
          if (this.moved <= SCENE_DRAG_PX) return;   // ещё похоже на клик
          stepX = this._orthoPendX;
          stepY = this._orthoPendY;
          this._orthoPendX = this._orthoPendY = 0;
          this.onOrthoRotateStart();   // меняет this.camera на перспективную
        }
        this.theta -= stepX * 0.006;
        this.phi = Math.min(Math.PI - 0.03, Math.max(0.03, this.phi - stepY * 0.006));
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
      this.userMoved = true;
      const pt = this.zoomPointProvider ? this.zoomPointProvider(e) : null;
      this._zoomBy(k, pt, e);
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
    this._zoomBy(k, pt, { clientX: midX, clientY: midY });

    // Панорамирование — сдвиг средней точки между пальцами со времени
    // предыдущего кадра.
    this.pan(midX - this._pinchMidX, midY - this._pinchMidY);

    this.userMoved = true;
    this.moved += Math.abs(dist - this._pinchDist) + Math.abs(midX - this._pinchMidX) + Math.abs(midY - this._pinchMidY);
    this._pinchDist = dist;
    this._pinchMidX = midX;
    this._pinchMidY = midY;
    this.update();
  }

  /** Общий шаг масштабирования (используется и колесом мыши, и pinch-зумом). */
  _zoomBy(k, pt, scr) {
    this.userMoved = true;
    const newR = Math.max(0.15, Math.min(60, this.radius * k));
    // В ортографическом виде фокус считает onZoom по экранной точке (точно).
    if (pt && k < 1 && !this.camera.isOrthographicCamera) {
      // приближение — тянем цель к точке под курсором/пальцами пропорционально шагу
      const f = 1 - newR / this.radius;
      this.target.lerp(pt, Math.min(0.9, Math.max(0, f)));
    }
    this.radius = newR;
    if (this.onZoom) this.onZoom(k, pt, scr);
  }

  /**
   * Панорамирование: сдвигаем точку, вокруг которой смотрит камера, вдоль её
   * собственных осей «вправо» и «вверх». Величина сдвига в мире на пиксель
   * считается по текущему зуму, чтобы модель шла ровно за курсором.
   */
  pan(dx, dy) {
    this.userMoved = true;
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

  /**
   * Предустановки камеры: спереди / справа ('side') / слева / сзади / сверху /
   * снизу — и 3D ('iso'). Сцена: перёд изделия = +Z, право = +X, верх = +Y.
   */
  setView(name) {
    if (name === 'front')       { this.theta = 0;             this.phi = Math.PI / 2; }
    else if (name === 'side')   { this.theta = Math.PI / 2;   this.phi = Math.PI / 2; }   // камера на +X
    else if (name === 'left')   { this.theta = -Math.PI / 2;  this.phi = Math.PI / 2; }   // камера на -X
    else if (name === 'back')   { this.theta = Math.PI;       this.phi = Math.PI / 2; }   // камера на -Z
    // Вид сверху — строго вертикально (phi = 0). Наклона быть не должно,
    // иначе получается аксонометрия и виден передний торец.
    else if (name === 'top')    { this.theta = 0;             this.phi = 0; }
    // Вид снизу — так же строго вертикально, камера под изделием (phi = π).
    else if (name === 'bottom') { this.theta = 0;             this.phi = Math.PI; }
    else                        { this.theta = Math.PI / 4;   this.phi = Math.PI / 2.6; }
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
    const EPS = POLE_EPS;
    if (this.phi < EPS) this.camera.up.set(0, 0, -1);
    else if (this.phi > Math.PI - EPS) this.camera.up.set(0, 0, 1);
    else this.camera.up.set(0, 1, 0);

    this.camera.lookAt(this.target);
  }

  /**
   * Оси камеры в мировых координатах для ТЕКУЩИХ углов: right (вправо на
   * экране), up (вверх на экране), back (от цели К камере). Считает по тем же
   * углам и тому же правилу «вверх» у полюсов, что и update() (то есть как
   * Matrix4.lookAt), но саму камеру не двигает — нужно для подгонки кадра.
   */
  basis() {
    const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    const back = new THREE.Vector3(sp * Math.sin(this.theta), cp, sp * Math.cos(this.theta));
    const up0 = new THREE.Vector3(0, 1, 0);
    if (this.phi < POLE_EPS) up0.set(0, 0, -1);
    else if (this.phi > Math.PI - POLE_EPS) up0.set(0, 0, 1);
    const right = new THREE.Vector3().crossVectors(up0, back).normalize();
    const up = new THREE.Vector3().crossVectors(back, right);
    return { right, up, back };
  }
}

// Плоские (ортографические) виды. Всё, чего нет в списке, — 3D ('iso').
const FLAT_VIEWS = ['front', 'side', 'left', 'back', 'top', 'bottom'];

// ---------------------------------------------------------------------------
// РУЧНАЯ РАЗМЕТКА ПОВЕРХ 3D (плоские виды) — ядро в markup.js (см. его шапку,
// раздел «3D-ОВЕРЛЕЙ»). Здесь — только «лист» для ядра: прозрачный SVG
// поверх холста (1 единица = 1 CSS px), проекция мм модели → px экрана и
// правила, какие точки можно ловить мышью.
// ---------------------------------------------------------------------------
const MK_SHEET = 'viewer3d';        // id листа отображения в markup.js
const MK_EPS = 0.5;                 // мм: допуск «общее ребро»/«та же плоскость»
// Вынос ручного размера в 3D ЗА габаритом изделия — в ПОСТОЯННЫХ экранных
// px на 1 мм (offset в записи хранится в мм от точки A, как на чертеже).
// Внутри габарита линия привязана к геометрии и масштабируется с зумом, а
// снаружи её зазор от края изделия при зуме не меняется — как у авто-
// размеров вьювера (app.js, .ov-dim). См. offsetOutside в _markupCtx и
// шапку markup.js. Значение — масштаб листа «Общий вид» для типового шкафа
// 800×2100×600 (drawings.js: 820 / (2100 + 62 + 600 + 130) ≈ 0.28 ед. листа
// на мм, а 1 ед. листа ≈ 1 CSS px): вынос в 3D выглядит так же, как на
// чертеже (сами размеры 3D и чертежей раздельны, см. MK_VIEWS).
const MK_OFFSET_PX_PER_MM = 0.28;
// Вид камеры → (лист данных, имя вида в данных, оси экрана, глубина ближней
// грани бокса детали вдоль взгляда: МЕНЬШЕ = ближе к зрителю; d — мировая ось
// взгляда: дальняя грань бокса = near + размер бокса вдоль d).
// Разметка 3D и чертежей ПОЛНОСТЬЮ РАЗДЕЛЬНА (решение пользователя
// 2026-09-28): все 6 видов пишут в свой лист данных 'view3d' (только 3D);
// размеры «Общего вида» ('overview') в 3D не показываются, а поставленные в
// 3D — не появляются на чертеже. Имена видов 'front'/'side'/'top' ('side' —
// камера СЛЕВА) совпадают с уже записанными раньше размерами от отверстий.
const MK_VIEWS = {
  front:  { data: 'view3d', name: 'front',  h: 'x', v: 'y', d: 'z', near: (b) => -(b.z + b.d / 2) },  // камера на +Z
  left:   { data: 'view3d', name: 'side',   h: 'z', v: 'y', d: 'x', near: (b) => b.x - b.w / 2 },     // камера на −X
  top:    { data: 'view3d', name: 'top',    h: 'x', v: 'z', d: 'y', near: (b) => -(b.y + b.h / 2) },  // камера на +Y
  side:   { data: 'view3d', name: 'right',  h: 'z', v: 'y', d: 'x', near: (b) => -(b.x + b.w / 2) },  // камера на +X
  back:   { data: 'view3d', name: 'back',   h: 'x', v: 'y', d: 'z', near: (b) => b.z - b.d / 2 },     // камера на −Z
  bottom: { data: 'view3d', name: 'bottom', h: 'x', v: 'z', d: 'y', near: (b) => b.y - b.h / 2 },     // камера на −Y
};
// Размер бокса детали (мм) вдоль мировой оси — как rowFrame() в markup.js.
function mkSize(b, ax) { return ax === 'x' ? b.w : (ax === 'y' ? b.h : b.d); }
function mkApi() { return (window.Modul3D && window.Modul3D.markup) || null; }

// Стили оверлея: на холсте 1 единица = 1 CSS px (на чертеже линии тоньше, т.к.
// лист масштабируется), поэтому линии чуть толще. Цвета — через переменные,
// зависящие от темы приложения (ui-shell.js ставит <html data-theme=
// "light"|"dark"> и красит фон сцены: светлая #eef2f7, тёмная #14171c):
//   --mk-ink   линии/стрелки готовых размеров;  --mk-text  цифры;
//   --mk-halo  обводка цифр — цвет фона сцены, чтобы цифра читалась поверх
//              деталей и линий;
//   --mk-edit  «рисуется/наведено» (синий), --mk-sel  «выбран» (оранжевый),
//   --mk-bad   «точка не годится» (красный).
// Готовые размеры — голубые, как все остальные размеры приложения (авто-
// размеры вьювера .ov-dim и чертежей .dw-dim в style.css): var(--accent) с
// обводкой цифр var(--bg-2), в обеих темах (решение пользователя).
// Синий/оранжевый/красный в тёмной теме светлее — тёмно-синий #1a73e8 на
// #14171c почти не виден.
const MK_OVERLAY_CSS = `
.mk-3d-overlay{position:absolute;left:0;top:0;pointer-events:none;overflow:visible;
  --mk-ink:var(--accent);--mk-text:var(--accent);--mk-halo:var(--bg-2);--mk-edit:#1a73e8;--mk-sel:#d6820a;--mk-bad:#d63333}
[data-theme='dark'] .mk-3d-overlay{
  --mk-edit:#5cb0ff;--mk-sel:#ffb547;--mk-bad:#ff6b6b}
.mk-3d-overlay.mk-3d-on{pointer-events:auto;cursor:crosshair}
.mk-3d-overlay .mk-3d-bg{fill:transparent;stroke:none}
.mk-3d-overlay .dw-dim{stroke:var(--mk-ink);stroke-width:1}
.mk-3d-overlay .dw-ext{stroke:var(--mk-ink);stroke-width:.8}
.mk-3d-overlay .dw-arrow{fill:var(--mk-ink)}
.mk-3d-overlay .dw-dt{fill:var(--mk-text);paint-order:stroke;stroke:var(--mk-halo);stroke-width:3px;stroke-linejoin:round}
.mk-3d-overlay .mk-draft .dw-dim,.mk-3d-overlay .mk-draft .dw-ext{stroke:var(--mk-edit)}
.mk-3d-overlay .mk-draft .dw-arrow,.mk-3d-overlay .mk-draft .dw-dt{fill:var(--mk-edit)}
.mk-3d-overlay .mk-dim-sel .dw-dim,.mk-3d-overlay .mk-dim-sel .dw-ext{stroke:var(--mk-sel)}
.mk-3d-overlay .mk-dim-sel .dw-arrow,.mk-3d-overlay .mk-dim-sel .dw-dt{fill:var(--mk-sel)}
.mk-3d-overlay .mk-hl-mark{stroke-width:1.6}
.mk-3d-overlay .mk-hl-ok .mk-hl-mark,.mk-3d-overlay .mk-anchor .mk-hl-mark{stroke:var(--mk-edit)}
.mk-3d-overlay .mk-hl-bad .mk-hl-mark{stroke:var(--mk-bad)}
.mk-3d-overlay .mk-draft-line{stroke:var(--mk-edit)}
.mk-3d-overlay.mk-3d-on .mk-dim{cursor:pointer}
.mk-3d-overlay.mk-3d-on .mk-dim .mk-hit{cursor:move}
`;
let mkStyleInjected = false;
function ensureMkOverlayStyle() {
  if (mkStyleInjected || typeof document === 'undefined' || !document.head
    || typeof document.createElement !== 'function') return;
  mkStyleInjected = true;
  const st = document.createElement('style');
  st.id = 'mk3d-style';
  st.textContent = MK_OVERLAY_CSS;
  document.head.appendChild(st);
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
    // Текущий вид: 'front' | 'side' | 'left' | 'back' | 'top' | 'bottom' | 'iso'.
    // По умолчанию камера стоит в 3D-ракурсе (углы SimpleOrbitControl).
    this.viewName = 'iso';
    // Колбэк «вид сменили ЖЕСТОМ на навигационной гизме» (name) — его ставит
    // app.js, чтобы синхронизировать своё состояние/кнопки. Сам setView()
    // его НЕ вызывает (иначе при вызове из app.js/горячих клавиш получился
    // бы цикл) — только жесты пользователя: ViewGizmo (клик/протяжка гизмы)
    // и вращение самой сцены из плоского вида (см. onOrthoRotateStart).
    this.onViewChange = null;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    container.appendChild(this.renderer.domElement);
    // Ссылка на рабочий вьювер — для отладки из консоли браузера:
    //   Modul3D.viewer.current.memoryInfo()
    //   Modul3D.viewer.current.renderer.info.memory
    if (window.Modul3D && window.Modul3D.viewer) window.Modul3D.viewer.current = this;

    this.controls = new SimpleOrbitControl(this.camera, this.renderer.domElement);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Кэш геометрии деталей (ключ geoKey, см. render ниже): одинаковые по
    // размерам и присадке детали (несколько ящиков/полок одной ширины —
    // обычное дело в проекте) собираются ОДИН раз, а не на каждую
    // деталь и на каждый вызов render() — переключение «Проверка присадки»
    // геометрию вырезов не меняет вообще (только метки и прозрачность), так
    // что кэш переживает рендеры. Живёт всю сессию вьювера; ограничение
    // размера — грубая защита от бесконечного роста при долгой работе с
    // множеством разных проектов подряд, не точная LRU-политика.
    this._partGeoCache = new Map();

    // Выбор модуля кликом по 3D-модели. Клик отличаем от вращения по тому,
    // сдвигалась ли мышь между нажатием и отпусканием.
    this.onSelectModule = null;
    // Двойной клик по модулю — переход в режим изоляции (см. render() ниже,
    // opts.isolateModule). Колбэк получает имя модуля строкой.
    this.onIsolateModule = null;
    // Клик по ЛЮБОЙ детали (боковина, полка, дно, фасад и т.д. — любой
    // userData.kind) ВНУТРИ изолированного модуля. Колбэк получает
    // { module, kind, side, sectionIndex, zoneIndex, partKey, clientX,
    // clientY } — side есть только у боковины, у остальных деталей будет
    // undefined; partKey — engine.js grainKey кликнутой детали (или null).
    // Координаты клика — чтобы app.js мог поставить контекстное меню в точку
    // клика.
    this.onSelectPart = null;
    // Клик по ОТСЕКУ (секция +, если она разбита по высоте, конкретная зона)
    // ВНЕ изоляции — в обычном режиме, где видны все модули сразу. Раньше
    // отсек можно было выбрать только через двойной клик (вход в Focus Mode,
    // см. onIsolateModule выше) и клик по его фасаду (onSelectPart выше) —
    // для отсека БЕЗ фасада (открытая полка, ниша под встроенную технику)
    // кликать было вообще не по чему. Здесь колбэк срабатывает и по фасаду
    // отсека (если он есть), и по любой другой видимой детали внутри него
    // (полка, видимый кусок задней стенки) — секцию/зону в обоих случаях
    // определяет _resolveZoneHit ниже: у фасада-двери sectionIndex/zoneIndex
    // уже посчитаны в engine.js (partsRaw, см. userData у door чуть ниже по
    // коду; ящики — drawerFront — сюда не попадают, у них свой экран
    // «Ящики»), а у остальных деталей своего sectionIndex/zoneIndex нет
    // — они вычисляются геометрически по месту клика, сверяясь с соседними
    // стойками/несъёмными полками-перегородками того же модуля, без обращения к
    // engine.js. Колбэк получает { module, sectionIndex, zoneIndex, clientX,
    // clientY } — zoneIndex может быть null, если у секции нет деления по
    // высоте. Остальные детали (боковина, дно, крыша, цоколь, стойка между
    // секциями и т.д. — без привязки к конкретному отсеку) по-прежнему идут
    // в onSelectModule, это поведение не меняется.
    this.onSelectZone = null;
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
      if (this.controls.moved > SCENE_DRAG_PX) return;
      if (!this.onSelectModule && !this.onSelectPart && !this.onFocusMiss && !this.onSelectZone) return;
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
              sectionIndex: kindOwner.userData.sectionIndex,
              zoneIndex: kindOwner.userData.zoneIndex,
              // Ключ кликнутой детали (engine.js grainKey) — точнее, чем
              // kind/sectionIndex; null у деталей без ключа.
              partKey: kindOwner.userData.partKey || null,
              clientX: e.clientX,
              clientY: e.clientY,
            });
          }
        } else if (this.onFocusMiss) {
          this.onFocusMiss({ module: this._isolateModule, clientX: e.clientX, clientY: e.clientY });
        }
        return;
      }
      // ВНЕ изоляции: если клик пришёлся на деталь, у которой есть свой
      // «отсек» (фасад — или, если фасада нет, любая другая видимая деталь
      // внутри отсека — см. _resolveZoneHit), выбираем отсек СРАЗУ, без
      // задержки на анти-дребезг двойного клика ниже — по тому же принципу,
      // что и onSelectPart в изоляции: там тоже нет такой задержки, промаха
      // на «вход в изоляцию» здесь не бывает (двойной клик по фасаду просто
      // следом откроет Focus Mode отдельным обработчиком dblclick, это не
      // конфликтует). onSelectModule в этом случае вызывать не нужно вовсе —
      // иначе под выбором отсека мелькнул бы ещё и HUD всего модуля.
      if (this.onSelectZone) {
        const zoneHit = this._resolveZoneHit(hits);
        if (zoneHit) {
          this.onSelectZone({ ...zoneHit, clientX: e.clientX, clientY: e.clientY });
          return;
        }
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
      if (!this.onIsolateModule || this.controls.moved > SCENE_DRAG_PX) return;
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

    // Нижний лист на телефоне (см. блок «КАДР ПОД НИЖНИЙ ЛИСТ» выше).
    // _inset — высота листа в px, под которую подогнан кадр («целевое»
    // значение из события); _insetShown — сколько px сейчас реально учтено в
    // проекции камер (в ходе плавной подгонки догоняет _inset). Оба 0 —
    // обычное кадрирование на весь холст (десктоп без панели «Документы»: всегда так).
    this._inset = 0;
    this._insetShown = 0;
    // Боковые панели (компьютер): сколько px холста слева/справа закрыто
    // выдвижной панелью. Работают так же, как нижний отступ (цель и «показано»).
    this._insetL = 0; this._insetR = 0;
    this._insetLShown = 0; this._insetRShown = 0;
    this._insetEventT = 0;    // время последнего изменения _inset (отличить «тянут лист» от разового открытия)
    this._camTween = null;     // идущая плавная подгонка кадра (крутится внутри _animate, отдельного rAF нет)
    this._compCache = null;    // кэш габарита композиции (сбрасывается в render())
    // Необязательный колбэк «кадр сдвинули подгонкой под лист» — app.js может
    // перерисовать размеры поверх плоских видов (оверлей привязан к проекции).
    this.onCameraFit = null;
    // Пользователь взялся за сцену (касание/колесо) — плавную подгонку
    // доводим до конца сразу, чтобы она не боролась с его жестом.
    this.renderer.domElement.addEventListener('pointerdown', () => this._finishCamTween(), true);
    this.renderer.domElement.addEventListener('wheel', () => this._finishCamTween(), { capture: true, passive: true });

    this.controls.onZoom = (k, pt, scr) => {
      if (!this.isOrtho) return;
      // Точный зум в точку под курсором/между пальцами: точка плоскости цели,
      // лежащая под экранной точкой, до и после смены масштаба должна остаться
      // на месте — сдвигаем цель на разницу. Без лучей по модели (попал/мимо
      // давало скачки влево-вправо при щипке на телефоне).
      const before = scr ? this._ortoPlanePoint(scr) : null;
      this._orthoZoom = Math.max(0.2, Math.min(12, this._orthoZoom / k));
      this._fitOrtho();
      const after = before ? this._ortoPlanePoint(scr) : null;
      if (before && after) this.controls.target.add(before.sub(after));
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

    // Пользователь начал вращать САМУ СЦЕНУ, стоя в плоском виде: переходим
    // в 3D с теми же углами и сообщаем интерфейсу — ровно как при протяжке
    // гизмы (иначе камера крутилась бы, а гизма и размеры показывали бы
    // «спереди»). Клик для выбора модуля сюда не доходит — порог SCENE_DRAG_PX.
    this.controls.onOrthoRotateStart = () => {
      if (!this._enterPerspectiveKeepAngles()) return false;
      this._notifyViewChange('iso');
      return true;
    };

    this._addLights();
    this._addGrid();

    // Навигационная гизма (круг с осями в углу окна 3D). Создаётся до первого
    // _resize()/_animate(), чтобы те могли её подстроить/перерисовать. Если
    // 2D-канвы нет (тестовая среда tools/) — гизма молча остаётся null.
    this.gizmo = ViewGizmo.create(this);

    this._resize();
    window.addEventListener('resize', () => this._resize());

    // Нижний лист на телефоне: подписка на контракт ui-shell.js (раздел 7б).
    // viewer.js грузится РАНЬШЕ ui-shell.js, но экземпляр создаёт app.js уже
    // после него — поэтому текущее значение можно спросить сразу (с проверкой:
    // без ui-shell/в тестовой среде просто остаёмся на весь холст).
    window.addEventListener('modul3d:drawer-inset', (e) => {
      const d = (e && e.detail) || {};
      this.setInsets(d.bottom, d.left, d.right);
    });
    try {
      const shell = window.Modul3D && window.Modul3D.uiShell;
      if (shell && typeof shell.getDrawerInset === 'function') {
        const s = typeof shell.getDrawerInsets === 'function' ? shell.getDrawerInsets() : {};
        this.setInsets(shell.getDrawerInset(), s.left, s.right);
      }
    } catch (err) { /* не критично: кадр останется на весь холст */ }

    // Оверлей ручной разметки (плоские виды) — см. блок MK_* выше.
    this._initMarkupOverlay();

    this._animate();
  }

  // Точка плоскости, проходящей через цель камеры перпендикулярно взгляду,
  // под экранной точкой e (clientX/clientY) — для зума ортокамеры в точку.
  _ortoPlanePoint(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const cam = this.camera;
    cam.updateMatrixWorld();
    this._raycaster.setFromCamera(ndc, cam);
    const r = this._raycaster.ray;
    const t = this.controls.target.clone().sub(r.origin).dot(r.direction);
    return r.origin.clone().addScaledVector(r.direction, t);
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

  /**
   * Клик ВНЕ изоляции → какой это отсек (секция + зона), см. onSelectZone
   * выше. hits — результат _hitTestAt (первый — ближайшая точка попадания).
   * Возвращает { module, sectionIndex, zoneIndex } или null, если попали
   * мимо любой детали отсека (боковина/дно/крыша/цоколь/стойка/фурнитура —
   * они остаются обычным выбором модуля, см. вызов ниже по коду).
   *
   * У фасада-двери секция и зона УЖЕ посчитаны в engine.js и просто
   * лежат в userData (см. кусок кода с `mesh.userData.sectionIndex` в
   * render()) — их достаточно прочитать (ящики — kind:'drawerFront' —
   * сюда не попадают: у них свой экран «Ящики», не doorZones, см. ниже
   * по коду). У отсека БЕЗ фасада (открытая
   * полка, ниша под встроенную технику) своего sectionIndex/zoneIndex ни на
   * одной детали нет (полке, задней стенке это ни к чему — они не привязаны
   * к одной секции: задняя стенка вообще одна на весь модуль), поэтому
   * секцию/зону вычисляем ГЕОМЕТРИЧЕСКИ по точке клика — делим модуль
   * вертикальными стойками между секциями (kind:'divider', engine.js кладёт
   * их по возрастанию вдоль ширины корпуса, в том же порядке, что и
   * sectionIndex), а внутри найденной секции по высоте — несъёмными полками-
   * перегородками (kind:'shelf', fixed:true — engine.js строит их «снизу
   * вверх» на стыках зон пенала, см. engine.js, sec.doorZones/azLayout).
   * Никакой новой геометрии тут не считается — только сортировка уже готовых
   * мировых позиций тех же деталей, что и так стоят в сцене.
   *
   * ПОВОРОТ МОДУЛЯ В ПЛАНЕ (90/180/270°, см. engine.js ~3528-3530 —
   * manualRot меняет местами x/z у КАЖДОЙ детали модуля при повороте на
   * 90/270° и меняет знак у обеих при повороте на 180°, и своё вращение
   * может добавить ещё и весь ряд/прогон целиком): при таком повороте деление
   * на секции в МИРОВЫХ координатах может пойти по Z вместо X, а «слева
   * направо» может превратиться в «справа налево» (координата растёт, а
   * sectionIndex при этом убывает). Ни ось, ни направление здесь не читаются
   * из параметров модуля (не хотим тащить сюда model — пришлось бы разбирать
   * связку поворота модуля и поворота прогона), а определяются геометрически
   * по боковинам (kind:'side', их всегда РОВНО ДВЕ — левая и правая,
   * userData.side): разница между ними целиком уходит в одну мировую ось
   * (любой поворот здесь кратен 90° вокруг вертикали, «размазать» разницу по
   * диагонали он не может) — эта ось и есть «ширина» (см. widthAxis ниже), а
   * знак разницы (левая координата меньше правой или больше) говорит,
   * растёт sectionIndex вдоль неё или убывает (см. ascending ниже). Высоту
   * (Y) поворот в плане не трогает вообще — она в этой развилке не участвует.
   */
  _resolveZoneHit(hits) {
    if (!hits.length) return null;
    let kindOwner = null;
    for (let o = hits[0].object; o; o = o.parent) {
      if (o.userData && o.userData.kind) { kindOwner = o; break; }
    }
    if (!kindOwner) return null;
    const module = kindOwner.userData.module;
    if (!module) return null;
    const kind = kindOwner.userData.kind;
    // Только дверь — у отсека (doorZones) свой набор полей (техника/фасад/
    // высота/полки), а ящики (kind:'drawerFront') настраиваются отдельным
    // экраном «Ящики» (sec.drawers), к отсекам отношения не имеют. Раньше
    // (в Focus Mode) клик по ящику вёл на обычный редактор детали, а не на
    // редактор отсека — сохраняем это же разделение и здесь.
    if (kind === 'door') {
      const sectionIndex = kindOwner.userData.sectionIndex;
      if (!Number.isFinite(sectionIndex)) return null;
      const zoneIndex = Number.isFinite(kindOwner.userData.zoneIndex) ? kindOwner.userData.zoneIndex : null;
      return { module, sectionIndex, zoneIndex };
    }
    // Отсек без фасада — только полка (в т.ч. несъёмная полка-перегородка) и
    // видимый кусок задней стенки нужно отдавать как «клик по отсеку»;
    // остальное (боковина/дно/крыша/цоколь/стойка/ручки/опоры и т.п.) —
    // как раньше, обычный выбор модуля.
    if (kind !== 'shelf' && kind !== 'back') return null;
    const hitPoint = hits[0].point;

    // Ось «вдоль ширины» и направление возрастания sectionIndex вдоль неё —
    // см. комментарий к методу выше. По умолчанию X, по возрастанию (как до
    // учёта поворота модуля), но если у боковин разброс по Z оказался
    // больше — переключаемся на Z, и если «левая» боковина лежит на БОЛЬШЕЙ
    // координате, чем «правая» (после поворота бывает и так), — на убывание.
    let widthAxis = 'x';
    let ascending = true;
    {
      let leftPos = null, rightPos = null;
      for (const child of this.group.children) {
        if (!child.userData || child.userData.module !== module || child.userData.kind !== 'side') continue;
        if (child.userData.side === 'left') leftPos = child.position;
        else if (child.userData.side === 'right') rightPos = child.position;
      }
      // Если обеих боковин почему-то не нашлось (не должно случаться — у
      // корпуса их всегда две) — тихо остаёмся на оси X по возрастанию.
      if (leftPos && rightPos) {
        const dx = Math.abs(leftPos.x - rightPos.x);
        const dz = Math.abs(leftPos.z - rightPos.z);
        widthAxis = dz > dx ? 'z' : 'x';
        ascending = widthAxis === 'z' ? leftPos.z < rightPos.z : leftPos.x < rightPos.x;
      }
    }
    const alongWidth = (pos) => (widthAxis === 'z' ? pos.z : pos.x);
    const hitWidth = alongWidth(hitPoint);

    const dividerCoords = [];
    const fixedShelves = [];   // { w: координата вдоль ширины, y: высота }
    for (const child of this.group.children) {
      if (!child.userData || child.userData.module !== module) continue;
      if (child.userData.kind === 'divider') dividerCoords.push(alongWidth(child.position));
      else if (child.userData.kind === 'shelf' && child.userData.fixed) {
        fixedShelves.push({ w: alongWidth(child.position), y: child.position.y });
      }
    }
    // sectionIndex — число стоек, оставшихся «позади» клика В ТУ СТОРОНУ,
    // где растёт sectionIndex (ascending) — а не просто число стоек с
    // координатой меньше клика: при повороте модуля эти два порядка не
    // всегда совпадают (см. комментарий к методу). Границы найденной секции
    // (secLeft/secRight — нужны только для отбора полок-перегородок ЭТОЙ
    // секции, а не соседней) считаем ТУТ ЖЕ, из того же самого условия
    // «стойка позади клика» — если считать их отдельным проходом с чисто
    // числовым сравнением (без ascending), на равенстве dc===hitWidth
    // получилась бы вилка с другой стороны, чем сама sectionIndex.
    let sectionIndex = 0;
    let secLeft = -Infinity;
    let secRight = Infinity;
    for (const dc of dividerCoords) {
      const isBehind = ascending ? dc < hitWidth : dc > hitWidth;
      if (isBehind) {
        sectionIndex++;
        if (ascending) secLeft = Math.max(secLeft, dc); else secRight = Math.min(secRight, dc);
      } else if (ascending) {
        secRight = Math.min(secRight, dc);
      } else {
        secLeft = Math.max(secLeft, dc);
      }
    }
    const zoneYs = fixedShelves
      .filter((s) => s.w > secLeft && s.w < secRight)
      .map((s) => s.y)
      .sort((a, b) => a - b);
    // Нет несъёмных перегородок в этой секции — значит, деления на зоны нет
    // вовсе (та же секция, что и есть), zoneIndex остаётся 0 — как и у
    // одиночной (не разбитой на зоны) двери в engine.js.
    let zoneIndex = 0;
    for (const zy of zoneYs) { if (hitPoint.y > zy) zoneIndex++; }
    return { module, sectionIndex, zoneIndex };
  }

  /**
   * ОБРАТНАЯ задача к _resolveZoneHit: там по точке клика находится
   * sectionIndex/zoneIndex, здесь — наоборот, по уже ИЗВЕСТНЫМ
   * sectionIndex/zoneIndex (см. render(), opts.highlightSection) находятся
   * мировые границы этого отсека. Нужно только для подсветки отсека БЕЗ
   * фасада (см. SECTION_HI_COLOR/SECTION_SCOPED_EXCLUDE выше и вызов в
   * render()) — обычная подсветка фасада тогда красить нечего, поэтому
   * вместо неё подсвечивается содержимое отсека по этим границам.
   *
   * ВАЖНО: считает по «сырым» строкам source (row.box из model.partsRaw),
   * а НЕ по мешам this.group.children, как _resolveZoneHit — вызывается ДО
   * основного цикла render(), пока меши текущего рендера ещё не построены
   * (this.group как раз перестраивается этим же вызовом).
   *
   * Ось «вдоль ширины» и направление возрастания sectionIndex вдоль неё —
   * та же логика, что и в _resolveZoneHit (см. её комментарий про поворот
   * модуля в плане 90/180/270°): определяются по боковинам (kind:'side',
   * userData.side/row.name — их всегда ровно две).
   *
   * Возвращает { module, widthAxis, secLeft, secRight, zoneLow, zoneHigh }
   * (границы всегда числа, открытая сторона — ±Infinity).
   */
  _computeSectionHiBounds(source, sectionHi, targetZoneIndex) {
    const module = sectionHi.module;
    const sectionIndex = sectionHi.sectionIndex;
    let widthAxis = 'x';
    let ascending = true;
    {
      let leftBox = null, rightBox = null;
      for (const row of source) {
        if (row.module !== module || row.kind !== 'side') continue;
        const side = sideOfPartName(row.name);
        if (side === 'left') leftBox = row.box;
        else if (side === 'right') rightBox = row.box;
      }
      // Если обеих боковин почему-то не нашлось (не должно случаться — у
      // корпуса их всегда две) — тихо остаёмся на оси X по возрастанию.
      if (leftBox && rightBox) {
        const dx = Math.abs(leftBox.x - rightBox.x);
        const dz = Math.abs(leftBox.z - rightBox.z);
        widthAxis = dz > dx ? 'z' : 'x';
        ascending = widthAxis === 'z' ? leftBox.z < rightBox.z : leftBox.x < rightBox.x;
      }
    }
    const alongWidth = (box) => (widthAxis === 'z' ? box.z : box.x);

    // Стойки между секциями (kind:'divider') в ПОРЯДКЕ, в котором их строит
    // engine.js: k-я по счёту стойка всегда разделяет секцию k и k+1 — это
    // порядок построения (engine.js собирает секции по очереди слева
    // направо в СВОЕЙ локальной системе координат), а не порядок по
    // итоговой мировой координате, которую поворот модуля может обратить.
    const dividerBoxes = source
      .filter((row) => row.module === module && row.kind === 'divider')
      .map((row) => row.box);
    const loBox = sectionIndex > 0 ? dividerBoxes[sectionIndex - 1] : null;
    const hiBox = sectionIndex < dividerBoxes.length ? dividerBoxes[sectionIndex] : null;
    const loCoord = loBox ? alongWidth(loBox) : null;
    const hiCoord = hiBox ? alongWidth(hiBox) : null;
    let secLeft = -Infinity;
    let secRight = Infinity;
    if (loCoord != null && hiCoord != null) {
      // Средняя секция — обе границы известны, направление уже не важно,
      // просто числовой минимум/максимум.
      secLeft = Math.min(loCoord, hiCoord);
      secRight = Math.max(loCoord, hiCoord);
    } else if (hiCoord != null) {
      // Первая секция (sectionIndex===0) — известна только граница с
      // соседней справа (по индексу) секцией; с какой стороны от неё лежит
      // сама секция 0 (координата меньше или больше), решает ascending.
      if (ascending) secRight = hiCoord; else secLeft = hiCoord;
    } else if (loCoord != null) {
      // Последняя секция — известна только граница с предыдущей.
      if (ascending) secLeft = loCoord; else secRight = loCoord;
    }
    // Если границ нет вовсе (единственная секция в модуле) — secLeft/
    // secRight остаются ±Infinity, что и требуется: вся ширина модуля.

    // Несъёмные полки-перегородки ЭТОЙ секции (их координата вдоль ширины —
    // тот же secCenterX/secCenterZ, что и у любой полки секции, попадает
    // строго внутрь [secLeft, secRight]) размечают отсек по высоте. Высоту
    // (в отличие от ширины) поворот модуля в плане не трогает вообще —
    // сортировка по Y всегда верна, направление здесь не нужно.
    const fixedYs = source
      .filter((row) => row.module === module && row.kind === 'shelf' && row.fixed
        && alongWidth(row.box) > secLeft && alongWidth(row.box) < secRight)
      .map((row) => row.box.y)
      .sort((a, b) => a - b);
    const zi = Number.isFinite(targetZoneIndex) ? targetZoneIndex : null;
    const zoneLow = zi !== null && zi > 0 ? fixedYs[zi - 1] : -Infinity;
    const zoneHigh = zi !== null && zi < fixedYs.length ? fixedYs[zi] : Infinity;

    return { module, widthAxis, secLeft, secRight, zoneLow, zoneHigh };
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
    this._grid = grid;                  // в виде «снизу» прячем (см. _updateFloorVisibility)
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
    this._applyViewOffset();   // нижний лист: сдвиг проекции (при выключенном — ничего)
    this._fitOrtho();
    if (this.gizmo) this.gizmo.resize();
  }

  // ---------------------------------------------------------------------------
  // КАДР ПОД НИЖНИЙ ЛИСТ (телефон) — см. блок констант INSET_* выше
  // ---------------------------------------------------------------------------

  // Размер холста в CSS-px — те же числа, что и в _resize().
  _canvasCssSize() {
    return { w: this.container.clientWidth || 600, h: this.container.clientHeight || 500 };
  }

  // Сколько px снизу холста высотой ch сейчас закрыто листом (с защитой от
  // «лист выше холста»: минимум INSET_MIN_VISIBLE px остаётся видимым).
  // Лист (.drawer) лежит внутри .stage с bottom:0, а #viewer3d растянут на всю
  // .stage — поэтому высота листа и есть закрытая часть холста снизу.
  _insetPx(ch) {
    const b = this._insetShown;
    if (!(b > 0)) return 0;
    return Math.min(b, Math.max(0, ch - INSET_MIN_VISIBLE));
  }

  // То же для боковых панелей: слева и справа вместе не больше cw − минимум.
  _insetPxLR(cw, l0, r0) {
    let l = Math.max(0, l0 === undefined ? this._insetLShown : l0);
    let r = Math.max(0, r0 === undefined ? this._insetRShown : r0);
    const room = Math.max(0, cw - INSET_MIN_VISIBLE);
    if (l + r > room) {
      const s = l + r > 0 ? room / (l + r) : 0;
      l *= s; r *= s;
    }
    return { l, r };
  }

  /**
   * Сдвигает проекцию обеих камер так, чтобы центр кадра (точка, куда смотрит
   * камера) лёг в центр ВИДИМОЙ части холста — от верха до верха листа.
   * setViewOffset(fullW, fullH, x, y, w, h) берёт окно w×h из «полного»
   * изображения fullW×fullH; окно с тем же размером, но сдвинутое вниз на
   * b/2, поднимает картинку на b/2 px: центр сцены оказывается на высоте
   * (h − b)/2 от верха — ровно середина видимой части. Масштаб (px на метр)
   * при этом не меняется: рамка по-прежнему считается от ВСЕЙ высоты холста.
   * Координаты мыши/тапа для raycast нормируются от размеров холста и
   * projectionMatrixInverse уже учитывает сдвиг — выбор деталей не страдает.
   * Смещение 0 — clearViewOffset(), проекция ровно как без этой функции.
   */
  _applyViewOffset() {
    const { w, h } = this._canvasCssSize();
    const b = this._insetPx(h);
    const { l, r } = this._insetPxLR(w);
    for (const cam of [this.persp, this.ortho]) {
      // Боковая панель слева закрывает l px: окно сдвигается на −l/2 (картинка
      // уезжает вправо), справа — на +r/2; середина видимой части = центр кадра.
      if ((b > 0 || l > 0 || r > 0) && typeof cam.setViewOffset === 'function') {
        cam.setViewOffset(w, h, (r - l) / 2, b / 2, w, h);
      } else if (b === 0 && l === 0 && r === 0 && cam.view && cam.view.enabled && typeof cam.clearViewOffset === 'function') {
        cam.clearViewOffset();
      }
    }
  }

  // Габарит всего, что сейчас нарисовано (все модули композиции), в метрах.
  // null — сцена пуста. Кэшируется до следующего render(): при перетаскивании
  // листа события идут каждый кадр, обходить меши каждый раз незачем.
  _compositionBox() {
    if (!this._compCache) {
      let box = null;
      try {
        this.group.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(this.group);
        const v = [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z];
        if (!b.isEmpty() && v.every(Number.isFinite)) box = b;
      } catch (e) { box = null; }
      this._compCache = { box };
    }
    return this._compCache.box;
  }

  // Обычный кадр «на весь экран»: та же формула, что всегда была в render()
  // при смене габарита. null — модель ещё не рисовалась.
  _calcDefaultFrame() {
    const d = this._lastDims;
    if (!d) return null;
    const maxDim = Math.max(d.W, d.H, d.D, 1000) * MM;
    return { radius: maxDim * 1.6, tx: 0, ty: Math.max(d.H, 800) * MM * 0.45, tz: 0, orthoZoom: 1 };
  }

  /**
   * Кадр для нижнего листа высотой inset px: { radius, tx, ty, tz, orthoZoom }
   * — расстояние камеры и точка, куда она смотрит; УГЛЫ обзора не трогаем.
   * inset = 0 (или сцена пуста) → обычный кадр на весь экран (maxDim·1.6, без
   * учёта пропорций холста) — кроме случая fitAll: тогда та же подгонка по
   * углам с b = 0, то есть вся композиция целиком в весь экран с теми же
   * полями. fitAll нужен ТОЛЬКО при закрытии листа (телефон): на узком экране
   * широкий ряд модулей при maxDim·1.6 обрезался бы по бокам.
   *
   * Считаем по 8 углам габарита композиции. Камера смотрит в цель с
   * расстояния R; угол с координатами (x вправо, y вверх, z к камере —
   * всё относительно цели) виден на «тангенсе» x/(R − z) по горизонтали и
   * y/(R − z) по вертикали, а видимая часть допускает не больше
   *   th = tan(fov/2)·(w/h)·k   по горизонтали,
   *   tv = tan(fov/2)·((h − b)/h)·k   по вертикали
   * (w×h — холст, b — закрытая листом часть, k = 1 − 2·INSET_FIT_MARGIN — доля
   * видимой части под композицию, остальное — поля). Отсюда для каждого
   * угла R ≥ |x|/th + z и R ≥ |y|/tv + z; берём максимум. Перспектива
   * несимметрична (ближний край крупнее дальнего), поэтому цель после этого
   * трижды подправляем: сдвигаем на середину проекции и пересчитываем R.
   * Ортографический вид (плоские виды) масштаб берёт из _fitOrtho() по
   * габариту и видимой части — там достаточно поставить цель в центр габарита
   * и сбросить зум; радиус считаем всё равно (для перехода обратно в 3D).
   */
  // inset — высота нижнего листа (px) либо { b, l, r }: низ/лево/право.
  _calcFrame(inset, fitAll) {
    const ins = (inset && typeof inset === 'object') ? inset : { b: inset, l: 0, r: 0 };
    if (!(ins.b > 0) && !(ins.l > 0) && !(ins.r > 0) && !fitAll) return this._calcDefaultFrame();
    const box = this._compositionBox();
    if (!box) return this._calcDefaultFrame();

    const { w, h } = this._canvasCssSize();
    const b = Math.min(ins.b || 0, Math.max(0, h - INSET_MIN_VISIBLE));
    const { l, r } = this._insetPxLR(w, ins.l || 0, ins.r || 0);
    const k = 1 - 2 * INSET_FIT_MARGIN;
    const tanHalf = Math.tan(this.persp.fov * Math.PI / 360);
    const th = tanHalf * ((w - l - r) / h) * k;
    const tv = tanHalf * ((h - b) / h) * k;

    const { right, up, back } = this.controls.basis();
    const corners = [];
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
      }
    }
    const tgt = box.getCenter(new THREE.Vector3());
    const d = new THREE.Vector3();

    // Минимальное расстояние до цели, при котором все углы в рамке.
    const needR = () => {
      let r = 0.15, zMax = -Infinity;
      for (const p of corners) {
        d.subVectors(p, tgt);
        const z = d.dot(back);
        zMax = Math.max(zMax, z);
        r = Math.max(r, Math.abs(d.dot(right)) / th + z, Math.abs(d.dot(up)) / tv + z);
      }
      return Math.max(r, zMax + 0.05);   // ближний угол обязан быть перед камерой
    };

    let R = needR();
    for (let i = 0; i < 3; i++) {
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const p of corners) {
        d.subVectors(p, tgt);
        const dist = Math.max(R - d.dot(back), 0.01);
        const u = d.dot(right) / dist, v = d.dot(up) / dist;
        if (u < u0) u0 = u; if (u > u1) u1 = u;
        if (v < v0) v0 = v; if (v > v1) v1 = v;
      }
      // середина проекции ушла от центра кадра на ((u0+u1)/2, (v0+v1)/2) «тангенсов»
      tgt.addScaledVector(right, (u0 + u1) / 2 * R).addScaledVector(up, (v0 + v1) / 2 * R);
      R = needR();
    }
    R = Math.min(60, Math.max(0.15, R));   // те же границы зума, что в _zoomBy
    if (![R, tgt.x, tgt.y, tgt.z].every(Number.isFinite)) return this._calcDefaultFrame();
    return { radius: R, tx: tgt.x, ty: tgt.y, tz: tgt.z, orthoZoom: 1 };
  }

  _currentFrame() {
    const c = this.controls;
    return { radius: c.radius, tx: c.target.x, ty: c.target.y, tz: c.target.z, orthoZoom: this._orthoZoom };
  }

  // Сразу ставит кадр (расстояние, цель, зум плоских видов).
  _setFrame(f) {
    const c = this.controls;
    c.radius = f.radius;
    c.target.set(f.tx, f.ty, f.tz);
    this._orthoZoom = f.orthoZoom;
    c.update();
    this._fitOrtho();
  }

  _notifyCameraFit() {
    if (typeof this.onCameraFit !== 'function') return;
    // Матрицы камеры обычно обновляются только в renderer.render(); колбэк
    // (например, пересчёт размеров через project()) должен видеть свежий кадр.
    this.camera.updateMatrixWorld(true);
    try { this.onCameraFit(); } catch (e) { /* колбэк интерфейса не должен ронять рендер */ }
  }

  /**
   * Публичный вход: высота нижнего листа в px (0 — листа нет). Зовётся по
   * событию 'modul3d:drawer-inset'. Тот же отступ повторно — ничего не
   * делаем: после подгонки пользователь мог сам покрутить/приблизить сцену,
   * и её нельзя перекадрировать, пока лист не сменит высоту.
   * Открытие/закрытие листа — короткая плавная подгонка (тик крутится в
   * _animate, отдельного rAF нет); если события идут чаще INSET_BURST_MS
   * (лист тянут пальцем) — кадр ставится сразу, без анимации.
   */
  setBottomInset(px) { this.setInsets(px, this._insetL, this._insetR); }

  // Низ/лево/право: сколько px холста закрыто панелями (левый и правый — от
  // краёв окна браузера). undefined = оставить как есть.
  setInsets(bottom, left, right) {
    if (this._broken) return;
    const num = (x, cur) => {
      if (x === undefined || x === null) return cur;
      const n = Math.round(Number(x));
      return n > 0 ? n : 0;
    };
    const b = num(bottom, this._inset);
    // Холст может начинаться не от края окна браузера — вычитаем его сдвиг.
    let rect = null;
    try { rect = this.container.getBoundingClientRect(); } catch (e) { rect = null; }
    const cl = rect ? rect.left : 0;
    const cr = rect ? (window.innerWidth || rect.right) - rect.right : 0;
    const l = left === undefined || left === null ? this._insetL : Math.max(0, num(left, 0) - Math.round(cl));
    const r = right === undefined || right === null ? this._insetR : Math.max(0, num(right, 0) - Math.round(cr));
    if (b === this._inset && l === this._insetL && r === this._insetR) return;
    this._inset = b; this._insetL = l; this._insetR = r;
    // Кадр под панель поставил вьювер — дальше он остаётся на месте при любых правках модели.
    this.controls.userMoved = true;

    // Все панели закрыты (повторный 0 отсеян выше — значит, панель только что
    // закрылась): вписываем ВСЮ композицию в весь экран с теми же полями и
    // углами (в плоских видах — прежний кадр). Иначе — под видимую часть.
    const none = !(b > 0 || l > 0 || r > 0);
    const to = (none && !this.isOrtho) ? this._calcFrame(0, true) : this._calcFrame({ b, l, r });
    const now = nowMs();
    const burst = now - this._insetEventT < INSET_BURST_MS;
    this._insetEventT = now;

    if (to && !burst && !prefersReducedMotion()) {
      // Стартуем с того, что на экране сию секунду (в том числе с середины
      // прерванной подгонки) — рывка нет.
      this._camTween = {
        t0: now, from: this._currentFrame(), to,
        inset0: this._insetShown, inset1: b,
        l0: this._insetLShown, l1: l, r0: this._insetRShown, r1: r,
      };
      return;
    }
    this._camTween = null;
    this._insetShown = b; this._insetLShown = l; this._insetRShown = r;
    this._applyViewOffset();
    if (to) this._setFrame(to);
    else this._fitOrtho();
    this._notifyCameraFit();
  }

  _hasInset() { return this._inset > 0 || this._insetL > 0 || this._insetR > 0; }

  // Подгоняет кадр под ТЕКУЩИЕ панели сразу, без анимации (смена габарита
  // композиции и смена вида, пока панель открыта).
  _refitInset() {
    this._camTween = null;
    this._insetShown = this._inset; this._insetLShown = this._insetL; this._insetRShown = this._insetR;
    this._applyViewOffset();
    const f = this._calcFrame({ b: this._inset, l: this._insetL, r: this._insetR });
    if (f) this._setFrame(f);
    this._notifyCameraFit();
  }

  // Шаг плавной подгонки — из _animate(), раз в кадр.
  _stepCamTween() {
    const tw = this._camTween;
    if (!tw) return;
    const t = Math.min(1, (nowMs() - tw.t0) / INSET_TWEEN_MS);
    if (t >= 1) { this._finishCamTween(); return; }
    const e = 1 - Math.pow(1 - t, 3);   // быстро в начале, мягко к концу
    const L = (a, b) => a + (b - a) * e;
    this._insetShown = L(tw.inset0, tw.inset1);
    this._insetLShown = L(tw.l0, tw.l1);
    this._insetRShown = L(tw.r0, tw.r1);
    this._applyViewOffset();
    this._setFrame({
      radius: L(tw.from.radius, tw.to.radius),
      tx: L(tw.from.tx, tw.to.tx), ty: L(tw.from.ty, tw.to.ty), tz: L(tw.from.tz, tw.to.tz),
      orthoZoom: L(tw.from.orthoZoom, tw.to.orthoZoom),
    });
    if (this.isOrtho) this._notifyCameraFit();
  }

  // Доводит подгонку до конца сразу (конец анимации или пользователь взялся за сцену).
  _finishCamTween() {
    const tw = this._camTween;
    if (!tw) return;
    this._camTween = null;
    this._insetShown = tw.inset1; this._insetLShown = tw.l1; this._insetRShown = tw.r1;
    this._applyViewOffset();
    this._setFrame(tw.to);
    this._notifyCameraFit();
  }

  _animate() {
    if (this._broken) return;
    requestAnimationFrame(() => this._animate());
    if (this._camTween) this._stepCamTween();
    this._updateFloorVisibility();
    // Разметка поверх плоского вида — пересчёт только если камера/холст/сцена
    // изменились с прошлого кадра (сравнение матриц камеры, см. _markupTick).
    this._markupTick();
    this.renderer.render(this.scene, this.camera);
    // Гизма перерисовывается только если что-то изменилось (поворот камеры,
    // наведение, текущий вид, тема) — проверка внутри update().
    if (this.gizmo) this.gizmo.update();
  }

  /** Показать/скрыть навигационную гизму (display:none). */
  setGizmoVisible(visible) {
    if (this.gizmo) this.gizmo.setVisible(!!visible);
  }

  // Пол прозрачный, если включена проверка присадки ИЛИ камера ушла ниже
  // уровня пола (пользователь покрутил вид и смотрит снизу вверх) — иначе
  // сплошная плоскость пола закрывает корпус снизу. Небольшой отрицательный
  // порог (не 0) — чтобы не мерцало ровно на границе при взгляде почти сбоку.
  _updateFloorVisibility() {
    if (!this._floor || !this._floor.material) return;
    // Плоский вид «снизу» — тоже «из-под пола», независимо от радиуса камеры:
    // у ортокамеры зум меняет радиус, и при сильном приближении её позиция
    // может оказаться выше -0.05, а сплошной пол закрыл бы изделие снизу.
    // Сетку в этом виде прячем — линии сетки легли бы поверх днища.
    const flatBottom = this.viewName === 'bottom';
    if (this._grid) this._grid.visible = !flatBottom;
    const below = flatBottom || (this.camera && this.camera.position.y < -0.05);
    // «Прозрачный режим» (xray) делает пол прозрачным так же, как проверка
    // присадки: иначе полупрозрачные детали снизу упирались бы в сплошной пол.
    const seeThrough = !!this._drillCheck || !!this._xray;
    const wantTransparent = seeThrough || below;
    const mat = this._floor.material;
    const targetOpacity = seeThrough ? 0.12 : (below ? 0.1 : 1);
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

  // ---------------------------------------------------------------------------
  // РУЧНАЯ РАЗМЕТКА ПОВЕРХ ПЛОСКИХ ВИДОВ (ядро — markup.js)
  // ---------------------------------------------------------------------------
  // Как это устроено:
  //   • поверх холста лежит прозрачный <svg class="mk-root" data-mk-sheet=
  //     "viewer3d">, 1 единица = 1 CSS px; в нём ядро рисует размеры;
  //   • в плоском виде готовые размеры видны ВСЕГДА, но пока режим разметки
  //     выключен, svg «прозрачен» для мыши (pointer-events:none) — выбор
  //     модуля, панорама и вращение работают как раньше;
  //   • режим включён (setMarkupMode(true) из app.js): svg получает мышь.
  //     ЛКМ — ядру разметки (оно слушает document и находит svg по
  //     evt.target), колесо — зум, протяжка ПКМ (и средней кнопкой) —
  //     панорама, простой щелчок ПКМ — отмена начатого размера. До холста
  //     события не доходят, поэтому ни выбора модуля, ни вращения нет;
  //   • в перспективе ('iso') лист снимается (dropSheet), svg пустой.
  _initMarkupOverlay() {
    this._mkSvg = null;         // сам svg (null — среда без DOM, например tools/)
    this._mkMode = false;       // режим разметки в 3D включён
    this._mkModel = null;       // модель последнего render()
    this._mkRows = [];          // детали, реально нарисованные в сцене
    // Детали, нарисованные в render() ПОЛУПРОЗРАЧНЫМИ (см. _markupSetScene):
    // сквозь них видно, что за ними, поэтому они точки не заслоняют.
    this._mkClearRows = new Set();
    this._mkSeeThrough = false; // прозрачный режим (xray или проверка присадки)
    this._mkDrill = false;      // проверка присадки: ловятся центры отверстий
    this._mkDirty = true;       // сцена/режим изменились — пересобрать оверлей
    this._mkShown = false;      // лист сейчас зарегистрирован в markup.js
    this._mkSig = null;         // «отпечаток» камеры прошлого кадра
    this._mkPan = null;         // идущая панорама ПКМ в режиме разметки
    if (typeof document === 'undefined' || typeof document.createElementNS !== 'function') return;
    let svg = null;
    try { svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); } catch (e) { svg = null; }
    if (!svg || typeof svg.setAttribute !== 'function' || typeof svg.addEventListener !== 'function') return;
    svg.setAttribute('class', 'mk-root mk-3d-overlay');
    svg.setAttribute('data-mk-sheet', MK_SHEET);
    if (svg.style) svg.style.display = 'none';
    this.container.appendChild(svg);
    // Клик фазы «вынос» засчитывается где угодно внутри контейнера с mk-pane.
    if (this.container.classList) this.container.classList.add('mk-pane');
    ensureMkOverlayStyle();
    this._mkSvg = svg;

    // Контекстное меню браузера по ПКМ над оверлеем не нужно.
    svg.addEventListener('contextmenu', (e) => e.preventDefault());

    // ЛКМ в режиме разметки (постановка/перетаскивание размера) — не жест
    // камеры: не пускаем pointerdown дальше, иначе ui-shell.js (Focus Mode,
    // слушает pointerdown на #viewer3d) принял бы протяжку размера за
    // вращение сцены и растворил интерфейс. Ядро markup.js слушает
    // mousedown/mousemove/click на document — это ДРУГИЕ события, их
    // stopPropagation у pointerdown не останавливает (preventDefault не
    // зовём — он бы как раз отменил mousedown).
    // Тач: пинч-зум и двухпальцевая панорама в режиме разметки недоступны
    // (оверлей забирает касания себе, а ядро разметки работает с мышью) —
    // на телефоне для зума режим нужно выключить.
    svg.addEventListener('pointerdown', (e) => {
      if (this._mkMode && e.button === 0) e.stopPropagation();
    });

    // Колесо — тот же зум, что у SimpleOrbitControl (с фокусом под курсором).
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._finishCamTween();
      const c = this.controls;
      const k = 1 + e.deltaY * 0.001;
      const pt = c.zoomPointProvider ? c.zoomPointProvider(e) : null;
      c._zoomBy(k, pt);
      c.update();
    }, { passive: false });

    // ПКМ (и средняя кнопка) — панорама; ЛКМ не трогаем — она у ядра разметки.
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 2 && e.button !== 1) return;
      e.preventDefault();
      this._finishCamTween();
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
      this._mkPan = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, button: e.button };
    });
    svg.addEventListener('pointermove', (e) => {
      const p = this._mkPan;
      if (!p || e.pointerId !== p.id) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      p.moved += Math.abs(dx) + Math.abs(dy);
      if (!dx && !dy) return;
      this.controls.pan(dx, dy);
      this.controls.update();
    });
    const endPan = (e, cancelled) => {
      const p = this._mkPan;
      if (!p || e.pointerId !== p.id) return;
      this._mkPan = null;
      try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* не критично */ }
      // Простой щелчок ПКМ (без протяжки) — отменить начатый размер.
      if (!cancelled && p.button === 2 && p.moved <= SCENE_DRAG_PX) {
        const mk = mkApi();
        if (mk && mk.cancelDraft) mk.cancelDraft();
      }
    };
    svg.addEventListener('pointerup', (e) => endPan(e, false));
    svg.addEventListener('pointercancel', (e) => endPan(e, true));
  }

  /**
   * Режим ручной разметки в 3D (зовёт app.js: syncMarkupUI; true — только в
   * плоском виде). Включён — мышь над сценой принадлежит разметке (см.
   * _initMarkupOverlay), выключен — всё как обычно, размеры просто видны.
   */
  setMarkupMode(on) {
    this._mkMode = !!on;
    if (this._mkSvg) {
      this._mkSvg.setAttribute('class', 'mk-root mk-3d-overlay' + (this._mkMode ? ' mk-3d-on' : ''));
    }
    if (!this._mkMode) this._mkPan = null;
    // Отложенный выбор модуля от щелчка перед включением режима — не нужен.
    if (this._mkMode && this._clickTimer) { clearTimeout(this._clickTimer); this._clickTimer = null; }
    this._mkDirty = true;
  }

  // Из render(): что сейчас нарисовано и в каком режиме.
  // clearRows — Set деталей, которые render() нарисовал полупрозрачными
  // (выбранный модуль, подсветка секции/детали, «Скрыть фасады», стекло):
  // сквозь них видно начинку, поэтому они точки не заслоняют. Весь режим
  // xray/проверки присадки — seeThrough (прозрачно всё).
  _markupSetScene(model, source, hideFacades, isolateModule, seeThrough, drillCheck, clearRows) {
    this._mkModel = model || null;
    this._mkRows = (source || []).filter((row) => row && row.boxes && row.boxes[0]
      && !(isolateModule && row.module !== isolateModule)
      && !(hideFacades && row.kind === 'handle'));
    this._mkClearRows = clearRows || new Set();
    this._mkSeeThrough = !!seeThrough;
    this._mkDrill = !!drillCheck;
    this._mkDirty = true;
  }

  // Раз в кадр (из _animate): пересобрать оверлей, только если что-то
  // изменилось — матрицы камеры (зум, панорама, смена вида, подгонка под
  // лист), размер холста или сцена/режим (_mkDirty).
  _markupTick() {
    if (!this._mkSvg) return;
    const spec = this.isOrtho ? MK_VIEWS[this.viewName] : null;
    if (!spec || !this._mkModel || !mkApi()) {
      if (this._mkShown) this._markupHide();
      return;
    }
    const el = this.renderer.domElement;
    const w = el.clientWidth || 0, h = el.clientHeight || 0;
    if (!w || !h) return;   // холст скрыт — нечего рисовать
    const cam = this.camera;
    cam.updateMatrixWorld();
    if (!this._mkSig) this._mkSig = new Float64Array(35);
    const sig = this._mkSig;
    let changed = this._mkDirty || !this._mkShown;
    const put = (i, v) => { if (sig[i] !== v) { sig[i] = v; changed = true; } };
    put(0, w); put(1, h); put(2, FLAT_VIEWS.indexOf(this.viewName));
    const pe = cam.projectionMatrix.elements, me = cam.matrixWorld.elements;
    for (let i = 0; i < 16; i++) { put(3 + i, pe[i]); put(19 + i, me[i]); }
    if (!changed) return;
    this._mkDirty = false;
    this._markupRebuild(spec, w, h);
  }

  // Снять лист: перспектива, пустая сцена.
  _markupHide() {
    const mk = mkApi();
    if (mk && mk.dropSheet) mk.dropSheet(MK_SHEET);
    if (this._mkSvg) {
      this._mkSvg.innerHTML = '';
      if (this._mkSvg.style) this._mkSvg.style.display = 'none';
    }
    this._mkShown = false;
    this._mkPan = null;
  }

  // Заново зарегистрировать лист в markup.js с текущей проекцией и
  // положить результат в svg.
  _markupRebuild(spec, w, h) {
    const mk = mkApi();
    const ctx = mk && mk.attachSheet ? this._markupCtx(spec) : null;
    if (!ctx) { if (this._mkShown) this._markupHide(); return; }
    let body = '';
    try {
      // Все размеры 3D — в своём листе данных 'view3d' (см. MK_VIEWS и шапку
      // markup.js, «Лист отображения и лист данных»).
      body = mk.attachSheet(MK_SHEET, this._mkModel, [ctx], null,
        { dataSheet: spec.data, external: true });
    } catch (err) {
      console.error('Разметка в 3D: attachSheet не сработал', err);
      this._markupHide();
      return;
    }
    const svg = this._mkSvg;
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    // Прозрачная подложка — чтобы щелчок по пустому месту тоже попадал в svg.
    svg.innerHTML = `<rect class="mk-3d-bg" x="0" y="0" width="${w}" height="${h}" fill="transparent"/>` + body;
    if (svg.style) svg.style.display = '';
    this._mkShown = true;
    // Готовые размеры уже в body (их нарисовал attachSheet) — второй раз не
    // рисуем; refreshSheet нужен только «живому» слою (наведение/вынос по
    // последней позиции курсора) и скрытию перетаскиваемого размера.
    if (mk.refreshSheet) mk.refreshSheet(MK_SHEET, { skipFinished: true });
  }

  // Контекст вида для markup.js (формат — шапка markup.js, «3D-ОВЕРЛЕЙ»).
  // Координаты — мм модели, те же, что у model.partsRaw[].boxes и чертежей.
  _markupCtx(spec) {
    const H = spec.h, V = spec.v;
    // Ортокамера смотрит строго вдоль мировой оси: экранный X зависит только
    // от координаты по оси H, экранный Y — только по оси V, и линейно.
    // Берём проекцию начала координат и точки в 1000 мм по каждой оси.
    const at = (ax) => this.project(ax === 'x' ? 1000 : 0, ax === 'y' ? 1000 : 0, ax === 'z' ? 1000 : 0);
    const o = this.project(0, 0, 0);
    const kx = (at(H).x - o.x) / 1000;
    const ky = (at(V).y - o.y) / 1000;
    if (![o.x, o.y, kx, ky].every(Number.isFinite) || !kx || !ky) return null;
    const sx = (mm) => o.x + kx * mm;
    const sy = (mm) => o.y + ky * mm;

    // Прямоугольник каждой детали на экране (в мм вдоль осей вида), глубина
    // её ближней к зрителю грани (near) и дальней, противоположной (far —
    // near + толщина бокса вдоль взгляда; нужна только прозрачному режиму).
    // Заслоняет только то, что на экране
    // НЕПРОЗРАЧНОЕ: не детали из _mkClearRows (render() нарисовал их
    // полупрозрачными — стекло, фасады при «Скрыть фасады», выбранный модуль,
    // бирюзовая подсветка секции/детали/отсека) и не фурнитура (опоры/ручки
    // — их бокс сильно больше самой детали).
    const info = new Map();
    const occluders = [];
    const clear = this._mkClearRows;
    for (const row of this._mkRows) {
      const b = row.boxes[0];
      const hs = mkSize(b, H), vs = mkSize(b, V);
      const it = {
        row, near: spec.near(b), far: spec.near(b) + mkSize(b, spec.d),
        h0: b[H] - hs / 2, h1: b[H] + hs / 2, v0: b[V] - vs / 2, v1: b[V] + vs / 2,
      };
      if (![it.near, it.far, it.h0, it.h1, it.v0, it.v1].every(Number.isFinite)) continue;
      info.set(row, it);
      const seeThrough = row.glass || row.hardware || (row.shape && row.shape !== 'box')
        || clear.has(row);
      if (!seeThrough) occluders.push(it);
    }
    occluders.sort((a, b) => a.near - b.near);   // от ближних к дальним

    // Габарит нарисованных деталей вдоль осей вида (мм) — для offsetOutside.
    const ext = { ok: false, h: { min: Infinity, max: -Infinity }, v: { min: Infinity, max: -Infinity } };
    for (const it of info.values()) {
      if (it.row.hardware) continue;
      ext.h.min = Math.min(ext.h.min, it.h0); ext.h.max = Math.max(ext.h.max, it.h1);
      ext.v.min = Math.min(ext.v.min, it.v0); ext.v.max = Math.max(ext.v.max, it.v1);
      ext.ok = true;
    }

    const xray = this._mkSeeThrough;
    const depthOf = (row) => { const it = info.get(row); return it ? it.near : 0; };
    const pickFilter = (row, wh, wv, kind, draftAnchor) => {
      const it = info.get(row);
      if (!it) return false;
      if (xray) {
        // Прозрачный режим: ловится любая точка в любой плоскости (решение
        // пользователя 2026-10-04: ограничение «общая плоскость» снято).
        return true;
      }
      // Обычный режим: точку не должна заслонять более близкая деталь,
      // чья проекция содержит её строго внутри (общие рёбра — не перекрытие).
      for (const oc of occluders) {
        if (oc.near >= it.near - MK_EPS) break;   // дальше уже не ближе нашей грани
        if (oc.row === row) continue;
        if (wh > oc.h0 + MK_EPS && wh < oc.h1 - MK_EPS && wv > oc.v0 + MK_EPS && wv < oc.v1 - MK_EPS) return false;
      }
      return true;
    };

    return {
      name: spec.name, hAxis: H, vAxis: V, sx, sy,
      rows: this._mkRows,
      // Центры отверстий — только при «Проверке присадки»; экранные
      // координаты считает drawings.resolveHoleScreen (ядро само его зовёт).
      noHoles: !(this._mkDrill || xray),
      // Отверстие на ЛЮБОМ ортогональном виде: устье (x, y, wh, wv) и дно
      // (end) — проекция мировых точек из render(). На виде «в лицо» они
      // совпадают, на виде сбоку — концы полоски отверстия.
      holeScreen: (row, i) => {
        const g = this._mkHoleGeo && this._mkHoleGeo.get(row);
        const p = g && g[i];
        if (!p) return null;
        const pt = (q) => ({ x: sx(q[H]), y: sy(q[V]), wh: q[H], wv: q[V] });
        const m = pt(p.m);
        m.end = pt(p.e);
        return m;
      },
      pickFilter, depthOf,
      // Вынос размерной линии за габаритом деталей вида — в постоянных
      // экранных px от края габарита (зазор от края изделия не зависит от
      // зума); внутри габарита — обычная проекция. Габарит — без фурнитуры
      // (её бокс больше самой детали, см. выше).
      offsetOutside: ext.ok ? { K: MK_OFFSET_PX_PER_MM, h: ext.h, v: ext.v } : null,
    };
  }

  /**
   * Предустановка камеры: 'front' (спереди) | 'side' (справа) | 'left' (слева) |
   * 'back' (сзади) | 'top' (сверху) | 'bottom' (снизу) | 'iso' (3D, перспектива).
   * Все, кроме 'iso', — ортографические. Неизвестное имя = 'iso'.
   * Колбэк onViewChange отсюда НЕ вызывается (см. комментарий у поля).
   */
  setView(name) {
    if (this._broken) return;
    if (name !== 'iso' && FLAT_VIEWS.indexOf(name) < 0) name = 'iso';
    this.isOrtho = (name !== 'iso');
    this.viewName = name;
    this.camera = this.isOrtho ? this.ortho : this.persp;
    this.controls.camera = this.camera;
    this._fitOrtho();
    this.controls.setView(name);
    this._resize();
    // Под нижним листом смена вида — явная команда «покажи так»: кадр
    // подгоняем под видимую часть заново, уже с новыми углами.
    if (this._hasInset()) this._refitInset();
  }

  /**
   * Единая точка уведомления интерфейса о смене вида ЖЕСТОМ пользователя
   * (гизма или вращение сцены из плоского вида). setView() её не зовёт.
   */
  _notifyViewChange(name) {
    if (typeof this.onViewChange === 'function') this.onViewChange(name);
  }

  /**
   * Переход из плоского (ортографического) вида в 3D-перспективу БЕЗ сброса
   * углов камеры — нужен гизме и вращению сцены: пользователь потянул из вида «спереди», и
   * сцена должна плавно поехать от текущего ракурса, а не прыгнуть в 'iso'.
   * Возвращает true, если переключение действительно произошло.
   */
  _enterPerspectiveKeepAngles() {
    if (this._broken || !this.isOrtho) return false;
    this.isOrtho = false;
    this.viewName = 'iso';
    this.camera = this.persp;
    this.controls.camera = this.persp;
    this.controls.update();   // ставит позицию/up/lookAt перспективной камеры по тем же theta/phi
    this._resize();
    return true;
  }

  // Подгоняет рамку ортокамеры под габарит изделия В ТЕКУЩЕМ виде:
  // спереди/сзади — ширина×высота, справа/слева — глубина×высота,
  // сверху/снизу — ширина×глубина.
  // По наибольшему габариту считать нельзя: план высокого шкафа выходил мелким.
  _fitOrtho() {
    if (!this._lastDims) return;
    // Пустой проект: габарит нулевой — берём условную рамку, иначе рамка
    // схлопывается и вид ломается.
    const W = this._lastDims.W || 1000;
    const H = this._lastDims.H || 1000;
    const D = this._lastDims.D || 1000;
    const el = this.renderer.domElement;
    const chPx = el.clientHeight || 1;
    const aspect = (el.clientWidth || 1) / chPx;
    // Нижний лист (телефон): рамка камеры остаётся размером со ВЕСЬ холст (так
    // работает сдвиг проекции, см. _applyViewOffset), а габарит должен влезть
    // в ВИДИМУЮ часть — её высота visH и пропорции visAspect. Без листа
    // visH = chPx, visAspect = aspect, множитель = 1: формулы прежние.
    const visH = Math.max(chPx - this._insetPx(chPx), 1);
    const lr = this._insetPxLR(el.clientWidth || 1);
    const visAspect = Math.max((el.clientWidth || 1) - lr.l - lr.r, 1) / visH;   // боковые панели сужают видимую часть
    const vn = this.viewName;
    const ext = (vn === 'side' || vn === 'left')  ? { w: D, h: H }
              : (vn === 'top'  || vn === 'bottom') ? { w: W, h: D }
              : { w: W, h: H };
    // рамку берём по большей из потребностей с учётом пропорций окна
    const need = Math.max(ext.h, ext.w / Math.max(visAspect, 0.01));
    const span = need * MM * 1.2 / (this._orthoZoom || 1) * (chPx / visH);
    let hw = span * aspect / 2, hh = span / 2;
    this.ortho.left = -hw; this.ortho.right = hw;
    this.ortho.top = hh; this.ortho.bottom = -hh;
    this.ortho.updateProjectionMatrix();
  }

  /**
   * Сбрасывает кэш геометрии деталей и освобождает её память на видеокарте.
   * Вызывать ТОЛЬКО когда в сцене нет мешей с этой геометрией (сразу после
   * очистки группы в render()).
   */
  _clearPartGeoCache() {
    for (const entry of this._partGeoCache.values()) {
      for (const g of entry.partGeos) disposeRes(g);
      for (const g of entry.cutEdgeGeos) disposeRes(g);
      disposeRes(entry.outlineEdges);
    }
    this._partGeoCache.clear();
  }

  /**
   * Для отладки из консоли браузера: сколько геометрий/текстур сейчас
   * загружено на видеокарту (renderer.info.memory) и сколько шейдерных
   * программ. Если после нескольких пересчётов числа растут без конца —
   * где-то снова утекает память.
   */
  memoryInfo() {
    if (!this.renderer || !this.renderer.info) return null;
    const info = this.renderer.info;
    return {
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs ? info.programs.length : 0,
      partGeoCache: this._partGeoCache ? this._partGeoCache.size : 0,
    };
  }

  /**
   * Перестраивает сцену из parts, вычисленных Parametric Core Engine.
   * @param {object} opts.hideFacades — скрыть двери и фасады ящиков, показав
   *   только корпус (боковины, дно, крыша, стойки, полки, задняя стенка).
   *   Скрытие только визуальное: деталировка и спецификация не меняются.
   */
  render(model, opts) {
    if (this._broken) return;
    this._compCache = null;   // сцену пересоберём — габарит композиции для подгонки под лист пересчитается
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
    // «Прозрачный режим»: ВСЕ детали всех модулей (корпус, фасады, полки,
    // столешницы, опоры, ручки и т.п.) полупрозрачные — та же прозрачность,
    // что у корпуса в проверке присадки (0.22, без записи в буфер глубины).
    // В отличие от drillCheck, метки присадки НЕ показываются — они зависят
    // только от drillCheck. Материалы создаются заново при каждом render(),
    // поэтому при выключении режима детали сразу снова непрозрачные; кэш
    // геометрии (_partGeoCache) от прозрачности не зависит.
    const xray = !!(opts && opts.xray);
    this._xray = xray;
    // Подсказка осей (см. блок с opts.axisHintRow ниже) отдаёт мировые
    // координаты наружу — сбрасываем перед пересчётом, иначе после того как
    // деталь убрали с экрана «Деталь», здесь остались бы устаревшие данные.
    this._axisHint = null;
    this._updateFloorVisibility();
    const highlight = opts && opts.highlightModule;
    // Подсветка секции (клик по фасаду в Focus Mode → «Редактировать
    // секцию»): { module, sectionIndex } либо null. Красим бирюзовым только
    // фасады (двери/ящики) этой секции — см. isSectionHi ниже в цикле.
    const sectionHi = (opts && opts.highlightSection) || null;
    // Режим изоляции (двойной клик по модулю, см. dblclick-обработчик выше):
    // имя модуля, который остаётся «живым», все остальные — притушены.
    // Запоминаем в поле экземпляра — pointerup-обработчик читает его, чтобы
    // понять, что клик пришёлся внутрь изолированного модуля.
    const isolateModule = (opts && opts.isolateModule) || null;
    this._isolateModule = isolateModule;
    // Старую сцену не только убираем из группы, но и освобождаем её память
    // на видеокарте (геометрия/материалы/клоны текстур этой перестройки).
    // Общие ресурсы (кэши, текстура «под древесину») disposeObjectTree
    // пропускает — см. markShared.
    disposeObjectTree(this.group);
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    // Кэш геометрии деталей разросся (много разных форм за сессию) —
    // сбрасываем его ЗДЕСЬ, когда старые меши уже убраны и его геометрию
    // никто в сцене не использует: тогда её можно честно освободить.
    // Раньше кэш просто очищался (clear) посреди перестройки — и вся
    // сброшенная геометрия оставалась висеть на видеокарте.
    if (this._partGeoCache.size > 300) this._clearPartGeoCache();

    const { W, H, D } = model.dims;
    // Рисуем из несклеенного списка: у него каждая деталь знает свой модуль,
    // поэтому активный модуль можно подсветить отдельным цветом.
    const source = model.partsRaw || model.parts;
    // КЛЮЧ ДЕТАЛИ ДЛЯ КЛИКА (mesh.userData.partKey). engine.js кладёт каждой
    // детали строковый grainKey (уникален в пределах модуля) — по нему
    // app.js открывает экран «Деталь» ровно для кликнутой детали, а не для
    // «первой полки/ящика подходящего вида». Но у СКЛЕЕННЫХ строк model.parts
    // grainKey принадлежит только первой склеенной детали, поэтому берём его
    // из несклеенного partsRaw. Связь — сам объект box: и partsRaw, и склейка
    // хранят ту же ссылку (engine.js: boxes: [part.box] / _boxes.push(part.box)),
    // мы строим меш именно по этому box. Карта строится один раз за рендер.
    // Обычный случай (source === partsRaw) — строка и есть «сырая», её ключ
    // берётся напрямую; карта нужна только запасному пути на model.parts.
    const rawByBox = new Map();
    if (model.partsRaw) {
      for (const r of model.partsRaw) {
        const b = (r.boxes && r.boxes[0]) || r.box;
        if (b) rawByBox.set(b, r);
      }
    }
    const partKeyOf = (row, box) => {
      const raw = rawByBox.get(box) || (source === model.partsRaw ? row : null);
      return (raw && raw.grainKey) || null;
    };
    // targetZoneIndex не зависит от конкретной детали (row) — вынесен из
    // цикла ниже (раньше пересчитывался на каждой строке одинаково).
    const targetZoneIndex = sectionHi && Number.isFinite(sectionHi.zoneIndex) ? sectionHi.zoneIndex : null;
    // Подсветка отсека БЕЗ фасада (facade:'open' или ниша под встроенную
    // технику — engine.js для такой зоны не строит ни двери, ни фасада
    // ящика вовсе): обычная isSectionHi ниже требует именно фасад и в этом
    // случае никогда не сработает — пользователь не увидел бы, какой отсек
    // сейчас открыт в редакторе. Проверяем один раз ДО цикла — есть ли у
    // выбранного отсека вообще хоть один фасад в модели — и если нет,
    // считаем границы отсека (_computeSectionHiBounds), чтобы вместо
    // фасада подсветить его содержимое (см. isSectionContentHi в цикле).
    let sectionHiBounds = null;
    if (sectionHi) {
      const hasFacade = source.some((row) => (row.kind === 'door' || row.kind === 'drawerFront')
        && row.module === sectionHi.module
        && Number.isFinite(row.sectionIndex) && row.sectionIndex === sectionHi.sectionIndex
        && (targetZoneIndex === null ? !Number.isFinite(row.zoneIndex)
          : (Number.isFinite(row.zoneIndex) && row.zoneIndex === targetZoneIndex)));
      if (!hasFacade) sectionHiBounds = this._computeSectionHiBounds(source, sectionHi, targetZoneIndex);
    }
    const mkClearRows = new Set();   // полупрозрачные детали — для _markupSetScene
    const mkHoleGeo = new Map();     // деталь → [{устье, дно}] отверстий в мировых мм (разметка 3D)
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
      // Теперь этот же флаг включает «Прозрачный режим» (xray) у опор, ручек,
      // штанг, фланцев и полкодержателей — прозрачность у них та же, 0.22.
      const dimmed = xray;
      const ghostLike = ghost;
      const glass = !!row.glass;                 // стекло рисуем прозрачным
      // row.glass один и тот же флаг у сплошного стеклянного фасада (GLASS-4,
      // facadeType glass4) и у стеклянной полки за таким фасадом (GLASS-6,
      // engine.js glassShelf) — их нужно красить РАЗНО: полка остаётся
      // прозрачно-голубоватой (обычное прозрачное стекло), а фасад — тёплым
      // бронзовым (см. GLASS4_COLOR), чтобы дверь была заметна.
      const glassFacade = glass && isFacade;
      const framed = (row.frameW || 0) > 0 && row.facadeType !== 'mdfMilled';
      const milled = row.facadeType === 'mdfMilled';   // фрезеровка на пласти
      const isActive = highlight && row.module === highlight;
      // Эта деталь — фасад секции, выбранной для редактирования: подсвечиваем
      // её бирюзовой заливкой (см. mat/makeFramedFacade ниже). Ручки под
      // isSectionHi НЕ подпадают (makeHandle его не принимает) — они должны
      // остаться металлическими.
      // sectionIndex один на всю секцию (и её отсеки, и её ящики) — этого
      // достаточно, ПОКА в секции нет нескольких отсеков двери по высоте
      // («Разделить на отсеки», engine.js zonesRaw). Если отсек
      // выбран (sectionHi.zoneIndex — число), подсвечивать нужно ТОЛЬКО его
      // дверь, а не всю стопку отсеков секции — иначе бирюзовым красится
      // сразу весь пенал. У ящиков (kind:'drawerFront') zoneIndex не бывает
      // (engine.js его не проставляет) — они подсвечиваются все вместе, как
      // единый набор фасадов секции, когда выбрана именно секция без отсеков.
      // (targetZoneIndex вычислен один раз до цикла — см. выше.)
      const isSectionHi = !!(sectionHi && isFacade && row.module === sectionHi.module
        && Number.isFinite(row.sectionIndex) && row.sectionIndex === sectionHi.sectionIndex
        && (targetZoneIndex === null ? !Number.isFinite(row.zoneIndex)
          : (Number.isFinite(row.zoneIndex) && row.zoneIndex === targetZoneIndex)));
      // Эта деталь — та самая «сырая» деталь, которую сейчас показывает экран
      // «Деталь» (боковина/дно/крыша/задняя стенка/цоколь/дверь-как-деталь).
      // opts.axisHintRow — ссылка на объект model.partsRaw, её же использует
      // подсказка осей ниже по циклу. В отличие от isSectionHi, здесь НЕ
      // проверяем isFacade — обычные детали корпуса тоже должны подсвечиваться.
      const isPartHi = !!(opts && opts.axisHintRow && row === opts.axisHintRow);
      // Подсветка НАПОЛНЕНИЯ отсека без фасада (см. sectionHiBounds перед
      // циклом) — вместо фасада подсвечиваем то, что физически лежит внутри
      // границ отсека (полки и т.п.), кроме деталей без одного владельца-
      // отсека (см. SECTION_SCOPED_EXCLUDE). Границы — включительно с обеих
      // сторон: несъёмные полки-перегородки, которые и размечают отсек по
      // высоте, лежат РОВНО на границе и должны попасть в подсветку сами.
      const isSectionContentHi = !!(sectionHiBounds && row.module === sectionHiBounds.module
        && !SECTION_SCOPED_EXCLUDE.has(row.kind)
        && (sectionHiBounds.widthAxis === 'z' ? row.box.z : row.box.x) >= sectionHiBounds.secLeft
        && (sectionHiBounds.widthAxis === 'z' ? row.box.z : row.box.x) <= sectionHiBounds.secRight
        && row.box.y >= sectionHiBounds.zoneLow && row.box.y <= sectionHiBounds.zoneHigh);
      // Единственная переменная, от которой зависит бирюзовая заливка ниже:
      // логическое ИЛИ подсветки фасада секции, подсветки отдельной детали
      // (экран «Деталь») и подсветки наполнения отсека без фасада.
      const hiCyan = isSectionHi || isPartHi || isSectionContentHi;
      // Для разметки поверх плоских видов: деталь рисуется полупрозрачной
      // (те же условия, что transparent у материалов ниже, кроме общих
      // режимов drillCheck/xray — они передаются отдельно) — точки за ней
      // она не заслоняет (см. _markupCtx).
      if (hiCyan || ghostLike || glass || isActive) mkClearRows.add(row);
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
            // row.rot — поворот модуля в прогоне/сборке (0/90/180/270,
            // см. engine.js part.rot) — клипсе он нужен, чтобы разворачиваться
            // вместе с модулем; у металлической опоры (makeLeg) он не нужен —
            // её площадка 4-кратно симметрична, поворот на ней незаметен.
            ? makeKitchenLeg(box, row.module, isActive, !!row.hasClip, dimmed, row.rot || 0)
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
              transparent: dimmed || isActive,
              opacity: dimmed ? 0.22 : (isActive ? ACTIVE_MODULE_OPACITY : 1),
              depthWrite: !(dimmed || isActive),
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
          // xray делает рамочный фасад полупрозрачным так же, как «Скрыть фасады».
          const framedMesh = makeFramedFacade(box, row, isActive, ghostLike || xray, hiCyan,
            drillCheck, drillOnly);
          // partKey — как у обычных деталей ниже. userData.kind у рамочного
          // фасада нет (так было и раньше), поэтому клик по нему в изоляции
          // пока идёт в onFocusMiss, а не в onSelectPart; ключ лежит «про запас».
          framedMesh.userData.partKey = partKeyOf(row, box);
          this.group.add(framedMesh);
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
      // Описание детали в системе координат её пласти: размеры пласти, куда
      // смотрит лицо и все вырезы (отверстия в пласть, лунки в торец, пазы).
      // Считает slabCutsForPart() — та же функция, по которой прогон
      // tools/viewer.js проверяет присадку каждой детали.
      const cuts = slabCutsForPart(row, locW, locD);
      const planeIsX = cuts.planeIsX;      // боковина (тонкая по X)
      const planeIsY = cuts.planeIsY;      // дно/полка (тонкая по Y)
      const uSize = cuts.uSize, vSize = cuts.vSize, tSize = cuts.tSize;
      const frontIsPlus = cuts.frontIsPlus, lenIsU = cuts.lenIsU;
      const toU = cuts.toU, toV = cuts.toV;
      const faceHoles = cuts.holes;        // отверстия в пласть
      const edgeHoles = cuts.edgeHoles;    // отверстия в торец
      const slabGrooves = cuts.grooves;    // пазы
      const slabNotches = cuts.notches;    // сквозные вырезы у кромки

      // Материал по типу детали: ЛДСП — с текстурой «под древесину»,
      // МДФ в плёнке/эмали — гладкий и глянцевый, стекло — прозрачное.
      const isMdf = row.facadeType === 'mdf' || row.facadeType === 'mdfMilled';
      // Текстуру «под древесину» кладём только на древесные декоры: на белом
      // и чёрном ЛДСП её быть не должно.
      const ldspLike = !glass && !isMdf && (look ? look.wood : true);
      // Подсветка секции/детали — приоритет НАД декором/isActive/ghost/
      // drillCheck: если эта деталь — фасад выбранной секции ИЛИ конкретная
      // деталь, открытая на экране «Деталь», красим её бирюзовым и никакую
      // текстуру/другой оттенок сверху не кладём.
      // В прозрачном режиме (xray) текстуры не нужны — только контуры: так
      // процессор/видеокарта не тянут плитки и их клоны.
      const tex = ((ldspLike || (look && look.tile && !glass)) && !isActive && !hiCyan && !xray)
        ? (look && look.tile ? tileTexture(look.tile) : woodTexture()) : null;
      // Размер плитки в метрах детали: у woodTexture() — WOOD_TILE_M, у настоящей
      // плитки листа — её реальный размер (1300 мм), чтобы масштаб рисунка был 1:1.
      const tileM = (look && look.tile && tex) ? look.tile.tileMM * MM : WOOD_TILE_M;
      // Плитка — не обязательно квадрат: у F206 это лист целиком (2800×1300 мм), tileMM2 — размер по y.
      const tileM2 = (look && look.tile && tex && look.tile.tileMM2) ? look.tile.tileMM2 * MM : tileM;
      // Волокно вдоль v пласти (а не вдоль u, как рисует woodTexture) — тогда
      // UV геометрии переставляются (uvSwap ниже), а offset в цикле по boxes
      // получает ту же перестановку. Без grainAxis (белый/МДФ/стекло и т.п.)
      // остаётся false — всё как раньше.
      const grainV = !!tex && grainRunsAlongV(row.grainAxis, planeIsX, planeIsY);
      const mat = new THREE.MeshStandardMaterial({
        color: hiCyan ? SECTION_HI_COLOR
          : (glassFacade ? GLASS4_COLOR : (glass ? 0xbfe3ea : (xray ? 0x7fb0d8 : ((look && look.tile && tex) ? tileColor(look.tile.k) : (isMdf ? (isActive ? 0x7fb0d8 : 0xf2efe9) : color))))),
        map: tex || null,
        roughness: glass ? 0.1 : (isMdf ? 0.12 : 0.75),
        metalness: isMdf ? 0.05 : 0.02,
        emissive: hiCyan ? SECTION_HI_EMISSIVE : ((isActive || xray) ? 0x14314a : 0x000000),
        // xray — та же прозрачность, что и в drillCheck (стекло остаётся
        // со своей, оно и так прозрачное; подсветка — со своей).
        transparent: hiCyan || ghostLike || glass || drillCheck || xray || isActive,
        opacity: hiCyan ? SECTION_HI_OPACITY
          : (ghostLike ? 0.22 : (glassFacade ? GLASS4_OPACITY
            : (glass ? 0.35 : ((drillCheck || xray) ? 0.22 : (isActive ? ACTIVE_MODULE_OPACITY : 1))))),
        depthWrite: !(hiCyan || ghostLike || glass || drillCheck || xray || isActive),
      });
      const tileMat = !!(look && look.tile && tex);
      if (tileMat) applyTileFlip(mat, look.tile.mode);
      if (tex) {
        mat.map = tex.clone();
        mat.map.needsUpdate = true;
        mat.map.wrapS = tex.wrapS;
        mat.map.wrapT = tex.wrapT;
        // Текстура — обычное повторяющееся полотно, UV не привязан к форме
        // выреза: ставим его напрямую по «сырым» координатам пласти (см.
        // spec.uv в buildSlabGeometry) — 1 тайл = WOOD_TILE_M метров
        // детали, густота волокна (линий на мм) одинакова у любой детали
        // независимо от размера, как и должно быть у одной породы.
        // offset (фаза узора относительно корпуса) выставляется ниже, в
        // цикле по row.boxes — woodUvOrigin(), — там известно положение
        // конкретной детали в корпусе.
        mat.map.repeat.set(1 / tileM, 1 / tileM2);
      }
      // Кэш геометрии детали (см. this._partGeoCache в конструкторе):
      // одинаковые по размеру пласти и присадке детали (несколько ящиков/
      // полок одной ширины в проекте — обычное дело) строить заново незачем,
      // а переключение «Проверка присадки» саму геометрию вообще не меняет
      // (только метки и прозрачность материала) — ключ ловит оба случая.
      // orientKey обязателен: разные ориентации (боковина/горизонталь/фасад)
      // могут случайно совпасть по (uSize,vSize,tSize), но разворачиваются
      // в мировые оси по-разному.
      const orientKey = planeIsX ? 'x' : (planeIsY ? 'y' : 'z');
      // Ключ по вырезам: перечисляем ровно те числа, от которых зависит
      // форма детали (раньше тут были матрицы CSG-инструментов).
      const cutsKey = faceHoles
        .map((h) => `h${h.u.toFixed(2)},${h.v.toFixed(2)},${h.r.toFixed(2)},${h.dir},${h.depth.toFixed(2)},${h.through ? 1 : 0}`)
        .concat(edgeHoles.map((h) => `e${h.alongU ? 1 : 0}${h.atStart ? 's' : 'e'},${h.uPos.toFixed(2)},${h.vPos.toFixed(2)},${h.r.toFixed(2)},${h.len.toFixed(2)}`))
        .concat(slabGrooves.map((g) => `g${g.u0.toFixed(2)},${g.v0.toFixed(2)},${g.u1.toFixed(2)},${g.v1.toFixed(2)},${g.depth.toFixed(2)},${g.dir}`))
        .concat(slabNotches.map((n) => `n${n.u0.toFixed(2)},${n.v0.toFixed(2)},${n.u1.toFixed(2)},${n.v1.toFixed(2)}`))
        .sort().join('|');
      // Направление волокна входит в ключ: от него зависит UV геометрии
      // (u↔v), и две детали одного размера с разным волокном не должны
      // делить одну геометрию.
      const geoKey = `${orientKey}|${uSize.toFixed(2)}|${vSize.toFixed(2)}|${tSize.toFixed(2)}|${cutsKey}|tex:${tex ? (grainV ? 2 : 1) : 0}`;
      const cachedGeo = this._partGeoCache.get(geoKey);
      let partGeos, cutEdgeGeos, outlineEdges;
      if (cachedGeo) {
        partGeos = cachedGeo.partGeos;
        cutEdgeGeos = cachedGeo.cutEdgeGeos;
        outlineEdges = cachedGeo.outlineEdges;
      } else {
        cutEdgeGeos = [];
        let finalGeo = null;
        let outlinePos = null;
        try {
          // Аналитическая сборка детали: пласти с ячейками вокруг отверстий,
          // стенки и дно лунок, торцы, пазы — и сразу линии контура по тем
          // же кольцам, так что окружность рисуется ровно по граням выреза.
          const built = buildSlabGeometry({
            uSize, vSize, tSize,
            holes: faceHoles, edgeHoles, grooves: slabGrooves, notches: slabNotches,
            uv: !!tex, uvSwap: grainV,
          });
          if (built.geometry.attributes.position.count) {
            finalGeo = built.geometry;
            outlinePos = built.outline;
          }
        } catch (err) {
          finalGeo = null;
        }
        if (finalGeo) {
          // Разворот в мировые оси. Ориентация ФИКСИРОВАНА: «лицо» детали
          // смотрит в +X у боковин, в +Y у горизонтальных деталей и в +Z у
          // фасадов. С какой стороны вырез — решает его собственный dir
          // (см. выше), а не разворот детали.
          if (planeIsX) finalGeo.rotateY(-Math.PI / 2);        // u → +Z, толщина → +X
          else if (planeIsY) finalGeo.rotateX(Math.PI / 2);    // v → +Z, толщина → +Y
        } else {
          // Запасной путь на случай неожиданной ошибки сборки — обычный куб
          // уже в мировых осях (без разворота planeIsX/Y, он тут не нужен),
          // контур по нему же, чтобы линии не потерялись вместе с вырезами.
          finalGeo = new THREE.BoxGeometry(
            Math.max(locW * MM, 0.001), Math.max(row.box.h * MM, 0.001), Math.max(locD * MM, 0.001)
          );
          outlinePos = slabBoxOutline(uSize, vSize, tSize);
        }
        partGeos = [finalGeo];
        // Контур — НЕ EdgesGeometry(finalGeo): у пласти с ячейками вокруг
        // отверстий полно внутренних рёбер (границы ячеек и полос), и
        // EdgesGeometry нарисовала бы их все. Вместо этого контур собран в
        // buildSlabGeometry по точным точкам: прямоугольник короба детали
        // плюс кольцо/прямоугольник ровно там, где вырез открывается на
        // поверхность, вершина в вершину с самой геометрией.
        // outlinePos построен в ЛОКАЛЬНОЙ системе пласти (u,v,толщина=z) — той
        // же, в которой finalGeo был ДО разворота в мировые оси; разворачиваем
        // контур той же матрицей (и в запасном пути тоже — там finalGeo уже в
        // мировых осях, а контур ещё нет).
        const outlineGeo = new THREE.BufferGeometry();
        outlineGeo.setAttribute('position', new THREE.Float32BufferAttribute(outlinePos, 3));
        if (planeIsX) outlineGeo.rotateY(-Math.PI / 2);
        else if (planeIsY) outlineGeo.rotateX(Math.PI / 2);
        outlineEdges = outlineGeo;
        // Кэш растёт, пока в сессии не наберётся МНОГО разных форм деталей
        // (десятки проектов подряд) — грубая защита от неограниченного роста,
        // не точная LRU-политика: сброс (с освобождением памяти) делается в
        // начале следующей перестройки, см. _clearPartGeoCache.
        // Геометрия кэша живёт между перестройками — помечаем её общей,
        // чтобы очистка сцены её не освобождала.
        for (const pg of partGeos) markShared(pg);
        for (const ce of cutEdgeGeos) markShared(ce);
        markShared(outlineEdges);
        this._partGeoCache.set(geoKey, { partGeos, cutEdgeGeos, outlineEdges });
      }

      for (const box of row.boxes) {
        const mesh = new THREE.Group();
        // Смещаем UV древесной текстуры на положение ИМЕННО ЭТОЙ детали в
        // корпусе (см. woodUvOrigin выше) — иначе у деталей одного размера
        // с разным положением в корпусе (например, у пары дверей) фаза
        // узора совпадала бы один в один и рвалась на стыке между ними.
        // Обычный случай — один box на строку, тогда безопасно двигать
        // offset самого mat.map (это и так отдельный клон текстуры на всю
        // строку, см. выше). Но mergeEqualParts может свести несколько
        // одинаковых деталей (например, зеркальную пару дверей) в одну
        // строку с несколькими box — им нужен уже СВОЙ клон текстуры на
        // каждый, иначе все они делят один offset и в кадре остаётся
        // фаза только последней по циклу детали.
        let boxMat = mat;
        if (tex) {
          // grainV — те же перестановка u↔v, что и в UV геометрии (иначе шов).
          const origin = woodUvOrigin(box, rotDeg, planeIsX, planeIsY, grainV);
          if (row.boxes.length > 1) {
            boxMat = mat.clone();
            if (tileMat) applyTileFlip(boxMat, look.tile.mode);
            boxMat.map = mat.map.clone();
            boxMat.map.needsUpdate = true;
          }
          if (look.tile.sheet) {
            // Плитка — лист целиком: деталь «вырезана» из него в случайном месте (по хэшу
            // положения), в пределах листа рисунок не зеркалится. UV детали центрованы
            // (±половина размера), поэтому половину размера добавляем в фазу — граница
            // ячейки (зеркало) уходит на край детали, а не в её середину.
            const hu = (grainV ? vSize : uSize) * MM / 2, hv = (grainV ? uSize : vSize) * MM / 2;
            const hs = (a) => { const x = Math.sin(a * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
            const fu = Math.max(0, tileM - 2 * hu), fv = Math.max(0, tileM2 - 2 * hv);
            boxMat.map.offset.set((hu + fu * hs(origin.u + 3.1 * origin.v + 1)) / tileM,
              (hv + fv * hs(origin.v + 5.7 * origin.u + 2)) / tileM2);
          } else {
            boxMat.map.offset.set(origin.u / tileM, origin.v / tileM2);
          }
        }
        for (const g of partGeos) {
          const piece = new THREE.Mesh(g, boxMat);
          piece.userData.module = row.module;
          mesh.add(piece);
        }
        mesh.userData.module = row.module;   // для выбора модуля кликом
        // Вид детали — для клика по детали внутри изоляции (см. pointerup
        // выше). Лево/право боковины определяем по её имени из engine.js
        // ('Боковина левая'/'Боковина правая') — engine.js уже даёт понятные
        // русские названия, отдельного поля не заводим.
        mesh.userData.kind = row.kind;
        // Ключ именно ЭТОЙ детали (см. rawByBox в начале render): kind+section
        // не различают две полки/два ящика одного вида, а ключ — да.
        mesh.userData.partKey = partKeyOf(row, box);
        if (row.kind === 'side') {
          mesh.userData.side = sideOfPartName(row.name);
        }
        // Индекс секции/зоны фасада — у дверей и фасадов ящиков (engine.js
        // makePart), числовой, в отличие от текстового row.section. Даёт
        // контекстному меню/редактору зоны в app.js понять, по какому именно
        // фасаду кликнули, когда их у модуля несколько (см. pointerup ниже).
        if (row.kind === 'door' || row.kind === 'drawerFront') {
          mesh.userData.sectionIndex = Number.isFinite(row.sectionIndex) ? row.sectionIndex : null;
          mesh.userData.zoneIndex = Number.isFinite(row.zoneIndex) ? row.zoneIndex : null;
        }
        // Несъёмная полка-перегородка (row.fixed, engine.js — на стыке зон
        // пенала) размечает границы зон ПО ВЫСОТЕ внутри секции — это нужно
        // клику по отсеку БЕЗ фасада вне изоляции (см. _resolveZoneHit).
        // Съёмные полки этот флаг не получают (fixed остаётся undefined).
        if (row.kind === 'shelf') mesh.userData.fixed = !!row.fixed;
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
            color: hiCyan ? SECTION_HI_COLOR : (isActive ? 0x6fa3cd : 0xe6e2da),
            roughness: 0.14, metalness: 0.05,
            emissive: hiCyan ? SECTION_HI_EMISSIVE : 0x000000,
            transparent: hiCyan || xray || isActive,
            opacity: hiCyan ? SECTION_HI_OPACITY : (xray ? 0.22 : (isActive ? ACTIVE_MODULE_OPACITY : 1)),
            depthWrite: !(hiCyan || xray || isActive),
          });
          const field = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), fieldMat);
          field.position.z = box.d / 2 * MM - depth / 2;   // утоплено внутрь
          mesh.add(field);
        }
        // РАЗМЕТКА В 3D: устье и дно каждого отверстия в мировых мм — для
        // привязки с любого ортогонального вида (на виде сбоку отверстие
        // видно полоской: устье и дно — её концы). Формулы положения те же,
        // что у меток присадки ниже. Считаем только для первого бокса детали
        // (разметка работает по boxes[0]) и только в прозрачном режиме.
        if ((xray || drillCheck) && box === row.boxes[0] && (row.holes || []).length) {
          const cosR = Math.cos((rotDeg * Math.PI) / 180), sinR = Math.sin((rotDeg * Math.PI) / 180);
          const geo = [];
          for (const h of row.holes) {
            const u = toU(h), v = toV(h);
            const uc = u - uSize / 2, vc = v - vSize / 2;
            let pm, pe;           // локальные точки устья и дна, мм
            if (h.side === 'edge') {
              const ed = edgeDrill(u, v, uSize, vSize, h.depth);
              const sgn = ed.atStart ? 1 : -1;      // от кромки вглубь детали
              const a0 = (ed.alongU ? (ed.atStart ? -uSize / 2 : uSize / 2) : (ed.atStart ? -vSize / 2 : vSize / 2));
              const tzv = Number.isFinite(h.tz) ? h.tz : 0;
              const loc = (p) => (planeIsX ? [tzv, p[1], p[0]] : (planeIsY ? [p[0], tzv, p[1]] : [p[0], p[1], tzv]));
              pm = loc(ed.alongU ? [a0, ed.vPos] : [ed.uPos, a0]);
              pe = loc(ed.alongU ? [a0 + sgn * ed.len, ed.vPos] : [ed.uPos, a0 + sgn * ed.len]);
            } else {
              const fromFront = h.side === 'back' ? !frontIsPlus : frontIsPlus;
              const s = fromFront ? 1 : -1;
              const dep = Math.min(h.through ? tSize : Math.max(h.depth || 6, 4), tSize);
              const loc = (a) => (planeIsX ? [a, vc, uc] : (planeIsY ? [uc, a, vc] : [uc, vc, a]));
              pm = loc(s * tSize / 2); pe = loc(s * (tSize / 2 - dep));
            }
            // локальная точка → мировая: поворот вокруг Y на rotDeg (как у mesh) + позиция бокса
            const w = (p) => ({
              x: box.x + p[0] * cosR + p[2] * sinR,
              y: box.y + p[1],
              z: box.z - p[0] * sinR + p[2] * cosR,
            });
            geo.push({ m: w(pm), e: w(pe) });
          }
          mkHoleGeo.set(row, geo);
        }
        // РЕЖИМ ПРОВЕРКИ: в каждое отверстие вставляем цветной штырь по его
        // оси и на его глубину. Корпус при этом полупрозрачный, поэтому
        // видно и присадку внутри детали, и с какой стороны она сделана.
        if (drillCheck && (row.holes || []).length) {
          for (const h of row.holes) {
            // Фильтр по виду: остальные метки не прячем, а приглушаем.
            const dim = !!drillOnly && h.kind !== drillOnly;
            const dep = h.through ? tSize : Math.max(h.depth || 6, 4);
            // Размер метки всегда реальный (не укрупняем при выборе).
            const rr = Math.max(h.d / 2, 1.2) * MM;
            const marker = new THREE.Mesh(
              new THREE.CylinderGeometry(rr, rr, dep * MM, 14),
              new THREE.MeshStandardMaterial({
                color: DRILL_COLOR[h.kind] || 0x555555,
                roughness: 0.35, metalness: 0.1,
                // Метка рисуется ПОВЕРХ полупрозрачных деталей: иначе мелкая
                // присадка внутри корпуса (гнездо защёлки под ящиком, гнёзда
                // в дне) тонет за несколькими слоями и её не видно.
                depthTest: false, transparent: true, opacity: dim ? 0.12 : 0.98,
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
              const tzm = (Number.isFinite(h.tz) ? h.tz : 0) * MM;
              if (planeIsX) marker.position.set(tzm, vPos * MM, uPos * MM);
              else if (planeIsY) marker.position.set(uPos * MM, tzm, vPos * MM);
              else marker.position.set(uPos * MM, vPos * MM, tzm);
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
        // Сквозные вырезы в режиме проверки: цветной полупрозрачный брусок
        // ровно по вырезу (на всю толщину), поверх деталей — как метки
        // отверстий, с тем же фильтром по виду (легенда присадки).
        if (drillCheck && slabNotches.length) {
          for (const n of slabNotches) {
            if (drillOnly && n.kind !== drillOnly) continue;
            const du = (n.u1 - n.u0) * MM, dv = (n.v1 - n.v0) * MM, dt = tSize * 1.02 * MM;
            const uc = ((n.u0 + n.u1) / 2 - uSize / 2) * MM;
            const vc = ((n.v0 + n.v1) / 2 - vSize / 2) * MM;
            const geo = planeIsX ? new THREE.BoxGeometry(dt, dv, du)
              : (planeIsY ? new THREE.BoxGeometry(du, dt, dv) : new THREE.BoxGeometry(du, dv, dt));
            const nm = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
              color: DRILL_COLOR[n.kind] || 0x555555, roughness: 0.35, metalness: 0.1,
              depthTest: false, transparent: true, opacity: 0.6,
            }));
            nm.renderOrder = 999;
            nm.userData.drill = n.kind;
            nm.userData.module = row.module;
            if (planeIsX) nm.position.set(0, vc, uc);
            else if (planeIsY) nm.position.set(uc, 0, vc);
            else nm.position.set(uc, vc, 0);
            mesh.add(nm);
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
        // Контур детали. Присадку наклейками НЕ рисуем: отверстия и пазы
        // есть в самой геометрии (buildSlabGeometry), у глухого отверстия
        // есть дно. Линии контура собраны там же, по тем же кольцам и
        // прямоугольникам, что и сама поверхность, — одна геометрия на
        // деталь (cutEdgeGeos сейчас всегда пуст — оставлен только чтобы
        // не менять форму кэша this._partGeoCache лишний раз).
        {
          const lineMat = new THREE.LineBasicMaterial({ color: xray ? 0x38bdf8 : (isActive ? 0x1d5c8f : 0x8a7a5a) });
          if (outlineEdges) mesh.add(new THREE.LineSegments(outlineEdges, lineMat));
          for (const ce of cutEdgeGeos) mesh.add(new THREE.LineSegments(ce, lineMat));
        }
        this.group.add(mesh);
      }
    }

    // Камеру подгоняем под габарит только когда габарит изменился — иначе
    // зум пользователя сбрасывался бы при каждой правке параметра.
    this._lastDims = { W, H, D };
    this._fitOrtho();
    // Детали, реально нарисованные в сцене, — для разметки поверх плоских
    // видов (те же правила пропуска, что в цикле выше: изоляция, ручки при
    // «Скрыть фасады»). Оверлей перестроится на ближайшем кадре.
    this._mkHoleGeo = mkHoleGeo;
    this._markupSetScene(model, source, hideFacades, isolateModule, xray || drillCheck, drillCheck, mkClearRows);
    // Число модулей в композиции изменилось (добавили/удалили модуль) — плавно
    // вписываем ВСЕ модули в кадр (отъезд при добавлении, приближение при
    // удалении), даже если пользователь уже двигал камеру. Поворот и правка
    // размеров число модулей не меняют — их кадр по-прежнему не трогает.
    const modSet = new Set();
    for (const r of source) if (r && r.module != null) modSet.add(r.module);
    const modCount = modSet.size;
    const modCountChanged = this._modCount != null && modCount !== this._modCount && modCount > 0;
    this._modCount = modCount;
    const key = `${W}|${H}|${D}`;
    if (modCountChanged && this._fitKey != null) {
      this._fitKey = key;
      const to = this._calcFrame({ b: this._inset, l: this._insetL, r: this._insetR }, true);
      if (to) {
        this._compCache = null;
        if (!prefersReducedMotion()) {
          this._camTween = {
            t0: nowMs(), from: this._currentFrame(), to,
            inset0: this._insetShown, inset1: this._insetShown,
            l0: this._insetLShown, l1: this._insetLShown, r0: this._insetRShown, r1: this._insetRShown,
          };
        } else {
          this._camTween = null;
          this._setFrame(to);
          this._notifyCameraFit();
        }
        return;
      }
    }
    if (key !== this._fitKey) {
      const hadFit = this._fitKey != null;
      this._fitKey = key;
      // Пользователь уже двигал камеру — смена габарита композиции (например,
      // поворот модуля) её не сдвигает: камера остаётся на месте.
      if (hadFit && this.controls.userMoved) {
        // камеру не трогаем
      } else if (this._hasInset()) {
        // Открыт нижний лист (телефон): новый габарит композиции подгоняем
        // под видимую над ним часть, углы обзора сохраняются.
        this._refitInset();
      } else {
        const f = this._calcDefaultFrame();
        this.controls.setFromDistance(f.radius, f.ty);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// НАВИГАЦИОННАЯ ГИЗМА (как View Gizmo в Blender)
// ---------------------------------------------------------------------------
// Маленький круг с осями в углу окна 3D. Рисуется на СВОЁМ 2D-канвасе поверх
// WebGL-канваса и управляет камерой:
//   • клик по шарику оси — плоский вид с этой стороны;
//   • клик по фону круга — из плоского вида обратно в 3D;
//   • зажать и двигать внутри круга — вращать сцену вокруг центра.
// ОТОБРАЖЕНИЕ ОСЕЙ (решение пользователя): гизма показывает РЕАЛЬНОЕ
// положение мебели — X = право сцены (+X), Y = сторона фасада («перёд», это
// +Z сцены), Z = верх (+Y сцены). Зелёный Y смотрит в сторону фасада.
// Гизме нужно только ВРАЩЕНИЕ камеры, поэтому в перспективе и в ортографике
// она выглядит одинаково.
const GIZMO_SIZE = 110;    // CSS-размер круга по умолчанию, px (переопределяется --gizmo-size)
const GIZMO_ARM = 36;      // расстояние от центра до шарика оси при size = 110, px
const GIZMO_DRAG_PX = 4;   // суммарный сдвиг, после которого «клик» считается протяжкой
const GIZMO_TAU = Math.PI * 2;
// Половина ребра кубика-логотипа в центре гизмы при size = 110, px (ребро 24 px).
// Масштабируется вместе с гизмой. Подобрано так, чтобы на плоском виде квадрат
// выступал за кольцо активного шарика в центре (иначе его не видно), а в
// 3D-ракурсе кубик лишь касался шариков осей (ближние шарики рисуются поверх).
const GIZMO_CUBE_HALF = 12;

// Шесть шариков: сначала три положительные оси (с буквой), потом три
// отрицательные (пустые кружки). dir — направление оси В СЦЕНЕ Three.js
// (Y вверх, перёд = +Z); view — плоский вид, который включает клик по шарику
// (тот же вид «активен», когда камера в нём стоит); rgb — цвет оси.
const GIZMO_AXES = [
  { label: 'X', pos: true,  dir: [1, 0, 0],  view: 'side',   rgb: [226, 62, 87] },
  { label: 'X', pos: false, dir: [-1, 0, 0], view: 'left',   rgb: [226, 62, 87] },
  { label: 'Y', pos: true,  dir: [0, 0, 1],  view: 'front',  rgb: [50, 152, 56] },
  { label: 'Y', pos: false, dir: [0, 0, -1], view: 'back',   rgb: [50, 152, 56] },
  { label: 'Z', pos: true,  dir: [0, 1, 0],  view: 'top',    rgb: [46, 124, 230] },
  { label: 'Z', pos: false, dir: [0, -1, 0], view: 'bottom', rgb: [46, 124, 230] },
];

class ViewGizmo {
  /** Создаёт гизму или возвращает null, если её негде нарисовать (нет DOM/2D-канвы). */
  static create(viewer) {
    try {
      const g = new ViewGizmo(viewer);
      return g.ctx ? g : null;
    } catch (e) {
      return null;
    }
  }

  constructor(viewer) {
    this.viewer = viewer;
    this.canvas = null;
    this.ctx = null;
    this.visible = true;
    this._size = GIZMO_SIZE;    // текущий CSS-размер, px
    this._dpr = 1;              // devicePixelRatio, с которым выставлен размер канвы
    this._sizeKnown = false;    // узнали ли реальный размер из вёрстки
    this._hover = -1;           // индекс шарика (в GIZMO_AXES) под курсором, -1 — нет
    this._hoverDisc = false;    // курсор над кругом гизмы (диск проявляется)
    this._drag = null;          // состояние текущего жеста, см. pointerdown
    this._cursor = 'grab';
    this._drawn = null;         // параметры последней отрисовки (чтобы не рисовать зря)

    // Тестовая среда tools/ (заглушка DOM) — нет document или 2D-контекста:
    // гизмы просто нет, без исключений.
    if (typeof document === 'undefined' || !document.createElement) return;
    const host = viewer.container;
    if (!host || typeof host.appendChild !== 'function') return;
    const canvas = document.createElement('canvas');
    const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx || typeof canvas.addEventListener !== 'function') return;

    canvas.className = 'view-gizmo';
    canvas.title = 'Клик по оси — вид с этой стороны, перетаскивание — вращение';
    // Минимум стиля прямо здесь — чтобы гизма работала и без правок style.css.
    // Отступы и размер интерфейсный слой может менять через CSS-переменные
    // --gizmo-right / --gizmo-bottom / --gizmo-size (например, на мобильном).
    // border-radius: 50% — чтобы и клики ловились только внутри круга, а не
    // по углам квадратного канваса (там должна работать обычная сцена).
    canvas.style.cssText =
      'position:absolute;right:var(--gizmo-right,12px);bottom:var(--gizmo-bottom,12px);' +
      'width:var(--gizmo-size,110px);height:var(--gizmo-size,110px);z-index:5;' +
      'touch-action:none;user-select:none;-webkit-user-select:none;' +
      '-webkit-tap-highlight-color:transparent;border-radius:50%;cursor:grab;';

    // --- жесты -------------------------------------------------------------
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;   // только ЛКМ
      // События гизмы не должны уходить дальше по дереву (панели, закрытие
      // меню по клику вне и т.п.). В SimpleOrbitControl они и так не попадут —
      // тот слушает соседний канвас рендерера.
      e.stopPropagation();
      if (this._drag) return;               // уже идёт жест другим пальцем
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
      this._drag = {
        id: e.pointerId,
        sx: e.clientX, sy: e.clientY,       // точка нажатия
        lx: e.clientX, ly: e.clientY,       // предыдущая точка
        moved: 0,                           // суммарный сдвиг — отличает клик от протяжки
        rotating: false,
      };
      this._hover = -1;
      this._hoverDisc = true;
    });

    canvas.addEventListener('pointermove', (e) => {
      const d = this._drag;
      if (d) {
        if (e.pointerId !== d.id) return;
        // Кнопку отпустили, а pointerup потерялся (бывает при потере capture) —
        // жест закончился, иначе сцена «прилипла» бы к курсору.
        if (e.pointerType !== 'touch' && e.buttons === 0) { this._finish(e, true); return; }
        this._dragMove(e, d);
        return;
      }
      if (e.pointerType === 'touch') return;   // у пальца наведения нет
      this._updateHover(this._local(e));
    });

    canvas.addEventListener('pointerup', (e) => this._finish(e, false));
    canvas.addEventListener('pointercancel', (e) => this._finish(e, true));

    canvas.addEventListener('pointerleave', () => {
      if (this._drag) return;   // во время протяжки указатель захвачен — не сбрасываем
      this._hover = -1;
      this._hoverDisc = false;
      this._setCursor('grab');
    });

    // Колесо над гизмой не должно прокручивать страницу.
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Канвас гизмы кладём НЕ внутрь контейнера сцены (#viewer3d), а рядом с
    // ним — в его родителя (.stage). У #viewer3d свой слой (z-index: 1), и
    // всё, что внутри него, рисуется ПОД соседним оверлеем размеров
    // (.view-overlay, z-index: 4) — размерные линии ложились поверх гизмы.
    // В родителе z-index: 5 ставит гизму над оверлеем, но ниже плашек
    // предупреждений (29), HUD (32), панелей (36) и модалок. #viewer3d
    // растянут на весь родитель (inset: 0), поэтому угол остаётся тем же.
    // Если родителя нет (нестандартная вёрстка) — как раньше, внутрь сцены.
    const mount = (host.parentNode && typeof host.parentNode.appendChild === 'function')
      ? host.parentNode : host;
    mount.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = ctx;
    this.resize();
  }

  // --- размеры и видимость ---------------------------------------------------

  /** Подгоняет внутренний размер канвы под CSS-размер и devicePixelRatio. */
  resize() {
    if (!this.canvas) return;
    const raw = this.canvas.clientWidth;
    const css = raw || GIZMO_SIZE;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const px = Math.max(1, Math.round(css * dpr));
    if (this.canvas.width !== px || this.canvas.height !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    this._size = css;
    this._dpr = dpr;
    this._sizeKnown = raw > 0;
    this._drawn = null;   // канва очистилась/размер сменился — рисуем заново
  }

  /** Показать/скрыть гизму (display:none). */
  setVisible(visible) {
    this.visible = !!visible;
    if (!this.canvas || !this.ctx) return;
    this.canvas.style.display = this.visible ? 'block' : 'none';
    if (this.visible) {
      this.resize();
    } else {
      this._drag = null;
      this._hover = -1;
      this._hoverDisc = false;
    }
  }

  // --- отрисовка -------------------------------------------------------------

  /** Вызывается каждый кадр из Viewer3D._animate(): рисует, только если что-то изменилось. */
  update() {
    if (!this.ctx || !this.visible) return;
    try {
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      // Размер мог быть ещё не известен (контейнер был скрыт) или ДПИ сменился
      // (окно перетащили на другой монитор) — пересчитываем.
      if (dpr !== this._dpr || (!this._sizeKnown && this.canvas.clientWidth > 0)) this.resize();

      const v = this.viewer;
      const q = v.camera.quaternion;
      const dark = this._isDark();
      const disc = this._hoverDisc || !!this._drag;
      const D = this._drawn;
      if (D && D.qx === q.x && D.qy === q.y && D.qz === q.z && D.qw === q.w
          && D.view === v.viewName && D.hover === this._hover && D.disc === disc && D.dark === dark) {
        return;
      }
      this._draw(dark, disc);
      this._drawn = { qx: q.x, qy: q.y, qz: q.z, qw: q.w, view: v.viewName, hover: this._hover, disc, dark };
    } catch (e) {
      // Гизма — вспомогательный виджет: при любой ошибке отрисовки отключаем
      // её, а не ломаем цикл рендера сцены (иначе ошибка повторялась бы каждый кадр).
      this.ctx = null;
      if (this.canvas) this.canvas.style.display = 'none';
      if (typeof console !== 'undefined' && console.warn) console.warn('Навигационная гизма отключена:', e);
    }
  }

  /** Тёмная ли тема интерфейса (ui-shell.js ставит data-theme на <html>). */
  _isDark() {
    try {
      return document.documentElement.getAttribute('data-theme') === 'dark';
    } catch (e) {
      return false;
    }
  }

  /** Индекс шарика, чей вид сейчас включён (в 'iso' — нет активного, -1). */
  _activeIndex() {
    const vn = this.viewer.viewName;
    for (let i = 0; i < GIZMO_AXES.length; i++) {
      if (GIZMO_AXES[i].view === vn) return i;
    }
    return -1;
  }

  /**
   * Экранные позиции всех шести шариков для ТЕКУЩЕГО поворота камеры,
   * отсортированные от дальних к ближним. Оси сцены проецируются только
   * вращением камеры: экранный x = проекция на «вправо» камеры, экранный y =
   * минус проекция на «вверх» (у канвы ось y идёт вниз), глубина z =
   * проекция на «на камеру» (больше — ближе).
   */
  _layout() {
    const q = this.viewer.camera.quaternion;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const k = this._size / GIZMO_SIZE;
    const c = this._size / 2;
    const items = [];
    for (let i = 0; i < GIZMO_AXES.length; i++) {
      const a = GIZMO_AXES[i];
      const d = a.dir;
      const sx = right.x * d[0] + right.y * d[1] + right.z * d[2];
      const sy = up.x * d[0] + up.y * d[1] + up.z * d[2];
      const sz = back.x * d[0] + back.y * d[1] + back.z * d[2];
      const t = (sz + 1) / 2;                       // 0 — дальний, 1 — ближний
      items.push({
        i, a, z: sz, t,
        x: c + sx * GIZMO_ARM * k,
        y: c - sy * GIZMO_ARM * k,
        // дальние шарики чуть меньше; у отрицательных базовый радиус меньше
        r: (a.pos ? 10 : 8) * k * (0.8 + 0.2 * t),
      });
    }
    items.sort((p, s) => p.z - s.z);
    return items;
  }

  _draw(dark, disc) {
    const ctx = this.ctx;
    const S = this._size;
    const k = S / GIZMO_SIZE;
    const c = S / 2;
    const scale = this.canvas.width / S;   // внутренних пикселей на CSS-пиксель
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, S, S);

    // Фон: лёгкий круг, который заметно проявляется при наведении.
    ctx.beginPath();
    ctx.arc(c, c, c - 0.5, 0, GIZMO_TAU);
    ctx.fillStyle = dark
      ? (disc ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)')
      : (disc ? 'rgba(15,23,42,0.13)' : 'rgba(15,23,42,0.05)');
    ctx.fill();

    const items = this._layout();
    const active = this._activeIndex();
    const baseFill = dark ? '#2b2f37' : '#eef0f3';   // непрозрачная подложка пустых шариков
    ctx.font = 'bold ' + Math.round(11 * k) + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Белое кольцо с тонкой тёмной подложкой — читается и на светлой, и на тёмной теме.
    const ring = (x, y, r) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, GIZMO_TAU);
      ctx.lineWidth = 3.6 * k;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.stroke();
      ctx.lineWidth = 1.8 * k;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    };

    // От дальних к ближним — ближние перекрывают дальние. Кубик-логотип стоит
    // в центре гизмы, то есть «на глубине 0»: рисуем его между шариками
    // позади (z < 0) и шариками впереди (z >= 0) — дальние оси уходят под
    // кубик, ближние шарики с буквами ложатся поверх него и не закрываются.
    let cubeDone = false;
    for (const it of items) {
      if (!cubeDone && it.z >= 0) { this._drawCube(dark); cubeDone = true; }
      const a = it.a;
      const col = a.rgb;
      const rgba = (al) => 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + al + ')';
      const isHover = it.i === this._hover;
      const isActive = it.i === active;
      const rad = it.r * (isHover ? 1.15 : 1);

      if (a.pos) {
        // Стержень от центра до края шарика.
        const dx = it.x - c, dy = it.y - c;
        const len = Math.hypot(dx, dy);
        if (len > rad) {
          const f = (len - rad + 0.5 * k) / len;
          ctx.beginPath();
          ctx.moveTo(c, c);
          ctx.lineTo(c + dx * f, c + dy * f);
          ctx.lineWidth = 2.4 * k;
          ctx.lineCap = 'butt';
          ctx.strokeStyle = rgba(0.7 + 0.3 * it.t);
          ctx.stroke();
        }
        // Цветной шарик с буквой.
        ctx.beginPath();
        ctx.arc(it.x, it.y, rad, 0, GIZMO_TAU);
        ctx.fillStyle = rgba(0.75 + 0.25 * it.t);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(a.label, it.x, it.y + 0.5 * k);
      } else {
        // Пустой кружок приглушённого тона: непрозрачная подложка (чтобы
        // дальний шарик не просвечивал сквозь него), полупрозрачная заливка
        // цветом оси и цветная обводка.
        const lit = isHover || isActive;
        ctx.beginPath();
        ctx.arc(it.x, it.y, rad, 0, GIZMO_TAU);
        ctx.fillStyle = baseFill;
        ctx.fill();
        ctx.fillStyle = rgba(lit ? 0.75 : 0.24 + 0.12 * it.t);
        ctx.fill();
        ctx.lineWidth = 1.5 * k;
        ctx.strokeStyle = rgba(0.6 + 0.4 * it.t);
        ctx.stroke();
      }

      if (isHover) ring(it.x, it.y, rad);
      if (isActive) ring(it.x, it.y, rad + 3 * k);   // постоянная подсветка текущего вида
    }
    if (!cubeDone) this._drawCube(dark);
  }

  /**
   * Маленький 3D-кубик в центре гизмы в стиле логотипа (favicon.svg):
   * голубые рёбра со скруглёнными углами и одна грань с лёгкой заливкой.
   * Это настоящий куб, оси которого совпадают с осями сцены, и проецируется
   * он тем же поворотом камеры, что и лучи осей, — поэтому его рёбра всегда
   * параллельны лучам X/Y/Z. Рисуются только видимые грани (нормаль смотрит
   * на камеру): в стандартном 3D-ракурсе это контур-шестиугольник и «Y» от
   * ближнего угла, как на логотипе; на плоском виде — квадрат.
   * Кубик — только картинка: в хит-тест он не входит, клик по нему = клик по
   * фону круга, протяжка = вращение.
   */
  _drawCube(dark) {
    const ctx = this.ctx;
    const q = this.viewer.camera.quaternion;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const k = this._size / GIZMO_SIZE;
    const c = this._size / 2;
    const h = GIZMO_CUBE_HALF * k;   // половина ребра куба, px

    // Точка сцены (в долях половины ребра) -> экранные координаты канвы.
    const proj = (p) => ({
      x: c + (right.x * p[0] + right.y * p[1] + right.z * p[2]) * h,
      y: c - (up.x * p[0] + up.y * p[1] + up.z * p[2]) * h,
    });

    // Шесть граней: нормаль вдоль оси ax со знаком s. Вершины грани обходим
    // по кругу по двум другим осям.
    const faces = [];
    const loop = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let ax = 0; ax < 3; ax++) {
      for (const s of [1, -1]) {
        const n = [0, 0, 0];
        n[ax] = s;
        // Насколько грань повёрнута к камере (>0 — видна) и вправо на экране.
        const nz = back.x * n[0] + back.y * n[1] + back.z * n[2];
        if (nz <= 0.02) continue;   // невидимая или «ребром» к камере — не рисуем
        const nx = right.x * n[0] + right.y * n[1] + right.z * n[2];
        const b = (ax + 1) % 3, d = (ax + 2) % 3;
        const pts = loop.map((uv) => {
          const p = [0, 0, 0];
          p[ax] = s; p[b] = uv[0]; p[d] = uv[1];
          return proj(p);
        });
        faces.push({ pts, nx, nz });
      }
    }
    if (!faces.length) return;

    // Фирменный голубой; в светлой теме чуть темнее — для контраста на светлом фоне.
    const col = dark ? '56,189,248' : '14,165,233';   // #38bdf8 / #0ea5e9

    // Заливка (как в логотипе) — у одной грани: самой правой на экране из
    // видимых. В стандартном ракурсе это грань +X (правая боковая), как в
    // favicon; на плоском виде — единственная видимая грань.
    let fillFace = faces[0];
    for (const f of faces) {
      if (f.nx + 0.001 * f.nz > fillFace.nx + 0.001 * fillFace.nz) fillFace = f;
    }
    const path = (pts) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
    };
    path(fillFace.pts);
    ctx.fillStyle = 'rgba(' + col + ',0.18)';
    ctx.fill();

    // Контуры всех видимых граней: вместе они дают внешний контур и рёбра
    // между видимыми гранями (общие рёбра рисуются дважды одним непрозрачным
    // цветом — на вид не отличается).
    ctx.lineWidth = 1.6 * k;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgb(' + col + ')';
    for (const f of faces) {
      path(f.pts);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  // --- вспомогательное для жестов ----------------------------------------------

  /** Координаты события в «логических» пикселях круга (0..size). */
  _local(e) {
    const r = this.canvas.getBoundingClientRect();
    const k = r.width ? this._size / r.width : 1;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  }

  /** Шарик под точкой (радиус попадания = радиус + 3 px); при наложении — ближний к камере. */
  _hitTest(px, py) {
    const pad = 3 * (this._size / GIZMO_SIZE);
    let best = null;
    for (const it of this._layout()) {           // порядок «дальние → ближние»
      if (Math.hypot(px - it.x, py - it.y) <= it.r + pad) best = it;   // последний = ближний
    }
    return best;
  }

  _setCursor(cur) {
    if (this._cursor === cur) return;
    this._cursor = cur;
    this.canvas.style.cursor = cur;
  }

  /** Наведение мыши: подсветка шарика/диска и курсор. */
  _updateHover(p) {
    const c = this._size / 2;
    const inside = Math.hypot(p.x - c, p.y - c) <= c;
    const hit = inside ? this._hitTest(p.x, p.y) : null;
    this._hoverDisc = inside;
    this._hover = hit ? hit.i : -1;
    this._setCursor(hit ? 'pointer' : 'grab');
  }

  /** Сообщаем интерфейсному слою (app.js), что вид сменили жестом гизмы. */
  _notify(name) {
    this.viewer._notifyViewChange(name);
  }

  /** Шаг протяжки: после порога 4 px вращаем сцену вокруг центра (target). */
  _dragMove(e, d) {
    const dx = e.clientX - d.lx;
    const dy = e.clientY - d.ly;
    d.lx = e.clientX;
    d.ly = e.clientY;
    d.moved += Math.abs(dx) + Math.abs(dy);
    let stepX = dx, stepY = dy;
    if (!d.rotating) {
      if (d.moved <= GIZMO_DRAG_PX) return;   // ещё похоже на клик
      d.rotating = true;
      this._setCursor('grabbing');
      // Из плоского вида уходим в перспективу БЕЗ сброса углов и продолжаем
      // с текущего ракурса; интерфейсу сообщаем, что теперь это 3D.
      if (this.viewer._enterPerspectiveKeepAngles()) this._notify('iso');
      // Первый шаг — сразу всё смещение от точки нажатия, чтобы сцена шла за
      // курсором без «мёртвой зоны» в 4 px.
      stepX = e.clientX - d.sx;
      stepY = e.clientY - d.sy;
    }
    // Углы меняем так же, как SimpleOrbitControl при вращении.
    const ctl = this.viewer.controls;
    ctl.theta -= stepX * 0.006;
    ctl.phi = Math.min(Math.PI - 0.03, Math.max(0.03, ctl.phi - stepY * 0.006));
    ctl.update();
  }

  /** Конец жеста (pointerup/pointercancel): клик или окончание протяжки. */
  _finish(e, cancelled) {
    const d = this._drag;
    if (!d || e.pointerId !== d.id) return;
    this._drag = null;
    try {
      if (this.canvas.hasPointerCapture && this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
    } catch (err) { /* не критично */ }

    const p = this._local(e);
    if (!cancelled && !d.rotating) {
      // Клик без протяжки. Попали в шарик — плоский вид с этой стороны.
      // Мимо шарика (фон круга, стержень): из плоского вида — назад в 3D; если
      // уже 3D — ничего не делаем, чтобы случайный клик не сбрасывал ракурс.
      const hit = this._hitTest(p.x, p.y);
      const v = this.viewer;
      if (hit) {
        v.setView(hit.a.view);
        this._notify(hit.a.view);
      } else if (v.isOrtho) {
        v.setView('iso');
        this._notify('iso');
      }
    }

    // Возвращаем наведение (мышь; шарики уже могли переехать после смены вида)
    // или сбрасываем его (палец, отмена жеста).
    if (e.pointerType === 'touch' || cancelled) {
      this._hover = -1;
      this._hoverDisc = false;
      this._setCursor('grab');
    } else {
      this._updateHover(p);
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
  let group = null;   // всё, что создали здесь, — освобождаем в finally
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

    group = new THREE.Group();
    scene.add(group);

    // Режим «в реальном цвете» (для миниатюр Библиотеки, opts.realistic) —
    // в отличие от нейтрального силуэта, здесь опоры должны попасть и в
    // кадр, и в bounding box камеры (кухонная тумба «висела бы в воздухе»
    // без них на иконке).
    const realistic = !!(opts && opts.realistic);

    // След модели на плане (проекция боксов на плоскость XZ, без учёта Y) —
    // собираем попутно с основным циклом ниже. Нужен только для того, чтобы
    // определить ракурс камеры для угловых (Г-образных) сборок — см.
    // комментарий у missing-corner detection перед камерой ниже.
    let footMinX = Infinity, footMaxX = -Infinity, footMinZ = Infinity, footMaxZ = -Infinity;
    const footRects = [];

    for (const row of source) {
      // Фурнитуру (опоры/ручки/штанги/полкодержатели/фланцы) для маленькой
      // иконки обычно не рисуем — силуэт модуля определяют только листовые
      // детали. Опоры (row.shape === 'cylinder') — исключение в реальном
      // режиме: см. makeLeg/makeKitchenLeg ниже (используют src/legMeshes.js,
      // который по правилам проекта не читаем и не трогаем — вызываем его
      // так же, как основной Viewer3D.render()).
      if (row.shape && row.shape !== 'box') {
        if (realistic && row.shape === 'cylinder') {
          const legBoxes = row.boxes || (row.box ? [row.box] : []);
          for (const legBox of legBoxes) {
            // Часть геометрии опоры — общий на всё приложение кэш
            // (kitchenLegSplitCache/clipTabGeoCache); он помечен markShared,
            // и очистка в finally его не тронет.
            const leg = row.legType === 'kitchen'
              ? makeKitchenLeg(legBox, row.module, false, !!row.hasClip, false, row.rot || 0)
              : makeLeg(legBox, row.module, false, false);
            group.add(leg);
          }
        }
        continue;
      }
      const box = row.box;
      if (!box || !(box.w > 0) || !(box.h > 0) || !(box.d > 0)) continue;

      // Накапливаем след детали на плане (XZ) для missing-corner detection
      // ниже. box.w/box.d здесь — уже МИРОВЫЕ (не локальные) габариты по
      // осям X/Z: engine.js меняет их местами для деталей перпендикулярного
      // прогона до того, как деталь попадёт сюда (см. комментарий про
      // swapped/rotDeg ниже) — поэтому box.x/z/w/d достаточно взять как
      // есть, без учёта row.rot.
      footRects.push({
        x0: box.x - box.w / 2, x1: box.x + box.w / 2,
        z0: box.z - box.d / 2, z1: box.z + box.d / 2,
      });
      if (box.x - box.w / 2 < footMinX) footMinX = box.x - box.w / 2;
      if (box.x + box.w / 2 > footMaxX) footMaxX = box.x + box.w / 2;
      if (box.z - box.d / 2 < footMinZ) footMinZ = box.z - box.d / 2;
      if (box.z + box.d / 2 > footMaxZ) footMaxZ = box.z + box.d / 2;

      // Цвет — по материалу детали (тот же decorLook/KIND_COLOR, что и в
      // основной сцене). В нейтральном режиме (opts.neutral) реальный декор
      // игнорируем — все детали красим одним светлым тоном, а силуэт
      // читается по контуру (EdgesGeometry), а не по цвету материала. В
      // реальном режиме (opts.realistic), наоборот, поверх цвета кладём ещё
      // и текстуру «под древесину» — ту же woodTexture(), что и основная
      // сцена, — на декорах ЛДСП/дерева (не на МДФ/плёнке/стекле).
      const neutral = !!(opts && opts.neutral);
      const look = decorLook(row.material);
      const asFacade = !!row.facadeType;
      const color = look ? look.color
        : (KIND_COLOR[row.kind] ?? (asFacade ? KIND_COLOR.door : KIND_COLOR.side));
      // row.glass — общий флаг у стеклянного фасада (GLASS-4) и стеклянной
      // полки за ним (GLASS-6, engine.js glassShelf) — красим по-разному,
      // см. пояснение у GLASS4_COLOR выше. asFacade (row.facadeType задан
      // только у двери/ящика) отличает фасад от полки.
      const glassFacade = !!row.glass && asFacade;
      const isMdf = row.facadeType === 'mdf' || row.facadeType === 'mdfMilled';
      const ldspLike = !row.glass && !isMdf && (look ? look.wood : true);
      const tex = (realistic && ldspLike) ? woodTexture() : null;

      // Разворот детали (row.rot, 0/90/180/270°) — тот же приём, что и в
      // основной сцене (Viewer3D.render, см. locW/locD там): у детали
      // перпендикулярного прогона (угловая секция — второй ряд модулей под
      // 90°) engine.js уже ЗАМЕНИЛ местами box.w/box.d, чтобы прямоугольник
      // лежал по мировым осям X/Z. Если строить геометрию сразу по этим
      // мировым box.w/box.d и ПОВЕРХ ЕЩЁ развернуть mesh на rotDeg — размеры
      // повернутся второй раз и деталь встанет с перепутанными шириной/
      // глубиной поперёк своего места (визуально — «каша» из налезающих друг
      // на друга деталей на миниатюре угловых комплектов). Поэтому здесь, как
      // и в основной сцене, геометрию строим в ЛОКАЛЬНЫХ (до разворота)
      // размерах — при swapped возвращаем w/d обратно, — а сам разворот целиком
      // делает mesh.rotation.y ниже.
      const rotDeg = row.rot || 0;
      const swapped = rotDeg === 90 || rotDeg === 270;
      const locW = swapped ? box.d : box.w;
      const locD = swapped ? box.w : box.d;

      const geo = new THREE.BoxGeometry(
        Math.max(locW * MM, 0.001), Math.max(box.h * MM, 0.001), Math.max(locD * MM, 0.001));
      const mat = new THREE.MeshStandardMaterial({
        color: glassFacade ? GLASS4_COLOR : (row.glass ? 0xbfe3ea : (neutral ? 0xf1efe8 : color)),
        roughness: 0.7, metalness: 0.03,
        transparent: !!row.glass, opacity: glassFacade ? GLASS4_OPACITY : (row.glass ? 0.4 : 1),
      });
      if (tex) {
        // BoxGeometry (не аналитическая пласть buildSlabGeometry) даёт UV
        // 0..1 на каждую грань — переводим repeat в те же метры детали, что
        // и в основной сцене (WOOD_TILE_M), чтобы густота волокна на иконке
        // не «плыла» от размера детали. locW/box.h — те же локальные размеры,
        // что и у geo выше, а не мировые box.w (см. комментарий про swapped).
        mat.map = tex.clone();
        mat.map.needsUpdate = true;
        mat.map.wrapS = THREE.RepeatWrapping;
        mat.map.wrapT = THREE.RepeatWrapping;
        if (grainAxisIndex(row.grainAxis) >= 0) {
          // У детали задано направление волокна (engine.js, row.grainAxis).
          // UV BoxGeometry «0..1 на грань» его выразить не могут (и на боковине
          // растягивали бы текстуру по тонкому размеру), поэтому переписываем
          // UV в метры по каждой грани (см. applyGrainBoxUv) и кладём общий
          // repeat = 1 тайл на WOOD_TILE_M — как в основной сцене. Фазу узора
          // между деталями (woodUvOrigin) на иконке не выравниваем — она мелкая.
          applyGrainBoxUv(geo, row.grainAxis);
          mat.map.repeat.set(1 / WOOD_TILE_M, 1 / WOOD_TILE_M);
        } else {
          mat.map.repeat.set(Math.max(locW * MM, 0.01) / WOOD_TILE_M, Math.max(box.h * MM, 0.01) / WOOD_TILE_M);
        }
      }
      const mesh = new THREE.Mesh(geo, mat);
      // Позиция — мировые box.x/y/z из engine.js как есть; поворот
      // (mesh.rotation.y) довершает разворот детали из ЛОКАЛЬНЫХ размеров
      // (locW/locD выше) в её мировое место — см. комментарий выше.
      mesh.position.set(box.x * MM, box.y * MM, box.z * MM);
      mesh.rotation.y = (rotDeg * Math.PI) / 180;

      // Контур детали — та же техника, что и в основном 3D-виде
      // (Viewer3D.render): EdgesGeometry поверх боксовой геометрии, тем же
      // mesh.position/rotation (edges — дочерний объект mesh). Раньше рисовали
      // только в neutral (силуэт без цвета, контур — единственная подсказка
      // о границах деталей), но в realistic цветные детали одного тона
      // (боковины/полки/фасад одного декора) сливались в один силуэт без
      // контура — рисуем контур и здесь, цветом чуть темнее нейтрального,
      // чтобы он читался и на светлом, и на цветном/древесном корпусе.
      const edgesGeo = new THREE.EdgesGeometry(geo);
      // В realistic контур раньше рисовали сплошным почти-чёрным (opacity 1,
      // 0x241f18) — на светлом корпусе (белый, МДФ) это давало огромный
      // контраст и «резало глаз». linewidth у LineBasicMaterial в WebGL почти
      // везде (в т.ч. Windows/ANGLE) игнорируется браузером и всегда рисует
      // 1px независимо от значения — поэтому «потоньше» делаем не через
      // толщину, а через контраст: полупрозрачная линия (opacity 0.6)
      // подмешивается к тому, что уже нарисовано позади неё. На белом/светлом
      // корпусе она смягчается до тёмно-серой (не «кричит»), а декор «чёрный
      // ЛДСП» в каталоге на самом деле тёмно-серый (0x35332f, не абсолютный
      // чёрный) — той же полупрозрачной линии темнее его всё равно хватает,
      // чтобы контур читался, а не пропадал. Neutral-режим (силуэт без цвета,
      // контур — единственная подсказка о границах) не трогаем — там линия
      // должна остаться чёткой и непрозрачной, как раньше.
      const edgesMat = neutral
        ? new THREE.LineBasicMaterial({ color: 0x33302a })
        : new THREE.LineBasicMaterial({ color: 0x1a1712, transparent: true, opacity: 0.6 });
      const edges = new THREE.LineSegments(edgesGeo, edgesMat);
      mesh.add(edges);

      group.add(mesh);
    }

    if (!group.children.length) return null;   // нечего показывать

    // Азимут камеры (theta) для Г-образных (угловых) сборок: НЕ мировая
    // константа, а направление, вычисленное по фактическому следу деталей
    // на плане XZ (footRects/footMin*/footMax*, накоплены в цикле выше).
    //
    // Идея: у одиночного прямоугольного модуля след на плане — сплошной
    // прямоугольник, и все 4 угла его ограничивающего бокса накрыты
    // какой-нибудь деталью (дно/крышка тянутся на весь габарит). У сборки
    // из двух крыльев под 90° (угловая кухня) один угол ограничивающего
    // прямоугольника — ДИАГОНАЛЬНО противоположный стыку крыльев — всегда
    // остаётся пустым: тот же разбор, что и в задаче: если фасад крыла 1
    // смотрит на +Z, а фасад крыла 2 (после поворота прогона на 90°) — на
    // -X, то оба фасада «раскрываются» как раз в сторону пустующего угла
    // (+Z/-X), и камера, поставленная по диагонали С ЭТОЙ стороны, видит
    // фасады обоих крыльев одновременно. Это верно независимо от того, в
    // какую сторону мира повёрнута вся сборка целиком (m.rotation
    // проекта), потому что направление считается ОТНОСИТЕЛЬНО самого следа
    // деталей, а не как фиксированный мировой угол.
    //
    // Пробуем точку с отступом 12% от габарита внутрь от каждого угла — так
    // стык двух деталей ровно по границе угла не даёт ложного «угол пуст»
    // из-за округления координат (engine.js использует round1, 0.1 мм).
    // Реагируем только если пустует РОВНО один угол — однозначный признак
    // сборки из двух крыльев. Если пусто 0 (обычный прямоугольный модуль,
    // в т.ч. просто длинный прямой ряд из нескольких модулей) или больше 1
    // (сложная форма — П-образная кухня из трёх крыльев и т.п.) — оставляем
    // прежний фиксированный ракурс, не гадая: для таких форм наша простая
    // эвристика не даёт однозначного ответа, а фиксированный ракурс — это
    // ровно то поведение, что было раньше (без регресса).
    let theta = Math.PI / 4;   // дефолт — тот же фиксированный ракурс, что и раньше
    if (footRects.length && footMaxX > footMinX && footMaxZ > footMinZ) {
      const insetX = (footMaxX - footMinX) * 0.12;
      const insetZ = (footMaxZ - footMinZ) * 0.12;
      const EPS = 0.5;   // мм, запас на округление (round1 в engine.js)
      const cornerDefs = [
        { x: footMinX, z: footMinZ, px: footMinX + insetX, pz: footMinZ + insetZ },
        { x: footMaxX, z: footMinZ, px: footMaxX - insetX, pz: footMinZ + insetZ },
        { x: footMinX, z: footMaxZ, px: footMinX + insetX, pz: footMaxZ - insetZ },
        { x: footMaxX, z: footMaxZ, px: footMaxX - insetX, pz: footMaxZ - insetZ },
      ];
      const missing = cornerDefs.filter((c) => !footRects.some((r) =>
        c.px >= r.x0 - EPS && c.px <= r.x1 + EPS && c.pz >= r.z0 - EPS && c.pz <= r.z1 + EPS));
      if (missing.length === 1) {
        const mc = missing[0];
        const footCenterX = (footMinX + footMaxX) / 2;
        const footCenterZ = (footMinZ + footMaxZ) / 2;
        // atan2(dx, dz) — та же формула, что и в camera.position.set() ниже
        // (x ~ sin(theta), z ~ cos(theta)): при дефолтном theta=PI/4 это в
        // точности направление (+X,+Z), что и подтверждает эквивалентность
        // старому фиксированному ракурсу для обычных модулей.
        theta = Math.atan2(mc.x - footCenterX, mc.z - footCenterZ);
      }
    }

    // Bounding box всей модели — под него подгоняем камеру так, чтобы модуль
    // был виден целиком с небольшим отступом по краям.
    const box3 = new THREE.Box3().setFromObject(group);
    if (box3.isEmpty()) return null;
    const sphere = box3.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center;
    const radius = Math.max(sphere.radius, 0.05);

    // Изометрический ракурс — тот же полярный угол, что и вид «3D» по
    // умолчанию в основном вьювере (см. SimpleOrbitControl: phi=PI/2.6);
    // азимут (theta) для угловых сборок переопределён выше по следу деталей.
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
    //
    // Та же очистка, что и в основной сцене (disposeObjectTree): детали,
    // контуры, клоны текстуры «под древесину» и опоры. Общий кэш опор
    // (kitchenLegSplitCache/clipTabGeoCache) и саму woodTexture() она
    // пропускает — их использует и основная 3D-сцена (см. markShared).
    if (group) disposeObjectTree(group);
    if (renderer) {
      renderer.dispose();
      if (typeof renderer.forceContextLoss === 'function') renderer.forceContextLoss();
    }
  }
}

window.Modul3D = window.Modul3D || {};
window.Modul3D.viewer = {
  Viewer3D, lengthAlongU, edgeDrill, DRILL_COLOR, DRILL_TITLE,
  renderThumbnail,
  // Рабочий экземпляр Viewer3D (выставляет его конструктор) — для отладки
  // из консоли: Modul3D.viewer.current.memoryInfo().
  current: null,
  // Сборка геометрии детали — наружу отдаётся для прогонов (tools/) и
  // замеров: по этим функциям можно проверить топологию детали (и то, что
  // её присадка вообще попала в геометрию), не поднимая всю сцену.
  buildSlabGeometry, segmentsForHole, slabCutsForPart,
};
})();
