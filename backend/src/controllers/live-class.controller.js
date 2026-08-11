const { AccessToken } = require('livekit-server-sdk');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse, getPagination, buildPaginationMeta } = require('../utils/response');
const { getIo } = require('../sockets');
const { broadcastLiveStart, broadcastLiveEnd } = require('../utils/feedLive');
const { queueBulkNotifications } = require('../services/queue.service');
const logger = require('../utils/logger');

const userSelect = { id: true, firstName: true, lastName: true, avatarUrl: true, role: true };

// LC-005 FIX: Named constant so the PRESENT/PARTIAL threshold is consistent
// between leaveLiveClass() and the auto-end cron in app.js.
const MIN_PRESENT_MINUTES = 10;

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
    const { classId, status, page = 1, limit = 20 } = req.query;
    const { skip } = getPagination(page, limit);
    const take = Math.min(100, Math.max(1, parseInt(limit)));
    const where = { deletedAt: null };
    if (req.user.role !== 'SUPER_ADMIN') where.schoolId = req.user.schoolId;
    if (classId) where.classId = classId;
    if (status) where.status = status;
    const [total, items] = await Promise.all([
      prisma.liveClass.count({ where }),
      prisma.liveClass.findMany({
        where: { ...where, teacher: { is: { id: { not: undefined } } } }, skip, take,
        orderBy: { scheduledAt: 'desc' },
        include: {
          teacher: { include: { user: { select: userSelect } } },
          class: { select: { id: true, name: true } },
          _count: { select: { participants: { where: { isActive: true } } } }
        }
      })
    ]);
    return successResponse(res, { items, pagination: buildPaginationMeta(total, +page, take) });
  } catch (e) { next(e); }
}

//  GET ONE 
async function getLiveClass(req, res, next) {
  try {
    const lc = await prisma.liveClass.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: {
        teacher: { include: { user: { select: userSelect } } },
        class: { select: { id: true, name: true, gradeLevel: true } },
        participants: {
          where: { isActive: true },
          include: { user: { select: userSelect } },
          orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }]
        },
        _count: { select: { participants: { where: { isActive: true } }, messages: true } }
      }
    });
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    return successResponse(res, lc);
  } catch (e) { next(e); }
}

//  CREATE 
async function createLiveClass(req, res, next) {
  try {
    const { classId, title, description, scheduledAt, duration = null,
      chatEnabled = true, handRaiseEnabled = true, whiteboardEnabled = true,
      quranPanelEnabled = false, maxParticipants = 100, isRecorded = false,
      teacherId: explicitTeacherId } = req.body;

    // Resolve teacherId:
    // 1. TEACHER role → use their own Teacher record.
    // 2. SCHOOL_ADMIN / SUPER_ADMIN:
    //    a. If they explicitly passed a teacherId in the body → use it.
    //    b. Otherwise → find any active teacher in the same school as a fallback.
    //    c. If no teacher exists in the school at all → proceed with null
    //       (requires teacherId to be nullable in schema; otherwise a migration is needed).
    const teacher = await prisma.teacher.findFirst({ where: { userId: req.user.id } });
    const isAdmin = ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(req.user.role);

    if (!teacher && !isAdmin) {
      return errorResponse(res, 'Only teachers and admins can create live classes', 403);
    }

    // Validate explicit teacherId if provided
    let resolvedTeacherId = teacher?.id ?? null;
    if (!resolvedTeacherId && explicitTeacherId) {
      const explicitTeacher = await prisma.teacher.findFirst({ where: { id: explicitTeacherId } });
      if (!explicitTeacher) return errorResponse(res, 'Teacher not found', 404);
      resolvedTeacherId = explicitTeacher.id;
    }

    // Admin fallback: pick first teacher in the school so the class can be created
    // without requiring the admin to manually select a teacher
    if (!resolvedTeacherId && isAdmin) {
      const schoolId = req.user.schoolId;
      const fallbackTeacher = schoolId
        ? await prisma.teacher.findFirst({
            where: { schoolId, user: { deletedAt: null } },
            orderBy: { createdAt: 'asc' },
          })
        : null;
      if (fallbackTeacher) {
        resolvedTeacherId = fallbackTeacher.id;
      } else {
        // No teachers exist in the school yet — reject with a helpful message
        return errorResponse(
          res,
          'No teachers found in this school. Please create a teacher account first, or pass a teacherId explicitly.',
          400,
        );
      }
    }

    const cls = await prisma.class.findFirst({ where: { id: classId, deletedAt: null } });
    if (!cls) return errorResponse(res, 'Class not found', 404);

    const lc = await prisma.liveClass.create({
      data: {
        schoolId: req.user.schoolId || cls.schoolId,
        classId,
        teacherId: resolvedTeacherId,
        title, description,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        duration, chatEnabled, handRaiseEnabled, whiteboardEnabled,
        quranPanelEnabled, maxParticipants, isRecorded,
        status: 'SCHEDULED'
      },
      include: { class: { select: { id: true, name: true } } }
    });

    // notify school
    const io = getIo();
    if (io) io.to(`school:${lc.schoolId}`).emit('liveclass:scheduled', { liveClass: lc });

    return successResponse(res, lc, 'Live class created', 201);
  } catch (e) { next(e); }
}

//  UPDATE 
async function updateLiveClass(req, res, next) {
  try {
    const lc = await prisma.liveClass.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.status === 'ENDED' || lc.status === 'CANCELLED') return errorResponse(res, 'Cannot edit ended/cancelled class', 400);

    const allowed = ['title','description','scheduledAt','duration','chatEnabled',
      'handRaiseEnabled','whiteboardEnabled','quranPanelEnabled','maxParticipants',
      'isRecorded','isOpenMic','screenShareEnabled'];
    const data = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) data[k] = req.body[k]; });
    if (data.scheduledAt) data.scheduledAt = new Date(data.scheduledAt);

    const updated = await prisma.liveClass.update({ where: { id: lc.id }, data });
    const io = getIo();
    if (io) io.to(`liveclass:${lc.id}`).emit('liveclass:updated', { liveClass: updated });
    return successResponse(res, updated);
  } catch (e) { next(e); }
}

//  DELETE 
async function deleteLiveClass(req, res, next) {
  try {
    const lc = await prisma.liveClass.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.status === 'LIVE') return errorResponse(res, 'End the class before deleting', 400);
    await prisma.liveClass.update({ where: { id: lc.id }, data: { deletedAt: new Date(), status: 'CANCELLED' } });
    return successResponse(res, null, 'Live class deleted');
  } catch (e) { next(e); }
}

//  START 
async function startLiveClass(req, res, next) {
  try {
    const lc = await prisma.liveClass.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.status === 'LIVE') return errorResponse(res, 'Class already live', 400);
    if (lc.status === 'ENDED') return errorResponse(res, 'Class already ended', 400);

    const livekitRoomName = `liveclass-${lc.id}`;
    const updated = await prisma.liveClass.update({
      where: { id: lc.id },
      data: { status: 'LIVE', startedAt: new Date(), livekitRoomName }
    });

    const io = getIo();
    if (io) {
      io.to(`school:${lc.schoolId}`).emit('liveclass:started', { liveClassId: lc.id, title: lc.title, classId: lc.classId });
      io.to(`class:${lc.classId}`).emit('liveclass:started', { liveClassId: lc.id, title: lc.title });
    }

    // Broadcast live class card into the social feed (fire-and-forget)
    broadcastLiveStart({
      refEntityType:    'live_class',
      refEntityId:      lc.id,
      authorId:         req.user.id,
      title:            lc.title,
      description:      lc.description,
      schoolId:         lc.schoolId,
      participantCount: 0,
    });

    // Notify enrolled students (fire-and-forget)
    _notifyStudentsLiveClassStart(lc.id, req.user.id, lc.classId, lc.title).catch(() => {});

    return successResponse(res, updated, 'Class started');
  } catch (e) { next(e); }
}

//  END 
async function endLiveClass(req, res, next) {
  try {
    const lc = await prisma.liveClass.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.status !== 'LIVE') return errorResponse(res, 'Class is not live', 400);

    const now = new Date();

    // mark all active participants inactive + update attendance
    const active = await prisma.liveClassParticipant.findMany({
      where: { liveClassId: lc.id, isActive: true }
    });

    await prisma.$transaction([
      prisma.liveClass.update({
        where: { id: lc.id },
        data: { status: 'ENDED', endedAt: now }
      }),
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
    const lc = await prisma.liveClass.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.status === 'ENDED' || lc.status === 'CANCELLED') return errorResponse(res, 'Class is not available', 400);

    const userId = req.user.id;
    const isTeacher = req.user.role === 'TEACHER' || req.user.role === 'SCHOOL_ADMIN' || req.user.role === 'SUPER_ADMIN';
    const role = isTeacher ? 'HOST' : 'STUDENT';

    // Enforce maxParticipants (hosts are exempt)
    if (!isTeacher) {
      const currentCount = await prisma.liveClassParticipant.count({
        where: { liveClassId: lc.id, isActive: true }
      });
      if (currentCount >= lc.maxParticipants) {
        return errorResponse(res, `Class is full (max ${lc.maxParticipants} participants)`, 403);
      }
    }

    // upsert participant
    const participant = await prisma.liveClassParticipant.upsert({
      where: { liveClassId_userId: { liveClassId: lc.id, userId } },
      create: { liveClassId: lc.id, userId, role, isMuted: !isTeacher && !lc.isOpenMic, isActive: true },
      update: { isActive: true, joinedAt: new Date(), leftAt: null, isMuted: !isTeacher && !lc.isOpenMic },
      include: { user: { select: userSelect } }
    });

    // auto-start if teacher joins a SCHEDULED class
    const io = getIo();
    if (isTeacher && lc.status === 'SCHEDULED') {
      await prisma.liveClass.update({
        where: { id: lc.id },
        data: { status: 'LIVE', startedAt: new Date(), livekitRoomName: `liveclass-${lc.id}` }
      });
      // Notify all connected clients that the class is now live
      if (io) {
        io.to(`school:${lc.schoolId}`).emit('liveclass:started', { liveClassId: lc.id, title: lc.title, classId: lc.classId });
        io.to(`class:${lc.classId}`).emit('liveclass:started', { liveClassId: lc.id, title: lc.title });
      }

      // Broadcast live card into feed
      broadcastLiveStart({
        refEntityType:    'live_class',
        refEntityId:      lc.id,
        authorId:         req.user.id,
        title:            lc.title,
        description:      lc.description,
        schoolId:         lc.schoolId,
        participantCount: 1,
      });

      // Notify enrolled students (fire-and-forget)
      _notifyStudentsLiveClassStart(lc.id, req.user.id, lc.classId, lc.title).catch(() => {});
    }

    // attendance for students
    if (!isTeacher) {
      const student = await prisma.student.findFirst({ where: { userId } });
      if (student) {
        await prisma.liveClassAttendance.upsert({
          where: { liveClassId_studentId: { liveClassId: lc.id, studentId: student.id } },
          create: { liveClassId: lc.id, studentId: student.id, status: 'PRESENT' },
          update: { joinedAt: new Date(), leftAt: null, status: 'PRESENT' }
        });
      }
    }

    if (io) {
      io.to(`liveclass:${lc.id}`).emit('liveclass:user_joined', {
        liveClassId: lc.id,
        userId, role,
        user: { id: userId, firstName: req.user.firstName, lastName: req.user.lastName, avatarUrl: req.user.avatarUrl }
      });
    }

    // Fetch updated liveClass with participants for the response
    const updatedLc = await prisma.liveClass.findFirst({
      where: { id: lc.id },
      include: {
        participants: {
          where: { isActive: true },
          include: { user: { select: userSelect } },
          orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }]
        }
      }
    });

    return successResponse(res, { participant, liveClass: updatedLc });
  } catch (e) { next(e); }
}

//  LEAVE 
async function leaveLiveClass(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const now = new Date();

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
    const lc = await prisma.liveClass.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.status === 'ENDED')     return errorResponse(res, 'Class has ended', 400);
    if (lc.status === 'CANCELLED') return errorResponse(res, 'Class was cancelled', 400);

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
    at.addGrant({
      roomJoin: true,
      room: lc.livekitRoomName || `liveclass-${lc.id}`,
      canPublish:           true,   // all participants can publish audio + video
      canSubscribe:         true,   // all participants can see/hear each other
      canPublishData:       true,
      canUpdateOwnMetadata: true
    });

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
    const p = await prisma.liveClassParticipant.findFirst({ where: { liveClassId: id, userId, isActive: true } });
    if (!p) return errorResponse(res, 'Participant not found', 404);
    await prisma.liveClassParticipant.update({ where: { id: p.id }, data: { isActive: false, leftAt: new Date() } });
    const io = getIo();
    if (io) {
      io.to(`liveclass:${id}`).emit('liveclass:kicked', { liveClassId: id, userId });
      io.to(`user:${userId}`).emit('liveclass:you_were_kicked', { liveClassId: id });
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

    const lc = await prisma.liveClass.findFirst({ where: { id, deletedAt: null } });
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (!lc.chatEnabled) return errorResponse(res, 'Chat is disabled', 403);

    // Verify the sender is an active participant or the teacher/admin of this class
    const isTeacherOrAdmin = ['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
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
    const lc = await prisma.liveClass.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.status === 'ENDED') return errorResponse(res, 'Class has ended', 400);

    // BUG FIX: renamed from 'next' to 'newOpenMic' to avoid shadowing the Express
    // error-handler parameter 'next', which caused unhandled errors to be swallowed.
    const newOpenMic = !lc.isOpenMic;
    const updated = await prisma.liveClass.update({
      where: { id: lc.id },
      data: { isOpenMic: newOpenMic }
    });

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
    const lc = await prisma.liveClass.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.status !== 'LIVE') return errorResponse(res, 'Class must be live to record', 400);
    if (lc.recordingStartedAt) return errorResponse(res, 'Recording already in progress', 400);

    const updated = await prisma.liveClass.update({
      where: { id: lc.id },
      data: { isRecorded: true, recordingStartedAt: new Date() }
    });

    const io = getIo();
    if (io) io.to(`liveclass:${lc.id}`).emit('liveclass:recording_started', { liveClassId: lc.id });
    return successResponse(res, updated, 'Recording started');
  } catch (e) { next(e); }
}

//  STOP RECORDING
async function stopRecording(req, res, next) {
  try {
    const { recordingUrl } = req.body;
    const lc = await prisma.liveClass.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (!lc.recordingStartedAt) return errorResponse(res, 'No recording in progress', 400);

    const updated = await prisma.liveClass.update({
      where: { id: lc.id },
      data: {
        recordingStartedAt: null,
        recordingUrl: recordingUrl || lc.recordingUrl,
      }
    });

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

    const lc = await prisma.liveClass.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!lc) return errorResponse(res, 'Live class not found', 404);

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
        } else if (event.type === 'vote' && event.pollId && event.optionId && event.userId) {
          // Apply vote to the cached poll
          updatedPolls = currentPolls.map(p => {
            if (p.id !== event.pollId) return p;
            return {
              ...p,
              options: p.options.map(o => {
                if (o.id !== event.optionId) return o;
                const already = o.votes.includes(event.userId);
                return { ...o, votes: already ? o.votes : [...o.votes, event.userId] };
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
    const io = getIo();
    if (io) io.to(`liveclass:${lc.id}`).emit('liveclass:poll', { liveClassId: lc.id, event });
    return successResponse(res, null, 'Poll event broadcast');
  } catch (e) { next(e); }
}

// ─── GET POLL STATE ──────────────────────────────────────────────────────────
// Returns the cached polls array for a live class.
// Called by students joining mid-class to load current poll state.
async function getPollState(req, res, next) {
  try {
    const lc = await prisma.liveClass.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!lc) return errorResponse(res, 'Live class not found', 404);

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

    const lc = await prisma.liveClass.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!lc) return errorResponse(res, 'Live class not found', 404);

    // ── Persist whiteboard state to Redis ────────────────────────────────────
    // Snapshot: host sends canvas.toDataURL() as event.dataUrl — store it.
    // Clear: host wiped the board — delete the stored snapshot.
    const cacheKey = `whiteboard:${lc.id}`;
    try {
      const { isRedisReady, setCache, deleteCache } = require('../utils/redis');
      if (isRedisReady()) {
        if (event.type === 'snapshot' && event.dataUrl) {
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
    const lc = await prisma.liveClass.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!lc) return errorResponse(res, 'Live class not found', 404);

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

    const lc = await prisma.liveClass.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!lc) return errorResponse(res, 'Live class not found', 404);
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
    const isHost = ['TEACHER','SCHOOL_ADMIN','SUPER_ADMIN'].includes(req.user.role);

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

    const lc = await prisma.liveClass.findFirst({ where: { id, deletedAt: null } });
    if (!lc) return errorResponse(res, 'Live class not found', 404);

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

    const updated = await prisma.liveClass.update({
      where: { id },
      data: { coverImageUrl, updatedAt: new Date() }
    });

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

module.exports = {
  listLiveClasses, getLiveClass, createLiveClass, updateLiveClass, deleteLiveClass,
  startLiveClass, endLiveClass, joinLiveClass, leaveLiveClass, getLiveKitToken,
  getParticipants, muteParticipant, muteAll, unmuteAll, kickParticipant,
  raiseHand, lowerHand, approveHand, rejectHand, getHandQueue, lowerAllHands,
  sendMessage, getMessages, deleteMessage, getAttendance, requestSpeak, toggleOpenMic,
  startRecording, stopRecording, broadcastPoll, getPollState, broadcastDraw, getWhiteboardState,
  broadcastQuranPosition, uploadCoverImage
};
