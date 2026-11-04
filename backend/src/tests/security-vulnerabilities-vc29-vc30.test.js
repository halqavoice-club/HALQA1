"use strict";
/**
 * Security Regression Tests — VC-29 and VC-30
 *
 * VC-29: 2FA Challenge Token Authentication Bypass
 *   - 2FA challenge tokens must NOT authenticate regular endpoints
 *   - Only /auth/2fa/authenticate should accept them
 *
 * VC-30: Cross-Room Message Deletion IDOR
 *   - Users must not be able to delete messages from rooms they don't own
 *   - Message deletion must validate msg.roomId === roomId from URL
 */

const express = require("express");
const request = require("supertest");
const { v4: uuidv4 } = require("uuid");

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock("../utils/prisma", () => ({
  user: { findUnique: jest.fn() },
  voiceRoom: { findUnique: jest.fn() },
  voiceMessage: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  voiceParticipant: { findUnique: jest.fn(), findMany: jest.fn() },
  $transaction: jest.fn((ops) =>
    Array.isArray(ops) ? Promise.all(ops) : ops(require("../utils/prisma")),
  ),
}));

jest.mock("../utils/redis", () => ({
  isRedisReady: jest.fn(() => false),
  getCache: jest.fn(() => null),
  setCache: jest.fn(),
  deleteCache: jest.fn(),
}));

jest.mock("../sockets", () => ({ getIo: jest.fn(() => null) }));
jest.mock("../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  generateAccessToken,
  generate2FAChallengeToken,
} = require("../utils/jwt");
const prisma = require("../utils/prisma");

// ─── Helpers ──────────────────────────────────────────────────────────────────
const USERS = {
  userA: {
    id: "user-a",
    role: "STUDENT",
    status: "ACTIVE",
    schoolId: null,
    deletedAt: null,
    email: "usera@test.com",
    firstName: "User",
    lastName: "A",
  },
  userB: {
    id: "user-b",
    role: "STUDENT",
    status: "ACTIVE",
    schoolId: null,
    deletedAt: null,
    email: "userb@test.com",
    firstName: "User",
    lastName: "B",
  },
  mod: {
    id: "user-mod",
    role: "STUDENT",
    status: "ACTIVE",
    schoolId: null,
    deletedAt: null,
    email: "mod@test.com",
    firstName: "Mod",
    lastName: "User",
  },
};

function makeToken(user) {
  return generateAccessToken({
    userId: user.id,
    role: user.role,
    schoolId: user.schoolId,
  });
}

function auth(user) {
  return { Authorization: `Bearer ${makeToken(user)}` };
}

function authWithToken(token) {
  return { Authorization: `Bearer ${token}` };
}

// ─── App builder ──────────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());

  const { authenticate } = require("../middleware/auth.middleware");
  const authCtrl = require("../controllers/auth.controller");
  const voiceCtrl = require("../controllers/voice.controller");

  // Auth routes
  app.get("/api/v1/auth/me", authenticate, authCtrl.getMe);

  // Voice routes
  app.delete(
    "/api/v1/voice/:id/messages/:msgId",
    authenticate,
    voiceCtrl.deleteMessage,
  );

  return app;
}

// ─── VC-29: 2FA Challenge Token Authentication Bypass ────────────────────────

describe("VC-29: 2FA Challenge Token Authentication Bypass", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  test("should reject 2FA challenge token on regular authenticated endpoint", async () => {
    const user = USERS.userA;
    const challengeToken = generate2FAChallengeToken(user.id);

    // Mock is not needed because the token type check happens before DB access

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set(authWithToken(challengeToken));

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/invalid token type/i);
  });

  test("should accept valid access token on regular authenticated endpoint", async () => {
    const user = USERS.userA;
    const accessToken = makeToken(user);

    // First call: authenticate middleware
    prisma.user.findUnique.mockResolvedValueOnce(user);

    // Second call: getMe controller
    prisma.user.findUnique.mockResolvedValueOnce({
      ...user,
      passwordHash: "hashed",
      school: null,
      student: null,
      teacher: null,
      guardian: null,
      schoolMemberships: [],
    });

    const res = await request(app).get("/api/v1/auth/me").set(auth(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(user.id);
  });
});

// ─── VC-30: Cross-Room Message Deletion IDOR ──────────────────────────────────

describe("VC-30: Cross-Room Message Deletion IDOR", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  test("should prevent deleting message from different room (IDOR)", async () => {
    // User A creates Room 1 and sends a message
    const userA = USERS.userA;
    const room1Id = "room-1";
    const messageInRoom1 = {
      id: "msg-1",
      roomId: room1Id,
      userId: userA.id,
      body: "Message in Room 1",
      deletedAt: null,
      createdAt: new Date(),
    };

    // User B is trying to delete from Room 2
    const userB = USERS.userB;
    const room2Id = "room-2";

    prisma.user.findUnique.mockResolvedValueOnce(userB);
    prisma.voiceMessage.findUnique.mockResolvedValueOnce(messageInRoom1);
    // Note: The fix should reject BEFORE checking participant status

    // User B tries to delete User A's message from Room 1 using Room 2's URL
    const res = await request(app)
      .delete(`/api/v1/voice/${room2Id}/messages/${messageInRoom1.id}`)
      .set(auth(userB));

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/not authorized/i);

    // Verify update was NOT called (message was not deleted)
    expect(prisma.voiceMessage.update).not.toHaveBeenCalled();
  });

  test("should allow deleting own message from correct room", async () => {
    const user = USERS.userA;
    const roomId = "room-1";
    const message = {
      id: "msg-1",
      roomId: roomId,
      userId: user.id,
      body: "My message",
      deletedAt: null,
      createdAt: new Date(),
    };

    prisma.user.findUnique.mockResolvedValueOnce(user);
    prisma.voiceMessage.findUnique.mockResolvedValueOnce(message);
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      roomId,
      userId: user.id,
      role: "HOST",
      isActive: true,
    });
    prisma.voiceMessage.update.mockResolvedValueOnce({
      ...message,
      deletedAt: new Date(),
    });

    const res = await request(app)
      .delete(`/api/v1/voice/${roomId}/messages/${message.id}`)
      .set(auth(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify message was soft-deleted
    expect(prisma.voiceMessage.update).toHaveBeenCalledWith({
      where: { id: message.id },
      data: { deletedAt: expect.any(Date) },
    });
  });

  test("should allow moderator deleting any message in their room", async () => {
    const host = USERS.userA;
    const mod = USERS.mod;
    const roomId = "room-1";

    // Host sends a message
    const message = {
      id: "msg-1",
      roomId: roomId,
      userId: host.id,
      body: "Host message",
      deletedAt: null,
      createdAt: new Date(),
    };

    prisma.user.findUnique.mockResolvedValueOnce(mod);
    prisma.voiceMessage.findUnique.mockResolvedValueOnce(message);
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      roomId,
      userId: mod.id,
      role: "MODERATOR",
      isActive: true,
    });
    prisma.voiceMessage.update.mockResolvedValueOnce({
      ...message,
      deletedAt: new Date(),
    });

    // Moderator deletes it
    const res = await request(app)
      .delete(`/api/v1/voice/${roomId}/messages/${message.id}`)
      .set(auth(mod));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify message was deleted
    expect(prisma.voiceMessage.update).toHaveBeenCalledWith({
      where: { id: message.id },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
