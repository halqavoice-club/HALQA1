const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/message.controller');

router.use(authenticate);

router.post('/',
  [
    body('recipientIds').isArray({ min: 1 }),
    body('body').notEmpty()
  ],
  validate,
  ctrl.sendMessage
);

router.get('/inbox', ctrl.getInbox);
router.get('/sent', ctrl.getSentMessages);
router.get('/unread-count', ctrl.getUnreadCount);
router.get('/:id', ctrl.getMessage);
router.put('/:id/read', ctrl.markAsRead);
router.delete('/:id', ctrl.deleteMessage);

module.exports = router;
