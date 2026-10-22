'use strict';
/**
 * Voice Club — Leave/Removal-Side Fix Regression Tests
 *
 * Covers 5 fixes for the "user left not visible without page reload" defect:
 *
 *  FIX-L001  mobile onUserLeft has roomId guard
 *  FIX-L002  onStageState / applyStageSnapshot removes absent participants entirely
 *  FIX-L003  kickParticipant emits voice:stage_state after kick
 *  FIX-L004  joinRoom room-wide voice:stage_state has no stageRows.length guard
 *  FIX-L005  leaveRoom socket emit fires even if autoPromoteNext throws (try/finally)
 */

const fs   = require('fs');
const path = require('path');

const VOICE_CTRL  = path.join(__dirname, '../controllers/voice.controller.js');
const HOOK_SRC    = path.join(__dirname, '../../../frontend/src/hooks/useVoiceRoom.ts');
const MOBILE_PATH = path.join(__dirname, '../../../mobile/app/voice/[id].tsx');

const src      = fs.readFileSync(VOICE_CTRL, 'utf8');
const hookSrc  = fs.readFileSync(HOOK_SRC,   'utf8');
const mobileSrc = fs.existsSync(MOBILE_PATH) ? fs.readFileSync(MOBILE_PATH, 'utf8') : '';

function extractFn(source, fnName, nextFnName) {
  const start = source.indexOf('async function ' + fnName);
  if (start === -1) return '';
  const end = nextFnName
    ? source.indexOf('async function ' + nextFnName, start + 1)
    : source.length;
  return source.slice(start, end === -1 ? source.length : end);
}

// ═══════════════════════════════════════════════════════════════════════
// FIX-L001 — mobile onUserLeft has roomId in destructure and roomId guard
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-L001 — mobile onUserLeft roomId guard', () => {
  test('onUserLeft destructures roomId from payload', () => {
    // Must have { roomId in the type/destructure
    expect(mobileSrc).toMatch(/onUserLeft\s*=\s*\(\s*d\s*:\s*\{[^}]*roomId[^}]*\}/);
  });

  test('onUserLeft has roomId !== id early return guard', () => {
    const handlerIdx = mobileSrc.indexOf('const onUserLeft');
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerSnippet = mobileSrc.slice(handlerIdx, handlerIdx + 300);
    expect(handlerSnippet).toMatch(/d\.roomId\s*!==\s*id/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// FIX-L002 web — onStageState sweep clears seatNumber only (NOT removeParticipant)
// Stale voice:stage_state events can arrive out of order; removeParticipant
// would incorrectly remove newer joiners (F-008 regression).
// Departed-participant removal is handled by the 30s HTTP poll in VoiceRoomView.tsx.
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-L002 web — onStageState sweep clears seatNumber only (stale-snapshot safe)', () => {
  test('onStageState sweep clears seatNumber for absent stage participants', () => {
    const stageStateIdx = hookSrc.indexOf('const onStageState');
    expect(stageStateIdx).toBeGreaterThan(-1);
    const sweepSnippet = hookSrc.slice(stageStateIdx, stageStateIdx + 6000);
    // Must have the seatNumber-null sweep pattern (in the fallback else-branch)
    expect(sweepSnippet).toMatch(/p\.seatNumber\s*!=\s*null\s*&&\s*!snapshotIds\.has/);
    // Must call updateParticipant (in the fallback branch)
    expect(sweepSnippet).toMatch(/updateParticipant/);
  });

  test('onStageState stale/fallback branch uses seatNumber-only sweep (avoids stale-snapshot regression)', () => {
    // GAP-W1/W4 FIX: onStageState now has TWO branches:
    //  1. isVersionedAndFresh — safe to call removeParticipant (F-008 prevented by version guard)
    //  2. Fallback (stale/unversioned) — seatNumber:null only, NO removeParticipant
    // This test verifies the fallback branch is present and uses seatNumber:null.
    const stageStateIdx = hookSrc.indexOf('const onStageState');
    const sweepSnippet = hookSrc.slice(stageStateIdx, stageStateIdx + 6000);
    // Fallback branch must exist and clear seatNumber
    expect(sweepSnippet).toMatch(/Fallback[\s\S]{0,400}seatNumber:\s*null/);
    // removeParticipant must be gated by isVersionedAndFresh (not called unconditionally)
    expect(sweepSnippet).toMatch(/isVersionedAndFresh[\s\S]{0,400}removeParticipant/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// FIX-L002 mobile — applyStageSnapshot clears seatNumber only (stale-snapshot safe)
// Same rationale as web: stale socket events must not remove newer joiners.
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-L002 mobile — applyStageSnapshot clears seatNumber only (stale-snapshot safe)', () => {
  test('applyStageSnapshot clears seatNumber for absent stage participants', () => {
    const applyIdx = mobileSrc.indexOf('const applyStageSnapshot');
    expect(applyIdx).toBeGreaterThan(-1);
    const applySnippet = mobileSrc.slice(applyIdx, applyIdx + 1500);
    // Must clear seatNumber for absent stage participants
    expect(applySnippet).toMatch(/seatNumber.*null/);
  });

  test('applyStageSnapshot does NOT filter out participants (avoids stale-snapshot regression)', () => {
    const applyIdx = mobileSrc.indexOf('const applyStageSnapshot');
    const applySnippet = mobileSrc.slice(applyIdx, applyIdx + 1500);
    // Must NOT use .filter to remove absent participants (stale-snapshot safe)
    expect(applySnippet).not.toMatch(/\.filter\s*\(\s*p\s*=>\s*inStageIds\.has\s*\(\s*p\.id\s*\)\s*\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// FIX-L002-revised — 30s HTTP poll in VoiceRoomView.tsx removes departed participants
// This is the authoritative reconciliation path (direct DB fetch, not stale socket event)
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-L002-revised — VoiceRoomView 30s poll removes departed participants', () => {
  const VRV_PATH = path.join(__dirname, '../../../frontend/src/components/voice/VoiceRoomView.tsx');
  const vrvSrc = fs.existsSync(VRV_PATH) ? fs.readFileSync(VRV_PATH, 'utf8') : '';

  test('30s poll calls removeParticipant for participants absent from DB snapshot', () => {
    expect(vrvSrc).toBeTruthy();
    // The poll must call store.removeParticipant for departed participants
    expect(vrvSrc).toMatch(/removeParticipant/);
    // The removal must be guarded by the snapshot having content
    expect(vrvSrc).toMatch(/snapshotIds/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// FIX-L003 — kickParticipant emits voice:stage_state after kick
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-L003 — kickParticipant emits voice:stage_state', () => {
  test('kickParticipant source contains voice:stage_state emit', () => {
    const fn = extractFn(src, 'kickParticipant', 'banParticipant');
    expect(fn).toMatch(/emit\s*\(\s*'voice:stage_state'/);
  });

  test('voice:stage_state in kickParticipant is broadcast to voice:{roomId}', () => {
    const fn = extractFn(src, 'kickParticipant', 'banParticipant');
    // Must target the room channel, not the personal user channel
    expect(fn).toMatch(/\.to\s*\(\s*`voice:\$\{roomId\}`\s*\)\.emit\s*\(\s*'voice:stage_state'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// FIX-L004 — joinRoom room-wide stage_state has no stageRows.length < 100 guard
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-L004 — joinRoom room-wide voice:stage_state unconditional', () => {
  test('joinRoom source does NOT contain stageRows.length < 100 guard', () => {
    const fn = extractFn(src, 'joinRoom', 'leaveRoom');
    expect(fn).not.toMatch(/stageRows\.length\s*<\s*100/);
  });

  test('joinRoom still emits voice:stage_state to voice:{roomId} (room-wide)', () => {
    const fn = extractFn(src, 'joinRoom', 'leaveRoom');
    expect(fn).toMatch(/\.to\s*\(\s*`voice:\$\{roomId\}`\s*\)\.emit\s*\(\s*'voice:stage_state'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// FIX-L005 — leaveRoom socket emit fires even if autoPromoteNext throws
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-L005 — leaveRoom autoPromoteNext wrapped in try/catch, socket emit in try/finally', () => {
  test('leaveRoom wraps autoPromoteNext in try/catch', () => {
    const fn = extractFn(src, 'leaveRoom', 'endRoom');
    // autoPromoteNext must be inside a try block of its own
    expect(fn).toMatch(/try\s*\{\s*await autoPromoteNext/);
  });

  test('leaveRoom source contains try/finally wrapping the socket emit', () => {
    const fn = extractFn(src, 'leaveRoom', 'endRoom');
    // The finally block must contain the voice:user_left emit.
    // Use [\s\S]*? (dotAll via s flag alternative) to cross nested braces.
    expect(fn).toMatch(/finally\s*\{[\s\S]*?voice:user_left/);
  });
});
