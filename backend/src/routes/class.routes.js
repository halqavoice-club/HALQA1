const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/class.controller');

router.use(authenticate);

router.get('/', ctrl.listClasses);
router.get('/:id', ctrl.getClass);
router.get('/:id/students', ctrl.getClassStudents);

router.post('/',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  [body('name').trim().notEmpty()],
  validate,
  ctrl.createClass
);

router.put('/:id', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), ctrl.updateClass);
router.delete('/:id', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), ctrl.deleteClass);

module.exports = router;
