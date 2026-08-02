const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/attendance.controller');

router.use(authenticate);

router.post('/',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  [
    body('classId').notEmpty(),
    body('studentId').notEmpty(),
    body('date').isISO8601(),
    body('status').isIn(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'LEFT_EARLY'])
  ],
  validate,
  ctrl.markAttendance
);

router.post('/bulk',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  [
    body('classId').notEmpty(),
    body('date').isISO8601(),
    body('records').isArray({ min: 1 })
  ],
  validate,
  ctrl.bulkMarkAttendance
);

router.post('/qr-checkin',
  [body('qrCode').notEmpty(), body('classId').notEmpty()],
  validate,
  ctrl.qrCheckIn
);

router.get('/class/:classId', ctrl.getClassAttendance);
router.get('/student/:studentId', ctrl.getStudentAttendance);
router.get('/analytics', ctrl.getAttendanceAnalytics);
router.get('/report', ctrl.getAttendanceReport);

// Update — teacher can only update own records, admin can update any
router.put('/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  [body('status').isIn(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'LEFT_EARLY'])],
  validate,
  ctrl.updateAttendance
);

// Delete — teacher can only delete own records, admin can delete any
router.delete('/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  ctrl.deleteAttendance
);

module.exports = router;
