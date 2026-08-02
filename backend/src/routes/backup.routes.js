/**
 * Backup Routes
 * 
 * API endpoints for backup metadata management
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const ipAllowlist = require('../middleware/ipAllowlist');
const backupController = require('../controllers/backup.controller');

// Restrict to IP allowlist before any other checks (Requirements: 10.1, 10.2)
router.use(ipAllowlist);

// All routes require authentication
router.use(authenticate);

/**
 * @route   POST /api/v1/backups
 * @desc    Create a backup metadata record
 * @access  Private (admin only)
 */
router.post('/', backupController.createBackup);

/**
 * @route   PUT /api/v1/backups/:id/status
 * @desc    Update backup status
 * @access  Private (admin only)
 */
router.put('/:id/status', backupController.updateBackupStatus);

/**
 * @route   GET /api/v1/backups
 * @desc    Get backups
 * @access  Private (admin only)
 */
router.get('/', backupController.getBackups);

/**
 * @route   GET /api/v1/backups/:id
 * @desc    Get a specific backup
 * @access  Private (admin only)
 */
router.get('/:id', backupController.getBackup);

/**
 * @route   DELETE /api/v1/backups/:id
 * @desc    Delete a backup record
 * @access  Private (admin only)
 */
router.delete('/:id', backupController.deleteBackup);

/**
 * @route   GET /api/v1/backups/stats
 * @desc    Get backup statistics
 * @access  Private (admin only)
 */
router.get('/stats', backupController.getBackupStats);

/**
 * @route   POST /api/v1/backups/prune
 * @desc    Prune old backups
 * @access  Private (admin only)
 */
router.post('/prune', backupController.pruneOldBackups);

module.exports = router;
