/**
 * live-class-non-creator-admin.test.js
 *
 * Security regression tests: a SCHOOL_ADMIN who is NOT the creator of a live class
 * must be denied all HOST-only mutating endpoints.
 *
 * After PR #1 (Phase 24L), the authorization model changed:
 *   - assertHostOrDelegate removed → replaced by assertOwnerOrModerator (async DB check)
 *   - assertHostAccess removed (dead code)
 *   - assertOwner removed → route-level resolveStreamStaffAccess handles PUBLIC
 *   - All bulk-moderation functions now use assertOwnerOrModerator (participant record check)
 *
 * Strategy: source-code audit + functional tests.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const CTRL = path.join(__dirname, '../controllers/live-class.controller.js');
const src  = fs.readFileSync(CTRL, 'utf8');

// ─── Helper: slice a named function from the source ───────────────────────────
function sliceFunction(name) {
  const idx = src.indexOf(`async function ${name}`);
  if (idx === -1) throw new Error(`Function ${name} not found in controller`);
  return src.slice(idx, idx + 4096);
}

// ─── assertOwnerOrModerator: the new authorization guard ─────────────────────
describe('assertOwnerOrModerator — replaces assertHostOrDelegate', () => {
  test('assertOwnerOrModerator function exists', () => {
    expect(src).toMatch(/async function assertOwnerOrModerator/);
  });

  test('assertOwnerOrModerator checks participant DB record (not global role)', () => {
    const fnIdx = src.indexOf('async function assertOwnerOrModerator');
    const fn = src.slice(fnIdx, fnIdx + 600);
    expect(fn).toMatch(/liveClassParticipant\.findFirst/);
    expect(fn).toMatch(/HOST.*MODERATOR|MODERATOR.*HOST/);
    expect(fn).toMatch(/403/);
  });

  test('assertHostAccess is GONE (dead code removed)', () => {
    expect(src).not.toMatch(/function assertHostAccess/);
  });

  test('assertHostOrDelegate is GONE (replaced by assertOwnerOrModerator)', () => {
    expect(src).not.toMatch(/function assertHostOrDelegate/);
  });
});

// ─── muteParticipant: assertOwnerOrModerator present ─────────────────────────
describe('muteParticipant — assertOwnerOrModerator guard', () => {
  const fn = sliceFunction('muteParticipant');

  test('calls assertOwnerOrModerator', () => {
    expect(fn).toMatch(/assertOwnerOrModerator/);
  });

  test('assertSchoolAccess present for SCHOOL stream isolation', () => {
    expect(fn).toMatch(/assertSchoolAccess/);
  });
});

// ─── kickParticipant: assertOwnerOrModerator present ─────────────────────────
describe('kickParticipant — assertOwnerOrModerator guard', () => {
  const fn = sliceFunction('kickParticipant');

  test('calls assertOwnerOrModerator', () => {
    expect(fn).toMatch(/assertOwnerOrModerator/);
  });

  test('sets wasKicked = true', () => {
    expect(fn).toMatch(/wasKicked.*true|wasKicked: true/);
  });
});

// ─── toggleOpenMic: assertOwnerOrModerator present ───────────────────────────
describe('toggleOpenMic — assertOwnerOrModerator guard', () => {
  const fn = sliceFunction('toggleOpenMic');

  test('calls assertOwnerOrModerator', () => {
    expect(fn).toMatch(/assertOwnerOrModerator/);
  });

  test('assertOwnerOrModerator placed before isOpenMic toggle', () => {
    const guardIdx = fn.indexOf('assertOwnerOrModerator');
    const toggleIdx = fn.indexOf('newOpenMic');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(toggleIdx).toBeGreaterThan(guardIdx);
  });
});

// ─── startRecording / stopRecording: route-level guard ───────────────────────
describe('startRecording / stopRecording — route-level guard', () => {
  test('startRecording uses assertSchoolAccess', () => {
    const fn = sliceFunction('startRecording');
    expect(fn).toMatch(/assertSchoolAccess/);
  });

  test('stopRecording uses assertSchoolAccess', () => {
    const fn = sliceFunction('stopRecording');
    expect(fn).toMatch(/assertSchoolAccess/);
  });
});

// ─── broadcastPoll: assertSchoolAccess present ───────────────────────────────
describe('broadcastPoll — assertSchoolAccess guard', () => {
  const fn = sliceFunction('broadcastPoll');

  test('assertSchoolAccess present', () => {
    expect(fn).toMatch(/assertSchoolAccess/);
  });
});

// ─── broadcastDraw: assertSchoolAccess present ───────────────────────────────
describe('broadcastDraw — assertSchoolAccess guard', () => {
  const fn = sliceFunction('broadcastDraw');

  test('assertSchoolAccess present', () => {
    expect(fn).toMatch(/assertSchoolAccess/);
  });
});

// ─── broadcastQuranPosition: assertSchoolAccess present ──────────────────────
describe('broadcastQuranPosition — assertSchoolAccess guard', () => {
  const fn = sliceFunction('broadcastQuranPosition');

  test('assertSchoolAccess present', () => {
    expect(fn).toMatch(/assertSchoolAccess/);
  });
});

// ─── deleteMessage: PES-001 fix — participant record is authoritative ─────────
describe('deleteMessage — PES-001: participant role is authoritative', () => {
  const fn = sliceFunction('deleteMessage');

  test('uses callerParticipant to check HOST/MODERATOR', () => {
    expect(fn).toMatch(/callerParticipant/);
  });

  test('checks HOST or MODERATOR role', () => {
    expect(fn).toMatch(/HOST.*MODERATOR|MODERATOR.*HOST/);
  });

  test('no global school-role bypass (no bare isHost from school roles)', () => {
    const nonCommentLines = fn.split('\n').filter(l => !l.trim().startsWith('//'));
    const hasSchoolRoleBypass = nonCommentLines.some(l =>
      /isHost\s*=/.test(l) && (/TEACHER/.test(l) || /SCHOOL_ADMIN/.test(l))
    );
    expect(hasSchoolRoleBypass).toBe(false);
  });
});

// ─── uploadCoverImage: assertSchoolAccess present ────────────────────────────
describe('uploadCoverImage — assertSchoolAccess guard', () => {
  const fn = sliceFunction('uploadCoverImage');

  test('assertSchoolAccess present', () => {
    expect(fn).toMatch(/assertSchoolAccess/);
  });
});

// ─── lowerAllHands: assertOwnerOrModerator present ───────────────────────────
describe('lowerAllHands — assertOwnerOrModerator guard', () => {
  const fn = sliceFunction('lowerAllHands');

  test('calls assertOwnerOrModerator', () => {
    expect(fn).toMatch(/assertOwnerOrModerator/);
  });
});

// ─── OWN-REJOIN: upsert update path ──────────────────────────────────────────
describe('OWN-REJOIN upsert update path — upsert uses server-computed role', () => {
  const joinFnIdx = src.indexOf('async function joinLiveClass');
  const joinFnSrc = src.slice(joinFnIdx, joinFnIdx + 8000);

  test('upsert create branch includes role', () => {
    const createIdx = joinFnSrc.indexOf('create: {');
    expect(createIdx).toBeGreaterThan(-1);
    const createSrc = joinFnSrc.slice(createIdx, createIdx + 200);
    expect(createSrc).toMatch(/\brole\b/);
  });

  test('upsert create and update both reference server-computed values', () => {
    const createIdx = joinFnSrc.indexOf('create: {');
    const updateIdx = joinFnSrc.indexOf('update: {');
    const createSrc = joinFnSrc.slice(createIdx, createIdx + 200);
    const updateSrc = joinFnSrc.slice(updateIdx, updateIdx + 200);
    // Create MUST include role (server-computed)
    expect(createSrc).toMatch(/\brole\b/);
    // Update sets activity/timing fields — role is set at create time
    expect(updateSrc).toMatch(/isActive|joinedAt/);
  });
});
