// Самолечение схемы при старте сервера: на Railway миграции вручную не гоняют,
// а запросы клиентов/файлов уже обращаются к колонке client_files.is_avatar
// (миграция 011). Выполняем эту миграцию при каждом старте — она идемпотентна
// (IF NOT EXISTS), повтор безопасен. Ошибка не роняет сервер, только в лог.

const fs = require('fs');
const path = require('path');
const db = require('../db');

const FILES = ['011_client_avatar.sql'];

async function ensureSchema() {
  for (const name of FILES) {
    try {
      const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', name), 'utf8');
      await db.query(sql);
      console.log('[schema] ' + name + ': ок');
    } catch (err) {
      console.error('[schema] ' + name + ': не удалось применить:', err && err.message);
    }
  }
}

module.exports = { ensureSchema };
