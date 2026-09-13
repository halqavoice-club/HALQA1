'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const { eduMember, eduStaff } = require('../middleware/educationAuth');
const multer = require('multer');
const ctrl = require('../controllers/live-class.controller');
const rateLimit = require('express-rate-limit');
const { sendGift, sendGiftToAll, getRoomLeaderboard, getRoomGiftHistory, getTopSupporters } = require('../controllers/gift.controller');
const prisma = require('../utils/prisma');
const { errorResponse } = require('../utils/response');
const { validateZod, createLiveClassSchema, updateLiveClassSchema } = require('../middleware/validators/liveClass.validator');
const { validateZod: validateGiftZod, sendGiftSchema, sendGiftToAllSchema } = require('../middleware/validators/gift.validator');

// ─── Stream type resolver ─────────────────────────────────────────────────────
// For routes that must work for BOTH school members AND public users,
// we apply eduMember only when the stream is a SCHOOL type.
// PUBLIC streams skip the school membership check entirely.
//
// NOTE: Uses raw SQL to avoid the Prisma ORM P2022 error that occurs when
// the Prisma client binary was compiled before streamType/hostUserId were added.
// After running `npx prisma generate` (requires backend restart), these can be
// replaced with normal `prisma.liveClass.findFirst` calls.
async function resolveStreamAccess(req, res, next) {
  try {
    const id = req.params.id;

    // Raw SQL to bypass stale Prisma client binary
    const rows = await prisma.$queryRawUnsafe(
      'SELECT id, stream_type as streamType, schoolId FROM live_classes WHERE id = ? AND deletedAt IS NULL LIMIT 1',
      id
    );

    if (!rows || rows.length === 0) return errorResponse(res, 'Live class not found', 404);
    const lc = rows[0];
    const streamType = lc.streamType || lc.stream_type || 'SCHOOL';

    if (streamType === 'PUBLIC') {
      req._isPublicStream = true;
      return next();
    }

    // SCHOOL stream — apply school membership check
    req._isPublicStream = false;
    const [memberCheck, roleCheck] = eduMember;
    memberCheck(req, res, (err) => {
      if (err) return next(err);
      roleCheck ? roleCheck(req, res, next) : next();
    });
  } catch (err) { next(err); }
}

// Same but for staff-level operations on school streams
async function resolveStreamStaffAccess(req, res, next) {
  try {
    const id = req.params.id;

    const rows = await prisma.$queryRawUnsafe(
      'SELECT id, stream_type as streamType, host_user_id as hostUserId FROM live_classes WHERE id = ? AND deletedAt IS NULL LIMIT 1',
      id
    );

    if (!rows || rows.length === 0) return errorResponse(res, 'Live class not found', 404);
    const lc = rows[0];
    const streamType = lc.streamType || lc.stream_type || 'SCHOOL';
    const hostUserId = lc.hostUserId || lc.host_user_id || null;

    if (streamType === 'PUBLIC') {
      if (!req.user) return errorResponse(res, 'Authentication required', 401);
      if (hostUserId !== req.user.id) {
        return errorResponse(res, 'Only the host can perform this action', 403);
      }
      req._isPublicStream = true;
      return next();
    }

    // SCHOOL stream — apply eduStaff
    req._isPublicStream = false;
    const middlewares = eduStaff;
    let i = 0;
    const runNext = (err) => {
      if (err) return next(err);
      if (i >= middlewares.length) return next();
      middlewares[i++](req, res, runNext);
    };
    runNext();
  } catch (err) { next(err); }
}

// ─── P2-03: Defense-in-depth school isolation for gift endpoints ──────────────
// ARCHITECTURE FIX (HALQA-ARCH-02):
// SUPER_ADMIN is a platform-management role, NOT a participant in school live classes.
// Removed the SUPER_ADMIN bypass — platform admins are not automatically enrolled
// in school-private sessions and should not be able to send gifts to them.
// SUPER_ADMIN can still send gifts to PUBLIC streams (open to all authenticated users).
// For moderation of school sessions, use the admin dashboard — not the gift system.
async function checkLiveClassSchool(req, res, next) {
  try {
    const userSchoolId = req.schoolId || req.user.schoolId;
    const rows = await prisma.$queryRawUnsafe(
      'SELECT schoolId, stream_type as streamType FROM live_classes WHERE id = ? AND deletedAt IS NULL LIMIT 1',
      req.params.id
    );
    if (!rows || rows.length === 0) return errorResponse(res, 'Live class not found', 404);
    const lc = rows[0];
    const streamType = lc.streamType || lc.stream_type || 'SCHOOL';
    // PUBLIC streams: any authenticated user can send gifts
    if (streamType === 'PUBLIC') return next();
    // SCHOOL streams: user must belong to that school
    if (lc.schoolId !== userSchoolId) return errorResponse(res, 'Access denied to this school\'s resource', 403);
    next();
  } catch (err) { next(err); }
}

// ─── Gift rate limiter ────────────────────────────────────────────────────────
const giftRateLimit = rateLimit({
  windowMs: 10 * 1000, max: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { success: false, message: 'Too many gift requests, slow down' },
});

// ─── Cover image upload — 2 MB, images only ──────────────────────────────────
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

router.use(authenticate);

// ─── LIST — school members see school streams; everyone sees public streams ───
// The controller handles filtering by streamType + school context
router.get('/', ctrl.listLiveClasses);

// ─── GET ONE — resolves per-stream access ────────────────────────────────────
router.get('/:id', resolveStreamAccess, ctrl.getLiveClass);

// ─── CREATE — school streams require staff role; public streams need only auth ─
router.post('/',
  (req, res, next) => {
    // Decide middleware chain based on submitted streamType
    const isPublic = req.body?.streamType === 'PUBLIC' || req.body?.isPublic === true;
    if (isPublic) return next(); // only authenticate() already applied above
    // SCHOOL stream: require school staff role
    const middlewares = eduStaff;
    let i = 0;
    const run = (err) => {
      if (err) return next(err);
      if (i >= middlewares.length) return next();
      middlewares[i++](req, res, run);
    };
    run();
  },
  validateZod(createLiveClassSchema),
  [
    body('title').optional().trim(),
    body('duration').optional({ nullable: true }).custom(v => {
      if (v === null || v === undefined) return true;
      if (!Number.isInteger(Number(v)) || Number(v) < 1) throw new Error('duration must be a positive integer');
      return true;
    }),
    body('scheduledAt').optional().isISO8601(),
    body('teacherId').optional().isUUID().withMessage('teacherId must be a valid UUID'),
  ],
  validate,
  ctrl.createLiveClass
);

router.patch('/:id',
  resolveStreamStaffAccess,
  validateZod(updateLiveClassSchema),
  [
    body('title').optional().trim(),
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
  ],
  validate,
  ctrl.updateLiveClass
);

router.delete('/:id', resolveStreamStaffAccess, ctrl.deleteLiveClass);

// ─── LIFECYCLE ────────────────────────────────────────────────────────────────
router.post('/:id/start', resolveStreamStaffAccess, ctrl.startLiveClass);
router.post('/:id/end',   resolveStreamStaffAccess, ctrl.endLiveClass);

// Join/leave — resolves per-stream (PUBLIC = any auth user; SCHOOL = school member)
router.post('/:id/join',  resolveStreamAccess, ctrl.joinLiveClass);
router.post('/:id/leave', resolveStreamAccess, ctrl.leaveLiveClass);

// ─── LIVEKIT TOKEN ────────────────────────────────────────────────────────────
router.post('/:id/token',        resolveStreamAccess, ctrl.getLiveKitToken);
router.post('/:id/livekit-token', resolveStreamAccess, ctrl.getLiveKitToken);

// ─── PARTICIPANTS ─────────────────────────────────────────────────────────────
router.get('/:id/participants', resolveStreamAccess, ctrl.getParticipants);

router.patch('/:id/participants/:userId/mute',
  resolveStreamStaffAccess,
  [body('muted').optional().isBoolean()],
  validate,
  ctrl.muteParticipant
);

router.patch('/:id/participants/:userId/video',
  resolveStreamAccess,
  [body('isVideoOn').isBoolean().withMessage('isVideoOn (boolean) is required')],
  validate,
  ctrl.setVideoState
);

router.patch('/:id/mute-all',                    resolveStreamAccess, ctrl.muteAll);
router.patch('/:id/unmute-all',                  resolveStreamAccess, ctrl.unmuteAll);
router.delete('/:id/participants/:userId',        resolveStreamStaffAccess, ctrl.kickParticipant);

// ─── HAND RAISE ───────────────────────────────────────────────────────────────
router.post('/:id/hand/raise',          resolveStreamAccess, ctrl.raiseHand);
router.post('/:id/hand/lower',          resolveStreamAccess, ctrl.lowerHand);
router.post('/:id/hand/lower-all',      resolveStreamStaffAccess, ctrl.lowerAllHands);
router.get('/:id/hand/queue',           resolveStreamAccess, ctrl.getHandQueue);
router.post('/:id/hand/approve/:userId', resolveStreamStaffAccess, ctrl.approveHand);
router.post('/:id/hand/reject/:userId',  resolveStreamStaffAccess, ctrl.rejectHand);

// ─── CHAT ─────────────────────────────────────────────────────────────────────
router.get('/:id/messages',  resolveStreamAccess, ctrl.getMessages);
router.post('/:id/messages',
  resolveStreamAccess,
  [body('body').trim().notEmpty().withMessage('Message required')],
  validate,
  ctrl.sendMessage
);
router.delete('/:id/messages/:messageId', resolveStreamAccess, ctrl.deleteMessage);

// ─── ATTENDANCE ───────────────────────────────────────────────────────────────
router.get('/:id/attendance', resolveStreamStaffAccess, ctrl.getAttendance);

// ─── SPEAK REQUEST ────────────────────────────────────────────────────────────
router.post('/:id/speak-request', resolveStreamAccess, ctrl.requestSpeak);

// ─── OPEN MIC ─────────────────────────────────────────────────────────────────
router.post('/:id/open-mic', resolveStreamStaffAccess, ctrl.toggleOpenMic);

// ─── RECORDING ────────────────────────────────────────────────────────────────
router.post('/:id/recording/start', resolveStreamStaffAccess, ctrl.startRecording);
router.post('/:id/recording/stop',
  resolveStreamStaffAccess,
  [body('recordingUrl').optional().isURL()],
  validate,
  ctrl.stopRecording
);

// ─── WHITEBOARD ───────────────────────────────────────────────────────────────
router.get('/:id/whiteboard/state',  resolveStreamAccess, ctrl.getWhiteboardState);
router.post('/:id/whiteboard',
  resolveStreamStaffAccess,
  [body('event').notEmpty()],
  validate,
  ctrl.broadcastDraw
);

// ─── POLL ─────────────────────────────────────────────────────────────────────
router.post('/:id/poll',
  resolveStreamStaffAccess,
  [body('event').notEmpty()],
  validate,
  ctrl.broadcastPoll
);
router.get('/:id/poll/state', resolveStreamAccess, ctrl.getPollState);

// ─── QURAN SYNC ───────────────────────────────────────────────────────────────
router.post('/:id/quran-position',
  resolveStreamStaffAccess,
  [body('surahNumber').isInt({ min: 1, max: 114 }), body('ayahNumber').isInt({ min: 1 })],
  validate,
  ctrl.broadcastQuranPosition
);

// ─── GIFTS ────────────────────────────────────────────────────────────────────
router.post('/:id/gifts',
  giftRateLimit, checkLiveClassSchool,
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
  giftRateLimit, checkLiveClassSchool,
  validateGiftZod(sendGiftToAllSchema),
  [
    body('giftId').notEmpty().withMessage('giftId is required'),
    body('count').optional().isInt({ min: 1, max: 100 }),
    body('idempotencyKey').optional().isString(),
  ],
  validate,
  (req, res) => { req.roomType = 'live_class'; sendGiftToAll(req, res); }
);

router.get('/:id/gifts/leaderboard',    checkLiveClassSchool, getRoomLeaderboard);
router.get('/:id/gifts/history',        checkLiveClassSchool, getRoomGiftHistory);
router.get('/:id/gifts/top-supporters', checkLiveClassSchool, getTopSupporters);

// ─── Cover image upload ─────────────────────────────────────────────────────
async function validateCoverImage(req, res, next) {
  if (!req.file) return next();
  try {
    const { fromBuffer: fileTypeFromBuffer } = require('file-type');
    const detected = await fileTypeFromBuffer(req.file.buffer);
    const mime = detected?.mime;
    if (!mime || !mime.startsWith('image/')) {
      return errorResponse(res, `File type not allowed (detected: ${mime || 'unknown'}). Only images are accepted.`, 400);
    }
    next();
  } catch {
    next();
  }
}

router.post('/:id/cover', resolveStreamStaffAccess, coverUpload.single('cover'), validateCoverImage, ctrl.uploadCoverImage);

module.exports = router;
