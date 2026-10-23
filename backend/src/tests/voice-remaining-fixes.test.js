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
const NOTE_PATH   = path.join(__dirname, '../../../docs/voice-stateversion-architectural-note.md');
const APP_JS      = path.join(__dirname, '../app.js');

const mobileSrc = fs.existsSync(MOBILE_PATH) ? fs.readFileSync(MOBILE_PATH, 'utf8') : '';
const storeSrc  = fs.existsSync(STORE_PATH)  ? fs.readFileSync(STORE_PATH,  'utf8') : '';
const vrvSrc    = fs.existsSync(VRV_PATH)    ? fs.readFileSync(VRV_PATH,    'utf8') : '';
const hookSrc   = fs.existsSync(HOOK_PATH)   ? fs.readFileSync(HOOK_PATH,   'utf8') : '';
const noteSrc   = fs.existsSync(NOTE_PATH)   ? fs.readFileSync(NOTE_PATH,   'utf8') : '';
const appSrc    = fs.existsSync(APP_JS)      ? fs.readFileSync(APP_JS,      'utf8') : '';

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
    // Anchor on AppState.addEventListener (not appStateRef — appStateRef was moved
    // earlier in the file as part of R-003 fix so indexOf would find the wrong position).
    const appStateIdx = mobileSrc.indexOf('AppState.addEventListener');
    expect(appStateIdx).toBeGreaterThan(-1);
    // Look within a 3000 char window covering the whole AppState useEffect
    const handlerSnippet = mobileSrc.slice(appStateIdx, appStateIdx + 3000);
    expect(handlerSnippet).toMatch(/status\s*===\s*403/);
    expect(handlerSnippet).toMatch(/api\.post.*\/join/);
  });

  test('AppState active handler checks for user absence in stageParticipants and calls api.post join', () => {
    // Anchor on AppState.addEventListener for the same reason as above.
    const appStateIdx = mobileSrc.indexOf('AppState.addEventListener');
    const handlerSnippet = mobileSrc.slice(appStateIdx, appStateIdx + 3000);
    // Must check whether the user's own userId appears in stageParticipants
    expect(handlerSnippet).toMatch(/stageParticipants/);
    expect(handlerSnippet).toMatch(/userPresent|user.*id.*some|some.*userId/);
  });

  test('AppState active handler does NOT call handleJoin (avoids full-rejoin side effects)', () => {
    // Anchor on AppState.addEventListener for the same reason as above.
    const appStateIdx = mobileSrc.indexOf('AppState.addEventListener');
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

// ═══════════════════════════════════════════════════════════════════════
// G2 — Socket.IO ack on voice:join_room so client detects refused/rate-limited joins
// ═══════════════════════════════════════════════════════════════════════
describe('G2 — Backend voice:join_room handler calls ack callback', () => {
  // Extract the handler block (second occurrence of 'voice:join_room' is the socket.on handler)
  const firstIdx  = appSrc.indexOf('voice:join_room');
  const handlerIdx = appSrc.indexOf('voice:join_room', firstIdx + 1);
  const handler = handlerIdx > -1 ? appSrc.slice(handlerIdx, handlerIdx + 4000) : '';

  test('handler signature includes ack parameter', () => {
    expect(handler).toMatch(/async\s*\(\s*roomId\s*,\s*ack\s*\)/);
  });

  test('handler has a reply helper that calls ack', () => {
    expect(handler).toMatch(/typeof ack\s*===\s*['"]function['"]/);
  });

  test('handler replies ok:false rate_limited on rate limit', () => {
    const rlIdx = handler.indexOf('socketAllow');
    expect(rlIdx).toBeGreaterThan(-1);
    const rlSnippet = handler.slice(rlIdx, rlIdx + 300);
    expect(rlSnippet).toMatch(/rate_limited/);
  });

  test('handler replies ok:false not_active when participant not active', () => {
    expect(handler).toMatch(/not_active/);
  });

  test('handler replies ok:true on success', () => {
    expect(handler).toMatch(/ok:\s*true/);
  });

  test('handler replies ok:false error in catch block', () => {
    expect(handler).toMatch(/ok:\s*false.*reason:\s*['"]error['"]/);
  });
});

describe('G2 — Web useVoiceRoom.ts emitJoinRoomAck with ack + retry', () => {
  test('hook source defines emitJoinRoomAck function', () => {
    expect(hookSrc).toMatch(/const emitJoinRoomAck/);
  });

  test('emitJoinRoomAck passes an ack callback as second arg to sock.emit', () => {
    expect(hookSrc).toMatch(/sock\.emit\(\s*['"]voice:join_room['"]\s*,\s*rid\s*,\s*\(/);
  });

  test('emitJoinRoomAck retries on rate_limited (max 3, 2s backoff)', () => {
    expect(hookSrc).toMatch(/rate_limited/);
    expect(hookSrc).toMatch(/joinRetries\s*<\s*3/);
    expect(hookSrc).toMatch(/2000/);
  });

  test('main emit uses emitJoinRoomAck (not bare socket.emit)', () => {
    // The main emit (after listeners are registered) should call emitJoinRoomAck
    const emitIdx = hookSrc.indexOf('emitJoinRoomAck(socket, roomId)');
    expect(emitIdx).toBeGreaterThan(-1);
  });

  test('onReconnect uses emitJoinRoomAck', () => {
    const reconnectIdx = hookSrc.indexOf('onReconnect');
    expect(reconnectIdx).toBeGreaterThan(-1);
    const snippet = hookSrc.slice(reconnectIdx, reconnectIdx + 200);
    expect(snippet).toMatch(/emitJoinRoomAck/);
  });
});

describe('G2 — Mobile [id].tsx emitJoinRoomAck with ack + retry', () => {
  test('mobile source defines emitJoinRoomAck function', () => {
    expect(mobileSrc).toMatch(/const emitJoinRoomAck/);
  });

  test('mobile emitJoinRoomAck passes an ack callback to sock.emit', () => {
    expect(mobileSrc).toMatch(/sock\.emit\(\s*['"]voice:join_room['"]\s*,\s*rid\s*,\s*\(/);
  });

  test('mobile has joinRetriesRef for retry counting', () => {
    expect(mobileSrc).toMatch(/joinRetriesRef/);
  });

  test('mobile retries on rate_limited (max 3, 2s backoff)', () => {
    expect(mobileSrc).toMatch(/rate_limited/);
    expect(mobileSrc).toMatch(/joinRetriesRef\.current\s*<\s*3/);
    expect(mobileSrc).toMatch(/2000/);
  });

  test('mobile has no remaining bare socket.emit voice:join_room calls', () => {
    // All socket.emit('voice:join_room') calls should now go through emitJoinRoomAck.
    // Check that there are no bare socket.emit('voice:join_room', id) calls remaining
    // (emitJoinRoomAck uses sock.emit internally, which is fine).
    const matches = mobileSrc.match(/socket\.emit\(\s*['"]voice:join_room['"]\s*,/g);
    expect(matches).toBeNull();
  });

  test('mobile all 4 join locations use emitJoinRoomAck', () => {
    // Count occurrences of emitJoinRoomAck( calls — should be at least 4
    // (listener effect, onReconnect, handleJoin success, AppState foreground)
    const matches = mobileSrc.match(/emitJoinRoomAck\(/g);
    expect(matches).toBeTruthy();
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });
});
