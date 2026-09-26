// Точечная (не побайтовая) замена коллекций каталога/структуры дерева
// «Библиотеки» прямо в исходном тексте src/catalog.js и src/app.js — для
// кнопки «Опубликовать как базу по умолчанию» (routes/catalogPublish.js,
// ТЗ-МОНЕТИЗАЦИЯ.md, раздел 6).
//
// Почему через AST (acorn), а не регулярками/бракет-каунтером: оба файла
// большие (~200KB и ~90KB), значения содержат кавычки, шаблонные строки и
// комментарии — самодельный парсер скобок уже один раз портил файлы в этом
// проекте (см. git-историю про "восстановлены с GitHub", 2026-08-27), и мы
// не хотим повторить это в файле, который сразу же пушится в master.
//
// Стратегия: распарсить файл acorn'ом, найти нужные узлы ТОЛЬКО по имени
// идентификатора/свойства (не по номеру строки — он сдвигается), заменить
// строго диапазон [start, end] узла-значения на JSON.stringify(value, null, 2)
// и больше НИЧЕГО в файле не трогать. После сборки — обязательно перепарсить
// результат тем же acorn: если он не парсится, вся операция проваливается и
// НИЧЕГО не возвращается наружу (см. throw ниже) — единственная защита от
// того, чтобы не запушить в master синтаксически битый файл.
//
// Оба файла (src/catalog.js, src/app.js) — классические скрипты без
// import/export, всё их содержимое обёрнуто в один самовызывающийся верхне-
// уровневый `(function () { ... })();` (см. CLAUDE.md). Нужные декларации —
// прямые statements внутри этой функции, не вложены глубже.

const acorn = require('acorn');

class CatalogPublishCodegenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CatalogPublishCodegenError';
  }
}

// Соответствие ключей blob (см. snapshotCatalogCollections() в src/app.js) —
// именам констант верхнего уровня в src/catalog.js.
const CATALOG_KEY_TO_CONST = {
  decors: 'DECORS',
  back: 'BACK_MATERIALS',
  facade: 'FACADE_MATERIALS',
  edge: 'EDGE_PRICES',
  glass: 'GLASS',
  countertop: 'COUNTERTOP_MATERIALS',
  hardware: 'HARDWARE_PRICES',
  handles: 'HANDLES',
  lifts: 'LIFTS',
  fasteners: 'FASTENER_PRICES',
  // Алюминиевые рамочные фасады (v311) — см. ALU_EDITABLE_FIELDS ниже:
  // эти три константы заменяются НЕ целиком, а только по редактируемым полям.
  aluProfiles: 'ALU_PROFILES',
  aluFrameExtras: 'ALU_FRAME_EXTRAS',
  aluMakers: 'ALU_MAKERS',
};

// Для алюминиевых коллекций публикуем только поля, которые пользователь
// правит в Библиотеке, — ровно те же, что восстанавливает клиент
// (ALU_CATALOG_EDITABLE / restoreAluCatalogFrom в src/app.js). Остальное
// (сечение, fillStop/fillGap, петля, контакты производителя, ссылки на общую
// константу ALU_PRICE_NOTE) остаётся как в текущем catalog.js: снимок
// разработчика мог быть сохранён раньше, чем в catalog.js добавили данные
// паспорта профиля, и полная замена молча откатила бы их. Новые позиции
// (коды, которых нет в catalog.js) не добавляются — в UI их и нельзя завести.
const ALU_EDITABLE_FIELDS = {
  aluProfiles: ['price', 'priceUnit', 'barLength'],
  aluFrameExtras: ['price'],
  aluMakers: ['pricePerM2'],
};

// Свойства объекта `const state = { ... }` в src/app.js, отвечающие за
// структуру дерева категорий панели «Библиотека» — имя свойства в state
// совпадает с ключом в blob один в один, отдельной карты не нужно.
const APP_STATE_KEYS = [
  'libExtraNodes',
  'libNodeOrder',
  'libTopOrder',
  'libTopParent',
  'libHwCatLabels',
  'libHwCustomCats',
  'libModOverrides',
  'libModPlacements',
  // Свои категории верхнего уровня «Базы модулей» (кнопка-плитка «Добавить
  // категорию», см. state.libModCustomGroups) — без этого ключа сама
  // категория не публикуется как дефолт, хотя размещённые в ней карточки
  // (libModOverrides/libModPlacements выше, group: 'modcustom-…') уже
  // публикуются — у остальных пользователей они стали бы «осиротевшими»,
  // без своей категории в дереве (найдено ревью, 2026-09-21).
  'libModCustomGroups',
];

function parseSource(source, label) {
  try {
    return acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  } catch (err) {
    throw new CatalogPublishCodegenError(`${label}: не удалось разобрать исходный код (${err.message}).`);
  }
}

// Находит тело верхнеуровневой самовызывающейся функции `(function () {
// ... })();` — единственный ExpressionStatement верхнего уровня, чей
// callee — FunctionExpression. Возвращает массив её прямых statements.
function findIifeBody(ast, label) {
  for (const stmt of ast.body) {
    if (
      stmt.type === 'ExpressionStatement' &&
      stmt.expression &&
      stmt.expression.type === 'CallExpression' &&
      stmt.expression.callee &&
      stmt.expression.callee.type === 'FunctionExpression'
    ) {
      return stmt.expression.callee.body.body;
    }
  }
  throw new CatalogPublishCodegenError(
    `${label}: не найдена верхнеуровневая самовызывающаяся функция (function () { ... })() — структура файла изменилась.`
  );
}

// Ищет среди statements верхнего уровня декларации `const <name> = <init>`
// для каждого имени из needNames. Возвращает Map(имя -> init-узел). Если
// хотя бы одно имя не найдено (или найдено без инициализатора) — бросает
// ошибку со ВСЕМИ отсутствующими именами сразу (удобнее чинить за один раз).
function findTopLevelConstInits(statements, needNames, label) {
  const found = new Map();
  for (const stmt of statements) {
    if (stmt.type !== 'VariableDeclaration') continue;
    for (const decl of stmt.declarations) {
      if (
        decl.id &&
        decl.id.type === 'Identifier' &&
        needNames.includes(decl.id.name) &&
        decl.init
      ) {
        found.set(decl.id.name, decl.init);
      }
    }
  }

  const missing = needNames.filter((name) => !found.has(name));
  if (missing.length > 0) {
    throw new CatalogPublishCodegenError(
      `${label}: не найдены ожидаемые объявления верхнего уровня: ${missing.join(', ')} — структура файла изменилась.`
    );
  }

  return found;
}

// Применяет набор непересекающихся текстовых замен [{ start, end, text }] к
// строке source, возвращает новую строку. Замены могут приходить в любом
// порядке — сортируем по start сами.
function applyEdits(source, edits) {
  const sorted = edits.slice().sort((a, b) => a.start - b.start);
  let result = '';
  let cursor = 0;
  for (const edit of sorted) {
    result += source.slice(cursor, edit.start);
    result += edit.text;
    cursor = edit.end;
  }
  result += source.slice(cursor);
  return result;
}

// Проверяет, что итоговый текст — валидный JS (та же грамматика, тем же
// acorn). Бросает ошибку, если нет — вызывающий код обязан ничего не
// коммитить в этом случае.
function assertValidJs(source, label) {
  try {
    acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  } catch (err) {
    throw new CatalogPublishCodegenError(
      `${label}: сгенерированный код не прошёл проверку синтаксиса (${err.message}) — публикация отменена.`
    );
  }
}

/**
 * Собирает новый текст src/catalog.js, подставив в него коллекции из
 * blob (см. snapshotCatalogCollections() в src/app.js). Ключи, которых нет
 * в blob (старый снимок, сохранённый до появления какой-то коллекции),
 * просто пропускаются — соответствующая константа в файле не трогается.
 *
 * @param {string} originalSource — текущее содержимое src/catalog.js.
 * @param {object} blob — data из catalog_overrides пользователя.
 * @returns {{ newSource: string, changedKeys: string[] }}
 * @throws {CatalogPublishCodegenError}
 */
// Имя ключа свойства объектного литерала: `foo:` или `'foo':` (без computed).
function propKeyName(prop) {
  if (prop.type !== 'Property' || prop.computed || !prop.key) return null;
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'Literal' && typeof prop.key.value === 'string') return prop.key.value;
  return null;
}

// Точечные правки для алюминиевой коллекции: { code: { field: value } } из
// blob -> замены значений соответствующих свойств внутри `const X = { code:
// { ... } }`. Отсутствующее во вложенном объекте поле дописывается в конец.
function aluFieldEdits(node, saved, fields, constName, label) {
  if (node.type !== 'ObjectExpression') {
    throw new CatalogPublishCodegenError(`${label}: '${constName}' — не объектный литерал, точечная замена невозможна.`);
  }
  const edits = [];
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return edits;
  node.properties.forEach((prop) => {
    const code = propKeyName(prop);
    if (code === null || !Object.prototype.hasOwnProperty.call(saved, code)) return;
    const item = saved[code];
    const inner = prop.value;
    if (!item || typeof item !== 'object' || !inner || inner.type !== 'ObjectExpression') return;
    const innerProps = new Map();
    inner.properties.forEach((p) => { const n = propKeyName(p); if (n !== null) innerProps.set(n, p); });
    const appended = [];
    fields.forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(item, field) || item[field] === undefined) return;
      // Как keepFresh в app.js (restoreAluCatalogFrom): null в старом снимке
      // правок у единицы цены/длины хлыста не затирает паспортные данные.
      if (item[field] === null && (field === 'priceUnit' || field === 'barLength')) return;
      const text = JSON.stringify(item[field]);
      const p = innerProps.get(field);
      if (p) {
        if (p.shorthand) {
          edits.push({ start: p.start, end: p.end, text: `${field}: ${text}` });
        } else {
          edits.push({ start: p.value.start, end: p.value.end, text });
        }
      } else {
        appended.push(`${field}: ${text}`);
      }
    });
    if (appended.length) {
      const last = inner.properties[inner.properties.length - 1];
      edits.push(last
        ? { start: last.end, end: last.end, text: ', ' + appended.join(', ') }
        : { start: inner.start + 1, end: inner.start + 1, text: ' ' + appended.join(', ') + ' ' });
    }
  });
  return edits;
}

function buildCatalogSource(originalSource, blob) {
  const label = 'src/catalog.js';
  const ast = parseSource(originalSource, label);
  const body = findIifeBody(ast, label);
  // Ищем только константы тех ключей, что есть в blob: старый снимок без
  // алюминиевых ключей не должен падать на catalog.js, где их ещё нет, и
  // наоборот. Отсутствие нужной константы — по-прежнему ошибка (422).
  const presentKeys = Object.keys(CATALOG_KEY_TO_CONST).filter((key) =>
    Object.prototype.hasOwnProperty.call(blob, key) && blob[key] !== undefined);
  const inits = findTopLevelConstInits(body, presentKeys.map((k) => CATALOG_KEY_TO_CONST[k]), label);

  const edits = [];
  const changedKeys = [];
  presentKeys.forEach((key) => {
    const constName = CATALOG_KEY_TO_CONST[key];
    const node = inits.get(constName);
    if (ALU_EDITABLE_FIELDS[key]) {
      edits.push(...aluFieldEdits(node, blob[key], ALU_EDITABLE_FIELDS[key], constName, label));
    } else {
      edits.push({ start: node.start, end: node.end, text: JSON.stringify(blob[key], null, 2) });
    }
    changedKeys.push(key);
  });

  const newSource = edits.length > 0 ? applyEdits(originalSource, edits) : originalSource;
  if (edits.length > 0) assertValidJs(newSource, label);

  return { newSource, changedKeys };
}

/**
 * Собирает новый текст src/app.js, подставив в 8 полей объекта
 * `const state = { ... }` соответствующие ключи из blob. Ключи, которых нет
 * в blob, пропускаются — поле в файле не трогается.
 *
 * @param {string} originalSource — текущее содержимое src/app.js.
 * @param {object} blob — data из catalog_overrides пользователя.
 * @returns {{ newSource: string, changedKeys: string[] }}
 * @throws {CatalogPublishCodegenError}
 */
function buildAppSource(originalSource, blob) {
  const label = 'src/app.js';
  const ast = parseSource(originalSource, label);
  const body = findIifeBody(ast, label);

  const stateInits = findTopLevelConstInits(body, ['state'], label);
  const stateNode = stateInits.get('state');
  if (stateNode.type !== 'ObjectExpression') {
    throw new CatalogPublishCodegenError(`${label}: объявление 'const state = ...' найдено, но это не объектный литерал.`);
  }

  const propNodes = new Map();
  stateNode.properties.forEach((prop) => {
    if (
      prop.type === 'Property' &&
      !prop.computed &&
      prop.key &&
      prop.key.type === 'Identifier' &&
      APP_STATE_KEYS.includes(prop.key.name)
    ) {
      propNodes.set(prop.key.name, prop.value);
    }
  });

  const missing = APP_STATE_KEYS.filter((name) => !propNodes.has(name));
  if (missing.length > 0) {
    throw new CatalogPublishCodegenError(
      `${label}: в объекте 'state' не найдены ожидаемые свойства: ${missing.join(', ')} — структура файла изменилась.`
    );
  }

  const edits = [];
  const changedKeys = [];
  APP_STATE_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(blob, key) || blob[key] === undefined) return;
    const node = propNodes.get(key);
    edits.push({ start: node.start, end: node.end, text: JSON.stringify(blob[key], null, 2) });
    changedKeys.push(key);
  });

  const newSource = edits.length > 0 ? applyEdits(originalSource, edits) : originalSource;
  if (edits.length > 0) assertValidJs(newSource, label);

  return { newSource, changedKeys };
}

module.exports = {
  CatalogPublishCodegenError,
  CATALOG_KEY_TO_CONST,
  ALU_EDITABLE_FIELDS,
  APP_STATE_KEYS,
  buildCatalogSource,
  buildAppSource,
};
