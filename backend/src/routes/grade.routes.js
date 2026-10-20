'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const { eduMember, eduStaff } = require('../middleware/educationAuth');
const auditLog = require('../middleware/audit.middleware');
const ctrl = require('../controllers/grade.controller');

router.use(authenticate);

// Create / update grades — staff only
router.post('/',
  ...eduStaff,
  [
    body('studentId').notEmpty(),
    body('classId').notEmpty(),
    body('title').notEmpty(),
    body('type').isIn(['ASSIGNMENT', 'QUIZ', 'EXAM', 'ORAL_TEST', 'MEMORIZATION', 'PROJECT', 'PARTICIPATION', 'OTHER']),
    body('score').isFloat({ min: 0 }),
    body('maxScore').isFloat({ min: 1 })
  ],
  validate,
  auditLog('CREATE', 'grades'),
  ctrl.createGrade
);

router.post('/bulk', ...eduStaff,
  auditLog('CREATE', 'grades'),
  ctrl.bulkCreateGrades
);

// View grades — any school member
router.get('/student/:studentId', ...eduMember, ctrl.getStudentGrades);
router.get('/class/:classId',     ...eduMember, ctrl.getClassGrades);

router.put('/:id',
  ...eduStaff,
  auditLog('UPDATE', 'grades'),
  ctrl.updateGrade
);

router.delete('/:id',
  ...eduStaff,
  auditLog('DELETE', 'grades'),
  ctrl.deleteGrade
);

// Grade categories
router.get('/categories/:classId', ...eduMember, ctrl.getGradeCategories);
router.post('/categories',
  ...eduStaff,
  auditLog('CREATE', 'grade_categories'),
  ctrl.createGradeCategory
);

module.exports = router;
