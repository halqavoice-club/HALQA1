const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { generateAccessToken, generateRefreshToken, generate2FAChallengeToken, verifyRefreshToken } = require('../utils/jwt');
const { generateOtp, getOtpExpiry } = require('../utils/otp');
const { sendOtpEmail, isEmailConfigured } = require('../utils/email');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

// ─── getMe cache helpers (REQ-18.3, 18.4, 18.5) ──────────────────────────────
const GET_ME_CACHE_TTL = 60; // seconds

function getMeCacheKey(userId) {
  return `user:me:${userId}`;
}

async function getGetMeCache(userId) {
  try {
    const { isRedisReady, getCache } = require('../utils/redis');
    if (!isRedisReady()) return null;
    return await getCache(getMeCacheKey(userId));
  } catch {
    return null; // Redis failure — fall back to DB
  }
}

async function setGetMeCache(userId, data) {
  try {
    const { isRedisReady, setCache } = require('../utils/redis');
    if (!isRedisReady()) return;
    await setCache(getMeCacheKey(userId), data, GET_ME_CACHE_TTL);
  } catch {
    // Redis failure — continue without caching
  }
}

// ─── Safe user fields for token refresh responses (REQ-8.7) ──────────────────
// Only non-sensitive identity fields are returned in refreshToken responses.
// Sensitive fields (passwordHash, fcmToken, twoFactorEnabled, phoneVerified)
// are excluded at query time so they never reach the serialization layer.
const REFRESH_USER_SELECT = {
  id: true,
  role: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  schoolId: true
};

// ─── Per-account login lockout (SEC-004) ──────────────────────────────────────
// Tracks consecutive failed login attempts per email in Redis.
// After MAX_ATTEMPTS failures: account-level cooldown of LOCKOUT_WINDOW_MS.
// This blocks distributed brute-force attacks that rotate IPs to bypass
// the IP-based rate limiter (authLimiter in rateLimiter.js).
//
// Key format : login:fail:{email}     → integer count (TTL = LOCKOUT_WINDOW_MS)
// Cleared on : successful login
const MAX_ATTEMPTS      = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_TTL_S     = LOCKOUT_WINDOW_MS / 1000;

async function recordFailedAttempt(email) {
  try {
    const { isRedisReady, getRedis } = require('../utils/redis');
    if (!isRedisReady()) return;
    const key = `login:fail:${email.toLowerCase()}`;
    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) {
      // First failure — set TTL so counter auto-expires after the lockout window
      await redis.expire(key, LOCKOUT_TTL_S);
    }
    return count;
  } catch {
    return 0; // Redis unavailable — fail open (don't block login)
  }
}

async function clearFailedAttempts(email) {
  try {
    const { isRedisReady, getRedis } = require('../utils/redis');
    if (!isRedisReady()) return;
    await getRedis().del(`login:fail:${email.toLowerCase()}`);
  } catch {}
}

async function isAccountLocked(email) {
  try {
    const { isRedisReady, getRedis } = require('../utils/redis');
    if (!isRedisReady()) return false;
    const count = await getRedis().get(`login:fail:${email.toLowerCase()}`);
    return count !== null && parseInt(count, 10) >= MAX_ATTEMPTS;
  } catch {
    return false; // Redis unavailable — fail open
  }
}

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 */
async function register(req, res, next) {
  try {
    const { email, password, firstName, lastName, schoolId, phone } = req.body;
    // SECURITY: role is intentionally NOT accepted from the request body.
    // All self-registered users start as STUDENT with PENDING status.
    // Admins assign roles via the school user-management endpoints after verification.
    // This prevents privilege escalation (e.g. self-registering as SCHOOL_ADMIN).

    // Check existing user
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return errorResponse(res, 'Email already registered', 409);

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    // F-06: Wallet is created atomically in the same transaction as the user
    // so every registered user has a wallet row from the start. Previously the
    // wallet was created lazily on first /wallet/me call, which meant a user
    // who received diamonds via seed/admin paths and then tried to request a
    // payout would hit WALLET_NOT_FOUND (404).
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          role: 'MEMBER',
          schoolId: schoolId || null,
          phone: phone || null,
          // In development: activate immediately so users can log in without email verification.
          // In production: start as PENDING until email is verified via OTP.
          status: process.env.NODE_ENV === 'development' ? 'ACTIVE' : 'PENDING',
          emailVerified: process.env.NODE_ENV === 'development' ? true : false,
        },
        select: {
          id: true, email: true, firstName: true, lastName: true,
          role: true, status: true, schoolId: true, createdAt: true
        }
      });

      // Create wallet atomically with the user — zero balances, no ledger entry
      // (a brand-new wallet has no transaction history).
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

    // Send verification OTP
    const otp = generateOtp(6);
    await prisma.otpCode.create({
      data: {
        userId: user.id,
        code: otp,
        type: 'email_verify',
        expiresAt: getOtpExpiry()
      }
    });

    await sendOtpEmail(email, otp, 'email_verify');

    const isDev = process.env.NODE_ENV === 'development';
    const message = isDev
      ? 'Registration successful! Email verification skipped in development. You can sign in now.'
      : 'Registration successful. Please verify your email.';

    return successResponse(res, { user }, message, 201);
  } catch (error) {
    next(error);
  }
}

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login with email and password
 *     tags: [Auth]
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    // SEC-004: Check per-account lockout before hitting the DB
    if (await isAccountLocked(email)) {
      return errorResponse(
        res,
        'Too many failed login attempts. Please try again in 15 minutes.',
        429
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        school: { select: { id: true, name: true, slug: true } },
        // Include school memberships in login response so the sidebar immediately
        // shows the Education section after login without needing a separate
        // GET /auth/me call. Without this, schoolMemberships is undefined in
        // the auth store and the school doesn't appear until fetchMe() is called.
        schoolMemberships: {
          where: { status: 'ACTIVE', deletedAt: null },
          include: {
            school: {
              select: { id: true, name: true, slug: true, logoUrl: true, type: true }
            }
          },
          orderBy: { joinedAt: 'asc' }
        }
      }
    });
    if (!user) {
      await recordFailedAttempt(email);
      return errorResponse(res, 'Invalid credentials', 401);
    }
    if (user.deletedAt) return errorResponse(res, 'Account not found', 401);

    // Guard: user may have registered via Google (no password).
    // They must use Google Sign-In — email/password login is not available.
    if (!user.passwordHash) {
      await recordFailedAttempt(email);
      return errorResponse(res, 'This account was created with Google Sign-In. Please use "Continue with Google" to sign in.', 401);
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      await recordFailedAttempt(email);
      return errorResponse(res, 'Invalid credentials', 401);
    }

    if (user.status === 'SUSPENDED') return errorResponse(res, 'Account suspended. Contact admin.', 403);
    if (user.status === 'PENDING') return errorResponse(res, 'Please verify your email first', 403);

    // SEC-004: Successful login — clear the failure counter
    await clearFailedAttempts(email);

    // ── 2FA gate (C-1 fix) ──────────────────────────────────────────────────
    // If 2FA is enabled, issue a short-lived challenge token instead of full
    // tokens. The client must complete POST /auth/2fa/authenticate with this
    // challengeToken + their TOTP code to receive the full access/refresh tokens.
    // The challengeToken is signed with JWT_SECRET, expires in 5 min, and is
    // single-use (jti tracked in Redis by the authenticate2FA handler).
    if (user.twoFactorEnabled) {
      const challengeToken = generate2FAChallengeToken(user.id);
      return successResponse(res, {
        requiresTOTP: true,
        challengeToken,           // client sends this back with the TOTP code
        // NOTE: userId is intentionally NOT returned here (C-1 fix).
        // The challengeToken encodes the userId server-side.
        expiresIn: '5m'
      }, 'TOTP verification required');
    }

    // Generate tokens
    const tokenPayload = { userId: user.id, role: user.role, schoolId: user.schoolId };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Store refresh token
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    });

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    // Set refresh token cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    const { passwordHash, ...userWithoutPassword } = user;

    return successResponse(res, {
      user: userWithoutPassword,
      accessToken,
      refreshToken, // included for mobile clients that can't use httpOnly cookies
      expiresIn: process.env.JWT_EXPIRES_IN || '15m',
      // Step 8: signal to frontend to redirect to change-password screen
      // before allowing any other navigation. Clear after successful change.
      mustChangePassword: user.mustChangePassword || false,
    }, 'Login successful');
  } catch (error) {
    next(error);
  }
}

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Auth]
 */
async function refreshToken(req, res, next) {
  try {
    const token = req.cookies.refreshToken || req.body.refreshToken;
    if (!token) return errorResponse(res, 'Refresh token required', 401);

    const decoded = verifyRefreshToken(token);

    const storedToken = await prisma.refreshToken.findUnique({
      where: { token },
      include: { user: { select: REFRESH_USER_SELECT } }
    });

    if (!storedToken || storedToken.isRevoked) {
      return errorResponse(res, 'Invalid refresh token', 401);
    }

    if (new Date() > storedToken.expiresAt) {
      return errorResponse(res, 'Refresh token expired', 401);
    }

    const { user } = storedToken;
    const tokenPayload = { userId: user.id, role: user.role, schoolId: user.schoolId };
    const newAccessToken = generateAccessToken(tokenPayload);
    const newRefreshToken = generateRefreshToken(tokenPayload);

    // Rotate refresh token atomically — handles concurrent refresh race conditions
    try {
      await prisma.$transaction([
        prisma.refreshToken.update({
          where: { id: storedToken.id },
          data: { isRevoked: true }
        }),
        prisma.refreshToken.create({
          data: {
            userId: user.id,
            token: newRefreshToken,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
          }
        })
      ]);
    } catch (txError) {
      // Unique constraint: another concurrent request already rotated this token
      // Return a fresh access token anyway — the client will retry
      if (txError.code === 'P2002') {
        const freshAccessToken = generateAccessToken(tokenPayload);
        return successResponse(res, {
          accessToken: freshAccessToken,
          user,
          expiresIn: process.env.JWT_EXPIRES_IN || '15m'
        }, 'Token refreshed');
      }
      throw txError;
    }

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return successResponse(res, {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken, // included for mobile clients
      user,
      expiresIn: process.env.JWT_EXPIRES_IN || '15m'
    }, 'Token refreshed');
  } catch (error) {
    next(error);
  }
}

async function logout(req, res, next) {
  try {
    const token = req.cookies.refreshToken || req.body.refreshToken;
    if (token) {
      await prisma.refreshToken.updateMany({
        where: { token },
        data: { isRevoked: true }
      });
    }
    res.clearCookie('refreshToken');
    return successResponse(res, null, 'Logged out successfully');
  } catch (error) {
    next(error);
  }
}

async function verifyEmail(req, res, next) {
  try {
    const { email, otp } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return errorResponse(res, 'User not found', 404);

    const otpRecord = await prisma.otpCode.findFirst({
      where: {
        userId: user.id,
        code: otp,
        type: 'email_verify',
        isUsed: false,
        expiresAt: { gt: new Date() }
      }
    });

    if (!otpRecord) return errorResponse(res, 'Invalid or expired OTP', 400);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true, status: 'ACTIVE' }
      }),
      prisma.otpCode.update({
        where: { id: otpRecord.id },
        data: { isUsed: true }
      })
    ]);

    return successResponse(res, null, 'Email verified successfully');
  } catch (error) {
    next(error);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    // Always return success to prevent email enumeration
    if (!user) return successResponse(res, null, 'If this email exists, a reset code has been sent');

    const otp = generateOtp(6);
    await prisma.otpCode.create({
      data: {
        userId: user.id,
        code: otp,
        type: 'password_reset',
        expiresAt: getOtpExpiry()
      }
    });

    await sendOtpEmail(email, otp, 'password_reset');

    return successResponse(res, null, 'Password reset code sent to your email');
  } catch (error) {
    next(error);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { email, otp, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return errorResponse(res, 'User not found', 404);

    const otpRecord = await prisma.otpCode.findFirst({
      where: {
        userId: user.id,
        code: otp,
        type: 'password_reset',
        isUsed: false,
        expiresAt: { gt: new Date() }
      }
    });

    if (!otpRecord) return errorResponse(res, 'Invalid or expired OTP', 400);

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash }
      }),
      prisma.otpCode.update({
        where: { id: otpRecord.id },
        data: { isUsed: true }
      }),
      // Revoke all refresh tokens
      prisma.refreshToken.updateMany({
        where: { userId: user.id },
        data: { isRevoked: true }
      })
    ]);

    return successResponse(res, null, 'Password reset successfully');
  } catch (error) {
    next(error);
  }
}

async function getMe(req, res, next) {
  try {
    // REQ-18.3: Check Redis cache before querying DB (60s TTL)
    const cached = await getGetMeCache(req.user.id);
    if (cached) {
      return successResponse(res, cached, 'Profile fetched');
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        school: { select: { id: true, name: true, slug: true, logoUrl: true } },
        student: { select: { id: true, studentId: true, qrCode: true } },
        teacher: { select: { id: true, employeeId: true, department: true } },
        guardian: { select: { id: true, relationship: true } },
        // Education domain: school-scoped memberships
        // This is the authoritative source for which schools the user belongs to
        // and what role they have in each school.
        // MOBILE NOTE: The mobile app should read schoolMemberships[] from this
        // response to determine Education navigation, not user.role directly.
        // user.role is kept for backward compatibility but schoolMemberships is
        // the correct source for school-scoped authorization.
        schoolMemberships: {
          where: { status: 'ACTIVE', deletedAt: null },
          include: {
            school: {
              select: { id: true, name: true, slug: true, logoUrl: true, type: true }
            }
          },
          orderBy: { joinedAt: 'asc' }
        }
      }
    });

    const { passwordHash, ...userWithoutPassword } = user;

    // REQ-18.3: Store result in Redis with 60s TTL
    await setGetMeCache(req.user.id, userWithoutPassword);

    return successResponse(res, userWithoutPassword, 'Profile fetched');
  } catch (error) {
    next(error);
  }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) return errorResponse(res, 'Current password is incorrect', 400);

    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Atomically update password AND revoke all existing refresh tokens
    // so any stolen sessions are immediately invalidated
    await prisma.$transaction([
      prisma.user.update({
        where: { id: req.user.id },
        data: {
          passwordHash,
          mustChangePassword: false  // Step 8: clear the force-reset flag on successful change
        }
      }),
      prisma.refreshToken.updateMany({
        where: { userId: req.user.id },
        data: { isRevoked: true }
      })
    ]);

    // Clear the refresh token cookie so this browser session also re-authenticates
    res.clearCookie('refreshToken');

    return successResponse(res, null, 'Password changed successfully. Please log in again.');
  } catch (error) {
    next(error);
  }
}

// REQ-18.4: Exported so profile-update routes can invalidate the getMe cache
async function deleteGetMeCache(userId) {
  try {
    const { isRedisReady, deleteCache } = require('../utils/redis');
    if (!isRedisReady()) return;
    await deleteCache(getMeCacheKey(userId));
  } catch {
    // Redis failure — cache will expire naturally after TTL
  }
}

module.exports = {
  register, login, refreshToken, logout,
  verifyEmail, forgotPassword, resetPassword,
  getMe, changePassword,
  deleteGetMeCache
};
