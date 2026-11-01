/**
 * INV-002: Unit tests for autoPromote seat allocation retry logic
 * 
 * Tests the retry loop that handles duplicate-seat race conditions when
 * multiple autoPromoteNext calls run concurrently.
 */

const { autoPromoteNext } = require('../../utils/autoPromote');

// Mock all dependencies
jest.mock('../../utils/prisma', () => {
  const mockPrisma = {
    voiceRoom: { findUnique: jest.fn() },
    voiceParticipant: { findUnique: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn()
  };
  return mockPrisma;
});
jest.mock('../../utils/voiceQueue', () => ({ 
  peekNext: jest.fn(), 
  dequeue: jest.fn(), 
  getQueue: jest.fn() 
}));
jest.mock('../../utils/redis', () => ({ 
  deleteCache: jest.fn(), 
  isRedisReady: jest.fn(() => false) 
}));
jest.mock('../../utils/voiceRoomCache', () => ({ 
  getNextStageVersion: jest.fn(() => Promise.resolve(1)) 
}));
jest.mock('../../utils/logger', () => ({ 
  warn: jest.fn(), 
  info: jest.fn(), 
  error: jest.fn() 
}));

const prisma = require('../../utils/prisma');
const { peekNext, dequeue, getQueue } = require('../../utils/voiceQueue');
const { deleteCache, isRedisReady } = require('../../utils/redis');
const logger = require('../../utils/logger');

describe('INV-002: autoPromote seat allocation retry logic', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Default mocks
    isRedisReady.mockReturnValue(true);
    deleteCache.mockResolvedValue(undefined);
    getQueue.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('retry on duplicate seat error', () => {
    
    it('should succeed on attempt 2 after ER_DUP_ENTRY on attempt 1', async () => {
      const roomId = 'room-1';
      const userId = 'user-1';
      const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

      // Mock room
      prisma.voiceRoom.findUnique.mockResolvedValue({
        maxSpeakers: 12,
        status: 'ACTIVE',
        micLocked: false,
        allMuted: false,
        lockedSeats: []
      });

      // Mock speaker count (1 speaker on stage, 11 seats free)
      prisma.$queryRaw
        .mockResolvedValueOnce([{ cnt: 1 }]) // initial count
        .mockResolvedValueOnce([{ cnt: 1 }]) // recalc before attempt 2
        .mockResolvedValueOnce([]); // occupied seats query inside tx

      // Mock queue peek
      peekNext.mockResolvedValue({ userId });

      // Mock participant
      prisma.voiceParticipant.findUnique.mockResolvedValue({
        userId,
        roomId,
        isActive: true,
        handRaised: true,
        wasKicked: false,
        role: 'AUDIENCE',
        seatNumber: null,
        isMuted: false
      });

      // Mock transaction: FAIL on attempt 1, SUCCEED on attempt 2
      let transactionCallCount = 0;
      prisma.$transaction.mockImplementation(async (callback) => {
        transactionCallCount++;
        if (transactionCallCount === 1) {
          // Attempt 1: duplicate seat error
          const err = new Error('Duplicate entry');
          err.code = 'ER_DUP_ENTRY';
          throw err;
        }
        
        // Attempt 2: success - mock the tx queries inside the transaction callback
        const tx = {
          voiceParticipant: {
            findUnique: jest.fn()
              .mockResolvedValueOnce({
                userId,
                role: 'AUDIENCE',
                isActive: true,
                wasKicked: false,
                handRaised: true,
                seatNumber: null
              })
              .mockResolvedValueOnce({
                mutedByModerator: false
              })
          },
          voiceRoom: {
            findUnique: jest.fn().mockResolvedValue({
              id: roomId,
              deletedAt: null,
              status: 'ACTIVE',
              micLocked: false,
              maxSpeakers: 12,
              lockedSeats: []
            })
          },
          $queryRaw: jest.fn().mockResolvedValue([]),
          $executeRaw: jest.fn().mockResolvedValue(1)
        };
        await callback(tx);
      });

      // Mock dequeue
      dequeue.mockResolvedValue(undefined);

      // Execute
      const promise = autoPromoteNext(roomId, io);
      
      // Fast-forward the 50ms backoff between attempt 1 and 2
      await jest.advanceTimersByTimeAsync(50);
      
      const result = await promise;

      // Verify
      expect(result).toBe(userId);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(dequeue).toHaveBeenCalledWith(roomId, userId);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Seat race attempt 1/3')
      );
    });

    it('should return null after exhausting all 3 attempts', async () => {
      const roomId = 'room-2';
      const userId = 'user-2';
      const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

      // Mock room
      prisma.voiceRoom.findUnique.mockResolvedValue({
        maxSpeakers: 12,
        status: 'ACTIVE',
        micLocked: false,
        allMuted: false,
        lockedSeats: []
      });

      // Mock speaker count
      prisma.$queryRaw.mockResolvedValue([{ cnt: 1 }]);

      // Mock queue peek
      peekNext.mockResolvedValue({ userId });

      // Mock participant
      prisma.voiceParticipant.findUnique.mockResolvedValue({
        userId,
        roomId,
        isActive: true,
        handRaised: true,
        wasKicked: false,
        role: 'AUDIENCE',
        seatNumber: null,
        isMuted: false
      });

      // Mock transaction: FAIL all 3 attempts with duplicate error
      prisma.$transaction.mockImplementation(async () => {
        const err = new Error('Duplicate entry');
        err.code = 'P2002';
        err.meta = { code: '1062' };
        throw err;
      });

      // Execute
      const promise = autoPromoteNext(roomId, io);
      
      // Fast-forward backoff timers
      await jest.advanceTimersByTimeAsync(50 + 150);
      
      const result = await promise;

      // Verify
      expect(result).toBeNull();
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
      expect(dequeue).not.toHaveBeenCalled(); // queue position retained
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Seat race exhausted retries')
      );
    });

    it('should short-circuit when room becomes full during retry', async () => {
      const roomId = 'room-3';
      const userId = 'user-3';
      const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

      // Mock room
      prisma.voiceRoom.findUnique.mockResolvedValue({
        maxSpeakers: 2,
        status: 'ACTIVE',
        micLocked: false,
        allMuted: false,
        lockedSeats: []
      });

      // Mock speaker count: 1 speaker initially, 2 speakers (full) on recalc
      prisma.$queryRaw
        .mockResolvedValueOnce([{ cnt: 1 }]) // initial count
        .mockResolvedValueOnce([{ cnt: 2 }]); // recalc before attempt 2 — ROOM FULL

      // Mock queue peek
      peekNext.mockResolvedValue({ userId });

      // Mock participant
      prisma.voiceParticipant.findUnique.mockResolvedValue({
        userId,
        roomId,
        isActive: true,
        handRaised: true,
        wasKicked: false,
        role: 'AUDIENCE',
        seatNumber: null,
        isMuted: false
      });

      // Mock transaction: FAIL attempt 1 with duplicate error
      prisma.$transaction.mockImplementation(async () => {
        const err = new Error('Duplicate entry');
        err.code = 'ER_DUP_ENTRY';
        throw err;
      });

      // Execute
      const promise = autoPromoteNext(roomId, io);
      
      // Fast-forward backoff timer
      await jest.advanceTimersByTimeAsync(50);
      
      const result = await promise;

      // Verify
      expect(result).toBeNull();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1); // Only 1 attempt, no retry
      expect(dequeue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No seats available after race')
      );
    });

    it('should propagate non-duplicate errors immediately without retry', async () => {
      const roomId = 'room-4';
      const userId = 'user-4';
      const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

      // Mock room
      prisma.voiceRoom.findUnique.mockResolvedValue({
        maxSpeakers: 12,
        status: 'ACTIVE',
        micLocked: false,
        allMuted: false,
        lockedSeats: []
      });

      // Mock speaker count
      prisma.$queryRaw.mockResolvedValue([{ cnt: 1 }]);

      // Mock queue peek
      peekNext.mockResolvedValue({ userId });

      // Mock participant
      prisma.voiceParticipant.findUnique.mockResolvedValue({
        userId,
        roomId,
        isActive: true,
        handRaised: true,
        wasKicked: false,
        role: 'AUDIENCE',
        seatNumber: null,
        isMuted: false
      });

      // Mock transaction: throw a generic error (NOT duplicate)
      const genericError = new Error('Database connection lost');
      prisma.$transaction.mockRejectedValue(genericError);

      // Execute and expect error to propagate
      await expect(autoPromoteNext(roomId, io)).rejects.toThrow('Database connection lost');

      // Verify: no retry, error thrown immediately
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(dequeue).not.toHaveBeenCalled();
    });

    it('should return null immediately on 403/409 state-change errors without retry', async () => {
      const roomId = 'room-5';
      const userId = 'user-5';
      const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

      // Mock room
      prisma.voiceRoom.findUnique.mockResolvedValue({
        maxSpeakers: 12,
        status: 'ACTIVE',
        micLocked: false,
        allMuted: false,
        lockedSeats: []
      });

      // Mock speaker count
      prisma.$queryRaw.mockResolvedValue([{ cnt: 1 }]);

      // Mock queue peek
      peekNext.mockResolvedValue({ userId });

      // Mock participant
      prisma.voiceParticipant.findUnique.mockResolvedValue({
        userId,
        roomId,
        isActive: true,
        handRaised: true,
        wasKicked: false,
        role: 'AUDIENCE',
        seatNumber: null,
        isMuted: false
      });

      // Mock transaction: throw a 403 error (participant was kicked)
      const forbiddenError = new Error('Participant state changed');
      forbiddenError.statusCode = 403;
      prisma.$transaction.mockRejectedValue(forbiddenError);

      // Execute
      const result = await autoPromoteNext(roomId, io);

      // Verify: no retry, null returned
      expect(result).toBeNull();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(dequeue).not.toHaveBeenCalled();
    });

    it('should return null and preserve queue when collision followed by all eligible seats becoming locked', async () => {
      // T-R2: Adversarial scenario from INV-002 correctness gate.
      // Attempt 1 selects Seat 2, P2002 fires. Between attempts, Seat 2 becomes
      // locked. Attempt 2 must find no eligible seat, trigger the null guard,
      // and return null WITHOUT assigning the stale Seat 2 value.
      const roomId = 'room-6';
      const userId = 'user-6';
      const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

      // Room: 2 max speakers, starts with 1 occupied
      prisma.voiceRoom.findUnique.mockResolvedValue({
        maxSpeakers: 2,
        status: 'ACTIVE',
        micLocked: false,
        allMuted: false,
        lockedSeats: []
      });

      // Initial capacity check: 1 of 2 seats taken (room not full — proceed)
      // Fresh count after attempt-1 P2002: still 1 (below maxSpeakers=2 — so no early exit)
      prisma.$queryRaw
        .mockResolvedValueOnce([{ cnt: 1 }])  // initial speakerCount
        .mockResolvedValueOnce([{ cnt: 1 }]); // freshCount after P2002 — still not full

      peekNext.mockResolvedValue({ userId });

      prisma.voiceParticipant.findUnique.mockResolvedValue({
        userId,
        roomId,
        isActive: true,
        handRaised: true,
        wasKicked: false,
        role: 'AUDIENCE',
        seatNumber: null,
        isMuted: false
      });

      let attempt = 0;
      prisma.$transaction.mockImplementation(async (callback) => {
        attempt++;
        if (attempt === 1) {
          // Seat 2 was selected inside tx but collided — P2002
          const err = new Error('Duplicate entry for voice_participants_roomId_seatNumber_key');
          err.code = 'P2002';
          throw err;
        }
        // Attempt 2: Seat 1 is occupied by host (seatNumber=1), Seat 2 is now locked.
        // The scan must find nothing — promotedSeat must stay null.
        const tx = {
          voiceParticipant: {
            findUnique: jest.fn().mockResolvedValueOnce({
              userId, role: 'AUDIENCE', isActive: true,
              wasKicked: false, handRaised: true, seatNumber: null
            })
          },
          voiceRoom: {
            findUnique: jest.fn().mockResolvedValue({
              id: roomId, deletedAt: null, status: 'ACTIVE',
              micLocked: false, maxSpeakers: 2,
              lockedSeats: [1] // 0-based index 1 → Seat 2 now locked
            })
          },
          // Seat 1 occupied; Seat 2 vacant but locked → scan yields nothing
          $queryRaw: jest.fn().mockResolvedValue([{ seatNumber: 1 }]),
          $executeRaw: jest.fn().mockResolvedValue(1)
        };
        return callback(tx);
      });

      const promise = autoPromoteNext(roomId, io);
      await jest.advanceTimersByTimeAsync(50);
      const result = await promise;

      // Must return null — no seat assigned, queue intact
      expect(result).toBeNull();
      expect(dequeue).not.toHaveBeenCalled();
      // Attempt 2 ran (no stale early-exit from capacity check)
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

  });

});
