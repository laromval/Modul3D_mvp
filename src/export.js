// export.js
// ============================================================================
// Export Module (часть) — выгрузка Деталировки и Спецификации в Excel.
//
// Этап 3 монетизации (см. ТЗ-МОНЕТИЗАЦИЯ.md, раздел 4.3): генерация самого
// .xlsx больше не идёт в браузере — код был открыт (нет сборщика/
// минификации), платный гейт легко обходился через консоль разработчика.
// Теперь клиент лишь отправляет уже посчитанные данные (те же model.parts /
// spec, что показаны в таблицах на экране — сам расчёт остаётся клиентским,
// на сервер уходит только сериализация в файл) на сервер вместе с JWT,
// сервер проверяет активную подписку и возвращает готовый .xlsx.
//
// JWT и адрес сервера берутся из window.Modul3D.sketchAI (API_BASE,
// AUTH_TOKEN_KEY), объявленных в src/sketchAI.js — не дублируем константы.
// ВАЖНО: sketchAI.js подключается в index.html ПОСЛЕ export.js, поэтому
// обращаться к window.Modul3D.sketchAI можно только внутри функций-
// обработчиков (в момент вызова пользователем), а не в теле IIFE при
// загрузке скрипта.
//
// Классический скрипт (без import/export) — публикует себя в window.Modul3D.
// ============================================================================
(function () {

function currencySymbol() {
  try {
    return (window.Modul3D && window.Modul3D.currency && window.Modul3D.currency.getSymbol())
      ? window.Modul3D.currency.getSymbol()
      : '₽';
  } catch (e) {
    return '₽';
  }
}

// Общий помощник: POST на сервер экспорта с JWT, скачивание готового файла
// из тела ответа как Blob. Бросает Error с err.code — числовым HTTP-статусом
// (401/402/400/др.) или строкой 'network' при сетевой ошибке — по этому коду
// UI-слой (app.js/ui-shell.js) показывает понятный призыв к действию
// (войти в аккаунт / оформить подписку), а не голый код ошибки (см. ТЗ 4.4).
async function fetchExportFile(path, body, fallbackFilename) {
  const sketchAI = window.Modul3D && window.Modul3D.sketchAI;
  const API_BASE = sketchAI ? sketchAI.API_BASE : 'http://localhost:4000';
  const AUTH_TOKEN_KEY = sketchAI ? sketchAI.AUTH_TOKEN_KEY : 'modul3dAuthToken';

  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) {
    const err = new Error('Войдите в аккаунт, чтобы скачать документ.');
    err.code = 401;
    throw err;
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    const err = new Error('Не удалось связаться с сервером экспорта — проверьте подключение к интернету.');
    err.code = 'network';
    throw err;
  }

  if (!res.ok) {
    let msg;
    if (res.status === 401) msg = 'Сессия истекла или недействительна — войдите в аккаунт заново.';
    else if (res.status === 402) msg = 'Экспорт документов доступен только по активной подписке.';
    else if (res.status === 400) msg = 'Сервер не принял данные для экспорта — пересчитайте модель и повторите.';
    else msg = 'Не удалось сформировать файл, попробуйте ещё раз.';
    const err = new Error(msg);
    err.code = res.status;
    throw err;
  }

  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fallbackFilename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

async function exportDetailing(model, projectName) {
  await fetchExportFile('/export/detailing', { model, projectName },
    `${projectName || 'proekt'}_detalirovka.xlsx`);
}

async function exportSpecification(spec, projectName) {
  // Символ валюты — чисто клиентское UI-состояние (window.Modul3D.currency,
  // см. ui-shell.js), на сервере его нет. Кладём внутрь spec, чтобы не
  // менять форму тела запроса верхнего уровня (контракт 4.3: { spec,
  // projectName }) — сервер читает spec.currencySymbol с фоллбэком на ₽.
  const sym = currencySymbol();
  const specWithCurrency = Object.assign({}, spec, { currencySymbol: sym });
  await fetchExportFile('/export/specification', { spec: specWithCurrency, projectName },
    `${projectName || 'proekt'}_specifikaciya.xlsx`);
}

window.Modul3D = window.Modul3D || {};
window.Modul3D.exportModule = { exportDetailing, exportSpecification };
})();
