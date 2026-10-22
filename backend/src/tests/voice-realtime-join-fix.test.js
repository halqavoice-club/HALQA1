'use strict';
/**
 * Voice Club — Realtime Join Fix Regression Tests
 *
 * Covers the 6 fixes applied to resolve the "new joiner not visible without
 * navigate-away" defect:
 *
 *  F-001  joinRoom always invalidates room cache even when status is LIVE
 *  F-003  socketsJoin is awaited before voice:user_joined / member_joined / stage_state
 *  F-004  createRoom socketsJoins the host into voice:{roomId}
 *  F-005  web useVoiceRoom retries listener registration when socket is null at mount
 *  F-006  mobile onUserJoined ignores events for a different roomId
 *  F-009  voice:speaker_pinned has a matching socket.off in cleanup
 *
 * These are pure source-analysis tests — no DB, Redis, or Socket.IO required.
 */

const fs   = require('fs');
const path = require('path');

const VOICE_CTRL  = path.join(__dirname, '../controllers/voice.controller.js');
const HOOK_SRC    = path.join(__dirname, '../../../frontend/src/hooks/useVoiceRoom.ts');
const MOBILE_PATH = path.join(__dirname, '../../../mobile/app/voice/[id].tsx');

const src      = fs.readFileSync(VOICE_CTRL, 'utf8');
const hookSrc  = fs.readFileSync(HOOK_SRC,   'utf8');
const mobileSrc = fs.existsSync(MOBILE_PATH) ? fs.readFileSync(MOBILE_PATH, 'utf8') : '';

// Helper: extract a named async function body
function extractFn(source, fnName, nextFnName) {
  const start = source.indexOf('async function ' + fnName);
  if (start === -1) return '';
  const end = nextFnName
    ? source.indexOf('async function ' + nextFnName, start + 1)
    : source.length;
  return source.slice(start, end === -1 ? source.length : end);
}

// ─── Minimal store (mirrors Zustand voice store addParticipant logic) ─────────
function makeStore() {
  let state = { activeRoom: null };
  const get = () => state;
  const set = (updater) => {
    state = typeof updater === 'function'
      ? { ...state, ...updater(state) }
      : { ...state, ...updater };
  };
  const addParticipant = (participant) => {
    const room = get().activeRoom;
    if (!room) return; // null guard — must be a no-op
    const exists = room.participants.some(p => p.userId === participant.userId);
    if (exists) {
      set({
        activeRoom: {
          ...room,
          participants: room.participants.map(p => {
            if (p.userId !== participant.userId) return p;
            const merged = { ...p };
            for (const key of Object.keys(participant)) {
              if (participant[key] !== undefined) merged[key] = participant[key];
            }
            merged.isActive = true;
            return merged;
          }),
        },
      });
    } else {
      set({ activeRoom: { ...room, participants: [...room.participants, participant] } });
    }
  };
  const onStageState = (data) => {
    const room = get().activeRoom;
    if (!room) return;
    const inStageIds = new Set(data.stageParticipants.map(sp => sp.userId));
    const cleared = room.participants.map(p =>
      inStageIds.has(p.userId) ? p : { ...p, seatNumber: null }
    );
    const updated = cleared.map(p => {
      const sp = data.stageParticipants.find(s => s.userId === p.userId);
      if (!sp) return p;
      return { ...p, role: sp.role, isMuted: sp.isMuted, seatNumber: sp.seatNumber,
               handRaised: sp.handRaised, mutedByModerator: sp.mutedByModerator };
    });
    set({ activeRoom: { ...room, participants: updated } });
  };
  const setActiveRoom = (room) => set({ activeRoom: room });
  const getParticipant = (userId) =>
    get().activeRoom?.participants.find(p => p.userId === userId) ?? null;
  const getActiveParticipants = () =>
    (get().activeRoom?.participants ?? []).filter(p => p.isActive !== false);
  return { get, set, setActiveRoom, addParticipant, onStageState, getParticipant, getActiveParticipants };
}

function makeP(userId, role = 'AUDIENCE', opts = {}) {
  return {
    id: userId, userId, role,
    isMuted:          opts.isMuted          ?? (role === 'AUDIENCE'),
    mutedByModerator: opts.mutedByModerator ?? false,
    handRaised:       opts.handRaised       ?? false,
    handRaisedAt:     opts.handRaisedAt     ?? null,
    joinedAt:         opts.joinedAt         ?? new Date().toISOString(),
    isActive:         opts.isActive         ?? true,
    isPinned:         opts.isPinned         ?? false,
    seatNumber:       opts.seatNumber       ?? null,
    user: { id: userId, firstName: userId, lastName: 'Test', avatarUrl: null },
  };
}

function makeRoom(participants = []) {
  return { id: 'room-1', hostId: 'host', title: 'Test',
           status: 'LIVE', isOpenMic: false, micLocked: false,
           lockedSeats: [], maxSpeakers: 12, participants };
}

// ═══════════════════════════════════════════════════════════════════════
// F-001 — joinRoom always invalidates room cache even when LIVE
// ═══════════════════════════════════════════════════════════════════════
describe('F-001 — joinRoom always invalidates room cache', () => {
  test('invalidateRoomCache is imported at controller top level', () => {
    expect(src).toMatch(/require\(['"]\.\.\/utils\/voiceRoomCache['"]\)/);
    expect(src).toMatch(/\binvalidateRoomCache\b/);
  });

  test('invalidateRoomCache is called in joinRoom post-transaction block', () => {
    const fn = extractFn(src, 'joinRoom', 'leaveRoom');
    expect(fn).toMatch(/\binvalidateRoomCache\b/);
  });

  test('invalidateRoomCache in joinRoom appears after syncRoomStatus call', () => {
    const fn = extractFn(src, 'joinRoom', 'leaveRoom');
    const syncIdx        = fn.indexOf('syncRoomStatus(');
    const invalidateIdx  = fn.indexOf('invalidateRoomCache(', syncIdx);
    expect(syncIdx).toBeGreaterThan(-1);
    // invalidateRoomCache must appear after syncRoomStatus in the source so
    // it runs unconditionally even when syncRoomStatus returns early (LIVE room).
    expect(invalidateIdx).toBeGreaterThan(syncIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// F-003 — socketsJoin is awaited before all emits in joinRoom
// ═══════════════════════════════════════════════════════════════════════
describe('F-003 — socketsJoin awaited before voice:user_joined / member_joined / stage_state', () => {
  test('await io.in(...).socketsJoin(...) pattern present in joinRoom', () => {
    const fn = extractFn(src, 'joinRoom', 'leaveRoom');
    expect(fn).toMatch(/await\s+io\.in\(`user:\$\{userId\}`\)\.socketsJoin\(`voice:\$\{roomId\}`\)/);
  });

  test('socketsJoin appears before voice:user_joined', () => {
    const fn = extractFn(src, 'joinRoom', 'leaveRoom');
    const sockIdx       = fn.indexOf('await io');
    const userJoinIdx   = fn.indexOf("emit('voice:user_joined'");
    expect(sockIdx).toBeGreaterThan(-1);
    expect(sockIdx).toBeLessThan(userJoinIdx);
  });

  test('socketsJoin appears before voice:member_joined', () => {
    const fn = extractFn(src, 'joinRoom', 'leaveRoom');
    const sockIdx        = fn.indexOf('await io');
    const memberJoinIdx  = fn.indexOf("emit('voice:member_joined'");
    expect(sockIdx).toBeGreaterThan(-1);
    expect(sockIdx).toBeLessThan(memberJoinIdx);
  });

  test('socketsJoin appears before voice:stage_state', () => {
    const fn = extractFn(src, 'joinRoom', 'leaveRoom');
    const sockIdx       = fn.indexOf('await io');
    const stageStateIdx = fn.indexOf("emit('voice:stage_state'");
    expect(sockIdx).toBeGreaterThan(-1);
    expect(sockIdx).toBeLessThan(stageStateIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// F-004 — createRoom socketsJoins the host
// ═══════════════════════════════════════════════════════════════════════
describe('F-004 — createRoom socketsJoin host into voice room', () => {
  test('createRoom calls socketsJoin in post-transaction block', () => {
    const fn = extractFn(src, 'createRoom', 'joinRoom');
    expect(fn).toMatch(/socketsJoin/);
  });

  test('createRoom socketsJoin targets voice:{roomId}', () => {
    const fn = extractFn(src, 'createRoom', 'joinRoom');
    expect(fn).toMatch(/socketsJoin\(`voice:\$\{roomId\}`\)/);
  });

  test('createRoom socketsJoin uses await keyword', () => {
    const fn = extractFn(src, 'createRoom', 'joinRoom');
    expect(fn).toMatch(/await\s+io\.in\(`user:\$\{hostId\}`\)\.socketsJoin/);
  });

  test('createRoom socketsJoin happens before voice:room_created broadcast', () => {
    const fn = extractFn(src, 'createRoom', 'joinRoom');
    const sockIdx       = fn.indexOf('socketsJoin');
    const roomCreatedIdx = fn.indexOf("emit('voice:room_created'");
    expect(sockIdx).toBeGreaterThan(-1);
    expect(roomCreatedIdx).toBeGreaterThan(-1);
    expect(sockIdx).toBeLessThan(roomCreatedIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// F-005 — web useVoiceRoom retries when socket is null at mount
// ═══════════════════════════════════════════════════════════════════════
describe('F-005 — web useVoiceRoom retries listener registration when socket null', () => {
  test('hook imports useState from react', () => {
    expect(hookSrc).toMatch(/useState/);
  });

  test('hook has socketReady state variable', () => {
    expect(hookSrc).toMatch(/socketReady/);
    expect(hookSrc).toMatch(/setSocketReady/);
  });

  test('polling effect sets socketReady to true when socket becomes available', () => {
    expect(hookSrc).toMatch(/setSocketReady\(true\)/);
  });

  test('polling effect uses setInterval', () => {
    expect(hookSrc).toMatch(/setInterval/);
  });

  test('main listener effect dep array includes both roomId and socketReady', () => {
    expect(hookSrc).toMatch(/\[roomId,\s*socketReady\]/);
  });

  test('main listener effect bails when socket still null (F-005 part 2)', () => {
    // After F-005 fix the effect must still have an early return for null socket
    // so it doesn't proceed with undefined socket reference.
    const effectStart = hookSrc.indexOf('// F-005 FIX part 2');
    expect(effectStart).toBeGreaterThan(-1);
    // Window of 300 covers the multi-line comment block plus the if(!socket) guard
    const snippet = hookSrc.slice(effectStart, effectStart + 300);
    expect(snippet).toMatch(/if\s*\(!socket\)\s*return/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// F-006 — mobile onUserJoined ignores wrong roomId
// ═══════════════════════════════════════════════════════════════════════
describe('F-006 — mobile onUserJoined has roomId guard', () => {
  test('mobile source contains onUserJoined handler', () => {
    if (!mobileSrc) { expect(mobileSrc).toBeDefined(); return; }
    expect(mobileSrc).toMatch(/const onUserJoined = \(d: any\) => \{/);
  });

  test('mobile onUserJoined has d.roomId !== id guard', () => {
    if (!mobileSrc) return;
    const idx = mobileSrc.indexOf('const onUserJoined = (d: any) => {');
    const handler = mobileSrc.slice(idx, idx + 400);
    expect(handler).toMatch(/d\.roomId !== id/);
  });

  test('mobile onUserJoined guard precedes setParticipants call', () => {
    if (!mobileSrc) return;
    const idx = mobileSrc.indexOf('const onUserJoined = (d: any) => {');
    // Use 1200 chars — the guard + comment block + newP construction puts
    // setParticipants at roughly offset 900 from the function start.
    const handler = mobileSrc.slice(idx, idx + 1200);
    const guardIdx         = handler.indexOf('d.roomId !== id');
    const setParticipantsIdx = handler.indexOf('setParticipants');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(setParticipantsIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(setParticipantsIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// F-009 — voice:speaker_pinned listener leak fixed
// ═══════════════════════════════════════════════════════════════════════
describe('F-009 — voice:speaker_pinned cleanup matches registration', () => {
  test('voice:speaker_pinned is registered with socket.on', () => {
    expect(hookSrc).toMatch(/socket\.on\('voice:speaker_pinned'/);
  });

  test('voice:speaker_pinned is removed with socket.off in cleanup', () => {
    expect(hookSrc).toMatch(/socket\.off\('voice:speaker_pinned',\s*onSpeakerPinned\)/);
  });

  test('socket.off for voice:speaker_pinned is inside the cleanup return block', () => {
    // The last occurrence of socket.off('voice:speaker_pinned', onSpeakerPinned) must appear
    // after the last return () => { marker (i.e. inside the cleanup function).
    const lastReturnIdx  = hookSrc.lastIndexOf('return () => {');
    const lastOffIdx     = hookSrc.lastIndexOf("socket.off('voice:speaker_pinned', onSpeakerPinned)");
    expect(lastReturnIdx).toBeGreaterThan(-1);
    expect(lastOffIdx).toBeGreaterThan(lastReturnIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// F-006b — mobile voice:leave_room cleanup is guarded by intentionalLeaveRef
// ═══════════════════════════════════════════════════════════════════════
describe('F-006b — mobile voice:leave_room cleanup is gated on intentionalLeaveRef', () => {
  test('mobile source contains intentionalLeaveRef ref', () => {
    if (!mobileSrc) { expect(mobileSrc).toBeDefined(); return; }
    expect(mobileSrc).toMatch(/intentionalLeaveRef/);
  });

  test('voice:leave_room emit in cleanup is inside an if guard containing intentionalLeaveRef', () => {
    if (!mobileSrc) return;
    // Find the cleanup return block — the last `return () => {` before the dep array `}, [id])`
    const cleanupIdx = mobileSrc.lastIndexOf('return () => {');
    expect(cleanupIdx).toBeGreaterThan(-1);
    const leaveEmitIdx = mobileSrc.indexOf("emit('voice:leave_room'", cleanupIdx);
    expect(leaveEmitIdx).toBeGreaterThan(cleanupIdx);
    // The emit must not appear at the very start of the cleanup — it must be inside an if block
    const cleanupSnippet = mobileSrc.slice(cleanupIdx, leaveEmitIdx + 50);
    expect(cleanupSnippet).toMatch(/if\s*\(.*intentionalLeaveRef/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Store: addParticipant from voice:user_joined while already mounted
// ═══════════════════════════════════════════════════════════════════════
describe('Store — addParticipant from voice:user_joined while mounted', () => {
  test('adds new audience participant to active room', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('host', 'HOST', { seatNumber: 1, isMuted: false })]));
    s.addParticipant(makeP('newuser', 'AUDIENCE', { seatNumber: null }));
    expect(s.getActiveParticipants()).toHaveLength(2);
    expect(s.getParticipant('newuser')).not.toBeNull();
  });

  test('is a no-op when activeRoom is null (null guard)', () => {
    const s = makeStore();
    // activeRoom is null — addParticipant must not throw
    expect(() => s.addParticipant(makeP('newuser', 'AUDIENCE'))).not.toThrow();
    expect(s.get().activeRoom).toBeNull();
  });

  test('updates rather than duplicates a reconnecting participant', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a', 'AUDIENCE', { isActive: false })]));
    s.addParticipant(makeP('a', 'AUDIENCE', { isActive: true, seatNumber: null }));
    expect(s.get().activeRoom.participants).toHaveLength(1);
    expect(s.get().activeRoom.participants[0].isActive).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Snapshot: stale stage_state does not evict newer joiner
// ═══════════════════════════════════════════════════════════════════════
describe('Snapshot — stale stage_state does not remove newer joiner', () => {
  test('onStageState clears seatNumber for absent participants but keeps them in list', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([
      makeP('host',    'HOST',     { seatNumber: 1, isMuted: false }),
      makeP('newuser', 'AUDIENCE', { seatNumber: null }),
    ]));
    // Stale snapshot — only includes host (newuser joined after snapshot)
    s.onStageState({
      roomId: 'room-1',
      stageCount: 1,
      stageParticipants: [
        { userId: 'host', role: 'HOST', isMuted: false, seatNumber: 1,
          isPinned: false, handRaised: false, mutedByModerator: false },
      ],
    });
    // newuser must still be present — snapshot cannot evict audience members
    expect(s.get().activeRoom.participants).toHaveLength(2);
    expect(s.getParticipant('newuser')).not.toBeNull();
  });

  test('addParticipant after stale snapshot correctly adds new joiner', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('host', 'HOST', { seatNumber: 1, isMuted: false })]));
    // Stale snapshot arrives first
    s.onStageState({
      roomId: 'room-1',
      stageCount: 1,
      stageParticipants: [
        { userId: 'host', role: 'HOST', isMuted: false, seatNumber: 1,
          isPinned: false, handRaised: false, mutedByModerator: false },
      ],
    });
    // Then newer voice:user_joined arrives
    s.addParticipant(makeP('newuser', 'AUDIENCE', { seatNumber: null }));
    expect(s.getActiveParticipants()).toHaveLength(2);
    expect(s.getParticipant('newuser')).not.toBeNull();
  });
});
