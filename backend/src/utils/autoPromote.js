/**
 * autoPromote — shared helper
 * ─────────────────────────────────────────────────────────────────────────────
 * Called whenever a speaker slot is freed (drop mic, leave room, disconnect).
 * Pops the next user from the FIFO queue and promotes them to SPEAKER.
 * Broadcasts role_changed + queue_updated to the room.
 *
 * Returns the promoted user's userId, or null if queue was empty.
 */

const { popNext, getQueue } = require('./voiceQueue');
const { deleteCache, isRedisReady } = require('./redis');
const logger = require('./logger');

const roomCacheKey = (roomId) => `voice:room:${roomId}`;

async function autoPromoteNext(roomId, io) {
  const prisma = require('./prisma');

  // Check if there's room for another speaker
  const room = await prisma.voiceRoom.findUnique({
    where: { id: roomId },
    select: { maxSpeakers: true, status: true }
  });
  if (!room || room.status === 'ENDED') return null;

  const speakerCount = await prisma.voiceParticipant.count({
    where: { roomId, isActive: true, role: { in: ['HOST', 'MODERATOR', 'SPEAKER'] } }
  });

  if (speakerCount >= (room.maxSpeakers || 10)) return null; // still full

  // Pop next from queue (Redis-safe: fall back to DB handRaised)
  let next = null;
  if (isRedisReady()) {
    try { next = await popNext(roomId); } catch (err) {
      logger.warn(`[autoPromote] Redis popNext failed: ${err.message}`);
    }
  }
  if (!next) {
    // Redis unavailable or queue empty — check DB for waiting users
    const waiting = await prisma.voiceParticipant.findFirst({
      where: { roomId, isActive: true, role: 'AUDIENCE', handRaised: true },
      orderBy: { handRaisedAt: 'asc' }
    });
    if (!waiting) {
      // Slot is free and nobody is waiting — notify moderators
      if (io) {
        io.to(`voice:${roomId}`).emit('voice:speaker_slot_freed', {
          roomId,
          speakerCount,
          maxSpeakers: room.maxSpeakers || 10
        });
      }
      return null;
    }
    next = { userId: waiting.userId };
  }

  const { userId } = next;

  // Verify they're still active in the room
  const participant = await prisma.voiceParticipant.findUnique({
    where: { roomId_userId: { roomId, userId } }
  });

  if (!participant || !participant.isActive || participant.role !== 'AUDIENCE') {
    // They left or already got promoted — try the next one recursively
    return autoPromoteNext(roomId, io);
  }

  // Promote to SPEAKER
  await prisma.voiceParticipant.update({
    where: { roomId_userId: { roomId, userId } },
    data: {
      role:        'SPEAKER',
      isMuted:     false,
      handRaised:  false,
      handRaisedAt: null,
      updatedAt:   new Date()
    }
  });

  try { await deleteCache(roomCacheKey(roomId)); } catch (err) { /* ignore */ }

  if (io) {
    io.to(`voice:${roomId}`).emit('voice:role_changed', {
      roomId, userId, role: 'SPEAKER'
    });
    io.to(`user:${userId}`).emit('voice:promoted_to_speaker', {
      roomId,
      message: "🎙️ You're up! You've been promoted to speaker."
    });
    // Broadcast updated queue (Redis-safe)
    let q = [];
    if (isRedisReady()) {
      try { q = await getQueue(roomId); } catch (err) { /* ignore */ }
    }
    io.to(`voice:${roomId}`).emit('voice:queue_updated', {
      roomId, queue: q, queueLength: q.length
    });
  }

  return userId;
}

module.exports = { autoPromoteNext };
