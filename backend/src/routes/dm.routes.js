const router = require('express').Router();
const { body, query } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const {
  getConversations, getOrStartConversation,
  getMessages, sendMessage, markRead, deleteMessage, editMessage,
  reactToMessage, searchMessages, getUnreadCount
} = require('../controllers/dm.controller');

router.use(authenticate);

router.get('/unread-count',                    getUnreadCount);
router.get('/conversations',                   getConversations);
router.get('/conversations/:userId/with',      getOrStartConversation);

router.get('/conversations/:convId/messages',
  [
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('before').optional().isISO8601().withMessage('before must be a valid ISO date'),
  ],
  validate,
  getMessages
);

router.post('/conversations/:convId/messages',
  [
    // { nullable: true } so that body:null (sent by VOICE_ROOM_SHARE when user adds no note)
    // is treated as absent rather than failing isString().
    body('body').optional({ nullable: true }).isString().isLength({ max: 5000 }).withMessage('Message too long (max 5000 chars)'),
    body('msgType').optional().isIn(['TEXT', 'IMAGE', 'VIDEO', 'GIF', 'VOICE', 'AUDIO', 'FILE', 'VOICE_ROOM_SHARE', 'LIVE_CLASS_SHARE'])
      .withMessage('Invalid msgType'),
    body('mediaUrl').optional().isString().isLength({ min: 1, max: 2048 }).withMessage('Invalid mediaUrl'),
    body('mimeType').optional().isString().isLength({ max: 128 }),
    body('fileSize').optional().isInt({ min: 1, max: 52428800 }).withMessage('fileSize must be 1–50MB in bytes'),
    body('fileName').optional().isString().isLength({ max: 255 }),
    body('duration').optional().isInt({ min: 1 }),
    body('width').optional().isInt({ min: 1 }),
    body('height').optional().isInt({ min: 1 }),
    body('thumbnail').optional().isString().isLength({ max: 2048 }),
    body('replyToId').optional().isUUID().withMessage('replyToId must be a valid UUID'),
    // Phase 5: structured entity reference fields (VOICE_ROOM_SHARE)
    body('refEntityType').optional({ nullable: true }).isString().isLength({ max: 50 }),
    body('refEntityId').optional({ nullable: true }).isString().isLength({ max: 36 }),
  ],
  validate,
  sendMessage
);

router.patch('/conversations/:convId/read',    markRead);
router.delete('/messages/:msgId',              deleteMessage);

router.patch('/messages/:msgId',
  [body('body').trim().notEmpty().withMessage('Message body required')],
  validate,
  editMessage
);

router.post('/messages/:msgId/reactions',
  [body('emoji').trim().notEmpty().withMessage('Emoji required')],
  validate,
  reactToMessage
);

router.get('/conversations/:convId/search',
  [query('q').trim().notEmpty().withMessage('Query required')],
  validate,
  searchMessages
);

module.exports = router;
