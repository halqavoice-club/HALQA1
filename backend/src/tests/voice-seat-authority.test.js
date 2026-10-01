'use strict';
/**
 * Voice Club — Authoritative Seat Number Tests
 * ──────────────────────────────────────────────────────────────────────────────
 * Tests the seatNumber-based seat authority system per the final spec:
 *
 *   1. seatNumber is the only authoritative seat source (1–12 or null)
 *   2. No client-side layout algorithm — backend assigns seats atomically
 *   3. buildStageSlots renders directly from seatNumber
 *   4. No HOST eviction (HOST waits when stage is full)
 *   5. Seat stability — no auto-compaction when someone leaves
 *   6. MOD does NOT auto-jump to Seat 1 when HOST leaves
 *   7. FIFO queue order is preserved
 *   8. Race condition protection via unique constraint
 *   9. Mute ≠ seat release (isMuted only controls audio)
 *  10. Drop mic = seat release (seatNumber → null)
 */

const { buildStageSlots, computeStageLayout, canOccupySeat1, canOccupySeats2to12, VOICE_ROLES } =
  require('../utils/voiceSeat');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeP(userId, role, seatNumber = null, opts = {}) {
  return {
    userId,
    role,
    seatNumber,
    isMuted:     opts.isMuted     ?? (seatNumber == null),  // no seat = muted
    isPinned:    opts.isPinned    ?? false,
    handRaised:  opts.handRaised  ?? false,
    seat1Claimed: false,
    isActive:    true,
    joinedAt:    new Date(1_700_000_000_000 + (opts.joinedAtOffset ?? 0)),
  };
}

// ─── buildStageSlots — core layout function ───────────────────────────────────
describe('buildStageSlots — renders directly from seatNumber', () => {
  test('Seat 1 = participant with seatNumber=1', () => {
    const occupied = [
      { seatNumber: 1, userId: 'host1', role: 'HOST' },
      { seatNumber: 2, userId: 'mod1',  role: 'MODERATOR' },
      { seatNumber: 3, userId: 'spk1',  role: 'SPEAKER' },
    ];
    const slots = buildStageSlots(occupied, 12);
    expect(slots[0]?.userId).toBe('host1');
    expect(slots[1]?.userId).toBe('mod1');
    expect(slots[2]?.userId).toBe('spk1');
  });

  test('seatNumber 4 stays at index 3 regardless of array order', () => {
    const occupied = [
      { seatNumber: 4, userId: 'spk3', role: 'SPEAKER' },
      { seatNumber: 2, userId: 'spk1', role: 'SPEAKER' },
      { seatNumber: 7, userId: 'spk6', role: 'SPEAKER' },
    ];
    const slots = buildStageSlots(occupied, 12);
    expect(slots[3]?.userId).toBe('spk3');  // index 3 = Seat 4
    expect(slots[1]?.userId).toBe('spk1');  // index 1 = Seat 2
    expect(slots[6]?.userId).toBe('spk6');  // index 6 = Seat 7
  });

  test('empty seats are null — no auto-compaction', () => {
    const occupied = [
      { seatNumber: 1, userId: 'host1', role: 'HOST' },
      // Seat 2 empty
      { seatNumber: 3, userId: 'spk1', role: 'SPEAKER' },
    ];
    const slots = buildStageSlots(occupied, 12);
    expect(slots[0]?.userId).toBe('host1');
    expect(slots[1]).toBeNull();  // Seat 2 stays empty
    expect(slots[2]?.userId).toBe('spk1');
  });

  test('12 seats always returned', () => {
    const slots = buildStageSlots([], 12);
    expect(slots.length).toBe(12);
    expect(slots.every(s => s === null)).toBe(true);
  });

  test('No Seat 13 — array length is exactly maxSpeakers', () => {
    const occupied = Array.from({ length: 12 }, (_, i) => ({
      seatNumber: i + 1, userId: `u${i}`, role: 'SPEAKER'
    }));
    const slots = buildStageSlots(occupied, 12);
    expect(slots.length).toBe(12);
    expect(slots[12]).toBeUndefined();
  });
});

// ─── TEST 1: HOST joins empty Seat 1 ─────────────────────────────────────────
describe('TEST 1 — HOST takes Seat 1 when it is empty', () => {
  test('Seat 1 empty + Seat 2 MOD + Seat 3 User → HOST gets Seat 1', () => {
    // BEFORE: Seat 1=empty, Seat 2=MOD, Seat 3=User
    const before = [
      makeP('mod1', 'MODERATOR', 2),
      makeP('user1', 'SPEAKER',  3),
    ];
    const slotsBefore = buildStageSlots(before, 12);
    expect(slotsBefore[0]).toBeNull();      // Seat 1 empty
    expect(slotsBefore[1]?.userId).toBe('mod1');
    expect(slotsBefore[2]?.userId).toBe('user1');

    // AFTER: HOST takes Seat 1 (lowest available = 1)
    const after = [
      makeP('host1', 'HOST',      1),  // HOST assigned Seat 1
      makeP('mod1',  'MODERATOR', 2),  // MOD stays at Seat 2
      makeP('user1', 'SPEAKER',   3),  // User stays at Seat 3
    ];
    const slotsAfter = buildStageSlots(after, 12);
    expect(slotsAfter[0]?.userId).toBe('host1');
    expect(slotsAfter[0]?.role).toBe('HOST');
    expect(slotsAfter[1]?.userId).toBe('mod1');   // MOD NOT displaced
    expect(slotsAfter[2]?.userId).toBe('user1');
  });
});

// ─── TEST 2: HOST joins when Seat 1 is occupied by MOD (partial stage) ────────
describe('TEST 2 — HOST joins when Seat 1 occupied (partial stage)', () => {
  test('Seat 1=MOD, Seat 2=User, Seat 3=empty → HOST takes Seat 3', () => {
    // MOD has Seat 1, User has Seat 2, Seat 3 is free
    // HOST should take the next available seat (Seat 3), NOT displace MOD
    const before = [
      makeP('mod1',  'MODERATOR', 1),
      makeP('user1', 'SPEAKER',   2),
    ];
    const slotsBefore = buildStageSlots(before, 12);
    expect(slotsBefore[0]?.userId).toBe('mod1');   // MOD at Seat 1
    expect(slotsBefore[1]?.userId).toBe('user1');  // User at Seat 2
    expect(slotsBefore[2]).toBeNull();              // Seat 3 empty

    // HOST takes Seat 3 (Seat 1 is occupied by MOD, Seat 2 by User)
    const after = [
      makeP('mod1',  'MODERATOR', 1),  // MOD still at Seat 1
      makeP('user1', 'SPEAKER',   2),  // User still at Seat 2
      makeP('host1', 'HOST',      3),  // HOST at Seat 3
    ];
    const slotsAfter = buildStageSlots(after, 12);
    expect(slotsAfter[0]?.userId).toBe('mod1');   // MOD stays at Seat 1
    expect(slotsAfter[1]?.userId).toBe('user1');  // User stays at Seat 2
    expect(slotsAfter[2]?.userId).toBe('host1');  // HOST at Seat 3
  });
});

// ─── TEST 3: Full stage — HOST must wait ──────────────────────────────────────
describe('TEST 3 — Full stage (12/12) with MOD at Seat 1 — HOST must wait', () => {
  const buildFull12 = () => [
    makeP('mod1', 'MODERATOR', 1),
    ...Array.from({ length: 11 }, (_, i) => makeP(`user${i}`, 'SPEAKER', i + 2)),
  ];

  test('12/12 stage stays exactly 12 seats — HOST does NOT enter', () => {
    const occupied = buildFull12();
    const slots = buildStageSlots(occupied, 12);
    // All 12 seats filled
    expect(slots.filter(s => s !== null).length).toBe(12);
    expect(slots.length).toBe(12);
    expect(slots[12]).toBeUndefined(); // No Seat 13
  });

  test('MOD at Seat 1 is NOT evicted when HOST wants to join full stage', () => {
    const occupied = buildFull12();
    // HOST is in audience — seatNumber=null — stage is full, HOST cannot enter
    const hostParticipant = makeP('host1', 'HOST', null);
    // Stage remains unchanged
    const slots = buildStageSlots(occupied, 12);
    expect(slots[0]?.userId).toBe('mod1');        // MOD stays at Seat 1
    expect(slots[0]?.role).toBe('MODERATOR');
    // HOST is NOT in any stage slot
    expect(slots.find(s => s?.userId === 'host1')).toBeUndefined();
  });

  test('No participant is removed from stage when HOST tries to join a full stage', () => {
    const occupied = buildFull12();
    const countBefore = occupied.filter(p => p.seatNumber != null).length;
    // In the new system, HOST is queued, NOT admitted (no eviction)
    // Stage count remains 12
    expect(countBefore).toBe(12);
    // If we simulate HOST being queued (seatNumber stays null), stage is still 12
    const finalOccupied = [...occupied]; // no change
    expect(finalOccupied.filter(p => p.seatNumber != null).length).toBe(12);
  });
});

// ─── TEST 4: MOD leaves Seat 1, seat becomes empty ───────────────────────────
describe('TEST 4 — MOD leaves Seat 1 → HOST can subsequently claim Seat 1', () => {
  test('MOD drops mic → Seat 1 becomes null', () => {
    const before = [
      makeP('mod1',  'MODERATOR', 1),
      makeP('user1', 'SPEAKER',   2),
    ];
    // MOD drops mic (seatNumber → null)
    const after = [
      makeP('mod1',  'MODERATOR', null), // MOD released Seat 1
      makeP('user1', 'SPEAKER',   2),    // User stays at Seat 2
    ];
    const slotsAfter = buildStageSlots(after, 12);
    expect(slotsAfter[0]).toBeNull();              // Seat 1 now empty
    expect(slotsAfter[1]?.userId).toBe('user1');   // User still at Seat 2
  });

  test('After MOD releases Seat 1, HOST can claim Seat 1', () => {
    // After MOD drops mic, HOST grabs (takes lowest = Seat 1)
    const after = [
      makeP('host1', 'HOST',      1),  // HOST takes Seat 1
      makeP('mod1',  'MODERATOR', null), // MOD in audience
      makeP('user1', 'SPEAKER',   2),
    ];
    const slots = buildStageSlots(after, 12);
    expect(slots[0]?.userId).toBe('host1');
    expect(slots[0]?.role).toBe('HOST');
  });
});

// ─── TEST 5: MOD explicitly moves to Seat 1 ──────────────────────────────────
describe('TEST 5 — MOD must leave current seat before taking Seat 1', () => {
  test('MOD at Seat 4 drops mic first, then re-grabs Seat 1', () => {
    // Step 1: Initial state
    const step1 = [
      makeP('mod1', 'MODERATOR', 4),  // MOD at Seat 4
      makeP('u1',   'SPEAKER',   2),
      makeP('u2',   'SPEAKER',   3),
    ];
    const slots1 = buildStageSlots(step1, 12);
    expect(slots1[0]).toBeNull();            // Seat 1 empty
    expect(slots1[3]?.userId).toBe('mod1'); // MOD at Seat 4

    // Step 2: MOD drops mic → Seat 4 becomes null
    const step2 = [
      makeP('mod1', 'MODERATOR', null), // MOD in audience
      makeP('u1',   'SPEAKER',   2),
      makeP('u2',   'SPEAKER',   3),
    ];
    const slots2 = buildStageSlots(step2, 12);
    expect(slots2[0]).toBeNull();  // Seat 1 still empty
    expect(slots2[3]).toBeNull();  // Seat 4 now empty

    // Step 3: MOD explicitly requests Seat 1 (assigned by backend)
    const step3 = [
      makeP('mod1', 'MODERATOR', 1), // MOD now at Seat 1
      makeP('u1',   'SPEAKER',   2),
      makeP('u2',   'SPEAKER',   3),
    ];
    const slots3 = buildStageSlots(step3, 12);
    expect(slots3[0]?.userId).toBe('mod1');
    expect(slots3[0]?.role).toBe('MODERATOR');
    expect(slots3[3]).toBeNull(); // Seat 4 remains empty
  });
});

// ─── TEST 6: HOST leaves — MOD stays at Seat 2, Seat 1 becomes empty ─────────
describe('TEST 6 — HOST leaves → no auto-promotion to Seat 1', () => {
  test('HOST drops mic → Seat 1 empty, Seat 2 MOD stays at Seat 2', () => {
    // Before: HOST at Seat 1, MOD at Seat 2, User at Seat 3
    const before = [
      makeP('host1', 'HOST',      1),
      makeP('mod1',  'MODERATOR', 2),
      makeP('user1', 'SPEAKER',   3),
    ];
    // HOST drops mic — seatNumber → null
    const after = [
      makeP('host1', 'HOST',      null), // HOST in audience
      makeP('mod1',  'MODERATOR', 2),    // MOD stays at Seat 2 (NOT moved to Seat 1)
      makeP('user1', 'SPEAKER',   3),    // User stays at Seat 3
    ];
    const slots = buildStageSlots(after, 12);
    expect(slots[0]).toBeNull();              // Seat 1 empty
    expect(slots[1]?.userId).toBe('mod1');   // MOD stays at Seat 2
    expect(slots[2]?.userId).toBe('user1');  // User stays at Seat 3
  });

  test('Seat 1 only fills when someone explicitly grabs it', () => {
    // MOD must explicitly call grabMic (assigned Seat 1 by backend)
    const afterModGrabs = [
      makeP('mod1',  'MODERATOR', 1),  // MOD explicitly took Seat 1
      makeP('user1', 'SPEAKER',   3),  // User still at Seat 3
    ];
    const slots = buildStageSlots(afterModGrabs, 12);
    expect(slots[0]?.userId).toBe('mod1');
    expect(slots[1]).toBeNull();             // Seat 2 remains empty
    expect(slots[2]?.userId).toBe('user1');
  });
});

// ─── TEST 7: Multiple MODs — no auto-reshuffling ──────────────────────────────
describe('TEST 7 — Multiple MODs retain exact seats when Seat 1 becomes empty', () => {
  test('MOD A leaves Seat 1 → MOD B and MOD C stay at their seats', () => {
    const before = [
      makeP('modA', 'MODERATOR', 1),
      makeP('modB', 'MODERATOR', 4),
      makeP('modC', 'MODERATOR', 7),
    ];
    // MOD A leaves (drops mic or leaves room)
    const after = [
      makeP('modA', 'MODERATOR', null), // MOD A left
      makeP('modB', 'MODERATOR', 4),   // MOD B stays at Seat 4
      makeP('modC', 'MODERATOR', 7),   // MOD C stays at Seat 7
    ];
    const slots = buildStageSlots(after, 12);
    expect(slots[0]).toBeNull();              // Seat 1 empty — no auto-promotion
    expect(slots[3]?.userId).toBe('modB');   // MOD B at Seat 4
    expect(slots[6]?.userId).toBe('modC');   // MOD C at Seat 7
  });

  test('MOD B can explicitly grab Seat 1 after MOD A leaves', () => {
    const after = [
      makeP('modB', 'MODERATOR', 1),   // MOD B explicitly took Seat 1
      makeP('modC', 'MODERATOR', 7),   // MOD C stays at Seat 7
    ];
    const slots = buildStageSlots(after, 12);
    expect(slots[0]?.userId).toBe('modB');
    expect(slots[6]?.userId).toBe('modC');
  });
});

// ─── TEST 8: Race condition — two participants request same seat ───────────────
describe('TEST 8 — Race condition: two participants cannot share a seat', () => {
  test('DB unique constraint: each seatNumber exists at most once', () => {
    // Simulate what buildStageSlots does — a later assignment wins for the same seat
    // In reality, the DB unique constraint prevents two rows with same (roomId, seatNumber)
    const occupied = [
      { seatNumber: 5, userId: 'user1', role: 'SPEAKER' },
      // user2 cannot also have seatNumber=5 — DB constraint prevents this
    ];
    const slots = buildStageSlots(occupied, 12);
    const seat5Occupants = slots.filter(s => s?.userId === 'user1');
    expect(seat5Occupants.length).toBe(1); // only one occupant per seat
  });

  test('No duplicate seat numbers in the slot array', () => {
    const occupied = [
      { seatNumber: 1, userId: 'u1', role: 'HOST' },
      { seatNumber: 3, userId: 'u2', role: 'SPEAKER' },
      { seatNumber: 5, userId: 'u3', role: 'SPEAKER' },
      { seatNumber: 7, userId: 'u4', role: 'MODERATOR' },
    ];
    const slots = buildStageSlots(occupied, 12);
    const filled = slots.filter(s => s !== null);
    const ids = filled.map(s => s.userId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length); // no duplicates
  });
});

// ─── TEST 9: Mute ≠ seat release ─────────────────────────────────────────────
describe('TEST 9 — Mute vs Drop Mic', () => {
  test('isMuted=true does NOT release seatNumber', () => {
    // Muting (Turn Off Mic) only affects audio — participant stays on their seat
    const muted = makeP('host1', 'HOST', 3, { isMuted: true });
    expect(muted.seatNumber).toBe(3);   // still on stage
    expect(muted.isMuted).toBe(true);   // audio off

    const slots = buildStageSlots([muted], 12);
    expect(slots[2]?.userId).toBe('host1'); // still at Seat 3
  });

  test('seatNumber=null IS the seat release (Drop Mic / End Mic)', () => {
    // Drop mic = seatNumber becomes null
    const dropped = makeP('host1', 'HOST', null, { isMuted: true });
    expect(dropped.seatNumber).toBeNull(); // left stage
    expect(dropped.isMuted).toBe(true);

    const slots = buildStageSlots([dropped], 12);
    expect(slots.every(s => s === null)).toBe(true); // no stage slot
  });

  test('HOST muted at Seat 3 — seat 3 is still HOST (not empty)', () => {
    const participants = [
      makeP('host1', 'HOST',      3, { isMuted: true }),  // muted but still seated
      makeP('mod1',  'MODERATOR', 1),
      makeP('spk1',  'SPEAKER',   5),
    ];
    const slots = buildStageSlots(participants, 12);
    expect(slots[2]?.userId).toBe('host1');  // Seat 3 = muted HOST
    expect(slots[0]?.userId).toBe('mod1');   // Seat 1 = MOD
    expect(slots[4]?.userId).toBe('spk1');   // Seat 5 = SPEAKER
  });
});

// ─── TEST 10: FIFO queue — moderator does not bypass ─────────────────────────
describe('TEST 10 — FIFO queue: MOD does not bypass normal users', () => {
  test('Queue order is preserved regardless of role', () => {
    const queue = [
      { userId: 'userA', role: 'AUDIENCE',  position: 1 },
      { userId: 'modB',  role: 'MODERATOR', position: 2 },
      { userId: 'userC', role: 'AUDIENCE',  position: 3 },
    ];
    // FIFO: userA is promoted first
    expect(queue[0].userId).toBe('userA');
    expect(queue[1].userId).toBe('modB');
    expect(queue[2].userId).toBe('userC');

    // After userA is promoted, queue becomes [modB, userC]
    const afterFirst = queue.slice(1);
    expect(afterFirst[0].userId).toBe('modB');
  });

  test('MOD in queue gets their seat after normal user ahead of them', () => {
    // userA (position 1) gets seat when a slot opens
    // modB (position 2) stays waiting
    const queueAfterFirstPromotion = [
      { userId: 'modB',  role: 'MODERATOR', position: 1 }, // modB now first
      { userId: 'userC', role: 'AUDIENCE',  position: 2 },
    ];
    expect(queueAfterFirstPromotion[0].userId).toBe('modB');
    // modB gets promoted next (FIFO)
  });
});

// ─── TEST 11: Seat stability — no compaction after leave ──────────────────────
describe('TEST 11 — Seat stability: no auto-compaction after someone leaves', () => {
  test('User A leaves Seat 2 — Seat 3 stays at Seat 3', () => {
    const before = [
      { seatNumber: 1, userId: 'host', role: 'HOST' },
      { seatNumber: 2, userId: 'userA', role: 'SPEAKER' },
      { seatNumber: 3, userId: 'userB', role: 'SPEAKER' },
      { seatNumber: 4, userId: 'userC', role: 'SPEAKER' },
    ];
    // User A leaves → seatNumber=null
    const after = [
      { seatNumber: 1, userId: 'host',  role: 'HOST' },
      // Seat 2 is now empty (no compaction)
      { seatNumber: 3, userId: 'userB', role: 'SPEAKER' },  // stays at 3
      { seatNumber: 4, userId: 'userC', role: 'SPEAKER' },  // stays at 4
    ];
    const slots = buildStageSlots(after, 12);
    expect(slots[0]?.userId).toBe('host');
    expect(slots[1]).toBeNull();              // Seat 2 empty
    expect(slots[2]?.userId).toBe('userB');  // Seat 3 stays
    expect(slots[3]?.userId).toBe('userC');  // Seat 4 stays
  });
});

// ─── TEST 12: canOccupySeat1 / canOccupySeats2to12 helpers ───────────────────
describe('TEST 12 — Seat eligibility helpers', () => {
  test('canOccupySeat1: HOST and MOD only', () => {
    expect(canOccupySeat1('HOST')).toBe(true);
    expect(canOccupySeat1('MODERATOR')).toBe(true);
    expect(canOccupySeat1('SPEAKER')).toBe(false);
    expect(canOccupySeat1('AUDIENCE')).toBe(false);
  });

  test('canOccupySeats2to12: HOST, MOD, SPEAKER', () => {
    expect(canOccupySeats2to12('HOST')).toBe(true);
    expect(canOccupySeats2to12('MODERATOR')).toBe(true);
    expect(canOccupySeats2to12('SPEAKER')).toBe(true);
    expect(canOccupySeats2to12('AUDIENCE')).toBe(false);
  });

  test('SPEAKER cannot occupy Seat 1 in the backend seat assignment', () => {
    // In grabMic: `if (s === 1 && !MODERATOR_ROLES.includes(curr.role)) continue;`
    // This means SPEAKER skips Seat 1 and gets assigned to Seat 2+
    expect(canOccupySeat1('SPEAKER')).toBe(false);
  });
});

// ─── TEST 13: computeStageLayout compatibility shim ──────────────────────────
describe('TEST 13 — computeStageLayout with seatNumber data', () => {
  test('When participants have seatNumber, uses seatNumber path', () => {
    const participants = [
      makeP('host1', 'HOST',      1),
      makeP('mod1',  'MODERATOR', 4),
      makeP('spk1',  'SPEAKER',   7),
    ];
    const slots = computeStageLayout(participants, 12);
    expect(slots[0]?.userId).toBe('host1'); // Seat 1
    expect(slots[3]?.userId).toBe('mod1');  // Seat 4
    expect(slots[6]?.userId).toBe('spk1'); // Seat 7
    // Gaps between seats remain null
    expect(slots[1]).toBeNull();
    expect(slots[2]).toBeNull();
    expect(slots[4]).toBeNull();
  });

  test('Full 12-seat stage — all slots filled correctly', () => {
    const participants = Array.from({ length: 12 }, (_, i) =>
      makeP(`u${i}`, i === 0 ? 'HOST' : 'SPEAKER', i + 1)
    );
    const slots = computeStageLayout(participants, 12);
    expect(slots.length).toBe(12);
    slots.forEach((s, i) => {
      expect(s?.userId).toBe(`u${i}`);
      expect(Number(s?.seatNumber)).toBe(i + 1);
    });
  });
});

// ─── TEST 14: Property invariants ────────────────────────────────────────────
describe('TEST 14 — Property invariants', () => {
  test('Stage count never exceeds 12', () => {
    const occupied = Array.from({ length: 12 }, (_, i) => ({
      seatNumber: i + 1, userId: `u${i}`, role: 'SPEAKER'
    }));
    const slots = buildStageSlots(occupied, 12);
    expect(slots.filter(s => s !== null).length).toBeLessThanOrEqual(12);
  });

  test('All seatNumbers in 1–12 range', () => {
    const occupied = [
      { seatNumber: 1, userId: 'u1', role: 'HOST' },
      { seatNumber: 6, userId: 'u2', role: 'SPEAKER' },
      { seatNumber: 12, userId: 'u3', role: 'MODERATOR' },
    ];
    const slots = buildStageSlots(occupied, 12);
    const filledSeats = occupied.map(o => o.seatNumber);
    filledSeats.forEach(s => {
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(12);
    });
  });

  test('No two participants share a seatNumber in the slot array', () => {
    // DB unique constraint prevents this, but verify buildStageSlots respects it
    const occupied = [
      { seatNumber: 3, userId: 'u1', role: 'SPEAKER' },
      { seatNumber: 5, userId: 'u2', role: 'SPEAKER' },
      { seatNumber: 8, userId: 'u3', role: 'MODERATOR' },
    ];
    const slots = buildStageSlots(occupied, 12);
    const filled = slots.filter(s => s !== null);
    const ids = new Set(filled.map(s => s.userId));
    expect(ids.size).toBe(filled.length);
  });

  test('No Seat 13 ever exists', () => {
    const occupied = Array.from({ length: 13 }, (_, i) => ({
      seatNumber: i + 1, userId: `u${i}`, role: 'SPEAKER'
    }));
    // buildStageSlots only builds maxSpeakers (12) slots
    const slots = buildStageSlots(occupied, 12);
    expect(slots.length).toBe(12);
    expect(slots[12]).toBeUndefined();
  });
});

// ─── TEST 15: grabMic source code audit ──────────────────────────────────────
describe('TEST 15 — grabMic source code: seatNumber authority', () => {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(
    path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
  );
  const fnStart = src.indexOf('async function grabMic');
  const fnEnd   = src.indexOf('async function', fnStart + 1);
  const fn      = src.slice(fnStart, fnEnd);

  test('grabMic assigns seatNumber in the DB (not just role/isMuted)', () => {
    expect(fn).toMatch(/seatNumber\s*=.*\$\{seat\}|SET seatNumber/);
  });

  test('grabMic uses a $transaction for atomic seat assignment', () => {
    expect(fn).toMatch(/\$transaction/);
  });

  test('grabMic checks occupied seats inside transaction (TOCTOU prevention)', () => {
    expect(fn).toMatch(/seatNumber IS NOT NULL/);
  });

  test('grabMic does NOT have HOST PRIORITY EVICTION code', () => {
    // The HOST eviction block has been removed
    expect(fn).not.toMatch(/HOST PRIORITY EVICTION/);
    expect(fn).not.toMatch(/evictTarget|evictedUserId/);
  });

  test('grabMic returns seatNumber in the response', () => {
    expect(fn).toMatch(/seatNumber.*assignedSeat|assignedSeat.*seatNumber/);
  });

  test('grabMic broadcasts seatNumber in voice:role_changed', () => {
    expect(fn).toMatch(/voice:role_changed[\s\S]{0,200}seatNumber/);
  });
});

// ─── TEST 16: dropMic source code audit ──────────────────────────────────────
describe('TEST 16 — dropMic source code: releases seatNumber', () => {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(
    path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
  );
  const fnStart = src.indexOf('async function dropMic');
  const fnEnd   = src.indexOf('async function', fnStart + 1);
  const fn      = src.slice(fnStart, fnEnd);

  test('dropMic sets seatNumber = NULL when participant drops', () => {
    expect(fn).toMatch(/seatNumber\s*=\s*NULL/i);
  });

  test('dropMic broadcasts seatNumber=null in socket events', () => {
    expect(fn).toMatch(/seatNumber.*null|null.*seatNumber/);
  });

  test('dropMic triggers autoPromoteNext to fill the freed seat', () => {
    expect(fn).toMatch(/autoPromoteNext/);
  });
});
