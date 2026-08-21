const { v4: uuidv4 } = require('uuid');
const path    = require('path');
const prisma  = require('../utils/prisma');
const { setCache, getCache, deleteCache, isRedisReady } = require('../utils/redis');
const { saveFile, deleteFile } = require('../utils/storage');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');
const { getIo } = require('../sockets');
const { upsertDailyStats } = require('./voice-stats.controller');
const { clearQueue, enqueue, getQueue, isInQueue, dequeue } = require('../utils/voiceQueue');
const { autoPromoteNext } = require('../utils/autoPromote');
const { VOICE_ROLES, MODERATOR_ROLES } = require('../middleware/voiceRole.middleware');
const logger = require('../utils/logger');
const { broadcastLiveStart, broadcastLiveEnd, broadcastLiveUpdate } = require('../utils/feedLive');
const { queueBulkNotifications } = require('../services/queue.service');
const { scheduleRoomReminder, cancelRoomReminder } = require('../services/queue.service');

//  STATUS CONSTANTS 
// Rooms are PERSISTENT  they never auto-delete when empty.
// Lifecycle:
//   createRoom()   SCHEDULED (if scheduledAt set) or IDLE (immediate)
//   joinRoom()     LIVE      (first participant joins)
//   leaveRoom()    IDLE      (last participant leaves  room stays alive)
//   endRoom()      ENDED     (explicit host/admin action only)
//
// State machine:
//   SCHEDULED (first join) LIVE (all leave) IDLE
//                                                       
//                                 (join)
//   Any state (endRoom) ENDED  (terminal, no re-entry)

const STATUS = {
  LIVE:      'LIVE',
  IDLE:      'IDLE',
  ENDED:     'ENDED',
  SCHEDULED: 'SCHEDULED',
};

// --- CACHE HELPERS ------------------------------------------------------------
// Cache errors are non-fatal for read operations (we fall back to DB).
// Cache errors ARE logged so they are visible in monitoring.
// Write/delete errors are also non-fatal � a stale cache is preferable to
// a failed HTTP response, but the error is always logged.

const ROOM_CACHE_TTL = 60; // seconds (Phase 14: 60s - better for poor networks)

function roomCacheKey(roomId)  { return `voice:room:${roomId}`; }
// roomListCacheKey is defined below with full signature (BE-008)

async function getRoomWithParticipants(roomId) {
  // Try cache first � on Redis error, fall through to DB
  try {
    const cached = await getCache(roomCacheKey(roomId));
    if (cached) return cached;
  } catch (err) {
    logger.error(`[voice] Cache GET failed for room ${roomId}: ${err.message}`);
  }

  const room = await prisma.voiceRoom.findUnique({
    where: { id: roomId },
    include: {
      host: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      participants: {
        where: { isActive: true },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
        },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }]
      },
      _count: { select: { participants: { where: { isActive: true } } } }
    }
  });

  if (room) {
    try {
      await setCache(roomCacheKey(roomId), room, ROOM_CACHE_TTL);
    } catch (err) {
      logger.error(`[voice] Cache SET failed for room ${roomId}: ${err.message}`);
    }
  }
  return room;
}

async function invalidateRoomCache(roomId, schoolId) {
  try {
    // Invalidate the single-room cache
    await deleteCache(roomCacheKey(roomId));
    // BE-008: Invalidate all room list cache entries for this school using pattern delete.
    // This covers every filter/page combination without needing to enumerate them.
    const { deleteCachePattern } = require('../utils/redis');
    await deleteCachePattern(`voice:rooms:${schoolId || 'global'}:*`);
    await deleteCachePattern(`voice:rooms:global:*`);
  } catch (err) {
    logger.error(`[voice] Cache DEL failed for room ${roomId}: ${err.message}`);
  }
}

// Safe wrapper � used for all single-key invalidations inside action handlers.
// A cache delete failure must never fail an HTTP response; it is always logged.
async function safeDeleteCache(key) {
  try {
    await deleteCache(key);
  } catch (err) {
    logger.error(`[voice] Cache DEL failed for key "${key}": ${err.message}`);
  }
}

//  ACTIVE PARTICIPANT COUNT 
// Returns the number of currently active participants in a room.
async function countActive(roomId) {
  return prisma.voiceParticipant.count({ where: { roomId, isActive: true } });
}

//  AUTO-TRANSITION HELPER 
// Called after any join to transition IDLE/SCHEDULED ? LIVE.
// Rooms NEVER go back to IDLE � once LIVE, always LIVE until explicitly ended.
// ENDED rooms are never touched � that state is terminal.
async function syncRoomStatus(roomId, schoolId) {
  const room = await prisma.voiceRoom.findUnique({
    where: { id: roomId },
    select: { status: true }
  });
  if (!room || room.status === STATUS.ENDED || room.status === STATUS.LIVE) return;

  // Only transition IDLE/SCHEDULED ? LIVE when someone joins
  const active = await countActive(roomId);
  if (active > 0) {
    await prisma.voiceRoom.update({
      where: { id: roomId },
      data: {
        status:         STATUS.LIVE,
        startedAt:      room.status === STATUS.SCHEDULED ? new Date() : undefined,
        lastActivityAt: new Date(),
        updatedAt:      new Date()
      }
    });
    await invalidateRoomCache(roomId, schoolId);
    const io = getIo();
    if (io) io.to(`voice:${roomId}`).emit('voice:status_changed', { roomId, status: STATUS.LIVE });

    // Broadcast live card into the social feed (fire-and-forget)
    const liveRoom = await prisma.voiceRoom.findUnique({
      where: { id: roomId },
      select: { title: true, description: true, coverEmoji: true, coverImageUrl: true, hostId: true, privacy: true, schoolId: true }
    });
    if (liveRoom && liveRoom.privacy === 'PUBLIC') {
      broadcastLiveStart({
        refEntityType:    'voice_room',
        refEntityId:      roomId,
        authorId:         liveRoom.hostId,
        title:            liveRoom.title,
        description:      liveRoom.description,
        coverEmoji:       liveRoom.coverEmoji,
        coverImageUrl:    liveRoom.coverImageUrl,
        schoolId:         liveRoom.schoolId,
        participantCount: active,
      });

      // ── Notify followers that the host is now live (fire-and-forget) ────
      // Uses queueBulkNotifications so FCM delivery is handled by the worker,
      // not blocking this HTTP response path.
      _notifyFollowersVoiceLive(liveRoom, roomId).catch(err =>
        logger.warn(`[voice] follower notification failed for room ${roomId}: ${err.message}`)
      );
    }
  }
}

// --- LIST ROOMS ---------------------------------------------------------------
// BE-008: The room list is the most-hit endpoint (every user landing on the
// voice club lobby). Cache the full paginated response for 10 seconds per
// school+filter combination. Invalidated by createRoom / joinRoom / endRoom.
//
// Cache key: voice:rooms:{schoolId}:{status}:{privacy}:{page}:{limit}
// TTL: 10s — short enough that room status changes feel real-time.
const ROOM_LIST_CACHE_TTL = 10; // seconds

function roomListCacheKey(schoolId, status, privacy, page, limit) {
  return `voice:rooms:${schoolId || 'global'}:${status || 'active'}:${privacy || 'all'}:${page}:${limit}`;
}

async function listRooms(req, res, next) {
  try {
    const { status, privacy, limit = 50, page = 1 } = req.query;
    // ARCHITECTURE FIX (HALQA-ARCH-03): Use SchoolMembership as authoritative source.
    // user.schoolId is null for new MEMBER users who joined via SchoolMembership;
    // they would only see global rooms. Resolve their school from SchoolMembership.
    let resolvedSchoolId = req.user.schoolId || null;
    if (!resolvedSchoolId) {
      try {
        const firstMembership = await prisma.schoolMembership.findFirst({
          where: { userId: req.user.id, status: 'ACTIVE' },
          select: { schoolId: true },
          orderBy: { createdAt: 'asc' },
        });
        if (firstMembership) resolvedSchoolId = firstMembership.schoolId;
      } catch { /* non-fatal — fall through to global-only */ }
    }
    const schoolId = resolvedSchoolId;
    const { skip, ...pagination } = getPagination(page, limit);

    // BE-008: Try list cache first
    const listKey = roomListCacheKey(schoolId, status, privacy, pagination.page, pagination.limit);
    try {
      const cached = await getCache(listKey);
      if (cached) {
        return res.json(cached);
      }
    } catch { /* cache miss — fall through to DB */ }

    // SOC-P0-01 FIX: Voice Club is a Social platform feature — room listing must
    // work correctly for ALL authenticated users regardless of school membership.
    //
    // Previous behaviour was broken in two ways:
    //   1. User WITH schoolId: only saw rooms from their school + schoolless rooms.
    //      School-specific PUBLIC rooms from other schools were hidden.
    //   2. User WITHOUT schoolId: the schoolId filter was skipped entirely, exposing
    //      ALL rooms including school-scoped rooms not intended for global users.
    //
    // Correct Social behaviour:
    //   - PUBLIC rooms with NO schoolId (global): visible to everyone
    //   - PUBLIC rooms WITH a schoolId (school-scoped): visible only to users who
    //     belong to that school, OR to SUPER_ADMIN
    //   - PRIVATE rooms: visible to everyone in the list (join is gated separately)
    //
    // Implementation: show global rooms always + own-school rooms if user has a school.
    // This preserves school privacy while keeping Voice Club open to all social users.
    let schoolWhere;
    if (req.user.role === 'SUPER_ADMIN') {
      // Platform admin sees everything
      schoolWhere = {};
    } else if (schoolId) {
      // User belongs to a school: show global rooms + their own school's rooms
      schoolWhere = {
        OR: [
          { schoolId: null },        // global rooms (no school affiliation)
          { schoolId: schoolId },    // user's own school rooms
        ]
      };
    } else {
      // User has no school: show only global rooms (schoolId is null)
      schoolWhere = { schoolId: null };
    }

    const where = {
      deletedAt: null,
      status:    status  ? status  : { not: STATUS.ENDED },
      ...(privacy  && { privacy }),
      ...schoolWhere,
    };

    const [rooms, total] = await Promise.all([
      prisma.voiceRoom.findMany({
        where,
        skip,
        take: pagination.limit,
        include: {
          host: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          participants: {
            where: { isActive: true },
            include: {
              user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
            },
            orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
            take: 20
          },
          _count: { select: { participants: { where: { isActive: true } } } }
        },
        orderBy: [{ status: 'asc' }, { lastActivityAt: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.voiceRoom.count({ where })
    ]);

    const response = {
      success: true,
      data: rooms,
      pagination: buildPaginationMeta(total, pagination.page, pagination.limit),
    };

    // BE-008: Store in cache (non-fatal if Redis is down)
    try { await setCache(listKey, response, ROOM_LIST_CACHE_TTL); } catch { /* non-fatal */ }

    return paginatedResponse(res, rooms, buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (error) { next(error); }
}

// --- GET SINGLE ROOM ----------------------------------------------------------
async function getRoom(req, res, next) {
  try {
    const { id } = req.params;
    const room = await getRoomWithParticipants(id);
    if (!room) return errorResponse(res, 'Room not found', 404);
    return successResponse(res, room);
  } catch (error) { next(error); }
}

// --- SEARCH ROOMS -------------------------------------------------------------
// PERFORMANCE FIX (L1): Now uses MySQL FULLTEXT MATCH AGAINST via search utility.
async function searchRooms(req, res, next) {
  try {
    const { q, limit = 20 } = req.query;
    if (!q || q.trim().length < 2) return successResponse(res, []);

    const take = Math.min(parseInt(limit), 50);
    const { searchVoiceRooms } = require('../utils/search');
    const rooms = await searchVoiceRooms(prisma, q.trim(), take);

    return successResponse(res, rooms);
  } catch (error) { next(error); }
}

// --- CREATE ROOM --------------------------------------------------------------
async function createRoom(req, res, next) {
  try {
    const {
      title, description, privacy = 'PUBLIC', topic,
      coverEmoji = '???', maxSpeakers = 10, scheduledAt
    } = req.body;
    const hostId  = req.user.id;
    // ARCHITECTURE FIX (HALQA-ARCH-03): Resolve school from SchoolMembership for new-arch users.
    let resolvedSchoolId = req.user.schoolId || null;
    if (!resolvedSchoolId) {
      try {
        const firstMembership = await prisma.schoolMembership.findFirst({
          where: { userId: req.user.id, status: 'ACTIVE' },
          select: { schoolId: true },
          orderBy: { createdAt: 'asc' },
        });
        if (firstMembership) resolvedSchoolId = firstMembership.schoolId;
      } catch { /* non-fatal */ }
    }
    const schoolId = resolvedSchoolId;

    // BUG FIX: wrap room + host participant creation in a transaction
    // so we never end up with a room that has no host participant
    const roomId = uuidv4();
    await prisma.$transaction([
      prisma.voiceRoom.create({
        data: {
          id:          roomId,
          hostId,
          schoolId,
          title,
          description,
          privacy,
          topic,
          coverEmoji,
          maxSpeakers,
          status:         scheduledAt ? STATUS.SCHEDULED : STATUS.LIVE,
          scheduledAt:    scheduledAt ? new Date(scheduledAt) : null,
          lastActivityAt: new Date(),
        }
      }),
      prisma.voiceParticipant.create({
        data: {
          id:       uuidv4(),
          roomId,
          userId:   hostId,
          role:     VOICE_ROLES.HOST,
          isMuted:  false,
          isActive: true,
          joinedAt: new Date(),
        }
      })
    ]);

    // Transition to LIVE
    await syncRoomStatus(roomId, schoolId);
    const updatedRoom = await getRoomWithParticipants(roomId);

    // Schedule push notification reminder if room is scheduled for the future
    if (scheduledAt) {
      scheduleRoomReminder({
        id:          roomId,
        title:       title,
        hostId,
        schoolId,
        scheduledAt
      }).catch(() => {}); // non-fatal
    }

    const io = getIo();
    if (io) {
      io.to(`school:${schoolId}`).emit('voice:room_created', updatedRoom);
    }

    return successResponse(res, updatedRoom, 'Room created', 201);
  } catch (error) { next(error); }
}

// --- JOIN ROOM ----------------------------------------------------------------
async function joinRoom(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId  = req.user.id;
    const schoolId = req.user.schoolId;

    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room) return errorResponse(res, 'Room not found', 404);
    if (room.status === STATUS.ENDED) return errorResponse(res, 'This room has ended', 400);
    if (room.deletedAt) return errorResponse(res, 'Room not found', 404);

    // --- Audience capacity enforcement (Requirement 17.1, 17.2) ---------------
    // Check whether the room has reached its tier capacity limit before allowing
    // a new participant to join. The host is exempt — they are always allowed in.
    if (room.hostId !== userId) {
      const ROOM_LEVEL_CAPACITY = { 1:500, 2:1000, 3:2000, 4:3500, 5:5000, 6:8000, 7:12000, 8:18000, 9:25000, 10:50000 };
      const maxCapacity = ROOM_LEVEL_CAPACITY[room.roomLevel ?? 1] ?? 500;
      const currentCount = await prisma.voiceParticipant.count({ where: { roomId, isActive: true } });
      if (currentCount >= maxCapacity) {
        return errorResponse(res, `Room is full (${maxCapacity} participants)`, 403);
      }
    }

    // Check privacy
    if (room.privacy === 'PRIVATE' && room.hostId !== userId) {
      return errorResponse(res, 'This is a private room', 403);
    }

    // Upsert participant � re-join if previously left
    const existing = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });

    let participant;
    if (existing) {
      participant = await prisma.voiceParticipant.update({
        where: { roomId_userId: { roomId, userId } },
        data: {
          isActive:    true,
          joinedAt:    new Date(),
          leftAt:      null,
          isMuted:     existing.role === VOICE_ROLES.AUDIENCE,
          handRaised:  false,
          handRaisedAt: null,
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
        }
      });
    } else {
      // Determine role: host gets HOST, everyone else gets AUDIENCE
      const role = room.hostId === userId ? VOICE_ROLES.HOST : VOICE_ROLES.AUDIENCE;
      participant = await prisma.voiceParticipant.create({
        data: {
          id:       uuidv4(),
          roomId,
          userId,
          role,
          isMuted:  role === VOICE_ROLES.AUDIENCE,
          isActive: true,
          joinedAt: new Date(),
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
        }
      });
    }

    // BE-005: Previously this was 3 separate sequential calls:
    //   syncRoomStatus() → 2 DB hits (findUnique + countActive + update)
    //   invalidateRoomCache() → Redis delete
    //   getRoomWithParticipants() → DB hit + Redis write
    //
    // Now: syncRoomStatus() and invalidateRoomCache() are merged inside
    // syncRoomStatus itself (it already calls invalidateRoomCache).
    // getRoomWithParticipants() hits the cache we just populated — 1 DB hit max.
    await syncRoomStatus(roomId, schoolId);
    // syncRoomStatus already calls invalidateRoomCache — no second call needed.
    const updatedRoom = await getRoomWithParticipants(roomId);

    // ── Auto-create permanent membership on first join ──────────────────────
    // If member record doesn't exist or was REMOVED (re-join), create/restore it.
    // If BLOCKED, they would have been caught by the existing blocked check above.
    // Owner always gets OWNER role; all others get MEMBER.
    try {
      const existingMember = await prisma.voiceRoomMember.findUnique({
        where: { roomId_userId: { roomId, userId } },
        select: { id: true, status: true, role: true }
      });
      if (!existingMember) {
        // Check capacity
        const memberCount = await prisma.voiceRoomMember.count({ where: { roomId, status: 'ACTIVE' } });
        const maxMembers = (() => {
          const caps = { 1:500,2:1000,3:2000,4:3500,5:5000,6:8000,7:12000,8:18000,9:25000,10:50000 };
          return caps[updatedRoom?.roomLevel ?? 1] ?? 500;
        })();
        if (memberCount < maxMembers) {
          const memberRole = room.hostId === userId ? 'OWNER' : 'MEMBER';
          await prisma.voiceRoomMember.create({
            data: {
              id: require('crypto').randomUUID(),
              roomId, userId,
              role: memberRole,
              status: 'ACTIVE',
              memberLevel: 1,
              lastActiveAt: new Date(),
              isBanned: false,
            }
          });
          // Emit member count update
          const newCount = memberCount + 1;
          const io2 = getIo();
          if (io2) {
            io2.to(`voice:${roomId}`).emit('voice:member_joined', {
              roomId, userId,
              firstName: participant.user.firstName,
              lastName: participant.user.lastName,
              avatarUrl: participant.user.avatarUrl,
              role: memberRole,
              memberLevel: 1,
              memberCount: newCount,
              maxMembers,
              roomLevel: updatedRoom?.roomLevel ?? 1,
            });
          }
        }
      } else if (existingMember.status === 'REMOVED') {
        // Re-joining — restore membership
        await prisma.voiceRoomMember.update({
          where: { roomId_userId: { roomId, userId } },
          data: { status: 'ACTIVE', lastActiveAt: new Date() }
        });
      } else {
        // Already active — update lastActiveAt
        await prisma.voiceRoomMember.update({
          where: { roomId_userId: { roomId, userId } },
          data: { lastActiveAt: new Date() }
        });
      }
    } catch (memberErr) {
      // Non-fatal — voice room join succeeds even if membership creation fails
      logger.warn(`[voice] Auto-membership creation failed for ${userId} in ${roomId}: ${memberErr.message}`);
    }
    // ── End auto-membership ─────────────────────────────────────────────────

    // Update participant count on the feed live card
    const activeCount = updatedRoom?._count?.participants ?? 0;
    broadcastLiveUpdate('voice_room', roomId, activeCount);

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:user_joined', {
        roomId,
        userId:    participant.userId,
        firstName: participant.user.firstName,
        lastName:  participant.user.lastName,
        avatarUrl: participant.user.avatarUrl,
        role:      participant.role,
      });
      // Join the socket room
      const sockets = await io.in(`user:${userId}`).fetchSockets();
      sockets.forEach(s => s.join(`voice:${roomId}`));
    }

    return successResponse(res, updatedRoom, 'Joined room');
  } catch (error) { next(error); }
}

// --- LEAVE ROOM ---------------------------------------------------------------
async function leaveRoom(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId  = req.user.id;
    const schoolId = req.user.schoolId;

    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });

    if (!participant || !participant.isActive) {
      return successResponse(res, null, 'Already left');
    }

    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId, userId } },
      data: {
        isActive:    false,
        leftAt:      new Date(),
        handRaised:  false,
        handRaisedAt: null,
      }
    });

    // Remove from FIFO queue if they were waiting to speak
    try {
      const { dequeue: dq } = require('../utils/voiceQueue');
      await dq(roomId, userId);
    } catch {}

    // If they were a speaker or moderator, auto-promote next from queue
    if (participant.role === VOICE_ROLES.SPEAKER || participant.role === VOICE_ROLES.MODERATOR) {
      const io = getIo();
      await autoPromoteNext(roomId, io);
    }

    await invalidateRoomCache(roomId, schoolId);

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:user_left', { roomId, userId });
      const sockets = await io.in(`user:${userId}`).fetchSockets();
      sockets.forEach(s => s.leave(`voice:${roomId}`));
    }

    // Update feed live card participant count
    const remaining = await countActive(roomId);
    broadcastLiveUpdate('voice_room', roomId, remaining);

    return successResponse(res, null, 'Left room');
  } catch (error) { next(error); }
}

// --- END ROOM -----------------------------------------------------------------
async function endRoom(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId  = req.user.id;
    const schoolId = req.user.schoolId;

    const room = await prisma.voiceRoom.findUnique({
      where: { id: roomId },
      include: { _count: { select: { participants: { where: { isActive: true } } } } }
    });

    if (!room) return errorResponse(res, 'Room not found', 404);
    if (room.status === STATUS.ENDED) return errorResponse(res, 'Room already ended', 400);

    // NF-6 FIX: Voice rooms are a Social feature — SCHOOL_ADMIN must not end rooms
    // belonging to users from other schools. Only the host or SUPER_ADMIN (platform admin).
    const isAdmin = req.user.role === 'SUPER_ADMIN';
    if (room.hostId !== userId && !isAdmin) {
      return errorResponse(res, 'Only the host can end this room', 403);
    }

    const endedAt = new Date();
    const durationMinutes = room.startedAt
      ? Math.round((endedAt.getTime() - new Date(room.startedAt).getTime()) / 60000)
      : 0;

    // Mark all participants inactive
    await prisma.voiceParticipant.updateMany({
      where: { roomId, isActive: true },
      data: { isActive: false, leftAt: endedAt }
    });

    await prisma.voiceRoom.update({
      where: { id: roomId },
      data: {
        status:  STATUS.ENDED,
        endedAt,
        updatedAt: endedAt
      }
    });

    // Update host stats
    try {
      const peakAudience = await prisma.voiceParticipant.count({
        where: { roomId, role: VOICE_ROLES.AUDIENCE }
      });
      const totalSpeakers = await prisma.voiceParticipant.count({
        where: { roomId, role: { in: [VOICE_ROLES.SPEAKER, VOICE_ROLES.MODERATOR] } }
      });
      const totalMessages = await prisma.voiceMessage.count({ where: { roomId } });

      await upsertDailyStats(room.hostId, {
        durationMinutes,
        peakAudience,
        totalListeners: room._count.participants,
        totalSpeakers,
        totalMessages
      });
    } catch {}

    try { await clearQueue(roomId); } catch (err) { logger.warn(`[voice] clearQueue failed: ${err.message}`); }
    await invalidateRoomCache(roomId, schoolId);

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:room_ended', { roomId });
    }

    // Remove live card from feed
    broadcastLiveEnd('voice_room', roomId);

    return successResponse(res, null, 'Room ended');
  } catch (error) { next(error); }
}

// --- TOGGLE MUTE --------------------------------------------------------------
async function toggleMute(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const callerId = req.user.id;
    const { isMuted, targetUserId } = req.body;

    // Determine who is being muted: self or another user (moderator action)
    const subjectId = targetUserId || callerId;

    // If muting someone else, caller must be HOST or MODERATOR
    if (subjectId !== callerId) {
      const caller = await prisma.voiceParticipant.findUnique({
        where: { roomId_userId: { roomId, userId: callerId } }
      });
      if (!caller || !caller.isActive || !MODERATOR_ROLES.includes(caller.role)) {
        return errorResponse(res, 'Only hosts and moderators can mute others', 403);
      }
    }

    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: subjectId } }
    });

    if (!participant || !participant.isActive) {
      return errorResponse(res, 'User is not in this room', 403);
    }

    const newMuted = isMuted !== undefined ? isMuted : !participant.isMuted;

    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId, userId: subjectId } },
      data: { isMuted: newMuted }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:mute_changed', {
        roomId, userId: subjectId, isMuted: newMuted
      });
    }

    return successResponse(res, { isMuted: newMuted });
  } catch (error) { next(error); }
}

// --- RAISE HAND ---------------------------------------------------------------
async function raiseHand(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;
    const { raised } = req.body;

    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });

    if (!participant || !participant.isActive) {
      return errorResponse(res, 'You are not in this room', 403);
    }

    const newRaised = raised !== undefined ? raised : !participant.handRaised;

    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId, userId } },
      data: {
        handRaised:   newRaised,
        handRaisedAt: newRaised ? new Date() : null
      }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:hand_raised', {
        roomId,
        userId,
        raised:    newRaised,
        firstName: req.user.firstName,
        lastName:  req.user.lastName,
      });
    }

    return successResponse(res, { raised: newRaised });
  } catch (error) { next(error); }
}

// --- PROMOTE PARTICIPANT ------------------------------------------------------
async function promoteParticipant(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const { targetUserId, role } = req.body;
    const requesterId = req.user.id;

    // Validate requester is host or moderator
    const requester = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: requesterId } }
    });

    if (!requester || !requester.isActive) {
      return errorResponse(res, 'You are not in this room', 403);
    }

    if (!MODERATOR_ROLES.includes(requester.role)) {
      return errorResponse(res, 'Only hosts and moderators can promote participants', 403);
    }

    const target = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      include: { user: { select: { firstName: true, lastName: true } } }
    });

    if (!target || !target.isActive) {
      return errorResponse(res, 'Target user is not in this room', 404);
    }

    // Check speaker limit when promoting to SPEAKER
    if (role === VOICE_ROLES.SPEAKER) {
      const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
      const speakerCount = await prisma.voiceParticipant.count({
        where: { roomId, isActive: true, role: { in: ['HOST', 'MODERATOR', 'SPEAKER'] } }
      });
      if (speakerCount >= (room?.maxSpeakers || 10)) {
        return errorResponse(res, 'Speaker limit reached', 400);
      }
    }

    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      data: {
        role,
        isMuted:     role === VOICE_ROLES.AUDIENCE,
        handRaised:  false,
        handRaisedAt: null,
      }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:role_changed', { roomId, userId: targetUserId, role });
      io.to(`user:${targetUserId}`).emit('voice:your_role_changed', { roomId, role });
    }

    return successResponse(res, { userId: targetUserId, role });
  } catch (error) { next(error); }
}

// --- KICK PARTICIPANT ---------------------------------------------------------
async function kickParticipant(req, res, next) {
  try {
    const { id: roomId, userId: targetUserId } = req.params;
    const requesterId = req.user.id;

    const requester = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: requesterId } }
    });

    if (!requester || !requester.isActive || !MODERATOR_ROLES.includes(requester.role)) {
      return errorResponse(res, 'Only hosts and moderators can kick participants', 403);
    }

    const target = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } }
    });

    if (!target || !target.isActive) {
      return errorResponse(res, 'User is not in this room', 404);
    }

    // Cannot kick the host
    if (target.role === VOICE_ROLES.HOST) {
      return errorResponse(res, 'Cannot kick the host', 403);
    }

    // Moderators cannot kick other moderators (only host can)
    if (target.role === VOICE_ROLES.MODERATOR && requester.role !== VOICE_ROLES.HOST) {
      return errorResponse(res, 'Only the host can kick moderators', 403);
    }

    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      data: { isActive: false, leftAt: new Date() }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:kicked', { roomId, userId: targetUserId });
      io.to(`user:${targetUserId}`).emit('voice:kicked', { roomId });
      const sockets = await io.in(`user:${targetUserId}`).fetchSockets();
      sockets.forEach(s => s.leave(`voice:${roomId}`));
    }

    return successResponse(res, null, 'Participant removed');
  } catch (error) { next(error); }
}

// --- GET MESSAGES -------------------------------------------------------------
async function getMessages(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const { limit = 50, before } = req.query;

    const where = { roomId };
    if (before) where.createdAt = { lt: new Date(before) };

    const messages = await prisma.voiceMessage.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit), 100)
    });

    return successResponse(res, messages.reverse());
  } catch (error) { next(error); }
}

// --- SEND MESSAGE -------------------------------------------------------------
async function sendMessage(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const { body } = req.body;
    const userId = req.user.id;

    // Must be active in room
    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });

    if (!participant || !participant.isActive) {
      return errorResponse(res, 'You must be in the room to send messages', 403);
    }

    // -- Enforce comment settings -------------------------------------------
    const room = await prisma.voiceRoom.findUnique({
      where: { id: roomId },
      select: { commentsEnabled: true, slowMode: true, messageType: true, hostId: true }
    });

    if (room) {
      // Comments disabled entirely
      if (!room.commentsEnabled) {
        return errorResponse(res, 'Chat is disabled in this room', 403);
      }

      // messageType = "none" blocks everyone (HOST/MOD exempt)
      if (room.messageType === 'none' && !MODERATOR_ROLES.includes(participant.role)) {
        return errorResponse(res, 'Messaging is disabled in this room', 403);
      }

      // messageType = "followers" � only followers of the host can chat (HOST/MOD exempt)
      if (room.messageType === 'followers' && !MODERATOR_ROLES.includes(participant.role)) {
        // The host themselves can always chat
        if (userId !== room.hostId) {
          const isFollower = await prisma.follow.findUnique({
            where: {
              followerId_followingId: {
                followerId:  userId,
                followingId: room.hostId
              }
            }
          });
          if (!isFollower) {
            return errorResponse(
              res,
              'Only followers of the host can chat in this room',
              403
            );
          }
        }
      }

      // Slow mode: 1 message per 5 seconds per user (HOST/MOD exempt)
      if (room.slowMode && !MODERATOR_ROLES.includes(participant.role)) {
        const fiveSecondsAgo = new Date(Date.now() - 5000);
        const recentCount = await prisma.voiceMessage.count({
          where: { roomId, userId, createdAt: { gte: fiveSecondsAgo } }
        });
        if (recentCount > 0) {
          return errorResponse(res, 'Slow mode is on � wait 5 seconds between messages', 429);
        }
      }
    }

    const message = await prisma.voiceMessage.create({
      data: {
        id:     uuidv4(),
        roomId,
        userId,
        body
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
      }
    });

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:message', { roomId, message });
    }

    return successResponse(res, message, 'Message sent', 201);
  } catch (error) { next(error); }
}

// --- GET HAND QUEUE (legacy) --------------------------------------------------
async function getHandQueue(req, res, next) {
  try {
    const { id: roomId } = req.params;

    const queue = await prisma.voiceParticipant.findMany({
      where: { roomId, isActive: true, handRaised: true, role: VOICE_ROLES.AUDIENCE },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
      },
      orderBy: { handRaisedAt: 'asc' }
    });

    return successResponse(res, queue);
  } catch (error) { next(error); }
}

// --- TOGGLE OPEN MIC ----------------------------------------------------------
async function toggleOpenMic(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const { enabled } = req.body;
    const userId = req.user.id;

    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });

    if (!participant || !participant.isActive || !MODERATOR_ROLES.includes(participant.role)) {
      return errorResponse(res, 'Only hosts and moderators can toggle open mic', 403);
    }

    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room) return errorResponse(res, 'Room not found', 404);

    const newState = enabled !== undefined ? enabled : !room.isOpenMic;

    await prisma.voiceRoom.update({
      where: { id: roomId },
      data: { isOpenMic: newState, updatedAt: new Date() }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:open_mic_changed', { roomId, isOpenMic: newState, changedBy: userId });
    }

    return successResponse(res, { isOpenMic: newState });
  } catch (error) { next(error); }
}

// --- TOGGLE MIC LOCK ---------------------------------------------------
async function toggleMicLock(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const { locked } = req.body;
    const userId = req.user.id;

    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });

    if (!participant || !participant.isActive || !MODERATOR_ROLES.includes(participant.role)) {
      return errorResponse(res, 'Only hosts and moderators can lock the mic', 403);
    }

    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room) return errorResponse(res, 'Room not found', 404);

    const newState = locked !== undefined ? !!locked : !room.micLocked;

    await prisma.voiceRoom.update({
      where: { id: roomId },
      data: { micLocked: newState, updatedAt: new Date() }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:mic_lock_changed', { roomId, micLocked: newState, changedBy: userId });
    }

    return successResponse(res, { micLocked: newState });
  } catch (error) { next(error); }
}

// --- GRAB MIC (take mic — instant if slot available, queue if full) ----------
async function grabMic(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;

    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room) return errorResponse(res, 'Room not found', 404);

    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });

    if (!participant || !participant.isActive) {
      return errorResponse(res, 'You are not in this room', 403);
    }
    if (participant.role !== VOICE_ROLES.AUDIENCE) {
      return errorResponse(res, 'You are already a speaker', 400);
    }

    // Check if already in queue (Redis-safe: skip if Redis unavailable)
    if (isRedisReady()) {
      try {
        const alreadyQueued = await isInQueue(roomId, userId);
        if (alreadyQueued) {
          const { getPosition } = require('../utils/voiceQueue');
          const position = await getPosition(roomId, userId);
          return successResponse(res, { queued: true, position }, `Already in queue at position #${position}`);
        }
      } catch (err) {
        logger.warn(`[voice:grabMic] Redis queue check failed, continuing: ${err.message}`);
      }
    } else if (participant.handRaised) {
      // Redis unavailable: use DB handRaised as duplicate check
      return successResponse(res, { queued: true, position: 1 }, 'Already waiting for a speaker slot');
    }

    // Count current speakers
    const speakerCount = await prisma.voiceParticipant.count({
      where: { roomId, isActive: true, role: { in: ['HOST', 'MODERATOR', 'SPEAKER'] } }
    });
    const limit = room.maxSpeakers || 10;

    const io = getIo();

    if (speakerCount < limit) {
      // -- Slot available — promote instantly
      await prisma.voiceParticipant.update({
        where: { roomId_userId: { roomId, userId } },
        data: {
          role:        VOICE_ROLES.SPEAKER,
          isMuted:     false,
          handRaised:  false,
          handRaisedAt: null,
        }
      });

      await safeDeleteCache(`voice:room:${roomId}`);

      if (io) {
        io.to(`voice:${roomId}`).emit('voice:mic_grabbed', {
          roomId, userId,
          firstName: req.user.firstName,
          lastName:  req.user.lastName,
        });
        io.to(`voice:${roomId}`).emit('voice:role_changed', {
          roomId, userId, role: VOICE_ROLES.SPEAKER
        });
      }

      return successResponse(res, { role: VOICE_ROLES.SPEAKER, queued: false }, 'You are now a speaker');

    } else {
      // -- Stage full — add to FIFO queue (Redis) or DB fallback
      let position = 1;
      if (isRedisReady()) {
        try {
          position = await enqueue(roomId, {
            id:        userId,
            firstName: req.user.firstName,
            lastName:  req.user.lastName,
            avatarUrl: req.user.avatarUrl || null,
          });
        } catch (err) {
          logger.warn(`[voice:grabMic] Redis enqueue failed, using DB fallback: ${err.message}`);
        }
      }

      // Always persist handRaised in DB so UI shows waiting state
      await prisma.voiceParticipant.update({
        where: { roomId_userId: { roomId, userId } },
        data: { handRaised: true, handRaisedAt: new Date() }
      });

      await safeDeleteCache(`voice:room:${roomId}`);

      if (io) {
        io.to(`user:${userId}`).emit('voice:queue_position', { roomId, position });
        let q = [];
        if (isRedisReady()) {
          try { q = await getQueue(roomId); } catch (err) { /* Redis unavailable */ }
        }
        io.to(`voice:${roomId}`).emit('voice:queue_updated', {
          roomId, queue: q, queueLength: q.length
        });
        io.to(`voice:${roomId}`).emit('voice:hand_raised', {
          roomId, userId, raised: true,
          firstName: req.user.firstName,
          lastName:  req.user.lastName,
        });
      }

      return successResponse(res, { queued: true, position }, `Stage full — you are #${position} in the queue`);
    }
  } catch (error) { next(error); }
}

// --- DROP MIC (speaker demotes self to audience) -----------------------------
async function dropMic(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;

    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });

    if (!participant || !participant.isActive) {
      return errorResponse(res, 'You are not in this room', 403);
    }
    if (participant.role !== VOICE_ROLES.SPEAKER) {
      return errorResponse(res, 'Only speakers can drop the mic', 400);
    }

    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId, userId } },
      data: {
        role:        VOICE_ROLES.AUDIENCE,
        isMuted:     true,
        handRaised:  false,
        handRaisedAt: null,
      }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:role_changed', {
        roomId, userId, role: VOICE_ROLES.AUDIENCE
      });
    }

    // Auto-promote next person from queue
    await autoPromoteNext(roomId, io);

    return successResponse(res, { role: VOICE_ROLES.AUDIENCE }, 'Mic dropped');
  } catch (error) { next(error); }
}
// --- UPLOAD ROOM COVER IMAGE --------------------------------------------------
async function uploadRoomCover(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;

    if (!req.file) return errorResponse(res, 'No image file provided', 400);

    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room || room.deletedAt) return errorResponse(res, 'Room not found', 404);

    // NF-6 FIX: Only host or SUPER_ADMIN can update room cover image.
    const isAdmin = req.user.role === 'SUPER_ADMIN';
    if (room.hostId !== userId && !isAdmin) {
      return errorResponse(res, 'Only the host can update the room image', 403);
    }

    // Save to configured storage (local or S3)
    const ext      = path.extname(req.file.originalname).toLowerCase();
    const filename = `room-${uuidv4()}${ext}`;
    const { url: coverImageUrl } = await saveFile(
      req.file.buffer,
      filename,
      req.file.mimetype,
      'avatars'
    );

    // Delete old cover from whichever backend stored it
    if (room.coverImageUrl) {
      await deleteFile(room.coverImageUrl).catch(() => {});
    }

    const updated = await prisma.voiceRoom.update({
      where: { id: roomId },
      data: { coverImageUrl, updatedAt: new Date() }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    // Broadcast to room and lobby
    const io = getIo();
    if (io) {
      const payload = {
        roomId,
        title:         updated.title,
        description:   updated.description,
        topic:         updated.topic,
        privacy:       updated.privacy,
        coverEmoji:    updated.coverEmoji,
        coverImageUrl: updated.coverImageUrl,
      };
      io.to(`voice:${roomId}`).emit('voice:room_updated', payload);
      if (updated.schoolId) {
        io.to(`school:${updated.schoolId}`).emit('voice:room_updated', payload);
      }
    }

    return successResponse(res, { coverImageUrl }, 'Room cover updated');
  } catch (error) { next(error); }
}
async function getMyRooms(req, res, next) {
  try {
    const userId = req.user.id;
    const { status } = req.query;

    const where = {
      hostId:    userId,
      deletedAt: null,
      ...(status ? { status } : {})
    };

    const rooms = await prisma.voiceRoom.findMany({
      where,
      include: {
        host: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        participants: {
          where: { isActive: true },
          include: {
            user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
          },
          orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
          take: 20
        },
        _count: { select: { participants: { where: { isActive: true } }, messages: true } }
      },
      orderBy: [{ status: 'asc' }, { lastActivityAt: 'desc' }, { createdAt: 'desc' }]
    });

    return successResponse(res, rooms);
  } catch (error) { next(error); }
}

// --- UPDATE ROOM --------------------------------------------------------------
async function updateRoom(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;
    const { title, description, topic, privacy, coverEmoji, coverImageUrl,
            commentsEnabled, slowMode, messageType, reactionsEnabled } = req.body;

    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room || room.deletedAt) return errorResponse(res, 'Room not found', 404);
    if (room.status === STATUS.ENDED) return errorResponse(res, 'Cannot edit an ended room', 400);

    // NF-6 FIX: Only host, moderator, or SUPER_ADMIN can edit room settings.
    const isAdmin = req.user.role === 'SUPER_ADMIN';
    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });
    const isModerator = participant?.isActive && MODERATOR_ROLES.includes(participant?.role);

    if (room.hostId !== userId && !isAdmin && !isModerator) {
      return errorResponse(res, 'Only the host or moderator can edit this room', 403);
    }

    // Moderators can only change chat/reaction/comment settings — not title, privacy, etc.
    if (isModerator && room.hostId !== userId && !isAdmin) {
      const allowed = ['commentsEnabled', 'slowMode', 'messageType', 'reactionsEnabled'];
      const requestedKeys = Object.keys(req.body);
      const forbidden = requestedKeys.filter(k => !allowed.includes(k));
      if (forbidden.length > 0) {
        return errorResponse(res, 'Moderators can only change chat and reaction settings', 403);
      }
    }

    // If coverImageUrl is explicitly set to null, delete the old file
    if (coverImageUrl === null && room.coverImageUrl) {
      try {
        const { deleteFile } = require('../utils/storage');
        await deleteFile(room.coverImageUrl);
      } catch {}
    }

    const updated = await prisma.voiceRoom.update({
      where: { id: roomId },
      data: {
        ...(title          !== undefined && { title: title.trim() }),
        ...(description    !== undefined && { description: description.trim() || null }),
        ...(topic          !== undefined && { topic: topic.trim() || null }),
        ...(privacy        !== undefined && { privacy }),
        ...(coverEmoji     !== undefined && { coverEmoji }),
        ...(coverImageUrl  !== undefined && { coverImageUrl: coverImageUrl || null }),
        ...(commentsEnabled !== undefined && { commentsEnabled }),
        ...(slowMode        !== undefined && { slowMode }),
        ...(messageType     !== undefined && { messageType }),
        ...(reactionsEnabled !== undefined && { reactionsEnabled }),
        updatedAt: new Date()
      },
      include: {
        host: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        participants: {
          where: { isActive: true },
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
        },
        _count: { select: { participants: { where: { isActive: true } } } }
      }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      const payload = {
        roomId,
        title:           updated.title,
        description:     updated.description,
        topic:           updated.topic,
        privacy:         updated.privacy,
        coverEmoji:      updated.coverEmoji,
        coverImageUrl:   updated.coverImageUrl,
        commentsEnabled: updated.commentsEnabled,
        slowMode:        updated.slowMode,
        messageType:     updated.messageType,
        reactionsEnabled: updated.reactionsEnabled,
      };
      io.to(`voice:${roomId}`).emit('voice:room_updated', payload);
      if (updated.schoolId) {
        io.to(`school:${updated.schoolId}`).emit('voice:room_updated', payload);
      }
    }

    return successResponse(res, updated, 'Room updated');
  } catch (error) { next(error); }
}

// --- DELETE ROOM --------------------------------------------------------------
async function deleteRoom(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;

    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room || room.deletedAt) return errorResponse(res, 'Room not found', 404);

    // NF-6 FIX: Only host or SUPER_ADMIN can delete a voice room.
    const isAdmin = req.user.role === 'SUPER_ADMIN';
    if (room.hostId !== userId && !isAdmin) {
      return errorResponse(res, 'Only the host can delete this room', 403);
    }

    // Kick all active participants first and notify them
    if (room.status === STATUS.LIVE || room.status === STATUS.IDLE) {
      await prisma.voiceParticipant.updateMany({
        where: { roomId, isActive: true },
        data: { isActive: false, leftAt: new Date() }
      });
      const io = getIo();
      if (io) {
        // Tell people inside the room they're being kicked
        io.to(`voice:${roomId}`).emit('voice:room_ended', { roomId });
        // Tell the lobby to remove the card
        if (room.schoolId) {
          io.to(`school:${room.schoolId}`).emit('voice:room_deleted', { roomId });
        }
      }
    }

    // Soft delete
    await prisma.voiceRoom.update({
      where: { id: roomId },
      data: { deletedAt: new Date(), status: STATUS.ENDED, updatedAt: new Date() }
    });

    await safeDeleteCache(roomCacheKey(roomId));
    try { await clearQueue(roomId); } catch (err) { logger.warn(`[voice] clearQueue failed: ${err.message}`); }

    return successResponse(res, null, 'Room deleted');
  } catch (error) { next(error); }
}

// --- NOTIFY FOLLOWERS: VOICE_ROOM_LIVE ----------------------------------------
/**
 * Queues a VOICE_ROOM_LIVE push notification for every follower of the host.
 * Runs fire-and-forget — never called awaited in the hot path.
 *
 * Strategy: batch in 100s to avoid one gigantic DB query for hosts with many
 * followers. queueBulkNotifications hands each off to the BullMQ worker which
 * handles FCM + in-app delivery.
 *
 * @param {{ hostId, title, coverEmoji, schoolId }} liveRoom
 * @param {string} roomId
 */
async function _notifyFollowersVoiceLive(liveRoom, roomId) {
  const BATCH = 100;
  let skip = 0;

  // Fetch the host's display name once
  const host = await prisma.user.findUnique({
    where:  { id: liveRoom.hostId },
    select: { firstName: true, lastName: true },
  });
  const hostName = host
    ? `${host.firstName} ${host.lastName}`.trim()
    : 'Someone';

  const emoji   = liveRoom.coverEmoji || '🎙️';
  const title   = `${emoji} ${hostName} is live!`;
  const body    = liveRoom.title
    ? `"${liveRoom.title}" — join the Voice Club now`
    : 'Join the Voice Club now';

  // Page through followers so we don't load thousands into memory at once
  while (true) {
    const followers = await prisma.follow.findMany({
      where:   { followingId: liveRoom.hostId },
      select:  { followerId: true },
      skip,
      take:    BATCH,
    });

    if (followers.length === 0) break;

    const notifications = followers.map(f => ({
      userId: f.followerId,
      type:   'VOICE_ROOM_LIVE',
      title,
      body,
      data:   { roomId, hostId: liveRoom.hostId },
    }));

    // Non-throwing — worker logs its own failures
    await queueBulkNotifications(notifications).catch(err =>
      logger.warn(`[voice] queueBulkNotifications batch skip=${skip} failed: ${err.message}`)
    );

    skip += BATCH;
    if (followers.length < BATCH) break; // last page
  }
}

// --- EXPORTS ------------------------------------------------------------------
module.exports = {
  listRooms,
  getRoom,
  searchRooms,
  createRoom,
  joinRoom,
  leaveRoom,
  endRoom,
  toggleMute,
  raiseHand,
  promoteParticipant,
  kickParticipant,
  getMessages,
  sendMessage,
  getHandQueue,
  toggleOpenMic,
  toggleMicLock,
  grabMic,
  updateRoom,
  deleteRoom,
  getMyRooms,
  dropMic,
  uploadRoomCover,
};
