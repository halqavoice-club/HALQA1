'use strict';
const router = require('express').Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth.middleware');
const { eduAdmin } = require('../middleware/educationAuth');
const ctrl = require('../controllers/import.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only Excel/CSV files allowed'));
  }
});

router.use(authenticate);
// All import/export operations are admin-only and school-scoped
router.use(...eduAdmin);

router.post('/students',  upload.single('file'), ctrl.importStudents);
router.post('/teachers',  upload.single('file'), ctrl.importTeachers);
router.post('/guardians', upload.single('file'), ctrl.importGuardians);
router.post('/classes',   upload.single('file'), ctrl.importClasses);

router.get('/students/export',   ctrl.exportStudents);
router.get('/teachers/export',   ctrl.exportTeachers);
router.get('/attendance/export', ctrl.exportAttendance);
router.get('/grades/export',     ctrl.exportGrades);
router.get('/behavior/export',   ctrl.exportBehavior);

router.get('/template/:type', ctrl.downloadTemplate);

module.exports = router;
