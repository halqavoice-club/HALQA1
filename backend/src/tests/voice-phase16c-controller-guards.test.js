/**
 * Phase 16c Controller-Level Authorization Guard Tests
 * 
 * MISSION: Verify that all four high-risk getVoiceAudioPermission call sites
 * in voice.controller.js explicitly reject null/missing room data and never
 * issue unauthorized SFU publishing grants.
 * 
 * CRITICAL SECURITY REQUIREMENT: Missing or invalid room data must NEVER result
 * in microphone publication permission (canPublish: true).
 * 
 * Test Coverage:
 * 1. Call Site 1: toggleMute self-unmute (line ~1276)
 * 2. Call Site 2: toggleMute idempotent re-grant (line ~1320)
 * 3. Call Site 3: toggleMute moderator action (line ~1414)
 * 4. Call Site 4: toggleMute final self-unmute check (line ~1439)
 */

const request = require('supertest');
const express = require('express');
const prisma = require('../utils/prisma');
const { getVoiceAudioPermission } = require('../utils/voiceAudioPermission');

// Mock dependencies
jest.mock('../utils/prisma', () => {
  const mockPrisma = {
    voiceRoom: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    voiceParticipant: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };
  mockPrisma.$transaction = jest.fn((callback) => callback(mockPrisma));
  return mockPrisma;
});

jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => false),
  getCache: jest.fn(),
  setCache: jest.fn(),
  deleteCache: jest.fn(),
}));

jest.mock('../utils/voiceRoomCache', () => ({
  invalidateRoomCache: jest.fn(),
  getNextStageVersion: jest.fn(() => 1),
  getCurrentStageVersion: jest.fn(() => 1),
}));

jest.mock('../sockets', () => ({
  getIo: jest.fn(() => null),
}));

jest.mock('../utils/livekitService', () => ({
  sfuRevokePublish: jest.fn(),
  sfuEvict: jest.fn(),
  getLivekitRoomService: jest.fn(() => null),
}));

jest.mock('../utils/response', () => ({
  successResponse: (res, data, message) => {
    return res.status(200).json({
      success: true,
      data,
      message: message || 'Success',
    });
  },
  errorResponse: (res, message, statusCode) => {
    return res.status(statusCode || 400).json({
      success: false,
      error: message,
      message,
    });
  },
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { sfuRevokePublish } = require('../utils/livekitService');

// Import controller after mocks are set up
const voice = require('../controllers/voice.controller');

// Helper to create Express app with controller route
function createTestApp() {
  const app = express();
  app.use(express.json());
  
  // Mock auth middleware
  app.use((req, res, next) => {
    req.user = { id: 'test-user-id', schoolId: 'test-school-id' };
    next();
  });
  
  // Mount toggleMute route
  app.post('/voice/:id/toggle-mute', voice.toggleMute);
  
  return app;
}

describe('Phase 16c: Controller-Level Authorization Guards', () => {
  let app;
  
  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
    
    // Default mock: sfuRevokePublish returns successful enforcement
    sfuRevokePublish.mockResolvedValue({ enforced: true, reason: 'OK' });
    
    // Default mock: updateMany returns success
    prisma.voiceParticipant.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('Call Site 1: toggleMute self-unmute initial check', () => {
    test('rejects self-unmute when room query returns null', async () => {
      const roomId = 'room-1';
      const userId = 'test-user-id';

      // Setup: participant exists and wants to unmute
      prisma.voiceParticipant.findUnique.mockResolvedValue({
        userId,
        roomId,
        role: 'SPEAKER',
        isActive: true,
        isMuted: true,
        mutedByModerator: false,
        seatNumber: 2,
      });

      // CRITICAL: Room query returns null (concurrent deletion)
      prisma.voiceRoom.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post(`/voice/${roomId}/toggle-mute`)
        .send({ isMuted: false });

      // VERIFY: Controller rejects with 404 before calling utility
      expect(response.status).toBe(404);
      expect(response.body.error).toMatch(/room no longer exists/i);

      // SECURITY ASSERTION: sfuRevokePublish must NOT be called
      expect(sfuRevokePublish).not.toHaveBeenCalled();
    });

    test('rejects self-unmute when room query returns undefined', async () => {
      const roomId = 'room-2';
      const userId = 'test-user-id';

      prisma.voiceParticipant.findUnique.mockResolvedValue({
        userId,
        roomId,
        role: 'SPEAKER',
        isActive: true,
        isMuted: true,
        mutedByModerator: false,
        seatNumber: 2,
      });

      // Room query returns undefined
      prisma.voiceRoom.findUnique.mockResolvedValue(undefined);

      const response = await request(app)
        .post(`/voice/${roomId}/toggle-mute`)
        .send({ isMuted: false });

      expect(response.status).toBe(404);
      expect(response.body.error).toMatch(/room no longer exists/i);
      expect(sfuRevokePublish).not.toHaveBeenCalled();
    });

    test('allows self-unmute when room data is valid', async () => {
      const roomId = 'room-3';
      const userId = 'test-user-id';

      // NORMAL UNMUTE PATH: 2 findUnique calls
      // Call 1: Initial participant check (line ~1248)
      // Call 2: Re-read participant after updateMany (line ~1383)
      prisma.voiceParticipant.findUnique
        .mockResolvedValueOnce({
          userId,
          roomId,
          role: 'SPEAKER',
          isActive: true,
          isMuted: true,
          mutedByModerator: false,
          seatNumber: 2,
        })
        .mockResolvedValueOnce({
          // After updateMany: isMuted changed to false
          userId,
          roomId,
          role: 'SPEAKER',
          isActive: true,
          isMuted: false,
          mutedByModerator: false,
          seatNumber: 2,
        });

      // Valid room data
      prisma.voiceRoom.findUnique.mockResolvedValue({
        id: roomId,
        micLocked: false,
        allMuted: false,
      });

      const response = await request(app)
        .post(`/voice/${roomId}/toggle-mute`)
        .send({ isMuted: false });

      // Should succeed
      expect(response.status).toBe(200);
      expect(response.body.data.isMuted).toBe(false);
    });
  });

  describe('Call Site 2: toggleMute idempotent re-grant', () => {
    test('rejects idempotent unmute when freshRoom is null', async () => {
      const roomId = 'room-4';
      const userId = 'test-user-id';

      // Setup: participant is already unmuted (triggers idempotent path)
      prisma.voiceParticipant.findUnique
        .mockResolvedValueOnce({
          // First call: initial participant check
          userId,
          roomId,
          role: 'SPEAKER',
          isActive: true,
          isMuted: false, // Already unmuted
          mutedByModerator: false,
          seatNumber: 2,
        })
        .mockResolvedValueOnce({
          // Second call: fresh participant in idempotent path
          userId,
          roomId,
          role: 'SPEAKER',
          isActive: true,
          isMuted: false,
          mutedByModerator: false,
          seatNumber: 2,
        });

      // First room query succeeds, second returns null
      prisma.voiceRoom.findUnique
        .mockResolvedValueOnce({
          id: roomId,
          micLocked: false,
          allMuted: false,
        })
        .mockResolvedValueOnce(null); // freshRoom is null

      const response = await request(app)
        .post(`/voice/${roomId}/toggle-mute`)
        .send({ isMuted: false });

      // VERIFY: Idempotent path rejects with 404
      expect(response.status).toBe(404);
      expect(response.body.error).toMatch(/room no longer exists/i);

      // SECURITY ASSERTION: No SFU grant issued
      expect(sfuRevokePublish).not.toHaveBeenCalled();
    });

    test('allows idempotent unmute when freshRoom is valid', async () => {
      const roomId = 'room-5';
      const userId = 'test-user-id';

      prisma.voiceParticipant.findUnique.mockResolvedValue({
        userId,
        roomId,
        role: 'SPEAKER',
        isActive: true,
        isMuted: false, // Already unmuted
        mutedByModerator: false,
        seatNumber: 2,
      });

      // Both room queries succeed
      prisma.voiceRoom.findUnique.mockResolvedValue({
        id: roomId,
        micLocked: false,
        allMuted: false,
      });

      const response = await request(app)
        .post(`/voice/${roomId}/toggle-mute`)
        .send({ isMuted: false });

      expect(response.status).toBe(200);
      expect(response.body.data.canPublishAudio).toBe(true);
      
      // SFU grant should be issued
      expect(sfuRevokePublish).toHaveBeenCalledWith(
        roomId,
        userId,
        true, // canPublish: true
        '[voice:self-unmute]'
      );
    });
  });

  describe('Call Site 3: toggleMute moderator action', () => {
    test('rejects moderator unmute when room is null', async () => {
      const roomId = 'room-6';
      const moderatorId = 'test-user-id';
      const targetUserId = 'target-user-id';

      // Moderator exists
      prisma.voiceParticipant.findUnique
        .mockResolvedValueOnce({
          // First call: moderator check
          userId: moderatorId,
          roomId,
          role: 'MODERATOR',
          isActive: true,
        })
        .mockResolvedValueOnce({
          // Second call: target user
          userId: targetUserId,
          roomId,
          role: 'SPEAKER',
          isActive: true,
          isMuted: true,
          mutedByModerator: true,
          seatNumber: 3,
        });

      // Update succeeds
      prisma.voiceParticipant.update.mockResolvedValue({
        userId: targetUserId,
        roomId,
        role: 'SPEAKER',
        isActive: true,
        isMuted: false,
        mutedByModerator: false,
        seatNumber: 3,
      });

      // Room query returns null
      prisma.voiceRoom.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post(`/voice/${roomId}/toggle-mute`)
        .send({ 
          isMuted: false,
          targetUserId,
        });

      // VERIFY: Moderator action rejects with 404
      expect(response.status).toBe(404);
      expect(response.body.error).toMatch(/room no longer exists/i);

      // SECURITY ASSERTION: No SFU operation attempted
      expect(sfuRevokePublish).not.toHaveBeenCalled();
    });

    test('allows moderator unmute when room is valid', async () => {
      const roomId = 'room-7';
      const moderatorId = 'test-user-id';
      const targetUserId = 'target-user-id';

      prisma.voiceParticipant.findUnique
        .mockResolvedValueOnce({
          userId: moderatorId,
          roomId,
          role: 'MODERATOR',
          isActive: true,
        })
        .mockResolvedValueOnce({
          userId: targetUserId,
          roomId,
          role: 'SPEAKER',
          isActive: true,
          isMuted: true,
          mutedByModerator: true,
          seatNumber: 3,
        });

      prisma.voiceParticipant.update.mockResolvedValue({
        userId: targetUserId,
        roomId,
        role: 'SPEAKER',
        isActive: true,
        isMuted: false,
        mutedByModerator: false,
        seatNumber: 3,
      });

      // Valid room
      prisma.voiceRoom.findUnique.mockResolvedValue({
        id: roomId,
        micLocked: false,
        allMuted: false,
      });

      const response = await request(app)
        .post(`/voice/${roomId}/toggle-mute`)
        .send({ 
          isMuted: false,
          targetUserId,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.canPublishAudio).toBe(true);
      
      // SFU grant issued
      expect(sfuRevokePublish).toHaveBeenCalledWith(
        roomId,
        targetUserId,
        true, // canPublish: true
        '[voice:mod-unmute]'
      );
    });
  });

  describe('Call Site 4: toggleMute final self-unmute check', () => {
    test('rejects final authorization when room becomes null', async () => {
      const roomId = 'room-8';
      const userId = 'test-user-id';

      prisma.voiceParticipant.findUnique.mockResolvedValue({
        userId,
        roomId,
        role: 'SPEAKER',
        isActive: true,
        isMuted: true,
        mutedByModerator: false,
        seatNumber: 2,
      });

      // First room query succeeds (initial check)
      prisma.voiceRoom.findUnique
        .mockResolvedValueOnce({
          id: roomId,
          micLocked: false,
          allMuted: false,
        })
        .mockResolvedValueOnce(null); // Final check returns null

      prisma.voiceParticipant.update.mockResolvedValue({
        userId,
        roomId,
        role: 'SPEAKER',
        isActive: true,
        isMuted: false,
        mutedByModerator: false,
        seatNumber: 2,
      });

      const response = await request(app)
        .post(`/voice/${roomId}/toggle-mute`)
        .send({ isMuted: false });

      // VERIFY: Final authorization rejects with 404
      expect(response.status).toBe(404);
      expect(response.body.error).toMatch(/room no longer exists/i);

      // SECURITY ASSERTION: No SFU grant despite DB write
      expect(sfuRevokePublish).not.toHaveBeenCalled();
    });

    test('allows self-unmute when final room check is valid', async () => {
      const roomId = 'room-9';
      const userId = 'test-user-id';

      // NORMAL UNMUTE PATH: 2 findUnique calls
      // Call 1: Initial participant check (line ~1248)
      // Call 2: Re-read participant after updateMany (line ~1383)
      prisma.voiceParticipant.findUnique
        .mockResolvedValueOnce({
          userId,
          roomId,
          role: 'SPEAKER',
          isActive: true,
          isMuted: true,
          mutedByModerator: false,
          seatNumber: 2,
        })
        .mockResolvedValueOnce({
          // After updateMany: isMuted changed to false
          userId,
          roomId,
          role: 'SPEAKER',
          isActive: true,
          isMuted: false,
          mutedByModerator: false,
          seatNumber: 2,
        });

      // Single room query in normal path
      prisma.voiceRoom.findUnique.mockResolvedValue({
        id: roomId,
        micLocked: false,
        allMuted: false,
      });

      // Mock the updateMany to return success
      prisma.voiceParticipant.updateMany.mockResolvedValue({ count: 1 });

      const response = await request(app)
        .post(`/voice/${roomId}/toggle-mute`)
        .send({ isMuted: false });

      expect(response.status).toBe(200);
      expect(response.body.data.isMuted).toBe(false);
    });
  });

  describe('Security Invariant: No SFU Grant Without Valid Authorization', () => {
    test('ensures sfuRevokePublish never receives canPublish:true when room is null', async () => {
      const roomId = 'room-10';
      const userId = 'test-user-id';

      prisma.voiceParticipant.findUnique.mockResolvedValue({
        userId,
        roomId,
        role: 'SPEAKER',
        isActive: true,
        isMuted: true,
        mutedByModerator: false,
        seatNumber: 2,
      });

      // Room is null
      prisma.voiceRoom.findUnique.mockResolvedValue(null);

      await request(app)
        .post(`/voice/${roomId}/toggle-mute`)
        .send({ isMuted: false });

      // CRITICAL: Verify sfuRevokePublish was NEVER called with canPublish:true
      const allCalls = sfuRevokePublish.mock.calls;
      allCalls.forEach(call => {
        const [, , canPublish] = call;
        expect(canPublish).not.toBe(true);
      });
    });
  });
});
