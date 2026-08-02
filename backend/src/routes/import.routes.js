const router = require('express').Router();
const multer = require('multer');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/import.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only Excel/CSV files allowed'));
  }
});

router.use(authenticate);
router.use(authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'));

// ─── IMPORTS ──────────────────────────────────────────────────────────────────
router.post('/students',  upload.single('file'), ctrl.importStudents);
router.post('/teachers',  upload.single('file'), ctrl.importTeachers);
router.post('/guardians', upload.single('file'), ctrl.importGuardians);
router.post('/classes',   upload.single('file'), ctrl.importClasses);

// ─── EXPORTS (authenticated — sends file with JWT) ────────────────────────────
router.get('/students/export',   ctrl.exportStudents);
router.get('/teachers/export',   ctrl.exportTeachers);
router.get('/attendance/export', ctrl.exportAttendance);
router.get('/grades/export',     ctrl.exportGrades);
router.get('/behavior/export',   ctrl.exportBehavior);

// ─── TEMPLATES ────────────────────────────────────────────────────────────────
router.get('/template/:type', ctrl.downloadTemplate);

module.exports = router;
