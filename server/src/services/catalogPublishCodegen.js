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
 * Собирает новый текст src/catalog.js, подставив в него 10 коллекций из
 * blob (см. snapshotCatalogCollections() в src/app.js). Ключи, которых нет
 * в blob (старый снимок, сохранённый до появления какой-то коллекции),
 * просто пропускаются — соответствующая константа в файле не трогается.
 *
 * @param {string} originalSource — текущее содержимое src/catalog.js.
 * @param {object} blob — data из catalog_overrides пользователя.
 * @returns {{ newSource: string, changedKeys: string[] }}
 * @throws {CatalogPublishCodegenError}
 */
function buildCatalogSource(originalSource, blob) {
  const label = 'src/catalog.js';
  const ast = parseSource(originalSource, label);
  const body = findIifeBody(ast, label);
  const constNames = Object.values(CATALOG_KEY_TO_CONST);
  const inits = findTopLevelConstInits(body, constNames, label);

  const edits = [];
  const changedKeys = [];
  Object.keys(CATALOG_KEY_TO_CONST).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(blob, key) || blob[key] === undefined) return;
    const constName = CATALOG_KEY_TO_CONST[key];
    const node = inits.get(constName);
    edits.push({ start: node.start, end: node.end, text: JSON.stringify(blob[key], null, 2) });
    changedKeys.push(key);
  });

  const newSource = edits.length > 0 ? applyEdits(originalSource, edits) : originalSource;
  if (edits.length > 0) assertValidJs(newSource, label);

  return { newSource, changedKeys };
}

/**
 * Собирает новый текст src/app.js, подставив в 6 полей объекта
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
  APP_STATE_KEYS,
  buildCatalogSource,
  buildAppSource,
};
