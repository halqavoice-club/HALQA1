const path = require('path');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const { saveFile, deleteFile } = require('../utils/storage');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');
const logger = require('../utils/logger');

// ─── DEFAULT CATEGORIES ───────────────────────────────────────────────────────
const DEFAULT_CATEGORIES = [
  { name: 'Tafsiira',  slug: 'tafsiira',  description: 'Quranic exegesis and interpretation' },
  { name: 'Riyaada',   slug: 'riyaada',   description: 'Spiritual exercises and devotional practices' },
  { name: 'Tawhiid',   slug: 'tawhiid',   description: 'Islamic monotheism and creed' },
  { name: 'Usool',     slug: 'usool',     description: 'Principles of Islamic jurisprudence' },
  { name: 'Buluga',    slug: 'buluga',    description: 'Hadith studies and Bulugh al-Maram' },
  { name: 'Tajwiid',   slug: 'tajwiid',   description: 'Rules of Quranic recitation' },
  { name: 'Arbina',    slug: 'arbina',    description: 'The Forty Hadith (Arba\'een al-Nawawi)' },
];

// ─── SEED DEFAULT CATEGORIES ──────────────────────────────────────────────────
async function seedDefaultCategories(schoolId) {
  for (const cat of DEFAULT_CATEGORIES) {
    await prisma.audioCategory.upsert({
      where: { schoolId_slug: { schoolId: schoolId || '', slug: cat.slug } },
      update: {},
      create: {
        schoolId: schoolId || null,
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        isDefault: true,
        isCustom: false
      }
    });
  }
}

// ─── CATEGORIES ───────────────────────────────────────────────────────────────

async function listCategories(req, res, next) {
  try {
    const schoolId = req.user.schoolId;

    // Auto-seed defaults if none exist
    const count = await prisma.audioCategory.count({
      where: { schoolId: schoolId || null, deletedAt: null }
    });
    if (count === 0) await seedDefaultCategories(schoolId);

    const categories = await prisma.audioCategory.findMany({
      where: { schoolId: schoolId || null, deletedAt: null },
      include: {
        _count: { select: { courses: true, lessons: true } }
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }]
    });

    return successResponse(res, categories, 'Categories fetched');
  } catch (error) { next(error); }
}

async function createCategory(req, res, next) {
  try {
    const { name, description } = req.body;
    const schoolId = req.user.schoolId;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const existing = await prisma.audioCategory.findFirst({
      where: { schoolId: schoolId || null, slug, deletedAt: null }
    });
    if (existing) return errorResponse(res, 'Category with this name already exists', 409);

    const category = await prisma.audioCategory.create({
      data: {
        schoolId: schoolId || null,
        name,
        slug,
        description: description || null,
        isDefault: false,
        isCustom: true,
        createdBy: req.user.id
      }
    });

    return successResponse(res, category, 'Category created', 201);
  } catch (error) { next(error); }
}

async function deleteCategory(req, res, next) {
  try {
    const cat = await prisma.audioCategory.findUnique({ where: { id: req.params.id } });
    if (!cat) return errorResponse(res, 'Category not found', 404);
    if (cat.isDefault) return errorResponse(res, 'Cannot delete default categories', 403);

    await prisma.audioCategory.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date() }
    });
    return successResponse(res, null, 'Category deleted');
  } catch (error) { next(error); }
}

// ─── COURSES ──────────────────────────────────────────────────────────────────

async function listCourses(req, res, next) {
  try {
    const { categoryId, teacherId, search, page = 1, limit = 20 } = req.query;
    const schoolId = req.user.schoolId;
    const { skip, ...pagination } = getPagination(page, limit);

    const where = {
      deletedAt: null,
      ...(schoolId && { schoolId })
    };
    if (categoryId) where.categoryId = categoryId;
    if (teacherId) where.teacherId = teacherId;
    if (search) where.title = { contains: String(search) };

    const [courses, total] = await Promise.all([
      prisma.audioCourse.findMany({
        where,
        include: {
          category: { select: { id: true, name: true, slug: true } },
          teacher: { include: { user: { select: { firstName: true, lastName: true, avatarUrl: true } } } },
          _count: { select: { lessons: { where: { deletedAt: null } } } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pagination.limit
      }),
      prisma.audioCourse.count({ where })
    ]);

    return paginatedResponse(res, courses, buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (error) { next(error); }
}

async function getCourse(req, res, next) {
  try {
    const course = await prisma.audioCourse.findUnique({
      where: { id: req.params.id },
      include: {
        category: true,
        teacher: { include: { user: { select: { firstName: true, lastName: true, avatarUrl: true } } } },
        lessons: {
          where: { deletedAt: null },
          orderBy: { orderIndex: 'asc' },
          include: {
            teacher: { include: { user: { select: { firstName: true, lastName: true } } } }
          }
        }
      }
    });
    if (!course) return errorResponse(res, 'Course not found', 404);
    return successResponse(res, course);
  } catch (error) { next(error); }
}

async function createCourse(req, res, next) {
  try {
    const { title, description, categoryId } = req.body;
    const schoolId = req.user.schoolId;

    const teacher = await prisma.teacher.findFirst({ where: { userId: req.user.id } });
    if (!teacher && req.user.role === 'TEACHER') {
      return errorResponse(res, 'Teacher profile not found', 404);
    }

    // Admins can specify teacherId; teachers use their own
    const teacherId = teacher?.id || req.body.teacherId;
    if (!teacherId) return errorResponse(res, 'Teacher ID required', 400);

    const course = await prisma.audioCourse.create({
      data: {
        schoolId: schoolId || null,
        categoryId,
        teacherId,
        title,
        description: description || null
      },
      include: {
        category: { select: { id: true, name: true } },
        teacher: { include: { user: { select: { firstName: true, lastName: true } } } }
      }
    });

    return successResponse(res, course, 'Course created', 201);
  } catch (error) { next(error); }
}

async function updateCourse(req, res, next) {
  try {
    const { title, description, categoryId, isPublished } = req.body;
    const course = await prisma.audioCourse.findUnique({ where: { id: req.params.id } });
    if (!course) return errorResponse(res, 'Course not found', 404);

    // Teachers can only edit their own
    if (req.user.role === 'TEACHER') {
      const teacher = await prisma.teacher.findFirst({ where: { userId: req.user.id } });
      if (course.teacherId !== teacher?.id) return errorResponse(res, 'Not authorized', 403);
    }

    const updated = await prisma.audioCourse.update({
      where: { id: req.params.id },
      data: { title, description, categoryId, isPublished }
    });
    return successResponse(res, updated, 'Course updated');
  } catch (error) { next(error); }
}

async function deleteCourse(req, res, next) {
  try {
    const course = await prisma.audioCourse.findUnique({ where: { id: req.params.id } });
    if (!course) return errorResponse(res, 'Course not found', 404);

    if (req.user.role === 'TEACHER') {
      const teacher = await prisma.teacher.findFirst({ where: { userId: req.user.id } });
      if (course.teacherId !== teacher?.id) return errorResponse(res, 'Not authorized', 403);
    }

    await prisma.audioCourse.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    return successResponse(res, null, 'Course deleted');
  } catch (error) { next(error); }
}

// ─── AUDIO LESSONS ────────────────────────────────────────────────────────────

async function listLessons(req, res, next) {
  try {
    const { courseId, categoryId, teacherId, search, page = 1, limit = 20 } = req.query;
    const schoolId = req.user.schoolId;
    const { skip, ...pagination } = getPagination(page, limit);

    const where = {
      deletedAt: null,
      ...(schoolId && { schoolId })
    };
    if (courseId) where.courseId = courseId;
    if (categoryId) where.categoryId = categoryId;
    if (teacherId) where.teacherId = teacherId;
    if (search) where.title = { contains: String(search) };

    const [lessons, total] = await Promise.all([
      prisma.audioLesson.findMany({
        where,
        include: {
          course: { select: { id: true, title: true } },
          category: { select: { id: true, name: true, slug: true } },
          teacher: { include: { user: { select: { firstName: true, lastName: true, avatarUrl: true } } } }
        },
        orderBy: [{ courseId: 'asc' }, { orderIndex: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: pagination.limit
      }),
      prisma.audioLesson.count({ where })
    ]);

    return paginatedResponse(res, lessons, buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (error) { next(error); }
}

async function getLesson(req, res, next) {
  try {
    const lesson = await prisma.audioLesson.findUnique({
      where: { id: req.params.id },
      include: {
        course: { select: { id: true, title: true } },
        category: { select: { id: true, name: true } },
        teacher: { include: { user: { select: { firstName: true, lastName: true, avatarUrl: true } } } }
      }
    });
    if (!lesson) return errorResponse(res, 'Lesson not found', 404);

    // Increment play count
    await prisma.audioLesson.update({
      where: { id: req.params.id },
      data: { playCount: { increment: 1 } }
    });

    return successResponse(res, lesson);
  } catch (error) { next(error); }
}

async function uploadLesson(req, res, next) {
  try {
    if (!req.file) return errorResponse(res, 'Audio file required', 400);

    const { title, description, courseId, categoryId, orderIndex } = req.body;
    const schoolId = req.user.schoolId;

    const teacher = await prisma.teacher.findFirst({ where: { userId: req.user.id } });
    const teacherId = teacher?.id || req.body.teacherId;
    if (!teacherId) return errorResponse(res, 'Teacher profile not found', 404);

    // Verify course belongs to this teacher (or admin)
    const course = await prisma.audioCourse.findUnique({ where: { id: courseId } });
    if (!course) return errorResponse(res, 'Course not found', 404);
    if (req.user.role === 'TEACHER' && course.teacherId !== teacherId) {
      return errorResponse(res, 'Not authorized to add lessons to this course', 403);
    }

    // Save to configured storage (local or S3)
    const ext      = path.extname(req.file.originalname).toLowerCase();
    const filename = `${uuidv4()}${ext}`;
    const { url: audioUrl, storageType } = await saveFile(
      req.file.buffer,
      filename,
      req.file.mimetype,
      'audio'
    );

    const lesson = await prisma.audioLesson.create({
      data: {
        schoolId:     schoolId || null,
        courseId,
        categoryId:   categoryId || course.categoryId,
        teacherId,
        title,
        description:  description || null,
        audioUrl,
        filename,
        originalName: req.file.originalname,
        mimeType:     req.file.mimetype,
        fileSize:     req.file.size,
        orderIndex:   orderIndex ? parseInt(orderIndex) : 0,
      },
      include: {
        course:   { select: { id: true, title: true } },
        category: { select: { id: true, name: true } },
        teacher:  { include: { user: { select: { firstName: true, lastName: true } } } },
      },
    });

    return successResponse(res, lesson, 'Audio lesson uploaded', 201);
  } catch (error) { next(error); }
}

async function updateLesson(req, res, next) {
  try {
    const { title, description, orderIndex, isPublished } = req.body;
    const lesson = await prisma.audioLesson.findUnique({ where: { id: req.params.id } });
    if (!lesson) return errorResponse(res, 'Lesson not found', 404);

    if (req.user.role === 'TEACHER') {
      const teacher = await prisma.teacher.findFirst({ where: { userId: req.user.id } });
      if (lesson.teacherId !== teacher?.id) return errorResponse(res, 'Not authorized', 403);
    }

    const updated = await prisma.audioLesson.update({
      where: { id: req.params.id },
      data: { title, description, orderIndex: orderIndex ? parseInt(orderIndex) : undefined, isPublished }
    });
    return successResponse(res, updated, 'Lesson updated');
  } catch (error) { next(error); }
}

async function deleteLesson(req, res, next) {
  try {
    const lesson = await prisma.audioLesson.findUnique({ where: { id: req.params.id } });
    if (!lesson) return errorResponse(res, 'Lesson not found', 404);

    if (req.user.role === 'TEACHER') {
      const teacher = await prisma.teacher.findFirst({ where: { userId: req.user.id } });
      if (lesson.teacherId !== teacher?.id) return errorResponse(res, 'Not authorized', 403);
    }

    // Soft delete
    await prisma.audioLesson.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });

    // Delete the audio file from storage (R2 or local)
    // audioUrl may be a full URL (R2) or a local path — deleteFile handles both
    if (lesson.audioUrl) {
      await deleteFile(lesson.audioUrl).catch(err =>
        logger.warn(`[audio] Could not delete file for lesson ${lesson.id}: ${err.message}`)
      );
    }

    return successResponse(res, null, 'Lesson deleted');
  } catch (error) { next(error); }
}

module.exports = {
  listCategories, createCategory, deleteCategory,
  listCourses, getCourse, createCourse, updateCourse, deleteCourse,
  listLessons, getLesson, uploadLesson, updateLesson, deleteLesson
};
