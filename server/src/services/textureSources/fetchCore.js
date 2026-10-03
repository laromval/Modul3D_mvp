// Сетевое ядро «Источников текстур»: скачивание HTML страницы декора и
// картинки с жёстким allowlist хостов (SSRF), ручной обработкой редиректов
// (хост проверяется на КАЖДОМ шаге), таймаутами и потоковым лимитом размера.
// Ничего не пишет на диск, куки не хранит и не передаёт.

const { CatalogLinkError, normalizeHost } = require('../catalogLinkFetch');

const TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 1024 * 1024; // страница декора ~110 КБ
const MAX_PIXELS = 100 * 1000 * 1000;
const MAX_SIDE_PX = 16000;
const UA ='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function hostAllowed(hostname, allowedHosts) {
  const h = normalizeHost(hostname);
  return allowedHosts.some((a) => normalizeHost(a) === h);
}

/** Разбирает URL и проверяет схему http(s) и хост по allowlist. */
function assertAllowedUrl(raw, allowedHosts, what) {
  let u;
  try {
    u = new URL(raw);
  } catch (_) {
    throw new CatalogLinkError('Ссылка некорректна (не удалось разобрать адрес).', 400);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new CatalogLinkError('Поддерживаются только ссылки http(s).', 400);
  }
  if (u.username || u.password) {
    throw new CatalogLinkError('Ссылка содержит недопустимые данные авторизации.', 400);
  }
  if (!hostAllowed(u.hostname, allowedHosts)) {
    throw new CatalogLinkError(what || 'Ссылка не принадлежит поддерживаемому сайту.', 400);
  }
  // Принудительно https без нестандартного порта — на allowlist-хостах он везде доступен.
  u.protocol = 'https:';
  u.port = '';
  return u;
}

async function readCapped(res, maxBytes, tooBigMessage) {
  const declared = parseInt(res.headers.get('content-length') || '0', 10);
  if (declared && declared > maxBytes) {
    try { await res.body.cancel(); } catch (_) { /* ignore */ }
    throw new CatalogLinkError(tooBigMessage, 502);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new CatalogLinkError(tooBigMessage, 502);
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks);
}

/**
 * GET с ручными редиректами; каждый шаг проверяется по allowedHosts.
 * notFoundOk: при 404 вернуть { buffer: null } вместо ошибки (для fallback-ов).
 */
async function fetchCapped(rawUrl, { allowedHosts, maxBytes, accept, tooBigMessage, notFoundMessage, notFoundOk }) {
  let current = assertAllowedUrl(rawUrl, allowedHosts);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      let res;
      try {
        // eslint-disable-next-line no-await-in-loop
        res = await fetch(current.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'user-agent': UA, accept },
        });
      } catch (err) {
        if (err.name === 'AbortError') throw new CatalogLinkError('Сайт не отвечает (таймаут запроса).', 504);
        throw new CatalogLinkError('Сайт не отвечает или недоступен.', 502);
      }

      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        let next;
        try {
          next = new URL(res.headers.get('location'), current);
        } catch (_) {
          throw new CatalogLinkError('Сайт вернул некорректный редирект.', 502);
        }
        if (!hostAllowed(next.hostname, allowedHosts) || (next.protocol !== 'https:' && next.protocol !== 'http:')) {
          throw new CatalogLinkError('Ссылка перенаправляет на другой домен — отклонено из соображений безопасности.', 400);
        }
        next.protocol = 'https:';
        next.port = '';
        try { await res.body.cancel(); } catch (_) { /* ignore */ }
        current = next;
        // eslint-disable-next-line no-continue
        continue;
      }

      if (res.status === 404 || res.status === 410) {
        if (notFoundOk) return { buffer: null, finalUrl: current.toString() };
        throw new CatalogLinkError(notFoundMessage || 'Страница не найдена.', 404);
      }
      if (!res.ok) {
        throw new CatalogLinkError(`Сайт вернул ошибку (статус ${res.status}).`, 502);
      }
      // Таймер остаётся активным на время чтения тела.
      // eslint-disable-next-line no-await-in-loop
      const buffer = await readCapped(res, maxBytes, tooBigMessage);
      return { buffer, finalUrl: current.toString() };
    } catch (err) {
      if (err.name === 'AbortError') throw new CatalogLinkError('Сайт не отвечает (таймаут запроса).', 504);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new CatalogLinkError('Слишком много редиректов при обращении к сайту.', 502);
}

/** Страница декора как текст (лимит ~1 МБ). */
async function fetchHtml(rawUrl, allowedHosts) {
  const r = await fetchCapped(rawUrl, {
    allowedHosts,
    maxBytes: MAX_HTML_BYTES,
    accept: 'text/html,application/xhtml+xml',
    tooBigMessage: 'Страница слишком большая для обработки.',
    notFoundMessage: 'Страница не найдена — проверьте адрес.',
  });
  return { html: r.buffer.toString('utf8'), finalUrl: r.finalUrl };
}

/** Тип и размеры картинки по сигнатуре, либо null, если это не JPEG/PNG. */
function sniffImage(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { type: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xff) { i += 1; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'image/jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return { type: 'image/jpeg', width: 0, height: 0 };
  }
  return null;
}

/** Скачивает картинку и проверяет сигнатуру. С notFoundOk при 404 вернёт null. */
async function fetchImage(rawUrl, allowedHosts, maxBytes, opts = {}) {
  const r = await fetchCapped(rawUrl, {
    allowedHosts,
    maxBytes,
    accept: 'image/jpeg,image/png,image/*;q=0.8',
    tooBigMessage: 'Файл изображения слишком большой.',
    notFoundMessage: 'Изображение не найдено на сайте.',
    notFoundOk: opts.notFoundOk,
  });
  if (!r.buffer) return null;
  const info = sniffImage(r.buffer);
  if (!info) throw new CatalogLinkError('Сайт отдал не изображение (ожидался JPEG или PNG).', 502);
  if (info.width > MAX_SIDE_PX || info.height > MAX_SIDE_PX || info.width * info.height > MAX_PIXELS) {
    throw new CatalogLinkError('Изображение слишком большое.', 502);
  }
  return { buffer: r.buffer, finalUrl: r.finalUrl, ...info };
}

module.exports = { assertAllowedUrl, fetchHtml, fetchImage, sniffImage };
