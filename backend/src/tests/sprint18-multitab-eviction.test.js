'use strict';
/**
 * Sprint 18 — VC-GAP-004: Multi-tab socket eviction regression tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies that kick/ban/leave/join eviction now uses socketsLeave()/socketsJoin()
 * instead of fetchSockets().forEach() across voice, room-member, and community.
 *
 * socketsLeave() broadcasts through the Redis adapter to ALL connected nodes,
 * ensuring multi-tab and multi-server eviction. fetchSockets() only returns
 * sockets in the current Node.js process.
 */

const fs   = require('fs');
const path = require('path');

const VOICE_CTRL     = path.join(__dirname, '../controllers/voice.controller.js');
const MEMBER_CTRL    = path.join(__dirname, '../controllers/room-member.controller.js');
const COMMUNITY_CTRL = path.join(__dirname, '../controllers/community.controller.js');

function extractFn(src, fnName, nextFnName) {
  const start = src.indexOf(`async function ${fnName}`);
  if (start === -1) return '';
  const end = nextFnName ? src.indexOf(`async function ${nextFnName}`, start + 1) : src.length;
  return src.slice(start, end === -1 ? src.length : end);
}

// ─────────────────────────────────────────────────────────────────────────────
// voice.controller.js
// ─────────────────────────────────────────────────────────────────────────────
describe('VC-GAP-004: voice.controller.js uses socketsLeave/socketsJoin', () => {
  let src;
  beforeAll(() => { src = fs.readFileSync(VOICE_CTRL, 'utf8'); });

  test('joinRoom uses socketsJoin() for multi-server join', () => {
    const body = extractFn(src, 'joinRoom', 'leaveRoom');
    expect(body).toMatch(/socketsJoin/);
  });

  test('leaveRoom uses socketsLeave() for multi-server leave', () => {
    const body = extractFn(src, 'leaveRoom', 'endRoom');
    expect(body).toMatch(/socketsLeave/);
  });

  test('kickParticipant uses socketsLeave()', () => {
    const body = extractFn(src, 'kickParticipant', 'banParticipant');
    expect(body).toMatch(/socketsLeave/);
  });

  test('banParticipant uses socketsLeave()', () => {
    const body = extractFn(src, 'banParticipant', 'unbanParticipant');
    expect(body).toMatch(/socketsLeave/);
  });

  test('socketsLeave targets correct voice room in kick', () => {
    const body = extractFn(src, 'kickParticipant', 'banParticipant');
    expect(body).toMatch(/socketsLeave\(`voice:\${roomId}`\)/);
  });

  test('socketsLeave targets correct voice room in ban', () => {
    const body = extractFn(src, 'banParticipant', 'unbanParticipant');
    expect(body).toMatch(/socketsLeave\(`voice:\${roomId}`\)/);
  });

  test('socketsJoin targets correct voice room in joinRoom', () => {
    const body = extractFn(src, 'joinRoom', 'leaveRoom');
    expect(body).toMatch(/socketsJoin\(`voice:\${roomId}`\)/);
  });

  test('VC-GAP-004 fix comment present in controller', () => {
    expect(src).toMatch(/VC-GAP-004/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// room-member.controller.js
// ─────────────────────────────────────────────────────────────────────────────
describe('VC-GAP-004: room-member.controller.js uses socketsLeave', () => {
  let src;
  beforeAll(() => { src = fs.readFileSync(MEMBER_CTRL, 'utf8'); });

  test('removeMember eviction uses socketsLeave()', () => {
    // Use lastIndexOf — first occurrence is voluntary leave (no eviction needed)
    const idx = src.lastIndexOf('voice:member_left');
    expect(idx).toBeGreaterThan(-1);
    const section = src.slice(idx, idx + 700);
    expect(section).toMatch(/socketsLeave/);
  });

  test('blockMember eviction uses socketsLeave()', () => {
    const idx = src.indexOf('voice:blocked_from_room');
    expect(idx).toBeGreaterThan(-1);
    const section = src.slice(idx, idx + 600);
    expect(section).toMatch(/socketsLeave/);
  });

  test('socketsLeave targets voice:{roomId} in removeMember', () => {
    const idx = src.lastIndexOf('voice:member_left');
    const section = src.slice(idx, idx + 700);
    expect(section).toMatch(/socketsLeave\(`voice:\${roomId}`\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// community.controller.js
// ─────────────────────────────────────────────────────────────────────────────
describe('VC-GAP-004: community.controller.js uses socketsLeave', () => {
  let src;
  beforeAll(() => { src = fs.readFileSync(COMMUNITY_CTRL, 'utf8'); });

  test('deleteCommunity uses socketsLeave()', () => {
    const body = extractFn(src, 'deleteCommunity', 'joinCommunity');
    expect(body).toMatch(/socketsLeave/);
  });

  test('leaveCommunity uses socketsLeave()', () => {
    const body = extractFn(src, 'leaveCommunity', 'getMembers');
    expect(body).toMatch(/socketsLeave/);
  });

  test('kickMember uses socketsLeave()', () => {
    const body = extractFn(src, 'kickMember', 'banMember');
    expect(body).toMatch(/socketsLeave/);
  });

  test('banMember uses socketsLeave()', () => {
    const body = extractFn(src, 'banMember', 'unbanMember');
    expect(body).toMatch(/socketsLeave/);
  });

  test('socketsLeave in kickMember targets community:{communityId}', () => {
    const body = extractFn(src, 'kickMember', 'banMember');
    expect(body).toMatch(/socketsLeave\(`community:\${community\.id}`\)/);
  });

  test('socketsLeave in banMember targets community:{communityId}', () => {
    const body = extractFn(src, 'banMember', 'unbanMember');
    expect(body).toMatch(/socketsLeave\(`community:\${community\.id}`\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchSockets retained only for legitimate read-only purposes
// ─────────────────────────────────────────────────────────────────────────────
describe('VC-GAP-004: fetchSockets retained for read-only purposes only', () => {

  test('dm.controller.js fetchSockets is for delivery check (not eviction)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/dm.controller.js'), 'utf8');
    // fetchSockets used to check if receiver is online (length check — read-only)
    expect(src).toMatch(/fetchSockets/);
    // Fetch in DM is followed by .length check, not .leave or .disconnect
    const idx = src.indexOf('fetchSockets');
    const ctx = src.slice(idx, idx + 200);
    expect(ctx).toMatch(/\.length/);
    expect(ctx).not.toMatch(/\.leave\(|\.disconnect\(/);
  });

  test('user.routes.js fetchSockets used for account deletion — disconnect(true) is correct', () => {
    const src = fs.readFileSync(path.join(__dirname, '../routes/user.routes.js'), 'utf8');
    const idx = src.indexOf('fetchSockets');
    expect(idx).toBeGreaterThan(-1);
    const ctx = src.slice(idx, idx + 200);
    // Account deletion requires hard disconnect — not just leaving a room
    expect(ctx).toMatch(/\.disconnect\(true\)/);
  });
});
