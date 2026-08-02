const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const { authLimiter, refreshLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { strictLimiter } = require('../middleware/rateLimiter.user');
const { strictDeviceLimiter } = require('../middleware/rateLimiter.device');
const { trackSession, validateSession, enforceSessionLimit, getSessions, terminateSession, terminateAllSessions } = require('../middleware/session.middleware');
const ctrl = require('../controllers/auth.controller');

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication endpoints
 */

// ─── Password complexity validator (reusable) ────────────────────────────────
// SEC-003: Enforces minimum security requirements on all password fields.
// Rules: 8+ chars, at least 1 uppercase letter, at least 1 digit.
// Applied to: register, reset-password, change-password.
// Error message is intentionally generic (no enumeration of which rule failed).
const passwordComplexity = (fieldName = 'password') =>
  body(fieldName)
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number');

router.post('/register',
  authLimiter,
  strictDeviceLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    passwordComplexity('password'),
    body('firstName').trim().notEmpty().isLength({ max: 100 }),
    body('lastName').trim().notEmpty().isLength({ max: 100 })
    // NOTE: 'role' is intentionally NOT accepted here. Self-registered users
    // are always STUDENT. Admins assign roles via school management endpoints.
  ],
  validate,
  ctrl.register
);

router.post('/login',
  authLimiter,
  strictDeviceLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
  ],
  validate,
  enforceSessionLimit,
  ctrl.login
);

// SECURITY FIX: refreshLimiter added — previously this endpoint had NO rate limit.
// An attacker with a stolen refresh token could hammer it indefinitely.
router.post('/refresh', refreshLimiter, ctrl.refreshToken);
router.post('/logout', authenticate, ctrl.logout);

router.post('/verify-email',
  otpLimiter,
  strictDeviceLimiter,
  [body('email').isEmail(), body('otp').isLength({ min: 6, max: 6 })],
  validate,
  ctrl.verifyEmail
);

router.post('/forgot-password',
  authLimiter,
  strictDeviceLimiter,
  [body('email').isEmail().normalizeEmail()],
  validate,
  ctrl.forgotPassword
);

router.post('/reset-password',
  otpLimiter,
  strictDeviceLimiter,
  [
    body('email').isEmail(),
    body('otp').isLength({ min: 6, max: 6 }),
    passwordComplexity('newPassword')
  ],
  validate,
  ctrl.resetPassword
);

router.get('/me', authenticate, ctrl.getMe);

router.put('/change-password',
  authenticate,
  strictLimiter,
  [
    body('currentPassword').notEmpty(),
    passwordComplexity('newPassword')
  ],
  validate,
  ctrl.changePassword
);

// ─── Session management endpoints ────────────────────────────────────────────
router.get('/sessions', authenticate, getSessions);
router.delete('/sessions/all', authenticate, terminateAllSessions);
router.delete('/sessions/:id', authenticate, terminateSession);

module.exports = router;
