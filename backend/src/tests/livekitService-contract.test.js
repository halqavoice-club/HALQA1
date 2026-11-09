'use strict';
/**
 * livekitService-contract.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE F2-A: Verifies sfuRevokePublish() return contract.
 *
 * Tests that the function returns explicit enforcement status for all paths:
 * - Success: { enforced: true, reason: 'UPDATED' }
 * - Not configured: { enforced: true, reason: 'NOT_CONFIGURED' }
 * - Participant/room not found: { enforced: false, reason: 'NOT_FOUND' }
 * - Timeout: { enforced: false, reason: 'TIMEOUT' }
 * - Other SDK errors: { enforced: false, reason: 'UPDATE_FAILED' }
 *
 * Also verifies both grant (canPublish: true) and revoke (canPublish: false)
 * operations work correctly.
 */

const { sfuRevokePublish } = require('../utils/livekitService');

// Mock LiveKit SDK
jest.mock('livekit-server-sdk', () => ({
  RoomServiceClient: jest.fn(),
}));

// Mock logger
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { RoomServiceClient } = require('livekit-server-sdk');
const logger = require('../utils/logger');

describe('livekitService-contract — PHASE F2-A', () => {
  let originalEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('sfuRevokePublish() return contract', () => {
    test('TC1: Success (canPublish=false) → { enforced: true, reason: "UPDATED" }', async () => {
      // Arrange
      process.env.LIVEKIT_URL = 'wss://livekit.example.com';
      process.env.LIVEKIT_API_KEY = 'test-key';
      process.env.LIVEKIT_API_SECRET = 'test-secret';

      const mockUpdateParticipant = jest.fn().mockResolvedValue(undefined);
      RoomServiceClient.mockImplementation(() => ({
        updateParticipant: mockUpdateParticipant,
      }));

      // Act
      const result = await sfuRevokePublish('room-123', 'user-456', false, '[test]');

      // Assert
      expect(result).toEqual({ enforced: true, reason: 'UPDATED' });
      expect(mockUpdateParticipant).toHaveBeenCalledWith('room-123', 'user-456', undefined, {
        canPublish: false,
        canSubscribe: true,
        canPublishData: false,
      });
      expect(logger.info).toHaveBeenCalledWith(
        '[test] SFU canPublish=false set for user-456 in room-123'
      );
    });

    test('TC2: Success (canPublish=true, grant) → { enforced: true, reason: "UPDATED" }', async () => {
      // Arrange
      process.env.LIVEKIT_URL = 'wss://livekit.example.com';
      process.env.LIVEKIT_API_KEY = 'test-key';
      process.env.LIVEKIT_API_SECRET = 'test-secret';

      const mockUpdateParticipant = jest.fn().mockResolvedValue(undefined);
      RoomServiceClient.mockImplementation(() => ({
        updateParticipant: mockUpdateParticipant,
      }));

      // Act
      const result = await sfuRevokePublish('room-123', 'user-456', true, '[test]');

      // Assert
      expect(result).toEqual({ enforced: true, reason: 'UPDATED' });
      expect(mockUpdateParticipant).toHaveBeenCalledWith('room-123', 'user-456', undefined, {
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });
      expect(logger.info).toHaveBeenCalledWith(
        '[test] SFU canPublish=true set for user-456 in room-123'
      );
    });

    test('TC3: Not configured → { enforced: true, reason: "NOT_CONFIGURED" }', async () => {
      // Arrange
      delete process.env.LIVEKIT_URL;
      delete process.env.LIVEKIT_API_KEY;
      delete process.env.LIVEKIT_API_SECRET;

      // Act
      const result = await sfuRevokePublish('room-123', 'user-456', false, '[test]');

      // Assert
      expect(result).toEqual({ enforced: true, reason: 'NOT_CONFIGURED' });
      expect(RoomServiceClient).not.toHaveBeenCalled();
    });

    test('TC4: Participant not found → { enforced: false, reason: "NOT_FOUND" }', async () => {
      // Arrange
      process.env.LIVEKIT_URL = 'wss://livekit.example.com';
      process.env.LIVEKIT_API_KEY = 'test-key';
      process.env.LIVEKIT_API_SECRET = 'test-secret';

      const mockUpdateParticipant = jest.fn().mockRejectedValue(
        new Error('Participant not found in room')
      );
      RoomServiceClient.mockImplementation(() => ({
        updateParticipant: mockUpdateParticipant,
      }));

      // Act
      const result = await sfuRevokePublish('room-123', 'user-456', false, '[test]');

      // Assert
      expect(result).toEqual({ enforced: false, reason: 'NOT_FOUND' });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('SFU updateParticipant failed for user-456 in room-123')
      );
    });

    test('TC5: Room not found → { enforced: false, reason: "NOT_FOUND" }', async () => {
      // Arrange
      process.env.LIVEKIT_URL = 'wss://livekit.example.com';
      process.env.LIVEKIT_API_KEY = 'test-key';
      process.env.LIVEKIT_API_SECRET = 'test-secret';

      const mockUpdateParticipant = jest.fn().mockRejectedValue(
        new Error('Room not found')
      );
      RoomServiceClient.mockImplementation(() => ({
        updateParticipant: mockUpdateParticipant,
      }));

      // Act
      const result = await sfuRevokePublish('room-123', 'user-456', false, '[test]');

      // Assert
      expect(result).toEqual({ enforced: false, reason: 'NOT_FOUND' });
    });

    test('TC6: Timeout → { enforced: false, reason: "TIMEOUT" }', async () => {
      // Arrange
      process.env.LIVEKIT_URL = 'wss://livekit.example.com';
      process.env.LIVEKIT_API_KEY = 'test-key';
      process.env.LIVEKIT_API_SECRET = 'test-secret';

      const mockUpdateParticipant = jest.fn().mockRejectedValue(
        new Error('Request timeout after 5000ms')
      );
      RoomServiceClient.mockImplementation(() => ({
        updateParticipant: mockUpdateParticipant,
      }));

      // Act
      const result = await sfuRevokePublish('room-123', 'user-456', false, '[test]');

      // Assert
      expect(result).toEqual({ enforced: false, reason: 'TIMEOUT' });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('timeout')
      );
    });

    test('TC7: Other SDK error → { enforced: false, reason: "UPDATE_FAILED" }', async () => {
      // Arrange
      process.env.LIVEKIT_URL = 'wss://livekit.example.com';
      process.env.LIVEKIT_API_KEY = 'test-key';
      process.env.LIVEKIT_API_SECRET = 'test-secret';

      const mockUpdateParticipant = jest.fn().mockRejectedValue(
        new Error('Internal server error')
      );
      RoomServiceClient.mockImplementation(() => ({
        updateParticipant: mockUpdateParticipant,
      }));

      // Act
      const result = await sfuRevokePublish('room-123', 'user-456', false, '[test]');

      // Assert
      expect(result).toEqual({ enforced: false, reason: 'UPDATE_FAILED' });
    });

    test('TC8: Network error (no message property) → { enforced: false, reason: "UPDATE_FAILED" }', async () => {
      // Arrange
      process.env.LIVEKIT_URL = 'wss://livekit.example.com';
      process.env.LIVEKIT_API_KEY = 'test-key';
      process.env.LIVEKIT_API_SECRET = 'test-secret';

      const mockUpdateParticipant = jest.fn().mockRejectedValue(
        { code: 'ECONNREFUSED' } // Error without message property
      );
      RoomServiceClient.mockImplementation(() => ({
        updateParticipant: mockUpdateParticipant,
      }));

      // Act
      const result = await sfuRevokePublish('room-123', 'user-456', false, '[test]');

      // Assert
      expect(result).toEqual({ enforced: false, reason: 'UPDATE_FAILED' });
    });
  });

  describe('No accidental false success', () => {
    test('TC9: Undefined return from SDK treated as success (real SDK behavior)', async () => {
      // Arrange
      process.env.LIVEKIT_URL = 'wss://livekit.example.com';
      process.env.LIVEKIT_API_KEY = 'test-key';
      process.env.LIVEKIT_API_SECRET = 'test-secret';

      // Real LiveKit SDK returns undefined on success
      const mockUpdateParticipant = jest.fn().mockResolvedValue(undefined);
      RoomServiceClient.mockImplementation(() => ({
        updateParticipant: mockUpdateParticipant,
      }));

      // Act
      const result = await sfuRevokePublish('room-123', 'user-456', false, '[test]');

      // Assert
      expect(result).toEqual({ enforced: true, reason: 'UPDATED' });
    });

    test('TC10: Rejected promise → enforced: false', async () => {
      // Arrange
      process.env.LIVEKIT_URL = 'wss://livekit.example.com';
      process.env.LIVEKIT_API_KEY = 'test-key';
      process.env.LIVEKIT_API_SECRET = 'test-secret';

      const mockUpdateParticipant = jest.fn().mockRejectedValue(
        new Error('Any error')
      );
      RoomServiceClient.mockImplementation(() => ({
        updateParticipant: mockUpdateParticipant,
      }));

      // Act
      const result = await sfuRevokePublish('room-123', 'user-456', false, '[test]');

      // Assert
      expect(result.enforced).toBe(false);
      expect(result.reason).toBeTruthy();
    });
  });
});
