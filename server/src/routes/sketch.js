// POST /sketch/recognize — прокси-эндпоинт ИИ-распознавания эскиза
// (Этап 2 монетизации, см. ТЗ-МОНЕТИЗАЦИЯ.md, раздел 4.1 — контракт ниже
// реализует именно его, не отклоняться).
//
// Контракт:
// - Authorization: Bearer <JWT> обязателен (requireAuth).
// - Тело: { imageBase64: string, mimeType: 'image/jpeg' | 'image/png' }.
// - Списание токенов — atomic conditional decrement (см. ниже), чтобы
//   закрыть гонку при параллельных запросах одного пользователя:
//     1) UPDATE token_balances SET balance = balance - $cost
//        WHERE user_id = $1 AND balance >= $cost RETURNING balance
//        — если 0 строк, баланс недостаточен -> 402, Anthropic не вызывается.
//     2) Только после успешного списания — вызов Anthropic Vision.
//     3) Если вызов Anthropic упал (сеть/API/невалидный JSON) — токены
//        возвращаются (balance = balance + $cost), клиенту — ошибка,
//        явно говорящая, что токены не списаны.
//     4) При успехе — в ответе отдаётся актуальный остаток токенов.

const express = require('express');

const config = require('../config');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { recognizeSketch } = require('../services/sketchRecognition');

const router = express.Router();

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];

// express.json({ limit: '10mb' }) подключён только к этому роуту (не
// глобально в index.js) — изображение эскиза в base64 может быть увесистым,
// остальным роутам такой лимит не нужен.
router.post('/recognize', express.json({ limit: '10mb' }), requireAuth, async (req, res) => {
  const { imageBase64, mimeType } = req.body || {};

  if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
    return res.status(400).json({ error: 'Не передано изображение эскиза (imageBase64).' });
  }
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return res.status(400).json({ error: 'mimeType должен быть image/jpeg или image/png.' });
  }

  const cost = config.sketchTokenCost;
  const userId = req.user.id;

  // Шаг 1: atomic conditional decrement. Условие balance >= cost прямо в
  // WHERE закрывает гонку между параллельными запросами одного
  // пользователя — либо ровно один из них спишет токены и получит
  // непустой RETURNING, либо оба увидят недостаточный баланс.
  let balanceAfterCharge;
  try {
    const { rows } = await db.query(
      `UPDATE token_balances SET balance = balance - $2, updated_at = now()
       WHERE user_id = $1 AND balance >= $2
       RETURNING balance`,
      [userId, cost]
    );
    if (rows.length === 0) {
      return res.status(402).json({ error: 'Недостаточно токенов для распознавания эскиза.' });
    }
    balanceAfterCharge = rows[0].balance;
  } catch (err) {
    console.error('[sketch/recognize] ошибка списания токенов:', err);
    return res.status(500).json({ error: 'Не удалось проверить баланс токенов.' });
  }

  // Шаг 2: только после успешного списания — вызов Anthropic.
  try {
    const params = await recognizeSketch(imageBase64, mimeType);
    return res.json({ params, tokenBalance: balanceAfterCharge });
  } catch (err) {
    // Шаг 3: возврат токенов — вызов Anthropic не состоялся или ответ
    // невалиден, пользователь не должен платить за неудачную попытку.
    await refundTokens(userId, cost);

    if (err.code === 'NOT_CONFIGURED') {
      console.error('[sketch/recognize] ANTHROPIC_API_KEY не настроен на сервере.');
      return res.status(503).json({
        error: 'Распознавание эскиза временно недоступно (сервис не настроен). Токены не списаны.',
      });
    }

    console.error('[sketch/recognize] ошибка распознавания:', err.message);
    return res.status(502).json({
      error: 'Не удалось распознать эскиз. Токены не списаны, попробуйте ещё раз.',
    });
  }
});

async function refundTokens(userId, cost) {
  try {
    await db.query(
      `UPDATE token_balances SET balance = balance + $2, updated_at = now() WHERE user_id = $1`,
      [userId, cost]
    );
  } catch (err) {
    // Если даже возврат не удался — это уже расхождение баланса, требующее
    // ручного разбора; логируем максимально явно, но не роняем ответ клиенту
    // (он и так получит ошибку распознавания).
    console.error('[sketch/recognize] КРИТИЧНО: не удалось вернуть токены после сбоя Anthropic', {
      userId, cost, err,
    });
  }
}

module.exports = router;
