'use strict';
/**
 * Post Scheduler BullMQ Worker
 * Runs every 5 minutes and publishes scheduled posts whose scheduledAt has passed.
 *
 * A scheduled post has: isDraft: true + scheduledAt: <future datetime>
 * When scheduledAt arrives, this worker sets isDraft: false, scheduledAt: null,
 * emits socket events so followers see it in their feed immediately.
 */
const { Worker } = require('bullmq');
const logger     = require('../utils/logger');

function createPostSchedulerWorker(connection) {
  const worker = new Worker('post-scheduler', async (job) => {
    const prisma  = require('../utils/prisma');
    const { getIo } = require('../sockets');
    const now     = new Date();

    // Find all scheduled posts whose time has arrived
    const duePosts = await prisma.post.findMany({
      where: {
        isDraft:     true,
        deletedAt:   null,
        scheduledAt: { lte: now, not: null }
      },
      select: {
        id:          true,
        authorId:    true,
        visibility:  true,
        body:        true,
        communityId: true,
        schoolId:    true
      },
      take: 100  // process in batches of 100
    });

    if (!duePosts.length) {
      logger.debug('[post-scheduler] No scheduled posts due');
      return;
    }

    let published = 0;
    let failed    = 0;

    for (const post of duePosts) {
      try {
        const updated = await prisma.post.update({
          where: { id: post.id },
          data:  { isDraft: false, scheduledAt: null },
          include: {
            author:    { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
            media:     { orderBy: { orderIndex: 'asc' } },
            hashtags:  { include: { hashtag: { select: { id: true, name: true } } } },
            community: { select: { id: true, slug: true, name: true } },
            _count:    { select: { reactions: true, comments: true } }
          }
        });

        // Emit to feed rooms so online followers see the post immediately
        const io = getIo();
        if (io) {
          if (post.visibility === 'PUBLIC' || post.visibility === 'FOLLOWERS') {
            io.to('feed:public').emit('post:create', { post: updated });
          }
          // Notify the author that their scheduled post was published
          io.to(`user:${post.authorId}`).emit('post:published', {
            postId: post.id,
            message: 'Your scheduled post has been published'
          });
        }

        published++;
        logger.info(`[post-scheduler] Published scheduled post ${post.id}`);
      } catch (err) {
        logger.error(`[post-scheduler] Failed to publish post ${post.id}: ${err.message}`);
        failed++;
      }
    }

    logger.info(`[post-scheduler] Published: ${published} | Failed: ${failed}`);
  }, { connection });

  worker.on('failed', (job, err) =>
    logger.error(`[post-scheduler] Job ${job?.id} failed: ${err.message}`)
  );

  return worker;
}

module.exports = { createPostSchedulerWorker };
