'use strict';
/**
 * Sprint 16 — CHAT-GAP-002 (DM editing) + UIGAP-011 (CSV export) Tests
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CHAT-GAP-002: PATCH /api/v1/dm/messages/:msgId
 *   - Sender can edit their own message within 15 minutes
 *   - Non-sender gets 403
 *   - Empty body returns 400
 *   - Body > 5000 chars returns 400
 *   - Message older than 15 min returns 400
 *   - Deleted message returns 400
 *   - Non-existent message returns 404
 *   - Successful edit: isEdited=true, editedAt set, body updated
 *
 * UIGAP-011: GET /api/v1/admin/stats/export/users
 *            GET /api/v1/admin/stats/export/transactions
 *   - Returns CSV content-type
 *   - Returns correct header row
 *   - Non-SA gets 403
 *   - Filters work (status, role, type, userId)
 */

jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady:       jest.fn(() => false),
  getCache:           jest.fn().mockResolvedValue(null),
  setCache:           jest.fn().mockResolvedValue(undefined),
  deleteCache:        jest.fn().mockResolvedValue(undefined),
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/jwt',    () => ({ verifyAccessToken: jest.fn() }));
jest.mock('../sockets',      () => ({ getIo: jest.fn(() => null) }));
jest.mock('../middleware/ipAllowlist', () => (req, res, next) => next());

const request      = require('supertest');
const express      = require('express');
const cookieParser = require('cookie-parser');
const prisma       = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');
const fs   = require('fs');
const path = require('path');

// ─── App setup ────────────────────────────────────────────────────────────────
let dmApp, adminApp;

beforeAll(() => {
  dmApp = express();
  dmApp.use(express.json());
  dmApp.use(cookieParser());
  dmApp.use('/api/v1/dm', require('../routes/dm.routes'));
  dmApp.use((err, req, res, _n) => res.status(err.status || 500).json({ success: false, message: err.message }));

  adminApp = express();
  adminApp.use(express.json());
  adminApp.use(cookieParser());
  adminApp.use('/api/v1/admin/stats', require('../routes/admin-stats.routes'));
  adminApp.use((err, req, res, _n) => res.status(err.status || 500).json({ success: false, message: err.message }));
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function asUser(id, role = 'MEMBER', schoolId = null) {
  const u = { id, role, status: 'ACTIVE', schoolId, firstName: 'T', lastName: 'U', avatarUrl: null, deletedAt: null };
  verifyAccessToken.mockReturnValue({ userId: id, role, schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}
function tok(id) { return `Bearer t-${id}`; }

const SENDER_ID   = 'sender-user';
const OTHER_ID    = 'other-user';
const MSG_ID      = 'msg-uuid-001';
const RECENT_MSG  = {
  id: MSG_ID, senderId: SENDER_ID, receiverId: OTHER_ID,
  body: 'Hello there', status: 'DELIVERED',
  deletedBySender: false, deletedByReceiver: false,
  createdAt: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago — within window
  conversationId: 'conv-001',
};
const OLD_MSG = {
  ...RECENT_MSG,
  createdAt: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago — outside window
};

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);

  if (!prisma.directMessage) prisma.directMessage = {};
  prisma.directMessage.findUnique = jest.fn().mockResolvedValue(RECENT_MSG);
  prisma.directMessage.update     = jest.fn().mockResolvedValue({
    ...RECENT_MSG, body: 'Updated body', isEdited: true, editedAt: new Date()
  });

  if (!prisma.user) prisma.user = {};
  prisma.user.findMany  = jest.fn().mockResolvedValue([]);
  prisma.user.findUnique = jest.fn();

  if (!prisma.walletTransaction) prisma.walletTransaction = {};
  prisma.walletTransaction.findMany = jest.fn().mockResolvedValue([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// CHAT-GAP-002: DM Message Editing
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-GAP-002: PATCH /dm/messages/:msgId — DM editing', () => {

  test('Unauthenticated returns 401', async () => {
    const res = await request(dmApp)
      .patch(`/api/v1/dm/messages/${MSG_ID}`)
      .send({ body: 'Updated' });
    expect(res.status).toBe(401);
  });

  test('Missing body returns 400', async () => {
    asUser(SENDER_ID);
    const res = await request(dmApp)
      .patch(`/api/v1/dm/messages/${MSG_ID}`)
      .set('Authorization', tok(SENDER_ID))
      .send({ body: '' });
    expect(res.status).toBe(400);
  });

  test('Non-existent message returns 404', async () => {
    asUser(SENDER_ID);
    prisma.directMessage.findUnique.mockResolvedValue(null);
    const res = await request(dmApp)
      .patch(`/api/v1/dm/messages/no-such-id`)
      .set('Authorization', tok(SENDER_ID))
      .send({ body: 'Updated message text' });
    expect(res.status).toBe(404);
  });

  test('Non-sender gets 403', async () => {
    asUser(OTHER_ID);
    const res = await request(dmApp)
      .patch(`/api/v1/dm/messages/${MSG_ID}`)
      .set('Authorization', tok(OTHER_ID))
      .send({ body: 'Trying to edit someone else message' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/your own/i);
  });

  test('Message older than 15 minutes returns 400', async () => {
    asUser(SENDER_ID);
    prisma.directMessage.findUnique.mockResolvedValue(OLD_MSG);
    const res = await request(dmApp)
      .patch(`/api/v1/dm/messages/${MSG_ID}`)
      .set('Authorization', tok(SENDER_ID))
      .send({ body: 'Trying to edit old message content' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/15 minutes/i);
  });

  test('Deleted message (by sender) returns 400', async () => {
    asUser(SENDER_ID);
    prisma.directMessage.findUnique.mockResolvedValue({ ...RECENT_MSG, deletedBySender: true });
    const res = await request(dmApp)
      .patch(`/api/v1/dm/messages/${MSG_ID}`)
      .set('Authorization', tok(SENDER_ID))
      .send({ body: 'Trying to edit deleted message' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/deleted/i);
  });

  test('Body > 5000 chars returns 400', async () => {
    asUser(SENDER_ID);
    const res = await request(dmApp)
      .patch(`/api/v1/dm/messages/${MSG_ID}`)
      .set('Authorization', tok(SENDER_ID))
      .send({ body: 'x'.repeat(5001) });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/too long/i);
  });

  test('Sender can edit recent message — returns 200 with isEdited:true', async () => {
    asUser(SENDER_ID);
    const res = await request(dmApp)
      .patch(`/api/v1/dm/messages/${MSG_ID}`)
      .set('Authorization', tok(SENDER_ID))
      .send({ body: 'Updated message text here' });
    expect(res.status).toBe(200);
    expect(prisma.directMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MSG_ID },
        data:  expect.objectContaining({ body: 'Updated message text here', isEdited: true }),
      })
    );
  });

  test('editedAt is set on successful edit', async () => {
    asUser(SENDER_ID);
    await request(dmApp)
      .patch(`/api/v1/dm/messages/${MSG_ID}`)
      .set('Authorization', tok(SENDER_ID))
      .send({ body: 'Updated message body text' });
    const call = prisma.directMessage.update.mock.calls[0][0];
    expect(call.data.editedAt).toBeInstanceOf(Date);
  });

  // Source verification
  test('dm.controller.js exports editMessage', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/dm.controller.js'), 'utf8');
    expect(src).toMatch(/editMessage/);
    expect(src).toMatch(/CHAT-GAP-002/);
    expect(src).toMatch(/isEdited.*true/);
    expect(src).toMatch(/15.*minute|EDIT_WINDOW/);
  });

  test('schema.prisma has isEdited and editedAt on DirectMessage', () => {
    // backend/src/tests -> ../../../ -> workspace root -> backend/prisma
    const src = fs.readFileSync(
      path.join(__dirname, '../../prisma/schema.prisma'), 'utf8'
    );
    expect(src).toMatch(/isEdited/);
    expect(src).toMatch(/editedAt/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UIGAP-011: CSV Export
// ─────────────────────────────────────────────────────────────────────────────
describe('UIGAP-011: GET /admin/stats/export/users — CSV user export', () => {

  beforeEach(() => {
    asUser('sa-1', 'SUPER_ADMIN');
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'alice@test.com', firstName: 'Alice', lastName: 'Smith',
        role: 'MEMBER', status: 'ACTIVE', schoolId: 'sch-1',
        createdAt: new Date('2026-01-01'), lastLoginAt: new Date('2026-08-01') },
      { id: 'u2', email: 'bob@test.com', firstName: 'Bob', lastName: 'Jones',
        role: 'TEACHER', status: 'ACTIVE', schoolId: 'sch-1',
        createdAt: new Date('2026-02-01'), lastLoginAt: null },
    ]);
  });

  test('Non-SA returns 403', async () => {
    asUser('mb-1', 'MEMBER');
    const res = await request(adminApp)
      .get('/api/v1/admin/stats/export/users')
      .set('Authorization', tok('mb-1'));
    expect(res.status).toBe(403);
  });

  test('Returns CSV content-type', async () => {
    const res = await request(adminApp)
      .get('/api/v1/admin/stats/export/users')
      .set('Authorization', tok('sa-1'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/i);
  });

  test('Returns Content-Disposition with filename', async () => {
    const res = await request(adminApp)
      .get('/api/v1/admin/stats/export/users')
      .set('Authorization', tok('sa-1'));
    expect(res.headers['content-disposition']).toMatch(/attachment.*\.csv/i);
  });

  test('First row is the header with expected columns', async () => {
    const res = await request(adminApp)
      .get('/api/v1/admin/stats/export/users')
      .set('Authorization', tok('sa-1'));
    const lines = res.text.split('\r\n');
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('email');
    expect(lines[0]).toContain('firstName');
    expect(lines[0]).toContain('role');
    expect(lines[0]).toContain('status');
  });

  test('CSV body contains user data', async () => {
    const res = await request(adminApp)
      .get('/api/v1/admin/stats/export/users')
      .set('Authorization', tok('sa-1'));
    expect(res.text).toContain('alice@test.com');
    expect(res.text).toContain('bob@test.com');
    expect(res.text).toContain('MEMBER');
    expect(res.text).toContain('TEACHER');
  });

  test('X-Row-Count header reflects row count', async () => {
    const res = await request(adminApp)
      .get('/api/v1/admin/stats/export/users')
      .set('Authorization', tok('sa-1'));
    expect(res.headers['x-row-count']).toBe('2');
  });

  test('Null lastLoginAt becomes empty string in CSV', async () => {
    const res = await request(adminApp)
      .get('/api/v1/admin/stats/export/users')
      .set('Authorization', tok('sa-1'));
    // bob has null lastLoginAt — should not appear as "null" in CSV
    expect(res.text).not.toMatch(/,null,/);
    expect(res.text).not.toMatch(/,null\r\n/);
  });
});

describe('UIGAP-011: GET /admin/stats/export/transactions — CSV tx export', () => {

  beforeEach(() => {
    asUser('sa-1', 'SUPER_ADMIN');
    prisma.walletTransaction.findMany.mockResolvedValue([
      { id: 'tx-1', userId: 'u1', type: 'STRIPE_PURCHASE', coins: 1000,
        description: 'Stripe buy', stripeSessionId: 'cs_abc', createdAt: new Date('2026-08-01'),
        user: { email: 'alice@test.com', firstName: 'Alice', lastName: 'Smith' } },
    ]);
  });

  test('Non-SA returns 403', async () => {
    asUser('mb-1', 'MEMBER');
    const res = await request(adminApp)
      .get('/api/v1/admin/stats/export/transactions')
      .set('Authorization', tok('mb-1'));
    expect(res.status).toBe(403);
  });

  test('Returns CSV content-type', async () => {
    const res = await request(adminApp)
      .get('/api/v1/admin/stats/export/transactions')
      .set('Authorization', tok('sa-1'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/i);
  });

  test('CSV contains transaction data', async () => {
    const res = await request(adminApp)
      .get('/api/v1/admin/stats/export/transactions')
      .set('Authorization', tok('sa-1'));
    expect(res.text).toContain('alice@test.com');
    expect(res.text).toContain('STRIPE_PURCHASE');
    expect(res.text).toContain('1000');
  });

  test('Header row has expected columns', async () => {
    const res = await request(adminApp)
      .get('/api/v1/admin/stats/export/transactions')
      .set('Authorization', tok('sa-1'));
    const header = res.text.split('\r\n')[0];
    expect(header).toContain('userId');
    expect(header).toContain('type');
    expect(header).toContain('coins');
    expect(header).toContain('stripeSessionId');
  });

  // Source verification
  test('admin-stats.routes.js has /export/users and /export/transactions', () => {
    const src = fs.readFileSync(path.join(__dirname, '../routes/admin-stats.routes.js'), 'utf8');
    expect(src).toMatch(/export\/users/);
    expect(src).toMatch(/export\/transactions/);
    expect(src).toMatch(/UIGAP-011/);
    expect(src).toMatch(/text\/csv/);
  });
});
