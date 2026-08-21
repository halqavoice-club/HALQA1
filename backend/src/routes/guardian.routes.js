'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const { eduMember, eduAdmin } = require('../middleware/educationAuth');
const ctrl = require('../controllers/guardian.controller');

router.use(authenticate);

router.get('/',    ...eduMember, ctrl.listGuardians);
router.get('/:id', ...eduMember, ctrl.getGuardian);

router.post('/',
  ...eduAdmin,
  [
    body('email').isEmail().normalizeEmail(),
    body('firstName').trim().notEmpty(),
    body('lastName').trim().notEmpty()
  ],
  validate,
  ctrl.createGuardian
);

router.put('/:id',                         ...eduAdmin, ctrl.updateGuardian);
router.post('/:id/students',               ...eduAdmin,
  [body('studentId').notEmpty()], validate,
  ctrl.linkStudent
);
router.delete('/:id/students/:studentId',  ...eduAdmin, ctrl.unlinkStudent);
router.delete('/:id',                      ...eduAdmin, ctrl.deleteGuardian);

module.exports = router;
