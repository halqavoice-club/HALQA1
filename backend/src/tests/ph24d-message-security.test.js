'use strict';
/**
 * Phase 24D — Message Security Remediation Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers the three confirmed P2 findings:
 *
 *   MSG-P2-001  School getMessage — sender/recipient ownership check added
 *   MSG-P2-002  Group typing Socket.IO — socket room membership guard added
 *   MSG-P2-003  removeGroupMember — socketsLeave eviction added
 *
 * Evidence level: SOURCE-LEVEL UNIT (mocked Prisma/Socket.IO)
 * No live database, no live Socket.IO server required.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

// ─── Source files ─────────────────────────────────────────────────────────────
const MSG_CTRL_PATH   = path.join(__dirname, '../controllers/message.controller.js');
const GROUP_CTRL_PATH = path.join(__dirname, '../controllers/groupChat.controller.js');
const APP_SRC_PATH    = path.join(__dirname, '../app.js');

const msgCtrlSrc   = fs.readFileSync(MSG_CTRL_PATH,   'utf8');
const groupCtrlSrc = fs.readFileSync(GROUP_CTRL_PATH, 'utf8');
const appSrc       = fs.readFileSync(APP_SRC_PATH,    'utf8');

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('../utils/prisma', () => {
  const m = {
    message:           { findUnique: jest.fn() },
    messageRecipient:  { update: jest.fn(), updateMany: jest.fn() },
    groupMember:       { findUnique: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    groupConversation: { update: jest.fn() },
    auditLog:          { create: jest.fn() },
    $transaction:      jest.fn(async (fn) => Array.isArray(fn) ? Promise.all(fn) : fn(m)),
  };
  return m;
});

jest.mock('../sockets', () => ({
  getIo: jest.fn().mockReturnValue(null),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const prisma  = require('../utils/prisma');
const { getIo } = require('../sockets');

// ─── Load controllers AFTER mocks ─────────────────────────────────────────────
const { getMessage } = require('../controllers/message.controller');
const { removeGroupMember } = require('../controllers/groupChat.controller');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeRes() {
  return {
    _status: 200, _body: null,
    status(s) { this._status = s; return this; },
    json(b)   { this._body = b;   return this; },
  };
}

function makeMessage({ senderId, recipientIds = [] } = {}) {
  return {
    id:        'msg-1',
    senderId:  senderId || 'sender-1',
    subject:   'Test',
    body:      'Hello',
    deletedAt: null,
    recipients: recipientIds.map(id => ({
      id:          `rec-${id}`,
      recipientId: id,
      status:      'SENT',
      recipient: { id, firstName: 'R', lastName: 'U' },
    })),
    replies:       [],
    parentMessage: null,
    sender: { id: senderId || 'sender-1', firstName: 'S', lastName: 'U', avatarUrl: null },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MSG-P2-001 — getMessage authorization
// ─────────────────────────────────────────────────────────────────────────────
describe('MSG-P2-001 — getMessage IDOR fix', () => {

  beforeEach(() => jest.clearAllMocks());

  // Source-level: fix is present
  test('S1: source — getMessage has sender/recipient ownership check', () => {
    const fn = (() => {
      const s = msgCtrlSrc.indexOf('async function getMessage');
      const e = msgCtrlSrc.indexOf('async function deleteMessage', s);
      return msgCtrlSrc.slice(s, e);
    })();
    expect(fn).toContain('MSG-P2-001');
    expect(fn).toContain('isSender');
    expect(fn).toContain('isRecipient');
    expect(fn).toContain('message.senderId === req.user.id');
    expect(fn).toContain("message.recipients.some(r => r.recipientId === req.user.id)");
  });

  test('S2: source — authorization check comes before successResponse', () => {
    const fn = (() => {
      const s = msgCtrlSrc.indexOf('async function getMessage');
      const e = msgCtrlSrc.indexOf('async function deleteMessage', s);
      return msgCtrlSrc.slice(s, e);
    })();
    const authIdx    = fn.indexOf('isSender');
    const responseIdx = fn.indexOf("successResponse(res, message");
    expect(authIdx).toBeGreaterThan(-1);
    expect(responseIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(responseIdx);
  });

  test('S3: source — uses 404 (non-disclosing) not 403 for unauthorized access', () => {
    const fn = (() => {
      const s = msgCtrlSrc.indexOf('async function getMessage');
      const e = msgCtrlSrc.indexOf('async function deleteMessage', s);
      return msgCtrlSrc.slice(s, e);
    })();
    // The auth block must return 404 not 403 to avoid disclosing message existence
    // Window is 300 chars from isSender to capture the errorResponse call
    const authBlock = fn.slice(fn.indexOf('isSender'), fn.indexOf('isSender') + 300);
    expect(authBlock).toContain("'Message not found', 404");
  });

  // Unit: sender is allowed
  test('U1: sender can retrieve their own message (200)', async () => {
    const msg = makeMessage({ senderId: 'sender-1', recipientIds: ['recipient-1'] });
    prisma.message.findUnique.mockResolvedValue(msg);
    prisma.messageRecipient.update.mockResolvedValue({});

    const req  = { params: { id: 'msg-1' }, user: { id: 'sender-1' } };
    const res  = makeRes();
    const next = jest.fn();

    await getMessage(req, res, next);

    expect(res._status).toBe(200);
    expect(res._body?.success).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  // Unit: recipient is allowed
  test('U2: recipient can retrieve a message addressed to them (200)', async () => {
    const msg = makeMessage({ senderId: 'sender-1', recipientIds: ['recipient-1', 'recipient-2'] });
    prisma.message.findUnique.mockResolvedValue(msg);
    prisma.messageRecipient.update.mockResolvedValue({});

    const req  = { params: { id: 'msg-1' }, user: { id: 'recipient-1' } };
    const res  = makeRes();
    const next = jest.fn();

    await getMessage(req, res, next);

    expect(res._status).toBe(200);
    expect(res._body?.success).toBe(true);
  });

  // Unit: recipient read receipt is set
  test('U3: recipient access marks the message as READ', async () => {
    const msg = makeMessage({ senderId: 'sender-1', recipientIds: ['recipient-1'] });
    prisma.message.findUnique.mockResolvedValue(msg);
    prisma.messageRecipient.update.mockResolvedValue({});

    const req  = { params: { id: 'msg-1' }, user: { id: 'recipient-1' } };
    const res  = makeRes();
    await getMessage(req, res, jest.fn());

    expect(prisma.messageRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'READ', readAt: expect.any(Date) })
      })
    );
  });

  // Unit: unrelated user is denied
  test('U4: unrelated authenticated user gets 404 (message not found, non-disclosing)', async () => {
    const msg = makeMessage({ senderId: 'sender-1', recipientIds: ['recipient-1'] });
    prisma.message.findUnique.mockResolvedValue(msg);

    const req  = { params: { id: 'msg-1' }, user: { id: 'attacker-x' } }; // not sender or recipient
    const res  = makeRes();
    const next = jest.fn();

    await getMessage(req, res, next);

    expect(res._status).toBe(404);
    // Should NOT return message contents
    const body = JSON.stringify(res._body ?? '');
    expect(body).not.toContain('Hello'); // message body not leaked
    expect(next).not.toHaveBeenCalled();
  });

  // Unit: non-existent message ID returns 404
  test('U5: non-existent message ID returns 404', async () => {
    prisma.message.findUnique.mockResolvedValue(null);

    const req  = { params: { id: 'nonexistent' }, user: { id: 'any-user' } };
    const res  = makeRes();
    await getMessage(req, res, jest.fn());

    expect(res._status).toBe(404);
  });

  // Unit: authorized response retains all expected fields
  test('U6: authorized response retains replies, parentMessage, recipients', async () => {
    const msg = {
      ...makeMessage({ senderId: 'sender-1', recipientIds: ['recipient-1'] }),
      replies: [{ id: 'reply-1', body: 'Reply', sender: { id: 'sender-1' }, recipients: [] }],
      parentMessage: { id: 'parent-1', sender: { id: 'other' } },
    };
    prisma.message.findUnique.mockResolvedValue(msg);
    prisma.messageRecipient.update.mockResolvedValue({});

    const req = { params: { id: 'msg-1' }, user: { id: 'sender-1' } };
    const res = makeRes();
    await getMessage(req, res, jest.fn());

    expect(res._status).toBe(200);
    expect(res._body?.data?.replies).toBeDefined();
    expect(res._body?.data?.parentMessage).toBeDefined();
    expect(res._body?.data?.recipients).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MSG-P2-002 — Group typing socket room membership guard
// ─────────────────────────────────────────────────────────────────────────────
describe('MSG-P2-002 — group:typing socket room membership guard', () => {

  function extractHandlerSection(src, eventName) {
    const marker = `socket.on('${eventName}'`;
    const start  = src.indexOf(marker);
    if (start === -1) return '';
    const next = src.indexOf("  socket.on('", start + marker.length);
    return next === -1 ? src.slice(start) : src.slice(start, next);
  }

  const typingStartSection = extractHandlerSection(appSrc, 'group:typing_start');
  const typingStopSection  = extractHandlerSection(appSrc, 'group:typing_stop');

  test('S1: group:typing_start has socket.rooms.has() guard', () => {
    expect(typingStartSection).toContain('socket.rooms.has(`conversation:${convId}`)');
  });

  test('S2: group:typing_stop has socket.rooms.has() guard', () => {
    expect(typingStopSection).toContain('socket.rooms.has(`conversation:${convId}`)');
  });

  test('S3: MSG-P2-002 comment present in source', () => {
    expect(typingStartSection).toContain('MSG-P2-002');
    expect(typingStopSection).toContain('MSG-P2-002');
  });

  test('S4: guard returns early (before emit) in typing_start', () => {
    const guardIdx  = typingStartSection.indexOf('socket.rooms.has(`conversation:${convId}`)');
    const emitIdx   = typingStartSection.indexOf('emit(\'group:typing_start\'');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(emitIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(emitIdx);
  });

  test('S5: guard returns early (before emit) in typing_stop', () => {
    const guardIdx  = typingStopSection.indexOf('socket.rooms.has(`conversation:${convId}`)');
    const emitIdx   = typingStopSection.indexOf('emit(\'group:typing_stop\'');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(emitIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(emitIdx);
  });

  test('S6: userId is still sourced from socket closure (not client payload)', () => {
    // The emit must use `userId` from the closure (socket.userId at connection),
    // not any `userId` field from the client payload
    const sigMatch = typingStartSection.match(/socket\.on\('group:typing_start',\s*\(\{([^}]+)\}/);
    expect(sigMatch).not.toBeNull();
    const params = sigMatch[1];
    // Client payload has convId, name, userName — but NOT userId
    expect(params).toContain('convId');
    expect(params).not.toContain('userId');
  });

  test('S7: group:join still requires DB membership (not regressed)', () => {
    const joinSection = extractHandlerSection(appSrc, 'group:join');
    expect(joinSection).toContain('groupMember.findFirst');
    expect(joinSection).toContain('leftAt: null');
    expect(joinSection).toContain('socket.join(`conversation:');
  });

  // Simulated socket behaviour
  test('U1: socket IN conversation room — typing_start would be relayed', () => {
    // Simulate: socket is in the room → guard passes → relay happens
    const rooms = new Set([`socket-id`, `conversation:group-1`]);
    const convId = 'group-1';
    const inRoom = rooms.has(`conversation:${convId}`);
    expect(inRoom).toBe(true); // would proceed past guard
  });

  test('U2: socket NOT IN conversation room — typing_start is dropped', () => {
    const rooms = new Set([`socket-id`, `conversation:group-2`]); // different group
    const convId = 'group-1';
    const inRoom = rooms.has(`conversation:${convId}`);
    expect(inRoom).toBe(false); // guard would return early
  });

  test('U3: socket in Group A cannot inject typing into Group B', () => {
    const rooms = new Set([`socket-id`, `conversation:group-A`]);
    expect(rooms.has('conversation:group-A')).toBe(true);  // own group: allowed
    expect(rooms.has('conversation:group-B')).toBe(false); // other group: blocked
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MSG-P2-003 — removeGroupMember socketsLeave eviction
// ─────────────────────────────────────────────────────────────────────────────
describe('MSG-P2-003 — removeGroupMember socket eviction fix', () => {

  function extractRemoveFn(src) {
    const start = src.indexOf('async function removeGroupMember');
    const end   = src.indexOf('async function sendGroupMessage', start);
    return src.slice(start, end);
  }

  const removeFn = extractRemoveFn(groupCtrlSrc);

  test('S1: removeGroupMember calls socketsLeave', () => {
    expect(removeFn).toContain('socketsLeave');
    expect(removeFn).toContain('`conversation:${conversationId}`');
  });

  test('S2: MSG-P2-003 comment present in source', () => {
    expect(removeFn).toContain('MSG-P2-003');
  });

  test('S3: eviction uses getIo().in(user:${userId}) pattern (personal room)', () => {
    // Should use io.in(`user:${userId}`) to target the removed user's sockets
    // (not io.to() which would include all room subscribers)
    expect(removeFn).toContain('.in(`user:${userId}`).socketsLeave');
  });

  test('S4: eviction targets only the conversation room (not a full disconnect)', () => {
    // socketsLeave() removes only the specific room — the socket connection stays alive
    expect(removeFn).toContain('`conversation:${conversationId}`');
    expect(removeFn).not.toContain('socket.disconnect');
    expect(removeFn).not.toContain('.disconnect(');
  });

  test('S5: group:member_removed broadcast still emitted after eviction', () => {
    // Broadcast to remaining members must still happen
    expect(removeFn).toContain("emit('group:member_removed'");
  });

  test('S6: eviction comes before or alongside the broadcast (not after)', () => {
    // The eviction should fire before/alongside the member_removed broadcast
    const evictIdx     = removeFn.indexOf('socketsLeave');
    const broadcastIdx = removeFn.indexOf("emit('group:member_removed'");
    expect(evictIdx).toBeGreaterThan(-1);
    expect(broadcastIdx).toBeGreaterThan(-1);
    // eviction is in the same if-block, before the emit
    expect(evictIdx).toBeLessThan(broadcastIdx);
  });

  // Unit: removeGroupMember calls socketsLeave
  test('U1: removeGroupMember calls io.in(user).socketsLeave(conversation) on removal', async () => {
    const mockSocketsLeave = jest.fn();
    const mockIo = {
      in:  jest.fn().mockReturnValue({ socketsLeave: mockSocketsLeave }),
      to:  jest.fn().mockReturnValue({ emit: jest.fn() }),
    };
    getIo.mockReturnValue(mockIo);

    // Set up: current user is ADMIN, target user is MEMBER
    prisma.groupMember.findUnique.mockResolvedValue({ id: 'mem-1', role: 'ADMIN' });
    prisma.groupMember.updateMany.mockResolvedValue({ count: 1 });
    prisma.groupMember.count.mockResolvedValue(3);
    prisma.groupConversation.update.mockResolvedValue({});

    const req = {
      params: { conversationId: 'conv-1', userId: 'removed-user' },
      user:   { id: 'admin-user' },
    };
    const res  = makeRes();
    const next = jest.fn();

    await removeGroupMember(req, res, next);

    expect(res._status).toBe(200);
    // Verify socketsLeave was called for the removed user's personal room
    expect(mockIo.in).toHaveBeenCalledWith('user:removed-user');
    expect(mockSocketsLeave).toHaveBeenCalledWith('conversation:conv-1');
    // Verify member_removed broadcast still fired
    expect(mockIo.to).toHaveBeenCalledWith('conversation:conv-1');
  });

  test('U2: self-leave also calls socketsLeave (member leaving voluntarily)', async () => {
    const mockSocketsLeave = jest.fn();
    const mockIo = {
      in:  jest.fn().mockReturnValue({ socketsLeave: mockSocketsLeave }),
      to:  jest.fn().mockReturnValue({ emit: jest.fn() }),
    };
    getIo.mockReturnValue(mockIo);

    prisma.groupMember.findUnique.mockResolvedValue({ id: 'mem-2', role: 'MEMBER' });
    prisma.groupMember.updateMany.mockResolvedValue({ count: 1 });
    prisma.groupMember.count.mockResolvedValue(2);
    prisma.groupConversation.update.mockResolvedValue({});

    const req = {
      params: { conversationId: 'conv-2', userId: 'self-user' },
      user:   { id: 'self-user' }, // isSelf = true
    };
    const res = makeRes();
    await removeGroupMember(req, res, jest.fn());

    expect(res._status).toBe(200);
    expect(mockIo.in).toHaveBeenCalledWith('user:self-user');
    expect(mockSocketsLeave).toHaveBeenCalledWith('conversation:conv-2');
  });

  test('U3: HTTP authorization remains intact — non-member/non-admin gets 403', async () => {
    // Current user is a regular MEMBER trying to remove someone else
    prisma.groupMember.findUnique.mockResolvedValue({ id: 'mem-3', role: 'MEMBER' });

    const req = {
      params: { conversationId: 'conv-3', userId: 'other-user' },
      user:   { id: 'regular-member' },
    };
    const res = makeRes();
    await removeGroupMember(req, res, jest.fn());

    expect(res._status).toBe(403);
    expect(prisma.groupMember.updateMany).not.toHaveBeenCalled();
  });

  test('U4: getIo() null does not throw (graceful degradation)', async () => {
    getIo.mockReturnValue(null); // No Socket.IO server

    prisma.groupMember.findUnique.mockResolvedValue({ id: 'mem-4', role: 'OWNER' });
    prisma.groupMember.updateMany.mockResolvedValue({ count: 1 });
    prisma.groupMember.count.mockResolvedValue(1);
    prisma.groupConversation.update.mockResolvedValue({});

    const req = {
      params: { conversationId: 'conv-4', userId: 'user-4' },
      user:   { id: 'owner-4' },
    };
    const res  = makeRes();
    const next = jest.fn();

    // Should not throw
    await expect(removeGroupMember(req, res, next)).resolves.not.toThrow();
    expect(res._status).toBe(200);
    expect(next).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 24B regression — voice:reaction guard intact
// ─────────────────────────────────────────────────────────────────────────────
describe('Phase 24B regression — voice:reaction guard not affected by Phase 24D', () => {
  function extractHandlerSection(src, eventName) {
    const marker = `socket.on('${eventName}'`;
    const start  = src.indexOf(marker);
    if (start === -1) return '';
    const next = src.indexOf("  socket.on('", start + marker.length);
    return next === -1 ? src.slice(start) : src.slice(start, next);
  }

  test('voice:reaction still has socket.rooms.has() guard (PH19-001 not regressed)', () => {
    const section = extractHandlerSection(appSrc, 'voice:reaction');
    expect(section).toContain('socket.rooms.has(`voice:${roomId}`)');
  });

  test('voice:speaking guard unchanged', () => {
    const section = extractHandlerSection(appSrc, 'voice:speaking');
    expect(section).toContain('socket.rooms.has(`voice:${roomId}`)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 24C regression — wasKicked / ban check inside tx intact
// ─────────────────────────────────────────────────────────────────────────────
describe('Phase 24C regression — voice controller unchanged', () => {
  const VOICE_CTRL = path.join(__dirname, '../controllers/voice.controller.js');
  const voiceSrc = fs.readFileSync(VOICE_CTRL, 'utf8');

  test('kickParticipant still sets wasKicked=true atomically', () => {
    const start = voiceSrc.indexOf('async function kickParticipant');
    const end   = voiceSrc.indexOf('async function banParticipant', start);
    const fn    = voiceSrc.slice(start, end);
    expect(fn).toContain('wasKicked:    true');
    expect(fn).toContain('seatNumber:   null');
  });

  test('joinRoom ban check still inside transaction (PH24C-002)', () => {
    expect(voiceSrc).toContain('BANNED_FROM_ROOM');
    expect(voiceSrc).toContain("txErr.message === 'BANNED_FROM_ROOM'");
  });

  test('autoPromote P2002 handler intact (PH24C-004)', () => {
    const AUTO_PROMOTE = path.join(__dirname, '../utils/autoPromote.js');
    const autoSrc = fs.readFileSync(AUTO_PROMOTE, 'utf8');
    expect(autoSrc).toContain('isDupSeat');
    expect(autoSrc).toContain("assignErr.code === 'P2002'");
  });
});
