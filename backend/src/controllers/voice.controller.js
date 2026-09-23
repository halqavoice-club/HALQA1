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
  // Try cache first — on Redis error, fall through to DB
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

  // Augment participants with seatNumber via raw SQL
  // (Prisma client may not be regenerated with the new column yet)
  if (room?.participants?.length > 0) {
    try {
      const rows = await prisma.$queryRaw`
        SELECT userId, seatNumber FROM voice_participants
        WHERE roomId = ${roomId} AND isActive = 1
      `;
      const seatMap = {};
      rows.forEach(r => { seatMap[r.userId] = r.seatNumber != null ? Number(r.seatNumber) : null; });
      room.participants.forEach(p => {
        p.seatNumber = seatMap[p.userId] ?? null;
      });
    } catch {
      // Non-fatal: seatNumber defaults to null if query fails
      room.participants.forEach(p => { p.seatNumber = p.seatNumber ?? null; });
    }
  }

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
      coverEmoji = '🎙️', maxSpeakers = 12, scheduledAt
    } = req.body;
    const hostId  = req.user.id;
    // Voice Club is a global Social feature — rooms are NOT school-scoped.
    // schoolId is always null so rooms are visible to ALL users regardless of
    // school membership. Removing the school resolution that was incorrectly
    // tagging rooms to the creator's school and hiding them from other schools.
    const schoolId = null;

    // BUG FIX: wrap room + host participant creation in a transaction
    // so we never end up with a room that has no host participant
    // HOST-AUDIENCE: host starts in AUDIENCE role (muted). They can take
    // Seat 1 at any time via grabMic, which bypasses all locks for HOST/MOD.
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
          isMuted:  true,   // HOST starts muted in audience — takes Seat 1 when ready
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


    // ── ONE-ROOM-AT-A-TIME ENFORCEMENT — REJECT, DON'T AUTO-EVICT ────────────
    // Product rule: a user can only ACTIVELY PARTICIPATE in one Voice Club room.
    // If they are already active in a DIFFERENT room:
    //   → REJECT the new join with HTTP 409 VOICE_ROOM_ALREADY_ACTIVE
    //   → Include the active room's metadata so the UI can show the user
    //     WHICH room they are currently in (title, emoji, topic).
    //   → Leave the existing Room A completely UNTOUCHED (no eviction, no kick,
    //     no seat clear, no role change, no Socket.IO leave, no queue dequeue)
    // If they are rejoining the SAME room → allow (handled below as reconnect).
    // Queue presence (handRaised) does NOT count as active participation.
    // Permanent VoiceRoomMember membership is NOT checked here.
    //
    // PHASE 6 — ATOMICITY / RACE CONDITION PREVENTION:
    // The check-then-act (findMany → create/update) is wrapped in a serializable
    // DB transaction via raw SQL advisory lock on the userId. This prevents the
    // race condition where two concurrent join requests for the same user could
    // both pass the isActive check and both succeed, creating two active sessions.
    //
    // MySQL GET_LOCK() acquires a named advisory lock (scoped to connection).
    // The lock name is deterministic per user: voice_join_{userId}.
    // Lock timeout: 5 seconds — if another request holds the lock, this one waits
    // up to 5s then fails with a clear error rather than creating a race.
    {
      const lockName = `voice_join_${userId}`;
      const lockResult = await prisma.$queryRaw`SELECT GET_LOCK(${lockName}, 5) AS acquired`;
      const lockAcquired = lockResult?.[0]?.acquired === 1;
      if (!lockAcquired) {
        return errorResponse(res, 'Another join request is already in progress. Please try again.', 429);
      }

      try {
        const otherActiveRooms = await prisma.voiceParticipant.findMany({
          where: {
            userId,
            isActive: true,
            roomId: { not: roomId },  // different room only
          },
          include: {
            room: {
              select: { id: true, title: true, coverEmoji: true, topic: true, status: true }
            }
          }
        });
        if (otherActiveRooms.length > 0) {
          const activeRoom = otherActiveRooms[0].room;
          await prisma.$queryRaw`SELECT RELEASE_LOCK(${lockName})`;
          return errorResponse(
            res,
            `You are already in an active Voice Club session. Leave that room before joining another.`,
            409,
            {
              code:            'VOICE_ROOM_ALREADY_ACTIVE',
              activeRoomId:    activeRoom.id,
              activeRoomTitle: activeRoom.title,
              activeRoomEmoji: activeRoom.coverEmoji ?? '🎙️',
              activeRoomTopic: activeRoom.topic ?? null,
            }
          );
        }
      } catch (lockErr) {
        // Release lock and re-throw so next(error) handles it
        await prisma.$queryRaw`SELECT RELEASE_LOCK(${lockName})`.catch(() => {});
        throw lockErr;
      }

      // Lock is held — the join will proceed below.
      // We release it after the participant upsert completes.
      // Store the lock name so we can release it in the finally block.
      req._voiceJoinLockName = lockName;
    }
    // Upsert participant - re-join if previously left
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
          isMuted:     true,
          handRaised:  false,
          handRaisedAt: null,
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
        }
      });
      // Clear seatNumber on re-join — they are in audience until they grab a seat
      await prisma.$executeRaw`
        UPDATE voice_participants SET seatNumber = NULL
        WHERE roomId = ${roomId} AND userId = ${userId}
      `.catch(() => {});
    } else {
      // Determine role: host gets HOST, everyone else gets AUDIENCE
      const role = room.hostId === userId ? VOICE_ROLES.HOST : VOICE_ROLES.AUDIENCE;
      participant = await prisma.voiceParticipant.create({
        data: {
          id:       uuidv4(),
          roomId,
          userId,
          role,
          // HOST starts muted — they can take Seat 1 whenever ready
          isMuted:  true,
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

    // Phase 6: Release the advisory lock now that the participant record is committed.
    if (req._voiceJoinLockName) {
      await prisma.$queryRaw`SELECT RELEASE_LOCK(${req._voiceJoinLockName})`.catch(() => {});
    }

    return successResponse(res, updatedRoom, 'Joined room');
  } catch (error) {
    // Release advisory lock on any error path to prevent lock leaks
    if (req._voiceJoinLockName) {
      const prismaInstance = require('../utils/prisma');
      await prismaInstance.$queryRaw`SELECT RELEASE_LOCK(${req._voiceJoinLockName})`.catch(() => {});
    }
    next(error);
  }
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
        // Clear seatNumber atomically with isActive=false so that
        // seat-count queries never see a stale occupied seat after leave.
        seatNumber:  null,
      }
    });

    // Remove from FIFO queue if they were waiting to speak
    try {
      const { dequeue: dq } = require('../utils/voiceQueue');
      await dq(roomId, userId);
    } catch {}

    // If they were on stage (unmuted speaker/moderator) or host, auto-promote next from queue
    const wasOnStage = !participant.isMuted && (
      participant.role === VOICE_ROLES.SPEAKER ||
      participant.role === VOICE_ROLES.MODERATOR ||
      participant.role === VOICE_ROLES.HOST
    );
    if (wasOnStage) {
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
        roomId, userId: subjectId, isMuted: newMuted, mutedByModerator: mutedByModeratorValue
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
      // Full stage check: use seatNumber IS NOT NULL as the authoritative count.
      // Role-based counting (SPEAKER + unmuted HOST/MOD) can disagree with actual
      // occupied seats when a participant's role and seatNumber updates race each other.
      const speakerCountForPromote = await prisma.$queryRaw`
        SELECT COUNT(*) as cnt FROM voice_participants
        WHERE roomId = ${roomId} AND isActive = 1 AND seatNumber IS NOT NULL
      `.then(rows => Number(rows[0]?.cnt ?? 0));
      if (speakerCountForPromote >= (room?.maxSpeakers || 12)) {
        return errorResponse(res, 'All seats are full', 400);
      }
    }

    // PHASE 3 FIX: Wrap promote-to-SPEAKER in a transaction with a role re-check
    // inside the transaction to prevent the TOCTOU race where two simultaneous
    // calls both pass the count check and both succeed.
    let assignedSeatNumber = null;
    try {
      await prisma.$transaction(async (tx) => {
        // Re-read target role inside transaction — serialization point
        const current = await tx.voiceParticipant.findUnique({
          where: { roomId_userId: { roomId, userId: targetUserId } },
          select: { role: true, isActive: true }
        });
        if (!current?.isActive) {
          const err = new Error('Participant is no longer in the room');
          err.statusCode = 400; throw err;
        }
        if (role === VOICE_ROLES.SPEAKER) {
          // SEAT 1 RULE: Normal users promoted to SPEAKER must never become Seat 1.
          // canOccupySeat1 is false for SPEAKER role — they go into Seats 2–12.
          // This is enforced at layout level (computeStageLayout) but we also
          // confirm the promotion target role is SPEAKER, never HOST/MODERATOR.
          if (current.role === VOICE_ROLES.HOST || current.role === VOICE_ROLES.MODERATOR) {
            // HOST/MOD being "promoted" stays at their privileged role — no-op or error
            const err = new Error(`User is already ${current.role} — cannot promote to SPEAKER`);
            err.statusCode = 409; throw err;
          }
          if (current.role === VOICE_ROLES.SPEAKER) {
            const err = new Error('User is already a speaker');
            err.statusCode = 409; throw err;
          }
          // Re-check capacity inside the transaction using seatNumber IS NOT NULL (authoritative)
          const stageCnt = await tx.$queryRaw`
            SELECT COUNT(*) as cnt FROM voice_participants
            WHERE roomId = ${roomId} AND isActive = 1 AND seatNumber IS NOT NULL
          `.then(rows => Number(rows[0]?.cnt ?? 0));
          const maxSpk = (await tx.voiceRoom.findUnique({ where: { id: roomId }, select: { maxSpeakers: true } }))?.maxSpeakers || 12;
          if (stageCnt >= maxSpk) {
            const err = new Error('All seats are full');
            err.statusCode = 400; throw err;
          }
          // Find lowest available seat for the promoted SPEAKER
          const occupied = await tx.$queryRaw`
            SELECT seatNumber FROM voice_participants
            WHERE roomId = ${roomId} AND isActive = 1 AND seatNumber IS NOT NULL
          `;
          const occupiedSet = new Set(occupied.map(r => Number(r.seatNumber)));
          let seat = null;
          for (let s = 2; s <= maxSpk; s++) { // SPEAKER starts at Seat 2
            if (!occupiedSet.has(s)) { seat = s; break; }
          }
          if (seat === null) {
            const err = new Error('All seats are full'); err.statusCode = 400; throw err;
          }
          // Capture the assigned seat INSIDE the transaction so the broadcast always has it
          assignedSeatNumber = seat;
          await tx.$executeRaw`
            UPDATE voice_participants
            SET seatNumber = ${seat}, role = 'SPEAKER', isMuted = 0,
                handRaised = 0, handRaisedAt = NULL, updatedAt = NOW()
            WHERE roomId = ${roomId} AND userId = ${targetUserId}
          `;
        } else {
          // Demoting to AUDIENCE — always allowed, releases seat
          await tx.$executeRaw`
            UPDATE voice_participants
            SET seatNumber = NULL, role = 'AUDIENCE', isMuted = 1,
                handRaised = 0, handRaisedAt = NULL, updatedAt = NOW()
            WHERE roomId = ${roomId} AND userId = ${targetUserId}
          `;
        }
      });
    } catch (txErr) {
      if (txErr.statusCode === 409 && (
        txErr.message === 'User is already a speaker' ||
        txErr.message.includes('already') && txErr.message.includes('stage')
      )) {
        // User is already on stage — clean up any stale queue entry and return success.
        // This happens when auto-promote fires between the host's stage-full check and this call.
        const { dequeue: dqClean, getQueue: gqClean } = require('../utils/voiceQueue');
        const { isRedisReady: irr } = require('../utils/redis');
        try {
          if (irr()) await dqClean(roomId, targetUserId).catch(() => {});
          await prisma.voiceParticipant.update({
            where: { roomId_userId: { roomId, userId: targetUserId } },
            data: { handRaised: false, handRaisedAt: null, updatedAt: new Date() }
          }).catch(() => {});
          await safeDeleteCache(roomCacheKey(roomId));
        } catch { /* non-fatal */ }
        const io = getIo();
        if (io) {
          io.to(`voice:${roomId}`).emit('voice:hand_raised', { roomId, userId: targetUserId, raised: false });
          let q = [];
          try { if (irr()) q = await gqClean(roomId); } catch {}
          io.to(`voice:${roomId}`).emit('voice:queue_updated', { roomId, queue: q, queueLength: q.length });
        }
        return successResponse(res, {
          userId: targetUserId,
          role: VOICE_ROLES.SPEAKER,
          name: `${target.user.firstName} ${target.user.lastName}`,
          alreadyOnStage: true
        }, `${target.user.firstName} is already on stage`);
      }
      if (txErr.statusCode) return errorResponse(res, txErr.message, txErr.statusCode);
      throw txErr;
    }

    await safeDeleteCache(roomCacheKey(roomId));

    // assignedSeatNumber was captured inside the transaction — always reliable.
    // No need for a separate post-transaction DB read.

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:role_changed', {
        roomId, userId: targetUserId, role,
        ...(assignedSeatNumber != null && { seatNumber: assignedSeatNumber })
      });
      io.to(`user:${targetUserId}`).emit('voice:your_role_changed', {
        roomId,
        userId: targetUserId,   // always include userId so mobile onRoleChanged can find the participant
        role,
        ...(assignedSeatNumber != null && { seatNumber: assignedSeatNumber })
      });
      if (role === VOICE_ROLES.AUDIENCE) {
        // Auto-promote next queued user if a slot was freed
        try { await autoPromoteNext(roomId, io); } catch {}
      }

      // Authoritative stage snapshot — clients reconcile from this after any
      // promotion to prevent stale seat positions on slow connections.
      if (role === VOICE_ROLES.SPEAKER && assignedSeatNumber != null) {
        try {
          const stageRows = await prisma.$queryRaw`
            SELECT vp.userId, vp.role, vp.isMuted, vp.seatNumber, vp.isPinned,
                   vp.handRaised, vp.mutedByModerator, vp.joinedAt
            FROM voice_participants vp
            WHERE vp.roomId = ${roomId} AND vp.isActive = 1 AND vp.seatNumber IS NOT NULL
            ORDER BY vp.seatNumber ASC
          `;
          io.to(`voice:${roomId}`).emit('voice:stage_state', {
            roomId,
            stageParticipants: stageRows.map(r => ({
              ...r,
              seatNumber: Number(r.seatNumber),
              isMuted: Boolean(r.isMuted),
              isPinned: Boolean(r.isPinned),
              handRaised: Boolean(r.handRaised),
              mutedByModerator: Boolean(r.mutedByModerator),
            })),
            stageCount: stageRows.length,
          });
        } catch { /* non-fatal */ }
      }
    }

    // Remove from queue if they were in it (e.g. direct promotion bypassing FIFO)
    if (role === VOICE_ROLES.SPEAKER) {
      try {
        const { dequeue: dq, getQueue } = require('../utils/voiceQueue');
        await dq(roomId, targetUserId);
        // Broadcast updated queue so waiting list refreshes on all clients
        const { isRedisReady } = require('../utils/redis');
        if (io) {
          let q = [];
          if (isRedisReady()) {
            try { q = await getQueue(roomId); } catch { /* ignore */ }
          }
          io.to(`voice:${roomId}`).emit('voice:queue_updated', {
            roomId, queue: q, queueLength: q.length
          });
        }
      } catch { /* non-fatal — Redis may be unavailable */ }
    }

    return successResponse(res, {
      userId: targetUserId,
      role,
      name: `${target.user.firstName} ${target.user.lastName}`
    }, `${target.user.firstName} moved to ${role.toLowerCase()}`);
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
      where: { roomId_userId: { roomId, userId: targetUserId } },
      include: { user: { select: { firstName: true, lastName: true } } }
    });
    if (!target || !target.isActive) return errorResponse(res, 'User is not in this room', 404);
    if (target.role === VOICE_ROLES.HOST) return errorResponse(res, 'Cannot kick the host', 403);
    if (target.role === VOICE_ROLES.MODERATOR && requester.role !== VOICE_ROLES.HOST) {
      return errorResponse(res, 'Only the host can kick a moderator', 403);
    }

    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      data: { isActive: false, leftAt: new Date(), handRaised: false, handRaisedAt: null }
    });
    // Clear seatNumber on kick
    prisma.$executeRaw`UPDATE voice_participants SET seatNumber = NULL WHERE roomId = ${roomId} AND userId = ${targetUserId}`.catch(() => {});
    try {
      const { dequeue: dq } = require('../utils/voiceQueue');
      await dq(roomId, targetUserId);
    } catch {}

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`user:${targetUserId}`).emit('voice:kicked', { roomId });
      io.to(`voice:${roomId}`).emit('voice:user_left', { roomId, userId: targetUserId });
      io.in(`user:${targetUserId}`).socketsLeave(`voice:${roomId}`);
      // If kicked user was on stage, auto-promote next
      if (!target.isMuted && MODERATOR_ROLES.includes(target.role) || target.role === VOICE_ROLES.SPEAKER) {
        try { await autoPromoteNext(roomId, io); } catch {}
      }
    }

    voiceAudit(requesterId, 'PARTICIPANT_KICKED', roomId, { targetUserId });
    return successResponse(res, null, `${target.user.firstName} removed from room`);
  } catch (error) { next(error); }
}

// --- BAN PARTICIPANT ----------------------------------------------------------
async function banParticipant(req, res, next) {
  try {
    const { id: roomId, userId: targetUserId } = req.params;
    const requesterId = req.user.id;
    const { reason } = req.body;

    const requester = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: requesterId } }
    });
    if (!requester || !requester.isActive || !MODERATOR_ROLES.includes(requester.role)) {
      return errorResponse(res, 'Only hosts and moderators can ban participants', 403);
    }

    const target = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      include: { user: { select: { firstName: true, lastName: true } } }
    });
    if (!target) return errorResponse(res, 'User not found in this room', 404);
    if (target.role === VOICE_ROLES.HOST) return errorResponse(res, 'Cannot ban the host', 403);
    if (target.role === VOICE_ROLES.MODERATOR && requester.role !== VOICE_ROLES.HOST) {
      return errorResponse(res, 'Only the host can ban a moderator', 403);
    }

    // Mark participant inactive + persistent ban record
    await prisma.$transaction([
      prisma.voiceParticipant.update({
        where: { roomId_userId: { roomId, userId: targetUserId } },
        data: { isActive: false, leftAt: new Date(), handRaised: false, handRaisedAt: null }
      }),
      prisma.voiceRoomMember.upsert({
        where: { roomId_userId: { roomId, userId: targetUserId } },
        create: {
          id: require('crypto').randomUUID(),
          roomId, userId: targetUserId,
          role: 'MEMBER', status: 'ACTIVE',
          memberLevel: 1, isBanned: true, joinedAt: new Date()
        },
        update: { isBanned: true }
      })
    ]);

    // Remove from queue
    try {
      const { dequeue: dq } = require('../utils/voiceQueue');
      await dq(roomId, targetUserId);
    } catch {}

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`user:${targetUserId}`).emit('voice:banned', { roomId, reason });
      io.to(`voice:${roomId}`).emit('voice:banned', { roomId, userId: targetUserId });
      io.in(`user:${targetUserId}`).socketsLeave(`voice:${roomId}`);
    }

    voiceAudit(requesterId, 'PARTICIPANT_BANNED', roomId, { targetUserId, reason });
    return successResponse(res, null, `${target.user.firstName} banned from room`);
  } catch (error) { next(error); }
}

// --- UNBAN PARTICIPANT --------------------------------------------------------
async function unbanParticipant(req, res, next) {
  try {
    const { id: roomId, userId: targetUserId } = req.params;
    const requesterId = req.user.id;

    const requester = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: requesterId } }
    });
    if (!requester || !requester.isActive || !MODERATOR_ROLES.includes(requester.role)) {
      return errorResponse(res, 'Only hosts and moderators can unban participants', 403);
    }

    await prisma.voiceRoomMember.updateMany({
      where: { roomId, userId: targetUserId },
      data: { isBanned: false }
    });

    await safeDeleteCache(roomCacheKey(roomId));
    voiceAudit(requesterId, 'PARTICIPANT_UNBANNED', roomId, { targetUserId });
    return successResponse(res, null, 'User unbanned');
  } catch (error) { next(error); }
}

// --- GET MESSAGES -------------------------------------------------------------
async function getMessages(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const { before, limit = 50 } = req.query;
    const take = Math.min(100, parseInt(limit));
    const userId = req.user.id;

    // SA-FIX-08: Privacy check — PRIVATE/INVITE_ONLY rooms require active participation
    const room = await prisma.voiceRoom.findUnique({
      where: { id: roomId },
      select: { privacy: true, hostId: true, deletedAt: true }
    });
    if (!room || room.deletedAt) return errorResponse(res, 'Room not found', 404);

    if (room.privacy === 'PRIVATE' || room.privacy === 'INVITE_ONLY') {
      const isHost = room.hostId === userId;
      if (!isHost) {
        const participant = await prisma.voiceParticipant.findUnique({
          where: { roomId_userId: { roomId, userId } }
        });
        if (!participant || !participant.isActive) {
          return errorResponse(res, 'You must be an active participant to read messages in this room', 403);
        }
      }
    }

    const where = {
      roomId,
      deletedAt: null,
      ...(before && { createdAt: { lt: new Date(before) } })
    };

    const messages = await prisma.voiceMessage.findMany({
      where,
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
      take
    });

    return successResponse(res, messages.reverse());
  } catch (error) { next(error); }
}

// --- SEND MESSAGE -------------------------------------------------------------
async function sendMessage(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;
    const { body } = req.body;

    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId }, select: { status: true, deletedAt: true, commentsEnabled: true, slowMode: true, messageType: true } });
    if (!room || room.deletedAt) return errorResponse(res, 'Room not found', 404);
    if (room.status === 'ENDED') return errorResponse(res, 'Room has ended', 400);
    if (!room.commentsEnabled) return errorResponse(res, 'Chat is disabled in this room', 403);

    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });
    if (!participant || !participant.isActive) return errorResponse(res, 'You are not in this room', 403);

    const msg = await prisma.voiceMessage.create({
      data: {
        id: uuidv4(),
        roomId, userId,
        body: body.trim(),
      },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
    });

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:message', { roomId, message: msg });
    }

    return successResponse(res, msg, 'Message sent', 201);
  } catch (error) { next(error); }
}

// --- DELETE MESSAGE -----------------------------------------------------------
async function deleteMessage(req, res, next) {
  try {
    const { id: roomId, msgId } = req.params;
    const userId = req.user.id;

    const msg = await prisma.voiceMessage.findUnique({ where: { id: msgId } });
    if (!msg || msg.deletedAt) return errorResponse(res, 'Message not found', 404);

    // Author or HOST/MOD can delete
    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });
    const isAuthor = msg.userId === userId;
    const isMod = participant && participant.isActive && MODERATOR_ROLES.includes(participant.role);
    if (!isAuthor && !isMod) return errorResponse(res, 'Not authorized to delete this message', 403);

    await prisma.voiceMessage.update({
      where: { id: msgId },
      data: { deletedAt: new Date() }
    });

    const io = getIo();
    if (io) io.to(`voice:${roomId}`).emit('voice:message_deleted', { roomId, msgId });

    return successResponse(res, null, 'Message deleted');
  } catch (error) { next(error); }
}

// --- GET HAND QUEUE (legacy) -------------------------------------------------
async function getHandQueue(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const queue = await prisma.voiceParticipant.findMany({
      where: { roomId, isActive: true, handRaised: true },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
      orderBy: { handRaisedAt: 'asc' }
    });
    return successResponse(res, queue);
  } catch (error) { next(error); }
}

// --- TOGGLE OPEN MIC ---------------------------------------------------------
// PHASE 8: Authorization is by ROLE only — stage position is irrelevant.
// HOST/MOD in audience can still toggle open-mic.
async function toggleOpenMic(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;
    // Note: checkVoiceRole middleware already verified HOST/MOD before this runs
    const { enabled } = req.body;

    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId }, select: { isOpenMic: true } });
    if (!room) return errorResponse(res, 'Room not found', 404);

    const newState = enabled !== undefined ? Boolean(enabled) : !room.isOpenMic;
    await prisma.voiceRoom.update({
      where: { id: roomId },
      data: { isOpenMic: newState, updatedAt: new Date() }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:open_mic_changed', {
        roomId, isOpenMic: newState, changedBy: userId
      });
    }

    return successResponse(res, { isOpenMic: newState });
  } catch (error) { next(error); }
}

// --- TOGGLE MIC LOCK ---------------------------------------------------------
// PHASE 8: Authorization is by ROLE only — stage position is irrelevant.
async function toggleMicLock(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;
    const { locked } = req.body;

    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId }, select: { micLocked: true } });
    if (!room) return errorResponse(res, 'Room not found', 404);

    const newState = locked !== undefined ? Boolean(locked) : !room.micLocked;
    await prisma.voiceRoom.update({
      where: { id: roomId },
      data: { micLocked: newState, updatedAt: new Date() }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:mic_lock_changed', {
        roomId, micLocked: newState, changedBy: userId
      });
    }

    return successResponse(res, { micLocked: newState });
  } catch (error) { next(error); }
}

// --- TOGGLE SEAT LOCK --------------------------------------------------------
// PHASE 7 FIX: Authorization enforced server-side — only HOST/MOD.
// The route was missing checkVoiceRole middleware; this function enforces it.
async function toggleSeatLock(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;
    const { seatIndex } = req.body;

    // PHASE 7: Server-side authorization — role check mandatory
    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });
    if (!participant || !participant.isActive) {
      return errorResponse(res, 'You are not an active participant in this room', 403);
    }
    if (!MODERATOR_ROLES.includes(participant.role)) {
      return errorResponse(res, 'Only hosts and moderators can lock/unlock seats', 403);
    }

    const room = await prisma.voiceRoom.findUnique({
      where: { id: roomId },
      select: { lockedSeats: true }
    });
    if (!room) return errorResponse(res, 'Room not found', 404);

    const currentLocked = Array.isArray(room.lockedSeats) ? room.lockedSeats : [];
    let newLocked;
    const idx = currentLocked.indexOf(seatIndex);
    let locked;
    if (idx >= 0) {
      // Already locked — unlock it
      newLocked = currentLocked.filter(s => s !== seatIndex);
      locked = false;
    } else {
      // Not locked — lock it
      newLocked = [...currentLocked, seatIndex].sort((a, b) => a - b);
      locked = true;
    }

    await prisma.voiceRoom.update({
      where: { id: roomId },
      data: { lockedSeats: newLocked, updatedAt: new Date() }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:seat_lock_changed', {
        roomId, seatIndex, locked, lockedSeats: newLocked, changedBy: userId
      });
    }

    return successResponse(res, { seatIndex, locked, lockedSeats: newLocked });
  } catch (error) { next(error); }
}

// --- GRAB MIC ----------------------------------------------------------------
// AUTHORITATIVE SEAT ASSIGNMENT:
//   seatNumber is now the single source of truth for a participant's stage seat.
//   grabMic assigns a seatNumber atomically; clients render directly from it.
//
// HOST RULES:
//   - HOST can grab any available seat (lowest available, prefers Seat 1 if free)
//   - HOST MUST WAIT when stage is full — no automatic eviction of any participant
//   - When stage is full, HOST is placed in the queue like everyone else
//
// MODERATOR RULES:
//   - MOD follows the same queue rules as normal users when open-mic is OFF
//   - When open-mic is ON, MOD can grab any available seat (lowest available)
//   - MOD does NOT automatically get Seat 1 — they get the lowest free seat
//   - To get Seat 1, MOD must: drop current seat → request Seat 1 explicitly
//     (future: add a dedicated "claim seat 1" endpoint; for now MOD drops + re-grabs)
//
// SEAT STABILITY:
//   No participant is auto-moved or evicted when another joins.
//   Seats remain where they are until explicitly changed.
async function grabMic(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;
    const { findAvailableSeat, assignSeat, countOnStage } = require('../utils/voiceSeat');

    // ── 1. Validate room ──────────────────────────────────────────────────
    const room = await prisma.voiceRoom.findUnique({
      where: { id: roomId },
      select: { status: true, deletedAt: true, isOpenMic: true, micLocked: true, maxSpeakers: true, hostId: true }
    });
    if (!room || room.deletedAt) return errorResponse(res, 'Room not found', 404);
    if (room.status === 'ENDED') return errorResponse(res, 'This room has been archived', 400);

    // ── 2. Validate participant ───────────────────────────────────────────
    const rawParticipant = await prisma.$queryRaw`
      SELECT id, roomId, userId, role, isMuted, mutedByModerator,
             handRaised, handRaisedAt, seatNumber, isPinned, isActive
      FROM voice_participants
      WHERE roomId = ${roomId} AND userId = ${userId}
      LIMIT 1
    `;
    const participant = rawParticipant[0] ?? null;
    if (!participant || !participant.isActive) {
      return errorResponse(res, 'You are not in this room', 400);
    }

    // Convert MySQL tinyint booleans
    participant.isMuted   = Boolean(participant.isMuted);
    participant.handRaised = Boolean(participant.handRaised);
    participant.isActive  = Boolean(participant.isActive);

    const isPrivileged = MODERATOR_ROLES.includes(participant.role); // HOST or MOD
    const isHost = participant.role === VOICE_ROLES.HOST;

    // ── 3. Check micLocked ────────────────────────────────────────────────
    if (room.micLocked && !isPrivileged) {
      return errorResponse(res, 'The mic is locked — no new speakers can join the stage', 403);
    }

    // ── 4. Already on stage? (has a seatNumber) ────────────────────────────
    if (participant.seatNumber != null) {
      return successResponse(res, {
        role: participant.role,
        isMuted: participant.isMuted,
        seatNumber: Number(participant.seatNumber)
      }, 'Already on stage');
    }

    // ── 5. Open-mic OFF path (non-HOST participants must queue) ────────────
    if (!isHost && !room.isOpenMic) {
      if (participant.handRaised) {
        return successResponse(res, { queued: true, role: participant.role }, 'Already in the queue');
      }
      // Enqueue the user
      const { enqueue: enq } = require('../utils/voiceQueue');
      const { isRedisReady } = require('../utils/redis');
      let position = 1;
      if (isRedisReady()) {
        try {
          position = await enq(roomId, {
            id: userId,
            firstName: req.user.firstName,
            lastName:  req.user.lastName,
            avatarUrl: req.user.avatarUrl,
          });
        } catch (enqErr) {
          logger.warn(`[grabMic] Redis enqueue failed: ${enqErr.message}`);
        }
      }
      await prisma.$executeRaw`
        UPDATE voice_participants
        SET handRaised = 1, handRaisedAt = NOW(), updatedAt = NOW()
        WHERE roomId = ${roomId} AND userId = ${userId}
      `;
      await safeDeleteCache(roomCacheKey(roomId));
      const io0 = getIo();
      if (io0) {
        io0.to(`voice:${roomId}`).emit('voice:hand_raised', {
          roomId, userId, raised: true,
          firstName: req.user.firstName,
          lastName:  req.user.lastName,
          avatarUrl: req.user.avatarUrl,
          position,
        });
        io0.to(`user:${userId}`).emit('voice:queue_position', { roomId, position });
      }
      return successResponse(res, { queued: true, role: 'AUDIENCE', position }, `You are #${position} in the queue`);
    }

    // ── 6. Atomic seat assignment ──────────────────────────────────────────
    // Find an available seat BEFORE the transaction so we can fail early.
    // Seat assignment for HOST/MOD: prefers Seat 1 if available.
    // Seat assignment for SPEAKER: lowest available seat (skips Seat 1).
    const preferredSeatRole = isHost ? 'HOST' : (participant.role === 'MODERATOR' ? 'MODERATOR' : 'SPEAKER');
    const cap = room.maxSpeakers || 12;

    let assignedSeat = null;
    let updatedRole = participant.role;

    try {
      await prisma.$transaction(async (tx) => {
        // Re-read state inside transaction (TOCTOU protection)
        const [curr] = await tx.$queryRaw`
          SELECT role, isMuted, seatNumber, isActive
          FROM voice_participants
          WHERE roomId = ${roomId} AND userId = ${userId}
          LIMIT 1
        `;
        if (!curr || !curr.isActive) {
          const e = new Error('No longer in the room'); e.statusCode = 400; throw e;
        }
        if (curr.seatNumber != null) {
          // Already seated — idempotent
          assignedSeat = Number(curr.seatNumber);
          updatedRole = curr.role;
          return;
        }

        // Re-check micLocked inside tx
        const [rm] = await tx.$queryRaw`
          SELECT micLocked, maxSpeakers FROM voice_rooms WHERE id = ${roomId} LIMIT 1
        `;
        if (rm?.micLocked && !isPrivileged) {
          const e = new Error('The mic is locked'); e.statusCode = 403; throw e;
        }

        // Find lowest available seat inside transaction (authoritative)
        const occupiedRows = await tx.$queryRaw`
          SELECT seatNumber FROM voice_participants
          WHERE roomId = ${roomId} AND isActive = 1 AND seatNumber IS NOT NULL
        `;
        const occupiedSet = new Set(occupiedRows.map(r => Number(r.seatNumber)));
        const maxSp = Number(rm?.maxSpeakers ?? cap);

        // Find lowest free seat respecting Seat 1 eligibility
        let seat = null;
        for (let s = 1; s <= maxSp; s++) {
          if (occupiedSet.has(s)) continue;
          if (s === 1 && !MODERATOR_ROLES.includes(curr.role) && curr.role !== 'HOST') continue; // Seat 1 = HOST/MOD only
          seat = s;
          break;
        }

        if (seat === null) {
          // Stage is full — enqueue, even HOST must wait
          const e = new Error('STAGE_FULL'); e.statusCode = 0; throw e;
        }

        // Determine final role
        const newRole = MODERATOR_ROLES.includes(curr.role) ? curr.role : 'SPEAKER';
        updatedRole = newRole;
        assignedSeat = seat;

        // Assign seat atomically
        if (MODERATOR_ROLES.includes(curr.role)) {
          // HOST/MOD: stay same role, go on stage (unmuted)
          await tx.$executeRaw`
            UPDATE voice_participants
            SET seatNumber = ${seat}, isMuted = 0, mutedByModerator = 0,
                handRaised = 0, handRaisedAt = NULL, updatedAt = NOW()
            WHERE roomId = ${roomId} AND userId = ${userId}
          `;
        } else {
          // AUDIENCE → SPEAKER
          await tx.$executeRaw`
            UPDATE voice_participants
            SET seatNumber = ${seat}, role = 'SPEAKER', isMuted = 0, mutedByModerator = 0,
                handRaised = 0, handRaisedAt = NULL, updatedAt = NOW()
            WHERE roomId = ${roomId} AND userId = ${userId}
          `;
        }
      });
    } catch (txErr) {
      if (txErr.statusCode === 0) {
        // Stage full — enqueue
        const { enqueue: enq } = require('../utils/voiceQueue');
        const { isRedisReady } = require('../utils/redis');
        if (isRedisReady()) {
          try {
            await enq(roomId, { id: userId, firstName: req.user.firstName, lastName: req.user.lastName, avatarUrl: req.user.avatarUrl });
          } catch {}
        }
        await prisma.$executeRaw`
          UPDATE voice_participants
          SET handRaised = 1, handRaisedAt = NOW(), updatedAt = NOW()
          WHERE roomId = ${roomId} AND userId = ${userId}
        `;
        await safeDeleteCache(roomCacheKey(roomId));
        const io = getIo();
        if (io) {
          io.to(`voice:${roomId}`).emit('voice:hand_raised', {
            roomId, userId, raised: true,
            firstName: req.user.firstName, lastName: req.user.lastName, avatarUrl: req.user.avatarUrl
          });
        }
        return successResponse(res, { queued: true, role: participant.role }, 'Stage is full — you have been added to the queue');
      }
      if (txErr.statusCode) return errorResponse(res, txErr.message, txErr.statusCode);

      // SEAT RACE PROTECTION: MySQL unique constraint violation (P2002 / ER_DUP_ENTRY error code 1062)
      // means two concurrent requests tried to assign the same seatNumber.
      // The DB constraint prevented the duplicate — this user lost the race.
      // Treat it as a transient "seat taken" and enqueue them instead of returning 500.
      const isDupSeat = txErr.code === 'P2002' ||
        (txErr.message && (txErr.message.includes('Duplicate entry') || txErr.message.includes('ER_DUP_ENTRY') || txErr.message.includes('voice_participants_roomId_seatNumber_key')));
      if (isDupSeat) {
        logger.warn(`[grabMic] Seat race detected for userId=${userId} in room=${roomId} — seat was taken concurrently. Queuing user.`);
        try {
          const { enqueue: enq2 } = require('../utils/voiceQueue');
          const { isRedisReady: irr } = require('../utils/redis');
          if (irr()) await enq2(roomId, { id: userId, firstName: req.user.firstName, lastName: req.user.lastName, avatarUrl: req.user.avatarUrl }).catch(() => {});
          await prisma.$executeRaw`
            UPDATE voice_participants
            SET handRaised = 1, handRaisedAt = NOW(), updatedAt = NOW()
            WHERE roomId = ${roomId} AND userId = ${userId}
          `;
          await safeDeleteCache(roomCacheKey(roomId));
        } catch { /* non-fatal */ }
        return successResponse(res, { queued: true, role: participant.role }, 'Stage seat was just taken — added to queue');
      }

      throw txErr;
    }

    await safeDeleteCache(roomCacheKey(roomId));

    // ── 7. Broadcast ──────────────────────────────────────────────────────
    const io = getIo();
    if (io) {
      // Broadcast role + seat assignment to all room participants
      io.to(`voice:${roomId}`).emit('voice:mic_grabbed', {
        roomId, userId,
        firstName: req.user.firstName,
        lastName:  req.user.lastName,
        avatarUrl: req.user.avatarUrl,
        seatNumber: assignedSeat,
      });
      io.to(`voice:${roomId}`).emit('voice:role_changed', {
        roomId, userId, role: updatedRole, seatNumber: assignedSeat
      });
      io.to(`voice:${roomId}`).emit('voice:mute_changed', {
        roomId, userId, isMuted: false
      });

      // Authoritative stage state broadcast — clients reconcile from this
      try {
        const stageRows = await prisma.$queryRaw`
          SELECT vp.userId, vp.role, vp.isMuted, vp.seatNumber, vp.isPinned,
                 vp.handRaised, vp.mutedByModerator, vp.joinedAt
          FROM voice_participants vp
          WHERE vp.roomId = ${roomId} AND vp.isActive = 1 AND vp.seatNumber IS NOT NULL
          ORDER BY vp.seatNumber ASC
        `;
        io.to(`voice:${roomId}`).emit('voice:stage_state', {
          roomId,
          stageParticipants: stageRows.map(r => ({
            ...r,
            seatNumber: Number(r.seatNumber),
            isMuted: Boolean(r.isMuted),
            isPinned: Boolean(r.isPinned),
            handRaised: Boolean(r.handRaised),
            mutedByModerator: Boolean(r.mutedByModerator),
          })),
          stageCount: stageRows.length,
        });
      } catch (stageErr) {
        logger.warn(`[grabMic] voice:stage_state broadcast failed: ${stageErr.message}`);
      }
    }

    return successResponse(res, { role: updatedRole, isMuted: false, seatNumber: assignedSeat }, 'You are now on stage');
  } catch (error) { next(error); }
}

// --- DROP MIC ----------------------------------------------------------------
// SPEAKER or HOST/MOD voluntarily leaves the stage (releases their seatNumber).
// HOST/MOD: seatNumber=null, isMuted=true (stays in room, retains moderation authority).
// SPEAKER: seatNumber=null, role=AUDIENCE.
// A freed seat triggers autoPromoteNext to fill it from the queue.
async function dropMic(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;

    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });
    if (!participant || !participant.isActive) {
      return errorResponse(res, 'You are not in this room', 400);
    }

    const isPrivileged = MODERATOR_ROLES.includes(participant.role);
    const isSpeaker = participant.role === VOICE_ROLES.SPEAKER;

    if (!isPrivileged && !isSpeaker) {
      return errorResponse(res, 'Only speakers, hosts, and moderators can drop the mic', 400);
    }

    if (isPrivileged) {
      // HOST/MOD: release seat → go to audience, keep role
      // They retain full moderation authority while in audience.
      await prisma.$executeRaw`
        UPDATE voice_participants
        SET seatNumber = NULL, isMuted = 1, updatedAt = NOW()
        WHERE roomId = ${roomId} AND userId = ${userId}
      `;
    } else {
      // SPEAKER: release seat → demote to AUDIENCE
      await prisma.$executeRaw`
        UPDATE voice_participants
        SET seatNumber = NULL, role = 'AUDIENCE', isMuted = 1, updatedAt = NOW()
        WHERE roomId = ${roomId} AND userId = ${userId}
      `;
    }

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      // Broadcast seat release with explicit seatNumber=null
      if (!isPrivileged) {
        io.to(`voice:${roomId}`).emit('voice:role_changed', {
          roomId, userId, role: VOICE_ROLES.AUDIENCE, seatNumber: null
        });
        io.to(`user:${userId}`).emit('voice:your_role_changed', {
          roomId, userId, role: VOICE_ROLES.AUDIENCE, seatNumber: null
        });
      }
      io.to(`voice:${roomId}`).emit('voice:mute_changed', {
        roomId, userId, isMuted: true, seatNumber: null
      });
      // Auto-promote next queued user since a seat was freed
      try { await autoPromoteNext(roomId, io); } catch {}
    }

    return successResponse(res, {
      role: isPrivileged ? participant.role : VOICE_ROLES.AUDIENCE,
      isMuted: true,
      seatNumber: null,
    }, 'Mic dropped');
  } catch (error) { next(error); }
}

// --- UPDATE ROOM -------------------------------------------------------------
// SA-FIX-02: SUPER_ADMIN cannot edit room without being host/moderator participant.
// Only HOST can edit all fields. MODERATOR can only edit chat/reaction settings.
async function updateRoom(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;
    const updates = req.body;

    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room || room.deletedAt) return errorResponse(res, 'Room not found', 404);

    // SA-FIX-02: Check participant role — no SUPER_ADMIN bypass
    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });

    const isHost = room.hostId === userId && participant?.isActive;
    const isMod  = participant?.isActive && participant?.role === 'MODERATOR';

    if (!isHost && !isMod) {
      return errorResponse(res, 'Only the host or moderator can update room settings', 403);
    }

    // HOST can edit all allowed fields; MODERATOR can only edit chat/reaction settings
    const hostOnlyFields    = ['title', 'description', 'privacy', 'topic', 'coverEmoji', 'coverImageUrl'];
    const modAllowedFields  = ['commentsEnabled', 'slowMode', 'messageType', 'reactionsEnabled'];

    const data = {};
    for (const key of modAllowedFields) {
      if (updates[key] !== undefined) data[key] = updates[key];
    }
    if (isHost) {
      for (const key of hostOnlyFields) {
        if (updates[key] !== undefined) data[key] = updates[key];
      }
    } else {
      // MODERATOR trying to edit host-only field
      const attemptedHostOnly = hostOnlyFields.some(k => updates[k] !== undefined);
      if (attemptedHostOnly) {
        return errorResponse(res, 'Moderators can only edit chat and reaction settings', 403);
      }
    }

    if (Object.keys(data).length === 0) {
      return errorResponse(res, 'No valid fields to update', 400);
    }
    data.updatedAt = new Date();

    const updated = await prisma.voiceRoom.update({ where: { id: roomId }, data });
    await invalidateRoomCache(roomId, null);

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:room_updated', {
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
      });
    }

    return successResponse(res, updated, 'Room updated');
  } catch (error) { next(error); }
}

// --- DELETE ROOM (soft-delete) -----------------------------------------------
// SA-FIX-03: SUPER_ADMIN cannot delete a room they don't own.
// Only the HOST (room creator) can soft-delete their own room.
async function deleteRoom(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;

    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room || room.deletedAt) return errorResponse(res, 'Room not found', 404);
    // SA-FIX-03: Only the HOST of the room can delete it — no SUPER_ADMIN bypass
    if (room.hostId !== userId) {
      return errorResponse(res, 'Only the host can delete this room', 403);
    }

    await prisma.voiceParticipant.updateMany({
      where: { roomId, isActive: true },
      data: { isActive: false, leftAt: new Date() }
    });
    await prisma.voiceRoom.update({
      where: { id: roomId },
      data: { deletedAt: new Date(), status: STATUS.ENDED, updatedAt: new Date() }
    });

    try { await clearQueue(roomId); } catch {}
    await invalidateRoomCache(roomId, null);

    const io = getIo();
    if (io) io.to(`voice:${roomId}`).emit('voice:room_deleted', { roomId });

    broadcastLiveEnd('voice_room', roomId);
    voiceAudit(userId, 'ROOM_DELETED', roomId, {});
    return successResponse(res, null, 'Room deleted');
  } catch (error) { next(error); }
}

// --- UPLOAD ROOM COVER -------------------------------------------------------
async function uploadRoomCover(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;

    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room || room.deletedAt) return errorResponse(res, 'Room not found', 404);
    if (room.hostId !== userId) return errorResponse(res, 'Only the host can change the room cover', 403);

    if (!req.file) return errorResponse(res, 'No file uploaded', 400);

    // Build a unique filename and save to the 'covers' bucket folder
    const ext = (req.file.originalname || '').split('.').pop()?.toLowerCase() || 'jpg';
    const safeExt = ['jpg','jpeg','png','webp','gif'].includes(ext) ? ext : 'jpg';
    const filename = `${roomId}-${Date.now()}.${safeExt}`;
    const { url: filePath } = await saveFile(req.file.buffer, filename, req.file.mimetype, 'covers');

    await prisma.voiceRoom.update({
      where: { id: roomId },
      data: { coverImageUrl: filePath, updatedAt: new Date() }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:room_updated', { roomId, coverImageUrl: filePath });
    }

    return successResponse(res, { coverImageUrl: filePath }, 'Cover updated');
  } catch (error) { next(error); }
}

// --- GET MY ROOMS ------------------------------------------------------------
async function getMyRooms(req, res, next) {
  try {
    const userId = req.user.id;
    const rooms = await prisma.voiceRoom.findMany({
      where: { hostId: userId, deletedAt: null },
      include: {
        host: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        _count: { select: { participants: { where: { isActive: true } } } }
      },
      orderBy: { lastActivityAt: 'desc' },
      take: 20
    });
    return successResponse(res, rooms);
  } catch (error) { next(error); }
}

// --- GET SCHEDULED ROOMS -----------------------------------------------------
async function getScheduledRooms(req, res, next) {
  try {
    const rooms = await prisma.voiceRoom.findMany({
      where: { status: STATUS.SCHEDULED, deletedAt: null },
      include: {
        host: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        _count: { select: { participants: { where: { isActive: true } } } }
      },
      orderBy: { scheduledAt: 'asc' },
      take: 50
    });
    return successResponse(res, rooms);
  } catch (error) { next(error); }
}

// --- NOTIFY FOLLOWERS (private helper) ---------------------------------------
async function _notifyFollowersVoiceLive(room, roomId) {
  try {
    const followers = await prisma.follow.findMany({
      where: { followingId: room.hostId },
      select: { followerId: true },
      take: 500
    });
    if (followers.length === 0) return;
    await queueBulkNotifications(followers.map(f => ({
      userId:    f.followerId,
      type:      'VOICE_ROOM_LIVE',
      title:     `${room.title} is now live`,
      body:      'A host you follow started a voice room',
      data:      { roomId, type: 'voice_room_live' }
    })));
  } catch {}
}

// ─── MODULE EXPORTS ──────────────────────────────────────────────────────────
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
  deleteMessage,
  getHandQueue,
  toggleOpenMic,
  toggleMicLock,
  toggleSeatLock,
  grabMic,
  dropMic,
  updateRoom,
  deleteRoom,
  getMyRooms,
  getScheduledRooms,
  uploadRoomCover,
};