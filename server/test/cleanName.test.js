// Запуск: node server/test/cleanName.test.js (npm run test:cleanname в server/)
const { cleanSheetName } = require('../src/services/catalogLinkParsers/cleanName');

const cases = [
  ['F206 ST9 Пьетра Гриджиа черный 2800x2070x18 (EG)  Дсп ламинированный', 'ЛДСП F206 ST9 Пьетра Гриджиа черный (18) (EG)', 18],
  ['H1180 ST37 Дуб Галифакс натуральный 2800x2070x18.6 (EG) Дсп ламинированный', 'ЛДСП H1180 ST37 Дуб Галифакс натуральный (18.6) (EG)', 18.6],
  ['U702 ST9  Кашемир серый 2800x2070x18 (EG) Дсп ламинированный', 'ЛДСП U702 ST9 Кашемир серый (18) (EG)', 18],
  ['Дсп ламинированный 0110 SM Белый (16) 2800x2070 (KU)', 'ЛДСП 0110 SM Белый (16) (KU)', 16],
  ['Дсп ламинированны 8681 SM Белый бриллиант (16) 2800x2070 (KU)', 'ЛДСП 8681 SM Белый бриллиант (16) (KU)', 16],
  ['МДФ U399 PM/ST9 Гранатовый красный (19) 2800x2070 (EG) PerfectSense', 'МДФ U399 PM/ST9 Гранатовый красный (19) (EG) PerfectSense', 19],
  ['МДФ Шпон Дуб Натур (19) 2800X2070 (MK) АВСТРИЯ', 'МДФ Шпон Дуб Натур (19) (MK) АВСТРИЯ', 19],
  ['ДВП 110 Белый (3) 2850x2070', 'ДВП 110 Белый (3)', 3],
  ['Кухонная столешница K552 SU Белый Айсберг Мраморный (38) 4100x600 (KU)', 'Столешница K552 SU Белый Айсберг Мраморный (38) (KU)', 38],
  ['Столешница HPL Компакт F206 ST9 Пьетра Гриджиа Черный (12) 4100x650 (EG)', 'Столешница HPL Компакт F206 ST9 Пьетра Гриджиа Черный (12) (EG)', 12],
  ['Столешница HPL Компакт F221 ST87 Тессина керамический кремовый (12) 4100x650', 'Столешница HPL Компакт F221 ST87 Тессина керамический кремовый (12)', 12],
  // не меняются
  ['АБС кромка W1000 ST9 23x2.0 UW', 'АБС кромка W1000 ST9 23x2.0 UW', null],
  ['NM-BD-739-05 Picior BD-739, H-100, aluminiu', 'NM-BD-739-05 Picior BD-739, H-100, aluminiu', null],
  ['UA-B31112806MJ Ручка UA-B311, 128mm, шлифованная сталь', 'UA-B31112806MJ Ручка UA-B311, 128mm, шлифованная сталь', null],
  ['Legrabox 500mm C (Белый,Графит)', 'Legrabox 500mm C (Белый,Графит)', null],
  ['TANDEMBOX 500M, Белый, 30 кг', 'TANDEMBOX 500M, Белый, 30 кг', null],
  ['Петля для ДСП 110x45 Blum', 'Петля для ДСП 110x45 Blum', null],
  ['Шкант 8x30 для ДСП', 'Шкант 8x30 для ДСП', null],
];

let fail = 0;
for (const [input, want, wantT] of cases) {
  const r = cleanSheetName(input);
  const r2 = cleanSheetName(r.name);
  const ok = r.name === want && r.thickness === wantT && r2.name === want;
  if (!ok) {
    fail++;
    console.log(`FAIL: ${input}\n  got:  ${r.name} / ${r.thickness}\n  want: ${want} / ${wantT}\n  again: ${r2.name}`);
  } else console.log(`ok   ${want}`);
}
console.log(fail ? `\n${fail} FAILED` : `\nall ${cases.length} passed`);
process.exit(fail ? 1 : 0);
