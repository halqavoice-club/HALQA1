'use strict';
/**
 * HALQA — Live Class Web/RN Parity Tests (Phase 2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Source-level audits verifying:
 *
 * PARITY-01: Web LiveClassRoomImpl.tsx registers all required socket events
 * PARITY-02: RN live-class/[id].tsx registers all required socket events
 * PARITY-03: Dead event liveclass:you_can_speak removed from both clients
 * PARITY-04: Dead host-transfer socket listeners removed from Web
 * PARITY-05: Dead moderator-promotion socket listeners removed from Web
 * PARITY-06: RN GoLiveModal includes maxSpeakers, isRecorded, whiteboardEnabled,
 *            quranPanelEnabled in its API call
 * PARITY-07: Web promoteToModerator / demoteModerator do NOT call non-existent API
 * PARITY-08: RN handleTransferHost does NOT call non-existent /transfer API
 * PARITY-09: RN handlePromoteModerator / handleDemoteModerator do NOT call non-existent API
 * PARITY-10: Host ownership rule — assertOwner present in create/start/end/update/delete
 */

const fs   = require('fs');
const path = require('path');

// ─── Source file paths ────────────────────────────────────────────────────────
const WEB_ROOM = path.join(
  __dirname,
  '../../../../frontend/src/components/live-class/LiveClassRoomImpl.tsx'
);
const RN_ROOM = path.join(
  __dirname,
  '../../../../mobile/app/live-class/[id].tsx'
);
const RN_LIST = path.join(
  __dirname,
  '../../../../mobile/app/(tabs)/live-class.tsx'
);
const BACKEND_CTRL = path.join(
  __dirname,
  '../controllers/live-class.controller.js'
);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function readSrc(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// PARITY-01: Required socket events registered on Web
// ─────────────────────────────────────────────────────────────────────────────
describe('PARITY-01: Web registers required socket events', () => {
  let src;
  beforeAll(() => { src = readSrc(WEB_ROOM); });

  const required = [
    'liveclass:user_joined',
    'liveclass:user_left',
    'liveclass:mute_changed',
    'liveclass:mute_all',
    'liveclass:unmute_all',
    'liveclass:hand_raised',
    'liveclass:hand_lowered',
    'liveclass:hand_approved',
    'liveclass:hand_rejected',
    'liveclass:speak_request',
    'liveclass:all_hands_lowered',
    'liveclass:message',
    'liveclass:message_deleted',
    'liveclass:ended',
    'liveclass:you_were_kicked',
    'liveclass:updated',
    'liveclass:open_mic_changed',
    'liveclass:recording_started',
    'liveclass:recording_stopped',
    'liveclass:reaction',
    'liveclass:grant_mic',
    'liveclass:revoke_mic',
    'liveclass:speaker_added',
    'liveclass:speaker_removed',
    'liveclass:speaker_demoted',
    'liveclass:you_were_demoted',
    'liveclass:poll',
    'liveclass:quran_position',
    'liveclass:draw',
  ];

  required.forEach(event => {
    test(`Web registers ${event}`, () => {
      if (!src) return; // skip if frontend not present in test env
      expect(src).toMatch(new RegExp(`socket\\.on\\(['"\`]${event.replace(':', '\\:')}['"\`]`));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARITY-02: Required socket events registered on RN
// ─────────────────────────────────────────────────────────────────────────────
describe('PARITY-02: RN registers required socket events', () => {
  let src;
  beforeAll(() => { src = readSrc(RN_ROOM); });

  const required = [
    'liveclass:message',
    'liveclass:hand_raised',
    'liveclass:hand_lowered',
    'liveclass:hand_approved',
    'liveclass:hand_rejected',
    'liveclass:user_joined',
    'liveclass:user_left',
    'liveclass:mute_all',
    'liveclass:unmute_all',
    'liveclass:mute_changed',
    'liveclass:ended',
    'liveclass:you_were_kicked',
    'liveclass:updated',
    'liveclass:open_mic_changed',
    'liveclass:recording_started',
    'liveclass:recording_stopped',
    'liveclass:reaction',
    'liveclass:speak_request',
    'liveclass:all_hands_lowered',
    'liveclass:message_deleted',
    'liveclass:grant_mic',
    'liveclass:revoke_mic',
    'liveclass:speaker_added',
    'liveclass:speaker_removed',
    'liveclass:speaker_demoted',
    'liveclass:you_were_demoted',
    'liveclass:poll',
    'liveclass:quran_position',
    'liveclass:draw',
  ];

  required.forEach(event => {
    test(`RN registers ${event}`, () => {
      if (!src) return;
      expect(src).toMatch(new RegExp(`socket\\.on\\(['"\`]${event.replace(':', '\\:')}['"\`]`));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARITY-03: Dead event liveclass:you_can_speak removed from both clients
// ─────────────────────────────────────────────────────────────────────────────
describe('PARITY-03: Dead event liveclass:you_can_speak removed from clients', () => {
  test('Web does NOT register liveclass:you_can_speak (backend never emits it)', () => {
    const src = readSrc(WEB_ROOM);
    if (!src) return;
    // Must not have an active socket.on registration for this dead event
    expect(src).not.toMatch(/socket\.on\(['"`]liveclass:you_can_speak['"`]/);
  });

  test('RN does NOT register liveclass:you_can_speak (backend never emits it)', () => {
    const src = readSrc(RN_ROOM);
    if (!src) return;
    expect(src).not.toMatch(/socket\.on\(['"`]liveclass:you_can_speak['"`]/);
  });

  test('Backend controller does NOT emit liveclass:you_can_speak', () => {
    const src = readSrc(BACKEND_CTRL);
    if (!src) return;
    expect(src).not.toMatch(/emit\(['"`]liveclass:you_can_speak['"`]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARITY-04: Dead host-transfer socket listeners removed from Web
// ─────────────────────────────────────────────────────────────────────────────
describe('PARITY-04: Dead host-transfer socket listeners removed from Web', () => {
  let src;
  beforeAll(() => { src = readSrc(WEB_ROOM); });

  test('Web does NOT register liveclass:host_transferred (no backend endpoint)', () => {
    if (!src) return;
    expect(src).not.toMatch(/socket\.on\(['"`]liveclass:host_transferred['"`]/);
  });

  test('Web does NOT register liveclass:you_are_host (no backend endpoint)', () => {
    if (!src) return;
    expect(src).not.toMatch(/socket\.on\(['"`]liveclass:you_are_host['"`]/);
  });

  test('Web does NOT register liveclass:role_changed (no backend endpoint)', () => {
    if (!src) return;
    expect(src).not.toMatch(/socket\.on\(['"`]liveclass:role_changed['"`]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARITY-05: Dead moderator-promotion socket listeners removed from Web
// ─────────────────────────────────────────────────────────────────────────────
describe('PARITY-05: Dead moderator-promotion socket listeners removed from Web', () => {
  let src;
  beforeAll(() => { src = readSrc(WEB_ROOM); });

  test('Web does NOT register liveclass:moderator_promoted (no backend endpoint)', () => {
    if (!src) return;
    expect(src).not.toMatch(/socket\.on\(['"`]liveclass:moderator_promoted['"`]/);
  });

  test('Web does NOT register liveclass:moderator_demoted (no backend endpoint)', () => {
    if (!src) return;
    expect(src).not.toMatch(/socket\.on\(['"`]liveclass:moderator_demoted['"`]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARITY-06: RN GoLiveModal includes backend-supported fields
// ─────────────────────────────────────────────────────────────────────────────
describe('PARITY-06: RN GoLiveModal includes maxSpeakers, isRecorded, whiteboardEnabled, quranPanelEnabled', () => {
  let src;
  beforeAll(() => { src = readSrc(RN_LIST); });

  test('GoLiveModal sends maxSpeakers in API call', () => {
    if (!src) return;
    expect(src).toMatch(/maxSpeakers/);
  });

  test('GoLiveModal sends isRecorded in API call', () => {
    if (!src) return;
    expect(src).toMatch(/isRecorded/);
  });

  test('GoLiveModal sends whiteboardEnabled in API call', () => {
    if (!src) return;
    expect(src).toMatch(/whiteboardEnabled/);
  });

  test('GoLiveModal sends quranPanelEnabled in API call', () => {
    if (!src) return;
    expect(src).toMatch(/quranPanelEnabled/);
  });

  test('GoLiveModal sends handRaiseEnabled in API call', () => {
    if (!src) return;
    expect(src).toMatch(/handRaiseEnabled/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARITY-07: Web promoteToModerator / demoteModerator do NOT call non-existent API
// ─────────────────────────────────────────────────────────────────────────────
describe('PARITY-07: Web moderator promotion does NOT call non-existent backend endpoint', () => {
  let src;
  beforeAll(() => { src = readSrc(WEB_ROOM); });

  test('Web promoteToModerator does NOT call /moderator/ API endpoint', () => {
    if (!src) return;
    // Must not have: api.post('/live-classes/' + id + '/moderator/'
    expect(src).not.toMatch(/api\.post\(.*\/moderator\//);
  });

  test('Web demoteModerator does NOT call /moderator/ API endpoint', () => {
    if (!src) return;
    expect(src).not.toMatch(/api\.delete\(.*\/moderator\//);
  });

  test('Web promoteToModerator surfaces "not available" message instead', () => {
    if (!src) return;
    // The stub must show a toast or message (not available)
    const idx = src.indexOf('const promoteToModerator');
    const fn = src.slice(idx, idx + 300);
    expect(fn).toMatch(/not available/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARITY-08: RN handleTransferHost does NOT call non-existent /transfer API
// ─────────────────────────────────────────────────────────────────────────────
describe('PARITY-08: RN handleTransferHost does NOT call non-existent /transfer endpoint', () => {
  let src;
  beforeAll(() => { src = readSrc(RN_ROOM); });

  test('RN handleTransferHost does NOT call /live-classes/:id/transfer/', () => {
    if (!src) return;
    expect(src).not.toMatch(/api\.post\(.*\/transfer\//);
  });

  test('RN handleTransferHost surfaces "not available" message instead', () => {
    if (!src) return;
    const idx = src.indexOf('const handleTransferHost');
    const fn = src.slice(idx, idx + 400);
    expect(fn).toMatch(/not available/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARITY-09: RN handlePromoteModerator / handleDemoteModerator do NOT call API
// ─────────────────────────────────────────────────────────────────────────────
describe('PARITY-09: RN moderator handlers do NOT call non-existent /moderator/ endpoint', () => {
  let src;
  beforeAll(() => { src = readSrc(RN_ROOM); });

  test('RN handlePromoteModerator does NOT call /moderator/ API', () => {
    if (!src) return;
    // Extract just the handlePromoteModerator function body
    const idx = src.indexOf('const handlePromoteModerator');
    const fn = src.slice(idx, idx + 600);
    expect(fn).not.toMatch(/api\.post.*moderator/);
  });

  test('RN handleDemoteModerator does NOT call /moderator/ API', () => {
    if (!src) return;
    const idx = src.indexOf('const handleDemoteModerator');
    const fn = src.slice(idx, idx + 600);
    expect(fn).not.toMatch(/api\.delete.*moderator/);
  });

  test('RN handlePromoteModerator surfaces "not available" message', () => {
    if (!src) return;
    const idx = src.indexOf('const handlePromoteModerator');
    const fn = src.slice(idx, idx + 600);
    expect(fn).toMatch(/not available/i);
  });

  test('RN handleDemoteModerator surfaces "not available" message', () => {
    if (!src) return;
    const idx = src.indexOf('const handleDemoteModerator');
    const fn = src.slice(idx, idx + 600);
    expect(fn).toMatch(/not available/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARITY-10: Host ownership rule enforced in backend
// ─────────────────────────────────────────────────────────────────────────────
describe('PARITY-10: Host ownership — authorization applied to all mutation functions', () => {
  let src;
  beforeAll(() => { src = readSrc(BACKEND_CTRL); });

  // DEL-HOST Gap 1 fix: updateLiveClass no longer uses assertOwner — it uses
  // isHostForEdit (creator OR delegated host) as the gate, with field-level
  // restrictions below. deleteLiveClass remains assertOwner (structural op).
  // startLiveClass and endLiveClass use assertHostOrDelegate (operational ops).
  ['deleteLiveClass'].forEach(fn => {
    test(`${fn} calls assertOwner (structural op — creator only)`, () => {
      if (!src) return;
      const idx = src.indexOf(`async function ${fn}`);
      expect(idx).toBeGreaterThan(-1);
      const body = src.slice(idx, idx + 800);
      expect(body).toMatch(/assertOwner/);
    });
  });

  test('updateLiveClass uses isHostForEdit gate (DEL-HOST Gap 1 fix — creator or delegated host)', () => {
    if (!src) return;
    const idx = src.indexOf('async function updateLiveClass');
    expect(idx).toBeGreaterThan(-1);
    const body = src.slice(idx, idx + 1500);
    // Gap 1: isHostForEdit replaces assertOwner as the entry gate
    expect(body).toMatch(/isHostForEdit/);
    // assertOwner NOT called in updateLiveClass (delegated host must reach field checks)
    expect(body).not.toMatch(/assertOwner\(lc,\s*req\.user\)/);
    // Creator-only field restrictions still enforced inside
    expect(body).toMatch(/isCreatorForEdit/);
    expect(body).toMatch(/maxSpeakers/);
    expect(body).toMatch(/isRecorded/);
  });

  ['startLiveClass', 'endLiveClass'].forEach(fn => {
    test(`${fn} calls assertHostOrDelegate (DEL-HOST operational op)`, () => {
      if (!src) return;
      const idx = src.indexOf(`async function ${fn}`);
      expect(idx).toBeGreaterThan(-1);
      const body = src.slice(idx, idx + 800);
      expect(body).toMatch(/assertHostOrDelegate/);
    });
  });

  test('assertOwner checks hostUserId !== user.id (creator-only, no bypass)', () => {
    if (!src) return;
    const idx = src.indexOf('function assertOwner');
    const fn = src.slice(idx, idx + 400);
    expect(fn).toMatch(/hostUserId !== user\.id/);
    expect(fn).not.toMatch(/SUPER_ADMIN/);
    expect(fn).not.toMatch(/SCHOOL_ADMIN/);
    expect(fn).not.toMatch(/isTeacher/);
  });

  test('No backend endpoint for /moderator/ route exists', () => {
    if (!src) return;
    // moderator promotion has no backend handler — must not exist in controller
    expect(src).not.toMatch(/promoteModerator|POST.*moderator.*participant/);
  });

  test('No backend endpoint for /transfer/ route exists', () => {
    if (!src) return;
    // host transfer has no backend handler
    expect(src).not.toMatch(/transferHost|async function transfer/);
  });
});
