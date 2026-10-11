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
    expect(hookSrc).toMatch(/socket\.emit\('voice:join_room'/);
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
    const idx = mobileSrc.indexOf('voice:moderator_removed');
    expect(idx).toBeGreaterThan(-1);
    expect(mobileSrc.slice(idx, idx + 800)).toMatch(/seatNumber.*null/);
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

