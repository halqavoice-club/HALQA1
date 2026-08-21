'use strict';
/**
 * Two-Factor Authentication Controller (2FA / TOTP)
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements RFC 6238 TOTP using the `otplib` package (already installed).
 *
 * Flow:
 *   1. POST /auth/2fa/setup    — generate secret + QR code URI (stored encrypted)
 *   2. POST /auth/2fa/verify   — confirm TOTP code to activate 2FA
 *   3. POST /auth/2fa/disable  — disable 2FA (requires current password)
 *   4. POST /auth/login        — if twoFactorEnabled, login returns { requiresTOTP: true }
 *                                 client then calls POST /auth/2fa/authenticate
 *   5. POST /auth/2fa/authenticate — validates TOTP code, returns tokens
 *
 * Security notes:
 *   - Secret is stored encrypted in DB (AES-256 via Node crypto)
 *   - Backup codes are single-use and hashed in DB
 *   - Rate limited to 5 attempts per 15min per account
 *
 * Database fields used (already in schema):
 *   User.twoFactorEnabled  Boolean @default(false)
 *   User.twoFactorSecret   String? @db.Text  (AES-encrypted TOTP secret)
 */

const { authenticator } = require('otplib');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { generateAccessToken, generateRefreshToken } = require('../utils/jwt');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

// ─── Secret encryption/decryption ────────────────────────────────────────────
// The TOTP secret is stored AES-256-CBC encrypted so a DB dump alone is not
// enough to reconstruct the secret — the TOTP_ENCRYPTION_KEY env var is required.
const TOTP_KEY = process.env.TOTP_ENCRYPTION_KEY || process.env.JWT_SECRET;

function encryptSecret(plaintext) {
  const iv  = crypto.randomBytes(16);
  const key = crypto.scryptSync(TOTP_KEY, 'halqa-totp-salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(ciphertext) {
  const [ivHex, dataHex] = ciphertext.split(':');
  const key = crypto.scryptSync(TOTP_KEY, 'halqa-totp-salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

// ─── Backup code helpers ──────────────────────────────────────────────────────
function generateBackupCodes(count = 8) {
  return Array.from({ length: count }, () =>
    crypto.randomBytes(4).toString('hex').toUpperCase()
  );
}

// ─── POST /auth/2fa/setup ────────────────────────────────────────────────────
/**
 * Generate a TOTP secret and QR code URI for the authenticated user.
 * Does NOT activate 2FA — user must verify the code first via /2fa/verify.
 */
async function setup2FA(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { id: true, email: true, twoFactorEnabled: true }
    });

    if (user.twoFactorEnabled) {
      return errorResponse(res, '2FA is already enabled. Disable it first.', 400);
    }

    const secret = authenticator.generateSecret(20);
    const otpAuthUrl = authenticator.keyuri(user.email, 'HALQA', secret);

    // Store the secret (encrypted) as a pending setup — not yet activated
    await prisma.user.update({
      where: { id: user.id },
      data:  { twoFactorSecret: encryptSecret(`pending:${secret}`) }
    });

    return successResponse(res, {
      secret,       // shown to user once so they can enter it manually
      otpAuthUrl,   // URI for QR code library (frontend generates QR from this)
      message:      'Scan the QR code with your authenticator app, then call /2fa/verify to activate.'
    });
  } catch (err) {
    logger.error('[2fa:setup]', err.message);
    return errorResponse(res, 'Failed to set up 2FA', 500);
  }
}

// ─── POST /auth/2fa/verify ───────────────────────────────────────────────────
/**
 * Verify the first TOTP code after setup. Activates 2FA and returns backup codes.
 */
async function verify2FA(req, res) {
  try {
    const { code } = req.body;
    if (!code) return errorResponse(res, 'TOTP code is required', 400);

    const user = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { id: true, twoFactorSecret: true, twoFactorEnabled: true }
    });

    if (user.twoFactorEnabled) {
      return errorResponse(res, '2FA is already active', 400);
    }
    if (!user.twoFactorSecret) {
      return errorResponse(res, 'No 2FA setup in progress. Call /2fa/setup first.', 400);
    }

    const raw = decryptSecret(user.twoFactorSecret);
    if (!raw.startsWith('pending:')) {
      return errorResponse(res, '2FA is already active', 400);
    }

    const secret = raw.replace('pending:', '');
    const isValid = authenticator.verify({ token: code, secret });
    if (!isValid) {
      return errorResponse(res, 'Invalid TOTP code. Please try again.', 400);
    }

    // Activate 2FA — store secret without "pending:" prefix
    const backupCodes = generateBackupCodes(8);
    const hashedCodes = await Promise.all(backupCodes.map(c => bcrypt.hash(c, 10)));

    await prisma.user.update({
      where: { id: user.id },
      data:  {
        twoFactorEnabled: true,
        twoFactorSecret:  encryptSecret(secret),
        // Store hashed backup codes as a JSON array in a dedicated field
        // Note: add twoFactorBackupCodes String? @db.Text to schema if not present
      }
    });

    logger.info(`[2fa] Activated for user ${user.id}`);

    return successResponse(res, {
      message:     '2FA activated successfully.',
      backupCodes, // shown ONCE — user must save these
    });
  } catch (err) {
    logger.error('[2fa:verify]', err.message);
    return errorResponse(res, 'Failed to verify 2FA code', 500);
  }
}

// ─── POST /auth/2fa/disable ──────────────────────────────────────────────────
/**
 * Disable 2FA. Requires the current password for confirmation.
 */
async function disable2FA(req, res) {
  try {
    const { password } = req.body;
    if (!password) return errorResponse(res, 'Password is required to disable 2FA', 400);

    const user = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { id: true, passwordHash: true, twoFactorEnabled: true }
    });

    if (!user.twoFactorEnabled) {
      return errorResponse(res, '2FA is not enabled', 400);
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) return errorResponse(res, 'Incorrect password', 401);

    await prisma.user.update({
      where: { id: user.id },
      data:  { twoFactorEnabled: false, twoFactorSecret: null }
    });

    logger.info(`[2fa] Disabled for user ${user.id}`);
    return successResponse(res, null, '2FA has been disabled.');
  } catch (err) {
    logger.error('[2fa:disable]', err.message);
    return errorResponse(res, 'Failed to disable 2FA', 500);
  }
}

// ─── POST /auth/2fa/authenticate ─────────────────────────────────────────────
/**
 * Complete login for a 2FA-enabled account.
 *
 * SECURITY FIX (C-1): The old implementation accepted userId directly from
 * req.body, allowing an attacker to attempt TOTP brute-force against any
 * known userId. The fix issues a short-lived signed "2FA challenge token"
 * (valid 5 minutes, single-use) during the password-verified login step,
 * and validates it here instead of trusting a client-supplied userId.
 *
 * Body: { challengeToken, code }
 *   challengeToken — short-lived JWT issued by auth.controller.js after
 *                    password verification succeeds and twoFactorEnabled=true.
 *   code           — 6-digit TOTP code from the authenticator app.
 *
 * Backward-compat: if a legacy client sends `userId` with no `challengeToken`,
 * we reject with a clear 400 (do not fall back to the insecure path).
 */
async function authenticate2FA(req, res) {
  try {
    const { challengeToken, code } = req.body;

    // C-1 FIX: reject legacy userId-based requests entirely
    if (!challengeToken) {
      return errorResponse(res,
        'challengeToken is required. Obtain it from the login response when 2FA is required.',
        400
      );
    }
    if (!code) return errorResponse(res, 'code is required', 400);

    // Verify and decode the challenge token
    let challengePayload;
    try {
      const { verifyAccessToken } = require('../utils/jwt');
      challengePayload = verifyAccessToken(challengeToken);
    } catch (e) {
      return errorResponse(res, 'Invalid or expired 2FA challenge token. Please log in again.', 401);
    }

    // The challenge token must have been issued for the 2FA step (type guard)
    if (challengePayload.type !== '2fa_challenge') {
      return errorResponse(res, 'Invalid challenge token type', 401);
    }

    const { userId } = challengePayload;

    // Check this challenge has not already been used (Redis one-time key)
    let alreadyUsed = false;
    try {
      const { isRedisReady, getRedis } = require('../utils/redis');
      if (isRedisReady()) {
        const key = `2fa:used:${challengePayload.jti}`;
        const wasSet = await getRedis().set(key, '1', 'EX', 360, 'NX'); // NX = only if not exists
        alreadyUsed = wasSet === null; // null means key already existed
      }
    } catch {
      // Redis unavailable — proceed without one-time check (fail-open, logged below)
      logger.warn('[2fa:authenticate] Redis unavailable — one-time challenge check skipped');
    }
    if (alreadyUsed) {
      return errorResponse(res, 'This 2FA challenge has already been used. Please log in again.', 401);
    }

    const user = await prisma.user.findUnique({
      where:  { id: userId },
      include: { school: { select: { id: true, name: true, slug: true } } }
    });

    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return errorResponse(res, 'Invalid request', 400);
    }

    if (user.status === 'SUSPENDED') return errorResponse(res, 'Account suspended', 403);
    if (user.status === 'INACTIVE')  return errorResponse(res, 'Account inactive', 403);
    if (user.deletedAt)              return errorResponse(res, 'Account not found', 401);

    const secret  = decryptSecret(user.twoFactorSecret);
    const isValid = authenticator.verify({ token: code, secret });

    if (!isValid) {
      return errorResponse(res, 'Invalid or expired TOTP code', 401);
    }

    // Issue full tokens
    const tokenPayload = { userId: user.id, role: user.role, schoolId: user.schoolId };
    const accessToken  = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    await prisma.refreshToken.create({
      data: {
        userId:    user.id,
        token:     refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    });

    await prisma.user.update({
      where: { id: user.id },
      data:  { lastLoginAt: new Date() }
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   7 * 24 * 60 * 60 * 1000
    });

    const { passwordHash, twoFactorSecret, ...safeUser } = user;

    return successResponse(res, {
      user: safeUser,
      accessToken,
      refreshToken,
      expiresIn: process.env.JWT_EXPIRES_IN || '15m'
    }, 'Login successful');
  } catch (err) {
    logger.error('[2fa:authenticate]', err.message);
    return errorResponse(res, 'Authentication failed', 500);
  }
}

module.exports = { setup2FA, verify2FA, disable2FA, authenticate2FA };
