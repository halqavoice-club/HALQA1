const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/guardian.controller');

router.use(authenticate);

router.get('/', ctrl.listGuardians);
router.get('/:id', ctrl.getGuardian);

router.post('/',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  [
    body('email').isEmail().normalizeEmail(),
    body('firstName').trim().notEmpty(),
    body('lastName').trim().notEmpty()
  ],
  validate,
  ctrl.createGuardian
);

router.put('/:id', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), ctrl.updateGuardian);

router.post('/:id/students',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  [body('studentId').notEmpty()],
  validate,
  ctrl.linkStudent
);

router.delete('/:id/students/:studentId', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), ctrl.unlinkStudent);
router.delete('/:id', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), ctrl.deleteGuardian);

module.exports = router;
