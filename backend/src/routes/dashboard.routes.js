'use strict';
const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { eduMember, eduStaff, eduAdmin } = require('../middleware/educationAuth');
const ctrl = require('../controllers/dashboard.controller');

router.use(authenticate);

// Admin dashboard — school admin or super admin
router.get('/admin',   ...eduAdmin, ctrl.getAdminDashboard);

// Teacher dashboard — teacher, school admin, or super admin
router.get('/teacher', ...eduStaff, ctrl.getTeacherDashboard);

// Student / guardian dashboards — any active school member
// (controller scopes the data to the requesting user's own records)
router.get('/student',  ...eduMember, ctrl.getStudentDashboard);
router.get('/guardian', ...eduMember, ctrl.getGuardianDashboard);

module.exports = router;
