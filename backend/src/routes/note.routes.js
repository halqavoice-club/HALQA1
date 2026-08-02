const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, classId, studentId } = req.query;
    const { skip, ...pagination } = getPagination(page, limit);

    const where = {
      deletedAt: null,
      OR: [
        { userId: req.user.id },
        { isPrivate: false }
      ]
    };

    if (classId) where.classId = classId;
    if (studentId) where.studentId = studentId;

    const [notes, total] = await Promise.all([
      prisma.note.findMany({
        where,
        include: {
          user: { select: { firstName: true, lastName: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pagination.limit
      }),
      prisma.note.count({ where })
    ]);

    return paginatedResponse(res, notes, buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (error) { next(error); }
});

router.post('/',
  [body('title').trim().notEmpty(), body('content').notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      // Explicit field extraction — userId is taken from req.user, NOT req.body
      // This prevents a user from impersonating another user's notes
      const { title, content, isPrivate, classId, studentId, attachments } = req.body;

      const note = await prisma.note.create({
        data: {
          userId:      req.user.id,   // always from authenticated user
          title,
          content,
          isPrivate:   isPrivate   !== undefined ? Boolean(isPrivate) : false,
          classId:     classId     || null,
          studentId:   studentId   || null,
          attachments: attachments || null,
        }
      });
      return successResponse(res, note, 'Note created', 201);
    } catch (error) { next(error); }
  }
);

router.put('/:id', async (req, res, next) => {
  try {
    const note = await prisma.note.findUnique({ where: { id: req.params.id } });
    if (!note || note.userId !== req.user.id) return errorResponse(res, 'Not authorized', 403);

    // Explicit field extraction — prevents mass assignment of userId, deletedAt
    const { title, content, isPrivate, attachments } = req.body;
    const data = {};
    if (title       !== undefined) data.title       = title;
    if (content     !== undefined) data.content     = content;
    if (isPrivate   !== undefined) data.isPrivate   = Boolean(isPrivate);
    if (attachments !== undefined) data.attachments = attachments || null;

    const updated = await prisma.note.update({
      where: { id: req.params.id },
      data
    });
    return successResponse(res, updated, 'Note updated');
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const note = await prisma.note.findUnique({ where: { id: req.params.id } });
    if (!note || note.userId !== req.user.id) return errorResponse(res, 'Not authorized', 403);

    await prisma.note.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    return successResponse(res, null, 'Note deleted');
  } catch (error) { next(error); }
});

module.exports = router;
