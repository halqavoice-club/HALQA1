'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const { eduMember, eduAdmin } = require('../middleware/educationAuth');
const auditLog = require('../middleware/audit.middleware');
const ctrl = require('../controllers/class.controller');

router.use(authenticate);

router.get('/',              ...eduMember, ctrl.listClasses);
router.get('/:id',           ...eduMember, ctrl.getClass);
router.get('/:id/students',  ...eduMember, ctrl.getClassStudents);

router.post('/',
  ...eduAdmin,
  [body('name').trim().notEmpty()],
  validate,
  auditLog('CREATE', 'classes'),
  ctrl.createClass
);

router.put('/:id',
  ...eduAdmin,
  auditLog('UPDATE', 'classes'),
  ctrl.updateClass
);

router.delete('/:id',
  ...eduAdmin,
  auditLog('DELETE', 'classes'),
  ctrl.deleteClass
);

module.exports = router;
