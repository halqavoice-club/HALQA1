const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const {
  validateZod,
  createRoomSchema,
  updateRoomSchema,
  sendMessageSchema,
} = require('../middleware/validators/voice.validator');
const multer = require('multer');
const path   = require('path');
const { v4: uuidv4 } = require('uuid');
const { saveFile } = require('../utils/storage');
const { moderateLimiter, writeLimiter } = require('../middleware/rateLimiter.user');
const { moderateDeviceLimiter } = require('../middleware/rateLimiter.device');
const { middleware: idempotency } = require('../middleware/idempotency');
const {
  listRooms, getRoom, searchRooms, createRoom, joinRoom, leaveRoom, endRoom,
  toggleMute, raiseHand, promoteParticipant, kickParticipant,
  getMessages, sendMessage, getHandQueue,
  toggleOpenMic, toggleMicLock, grabMic, dropMic,
  updateRoom, deleteRoom, getMyRooms, uploadRoomCover
} = require('../controllers/voice.controller');

// ─── Multer — room cover image (2 MB, images only, memory storage) ───────────
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// L-8 FIX: Validate uploaded cover image magic bytes so spoofed Content-Type
// headers cannot be used to upload non-image files via this endpoint.
// Reuses the same validation logic as the main /uploads route.
async function validateCoverImage(req, res, next) {
  if (!req.file) return next();
  try {
    const { fromBuffer: fileTypeFromBuffer } = require('file-type');
    const detected = await fileTypeFromBuffer(req.file.buffer);
    const mime = detected?.mime;
    if (!mime || !mime.startsWith('image/')) {
      const { errorResponse } = require('../utils/response');
      return errorResponse(res, `File type not allowed (detected: ${mime || 'unknown'}). Only images are accepted.`, 400);
    }
    next();
  } catch {
    next(); // fail-open on detection error — multer MIME filter already provides basic protection
  }
}
const { getLiveKitToken } = require('../controllers/livekit.controller');
const { getMyStats, getLeaderboard } = require('../controllers/voice-stats.controller');
const {
  raiseHand: queueRaiseHand,
  cancelHand,
  approveNext,
  approveUser,
  rejectUser,
  getQueueHandler
} = require('../controllers/voice-queue.controller');
const {
  assignModerator, removeModerator, transferAdmin, muteAll, getParticipants, pinSpeaker
} = require('../controllers/voice-roles.controller');
const {
  checkVoiceRole, VOICE_ROLES
} = require('../middleware/voiceRole.middleware');
const {
  sendMicOffer, acceptMicOffer, declineMicOffer, cancelMicOffer
} = require('../controllers/voice-mic.controller');
const rateLimit = require('express-rate-limit');
const {
  sendGift, sendGiftToAll, getRoomLeaderboard, getRoomGiftHistory, getTopSupporters
} = require('../controllers/gift.controller');
const {
  validateZod: validateGiftZod,
  sendGiftSchema,
  sendGiftToAllSchema,
} = require('../middleware/validators/gift.validator');

// Gift-specific rate limiter: 30 requests per 10 seconds per user
const giftRateLimit = rateLimit({
  windowMs: 10 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { success: false, message: 'Too many gift requests, slow down' }
});

router.use(authenticate);

// ─── STATS ────────────────────────────────────────────────────────────────────
router.get('/stats/me',          getMyStats);
router.get('/stats/leaderboard', getLeaderboard);

// ─── ROOMS ────────────────────────────────────────────────────────────────────
router.get('/', moderateLimiter, listRooms);
router.get('/search', moderateLimiter, searchRooms);  // must be before /:id
router.get('/my', moderateLimiter, getMyRooms);       // user's own rooms — must be before /:id
router.get('/:id', moderateLimiter, getRoom);

router.post('/',
  writeLimiter,
  moderateDeviceLimiter,
  validateZod(createRoomSchema),
  [
    body('title').trim().notEmpty().withMessage('Room title is required'),
    body('privacy').optional().isIn(['PUBLIC', 'PRIVATE', 'INVITE_ONLY']).withMessage('Invalid privacy setting')
  ],
  validate,
  createRoom
);

// Edit room details (host only)
router.patch('/:id',
  validateZod(updateRoomSchema),
  [
    body('title').optional().trim().notEmpty().withMessage('Title cannot be empty'),
    body('privacy').optional().isIn(['PUBLIC', 'PRIVATE', 'INVITE_ONLY']),
    body('topic').optional().isString(),
    body('description').optional().isString(),
    body('coverEmoji').optional().isString(),
    body('coverImageUrl').optional({ nullable: true }),
    body('commentsEnabled').optional().isBoolean(),
    body('slowMode').optional().isBoolean(),
    body('messageType').optional().isIn(['all', 'followers', 'none']),
    body('reactionsEnabled').optional().isBoolean(),
  ],
  validate,
  updateRoom
);

// Delete room permanently (host or admin only)
router.delete('/:id', deleteRoom);

// Upload room cover image (host only)
router.post('/:id/cover', coverUpload.single('cover'), validateCoverImage, uploadRoomCover);

router.post('/:id/join', joinRoom);
router.post('/:id/leave', leaveRoom);

router.patch('/:id/end',
  // Any authenticated user who is the host can end the room (checked inside controller)
  endRoom
);

// ─── PARTICIPANT CONTROLS ─────────────────────────────────────────────────────
router.patch('/:id/mute',
  [
    body('isMuted').optional().isBoolean(),
    body('targetUserId').optional().isString()
  ],
  validate,
  toggleMute
);

// Legacy raise-hand (kept for backward compat — delegates to queue system)
router.patch('/:id/raise-hand',
  [body('raised').optional().isBoolean()],
  validate,
  raiseHand
);

router.patch('/:id/promote',
  [
    body('targetUserId').notEmpty().withMessage('Target user ID required'),
    body('role').isIn(['SPEAKER', 'AUDIENCE']).withMessage('Role must be SPEAKER or AUDIENCE')
  ],
  validate,
  promoteParticipant
);

router.delete('/:id/kick/:userId', kickParticipant);

// ─── FIFO SPEAKER QUEUE ───────────────────────────────────────────────────────
router.post('/:id/queue/raise',              queueRaiseHand);
router.delete('/:id/queue/cancel',           cancelHand);
router.post('/:id/queue/approve',            approveNext);
router.post('/:id/queue/approve/:userId',    approveUser);
router.delete('/:id/queue/reject/:userId',   rejectUser);
router.get('/:id/queue',                     getQueueHandler);

// ─── ROLE MANAGEMENT ──────────────────────────────────────────────────────────
// HOST assigns/removes MODERATOR
router.post('/:id/moderator/:userId',
  checkVoiceRole([VOICE_ROLES.HOST]),
  assignModerator
);
router.delete('/:id/moderator/:userId',
  checkVoiceRole([VOICE_ROLES.HOST]),
  removeModerator
);
// HOST transfers ownership
router.post('/:id/transfer/:userId',
  checkVoiceRole([VOICE_ROLES.HOST]),
  transferAdmin
);
// HOST or MODERATOR mutes all speakers
router.patch('/:id/mute-all',
  checkVoiceRole([VOICE_ROLES.HOST, VOICE_ROLES.MODERATOR]),
  muteAll
);
// HOST or MODERATOR pins/unpins a speaker to top of stage
router.patch('/:id/pin/:userId',
  checkVoiceRole([VOICE_ROLES.HOST, VOICE_ROLES.MODERATOR]),
  pinSpeaker
);

// Get participants grouped by role
router.get('/:id/participants', getParticipants);

// ─── OPEN MIC ─────────────────────────────────────────────────────────────────
// HOST/MOD toggles open mic mode
router.patch('/:id/open-mic',
  [body('enabled').optional().isBoolean()],
  validate,
  toggleOpenMic
);
// HOST/MOD locks/unlocks the mic (prevents anyone from grabbing the mic)
router.patch('/:id/mic-lock',
  [body('locked').optional().isBoolean()],
  validate,
  toggleMicLock
);
// AUDIENCE grabs mic directly
router.post('/:id/grab-mic', grabMic);
// SPEAKER drops mic back to audience (self-demote)
router.post('/:id/drop-mic', dropMic);

// ─── MIC PASS ─────────────────────────────────────────────────────────────────
// Speaker passes mic to an audience member
router.post('/:id/mic-pass/:targetUserId',          sendMicOffer);
// Target accepts the offer
router.post('/:id/mic-pass/:offerId/accept',         acceptMicOffer);
// Target declines the offer
router.post('/:id/mic-pass/:offerId/decline',        declineMicOffer);
// Passer cancels before acceptance
router.delete('/:id/mic-pass/:offerId',              cancelMicOffer);

// ─── CHAT ─────────────────────────────────────────────────────────────────────
router.get('/:id/messages', getMessages);

router.post('/:id/messages',
  validateZod(sendMessageSchema),
  [body('body').trim().notEmpty().withMessage('Message body required')],
  validate,
  sendMessage
);

// ─── HAND QUEUE (legacy) ──────────────────────────────────────────────────────
router.get('/:id/hand-queue', getHandQueue);

// ─── LIVEKIT TOKEN ────────────────────────────────────────────────────────────
router.post('/:id/livekit-token', getLiveKitToken);

// ─── GIFTS ────────────────────────────────────────────────────────────────────
// Send a gift to a host/speaker in the room
router.post('/:id/gifts',
  giftRateLimit,
  validateGiftZod(sendGiftSchema),
  [
    body('giftId').notEmpty().withMessage('giftId is required'),
    body('receiverId').notEmpty().withMessage('receiverId is required'),
    body('count').optional().isInt({ min: 1, max: 100 }),
    body('idempotencyKey').optional().isString()
  ],
  validate,
  sendGift
);

// Send the same gift to ALL speakers/host on stage at once
router.post('/:id/gifts/all',
  giftRateLimit,
  validateGiftZod(sendGiftToAllSchema),
  [
    body('giftId').notEmpty().withMessage('giftId is required'),
    body('count').optional().isInt({ min: 1, max: 100 }),
    body('idempotencyKey').optional().isString()
  ],
  validate,
  sendGiftToAll
);

// Room gift leaderboard (top gifters in this session)
router.get('/:id/gifts/leaderboard', getRoomLeaderboard);

// Room gift history
router.get('/:id/gifts/history', getRoomGiftHistory);

// Top 3 supporters (for host dashboard)
router.get('/:id/gifts/top-supporters', getTopSupporters);

// ─── Phase 8 + 13: Lightweight room-status endpoint ─────────────────────────
// Returns only { status, participantCount, hostId } — ~50 bytes instead of
// the full room object (~2KB). Mobile clients poll this on poor networks
// instead of the full GET /:id, reducing data usage by 97%.
// ADDITIVE — new route only, no existing routes changed.
const { getCache } = require('../utils/redis');
const prisma       = require('../utils/prisma');
router.get('/:id/status', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    // Try cache first (30s TTL already set by main room cache)
    const cacheKey = `voice:room:${id}`;
    let status = null, count = 0, hostId = null;
    try {
      const cached = await getCache(cacheKey);
      if (cached) {
        status = cached.status;
        hostId = cached.hostId;
        count  = cached._count?.participants ?? cached.participants?.length ?? 0;
      }
    } catch {}
    if (!status) {
      const room = await prisma.voiceRoom.findUnique({
        where: { id },
        select: { status: true, hostId: true, _count: { select: { participants: { where: { isActive: true } } } } }
      });
      if (!room) return res.status(404).json({ success: false });
      status = room.status;
      hostId = room.hostId;
      count  = room._count.participants;
    }
    res.json({ success: true, data: { status, hostId, participantCount: count } });
  } catch (e) { next(e); }
});

module.exports = router;
