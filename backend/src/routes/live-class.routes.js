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
    const lcSchoolId = lc.schoolId || null;

    if (streamType === 'PUBLIC') {
      req._isPublicStream = true;
      return next();
    }

    // SCHOOL stream — force schoolId to the live class's school so requireSchoolMember
    // checks membership in the correct school (not the user's legacy User.schoolId).
    if (lcSchoolId) req.params.schoolId = lcSchoolId;

    // Apply school membership check (any active member of this class's school)
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
    const lcSchoolId = lc.schoolId || null;

    if (streamType === 'PUBLIC') {
      if (!req.user) return errorResponse(res, 'Authentication required', 401);
      if (hostUserId !== req.user.id) {
        return errorResponse(res, 'Only the host can perform this action', 403);
      }
      req._isPublicStream = true;
      return next();
    }

    // SCHOOL stream — force req.params.schoolId to the LIVE CLASS's school
    // so requireSchoolMember checks membership in the school that OWNS this class,
    // not in the user's legacy User.schoolId (which may be a completely different school).
    // Without this, a SCHOOL_ADMIN in School A can manage School B's live classes.
    if (lcSchoolId) req.params.schoolId = lcSchoolId;

    // Apply eduStaff: requireSchoolMember + requireSchoolRole(TEACHER, SCHOOL_ADMIN, ...)
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

// --- Chat message rate limiter (20 msgs / 10 s per user) ---
const chatRateLimit = rateLimit({
  windowMs: 10 * 1000, max: 20,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { success: false, message: 'You are sending messages too fast, please slow down' },
  skipSuccessfulRequests: false,
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
  // SA-LC-CREATE-01: SUPER_ADMIN = Platform Administration ONLY.
  // Platform admins cannot create live classes (school or public streams).
  (req, res, next) => {
    if (req.user?.role === 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Platform administrators cannot create live classes. Use the admin panel to manage content.'
      });
    }
    return next();
  },
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
      if (!Number.isInteger(Number(v))) throw new Error('duration must be an integer');
      return true;
    }),
    body('maxParticipants').optional({ nullable: true }).custom(v => {
      if (v === null || v === undefined) return true;
      if (!Number.isInteger(Number(v))) throw new Error('maxParticipants must be an integer');
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
      if (!Number.isInteger(Number(v))) throw new Error('duration must be an integer');
      return true;
    }),
    body('chatEnabled').optional().isBoolean(),
    body('handRaiseEnabled').optional().isBoolean(),
    body('quranPanelEnabled').optional().isBoolean(),
    body('whiteboardEnabled').optional().isBoolean(),
    body('screenShareEnabled').optional().isBoolean(),
    body('isOpenMic').optional().isBoolean(),
    body('maxSpeakers').optional().isInt({ min: 1, max: 50 }).withMessage('maxSpeakers must be between 1 and 50'),
    body('maxParticipants').optional({ nullable: true }).custom(v => {
      if (v === null || v === undefined) return true;
      if (!Number.isInteger(Number(v))) throw new Error('maxParticipants must be an integer');
      return true;
    }),
  ],
  validate,
  ctrl.updateLiveClass
);

router.delete('/:id', resolveStreamStaffAccess, ctrl.deleteLiveClass);

// ─── LIFECYCLE ────────────────────────────────────────────────────────────────
router.post('/:id/start', resolveStreamStaffAccess, ctrl.startLiveClass);
router.post('/:id/end',   resolveStreamStaffAccess, ctrl.endLiveClass);

// Join/leave — resolves per-stream (PUBLIC = any auth user; SCHOOL = school member)
router.post('/:id/join',
  // SA-LC-JOIN-01: SUPER_ADMIN = Platform Administration ONLY.
  // Platform admins cannot join live classes as participants.
  // Force-termination is done via POST /:id/terminate (admin-only route).
  (req, res, next) => {
    if (req.user?.role === 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Platform administrators cannot join live classes as participants. Use the admin panel to manage streams.'
      });
    }
    return next();
  },
  resolveStreamAccess, ctrl.joinLiveClass
);
router.post('/:id/leave', resolveStreamAccess, ctrl.leaveLiveClass);

// ─── LIVEKIT TOKEN ────────────────────────────────────────────────────────────
router.post('/:id/token',
  // SA-LC-TOKEN-01: SUPER_ADMIN cannot get LiveKit tokens — not a content participant
  (req, res, next) => {
    if (req.user?.role === 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Platform administrators cannot join live class streams.' });
    }
    return next();
  },
  resolveStreamAccess, ctrl.getLiveKitToken
);
router.post('/:id/livekit-token',
  (req, res, next) => {
    if (req.user?.role === 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Platform administrators cannot join live class streams.' });
    }
    return next();
  },
  resolveStreamAccess, ctrl.getLiveKitToken
);

// ─── PARTICIPANTS ─────────────────────────────────────────────────────────────
router.get('/:id/participants', resolveStreamAccess, ctrl.getParticipants);

// Mute individual — HOST or MODERATOR (checked inside controller via assertOwnerOrModerator)
router.patch('/:id/participants/:userId/mute',
  resolveStreamAccess,
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

// Bulk actions — HOST or MODERATOR (assertOwnerOrModerator in controller)
router.patch('/:id/mute-all',             resolveStreamAccess, ctrl.muteAll);
router.patch('/:id/unmute-all',           resolveStreamAccess, ctrl.unmuteAll);
// Kick — HOST or MODERATOR (assertOwnerOrModerator in controller)
router.delete('/:id/participants/:userId', resolveStreamAccess, ctrl.kickParticipant);

// ─── HAND RAISE ───────────────────────────────────────────────────────────────
router.post('/:id/hand/raise',          resolveStreamAccess, ctrl.raiseHand);
router.post('/:id/hand/lower',          resolveStreamAccess, ctrl.lowerHand);
// Lower all / approve / reject — HOST or MODERATOR (assertOwnerOrModerator in controller)
router.post('/:id/hand/lower-all',       resolveStreamAccess, ctrl.lowerAllHands);
router.get('/:id/hand/queue',            resolveStreamAccess, ctrl.getHandQueue);
router.post('/:id/hand/approve/:userId', resolveStreamAccess, ctrl.approveHand);
router.post('/:id/hand/reject/:userId',  resolveStreamAccess, ctrl.rejectHand);

// ─── SPEAKER STAGE (Voice-Club-style slot management) ────────────────────────
// Any active speaker can drop their own mic (return to audience).
router.post('/:id/drop-mic',   resolveStreamAccess, ctrl.dropMic);
// Demote / invite — HOST or MODERATOR (assertOwnerOrModerator in controller)
router.post('/:id/demote/:userId', resolveStreamAccess, ctrl.demoteSpeaker);
router.post('/:id/invite/:userId', resolveStreamAccess, ctrl.inviteToStage);

// ─── CHAT ─────────────────────────────────────────────────────────────────────
router.get('/:id/messages',  resolveStreamAccess, ctrl.getMessages);
router.post('/:id/messages',
  chatRateLimit,
  resolveStreamAccess,
  [body('body').trim().notEmpty().withMessage('Message required').isLength({ max: 2000 }).withMessage('Message must be 2000 characters or less')],
  validate,
  ctrl.sendMessage
);
// Delete a specific chat message.
// Authorization in controller: author may delete own message; HOST/MODERATOR may
// delete any message. School role alone does NOT grant moderation authority.
router.delete('/:id/messages/:messageId', resolveStreamAccess, ctrl.deleteMessage);

// ─── ATTENDANCE ───────────────────────────────────────────────────────────────
router.get('/:id/attendance', resolveStreamStaffAccess, ctrl.getAttendance);

// ─── SPEAK REQUEST ────────────────────────────────────────────────────────────
router.post('/:id/speak-request', resolveStreamAccess, ctrl.requestSpeak);

// ─── OPEN MIC ─────────────────────────────────────────────────────────────────
// HOST or MODERATOR (assertOwnerOrModerator checked inside toggleOpenMic)
router.post('/:id/open-mic', resolveStreamAccess, ctrl.toggleOpenMic);

// ─── RECORDING ────────────────────────────────────────────────────────────────
// HOST only (checked via resolveStreamStaffAccess for school; hostUserId for public)
router.post('/:id/recording/start', resolveStreamStaffAccess, ctrl.startRecording);
router.post('/:id/recording/stop',
  resolveStreamStaffAccess,
  [body('recordingUrl').optional().isURL({ protocols: ['https'], require_protocol: true })
    .withMessage('recordingUrl must be a valid HTTPS URL')],
  validate,
  ctrl.stopRecording
);

// ─── WHITEBOARD ───────────────────────────────────────────────────────────────
router.get('/:id/whiteboard/state',  resolveStreamAccess, ctrl.getWhiteboardState);
router.post('/:id/whiteboard',
  resolveStreamStaffAccess,
  [
    body('event').notEmpty(),
    body('event.type').optional().isIn(['draw', 'clear', 'snapshot'])
      .withMessage('event.type must be draw, clear, or snapshot'),
  ],
  validate,
  ctrl.broadcastDraw
);

// ─── POLL ─────────────────────────────────────────────────────────────────────
router.post('/:id/poll',
  resolveStreamStaffAccess,
  [
    body('event').notEmpty(),
    body('event.type').optional().isIn(['create', 'vote', 'close'])
      .withMessage('event.type must be create, vote, or close'),
  ],
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
    // CJS → ESM interop: file-type@21.x is ESM-only; use dynamic import()
    const { fileTypeFromBuffer } = await import('file-type');
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

// ─── MODERATOR MANAGEMENT ─────────────────────────────────────────────────────
// Only the class CREATOR can promote/demote moderators.
// Uses resolveStreamAccess (not staff) because the creator may have MEMBER global role.
router.post('/:id/moderator/:userId',   resolveStreamAccess, ctrl.promoteToModerator);
router.delete('/:id/moderator/:userId', resolveStreamAccess, ctrl.demoteModerator);

// ─── HOST TRANSFER (LS-GAP-003 FIX) ──────────────────────────────────────────
// Only the current HOST can transfer ownership to another active participant.
// Works for both SCHOOL and PUBLIC streams.
// Uses resolveStreamAccess so PUBLIC stream creators (MEMBER role) can call this.
router.post('/:id/transfer/:userId', resolveStreamAccess, ctrl.transferHost);

// ─── ADMIN FORCE-TERMINATE ─────────────────────────────────────────────────────
// SUPER_ADMIN only — force-ends any stream for platform moderation.
// The middleware chain is just authenticate() (already applied above);
// terminateLiveClass() checks req.user.role === 'SUPER_ADMIN' internally.
router.post('/:id/terminate', ctrl.terminateLiveClass);

module.exports = router;
