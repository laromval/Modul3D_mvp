// export.js
// ============================================================================
// Export Module (часть) — выгрузка Деталировки и Спецификации в Excel.
// Использует глобальный XLSX (SheetJS), подключаемый в index.html через CDN.
// Источник данных — те же model.parts / spec, что показаны в таблицах на
// экране: экспорт не дублирует ввод, а лишь сериализует единый расчёт.
//
// Классический скрипт (без import/export) — публикует себя в window.Modul3D.
// ============================================================================
(function () {
function download(wb, filename) {
  // eslint-disable-next-line no-undef
  XLSX.writeFile(wb, filename);
}

function currencySymbol() {
  try {
    return (window.Modul3D && window.Modul3D.currency && window.Modul3D.currency.getSymbol())
      ? window.Modul3D.currency.getSymbol()
      : '₽';
  } catch (e) {
    return '₽';
  }
}

function exportDetailing(model, projectName) {
  const rows = model.parts.map((r) => ({
    '№ п/п': r.num,
    'Наименование детали': r.name,
    'Изделие/секция': r.section,
    'Материал': r.material,
    'Толщина, мм': r.thickness,
    'Длина, мм': r.length,
    'Ширина, мм': r.width,
    'Количество, шт': r.qty,
    'Кромка длинная сторона 1': r.edging.long1 || 'без кромки',
    'Кромка длинная сторона 2': r.edging.long2 || 'без кромки',
    'Кромка короткая сторона 1': r.edging.short1 || 'без кромки',
    'Кромка короткая сторона 2': r.edging.short2 || 'без кромки',
    'Направление текстуры': r.grainDirection ? 'да' : 'нет',
    'Примечание': r.note || '',
  }));
  // eslint-disable-next-line no-undef
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 6 }, { wch: 26 }, { wch: 16 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 10 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 16 },
  ];
  // eslint-disable-next-line no-undef
  const wb = XLSX.utils.book_new();
  // eslint-disable-next-line no-undef
  XLSX.utils.book_append_sheet(wb, ws, 'Деталировка');
  download(wb, `${projectName || 'proekt'}_detalirovka.xlsx`);
}

function exportSpecification(spec, projectName) {
  // eslint-disable-next-line no-undef
  const wb = XLSX.utils.book_new();
  const sym = currencySymbol();

  const sheetRows = spec.sheetMaterials.map((m, i) => ({
    '№': i + 1, 'Позиция': m.name, 'Артикул': m.code, 'Ед. изм.': 'лист',
    'Площадь, м²': m.area_m2, 'Кол-во листов': m.sheets, [`Цена, ${sym}`]: m.price, [`Сумма, ${sym}`]: m.sum,
  }));
  addSheet(wb, sheetRows, '1. Листовые материалы');

  const edgeRows = spec.edging.map((e, i) => ({
    '№': i + 1, 'Позиция': `Кромка ${e.type}`, 'Ед. изм.': 'пог.м',
    'Кол-во': e.length_m, [`Цена, ${sym}`]: e.price_per_m, [`Сумма, ${sym}`]: e.sum,
  }));
  addSheet(wb, edgeRows, '2. Кромка');

  const hwRows = spec.hardware.map((h, i) => ({
    '№': i + 1, 'Позиция': h.name, 'Артикул': h.article, 'Ед. изм.': h.unit,
    'Кол-во': h.qty, [`Цена, ${sym}`]: h.price, [`Сумма, ${sym}`]: h.sum,
  }));
  addSheet(wb, hwRows, '3. Фурнитура');

  const fRows = spec.fasteners.map((f, i) => ({
    '№': i + 1, 'Позиция': f.name, 'Артикул': f.article, 'Ед. изм.': f.unit,
    'Кол-во': f.qty, [`Цена, ${sym}`]: f.price, [`Сумма, ${sym}`]: f.sum,
  }));
  addSheet(wb, fRows, '4. Крепёж и метизы');

  const totalRows = [
    { 'Раздел': '1. Листовые материалы', [`Сумма, ${sym}`]: sumOf(spec.sheetMaterials) },
    { 'Раздел': '2. Кромка', [`Сумма, ${sym}`]: sumOf(spec.edging) },
    { 'Раздел': '3. Фурнитура', [`Сумма, ${sym}`]: sumOf(spec.hardware) },
    { 'Раздел': '4. Крепёж и метизы', [`Сумма, ${sym}`]: sumOf(spec.fasteners) },
    { 'Раздел': 'ИТОГО', [`Сумма, ${sym}`]: spec.totalCost },
  ];
  addSheet(wb, totalRows, '5. Итог');

  download(wb, `${projectName || 'proekt'}_specifikaciya.xlsx`);
}

function sumOf(arr) { return arr.reduce((s, r) => s + r.sum, 0); }

function addSheet(wb, rows, name) {
  // eslint-disable-next-line no-undef
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Нет позиций': '' }]);
  // eslint-disable-next-line no-undef
  XLSX.utils.book_append_sheet(wb, ws, name);
}

window.Modul3D = window.Modul3D || {};
window.Modul3D.exportModule = { exportDetailing, exportSpecification };
})();
