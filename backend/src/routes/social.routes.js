const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const rateLimit = require('express-rate-limit');
const {
  followUser, unfollowUser, getFollowers, getFollowing, getSocialCounts,
  sendFriendRequest, acceptFriendRequest, rejectFriendRequest, removeFriend,
  cancelFriendRequest, getFriends, getIncomingRequests, getSentRequests, searchUsers
} = require('../controllers/social.controller');
const {
  reportUser, listReports, reviewReport,
  blockUser, unblockUser, getBlockedUsers, getBlockStatus,
} = require('../controllers/report-block.controller');
const { body } = require('express-validator');
const validate = require('../middleware/validate');

// ── Rate limiters ─────────────────────────────────────────────────────────────
// Follow/unfollow: 30 per minute
const followLimit = rateLimit({
  windowMs: 60 * 1000, max: 30,
  keyGenerator: req => req.user?.id || req.ip,
  message: { success: false, message: 'Too many follow actions, slow down' }
});
// Friend requests: 20 per minute
const friendLimit = rateLimit({
  windowMs: 60 * 1000, max: 20,
  keyGenerator: req => req.user?.id || req.ip,
  message: { success: false, message: 'Too many friend requests, slow down' }
});
// Reports: 10 per hour (anti-spam)
const reportLimit = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10,
  keyGenerator: req => req.user?.id || req.ip,
  message: { success: false, message: 'Too many reports, slow down' }
});

router.use(authenticate);

// ── Search ────────────────────────────────────────────────────────────────────
router.get('/search', searchUsers);

// ── Follow ────────────────────────────────────────────────────────────────────
router.post('/follow/:userId',    followLimit, followUser);
router.delete('/follow/:userId',  followLimit, unfollowUser);
router.get('/followers/:userId',  getFollowers);
router.get('/following/:userId',  getFollowing);
router.get('/counts/:userId',     getSocialCounts);

// ── Friends ───────────────────────────────────────────────────────────────────
router.get('/friends',                    getFriends);
router.get('/friends/requests',           getIncomingRequests);
router.get('/friends/requests/sent',      getSentRequests);
router.post('/friends/request/:userId',   friendLimit, sendFriendRequest);
router.post('/friends/accept/:userId',    acceptFriendRequest);
router.post('/friends/reject/:userId',    rejectFriendRequest);
router.delete('/friends/request/:userId', cancelFriendRequest);   // cancel own sent request
router.delete('/friends/:userId',         removeFriend);

// ── Report ────────────────────────────────────────────────────────────────────
router.post('/report/:userId',
  reportLimit,
  [
    body('reason').notEmpty().withMessage('reason is required'),
    body('description').optional().isString().isLength({ max: 1000 }),
    body('roomId').optional().isString(),
  ],
  validate,
  reportUser
);

// Admin: list + review reports
// F-1 FIX: Social report moderation is a PLATFORM-LEVEL operation.
// SCHOOL_ADMIN should NOT have access to reports filed about users at other schools
// or social-only users (MEMBER). Only SUPER_ADMIN (HALQA platform admin) should
// moderate platform-wide social reports.
router.get('/reports',
  authorize('SUPER_ADMIN'),
  listReports
);
router.patch('/reports/:id/review',
  authorize('SUPER_ADMIN'),
  [body('status').notEmpty()],
  validate,
  reviewReport
);

// ── Block ─────────────────────────────────────────────────────────────────────
router.post('/block/:userId',      blockUser);
router.delete('/block/:userId',    unblockUser);
router.get('/blocked',             getBlockedUsers);
router.get('/block/:userId/status', getBlockStatus);

module.exports = router;
