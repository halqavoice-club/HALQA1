'use strict';

/**
 * Optimized Query Patterns
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop-in replacements for the most expensive queries in the system.
 * Each function documents WHY it is faster than the naive version.
 *
 * Import what you need:
 *   const { getActiveRoomParticipants } = require('../utils/optimized-queries');
 * ─────────────────────────────────────────────────────────────────────────────
 */

const prisma = require('./prisma');

// ─── Shared field selectors ───────────────────────────────────────────────────
// Reuse these instead of include: { user: true } which pulls every column.

const USER_MINI = {
  id: true, firstName: true, lastName: true, avatarUrl: true
};

const USER_WITH_ROLE = {
  id: true, firstName: true, lastName: true, avatarUrl: true, role: true
};

// ─── 1. VOICE ROOM PARTICIPANTS ───────────────────────────────────────────────

/**
 * Get active participants for a voice room.
 *
 * BEFORE (N+1 risk, pulls all user columns):
 *   prisma.voiceParticipant.findMany({ where: { roomId, isActive: true }, include: { user: true } })
 *
 * AFTER: selective include, composite index on (roomId, isActive, role)
 */
async function getActiveRoomParticipants(roomId) {
  return prisma.voiceParticipant.findMany({
    where:   { roomId, isActive: true },
    select: {
      id:          true,
      userId:      true,
      role:        true,
      isMuted:     true,
      handRaised:  true,
      handRaisedAt:true,
      joinedAt:    true,
      user:        { select: USER_MINI },
    },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
  });
}

/**
 * Count active speakers (HOST + MODERATOR + SPEAKER) in a room.
 * Uses the composite index idx_voice_participants_room_active_role.
 */
async function countActiveSpeakers(roomId) {
  return prisma.voiceParticipant.count({
    where: {
      roomId,
      isActive: true,
      role: { in: ['HOST', 'MODERATOR', 'SPEAKER'] },
    },
  });
}

// ─── 2. DM MESSAGES — CURSOR PAGINATION ──────────────────────────────────────

/**
 * Load DM messages with cursor-based pagination.
 *
 * WHY cursor > offset:
 *   OFFSET 1000 forces MySQL to scan 1000 rows before returning results.
 *   Cursor (WHERE createdAt < cursor) uses the index directly — O(log n).
 *
 * @param {string}  convId
 * @param {string|null} cursor  - ISO timestamp of the oldest message already loaded
 * @param {number}  limit
 */
async function getDmMessages(convId, cursor = null, limit = 30) {
  const where = {
    conversationId: convId,
    deletedBySender:   false,
    deletedByReceiver: false,
    ...(cursor && { createdAt: { lt: new Date(cursor) } }),
  };

  const messages = await prisma.directMessage.findMany({
    where,
    select: {
      id:          true,
      body:        true,
      status:      true,
      createdAt:   true,
      senderId:    true,
      receiverId:  true,
      deliveredAt: true,
      readAt:      true,
      sender:      { select: USER_MINI },
    },
    orderBy: { createdAt: 'desc' },
    take:    Math.min(limit, 100),
  });

  // Return in chronological order for the UI
  return messages.reverse();
}

// ─── 3. VOICE CHAT MESSAGES — CURSOR PAGINATION ───────────────────────────────

/**
 * @param {string}      roomId
 * @param {string|null} cursor  - ISO timestamp
 * @param {number}      limit
 */
async function getVoiceMessages(roomId, cursor = null, limit = 50) {
  const where = {
    roomId,
    deletedAt: null,
    ...(cursor && { createdAt: { lt: new Date(cursor) } }),
  };

  const messages = await prisma.voiceMessage.findMany({
    where,
    select: {
      id:        true,
      body:      true,
      createdAt: true,
      userId:    true,
      user:      { select: USER_MINI },
    },
    orderBy: { createdAt: 'desc' },
    take:    Math.min(limit, 100),
  });

  return messages.reverse();
}

// ─── 4. ATTENDANCE REPORT — OPTIMIZED ────────────────────────────────────────

/**
 * Attendance report with selective fields and pagination.
 *
 * BEFORE: findMany with full include (pulls all student + user + class columns)
 * AFTER:  select only what the report needs, paginated
 *
 * @param {object} filters  - { schoolId, classId, studentId, startDate, endDate, status }
 * @param {number} page
 * @param {number} limit
 */
async function getAttendanceReport(filters, page = 1, limit = 100) {
  const { schoolId, classId, studentId, startDate, endDate, status } = filters;

  const where = {
    ...(schoolId  && { schoolId }),
    ...(classId   && { classId }),
    ...(studentId && { studentId }),
    ...(status    && { status }),
    ...(startDate && endDate && {
      date: { gte: new Date(startDate), lte: new Date(endDate) }
    }),
  };

  const skip = (page - 1) * limit;

  const [records, total] = await Promise.all([
    prisma.attendance.findMany({
      where,
      select: {
        id:            true,
        date:          true,
        status:        true,
        checkInTime:   true,
        checkOutTime:  true,
        checkInMethod: true,
        notes:         true,
        student: {
          select: {
            id:        true,
            studentId: true,
            user:      { select: { firstName: true, lastName: true } },
          },
        },
        class: { select: { id: true, name: true } },
      },
      orderBy: [{ date: 'desc' }, { studentId: 'asc' }],
      skip,
      take: Math.min(limit, 500),
    }),
    prisma.attendance.count({ where }),
  ]);

  return { records, total, page, limit };
}

// ─── 5. STUDENT GRADES — OPTIMIZED ───────────────────────────────────────────

/**
 * Student grade history — avoids loading teacher's full profile.
 *
 * BEFORE: include: { teacher: { include: { user: true } } }
 *         → pulls all teacher + user columns
 *
 * AFTER:  select only firstName + lastName from the nested user
 */
async function getStudentGrades(studentId, filters = {}) {
  const { classId, termId, type } = filters;

  return prisma.grade.findMany({
    where: {
      studentId,
      deletedAt: null,
      ...(classId && { classId }),
      ...(termId  && { termId }),
      ...(type    && { type }),
    },
    select: {
      id:          true,
      title:       true,
      type:        true,
      score:       true,
      maxScore:    true,
      percentage:  true,
      letterGrade: true,
      feedback:    true,
      gradedAt:    true,
      dueDate:     true,
      class:       { select: { id: true, name: true } },
      category:    { select: { id: true, name: true, weight: true } },
      teacher: {
        select: {
          user: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { gradedAt: 'desc' },
  });
}

// ─── 6. ADMIN DASHBOARD — PARALLEL AGGREGATES ────────────────────────────────

/**
 * Admin dashboard overview counts.
 *
 * BEFORE: 9 sequential awaits
 * AFTER:  all counts run in parallel via Promise.all
 *         Each count uses a covering index (schoolId + deletedAt)
 */
async function getAdminOverview(schoolId) {
  const schoolFilter = schoolId ? { schoolId } : {};

  const [students, teachers, classes, guardians] = await Promise.all([
    prisma.student.count({ where: { ...schoolFilter, deletedAt: null } }),
    prisma.teacher.count({ where: { ...schoolFilter, deletedAt: null } }),
    prisma.class.count({   where: { ...schoolFilter, isActive: true, deletedAt: null } }),
    prisma.guardian.count({ where: { ...schoolFilter, deletedAt: null } }),
  ]);

  return { students, teachers, classes, guardians };
}

/**
 * Today's attendance summary — uses groupBy with the composite index
 * idx_attendance_school_date.
 */
async function getTodayAttendanceSummary(schoolId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows = await prisma.attendance.groupBy({
    by:    ['status'],
    where: {
      ...(schoolId && { schoolId }),
      date: today,
    },
    _count: { status: true },
  });

  const stats = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, LEFT_EARLY: 0 };
  rows.forEach(r => { stats[r.status] = r._count.status; });
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  stats.percentage = total > 0 ? Math.round((stats.PRESENT / total) * 100) : 0;
  stats.total = total;

  return stats;
}

// ─── 7. GIFT DAILY LEADERBOARD — OPTIMIZED ───────────────────────────────────

/**
 * Daily gift leaderboard.
 *
 * BEFORE: groupBy + N individual user lookups (N+1 problem)
 * AFTER:  groupBy → collect userIds → single findMany → merge in JS
 */
async function getDailyGiftLeaderboard(limit = 10) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows = await prisma.giftTransaction.groupBy({
    by:      ['senderId'],
    where:   { createdAt: { gte: today } },
    _sum:    { coinsSpent: true },
    _count:  { id: true },
    orderBy: { _sum: { coinsSpent: 'desc' } },
    take:    limit,
  });

  if (!rows.length) return [];

  // Single query for all users — avoids N+1
  const userIds = rows.map(r => r.senderId);
  const users   = await prisma.user.findMany({
    where:  { id: { in: userIds } },
    select: USER_MINI,
  });
  const userMap = new Map(users.map(u => [u.id, u]));

  return rows.map((r, i) => ({
    rank:       i + 1,
    user:       userMap.get(r.senderId) ?? null,
    totalCoins: r._sum.coinsSpent ?? 0,
    giftCount:  r._count.id,
  }));
}

// ─── 8. VOICE ROOM LIST — OPTIMIZED ──────────────────────────────────────────

/**
 * List active voice rooms with participant preview.
 *
 * BEFORE: include: { participants: { include: { user: true } } }
 *         → pulls all participant + user columns, no limit on participants
 *
 * AFTER:  select only needed fields, limit participant preview to 8
 */
async function listActiveRooms(schoolId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  const where = {
    deletedAt: null,
    status:    { not: 'ENDED' },
    ...(schoolId && { OR: [{ schoolId }, { schoolId: null }] }),
  };

  const [rooms, total] = await Promise.all([
    prisma.voiceRoom.findMany({
      where,
      select: {
        id:            true,
        title:         true,
        topic:         true,
        coverEmoji:    true,
        coverImageUrl: true,
        privacy:       true,
        status:        true,
        isOpenMic:     true,
        maxSpeakers:   true,
        lastActivityAt:true,
        createdAt:     true,
        host:          { select: USER_MINI },
        participants: {
          where:   { isActive: true },
          select:  {
            userId: true,
            role:   true,
            user:   { select: USER_MINI },
          },
          orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
          take:    8,  // preview only — full list loaded on room open
        },
        _count: { select: { participants: { where: { isActive: true } } } },
      },
      orderBy: [{ status: 'asc' }, { lastActivityAt: 'desc' }],
      skip,
      take: Math.min(limit, 50),
    }),
    prisma.voiceRoom.count({ where }),
  ]);

  return { rooms, total, page, limit };
}

// ─── 9. CONVERSATION LIST — OPTIMIZED ────────────────────────────────────────

/**
 * DM conversation list (inbox).
 *
 * BEFORE: include: { userA: true, userB: true } — pulls all user columns
 * AFTER:  select only display fields
 */
async function getConversationList(userId) {
  const convs = await prisma.dmConversation.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: {
      id:            true,
      userAId:       true,
      userBId:       true,
      lastMessage:   true,
      lastMessageAt: true,
      lastSenderId:  true,
      unreadA:       true,
      unreadB:       true,
      updatedAt:     true,
      userA:         { select: USER_MINI },
      userB:         { select: USER_MINI },
    },
    orderBy: { lastMessageAt: 'desc' },
  });

  return convs.map(c => ({
    id:            c.id,
    other:         c.userAId === userId ? c.userB : c.userA,
    lastMessage:   c.lastMessage,
    lastMessageAt: c.lastMessageAt,
    lastSenderId:  c.lastSenderId,
    unread:        c.userAId === userId ? c.unreadA : c.unreadB,
    updatedAt:     c.updatedAt,
  }));
}

// ─── 10. AUDIT LOG — CURSOR PAGINATION ───────────────────────────────────────

/**
 * Audit log with cursor pagination.
 * Audit logs grow unboundedly — offset pagination becomes unusable at scale.
 *
 * @param {object} filters  - { schoolId, userId, entity, action }
 * @param {string|null} cursor  - createdAt ISO string of last seen record
 * @param {number} limit
 */
async function getAuditLogs(filters, cursor = null, limit = 50) {
  const { schoolId, userId, entity, action } = filters;

  const where = {
    ...(schoolId && { schoolId }),
    ...(userId   && { userId }),
    ...(entity   && { entity }),
    ...(action   && { action }),
    ...(cursor   && { createdAt: { lt: new Date(cursor) } }),
  };

  return prisma.auditLog.findMany({
    where,
    select: {
      id:        true,
      action:    true,
      entity:    true,
      entityId:  true,
      ipAddress: true,
      createdAt: true,
      user: { select: { id: true, firstName: true, lastName: true, role: true } },
    },
    orderBy: { createdAt: 'desc' },
    take:    Math.min(limit, 200),
  });
}

// ─── 11. TEACHER DASHBOARD — AVOID N+1 ───────────────────────────────────────

/**
 * Teacher dashboard — loads classes + enrollment counts in one query.
 *
 * BEFORE: teacher.teacherClasses → for each class → enrollments.count()
 *         → N+1 queries (one per class)
 *
 * AFTER:  _count on enrollments inside the include — single query
 */
async function getTeacherClasses(userId) {
  const teacher = await prisma.teacher.findFirst({
    where:  { userId },
    select: {
      id:         true,
      department: true,
      teacherClasses: {
        select: {
          isLead:  true,
          subject: true,
          class: {
            select: {
              id:        true,
              name:      true,
              gradeLevel:true,
              isActive:  true,
              _count:    { select: { enrollments: { where: { isActive: true } } } },
            },
          },
        },
      },
    },
  });

  if (!teacher) return null;

  return {
    id:         teacher.id,
    department: teacher.department,
    classes:    teacher.teacherClasses.map(tc => ({
      id:             tc.class.id,
      name:           tc.class.name,
      gradeLevel:     tc.class.gradeLevel,
      isActive:       tc.class.isActive,
      isLead:         tc.isLead,
      subject:        tc.subject,
      studentCount:   tc.class._count.enrollments,
    })),
  };
}

// ─── 12. STUDENT SEARCH — FULL-TEXT FRIENDLY ─────────────────────────────────

/**
 * Search students by name or studentId.
 *
 * Uses the existing indexes on firstName, lastName, studentId.
 * Limits to 50 results — never returns unbounded sets.
 *
 * @param {string} schoolId
 * @param {string} query
 * @param {number} limit
 */
async function searchStudents(schoolId, query, limit = 20) {
  const q = query.trim();
  if (q.length < 2) return [];

  return prisma.student.findMany({
    where: {
      schoolId,
      deletedAt: null,
      OR: [
        { studentId: { contains: q } },
        { user: { firstName: { contains: q } } },
        { user: { lastName:  { contains: q } } },
      ],
    },
    select: {
      id:        true,
      studentId: true,
      gradeLevel:true,
      user:      { select: USER_MINI },
    },
    take: Math.min(limit, 50),
  });
}

module.exports = {
  // Voice
  getActiveRoomParticipants,
  countActiveSpeakers,
  getVoiceMessages,
  listActiveRooms,

  // DM
  getDmMessages,
  getConversationList,

  // Attendance
  getAttendanceReport,
  getTodayAttendanceSummary,

  // Grades
  getStudentGrades,

  // Dashboard
  getAdminOverview,

  // Gifts
  getDailyGiftLeaderboard,

  // Audit
  getAuditLogs,

  // Teacher
  getTeacherClasses,

  // Search
  searchStudents,

  // Shared selectors (for use in other files)
  USER_MINI,
  USER_WITH_ROLE,
};
