'use strict';
/**
 * Voice Club — Real-Time Synchronization Regression Tests
 *
 * Covers every scenario from the real-time sync requirement:
 *  1. User B joins — User A sees them immediately
 *  2. User B raises hand — User A sees it immediately
 *  3. User B approved to stage — correct seat appears immediately
 *  4. User B grabs mic — seat occupied immediately for all
 *  5. SPEAKER drops mic — seat empty immediately for all
 *  6. HOST drops mic — HOST seat clears immediately (RT-FIX-7)
 *  7. User C joins — everyone inside sees C immediately
 *  8. Kick — participant disappears immediately
 *  9. Ban — participant disappears immediately
 * 10. Reconnect — authoritative state restored
 * 11. null semantics — seatNumber:null never discarded
 * 12. Moderator removed — seatNumber cleared (RT-FIX-8/10)
 * 13. stage_state reconciliation — ghost seats cleared
 * 14. Seat invariants — no Seat 13, seatNumber is authority
 * 15. Mute events — seatNumber preserved or cleared correctly
 * 16. Backend source verification — all required emits present
 */

const fs   = require('fs');
const path = require('path');

// ─── Source files ─────────────────────────────────────────────────────────────
const VOICE_CTRL       = path.join(__dirname, '../controllers/voice.controller.js');
const VOICE_ROLES_CTRL = path.join(__dirname, '../controllers/voice-roles.controller.js');
const VOICE_QUEUE_CTRL = path.join(__dirname, '../controllers/voice-queue.controller.js');
// __dirname = backend/src/tests  →  ../../../ = workspace root
const HOOK_SRC         = path.join(__dirname, '../../../frontend/src/hooks/useVoiceRoom.ts');
const MOBILE_SRC_PATH  = path.join(__dirname, '../../../mobile/app/voice/[id].tsx');

const src       = fs.readFileSync(VOICE_CTRL,       'utf8');
const rolesSrc  = fs.readFileSync(VOICE_ROLES_CTRL, 'utf8');
const queueSrc  = fs.readFileSync(VOICE_QUEUE_CTRL, 'utf8');
const hookSrc   = fs.readFileSync(HOOK_SRC,         'utf8');
const mobileSrc = fs.existsSync(MOBILE_SRC_PATH)
  ? fs.readFileSync(MOBILE_SRC_PATH, 'utf8')
  : '';

// ─── Helper: extract a function body by name ──────────────────────────────────
function extractFn(source, fnName, nextFnName) {
  const start = source.indexOf('async function ' + fnName);
  if (start === -1) return '';
  const end = nextFnName
    ? source.indexOf('async function ' + nextFnName, start + 1)
    : source.length;
  return source.slice(start, end === -1 ? source.length : end);
}

// ─── Minimal store (mirrors Zustand voice store logic) ────────────────────────
function makeStore() {
  let state = { activeRoom: null };

  const get = () => state;

  const set = (updater) => {
    state = typeof updater === 'function'
      ? { ...state, ...updater(state) }
      : { ...state, ...updater };
  };

  const updateParticipant = (userId, updates) => {
    const room = get().activeRoom;
    if (!room) return;
    set({
      activeRoom: {
        ...room,
        participants: room.participants.map(p => {
          if (p.userId !== userId) return p;
          const merged = { ...p };
          for (const key of Object.keys(updates)) {
            if (updates[key] !== undefined) merged[key] = updates[key];
          }
          return merged;
        }),
      },
    });
  };

  const addParticipant = (participant) => {
    const room = get().activeRoom;
    if (!room) return;
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
      const ROLE_ORDER = { HOST: 0, MODERATOR: 1, SPEAKER: 2, AUDIENCE: 3 };
      const newList = [...room.participants, participant].sort((a, b) => {
        const rd = (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9);
        if (rd !== 0) return rd;
        return (a.joinedAt ?? '').localeCompare(b.joinedAt ?? '');
      });
      set({ activeRoom: { ...room, participants: newList } });
    }
  };

  const removeParticipant = (userId) => {
    const room = get().activeRoom;
    if (!room) return;
    set({
      activeRoom: {
        ...room,
        participants: room.participants.map(p =>
          p.userId === userId ? { ...p, isActive: false } : p
        ),
      },
    });
  };

  const onRoleChanged = (data) => {
    const update = { role: data.role };
    if (data.seatNumber !== undefined) update.seatNumber = data.seatNumber ?? null;
    if (data.role === 'AUDIENCE') {
      update.isMuted = true;
      update.seatNumber = null;
      update.handRaised = false;
      update.handRaisedAt = null;
    } else if (data.role === 'SPEAKER' && data.seatNumber != null) {
      update.isMuted = false;
    }
    updateParticipant(data.userId, update);
  };

  const onMuteChanged = (data) => {
    const update = { isMuted: data.isMuted };
    if (data.mutedByModerator !== undefined) update.mutedByModerator = data.mutedByModerator;
    if (data.seatNumber !== undefined) update.seatNumber = data.seatNumber ?? null;
    updateParticipant(data.userId, update);
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
    (get().activeRoom?.participants ?? []).filter(p => p.isActive);

  return {
    get, set, setActiveRoom, getParticipant, getActiveParticipants,
    addParticipant, removeParticipant, updateParticipant,
    onRoleChanged, onMuteChanged, onStageState,
  };
}

// ─── Factories ────────────────────────────────────────────────────────────────
function makeP(userId, role = 'AUDIENCE', opts = {}) {
  return {
    id: opts.id ?? userId, userId, role,
    isMuted:          opts.isMuted          ?? (role === 'AUDIENCE'),
    mutedByModerator: opts.mutedByModerator ?? false,
    handRaised:       opts.handRaised       ?? false,
    handRaisedAt:     opts.handRaisedAt     ?? null,
    joinedAt:         opts.joinedAt         ?? new Date().toISOString(),
    isActive:         opts.isActive         ?? true,
    isPinned:         opts.isPinned         ?? false,
    seatNumber:       opts.seatNumber       ?? null,
    user: { id: userId, firstName: opts.firstName ?? userId,
            lastName: opts.lastName ?? 'Test', avatarUrl: null },
  };
}

function makeRoom(participants = []) {
  return { id: 'room-1', hostId: 'host', title: 'Test',
           status: 'LIVE', isOpenMic: false, micLocked: false,
           lockedSeats: [], maxSpeakers: 12, participants };
}

function slots(store) {
  const active = store.getActiveParticipants();
  return Array.from({ length: 12 }, (_, i) =>
    active.find(p => p.seatNumber === i + 1) ?? null
  );
}

// ═══════════════════════════════════════════════
// 1 — User B joins: User A sees them immediately
// ═══════════════════════════════════════════════
describe('S1 — User B joins: User A sees immediately', () => {
  test('addParticipant adds B to active list', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a')]));
    s.addParticipant(makeP('b', 'AUDIENCE', { seatNumber: null }));
    expect(s.getActiveParticipants()).toHaveLength(2);
    expect(s.getParticipant('b')).toBeTruthy();
  });

  test('B appears with seatNumber null (audience)', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a')]));
    s.addParticipant(makeP('b', 'AUDIENCE', { seatNumber: null }));
    expect(s.getParticipant('b').seatNumber).toBeNull();
    expect(s.getParticipant('b').isActive).toBe(true);
  });

  test('backend joinRoom emits voice:user_joined with full snapshot (RT-FIX-2)', () => {
    const fn = extractFn(src, 'joinRoom', 'leaveRoom');
    expect(fn).toMatch(/voice:user_joined/);
    expect(fn).toMatch(/seatNumber\s*:/);
    expect(fn).toMatch(/isMuted\s*:/);
    expect(fn).toMatch(/joinedAt\s*:/);
  });

  test('socketsJoin before emit (RT-FIX-1)', () => {
    const fn = extractFn(src, 'joinRoom', 'leaveRoom');
    expect(fn.indexOf('socketsJoin')).toBeLessThan(fn.indexOf("emit('voice:user_joined'"));
  });
});

// ═══════════════════════════════════════════════
// 2 — User B raises hand: User A sees immediately
// ═══════════════════════════════════════════════
describe('S2 — User B raises hand: seen immediately', () => {
  test('updateParticipant sets handRaised only on B', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a'), makeP('b')]));
    s.updateParticipant('b', { handRaised: true });
    expect(s.getParticipant('b').handRaised).toBe(true);
    expect(s.getParticipant('a').handRaised).toBe(false);
  });

  test('backend raiseHand emits voice:hand_raised to room', () => {
    const fn = extractFn(queueSrc, 'raiseHand', 'cancelHand');
    expect(fn).toMatch(/voice:hand_raised/);
    expect(fn).toMatch(/io\.to\(`voice:\$\{roomId\}`\)\.emit/);
  });
});

// ═══════════════════════════════════════════════
// 3 — B approved to stage: correct seat immediately
// ═══════════════════════════════════════════════
describe('S3 — B approved to stage: correct seat immediately', () => {
  test('onRoleChanged SPEAKER+seat2 assigns seat', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a','HOST',{seatNumber:1,isMuted:false}),makeP('b')]));
    s.onRoleChanged({ userId: 'b', role: 'SPEAKER', seatNumber: 2 });
    const b = s.getParticipant('b');
    expect(b.role).toBe('SPEAKER');
    expect(b.seatNumber).toBe(2);
    expect(b.isMuted).toBe(false);
    expect(b.handRaised).toBe(false);
  });

  test('seat grid reflects new speaker at correct index', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a','HOST',{seatNumber:1,isMuted:false}),makeP('b')]));
    s.onRoleChanged({ userId: 'b', role: 'SPEAKER', seatNumber: 3 });
    const sl = slots(s);
    expect(sl[0]?.userId).toBe('a');
    expect(sl[1]).toBeNull();
    expect(sl[2]?.userId).toBe('b');
  });

  test('backend _promoteUser emits voice:role_changed with seatNumber', () => {
    const fn = extractFn(queueSrc, '_promoteUser', 'rejectUser');
    expect(fn).toMatch(/voice:role_changed/);
    expect(fn).toMatch(/seatNumber.*assignedSeat|assignedSeat.*seatNumber/);
  });

  test('backend _promoteUser emits voice:stage_state', () => {
    const fn = extractFn(queueSrc, '_promoteUser', 'rejectUser');
    expect(fn).toMatch(/voice:stage_state/);
  });

  test('backend promoteParticipant emits voice:stage_state', () => {
    const fn = extractFn(src, 'promoteParticipant', 'kickParticipant');
    expect(fn).toMatch(/voice:stage_state/);
  });
});

// ═══════════════════════════════════════════════
// 4 — B grabs mic: seat occupied immediately
// ═══════════════════════════════════════════════
describe('S4 — B grabs mic: seat occupied immediately', () => {
  test('updateParticipant applies seatNumber on mic grab', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a','HOST',{seatNumber:1,isMuted:false}),makeP('b')]));
    s.updateParticipant('b', { role:'SPEAKER', isMuted:false, seatNumber:2 });
    expect(s.getParticipant('b').seatNumber).toBe(2);
    expect(s.getParticipant('b').isMuted).toBe(false);
  });

  test('backend grabMic emits voice:mic_grabbed with seatNumber', () => {
    const fn = extractFn(src, 'grabMic', 'dropMic');
    expect(fn).toMatch(/voice:mic_grabbed/);
    expect(fn).toMatch(/seatNumber.*assignedSeat|assignedSeat.*seatNumber/);
  });

  test('backend grabMic emits voice:stage_state', () => {
    expect(extractFn(src, 'grabMic', 'dropMic')).toMatch(/voice:stage_state/);
  });
});

// ═══════════════════════════════════════════════
// 5 — SPEAKER drops mic: seat empty immediately
// ═══════════════════════════════════════════════
describe('S5 — SPEAKER drops mic: seat empty immediately', () => {
  test('onRoleChanged AUDIENCE clears seatNumber', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a','HOST',{seatNumber:1,isMuted:false}),
                              makeP('b','SPEAKER',{seatNumber:2,isMuted:false})]));
    s.onRoleChanged({ userId: 'b', role: 'AUDIENCE', seatNumber: null });
    const b = s.getParticipant('b');
    expect(b.seatNumber).toBeNull();
    expect(b.role).toBe('AUDIENCE');
    expect(b.isMuted).toBe(true);
  });

  test('null seatNumber applied — old value 5 overwritten', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('b','SPEAKER',{seatNumber:5,isMuted:false})]));
    s.updateParticipant('b', { seatNumber: null });
    expect(s.getParticipant('b').seatNumber).toBeNull();
  });

  test('seat grid shows empty slot after drop mic', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a','HOST',{seatNumber:1,isMuted:false}),
                              makeP('b','SPEAKER',{seatNumber:2,isMuted:false})]));
    s.onRoleChanged({ userId:'b', role:'AUDIENCE', seatNumber:null });
    expect(slots(s)[1]).toBeNull();
  });

  test('backend dropMic emits voice:role_changed AUDIENCE+null', () => {
    const fn = extractFn(src, 'dropMic', null);
    expect(fn).toMatch(/voice:role_changed/);
    expect(fn).toMatch(/AUDIENCE/);
    expect(fn).toMatch(/seatNumber.*null/);
  });
});

// ═══════════════════════════════════════════════
// 6 — HOST drops mic: seat clears immediately
// ═══════════════════════════════════════════════
describe('S6 — HOST drops mic: seat clears immediately (RT-FIX-7)', () => {
  test('onRoleChanged HOST+null clears seat, role unchanged', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('h','HOST',{seatNumber:1,isMuted:false})]));
    s.onRoleChanged({ userId:'h', role:'HOST', seatNumber:null });
    expect(s.getParticipant('h').seatNumber).toBeNull();
    expect(s.getParticipant('h').role).toBe('HOST');
  });

  test('backend dropMic privileged path emits voice:role_changed (RT-FIX-7)', () => {
    const fn = extractFn(src, 'dropMic', null);
    expect(fn).toMatch(/isPrivileged/);
    expect(fn).toMatch(/voice:role_changed/);
    expect(fn).toMatch(/participant\.role/);
  });

  test('backend dropMic emits voice:stage_state (RT-FIX-9)', () => {
    expect(extractFn(src, 'dropMic', null)).toMatch(/voice:stage_state/);
  });

  test('Seat 1 null after HOST drop, Seat 2 unchanged', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('h','HOST',{seatNumber:1,isMuted:false}),
                              makeP('m','MODERATOR',{seatNumber:2,isMuted:false})]));
    s.onRoleChanged({ userId:'h', role:'HOST', seatNumber:null });
    const sl = slots(s);
    expect(sl[0]).toBeNull();
    expect(sl[1]?.userId).toBe('m');
  });
});

// ═══════════════════════════════════════════════
// 7 — User C joins: everyone sees C immediately
// ═══════════════════════════════════════════════
describe('S7 — User C joins: everyone sees C immediately', () => {
  test('adding C does not disturb A or B', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a','HOST',{seatNumber:1,isMuted:false}),
                              makeP('b','SPEAKER',{seatNumber:2,isMuted:false})]));
    s.addParticipant(makeP('c','AUDIENCE',{seatNumber:null}));
    expect(s.getParticipant('a').seatNumber).toBe(1);
    expect(s.getParticipant('b').seatNumber).toBe(2);
    expect(s.getParticipant('c').userId).toBe('c');
    expect(s.getActiveParticipants()).toHaveLength(3);
  });

  test('reconnecting user updated, not duplicated', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a','AUDIENCE',{isActive:false})]));
    s.addParticipant(makeP('a','AUDIENCE',{isActive:true,seatNumber:null}));
    expect(s.get().activeRoom.participants).toHaveLength(1);
    expect(s.get().activeRoom.participants[0].isActive).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// 8 — Kick: participant disappears immediately
// ═══════════════════════════════════════════════
describe('S8 — Kick: participant disappears immediately', () => {
  test('removeParticipant hides kicked user', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a','HOST',{seatNumber:1,isMuted:false}),
                              makeP('b','SPEAKER',{seatNumber:2,isMuted:false})]));
    s.removeParticipant('b');
    expect(s.getActiveParticipants().find(p => p.userId === 'b')).toBeFalsy();
  });

  test('kicked participant seat becomes null in grid', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a','HOST',{seatNumber:1,isMuted:false}),
                              makeP('b','SPEAKER',{seatNumber:2,isMuted:false})]));
    s.removeParticipant('b');
    expect(slots(s)[1]).toBeNull();
  });

  test('backend kickParticipant emits voice:user_left to room', () => {
    const fn = extractFn(src, 'kickParticipant', 'banParticipant');
    expect(fn).toMatch(/voice:user_left/);
    expect(fn).toMatch(/io\.to\(`voice:\$\{roomId\}`\)/);
  });

  test('backend kickParticipant emits voice:kicked to personal channel', () => {
    const fn = extractFn(src, 'kickParticipant', 'banParticipant');
    expect(fn).toMatch(/voice:kicked/);
    expect(fn).toMatch(/user:\$\{targetUserId\}/);
  });
});

// ═══════════════════════════════════════════════
// 9 — Ban: participant disappears immediately
// ═══════════════════════════════════════════════
describe('S9 — Ban: participant disappears immediately', () => {
  test('removeParticipant hides banned user', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a','HOST',{seatNumber:1,isMuted:false}),makeP('b')]));
    s.removeParticipant('b');
    expect(s.getActiveParticipants().find(p => p.userId === 'b')).toBeFalsy();
  });

  test('backend banParticipant emits voice:banned to room with userId', () => {
    const fn = extractFn(src, 'banParticipant', 'unbanParticipant');
    expect(fn).toMatch(/voice:banned/);
    expect(fn).toMatch(/userId.*targetUserId|targetUserId.*userId/);
  });

  test('backend banParticipant emits voice:banned to personal channel', () => {
    const fn = extractFn(src, 'banParticipant', 'unbanParticipant');
    expect(fn).toMatch(/user:\$\{targetUserId\}/);
  });
});

// ═══════════════════════════════════════════════
// 10 — Reconnect: authoritative state restored
// ═══════════════════════════════════════════════
describe('S10 — Reconnect: authoritative state restored', () => {
  test('reconnecting speaker has seat restored, no duplicate', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a','HOST',{seatNumber:1,isMuted:false}),
                              makeP('b','SPEAKER',{seatNumber:3,isMuted:false})]));
    s.addParticipant(makeP('b','SPEAKER',{seatNumber:3,isMuted:false,isActive:true}));
    const b = s.getParticipant('b');
    expect(b.seatNumber).toBe(3);
    expect(b.isActive).toBe(true);
    expect(s.get().activeRoom.participants.filter(p => p.userId === 'b')).toHaveLength(1);
  });

  test('reconnecting audience user keeps seatNumber null', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('b','AUDIENCE',{seatNumber:null,isActive:false})]));
    s.addParticipant(makeP('b','AUDIENCE',{seatNumber:null,isActive:true}));
    expect(s.getParticipant('b').seatNumber).toBeNull();
    expect(s.getParticipant('b').isActive).toBe(true);
  });

  test('web re-emits voice:join_room on socket reconnect', () => {
    expect(hookSrc).toMatch(/socket\.on\('connect',\s*onReconnect\)/);
    // G2: onReconnect now calls emitJoinRoomAck which wraps the emit with an ack callback
    expect(hookSrc).toMatch(/emitJoinRoomAck/);
    expect(hookSrc).toMatch(/sock\.emit\('voice:join_room'/); // helper function emits with ack
  });
});

// ═══════════════════════════════════════════════
// 11 — null semantics: seatNumber:null authoritative
// ═══════════════════════════════════════════════
describe('S11 — null semantics: seatNumber:null never discarded', () => {
  test('updateParticipant null overwrites seat 5', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('b','SPEAKER',{seatNumber:5,isMuted:false})]));
    s.updateParticipant('b', { seatNumber: null });
    expect(s.getParticipant('b').seatNumber).toBeNull();
  });

  test('updateParticipant undefined keeps seat 5', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('b','SPEAKER',{seatNumber:5,isMuted:false})]));
    s.updateParticipant('b', { isMuted: true });
    expect(s.getParticipant('b').seatNumber).toBe(5);
  });

  test('AUDIENCE role always forces seatNumber null', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('b','SPEAKER',{seatNumber:7,isMuted:false})]));
    s.onRoleChanged({ userId:'b', role:'AUDIENCE' });
    expect(s.getParticipant('b').seatNumber).toBeNull();
  });

  test('null-aware merge: null wins over stale value 3', () => {
    const merged = { seatNumber: 3 };
    const updates = { seatNumber: null };
    for (const k of Object.keys(updates)) {
      if (updates[k] !== undefined) merged[k] = updates[k];
    }
    expect(merged.seatNumber).toBeNull();
  });
});

// ═══════════════════════════════════════════════
// 12 — Moderator removed: seat cleared (RT-FIX-8/10)
// ═══════════════════════════════════════════════
describe('S12 — Moderator removed: seat cleared immediately', () => {
  test('store update clears seatNumber on mod demotion', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a','HOST',{seatNumber:1,isMuted:false}),
                              makeP('m','MODERATOR',{seatNumber:2,isMuted:false})]));
    s.updateParticipant('m', { role:'AUDIENCE', seatNumber:null, isMuted:true });
    const m = s.getParticipant('m');
    expect(m.role).toBe('AUDIENCE');
    expect(m.seatNumber).toBeNull();
    expect(m.isMuted).toBe(true);
  });

  test('web onModeratorRemoved includes seatNumber:null (RT-FIX-8)', () => {
    const idx = hookSrc.indexOf('onModeratorRemoved');
    expect(idx).toBeGreaterThan(-1);
    // Use 800 chars — handler body is ~500 chars due to the comment block
    const snippet = hookSrc.slice(idx, idx + 800);
    expect(snippet).toMatch(/seatNumber.*null/);
  });

  test('backend removeModerator clears seatNumber in DB (RT-FIX-10)', () => {
    const fn = extractFn(rolesSrc, 'removeModerator', 'transferAdmin');
    expect(fn).toMatch(/seatNumber.*NULL|NULL.*seatNumber/i);
  });

  test('backend removeModerator voice:role_changed has seatNumber:null (RT-FIX-10)', () => {
    const fn = extractFn(rolesSrc, 'removeModerator', 'transferAdmin');
    expect(fn).toMatch(/voice:role_changed/);
    expect(fn).toMatch(/seatNumber.*null/);
  });

  test('mobile moderator_removed handler clears seatNumber (RT-FIX-6)', () => {
    if (!mobileSrc) return;
    const idx = mobileSrc.indexOf('const onModeratorRemoved');
    expect(idx).toBeGreaterThan(-1);
    expect(mobileSrc.slice(idx, idx + 1200)).toMatch(/seatNumber.*null/);
  });
});

// ═══════════════════════════════════════════════
// 13 — stage_state reconciliation: ghost seats cleared
// ═══════════════════════════════════════════════
describe('S13 — stage_state reconciliation: ghost seats cleared', () => {
  test('onStageState clears seatNumber for absent participants', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a','HOST',{seatNumber:1,isMuted:false}),
                              makeP('b','SPEAKER',{seatNumber:2,isMuted:false})]));
    s.onStageState({ roomId:'room-1', stageCount:1, stageParticipants: [
      { userId:'a', role:'HOST', isMuted:false, seatNumber:1,
        isPinned:false, handRaised:false, mutedByModerator:false }
    ]});
    expect(s.getParticipant('a').seatNumber).toBe(1);
    expect(s.getParticipant('b').seatNumber).toBeNull();
  });

  test('onStageState corrects wrong seat (race condition recovery)', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a','HOST',{seatNumber:1}),
                              makeP('b','SPEAKER',{seatNumber:99})]));
    s.onStageState({ roomId:'room-1', stageCount:2, stageParticipants: [
      { userId:'a', role:'HOST',    isMuted:false, seatNumber:1,  isPinned:false, handRaised:false, mutedByModerator:false },
      { userId:'b', role:'SPEAKER', isMuted:false, seatNumber:3,  isPinned:false, handRaised:false, mutedByModerator:false },
    ]});
    expect(s.getParticipant('b').seatNumber).toBe(3);
  });
});

// ═══════════════════════════════════════════════
// 14 — Seat invariants
// ═══════════════════════════════════════════════
describe('S14 — Seat invariants', () => {
  test('12 full seats — no Seat 13', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom(
      Array.from({ length:12 }, (_, i) => makeP(`spk${i+1}`,'SPEAKER',{seatNumber:i+1,isMuted:false}))
    ));
    expect(s.getActiveParticipants().find(p => p.seatNumber === 13)).toBeUndefined();
    expect(slots(s)).toHaveLength(12);
  });

  test('HOST in audience has seatNumber null despite HOST role', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('h','HOST',{seatNumber:null,isMuted:true})]));
    expect(s.getActiveParticipants().filter(p => p.seatNumber != null)).toHaveLength(0);
    expect(s.getParticipant('h').role).toBe('HOST');
  });
});

// ═══════════════════════════════════════════════
// 15 — Mute events preserve or clear seatNumber
// ═══════════════════════════════════════════════
describe('S15 — Mute events handle seatNumber correctly', () => {
  test('mute_changed with seatNumber:null clears seat (drop-mic path)', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('h','HOST',{seatNumber:1,isMuted:false})]));
    s.onMuteChanged({ userId:'h', isMuted:true, seatNumber:null });
    expect(s.getParticipant('h').seatNumber).toBeNull();
    expect(s.getParticipant('h').isMuted).toBe(true);
  });

  test('mute_changed without seatNumber does NOT clear seat', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('sp','SPEAKER',{seatNumber:4,isMuted:false})]));
    s.onMuteChanged({ userId:'sp', isMuted:true });
    expect(s.getParticipant('sp').seatNumber).toBe(4);
    expect(s.getParticipant('sp').isMuted).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// 16 — Backend source: all required emits present
// ═══════════════════════════════════════════════
describe('S16 — Backend source: all required emits verified', () => {
  test('leaveRoom emits voice:user_left to room', () => {
    expect(extractFn(src,'leaveRoom','endRoom')).toMatch(/voice:user_left/);
  });

  test('leaveRoom clears seatNumber in DB', () => {
    expect(extractFn(src,'leaveRoom','endRoom')).toMatch(/seatNumber.*null|null.*seatNumber/);
  });

  test('promoteParticipant emits voice:role_changed with seatNumber:null for AUDIENCE', () => {
    const fn = extractFn(src,'promoteParticipant','kickParticipant');
    expect(fn).toMatch(/voice:role_changed/);
    expect(fn).toMatch(/seatNumber.*null/);
  });

  test('promoteParticipant emits voice:your_role_changed to personal channel', () => {
    const fn = extractFn(src,'promoteParticipant','kickParticipant');
    expect(fn).toMatch(/voice:your_role_changed/);
    expect(fn).toMatch(/user:\$\{targetUserId\}/);
  });

  test('raiseHand emits voice:hand_raised', () => {
    expect(queueSrc).toMatch(/voice:hand_raised/);
  });

  test('backend emits voice:mute_changed', () => {
    expect(src).toMatch(/voice:mute_changed/);
  });

  test('backend emits voice:stage_state after seat changes', () => {
    expect(src).toMatch(/voice:stage_state/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 17 — Initial join: stage_state arrives before listeners are ready
// ═══════════════════════════════════════════════════════════════════════
describe('S17 — Initial join: stage_state before listeners (buffer + upsert)', () => {
  // Helper: run onStageState with the upsert logic (mirrors the updated
  // useVoiceRoom.ts onStageState implementation).
  function onStageStateWithUpsert(store, data) {
    const room = store.get().activeRoom;
    if (!room) return;
    // Update pass
    data.stageParticipants.forEach(sp => {
      store.updateParticipant(sp.userId, {
        role: sp.role,
        isMuted: sp.isMuted,
        isPinned: sp.isPinned,
        handRaised: sp.handRaised,
        mutedByModerator: sp.mutedByModerator,
        seatNumber: sp.seatNumber,
      });
    });
    // Upsert pass — add participants absent from the store
    const currentParticipants = store.get().activeRoom?.participants ?? [];
    data.stageParticipants.forEach(sp => {
      const alreadyInStore = currentParticipants.some(p => p.userId === sp.userId);
      if (!alreadyInStore) {
        store.addParticipant({
          id:               sp.userId,
          userId:           sp.userId,
          role:             sp.role,
          isMuted:          sp.isMuted,
          mutedByModerator: sp.mutedByModerator,
          handRaised:       sp.handRaised,
          handRaisedAt:     null,
          joinedAt:         typeof sp.joinedAt === 'string' ? sp.joinedAt : new Date().toISOString(),
          isActive:         true,
          isPinned:         sp.isPinned,
          seatNumber:       sp.seatNumber,
          user: {
            id:        sp.userId,
            firstName: sp.firstName ?? '',
            lastName:  sp.lastName  ?? '',
            avatarUrl: sp.avatarUrl ?? null,
          },
        });
      }
    });
  }

  test('(a) buffered snapshot applies correct seat numbers', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([
      makeP('a', 'HOST',    { seatNumber: 1, isMuted: false }),
      makeP('b', 'SPEAKER', { seatNumber: 2, isMuted: false }),
    ]));
    // Simulate a snapshot that arrived before listeners were ready, now drained
    const bufferedPayload = {
      roomId: 'room-1',
      stageCount: 2,
      stageParticipants: [
        { userId: 'a', role: 'HOST',    isMuted: false, seatNumber: 1,
          isPinned: false, handRaised: false, mutedByModerator: false,
          joinedAt: new Date().toISOString() },
        { userId: 'b', role: 'SPEAKER', isMuted: false, seatNumber: 3,
          isPinned: false, handRaised: false, mutedByModerator: false,
          joinedAt: new Date().toISOString() },
      ],
    };
    onStageStateWithUpsert(s, bufferedPayload);
    expect(s.getParticipant('a').seatNumber).toBe(1);
    // Buffered snapshot corrects b's seat from 2 to 3
    expect(s.getParticipant('b').seatNumber).toBe(3);
  });

  test('(b) onStageState upserts participant absent from store (addParticipant called)', () => {
    const s = makeStore();
    // Store has only 'a' — 'b' was missed due to race
    s.setActiveRoom(makeRoom([makeP('a', 'HOST', { seatNumber: 1, isMuted: false })]));
    const payload = {
      roomId: 'room-1',
      stageCount: 2,
      stageParticipants: [
        { userId: 'a', role: 'HOST',    isMuted: false, seatNumber: 1,
          isPinned: false, handRaised: false, mutedByModerator: false,
          joinedAt: new Date().toISOString(), firstName: 'Alice', lastName: 'A', avatarUrl: null },
        { userId: 'b', role: 'SPEAKER', isMuted: false, seatNumber: 2,
          isPinned: false, handRaised: false, mutedByModerator: false,
          joinedAt: new Date().toISOString(), firstName: 'Bob', lastName: 'B', avatarUrl: null },
      ],
    };
    onStageStateWithUpsert(s, payload);
    // 'b' must now be in the store with correct seat and profile
    const b = s.getParticipant('b');
    expect(b).not.toBeNull();
    expect(b.seatNumber).toBe(2);
    expect(b.role).toBe('SPEAKER');
    expect(b.user.firstName).toBe('Bob');
    expect(b.isActive).toBe(true);
  });

  test('(c) stageRows query in joinRoom contains u.firstName (enriched JOIN present)', () => {
    const joinFn = extractFn(src, 'joinRoom', 'leaveRoom');
    // The FIX-JOIN-STAGE block must LEFT JOIN users and select u.firstName
    expect(joinFn).toMatch(/LEFT JOIN users u/i);
    expect(joinFn).toMatch(/u\.firstName/);
    expect(joinFn).toMatch(/u\.lastName/);
    expect(joinFn).toMatch(/u\.avatarUrl/);
  });

  test('(d) stageRows.map in joinRoom emits firstName/lastName/avatarUrl fields', () => {
    const joinFn = extractFn(src, 'joinRoom', 'leaveRoom');
    // The map() after the FIX-JOIN-STAGE stageRows query must include the profile fields
    expect(joinFn).toMatch(/firstName\s*:/);
    expect(joinFn).toMatch(/lastName\s*:/);
    expect(joinFn).toMatch(/avatarUrl\s*:/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 18 — GET /stage-state authorization contract (source-analysis, no DB)
// ═══════════════════════════════════════════════════════════════════════
describe('S18 — GET /stage-state authorization contract', () => {
  const VOICE_ROUTES = path.join(__dirname, '../routes/voice.routes.js');
  const routesSrc = fs.readFileSync(VOICE_ROUTES, 'utf8');

  test('(a) voice.routes.js registers GET /:id/stage-state route', () => {
    expect(routesSrc).toMatch(/router\.get\(['"`][^'"`]*stage-state['"`]/);
  });

  test('(b) stage-state route appears after router.use(authenticate)', () => {
    const authIdx  = routesSrc.indexOf('router.use(authenticate)');
    const routeIdx = routesSrc.indexOf('stage-state');
    expect(authIdx).toBeGreaterThan(-1);
    expect(routeIdx).toBeGreaterThan(-1);
    // Route must be defined after the authenticate middleware is mounted
    // so all requests to /:id/stage-state go through JWT verification.
    expect(authIdx).toBeLessThan(routeIdx);
  });

  test('(c) getStageState in controller checks participant.isActive', () => {
    const fn = extractFn(src, 'getStageState', null);
    // Must verify the caller has an active VoiceParticipant record
    expect(fn).toMatch(/participant\.isActive/);
    // Must return 403 for unauthorized callers
    expect(fn).toMatch(/403/);
  });

  test('(d) getStageState returns stageParticipants with firstName/lastName/avatarUrl', () => {
    const fn = extractFn(src, 'getStageState', null);
    expect(fn).toMatch(/firstName/);
    expect(fn).toMatch(/lastName/);
    expect(fn).toMatch(/avatarUrl/);
  });

  test('(e) getStageState uses LEFT JOIN users for profile enrichment', () => {
    const fn = extractFn(src, 'getStageState', null);
    expect(fn).toMatch(/LEFT JOIN users u/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 19 — Backend event ordering: subscribe-before-emit contract
// ═══════════════════════════════════════════════════════════════════════
describe('S19 — Backend event ordering: socketsJoin before stage_state', () => {
  test('(a) socketsJoin appears before voice:stage_state emit in joinRoom source', () => {
    const joinFn = extractFn(src, 'joinRoom', 'leaveRoom');
    const socketsJoinIdx = joinFn.indexOf('socketsJoin');
    const stageStateIdx  = joinFn.indexOf("emit('voice:stage_state'");
    expect(socketsJoinIdx).toBeGreaterThan(-1);
    expect(stageStateIdx).toBeGreaterThan(-1);
    // socketsJoin must appear before the stage_state emit so the client is
    // subscribed to the socket room before the snapshot is delivered.
    expect(socketsJoinIdx).toBeLessThan(stageStateIdx);
  });

  test('(b) stage_state in joinRoom is emitted to user:${userId} (personal channel, not room-wide)', () => {
    const joinFn = extractFn(src, 'joinRoom', 'leaveRoom');
    // The FIX-JOIN-STAGE emission must target the personal user channel,
    // not the room-wide voice:${roomId} channel.
    expect(joinFn).toMatch(/user:\$\{userId\}.*emit\('voice:stage_state'/s);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// S17 — Mobile parity regression tests (added by audit gap-fix pass)
// Verifies that the mobile voice screen handles all required socket events
// that were identified as missing or incorrect in the VC audit.
// All tests are pure source-analysis — no DB, Redis, or Socket.IO required.
// ─────────────────────────────────────────────────────────────────────────────

describe('S17: Mobile parity — voice:admin_transferred handled (VC-MOB-001 fix)', () => {
  test('mobile registers voice:admin_transferred listener', () => {
    expect(mobileSrc).toMatch(/voice:admin_transferred/);
  });

  test('mobile handler updates newHostId participant to HOST role', () => {
    const idx = mobileSrc.indexOf("voice:admin_transferred");
    const block = mobileSrc.slice(idx, idx + 800);
    expect(block).toMatch(/newHostId/);
    expect(block).toMatch(/HOST/);
  });

  test('mobile handler updates prevHostId participant to MODERATOR role', () => {
    const idx = mobileSrc.indexOf("voice:admin_transferred");
    const block = mobileSrc.slice(idx, idx + 800);
    expect(block).toMatch(/prevHostId/);
    expect(block).toMatch(/MODERATOR/);
  });

  test('mobile cleanup block removes voice:admin_transferred listener', () => {
    // Find the return () => { cleanup block
    const cleanupIdx = mobileSrc.lastIndexOf("socket.off('voice:you_are_host')");
    const cleanupBlock = mobileSrc.slice(cleanupIdx, cleanupIdx + 400);
    expect(cleanupBlock).toMatch(/voice:admin_transferred/);
  });
});

describe('S17: Mobile parity — voice:speaker_pinned updates isPinned (VC-MOB-002 fix)', () => {
  test('mobile voice:speaker_pinned handler sets isPinned on the target participant', () => {
    const idx = mobileSrc.indexOf("voice:speaker_pinned");
    const block = mobileSrc.slice(idx, idx + 400);
    expect(block).toMatch(/isPinned/);
  });

  test('mobile voice:speaker_pinned clears isPinned on all other participants when pinning', () => {
    const idx = mobileSrc.indexOf("voice:speaker_pinned");
    const block = mobileSrc.slice(idx, idx + 400);
    // When d.isPinned is true, all other participants must have isPinned:false
    expect(block).toMatch(/isPinned.*false|false.*isPinned/);
  });

  test('Participant interface includes isPinned field', () => {
    expect(mobileSrc).toMatch(/isPinned\s*:\s*boolean/);
  });
});

describe('S17: Mobile parity — voice:room_deleted and voice:message_deleted handled (VC-SYNC-005/006 fix)', () => {
  test('mobile registers voice:room_deleted listener', () => {
    expect(mobileSrc).toMatch(/voice:room_deleted/);
  });

  test('mobile voice:room_deleted disconnects LiveKit and navigates back', () => {
    const idx = mobileSrc.indexOf("voice:room_deleted");
    const block = mobileSrc.slice(idx, idx + 300);
    expect(block).toMatch(/lk\.disconnect|disconnect/);
    expect(block).toMatch(/router\.back|back()/);
  });

  test('mobile registers voice:message_deleted listener', () => {
    expect(mobileSrc).toMatch(/voice:message_deleted/);
  });

  test('mobile voice:message_deleted filters the message out of chat state', () => {
    const idx = mobileSrc.indexOf("voice:message_deleted");
    const block = mobileSrc.slice(idx, idx + 200);
    expect(block).toMatch(/filter|msgId/);
  });

  test('mobile cleanup block removes voice:room_deleted listener', () => {
    const cleanupIdx = mobileSrc.lastIndexOf('socket.off(');
    const cleanupBlock = mobileSrc.slice(
      mobileSrc.lastIndexOf("socket.off('voice:blocked_from_room')"),
      mobileSrc.indexOf('socket.off(\'voice:reaction\'')
    );
    expect(cleanupBlock).toMatch(/voice:room_deleted/);
    expect(cleanupBlock).toMatch(/voice:message_deleted/);
  });
});

describe('S17: Mobile socket dep array — [id] only prevents double-listener registration (VC-CONC-006 fix)', () => {
  test('socket useEffect dependency array is [id] not [id, user]', () => {
    // The dep array immediately follows the eslint-disable comment
    expect(mobileSrc).not.toMatch(/\}, \[id, user\]/);
    expect(mobileSrc).toMatch(/\}, \[id\]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 regression tests — realtime defect fixes (BUG-001 through BUG-011)
// All tests are pure source-analysis. No DB, Redis, Socket.IO, or LiveKit.
// ─────────────────────────────────────────────────────────────────────────────

// ─── BUG-001: Mobile voice:kicked self-eviction ───────────────────────────────
describe('BUG-001: Mobile voice:kicked — roomId-only guard (personal channel)', () => {
  test('onKicked handler does NOT check d.userId — uses d.roomId only', () => {
    const idx = mobileSrc.indexOf('const onKicked');
    const handler = mobileSrc.slice(idx, idx + 600);
    // Must NOT contain the old d.userId === user?.id check
    expect(handler).not.toMatch(/d\.userId\s*===\s*user/);
  });

  test('onKicked self-eviction fires when roomId matches', () => {
    const idx = mobileSrc.indexOf('const onKicked');
    const handler = mobileSrc.slice(idx, idx + 600);
    expect(handler).toMatch(/d\.roomId\s*!==\s*id/);
    expect(handler).toMatch(/router\.back/);
  });

  test('onKicked type signature accepts roomId-only payload (userId optional)', () => {
    const idx = mobileSrc.indexOf('const onKicked');
    const handler = mobileSrc.slice(idx, idx + 200);
    expect(handler).toMatch(/userId\?|roomId: string/);
  });

  test('web onKicked does not check d.userId either — baseline parity', () => {
    const idx = hookSrc.indexOf('const onKicked');
    const handler = hookSrc.slice(idx, idx + 400);
    expect(handler).not.toMatch(/d\.userId\s*===\s*user/);
    expect(handler).toMatch(/data\.roomId\s*!==\s*roomId/);
  });
});

// ─── BUG-002: Mobile duplicate voice:moderator_removed handler ────────────────
describe('BUG-002: Mobile voice:moderator_removed — single consolidated handler', () => {
  test('exactly one socket.on(voice:moderator_removed) registration in mobile', () => {
    const matches = [...mobileSrc.matchAll(/socket\.on\('voice:moderator_removed'/g)];
    expect(matches).toHaveLength(1);
  });

  test('onModeratorRemoved clears seatNumber, isMuted, role, and handRaised', () => {
    const idx = mobileSrc.indexOf('const onModeratorRemoved');
    // Use 1200-char window to ensure the full handler body is captured
    const handler = mobileSrc.slice(idx, idx + 1200);
    expect(handler).toMatch(/role.*AUDIENCE|AUDIENCE.*role/);
    expect(handler).toMatch(/isMuted.*true/);
    expect(handler).toMatch(/seatNumber.*null/);
    expect(handler).toMatch(/handRaised.*false/);
  });

  test('onModeratorRemoved shows personal notification only to affected user', () => {
    const idx = mobileSrc.indexOf('const onModeratorRemoved');
    const handler = mobileSrc.slice(idx, idx + 1200);
    expect(handler).toMatch(/d\.userId\s*===\s*user/);
  });

  test('moderator removal only changes the target participant', () => {
    const idx = mobileSrc.indexOf('const onModeratorRemoved');
    const handler = mobileSrc.slice(idx, idx + 1200);
    expect(handler).toMatch(/p\.id\s*===\s*d\.userId/);
    // Non-target participants returned unchanged: `: p`
    expect(handler).toMatch(/:\s*p\b/);
  });
});

// ─── BUG-003: autoPromote.js voice:stage_state full-room contract ─────────────
describe('BUG-003: autoPromote.js voice:stage_state — full-room snapshot with user names', () => {
  const AUTOPROMOTE_PATH = path.join(__dirname, '../utils/autoPromote.js');
  const autoSrc = fs.readFileSync(AUTOPROMOTE_PATH, 'utf8');

  test('autoPromote does NOT filter by seatNumber IS NOT NULL in stage_state query', () => {
    const emitIdx = autoSrc.indexOf("emit('voice:stage_state'");
    const queryBlock = autoSrc.slice(Math.max(0, emitIdx - 500), emitIdx);
    expect(queryBlock).not.toMatch(/seatNumber IS NOT NULL/);
  });

  test('autoPromote LEFT JOINs users table for profile fields', () => {
    expect(autoSrc).toMatch(/LEFT JOIN users u ON u\.id = vp\.userId/);
  });

  test('autoPromote selects u.firstName, u.lastName, u.avatarUrl', () => {
    const joinIdx = autoSrc.indexOf('LEFT JOIN users u ON u.id = vp.userId');
    const selectBlock = autoSrc.slice(Math.max(0, joinIdx - 400), joinIdx + 50);
    expect(selectBlock).toMatch(/u\.firstName/);
    expect(selectBlock).toMatch(/u\.lastName/);
    expect(selectBlock).toMatch(/u\.avatarUrl/);
  });

  test('autoPromote orders by role ASC, joinedAt ASC (not seatNumber)', () => {
    const emitIdx = autoSrc.indexOf("emit('voice:stage_state'");
    const queryBlock = autoSrc.slice(Math.max(0, emitIdx - 500), emitIdx);
    expect(queryBlock).toMatch(/ORDER BY vp\.role ASC/);
    expect(queryBlock).not.toMatch(/ORDER BY vp\.seatNumber/);
  });

  test('autoPromote maps seatNumber null-safe', () => {
    const emitIdx = autoSrc.indexOf("emit('voice:stage_state'");
    const mapBlock = autoSrc.slice(emitIdx, emitIdx + 600);
    expect(mapBlock).toMatch(/seatNumber.*!=.*null.*Number|Number.*seatNumber.*null/);
    expect(mapBlock).not.toMatch(/seatNumber:\s*Number\(r\.seatNumber\)/);
  });

  test('autoPromote payload includes firstName, lastName, avatarUrl with null fallback', () => {
    const emitIdx = autoSrc.indexOf("emit('voice:stage_state'");
    const mapBlock = autoSrc.slice(emitIdx, emitIdx + 600);
    expect(mapBlock).toMatch(/firstName.*r\.firstName|r\.firstName.*null/);
    expect(mapBlock).toMatch(/lastName.*r\.lastName|r\.lastName.*null/);
    expect(mapBlock).toMatch(/avatarUrl.*r\.avatarUrl|r\.avatarUrl.*null/);
  });
});

// ─── BUG-004: voice-queue.controller.js _promoteUser profile fields ───────────
describe('BUG-004: voice-queue _promoteUser — full-room snapshot with user names', () => {
  test('_promoteUser stage_state does NOT filter by seatNumber IS NOT NULL', () => {
    const emitIdx = queueSrc.indexOf("emit('voice:stage_state'");
    const queryBlock = queueSrc.slice(Math.max(0, emitIdx - 600), emitIdx);
    expect(queryBlock).not.toMatch(/seatNumber IS NOT NULL/);
  });

  test('_promoteUser LEFT JOINs users table', () => {
    const emitIdx = queueSrc.indexOf("emit('voice:stage_state'");
    const block = queueSrc.slice(Math.max(0, emitIdx - 600), emitIdx + 200);
    expect(block).toMatch(/LEFT JOIN users u ON u\.id = vp\.userId/);
  });

  test('_promoteUser selects and maps u.firstName', () => {
    const emitIdx = queueSrc.indexOf("emit('voice:stage_state'");
    const block = queueSrc.slice(Math.max(0, emitIdx - 600), emitIdx + 600);
    expect(block).toMatch(/u\.firstName/);
    expect(block).toMatch(/firstName.*r\.firstName|r\.firstName.*null/);
  });
});

// ─── BUG-005: Web onStageState stale-seat sweep ───────────────────────────────
describe('BUG-005: Web onStageState — stale-seat sweep for absent participants', () => {
  test('onStageState has a snapshotIds set for the sweep', () => {
    const stageIdx = hookSrc.indexOf('const onStageState');
    const handlerBlock = hookSrc.slice(stageIdx, stageIdx + 7000); // window enlarged for GAP-W2 profile fill additions
    expect(handlerBlock).toMatch(/snapshotIds/);
  });

  test('stale-seat sweep only fires when snapshot has content (length > 0 guard)', () => {
    const stageIdx = hookSrc.indexOf('const onStageState');
    const handlerBlock = hookSrc.slice(stageIdx, stageIdx + 7000); // window enlarged for GAP-W2 profile fill additions
    expect(handlerBlock).toMatch(/stageParticipants\.length\s*>\s*0/);
  });

  test('stale-seat sweep clears seatNumber to null for absent participants', () => {
    const stageIdx = hookSrc.indexOf('const onStageState');
    const handlerBlock = hookSrc.slice(stageIdx, stageIdx + 7000); // window enlarged for GAP-W2 profile fill additions
    // Sweep exists and sets seatNumber: null
    expect(handlerBlock).toMatch(/snapshotIds/);
    expect(handlerBlock).toMatch(/seatNumber.*null/);
    // updateParticipant is called in the sweep (may be on a separate line)
    expect(handlerBlock).toMatch(/updateParticipant/);
  });

  test('stale-seat sweep uses seatNumber-only clear (NOT removeParticipant) to avoid stale-snapshot regression', () => {
    const stageIdx = hookSrc.indexOf('const onStageState');
    const handlerBlock = hookSrc.slice(stageIdx, stageIdx + 6000);
    // GAP-W1/W4 FIX (updated): onStageState now has two branches:
    //  1. isVersionedAndFresh branch — safe to call removeParticipant (F-008 prevented by version guard)
    //  2. Fallback (stale/unversioned) branch — seatNumber-only sweep, NO removeParticipant
    // This test verifies the fallback branch still uses seatNumber:null (not removeParticipant).
    expect(handlerBlock).toMatch(/seatNumber.*null/);
    expect(handlerBlock).toMatch(/updateParticipant/);
    // The fallback/else branch must appear and must use seatNumber:null sweep
    expect(handlerBlock).toMatch(/Fallback[\s\S]{0,400}seatNumber:\s*null/);
    // The isVersionedAndFresh condition must gate the removeParticipant call
    expect(handlerBlock).toMatch(/isVersionedAndFresh[\s\S]{0,400}removeParticipant/);
  });

  test('stale-seat sweep does NOT change participant role (only seatNumber cleared)', () => {
    // Find the sweep block specifically — after 'snapshotIds' set is created
    const sweepStart = hookSrc.indexOf('snapshotIds');
    const sweepBlock = hookSrc.slice(sweepStart, sweepStart + 700);
    // The updateParticipant in the sweep only sets seatNumber, not role
    // Verify: no role: AUDIENCE assignment in the sweep section
    const updateCall = sweepBlock.slice(sweepBlock.indexOf('updateParticipant'));
    expect(updateCall.slice(0, 200)).not.toMatch(/role.*AUDIENCE/);
  });

  test('FIX-L002-revised: mobile applyStageSnapshot clears seatNumber only (NOT filter) to avoid stale-snapshot regression', () => {
    expect(mobileSrc).toMatch(/inStageIds/);
    // L002-revised: mobile applyStageSnapshot clears seatNumber for absent
    // stage participants (NOT filtering them out) because stale voice:stage_state
    // socket events can arrive out of order and would incorrectly remove newer
    // joiners (F-008). Departed-participant removal happens on navigate-away/return.
    const applyIdx = mobileSrc.indexOf('const applyStageSnapshot');
    expect(applyIdx).toBeGreaterThan(-1);
    const applySnippet = mobileSrc.slice(applyIdx, applyIdx + 1500);
    // Must clear seatNumber for absent stage participants
    expect(applySnippet).toMatch(/seatNumber.*null/);
    // Must NOT filter out participants (stale-snapshot safe)
    expect(applySnippet).not.toMatch(/\.filter\s*\(\s*p\s*=>\s*inStageIds\.has\s*\(\s*p\.id\s*\)\s*\)/);
  });
});

// ─── BUG-008: Mobile voice:moderator_assigned isMuted sync ───────────────────
describe('BUG-008: Mobile moderator assignment — isMuted:false set immediately', () => {
  test('mobile voice:moderator_assigned explicitly handles isMuted from event payload (DEF-D contract)', () => {
    // DEF-D contract: moderator assignment must read isMuted from the event payload
    // (d.isMuted) and explicitly set isMuted in the returned participant object.
    // It must NOT unconditionally force isMuted:false — that was the BUG-008 regression.
    // Use a 900-char window to capture the full return-object body including the ternary.
    const idx = mobileSrc.indexOf("voice:moderator_assigned");
    const handler = mobileSrc.slice(idx, idx + 900);
    // 1. Handler reads isMuted from the event payload (d.isMuted)
    expect(handler).toMatch(/d\.isMuted/);
    // 2. isMuted is explicitly set in the returned participant object
    expect(handler).toMatch(/isMuted\s*:/);
    // 3. No unconditional isMuted:false assignment (BUG-008 regression guard)
    expect(handler).not.toMatch(/isMuted\s*:\s*false[^?]/);
  });

  test('mobile moderator_assigned sets role MODERATOR', () => {
    const idx = mobileSrc.indexOf("voice:moderator_assigned");
    const handler = mobileSrc.slice(idx, idx + 600);
    expect(handler).toMatch(/MODERATOR/);
  });

  test('web onModeratorAssigned also sets isMuted:false — parity baseline', () => {
    const idx = hookSrc.indexOf('const onModeratorAssigned');
    const handler = hookSrc.slice(idx, idx + 300);
    expect(handler).toMatch(/isMuted.*false/);
  });
});

// ─── BUG-011: Web dropMic optimistic seat clear ───────────────────────────────
describe('BUG-011: Web dropMic — optimistic update clears seatNumber immediately', () => {
  test('HOST/MOD branch clears seatNumber:null in optimistic update', () => {
    const dropMicIdx = hookSrc.indexOf('const dropMic');
    const handler = hookSrc.slice(dropMicIdx, dropMicIdx + 2000);
    // Extract the isHostOrMod=true branch (before else)
    const elseIdx = handler.indexOf('} else {');
    const hostModBranch = handler.slice(0, elseIdx);
    expect(hostModBranch).toMatch(/seatNumber.*null/);
  });

  test('SPEAKER→AUDIENCE branch clears seatNumber:null in optimistic update', () => {
    const dropMicIdx = hookSrc.indexOf('const dropMic');
    const handler = hookSrc.slice(dropMicIdx, dropMicIdx + 2000);
    const elseIdx = handler.indexOf('} else {');
    const elseBranch = handler.slice(elseIdx);
    expect(elseBranch).toMatch(/seatNumber.*null/);
  });

  test('dropMic rollback on error includes role and isMuted', () => {
    const dropMicIdx = hookSrc.indexOf('const dropMic');
    // Use a 2500-char window to include the catch block
    const handler = hookSrc.slice(dropMicIdx, dropMicIdx + 2500);
    expect(handler).toMatch(/myParticipant\.role/);
    // isMuted rollback: restores myParticipant.isMuted
    expect(handler).toMatch(/myParticipant\.isMuted/);
  });

  test('dropMic HOST/MOD optimistic update does not set role to AUDIENCE', () => {
    const dropMicIdx = hookSrc.indexOf('const dropMic');
    const handler = hookSrc.slice(dropMicIdx, dropMicIdx + 2000);
    const elseIdx = handler.indexOf('} else {');
    const hostModBranch = handler.slice(0, elseIdx);
    // HOST/MOD path must only set isMuted and seatNumber, not change role to AUDIENCE
    // Strip comments first to avoid matching comment text
    const codeOnly = hostModBranch.replace(/\/\/[^\n]*/g, '');
    expect(codeOnly).not.toMatch(/role.*AUDIENCE/);
  });
});


// ═══════════════════════════════════════════════════════════════════════
// S20 — F-001: joinRoom always invalidates cache even when room is LIVE
// ═══════════════════════════════════════════════════════════════════════
describe('S20 — F-001: joinRoom always invalidates room cache', () => {
  test('invalidateRoomCache is called in joinRoom post-transaction block', () => {
    const fn = extractFn(src, 'joinRoom', 'leaveRoom');
    // F-001 FIX: invalidateRoomCache must be called unconditionally after the
    // transaction, not only inside syncRoomStatus (which skips it for LIVE rooms).
    expect(fn).toMatch(/invalidateRoomCache/);
  });

  test('invalidateRoomCache call in joinRoom is outside syncRoomStatus', () => {
    const fn = extractFn(src, 'joinRoom', 'leaveRoom');
    // The call to invalidateRoomCache must appear AFTER syncRoomStatus in the
    // post-transaction block — not just inside syncRoomStatus itself.
    const syncIdx      = fn.indexOf('syncRoomStatus(');
    const invalidateIdx = fn.indexOf('invalidateRoomCache(', syncIdx);
    expect(syncIdx).toBeGreaterThan(-1);
    expect(invalidateIdx).toBeGreaterThan(syncIdx);
  });

  test('invalidateRoomCache is imported at top of controller', () => {
    expect(src).toMatch(/require\(['"]\.\.\/utils\/voiceRoomCache['"]\)/);
    expect(src).toMatch(/invalidateRoomCache/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// S21 — F-003: socketsJoin is awaited before emits in joinRoom
// ═══════════════════════════════════════════════════════════════════════
describe('S21 — F-003: socketsJoin awaited before voice:user_joined and voice:stage_state', () => {
  test('await socketsJoin appears before voice:user_joined in joinRoom', () => {
    const fn = extractFn(src, 'joinRoom', 'leaveRoom');
    const awaitSockIdx    = fn.indexOf('await io');
    const userJoinedIdx   = fn.indexOf("emit('voice:user_joined'");
    expect(awaitSockIdx).toBeGreaterThan(-1);
    expect(awaitSockIdx).toBeLessThan(userJoinedIdx);
  });

  test('await socketsJoin appears before voice:stage_state in joinRoom', () => {
    const fn = extractFn(src, 'joinRoom', 'leaveRoom');
    const awaitSockIdx  = fn.indexOf('await io');
    const stageStateIdx = fn.indexOf("emit('voice:stage_state'");
    expect(awaitSockIdx).toBeGreaterThan(-1);
    expect(awaitSockIdx).toBeLessThan(stageStateIdx);
  });

  test('await socketsJoin appears before voice:member_joined in joinRoom', () => {
    const fn = extractFn(src, 'joinRoom', 'leaveRoom');
    const awaitSockIdx    = fn.indexOf('await io');
    const memberJoinedIdx = fn.indexOf("emit('voice:member_joined'");
    expect(awaitSockIdx).toBeGreaterThan(-1);
    expect(awaitSockIdx).toBeLessThan(memberJoinedIdx);
  });

  test('socketsJoin call uses await keyword (not fire-and-forget)', () => {
    const fn = extractFn(src, 'joinRoom', 'leaveRoom');
    // The await must precede io.in(...).socketsJoin on the same logical expression.
    expect(fn).toMatch(/await\s+io\.in\(`user:\$\{userId\}`\)\.socketsJoin\(`voice:\$\{roomId\}`\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// S22 — F-004: createRoom socketsJoins the host
// ═══════════════════════════════════════════════════════════════════════
describe('S22 — F-004: createRoom socketsJoin host into voice room', () => {
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

  test('createRoom socketsJoin happens before voice:room_created emit', () => {
    const fn = extractFn(src, 'createRoom', 'joinRoom');
    const socketsJoinIdx = fn.indexOf('socketsJoin');
    const roomCreatedIdx = fn.indexOf("emit('voice:room_created'");
    expect(socketsJoinIdx).toBeGreaterThan(-1);
    expect(roomCreatedIdx).toBeGreaterThan(-1);
    expect(socketsJoinIdx).toBeLessThan(roomCreatedIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// S23 — F-006: mobile onUserJoined has roomId guard
// ═══════════════════════════════════════════════════════════════════════
describe('S23 — F-006: mobile onUserJoined ignores wrong roomId', () => {
  test('mobile onUserJoined has roomId guard', () => {
    if (!mobileSrc) { return; }
    const idx = mobileSrc.indexOf('const onUserJoined = (d: any) => {');
    expect(idx).toBeGreaterThan(-1);
    // Guard must appear early in the handler — within 300 chars
    const handler = mobileSrc.slice(idx, idx + 300);
    expect(handler).toMatch(/d\.roomId !== id/);
  });

  test('mobile onUserJoined guard precedes any state mutation', () => {
    if (!mobileSrc) { return; }
    const idx = mobileSrc.indexOf('const onUserJoined = (d: any) => {');
    // Use 1200 chars — the guard + comment block + newP construction puts
    // setParticipants at roughly offset 900 from the function start.
    const handler = mobileSrc.slice(idx, idx + 1200);
    const guardIdx       = handler.indexOf('d.roomId !== id');
    const setParticipants = handler.indexOf('setParticipants');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(setParticipants).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(setParticipants);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// S24 — F-005: web hook retries when socket is null at mount
// ═══════════════════════════════════════════════════════════════════════
describe('S24 — F-005: web useVoiceRoom retries when socket null at mount', () => {
  test('hook imports useState', () => {
    expect(hookSrc).toMatch(/useState/);
  });

  test('hook has socketReady state variable', () => {
    expect(hookSrc).toMatch(/socketReady/);
  });

  test('main listener effect dep array includes socketReady', () => {
    // The main socket listener useEffect must depend on socketReady so it
    // re-runs when the polling effect flips it from false to true.
    expect(hookSrc).toMatch(/\[roomId,\s*socketReady\]/);
  });

  test('hook polls for socket when null', () => {
    // Should have a setInterval-based polling loop that calls setSocketReady(true)
    expect(hookSrc).toMatch(/setSocketReady\(true\)/);
    expect(hookSrc).toMatch(/setInterval/);
  });

  test('polling effect dep array includes roomId and socketReady', () => {
    expect(hookSrc).toMatch(/\[roomId,\s*socketReady\]/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// S25 — F-009: voice:speaker_pinned cleanup is present
// ═══════════════════════════════════════════════════════════════════════
describe('S25 — F-009: voice:speaker_pinned has matching cleanup', () => {
  test('voice:speaker_pinned is registered with socket.on', () => {
    expect(hookSrc).toMatch(/socket\.on\('voice:speaker_pinned'/);
  });

  test('voice:speaker_pinned is removed with socket.off in cleanup', () => {
    expect(hookSrc).toMatch(/socket\.off\('voice:speaker_pinned',\s*onSpeakerPinned\)/);
  });

  test('socket.off for voice:speaker_pinned appears after the return () => { cleanup marker', () => {
    // Verify the off() is inside the cleanup block, not before it
    const returnCleanupIdx = hookSrc.lastIndexOf('return () => {');
    const offIdx = hookSrc.lastIndexOf("socket.off('voice:speaker_pinned', onSpeakerPinned)");
    expect(returnCleanupIdx).toBeGreaterThan(-1);
    expect(offIdx).toBeGreaterThan(returnCleanupIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// S26 — addParticipant from voice:user_joined while store is mounted
// ═══════════════════════════════════════════════════════════════════════
describe('S26 — addParticipant handles voice:user_joined while already mounted', () => {
  test('addParticipant while activeRoom is non-null adds participant', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('host', 'HOST', { seatNumber: 1, isMuted: false })]));
    // Simulate voice:user_joined for a new audience member
    s.addParticipant(makeP('newuser', 'AUDIENCE', { seatNumber: null }));
    const participants = s.getActiveParticipants();
    expect(participants).toHaveLength(2);
    expect(s.getParticipant('newuser')).toBeTruthy();
    expect(s.getParticipant('newuser').role).toBe('AUDIENCE');
  });

  test('addParticipant while activeRoom is null is a no-op (null guard)', () => {
    const s = makeStore();
    // activeRoom is null — addParticipant must silently do nothing
    s.addParticipant(makeP('newuser', 'AUDIENCE'));
    expect(s.get().activeRoom).toBeNull();
  });

  test('addParticipant duplicate userId updates rather than duplicates', () => {
    const s = makeStore();
    s.setActiveRoom(makeRoom([makeP('a', 'AUDIENCE', { isActive: false })]));
    s.addParticipant(makeP('a', 'AUDIENCE', { isActive: true, seatNumber: null }));
    expect(s.get().activeRoom.participants).toHaveLength(1);
    expect(s.get().activeRoom.participants[0].isActive).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// S27 — Snapshot after newer incremental event does not drop new joiner
// ═══════════════════════════════════════════════════════════════════════
describe('S27 — stage_state snapshot does not drop newer joiners', () => {
  // This tests the F-008 concern: an older stage_state snapshot must not
  // erase a participant that arrived via a newer voice:user_joined event.
  // Our onStageState only clears seatNumber for absent participants — it
  // does NOT remove participants from the list entirely. So a stale snapshot
  // cannot drop a newly-joined audience member.

  test('onStageState only clears seatNumber for absent participants — does not remove them', () => {
    const s = makeStore();
    // host + newUser are both active in the room
    s.setActiveRoom(makeRoom([
      makeP('host', 'HOST', { seatNumber: 1, isMuted: false }),
      makeP('newuser', 'AUDIENCE', { seatNumber: null }),
    ]));
    // Older stage_state only includes host (newuser joined after snapshot was taken)
    s.onStageState({
      roomId: 'room-1',
      stageCount: 1,
      stageParticipants: [
        { userId: 'host', role: 'HOST', isMuted: false, seatNumber: 1,
          isPinned: false, handRaised: false, mutedByModerator: false },
      ],
    });
    // newuser must still be in the list — only their seatNumber is cleared (already null)
    expect(s.get().activeRoom.participants).toHaveLength(2);
    expect(s.getParticipant('newuser')).toBeTruthy();
  });

  test('newer addParticipant after stale snapshot survives correctly', () => {
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
    // Then newer voice:user_joined arrives for the new participant
    s.addParticipant(makeP('newuser', 'AUDIENCE', { seatNumber: null }));
    expect(s.getActiveParticipants()).toHaveLength(2);
    expect(s.getParticipant('newuser')).toBeTruthy();
  });
});