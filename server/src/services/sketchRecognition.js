// Распознавание эскиза шкафа через Claude Vision (Anthropic Messages API) —
// серверная сторона (Этап 2 монетизации, см. ТЗ-МОНЕТИЗАЦИЯ.md, 4.1).
//
// Промпт, extractJson и sanitizeRecognizedParams перенесены СЮДА из
// клиентского src/sketchAI.js БЕЗ ИЗМЕНЕНИЙ (кроме удаления DOM-зависимого
// fileToBase64 — клиент теперь сам конвертирует файл в base64 и шлёт JSON,
// см. server/src/routes/sketch.js). Не меняй SYSTEM_PROMPT/sanitize-логику
// без синхронной правки src/sketchAI.js на клиенте (или явного решения
// вывести sketchAI.js из употребления — это не наша зона, см. CLAUDE.md).
//
// Ключ Anthropic читается только из process.env (server/src/config.js) —
// никогда не логируется и не возвращается клиенту.

const config = require('../config');

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
 * Отправляет изображение эскиза в Claude (серверным ключом) и возвращает
 * распознанные и зажатые в мебельные пределы параметры.
 * @param {string} base64 — данные изображения в base64 (без префикса data:...;base64,)
 * @param {string} mimeType — 'image/jpeg' | 'image/png'
 */
async function recognizeSketch(base64, mimeType) {
  if (!config.anthropicApiKey) {
    // Специальный класс ошибки, чтобы роут мог отличить "не настроено на
    // сервере" (503, без списания токенов) от прочих сбоев Anthropic.
    const err = new Error('ANTHROPIC_API_KEY не задан на сервере.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const mediaType = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01',
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
  } catch (networkErr) {
    const err = new Error('Не удалось связаться с Anthropic API: ' + networkErr.message);
    err.code = 'NETWORK_ERROR';
    throw err;
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    // Тело ошибки Anthropic может содержать эхо запроса — не пробрасываем
    // его клиенту как есть за пределами короткого фрагмента для диагностики.
    const err = new Error(`Ошибка Anthropic API (${res.status}): ${errText.slice(0, 300)}`);
    err.code = 'ANTHROPIC_ERROR';
    throw err;
  }

  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || '').join('\n');
  const raw = extractJson(text);
  return sanitizeRecognizedParams(raw);
}

module.exports = { recognizeSketch, sanitizeRecognizedParams, extractJson, SYSTEM_PROMPT };
