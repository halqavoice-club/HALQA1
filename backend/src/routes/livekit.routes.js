const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const { generateToken } = require('../controllers/livekit.controller');

// All LiveKit routes require a valid app JWT
router.use(authenticate);

/**
 * POST /livekit/token
 *
 * Generic token endpoint — no room/participant DB checks.
 * Useful for testing, external integrations, or custom room flows.
 *
 * Body:
 *   roomId      {string}  required — LiveKit room name
 *   canPublish  {boolean} optional — default true
 *   canSubscribe{boolean} optional — default true
 *
 * The caller's userId and display name come from req.user (set by authenticate).
 */
router.post(
  '/token',
  [
    body('roomId')
      .trim()
      .notEmpty()
      .withMessage('roomId is required')
      .isLength({ max: 128 })
      .withMessage('roomId too long'),
    body('canPublish')
      .optional()
      .isBoolean()
      .withMessage('canPublish must be boolean'),
    body('canSubscribe')
      .optional()
      .isBoolean()
      .withMessage('canSubscribe must be boolean'),
  ],
  validate,
  generateToken
);

module.exports = router;
