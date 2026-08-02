const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/student-report.controller');

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Student Reports
 *   description: Student attendance report endpoints
 */

// GET /api/reports/student/:studentId
// Summary: attendance %, totals, streak
router.get('/student/:studentId', ctrl.getStudentSummary);

// GET /api/reports/student/:studentId/history
// Daily history list with pagination
// Query: startDate, endDate, classId, status, page, limit
router.get('/student/:studentId/history', ctrl.getStudentHistory);

// GET /api/reports/student/:studentId/calendar?month=YYYY-MM
// Monthly calendar grid with color-coded days
router.get('/student/:studentId/calendar', ctrl.getStudentCalendar);

// GET /api/reports/student/:studentId/export/csv
router.get('/student/:studentId/export/csv', ctrl.exportCSV);

// GET /api/reports/student/:studentId/export/excel
router.get('/student/:studentId/export/excel', ctrl.exportExcel);

// GET /api/reports/student/:studentId/export/pdf
router.get('/student/:studentId/export/pdf', ctrl.exportPDF);

// GET /api/reports/student/:studentId/trend
// Weekly + monthly attendance trend using raw MySQL queries
router.get('/student/:studentId/trend', ctrl.getStudentTrend);

module.exports = router;