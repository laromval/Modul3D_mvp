// tools/geometry.js
// ============================================================================
// Проверка геометрии модели: перебирает конфигурации и ищет
//   • пересечения деталей (детали не могут занимать один объём);
//   • расхождение итога сметы с суммой позиций;
//   • дыры в нумерации деталировки;
//   • NaN/null в сгенерированных чертежах.
// Запуск:  node tools/geometry.js
// ============================================================================
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
global.window = global;
['catalog', 'presets', 'engine', 'specification', 'drawings', 'cnc'].forEach((m) => require(path.join(ROOT, 'src', m + '.js')));
const { buildModel } = window.Modul3D.engine;
const { buildSpecification } = window.Modul3D.specification;
const { buildDrawings } = window.Modul3D.drawings;
const { DECORS, BACK_MATERIALS, DRAWER_SYSTEM_ORDER } = window.Modul3D.catalog;

const EPS = 0.51;                       // допуск: меньше — это стык, не нахлёст
function overlaps(a, b) {
  const f = (p, s) => [p - s / 2, p + s / 2];
  const [ax0, ax1] = f(a.x, a.w), [ay0, ay1] = f(a.y, a.h), [az0, az1] = f(a.z, a.d);
  const [bx0, bx1] = f(b.x, b.w), [by0, by1] = f(b.y, b.h), [bz0, bz1] = f(b.z, b.d);
  return Math.min(ax1, bx1) - Math.max(ax0, bx0) > EPS
      && Math.min(ay1, by1) - Math.max(ay0, by0) > EPS
      && Math.min(az1, bz1) - Math.max(az0, bz0) > EPS;
}

const SIDES = ['floor', 'onBottom', 'besideBottom'];
const FACADES = ['open', 'doorLeft', 'doorRight', 'doors2'];
const problems = [];
let cases = 0;

function inspect(model, label) {
  cases += 1;
  // Крепёж, который по своей сути обхватывает деталь (штифт полкодержателя,
  // фланец штанги), в проверке пересечений не участвует — он и должен
  // соприкасаться с панелью и полкой.
  const EMBRACING = { shelfPin: 1, rodFlange: 1 };
  const boxes = [];
  model.partsRaw.forEach((r) => {
    if (EMBRACING[r.kind]) return;
    // Задняя стенка В ПАЗ по определению заходит в тело деталей на глубину
    // паза — это не пересечение, а способ сборки.
    // Деталь, вложенная В ПАЗ (задняя стенка корпуса, дно ящика Quadro),
    // по определению заходит в тело соседей на глубину паза — это способ
    // сборки, а не пересечение.
    const inGroove = (r.kind === 'back' || r.kind === 'drawerBottom')
      && /паз/i.test(r.note || '');
    r.boxes.forEach((b) => boxes.push(Object.assign({ n: r.name, k: r.kind, groove: inGroove }, b)));
  });
  // Держатель штанги по своей сути обхватывает трубу и прилегает к панели —
  // такое «пересечение» физически нормально и проверкой не считается.
  const embracing = (a, b) => a.k === 'rodFlange' || b.k === 'rodFlange' || a.groove || b.groove;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (embracing(boxes[i], boxes[j])) continue;
      if (overlaps(boxes[i], boxes[j])) problems.push(`${label}: пересекаются «${boxes[i].n}» и «${boxes[j].n}»`);
    }
  }
  const nums = model.parts.filter((p) => !p.hardware).map((p) => p.num);
  if (nums.some((v, i) => v !== i + 1)) problems.push(`${label}: разрыв в нумерации деталировки`);
  const sp = buildSpecification(model);
  const rows = [].concat(sp.sheetMaterials || [], sp.edging || [], sp.hardware || [], sp.fasteners || []);
  const sum = rows.reduce((a, r) => a + (Number(r.sum) || 0), 0);
  const total = Number(sp.totalCost);
  // Внимание: сравнение с NaN всегда ложно, поэтому конечность проверяем явно —
  // иначе битый итог сметы молча проходил бы проверку.
  if (!Number.isFinite(total)) problems.push(`${label}: итог сметы не число (${sp.totalCost})`);
  else if (Math.abs(sum - total) > 1) problems.push(`${label}: итог сметы ${total} ≠ сумме позиций ${Math.round(sum)}`);
  // Количество лежит в разных полях: листы — sheets, кромка — length_m,
  // фурнитура и метизы — qty.
  const amountOf = (r) => (r.qty !== undefined ? r.qty : (r.sheets !== undefined ? r.sheets : r.length_m));
  const bad = rows.filter((r) => !Number.isFinite(Number(r.sum)) || !Number.isFinite(Number(amountOf(r))));
  if (bad.length) {
    problems.push(`${label}: битая позиция сметы — ${bad[0].name || bad[0].type || bad[0].code}`);
  }
  if (cases % 97 === 0) {
    const html = JSON.stringify(buildDrawings(model));
    if (/NaN|Infinity|Поз\. null/.test(html)) problems.push(`${label}: NaN/null в чертеже`);
  }
  // Присадка на ЛИЦЕВОЙ/ЗАДНЕЙ стороне детали (side 'front'/'back') задаётся
  // в системе координат самой детали: x в [0, length], y в [0, width]
  // (см. комментарий в makePart). Отверстие ЗА пределами этого прямоугольника
  // означает, что его считали от чужого измерения — деталь на станке such
  // отверстие получит, но оно не попадёт в соседнюю деталь при сборке.
  // Регрессия на баг присадки конфирматов планки НА РЕБРО (v161→v162):
  // формула путала поле width (ширина доски для раскроя) с box.d (реальная
  // глубина в 3D), из-за чего точка крепежа улетала за пределы детали.
  const MARGIN = 2;   // мм, допуск на округление
  model.partsRaw.forEach((r) => {
    for (const h of (r.holes || [])) {
      if (h.side !== 'front' && h.side !== 'back') continue;
      if (h.x < -MARGIN || h.x > r.length + MARGIN || h.y < -MARGIN || h.y > r.width + MARGIN) {
        problems.push(`${label}: отверстие «${h.kind}» на «${r.name}» вне детали `
          + `(x=${h.x}, y=${h.y}, деталь ${r.length}×${r.width})`);
      }
    }
  });

  // Присадка на планке НА РЕБРО (topType 'railsEdge', box.h — просторная
  // ось стойки, box.d — тонкая толщина плиты): конфирмат должен стоять по
  // центру высоты стойки, а нагели против проворота — симметрично, по 25 мм
  // от каждого края. Регрессия на баг координат (v164→v165): раньше «y» брали
  // от глубины плиты (18 мм) — там негде развернуться, нагель вообще не
  // ставился, а конфирмат съезжал к одному краю на 3D-метке.
  model.partsRaw.forEach((r) => {
    if (r.kind !== 'top' || !(r.box.d < r.box.h)) return;
    const railW = r.box.h;
    const cf = r.holes.find((h) => h.kind === 'confirmatEdge' || h.kind === 'minifixBolt');
    if (cf && Math.abs(cf.y - railW / 2) > 0.6) {
      problems.push(`${label}: конфирмат/шток на «${r.name}» не по центру стойки `
        + `(y=${cf.y}, ожидалось ${railW / 2})`);
    }
    // По одному нагелю с каждого торца (у левой и у правой боковины) —
    // считаем УНИКАЛЬНЫЕ значения y, а не все holes подряд.
    const dowels = Array.from(new Set(r.holes.filter((h) => h.kind === 'dowelEdge').map((h) => h.y)))
      .sort((a, b) => a - b);
    if (dowels.length) {
      const want = [25, railW - 25].sort((a, b) => a - b);
      if (dowels.length !== 2 || Math.abs(dowels[0] - want[0]) > 0.6 || Math.abs(dowels[1] - want[1]) > 0.6) {
        problems.push(`${label}: нагели на «${r.name}» не в 25 мм от краёв стойки `
          + `(y=${dowels.join(',')}, ожидалось ${want.join(',')})`);
      }
    }
  });

  // Верхняя чашка петли не должна попадать в габарит верхней планки/царги
  // (topType 'rails'/'railsEdge'): ответную планку петли крепят к боковине
  // ровно на этой высоте, и планка поперёк корпуса физически мешает.
  // Регрессия на баг, обнаруженный на угловом модуле под мойку (v160→v161).
  const CUP_R = 17.5;   // радиус чашки Ø35 — центр должен быть дальше этого от планки
  const doors = model.partsRaw.filter((r) => r.kind === 'door');
  const rails = model.partsRaw.filter((r) => r.kind === 'top' && /Планка верхняя/.test(r.name));
  for (const d of doors) {
    const bottomWorld = d.box.y - d.box.h / 2;
    for (const h of (d.holes || [])) {
      if (h.kind !== 'hingeCup' && h.kind !== 'hingeGlass') continue;
      const worldY = bottomWorld + h.y;
      for (const r of rails.filter((x) => x.module === d.module)) {
        const r0 = r.box.y - r.box.h / 2, r1 = r.box.y + r.box.h / 2;
        if (worldY > r0 - CUP_R && worldY < r1 + CUP_R) {
          problems.push(`${label}: петля «${d.name}» (y=${Math.round(worldY)}) задевает `
            + `«${r.name}» (${Math.round(r0)}..${Math.round(r1)})`);
        }
      }
    }
  }
}

const base = {
  bodyThickness: 18, backThickness: 3,
  decor: DECORS[0], backMaterial: BACK_MATERIALS[0],
  drawerDecor: DECORS[1] || DECORS[0], drawerThickness: 16,
  jointType: 'confirmat',
};

// --- одиночный модуль: полный перебор ключевых сочетаний --------------------
for (const L of SIDES) for (const R of SIDES)
for (const bt of ['plinth', 'legs', 'legsPlinth']) for (const bh of [0, 100, 150])
for (const H of [500, 900, 2100]) for (const n of [0, 2, 4]) for (const fac of FACADES)
for (const sys of DRAWER_SYSTEM_ORDER) for (const D of [350, 600]) {
  inspect(buildModel(Object.assign({}, base, {
    modules: [{
      name: 'M', width: 1200, height: H, depth: D, leftSide: L, rightSide: R,
      base: bt === 'plinth' ? { type: 'plinth', plinthHeight: bh } : { type: bt, legHeight: bh },
      sections: [{ shelves: 2, drawers: n, facade: fac, drawerSystem: sys }],
    }],
  })), `${L}/${R} ${bt}${bh} H${H} D${D} ${fac} ${sys} n${n}`);
}

// --- ряды модулей: сквозной цоколь, разная глубина и высота -----------------
const sec = (o) => Object.assign({ shelves: 1, drawers: 0, facade: 'doors2', drawerSystem: 'ballBearing', widthMode: 'auto' }, o);
const rows = [
  [{ H: 850, D: 560, L: 'floor', R: 'onBottom', s: [sec({})] },
   { H: 850, D: 560, L: 'onBottom', R: 'onBottom', s: [sec({ drawers: 3, facade: 'open' }), sec({})] },
   { H: 850, D: 350, L: 'onBottom', R: 'floor', s: [sec({})] }],
  [{ H: 720, D: 560, L: 'besideBottom', R: 'besideBottom', s: [sec({ drawers: 4, facade: 'open', drawerSystem: 'legrabox' })] },
   { H: 2100, D: 600, L: 'besideBottom', R: 'floor', s: [sec({ shelves: 5 })] }],
  [{ H: 600, D: 300, L: 'floor', R: 'floor', s: [sec({ widthMode: 'fixed', width: 300 }), sec({})] },
   { H: 900, D: 560, L: 'onBottom', R: 'besideBottom', s: [sec({ drawers: 2, facade: 'doorRight', drawerSystem: 'innotech' })] }],
];
for (const row of rows) for (const bt of ['plinth', 'legs', 'legsPlinth']) for (const bh of [0, 100]) {
  inspect(buildModel(Object.assign({}, base, {
    modules: row.map((m, i) => ({
      name: 'M' + (i + 1), width: 900, height: m.H, depth: m.D, leftSide: m.L, rightSide: m.R,
      base: bt === 'plinth' ? { type: 'plinth', plinthHeight: bh } : { type: bt, legHeight: bh },
      sections: m.s,
    })),
  })), `ряд ${rows.indexOf(row) + 1} ${bt}${bh}`);
}

// --- повороты модулей: ряд из трёх, каждый под своим углом ------------------
for (const r1 of [0, 90, 180, 270]) for (const r2 of [0, 90, 180, 270]) {
  inspect(buildModel(Object.assign({}, base, {
    modules: [
      { name: 'A', width: 800, height: 850, depth: 560, rotation: r1, leftSide: 'floor', rightSide: 'floor',
        base: { type: 'plinth', plinthHeight: 100 },
        sections: [{ shelves: 1, drawers: 2, facade: 'doorLeft', drawerSystem: 'tandembox' }] },
      { name: 'B', width: 600, height: 2100, depth: 350, rotation: r2, leftSide: 'besideBottom', rightSide: 'floor',
        base: { type: 'legs', legHeight: 100 },
        sections: [{ shelves: 4, drawers: 0, facade: 'doors2', drawerSystem: 'ballBearing' }] },
    ],
  })), `повороты ${r1}/${r2}`);
}

// --- направление фасада при повороте: подписи в меню обязаны совпадать -----
const FACING = { 0: 'вперёд', 90: 'вправо', 180: 'назад', 270: 'влево' };
for (const rot of [0, 90, 180, 270]) {
  const model = buildModel(Object.assign({}, base, {
    modules: [{ name: 'A', width: 800, height: 850, depth: 560, rotation: rot,
      leftSide: 'floor', rightSide: 'floor', base: { type: 'plinth', plinthHeight: 100 },
      sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft', drawerSystem: 'ballBearing' }] }],
  }));
  const door = model.parts.filter((p) => p.kind === 'door')[0];
  const b = door.boxes[0];
  const dx = b.x - model.modules[0].offsetX, dz = b.z;
  const facing = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'вправо' : 'влево') : (dz > 0 ? 'вперёд' : 'назад');
  if (facing !== FACING[rot]) {
    problems.push(`поворот ${rot}°: фасад смотрит «${facing}», а в меню написано «${FACING[rot]}»`);
  }
  cases += 1;
}

// --- база готовых модулей: каждый вариант должен строиться без замечаний ----
const { PRESETS } = window.Modul3D.presets;
for (const group of PRESETS) {
  for (const item of group.items) {
    const m = item.make();
    const model = buildModel(Object.assign({}, base, {
      modules: [{
        name: m.name, width: m.width, height: m.height, depth: m.depth,
        rotation: m.rotation, corner: m.corner,
        topType: m.topType, railWidth: m.railWidth,
        leftSide: m.leftSide, rightSide: m.rightSide,
        base: m.baseType === 'plinth' ? { type: 'plinth', plinthHeight: m.plinthHeight }
                                      : { type: m.baseType, legHeight: m.legHeight },
        sections: m.sections,
      }],
    }));
    inspect(model, `база: ${group.name} / ${item.name}`);
    if (model.warnings.length) {
      problems.push(`база: ${group.name} / ${item.name}: ${model.warnings[0]}`);
    }
    if (!model.parts.length) problems.push(`база: ${group.name} / ${item.name}: пустой модуль`);
    // Заявленные габариты в подписи варианта должны совпадать с фактическими
    const dec = /(\d+)×(\d+)×(\d+)/.exec(item.note || '');
    if (dec && (Number(dec[1]) !== m.width || Number(dec[2]) !== m.height || Number(dec[3]) !== m.depth)) {
      problems.push(`база: ${group.name} / ${item.name}: подпись «${dec[0]}» не совпадает с модулем `
        + `${m.width}×${m.height}×${m.depth}`);
    }
  }
}

// --- узкий фасад (угловые модули): не шире проёма, прижат к краю ------------
for (const side of ['doorLeft', 'doorRight']) for (const fw of [300, 400, 600, 2000]) {
  const model = buildModel(Object.assign({}, base, {
    modules: [{ name: 'У', width: 900, height: 820, depth: 900, leftSide: 'floor', rightSide: 'floor',
      base: { type: 'plinth', plinthHeight: 100 },
      sections: [{ shelves: 1, drawers: 0, facade: side, facadeWidth: fw, drawerSystem: 'ballBearing' }] }],
  }));
  inspect(model, `узкий фасад ${side} ${fw}`);
  // глубокий угловой модуль с фасадом уже 350 мм обязан предупреждать
  const warned = model.warnings.some((w) => /не подлезть/.test(w));
  if (fw < 350 && !warned) problems.push(`узкий фасад ${side} ${fw}: нет предупреждения о тесном проёме`);
  if (fw >= 400 && warned) problems.push(`узкий фасад ${side} ${fw}: лишнее предупреждение`);
  const door = model.parts.filter((p) => p.kind === 'door')[0];
  if (!door) { problems.push(`узкий фасад ${side} ${fw}: фасад не построен`); continue; }
  const b = door.boxes[0];
  const L = b.x - b.w / 2, R = b.x + b.w / 2;
  if (L < -450 - 0.6 || R > 450 + 0.6) problems.push(`узкий фасад ${side} ${fw}: выходит за корпус`);
  if (fw < 900) {
    if (Math.abs(b.w - fw) > 0.6) problems.push(`узкий фасад ${side} ${fw}: ширина ${b.w}`);
    const hugsLeft = Math.abs(L - (-450 + 1.5)) < 1;
    const hugsRight = Math.abs(R - (450 - 1.5)) < 1;
    if (side === 'doorLeft' && !hugsLeft) problems.push(`узкий фасад ${side} ${fw}: не прижат к левому краю`);
    if (side === 'doorRight' && !hugsRight) problems.push(`узкий фасад ${side} ${fw}: не прижат к правому краю`);
  } else if (Math.abs(b.w - (900 - 2 * 1.5)) > 0.6) {
    problems.push(`узкий фасад ${side} ${fw}: должен быть во всю секцию, а он ${b.w}`);
  }
}

// --- штанга: попадает в модель и в спецификацию, не вылезает за секцию ------
for (const h of [1000, 1900, 5000]) {
  const model = buildModel(Object.assign({}, base, {
    modules: [{ name: 'Ш', width: 900, height: 2200, depth: 600, leftSide: 'floor', rightSide: 'floor',
      base: { type: 'plinth', plinthHeight: 100 },
      sections: [{ shelves: 2, drawers: 0, facade: 'doors2', rod: true, rodHeight: h, drawerSystem: 'ballBearing' }] }],
  }));
  inspect(model, `штанга ${h}`);
  const rod = model.parts.filter((p) => p.kind === 'rod')[0];
  if (!rod) { problems.push(`штанга ${h}: не построена`); continue; }
  const top = rod.boxes[0].y + rod.boxes[0].h / 2;
  if (top > 2200 - 16) problems.push(`штанга ${h}: выходит за крышу (верх ${Math.round(top)} мм)`);
  const sp = buildSpecification(model);
  if (!(sp.hardware || []).some((r) => /Штанга/.test(r.name))) problems.push(`штанга ${h}: нет в спецификации`);
}

// --- Г-образная кухня: угловой модуль поворачивает ряд ---------------------
{
  const K = window.Modul3D.presets.PRESETS.filter((g) => g.id === 'kitchen')[0];
  const byId = (id) => K.items.filter((i) => i.id === id)[0].make();
  const toModule = (m, i) => ({
    name: `Модуль ${i + 1}`, width: m.width, height: m.height, depth: m.depth,
    rotation: m.rotation, corner: m.corner, topType: m.topType, railWidth: m.railWidth,
    leftSide: m.leftSide, rightSide: m.rightSide,
    base: m.baseType === 'plinth' ? { type: 'plinth', plinthHeight: m.plinthHeight }
                                  : { type: m.baseType, legHeight: m.legHeight },
    sections: m.sections,
  });
  const L = [byId('lower600'), byId('lower600drawers'), byId('cornerLower'),
             byId('sink800'), byId('lower600')].map(toModule);
  const model = buildModel(Object.assign({}, base, { modules: L }));
  inspect(model, 'Г-образная кухня');

  const after = model.modules.slice(3);
  if (!after.every((m) => m.rotation === 270)) {
    problems.push('Г-образная кухня: модули после углового не развернулись на 90°');
  }
  if (model.modules.slice(0, 3).some((m) => m.rotation !== 0)) {
    problems.push('Г-образная кухня: модули до углового развёрнуты, а не должны');
  }
  // Второй прогон обязан идти в глубину от углового, а не продолжать первый ряд
  const corner = model.modules[2];
  if (!(after[0].offsetZ > corner.offsetZ + 100)) {
    problems.push('Г-образная кухня: второй ряд не ушёл вперёд от углового модуля');
  }
  if (Math.abs(after[0].offsetX - after[1].offsetX) > 1) {
    problems.push('Г-образная кухня: второй ряд не выстроился по одной линии');
  }
  cases += 1;
}

// --- верх модуля: цельная крышка или две планки ----------------------------
for (const topType of ['panel', 'rails']) {
  const model = buildModel(Object.assign({}, base, {
    modules: [{ name: 'Т', width: 600, height: 820, depth: 560, topType,
      leftSide: 'floor', rightSide: 'floor', base: { type: 'plinth', plinthHeight: 100 },
      sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft', drawerSystem: 'ballBearing' }] }],
  }));
  inspect(model, `верх ${topType}`);
  const tops = model.parts.filter((p) => p.kind === 'top');
  if (topType === 'rails') {
    if (tops.length !== 2) problems.push('верх rails: должно быть две планки, а не ' + tops.length);
    if (tops.some((t) => t.width > 200)) problems.push('верх rails: планка шире 200 мм');
    if (tops.some((t) => /Крыша/.test(t.name))) problems.push('верх rails: осталась цельная крышка');
  } else if (tops.length !== 1) {
    problems.push('верх panel: должна быть одна крышка');
  }
}

// --- подпись модуля стоит в ЕГО левом верхнем углу -------------------------
{
  const mk = (nm, h) => ({ name: nm, width: 800, height: h, depth: 560,
    leftSide: 'floor', rightSide: 'floor', base: { type: 'plinth', plinthHeight: 100 },
    sections: [{ shelves: 2, drawers: 0, facade: 'doorLeft', drawerSystem: 'ballBearing' }] });
  const model = buildModel(Object.assign({}, base, {
    modules: [mk('Модуль 1', 2100), mk('Модуль 2', 850), mk('Модуль 3', 850)],
  }));
  const html = String(buildDrawings(model));
  const found = {};
  const re = /<text x="([-\d.]+)" y="([-\d.]+)" class="dw-sec"[^>]*>([^<]+)</g;
  let r;
  while ((r = re.exec(html))) if (!found[r[3]]) found[r[3]] = { x: +r[1], y: +r[2] };
  const names = ['Модуль 1', 'Модуль 2', 'Модуль 3'];
  if (names.some((n) => !found[n])) problems.push('на чертеже нет подписи какого-то модуля');
  else {
    // высокий модуль подписан выше низких, низкие — на одной высоте
    if (!(found['Модуль 1'].y < found['Модуль 2'].y - 50)) {
      problems.push('подпись модуля стоит не по его собственному верху');
    }
    if (Math.abs(found['Модуль 2'].y - found['Модуль 3'].y) > 0.6) {
      problems.push('модули одной высоты подписаны на разных уровнях');
    }
    if (!(found['Модуль 1'].x < found['Модуль 2'].x && found['Модуль 2'].x < found['Модуль 3'].x)) {
      problems.push('подписи модулей идут не слева направо');
    }
  }
  cases += 1;
}

// --- таблица деталей на чертеже обязана называть материал и кромку ---------
{
  const model = buildModel(Object.assign({}, base, {
    modules: [{ name: 'Модуль 1', width: 600, height: 820, depth: 560, topType: 'rails',
      leftSide: 'floor', rightSide: 'floor', base: { type: 'plinth', plinthHeight: 100 },
      sections: [{ shelves: 1, drawers: 1, facade: 'doorLeft', drawerSystem: 'ballBearing' }] }],
  }));
  const html = String(buildDrawings(model));
  const table = html.slice(html.indexOf('Спецификация деталей'));
  if (table.indexOf('<th>Материал</th>') === -1) problems.push('в спецификации деталей нет столбца «Материал»');
  if (table.indexOf(DECORS[0].name) === -1) problems.push('в спецификации деталей не напечатано название декора');
  if (table.indexOf(BACK_MATERIALS[0].name) === -1) problems.push('в спецификации деталей нет материала задней стенки');
  if (table.indexOf('<th>Кромка</th>') === -1) problems.push('в спецификации деталей нет столбца «Кромка»');
  cases += 1;
}

// --- материалы: корпус, ящики и дно ящика ---------------------------------
for (const sys of ['quadro', 'ballBearing', 'tandembox']) {
  const model = buildModel(Object.assign({}, base, {
    modules: [{ name: 'М', width: 600, height: 820, depth: 560, topType: 'rails',
      leftSide: 'floor', rightSide: 'floor', base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 0, drawers: 3, facade: 'open', drawerSystem: sys }] }],
  }));
  inspect(model, `материалы ${sys}`);
  const corpus = model.parts.filter((p) => p.kind === 'side')[0];
  if (corpus.thickness !== 18) problems.push(`материалы ${sys}: корпус ${corpus.thickness} вместо 18 мм`);
  if (corpus.material !== DECORS[0].code) problems.push(`материалы ${sys}: корпус не из декора проекта`);

  const boxParts = model.parts.filter((p) => /^(Боковина ящика|Перед\/зад ящика|Задняя стенка ящика)$/.test(p.name));
  if (boxParts.some((p) => p.thickness !== 16)) problems.push(`материалы ${sys}: короб не 16 мм`);
  if (boxParts.some((p) => p.material !== base.drawerDecor.code)) {
    problems.push(`материалы ${sys}: короб не из декора ящиков`);
  }
  const bottom = model.parts.filter((p) => p.name === 'Дно ящика')[0];
  if (!bottom) { problems.push(`материалы ${sys}: нет дна ящика`); continue; }
  if (sys === 'quadro' || sys === 'tandembox') {
    if (bottom.material !== base.drawerDecor.code || bottom.thickness !== 16) {
      problems.push(`материалы ${sys}: дно должно быть ЛДСП 16, а оно ${bottom.material} ${bottom.thickness}`);
    }
  } else if (bottom.material !== BACK_MATERIALS[0].code) {
    problems.push(`материалы ${sys}: дно должно быть ХДФ, а оно ${bottom.material}`);
  }
  if (!Number.isFinite(Number(bottom.thickness))) problems.push(`материалы ${sys}: толщина дна не число`);
  cases += 1;
}

// --- подпись боковины совпадает с моделью при любом основании -------------
for (const bt of ['plinth', 'legsPlinth', 'legs']) {
  for (const sd of ['floor', 'besideBottom', 'onBottom']) {
    const model = buildModel(Object.assign({}, base, {
      modules: [{ name: 'М', width: 600, height: 820, depth: 560, topType: 'rails',
        leftSide: sd, rightSide: sd,
        base: bt === 'plinth' ? { type: 'plinth', plinthHeight: 100 } : { type: bt, legHeight: 100 },
        sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft', drawerSystem: 'ballBearing' }] }],
    }));
    inspect(model, `боковина ${sd} на ${bt}`);
    const side = model.parts.filter((p) => p.kind === 'side')[0];
    const bottomY = side.boxes[0].y - side.boxes[0].h / 2;
    const label = model.modules[0].sidesLabel;

    // «до пола» обязано означать до пола при ЛЮБОМ основании
    if (sd === 'floor') {
      if (bottomY > 0.6) problems.push(`${bt}: боковина «до пола» стоит на ${bottomY} мм, а не на полу`);
      if (!/до пола/.test(label)) problems.push(`${bt}: подпись «${label}» не про «до пола»`);
      // цоколь входит МЕЖДУ такими боковинами
      const pl = model.parts.filter((p) => p.kind === 'plinth')[0];
      if (pl && Math.abs(pl.length - (600 - 2 * 18)) > 0.6) {
        problems.push(`${bt}: цоколь ${pl.length} мм не встал между боковинами до пола`);
      }
    } else if (sd === 'besideBottom') {
      if (Math.abs(bottomY - 100) > 0.6) problems.push(`${bt}: «сбоку дна» низ ${bottomY} вместо 100`);
      if (!/сбоку дна/.test(label)) problems.push(`${bt}: подпись «${label}» не про «сбоку дна»`);
    } else {
      if (Math.abs(bottomY - 118) > 0.6) problems.push(`${bt}: «на дно» низ ${bottomY} вместо 118`);
      if (!/на дно/.test(label)) problems.push(`${bt}: подпись «${label}» не про «на дно»`);
    }
    cases += 1;
  }
}

// --- основание «опоры с цоколем»: и планка, и пластиковые опоры ------------
{
  const model = buildModel(Object.assign({}, base, {
    modules: [{ name: 'К', width: 800, height: 820, depth: 560, topType: 'rails',
      // на опорах боковины не спускаются в зону цоколя — «сбоку дна»
      leftSide: 'besideBottom', rightSide: 'besideBottom',
      base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 1, drawers: 0, facade: 'doors2', drawerSystem: 'ballBearing' }] }],
  }));
  inspect(model, 'опоры с цоколем');
  const plinth = model.parts.filter((p) => p.kind === 'plinth');
  const legs = model.parts.filter((p) => p.kind === 'leg');
  if (!plinth.length) problems.push('опоры с цоколем: нет цокольной планки');
  if (!legs.length) problems.push('опоры с цоколем: нет опор');
  if (legs.some((l) => !l.plastic)) problems.push('опоры с цоколем: опоры не пластиковые');
  if (plinth.length && plinth[0].length !== 800) {
    problems.push(`опоры с цоколем: планка ${plinth[0].length} мм вместо 800 — боковины не должны её резать`);
  }
  // боковина стоит НА опоре, а не на полу
  const side = model.parts.filter((p) => p.kind === 'side')[0];
  const bottomY = side.boxes[0].y - side.boxes[0].h / 2;
  if (Math.abs(bottomY - 100) > 0.6) problems.push(`опоры с цоколем: низ боковины на ${bottomY} мм вместо 100`);
  const sp = buildSpecification(model);
  const hw = (sp.hardware || []).map((r) => r.name).join(' | ');
  if (!/пластиков/i.test(hw)) problems.push('опоры с цоколем: в смете нет пластиковых опор');
  if (!/Крепление цоколя/.test(hw)) problems.push('опоры с цоколем: в смете нет клипс цоколя');
  cases += 1;
}

// --- тип опоры выбирается явно, независимо от основания ---------------------
{
  // «Опоры» (без цоколя) + явно «металлическая» — металлические, без
  // клипсы, монтаж стандартный (не подтянута к чему-либо).
  const mMetalNoPlinth = buildModel(Object.assign({}, base, {
    modules: [{ name: 'К', width: 800, height: 820, depth: 560,
      base: { type: 'legs', legHeight: 100 }, legType: 'metal',
      sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft' }] }],
  }));
  inspect(mMetalNoPlinth, 'тип опоры: металлическая без цоколя');
  const legsMn = mMetalNoPlinth.partsRaw.filter((p) => p.kind === 'leg');
  if (legsMn.some((l) => l.plastic || l.legType !== 'metal' || l.hasClip)) {
    problems.push('тип опоры: явная «металлическая» без цоколя всё равно пластиковая/с клипсой');
  }

  // «Опоры с цоколем» + явно «металлическая» — держать цоколь клипсой
  // умеет только кухонная опора, у металлической клипсы нет. Это
  // сочетание принудительно кухонное (UI это же правило и соблюдает —
  // «металлическая» там недоступна при выборе цоколя), иначе цоколь и
  // опора физически пересекались бы.
  const mMetal = buildModel(Object.assign({}, base, {
    modules: [{ name: 'К', width: 800, height: 820, depth: 560,
      leftSide: 'besideBottom', rightSide: 'besideBottom',
      base: { type: 'legsPlinth', legHeight: 100 }, legType: 'metal',
      sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft' }] }],
  }));
  inspect(mMetal, 'тип опоры: явная металлическая с цоколем — принудительно кухонная');
  const legsM = mMetal.partsRaw.filter((p) => p.kind === 'leg');
  if (legsM.some((l) => !l.plastic || l.legType !== 'kitchen')) {
    problems.push('тип опоры: «металлическая» при цоколе не подменилась кухонной');
  }
  if (legsM.filter((l) => l.hasClip).length !== 2) {
    problems.push('тип опоры: у принудительно-кухонной с цоколем нет клипс на переднем ряду');
  }

  // Передний ряд металлической опоры без цоколя должен стоять на
  // стандартном отступе, а НЕ подтягиваться назад (регрессия: раньше
  // положение опоры зависело только от наличия цоколя у модуля, а не от
  // того, умеет ли опора его держать).
  const zFrontMetal = Math.max(...legsMn.map((l) => l.box.z));
  const zFrontForcedKitchen = Math.max(...legsM.map((l) => l.box.z));
  if (Math.abs(zFrontMetal - zFrontForcedKitchen) < 5) {
    problems.push('тип опоры: передний ряд металлической без цоколя не отличается от подтянутой кухонной с цоколем');
  }

  // «Опоры» (без цоколя) + явно «кухонная» — опоры пластиковые, но БЕЗ
  // клипсы (клипсе нечего держать без цоколя), и на том же стандартном
  // отступе, что и металлическая без цоколя (без подтяжки).
  const mKitchenNoPlinth = buildModel(Object.assign({}, base, {
    modules: [{ name: 'К', width: 800, height: 820, depth: 560,
      base: { type: 'legs', legHeight: 100 }, legType: 'kitchen',
      sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft' }] }],
  }));
  inspect(mKitchenNoPlinth, 'тип опоры: кухонная без цоколя');
  const legsKn = mKitchenNoPlinth.partsRaw.filter((p) => p.kind === 'leg');
  if (legsKn.some((l) => !l.plastic || l.hasClip)) {
    problems.push('тип опоры: кухонная без цоколя — не должно быть клипсы');
  }
  const zFrontKitchenNoPlinth = Math.max(...legsKn.map((l) => l.box.z));
  if (Math.abs(zFrontKitchenNoPlinth - zFrontMetal) > 0.6) {
    problems.push('тип опоры: кухонная без цоколя стоит не на том же отступе, что металлическая без цоколя');
  }

  // «Опоры с цоколем» + «кухонная» — у переднего ряда клипса, и в цоколе
  // напротив каждой — отверстие под её крепёж.
  const mKitchenPlinth = buildModel(Object.assign({}, base, {
    modules: [{ name: 'К', width: 800, height: 820, depth: 560,
      leftSide: 'besideBottom', rightSide: 'besideBottom',
      base: { type: 'legsPlinth', legHeight: 100 }, legType: 'kitchen',
      sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft' }] }],
  }));
  inspect(mKitchenPlinth, 'тип опоры: кухонная с цоколем — клипса и присадка в цоколе');
  const legsKp = mKitchenPlinth.partsRaw.filter((p) => p.kind === 'leg');
  const clippedLegs = legsKp.filter((l) => l.hasClip);
  if (clippedLegs.length !== 2) problems.push(`тип опоры: клипс ${clippedLegs.length} вместо 2 (по одной на передний ряд)`);
  const plinthKp = mKitchenPlinth.partsRaw.find((p) => p.kind === 'plinth');
  const clipHoles = plinthKp ? plinthKp.holes.filter((h) => h.kind === 'legFix') : [];
  // По каталожному чертежу площадка клипсы крепится ДВУМЯ шурупами
  // (38×30 мм, 2×Ø5,5 с шагом 25 мм) — на каждую клипсу 2 отверстия.
  if (clipHoles.length !== clippedLegs.length * 2) {
    problems.push(`тип опоры: в цоколе ${clipHoles.length} отверстий под клипсу вместо ${clippedLegs.length * 2}`);
  }
  for (const h of clipHoles) {
    if (h.side !== 'back' || h.through) problems.push('тип опоры: отверстие под клипсу в цоколе не с внутренней стороны/сквозное');
    if (plinthKp && (h.x < -0.5 || h.x > plinthKp.length + 0.5 || h.y < -0.5 || h.y > plinthKp.width + 0.5)) {
      problems.push(`тип опоры: отверстие под клипсу (${h.x}, ${h.y}) вне цоколя ${plinthKp.length}×${plinthKp.width}`);
    }
  }
  // площадка кухонной опоры сверлится в дне так же, как у металлической —
  // по 4 отверстия на опору.
  const bottomKp = mKitchenPlinth.partsRaw.find((p) => p.kind === 'bottom');
  const legFixKp = bottomKp ? bottomKp.holes.filter((h) => h.kind === 'legFix') : [];
  if (legFixKp.length !== legsKp.length * 4) {
    problems.push(`тип опоры: в дне кухонных опор ${legFixKp.length} отверстий вместо ${legsKp.length * 4}`);
  }
  cases += 1;
}

// --- ручки: присадка на фасадах, две ручки на широком, выгрузка для ЧПУ ----
{
  const { HANDLES } = window.Modul3D.catalog;
  const mk = (sec, W) => buildModel(Object.assign({}, base, {
    modules: [{ name: 'М', width: W || 800, height: 820, depth: 560, topType: 'rails',
      leftSide: 'floor', rightSide: 'floor', base: { type: 'legsPlinth', legHeight: 100 },
      sections: [sec] }],
  }));
  const holesOf = (model, re) => {
    const p = model.parts.filter((x) => re.test(x.name))[0];
    return p ? p.holes : null;
  };
  const inside = (p, hs) => hs.every((h) => h.x > 8 && h.x < p.length - 8 && h.y > 8 && h.y < p.width - 8);

  for (const id of ['knob', 'bow96', 'bow128', 'bow160', 'bow192', 'bow224', 'bow320']) {
    const need = HANDLES[id].holes;
    for (const fac of ['doorLeft', 'doorRight', 'doors2', 'liftUp']) {
      const model = mk({ shelves: 1, drawers: 0, facade: fac, handle: id, lift: 'hettichHL', drawerSystem: 'ballBearing' });
      const door = model.parts.filter((x) => x.kind === 'door')[0];
      if (!door) { problems.push(`ручки ${id}/${fac}: нет фасада`); continue; }
      // на двери кроме ручки есть ещё чашки петель — считаем только сквозные
      const hh = door.holes.filter((h) => h.through);
      if (hh.length !== need) problems.push(`ручки ${id}/${fac}: отверстий ${hh.length}, надо ${need}`);
      if (!inside(door, door.holes)) problems.push(`ручки ${id}/${fac}: отверстие вылезло за фасад`);
      if (hh.some((h) => h.d !== 5)) problems.push(`ручки ${id}/${fac}: диаметр ручки не 5 мм`);
      cases += 1;
    }
    // ящик: одна ручка на узком, две на широком
    const narrow = mk({ shelves: 0, drawers: 2, facade: 'open', handle: id, drawerSystem: 'ballBearing' }, 800);
    const wide = mk({ shelves: 0, drawers: 2, facade: 'open', handle: id, drawerSystem: 'ballBearing' }, 1200);
    const onlyHandle = (hs) => (hs || []).filter((h) => h.through);
    const hn = onlyHandle(holesOf(narrow, /Фасад ящика 1/)), hw = onlyHandle(holesOf(wide, /Фасад ящика 1/));
    if (!hn || hn.length !== need) problems.push(`ручки ${id}: на узком ящике не ${need} отв.`);
    if (!hw || hw.length !== need * 2) problems.push(`ручки ${id}: на широком ящике должно быть две ручки`);
    // На широком фасаде крайние отверстия — ровно в 50 мм от торцов
    if (hw && hw.length === need * 2) {
      const face = wide.parts.filter((p) => /Фасад ящика 1/.test(p.name))[0];
      const xs = hw.map((h) => h.x).sort((a, b) => a - b);
      if (Math.abs(xs[0] - 50) > 0.6) problems.push(`ручки ${id}: слева ${xs[0]} мм вместо 50`);
      if (Math.abs(face.length - xs[xs.length - 1] - 50) > 0.6) {
        problems.push(`ручки ${id}: справа ${(face.length - xs[xs.length - 1]).toFixed(1)} мм вместо 50`);
      }
    }
    cases += 2;
  }
  // ручка видна в модели: перед фасадом стоит деталь-ручка
  for (const id of ['knob', 'bow160']) {
    const model = mk({ shelves: 1, drawers: 0, facade: 'doorLeft', handle: id, drawerSystem: 'ballBearing' });
    const hp = model.parts.filter((p) => p.kind === 'handle');
    const door = model.parts.filter((p) => p.kind === 'door')[0];
    if (!hp.length) { problems.push(`ручка ${id}: не появилась в модели`); continue; }
    const hb = hp[0].boxes[0], db = door.boxes[0];
    if (!(hb.z > db.z)) problems.push(`ручка ${id}: стоит не перед фасадом`);
    if (!hp[0].hardware) problems.push(`ручка ${id}: попала в деталировку`);
    cases += 1;
  }

  // ножки ручки обязаны стоять ровно в отверстиях присадки
  for (const id of ['bow96', 'bow160', 'bow320']) {
    for (const fac of ['doorLeft', 'open']) {
      const model = mk(fac === 'open'
        ? { shelves: 0, drawers: 1, facade: 'open', handle: id, drawerSystem: 'ballBearing' }
        : { shelves: 1, drawers: 0, facade: 'doorLeft', handle: id, drawerSystem: 'ballBearing' });
      const face = model.partsRaw.filter((p) => p.kind === (fac === 'open' ? 'drawerFront' : 'door'))[0];
      const hd = model.partsRaw.filter((p) => p.kind === 'handle')[0];
      if (!face || !hd) { problems.push(`ножки ручки ${id}/${fac}: нет фасада или ручки`); continue; }
      const fb = face.boxes[0], hb = hd.boxes[0];
      const cc = hd.cc;
      if (!cc) { problems.push(`ножки ручки ${id}: у детали не записано межосевое`); continue; }
      const through = face.holes.filter((h) => h.through);
      const vertical = hd.shape === 'handleBowV';
      for (const h of through) {
        const gx = fb.x - fb.w / 2 + h.x, gy = fb.y - fb.h / 2 + h.y;
        // ось ножки: по вертикали или по горизонтали от центра ручки
        const post = vertical
          ? { x: hb.x, y: gy > hb.y ? hb.y + cc / 2 : hb.y - cc / 2 }
          : { x: gx > hb.x ? hb.x + cc / 2 : hb.x - cc / 2, y: hb.y };
        if (Math.abs(post.x - gx) > 0.6 || Math.abs(post.y - gy) > 0.6) {
          problems.push(`ножки ручки ${id}/${fac}: ножка (${post.x.toFixed(1)}, ${post.y.toFixed(1)}) `
            + `не совпала с отверстием (${gx.toFixed(1)}, ${gy.toFixed(1)})`);
        }
      }
      cases += 1;
    }
  }

  // своё межосевое
  const cust = mk({ shelves: 0, drawers: 1, facade: 'open', handle: 'custom', handleCC: 224, drawerSystem: 'ballBearing' });
  const cf = cust.parts.filter((p) => /Фасад ящика/.test(p.name))[0];
  const ch = cf ? cf.holes.filter((h) => h.through) : [];
  if (ch.length !== 2) problems.push('своё межосевое: нет двух отверстий');
  else if (Math.abs((ch[1].x - ch[0].x) - 224) > 0.6) {
    problems.push(`своё межосевое: получилось ${ch[1].x - ch[0].x} вместо 224`);
  }
  const noCC = mk({ shelves: 0, drawers: 1, facade: 'open', handle: 'custom', handleCC: 0, drawerSystem: 'ballBearing' });
  if (!noCC.warnings.some((w) => /межосевое/.test(w))) problems.push('своё межосевое: пустое значение прошло молча');
  cases += 2;

  // без ручек — присадки нет
  const none = mk({ shelves: 1, drawers: 1, facade: 'doorLeft', handle: 'none', drawerSystem: 'ballBearing' });
  // Сквозные отверстия под ручку. Крепление фасада к ящику тоже сквозное
  // (через переднюю стенку короба), но это не ручка — его не считаем.
  if (none.parts.some((p) => (p.holes || []).some((h) => h.through && h.kind === 'handle'))) {
    problems.push('ручки none: присадка под ручку всё равно появилась');
  }

  // подъёмник: попадает в смету, вне диапазона — предупреждение
  const lift = mk({ shelves: 0, drawers: 0, facade: 'liftUp', handle: 'knob', lift: 'sametRapid', drawerSystem: 'ballBearing' });
  const sp = buildSpecification(lift);
  if (!(sp.hardware || []).some((r) => /Samet Rapid/.test(r.name))) problems.push('подъёмник не попал в смету');
  if (!lift.warnings.some((w) => /вне диапазона/.test(w))) problems.push('подъёмник вне диапазона — нет предупреждения');
  if ((sp.hardware || []).some((r) => /Петля/.test(r.name))) problems.push('у откидного фасада не должно быть петель');

  // петли: чашки Ø35 с изнанки, отступы по стандарту
  for (const H of [820, 1400, 2140]) {
    const model = mk({ shelves: 1, drawers: 0, facade: 'doorLeft', handle: 'bow128', drawerSystem: 'ballBearing' });
    const door = model.parts.filter((p) => p.kind === 'door')[0];
    const cups = door.holes.filter((h) => h.kind === 'hingeCup');
    if (cups.length < 2) { problems.push('петли: чашек меньше двух'); continue; }
    if (cups.some((c) => c.d !== 35)) problems.push('петли: диаметр чашки не 35');
    if (cups.some((c) => c.through)) problems.push('петли: чашка сквозная');
    if (cups.some((c) => c.side !== 'back')) problems.push('петли: чашка не с изнанки');
    if (Math.abs(cups[0].x - 22) > 0.6) problems.push(`петли: отступ от края ${cups[0].x} вместо 22`);
    if (Math.abs(cups[0].y - 100) > 0.6) problems.push(`петли: нижняя чашка на ${cups[0].y} вместо 100`);
    if (Math.abs(cups[cups.length - 1].y - (door.width - 100)) > 0.6) {
      problems.push('петли: верхняя чашка не в 100 мм от верха');
    }
    cases += 1;
  }
  // у откидного фасада петель нет
  const lifted = mk({ shelves: 0, drawers: 0, facade: 'liftUp', handle: 'knob', lift: 'hettichHL', drawerSystem: 'ballBearing' });
  const lf = lifted.parts.filter((p) => p.kind === 'door')[0];
  if (lf && lf.holes.some((h) => h.kind === 'hingeCup')) problems.push('откидной фасад: откуда-то взялись чашки петель');

  // скоба горизонтально и отступ от края до КРАЙНЕГО отверстия
  {
    const v = mk({ shelves: 1, drawers: 0, facade: 'doorLeft', handle: 'bow128', handleOrient: 'vertical', drawerSystem: 'ballBearing' });
    const dv = v.parts.filter((p) => p.kind === 'door')[0];
    const hv = dv.holes.filter((h) => h.through);
    const topGap = dv.width - Math.max(hv[0].y, hv[1].y);
    if (Math.abs(topGap - 50) > 0.6) problems.push(`скоба вертикально: до верхнего торца ${topGap} вместо 50`);
    if (Math.abs(hv[0].x - hv[1].x) > 0.6) problems.push('скоба вертикально: отверстия не на одной вертикали');

    const g = mk({ shelves: 1, drawers: 0, facade: 'doorLeft', handle: 'bow128', handleOrient: 'horizontal', drawerSystem: 'ballBearing' });
    const dg = g.parts.filter((p) => p.kind === 'door')[0];
    const hg = dg.holes.filter((h) => h.through);
    if (Math.abs(hg[0].y - hg[1].y) > 0.6) problems.push('скоба горизонтально: отверстия не на одной горизонтали');
    if (Math.abs(Math.abs(hg[0].x - hg[1].x) - 128) > 0.6) problems.push('скоба горизонтально: межосевое не 128');
    if (Math.abs(dg.length - Math.max(hg[0].x, hg[1].x) - 50) > 0.6) {
      problems.push('скоба горизонтально: нет отступа 50 мм от края открывания');
    }
    cases += 2;
  }

  // на чертеже ручку не рисуем, только присадку
  {
    const model = mk({ shelves: 1, drawers: 0, facade: 'doorLeft', handle: 'bow160', drawerSystem: 'ballBearing' });
    const html = String(buildDrawings(model, true));
    if (/Ручка \(/.test(html)) problems.push('чертёж: изображена сама ручка');
    if (!/dw-hole/.test(html)) problems.push('чертёж: нет присадки');
    if (html.indexOf('присадка:') === -1) problems.push('чертёж фасада: нет сводки по присадке');
    cases += 1;
  }

  // на чертеже фасада обязаны стоять размеры ОТ КРАЯ до отверстий,
  // и ни одна надпись не должна вылезти за поле чертежа
  {
    const model = mk({ shelves: 1, drawers: 0, facade: 'doorLeft', handle: 'bow128', drawerSystem: 'ballBearing' });
    const html = String(buildDrawings(model, true));
    const blk = html.slice(html.indexOf('Фасады'));
    const door = model.parts.filter((p) => p.kind === 'door')[0];
    const hand = door.holes.filter((h) => h.kind === 'handle');
    const cups = door.holes.filter((h) => h.kind === 'hingeCup' || h.kind === 'hingeGlass');
    const labels = [];
    const reL = /class="dw-dt"[^>]*>([^<]+)</g;
    let mm;
    while ((mm = reL.exec(blk))) labels.push(mm[1]);

    // Размеры проставляются ОТ БЛИЖНЕГО КРАЯ детали
    const nearX = (v) => Math.round(v > door.length / 2 ? door.length - v : v);
    const nearY = (v) => Math.round(v > door.width / 2 ? door.width - v : v);
    const hx = hand.map((h) => h.x), hy = hand.map((h) => h.y);
    const want = [
      String(nearX(Math.max.apply(null, hx) > door.length / 2
        ? Math.max.apply(null, hx) : Math.min.apply(null, hx))),
      String(nearY(Math.max.apply(null, hy) > door.width / 2
        ? Math.max.apply(null, hy) : Math.min.apply(null, hy))),
      String(nearX(cups[0].x)),
      String(nearY(cups[0].y)),
    ];
    for (const w of want) {
      if (labels.indexOf(w) === -1) problems.push(`чертёж фасада: нет размера ${w} мм до отверстия`);
    }

    const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(blk);
    if (vb) {
      const W = +vb[1], H = +vb[2];
      const re2 = /<text x="([-\d.]+)" y="([-\d.]+)" class="dw-dt"/g;
      let t2, out = 0;
      while ((t2 = re2.exec(blk))) { if (+t2[1] < 0 || +t2[2] < 0 || +t2[1] > W || +t2[2] > H) out += 1; }
      if (out) problems.push(`чертёж фасада: ${out} размерных надписей за полем чертежа`);
    }
    cases += 1;
  }

  // чашки петель обходят полки
  for (const sh of [1, 2, 3, 5, 7]) {
    const model = buildModel(Object.assign({}, base, {
      modules: [{ name: 'Ш', width: 600, height: 2100, depth: 560,
        leftSide: 'floor', rightSide: 'floor', base: { type: 'plinth', plinthHeight: 100 },
        sections: [{ shelves: sh, drawers: 0, facade: 'doorLeft', handle: 'bow128', drawerSystem: 'ballBearing' }] }],
    }));
    const door = model.parts.filter((p) => p.kind === 'door')[0];
    const b = door.boxes[0], bottom = b.y - b.h / 2;
    const shelves = [];
    model.parts.filter((p) => p.kind === 'shelf').forEach((p) => p.boxes.forEach((x) => shelves.push(x.y - bottom)));
    const cups = door.holes.filter((h) => h.kind === 'hingeCup');
    for (const c of cups) {
      const near = shelves.filter((sy) => Math.abs(c.y - sy) < 60);
      if (near.length) problems.push(`петли/полки (${sh} полок): чашка на ${c.y} мм совпала с полкой ${Math.round(near[0])}`);
      if (c.y < 55 || c.y > door.width - 55) problems.push(`петли/полки: чашка ${c.y} вылезла за фасад`);
    }
    if (cups.length < 2) problems.push(`петли/полки (${sh} полок): чашек осталось ${cups.length}`);
    cases += 1;
  }

  // отверстия попадают на чертёж
  {
    const model = mk({ shelves: 0, drawers: 2, facade: 'open', handle: 'bow160', drawerSystem: 'ballBearing' });
    const html = String(buildDrawings(model));
    const circles = (html.match(/class="dw-hole"/g) || []).length;
    if (!circles) problems.push('чертёж: присадка под ручку не показана');
    cases += 1;
  }

  // выгрузка для ЧПУ
  const model = mk({ shelves: 0, drawers: 3, facade: 'open', handle: 'bow160', drawerSystem: 'ballBearing' });
  const csv = window.Modul3D.cnc.buildDrillCsv(model);
  const dxf = window.Modul3D.cnc.buildDrillDxf(model);
  const rows = csv.trim().split('\r\n');
  // В CSV идут и отверстия, и пазы — операций больше, чем отверстий
  const totalHoles = model.parts.filter((p) => p.holes).reduce((s, p) => s + p.holes.length, 0);   // включая чашки
  const totalGrooves = model.parts.reduce((s, p) => s + ((p.grooves || []).length), 0);
  if (rows.length !== totalHoles + totalGrooves + 1) {
    problems.push(`ЧПУ: в CSV ${rows.length - 1} строк, операций ${totalHoles + totalGrooves}`);
  }
  if (/NaN|undefined/.test(csv)) problems.push('ЧПУ: в CSV пустые значения');
  if ((dxf.match(/CIRCLE/g) || []).length !== totalHoles) problems.push('ЧПУ: в DXF не все отверстия');
  if (dxf.indexOf('SECTION') === -1 || dxf.indexOf('EOF') === -1) problems.push('ЧПУ: DXF без обязательных секций');
  if (/NaN|undefined/.test(dxf)) problems.push('ЧПУ: в DXF пустые значения');
  cases += 1;
}

// --- ручки на смежных фасадах стоят на одном уровне от пола ---------------
{
  const model = buildModel(Object.assign({}, base, {
    modules: [{ name: 'Ш', width: 1600, height: 2200, depth: 600,
      leftSide: 'floor', rightSide: 'floor', base: { type: 'plinth', plinthHeight: 100 },
      sections: [
        { shelves: 2, drawers: 0, facade: 'doorLeft', handle: 'bow128', rod: true, drawerSystem: 'ballBearing' },
        { shelves: 2, drawers: 2, facade: 'doorRight', handle: 'bow128', drawerSystem: 'ballBearing' },
      ] }],
  }));
  const levels = [];
  model.partsRaw.filter((p) => p.kind === 'door').forEach((p) => {
    const b = p.boxes[0], bot = b.y - b.h / 2;
    const ys = p.holes.filter((h) => h.through).map((h) => bot + h.y);
    if (ys.length) levels.push((Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2);
  });
  if (levels.length < 2) problems.push('уровень ручек: дверей меньше двух');
  else {
    const spread = Math.max.apply(null, levels) - Math.min.apply(null, levels);
    if (spread > 1) problems.push(`уровень ручек: расхождение ${Math.round(spread)} мм на смежных фасадах`);
    if (Math.abs(levels[0] - 1000) > 60) problems.push(`уровень ручек: ${Math.round(levels[0])} мм от пола вместо ~1000`);
  }
  cases += 1;
}

// --- направляющие: присадка по фактическим коробам -------------------------
for (const sys of ['ballBearing', 'quadro', 'tandembox', 'legrabox']) {
  const model = buildModel(Object.assign({}, base, {
    modules: [{ name: 'Т', width: 600, height: 820, depth: 560, topType: 'rails',
      leftSide: 'floor', rightSide: 'floor', base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 0, drawers: 3, facade: 'open', handle: 'bow160', drawerSystem: sys }] }],
  }));
  const side = model.partsRaw.filter((p) => p.kind === 'side')[0];
  const sb = side.boxes[0];
  const run = side.holes.filter((h) => h.kind === 'drawerRunner');
  const boxes = model.partsRaw.filter((p) => /Дно ящика/.test(p.name));
  if (run.length !== boxes.length * 2) {
    problems.push(`направляющие ${sys}: отверстий ${run.length} на ${boxes.length} коробов`);
  }
  // первое отверстие в 37 мм от переднего края, второе кратно 32 дальше
  const fronts = [...new Set(run.map((h) => Math.round(sb.d - h.y)))].sort((a, b) => a - b);
  if (fronts[0] !== 37) problems.push(`направляющие ${sys}: первое отверстие в ${fronts[0]} мм вместо 37`);
  if (fronts.some((f) => (f - 37) % 32 !== 0)) problems.push(`направляющие ${sys}: шаг не кратен 32`);
  // каждая отметка направляющей должна попадать в высоту своего короба
  const ys = [...new Set(run.map((h) => sb.y - sb.h / 2 + h.x))];
  for (const y of ys) {
    const inBox = boxes.some((p) => {
      const b = p.boxes[0];
      return y >= b.y - b.h / 2 - 2 && y <= b.y - b.h / 2 + 200;
    });
    if (!inBox) problems.push(`направляющие ${sys}: отметка ${Math.round(y)} мм не привязана к коробу`);
  }
  cases += 1;
}

// --- раскрой коробов сверен с каталогами производителей --------------------
{
  const LW = 564, t = 18;   // проём модуля 600 при боковине 18
  const model = (sys) => buildModel(Object.assign({}, base, {
    modules: [{ name: 'Т', width: 600, height: 820, depth: 560, topType: 'rails',
      leftSide: 'besideBottom', rightSide: 'besideBottom', base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 0, drawers: 2, facade: 'open', drawerSystem: sys }] }],
  }));
  const partOf = (m, re) => m.parts.filter((p) => re.test(p.name))[0];

  // Blum TANDEMBOX antaro: дно LW−75, задняя стенка LW−87
  const tb = model('tandembox');
  const tbB = partOf(tb, /Дно ящика/), tbK = partOf(tb, /Задняя стенка ящика/);
  if (Math.abs(tbB.width - (LW - 75)) > 0.6) problems.push(`TANDEMBOX: дно ${tbB.width} вместо ${LW - 75}`);
  if (Math.abs(tbK.length - (LW - 87)) > 0.6) problems.push(`TANDEMBOX: задняя ${tbK.length} вместо ${LW - 87}`);

  // Blum LEGRABOX: дно LW−35, задняя стенка LW−38
  const lg = model('legrabox');
  const lgB = partOf(lg, /Дно ящика/), lgK = partOf(lg, /Задняя стенка ящика/);
  if (Math.abs(lgB.width - (LW - 35)) > 0.6) problems.push(`LEGRABOX: дно ${lgB.width} вместо ${LW - 35}`);
  if (Math.abs(lgK.length - (LW - 38)) > 0.6) problems.push(`LEGRABOX: задняя ${lgK.length} вместо ${LW - 38}`);

  // Hettich InnoTech Atira: BB = LB − 2·EB − 51,5; RB = LB − 2·EB − 63; EB(18) = 10,5
  const it = model('innotech');
  const itB = partOf(it, /Дно ящика/), itK = partOf(it, /Задняя стенка ящика/);
  const EB = 10.5;
  if (Math.abs(itB.width - (LW - 2 * EB - 51.5)) > 0.6) problems.push(`InnoTech: дно ${itB.width} вместо ${LW - 2 * EB - 51.5}`);
  if (Math.abs(itK.length - (LW - 2 * EB - 63)) > 0.6) problems.push(`InnoTech: задняя ${itK.length} вместо ${LW - 2 * EB - 63}`);
  cases += 3;
}

// --- высота короба: стандартный ряд, ручной выбор, просвет сверху ----------
for (const sys of ['ballBearing', 'quadro', 'tandembox', 'innotech', 'legrabox']) {
  const { DRAWER_SYSTEMS } = window.Modul3D.catalog;
  const mkBox = (code) => buildModel(Object.assign({}, base, {
    modules: [{ name: 'Т', width: 600, height: 820, depth: 560, topType: 'rails',
      leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 0, drawers: 2, facade: 'open', handle: 'bow160',
        drawerSystem: sys, drawerBoxHeight: code }] }],
  }));
  // авто: высота обязана быть из стандартного ряда системы
  const auto = mkBox('auto');
  const boxPart = auto.parts.filter((p) => /Боковина ящика|Задняя стенка ящика/.test(p.name))[0];
  const std = DRAWER_SYSTEMS[sys].heights.map((h) => (sys === 'tandembox' || sys === 'legrabox' || sys === 'innotech' ? h.backH : h.h));
  if (boxPart && !std.some((v) => Math.abs(v - boxPart.width) < 0.6)) {
    problems.push(`высота короба ${sys}: ${boxPart.width} мм вне стандартного ряда ${std.join('/')}`);
  }
  // просвет над верхним коробом — не меньше 20 мм
  const tops = auto.partsRaw.filter((p) => /ящика/.test(p.name) && p.kind !== 'drawerFront')
    .map((p) => p.boxes[0].y + p.boxes[0].h / 2);
  const ceil = auto.partsRaw.filter((p) => p.kind === 'top')
    .map((p) => p.boxes[0].y - p.boxes[0].h / 2);
  if (tops.length && ceil.length) {
    const gap = Math.min.apply(null, ceil) - Math.max.apply(null, tops);
    if (gap < 20) problems.push(`просвет над коробом ${sys}: ${Math.round(gap)} мм (< 20)`);
  }
  // ручной выбор высоты действительно применяется
  const codes = DRAWER_SYSTEMS[sys].heights;
  const small = codes[0];
  const man = mkBox(small.code);
  const mp = man.parts.filter((p) => /Боковина ящика|Задняя стенка ящика/.test(p.name))[0];
  if (mp) {
    const want = (sys === 'tandembox' || sys === 'legrabox' || sys === 'innotech') ? small.backH : small.h;
    if (Math.abs(mp.width - want) > 0.6) {
      problems.push(`выбор высоты ${sys}: задали ${small.code}, получили ${mp.width} вместо ${want}`);
    }
  }
  cases += 2;
}

// --- присадка фасада ящика: крепление к коробу и держатели релинга ---------
{
  const mkF = (sys, code) => buildModel(Object.assign({}, base, {
    modules: [{ name: 'Т', width: 600, height: 820, depth: 560, topType: 'rails',
      leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 0, drawers: 2, facade: 'open', handle: 'bow160',
        drawerSystem: sys, drawerBoxHeight: code }] }],
  }));
  for (const sys of ['ballBearing', 'tandembox', 'innotech']) {
    const m = mkF(sys, 'auto');
    const f = m.parts.filter((p) => /Фасад ящика 1/.test(p.name))[0];
    const fix = f.holes.filter((h) => h.kind === 'frontFix');
    // Металлическая царга: два крепления по её оси. ЛДСП-короб: винты через
    // переднюю стенку — два по высоте короба, если он от 100 мм, иначе один ряд.
    const rowsY = fix.map((h) => h.y).filter((v, i2, a) => a.indexOf(v) === i2);
    if (fix.length !== rowsY.length * 2) {
      problems.push(`фасад ${sys}: крепления не парные (${fix.length} на ${rowsY.length} рядов)`);
    }
    const metal = sys !== 'ballBearing' && sys !== 'quadro';
    if (metal && fix.length !== 2) problems.push(`фасад ${sys}: креплений ${fix.length} вместо 2`);
    if (!metal) {
      // Шуруп 3,5×30: в стенке короба ПРОХОДНОЕ Ø4, в фасаде НАПРАВЛЯЮЩЕЕ
      // Ø2,5. Одинаковый диаметр с обеих сторон — фасад будет болтаться.
      for (const h of fix) {
        if (h.d > 3) problems.push(`${sys}: в фасаде Ø${h.d} под шуруп 3,5 — резьбе не за что держаться`);
      }
      // ОТВЕРСТИЯ ОБЯЗАНЫ СОВПАСТЬ В ПРОСТРАНСТВЕ: считаем их в мировых
      // координатах у фасада и у стенки короба и сверяем попарно.
      const facRaw = m.partsRaw.filter((p) => /Фасад ящика 1/.test(p.name))[0];
      const wallRaw = m.partsRaw.filter((p) => /Передняя стенка ящика/.test(p.name))[0];
      if (facRaw && wallRaw) {
        const fb = facRaw.boxes[0], wb = wallRaw.boxes[0];
        const key = (b, h) => `${(b.x - b.w / 2 + h.x).toFixed(1)}/${(b.y - b.h / 2 + h.y).toFixed(1)}`;
        const fset = (facRaw.holes || []).filter((h) => h.kind === 'frontFix').map((h) => key(fb, h)).sort();
        const wset = (wallRaw.holes || []).filter((h) => h.kind === 'frontFix')
          .filter((h) => Math.abs((wb.y - wb.h / 2 + h.y) - (fb.y - fb.h / 2)) < 400)
          .map((h) => key(wb, h)).sort();
        if (fset.length !== wset.length || fset.some((v, i2) => v !== wset[i2])) {
          problems.push(`${sys}: отверстия фасада и стенки короба не совпадают `
            + `(${fset.join(' ')} ↔ ${wset.join(' ')})`);
        }
      }
      const boxFront = m.parts.filter((p) => /Передняя стенка ящика/.test(p.name))[0];
      for (const h of ((boxFront || {}).holes || []).filter((x) => x.kind === 'frontFix')) {
        if (h.d < 3.8 || h.d > 4.5) {
          problems.push(`${sys}: в стенке короба Ø${h.d} — шуруп 3,5 должен проходить свободно`);
        }
      }
      const bf = boxFront ? (boxFront.holes || []).filter((h) => h.kind === 'frontFix') : [];
      if (!boxFront) problems.push(`${sys}: у ЛДСП-короба нет отдельной передней стенки`);
      else if (bf.length !== fix.length) {
        problems.push(`${sys}: в стенке короба ${bf.length} отверстий, в фасаде ${fix.length}`);
      } else if (!bf.every((h) => h.through)) {
        problems.push(`${sys}: крепление фасада в стенке короба не сквозное`);
      }
    }
    if (fix.some((h) => h.side !== 'back')) problems.push(`фасад ${sys}: крепление не с изнанки`);
    if (fix.some((h) => h.x < 8 || h.x > f.length - 8 || h.y < 8 || h.y > f.width - 8)) {
      problems.push(`фасад ${sys}: крепление вылезло за фасад`);
    }
    cases += 1;
  }
  // у царги с релингом обязаны появиться отверстия под его держатели
  const rel = mkF('tandembox', 'C');
  const fr = rel.parts.filter((p) => /Фасад ящика 1/.test(p.name))[0];
  if (!fr.holes.some((h) => h.kind === 'relingFix')) {
    problems.push('релинг: нет отверстий под держатели на фасаде');
  }
  const noRel = mkF('tandembox', 'N');
  const fn = noRel.parts.filter((p) => /Фасад ящика 1/.test(p.name))[0];
  if (fn.holes.some((h) => h.kind === 'relingFix')) {
    problems.push('релинг: отверстия появились у царги без релинга');
  }
  cases += 1;
}

// --- ПРАВИЛО: короб ниже своего фасада минимум на 20 мм --------------------
for (const sys of ['ballBearing', 'quadro', 'tandembox', 'legrabox', 'innotech']) {
  for (const n of [1, 2, 3, 4]) for (const H of [600, 820, 1400]) {
    const model = buildModel(Object.assign({}, base, {
      modules: [{ name: 'Т', width: 600, height: H, depth: 560, topType: 'rails',
        leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
        sections: [{ shelves: 0, drawers: n, facade: 'open', handle: 'bow160', drawerSystem: sys }] }],
    }));
    const fac = model.partsRaw.filter((p) => p.kind === 'drawerFront')
      .map((p) => ({ b: p.boxes[0].y - p.boxes[0].h / 2, t: p.boxes[0].y + p.boxes[0].h / 2 }));
    const box = model.partsRaw.filter((p) => /ящика/.test(p.name) && p.kind !== 'drawerFront');
    for (const p of box) {
      const bb = p.boxes[0].y - p.boxes[0].h / 2;
      const bt = p.boxes[0].y + p.boxes[0].h / 2;
      const f = fac.filter((x) => bb >= x.b - 2 && bb <= x.t + 2)[0];
      if (!f) continue;
      if (f.t - bt < 19.4) {
        problems.push(`${sys} n${n} H${H}: короб выступает — перекрыв фасадом ${Math.round(f.t - bt)} мм (< 20)`);
      }
    }
    cases += 1;
  }
}

// --- короб ящика прилегает к фасаду ---------------------------------------
for (const sys of ['ballBearing', 'quadro', 'tandembox', 'legrabox', 'innotech']) {
  for (const D of [350, 560, 600]) {
    const model = buildModel(Object.assign({}, base, {
      modules: [{ name: 'Т', width: 600, height: 820, depth: D, topType: 'rails',
        leftSide: 'floor', rightSide: 'floor', base: { type: 'legsPlinth', legHeight: 100 },
        sections: [{ shelves: 0, drawers: 2, facade: 'open', handle: 'bow160', drawerSystem: sys }] }],
    }));
    const face = model.partsRaw.filter((p) => p.kind === 'drawerFront')[0];
    if (!face) continue;
    const back = face.boxes[0].z - face.boxes[0].d / 2;
    const box = model.partsRaw.filter((p) => /ящика/.test(p.name) && p.kind !== 'drawerFront');
    if (!box.length) continue;
    const front = Math.max.apply(null, box.map((p) => p.boxes[0].z + p.boxes[0].d / 2));
    const gap = back - front;
    if (gap < -0.6) problems.push(`короб ${sys} D${D}: заходит в фасад на ${(-gap).toFixed(1)} мм`);
    if (gap > 14) problems.push(`короб ${sys} D${D}: не прилегает к фасаду, зазор ${gap.toFixed(1)} мм`);
    cases += 1;
  }
}

// --- фланец штанги: три самореза по окружности -----------------------------
{
  const model = buildModel(Object.assign({}, base, {
    modules: [{ name: 'Ш', width: 900, height: 2200, depth: 600,
      leftSide: 'floor', rightSide: 'floor', base: { type: 'plinth', plinthHeight: 100 },
      sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft', handle: 'bow128',
        rod: true, drawerSystem: 'ballBearing' }] }],
  }));
  const side = model.partsRaw.filter((p) => p.kind === 'side')[0];
  const fl = side.holes.filter((h) => h.kind === 'rodFlange');
  if (fl.length !== 3) problems.push(`фланец: ${fl.length} отверстий вместо трёх`);
  else {
    const cx = fl.reduce((a, h) => a + h.x, 0) / 3;
    const cy = fl.reduce((a, h) => a + h.y, 0) / 3;
    for (const h of fl) {
      const rr = Math.hypot(h.x - cx, h.y - cy);
      if (Math.abs(rr - 22) > 1.5) problems.push(`фланец: отверстие на радиусе ${rr.toFixed(1)} вместо 22`);
      if (h.d !== 4) problems.push(`фланец: диаметр ${h.d} вместо 4`);
    }
  }
  cases += 1;
}

// --- ПРАВИЛО: крепёж корпуса выбирается по конструктиву боковины ----------
for (const sd of ['floor', 'besideBottom', 'onBottom']) {
  const model = buildModel(Object.assign({}, base, {
    modules: [{ name: 'М', width: 600, height: 820, depth: 560, topType: 'rails',
      leftSide: sd, rightSide: sd, base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft', drawerSystem: 'ballBearing' }] }],
  }));
  inspect(model, `крепёж при боковине ${sd}`);
  const side = model.parts.filter((p) => p.kind === 'side')[0];
  const kinds = new Set((side.holes || []).map((h) => h.kind));
  const sp = buildSpecification(model);
  const fast = (sp.fasteners || []).map((r) => r.name).join(' ');
  if (sd === 'onBottom') {
    if (!kinds.has('confirmatEdge')) problems.push('на дно: нет присадки под конфирмат');
    if (kinds.has('minifixCam')) problems.push('на дно: лишний минификс');
    if (!/Конфирмат/.test(fast)) problems.push('на дно: в смете нет конфирматов');
  } else {
    // Rastex 15: в БОКОВИНУ идёт дюбель Ø8, а гнездо Ø15 и Ø8 в торец —
    // на присоединяемой детали (дно, крыша, полка).
    if (!kinds.has('minifixDowel')) problems.push(`${sd}: в боковине нет отверстия под дюбель`);
    if (kinds.has('minifixCam')) problems.push(`${sd}: гнездо Ø15 попало в боковину — схема перевёрнута`);
    if (kinds.has('confirmatEdge')) problems.push(`${sd}: конфирмат виден снаружи, так нельзя`);
    if (!/Rastex/.test(fast)) problems.push(`${sd}: в смете нет Rastex`);
    const horiz = model.parts.filter((p) => p.kind === 'bottom' || p.kind === 'top')[0];
    const hk = new Set(((horiz || {}).holes || []).map((h) => h.kind));
    if (!hk.has('minifixCam')) problems.push(`${sd}: нет гнезда Ø15 на присоединяемой детали`);
    if (!hk.has('minifixBolt')) problems.push(`${sd}: нет Ø8 в торец под шток`);
    for (const h of ((horiz || {}).holes || [])) {
      if (h.kind !== 'minifixCam') continue;
      // Гнездо эксцентрика прячется с невидимой стороны: у дна — снизу,
      // у крыши — сверху. Изнутри корпуса его быть не должно.
      const wantSide = horiz.kind === 'top' ? 'front' : 'back';
      if (h.side !== wantSide) {
        problems.push(`${sd}: гнездо Ø15 на «${horiz.name}» сверлится не с невидимой стороны`);
      }
      const fromEdge = Math.min(h.x, horiz.length - h.x);
      if (Math.abs(fromEdge - 34) > 0.5) {
        problems.push(`${sd}: гнездо Ø15 в ${Math.round(fromEdge)} мм от торца вместо 34 (Rastex 15)`);
      }
      const want = horiz.thickness >= 19 ? 13.7 : horiz.thickness >= 18 ? 13.4
        : horiz.thickness >= 16 ? 12.7 : 12.2;
      if (Math.abs(h.depth - want) > 0.2) {
        problems.push(`${sd}: глубина гнезда ${h.depth} вместо ${want} при плите ${horiz.thickness}`);
      }
    }
  }
  cases += 1;
}

// --- типы фасадов: материал, толщина, стекло внутри ------------------------
{
  const { FACADE_TYPES, FACADE_TYPE_ORDER } = window.Modul3D.catalog;
  const mkT = (ft) => buildModel(Object.assign({}, base, {
    modules: [{ name: 'М', width: 600, height: 820, depth: 560, topType: 'rails',
      leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 2, drawers: 1, facade: 'doorLeft', facadeType: ft, drawerSystem: 'ballBearing' }] }],
  }));
  for (const id of FACADE_TYPE_ORDER) {
    const info = FACADE_TYPES[id];
    const model = mkT(id);
    inspect(model, `фасад ${id}`);
    const door = model.parts.filter((p) => p.kind === 'door')[0];
    const df = model.parts.filter((p) => p.kind === 'drawerFront')[0];
    const shelf = model.parts.filter((p) => p.kind === 'shelf')[0];
    if (door.thickness !== info.thickness) problems.push(`фасад ${id}: дверь ${door.thickness} вместо ${info.thickness}`);
    if (df && df.thickness !== info.thickness) problems.push(`фасад ${id}: фасад ящика другой толщины`);
    if (id !== 'ldsp' && door.material === DECORS[0].code) problems.push(`фасад ${id}: материал не сменился`);
    if (info.glassInside) {
      if (!shelf.glass || shelf.thickness !== 6) problems.push(`фасад ${id}: полка не стеклянная`);
    } else if (shelf.glass) {
      problems.push(`фасад ${id}: полка вдруг стеклянная`);
    }
    if (info.frame && !door.frameW) problems.push(`фасад ${id}: не передана ширина рамки`);
    // ЛДСП-фасад режется из декора проекта, у остальных материал свой
    const wantCode = id === 'ldsp' ? DECORS[0].code : info.material;
    const sp = buildSpecification(model);
    if (!(sp.sheetMaterials || []).some((r) => r.code === wantCode)) {
      problems.push(`фасад ${id}: материал ${wantCode} не попал в смету`);
    }
    cases += 1;
  }
}

// --- совместимость: старый флажок «стекло» ---------------------------------
{
  const mkG = (glass) => buildModel(Object.assign({}, base, {
    modules: [{ name: 'М', width: 600, height: 820, depth: 560, topType: 'rails',
      leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 2, drawers: 0, facade: 'doors2', glass, drawerSystem: 'ballBearing' }] }],
  }));
  const g = mkG(true), n = mkG(false);
  inspect(g, 'стеклянный фасад');
  const gs = g.parts.filter((p) => p.kind === 'shelf')[0];
  const gd = g.parts.filter((p) => p.kind === 'door')[0];
  if (!gs.glass || gs.thickness !== 6) problems.push(`стекло: полка ${gs.thickness} мм и glass=${gs.glass}`);
  if (gd.thickness !== 4) problems.push(`стекло: дверь ${gd.thickness} мм вместо 4`);
  if (gs.edging.long1) problems.push('стекло: полке проставлена кромка');
  const sp = buildSpecification(g);
  const hw = (sp.hardware || []).map((r) => r.name).join(' | ');
  if (!/силиконовой пяткой/.test(hw)) problems.push('стекло: нет полкодержателей для стекла');
  if (/Полкодержатель штифт/.test(hw)) problems.push('стекло: остались обычные полкодержатели');
  if (!(sp.sheetMaterials || []).some((r) => /Стекло/.test(r.name))) problems.push('стекло: нет в листовых материалах');
  // без стекла — всё по-старому
  const spn = buildSpecification(n);
  if (!/Полкодержатель штифт/.test((spn.hardware || []).map((r) => r.name).join(' '))) {
    problems.push('без стекла: пропали обычные полкодержатели');
  }
  cases += 2;
}

// --- ВСЕ отверстия обязаны лежать внутри своей детали ---------------------
for (const sd of ['floor', 'besideBottom', 'onBottom']) {
  for (const tt of ['panel', 'rails']) {
    for (const n of [0, 3]) {
      const model = buildModel(Object.assign({}, base, {
        modules: [{ name: 'М', width: 600, height: 820, depth: 560, topType: tt,
          leftSide: sd, rightSide: sd, base: { type: 'legsPlinth', legHeight: 100 },
          sections: [{ shelves: 1, drawers: n, facade: n ? 'open' : 'doorLeft',
            handle: 'bow160', rod: false, drawerSystem: 'ballBearing' }] }],
      }));
      for (const p of model.parts) {
        for (const h of (p.holes || [])) {
          if (h.x < -0.5 || h.x > p.length + 0.5 || h.y < -0.5 || h.y > p.width + 0.5) {
            problems.push(`${sd}/${tt}: отверстие «${h.kind}» (${h.x}, ${h.y}) вне детали `
              + `«${p.name}» ${p.length}×${p.width}`);
          }
          if (!h.kind) problems.push(`${sd}/${tt}: у отверстия на «${p.name}» не указан вид`);
        }
      }
      // два отверстия в одной точке — признак ошибки раскладки крепежа
      for (const p of model.parts) {
        const seen = new Set();
        for (const h of (p.holes || [])) {
          const key = `${h.kind}|${h.x}|${h.y}`;
          if (seen.has(key)) problems.push(`${sd}/${tt}: два отверстия «${h.kind}» в одной точке на «${p.name}»`);
          seen.add(key);
        }
      }
      cases += 1;
    }
  }
}

// --- размеры петель ставятся со стороны петель -----------------------------
for (const fac of ['doorLeft', 'doorRight']) {
  const model = buildModel(Object.assign({}, base, {
    modules: [{ name: 'М', width: 600, height: 820, depth: 560, topType: 'rails',
      leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 1, drawers: 0, facade: fac, handle: 'bow128', drawerSystem: 'ballBearing' }] }],
  }));
  const door = model.parts.filter((p) => p.kind === 'door')[0];
  const cups = door.holes.filter((h) => h.kind === 'hingeCup');
  const html = String(buildDrawings(model, true));
  const blk = html.slice(html.indexOf('Фасады'));
  // вертикальные размеры рисуются повёрнутым текстом — берём их координаты
  const vs = [];
  const re = /<text x="([-\d.]+)" y="([-\d.]+)" class="dw-dt"[^>]*transform="rotate\(-90[^>]*>([^<]+)</g;
  let mm;
  while ((mm = re.exec(blk))) vs.push({ x: +mm[1], label: mm[3] });
  const hingeLeft = cups[0].x < door.length / 2;
  const near = vs.filter((v) => v.label === '100');
  if (!near.length) { problems.push(`${fac}: на чертеже нет размера до чашки петли`); continue; }
  const xs = near.map((v) => v.x);
  const mid = vs.reduce((a, v) => a + v.x, 0) / Math.max(vs.length, 1);
  const onLeft = Math.min.apply(null, xs) < mid;
  if (hingeLeft !== onLeft) {
    problems.push(`${fac}: петли ${hingeLeft ? 'слева' : 'справа'}, а размеры к ним ${onLeft ? 'слева' : 'справа'}`);
  }
  cases += 1;
}

// --- угловой стык: фальш-планка, зазор и цоколь ---------------------------
{
  const mkc = (n, w, c) => ({ name: n, width: w, height: 820, depth: 560, corner: c,
    topType: 'rails', leftSide: 'onBottom', rightSide: 'onBottom',
    base: { type: 'legsPlinth', legHeight: 100 },
    sections: [{ shelves: 0, drawers: 3, facade: 'open', handle: 'bow160', drawerSystem: 'ballBearing' }] });
  const model = buildModel(Object.assign({}, base, {
    modules: [mkc('М1', 600), mkc('М2', 1000, true), mkc('М3', 600)],
  }));
  inspect(model, 'угловой стык');

  const filler = model.parts.filter((p) => p.kind === 'filler')[0];
  if (!filler) problems.push('угол: нет фальш-планки');
  else {
    if (filler.width !== 50) problems.push(`угол: стыковочная планка ${filler.width} вместо 50 мм`);
    if (filler.thickness !== 18) problems.push('угол: фальш-планка не из фасадного материала');
  }

  // перпендикулярный ряд обязан отодвинуться на планку, а не стоять вплотную
  const corner = model.modules[1], next = model.modules[2];
  const gap = Math.abs(next.offsetZ) - (corner.dims.D / 2);
  if (gap < 90) problems.push(`угол: ряд отодвинут всего на ${Math.round(gap)} мм`);

  // цоколь в углу сомкнут: продольная планка доведена внахлёст до поперечной,
  // а за угол — не выходит
  const pl = model.parts.filter((p) => p.kind === 'plinth');
  if (!pl.some((p) => /угол|Сквозной/i.test(p.note || ''))) {
    problems.push('угол: цоколь не сомкнут с соседним рядом');
  }
  cases += 1;
}

// --- полкодержатель целиком ПОД полкой ------------------------------------
for (const glass of [false, true]) {
  const model = buildModel(Object.assign({}, base, {
    modules: [{ name: 'М', width: 600, height: 820, depth: 560, topType: 'rails',
      leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 2, drawers: 0, facade: 'doorLeft',
        facadeType: glass ? 'glass4' : 'ldsp', drawerSystem: 'ballBearing' }] }],
  }));
  const shelves = model.partsRaw.filter((p) => p.kind === 'shelf')
    .map((p) => p.boxes[0].y - p.boxes[0].h / 2);
  const side = model.partsRaw.filter((p) => p.kind === 'side')[0];
  const sb = side.boxes[0];
  for (const h of side.holes.filter((x) => x.kind === 'shelfSupport')) {
    const top = (sb.y - sb.h / 2 + h.x) + h.d / 2;
    const near = shelves.filter((sy) => Math.abs(sy - top) < 30)[0];
    if (near === undefined) continue;
    if (top > near + 0.1) {
      problems.push(`полкодержатель: отверстие заходит в полку на ${(top - near).toFixed(1)} мм`);
    }
  }
  for (const p of model.partsRaw.filter((x) => x.kind === 'shelfPin')) {
    const b = p.boxes[0];
    const near = shelves.filter((sy) => Math.abs(sy - (b.y + b.h / 2)) < 30)[0];
    if (near !== undefined && b.y + b.h / 2 > near + 0.1) {
      problems.push('полкодержатель: штифт заходит в полку');
    }
  }
  cases += 1;
}

// --- размерные линии: непересекающиеся размеры стоят в одну линию ---------
{
  const model = buildModel(Object.assign({}, base, {
    modules: [{ name: 'М', width: 600, height: 2000, depth: 560, topType: 'panel',
      leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'plinth', plinthHeight: 100 },
      sections: [{ shelves: 3, drawers: 0, facade: 'doorLeft', handle: 'bow128',
        drawerSystem: 'ballBearing' }] }],
  }));
  const html = String(buildDrawings(model, true));
  // Берём ТОЛЬКО раздел фасадов: дальше идут листы остальных деталей, у них
  // своя система координат, и мешать их размеры в одну кучу нельзя.
  const fi2 = html.indexOf('Фасады');
  const fe2 = html.indexOf('<h4 class="dw-h">', fi2 + 5);
  const blk = html.slice(fi2, fe2 === -1 ? undefined : fe2);
  // горизонтальные размерные линии: y — уровень, x1..x2 — занятый отрезок
  const lines = [];
  const re = /<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" class="dw-dim"\/>/g;
  let mm;
  while ((mm = re.exec(blk))) {
    const y1 = +mm[2], y2 = +mm[4];
    if (Math.abs(y1 - y2) < 0.01) lines.push({ y: y1, a: Math.min(+mm[1], +mm[3]), b: Math.max(+mm[1], +mm[3]) });
  }
  // на одном уровне размеры не должны перекрываться
  const byY = new Map();
  for (const l of lines) {
    const key = l.y.toFixed(1);
    if (!byY.has(key)) byY.set(key, []);
    byY.get(key).push(l);
  }
  for (const [y, arr] of byY) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        if (Math.min(arr[i].b, arr[j].b) - Math.max(arr[i].a, arr[j].a) > 0.5) {
          problems.push(`размеры: на уровне y=${y} две размерные линии перекрываются`);
        }
      }
    }
  }
  // цепочка присадки обязана стоять ближе к детали, чем габарит
  {
    const gab = lines.filter((l) => Math.abs(l.b - l.a) > 0.9 * Math.max.apply(null, lines.map((x) => x.b - x.a)));
    const chain = lines.filter((l) => gab.indexOf(l) === -1);
    if (gab.length && chain.length) {
      const gy = Math.max.apply(null, gab.map((l) => l.y));
      const cy = Math.max.apply(null, chain.map((l) => l.y));
      if (cy > gy) problems.push('размеры: габарит детали оказался ближе цепочки присадки');
    }
  }
  // а непересекающиеся — обязаны быть на одном уровне
  const holeLines = lines.filter((l) => l.y > Math.min.apply(null, lines.map((x) => x.y)) + 1);
  if (holeLines.length >= 2) {
    const lv = new Set(holeLines.map((l) => l.y.toFixed(1)));
    const anyOverlap = holeLines.some((x, i) => holeLines.some((z, j) =>
      j > i && Math.min(x.b, z.b) - Math.max(x.a, z.a) > 0.5));
    if (!anyOverlap && lv.size > 1) {
      problems.push('размеры: непересекающиеся размеры разнесены по разным линиям');
    }
  }
  cases += 1;
}

// --- стекло не идёт на присадочный станок ---------------------------------
{
  const model = buildModel(Object.assign({}, base, {
    modules: [{ name: 'М', width: 600, height: 720, depth: 320,
      leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'plinth', plinthHeight: 0 },
      sections: [{ shelves: 2, drawers: 0, facade: 'doorLeft', handle: 'bow160',
        facadeType: 'glass4', drawerSystem: 'ballBearing' }] }],
  }));
  const glassParts = model.parts.filter((p) => p.glass || /^GLASS/.test(p.material || ''));
  if (!glassParts.length) problems.push('стекло: в модели нет стеклянных деталей');
  if (!glassParts.some((p) => (p.holes || []).length)) {
    problems.push('стекло: у стеклянной двери нет отверстий в модели');
  }
  const csv = window.Modul3D.cnc.buildDrillCsv(model);
  const dxf = window.Modul3D.cnc.buildDrillDxf(model);
  for (const p of glassParts) {
    if (csv.indexOf(p.material) !== -1) problems.push(`ЧПУ: стекло ${p.material} попало в CSV`);
    if (dxf.indexOf(p.name) !== -1) problems.push(`ЧПУ: стекло «${p.name}» попало в DXF`);
  }
  // а непрозрачные детали в выгрузке остаться должны
  if (csv.trim().split('\r\n').length < 2) problems.push('ЧПУ: выгрузка опустела вместе со стеклом');
  cases += 1;
}

// --- ПРАВИЛО: под каждую фурнитуру есть присадка, и она есть в выгрузке ----
{
  const model = buildModel(Object.assign({}, base, {
    modules: [{ name: 'Ш', width: 900, height: 2200, depth: 600,
      leftSide: 'floor', rightSide: 'floor', base: { type: 'plinth', plinthHeight: 100 },
      sections: [{ shelves: 2, drawers: 2, facade: 'doorLeft', handle: 'bow128',
        rod: true, drawerSystem: 'ballBearing' }] }],
  }));
  inspect(model, 'присадка под всю фурнитуру');

  const kinds = new Set();
  model.parts.forEach((p) => (p.holes || []).forEach((h) => kinds.add(h.kind || 'handle')));
  for (const need of ['handle', 'hingeCup', 'shelfSupport', 'drawerRunner', 'rodFlange']) {
    if (!kinds.has(need)) problems.push(`присадка: нет отверстий вида «${need}»`);
  }

  // всё, что насверлено, обязано попасть и в CSV, и в DXF
  const total = model.parts.filter((p) => !p.hardware)
    .reduce((s, p) => s + (p.holes || []).length + ((p.grooves || []).length), 0);
  const csv = window.Modul3D.cnc.buildDrillCsv(model);
  const dxf = window.Modul3D.cnc.buildDrillDxf(model);
  if (csv.trim().split('\r\n').length - 1 !== total) problems.push('присадка: CSV не совпал с моделью');
  const holesOnly = model.parts.filter((p) => !p.hardware)
    .reduce((s, p) => s + (p.holes || []).length, 0);
  if ((dxf.match(/CIRCLE/g) || []).length !== holesOnly) {
    problems.push('присадка: DXF не совпал с моделью');
  }
  const groovesOnly = model.parts.reduce((s, p) => s + ((p.grooves || []).length), 0);
  if ((dxf.match(/GROOVE_/g) || []).length !== groovesOnly * 2) {
    problems.push('пазы: DXF не совпал с моделью');
  }

  // и быть видимой на чертежах
  const html = String(buildDrawings(model, true));
  if ((html.match(/dw-hole/g) || []).length < 4) problems.push('присадка: на чертежах почти нет отверстий');

  // штанга: просвет сверху 50–60 мм и не ближе 300 мм к задней стенке
  const rod = model.parts.filter((p) => p.kind === 'rod')[0];
  if (!rod) problems.push('штанга: не построена');
  else {
    const rb = rod.boxes[0];
    const backZ = -600 / 2 + 3;
    if (rb.z - backZ < 299) problems.push(`штанга: от задней стенки ${Math.round(rb.z - backZ)} мм (< 300)`);
    const shelvesAbove = [];
    model.parts.filter((p) => p.kind === 'shelf').forEach((p) => p.boxes.forEach((x) => {
      if (x.y > rb.y) shelvesAbove.push(x.y);
    }));
    const ceil = shelvesAbove.length ? Math.min.apply(null, shelvesAbove) : null;
    if (ceil !== null) {
      const gap = ceil - rb.y;
      if (gap < 45 || gap > 90) problems.push(`штанга: просвет до полки ${Math.round(gap)} мм вне 50–60`);
    }
    if (!model.parts.some((p) => p.kind === 'rodFlange')) problems.push('штанга: нет держателей');
  }
  cases += 1;
}

// --- ничего не вылезает за рамку листа -------------------------------------
// Каждый SVG обязан вмещать всю свою графику: чертёж, обрезанный рамкой, —
// брак, который пользователь видит первым делом.
{
  const sets = [
    [{ name: 'М1', width: 600 }],
    [{ name: 'М1', width: 600 }, { name: 'М2', width: 600, sections: [{ shelves: 0, drawers: 3, facade: 'drawers', drawerSystem: 'tandembox', handle: 'bow160' }] },
     { name: 'М3', width: 800, corner: true }, { name: 'М4', width: 600 }, { name: 'М5', width: 560 }],
  ];
  for (const set of sets) {
    const mods = set.map((m) => Object.assign({
      height: 820, depth: 560, topType: 'rails', leftSide: 'onBottom', rightSide: 'onBottom',
      base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft', handle: 'bow160', drawerSystem: 'ballBearing' }],
    }, m));
    const model = buildModel(Object.assign({}, base, { modules: mods }));
    const html = String(buildDrawings(model, true));
    const svgs = html.match(/<svg[^>]*>[\s\S]*?<\/svg>/g) || [];
    if (!svgs.length) problems.push('чертежи: SVG не построены');
    svgs.forEach((sv, i) => {
      const vb = /viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/.exec(sv);
      if (!vb) { problems.push('чертежи: нет viewBox'); return; }
      const X = +vb[1], Y = +vb[2], W = +vb[3], H = +vb[4];
      let mm, out = false;
      const re = /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g;
      while ((mm = re.exec(sv))) {
        if (+mm[1] < X - 1 || +mm[2] < Y - 1 || +mm[1] + +mm[3] > X + W + 1 || +mm[2] + +mm[4] > Y + H + 1) out = true;
      }
      const rc = /<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="([\d.]+)"/g;
      while ((mm = rc.exec(sv))) {
        if (+mm[1] - +mm[3] < X - 1 || +mm[2] - +mm[3] < Y - 1
          || +mm[1] + +mm[3] > X + W + 1 || +mm[2] + +mm[3] > Y + H + 1) out = true;
      }
      if (out) problems.push(`чертежи: графика вышла за рамку листа (SVG #${i}, модулей ${mods.length})`);
    });
    // сквозной цоколь ряда не должен попадать на чертёж отдельного модуля
    const runPlinth = model.partsRaw.filter((p) => p.kind === 'plinth' && String(p.module || '').indexOf(' + ') !== -1)[0];
    if (runPlinth && mods.length > 1) {
      const mi = html.indexOf('— каркас без фасадов');
      const modHtml = mi === -1 ? '' : html.slice(mi, mi + 6000);
      if (modHtml.indexOf(`${Math.round(runPlinth.length)}×`) !== -1) {
        problems.push('чертежи: сквозной цоколь ряда попал в чертёж отдельного модуля');
      }
    }
    cases += 1;
  }
}

// --- на общем виде нет дублей размеров --------------------------------------
// Повёрнутый прогон проецируется на вид спереди столбиком одинаковых чисел —
// они забивают лист и прячут габарит. Одинаковый размер на одном месте
// ставится один раз.
{
  const mods = [600, 600, 800, 600, 600, 800, 560, 560, 560, 560, 560].map((w, i) => ({
    name: `М${i + 1}`, width: w, height: 820, depth: 560, corner: i === 5,
    topType: 'rails', leftSide: 'onBottom', rightSide: 'onBottom',
    base: { type: 'legsPlinth', legHeight: 100 },
    sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft', handle: 'bow160', drawerSystem: 'ballBearing' }],
  }));
  const model = buildModel(Object.assign({}, base, { modules: mods }));
  const html = String(buildDrawings(model, true));
  const i1 = html.indexOf('Чертежи модулей');
  const ov = html.slice(0, i1 === -1 ? undefined : i1);
  const dims = [...ov.matchAll(/<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*class="dw-dt"[^>]*>([\d]+)</g)]
    .map((m) => `${Math.round(+m[1])}/${Math.round(+m[2])}/${m[3]}`);
  const dup = dims.filter((v, i) => dims.indexOf(v) !== i);
  if (dup.length) problems.push(`чертежи: на общем виде дубли размеров (${dup.join(', ')})`);
  cases += 1;
}

// --- цоколь: сквозной в обоих прогонах и сомкнут в углу ---------------------
{
  const mods = [600, 600, 800, 600, 1000, 600, 600].map((w, i) => ({
    name: `М${i + 1}`, width: w, height: 820, depth: 560, corner: i === 4,
    topType: 'rails', leftSide: 'onBottom', rightSide: 'onBottom',
    base: { type: 'legsPlinth', legHeight: 100 },
    sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft', handle: 'bow160', drawerSystem: 'ballBearing' }],
  }));
  const model = buildModel(Object.assign({}, base, { modules: mods }));
  const pl = model.partsRaw.filter((p) => p.kind === 'plinth');
  const alongX = pl.filter((p) => p.box.w > p.box.d).sort((a, b) => a.box.x - b.box.x);
  const alongZ = pl.filter((p) => p.box.d > p.box.w).sort((a, b) => a.box.z - b.box.z);
  const MAX_CUT = 2800;
  // планка не длиннее листа ЛДСП — иначе её физически не выпилить
  for (const p of pl) {
    if (p.length > MAX_CUT + 1) problems.push(`цоколь: планка ${Math.round(p.length)} мм длиннее листа`);
  }
  // куски одного ряда идут встык, без щелей
  const chain = (list, ax, sz) => {
    for (let i = 1; i < list.length; i++) {
      const g = (list[i].box[ax] - list[i][sz]() / 2) - (list[i - 1].box[ax] + list[i - 1][sz]() / 2);
      if (Math.abs(g) > 1) problems.push(`цоколь: между кусками ряда щель ${Math.round(g)} мм`);
    }
  };
  alongX.forEach((p) => { p.__s = () => p.box.w; });
  alongZ.forEach((p) => { p.__s = () => p.box.d; });
  chain(alongX, 'x', '__s');
  chain(alongZ, 'z', '__s');
  // цоколь не выходит за габарит изделия
  for (const p of alongX) {
    if (p.box.x + p.box.w / 2 > model.dims.W / 2 + 1 || p.box.x - p.box.w / 2 < -model.dims.W / 2 - 1) {
      problems.push('цоколь: планка вышла за габарит изделия');
    }
  }
  // за угол продольная планка не выходит: там стоит корпус второго прогона
  if (alongX.length && alongZ.length) {
    const z0 = alongZ[0];
    const zFar = z0.box.x + z0.box.w / 2;
    const far = Math.max.apply(null, alongX.map((p) => p.box.x + p.box.w / 2));
    if (far - zFar > 1) {
      problems.push(`цоколь: продольная планка ушла за угол на ${Math.round(far - zFar)} мм`);
    }
  }
  // и в углу сомкнут встык: ни щели, ни захода друг в друга
  if (alongX.length && alongZ.length) {
    const x = alongX[alongX.length - 1], z = alongZ[0];
    const gapFront = (z.box.z - z.box.d / 2) - (x.box.z + x.box.d / 2);
    const gapBack = (x.box.z - x.box.d / 2) - (z.box.z + z.box.d / 2);
    const gap = Math.max(gapFront, gapBack);
    if (gap > 1) problems.push(`цоколь: в углу щель ${Math.round(gap)} мм`);
  }
  // цоколь короче листа НЕ делится: лишний стык в ряду — брак
  {
    const row = [700, 700, 700, 690].map((w, i) => ({
      name: `Р${i + 1}`, width: w, height: 820, depth: 560,
      topType: 'rails', leftSide: 'onBottom', rightSide: 'onBottom',
      base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft', handle: 'bow160', drawerSystem: 'ballBearing' }],
    }));
    const one = buildModel(Object.assign({}, base, { modules: row }));
    const pls = one.partsRaw.filter((p) => p.kind === 'plinth');
    if (pls.length !== 1) problems.push(`цоколь: ряд 2790 мм разделён на ${pls.length} планок без нужды`);
    const long = buildModel(Object.assign({}, base, {
      modules: row.concat([Object.assign({}, row[0], { name: 'Р5' })]),
    }));
    const pl2 = long.partsRaw.filter((p) => p.kind === 'plinth');
    if (pl2.length < 2) problems.push('цоколь: ряд длиннее листа не разделён');
    if (pl2.some((p) => p.length > MAX_CUT + 1)) problems.push('цоколь: кусок длиннее листа');
  }
  cases += 1;
}

// --- повёрнутый модуль на чертежах не «лежит на боку» -----------------------
{
  const mods = [600, 800, 600].map((w, i) => ({
    name: `М${i + 1}`, width: w, height: 820, depth: 560, corner: i === 1,
    topType: 'rails', leftSide: 'onBottom', rightSide: 'onBottom',
    base: { type: 'legsPlinth', legHeight: 100 },
    sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft', handle: 'bow160', drawerSystem: 'ballBearing' }],
  }));
  const model = buildModel(Object.assign({}, base, { modules: mods }));
  const html = String(buildDrawings(model, true));

  // 1. чертёж фасада строится по габаритам ДЕТАЛИ (длина × ширина)
  const fi = html.indexOf('>Фасады<');
  const fend = fi === -1 ? -1 : html.indexOf('<h4 class="dw-h">', fi + 5);
  const fac = fi === -1 ? '' : html.slice(fi, fend === -1 ? undefined : fend);
  const blocks = [...fac.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)" height="([\d.]+)" class="dw-facade"/g)];
  const doors = model.partsRaw.filter((p) => /Дверь|Фасад/.test(p.name));
  for (const b of blocks) {
    const ratio = +b[1] / +b[2];
    const ok = doors.some((d) => Math.abs(ratio - d.length / d.width) < 0.02);
    if (!ok) problems.push(`чертёж фасада: пропорции ${(+b[1]).toFixed(0)}×${(+b[2]).toFixed(0)} не совпали ни с одной деталью`);
  }

  // 2. чертёж повёрнутого модуля строится от его собственного фронта
  const turned = model.modules.filter((m) => m.rotation === 90 || m.rotation === 270)[0];
  if (turned) {
    if (!turned.dimsOwn) problems.push('модуль: нет собственных габаритов (dimsOwn)');
    else if (turned.dimsOwn.W === turned.dims.W && turned.dims.W === turned.dims.D) {
      problems.push('модуль: собственные габариты не отличаются от габарита на месте');
    }
    const secs = html.split('— каркас без фасадов').slice(1);
    const idx = model.modules.indexOf(turned);
    const chunk = secs[idx] || '';
    const own = String(Math.round(turned.dimsOwn.W));
    if (chunk.indexOf(`>${own}<`) === -1) {
      problems.push(`чертёж повёрнутого модуля: нет его собственной ширины ${own} мм`);
    }
  }
  cases += 1;
}

// --- нижний угловой под мойку ----------------------------------------------
// Мойка встаёт сверху, поэтому: планки НА РЕБРО (проём не съеден) и НЕТ
// задней стенки (сзади сифон и подводка).
{
  const model = buildModel(Object.assign({}, base, {
    modules: [{
      name: 'Мойка', width: 984, height: 820, depth: 560, corner: true,
      leftSide: 'onBottom', rightSide: 'onBottom', topType: 'railsEdge', noBack: true,
      base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 0, drawers: 0, facade: 'doorLeft', facadeWidth: 400, handle: 'bow160' }],
    }],
  }));
  inspect(model, 'угловой под мойку');

  if (model.parts.some((p) => p.kind === 'back')) problems.push('мойка: задняя стенка не убрана');

  const rails = model.partsRaw.filter((p) => p.kind === 'top');
  if (rails.length !== 2) problems.push(`мойка: планок ${rails.length} вместо двух`);
  for (const r of rails) {
    const b = r.boxes[0];
    if (b.d > b.h) problems.push(`планка «${r.name}» лежит плашмя, а должна стоять на ребро`);
    if (Math.abs((b.y + b.h / 2) - 820) > 1) problems.push('планка не вровень с верхом корпуса');
  }
  if (rails.length === 2) {
    const [a, b2] = rails.map((r) => r.boxes[0]).sort((x, y) => y.z - x.z);
    const light = (a.z - a.d / 2) - (b2.z + b2.d / 2);
    if (light < 480) problems.push(`мойка: просвет сверху ${Math.round(light)} мм — чаша не пройдёт`);
  }
  // фасад узкий — остальное закрывает перпендикулярный ряд
  const door = model.parts.filter((p) => /Дверь/.test(p.name))[0];
  if (!door || Math.abs(door.length - 400) > 1) problems.push('мойка: фасад не 400 мм');
  cases += 1;
}

// --- заглушка углового модуля и фальш-планка добора ------------------------
{
  const model = buildModel(Object.assign({}, base, {
    modules: [{
      name: 'Мойка', width: 984, height: 820, depth: 560, corner: true,
      leftSide: 'onBottom', rightSide: 'onBottom', topType: 'railsEdge', noBack: true,
      blindPanel: true, blindStrip: 78,
      base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 0, drawers: 0, facade: 'doorLeft', facadeWidth: 400, handle: 'bow160' }],
    }],
  }));
  inspect(model, 'заглушка углового модуля');

  const blind = model.partsRaw.filter((p) => /Заглушка/.test(p.name))[0];
  const strip = model.partsRaw.filter((p) => /Фальш-планка \(добор\)/.test(p.name))[0];
  if (!blind) problems.push('заглушка: не построена');
  else {
    if (Math.abs(blind.length - 720) > 1 || Math.abs(blind.width - 560) > 1) {
      problems.push(`заглушка: ${blind.length}×${blind.width} вместо 720×560`);
    }
    if (blind.material !== base.decor.code) problems.push('заглушка: не из корпусного ЛДСП');
  }
  if (!strip) problems.push('фальш-планка добора: не построена');
  else {
    if (Math.abs(strip.length - 717) > 1 || Math.abs(strip.width - 78) > 1) {
      problems.push(`фальш-планка: ${strip.length}×${strip.width} вместо 717×78`);
    }
    if (blind) {
      const b = blind.boxes[0], s2 = strip.boxes[0];
      // планка стоит ПОД 90°: заглушка тонкая по Z (лежит во фронте),
      // планка тонкая по X (уходит вперёд, поперёк фронта)
      if (!(b.d < b.w && s2.w < s2.d)) problems.push('фальш-планка: не под 90° к заглушке');
      // и примыкает к её ЛЕВОЙ кромке
      const gapX = (b.x - b.w / 2) - (s2.x + s2.w / 2);
      if (Math.abs(gapX) > 1) problems.push(`фальш-планка: не примыкает к заглушке слева (${Math.round(gapX)} мм)`);
      // и ЗАКРЫВАЕТ ТОРЕЦ заглушки: перекрывает его по всей толщине
      const covers = (s2.z - s2.d / 2) <= (b.z - b.d / 2) + 0.5
        && (s2.z + s2.d / 2) >= (b.z + b.d / 2) - 0.5;
      if (!covers) problems.push('фальш-планка: не закрывает торец заглушки');
      // и сделана из ФАСАДНОГО материала, а не из корпусного
      const facade = model.partsRaw.filter((q) => q.kind === 'door')[0];
      if (facade && strip.thickness !== facade.thickness) {
        problems.push('фальш-планка: толщина не как у фасада');
      }
      if (facade && strip.material !== facade.material) {
        problems.push('фальш-планка: материал не как у фасада');
      }
    }
  }
  // второй, «ряд-овой» стыковочной планки в том же месте быть не должно
  if (model.parts.filter((p) => /Фальш-планка/.test(p.name)).length > 1) {
    problems.push('угол: две стыковочные планки в одном месте');
  }

  // Планка крепёжная: корпусной ЛДСП 717×100, стоит НАПРОТИВ заглушки
  // на переднем торце фальш-планки.
  const brk = model.partsRaw.filter((p) => /Планка крепёжная/.test(p.name))[0];
  if (!brk) problems.push('планка крепёжная: не построена');
  else {
    if (Math.abs(brk.length - 717) > 1 || Math.abs(brk.width - 100) > 1) {
      problems.push(`планка крепёжная: ${brk.length}×${brk.width} вместо 717×100`);
    }
    if (brk.material !== base.decor.code) problems.push('планка крепёжная: не из корпусного ЛДСП');
    if (blind && strip) {
      const bb = brk.boxes[0], bl = blind.boxes[0], st2 = strip.boxes[0];
      // напротив заглушки: обе панели во фронтальной плоскости, планка дальше
      if (!(bb.d < bb.w && bl.d < bl.w)) problems.push('планка крепёжная: не параллельна заглушке');
      if (bb.z <= bl.z) problems.push('планка крепёжная: не вынесена вперёд относительно заглушки');
      // и утоплена на свою толщину: передняя пласть вровень с торцом
      // фальш-планки, значит кромка планки закрыта
      const flush = (bb.z + bb.d / 2) - (st2.z + st2.d / 2);
      if (Math.abs(flush) > 1) {
        problems.push(`планка крепёжная: не вровень с торцом фальш-планки (${Math.round(flush)} мм)`);
      }
      // фальш-планка перекрывает кромку планки по всей её толщине
      const covered = (st2.z - st2.d / 2) <= (bb.z - bb.d / 2) + 0.5
        && (st2.z + st2.d / 2) >= (bb.z + bb.d / 2) - 0.5;
      if (!covered) problems.push('фальш-планка: не закрывает кромку планки крепёжной');
    }
  }

  // Все отверстия узла фронта лежат внутри своих деталей — иначе в 3D они
  // «висят в воздухе» рядом с корпусом.
  for (const q of model.partsRaw) {
    if (!/Заглушка|Фальш-планка|крепёжная/.test(q.name)) continue;
    for (const h of (q.holes || [])) {
      if (h.x < -0.5 || h.x > q.length + 0.5 || h.y < -0.5 || h.y > q.width + 0.5) {
        problems.push(`узел фронта: отверстие «${h.kind}» (${h.x}, ${h.y}) вне детали `
          + `«${q.name}» ${q.length}×${q.width}`);
      }
    }
  }

  // Минификсы: гнездо Ø15 только с ВНУТРЕННЕЙ стороны, на каждое гнездо — шток
  let cams = 0, bolts = 0;
  for (const q of model.partsRaw) {
    for (const h of (q.holes || [])) {
      if (h.kind === 'minifixCam') {
        cams += 1;
        if (h.d !== 15) problems.push(`минификс: гнездо Ø${h.d} вместо Ø15`);
        // Планка крепёжная — исключение: с внутренней стороны она вплотную,
        // без зазора, прилегает к фальш-планке, отвёрткой не подобраться;
        // гнездо там ставят с внешней стороны, которую потом закрывает
        // примыкающий соседний ряд.
        if (h.side === 'front' && !/Планка крепёжная/.test(q.name)) {
          problems.push(`минификс: гнездо Ø15 выведено наружу («${q.name}»)`);
        }
        if (h.through) problems.push('минификс: гнездо Ø15 сделано насквозь');
      }
      if (h.kind === 'minifixBolt') {
        bolts += 1;
        if (h.side !== 'edge') problems.push('минификс: шток не в торце детали');
        if (h.d !== 8) problems.push(`минификс: Ø${h.d} в торец вместо Ø8`);
        // гнездо и Ø8 в торец — на ОДНОЙ детали (схема Rastex 15)
        const own = (q.holes || []).some((c) => c.kind === 'minifixCam'
          && Math.abs(c.x - h.x) < 0.6);
        if (!own) problems.push(`минификс: на «${q.name}» шток без своего гнезда Ø15`);
      }
      if (h.kind === 'minifixDowel' && h.d !== 8) {
        problems.push(`минификс: дюбель Ø${h.d} вместо Ø8`);
      }
    }
  }
  if (cams === 0) problems.push('минификс: сборка фронта не насверлена');
  if (cams !== bolts) problems.push(`минификс: гнёзд ${cams}, штоков ${bolts} — не парно`);

  // Оба торцевых узла (заглушка↔планка и планка крепёжная↔планка) собраны
  // ОДИНАКОВО: гнездо+шток — на детали, которая упирается ТОРЦОМ, дюбель —
  // в ПЛАСТЬ фальш-планки напротив него. Заглушка и планка крепёжная не
  // должны нести дюбель — они обе торцевые детали этого узла.
  const blindHoles = model.partsRaw.filter((p) => /Заглушка/.test(p.name))[0];
  const stripHoles = model.partsRaw.filter((p) => /Фальш-планка \(добор\)/.test(p.name))[0];
  const bracketHoles = model.partsRaw.filter((p) => /Планка крепёжная/.test(p.name))[0];
  if (blindHoles && stripHoles && bracketHoles) {
    if (!blindHoles.holes.some((h) => h.kind === 'minifixCam')) {
      problems.push('заглушка: нет гнезда минификса — должна примыкать торцом');
    }
    if (!bracketHoles.holes.some((h) => h.kind === 'minifixCam')) {
      problems.push('планка крепёжная: нет гнезда минификса — должна примыкать торцом (симметрично заглушке)');
    }
    if (bracketHoles.holes.some((h) => h.kind === 'minifixDowel')) {
      problems.push('планка крепёжная: не должно быть дюбеля — она торцевая деталь узла, а не принимающая');
    }
    const stripDowels = stripHoles.holes.filter((h) => h.kind === 'minifixDowel');
    const stripCamsOrBolts = stripHoles.holes.filter((h) => h.kind === 'minifixCam' || h.kind === 'minifixBolt');
    if (stripCamsOrBolts.length) {
      problems.push('фальш-планка: не должно быть гнезда/штока — обе соседние детали примыкают к ней торцом');
    }
    const pointCount = blindHoles.holes.filter((h) => h.kind === 'minifixCam').length;
    if (stripDowels.length !== pointCount * 2) {
      problems.push(`фальш-планка: дюбелей ${stripDowels.length} вместо ${pointCount * 2} (по одному на каждый узел с заглушкой и с планкой крепёжной)`);
    }
    // дюбель на фальш-планке стоит НАПРОТИВ штока — на той же высоте (x)
    // и у того же края (ближнего для заглушки, дальнего для планки крепёжной)
    const stripWidthHalf = stripHoles.width / 2;
    for (const h of blindHoles.holes.filter((c) => c.kind === 'minifixCam')) {
      const opp = stripDowels.some((d) => Math.abs(d.x - h.x) < 0.6 && d.y < stripWidthHalf);
      if (!opp) problems.push(`заглушка↔фальш-планка: дюбель не напротив гнезда (x=${h.x})`);
    }
    for (const h of bracketHoles.holes.filter((c) => c.kind === 'minifixCam')) {
      const opp = stripDowels.some((d) => Math.abs(d.x - h.x) < 0.6 && d.y > stripWidthHalf);
      if (!opp) problems.push(`планка крепёжная↔фальш-планка: дюбель не напротив гнезда (x=${h.x})`);
    }
  }
  cases += 1;
}

// --- шире корпус — шире ДВЕРЬ, узел стыка на месте -------------------------
// К заглушке пристыковывается перпендикулярный ряд, поэтому её ширина и
// положение от угла обязаны быть постоянными при любой ширине корпуса.
{
  const mk = (W) => buildModel(Object.assign({}, base, {
    modules: [{
      name: 'Мойка', width: W, height: 820, depth: 560, corner: true,
      leftSide: 'onBottom', rightSide: 'onBottom', topType: 'railsEdge', noBack: true,
      blindPanel: true, blindStrip: 78, blindWidth: 560,
      base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 0, drawers: 0, facade: 'doorLeft', handle: 'bow160' }],
    }],
  }));
  const get = (m, re) => m.partsRaw.filter((q) => re.test(q.name))[0];
  const a = mk(984), b = mk(1184);
  const bl1 = get(a, /Заглушка/), bl2 = get(b, /Заглушка/);
  const d1 = get(a, /Дверь/), d2 = get(b, /Дверь/);
  if (!bl1 || !bl2 || !d1 || !d2) problems.push('стык: детали фронта не построены');
  else {
    if (Math.abs(bl1.width - 560) > 1 || Math.abs(bl2.width - 560) > 1) {
      problems.push(`заглушка «поехала»: ${bl2.width} мм вместо 560 при другом габарите`);
    }
    // ширина заглушки = глубина СОСЕДНЕГО модуля
    const withNext = (depth) => buildModel(Object.assign({}, base, {
      modules: [{
        name: 'Мойка', width: 1184, height: 820, depth: 510, corner: true,
        leftSide: 'onBottom', rightSide: 'onBottom', topType: 'railsEdge', noBack: true,
        blindPanel: true, blindStrip: 78,
        base: { type: 'legsPlinth', legHeight: 100 },
        sections: [{ shelves: 0, drawers: 0, facade: 'doorLeft', handle: 'bow160' }],
      }, {
        name: 'След', width: 600, height: 820, depth,
        leftSide: 'onBottom', rightSide: 'onBottom', topType: 'rails',
        base: { type: 'legsPlinth', legHeight: 100 },
        sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft', handle: 'bow160' }],
      }],
    }));
    for (const depth of [450, 510, 600]) {
      const bl = withNext(depth).partsRaw.filter((q) => /Заглушка/.test(q.name))[0];
      if (!bl || Math.abs(bl.width - depth) > 1) {
        problems.push(`заглушка: ${bl ? bl.width : '—'} мм при соседе глубиной ${depth}`);
      }
    }
    const edge1 = 984 / 2 - (bl1.boxes[0].x + bl1.boxes[0].w / 2);
    const edge2 = 1184 / 2 - (bl2.boxes[0].x + bl2.boxes[0].w / 2);
    if (Math.abs(edge1 - edge2) > 1) problems.push('заглушка не привязана к углу');
    if (Math.abs((d2.length - d1.length) - 200) > 1) {
      problems.push(`дверь не забрала прирост корпуса: ${d2.length - d1.length} вместо 200 мм`);
    }
  }
  cases += 1;
}

// --- следующий модуль примыкает к фальш-планке углового -------------------
{
  const nb = (n) => ({
    name: n, width: 600, height: 820, depth: 510, topType: 'rails',
    leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
    sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft', handle: 'bow160', drawerSystem: 'innotech' }],
  });
  const sink = {
    name: 'Мойка', width: 984, height: 820, depth: 510, corner: true,
    leftSide: 'onBottom', rightSide: 'onBottom', topType: 'railsEdge', noBack: true,
    blindPanel: true, blindStrip: 78,
    base: { type: 'legsPlinth', legHeight: 100 },
    sections: [{ shelves: 0, drawers: 0, facade: 'doorLeft', handle: 'bow160' }],
  };
  const model = buildModel(Object.assign({}, base, { modules: [nb('М1'), sink, nb('М3'), nb('М4')] }));
  inspect(model, 'примыкание к фальш-планке');

  const brk = model.partsRaw.filter((q) => /крепёжная/.test(q.name))[0];
  const side = model.partsRaw.filter((q) => q.module === 'М3' && /Боковина/.test(q.name))
    .map((q) => q.boxes[0]).sort((a, b) => a.z - b.z)[0];
  if (!brk || !side) problems.push('стык: не найдены планка крепёжная или боковина соседа');
  else {
    const bb = brk.boxes[0];
    const gapZ = (side.z - side.d / 2) - (bb.z + bb.d / 2);
    if (Math.abs(gapZ) > 1) {
      problems.push(`стык: между планкой и корпусом соседа ${Math.round(gapZ)} мм вместо вплотную`);
    }
  }
  cases += 1;
}

// --- видимая боковина режется в материале фасада ---------------------------
// Корпус кухни белый, но боковину, которую видно (до пола или сбоку дна),
// делают в материале фасада; под деревянный фасад — МДФ шпон.
{
  const { DECORS } = window.Modul3D.catalog;
  const white = DECORS.filter((d) => /бел/i.test(d.name))[0] || DECORS[1];
  const oak = DECORS[0];
  const mk = (side, facadeType) => buildModel(Object.assign({}, base, {
    decor: white, facadeDecor: oak,
    modules: [{
      name: 'М', width: 600, height: 820, depth: 510, topType: 'rails',
      leftSide: side, rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft', facadeType, handle: 'bow160' }],
    }],
  }));
  const sideMat = (m, re) => (m.parts.filter((p) => re.test(p.name))[0] || {}).material;
  for (const side of ['floor', 'besideBottom']) {
    const m = mk(side, 'ldsp');
    if (sideMat(m, /Боковина левая/) !== oak.code) {
      problems.push(`видимая боковина «${side}»: не в декоре фасада`);
    }
    if (sideMat(m, /Боковина правая/) !== white.code) {
      problems.push(`скрытая боковина при «${side}»: не в декоре корпуса`);
    }
  }
  const hidden = mk('onBottom', 'ldsp');
  if (sideMat(hidden, /Боковина левая/) !== white.code) {
    problems.push('боковина «на дно» не видна снаружи, а режется из фасадного материала');
  }
  const wood = mk('floor', 'wood');
  if (sideMat(wood, /Боковина левая/) !== 'FAC-VENEER') {
    problems.push('под деревянный фасад видимая боковина не из МДФ шпона');
  }
  const mdf = mk('floor', 'mdf');
  if (sideMat(mdf, /Боковина левая/) !== 'FAC-MDF') {
    problems.push('под фасад МДФ видимая боковина не из МДФ');
  }
  const glass = mk('floor', 'glass4');
  if (sideMat(glass, /Боковина левая/) === 'GLASS-4') {
    problems.push('видимая боковина сделана из стекла — так нельзя');
  }
  // Цоколь — тоже видимая деталь: он в материале фасада, а под дерево — шпон
  for (const [ft, want] of [['ldsp', oak.code], ['mdf', 'FAC-MDF'],
    ['wood', 'FAC-VENEER'], ['glass4', 'FAC-LDSP']]) {
    const mm = mk('onBottom', ft);
    const pl = mm.parts.filter((q) => q.kind === 'plinth')[0];
    if (!pl) { problems.push(`цоколь не построен при фасаде ${ft}`); continue; }
    if (pl.material !== want) {
      problems.push(`цоколь при фасаде ${ft}: ${pl.material} вместо ${want}`);
    }
    if (pl.material === white.code) problems.push('цоколь остался в корпусном декоре — он виден');
  }

  // смета обязана знать новый материал
  const sp = buildSpecification(wood);
  if (!JSON.stringify(sp.sheetMaterials).includes('FAC-VENEER')) {
    problems.push('смета: МДФ шпон не попал в листовые материалы');
  }
  cases += 1;
}

// --- крайний модуль: боковина до стены, задняя стенка в паз ----------------
{
  const mk = (side, worktop) => buildModel(Object.assign({}, base, {
    worktopDepth: worktop,
    modules: [{
      name: 'М', family: 'kitchen', width: 600, height: 820, depth: 510, topType: 'rails',
      leftSide: side, rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft', handle: 'bow160' }],
    }],
  }));
  const get = (m, re) => m.parts.filter((p) => re.test(p.name))[0];
  for (const side of ['floor', 'besideBottom']) {
    const m = mk(side, 600);
    inspect(m, `крайний модуль «${side}»`);
    const vis = get(m, /Боковина левая/), hid = get(m, /Боковина правая/), bk = get(m, /Задняя стенка/);
    // столешница 600, свес над фасадом 20, фасад 18 → боковина 562
    if (!vis || Math.abs(vis.width - 562) > 1) {
      problems.push(`видимая боковина: глубина ${vis ? vis.width : '—'} вместо 562 (до стены)`);
    }
    if (!hid || Math.abs(hid.width - 510) > 1) problems.push('скрытая боковина зачем-то удлинилась');
    if (!bk || !/ПАЗ/.test(bk.note || '')) problems.push('крайний модуль: задняя стенка не в паз');
    // Паз обязан быть на детали и попасть в файлы для ЧПУ
    const vs = m.partsRaw.filter((q) => q.kind === 'side' && (q.grooves || []).length)[0];
    if (!vs) problems.push('паз под заднюю стенку не задан на видимой боковине');
    else {
      const g = vs.grooves[0];
      if (Math.abs(g.depth - 8) > 0.1) problems.push(`паз глубиной ${g.depth} вместо 8`);
      if (g.w < 3 || g.w > 9) problems.push(`ширина паза ${g.w} не под ХДФ`);
      if (g.y0 < 0 || g.y0 > vs.width) problems.push('паз лежит за пределами детали');
    }
    const csv = window.Modul3D.cnc.buildDrillCsv(m);
    if (!/паз/i.test(csv)) problems.push('ЧПУ: паза нет в CSV');
    const dxf = window.Modul3D.cnc.buildDrillDxf(m);
    if (!/GROOVE_/.test(dxf)) problems.push('ЧПУ: паза нет в DXF');
    // В таблице чертежа модуля обязан быть столбец «Материал»
    const html = String(buildDrawings(m, true));
    if (!/<th>Деталь<\/th><th>Материал<\/th>/.test(html.replace(/\s+/g, ''))) {
      const compact = html.replace(/\s+/g, '');
      if (compact.indexOf('<th>Деталь</th><th>Материал</th>') === -1) {
        problems.push('чертёж модуля: нет столбца «Материал» после «Деталь»');
      }
    }
    // Стенка остаётся на задней плоскости корпуса и НЕ уезжает внутрь
    const bb = bk && bk.boxes[0];
    if (bb && bb.z > -510 / 2) problems.push('задняя стенка заехала внутрь корпуса');
    // По ширине: со стороны видимой боковины — в паз, с другой — внахлёст
    // слева паз: 600/2 − 18 + 8 − 2; справа накладная с зазором 1 мм
    const wantBack = (600 / 2 - 18 + 8 - 2) + (600 / 2 - 1);
    if (bk && Math.abs(bk.length - wantBack) > 1) {
      problems.push(`задняя стенка ${bk ? bk.length : '—'} вместо ${wantBack} (паз + допуск)`);
    }
    if (bk && Math.abs(bk.width - (820 - 100 - 2)) > 1) {
      problems.push(`задняя стенка по высоте ${bk.width} вместо ${820 - 100 - 2}`);
    }
    // Полкодержатели стоят ПОД ПОЛКОЙ, а не за корпусом
    const shelf = m.partsRaw.filter((q) => q.kind === 'shelf')[0];
    if (shelf) {
      const sb = shelf.boxes[0];
      for (const pin of m.partsRaw.filter((q) => q.kind === 'shelfPin')) {
        const pz = pin.boxes[0].z;
        if (pz < sb.z - sb.d / 2 - 1 || pz > sb.z + sb.d / 2 + 1) {
          problems.push(`полкодержатель ушёл за пределы полки (z ${Math.round(pz)})`);
        }
      }
    }
  }
  // без видимой боковины всё по-старому
  const plain = mk('onBottom', 600);
  const pb = get(plain, /Задняя стенка/);
  if (pb && /ПАЗ/.test(pb.note || '')) problems.push('обычный модуль: задняя стенка зря ушла в паз');
  // Накладная стенка меньше проёма на 2 мм по обеим сторонам
  if (pb && (Math.abs(pb.length - 598) > 0.6 || Math.abs(pb.width - 718) > 0.6)) {
    problems.push(`накладная стенка ${pb.length}×${pb.width} вместо 598×718 (запас 2 мм)`);
  }
  const ps = get(plain, /Боковина левая/);
  if (ps && Math.abs(ps.width - 510) > 1) problems.push('обычный модуль: боковина зря удлинилась');
  // столешницы нет — удлинять не от чего
  const noTop = mk('floor', 0);
  const nts = get(noTop, /Боковина левая/);
  if (nts && Math.abs(nts.width - 510) > 1) {
    problems.push('без столешницы боковина всё равно удлинилась');
  }
  cases += 1;
}

// --- деталь режется по-настоящему: слои под присадку и паз -----------------
// В 3D отверстие должно быть УГЛУБЛЕНИЕМ с дном, а паз — канавкой, а не
// наклейкой поверх грани. Проверяем математику раскладки слоёв.
{
  let panelSlabs = null;
  try {
    // viewer.js грузится без Three.js: на верхнем уровне там только функции
    require(path.join(ROOT, 'src', 'viewer.js'));
    panelSlabs = (window.Modul3D.viewer || {}).panelSlabs;
  } catch (err) {
    problems.push('viewer.js не загружается без браузера: ' + err.message);
  }
  if (!panelSlabs) problems.push('panelSlabs не опубликован — резку слоёв не проверить');
  else {
    // глухое отверстие: два слоя, вырез только в верхнем
    const blind = panelSlabs(500, 700, 18, [{ u: 34, v: 50, r: 7.5, depth: 13.4, fromFront: true }]);
    if (blind.length !== 2) problems.push(`глухое отверстие: слоёв ${blind.length} вместо 2`);
    else {
      if (Math.abs(blind[0].b - 13.4) > 0.01) problems.push('глухое отверстие: глубина слоя не 13,4');
      if (blind[0].cuts.length !== 1) problems.push('глухое отверстие: не вырезано в лицевом слое');
      if (blind[1].cuts.length !== 0) problems.push('глухое отверстие: прорезало деталь насквозь — нет дна');
    }
    // паз 8 мм
    const gr = panelSlabs(562, 820, 18, [{ u0: 0, v0: 46, u1: 562, v1: 54, depth: 8, fromFront: true }]);
    if (gr.length !== 2 || Math.abs(gr[0].b - 8) > 0.01) problems.push('паз: слои разложены неверно');
    if (gr[1] && gr[1].cuts.length) problems.push('паз: прорезал деталь насквозь');
    // сквозное отверстие: один слой с вырезом
    const thr = panelSlabs(500, 700, 18, [{ u: 10, v: 10, r: 2.5, through: true }]);
    if (thr.length !== 1 || thr[0].cuts.length !== 1) problems.push('сквозное отверстие: не проходит насквозь');
    // присадка с двух сторон: три слоя, средний целый
    const both = panelSlabs(500, 700, 18, [
      { u: 34, v: 50, r: 7.5, depth: 13.4, fromFront: true },
      { u: 100, v: 50, r: 4, depth: 12, fromFront: false },
    ]);
    if (both.length !== 3) problems.push(`двусторонняя присадка: слоёв ${both.length} вместо 3`);

    // Раскладка локальных осей детали: у двери длина горизонтальна,
    // у боковины и доборной планки — вертикальна.
    const { lengthAlongU, edgeDrill } = window.Modul3D.viewer;
    if (lengthAlongU(702, 560, 702)) problems.push('боковина: длина принята за горизонталь');
    if (!lengthAlongU(564, 564, 510)) problems.push('дно: длина принята за вертикаль');
    if (!lengthAlongU(597, 597, 717)) problems.push('дверь: длина принята за вертикаль');
    if (lengthAlongU(720, 560, 720)) problems.push('заглушка: длина принята за горизонталь');

    // Отверстие В ТОРЕЦ уходит ВГЛУБЬ детали, а не наружу
    const near = edgeDrill(0, 255, 564, 510, 50);
    const far = edgeDrill(564, 255, 564, 510, 50);
    if (!near.alongU || !far.alongU) problems.push('в торец: ось сверления выбрана неверно');
    if (near.uPos !== -(564 / 2 - 50 / 2)) problems.push('в торец: метка ушла за кромку детали');
    if (far.uPos !== (564 / 2 - 50 / 2)) problems.push('в торец: метка с дальнего торца ушла наружу');
    if (Math.abs(near.uPos) + near.len / 2 > 564 / 2 + 0.01) {
      problems.push('в торец: отверстие выходит за габарит детали');
    }
  }
  cases += 1;
}

// --- с боков ящика фурнитуры не видно --------------------------------------
{
  const mk = (sys, code) => buildModel(Object.assign({}, base, {
    modules: [{
      name: 'Т', width: 600, height: 820, depth: 510, topType: 'rails',
      leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 0, drawers: 2, facade: 'drawers', handle: 'bow160',
        drawerSystem: sys, drawerBoxHeight: code }],
    }],
  }));
  for (const sys of ['ballBearing', 'quadro']) {
    const model = mk(sys, '150');
    inspect(model, `ящик ${sys}: присадка короба`);
    const side = model.partsRaw.filter((p) => p.kind === 'drawerSide')[0];
    const front = model.partsRaw.filter((p) => /Передняя стенка ящика/.test(p.name))[0];
    if (!side) { problems.push(`${sys}: нет боковины ящика`); continue; }
    const hs = side.holes || [];
    if (!hs.length) problems.push(`${sys}: боковина ящика без присадки`);
    // ГЛАВНОЕ: снаружи ящика фурнитуры не видно — сквозных отверстий нет
    if (hs.some((h) => h.through)) problems.push(`${sys}: в боковине ящика сквозное отверстие`);
    // Глубина считается по толщине только для присадки В ПЛАСТЬ: отверстие
    // в торец идёт вдоль детали и её толщиной не ограничено.
    if (hs.some((h) => h.side !== 'edge' && (h.depth || 0) >= side.thickness)) {
      problems.push(`${sys}: присадка боковины глубже плиты — выйдет наружу`);
    }
    // снаружи только ответная планка направляющей, изнутри — сборка короба
    const outside = hs.filter((h) => h.side === 'back');
    const inside = hs.filter((h) => h.side === 'front');
    const bottomPart = model.partsRaw.filter((p) => p.kind === 'drawerBottom')[0];
    const RUNK = ['drawerRunner', 'runnerLocator', 'runnerLatch'];
    const runOnBottom = ((bottomPart || {}).holes || []).filter((h) => RUNK.indexOf(h.kind) !== -1);
    if (sys === 'quadro') {
      // СКРЫТАЯ направляющая. Короб держат зацепы в передней и задней
      // стенках; гнёзда в дне добавляются только при тонком дне (ДВП).
      const rearPins = model.partsRaw
        .reduce((n, p) => n + (p.holes || []).filter((h) => /runnerPin/.test(h.kind)).length, 0);
      if (!rearPins) problems.push('quadro: короб ничем не цепляется за направляющую');
      if (runOnBottom.length) {
        problems.push('quadro: в ЛДСП-дне лишняя присадка под направляющую');
      }
      if (outside.some((h) => h.kind === 'drawerRunner')) {
        problems.push('quadro: присадка направляющей на боковине — она скрытая, под дном');
      }
    } else {
      if (!outside.length) problems.push(`${sys}: нет присадки под ответную планку направляющей`);
      if (outside.some((h) => h.kind !== 'drawerRunner')) {
        problems.push(`${sys}: снаружи боковины ящика лишняя присадка`);
      }
    }
    if (!inside.some((h) => h.kind === 'minifixDowel')) {
      problems.push(`${sys}: короб ящика собран без крепежа`);
    }
    // ВНУТРИ ящика эксцентриков быть не должно: гнёзда выводятся наружу
    // Эксцентрик должен выходить НАРУЖУ короба: у передней стенки это
    // сторона фасада ('front'), у задней — сторона корпуса ('back').
    for (const q of model.partsRaw.filter((x) => /стенка ящика/.test(x.name))) {
      const isFrontWall = /Передняя/.test(q.name);
      for (const h of (q.holes || [])) {
        if (h.kind !== 'minifixCam') continue;
        if (h.side !== (isFrontWall ? 'front' : 'back')) {
          problems.push(`${sys}: гнездо Ø15 на «${q.name}» смотрит внутрь ящика`);
        }
      }
    }
    // Дно короба должно быть притянуто к стенкам, а не лежать свободно
    // Дно режется В РАЗМЕР КОРОБА: перекрывает торцы боковин целиком,
    // иначе конфирматы в них не попадут.
    {
      const ds = model.partsRaw.filter((p) => p.kind === 'drawerSide')
        .sort((a, b) => a.boxes[0].x - b.boxes[0].x);
      const bt0 = model.partsRaw.filter((p) => p.kind === 'drawerBottom')[0];
      if (ds.length >= 2 && bt0) {
        const outer = (ds[ds.length - 1].boxes[0].x + ds[ds.length - 1].boxes[0].w / 2)
          - (ds[0].boxes[0].x - ds[0].boxes[0].w / 2);
        if (Math.abs(bt0.width - outer) > 0.6) {
          problems.push(`${sys}: дно ${bt0.width} не в размер короба ${outer}`);
        }
      }
    }
    const bot = model.partsRaw.filter((x) => x.kind === 'drawerBottom')[0];
    const FIXK = ['boxBottomFix', 'confirmatThrough'];
    const botFix = bot ? (bot.holes || []).filter((h) => FIXK.indexOf(h.kind) !== -1) : [];
    if (!botFix.length) problems.push(`${sys}: дно ящика ничем не притянуто`);
    if (botFix.some((h) => !h.through)) problems.push(`${sys}: крепление дна не сквозное`);
    const sideEdge = hs.filter((h) => h.side === 'edge'
      && (h.kind === 'boxBottomFix' || h.kind === 'confirmatEdge'));
    if (!sideEdge.length) problems.push(`${sys}: в торце боковины нет ответной присадки под дно`);
    // ЛДСП-дно тянем КОНФИРМАТОМ: Ø7 насквозь и Ø5×50 в торец стенки
    if (bot && bot.thickness >= 10) {
      if (botFix.some((h) => h.d !== 7)) problems.push(`${sys}: ЛДСП-дно не под конфирмат (Ø${botFix[0].d})`);
      const ce = sideEdge.filter((h) => h.d === 5 && h.depth >= 40);
      if (!ce.length) problems.push(`${sys}: в торце боковины нет Ø5×50 под конфирмат`);
      // Дно тянется по ВСЕМУ периметру: две боковины + перед и зад.
      // Сумма ответных отверстий обязана сойтись с числом конфирматов в дне.
      const wallEdge = model.partsRaw.filter((p) => p.kind === 'drawerBack')
        .reduce((n, p) => n + (p.holes || []).filter((h) => h.kind === 'confirmatEdge').length, 0);
      const sideEdgeAll = model.partsRaw.filter((p) => p.kind === 'drawerSide')
        .reduce((n, p) => n + (p.holes || []).filter((h) => h.kind === 'confirmatEdge').length, 0);
      const perBox = (wallEdge + sideEdgeAll) / model.partsRaw.filter((p) => p.kind === 'drawerBottom').length;
      if (!wallEdge) problems.push(`${sys}: перед и зад ящика не притянуты к дну`);
      if (Math.round(perBox) !== botFix.length) {
        problems.push(`${sys}: конфирматов в дне ${botFix.length}, ответных в торцах ${Math.round(perBox)}`);
      }
    } else if (bot) {
      // тонкое ХДФ конфирматом не тянут — там саморез
      if (botFix.some((h) => h.d === 7)) problems.push(`${sys}: в ХДФ-дно поставлен конфирмат`);
    }
    // ответная часть — на передней/задней стенке
    const fh = (front && front.holes) || [];
    const cams = fh.filter((h) => h.kind === 'minifixCam').length;
    const dow = inside.filter((h) => h.kind === 'minifixDowel').length;
    if (!cams) problems.push(`${sys}: в стенке короба нет гнезда минификса`);
    if (cams && dow && cams !== dow) {
      problems.push(`${sys}: гнёзд ${cams}, дюбелей в боковине ${dow} — не сходится`);
    }
    cases += 1;
  }
}

// --- корпусный профиль направляющей стоит на своей высоте ------------------
// У скрытых (Quadro) он идёт ПОД ДНОМ короба, у боковых шариковых — по
// середине боковины. Перепутать — значит промахнуться мимо направляющей.
{
  const mk = (sys) => buildModel(Object.assign({}, base, {
    modules: [{
      name: 'Т', width: 600, height: 820, depth: 510, topType: 'rails',
      leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 0, drawers: 2, facade: 'drawers', handle: 'bow160',
        drawerSystem: sys, drawerBoxHeight: '150' }],
    }],
  }));
  for (const [sys, where] of [['quadro', 'bottom'], ['ballBearing', 'side']]) {
    const model = mk(sys);
    const panel = model.partsRaw.filter((p) => p.kind === 'side')[0];
    const pb = panel.boxes[0];
    const runY = (panel.holes || []).filter((h) => h.kind === 'drawerRunner')
      .map((h) => pb.y - pb.h / 2 + h.x);
    const bots = model.partsRaw.filter((p) => p.kind === 'drawerBottom').map((p) => p.boxes[0]);
    const sides = model.partsRaw.filter((p) => p.kind === 'drawerSide').map((p) => p.boxes[0]);
    if (!runY.length) { problems.push(`${sys}: нет присадки направляющей в боковине корпуса`); continue; }
    for (const ry of runY) {
      const nearBottom = bots.some((b) => Math.abs(ry - b.y) < 20);
      const nearSideMid = sides.some((b) => Math.abs(ry - b.y) < 25);
      if (where === 'bottom' && !nearBottom) {
        problems.push(`quadro: профиль направляющей на высоте ${Math.round(ry)} — не под дном короба`);
      }
      if (where === 'side' && !nearSideMid) {
        problems.push(`${sys}: профиль направляющей не по середине боковины короба`);
      }
    }
    cases += 1;
  }
}

// --- конфирмат дна и присадка направляющей не пересекаются -----------------
// Конфирмат идёт из нижнего торца боковины ВВЕРХ на 50 мм по оси плиты, а
// шуруп направляющей — снаружи вглубь. Если они сойдутся, сверло попадёт
// в тело конфирмата: ящик собрать нельзя.
{
  for (const hgt of ['80', '100', '120', '150', '200']) {
    for (const nl of [300, 350, 450, 500, 550]) {
      const model = buildModel(Object.assign({}, base, {
        modules: [{
          name: 'Т', width: 600, height: 820, depth: nl + 40, topType: 'rails',
          leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
          sections: [{ shelves: 0, drawers: 2, facade: 'drawers', handle: 'bow160',
            drawerSystem: 'quadro', drawerBoxHeight: hgt }],
        }],
      }));
      const side = model.partsRaw.filter((p) => p.kind === 'drawerSide')[0];
      if (!side) continue;
      const run = (side.holes || []).filter((h) => h.kind === 'drawerRunner');
      const conf = (side.holes || []).filter((h) => h.kind === 'confirmatEdge');
      for (const r of run) {
        for (const c of conf) {
          const clear = Math.abs(r.x - c.x) - (r.d / 2 + c.d / 2);
          const sameZone = (r.y - r.d / 2) <= (c.depth || 0);
          const reaches = (r.depth || 0) > side.thickness / 2 - c.d / 2;
          if (sameZone && reaches && clear < 3) {
            problems.push(`ящик ${hgt}/NL${nl}: шуруп направляющей (x${r.x}) попадает `
              + `в конфирмат дна (x${c.x}), зазор ${clear.toFixed(1)} мм`);
          }
        }
      }
      cases += 1;
    }
  }
}

// --- узкая планка не должна проворачиваться --------------------------------
// Планка-царга 100 мм держится на ОДНОМ крепеже: без нагеля она вращается
// вокруг его оси и корпус теряет геометрию.
{
  for (const sd of ['onBottom', 'floor']) {
    const model = buildModel(Object.assign({}, base, {
      modules: [{
        name: 'Т', width: 600, height: 820, depth: 510, topType: 'rails',
        leftSide: sd, rightSide: sd, base: { type: 'legsPlinth', legHeight: 100 },
        sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft', handle: 'bow160' }],
      }],
    }));
    inspect(model, `нагель планки, боковина ${sd}`);
    const rails = model.partsRaw.filter((p) => p.kind === 'top');
    if (!rails.length) problems.push(`${sd}: планок нет`);
    for (const r of rails) {
      const hs = r.holes || [];
      const fix = hs.filter((h) => h.side === 'edge'
        && (h.kind === 'confirmatEdge' || h.kind === 'minifixBolt'));
      const dowels = hs.filter((h) => h.kind === 'dowelEdge');
      // на каждый торец: один крепёж и один нагель рядом
      if (fix.length < 2) problems.push(`${sd}: у планки «${r.name}» нет крепежа в торцах`);
      if (dowels.length < 2) {
        problems.push(`${sd}: планка «${r.name}» на одном крепеже без нагеля — провернётся`);
      }
      // Суммарная глубина двух отверстий обязана быть БОЛЬШЕ шканта:
      // шкант 8×30 → не меньше 33 мм, иначе он упрётся в дно.
      const faceDepth = 13, DOWEL_LEN = 30;
      for (const d of dowels) {
        if ((d.depth || 0) + faceDepth < DOWEL_LEN + 3) {
          problems.push(`шкант 8×${DOWEL_LEN}: суммарная глубина `
            + `${(d.depth || 0) + faceDepth} мм — шкант упрётся`);
        }
        if (d.d !== 8) problems.push(`нагель Ø${d.d} вместо Ø8`);
        if (d.y < 8 || d.y > r.width - 8) problems.push('нагель вышел за кромку планки');
        const near = fix.filter((f) => Math.abs(f.y - d.y) < 20);
        if (near.length) problems.push('нагель стоит вплотную к крепежу — смысла нет');
      }
    }
    // ответная часть нагеля — в пласти боковины
    const panel = model.partsRaw.filter((p) => p.kind === 'side')[0];
    const face = (panel.holes || []).filter((h) => h.kind === 'dowelFace');
    if (!face.length) problems.push(`${sd}: в боковине нет отверстий под нагель`);
    for (const h of face) {
      if (h.d !== 8) problems.push(`нагель в пласти Ø${h.d} вместо Ø8`);
      if (h.through) problems.push('нагель просверлен насквозь');
      // и не должен подходить к наружной пласти ближе 3 мм
      if ((h.depth || 0) > panel.thickness - 3) {
        problems.push(`нагель в пласти: глубина ${h.depth} при плите ${panel.thickness} — выйдет наружу`);
      }
    }
    cases += 1;
  }
}

// --- Quadro V6: раскрой по инструкции Hettich -------------------------------
// Источник: MTA_9 302 560 00 (Quadro V6 Silent System, насадной монтаж, EB20):
//   SKW = LB − 40 (EB20, плита ≤16) · дно = NL − 10 · KT = NL + 13
{
  const { pickNL, DRAWER_SYSTEMS } = window.Modul3D.catalog;
  const sys = DRAWER_SYSTEMS.quadro;
  // таблица из инструкции: NL → минимальная глубина корпуса
  for (const [nl, kt] of [[250, 263], [300, 313], [350, 363], [400, 413], [450, 463], [500, 513]]) {
    if (sys.minCorpusDepth(nl) !== kt) {
      problems.push(`Quadro: для NL${nl} минимальная глубина ${sys.minCorpusDepth(nl)} вместо ${kt}`);
    }
    if (pickNL(sys, kt) !== nl) problems.push(`Quadro: при глубине ${kt} подобрана не NL${nl}`);
    // У самой короткой NL проверять нечего: если не влезает даже она,
    // подбор возвращает её же как запасной вариант (и модель предупреждает).
    if (nl !== sys.nl[0] && pickNL(sys, kt - 1) === nl) {
      problems.push(`Quadro: NL${nl} влезла в корпус мельче KT`);
    }
  }
  // Боковина короба стоит выше профиля направляющей — до боковины корпуса
  // 8 мм на сторону. А ДНО проходит между профилями: SKW = LB − 40 (EB20)
  // и LB − 46 (EB23).
  // 20 мм — от боковины КОРПУСА до ВНУТРЕННЕЙ грани боковины ящика,
  // независимо от толщины плит. Толще боковина ящика — короб шире, а
  // размер 20 остаётся.
  for (const t of [16, 18, 19]) {
    if (sys.clearanceFor(t) !== 20) {
      problems.push(`Quadro: при плите ${t} зазор ${sys.clearanceFor(t)} вместо 20`);
    }
  }
  if (!sys.clearanceToInner) problems.push('Quadro: зазор должен отсчитываться до внутренней грани');

  for (const d of [510, 560]) {
    const model = buildModel(Object.assign({}, base, {
      bodyThickness: 16,
      modules: [{
        name: 'Т', width: 600, height: 820, depth: d, topType: 'rails',
        leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
        sections: [{ shelves: 0, drawers: 2, facade: 'drawers', handle: 'bow160',
          drawerSystem: 'quadro', drawerBoxHeight: '150' }],
      }],
    }));
    inspect(model, `Quadro V6, корпус ${d}`);
    const side = model.partsRaw.filter((p) => p.kind === 'drawerSide')[0];
    const bot = model.partsRaw.filter((p) => p.kind === 'drawerBottom')[0];
    const nl = Number((side.note.match(/NL (\d+)/) || [])[1]);
    const LB = 600 - 2 * 16;
    if (!nl) { problems.push('Quadro: NL не записана в деталь'); continue; }
    // Дно из ЛДСП режется В РАЗМЕР КОРОБА (NL). Пометка NL−10 в инструкции
    // относится к коробу с тонким дном из ДВП, у нас такого нет.
    if (Math.abs(bot.length - nl) > 0.6) {
      problems.push(`Quadro: дно ${bot.length} вместо NL = ${nl}`);
    }
    if (sys.thinBottomLen(nl) !== nl - 10) problems.push('Quadro: потеряна формула ДВП-дна NL−10');
    // SKW = LB − 40 — это ЧИСТЫЙ ПРОСВЕТ короба (между боковинами ящика).
    const dsQ = model.partsRaw.filter((p) => p.kind === 'drawerSide')
      .sort((a, b) => a.boxes[0].x - b.boxes[0].x);
    if (dsQ.length >= 2) {
      const innerQ = (dsQ[dsQ.length - 1].boxes[0].x - dsQ[dsQ.length - 1].boxes[0].w / 2)
        - (dsQ[0].boxes[0].x + dsQ[0].boxes[0].w / 2);
      if (Math.abs(innerQ - (LB - 40)) > 0.6) {
        problems.push(`Quadro: просвет короба ${innerQ} вместо SKW = LB−40 = ${LB - 40}`);
      }
    }
    if (sys.minCorpusDepth(nl) > d - 3) {
      problems.push(`Quadro: NL${nl} не помещается в корпус ${d} (нужно ${sys.minCorpusDepth(nl)})`);
    }
    // ГНЁЗДА В ДНЕ не ставим: они нужны коробу с тонким дном из ДВП, а у
    // Quadro дно всегда ЛДСП — такого ящика в базе нет. Короб цепляется
    // за направляющую зацепами в передней и задней стенках.
    const loc = (bot.holes || []).filter((h) => h.kind === 'runnerLocator');
    const latch = (bot.holes || []).filter((h) => h.kind === 'runnerLatch');
    if (loc.length || latch.length) {
      problems.push('Quadro: в ЛДСП-дне лишние гнёзда — они только для дна из ДВП');
    }
    // НАСАДНОЙ монтаж: уступа нет, механизм надевается на ШТИФТЫ, дно
    // лежит под стенками и режется в размер короба.
    // ЗАЦЕП НАПРАВЛЯЮЩЕЙ — Ø6×10 в ТОРЕЦ ДНА, 7 мм от боковой кромки.
    const pinsB = (bot.holes || []).filter((h) => h.kind === 'runnerPinRear');
    if (pinsB.length < 2) problems.push('насадной Quadro: в торце дна нет Ø6×10 под зацеп');
    for (const h of pinsB) {
      if (h.d !== 6 || h.depth !== 10) problems.push(`насадной Quadro: зацеп Ø${h.d}×${h.depth} вместо Ø6×10`);
      if (h.side !== 'edge') problems.push('насадной Quadro: зацеп сверлится не в торец дна');
      if (Math.abs(Math.min(h.y, bot.width - h.y) - 7) > 0.6) {
        problems.push(`насадной Quadro: зацеп в ${h.y} мм от кромки вместо 7`);
      }
    }
    if (model.partsRaw.some((p) => p.kind === 'drawerSide' && (p.grooves || []).length)) {
      problems.push('насадной Quadro: у боковины паз под дно — уступа тут нет');
    }
    void nl;
    cases += 1;
  }
}

// --- КАЖДОЕ отверстие в торце имеет пару на ответной детали -----------------
// Крепёж работает только если торцевое отверстие и ответное ему в пласти
// лежат на ОДНОЙ ОСИ. Считаем оба в мировых координатах и сводим попарно.
{
  const PAIRS = {
    confirmatEdge: ['confirmatThrough'],
    // Шток Ø8 сидит в торце детали и заходит в ДЮБЕЛЬ ответной панели
    // (гнездо Ø15 — на той же детали, что и шток, поэтому в пару не идёт).
    minifixBolt: ['minifixDowel'],
    dowelEdge: ['dowelFace'],
  };
  // мировые координаты отверстия по его детали
  const worldOf = (part, h) => {
    const b = part.boxes[0];
    const thin = Math.min(b.w, b.h, b.d);
    const planeIsX = b.w === thin;
    const planeIsY = !planeIsX && b.h === thin;
    const uSize = planeIsX ? b.d : b.w;
    const vSize = planeIsX ? b.h : (planeIsY ? b.d : b.h);
    const lenIsU = Math.abs(part.length - uSize) <= Math.abs(part.length - vSize);
    const u = lenIsU ? h.x : h.y;
    const v = lenIsU ? h.y : h.x;
    if (planeIsX) return { x: b.x, y: b.y - b.h / 2 + v, z: b.z - b.d / 2 + u };
    if (planeIsY) return { x: b.x - b.w / 2 + u, y: b.y, z: b.z - b.d / 2 + v };
    return { x: b.x - b.w / 2 + u, y: b.y - b.h / 2 + v, z: b.z };
  };
  const near = (a, b, ax) => {
    // на общей оси совпадают две координаты из трёх (третья — направление сверла)
    const d = ['x', 'y', 'z'].filter((k) => k !== ax).map((k) => Math.abs(a[k] - b[k]));
    return d.every((v) => v <= 1.5);
  };

  const sets = [
    { name: 'кухня на дне', mod: { leftSide: 'onBottom', rightSide: 'onBottom', topType: 'rails' } },
    { name: 'шкаф до пола', mod: { leftSide: 'floor', rightSide: 'floor', topType: 'panel' } },
    { name: 'сбоку дна', mod: { leftSide: 'besideBottom', rightSide: 'besideBottom', topType: 'rails' } },
  ];
  for (const st of sets) {
    const model = buildModel(Object.assign({}, base, {
      modules: [Object.assign({
        name: 'Т', width: 600, height: 820, depth: 510,
        base: { type: 'legsPlinth', legHeight: 100 },
        sections: [{ shelves: 1, drawers: 2, facade: 'drawers', handle: 'bow160',
          drawerSystem: 'quadro', drawerBoxHeight: '150' }],
      }, st.mod)],
    }));
    const parts = model.partsRaw.filter((p) => !p.hardware);
    for (const p of parts) {
      for (const h of (p.holes || [])) {
        const want = PAIRS[h.kind];
        if (!want) continue;
        const wp = worldOf(p, h);
        let found = false;
        for (const q of parts) {
          if (q === p) continue;
          for (const g of (q.holes || [])) {
            if (want.indexOf(g.kind) === -1) continue;
            const wq = worldOf(q, g);
            // ось сверления — та, вдоль которой детали стыкуются
            if (near(wp, wq, 'x') || near(wp, wq, 'y') || near(wp, wq, 'z')) { found = true; break; }
          }
          if (found) break;
        }
        if (!found) {
          problems.push(`${st.name}: «${h.kind}» на детали «${p.name}» `
            + `(${Math.round(wp.x)},${Math.round(wp.y)},${Math.round(wp.z)}) без ответного отверстия`);
        }
      }
    }
    cases += 1;
  }
}

// --- ВСЕ отверстия лежат внутри своей детали (общая проверка) ---------------
{
  const cases2 = [
    { drawerSystem: 'quadro', drawerBoxHeight: '150' },
    { drawerSystem: 'ballBearing', drawerBoxHeight: '150' },
    { drawerSystem: 'tandembox', drawerBoxHeight: 'auto' },
  ];
  for (const cfg of cases2) {
    for (const t of [16, 18]) {
      const model = buildModel(Object.assign({}, base, {
        bodyThickness: t,
        modules: [{
          name: 'Т', width: 600, height: 820, depth: 560, topType: 'rails',
          leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
          sections: [Object.assign({ shelves: 1, drawers: 2, facade: 'drawers', handle: 'bow160' }, cfg)],
        }],
      }));
      for (const p of model.partsRaw) {
        for (const h of (p.holes || [])) {
          if (h.x < -0.5 || h.x > p.length + 0.5 || h.y < -0.5 || h.y > p.width + 0.5) {
            problems.push(`${cfg.drawerSystem}/${t}: отверстие «${h.kind}» (${h.x}, ${h.y}) `
              + `вне детали «${p.name}» ${p.length}×${p.width}`);
          }
        }
        for (const g of (p.grooves || [])) {
          if (g.y0 < -0.5 || g.y0 > p.width + 0.5 || g.x1 > p.length + 0.5) {
            problems.push(`${cfg.drawerSystem}/${t}: паз вне детали «${p.name}»`);
          }
        }
      }
      cases += 1;
    }
  }
}

// --- Quadro V6 Stop Control, надвижной монтаж (MTA_9 296 800 00) -----------
{
  const { pickNL, DRAWER_SYSTEMS } = window.Modul3D.catalog;
  const sys = DRAWER_SYSTEMS.quadroSlide;
  if (!sys) problems.push('в меню нет надвижного Quadro V6');
  else {
    // таблица NL → минимальная глубина корпуса из инструкции
    for (const [nl, kt] of [[250, 263], [280, 293], [320, 333], [380, 393],
      [420, 433], [480, 493], [550, 563], [600, 613]]) {
      if (sys.nl.indexOf(nl) === -1) problems.push(`надвижной Quadro: нет NL${nl}`);
      if (sys.minCorpusDepth(nl) !== kt) {
        problems.push(`надвижной Quadro: для NL${nl} нужна глубина ${kt}, а считается ${sys.minCorpusDepth(nl)}`);
      }
      if (pickNL(sys, kt) !== nl) problems.push(`надвижной Quadro: при глубине ${kt} подобрана не NL${nl}`);
    }
    // дно на 12 мм короче NL (у насадного было 10)
    if (sys.bottomLen(500) !== 500) problems.push('надвижной Quadro: дно ЛДСП не в размер короба');
    if (sys.thinBottomLen(500) !== 488) problems.push('надвижной Quadro: потеряна формула ДВП-дна NL−12');
    const model = buildModel(Object.assign({}, base, {
      bodyThickness: 16,
      modules: [{
        name: 'Т', width: 600, height: 820, depth: 560, topType: 'rails',
        leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
        sections: [{ shelves: 0, drawers: 2, facade: 'drawers', handle: 'bow160',
          drawerSystem: 'quadroSlide', drawerBoxHeight: '150' }],
      }],
    }));
    inspect(model, 'Quadro V6 надвижной');
    const bot = model.partsRaw.filter((p) => p.kind === 'drawerBottom')[0];
    const side = model.partsRaw.filter((p) => p.kind === 'drawerSide')[0];
    const nl = Number((side.note.match(/NL (\d+)/) || [])[1]);
    // КОНСТРУКЦИЯ НАДВИЖНОГО КОРОБА:
    //   • дно во всю длину, лежит ПОД передней и задней стенками;
    //   • стенки ниже боковин на 28 мм (уступ 12 + толщина дна 16);
    //   • боковины выступают на 12 мм ниже дна — упор направляющей;
    //   • дно ↔ стенки — конфирмат снизу, всё остальное — минификс.
    const botsAll = model.partsRaw.filter((p) => p.kind === 'drawerBottom').map((p) => p.boxes[0]);
    for (const sp of model.partsRaw.filter((p) => p.kind === 'drawerSide')) {
      const sb = sp.boxes[0];
      const botB = botsAll.slice().sort((a, b) => Math.abs(a.y - sb.y) - Math.abs(b.y - sb.y))[0];
      const ledge = (botB.y - botB.h / 2) - (sb.y - sb.h / 2);
      if (Math.abs(ledge - 12) > 0.6) {
        problems.push(`надвижной Quadro: уступ ${Math.round(ledge)} мм вместо 12 — направляющей не во что упереться`);
      }
      if ((sp.grooves || []).length) problems.push('надвижной Quadro: у боковины лишний паз');
      if ((sp.holes || []).some((h) => h.side === 'back')) {
        problems.push('надвижной Quadro: снаружи боковины есть присадка');
      }
      if (!(sp.holes || []).some((h) => h.kind === 'minifixDowel')) {
        problems.push('надвижной Quadro: боковина не связана с дном минификсом');
      }
    }
    // стенки ниже боковин ровно на 28 и стоят НА дне
    const sideH0 = model.partsRaw.filter((p) => p.kind === 'drawerSide')[0].width;
    for (const wp of model.partsRaw.filter((p) => p.kind === 'drawerBack')) {
      if (Math.abs((sideH0 - wp.width) - 28) > 0.6) {
        problems.push(`надвижной Quadro: стенка ${wp.width} — ниже боковины на ${sideH0 - wp.width} вместо 28`);
      }
      const wb = wp.boxes[0];
      const botB = botsAll.slice().sort((a, b) => Math.abs(a.y - wb.y) - Math.abs(b.y - wb.y))[0];
      const gap = (wb.y - wb.h / 2) - (botB.y + botB.h / 2);
      if (Math.abs(gap) > 0.6) problems.push('надвижной Quadro: стенка не стоит на дне');
      if (!(wp.holes || []).some((h) => h.kind === 'confirmatEdge')) {
        problems.push('надвижной Quadro: стенка не притянута конфирматом через дно');
      }
    }
    // дно: во всю длину NL, конфирматы сквозные + минификс к боковинам
    if (Math.abs(bot.length - nl) > 0.6) {
      problems.push(`надвижной Quadro: дно ${bot.length} вместо NL = ${nl}`);
    }
    if (Math.abs(bot.thickness - 16) > 0.1) problems.push('надвижной Quadro: дно не 16 мм');
    const camsB = (bot.holes || []).filter((h) => h.kind === 'minifixCam');
    const boltsB = (bot.holes || []).filter((h) => h.kind === 'minifixBolt');
    const confB = (bot.holes || []).filter((h) => h.kind === 'confirmatThrough');
    if (!confB.length) problems.push('надвижной Quadro: дно не притянуто конфирматом к стенкам');
    if (confB.some((h) => !h.through)) problems.push('надвижной Quadro: конфирмат дна не сквозной');
    if (!camsB.length) problems.push('надвижной Quadro: дно не связано минификсом с боковинами');
    if (camsB.length !== boltsB.length) {
      problems.push(`надвижной Quadro: гнёзд ${camsB.length}, штоков ${boltsB.length}`);
    }
    // Эксцентрики НЕ ДОЛЖНЫ смотреть внутрь ящика: у передней стенки гнездо
    // выходит на сторону фасада, у задней — в глубину корпуса.
    for (const wp of model.partsRaw.filter((p) => p.kind === 'drawerBack')) {
      const isFront = /Передняя/.test(wp.name);
      for (const h of (wp.holes || []).filter((x) => x.kind === 'minifixCam')) {
        if (h.side !== (isFront ? 'front' : 'back')) {
          problems.push(`${wp.name}: гнездо Ø15 смотрит внутрь ящика`);
        }
      }
    }
    // Передний штифт направляющей — Ø6×11 в боковине КОРПУСА, 10 мм от края
    const cabSide = model.partsRaw.filter((p) => p.kind === 'side')[0];
    const cp = (cabSide.holes || []).filter((h) => h.kind === 'runnerPinCabinet');
    if (!cp.length) problems.push('надвижной Quadro: в боковине корпуса нет Ø6×11 под штифт');
    for (const h of cp) {
      if (h.d !== 6 || h.depth !== 11) problems.push(`штифт в боковине Ø${h.d}×${h.depth} вместо Ø6×11`);
      if (Math.abs((cabSide.width - h.y) - 10) > 0.6) {
        problems.push(`штифт в боковине: ${cabSide.width - h.y} мм от переднего края вместо 10`);
      }
    }
    // ПЕРЕДНИЙ ФИКСАТОР крепится К ДНУ СНИЗУ: 2 шурупа 2,5×12 на сторону,
    // оси 26 и 48 мм от ПЕРЕДНЕГО края дна.
    const br = (bot.holes || []).filter((h) => h.kind === 'runnerBracket');
    if (br.length < 4) problems.push('надвижной Quadro: фиксатор не прикручен к дну');
    if (br.some((h) => h.side !== 'back')) {
      problems.push('надвижной Quadro: присадка фиксатора не снизу дна');
    }
    if (br.some((h) => h.d !== 2.5 || h.depth !== 12)) {
      problems.push('надвижной Quadro: фиксатор не Ø2,5×12');
    }
    // Оси идут ВДОЛЬ ПЕРЕДНЕЙ СТЕНКИ: 26 и 48 мм от боковины, 6 мм от
    // переднего края дна — фиксатор упирается в фасад.
    // Цепочка по фиксатору длиной 80: 26 → +48 → +6. Значит оси шурупов
    // в 26 и 74 мм от боковины, а от переднего края дна — 7,5 мм.
    for (const want of [26, 74]) {
      if (!br.some((h) => Math.abs(Math.min(h.y, bot.width - h.y) - want) < 0.6)) {
        problems.push(`надвижной Quadro: нет отверстия фиксатора в ${want} мм от боковины`);
      }
    }
    if (br.some((h) => Math.abs((bot.length - h.x) - 7.5) > 0.6)) {
      problems.push('надвижной Quadro: ось фиксатора не в 7,5 мм от переднего края дна');
    }
    if (model.partsRaw.some((p) => /стенка ящика/.test(p.name)
      && (p.holes || []).some((h) => h.kind === 'runnerBracket'))) {
      problems.push('надвижной Quadro: присадка фиксатора осталась в стенке короба');
    }
    // зацеп направляющей — Ø6×10 в торец дна, 7 мм от боковой кромки
    const pinB2 = (bot.holes || []).filter((h) => h.kind === 'runnerPinRear');
    if (pinB2.length < 2) problems.push('надвижной Quadro: в торце дна нет Ø6×10 под зацеп');
    for (const h of pinB2) {
      if (h.d !== 6 || h.depth !== 10) problems.push('надвижной Quadro: зацеп не Ø6×10');
      if (h.side !== 'edge') problems.push('надвижной Quadro: зацеп сверлится не в торец дна');
      if (Math.abs(Math.min(h.y, bot.width - h.y) - 7) > 0.6) {
        problems.push(`надвижной Quadro: зацеп в ${h.y} мм от кромки вместо 7`);
      }
    }

    cases += 1;
  }
}

// --- у каждой детали с присадкой есть свой чертёж ---------------------------
// Раньше свой лист был только у фасада, и присадку стенок ящика, боковин и
// планок на чертежах было не видно вовсе.
{
  const model = buildModel(Object.assign({}, base, {
    bodyThickness: 16,
    modules: [{
      name: 'Т', width: 600, height: 820, depth: 560, topType: 'rails',
      leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
      sections: [{ shelves: 1, drawers: 2, facade: 'drawers', handle: 'bow160',
        drawerSystem: 'quadro', drawerBoxHeight: '150' }],
    }],
  }));
  const html = String(buildDrawings(model, true));
  const i = html.indexOf('Детали с присадкой');
  if (i === -1) problems.push('чертежи: нет раздела «Детали с присадкой»');
  else {
    const chunk = html.slice(i);
    const titles = [...chunk.matchAll(/<div class="dw-title">([^<]+)<\/div>/g)].map((m2) => m2[1]);
    // каждая непустая деталь с присадкой обязана получить лист
    const need = model.parts.filter((p) => !p.hardware
      && !/Дверь|Фасад/.test(p.name)
      && (((p.holes || []).length) || ((p.grooves || []).length)));
    // Зеркальные детали (левая/правая боковина, передняя/задняя планка)
    // сверлятся одинаково в своей системе координат и идут ОДНИМ листом —
    // поэтому ищем лист по имени ИЛИ по такому же габариту.
    const sheetSizes = [...chunk.matchAll(/<div class="dw-title">[^<]*<\/div>[\s\S]{0,4000?}?<\/div>/g)];
    void sheetSizes;
    for (const p of need) {
      const byName = titles.some((t) => t.indexOf(p.name) !== -1);
      const twin = need.some((q) => q !== p && q.length === p.length && q.width === p.width
        && q.thickness === p.thickness && titles.some((t) => t.indexOf(q.name) !== -1));
      if (!byName && !twin) {
        problems.push(`чертежи: нет листа детали «${p.name}» с присадкой`);
      }
    }
    // и на листе передней стенки ящика должен быть штифт переднего держателя
    const wallIdx = chunk.indexOf('Передняя стенка ящика');
    if (wallIdx === -1) problems.push('чертежи: нет листа передней стенки ящика');
    else {
      const wall = model.partsRaw.filter((p) => /Передняя стенка ящика/.test(p.name))[0];
      const pin = (wall.holes || []).filter((h) => h.kind === 'runnerPinFront')[0];
      if (pin) {
        const sheet = chunk.slice(wallIdx, wallIdx + 20000);
        if ((sheet.match(/dw-hole/g) || []).length < (wall.holes || []).length - 2) {
          problems.push('чертёж передней стенки: отверстий меньше, чем в детали');
        }
      }
    }
  }
  cases += 1;
}

// --- у каждого числа есть источник ------------------------------------------
// Правило проекта: размер в каталоге либо взят из документа производителя
// (поле src), либо честно помечен как неподтверждённый (assumed). Выдуманных
// чисел быть не должно — именно на них ловятся ошибки чтения чертежей.
{
  const { DRAWER_SYSTEMS, DRAWER_SYSTEM_ORDER } = window.Modul3D.catalog;
  const { buildDrawerPassport } = window.Modul3D.specification;
  for (const id of DRAWER_SYSTEM_ORDER) {
    const sys = DRAWER_SYSTEMS[id];
    if (!sys.src) problems.push(`система «${id}»: не указан источник размеров`);
    if (!Array.isArray(sys.assumed)) {
      problems.push(`система «${id}»: не заполнен список неподтверждённых размеров`);
    }
    const pass = buildDrawerPassport(id);
    if (!pass) { problems.push(`система «${id}»: паспорт не строится`); continue; }
    if (!pass.rows.length) problems.push(`система «${id}»: паспорт пуст`);
    // в паспорте обязан быть источник и ряд NL
    const names = pass.rows.map((r) => r.name);
    for (const need of ['Источник размеров', 'Ряд NL, мм']) {
      if (names.indexOf(need) === -1) problems.push(`паспорт «${id}»: нет строки «${need}»`);
    }
    const srcRow = pass.rows.filter((r) => r.name === 'Источник размеров')[0];
    if (srcRow && /НЕ УКАЗАН/.test(String(srcRow.value))) {
      problems.push(`паспорт «${id}»: источник не заполнен`);
    }
    cases += 1;
  }
}

// --- зазор 20 мм не зависит от толщин ---------------------------------------
// Размер 20 мм идёт от боковины КОРПУСА до ВНУТРЕННЕЙ грани боковины ящика.
// Толще плита корпуса или боковина ящика — короб меняет ширину, а 20 стоит.
{
  for (const [tc, td, grow] of [[16, 16, 0], [18, 16, 0], [18, 18, 4], [16, 18, 4]]) {
    const model = buildModel(Object.assign({}, base, {
      bodyThickness: tc, drawerThickness: td,
      modules: [{
        name: 'Т', width: 600, height: 820, depth: 560, topType: 'rails',
        leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
        sections: [{ shelves: 0, drawers: 1, facade: 'drawers', handle: 'bow160',
          drawerSystem: 'quadroSlide', drawerBoxHeight: '150' }],
      }],
    }));
    const sides = model.partsRaw.filter((p) => p.kind === 'side')
      .sort((a, b) => a.boxes[0].x - b.boxes[0].x);
    const ds = model.partsRaw.filter((p) => p.kind === 'drawerSide')
      .sort((a, b) => a.boxes[0].x - b.boxes[0].x);
    if (sides.length < 2 || ds.length < 2) { problems.push('зазор 20: детали не построены'); continue; }
    const LB2 = (sides[1].boxes[0].x - sides[1].boxes[0].w / 2)
      - (sides[0].boxes[0].x + sides[0].boxes[0].w / 2);
    const innerBox = (ds[ds.length - 1].boxes[0].x - ds[ds.length - 1].boxes[0].w / 2)
      - (ds[0].boxes[0].x + ds[0].boxes[0].w / 2);
    const outerBox = (ds[ds.length - 1].boxes[0].x + ds[ds.length - 1].boxes[0].w / 2)
      - (ds[0].boxes[0].x - ds[0].boxes[0].w / 2);
    const clr20 = (LB2 - innerBox) / 2;
    if (Math.abs(clr20 - 20) > 0.6) {
      problems.push(`корпус ${tc}/ящик ${td}: до внутренней грани ${clr20} мм вместо 20`);
    }
    // при боковине 18 короб шире ровно на 4 мм
    if (Math.abs((outerBox - innerBox) - 2 * td) > 0.6) {
      problems.push(`корпус ${tc}/ящик ${td}: наружная ширина короба не сходится с толщиной боковин`);
    }
    void grow;
    cases += 1;
  }
}

// --- рамки одного раздела одного формата ------------------------------------
{
  const mods = ['М1', 'М2', 'М3'].map((n, i) => ({
    name: n, width: 600 + i * 200, height: 820, depth: 560, topType: 'rails',
    leftSide: 'onBottom', rightSide: 'onBottom', base: { type: 'legsPlinth', legHeight: 100 },
    sections: [{ shelves: 1, drawers: i === 1 ? 3 : 0, facade: i === 1 ? 'drawers' : 'doorLeft',
      handle: 'bow160', drawerSystem: 'tandembox' }],
  }));
  const model = buildModel(Object.assign({}, base, { modules: mods }));
  const html = String(buildDrawings(model, true));
  for (const sec of ['Чертежи модулей', 'Фасады']) {
    const i0 = html.indexOf(sec);
    if (i0 === -1) continue;
    const i1 = html.indexOf('<h4 class="dw-h">', i0 + 5);
    const chunk = html.slice(i0, i1 === -1 ? undefined : i1);
    const sizes = (chunk.match(/<svg width="([\d.]+)" height="([\d.]+)"/g) || []);
    const uniq = sizes.filter((v, i, a) => a.indexOf(v) === i);
    if (uniq.length > 1) problems.push(`чертежи: в разделе «${sec}» рамки разного формата (${uniq.length})`);
  }
  cases += 1;
}

// --- присадка под опоры: пилотные отверстия в дне напротив площадки --------
{
  const model = buildModel(Object.assign({}, base, {
    modules: [{ name: 'М', width: 600, height: 820, depth: 560, base: { type: 'legs', legHeight: 100 },
      sections: [{ shelves: 1, drawers: 0, facade: 'doorLeft' }] }],
  }));
  inspect(model, 'опоры: присадка в дне');
  const legs = model.partsRaw.filter((p) => p.kind === 'leg');
  const bottom = model.partsRaw.find((p) => p.kind === 'bottom');
  if (legs.length !== 4) problems.push(`опоры: ожидалось 4 опоры, найдено ${legs.length}`);
  if (!bottom) problems.push('опоры: нет дна');
  else {
    const legFix = bottom.holes.filter((h) => h.kind === 'legFix');
    if (legFix.length !== legs.length * 4) {
      problems.push(`опоры: в дне ${legFix.length} отверстий вместо ${legs.length * 4} (по 4 на опору)`);
    }
    for (const h of legFix) {
      if (h.d !== 2 || h.depth !== 12) problems.push(`опоры: пилотное отверстие Ø${h.d}×${h.depth} вместо Ø2×12`);
      if (h.through) problems.push('опоры: пилотное отверстие сделано насквозь');
      if (h.side !== 'back') problems.push('опоры: пилотное отверстие не с нижней пласти дна');
      if (h.x < -0.5 || h.x > bottom.length + 0.5 || h.y < -0.5 || h.y > bottom.width + 0.5) {
        problems.push(`опоры: отверстие (${h.x}, ${h.y}) вне дна ${bottom.length}×${bottom.width}`);
      }
    }
    // каждой опоре — ровно 4 отверстия строго по 52×52 вокруг её оси
    for (const leg of legs) {
      const lx = leg.boxes[0].x - (bottom.boxes[0].x - bottom.length / 2);
      const lz = leg.boxes[0].z + bottom.boxes[0].d / 2;
      const near = legFix.filter((h) => Math.abs(h.x - lx) <= 26.5 && Math.abs(h.y - lz) <= 26.5);
      if (near.length !== 4) problems.push(`опоры: у опоры (${Math.round(lx)}, ${Math.round(lz)}) отверстий ${near.length} вместо 4`);
    }
  }
  cases += 1;
}

// --- пустой проект: программа стартует без модулей -------------------------
{
  const empty = buildModel(Object.assign({}, base, { modules: [] }));
  if (empty.parts.length) problems.push('пустой проект: откуда-то взялись детали');
  if (!empty.dims || empty.dims.W !== 0) problems.push('пустой проект: габарит не нулевой');
  const sp = buildSpecification(empty);
  if (Number(sp.totalCost) !== 0) problems.push('пустой проект: смета не нулевая');
  const html = String(buildDrawings(empty));
  if (/NaN|Infinity/.test(html)) problems.push('пустой проект: NaN в чертежах');
  if (html.indexOf('Проект пуст') === -1) problems.push('пустой проект: нет подсказки на чертежах');
  cases += 1;
}

const unique = problems.filter((v, i) => problems.indexOf(v) === i);
if (unique.length) {
  console.log('ГЕОМЕТРИЯ: ПРОВАЛ (' + problems.length + ' на ' + cases + ' конфигураций)');
  unique.slice(0, 20).forEach((p) => console.log('  x ' + p));
  process.exit(1);
}
console.log('ГЕОМЕТРИЯ: ' + cases + ' конфигураций — пересечений нет, смета сходится, нумерация сплошная');
