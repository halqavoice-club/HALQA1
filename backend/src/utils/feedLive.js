'use strict';
/**
 * feedLive.js — helper to broadcast live-content cards into the social feed.
 *
 * When a voice room goes LIVE or a live class starts, this module:
 *  1. Upserts a Post of type LIVE_ROOM_SHARE | LIVE_CLASS_SHARE into the DB
 *     so users who fetch the feed see the card immediately on next load.
 *  2. Emits `feed:live` to the feed:public socket room so connected clients
 *     get a real-time banner in the feed without refreshing.
 *  3. Marks the post as ended when the session ends (soft-deletes it after
 *     a short grace period so it disappears from the feed).
 *
 * All operations are fire-and-forget — a failure here must never crash the
 * caller's HTTP response.
 */

const { v4: uuidv4 } = require('uuid');
const prisma  = require('./prisma');
const { getIo } = require('../sockets');
const logger  = require('./logger');

const LIVE_POST_TTL_MS = 10 * 60 * 1000; // auto-hide after 10 min of inactivity

/**
 * Broadcast a "going live" card into the social feed.
 *
 * @param {object} opts
 * @param {string}  opts.refEntityType - 'voice_room' | 'live_class'
 * @param {string}  opts.refEntityId   - VoiceRoom.id | LiveClass.id
 * @param {string}  opts.authorId      - User ID of the host/teacher
 * @param {string}  opts.title         - Room/class title
 * @param {string}  [opts.description] - Optional subtitle
 * @param {string}  [opts.coverEmoji]  - Emoji cover (voice club)
 * @param {string}  [opts.coverImageUrl] - Cover image URL
 * @param {string}  [opts.schoolId]    - For SCHOOL_ONLY visibility
 * @param {number}  [opts.participantCount=0]
 */
async function broadcastLiveStart(opts) {
  const {
    refEntityType, refEntityId, authorId,
    title, description, coverEmoji, coverImageUrl,
    schoolId, participantCount = 0,
  } = opts;

  const postType = refEntityType === 'voice_room' ? 'LIVE_ROOM_SHARE' : 'LIVE_CLASS_SHARE';
  const visibility = schoolId ? 'SCHOOL_ONLY' : 'PUBLIC';

  try {
    // Upsert: one live post per session (idempotent)
    const existing = await prisma.post.findFirst({
      where: {
        refEntityType,
        refEntityId,
        deletedAt: null,
        type: postType,
      },
    });

    let post;
    if (existing) {
      post = existing;
    } else {
      post = await prisma.post.create({
        data: {
          id:          uuidv4(),
          authorId,
          type:        postType,
          visibility,
          schoolId:    visibility === 'SCHOOL_ONLY' ? schoolId : null,
          body:        description ? `${title}\n\n${description}` : title,
          refEntityType,
          refEntityId,
          isDraft:     false,
        },
      });
    }

    // Build enriched author for the feed card
    const author = await prisma.user.findUnique({
      where: { id: authorId },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true, schoolId: true },
    });

    const liveCard = {
      id:           post.id,
      type:         postType,
      authorId,
      author:       author ?? { id: authorId, firstName: '', lastName: '', avatarUrl: null, role: '', schoolId },
      body:         post.body,
      visibility,
      refEntityType,
      refEntityId,
      media:        [],
      hashtags:     [],
      reactions:    [],
      bookmarks:    [],
      _count:       { reactions: 0, comments: 0 },
      liveData: {
        title,
        description:      description ?? null,
        coverEmoji:       coverEmoji ?? '🎙️',
        coverImageUrl:    coverImageUrl ?? null,
        participantCount,
        isLive:           true,
      },
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      likeCount: 0, commentCount: 0, shareCount: 0,
      viewCount: 0, bookmarkCount: 0,
      isPinned: false, isDraft: false, scheduledAt: null,
      linkUrl: null, linkTitle: null, linkDescription: null, linkImage: null,
      pollData: null, originalPostId: null, originalPost: null, quotedBody: null,
      location: null,
    };

    const io = getIo();
    if (io) {
      // Broadcast to public feed room (all connected clients)
      io.to('feed:public').emit('feed:live', liveCard);
      // Also broadcast to school-scoped room for SCHOOL_ONLY sessions
      if (schoolId) {
        io.to(`feed:school:${schoolId}`).emit('feed:live', liveCard);
      }
    }

    logger.info(`[feedLive] broadcast ${postType} postId=${post.id} refId=${refEntityId}`);
    return post.id;
  } catch (err) {
    logger.warn(`[feedLive] broadcastLiveStart failed (non-fatal): ${err.message}`);
    return null;
  }
}

/**
 * Mark a live session as ended in the feed.
 * Updates the live post to ended state — does NOT delete it so the card
 * remains visible in the feed as a "ended session" record.
 *
 * @param {string} refEntityType - 'voice_room' | 'live_class'
 * @param {string} refEntityId
 */
async function broadcastLiveEnd(refEntityType, refEntityId) {
  try {
    const postType = refEntityType === 'voice_room' ? 'LIVE_ROOM_SHARE' : 'LIVE_CLASS_SHARE';

    const post = await prisma.post.findFirst({
      where: { refEntityType, refEntityId, deletedAt: null, type: postType },
    });
    if (!post) return;

    // Keep the post alive — just emit ended event so frontend can update the card UI
    const io = getIo();
    if (io) {
      io.to('feed:public').emit('feed:live_ended', { refEntityType, refEntityId, postId: post.id });
    }

    logger.info(`[feedLive] ended ${postType} postId=${post.id} refId=${refEntityId}`);
  } catch (err) {
    logger.warn(`[feedLive] broadcastLiveEnd failed (non-fatal): ${err.message}`);
  }
}

/**
 * Update participant count on an active live card.
 * Fire-and-forget — emits socket event only, no DB write.
 *
 * @param {string} refEntityType
 * @param {string} refEntityId
 * @param {number} participantCount
 */
function broadcastLiveUpdate(refEntityType, refEntityId, participantCount) {
  try {
    const io = getIo();
    if (io) {
      io.to('feed:public').emit('feed:live_update', { refEntityType, refEntityId, participantCount });
    }
  } catch (err) {
    logger.warn(`[feedLive] broadcastLiveUpdate failed: ${err.message}`);
  }
}

module.exports = { broadcastLiveStart, broadcastLiveEnd, broadcastLiveUpdate };
