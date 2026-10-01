/**
 * Group Chat Routes
 */

const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const groupChatController = require('../controllers/groupChat.controller');

router.use(authenticate);

// ── Conversations ─────────────────────────────────────────────────────────────

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

router.get('/conversations',        groupChatController.getUserGroupConversations);
router.get('/unread-count',         groupChatController.getGroupUnreadCount);
router.get('/conversations/:id',    groupChatController.getGroupConversation);

router.patch(
  '/conversations/:id',
  [
    body('name').optional().trim().notEmpty().isLength({ max: 100 }),
    body('description').optional().isLength({ max: 500 }),
    body('privacy').optional().isIn(['PUBLIC', 'PRIVATE', 'SCHOOL_ONLY', 'CLASS_ONLY']),
    body('maxMembers').optional().isInt({ min: 2, max: 1000 }),
    body('avatarUrl').optional().isString().isLength({ max: 2048 }),
  ],
  validate,
  groupChatController.updateGroupConversation
);

router.delete('/conversations/:id', groupChatController.deleteGroupConversation);

// ── Members ───────────────────────────────────────────────────────────────────

router.post(
  '/conversations/:conversationId/members',
  [body('userId').notEmpty().withMessage('userId is required')],
  validate,
  groupChatController.addGroupMember
);

router.delete(
  '/conversations/:conversationId/members/:userId',
  groupChatController.removeGroupMember
);

router.patch(
  '/conversations/:conversationId/members/:userId/role',
  [body('role').isIn(['ADMIN', 'MEMBER', 'OWNER']).withMessage('Role must be ADMIN, MEMBER, or OWNER')],
  validate,
  groupChatController.updateMemberRole
);

router.patch(
  '/conversations/:conversationId/permissions',
  [
    body('onlyAdminsCanSendMessages').optional().isBoolean(),
    body('onlyAdminsCanSendMedia').optional().isBoolean(),
  ],
  validate,
  groupChatController.updateGroupPermissions
);

// ── Messages ──────────────────────────────────────────────────────────────────

const { filterMiddleware } = require('../utils/contentFilter');

router.post(
  '/conversations/:conversationId/messages',
  [
    // { nullable: true } so that body:null (sent by VOICE_ROOM_SHARE when user adds no note)
    // is treated as absent rather than failing isString().
    body('body').optional({ nullable: true }).isString().isLength({ max: 4000 }),
    body('type').optional().isIn(['TEXT', 'IMAGE', 'VIDEO', 'GIF', 'AUDIO', 'VOICE', 'FILE', 'DOCUMENT', 'POLL', 'SYSTEM', 'VOICE_ROOM_SHARE', 'LIVE_CLASS_SHARE']),
    body('mediaUrl').optional().isString().isLength({ min: 1, max: 2048 }).withMessage('Invalid mediaUrl'),
    body('mimeType').optional().isString().isLength({ max: 128 }),
    body('fileSize').optional().isInt({ min: 1, max: 52428800 }),
    body('fileName').optional().isString().isLength({ max: 255 }),
    body('duration').optional().isInt({ min: 1 }),
    body('replyToId').optional().isUUID(),
    // Phase 5: structured entity reference fields (VOICE_ROOM_SHARE)
    body('refEntityType').optional({ nullable: true }).isString().isLength({ max: 50 }),
    body('refEntityId').optional({ nullable: true }).isString().isLength({ max: 36 }),
  ],
  validate,
  filterMiddleware('body', 'group-chat'),
  groupChatController.sendGroupMessage
);

router.get(
  '/conversations/:conversationId/messages',
  [
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('before').optional().isISO8601(),
  ],
  validate,
  groupChatController.getGroupMessages
);

router.get(
  '/conversations/:conversationId/search',
  [query('q').trim().notEmpty().withMessage('Query required')],
  validate,
  groupChatController.searchGroupMessages
);

router.post(
  '/conversations/:conversationId/read',
  [body('messageIds').isArray({ min: 1 }).withMessage('messageIds must be a non-empty array')],
  validate,
  groupChatController.markMessagesAsRead
);

router.post(
  '/messages/:messageId/reactions',
  [body('type').trim().notEmpty().withMessage('Reaction type is required').isLength({ max: 10 })],
  validate,
  groupChatController.addMessageReaction
);

router.patch(
  '/messages/:messageId',
  [body('body').trim().notEmpty().withMessage('Body required').isLength({ max: 4000 })],
  validate,
  groupChatController.editGroupMessage
);

router.delete('/messages/:messageId', groupChatController.deleteGroupMessage);

router.post(
  '/conversations/:conversationId/messages/:messageId/pin',
  [body('pin').optional().isBoolean()],
  validate,
  groupChatController.pinGroupMessage
);

module.exports = router;
