'use strict';
/**
 * Quiz Routes — mounted at /api/v1/quizzes
 *
 * All routes require authentication (authenticate) and school membership (eduMember).
 * Teacher write routes additionally require TEACHER or SCHOOL_ADMIN role (eduStaff).
 * Student-only routes enforce student isolation in the controller.
 */
const router  = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { eduMember, eduStaff } = require('../middleware/educationAuth');
const {
  validateZod,
  createQuizSchema,
  updateQuizSchema,
  addQuestionSchema,
  updateQuestionSchema,
  submitAnswersSchema,
  updateFeedbackSchema,
} = require('../middleware/validators/quiz.validator');
const ctrl = require('../controllers/quiz.controller');
const rateLimit = require('express-rate-limit');

// ─── Rate limiters ────────────────────────────────────────────────────────────
const writeLimiter = rateLimit({
  windowMs: 60_000,
  max:      30,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, please slow down' }
});

const submitLimiter = rateLimit({
  windowMs: 60_000,
  max:      5,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many submission attempts' }
});

// All routes require a valid JWT
router.use(authenticate);

// ─── Student routes (must come before /:id to avoid shadowing) ────────────────

// GET /quizzes/my?classId=   List OPEN quizzes for the student's enrolled classes
router.get('/my', ...eduMember, ctrl.listMyQuizzes);

// ─── Teacher / SCHOOL_ADMIN — Quiz CRUD ───────────────────────────────────────

// POST /quizzes                Create quiz (DRAFT)
router.post(
  '/',
  ...eduStaff,
  writeLimiter,
  validateZod(createQuizSchema),
  ctrl.createQuiz
);

// GET /quizzes?classId=        List quizzes for a class
router.get('/', ...eduMember, ctrl.listQuizzes);

// ─── Routes with :id ─────────────────────────────────────────────────────────

// GET /quizzes/:id             Get quiz with questions (teacher sees isCorrect)
router.get('/:id', ...eduMember, ctrl.getQuiz);

// PATCH /quizzes/:id           Update quiz settings
router.patch(
  '/:id',
  ...eduStaff,
  writeLimiter,
  validateZod(updateQuizSchema),
  ctrl.updateQuiz
);

// DELETE /quizzes/:id          Soft-delete quiz
router.delete('/:id', ...eduStaff, writeLimiter, ctrl.deleteQuiz);

// ─── Questions ────────────────────────────────────────────────────────────────

// POST /quizzes/:id/questions
router.post(
  '/:id/questions',
  ...eduStaff,
  writeLimiter,
  validateZod(addQuestionSchema),
  ctrl.addQuestion
);

// PATCH /quizzes/:id/questions/:qid
router.patch(
  '/:id/questions/:qid',
  ...eduStaff,
  writeLimiter,
  validateZod(updateQuestionSchema),
  ctrl.updateQuestion
);

// DELETE /quizzes/:id/questions/:qid
router.delete('/:id/questions/:qid', ...eduStaff, writeLimiter, ctrl.deleteQuestion);

// ─── Status transitions ───────────────────────────────────────────────────────

// PATCH /quizzes/:id/publish
router.patch('/:id/publish', ...eduStaff, writeLimiter, ctrl.publishQuiz);

// PATCH /quizzes/:id/close
router.patch('/:id/close', ...eduStaff, writeLimiter, ctrl.closeQuizEndpoint);

// PATCH /quizzes/:id/reopen
router.patch('/:id/reopen', ...eduStaff, writeLimiter, ctrl.reopenQuiz);

// ─── Results (Teacher / SCHOOL_ADMIN) ─────────────────────────────────────────

// GET /quizzes/:id/results
router.get('/:id/results', ...eduStaff, ctrl.getResults);

// GET /quizzes/:id/results/export
router.get('/:id/results/export', ...eduStaff, ctrl.exportResults);

// POST /quizzes/:id/record-grades
router.post('/:id/record-grades', ...eduStaff, writeLimiter, ctrl.recordGradesEndpoint);

// PATCH /quizzes/:id/attempts/:aid    Update feedback on an attempt
router.patch(
  '/:id/attempts/:aid',
  ...eduStaff,
  writeLimiter,
  validateZod(updateFeedbackSchema),
  ctrl.updateFeedback
);

// ─── Student endpoints ────────────────────────────────────────────────────────

// GET /quizzes/:id/take        Questions without isCorrect (student view)
router.get('/:id/take', ...eduMember, ctrl.getQuizForTaking);

// POST /quizzes/:id/start      Create IN_PROGRESS attempt
router.post('/:id/start', ...eduMember, writeLimiter, ctrl.startAttempt);

// POST /quizzes/:id/submit     Submit answers + trigger auto-score
router.post(
  '/:id/submit',
  ...eduMember,
  submitLimiter,
  validateZod(submitAnswersSchema),
  ctrl.submitAttempt
);

// GET /quizzes/:id/my-result   Student's own result
router.get('/:id/my-result', ...eduMember, ctrl.getMyResult);

module.exports = router;
