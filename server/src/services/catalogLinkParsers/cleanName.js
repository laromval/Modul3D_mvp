// Очистка названия ЛИСТОВОГО материала, пришедшего с сайта (ДСП/ЛДСП/МДФ/ДВП/
// столешница): убираем «ламинированный», габариты листа, слово «Кухонная»;
// тип материала — в начало; толщина — один раз цифрой в скобках «(18)».
// Фурнитура и кромка не затрагиваются вообще (см. isSheetName).
// Единая точка вызова — catalogLinkFetch.fetchAndParseProduct (через
// applyCleanName), поэтому работают и одиночный парс, и батч обновления цен.
// Модуль чистый: без сети, БД и зависимостей.

const DIMS_RE = /(\d{2,5}(?:[.,]\d+)?)\s*[x×х]\s*(\d{2,5}(?:[.,]\d+)?)(?:\s*[x×х]\s*(\d{1,3}(?:[.,]\d+)?))?/gi;
const THICK_PAREN_RE = /\((\d{1,2}(?:[.,]\d+)?)\)/g;
const LAM_RE = /ламинирован\p{L}*/giu;
const TYPE_TOKEN_RE = /^(?:л?дсп|мдф|двп|хдф)$/i;
// Лист — только если название НАЧИНАЕТСЯ с типа («Кухонная» перед ним
// допустима) или тип стоит как «Дсп ламинированный» (Egger: в конце). Тип
// посреди названия («Петля для ДСП 110x45») — это фурнитура, не трогаем.
const SHEET_START_RE = /^(?:кухонн\p{L}*\s+)?(?:л?дсп|мдф|двп|хдф|столешниц\p{L}*)(?=$|[\s,.)])/iu;
const SHEET_LAM_RE = /(?:^|\s)л?дсп\s+ламинирован\p{L}*/iu;

function isSheetName(name) {
  const s = String(name || '').trim();
  return (SHEET_START_RE.test(s) || SHEET_LAM_RE.test(s)) && !/кромк/i.test(s);
}

function num(s) { return Number(String(s).replace(',', '.')); }

/** @returns {{name: string, thickness: number|null}} */
function cleanSheetName(raw) {
  if (typeof raw !== 'string') return { name: raw, thickness: null };
  const src = raw.replace(/\s+/g, ' ').trim();
  if (!src || !isSheetName(src)) return { name: raw, thickness: null };

  let s = src;
  let thickness = null;

  // Толщина в скобках «(16)» — только 1–60 мм.
  s = s.replace(THICK_PAREN_RE, (all, n) => {
    const v = num(n);
    if (v >= 1 && v <= 60) { if (thickness == null) thickness = v; return ' '; }
    return all;
  });
  // Габариты; третье число — толщина, если в скобках её не было.
  s = s.replace(DIMS_RE, (all, w, h, t) => {
    if (t && thickness == null) {
      const v = num(t);
      if (v >= 1 && v <= 60) thickness = v;
    }
    return ' ';
  });

  const hadLam = LAM_RE.test(s);
  LAM_RE.lastIndex = 0;
  s = s.replace(LAM_RE, ' ');

  let tokens = s.split(/\s+/).filter(Boolean);
  // «Кухонная» перед «столешница» — убрать.
  tokens = tokens.filter((t) => !/^кухонн\p{L}*$/iu.test(t));

  // Тип материала — в начало.
  const ti = tokens.findIndex((t) => TYPE_TOKEN_RE.test(t));
  if (ti >= 0) {
    let type = tokens.splice(ti, 1)[0].toUpperCase();
    if (type === 'ДСП' && hadLam) type = 'ЛДСП';
    tokens.unshift(type);
  } else if (tokens.length && /^столешниц/i.test(tokens[0])) {
    tokens[0] = tokens[0][0].toUpperCase() + tokens[0].slice(1);
  } else {
    const si = tokens.findIndex((t) => /^столешниц/i.test(t));
    if (si === 0) tokens[0] = tokens[0][0].toUpperCase() + tokens[0].slice(1);
  }

  // Толщина — перед заводским кодом (EG)/(KU)…, иначе в конец.
  if (thickness != null) {
    const tk = `(${thickness})`;
    const ci = tokens.findIndex((t) => /^\([A-ZА-Я]{2,3}\)$/.test(t));
    if (ci >= 0) tokens.splice(ci, 0, tk); else tokens.push(tk);
  }

  return { name: tokens.join(' '), thickness };
}

/** Применяет очистку к черновику (мутирует): rawName — сырое имя, name —
 * очищенное, thickness дописывается, только если парсер его не дал. */
function applyCleanName(draft) {
  if (!draft || typeof draft.name !== 'string') return draft;
  draft.rawName = draft.name;
  const r = cleanSheetName(draft.name);
  draft.name = r.name;
  if (r.thickness != null && draft.thickness == null) draft.thickness = r.thickness;
  return draft;
}

module.exports = { cleanSheetName, applyCleanName, isSheetName };
