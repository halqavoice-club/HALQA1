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

/**
 * Create a new group conversation
 */
async function createGroupConversation(req, res) {
  try {
    const { schoolId, classId, name, description, privacy, maxMembers, avatarUrl } = req.body;
    const userId = req.user.id;

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

    // Check if user is a member
    const isMember = conversation.members.some(m => m.userId === userId);
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
    } else if (!existingMember) {
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
    const { type, body, mediaUrl, mimeType, fileSize, replyToId } = req.body;
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

    const message = await prisma.groupMessage.create({
      data: {
        conversationId,
        senderId: userId,
        type: type || 'TEXT',
        body,
        mediaUrl,
        mimeType,
        fileSize,
        replyToId
      },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        replyTo: {
          include: { sender: { select: { id: true, firstName: true, lastName: true } } }
        }
      }
    });

    // Update message count
    const messageCount = await prisma.groupMessage.count({
      where: { conversationId }
    });

    await prisma.groupConversation.update({
      where: { id: conversationId },
      data: {
        messageCount,
        lastMessage: body || mediaUrl,
        lastMessageAt: new Date()
      }
    });

    // Emit via Socket.IO
    if (global.io) {
      global.io.to(`conversation:${conversationId}`).emit('group:message', message);
    }

    // Send push notifications to offline members (fire-and-forget, non-blocking)
    prisma.groupMember.findMany({
      where: { conversationId, leftAt: null, userId: { not: userId } },
      include: { user: { select: { id: true } } }
    }).then(async (members) => {
      if (!members.length) return;
      const senderName = `${message.sender.firstName} ${message.sender.lastName}`;
      const conv = await prisma.groupConversation.findUnique({
        where: { id: conversationId },
        select: { name: true }
      });
      // Create in-app notifications for all members who are offline
      // (online members get real-time socket; offline members get notification bell)
      await prisma.notification.createMany({
        data: members.map(m => ({
          userId:   m.user.id,
          type:     'MESSAGE',
          title:    `${senderName} in ${conv?.name || 'a group'}`,
          body:     body ? body.substring(0, 100) : (mediaUrl ? '📎 Attachment' : 'New message'),
          data:     { groupConversationId: conversationId, messageId: message.id },
        })),
        skipDuplicates: true,
      });
    }).catch(() => {}); // non-fatal

    logger.info(`Message sent to conversation ${conversationId} by user ${userId}`);

    res.status(201).json({
      success: true,
      data: message
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
      return res.status(403).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Not a member of this conversation',
          statusCode: 403
        })
      });
    }

    const where = { conversationId };
    if (before) {
      where.createdAt = { lt: new Date(before) };
    }

    const messages = await prisma.groupMessage.findMany({
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
        }
      }
    });

    res.json({
      success: true,
      data: messages.reverse()
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
 * Add reaction to a message
 */
async function addMessageReaction(req, res) {
  try {
    const { messageId } = req.params;
    const { type } = req.body;
    const userId = req.user.id;

    // Check if message exists
    const message = await prisma.groupMessage.findUnique({
      where: { id: messageId }
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Message not found',
          statusCode: 404
        })
      });
    }

    // Check if user is a member of the conversation
    const member = await prisma.groupMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId: message.conversationId,
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

    // Upsert reaction
    const reaction = await prisma.groupMessageReaction.upsert({
      where: {
        messageId_userId: {
          messageId,
          userId
        }
      },
      update: { type },
      create: {
        messageId,
        userId,
        type
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } }
      }
    });

    // Emit via Socket.IO
    if (global.io) {
      global.io.to(`conversation:${message.conversationId}`).emit('group:reaction', reaction);
    }

    res.json({
      success: true,
      data: reaction
    });
  } catch (error) {
    logger.error('Failed to add message reaction:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to add reaction',
        statusCode: 500
      })
    });
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

    // Update member's last read at
    await prisma.groupMember.update({
      where: { id: member.id },
      data: { lastReadAt: readAt }
    });

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

    if (isAdminOrOwner && !isOwnMessage) {
      // Admin hard-delete: mark deletedAt and append to deletedBy array
      const existing = Array.isArray(message.deletedBy) ? message.deletedBy : [];
      await prisma.groupMessage.update({
        where: { id: messageId },
        data: {
          deletedAt: new Date(),
          deletedBy: existing.includes(userId) ? existing : [...existing, userId]
        }
      });
    } else {
      // Soft delete — append userId to deletedBy array
      const existing = Array.isArray(message.deletedBy) ? message.deletedBy : [];
      if (!existing.includes(userId)) {
        await prisma.groupMessage.update({
          where: { id: messageId },
          data: { deletedBy: [...existing, userId] }
        });
      }
    }

    // Notify room members
    if (global.io) {
      global.io.to(`conversation:${message.conversationId}`).emit('group:message_deleted', {
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
    if (global.io) {
      global.io.to(`conversation:${conversationId}`).emit('group:message_pinned', {
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

module.exports = {
  createGroupConversation,
  getUserGroupConversations,
  getGroupConversation,
  addGroupMember,
  removeGroupMember,
  sendGroupMessage,
  getGroupMessages,
  addMessageReaction,
  markMessagesAsRead,
  deleteGroupMessage,
  pinGroupMessage,
};
