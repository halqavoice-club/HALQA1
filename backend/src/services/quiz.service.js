'use strict';
/**
 * Quiz Service — core business logic for the Practice Quiz feature.
 *
 * Functions:
 *   autoScore(attemptId)              — score MC questions, set attempt.score
 *   closeQuiz(quizId)                 — set CLOSED + auto-score pending attempts
 *   scheduleAutoClose(quizId, closeAt)— setTimeout stored in module-level Map
 *   cancelAutoClose(quizId)           — clear existing timer
 *   recordGrades(quizId, teacherUserId) — upsert Grade per SUBMITTED attempt
 *
 * Pattern reference: backend/src/controllers/live-class.controller.js
 * (scheduleAutoEnd / cancelAutoEnd for the same setTimeout+Map approach)
 */
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

// ─── Auto-close timer registry ────────────────────────────────────────────────
// Maps quizId → NodeJS.Timeout so we can cancel when quiz is manually closed
// or deleted before the scheduled time.
const _autoCloseTimers = new Map();

// ─── autoScore ────────────────────────────────────────────────────────────────
/**
 * Scores all MULTIPLE_CHOICE questions in an attempt.
 * SHORT_ANSWER questions are left with isCorrect = null (teacher review).
 * Sets attempt.score as percentage (0–100).  If no MC questions exist, score = null.
 *
 * @param {string} attemptId
 */
async function autoScore(attemptId) {
  try {
    // Load all answers with their question type and the correct option
    const answers = await prisma.quizAnswer.findMany({
      where: { attemptId },
      include: {
        question: {
          include: {
            options: { where: { isCorrect: true }, select: { id: true } }
          }
        }
      }
    });

    if (answers.length === 0) return;

    let mcTotal = 0;
    let mcCorrect = 0;
    const answerUpdates = [];

    for (const answer of answers) {
      if (answer.question.questionType === 'MULTIPLE_CHOICE') {
        mcTotal++;
        const correctOptionId = answer.question.options[0]?.id ?? null;
        const isCorrect = correctOptionId !== null &&
          answer.selectedOptionId === correctOptionId;
        if (isCorrect) mcCorrect++;
        answerUpdates.push(
          prisma.quizAnswer.update({
            where: { id: answer.id },
            data: { isCorrect }
          })
        );
      }
      // SHORT_ANSWER: leave isCorrect = null, no update needed
    }

    const score = mcTotal > 0 ? (mcCorrect / mcTotal) * 100 : null;

    await prisma.$transaction([
      ...answerUpdates,
      prisma.quizAttempt.update({
        where: { id: attemptId },
        data: { score, status: 'SUBMITTED' }
      })
    ]);

    logger.info(`[quiz.service] autoScore complete — attempt ${attemptId}: score=${score}`);
  } catch (err) {
    logger.error(`[quiz.service] autoScore failed for attempt ${attemptId}: ${err.message}`);
    throw err;
  }
}

// ─── closeQuiz ────────────────────────────────────────────────────────────────
/**
 * Sets quiz status to CLOSED and auto-scores all IN_PROGRESS attempts
 * (treating them as TIMED_OUT / force-submitted).
 *
 * @param {string} quizId
 */
async function closeQuiz(quizId) {
  try {
    // Mark quiz CLOSED
    await prisma.quiz.update({
      where: { id: quizId },
      data: { status: 'CLOSED' }
    });

    // Find all attempts still in progress or not yet scored
    const pendingAttempts = await prisma.quizAttempt.findMany({
      where: {
        quizId,
        status: { in: ['IN_PROGRESS', 'SUBMITTED'] },
        score: null
      },
      select: { id: true }
    });

    for (const attempt of pendingAttempts) {
      try {
        await autoScore(attempt.id);
      } catch (scoreErr) {
        // Don't block other attempts if one fails
        logger.warn(`[quiz.service] autoScore failed for attempt ${attempt.id} during closeQuiz: ${scoreErr.message}`);
      }
    }

    // Cancel any pending auto-close timer
    cancelAutoClose(quizId);
    logger.info(`[quiz.service] Quiz ${quizId} closed — ${pendingAttempts.length} attempts scored`);
  } catch (err) {
    logger.error(`[quiz.service] closeQuiz failed for quiz ${quizId}: ${err.message}`);
    throw err;
  }
}

// ─── scheduleAutoClose ────────────────────────────────────────────────────────
/**
 * Schedules a quiz to auto-close at closeAt.
 * Cancels any existing timer for this quiz first.
 * Same pattern as live-class.controller.js scheduleAutoEnd().
 *
 * @param {string}   quizId
 * @param {Date}     closeAt
 */
function scheduleAutoClose(quizId, closeAt) {
  cancelAutoClose(quizId); // clear any existing timer first

  const delay = new Date(closeAt).getTime() - Date.now();
  if (delay <= 0) {
    // Already past the close time — close immediately
    setImmediate(() => closeQuiz(quizId).catch(err =>
      logger.error(`[quiz.service] scheduleAutoClose immediate close failed: ${err.message}`)
    ));
    return;
  }

  const timer = setTimeout(() => {
    _autoCloseTimers.delete(quizId);
    closeQuiz(quizId).catch(err =>
      logger.error(`[quiz.service] scheduleAutoClose timer fired but closeQuiz failed for ${quizId}: ${err.message}`)
    );
  }, delay);

  // Allow Node to exit even if timer is pending (non-blocking)
  if (timer.unref) timer.unref();

  _autoCloseTimers.set(quizId, timer);
  logger.info(`[quiz.service] Auto-close scheduled for quiz ${quizId} in ${Math.round(delay / 1000)}s`);
}

// ─── cancelAutoClose ──────────────────────────────────────────────────────────
/**
 * Cancels the auto-close timer for a quiz, if one exists.
 *
 * @param {string} quizId
 */
function cancelAutoClose(quizId) {
  const existing = _autoCloseTimers.get(quizId);
  if (existing) {
    clearTimeout(existing);
    _autoCloseTimers.delete(quizId);
    logger.info(`[quiz.service] Auto-close timer cancelled for quiz ${quizId}`);
  }
}

// ─── recordGrades ─────────────────────────────────────────────────────────────
/**
 * Creates or updates a Grade record for each SUBMITTED attempt in a quiz.
 * Uses prisma.grade.upsert to avoid duplicates on repeated calls.
 * Grade type = 'quiz', title = 'Quiz: <quizTitle>'.
 *
 * @param {string} quizId
 * @param {string} teacherUserId  — User.id of the teacher calling this
 */
async function recordGrades(quizId, teacherUserId) {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: { title: true, classId: true, teacherId: true }
  });
  if (!quiz) throw new Error('Quiz not found');

  const attempts = await prisma.quizAttempt.findMany({
    where: { quizId, status: 'SUBMITTED' },
    select: { id: true, studentId: true, score: true, submittedAt: true }
  });

  const results = [];
  for (const attempt of attempts) {
    const score = attempt.score ?? 0;
    const gradeTitle = `Quiz: ${quiz.title}`;

    // Use findFirst + create/update instead of upsert because there is no
    // compound unique constraint on (studentId, classId, title, type).
    const existing = await prisma.grade.findFirst({
      where: {
        studentId: attempt.studentId,
        classId:   quiz.classId,
        title:     gradeTitle,
        type:      'quiz',
        deletedAt: null,
      },
      select: { id: true }
    });

    let grade;
    if (existing) {
      grade = await prisma.grade.update({
        where: { id: existing.id },
        data: {
          score,
          percentage:  score,
          gradedAt:    attempt.submittedAt ?? new Date()
        }
      });
    } else {
      grade = await prisma.grade.create({
        data: {
          studentId:   attempt.studentId,
          classId:     quiz.classId,
          teacherId:   quiz.teacherId,
          title:       gradeTitle,
          type:        'quiz',
          score,
          maxScore:    100,
          weight:      1.0,
          percentage:  score,
          gradedAt:    attempt.submittedAt ?? new Date()
        }
      });
    }
    results.push(grade);
  }

  logger.info(`[quiz.service] recordGrades: ${results.length} grades upserted for quiz ${quizId}`);
  return results;
}

module.exports = {
  autoScore,
  closeQuiz,
  scheduleAutoClose,
  cancelAutoClose,
  recordGrades
};
