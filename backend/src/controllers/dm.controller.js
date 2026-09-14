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
const { sendPush } = require('../utils/push');

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

/** Check if two users are friends OR share a school via SchoolMembership (teachers ↔ students) */
async function areFriends(userA, userB) {
  if (ALLOW_NON_FRIENDS) return true;

  // SOC-P1-02 FIX: Use SchoolMembership.role for school-staff DM bypass.
  // The previous code checked User.role for TEACHER/SCHOOL_ADMIN/SUPER_ADMIN,
  // but the current dual-domain architecture stores Education roles exclusively
  // in SchoolMembership.role — User.role only holds MEMBER or SUPER_ADMIN.
  // A user invited as TEACHER has User.role = MEMBER (unchanged) but
  // SchoolMembership.role = TEACHER, so the old User.role check failed for them.
  // SUPER_ADMIN (platform admin) uses User.role = SUPER_ADMIN — kept as-is.
  const [uA, uB] = await Promise.all([
    prisma.user.findUnique({ where: { id: userA }, select: { role: true } }),
    prisma.user.findUnique({ where: { id: userB }, select: { role: true } }),
  ]);

  // ARCHITECTURE FIX (HALQA-ARCH-01):
  // SUPER_ADMIN is a platform-management role, NOT a social identity.
  // Platform admins must NOT have unrestricted DM access to all users.
  // A SUPER_ADMIN who needs to contact a user should use the announcement
  // system or a support channel — not the private DM system.
  //
  // If internal staff need to DM users, they should use their personal MEMBER
  // account (separate from their admin identity) which follows normal social rules.
  //
  // REMOVED: if (uA?.role === 'SUPER_ADMIN' || uB?.role === 'SUPER_ADMIN') return true

  // School-staff bypass via SchoolMembership: check if either user holds a staff
  // role (TEACHER or SCHOOL_ADMIN) in a school that both users share.
  // Both must belong to the same school with ACTIVE status.
  const staffMembershipRoles = ['TEACHER', 'SCHOOL_ADMIN'];
  const sharedStaffAccess = await prisma.schoolMembership.findFirst({
    where: {
      userId:   userA,
      status:   'ACTIVE',
      role:     { in: staffMembershipRoles },
      school: {
        memberships: {
          some: {
            userId: userB,
            status: 'ACTIVE',
          }
        }
      }
    },
    select: { id: true },
  }).catch(() => null);

  // Also check the reverse — userB might be the staff member
  const sharedStaffAccessReverse = sharedStaffAccess ? null : await prisma.schoolMembership.findFirst({
    where: {
      userId:   userB,
      status:   'ACTIVE',
      role:     { in: staffMembershipRoles },
      school: {
        memberships: {
          some: {
            userId: userA,
            status: 'ACTIVE',
          }
        }
      }
    },
    select: { id: true },
  }).catch(() => null);

  if (sharedStaffAccess || sharedStaffAccessReverse) return true;

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

    // Block check — cannot start/view a conversation with a blocked user
    try {
      const blockRecord = await prisma.userBlock.findFirst({
        where: {
          OR: [
            { blockerId: otherId, blockedId: meId },
            { blockerId: meId, blockedId: otherId },
          ]
        }
      });
      if (blockRecord) return errorResponse(res, 'Cannot message this user', 403);
    } catch (_) { /* userBlock table may not exist — fail open */ }

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
      OR: [
        { senderId: meId,   deletedBySender:   false },
        { receiverId: meId, deletedByReceiver: false },
      ],
      ...(before && { createdAt: { lt: new Date(before) } })
    };

    const messages = await prisma.directMessage.findMany({
      where,
      include: {
        sender:    { select: USER_SELECT },
        replyTo:   { include: { sender: { select: USER_SELECT } } },
        reactions: { include: { user: { select: USER_SELECT } } },
      },
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
      const io = getIo();
      if (io) {
        const senderId = undelivered[0].senderId;
        // BUG-2 FIX: Include delivery timestamp so clients can store deliveredAt
        io.to(`user:${senderId}`).emit('dm:delivered', { convId, messageIds: ids, at: new Date().toISOString() });
      }
    }

    // Phase 5: batch-enrich VOICE_ROOM_SHARE messages with authoritative VoiceRoom data.
    // One query for all referenced rooms — no N+1 per message.
    const shareMessages = messages.filter(
      m => m.msgType === 'VOICE_ROOM_SHARE' && m.refEntityId
    );
    let voiceRoomMap = {};
    if (shareMessages.length > 0) {
      const roomIds = [...new Set(shareMessages.map(m => m.refEntityId))];
      const rooms = await prisma.voiceRoom.findMany({
        where: { id: { in: roomIds } },
        select: {
          id: true, title: true, coverEmoji: true, coverImageUrl: true,
          privacy: true, status: true, hostId: true, maxSpeakers: true,
        },
      });
      voiceRoomMap = Object.fromEntries(rooms.map(r => [r.id, r]));
    }

    // Attach voiceRoomData to each share message (null if room is unavailable — safe fallback)
    const enriched = messages.map(m => {
      if (m.msgType === 'VOICE_ROOM_SHARE' && m.refEntityId) {
        return { ...m, voiceRoomData: voiceRoomMap[m.refEntityId] ?? null };
      }
      return m;
    });

    return successResponse(res, enriched.reverse());
  } catch (err) { next(err); }
}

// ─── POST /dm/conversations/:convId/messages ──────────────────────────────────
async function sendMessage(req, res, next) {
  try {
    const meId   = req.user.id;
    const convId = req.params.convId;
    const {
      body, storyId, replyToId,
      // Phase 4 media fields
      msgType = 'TEXT',
      mediaUrl, mimeType, fileSize, fileName, duration, width, height, thumbnail,
      // Phase 5: structured entity reference (VOICE_ROOM_SHARE)
      refEntityType, refEntityId,
    } = req.body;

    // Enforce allowed message types (includes VOICE_ROOM_SHARE added in Phase 5)
    const ALLOWED_TYPES = ['TEXT', 'IMAGE', 'VIDEO', 'GIF', 'VOICE', 'AUDIO', 'FILE', 'VOICE_ROOM_SHARE'];
    if (!ALLOWED_TYPES.includes(msgType)) {
      return errorResponse(res, `Invalid msgType. Allowed: ${ALLOWED_TYPES.join(', ')}`, 400);
    }

    // ── VOICE_ROOM_SHARE: structured reference validation ─────────────────────
    // Phase 5: when sharing a Voice Club room to DM, only the roomId is trusted.
    // The client must supply refEntityType = "VoiceRoom" and a non-empty refEntityId.
    // Title, host, participant count, privacy, status — all come from the DB, never the client.
    if (msgType === 'VOICE_ROOM_SHARE') {
      if (!refEntityId || !refEntityId.trim()) {
        return errorResponse(res, 'refEntityId is required for VOICE_ROOM_SHARE messages', 400);
      }
      if (refEntityType !== 'VoiceRoom') {
        return errorResponse(res, 'refEntityType must be "VoiceRoom" for VOICE_ROOM_SHARE messages', 400);
      }
      // Verify the VoiceRoom exists and is not soft-deleted
      const voiceRoom = await prisma.voiceRoom.findUnique({
        where: { id: refEntityId.trim() },
        select: { id: true, deletedAt: true },
      });
      if (!voiceRoom || voiceRoom.deletedAt) {
        return errorResponse(res, 'Voice Club room not found', 404);
      }
      // body is optional for VOICE_ROOM_SHARE (the room card is the content)
    } else {
      // Non-share types: existing validation unchanged
      const isMediaMsg = msgType !== 'TEXT';
      if (!isMediaMsg && !body?.trim()) {
        return errorResponse(res, 'Message body required', 400);
      }
      if (isMediaMsg && !mediaUrl) {
        return errorResponse(res, 'mediaUrl required for media messages', 400);
      }
    }

    // Body length limit
    if (body && body.trim().length > 5000) {
      return errorResponse(res, 'Message too long (max 5000 chars)', 400);
    }

    const conv = await prisma.dmConversation.findUnique({ where: { id: convId } });
    if (!conv || (conv.userAId !== meId && conv.userBId !== meId)) {
      return errorResponse(res, 'Conversation not found', 404);
    }

    const receiverId = conv.userAId === meId ? conv.userBId : conv.userAId;

    // Block check: if receiver has blocked sender (or vice versa), reject
    let isBlocked = false;
    try {
      const blockRecord = await prisma.userBlock.findFirst({
        where: {
          OR: [
            { blockerId: receiverId, blockedId: meId },
            { blockerId: meId, blockedId: receiverId },
          ]
        }
      });
      isBlocked = !!blockRecord;
    } catch (_) { /* userBlock table may not exist — fail open */ }
    if (isBlocked) return errorResponse(res, 'Cannot send messages to this user', 403);

    // Friends-only check
    if (!await areFriends(meId, receiverId)) {
      return errorResponse(res, 'You can only message friends', 403);
    }

    // Validate replyToId belongs to this conversation
    if (replyToId) {
      const replyMsg = await prisma.directMessage.findUnique({ where: { id: replyToId } });
      if (!replyMsg || replyMsg.conversationId !== convId) {
        return errorResponse(res, 'Invalid replyToId', 400);
      }
    }

    const message = await prisma.directMessage.create({
      data: {
        id:             uuidv4(),
        conversationId: convId,
        senderId:       meId,
        receiverId,
        body:           body ? body.trim() : null,
        msgType,
        mediaUrl:       mediaUrl || null,
        mimeType:       mimeType || null,
        fileSize:       fileSize ? parseInt(fileSize) : null,
        fileName:       fileName || null,
        duration:       duration ? parseInt(duration) : null,
        width:          width    ? parseInt(width)    : null,
        height:         height   ? parseInt(height)   : null,
        thumbnail:      thumbnail || null,
        // Phase 5: store the entity reference (null for all non-share types)
        refEntityType:  msgType === 'VOICE_ROOM_SHARE' ? 'VoiceRoom' : null,
        refEntityId:    msgType === 'VOICE_ROOM_SHARE' ? refEntityId.trim() : null,
        status:         'SENT',
        storyId:        storyId || null,
        replyToId:      replyToId || null,
      },
      include: {
        sender:    { select: USER_SELECT },
        replyTo:   { include: { sender: { select: USER_SELECT } } },
        reactions: true,
        story:     storyId ? { select: { id: true, type: true, mediaUrl: true, text: true, thumbnail: true, authorId: true } } : false,
      }
    });

    // Phase 5: attach authoritative VoiceRoom data for VOICE_ROOM_SHARE messages
    let fullMessage = { ...message };
    if (msgType === 'VOICE_ROOM_SHARE' && message.refEntityId) {
      const roomData = await prisma.voiceRoom.findUnique({
        where: { id: message.refEntityId },
        select: {
          id: true, title: true, coverEmoji: true, coverImageUrl: true,
          privacy: true, status: true, hostId: true, maxSpeakers: true,
        },
      });
      fullMessage.voiceRoomData = roomData ?? null;
    }

    // Update conversation snapshot
    const mediaPreview = {
      IMAGE: '📷 Photo', VIDEO: '🎥 Video', GIF: '🎞️ GIF',
      VOICE: '🎤 Voice message', AUDIO: '🎵 Audio', FILE: '📎 File',
      // Phase 5: stable generic preview — never stores room title
      VOICE_ROOM_SHARE: '🎙️ Voice Club',
    };
    const lastMessageText = body ? body.trim().slice(0, 100) : (mediaPreview[msgType] ?? '📎 Media');
    const isA = conv.userAId === meId;
    await prisma.dmConversation.update({
      where: { id: convId },
      data: {
        lastMessage:   lastMessageText,
        lastMessageAt: message.createdAt,
        lastSenderId:  meId,
        ...(isA ? { unreadB: { increment: 1 } } : { unreadA: { increment: 1 } })
      }
    });

    // Emit to receiver via existing dm:message event (no new Socket.IO events)
    const io = getIo();
    if (io) {
      // Serialize createdAt to ISO string so clients always receive a string (not a Date object)
      const msgPayload = {
        ...fullMessage,
        createdAt: fullMessage.createdAt instanceof Date
          ? fullMessage.createdAt.toISOString()
          : fullMessage.createdAt,
        sender: { id: meId, firstName: req.user.firstName, lastName: req.user.lastName, avatarUrl: req.user.avatarUrl }
      };
      io.to(`user:${receiverId}`).emit('dm:message', { convId, message: msgPayload });

      const receiverSockets = await io.in(`user:${receiverId}`).fetchSockets();
      if (receiverSockets.length > 0) {
        await prisma.directMessage.update({
          where: { id: message.id },
          data:  { status: 'DELIVERED', deliveredAt: new Date() }
        });
        io.to(`user:${meId}`).emit('dm:delivered', { convId, messageIds: [message.id], at: new Date().toISOString() });
      } else {
        // Receiver is offline — send FCM push notification
        try {
          const receiver = await prisma.user.findUnique({
            where: { id: receiverId },
            select: { fcmToken: true, firstName: true, lastName: true }
          });
          if (receiver?.fcmToken) {
            const senderName = `${req.user.firstName} ${req.user.lastName}`.trim();
            const mediaPreviewMap = {
              IMAGE: '📷 Photo', VIDEO: '🎥 Video', GIF: '🎞️ GIF',
              VOICE: '🎤 Voice message', AUDIO: '🎵 Audio', FILE: '📎 File',
              VOICE_ROOM_SHARE: '🎙️ Voice Club',
            };
            const msgPreview = body
              ? (body.trim().length > 80 ? body.trim().slice(0, 80) + '…' : body.trim())
              : (mediaPreviewMap[msgType] ?? '📎 Media');
            await sendPush(receiver.fcmToken, {
              title: senderName,
              body:  msgPreview,
              type:  'DM',
              data:  { convId, messageId: message.id, senderId: meId },
            });
          }
        } catch (_) { /* push is non-fatal */ }
      }
    }

    return successResponse(res, fullMessage, 'Message sent', 201);
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

    // Delete policy:
    // - Sender deletes own message → "delete for everyone": hidden from BOTH sender and receiver
    // - Receiver deletes a received message → "delete for me only": hidden only from receiver
    const updateData = msg.senderId === meId
      ? { deletedBySender: true, deletedByReceiver: true }  // sender: delete for everyone
      : { deletedByReceiver: true };                         // receiver: delete for me only

    await prisma.directMessage.update({
      where: { id: msgId },
      data: updateData,
    });

    // Emit real-time delete event so all participants' UIs update immediately
    const io = getIo();
    if (io) {
      // Notify the other participant's room
      const otherId = msg.senderId === meId ? msg.receiverId : msg.senderId;
      io.to(`user:${otherId}`).emit('dm:message_deleted', {
        convId: msg.conversationId,
        messageId: msgId,
        deletedBy: meId,
        // If sender deleted, other side should also remove it (delete for everyone)
        forEveryone: msg.senderId === meId,
      });
      // Also notify the deleter's own other sessions (multi-device)
      io.to(`user:${meId}`).emit('dm:message_deleted', {
        convId: msg.conversationId,
        messageId: msgId,
        deletedBy: meId,
        forEveryone: msg.senderId === meId,
      });
    }

    return successResponse(res, null, 'Message deleted');
  } catch (err) { next(err); }
}

// ─── PATCH /dm/messages/:msgId ───────────────────────────────────────────────
// CHAT-GAP-002 FIX: DM message editing.
// Only the sender can edit their own messages.
// Edits are time-limited: messages older than 15 minutes cannot be edited.
// An edited flag + editedAt timestamp is recorded for transparency.
async function editMessage(req, res, next) {
  try {
    const meId  = req.user.id;
    const msgId = req.params.msgId;
    const { body } = req.body;

    if (!body?.trim()) return errorResponse(res, 'Message body required', 400);
    if (body.trim().length > 5000) return errorResponse(res, 'Message too long (max 5000 chars)', 400);

    const msg = await prisma.directMessage.findUnique({ where: { id: msgId } });
    if (!msg) return errorResponse(res, 'Message not found', 404);

    // Only sender can edit
    if (msg.senderId !== meId) {
      return errorResponse(res, 'You can only edit your own messages', 403);
    }

    // Cannot edit deleted messages
    if (msg.deletedBySender) {
      return errorResponse(res, 'Cannot edit a deleted message', 400);
    }

    // 15-minute edit window
    const EDIT_WINDOW_MS = 15 * 60 * 1000;
    if (Date.now() - new Date(msg.createdAt).getTime() > EDIT_WINDOW_MS) {
      return errorResponse(res, 'Messages can only be edited within 15 minutes of sending', 400);
    }

    const updated = await prisma.directMessage.update({
      where: { id: msgId },
      data:  {
        body:     body.trim(),
        isEdited: true,
        editedAt: new Date(),
      },
      include: { sender: { select: USER_SELECT } }
    });

    // Notify receiver via socket so their UI updates in real-time
    const io = getIo();
    if (io) {
      io.to(`user:${msg.receiverId}`).emit('dm:message_edited', {
        convId:    msg.conversationId,
        messageId: msgId,
        newBody:   body.trim(),
        editedAt:  updated.editedAt,
      });
    }

    return successResponse(res, updated, 'Message edited');
  } catch (err) { next(err); }
}
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

// ─── POST /dm/messages/:msgId/reactions ──────────────────────────────────────
// Toggle emoji reaction on a DM message. If already reacted with same emoji, remove it.
async function reactToMessage(req, res, next) {
  try {
    const meId  = req.user.id;
    const msgId = req.params.msgId;
    const { emoji } = req.body;

    if (!emoji) return errorResponse(res, 'Emoji required', 400);

    const msg = await prisma.directMessage.findUnique({ where: { id: msgId } });
    if (!msg) return errorResponse(res, 'Message not found', 404);

    // Only conversation participants can react
    const conv = await prisma.dmConversation.findUnique({ where: { id: msg.conversationId } });
    if (!conv || (conv.userAId !== meId && conv.userBId !== meId)) {
      return errorResponse(res, 'Not authorized', 403);
    }

    let existing = null;
    let reaction = null;
    let action   = 'added';

    try {
      existing = await prisma.dmReaction.findUnique({
        where: { messageId_userId_emoji: { messageId: msgId, userId: meId, emoji } }
      });

      if (existing) {
        action = 'removed';
        await prisma.dmReaction.delete({ where: { id: existing.id } });
      } else {
        reaction = await prisma.dmReaction.create({
          data: { id: uuidv4(), messageId: msgId, userId: meId, emoji },
          include: { user: { select: USER_SELECT } }
        });
      }
    } catch (dbErr) {
      // dm_reactions table doesn't exist yet — run: npx prisma migrate deploy
      return errorResponse(res, 'Reactions not available yet. Run: npx prisma migrate deploy', 503);
    }

    // Emit to both participants
    const io = getIo();
    if (io) {
      const otherId = conv.userAId === meId ? conv.userBId : conv.userAId;
      const payload = { convId: msg.conversationId, messageId: msgId, emoji, userId: meId, action, reaction };
      io.to(`user:${meId}`).emit('dm:reaction', payload);
      io.to(`user:${otherId}`).emit('dm:reaction', payload);
    }

    return successResponse(res, reaction, existing ? 'Reaction removed' : 'Reaction added');
  } catch (err) { next(err); }
}

// ─── GET /dm/conversations/:convId/search ─────────────────────────────────────
// Search messages within a conversation by text query.
async function searchMessages(req, res, next) {
  try {
    const meId   = req.user.id;
    const convId = req.params.convId;
    const { q, limit = 20 } = req.query;

    if (!q || q.trim().length < 1) return errorResponse(res, 'Query required', 400);

    const conv = await prisma.dmConversation.findUnique({ where: { id: convId } });
    if (!conv || (conv.userAId !== meId && conv.userBId !== meId)) {
      return errorResponse(res, 'Conversation not found', 404);
    }

    const messages = await prisma.directMessage.findMany({
      where: {
        conversationId: convId,
        body: { contains: q.trim() },
        OR: [
          { senderId: meId,   deletedBySender:   false },
          { receiverId: meId, deletedByReceiver: false },
        ],
      },
      include: { sender: { select: USER_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit), 50),
    });

    return successResponse(res, messages);
  } catch (err) { next(err); }
}

module.exports = {
  getConversations, getOrStartConversation,
  getMessages, sendMessage, markRead, deleteMessage, editMessage,
  reactToMessage, searchMessages, getUnreadCount
};

