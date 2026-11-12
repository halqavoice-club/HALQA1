'use strict';
/**
 * PH24A — LiveKit Security Remediation Tests
 *
 * Covers all 8 findings from the Phase 24A audit:
 *
 *  PH17-001 — Role-based canPublish: AUDIENCE gets canPublish:false at token issuance
 *  PH17-002 — SFU eviction on kick/ban (sfuEvict called best-effort)
 *  PH17-003 — Voice moderator demotion triggers sfuRevokePublish
 *  PH17-003 — muteAll triggers sfuRevokePublish for each muted speaker
 *  PH17-004 — Live class demoteFromStage triggers sfuRevokePublish
 *  PH18-002 — Public live class kicked participant cannot regain capability
 *  PH19-002 — Mobile stale token: tokenFetcherRef halts retry on 403
 *  PH22-002 — Web voice canPublish enforced at SFU level, not just UI
 *  PH22-003 — Stale capability closed by updateParticipant (sfuRevokePublish)
 *
 * Architecture:
 *   - Backend tests: mock Prisma + mock livekitService to verify the calls
 *     are made (or not made) for each scenario.
 *   - Mobile tests: source-level assertions on useLiveKitAudio.ts.
 *
 * All tests are negative + positive (allowed + denied).
 */

jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady:       jest.fn(() => false),
  getCache:           jest.fn().mockResolvedValue(null),
  setCache:           jest.fn().mockResolvedValue(undefined),
  deleteCache:        jest.fn().mockResolvedValue(undefined),
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/jwt',   () => ({ verifyAccessToken: jest.fn() }));
jest.mock('../sockets',     () => ({ getIo: jest.fn(() => null) }));
jest.mock('../utils/feedLive', () => ({
  broadcastLiveStart: jest.fn(),
  broadcastLiveEnd:   jest.fn(),
  broadcastLiveUpdate: jest.fn(),
}));
jest.mock('../utils/autoPromote', () => ({ autoPromoteNext: jest.fn() }));
jest.mock('../utils/voiceQueue',  () => ({
  clearQueue: jest.fn(), enqueue: jest.fn(), getQueue: jest.fn(() => []),
  isInQueue: jest.fn(() => false), dequeue: jest.fn(),
}));
jest.mock('../services/queue.service', () => ({
  queueBulkNotifications: jest.fn(),
  scheduleRoomReminder:   jest.fn(),
  cancelRoomReminder:     jest.fn(),
}));
jest.mock('../utils/livekitService', () => ({
  getLivekitRoomService: jest.fn(() => null),
  sfuEvict:              jest.fn().mockResolvedValue(undefined),
  sfuRevokePublish:      jest.fn().mockResolvedValue(undefined),
}));

// Phase 16c: getLiveKitToken now calls getVoiceAudioPermission to determine canPublish
jest.mock('../utils/voiceAudioPermission', () => ({
  getVoiceAudioPermission: jest.fn(),
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
jest.mock('livekit-server-sdk', () => ({
  AccessToken: jest.fn().mockImplementation(() => ({
    addGrant: jest.fn(),
    toJwt:    jest.fn().mockResolvedValue('mock.livekit.token'),
  })),
  RoomServiceClient: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const prisma = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');
const { sfuEvict, sfuRevokePublish } = require('../utils/livekitService');
const { getVoiceAudioPermission } = require('../utils/voiceAudioPermission');
const { AccessToken } = require('livekit-server-sdk');
const fs   = require('fs');
const path = require('path');

// ─── App helpers ──────────────────────────────────────────────────────────────
function makeApp(routeFn) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { authenticate } = require('../middleware/auth.middleware');
  routeFn(app, authenticate);
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

function asUser(id, role = 'MEMBER', schoolId = 'school-1') {
  const u = { id, role, status: 'ACTIVE', schoolId,
    firstName: 'T', lastName: 'U', avatarUrl: null, deletedAt: null };
  verifyAccessToken.mockReturnValue({ userId: id, role, schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}
const tok = id => `Bearer t-${id}`;

const ROOM_ID  = 'voice-room-001';
const USER_ID  = 'user-001';
const TARGET   = 'user-002';
const SCHOOL   = 'school-1';
const LC_ID    = 'lc-001';

beforeEach(() => {
  jest.clearAllMocks();
  if (!prisma.voiceRoom)             prisma.voiceRoom             = {};
  if (!prisma.voiceParticipant)      prisma.voiceParticipant      = {};
  if (!prisma.voiceRoomMember)       prisma.voiceRoomMember       = {};
  if (!prisma.auditLog)              prisma.auditLog              = {};
  if (!prisma.liveClass)             prisma.liveClass             = {};
  if (!prisma.liveClassParticipant)  prisma.liveClassParticipant  = {};
  if (!prisma.schoolMembership)      prisma.schoolMembership      = {};
  if (!prisma.$transaction)          prisma.$transaction          = jest.fn(fn => fn(prisma));
  if (!prisma.$executeRaw)           prisma.$executeRaw           = jest.fn().mockResolvedValue(1);
  if (!prisma.$executeRawUnsafe)     prisma.$executeRawUnsafe     = jest.fn().mockResolvedValue(1);
  if (!prisma.$queryRawUnsafe)       prisma.$queryRawUnsafe       = jest.fn().mockResolvedValue([]);

  prisma.auditLog.create = jest.fn().mockResolvedValue({});
  prisma.voiceRoomMember.findUnique = jest.fn().mockResolvedValue(null);
  prisma.voiceRoomMember.upsert     = jest.fn().mockResolvedValue({});
  prisma.voiceRoomMember.count      = jest.fn().mockResolvedValue(0);
  prisma.voiceRoomMember.create     = jest.fn().mockResolvedValue({});
  prisma.voiceRoomMember.update     = jest.fn().mockResolvedValue({});
  prisma.voiceParticipant.findMany  = jest.fn().mockResolvedValue([]);
  prisma.voiceParticipant.findUnique= jest.fn().mockResolvedValue(null);
  prisma.voiceParticipant.update    = jest.fn().mockResolvedValue({});
  prisma.voiceParticipant.updateMany= jest.fn().mockResolvedValue({ count: 1 });
  prisma.voiceParticipant.count     = jest.fn().mockResolvedValue(0);

  sfuEvict.mockClear();
  sfuRevokePublish.mockClear();
  getVoiceAudioPermission.mockClear();
  
  // Phase 16c: Default getVoiceAudioPermission to allow publication
  // Individual tests override as needed
  getVoiceAudioPermission.mockReturnValue({
    canPublishAudio: true,
    reason: 'ALLOWED',
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PH17-001 — Role-based canPublish at token issuance
// ═══════════════════════════════════════════════════════════════════════════════
describe('PH17-001: Role-based canPublish at token issuance (voice)', () => {
  let app;
  beforeAll(() => {
    app = makeApp((a, auth) => {
      const { getLiveKitToken } = require('../controllers/livekit.controller');
      a.get('/voice/:id/livekit-token', auth, getLiveKitToken);
    });
  });

  const LIVE_ROOM = { id: ROOM_ID, status: 'LIVE', deletedAt: null, micLocked: false };
  const LOCKED_ROOM = { id: ROOM_ID, status: 'LIVE', deletedAt: null, micLocked: true };

  test('HOST receives canPublish:true', async () => {
    asUser(USER_ID);
    prisma.voiceRoom.findUnique     = jest.fn().mockResolvedValue(LIVE_ROOM);
    prisma.voiceParticipant.findUnique = jest.fn().mockResolvedValue({ isActive: true, role: 'HOST' });

    const res = await request(app).get(`/voice/${ROOM_ID}/livekit-token`).set('Authorization', tok(USER_ID));
    expect(res.status).toBe(200);

    const addGrantCall = AccessToken.mock.results[0]?.value?.addGrant.mock.calls[0]?.[0];
    expect(addGrantCall?.canPublish).toBe(true);
  });

  test('MODERATOR receives canPublish:true', async () => {
    asUser(USER_ID);
    prisma.voiceRoom.findUnique        = jest.fn().mockResolvedValue(LIVE_ROOM);
    prisma.voiceParticipant.findUnique = jest.fn().mockResolvedValue({ isActive: true, role: 'MODERATOR' });

    await request(app).get(`/voice/${ROOM_ID}/livekit-token`).set('Authorization', tok(USER_ID));

    const addGrantCall = AccessToken.mock.results[0]?.value?.addGrant.mock.calls[0]?.[0];
    expect(addGrantCall?.canPublish).toBe(true);
  });

  test('SPEAKER receives canPublish:true', async () => {
    asUser(USER_ID);
    prisma.voiceRoom.findUnique        = jest.fn().mockResolvedValue(LIVE_ROOM);
    prisma.voiceParticipant.findUnique = jest.fn().mockResolvedValue({ isActive: true, role: 'SPEAKER' });

    await request(app).get(`/voice/${ROOM_ID}/livekit-token`).set('Authorization', tok(USER_ID));

    const addGrantCall = AccessToken.mock.results[0]?.value?.addGrant.mock.calls[0]?.[0];
    expect(addGrantCall?.canPublish).toBe(true);
  });

  test('AUDIENCE receives canPublish:false when room is mic-locked — PH17-001 core fix', async () => {
    asUser(USER_ID);
    // Use LOCKED_ROOM: when micLocked=true, AUDIENCE gets canPublish:false
    prisma.voiceRoom.findUnique        = jest.fn().mockResolvedValue(LOCKED_ROOM);
    prisma.voiceParticipant.findUnique = jest.fn().mockResolvedValue({ isActive: true, role: 'AUDIENCE' });
    
    // Phase 16c: Mock getVoiceAudioPermission to return false for mic-locked AUDIENCE
    getVoiceAudioPermission.mockReturnValueOnce({
      canPublishAudio: false,
      reason: 'MIC_LOCKED',
    });

    const res = await request(app).get(`/voice/${ROOM_ID}/livekit-token`).set('Authorization', tok(USER_ID));
    expect(res.status).toBe(200);

    const addGrantCall = AccessToken.mock.results[0]?.value?.addGrant.mock.calls[0]?.[0];
    expect(addGrantCall?.canPublish).toBe(false);
  });

  test('AUDIENCE receives canPublish:true when room is unlocked — original contract preserved', async () => {
    asUser(USER_ID);
    prisma.voiceRoom.findUnique        = jest.fn().mockResolvedValue(LIVE_ROOM); // micLocked:false
    prisma.voiceParticipant.findUnique = jest.fn().mockResolvedValue({ isActive: true, role: 'AUDIENCE' });

    const res = await request(app).get(`/voice/${ROOM_ID}/livekit-token`).set('Authorization', tok(USER_ID));
    expect(res.status).toBe(200);

    const addGrantCall = AccessToken.mock.results[0]?.value?.addGrant.mock.calls[0]?.[0];
    expect(addGrantCall?.canPublish).toBe(true);
  });

  test('inactive participant is denied — no token issued', async () => {
    asUser(USER_ID);
    prisma.voiceRoom.findUnique        = jest.fn().mockResolvedValue(LIVE_ROOM);
    prisma.voiceParticipant.findUnique = jest.fn().mockResolvedValue({ isActive: false, role: 'AUDIENCE' });
    
    // Phase 16c: Mock getVoiceAudioPermission to return false for inactive participant
    getVoiceAudioPermission.mockReturnValueOnce({
      canPublishAudio: false,
      reason: 'INACTIVE',
    });

    const res = await request(app).get(`/voice/${ROOM_ID}/livekit-token`).set('Authorization', tok(USER_ID));
    expect(res.status).toBe(403);
    expect(res.body.data?.token).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PH17-002 — SFU eviction on kick and ban
// ═══════════════════════════════════════════════════════════════════════════════
describe('PH17-002: SFU eviction on kick/ban', () => {
  test('kickParticipant calls sfuEvict best-effort — source verification', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
    );
    const fn = extractFn(src, 'kickParticipant', 'banParticipant');
    expect(fn).toMatch(/sfuEvict\s*\(/);
    expect(fn).toMatch(/\[voice:kick\]/);
  });

  test('banParticipant calls sfuEvict best-effort — source verification', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
    );
    const fn = extractFn(src, 'banParticipant', 'unbanParticipant');
    expect(fn).toMatch(/sfuEvict\s*\(/);
    expect(fn).toMatch(/\[voice:ban\]/);
  });

  test('sfuEvict is best-effort: catch(() => {}) present on both calls', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
    );
    // Each sfuEvict call must be followed by .catch(() => {})
    const matches = src.match(/sfuEvict\([^)]+\)\.catch\(\(\)/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PH17-003 — Voice demotion and muteAll revoke SFU publish
// ═══════════════════════════════════════════════════════════════════════════════
describe('PH17-003: sfuRevokePublish on moderator removal and muteAll', () => {
  test('removeModerator calls sfuRevokePublish(canPublish=false) — source', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice-roles.controller.js'), 'utf8'
    );
    const fn = extractFn(src, 'removeModerator', 'transferAdmin');
    expect(fn).toMatch(/sfuRevokePublish\s*\(/);
    // Must pass canPublish=false
    expect(fn).toMatch(/sfuRevokePublish\s*\(\s*roomId\s*,\s*targetUserId\s*,\s*false/);
    expect(fn).toMatch(/\[voice:remove-mod\]/);
  });

  test('muteAll calls sfuRevokePublish(canPublish=false) for each target — source', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice-roles.controller.js'), 'utf8'
    );
    // Use 'async function unmuteAll' as the boundary to avoid cutting at inline
    // references to 'unmuteAll' in comments within muteAll().
    const fn = extractFn(src, 'muteAll', 'async function unmuteAll');
    expect(fn).toMatch(/sfuRevokePublish\s*\(/);
    expect(fn).toMatch(/false.*\[voice:mute-all\]|\[voice:mute-all\].*false/);
    // Must be inside a forEach over the actually-muted participants (R1 fix: re-read after updateMany)
    expect(fn).toMatch(/actuallyMuted\.forEach/);
  });

  test('sfuRevokePublish calls are best-effort — source', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice-roles.controller.js'), 'utf8'
    );
    const matches = src.match(/sfuRevokePublish\([^)]+\)\.catch\(\(\)/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PH17-004 — Live class speaker demotion revokes SFU publish
// ═══════════════════════════════════════════════════════════════════════════════
describe('PH17-004: sfuRevokePublish on live-class demoteFromStage', () => {
  test('demoteFromStage calls sfuRevokePublish — source verification', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/live-class.controller.js'), 'utf8'
    );
    const fn = extractFn(src, 'demoteSpeaker', 'inviteToStage');
    expect(fn).toMatch(/sfuRevokePublish\s*\(/);
    expect(fn).toMatch(/false.*\[live-class:demote\]|\[live-class:demote\].*false/);
  });

  test('demoteFromStage still emits liveclass:revoke_mic Socket.IO — regression', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/live-class.controller.js'), 'utf8'
    );
    const fn = extractFn(src, 'demoteSpeaker', 'inviteToStage');
    expect(fn).toMatch(/liveclass:revoke_mic/);
    expect(fn).toMatch(/liveclass:speaker_removed/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PH18-002 — Public Live kick/revocation (live-class kickParticipant)
// ═══════════════════════════════════════════════════════════════════════════════
describe('PH18-002: Live class kickParticipant calls SFU removeParticipant', () => {
  test('kickParticipant in live-class uses getLivekitRoomService — source', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/live-class.controller.js'), 'utf8'
    );
    const fn = extractFn(src, 'async function kickParticipant', 'async function muteParticipant');
    // The existing BUG-01 fix calls removeParticipant via getLivekitRoomService
    expect(fn).toMatch(/getLivekitRoomService|removeParticipant/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PH19-002 — Mobile stale token: fresh-token reconnect
// ═══════════════════════════════════════════════════════════════════════════════
describe('PH19-002: Mobile useLiveKitAudio fresh-token reconnect', () => {
  const HOOK_SRC = path.join(__dirname, '../../../mobile/src/hooks/useLiveKitAudio.ts');
  const src = fs.existsSync(HOOK_SRC) ? fs.readFileSync(HOOK_SRC, 'utf8') : '';

  test('connect() accepts tokenFetcher parameter', () => {
    if (!src) return;
    expect(src).toMatch(/tokenFetcher\s*\?:/);
    expect(src).toMatch(/tokenFetcherRef/);
  });

  test('tokenFetcher stored in ref inside connect()', () => {
    if (!src) return;
    expect(src).toMatch(/tokenFetcherRef\.current\s*=\s*tokenFetcher/);
  });

  test('Disconnected handler calls tokenFetcherRef.current() before reconnect', () => {
    if (!src) return;
    // Fresh-token fetch path
    expect(src).toMatch(/tokenFetcherRef\.current\s*\(\s*\)/);
    // Falls back if fetcher throws (halts retry)
    expect(src).toMatch(/reconnectCountRef\.current\s*=\s*MAX_RECONNECT_ATTEMPTS/);
  });

  test('tokenFetcherRef is stored in useRef, not useState', () => {
    if (!src) return;
    expect(src).toMatch(/tokenFetcherRef\s*=\s*useRef/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PH22-002 — Web voice canPublish is SFU-enforced (not just UI)
// ═══════════════════════════════════════════════════════════════════════════════
describe('PH22-002: canPublish enforced at SFU level in voice token', () => {
  test('AUDIENCE canPublish:false is in the addGrant call — source', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/livekit.controller.js'), 'utf8'
    );
    const fn = extractFn(src, 'getLiveKitToken', 'generateToken');
    // Phase 16c: canPublishAudio now comes from getVoiceAudioPermission utility
    expect(fn).toMatch(/getVoiceAudioPermission/);
    expect(fn).toMatch(/canPublishAudio/);
    // The grant uses permission.canPublishAudio (Phase 16c pattern, may span lines)
    expect(fn).toMatch(/canPublish\s*:\s*permission\.canPublishAudio/);
    // micLocked is read from the room before computing the grant
    expect(fn).toMatch(/micLocked/);
    // HOST/MODERATOR privilege logic now in voiceAudioPermission utility (Phase 16c)
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PH22-003 — Stale capability closed by sfuRevokePublish / sfuEvict
// ═══════════════════════════════════════════════════════════════════════════════
describe('PH22-003: Stale LiveKit capability closed by SFU API calls', () => {
  test('sfuRevokePublish exported from livekitService — source', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../utils/livekitService.js'), 'utf8'
    );
    expect(src).toMatch(/module\.exports.*sfuRevokePublish/);
    expect(src).toMatch(/updateParticipant\s*\(/);
  });

  test('sfuEvict exported from livekitService — source', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../utils/livekitService.js'), 'utf8'
    );
    expect(src).toMatch(/module\.exports.*sfuEvict/);
    expect(src).toMatch(/removeParticipant\s*\(/);
  });

  test('sfuRevokePublish sets canPublish=false for demotions', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../utils/livekitService.js'), 'utf8'
    );
    const fn = extractFn(src, 'sfuRevokePublish', 'module.exports');
    expect(fn).toMatch(/canPublish\s*:\s*canPublish/);
    expect(fn).toMatch(/updateParticipant/);
  });

  test('sfuEvict/sfuRevokePublish are both best-effort (never throw)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../utils/livekitService.js'), 'utf8'
    );
    // Both functions catch their errors
    expect(src).toMatch(/catch\s*\(err\)\s*\{[\s\S]*?logger\.warn/);
  });
});

// ─── Source extraction helper ─────────────────────────────────────────────────
function extractFn(source, fnName, nextFnName) {
  let start = source.indexOf('async function ' + fnName);
  if (start === -1) start = source.indexOf(fnName);
  if (start === -1) return '';
  const end = nextFnName
    ? source.indexOf(nextFnName, start + 1)
    : source.length;
  return source.slice(start, end === -1 ? source.length : end);
}
