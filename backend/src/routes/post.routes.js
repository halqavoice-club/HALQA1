'use strict';
/**
 * Post Routes — Social Feed (Phase B-1)
 * New file — does NOT modify any existing route file.
 * Mounted in app.js at /api/v1/posts (additive only).
 */
const router = require('express').Router();
const { body, query } = require('express-validator');
const validate     = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const rateLimit    = require('express-rate-limit');
const ctrl         = require('../controllers/post.controller');
const {
  blockSuperAdminFromSocialEdit,
  blockEducationRolesFromSocialMutation,
} = require('../middleware/socialOwnership.middleware');

// ─── SUPER_ADMIN content-action guard ────────────────────────────────────────
// SUPER_ADMIN = Platform Administration ONLY.
// They must NOT create posts, comments, reactions, stories, or bookmarks.
// They CAN read feed (for moderation oversight) and delete posts (platform admin).
function denyIfSuperAdmin(req, res, next) {
  if (req.user?.role === 'SUPER_ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Platform administrators cannot create social content. Use the admin panel for moderation.'
    });
  }
  return next();
}

// ─── Rate limiters ────────────────────────────────────────────────────────────
const createLimit = rateLimit({
  windowMs: 60 * 1000, max: 20,
  keyGenerator: req => req.user?.id || req.ip,
  message: { success: false, message: 'Too many posts, slow down' }
});
const commentLimit = rateLimit({
  windowMs: 60 * 1000, max: 30,
  keyGenerator: req => req.user?.id || req.ip,
  message: { success: false, message: 'Too many comments, slow down' }
});

router.use(authenticate);

// ─── Feed ─────────────────────────────────────────────────────────────────────
router.get('/feed',     ctrl.getFeed);
router.get('/live',     ctrl.getLiveSessions);  // currently active live rooms/classes
router.get('/trending', ctrl.getTrendingHashtags);
router.get('/search',   ctrl.searchPosts);
router.get('/reels',    ctrl.getReels);          // TikTok-style video feed

// ─── User posts ───────────────────────────────────────────────────────────────
router.get('/user/:userId', ctrl.getUserPosts);

// ─── CRUD ─────────────────────────────────────────────────────────────────────
const { filterMiddleware: postFilter } = require('../utils/contentFilter');

router.post('/',
  denyIfSuperAdmin,   // SA-FEED-01: SUPER_ADMIN cannot create posts
  createLimit,
  [
    // { nullable: true } so that body:null (sent by LIVE_ROOM_SHARE / LIVE_CLASS_SHARE
    // when the user adds no note) is treated as absent rather than failing isString().
    body('body').optional({ nullable: true }).isString().isLength({ max: 5000 }),
    body('type').optional().isString(),
    body('visibility').optional().isIn(['PUBLIC','FOLLOWERS','PRIVATE','SCHOOL_ONLY']),
    body('media').optional().isArray(),
    body('isDraft').optional().isBoolean(),
    body('scheduledAt').optional().isISO8601(),
    body('location').optional({ nullable: true }).isString().isLength({ max: 120 }),
  ],
  validate,
  postFilter('body', 'post'),
  ctrl.createPost
);

router.get('/:id',   ctrl.getPost);

router.patch('/:id',
  // SOCIAL-EDIT-01: Only the post author can edit their own post.
  // SUPER_ADMIN may delete posts for moderation but CANNOT edit the content.
  // SCHOOL_ADMIN and TEACHER have no authority over social content.
  blockSuperAdminFromSocialEdit,
  blockEducationRolesFromSocialMutation,
  [
    body('body').optional().isString().isLength({ max: 5000 }),
    body('visibility').optional().isIn(['PUBLIC','FOLLOWERS','PRIVATE','SCHOOL_ONLY']),
    body('location').optional().isString().isLength({ max: 120 }),
  ],
  validate,
  ctrl.updatePost
);

router.delete('/:id',
  // SOCIAL-DELETE-01: Only post author or SUPER_ADMIN (platform moderation) may delete.
  // SCHOOL_ADMIN and TEACHER explicitly blocked — enforced in controller too.
  blockEducationRolesFromSocialMutation,
  ctrl.deletePost
);

// ─── Reactions ────────────────────────────────────────────────────────────────
router.post('/:id/react',
  denyIfSuperAdmin,   // SA-FEED-02: SUPER_ADMIN cannot react to posts
  [body('type').optional().isIn(['LIKE','LOVE','CELEBRATE','SUPPORT','INSIGHTFUL','FUNNY'])],
  validate,
  ctrl.reactToPost
);
router.get('/:id/reactions', ctrl.getReactions);

// ─── Comments ─────────────────────────────────────────────────────────────────
router.get('/:id/comments', ctrl.getComments);
router.post('/:id/comments',
  denyIfSuperAdmin,   // SA-FEED-03: SUPER_ADMIN cannot post comments
  commentLimit,
  [body('body').trim().notEmpty().withMessage('Comment body required')],
  validate,
  ctrl.addComment
);
router.patch('/:id/comments/:commentId',
  // SOCIAL-EDIT-02: Only the comment author can edit their own comment.
  blockSuperAdminFromSocialEdit,
  blockEducationRolesFromSocialMutation,
  denyIfSuperAdmin,   // SA-FEED-04: SUPER_ADMIN cannot edit comments
  [body('body').trim().notEmpty()],
  validate,
  ctrl.editComment
);
router.delete('/:id/comments/:commentId', ctrl.deleteComment);
router.post('/:id/comments/:commentId/react',
  denyIfSuperAdmin,   // SA-FEED-05: SUPER_ADMIN cannot react to comments
  [body('type').optional().isIn(['LIKE','LOVE','CELEBRATE','SUPPORT','INSIGHTFUL','FUNNY'])],
  validate,
  ctrl.reactToComment
);

// ─── Bookmark ─────────────────────────────────────────────────────────────────
router.post('/:id/bookmark',
  denyIfSuperAdmin,   // SA-FEED-06: SUPER_ADMIN cannot bookmark posts
  ctrl.toggleBookmark
);

// ─── View (feed impression tracking) ──────────────────────────────────────────
// Rate-limited to 1 view per user per post per 60 seconds to prevent abuse.
const viewLimit = rateLimit({
  windowMs: 60 * 1000, max: 200,
  keyGenerator: req => `${req.user?.id || req.ip}:view`,
  message: { success: false, message: 'Too many view events' },
  standardHeaders: false, legacyHeaders: false,
});
router.post('/:id/view', viewLimit, ctrl.recordView);

// ─── Pin ──────────────────────────────────────────────────────────────────────
router.post('/:id/pin', ctrl.pinPost);

// ─── Report ───────────────────────────────────────────────────────────────────
router.post('/:id/report',
  [body('reason').notEmpty()],
  validate,
  ctrl.reportPost
);

// ─── Poll vote ────────────────────────────────────────────────────────────────
router.post('/:id/poll/vote',
  [body('optionId').notEmpty().withMessage('optionId required')],
  validate,
  ctrl.votePoll
);

// ─── Link preview scrape ──────────────────────────────────────────────────────
// GET /api/v1/posts/link-preview?url=https://...
// Scrapes OG / meta tags from the given URL. Rate-limited. No auth required beyond session.
const previewLimit = rateLimit({
  windowMs: 60 * 1000, max: 30,
  keyGenerator: req => req.user?.id || req.ip,
  message: { success: false, message: 'Too many preview requests' },
});
router.get('/link-preview', previewLimit, ctrl.getLinkPreview);

module.exports = router;
