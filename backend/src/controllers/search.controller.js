/**
 * Search Controller
 * 
 * Handles search functionality including:
 * - Search index management
 * - Full-text search
 * - Trending hashtags
 */

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

/**
 * Index an entity for search
 */
async function indexEntity(req, res) {
  try {
    const { entityType, entityId, title, content, tags, schoolId, userId, popularity } = req.body;

    const index = await prisma.searchIndex.upsert({
      where: {
        entityType_entityId: {
          entityType,
          entityId
        }
      },
      update: {
        title,
        content,
        tags: tags || [],
        schoolId,
        userId,
        popularity: popularity !== undefined ? popularity : undefined,
        lastIndexedAt: new Date()
      },
      create: {
        entityType,
        entityId,
        title,
        content,
        tags: tags || [],
        schoolId,
        userId,
        popularity: popularity || 0,
        lastIndexedAt: new Date()
      }
    });

    logger.info(`Entity indexed: ${entityType}:${entityId}`);

    res.status(201).json({
      success: true,
      data: index
    });
  } catch (error) {
    logger.error('Failed to index entity:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to index entity',
        statusCode: 500
      })
    });
  }
}

/**
 * Remove entity from search index
 */
async function removeEntityFromIndex(req, res) {
  try {
    const { entityType, entityId } = req.params;

    await prisma.searchIndex.deleteMany({
      where: {
        entityType,
        entityId
      }
    });

    logger.info(`Entity removed from index: ${entityType}:${entityId}`);

    res.json({
      success: true,
      message: 'Entity removed from index'
    });
  } catch (error) {
    logger.error('Failed to remove entity from index:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to remove entity from index',
        statusCode: 500
      })
    });
  }
}

/**
 * Search entities
 */
async function searchEntities(req, res) {
  try {
    const { query, entityType, schoolId, userId, limit = 20 } = req.query;

    const where = {};

    if (query) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } }
      ];
    }

    if (entityType) where.entityType = entityType;
    if (schoolId) where.schoolId = schoolId;
    if (userId) where.userId = userId;

    const results = await prisma.searchIndex.findMany({
      where,
      take: parseInt(limit),
      orderBy: [
        { popularity: 'desc' },
        { lastIndexedAt: 'desc' }
      ]
    });

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    logger.error('Failed to search entities:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to search',
        statusCode: 500
      })
    });
  }
}

/**
 * Get trending hashtags
 */
async function getTrendingHashtags(req, res) {
  try {
    const { period = 'DAILY', limit = 20 } = req.query;

    const hashtags = await prisma.trendingHashtag.findMany({
      where: { period },
      orderBy: { rank: 'asc' },
      take: parseInt(limit)
    });

    res.json({
      success: true,
      data: hashtags
    });
  } catch (error) {
    logger.error('Failed to get trending hashtags:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get trending hashtags',
        statusCode: 500
      })
    });
  }
}

/**
 * Update hashtag count
 */
async function updateHashtagCount(req, res) {
  try {
    const { hashtag } = req.params;
    const { increment = 1 } = req.body;

    const updated = await prisma.trendingHashtag.upsert({
      where: { hashtag },
      update: {
        count: { increment },
        previousRank: undefined // Would need to fetch current rank first
      },
      create: {
        hashtag,
        count: increment,
        rank: 0,
        previousRank: 0,
        period: 'DAILY'
      }
    });

    logger.info(`Hashtag ${hashtag} count updated to ${updated.count}`);

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    logger.error('Failed to update hashtag count:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to update hashtag count',
        statusCode: 500
      })
    });
  }
}

/**
 * Recalculate trending hashtags
 */
async function recalculateTrendingHashtags(req, res) {
  try {
    const { period = 'DAILY' } = req.body;

    // Get all hashtags from posts
    const posts = await prisma.post.findMany({
      where: { deletedAt: null },
      select: { tags: true }
    });

    // Count hashtag occurrences
    const hashtagCounts = {};
    posts.forEach(post => {
      if (post.tags) {
        post.tags.forEach(tag => {
          hashtagCounts[tag] = (hashtagCounts[tag] || 0) + 1;
        });
      }
    });

    // Convert to array and sort
    const sortedHashtags = Object.entries(hashtagCounts)
      .map(([hashtag, count]) => ({ hashtag, count }))
      .sort((a, b) => b.count - a.count);

    // Update or create trending hashtags
    const updates = await Promise.all(
      sortedHashtags.map((item, index) =>
        prisma.trendingHashtag.upsert({
          where: { hashtag },
          update: {
            count: item.count,
            rank: index + 1,
            period
          },
          create: {
            hashtag: item.hashtag,
            count: item.count,
            rank: index + 1,
            period
          }
        })
      )
    );

    logger.info(`Trending hashtags recalculated for period ${period}`);

    res.json({
      success: true,
      data: updates
    });
  } catch (error) {
    logger.error('Failed to recalculate trending hashtags:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to recalculate trending hashtags',
        statusCode: 500
      })
    });
  }
}

/**
 * Get search index stats
 */
async function getSearchIndexStats(req, res) {
  try {
    const stats = await prisma.searchIndex.groupBy({
      by: ['entityType'],
      _count: true
    });

    const total = await prisma.searchIndex.count();

    res.json({
      success: true,
      data: {
        total,
        byType: stats
      }
    });
  } catch (error) {
    logger.error('Failed to get search index stats:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get search index stats',
        statusCode: 500
      })
    });
  }
}

module.exports = {
  indexEntity,
  removeEntityFromIndex,
  searchEntities,
  getTrendingHashtags,
  updateHashtagCount,
  recalculateTrendingHashtags,
  getSearchIndexStats
};
