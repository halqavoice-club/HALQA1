'use strict';
/**
 * Voice Club — Remaining Fixes Regression Tests (source-grep style)
 *
 * Covers:
 *  FIX-P2A    mobile AppState active handler re-POSTs /join on 403 or user absence
 *  FIX-LOW08  pushSyncEvent has earlyBufferActive guard (mirrors pushUserJoinedEvent)
 *  FIX-LOW09  30s poll empty-snapshot guard documented as comment (no code change)
 *  FIX-STATEVERSION-DOC  onStageState comment + architectural note doc exist
 *
 * Style mirrors voice-forensic-fixes.test.js and voice-leave-removal-fix.test.js.
 */

const fs   = require('fs');
const path = require('path');

const MOBILE_PATH = path.join(__dirname, '../../../mobile/app/voice/[id].tsx');
const STORE_PATH  = path.join(__dirname, '../../../frontend/src/store/voice.store.ts');
const VRV_PATH    = path.join(__dirname, '../../../frontend/src/components/voice/VoiceRoomView.tsx');
const HOOK_PATH   = path.join(__dirname, '../../../frontend/src/hooks/useVoiceRoom.ts');
const NOTE_PATH   = path.join(__dirname, '../../../.agents/tasks/voice-stateversion-architectural-note.md');

const mobileSrc = fs.existsSync(MOBILE_PATH) ? fs.readFileSync(MOBILE_PATH, 'utf8') : '';
const storeSrc  = fs.existsSync(STORE_PATH)  ? fs.readFileSync(STORE_PATH,  'utf8') : '';
const vrvSrc    = fs.existsSync(VRV_PATH)    ? fs.readFileSync(VRV_PATH,    'utf8') : '';
const hookSrc   = fs.existsSync(HOOK_PATH)   ? fs.readFileSync(HOOK_PATH,   'utf8') : '';
const noteSrc   = fs.existsSync(NOTE_PATH)   ? fs.readFileSync(NOTE_PATH,   'utf8') : '';

// ═══════════════════════════════════════════════════════════════════════
// FIX-P2A — AppState active handler re-POSTs /join when user absent or 403
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-P2A — AppState foreground handler re-joins on 403 or user absence', () => {
  test('AppState active handler has an async doForegroundSync wrapper (not a bare .then)', () => {
    // The fix introduces an async function named doForegroundSync to handle
    // the multi-step 403/absent check cleanly.
    expect(mobileSrc).toMatch(/doForegroundSync/);
  });

  test('AppState active handler checks for 403 status and calls api.post join', () => {
    // The handler must POST /join when it catches a 403 from the stage-state GET.
    const appStateIdx = mobileSrc.indexOf('appStateRef');
    expect(appStateIdx).toBeGreaterThan(-1);
    // Look within a 3000 char window covering the whole AppState useEffect
    const handlerSnippet = mobileSrc.slice(appStateIdx, appStateIdx + 3000);
    expect(handlerSnippet).toMatch(/status\s*===\s*403/);
    expect(handlerSnippet).toMatch(/api\.post.*\/join/);
  });

  test('AppState active handler checks for user absence in stageParticipants and calls api.post join', () => {
    const appStateIdx = mobileSrc.indexOf('appStateRef');
    const handlerSnippet = mobileSrc.slice(appStateIdx, appStateIdx + 3000);
    // Must check whether the user's own userId appears in stageParticipants
    expect(handlerSnippet).toMatch(/stageParticipants/);
    expect(handlerSnippet).toMatch(/userPresent|user.*id.*some|some.*userId/);
  });

  test('AppState active handler does NOT call handleJoin (avoids full-rejoin side effects)', () => {
    const appStateIdx = mobileSrc.indexOf('appStateRef');
    const handlerSnippet = mobileSrc.slice(appStateIdx, appStateIdx + 3000);
    // Calling handleJoin would re-run LiveKit setup, full state hydration, etc.
    // The fix must only POST /join + re-fetch stage-state, not the full flow.
    expect(handlerSnippet).not.toMatch(/handleJoin\s*\(\s*\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// FIX-LOW08 — pushSyncEvent earlyBufferActive guard
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-LOW08 — pushSyncEvent has earlyBufferActive guard', () => {
  test('pushSyncEvent checks earlyBufferActive and returns s when false (mirrors pushUserJoinedEvent)', () => {
    // Find the pushSyncEvent *implementation* block (not the interface declaration).
    // The interface line is "pushSyncEvent: (e: VoiceState[..." — skip it by searching
    // for the arrow-function implementation form "pushSyncEvent: (e) =>".
    const syncIdx = storeSrc.indexOf('pushSyncEvent: (e) =>');
    expect(syncIdx).toBeGreaterThan(-1);
    const syncSnippet = storeSrc.slice(syncIdx, syncIdx + 400);
    // Must bail (return s) when earlyBufferActive is false
    expect(syncSnippet).toMatch(/earlyBufferActive/);
    expect(syncSnippet).toMatch(/return\s+s/);
  });

  test('pushUserJoinedEvent and pushQueueUpdatedEvent still have the earlyBufferActive guard (no regression)', () => {
    // Confirm that existing guards in the two sibling functions were not accidentally removed
    expect(storeSrc).toMatch(/pushUserJoinedEvent[\s\S]{0,300}earlyBufferActive/);
    expect(storeSrc).toMatch(/pushQueueUpdatedEvent[\s\S]{0,300}earlyBufferActive/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// FIX-LOW09 — 30s poll empty-snapshot guard has the documenting comment
//             (no code change — guard is intentionally kept)
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-LOW09 — 30s poll empty-snapshot guard is documented (code unchanged)', () => {
  test('VoiceRoomView 30s poll still bails on empty stageParticipants (guard not removed)', () => {
    // The guard must remain — intentional tradeoff documented in FIX-LOW09 analysis.
    expect(vrvSrc).toMatch(/if\s*\(!data\?\.stageParticipants\?\.length\)/);
  });

  test('VoiceRoomView 30s poll guard has FIX-LOW09 documenting comment', () => {
    // A comment explaining the intentional guard must be present above the bail line.
    expect(vrvSrc).toMatch(/FIX-LOW09/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// FIX-STATEVERSION-DOC — onStageState has the ordering limitation comment
//                         and architectural note doc exists
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-STATEVERSION-DOC — stateVersion ordering limitation is documented', () => {
  test('useVoiceRoom.ts has a comment referencing F-LOW-07 or stateVersion near onStageState', () => {
    // The architectural comment must be present in the hook file.
    expect(hookSrc).toMatch(/F-LOW-07|stateVersion/);
  });

  test('useVoiceRoom.ts comment references the known gap and deferred fix', () => {
    // The comment must mention the deferred nature and the architectural note doc.
    expect(hookSrc).toMatch(/voice-stateversion-architectural-note/);
  });

  test('architectural note document exists and mentions stateVersion ordering', () => {
    expect(noteSrc).toBeTruthy();
    expect(noteSrc).toMatch(/stateVersion|sequence number|seq/i);
  });

  test('architectural note document recommends deferring to a dedicated PR', () => {
    expect(noteSrc).toMatch(/[Dd]efer/);
  });
});
