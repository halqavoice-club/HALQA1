/**
 * PK Routes — /api/v1/pk
 * ─────────────────────────────────────────────────────────────────────────────
 * All routes require authentication.
 * Sensitive admin operations require SUPER_ADMIN or SCHOOL_ADMIN role.
 */

'use strict';

const router     = require('express').Router();
const { body, param } = require('express-validator');
const validate   = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const rateLimit  = require('express-rate-limit');
const ctrl       = require('../controllers/pk.controller');

// Rate limiters
const pkWriteLimiter = rateLimit({
  windowMs:   10_000,
  max:        30,
  keyGenerator: (req) => req.user?.id || req.ip,
  message:    { success: false, message: 'Too many PK requests, slow down' }
});
const voteLimiter = rateLimit({
  windowMs:   60_000,
  max:        10,
  keyGenerator: (req) => req.user?.id || req.ip,
  message:    { success: false, message: 'Too many votes' }
});

router.use(authenticate);

// ─── MATCHMAKING ──────────────────────────────────────────────────────────────
router.post('/matchmaking/join',    pkWriteLimiter, ctrl.joinMatchmaking);
router.post('/matchmaking/leave',   ctrl.leaveMatchmaking);
router.get('/matchmaking/status',   ctrl.matchmakingStatus);

// ─── INVITATIONS ──────────────────────────────────────────────────────────────
router.get('/invitations',   ctrl.getInvitations);   // list pending invitations for me
router.post('/invitations',
  pkWriteLimiter,
  [
    body('receiverId').notEmpty().withMessage('receiverId is required'),
    body('type').optional().isIn(['ONE_V_ONE', 'ROOM_V_ROOM', 'TEAM_V_TEAM', 'CLUB_V_CLUB']),
    body('durationSeconds').optional().isInt({ min: 60, max: 600 }),
    body('teamSize').optional().isInt({ min: 1, max: 5 }),
    body('message').optional().isLength({ max: 280 }),
  ],
  validate,
  ctrl.sendInvitation
);
router.post('/invitations/:id/accept',
  [param('id').notEmpty()],
  validate,
  ctrl.acceptInvitation
);
router.post('/invitations/:id/reject',
  [param('id').notEmpty()],
  validate,
  ctrl.rejectInvitation
);
router.post('/invitations/:id/cancel',
  [param('id').notEmpty()],
  validate,
  ctrl.cancelInvitation
);

// ─── LEADERBOARDS / SEASONS / TOURNAMENTS ─────────────────────────────────────
router.get('/leaderboards',  ctrl.getLeaderboards);
router.get('/seasons',       ctrl.getSeasons);
router.get('/tournaments',   ctrl.getTournaments);

// ─── USER DATA ────────────────────────────────────────────────────────────────
router.get('/history',           ctrl.getHistory);
router.get('/stats/:userId',     ctrl.getUserStats);
router.get('/achievements',      ctrl.getAchievements);
router.get('/missions',          ctrl.getMissions);
router.get('/active-by-room',    ctrl.getActiveByRoom);   // GET /pk/active-by-room?roomId=xxx

// ─── MATCH CREATION ───────────────────────────────────────────────────────────
router.post('/',
  pkWriteLimiter,
  [
    body('sideBUserId').notEmpty().withMessage('sideBUserId is required'),
    body('type').optional().isIn(['ONE_V_ONE', 'ROOM_V_ROOM', 'TEAM_V_TEAM', 'CLUB_V_CLUB', 'TOURNAMENT']),
    body('durationSeconds').optional().isInt({ min: 60, max: 600 }),
  ],
  validate,
  ctrl.createPK
);

// ─── MATCH OPERATIONS ─────────────────────────────────────────────────────────
router.get('/:id',            ctrl.getPK);
router.get('/:id/reconnect',  ctrl.reconnect);

router.post('/:id/start',
  pkWriteLimiter,
  ctrl.startPK
);
router.post('/:id/end',
  pkWriteLimiter,
  ctrl.endPK
);
router.post('/:id/abort',
  // F-3 FIX: PK battle administration is a PLATFORM-LEVEL operation.
  // SCHOOL_ADMIN must not control PK battles of users from other schools.
  authorize('SUPER_ADMIN'),
  [body('reason').optional().isString()],
  validate,
  ctrl.abortPK
);
router.post('/:id/pause',
  // F-3 FIX: Same — platform operation, SUPER_ADMIN only.
  authorize('SUPER_ADMIN'),
  ctrl.pausePK
);
router.post('/:id/resume',
  // F-3 FIX: Same — platform operation, SUPER_ADMIN only.
  authorize('SUPER_ADMIN'),
  ctrl.resumePK
);
router.post('/:id/rematch',
  pkWriteLimiter,
  ctrl.rematch
);
router.post('/:id/vote',
  voteLimiter,
  [body('side').isIn(['A', 'B']).withMessage('side must be A or B')],
  validate,
  ctrl.vote
);

module.exports = router;
