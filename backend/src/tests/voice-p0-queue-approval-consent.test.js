'use strict';
/**
 * Phase 3A-3B2: real queue approval controllers, autoPromoteNext and voiceQueue.
 * Only database, Redis transport, Socket.IO, notification and SFU boundaries
 * are mocked. No copied promotion logic or external services are executed.
 */
jest.mock('../utils/prisma', () => ({
  voiceRoom: { findUnique: jest.fn() },
  voiceParticipant: {
    findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(),
    update: jest.fn(), updateMany: jest.fn(),
  },
  $queryRaw: jest.fn(), $executeRaw: jest.fn(), $transaction: jest.fn(),
}));
jest.mock('../utils/redis', () => ({
  getRedis: jest.fn(), isRedisReady: jest.fn(), deleteCache: jest.fn(),
}));
jest.mock('../utils/voiceRoomCache', () => ({ getNextStageVersion: jest.fn() }));
jest.mock('../sockets', () => ({ getIo: jest.fn() }));
jest.mock('../utils/livekitService', () => ({ sfuRevokePublish: jest.fn(), sfuEvict: jest.fn() }));
jest.mock('../services/notification.service', () => ({ notify: jest.fn() }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/response', () => ({
  successResponse: (res, data, message, status = 200) => {
    Object.assign(res, { statusCode: status, body: { success: true, data, message } });
    return res;
  },
  errorResponse: (res, message, status = 400) => {
    Object.assign(res, { statusCode: status, body: { success: false, message } });
    return res;
  },
}));

const prisma = require('../utils/prisma');
const redisBoundary = require('../utils/redis');
const { getIo } = require('../sockets');
const { getNextStageVersion } = require('../utils/voiceRoomCache');
const { sfuRevokePublish, sfuEvict } = require('../utils/livekitService');
const { notify } = require('../services/notification.service');
const queue = require('../utils/voiceQueue');
const { approveNext, approveUser } = require('../controllers/voice-queue.controller');
const { autoPromoteNext } = require('../utils/autoPromote');
const { getVoiceAudioPermission } = require('../utils/voiceAudioPermission');

const copy = (row) => row ? { ...row, ...(row.user ? { user: { ...row.user } } : {}) } : null;
const sqlText = (call) => call[0].join('?').replace(/\s+/g, ' ').trim();
const taggedSql = (strings) => strings.reduce((text, part, index) => text + (index ? `@${index - 1}` : '') + part, '');

function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some((part) => matches(row, part));
    if (key === 'AND') return value.every((part) => matches(row, part));
    if (value && typeof value === 'object' && Array.isArray(value.in)) return value.in.includes(row[key]);
    return row[key] === value;
  });
}

function setup(options = {}) {
  const row = (userId, role, seatNumber, timestamp) => ({
    id: `participant-${userId}`, roomId: 'room-1', userId, role, seatNumber,
    isActive: true, isMuted: true, mutedByModerator: false, wasKicked: false,
    handRaised: timestamp != null, handRaisedAt: timestamp != null ? new Date(timestamp) : null,
    user: { id: userId, firstName: userId.toUpperCase(), lastName: 'User', avatarUrl: null },
  });
  const state = {
    participants: [row('actor', 'HOST', 1, null), row('a', 'AUDIENCE', null, 1000),
      row('b', 'AUDIENCE', null, 2000), row('c', 'AUDIENCE', null, 3000)],
    room: { id: 'room-1', status: 'LIVE', deletedAt: null, maxSpeakers: 4,
      micLocked: false, allMuted: false, lockedSeats: [], ...options.room },
    scores: new Map(), metas: new Map(), trace: [],
    writeFailure: null, writeCount: undefined, transactionChangesApplied: false,
    persistentWriteFailure: false, writeAttemptCount: 0,
  };
  const participant = (userId) => state.participants.find((entry) => entry.userId === userId);
  for (const [userId, changes] of Object.entries(options.participants || {})) Object.assign(participant(userId), changes);
  for (const entry of options.others || []) state.participants.push(row(entry.userId, entry.role, entry.seatNumber, null));
  for (const userId of options.queueIds || ['a', 'b', 'c']) {
    const entry = participant(userId);
    const raisedAt = entry.handRaisedAt?.toISOString() || new Date(1000).toISOString();
    state.scores.set(userId, Date.parse(raisedAt));
    state.metas.set(userId, JSON.stringify({ userId, ...entry.user, raisedAt }));
  }
  const orderedIds = () => [...state.scores.keys()].sort((a, b) => state.scores.get(a) - state.scores.get(b));
  const redis = {
    zrange: jest.fn(async (_key, start, stop) => orderedIds().slice(start, stop < 0 ? undefined : stop + 1)),
    zscore: jest.fn(async (_key, userId) => state.scores.has(userId) ? String(state.scores.get(userId)) : null),
    zrank: jest.fn(async (_key, userId) => { const index = orderedIds().indexOf(userId); return index < 0 ? null : index; }),
    zcard: jest.fn(async () => state.scores.size),
    zrem: jest.fn(async (_key, userId) => {
      state.trace.push(`dequeue:${userId}`);
      return Number(state.scores.delete(userId));
    }),
    zadd: jest.fn(async (_key, mode, score, userId) => {
      if (mode !== 'NX' || !state.scores.has(userId)) state.scores.set(userId, Number(score));
      return 1;
    }),
    zpopmin: jest.fn(async () => {
      const userId = orderedIds()[0];
      if (!userId) return [];
      const score = state.scores.get(userId);
      state.scores.delete(userId);
      state.trace.push(`pop:${userId}`);
      return [userId, String(score)];
    }),
    hget: jest.fn(async (_key, userId) => state.metas.get(userId) || null),
    hmget: jest.fn(async (_key, ...userIds) => userIds.map((userId) => state.metas.get(userId) || null)),
    hset: jest.fn(async (_key, userId, meta) => { state.metas.set(userId, meta); return 1; }),
    hdel: jest.fn(async (_key, userId) => Number(state.metas.delete(userId))),
    expire: jest.fn(async () => 1), del: jest.fn(async () => 1),
  };
  redis.pipeline = jest.fn(() => {
    const pending = [];
    const pipeline = { exec: jest.fn(async () => Promise.all(pending.map(([name, args]) => redis[name](...args)))) };
    for (const name of ['zadd', 'hset', 'expire']) pipeline[name] = (...args) => { pending.push([name, args]); return pipeline; };
    return pipeline;
  });
  redisBoundary.getRedis.mockReturnValue(redis);
  redisBoundary.isRedisReady.mockReturnValue(options.redisReady !== false);
  redisBoundary.deleteCache.mockResolvedValue(undefined);
  getNextStageVersion.mockResolvedValue(11);
  notify.mockResolvedValue(undefined);
  sfuRevokePublish.mockResolvedValue({ enforced: true, reason: 'UPDATED' });
  const io = { emit: jest.fn(), to: jest.fn() };
  io.to.mockReturnValue({ emit: io.emit });
  getIo.mockReturnValue(options.noIo ? null : io);
  prisma.voiceRoom.findUnique.mockImplementation(async () => ({ ...state.room }));
  prisma.voiceParticipant.findUnique.mockImplementation(async ({ where }) => copy(
    where.roomId_userId ? participant(where.roomId_userId.userId) : state.participants.find((entry) => entry.id === where.id)
  ));
  prisma.voiceParticipant.findFirst.mockImplementation(async ({ where }) => copy(
    state.participants.filter((entry) => matches(entry, where)).sort((a, b) => a.handRaisedAt - b.handRaisedAt)[0]
  ));
  prisma.voiceParticipant.findMany.mockImplementation(async ({ where = {} } = {}) =>
    state.participants.filter((entry) => matches(entry, where)).sort((a, b) => a.handRaisedAt - b.handRaisedAt).map(copy)
  );
  prisma.voiceParticipant.update.mockImplementation(async ({ where, data }) => {
    const entry = where.roomId_userId ? participant(where.roomId_userId.userId) : state.participants.find((item) => item.id === where.id);
    Object.assign(entry, data);
    return copy(entry);
  });
  prisma.voiceParticipant.updateMany.mockImplementation(async ({ where, data }) => {
    const entries = state.participants.filter((entry) => matches(entry, where));
    entries.forEach((entry) => Object.assign(entry, data));
    return { count: entries.length };
  });
  prisma.$queryRaw.mockImplementation(async (strings, ...values) => {
    const text = strings.join('?');
    if (/COUNT\(\*\)/.test(text)) return [{ cnt: state.participants.filter((entry) => entry.isActive && entry.seatNumber != null).length }];
    if (/SELECT seatNumber FROM/.test(text) && /userId =/.test(text)) {
      const entry = participant(values[1]);
      return entry ? [{ seatNumber: entry.seatNumber }] : [];
    }
    if (/SELECT seatNumber FROM/.test(text)) return state.participants.filter((entry) => entry.isActive && entry.seatNumber != null).map((entry) => ({ seatNumber: entry.seatNumber }));
    if (/FROM voice_participants/.test(text)) return state.participants.filter((entry) => entry.isActive).map((entry) => ({ ...copy(entry), ...entry.user }));
    throw new Error(`Unexpected raw query: ${text}`);
  });
  // Interpret only scalar SQL assignments/predicates passed by production code.
  // This adapter does not decide authorization, eligibility, seating or consent.
  prisma.$executeRaw.mockImplementation(async (strings, ...values) => {
    state.trace.push('write');
    if (state.writeFailure) {
      state.writeAttemptCount++;
      if (state.persistentWriteFailure) {
        throw state.writeFailure;
      } else {
        const failure = state.writeFailure;
        state.writeFailure = null;
        throw failure;
      }
    }
    if (state.writeCount !== undefined) { const count = state.writeCount; state.writeCount = undefined; return count; }
    const text = taggedSql(strings);
    const [setPart, wherePart] = text.split(/\bWHERE\b/i);
    const readValue = (token) => token.startsWith('@') ? values[Number(token.slice(1))]
      : token === 'NULL' ? null : token.startsWith("'") ? token.slice(1, -1) : Number(token);
    const terms = (part) => [...part.matchAll(/\b(\w+)\s*(?:=|IS)\s*(@\d+|'[^']*'|NULL|\d+)/gi)]
      .map((match) => [match[1], readValue(match[2])]);
    const entries = state.participants.filter((entry) => terms(wherePart).every(([key, expected]) =>
      typeof entry[key] === 'boolean' && typeof expected === 'number' ? Number(entry[key]) === expected : entry[key] === expected
    ));
    for (const entry of entries) {
      for (const [key, value] of terms(setPart)) entry[key] = ['isMuted', 'handRaised', 'wasKicked', 'mutedByModerator'].includes(key) ? Boolean(value) : value;
    }
    return entries.length;
  });
  prisma.$transaction.mockImplementation(async (callback) => {
    if (options.atTransaction && !state.transactionChangesApplied) {
      state.transactionChangesApplied = true;
      options.atTransaction({ state, participant });
    }
    const before = state.participants.map(copy);
    try {
      const result = await callback(prisma);
      state.trace.push('commit');
      return result;
    } catch (error) {
      state.participants = before;
      state.trace.push('rollback');
      throw error;
    }
  });
  const queueState = async () => (await queue.getQueue('room-1')).map((entry) => ({ userId: entry.userId, raisedAt: entry.raisedAt }));
  return {
    state, participant, redis, io, queueState,
    call: async (kind = 'next', userId = 'a') => {
      const req = { params: { id: 'room-1', userId }, user: { id: 'actor' } };
      const res = {}, next = jest.fn();
      await (kind === 'next' ? approveNext : approveUser)(req, res, next);
      return { res, next };
    },
    auto: () => autoPromoteNext('room-1', options.noIo ? null : io),
  };
}

function expectNoMediaMutation() {
  expect(sfuRevokePublish).not.toHaveBeenCalled();
  expect(sfuEvict).not.toHaveBeenCalled();
}

function expectConsentState(h, userId = 'a', role = 'SPEAKER') {
  const persisted = h.participant(userId);
  expect(persisted).toEqual(expect.objectContaining({ role, isMuted: true, handRaised: false }));
  expect(persisted.seatNumber).not.toBeNull();
  const consent = {
    roomId: 'room-1', userId, seatNumber: persisted.seatNumber, isMuted: true,
    mutedByModerator: persisted.mutedByModerator,
  };
  if (role === 'MODERATOR') expect(h.io.emit).toHaveBeenCalledWith('voice:mute_changed', expect.objectContaining(consent));
  else expect(h.io.emit).toHaveBeenCalledWith('voice:role_changed', expect.objectContaining({ ...consent, role }));
  expect(h.io.emit).toHaveBeenCalledWith('voice:promoted_to_speaker', expect.objectContaining({
    seatNumber: persisted.seatNumber, isMuted: true, role,
    mutedByModerator: persisted.mutedByModerator,
  }));
  const snapshot = h.io.emit.mock.calls.filter(([event]) => event === 'voice:stage_state').at(-1)?.[1];
  expect(snapshot).toEqual(expect.objectContaining({ roomId: 'room-1', stateVersion: 11 }));
  expect(snapshot.stageParticipants.find((entry) => entry.userId === userId)).toEqual(expect.objectContaining({
    role, seatNumber: persisted.seatNumber, isMuted: true, handRaised: false,
    mutedByModerator: persisted.mutedByModerator,
  }));
  expectNoMediaMutation();
}

describe('Phase 3A-3B2: production queue approval consent with real FIFO helper', () => {
  beforeEach(() => jest.resetAllMocks());

  test.each(['next', 'user'])('%s approval seats muted and removes only the approved queue entry after commit', async (kind) => {
    const h = setup();
    const before = await h.queueState();
    const { res, next } = await h.call(kind);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({ userId: 'a', role: 'SPEAKER', seatNumber: 2, isMuted: true }));
    expectConsentState(h);
    expect(await h.queueState()).toEqual(before.slice(1));
    expect(h.state.trace.indexOf('dequeue:a')).toBeGreaterThan(h.state.trace.indexOf('commit'));
    expect(h.redis.zpopmin).not.toHaveBeenCalled();
  });

  test('arbitrary approveUser chooses middle entry while preserving every other FIFO score', async () => {
    const h = setup();
    const before = await h.queueState();
    const { res, next } = await h.call('user', 'b');
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expectConsentState(h, 'b');
    expect(await h.queueState()).toEqual([before[0], before[2]]);
    expect(h.participant('a').seatNumber).toBeNull();
    expect(h.participant('c').seatNumber).toBeNull();
  });

  test.each(['next', 'user'])('%s approval preserves queued MODERATOR role and individual lock', async (kind) => {
    const h = setup({ participants: { a: { role: 'MODERATOR', mutedByModerator: true } } });
    const { res, next } = await h.call(kind);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.data.mutedByModerator).toBe(true);
    expectConsentState(h, 'a', 'MODERATOR');
    expect(h.participant('a').mutedByModerator).toBe(true);
    expect(getVoiceAudioPermission({ participant: { ...h.participant('a'), isMuted: false }, room: h.state.room }))
      .toEqual({ canPublishAudio: false, reason: 'MUTED_BY_MODERATOR' });
  });

  test('transaction current MODERATOR role determines seat and response instead of stale audience role', async () => {
    const h = setup({
      participants: { actor: { seatNumber: null } },
      atTransaction: ({ participant }) => Object.assign(participant('a'), { role: 'MODERATOR' }),
    });
    const { res, next } = await h.call();
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({ role: 'MODERATOR', seatNumber: 1, isMuted: true }));
    expectConsentState(h, 'a', 'MODERATOR');
  });

  test.each(['next', 'user'])('%s approval honors allMuted without automatic publish permission', async (kind) => {
    const h = setup({ room: { allMuted: true } });
    const { res, next } = await h.call(kind);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expectConsentState(h);
    expect(getVoiceAudioPermission({ participant: { ...h.participant('a'), isMuted: false }, room: h.state.room }))
      .toEqual({ canPublishAudio: false, reason: 'ALL_MUTED' });
  });

  test.each(['next', 'user'])('%s approval skips locked seats and never assigns ordinary SPEAKER Seat 1', async (kind) => {
    const h = setup({ room: { lockedSeats: [1] }, participants: { actor: { seatNumber: null } } });
    const { res, next } = await h.call(kind);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(h.participant('a').seatNumber).toBe(3);
    expect(h.participant('actor').seatNumber).toBeNull();
    expectNoMediaMutation();
  });

  test.each(['next', 'user'])('%s micLocked rejects without consuming or changing the queue', async (kind) => {
    const h = setup({ room: { micLocked: true } });
    const before = await h.queueState();
    const { res, next } = await h.call(kind);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(await h.queueState()).toEqual(before);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expectNoMediaMutation();
  });

  test.each(['next', 'user'])('%s no unlocked seat preserves queue and succeeds on later retry', async (kind) => {
    const h = setup({ room: { lockedSeats: [1, 2, 3] } });
    const before = await h.queueState();
    const first = await h.call(kind);
    expect(first.next).not.toHaveBeenCalled();
    expect([400, 409]).toContain(first.res.statusCode);
    expect(await h.queueState()).toEqual(before);
    expect(h.participant('a').handRaised).toBe(true);
    h.state.room.lockedSeats = [];
    const retry = await h.call(kind);
    expect(retry.next).not.toHaveBeenCalled();
    expect(retry.res.statusCode).toBe(200);
    expect(await h.queueState()).toEqual(before.slice(1));
    expectConsentState(h);
  });

  test.each(['next', 'user'])('%s duplicate-seat conflict retains FIFO and succeeds on retry', async (kind) => {
    const h = setup();
    const before = await h.queueState();
    h.state.writeFailure = Object.assign(new Error('Duplicate entry for voice_participants_roomId_seatNumber_key'), { code: 'P2002' });
    const first = await h.call(kind);
    expect(first.next).not.toHaveBeenCalled();
    expect(first.res.statusCode).toBe(409);
    expect(await h.queueState()).toEqual(before);
    expect(h.participant('a')).toEqual(expect.objectContaining({ seatNumber: null, handRaised: true, isMuted: true }));
    const retry = await h.call(kind);
    expect(retry.next).not.toHaveBeenCalled();
    expect(retry.res.statusCode).toBe(200);
    expect(await h.queueState()).toEqual(before.slice(1));
  });

  test.each(['next', 'user'])('%s guarded update count zero rolls back and retains queued hand', async (kind) => {
    const h = setup();
    const before = await h.queueState();
    h.state.writeCount = 0;
    const { res, next } = await h.call(kind);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
    expect(await h.queueState()).toEqual(before);
    expect(h.participant('a')).toEqual(expect.objectContaining({ role: 'AUDIENCE', seatNumber: null, handRaised: true }));
    expectNoMediaMutation();
  });

  test.each([
    ['ER_DUP_ENTRY', { code: 'ER_DUP_ENTRY' }],
    ['Prisma raw MySQL 1062', { code: 'P2010', meta: { code: '1062' } }],
  ])('manual %s collision preserves original FIFO request', async (_label, details) => {
    const h = setup();
    const before = await h.queueState();
    h.state.writeFailure = Object.assign(new Error('unit seat collision'), details);
    const { res, next } = await h.call('user', 'b');
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
    expect(await h.queueState()).toEqual(before);
    expect(h.participant('b')).toEqual(expect.objectContaining({ handRaised: true, seatNumber: null }));
    expectNoMediaMutation();
  });

  test.each(['next', 'user'])('%s unexpected database failure reaches next and retains FIFO/hand for retry', async (kind) => {
    const h = setup();
    const before = await h.queueState();
    const failure = new Error('unit database failure');
    h.state.writeFailure = failure;
    const { next } = await h.call(kind);
    expect(next).toHaveBeenCalledWith(failure);
    expect(await h.queueState()).toEqual(before);
    expect(h.participant('a').handRaised).toBe(true);
    expectNoMediaMutation();
  });

  test.each([
    ['inactive', { isActive: false }], ['kicked', { wasKicked: true }],
    ['HOST role', { role: 'HOST' }], ['withdrawn hand', { handRaised: false }],
  ])('mutation revalidation rejects %s recipient and retains queue entry', async (_label, changes) => {
    const h = setup({ atTransaction: ({ participant }) => Object.assign(participant('a'), changes) });
    const before = await h.queueState();
    const { res, next } = await h.call();
    expect(next).not.toHaveBeenCalled();
    expect([400, 403, 409]).toContain(res.statusCode);
    expect(h.participant('a').seatNumber).toBeNull();
    expect(await h.queueState()).toEqual(before);
    expectNoMediaMutation();
  });

  test.each([
    ['inactive approver', { isActive: false }], ['audience approver', { role: 'AUDIENCE' }],
  ])('transaction revalidates %s without granting a stage seat', async (_label, changes) => {
    const h = setup({ atTransaction: ({ participant }) => Object.assign(participant('actor'), changes) });
    const before = await h.queueState();
    const { res, next } = await h.call();
    expect(next).not.toHaveBeenCalled();
    expect([403, 409]).toContain(res.statusCode);
    expect(await h.queueState()).toEqual(before);
    expect(h.participant('a').seatNumber).toBeNull();
  });

  test.each([
    ['mic lock', { micLocked: true }], ['ended room', { status: 'ENDED' }],
    ['deleted room', { deletedAt: new Date(4000) }], ['newly locked seats', { lockedSeats: [1, 2, 3] }],
    ['reduced capacity', { maxSpeakers: 1 }],
  ])('transaction revalidates %s and retains FIFO request', async (_label, changes) => {
    const h = setup({ atTransaction: ({ state }) => Object.assign(state.room, changes) });
    const before = await h.queueState();
    const { res, next } = await h.call();
    expect(next).not.toHaveBeenCalled();
    expect([400, 403, 409]).toContain(res.statusCode);
    expect(await h.queueState()).toEqual(before);
    expect(h.participant('a').seatNumber).toBeNull();
  });

  test('already seated MODERATOR returns actual role, seat and mute state without consent changes', async () => {
    const h = setup({ participants: { a: { role: 'MODERATOR', seatNumber: 3, isMuted: true } } });
    const { res, next } = await h.call('user');
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({ alreadyOnStage: true, role: 'MODERATOR', seatNumber: 3, isMuted: true }));
    expect(h.participant('a').role).toBe('MODERATOR');
    expect(h.participant('a').isMuted).toBe(true);
    expect((await h.queueState()).map((entry) => entry.userId)).toEqual(['b', 'c']);
    expectNoMediaMutation();
  });

  test('full stage preserves HOST Seat 1 and every queued request without eviction', async () => {
    const h = setup({ room: { maxSpeakers: 2 }, others: [{ userId: 'occupied', role: 'SPEAKER', seatNumber: 2 }] });
    const before = await h.queueState();
    const { res, next } = await h.call();
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(h.participant('actor').seatNumber).toBe(1);
    expect(h.participant('occupied').seatNumber).toBe(2);
    expect(await h.queueState()).toEqual(before);
    expectNoMediaMutation();
  });

  test('Redis unavailable uses the actual voiceQueue DB fallback and seats muted', async () => {
    const h = setup({ redisReady: false });
    const { res, next } = await h.call();
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expectConsentState(h);
    expect((await h.queueState()).map((entry) => entry.userId)).toEqual(['b', 'c']);
  });

  test('queued unseated ghost SPEAKER keeps existing eligibility while starting muted', async () => {
    const h = setup({ participants: { a: { role: 'SPEAKER', seatNumber: null } } });
    const { res, next } = await h.call();
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expectConsentState(h);
  });

  test('approval without Socket.IO still persists muted and never grants publishing', async () => {
    const h = setup({ noIo: true });
    const { res, next } = await h.call();
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(h.participant('a').isMuted).toBe(true);
    expect((await h.queueState()).map((entry) => entry.userId)).toEqual(['b', 'c']);
    expectNoMediaMutation();
  });

  test('successful SQL predicates revalidate activity, role, seat, queue intent and kicked status', async () => {
    const h = setup();
    const { res } = await h.call();
    expect(res.statusCode).toBe(200);
    const write = prisma.$executeRaw.mock.calls.find((call) => /UPDATE voice_participants/.test(sqlText(call)));
    const text = sqlText(write);
    expect(text).toMatch(/isMuted = 1/);
    expect(text).toMatch(/isActive = 1/);
    expect(text).toMatch(/role = \?/);
    expect(text).toMatch(/seatNumber IS NULL/);
    expect(text).toMatch(/handRaised = 1/);
    expect(text).toMatch(/wasKicked = 0/);
  });
});

describe('Phase 3A-3B2: real alternate autoPromoteNext queue path', () => {
  beforeEach(() => jest.resetAllMocks());

  test('auto promotion commits a muted seat before dequeue and preserves all other entries', async () => {
    const h = setup();
    const before = await h.queueState();
    expect(await h.auto()).toBe('a');
    expectConsentState(h);
    expect(await h.queueState()).toEqual(before.slice(1));
    expect(h.state.trace.indexOf('dequeue:a')).toBeGreaterThan(h.state.trace.indexOf('commit'));
    expect(h.redis.zpopmin).not.toHaveBeenCalled();
  });

  test('auto promotion preserves MODERATOR role, moderator mute lock and muted consent', async () => {
    const h = setup({ participants: { a: { role: 'MODERATOR', mutedByModerator: true } } });
    expect(await h.auto()).toBe('a');
    expectConsentState(h, 'a', 'MODERATOR');
    expect(h.participant('a').mutedByModerator).toBe(true);
  });

  test.each([
    ['all seats locked', { lockedSeats: [1, 2, 3] }], ['micLocked', { micLocked: true }],
    ['capacity full', { maxSpeakers: 1 }],
  ])('auto %s preserves FIFO score and hand for a later retry', async (_label, room) => {
    const h = setup({ room });
    const before = await h.queueState();
    expect(await h.auto()).toBeNull();
    expect(await h.queueState()).toEqual(before);
    expect(h.participant('a').handRaised).toBe(true);
    expectNoMediaMutation();
  });

  test('auto duplicate-seat collision retains first request rather than advancing or clearing its hand', async () => {
    const h = setup();
    const before = await h.queueState();
    h.state.writeFailure = Object.assign(new Error('Duplicate entry'), { code: 'P2002' });
    h.state.persistentWriteFailure = true;
    h.state.writeAttemptCount = 0;
    expect(await h.auto()).toBeNull();
    expect(h.state.writeAttemptCount).toBe(3); // All 3 attempts failed
    expect(await h.queueState()).toEqual(before);
    expect(h.participant('a')).toEqual(expect.objectContaining({ handRaised: true, seatNumber: null, isMuted: true }));
    expect(h.participant('b').seatNumber).toBeNull();
    h.state.persistentWriteFailure = false;
    h.state.writeAttemptCount = 0;
    expect(await h.auto()).toBe('a');
    expect(await h.queueState()).toEqual(before.slice(1));
    expectConsentState(h);
  });

  test.each([
    ['ER_DUP_ENTRY', { code: 'ER_DUP_ENTRY' }],
    ['Prisma raw MySQL 1062', { code: 'P2010', meta: { code: '1062' } }],
  ])('auto %s collision retains FIFO and does not advance the queue', async (_label, details) => {
    const h = setup();
    const before = await h.queueState();
    h.state.writeFailure = Object.assign(new Error('unit seat collision'), details);
    h.state.persistentWriteFailure = true;
    h.state.writeAttemptCount = 0;
    expect(await h.auto()).toBeNull();
    expect(h.state.writeAttemptCount).toBe(3); // All 3 attempts failed
    expect(await h.queueState()).toEqual(before);
    expect(h.participant('a').handRaised).toBe(true);
    expect(h.participant('b').seatNumber).toBeNull();
    expectNoMediaMutation();
  });

  test('auto guarded update count zero retains the waiting request', async () => {
    const h = setup();
    const before = await h.queueState();
    h.state.writeCount = 0;
    expect(await h.auto()).toBeNull();
    expect(await h.queueState()).toEqual(before);
    expect(h.participant('a')).toEqual(expect.objectContaining({ handRaised: true, seatNumber: null }));
    expectNoMediaMutation();
  });

  test('auto Redis-unavailable fallback excludes kicked first participant without recursion', async () => {
    const h = setup({ redisReady: false, participants: { a: { wasKicked: true } } });
    const findFirst = prisma.voiceParticipant.findFirst.getMockImplementation();
    let reads = 0;
    prisma.voiceParticipant.findFirst.mockImplementation(async (args) => {
      // Bound a regression failure so an infinite fallback loop cannot hang the test.
      if (++reads > 3) throw new Error('Repeated stale DB queue head');
      return findFirst(args);
    });
    expect(await h.auto()).toBe('b');
    expect(reads).toBe(1);
    expect(prisma.voiceParticipant.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ wasKicked: false }),
    }));
    expect(h.participant('a').seatNumber).toBeNull();
    expectConsentState(h, 'b');
  });

  test('auto stale kicked Redis head is removed without publishing and next valid user is seated muted', async () => {
    const h = setup({ participants: { a: { wasKicked: true } } });
    expect(await h.auto()).toBe('b');
    expect(h.participant('a').seatNumber).toBeNull();
    expectConsentState(h, 'b');
    expect((await h.queueState()).map((entry) => entry.userId)).toEqual(['c']);
  });

  test('auto queued unseated ghost SPEAKER remains eligible and muted', async () => {
    const h = setup({ participants: { a: { role: 'SPEAKER' } } });
    expect(await h.auto()).toBe('a');
    expectConsentState(h);
  });

  test('auto unexpected write failure retains queue and surfaces the error', async () => {
    const h = setup();
    const before = await h.queueState();
    const failure = new Error('unit database failure');
    h.state.writeFailure = failure;
    await expect(h.auto()).rejects.toBe(failure);
    expect(await h.queueState()).toEqual(before);
    expect(h.participant('a').handRaised).toBe(true);
    expectNoMediaMutation();
  });

  test('auto transaction observes a newly locked room and retains queue', async () => {
    const h = setup({ atTransaction: ({ state }) => { state.room.micLocked = true; } });
    const before = await h.queueState();
    expect(await h.auto()).toBeNull();
    expect(await h.queueState()).toEqual(before);
    expect(h.participant('a').seatNumber).toBeNull();
    expectNoMediaMutation();
  });

  test('auto allMuted seats with consent still muted and no grant', async () => {
    const h = setup({ room: { allMuted: true } });
    expect(await h.auto()).toBe('a');
    expectConsentState(h);
  });
});
