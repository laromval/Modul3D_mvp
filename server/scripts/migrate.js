// Применяет SQL-миграции из server/src/migrations по порядку имён файлов.
// Запуск: npm run migrate (из директории server/), требует DATABASE_URL в .env.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'migrations');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL не задан. Скопируй .env.example в .env и заполни его.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('Нет файлов миграций в', MIGRATIONS_DIR);
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log('Применяю миграцию:', file);
      await client.query(sql);
    }
    console.log('Миграции применены успешно.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Ошибка миграции:', err);
  process.exit(1);
});
