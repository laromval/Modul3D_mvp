// Middleware, проверяющий JWT из заголовка Authorization: Bearer <token>.
// При успехе кладёт { id, email } в req.user.

const jwt = require('jsonwebtoken');
const config = require('../config');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Требуется авторизация (Bearer token).' });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Недействительный или истёкший токен.' });
  }
}

module.exports = { requireAuth };
