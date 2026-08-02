/**
 * Assignment Submission Routes
 * 
 * API endpoints for assignment submission management
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const assignmentController = require('../controllers/assignment.controller');

// All routes require authentication
router.use(authenticate);

/**
 * @route   POST /api/v1/assignments/submissions
 * @desc    Create a new assignment submission
 * @access  Private
 */
router.post('/submissions', assignmentController.createAssignmentSubmission);

/**
 * @route   POST /api/v1/assignments/submissions/:id/submit
 * @desc    Submit an assignment
 * @access  Private (student only)
 */
router.post('/submissions/:id/submit', assignmentController.submitAssignment);

/**
 * @route   GET /api/v1/assignments/students/:studentId/submissions
 * @desc    Get assignment submissions for a student
 * @access  Private (student or teacher/admin)
 */
router.get('/students/:studentId/submissions', assignmentController.getStudentSubmissions);

/**
 * @route   GET /api/v1/assignments/grades/:gradeId/submissions
 * @desc    Get submissions for a grade/class
 * @access  Private (teacher/admin only)
 */
router.get('/grades/:gradeId/submissions', assignmentController.getGradeSubmissions);

/**
 * @route   POST /api/v1/assignments/submissions/:id/grade
 * @desc    Grade an assignment submission
 * @access  Private (teacher/admin only)
 */
router.post('/submissions/:id/grade', assignmentController.gradeSubmission);

/**
 * @route   GET /api/v1/assignments/submissions/:id
 * @desc    Get a specific assignment submission
 * @access  Private (student or teacher/admin)
 */
router.get('/submissions/:id', assignmentController.getSubmission);

/**
 * @route   PUT /api/v1/assignments/submissions/:id
 * @desc    Update an assignment submission
 * @access  Private (student only, draft only)
 */
router.put('/submissions/:id', assignmentController.updateSubmission);

/**
 * @route   DELETE /api/v1/assignments/submissions/:id
 * @desc    Delete an assignment submission
 * @access  Private (student only, draft only)
 */
router.delete('/submissions/:id', assignmentController.deleteSubmission);

module.exports = router;
