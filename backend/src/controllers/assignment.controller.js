/**
 * Assignment Submission Controller
 * 
 * Handles assignment submission management including:
 * - Creating and submitting assignments
 * - Grading submissions
 * - Managing submission status
 */

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

/**
 * Create a new assignment submission
 *
 * FIND-02 FIX: schoolId, classId, gradeId, teacherId and studentId must be
 * server-controlled — never trusted from req.body for authorization.
 *
 * Authorization chain (enforced by route middleware + this controller):
 *   1. requireSchoolMember() → sets req.schoolId (authoritative school context)
 *   2. Resolve authenticated student record for req.schoolId
 *   3. Validate classId belongs to req.schoolId
 *   4. Validate gradeId (if supplied) belongs to req.schoolId
 *   5. Ignore body.schoolId, body.studentId (spoofable), body.teacherId
 *   6. Create submission using server-derived values only
 */
async function createAssignmentSubmission(req, res) {
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
    const { classId, gradeId, title, description, attachments, textContent } = req.body;

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

    const submission = await prisma.assignmentSubmission.create({
      data: {
        // FIND-02: all authorization-sensitive fields are server-derived
        schoolId,                  // from requireSchoolMember, not req.body
        classId,                   // validated to belong to schoolId above
        gradeId:   gradeId || null, // validated to belong to classId above
        studentId: student.id,     // from authenticated user's own student record
        teacherId: null,           // not accepted from client; set by grading endpoints
        title,
        description,
        attachments: attachments || [],
        textContent,
        status: 'DRAFT'
      }
    });

    logger.info(`Assignment submission created: ${submission.id} by student ${student.id}`);

    res.status(201).json({
      success: true,
      data: submission
    });
  } catch (error) {
    logger.error('Failed to create assignment submission:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INT_001', message: 'Failed to create assignment submission', statusCode: 500 }
    });
  }
}

/**
 * Submit an assignment
 */
async function submitAssignment(req, res) {
  try {
    const { id } = req.params;
    const { attachments, textContent } = req.body;
    const userId = req.user.id;

    const submission = await prisma.assignmentSubmission.findUnique({
      where: { id }
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Assignment submission not found',
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
          message: 'Not authorized to submit this assignment',
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
          message: 'Assignment already submitted',
          statusCode: 400
        })
      });
    }

    // Check if late submission
    const grade = await prisma.grade.findUnique({
      where: { id: submission.gradeId }
    });

    const isLate = grade && grade.dueDate && new Date() > new Date(grade.dueDate);

    const updated = await prisma.assignmentSubmission.update({
      where: { id },
      data: {
        attachments: attachments || submission.attachments,
        textContent: textContent || submission.textContent,
        status: isLate ? 'LATE' : 'SUBMITTED',
        submittedAt: new Date(),
        isLate
      }
    });

    logger.info(`Assignment ${id} submitted by student ${userId}`);

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    logger.error('Failed to submit assignment:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to submit assignment',
        statusCode: 500
      })
    });
  }
}

/**
 * Get assignment submissions for a student
 */
async function getStudentSubmissions(req, res) {
  try {
    const { studentId } = req.params;
    const { status, gradeId } = req.query;
    const userId = req.user.id;

    // F-5 FIX: Use effectiveRole so new MEMBER users with school-scoped TEACHER/ADMIN
    // memberships are recognized. req.schoolMembership is set by requireSchoolMember().
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

    const submissions = await prisma.assignmentSubmission.findMany({
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
    logger.error('Failed to get student submissions:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get submissions',
        statusCode: 500
      })
    });
  }
}

/**
 * Get submissions for a grade/class
 */
async function getGradeSubmissions(req, res) {
  try {
    const { gradeId } = req.params;
    const { status } = req.query;
    const userId = req.user.id;

    // F-5 FIX: Use effectiveRole for school-scoped role recognition.
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

    const submissions = await prisma.assignmentSubmission.findMany({
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
    logger.error('Failed to get grade submissions:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get submissions',
        statusCode: 500
      })
    });
  }
}

/**
 * Grade an assignment submission
 */
async function gradeSubmission(req, res) {
  try {
    const { id } = req.params;
    const { score, maxScore, feedback } = req.body;
    const userId = req.user.id;

    const submission = await prisma.assignmentSubmission.findUnique({
      where: { id }
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Assignment submission not found',
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
          message: 'Not authorized to grade this submission',
          statusCode: 403
        })
      });
    }

    const percentage = maxScore ? (score / maxScore) * 100 : null;

    const updated = await prisma.assignmentSubmission.update({
      where: { id },
      data: {
        score,
        maxScore,
        percentage,
        feedback,
        status: 'GRADED',
        gradedAt: new Date()
      }
    });

    logger.info(`Assignment ${id} graded by teacher ${userId}`);

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    logger.error('Failed to grade submission:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to grade submission',
        statusCode: 500
      })
    });
  }
}

/**
 * Get a specific assignment submission
 */
async function getSubmission(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const submission = await prisma.assignmentSubmission.findUnique({
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
          message: 'Assignment submission not found',
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
    logger.error('Failed to get submission:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get submission',
        statusCode: 500
      })
    });
  }
}

/**
 * Update assignment submission
 */
async function updateSubmission(req, res) {
  try {
    const { id } = req.params;
    const { title, description, attachments, textContent } = req.body;
    const userId = req.user.id;

    const submission = await prisma.assignmentSubmission.findUnique({
      where: { id }
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Assignment submission not found',
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

    const updated = await prisma.assignmentSubmission.update({
      where: { id },
      data: {
        title: title !== undefined ? title : submission.title,
        description: description !== undefined ? description : submission.description,
        attachments: attachments !== undefined ? attachments : submission.attachments,
        textContent: textContent !== undefined ? textContent : submission.textContent
      }
    });

    logger.info(`Assignment ${id} updated by student ${userId}`);

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    logger.error('Failed to update submission:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to update submission',
        statusCode: 500
      })
    });
  }
}

/**
 * Delete assignment submission
 */
async function deleteSubmission(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const submission = await prisma.assignmentSubmission.findUnique({
      where: { id }
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Assignment submission not found',
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

    await prisma.assignmentSubmission.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    logger.info(`Assignment ${id} deleted by student ${userId}`);

    res.json({
      success: true,
      message: 'Submission deleted successfully'
    });
  } catch (error) {
    logger.error('Failed to delete submission:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to delete submission',
        statusCode: 500
      })
    });
  }
}

module.exports = {
  createAssignmentSubmission,
  submitAssignment,
  getStudentSubmissions,
  getGradeSubmissions,
  gradeSubmission,
  getSubmission,
  updateSubmission,
  deleteSubmission
};
