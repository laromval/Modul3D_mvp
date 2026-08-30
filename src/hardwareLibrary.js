// hardwareLibrary.js
// ============================================================================
// Приватная библиотека 3D-моделей фурнитуры (.obj петель) пользователя —
// клиент серверных роутов /hardware-models (см.
// server/src/routes/hardwareModels.js):
//   POST   /hardware-models       { name, slotKind, objText } -> запись
//   GET    /hardware-models        -> список моделей (без objText, лёгкий)
//   GET    /hardware-models/:id    -> одна модель, включая objText
//   DELETE /hardware-models/:id    -> удаление
//
// Не платная ИИ-операция — просто хранение файла под аккаунтом, поэтому
// здесь нет обработки 402/списания токенов (в отличие от sketchAI.js).
// Единственное требование сервера — валидный JWT в Authorization: Bearer.
//
// JWT берётся из localStorage под тем же ключом, что использует sketchAI.js
// и app.js после /auth/login или /auth/register — см. AUTH_TOKEN_KEY ниже
// (значение 'modul3dAuthToken' продублировано намеренно, как и в
// sketchAI.js: каждый клиентский модуль хранит свою копию константы, чтобы
// не тянуть зависимость между файлами порядка подключения ради одной
// строки).
//
// Кэширующий слой: getGeometry(id, THREE) один раз скачивает и парсит .obj
// через THREE.OBJLoader, дальше отдаёт готовую THREE.BufferGeometry из
// памяти (Map по id) — аналогично тому, как legMeshes.js кэширует запечённые
// меши опор. Сам файл не занимается позиционированием/ориентацией модели в
// сцене — это дело viewer.js.
//
// Классический скрипт (без import/export) — публикует себя в window.Modul3D.
// ============================================================================
(function () {
// Адрес сервера монетизации. Для локальной разработки — локальный сервер
// из server/. Для реального деплоя ЗАМЕНИТЬ на адрес продакшен-сервера.
const API_BASE = 'http://localhost:4000';

const AUTH_TOKEN_KEY = 'modul3dAuthToken';

// Кэш готовых геометрий по id модели — переживает несколько обращений за
// время жизни страницы, сбрасывается только перезагрузкой (как и у
// legMeshes.js/viewer.js).
const geometryCache = new Map();

function requireToken() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) {
    throw new Error('Нужно войти в аккаунт, чтобы пользоваться библиотекой фурнитуры.');
  }
  return token;
}

async function parseErrorResponse(res) {
  const errBody = await res.json().catch(() => null);
  return (errBody && errBody.error) ? errBody.error : `Ошибка сервера (${res.status}).`;
}

/**
 * Возвращает список моделей фурнитуры текущего пользователя (без objText —
 * лёгкий список для UI).
 * @returns {Promise<Array<{id:string, name:string, slotKind:string, createdAt:string}>>}
 */
async function list() {
  const token = requireToken();

  let res;
  try {
    res = await fetch(`${API_BASE}/hardware-models`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (networkErr) {
    throw new Error('Не удалось связаться с сервером — проверьте подключение к интернету.');
  }

  if (res.status === 401) {
    throw new Error('Сессия истекла или недействительна — войдите в аккаунт заново.');
  }
  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }

  return res.json();
}

/**
 * Загружает .obj файл на сервер как новую модель фурнитуры пользователя.
 * @param {File} file — .obj файл (текстовый формат, читается через file.text())
 * @param {{name:string, slotKind:string}} meta
 * @returns {Promise<{id:string, name:string, slotKind:string, createdAt:string}>}
 */
async function upload(file, meta) {
  if (!file) throw new Error('Файл модели (.obj) не выбран.');

  const { name, slotKind } = meta || {};
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Не указано имя модели.');
  }
  if (typeof slotKind !== 'string' || slotKind.trim().length === 0) {
    throw new Error('Не указан тип посадочного места (slotKind).');
  }

  const token = requireToken();

  let objText;
  try {
    objText = await file.text();
  } catch (readErr) {
    throw new Error('Не удалось прочитать файл .obj.');
  }

  let res;
  try {
    res = await fetch(`${API_BASE}/hardware-models`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: name.trim(), slotKind, objText }),
    });
  } catch (networkErr) {
    throw new Error('Не удалось связаться с сервером — проверьте подключение к интернету.');
  }

  if (res.status === 401) {
    throw new Error('Сессия истекла или недействительна — войдите в аккаунт заново.');
  }
  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }

  return res.json();
}

/**
 * Удаляет модель фурнитуры пользователя по id.
 * @param {string} id
 * @returns {Promise<void>}
 */
async function remove(id) {
  if (!id) throw new Error('Не передан id модели фурнитуры.');
  const token = requireToken();

  let res;
  try {
    res = await fetch(`${API_BASE}/hardware-models/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (networkErr) {
    throw new Error('Не удалось связаться с сервером — проверьте подключение к интернету.');
  }

  if (res.status === 401) {
    throw new Error('Сессия истекла или недействительна — войдите в аккаунт заново.');
  }
  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }

  // Успех — 204 No Content, тела ответа нет.
  geometryCache.delete(id);
}

async function fetchModelRecord(id) {
  const token = requireToken();

  let res;
  try {
    res = await fetch(`${API_BASE}/hardware-models/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (networkErr) {
    throw new Error('Не удалось связаться с сервером — проверьте подключение к интернету.');
  }

  if (res.status === 401) {
    throw new Error('Сессия истекла или недействительна — войдите в аккаунт заново.');
  }
  if (res.status === 404) {
    throw new Error('Модель фурнитуры не найдена — возможно, она была удалена.');
  }
  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }

  return res.json();
}

/**
 * Возвращает готовую THREE.BufferGeometry для модели фурнитуры с данным id.
 * Первый вызов скачивает .obj с сервера и парсит его через THREE.OBJLoader;
 * повторные вызовы для того же id отдают результат из памяти.
 * @param {string} id
 * @param {typeof window.THREE} THREE — глобальный THREE с подключённым OBJLoader
 * @returns {Promise<THREE.BufferGeometry>}
 */
async function getGeometry(id, THREE) {
  if (!id) throw new Error('Не передан id модели фурнитуры.');
  if (!THREE || typeof THREE.OBJLoader !== 'function') {
    throw new Error('THREE.OBJLoader недоступен — загрузчик .obj не подключён.');
  }

  if (geometryCache.has(id)) {
    return Promise.resolve(geometryCache.get(id));
  }

  const record = await fetchModelRecord(id);

  const loader = new THREE.OBJLoader();
  const group = loader.parse(record.objText);

  const meshes = [];
  group.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });

  if (meshes.length === 0) {
    throw new Error(`Модель «${record.name}» не содержит геометрии — .obj файл пуст или повреждён.`);
  }

  let geometry;
  if (meshes.length === 1) {
    geometry = meshes[0].geometry;
  } else {
    const geometries = meshes.map((mesh) => mesh.geometry);
    geometry = THREE.BufferGeometryUtils.mergeBufferGeometries(geometries);
  }

  geometryCache.set(id, geometry);
  return geometry;
}

window.Modul3D = window.Modul3D || {};
window.Modul3D.hardwareLibrary = {
  list,
  upload,
  remove,
  getGeometry,
  API_BASE,
  AUTH_TOKEN_KEY,
};
})();
