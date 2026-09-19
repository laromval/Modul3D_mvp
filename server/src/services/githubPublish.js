// Тонкая обёртка над GitHub REST API для кнопки «Опубликовать как базу по
// умолчанию» (routes/catalogPublish.js, ТЗ-МОНЕТИЗАЦИЯ.md, раздел 6) — читает
// и атомарно перезаписывает src/catalog.js/src/app.js в основном репозитории
// проекта (config.githubRepo@config.githubBranch).
//
// Почему Git Data API (blob -> tree -> commit -> update ref), а не два
// последовательных PUT /repos/.../contents/<path> (обычный, «ленивый» способ
// закоммитить файл через GitHub API): Contents API коммитит один файл за
// вызов. Два вызова подряд для catalog.js и app.js — это два отдельных
// коммита; если второй упадёт (сеть, конфликт, rate limit), в master
// останется файл catalog.js с новыми данными и app.js со старыми — а именно
// эта пара обязана оставаться согласованной (blob кладётся в оба файла
// одним и тем же снимком catalog_overrides). Git Data API позволяет собрать
// оба изменения в одно дерево и одним PATCH ref сдвинуть ветку сразу на
// новый коммит — либо оба файла обновились, либо (при ошибке до последнего
// шага) ни один.
//
// Как и services/sketchRecognition.js/telegramNotify.js — обычный fetch без
// сторонних HTTP-библиотек (Node 20+, см. CLAUDE.md/package.json).

const config = require('../config');

const API_BASE = 'https://api.github.com';

class GithubPublishError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GithubPublishError';
  }
}

// GitHub требует кодировать каждый сегмент пути отдельно (не весь путь
// целиком через encodeURIComponent — это заодно закодировало бы разделяющие
// '/' и сломало бы адрес).
function encodePathSegments(value) {
  return value.split('/').map(encodeURIComponent).join('/');
}

function authHeaders() {
  return {
    Authorization: `token ${config.githubToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// Общий вызов GitHub API: пробрасывает сетевые ошибки и ошибки статуса как
// GithubPublishError с осмысленным сообщением (включает метод/путь/статус —
// см. требование к отчёту ошибок в задаче), не глотает их молча.
async function githubRequest(method, path, body) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...authHeaders(),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw new GithubPublishError(
      `Не удалось связаться с GitHub API (${method} ${path}): ${networkErr.message}`
    );
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new GithubPublishError(
      `Ошибка GitHub API (${res.status} ${method} ${path}): ${errText.slice(0, 500)}`
    );
  }

  if (res.status === 204) return null;
  return res.json();
}

/**
 * Читает текущее содержимое файла из config.githubRepo@config.githubBranch
 * как utf8-строку (Contents API отдаёт base64, разбитый переводами строк —
 * Buffer.from их спокойно игнорирует).
 * @param {string} filePath — путь от корня репозитория, например 'src/catalog.js'.
 */
async function getFileContent(filePath) {
  const data = await githubRequest(
    'GET',
    `/repos/${config.githubRepo}/contents/${encodePathSegments(filePath)}?ref=${encodeURIComponent(config.githubBranch)}`
  );
  if (!data || typeof data.content !== 'string') {
    throw new GithubPublishError(`GitHub вернул файл ${filePath} в неожиданном формате (нет поля content).`);
  }
  return Buffer.from(data.content, 'base64').toString('utf8');
}

/**
 * Атомарно коммитит один или несколько файлов одним коммитом в
 * config.githubRepo@config.githubBranch через Git Data API. Использует
 * `force: false` при обновлении ref — если ветка на GitHub успела уйти
 * вперёд (кто-то запушил параллельно), обновление отклоняется вместо того,
 * чтобы затереть чужой коммит.
 * @param {{ path: string, content: string }[]} files
 * @param {string} message — сообщение коммита.
 * @returns {Promise<{ commitSha: string }>}
 */
async function commitFiles(files, message) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new GithubPublishError('commitFiles: нечего коммитить (пустой список файлов).');
  }

  const repo = config.githubRepo;
  const branchSegment = encodePathSegments(config.githubBranch);

  // 1. Текущий коммит ветки.
  const ref = await githubRequest('GET', `/repos/${repo}/git/ref/heads/${branchSegment}`);
  const baseCommitSha = ref.object.sha;

  // 2. Дерево этого коммита — базовое дерево для нового коммита ниже.
  const baseCommit = await githubRequest('GET', `/repos/${repo}/git/commits/${baseCommitSha}`);
  const baseTreeSha = baseCommit.tree.sha;

  // 3. Blob на каждый изменённый файл — до этого шага в репозитории ничего
  //    не меняется (blob без ссылки на него из дерева/коммита не виден в
  //    истории), поэтому частичный сбой здесь безопасен.
  const treeEntries = [];
  for (const file of files) {
    const blob = await githubRequest('POST', `/repos/${repo}/git/blobs`, {
      content: Buffer.from(file.content, 'utf8').toString('base64'),
      encoding: 'base64',
    });
    treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // 4. Новое дерево поверх текущего — только изменённые пути, остальной
  //    репозиторий наследуется от baseTreeSha как есть.
  const newTree = await githubRequest('POST', `/repos/${repo}/git/trees`, {
    base_tree: baseTreeSha,
    tree: treeEntries,
  });

  // 5. Коммит с одним родителем (baseCommitSha) — обычный линейный коммит,
  //    не merge.
  const newCommit = await githubRequest('POST', `/repos/${repo}/git/commits`, {
    message,
    tree: newTree.sha,
    parents: [baseCommitSha],
  });

  // 6. Последний шаг — сдвигаем ref ветки на новый коммит. Только с этого
  //    момента изменения реально попадают в master; всё, что выше, было лишь
  //    подготовкой объектов в базе GitHub без видимого эффекта.
  await githubRequest('PATCH', `/repos/${repo}/git/refs/heads/${branchSegment}`, {
    sha: newCommit.sha,
    force: false,
  });

  return { commitSha: newCommit.sha };
}

module.exports = { GithubPublishError, getFileContent, commitFiles };
