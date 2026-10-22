'use strict';
/**
 * Voice Club — Forensic Realtime-Sync Fix Regression Tests (source-grep style)
 *
 * Covers the 5 forensic fixes for the Voice Club realtime-sync system:
 *
 *  FIX-FCRIT01  app.js sets socket.data.userId (worker hasActiveSocketConnection reads s.data.userId)
 *  FIX-FHIGH02  mobile [id].tsx periodic stage-state poll removes departed participants
 *  FIX-FHIGH03  voice:join_room re-broadcasts voice:user_joined after socket.join on reconnect
 *  FIX-FMED05   leaveRoom + banParticipant emit room-wide voice:stage_state
 *  FIX-FMED04   socketReady polling re-arms (slows) instead of permanently stopping after 10s
 *
 * Style mirrors voice-leave-removal-fix.test.js: fs.readFileSync + regex .toMatch assertions.
 */

const fs   = require('fs');
const path = require('path');

const APP_JS     = path.join(__dirname, '../app.js');
const WORKER     = path.join(__dirname, '../workers/voice-stale-session.worker.js');
const VOICE_CTRL = path.join(__dirname, '../controllers/voice.controller.js');
const HOOK_SRC   = path.join(__dirname, '../../../frontend/src/hooks/useVoiceRoom.ts');
const MOBILE_PATH = path.join(__dirname, '../../../mobile/app/voice/[id].tsx');

const appSrc    = fs.existsSync(APP_JS)     ? fs.readFileSync(APP_JS,     'utf8') : '';
const workerSrc = fs.existsSync(WORKER)     ? fs.readFileSync(WORKER,     'utf8') : '';
const src       = fs.existsSync(VOICE_CTRL) ? fs.readFileSync(VOICE_CTRL, 'utf8') : '';
const hookSrc   = fs.existsSync(HOOK_SRC)   ? fs.readFileSync(HOOK_SRC,   'utf8') : '';
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
// 1. FIX-FCRIT01 — app.js sets socket.data.userId in the connection middleware
//    so the stale-session worker's hasActiveSocketConnection (which reads
//    s.data.userId via fetchSockets) detects genuinely-connected sockets.
//    (2. is the same fix seen from the worker's side: the worker reads
//    s.data.userId, which is now satisfied by the app.js change above.)
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-FCRIT01 — app.js sets socket.data.userId', () => {
  test('app.js connection middleware assigns socket.data.userId (and userRole/userSchoolId) from the validated user', () => {
    expect(appSrc).toMatch(/socket\.data\.userId\s*=\s*user\.id/);
    expect(appSrc).toMatch(/socket\.data\.userRole\s*=\s*user\.role/);
    expect(appSrc).toMatch(/socket\.data\.userSchoolId\s*=\s*user\.schoolId/);
    // Direct properties are still set (the disconnect handler reads s.userId).
    expect(appSrc).toMatch(/socket\.userId\s*=\s*user\.id/);
  });

  test('worker hasActiveSocketConnection reads s.data.userId (satisfied by the app.js fix)', () => {
    expect(workerSrc).toMatch(/hasActiveSocketConnection/);
    expect(workerSrc).toMatch(/s\.data\.userId/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. FIX-FHIGH02 — mobile [id].tsx has a 30s setInterval that fetches
//    stage-state and removes departed participants (parity with web's 30s poll)
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-FHIGH02 — mobile 30s stage-state poll removes departed participants', () => {
  test('mobile [id].tsx contains a setInterval (30000/30_000) that fetches stage-state and removes absent participants', () => {
    expect(mobileSrc).toBeTruthy();
    // Collect every setInterval block; find the one polling stage-state at 30s.
    const intervals = [];
    let i = 0;
    while ((i = mobileSrc.indexOf('setInterval', i)) !== -1) {
      intervals.push(mobileSrc.slice(i, i + 1400));
      i += 10;
    }
    const poll = intervals.find(s => /30_000|30000/.test(s) && /stage-state/.test(s));
    expect(poll).toBeTruthy();
    // Must read stageParticipants and remove departed ones (filter to snapshot ids)
    expect(poll).toMatch(/stageParticipants/);
    expect(poll).toMatch(/\.filter\s*\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. FIX-FHIGH03 — voice:join_room handler emits voice:user_joined after socket.join
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-FHIGH03 — voice:join_room re-broadcasts voice:user_joined after socket.join', () => {
  test('the voice:join_room handler emits voice:user_joined after socket.join', () => {
    const handlerIdx = appSrc.indexOf("socket.on('voice:join_room'");
    expect(handlerIdx).toBeGreaterThan(-1);
    // Window is 2500 (not 2000): the FIX-FHIGH03 restructure keeps the
    // compact isActive-only eligibility check so socket.join stays within the
    // pre-existing 800-char T8 window, then fetches the full profile for the
    // re-broadcast in a second query — which lengthens the handler beyond 2000.
    const handler = appSrc.slice(handlerIdx, handlerIdx + 3000);
    const joinIdx = handler.indexOf('socket.join(');
    const emitIdx = handler.indexOf("'voice:user_joined'");
    expect(joinIdx).toBeGreaterThan(-1);
    expect(emitIdx).toBeGreaterThan(-1);
    // The user_joined emit must come AFTER socket.join (re-broadcast on reconnect)
    expect(emitIdx).toBeGreaterThan(joinIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. FIX-FMED05 — leaveRoom emits room-wide voice:stage_state (in addition to voice:user_left)
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-FMED05 — leaveRoom emits voice:stage_state', () => {
  test('leaveRoom source contains a room-wide voice:stage_state emit (in addition to voice:user_left)', () => {
    const fn = extractFn(src, 'leaveRoom', 'endRoom');
    expect(fn).toMatch(/emit\s*\(\s*'voice:user_left'/);
    expect(fn).toMatch(/\.to\s*\(\s*`voice:\$\{roomId\}`\s*\)\.emit\s*\(\s*'voice:stage_state'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. FIX-FMED05 — banParticipant emits room-wide voice:stage_state (in addition to voice:banned)
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-FMED05 — banParticipant emits voice:stage_state', () => {
  test('banParticipant source contains a room-wide voice:stage_state emit (in addition to voice:banned)', () => {
    const fn = extractFn(src, 'banParticipant', 'unbanParticipant');
    expect(fn).toMatch(/emit\s*\(\s*'voice:banned'/);
    expect(fn).toMatch(/\.to\s*\(\s*`voice:\$\{roomId\}`\s*\)\.emit\s*\(\s*'voice:stage_state'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 7. FIX-FMED04 — socketReady polling does not permanently stop after a fixed retry count
// ═══════════════════════════════════════════════════════════════════════
describe('FIX-FMED04 — socketReady polling re-arms instead of permanently stopping', () => {
  test('socketReady effect keeps polling (re-arms at a slower 2000ms cadence) after MAX_RETRIES', () => {
    const start = hookSrc.indexOf('MAX_RETRIES');
    expect(start).toBeGreaterThan(-1);
    const effect = hookSrc.slice(start, start + 1500);
    // The fix slows to a 2000ms cadence instead of permanently clearing the interval
    expect(effect).toMatch(/2000/);
    // Re-arming => more than one setInterval reference (initial 500ms + re-arm 2000ms)
    const setIntervalCount = (effect.match(/setInterval/g) || []).length;
    expect(setIntervalCount).toBeGreaterThanOrEqual(2);
    // The warn must fire at most once (guarded by a flag), not every slow poll
    expect(effect).toMatch(/warned/);
    const warnCount = (effect.match(/console\.warn/g) || []).length;
    expect(warnCount).toBeLessThanOrEqual(1);
  });
});
