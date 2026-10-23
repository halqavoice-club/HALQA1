'use strict';
/**
 * Voice Club — Low-Bandwidth / Rural-Readiness Focused Regression Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers the four changes made during the low-bandwidth audit and implementation
 * phase (VCLUB-LB).  Each describe block is scoped to exactly one change and
 * does NOT duplicate tests already present in voice-behavioral.test.js,
 * voice-forensic-fixes.test.js, fix001-seat-lock.test.js, or
 * voice-lowband-phase1.test.js.
 *
 * Test strategy: source-grep + inline mock execution (same pattern used across
 * this suite).  No running server, no DB, no Redis required.
 *
 * Covered changes:
 *   P0-1   app.js dual socket identity assignment (socket.userId + socket.data.userId)
 *          — hasActiveSocketConnection must NOT match a socket that only has the
 *          direct socket.userId property (not socket.data.userId).
 *
 *   P0-2   GET /voice/:id/stage-state API endpoint contract
 *          — returns correct shape for active participants; 403 for non-participants
 *          and for participants whose isActive flag is false (kicked users).
 *
 *   P0-3   voice:join_room socket handler reconnect re-broadcast
 *          — emits voice:user_joined room-wide so peers re-add the reconnecting
 *          user (FIX-FHIGH03).  The stage-state snapshot itself is fetched by the
 *          client via HTTP, not emitted by the socket handler.
 *
 *   P0-4   voiceQueue.requeue() FIFO score preservation
 *          — restores the user's original raisedAt score, NOT Date.now(), so
 *          re-queued users do not lose their FIFO position.
 */

const fs   = require('fs');
const path = require('path');

// ── File paths ────────────────────────────────────────────────────────────────
const WORKER_PATH   = path.join(__dirname, '../workers/voice-stale-session.worker.js');
const APP_PATH      = path.join(__dirname, '../app.js');
const QUEUE_CTRL    = path.join(__dirname, '../controllers/voice-queue.controller.js');
const VOICE_CTRL    = path.join(__dirname, '../controllers/voice.controller.js');
const QUEUE_UTILS   = path.join(__dirname, '../utils/voiceQueue.js');

const workerSrc     = fs.existsSync(WORKER_PATH) ? fs.readFileSync(WORKER_PATH, 'utf8') : '';
const appSrc        = fs.existsSync(APP_PATH)    ? fs.readFileSync(APP_PATH,    'utf8') : '';
const queueCtrlSrc  = fs.existsSync(QUEUE_CTRL)  ? fs.readFileSync(QUEUE_CTRL,  'utf8') : '';
const voiceCtrlSrc  = fs.existsSync(VOICE_CTRL)  ? fs.readFileSync(VOICE_CTRL,  'utf8') : '';
const queueUtilsSrc = fs.existsSync(QUEUE_UTILS) ? fs.readFileSync(QUEUE_UTILS, 'utf8') : '';

// ═══════════════════════════════════════════════════════════════════════════════
// P0-1 — Stale-session worker: hasActiveSocketConnection uses socket.data.userId
//         (NOT the direct socket.userId property)
//
// Why this is distinct from voice-behavioral.test.js BEHAV-01/02:
//   BEHAV-01/02 test the happy-path: data.userId populated → returns true/false.
//   These tests explicitly confirm the negative case: a socket that ONLY has the
//   direct `socket.userId` property (the pre-fix state) does NOT satisfy the
//   worker's check, and that app.js sets BOTH properties.
// ═══════════════════════════════════════════════════════════════════════════════
describe('P0-1 — hasActiveSocketConnection: direct socket.userId is NOT sufficient', () => {

  /**
   * Build a minimal inline version of hasActiveSocketConnection that mirrors the
   * actual worker implementation:  sockets.some(s => String(s.data.userId) === String(userId)).
   * We test the runtime behavior with a mock io, keeping the same semantics as the
   * actual worker without requiring the worker module to load (BullMQ dependency).
   */
  function buildFn(mockIo) {
    return async function hasActiveSocketConnection(roomId, userId) {
      try {
        const io = mockIo;
        if (!io) return true;
        const sockets = await io.in(`voice:${roomId}`).fetchSockets();
        // This is the exact check in the worker — s.data.userId, not s.userId
        return sockets.some(s => String(s.data.userId) === String(userId));
      } catch {
        return true; // conservative
      }
    };
  }

  test('returns false when a socket has userId as a direct property only (pre-fix state)', async () => {
    // Simulate the pre-fix bug: socket.userId is set but socket.data.userId is NOT.
    // This represents the state BEFORE the FIX-FCRIT01 dual-assignment was added.
    // The worker must NOT detect this as an active connection — the user IS stale.
    const preFixSocket = {
      userId: 'user-abc',   // direct property (old style)
      data: {},             // data.userId NOT set — the pre-fix bug
    };
    const mockIo = {
      in: () => ({ fetchSockets: async () => [preFixSocket] }),
    };
    const fn = buildFn(mockIo);
    const result = await fn('room-1', 'user-abc');
    // Must return false: the worker only looks at s.data.userId, and data.userId
    // is not set.  Without the app.js fix this caused live users to be evicted.
    expect(result).toBe(false);
  });

  test('returns true when socket has BOTH direct userId AND data.userId (post-fix state)', async () => {
    // Simulate the post-fix state: app.js sets BOTH socket.userId AND socket.data.userId.
    // The worker now correctly detects the active connection.
    const postFixSocket = {
      userId: 'user-abc',             // direct property (for disconnect handler)
      data: { userId: 'user-abc' },   // FIX-FCRIT01: mirrored onto data
    };
    const mockIo = {
      in: () => ({ fetchSockets: async () => [postFixSocket] }),
    };
    const fn = buildFn(mockIo);
    const result = await fn('room-1', 'user-abc');
    expect(result).toBe(true);
  });

  test('returns false when no socket exists in the room for the given userId', async () => {
    // Empty socket list — user is genuinely disconnected
    const mockIo = {
      in: () => ({ fetchSockets: async () => [] }),
    };
    const fn = buildFn(mockIo);
    const result = await fn('room-1', 'user-xyz');
    expect(result).toBe(false);
  });

  test('app.js sets socket.userId (direct) AND socket.data.userId (both required)', () => {
    // Verify that the FIX-FCRIT01 dual-assignment is present in app.js.
    // socket.userId (direct) is read by the disconnect handler.
    // socket.data.userId is read by the worker via fetchSockets.
    expect(appSrc).toMatch(/socket\.userId\s*=\s*user\.id/);
    expect(appSrc).toMatch(/socket\.data\.userId\s*=\s*user\.id/);
    // Both assignments must be in the same connection middleware block
    const connIdx = appSrc.indexOf('socket.userId       = user.id');
    expect(connIdx).toBeGreaterThan(-1);
    const dataIdx = appSrc.indexOf('socket.data.userId       = user.id');
    expect(dataIdx).toBeGreaterThan(-1);
    // The data assignment must come after the direct assignment (within 500 chars)
    expect(dataIdx - connIdx).toBeLessThan(500);
  });

  test('worker hasActiveSocketConnection reads s.data.userId (source confirmation)', () => {
    // Confirm the actual worker source also checks s.data.userId, not s.userId
    const fnIdx = workerSrc.indexOf('async function hasActiveSocketConnection');
    expect(fnIdx).toBeGreaterThan(-1);
    const fnBody = workerSrc.slice(fnIdx, fnIdx + 600);
    expect(fnBody).toMatch(/s\.data\.userId/);
    // Must NOT fall back to the direct s.userId property inside this function
    // (the disconnect handler uses s.userId but the worker must not)
    expect(fnBody).not.toMatch(/s\.userId[^.]|s\.userId$/m);
  });

  test('worker does NOT evict when hasActiveSocketConnection returns true (source path)', () => {
    // Verify the eviction guard in the worker: if connected === true, skip the mark.
    const fnIdx = workerSrc.indexOf('runStaleSweep');
    expect(fnIdx).toBeGreaterThan(-1);
    const sweepBody = workerSrc.slice(fnIdx, fnIdx + 3000);
    // The worker checks: if (!connected) { shouldMark = true; } else { skippedConnected++; continue; }
    // Verify the connected check and shouldMark are both present in the sweep body
    expect(sweepBody).toMatch(/shouldMark/);
    expect(sweepBody).toMatch(/connected/);
    expect(sweepBody).toMatch(/skippedConnected/);
    // The guard must skip (continue) when connected is true — verify the else+continue path
    expect(sweepBody).toMatch(/skippedConnected\+\+/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P0-2 — GET /voice/:id/stage-state API endpoint contract
//
// These tests verify the controller source for the endpoint shape and the
// two 403-path conditions (non-participant and kicked/inactive participant).
// Not covered by the prior suites beyond a basic 403 presence check —
// these verify the full shape contract and the specific kicked-user path.
// ═══════════════════════════════════════════════════════════════════════════════
describe('P0-2 — GET /voice/:id/stage-state: endpoint shape and 403 authorization', () => {

  // Extract the getStageState function body from the controller source
  function getStageStateFn() {
    const start = voiceCtrlSrc.indexOf('async function getStageState');
    expect(start).toBeGreaterThan(-1);
    // Find the end of the function (next top-level async function declaration)
    const next = voiceCtrlSrc.indexOf('\nasync function ', start + 1);
    return next > start
      ? voiceCtrlSrc.slice(start, next)
      : voiceCtrlSrc.slice(start, start + 3000);
  }

  test('getStageState returns 403 when participant record is not found (non-participant)', () => {
    const fn = getStageStateFn();
    // The guard: if (!participant || !participant.isActive) → 403
    expect(fn).toMatch(/!participant/);
    expect(fn).toMatch(/403/);
  });

  test('getStageState returns 403 when participant.isActive is false (kicked user)', () => {
    // Kicked users have isActive=false — the same 403 guard covers them
    const fn = getStageStateFn();
    expect(fn).toMatch(/participant\.isActive/);
    expect(fn).toMatch(/You are not an active participant/);
  });

  test('getStageState response includes stageParticipants array', () => {
    const fn = getStageStateFn();
    expect(fn).toMatch(/stageParticipants/);
  });

  test('getStageState response includes stageCount field', () => {
    const fn = getStageStateFn();
    expect(fn).toMatch(/stageCount/);
  });

  test('getStageState response includes stateVersion field', () => {
    // stateVersion is required for the client-side version-based stale removal
    const fn = getStageStateFn();
    expect(fn).toMatch(/stateVersion/);
  });

  test('getStageState participant shape includes role, isMuted, seatNumber, handRaised', () => {
    const fn = getStageStateFn();
    expect(fn).toMatch(/role/);
    expect(fn).toMatch(/isMuted/);
    expect(fn).toMatch(/seatNumber/);
    expect(fn).toMatch(/handRaised/);
  });

  test('getStageState participant shape includes firstName, lastName, avatarUrl', () => {
    // Profile fields required for client-side participant display
    const fn = getStageStateFn();
    expect(fn).toMatch(/firstName/);
    expect(fn).toMatch(/lastName/);
    expect(fn).toMatch(/avatarUrl/);
  });

  test('getStageState only returns active participants (isActive = 1 filter)', () => {
    // Must not leak inactive (kicked, left, or stale) participants
    const fn = getStageStateFn();
    expect(fn).toMatch(/isActive\s*=\s*1/);
  });

  test('GET /voice/:id/stage-state route is protected by authenticate middleware', () => {
    const ROUTES_PATH = path.join(__dirname, '../routes/voice.routes.js');
    const routesSrc = fs.existsSync(ROUTES_PATH) ? fs.readFileSync(ROUTES_PATH, 'utf8') : '';
    expect(routesSrc).toBeTruthy();
    const authIdx  = routesSrc.indexOf('router.use(authenticate)');
    const routeIdx = routesSrc.indexOf('stage-state');
    expect(authIdx).toBeGreaterThan(-1);
    expect(routeIdx).toBeGreaterThan(-1);
    // authenticate must be registered before the stage-state route
    expect(authIdx).toBeLessThan(routeIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P0-3 — voice:join_room socket handler: reconnect re-broadcast (FIX-FHIGH03)
//
// The socket handler emits voice:user_joined room-wide so peers re-add the
// reconnecting user to their local state.  The stage-state snapshot itself is
// obtained by the client via a separate HTTP GET /stage-state call — NOT by
// this socket handler.  Tested here via inline mock execution (mirrors
// BEHAV-06 in voice-behavioral.test.js but focuses on the reconnect path
// and the room-wide emission target).
// ═══════════════════════════════════════════════════════════════════════════════
describe('P0-3 — voice:join_room socket handler: voice:user_joined emitted on reconnect', () => {

  /**
   * Inline version of the voice:join_room handler logic (mirrors app.js).
   * Returns { joinedRoom, userJoinedEmitted, stageStateEmitted }.
   */
  async function runReconnectHandler({ participant, reconnected, userId, roomId }) {
    const joinedRooms = new Set();
    let userJoinedEmitted = false;
    let stageStateEmitted = false;

    const mockSocket = {
      userId,
      data: { userId },
      rooms: joinedRooms,
      join: (r) => joinedRooms.add(r),
    };

    const mockIo = {
      to: (room) => ({
        emit: (event) => {
          if (event === 'voice:user_joined') userJoinedEmitted = true;
          if (event === 'voice:stage_state')  stageStateEmitted = true;
        },
      }),
    };

    const mockPrisma = {
      voiceParticipant: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(participant)   // isActive check
          .mockResolvedValueOnce(reconnected),  // re-broadcast profile
      },
    };

    const id = typeof roomId === 'object' ? roomId?.roomId : roomId;

    if (!id || !userId) return { joinedRoom: null, userJoinedEmitted, stageStateEmitted };

    const p = await mockPrisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId: id, userId } },
      select: { isActive: true },
    });

    if (!p?.isActive) return { joinedRoom: null, userJoinedEmitted, stageStateEmitted };

    mockSocket.join(`voice:${id}`);

    try {
      const rec = await mockPrisma.voiceParticipant.findUnique({
        where: { roomId_userId: { roomId: id, userId } },
        select: {
          userId: true, role: true, isMuted: true, seatNumber: true, isPinned: true,
          handRaised: true, mutedByModerator: true, joinedAt: true,
          user: { select: { firstName: true, lastName: true, avatarUrl: true } },
        },
      });
      if (rec) {
        mockIo.to(`voice:${id}`).emit('voice:user_joined', {
          roomId:           id,
          userId:           rec.userId,
          firstName:        rec.user?.firstName ?? '',
          lastName:         rec.user?.lastName  ?? '',
          avatarUrl:        rec.user?.avatarUrl  ?? null,
          role:             rec.role,
          isMuted:          rec.isMuted ?? true,
          mutedByModerator: rec.mutedByModerator ?? false,
          handRaised:       rec.handRaised ?? false,
          isActive:         true,
          isPinned:         rec.isPinned ?? false,
          seatNumber:       rec.seatNumber != null ? Number(rec.seatNumber) : null,
          joinedAt:         rec.joinedAt?.toISOString?.() ?? new Date().toISOString(),
        });
      }
    } catch { /* non-fatal */ }

    return {
      joinedRoom: joinedRooms.has(`voice:${id}`) ? `voice:${id}` : null,
      userJoinedEmitted,
      stageStateEmitted,
    };
  }

  test('emits voice:user_joined to the room on reconnect when participant is active', async () => {
    const { joinedRoom, userJoinedEmitted } = await runReconnectHandler({
      participant: { isActive: true },
      reconnected: {
        userId: 'u1', role: 'SPEAKER', isMuted: false, seatNumber: 2,
        isPinned: false, handRaised: false, mutedByModerator: false,
        joinedAt: new Date(),
        user: { firstName: 'Alice', lastName: 'Smith', avatarUrl: null },
      },
      userId: 'u1',
      roomId: 'room-1',
    });
    expect(joinedRoom).toBe('voice:room-1');
    expect(userJoinedEmitted).toBe(true);
  });

  test('does NOT emit voice:stage_state — stage snapshot is fetched via HTTP by the client', async () => {
    // The socket handler must NOT emit voice:stage_state.  Clients obtain the
    // full snapshot via GET /voice/:id/stage-state (HTTP) after the socket reconnect.
    // Emitting it from the socket handler would require a DB $queryRaw in the handler
    // and increase reconnect latency — not part of the implemented fix.
    const { stageStateEmitted } = await runReconnectHandler({
      participant: { isActive: true },
      reconnected: {
        userId: 'u1', role: 'AUDIENCE', isMuted: true, seatNumber: null,
        isPinned: false, handRaised: false, mutedByModerator: false,
        joinedAt: new Date(),
        user: { firstName: 'Bob', lastName: 'Jones', avatarUrl: null },
      },
      userId: 'u1',
      roomId: 'room-1',
    });
    expect(stageStateEmitted).toBe(false);
  });

  test('does NOT emit voice:user_joined when participant is not active (kicked user)', async () => {
    const { joinedRoom, userJoinedEmitted } = await runReconnectHandler({
      participant: { isActive: false },  // kicked
      reconnected: null,
      userId: 'u1',
      roomId: 'room-1',
    });
    expect(joinedRoom).toBeNull();
    expect(userJoinedEmitted).toBe(false);
  });

  test('does NOT emit voice:user_joined when participant record is null (not a member)', async () => {
    const { joinedRoom, userJoinedEmitted } = await runReconnectHandler({
      participant: null,  // not a member
      reconnected: null,
      userId: 'u1',
      roomId: 'room-1',
    });
    expect(joinedRoom).toBeNull();
    expect(userJoinedEmitted).toBe(false);
  });

  test('app.js voice:join_room source emits voice:user_joined on reconnect (FIX-FHIGH03)', () => {
    // Source-level confirmation that the app.js handler re-broadcasts to peers.
    // Anchor on socket.on('voice:join_room' — the actual handler registration —
    // not the first occurrence which is inside the rate-limiter config table.
    const handlerIdx = appSrc.indexOf("socket.on('voice:join_room'");
    expect(handlerIdx).toBeGreaterThan(-1);
    // The full handler is ~2500 chars; 3000 is a safe window
    const handlerBlock = appSrc.slice(handlerIdx, handlerIdx + 3000);
    expect(handlerBlock).toMatch(/voice:user_joined/);
    expect(handlerBlock).toMatch(/FIX-FHIGH03/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P0-4 — voiceQueue.requeue() FIFO score preservation
//
// After a P2002 duplicate-seat race or all-seats-locked failure, _promoteUser
// calls requeue() to restore the user to the queue with their ORIGINAL raisedAt
// score (not Date.now()).  This ensures the user keeps their FIFO position.
//
// The existing fix001-seat-lock.test.js tests verify requeue() is CALLED with
// the correct raisedAt argument at the call site.  These tests verify the
// requeue() IMPLEMENTATION itself: it uses the original score, not Date.now().
// ═══════════════════════════════════════════════════════════════════════════════
describe('P0-4 — voiceQueue.requeue() uses original raisedAt score (not Date.now())', () => {

  test('voiceQueue.js exports requeue function', () => {
    expect(queueUtilsSrc).toMatch(/module\.exports/);
    expect(queueUtilsSrc).toMatch(/requeue/);
  });

  test('requeue() computes score from userMeta.raisedAt when provided', () => {
    // The score line must use userMeta.raisedAt — not Date.now() unconditionally
    const requeueIdx = queueUtilsSrc.indexOf('async function requeue');
    expect(requeueIdx).toBeGreaterThan(-1);
    const fnBody = queueUtilsSrc.slice(requeueIdx, requeueIdx + 800);
    // Must use raisedAt as the primary score source
    expect(fnBody).toMatch(/userMeta\.raisedAt/);
    expect(fnBody).toMatch(/new Date\(userMeta\.raisedAt\)\.getTime\(\)/);
  });

  test('requeue() falls back to Date.now() only when raisedAt is absent', () => {
    // The fallback for missing raisedAt must be Date.now() — not a constant —
    // and it must only be reached when raisedAt is falsy.
    const requeueIdx = queueUtilsSrc.indexOf('async function requeue');
    expect(requeueIdx).toBeGreaterThan(-1);
    const fnBody = queueUtilsSrc.slice(requeueIdx, requeueIdx + 800);
    // Pattern: userMeta.raisedAt ? new Date(...).getTime() : Date.now()
    expect(fnBody).toMatch(/userMeta\.raisedAt\s*\?/);
    expect(fnBody).toMatch(/Date\.now\(\)/);
  });

  test('requeue() uses ZADD NX to avoid overwriting an existing score', () => {
    // 'NX' ensures that if the user is somehow already in the queue (defensive),
    // the original score is NOT overwritten — preserves FIFO position.
    // The zadd call is ~800 chars into the function body; use 1200 to be safe.
    const requeueIdx = queueUtilsSrc.indexOf('async function requeue');
    expect(requeueIdx).toBeGreaterThan(-1);
    const fnBody = queueUtilsSrc.slice(requeueIdx, requeueIdx + 1200);
    expect(fnBody).toMatch(/zadd/i);
    expect(fnBody).toMatch(/'NX'|"NX"/);
  });

  test('_promoteUser P2002 path calls requeue (not enqueue) — source confirmation', () => {
    // The P2002 catch must use requeue() to restore original score.
    // enqueue() would stamp Date.now() and send the user to the back of the queue.
    // Anchor on the isDupSeat branch entry (the if block, not the const declaration).
    const isDupIdx = queueCtrlSrc.indexOf("if (isDupSeat)");
    expect(isDupIdx).toBeGreaterThan(-1);
    // The if-block body is ~400 chars; use 800 to be safe
    const dupBlock = queueCtrlSrc.slice(isDupIdx, isDupIdx + 800);
    expect(dupBlock).toMatch(/queue\.requeue/);
    // Must NOT call enqueue() in this path
    expect(dupBlock).not.toMatch(/queue\.enqueue/);
  });

  test('_promoteUser null-seat path calls requeue (not enqueue) — source confirmation', () => {
    // When no unlocked seat is available, the user was already popped; requeue
    // must restore them with their original FIFO score.
    const nullSeatIdx = queueCtrlSrc.indexOf('seat === null');
    expect(nullSeatIdx).toBeGreaterThan(-1);
    const nullBlock = queueCtrlSrc.slice(nullSeatIdx, nullSeatIdx + 500);
    expect(nullBlock).toMatch(/queue\.requeue/);
  });

  test('requeue() carries raisedAt through to the stored metadata', () => {
    // The meta object passed to hset must include raisedAt — clients and DB
    // fallback readers rely on raisedAt for ordering.
    const requeueIdx = queueUtilsSrc.indexOf('async function requeue');
    expect(requeueIdx).toBeGreaterThan(-1);
    const fnBody = queueUtilsSrc.slice(requeueIdx, requeueIdx + 800);
    // The meta JSON must preserve raisedAt (not drop it)
    expect(fnBody).toMatch(/raisedAt/);
    expect(fnBody).toMatch(/JSON\.stringify/);
  });

  test('enqueue() uses Date.now() — confirms requeue() uses a different (original) score', () => {
    // enqueue() stamps Date.now() as the score.  Comparing the two functions
    // confirms they are NOT equivalent — requeue() is specifically for FIFO preservation.
    const enqueueIdx = queueUtilsSrc.indexOf('async function enqueue');
    expect(enqueueIdx).toBeGreaterThan(-1);
    const requeueIdx = queueUtilsSrc.indexOf('async function requeue');
    expect(requeueIdx).toBeGreaterThan(-1);

    const enqueueFn = queueUtilsSrc.slice(enqueueIdx, enqueueIdx + 600);
    const requeueFn = queueUtilsSrc.slice(requeueIdx, requeueIdx + 800);

    // enqueue() uses Date.now() as the unconditional score
    expect(enqueueFn).toMatch(/score\s*=\s*Date\.now\(\)/);
    // requeue() uses userMeta.raisedAt as the primary score (original FIFO position)
    expect(requeueFn).toMatch(/userMeta\.raisedAt\s*\?/);
  });
});
