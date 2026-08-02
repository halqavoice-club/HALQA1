/**
 * Transport Controller
 * 
 * Handles school transport management including:
 * - School bus fleet management
 * - Bus routes and stops
 * - Driver management
 * - Student bus assignments
 */

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

/**
 * Create a new school bus
 */
async function createSchoolBus(req, res) {
  try {
    const { schoolId, plateNumber, busNumber, capacity, make, model, year, color, fuelType, insuranceExpiry, lastServiceAt, nextServiceAt, notes } = req.body;

    const bus = await prisma.schoolBus.create({
      data: {
        schoolId,
        plateNumber,
        busNumber,
        capacity,
        make,
        model,
        year,
        color,
        fuelType,
        insuranceExpiry: insuranceExpiry ? new Date(insuranceExpiry) : null,
        lastServiceAt: lastServiceAt ? new Date(lastServiceAt) : null,
        nextServiceAt: nextServiceAt ? new Date(nextServiceAt) : null,
        notes,
        status: 'ACTIVE'
      }
    });

    logger.info(`School bus created: ${bus.id} for school ${schoolId}`);
    
    res.status(201).json({
      success: true,
      data: bus
    });
  } catch (error) {
    logger.error('Failed to create school bus:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to create school bus',
        statusCode: 500
      })
    });
  }
}

/**
 * Get school buses for a school
 */
async function getSchoolBuses(req, res) {
  try {
    const { schoolId } = req.params;
    const { status } = req.query;

    const where = { schoolId };
    if (status) where.status = status;

    const buses = await prisma.schoolBus.findMany({
      where,
      include: {
        routes: {
          where: { isActive: true },
          include: {
            stops: {
              where: { isActive: true },
              orderBy: { sequence: 'asc' }
            }
          }
        },
        assignments: {
          where: { isActive: true },
          include: {
            student: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true }
            },
            driver: {
              select: { id: true, firstName: true, lastName: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: buses
    });
  } catch (error) {
    logger.error('Failed to get school buses:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get school buses',
        statusCode: 500
      })
    });
  }
}

/**
 * Update a school bus
 */
async function updateSchoolBus(req, res) {
  try {
    const { id } = req.params;
    const { plateNumber, busNumber, capacity, make, model, year, color, fuelType, status, insuranceExpiry, lastServiceAt, nextServiceAt, notes } = req.body;

    const bus = await prisma.schoolBus.findUnique({
      where: { id }
    });

    if (!bus) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'School bus not found',
          statusCode: 404
        })
      });
    }

    const updated = await prisma.schoolBus.update({
      where: { id },
      data: {
        plateNumber: plateNumber !== undefined ? plateNumber : bus.plateNumber,
        busNumber: busNumber !== undefined ? busNumber : bus.busNumber,
        capacity: capacity !== undefined ? capacity : bus.capacity,
        make: make !== undefined ? make : bus.make,
        model: model !== undefined ? model : bus.model,
        year: year !== undefined ? year : bus.year,
        color: color !== undefined ? color : bus.color,
        fuelType: fuelType !== undefined ? fuelType : bus.fuelType,
        status: status !== undefined ? status : bus.status,
        insuranceExpiry: insuranceExpiry !== undefined ? (insuranceExpiry ? new Date(insuranceExpiry) : null) : bus.insuranceExpiry,
        lastServiceAt: lastServiceAt !== undefined ? (lastServiceAt ? new Date(lastServiceAt) : null) : bus.lastServiceAt,
        nextServiceAt: nextServiceAt !== undefined ? (nextServiceAt ? new Date(nextServiceAt) : null) : bus.nextServiceAt,
        notes: notes !== undefined ? notes : bus.notes
      }
    });

    logger.info(`School bus ${id} updated`);

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    logger.error('Failed to update school bus:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to update school bus',
        statusCode: 500
      })
    });
  }
}

/**
 * Create a bus route
 */
async function createBusRoute(req, res) {
  try {
    const { schoolId, busId, name, description, routeNumber, startTime, endTime, distanceKm, durationMin } = req.body;

    const route = await prisma.busRoute.create({
      data: {
        schoolId,
        busId,
        name,
        description,
        routeNumber,
        startTime,
        endTime,
        distanceKm,
        durationMin,
        isActive: true
      }
    });

    logger.info(`Bus route created: ${route.id} for bus ${busId}`);
    
    res.status(201).json({
      success: true,
      data: route
    });
  } catch (error) {
    logger.error('Failed to create bus route:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to create bus route',
        statusCode: 500
      })
    });
  }
}

/**
 * Get bus routes for a school
 */
async function getBusRoutes(req, res) {
  try {
    const { schoolId } = req.params;
    const { busId, isActive } = req.query;

    const where = { schoolId };
    if (busId) where.busId = busId;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const routes = await prisma.busRoute.findMany({
      where,
      include: {
        bus: true,
        stops: {
          where: { isActive: true },
          orderBy: { sequence: 'asc' }
        },
        assignments: {
          where: { isActive: true },
          include: {
            student: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true }
            },
            driver: {
              select: { id: true, firstName: true, lastName: true }
            }
          }
        }
      },
      orderBy: { routeNumber: 'asc' }
    });

    res.json({
      success: true,
      data: routes
    });
  } catch (error) {
    logger.error('Failed to get bus routes:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get bus routes',
        statusCode: 500
      })
    });
  }
}

/**
 * Create a bus stop
 */
async function createBusStop(req, res) {
  try {
    const { routeId, name, address, latitude, longitude, sequence, estimatedTime } = req.body;

    const stop = await prisma.busStop.create({
      data: {
        routeId,
        name,
        address,
        latitude,
        longitude,
        sequence,
        estimatedTime,
        isActive: true
      }
    });

    logger.info(`Bus stop created: ${stop.id} for route ${routeId}`);
    
    res.status(201).json({
      success: true,
      data: stop
    });
  } catch (error) {
    logger.error('Failed to create bus stop:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to create bus stop',
        statusCode: 500
      })
    });
  }
}

/**
 * Update a bus stop
 */
async function updateBusStop(req, res) {
  try {
    const { id } = req.params;
    const { name, address, latitude, longitude, sequence, estimatedTime, isActive } = req.body;

    const stop = await prisma.busStop.findUnique({
      where: { id }
    });

    if (!stop) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Bus stop not found',
          statusCode: 404
        })
      });
    }

    const updated = await prisma.busStop.update({
      where: { id },
      data: {
        name: name !== undefined ? name : stop.name,
        address: address !== undefined ? address : stop.address,
        latitude: latitude !== undefined ? latitude : stop.latitude,
        longitude: longitude !== undefined ? longitude : stop.longitude,
        sequence: sequence !== undefined ? sequence : stop.sequence,
        estimatedTime: estimatedTime !== undefined ? estimatedTime : stop.estimatedTime,
        isActive: isActive !== undefined ? isActive : stop.isActive
      }
    });

    logger.info(`Bus stop ${id} updated`);

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    logger.error('Failed to update bus stop:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to update bus stop',
        statusCode: 500
      })
    });
  }
}

/**
 * Create a driver
 */
async function createDriver(req, res) {
  try {
    const { schoolId, userId, firstName, lastName, phone, licenseNumber, licenseExpiry, address, emergencyContact } = req.body;

    const driver = await prisma.driver.create({
      data: {
        schoolId,
        userId,
        firstName,
        lastName,
        phone,
        licenseNumber,
        licenseExpiry: licenseExpiry ? new Date(licenseExpiry) : null,
        address,
        emergencyContact,
        status: 'ACTIVE',
        hiredAt: new Date()
      }
    });

    logger.info(`Driver created: ${driver.id} for school ${schoolId}`);
    
    res.status(201).json({
      success: true,
      data: driver
    });
  } catch (error) {
    logger.error('Failed to create driver:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to create driver',
        statusCode: 500
      })
    });
  }
}

/**
 * Get drivers for a school
 */
async function getDrivers(req, res) {
  try {
    const { schoolId } = req.params;
    const { status } = req.query;

    const where = { schoolId };
    if (status) where.status = status;

    const drivers = await prisma.driver.findMany({
      where,
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true }
        },
        assignments: {
          where: { isActive: true },
          include: {
            bus: true,
            route: true,
            student: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: drivers
    });
  } catch (error) {
    logger.error('Failed to get drivers:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get drivers',
        statusCode: 500
      })
    });
  }
}

/**
 * Update a driver
 */
async function updateDriver(req, res) {
  try {
    const { id } = req.params;
    const { firstName, lastName, phone, licenseNumber, licenseExpiry, address, emergencyContact, status, notes } = req.body;

    const driver = await prisma.driver.findUnique({
      where: { id }
    });

    if (!driver) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Driver not found',
          statusCode: 404
        })
      });
    }

    const updated = await prisma.driver.update({
      where: { id },
      data: {
        firstName: firstName !== undefined ? firstName : driver.firstName,
        lastName: lastName !== undefined ? lastName : driver.lastName,
        phone: phone !== undefined ? phone : driver.phone,
        licenseNumber: licenseNumber !== undefined ? licenseNumber : driver.licenseNumber,
        licenseExpiry: licenseExpiry !== undefined ? (licenseExpiry ? new Date(licenseExpiry) : null) : driver.licenseExpiry,
        address: address !== undefined ? address : driver.address,
        emergencyContact: emergencyContact !== undefined ? emergencyContact : driver.emergencyContact,
        status: status !== undefined ? status : driver.status,
        notes: notes !== undefined ? notes : driver.notes
      }
    });

    logger.info(`Driver ${id} updated`);

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    logger.error('Failed to update driver:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to update driver',
        statusCode: 500
      })
    });
  }
}

/**
 * Create a bus assignment
 */
async function createBusAssignment(req, res) {
  try {
    const { schoolId, busId, routeId, stopId, driverId, studentId, pickupTime, dropoffTime, isMorning, isAfternoon, effectiveFrom, effectiveTo, notes } = req.body;

    const assignment = await prisma.busAssignment.create({
      data: {
        schoolId,
        busId,
        routeId,
        stopId,
        driverId,
        studentId,
        pickupTime,
        dropoffTime,
        isMorning: isMorning !== undefined ? isMorning : true,
        isAfternoon: isAfternoon !== undefined ? isAfternoon : true,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
        notes,
        isActive: true
      }
    });

    logger.info(`Bus assignment created: ${assignment.id} for student ${studentId}`);
    
    res.status(201).json({
      success: true,
      data: assignment
    });
  } catch (error) {
    logger.error('Failed to create bus assignment:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to create bus assignment',
        statusCode: 500
      })
    });
  }
}

/**
 * Get bus assignments for a student
 */
async function getStudentBusAssignments(req, res) {
  try {
    const { studentId } = req.params;
    const { isActive } = req.query;

    const where = { studentId };
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const assignments = await prisma.busAssignment.findMany({
      where,
      include: {
        bus: true,
        route: {
          include: {
            stops: {
              where: { isActive: true },
              orderBy: { sequence: 'asc' }
            }
          }
        },
        stop: true,
        driver: {
          select: { id: true, firstName: true, lastName: true, phone }
        },
        student: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true }
        }
      },
      orderBy: { effectiveFrom: 'desc' }
    });

    res.json({
      success: true,
      data: assignments
    });
  } catch (error) {
    logger.error('Failed to get student bus assignments:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get bus assignments',
        statusCode: 500
      })
    });
  }
}

/**
 * Get bus assignments for a route
 */
async function getRouteBusAssignments(req, res) {
  try {
    const { routeId } = req.params;
    const { isActive } = req.query;

    const where = { routeId };
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const assignments = await prisma.busAssignment.findMany({
      where,
      include: {
        bus: true,
        route: true,
        stop: true,
        driver: {
          select: { id: true, firstName: true, lastName: true, phone }
        },
        student: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true }
        }
      },
      orderBy: { pickupTime: 'asc' }
    });

    res.json({
      success: true,
      data: assignments
    });
  } catch (error) {
    logger.error('Failed to get route bus assignments:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get bus assignments',
        statusCode: 500
      })
    });
  }
}

/**
 * Update a bus assignment
 */
async function updateBusAssignment(req, res) {
  try {
    const { id } = req.params;
    const { busId, routeId, stopId, driverId, pickupTime, dropoffTime, isMorning, isAfternoon, effectiveFrom, effectiveTo, notes, isActive } = req.body;

    const assignment = await prisma.busAssignment.findUnique({
      where: { id }
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Bus assignment not found',
          statusCode: 404
        })
      });
    }

    const updated = await prisma.busAssignment.update({
      where: { id },
      data: {
        busId: busId !== undefined ? busId : assignment.busId,
        routeId: routeId !== undefined ? routeId : assignment.routeId,
        stopId: stopId !== undefined ? stopId : assignment.stopId,
        driverId: driverId !== undefined ? driverId : assignment.driverId,
        pickupTime: pickupTime !== undefined ? pickupTime : assignment.pickupTime,
        dropoffTime: dropoffTime !== undefined ? dropoffTime : assignment.dropoffTime,
        isMorning: isMorning !== undefined ? isMorning : assignment.isMorning,
        isAfternoon: isAfternoon !== undefined ? isAfternoon : assignment.isAfternoon,
        effectiveFrom: effectiveFrom !== undefined ? (effectiveFrom ? new Date(effectiveFrom) : null) : assignment.effectiveFrom,
        effectiveTo: effectiveTo !== undefined ? (effectiveTo ? new Date(effectiveTo) : null) : assignment.effectiveTo,
        notes: notes !== undefined ? notes : assignment.notes,
        isActive: isActive !== undefined ? isActive : assignment.isActive
      }
    });

    logger.info(`Bus assignment ${id} updated`);

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    logger.error('Failed to update bus assignment:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to update bus assignment',
        statusCode: 500
      })
    });
  }
}

/**
 * Delete a bus assignment
 */
async function deleteBusAssignment(req, res) {
  try {
    const { id } = req.params;

    const assignment = await prisma.busAssignment.findUnique({
      where: { id }
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Bus assignment not found',
          statusCode: 404
        })
      });
    }

    await prisma.busAssignment.update({
      where: { id },
      data: { isActive: false }
    });

    logger.info(`Bus assignment ${id} deactivated`);

    res.json({
      success: true,
      message: 'Bus assignment deactivated successfully'
    });
  } catch (error) {
    logger.error('Failed to delete bus assignment:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to delete bus assignment',
        statusCode: 500
      })
    });
  }
}

module.exports = {
  createSchoolBus,
  getSchoolBuses,
  updateSchoolBus,
  createBusRoute,
  getBusRoutes,
  createBusStop,
  updateBusStop,
  createDriver,
  getDrivers,
  updateDriver,
  createBusAssignment,
  getStudentBusAssignments,
  getRouteBusAssignments,
  updateBusAssignment,
  deleteBusAssignment
};
