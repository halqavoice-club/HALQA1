const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const multer = require('multer');
const ctrl = require('../controllers/live-class.controller');
const rateLimit = require('express-rate-limit');
const { sendGift, sendGiftToAll, getRoomLeaderboard, getRoomGiftHistory, getTopSupporters } = require('../controllers/gift.controller');
const {
  validateZod,
  createLiveClassSchema,
  updateLiveClassSchema,
} = require('../middleware/validators/liveClass.validator');
const {
  validateZod: validateGiftZod,
  sendGiftSchema,
  sendGiftToAllSchema,
} = require('../middleware/validators/gift.validator');

// ─── Gift-specific rate limiter (shared with voice routes) ───────────────────
const giftRateLimit = rateLimit({
  windowMs: 10 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { success: false, message: 'Too many gift requests, slow down' },
});

// ─── Multer — cover image (2 MB, images only, memory storage) ────────────────
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

router.use(authenticate);

// ─── LIST / GET ───────────────────────────────────────────────────────────────
router.get('/',      ctrl.listLiveClasses);
router.get('/:id',   ctrl.getLiveClass);

// ─── CREATE / UPDATE / DELETE ─────────────────────────────────────────────────
router.post('/',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  validateZod(createLiveClassSchema),
  [
    body('classId').notEmpty().withMessage('classId required'),
    body('title').trim().notEmpty().withMessage('Title required'),
    // duration is optional — null means permanent/unlimited
    body('duration').optional({ nullable: true }).custom(v => {
      if (v === null || v === undefined) return true;
      if (!Number.isInteger(Number(v)) || Number(v) < 1) throw new Error('duration must be a positive integer');
      return true;
    }),
    body('maxParticipants').optional().isInt({ min: 1, max: 1000 }),
    body('scheduledAt').optional().isISO8601(),
    body('teacherId').optional().isUUID().withMessage('teacherId must be a valid UUID'),
  ],
  validate,
  ctrl.createLiveClass
);

router.patch('/:id',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  validateZod(updateLiveClassSchema),
  [
    body('title').optional().trim().notEmpty(),
    body('duration').optional({ nullable: true }).custom(v => {
      if (v === null || v === undefined) return true;
      if (!Number.isInteger(Number(v)) || Number(v) < 1) throw new Error('duration must be a positive integer');
      return true;
    }),
    body('scheduledAt').optional().isISO8601(),
    body('chatEnabled').optional().isBoolean(),
    body('handRaiseEnabled').optional().isBoolean(),
    body('quranPanelEnabled').optional().isBoolean(),
    body('whiteboardEnabled').optional().isBoolean(),
    body('screenShareEnabled').optional().isBoolean(),
    body('isOpenMic').optional().isBoolean(),
    body('maxParticipants').optional().isInt({ min: 1, max: 1000 }),
  ],
  validate,
  ctrl.updateLiveClass
);

router.delete('/:id',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  ctrl.deleteLiveClass
);

// ─── LIFECYCLE ────────────────────────────────────────────────────────────────
router.post('/:id/start',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  ctrl.startLiveClass
);
router.post('/:id/end',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  ctrl.endLiveClass
);
router.post('/:id/join',  ctrl.joinLiveClass);
router.post('/:id/leave', ctrl.leaveLiveClass);

// ─── LIVEKIT TOKEN ────────────────────────────────────────────────────────────
router.post('/:id/token', ctrl.getLiveKitToken);
// Alias for mobile compatibility
router.post('/:id/livekit-token', ctrl.getLiveKitToken);

// ─── PARTICIPANTS ─────────────────────────────────────────────────────────────
router.get('/:id/participants', ctrl.getParticipants);

router.patch('/:id/participants/:userId/mute',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  [body('muted').optional().isBoolean()],
  validate,
  ctrl.muteParticipant
);

router.patch('/:id/mute-all',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  ctrl.muteAll
);

router.delete('/:id/participants/:userId',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  ctrl.kickParticipant
);

// ─── HAND RAISE QUEUE ─────────────────────────────────────────────────────────
router.post('/:id/hand/raise',  ctrl.raiseHand);
router.post('/:id/hand/lower',  ctrl.lowerHand);
router.get('/:id/hand/queue',   ctrl.getHandQueue);

router.post('/:id/hand/approve/:userId',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  ctrl.approveHand
);
router.post('/:id/hand/reject/:userId',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  ctrl.rejectHand
);

// ─── CHAT ─────────────────────────────────────────────────────────────────────
router.get('/:id/messages', ctrl.getMessages);
router.post('/:id/messages',
  [body('body').trim().notEmpty().withMessage('Message required')],
  validate,
  ctrl.sendMessage
);

// ─── ATTENDANCE ───────────────────────────────────────────────────────────────
router.get('/:id/attendance',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  ctrl.getAttendance
);

// ─── SPEAK REQUEST ────────────────────────────────────────────────────────────
router.post('/:id/speak-request', ctrl.requestSpeak);

// ─── OPEN MIC ─────────────────────────────────────────────────────────────────
router.post('/:id/open-mic',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  ctrl.toggleOpenMic
);

// ─── RECORDING ────────────────────────────────────────────────────────────────
router.post('/:id/recording/start',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  ctrl.startRecording
);
router.post('/:id/recording/stop',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  [body('recordingUrl').optional().isURL()],
  validate,
  ctrl.stopRecording
);

// ─── WHITEBOARD RELAY ─────────────────────────────────────────────────────────
router.get('/:id/whiteboard/state', ctrl.getWhiteboardState);

router.post('/:id/whiteboard',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  [body('event').notEmpty()],
  validate,
  ctrl.broadcastDraw
);

// ─── POLL RELAY ───────────────────────────────────────────────────────────────
router.post('/:id/poll',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  [body('event').notEmpty()],
  validate,
  ctrl.broadcastPoll
);

// LC-003 FIX: New read endpoint so students loading mid-class get current poll state
router.get('/:id/poll/state', ctrl.getPollState);

// ─── QURAN SYNC ───────────────────────────────────────────────────────────────
router.post('/:id/quran-position',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  [
    body('surahNumber').isInt({ min: 1, max: 114 }),
    body('ayahNumber').isInt({ min: 1 }),
  ],
  validate,
  ctrl.broadcastQuranPosition
);

// ─── GIFTS (Universal Gift Engine — reuses gift.controller.js) ───────────────
// Inject roomType so the controller uses the live_class resolver
router.post('/:id/gifts',
  giftRateLimit,
  validateGiftZod(sendGiftSchema),
  [
    body('giftId').notEmpty().withMessage('giftId is required'),
    body('receiverId').notEmpty().withMessage('receiverId is required'),
    body('count').optional().isInt({ min: 1, max: 100 }),
    body('idempotencyKey').optional().isString(),
  ],
  validate,
  (req, res) => { req.roomType = 'live_class'; sendGift(req, res); }
);

router.post('/:id/gifts/all',
  giftRateLimit,
  validateGiftZod(sendGiftToAllSchema),
  [
    body('giftId').notEmpty().withMessage('giftId is required'),
    body('count').optional().isInt({ min: 1, max: 100 }),
    body('idempotencyKey').optional().isString(),
  ],
  validate,
  (req, res) => { req.roomType = 'live_class'; sendGiftToAll(req, res); }
);

router.get('/:id/gifts/leaderboard',    getRoomLeaderboard);
router.get('/:id/gifts/history',        getRoomGiftHistory);
router.get('/:id/gifts/top-supporters', getTopSupporters);

// ─── COVER IMAGE UPLOAD ───────────────────────────────────────────────────────
// POST /:id/cover — host uploads a cover image (replaces coverImageUrl field)
router.post('/:id/cover',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  coverUpload.single('cover'),
  ctrl.uploadCoverImage
);

// ─── UNMUTE ALL ───────────────────────────────────────────────────────────────
router.patch('/:id/unmute-all',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  ctrl.unmuteAll
);

// ─── LOWER ALL HANDS ──────────────────────────────────────────────────────────
router.post('/:id/hand/lower-all',
  authorize('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
  ctrl.lowerAllHands
);

// ─── DELETE CHAT MESSAGE ──────────────────────────────────────────────────────
// Host or message author can delete
router.delete('/:id/messages/:messageId', ctrl.deleteMessage);

// LC-001 FIX: module.exports moved to end so all routes above are reachable.
// Previously this was in the middle of the file, making 9 route groups (gifts,
// cover upload, unmute-all, lower-all-hands, delete message) return 404.
module.exports = router;
