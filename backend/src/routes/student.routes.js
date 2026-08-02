const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/student.controller');

router.use(authenticate);

router.get('/', ctrl.listStudents);
router.get('/:id', ctrl.getStudent);

router.post('/',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  [
    body('email').isEmail().normalizeEmail(),
    body('firstName').trim().notEmpty(),
    body('lastName').trim().notEmpty(),
    body('studentId').trim().notEmpty()
  ],
  validate,
  ctrl.createStudent
);

router.put('/:id', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), ctrl.updateStudent);

router.post('/:id/enroll',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  [body('classId').notEmpty()],
  validate,
  ctrl.enrollStudent
);

router.delete('/:id/enroll/:classId', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), ctrl.unenrollStudent);
router.post('/:id/regenerate-qr', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), ctrl.regenerateQr);
router.delete('/:id', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), ctrl.deleteStudent);

module.exports = router;
