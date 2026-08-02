const prisma = require('../utils/prisma');
const { getIo } = require('../sockets');
const { sendEmail } = require('../utils/email');
const logger = require('../utils/logger');

/**
 * Create and deliver a notification to a user
 */
async function notify(userId, { type, title, body, data = {}, schoolId = null, channels = ['push'] }) {
  try {
    // Save to database
    const notification = await prisma.notification.create({
      data: {
        userId,
        schoolId,
        type,
        title,
        body,
        data,
        sentVia: channels
      }
    });

    // Push via Socket.IO
    if (channels.includes('push')) {
      const io = getIo();
      if (io) {
        io.to(`user:${userId}`).emit('notification:new', notification);
      }
    }

    // Email notification
    if (channels.includes('email')) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, firstName: true }
      });

      if (user?.email) {
        await sendEmail({
          to: user.email,
          subject: title,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
              <div style="background: #1e40af; padding: 20px; text-align: center;">
                <h2 style="color: white; margin: 0;">Halqa Management System</h2>
              </div>
              <div style="padding: 20px; background: white;">
                <p>Dear ${user.firstName},</p>
                <p>${body}</p>
              </div>
            </div>
          `
        });
      }
    }

    return notification;
  } catch (error) {
    logger.error('Notification failed:', error);
    return null;
  }
}

/**
 * Notify all guardians of a student
 */
async function notifyGuardians(studentId, notification) {
  const guardianLinks = await prisma.guardianStudent.findMany({
    where: { studentId },
    include: {
      guardian: { select: { userId: true } }
    }
  });

  const results = await Promise.allSettled(
    guardianLinks.map(link => notify(link.guardian.userId, notification))
  );

  return results.filter(r => r.status === 'fulfilled').length;
}

/**
 * Notify all users in a school by role
 */
async function notifySchool(schoolId, roles, notification) {
  const users = await prisma.user.findMany({
    where: {
      schoolId,
      role: { in: roles },
      status: 'ACTIVE',
      deletedAt: null
    },
    select: { id: true }
  });

  const results = await Promise.allSettled(
    users.map(u => notify(u.id, { ...notification, schoolId }))
  );

  return results.filter(r => r.status === 'fulfilled').length;
}

/**
 * Notify all students in a class
 */
async function notifyClass(classId, notification) {
  const enrollments = await prisma.enrollment.findMany({
    where: { classId, isActive: true },
    include: { student: { select: { userId: true } } }
  });

  const results = await Promise.allSettled(
    enrollments.map(e => notify(e.student.userId, notification))
  );

  return results.filter(r => r.status === 'fulfilled').length;
}

module.exports = { notify, notifyGuardians, notifySchool, notifyClass };
