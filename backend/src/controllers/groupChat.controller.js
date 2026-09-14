/**
 * Group Chat Controller
 * 
 * Handles group conversation management including:
 * - Creating and managing group conversations
 * - Managing group members
 * - Sending and receiving messages
 * - Message reactions and read receipts
 * - Delete message (soft delete per user)
 * - Pin / unpin message
 */

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');
const { getIo } = require('../sockets');
const { sendPushMulti } = require('../utils/push');

/**
 * Create a new group conversation
 */
async function createGroupConversation(req, res) {
  try {
    const { schoolId, classId, name, description, privacy, maxMembers, avatarUrl } = req.body;
    const userId = req.user.id;

    // SUPER_ADMIN is a platform administrator — they cannot create group chats.
    // Group chats are a social/community feature for regular users.
    if (req.user.role === 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        error: { code: 'AUTH_001', message: 'Platform administrators cannot create group chats', statusCode: 403 }
      });
    }

    const conversation = await prisma.$transaction(async (tx) => {
      const conv = await tx.groupConversation.create({
        data: {
          schoolId,
          classId,
          name,
          description,
          privacy: privacy || 'PRIVATE',
          maxMembers: maxMembers || 100,
          avatarUrl,
          createdBy: userId,
          memberCount: 1,
          messageCount: 0
        }
      });

      // Add creator as owner
      await tx.groupMember.create({
        data: {
          conversationId: conv.id,
          userId,
          role: 'OWNER',
          joinedAt: new Date()
        }
      });

      return conv;
    });

    // Fetch with members for response
    const conversationWithMembers = await prisma.groupConversation.findUnique({
      where: { id: conversation.id },
      include: {
        members: {
          where: { leftAt: null },
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
        }
      }
    });

    logger.info(`Group conversation created: ${conversation.id} by user ${userId}`);
    
    res.status(201).json({
      success: true,
      data: conversationWithMembers
    });
  } catch (error) {
    logger.error('Failed to create group conversation:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to create group conversation',
        statusCode: 500
      })
    });
  }
}

/**
 * Get group conversations for a user
 */
async function getUserGroupConversations(req, res) {
  try {
    const userId = req.user.id;
    const { schoolId, classId } = req.query;

    const memberships = await prisma.groupMember.findMany({
      where: {
        userId,
        leftAt: null
      },
      include: {
        conversation: {
          include: {
            members: {
              where: { leftAt: null },
              include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
            }
          }
        }
      }
    });

    let conversations = memberships.map(m => m.conversation);

    // BUG-2 FIX: Exclude soft-deleted groups (deleteGroupConversation sets deletedAt).
    conversations = conversations.filter(c => !c.deletedAt);

    // Filter by school/class if specified
    if (schoolId) {
      conversations = conversations.filter(c => c.schoolId === schoolId);
    }
    if (classId) {
      conversations = conversations.filter(c => c.classId === classId);
    }

    res.json({
      success: true,
      data: conversations
    });
  } catch (error) {
    logger.error('Failed to get user group conversations:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get conversations',
        statusCode: 500
      })
    });
  }
}

/**
 * Get a specific group conversation
 */
async function getGroupConversation(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const conversation = await prisma.groupConversation.findUnique({
      where: { id },
      include: {
        members: {
          where: { leftAt: null },
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
            replyTo: {
              include: { sender: { select: { id: true, firstName: true, lastName: true } } }
            }
          }
        }
      }
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Conversation not found',
          statusCode: 404
        })
      });
    }

    // BUG-3 FIX: Return 410 for soft-deleted groups instead of serving their data.
    if (conversation.deletedAt) {
      return res.status(410).json({
        success: false,
        error: { code: 'GONE_001', message: 'This group has been deleted', statusCode: 410 }
      });
    }

    // Check if user is a member
    const isMember = conversation.members.some(m => m.userId === userId);

    // SUPER_ADMIN cannot read private group conversations they are not a member of.
    // They are a platform administrator, not a social user.
    if (req.user.role === 'SUPER_ADMIN' && !isMember) {
      return res.status(403).json({
        success: false,
        error: { code: 'AUTH_001', message: 'Platform administrators cannot access private group conversations', statusCode: 403 }
      });
    }

    if (!isMember && conversation.privacy !== 'PUBLIC') {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not authorized to view this conversation',
          statusCode: 403
        })
      });
    }

    res.json({
      success: true,
      data: conversation
    });
  } catch (error) {
    logger.error('Failed to get group conversation:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get conversation',
        statusCode: 500
      })
    });
  }
}

/**
 * Add a member to a group conversation
 */
async function addGroupMember(req, res) {
  try {
    const { conversationId } = req.params;
    const { userId, role } = req.body;
    const currentUserId = req.user.id;

    // Check if current user is admin/owner
    const currentMember = await prisma.groupMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId: currentUserId
        }
      }
    });

    if (!currentMember || (currentMember.role !== 'OWNER' && currentMember.role !== 'ADMIN')) {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not authorized to add members',
          statusCode: 403
        })
      });
    }

    // Check if user is already a member
    const existingMember = await prisma.groupMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId
        }
      }
    });

    if (existingMember && existingMember.leftAt) {
      // Re-add user who left
      await prisma.groupMember.update({
        where: { id: existingMember.id },
        data: {
          leftAt: null,
          joinedAt: new Date()
        }
      });
    } else if (existingMember && !existingMember.leftAt) {
      // Already an active member — return a clear error instead of silently doing nothing
      return res.status(409).json({
        success: false,
        error: {
          code: 'CONFLICT_001',
          message: 'User is already a member of this group',
          statusCode: 409
        }
      });
    } else {
      // Add new member
      await prisma.groupMember.create({
        data: {
          conversationId,
          userId,
          role: role || 'MEMBER',
          joinedAt: new Date()
        }
      });
    }

    // Update member count
    const memberCount = await prisma.groupMember.count({
      where: { conversationId, leftAt: null }
    });

    await prisma.groupConversation.update({
      where: { id: conversationId },
      data: { memberCount }
    });

    logger.info(`User ${userId} added to conversation ${conversationId}`);

    // BUG-9 FIX: Notify room members that someone was added.
    if (getIo()) {
      getIo().to(`conversation:${conversationId}`).emit('group:member_added', {
        conversationId, userId, addedBy: currentUserId, memberCount
      });
    }

    res.json({
      success: true,
      message: 'Member added successfully'
    });
  } catch (error) {
    logger.error('Failed to add group member:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to add member',
        statusCode: 500
      })
    });
  }
}

/**
 * Remove a member from a group conversation
 */
async function removeGroupMember(req, res) {
  try {
    const { conversationId, userId } = req.params;
    const currentUserId = req.user.id;

    // Check if current user is admin/owner or removing themselves
    const currentMember = await prisma.groupMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId: currentUserId
        }
      }
    });

    if (!currentMember) {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not authorized',
          statusCode: 403
        })
      });
    }

    const isSelf = currentUserId === userId;
    const isAdmin = currentMember.role === 'OWNER' || currentMember.role === 'ADMIN';

    if (!isSelf && !isAdmin) {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not authorized to remove members',
          statusCode: 403
        })
      });
    }

    await prisma.groupMember.updateMany({
      where: {
        conversationId,
        userId,
        leftAt: null
      },
      data: {
        leftAt: new Date()
      }
    });

    // Update member count
    const memberCount = await prisma.groupMember.count({
      where: { conversationId, leftAt: null }
    });

    await prisma.groupConversation.update({
      where: { id: conversationId },
      data: { memberCount }
    });

    logger.info(`User ${userId} removed from conversation ${conversationId}`);

    // BUG-9 FIX: Notify room members that someone was removed.
    if (getIo()) {
      getIo().to(`conversation:${conversationId}`).emit('group:member_removed', {
        conversationId, userId, removedBy: currentUserId, memberCount
      });
    }

    res.json({
      success: true,
      message: 'Member removed successfully'
    });
  } catch (error) {
    logger.error('Failed to remove group member:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to remove member',
        statusCode: 500
      })
    });
  }
}

/**
 * Send a message to a group conversation
 */
async function sendGroupMessage(req, res) {
  try {
    const { conversationId } = req.params;
    const { type, body, mediaUrl, mimeType, fileSize, fileName, duration, replyToId,
      // Phase 5: structured entity reference (VOICE_ROOM_SHARE)
      refEntityType, refEntityId,
    } = req.body;
    const userId = req.user.id;

    // Check if user is a member
    const member = await prisma.groupMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId
        }
      }
    });

    if (!member || member.leftAt) {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not a member of this conversation',
          statusCode: 403
        })
      });
    }

    // Enforce group permissions
    const conversation = await prisma.groupConversation.findUnique({
      where: { id: conversationId },
      select: { onlyAdminsCanSendMessages: true, onlyAdminsCanSendMedia: true }
    });
    const isAdminOrOwner = member.role === 'OWNER' || member.role === 'ADMIN';
    const msgType = type || 'TEXT';

    // onlyAdminsCanSendMessages applies to ALL message types including VOICE_ROOM_SHARE
    if (conversation?.onlyAdminsCanSendMessages && !isAdminOrOwner) {
      return res.status(403).json({ success: false, error: { code: 'AUTH_001', message: 'Only admins can send messages in this group', statusCode: 403 } });
    }

    // onlyAdminsCanSendMedia applies to binary media (IMAGE/VIDEO/GIF/AUDIO/VOICE/FILE/DOCUMENT).
    // Phase 5: VOICE_ROOM_SHARE is a structured entity reference, NOT binary media —
    // it must NOT be blocked by the media-only permission gate.
    const isMedia = msgType !== 'TEXT' && msgType !== 'VOICE_ROOM_SHARE';
    if (isMedia && conversation?.onlyAdminsCanSendMedia && !isAdminOrOwner) {
      return res.status(403).json({ success: false, error: { code: 'AUTH_001', message: 'Only admins can send media in this group', statusCode: 403 } });
    }

    // ── VOICE_ROOM_SHARE: structured reference validation ─────────────────────
    // Phase 5: client supplies only the roomId. Title, host, privacy, status — all from DB.
    if (msgType === 'VOICE_ROOM_SHARE') {
      if (!refEntityId || !refEntityId.trim()) {
        return res.status(400).json({ success: false, error: { code: 'VAL_001', message: 'refEntityId is required for VOICE_ROOM_SHARE messages', statusCode: 400 } });
      }
      if (refEntityType !== 'VoiceRoom') {
        return res.status(400).json({ success: false, error: { code: 'VAL_001', message: 'refEntityType must be "VoiceRoom" for VOICE_ROOM_SHARE messages', statusCode: 400 } });
      }
      // Verify the VoiceRoom exists and is not soft-deleted
      const voiceRoom = await prisma.voiceRoom.findUnique({
        where: { id: refEntityId.trim() },
        select: { id: true, deletedAt: true },
      });
      if (!voiceRoom || voiceRoom.deletedAt) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND_001', message: 'Voice Club room not found', statusCode: 404 } });
      }
      // body is optional for VOICE_ROOM_SHARE (the room card is the content)
    }

    const message = await prisma.groupMessage.create({
      data: {
        conversationId,
        senderId: userId,
        type: msgType,
        body: body || null,
        mediaUrl:  mediaUrl  || null,
        mimeType:  mimeType  || null,
        fileSize:  fileSize  ? parseInt(fileSize)  : null,
        fileName:  fileName  || null,
        duration:  duration  ? parseInt(duration)  : null,
        replyToId: replyToId || null,
        // Phase 5: store entity reference (null for all non-share types)
        refEntityType: msgType === 'VOICE_ROOM_SHARE' ? 'VoiceRoom' : null,
        refEntityId:   msgType === 'VOICE_ROOM_SHARE' ? refEntityId.trim() : null,
      },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        replyTo: {
          include: { sender: { select: { id: true, firstName: true, lastName: true } } }
        }
      }
    });

    // Phase 5: attach authoritative VoiceRoom data for VOICE_ROOM_SHARE messages
    let responseMessage = { ...message };
    if (msgType === 'VOICE_ROOM_SHARE' && message.refEntityId) {
      const roomData = await prisma.voiceRoom.findUnique({
        where: { id: message.refEntityId },
        select: {
          id: true, title: true, coverEmoji: true, coverImageUrl: true,
          privacy: true, status: true, hostId: true, maxSpeakers: true,
        },
      });
      responseMessage.voiceRoomData = roomData ?? null;
    }

    // Update message count
    const messageCount = await prisma.groupMessage.count({
      where: { conversationId }
    });

    const mediaPreview = { IMAGE: '📷 Photo', VIDEO: '🎥 Video', GIF: '🎞️ GIF', VOICE: '🎤 Voice', AUDIO: '🎵 Audio', FILE: '📎 File', DOCUMENT: '📄 Document',
      // Phase 5: stable generic preview — never stores VoiceRoom title
      VOICE_ROOM_SHARE: '🎙️ Voice Club',
    };
    const lastMessageText = body ? body.slice(0, 100) : (mediaPreview[msgType] ?? '📎 Media');

    await prisma.groupConversation.update({
      where: { id: conversationId },
      data: {
        messageCount,
        lastMessage: lastMessageText,
        lastMessageAt: new Date()
      }
    });

    // Emit via existing group:message Socket.IO event (no new events)
    if (getIo()) {
      getIo().to(`conversation:${conversationId}`).emit('group:message', responseMessage);
    }

    // BUG-4 FIX: Increment unreadCount for all non-sender members (async, non-blocking).
    prisma.groupMember.updateMany({
      where: { conversationId, leftAt: null, userId: { not: userId } },
      data: { unreadCount: { increment: 1 } }
    }).catch(() => {});

    // Send push notifications to offline members (fire-and-forget, non-blocking)
    prisma.groupMember.findMany({
      where: { conversationId, leftAt: null, userId: { not: userId } },
      include: { user: { select: { id: true, fcmToken: true } } }
    }).then(async (members) => {
      if (!members.length) return;
      const senderName = `${responseMessage.sender.firstName} ${responseMessage.sender.lastName}`;
      const conv = await prisma.groupConversation.findUnique({
        where: { id: conversationId },
        select: { name: true }
      });
      const msgPreview = body ? (body.length > 80 ? body.slice(0, 80) + '…' : body) : '📎 Attachment';

      // In-app notifications for offline members
      await prisma.notification.createMany({
        data: members.map(m => ({
          userId:   m.user.id,
          type:     'MESSAGE',
          title:    `${senderName} in ${conv?.name || 'a group'}`,
          body:     msgPreview,
          data:     { groupConversationId: conversationId, messageId: responseMessage.id },
        })),
        skipDuplicates: true,
      });

      // FCM push for members who have a device token
      const fcmTokens = members
        .map(m => m.user.fcmToken)
        .filter(Boolean);
      if (fcmTokens.length > 0) {
        await sendPushMulti(fcmTokens, {
          title: `${senderName} in ${conv?.name || 'a group'}`,
          body:  msgPreview,
          type:  'GROUP_MESSAGE',
          data:  { groupConversationId: conversationId, messageId: responseMessage.id },
        });
      }
    }).catch(() => {}); // non-fatal

    logger.info(`Message sent to conversation ${conversationId} by user ${userId}`);

    res.status(201).json({
      success: true,
      data: responseMessage
    });
  } catch (error) {
    logger.error('Failed to send group message:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to send message',
        statusCode: 500
      })
    });
  }
}

/**
 * Get messages for a group conversation
 */
async function getGroupMessages(req, res) {
  try {
    const { conversationId } = req.params;
    const { limit = 50, before } = req.query;
    const userId = req.user.id;

    // Check if user is a member
    const member = await prisma.groupMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId
        }
      }
    });

    if (!member || member.leftAt) {
      // SUPER_ADMIN cannot read messages from groups they are not a member of
      if (req.user.role === 'SUPER_ADMIN') {
        return res.status(403).json({
          success: false,
          error: { code: 'AUTH_001', message: 'Platform administrators cannot read private group messages', statusCode: 403 }
        });
      }
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not a member of this conversation',
          statusCode: 403
        })
      });
    }

    const where = {
      conversationId,
      // Exclude hard-deleted messages (admin/owner hard-delete sets deletedAt)
      deletedAt: null,
    };
    if (before) {
      where.createdAt = { lt: new Date(before) };
    }

    let messages = await prisma.groupMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      include: {
        sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        replyTo: {
          include: { sender: { select: { id: true, firstName: true, lastName: true } } }
        },
        reactions: {
          include: { user: { select: { id: true, firstName: true, lastName: true } } }
        },
        // BUG-8 FIX: Include reads so the client can build readBy arrays for read receipts.
        reads: { select: { userId: true } }
      }
    });

    // Filter out messages soft-deleted by this user (deletedBy JSON array contains userId)
    messages = messages.filter(m => {
      if (!m.deletedBy) return true;
      const deletedBy = Array.isArray(m.deletedBy) ? m.deletedBy : [];
      return !deletedBy.includes(userId);
    });

    // Phase 5: batch-enrich VOICE_ROOM_SHARE messages with authoritative VoiceRoom data.
    // One query for all referenced rooms — no N+1 per message.
    const shareMessages = messages.filter(
      m => m.type === 'VOICE_ROOM_SHARE' && m.refEntityId
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

    // Attach voiceRoomData to each share message (null if room unavailable — safe fallback)
    const enriched = messages.map(m => {
      if (m.type === 'VOICE_ROOM_SHARE' && m.refEntityId) {
        return { ...m, voiceRoomData: voiceRoomMap[m.refEntityId] ?? null };
      }
      return m;
    });

    res.json({
      success: true,
      data: enriched.reverse()
    });
  } catch (error) {
    logger.error('Failed to get group messages:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get messages',
        statusCode: 500
      })
    });
  }
}

/**
 * Add or toggle a reaction on a group message.
 * - Same emoji from same user → removes it (toggle off)
 * - Different emoji or new reaction → upserts (replaces previous type)
 */
async function addMessageReaction(req, res) {
  try {
    const { messageId } = req.params;
    const { type } = req.body;
    const userId = req.user.id;

    const message = await prisma.groupMessage.findUnique({ where: { id: messageId } });
    if (!message) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND_001', message: 'Message not found', statusCode: 404 } });
    }

    const member = await prisma.groupMember.findUnique({
      where: { conversationId_userId: { conversationId: message.conversationId, userId } }
    });
    if (!member || member.leftAt) {
      return res.status(403).json({ success: false, error: { code: 'AUTH_001', message: 'Not a member', statusCode: 403 } });
    }

    // Check existing reaction by this user
    const existing = await prisma.groupMessageReaction.findUnique({
      where: { messageId_userId: { messageId, userId } }
    });

    let reaction = null;
    let action = 'added';

    if (existing && existing.type === type) {
      // Same emoji → toggle off (remove)
      await prisma.groupMessageReaction.delete({ where: { id: existing.id } });
      action = 'removed';
    } else {
      // New or different emoji → upsert
      reaction = await prisma.groupMessageReaction.upsert({
        where: { messageId_userId: { messageId, userId } },
        update: { type },
        create: { messageId, userId, type },
        include: { user: { select: { id: true, firstName: true, lastName: true } } }
      });
    }

    const io = getIo();
    if (io) {
      io.to(`conversation:${message.conversationId}`).emit('group:reaction', {
        messageId, conversationId: message.conversationId,
        reaction: reaction || { messageId, userId, type, removed: true },
        action,
      });
    }

    return res.json({ success: true, data: reaction });
  } catch (error) {
    logger.error('Failed to add/toggle message reaction:', error);
    return res.status(500).json({ success: false, error: { code: 'INT_001', message: 'Failed to toggle reaction', statusCode: 500 } });
  }
}

/**
 * Mark messages as read
 */
async function markMessagesAsRead(req, res) {
  try {
    const { conversationId } = req.params;
    const { messageIds } = req.body;
    const userId = req.user.id;

    // Check if user is a member
    const member = await prisma.groupMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId
        }
      }
    });

    if (!member || member.leftAt) {
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not a member of this conversation',
          statusCode: 403
        })
      });
    }

    // Mark messages as read
    const readAt = new Date();
    const reads = await Promise.all(
      messageIds.map(messageId =>
        prisma.groupMessageRead.upsert({
          where: {
            messageId_userId: {
              messageId,
              userId
            }
          },
          update: { readAt },
          create: { messageId, userId, readAt }
        })
      )
    );

    // Update member's last read at + reset unread count (BUG-4 FIX)
    await prisma.groupMember.update({
      where: { id: member.id },
      data: { lastReadAt: readAt, unreadCount: 0 }
    });

    // BUG-6 FIX: Emit socket event so other clients (mobile list badges) clear unread state.
    if (getIo()) {
      getIo().to(`conversation:${conversationId}`).emit('group:read', {
        conversationId, userId, messageIds
      });
    }

    res.json({
      success: true,
      data: reads
    });
  } catch (error) {
    logger.error('Failed to mark messages as read:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to mark messages as read',
        statusCode: 500
      })
    });
  }
}

/**
 * Delete a group message (soft-delete per user via deletedBy JSON array)
 * Admin/Owner can hard-delete any message; members can only hide for themselves.
 */
async function deleteGroupMessage(req, res) {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    const message = await prisma.groupMessage.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND_001', message: 'Message not found', statusCode: 404 }
      });
    }

    // Check membership
    const member = await prisma.groupMember.findUnique({
      where: { conversationId_userId: { conversationId: message.conversationId, userId } }
    });

    if (!member || member.leftAt) {
      return res.status(403).json({
        success: false,
        error: { code: 'AUTH_001', message: 'Not a member of this conversation', statusCode: 403 }
      });
    }

    const isAdminOrOwner = member.role === 'OWNER' || member.role === 'ADMIN';
    const isOwnMessage   = message.senderId === userId;

    if (!isOwnMessage && !isAdminOrOwner) {
      return res.status(403).json({
        success: false,
        error: { code: 'AUTH_001', message: 'Not authorized to delete this message', statusCode: 403 }
      });
    }

    // ADMIN cannot delete the OWNER's messages — only the OWNER themselves can
    if (!isOwnMessage && member.role === 'ADMIN') {
      // Check if the message sender is the group OWNER
      const senderMember = await prisma.groupMember.findFirst({
        where: { conversationId: message.conversationId, userId: message.senderId, leftAt: null }
      });
      if (senderMember?.role === 'OWNER') {
        return res.status(403).json({
          success: false,
          error: { code: 'AUTH_001', message: 'Admins cannot delete messages sent by the group owner', statusCode: 403 }
        });
      }
    }

    if (isAdminOrOwner && !isOwnMessage) {
      // Admin/Owner hard-deletes someone else's message
      const existing = Array.isArray(message.deletedBy) ? message.deletedBy : [];
      await prisma.groupMessage.update({
        where: { id: messageId },
        data: {
          deletedAt: new Date(),
          deletedBy: existing.includes(userId) ? existing : [...existing, userId]
        }
      });
    } else {
      // Own message deletion — hard-delete for everyone (deletedAt = now)
      // This is "delete for everyone" — the message is removed for all members
      await prisma.groupMessage.update({
        where: { id: messageId },
        data: {
          deletedAt: new Date(),
          deletedBy: [userId],
        }
      });
    }

    // Notify room members
    if (getIo()) {
      getIo().to(`conversation:${message.conversationId}`).emit('group:message_deleted', {
        messageId,
        conversationId: message.conversationId,
        deletedBy: userId
      });
    }

    logger.info(`Message ${messageId} deleted by user ${userId}`);
    res.json({ success: true, message: 'Message deleted' });
  } catch (error) {
    logger.error('Failed to delete group message:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INT_001', message: 'Failed to delete message', statusCode: 500 }
    });
  }
}

/**
 * Pin or unpin a message in a group conversation (admin/owner only)
 */
async function pinGroupMessage(req, res) {
  try {
    const { conversationId, messageId } = req.params;
    const { pin = true } = req.body; // true = pin, false = unpin
    const userId = req.user.id;

    const member = await prisma.groupMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } }
    });

    if (!member || member.leftAt) {
      return res.status(403).json({
        success: false,
        error: { code: 'AUTH_001', message: 'Not a member of this conversation', statusCode: 403 }
      });
    }

    if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: { code: 'AUTH_001', message: 'Only admins can pin messages', statusCode: 403 }
      });
    }

    const message = await prisma.groupMessage.findUnique({ where: { id: messageId } });
    if (!message || message.conversationId !== conversationId) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND_001', message: 'Message not found', statusCode: 404 }
      });
    }

    // Unpin any previously pinned message in this conversation first
    if (pin) {
      await prisma.groupMessage.updateMany({
        where: { conversationId, isPinned: true },
        data: { isPinned: false, pinnedAt: null, pinnedBy: null }
      });
    }

    // Set new pin state
    const updated = await prisma.groupMessage.update({
      where: { id: messageId },
      data: {
        isPinned: pin,
        pinnedAt: pin ? new Date() : null,
        pinnedBy: pin ? userId : null,
      }
    });

    // Notify room members
    if (getIo()) {
      getIo().to(`conversation:${conversationId}`).emit('group:message_pinned', {
        messageId,
        conversationId,
        pinnedBy: userId,
        pin,
      });
    }

    logger.info(`Message ${messageId} ${pin ? 'pinned' : 'unpinned'} by user ${userId}`);
    res.json({ success: true, data: updated, message: pin ? 'Message pinned' : 'Message unpinned' });
  } catch (error) {
    logger.error('Failed to pin group message:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INT_001', message: 'Failed to pin message', statusCode: 500 }
    });
  }
}

/**
 * Edit a group message — sender only, within 15 minutes.
 * PATCH /api/v1/group-chat/messages/:messageId
 */
async function editGroupMessage(req, res) {
  try {
    const { messageId } = req.params;
    const { body } = req.body;
    const userId = req.user.id;

    if (!body?.trim()) return res.status(400).json({ success: false, error: { code: 'VAL_001', message: 'Message body required', statusCode: 400 } });
    if (body.trim().length > 4000) return res.status(400).json({ success: false, error: { code: 'VAL_001', message: 'Message too long (max 4000 chars)', statusCode: 400 } });

    const message = await prisma.groupMessage.findUnique({ where: { id: messageId } });
    if (!message) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND_001', message: 'Message not found', statusCode: 404 } });
    if (message.senderId !== userId) return res.status(403).json({ success: false, error: { code: 'AUTH_001', message: 'Can only edit your own messages', statusCode: 403 } });
    if (message.deletedAt) return res.status(400).json({ success: false, error: { code: 'VAL_001', message: 'Cannot edit a deleted message', statusCode: 400 } });

    const EDIT_WINDOW_MS = 15 * 60 * 1000;
    if (Date.now() - new Date(message.createdAt).getTime() > EDIT_WINDOW_MS) {
      return res.status(400).json({ success: false, error: { code: 'VAL_001', message: 'Messages can only be edited within 15 minutes', statusCode: 400 } });
    }

    const updated = await prisma.groupMessage.update({
      where: { id: messageId },
      data: { body: body.trim() },
      include: { sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
    });

    const io = getIo();
    if (io) {
      io.to(`conversation:${message.conversationId}`).emit('group:message_edited', {
        messageId,
        conversationId: message.conversationId,
        newBody: body.trim(),
        editedBy: userId,
      });
    }

    logger.info(`Group message ${messageId} edited by ${userId}`);
    return res.json({ success: true, data: updated });
  } catch (error) {
    logger.error('Failed to edit group message:', error);
    return res.status(500).json({ success: false, error: { code: 'INT_001', message: 'Failed to edit message', statusCode: 500 } });
  }
}

/**
 * Search messages in a group conversation.
 * GET /api/v1/group-chat/conversations/:conversationId/search?q=...&limit=20
 */
async function searchGroupMessages(req, res) {
  try {
    const { conversationId } = req.params;
    const { q, limit = 20 } = req.query;
    const userId = req.user.id;

    if (!q?.trim()) return res.status(400).json({ success: false, error: { code: 'VAL_001', message: 'Query required', statusCode: 400 } });

    const member = await prisma.groupMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } }
    });
    if (!member || member.leftAt) {
      return res.status(403).json({ success: false, error: { code: 'AUTH_001', message: 'Not a member', statusCode: 403 } });
    }

    const messages = await prisma.groupMessage.findMany({
      where: {
        conversationId,
        body: { contains: q.trim() },
        deletedAt: null,
      },
      include: { sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit), 50),
    });

    return res.json({ success: true, data: messages });
  } catch (error) {
    logger.error('Failed to search group messages:', error);
    return res.status(500).json({ success: false, error: { code: 'INT_001', message: 'Failed to search messages', statusCode: 500 } });
  }
}

/**
 * Get unread count across all group conversations for current user.
 * GET /api/v1/group-chat/unread-count
 */
async function getGroupUnreadCount(req, res) {
  try {
    const userId = req.user.id;
    const memberships = await prisma.groupMember.findMany({
      where: { userId, leftAt: null },
      select: { unreadCount: true }
    });
    const total = memberships.reduce((sum, m) => sum + (m.unreadCount ?? 0), 0);
    return res.json({ success: true, data: { total } });
  } catch (error) {
    logger.error('Failed to get group unread count:', error);
    return res.status(500).json({ success: false, error: { code: 'INT_001', message: 'Failed to get unread count', statusCode: 500 } });
  }
}

/**
 * Update group conversation settings (owner/admin only)
 * PATCH /api/v1/group-chat/conversations/:id
 */
async function updateGroupConversation(req, res) {
  try {
    const { id } = req.params;
    const { name, description, privacy, avatarUrl, maxMembers } = req.body;
    const userId = req.user.id;

    const member = await prisma.groupMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId } }
    });
    if (!member || member.leftAt) {
      return res.status(403).json({ success: false, error: { code: 'AUTH_001', message: 'Not a member', statusCode: 403 } });
    }
    if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: { code: 'AUTH_001', message: 'Only owner or admin can update group settings', statusCode: 403 } });
    }

    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (description !== undefined) data.description = description.trim() || null;
    if (avatarUrl !== undefined) data.avatarUrl = avatarUrl || null;
    if (privacy !== undefined) data.privacy = privacy;
    if (maxMembers !== undefined) data.maxMembers = parseInt(maxMembers);

    const updated = await prisma.groupConversation.update({
      where: { id },
      data,
      include: {
        members: {
          where: { leftAt: null },
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
        }
      }
    });

    // Notify room members of settings change
    if (getIo()) {
      getIo().to(`conversation:${id}`).emit('group:settings_updated', {
        conversationId: id, updatedBy: userId, changes: data
      });
    }

    logger.info(`Group ${id} settings updated by user ${userId}`);
    return res.json({ success: true, data: updated });
  } catch (error) {
    logger.error('Failed to update group conversation:', error);
    return res.status(500).json({ success: false, error: { code: 'INT_001', message: 'Failed to update group', statusCode: 500 } });
  }
}

/**
 * Change a member's role (promote/demote). Owner only.
 * PATCH /api/v1/group-chat/conversations/:conversationId/members/:userId/role
 */
async function updateMemberRole(req, res) {
  try {
    const { conversationId, userId: targetUserId } = req.params;
    const { role } = req.body; // 'ADMIN' | 'MEMBER' | 'OWNER' (transfer ownership)
    const currentUserId = req.user.id;

    const currentMember = await prisma.groupMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: currentUserId } }
    });
    if (!currentMember || currentMember.leftAt || currentMember.role !== 'OWNER') {
      return res.status(403).json({ success: false, error: { code: 'AUTH_001', message: 'Only the group owner can change roles', statusCode: 403 } });
    }
    if (targetUserId === currentUserId) {
      return res.status(400).json({ success: false, error: { code: 'VAL_001', message: 'Cannot change your own role', statusCode: 400 } });
    }
    if (!['ADMIN', 'MEMBER', 'OWNER'].includes(role)) {
      return res.status(400).json({ success: false, error: { code: 'VAL_001', message: 'Role must be ADMIN, MEMBER, or OWNER', statusCode: 400 } });
    }

    const targetMember = await prisma.groupMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: targetUserId } }
    });
    if (!targetMember || targetMember.leftAt) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND_001', message: 'Member not found', statusCode: 404 } });
    }

    // Transfer ownership: new member becomes OWNER, current owner becomes ADMIN
    if (role === 'OWNER') {
      await prisma.$transaction([
        prisma.groupMember.update({
          where: { conversationId_userId: { conversationId, userId: targetUserId } },
          data: { role: 'OWNER' }
        }),
        prisma.groupMember.update({
          where: { conversationId_userId: { conversationId, userId: currentUserId } },
          data: { role: 'ADMIN' }
        }),
        // Update createdBy on conversation to reflect new owner
        prisma.groupConversation.update({
          where: { id: conversationId },
          data: { createdBy: targetUserId }
        })
      ]);

      if (getIo()) {
        getIo().to(`conversation:${conversationId}`).emit('group:ownership_transferred', {
          conversationId, newOwnerId: targetUserId, previousOwnerId: currentUserId
        });
      }
      logger.info(`Group ${conversationId} ownership transferred from ${currentUserId} to ${targetUserId}`);
      return res.json({ success: true, message: 'Ownership transferred successfully' });
    }

    // Regular role change (ADMIN ↔ MEMBER)
    if (targetMember.role === 'OWNER') {
      return res.status(400).json({ success: false, error: { code: 'VAL_001', message: 'Cannot change owner role directly — use transfer ownership', statusCode: 400 } });
    }

    const updated = await prisma.groupMember.update({
      where: { conversationId_userId: { conversationId, userId: targetUserId } },
      data: { role },
      include: { user: { select: { id: true, firstName: true, lastName: true } } }
    });

    if (getIo()) {
      getIo().to(`conversation:${conversationId}`).emit('group:member_role_changed', {
        conversationId, userId: targetUserId, role, changedBy: currentUserId
      });
    }

    logger.info(`User ${targetUserId} role changed to ${role} in group ${conversationId} by ${currentUserId}`);
    return res.json({ success: true, data: updated });
  } catch (error) {
    logger.error('Failed to update member role:', error);
    return res.status(500).json({ success: false, error: { code: 'INT_001', message: 'Failed to update role', statusCode: 500 } });
  }
}

/**
 * Update group permissions (who can send messages / media). Owner/admin only.
 * PATCH /api/v1/group-chat/conversations/:conversationId/permissions
 */
async function updateGroupPermissions(req, res) {
  try {
    const { conversationId } = req.params;
    const { onlyAdminsCanSendMessages, onlyAdminsCanSendMedia } = req.body;
    const userId = req.user.id;

    const member = await prisma.groupMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } }
    });
    if (!member || member.leftAt || (member.role !== 'OWNER' && member.role !== 'ADMIN')) {
      return res.status(403).json({ success: false, error: { code: 'AUTH_001', message: 'Only owner or admin can change permissions', statusCode: 403 } });
    }

    const data = {};
    if (onlyAdminsCanSendMessages !== undefined) data.onlyAdminsCanSendMessages = Boolean(onlyAdminsCanSendMessages);
    if (onlyAdminsCanSendMedia !== undefined) data.onlyAdminsCanSendMedia = Boolean(onlyAdminsCanSendMedia);

    const updated = await prisma.groupConversation.update({
      where: { id: conversationId },
      data
    });

    if (getIo()) {
      getIo().to(`conversation:${conversationId}`).emit('group:permissions_updated', {
        conversationId, permissions: data, updatedBy: userId
      });
    }

    logger.info(`Group ${conversationId} permissions updated by ${userId}`);
    return res.json({ success: true, data: updated });
  } catch (error) {
    logger.error('Failed to update group permissions:', error);
    return res.status(500).json({ success: false, error: { code: 'INT_001', message: 'Failed to update permissions', statusCode: 500 } });
  }
}

/**
 * Delete a group conversation. OWNER only — not SUPER_ADMIN, not regular admins.
 * Soft-deletes the conversation by setting deletedAt, then notifies all members.
 * DELETE /api/v1/group-chat/conversations/:id
 */
async function deleteGroupConversation(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // SUPER_ADMIN explicitly cannot delete group conversations created by others
    if (req.user.role === 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        error: { code: 'AUTH_001', message: 'Platform administrators cannot delete group conversations', statusCode: 403 }
      });
    }

    const conversation = await prisma.groupConversation.findUnique({
      where: { id },
      select: { id: true, name: true, createdBy: true, deletedAt: true }
    });

    if (!conversation) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND_001', message: 'Group not found', statusCode: 404 } });
    }
    if (conversation.deletedAt) {
      return res.status(410).json({ success: false, error: { code: 'GONE_001', message: 'Group already deleted', statusCode: 410 } });
    }

    // Only the OWNER (creator) can delete the group
    const member = await prisma.groupMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId } }
    });
    if (!member || member.leftAt || member.role !== 'OWNER') {
      return res.status(403).json({
        success: false,
        error: { code: 'AUTH_001', message: 'Only the group owner can delete this group', statusCode: 403 }
      });
    }

    // Soft-delete the conversation
    await prisma.groupConversation.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    // Notify all members that the group was deleted
    if (getIo()) {
      getIo().to(`conversation:${id}`).emit('group:deleted', {
        conversationId: id,
        deletedBy: userId,
        name: conversation.name,
      });
    }

    logger.info(`Group conversation ${id} deleted by owner ${userId}`);
    return res.json({ success: true, message: 'Group deleted successfully' });
  } catch (error) {
    logger.error('Failed to delete group conversation:', error);
    return res.status(500).json({ success: false, error: { code: 'INT_001', message: 'Failed to delete group', statusCode: 500 } });
  }
}

module.exports = {
  createGroupConversation,
  getUserGroupConversations,
  getGroupConversation,
  addGroupMember,
  removeGroupMember,
  updateGroupConversation,
  deleteGroupConversation,
  updateMemberRole,
  updateGroupPermissions,
  sendGroupMessage,
  getGroupMessages,
  addMessageReaction,
  markMessagesAsRead,
  deleteGroupMessage,
  pinGroupMessage,
  editGroupMessage,
  searchGroupMessages,
  getGroupUnreadCount,
};


