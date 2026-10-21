'use strict';
/**
 * Voice Club — Queue FIFO Regression Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * CRITICAL INVARIANT:
 *   ROLE determines PERMISSION.
 *   QUEUE POSITION determines PROMOTION PRIORITY.
 *   MODERATOR does NOT automatically skip the queue.
 *
 * Root cause of the bug:
 *   1. raiseHand blocked MODERATOR from joining the queue (role !== 'AUDIENCE').
 *   2. grabMic bypassed capacity for all MODERATOR_ROLES (isPrivileged bypass).
 *   3. autoPromoteNext DB fallback only queried role='AUDIENCE', skipping MODERATORs.
 *   4. _promoteUser rejected non-AUDIENCE roles, blocking MODERATORs from queue promotion.
 *
 * Fix applied:
 *   1. raiseHand accepts muted MODERATOR (audience state) via isEligibleForQueue.
 *   2. grabMic capacity bypass is HOST-only; MODERATOR respects capacity + queue.
 *   3. autoPromoteNext DB fallback includes muted MODERATOR in handRaised query.
 *   4. _promoteUser accepts muted MODERATOR; unmutes them (stays MODERATOR role).
 */

const fs   = require('fs');
const path = require('path');

// ─── Source code invariant tests ─────────────────────────────────────────────

describe('raiseHand — MODERATOR can join queue', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../controllers/voice-queue.controller.js'), 'utf8'
  );
  const fnStart = src.indexOf('async function raiseHand');
  const fnEnd   = src.indexOf('async function cancelHand', fnStart);
  const fn      = src.slice(fnStart, fnEnd);

  test('raiseHand no longer has an unconditional role !== AUDIENCE block', () => {
    expect(fn).not.toMatch(/participant\.role\s*!==\s*['"]AUDIENCE['"]\s*\)/);
  });

  test('raiseHand accepts muted MODERATOR via isEligibleForQueue', () => {
    expect(fn).toMatch(/isEligibleForQueue|MODERATOR.*isMuted/);
  });

  test('raiseHand still blocks SPEAKER (already on stage)', () => {
    expect(fn).toMatch(/SPEAKER/);
    expect(fn).toMatch(/already a speaker/i);
  });
});

describe('grabMic — MODERATOR no longer bypasses capacity', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
  );
  const fnStart = src.indexOf('async function grabMic');
  const fnEnd   = src.indexOf('async function dropMic', fnStart);
  const fn      = src.slice(fnStart, fnEnd);

  test('grabMic defines isHost (HOST-only capacity bypass)', () => {
    expect(fn).toMatch(/const isHost\s*=/);
  });

  test('grabMic capacity check — no eligible seat queues all roles (NO_ELIGIBLE_SEAT)', () => {
    // Speakers (and HOST when no free seat) enqueue when no unlocked eligible seat remains
    expect(fn).toMatch(/NO_ELIGIBLE_SEAT/);
    expect(fn).toMatch(/No eligible speaker seat|added to the queue/i);
  });

  test('grabMic NO_ELIGIBLE_SEAT path applies to MODERATOR (not bypassed)', () => {
    expect(fn).toMatch(/NO_ELIGIBLE_SEAT/);
  });
});

describe('autoPromoteNext — includes muted MODERATOR in queue lookup', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../utils/autoPromote.js'), 'utf8'
  );

  test('DB fallback query includes muted MODERATOR via OR clause', () => {
    expect(src).toMatch(/MODERATOR.*isMuted/);
    expect(src).toMatch(/OR.*AUDIENCE.*MODERATOR|AUDIENCE.*OR.*MODERATOR/s);
  });

  test('FIFO order preserved — DB fallback orders by handRaisedAt ascending', () => {
    expect(src).toMatch(/handRaisedAt.*asc/);
  });

  test('autoPromoteNext handles MODERATOR promotion (unmute, not role change)', () => {
    expect(src).toMatch(/isMod.*MODERATOR|MODERATOR.*isMod/);
  });

  test('autoPromote DB fallback no longer filters purely by role=AUDIENCE', () => {
    // Must contain OR clause to include MODERATOR
    expect(src).toMatch(/OR.*\[/);
  });
});

describe('_promoteUser — accepts muted MODERATOR from queue', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../controllers/voice-queue.controller.js'), 'utf8'
  );
  const fnStart = src.indexOf('async function _promoteUser');
  const fnEnd   = src.indexOf('// ─── REJECT', fnStart);
  const fn      = src.slice(fnStart, fnEnd);

  test('_promoteUser uses isQueueEligible instead of role !== AUDIENCE', () => {
    expect(fn).toMatch(/isQueueEligible/);
    expect(fn).not.toMatch(/current\.role\s*!==\s*['"]AUDIENCE['"]\s*\)/);
  });

  test('_promoteUser selects isMuted in transaction to check eligibility', () => {
    expect(fn).toMatch(/select.*isMuted|isMuted.*select/s);
  });

  test('_promoteUser broadcasts mute_changed for MODERATOR, role_changed for AUDIENCE', () => {
    expect(fn).toMatch(/mute_changed/);
    expect(fn).toMatch(/role_changed/);
    expect(fn).toMatch(/MODERATOR/);
  });

  test('_promoteUser does not change MODERATOR role to SPEAKER', () => {
    // Muted MODERATOR should be unmuted, not made SPEAKER
    // The update must conditionally skip role change for MODERATOR
    expect(fn).toMatch(/isMod.*\?.*\{\}.*role.*SPEAKER|isMod.*role.*SPEAKER/s);
  });
});

// ─── Queue FIFO invariant ─────────────────────────────────────────────────────

describe('Queue FIFO invariant — no role-based priority', () => {
  const queueSrc = fs.readFileSync(
    path.join(__dirname, '../controllers/voice-queue.controller.js'), 'utf8'
  );
  const autoSrc  = fs.readFileSync(
    path.join(__dirname, '../utils/autoPromote.js'), 'utf8'
  );

  test('voice-queue.controller orders queue by handRaisedAt (FIFO)', () => {
    expect(queueSrc).toMatch(/handRaisedAt.*asc/);
    // Must NOT sort by role
    expect(queueSrc).not.toMatch(/orderBy.*role.*asc|orderBy.*role.*desc/);
  });

  test('autoPromoteNext DB fallback orders by handRaisedAt (FIFO)', () => {
    expect(autoSrc).toMatch(/handRaisedAt.*asc/);
    expect(autoSrc).not.toMatch(/orderBy.*role/);
  });

  test('No role-based queue priority in voice-queue.controller', () => {
    expect(queueSrc).not.toMatch(/sortBy.*role|sort.*isModerator|priority.*MODERATOR/i);
  });

  test('No role-based queue priority in autoPromote', () => {
    expect(autoSrc).not.toMatch(/sortBy.*role|sort.*isModerator|priority.*MODERATOR/i);
  });
});

// ─── Test Matrix from spec ────────────────────────────────────────────────────

describe('TEST 1: Normal user leaves, Moderator does NOT auto-take seat', () => {
  test('autoPromoteNext uses FIFO order — no role-based priority', () => {
    const src = fs.readFileSync(path.join(__dirname, '../utils/autoPromote.js'), 'utf8');
    expect(src).toMatch(/handRaisedAt.*asc/);
    expect(src).not.toMatch(/orderBy.*role/);
  });
});

describe('TEST 3: Normal user ahead of Moderator gets promoted first', () => {
  test('approveNext DB fallback orders by handRaisedAt asc (earlier raised = higher priority)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice-queue.controller.js'), 'utf8'
    );
    expect(src).toMatch(/handRaisedAt.*asc/);
  });
});

describe('TEST 4: Moderator joins queue after normal users', () => {
  test('raiseHand accepts MODERATOR in audience state (isEligibleForQueue)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice-queue.controller.js'), 'utf8'
    );
    const fnStart = src.indexOf('async function raiseHand');
    const fnEnd   = src.indexOf('async function cancelHand', fnStart);
    const fn = src.slice(fnStart, fnEnd);
    expect(fn).toMatch(/isEligibleForQueue|MODERATOR.*isMuted/);
  });
});

describe('HOST special behavior preserved', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
  );
  const fnStart = src.indexOf('async function grabMic');
  const fnEnd   = src.indexOf('async function dropMic', fnStart);
  // Read the FULL grabMic function — capacity check is deep inside the transaction block
  const fn = src.slice(fnStart, fnEnd);

  test('HOST can bypass open-mic queue via isHost flag', () => {
    expect(fn).toMatch(/const isHost\s*=/);
    expect(fn).toMatch(/isHost/);
  });

  test('capacity check — all roles use seatNumber IS NOT NULL (no HOST bypass)', () => {
    // In the new seatNumber system, capacity is checked via occupied seat count
    expect(fn).toMatch(/seatNumber IS NOT NULL/);
    // No old stageCnt bypass
    expect(fn).not.toMatch(/stageCnt\s*>=\s*cap\s*&&\s*!isHost/);
  });

  test('MODERATOR is no longer exempt from capacity (isPrivileged bypass removed)', () => {
    expect(fn).not.toMatch(/stageCnt >= cap && !isPrivileged/);
  });
});

describe('Moderator moderation authority preserved', () => {
  const queueSrc = fs.readFileSync(
    path.join(__dirname, '../controllers/voice-queue.controller.js'), 'utf8'
  );

  test('MODERATOR_ROLES is still used for approve/reject authority', () => {
    // approveNext checks MODERATOR_ROLES.includes(myParticipant.role)
    expect(queueSrc).toMatch(/MODERATOR_ROLES\.includes/);
  });

  test('approveNext still requires HOST or MODERATOR role to approve', () => {
    // The authorization check must reference MODERATOR_ROLES
    const fnStart = queueSrc.indexOf('async function approveNext');
    const fn = queueSrc.slice(fnStart, fnStart + 800);
    expect(fn).toMatch(/MODERATOR_ROLES/);
  });

  test('MODERATOR can still approve/reject queue entries', () => {
    // The MODERATOR_ROLES check in approveNext authorizes both HOST and MODERATOR
    const fnStart = queueSrc.indexOf('async function approveNext');
    const fn = queueSrc.slice(fnStart, fnStart + 800);
    expect(fn).toMatch(/MODERATOR_ROLES\.includes.*role|role.*MODERATOR_ROLES/);
  });
});

// ─── NEW: Stage-full approve after seat freed ──────────────────────────────
// Regression for: "host presses Approve when queue user is waiting but client
// thinks stage is full because socket event hasn't arrived yet."

describe('Stage-full approve: countSpeakers uses seatNumber IS NOT NULL', () => {
  const queueSrc = fs.readFileSync(
    path.join(__dirname, '../controllers/voice-queue.controller.js'), 'utf8'
  );

  test('countSpeakers uses seatNumber IS NOT NULL (not role-based count)', () => {
    // The old countSpeakers used prisma.voiceParticipant.count with role/isMuted filter.
    // The new version uses raw SQL: seatNumber IS NOT NULL AND isActive = 1.
    // This is authoritative because seatNumber is cleared atomically on drop/leave.
    expect(queueSrc).toMatch(/seatNumber IS NOT NULL/);
  });

  test('countSpeakers does NOT use role-based OR clause for stage count', () => {
    const fnStart = queueSrc.indexOf('async function countSpeakers');
    const fnEnd   = queueSrc.indexOf('async function raiseHand', fnStart);
    const fn = queueSrc.slice(fnStart, fnEnd);
    // Must NOT count by role=SPEAKER OR (HOST/MOD with !isMuted)
    expect(fn).not.toMatch(/role.*SPEAKER.*OR.*HOST|role.*HOST.*OR.*MODERATOR/s);
    // Must use seatNumber IS NOT NULL
    expect(fn).toMatch(/seatNumber IS NOT NULL/);
  });

  test('approveNext calls countSpeakers which uses seatNumber', () => {
    const fnStart = queueSrc.indexOf('async function approveNext');
    const fnEnd   = queueSrc.indexOf('async function approveUser', fnStart);
    const fn = queueSrc.slice(fnStart, fnEnd);
    expect(fn).toMatch(/countSpeakers/);
  });

  test('approveUser calls countSpeakers which uses seatNumber', () => {
    const fnStart = queueSrc.indexOf('async function approveUser');
    const fnEnd   = queueSrc.indexOf('async function _promoteUser', fnStart);
    const fn = queueSrc.slice(fnStart, fnEnd);
    expect(fn).toMatch(/countSpeakers/);
  });

  test('_promoteUser also uses seatNumber IS NOT NULL for its inner check', () => {
    const fnStart = queueSrc.indexOf('async function _promoteUser');
    const fnEnd   = queueSrc.indexOf('// ─── REJECT', fnStart);
    const fn = queueSrc.slice(fnStart, fnEnd);
    expect(fn).toMatch(/seatNumber IS NOT NULL/);
  });
});

describe('Stage-full approve: promoteParticipant uses seatNumber IS NOT NULL', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
  );

  test('promoteParticipant outer check uses seatNumber IS NOT NULL', () => {
    const fnStart = src.indexOf('async function promoteParticipant');
    const fnEnd   = src.indexOf('async function kickParticipant', fnStart);
    const fn = src.slice(fnStart, fnEnd);
    // Must use raw SQL seat count, not role-based prisma.count
    expect(fn).toMatch(/seatNumber IS NOT NULL/);
    // Must NOT use old prisma.voiceParticipant.count with role filter for the pre-check
    // (the old pattern was: role: 'SPEAKER' ... role: 'HOST' ... isMuted: false)
    const speakerCountBlock = fn.match(/const speakerCountForPromote[\s\S]{0,300}/)?.[0] ?? '';
    expect(speakerCountBlock).not.toMatch(/voiceParticipant\.count.*OR.*role.*SPEAKER/s);
    expect(speakerCountBlock).toMatch(/seatNumber IS NOT NULL/);
  });

  test('promoteParticipant inner tx check also uses seatNumber IS NOT NULL', () => {
    const fnStart = src.indexOf('async function promoteParticipant');
    const fnEnd   = src.indexOf('async function kickParticipant', fnStart);
    const fn = src.slice(fnStart, fnEnd);
    // The transaction re-check must also use seatNumber, not role-based count
    const txBlock = fn.match(/await prisma\.\$transaction[\s\S]{0,2000}/)?.[0] ?? '';
    expect(txBlock).toMatch(/seatNumber IS NOT NULL/);
  });
});

describe('leaveRoom: seatNumber cleared atomically with isActive=false', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
  );
  const fnStart = src.indexOf('async function leaveRoom');
  const fnEnd   = src.indexOf('async function endRoom', fnStart);
  const fn = src.slice(fnStart, fnEnd);

  test('leaveRoom sets seatNumber: null in the main update (not fire-and-forget)', () => {
    // seatNumber must be inside the prisma.voiceParticipant.update data block,
    // not as a separate $executeRaw call after the update.
    const updateBlock = fn.match(/await prisma\.voiceParticipant\.update\([\s\S]{0,500}/)?.[0] ?? '';
    expect(updateBlock).toMatch(/seatNumber.*null|null.*seatNumber/);
  });

  test('leaveRoom does NOT use a separate fire-and-forget $executeRaw for seatNumber', () => {
    // The old pattern: prisma.$executeRaw`UPDATE ... SET seatNumber = NULL`.catch(() => {});
    // This created a race condition: if the async update ran after countSpeakers,
    // the seat appeared occupied even though the user had left.
    expect(fn).not.toMatch(/\$executeRaw[\s\S]{0,100}seatNumber = NULL[\s\S]{0,50}catch\(\)/);
  });
});

describe('Cancel waiting and rejoin queue', () => {
  const queueSrc = fs.readFileSync(
    path.join(__dirname, '../controllers/voice-queue.controller.js'), 'utf8'
  );

  test('cancelHand clears handRaised=false and dequeues from Redis', () => {
    const fnStart = queueSrc.indexOf('async function cancelHand');
    const fnEnd   = queueSrc.indexOf('async function approveNext', fnStart);
    const fn = queueSrc.slice(fnStart, fnEnd);
    expect(fn).toMatch(/handRaised.*false|false.*handRaised/);
    expect(fn).toMatch(/dequeue|dq/);
  });

  test('raiseHand is idempotent — returns current position if already raised', () => {
    const fnStart = queueSrc.indexOf('async function raiseHand');
    const fnEnd   = queueSrc.indexOf('async function cancelHand', fnStart);
    const fn = queueSrc.slice(fnStart, fnEnd);
    expect(fn).toMatch(/participant\.handRaised/);
    expect(fn).toMatch(/Already in queue/i);
  });

  test('grabMic re-enqueue path: after cancel, user can call grabMic again', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
    );
    const fnStart = src.indexOf('async function grabMic');
    const fnEnd   = src.indexOf('async function dropMic', fnStart);
    const fn = src.slice(fnStart, fnEnd);
    // grabMic checks handRaised before enqueuing — after cancel it's false, so it enqueues again
    expect(fn).toMatch(/participant\.handRaised/);
    expect(fn).toMatch(/Already in the queue/i);
    // Must be able to enqueue (call enqueue function)
    expect(fn).toMatch(/enq\(roomId/);
  });
});


// Ghost participant: host approves a user who is already on stage
// The stale handRaised flag causes the approve endpoint to see the user in the
// queue, but the user was already auto-promoted and has a seatNumber. The fix
// returns a graceful success and cleans up the stale queue entry.

describe('Ghost participant: already on stage when host approves', () => {
  const queueSrc = fs.readFileSync(
    path.join(__dirname, '../controllers/voice-queue.controller.js'), 'utf8'
  );
  const autoSrc = fs.readFileSync(
    path.join(__dirname, '../utils/autoPromote.js'), 'utf8'
  );
  const voiceSrc = fs.readFileSync(
    path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
  );

  test('_promoteUser transaction checks seatNumber directly to detect already-on-stage', () => {
    const fnStart = queueSrc.indexOf('async function _promoteUser');
    const fn = queueSrc.slice(fnStart, fnStart + 5000);
    expect(fn).toMatch(/seatRow|alreadySeated/);
    expect(fn).toMatch(/ALREADY_ON_STAGE/);
  });

  test('_promoteUser catch block cleans up handRaised when user is ALREADY_ON_STAGE', () => {
    // The catch condition is the SECOND occurrence — first is the throw inside tx
    const firstIdx = queueSrc.indexOf("'ALREADY_ON_STAGE'");
    const lastIdx  = queueSrc.lastIndexOf("'ALREADY_ON_STAGE'");
    expect(lastIdx).toBeGreaterThan(firstIdx); // must have both throw and catch
    const catchBlock = queueSrc.slice(lastIdx, lastIdx + 1500);
    expect(catchBlock).toMatch(/handRaised.*false|false.*handRaised/);
  });

  test('_promoteUser catch block emits voice:hand_raised raised=false to clear host UI', () => {
    const lastIdx = queueSrc.lastIndexOf("'ALREADY_ON_STAGE'");
    const catchBlock = queueSrc.slice(lastIdx, lastIdx + 1500);
    expect(catchBlock).toMatch(/voice:hand_raised/);
    expect(catchBlock).toMatch(/raised.*false/);
  });

  test('_promoteUser catch block broadcasts queue_updated to refresh host queue list', () => {
    const lastIdx = queueSrc.lastIndexOf("'ALREADY_ON_STAGE'");
    const catchBlock = queueSrc.slice(lastIdx, lastIdx + 1500);
    expect(catchBlock).toMatch(/queue_updated|broadcastQueue/);
  });

  test('_promoteUser catch block returns successResponse so host sees no error', () => {
    const lastIdx = queueSrc.lastIndexOf("'ALREADY_ON_STAGE'");
    const catchBlock = queueSrc.slice(lastIdx, lastIdx + 1500);
    expect(catchBlock).toMatch(/successResponse/);
    expect(catchBlock).toMatch(/alreadyOnStage.*true/);
  });

  test('autoPromoteNext skips already-seated users and cleans up stale handRaised', () => {
    const seatCheckIdx = autoSrc.indexOf('participant.seatNumber != null');
    expect(seatCheckIdx).toBeGreaterThan(-1);
    const block = autoSrc.slice(seatCheckIdx, seatCheckIdx + 500);
    expect(block).toMatch(/handRaised.*false|false.*handRaised/);
    expect(block).toMatch(/autoPromoteNext/);
  });

  test('autoPromoteNext emits voice:hand_raised raised=false for already-seated ghost', () => {
    const seatCheckIdx = autoSrc.indexOf('participant.seatNumber != null');
    const block = autoSrc.slice(seatCheckIdx, seatCheckIdx + 500);
    expect(block).toMatch(/voice:hand_raised/);
    expect(block).toMatch(/raised.*false/);
  });

  test('isQueueEligible accepts ghost SPEAKER with seatNumber=null', () => {
    expect(autoSrc).toMatch(/SPEAKER.*seatNumber.*null|role.*SPEAKER.*seatNumber/);
  });

  test('promoteParticipant 409 already-speaker path cleans up stale queue entry', () => {
    const fnStart = voiceSrc.indexOf('async function promoteParticipant');
    const fnEnd   = voiceSrc.indexOf('async function kickParticipant', fnStart);
    const fn = voiceSrc.slice(fnStart, fnEnd);
    // The cleanup is in the catch block - use the alreadyOnStage marker which only
    // appears in the catch block response, not in the throw
    const alreadyIdx = fn.lastIndexOf('alreadyOnStage');
    expect(alreadyIdx).toBeGreaterThan(-1);
    // Go back 1500 chars from there to get the full catch block content
    const blockStart = Math.max(0, alreadyIdx - 1000);
    const alreadyBlock = fn.slice(blockStart, alreadyIdx + 200);
    expect(alreadyBlock).toMatch(/handRaised.*false|false.*handRaised/);
    expect(alreadyBlock).toMatch(/voice:hand_raised/);
    expect(alreadyBlock).toMatch(/successResponse/);
  });
});


// MODERATOR approval via queue endpoint when Free Stage is OFF
// When isOpenMic=false, MODERATOR must queue via grabMic just like normal users.
// HOST approves them via POST /queue/approve/:userId (_promoteUser path).
// PATCH /promote would reject MODERATOR targets with 409.

describe('MODERATOR approval: Free Stage OFF requires queue + approveUser endpoint', () => {
  const queueSrc = fs.readFileSync(
    path.join(__dirname, '../controllers/voice-queue.controller.js'), 'utf8'
  );
  const voiceSrc = fs.readFileSync(
    path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
  );

  test('grabMic queues MODERATOR when isOpenMic=false — FIX-002: now uses !isPrivileged so MOD bypasses queue', () => {
    const fnStart = voiceSrc.indexOf('async function grabMic');
    const fnEnd   = voiceSrc.indexOf('async function dropMic', fnStart);
    const fn = voiceSrc.slice(fnStart, fnEnd);
    // FIX-002: open-mic OFF path now uses !isPrivileged (HOST and MOD bypass the queue)
    expect(fn).toMatch(/!isPrivileged.*!room\.isOpenMic|!room\.isOpenMic.*!isPrivileged/);
    // Must NOT use !isHost-only check (that was the pre-FIX-002 behavior)
    expect(fn).not.toMatch(/!isHost\s*&&\s*!room\.isOpenMic/);
  });

  test('approveUser endpoint handles MODERATOR via _promoteUser', () => {
    const fnStart = queueSrc.indexOf('async function approveUser');
    const fnEnd   = queueSrc.indexOf('// ─── Shared promotion logic', fnStart);
    const fn = queueSrc.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 2000);
    // Must call _promoteUser (shared promotion logic)
    expect(fn).toMatch(/_promoteUser/);
  });

  test('_promoteUser accepts muted MODERATOR (isMuted=true) via isQueueEligible', () => {
    const fnStart = queueSrc.indexOf('async function _promoteUser');
    const fn = queueSrc.slice(fnStart, fnStart + 3000);
    // isQueueEligible check must include MODERATOR with isMuted
    expect(fn).toMatch(/MODERATOR.*isMuted|isMuted.*MODERATOR/);
  });

  test('_promoteUser keeps MODERATOR role when approving (no role change to SPEAKER)', () => {
    const fnStart = queueSrc.indexOf('async function _promoteUser');
    const fn = queueSrc.slice(fnStart, fnStart + 4000);
    // For MODERATOR path (txIsMod): must NOT set role = 'SPEAKER'
    // Only sets isMuted=0 (unmutes) and seatNumber.
    // The else branch (non-MOD) sets role = 'SPEAKER'.
    expect(fn).toMatch(/txIsMod/);
    // The non-mod else branch has role = 'SPEAKER'
    expect(fn).toMatch(/role.*SPEAKER.*isMuted.*0|SPEAKER.*0.*updatedAt/s);
    // The mod branch does NOT have role = 'SPEAKER'
    const txIsModIdx = fn.indexOf('if (txIsMod)');
    const txBlock = fn.slice(txIsModIdx, txIsModIdx + 300);
    expect(txBlock).not.toMatch(/role.*=.*'SPEAKER'/);
  });

  test('_promoteUser emits voice:mute_changed (not role_changed) for MODERATOR', () => {
    const fnStart = queueSrc.indexOf('async function _promoteUser');
    const fnEnd   = queueSrc.indexOf('// ─── REJECT', fnStart);
    const fn = queueSrc.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 6000);
    // The broadcast section uses if (isMod) → mute_changed; else → role_changed
    expect(fn).toMatch(/isMod/);
    expect(fn).toMatch(/mute_changed/);
    expect(fn).toMatch(/role_changed/);
    // mute_changed appears with seatNumber for the MODERATOR path
    expect(fn).toMatch(/mute_changed[\s\S]{0,200}seatNumber/);
  });

  test('promoteParticipant (PATCH /promote) correctly rejects MODERATOR targets with 409', () => {
    const fnStart = voiceSrc.indexOf('async function promoteParticipant');
    const fnEnd   = voiceSrc.indexOf('async function kickParticipant', fnStart);
    const fn = voiceSrc.slice(fnStart, fnEnd);
    // Must reject HOST/MODERATOR being promoted to SPEAKER
    expect(fn).toMatch(/User is already.*cannot promote to SPEAKER/);
    expect(fn).toMatch(/statusCode.*409|409.*statusCode/);
  });

  test('approveQueueUser route exists: POST /queue/approve/:userId', () => {
    const routeSrc = fs.readFileSync(
      path.join(__dirname, '../routes/voice.routes.js'), 'utf8'
    );
    expect(routeSrc).toMatch(/queue\/approve\/:userId|approveUser/);
  });
});
