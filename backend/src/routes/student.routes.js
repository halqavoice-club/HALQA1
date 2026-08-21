'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const { eduMember, eduAdmin } = require('../middleware/educationAuth');
const auditLog = require('../middleware/audit.middleware');
const ctrl = require('../controllers/student.controller');

router.use(authenticate);

// Any active school member can list/view students in their school
router.get('/',    ...eduMember, ctrl.listStudents);
router.get('/:id', ...eduMember, ctrl.getStudent);

// Admin-only mutations — all audited
router.post('/',
  ...eduAdmin,
  [
    body('email').isEmail().normalizeEmail(),
    body('firstName').trim().notEmpty(),
    body('lastName').trim().notEmpty(),
    body('studentId').trim().notEmpty()
  ],
  validate,
  auditLog('CREATE', 'students'),
  ctrl.createStudent
);

router.put('/:id',
  ...eduAdmin,
  auditLog('UPDATE', 'students'),
  ctrl.updateStudent
);

router.post('/:id/enroll',
  ...eduAdmin,
  [body('classId').notEmpty()], validate,
  auditLog('CREATE', 'enrollments'),
  ctrl.enrollStudent
);

router.delete('/:id/enroll/:classId',
  ...eduAdmin,
  auditLog('DELETE', 'enrollments'),
  ctrl.unenrollStudent
);

router.post('/:id/regenerate-qr', ...eduAdmin, ctrl.regenerateQr);

router.delete('/:id',
  ...eduAdmin,
  auditLog('DELETE', 'students'),
  ctrl.deleteStudent
);

module.exports = router;
