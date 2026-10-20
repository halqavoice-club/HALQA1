'use strict';
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { eduMember, eduStaff } = require('../middleware/educationAuth');
const examController = require('../controllers/exam.controller');

router.use(authenticate);

router.post('/submissions',           ...eduMember, examController.createExamSubmission);
router.post('/submissions/:id/submit', ...eduMember, examController.submitExam);
router.post('/submissions/:id/auto-grade', ...eduStaff, examController.autoGradeExam);
router.get('/students/:studentId/submissions', ...eduMember, examController.getStudentExamSubmissions);
router.get('/grades/:gradeId/submissions',     ...eduStaff,  examController.getGradeExamSubmissions);
router.post('/submissions/:id/grade',          ...eduStaff,  examController.gradeExamSubmission);
router.get('/submissions/:id',    ...eduMember, examController.getExamSubmission);
router.put('/submissions/:id',    ...eduMember, examController.updateExamSubmission);
router.delete('/submissions/:id', ...eduMember, examController.deleteExamSubmission);

module.exports = router;
