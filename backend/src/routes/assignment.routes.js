'use strict';
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { eduMember, eduStaff } = require('../middleware/educationAuth');
const assignmentController = require('../controllers/assignment.controller');

router.use(authenticate);

// Create submission — any school member (typically student)
router.post('/submissions', ...eduMember, assignmentController.createAssignmentSubmission);
// Submit — school member
router.post('/submissions/:id/submit', ...eduMember, assignmentController.submitAssignment);
// View student submissions — member (student sees own; teacher/admin sees all)
router.get('/students/:studentId/submissions', ...eduMember, assignmentController.getStudentSubmissions);
// Grade submissions — staff only
router.get('/grades/:gradeId/submissions', ...eduStaff, assignmentController.getGradeSubmissions);
router.post('/submissions/:id/grade',      ...eduStaff, assignmentController.gradeSubmission);
// View single
router.get('/submissions/:id', ...eduMember, assignmentController.getSubmission);
// Update / delete — member (own drafts only, enforced in controller)
router.put('/submissions/:id',    ...eduMember, assignmentController.updateSubmission);
router.delete('/submissions/:id', ...eduMember, assignmentController.deleteSubmission);

module.exports = router;
