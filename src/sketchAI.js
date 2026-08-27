// sketchAI.js
// ============================================================================
// Распознавание эскиза шкафа — клиент серверного эндпоинта POST /sketch/recognize
// (см. ТЗ-МОНЕТИЗАЦИЯ.md, раздел 4.1).
//
// Начиная с Этапа 2 монетизации вызов Claude Vision больше не идёт напрямую
// из браузера (это требовало ключа Anthropic от самого пользователя — схема
// bring-your-own-key). Теперь клиент лишь конвертирует файл в base64 и
// отправляет его на свой сервер вместе с JWT пользователя; сервер сам
// проверяет баланс токенов, зовёт Claude Vision своим ключом, списывает
// токены и возвращает уже провалидированные ("зажатые" в разумные для
// мебели пределы — см. бывшую sanitizeRecognizedParams, она переехала на
// сервер без изменений) параметры конструкции.
//
// JWT берётся из localStorage — тот же ключ, под которым app.js хранит токен
// после /auth/login или /auth/register (см. AUTH_TOKEN_KEY ниже,
// window.Modul3D.sketchAI.AUTH_TOKEN_KEY переиспользуется в app.js, чтобы
// не разъезжалось имя ключа).
//
// Классический скрипт (без import/export) — публикует себя в window.Modul3D.
// ============================================================================
(function () {
// Адрес сервера монетизации. Для локальной разработки — локальный сервер
// из server/. Для реального деплоя ЗАМЕНИТЬ на адрес продакшен-сервера.
const API_BASE = 'http://localhost:4000';

const AUTH_TOKEN_KEY = 'modul3dAuthToken';

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

/**
 * Отправляет изображение эскиза на сервер и возвращает распознанные
 * параметры конструкции (плюс актуальный остаток токенов после списания).
 * Контракт ответа — см. server/src/routes/sketch.js:
 * @param {File} file — jpg/png файл эскиза
 * @returns {Promise<{params: object, tokenBalance: number}>} params — те же
 *   поля, что раньше отдавала sanitizeRecognizedParams (width, height, depth,
 *   bodyThickness, backThickness, baseType, baseHeight, sections, decorHint,
 *   notes) — теперь считаются на сервере.
 */
async function recognizeSketch(file) {
  if (!file) throw new Error('Файл эскиза не выбран.');

  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) {
    throw new Error('Войдите в аккаунт (кнопка «Аккаунт» в шапке), чтобы распознать эскиз через ИИ.');
  }

  const base64 = await fileToBase64(file);
  const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';

  let res;
  try {
    res = await fetch(`${API_BASE}/sketch/recognize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ imageBase64: base64, mimeType }),
    });
  } catch (networkErr) {
    throw new Error('Не удалось связаться с сервером распознавания — проверьте подключение к интернету.');
  }

  if (res.status === 401) {
    throw new Error('Сессия истекла или недействительна — войдите в аккаунт заново.');
  }
  if (res.status === 402) {
    throw new Error('Недостаточно токенов для распознавания эскиза — пополните баланс.');
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    const msg = (errBody && errBody.error) ? errBody.error : `Ошибка сервера (${res.status}).`;
    throw new Error(msg);
  }

  return res.json();
}

window.Modul3D = window.Modul3D || {};
window.Modul3D.sketchAI = { recognizeSketch, API_BASE, AUTH_TOKEN_KEY };
})();
