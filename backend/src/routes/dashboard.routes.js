const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/dashboard.controller');

router.use(authenticate);

router.get('/admin', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), ctrl.getAdminDashboard);
router.get('/teacher', authorize('TEACHER'), ctrl.getTeacherDashboard);
router.get('/student', authorize('STUDENT'), ctrl.getStudentDashboard);
router.get('/guardian', authorize('GUARDIAN'), ctrl.getGuardianDashboard);

module.exports = router;
