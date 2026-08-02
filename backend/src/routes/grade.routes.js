const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/grade.controller');

router.use(authenticate);

router.post('/',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  [
    body('studentId').notEmpty(),
    body('classId').notEmpty(),
    body('title').notEmpty(),
    body('type').isIn(['ASSIGNMENT', 'QUIZ', 'EXAM', 'ORAL_TEST', 'MEMORIZATION', 'PROJECT', 'PARTICIPATION', 'OTHER']),
    body('score').isFloat({ min: 0 }),
    body('maxScore').isFloat({ min: 1 })
  ],
  validate,
  ctrl.createGrade
);

router.post('/bulk',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  ctrl.bulkCreateGrades
);

router.get('/student/:studentId', ctrl.getStudentGrades);
router.get('/class/:classId', ctrl.getClassGrades);

router.put('/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  ctrl.updateGrade
);

router.delete('/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  ctrl.deleteGrade
);

// Grade categories
router.get('/categories/:classId', ctrl.getGradeCategories);
router.post('/categories',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  ctrl.createGradeCategory
);

module.exports = router;
