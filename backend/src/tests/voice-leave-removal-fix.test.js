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
// FIX-L002 web — onStageState sweep uses removeParticipant for absent entries
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-L002 web — onStageState sweep calls removeParticipant', () => {
  test('onStageState sweep calls removeParticipant for participants absent from snapshot', () => {
    const stageStateIdx = hookSrc.indexOf('const onStageState');
    expect(stageStateIdx).toBeGreaterThan(-1);
    // Use 5000 chars — the sweep block sits ~3800 chars into the function
    const sweepSnippet = hookSrc.slice(stageStateIdx, stageStateIdx + 5000);
    expect(sweepSnippet).toMatch(/removeParticipant\s*\(/);
  });

  test('onStageState sweep no longer uses only seatNumber-null updateParticipant for absent entries', () => {
    // The old pattern was: if (p.seatNumber != null && !snapshotIds.has(p.userId)) updateParticipant(...)
    // After fix, that specific conditional no longer exists — replaced by removeParticipant.
    const stageStateIdx = hookSrc.indexOf('const onStageState');
    const sweepSnippet = hookSrc.slice(stageStateIdx, stageStateIdx + 5000);
    expect(sweepSnippet).not.toMatch(/p\.seatNumber\s*!=\s*null\s*&&\s*!snapshotIds\.has/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// FIX-L002 mobile — applyStageSnapshot removes participants absent from snapshot
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-L002 mobile — applyStageSnapshot removes absent participants', () => {
  test('applyStageSnapshot filters out participants absent from snapshot', () => {
    const applyIdx = mobileSrc.indexOf('const applyStageSnapshot');
    expect(applyIdx).toBeGreaterThan(-1);
    const applySnippet = mobileSrc.slice(applyIdx, applyIdx + 1500);
    // Must use .filter(p => inStageIds.has(p.id)) or equivalent
    expect(applySnippet).toMatch(/\.filter\s*\(\s*p\s*=>\s*inStageIds\.has\s*\(\s*p\.id\s*\)\s*\)/);
  });

  test('applyStageSnapshot does not still use the seatNumber-only clear pattern', () => {
    const applyIdx = mobileSrc.indexOf('const applyStageSnapshot');
    const applySnippet = mobileSrc.slice(applyIdx, applyIdx + 1500);
    // Old pattern: updated[i] = { ...updated[i], seatNumber: null }
    // After fix this loop is replaced by a filter — old pattern must be gone
    expect(applySnippet).not.toMatch(/updated\[i\]\s*=\s*\{[^}]*seatNumber:\s*null\s*\}/);
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
