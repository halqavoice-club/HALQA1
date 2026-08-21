'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const { eduMember, eduStaff } = require('../middleware/educationAuth');
const auditLog = require('../middleware/audit.middleware');
const ctrl = require('../controllers/attendance.controller');

router.use(authenticate);

// Mark attendance — teacher or admin
router.post('/',
  ...eduStaff,
  [
    body('classId').notEmpty(),
    body('studentId').notEmpty(),
    body('date').isISO8601(),
    body('status').isIn(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'LEFT_EARLY'])
  ],
  validate,
  auditLog('CREATE', 'attendance'),
  ctrl.markAttendance
);

router.post('/bulk',
  ...eduStaff,
  [
    body('classId').notEmpty(),
    body('date').isISO8601(),
    body('records').isArray({ min: 1 })
  ],
  validate,
  auditLog('CREATE', 'attendance'),
  ctrl.bulkMarkAttendance
);

// QR check-in — any school member (student self-check-in)
router.post('/qr-checkin',
  ...eduMember,
  [body('qrCode').notEmpty(), body('classId').notEmpty()],
  validate,
  ctrl.qrCheckIn
);

// Read — any school member can view attendance relevant to them
router.get('/class/:classId',     ...eduMember, ctrl.getClassAttendance);
router.get('/student/:studentId', ...eduMember, ctrl.getStudentAttendance);
router.get('/analytics',          ...eduMember, ctrl.getAttendanceAnalytics);
router.get('/report',             ...eduStaff,  ctrl.getAttendanceReport);

// Update / delete — staff only
router.put('/:id',
  ...eduStaff,
  [body('status').isIn(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'LEFT_EARLY'])],
  validate,
  auditLog('UPDATE', 'attendance'),
  ctrl.updateAttendance
);

router.delete('/:id',
  ...eduStaff,
  auditLog('DELETE', 'attendance'),
  ctrl.deleteAttendance
);

module.exports = router;
