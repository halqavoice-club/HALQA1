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

// ─── User posts ───────────────────────────────────────────────────────────────
router.get('/user/:userId', ctrl.getUserPosts);

// ─── CRUD ─────────────────────────────────────────────────────────────────────
router.post('/',
  createLimit,
  [
    body('body').optional().isString().isLength({ max: 5000 }),
    body('type').optional().isString(),
    body('visibility').optional().isIn(['PUBLIC','FOLLOWERS','PRIVATE','SCHOOL_ONLY']),
    body('media').optional().isArray(),
    body('isDraft').optional().isBoolean(),
    body('scheduledAt').optional().isISO8601(),
    body('location').optional().isString().isLength({ max: 120 }),
  ],
  validate,
  ctrl.createPost
);

router.get('/:id',   ctrl.getPost);

router.patch('/:id',
  [
    body('body').optional().isString().isLength({ max: 5000 }),
    body('visibility').optional().isIn(['PUBLIC','FOLLOWERS','PRIVATE','SCHOOL_ONLY']),
    body('location').optional().isString().isLength({ max: 120 }),
  ],
  validate,
  ctrl.updatePost
);

router.delete('/:id', ctrl.deletePost);

// ─── Reactions ────────────────────────────────────────────────────────────────
router.post('/:id/react',
  [body('type').optional().isIn(['LIKE','LOVE','CELEBRATE','SUPPORT','INSIGHTFUL','FUNNY'])],
  validate,
  ctrl.reactToPost
);
router.get('/:id/reactions', ctrl.getReactions);

// ─── Comments ─────────────────────────────────────────────────────────────────
router.get('/:id/comments', ctrl.getComments);
router.post('/:id/comments',
  commentLimit,
  [body('body').trim().notEmpty().withMessage('Comment body required')],
  validate,
  ctrl.addComment
);
router.patch('/:id/comments/:commentId',
  [body('body').trim().notEmpty()],
  validate,
  ctrl.editComment
);
router.delete('/:id/comments/:commentId', ctrl.deleteComment);
router.post('/:id/comments/:commentId/react',
  [body('type').optional().isIn(['LIKE','LOVE','CELEBRATE','SUPPORT','INSIGHTFUL','FUNNY'])],
  validate,
  ctrl.reactToComment
);

// ─── Bookmark ─────────────────────────────────────────────────────────────────
router.post('/:id/bookmark', ctrl.toggleBookmark);

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

module.exports = router;
