'use strict';
jest.mock('../utils/prisma', () => ({
  user:             { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
  userReport:       { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  userBlock:        { findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  friendRequest:    { findFirst: jest.fn(), deleteMany: jest.fn() },
  schoolMembership: { findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
  school:           { count: jest.fn() },
  class:            { count: jest.fn() },
  auditLog:         { create: jest.fn(), count: jest.fn() },
  liveClass:        { count: jest.fn() },
  announcement:     { count: jest.fn() },
  $queryRawUnsafe:  jest.fn(),
  $transaction:     jest.fn(),
}));
jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => false),
  getCache: jest.fn().mockResolvedValue(null),
  setCache: jest.fn().mockResolvedValue(undefined),
  deleteCache: jest.fn().mockResolvedValue(undefined),
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/jwt', () => ({ verifyAccessToken: jest.fn() }));
jest.mock('../middleware/ipAllowlist', () => (req, res, next) => next());
jest.mock('../sockets', () => ({ getIo: jest.fn(() => null) }));
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const prisma = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');

function asUser(id, role, status, schoolId) {
  status = status || 'ACTIVE';
  schoolId = schoolId || null;
  var u = { id: id, role: role, status: status, schoolId: schoolId, firstName: 'T', lastName: 'U', avatarUrl: null, deletedAt: null };
  verifyAccessToken.mockReturnValue({ userId: id, role: role, schoolId: schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}

function tok(id) { return 'Bearer t-' + id; }

function buildApp() {
  var a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use('/api/v1/social',      require('../routes/social.routes'));
  a.use('/api/v1/admin/stats', require('../routes/admin-stats.routes'));
  a.use(function(err, req, res, _n) { res.status(err.status || 500).json({ success: false, message: err.message }); });
  return a;
}

var app;
beforeAll(function() { app = buildApp(); });
beforeEach(function() {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);
  require('../utils/redis').getCache.mockResolvedValue(null);
});

describe('authenticate() status enforcement', function() {
  test('SUSPENDED user gets 403', async function() {
    asUser('sus', 'MEMBER', 'SUSPENDED');
    var res = await request(app).get('/api/v1/social/search?q=x').set('Authorization', tok('sus'));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/suspended/i);
  });
  test('BANNED user gets 403', async function() {
    asUser('ban', 'MEMBER', 'BANNED');
    var res = await request(app).get('/api/v1/social/search?q=x').set('Authorization', tok('ban'));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/banned/i);
  });
  test('INACTIVE user gets 403', async function() {
    asUser('ina', 'MEMBER', 'INACTIVE');
    var res = await request(app).get('/api/v1/social/search?q=x').set('Authorization', tok('ina'));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/inactive/i);
  });
  test('No token gets 401', async function() {
    var res = await request(app).get('/api/v1/social/search?q=x');
    expect(res.status).toBe(401);
  });
  test('Active MEMBER with no school can call social search', async function() {
    asUser('mem', 'MEMBER', 'ACTIVE', null);
    prisma.user.findMany.mockResolvedValue([]);
    var res = await request(app).get('/api/v1/social/search?q=hi').set('Authorization', tok('mem'));
    expect(res.status).not.toBe(401);
  });
});
describe('Platform admin access control', function() {
  test('SUPER_ADMIN can reach /admin/stats', async function() {
    asUser('sa1', 'SUPER_ADMIN', 'ACTIVE');
    prisma.user.count.mockResolvedValue(10);
    prisma.school.count.mockResolvedValue(2);
    prisma.liveClass.count.mockResolvedValue(0);
    prisma.userReport.count.mockResolvedValue(1);
    prisma.auditLog.count.mockResolvedValue(5);
    prisma.schoolMembership.count.mockResolvedValue(50);
    prisma.class.count.mockResolvedValue(3);
    var res = await request(app).get('/api/v1/admin/stats').set('Authorization', tok('sa1'));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
  test('MEMBER cannot access /admin/stats', async function() {
    asUser('mb1', 'MEMBER', 'ACTIVE');
    var res = await request(app).get('/api/v1/admin/stats').set('Authorization', tok('mb1'));
    expect(res.status).toBe(403);
  });
  test('SCHOOL_ADMIN cannot access /admin/stats', async function() {
    asUser('sca1', 'SCHOOL_ADMIN', 'ACTIVE', 'sch');
    var res = await request(app).get('/api/v1/admin/stats').set('Authorization', tok('sca1'));
    expect(res.status).toBe(403);
  });
  test('TEACHER cannot access /admin/stats', async function() {
    asUser('tch1', 'TEACHER', 'ACTIVE', 'sch');
    var res = await request(app).get('/api/v1/admin/stats').set('Authorization', tok('tch1'));
    expect(res.status).toBe(403);
  });
  test('STUDENT cannot access /admin/stats', async function() {
    asUser('std1', 'STUDENT', 'ACTIVE', 'sch');
    var res = await request(app).get('/api/v1/admin/stats').set('Authorization', tok('std1'));
    expect(res.status).toBe(403);
  });
  test('No auth gets 401 on /admin/stats', async function() {
    var res = await request(app).get('/api/v1/admin/stats');
    expect(res.status).toBe(401);
  });
});

describe('Report moderation authorization', function() {
  test('SUPER_ADMIN can list reports', async function() {
    asUser('sa2', 'SUPER_ADMIN', 'ACTIVE');
    prisma.userReport.findMany.mockResolvedValue([]);
    prisma.userReport.count.mockResolvedValue(0);
    var res = await request(app).get('/api/v1/social/reports').set('Authorization', tok('sa2'));
    expect(res.status).toBe(200);
  });
  test('MEMBER cannot list reports', async function() {
    asUser('mb2', 'MEMBER', 'ACTIVE');
    var res = await request(app).get('/api/v1/social/reports').set('Authorization', tok('mb2'));
    expect(res.status).toBe(403);
  });
  test('SCHOOL_ADMIN cannot list platform reports', async function() {
    asUser('sca2', 'SCHOOL_ADMIN', 'ACTIVE', 'sch');
    var res = await request(app).get('/api/v1/social/reports').set('Authorization', tok('sca2'));
    expect(res.status).toBe(403);
  });
  test('TEACHER cannot list platform reports', async function() {
    asUser('tch2', 'TEACHER', 'ACTIVE', 'sch');
    var res = await request(app).get('/api/v1/social/reports').set('Authorization', tok('tch2'));
    expect(res.status).toBe(403);
  });
  test('No auth gets 401 on reports', async function() {
    var res = await request(app).get('/api/v1/social/reports');
    expect(res.status).toBe(401);
  });
});
describe('Platform admin access control', function() {
  test('SUPER_ADMIN can reach /admin/stats', async function() {
    asUser('sa1', 'SUPER_ADMIN', 'ACTIVE');
    prisma.user.count.mockResolvedValue(10);
    prisma.school.count.mockResolvedValue(2);
    prisma.liveClass.count.mockResolvedValue(0);
    prisma.userReport.count.mockResolvedValue(1);
    prisma.auditLog.count.mockResolvedValue(5);
    prisma.schoolMembership.count.mockResolvedValue(50);
    prisma.class.count.mockResolvedValue(3);
    var res = await request(app).get('/api/v1/admin/stats').set('Authorization', tok('sa1'));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
  test('MEMBER cannot access /admin/stats', async function() {
    asUser('mb1', 'MEMBER', 'ACTIVE');
    var res = await request(app).get('/api/v1/admin/stats').set('Authorization', tok('mb1'));
    expect(res.status).toBe(403);
  });
  test('SCHOOL_ADMIN cannot access /admin/stats', async function() {
    asUser('sca1', 'SCHOOL_ADMIN', 'ACTIVE', 'sch');
    var res = await request(app).get('/api/v1/admin/stats').set('Authorization', tok('sca1'));
    expect(res.status).toBe(403);
  });
  test('TEACHER cannot access /admin/stats', async function() {
    asUser('tch1', 'TEACHER', 'ACTIVE', 'sch');
    var res = await request(app).get('/api/v1/admin/stats').set('Authorization', tok('tch1'));
    expect(res.status).toBe(403);
  });
  test('STUDENT cannot access /admin/stats', async function() {
    asUser('std1', 'STUDENT', 'ACTIVE', 'sch');
    var res = await request(app).get('/api/v1/admin/stats').set('Authorization', tok('std1'));
    expect(res.status).toBe(403);
  });
  test('GUARDIAN cannot access /admin/stats', async function() {
    asUser('grd1', 'GUARDIAN', 'ACTIVE', 'sch');
    var res = await request(app).get('/api/v1/admin/stats').set('Authorization', tok('grd1'));
    expect(res.status).toBe(403);
  });
  test('No auth gets 401 on /admin/stats', async function() {
    var res = await request(app).get('/api/v1/admin/stats');
    expect(res.status).toBe(401);
  });
});

describe('Report moderation authorization', function() {
  test('SUPER_ADMIN can list reports', async function() {
    asUser('sa2', 'SUPER_ADMIN', 'ACTIVE');
    prisma.userReport.findMany.mockResolvedValue([]);
    prisma.userReport.count.mockResolvedValue(0);
    var res = await request(app).get('/api/v1/social/reports').set('Authorization', tok('sa2'));
    expect(res.status).toBe(200);
  });
  test('MEMBER cannot list reports', async function() {
    asUser('mb2', 'MEMBER', 'ACTIVE');
    var res = await request(app).get('/api/v1/social/reports').set('Authorization', tok('mb2'));
    expect(res.status).toBe(403);
  });
  test('SCHOOL_ADMIN cannot list platform reports', async function() {
    asUser('sca2', 'SCHOOL_ADMIN', 'ACTIVE', 'sch');
    var res = await request(app).get('/api/v1/social/reports').set('Authorization', tok('sca2'));
    expect(res.status).toBe(403);
  });
  test('TEACHER cannot list platform reports', async function() {
    asUser('tch2', 'TEACHER', 'ACTIVE', 'sch');
    var res = await request(app).get('/api/v1/social/reports').set('Authorization', tok('tch2'));
    expect(res.status).toBe(403);
  });
});
describe('Admin user management security', function() {
  test('MEMBER cannot suspend another user', async function() {
    asUser('atk1', 'MEMBER', 'ACTIVE');
    var res = await request(app)
      .patch('/api/v1/admin/stats/users/vic1/status')
      .set('Authorization', tok('atk1'))
      .send({ status: 'SUSPENDED' });
    expect(res.status).toBe(403);
  });
  test('SUPER_ADMIN cannot suspend another SUPER_ADMIN', async function() {
    var aId = 'sa-a', bId = 'sa-b';
    verifyAccessToken.mockReturnValue({ userId: aId, role: 'SUPER_ADMIN', schoolId: null });
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: aId, role: 'SUPER_ADMIN', status: 'ACTIVE', schoolId: null, firstName: '', lastName: '', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce({ id: bId, role: 'SUPER_ADMIN', status: 'ACTIVE', email: 'b@x.com' });
    var res = await request(app)
      .patch('/api/v1/admin/stats/users/' + bId + '/status')
      .set('Authorization', tok(aId))
      .send({ status: 'SUSPENDED' });
    expect(res.status).toBe(403);
  });
  test('No auth cannot patch user status', async function() {
    var res = await request(app)
      .patch('/api/v1/admin/stats/users/any/status')
      .send({ status: 'SUSPENDED' });
    expect(res.status).toBe(401);
  });
});

describe('API security: spoofed role claims rejected', function() {
  test('x-user-role: SUPER_ADMIN header is ignored', async function() {
    asUser('spf1', 'MEMBER', 'ACTIVE');
    var res = await request(app)
      .get('/api/v1/admin/stats')
      .set('Authorization', tok('spf1'))
      .set('x-user-role', 'SUPER_ADMIN');
    expect(res.status).toBe(403);
  });
  test('role in request body is ignored', async function() {
    asUser('spf2', 'MEMBER', 'ACTIVE');
    var res = await request(app)
      .get('/api/v1/admin/stats')
      .set('Authorization', tok('spf2'))
      .send({ role: 'SUPER_ADMIN' });
    expect(res.status).toBe(403);
  });
});

describe('ARCH-01: SUPER_ADMIN DM bypass removed', function() {
  test('ALLOW_DM_NON_FRIENDS env is not true', function() {
    expect(process.env.ALLOW_DM_NON_FRIENDS).not.toBe('true');
  });
  test('dm.controller has no SUPER_ADMIN cold-DM bypass', function() {
    var dmPath = path.join(__dirname, '../controllers/dm.controller.js');
    var src = fs.readFileSync(dmPath, 'utf8');
    // Verify the exact bypass line is gone: uA?.role === 'SUPER_ADMIN' ... return true
    expect(src).not.toMatch(/uA\?\.role === .SUPER_ADMIN. \|\| uB\?\.role === .SUPER_ADMIN. \) return true/);
  });
});

describe('ARCH-02: SUPER_ADMIN live class gift bypass removed', function() {
  test('checkLiveClassSchool has no SUPER_ADMIN bypass', function() {
    var routePath = path.join(__dirname, '../routes/live-class.routes.js');
    var src = fs.readFileSync(routePath, 'utf8');
    var fnMatch = src.match(/async function checkLiveClassSchool\([\s\S]+?\n\}/);
    if (fnMatch) {
      expect(fnMatch[0]).not.toMatch(/SUPER_ADMIN.*return next/);
    } else {
      expect(src).toContain('checkLiveClassSchool');
    }
  });
});

describe('ARCH-05: BANNED status enforced in authenticate()', function() {
  test('auth.middleware rejects BANNED status', function() {
    var authPath = path.join(__dirname, '../middleware/auth.middleware.js');
    var src = fs.readFileSync(authPath, 'utf8');
    expect(src).toMatch(/status.*===.*'BANNED'/);
  });
});