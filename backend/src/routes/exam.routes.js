/**
 * Exam Submission Routes
 * 
 * API endpoints for exam submission management
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const examController = require('../controllers/exam.controller');

// All routes require authentication
router.use(authenticate);

/**
 * @route   POST /api/v1/exams/submissions
 * @desc    Create a new exam submission
 * @access  Private
 */
router.post('/submissions', examController.createExamSubmission);

/**
 * @route   POST /api/v1/exams/submissions/:id/submit
 * @desc    Submit an exam
 * @access  Private (student only)
 */
router.post('/submissions/:id/submit', examController.submitExam);

/**
 * @route   POST /api/v1/exams/submissions/:id/auto-grade
 * @desc    Auto-grade an exam submission
 * @access  Private (teacher/admin only)
 */
router.post('/submissions/:id/auto-grade', examController.autoGradeExam);

/**
 * @route   GET /api/v1/exams/students/:studentId/submissions
 * @desc    Get exam submissions for a student
 * @access  Private (student or teacher/admin)
 */
router.get('/students/:studentId/submissions', examController.getStudentExamSubmissions);

/**
 * @route   GET /api/v1/exams/grades/:gradeId/submissions
 * @desc    Get submissions for a grade/class
 * @access  Private (teacher/admin only)
 */
router.get('/grades/:gradeId/submissions', examController.getGradeExamSubmissions);

/**
 * @route   POST /api/v1/exams/submissions/:id/grade
 * @desc    Manually grade an exam submission
 * @access  Private (teacher/admin only)
 */
router.post('/submissions/:id/grade', examController.gradeExamSubmission);

/**
 * @route   GET /api/v1/exams/submissions/:id
 * @desc    Get a specific exam submission
 * @access  Private (student or teacher/admin)
 */
router.get('/submissions/:id', examController.getExamSubmission);

/**
 * @route   PUT /api/v1/exams/submissions/:id
 * @desc    Update an exam submission
 * @access  Private (student only, draft only)
 */
router.put('/submissions/:id', examController.updateExamSubmission);

/**
 * @route   DELETE /api/v1/exams/submissions/:id
 * @desc    Delete an exam submission
 * @access  Private (student only, draft only)
 */
router.delete('/submissions/:id', examController.deleteExamSubmission);

module.exports = router;
