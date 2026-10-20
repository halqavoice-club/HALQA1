'use strict';
/**
 * Jest manual mock for ../utils/prisma
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides jest.fn() stubs for every Prisma model method used across the
 * test suite. Using a manual mock instead of jest.mock('../utils/prisma')
 * auto-mock because prisma.js calls $on() and $use() at module load time,
 * which Jest's auto-mocker cannot handle (it tries to clone the real module).
 *
 * Pattern: each test file calls jest.clearAllMocks() in beforeEach, then
 * sets up specific mockResolvedValue / mockImplementation as needed.
 */

// ─── Generic model mock factory ───────────────────────────────────────────────
// Returns an object with jest.fn() for every common Prisma operation.
function modelMock() {
  return {
    findUnique:  jest.fn(),
    findFirst:   jest.fn(),
    findMany:    jest.fn(),
    create:      jest.fn(),
    update:      jest.fn(),
    updateMany:  jest.fn(),
    upsert:      jest.fn(),
    delete:      jest.fn(),
    deleteMany:  jest.fn(),
    count:       jest.fn(),
    aggregate:   jest.fn(),
    groupBy:     jest.fn(),
  };
}

// ─── Prisma client mock ───────────────────────────────────────────────────────
const prismaMock = {
  // Lifecycle — no-ops
  $connect:    jest.fn().mockResolvedValue(undefined),
  $disconnect: jest.fn().mockResolvedValue(undefined),
  $on:         jest.fn(),   // event emitter (query, error, warn)
  $use:        jest.fn(),   // middleware (N+1 detector in dev)
  $queryRaw:        jest.fn().mockResolvedValue([{ 1: 1 }]),
  $executeRaw:      jest.fn().mockResolvedValue(1),
  $queryRawUnsafe:  jest.fn().mockResolvedValue([]),
  $executeRawUnsafe: jest.fn().mockResolvedValue(1),

  // $transaction — default delegates to the callback; tests override as needed
  $transaction: jest.fn().mockImplementation(async (opsOrFn) => {
    if (typeof opsOrFn === 'function') {
      // Interactive transaction: call fn with a proxy that delegates to the same mocks
      return opsOrFn(prismaMock);
    }
    // Array of promises: resolve all
    return Promise.all(opsOrFn);
  }),

  // ── Models ────────────────────────────────────────────────────────────────
  user:                  modelMock(),
  school:                modelMock(),
  student:               modelMock(),
  teacher:               modelMock(),
  guardian:              modelMock(),
  refreshToken:          modelMock(),
  otpCode:               modelMock(),
  class:                 modelMock(),
  enrollment:            modelMock(),
  attendance:            modelMock(),
  grade:                 modelMock(),
  notification:          modelMock(),
  auditLog:              modelMock(),
  wallet:                modelMock(),
  walletTransaction:     modelMock(),
  coinPackage:           modelMock(),
  gift:                  modelMock(),
  giftTransaction:       modelMock(),
  roomGiftLeaderboard:   modelMock(),
  voiceRoom:             modelMock(),
  voiceParticipant:      modelMock(),
  voiceRoomMember:       modelMock(),
  voiceMessage:          modelMock(),
  voiceHostStats:        modelMock(),
  follow:                modelMock(),
  post:                  modelMock(),
  postReaction:          modelMock(),
  postComment:           modelMock(),
  story:                 modelMock(),
  community:             modelMock(),
  communityMember:       modelMock(),
  communityJoinRequest:  modelMock(),
  communityBan:          modelMock(),
  communityInvite:       modelMock(),
  directMessage:         modelMock(),
  dmConversation:        modelMock(),
  liveClass:             modelMock(),
  liveClassParticipant:  modelMock(),
  liveClassMessage:      modelMock(),
  liveClassAttendance:   modelMock(),
  liveClassHandQueue:    modelMock(),
  groupConversation:     modelMock(),
  groupMember:           modelMock(),
  groupMessage:          modelMock(),
  groupMessageReaction:  modelMock(),
  groupMessageRead:      modelMock(),
  feeRecord:             modelMock(),
  product:               modelMock(),
  order:                 modelMock(),
  review:                modelMock(),
  session:               modelMock(),
  fileUpload:            modelMock(),
  message:               modelMock(),
  messageRecipient:      modelMock(),
  behaviorLog:           modelMock(),
  userBlock:             modelMock(),
  hashtag:               modelMock(),
  postHashtag:           modelMock(),
  postView:              modelMock(),
  storyView:             modelMock(),
  schoolMembership:      modelMock(),
  userReport:            modelMock(),
  postReport:            modelMock(),
  friendship:            modelMock(),
  creatorProfile:        modelMock(),
  creatorSubscription:   modelMock(),
  creatorTier:           modelMock(),
  creatorTip:            modelMock(),
  payoutRequest:         modelMock(),
  platformRevenueEntry:  modelMock(),
  assignmentSubmission:  modelMock(),
  examSubmission:        modelMock(),
};

module.exports = prismaMock;
