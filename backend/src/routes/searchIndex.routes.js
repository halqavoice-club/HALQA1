/**
 * Search Index Routes
 * 
 * API endpoints for search index management (Phase C)
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const searchController = require('../controllers/search.controller');

// All routes require authentication
router.use(authenticate);

/**
 * @route   POST /api/v1/search-index
 * @desc    Index an entity for search
 * @access  Private (admin only)
 */
router.post('/', searchController.indexEntity);

/**
 * @route   DELETE /api/v1/search-index/:entityType/:entityId
 * @desc    Remove entity from search index
 * @access  Private (admin only)
 */
router.delete('/:entityType/:entityId', searchController.removeEntityFromIndex);

/**
 * @route   GET /api/v1/search-index/search
 * @desc    Search entities
 * @access  Private
 */
router.get('/search', searchController.searchEntities);

/**
 * @route   GET /api/v1/search-index/trending
 * @desc    Get trending hashtags
 * @access  Private
 */
router.get('/trending', searchController.getTrendingHashtags);

/**
 * @route   POST /api/v1/search-index/hashtags/:hashtag
 * @desc    Update hashtag count
 * @access  Private (system use)
 */
router.post('/hashtags/:hashtag', searchController.updateHashtagCount);

/**
 * @route   POST /api/v1/search-index/recalculate
 * @desc    Recalculate trending hashtags
 * @access  Private (admin only)
 */
router.post('/recalculate', searchController.recalculateTrendingHashtags);

/**
 * @route   GET /api/v1/search-index/stats
 * @desc    Get search index stats
 * @access  Private (admin only)
 */
router.get('/stats', searchController.getSearchIndexStats);

module.exports = router;
