const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/teacher.controller');

router.use(authenticate);

router.get('/', ctrl.listTeachers);
router.get('/:id', ctrl.getTeacher);

router.post('/',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  [
    body('email').isEmail().normalizeEmail(),
    body('firstName').trim().notEmpty(),
    body('lastName').trim().notEmpty()
  ],
  validate,
  ctrl.createTeacher
);

router.put('/:id', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), ctrl.updateTeacher);

router.post('/:id/classes',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  [body('classId').notEmpty()],
  validate,
  ctrl.assignClass
);

router.delete('/:id/classes/:classId', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), ctrl.unassignClass);
router.delete('/:id', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), ctrl.deleteTeacher);

module.exports = router;
