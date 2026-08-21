const prisma = require('../utils/prisma');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');
const { getIo } = require('../sockets');

async function sendMessage(req, res, next) {
  try {
    const { recipientIds, subject, body, attachments, classId, isAnnouncement, parentMessageId } = req.body;

    const message = await prisma.message.create({
      data: {
        senderId: req.user.id,
        subject,
        body,
        attachments: attachments || [],
        classId,
        isAnnouncement: isAnnouncement || false,
        schoolId: (req.schoolId || req.user.schoolId),
        parentMessageId: parentMessageId || null,
        recipients: {
          create: recipientIds.map(id => ({ recipientId: id }))
        }
      },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        recipients: {
          include: {
            recipient: { select: { id: true, firstName: true, lastName: true } }
          }
        }
      }
    });

    // Real-time delivery
    const io = getIo();
    if (io) {
      for (const recipientId of recipientIds) {
        io.to(`user:${recipientId}`).emit('message:new', {
          id: message.id,
          sender: message.sender,
          subject,
          body: body.substring(0, 100),
          createdAt: message.createdAt
        });
      }
    }

    // Create notifications
    await prisma.notification.createMany({
      data: recipientIds.map(userId => ({
        userId,
        schoolId: (req.schoolId || req.user.schoolId),
        type: 'MESSAGE',
        title: `New message from ${req.user.firstName} ${req.user.lastName}`,
        body: subject || body.substring(0, 100),
        data: { messageId: message.id }
      }))
    });

    return successResponse(res, message, 'Message sent', 201);
  } catch (error) {
    next(error);
  }
}

async function getInbox(req, res, next) {
  try {
    const { page = 1, limit = 20, unreadOnly } = req.query;
    const { skip, ...pagination } = getPagination(page, limit);

    const where = {
      recipientId: req.user.id,
      deletedAt: null,
      message: { deletedAt: null }
    };

    if (unreadOnly === 'true') where.status = 'SENT';

    const [messages, total] = await Promise.all([
      prisma.messageRecipient.findMany({
        where,
        include: {
          message: {
            include: {
              sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
            }
          }
        },
        orderBy: { message: { createdAt: 'desc' } },
        skip,
        take: pagination.limit
      }),
      prisma.messageRecipient.count({ where })
    ]);

    return paginatedResponse(res, messages, buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (error) {
    next(error);
  }
}

async function getSentMessages(req, res, next) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const { skip, ...pagination } = getPagination(page, limit);

    const where = { senderId: req.user.id, deletedAt: null };

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where,
        include: {
          recipients: {
            include: {
              recipient: { select: { id: true, firstName: true, lastName: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pagination.limit
      }),
      prisma.message.count({ where })
    ]);

    return paginatedResponse(res, messages, buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (error) {
    next(error);
  }
}

async function getMessage(req, res, next) {
  try {
    const { id } = req.params;

    const message = await prisma.message.findUnique({
      where: { id },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        recipients: {
          include: {
            recipient: { select: { id: true, firstName: true, lastName: true } }
          }
        },
        // Include reply thread
        replies: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: {
            sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
            recipients: {
              include: {
                recipient: { select: { id: true, firstName: true, lastName: true } }
              }
            }
          }
        },
        parentMessage: {
          include: {
            sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
          }
        }
      }
    });

    if (!message) return errorResponse(res, 'Message not found', 404);

    // Mark as read if recipient
    const recipientRecord = message.recipients.find(r => r.recipientId === req.user.id);
    if (recipientRecord && recipientRecord.status !== 'READ') {
      await prisma.messageRecipient.update({
        where: { id: recipientRecord.id },
        data: { status: 'READ', readAt: new Date() }
      });
    }

    return successResponse(res, message, 'Message fetched');
  } catch (error) {
    next(error);
  }
}

async function deleteMessage(req, res, next) {
  try {
    const { id } = req.params;

    // Soft delete for recipient
    await prisma.messageRecipient.updateMany({
      where: { messageId: id, recipientId: req.user.id },
      data: { deletedAt: new Date() }
    });

    return successResponse(res, null, 'Message deleted');
  } catch (error) {
    next(error);
  }
}

async function getUnreadCount(req, res, next) {
  try {
    const count = await prisma.messageRecipient.count({
      where: {
        recipientId: req.user.id,
        status: 'SENT',
        deletedAt: null
      }
    });

    return successResponse(res, { count }, 'Unread count fetched');
  } catch (error) {
    next(error);
  }
}

async function markAsRead(req, res, next) {
  try {
    const { id } = req.params;
    await prisma.messageRecipient.updateMany({
      where: { id, recipientId: req.user.id, status: { not: 'READ' } },
      data: { status: 'READ', readAt: new Date() }
    });
    return successResponse(res, null, 'Marked as read');
  } catch (error) { next(error); }
}

module.exports = {
  sendMessage, getInbox, getSentMessages,
  getMessage, markAsRead, deleteMessage, getUnreadCount
};
