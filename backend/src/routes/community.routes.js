'use strict';
/**
 * Community Routes — Phase B-4 + Invite System
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

// COMM-P3-003 FIX: Rate limit community updates.
// updateCommunity emits community:updated to ALL room subscribers on every call.
// An ADMIN in a tight PATCH loop could flood all members' sockets.
// Limit: 20 updates per 10 minutes per user — generous for legitimate use,
// blocks sustained socket-flooding abuse.
const patchLimit = rateLimit({
  windowMs: 10 * 60 * 1000, max: 20,
  keyGenerator: req => req.user?.id || req.ip,
  message: { success: false, message: 'Too many community updates, slow down' }
});

// Rate limit invite creation: 20 per admin per hour
const inviteLimit = rateLimit({
  windowMs: 60 * 60 * 1000, max: 20,
  keyGenerator: req => (req.user?.id || req.ip) + ':invite',
  message: { success: false, message: 'Too many invites sent, slow down' }
});

router.use(authenticate);

// ─── SUPER_ADMIN content-action guard ────────────────────────────────────────
// SUPER_ADMIN = Platform Administration ONLY.
// Cannot create/join communities as a content participant.
// SUPER_ADMIN CAN delete communities (platform-level emergency removal — see community.controller.js).
function denyIfSuperAdmin(req, res, next) {
  if (req.user?.role === 'SUPER_ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Platform administrators cannot create or join communities. Use the admin panel to manage content.'
    });
  }
  return next();
}

// ── Discovery ─────────────────────────────────────────────────────────────────
router.get('/',      ctrl.listCommunities);
router.get('/mine',  ctrl.getMyCommunities);

// ── Invite accept/decline (token-based, before /:idOrSlug to avoid conflict) ──
router.post('/invites/:token/accept',  ctrl.acceptInvite);
router.post('/invites/:token/decline', ctrl.declineInvite);

// ── CRUD ──────────────────────────────────────────────────────────────────────
router.post('/',
  denyIfSuperAdmin,   // SA-COMM-01: SUPER_ADMIN cannot create communities
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
  patchLimit,
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
router.post('/:idOrSlug/join',
  denyIfSuperAdmin,   // SA-COMM-02: SUPER_ADMIN cannot join communities as participant
  [body('message').optional().isString().isLength({ max: 500 })],
  validate,
  ctrl.joinCommunity
);
router.post('/:idOrSlug/leave', ctrl.leaveCommunity);

// ── Members ───────────────────────────────────────────────────────────────────
router.get('/:idOrSlug/members', ctrl.getMembers);

router.patch('/:idOrSlug/members/:userId/role',
  [body('role').isIn(['ADMIN','MODERATOR','MEMBER'])],
  validate,
  ctrl.updateMemberRole
);

router.delete('/:idOrSlug/members/:userId', ctrl.kickMember);

// ─── Moderation ───────────────────────────────────────────────────────────────
router.post('/:idOrSlug/members/:userId/ban',
  [body('reason').optional().isString().isLength({ max: 500 })],
  validate,
  ctrl.banMember
);
router.delete('/:idOrSlug/members/:userId/ban', ctrl.unbanMember);

// Get posts for moderation review (OWNER/ADMIN/MODERATOR only)
router.get('/:idOrSlug/pending-posts', ctrl.getPendingPosts);

// ── Community feed ────────────────────────────────────────────────────────────
router.get('/:idOrSlug/feed', ctrl.getCommunityFeed);

// ── Join requests (admin only) ───────────────────────────────────────────────
router.get('/:idOrSlug/join-requests', ctrl.getPendingJoinRequests);
router.post('/:idOrSlug/join-requests/:userId/accept', ctrl.acceptJoinRequest);
router.post('/:idOrSlug/join-requests/:userId/decline', ctrl.declineJoinRequest);

// ── Invites (admin only for create/list/revoke; token endpoints above) ────────
router.post('/:idOrSlug/invites',
  inviteLimit,
  [body('userId').notEmpty().isString()],
  validate,
  ctrl.createInvite
);
router.get('/:idOrSlug/invites',       ctrl.listInvites);
router.delete('/:idOrSlug/invites/:inviteId', ctrl.revokeInvite);

// ── Community media ───────────────────────────────────────────────────────────
router.get('/:idOrSlug/media', ctrl.getCommunityMedia);

module.exports = router;
