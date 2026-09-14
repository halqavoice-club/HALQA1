'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const { eduMember, eduAdmin } = require('../middleware/educationAuth');
const auditLog = require('../middleware/audit.middleware');
const ctrl = require('../controllers/student.controller');

router.use(authenticate);

// GET /students/me — student views their own full record (for ID card, profile, etc.)
// Must be registered BEFORE /:id to avoid "me" being treated as an ID.
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const schoolId = req.schoolId || req.user.schoolId;
    const student = await require('../utils/prisma').student.findFirst({
      where: {
        userId: req.user.id,
        deletedAt: null,
        ...(schoolId && { schoolId }),
      },
      include: {
        school: {
          select: { id: true, name: true, logoUrl: true, address: true, phone: true, email: true }
        },
        user: {
          select: {
            id: true, firstName: true, lastName: true, email: true,
            phone: true, avatarUrl: true, dateOfBirth: true, gender: true, status: true
          }
        },
        enrollments: {
          where: { isActive: true },
          include: { class: true }
        },
        guardianLinks: {
          include: {
            guardian: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } }
              }
            }
          }
        }
      }
    });
    if (!student) {
      return require('../utils/response').errorResponse(res, 'No student record found for your account', 404);
    }
    return require('../utils/response').successResponse(res, student);
  } catch (error) { next(error); }
});

// Any active school member can list/view students in their school
router.get('/',    ...eduMember, ctrl.listStudents);
router.get('/:id', ...eduMember, ctrl.getStudent);

// Admin-only mutations — all audited
router.post('/',
  ...eduAdmin,
  [
    // email is optional when linkedUserId is provided (existing HALQA user being added as student)
    body('email').if(body('linkedUserId').not().exists()).isEmail().normalizeEmail(),
    body('email').if(body('linkedUserId').exists()).optional().isEmail().normalizeEmail(),
    // firstName/lastName are optional when linkedUserId is provided (resolved from existing user)
    body('firstName').if(body('linkedUserId').not().exists()).trim().notEmpty(),
    body('lastName').if(body('linkedUserId').not().exists()).trim().notEmpty(),
    body('studentId').trim().notEmpty()
  ],
  validate,
  auditLog('CREATE', 'students'),
  ctrl.createStudent
);

router.put('/:id',
  ...eduAdmin,
  auditLog('UPDATE', 'students'),
  ctrl.updateStudent
);

router.post('/:id/enroll',
  ...eduAdmin,
  [body('classId').notEmpty()], validate,
  auditLog('CREATE', 'enrollments'),
  ctrl.enrollStudent
);

router.delete('/:id/enroll/:classId',
  ...eduAdmin,
  auditLog('DELETE', 'enrollments'),
  ctrl.unenrollStudent
);

router.post('/:id/regenerate-qr', ...eduAdmin, ctrl.regenerateQr);

router.delete('/:id',
  ...eduAdmin,
  auditLog('DELETE', 'students'),
  ctrl.deleteStudent
);

module.exports = router;
