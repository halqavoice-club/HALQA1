const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const {
  listCategories, createCategory, deleteCategory,
  listCourses, getCourse, createCourse, updateCourse, deleteCourse,
  listLessons, getLesson, uploadLesson, updateLesson, deleteLesson
} = require('../controllers/audio.controller');

// ─── MULTER — audio only, 50 MB, memory storage ──────────────────────────────
const audioFilter = (req, file, cb) => {
  const allowed    = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/aac'];
  const allowedExt = ['.mp3', '.wav', '.ogg', '.m4a', '.aac'];
  const ext        = path.extname(file.originalname).toLowerCase();
  (allowed.includes(file.mimetype) || allowedExt.includes(ext))
    ? cb(null, true)
    : cb(new Error('Only audio files are allowed (MP3, WAV, OGG, M4A, AAC)'), false);
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: audioFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

router.use(authenticate);

// ─── CATEGORIES ───────────────────────────────────────────────────────────────
router.get('/categories', listCategories);

router.post('/categories',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  [body('name').trim().notEmpty().withMessage('Category name required')],
  validate,
  createCategory
);

router.delete('/categories/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  deleteCategory
);

// ─── COURSES ──────────────────────────────────────────────────────────────────
router.get('/courses', listCourses);
router.get('/courses/:id', getCourse);

router.post('/courses',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  [
    body('title').trim().notEmpty().withMessage('Title required'),
    body('categoryId').notEmpty().withMessage('Category required')
  ],
  validate,
  createCourse
);

router.put('/courses/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  updateCourse
);

router.delete('/courses/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  deleteCourse
);

// ─── LESSONS ──────────────────────────────────────────────────────────────────
router.get('/lessons', listLessons);
router.get('/lessons/:id', getLesson);

router.post('/lessons',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  upload.single('audio'),
  [
    body('title').trim().notEmpty().withMessage('Title required'),
    body('courseId').notEmpty().withMessage('Course required')
  ],
  validate,
  uploadLesson
);

router.put('/lessons/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  updateLesson
);

router.delete('/lessons/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  deleteLesson
);

module.exports = router;
