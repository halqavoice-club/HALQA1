'use strict';

/**
 * googleAuth.controller.js
 *
 * Google Sign-In backend handler.
 *
 * SECURITY ARCHITECTURE:
 *   1. Frontend receives a Google ID token (credential) from Google's OAuth popup.
 *   2. Frontend sends ONLY that token to this endpoint — no user data.
 *   3. Backend verifies the token cryptographically using Google's OAuth2Client.
 *      - Validates signature, issuer, audience (our client ID), and expiry.
 *      - Never trusts client-supplied email, name, avatar, or Google UID.
 *   4. After verification, backend finds or creates a HALQA user.
 *   5. Backend issues the same HALQA access+refresh tokens used by normal login.
 *   6. Frontend uses the existing auth store — no new token management.
 *
 * ROLE POLICY:
 *   - Google login NEVER assigns an Education role.
 *   - New Google users get User.role = MEMBER (social-only access).
 *   - Education roles come exclusively from SchoolMembership.
 *   - There is NO way to inject SUPER_ADMIN or any other role through this endpoint.
 *
 * ACCOUNT LINKING:
 *   - First: look for existing AuthProvider record (fastest path — returning Google user).
 *   - Second: if verified email matches an existing HALQA account → link automatically.
 *     (Safe because Google has already verified ownership of that email address.)
 *   - Third: no existing account → create new MEMBER user.
 */

const { OAuth2Client } = require('google-auth-library');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const { generateAccessToken, generateRefreshToken } = require('../utils/jwt');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

// ─── Google OAuth2Client (singleton) ─────────────────────────────────────────
// GOOGLE_CLIENT_ID must be set in .env — the same client ID used by the frontend.
// We accept both web and mobile client IDs in a comma-separated list so a single
// backend can serve both the Next.js web app and the Expo mobile app.
const GOOGLE_CLIENT_IDS = (process.env.GOOGLE_CLIENT_ID || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

let _oauthClient = null;

function getOAuthClient() {
  if (!_oauthClient) {
    if (GOOGLE_CLIENT_IDS.length === 0) {
      throw new Error('GOOGLE_CLIENT_ID is not configured in environment');
    }
    _oauthClient = new OAuth2Client();
  }
  return _oauthClient;
}

// ─── Verify Google ID token ───────────────────────────────────────────────────
/**
 * Verifies a Google ID token and returns the verified payload.
 * Throws if the token is invalid, expired, or has the wrong audience.
 *
 * @param {string} credential - The Google ID token from the frontend
 * @returns {Promise<{sub, email, name, picture, email_verified}>}
 */
async function verifyGoogleCredential(credential) {
  const client = getOAuthClient();

  // Verify against ALL configured client IDs (web + mobile)
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: GOOGLE_CLIENT_IDS,
  });

  const payload = ticket.getPayload();
  if (!payload) throw new Error('Empty payload from Google token');

  // Additional safety checks (verifyIdToken already validates these,
  // but explicit checks make the security model clear)
  if (!payload.sub) throw new Error('Missing sub claim in Google token');
  if (!payload.email) throw new Error('Missing email claim in Google token');
  if (!payload.email_verified) throw new Error('Google email is not verified');

  return {
    sub:            payload.sub,            // Google's unique user ID — never changes
    email:          payload.email,          // verified by Google
    name:           payload.name || null,
    picture:        payload.picture || null,
    emailVerified:  payload.email_verified,
  };
}

// ─── Split Google display name into first/last ────────────────────────────────
function parseDisplayName(name) {
  if (!name || !name.trim()) return { firstName: 'User', lastName: '' };
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// ─── POST /api/v1/auth/google ─────────────────────────────────────────────────
/**
 * Google Sign-In endpoint.
 *
 * Body: { credential: string } — Google ID token from Google One Tap / OAuth popup
 *
 * Response: same shape as normal login — { user, accessToken, refreshToken, expiresIn }
 *
 * Security:
 *   - Ignores any other fields in the request body (no role injection possible)
 *   - Rate limited by authLimiter in the route file
 *   - Logs all auth events for audit
 */
async function googleSignIn(req, res, next) {
  try {
    const { credential } = req.body;

    if (!credential || typeof credential !== 'string') {
      return errorResponse(res, 'Google credential is required', 400);
    }

    // Explicitly ignore any role, schoolId, or other fields the client might send
    // This is a belt-and-suspenders measure — the handler never reads them anyway

    // ── Step 1: Verify the Google credential cryptographically ───────────────
    let googlePayload;
    try {
      googlePayload = await verifyGoogleCredential(credential);
    } catch (err) {
      logger.warn(`[googleAuth] Token verification failed: ${err.message}`, { ip: req.ip });
      // Return safe error messages — never expose internal details
      if (err.message.includes('Token used too late') || err.message.includes('expired')) {
        return errorResponse(res, 'Google session expired. Please sign in again.', 401);
      }
      if (err.message.includes('audience') || err.message.includes('client_id')) {
        return errorResponse(res, 'Invalid Google configuration.', 401);
      }
      if (err.message.includes('GOOGLE_CLIENT_ID is not configured')) {
        logger.error('[googleAuth] GOOGLE_CLIENT_ID env var is not set');
        return errorResponse(res, 'Google Sign-In is not configured on this server.', 503);
      }
      return errorResponse(res, 'Invalid Google credential. Please try again.', 401);
    }

    const { sub: googleSub, email, name, picture } = googlePayload;

    // ── Step 2: Find or create HALQA user ─────────────────────────────────────
    let user;
    let isNewUser = false;

    // Path A: Existing Google-linked account (fastest — returning user)
    const existingProvider = await prisma.authProvider.findUnique({
      where: { provider_providerAccountId: { provider: 'GOOGLE', providerAccountId: googleSub } },
      include: { user: { select: { id: true, email: true, role: true, status: true, deletedAt: true, firstName: true, lastName: true, avatarUrl: true, schoolId: true } } }
    });

    if (existingProvider) {
      user = existingProvider.user;

      // Update display name and avatar from Google if they've changed
      const { firstName, lastName } = parseDisplayName(name);
      await prisma.authProvider.update({
        where: { id: existingProvider.id },
        data: { email, displayName: name || null, avatarUrl: picture || null }
      });
      // Optionally update avatar if user hasn't set a custom one
      // (non-blocking — avatar update failure must not block login)
      if (picture && !user.avatarUrl) {
        await prisma.user.update({ where: { id: user.id }, data: { avatarUrl: picture } }).catch(() => {});
      }
    }
    // Path B: No Google link — check if a HALQA account with this email exists
    else {
      const existingUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, role: true, status: true, deletedAt: true, firstName: true, lastName: true, avatarUrl: true, schoolId: true }
      });

      if (existingUser) {
        // Safe auto-linking: Google has cryptographically verified ownership of this email.
        // Create the provider link so future logins use Path A (faster).
        user = existingUser;
        await prisma.authProvider.create({
          data: {
            id:                uuidv4(),
            userId:            user.id,
            provider:          'GOOGLE',
            providerAccountId: googleSub,
            email,
            displayName:       name || null,
            avatarUrl:         picture || null,
          }
        });
        logger.info(`[googleAuth] Linked Google account to existing HALQA user ${user.id}`);
      }
      // Path C: No existing account — create a new MEMBER user
      else {
        const { firstName, lastName } = parseDisplayName(name);
        isNewUser = true;

        user = await prisma.$transaction(async (tx) => {
          const newUser = await tx.user.create({
            data: {
              id:            uuidv4(),
              email,
              passwordHash:  null,           // no password for Google-only accounts
              firstName,
              lastName,
              avatarUrl:     picture || null,
              // ROLE POLICY: Google login ALWAYS creates MEMBER — never any education role.
              // Education roles (STUDENT, TEACHER, etc.) come from SchoolMembership only.
              role:          'MEMBER',
              status:        'ACTIVE',       // Google-verified accounts are immediately active
              emailVerified: true,           // Google already verified the email
            },
            select: { id: true, email: true, role: true, status: true, deletedAt: true, firstName: true, lastName: true, avatarUrl: true, schoolId: true }
          });

          await tx.authProvider.create({
            data: {
              id:                uuidv4(),
              userId:            newUser.id,
              provider:          'GOOGLE',
              providerAccountId: googleSub,
              email,
              displayName:       name || null,
              avatarUrl:         picture || null,
            }
          });

          // F-06: Create wallet atomically with the Google user + auth provider.
          // Ensures OAuth-registered users have a wallet from the start, matching
          // the email/password registration path.
          await tx.wallet.create({
            data: {
              userId:    newUser.id,
              coins:      0,
              diamonds:   0,
              totalSpent: 0,
              totalEarned: 0,
            }
          });

          return newUser;
        });

        logger.info(`[googleAuth] Created new HALQA user ${user.id} via Google Sign-In`);
      }
    }

    // ── Step 3: Account status checks ────────────────────────────────────────
    if (user.deletedAt) {
      return errorResponse(res, 'This account has been deleted.', 403);
    }
    if (user.status === 'SUSPENDED') {
      return errorResponse(res, 'Your account has been suspended. Contact support.', 403);
    }
    if (user.status === 'INACTIVE') {
      return errorResponse(res, 'Your account is inactive.', 403);
    }

    // ── Step 4: Issue HALQA tokens (identical to normal login flow) ───────────
    const tokenPayload = { userId: user.id, role: user.role, schoolId: user.schoolId };
    const accessToken  = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Store refresh token (same as password login)
    await prisma.refreshToken.create({
      data: {
        userId:    user.id,
        token:     refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }
    });

    // Update last login timestamp
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    }).catch(() => {});

    // Audit log
    logger.info(`[googleAuth] User ${user.id} signed in via Google (new=${isNewUser})`, {
      userId:    user.id,
      email:     user.email,
      role:      user.role,
      isNewUser,
      ip:        req.ip,
    });

    // ── Step 5: Set httpOnly refresh token cookie (same as password login) ────
    // This is required for the Next.js middleware to recognise the session and
    // allow navigation to dashboard routes after Google Sign-In.
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // ── Step 6: Return the same response shape as normal login ────────────────
    // The { passwordHash, ...rest } spread is not needed since we used select: {}
    return successResponse(res, {
      user,
      accessToken,
      refreshToken,
      expiresIn:          process.env.JWT_EXPIRES_IN || '15m',
      mustChangePassword: false,   // Google users never need to change a password
      isNewUser,                   // frontend can show a welcome message if desired
    }, isNewUser ? 'Account created. Welcome to HALQA!' : 'Welcome back!');

  } catch (error) {
    logger.error(`[googleAuth] Unexpected error: ${error.message}`, { stack: error.stack });
    // Never expose internal error details
    return next(Object.assign(new Error('Authentication failed. Please try again.'), { statusCode: 500 }));
  }
}

module.exports = { googleSignIn };
