'use strict';
/**
 * Community Routes — Phase B-4
 * Mounted at /api/v1/communities
 */
const router = require('express').Router();
const { body, query } = require('express-validator');
const rateLimit = require('express-rate-limit');
const validate  = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/community.controller');

const createLimit = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10,
  keyGenerator: req => req.user?.id || req.ip,
  message: { success: false, message: 'Too many communities created, slow down' }
});

router.use(authenticate);

// ── Discovery ─────────────────────────────────────────────────────────────────
router.get('/',      ctrl.listCommunities);
router.get('/mine',  ctrl.getMyCommunities);

// ── CRUD ──────────────────────────────────────────────────────────────────────
router.post('/',
  createLimit,
  [
    body('name').trim().notEmpty().isLength({ max: 120 }),
    body('description').optional().isString().isLength({ max: 2000 }),
    body('privacy').optional().isIn(['PUBLIC','PRIVATE','INVITE_ONLY']),
    body('category').optional().isString(),
    body('rules').optional().isString().isLength({ max: 5000 }),
  ],
  validate,
  ctrl.createCommunity
);

router.get('/:idOrSlug',    ctrl.getCommunity);

router.patch('/:idOrSlug',
  [
    body('name').optional().trim().notEmpty().isLength({ max: 120 }),
    body('privacy').optional().isIn(['PUBLIC','PRIVATE','INVITE_ONLY']),
    body('category').optional().isString(),
  ],
  validate,
  ctrl.updateCommunity
);

router.delete('/:idOrSlug', ctrl.deleteCommunity);

// ── Membership ────────────────────────────────────────────────────────────────
router.post('/:idOrSlug/join',  ctrl.joinCommunity);
router.post('/:idOrSlug/leave', ctrl.leaveCommunity);

// ── Members ───────────────────────────────────────────────────────────────────
router.get('/:idOrSlug/members', ctrl.getMembers);

router.patch('/:idOrSlug/members/:userId/role',
  [body('role').isIn(['ADMIN','MODERATOR','MEMBER'])],
  validate,
  ctrl.updateMemberRole
);

router.delete('/:idOrSlug/members/:userId', ctrl.kickMember);

// ─── Moderation (L7 fix) ──────────────────────────────────────────────────────
// Ban a member (kick + prevent re-join)
router.post('/:idOrSlug/members/:userId/ban',
  [body('reason').optional().isString().isLength({ max: 500 })],
  validate,
  ctrl.banMember
);

// Get posts for moderation review (OWNER/ADMIN/MODERATOR only)
router.get('/:idOrSlug/pending-posts', ctrl.getPendingPosts);

// ── Community feed ────────────────────────────────────────────────────────────
router.get('/:idOrSlug/feed', ctrl.getCommunityFeed);

// ── Join requests (admin only) ───────────────────────────────────────────────
router.get('/:idOrSlug/join-requests', ctrl.getPendingJoinRequests);
router.post('/:idOrSlug/join-requests/:userId/accept', ctrl.acceptJoinRequest);
router.post('/:idOrSlug/join-requests/:userId/decline', ctrl.declineJoinRequest);

// ── Community media ───────────────────────────────────────────────────────────
router.get('/:idOrSlug/media', ctrl.getCommunityMedia);

module.exports = router;
