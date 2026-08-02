/**
 * Voice Room Member Routes
 * Mounted at /api/v1/voice/:id/members
 */
const router = require('express').Router({ mergeParams: true });
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const {
  requestJoin, approveRequest, rejectRequest, leaveRoom,
  getMembershipStatus, getPendingRequests, listMembers,
  setMemberRole, removeMember, blockMember, unblockMember,
  upgradeMember, upgradeRoomLevel, heartbeat, getRoomLevelStats,
} = require('../controllers/room-member.controller');

router.use(authenticate);

// ── Membership self-service ───────────────────────────────────────────────────
router.get('/status',   getMembershipStatus);        // GET  /status
router.post('/join',    requestJoin);                 // POST /join  (creates PENDING or ACTIVE)
router.delete('/leave', leaveRoom);                   // DEL  /leave

// ── Heartbeat (keep online status alive) ──────────────────────────────────────
router.post('/heartbeat', heartbeat);                 // POST /heartbeat

// ── Room level ────────────────────────────────────────────────────────────────
router.get('/level-stats', getRoomLevelStats);        // GET  /level-stats
router.patch('/room-level',
  [body('level').isInt({ min: 1, max: 10 })],
  validate, upgradeRoomLevel                          // PATCH /room-level
);

// ── List & Pending ────────────────────────────────────────────────────────────
router.get('/',        listMembers);                  // GET  /  ?search=&role=&sortBy=&order=&page=&limit=
router.get('/pending', getPendingRequests);           // GET  /pending

// ── Per-member management ──────────────────────────────────────────────────────
router.post('/:userId/approve', approveRequest);      // POST /:userId/approve
router.delete('/:userId/reject', rejectRequest);      // DEL  /:userId/reject
router.patch('/:userId/role',
  [body('role').isIn(['CO_OWNER','ADMIN','MODERATOR','VIP','OFFICIAL','MEMBER'])],
  validate, setMemberRole                             // PATCH /:userId/role
);
router.patch('/:userId/member-level',
  [body('memberLevel').isInt({ min: 1, max: 5 })],
  validate, upgradeMember                             // PATCH /:userId/member-level
);
router.delete('/:userId/remove', removeMember);       // DEL  /:userId/remove
router.patch('/:userId/block',   blockMember);        // PATCH /:userId/block
router.patch('/:userId/unblock', unblockMember);      // PATCH /:userId/unblock

module.exports = router;
