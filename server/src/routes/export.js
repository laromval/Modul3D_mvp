// Роуты серверной генерации документов (Этап 3 монетизации,
// ТЗ-МОНЕТИЗАЦИЯ.md, 4.3). Все требуют активную подписку — жёсткий гейт:
// параметры модели/спецификации уходят на сервер уже посчитанными
// (engine.js остаётся единственным источником истины и на сервер не
// портируется — см. ТЗ, 4.3), а сервер только проверяет подписку и
// формирует файл из присланных данных, ничего не пересчитывая.
//
// Содержимое файлов (колонки, форматы, единицы измерения) генерирует
// server/src/services/exportGeneration.js — зона агента export-cutting,
// здесь эта логика НЕ переизобретается (см. .claude/agents/
// backend-monetization.md, раздел «Что НЕ твоя зона»).
//
// Модуль exportGeneration подключается ЛЕНИВО (не через require на
// верхнем уровне файла): на момент написания этих роутов он мог ещё не
// существовать (параллельная задача другого агента) — обычный require
// уронил бы уже старт всего сервера, т.к. index.js импортирует этот
// роутер. Ленивый require + try/catch даёт понятную ошибку (501) только
// при обращении к конкретному /export/* эндпоинту, весь остальной сервер
// продолжает работать.
//
// Фактический интерфейс server/src/services/exportGeneration.js (сверено
// по факту, не по договорённости заранее — там иначе, чем предполагалось):
//   buildDetailingWorkbook(model, projectName)     -> Buffer (готовый .xlsx)
//   buildSpecificationWorkbook(spec, projectName)  -> Buffer (готовый .xlsx)
//   buildDrillCsv(model)                           -> string (текст CSV, без BOM)
//   buildDrillDxf(model)                           -> string (текст DXF, без BOM)
// Синхронные функции, без Promise — оборачиваем в Promise.resolve() ниже,
// чтобы общий обработчик handleExport оставался async-совместимым и не
// зависел от того, вернёт ли конкретная функция сервиса промис или нет.
//
// BOM: раньше (до Этапа 3) клиентский src/cnc.js перед созданием Blob
// добавлял BOM (`'﻿' + text`) единообразно для CSV и DXF — так Excel
// в русской локали и CAD-программы корректно определяют кодировку UTF-8 с
// кириллицей. Эта логика жила в браузерной функции download(), которая при
// переносе экспорта на сервер была удалена из cnc.js (см. его текущую
// версию) — сам buildDrillCsv/buildDrillDxf в exportGeneration.js, как и
// раньше, BOM не добавляют. Чтобы итоговые байты файла не изменились
// (не регрессия для тех, кто открывает CSV/DXF в Excel/CAD), BOM
// добавляется здесь, при сборке HTTP-ответа — это часть доставки файла
// клиенту, а не формата его содержимого (колонки/значения не трогаем).

const express = require('express');

const { requireAuth } = require('../middleware/auth');
const { requireActiveSubscription } = require('../middleware/subscription');

const router = express.Router();

let exportGeneration = null;
let exportGenerationError = null;

function getExportGeneration() {
  if (exportGeneration) return exportGeneration;
  if (exportGenerationError) throw exportGenerationError;
  try {
    // eslint-disable-next-line global-require
    exportGeneration = require('../services/exportGeneration');
    return exportGeneration;
  } catch (err) {
    exportGenerationError = err;
    throw err;
  }
}

function isMissingExportGenerationModule(err) {
  return (
    err &&
    err.code === 'MODULE_NOT_FOUND' &&
    typeof err.message === 'string' &&
    err.message.includes('exportGeneration')
  );
}

// Отдаёт файл клиенту с корректными заголовками. filename может содержать
// кириллицу (имя проекта) — используем RFC 5987 (filename*=UTF-8''...) с
// ASCII-фолбэком в filename=, иначе не-ASCII имя в заголовке некорректно.
function sendFile(res, { buffer, filename, contentType }) {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_');
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.send(buffer);
}

// projectName приходит от клиента произвольной строкой (или отсутствует) —
// подставляем безопасный дефолт для имени файла, саму строку не
// экранируем от спецсимволов ОС (см. sendFile — не-ASCII уходит только в
// filename*=UTF-8'', а filename= содержит уже ASCII-safe фолбэк).
function safeProjectName(projectName) {
  return typeof projectName === 'string' && projectName.trim() ? projectName.trim() : 'proekt';
}

// buildDrillCsv/buildDrillDxf возвращают текст без BOM (см. комментарий
// вверху файла про перенос логики download() из cnc.js) — добавляем BOM
// здесь и кодируем в Buffer в UTF-8, чтобы Excel/CAD-программы с русской
// локалью корректно распознали кодировку, как это было раньше в браузере.
function textToBufferWithBom(text) {
  return Buffer.from('﻿' + text, 'utf8');
}

async function handleExport(req, res, { validate, generate, contentType }) {
  const validationError = validate(req.body || {});
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    const svc = getExportGeneration();
    const { buffer, filename } = await generate(svc, req.body);
    return sendFile(res, { buffer, filename, contentType });
  } catch (err) {
    if (isMissingExportGenerationModule(err)) {
      console.error(
        '[export] server/src/services/exportGeneration.js ещё не реализован ' +
          '(зона export-cutting) — эндпоинт временно недоступен.'
      );
      return res.status(501).json({
        error: 'Серверная генерация документов ещё не реализована. Попробуйте позже.',
      });
    }
    console.error('[export] ошибка генерации файла:', err);
    return res.status(500).json({ error: 'Не удалось сформировать файл.' });
  }
}

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// express.json({ limit: '20mb' }) подключён точечно к каждому роуту (как в
// sketch.js), а не глобально в index.js — тело с полной моделью/
// спецификацией проекта может быть увесистым; остальным роутам такой
// лимит не нужен (см. также комментарий в index.js).

router.post(
  '/detailing',
  express.json({ limit: '20mb' }),
  requireAuth,
  requireActiveSubscription,
  (req, res) =>
    handleExport(req, res, {
      validate: (body) =>
        !body.model || typeof body.model !== 'object'
          ? 'Не передана модель (model).'
          : null,
      generate: (svc, body) => {
        const name = safeProjectName(body.projectName);
        const buffer = svc.buildDetailingWorkbook(body.model, body.projectName);
        return Promise.resolve({ buffer, filename: `${name}_detalirovka.xlsx` });
      },
      contentType: XLSX_CONTENT_TYPE,
    })
);

router.post(
  '/specification',
  express.json({ limit: '20mb' }),
  requireAuth,
  requireActiveSubscription,
  (req, res) =>
    handleExport(req, res, {
      validate: (body) =>
        !body.spec || typeof body.spec !== 'object'
          ? 'Не передана спецификация (spec).'
          : null,
      generate: (svc, body) => {
        const name = safeProjectName(body.projectName);
        const buffer = svc.buildSpecificationWorkbook(body.spec, body.projectName);
        return Promise.resolve({ buffer, filename: `${name}_specifikaciya.xlsx` });
      },
      contentType: XLSX_CONTENT_TYPE,
    })
);

router.post(
  '/cnc/csv',
  express.json({ limit: '20mb' }),
  requireAuth,
  requireActiveSubscription,
  (req, res) =>
    handleExport(req, res, {
      validate: (body) =>
        !body.model || typeof body.model !== 'object'
          ? 'Не передана модель (model).'
          : null,
      generate: (svc, body) => {
        const buffer = textToBufferWithBom(svc.buildDrillCsv(body.model));
        return Promise.resolve({ buffer, filename: 'присадка.csv' });
      },
      contentType: 'text/csv;charset=utf-8',
    })
);

router.post(
  '/cnc/dxf',
  express.json({ limit: '20mb' }),
  requireAuth,
  requireActiveSubscription,
  (req, res) =>
    handleExport(req, res, {
      validate: (body) =>
        !body.model || typeof body.model !== 'object'
          ? 'Не передана модель (model).'
          : null,
      generate: (svc, body) => {
        const buffer = textToBufferWithBom(svc.buildDrillDxf(body.model));
        return Promise.resolve({ buffer, filename: 'присадка.dxf' });
      },
      contentType: 'application/dxf',
    })
);

module.exports = router;
