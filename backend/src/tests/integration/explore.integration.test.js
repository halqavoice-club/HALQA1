'use strict';
/**
 * Explore Integration Tests — real MySQL DB
 *
 * Tests every Explore endpoint against the live test database.
 * Covers all role types, security, blocked/suspended/deleted content,
 * private content isolation, and Redis fallback.
 *
 * Run via: npm run test:integration (or npx jest --testPathPattern="explore.integration" with ignore override)
 */

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const prisma   = require('../../utils/prisma');
const { generateAccessToken } = require('../../utils/jwt');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const testEmail = () => `explore-integ-${uid()}@integration-test.halqa`;

async function createUser(extra) {
  return prisma.user.create({
    data: Object.assign({
      email:         testEmail(),
      passwordHash:  await bcrypt.hash('Test1234!', 10),
      firstName:     'Explore',
      lastName:      'Test',
      role:          'MEMBER',
      status:        'ACTIVE',
      emailVerified: true,
    }, extra || {}),
  });
}

function tok(user) {
  return 'Bearer ' + generateAccessToken({
    userId: user.id, role: user.role, schoolId: user.schoolId || null
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

var app;
var userMember, userStudent, userTeacher, userGuardian,
    userSchoolAdmin, userSuperAdmin, userSuspended, userBanned;
var hashtag, publicPost, privatePost;
var testSchool;

beforeAll(async function() {
  app = require('../../app');

  // Create test school
  testSchool = await prisma.school.create({
    data: { name: 'Explore Test School ' + uid(), slug: 'explore-school-' + uid(), country: 'MY' }
  }).catch(function() { return null; });

  var schoolId = testSchool ? testSchool.id : null;

  var users = await Promise.all([
    createUser({ role: 'MEMBER',       schoolId: null }),
    createUser({ role: 'STUDENT',      schoolId: schoolId }),
    createUser({ role: 'TEACHER',      schoolId: schoolId }),
    createUser({ role: 'GUARDIAN',     schoolId: schoolId }),
    createUser({ role: 'SCHOOL_ADMIN', schoolId: schoolId }),
    createUser({ role: 'SUPER_ADMIN',  schoolId: null }),
    createUser({ role: 'MEMBER',       status: 'SUSPENDED' }),
    createUser({ role: 'MEMBER',       status: 'BANNED' }),
  ]);

  userMember      = users[0];
  userStudent     = users[1];
  userTeacher     = users[2];
  userGuardian    = users[3];
  userSchoolAdmin = users[4];
  userSuperAdmin  = users[5];
  userSuspended   = users[6];
  userBanned      = users[7];

  // Create a hashtag and public/private posts
  hashtag = await prisma.hashtag.upsert({
    where:  { name: 'exploreintegtest' },
    create: { name: 'exploreintegtest', postCount: 1 },
    update: { postCount: { increment: 1 } },
  });

  publicPost = await prisma.post.create({
    data: {
      authorId:   userMember.id,
      body:       'Public explore integration test post #exploreintegtest',
      type:       'TEXT',
      visibility: 'PUBLIC',
      isDraft:    false,
    }
  });

  await prisma.postHashtag.upsert({
    where:  { postId_hashtagId: { postId: publicPost.id, hashtagId: hashtag.id } },
    create: { postId: publicPost.id, hashtagId: hashtag.id },
    update: {},
  });

  privatePost = await prisma.post.create({
    data: {
      authorId:   userMember.id,
      body:       'PRIVATE explore integration test post must not appear in search',
      type:       'TEXT',
      visibility: 'PRIVATE',
      isDraft:    false,
    }
  });
}, 30000);

afterAll(async function() {
  var emails = [userMember, userStudent, userTeacher, userGuardian,
                userSchoolAdmin, userSuperAdmin, userSuspended, userBanned]
    .filter(Boolean).map(function(u) { return u.email; });

  try {
    if (publicPost)  await prisma.postHashtag.deleteMany({ where: { postId: publicPost.id } });
    if (publicPost)  await prisma.post.delete({ where: { id: publicPost.id } }).catch(function() {});
    if (privatePost) await prisma.post.delete({ where: { id: privatePost.id } }).catch(function() {});
    if (hashtag)     await prisma.hashtag.update({ where: { id: hashtag.id }, data: { postCount: { decrement: 1 } } }).catch(function() {});
    await prisma.follow.deleteMany({ where: { follower: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    if (testSchool) await prisma.school.delete({ where: { id: testSchool.id } }).catch(function() {});
  } catch (e) { /* ignore */ }

  await prisma.$disconnect();
}, 20000);

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET /explore — aggregated feed
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /explore', function() {

  test('no auth → 401', async function() {
    var res = await request(app).get('/api/v1/explore');
    expect(res.status).toBe(401);
  });

  test('MEMBER (schoolId=null) can access explore feed', async function() {
    var res = await request(app)
      .get('/api/v1/explore')
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('trendingHashtags');
    expect(res.body.data).toHaveProperty('suggestedPeople');
    expect(res.body.data).toHaveProperty('trendingPosts');
    expect(res.body.data).toHaveProperty('liveVoiceRooms');
    expect(Array.isArray(res.body.data.trendingHashtags)).toBe(true);
    expect(Array.isArray(res.body.data.suggestedPeople)).toBe(true);
  });

  test('STUDENT can access explore feed', async function() {
    var res = await request(app)
      .get('/api/v1/explore')
      .set('Authorization', tok(userStudent));
    expect(res.status).toBe(200);
  });

  test('TEACHER can access explore feed', async function() {
    var res = await request(app)
      .get('/api/v1/explore')
      .set('Authorization', tok(userTeacher));
    expect(res.status).toBe(200);
  });

  test('GUARDIAN can access explore feed', async function() {
    var res = await request(app)
      .get('/api/v1/explore')
      .set('Authorization', tok(userGuardian));
    expect(res.status).toBe(200);
  });

  test('SCHOOL_ADMIN can access explore feed', async function() {
    var res = await request(app)
      .get('/api/v1/explore')
      .set('Authorization', tok(userSchoolAdmin));
    expect(res.status).toBe(200);
  });

  test('SUPER_ADMIN can access explore feed', async function() {
    var res = await request(app)
      .get('/api/v1/explore')
      .set('Authorization', tok(userSuperAdmin));
    expect(res.status).toBe(200);
  });

  test('SUSPENDED user → 403', async function() {
    var res = await request(app)
      .get('/api/v1/explore')
      .set('Authorization', tok(userSuspended));
    expect(res.status).toBe(403);
  });

  test('BANNED user → 403', async function() {
    var res = await request(app)
      .get('/api/v1/explore')
      .set('Authorization', tok(userBanned));
    expect(res.status).toBe(403);
  });

  test('suggested people does not include the viewer', async function() {
    var res = await request(app)
      .get('/api/v1/explore')
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    var people = res.body.data.suggestedPeople || [];
    var selfInList = people.some(function(p) { return p.id === userMember.id; });
    expect(selfInList).toBe(false);
  });

  test('suggested people does not include already-followed users', async function() {
    await prisma.follow.upsert({
      where:  { followerId_followingId: { followerId: userMember.id, followingId: userTeacher.id } },
      create: { followerId: userMember.id, followingId: userTeacher.id },
      update: {},
    });

    var res = await request(app)
      .get('/api/v1/explore')
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    var people = res.body.data.suggestedPeople || [];
    var teacherInList = people.some(function(p) { return p.id === userTeacher.id; });
    expect(teacherInList).toBe(false);

    await prisma.follow.deleteMany({
      where: { followerId: userMember.id, followingId: userTeacher.id }
    });
  });

  test('private posts do not appear in trendingPosts', async function() {
    var res = await request(app)
      .get('/api/v1/explore')
      .set('Authorization', tok(userStudent));
    expect(res.status).toBe(200);
    var posts = res.body.data.trendingPosts || [];
    var privateFound = posts.some(function(p) { return p.visibility === 'PRIVATE'; });
    expect(privateFound).toBe(false);
  });

  test('deleted posts do not appear in trendingPosts', async function() {
    await prisma.post.update({ where: { id: publicPost.id }, data: { deletedAt: new Date() } });

    var res = await request(app)
      .get('/api/v1/explore')
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    var posts = res.body.data.trendingPosts || [];
    var deleted = posts.some(function(p) { return p.id === publicPost.id; });
    expect(deleted).toBe(false);

    await prisma.post.update({ where: { id: publicPost.id }, data: { deletedAt: null } });
  });

  test('suggested people fields do not expose PII', async function() {
    var res = await request(app)
      .get('/api/v1/explore')
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    var people = res.body.data.suggestedPeople || [];
    people.forEach(function(p) {
      expect(p.email).toBeUndefined();
      expect(p.phone).toBeUndefined();
      expect(p.passwordHash).toBeUndefined();
      expect(p.dateOfBirth).toBeUndefined();
    });
  });

  test('private communities do not appear in suggestedCommunities', async function() {
    var res = await request(app)
      .get('/api/v1/explore')
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    var communities = res.body.data.suggestedCommunities || [];
    var privateFound = communities.some(function(c) { return c.privacy === 'PRIVATE'; });
    expect(privateFound).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET /explore/search
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /explore/search', function() {

  test('no auth → 401', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'test' });
    expect(res.status).toBe(401);
  });

  test('empty query returns empty results', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: '' })
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    expect(res.body.data.posts).toHaveLength(0);
    expect(res.body.data.people).toHaveLength(0);
  });

  test('1-char query returns empty (minimum 2 chars required)', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'a' })
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    expect(res.body.data.posts).toHaveLength(0);
  });

  test('MEMBER (schoolId=null) can search', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'Explore', type: 'people', limit: 10 })
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('people');
    expect(res.body.data).toHaveProperty('posts');
    expect(res.body.data).toHaveProperty('hashtags');
    expect(res.body.data).toHaveProperty('communities');
  });

  test('STUDENT can search', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'Explore', limit: 5 })
      .set('Authorization', tok(userStudent));
    expect(res.status).toBe(200);
  });

  test('TEACHER can search', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'Explore', limit: 5 })
      .set('Authorization', tok(userTeacher));
    expect(res.status).toBe(200);
  });

  test('GUARDIAN can search', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'Explore', limit: 5 })
      .set('Authorization', tok(userGuardian));
    expect(res.status).toBe(200);
  });

  test('SCHOOL_ADMIN can search', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'Explore', limit: 5 })
      .set('Authorization', tok(userSchoolAdmin));
    expect(res.status).toBe(200);
  });

  test('SUPER_ADMIN can search', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'Explore', limit: 5 })
      .set('Authorization', tok(userSuperAdmin));
    expect(res.status).toBe(200);
  });

  test('SUSPENDED user → 403', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'test' })
      .set('Authorization', tok(userSuspended));
    expect(res.status).toBe(403);
  });

  test('BANNED user → 403', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'test' })
      .set('Authorization', tok(userBanned));
    expect(res.status).toBe(403);
  });

  test('search does not return PRIVATE posts', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'PRIVATE explore integration', type: 'posts', limit: 20 })
      .set('Authorization', tok(userStudent));
    expect(res.status).toBe(200);
    var privateFound = res.body.data.posts.some(function(p) {
      return p.visibility === 'PRIVATE';
    });
    expect(privateFound).toBe(false);
  });

  test('search does not return deleted posts', async function() {
    await prisma.post.update({ where: { id: publicPost.id }, data: { deletedAt: new Date() } });

    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'explore integration test', type: 'posts', limit: 20 })
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    var deletedFound = res.body.data.posts.some(function(p) { return p.id === publicPost.id; });
    expect(deletedFound).toBe(false);

    await prisma.post.update({ where: { id: publicPost.id }, data: { deletedAt: null } });
  });

  test('people search does not expose PII', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'Explore', type: 'people', limit: 20 })
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    res.body.data.people.forEach(function(p) {
      expect(p.email).toBeUndefined();
      expect(p.passwordHash).toBeUndefined();
      expect(p.phone).toBeUndefined();
    });
  });

  test('type=posts: communities and hashtags are empty', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'exploreintegtest', type: 'posts', limit: 10 })
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    expect(res.body.data.communities).toHaveLength(0);
    expect(res.body.data.hashtags).toHaveLength(0);
  });

  test('type=hashtags: our test hashtag is found', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'exploreintegtest', type: 'hashtags', limit: 10 })
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    expect(res.body.data.posts).toHaveLength(0);
    expect(res.body.data.people).toHaveLength(0);
    var found = res.body.data.hashtags.some(function(h) {
      return h.name === 'exploreintegtest';
    });
    expect(found).toBe(true);
  });

  test('people results include isFollowing boolean', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'Explore', type: 'people', limit: 20 })
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    res.body.data.people.forEach(function(p) {
      expect(typeof p.isFollowing).toBe('boolean');
    });
  });

  test('limit is capped server-side at 30', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'Explore', limit: 9999 })
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    expect(res.body.data.posts.length).toBeLessThanOrEqual(30);
  });

  test('IDOR: userId query param cannot expose private posts', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'PRIVATE explore', userId: userMember.id, type: 'posts' })
      .set('Authorization', tok(userStudent));
    expect(res.status).toBe(200);
    var privateFound = res.body.data.posts.some(function(p) {
      return p.visibility === 'PRIVATE';
    });
    expect(privateFound).toBe(false);
  });

  test('SQL injection in query is safely handled', async function() {
    var malicious = "'; DROP TABLE posts; --";
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: malicious })
      .set('Authorization', tok(userMember));
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.data.posts).toHaveLength(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GET /explore/hashtag/:tag
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /explore/hashtag/:tag', function() {

  test('no auth → 401', async function() {
    var res = await request(app).get('/api/v1/explore/hashtag/exploreintegtest');
    expect(res.status).toBe(401);
  });

  test('MEMBER (schoolId=null) can access hashtag feed', async function() {
    var res = await request(app)
      .get('/api/v1/explore/hashtag/exploreintegtest')
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('hashtag');
    expect(res.body.data).toHaveProperty('items');
    expect(res.body.data).toHaveProperty('nextCursor');
    expect(res.body.data).toHaveProperty('hasMore');
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  test('STUDENT can access hashtag feed', async function() {
    var res = await request(app)
      .get('/api/v1/explore/hashtag/exploreintegtest')
      .set('Authorization', tok(userStudent));
    expect(res.status).toBe(200);
  });

  test('TEACHER can access hashtag feed', async function() {
    var res = await request(app)
      .get('/api/v1/explore/hashtag/exploreintegtest')
      .set('Authorization', tok(userTeacher));
    expect(res.status).toBe(200);
  });

  test('GUARDIAN can access hashtag feed', async function() {
    var res = await request(app)
      .get('/api/v1/explore/hashtag/exploreintegtest')
      .set('Authorization', tok(userGuardian));
    expect(res.status).toBe(200);
  });

  test('SCHOOL_ADMIN can access hashtag feed', async function() {
    var res = await request(app)
      .get('/api/v1/explore/hashtag/exploreintegtest')
      .set('Authorization', tok(userSchoolAdmin));
    expect(res.status).toBe(200);
  });

  test('SUPER_ADMIN can access hashtag feed', async function() {
    var res = await request(app)
      .get('/api/v1/explore/hashtag/exploreintegtest')
      .set('Authorization', tok(userSuperAdmin));
    expect(res.status).toBe(200);
  });

  test('SUSPENDED user → 403', async function() {
    var res = await request(app)
      .get('/api/v1/explore/hashtag/exploreintegtest')
      .set('Authorization', tok(userSuspended));
    expect(res.status).toBe(403);
  });

  test('BANNED user → 403', async function() {
    var res = await request(app)
      .get('/api/v1/explore/hashtag/exploreintegtest')
      .set('Authorization', tok(userBanned));
    expect(res.status).toBe(403);
  });

  test('nonexistent hashtag → 200 with null hashtag and empty items', async function() {
    var res = await request(app)
      .get('/api/v1/explore/hashtag/doesnotexistatall999xyz')
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    expect(res.body.data.hashtag).toBeNull();
    expect(res.body.data.items).toHaveLength(0);
  });

  test('public post with hashtag appears in hashtag feed', async function() {
    var res = await request(app)
      .get('/api/v1/explore/hashtag/exploreintegtest')
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    var found = res.body.data.items.some(function(p) { return p.id === publicPost.id; });
    expect(found).toBe(true);
  });

  test('private posts never appear in hashtag feed', async function() {
    var res = await request(app)
      .get('/api/v1/explore/hashtag/exploreintegtest')
      .set('Authorization', tok(userStudent));
    expect(res.status).toBe(200);
    var privateFound = res.body.data.items.some(function(p) {
      return p.visibility === 'PRIVATE';
    });
    expect(privateFound).toBe(false);
  });

  test('deleted posts do not appear in hashtag feed', async function() {
    await prisma.post.update({ where: { id: publicPost.id }, data: { deletedAt: new Date() } });

    var res = await request(app)
      .get('/api/v1/explore/hashtag/exploreintegtest')
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    var deletedFound = res.body.data.items.some(function(p) { return p.id === publicPost.id; });
    expect(deletedFound).toBe(false);

    await prisma.post.update({ where: { id: publicPost.id }, data: { deletedAt: null } });
  });

  test('cursor pagination — valid hasMore boolean', async function() {
    var res = await request(app)
      .get('/api/v1/explore/hashtag/exploreintegtest')
      .query({ limit: 1 })
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    expect(typeof res.body.data.hasMore).toBe('boolean');
  });

  test('hashtag feed items do not expose author PII', async function() {
    var res = await request(app)
      .get('/api/v1/explore/hashtag/exploreintegtest')
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    res.body.data.items.forEach(function(post) {
      expect(post.author.email).toBeUndefined();
      expect(post.author.passwordHash).toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Redis fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('Redis fallback', function() {

  test('GET /explore succeeds even when Redis cache is empty (fresh user)', async function() {
    var freshUser = await createUser({ role: 'MEMBER', schoolId: null });

    var res = await request(app)
      .get('/api/v1/explore')
      .set('Authorization', tok(freshUser));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('trendingHashtags');

    await prisma.user.delete({ where: { id: freshUser.id } }).catch(function() {});
  });

  test('explore.controller.js wraps Redis calls in try/catch', function() {
    var fs   = require('fs');
    var path = require('path');
    var src  = fs.readFileSync(
      path.join(__dirname, '../../controllers/explore.controller.js'), 'utf8'
    );
    // Both cache read and write must be inside try/catch blocks
    expect(src).toMatch(/try[\s\S]*?getCache[\s\S]*?catch/);
    expect(src).toMatch(/try[\s\S]*?setCache[\s\S]*?catch/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Feed regression — Feed still works after Explore changes
// ─────────────────────────────────────────────────────────────────────────────

describe('Feed regression', function() {

  test('GET /posts/feed still works for MEMBER', async function() {
    var res = await request(app)
      .get('/api/v1/posts/feed')
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('items');
    expect(res.body.data).toHaveProperty('nextCursor');
    expect(res.body.data).toHaveProperty('hasMore');
  });

  test('GET /posts/trending still works', async function() {
    var res = await request(app)
      .get('/api/v1/posts/trending')
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('POST /posts can still create a post', async function() {
    var res = await request(app)
      .post('/api/v1/posts')
      .set('Authorization', tok(userMember))
      .send({ body: 'Feed regression test post via explore tests', visibility: 'PUBLIC', type: 'TEXT' });
    expect(res.status).toBe(201);
    var postId = res.body.data && res.body.data.id;
    if (postId) await prisma.post.delete({ where: { id: postId } }).catch(function() {});
  });

  test('GET /posts/:id returns 404 for nonexistent post', async function() {
    var res = await request(app)
      .get('/api/v1/posts/nonexistent-post-id-xyz-12345')
      .set('Authorization', tok(userMember));
    expect(res.status).toBe(404);
  });

  test('Explore does not expose PRIVATE posts via Feed privacy', async function() {
    var res = await request(app)
      .get('/api/v1/explore/search')
      .query({ q: 'PRIVATE explore integration', type: 'posts' })
      .set('Authorization', tok(userTeacher));
    expect(res.status).toBe(200);
    var found = res.body.data.posts.some(function(p) { return p.id === privatePost.id; });
    expect(found).toBe(false);
  });
});
