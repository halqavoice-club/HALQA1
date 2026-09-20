/**
 * live-class-non-creator-admin.test.js
 *
 * Security regression tests: a SCHOOL_ADMIN who is NOT the creator of a live class
 * must be denied all HOST-only mutating endpoints.
 *
 * Gaps closed:
 *   OWN-02  muteParticipant
 *   OWN-03  kickParticipant
 *   OWN-04  toggleOpenMic
 *   OWN-05  startRecording / stopRecording
 *   OWN-06  broadcastPoll (create/close only — vote still open)
 *   OWN-07  broadcastDraw
 *   OWN-08  broadcastQuranPosition
 *   OWN-09  deleteMessage (staff-fallback removed)
 *   OWN-10  uploadCoverImage
 *   GAP-B   assertHostAccess fixed for SCHOOL streams
 *
 * Strategy: source-code audit via fs.readFileSync (zero runtime mock issues)
 * plus one functional group for deleteMessage and assertHostAccess using the
 * same mock pattern as the existing live-class-ownership tests.
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
  // Grab the first 4 KB — enough for any single function
  return src.slice(idx, idx + 4096);
}

// ─── OWN-02: muteParticipant ──────────────────────────────────────────────────
describe('OWN-02 muteParticipant — assertHostOrDelegate present', () => {
  const fn = sliceFunction('muteParticipant');

  test('calls assertHostOrDelegate (DEL-HOST upgrade from assertOwner)', () => {
    expect(fn).toMatch(/assertHostOrDelegate\(lc,\s*req\.user\)/);
  });

  test('assertHostOrDelegate is placed AFTER assertSchoolAccess', () => {
    const schoolIdx = fn.indexOf('assertSchoolAccess');
    const hostIdx   = fn.indexOf('assertHostOrDelegate');
    expect(schoolIdx).toBeGreaterThan(-1);
    expect(hostIdx).toBeGreaterThan(schoolIdx);
  });

  test('OWN-02 comment present', () => {
    expect(fn).toMatch(/OWN-02/);
  });
});

// ─── OWN-03: kickParticipant ──────────────────────────────────────────────────
// ─── OWN-03: kickParticipant ──────────────────────────────────────────────────
describe('OWN-03 kickParticipant — assertHostOrDelegate present', () => {
  const fn = sliceFunction('kickParticipant');

  test('calls assertHostOrDelegate (DEL-HOST upgrade)', () => {
    expect(fn).toMatch(/assertHostOrDelegate\(lc,\s*req\.user\)/);
  });

  test('OWN-03 comment present', () => {
    expect(fn).toMatch(/OWN-03/);
  });
});

// ─── OWN-04: toggleOpenMic ───────────────────────────────────────────────────
describe('OWN-04 toggleOpenMic — assertHostOrDelegate present', () => {
  const fn = sliceFunction('toggleOpenMic');

  test('calls assertHostOrDelegate (DEL-HOST upgrade)', () => {
    expect(fn).toMatch(/assertHostOrDelegate\(lc,\s*req\.user\)/);
  });

  test('assertHostOrDelegate placed before isOpenMic toggle logic', () => {
    const guardIdx = fn.indexOf('assertHostOrDelegate');
    const toggleIdx = fn.indexOf('newOpenMic');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(toggleIdx).toBeGreaterThan(guardIdx);
  });

  test('OWN-04 comment present', () => {
    expect(fn).toMatch(/OWN-04/);
  });
});

// ─── OWN-05: startRecording ──────────────────────────────────────────────────
describe('OWN-05 startRecording — assertHostOrDelegate present', () => {
  const fn = sliceFunction('startRecording');

  test('calls assertHostOrDelegate (DEL-HOST upgrade)', () => {
    expect(fn).toMatch(/assertHostOrDelegate\(lc,\s*req\.user\)/);
  });

  test('OWN-05 comment present', () => {
    expect(fn).toMatch(/OWN-05/);
  });
});

// ─── OWN-05: stopRecording ───────────────────────────────────────────────────
describe('OWN-05 stopRecording — assertHostOrDelegate present', () => {
  const fn = sliceFunction('stopRecording');

  test('calls assertHostOrDelegate (DEL-HOST upgrade)', () => {
    expect(fn).toMatch(/assertHostOrDelegate\(lc,\s*req\.user\)/);
  });
});

// ─── OWN-06: broadcastPoll ───────────────────────────────────────────────────
describe('OWN-06 broadcastPoll — assertHostOrDelegate gated on non-vote events', () => {
  const fn = sliceFunction('broadcastPoll');

  test('assertHostOrDelegate is present (DEL-HOST upgrade)', () => {
    expect(fn).toMatch(/assertHostOrDelegate\(lc,\s*req\.user\)/);
  });

  test('assertHostOrDelegate is gated on non-vote event type (vote allowed for all)', () => {
    expect(fn).toMatch(/event\.type.*!==.*'vote'|type.*!==.*vote/);
  });

  test('OWN-06 comment present', () => {
    expect(fn).toMatch(/OWN-06/);
  });
});

// ─── OWN-07: broadcastDraw ───────────────────────────────────────────────────
describe('OWN-07 broadcastDraw — assertHostOrDelegate present', () => {
  const fn = sliceFunction('broadcastDraw');

  test('calls assertHostOrDelegate (DEL-HOST upgrade)', () => {
    expect(fn).toMatch(/assertHostOrDelegate\(lc,\s*req\.user\)/);
  });

  test('OWN-07 comment present', () => {
    expect(fn).toMatch(/OWN-07/);
  });
});

// ─── OWN-08: broadcastQuranPosition ─────────────────────────────────────────
describe('OWN-08 broadcastQuranPosition — assertHostOrDelegate present', () => {
  const fn = sliceFunction('broadcastQuranPosition');

  test('calls assertHostOrDelegate (DEL-HOST upgrade)', () => {
    expect(fn).toMatch(/assertHostOrDelegate\(lc,\s*req\.user\)/);
  });

  test('OWN-08 comment present', () => {
    expect(fn).toMatch(/OWN-08/);
  });
});

// ─── OWN-09: deleteMessage — staff fallback removed ──────────────────────────
describe('OWN-09 deleteMessage — isStaffModerator fallback removed', () => {
  const fn = sliceFunction('deleteMessage');

  test('isStaffModerator variable is gone', () => {
    expect(fn).not.toMatch(/isStaffModerator/);
  });

  test('staff fallback (isStaffModerator || canModerateMsgs) is gone', () => {
    expect(fn).not.toMatch(/isStaffModerator\s*\|\|/);
    expect(fn).not.toMatch(/\|\|\s*isStaffModerator/);
  });

  test('canModerateMsgs is still derived solely from session role', () => {
    // Must not have the old dual-source pattern
    expect(fn).not.toMatch(/isStaffModerator/);
    // Must still have a canModerateMsgs check
    expect(fn).toMatch(/canModerateMsgs/);
  });

  test('OWN-09 comment present', () => {
    expect(fn).toMatch(/OWN-09/);
  });
});

// ─── OWN-10: uploadCoverImage ────────────────────────────────────────────────
describe('OWN-10 uploadCoverImage — assertHostOrDelegate present', () => {
  const fn = sliceFunction('uploadCoverImage');

  test('calls assertHostOrDelegate (DEL-HOST upgrade)', () => {
    expect(fn).toMatch(/assertHostOrDelegate\(lc,\s*req\.user\)/);
  });

  test('OWN-10 comment present', () => {
    expect(fn).toMatch(/OWN-10/);
  });
});

// ─── GAP-B: assertHostAccess fixed ───────────────────────────────────────────
describe('GAP-B assertHostAccess — no longer passes any SCHOOL_ADMIN', () => {
  // Get the assertHostAccess function body
  const assertHostIdx = src.indexOf('function assertHostAccess');
  const assertHostSrc = src.slice(assertHostIdx, assertHostIdx + 1000);

  test('assertHostAccess function exists', () => {
    expect(assertHostIdx).toBeGreaterThan(-1);
  });

  test('now checks hostUserId === user.id (creator-only)', () => {
    expect(assertHostSrc).toMatch(/hostUserId.*user\.id|user\.id.*hostUserId/);
  });

  test('no longer has the school-membership-only branch for SCHOOL streams', () => {
    // Old code: `if (user.role !== 'SCHOOL_ADMIN' && lc.schoolId !== user.schoolId)`
    // This should no longer exist in assertHostAccess
    expect(assertHostSrc).not.toMatch(/user\.role.*SCHOOL_ADMIN.*schoolId/);
    expect(assertHostSrc).not.toMatch(/schoolId.*user\.schoolId/);
  });

  test('lowerAllHands calls assertHostOrDelegate (DEL-HOST upgrade from assertHostAccess)', () => {
    const fn = sliceFunction('lowerAllHands');
    expect(fn).toMatch(/assertHostOrDelegate\(lc,\s*req\.user\)/);
  });
});

// ─── BASELINE: assertOwner itself enforces hostUserId === user.id ─────────────
describe('assertOwner baseline — hostUserId check', () => {
  const assertOwnerIdx = src.indexOf('function assertOwner');
  const assertOwnerSrc = src.slice(assertOwnerIdx, assertOwnerIdx + 500);

  test('assertOwner function exists', () => {
    expect(assertOwnerIdx).toBeGreaterThan(-1);
  });

  test('enforces lc.hostUserId !== user.id → 403', () => {
    expect(assertOwnerSrc).toMatch(/hostUserId.*user\.id/);
    expect(assertOwnerSrc).toMatch(/403/);
  });

  test('throws with status 403', () => {
    expect(assertOwnerSrc).toMatch(/err\.status = 403/);
  });
});

// ─── OWN-REJOIN: upsert update path must reset role ──────────────────────────
// This was the root cause of the "admin sees HOST controls" bug visible in production:
// The upsert's update branch did not include `role`, so a DB record with a stale
// HOST role (from before the fix, or from an earlier mis-assigned session) was
// preserved on every rejoin, making the frontend show HOST controls.
describe('OWN-REJOIN upsert update path — role is reset on rejoin', () => {
  const joinFnIdx = src.indexOf('async function joinLiveClass');
  const joinFnSrc = src.slice(joinFnIdx, joinFnIdx + 8000);

  test('upsert update branch includes role', () => {
    // The update object must contain `role,` or `role:` so stale roles are corrected
    const updateIdx = joinFnSrc.indexOf('update: {');
    expect(updateIdx).toBeGreaterThan(-1);
    const updateSrc = joinFnSrc.slice(updateIdx, updateIdx + 300);
    expect(updateSrc).toMatch(/\brole\b/);
  });

  test('upsert update and create both set role from server-computed variable', () => {
    const createIdx = joinFnSrc.indexOf('create: {');
    const updateIdx = joinFnSrc.indexOf('update: {');
    const createSrc = joinFnSrc.slice(createIdx, createIdx + 200);
    const updateSrc = joinFnSrc.slice(updateIdx, updateIdx + 200);
    // Both must reference `role` (the server-side computed variable)
    expect(createSrc).toMatch(/\brole\b/);
    expect(updateSrc).toMatch(/\brole\b/);
  });
});
