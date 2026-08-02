/**
 * Direct Message Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * 1-to-1 private chat between users.
 *
 * Friends-only enforcement:
 *   By default only friends can DM each other.
 *   Set ALLOW_DM_NON_FRIENDS=true in .env to allow anyone.
 *
 * Socket events emitted:
 *   dm:message        → receiver's personal room
 *   dm:delivered      → sender's personal room (when receiver is online)
 *   dm:read           → sender's personal room
 *   dm:typing_start   → receiver's personal room
 *   dm:typing_stop    → receiver's personal room
 */

const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const { getIo } = require('../sockets');
const { successResponse, errorResponse } = require('../utils/response');

const ALLOW_NON_FRIENDS = process.env.ALLOW_DM_NON_FRIENDS === 'true';
const PAGE_SIZE = 30;

const USER_SELECT = {
  id: true, firstName: true, lastName: true, avatarUrl: true, bio: true
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Canonical conversation key: smaller UUID first */
function convKey(a, b) {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

/** Get or create a conversation between two users */
async function getOrCreateConversation(userAId, userBId) {
  const key = convKey(userAId, userBId);
  return prisma.dmConversation.upsert({
    where:  { userAId_userBId: key },
    create: { id: uuidv4(), ...key },
    update: {}
  });
}

/** Check if two users are friends OR share a school (teachers ↔ students) */
async function areFriends(userA, userB) {
  if (ALLOW_NON_FRIENDS) return true;

  // School-role bypass: TEACHER / SCHOOL_ADMIN / SUPER_ADMIN can message anyone
  // in the same school without needing a friend relationship.
  const [uA, uB] = await Promise.all([
    prisma.user.findUnique({ where: { id: userA }, select: { role: true, schoolId: true } }),
    prisma.user.findUnique({ where: { id: userB }, select: { role: true, schoolId: true } }),
  ]);

  const staffRoles = ['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'];
  const eitherIsStaff = staffRoles.includes(uA?.role) || staffRoles.includes(uB?.role);
  const sameSchool = uA?.schoolId && uB?.schoolId && uA.schoolId === uB.schoolId;

  if (eitherIsStaff && sameSchool) return true;

  // Guardian ↔ their linked students — always allowed
  const isGuardianLink = await prisma.guardianStudent.findFirst({
    where: {
      OR: [
        { guardian: { userId: userA }, student: { userId: userB } },
        { guardian: { userId: userB }, student: { userId: userA } },
      ]
    }
  }).catch(() => null);
  if (isGuardianLink) return true;

  // Fallback: social friend request
  const fr = await prisma.friendRequest.findFirst({
    where: {
      status: 'ACCEPTED',
      OR: [
        { senderId: userA, receiverId: userB },
        { senderId: userB, receiverId: userA }
      ]
    }
  });
  return !!fr;
}

// ─── GET /dm/conversations ────────────────────────────────────────────────────
async function getConversations(req, res, next) {
  try {
    const meId = req.user.id;

    const convs = await prisma.dmConversation.findMany({
      where: { OR: [{ userAId: meId }, { userBId: meId }] },
      include: {
        userA: { select: USER_SELECT },
        userB: { select: USER_SELECT },
      },
      orderBy: { lastMessageAt: 'desc' }
    });

    const result = convs.map(c => {
      const other = c.userAId === meId ? c.userB : c.userA;
      const unread = c.userAId === meId ? c.unreadA : c.unreadB;
      return {
        id:            c.id,
        other,
        lastMessage:   c.lastMessage,
        lastMessageAt: c.lastMessageAt,
        lastSenderId:  c.lastSenderId,
        unread,
        updatedAt:     c.updatedAt,
      };
    });

    return successResponse(res, result);
  } catch (err) { next(err); }
}

// ─── GET /dm/conversations/:userId ───────────────────────────────────────────
// Get or create conversation with a specific user
async function getOrStartConversation(req, res, next) {
  try {
    const meId     = req.user.id;
    const otherId  = req.params.userId;

    if (meId === otherId) return errorResponse(res, 'Cannot message yourself', 400);

    const other = await prisma.user.findUnique({ where: { id: otherId }, select: USER_SELECT });
    if (!other) return errorResponse(res, 'User not found', 404);

    if (!await areFriends(meId, otherId)) {
      return errorResponse(res, 'You can only message friends', 403);
    }

    const conv = await getOrCreateConversation(meId, otherId);
    return successResponse(res, { ...conv, other });
  } catch (err) { next(err); }
}

// ─── GET /dm/conversations/:convId/messages ───────────────────────────────────
async function getMessages(req, res, next) {
  try {
    const meId   = req.user.id;
    const convId = req.params.convId;
    const { before, limit = PAGE_SIZE } = req.query;

    // Verify membership
    const conv = await prisma.dmConversation.findUnique({ where: { id: convId } });
    if (!conv || (conv.userAId !== meId && conv.userBId !== meId)) {
      return errorResponse(res, 'Conversation not found', 404);
    }

    const where = {
      conversationId: convId,
      // BUG FIX: hide messages deleted by this user based on their role (sender/receiver),
      // not on their position in the conversation (userA/userB).
      // A user can be sender in some messages and receiver in others within the same conversation.
      OR: [
        { senderId: meId,   deletedBySender:   false },
        { receiverId: meId, deletedByReceiver: false },
      ],
      ...(before && { createdAt: { lt: new Date(before) } })
    };

    const messages = await prisma.directMessage.findMany({
      where,
      include: { sender: { select: USER_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit), 100)
    });

    // Mark undelivered messages as DELIVERED
    const undelivered = messages.filter(m => m.receiverId === meId && m.status === 'SENT');
    if (undelivered.length > 0) {
      const ids = undelivered.map(m => m.id);
      await prisma.directMessage.updateMany({
        where: { id: { in: ids } },
        data:  { status: 'DELIVERED', deliveredAt: new Date() }
      });
      // Notify sender
      const io = getIo();
      if (io) {
        const senderId = undelivered[0].senderId;
        io.to(`user:${senderId}`).emit('dm:delivered', { convId, messageIds: ids });
      }
    }

    return successResponse(res, messages.reverse());
  } catch (err) { next(err); }
}

// ─── POST /dm/conversations/:convId/messages ──────────────────────────────────
async function sendMessage(req, res, next) {
  try {
    const meId   = req.user.id;
    const convId = req.params.convId;
    const { body, storyId } = req.body;

    if (!body?.trim()) return errorResponse(res, 'Message body required', 400);

    const conv = await prisma.dmConversation.findUnique({ where: { id: convId } });
    if (!conv || (conv.userAId !== meId && conv.userBId !== meId)) {
      return errorResponse(res, 'Conversation not found', 404);
    }

    const receiverId = conv.userAId === meId ? conv.userBId : conv.userAId;

    // Friends-only check BEFORE creating message
    if (!await areFriends(meId, receiverId)) {
      return errorResponse(res, 'You can only message friends', 403);
    }

    const message = await prisma.directMessage.create({
      data: {
        id:             uuidv4(),
        conversationId: convId,
        senderId:       meId,
        receiverId,
        body:           body.trim(),
        status:         'SENT',
        // Story reply context (L8 fix) — optional, null for regular DMs
        storyId:        storyId || null,
      },
      include: {
        sender: { select: USER_SELECT },
        story:  storyId ? { select: { id: true, type: true, mediaUrl: true, text: true, thumbnail: true, authorId: true } } : false
      }
    });

    // Update conversation snapshot
    const isA = conv.userAId === meId;
    await prisma.dmConversation.update({
      where: { id: convId },
      data: {
        lastMessage:   body.trim().slice(0, 100),
        lastMessageAt: message.createdAt,
        lastSenderId:  meId,
        // Increment unread for receiver
        ...(isA ? { unreadB: { increment: 1 } } : { unreadA: { increment: 1 } })
      }
    });

    // Emit to receiver
    const io = getIo();
    if (io) {
      io.to(`user:${receiverId}`).emit('dm:message', {
        convId,
        message: { ...message, sender: { id: meId, firstName: req.user.firstName, lastName: req.user.lastName, avatarUrl: req.user.avatarUrl } }
      });

      // Check if receiver is online — if so, mark as DELIVERED immediately
      const receiverSockets = await io.in(`user:${receiverId}`).fetchSockets();
      if (receiverSockets.length > 0) {
        await prisma.directMessage.update({
          where: { id: message.id },
          data:  { status: 'DELIVERED', deliveredAt: new Date() }
        });
        io.to(`user:${meId}`).emit('dm:delivered', { convId, messageIds: [message.id] });
      }
    }

    return successResponse(res, message, 'Message sent', 201);
  } catch (err) { next(err); }
}

// ─── PATCH /dm/conversations/:convId/read ─────────────────────────────────────
async function markRead(req, res, next) {
  try {
    const meId   = req.user.id;
    const convId = req.params.convId;

    const conv = await prisma.dmConversation.findUnique({ where: { id: convId } });
    if (!conv || (conv.userAId !== meId && conv.userBId !== meId)) {
      return errorResponse(res, 'Conversation not found', 404);
    }

    const now = new Date();

    // Mark all unread messages from the other user as READ
    const updated = await prisma.directMessage.updateMany({
      where: {
        conversationId: convId,
        receiverId:     meId,
        status:         { not: 'READ' }
      },
      data: { status: 'READ', readAt: now }
    });

    // Reset unread counter for me
    const isA = conv.userAId === meId;
    await prisma.dmConversation.update({
      where: { id: convId },
      data:  isA ? { unreadA: 0 } : { unreadB: 0 }
    });

    // Notify sender that messages were read
    if (updated.count > 0) {
      const otherId = isA ? conv.userBId : conv.userAId;
      const io = getIo();
      if (io) {
        io.to(`user:${otherId}`).emit('dm:read', { convId, readBy: meId, readAt: now });
      }
    }

    return successResponse(res, { markedRead: updated.count });
  } catch (err) { next(err); }
}

// ─── DELETE /dm/messages/:msgId ───────────────────────────────────────────────
async function deleteMessage(req, res, next) {
  try {
    const meId  = req.user.id;
    const msgId = req.params.msgId;

    const msg = await prisma.directMessage.findUnique({ where: { id: msgId } });
    if (!msg) return errorResponse(res, 'Message not found', 404);
    if (msg.senderId !== meId && msg.receiverId !== meId) {
      return errorResponse(res, 'Not authorized', 403);
    }

    // Soft delete — only hide for this user
    await prisma.directMessage.update({
      where: { id: msgId },
      data:  msg.senderId === meId
        ? { deletedBySender: true }
        : { deletedByReceiver: true }
    });

    return successResponse(res, null, 'Message deleted');
  } catch (err) { next(err); }
}

// ─── GET /dm/unread-count ─────────────────────────────────────────────────────
async function getUnreadCount(req, res, next) {
  try {
    const meId = req.user.id;

    const convs = await prisma.dmConversation.findMany({
      where: { OR: [{ userAId: meId }, { userBId: meId }] },
      select: { userAId: true, unreadA: true, unreadB: true }
    });

    const total = convs.reduce((sum, c) => {
      return sum + (c.userAId === meId ? c.unreadA : c.unreadB);
    }, 0);

    return successResponse(res, { total });
  } catch (err) { next(err); }
}

module.exports = {
  getConversations, getOrStartConversation,
  getMessages, sendMessage, markRead, deleteMessage, getUnreadCount
};
