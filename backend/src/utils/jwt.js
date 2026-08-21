const jwt = require('jsonwebtoken');
const crypto = require('crypto');

function generateAccessToken(payload) {
  return jwt.sign(
    { ...payload, jti: crypto.randomBytes(16).toString('hex') },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
}

function generateRefreshToken(payload) {
  return jwt.sign(
    { ...payload, jti: crypto.randomBytes(16).toString('hex') },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
}

/**
 * Generate a short-lived 2FA challenge token.
 * Issued after password verification succeeds for a 2FA-enabled account.
 * Contains only the userId and a type flag — no role or permissions.
 * Expires in 5 minutes and is single-use (jti tracked in Redis by the handler).
 *
 * Security (C-1 fix): The /auth/2fa/authenticate endpoint must verify this
 * token instead of trusting a client-supplied userId in the request body.
 */
function generate2FAChallengeToken(userId) {
  return jwt.sign(
    {
      userId,
      type: '2fa_challenge',          // type guard — validates this is a challenge token
      jti:  crypto.randomBytes(16).toString('hex')  // for one-time-use tracking in Redis
    },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }               // 5-minute window to complete 2FA
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

function decodeToken(token) {
  return jwt.decode(token);
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generate2FAChallengeToken,
  verifyAccessToken,
  verifyRefreshToken,
  decodeToken
};
