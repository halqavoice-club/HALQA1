/**
 * PK Admin Routes — /api/v1/admin/pk
 * All routes require SUPER_ADMIN or SCHOOL_ADMIN authentication.
 * Every action is audited in pk_audit_logs.
 */

'use strict';

const router   = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ctrl     = require('../controllers/pk.admin.controller');

const ADMIN_ROLES = ['SUPER_ADMIN'];
// F-3 FIX: PK admin management is a PLATFORM-LEVEL operation.
// This includes PK config, seasons, tournaments, and per-match admin actions.
// SCHOOL_ADMIN must not have access — PK is a Social feature that spans all users,
// not scoped to a single school. Only HALQA platform admins (SUPER_ADMIN) should
// control platform-wide PK configuration and match administration.

router.use(authenticate);
router.use(authorize(...ADMIN_ROLES));

// ─── Active PKs ───────────────────────────────────────────────────────────────
router.get('/active',           ctrl.listActivePKs);
router.get('/search',           ctrl.searchPKs);
router.get('/suspicious',       ctrl.getSuspiciousPKs);

// ─── PK Config ────────────────────────────────────────────────────────────────
router.get('/config',           ctrl.getPKConfig);
router.patch('/config',         ctrl.updatePKConfig);

// ─── Season Management ────────────────────────────────────────────────────────
router.post('/seasons',
  [
    body('name').notEmpty(),
    body('startDate').isISO8601(),
    body('endDate').isISO8601(),
  ],
  validate,
  ctrl.createSeason
);
router.patch('/seasons/:id',    ctrl.updateSeason);

// ─── Tournament Management ────────────────────────────────────────────────────
router.post('/tournaments',
  [
    body('name').notEmpty(),
    body('startDate').isISO8601(),
    body('endDate').isISO8601(),
  ],
  validate,
  ctrl.createTournament
);

// ─── Per-match admin actions ──────────────────────────────────────────────────
router.get('/:id',              ctrl.getPKDetail);
router.post('/:id/force-end',   ctrl.forceEndPK);
router.post('/:id/disqualify',
  [body('userId').notEmpty(), body('reason').optional().isString()],
  validate,
  ctrl.disqualify
);
router.post('/:id/dispute',
  [body('reason').notEmpty()],
  validate,
  ctrl.markDisputed
);
router.get('/:id/audit',        ctrl.getPKAuditLog);
router.get('/audit/all',        ctrl.getPKAuditLog);

module.exports = router;
