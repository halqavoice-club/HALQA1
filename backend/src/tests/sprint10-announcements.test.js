'use strict';
/**
 * Sprint 10 — Platform Announcement Creation Regression Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * UIGAP-012: POST/PATCH/DELETE /api/v1/admin/stats/announcements
 *
 * POST /admin/stats/announcements:
 *   - SA creates single-school announcement (schoolId provided)
 *   - SA creates platform-wide announcement (no schoolId — fan-out to all schools)
 *   - Missing title returns 400
 *   - Missing content returns 400
 *   - Non-existent schoolId returns 404
 *   - Empty school list (no active schools) returns 400 for platform-wide
 *   - MEMBER gets 403, unauthenticated gets 401
 *
 * PATCH /admin/stats/announcements/:id:
 *   - SA can update title, content, isPinned, targetRoles, expiresAt
 *   - Non-existent returns 404
 *
 * DELETE /admin/stats/announcements/:id:
 *   - SA can soft-delete an announcement
 *   - Non-existent returns 404
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
jest.mock('../middleware/ipAllowlist', () => (req, res, next) => next());
jest.mock('../sockets',      () => ({ getIo: jest.fn(() => null) }));
jest.mock('../services/notification.service', () => ({
  notifySchool: jest.fn().mockResolvedValue(undefined),
  notify:       jest.fn().mockResolvedValue(undefined),
}));

const request      = require('supertest');
const express      = require('express');
const cookieParser = require('cookie-parser');
const prisma       = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');
const fs   = require('fs');
const path = require('path');

// ─── App setup ────────────────────────────────────────────────────────────────
let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/admin/stats', require('../routes/admin-stats.routes'));
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function asUser(id, role) {
  const u = { id, role, status: 'ACTIVE', schoolId: null, firstName: 'T', lastName: 'U', avatarUrl: null, deletedAt: null };
  verifyAccessToken.mockReturnValue({ userId: id, role, schoolId: null });
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}
function tok(id) { return `Bearer t-${id}`; }

const ANN_ID    = 'ann-uuid-001';
const SCHOOL_ID = 'school-uuid-001';
const SCHOOL    = { id: SCHOOL_ID, name: 'Test School', isActive: true, deletedAt: null };
const ANN       = {
  id: ANN_ID, schoolId: SCHOOL_ID, authorId: 'sa-1',
  title: 'Test', content: 'Content', targetRoles: ['TEACHER'],
  isPinned: false, publishAt: new Date(), expiresAt: null,
  deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);
  require('../services/notification.service').notifySchool.mockResolvedValue(undefined);

  if (!prisma.announcement)  prisma.announcement  = {};
  if (!prisma.school)        prisma.school        = {};
  if (!prisma.auditLog)      prisma.auditLog      = {};

  prisma.announcement.findMany    = jest.fn().mockResolvedValue([ANN]);
  prisma.announcement.count       = jest.fn().mockResolvedValue(1);
  prisma.announcement.create      = jest.fn().mockResolvedValue(ANN);
  prisma.announcement.update      = jest.fn().mockResolvedValue({ ...ANN, isPinned: true });
  prisma.announcement.findUnique  = jest.fn().mockResolvedValue(ANN);
  prisma.school.findUnique        = jest.fn().mockResolvedValue(SCHOOL);
  prisma.school.findMany          = jest.fn().mockResolvedValue([SCHOOL]);
  prisma.auditLog.create          = jest.fn().mockResolvedValue({});
  prisma.$transaction             = jest.fn().mockImplementation(async (ops) => {
    if (typeof ops === 'function') return ops({});
    // Array of promises (fan-out create)
    return Promise.all(ops);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Access control
// ─────────────────────────────────────────────────────────────────────────────
describe('UIGAP-012: Announcement access control', () => {
  test('Unauthenticated POST returns 401', async () => {
    const res = await request(app).post('/api/v1/admin/stats/announcements').send({ title: 'T', content: 'C' });
    expect(res.status).toBe(401);
  });

  test('MEMBER POST returns 403', async () => {
    asUser('mb-1', 'MEMBER');
    const res = await request(app)
      .post('/api/v1/admin/stats/announcements')
      .set('Authorization', tok('mb-1'))
      .send({ title: 'T', content: 'C' });
    expect(res.status).toBe(403);
  });

  test('Unauthenticated PATCH returns 401', async () => {
    const res = await request(app).patch(`/api/v1/admin/stats/announcements/${ANN_ID}`).send({ title: 'New' });
    expect(res.status).toBe(401);
  });

  test('Unauthenticated DELETE returns 401', async () => {
    const res = await request(app).delete(`/api/v1/admin/stats/announcements/${ANN_ID}`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST — validation
// ─────────────────────────────────────────────────────────────────────────────
describe('UIGAP-012: POST /announcements validation', () => {
  beforeEach(() => asUser('sa-1', 'SUPER_ADMIN'));

  test('Missing title returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/admin/stats/announcements')
      .set('Authorization', tok('sa-1'))
      .send({ content: 'Some content here' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/title/i);
  });

  test('Missing content returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/admin/stats/announcements')
      .set('Authorization', tok('sa-1'))
      .send({ title: 'My announcement title' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/content/i);
  });

  test('Non-existent schoolId returns 404', async () => {
    prisma.school.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/v1/admin/stats/announcements')
      .set('Authorization', tok('sa-1'))
      .send({ title: 'Test announcement', content: 'Some content', schoolId: 'bad-id' });
    expect(res.status).toBe(404);
  });

  test('No active schools for platform-wide returns 400', async () => {
    prisma.school.findMany.mockResolvedValue([]); // no active schools
    const res = await request(app)
      .post('/api/v1/admin/stats/announcements')
      .set('Authorization', tok('sa-1'))
      .send({ title: 'Platform announcement', content: 'Content here for all schools' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no active schools/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST — happy path
// ─────────────────────────────────────────────────────────────────────────────
describe('UIGAP-012: POST /announcements happy path', () => {
  beforeEach(() => asUser('sa-1', 'SUPER_ADMIN'));

  test('Creates single-school announcement when schoolId provided', async () => {
    const res = await request(app)
      .post('/api/v1/admin/stats/announcements')
      .set('Authorization', tok('sa-1'))
      .send({ title: 'School announcement', content: 'Content here', schoolId: SCHOOL_ID });
    expect(res.status).toBe(201);
    expect(res.body.data.count).toBe(1);
    expect(prisma.announcement.create).toHaveBeenCalledTimes(1);
  });

  test('Creates platform-wide announcement when no schoolId (fan-out)', async () => {
    // Two schools
    prisma.school.findMany.mockResolvedValue([
      { id: 'sch-1', name: 'School A', isActive: true, deletedAt: null },
      { id: 'sch-2', name: 'School B', isActive: true, deletedAt: null },
    ]);
    prisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));
    prisma.announcement.create.mockResolvedValue(ANN);

    const res = await request(app)
      .post('/api/v1/admin/stats/announcements')
      .set('Authorization', tok('sa-1'))
      .send({ title: 'Platform broadcast', content: 'Platform content for all schools' });
    expect(res.status).toBe(201);
    expect(res.body.data.count).toBe(2);
    // $transaction called with 2 create ops
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  test('Response contains announcements array and count', async () => {
    const res = await request(app)
      .post('/api/v1/admin/stats/announcements')
      .set('Authorization', tok('sa-1'))
      .send({ title: 'Test announcement title', content: 'Test content body', schoolId: SCHOOL_ID });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('announcements');
    expect(res.body.data).toHaveProperty('count');
    expect(Array.isArray(res.body.data.announcements)).toBe(true);
  });

  test('isPinned and targetRoles are passed through', async () => {
    await request(app)
      .post('/api/v1/admin/stats/announcements')
      .set('Authorization', tok('sa-1'))
      .send({ title: 'Pinned announcement', content: 'Content', schoolId: SCHOOL_ID, isPinned: true, targetRoles: ['TEACHER', 'STUDENT'] });
    expect(prisma.announcement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isPinned: true,
          targetRoles: ['TEACHER', 'STUDENT'],
        })
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH
// ─────────────────────────────────────────────────────────────────────────────
describe('UIGAP-012: PATCH /announcements/:id', () => {
  beforeEach(() => asUser('sa-1', 'SUPER_ADMIN'));

  test('SA can update an announcement title', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/stats/announcements/${ANN_ID}`)
      .set('Authorization', tok('sa-1'))
      .send({ title: 'Updated title' });
    expect(res.status).toBe(200);
    expect(prisma.announcement.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ANN_ID }, data: { title: 'Updated title' } })
    );
  });

  test('SA can toggle isPinned', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/stats/announcements/${ANN_ID}`)
      .set('Authorization', tok('sa-1'))
      .send({ isPinned: true });
    expect(res.status).toBe(200);
  });

  test('Non-existent announcement returns 404', async () => {
    prisma.announcement.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .patch(`/api/v1/admin/stats/announcements/no-such-id`)
      .set('Authorization', tok('sa-1'))
      .send({ title: 'Updated' });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────────────────────
describe('UIGAP-012: DELETE /announcements/:id', () => {
  beforeEach(() => asUser('sa-1', 'SUPER_ADMIN'));

  test('SA can delete an announcement', async () => {
    const res = await request(app)
      .delete(`/api/v1/admin/stats/announcements/${ANN_ID}`)
      .set('Authorization', tok('sa-1'));
    expect(res.status).toBe(200);
    expect(prisma.announcement.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ANN_ID }, data: { deletedAt: expect.any(Date) } })
    );
  });

  test('Non-existent announcement returns 404', async () => {
    prisma.announcement.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .delete(`/api/v1/admin/stats/announcements/no-such-id`)
      .set('Authorization', tok('sa-1'));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source verification
// ─────────────────────────────────────────────────────────────────────────────
describe('UIGAP-012: Source verification', () => {
  test('admin-stats.routes.js has POST, PATCH, DELETE for announcements', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../routes/admin-stats.routes.js'), 'utf8'
    );
    expect(src).toMatch(/router\.post\(['"]\/announcements['"]/);
    expect(src).toMatch(/router\.patch\(['"]\/announcements\/:id['"]/);
    expect(src).toMatch(/router\.delete\(['"]\/announcements\/:id['"]/);
    expect(src).toMatch(/UIGAP-012/);
    expect(src).toMatch(/fan.out|fan-out|fanout/i);
  });

  test('Frontend announcements page exists', () => {
    const workspaceRoot = path.resolve(__dirname, '../../..');
    const pagePath = path.join(
      workspaceRoot,
      'frontend', 'src', 'app', '(dashboard)', 'admin', 'announcements', 'page.tsx'
    );
    expect(fs.existsSync(pagePath)).toBe(true);
  });
});
