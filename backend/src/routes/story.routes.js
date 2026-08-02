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

const createLimit = rateLimit({
  windowMs: 60 * 60 * 1000, max: 30,   // 30 stories per hour
  keyGenerator: req => req.user?.id || req.ip,
  message: { success: false, message: 'Too many stories, slow down' }
});

router.use(authenticate);

// Feed: stories from followed users (grouped by author)
router.get('/feed', ctrl.getStoriesFeed);

// User stories
router.get('/user/:userId', ctrl.getUserStories);

// Create
router.post('/',
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

// View (mark as seen)
router.post('/:id/view', ctrl.viewStory);

// Viewers list (author only)
router.get('/:id/viewers', ctrl.getStoryViewers);

// React
router.post('/:id/react',
  [body('type').optional().isString().isLength({ max: 10 })],
  validate,
  ctrl.reactToStory
);

// Delete
router.delete('/:id', ctrl.deleteStory);

module.exports = router;
