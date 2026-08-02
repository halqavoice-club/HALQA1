const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/behavior.controller');

router.use(authenticate);

router.post('/',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  [
    body('studentId').notEmpty(),
    body('type').isIn(['POSITIVE', 'NEGATIVE']),
    body('category').notEmpty(),
    body('points').isInt({ min: -99, max: 99 })
  ],
  validate,
  ctrl.createBehaviorLog
);

router.get('/student/:studentId', ctrl.getStudentBehavior);
router.get('/summary', ctrl.getBehaviorSummary);

router.put('/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  ctrl.updateBehaviorLog
);

router.delete('/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  ctrl.deleteBehaviorLog
);

module.exports = router;
