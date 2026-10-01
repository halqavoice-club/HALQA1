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
    // email/firstName/lastName optional when linkedUserId is provided (existing HALQA user)
    body('email').if(body('linkedUserId').not().exists()).isEmail().normalizeEmail(),
    body('email').if(body('linkedUserId').exists()).optional().isEmail().normalizeEmail(),
    body('firstName').if(body('linkedUserId').not().exists()).trim().notEmpty(),
    body('lastName').if(body('linkedUserId').not().exists()).trim().notEmpty(),
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
