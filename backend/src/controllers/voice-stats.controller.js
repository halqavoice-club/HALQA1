const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse } = require('../utils/response');

// ─── LEVEL SYSTEM ─────────────────────────────────────────────────────────────
// XP = (roomsHosted × 10) + (totalMinutes × 1) + (totalListeners × 2) + (totalSpeakers × 5)
// Levels: Newcomer → Regular → Active → Veteran → Master → Legend

const LEVELS = [
  { level: 1, title: 'Newcomer',  emoji: '🌱', minXp: 0,    color: '#9ca3af' },
  { level: 2, title: 'Regular',   emoji: '🎙️', minXp: 50,   color: '#60a5fa' },
  { level: 3, title: 'Active',    emoji: '🔥', minXp: 200,  color: '#34d399' },
  { level: 4, title: 'Veteran',   emoji: '⭐', minXp: 500,  color: '#fbbf24' },
  { level: 5, title: 'Master',    emoji: '💎', minXp: 1000, color: '#a78bfa' },
  { level: 6, title: 'Legend',    emoji: '👑', minXp: 2500, color: '#f472b6' },
];

function calcXp(stats) {
  return (
    (stats.roomsHosted   || 0) * 10 +
    (stats.totalMinutes  || 0) * 1  +
    (stats.totalListeners|| 0) * 2  +
    (stats.totalSpeakers || 0) * 5  +
    (stats.totalMessages || 0) * 1
  );
}

function getLevel(totalXp) {
  let current = LEVELS[0];
  for (const l of LEVELS) {
    if (totalXp >= l.minXp) current = l;
  }
  const nextIdx = LEVELS.findIndex(l => l.level === current.level) + 1;
  const next = LEVELS[nextIdx] || null;
  const xpInLevel = totalXp - current.minXp;
  const xpNeeded  = next ? next.minXp - current.minXp : 0;
  const progress  = next ? Math.min(100, Math.round((xpInLevel / xpNeeded) * 100)) : 100;
  return { ...current, totalXp, xpInLevel, xpNeeded, progress, next };
}

// ─── UPSERT DAILY STATS (called internally when a room ends) ─────────────────
async function upsertDailyStats(userId, roomData) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const {
    durationMinutes = 0,
    peakAudience    = 0,
    totalListeners  = 0,
    totalSpeakers   = 0,
    totalMessages   = 0
  } = roomData;

  await prisma.voiceHostStats.upsert({
    where: { userId_date: { userId, date: today } },
    create: {
      id:             uuidv4(),
      userId,
      date:           today,
      roomsHosted:    1,
      totalMinutes:   durationMinutes,
      peakAudience,
      totalListeners,
      totalSpeakers,
      totalMessages,
    },
    update: {
      roomsHosted:    { increment: 1 },
      totalMinutes:   { increment: durationMinutes },
      totalListeners: { increment: totalListeners },
      totalSpeakers:  { increment: totalSpeakers },
      totalMessages:  { increment: totalMessages },
    }
  });

  // Update peakAudience separately (take max)
  await prisma.$executeRaw`
    UPDATE voice_host_stats
    SET peakAudience = GREATEST(peakAudience, ${peakAudience}),
        updatedAt    = NOW()
    WHERE userId = ${userId} AND date = ${today}
  `;
}

// ─── GET MY STATS ─────────────────────────────────────────────────────────────
/**
 * GET /voice/stats/me
 * Returns: level info, all-time totals, last 30 days daily breakdown, streak
 */
async function getMyStats(req, res, next) {
  try {
    const userId = req.user.id;

    // All-time totals
    const totals = await prisma.voiceHostStats.aggregate({
      where: { userId },
      _sum: {
        roomsHosted:    true,
        totalMinutes:   true,
        totalListeners: true,
        totalSpeakers:  true,
        totalMessages:  true
      },
      _max: { peakAudience: true }
    });

    const allTime = {
      roomsHosted:    totals._sum.roomsHosted    || 0,
      totalMinutes:   totals._sum.totalMinutes   || 0,
      totalListeners: totals._sum.totalListeners || 0,
      totalSpeakers:  totals._sum.totalSpeakers  || 0,
      totalMessages:  totals._sum.totalMessages  || 0,
      peakAudience:   totals._max.peakAudience   || 0,
    };

    const totalXp = calcXp(allTime);
    const levelInfo = getLevel(totalXp);

    // Last 30 days daily breakdown
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const daily = await prisma.voiceHostStats.findMany({
      where: { userId, date: { gte: thirtyDaysAgo } },
      orderBy: { date: 'asc' },
      select: {
        date:           true,
        roomsHosted:    true,
        totalMinutes:   true,
        peakAudience:   true,
        totalListeners: true,
        totalSpeakers:  true,
        totalMessages:  true
      }
    });

    // Fill in zero days for the chart
    const dailyMap = new Map(daily.map(d => [d.date.toISOString().slice(0, 10), d]));
    const chart = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      chart.push(dailyMap.get(key) || {
        date: d, roomsHosted: 0, totalMinutes: 0,
        peakAudience: 0, totalListeners: 0, totalSpeakers: 0, totalMessages: 0
      });
    }

    // Streak — consecutive days with at least 1 room hosted (counting back from today)
    const allDays = await prisma.voiceHostStats.findMany({
      where: { userId, roomsHosted: { gt: 0 } },
      orderBy: { date: 'desc' },
      select: { date: true }
    });

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < allDays.length; i++) {
      const expected = new Date(today);
      expected.setDate(expected.getDate() - i);
      const actual = new Date(allDays[i].date);
      actual.setHours(0, 0, 0, 0);
      if (expected.getTime() === actual.getTime()) {
        streak++;
      } else {
        break;
      }
    }

    // Recent rooms (last 10 hosted)
    const recentRooms = await prisma.voiceRoom.findMany({
      where: { hostId: userId, status: 'ENDED', deletedAt: null },
      orderBy: { endedAt: 'desc' },
      take: 10,
      select: {
        id: true, title: true, coverEmoji: true, coverImageUrl: true, topic: true,
        startedAt: true, endedAt: true,
        _count: { select: { participants: true, messages: true } }
      }
    });

    return successResponse(res, {
      level:       levelInfo,
      allTime,
      streak,
      chart,
      recentRooms,
      levels:      LEVELS
    });
  } catch (error) { next(error); }
}

/**
 * GET /voice/stats/leaderboard
 * Top 10 hosts by total XP (school-scoped)
 */
async function getLeaderboard(req, res, next) {
  try {
    const schoolId = req.user.schoolId;

    // Voice Club is a global feature — leaderboard is always global (no school filter)
    const rows = await prisma.voiceHostStats.groupBy({
      by: ['userId'],
      where: {},
      _sum: {
        roomsHosted:    true,
        totalMinutes:   true,
        totalListeners: true,
        totalSpeakers:  true,
        totalMessages:  true
      },
      orderBy: { _sum: { totalMinutes: 'desc' } },
      take: 10
    });

    // Fetch user info
    const userIds = rows.map(r => r.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true }
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    const leaderboard = rows.map((r, i) => {
      const s = {
        roomsHosted:    r._sum.roomsHosted    || 0,
        totalMinutes:   r._sum.totalMinutes   || 0,
        totalListeners: r._sum.totalListeners || 0,
        totalSpeakers:  r._sum.totalSpeakers  || 0,
        totalMessages:  r._sum.totalMessages  || 0,
        peakAudience:   0
      };
      const xp = calcXp(s);
      return {
        rank: i + 1,
        user: userMap.get(r.userId),
        ...s,
        totalXp: xp,
        level: getLevel(xp)
      };
    });

    return successResponse(res, leaderboard);
  } catch (error) { next(error); }
}

module.exports = { upsertDailyStats, getMyStats, getLeaderboard };
