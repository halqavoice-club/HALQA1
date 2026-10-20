'use strict';
/**
 * Story Controller — Phase B-3
 * 24-hour stories: create, list, view, react, delete
 * Reuses: prisma, response helpers, notification service, getIo, authenticate
 */
const { v4: uuidv4 } = require('uuid');
const prisma  = require('../utils/prisma');
const { getIo }       = require('../sockets');
const { successResponse, errorResponse } = require('../utils/response');
const { notify }      = require('../services/notification.service');
const logger          = require('../utils/logger');

const AUTHOR_SELECT = {
  id: true, firstName: true, lastName: true, avatarUrl: true
};

// ─── Helper: is story active (not expired, not deleted) ──────────────────────
function activeWhere() {
  return { deletedAt: null, expiresAt: { gt: new Date() } };
}

// ─── CREATE STORY ─────────────────────────────────────────────────────────────
async function createStory(req, res, next) {
  try {
    const { type = 'IMAGE', mediaUrl, mimeType, thumbnail,
      text, textColor, bgColor, bgGradient, caption, duration = 5 } = req.body;

    // Validate content
    if (type === 'TEXT' && !text?.trim()) return errorResponse(res, 'Text required for text story', 400);
    if ((type === 'IMAGE' || type === 'VIDEO') && !mediaUrl) return errorResponse(res, 'mediaUrl required', 400);
    if (!['IMAGE','VIDEO','TEXT'].includes(type)) return errorResponse(res, 'Invalid type', 400);

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h from now

    const story = await prisma.story.create({
      data: {
        id: uuidv4(),
        authorId:  req.user.id,
        type, expiresAt,
        mediaUrl:   mediaUrl   || null,
        mimeType:   mimeType   || null,
        thumbnail:  thumbnail  || null,
        text:       text?.trim() || null,
        textColor:  textColor  || '#ffffff',
        bgColor:    bgColor    || '#6366f1',
        bgGradient: bgGradient || null,
        caption:    caption?.trim() || null,
        duration:   Math.min(15, Math.max(1, parseInt(duration) || 5)),
      },
      include: { author: { select: AUTHOR_SELECT } }
    });

    // Socket: notify followers in real-time
    const io = getIo();
    if (io) io.to('feed:public').emit('story:create', { story });

    return successResponse(res, story, 'Story created', 201);
  } catch (e) { next(e); }
}

// ─── GET STORIES FEED ─────────────────────────────────────────────────────────
// Returns stories from followed users + own stories, grouped by author
async function getStoriesFeed(req, res, next) {
  try {
    const viewerId = req.user.id;

    // Get IDs of users this person follows + self, and bilateral block list in parallel.
    // STORY-BLOCK FIX: Apply bilateral block policy to the story feed.
    // Previously no UserBlock lookup was performed here, allowing blocked/blocking
    // followed users' stories to appear in the story bar. Mirrors the block-query
    // pattern from visibilityFilter() and the verified P1 feed fixes.
    const [following, blocks] = await Promise.all([
      prisma.follow.findMany({
        where: { followerId: viewerId },
        select: { followingId: true }
      }),
      prisma.userBlock.findMany({
        where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
        select: { blockerId: true, blockedId: true }
      }).catch(() => [])  // non-fatal — degrade safely if query fails
    ]);

    // Build the blocked-ID set (both directions, excluding the viewer's own ID).
    // viewerId cannot appear because UserBlock @@unique prevents self-blocks.
    const blockedIds = new Set(
      blocks.flatMap(b => [b.blockerId, b.blockedId]).filter(id => id !== viewerId)
    );

    // The viewer always sees their own stories regardless of any block relationships.
    // Filter followed authors to exclude blocked users.
    const authorIds = [
      viewerId,
      ...following.map(f => f.followingId).filter(id => !blockedIds.has(id))
    ];

    // Fetch all active stories from those authors
    const stories = await prisma.story.findMany({
      where: {
        ...activeWhere(),
        authorId: { in: authorIds }
      },
      include: {
        author: { select: AUTHOR_SELECT },
        views:  { where: { viewerId }, select: { id: true } },
        _count: { select: { views: true, reactions: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 200
    });

    // Group by author, mark own + seen
    const grouped = new Map();
    stories.forEach(s => {
      const key = s.authorId;
      if (!grouped.has(key)) {
        grouped.set(key, {
          author:   s.author,
          isOwn:    s.authorId === viewerId,
          stories:  [],
          hasUnseen: false,
        });
      }
      const seen = s.views.length > 0;
      if (!seen) grouped.get(key).hasUnseen = true;
      grouped.get(key).stories.push({
        ...s,
        seen,
        views: undefined,       // don't expose view list
      });
    });

    // Sort: own first, then unseen first, then by latest story
    const result = [...grouped.values()].sort((a, b) => {
      if (a.isOwn && !b.isOwn) return -1;
      if (!a.isOwn && b.isOwn) return 1;
      if (a.hasUnseen && !b.hasUnseen) return -1;
      if (!a.hasUnseen && b.hasUnseen) return 1;
      return 0;
    });

    return successResponse(res, result);
  } catch (e) { next(e); }
}

// ─── GET USER STORIES ─────────────────────────────────────────────────────────
async function getUserStories(req, res, next) {
  try {
    const { userId } = req.params;
    const viewerId   = req.user.id;

    // STORY-BLOCK FIX: Enforce bilateral block policy for non-owner viewers.
    // Mirrors the pattern established in getUserPosts (P1-C) and getUserProfile.
    // Owner (viewer IS the story author) always skips the block check.
    if (userId !== viewerId) {
      const block = await prisma.userBlock.findFirst({
        where: { OR: [
          { blockerId: viewerId, blockedId: userId },
          { blockerId: userId,   blockedId: viewerId }
        ]}
      });
      if (block) return errorResponse(res, 'User not found', 404);
    }

    const stories = await prisma.story.findMany({
      where: { ...activeWhere(), authorId: userId },
      include: {
        author: { select: AUTHOR_SELECT },
        views:  { where: { viewerId }, select: { id: true } },
        _count: { select: { views: true, reactions: true } }
      },
      orderBy: { createdAt: 'asc' }
    });

    return successResponse(res, stories.map(s => ({
      ...s, seen: s.views.length > 0, views: undefined
    })));
  } catch (e) { next(e); }
}

// ─── VIEW STORY ───────────────────────────────────────────────────────────────
async function viewStory(req, res, next) {
  try {
    const { id } = req.params;
    const viewerId = req.user.id;

    const story = await prisma.story.findFirst({
      where: { id, ...activeWhere() }
    });
    if (!story) return errorResponse(res, 'Story not found or expired', 404);

    // VIEW-COUNT FIX: Use create/catch(P2002) instead of upsert+then.
    // Prisma 5 upsert always returns the row whether it was created or updated,
    // so the previous pattern incremented viewCount on every visit, not just the first.
    // Now: only increment when create succeeds (first view). P2002 = already viewed.
    // Author viewing their own story never increments count.
    if (story.authorId !== viewerId) {
      prisma.storyView.create({
        data: { id: uuidv4(), storyId: id, viewerId }
      }).then(() =>
        prisma.story.update({
          where: { id },
          data:  { viewCount: { increment: 1 } }
        })
      ).catch(() => {}); // P2002 (repeat view) and other errors swallowed — fire-and-forget
    } else {
      // Author visit: still record the view row for viewer-list purposes, no count increment
      prisma.storyView.create({
        data: { id: uuidv4(), storyId: id, viewerId }
      }).catch(() => {}); // P2002 if already recorded — safe to ignore
    }

    return successResponse(res, { viewed: true });
  } catch (e) { next(e); }
}

// ─── GET STORY VIEWERS (host only) ────────────────────────────────────────────
async function getStoryViewers(req, res, next) {
  try {
    const story = await prisma.story.findFirst({
      where: { id: req.params.id, authorId: req.user.id, deletedAt: null }
    });
    if (!story) return errorResponse(res, 'Story not found', 404);

    const views = await prisma.storyView.findMany({
      where: { storyId: req.params.id },
      include: { viewer: { select: AUTHOR_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: 200
    });

    return successResponse(res, views.map(v => ({
      ...v.viewer,
      viewedAt: v.createdAt
    })));
  } catch (e) { next(e); }
}

// ─── REACT TO STORY ───────────────────────────────────────────────────────────
async function reactToStory(req, res, next) {
  try {
    const { type = '❤️' } = req.body;
    const { id: storyId } = req.params;
    const userId = req.user.id;

    const story = await prisma.story.findFirst({ where: { id: storyId, ...activeWhere() } });
    if (!story) return errorResponse(res, 'Story not found or expired', 404);

    const existing = await prisma.storyReaction.findUnique({
      where: { storyId_userId: { storyId, userId } }
    });

    let action;
    if (existing) {
      if (existing.type === type) {
        await prisma.storyReaction.delete({ where: { storyId_userId: { storyId, userId } } });
        await prisma.story.update({ where: { id: storyId }, data: { reactionCount: { decrement: 1 } } });
        action = 'removed';
      } else {
        await prisma.storyReaction.update({ where: { storyId_userId: { storyId, userId } }, data: { type } });
        action = 'updated';
      }
    } else {
      await prisma.storyReaction.create({ data: { id: uuidv4(), storyId, userId, type } });
      await prisma.story.update({ where: { id: storyId }, data: { reactionCount: { increment: 1 } } });
      action = 'added';

      // Notify story author
      if (story.authorId !== userId) {
        await notify(story.authorId, {
          type:  'LIKE',
          title: `${req.user.firstName} reacted to your story`,
          body:  `${req.user.firstName} ${req.user.lastName} reacted with ${type}`,
          data:  { storyId, type: 'story_reaction' }
        });
      }
    }

    return successResponse(res, { action, type });
  } catch (e) { next(e); }
}

// ─── DELETE STORY ─────────────────────────────────────────────────────────────
async function deleteStory(req, res, next) {
  try {
    const story = await prisma.story.findFirst({
      where: { id: req.params.id, deletedAt: null }
    });
    if (!story) return errorResponse(res, 'Story not found', 404);
    // F-2 FIX: Story deletion restricted to author + SUPER_ADMIN only (not SCHOOL_ADMIN).
    // SCHOOL_ADMIN is a school-scoped Education role and must not have platform-wide
    // content moderation privileges over Social content.
    const can = story.authorId === req.user.id || req.user.role === 'SUPER_ADMIN';
    if (!can) return errorResponse(res, 'Not authorized', 403);

    await prisma.story.update({ where: { id: story.id }, data: { deletedAt: new Date() } });

    const io = getIo();
    if (io) io.to('feed:public').emit('story:delete', { storyId: story.id });

    return successResponse(res, null, 'Story deleted');
  } catch (e) { next(e); }
}

module.exports = {
  createStory, getStoriesFeed, getUserStories,
  viewStory, getStoryViewers, reactToStory, deleteStory
};
