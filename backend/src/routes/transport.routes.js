/**
 * Transport Routes
 * 
 * API endpoints for school transport management
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const transportController = require('../controllers/transport.controller');

// All routes require authentication
router.use(authenticate);

/**
 * @route   POST /api/v1/transport/buses
 * @desc    Create a new school bus
 * @access  Private (admin only)
 */
router.post('/buses', transportController.createSchoolBus);

/**
 * @route   GET /api/v1/transport/schools/:schoolId/buses
 * @desc    Get school buses for a school
 * @access  Private
 */
router.get('/schools/:schoolId/buses', transportController.getSchoolBuses);

/**
 * @route   PUT /api/v1/transport/buses/:id
 * @desc    Update a school bus
 * @access  Private (admin only)
 */
router.put('/buses/:id', transportController.updateSchoolBus);

/**
 * @route   POST /api/v1/transport/routes
 * @desc    Create a new bus route
 * @access  Private (admin only)
 */
router.post('/routes', transportController.createBusRoute);

/**
 * @route   GET /api/v1/transport/schools/:schoolId/routes
 * @desc    Get bus routes for a school
 * @access  Private
 */
router.get('/schools/:schoolId/routes', transportController.getBusRoutes);

/**
 * @route   POST /api/v1/transport/stops
 * @desc    Create a new bus stop
 * @access  Private (admin only)
 */
router.post('/stops', transportController.createBusStop);

/**
 * @route   PUT /api/v1/transport/stops/:id
 * @desc    Update a bus stop
 * @access  Private (admin only)
 */
router.put('/stops/:id', transportController.updateBusStop);

/**
 * @route   POST /api/v1/transport/drivers
 * @desc    Create a new driver
 * @access  Private (admin only)
 */
router.post('/drivers', transportController.createDriver);

/**
 * @route   GET /api/v1/transport/schools/:schoolId/drivers
 * @desc    Get drivers for a school
 * @access  Private
 */
router.get('/schools/:schoolId/drivers', transportController.getDrivers);

/**
 * @route   PUT /api/v1/transport/drivers/:id
 * @desc    Update a driver
 * @access  Private (admin only)
 */
router.put('/drivers/:id', transportController.updateDriver);

/**
 * @route   POST /api/v1/transport/assignments
 * @desc    Create a new bus assignment
 * @access  Private (admin only)
 */
router.post('/assignments', transportController.createBusAssignment);

/**
 * @route   GET /api/v1/transport/students/:studentId/assignments
 * @desc    Get bus assignments for a student
 * @access  Private
 */
router.get('/students/:studentId/assignments', transportController.getStudentBusAssignments);

/**
 * @route   GET /api/v1/transport/routes/:routeId/assignments
 * @desc    Get bus assignments for a route
 * @access  Private
 */
router.get('/routes/:routeId/assignments', transportController.getRouteBusAssignments);

/**
 * @route   PUT /api/v1/transport/assignments/:id
 * @desc    Update a bus assignment
 * @access  Private (admin only)
 */
router.put('/assignments/:id', transportController.updateBusAssignment);

/**
 * @route   DELETE /api/v1/transport/assignments/:id
 * @desc    Delete a bus assignment
 * @access  Private (admin only)
 */
router.delete('/assignments/:id', transportController.deleteBusAssignment);

module.exports = router;
