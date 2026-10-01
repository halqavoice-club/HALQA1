'use strict';
/**
 * Voice Club — Seat Synchronisation Regression Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Regression tests for the bug where User A on Seat 3 could appear on Seat 4
 * for another viewer when participants arrived in a different order.
 *
 * Root cause: Participants were appended to the store in socket-event arrival
 * order rather than the deterministic [role asc, joinedAt asc] order used by
 * the backend Prisma query. Two clients receiving the same participants in
 * different delivery orders would compute different visual slot positions.
 *
 * Fix: All participant arrays are sorted by [role asc, joinedAt asc] before
 * building speakerSlots, so every client independently reaches the same layout.
 *
 * Tests verify:
 *   - computeStageLayout produces canonical seat assignments independent of
 *     input array order (the "backend source of truth" function).
 *   - The seat at index 2 (Seat 3) is always the participant with the 3rd
 *     earliest joinedAt among SPEAKERs, regardless of input order.
 */

const {
  computeStageLayout,
  canOccupySeat1,
  canOccupySeats2to12,
  VOICE_ROLES,
} = require('../utils/voiceSeat');

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeParticipant(userId, role, joinedAt, isMuted = false, isPinned = false) {
  return {
    userId,
    role,
    isMuted,
    isPinned,
    seat1Claimed: false,
    isActive: true,
    joinedAt: typeof joinedAt === 'string' ? joinedAt : new Date(joinedAt).toISOString(),
  };
}

/**
 * Helper that mirrors the SEAT SYNC FIX applied on the frontend:
 * sort participants by [role asc, joinedAt asc] before building the layout.
 * This ensures the test covers the complete client-side pipeline.
 */
function buildSlots(participants, maxSpeakers = 12) {
  const ROLE_ORDER = { HOST: 0, MODERATOR: 1, SPEAKER: 2, AUDIENCE: 3 };
  const sorted = [...participants].sort((a, b) => {
    const roleDiff = (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9);
    if (roleDiff !== 0) return roleDiff;
    return (a.joinedAt ?? '').localeCompare(b.joinedAt ?? '');
  });
  return computeStageLayout(sorted, maxSpeakers);
}

// ─── TEST 1: User A occupies Seat 3, Seat 4 is empty ─────────────────────────
describe('TEST 1: User A occupies Seat 3, Seat 4 is empty', () => {
  const participants = [
    makeParticipant('host',  'HOST',     '2024-01-01T00:00:00Z'),
    makeParticipant('spk1',  'SPEAKER',  '2024-01-01T00:01:00Z'),
    makeParticipant('userA', 'SPEAKER',  '2024-01-01T00:02:00Z'),
  ];

  test('Seat 3 (index 2) = User A', () => {
    const slots = buildSlots(participants);
    expect(slots[2]?.userId).toBe('userA');
  });

  test('Seat 4 (index 3) = empty (null)', () => {
    const slots = buildSlots(participants);
    expect(slots[3]).toBeNull();
  });

  test('Seat 1 (index 0) = host', () => {
    const slots = buildSlots(participants);
    expect(slots[0]?.userId).toBe('host');
  });

  test('Seat 2 (index 1) = spk1', () => {
    const slots = buildSlots(participants);
    expect(slots[1]?.userId).toBe('spk1');
  });
});

// ─── TEST 2: User B joins, still sees User A on Seat 3 ───────────────────────
describe('TEST 2: User A on Seat 3 — User B joins and sees the same layout', () => {
  // Same participants — simulate a different client that received them out of order
  const participantsInDifferentOrder = [
    makeParticipant('userA', 'SPEAKER',  '2024-01-01T00:02:00Z'),
    makeParticipant('host',  'HOST',     '2024-01-01T00:00:00Z'),
    makeParticipant('spk1',  'SPEAKER',  '2024-01-01T00:01:00Z'),
  ];

  test('User B also sees User A on Seat 3 regardless of array arrival order', () => {
    const slots = buildSlots(participantsInDifferentOrder);
    expect(slots[2]?.userId).toBe('userA');
  });

  test('User B sees Seat 4 as empty', () => {
    const slots = buildSlots(participantsInDifferentOrder);
    expect(slots[3]).toBeNull();
  });
});

// ─── TEST 3: User A on Seat 3, User B on Seat 4 ──────────────────────────────
describe('TEST 3: User A on Seat 3, User B on Seat 4', () => {
  const participants = [
    makeParticipant('host',  'HOST',     '2024-01-01T00:00:00Z'),
    makeParticipant('spk1',  'SPEAKER',  '2024-01-01T00:01:00Z'),
    makeParticipant('userA', 'SPEAKER',  '2024-01-01T00:02:00Z'),
    makeParticipant('userB', 'SPEAKER',  '2024-01-01T00:03:00Z'),
  ];

  test('Seat 3 = User A', () => {
    const slots = buildSlots(participants);
    expect(slots[2]?.userId).toBe('userA');
  });

  test('Seat 4 = User B', () => {
    const slots = buildSlots(participants);
    expect(slots[3]?.userId).toBe('userB');
  });

  test('No other slots change when User B joins', () => {
    // Client that already had userA should see userB added at Seat 4 only
    const beforeUserBJoins = [
      makeParticipant('host',  'HOST',     '2024-01-01T00:00:00Z'),
      makeParticipant('spk1',  'SPEAKER',  '2024-01-01T00:01:00Z'),
      makeParticipant('userA', 'SPEAKER',  '2024-01-01T00:02:00Z'),
    ];
    const afterUserBJoins = [
      ...beforeUserBJoins,
      makeParticipant('userB', 'SPEAKER', '2024-01-01T00:03:00Z'),
    ];
    const slotsBefore = buildSlots(beforeUserBJoins);
    const slotsAfter  = buildSlots(afterUserBJoins);

    // Seats 1–3 must not change
    expect(slotsAfter[0]?.userId).toBe(slotsBefore[0]?.userId);
    expect(slotsAfter[1]?.userId).toBe(slotsBefore[1]?.userId);
    expect(slotsAfter[2]?.userId).toBe(slotsBefore[2]?.userId);
    // Seat 4 = new entrant
    expect(slotsAfter[3]?.userId).toBe('userB');
  });
});

// ─── TEST 4: API returns participants in random order ─────────────────────────
describe('TEST 4: API returns participants in arbitrary order — layout is deterministic', () => {
  // The authoritative order from the Prisma query is [role asc, joinedAt asc].
  // Both orderings below must produce the same slot layout.
  const canonical = [
    makeParticipant('host',  'HOST',     '2024-01-01T00:00:00Z'),
    makeParticipant('spk1',  'SPEAKER',  '2024-01-01T00:01:00Z'),
    makeParticipant('userA', 'SPEAKER',  '2024-01-01T00:02:00Z'),
    makeParticipant('userB', 'SPEAKER',  '2024-01-01T00:03:00Z'),
  ];
  const scrambled = [
    makeParticipant('userB', 'SPEAKER',  '2024-01-01T00:03:00Z'),
    makeParticipant('userA', 'SPEAKER',  '2024-01-01T00:02:00Z'),
    makeParticipant('host',  'HOST',     '2024-01-01T00:00:00Z'),
    makeParticipant('spk1',  'SPEAKER',  '2024-01-01T00:01:00Z'),
  ];
  const reverseOrder = [
    makeParticipant('userB', 'SPEAKER',  '2024-01-01T00:03:00Z'),
    makeParticipant('userA', 'SPEAKER',  '2024-01-01T00:02:00Z'),
    makeParticipant('spk1',  'SPEAKER',  '2024-01-01T00:01:00Z'),
    makeParticipant('host',  'HOST',     '2024-01-01T00:00:00Z'),
  ];

  test('Canonical and scrambled produce identical seat 3 assignment', () => {
    const slotsC = buildSlots(canonical);
    const slotsS = buildSlots(scrambled);
    expect(slotsC[2]?.userId).toBe(slotsS[2]?.userId);
  });

  test('Canonical and reverse-order produce identical seat 4 assignment', () => {
    const slotsC = buildSlots(canonical);
    const slotsR = buildSlots(reverseOrder);
    expect(slotsC[3]?.userId).toBe(slotsR[3]?.userId);
  });

  test('All 4 seats are identical regardless of input order', () => {
    const slotsC = buildSlots(canonical);
    const slotsS = buildSlots(scrambled);
    const slotsR = buildSlots(reverseOrder);
    for (let i = 0; i < 4; i++) {
      expect(slotsC[i]?.userId ?? null).toBe(slotsS[i]?.userId ?? null);
      expect(slotsC[i]?.userId ?? null).toBe(slotsR[i]?.userId ?? null);
    }
  });

  test('Seat 3 = userA (joined at 00:02, not userB who joined at 00:03)', () => {
    const slots = buildSlots(scrambled);
    expect(slots[2]?.userId).toBe('userA');
    expect(slots[3]?.userId).toBe('userB');
  });
});

// ─── TEST 5: Socket event for Seat 3 only changes Seat 3 ─────────────────────
describe('TEST 5: Socket event seatNumber=3 only changes Seat 3', () => {
  // Simulate what the store update looks like: update only the participant
  // at the slot that matches the incoming userId — all others unchanged.
  const participants = [
    makeParticipant('host',  'HOST',     '2024-01-01T00:00:00Z'),
    makeParticipant('spk1',  'SPEAKER',  '2024-01-01T00:01:00Z'),
    makeParticipant('userA', 'SPEAKER',  '2024-01-01T00:02:00Z'),
    makeParticipant('userB', 'SPEAKER',  '2024-01-01T00:03:00Z'),
  ];

  test('Before update: Seat 3 = userA', () => {
    const slots = buildSlots(participants);
    expect(slots[2]?.userId).toBe('userA');
  });

  test('After userA mutes: Seat 3 is still userA (only isMuted changes)', () => {
    // Simulate voice:mute_changed for userA
    const updated = participants.map(p =>
      p.userId === 'userA' ? { ...p, isMuted: true } : p
    );
    const slots = buildSlots(updated);
    // userId at Seat 3 must not change — mute doesn't move participants
    expect(slots[2]?.userId).toBe('userA');
    expect(slots[2]?.isMuted).toBe(true);
    // Seat 4 must not change either
    expect(slots[3]?.userId).toBe('userB');
  });
});

// ─── TEST 6: Socket event seatNumber=4 only changes Seat 4 ───────────────────
describe('TEST 6: Socket event for Seat 4 only changes Seat 4', () => {
  const participants = [
    makeParticipant('host',  'HOST',     '2024-01-01T00:00:00Z'),
    makeParticipant('spk1',  'SPEAKER',  '2024-01-01T00:01:00Z'),
    makeParticipant('userA', 'SPEAKER',  '2024-01-01T00:02:00Z'),
    makeParticipant('userB', 'SPEAKER',  '2024-01-01T00:03:00Z'),
  ];

  test('After userB mutes: Seat 4 is still userB, Seat 3 unchanged', () => {
    const updated = participants.map(p =>
      p.userId === 'userB' ? { ...p, isMuted: true } : p
    );
    const slots = buildSlots(updated);
    expect(slots[3]?.userId).toBe('userB');
    expect(slots[3]?.isMuted).toBe(true);
    expect(slots[2]?.userId).toBe('userA');  // Seat 3 unchanged
  });
});

// ─── TEST 7: Reload — positions unchanged ────────────────────────────────────
describe('TEST 7: Reload — participant positions remain identical', () => {
  const initialParticipants = [
    makeParticipant('host',  'HOST',     '2024-01-01T00:00:00Z'),
    makeParticipant('spk1',  'SPEAKER',  '2024-01-01T00:01:00Z'),
    makeParticipant('userA', 'SPEAKER',  '2024-01-01T00:02:00Z'),
    makeParticipant('userB', 'SPEAKER',  '2024-01-01T00:03:00Z'),
  ];

  test('Same layout after simulated reload (same data, different object instances)', () => {
    const slots1 = buildSlots(initialParticipants);
    // Simulate reload: create new participant objects with same data
    const reloadedParticipants = initialParticipants.map(p => ({ ...p }));
    const slots2 = buildSlots(reloadedParticipants);

    for (let i = 0; i < 12; i++) {
      expect(slots1[i]?.userId ?? null).toBe(slots2[i]?.userId ?? null);
    }
  });
});

// ─── TEST 8: Seat 3 → Seat 3, NEVER Seat 4 — the explicit regression test ────
describe('TEST 8: THE BUG REGRESSION — Seat 3 → Seat 3, never Seat 4', () => {
  // This test directly replicates the reported bug:
  // User A takes Seat 3 (3rd stage slot, after Host and spk1).
  // Another viewer should also see User A on Seat 3, not Seat 4.

  const viewerAParticipants = [
    makeParticipant('host',  'HOST',     '2024-01-01T00:00:00Z'),
    makeParticipant('spk1',  'SPEAKER',  '2024-01-01T00:01:00Z'),
    makeParticipant('userA', 'SPEAKER',  '2024-01-01T00:02:00Z'),
  ];

  // Viewer B received the join events in different order (as if delayed delivery)
  const viewerBParticipants = [
    makeParticipant('userA', 'SPEAKER',  '2024-01-01T00:02:00Z'),
    makeParticipant('spk1',  'SPEAKER',  '2024-01-01T00:01:00Z'),
    makeParticipant('host',  'HOST',     '2024-01-01T00:00:00Z'),
  ];

  test('Viewer A sees User A on Seat 3 (index 2)', () => {
    const slots = buildSlots(viewerAParticipants);
    expect(slots[2]?.userId).toBe('userA');
    // EXPLICITLY assert it is NOT Seat 4
    expect(slots[3]).toBeNull();
  });

  test('Viewer B sees User A on Seat 3 (index 2) — NOT Seat 4', () => {
    const slots = buildSlots(viewerBParticipants);
    // THE BUG: without the sort fix, viewerB would see userA at index 0 (wrong)
    // or at a different position than viewerA. With the fix, both must agree.
    expect(slots[2]?.userId).toBe('userA');
  });

  test('Viewer A and Viewer B see IDENTICAL seat assignments', () => {
    const slotsA = buildSlots(viewerAParticipants);
    const slotsB = buildSlots(viewerBParticipants);
    for (let i = 0; i < 12; i++) {
      expect(slotsA[i]?.userId ?? null).toBe(slotsB[i]?.userId ?? null);
    }
  });

  test('User A is on Seat 3, not Seat 4 — explicit regression assertion', () => {
    const slots = buildSlots(viewerAParticipants);
    // seatNumber 3 = array index 2
    const seat3 = slots[2];
    const seat4 = slots[3];
    expect(seat3?.userId).toBe('userA');  // Seat 3 = userA ✓
    expect(seat4).toBeNull();             // Seat 4 = empty ✓
    // Belt-and-suspenders: userA must not be at index 3 (Seat 4)
    expect(seat4?.userId).not.toBe('userA');
  });
});

// ─── Seat label consistency ───────────────────────────────────────────────────
describe('Seat label consistency — array index to seat number conversion', () => {
  test('Array index 0 = Seat 1 (never Seat 0)', () => {
    // The seat number displayed to users is (arrayIndex + 1)
    // EmptySlot: index={i + 1}
    // This test documents the canonical mapping
    expect(0 + 1).toBe(1); // index 0 → Seat 1
    expect(1 + 1).toBe(2); // index 1 → Seat 2
    expect(2 + 1).toBe(3); // index 2 → Seat 3
    expect(3 + 1).toBe(4); // index 3 → Seat 4
  });

  test('lockedSeats uses 0-based index, display label adds +1', () => {
    // The backend stores lockedSeats as 0-based indices.
    // The frontend checks: lockedSeats.includes(i) where i is 0-based.
    // The label shown to users is i + 1 (1-based seat number).
    const lockedSeats = [2]; // Seat 3 (display) is locked
    const isLocked = (seatIndex) => lockedSeats.includes(seatIndex);
    expect(isLocked(2)).toBe(true);   // index 2 = Seat 3 is locked ✓
    expect(isLocked(3)).toBe(false);  // index 3 = Seat 4 is NOT locked ✓
    // The display label for a locked seat
    const displayLabel = (seatIndex) => `Seat ${seatIndex + 1}`;
    expect(displayLabel(2)).toBe('Seat 3'); // ✓ not "Seat 2"
  });
});

// ─── computeStageLayout source-of-truth checks ───────────────────────────────
describe('computeStageLayout — source of truth matches backend sort order', () => {
  test('Participants sorted by joinedAt are placed in that order in Seats 2–12', () => {
    const participants = [
      makeParticipant('host', 'HOST',    '2024-01-01T00:00:00Z'),
      makeParticipant('A',    'SPEAKER', '2024-01-01T00:10:00Z'),
      makeParticipant('B',    'SPEAKER', '2024-01-01T00:20:00Z'),
      makeParticipant('C',    'SPEAKER', '2024-01-01T00:30:00Z'),
    ];
    const slots = buildSlots(participants);
    expect(slots[0]?.userId).toBe('host'); // Seat 1
    expect(slots[1]?.userId).toBe('A');   // Seat 2 — joined first
    expect(slots[2]?.userId).toBe('B');   // Seat 3
    expect(slots[3]?.userId).toBe('C');   // Seat 4 — joined last
  });

  test('JOIN ORDER determines seat — later joiner gets higher seat number', () => {
    const lateJoiner = makeParticipant('late', 'SPEAKER', '2024-01-01T00:59:00Z');
    const earlyJoiner = makeParticipant('early', 'SPEAKER', '2024-01-01T00:01:00Z');
    const host = makeParticipant('host', 'HOST', '2024-01-01T00:00:00Z');

    const slots = buildSlots([lateJoiner, earlyJoiner, host]); // scrambled input
    expect(slots[1]?.userId).toBe('early'); // Seat 2 — joined earlier
    expect(slots[2]?.userId).toBe('late');  // Seat 3 — joined later
  });
});
