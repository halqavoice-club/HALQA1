const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const { authLimiter, refreshLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { strictLimiter } = require('../middleware/rateLimiter.user');
const { strictDeviceLimiter } = require('../middleware/rateLimiter.device');
const { trackSession, validateSession, enforceSessionLimit, getSessions, terminateSession, terminateAllSessions } = require('../middleware/session.middleware');
const { csrfProtect } = require('../middleware/csrf');
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

// S4: CSRF Origin check on cookie-consuming endpoints (refresh + logout).
// The refreshToken cookie is httpOnly — JS can't read it, but the browser
// sends it automatically on cross-origin requests (sameSite=strict mitigates
// most cases, but Origin header check adds defense-in-depth).
router.post('/refresh', csrfProtect, refreshLimiter, ctrl.refreshToken);
router.post('/logout',  csrfProtect, authenticate,  ctrl.logout);

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

// ─── Two-Factor Authentication (2FA / TOTP) ──────────────────────────────────
// DB field `twoFactorEnabled` already exists in schema.
// Uses otplib (already installed) for RFC 6238 TOTP.
const tfCtrl = require('../controllers/twoFactor.controller');

// Setup — generates secret + QR URI (does not activate 2FA yet)
router.post('/2fa/setup',
  authenticate,
  strictLimiter,
  tfCtrl.setup2FA
);

// Verify first TOTP code to activate 2FA, returns one-time backup codes
router.post('/2fa/verify',
  authenticate,
  otpLimiter,
  [body('code').isLength({ min: 6, max: 6 }).withMessage('6-digit TOTP code required')],
  validate,
  tfCtrl.verify2FA
);

// Disable 2FA (requires current password)
router.post('/2fa/disable',
  authenticate,
  strictLimiter,
  [body('password').notEmpty()],
  validate,
  tfCtrl.disable2FA
);

// Complete login for 2FA-enabled accounts (step 2 after password check)
// C-1 FIX: challengeToken replaces userId — no client-supplied userId accepted
router.post('/2fa/authenticate',
  authLimiter,
  strictDeviceLimiter,
  [
    body('challengeToken').notEmpty().withMessage('challengeToken is required'),
    body('code').isLength({ min: 6, max: 6 }).withMessage('6-digit TOTP code required')
  ],
  validate,
  tfCtrl.authenticate2FA
);

// ─── Google Sign-In ───────────────────────────────────────────────────────────
// POST /api/v1/auth/google
// Accepts a Google ID token, verifies it server-side, finds/creates a HALQA user,
// and returns the same access+refresh token response as normal login.
// Rate limited by authLimiter. Role injection is impossible — Google users always
// get User.role = MEMBER regardless of any other fields in the request body.
const { googleSignIn } = require('../controllers/googleAuth.controller');
router.post('/google',
  authLimiter,
  strictDeviceLimiter,
  [
    // Only accept the credential field — anything else is silently ignored by the controller
    body('credential').notEmpty().withMessage('Google credential is required').isString()
  ],
  validate,
  enforceSessionLimit,
  googleSignIn
);

module.exports = router;
