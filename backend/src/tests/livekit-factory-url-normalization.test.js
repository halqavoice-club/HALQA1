'use strict';
/**
 * LiveKit Factory URL Normalization Test
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests that the centralized getLivekitRoomService correctly normalizes URLs
 * for RoomServiceClient which requires HTTP/HTTPS, not WebSocket URLs.
 */

jest.mock('livekit-server-sdk', () => ({
  RoomServiceClient: jest.fn().mockImplementation((host, key, secret) => ({
    host,
    key,
    secret,
  })),
}));

const { getLivekitRoomService } = require('../utils/livekitService');
const { RoomServiceClient } = require('livekit-server-sdk');

describe('getLivekitRoomService URL normalization', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('transforms wss:// to https://', () => {
    process.env.LIVEKIT_URL = 'wss://my-project.livekit.cloud';
    process.env.LIVEKIT_API_KEY = 'test-key';
    process.env.LIVEKIT_API_SECRET = 'test-secret';

    const svc = getLivekitRoomService();
    expect(svc).not.toBeNull();
    expect(RoomServiceClient).toHaveBeenCalledWith('https://my-project.livekit.cloud', 'test-key', 'test-secret');
  });

  test('transforms ws:// to http://', () => {
    process.env.LIVEKIT_URL = 'ws://localhost:7880';
    process.env.LIVEKIT_API_KEY = 'test-key';
    process.env.LIVEKIT_API_SECRET = 'test-secret';

    const svc = getLivekitRoomService();
    expect(svc).not.toBeNull();
    expect(RoomServiceClient).toHaveBeenCalledWith('http://localhost:7880', 'test-key', 'test-secret');
  });

  test('passes https:// unchanged', () => {
    process.env.LIVEKIT_URL = 'https://my-project.livekit.cloud';
    process.env.LIVEKIT_API_KEY = 'test-key';
    process.env.LIVEKIT_API_SECRET = 'test-secret';

    const svc = getLivekitRoomService();
    expect(svc).not.toBeNull();
    expect(RoomServiceClient).toHaveBeenCalledWith('https://my-project.livekit.cloud', 'test-key', 'test-secret');
  });

  test('passes http:// unchanged', () => {
    process.env.LIVEKIT_URL = 'http://localhost:7880';
    process.env.LIVEKIT_API_KEY = 'test-key';
    process.env.LIVEKIT_API_SECRET = 'test-secret';

    const svc = getLivekitRoomService();
    expect(svc).not.toBeNull();
    expect(RoomServiceClient).toHaveBeenCalledWith('http://localhost:7880', 'test-key', 'test-secret');
  });

  test('returns null when LIVEKIT_URL is missing', () => {
    process.env.LIVEKIT_API_KEY = 'test-key';
    process.env.LIVEKIT_API_SECRET = 'test-secret';
    delete process.env.LIVEKIT_URL;

    const svc = getLivekitRoomService();
    expect(svc).toBeNull();
    expect(RoomServiceClient).not.toHaveBeenCalled();
  });

  test('returns null when LIVEKIT_API_KEY is missing', () => {
    process.env.LIVEKIT_URL = 'wss://my-project.livekit.cloud';
    process.env.LIVEKIT_API_SECRET = 'test-secret';
    delete process.env.LIVEKIT_API_KEY;

    const svc = getLivekitRoomService();
    expect(svc).toBeNull();
    expect(RoomServiceClient).not.toHaveBeenCalled();
  });

  test('returns null when LIVEKIT_API_SECRET is missing', () => {
    process.env.LIVEKIT_URL = 'wss://my-project.livekit.cloud';
    process.env.LIVEKIT_API_KEY = 'test-key';
    delete process.env.LIVEKIT_API_SECRET;

    const svc = getLivekitRoomService();
    expect(svc).toBeNull();
    expect(RoomServiceClient).not.toHaveBeenCalled();
  });

  test('returns null when all env vars are missing', () => {
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;

    const svc = getLivekitRoomService();
    expect(svc).toBeNull();
    expect(RoomServiceClient).not.toHaveBeenCalled();
  });
});
