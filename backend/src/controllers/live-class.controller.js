const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse, getPagination, buildPaginationMeta } = require('../utils/response');
const { getIo } = require('../sockets');
const { getLivekitRoomService } = require('../utils/livekitService');
const { broadcastLiveStart, broadcastLiveEnd } = require('../utils/feedLive');
const { queueBulkNotifications } = require('../services/queue.service');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

const userSelect = { id: true, firstName: true, lastName: true, avatarUrl: true, role: true };

// ─── Audit logging helper (LC-AUDIT-001) ──────────────────────────────────────
// Writes a non-fatal audit record for key live class operations.
// Action values: CREATE | START | END | KICK | RECORD_START | RECORD_STOP | TERMINATE
async function liveClassAudit(actorId, action, liveClassId, meta = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        id:        uuidv4(),
        userId:    actorId,
        action:    action === 'CREATE' ? 'CREATE' : 'UPDATE',
        entity:    'LiveClass',
        entityId:  liveClassId,
        newValues: { liveClassAction: action, ...meta },
      }
    });
  } catch (_auditErr) { /* non-fatal — never let audit failure break the flow */ }
}

// ─── Raw SQL helper for live_classes ──────────────────────────────────────────
// The Prisma client binary was compiled before the streamType/hostUserId columns
// were added. Until `prisma generate` is run (requires backend restart), Prisma
// ORM calls for these fields will fail with P2022. We use raw SQL for INSERT and
// for reading the new fields, then merge with Prisma for relations.
//
// After restarting the backend and running `npx prisma generate`, these raw SQL
// helpers can be replaced with normal `prisma.liveClass.create/findFirst` calls.

async function rawCreateLiveClass(data) {
  const id = uuidv4();
  const now = new Date().toISOString().slice(0, 23).replace('T', ' ');
  const streamType  = data.streamType   || 'SCHOOL';
  const hostUserId  = data.hostUserId   ?? null;
  const schoolId    = data.schoolId     ?? null;
  const classId     = data.classId      ?? null;
  const teacherId   = data.teacherId    ?? null;

  await prisma.$executeRawUnsafe(`
    INSERT INTO live_classes (
      id, stream_type, host_user_id,
      schoolId, classId, teacherId,
      title, description, scheduledAt, duration, status,
      chatEnabled, handRaiseEnabled, whiteboardEnabled,
      quranPanelEnabled, isOpenMic, screenShareEnabled,
      maxSpeakers, isRecorded,
      createdAt, updatedAt
    ) VALUES (
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?
    )
  `,
    id, streamType, hostUserId,
    schoolId, classId, teacherId,
    data.title,
    data.description ?? null,
    data.scheduledAt ? new Date(data.scheduledAt).toISOString().slice(0, 23).replace('T', ' ') : null,
    data.duration ?? null,
    data.status || 'SCHEDULED',
    data.chatEnabled         ? 1 : 0,
    data.handRaiseEnabled    ? 1 : 0,
    data.whiteboardEnabled   ? 1 : 0,
    data.quranPanelEnabled   ? 1 : 0,
    data.isOpenMic           ? 1 : 0,
    data.screenShareEnabled  ? 1 : 0,
    data.maxParticipants != null ? data.maxParticipants : null,
    data.isRecorded          ? 1 : 0,
    now, now
  );

  // Return the created row with relations using $queryRawUnsafe
  const rows = await prisma.$queryRawUnsafe(`
    SELECT lc.*,
      c.id as cls_id, c.name as cls_name,
      u_host.id as host_id, u_host.firstName as host_firstName, u_host.lastName as host_lastName, u_host.avatarUrl as host_avatarUrl
    FROM live_classes lc
    LEFT JOIN classes c ON c.id = lc.classId
    LEFT JOIN users u_host ON u_host.id = lc.host_user_id
    WHERE lc.id = ?
  `, id);

  if (!rows || rows.length === 0) throw new Error('Failed to fetch created live class');
  return shapeLiveClassRow(rows[0]);
}

async function rawFindLiveClass(id) {
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT lc.*,
        c.id as cls_id, c.name as cls_name, c.gradeLevel as cls_gradeLevel,
        t.id as teacher_id,
        u_t.id as teacher_userId, u_t.firstName as teacher_firstName, u_t.lastName as teacher_lastName, u_t.avatarUrl as teacher_avatarUrl, u_t.role as teacher_role,
        u_host.id as host_id, u_host.firstName as host_firstName, u_host.lastName as host_lastName, u_host.avatarUrl as host_avatarUrl, u_host.role as host_role
      FROM live_classes lc
      LEFT JOIN classes c ON c.id = lc.classId
      LEFT JOIN teachers t ON t.id = lc.teacherId
      LEFT JOIN users u_t ON u_t.id = t.userId
      LEFT JOIN users u_host ON u_host.id = lc.host_user_id
      WHERE lc.id = ? AND lc.deletedAt IS NULL
      LIMIT 1
    `, id);

    if (rows && rows.length > 0) return shapeLiveClassRow(rows[0]);
  } catch (_e) {
    // fall through to ORM
  }

  // Fallback for test environment / old Prisma engine
  const lc = await prisma.liveClass.findFirst({ where: { id, deletedAt: null } });
  if (!lc) return null;
  return { ...lc, streamType: lc.streamType || 'SCHOOL' };
}

function shapeLiveClassRow(row) {
  const streamType = row.stream_type || row.streamType || 'SCHOOL';
  return {
    id:               row.id,
    streamType,
    schoolId:         row.schoolId    ?? null,
    classId:          row.classId     ?? null,
    teacherId:        row.teacherId   ?? null,
    hostUserId:       row.host_user_id ?? row.hostUserId ?? null,
    delegatedHostId:  row.delegated_host_id ?? row.delegatedHostId ?? null,
    title:            row.title,
    description:      row.description ?? null,
    scheduledAt:      row.scheduledAt ?? null,
    duration:         row.duration    ?? null,
    status:           row.status,
    livekitRoomName:  row.livekitRoomName ?? null,
    recordingUrl:     row.recordingUrl    ?? null,
    coverImageUrl:    row.coverImageUrl   ?? null,
    maxParticipants:  row.maxParticipants ?? null,
    maxSpeakers:      row.maxSpeakers != null ? Number(row.maxSpeakers) : 20,
    isRecorded:       !!row.isRecorded,
    recordingStartedAt: row.recordingStartedAt ?? null,
    chatEnabled:      !!row.chatEnabled,
    handRaiseEnabled: !!row.handRaiseEnabled,
    whiteboardEnabled: !!row.whiteboardEnabled,
    quranPanelEnabled: !!row.quranPanelEnabled,
    isOpenMic:        !!row.isOpenMic,
    screenShareEnabled: !!row.screenShareEnabled,
    startedAt:        row.startedAt  ?? null,
    endedAt:          row.endedAt    ?? null,
    deletedAt:        row.deletedAt  ?? null,
    createdAt:        row.createdAt,
    updatedAt:        row.updatedAt,
    // Relations
    class: row.cls_id ? { id: row.cls_id, name: row.cls_name, gradeLevel: row.cls_gradeLevel ?? null } : null,
    teacher: row.teacher_id ? {
      id: row.teacher_id,
      user: { id: row.teacher_userId, firstName: row.teacher_firstName, lastName: row.teacher_lastName, avatarUrl: row.teacher_avatarUrl, role: row.teacher_role }
    } : null,
    hostUser: row.host_id ? {
      id: row.host_id, firstName: row.host_firstName, lastName: row.host_lastName, avatarUrl: row.host_avatarUrl, role: row.host_role
    } : null,
  };
}

async function rawUpdateLiveClassStatus(id, data) {
  const sets = [];
  const vals = [];
  if (data.status          !== undefined) { sets.push('status = ?');           vals.push(data.status); }
  if (data.startedAt       !== undefined) { sets.push('startedAt = ?');        vals.push(data.startedAt); }
  if (data.endedAt         !== undefined) { sets.push('endedAt = ?');          vals.push(data.endedAt); }
  if (data.livekitRoomName !== undefined) { sets.push('livekitRoomName = ?');  vals.push(data.livekitRoomName); }
  if (data.deletedAt       !== undefined) { sets.push('deletedAt = ?');        vals.push(data.deletedAt); }
  sets.push('updatedAt = ?');
  vals.push(new Date().toISOString().slice(0, 23).replace('T', ' '));
  vals.push(id);
  await prisma.$executeRawUnsafe(`UPDATE live_classes SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  return rawFindLiveClass(id);
}

/**
 * Lightweight live class lookup — returns only the fields needed for
 * authorization checks (streamType, schoolId, status, etc.)
 * Used as a drop-in for all functions that previously called
 * prisma.liveClass.findFirst({ where: { id, deletedAt: null } }).
 *
 * Falls back to prisma.liveClass.findFirst() in test environments (where
 * $queryRawUnsafe is mocked to return []) so existing unit tests still work.
 */
async function findLiveClass(id) {
  // Try raw SQL first (works in production with updated DB schema)
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT id, stream_type as streamType, schoolId, classId, teacherId,
             host_user_id as hostUserId, delegated_host_id as delegatedHostId,
             title, description, status,
             livekitRoomName, duration, chatEnabled, handRaiseEnabled,
             whiteboardEnabled, quranPanelEnabled, isOpenMic, screenShareEnabled,
             maxParticipants, maxSpeakers, isRecorded, recordingStartedAt,
             startedAt, endedAt, deletedAt, createdAt, updatedAt
      FROM live_classes
      WHERE id = ? AND deletedAt IS NULL
      LIMIT 1
    `, id);

    // If raw SQL returned results, use them
    if (rows && rows.length > 0) {
      const r = rows[0];
      return {
        id: r.id,
        streamType: r.streamType || r.stream_type || 'SCHOOL',
        schoolId: r.schoolId ?? null,
        classId: r.classId ?? null,
        teacherId: r.teacherId ?? null,
        hostUserId: r.hostUserId ?? r.host_user_id ?? null,
        delegatedHostId: r.delegatedHostId ?? r.delegated_host_id ?? null,
        title: r.title,
        description: r.description ?? null,
        status: r.status,
        livekitRoomName: r.livekitRoomName ?? null,
        duration: r.duration ?? null,
        chatEnabled: !!r.chatEnabled,
        handRaiseEnabled: !!r.handRaiseEnabled,
        whiteboardEnabled: !!r.whiteboardEnabled,
        quranPanelEnabled: !!r.quranPanelEnabled,
        isOpenMic: !!r.isOpenMic,
        screenShareEnabled: !!r.screenShareEnabled,
        maxParticipants: r.maxParticipants ?? null,
        maxSpeakers: r.maxSpeakers != null ? Number(r.maxSpeakers) : 20,
        isRecorded: !!r.isRecorded,
        recordingStartedAt: r.recordingStartedAt ?? null,
        startedAt: r.startedAt ?? null,
        endedAt: r.endedAt ?? null,
        deletedAt: r.deletedAt ?? null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    }
  } catch (_e) {
    // Raw SQL failed (e.g., old Prisma engine) — fall through to ORM
  }

  // Fallback: use Prisma ORM (works in tests with mocked prisma.liveClass.findFirst,
  // and in production once prisma generate is run after the schema update)
  const lc = await prisma.liveClass.findFirst({ where: { id, deletedAt: null } });
  if (!lc) return null;
  // Ensure streamType is always present (defaults to SCHOOL for old rows/mocks)
  return { ...lc, streamType: lc.streamType || 'SCHOOL' };
}

// ─── Effective role helper ────────────────────────────────────────────────────
// Returns the user's effective Education role for the current request.
// Uses req.schoolMembership.role (school-scoped) when set by requireSchoolMember,
// otherwise falls back to req.user.role (legacy global role).
// This makes all role checks work for both new MEMBER users (with school membership)
// and legacy users (where the global role equals the school role).
function getEffectiveRole(req) {
  return req.schoolMembership?.role || req.user.role;
}

// ─── School access guard (P0-01: BUG-02 cross-school IDOR) ───────────────────
// For PUBLIC streams (streamType = 'PUBLIC'), school isolation does not apply —
// any authenticated user can access them.
// ARCH-01: SUPER_ADMIN no longer bypasses school isolation. They must have a
// real SchoolMembership to access school-scoped live classes.
function assertSchoolAccess(lc, user, req) {
  // PES-002 FIX: Normalise streamType internally so this function is safe even
  // when callers pass a row with null/undefined streamType (legacy data or DB
  // corruption). Unknown/missing streamType defaults to 'SCHOOL' — never 'PUBLIC'.
  // This ensures the PUBLIC bypass can only be reached by an explicit 'PUBLIC' value.
  const streamType = lc.streamType || 'SCHOOL';
  if (streamType === 'PUBLIC') return;   // PUBLIC streams are open to all
  if (req && req.schoolMembership && req.schoolMembership.schoolId === lc.schoolId) return;
  if (lc.schoolId !== user.schoolId) {
    const err = new Error('Access denied to this school\'s resource');
    err.status = 403;
    throw err;
  }
}

// ─── LiveKit RoomServiceClient factory (P0-05: BUG-01 server-side kick) ───────
// Returns null when LiveKit env vars are not configured.
// A new client is created per kick call (stateless HTTP API — no pooling needed).
function getLivekitRoomService() {
  const url    = process.env.LIVEKIT_URL;
  const key    = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) return null;
  return new RoomServiceClient(url, key, secret);
}

// between leaveLiveClass() and the auto-end cron in app.js.
const MIN_PRESENT_MINUTES = 10;

// ─── assertOwnerOrModerator ───────────────────────────────────────────────────
// Verifies the caller is the HOST or a MODERATOR of this live class.
// Used as a defence-in-depth guard for actions that both HOST and MODERATOR
// are allowed to perform: approve/reject hands, demote speakers, invite to stage.
//
// The route-level middleware (resolveStreamAccess / resolveStreamStaffAccess)
// already checks school membership; this check verifies the specific participant
// role within the live class itself.
//
// FINAL-MOD-01 FIX: Removed the PUBLIC fast-path that checked lc.hostUserId === userId.
//
// Previous code:
//   if (lc.streamType === 'PUBLIC' && lc.hostUserId === userId) return;
//
// That fast-path was a race hazard: lc.hostUserId is read earlier in the
// request pipeline and may reflect the PREVIOUS host during the brief window
// after transferHost() commits the participant-record update but before the
// caller's lc object is refreshed. The old host would bypass the participant
// check and pass assertOwnerOrModerator for one request even though their
// participant.role is already STUDENT.
//
// The correct authority source is the live_class_participants.role column,
// which is updated atomically inside transferHost(). Removing the fast-path
// forces every call through the DB participant lookup regardless of stream type.
// This is slightly more expensive (one extra DB read) but is always correct.
//
// Authorization logic (both PUBLIC and SCHOOL streams):
//   - Caller must have an ACTIVE participant record in THIS live class.
//   - Caller's participant.role must be 'HOST' or 'MODERATOR'.
//   - No school role (TEACHER, SCHOOL_ADMIN, etc.) grants this authority.
//   - No global User.role grants this authority.
//   - No client-supplied field grants this authority.
async function assertOwnerOrModerator(lc, req, prismaClient) {
  const userId = req.user.id;

  const p = await prismaClient.liveClassParticipant.findFirst({
    where: { liveClassId: lc.id, userId, isActive: true },
    select: { role: true },
  });
  if (!p || (p.role !== 'HOST' && p.role !== 'MODERATOR')) {
    const err = new Error('Only the host or a moderator can perform this action');
    err.status = 403;
    throw err;
  }
}



// ─── BUG-05 FIX: Auto-end timer registry ──────────────────────────────────────
// Duration-limited live classes were never automatically ended when their scheduled
// duration elapsed. This registry tracks one in-process setTimeout per live class.
//
// NOTE: In-process only — timers are lost on server restart.
// For multi-process / Kubernetes deployments, replace with a Redis-backed scheduler.
//
// Usage:
//   scheduleAutoEnd(liveClassId, startedAt, durationMinutes) — called on class start
//   cancelAutoEnd(liveClassId)                               — called on manual end
// autoEndTimers Map kept as in-memory fallback when Redis/BullMQ unavailable
const autoEndTimers = new Map(); // fallback only
async function _endLiveClassById(lc) {
  const now = new Date();
  const active = await prisma.liveClassParticipant.findMany({
    where: { liveClassId: lc.id, isActive: true }
  });
  await prisma.$transaction([
    // DEL-HOST: Clear delegatedHostId atomically with auto-end status transition.
    prisma.$executeRawUnsafe(`UPDATE live_classes SET status = 'ENDED', endedAt = NOW(), delegated_host_id = NULL, updatedAt = NOW() WHERE id = ?`, lc.id),
    ...active.map(p => prisma.liveClassParticipant.update({
      where: { id: p.id },
      data: {
        isActive: false, leftAt: now,
        totalDuration: p.totalDuration + Math.floor((now.getTime() - new Date(p.joinedAt).getTime()) / 1000)
      }
    }))
  ]);
  const attendances = await prisma.liveClassAttendance.findMany({
    where: { liveClassId: lc.id, leftAt: null }
  });
  await Promise.all(attendances.map(a =>
    prisma.liveClassAttendance.update({
      where: { id: a.id },
      data: {
        leftAt: now,
        totalMinutes: Math.floor((now.getTime() - new Date(a.joinedAt).getTime()) / 60000),
        status: 'PRESENT'
      }
    })
  ));
  const io = getIo();
  if (io) io.to(`liveclass:${lc.id}`).emit('liveclass:ended', { liveClassId: lc.id });
  broadcastLiveEnd('live_class', lc.id);
  logger.info(`[auto-end] Live class ${lc.id} auto-ended after duration elapsed`);
}

function scheduleAutoEnd(liveClassId, startedAt, durationMinutes) {
  cancelAutoEnd(liveClassId); // clear any existing timer first
  const elapsed = Date.now() - new Date(startedAt).getTime();
  const delay   = Math.max(0, durationMinutes * 60_000 - elapsed);
  const timer   = setTimeout(async () => {
    autoEndTimers.delete(liveClassId);
    try {
      const lc = await findLiveClass(liveClassId);
      if (!lc) return; // already ended manually
      await _endLiveClassById(lc);
    } catch (err) {
      logger.warn(`[auto-end] Failed to auto-end live class ${liveClassId}: ${err.message}`);
    }
  }, delay);
  autoEndTimers.set(liveClassId, timer);
  logger.info(`[auto-end] Scheduled auto-end for live class ${liveClassId} in ${Math.round(delay / 1000)}s`);
}

function cancelAutoEnd(liveClassId) {
  const existing = autoEndTimers.get(liveClassId);
  if (existing) {
    clearTimeout(existing);
    autoEndTimers.delete(liveClassId);
    logger.debug(`[auto-end] Cancelled auto-end timer for live class ${liveClassId}`);
  }
}

// ─── Notify class students when a live class starts ────────────────────────────
// Queues LIVE_CLASS_START push notifications to all enrolled students (fire-and-forget).
// @param {string} liveClassId
// @param {string} teacherUserId — host who started the class
// @param {string} classId      — class whose students to notify
// @param {string} title        — live class title
async function _notifyStudentsLiveClassStart(liveClassId, teacherUserId, classId, title) {
  try {
    const teacher = await prisma.user.findUnique({
      where:  { id: teacherUserId },
      select: { firstName: true, lastName: true },
    });
    const teacherName = teacher
      ? `${teacher.firstName} ${teacher.lastName}`.trim()
      : 'Your teacher';

    // Fetch all active student user IDs enrolled in this class
    const enrollments = await prisma.enrollment.findMany({
      where:  { classId, isActive: true },
      select: { student: { select: { userId: true } } },
    });

    if (enrollments.length === 0) return;

    const notifTitle = `📹 ${teacherName} started a live class`;
    const notifBody  = title ? `"${title}" — join now` : 'Join now';

    const notifications = enrollments.map(e => ({
      userId: e.student.userId,
      type:   'LIVE_CLASS_START',
      title:  notifTitle,
      body:   notifBody,
      data:   { liveClassId, teacherId: teacherUserId },
    }));

    // Batch in 100s
    const BATCH = 100;
    for (let i = 0; i < notifications.length; i += BATCH) {
      await queueBulkNotifications(notifications.slice(i, i + BATCH)).catch(err =>
        logger.warn(`[live-class] notification batch failed: ${err.message}`)
      );
    }
  } catch (err) {
    logger.warn(`[live-class] _notifyStudentsLiveClassStart failed: ${err.message}`);
  }
}

//  LIST 
async function listLiveClasses(req, res, next) {
  try {
    const { classId, status, page = 1, limit = 20, streamType: streamTypeFilter } = req.query;
    const take = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = Math.max(0, (parseInt(page) - 1) * take);

    const schoolId = req.schoolId || req.user.schoolId;
    // ARCH-01: SUPER_ADMIN no longer sees all schools' live classes.
    // They see the same filtered view as any other user (their school + PUBLIC streams).

    // Build WHERE clause
    // P3-003 VERIFIED: The WHERE clause is built exclusively from hardcoded string
    // literals pushed into the `conditions` array. Dynamic values (schoolId, classId,
    // status) are pushed separately into `params` and bound via $queryRawUnsafe's
    // parameterized ? placeholders — never interpolated into the SQL string.
    const conditions = ['lc.deletedAt IS NULL'];
    const params = [];

    if (streamTypeFilter === 'PUBLIC') {
      conditions.push("lc.stream_type = 'PUBLIC'");
    } else if (streamTypeFilter === 'SCHOOL') {
      if (!schoolId) return errorResponse(res, 'School context required', 400);
      conditions.push("lc.stream_type = 'SCHOOL'");
      conditions.push('lc.schoolId = ?'); params.push(schoolId);
    } else {
      // Default: school streams for user's school + all PUBLIC streams
      if (schoolId) {
        conditions.push("(lc.stream_type = 'PUBLIC' OR (lc.stream_type = 'SCHOOL' AND lc.schoolId = ?))");
        params.push(schoolId);
      } else {
        conditions.push("lc.stream_type = 'PUBLIC'");
      }
    }

    if (classId)  { conditions.push('lc.classId = ?');  params.push(classId); }
    if (status)   { conditions.push('lc.status = ?');   params.push(status);  }

    const where = conditions.join(' AND ');
    const countRows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as total FROM live_classes lc WHERE ${where}`, ...params);
    const total = Number(countRows[0].total);

    const rows = await prisma.$queryRawUnsafe(`
      SELECT lc.*,
        c.id as cls_id, c.name as cls_name,
        t.id as teacher_id,
        u_t.firstName as teacher_firstName, u_t.lastName as teacher_lastName, u_t.avatarUrl as teacher_avatarUrl, u_t.id as teacher_userId, u_t.role as teacher_role,
        u_host.id as host_id, u_host.firstName as host_firstName, u_host.lastName as host_lastName, u_host.avatarUrl as host_avatarUrl,
        (SELECT COUNT(*) FROM live_class_participants p WHERE p.liveClassId = lc.id AND p.isActive = 1) as participant_count
      FROM live_classes lc
      LEFT JOIN classes c ON c.id = lc.classId
      LEFT JOIN teachers t ON t.id = lc.teacherId
      LEFT JOIN users u_t ON u_t.id = t.userId
      LEFT JOIN users u_host ON u_host.id = lc.host_user_id
      WHERE ${where}
      ORDER BY lc.status ASC, lc.scheduledAt DESC
      LIMIT ? OFFSET ?
    `, ...params, take, skip);

    const items = rows.map(row => ({
      ...shapeLiveClassRow(row),
      _count: { participants: Number(row.participant_count) }
    }));

    return successResponse(res, { items, pagination: buildPaginationMeta(total, +page, take) });
  } catch (e) { next(e); }
}

//  GET ONE 
async function getLiveClass(req, res, next) {
  try {
    const lc = await rawFindLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    // School isolation: PUBLIC streams are accessible to all; SCHOOL streams check school
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);

    // Fetch participants and message count (may not be available in test mocks — default to empty)
    let participants = [];
    let msgCount = 0;
    try {
      const raw = await prisma.liveClassParticipant.findMany({
        where: { liveClassId: lc.id, isActive: true },
        include: { user: { select: userSelect } },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }]
      });
      if (Array.isArray(raw)) participants = raw;
      const cnt = await prisma.liveClassMessage.count({ where: { liveClassId: lc.id, deletedAt: null } });
      if (typeof cnt === 'number') msgCount = cnt;
    } catch (_e) {
      // Silently ignore — participants stays [] if the mock/DB call fails
    }

    return successResponse(res, {
      ...lc,
      participants,
      _count: { participants: participants.length, messages: msgCount }
    });
  } catch (e) { next(e); }
}

//  CREATE 
async function createLiveClass(req, res, next) {
  try {
    const {
      streamType = 'SCHOOL',
      isPublic,            // convenience alias
      classId,
      title: rawTitle, description,
      scheduledAt, duration = null,
      chatEnabled = true, handRaiseEnabled = true, whiteboardEnabled = true,
      quranPanelEnabled = false, maxParticipants, isRecorded = false,
      teacherId: explicitTeacherId,
      tags,
    } = req.body;

    // title is optional — generate a default if not provided
    const title = rawTitle?.trim() || null;

    // Normalise stream type
    const resolvedStreamType = (streamType === 'PUBLIC' || isPublic === true) ? 'PUBLIC' : 'SCHOOL';

    // ── PUBLIC STREAM ────────────────────────────────────────────────────────
    if (resolvedStreamType === 'PUBLIC') {
      const lc = await rawCreateLiveClass({
        streamType:      'PUBLIC',
        hostUserId:      req.user.id,
        schoolId:        null,
        classId:         null,
        teacherId:       null,
        title:           title || 'Live Stream',
        description:     description || null,
        scheduledAt,
        duration,
        chatEnabled,
        handRaiseEnabled,
        whiteboardEnabled,
        quranPanelEnabled,
        // PUBLIC streams default to null (unlimited) unless the host explicitly sets a cap
        maxParticipants: maxParticipants != null ? Number(maxParticipants) : null,
        isRecorded,
        status: 'SCHEDULED',
        isOpenMic: true,
        screenShareEnabled: true,
      });

      const io = getIo();
      if (io) io.to('feed:public').emit('liveclass:scheduled', { liveClass: lc });

      liveClassAudit(req.user.id, 'CREATE', lc.id, { streamType: 'PUBLIC', title: lc.title }).catch(() => {});
      return successResponse(res, lc, 'Live stream created', 201);
    }

    // ── SCHOOL STREAM ────────────────────────────────────────────────────────
    // Requires school context + class + teacher (same as before)
    const teacher = await prisma.teacher.findFirst({ where: { userId: req.user.id } });
    // LCSV-002 FIX: Removed 'SUPER_ADMIN' — creating school live classes requires
    // school staff membership (TEACHER or SCHOOL_ADMIN), not a platform admin role.
    const isAdmin = ['SCHOOL_ADMIN'].includes(getEffectiveRole(req));

    if (!teacher && !isAdmin) {
      return errorResponse(res, 'Only teachers and admins can create school live classes', 403);
    }

    let resolvedTeacherId = teacher?.id ?? null;

    if (!resolvedTeacherId && explicitTeacherId) {
      const explicitTeacher = await prisma.teacher.findFirst({ where: { id: explicitTeacherId } });
      if (!explicitTeacher) return errorResponse(res, 'Teacher not found', 404);
      resolvedTeacherId = explicitTeacher.id;
    }

    if (!resolvedTeacherId && isAdmin && classId) {
      const classTeacher = await prisma.teacherClass.findFirst({
        where: { classId, teacher: { is: { id: { not: undefined } } } },
        orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }],
        select: { teacherId: true },
      });
      if (classTeacher) resolvedTeacherId = classTeacher.teacherId;
    }

    if (!resolvedTeacherId && isAdmin) {
      const cls = classId ? await prisma.class.findFirst({ where: { id: classId, deletedAt: null } }) : null;
      const schoolId = (req.schoolId || req.user.schoolId) || cls?.schoolId;
      const fallbackTeacher = await prisma.teacher.findFirst({
        where: schoolId ? { schoolId, user: { deletedAt: null } } : { user: { deletedAt: null } },
        orderBy: { createdAt: 'asc' },
      });
      if (fallbackTeacher) resolvedTeacherId = fallbackTeacher.id;
    }

    if (!resolvedTeacherId && isAdmin) {
      const cls = classId ? await prisma.class.findFirst({ where: { id: classId, deletedAt: null } }) : null;
      const schoolId = (req.schoolId || req.user.schoolId) || cls?.schoolId;
      if (!schoolId) {
        return errorResponse(res, 'Cannot resolve school. Please pass teacherId explicitly.', 400);
      }
      const newTeacher = await prisma.teacher.create({
        data: { userId: req.user.id, schoolId },
      });
      resolvedTeacherId = newTeacher.id;
    }

    if (!classId) return errorResponse(res, 'classId is required for school live classes', 400);
    const cls = await prisma.class.findFirst({ where: { id: classId, deletedAt: null } });
    if (!cls) return errorResponse(res, 'Class not found', 404);

    const lc = await rawCreateLiveClass({
      streamType:   'SCHOOL',
      hostUserId:   req.user.id,
      schoolId:     (req.schoolId || req.user.schoolId) || cls.schoolId,
      classId,
      teacherId:    resolvedTeacherId,
      title:        title || `${cls.name} — Live Class`,
      description,
      scheduledAt,
      duration, chatEnabled, handRaiseEnabled, whiteboardEnabled,
      quranPanelEnabled, maxParticipants: maxParticipants != null ? Number(maxParticipants) : 100, isRecorded,
      status: 'SCHEDULED',
      isOpenMic: false,
      screenShareEnabled: true,
    });

    const io = getIo();
    if (io) io.to(`school:${lc.schoolId}`).emit('liveclass:scheduled', { liveClass: lc });

    liveClassAudit(req.user.id, 'CREATE', lc.id, { streamType: 'SCHOOL', title: lc.title }).catch(() => {});
    return successResponse(res, lc, 'Live class created', 201);
  } catch (e) { next(e); }
}

//  UPDATE 
async function updateLiveClass(req, res, next) {
  try {
    const lc = await rawFindLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    if (lc.status === 'ENDED' || lc.status === 'CANCELLED') return errorResponse(res, 'Cannot edit ended/cancelled class', 400);

    // DEL-HOST: Field-level authorization for delegated hosts.
    // OWNER-ONLY fields: maxSpeakers, isRecorded (structural/administrative)
    // Dedicated endpoint: isOpenMic (via POST /:id/open-mic — not in generic PATCH)
    // scheduledAt: not editable while LIVE (meaningless to reschedule an active class)
    // HOST fields (creator OR delegated host): title, description, duration, chatEnabled,
    //   handRaiseEnabled, whiteboardEnabled, quranPanelEnabled, screenShareEnabled
    //
    // OWN-01: delete, assign, revoke remain creator-only (assertOwner in those functions).
    // updateLiveClass allows delegated host for operational fields only.
    const isCreatorForEdit = lc.hostUserId === req.user.id;
    const isDelegatedHostForEdit =
      lc.streamType === 'SCHOOL' &&
      lc.delegatedHostId != null &&
      lc.delegatedHostId === req.user.id;
    const isHostForEdit = isCreatorForEdit || isDelegatedHostForEdit;

    if (!isHostForEdit) {
      return errorResponse(res, 'Only the host or delegated host can edit this live class', 403);
    }

    // Reject scheduledAt changes while LIVE
    if (req.body.scheduledAt !== undefined && lc.status === 'LIVE') {
      return errorResponse(res, 'Cannot change scheduled time while class is live', 400);
    }

    // Reject owner-only fields for delegated host
    if (!isCreatorForEdit) {
      if (req.body.maxSpeakers !== undefined) {
        return errorResponse(res, 'Only the creator can change maxSpeakers', 403);
      }
      if (req.body.isRecorded !== undefined) {
        return errorResponse(res, 'Only the creator can change recording settings', 403);
      }
    }

    // HOST-editable fields (delegated host + creator). isOpenMic removed — use dedicated endpoint.
    const allowed = ['title','description','scheduledAt','duration','chatEnabled',
      'handRaiseEnabled','whiteboardEnabled','quranPanelEnabled',
      'screenShareEnabled'];
    // OWNER-ONLY fields appended when caller is the creator
    if (isCreatorForEdit) {
      allowed.push('maxSpeakers', 'isRecorded');
    }
    // P3-002 VERIFIED: column names in the raw SQL UPDATE come exclusively from the
    // `allowed` array above — never from req.body keys directly. User-supplied field
    // names are filtered through `allowed.forEach`, so only known-safe column names
    // reach the `${k} = ?` interpolation. Values are always parameterized with ?.
    const data = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) data[k] = req.body[k]; });
    if (data.scheduledAt) data.scheduledAt = new Date(data.scheduledAt);

    await prisma.$executeRawUnsafe(`UPDATE live_classes SET ${Object.entries(data).map(([k]) => `${k} = ?`).join(', ')}, updatedAt = NOW() WHERE id = ?`, ...Object.values(data), lc.id)
const updated = await findLiveClass(lc.id);
    const io = getIo();
    if (io) io.to(`liveclass:${lc.id}`).emit('liveclass:updated', { liveClass: updated });
    return successResponse(res, updated);
  } catch (e) { next(e); }
}

//  DELETE 
async function deleteLiveClass(req, res, next) {
  try {
    const lc = await rawFindLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    if (lc.status === 'LIVE') return errorResponse(res, 'End the class before deleting', 400);
    await rawUpdateLiveClassStatus(lc.id, { deletedAt: new Date(), status: 'CANCELLED' });
    return successResponse(res, null, 'Live class deleted');
  } catch (e) { next(e); }
}

//  START 
async function startLiveClass(req, res, next) {
  try {
    const lc = await rawFindLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    if (lc.status === 'LIVE') return errorResponse(res, 'Class already live', 400);
    if (lc.status === 'ENDED') return errorResponse(res, 'Class already ended', 400);

    const livekitRoomName = `liveclass-${lc.id}`;
    const now = new Date();
    const updated = await rawUpdateLiveClassStatus(lc.id, { status: 'LIVE', startedAt: now, livekitRoomName });

    const io = getIo();
    if (io) {
      if (lc.schoolId) io.to(`school:${lc.schoolId}`).emit('liveclass:started', { liveClassId: lc.id, title: lc.title, classId: lc.classId });
      if (lc.classId)  io.to(`class:${lc.classId}`).emit('liveclass:started', { liveClassId: lc.id, title: lc.title });
      // PUBLIC streams broadcast to all connected users
      if (lc.streamType === 'PUBLIC') io.to('feed:public').emit('liveclass:started', { liveClassId: lc.id, title: lc.title });
    }

    broadcastLiveStart({
      refEntityType:    'live_class',
      refEntityId:      lc.id,
      authorId:         req.user.id,
      title:            lc.title,
      description:      lc.description,
      schoolId:         lc.schoolId,
      participantCount: 0,
    });

    if (lc.classId) _notifyStudentsLiveClassStart(lc.id, req.user.id, lc.classId, lc.title).catch(() => {});

    if (lc.duration) scheduleAutoEnd(lc.id, now, lc.duration);

    liveClassAudit(req.user.id, 'START', lc.id, { title: lc.title }).catch(() => {});
    return successResponse(res, updated, 'Class started');
  } catch (e) { next(e); }
}

//  END 
async function endLiveClass(req, res, next) {
  try {
    const lc = await rawFindLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    if (lc.status !== 'LIVE') return errorResponse(res, 'Class is not live', 400);

    // BUG-05 FIX: Cancel any pending auto-end timer before manually ending.
    cancelAutoEnd(lc.id);

    const now = new Date();

    // mark all active participants inactive + update attendance
    const active = await prisma.liveClassParticipant.findMany({
      where: { liveClassId: lc.id, isActive: true }
    });

    await prisma.$transaction([
      // DEL-HOST: Clear delegatedHostId atomically with ENDED status transition.
      // Prevents stale delegation on ended classes.
      prisma.$executeRawUnsafe(`UPDATE live_classes SET status = 'ENDED', endedAt = NOW(), delegated_host_id = NULL, updatedAt = NOW() WHERE id = ?`, lc.id),
      ...active.map(p => prisma.liveClassParticipant.update({
        where: { id: p.id },
        data: {
          isActive: false, leftAt: now,
          // BUG FIX: ensure joinedAt is a Date before arithmetic to avoid NaN
          totalDuration: p.totalDuration + Math.floor((now.getTime() - new Date(p.joinedAt).getTime()) / 1000)
        }
      }))
    ]);

    // update attendance records
    const attendances = await prisma.liveClassAttendance.findMany({
      where: { liveClassId: lc.id, leftAt: null }
    });
    await Promise.all(attendances.map(a =>
      prisma.liveClassAttendance.update({
        where: { id: a.id },
        data: {
          leftAt: now,
          // BUG FIX: ensure joinedAt is a Date before arithmetic to avoid NaN
          totalMinutes: Math.floor((now.getTime() - new Date(a.joinedAt).getTime()) / 60000),
          status: 'PRESENT'
        }
      })
    ));

    const io = getIo();
    if (io) io.to(`liveclass:${lc.id}`).emit('liveclass:ended', { liveClassId: lc.id });

    // Update feed card to ended state (card stays visible as a record)
    broadcastLiveEnd('live_class', lc.id);

    return successResponse(res, null, 'Class ended');
  } catch (e) { next(e); }
}

//  JOIN 
async function joinLiveClass(req, res, next) {
  try {
    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    if (lc.status === 'ENDED' || lc.status === 'CANCELLED') return errorResponse(res, 'Class is not available', 400);

    // SEC-BAN-01: Banned users cannot join any live session.
    // Check the authoritative status from DB — req.user is populated from the JWT
    // which may be stale (ban applied after token was issued). Query fresh.
    const freshUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { status: true },
    });
    if (freshUser?.status === 'BANNED') {
      return errorResponse(res, 'Your account has been suspended', 403);
    }

    const userId = req.user.id;
    const effectiveRole = getEffectiveRole(req);
    // LCSV-001 FIX: SUPER_ADMIN is a platform administrator, NOT a live class teacher/host.
    // Removed 'SUPER_ADMIN' from both checks so a platform admin joining a live class
    // receives STUDENT role (same as any other viewer) unless they are the actual
    // stream creator (isPublicHost check below covers that case).
    // Use effectiveRole (school membership role) — NOT req.user.role — so MEMBER users
    // with a TEACHER school membership are correctly identified as teachers.
    const isStaff = ['TEACHER', 'SCHOOL_ADMIN'].includes(effectiveRole);
    const isTeacher = isStaff; // alias: same role set — used below for isMuted/role decisions

    // Normalise streamType — old rows and mocks may not have it set
    const streamType = lc.streamType || 'SCHOOL';

    // PUBLIC-ROLE-FIX (M-1): School roles MUST NOT grant HOST on PUBLIC streams.
    //
    // Previously: (isStaff || isPublicHost) — a legacy TEACHER/SCHOOL_ADMIN global role
    // would make the user HOST on every PUBLIC stream, even streams they did not create.
    // This violates the architectural rule: School Role ≠ Public Live Stream Role.
    //
    // Corrected logic:
    //   - PUBLIC stream: HOST only if lc.hostUserId === userId (explicit creator check).
    //     All school roles (TEACHER, SCHOOL_ADMIN, STUDENT) receive STUDENT/VIEWER.
    //   - SCHOOL stream: HOST if isStaff (school role is authoritative here).
    //
    // isEffectivelyStaff is false for PUBLIC streams by construction, so school staff
    // arriving at a PUBLIC stream via the existing flow are correctly downgraded to STUDENT.
    const isPublicHost       = streamType === 'PUBLIC' && lc.hostUserId === userId;
    const isEffectivelyStaff = streamType === 'SCHOOL' && isStaff;
    const role = (isEffectivelyStaff || isPublicHost) ? 'HOST' : 'STUDENT';

    let student = null;

    // Enrollment check — only applies to SCHOOL streams for non-staff
    if (streamType === 'SCHOOL' && !isStaff) {
      student = await prisma.student.findFirst({ where: { userId } });
      if (!student) return errorResponse(res, 'Student profile not found', 403);
      const enrolled = await prisma.enrollment.findFirst({
        where: { studentId: student.id, classId: lc.classId, isActive: true },
      });
      if (!enrolled) return errorResponse(res, 'You are not enrolled in this class', 403);

      const existingRecord = await prisma.liveClassParticipant.findFirst({
        where: { liveClassId: lc.id, userId },
        select: { wasKicked: true },
      });
      if (existingRecord?.wasKicked) {
        return errorResponse(res, 'You have been removed from this class by the host', 403);
      }

      // Only enforce capacity if maxParticipants is a positive number.
      // null means unlimited; 0 or negative is treated as unlimited (safety guard).
      if (lc.maxParticipants != null && lc.maxParticipants > 0) {
        const currentCount = await prisma.liveClassParticipant.count({
          where: { liveClassId: lc.id, isActive: true }
        });
        if (currentCount >= lc.maxParticipants) {
          return errorResponse(res, `Class is full (max ${lc.maxParticipants} participants)`, 403);
        }
      }
    }

    // For PUBLIC streams: anyone (non-creator) can join as STUDENT
    // Kick protection applies to everyone except the creator
    // PUBLIC streams are always unlimited (TikTok-style) — no viewer cap enforced.
    if (streamType === 'PUBLIC' && !isCreator) {
      const existingRecord = await prisma.liveClassParticipant.findFirst({
        where: { liveClassId: lc.id, userId },
        select: { wasKicked: true },
      });
      if (existingRecord?.wasKicked) {
        return errorResponse(res, 'You have been removed from this stream by the host', 403);
      }
      // Only enforce capacity if maxParticipants is a positive number.
      // null means unlimited (public streams default to null = open to all).
      if (lc.maxParticipants != null && lc.maxParticipants > 0) {
        const currentCount = await prisma.liveClassParticipant.count({
          where: { liveClassId: lc.id, isActive: true }
        });
        if (currentCount >= lc.maxParticipants) {
          return errorResponse(res, `Stream is full (max ${lc.maxParticipants} viewers)`, 403);
        }
      }
    }

    const participant = await prisma.liveClassParticipant.upsert({
      where: { liveClassId_userId: { liveClassId: lc.id, userId } },
      create: { liveClassId: lc.id, userId, role, isMuted: !(isEffectivelyStaff || isPublicHost || lc.isOpenMic), isActive: true },
      update: { isActive: true, joinedAt: new Date(), leftAt: null, isMuted: !(isEffectivelyStaff || isPublicHost || lc.isOpenMic) },
      include: { user: { select: userSelect } }
    });

    const io = getIo();

    // Auto-start if host joins a SCHEDULED stream
    const isHost = isEffectivelyStaff || isPublicHost;
    if (isHost && lc.status === 'SCHEDULED') {
      const autoStartedAt = new Date();
      await rawUpdateLiveClassStatus(lc.id, {
        status: 'LIVE',
        startedAt: autoStartedAt,
        livekitRoomName: `liveclass-${lc.id}`
      });
      if (io) {
        if (lc.schoolId) io.to(`school:${lc.schoolId}`).emit('liveclass:started', { liveClassId: lc.id, title: lc.title, classId: lc.classId });
        if (lc.classId)  io.to(`class:${lc.classId}`).emit('liveclass:started', { liveClassId: lc.id, title: lc.title });
        if (streamType === 'PUBLIC') io.to('feed:public').emit('liveclass:started', { liveClassId: lc.id, title: lc.title });
      }
      broadcastLiveStart({
        refEntityType: 'live_class', refEntityId: lc.id,
        authorId: req.user.id, title: lc.title, description: lc.description,
        schoolId: lc.schoolId, participantCount: 1,
      });
      if (lc.classId) _notifyStudentsLiveClassStart(lc.id, req.user.id, lc.classId, lc.title).catch(() => {});
      if (lc.duration) scheduleAutoEnd(lc.id, autoStartedAt, lc.duration);
    }

    // Attendance tracking — only for SCHOOL streams with a student record
    if (streamType === 'SCHOOL' && !isEffectivelyStaff && student) {
      await prisma.liveClassAttendance.upsert({
        where: { liveClassId_studentId: { liveClassId: lc.id, studentId: student.id } },
        create: { liveClassId: lc.id, studentId: student.id, status: 'PRESENT' },
        update: { joinedAt: new Date(), leftAt: null, status: 'PRESENT' }
      });
    }

    if (io) {
      io.to(`liveclass:${lc.id}`).emit('liveclass:user_joined', {
        liveClassId: lc.id, userId, role,
        user: { id: userId, firstName: req.user.firstName, lastName: req.user.lastName, avatarUrl: req.user.avatarUrl }
      });

      // SPRINT-1: Real-time viewer count push.
      // PUBLIC → feed:public (discovery list). SCHOOL → school:{id} room (class list).
      try {
        const viewerCount = await prisma.liveClassParticipant.count({
          where: { liveClassId: lc.id, isActive: true }
        });
        const countPayload = { liveClassId: lc.id, count: viewerCount };
        if (lc.streamType === 'PUBLIC') {
          io.to('feed:public').emit('liveclass:viewer_count', countPayload);
        } else if (lc.schoolId) {
          io.to(`school:${lc.schoolId}`).emit('liveclass:viewer_count', countPayload);
        }
      } catch (_e) {
        // non-critical — silently ignore count emit failure
      }
    }

    // Fetch updated class with participants so frontend renders tiles immediately
    const updatedLc = await rawFindLiveClass(lc.id);
    const participants = await prisma.liveClassParticipant.findMany({
      where: { liveClassId: lc.id, isActive: true },
      include: { user: { select: userSelect } },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }]
    });

    return successResponse(res, { participant, liveClass: { ...updatedLc, participants } });
  } catch (e) { next(e); }
}

//  LEAVE 
async function leaveLiveClass(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const now = new Date();

    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);

    const participant = await prisma.liveClassParticipant.findFirst({
      where: { liveClassId: id, userId, isActive: true }
    });
    if (!participant) return successResponse(res, null, 'Already left');

    const duration = Math.floor((now.getTime() - new Date(participant.joinedAt).getTime()) / 1000);
    await prisma.liveClassParticipant.update({
      where: { id: participant.id },
      data: { isActive: false, leftAt: now, totalDuration: participant.totalDuration + duration }
    });

    // update attendance
    const student = await prisma.student.findFirst({ where: { userId } });
    if (student) {
      const att = await prisma.liveClassAttendance.findFirst({ where: { liveClassId: id, studentId: student.id } });
      if (att && !att.leftAt) {
        // BUG FIX: ensure joinedAt is a Date before arithmetic to avoid NaN
        const mins = Math.floor((now.getTime() - new Date(att.joinedAt).getTime()) / 60000);
        await prisma.liveClassAttendance.update({
          where: { id: att.id },
          data: { leftAt: now, totalMinutes: mins, status: mins >= MIN_PRESENT_MINUTES ? 'PRESENT' : 'PARTIAL' }
        });
      }
    }

    const io = getIo();
    if (io) io.to(`liveclass:${id}`).emit('liveclass:user_left', { liveClassId: id, userId });

    // SPRINT-1: Real-time viewer count push on leave.
    // PUBLIC → feed:public. SCHOOL → school:{id} room.
    if (io) {
      try {
        const viewerCount = await prisma.liveClassParticipant.count({
          where: { liveClassId: id, isActive: true }
        });
        const countPayload = { liveClassId: id, count: viewerCount };
        if (lc.streamType === 'PUBLIC') {
          io.to('feed:public').emit('liveclass:viewer_count', countPayload);
        } else if (lc.schoolId) {
          io.to(`school:${lc.schoolId}`).emit('liveclass:viewer_count', countPayload);
        }
      } catch (_e) {
        // non-critical — silently ignore
      }
    }

    return successResponse(res, null, 'Left class');
  } catch (e) { next(e); }
}

//  LIVEKIT TOKEN 
async function getLiveKitToken(req, res, next) {
  try {
    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    if (lc.status === 'ENDED')     return errorResponse(res, 'Class has ended', 400);
    if (lc.status === 'CANCELLED') return errorResponse(res, 'Class was cancelled', 400);

    // SEC-BAN-01: Banned users must not receive new LiveKit tokens.
    // Tokens are long-lived (1h) so a ban applied after token issue won't take effect
    // until expiry — but we can at least block new token requests immediately.
    const freshUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { status: true },
    });
    if (freshUser?.status === 'BANNED') {
      return errorResponse(res, 'Your account has been suspended', 403);
    }

    const participant = await prisma.liveClassParticipant.findFirst({
      where: { liveClassId: lc.id, userId: req.user.id, isActive: true }
    });
    if (!participant) return errorResponse(res, 'Join the class first', 403);

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) return errorResponse(res, 'LiveKit not configured', 503);

    const at = new AccessToken(apiKey, apiSecret, {
      identity: req.user.id,
      name: `${req.user.firstName} ${req.user.lastName}`,
      // LC-002 FIX: Reduced TTL from 4h → 1h to match voice room token policy.
      // A kicked participant with a 4h token could rejoin the LiveKit room directly
      // for up to 4h after being removed. 1h is sufficient for any single class session.
      ttl: '1h'
    });

    const isHost = participant.role === 'HOST';
    // ALL participants get canPublish: true so their camera/mic streams
    // can be seen by others. Mic mute state is controlled by isMuted flag
    // in the DB and enforced by the frontend — not by the LiveKit token.
    // This enables: students to publish video, teacher to see all students.
    //
    // GAP-03 FIX: Enforce screenShareEnabled at the SFU grant level.
    // When screenShareEnabled = false, non-host participants receive a token
    // that explicitly excludes TrackSource.ScreenShare from canPublishSources.
    // This means the LiveKit SFU itself rejects screen share publication —
    // not just the UI. Hosts are always allowed to share regardless of the flag.
    //
    // canPublishSources uses livekit-server-sdk v2.x VideoGrant field.
    // Values are TrackSource enum strings: 'camera', 'microphone', 'screen_share',
    // 'screen_share_audio'. Omitting the field = unrestricted (all sources allowed).
    const canShareScreen = isHost || lc.screenShareEnabled;

    // GAP-03 FIX: Enforce screenShareEnabled at the SFU grant level.
    // When screenShareEnabled = false, non-host participants receive a token
    // that explicitly excludes TrackSource.ScreenShare from canPublishSources.
    // canPublishSources uses livekit-server-sdk v2.x VideoGrant field.
    // Values: 'camera', 'microphone', 'screen_share', 'screen_share_audio'.
    // Omitting the field = unrestricted (all sources allowed).
    const grantOptions = {
      roomJoin:             true,
      room:                 lc.livekitRoomName || `liveclass-${lc.id}`,
      canPublish:           true,
      canSubscribe:         true,
      canPublishData:       true,
      canUpdateOwnMetadata: true,
    };

    if (!canShareScreen) {
      // Restrict to camera + microphone only — screen share blocked at SFU
      grantOptions.canPublishSources = ['camera', 'microphone'];
    }

    at.addGrant(grantOptions);

    const token = await at.toJwt();
    return successResponse(res, {
      token,
      livekitUrl: process.env.LIVEKIT_URL || 'wss://your-livekit-server.livekit.cloud',
      roomName: lc.livekitRoomName || `liveclass-${lc.id}`,
      role: participant.role
    });
  } catch (e) { next(e); }
}

//  PARTICIPANTS 
async function getParticipants(req, res, next) {
  try {
    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    const participants = await prisma.liveClassParticipant.findMany({
      where: { liveClassId: req.params.id, isActive: true },
      include: { user: { select: userSelect } },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }]
    });
    return successResponse(res, participants);
  } catch (e) { next(e); }
}

//  MUTE PARTICIPANT 
async function muteParticipant(req, res, next) {
  try {
    const { id, userId } = req.params;
    const { muted = true } = req.body;
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    // Only HOST or MODERATOR can mute others
    await assertOwnerOrModerator(lc, req, prisma);
    const p = await prisma.liveClassParticipant.findFirst({ where: { liveClassId: id, userId, isActive: true } });
    if (!p) return errorResponse(res, 'Participant not found', 404);
    if (p.role === 'HOST') return errorResponse(res, 'Cannot mute the host', 403);
    await prisma.liveClassParticipant.update({ where: { id: p.id }, data: { isMuted: muted } });
    const io = getIo();
    if (io) io.to(`liveclass:${id}`).emit('liveclass:mute_changed', { liveClassId: id, userId, isMuted: muted });
    return successResponse(res, null, muted ? 'Muted' : 'Unmuted');
  } catch (e) { next(e); }
}

//  MUTE ALL 
async function muteAll(req, res, next) {
  try {
    const { id } = req.params;
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    // HOST or MODERATOR can mute all
    await assertOwnerOrModerator(lc, req, prisma);
    await prisma.liveClassParticipant.updateMany({
      where: { liveClassId: id, isActive: true, role: { not: 'HOST' } },
      data: { isMuted: true }
    });
    const io = getIo();
    if (io) io.to(`liveclass:${id}`).emit('liveclass:mute_all', { liveClassId: id });
    return successResponse(res, null, 'All muted');
  } catch (e) { next(e); }
}

//  UNMUTE ALL 
async function unmuteAll(req, res, next) {
  try {
    const { id } = req.params;
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    // HOST or MODERATOR can unmute all
    await assertOwnerOrModerator(lc, req, prisma);
    await prisma.liveClassParticipant.updateMany({
      where: { liveClassId: id, isActive: true, role: { not: 'HOST' } },
      data: { isMuted: false }
    });
    const io = getIo();
    if (io) io.to(`liveclass:${id}`).emit('liveclass:unmute_all', { liveClassId: id });
    return successResponse(res, null, 'All unmuted');
  } catch (e) { next(e); }
}

//  LOWER ALL HANDS 
async function lowerAllHands(req, res, next) {
  try {
    const { id } = req.params;
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    // HOST or MODERATOR can lower all hands
    await assertOwnerOrModerator(lc, req, prisma);
    await prisma.liveClassParticipant.updateMany({
      where: { liveClassId: id, isActive: true, handRaised: true },
      data: { handRaised: false, handRaisedAt: null }
    });
    await prisma.liveClassHandQueue.updateMany({
      where: { liveClassId: id, status: 'WAITING' },
      data: { status: 'CANCELLED' }
    });
    const io = getIo();
    if (io) io.to(`liveclass:${id}`).emit('liveclass:all_hands_lowered', { liveClassId: id });
    return successResponse(res, null, 'All hands lowered');
  } catch (e) { next(e); }
}

//  KICK 
async function kickParticipant(req, res, next) {
  try {
    const { id, userId } = req.params;
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    // Only HOST or MODERATOR can kick
    await assertOwnerOrModerator(lc, req, prisma);
    const p = await prisma.liveClassParticipant.findFirst({ where: { liveClassId: id, userId, isActive: true } });
    if (!p) return errorResponse(res, 'Participant not found', 404);
    if (p.role === 'HOST') return errorResponse(res, 'Cannot kick the host', 403);
    // Task 3: set wasKicked=true so the participant cannot immediately rejoin
    await prisma.liveClassParticipant.update({ where: { id: p.id }, data: { isActive: false, leftAt: new Date(), wasKicked: true } });
    const io = getIo();
    if (io) {
      io.to(`liveclass:${id}`).emit('liveclass:kicked', { liveClassId: id, userId });
      io.to(`user:${userId}`).emit('liveclass:you_were_kicked', { liveClassId: id });
    }
    // P0-05: BUG-01 — forcibly remove participant from LiveKit SFU.
    // Best-effort: if LiveKit is unreachable, the DB kick still stands.
    // The participant loses their valid token within 1h (existing TTL).
    const svc = getLivekitRoomService();
    if (svc && lc.livekitRoomName) {
      await svc.removeParticipant(lc.livekitRoomName, userId).catch(err =>
        logger.warn(`[kick] LiveKit eviction failed for ${userId} in ${lc.livekitRoomName}: ${err.message}`)
      );
    }
    liveClassAudit(req.user.id, 'KICK', id, { kickedUserId: userId }).catch(() => {});
    return successResponse(res, null, 'Participant kicked');
  } catch (e) { next(e); }
}

//  RAISE HAND 
async function raiseHand(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const now = new Date();
    // P0-01: school isolation check (explicit PUBLIC guard for clarity)
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    await prisma.liveClassParticipant.updateMany({ where: { liveClassId: id, userId }, data: { handRaised: true, handRaisedAt: now } });
    await prisma.liveClassHandQueue.upsert({
      where: { liveClassId_userId: { liveClassId: id, userId } },
      create: { liveClassId: id, userId, status: 'WAITING', raisedAt: now },
      update: { status: 'WAITING', raisedAt: now }
    });
    const io = getIo();
    if (io) io.to(`liveclass:${id}`).emit('liveclass:hand_raised', {
      liveClassId: id, userId,
      firstName: req.user.firstName, lastName: req.user.lastName
    });
    return successResponse(res, null, 'Hand raised');
  } catch (e) { next(e); }
}

//  LOWER HAND 
async function lowerHand(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    // P0-01: school isolation check (explicit PUBLIC guard for clarity)
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    await prisma.liveClassParticipant.updateMany({ where: { liveClassId: id, userId }, data: { handRaised: false, handRaisedAt: null } });
    await prisma.liveClassHandQueue.updateMany({ where: { liveClassId: id, userId, status: 'WAITING' }, data: { status: 'CANCELLED' } });
    const io = getIo();
    if (io) io.to(`liveclass:${id}`).emit('liveclass:hand_lowered', { liveClassId: id, userId });
    return successResponse(res, null, 'Hand lowered');
  } catch (e) { next(e); }
}

//  APPROVE HAND 
async function approveHand(req, res, next) {
  try {
    const { id, userId } = req.params;
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    await assertOwnerOrModerator(lc, req, prisma);

    // H-5 FIX: Concurrency-safe promotion using a raw UPDATE with an embedded
    // subquery count. The UPDATE atomically:
    //   1. Verifies the target participant exists, is active, and has no slot yet
    //   2. Verifies active speaker count < maxSpeakers
    //   3. Assigns the slot only if both conditions hold
    // After the UPDATE we check rows-affected to detect races.
    const maxSpeakers = lc.maxSpeakers ?? 20;

    // First check idempotency (H-6) — if already on stage, return existing slot
    const existing = await prisma.liveClassParticipant.findFirst({
      where: { liveClassId: id, userId, isActive: true },
      select: { id: true, speakerSlot: true },
    });
    if (!existing) return errorResponse(res, 'Participant not found', 404);
    if (existing.speakerSlot != null) {
      // Already on stage — idempotent response
      return successResponse(res, { speakerSlot: existing.speakerSlot }, 'Participant is already on stage');
    }

    // Find lowest free slot from current snapshot — then do atomic assign
    const activeSpeakers = await prisma.liveClassParticipant.findMany({
      where: { liveClassId: id, isActive: true, speakerSlot: { not: null } },
      orderBy: { speakerSlot: 'asc' },
      select: { speakerSlot: true },
    });
    if (activeSpeakers.length >= maxSpeakers) {
      return errorResponse(res, `Stage is full (max ${maxSpeakers} speakers)`, 400);
    }
    const usedSlots = new Set(activeSpeakers.map(s => s.speakerSlot));
    let slot = 0;
    while (usedSlots.has(slot)) slot++;

    // Atomic conditional UPDATE:
    // Only succeeds if:
    //   a) this participant is still active + audience (speakerSlot IS NULL)
    //   b) live speaker count is still < maxSpeakers
    // If a concurrent request already promoted someone, one of these will be 0 rows.
    const result = await prisma.$executeRawUnsafe(`
      UPDATE live_class_participants
      SET speakerSlot = ?, isMuted = 0, handRaised = 0, updatedAt = NOW()
      WHERE liveClassId = ?
        AND userId = ?
        AND isActive = 1
        AND speakerSlot IS NULL
        AND (
          SELECT COUNT(*) FROM (
            SELECT 1 FROM live_class_participants
            WHERE liveClassId = ? AND isActive = 1 AND speakerSlot IS NOT NULL
          ) AS _cnt
        ) < ?
    `, slot, id, userId, id, maxSpeakers);

    if (result === 0) {
      // Either stage just filled up (race) or participant was already promoted
      const recheck = await prisma.liveClassParticipant.findFirst({
        where: { liveClassId: id, userId, isActive: true },
        select: { speakerSlot: true },
      });
      if (recheck?.speakerSlot != null) {
        // Another request got there first and assigned the same user — idempotent
        return successResponse(res, { speakerSlot: recheck.speakerSlot }, 'Participant is already on stage');
      }
      // Stage became full between our check and the update
      return errorResponse(res, `Stage is full (max ${maxSpeakers} speakers)`, 400);
    }

    // Update hand queue status
    await prisma.liveClassHandQueue.updateMany({
      where: { liveClassId: id, userId, status: 'WAITING' },
      data: { status: 'APPROVED' },
    });

    const io = getIo();
    if (io) {
      // Keep liveclass:hand_approved for compatibility (lowers hand in all client UIs)
      io.to(`liveclass:${id}`).emit('liveclass:hand_approved', { liveClassId: id, userId, speakerSlot: slot });
      // H-1 FIX: emit dedicated stage events the clients are wired for
      io.to(`liveclass:${id}`).emit('liveclass:speaker_added', { liveClassId: id, userId, speakerSlot: slot });
      // H-1 FIX: grant_mic → target user's private room triggers LiveKit reconnect
      io.to(`user:${userId}`).emit('liveclass:grant_mic', { liveClassId: id, speakerSlot: slot });
    }
    return successResponse(res, { speakerSlot: slot }, 'Hand approved — mic unmuted');
  } catch (e) {
    // PHASE-3 FIX: Handle MySQL ER_DUP_ENTRY / Prisma unique constraint violation.
    // Prisma wraps $executeRawUnsafe MySQL errors as P2010 with the original MySQL
    // error code (1062 for ER_DUP_ENTRY) embedded in the message. Check all paths.
    const msg = (e?.message || '') + JSON.stringify(e?.meta || {});
    const isDup =
      e?.code === 'P2002' ||
      e?.code === 'P2010' ||
      e?.code === 'ER_DUP_ENTRY' ||
      msg.includes('Unique constraint') ||
      msg.includes('ER_DUP_ENTRY') ||
      msg.includes('Duplicate entry') ||
      msg.includes('1062');
    if (isDup) {
      return errorResponse(res, 'Stage is full — slot already taken by a concurrent admission', 400);
    }
    next(e);
  }
}

//  REJECT HAND 
async function rejectHand(req, res, next) {
  try {
    const { id, userId } = req.params;
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    await assertOwnerOrModerator(lc, req, prisma);
    await prisma.liveClassHandQueue.updateMany({ where: { liveClassId: id, userId, status: 'WAITING' }, data: { status: 'REJECTED' } });
    await prisma.liveClassParticipant.updateMany({ where: { liveClassId: id, userId }, data: { handRaised: false } });
    const io = getIo();
    if (io) io.to(`liveclass:${id}`).emit('liveclass:hand_rejected', { liveClassId: id, userId });
    return successResponse(res, null, 'Hand rejected');
  } catch (e) { next(e); }
}

// ─── DROP MIC ─────────────────────────────────────────────────────────────────
async function dropMic(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    const slotCheck = await prisma.$queryRawUnsafe(
      `SELECT speakerSlot, role FROM live_class_participants WHERE liveClassId = ? AND userId = ? AND isActive = 1 LIMIT 1`,
      id, userId
    );
    if (!slotCheck || slotCheck.length === 0) return errorResponse(res, 'Not in this class', 404);
    const isMgr = slotCheck[0].role === 'HOST' || slotCheck[0].role === 'MODERATOR';
    const hasSlot = slotCheck[0].speakerSlot !== null;
    if (!hasSlot && !isMgr) return errorResponse(res, 'You are not an active speaker', 400);
    await prisma.$executeRawUnsafe(
      `UPDATE live_class_participants SET speakerSlot = NULL, isMuted = 1 WHERE liveClassId = ? AND userId = ?`,
      id, userId
    );
    const io = getIo();
    if (io) {
      io.to(`liveclass:${id}`).emit('liveclass:speaker_removed', { liveClassId: id, userId });
      io.to(`liveclass:${id}`).emit('liveclass:mute_changed', { liveClassId: id, userId, isMuted: true });
      io.to(`user:${userId}`).emit('liveclass:revoke_mic', { liveClassId: id });
    }
    return successResponse(res, null, 'Mic dropped');
  } catch (e) { next(e); }
}

// ─── DEMOTE SPEAKER ───────────────────────────────────────────────────────────
async function demoteSpeaker(req, res, next) {
  try {
    const { id, userId } = req.params;
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    await assertOwnerOrModerator(lc, req, prisma);
    const participant = await prisma.liveClassParticipant.findFirst({ where: { liveClassId: id, userId, isActive: true } });
    if (!participant) return errorResponse(res, 'Participant not found', 404);
    if (participant.role === 'HOST') return errorResponse(res, 'Cannot demote the host', 403);
    await prisma.$executeRawUnsafe(
      `UPDATE live_class_participants SET speakerSlot = NULL, isMuted = 1 WHERE liveClassId = ? AND userId = ?`,
      id, userId
    );
    const io = getIo();
    if (io) {
      io.to(`liveclass:${id}`).emit('liveclass:speaker_removed', { liveClassId: id, userId });
      io.to(`liveclass:${id}`).emit('liveclass:mute_changed', { liveClassId: id, userId, isMuted: true });
      io.to(`user:${userId}`).emit('liveclass:revoke_mic', { liveClassId: id });
    }
    return successResponse(res, null, 'Speaker demoted to audience');
  } catch (e) { next(e); }
}

// ─── INVITE TO STAGE ─────────────────────────────────────────────────────────
async function inviteToStage(req, res, next) {
  try {
    const { id, userId } = req.params;
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    await assertOwnerOrModerator(lc, req, prisma);
    const target = await prisma.liveClassParticipant.findFirst({ where: { liveClassId: id, userId, isActive: true } });
    if (!target) return errorResponse(res, 'Participant not found', 404);
    const maxSpeakers = lc.maxSpeakers || 20;
    const slotRows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as cnt FROM live_class_participants WHERE liveClassId = ? AND isActive = 1 AND speakerSlot IS NOT NULL`,
      id
    );
    const activeSpeakerCount = Number(slotRows[0]?.cnt ?? 0);
    if (activeSpeakerCount >= maxSpeakers) return errorResponse(res, `Stage is full (${activeSpeakerCount}/${maxSpeakers})`, 400);
    const nextSlot = activeSpeakerCount;
    await prisma.liveClassParticipant.updateMany({ where: { liveClassId: id, userId }, data: { handRaised: false, handRaisedAt: null, isMuted: false } });
    await prisma.$executeRawUnsafe(
      `UPDATE live_class_participants SET speakerSlot = ? WHERE liveClassId = ? AND userId = ?`,
      nextSlot, id, userId
    );
    const io = getIo();
    if (io) {
      io.to(`liveclass:${id}`).emit('liveclass:speaker_added', { liveClassId: id, userId, speakerSlot: nextSlot, activeSpeakerCount: activeSpeakerCount + 1, maxSpeakers });
      io.to(`user:${userId}`).emit('liveclass:grant_mic', { liveClassId: id });
      io.to(`user:${userId}`).emit('liveclass:you_can_speak', { liveClassId: id });
    }
    return successResponse(res, { speakerSlot: nextSlot }, 'Participant invited to stage');
  } catch (e) { next(e); }
}

//  HAND QUEUE 
async function getHandQueue(req, res, next) {
  try {
    // P0-01: school isolation check (explicit PUBLIC guard for clarity)
    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    const queue = await prisma.liveClassHandQueue.findMany({
      where: { liveClassId: req.params.id, status: 'WAITING' },
      include: { user: { select: userSelect } },
      orderBy: { raisedAt: 'asc' }
    });
    return successResponse(res, queue);
  } catch (e) { next(e); }
}

//  SEND MESSAGE 
async function sendMessage(req, res, next) {
  try {
    const { id } = req.params;
    const { body, type = 'TEXT' } = req.body;
    if (!body?.trim()) return errorResponse(res, 'Message body required', 400);

    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req); // P0-01
    if (!lc.chatEnabled) return errorResponse(res, 'Chat is disabled', 403);

    // PES-001 FIX: The school-role shortcut (isTeacherOrAdmin) that previously
    // bypassed the active-participant check now applies ONLY to SCHOOL streams.
    //
    // SCHOOL streams: a teacher/admin may send messages without a participant
    //   record because they manage the class as staff and may not have formally
    //   "joined" it via the join endpoint. This preserves existing SCHOOL behavior.
    //
    // PUBLIC streams: school role confers NO chat authority. Every user —
    //   including TEACHER and SCHOOL_ADMIN — must hold an active participant
    //   record (i.e. have called POST /:id/join) to send messages.
    //   A school staff user who has not joined the PUBLIC stream gets 403.
    //   A kicked/inactive participant (isActive: false) also gets 403.
    const streamType = lc.streamType || 'SCHOOL';
    const isTeacherOrAdmin =
      streamType === 'SCHOOL' &&
      ['TEACHER', 'SCHOOL_ADMIN'].includes(getEffectiveRole(req));

    if (!isTeacherOrAdmin) {
      const participant = await prisma.liveClassParticipant.findFirst({
        where: { liveClassId: id, userId: req.user.id, isActive: true },
      });
      if (!participant) return errorResponse(res, 'You are not a participant of this class', 403);
    }

    const msg = await prisma.liveClassMessage.create({
      data: { liveClassId: id, userId: req.user.id, body: body.trim(), type },
      include: { user: { select: userSelect } }
    });

    const io = getIo();
    if (io) io.to(`liveclass:${id}`).emit('liveclass:message', msg);
    return successResponse(res, msg, 'Message sent', 201);
  } catch (e) { next(e); }
}

//  GET MESSAGES 
async function getMessages(req, res, next) {
  try {
    const { page = 1, limit = 50 } = req.query;
    const { skip } = getPagination(page, limit);
    const take = Math.min(100, Math.max(1, parseInt(limit)));
    // P0-01: school isolation check (explicit PUBLIC guard for clarity)
    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    const [total, messages] = await Promise.all([
      prisma.liveClassMessage.count({ where: { liveClassId: req.params.id, deletedAt: null } }),
      prisma.liveClassMessage.findMany({
        where: { liveClassId: req.params.id, deletedAt: null },
        include: { user: { select: userSelect } },
        orderBy: { createdAt: 'asc' },
        skip, take
      })
    ]);
    return successResponse(res, { messages, pagination: buildPaginationMeta(total, +page, take) });
  } catch (e) { next(e); }
}

//  ATTENDANCE 
async function getAttendance(req, res, next) {
  try {
    // P0-01: school isolation check (explicit PUBLIC guard for clarity)
    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    const attendance = await prisma.liveClassAttendance.findMany({
      where: { liveClassId: req.params.id },
      include: { student: { include: { user: { select: userSelect } } } },
      orderBy: { joinedAt: 'asc' }
    });
    return successResponse(res, attendance);
  } catch (e) { next(e); }
}

//  TOGGLE OPEN MIC 
async function toggleOpenMic(req, res, next) {
  try {
    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    // Only HOST or MODERATOR can toggle open mic
    await assertOwnerOrModerator(lc, req, prisma);
    if (lc.status === 'ENDED') return errorResponse(res, 'Class has ended', 400);

    // BUG FIX: renamed from 'next' to 'newOpenMic' to avoid shadowing the Express
    // error-handler parameter 'next', which caused unhandled errors to be swallowed.
    const newOpenMic = !lc.isOpenMic;
    await prisma.$executeRawUnsafe(`UPDATE live_classes SET isOpenMic = ?, updatedAt = NOW() WHERE id = ?`, newOpenMic ? 1 : 0, lc.id)
const updated = await findLiveClass(lc.id);

    // If enabling open mic, unmute all active student participants in DB
    if (newOpenMic) {
      await prisma.liveClassParticipant.updateMany({
        where: { liveClassId: lc.id, isActive: true, role: { not: 'HOST' } },
        data: { isMuted: false }
      });
    }

    const io = getIo();
    if (io) {
      io.to(`liveclass:${lc.id}`).emit('liveclass:open_mic_changed', {
        liveClassId: lc.id,
        isOpenMic: newOpenMic
      });
    }
    return successResponse(res, updated, newOpenMic ? 'Open mic enabled' : 'Open mic disabled');
  } catch (e) { next(e); }
}

//  UNMUTE SELF (student requests to speak) 
async function requestSpeak(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    // P0-01: school isolation check (explicit PUBLIC guard for clarity)
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);
    const io = getIo();
    if (io) io.to(`liveclass:${id}`).emit('liveclass:speak_request', {
      liveClassId: id, userId,
      firstName: req.user.firstName, lastName: req.user.lastName
    });
    return successResponse(res, null, 'Speak request sent');
  } catch (e) { next(e); }
}

// ─── RECORDING ────────────────────────────────────────────────────────────────

//  START RECORDING
async function startRecording(req, res, next) {
  try {
    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req); // P0-01
    if (lc.status !== 'LIVE') return errorResponse(res, 'Class must be live to record', 400);
    if (lc.recordingStartedAt) return errorResponse(res, 'Recording already in progress', 400);

    await prisma.$executeRawUnsafe(`UPDATE live_classes SET isRecorded = 1, recordingStartedAt = NOW(), updatedAt = NOW() WHERE id = ?`, lc.id)
const updated = await findLiveClass(lc.id);

    const io = getIo();
    if (io) io.to(`liveclass:${lc.id}`).emit('liveclass:recording_started', { liveClassId: lc.id });
    liveClassAudit(req.user.id, 'RECORD_START', lc.id, { title: lc.title }).catch(() => {});
    return successResponse(res, updated, 'Recording started');
  } catch (e) { next(e); }
}

//  STOP RECORDING
async function stopRecording(req, res, next) {
  try {
    const { recordingUrl } = req.body;
    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req); // P0-01
    if (!lc.recordingStartedAt) return errorResponse(res, 'No recording in progress', 400);

    await prisma.$executeRawUnsafe(`UPDATE live_classes SET recordingUrl = ?, recordingStartedAt = NULL, updatedAt = NOW() WHERE id = ?`, recordingUrl || null, lc.id)
const updated = await findLiveClass(lc.id);

    const io = getIo();
    if (io) io.to(`liveclass:${lc.id}`).emit('liveclass:recording_stopped', { liveClassId: lc.id, recordingUrl });
    liveClassAudit(req.user.id, 'RECORD_STOP', lc.id, { title: lc.title }).catch(() => {});
    return successResponse(res, updated, 'Recording stopped');
  } catch (e) { next(e); }
}
// ─── Poll DB helpers (LC-GAP-004: durable persistence) ─────────────────────
// These functions shadow-write poll state to MySQL so data survives Redis flush.
// All operations are non-fatal — failure is logged as warn, never thrown.

async function _dbUpsertPoll(liveClassId, poll, createdBy) {
  try {
    const { v4: newId } = require('uuid');
    const existing = await prisma.$queryRawUnsafe(
      'SELECT id FROM live_class_polls WHERE id = ? LIMIT 1', poll.id
    );
    if (existing && existing.length > 0) return; // already exists
    await prisma.$executeRawUnsafe(
      'INSERT INTO live_class_polls (id, liveClassId, question, options, isActive, createdBy, createdAt, updatedAt) VALUES (?,?,?,?,1,?,NOW(),NOW())',
      poll.id, liveClassId, poll.question ?? '', JSON.stringify(poll.options ?? []), createdBy
    );
  } catch (err) {
    logger.warn(`[poll-db] upsert failed: ${err.message}`);
  }
}

async function _dbUpdatePollOptions(pollId, options) {
  try {
    await prisma.$executeRawUnsafe(
      'UPDATE live_class_polls SET options = ?, updatedAt = NOW() WHERE id = ?',
      JSON.stringify(options), pollId
    );
  } catch (err) {
    logger.warn(`[poll-db] options update failed: ${err.message}`);
  }
}

async function _dbClosePoll(pollId) {
  try {
    await prisma.$executeRawUnsafe(
      'UPDATE live_class_polls SET isActive = 0, updatedAt = NOW() WHERE id = ?', pollId
    );
  } catch (err) {
    logger.warn(`[poll-db] close failed: ${err.message}`);
  }
}

async function _dbLoadPolls(liveClassId) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT id, question, options, isActive FROM live_class_polls WHERE liveClassId = ? ORDER BY createdAt DESC', liveClassId
    );
    return rows.map(r => ({
      id:       r.id,
      question: r.question,
      options:  typeof r.options === 'string' ? JSON.parse(r.options) : r.options,
      isActive: !!r.isActive,
    }));
  } catch (err) {
    logger.warn(`[poll-db] load failed: ${err.message}`);
    return [];
  }
}

// ─── Whiteboard DB helpers (LC-GAP-005: durable persistence) ────────────────

async function _dbSaveWhiteboardSnapshot(liveClassId, strokesJson) {
  try {
    const { v4: newId } = require('uuid');
    // UPSERT: one row per live class, keyed on liveClassId
    const existing = await prisma.$queryRawUnsafe(
      'SELECT id FROM live_class_whiteboard_snapshots WHERE liveClassId = ? LIMIT 1', liveClassId
    );
    if (existing && existing.length > 0) {
      await prisma.$executeRawUnsafe(
        'UPDATE live_class_whiteboard_snapshots SET strokes = ?, snapshotAt = NOW(), updatedAt = NOW() WHERE liveClassId = ?',
        strokesJson, liveClassId
      );
    } else {
      await prisma.$executeRawUnsafe(
        'INSERT INTO live_class_whiteboard_snapshots (id, liveClassId, strokes, snapshotAt, updatedAt) VALUES (?,?,?,NOW(),NOW())',
        newId(), liveClassId, strokesJson
      );
    }
  } catch (err) {
    logger.warn(`[whiteboard-db] save failed: ${err.message}`);
  }
}

async function _dbClearWhiteboardSnapshot(liveClassId) {
  try {
    await prisma.$executeRawUnsafe(
      'DELETE FROM live_class_whiteboard_snapshots WHERE liveClassId = ?', liveClassId
    );
  } catch (err) {
    logger.warn(`[whiteboard-db] clear failed: ${err.message}`);
  }
}

async function _dbLoadWhiteboardSnapshot(liveClassId) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT strokes FROM live_class_whiteboard_snapshots WHERE liveClassId = ? LIMIT 1', liveClassId
    );
    if (rows && rows.length > 0) return rows[0].strokes;
    return null;
  } catch (err) {
    logger.warn(`[whiteboard-db] load failed: ${err.message}`);
    return null;
  }
}


// ─── POLL RELAY ────────────────────────────────────────────────────────────────
// Polls are managed client-side and relayed via socket events.
// LC-003 FIX: Poll state is now persisted to Redis so that:
//   1. Students joining mid-class can load the current poll list.
//   2. The teacher refreshing their browser does not lose poll data.
// Cache key: `polls:{liveClassId}` — stores the full polls array.
// TTL: 4 hours (matches LiveKit token TTL).
async function broadcastPoll(req, res, next) {
  try {
    const { event } = req.body;
    if (!event) return errorResponse(res, 'event required', 400);

    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req); // P0-01

    // ── Persist poll state to Redis ──────────────────────────────────────────
    const cacheKey = `polls:${lc.id}`;
    try {
      const { isRedisReady, getCache, setCache, deleteCache } = require('../utils/redis');
      if (isRedisReady()) {
        // Read current polls array from cache (default to empty array)
        const currentPolls = (await getCache(cacheKey)) ?? [];

        let updatedPolls = currentPolls;

        if (event.type === 'create' && event.poll) {
          // Add new poll if not already present (idempotent)
          const exists = currentPolls.some(p => p.id === event.poll.id);
          if (!exists) {
            updatedPolls = [event.poll, ...currentPolls];
          }
        } else if (event.type === 'vote' && event.pollId && event.optionId) {
          // SEC-07 FIX: Use req.user.id (JWT-verified) as voter identity.
          // Previously used event.userId from the request body — allowing a client
          // to bypass duplicate-vote detection by sending different userId values.
          const voterId = req.user.id;
          // Apply vote to the cached poll
          updatedPolls = currentPolls.map(p => {
            if (p.id !== event.pollId) return p;
            return {
              ...p,
              options: p.options.map(o => {
                if (o.id !== event.optionId) return o;
                const already = o.votes.includes(voterId);
                return { ...o, votes: already ? o.votes : [...o.votes, voterId] };
              }),
            };
          });
        } else if (event.type === 'close' && event.pollId) {
          // Mark poll as closed
          updatedPolls = currentPolls.map(p =>
            p.id === event.pollId ? { ...p, isActive: false } : p
          );
        }

        // Write updated polls back to cache (4h TTL — longer than any single class)
        await setCache(cacheKey, updatedPolls, 4 * 60 * 60);
        // LC-GAP-004: Shadow-write to DB so polls survive Redis flush
        if (event.type === 'create' && event.poll) {
          _dbUpsertPoll(lc.id, event.poll, req.user.id).catch(() => {});
        } else if (event.type === 'vote' && event.pollId) {
          const _pv = updatedPolls.find(p => p.id === event.pollId);
          if (_pv) _dbUpdatePollOptions(event.pollId, _pv.options).catch(() => {});
        } else if (event.type === 'close' && event.pollId) {
          _dbClosePoll(event.pollId).catch(() => {});
        }
      }
    } catch (cacheErr) {
      // Non-fatal — polls still work in real-time via socket, cache is best-effort
      logger.warn(`[poll] Redis cache error: ${cacheErr.message}`);
    }

    // Broadcast to all room participants
    // SEC-07: Normalise the emitted event to use req.user.id as voter identity
    // so all clients receive the authoritative identity, not the client-supplied one.
    const normalizedEvent = (event.type === 'vote')
      ? { ...event, userId: req.user.id }
      : event;
    const io = getIo();
    if (io) io.to(`liveclass:${lc.id}`).emit('liveclass:poll', { liveClassId: lc.id, event: normalizedEvent });
    return successResponse(res, null, 'Poll event broadcast');
  } catch (e) { next(e); }
}

// ─── GET POLL STATE ──────────────────────────────────────────────────────────
// Returns the cached polls array for a live class.
// Called by students joining mid-class to load current poll state.
async function getPollState(req, res, next) {
  try {
    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req); // P0-01

    const cacheKey = `polls:${lc.id}`;
    let polls = [];

    try {
      const { isRedisReady, getCache } = require('../utils/redis');
      if (isRedisReady()) {
        polls = (await getCache(cacheKey)) ?? [];
      }
    } catch (cacheErr) {
      logger.warn(`[poll] Redis read error: ${cacheErr.message}`);
    }

    // LC-GAP-004: Fall back to DB when Redis is empty or unavailable
    if (!polls || polls.length === 0) {
      polls = await _dbLoadPolls(lc.id);
    }
    return successResponse(res, { polls });
  } catch (e) { next(e); }
}

// ─── WHITEBOARD RELAY ─────────────────────────────────────────────────────────
// Draw events are broadcast to the room via this endpoint (host only).
// Snapshot events (type: 'snapshot') are also persisted to Redis so late-joining
// students can load the current whiteboard state without replaying all strokes.
async function broadcastDraw(req, res, next) {
  try {
    const { event } = req.body;
    if (!event) return errorResponse(res, 'event required', 400);

    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req); // P0-01

    // ── Persist whiteboard state to Redis ────────────────────────────────────
    // Snapshot: host sends canvas.toDataURL() as event.dataUrl — store it.
    // Clear: host wiped the board — delete the stored snapshot.
    const cacheKey = `whiteboard:${lc.id}`;
    try {
      const { isRedisReady, setCache, deleteCache } = require('../utils/redis');
      if (isRedisReady()) {
        if (event.type === 'snapshot' && event.dataUrl) {
          // SEC-06 FIX: Reject oversized snapshots before writing to Redis.
          // An 800×450 canvas at 24-bit = ~55 KB base64; 200,000 chars ≈ 150 KB.
          // A malicious host could exhaust Redis memory with arbitrarily large payloads.
          if (event.dataUrl.length > 200_000) {
            return errorResponse(res, 'Snapshot payload too large (max 200,000 characters)', 413);
          }
          // TTL: 4 hours (matches LiveKit token TTL) — auto-expires after class ends
          await setCache(cacheKey, { dataUrl: event.dataUrl }, 4 * 60 * 60);
          // LC-GAP-005: Shadow-write strokes/snapshot to DB
          if (event.strokes) _dbSaveWhiteboardSnapshot(lc.id, JSON.stringify(event.strokes)).catch(() => {});
        } else if (event.type === 'clear') {
          await deleteCache(cacheKey);
        }
      }
    } catch (cacheErr) {
      // Non-fatal — whiteboard still works in real-time, snapshot just won't persist
      require('../utils/logger').warn(`[whiteboard] Redis cache error: ${cacheErr.message}`);
    }

    const io = getIo();
    if (io) io.to(`liveclass:${lc.id}`).emit('liveclass:draw', { liveClassId: lc.id, event });
    return successResponse(res, null, 'Draw event broadcast');
  } catch (e) { next(e); }
}

// ─── WHITEBOARD STATE ─────────────────────────────────────────────────────────
// Returns the last saved snapshot so students who join mid-class can catch up.
async function getWhiteboardState(req, res, next) {
  try {
    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req); // P0-01

    const cacheKey = `whiteboard:${lc.id}`;
    let snapshot = null;

    try {
      const { isRedisReady, getCache } = require('../utils/redis');
      if (isRedisReady()) {
        snapshot = await getCache(cacheKey);
      }
    } catch (cacheErr) {
      require('../utils/logger').warn(`[whiteboard] Redis read error: ${cacheErr.message}`);
    }

    // LC-GAP-005: Fall back to DB strokes when Redis snapshot is absent
    if (!snapshot) {
      const _dbStrokes = await _dbLoadWhiteboardSnapshot(lc.id);
      if (_dbStrokes) snapshot = { strokes: _dbStrokes };
    }
    // snapshot is { dataUrl } (Redis) or { strokes } (DB) or null
    return successResponse(res, {
      snapshot: snapshot?.dataUrl ?? null,
      strokes:  snapshot?.strokes  ?? null,
    });
  } catch (e) { next(e); }
}

// ─── QURAN SYNC RELAY ─────────────────────────────────────────────────────────
// Host calls this to sync Quran position to all students.
async function broadcastQuranPosition(req, res, next) {
  try {
    const { surahNumber, ayahNumber } = req.body;
    if (!surahNumber || !ayahNumber) return errorResponse(res, 'surahNumber and ayahNumber required', 400);

    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req); // P0-01
    if (!lc.quranPanelEnabled) return errorResponse(res, 'Quran panel is not enabled', 400);

    const io = getIo();
    if (io) io.to(`liveclass:${lc.id}`).emit('liveclass:quran_position', {
      liveClassId: lc.id, surahNumber, ayahNumber
    });
    return successResponse(res, null, 'Quran position synced');
  } catch (e) { next(e); }
}

//  DELETE CHAT MESSAGE ───────────────────────────────────────────────────────
async function deleteMessage(req, res, next) {
  try {
    const { id: liveClassId, messageId } = req.params;
    const userId = req.user.id;

    // FINAL-AUTH-01: deleteMessage host check uses participant record role,
    // not global school role. HOST or MODERATOR in the session can delete any message.
    // The global-role check is used only as a fallback for non-joined staff.
    // P0-01: school isolation check — fetch lc before any data access
    const lc = await findLiveClass(liveClassId);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);

    const msg = await prisma.liveClassMessage.findFirst({
      where: { id: messageId, liveClassId, deletedAt: null }
    });
    if (!msg) return errorResponse(res, 'Message not found', 404);

    // PES-001 FIX: Authorization to delete another user's message is now based
    // on the caller's live-class PARTICIPANT ROLE, not on their school/global role.
    //
    // Old behavior: isHost = ['TEACHER','SCHOOL_ADMIN'].includes(getEffectiveRole(req))
    //   → a school teacher could delete any participant's message on a PUBLIC stream
    //     they never joined, because their User.role granted "host" authority.
    //
    // New behavior:
    //   - Message author can always delete their own message (unchanged).
    //   - Deleting ANOTHER user's message requires an active participant record
    //     with role HOST or MODERATOR in THIS stream.
    //   - School role (TEACHER / SCHOOL_ADMIN) has no standalone authority here.
    //   - This applies to both PUBLIC and SCHOOL streams for consistency.
    //     (On SCHOOL streams, the staff member must still be an active participant
    //     with HOST/MODERATOR to delete others' messages.)
    if (msg.userId !== userId) {
      // Only HOST or MODERATOR participants may delete other users' messages
      const callerParticipant = await prisma.liveClassParticipant.findFirst({
        where: { liveClassId, userId, isActive: true },
        select: { role: true },
      });
      const isPrivileged =
        callerParticipant && ['HOST', 'MODERATOR'].includes(callerParticipant.role);
      if (!isPrivileged) {
        return errorResponse(res, 'Only the host, a moderator, or the message author can delete this message', 403);
      }
    }

    await prisma.liveClassMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date() }
    });

    const io = getIo();
    if (io) io.to(`liveclass:${liveClassId}`).emit('liveclass:message_deleted', {
      liveClassId, messageId
    });

    return successResponse(res, null, 'Message deleted');
  } catch (e) { next(e); }
}
/**
 * POST /live-classes/:id/cover
 * Teachers/admins upload a cover image for a live class.
 * Mirrors the voice room cover upload pattern.
 */
async function uploadCoverImage(req, res, next) {
  try {
    const { id } = req.params;

    if (!req.file) return errorResponse(res, 'No image file provided', 400);

    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req); // P0-01

    const path    = require('path');
    const { v4: uuidv4 } = require('uuid');
    const { saveFile, deleteFile } = require('../utils/storage');

    const ext      = path.extname(req.file.originalname).toLowerCase();
    const filename = `liveclass-cover-${uuidv4()}${ext}`;
    const { url: coverImageUrl } = await saveFile(
      req.file.buffer,
      filename,
      req.file.mimetype,
      'avatars'
    );

    // Delete old cover image if present
    if (lc.coverImageUrl) {
      await deleteFile(lc.coverImageUrl).catch(() => {});
    }

    await prisma.$executeRawUnsafe(`UPDATE live_classes SET coverImageUrl = ?, updatedAt = NOW() WHERE id = ?`, coverImageUrl, id)
    const updated = await findLiveClass(id);

    // Broadcast the update to anyone in the class room
    const io = getIo();
    if (io) {
      io.to(`liveclass:${id}`).emit('liveclass:updated', { liveClass: updated });
      if (lc.schoolId) {
        io.to(`school:${lc.schoolId}`).emit('liveclass:updated', { liveClass: updated });
      }
    }

    return successResponse(res, { coverImageUrl }, 'Cover image updated');
  } catch (e) { next(e); }
}


//  SET VIDEO STATE (participant toggles their own camera on/off) 
// Mirrors muteParticipant: persists isVideoOn to DB + notifies socket room.
// Called by the participant themselves — enforces self-only update.
async function setVideoState(req, res, next) {
  try {
    const { id, userId } = req.params;
    const { isVideoOn } = req.body;
    if (typeof isVideoOn !== 'boolean') return errorResponse(res, 'isVideoOn (boolean) is required', 400);

    // Security: the authenticated user can only update their own video state.
    // Hosts/admins do not set video state for others — the camera is purely self-managed.
    // LCSV-003 FIX: Removed SUPER_ADMIN bypass — video state is self-managed only.
    if (req.user.id !== userId) {
      return errorResponse(res, 'You can only update your own video state', 403);
    }

    // P0-01: school isolation check (explicit PUBLIC guard for clarity)
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);

    const p = await prisma.liveClassParticipant.findFirst({ where: { liveClassId: id, userId, isActive: true } });
    if (!p) return errorResponse(res, 'Participant not found', 404);

    await prisma.liveClassParticipant.update({ where: { id: p.id }, data: { isVideoOn } });

    const io = getIo();
    if (io) io.to(`liveclass:${id}`).emit('liveclass:video_changed', { liveClassId: id, userId, isVideoOn });

    return successResponse(res, null, isVideoOn ? 'Camera on' : 'Camera off');
  } catch (e) { next(e); }
}

// ─── MODERATOR MANAGEMENT ────────────────────────────────────────────────────
async function promoteToModerator(req, res, next) {
  try {
    const { id, userId } = req.params;
    const requesterId = req.user.id;
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);

    // Only the creator (HOST) can promote to moderator
    const isCreator = lc.hostUserId === requesterId ||
      (lc.teacher && lc.teacher.userId === requesterId);
    if (!isCreator) {
      // Check if they're HOST in participants
      const requesterP = await prisma.liveClassParticipant.findFirst({
        where: { liveClassId: id, userId: requesterId, isActive: true, role: 'HOST' }
      });
      if (!requesterP) return errorResponse(res, 'Only the host can promote moderators', 403);
    }

    const p = await prisma.liveClassParticipant.findFirst({
      where: { liveClassId: id, userId, isActive: true }
    });
    if (!p) return errorResponse(res, 'Participant not found or not active', 404);
    if (p.role === 'HOST') return errorResponse(res, 'Cannot promote the host', 400);

    await prisma.$executeRawUnsafe(
      `UPDATE live_class_participants SET role = 'MODERATOR', updatedAt = NOW() WHERE id = ?`,
      p.id
    );

    const io = getIo();
    if (io) io.to(`liveclass:${id}`).emit('liveclass:moderator_promoted', {
      liveClassId: id, userId, promotedBy: requesterId,
    });

    return successResponse(res, null, 'Participant promoted to moderator');
  } catch (e) { next(e); }
}

async function demoteModerator(req, res, next) {
  try {
    const { id, userId } = req.params;
    const requesterId = req.user.id;
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user, req);

    const isCreator = lc.hostUserId === requesterId ||
      (lc.teacher && lc.teacher.userId === requesterId);
    if (!isCreator) {
      const requesterP = await prisma.liveClassParticipant.findFirst({
        where: { liveClassId: id, userId: requesterId, isActive: true, role: 'HOST' }
      });
      if (!requesterP) return errorResponse(res, 'Only the host can demote moderators', 403);
    }

    const modRows = await prisma.$queryRawUnsafe(
      `SELECT id FROM live_class_participants WHERE liveClassId = ? AND userId = ? AND role = 'MODERATOR' LIMIT 1`,
      id, userId
    );
    if (!modRows || modRows.length === 0) return errorResponse(res, 'Participant is not a moderator', 404);

    await prisma.$executeRawUnsafe(
      `UPDATE live_class_participants SET role = 'STUDENT', updatedAt = NOW() WHERE id = ?`,
      modRows[0].id
    );

    const io = getIo();
    if (io) io.to(`liveclass:${id}`).emit('liveclass:moderator_demoted', {
      liveClassId: id, userId, demotedBy: requesterId,
    });

    return successResponse(res, null, 'Moderator role removed');
  } catch (e) { next(e); }
}

// ─── ADMIN TERMINATE ──────────────────────────────────────────────────────────
// POST /api/v1/admin/live-classes/:id/terminate
// SUPER_ADMIN only — force-ends any live class or public stream regardless of who
// created it. Needed for platform moderation (policy violations, abuse reports).
// Does NOT create a LiveClassParticipant record for the admin.
async function terminateLiveClass(req, res, next) {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
      return errorResponse(res, 'Forbidden — SUPER_ADMIN only', 403);
    }

    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.status === 'ENDED' || lc.status === 'CANCELLED') {
      return errorResponse(res, 'Stream is already ended', 400);
    }

    // Cancel any pending auto-end timer
    cancelAutoEnd(lc.id);

    await _endLiveClassById(lc);

    logger.info(`[admin-terminate] Live class ${lc.id} force-terminated by SUPER_ADMIN ${req.user.id}`);
    return successResponse(res, null, 'Stream terminated');
  } catch (e) { next(e); }
}

// ─── LS-GAP-003 FIX: Host transfer for live classes (PUBLIC streams) ──────────
// Transfers HOST role from the current host to an active participant.
//
// Rules:
//   - Only the current HOST can initiate the transfer (same as voice rooms)
//   - For PUBLIC streams: checked via lc.hostUserId match OR participant role = HOST
//   - For SCHOOL streams: checked via participant role = HOST
//   - Target must be an active participant in this class
//   - Target must not already be HOST
//   - Atomic: demote old host to STUDENT, promote target to HOST, update hostUserId (PUBLIC only)
//
// Route: POST /live-classes/:id/transfer/:userId
async function transferHost(req, res, next) {
  try {
    const { id: liveClassId, userId: targetUserId } = req.params;
    const callerId = req.user.id;

    if (targetUserId === callerId) {
      return errorResponse(res, 'Cannot transfer host to yourself', 400);
    }

    const lc = await findLiveClass(liveClassId);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.status === 'ENDED' || lc.status === 'CANCELLED') {
      return errorResponse(res, 'Cannot transfer host on an ended class', 400);
    }

    // Verify caller is currently the HOST
    // For PUBLIC streams: hostUserId must match OR participant record role = HOST
    const callerParticipant = await prisma.liveClassParticipant.findFirst({
      where: { liveClassId, userId: callerId, isActive: true },
      select: { id: true, role: true },
    });

    const isPublicHostByUserId = lc.streamType === 'PUBLIC' && lc.hostUserId === callerId;
    const isHostByParticipant  = callerParticipant?.role === 'HOST';

    if (!isPublicHostByUserId && !isHostByParticipant) {
      return errorResponse(res, 'Only the current host can transfer ownership', 403);
    }

    // Verify target is an active participant
    const targetParticipant = await prisma.liveClassParticipant.findFirst({
      where: { liveClassId, userId: targetUserId, isActive: true },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!targetParticipant) {
      return errorResponse(res, 'Target participant not found or not active in this class', 404);
    }
    if (targetParticipant.role === 'HOST') {
      return errorResponse(res, 'Target is already the host', 400);
    }

    // Atomic transfer — demote old host, promote target, update hostUserId for PUBLIC
    try {
      await prisma.$transaction(async (tx) => {
        // Demote old host → STUDENT (if they have a participant record)
        if (callerParticipant) {
          await tx.liveClassParticipant.update({
            where: { id: callerParticipant.id },
            data:  { role: 'STUDENT', updatedAt: new Date() },
          });
        }

        // Promote target → HOST
        await tx.liveClassParticipant.update({
          where: { id: targetParticipant.id },
          data:  { role: 'HOST', isMuted: false, updatedAt: new Date() },
        });

        // For PUBLIC streams: update host_user_id so future joins/token checks
        // recognise the new host. Use raw SQL (streamType column compatibility).
        if (lc.streamType === 'PUBLIC') {
          // Guard: only update if hostUserId still matches the caller (race protection)
          const updated = await tx.$executeRawUnsafe(
            `UPDATE live_classes SET host_user_id = ?, updatedAt = NOW() WHERE id = ? AND host_user_id = ?`,
            targetUserId, liveClassId, callerId
          );
          if (updated === 0) {
            const err = new Error('Host has already changed — transfer was rejected');
            err.status = 409;
            throw err;
          }
        }
      });
    } catch (txErr) {
      if (txErr.status) return errorResponse(res, txErr.message, txErr.status);
      throw txErr;
    }

    // Broadcast role changes to all room participants
    const io = getIo();
    if (io) {
      io.to(`liveclass:${liveClassId}`).emit('liveclass:host_transferred', {
        liveClassId,
        newHostId:   targetUserId,
        prevHostId:  callerId,
        newHostName: `${targetParticipant.user.firstName} ${targetParticipant.user.lastName}`,
      });
      // Individual role-change events so the client can update each participant tile
      io.to(`liveclass:${liveClassId}`).emit('liveclass:role_changed', {
        liveClassId, userId: targetUserId, role: 'HOST',
      });
      io.to(`liveclass:${liveClassId}`).emit('liveclass:role_changed', {
        liveClassId, userId: callerId, role: 'STUDENT',
      });
      // Direct notification to the new host
      io.to(`user:${targetUserId}`).emit('liveclass:you_are_host', {
        liveClassId,
        message: 'You are now the host of this stream!',
      });
    }

    logger.info(`[live-class] Host transferred in ${liveClassId}: ${callerId} → ${targetUserId}`);

    return successResponse(res, {
      liveClassId,
      newHostId:  targetUserId,
      prevHostId: callerId,
      newHostRole: 'HOST',
      prevHostRole: 'STUDENT',
    }, `Host transferred to ${targetParticipant.user.firstName} ${targetParticipant.user.lastName}`);
  } catch (err) { next(err); }
}

module.exports = {
  listLiveClasses, getLiveClass, createLiveClass, updateLiveClass, deleteLiveClass,
  startLiveClass, endLiveClass, joinLiveClass, leaveLiveClass, getLiveKitToken,
  getParticipants, muteParticipant, muteAll, unmuteAll, kickParticipant,
  raiseHand, lowerHand, approveHand, rejectHand, getHandQueue, lowerAllHands,
  dropMic, demoteSpeaker, inviteToStage,
  sendMessage, getMessages, deleteMessage, getAttendance, requestSpeak, toggleOpenMic,
  startRecording, stopRecording, broadcastPoll, getPollState, broadcastDraw, getWhiteboardState,
  broadcastQuranPosition, uploadCoverImage, setVideoState,
  promoteToModerator, demoteModerator,
  terminateLiveClass,
  transferHost,
  // GAP-04: exported so app.js can call scheduleAutoEnd during startup recovery
  scheduleAutoEnd,
};
