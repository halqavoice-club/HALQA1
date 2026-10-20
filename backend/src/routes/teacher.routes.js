'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const { eduMember, eduAdmin } = require('../middleware/educationAuth');
const auditLog = require('../middleware/audit.middleware');
const ctrl = require('../controllers/teacher.controller');

router.use(authenticate);

router.get('/',    ...eduMember, ctrl.listTeachers);
router.get('/:id', ...eduMember, ctrl.getTeacher);

router.post('/',
  ...eduAdmin,
  [
    // email/firstName/lastName are optional when linkedUserId is provided (existing HALQA user)
    body('email').if(body('linkedUserId').not().exists()).isEmail().normalizeEmail(),
    body('email').if(body('linkedUserId').exists()).optional().isEmail().normalizeEmail(),
    body('firstName').if(body('linkedUserId').not().exists()).trim().notEmpty(),
    body('lastName').if(body('linkedUserId').not().exists()).trim().notEmpty(),
  ],
  validate,
  auditLog('CREATE', 'teachers'),
  ctrl.createTeacher
);

router.put('/:id',
  ...eduAdmin,
  auditLog('UPDATE', 'teachers'),
  ctrl.updateTeacher
);

router.post('/:id/classes',
  ...eduAdmin,
  [body('classId').notEmpty()], validate,
  auditLog('CREATE', 'teacher_classes'),
  ctrl.assignClass
);

router.delete('/:id/classes/:classId',
  ...eduAdmin,
  auditLog('DELETE', 'teacher_classes'),
  ctrl.unassignClass
);

router.delete('/:id',
  ...eduAdmin,
  auditLog('DELETE', 'teachers'),
  ctrl.deleteTeacher
);

module.exports = router;
