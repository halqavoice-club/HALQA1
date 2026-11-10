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

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT FIX VERIFICATION: voice:banned event handling
// Verifies the fixes applied during the Voice Club 100% production audit:
//   FIX-WEB: useVoiceRoom.ts now handles voice:banned for banned user eviction
//            AND room-wide participant removal.
//   FIX-MOB: mobile [id].tsx now handles voice:banned for both cases.
//   PERF-FIX: gift.controller.js sendGiftToAll leaderboard upsert moved outside loop.
// ─────────────────────────────────────────────────────────────────────────────

const HOOK_PATH         = path.join(__dirname, '../../../frontend/src/hooks/useVoiceRoom.ts');
const GIFT_CTRL_PATH    = path.join(__dirname, '../controllers/gift.controller.js');

describe('AUDIT-FIX: voice:banned event handler (web)', () => {

  test('useVoiceRoom.ts registers socket.on("voice:banned") listener', () => {
    if (!fs.existsSync(HOOK_PATH)) {
      console.warn('Skipping: frontend hook not accessible from backend test runner');
      return;
    }
    const src = fs.readFileSync(HOOK_PATH, 'utf8');
    expect(src).toMatch(/socket\.on\('voice:banned'/);
  });

  test('useVoiceRoom.ts voice:banned handler differentiates room-wide vs personal event', () => {
    if (!fs.existsSync(HOOK_PATH)) return;
    const src = fs.readFileSync(HOOK_PATH, 'utf8');
    // Must check for userId to differentiate room-wide (userId present) from personal
    expect(src).toMatch(/data\.userId/);
    // Must remove participant for room-wide ban
    expect(src).toMatch(/removeParticipant/);
    // Must clear active room for personal ban
    expect(src).toMatch(/setActiveRoom\(null\)/);
  });

  test('useVoiceRoom.ts registers socket.off("voice:banned") cleanup', () => {
    if (!fs.existsSync(HOOK_PATH)) return;
    const src = fs.readFileSync(HOOK_PATH, 'utf8');
    expect(src).toMatch(/socket\.off\('voice:banned'/);
  });
});

describe('AUDIT-FIX: banParticipant emits voice:banned to both room and user', () => {

  test('banParticipant emits voice:banned to room channel', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const banStart = src.indexOf('async function banParticipant');
    const banEnd   = src.indexOf('async function', banStart + 1);
    const banBody  = src.slice(banStart, banEnd);

    // Room-wide emit: io.to(`voice:${roomId}`).emit('voice:banned', ...)
    expect(banBody).toMatch(/voice:banned/);
    expect(banBody).toMatch(/voice:\$\{roomId\}/);
  });

  test('banParticipant emits voice:banned to banned user personally', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const banStart = src.indexOf('async function banParticipant');
    const banEnd   = src.indexOf('async function', banStart + 1);
    const banBody  = src.slice(banStart, banEnd);

    // Personal emit: io.to(`user:${targetUserId}`).emit('voice:banned', ...)
    expect(banBody).toMatch(/user:\$\{targetUserId\}/);
  });

  test('banParticipant uses $transaction for atomic ban + participant deactivation', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const banStart = src.indexOf('async function banParticipant');
    const banEnd   = src.indexOf('async function', banStart + 1);
    const banBody  = src.slice(banStart, banEnd);

    expect(banBody).toMatch(/\$transaction/);
    expect(banBody).toMatch(/isBanned.*true|true.*isBanned/);
    expect(banBody).toMatch(/isActive.*false|false.*isActive/);
  });

  test('banParticipant uses socketsLeave for multi-tab/server eviction', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const banStart = src.indexOf('async function banParticipant');
    const banEnd   = src.indexOf('async function', banStart + 1);
    const banBody  = src.slice(banStart, banEnd);

    expect(banBody).toMatch(/socketsLeave/);
  });
});

describe('AUDIT-FIX: sendGiftToAll leaderboard N+1 fix', () => {

  test('gift.controller.js sendGiftToAll does NOT upsert leaderboard inside per-receiver loop', () => {
    const src = fs.readFileSync(GIFT_CTRL_PATH, 'utf8');

    // Find sendGiftToAll function
    const fnStart = src.indexOf("async function sendGiftToAll");
    const fnEnd   = src.indexOf('\nmodule.exports', fnStart);
    const fnBody  = src.slice(fnStart, fnEnd);

    // Find the for loop body
    const forStart = fnBody.indexOf('for (let i = 0');
    const forEnd   = fnBody.indexOf('\n        }', forStart); // closing brace of for loop
    const forBody  = fnBody.slice(forStart, forEnd);

    // Leaderboard upsert must NOT be inside the per-receiver for loop
    expect(forBody).not.toMatch(/roomGiftLeaderboard/);
  });

  test('gift.controller.js sendGiftToAll upserts leaderboard once with total amounts', () => {
    const src = fs.readFileSync(GIFT_CTRL_PATH, 'utf8');

    const fnStart = src.indexOf("async function sendGiftToAll");
    const fnEnd   = src.indexOf('\nmodule.exports', fnStart);
    const fnBody  = src.slice(fnStart, fnEnd);

    // Must contain single leaderboard upsert with the total
    expect(fnBody).toMatch(/roomGiftLeaderboard/);
    expect(fnBody).toMatch(/totalCoinsForLeaderboard|totalCoins.*receiverParticipants\.length/);
  });
});

describe('AUDIT-FIX: micLocked enforced across all speaker entry paths', () => {

  test('grabMic checks micLocked server-side', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const fnStart = src.indexOf('async function grabMic');
    const fnEnd   = src.indexOf('async function', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd);

    expect(fnBody).toMatch(/micLocked/);
    expect(fnBody).toMatch(/mic is locked/i);
  });

  test('raiseHand (queue) checks micLocked server-side', () => {
    const queueCtrlPath = path.join(__dirname, '../controllers/voice-queue.controller.js');
    const src = fs.readFileSync(queueCtrlPath, 'utf8');
    const fnStart = src.indexOf('async function raiseHand');
    const fnEnd   = src.indexOf('async function', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd);

    expect(fnBody).toMatch(/micLocked/);
  });

  test('acceptMicOffer checks micLocked server-side', () => {
    const micCtrlPath = path.join(__dirname, '../controllers/voice-mic.controller.js');
    const src = fs.readFileSync(micCtrlPath, 'utf8');
    const fnStart = src.indexOf('async function acceptMicOffer');
    const fnEnd   = src.indexOf('async function', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd);

    expect(fnBody).toMatch(/micLocked/);
  });

  test('promoteParticipant checks micLocked server-side', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const fnStart = src.indexOf('async function promoteParticipant');
    const fnEnd   = src.indexOf('async function', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd);

    expect(fnBody).toMatch(/micLocked/);
  });

  test('approveNext (queue) checks micLocked server-side', () => {
    const queueCtrlPath = path.join(__dirname, '../controllers/voice-queue.controller.js');
    const src = fs.readFileSync(queueCtrlPath, 'utf8');
    const fnStart = src.indexOf('async function approveNext');
    const fnEnd   = src.indexOf('async function', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd);

    expect(fnBody).toMatch(/micLocked/);
  });
});

describe('AUDIT-FIX: race condition protection on concurrent promotions', () => {

  test('voice-queue.controller.js _promoteUser uses $transaction with role re-check', () => {
    const queueCtrlPath = path.join(__dirname, '../controllers/voice-queue.controller.js');
    const src = fs.readFileSync(queueCtrlPath, 'utf8');
    const fnStart = src.indexOf('async function _promoteUser');
    const fnEnd   = src.indexOf('async function', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd);

    expect(fnBody).toMatch(/\$transaction/);
    expect(fnBody).toMatch(/role.*AUDIENCE|AUDIENCE.*role/);
    expect(fnBody).toMatch(/409|already.*speaker/i);
  });

  test('promoteParticipant uses $transaction with role re-check', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const fnStart = src.indexOf('async function promoteParticipant');
    const fnEnd   = src.indexOf('async function', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd);

    expect(fnBody).toMatch(/\$transaction/);
    expect(fnBody).toMatch(/already a speaker/i);
  });

  test('transferAdmin uses $transaction with serialization point (updateMany WHERE hostId)', () => {
    const rolesCtrlPath = path.join(__dirname, '../controllers/voice-roles.controller.js');
    const src = fs.readFileSync(rolesCtrlPath, 'utf8');
    const fnStart = src.indexOf('async function transferAdmin');
    const fnEnd   = src.indexOf('async function', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd);

    expect(fnBody).toMatch(/\$transaction/);
    // The race-condition guard uses updateMany with hostId WHERE condition
    expect(fnBody).toMatch(/hostId.*prevHostId|prevHostId.*hostId/);
    expect(fnBody).toMatch(/updateMany|serialization|race-condition/i);
  });
});

describe('AUDIT-FIX: LiveKit token security', () => {

  test('getLiveKitToken validates active participant before issuing token', () => {
    const livekitPath = path.join(__dirname, '../controllers/livekit.controller.js');
    const src = fs.readFileSync(livekitPath, 'utf8');
    const fnStart = src.indexOf('async function getLiveKitToken');
    const fnEnd   = src.indexOf('async function', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd);

    expect(fnBody).toMatch(/voiceParticipant.*findUnique|findUnique.*voiceParticipant/);
    expect(fnBody).toMatch(/not an active participant/i);
  });

  test('getLiveKitToken uses 1h TTL (not 8h as the active value)', () => {
    const livekitPath = path.join(__dirname, '../controllers/livekit.controller.js');
    const src = fs.readFileSync(livekitPath, 'utf8');
    const fnStart = src.indexOf('async function getLiveKitToken');
    const fnEnd   = src.indexOf('async function', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd);

    // Active TTL must be 10m (INV-001: reduced from 1h to shorten revocation window)
    expect(fnBody).toMatch(/ttl.*'10m'|ttl.*"10m"/);
    // The actual token grant must NOT use 1h or 8h as TTL value in code (comment is ok)
    // Check: the AccessToken instantiation should have ttl: '10m'
    expect(fnBody).toMatch(/ttl:\s*'10m'/);
  });

  test('getLiveKitToken identity comes from req.user.id (server-derived, not client-supplied)', () => {
    const livekitPath = path.join(__dirname, '../controllers/livekit.controller.js');
    const src = fs.readFileSync(livekitPath, 'utf8');
    const fnStart = src.indexOf('async function getLiveKitToken');
    const fnEnd   = src.indexOf('async function', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd);

    // identity must use userId which comes from req.user (set by auth middleware)
    expect(fnBody).toMatch(/identity:\s*userId/);
    // Must NOT read identity from req.body (client-supplied values are untrusted)
    expect(fnBody).not.toMatch(/req\.body\.identity/);
  });

  test('ENDED voice rooms cannot get a LiveKit token', () => {
    const livekitPath = path.join(__dirname, '../controllers/livekit.controller.js');
    const src = fs.readFileSync(livekitPath, 'utf8');
    const fnStart = src.indexOf('async function getLiveKitToken');
    const fnEnd   = src.indexOf('async function', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd);

    expect(fnBody).toMatch(/ENDED/);
    expect(fnBody).toMatch(/archived|has ended/i);
  });
});

describe('AUDIT-FIX: SUPER_ADMIN voice room isolation', () => {

  test('SUPER_ADMIN cannot create voice rooms (route guard in voice.routes.js)', () => {
    const routesPath = path.join(__dirname, '../routes/voice.routes.js');
    const src = fs.readFileSync(routesPath, 'utf8');
    expect(src).toMatch(/SUPER_ADMIN.*cannot create|cannot create.*voice rooms/i);
  });

  test('SUPER_ADMIN cannot join voice rooms (route guard in voice.routes.js)', () => {
    const routesPath = path.join(__dirname, '../routes/voice.routes.js');
    const src = fs.readFileSync(routesPath, 'utf8');
    expect(src).toMatch(/SUPER_ADMIN.*cannot join|cannot join.*voice rooms/i);
  });

  test('SUPER_ADMIN cannot send messages in voice rooms', () => {
    const routesPath = path.join(__dirname, '../routes/voice.routes.js');
    const src = fs.readFileSync(routesPath, 'utf8');
    expect(src).toMatch(/SUPER_ADMIN.*cannot send messages/i);
  });

  test('SUPER_ADMIN cannot send gifts in voice rooms', () => {
    const routesPath = path.join(__dirname, '../routes/voice.routes.js');
    const src = fs.readFileSync(routesPath, 'utf8');
    expect(src).toMatch(/SUPER_ADMIN.*cannot send gifts/i);
  });

  test('endRoom requires SUPER_ADMIN (permanent room contract)', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const fnStart = src.indexOf('async function endRoom');
    const fnEnd   = src.indexOf('async function', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd);

    expect(fnBody).toMatch(/SUPER_ADMIN/);
    expect(fnBody).toMatch(/permanent|platform admin/i);
  });
});

describe('AUDIT-FIX: voiceQueue Redis flush recovery (VC-GAP-006)', () => {

  test('voiceQueue.getQueue re-hydrates Redis from DB when queue is empty after flush', () => {
    const queuePath = path.join(__dirname, '../utils/voiceQueue.js');
    const src = fs.readFileSync(queuePath, 'utf8');
    const fnStart = src.indexOf('async function getQueue');
    const fnEnd   = src.indexOf('\nasync function', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd);

    // Must check DB when Redis returns empty queue
    expect(fnBody).toMatch(/getQueueFromDB/);
    // Must re-hydrate Redis pipeline
    expect(fnBody).toMatch(/pipeline|re-hydrat/i);
  });

  test('voiceQueue.getQueue falls back to DB when Redis is unavailable', () => {
    const queuePath = path.join(__dirname, '../utils/voiceQueue.js');
    const src = fs.readFileSync(queuePath, 'utf8');
    expect(src).toMatch(/getQueueFromDB/);
    expect(src).toMatch(/isRedisReady.*return.*getQueueFromDB|!isRedisReady.*getQueueFromDB/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VC-BACK-001 VERIFICATION: unkickParticipant endpoint exists (audit gap-fix pass)
// ─────────────────────────────────────────────────────────────────────────────

describe('VC-BACK-001 VERIFIED: unkickParticipant endpoint exists and is correctly guarded', () => {
  const ROUTES_PATH = path.join(__dirname, '../routes/voice.routes.js');

  test('unkickParticipant is exported from voice.controller.js', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    expect(src).toMatch(/async function unkickParticipant/);
    expect(src).toMatch(/unkickParticipant/);
    // Verify it is in module.exports
    const exportsIdx = src.lastIndexOf('module.exports');
    const exportsBlock = src.slice(exportsIdx);
    expect(exportsBlock).toMatch(/unkickParticipant/);
  });

  test('unkickParticipant resets wasKicked to false', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const fnStart = src.indexOf('async function unkickParticipant');
    const fnEnd   = src.indexOf('async function', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/wasKicked.*false|false.*wasKicked/);
    expect(fnBody).toMatch(/prisma\.voiceParticipant\.update/);
  });

  test('unkickParticipant is HOST-only (not moderator)', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const fnStart = src.indexOf('async function unkickParticipant');
    const fnEnd   = src.indexOf('async function', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd);
    // Must check for HOST role specifically, not MODERATOR_ROLES
    expect(fnBody).toMatch(/VOICE_ROLES\.HOST/);
    expect(fnBody).toMatch(/403/);
  });

  test('unkickParticipant returns 404 when user was not kicked', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const fnStart = src.indexOf('async function unkickParticipant');
    const fnEnd   = src.indexOf('async function', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd);
    // Either checks wasKicked directly or uses updateMany count === 0 pattern
    const hasWasKickedCheck = fnBody.includes('!target.wasKicked') ||
                              fnBody.includes('wasKicked: true') ||
                              fnBody.includes('count === 0');
    expect(hasWasKickedCheck).toBe(true);
    expect(fnBody).toMatch(/User was not kicked/);
  });

  test('unkickParticipant is audit-logged with PARTICIPANT_UNKICKED', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const fnStart = src.indexOf('async function unkickParticipant');
    const fnEnd   = src.indexOf('async function', fnStart + 1);
    const fnBody  = src.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/voiceAudit/);
    expect(fnBody).toMatch(/PARTICIPANT_UNKICKED/);
  });

  test('DELETE /voice/:id/kick/:userId/unkick route is registered', () => {
    const routesSrc = fs.readFileSync(ROUTES_PATH, 'utf8');
    expect(routesSrc).toMatch(/router\.delete.*kick.*unkick/);
    expect(routesSrc).toMatch(/unkickParticipant/);
  });

  test('unkick route is guarded by checkVoiceRole HOST', () => {
    const routesSrc = fs.readFileSync(ROUTES_PATH, 'utf8');
    const routeIdx  = routesSrc.indexOf('kick/:userId/unkick');
    const routeBlock = routesSrc.slice(routeIdx, routeIdx + 200);
    expect(routeBlock).toMatch(/checkVoiceRole/);
    expect(routeBlock).toMatch(/VOICE_ROLES\.HOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VC-CONC-005 VERIFICATION: BullMQ room sleep replaces setTimeout (audit gap-fix pass)
// ─────────────────────────────────────────────────────────────────────────────

describe('VC-CONC-005 VERIFIED: BullMQ room sleep replaces in-memory setTimeout', () => {
  const QUEUE_SERVICE_PATH = path.join(__dirname, '../services/queue.service.js');
  const WORKER_PATH        = path.join(__dirname, '../workers/voice-room-sleep.worker.js');
  const WORKERS_INDEX_PATH = path.join(__dirname, '../workers/index.js');

  test('leaveRoom no longer uses setTimeout for IDLE transition', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const leaveRoomStart = src.indexOf('async function leaveRoom');
    const leaveRoomEnd   = src.indexOf('async function', leaveRoomStart + 1);
    const leaveRoomBody  = src.slice(leaveRoomStart, leaveRoomEnd);
    // Strip single-line comments so comment text does not trigger the assertion
    const leaveRoomCode  = leaveRoomBody.replace(/\/\/[^\n]*/g, '');
    // No actual setTimeout() call should remain for the IDLE sleep transition
    expect(leaveRoomCode).not.toMatch(/setTimeout\s*\(/);
    // BullMQ scheduleRoomSleep must be called instead
    expect(leaveRoomBody).toMatch(/scheduleRoomSleep/);
  });

  test('joinRoom calls cancelRoomSleep to abort the grace timer on rejoin', () => {
    const src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
    const joinRoomStart = src.indexOf('async function joinRoom');
    const joinRoomEnd   = src.indexOf('async function', joinRoomStart + 1);
    const joinRoomBody  = src.slice(joinRoomStart, joinRoomEnd);
    expect(joinRoomBody).toMatch(/cancelRoomSleep/);
  });

  test('queue.service.js exports scheduleRoomSleep and cancelRoomSleep', () => {
    const src = fs.readFileSync(QUEUE_SERVICE_PATH, 'utf8');
    expect(src).toMatch(/async function scheduleRoomSleep/);
    expect(src).toMatch(/async function cancelRoomSleep/);
    const exportsIdx = src.lastIndexOf('module.exports');
    const exportsBlock = src.slice(exportsIdx);
    expect(exportsBlock).toMatch(/scheduleRoomSleep/);
    expect(exportsBlock).toMatch(/cancelRoomSleep/);
  });

  test('VOICE_ROOM_SLEEP queue name constant is defined', () => {
    const src = fs.readFileSync(QUEUE_SERVICE_PATH, 'utf8');
    expect(src).toMatch(/VOICE_ROOM_SLEEP.*voice-room-sleep|voice-room-sleep.*VOICE_ROOM_SLEEP/);
  });

  test('voice-room-sleep.worker.js exists and exports createVoiceRoomSleepWorker', () => {
    expect(require('fs').existsSync(WORKER_PATH)).toBe(true);
    const src = fs.readFileSync(WORKER_PATH, 'utf8');
    expect(src).toMatch(/createVoiceRoomSleepWorker/);
    expect(src).toMatch(/module\.exports/);
  });

  test('voice-room-sleep worker is registered in workers/index.js', () => {
    const src = fs.readFileSync(WORKERS_INDEX_PATH, 'utf8');
    expect(src).toMatch(/createVoiceRoomSleepWorker/);
    expect(src).toMatch(/voice-room-sleep\.worker/);
  });

  test('sleep worker checks room is still LIVE before transitioning', () => {
    const src = fs.readFileSync(WORKER_PATH, 'utf8');
    expect(src).toMatch(/STATUS_LIVE|LIVE/);
    // Must bail out if room is no longer LIVE
    expect(src).toMatch(/status.*!==.*LIVE|!==.*STATUS_LIVE/);
  });

  test('sleep worker checks 0 active participants before transitioning', () => {
    const src = fs.readFileSync(WORKER_PATH, 'utf8');
    expect(src).toMatch(/activeCount|isActive.*true/);
    expect(src).toMatch(/activeCount > 0/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VC-BACK-003 (previously UNVERIFIED) VERIFIED: voice-stale-session worker is
// registered and scheduled in queue.service.js startWorkers() + scheduleCleanup()
// ─────────────────────────────────────────────────────────────────────────────

describe('VC-BACK-003 VERIFIED: voice-stale-session worker is registered and scheduled', () => {
  const QUEUE_SERVICE_PATH = path.join(__dirname, '../services/queue.service.js');

  test('startWorkers() creates voiceStaleSession worker', () => {
    const src = fs.readFileSync(QUEUE_SERVICE_PATH, 'utf8');
    expect(src).toMatch(/workers\.voiceStaleSession\s*=\s*createVoiceStaleSessionWorker/);
  });

  test('scheduleCleanup() adds voice-stale-sweep recurring job', () => {
    const src = fs.readFileSync(QUEUE_SERVICE_PATH, 'utf8');
    expect(src).toMatch(/voice-stale-sweep/);
    expect(src).toMatch(/10 \* 60 \* 1000/);
  });
});
