'use strict';
/**
 * Explore Routes — Phase B-5: Global Discovery
 * Mounted at /api/v1/explore  (new file — does not modify any existing route)
 */
const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/explore.controller');

router.use(authenticate);

// Aggregated explore feed (trending posts + hashtags + communities + people + live rooms)
router.get('/', ctrl.getExploreFeed);

// Unified search across all content types
router.get('/search', ctrl.globalSearch);

// Hashtag feed
router.get('/hashtag/:tag', ctrl.getHashtagFeed);

module.exports = router;
