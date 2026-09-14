'use strict';
/**
 * Voice Club — One-Room-at-a-Time Regression Tests
 * Product rule: ONE USER → ONE ACTIVE VOICE CLUB ROOM AT A TIME.
 * Enforcement: joinRoom returns HTTP 409 VOICE_ROOM_ALREADY_ACTIVE.
 * Room A is NEVER touched when Room B join is rejected.
 */

const fs   = require('fs');
const path = require('path');

const VOICE_CTRL = path.join(__dirname, '../controllers/voice.controller.js');

function extractFn(src, fnName, nextFnName) {
  const start = src.indexOf('async function ' + fnName);
  if (start === -1) return '';
  const end = nextFnName ? src.indexOf('async function ' + nextFnName, start + 1) : src.length;
  return src.slice(start, end === -1 ? src.length : end);
}

// Extract only the executable code block (not comments) from ONE-ROOM-AT-A-TIME section.
// Strategy: find the { } block after the marker, strip comments.
function extractEnforcementCodeBlock(src) {
  const markerIdx = src.indexOf('ONE-ROOM-AT-A-TIME');
  if (markerIdx === -1) return '';
  // Find the opening { of the enforcement block
  const braceStart = src.indexOf('{', markerIdx);
  if (braceStart === -1) return '';
  // Find matching closing brace
  let depth = 0;
  let i = braceStart;
  while (i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
    i++;
  }
  return src.slice(braceStart, braceStart + 1000);
}

describe('Phase 3 — joinRoom rejects second room (never evicts Room A)', () => {
  const src    = fs.readFileSync(VOICE_CTRL, 'utf8');
  const joinFn = extractFn(src, 'joinRoom', 'leaveRoom');
  const codeBlock = extractEnforcementCodeBlock(joinFn);

  test('enforcement block exists in joinRoom', () => {
    expect(joinFn).toMatch(/ONE-ROOM-AT-A-TIME/);
  });

  test('checks for other active rooms (different roomId)', () => {
    expect(codeBlock).toMatch(/otherActiveRooms/);
    expect(codeBlock).toMatch(/not.*roomId|roomId.*not/);
  });

  test('returns 409 when user is already in a different active room', () => {
    expect(codeBlock).toMatch(/409/);
    expect(codeBlock).toMatch(/VOICE_ROOM_ALREADY_ACTIVE/);
  });

  test('rejection message tells user to leave existing room', () => {
    expect(codeBlock).toMatch(/Leave|leave/);
  });

  test('does NOT call prisma update in enforcement block (Room A NOT deactivated)', () => {
    // The enforcement block must only do: findMany + conditional return
    expect(codeBlock).not.toMatch(/prisma\.\w+\.update\s*\(/);
  });

  test('does NOT emit socket events in enforcement block', () => {
    expect(codeBlock).not.toMatch(/\.emit\s*\(/);
  });

  test('does NOT call socketsLeave in enforcement block', () => {
    expect(codeBlock).not.toMatch(/socketsLeave\s*\(/);
  });

  test('does NOT call autoPromoteNext in enforcement block', () => {
    expect(codeBlock).not.toMatch(/autoPromoteNext\s*\(/);
  });

  test('does NOT require voiceQueue in enforcement block', () => {
    expect(codeBlock).not.toMatch(/require.*voiceQueue|voiceQueue.*require/);
  });

  test('does NOT touch voiceRoomMember in enforcement block', () => {
    expect(codeBlock).not.toMatch(/voiceRoomMember/i);
  });

  test('enforcement check is BEFORE the upsert (check before commit)', () => {
    const checkIdx  = joinFn.indexOf('ONE-ROOM-AT-A-TIME');
    const upsertIdx = joinFn.indexOf('Upsert participant');
    expect(checkIdx).toBeGreaterThan(-1);
    expect(upsertIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeLessThan(upsertIdx);
  });

  test('enforcement uses prisma DB query (not just in-memory state)', () => {
    expect(codeBlock).toMatch(/prisma\.voiceParticipant\.findMany/);
  });
});

describe('Phase 6 — Same-room reconnect is allowed (not rejected)', () => {
  const src    = fs.readFileSync(VOICE_CTRL, 'utf8');
  const joinFn = extractFn(src, 'joinRoom', 'leaveRoom');

  test('enforcement query excludes the SAME room (roomId: { not: roomId })', () => {
    expect(joinFn).toMatch(/roomId:\s*\{\s*not:\s*roomId/);
  });

  test('existing participant is upserted (reconnect path)', () => {
    expect(joinFn).toMatch(/existing.*voiceParticipant|Upsert participant/);
    const upsertBlock = joinFn.match(/Upsert participant[\s\S]{0,600}/)?.[0] ?? '';
    expect(upsertBlock).toMatch(/isActive.*true/);
  });
});

describe('Phase 7 — leaveRoom releases active participation atomically', () => {
  const src     = fs.readFileSync(VOICE_CTRL, 'utf8');
  const leaveFn = extractFn(src, 'leaveRoom', 'endRoom');

  test('leaveRoom sets isActive=false', () => {
    expect(leaveFn).toMatch(/isActive.*false/);
  });

  test('leaveRoom sets seatNumber=null in same update', () => {
    const updateBlock = leaveFn.match(/voiceParticipant\.update[\s\S]{0,500}/)?.[0] ?? '';
    expect(updateBlock).toMatch(/seatNumber.*null/);
  });

  test('leaveRoom dequeues from Redis queue', () => {
    expect(leaveFn).toMatch(/dequeue|dq\(|voiceQueue/);
  });
});

describe('Phase 8 — Kick releases active participation', () => {
  const src    = fs.readFileSync(VOICE_CTRL, 'utf8');
  const kickFn = extractFn(src, 'kickParticipant', 'banParticipant');

  test('kickParticipant sets isActive=false', () => {
    expect(kickFn).toMatch(/isActive.*false/);
  });
});

describe('Phase 9 — Queue presence (handRaised) does NOT equal active participation', () => {
  const src    = fs.readFileSync(VOICE_CTRL, 'utf8');
  const joinFn = extractFn(src, 'joinRoom', 'leaveRoom');
  const codeBlock = extractEnforcementCodeBlock(joinFn);

  test('enforcement query uses isActive:true (not handRaised)', () => {
    expect(codeBlock).toMatch(/isActive.*true/);
  });

  test('enforcement query does NOT filter by handRaised', () => {
    expect(codeBlock).not.toMatch(/handRaised.*true/);
  });
});

describe('Phase 10 — Permanent VoiceRoomMember unaffected by one-room rule', () => {
  const src    = fs.readFileSync(VOICE_CTRL, 'utf8');
  const joinFn = extractFn(src, 'joinRoom', 'leaveRoom');
  const codeBlock = extractEnforcementCodeBlock(joinFn);

  test('enforcement block does not modify VoiceRoomMember', () => {
    expect(codeBlock).not.toMatch(/voiceRoomMember/i);
  });
});

describe('Phase 11 — Socket.IO correctness: rejected join emits nothing false', () => {
  const src    = fs.readFileSync(VOICE_CTRL, 'utf8');
  const joinFn = extractFn(src, 'joinRoom', 'leaveRoom');
  const codeBlock = extractEnforcementCodeBlock(joinFn);

  test('no socket.emit before or inside enforcement rejection', () => {
    expect(codeBlock).not.toMatch(/\.emit\s*\(/);
  });

  test('rejection is a return statement (no code after it in block)', () => {
    expect(codeBlock).toMatch(/return errorResponse/);
  });
});
