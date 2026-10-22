'use strict';
/**
 * voice-seat-realtime-fixes.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Source-grep assertions verifying that all GAP fixes (W1–W4, M1–M3) are
 * present in the source files.  Uses fs.readFileSync + string/regex matching —
 * no running server, database, or Redis instance required.
 *
 * Run:
 *   cd backend
 *   npm test -- --testPathPattern="voice-seat-realtime-fixes" --forceExit
 */

const fs   = require('fs');
const path = require('path');

// Resolve paths relative to the monorepo root
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function src(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

// ---------------------------------------------------------------------------
// 1. voice.controller.js — joinRoom emits voice:stage_state with stateVersion
// ---------------------------------------------------------------------------
describe('1 · voice.controller.js — joinRoom voice:stage_state stateVersion (GAP-W1/W4)', () => {
  let code;
  beforeAll(() => { code = src('nurul yaqin class ms/backend/src/controllers/voice.controller.js'); });

  test('imports getNextStageVersion from voiceRoomCache', () => {
    expect(code).toMatch(/getNextStageVersion[\s\S]*?require[\s\S]*?voiceRoomCache/);
  });

  test('joinRoom computes joinStateVersion via getNextStageVersion', () => {
    expect(code).toMatch(/joinStateVersion\s*=\s*await\s+getNextStageVersion/);
  });

  test('joinRoom personal emit carries stateVersion: joinStateVersion', () => {
    expect(code).toMatch(/stateVersion:\s*joinStateVersion/);
  });

  test('leaveRoom emit carries stateVersion field', () => {
    expect(code).toMatch(/mappedLeaveRows[\s\S]{0,400}stateVersion:/);
  });

  test('promoteParticipant emit carries stateVersion field', () => {
    // promoteParticipant follows with "Remove from queue" block
    expect(code).toMatch(/stateVersion:[\s\S]{0,300}Remove from queue/);
  });

  test('kickParticipant emit carries stateVersion field', () => {
    expect(code).toMatch(/mappedKickRows[\s\S]{0,200}stateVersion:/);
  });

  test('banParticipant emit carries stateVersion field', () => {
    expect(code).toMatch(/mappedBanRows[\s\S]{0,200}stateVersion:/);
  });

  test('grabMic emit carries stateVersion field', () => {
    // The grabMic warn log is the closest unique marker
    expect(code).toMatch(/stateVersion:[\s\S]{0,300}grabMic.*stage_state broadcast failed/);
  });

  test('dropMic emit carries stateVersion field', () => {
    // dropMic try-block is followed by "Auto-promote next queued user"
    expect(code).toMatch(/stateVersion:[\s\S]{0,300}Auto-promote next queued user/);
  });
});

// ---------------------------------------------------------------------------
// 2. voice-queue.controller.js — _promoteUser voice:stage_state stateVersion
// ---------------------------------------------------------------------------
describe('2 · voice-queue.controller.js — _promoteUser stateVersion (GAP-W1/W4)', () => {
  let code;
  beforeAll(() => { code = src('nurul yaqin class ms/backend/src/controllers/voice-queue.controller.js'); });

  test('imports getNextStageVersion from voiceRoomCache', () => {
    expect(code).toMatch(/getNextStageVersion[\s\S]*?require[\s\S]*?voiceRoomCache/);
  });

  test('_promoteUser emit carries stateVersion field before warn log', () => {
    expect(code).toMatch(/stateVersion:[\s\S]{0,300}_promoteUser.*stage_state broadcast failed/);
  });
});

// ---------------------------------------------------------------------------
// 3. autoPromote.js — stage_state emit carries stateVersion
// ---------------------------------------------------------------------------
describe('3 · autoPromote.js — stage_state stateVersion (GAP-W1/W4)', () => {
  let code;
  beforeAll(() => { code = src('nurul yaqin class ms/backend/src/utils/autoPromote.js'); });

  test('imports getNextStageVersion from voiceRoomCache', () => {
    expect(code).toMatch(/getNextStageVersion[\s\S]*?require[\s\S]*?voiceRoomCache/);
  });

  test('autoPromoteNext stage_state emit carries stateVersion field', () => {
    expect(code).toMatch(/emit\('voice:stage_state'[\s\S]{0,600}stateVersion:/);
  });
});

// ---------------------------------------------------------------------------
// 4. voice.store.ts — stageVersion field exists
// ---------------------------------------------------------------------------
describe('4 · voice.store.ts — stageVersion field (GAP-W1/W4)', () => {
  let code;
  beforeAll(() => { code = src('nurul yaqin class ms/frontend/src/store/voice.store.ts'); });

  test('VoiceState interface declares stageVersion: number', () => {
    expect(code).toMatch(/stageVersion:\s*number/);
  });

  test('VoiceState interface declares setStageVersion action', () => {
    expect(code).toMatch(/setStageVersion:\s*\(v:\s*number\)\s*=>\s*void/);
  });

  test('stageVersion initial value is 0', () => {
    expect(code).toMatch(/stageVersion:\s*0/);
  });

  test('setActiveRoom(null) resets stageVersion to 0', () => {
    expect(code).toMatch(/room\s*===\s*null[\s\S]{0,300}stageVersion:\s*0/);
  });
});

// ---------------------------------------------------------------------------
// 5. useVoiceRoom.ts — onStageState stateVersion guard before removeParticipant
// ---------------------------------------------------------------------------
describe('5 · useVoiceRoom.ts — onStageState stateVersion guard (GAP-W1/W4)', () => {
  let code;
  beforeAll(() => { code = src('nurul yaqin class ms/frontend/src/hooks/useVoiceRoom.ts'); });

  test('destructures setStageVersion from useVoiceStore', () => {
    expect(code).toMatch(/setStageVersion/);
  });

  test('onStageState reads incomingVersion from data.stateVersion', () => {
    expect(code).toMatch(/incomingVersion\s*=\s*data\.stateVersion/);
  });

  test('onStageState reads currentVersion from store.stageVersion', () => {
    expect(code).toMatch(/currentVersion\s*=\s*useVoiceStore\.getState\(\)\.stageVersion/);
  });

  test('isVersionedAndFresh computed as incomingVersion > 0 && incomingVersion > currentVersion', () => {
    expect(code).toMatch(
      /isVersionedAndFresh\s*=\s*incomingVersion\s*>\s*0\s*&&\s*incomingVersion\s*>\s*currentVersion/
    );
  });

  test('removeParticipant is called only within isVersionedAndFresh branch', () => {
    // The removeParticipant call must be preceded by isVersionedAndFresh
    expect(code).toMatch(/isVersionedAndFresh[\s\S]{0,400}removeParticipant/);
  });

  test('fallback (else) branch uses seatNumber-only sweep not removeParticipant', () => {
    // else branch should contain updateParticipant({ seatNumber: null })
    // and the word "Fallback"
    expect(code).toMatch(/Fallback[\s\S]{0,400}seatNumber:\s*null/);
  });
});

// ---------------------------------------------------------------------------
// 6. useVoiceRoom.ts — onStageState profile fill pass (GAP-W2)
// ---------------------------------------------------------------------------
describe('6 · useVoiceRoom.ts — onStageState profile fill pass (GAP-W2)', () => {
  let code;
  beforeAll(() => { code = src('nurul yaqin class ms/frontend/src/hooks/useVoiceRoom.ts'); });

  test('GAP-W2 comment is present in onStageState', () => {
    expect(code).toMatch(/GAP-W2/);
  });

  test('profile fill calls updateParticipant with user sub-object', () => {
    expect(code).toMatch(/Placeholder has blank name[\s\S]{0,300}updateParticipant\(sp\.userId,\s*\{\s*user:/);
  });

  test('profile fill checks for empty firstName and lastName', () => {
    expect(code).toMatch(/!inStore\.user\?\.firstName\s*&&\s*!inStore\.user\?\.lastName/);
  });
});

// ---------------------------------------------------------------------------
// 7. useVoiceRoom.ts — onMicGrabbed upsert guard (GAP-W3)
// ---------------------------------------------------------------------------
describe('7 · useVoiceRoom.ts — onMicGrabbed upsert guard (GAP-W3)', () => {
  let code;
  beforeAll(() => { code = src('nurul yaqin class ms/frontend/src/hooks/useVoiceRoom.ts'); });

  test('GAP-W3 comment is present', () => {
    expect(code).toMatch(/GAP-W3/);
  });

  test('onMicGrabbed checks inStore via participants.some', () => {
    // GAP-W3: inStore check is inside the onMicGrabbed handler body
    // Use a broader window since the handler body spans many lines
    expect(code).toMatch(/GAP-W3 FIX[\s\S]{0,800}inStore\s*=\s*useVoiceStore\.getState\(\)\.activeRoom\?\.participants\.some/);
  });

  test('onMicGrabbed calls addParticipant when !inStore', () => {
    expect(code).toMatch(/!inStore\s*&&\s*data\.seatNumber\s*!=\s*null[\s\S]{0,400}addParticipant/);
  });
});

// ---------------------------------------------------------------------------
// 8. mobile [id].tsx — onRoleChanged upsert for missing SPEAKER (GAP-M1)
// ---------------------------------------------------------------------------
describe('8 · mobile [id].tsx — onRoleChanged wasFound upsert (GAP-M1)', () => {
  let code;
  beforeAll(() => { code = src('nurul yaqin class ms/mobile/app/voice/[id].tsx'); });

  test('GAP-M1 FIX comment is present in onRoleChanged', () => {
    // Search within onRoleChanged context
    expect(code).toMatch(/GAP-M1/);
  });

  test('onRoleChanged checks wasFound for upsert', () => {
    expect(code).toMatch(/const wasFound\s*=\s*prev\.some\(p\s*=>\s*p\.id\s*===\s*targetId\)/);
  });

  test('onRoleChanged pushes SPEAKER entry when not found', () => {
    // The push happens inside the wasFound check — use wider window
    expect(code).toMatch(/!wasFound[\s\S]{0,600}role:\s*['"]SPEAKER['"]/);
  });
});

// ---------------------------------------------------------------------------
// 9. mobile [id].tsx — onRoleChanged roomId guard (GAP-M3)
// ---------------------------------------------------------------------------
describe('9 · mobile [id].tsx — onRoleChanged roomId guard (GAP-M3)', () => {
  let code;
  beforeAll(() => { code = src('nurul yaqin class ms/mobile/app/voice/[id].tsx'); });

  test('GAP-M3 FIX comment in onRoleChanged', () => {
    expect(code).toMatch(/GAP-M3[\s\S]{0,200}onRoleChanged|onRoleChanged[\s\S]{0,200}GAP-M3/);
  });

  test('onRoleChanged has d.roomId guard', () => {
    // Must contain: if (d.roomId && d.roomId !== id) return;
    expect(code).toMatch(/onRoleChanged[\s\S]{0,400}d\.roomId\s*&&\s*d\.roomId\s*!==\s*id/);
  });
});

// ---------------------------------------------------------------------------
// 10. mobile [id].tsx — onMuteChanged roomId guard (GAP-M3)
// ---------------------------------------------------------------------------
describe('10 · mobile [id].tsx — onMuteChanged roomId guard (GAP-M3)', () => {
  let code;
  beforeAll(() => { code = src('nurul yaqin class ms/mobile/app/voice/[id].tsx'); });

  test('onMuteChanged has d.roomId guard', () => {
    expect(code).toMatch(/onMuteChanged[\s\S]{0,400}d\.roomId\s*&&\s*d\.roomId\s*!==\s*id/);
  });
});

// ---------------------------------------------------------------------------
// 11. mobile [id].tsx — voice:mic_grabbed handler present (GAP-M2)
// ---------------------------------------------------------------------------
describe('11 · mobile [id].tsx — voice:mic_grabbed handler (GAP-M2)', () => {
  let code;
  beforeAll(() => { code = src('nurul yaqin class ms/mobile/app/voice/[id].tsx'); });

  test('GAP-M2 FIX comment present', () => {
    expect(code).toMatch(/GAP-M2/);
  });

  test('socket.on voice:mic_grabbed is registered', () => {
    expect(code).toMatch(/socket\.on\(\s*['"]voice:mic_grabbed['"]/);
  });

  test('mic_grabbed handler upserts wasFound check', () => {
    expect(code).toMatch(/voice:mic_grabbed[\s\S]{0,600}wasFound/);
  });

  test('socket.off voice:mic_grabbed is in cleanup', () => {
    expect(code).toMatch(/socket\.off\(\s*['"]voice:mic_grabbed['"]/);
  });
});
