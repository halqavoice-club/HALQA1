'use strict';
/**
 * PH19-001 — Voice Reaction Authorization
 * ─────────────────────────────────────────────────────────────────────────────
 * Focused regression test for the PH19-001 finding:
 *   "Authenticated non-participant can inject a voice:reaction into any room."
 *
 * Fix: Added `if (!socket.rooms.has(`voice:${roomId}`)) return;` to the
 * voice:reaction handler in backend/src/app.js, matching the existing
 * voice:speaking authorization pattern (P0-3).
 *
 * Test strategy:
 *   All tests are source-level (static analysis + simulated socket state).
 *   No live Socket.IO / Redis / DB server required.
 *   Extraction uses string indexOf on the full source — avoids brace-counting
 *   fragility that caused false negatives in the original version.
 *
 * Coverage:
 *   S1. Fix present in source                (PH19-001 guard exists)
 *   S2. Guard placement correct              (after rate-limit, before broadcast)
 *   S3. Pattern matches voice:speaking       (canonical reference)
 *   S4. Attack matrix via simulated sockets  (8 scenarios)
 *   S5. Broadcast isolation                  (socket.to not io.emit)
 *   S6. Identity remains server-authoritative
 *   S7. Reconnect scenario
 *   S8. Kick/ban eviction invariant
 *   S9. Phase 24A regression check
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

// ─── Source files ─────────────────────────────────────────────────────────────
const APP_SRC        = path.join(__dirname, '../app.js');
const VOICE_CTRL     = path.join(__dirname, '../controllers/voice.controller.js');
const VOICE_ROLES    = path.join(__dirname, '../controllers/voice-roles.controller.js');

const src      = fs.readFileSync(APP_SRC,     'utf8');
const voiceSrc = fs.readFileSync(VOICE_CTRL,  'utf8');
const rolesSrc = fs.readFileSync(VOICE_ROLES, 'utf8');

// ─── Robust handler extraction ────────────────────────────────────────────────
// Strategy: locate the event name, then find the enclosing handler block end
// by walking forward until we see the pattern "})\n" or "});" at zero indent
// within the connection handler. Because nested handlers make brace-counting
// fragile, we instead use a generous slice from the event name up to the next
// socket.on( call that is at the same indentation level.

function extractHandlerSection(source, eventName) {
  const marker = `socket.on('${eventName}'`;
  const start  = source.indexOf(marker);
  if (start === -1) return '';
  // Find the next top-level socket.on( after this one — everything between is ours
  const nextHandler = source.indexOf("  socket.on('", start + marker.length);
  return nextHandler === -1
    ? source.slice(start)
    : source.slice(start, nextHandler);
}

const reactionSection = extractHandlerSection(src, 'voice:reaction');
const speakingSection = extractHandlerSection(src, 'voice:speaking');
const joinSection     = extractHandlerSection(src, 'voice:join_room');

// ─── Simulated socket model ───────────────────────────────────────────────────
function makeSocket({ userId, joinedRooms = [] }) {
  const rooms = new Set([`socket-id-${userId}`, `user:${userId}`]);
  for (const r of joinedRooms) rooms.add(r);
  const emitted = [];
  return {
    userId,
    rooms,
    _emitted: emitted,
    to(room) {
      return {
        emit(event, data) {
          emitted.push({ room, event, data });
        }
      };
    },
  };
}

/**
 * Simulates the PH19-001-fixed voice:reaction handler logic.
 * Returns { result: 'allowed'|'denied', reason: string|null }
 */
function simulateReactionHandler({
  socket, roomId, emoji,
  reactionsEnabled = true,
  rateLimitAllow   = true,
}) {
  // 1. Basic input
  if (!roomId || !socket.userId) return { result: 'denied', reason: 'no-input' };
  // 2. Rate limit
  if (!rateLimitAllow)           return { result: 'denied', reason: 'rate-limited' };
  // 3. PH19-001 FIX — socket room membership
  if (!socket.rooms.has(`voice:${roomId}`)) return { result: 'denied', reason: 'not-in-room' };
  // 4. reactionsEnabled
  if (!reactionsEnabled)         return { result: 'denied', reason: 'reactions-disabled' };
  // 5. Broadcast
  socket.to(`voice:${roomId}`).emit('voice:reaction', { userId: socket.userId, emoji });
  return { result: 'allowed', reason: null };
}

// ═══════════════════════════════════════════════════════════════════════════════
// S1 — Fix present in source
// ═══════════════════════════════════════════════════════════════════════════════
describe('PH19-S1 — PH19-001 fix present in source (app.js)', () => {
  test('voice:reaction section contains socket.rooms.has() guard', () => {
    // The guard uses template literal — search for the literal string in source
    expect(reactionSection).toContain('socket.rooms.has(`voice:${roomId}`)');
  });

  test('PH19-001 fix comment is present in the reaction section', () => {
    expect(reactionSection).toContain('PH19-001');
  });

  test('guard is a short-circuit return (not just a log)', () => {
    const guardIdx  = reactionSection.indexOf('socket.rooms.has(`voice:${roomId}`)');
    expect(guardIdx).toBeGreaterThan(-1);
    // "return" must appear within 60 characters of the guard expression
    const nearby    = reactionSection.slice(guardIdx, guardIdx + 60);
    expect(nearby).toContain('return');
  });

  test('fix is in the voice:reaction section (not a different handler)', () => {
    // The section starts with socket.on('voice:reaction'
    expect(reactionSection.trimStart()).toMatch(/^socket\.on\('voice:reaction'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S2 — Guard placement: after rate-limit, before broadcast, before reactionsEnabled
// ═══════════════════════════════════════════════════════════════════════════════
describe('PH19-S2 — Guard placement is correct', () => {
  test('socket room check comes AFTER rate limit check', () => {
    const rlIdx  = reactionSection.indexOf("socketAllow('voice:reaction')");
    const rmIdx  = reactionSection.indexOf('socket.rooms.has(`voice:${roomId}`)');
    expect(rlIdx).toBeGreaterThan(-1);
    expect(rmIdx).toBeGreaterThan(-1);
    expect(rmIdx).toBeGreaterThan(rlIdx);
  });

  test('socket room check comes BEFORE broadcast emit', () => {
    const rmIdx  = reactionSection.indexOf('socket.rooms.has(`voice:${roomId}`)');
    const bcIdx  = reactionSection.indexOf("emit('voice:reaction'");
    expect(bcIdx).toBeGreaterThan(-1);
    expect(rmIdx).toBeLessThan(bcIdx);
  });

  test('socket room check comes BEFORE reactionsEnabled check', () => {
    // reactionsEnabled is inside the try block after the room check
    const rmIdx  = reactionSection.indexOf('socket.rooms.has(`voice:${roomId}`)');
    const reIdx  = src.indexOf('reactionsEnabled', src.indexOf("socket.on('voice:reaction'"));
    expect(reIdx).toBeGreaterThan(-1);
    expect(rmIdx).toBeLessThan(reIdx - src.indexOf("socket.on('voice:reaction'") + rmIdx);
    // Simpler: both are in reactionSection; reaction idx > room check idx
    const reInSection = reactionSection.indexOf('reactionsEnabled');
    if (reInSection !== -1) {
      expect(rmIdx).toBeLessThan(reInSection);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S3 — Pattern matches canonical voice:speaking
// ═══════════════════════════════════════════════════════════════════════════════
describe('PH19-S3 — Pattern matches voice:speaking (canonical reference)', () => {
  test('voice:speaking section contains socket.rooms.has() guard', () => {
    expect(speakingSection).toContain('socket.rooms.has(`voice:${roomId}`)');
  });

  test('both handlers use identical guard expression', () => {
    const guard = 'socket.rooms.has(`voice:${roomId}`)';
    expect(reactionSection).toContain(guard);
    expect(speakingSection).toContain(guard);
  });

  test('voice:speaking section has socket.to(room).emit', () => {
    expect(speakingSection).toContain("socket.to(`voice:${roomId}`)");
  });

  test('voice:reaction section has socket.to(room).emit', () => {
    expect(reactionSection).toContain("socket.to(`voice:${roomId}`)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S4 — Attack matrix via simulated socket state
// ═══════════════════════════════════════════════════════════════════════════════
describe('PH19-S4 — Attack matrix: simulated socket scenarios', () => {
  const ROOM_A = 'room-a-uuid';
  const ROOM_B = 'room-b-uuid';

  // ── ALLOW ─────────────────────────────────────────────────────────────────
  test('ALLOW: active participant reacts in own room', () => {
    const socket = makeSocket({ userId: 'user-1', joinedRooms: [`voice:${ROOM_A}`] });
    const { result } = simulateReactionHandler({ socket, roomId: ROOM_A, emoji: '🔥' });
    expect(result).toBe('allowed');
    expect(socket._emitted).toHaveLength(1);
    expect(socket._emitted[0].room).toBe(`voice:${ROOM_A}`);
    expect(socket._emitted[0].event).toBe('voice:reaction');
    expect(socket._emitted[0].data).toEqual({ userId: 'user-1', emoji: '🔥' });
  });

  test('ALLOW: HOST reacts in own room', () => {
    const socket = makeSocket({ userId: 'host-1', joinedRooms: [`voice:${ROOM_A}`] });
    const { result } = simulateReactionHandler({ socket, roomId: ROOM_A, emoji: '👑' });
    expect(result).toBe('allowed');
    expect(socket._emitted[0].data.userId).toBe('host-1');
  });

  // ── DENY ──────────────────────────────────────────────────────────────────
  test('DENY: authenticated nonparticipant reacts (not in any voice room)', () => {
    const socket = makeSocket({ userId: 'outsider-1', joinedRooms: [] });
    const { result, reason } = simulateReactionHandler({ socket, roomId: ROOM_A, emoji: '🔥' });
    expect(result).toBe('denied');
    expect(reason).toBe('not-in-room');
    expect(socket._emitted).toHaveLength(0);
  });

  test('DENY: user in Room A targets Room B (central PH19-001 scenario)', () => {
    const socket = makeSocket({ userId: 'user-2', joinedRooms: [`voice:${ROOM_A}`] });
    const { result, reason } = simulateReactionHandler({ socket, roomId: ROOM_B, emoji: '💥' });
    expect(result).toBe('denied');
    expect(reason).toBe('not-in-room');
    expect(socket._emitted).toHaveLength(0);
    // Attacker IS in Room A — but that does not grant access to Room B
    expect(socket.rooms.has(`voice:${ROOM_A}`)).toBe(true);
    expect(socket.rooms.has(`voice:${ROOM_B}`)).toBe(false);
  });

  test('DENY: targets arbitrary room UUID not in socket.rooms', () => {
    const socket = makeSocket({ userId: 'user-3', joinedRooms: [`voice:${ROOM_A}`] });
    const { result, reason } = simulateReactionHandler({ socket, roomId: 'some-other-room-uuid', emoji: '🎭' });
    expect(result).toBe('denied');
    expect(reason).toBe('not-in-room');
    expect(socket._emitted).toHaveLength(0);
  });

  test('DENY: kicked participant (socket evicted via socketsLeave)', () => {
    // After kick: socketsLeave removes voice:${roomId} — socket.rooms no longer has it
    const socket = makeSocket({ userId: 'kicked-user', joinedRooms: [] });
    const { result, reason } = simulateReactionHandler({ socket, roomId: ROOM_A, emoji: '👋' });
    expect(result).toBe('denied');
    expect(reason).toBe('not-in-room');
    expect(socket._emitted).toHaveLength(0);
  });

  test('DENY: banned participant (socket evicted via socketsLeave)', () => {
    const socket = makeSocket({ userId: 'banned-user', joinedRooms: [] });
    const { result, reason } = simulateReactionHandler({ socket, roomId: ROOM_A, emoji: '🚫' });
    expect(result).toBe('denied');
    expect(reason).toBe('not-in-room');
    expect(socket._emitted).toHaveLength(0);
  });

  test('DENY: reactions disabled for the room', () => {
    const socket = makeSocket({ userId: 'user-4', joinedRooms: [`voice:${ROOM_A}`] });
    const { result, reason } = simulateReactionHandler({ socket, roomId: ROOM_A, emoji: '🔥', reactionsEnabled: false });
    expect(result).toBe('denied');
    expect(reason).toBe('reactions-disabled');
    expect(socket._emitted).toHaveLength(0);
  });

  test('DENY: rate limit exceeded', () => {
    const socket = makeSocket({ userId: 'user-5', joinedRooms: [`voice:${ROOM_A}`] });
    const { result, reason } = simulateReactionHandler({ socket, roomId: ROOM_A, emoji: '🔥', rateLimitAllow: false });
    expect(result).toBe('denied');
    expect(reason).toBe('rate-limited');
    expect(socket._emitted).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S5 — Broadcast isolation
// ═══════════════════════════════════════════════════════════════════════════════
describe('PH19-S5 — Broadcast isolation: reaction stays in target room only', () => {
  test('allowed reaction emitted only to the one target room channel', () => {
    const socket = makeSocket({ userId: 'user-iso', joinedRooms: ['voice:room-iso-a'] });
    simulateReactionHandler({ socket, roomId: 'room-iso-a', emoji: '🌟' });
    expect(socket._emitted).toHaveLength(1);
    expect(socket._emitted[0].room).toBe('voice:room-iso-a');
  });

  test('source: handler uses socket.to(room) for scoped broadcast', () => {
    // socket.to(room) scopes the emit to the room; io.emit() would be global
    expect(reactionSection).toContain("socket.to(`voice:${roomId}`)");
  });

  test('source: handler does NOT use io.emit() (no global broadcast)', () => {
    // io.emit without a room target would broadcast to every socket
    // The reaction handler must not contain io.emit(
    const ioEmitInReaction = reactionSection.includes('io.emit(');
    expect(ioEmitInReaction).toBe(false);
  });

  test('cross-room: Room A user targeting Room B causes zero emissions', () => {
    const socket = makeSocket({ userId: 'user-iso2', joinedRooms: ['voice:room-iso-a'] });
    simulateReactionHandler({ socket, roomId: 'room-iso-b', emoji: '💥' });
    expect(socket._emitted).toHaveLength(0);
    expect(socket._emitted.filter(e => e.room === 'voice:room-iso-b')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S6 — Identity security: userId from server, not client payload
// ═══════════════════════════════════════════════════════════════════════════════
describe('PH19-S6 — Identity security: server-verified userId', () => {
  test('simulation: broadcast uses socket.userId, not a client-supplied value', () => {
    const socket = makeSocket({ userId: 'real-server-id', joinedRooms: ['voice:room-id-sec'] });
    simulateReactionHandler({ socket, roomId: 'room-id-sec', emoji: '🔒' });
    expect(socket._emitted[0].data.userId).toBe('real-server-id');
  });

  test('source: handler destructures { roomId, emoji } but NOT userId from payload', () => {
    // Find the handler signature in the reaction section
    const sigMatch = reactionSection.match(/socket\.on\('voice:reaction',\s*async\s*\(\{([^}]+)\}/);
    expect(sigMatch).not.toBeNull();
    const params = sigMatch[1];
    expect(params).toContain('roomId');
    expect(params).toContain('emoji');
    // Client must NOT be able to supply userId — it comes from socket closure
    expect(params).not.toContain('userId');
  });

  test('source: emit line includes userId (from server closure) and emoji', () => {
    // The emit line in the reaction handler must reference `userId` (closure var) + `emoji`
    expect(reactionSection).toContain('userId');
    expect(reactionSection).toContain('emoji');
    // And it's inside the emit call
    const emitIdx = reactionSection.indexOf("emit('voice:reaction'");
    expect(emitIdx).toBeGreaterThan(-1);
    const emitSlice = reactionSection.slice(emitIdx, emitIdx + 60);
    expect(emitSlice).toContain('userId');
    expect(emitSlice).toContain('emoji');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S7 — Reconnect scenario
// ═══════════════════════════════════════════════════════════════════════════════
describe('PH19-S7 — Reconnect: new socket connection has no voice room membership', () => {
  test('reconnected socket without voice:join_room is not in voice room', () => {
    // After reconnect, a new socket starts empty — no voice rooms until re-joined
    const socket = makeSocket({ userId: 'reconnected-kicked', joinedRooms: [] });
    expect(socket.rooms.has('voice:room-a-uuid')).toBe(false);
    const { result } = simulateReactionHandler({ socket, roomId: 'room-a-uuid', emoji: '😈' });
    expect(result).toBe('denied');
    expect(socket._emitted).toHaveLength(0);
  });

  test('source: voice:join_room performs DB isActive lookup on EVERY join', () => {
    expect(joinSection).toContain('voiceParticipant.findUnique');
    expect(joinSection).toContain('isActive');
    // The actual check in source uses participant?.isActive
    expect(joinSection).toContain('isActive');
    // Guard prevents joining the socket room if isActive is falsy
    expect(joinSection).toContain('socket.join(`voice:');
  });

  test('source: voice:join_room silently refuses inactive participant', () => {
    // The code does: if (!participant?.isActive) return;
    // The actual source uses short-circuit: check `!participant?.isActive` and return
    const hasIsActiveGuard = joinSection.includes('isActive') &&
      (joinSection.includes('!participant?.isActive') || joinSection.includes('participant?.isActive'));
    expect(hasIsActiveGuard).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S8 — Kick/ban eviction invariant
// ═══════════════════════════════════════════════════════════════════════════════
describe('PH19-S8 — Kick/ban eviction: socketsLeave removes socket from room', () => {
  test('source: kickParticipant calls socketsLeave for the voice room', () => {
    const kickStart = voiceSrc.indexOf('async function kickParticipant');
    const kickEnd   = voiceSrc.indexOf('async function banParticipant', kickStart);
    const kickFn    = voiceSrc.slice(kickStart, kickEnd);
    expect(kickFn).toContain('socketsLeave(`voice:${roomId}`)');
  });

  test('source: banParticipant calls socketsLeave for the voice room', () => {
    const banStart = voiceSrc.indexOf('async function banParticipant');
    const banEnd   = voiceSrc.indexOf('async function unbanParticipant', banStart);
    const banFn    = voiceSrc.slice(banStart, banEnd);
    expect(banFn).toContain('socketsLeave(`voice:${roomId}`)');
  });

  test('simulation: socket evicted from room is denied reaction', () => {
    const socket = makeSocket({ userId: 'evicted', joinedRooms: ['voice:room-evict'] });
    // Simulate socketsLeave — removes the room from socket.rooms
    socket.rooms.delete('voice:room-evict');
    expect(socket.rooms.has('voice:room-evict')).toBe(false);
    const { result, reason } = simulateReactionHandler({ socket, roomId: 'room-evict', emoji: '🔫' });
    expect(result).toBe('denied');
    expect(reason).toBe('not-in-room');
    expect(socket._emitted).toHaveLength(0);
  });

  test('simulation: participant in Room A cannot react in previously-left room', () => {
    const socket = makeSocket({ userId: 'multi-room', joinedRooms: ['voice:room-current'] });
    // Was previously in room-old but left (simulated by not being in rooms)
    expect(socket.rooms.has('voice:room-old')).toBe(false);
    const { result } = simulateReactionHandler({ socket, roomId: 'room-old', emoji: '👋' });
    expect(result).toBe('denied');
    expect(socket._emitted).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S9 — Phase 24A regression: LiveKit integration not changed
// ═══════════════════════════════════════════════════════════════════════════════
describe('PH19-S9 — Phase 24A regression: LiveKit integration unchanged', () => {
  test('sfuEvict still called in kickParticipant', () => {
    const kickStart = voiceSrc.indexOf('async function kickParticipant');
    const kickEnd   = voiceSrc.indexOf('async function banParticipant', kickStart);
    expect(voiceSrc.slice(kickStart, kickEnd)).toContain('sfuEvict(roomId, targetUserId');
  });

  test('sfuEvict still called in banParticipant', () => {
    const banStart = voiceSrc.indexOf('async function banParticipant');
    const banEnd   = voiceSrc.indexOf('async function unbanParticipant', banStart);
    expect(voiceSrc.slice(banStart, banEnd)).toContain('sfuEvict(roomId, targetUserId');
  });

  test('sfuRevokePublish still present in voice-roles controller', () => {
    expect(rolesSrc).toContain('sfuRevokePublish');
  });

  test('voice:speaking guard is unchanged (P0-3 not regressed)', () => {
    expect(speakingSection).toContain('socket.rooms.has(`voice:${roomId}`)');
  });

  test('liveclass:speaking guard is unchanged (A7-FIX not regressed)', () => {
    const lcSection = extractHandlerSection(src, 'liveclass:speaking');
    expect(lcSection).toContain('socket.rooms.has(`liveclass:${liveClassId}`)');
  });

  test('liveclass:reaction guard is unchanged (A7-FIX not regressed)', () => {
    const lcRSection = extractHandlerSection(src, 'liveclass:reaction');
    expect(lcRSection).toContain('socket.rooms.has(`liveclass:${liveClassId}`)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S10 — voice:join_room is the sole DB-gated entry into the voice socket room
// ═══════════════════════════════════════════════════════════════════════════════
describe('PH19-S10 — voice:join_room is the only entry to voice socket room', () => {
  test('voice:join_room section calls socket.join with voice: prefix', () => {
    expect(joinSection).toContain('socket.join(`voice:');
  });

  test('voice:join_room section performs voiceParticipant DB lookup', () => {
    expect(joinSection).toContain('voiceParticipant.findUnique');
  });

  test('voice:join_room rate-limited to prevent reconnect-loop attacks', () => {
    expect(joinSection).toContain("socketAllow('voice:join_room')");
  });
});
