// Загрузка и хранение аватарок пользователей на диске сервера
// (server/uploads/avatars/). Файлы раздаются статически через
// express.static (см. server/index.js, app.use('/uploads', ...)).
// В БД (users.avatar_url) хранится только относительный путь вида
// /uploads/avatars/<uuid>.jpg — клиент сам достраивает его с API_BASE.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const AVATARS_DIR = path.join(__dirname, '..', '..', 'uploads', 'avatars');
// Создаём папку при старте сервера, чтобы загрузка не падала на чистом
// окружении (например, сразу после клонирования репозитория).
fs.mkdirSync(AVATARS_DIR, { recursive: true });

const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2 МБ

// Whitelist mimetype -> расширение файла на диске. Расширение берём ТОЛЬКО
// отсюда, никогда из оригинального имени загруженного файла — это защита
// от path traversal и подмены расширения через оригинальное имя.
const MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, AVATARS_DIR);
  },
  filename(req, file, cb) {
    const ext = MIME_EXTENSIONS[file.mimetype] || '';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  if (!MIME_EXTENSIONS[file.mimetype]) {
    cb(new Error('UNSUPPORTED_AVATAR_TYPE'));
    return;
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_AVATAR_SIZE },
});

// Запускает multer-мидлвар вручную (а не через обычный
// router.post(path, upload.single('avatar'), handler)), чтобы перехватить
// его ошибки (неверный формат файла, превышение размера) и ответить
// понятным 400 — иначе они улетают в общий 500-обработчик из index.js.
function handleAvatarUpload(req, res, next) {
  upload.single('avatar')(req, res, (err) => {
    if (!err) return next();

    if (err.message === 'UNSUPPORTED_AVATAR_TYPE') {
      return res.status(400).json({ error: 'Допустимые форматы аватарки: JPEG, PNG, WebP.' });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Размер аватарки не должен превышать 2 МБ.' });
    }
    console.error('[avatarUpload] ошибка загрузки файла:', err);
    return res.status(400).json({ error: 'Не удалось загрузить файл аватарки.' });
  });
}

// Удаляет уже сохранённый multer'ом файл — используется, когда остальная
// валидация запроса (никнейм, дубликат email и т.п.) не прошла ПОСЛЕ того,
// как файл уже записан на диск, чтобы не копить мусор.
function deleteUploadedFile(file) {
  if (!file || !file.path) return;
  fs.unlink(file.path, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.error('[avatarUpload] не удалось удалить файл аватарки:', err);
    }
  });
}

module.exports = { AVATARS_DIR, handleAvatarUpload, deleteUploadedFile };
