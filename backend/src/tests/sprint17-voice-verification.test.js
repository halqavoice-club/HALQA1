'use strict';
/**
 * Sprint 17 — Voice Club Gap Verification Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * VC-GAP-001 VERIFICATION: voiceMinutes credited on normal leave
 *   - L-8 FIX was already in place: leaveRoom() credits voiceMinutes to
 *     DailyUserStats for every participant on normal leave.
 *
 * VC-GAP-005 VERIFICATION: Kick/ban/unban are audit-logged
 *   - kickParticipant calls voiceAudit(PARTICIPANT_KICKED)
 *   - banParticipant calls voiceAudit(PARTICIPANT_BANNED)
 *   - unbanParticipant calls voiceAudit(PARTICIPANT_UNBANNED)
 */

const fs   = require('fs');
const path = require('path');

const CONTROLLER_PATH = path.join(__dirname, '../controllers/voice.controller.js');

describe('VC-GAP-001 VERIFIED: voiceMinutes credited on leaveRoom()', () => {

  test('voice.controller.js leaveRoom() calls dailyUserStats.upsert with voiceMinutes', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    // Find the leaveRoom function
    const leaveRoomStart = src.indexOf('async function leaveRoom');
    const leaveRoomEnd   = src.indexOf('async function', leaveRoomStart + 1);
    const leaveRoomBody  = src.slice(leaveRoomStart, leaveRoomEnd);

    // voiceMinutes must be credited inside leaveRoom (not just endRoom)
    expect(leaveRoomBody).toMatch(/voiceMinutes/);
    expect(leaveRoomBody).toMatch(/dailyUserStats\.upsert/);
    expect(leaveRoomBody).toMatch(/increment/);
  });

  test('voice.controller.js leaveRoom() uses joinedAt to calculate minutes', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const leaveRoomStart = src.indexOf('async function leaveRoom');
    const leaveRoomEnd   = src.indexOf('async function', leaveRoomStart + 1);
    const leaveRoomBody  = src.slice(leaveRoomStart, leaveRoomEnd);

    expect(leaveRoomBody).toMatch(/joinedAt/);
    expect(leaveRoomBody).toMatch(/listenMinutes|listenTime|minutes/i);
  });

  test('voice.controller.js endRoom() also credits voiceMinutes (existing behaviour)', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const endRoomStart = src.indexOf('async function endRoom');
    const endRoomEnd   = src.indexOf('async function', endRoomStart + 1);
    const endRoomBody  = src.slice(endRoomStart, endRoomEnd);

    expect(endRoomBody).toMatch(/voiceMinutes/);
    expect(endRoomBody).toMatch(/dailyUserStats\.upsert/);
  });

  test('L-8 FIX comment is present in leaveRoom', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    expect(src).toMatch(/L-8 FIX.*Track voice/i);
  });
});

describe('VC-GAP-005 VERIFIED: Kick/ban/unban are audit-logged', () => {

  test('kickParticipant calls voiceAudit with PARTICIPANT_KICKED', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const kickStart = src.indexOf('async function kickParticipant');
    const kickEnd   = src.indexOf('async function', kickStart + 1);
    const kickBody  = src.slice(kickStart, kickEnd);

    expect(kickBody).toMatch(/voiceAudit/);
    expect(kickBody).toMatch(/PARTICIPANT_KICKED/);
  });

  test('banParticipant calls voiceAudit with PARTICIPANT_BANNED', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const banStart = src.indexOf('async function banParticipant');
    const banEnd   = src.indexOf('async function', banStart + 1);
    const banBody  = src.slice(banStart, banEnd);

    expect(banBody).toMatch(/voiceAudit/);
    expect(banBody).toMatch(/PARTICIPANT_BANNED/);
  });

  test('unbanParticipant calls voiceAudit with PARTICIPANT_UNBANNED', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const unbanStart = src.indexOf('async function unbanParticipant');
    const unbanEnd   = src.indexOf('async function', unbanStart + 1);
    const unbanBody  = src.slice(unbanStart, unbanEnd);

    expect(unbanBody).toMatch(/voiceAudit/);
    expect(unbanBody).toMatch(/PARTICIPANT_UNBANNED/);
  });

  test('voiceAudit function is defined in the controller', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    // voiceAudit should be defined or imported
    expect(src).toMatch(/voiceAudit/);
    // It should write to some audit storage (VoiceAuditLog or similar)
    expect(src.match(/voiceAudit/g).length).toBeGreaterThanOrEqual(4);
  });

  test('voice.controller.js does NOT have kick/ban without audit (no raw kick without audit)', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');

    // Verify each moderation function has voiceAudit nearby
    // Extract kick function and confirm it contains voiceAudit
    const kickIdx  = src.indexOf('async function kickParticipant');
    const kickEnd  = src.indexOf('async function', kickIdx + 1);
    const kickBody = src.slice(kickIdx, kickEnd);
    expect(kickBody).toContain('voiceAudit');

    // Extract ban function
    const banIdx  = src.indexOf('async function banParticipant');
    const banEnd  = src.indexOf('async function', banIdx + 1);
    const banBody = src.slice(banIdx, banEnd);
    expect(banBody).toContain('voiceAudit');
  });
});
