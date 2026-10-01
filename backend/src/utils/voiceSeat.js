'use strict';
/**
 * voiceSeat.js — Authoritative Voice Club seat helpers
 * ─────────────────────────────────────────────────────────────────────────────
 * AUTHORITATIVE SEAT RULES:
 *
 *   seatNumber (1–12) — stored in the database on the VoiceParticipant row.
 *     null     = participant is in the audience (not on stage).
 *     1–12     = participant is on stage at this exact seat.
 *
 *   Seat 1 — can be occupied by HOST or MODERATOR only.
 *             Normal SPEAKER/AUDIENCE must NEVER occupy Seat 1.
 *
 *   Seats 2–12 — HOST, MODERATOR, and SPEAKER are all eligible.
 *
 *   The backend/database is the single source of truth.
 *   Clients MUST render participant.seatNumber directly.
 *   Clients must NOT compute seat positions from array index,
 *   participant ordering, or any client-side algorithm.
 *
 * SEAT STABILITY:
 *   When someone leaves or drops their mic, their seat becomes null (empty).
 *   Remaining participants do NOT automatically compact to lower-numbered seats.
 *   No other participant is auto-promoted or auto-moved.
 *
 * HOST RULES:
 *   HOST can grab any available seat (Seats 1–12).
 *   HOST must WAIT when the stage is full — HOST does NOT evict any other participant.
 *   When HOST returns and Seat 1 is empty, they are placed at Seat 1.
 *   When HOST returns and Seat 1 is occupied, they take the lowest available free seat.
 *
 * MODERATOR RULES:
 *   MODERATOR can grab any available seat (Seats 1–12).
 *   MODERATOR must queue when stage is full.
 *   MODERATOR does NOT auto-promote to Seat 1 when HOST leaves.
 *   To take Seat 1, a MODERATOR must: (1) drop their current seat → (2) request Seat 1.
 *   Multiple MODERATORs follow the same rules — no automatic reshuffling.
 *
 * MUTE vs SEAT:
 *   isMuted=true (Turn Off Mic) → participant stays on their seat, audio off only.
 *   seatNumber=null (Drop Mic / End Mic) → participant leaves stage, enters audience.
 *
 * DB COLUMN:
 *   VoiceParticipant.seatNumber  INT NULL (1–12)
 *   Unique constraint: (roomId, seatNumber) — no two participants share a seat.
 */

const VOICE_ROLES = {
  HOST:      'HOST',
  MODERATOR: 'MODERATOR',
  SPEAKER:   'SPEAKER',
  AUDIENCE:  'AUDIENCE',
};

/** Seat 1 eligibility — HOST and MODERATOR only */
function canOccupySeat1(role) {
  return role === VOICE_ROLES.HOST || role === VOICE_ROLES.MODERATOR;
}

/** Stage eligibility — HOST, MODERATOR, and SPEAKER */
function canOccupySeats2to12(role) {
  return role === VOICE_ROLES.HOST || role === VOICE_ROLES.MODERATOR || role === VOICE_ROLES.SPEAKER;
}

/** Moderation authority — role-based, not stage-based */
function isPrivilegedRole(role) {
  return role === VOICE_ROLES.HOST || role === VOICE_ROLES.MODERATOR;
}

/**
 * findAvailableSeat(roomId, prisma, options)
 *
 * Finds the lowest available seat number (1–maxSpeakers) in the room.
 *
 * Options:
 *   preferSeat1 — if true and Seat 1 is free, return 1 first (used for HOST)
 *   onlySeat1   — if true, only return 1 or null (used for explicit Seat 1 request)
 *   role        — the role of the participant taking the seat (enforces Seat 1 eligibility)
 *   maxSpeakers — room capacity (default 12)
 *
 * Returns the seatNumber (1–12) or null if no seat is available.
 */
async function findAvailableSeat(roomId, prisma, options = {}) {
  const { preferSeat1 = false, onlySeat1 = false, role = 'SPEAKER', maxSpeakers = 12 } = options;

  // Get all currently occupied seat numbers in this room (active participants with a seat)
  const occupied = await prisma.$queryRaw`
    SELECT seatNumber FROM voice_participants
    WHERE roomId = ${roomId}
    AND isActive = 1
    AND seatNumber IS NOT NULL
  `;
  const occupiedSet = new Set(occupied.map(r => Number(r.seatNumber)));

  if (onlySeat1) {
    // Only interested in Seat 1
    if (!canOccupySeat1(role)) return null; // role not allowed at Seat 1
    return occupiedSet.has(1) ? null : 1;
  }

  // Find lowest available seat respecting role constraints
  for (let s = 1; s <= maxSpeakers; s++) {
    if (occupiedSet.has(s)) continue; // seat taken
    if (s === 1 && !canOccupySeat1(role)) continue; // SPEAKER/AUDIENCE can't take Seat 1
    return s; // first available
  }
  return null; // stage full
}

/**
 * assignSeat(roomId, userId, seatNumber, tx)
 *
 * Atomically assigns a specific seat to a participant (inside a Prisma transaction).
 * Updates seatNumber and role/isMuted state as appropriate.
 *
 * This is a raw SQL write because the Prisma client may not be regenerated yet.
 *
 * @param {string} roomId
 * @param {string} userId
 * @param {number} seatNumber - 1–12
 * @param {object} tx - Prisma transaction client
 * @param {object} roleData - { role?, isMuted?, handRaised?, handRaisedAt? }
 */
async function assignSeat(roomId, userId, seatNumber, tx, roleData = {}) {
  const { role, isMuted = false, handRaised = false, handRaisedAt = null } = roleData;
  const now = new Date();

  if (role) {
    await tx.$executeRaw`
      UPDATE voice_participants
      SET seatNumber = ${seatNumber},
          role = ${role},
          isMuted = ${isMuted ? 1 : 0},
          mutedByModerator = 0,
          handRaised = 0,
          handRaisedAt = NULL,
          updatedAt = ${now}
      WHERE roomId = ${roomId} AND userId = ${userId}
    `;
  } else {
    await tx.$executeRaw`
      UPDATE voice_participants
      SET seatNumber = ${seatNumber},
          isMuted = ${isMuted ? 1 : 0},
          mutedByModerator = 0,
          handRaised = 0,
          handRaisedAt = NULL,
          updatedAt = ${now}
      WHERE roomId = ${roomId} AND userId = ${userId}
    `;
  }
}

/**
 * releaseSeat(roomId, userId, tx)
 *
 * Releases a participant's seat (sets seatNumber=null).
 * For HOST/MOD: sets isMuted=true (stays in room, retains moderation authority).
 * For SPEAKER: changes role to AUDIENCE.
 *
 * @param {string} roomId
 * @param {string} userId
 * @param {string} currentRole — current participant role
 * @param {object} tx — Prisma transaction client (or prisma directly)
 */
async function releaseSeat(roomId, userId, currentRole, tx) {
  const now = new Date();
  const isPrivileged = isPrivilegedRole(currentRole);

  if (isPrivileged) {
    // HOST/MOD: leave stage → go to audience, keep role
    await tx.$executeRaw`
      UPDATE voice_participants
      SET seatNumber = NULL,
          isMuted = 1,
          updatedAt = ${now}
      WHERE roomId = ${roomId} AND userId = ${userId}
    `;
  } else {
    // SPEAKER → AUDIENCE
    await tx.$executeRaw`
      UPDATE voice_participants
      SET seatNumber = NULL,
          role = 'AUDIENCE',
          isMuted = 1,
          updatedAt = ${now}
      WHERE roomId = ${roomId} AND userId = ${userId}
    `;
  }
}

/**
 * getOccupiedSeats(roomId, prisma)
 *
 * Returns array of { seatNumber, userId, role } for all active on-stage participants.
 * Uses raw SQL since Prisma client may not have seatNumber field yet.
 */
async function getOccupiedSeats(roomId, prisma) {
  return prisma.$queryRaw`
    SELECT seatNumber, userId, role, isMuted, isPinned, joinedAt
    FROM voice_participants
    WHERE roomId = ${roomId}
    AND isActive = 1
    AND seatNumber IS NOT NULL
    ORDER BY seatNumber ASC
  `;
}

/**
 * countOnStage(roomId, prisma)
 *
 * Returns the number of participants currently on stage (seatNumber IS NOT NULL).
 * This is the authoritative count — uses the seatNumber column.
 */
async function countOnStage(roomId, prisma) {
  const [{ cnt }] = await prisma.$queryRaw`
    SELECT COUNT(*) as cnt FROM voice_participants
    WHERE roomId = ${roomId}
    AND isActive = 1
    AND seatNumber IS NOT NULL
  `;
  return Number(cnt);
}

/**
 * buildStageSlots(occupiedSeats, maxSpeakers)
 *
 * Builds the canonical slot array from authoritative seatNumber data.
 * Each slot is the participant object (with seatNumber) or null if the seat is empty.
 *
 * This replaces computeStageLayout — slots are built directly from seatNumber,
 * NOT from joinedAt ordering or role priority.
 *
 * @param {Array} occupiedSeats — rows from getOccupiedSeats()
 * @param {number} maxSpeakers — room capacity (default 12)
 * @returns {Array<object|null>} — length maxSpeakers, indexed 0 = Seat 1
 */
function buildStageSlots(occupiedSeats, maxSpeakers = 12) {
  const slots = new Array(maxSpeakers).fill(null);
  for (const p of occupiedSeats) {
    const idx = Number(p.seatNumber) - 1; // seatNumber 1 → index 0
    if (idx >= 0 && idx < maxSpeakers) {
      slots[idx] = p;
    }
  }
  return slots;
}

/**
 * computeStageLayout(participants, maxSpeakers)
 *
 * COMPATIBILITY SHIM — used by unit tests that don't have seatNumber data.
 * For production code, use buildStageSlots() with data from getOccupiedSeats().
 *
 * When participants have seatNumber set: builds slots directly from seatNumber.
 * When participants lack seatNumber (legacy/tests): falls back to joinedAt ordering.
 *
 * @param {Array} participants — array of VoiceParticipant-like objects
 * @param {number} maxSpeakers
 * @returns {Array<object|null>}
 */
function computeStageLayout(participants, maxSpeakers = 12) {
  // Check if any participant has seatNumber defined (authoritative path)
  const hasSeats = participants.some(p => p.seatNumber != null);

  if (hasSeats) {
    // Authoritative path: use seatNumber directly
    const onStage = participants.filter(p => p.isActive && p.seatNumber != null);
    return buildStageSlots(onStage, maxSpeakers);
  }

  // Legacy/test path: derive from role+isMuted+seat1Claimed ordering
  // (used by existing tests that don't set seatNumber)
  const onStage = participants.filter(p => {
    if (!p.isActive) return false;
    if (p.role === VOICE_ROLES.SPEAKER) return true;
    if (p.role === VOICE_ROLES.HOST || p.role === VOICE_ROLES.MODERATOR) return !p.isMuted;
    return false;
  });

  const hosts = onStage.filter(p => p.role === VOICE_ROLES.HOST)
    .sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));
  const seat1Mods = onStage.filter(p => p.role === VOICE_ROLES.MODERATOR && p.seat1Claimed)
    .sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));

  const seat1 = hosts[0] ?? seat1Mods[0] ?? null;

  const remaining = onStage
    .filter(p => seat1 ? p.userId !== seat1.userId : true)
    .sort((a, b) => {
      const sameTime = new Date(a.joinedAt).getTime() === new Date(b.joinedAt).getTime();
      if (sameTime) {
        const RR = { HOST: 0, MODERATOR: 1, SPEAKER: 2 };
        return (RR[a.role] ?? 9) - (RR[b.role] ?? 9);
      }
      return new Date(a.joinedAt) - new Date(b.joinedAt);
    });

  const pinnedIdx = remaining.findIndex(p => p.isPinned);
  if (pinnedIdx > 0) {
    const [pinned] = remaining.splice(pinnedIdx, 1);
    remaining.unshift(pinned);
  }

  const slots = [seat1];
  for (let i = 1; i < maxSpeakers; i++) slots.push(remaining[i - 1] ?? null);
  return slots;
}

module.exports = {
  VOICE_ROLES,
  canOccupySeat1,
  canOccupySeats2to12,
  isPrivilegedRole,
  findAvailableSeat,
  assignSeat,
  releaseSeat,
  getOccupiedSeats,
  countOnStage,
  buildStageSlots,
  computeStageLayout, // compatibility shim for tests
};
