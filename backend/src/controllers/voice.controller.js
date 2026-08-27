const { v4: uuidv4 } = require('uuid');
const path    = require('path');
const prisma  = require('../utils/prisma');
const { setCache, getCache, deleteCache, isRedisReady } = require('../utils/redis');
const { saveFile, deleteFile } = require('../utils/storage');

// ── Audit helper — fire-and-forget, never throws ──────────────────────────────
async function voiceAudit(actorId, action, entityId, meta = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        id:       uuidv4(),
        userId:   actorId,
        action:   'UPDATE',
        entity:   'VoiceRoom',
        entityId,
        newValues: { action, ...meta },
      }
    });
  } catch { /* non-fatal */ }
}
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
    // Voice Club is a global Social feature — all rooms have schoolId = null
    // and are visible to every authenticated user. No school-based filtering.
    const schoolId = null;
    const { skip, ...pagination } = getPagination(page, limit);

    // BE-008: Try list cache first
    const listKey = roomListCacheKey(schoolId, status, privacy, pagination.page, pagination.limit);
    try {
      const cached = await getCache(listKey);
      if (cached) {
        return res.json(cached);
      }
    } catch { /* cache miss — fall through to DB */ }

    // All rooms are global (schoolId = null). Every authenticated user sees them all.
    // PRIVATE/INVITE_ONLY rooms are shown in the list; join is gated separately.
    // PERMANENT ROOMS: include IDLE (offline/sleeping) rooms — they can be rejoined.
    // Only ENDED (archived/soft-deleted) rooms are excluded from the lobby.
    const where = {
      deletedAt: null,
      schoolId:  null,   // Voice Club rooms are always global
      status:    status  ? status  : { not: STATUS.ENDED },
      ...(privacy  && { privacy }),
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
// SA-FIX-07: PRIVATE and INVITE_ONLY rooms require active participation.
// Removed SUPER_ADMIN bypass — platform admins have no implicit right to read
// private room participant lists. They must join the room like any other user.
// PUBLIC rooms remain readable by any authenticated user.
async function getRoom(req, res, next) {
  try {
    const { id } = req.params;
    const room = await getRoomWithParticipants(id);
    if (!room) return errorResponse(res, 'Room not found', 404);

    // Privacy check for non-public rooms
    if (room.privacy === 'PRIVATE' || room.privacy === 'INVITE_ONLY') {
      const isHost = room.hostId === req.user.id;
      if (!isHost) {
        const participant = await prisma.voiceParticipant.findUnique({
          where: { roomId_userId: { roomId: id, userId: req.user.id } }
        });
        if (!participant || !participant.isActive) {
          return errorResponse(res, 'You do not have access to this room', 403);
        }
      }
    }

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
    // Voice Club is a global Social feature — rooms are NOT school-scoped.
    // schoolId is always null so rooms are visible to ALL users regardless of
    // school membership. Removing the school resolution that was incorrectly
    // tagging rooms to the creator's school and hiding them from other schools.
    const schoolId = null;

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

    // Only transition to LIVE immediately if this is not a future scheduled room.
    // A room with scheduledAt in the future should stay SCHEDULED until that time arrives.
    const isFutureScheduled = scheduledAt && new Date(scheduledAt) > new Date();
    if (!isFutureScheduled) {
      await syncRoomStatus(roomId, schoolId);
    }
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
      // Broadcast to all lobby watchers (voice:lobby covers ALL users including
      // MEMBER users with no school). Also send to school room for school-scoped users.
      io.to('voice:lobby').emit('voice:room_created', updatedRoom);
      if (schoolId) {
        io.to(`school:${schoolId}`).emit('voice:room_created', updatedRoom);
      }
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
    // PERMANENT ROOMS: Only ENDED (archived by platform admin) rooms cannot be joined.
    // IDLE rooms are fully joinable — that's the whole point of permanent rooms.
    if (room.status === STATUS.ENDED) return errorResponse(res, 'This room has been archived and is no longer available', 400);
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
    if ((room.privacy === 'PRIVATE' || room.privacy === 'INVITE_ONLY') && room.hostId !== userId) {
      // Check if they are already an ACTIVE member (invited/approved)
      const memberRecord = await prisma.voiceRoomMember.findUnique({
        where: { roomId_userId: { roomId, userId } },
        select: { status: true, isBanned: true }
      });
      if (!memberRecord || memberRecord.status !== 'ACTIVE') {
        const msg = room.privacy === 'PRIVATE'
          ? 'This is a private room'
          : 'This is an invite-only room — you need an invite to join';
        return errorResponse(res, msg, 403);
      }
    }

    // ── P0-1 FIX: Check room-level ban (DB-authoritative) ─────────────────
    // VoiceRoomMember.isBanned is the persistent ban record.
    // A banned user must not be able to rejoin even after being kicked.
    // Host is always exempt from ban checks (they own the room).
    if (room.hostId !== userId) {
      const banRecord = await prisma.voiceRoomMember.findUnique({
        where: { roomId_userId: { roomId, userId } },
        select: { isBanned: true }
      });
      if (banRecord?.isBanned) {
        return errorResponse(res, 'You are banned from this room', 403);
      }
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
      // VC-GAP-004 FIX: Use socketsJoin() for multi-tab/multi-server join.
      // Works across all nodes via Redis adapter.
      io.in(`user:${userId}`).socketsJoin(`voice:${roomId}`);
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
      // VC-GAP-004 FIX: Use socketsLeave() for multi-tab/multi-server eviction.
      io.in(`user:${userId}`).socketsLeave(`voice:${roomId}`);
    }

    // Update feed live card participant count
    const remaining = await countActive(roomId);
    broadcastLiveUpdate('voice_room', roomId, remaining);

    // PERMANENT ROOM LIFECYCLE (Option A):
    // All HALQA voice rooms are permanent. When the HOST leaves and no
    // participants remain, the room transitions to IDLE (not ENDED).
    // IDLE rooms are fully joinable — syncRoomStatus() will transition
    // IDLE → LIVE when the next participant joins.
    //
    // The 5-minute grace period is preserved to handle temporary network
    // disconnects before sleeping the room. If someone rejoins during the
    // grace period, the room stays LIVE normally.
    //
    // Explicit endRoom() is the ONLY path to status=ENDED (terminal).
    if (participant.role === VOICE_ROLES.HOST && remaining === 0) {
      const AUTO_SLEEP_GRACE_MS = 5 * 60 * 1000; // 5 minutes
      setTimeout(async () => {
        try {
          const liveRoom = await prisma.voiceRoom.findUnique({
            where: { id: roomId },
            select: { status: true }
          });
          // Only sleep if still LIVE (i.e. not already explicitly ended by endRoom)
          if (!liveRoom || liveRoom.status !== STATUS.LIVE) return;
          const stillActive = await countActive(roomId);
          if (stillActive > 0) return; // someone rejoined during grace period

          // Transition LIVE → IDLE (permanent room sleep — NOT terminal)
          // Do NOT set endedAt. Do NOT mark status=ENDED.
          await prisma.voiceRoom.update({
            where: { id: roomId },
            data:  { status: STATUS.IDLE, lastActivityAt: new Date(), updatedAt: new Date() }
          });
          try { await require('../utils/voiceQueue').clearQueue(roomId); } catch {}
          await invalidateRoomCache(roomId, null);

          const io2 = getIo();
          if (io2) io2.to(`voice:${roomId}`).emit('voice:status_changed', { roomId, status: STATUS.IDLE, reason: 'empty_room_sleep' });
          broadcastLiveEnd('voice_room', roomId);
          logger.info(`[voice] Room ${roomId} transitioned LIVE → IDLE (permanent room, 0 participants)`);
        } catch (sleepErr) {
          logger.warn(`[voice] Room sleep transition failed for ${roomId}: ${sleepErr.message}`);
        }
      }, AUTO_SLEEP_GRACE_MS);
    }

    // ── L-8 FIX: Track voice listening time in DailyUserStats ──────────────
    // Every user who spends time in a voice room earns voiceMinutes — not just
    // the host. The participant's joinedAt records when they entered; leftAt is
    // now (set above). Fire-and-forget so leave response is never delayed.
    const listenMinutes = Math.round(
      (Date.now() - new Date(participant.joinedAt).getTime()) / 60_000
    );
    if (listenMinutes > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      prisma.dailyUserStats.upsert({
        where:  { userId_date: { userId, date: today } },
        create: {
          userId, date: today,
          loginCount: 0, postsCreated: 0, commentsCreated: 0,
          likesGiven: 0, likesReceived: 0, messagesSent: 0,
          voiceMinutes: listenMinutes,
          giftsSent: 0, giftsReceived: 0, coinsSpent: 0, coinsEarned: 0,
        },
        update: { voiceMinutes: { increment: listenMinutes } },
      }).catch(err =>
        logger.warn(`[voice] voiceMinutes upsert failed for ${userId}: ${err.message}`)
      );
    }

    return successResponse(res, null, 'Left room');
  } catch (error) { next(error); }
}

// --- END ROOM -----------------------------------------------------------------
// PERMANENT ROOMS: This endpoint terminates a room (status=ENDED, terminal state).
// Per the permanent-room contract, regular users including the room HOST must
// NOT be able to terminate their own room — they can only LEAVE (room → IDLE).
// Only SUPER_ADMIN (platform admin) can archive a room for policy/moderation reasons.
// The host uses DELETE /voice/:id to soft-delete their room instead.
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
    if (room.status === STATUS.ENDED) return errorResponse(res, 'Room already archived', 400);

    // PERMANENT ROOM CONTRACT: Only SUPER_ADMIN can set status=ENDED.
    // Regular hosts/owners cannot terminate rooms — they leave and the room stays IDLE.
    // This prevents accidental or intentional permanent destruction of community spaces.
    if (req.user.role !== 'SUPER_ADMIN') {
      return errorResponse(
        res,
        'Rooms are permanent. Use the Leave button to step out — the room stays available for members to rejoin. Only platform admins can archive rooms.',
        403
      );
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

    // ── L-8 FIX: Track voiceMinutes for ALL active participants on room end ──
    // When the host ends the room, all participants who are still in (isActive was
    // true before updateMany above) get voiceMinutes credited. Each participant's
    // join time is stored in joinedAt. Fire-and-forget — never blocks the response.
    try {
      const activeParticipants = await prisma.voiceParticipant.findMany({
        where: { roomId, leftAt: endedAt }, // these were just set inactive above
        select: { userId: true, joinedAt: true }
      });
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      for (const p of activeParticipants) {
        const mins = Math.round(
          (endedAt.getTime() - new Date(p.joinedAt).getTime()) / 60_000
        );
        if (mins <= 0) continue;
        prisma.dailyUserStats.upsert({
          where:  { userId_date: { userId: p.userId, date: today } },
          create: {
            userId: p.userId, date: today,
            loginCount: 0, postsCreated: 0, commentsCreated: 0,
            likesGiven: 0, likesReceived: 0, messagesSent: 0,
            voiceMinutes: mins,
            giftsSent: 0, giftsReceived: 0, coinsSpent: 0, coinsEarned: 0,
          },
          update: { voiceMinutes: { increment: mins } },
        }).catch(() => {}); // fire-and-forget
      }
    } catch { /* non-fatal */ }

    try { await clearQueue(roomId); } catch (err) { logger.warn(`[voice] clearQueue failed: ${err.message}`); }
    await invalidateRoomCache(roomId, schoolId);

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:room_ended', { roomId });
    }

    // Remove live card from feed
    broadcastLiveEnd('voice_room', roomId);

    voiceAudit(userId, 'ROOM_ENDED', roomId, { durationMinutes });
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

    // If muting/unmuting someone else, caller must be HOST or MODERATOR
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

    // P1-3 FIX: HOST cannot be muted by MODERATOR.
    // Only the HOST themselves may toggle their own mute state.
    if (subjectId !== callerId && participant.role === VOICE_ROLES.HOST) {
      return errorResponse(res, 'The host cannot be muted by a moderator', 403);
    }

    // P1-2 FIX: Prevent self-unmute bypass after moderator mute.
    // If the participant was muted by a moderator (mutedByModerator=true),
    // only a HOST or MODERATOR can clear it. The participant themselves
    // cannot call PATCH /mute { isMuted: false } to bypass the lock.
    if (
      subjectId === callerId &&          // self-action
      newMuted === false &&              // trying to unmute
      participant.mutedByModerator       // was mod-locked
    ) {
      // Check if the caller is actually a HOST or MODERATOR in this room
      // (they could be calling on themselves — HOST always allowed to unmute self)
      if (!MODERATOR_ROLES.includes(participant.role)) {
        return errorResponse(res, 'You were muted by a moderator and cannot unmute yourself', 403);
      }
    }

    // Determine mutedByModerator state for the DB write
    let mutedByModeratorValue;
    if (subjectId !== callerId) {
      // Moderator action: set flag when muting, clear when unmuting
      mutedByModeratorValue = newMuted ? true : false;
    } else {
      // Self-action by HOST/MODERATOR clearing their own mod-mute: clear the flag
      mutedByModeratorValue = newMuted ? participant.mutedByModerator : false;
    }

    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId, userId: subjectId } },
      data: {
        isMuted:          newMuted,
        mutedByModerator: mutedByModeratorValue,
      }
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
// --- RAISE HAND (legacy endpoint — now delegates to FIFO queue) ---------------
// P1-1 FIX: Previously this only updated DB handRaised flag without enqueuing
// in Redis FIFO queue, creating state split between DB and queue. Now it fully
// delegates to the queue system for consistency.
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

    // Delegate to the queue controller
    const { raiseHand: queueRaiseHand, cancelHand } = require('./voice-queue.controller');

    // raised === false or undefined toggle: if currently raised → lower, else → raise
    const shouldRaise = raised !== undefined ? raised : !participant.handRaised;

    if (shouldRaise) {
      return queueRaiseHand(req, res, next);
    } else {
      return cancelHand(req, res, next);
    }
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

    // P2-1 FIX: micLocked prevents promoting new speakers via direct promote.
    // Only applies when promoting TO SPEAKER — demoting to AUDIENCE always allowed.
    // P2-3 FIX: Wrap in transaction with role re-check to prevent concurrent
    // double-promote race condition (same fix applied to _promoteUser in queue).
    if (role === VOICE_ROLES.SPEAKER) {
      const room = await prisma.voiceRoom.findUnique({
        where: { id: roomId },
        select: { micLocked: true, maxSpeakers: true }
      });
      if (room?.micLocked) {
        return errorResponse(res, 'The mic is locked — unlock to promote speakers', 403);
      }
      const speakerCount = await prisma.voiceParticipant.count({
        where: { roomId, isActive: true, role: { in: ['HOST', 'MODERATOR', 'SPEAKER'] } }
      });
      if (speakerCount >= (room?.maxSpeakers || 10)) {
        return errorResponse(res, 'Speaker limit reached', 400);
      }
    }

    // P2-3: Use transaction to re-check current role before updating,
    // preventing two concurrent promotes from both succeeding.
    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.voiceParticipant.findUnique({
          where: { roomId_userId: { roomId, userId: targetUserId } },
          select: { role: true, isActive: true }
        });
        if (!current?.isActive) {
          const err = new Error('Participant is no longer in the room');
          err.statusCode = 400;
          throw err;
        }
        // Prevent double-promote: if already SPEAKER and trying to set SPEAKER again
        if (role === VOICE_ROLES.SPEAKER && current.role === VOICE_ROLES.SPEAKER) {
          const err = new Error('Participant is already a speaker');
          err.statusCode = 409;
          throw err;
        }
        await tx.voiceParticipant.update({
          where: { roomId_userId: { roomId, userId: targetUserId } },
          data: {
            role,
            isMuted:          role === VOICE_ROLES.AUDIENCE,
            mutedByModerator: false, // clear any mod-mute lock on promote/demote
            handRaised:       false,
            handRaisedAt:     null,
          }
        });
      });
    } catch (txErr) {
      if (txErr.statusCode) return errorResponse(res, txErr.message, txErr.statusCode);
      throw txErr;
    }

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:role_changed', { roomId, userId: targetUserId, role });
      io.to(`user:${targetUserId}`).emit('voice:your_role_changed', { roomId, role });
    }

    voiceAudit(requesterId, 'PARTICIPANT_PROMOTED', roomId, { targetUserId, role });
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

    // Remove from speaker queue
    try { await require('../utils/voiceQueue').dequeue(roomId, targetUserId); } catch {}

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:kicked', { roomId, userId: targetUserId });
      io.to(`user:${targetUserId}`).emit('voice:kicked', { roomId });
      // VC-GAP-004 FIX: Use socketsLeave() instead of fetchSockets().forEach(s.leave())
      // socketsLeave() works across ALL connected nodes via the Redis adapter, ensuring
      // multi-tab and multi-server eviction. fetchSockets() only returns sockets in the
      // current process — missing other tabs on different server instances.
      io.in(`user:${targetUserId}`).socketsLeave(`voice:${roomId}`);
    }

    // Audit log
    voiceAudit(requesterId, 'PARTICIPANT_KICKED', roomId, { targetUserId });

    return successResponse(res, null, 'Participant removed');
  } catch (error) { next(error); }
}

// --- BAN PARTICIPANT ----------------------------------------------------------
// Kicks the user, writes VoiceRoomMember.isBanned = true (DB-persistent),
// and evicts their socket. Banned users cannot rejoin — enforced in joinRoom.
async function banParticipant(req, res, next) {
  try {
    const { id: roomId, userId: targetUserId } = req.params;
    const { reason = '' } = req.body;
    const requesterId = req.user.id;

    const requester = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: requesterId } }
    });

    if (!requester || !requester.isActive || !MODERATOR_ROLES.includes(requester.role)) {
      return errorResponse(res, 'Only hosts and moderators can ban participants', 403);
    }

    // Cannot ban the host
    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room) return errorResponse(res, 'Room not found', 404);
    if (targetUserId === room.hostId) {
      return errorResponse(res, 'Cannot ban the host', 403);
    }

    // Moderators cannot ban other moderators
    const targetParticipant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } }
    });
    if (targetParticipant?.role === VOICE_ROLES.MODERATOR && requester.role !== VOICE_ROLES.HOST) {
      return errorResponse(res, 'Only the host can ban moderators', 403);
    }

    // Atomic: mark participant inactive + write persistent ban
    await prisma.$transaction(async (tx) => {
      // Deactivate participant if they're in the room
      if (targetParticipant?.isActive) {
        await tx.voiceParticipant.update({
          where: { roomId_userId: { roomId, userId: targetUserId } },
          data: { isActive: false, leftAt: new Date() }
        });
      }

      // Write or update persistent ban record
      await tx.voiceRoomMember.upsert({
        where: { roomId_userId: { roomId, userId: targetUserId } },
        create: {
          id:          require('crypto').randomUUID(),
          roomId,
          userId:      targetUserId,
          role:        'MEMBER',
          status:      'ACTIVE',
          isBanned:    true,
          joinedAt:    new Date(),
          note:        reason || null,
        },
        update: {
          isBanned: true,
          note:     reason || null,
        }
      });
    });

    // Remove from speaker queue
    try { await require('../utils/voiceQueue').dequeue(roomId, targetUserId); } catch {}

    await safeDeleteCache(roomCacheKey(roomId));

    logger.info(`[voice] User ${targetUserId} banned from room ${roomId} by ${requesterId}. Reason: ${reason}`);

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:banned', { roomId, userId: targetUserId });
      io.to(`user:${targetUserId}`).emit('voice:banned', { roomId, reason });
      // VC-GAP-004 FIX: Use socketsLeave() for multi-tab/multi-server eviction
      io.in(`user:${targetUserId}`).socketsLeave(`voice:${roomId}`);
    }

    // Audit log
    voiceAudit(requesterId, 'PARTICIPANT_BANNED', roomId, { targetUserId, reason });

    return successResponse(res, null, 'Participant banned from room');
  } catch (error) { next(error); }
}

// --- UNBAN PARTICIPANT --------------------------------------------------------
// Removes the persistent ban so the user can rejoin.
async function unbanParticipant(req, res, next) {
  try {
    const { id: roomId, userId: targetUserId } = req.params;
    const requesterId = req.user.id;

    const requester = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: requesterId } }
    });
    // SA-FIX-04: Must be active host or moderator in the room.
    // SUPER_ADMIN has no room-level unban privilege — they are platform admin only.
    // Removing a host's ban decision requires being an active HOST or MODERATOR.
    if (!requester?.isActive || !MODERATOR_ROLES.includes(requester.role)) {
      return errorResponse(res, 'Only hosts and moderators can unban participants', 403);
    }

    const banRecord = await prisma.voiceRoomMember.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      select: { isBanned: true }
    });
    if (!banRecord?.isBanned) {
      return errorResponse(res, 'User is not banned from this room', 404);
    }

    await prisma.voiceRoomMember.update({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      data: { isBanned: false, note: null }
    });

    logger.info(`[voice] User ${targetUserId} unbanned from room ${roomId} by ${requesterId}`);
    voiceAudit(requesterId, 'PARTICIPANT_UNBANNED', roomId, { targetUserId });
    return successResponse(res, null, 'Participant unbanned');
  } catch (error) { next(error); }
}

// --- GET MESSAGES -------------------------------------------------------------
// SEC-HIGH-002 / SA-FIX-08: Apply the same privacy guard as getRoom — PRIVATE and
// INVITE_ONLY rooms must not expose message history to non-participants.
// Removed SUPER_ADMIN bypass — platform admins must join a room to read its messages.
async function getMessages(req, res, next) {
  try {
    const { id: roomId } = req.params;

    // Privacy check — must happen before reading message data
    const room = await prisma.voiceRoom.findUnique({
      where: { id: roomId },
      select: { privacy: true, hostId: true }
    });
    if (!room) return errorResponse(res, 'Room not found', 404);

    if (room.privacy === 'PRIVATE' || room.privacy === 'INVITE_ONLY') {
      const isHost = room.hostId === req.user.id;
      if (!isHost) {
        const participant = await prisma.voiceParticipant.findUnique({
          where: { roomId_userId: { roomId, userId: req.user.id } }
        });
        if (!participant || !participant.isActive) {
          return errorResponse(res, 'You do not have access to this room', 403);
        }
      }
    }

    const { limit = 50, before } = req.query;

    const where = { roomId, deletedAt: null };
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

    // P0-1 FIX: Enforce micLocked at the backend.
    // The frontend also blocks this client-side, but any direct API call bypassed it.
    // micLocked means the host has frozen the stage — no new speakers allowed
    // via any path (grab mic, queue raise, approve, promote, mic-pass).
    // HOST/MODERATOR are exempt — they can always speak regardless of the lock.
    if (room.micLocked) {
      return errorResponse(res, 'The mic is locked — no new speakers can join the stage', 403);
    }

    // P2-2 FIX: Enforce isOpenMic at the backend.
    // When isOpenMic=false, audience cannot instantly grab the mic — they must
    // raise their hand and be approved by the host/moderator through the queue.
    // When isOpenMic=true, instant grab is allowed (host has opened the stage).
    if (!room.isOpenMic) {
      // Redirect: enqueue them via the raiseHand queue path instead
      const { raiseHand: queueRaiseHand } = require('./voice-queue.controller');
      return queueRaiseHand(req, res, next);
    }

    // SEAT LOCK: Check if the next available speaker slot is individually locked.
    // Seat index = number of current active speakers (the new speaker fills that slot).
    const activeSpeakerCount = await prisma.voiceParticipant.count({
      where: { roomId, isActive: true, role: { in: ['HOST', 'MODERATOR', 'SPEAKER'] } }
    });
    const lockedSeatsArr = Array.isArray(room.lockedSeats) ? room.lockedSeats : [];
    if (lockedSeatsArr.includes(activeSpeakerCount)) {
      return errorResponse(res, `Seat ${activeSpeakerCount + 1} is locked by the host`, 403);
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

    // SA-FIX-06: Only the room host can update the cover image.
    // SUPER_ADMIN has no privilege to change another room's visual identity.
    if (room.hostId !== userId) {
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
      // Broadcast to all lobby watchers — covers schoolId=null MEMBER users
      io.to('voice:lobby').emit('voice:room_updated', payload);
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

// --- GET SCHEDULED ROOMS (P2-4) -----------------------------------------------
// Returns upcoming scheduled rooms, globally and for the user's school.
async function getScheduledRooms(req, res, next) {
  try {
    const { limit = 20 } = req.query;
    const take = Math.min(50, parseInt(limit));

    let schoolWhere;
    if (req.user.role === 'SUPER_ADMIN') {
      schoolWhere = {};
    } else if (req.user.schoolId) {
      schoolWhere = { OR: [{ schoolId: null }, { schoolId: req.user.schoolId }] };
    } else {
      schoolWhere = { schoolId: null };
    }

    const rooms = await prisma.voiceRoom.findMany({
      where: {
        status:     STATUS.SCHEDULED,
        deletedAt:  null,
        scheduledAt: { gt: new Date() },
        ...schoolWhere,
      },
      include: {
        host: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        _count: { select: { participants: true } }
      },
      orderBy: { scheduledAt: 'asc' },
      take,
    });

    return successResponse(res, rooms);
  } catch (error) { next(error); }
}

// --- TOGGLE INDIVIDUAL SEAT LOCK -----------------------------------------------
// HOST/MOD can lock/unlock a specific speaker seat by its 0-based index.
// Locked seats show a 🔒 icon and cannot be occupied by audience members.
// If a speaker is already occupying the seat when it is locked, they keep it
// until they leave — but the slot cannot be re-filled once freed.
async function toggleSeatLock(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const { seatIndex } = req.body;
    const callerId = req.user.id;

    if (seatIndex === undefined || typeof seatIndex !== 'number' || seatIndex < 0) {
      return errorResponse(res, 'seatIndex must be a non-negative integer', 400);
    }

    // Must be HOST or MODERATOR
    const caller = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: callerId } }
    });
    if (!caller || !caller.isActive || !MODERATOR_ROLES.includes(caller.role)) {
      return errorResponse(res, 'Only hosts and moderators can lock seats', 403);
    }

    const room = await prisma.voiceRoom.findUnique({
      where: { id: roomId },
      select: { id: true, lockedSeats: true, maxSpeakers: true }
    });
    if (!room) return errorResponse(res, 'Room not found', 404);
    if (seatIndex >= (room.maxSpeakers || 10)) {
      return errorResponse(res, `Seat index out of range (max ${room.maxSpeakers || 10} seats)`, 400);
    }

    // Parse current locked seats array (stored as JSON)
    let locked = Array.isArray(room.lockedSeats) ? [...room.lockedSeats] : [];
    const isCurrentlyLocked = locked.includes(seatIndex);
    let action;

    if (isCurrentlyLocked) {
      // Unlock: remove the seat index
      locked = locked.filter(s => s !== seatIndex);
      action = 'unlocked';
    } else {
      // Lock: add the seat index
      locked.push(seatIndex);
      action = 'locked';
    }

    await prisma.voiceRoom.update({
      where: { id: roomId },
      data: { lockedSeats: locked, updatedAt: new Date() }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:seat_lock_changed', {
        roomId,
        seatIndex,
        locked: !isCurrentlyLocked,
        lockedSeats: locked,
        changedBy: callerId,
      });
    }

    voiceAudit(callerId, isCurrentlyLocked ? 'SEAT_UNLOCKED' : 'SEAT_LOCKED', roomId, { seatIndex });
    return successResponse(res, { seatIndex, locked: !isCurrentlyLocked, lockedSeats: locked },
      `Seat ${seatIndex + 1} ${action}`);
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
    // PERMANENT ROOMS: IDLE rooms are fully editable — only hard-archived rooms (ENDED) cannot be edited.
    if (room.status === STATUS.ENDED) return errorResponse(res, 'This room has been archived and cannot be edited', 400);

    // SA-FIX-02: Only host or active room moderator can edit room settings.
    // SUPER_ADMIN is platform-admin only — no room-edit privileges without being a participant.
    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });
    const isModerator = participant?.isActive && MODERATOR_ROLES.includes(participant?.role);

    if (room.hostId !== userId && !isModerator) {
      return errorResponse(res, 'Only the host or moderator can edit this room', 403);
    }

    // Moderators can only change chat/reaction/comment settings — not title, privacy, etc.
    if (isModerator && room.hostId !== userId) {
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
      // Broadcast to all lobby watchers — covers schoolId=null MEMBER users
      io.to('voice:lobby').emit('voice:room_updated', payload);
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

    // SA-FIX-03: Only the room host can delete their own room.
    // SUPER_ADMIN uses PATCH /:id/end (endRoom) for platform-level archival — that
    // endpoint is explicitly scoped, audited, and emits the correct terminal state.
    if (room.hostId !== userId) {
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
        // Tell ALL lobby watchers to remove the card (voice:lobby covers schoolId=null users)
        io.to('voice:lobby').emit('voice:room_deleted', { roomId });
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

// --- DELETE MESSAGE (host/mod only) ------------------------------------------
async function deleteMessage(req, res, next) {
  try {
    const { id: roomId, msgId } = req.params;
    const userId = req.user.id;

    // Check caller is host or moderator in the room
    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });
    // SA-FIX-05: SUPER_ADMIN has no room-level message deletion privilege.
    // Allow: active HOST or MODERATOR in the room, OR the message author.
    if (!participant?.isActive || !MODERATOR_ROLES.includes(participant.role)) {
      // Also allow the message author to delete their own message
      const msg = await prisma.voiceMessage.findUnique({ where: { id: msgId }, select: { userId: true } });
      if (!msg || msg.userId !== userId) {
        return errorResponse(res, 'Only hosts, moderators, or the author can delete messages', 403);
      }
    }

    const message = await prisma.voiceMessage.findUnique({
      where: { id: msgId },
      select: { id: true, roomId: true, deletedAt: true }
    });
    if (!message || message.roomId !== roomId) {
      return errorResponse(res, 'Message not found', 404);
    }
    if (message.deletedAt) {
      return errorResponse(res, 'Message already deleted', 400);
    }

    await prisma.voiceMessage.update({
      where: { id: msgId },
      data: { deletedAt: new Date() }
    });

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:message_deleted', { roomId, msgId, deletedBy: userId });
    }

    return successResponse(res, null, 'Message deleted');
  } catch (error) { next(error); }
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
  banParticipant,
  unbanParticipant,
  getMessages,
  sendMessage,
  getHandQueue,
  toggleOpenMic,
  toggleMicLock,
  grabMic,
  updateRoom,
  deleteRoom,
  getMyRooms,
  getScheduledRooms,
  dropMic,
  uploadRoomCover,
  toggleSeatLock,
  deleteMessage,
};
