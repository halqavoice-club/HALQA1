/**
 * Zod Validation Schemas
 * 
 * Centralized validation schemas using Zod for type-safe input validation.
 * All API endpoints should use these schemas for request validation.
 * 
 * Usage:
 *   import { validate } from './utils/validation';
 *   import { loginSchema, registerSchema } from './utils/validation/schemas';
 *   
 *   router.post('/login', validate(loginSchema), loginHandler);
 */

const { z } = require('zod');

/**
 * Common schemas
 */
const emailSchema = z.string()
  .email('Invalid email address')
  .min(5, 'Email too short')
  .max(255, 'Email too long')
  .toLowerCase();

const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password too long')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

const phoneSchema = z.string()
  .regex(/^\+?[\d\s-()]{10,20}$/, 'Invalid phone number')
  .optional();

const uuidSchema = z.string()
  .uuid('Invalid UUID format');

const urlSchema = z.string()
  .url('Invalid URL format')
  .optional();

const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)')
  .optional();

const dateTimeSchema = z.string()
  .datetime('Invalid datetime format (ISO 8601)')
  .optional();

/**
 * Pagination schemas
 */
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc')
});

/**
 * Authentication schemas
 */
const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string()
    .min(1, 'First name is required')
    .max(100, 'First name too long')
    .regex(/^[a-zA-Z\s'-]+$/, 'First name contains invalid characters'),
  lastName: z.string()
    .min(1, 'Last name is required')
    .max(100, 'Last name too long')
    .regex(/^[a-zA-Z\s'-]+$/, 'Last name contains invalid characters'),
  schoolId: uuidSchema.optional(),
  phone: phoneSchema
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required')
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required')
});

const verifyEmailSchema = z.object({
  email: emailSchema,
  otp: z.string()
    .length(6, 'OTP must be 6 digits')
    .regex(/^\d+$/, 'OTP must contain only digits')
});

const forgotPasswordSchema = z.object({
  email: emailSchema
});

const resetPasswordSchema = z.object({
  email: emailSchema,
  otp: z.string()
    .length(6, 'OTP must be 6 digits')
    .regex(/^\d+$/, 'OTP must contain only digits'),
  newPassword: passwordSchema
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema
});

/**
 * User schemas
 */
const updateUserSchema = z.object({
  firstName: z.string()
    .min(1, 'First name is required')
    .max(100, 'First name too long')
    .regex(/^[a-zA-Z\s'-]+$/, 'First name contains invalid characters')
    .optional(),
  lastName: z.string()
    .min(1, 'Last name is required')
    .max(100, 'Last name too long')
    .regex(/^[a-zA-Z\s'-]+$/, 'Last name contains invalid characters')
    .optional(),
  phone: phoneSchema,
  bio: z.string().max(500, 'Bio too long').optional(),
  avatarUrl: urlSchema,
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username too long')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores')
    .optional()
});

/**
 * School schemas
 */
const createSchoolSchema = z.object({
  name: z.string()
    .min(1, 'School name is required')
    .max(255, 'School name too long'),
  slug: z.string()
    .min(1, 'Slug is required')
    .max(100, 'Slug too long')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
  type: z.enum(['school', 'quran_academy', 'institute', 'other']),
  address: z.string().max(500, 'Address too long').optional(),
  city: z.string().max(100, 'City too long').optional(),
  state: z.string().max(100, 'State too long').optional(),
  country: z.string().max(100, 'Country too long').optional(),
  zipCode: z.string().max(20, 'Zip code too long').optional(),
  phone: phoneSchema,
  email: emailSchema.optional(),
  website: urlSchema,
  logoUrl: urlSchema
});

const updateSchoolSchema = createSchoolSchema.partial();

/**
 * Class schemas
 */
const createClassSchema = z.object({
  name: z.string()
    .min(1, 'Class name is required')
    .max(100, 'Class name too long'),
  gradeLevel: z.string()
    .min(1, 'Grade level is required')
    .max(50, 'Grade level too long'),
  section: z.string().max(20, 'Section too long').optional(),
  roomNumber: z.string().max(50, 'Room number too long').optional(),
  capacity: z.coerce.number().int().min(1).max(100).optional(),
  isActive: z.boolean().optional()
});

const updateClassSchema = createClassSchema.partial();

/**
 * Student schemas
 */
const createStudentSchema = z.object({
  userId: uuidSchema,
  studentId: z.string()
    .min(1, 'Student ID is required')
    .max(50, 'Student ID too long'),
  gradeLevel: z.string()
    .min(1, 'Grade level is required')
    .max(50, 'Grade level too long'),
  dateOfBirth: dateSchema,
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  address: z.string().max(500, 'Address too long').optional(),
  emergencyContact: z.object({
    name: z.string().min(1, 'Emergency contact name is required'),
    phone: phoneSchema,
    relationship: z.string().min(1, 'Relationship is required')
  }).optional()
});

const updateStudentSchema = createStudentSchema.partial();

/**
 * Teacher schemas
 */
const createTeacherSchema = z.object({
  userId: uuidSchema,
  employeeId: z.string()
    .min(1, 'Employee ID is required')
    .max(50, 'Employee ID too long'),
  department: z.string().max(100, 'Department too long').optional(),
  subject: z.string().max(100, 'Subject too long').optional(),
  qualification: z.string().max(100, 'Qualification too long').optional(),
  experience: z.coerce.number().int().min(0).max(50).optional(),
  joiningDate: dateSchema
});

const updateTeacherSchema = createTeacherSchema.partial();

/**
 * Attendance schemas
 */
const createAttendanceSchema = z.object({
  studentId: uuidSchema,
  classId: uuidSchema,
  date: dateSchema,
  status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']),
  notes: z.string().max(500, 'Notes too long').optional()
});

const bulkAttendanceSchema = z.object({
  classId: uuidSchema,
  date: dateSchema,
  attendance: z.array(z.object({
    studentId: uuidSchema,
    status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']),
    notes: z.string().max(500).optional()
  }))
});

/**
 * Grade schemas
 */
const createGradeSchema = z.object({
  studentId: uuidSchema,
  classId: uuidSchema,
  termId: uuidSchema.optional(),
  title: z.string()
    .min(1, 'Grade title is required')
    .max(100, 'Grade title too long'),
  type: z.enum(['ASSIGNMENT', 'QUIZ', 'EXAM', 'PROJECT', 'PARTICIPATION', 'OTHER']),
  score: z.coerce.number().min(0),
  maxScore: z.coerce.number().min(1),
  weight: z.coerce.number().min(0).max(100).optional(),
  dueDate: dateSchema.optional(),
  feedback: z.string().max(2000, 'Feedback too long').optional()
});

const updateGradeSchema = createGradeSchema.partial();

/**
 * Post schemas (Social Feed)
 */
const createPostSchema = z.object({
  content: z.string()
    .min(1, 'Content is required')
    .max(5000, 'Content too long'),
  media: z.array(z.object({
    url: urlSchema,
    type: z.enum(['IMAGE', 'VIDEO']),
    mimeType: z.string().optional()
  })).max(10, 'Maximum 10 media items').optional(),
  visibility: z.enum(['PUBLIC', 'FOLLOWERS', 'PRIVATE']).default('PUBLIC'),
  hashtags: z.array(z.string().max(50)).max(30).optional(),
  isDraft: z.boolean().default(false),
  scheduledAt: dateTimeSchema.optional()
});

const updatePostSchema = createPostSchema.partial();

/**
 * Comment schemas
 */
const createCommentSchema = z.object({
  content: z.string()
    .min(1, 'Comment is required')
    .max(1000, 'Comment too long')
});

/**
 * Message schemas
 */
const createMessageSchema = z.object({
  recipientId: uuidSchema,
  subject: z.string()
    .min(1, 'Subject is required')
    .max(200, 'Subject too long'),
  body: z.string()
    .min(1, 'Body is required')
    .max(5000, 'Body too long'),
  isAnnouncement: z.boolean().default(false),
  classId: uuidSchema.optional()
});

/**
 * Calendar event schemas
 */
const createEventSchema = z.object({
  title: z.string()
    .min(1, 'Event title is required')
    .max(200, 'Event title too long'),
  description: z.string().max(2000, 'Description too long').optional(),
  startDate: z.string().datetime('Invalid start date'),
  endDate: z.string().datetime('Invalid end date'),
  location: z.string().max(200, 'Location too long').optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format').optional(),
  isPublic: z.boolean().default(true),
  classId: uuidSchema.optional()
});

const updateEventSchema = createEventSchema.partial();

/**
 * File upload schemas
 */
const uploadFileSchema = z.object({
  entityType: z.enum(['message', 'note', 'grade', 'assignment', 'exam', 'post', 'other']).optional(),
  entityId: uuidSchema.optional()
});

/**
 * Search schemas
 */
const searchSchema = z.object({
  query: z.string().min(1, 'Search query is required').max(200),
  type: z.enum(['all', 'users', 'posts', 'classes', 'schools']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

/**
 * Validation middleware factory
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    try {
      const data = source === 'body' ? req.body : 
                   source === 'query' ? req.query :
                   source === 'params' ? req.params : req.body;
      
      const validated = schema.parse(data);
      
      // Replace request data with validated data
      if (source === 'body') req.body = validated;
      else if (source === 'query') req.query = validated;
      else if (source === 'params') req.params = validated;
      
      next();
    } catch (error) {
      const { ValidationError } = require('./errors');
      const formattedErrors = error.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message
      }));
      
      return res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Validation failed',
          statusCode: 400,
          details: { errors: formattedErrors }
        }
      });
    }
  };
}

/**
 * Async validation middleware for database-dependent validation
 */
function validateAsync(validatorFn) {
  return async (req, res, next) => {
    try {
      await validatorFn(req);
      next();
    } catch (error) {
      const { formatErrorResponse } = require('./errors');
      return res.status(error.statusCode || 400).json(formatErrorResponse(error));
    }
  };
}

module.exports = {
  // Common
  emailSchema,
  passwordSchema,
  phoneSchema,
  uuidSchema,
  urlSchema,
  dateSchema,
  dateTimeSchema,
  paginationSchema,
  
  // Auth
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  
  // User
  updateUserSchema,
  
  // School
  createSchoolSchema,
  updateSchoolSchema,
  
  // Class
  createClassSchema,
  updateClassSchema,
  
  // Student
  createStudentSchema,
  updateStudentSchema,
  
  // Teacher
  createTeacherSchema,
  updateTeacherSchema,
  
  // Attendance
  createAttendanceSchema,
  bulkAttendanceSchema,
  
  // Grade
  createGradeSchema,
  updateGradeSchema,
  
  // Post
  createPostSchema,
  updatePostSchema,
  
  // Comment
  createCommentSchema,
  
  // Message
  createMessageSchema,
  
  // Event
  createEventSchema,
  updateEventSchema,
  
  // Upload
  uploadFileSchema,
  
  // Search
  searchSchema,
  
  // Middleware
  validate,
  validateAsync
};
