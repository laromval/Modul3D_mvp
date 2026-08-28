// cnc.js
// ============================================================================
// Выгрузка ПРИСАДКИ для станка с ЧПУ.
//
// Этап 3 монетизации (см. ТЗ-МОНЕТИЗАЦИЯ.md, раздел 4.3): построение самого
// DXF/CSV больше не идёт в браузере — перенесено на сервер
// (server/src/services/exportGeneration.js) вместе с проверкой подписки,
// иначе платный гейт легко обходился бы прямым вызовом
// window.Modul3D.cnc.buildDrillCsv(model) из консоли разработчика. Клиент
// отправляет уже посчитанную модель (model.parts, включая part.holes —
// посчитанные в engine.js, не пересчитываются здесь и на сервере) и получает
// готовый файл.
//
// Координаты отверстий (см. серверный exportGeneration.js) — в системе
// координат самой детали: начало — левый нижний угол ЛИЦЕВОЙ стороны,
// ось X вправо по длине, ось Y вверх по ширине. Именно так деталь кладут
// на присадочный станок.
//
// Что осталось на клиенте: drilledParts()/isGlassPart() — используются
// только для счётчика деталей в UI (сколько деталей уйдёт на присадку) перед
// экспортом, содержимого файла не отдают и платный гейт не нарушают.
//
// JWT и адрес сервера берутся из window.Modul3D.sketchAI (API_BASE,
// AUTH_TOKEN_KEY), объявленных в src/sketchAI.js — не дублируем константы.
// ВАЖНО: sketchAI.js подключается в index.html ПОСЛЕ cnc.js, поэтому
// обращаться к window.Modul3D.sketchAI можно только внутри функций-
// обработчиков (в момент вызова пользователем), а не в теле IIFE при
// загрузке скрипта.
//
// Классический скрипт (без import/export) — публикует себя в window.Modul3D.
// ============================================================================
(function () {

// Стекло на присадочный станок не идёт: отверстия в нём делают стеклорезчики
// своим инструментом. Поэтому стеклянные детали в выгрузку не попадают.
function isGlassPart(p) {
  return !!p.glass || /^GLASS/.test(String(p.material || ''));
}

function drilledParts(model) {
  // Деталь идёт на станок, если у неё есть присадка ИЛИ паз: паз — такая же
  // операция, её тоже режут на ЧПУ.
  return (model.parts || []).filter((p) => !p.hardware && !isGlassPart(p)
    && ((p.holes && p.holes.length) || (p.grooves && p.grooves.length)));
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

async function exportDrillCsv(model) {
  await fetchExportFile('/export/cnc/csv', { model }, 'присадка.csv');
}
async function exportDrillDxf(model) {
  await fetchExportFile('/export/cnc/dxf', { model }, 'присадка.dxf');
}

window.Modul3D = window.Modul3D || {};
window.Modul3D.cnc = { exportDrillCsv, exportDrillDxf, drilledParts };
})();
