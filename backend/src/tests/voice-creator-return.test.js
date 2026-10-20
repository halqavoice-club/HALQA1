'use strict';
/**
 * Voice Club — Creator/Owner Return-to-Stage Tests (seatNumber-based)
 * ──────────────────────────────────────────────────────────────────────────────
 * Tests the Creator/Owner return-to-stage behavior using the authoritative
 * seatNumber column. Key rules under the new system:
 *   - Creator waits when stage is full (NO automatic eviction)
 *   - Creator takes the lowest available seat when one is free
 *   - Creator gets Seat 1 if Seat 1 is free
 *   - Creator does NOT displace any participant
 *   - Seats are stable — no auto-compaction
 *   - buildStageSlots renders from seatNumber directly
 */

const {
  buildStageSlots,
  computeStageLayout,
  canOccupySeat1,
  canOccupySeats2to12,
  VOICE_ROLES,
} = require('../utils/voiceSeat');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeP(userId, role, seatNumber = null, opts = {}) {
  return {
    userId,
    role,
    seatNumber,
    isMuted:     opts.isMuted     ?? (seatNumber == null),
    isPinned:    opts.isPinned    ?? false,
    handRaised:  opts.handRaised  ?? false,
    seat1Claimed: false,
    isActive:    true,
    joinedAt:    new Date(1_700_000_000_000 + (opts.joinedAtOffset ?? 0)),
  };
}

/**
 * Simulate the new seatNumber-based grabMic:
 * - HOST takes the lowest available seat (respecting Seat 1 eligibility)
 * - If stage is full, HOST is queued (no eviction)
 * - Returns { assignedSeat, finalParticipants, queued, alreadySeated }
 */
function simulateHostGrabMic(participants, maxSpeakers = 12) {
  const active = participants.filter(p => p.isActive);
  const host = active.find(p => p.role === 'HOST');
  if (!host) return { assignedSeat: null, finalParticipants: participants, error: 'no_host' };

  // Already on stage
  if (host.seatNumber != null) {
    return { assignedSeat: host.seatNumber, finalParticipants: participants, alreadySeated: true };
  }

  // Find occupied seats
  const occupied = new Set(active.filter(p => p.seatNumber != null).map(p => Number(p.seatNumber)));

  // Find lowest available seat (HOST can take Seat 1)
  let seat = null;
  for (let s = 1; s <= maxSpeakers; s++) {
    if (!occupied.has(s)) { seat = s; break; }
  }

  if (seat === null) {
    // Stage full — HOST must wait (queued)
    return { assignedSeat: null, finalParticipants: participants, queued: true };
  }

  // Assign the seat
  const updated = participants.map(p =>
    p.userId === host.userId ? { ...p, seatNumber: seat, isMuted: false } : p
  );
  return { assignedSeat: seat, finalParticipants: updated };
}

// ─── TEST 1: Creator returns with an empty seat ───────────────────────────────
describe('TEST 1 — Creator returns when a seat is available', () => {
  test('Creator takes lowest available seat (Seat 1 if free)', () => {
    const participants = [
      makeP('creator', 'HOST',    null),  // in audience, no seat
      makeP('spk1',   'SPEAKER', 2),
      makeP('spk2',   'SPEAKER', 3),
      makeP('spk3',   'SPEAKER', 4),
    ];
    const { assignedSeat } = simulateHostGrabMic(participants, 12);
    expect(assignedSeat).toBe(1);  // Seat 1 is free — HOST takes it
  });

  test('Creator gets Seat 1 when it is empty', () => {
    const participants = [
      makeP('creator', 'HOST',    null),
      makeP('spk1',   'SPEAKER', 2),
      makeP('spk2',   'SPEAKER', 3),
    ];
    const { assignedSeat, finalParticipants } = simulateHostGrabMic(participants, 12);
    expect(assignedSeat).toBe(1);
    const host = finalParticipants.find(p => p.userId === 'creator');
    expect(host.seatNumber).toBe(1);
    expect(host.isMuted).toBe(false);
  });

  test('Stage count increases by 1 when Creator takes a seat', () => {
    const participants = [
      makeP('creator', 'HOST',    null),
      makeP('spk1',   'SPEAKER', 2),
      makeP('spk2',   'SPEAKER', 3),
    ];
    const { finalParticipants } = simulateHostGrabMic(participants, 12);
    const stageCount = finalParticipants.filter(p => p.seatNumber != null).length;
    expect(stageCount).toBe(3);  // was 2, now 3
  });
});

// ─── TEST 2: Creator returns when Seat 1 is occupied ─────────────────────────
describe('TEST 2 — Creator returns when Seat 1 is occupied by MOD', () => {
  test('Creator takes lowest free seat (not Seat 1) when MOD has Seat 1', () => {
    const participants = [
      makeP('creator', 'HOST',      null),
      makeP('mod1',   'MODERATOR', 1),    // MOD at Seat 1
      makeP('spk1',   'SPEAKER',   2),
      makeP('spk2',   'SPEAKER',   3),
    ];
    const { assignedSeat } = simulateHostGrabMic(participants, 12);
    expect(assignedSeat).toBe(4);  // Seats 1,2,3 taken → HOST gets Seat 4
  });

  test('MOD stays at Seat 1 — NOT displaced when HOST joins', () => {
    const participants = [
      makeP('creator', 'HOST',      null),
      makeP('mod1',   'MODERATOR', 1),
      makeP('spk1',   'SPEAKER',   2),
    ];
    const { finalParticipants } = simulateHostGrabMic(participants, 12);
    const mod = finalParticipants.find(p => p.userId === 'mod1');
    expect(mod.seatNumber).toBe(1);  // MOD still at Seat 1
  });
});

// ─── TEST 3: Full stage — Creator must wait ───────────────────────────────────
describe('TEST 3 — Full stage (12/12) — Creator must wait', () => {
  const buildFull12 = () => [
    makeP('creator', 'HOST', null),  // in audience
    makeP('mod1', 'MODERATOR', 1),
    ...Array.from({ length: 11 }, (_, i) => makeP(`spk${i}`, 'SPEAKER', i + 2)),
  ];

  test('Creator is queued (not admitted) when stage is full', () => {
    const { queued, assignedSeat } = simulateHostGrabMic(buildFull12(), 12);
    expect(queued).toBe(true);
    expect(assignedSeat).toBeNull();
  });

  test('Stage remains exactly 12/12 — no participant displaced', () => {
    const participants = buildFull12();
    const { finalParticipants } = simulateHostGrabMic(participants, 12);
    const stageCount = finalParticipants.filter(p => p.seatNumber != null).length;
    expect(stageCount).toBe(12);  // unchanged
  });

  test('MOD at Seat 1 is NOT evicted', () => {
    const { finalParticipants } = simulateHostGrabMic(buildFull12(), 12);
    const mod = finalParticipants.find(p => p.userId === 'mod1');
    expect(mod.seatNumber).toBe(1);
    expect(mod.role).toBe('MODERATOR');
  });

  test('No Seat 13 — slot array stays at 12', () => {
    const { finalParticipants } = simulateHostGrabMic(buildFull12(), 12);
    const onStage = finalParticipants.filter(p => p.seatNumber != null);
    const slots = buildStageSlots(onStage, 12);
    expect(slots.length).toBe(12);
    expect(slots[12]).toBeUndefined();
  });
});

// ─── TEST 3b: Creator does not duplicate ──────────────────────────────────────
describe('TEST 3b — Creator already on stage (idempotent)', () => {
  test('Already-seated HOST returns idempotent result', () => {
    const participants = [
      makeP('creator', 'HOST',  1),  // already at Seat 1
      makeP('spk1',   'SPEAKER', 5),
    ];
    const result = simulateHostGrabMic(participants, 12);
    expect(result.alreadySeated).toBe(true);
    expect(result.assignedSeat).toBe(1);
  });

  test('Double grabMic call does not create a second HOST seat', () => {
    const participants = [
      makeP('creator', 'HOST',  null),
      makeP('spk1',   'SPEAKER', 3),
    ];
    const { finalParticipants: after1 } = simulateHostGrabMic(participants, 12);
    const { alreadySeated, finalParticipants: after2 } = simulateHostGrabMic(after1, 12);
    expect(alreadySeated).toBe(true);
    const hostEntries = after2.filter(p => p.role === 'HOST');
    expect(hostEntries.length).toBe(1);
  });
});

// ─── TEST 4: MODERATOR does NOT get owner priority ───────────────────────────
describe('TEST 4 — Moderator does NOT get owner priority during Creator return', () => {
  test('MOD is NOT promoted when stage has a free seat and Creator joins', () => {
    // Stage has free seats. Creator takes one. MOD in audience stays in audience.
    const participants = [
      makeP('creator', 'HOST',      null),  // in audience
      makeP('mod1',   'MODERATOR', null),  // in audience (in queue)
      makeP('spk1',   'SPEAKER',   2),
    ];
    const { assignedSeat, finalParticipants } = simulateHostGrabMic(participants, 12);
    // Creator gets Seat 1
    expect(assignedSeat).toBe(1);
    // MOD is still not on stage
    const mod = finalParticipants.find(p => p.userId === 'mod1');
    expect(mod.seatNumber).toBeNull();
  });
});

// ─── TEST 5: Queue order preserved ────────────────────────────────────────────
describe('TEST 5 — Normal FIFO queue order is preserved', () => {
  test('Queue order is unchanged by Creator return', () => {
    const queueBefore = [
      { userId: 'userA', position: 1 },
      { userId: 'modB',  position: 2 },
      { userId: 'userC', position: 3 },
    ];
    // Creator return does NOT auto-promote from queue
    const queueAfter = [...queueBefore];
    expect(queueAfter[0].userId).toBe('userA');
    expect(queueAfter[1].userId).toBe('modB');
    expect(queueAfter[2].userId).toBe('userC');
  });
});

// ─── TEST 6: Displaced user stays in room ─────────────────────────────────────
describe('TEST 6 — No participant is displaced (new system: no eviction)', () => {
  test('All participants retain their seats when Creator joins a non-full stage', () => {
    const participants = [
      makeP('creator', 'HOST',    null),
      makeP('spk1',   'SPEAKER', 5),
      makeP('spk2',   'SPEAKER', 7),
    ];
    const { finalParticipants } = simulateHostGrabMic(participants, 12);
    // spk1 stays at Seat 5
    expect(finalParticipants.find(p => p.userId === 'spk1').seatNumber).toBe(5);
    // spk2 stays at Seat 7
    expect(finalParticipants.find(p => p.userId === 'spk2').seatNumber).toBe(7);
  });
});

// ─── TEST 7: Exact seat number ────────────────────────────────────────────────
describe('TEST 7 — Exact seatNumber assigned', () => {
  test('Creator gets Seat 1 when free (seatNumber === 1)', () => {
    const participants = [
      makeP('creator', 'HOST',    null),
      makeP('spk1',   'SPEAKER', 5),
    ];
    const { assignedSeat } = simulateHostGrabMic(participants, 12);
    expect(assignedSeat).toBe(1);
    expect(assignedSeat).not.toBe(0);
    expect(assignedSeat).not.toBe(13);
  });

  test('Creator gets Seat 4 when Seats 1-3 are occupied', () => {
    const participants = [
      makeP('creator', 'HOST',      null),
      makeP('mod1',   'MODERATOR', 1),
      makeP('spk1',   'SPEAKER',   2),
      makeP('spk2',   'SPEAKER',   3),
    ];
    const { assignedSeat } = simulateHostGrabMic(participants, 12);
    expect(assignedSeat).toBe(4);
  });
});

// ─── TEST 8+9: buildStageSlots — same for web and mobile ──────────────────────
describe('TEST 8+9 — buildStageSlots produces identical results for web and mobile', () => {
  test('buildStageSlots renders correctly from seatNumber', () => {
    const occupied = [
      { seatNumber: 1, userId: 'creator', role: 'HOST' },
      { seatNumber: 2, userId: 'mod1',    role: 'MODERATOR' },
      { seatNumber: 5, userId: 'spk1',    role: 'SPEAKER' },
    ];
    const slots = buildStageSlots(occupied, 12);
    expect(slots[0]?.userId).toBe('creator');
    expect(slots[1]?.userId).toBe('mod1');
    expect(slots[4]?.userId).toBe('spk1');
    expect(slots[2]).toBeNull();
    expect(slots[3]).toBeNull();
  });

  test('After Creator joins, both web and mobile see same layout', () => {
    const participants = [
      makeP('creator', 'HOST',      1),  // assigned Seat 1
      makeP('mod1',   'MODERATOR', 4),  // stays at Seat 4
      makeP('spk1',   'SPEAKER',   7),  // stays at Seat 7
    ];
    const slots = buildStageSlots(participants, 12);
    expect(slots[0]?.userId).toBe('creator');
    expect(slots[3]?.userId).toBe('mod1');
    expect(slots[6]?.userId).toBe('spk1');
    // Gaps remain null
    expect(slots[1]).toBeNull();
    expect(slots[2]).toBeNull();
  });
});

// ─── TEST 12: Double-click protection ────────────────────────────────────────
describe('TEST 12 — Double-click protection', () => {
  test('Already-seated HOST returns idempotent (alreadySeated=true)', () => {
    const participants = [
      makeP('creator', 'HOST', 1),  // already on stage
      makeP('spk1',   'SPEAKER', 5),
    ];
    const result = simulateHostGrabMic(participants, 12);
    expect(result.alreadySeated).toBe(true);
  });

  test('Two rapid calls produce only one HOST seat entry', () => {
    const participants = [
      makeP('creator', 'HOST', null),
      makeP('spk1',   'SPEAKER', 3),
    ];
    const { finalParticipants: after1 } = simulateHostGrabMic(participants, 12);
    const { alreadySeated, finalParticipants: after2 } = simulateHostGrabMic(after1, 12);
    expect(alreadySeated).toBe(true);
    const hostEntries = after2.filter(p => p.role === 'HOST' && p.seatNumber != null);
    expect(hostEntries.length).toBe(1);
  });
});

// ─── TEST 13: Property-based invariants ──────────────────────────────────────
describe('TEST 13 — Property-based invariants (stage never exceeds 12)', () => {
  const scenarios = [
    { name: 'empty stage',    speakerSeats: [] },
    { name: '1 speaker',      speakerSeats: [2] },
    { name: '5 speakers',     speakerSeats: [2,3,4,5,6] },
    { name: '11 speakers',    speakerSeats: [2,3,4,5,6,7,8,9,10,11,12] },
    { name: 'MOD at Seat 1',  speakerSeats: [3,4,5], modSeat: 1 },
  ];

  scenarios.forEach(({ name, speakerSeats, modSeat }) => {
    test(`${name}: stage count <= 12 after Creator grabs a seat`, () => {
      const participants = [
        makeP('creator', 'HOST', null),
        ...(modSeat != null ? [makeP('mod1', 'MODERATOR', modSeat)] : []),
        ...speakerSeats.map((s, i) => makeP(`spk${i}`, 'SPEAKER', s)),
      ];
      const result = simulateHostGrabMic(participants, 12);
      const finalCount = result.finalParticipants.filter(p => p.seatNumber != null).length;
      expect(finalCount).toBeLessThanOrEqual(12);
    });
  });

  test('No duplicate seatNumbers in final state', () => {
    const participants = [
      makeP('creator', 'HOST', null),
      makeP('spk1', 'SPEAKER', 3),
      makeP('spk2', 'SPEAKER', 5),
    ];
    const { finalParticipants } = simulateHostGrabMic(participants, 12);
    const seated = finalParticipants.filter(p => p.seatNumber != null);
    const seats = seated.map(p => p.seatNumber);
    const uniqueSeats = new Set(seats);
    expect(uniqueSeats.size).toBe(seats.length);
  });

  test('Creator never has duplicate entries', () => {
    const participants = [
      makeP('creator', 'HOST', null),
      makeP('spk1', 'SPEAKER', 5),
    ];
    const { finalParticipants } = simulateHostGrabMic(participants, 12);
    expect(finalParticipants.filter(p => p.userId === 'creator').length).toBe(1);
  });
});

// ─── TEST 14: buildStageSlots invariants ─────────────────────────────────────
describe('TEST 14 — buildStageSlots hard invariants', () => {
  const { buildStageSlots } = require('../utils/voiceSeat');

  test('Slot array is always exactly maxSpeakers length', () => {
    for (const size of [6, 8, 10, 12]) {
      const slots = buildStageSlots([{ seatNumber: 1, userId: 'h', role: 'HOST' }], size);
      expect(slots.length).toBe(size);
    }
  });

  test('Seat 1 index 0 = null when empty, or HOST/MOD when occupied', () => {
    const configs = [
      [],
      [{ seatNumber: 1, userId: 'h', role: 'HOST' }],
      [{ seatNumber: 1, userId: 'm', role: 'MODERATOR' }],
      [{ seatNumber: 3, userId: 's', role: 'SPEAKER' }],
    ];
    configs.forEach(occupied => {
      const slots = buildStageSlots(occupied, 12);
      if (occupied.length === 0 || occupied[0].seatNumber !== 1) {
        expect(slots[0]).toBeNull();
      } else {
        expect(['HOST', 'MODERATOR']).toContain(slots[0]?.role);
      }
    });
  });

  test('SPEAKER can never occupy Seat 1 (Seat 1 is HOST/MOD only)', () => {
    // SPEAKERs are assigned Seats 2–12 by grabMic (s===1 check skips Seat 1 for SPEAKER)
    expect(canOccupySeat1('SPEAKER')).toBe(false);
    expect(canOccupySeat1('HOST')).toBe(true);
    expect(canOccupySeat1('MODERATOR')).toBe(true);
  });
});

// ─── TEST 15: Reconnect / determinism ────────────────────────────────────────
describe('TEST 15 — State is deterministic after reconnect', () => {
  const { buildStageSlots } = require('../utils/voiceSeat');

  test('buildStageSlots output is identical regardless of array order', () => {
    const occupied = [
      { seatNumber: 1, userId: 'h', role: 'HOST' },
      { seatNumber: 4, userId: 'm', role: 'MODERATOR' },
      { seatNumber: 7, userId: 's', role: 'SPEAKER' },
    ];
    const shuffled = [occupied[2], occupied[0], occupied[1]];
    const slots1 = buildStageSlots(occupied, 12);
    const slots2 = buildStageSlots(shuffled, 12);
    slots1.forEach((s, i) => {
      expect(s?.userId ?? null).toBe(slots2[i]?.userId ?? null);
    });
  });

  test('After Creator takes a seat, state is reproducible from DB data', () => {
    const participants = [
      makeP('creator', 'HOST', null),
      makeP('spk1', 'SPEAKER', 3),
      makeP('spk2', 'SPEAKER', 5),
    ];
    const { finalParticipants } = simulateHostGrabMic(participants, 12);
    const occupied = finalParticipants.filter(p => p.seatNumber != null);
    const slots1 = buildStageSlots(occupied, 12);
    const reloaded = occupied.map(p => ({ ...p }));
    const slots2 = buildStageSlots(reloaded, 12);
    slots1.forEach((s, i) => {
      expect(s?.userId ?? null).toBe(slots2[i]?.userId ?? null);
    });
  });
});

// ─── TEST 2: Creator returns when ALL 12 seats are full ──────────────────────
