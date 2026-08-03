/**
 * Group Chat Routes
 * 
 * API endpoints for group conversation management
 */

const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const rateLimit = require('express-rate-limit');
const groupChatController = require('../controllers/groupChat.controller');

// All routes require authentication
router.use(authenticate);

// 60 messages per minute per user
const msgLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: req => req.user?.id || req.ip,
  message: { success: false, message: 'Too many messages — slow down' },
});

/**
 * @route   POST /api/v1/group-chat/conversations
 */
router.post(
  '/conversations',
  [
    body('name').trim().notEmpty().withMessage('Group name is required').isLength({ max: 100 }),
    body('description').optional().isLength({ max: 500 }),
    body('privacy').optional().isIn(['PUBLIC', 'PRIVATE', 'SCHOOL_ONLY', 'CLASS_ONLY']),
    body('maxMembers').optional().isInt({ min: 2, max: 1000 }),
  ],
  validate,
  groupChatController.createGroupConversation
);

/**
 * @route   GET /api/v1/group-chat/conversations
 */
router.get('/conversations', groupChatController.getUserGroupConversations);

/**
 * @route   GET /api/v1/group-chat/conversations/:id
 */
router.get('/conversations/:id', groupChatController.getGroupConversation);

/**
 * @route   POST /api/v1/group-chat/conversations/:conversationId/members
 */
router.post(
  '/conversations/:conversationId/members',
  [body('userId').notEmpty().withMessage('userId is required')],
  validate,
  groupChatController.addGroupMember
);

/**
 * @route   DELETE /api/v1/group-chat/conversations/:conversationId/members/:userId
 */
router.delete(
  '/conversations/:conversationId/members/:userId',
  groupChatController.removeGroupMember
);

/**
 * @route   POST /api/v1/group-chat/conversations/:conversationId/messages
 */
const { filterMiddleware } = require('../utils/contentFilter');

router.post(
  '/conversations/:conversationId/messages',
  msgLimit,
  [
    body('body').optional().isString().isLength({ max: 4000 }),
    body('type').optional().isIn(['TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'POLL', 'SYSTEM']),
    body('mediaUrl').optional().isURL(),
    body('replyToId').optional().isUUID(),
  ],
  validate,
  filterMiddleware('body', 'group-chat'),
  groupChatController.sendGroupMessage
);

/**
 * @route   GET /api/v1/group-chat/conversations/:conversationId/messages
 */
router.get(
  '/conversations/:conversationId/messages',
  [
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('before').optional().isISO8601(),
  ],
  validate,
  groupChatController.getGroupMessages
);

/**
 * @route   POST /api/v1/group-chat/messages/:messageId/reactions
 */
router.post(
  '/messages/:messageId/reactions',
  [body('type').trim().notEmpty().withMessage('Reaction type is required').isLength({ max: 10 })],
  validate,
  groupChatController.addMessageReaction
);

/**
 * @route   POST /api/v1/group-chat/conversations/:conversationId/read
 */
router.post(
  '/conversations/:conversationId/read',
  [body('messageIds').isArray({ min: 1 }).withMessage('messageIds must be a non-empty array')],
  validate,
  groupChatController.markMessagesAsRead
);

/**
 * @route   DELETE /api/v1/group-chat/messages/:messageId
 */
router.delete('/messages/:messageId', groupChatController.deleteGroupMessage);

/**
 * @route   POST /api/v1/group-chat/conversations/:conversationId/messages/:messageId/pin
 */
router.post(
  '/conversations/:conversationId/messages/:messageId/pin',
  [body('pin').optional().isBoolean()],
  validate,
  groupChatController.pinGroupMessage
);

module.exports = router;
