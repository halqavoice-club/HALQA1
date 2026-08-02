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

router.put('/:id', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), ctrl.updateSchool);
router.put('/:id/settings', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), ctrl.updateSchoolSettings);
router.delete('/:id', authorize('SUPER_ADMIN'), ctrl.deleteSchool);

// Logo upload
router.post('/:id/logo',
  authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'),
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
