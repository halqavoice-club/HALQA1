/**
 * Leaderboard Controller
 * 
 * Handles leaderboard functionality including:
 * - Global leaderboards
 * - School-specific leaderboards
 * - Leaderboard recalculation
 */

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

/**
 * Get global leaderboard
 */
async function getGlobalLeaderboard(req, res) {
  try {
    const { period = 'ALL_TIME', limit = 50 } = req.query;

    const leaderboard = await prisma.globalLeaderboard.findMany({
      where: { period },
      orderBy: { rank: 'asc' },
      take: parseInt(limit),
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true }
        }
      }
    });

    res.json({
      success: true,
      data: leaderboard
    });
  } catch (error) {
    logger.error('Failed to get global leaderboard:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get leaderboard',
        statusCode: 500
      })
    });
  }
}

/**
 * Get user's global leaderboard position
 */
async function getUserGlobalPosition(req, res) {
  try {
    const { userId } = req.params;
    const { period = 'ALL_TIME' } = req.query;

    const entry = await prisma.globalLeaderboard.findUnique({
      where: {
        userId_period: {
          userId,
          period
        }
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true }
        }
      }
    });

    if (!entry) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'User not found on leaderboard',
          statusCode: 404
        })
      });
    }

    res.json({
      success: true,
      data: entry
    });
  } catch (error) {
    logger.error('Failed to get user global position:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get user position',
        statusCode: 500
      })
    });
  }
}

/**
 * Get school leaderboard
 */
async function getSchoolLeaderboard(req, res) {
  try {
    const { schoolId } = req.params;
    const { period = 'ALL_TIME', limit = 50 } = req.query;

    const leaderboard = await prisma.schoolLeaderboard.findMany({
      where: { schoolId, period },
      orderBy: { rank: 'asc' },
      take: parseInt(limit),
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true }
        }
      }
    });

    res.json({
      success: true,
      data: leaderboard
    });
  } catch (error) {
    logger.error('Failed to get school leaderboard:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get school leaderboard',
        statusCode: 500
      })
    });
  }
}

/**
 * Get user's school leaderboard position
 */
async function getUserSchoolPosition(req, res) {
  try {
    const { schoolId, userId } = req.params;
    const { period = 'ALL_TIME' } = req.query;

    const entry = await prisma.schoolLeaderboard.findUnique({
      where: {
        schoolId_userId_period: {
          schoolId,
          userId,
          period
        }
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true }
        }
      }
    });

    if (!entry) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'User not found on school leaderboard',
          statusCode: 404
        })
      });
    }

    res.json({
      success: true,
      data: entry
    });
  } catch (error) {
    logger.error('Failed to get user school position:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get user school position',
        statusCode: 500
      })
    });
  }
}

/**
 * Recalculate global leaderboard
 */
async function recalculateGlobalLeaderboard(req, res) {
  try {
    const { period = 'ALL_TIME' } = req.body;

    // Get all users with their stats
    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      include: {
        posts: { where: { deletedAt: null } },
        tipsSent: { where: { deletedAt: null } },
        tipsReceived: { where: { deletedAt: null } },
        followers: { where: { deletedAt: null } },
        following: { where: { deletedAt: null } }
      }
    });

    // Calculate scores for each user
    const scores = users.map(user => ({
      userId: user.id,
      totalCoins: user.coins || 0,
      totalDiamonds: user.diamonds || 0,
      totalGifts: user.tipsSent.length + user.tipsReceived.length,
      totalPosts: user.posts.length,
      totalFollowers: user.followers.length
    }));

    // Sort by score (coins as primary metric)
    scores.sort((a, b) => b.totalCoins - a.totalCoins);

    // Update or create leaderboard entries
    const updates = await Promise.all(
      scores.map((score, index) =>
        prisma.globalLeaderboard.upsert({
          where: {
            userId_period: {
              userId: score.userId,
              period
            }
          },
          update: {
            totalCoins: score.totalCoins,
            totalDiamonds: score.totalDiamonds,
            totalGifts: score.totalGifts,
            totalPosts: score.totalPosts,
            totalFollowers: score.totalFollowers,
            rank: index + 1,
            previousRank: undefined // Would need to fetch current rank first
          },
          create: {
            userId: score.userId,
            totalCoins: score.totalCoins,
            totalDiamonds: score.totalDiamonds,
            totalGifts: score.totalGifts,
            totalPosts: score.totalPosts,
            totalFollowers: score.totalFollowers,
            rank: index + 1,
            period
          }
        })
      )
    );

    logger.info(`Global leaderboard recalculated for period ${period}`);

    res.json({
      success: true,
      data: updates
    });
  } catch (error) {
    logger.error('Failed to recalculate global leaderboard:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to recalculate leaderboard',
        statusCode: 500
      })
    });
  }
}

/**
 * Recalculate school leaderboard
 */
async function recalculateSchoolLeaderboard(req, res) {
  try {
    const { schoolId } = req.params;
    const { period = 'ALL_TIME' } = req.body;

    // Get all users in the school with their stats
    const users = await prisma.user.findMany({
      where: { schoolId, deletedAt: null },
      include: {
        posts: { where: { deletedAt: null } },
        tipsSent: { where: { deletedAt: null } },
        tipsReceived: { where: { deletedAt: null } },
        followers: { where: { deletedAt: null } }
      }
    });

    // Calculate scores for each user
    const scores = users.map(user => ({
      userId: user.id,
      totalCoins: user.coins || 0,
      totalDiamonds: user.diamonds || 0,
      totalGifts: user.tipsSent.length + user.tipsReceived.length,
      totalPosts: user.posts.length
    }));

    // Sort by score
    scores.sort((a, b) => b.totalCoins - a.totalCoins);

    // Update or create leaderboard entries
    const updates = await Promise.all(
      scores.map((score, index) =>
        prisma.schoolLeaderboard.upsert({
          where: {
            schoolId_userId_period: {
              schoolId,
              userId: score.userId,
              period
            }
          },
          update: {
            totalCoins: score.totalCoins,
            totalDiamonds: score.totalDiamonds,
            totalGifts: score.totalGifts,
            totalPosts: score.totalPosts,
            rank: index + 1
          },
          create: {
            schoolId,
            userId: score.userId,
            totalCoins: score.totalCoins,
            totalDiamonds: score.totalDiamonds,
            totalGifts: score.totalGifts,
            totalPosts: score.totalPosts,
            rank: index + 1,
            period
          }
        })
      )
    );

    logger.info(`School leaderboard recalculated for school ${schoolId} period ${period}`);

    res.json({
      success: true,
      data: updates
    });
  } catch (error) {
    logger.error('Failed to recalculate school leaderboard:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to recalculate school leaderboard',
        statusCode: 500
      })
    });
  }
}

/**
 * Get leaderboard periods
 */
async function getLeaderboardPeriods(req, res) {
  try {
    const periods = await prisma.globalLeaderboard.findMany({
      select: { period: true },
      distinct: ['period']
    });

    res.json({
      success: true,
      data: periods.map(p => p.period)
    });
  } catch (error) {
    logger.error('Failed to get leaderboard periods:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get periods',
        statusCode: 500
      })
    });
  }
}

module.exports = {
  getGlobalLeaderboard,
  getUserGlobalPosition,
  getSchoolLeaderboard,
  getUserSchoolPosition,
  recalculateGlobalLeaderboard,
  recalculateSchoolLeaderboard,
  getLeaderboardPeriods
};
