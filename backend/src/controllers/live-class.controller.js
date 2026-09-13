const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse, getPagination, buildPaginationMeta } = require('../utils/response');
const { getIo } = require('../sockets');
const { broadcastLiveStart, broadcastLiveEnd } = require('../utils/feedLive');
const { queueBulkNotifications } = require('../services/queue.service');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

const userSelect = { id: true, firstName: true, lastName: true, avatarUrl: true, role: true };

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
      maxParticipants, isRecorded,
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
    data.maxParticipants     ?? null,
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
    title:            row.title,
    description:      row.description ?? null,
    scheduledAt:      row.scheduledAt ?? null,
    duration:         row.duration    ?? null,
    status:           row.status,
    livekitRoomName:  row.livekitRoomName ?? null,
    recordingUrl:     row.recordingUrl    ?? null,
    coverImageUrl:    row.coverImageUrl   ?? null,
    maxParticipants:  row.maxParticipants ?? null,
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
             host_user_id as hostUserId, title, description, status,
             livekitRoomName, duration, chatEnabled, handRaiseEnabled,
             whiteboardEnabled, quranPanelEnabled, isOpenMic, screenShareEnabled,
             maxParticipants, isRecorded, recordingStartedAt,
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
function assertSchoolAccess(lc, user) {
  if (lc.streamType === 'PUBLIC') return;   // PUBLIC streams are open to all
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

// ─── Host access guard (GAP-01: defence-in-depth for bulk moderation) ────────
// Verifies the caller is the HOST of the given live class.
// ARCH-01: SUPER_ADMIN no longer gets an implicit bypass — they must be the
// actual host (via hostUserId) or a school member with staff role.
function assertHostAccess(lc, user) {
  if (lc.streamType === 'PUBLIC') {
    // PUBLIC streams: only the original host may perform bulk moderation
    if (lc.hostUserId !== user.id) {
      const err = new Error('Only the host can perform this action on a public stream');
      err.status = 403;
      throw err;
    }
    return;
  }
  // SCHOOL streams: school isolation is already checked by assertSchoolAccess above;
  // re-apply school membership as defence-in-depth
  if (user.role !== 'SCHOOL_ADMIN' && lc.schoolId !== user.schoolId) {
    const err = new Error('Access denied to this school\'s resource');
    err.status = 403;
    throw err;
  }
}


// between leaveLiveClass() and the auto-end cron in app.js.
const MIN_PRESENT_MINUTES = 10;

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
const autoEndTimers = new Map(); // liveClassId → NodeJS.Timeout

async function _endLiveClassById(lc) {
  const now = new Date();
  const active = await prisma.liveClassParticipant.findMany({
    where: { liveClassId: lc.id, isActive: true }
  });
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`UPDATE live_classes SET status = 'ENDED', endedAt = NOW(), updatedAt = NOW() WHERE id = ?`, lc.id),
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
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user);

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
      quranPanelEnabled = false, isRecorded = false,
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
        maxParticipants: null,   // unlimited
        isRecorded,
        status: 'SCHEDULED',
        isOpenMic: true,
        screenShareEnabled: true,
      });

      const io = getIo();
      if (io) io.to('feed:public').emit('liveclass:scheduled', { liveClass: lc });

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
      quranPanelEnabled, maxParticipants: null, isRecorded,
      status: 'SCHEDULED',
      isOpenMic: false,
      screenShareEnabled: true,
    });

    const io = getIo();
    if (io) io.to(`school:${lc.schoolId}`).emit('liveclass:scheduled', { liveClass: lc });

    return successResponse(res, lc, 'Live class created', 201);
  } catch (e) { next(e); }
}

//  UPDATE 
async function updateLiveClass(req, res, next) {
  try {
    const lc = await rawFindLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user);
    if (lc.status === 'ENDED' || lc.status === 'CANCELLED') return errorResponse(res, 'Cannot edit ended/cancelled class', 400);

    const allowed = ['title','description','scheduledAt','duration','chatEnabled',
      'handRaiseEnabled','whiteboardEnabled','quranPanelEnabled','maxParticipants',
      'isRecorded','isOpenMic','screenShareEnabled'];
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
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user);
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
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user);
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

    return successResponse(res, updated, 'Class started');
  } catch (e) { next(e); }
}

//  END 
async function endLiveClass(req, res, next) {
  try {
    const lc = await rawFindLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user);
    if (lc.status !== 'LIVE') return errorResponse(res, 'Class is not live', 400);

    // BUG-05 FIX: Cancel any pending auto-end timer before manually ending.
    cancelAutoEnd(lc.id);

    const now = new Date();

    // mark all active participants inactive + update attendance
    const active = await prisma.liveClassParticipant.findMany({
      where: { liveClassId: lc.id, isActive: true }
    });

    await prisma.$transaction([
      prisma.$executeRawUnsafe(`UPDATE live_classes SET status = 'ENDED', endedAt = NOW(), updatedAt = NOW() WHERE id = ?`, lc.id),
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
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user);
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
    const isTeacher = req.user.role === 'TEACHER' || req.user.role === 'SCHOOL_ADMIN';
    const isStaff = ['TEACHER', 'SCHOOL_ADMIN'].includes(effectiveRole);

    // Normalise streamType — old rows and mocks may not have it set
    const streamType = lc.streamType || 'SCHOOL';

    // For PUBLIC streams: the original host gets HOST role, everyone else is STUDENT/AUDIENCE
    const isPublicHost = streamType === 'PUBLIC' && lc.hostUserId === userId;
    const role = (isTeacher || isStaff || isPublicHost) ? 'HOST' : 'STUDENT';

    let student = null;

    // Enrollment check — only applies to SCHOOL streams for non-staff
    if (streamType === 'SCHOOL' && !isTeacher && !isStaff) {
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

      const currentCount = await prisma.liveClassParticipant.count({
        where: { liveClassId: lc.id, isActive: true }
      });
      // null = unlimited; only enforce when a positive cap is set
      if (lc.maxParticipants != null && currentCount >= lc.maxParticipants) {
        return errorResponse(res, `Class is full (max ${lc.maxParticipants} participants)`, 403);
      }
    }

    // For PUBLIC streams: anyone can join
    if (streamType === 'PUBLIC' && !isPublicHost) {
      const existingRecord = await prisma.liveClassParticipant.findFirst({
        where: { liveClassId: lc.id, userId },
        select: { wasKicked: true },
      });
      if (existingRecord?.wasKicked) {
        return errorResponse(res, 'You have been removed from this stream by the host', 403);
      }
      // null = unlimited; only enforce when a positive cap is set
      if (lc.maxParticipants != null) {
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
      create: { liveClassId: lc.id, userId, role, isMuted: !(isTeacher || isStaff || isPublicHost || lc.isOpenMic), isActive: true },
      update: { isActive: true, joinedAt: new Date(), leftAt: null, isMuted: !(isTeacher || isStaff || isPublicHost || lc.isOpenMic) },
      include: { user: { select: userSelect } }
    });

    const io = getIo();

    // Auto-start if host joins a SCHEDULED stream
    const isHost = isTeacher || isStaff || isPublicHost;
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
    if (streamType === 'SCHOOL' && !isTeacher && !isStaff && student) {
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
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user);

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
    return successResponse(res, null, 'Left class');
  } catch (e) { next(e); }
}

//  LIVEKIT TOKEN 
async function getLiveKitToken(req, res, next) {
  try {
    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user);
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
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user);
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
    if (lc.streamType !== 'PUBLIC') assertSchoolAccess(lc, req.user);
    const p = await prisma.liveClassParticipant.findFirst({ where: { liveClassId: id, userId, isActive: true } });
    if (!p) return errorResponse(res, 'Participant not found', 404);
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
    assertSchoolAccess(lc, req.user);

    // Allow HOST or MODERATOR (participant record is authoritative for role)
    const caller = await prisma.liveClassParticipant.findFirst({
      where: { liveClassId: id, userId: req.user.id, isActive: true },
    });
    const isHostOrModerator = caller && (caller.role === 'HOST' || caller.role === 'MODERATOR');
    if (!isHostOrModerator) {
      return errorResponse(res, 'Only the host or moderator can mute all', 403);
    }

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
    assertSchoolAccess(lc, req.user);

    // Allow HOST or MODERATOR (participant record is authoritative for role)
    const caller = await prisma.liveClassParticipant.findFirst({
      where: { liveClassId: id, userId: req.user.id, isActive: true },
    });
    const isHostOrModerator = caller && (caller.role === 'HOST' || caller.role === 'MODERATOR');
    if (!isHostOrModerator) {
      return errorResponse(res, 'Only the host or moderator can unmute all', 403);
    }

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
    // P0-01: school isolation check
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    assertSchoolAccess(lc, req.user);
    // GAP-01: defence-in-depth host ownership check
    assertHostAccess(lc, req.user);
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
    // P0-01: school isolation check — fetch lc to verify school ownership
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    assertSchoolAccess(lc, req.user);
    const p = await prisma.liveClassParticipant.findFirst({ where: { liveClassId: id, userId, isActive: true } });
    if (!p) return errorResponse(res, 'Participant not found', 404);
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
    return successResponse(res, null, 'Participant kicked');
  } catch (e) { next(e); }
}

//  RAISE HAND 
async function raiseHand(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const now = new Date();
    // P0-01: school isolation check
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    assertSchoolAccess(lc, req.user);
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
    // P0-01: school isolation check
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    assertSchoolAccess(lc, req.user);
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
    // P0-01: school isolation check
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    assertSchoolAccess(lc, req.user);
    await prisma.liveClassHandQueue.updateMany({ where: { liveClassId: id, userId, status: 'WAITING' }, data: { status: 'APPROVED' } });
    await prisma.liveClassParticipant.updateMany({ where: { liveClassId: id, userId }, data: { handRaised: false, isMuted: false } });
    const io = getIo();
    if (io) {
      io.to(`liveclass:${id}`).emit('liveclass:hand_approved', { liveClassId: id, userId });
      io.to(`user:${userId}`).emit('liveclass:you_can_speak', { liveClassId: id });
    }
    return successResponse(res, null, 'Hand approved  mic unmuted');
  } catch (e) { next(e); }
}

//  REJECT HAND 
async function rejectHand(req, res, next) {
  try {
    const { id, userId } = req.params;
    // P0-01: school isolation check
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    assertSchoolAccess(lc, req.user);
    await prisma.liveClassHandQueue.updateMany({ where: { liveClassId: id, userId, status: 'WAITING' }, data: { status: 'REJECTED' } });
    await prisma.liveClassParticipant.updateMany({ where: { liveClassId: id, userId }, data: { handRaised: false } });
    const io = getIo();
    if (io) io.to(`liveclass:${id}`).emit('liveclass:hand_rejected', { liveClassId: id, userId });
    return successResponse(res, null, 'Hand rejected');
  } catch (e) { next(e); }
}

//  HAND QUEUE 
async function getHandQueue(req, res, next) {
  try {
    // P0-01: school isolation check
    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    assertSchoolAccess(lc, req.user);
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
    assertSchoolAccess(lc, req.user); // P0-01
    if (!lc.chatEnabled) return errorResponse(res, 'Chat is disabled', 403);

    // Verify the sender is an active participant or the teacher/admin of this class
    // LCSV-002 FIX: Removed 'SUPER_ADMIN' — sending messages requires school staff
    // membership or active participant status, not a platform admin role.
    const isTeacherOrAdmin = ['TEACHER', 'SCHOOL_ADMIN'].includes(getEffectiveRole(req));
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
    // P0-01: school isolation check
    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    assertSchoolAccess(lc, req.user);
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
    // P0-01: school isolation check
    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    assertSchoolAccess(lc, req.user);
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
    assertSchoolAccess(lc, req.user); // P0-01
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
    // P0-01: school isolation check
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    assertSchoolAccess(lc, req.user);
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
    assertSchoolAccess(lc, req.user); // P0-01
    if (lc.status !== 'LIVE') return errorResponse(res, 'Class must be live to record', 400);
    if (lc.recordingStartedAt) return errorResponse(res, 'Recording already in progress', 400);

    await prisma.$executeRawUnsafe(`UPDATE live_classes SET isRecorded = 1, recordingStartedAt = NOW(), updatedAt = NOW() WHERE id = ?`, lc.id)
const updated = await findLiveClass(lc.id);

    const io = getIo();
    if (io) io.to(`liveclass:${lc.id}`).emit('liveclass:recording_started', { liveClassId: lc.id });
    return successResponse(res, updated, 'Recording started');
  } catch (e) { next(e); }
}

//  STOP RECORDING
async function stopRecording(req, res, next) {
  try {
    const { recordingUrl } = req.body;
    const lc = await findLiveClass(req.params.id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    assertSchoolAccess(lc, req.user); // P0-01
    if (!lc.recordingStartedAt) return errorResponse(res, 'No recording in progress', 400);

    await prisma.$executeRawUnsafe(`UPDATE live_classes SET recordingUrl = ?, recordingStartedAt = NULL, updatedAt = NOW() WHERE id = ?`, recordingUrl || null, lc.id)
const updated = await findLiveClass(lc.id);

    const io = getIo();
    if (io) io.to(`liveclass:${lc.id}`).emit('liveclass:recording_stopped', { liveClassId: lc.id, recordingUrl });
    return successResponse(res, updated, 'Recording stopped');
  } catch (e) { next(e); }
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
    assertSchoolAccess(lc, req.user); // P0-01

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
    assertSchoolAccess(lc, req.user); // P0-01

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
    assertSchoolAccess(lc, req.user); // P0-01

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
    assertSchoolAccess(lc, req.user); // P0-01

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

    // snapshot is { dataUrl: 'data:image/png;base64,...' } or null
    return successResponse(res, { snapshot: snapshot?.dataUrl ?? null });
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
    assertSchoolAccess(lc, req.user); // P0-01
    if (!lc.quranPanelEnabled) return errorResponse(res, 'Quran panel is not enabled', 400);

    const io = getIo();
    if (io) io.to(`liveclass:${lc.id}`).emit('liveclass:quran_position', {
      liveClassId: lc.id, surahNumber, ayahNumber
    });
    return successResponse(res, null, 'Quran position synced');
  } catch (e) { next(e); }
}

// ─── DELETE CHAT MESSAGE ───────────────────────────────────────────────────────
async function deleteMessage(req, res, next) {
  try {
    const { id: liveClassId, messageId } = req.params;
    const userId = req.user.id;
    const isHost = ['TEACHER','SCHOOL_ADMIN'].includes(getEffectiveRole(req));
    // LCSV-002 FIX: Removed 'SUPER_ADMIN' — deleting chat messages as host requires
    // school staff membership or being the message author, not a platform admin role.

    // P0-01: school isolation check — fetch lc before any data access
    const lc = await findLiveClass(liveClassId);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    assertSchoolAccess(lc, req.user);

    const msg = await prisma.liveClassMessage.findFirst({
      where: { id: messageId, liveClassId, deletedAt: null }
    });
    if (!msg) return errorResponse(res, 'Message not found', 404);

    // Only the message author or a host can delete
    if (msg.userId !== userId && !isHost) {
      return errorResponse(res, 'Only the host or the message author can delete this message', 403);
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
    assertSchoolAccess(lc, req.user); // P0-01

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

    // P0-01: school isolation check
    const lc = await findLiveClass(id);
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    assertSchoolAccess(lc, req.user);

    const p = await prisma.liveClassParticipant.findFirst({ where: { liveClassId: id, userId, isActive: true } });
    if (!p) return errorResponse(res, 'Participant not found', 404);

    await prisma.liveClassParticipant.update({ where: { id: p.id }, data: { isVideoOn } });

    const io = getIo();
    if (io) io.to(`liveclass:${id}`).emit('liveclass:video_changed', { liveClassId: id, userId, isVideoOn });

    return successResponse(res, null, isVideoOn ? 'Camera on' : 'Camera off');
  } catch (e) { next(e); }
}

module.exports = {
  listLiveClasses, getLiveClass, createLiveClass, updateLiveClass, deleteLiveClass,
  startLiveClass, endLiveClass, joinLiveClass, leaveLiveClass, getLiveKitToken,
  getParticipants, muteParticipant, muteAll, unmuteAll, kickParticipant,
  raiseHand, lowerHand, approveHand, rejectHand, getHandQueue, lowerAllHands,
  sendMessage, getMessages, deleteMessage, getAttendance, requestSpeak, toggleOpenMic,
  startRecording, stopRecording, broadcastPoll, getPollState, broadcastDraw, getWhiteboardState,
  broadcastQuranPosition, uploadCoverImage, setVideoState,
  // GAP-04: exported so app.js can call scheduleAutoEnd during startup recovery
  scheduleAutoEnd,
};
