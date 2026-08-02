const prisma = require('../utils/prisma');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');

async function listSchools(req, res, next) {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const { skip, ...pagination } = getPagination(page, limit);
    const where = { deletedAt: null };
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { slug: { contains: search } }
      ];
    }
    const [schools, total] = await Promise.all([
      prisma.school.findMany({ where, skip, take: pagination.limit, orderBy: { name: 'asc' } }),
      prisma.school.count({ where })
    ]);
    return paginatedResponse(res, schools, buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (error) { next(error); }
}

async function getSchool(req, res, next) {
  try {
    const school = await prisma.school.findUnique({
      where: { id: req.params.id },
      include: { settings: true }
    });
    if (!school) return errorResponse(res, 'School not found', 404);
    return successResponse(res, school);
  } catch (error) { next(error); }
}

async function createSchool(req, res, next) {
  try {
    // Explicit field extraction prevents mass assignment
    const {
      name, slug, type, address, city, state, country,
      phone, email, website, logoUrl, timezone
    } = req.body;

    const school = await prisma.school.create({
      data: {
        name,
        slug,
        type:     type     || 'school',
        address:  address  || null,
        city:     city     || null,
        state:    state    || null,
        country:  country  || 'US',
        phone:    phone    || null,
        email:    email    || null,
        website:  website  || null,
        logoUrl:  logoUrl  || null,
        timezone: timezone || 'America/New_York',
        settings: { create: {} }
      },
      include: { settings: true }
    });
    return successResponse(res, school, 'School created', 201);
  } catch (error) { next(error); }
}

async function updateSchool(req, res, next) {
  try {
    // Explicit field extraction prevents mass assignment
    // Sensitive fields (deletedAt, isActive) are NOT accepted from req.body
    const {
      name, slug, type, address, city, state, country,
      phone, email, website, logoUrl, timezone
    } = req.body;

    const data = {};
    if (name     !== undefined) data.name     = name;
    if (slug     !== undefined) data.slug     = slug;
    if (type     !== undefined) data.type     = type;
    if (address  !== undefined) data.address  = address  || null;
    if (city     !== undefined) data.city     = city     || null;
    if (state    !== undefined) data.state    = state    || null;
    if (country  !== undefined) data.country  = country;
    if (phone    !== undefined) data.phone    = phone    || null;
    if (email    !== undefined) data.email    = email    || null;
    if (website  !== undefined) data.website  = website  || null;
    if (logoUrl  !== undefined) data.logoUrl  = logoUrl  || null;
    if (timezone !== undefined) data.timezone = timezone;

    const school = await prisma.school.update({
      where: { id: req.params.id },
      data
    });
    return successResponse(res, school, 'School updated');
  } catch (error) { next(error); }
}

async function updateSchoolSettings(req, res, next) {
  try {
    // Explicit field extraction prevents mass assignment on settings
    const {
      gradingScale, attendanceTypes, behaviorCategories, workingDays,
      schoolStartTime, schoolEndTime, allowSelfCheckIn, requireGpsCheckIn,
      parentNotifications, smsEnabled, emailEnabled, pushEnabled,
      maxAbsenceAlert, passingGrade
    } = req.body;

    const data = {};
    if (gradingScale         !== undefined) data.gradingScale         = gradingScale         || null;
    if (attendanceTypes      !== undefined) data.attendanceTypes      = attendanceTypes      || null;
    if (behaviorCategories   !== undefined) data.behaviorCategories   = behaviorCategories   || null;
    if (workingDays          !== undefined) data.workingDays          = workingDays          || null;
    if (schoolStartTime      !== undefined) data.schoolStartTime      = schoolStartTime;
    if (schoolEndTime        !== undefined) data.schoolEndTime        = schoolEndTime;
    if (allowSelfCheckIn     !== undefined) data.allowSelfCheckIn     = Boolean(allowSelfCheckIn);
    if (requireGpsCheckIn    !== undefined) data.requireGpsCheckIn    = Boolean(requireGpsCheckIn);
    if (parentNotifications  !== undefined) data.parentNotifications  = Boolean(parentNotifications);
    if (smsEnabled           !== undefined) data.smsEnabled           = Boolean(smsEnabled);
    if (emailEnabled         !== undefined) data.emailEnabled         = Boolean(emailEnabled);
    if (pushEnabled          !== undefined) data.pushEnabled          = Boolean(pushEnabled);
    if (maxAbsenceAlert      !== undefined) data.maxAbsenceAlert      = parseInt(maxAbsenceAlert);
    if (passingGrade         !== undefined) data.passingGrade         = parseFloat(passingGrade);

    const settings = await prisma.schoolSettings.upsert({
      where:  { schoolId: req.params.id },
      update: data,
      create: { schoolId: req.params.id, ...data }
    });
    return successResponse(res, settings, 'Settings updated');
  } catch (error) { next(error); }
}

async function deleteSchool(req, res, next) {
  try {
    await prisma.school.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date() }
    });
    return successResponse(res, null, 'School deleted');
  } catch (error) { next(error); }
}

async function getSchoolStats(req, res, next) {
  try {
    const { id } = req.params;
    const [students, teachers, classes, guardians] = await Promise.all([
      prisma.student.count({ where: { schoolId: id, deletedAt: null } }),
      prisma.teacher.count({ where: { schoolId: id, deletedAt: null } }),
      prisma.class.count({ where: { schoolId: id, isActive: true, deletedAt: null } }),
      prisma.guardian.count({ where: { schoolId: id, deletedAt: null } })
    ]);
    return successResponse(res, { students, teachers, classes, guardians });
  } catch (error) { next(error); }
}

module.exports = { listSchools, getSchool, createSchool, updateSchool, updateSchoolSettings, deleteSchool, getSchoolStats };
