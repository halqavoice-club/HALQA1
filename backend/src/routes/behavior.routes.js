'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const { eduMember, eduStaff } = require('../middleware/educationAuth');
const ctrl = require('../controllers/behavior.controller');

router.use(authenticate);

router.post('/',
  ...eduStaff,
  [
    body('studentId').notEmpty(),
    body('type').isIn(['POSITIVE', 'NEGATIVE']),
    body('category').notEmpty(),
    body('points').isInt({ min: -99, max: 99 })
  ],
  validate,
  ctrl.createBehaviorLog
);

router.get('/student/:studentId', ...eduMember, ctrl.getStudentBehavior);
router.get('/summary',            ...eduMember, ctrl.getBehaviorSummary);

router.put('/:id',    ...eduStaff, ctrl.updateBehaviorLog);
router.delete('/:id', ...eduStaff, ctrl.deleteBehaviorLog);

module.exports = router;
