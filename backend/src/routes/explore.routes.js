'use strict';
/**
 * Explore Routes — Phase B-5: Global Discovery
 * Mounted at /api/v1/explore  (new file — does not modify any existing route)
 */
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/explore.controller');

router.use(authenticate);

// CF-04 FIX: Rate limit search to prevent scraping/enumeration abuse.
const searchLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: req => req.user?.id || req.ip,
  message: { success: false, message: 'Too many search requests. Please wait before searching again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Aggregated explore feed (trending posts + hashtags + communities + people + live rooms)
router.get('/', ctrl.getExploreFeed);

// Unified search across all content types
router.get('/search', searchLimit, ctrl.globalSearch);

// Hashtag feed
router.get('/hashtag/:tag', ctrl.getHashtagFeed);

module.exports = router;
