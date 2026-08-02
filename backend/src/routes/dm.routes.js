const router = require('express').Router();
const { body, query } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const rateLimit = require('express-rate-limit');
const {
  getConversations, getOrStartConversation,
  getMessages, sendMessage, markRead, deleteMessage, getUnreadCount
} = require('../controllers/dm.controller');

// 60 messages per minute per user
const msgLimit = rateLimit({
  windowMs: 60 * 1000, max: 60,
  keyGenerator: req => req.user?.id || req.ip,
  message: { success: false, message: 'Slow down — too many messages' }
});

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
  msgLimit,
  [body('body').trim().notEmpty().withMessage('Message body required')],
  validate,
  sendMessage
);

router.patch('/conversations/:convId/read',    markRead);
router.delete('/messages/:msgId',              deleteMessage);

module.exports = router;
