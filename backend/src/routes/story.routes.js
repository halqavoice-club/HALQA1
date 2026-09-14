'use strict';
/**
 * Story Routes — Phase B-3
 * Mounted at /api/v1/stories  (new file — does not modify any existing route)
 */
const router = require('express').Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const validate  = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/story.controller');
const {
  blockSuperAdminFromSocialEdit,
  blockEducationRolesFromSocialMutation,
} = require('../middleware/socialOwnership.middleware');

const createLimit = rateLimit({
  windowMs: 60 * 60 * 1000, max: 30,   // 30 stories per hour
  keyGenerator: req => req.user?.id || req.ip,
  message: { success: false, message: 'Too many stories, slow down' }
});

router.use(authenticate);

// ─── SUPER_ADMIN content-action guard ────────────────────────────────────────
// SUPER_ADMIN = Platform Administration ONLY. Cannot create stories.
function denyIfSuperAdmin(req, res, next) {
  if (req.user?.role === 'SUPER_ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Platform administrators cannot create social content.'
    });
  }
  return next();
}

// Feed: stories from followed users (grouped by author)
router.get('/feed', ctrl.getStoriesFeed);

// User stories
router.get('/user/:userId', ctrl.getUserStories);

// Create — self only
router.post('/',
  denyIfSuperAdmin,   // SA-STORY-01: SUPER_ADMIN cannot create stories
  blockEducationRolesFromSocialMutation,
  createLimit,
  [
    body('type').optional().isIn(['IMAGE','VIDEO','TEXT']),
    body('mediaUrl').optional().isString(),
    body('text').optional().isString().isLength({ max: 500 }),
    body('caption').optional().isString().isLength({ max: 280 }),
    body('duration').optional().isInt({ min: 1, max: 15 }),
    body('bgColor').optional().isString(),
    body('textColor').optional().isString(),
  ],
  validate,
  ctrl.createStory
);

// View (mark as seen) — any authenticated user
router.post('/:id/view', ctrl.viewStory);

// Viewers list (author only — enforced in controller)
router.get('/:id/viewers', ctrl.getStoryViewers);

// React — self only; blocked for education roles and SUPER_ADMIN
// SA-STORY-02: SUPER_ADMIN should not react to user content (platform admin ≠ social participant)
router.post('/:id/react',
  denyIfSuperAdmin,
  blockEducationRolesFromSocialMutation,
  [body('type').optional().isString().isLength({ max: 10 })],
  validate,
  ctrl.reactToStory
);

// Delete — owner only (SUPER_ADMIN emergency moderation allowed; enforced in controller)
// SCHOOL_ADMIN and TEACHER cannot delete another user's story.
router.delete('/:id',
  blockEducationRolesFromSocialMutation,
  ctrl.deleteStory
);

module.exports = router;
