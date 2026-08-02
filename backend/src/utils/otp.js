const crypto = require('crypto');

/**
 * Generate a cryptographically secure OTP.
 * Uses crypto.randomInt() (CSPRNG) instead of Math.random() (not secure).
 */
function generateOtp(length = 6) {
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += crypto.randomInt(0, 10).toString();
  }
  return otp;
}

function generateSecureToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function getOtpExpiry(minutes = null) {
  const mins = minutes || parseInt(process.env.OTP_EXPIRY_MINUTES || '10');
  return new Date(Date.now() + mins * 60 * 1000);
}

module.exports = { generateOtp, generateSecureToken, getOtpExpiry };
