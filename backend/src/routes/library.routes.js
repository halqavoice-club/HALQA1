const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse } = require('../utils/response');

router.use(authenticate);

// ─── BOOKS ────────────────────────────────────────────────────────────────────

router.get('/books', async (req, res, next) => {
  try {
    const { search, category, limit = 50 } = req.query;
    const schoolId = req.user.schoolId;

    const where = { schoolId: schoolId || undefined, deletedAt: null };
    if (category) where.category = category;
    if (search) {
      where.OR = [
        { title: { contains: String(search) } },
        { author: { contains: String(search) } },
        { isbn: { contains: String(search) } }
      ];
    }

    const books = await prisma.libraryBook.findMany({
      where,
      include: { _count: { select: { issues: { where: { status: 'ISSUED' } } } } },
      orderBy: { title: 'asc' },
      take: parseInt(limit)
    });

    const booksWithAvailability = books.map(b => ({
      ...b,
      availableCopies: b.totalCopies - (b._count?.issues || 0)
    }));

    // Summary
    const allBooks = await prisma.libraryBook.findMany({ where: { schoolId: schoolId || undefined, deletedAt: null }, include: { _count: { select: { issues: { where: { status: 'ISSUED' } } } } } });
    const totalIssued = allBooks.reduce((s, b) => s + (b._count?.issues || 0), 0);
    const overdueCount = await prisma.libraryIssue.count({ where: { status: 'ISSUED', dueDate: { lt: new Date() }, book: { schoolId: schoolId || undefined } } });

    return res.json({
      success: true,
      data: booksWithAvailability,
      summary: {
        totalBooks: allBooks.length,
        available: allBooks.reduce((s, b) => s + Math.max(0, b.totalCopies - (b._count?.issues || 0)), 0),
        issued: totalIssued,
        overdue: overdueCount
      }
    });
  } catch (error) { next(error); }
});

router.post('/books',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  [body('title').trim().notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      const { title, author, isbn, category, totalCopies, description } = req.body;
      const schoolId = req.user.schoolId;

      const book = await prisma.libraryBook.create({
        data: {
          schoolId: schoolId || null,
          title,
          author: author || null,
          isbn: isbn || null,
          category: category || 'Other',
          totalCopies: parseInt(totalCopies) || 1,
          description: description || null,
          addedBy: req.user.id
        }
      });
      return successResponse(res, book, 'Book added', 201);
    } catch (error) { next(error); }
  }
);

router.put('/books/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  [
    body('title').optional().trim().notEmpty(),
    body('author').optional().isString(),
    body('isbn').optional().isString(),
    body('category').optional().isString(),
    body('totalCopies').optional().isInt({ min: 1 }),
    body('description').optional().isString(),
  ],
  validate,
  async (req, res, next) => {
    try {
      // Explicit field extraction — prevents mass assignment of schoolId, deletedAt, addedBy
      const { title, author, isbn, category, totalCopies, description } = req.body;
      const data = {};
      if (title       !== undefined) data.title       = title;
      if (author      !== undefined) data.author      = author      || null;
      if (isbn        !== undefined) data.isbn        = isbn        || null;
      if (category    !== undefined) data.category    = category;
      if (totalCopies !== undefined) data.totalCopies = parseInt(totalCopies);
      if (description !== undefined) data.description = description || null;

      const book = await prisma.libraryBook.update({ where: { id: req.params.id }, data });
      return successResponse(res, book, 'Book updated');
    } catch (error) { next(error); }
  }
);

router.delete('/books/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  async (req, res, next) => {
    try {
      await prisma.libraryBook.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
      return successResponse(res, null, 'Book deleted');
    } catch (error) { next(error); }
  }
);

// ─── ISSUE / RETURN ───────────────────────────────────────────────────────────

router.post('/books/:id/issue',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  [body('studentId').notEmpty(), body('dueDate').notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      const { studentId, dueDate } = req.body;
      const bookId = req.params.id;

      // Check availability
      const book = await prisma.libraryBook.findUnique({
        where: { id: bookId },
        include: { _count: { select: { issues: { where: { status: 'ISSUED' } } } } }
      });
      if (!book) return errorResponse(res, 'Book not found', 404);
      if (book._count.issues >= book.totalCopies) return errorResponse(res, 'No copies available', 400);

      const issue = await prisma.libraryIssue.create({
        data: {
          bookId,
          studentId,
          issuedBy: req.user.id,
          dueDate: new Date(dueDate),
          status: 'ISSUED'
        },
        include: {
          book: { select: { title: true } },
          student: { include: { user: { select: { firstName: true, lastName: true } } } }
        }
      });
      return successResponse(res, issue, 'Book issued', 201);
    } catch (error) { next(error); }
  }
);

router.get('/issues', async (req, res, next) => {
  try {
    const { status, limit = 50 } = req.query;
    const schoolId = req.user.schoolId;

    const where = { book: { schoolId: schoolId || undefined } };
    if (status) where.status = status;

    const issues = await prisma.libraryIssue.findMany({
      where,
      include: {
        book: { select: { id: true, title: true, category: true } },
        student: { include: { user: { select: { firstName: true, lastName: true } } } }
      },
      orderBy: { issuedAt: 'desc' },
      take: parseInt(limit)
    });
    return successResponse(res, issues);
  } catch (error) { next(error); }
});

router.put('/issues/:id/return',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'),
  async (req, res, next) => {
    try {
      const issue = await prisma.libraryIssue.update({
        where: { id: req.params.id },
        data: { status: 'RETURNED', returnedAt: new Date() }
      });
      return successResponse(res, issue, 'Book returned');
    } catch (error) { next(error); }
  }
);

module.exports = router;
