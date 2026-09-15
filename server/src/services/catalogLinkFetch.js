// Скачивание страницы товара стороннего сайта для парсера "Добавить по
// ссылке" (см. ТЗ-ПАРСЕР-МАТЕРИАЛОВ.md, раздел 4). Используется и
// одиночным POST /catalog-link-parse, и батчем POST /catalog-link-refresh
// (см. routes/catalogLinks.js) — вся сетевая логика и защита от SSRF в
// одном месте, парсеры сайтов (services/catalogLinkParsers/*.js) сами по
// себе сети не касаются и работают с уже скачанным HTML.
//
// Защита от SSRF (пользователь передаёт произвольный url):
// - домен ссылки сверяется с домeном сайта из реестра (см.
//   catalogLinkParsers/registry.js) до первого сетевого запроса;
// - редиректы обрабатываются вручную (redirect: 'manual') — каждый Location
//   тоже обязан указывать на тот же домен, иначе запрос прерывается ДО
//   перехода по нему (fetch с redirect:'follow' сходил бы на чужой домен
//   раньше, чем мы успели бы это заметить по response.url);
// - разрешены только http/https;
// - ограничение количества редиректов и таймаут на каждый запрос
//   (AbortController) — сайт может не отвечать вовсе;
// - размер тела ответа ограничен (см. MAX_BODY_BYTES) — не читаем
//   бесконечный/огромный ответ целиком в память.

const DEFAULT_TIMEOUT_MS = 9000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // обычная страница товара — сотни КБ
const USER_AGENT = 'Modul3D-CatalogLinkBot/1.0 (+https://modul3d.app)';

class CatalogLinkError extends Error {
  constructor(message, httpStatus) {
    super(message);
    this.name = 'CatalogLinkError';
    this.httpStatus = httpStatus || 502;
  }
}

function normalizeHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

/** Проверяет, что url синтаксически валиден, использует http(s) и
 * принадлежит домену site (без учёта "www."). Бросает CatalogLinkError(400)
 * иначе. Возвращает разобранный URL. */
function assertUrlBelongsToSite(rawUrl, site) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    throw new CatalogLinkError('Ссылка на товар некорректна (не удалось разобрать URL).', 400);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new CatalogLinkError('Поддерживаются только ссылки http(s).', 400);
  }
  if (normalizeHost(parsed.hostname) !== normalizeHost(site.domain)) {
    throw new CatalogLinkError(
      `Ссылка не принадлежит сайту ${site.domain} — проверьте адрес.`,
      400
    );
  }
  return parsed;
}

/** Читает тело fetch-ответа как текст, обрывая с ошибкой, если оно
 * превышает MAX_BODY_BYTES (не дожидаясь, пока сайт "докачает" гигантский
 * ответ целиком). */
async function readTextCapped(res) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    // На случай окружения, где fetch() не даёт доступа к телу как к потоку —
    // просто читаем целиком (для обычных страниц товара это безопасно).
    return res.text();
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let total = 0;
  let text = '';

  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new CatalogLinkError('Страница слишком большая для обработки.', 502);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

/**
 * Скачивает страницу товара по ссылке, заведомо принадлежащей домену site
 * (см. assertUrlBelongsToSite), не следуя за редиректами на чужие домены.
 * @returns {Promise<{ html: string, finalUrl: string }>}
 */
async function fetchProductHtml(rawUrl, site, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let currentUrl = assertUrlBelongsToSite(rawUrl, site);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      // eslint-disable-next-line no-await-in-loop
      res = await fetch(currentUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
        },
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new CatalogLinkError('Сайт не ответил вовремя (таймаут запроса).', 504);
      }
      throw new CatalogLinkError(`Не удалось связаться с сайтом: ${err.message}`, 502);
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const location = res.headers.get('location');
      let nextUrl;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch (_) {
        throw new CatalogLinkError('Сайт вернул некорректный редирект.', 502);
      }
      if (normalizeHost(nextUrl.hostname) !== normalizeHost(site.domain)) {
        throw new CatalogLinkError(
          'Ссылка перенаправляет на другой домен — отклонено из соображений безопасности.',
          400
        );
      }
      currentUrl = nextUrl;
      // eslint-disable-next-line no-continue
      continue;
    }

    if (res.status === 404) {
      throw new CatalogLinkError('Товар не найден по этой ссылке (страница отсутствует на сайте).', 404);
    }
    if (!res.ok) {
      throw new CatalogLinkError(`Сайт вернул ошибку (статус ${res.status}).`, 502);
    }

    // eslint-disable-next-line no-await-in-loop
    const html = await readTextCapped(res);
    return { html, finalUrl: currentUrl.toString() };
  }

  throw new CatalogLinkError('Слишком много редиректов при обращении к сайту.', 502);
}

/**
 * Скачивает и парсит одну страницу товара по её сайту из реестра.
 * @param {object} site — запись реестра (см. catalogLinkParsers/registry.js)
 * @param {string} rawUrl
 * @returns {Promise<object>} черновик товара (см. catalogLinkParsers/*.js)
 */
async function fetchAndParseProduct(site, rawUrl) {
  const { html, finalUrl } = await fetchProductHtml(rawUrl, site);
  try {
    return site.parse(html, finalUrl);
  } catch (err) {
    if (err instanceof CatalogLinkError) throw err;
    throw new CatalogLinkError(
      err.message || 'Не удалось распознать данные товара на странице (возможно, изменилась вёрстка сайта).',
      502
    );
  }
}

module.exports = {
  CatalogLinkError,
  assertUrlBelongsToSite,
  fetchProductHtml,
  fetchAndParseProduct,
};
