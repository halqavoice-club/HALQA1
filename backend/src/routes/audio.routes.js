'use strict';
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const { eduMember, eduStaff, eduAdmin } = require('../middleware/educationAuth');
const {
  listCategories, createCategory, deleteCategory,
  listCourses, getCourse, createCourse, updateCourse, deleteCourse,
  listLessons, getLesson, uploadLesson, updateLesson, deleteLesson
} = require('../controllers/audio.controller');

const audioFilter = (req, file, cb) => {
  const allowed    = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/aac'];
  const allowedExt = ['.mp3', '.wav', '.ogg', '.m4a', '.aac'];
  const ext        = path.extname(file.originalname).toLowerCase();
  (allowed.includes(file.mimetype) || allowedExt.includes(ext))
    ? cb(null, true)
    : cb(new Error('Only audio files are allowed (MP3, WAV, OGG, M4A, AAC)'), false);
};

const upload = multer({ storage: multer.memoryStorage(), fileFilter: audioFilter, limits: { fileSize: 50 * 1024 * 1024 } });

router.use(authenticate);

// ─── CATEGORIES ──────────────────────────────────────────────────────────────
router.get('/categories', ...eduMember, listCategories);
router.post('/categories', ...eduStaff,
  [body('name').trim().notEmpty().withMessage('Category name required')], validate,
  createCategory
);
router.delete('/categories/:id', ...eduAdmin, deleteCategory);

// ─── COURSES ─────────────────────────────────────────────────────────────────
router.get('/courses',     ...eduMember, listCourses);
router.get('/courses/:id', ...eduMember, getCourse);
router.post('/courses', ...eduStaff,
  [body('title').trim().notEmpty(), body('categoryId').notEmpty()], validate,
  createCourse
);
router.put('/courses/:id',    ...eduStaff, updateCourse);
router.delete('/courses/:id', ...eduStaff, deleteCourse);

// ─── LESSONS ─────────────────────────────────────────────────────────────────
router.get('/lessons',     ...eduMember, listLessons);
router.get('/lessons/:id', ...eduMember, getLesson);
router.post('/lessons', ...eduStaff, upload.single('audio'),
  [body('title').trim().notEmpty(), body('courseId').notEmpty()], validate,
  uploadLesson
);
router.put('/lessons/:id',    ...eduStaff, updateLesson);
router.delete('/lessons/:id', ...eduStaff, deleteLesson);

module.exports = router;
