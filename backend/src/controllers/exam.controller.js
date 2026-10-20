/**
 * Exam Submission Controller
 * 
 * Handles exam submission management including:
 * - Creating and submitting exams
 * - Auto-grading support
 * - Managing exam status
 */

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

/**
 * Create a new exam submission
 *
 * FIND-02 FIX: schoolId, classId, gradeId, teacherId and studentId must be
 * server-controlled — never trusted from req.body for authorization.
 *
 * Authorization chain:
 *   1. requireSchoolMember() → sets req.schoolId (authoritative school context)
 *   2. Resolve authenticated student record for req.schoolId
 *   3. Validate classId belongs to req.schoolId
 *   4. Validate gradeId (if supplied) belongs to req.schoolId via classId
 *   5. Ignore body.schoolId, body.studentId, body.teacherId
 *   6. Create submission using server-derived values only
 */
async function createExamSubmission(req, res) {
  try {
    // FIND-02: use req.schoolId (set by requireSchoolMember middleware) not req.body.schoolId
    const schoolId = req.schoolId;
    const userId   = req.user.id;

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VAL_002', message: 'School context required', statusCode: 400 }
      });
    }

    // Extract only safe client fields — authorization fields are server-resolved
    const { classId, gradeId, title, answers, attachments } = req.body;

    // Validate required fields
    if (!classId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VAL_002', message: 'classId is required', statusCode: 400 }
      });
    }

    // FIND-02: Verify classId belongs to the authenticated user's school.
    // Prevents a School A student from submitting to a School B class using a valid School B ID.
    const cls = await prisma.class.findFirst({
      where: { id: classId, schoolId, deletedAt: null },
      select: { id: true }
    });
    if (!cls) {
      return res.status(403).json({
        success: false,
        error: { code: 'AUTH_002', message: 'Class not found in your school', statusCode: 403 }
      });
    }

    // FIND-02: Verify gradeId (if supplied) belongs to the same school via its class.
    if (gradeId) {
      const grade = await prisma.grade.findFirst({
        where: { id: gradeId, classId, deletedAt: null },
        select: { id: true }
      });
      if (!grade) {
        return res.status(403).json({
          success: false,
          error: { code: 'AUTH_002', message: 'Grade not found in this class', statusCode: 403 }
        });
      }
    }

    // FIND-02: Resolve the Student record for the authenticated user in this school.
    // body.studentId is ignored — a student cannot submit on behalf of another student.
    const student = await prisma.student.findFirst({
      where: { userId, schoolId, deletedAt: null },
      select: { id: true }
    });
    if (!student) {
      return res.status(403).json({
        success: false,
        error: { code: 'AUTH_002', message: 'Student profile not found in your school', statusCode: 403 }
      });
    }

    const submission = await prisma.examSubmission.create({
      data: {
        // FIND-02: all authorization-sensitive fields are server-derived
        schoolId,                  // from requireSchoolMember, not req.body
        classId,                   // validated to belong to schoolId above
        gradeId:   gradeId || null, // validated to belong to classId above
        studentId: student.id,     // from authenticated user's own student record
        teacherId: null,           // not accepted from client; set by grading endpoints
        title,
        answers:     answers     || {},
        attachments: attachments || [],
        status: 'DRAFT'
      }
    });

    logger.info(`Exam submission created: ${submission.id} by student ${student.id}`);

    res.status(201).json({
      success: true,
      data: submission
    });
  } catch (error) {
    logger.error('Failed to create exam submission:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INT_001', message: 'Failed to create exam submission', statusCode: 500 }
    });
  }
}

/**
 * Submit an exam
 */
async function submitExam(req, res) {
  try {
    const { id } = req.params;
    const { answers, attachments } = req.body;
    const userId = req.user.id;

    const submission = await prisma.examSubmission.findUnique({
      where: { id }
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Exam submission not found',
          statusCode: 404
        })
      });
    }

    // Check if user is the student
    if (submission.studentId !== userId) {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not authorized to submit this exam',
          statusCode: 403
        })
      });
    }

    // Check if already submitted
    if (submission.status !== 'DRAFT') {
      return res.status(400).json({
        success: false,
        error:({
          code: 'VAL_001',
          message: 'Exam already submitted',
          statusCode: 400
        })
      });
    }

    // Check if late submission
    const grade = await prisma.grade.findUnique({
      where: { id: submission.gradeId }
    });

    const isLate = grade && grade.dueDate && new Date() > new Date(grade.dueDate);

    const updated = await prisma.examSubmission.update({
      where: { id },
      data: {
        answers: answers || submission.answers,
        attachments: attachments || submission.attachments,
        status: isLate ? 'LATE' : 'SUBMITTED',
        submittedAt: new Date()
      }
    });

    logger.info(`Exam ${id} submitted by student ${userId}`);

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    logger.error('Failed to submit exam:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to submit exam',
        statusCode: 500
      })
    });
  }
}

/**
 * Auto-grade an exam submission
 */
async function autoGradeExam(req, res) {
  try {
    const { id } = req.params;
    const { correctAnswers, maxScore } = req.body;
    const userId = req.user.id;

    const submission = await prisma.examSubmission.findUnique({
      where: { id }
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Exam submission not found',
          statusCode: 404
        })
      });
    }

    // F-5 FIX: Use effectiveRole — recognizes MEMBER users with school-scoped TEACHER/ADMIN.
    const effectiveRole = req.schoolMembership?.role || req.user.role;

    // Check if user is the teacher
    if (submission.teacherId !== userId && effectiveRole !== 'SCHOOL_ADMIN' && effectiveRole !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not authorized to grade this exam',
          statusCode: 403
        })
      });
    }

    // Calculate score based on correct answers
    let score = 0;
    const answers = submission.answers || {};
    
    for (const [questionId, studentAnswer] of Object.entries(answers)) {
      if (correctAnswers[questionId] === studentAnswer) {
        score += (maxScore / Object.keys(correctAnswers).length);
      }
    }

    const percentage = (score / maxScore) * 100;

    const updated = await prisma.examSubmission.update({
      where: { id },
      data: {
        score: Math.round(score * 100) / 100,
        maxScore,
        percentage: Math.round(percentage * 100) / 100,
        autoGraded: true,
        status: 'GRADED',
        gradedAt: new Date()
      }
    });

    logger.info(`Exam ${id} auto-graded by teacher ${userId}`);

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    logger.error('Failed to auto-grade exam:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to auto-grade exam',
        statusCode: 500
      })
    });
  }
}

/**
 * Get exam submissions for a student
 */
async function getStudentExamSubmissions(req, res) {
  try {
    const { studentId } = req.params;
    const { status, gradeId } = req.query;
    const userId = req.user.id;

    // F-5 FIX: Use effectiveRole — recognizes MEMBER users with school-scoped roles.
    const effectiveRole = req.schoolMembership?.role || req.user.role;

    // Check if user is the student or a teacher/admin
    if (studentId !== userId && effectiveRole !== 'TEACHER' && effectiveRole !== 'SCHOOL_ADMIN' && effectiveRole !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not authorized to view these submissions',
          statusCode: 403
        })
      });
    }

    const where = { studentId };
    if (status) where.status = status;
    if (gradeId) where.gradeId = gradeId;

    const submissions = await prisma.examSubmission.findMany({
      where,
      include: {
        grade: {
          include: {
            class: true
          }
        },
        student: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
          }
        },
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: submissions
    });
  } catch (error) {
    logger.error('Failed to get student exam submissions:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get exam submissions',
        statusCode: 500
      })
    });
  }
}

/**
 * Get submissions for a grade/class
 */
async function getGradeExamSubmissions(req, res) {
  try {
    const { gradeId } = req.params;
    const { status } = req.query;
    const userId = req.user.id;

    // F-5 FIX: Use effectiveRole for grade submissions access.
    const effectiveRole = req.schoolMembership?.role || req.user.role;

    // Check if user is a teacher/admin
    if (effectiveRole !== 'TEACHER' && effectiveRole !== 'SCHOOL_ADMIN' && effectiveRole !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not authorized to view these submissions',
          statusCode: 403
        })
      });
    }

    const where = { gradeId };
    if (status) where.status = status;

    const submissions = await prisma.examSubmission.findMany({
      where,
      include: {
        student: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
          }
        },
        grade: {
          include: {
            class: true
          }
        }
      },
      orderBy: { submittedAt: 'desc' }
    });

    res.json({
      success: true,
      data: submissions
    });
  } catch (error) {
    logger.error('Failed to get grade exam submissions:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get exam submissions',
        statusCode: 500
      })
    });
  }
}

/**
 * Manually grade an exam submission
 */
async function gradeExamSubmission(req, res) {
  try {
    const { id } = req.params;
    const { score, maxScore, feedback } = req.body;
    const userId = req.user.id;

    const submission = await prisma.examSubmission.findUnique({
      where: { id }
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Exam submission not found',
          statusCode: 404
        })
      });
    }

    // F-5 FIX: Use effectiveRole for manual grading auth.
    const effectiveRoleGrade = req.schoolMembership?.role || req.user.role;

    // Check if user is the teacher
    if (submission.teacherId !== userId && effectiveRoleGrade !== 'SCHOOL_ADMIN' && effectiveRoleGrade !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not authorized to grade this exam',
          statusCode: 403
        })
      });
    }

    const percentage = maxScore ? (score / maxScore) * 100 : null;

    const updated = await prisma.examSubmission.update({
      where: { id },
      data: {
        score,
        maxScore,
        percentage,
        feedback,
        status: 'GRADED',
        gradedAt: new Date(),
        autoGraded: false
      }
    });

    logger.info(`Exam ${id} manually graded by teacher ${userId}`);

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    logger.error('Failed to grade exam submission:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to grade exam submission',
        statusCode: 500
      })
    });
  }
}

/**
 * Get a specific exam submission
 */
async function getExamSubmission(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const submission = await prisma.examSubmission.findUnique({
      where: { id },
      include: {
        grade: {
          include: {
            class: true
          }
        },
        student: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
          }
        },
      }
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Exam submission not found',
          statusCode: 404
        })
      });
    }

    // Check authorization
    // F-5 FIX: Use effectiveRole — recognizes MEMBER users with school-scoped roles.
    const effectiveRole = req.schoolMembership?.role || req.user.role;
    const isStudent = submission.studentId === userId;
    const isTeacher = submission.teacherId === userId;
    const isAdmin = effectiveRole === 'SCHOOL_ADMIN' || effectiveRole === 'SUPER_ADMIN';

    if (!isStudent && !isTeacher && !isAdmin) {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not authorized to view this submission',
          statusCode: 403
        })
      });
    }

    res.json({
      success: true,
      data: submission
    });
  } catch (error) {
    logger.error('Failed to get exam submission:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get exam submission',
        statusCode: 500
      })
    });
  }
}

/**
 * Update exam submission
 */
async function updateExamSubmission(req, res) {
  try {
    const { id } = req.params;
    const { title, answers, attachments } = req.body;
    const userId = req.user.id;

    const submission = await prisma.examSubmission.findUnique({
      where: { id }
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Exam submission not found',
          statusCode: 404
        })
      });
    }

    // Only allow updates for draft submissions
    if (submission.status !== 'DRAFT') {
      return res.status(400).json({
        success: false,
        error:({
          code: 'VAL_001',
          message: 'Can only update draft submissions',
          statusCode: 400
        })
      });
    }

    // Check if user is the student
    if (submission.studentId !== userId) {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not authorized to update this submission',
          statusCode: 403
        })
      });
    }

    const updated = await prisma.examSubmission.update({
      where: { id },
      data: {
        title: title !== undefined ? title : submission.title,
        answers: answers !== undefined ? answers : submission.answers,
        attachments: attachments !== undefined ? attachments : submission.attachments
      }
    });

    logger.info(`Exam ${id} updated by student ${userId}`);

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    logger.error('Failed to update exam submission:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to update exam submission',
        statusCode: 500
      })
    });
  }
}

/**
 * Delete exam submission
 */
async function deleteExamSubmission(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const submission = await prisma.examSubmission.findUnique({
      where: { id }
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Exam submission not found',
          statusCode: 404
        })
      });
    }

    // Only allow deletion for draft submissions
    if (submission.status !== 'DRAFT') {
      return res.status(400).json({
        success: false,
        error:({
          code: 'VAL_001',
          message: 'Can only delete draft submissions',
          statusCode: 400
        })
      });
    }

    // Check if user is the student
    if (submission.studentId !== userId) {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not authorized to delete this submission',
          statusCode: 403
        })
      });
    }

    await prisma.examSubmission.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    logger.info(`Exam ${id} deleted by student ${userId}`);

    res.json({
      success: true,
      message: 'Submission deleted successfully'
    });
  } catch (error) {
    logger.error('Failed to delete exam submission:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to delete exam submission',
        statusCode: 500
      })
    });
  }
}

module.exports = {
  createExamSubmission,
  submitExam,
  autoGradeExam,
  getStudentExamSubmissions,
  getGradeExamSubmissions,
  gradeExamSubmission,
  getExamSubmission,
  updateExamSubmission,
  deleteExamSubmission
};
