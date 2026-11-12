'use strict';
/**
 * Quiz Controller — Practice Quiz feature
 *
 * Endpoints:
 *   Teacher / SCHOOL_ADMIN:
 *     POST   /quizzes                          createQuiz
 *     GET    /quizzes                          listQuizzes
 *     GET    /quizzes/:id                      getQuiz
 *     PATCH  /quizzes/:id                      updateQuiz
 *     DELETE /quizzes/:id                      deleteQuiz
 *     POST   /quizzes/:id/questions            addQuestion
 *     PATCH  /quizzes/:id/questions/:qid       updateQuestion
 *     DELETE /quizzes/:id/questions/:qid       deleteQuestion
 *     PATCH  /quizzes/:id/publish              publishQuiz
 *     PATCH  /quizzes/:id/close                closeQuizEndpoint
 *     PATCH  /quizzes/:id/reopen               reopenQuiz
 *     GET    /quizzes/:id/results              getResults
 *     GET    /quizzes/:id/results/export       exportResults
 *     POST   /quizzes/:id/record-grades        recordGradesEndpoint
 *     PATCH  /quizzes/:id/attempts/:aid        updateFeedback
 *
 *   Student:
 *     GET    /quizzes/my                       listMyQuizzes
 *     GET    /quizzes/:id/take                 getQuizForTaking
 *     POST   /quizzes/:id/start                startAttempt
 *     POST   /quizzes/:id/submit               submitAttempt
 *     GET    /quizzes/:id/my-result            getMyResult
 */
const prisma = require('../utils/prisma');
const { successResponse, errorResponse } = require('../utils/response');
const { getIo } = require('../sockets');
const { queueBulkNotifications } = require('../services/queue.service');
const quizService = require('../services/quiz.service');
const logger = require('../utils/logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve Teacher.id from User.id + schoolId.
 * Returns null if no active teacher record found.
 */
async function _resolveTeacherId(userId, schoolId) {
  const teacher = await prisma.teacher.findFirst({
    where: { userId, schoolId, status: 'ACTIVE', deletedAt: null },
    select: { id: true }
  });
  return teacher?.id ?? null;
}

/**
 * Verify the teacher owns the class (active TeacherClass record).
 * Returns true/false.
 */
async function _verifyTeacherClass(teacherId, classId) {
  const tc = await prisma.teacherClass.findFirst({
    where: { teacherId, classId, isActive: true },
    select: { id: true }
  });
  return !!tc;
}

/**
 * Resolve Student.id from User.id + schoolId.
 */
async function _resolveStudentId(userId, schoolId) {
  const student = await prisma.student.findFirst({
    where: { userId, schoolId, status: 'ACTIVE', deletedAt: null },
    select: { id: true }
  });
  return student?.id ?? null;
}

// ─── Teacher/Admin — Quiz CRUD ─────────────────────────────────────────────────

async function createQuiz(req, res) {
  try {
    const { title, classId, description, timeLimitMin, openAt, closeAt } = req.body;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;
    if (!schoolId) return errorResponse(res, 'School context required', 400);

    const teacherId = await _resolveTeacherId(req.user.userId, schoolId);
    if (!teacherId) return errorResponse(res, 'No active teacher record found for this school', 403);

    const owns = await _verifyTeacherClass(teacherId, classId);
    if (!owns) return errorResponse(res, 'You are not assigned to this class', 403);

    // Verify class belongs to this school
    const cls = await prisma.class.findFirst({
      where: { id: classId, schoolId, deletedAt: null },
      select: { id: true }
    });
    if (!cls) return errorResponse(res, 'Class not found', 404);

    const quiz = await prisma.quiz.create({
      data: {
        schoolId,
        classId,
        teacherId,
        title,
        description: description ?? null,
        timeLimitMin: timeLimitMin ?? null,
        openAt:  openAt  ? new Date(openAt)  : null,
        closeAt: closeAt ? new Date(closeAt) : null,
        status: 'DRAFT'
      }
    });

    return successResponse(res, quiz, 201);
  } catch (err) {
    logger.error(`[quiz] createQuiz: ${err.message}`);
    return errorResponse(res, 'Failed to create quiz', 500);
  }
}

async function listQuizzes(req, res) {
  try {
    const { classId } = req.query;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;
    if (!schoolId) return errorResponse(res, 'School context required', 400);

    const where = { schoolId, deletedAt: null };
    if (classId) where.classId = classId;

    const quizzes = await prisma.quiz.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { questions: true, attempts: true } }
      }
    });

    return successResponse(res, quizzes);
  } catch (err) {
    logger.error(`[quiz] listQuizzes: ${err.message}`);
    return errorResponse(res, 'Failed to list quizzes', 500);
  }
}

async function getQuiz(req, res) {
  try {
    const { id } = req.params;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;

    const quiz = await prisma.quiz.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: {
        questions: {
          orderBy: { position: 'asc' },
          include: {
            options: { orderBy: { position: 'asc' } }
          }
        }
      }
    });
    if (!quiz) return errorResponse(res, 'Quiz not found', 404);

    return successResponse(res, quiz);
  } catch (err) {
    logger.error(`[quiz] getQuiz: ${err.message}`);
    return errorResponse(res, 'Failed to get quiz', 500);
  }
}

async function updateQuiz(req, res) {
  try {
    const { id } = req.params;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;
    const { title, description, timeLimitMin, openAt, closeAt } = req.body;

    const quiz = await prisma.quiz.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, teacherId: true, closeAt: true, status: true }
    });
    if (!quiz) return errorResponse(res, 'Quiz not found', 404);

    const data = {};
    if (title       !== undefined) data.title       = title;
    if (description !== undefined) data.description = description;
    if (timeLimitMin !== undefined) data.timeLimitMin = timeLimitMin;
    if (openAt      !== undefined) data.openAt      = openAt ? new Date(openAt) : null;
    if (closeAt     !== undefined) {
      data.closeAt = closeAt ? new Date(closeAt) : null;
      // Reschedule auto-close if quiz is OPEN and a new closeAt is set
      if (quiz.status === 'OPEN') {
        if (closeAt) {
          quizService.scheduleAutoClose(id, new Date(closeAt));
        } else {
          quizService.cancelAutoClose(id);
        }
      }
    }

    const updated = await prisma.quiz.update({ where: { id }, data });
    return successResponse(res, updated);
  } catch (err) {
    logger.error(`[quiz] updateQuiz: ${err.message}`);
    return errorResponse(res, 'Failed to update quiz', 500);
  }
}

async function deleteQuiz(req, res) {
  try {
    const { id } = req.params;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;

    const quiz = await prisma.quiz.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true }
    });
    if (!quiz) return errorResponse(res, 'Quiz not found', 404);

    await prisma.quiz.update({ where: { id }, data: { deletedAt: new Date() } });
    quizService.cancelAutoClose(id);

    return successResponse(res, { message: 'Quiz deleted' });
  } catch (err) {
    logger.error(`[quiz] deleteQuiz: ${err.message}`);
    return errorResponse(res, 'Failed to delete quiz', 500);
  }
}

// ─── Questions ────────────────────────────────────────────────────────────────

async function addQuestion(req, res) {
  try {
    const { id } = req.params;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;
    const { prompt, questionType, options = [], modelAnswer, position } = req.body;

    const quiz = await prisma.quiz.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, status: true, _count: { select: { questions: true } } }
    });
    if (!quiz) return errorResponse(res, 'Quiz not found', 404);
    if (quiz.status === 'CLOSED') return errorResponse(res, 'Cannot add questions to a closed quiz', 400);

    const nextPosition = position ?? (quiz._count.questions + 1);

    const question = await prisma.$transaction(async (tx) => {
      const q = await tx.quizQuestion.create({
        data: {
          quizId: id,
          position: nextPosition,
          questionType,
          prompt,
          modelAnswer: modelAnswer ?? null,
        }
      });

      if (questionType === 'MULTIPLE_CHOICE' && options.length > 0) {
        await tx.quizOption.createMany({
          data: options.map((opt, idx) => ({
            questionId: q.id,
            text:      opt.text,
            isCorrect: opt.isCorrect,
            position:  opt.position ?? idx + 1
          }))
        });
      }

      return tx.quizQuestion.findUnique({
        where: { id: q.id },
        include: { options: { orderBy: { position: 'asc' } } }
      });
    });

    return successResponse(res, question, 201);
  } catch (err) {
    logger.error(`[quiz] addQuestion: ${err.message}`);
    return errorResponse(res, 'Failed to add question', 500);
  }
}

async function updateQuestion(req, res) {
  try {
    const { id, qid } = req.params;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;
    const { prompt, options, modelAnswer, position } = req.body;

    // Verify quiz belongs to school
    const question = await prisma.quizQuestion.findFirst({
      where: { id: qid, quiz: { id, schoolId, deletedAt: null } },
      select: { id: true, questionType: true }
    });
    if (!question) return errorResponse(res, 'Question not found', 404);

    const updated = await prisma.$transaction(async (tx) => {
      const data = {};
      if (prompt      !== undefined) data.prompt      = prompt;
      if (modelAnswer !== undefined) data.modelAnswer = modelAnswer;
      if (position    !== undefined) data.position    = position;

      await tx.quizQuestion.update({ where: { id: qid }, data });

      // Replace options if provided (for MC questions)
      if (options && question.questionType === 'MULTIPLE_CHOICE') {
        await tx.quizOption.deleteMany({ where: { questionId: qid } });
        await tx.quizOption.createMany({
          data: options.map((opt, idx) => ({
            questionId: qid,
            text:      opt.text,
            isCorrect: opt.isCorrect,
            position:  opt.position ?? idx + 1
          }))
        });
      }

      return tx.quizQuestion.findUnique({
        where: { id: qid },
        include: { options: { orderBy: { position: 'asc' } } }
      });
    });

    return successResponse(res, updated);
  } catch (err) {
    logger.error(`[quiz] updateQuestion: ${err.message}`);
    return errorResponse(res, 'Failed to update question', 500);
  }
}

async function deleteQuestion(req, res) {
  try {
    const { id, qid } = req.params;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;

    const question = await prisma.quizQuestion.findFirst({
      where: { id: qid, quiz: { id, schoolId, deletedAt: null } },
      select: { id: true }
    });
    if (!question) return errorResponse(res, 'Question not found', 404);

    await prisma.quizQuestion.delete({ where: { id: qid } });
    return successResponse(res, { message: 'Question deleted' });
  } catch (err) {
    logger.error(`[quiz] deleteQuestion: ${err.message}`);
    return errorResponse(res, 'Failed to delete question', 500);
  }
}

// ─── Status transitions ────────────────────────────────────────────────────────

async function publishQuiz(req, res) {
  try {
    const { id } = req.params;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;

    const quiz = await prisma.quiz.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: { _count: { select: { questions: true } } }
    });
    if (!quiz) return errorResponse(res, 'Quiz not found', 404);
    if (quiz.status === 'OPEN')   return errorResponse(res, 'Quiz is already open', 400);
    if (quiz.status === 'CLOSED') return errorResponse(res, 'Use reopen endpoint to re-open a closed quiz', 400);
    if (quiz._count.questions < 1) return errorResponse(res, 'Quiz must have at least one question before publishing', 400);

    await prisma.quiz.update({ where: { id }, data: { status: 'OPEN' } });

    // Schedule auto-close if closeAt is set
    if (quiz.closeAt) {
      quizService.scheduleAutoClose(id, quiz.closeAt);
    }

    // Notify enrolled students (fire-and-forget, uses ANNOUNCEMENT type as safe fallback)
    try {
      const enrollments = await prisma.enrollment.findMany({
        where: { classId: quiz.classId, status: 'ACTIVE', deletedAt: null },
        select: { student: { select: { userId: true } } }
      });
      if (enrollments.length > 0) {
        const notifications = enrollments.map(e => ({
          userId: e.student.userId,
          type:   'ANNOUNCEMENT',
          title:  `New Quiz: ${quiz.title}`,
          body:   'A new practice quiz is available. Tap to start.',
          data:   { quizId: id, classId: quiz.classId }
        }));
        const BATCH = 100;
        for (let i = 0; i < notifications.length; i += BATCH) {
          await queueBulkNotifications(notifications.slice(i, i + BATCH)).catch(err =>
            logger.warn(`[quiz] publishQuiz notification batch failed: ${err.message}`)
          );
        }
      }
    } catch (notifErr) {
      logger.warn(`[quiz] publishQuiz notification failed (non-fatal): ${notifErr.message}`);
    }

    return successResponse(res, { message: 'Quiz published', status: 'OPEN' });
  } catch (err) {
    logger.error(`[quiz] publishQuiz: ${err.message}`);
    return errorResponse(res, 'Failed to publish quiz', 500);
  }
}

async function closeQuizEndpoint(req, res) {
  try {
    const { id } = req.params;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;

    const quiz = await prisma.quiz.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, status: true }
    });
    if (!quiz) return errorResponse(res, 'Quiz not found', 404);
    if (quiz.status === 'CLOSED') return errorResponse(res, 'Quiz is already closed', 400);

    await quizService.closeQuiz(id);
    return successResponse(res, { message: 'Quiz closed', status: 'CLOSED' });
  } catch (err) {
    logger.error(`[quiz] closeQuizEndpoint: ${err.message}`);
    return errorResponse(res, 'Failed to close quiz', 500);
  }
}

async function reopenQuiz(req, res) {
  try {
    const { id } = req.params;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;

    const quiz = await prisma.quiz.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, status: true, closeAt: true }
    });
    if (!quiz) return errorResponse(res, 'Quiz not found', 404);
    if (quiz.status !== 'CLOSED') return errorResponse(res, 'Only CLOSED quizzes can be reopened', 400);

    await prisma.quiz.update({ where: { id }, data: { status: 'OPEN' } });
    if (quiz.closeAt && new Date(quiz.closeAt) > new Date()) {
      quizService.scheduleAutoClose(id, quiz.closeAt);
    }

    return successResponse(res, { message: 'Quiz reopened', status: 'OPEN' });
  } catch (err) {
    logger.error(`[quiz] reopenQuiz: ${err.message}`);
    return errorResponse(res, 'Failed to reopen quiz', 500);
  }
}

// ─── Results (Teacher/Admin) ───────────────────────────────────────────────────

async function getResults(req, res) {
  try {
    const { id } = req.params;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;

    const quiz = await prisma.quiz.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, title: true, timeLimitMin: true }
    });
    if (!quiz) return errorResponse(res, 'Quiz not found', 404);

    const attempts = await prisma.quizAttempt.findMany({
      where: { quizId: id },
      orderBy: { submittedAt: 'desc' },
      include: {
        student: {
          include: { user: { select: { firstName: true, lastName: true, avatarUrl: true } } }
        },
        answers: {
          include: {
            question: { select: { prompt: true, questionType: true } }
          }
        }
      }
    });

    const rows = attempts.map(a => ({
      attemptId:   a.id,
      studentId:   a.studentId,
      firstName:   a.student.user.firstName,
      lastName:    a.student.user.lastName,
      avatarUrl:   a.student.user.avatarUrl,
      status:      a.status,
      score:       a.score,
      feedback:    a.feedback,
      startedAt:   a.startedAt,
      submittedAt: a.submittedAt,
      timeTakenMs: a.submittedAt
        ? new Date(a.submittedAt).getTime() - new Date(a.startedAt).getTime()
        : null,
      answers: a.answers.map(ans => ({
        questionId:       ans.questionId,
        prompt:           ans.question.prompt,
        questionType:     ans.question.questionType,
        selectedOptionId: ans.selectedOptionId,
        answerText:       ans.answerText,
        isCorrect:        ans.isCorrect
      }))
    }));

    return successResponse(res, { quiz, attempts: rows });
  } catch (err) {
    logger.error(`[quiz] getResults: ${err.message}`);
    return errorResponse(res, 'Failed to get results', 500);
  }
}

async function exportResults(req, res) {
  // Same shape as getResults — client converts to CSV
  return getResults(req, res);
}

async function recordGradesEndpoint(req, res) {
  try {
    const { id } = req.params;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;

    const quiz = await prisma.quiz.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true }
    });
    if (!quiz) return errorResponse(res, 'Quiz not found', 404);

    const grades = await quizService.recordGrades(id, req.user.userId);
    return successResponse(res, { recorded: grades.length, message: `${grades.length} grade(s) recorded` });
  } catch (err) {
    logger.error(`[quiz] recordGradesEndpoint: ${err.message}`);
    return errorResponse(res, 'Failed to record grades', 500);
  }
}

async function updateFeedback(req, res) {
  try {
    const { id, aid } = req.params;
    const { feedback } = req.body;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;

    // Verify attempt belongs to this quiz and school
    const attempt = await prisma.quizAttempt.findFirst({
      where: { id: aid, quiz: { id, schoolId, deletedAt: null } },
      select: { id: true }
    });
    if (!attempt) return errorResponse(res, 'Attempt not found', 404);

    const updated = await prisma.quizAttempt.update({
      where: { id: aid },
      data:  { feedback }
    });
    return successResponse(res, updated);
  } catch (err) {
    logger.error(`[quiz] updateFeedback: ${err.message}`);
    return errorResponse(res, 'Failed to update feedback', 500);
  }
}

// ─── Student endpoints ────────────────────────────────────────────────────────

async function listMyQuizzes(req, res) {
  try {
    const { classId } = req.query;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;
    if (!schoolId) return errorResponse(res, 'School context required', 400);

    // Verify student is enrolled
    const studentId = await _resolveStudentId(req.user.userId, schoolId);
    if (!studentId) return errorResponse(res, 'No active student record found', 403);

    const where = { schoolId, status: 'OPEN', deletedAt: null };
    if (classId) {
      // Verify enrollment in the requested class
      const enrolled = await prisma.enrollment.findFirst({
        where: { studentId, classId, status: 'ACTIVE', deletedAt: null }
      });
      if (!enrolled) return errorResponse(res, 'Not enrolled in this class', 403);
      where.classId = classId;
    } else {
      // All classes this student is enrolled in
      const enrollments = await prisma.enrollment.findMany({
        where: { studentId, status: 'ACTIVE', deletedAt: null },
        select: { classId: true }
      });
      where.classId = { in: enrollments.map(e => e.classId) };
    }

    const quizzes = await prisma.quiz.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count:  { select: { questions: true } },
        // Include the student's attempt status if any
        attempts: {
          where: { studentId },
          select: { id: true, status: true, score: true }
        }
      }
    });

    return successResponse(res, quizzes.map(q => ({
      ...q,
      myAttempt: q.attempts[0] ?? null,
      attempts: undefined  // don't expose all attempts to student
    })));
  } catch (err) {
    logger.error(`[quiz] listMyQuizzes: ${err.message}`);
    return errorResponse(res, 'Failed to list quizzes', 500);
  }
}

async function getQuizForTaking(req, res) {
  try {
    const { id } = req.params;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;

    const quiz = await prisma.quiz.findFirst({
      where: { id, schoolId, status: 'OPEN', deletedAt: null },
      include: {
        questions: {
          orderBy: { position: 'asc' },
          include: {
            options: {
              orderBy: { position: 'asc' },
              select: {
                id:       true,
                text:     true,
                position: true
                // isCorrect intentionally omitted for students
              }
            }
          }
        }
      }
    });
    if (!quiz) return errorResponse(res, 'Quiz not found or not open', 404);

    // Strip modelAnswer from questions too
    const sanitized = {
      ...quiz,
      questions: quiz.questions.map(q => ({
        id:           q.id,
        position:     q.position,
        questionType: q.questionType,
        prompt:       q.prompt,
        options:      q.options
        // modelAnswer intentionally omitted
      }))
    };

    return successResponse(res, sanitized);
  } catch (err) {
    logger.error(`[quiz] getQuizForTaking: ${err.message}`);
    return errorResponse(res, 'Failed to get quiz', 500);
  }
}

async function startAttempt(req, res) {
  try {
    const { id } = req.params;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;

    const quiz = await prisma.quiz.findFirst({
      where: { id, schoolId, status: 'OPEN', deletedAt: null },
      select: { id: true, timeLimitMin: true }
    });
    if (!quiz) return errorResponse(res, 'Quiz not found or not open', 404);

    const studentId = await _resolveStudentId(req.user.userId, schoolId);
    if (!studentId) return errorResponse(res, 'No active student record found', 403);

    // Reject if already submitted
    const existing = await prisma.quizAttempt.findFirst({
      where: { quizId: id, studentId }
    });
    if (existing) {
      if (existing.status === 'SUBMITTED') {
        return errorResponse(res, 'You have already submitted this quiz', 409);
      }
      // Return existing IN_PROGRESS attempt
      return successResponse(res, existing);
    }

    const attempt = await prisma.quizAttempt.create({
      data: {
        quizId:    id,
        studentId,
        userId:    req.user.userId,
        status:    'IN_PROGRESS',
        startedAt: new Date()
      }
    });

    return successResponse(res, attempt, 201);
  } catch (err) {
    logger.error(`[quiz] startAttempt: ${err.message}`);
    return errorResponse(res, 'Failed to start attempt', 500);
  }
}

async function submitAttempt(req, res) {
  try {
    const { id } = req.params;
    const { answers } = req.body;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;

    const quiz = await prisma.quiz.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, timeLimitMin: true, status: true }
    });
    if (!quiz) return errorResponse(res, 'Quiz not found', 404);

    const studentId = await _resolveStudentId(req.user.userId, schoolId);
    if (!studentId) return errorResponse(res, 'No active student record found', 403);

    const attempt = await prisma.quizAttempt.findFirst({
      where: { quizId: id, studentId },
      select: { id: true, status: true, startedAt: true }
    });
    if (!attempt) return errorResponse(res, 'No active attempt found — call /start first', 400);
    if (attempt.status === 'SUBMITTED') return errorResponse(res, 'Attempt already submitted', 409);

    // Check time limit
    if (quiz.timeLimitMin) {
      const elapsed = (Date.now() - new Date(attempt.startedAt).getTime()) / 60000;
      if (elapsed > quiz.timeLimitMin + 1) { // 1 minute grace
        return errorResponse(res, 'Time limit exceeded', 400);
      }
    }

    const submittedAt = new Date();

    // Save answers and mark submitted in one transaction
    await prisma.$transaction(async (tx) => {
      // Upsert each answer (student may have called start + partial saves)
      for (const ans of answers) {
        await tx.quizAnswer.upsert({
          where: {
            attemptId_questionId: {
              attemptId:  attempt.id,
              questionId: ans.questionId
            }
          },
          create: {
            attemptId:        attempt.id,
            questionId:       ans.questionId,
            selectedOptionId: ans.selectedOptionId ?? null,
            answerText:       ans.answerText ?? null
          },
          update: {
            selectedOptionId: ans.selectedOptionId ?? null,
            answerText:       ans.answerText ?? null
          }
        });
      }
      await tx.quizAttempt.update({
        where: { id: attempt.id },
        data:  { status: 'SUBMITTED', submittedAt }
      });
    });

    // Auto-score (async — don't block the response)
    quizService.autoScore(attempt.id).catch(err =>
      logger.error(`[quiz] autoScore failed after submit: ${err.message}`)
    );

    // Emit quiz:submission to teacher dashboard channel
    const io = getIo();
    if (io) {
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        select: { user: { select: { firstName: true, lastName: true } } }
      });
      io.to(`quiz:${id}`).emit('quiz:submission', {
        quizId:      id,
        studentId,
        firstName:   student?.user?.firstName,
        lastName:    student?.user?.lastName,
        submittedAt,
        score:       null  // not yet scored at emit time
      });
    }

    return successResponse(res, { message: 'Quiz submitted', attemptId: attempt.id });
  } catch (err) {
    logger.error(`[quiz] submitAttempt: ${err.message}`);
    return errorResponse(res, 'Failed to submit quiz', 500);
  }
}

async function getMyResult(req, res) {
  try {
    const { id } = req.params;
    const schoolId = req.schoolMembership?.schoolId ?? req.user?.schoolId;

    const studentId = await _resolveStudentId(req.user.userId, schoolId);
    if (!studentId) return errorResponse(res, 'No active student record found', 403);

    const attempt = await prisma.quizAttempt.findFirst({
      where: {
        quizId:    id,
        studentId,
        quiz:      { schoolId, deletedAt: null }
      },
      include: {
        answers: {
          include: {
            question: {
              select: {
                prompt:       true,
                questionType: true,
                modelAnswer:  true,
                options: {
                  select: { id: true, text: true, isCorrect: true, position: true },
                  orderBy: { position: 'asc' }
                }
              }
            }
          }
        }
      }
    });
    if (!attempt) return errorResponse(res, 'No attempt found for this quiz', 404);

    // Security: only the attempting student can see their result
    if (attempt.userId !== req.user.userId) return errorResponse(res, 'Forbidden', 403);

    return successResponse(res, attempt);
  } catch (err) {
    logger.error(`[quiz] getMyResult: ${err.message}`);
    return errorResponse(res, 'Failed to get result', 500);
  }
}

module.exports = {
  createQuiz,
  listQuizzes,
  getQuiz,
  updateQuiz,
  deleteQuiz,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  publishQuiz,
  closeQuizEndpoint,
  reopenQuiz,
  getResults,
  exportResults,
  recordGradesEndpoint,
  updateFeedback,
  listMyQuizzes,
  getQuizForTaking,
  startAttempt,
  submitAttempt,
  getMyResult
};
