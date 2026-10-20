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
// GET /attendance/student/me — student views their own attendance without knowing student record ID
// Must be registered BEFORE /student/:studentId to avoid "me" being treated as an ID
router.get('/student/me', ...eduMember, async (req, res, next) => {
  try {
    const schoolId = req.schoolId || req.user.schoolId;
    const student = await require('../utils/prisma').student.findFirst({
      where: { userId: req.user.id, deletedAt: null, ...(schoolId && { schoolId }) },
      select: { id: true }
    });
    if (!student) {
      return require('../utils/response').errorResponse(res, 'No student record found for your account', 404);
    }
    req.params = { ...req.params, studentId: student.id };
    return ctrl.getStudentAttendance(req, res, next);
  } catch (error) { next(error); }
});
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
