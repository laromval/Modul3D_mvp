// presets.js
// ============================================================================
// БАЗА ГОТОВЫХ МОДУЛЕЙ.
//
// Каждый вариант — обычный модуль проекта: те же поля, что задаются вручную в
// панели. Никакой отдельной «мёртвой» геометрии здесь нет — выбранный вариант
// просто подставляет параметры, а корпус, деталировка и спецификация
// пересчитываются тем же ядром.
//
// Размеры и наполнение взяты по практике корпусного производства:
//   • высота шкафов 2100 / 2200 / 2400 мм;
//   • глубина 450 мм для прихожей (штанга вдоль корпуса или выдвижная),
//     600 мм для спальни и гардероба (плечики поперёк);
//   • штанга для длинных вещей на 1500–1900 мм от дна, для блузок 1000–1200;
//   • полки с шагом 300–350 мм; антресоль отдельным ярусом от 2000 мм;
//   • фасады ящиков 150–250 мм.
//
// Классический скрипт (без import/export) — публикует себя в window.Basis.
// ============================================================================
(function () {

// Секция «как в панели». Значения по умолчанию совпадают с newSection() в app.js,
// чтобы пресет нельзя было собрать из полей, которых в интерфейсе нет.
function sec(o) {
  return Object.assign({
    shelves: 0, drawers: 0, facade: 'doors2',
    shelfMode: 'auto', shelfHeights: [],
    drawerMode: 'auto', drawerHeights: [], drawerPinned: [],
    pushToOpen: false, drawerOffset: 10,
    widthMode: 'auto', width: 400,
    // Ручки ставим сразу: скоба 128 — самый ходовой размер, на кухне 160.
    handle: 'bow128', handleCC: 160, handleOrient: 'vertical',
    lift: 'aventosHK',
    rod: false, rodHeight: 1900,
  }, o);
}

function mod(o) {
  return Object.assign({
    name: 'Модуль', width: 800, height: 2100, depth: 560,
    rotation: 0, corner: false,
    family: 'custom',
    leftSide: 'floor', rightSide: 'floor',
    baseType: 'plinth', plinthHeight: 100, legHeight: 100,
    topType: 'panel', railWidth: 100,
    sections: [sec({})],
  }, o);
}

const PRESETS = [
  {
    id: 'wardrobe',
    name: 'Шкаф',
    items: [
      {
        id: 'hallway',
        name: 'Шкаф в прихожую',
        note: '800×2100×450 · штанга + антресоль, узкая секция под полки',
        make: () => mod({
          name: 'Шкаф в прихожую', width: 800, height: 2100, depth: 450,
          plinthHeight: 100,
          sections: [
            // Основная секция: штанга под верхнюю одежду, антресоль сверху
            sec({ facade: 'doorLeft', shelves: 1, shelfMode: 'manual', shelfHeights: [1700], rod: true, rodHeight: 1600 }),
            // Узкая секция под шапки, обувь и мелочи
            sec({ facade: 'doorRight', shelves: 5, widthMode: 'fixed', width: 300 }),
          ],
        }),
      },
      {
        id: 'bedroom',
        name: 'Шкаф в спальню',
        note: '1200×2200×600 · штанга 1900, ящики 200 и полки с шагом 350',
        make: () => mod({
          name: 'Шкаф в спальню', width: 1200, height: 2200, depth: 600,
          plinthHeight: 100,
          sections: [
            sec({ facade: 'doorLeft', rod: true, rodHeight: 1900, shelves: 1, shelfMode: 'manual', shelfHeights: [2000] }),
            sec({ facade: 'doorRight', shelves: 4, drawers: 2, drawerOffset: 10 }),
          ],
        }),
      },
      {
        id: 'dressing',
        name: 'Гардероб',
        note: '1800×2400×600 · две штанги в два яруса, ящики и антресоли',
        make: () => mod({
          name: 'Гардероб', width: 1800, height: 2400, depth: 600,
          plinthHeight: 100,
          sections: [
            // Длинные вещи: одна высокая штанга + антресоль
            sec({ facade: 'doorLeft', rod: true, rodHeight: 1900, shelves: 1, shelfMode: 'manual', shelfHeights: [2050] }),
            // Короткие вещи: штанга ниже, под ней ящики
            sec({ facade: 'doorRight', rod: true, rodHeight: 1200, drawers: 3, shelves: 1, shelfMode: 'manual', shelfHeights: [2050] }),
            // Полки
            sec({ facade: 'doors2', shelves: 6 }),
          ],
        }),
      },
      {
        id: 'openRack',
        name: 'Стеллаж открытый',
        note: '800×2100×350 · без фасадов, 5 полок',
        make: () => mod({
          name: 'Стеллаж', width: 800, height: 2100, depth: 350,
          plinthHeight: 60,
          sections: [sec({ facade: 'open', shelves: 5 })],
        }),
      },
    ],
  },
  {
    id: 'base',
    name: 'Тумба',
    items: [
      {
        id: 'drawers',
        name: 'Тумба с ящиками',
        note: '600×850×560 · четыре ящика, опоры с цоколем',
        make: () => mod({
          name: 'Тумба с ящиками', width: 600, height: 850, depth: 560,
          baseType: 'legsPlinth', legHeight: 100,
          leftSide: 'besideBottom', rightSide: 'besideBottom',
          sections: [sec({ facade: 'open', drawers: 4 })],
        }),
      },
      {
        id: 'doorDrawer',
        name: 'Тумба дверь + ящик',
        note: '600×850×560 · ящик снизу, полка за дверью',
        make: () => mod({
          name: 'Тумба', width: 600, height: 850, depth: 560,
          baseType: 'legsPlinth', legHeight: 100,
          leftSide: 'besideBottom', rightSide: 'besideBottom',
          sections: [sec({ facade: 'doorLeft', drawers: 1, shelves: 1 })],
        }),
      },
      {
        id: 'bedside',
        name: 'Тумба прикроватная',
        note: '450×550×400 · два ящика на опорах',
        make: () => mod({
          name: 'Тумба прикроватная', width: 450, height: 550, depth: 400,
          baseType: 'legs', legHeight: 80,
          sections: [sec({ facade: 'open', drawers: 2 })],
        }),
      },
    ],
  },
  {
    id: 'kitchen',
    name: 'Кухонный модуль',
    // Стандарт кухни: корпус нижнего яруса 720 мм + цоколь 100 → 820 мм,
    // сверху столешница 38 мм — рабочая поверхность выходит на 858 мм.
    // Глубина корпуса 560 под столешницу 600. Верхний ярус глубиной 300 мм,
    // высотой 720 мм, вешается через фартук 550–600 мм над столешницей.
    items: [
      {
        id: 'lower600',
        name: 'Нижний 600 с полкой',
        note: '600×820×510 · корпус 720, опоры 100 с цоколем, дверь и полка',
        make: () => mod({
          family: 'kitchen',
          name: 'Нижний 600', width: 600, height: 820, depth: 510,
          baseType: 'legsPlinth', legHeight: 100,
          leftSide: 'onBottom', rightSide: 'onBottom', topType: 'rails',
          sections: [sec({ handle: 'bow160', facade: 'doorLeft', shelves: 1 })],
        }),
      },
      {
        id: 'lower600drawers',
        name: 'Нижний 600 с ящиками',
        note: '600×820×510 · три ящика, опоры с цоколем',
        make: () => mod({
          family: 'kitchen',
          name: 'Нижний 600 ящики', width: 600, height: 820, depth: 510,
          baseType: 'legsPlinth', legHeight: 100,
          leftSide: 'onBottom', rightSide: 'onBottom', topType: 'rails',
          sections: [sec({ handle: 'bow160', facade: 'open', drawers: 3 })],
        }),
      },
      {
        id: 'sink800',
        name: 'Нижний 800 под мойку',
        note: '800×820×510 · две двери, без полок, опоры с цоколем',
        make: () => mod({
          family: 'kitchen',
          name: 'Мойка 800', width: 800, height: 820, depth: 510,
          baseType: 'legsPlinth', legHeight: 100,
          leftSide: 'onBottom', rightSide: 'onBottom', topType: 'rails',
          sections: [sec({ handle: 'bow160', facade: 'doors2', shelves: 0 })],
        }),
      },
      {
        id: 'cornerLower',
        name: 'Нижний угловой (поворот ряда)',
        note: '1000×820×510 · фасад 400, опоры с цоколем, дальше ряд под 90°',
        // Стандартный угловой стык: корпус 1000 по стене, свободный фронт
        // 1000 − 560 = 440 мм под фасад 400, остальное закрывает боковина
        // первого модуля перпендикулярного ряда. Полку не ставим: пролёт
        // 966 мм из ЛДСП 16 мм прогибается, внутрь ставят карусель.
        make: () => mod({
          family: 'kitchen',
          name: 'Угловой нижний', width: 1000, height: 820, depth: 510,
          baseType: 'legsPlinth', legHeight: 100,
          leftSide: 'onBottom', rightSide: 'onBottom', topType: 'rails', corner: true,
          sections: [sec({ handle: 'bow160', facade: 'doorLeft', facadeWidth: 400, shelves: 0 })],
        }),
      },
      {
        id: 'cornerSink',
        name: 'Нижний угловой под мойку',
        note: '984×820×510 · заглушка по глубине соседа, фасад по остатку, планки НА РЕБРО, без задней стенки — '
          + 'сверху встаёт мойка, сзади проходят коммуникации',
        make: () => mod({
          family: 'kitchen',
          name: 'Угловой мойка', width: 984, height: 820, depth: 510,
          baseType: 'legsPlinth', legHeight: 100,
          leftSide: 'onBottom', rightSide: 'onBottom',
          // Планки на ребро: плашмя они съедают 100 мм проёма и чаша мойки
          // в корпус не заходит. Задней стенки нет — там сифон и подводка.
          topType: 'railsEdge', noBack: true, corner: true,
          // Заглушка 720×560 из корпусного ЛДСП + фальш-планка 717×78 из фасада
          blindPanel: true, blindStrip: 78,
          sections: [sec({ handle: 'bow160', facade: 'doorLeft', facadeWidth: 400, shelves: 0 })],
        }),
      },
      {
        id: 'upper600',
        name: 'Верхний 600',
        note: '600×720×300 · дверь и полка, без цоколя',
        make: () => mod({
          family: 'kitchen',
          name: 'Верхний 600', width: 600, height: 720, depth: 300, plinthHeight: 0,
          sections: [sec({ handle: 'bow160', facade: 'doorLeft', shelves: 1 })],
        }),
      },
      {
        id: 'upper800',
        name: 'Верхний 800 (сушка)',
        note: '800×720×300 · две двери, полка под сушку над мойкой',
        make: () => mod({
          family: 'kitchen',
          name: 'Верхний 800', width: 800, height: 720, depth: 300, plinthHeight: 0,
          sections: [sec({ handle: 'bow160', facade: 'doors2', shelves: 1 })],
        }),
      },
      {
        id: 'cornerUpper',
        name: 'Верхний угловой (поворот ряда)',
        note: '600×720×300 · фасад 300, дальше ряд идёт под 90°',
        make: () => mod({
          family: 'kitchen',
          name: 'Угловой верхний', width: 600, height: 720, depth: 300,
          plinthHeight: 0, corner: true,
          sections: [sec({ handle: 'bow160', facade: 'doorLeft', facadeWidth: 300, shelves: 1 })],
        }),
      },
      {
        id: 'tall600',
        name: 'Пенал 600',
        note: '600×2140×560 · во всю высоту гарнитура, четыре полки',
        make: () => mod({
          family: 'kitchen',
          name: 'Пенал 600', width: 600, height: 2140, depth: 560,
          baseType: 'legsPlinth', legHeight: 100,
          leftSide: 'onBottom', rightSide: 'onBottom',
          sections: [sec({ handle: 'bow160', facade: 'doorLeft', shelves: 4 })],
        }),
      },
    ],
  },
];

window.Basis = window.Basis || {};
window.Basis.presets = { PRESETS };
})();
