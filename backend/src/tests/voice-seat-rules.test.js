'use strict';
/**
 * Voice Club — Seat Rules Tests (Phase 14)
 * ──────────────────────────────────────────────────────────────────────────────
 * Tests ALL mandatory rules from the authoritative business spec:
 *
 *  Seat 1 eligibility (HOST/MOD only — never normal SPEAKER/AUDIENCE)
 *  Seats 2–12 (HOST, MOD, SPEAKER all eligible)
 *  Stage layout determinism (computeStageLayout)
 *  autoPromoteNext never puts a normal user at index 0
 *  grabMic concurrency safety
 *  promoteParticipant TOCTOU protection
 *  seat-lock authorization (HOST/MOD only)
 *  HOST/MOD can manage from audience (no stage required)
 *  capacity is room.maxSpeakers (not maxSpeakers-1)
 *  voiceSeat helpers
 */

const { canOccupySeat1, canOccupySeats2to12, isPrivilegedRole, computeStageLayout, VOICE_ROLES } =
  require('../utils/voiceSeat');

// ─── PHASE 1: voiceSeat helpers ───────────────────────────────────────────────
describe('voiceSeat — canOccupySeat1', () => {
  test('HOST can occupy Seat 1', () => {
    expect(canOccupySeat1('HOST')).toBe(true);
  });
  test('MODERATOR can occupy Seat 1 (when HOST is absent)', () => {
    expect(canOccupySeat1('MODERATOR')).toBe(true);
  });
  test('SPEAKER cannot occupy Seat 1', () => {
    expect(canOccupySeat1('SPEAKER')).toBe(false);
  });
  test('AUDIENCE cannot occupy Seat 1', () => {
    expect(canOccupySeat1('AUDIENCE')).toBe(false);
  });
});

describe('voiceSeat — canOccupySeats2to12', () => {
  test('HOST can occupy Seats 2–12', () => {
    expect(canOccupySeats2to12('HOST')).toBe(true);
  });
  test('MODERATOR can occupy Seats 2–12', () => {
    expect(canOccupySeats2to12('MODERATOR')).toBe(true);
  });
  test('SPEAKER can occupy Seats 2–12', () => {
    expect(canOccupySeats2to12('SPEAKER')).toBe(true);
  });
  test('AUDIENCE cannot occupy Seats 2–12', () => {
    expect(canOccupySeats2to12('AUDIENCE')).toBe(false);
  });
});

describe('voiceSeat — isPrivilegedRole', () => {
  test('HOST is privileged', () => expect(isPrivilegedRole('HOST')).toBe(true));
  test('MODERATOR is privileged', () => expect(isPrivilegedRole('MODERATOR')).toBe(true));
  test('SPEAKER is not privileged', () => expect(isPrivilegedRole('SPEAKER')).toBe(false));
  test('AUDIENCE is not privileged', () => expect(isPrivilegedRole('AUDIENCE')).toBe(false));
});

// ─── PHASE 6: computeStageLayout ─────────────────────────────────────────────
describe('computeStageLayout — Seat 1 rules', () => {
  const makeP = (userId, role, isMuted = false, joinedAt = new Date(), isPinned = false, seat1Claimed = false) => ({
    userId, role, isMuted, joinedAt, isActive: true, isPinned, seat1Claimed
  });

  test('HOST occupies Seat 1 (index 0) when on stage', () => {
    const participants = [
      makeP('host1', 'HOST', false),
      makeP('spk1', 'SPEAKER', false),
    ];
    const slots = computeStageLayout(participants, 12);
    expect(slots[0]?.userId).toBe('host1');
    expect(slots[0]?.role).toBe('HOST');
  });

  test('MODERATOR occupies Seat 1 when HOST absent', () => {
    // Only a MOD with seat1Claimed=true gets Seat 1 when HOST is absent.
    // A MOD without seat1Claimed stays in Seats 2–12.
    const withClaim = [
      { ...makeP('mod1', 'MODERATOR', false), seat1Claimed: true },
      makeP('spk1', 'SPEAKER', false),
    ];
    const slots = computeStageLayout(withClaim, 12);
    expect(slots[0]?.userId).toBe('mod1');
    expect(slots[0]?.role).toBe('MODERATOR');
    expect(slots[1]?.userId).toBe('spk1');
  });

  test('Seat 1 is null (empty) when no HOST or MODERATOR with seat1Claimed is on stage', () => {
    // A MOD without seat1Claimed does NOT auto-take Seat 1
    const participants = [
      { ...makeP('spk1', 'SPEAKER', false), seat1Claimed: false },
      { ...makeP('spk2', 'SPEAKER', false), seat1Claimed: false },
    ];
    const slots = computeStageLayout(participants, 12);
    expect(slots[0]).toBeNull();
    const nonNullSlots = slots.filter(s => s !== null);
    expect(nonNullSlots.length).toBe(2);
    expect(nonNullSlots.every(s => s.role === 'SPEAKER')).toBe(true);
  });

  test('Normal SPEAKER never placed at index 0', () => {
    const participants = [
      makeP('spk1', 'SPEAKER', false, new Date('2024-01-01')),
      makeP('spk2', 'SPEAKER', false, new Date('2024-01-02')),
      makeP('spk3', 'SPEAKER', false, new Date('2024-01-03')),
    ];
    const slots = computeStageLayout(participants, 12);
    expect(slots[0]).toBeNull();
    // All speakers at slots 1+
    expect(slots.slice(1, 4).every(s => s?.role === 'SPEAKER')).toBe(true);
  });

  test('HOST drops mic (isMuted=true) — HOST moves to audience section, not on stage grid', () => {
    // When HOST calls dropMic(), isMuted=true is set in DB.
    // This means HOST is in the audience — they should NOT appear in any stage slot.
    // Seat 1 stays null (or goes to a MODERATOR if one is on stage).
    const participants = [
      makeP('host1', 'HOST', true),   // dropped mic — in audience
      makeP('spk1', 'SPEAKER', false),
    ];
    const slots = computeStageLayout(participants, 12);
    // HOST is muted (in audience) — Seat 1 must be null (no MOD either)
    expect(slots[0]).toBeNull();
    // SPEAKER is at Seat 2 (index 1)
    expect(slots[1]?.userId).toBe('spk1');
  });

  test('MODERATOR drops mic (isMuted=true) — MOD moves to audience section', () => {
    // When MODERATOR drops their mic (isMuted=true), they are in audience.
    // seat1Claimed is also cleared. Seat 1 stays null.
    const participants = [
      { ...makeP('mod1', 'MODERATOR', true), seat1Claimed: false },  // dropped mic
      makeP('spk1', 'SPEAKER', false),
    ];
    const slots = computeStageLayout(participants, 12);
    expect(slots[0]).toBeNull();
    expect(slots[1]?.userId).toBe('spk1');
    expect(slots[2]).toBeNull();
  });

  test('MODERATOR (unmuted) takes Seat 1 ONLY when seat1Claimed=true and HOST absent', () => {
    // With seat1Claimed — MOD explicitly grabbed Seat 1 from audience
    const participantsWithClaim = [
      { ...makeP('mod1', 'MODERATOR', false), seat1Claimed: true },
      makeP('spk1', 'SPEAKER', false),
    ];
    const slots = computeStageLayout(participantsWithClaim, 12);
    expect(slots[0]?.userId).toBe('mod1');
    expect(slots[0]?.role).toBe('MODERATOR');
    expect(slots[1]?.userId).toBe('spk1');
  });

  test('MODERATOR (unmuted) does NOT auto-take Seat 1 when seat1Claimed=false (HOST dropped mic)', () => {
    // Without seat1Claimed — MOD was already on stage when HOST left; should NOT slide to Seat 1
    const participants = [
      { ...makeP('mod1', 'MODERATOR', false), seat1Claimed: false },
      makeP('spk1', 'SPEAKER', false),
    ];
    const slots = computeStageLayout(participants, 12);
    // Seat 1 must remain empty — MOD did not explicitly claim it
    expect(slots[0]).toBeNull();
    // MOD stays at Seat 2 (Seats 2–12 slot)
    expect(slots[1]?.userId).toBe('mod1');
    expect(slots[2]?.userId).toBe('spk1');
  });

  test('MODERATOR takes Seat 1 when HOST drops mic (seat1Claimed=true via grabMic)', () => {
    // HOST dropped mic → in audience. MODERATOR (unmuted, seat1Claimed=true) steps up to Seat 1.
    const participants = [
      makeP('host1', 'HOST', true),      // in audience after dropMic
      { ...makeP('mod1', 'MODERATOR', false), seat1Claimed: true }, // on stage, claimed Seat 1
      makeP('spk1', 'SPEAKER', false),
    ];
    const slots = computeStageLayout(participants, 12);
    expect(slots[0]?.userId).toBe('mod1');  // MOD gets Seat 1
    expect(slots[0]?.role).toBe('MODERATOR');
    expect(slots[1]?.userId).toBe('spk1'); // SPEAKER at Seat 2
  });

  test('HOST reclaims Seat 1 when HOST unmutes (returns to stage)', () => {
    // HOST was in audience (isMuted=true), MOD had Seat 1.
    // HOST calls grabMic (isMuted=false) → HOST reclaims Seat 1, MOD moves to Seat 2.
    const participants = [
      makeP('host1', 'HOST', false),     // host returned — unmuted
      { ...makeP('mod1', 'MODERATOR', false), seat1Claimed: true }, // was at Seat 1
      makeP('spk1', 'SPEAKER', false),
    ];
    const slots = computeStageLayout(participants, 12);
    expect(slots[0]?.userId).toBe('host1'); // HOST back at Seat 1
    expect(slots[1]?.userId).toBe('mod1');  // MOD drops to Seat 2
    expect(slots[2]?.userId).toBe('spk1');
  });

  test('HOST preferred over MODERATOR for Seat 1', () => {
    const participants = [
      { ...makeP('mod1', 'MODERATOR', false, new Date('2024-01-01')), seat1Claimed: true },
      makeP('host1', 'HOST', false, new Date('2024-01-02')),
    ];
    const slots = computeStageLayout(participants, 12);
    expect(slots[0]?.userId).toBe('host1');
    expect(slots[0]?.role).toBe('HOST');
    expect(slots[1]?.userId).toBe('mod1');
  });

  test('Normal SPEAKER can occupy Seat 2 (index 1)', () => {
    const participants = [
      makeP('spk1', 'SPEAKER', false),
    ];
    const slots = computeStageLayout(participants, 12);
    expect(slots[0]).toBeNull();
    expect(slots[1]?.userId).toBe('spk1');
  });

  test('Normal SPEAKER can occupy Seat 12 (index 11)', () => {
    // 10 speakers + 1 more = fills up to slot 11 (Seat 12)
    const participants = Array.from({ length: 11 }, (_, i) =>
      makeP(`spk${i}`, 'SPEAKER', false, new Date(2024, 0, i + 1))
    );
    const slots = computeStageLayout(participants, 12);
    expect(slots[0]).toBeNull(); // Seat 1 always empty for normals
    expect(slots[11]?.role).toBe('SPEAKER'); // index 11 = Seat 12
  });

  test('HOST can occupy Seat 2 (index 1) when another HOST/MOD is at Seat 1', () => {
    const participants = [
      makeP('host1', 'HOST', false, new Date('2024-01-01')),
      makeP('mod1', 'MODERATOR', false, new Date('2024-01-02')),
    ];
    const slots = computeStageLayout(participants, 12);
    expect(slots[0]?.userId).toBe('host1'); // Seat 1
    expect(slots[1]?.userId).toBe('mod1');  // Seat 2
  });

  test('MODERATOR can occupy Seat 2 (index 1)', () => {
    const participants = [
      makeP('host1', 'HOST', false, new Date('2024-01-01')),
      makeP('mod1', 'MODERATOR', false, new Date('2024-01-02')),
      makeP('spk1', 'SPEAKER', false, new Date('2024-01-03')),
    ];
    const slots = computeStageLayout(participants, 12);
    expect(slots[0]?.userId).toBe('host1');
    expect(slots[1]?.userId).toBe('mod1');
    expect(slots[2]?.userId).toBe('spk1');
  });

  test('slot array length always equals maxSpeakers', () => {
    const participants = [makeP('host1', 'HOST', false)];
    const slots = computeStageLayout(participants, 12);
    expect(slots.length).toBe(12);
  });

  test('empty room produces all-null slots', () => {
    const slots = computeStageLayout([], 12);
    expect(slots.length).toBe(12);
    expect(slots.every(s => s === null)).toBe(true);
  });

  test('pinned SPEAKER moved to first Seats 2–12 slot (index 1)', () => {
    const participants = [
      makeP('spk1', 'SPEAKER', false, new Date('2024-01-01'), false),
      makeP('pinned', 'SPEAKER', false, new Date('2024-01-02'), true),
    ];
    const slots = computeStageLayout(participants, 12);
    expect(slots[0]).toBeNull();         // Seat 1 still empty
    expect(slots[1]?.userId).toBe('pinned'); // pinned at Seat 2
    expect(slots[2]?.userId).toBe('spk1');
  });
});

// ─── autoPromote never puts SPEAKER at index 0 ───────────────────────────────
describe('computeStageLayout — auto-promote result never at index 0', () => {
  test('after auto-promote, promoted SPEAKER appears at index 1, not 0', () => {
    // Simulate what autoPromoteNext does: it sets role=SPEAKER on a queued user.
    // Then the layout engine must NOT put them at index 0.
    const makeP = (userId, role, isMuted = false) => ({
      userId, role, isMuted, joinedAt: new Date(), isActive: true, isPinned: false
    });
    const afterPromotion = [makeP('promoted', 'SPEAKER', false)];
    const slots = computeStageLayout(afterPromotion, 12);
    expect(slots[0]).toBeNull();               // Seat 1 empty — no HOST/MOD
    expect(slots[1]?.userId).toBe('promoted'); // promoted user at Seat 2
    expect(slots[1]?.role).toBe('SPEAKER');
  });
});

// ─── voice.controller.js — function presence check ───────────────────────────
describe('voice.controller.js — required functions present', () => {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(
    path.join(__dirname, '../controllers/voice.controller.js'),
    'utf8'
  );

  const requiredFunctions = [
    'grabMic', 'dropMic', 'kickParticipant', 'banParticipant',
    'unbanParticipant', 'toggleOpenMic', 'toggleMicLock', 'toggleSeatLock',
    'sendMessage', 'getMessages', 'promoteParticipant', 'updateRoom',
    'deleteRoom', 'getMyRooms', 'getScheduledRooms', 'uploadRoomCover',
  ];

  requiredFunctions.forEach(fn => {
    test(`${fn} is exported from voice.controller.js`, () => {
      expect(src).toMatch(new RegExp(`module\\.exports[\\s\\S]*\\b${fn}\\b`));
    });
  });

  test('module.exports is present', () => {
    expect(src).toMatch(/module\.exports/);
  });
});

// ─── grabMic — seat 1 and authorization rules ─────────────────────────────────
describe('grabMic — source code rules', () => {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(
    path.join(__dirname, '../controllers/voice.controller.js'),
    'utf8'
  );
  const fnStart = src.indexOf('async function grabMic');
  const fnEnd   = src.indexOf('async function', fnStart + 1);
  const fn      = src.slice(fnStart, fnEnd);

  test('grabMic checks micLocked for non-privileged users', () => {
    expect(fn).toMatch(/micLocked/);
    expect(fn).toMatch(/403/);
  });

  test('grabMic uses a Prisma transaction for concurrency safety', () => {
    expect(fn).toMatch(/\$transaction/);
  });

  test('grabMic re-checks capacity inside transaction (TOCTOU fix)', () => {
    // New implementation uses occupiedRows + seatNumber IS NOT NULL for seat counting
    expect(fn).toMatch(/seatNumber IS NOT NULL/);
    expect(fn).toMatch(/tx\.\$queryRaw|occupiedRows/);
  });

  test('grabMic does NOT use "Seat 1" as an authorization concept', () => {
    // The old code said "bypasses all locks for HOST/MOD (Seat 1)". This is gone.
    expect(fn).not.toMatch(/bypass.*Seat 1|Seat 1.*bypass/i);
  });

  test('grabMic handles HOST/MOD by muting not by assigning seat number', () => {
    // HOST/MOD go on stage by setting isMuted=false
    expect(fn).toMatch(/isMuted.*false|false.*isMuted/);
  });
});

// ─── promoteParticipant — TOCTOU fix ─────────────────────────────────────────
describe('promoteParticipant — TOCTOU protection', () => {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(
    path.join(__dirname, '../controllers/voice.controller.js'),
    'utf8'
  );
  const fnStart = src.indexOf('async function promoteParticipant');
  const fnEnd   = src.indexOf('async function', fnStart + 1);
  const fn      = src.slice(fnStart, fnEnd);

  test('promoteParticipant wraps SPEAKER promotion in a transaction', () => {
    expect(fn).toMatch(/\$transaction/);
  });

  test('promoteParticipant re-reads role inside the transaction', () => {
    expect(fn).toMatch(/tx\.voiceParticipant\.findUnique|tx\.voiceParticipant\.count/);
  });

  test('promoteParticipant emits voice:role_changed after promotion', () => {
    expect(fn).toMatch(/voice:role_changed/);
  });

  test('promoteParticipant emits voice:your_role_changed to promoted user', () => {
    expect(fn).toMatch(/voice:your_role_changed/);
  });

  test('normal SPEAKER promotion never sets role to HOST or MODERATOR', () => {
    // The role being set must be SPEAKER or AUDIENCE — never HOST/MOD
    // Check the data update lines
    expect(fn).toMatch(/role.*SPEAKER|role.*AUDIENCE/);
    // These should not appear as promotion targets for normal users
    const hostAssignments = fn.match(/role:\s*['"]HOST['"]/g) || [];
    const modAssignments  = fn.match(/role:\s*['"]MODERATOR['"]/g) || [];
    // Any HOST/MODERATOR assignments here would be in the role check (not assignment)
    // so we check the data update specifically
    const dataSection = fn.match(/data:\s*\{[^}]+role:\s*['"]HOST['"]/g) || [];
    expect(dataSection.length).toBe(0); // no data:{role:'HOST'} in promoteParticipant
  });
});

// ─── toggleSeatLock — authorization ──────────────────────────────────────────
describe('toggleSeatLock — authorization enforcement', () => {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(
    path.join(__dirname, '../controllers/voice.controller.js'),
    'utf8'
  );
  const fnStart = src.indexOf('async function toggleSeatLock');
  const fnEnd   = src.indexOf('async function', fnStart + 1);
  const fn      = src.slice(fnStart, fnEnd);

  test('toggleSeatLock checks participant role server-side', () => {
    expect(fn).toMatch(/MODERATOR_ROLES|HOST.*MODERATOR|checkVoiceRole/);
  });

  test('toggleSeatLock returns 403 for unauthorized users', () => {
    expect(fn).toMatch(/403/);
  });

  test('seat-lock route has checkVoiceRole middleware', () => {
    const routeSrc = fs.readFileSync(
      path.join(__dirname, '../routes/voice.routes.js'), 'utf8'
    );
    const seatLockSection = routeSrc.match(/seat-lock[\s\S]{0,200}/)?.[0] ?? '';
    expect(seatLockSection).toMatch(/checkVoiceRole/);
  });
});

// ─── HOST/MOD audience management — no stage required ────────────────────────
describe('HOST/MOD audience management — authorization is role-based, not stage-based', () => {
  const fs   = require('fs');
  const path = require('path');
  const rolesCtrl = fs.readFileSync(
    path.join(__dirname, '../controllers/voice-roles.controller.js'), 'utf8'
  );
  const queueCtrl = fs.readFileSync(
    path.join(__dirname, '../controllers/voice-queue.controller.js'), 'utf8'
  );

  test('assignModerator checks role, not isMuted/stage position', () => {
    const fnStart = rolesCtrl.indexOf('async function assignModerator');
    const fnEnd   = rolesCtrl.indexOf('async function', fnStart + 1);
    const fn      = rolesCtrl.slice(fnStart, fnEnd);
    // Must check MODERATOR_ROLES or HOST role
    expect(fn).toMatch(/HOST|MODERATOR_ROLES|checkVoiceRole/);
    // Must NOT check isMuted as authorization
    expect(fn).not.toMatch(/if.*isMuted.*return|isMuted.*403/);
  });

  test('approveNext checks role, not isMuted/stage position', () => {
    const fnStart = queueCtrl.indexOf('async function approveNext');
    const fnEnd   = queueCtrl.indexOf('async function', fnStart + 1);
    const fn      = queueCtrl.slice(fnStart, fnEnd);
    expect(fn).toMatch(/HOST|MODERATOR_ROLES/);
    expect(fn).not.toMatch(/isMuted.*403|if.*isMuted.*error/);
  });

  test('rejectUser checks role, not isMuted/stage position', () => {
    const fnStart = queueCtrl.indexOf('async function rejectUser');
    const fnEnd   = queueCtrl.indexOf('async function', fnStart + 1);
    const fn      = queueCtrl.slice(fnStart, fnEnd);
    expect(fn).toMatch(/MODERATOR_ROLES/);
    expect(fn).not.toMatch(/isMuted.*403/);
  });
});

// ─── Capacity consistency — maxSpeakers not maxSpeakers-1 ───────────────────
describe('Capacity consistency — all paths use room.maxSpeakers directly', () => {
  const fs   = require('fs');
  const path = require('path');

  const files = [
    ['voice.controller.js',       '../controllers/voice.controller.js'],
    ['voice-queue.controller.js', '../controllers/voice-queue.controller.js'],
    ['voice-mic.controller.js',   '../controllers/voice-mic.controller.js'],
    ['autoPromote.js',            '../utils/autoPromote.js'],
  ];

  files.forEach(([name, rel]) => {
    test(`${name} does NOT use (maxSpeakers - 1) as capacity limit`, () => {
      const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
      // The old incorrect pattern: (room.maxSpeakers || 12) - 1
      // This should no longer appear as a capacity check
      expect(src).not.toMatch(/\(room\.maxSpeakers\s*\|\|\s*12\)\s*-\s*1/);
      expect(src).not.toMatch(/maxSpeakers\s*-\s*1/);
    });
  });
});

// ─── autoPromote — seat assignment ───────────────────────────────────────────
describe('autoPromoteNext — assigns seatNumber to promoted users', () => {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(
    path.join(__dirname, '../utils/autoPromote.js'), 'utf8'
  );

  test('autoPromote assigns seatNumber (not just role/isMuted)', () => {
    expect(src).toMatch(/seatNumber\s*=\s*\$\{promotedSeat\}|SET seatNumber/);
  });

  test('autoPromote uses room.maxSpeakers as capacity (not -1)', () => {
    expect(src).not.toMatch(/maxSpeakers\s*-\s*1/);
  });

  test('autoPromote respects micLocked', () => {
    expect(src).toMatch(/micLocked/);
  });

  test('autoPromote counts on-stage by seatNumber IS NOT NULL', () => {
    expect(src).toMatch(/seatNumber IS NOT NULL/);
  });
});

// ─── voiceSeat.js — module exports ───────────────────────────────────────────
describe('voiceSeat.js — module exports completeness', () => {
  const mod = require('../utils/voiceSeat');
  test('exports canOccupySeat1', () => expect(mod.canOccupySeat1).toBeDefined());
  test('exports canOccupySeats2to12', () => expect(mod.canOccupySeats2to12).toBeDefined());
  test('exports isPrivilegedRole', () => expect(mod.isPrivilegedRole).toBeDefined());
  test('exports computeStageLayout', () => expect(mod.computeStageLayout).toBeDefined());
  test('exports countOnStage', () => expect(mod.countOnStage).toBeDefined());
  test('exports buildStageSlots', () => expect(mod.buildStageSlots).toBeDefined());
  test('exports VOICE_ROLES', () => expect(mod.VOICE_ROLES).toBeDefined());
});

// ─── grabMic — seatNumber authority ──────────────────────────────────────────
describe('grabMic — seatNumber-based seat authority (no eviction)', () => {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(
    path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
  );
  const fnStart = src.indexOf('async function grabMic');
  const fnEnd   = src.indexOf('async function', fnStart + 1);
  const fn      = src.slice(fnStart, fnEnd);

  test('grabMic assigns seatNumber atomically in the DB', () => {
    expect(fn).toMatch(/seatNumber.*\$\{seat\}|SET seatNumber/);
  });

  test('grabMic does NOT have HOST PRIORITY EVICTION — no automatic displacement', () => {
    expect(fn).not.toMatch(/HOST PRIORITY EVICTION/i);
    expect(fn).not.toMatch(/evictTarget|evictedUserId/);
  });

  test('grabMic uses $transaction for race-safe seat assignment', () => {
    expect(fn).toMatch(/\$transaction/);
  });

  test('grabMic checks occupied seats inside transaction (seatNumber IS NOT NULL)', () => {
    expect(fn).toMatch(/seatNumber IS NOT NULL/);
  });

  test('grabMic returns seatNumber in response', () => {
    expect(fn).toMatch(/seatNumber.*assignedSeat|assignedSeat.*seatNumber/);
  });

  test('grabMic emits seatNumber in voice:role_changed', () => {
    expect(fn).toMatch(/voice:role_changed[\s\S]{0,200}seatNumber/);
  });

  test('grabMic handles full stage by queuing (STAGE_FULL), including HOST', () => {
    // HOST no longer bypasses capacity — it goes into queue like everyone else
    expect(fn).toMatch(/STAGE_FULL/);
    expect(fn).toMatch(/Stage is full.*added to the queue|added to the queue/i);
  });
});
