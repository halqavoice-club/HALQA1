const router = require('express').Router();
const multer = require('multer');
const path   = require('path');
const { v4: uuidv4 } = require('uuid');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ctrl   = require('../controllers/school.controller');
const prisma = require('../utils/prisma');
const { saveFile, deleteFile } = require('../utils/storage');
const { successResponse, errorResponse } = require('../utils/response');

// ─── Logo upload — memory storage, saveFile() handles local vs S3 ────────────
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'].includes(file.mimetype);
    ok ? cb(null, true) : cb(new Error('Only JPEG, PNG, WebP or SVG allowed'));
  },
});

router.use(authenticate);

// ─── GET /schools/search — public school search for the "Join a School" flow ──
// Any authenticated user can search for schools to join.
// Returns non-sensitive public fields only (no private settings or stats).
router.get('/search', async (req, res, next) => {
  try {
    const { search = '', limit = 10 } = req.query;
    const schools = await prisma.school.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        ...(search ? {
          OR: [
            { name:  { contains: String(search) } },
            { slug:  { contains: String(search) } },
            { city:  { contains: String(search) } },
          ]
        } : {})
      },
      select: {
        id: true, name: true, slug: true, type: true,
        city: true, country: true, logoUrl: true
      },
      take: Math.min(Number(limit) || 10, 50),
      orderBy: { name: 'asc' }
    });
    return res.json({ success: true, data: schools });
  } catch (error) { next(error); }
});

// ─── GET /schools/browse — public paginated school list ───────────────────────
// Any authenticated user can browse all active schools (public profiles only).
// Used by the "Browse Schools" / "Discover" page. Returns school count and
// whether the current user is already a member so the UI can show correct state.
router.get('/browse', async (req, res, next) => {
  try {
    const { search = '', page = 1, limit = 20, type } = req.query;
    const skip = (Math.max(1, Number(page)) - 1) * Math.min(Number(limit) || 20, 50);
    const take = Math.min(Number(limit) || 20, 50);

    const where = {
      isActive: true,
      deletedAt: null,
      ...(type ? { type: String(type) } : {}),
      ...(search ? {
        OR: [
          { name:  { contains: String(search) } },
          { slug:  { contains: String(search) } },
          { city:  { contains: String(search) } },
          { country: { contains: String(search) } },
        ]
      } : {})
    };

    const [schools, total] = await Promise.all([
      prisma.school.findMany({
        where,
        select: {
          id: true, name: true, slug: true, type: true,
          city: true, country: true, logoUrl: true,
          _count: { select: { memberships: { where: { status: 'ACTIVE' } } } }
        },
        skip,
        take,
        orderBy: { name: 'asc' }
      }),
      prisma.school.count({ where })
    ]);

    // Enrich with current user's membership status for each school
    const schoolIds = schools.map(s => s.id);
    const myMemberships = await prisma.schoolMembership.findMany({
      where: { userId: req.user.id, schoolId: { in: schoolIds } },
      select: { schoolId: true, role: true, status: true }
    });
    const membershipMap = new Map(myMemberships.map(m => [m.schoolId, m]));

    const enriched = schools.map(s => ({
      id:          s.id,
      name:        s.name,
      slug:        s.slug,
      type:        s.type,
      city:        s.city,
      country:     s.country,
      logoUrl:     s.logoUrl,
      memberCount: s._count.memberships,
      myMembership: membershipMap.get(s.id) || null,
    }));

    return res.json({
      success: true,
      data: enriched,
      pagination: { total, page: Number(page), limit: take, pages: Math.ceil(total / take) }
    });
  } catch (error) { next(error); }
});

router.get('/', authorize('SUPER_ADMIN'), ctrl.listSchools);
router.get('/:id', ctrl.getSchool);
router.get('/:id/stats', ctrl.getSchoolStats);

router.post('/',
  authorize('SUPER_ADMIN'),
  [
    body('name').trim().notEmpty(),
    body('slug').trim().notEmpty(),
    body('type').optional().isIn(['school', 'academy', 'college', 'daycare', 'camp', 'sports'])
  ],
  validate,
  ctrl.createSchool
);

router.put('/:id',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  // F-4 FIX: Add school ownership check for SCHOOL_ADMIN.
  // NF-2 FIX: Also check req.schoolMembership?.schoolId for new-architecture MEMBER users
  // with SCHOOL_ADMIN membership (their user.schoolId may be null or different).
  (req, res, next) => {
    if (req.user.role === 'SCHOOL_ADMIN') {
      const ownSchoolId = req.schoolMembership?.schoolId || req.user.schoolId;
      if (ownSchoolId !== req.params.id) {
        const { errorResponse } = require('../utils/response');
        return errorResponse(res, 'You can only update your own school', 403);
      }
    }
    next();
  },
  ctrl.updateSchool
);
router.put('/:id/settings',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  // F-4 FIX + NF-2 FIX: Same ownership check using membership-aware schoolId.
  (req, res, next) => {
    if (req.user.role === 'SCHOOL_ADMIN') {
      const ownSchoolId = req.schoolMembership?.schoolId || req.user.schoolId;
      if (ownSchoolId !== req.params.id) {
        const { errorResponse } = require('../utils/response');
        return errorResponse(res, 'You can only update settings for your own school', 403);
      }
    }
    next();
  },
  ctrl.updateSchoolSettings
);
router.delete('/:id', authorize('SUPER_ADMIN'), ctrl.deleteSchool);

// Logo upload
router.post('/:id/logo',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
  // F-4 FIX + NF-2 FIX: SCHOOL_ADMIN can only upload logo for their own school.
  (req, res, next) => {
    if (req.user.role === 'SCHOOL_ADMIN') {
      const ownSchoolId = req.schoolMembership?.schoolId || req.user.schoolId;
      if (ownSchoolId !== req.params.id) {
        const { errorResponse } = require('../utils/response');
        return errorResponse(res, 'You can only upload a logo for your own school', 403);
      }
    }
    next();
  },
  logoUpload.single('logo'),
  async (req, res, next) => {
    try {
      if (!req.file) return errorResponse(res, 'No image uploaded', 400);

      const ext      = path.extname(req.file.originalname).toLowerCase();
      const filename = `logo-${req.params.id}-${uuidv4()}${ext}`;
      const { url }  = await saveFile(req.file.buffer, filename, req.file.mimetype, 'logos');

      // Delete old logo from whichever backend stored it
      const existing = await prisma.school.findUnique({
        where:  { id: req.params.id },
        select: { logoUrl: true },
      });
      if (existing?.logoUrl) {
        await deleteFile(existing.logoUrl).catch(() => {});
      }

      const school = await prisma.school.update({
        where:  { id: req.params.id },
        data:   { logoUrl: url },
        select: { id: true, logoUrl: true, name: true },
      });
      return successResponse(res, school, 'Logo updated');
    } catch (error) { next(error); }
  }
);

module.exports = router;
