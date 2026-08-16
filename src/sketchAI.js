// sketchAI.js
// ============================================================================
// Распознавание эскиза шкафа через Claude Vision (Anthropic Messages API).
//
// ВАЖНО: вызов идёт напрямую из браузера с ключом пользователя — это подходит
// только для локального прототипа (ключ виден в devtools/сетевых запросах).
// Для продакшена такой вызов нужно перенести на сервер (см. README).
//
// Пайплайн: jpg/png эскиза -> Claude (vision, просим строго JSON) -> парсинг
// -> частичные параметры для state в app.js -> пользователь проверяет и
// при необходимости правит вручную (панель параметров не блокируется).
//
// Классический скрипт (без import/export) — публикует себя в window.Modul3D.
// ============================================================================
(function () {
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';

const SYSTEM_PROMPT = `Ты — технолог мебельного производства. Тебе показывают эскиз (фото или скан
рисунка) корпусного прямого шкафа. Определи по эскизу параметры конструкции и
верни ИСКЛЮЧИТЕЛЬНО один JSON-объект без пояснений, без markdown-разметки,
строго по следующей схеме (значения — твои лучшие оценки по рисунку и
проставленным на нём размерам; если размеров нет — оцени пропорции разумно
для бытового шкафа):

{
  "width": число_мм,
  "height": число_мм,
  "depth": число_мм,
  "bodyThickness": 16,
  "backThickness": 3,
  "baseType": "plinth" | "legs",
  "baseHeight": число_мм,
  "decorHint": "краткое текстовое описание декора/цвета, если виден на эскизе, иначе null",
  "jointType": "confirmat",
  "sections": [
    { "shelves": число, "drawers": число, "facade": "doors1" | "doors2" | "open" }
  ],
  "notes": "1-2 предложения: на что обратить внимание при проверке (неточности, неоднозначности рисунка)"
}

Правила:
- "sections" — по одной записи на каждую видимую вертикальную секцию шкафа слева направо.
- "facade": "doors1" — одна глухая дверь на секцию, "doors2" — двустворчатая дверь, "open" — открытые полки без дверей.
- Если на эскизе видны ящики — укажи их количество в соответствующей секции.
- Числа — только числа (без единиц измерения и текста).
- Не добавляй никакого текста до или после JSON.`;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result; // data:<mime>;base64,<data>
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Модель не вернула JSON. Ответ: ' + text.slice(0, 300));
  }
  const jsonStr = text.slice(start, end + 1);
  return JSON.parse(jsonStr);
}

function clamp(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Приводит сырой ответ модели к безопасным, зажатым в разумные пределы параметрам. */
function sanitizeRecognizedParams(raw) {
  const width = clamp(raw.width, 300, 4000, 2400);
  const height = clamp(raw.height, 400, 3000, 2400);
  const depth = clamp(raw.depth, 250, 800, 600);
  const bodyThickness = clamp(raw.bodyThickness, 10, 25, 16);
  const backThickness = clamp(raw.backThickness, 3, 10, 3);
  const baseType = raw.baseType === 'legs' ? 'legs' : 'plinth';
  const baseHeight = clamp(raw.baseHeight, 20, 200, 100);

  let sections = Array.isArray(raw.sections) ? raw.sections : [];
  sections = sections.slice(0, 6).map((s) => ({
    shelves: Math.round(clamp(s.shelves, 0, 10, 3)),
    drawers: Math.round(clamp(s.drawers, 0, 6, 0)),
    facade: ['doors1', 'doors2', 'open'].includes(s.facade) ? s.facade : 'doors1',
  }));
  if (sections.length === 0) sections = [{ shelves: 3, drawers: 0, facade: 'doors1' }];

  return {
    width, height, depth, bodyThickness, backThickness,
    baseType, baseHeight, sections,
    decorHint: typeof raw.decorHint === 'string' ? raw.decorHint : null,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
  };
}

/**
 * Отправляет изображение эскиза в Claude и возвращает распознанные параметры.
 * @param {File} file — jpg/png файл эскиза
 * @param {string} apiKey — ключ Anthropic API (вводится пользователем в UI)
 */
async function recognizeSketch(file, apiKey) {
  if (!apiKey) throw new Error('Укажите Anthropic API-ключ в настройках, чтобы включить распознавание эскиза.');
  if (!file) throw new Error('Файл эскиза не выбран.');

  const base64 = await fileToBase64(file);
  const mediaType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'Проанализируй этот эскиз шкафа и верни JSON по описанной схеме.' },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Ошибка Anthropic API (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || '').join('\n');
  const raw = extractJson(text);
  return sanitizeRecognizedParams(raw);
}

window.Modul3D = window.Modul3D || {};
window.Modul3D.sketchAI = { recognizeSketch, sanitizeRecognizedParams };
})();
