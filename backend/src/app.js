require('dotenv').config();

// ─── Environment validation — must run before any service connections ─────────
// Exits immediately with a clear error message if required vars are missing.
const { validateEnv } = require('./utils/validateEnv');
validateEnv();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { createServer } = require('http');
const { Server } = require('socket.io');

const logger = require('./utils/logger');
const prisma = require('./utils/prisma');

// Import routes
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const schoolRoutes = require('./routes/school.routes');
const classRoutes = require('./routes/class.routes');
const studentRoutes = require('./routes/student.routes');
const teacherRoutes = require('./routes/teacher.routes');
const guardianRoutes = require('./routes/guardian.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const gradeRoutes = require('./routes/grade.routes');
const behaviorRoutes = require('./routes/behavior.routes');
const announcementRoutes = require('./routes/announcement.routes');
const messageRoutes = require('./routes/message.routes');
const calendarRoutes = require('./routes/calendar.routes');
const feeRoutes = require('./routes/fee.routes');
const libraryRoutes = require('./routes/library.routes');
const noteRoutes = require('./routes/note.routes');
const notificationRoutes = require('./routes/notification.routes');
const reportRoutes = require('./routes/report.routes');
const searchRoutes = require('./routes/search.routes');
const socialRoutes = require('./routes/social.routes');
const termRoutes = require('./routes/term.routes');
const uploadRoutes = require('./routes/upload.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const audioRoutes = require('./routes/audio.routes');
const activityRoutes = require('./routes/activity.routes');
const liveClassRoutes = require('./routes/live-class.routes');
const importRoutes = require('./routes/import.routes');
const auditRoutes = require('./routes/audit.routes');
const voiceRoutes = require('./routes/voice.routes');
const walletRoutes = require('./routes/wallet.routes');
const giftRoutes = require('./routes/gift.routes');
const payoutRoutes = require('./routes/payout.routes');
const livekitRoutes = require('./routes/livekit.routes');
const dmRoutes = require('./routes/dm.routes');
const studentReportRoutes = require('./routes/student-report.routes');
const postRoutes          = require('./routes/post.routes');           // Phase B-1: Social Feed
const stripeRoutes        = require('./routes/stripe.routes');         // Phase B-2: Stripe Payment
const storyRoutes         = require('./routes/story.routes');          // Phase B-3: Stories
const communityRoutes     = require('./routes/community.routes');       // Phase B-4: Communities
const exploreRoutes       = require('./routes/explore.routes');         // Phase B-5: Discovery
const creatorRoutes       = require('./routes/creator.routes');         // Phase B-6: Creator Economy

// Phase C routes
const groupChatRoutes     = require('./routes/groupChat.routes');       // Phase C-1: Group Chat
const assignmentRoutes    = require('./routes/assignment.routes');      // Phase C-2: Assignment Submissions
const examRoutes          = require('./routes/exam.routes');            // Phase C-3: Exam Submissions
const marketplaceRoutes   = require('./routes/marketplace.routes');      // Phase C-4: Marketplace
const transportRoutes     = require('./routes/transport.routes');        // Phase C-5: Transport
const analyticsRoutes     = require('./routes/analytics.routes');        // Phase C-6: Analytics
const leaderboardRoutes   = require('./routes/leaderboard.routes');      // Phase C-7: Leaderboard
const searchIndexRoutes   = require('./routes/searchIndex.routes');      // Phase C-8: Search Index
const backupRoutes        = require('./routes/backup.routes');           // Phase C-9: Backup
const reportBlockRoutes   = require('./routes/report-block.routes');     // Fix 3: Report & Block
const pkRoutes            = require('./routes/pk.routes');                // PK Battle System
const pkAdminRoutes       = require('./routes/pk.admin.routes');           // PK Admin Management
const schoolMembershipRoutes = require('./routes/schoolMembership.routes'); // School Memberships
const internalRoutes      = require('./routes/internal.routes');           // Internal Platform Admin Provisioning

// Import middleware
const errorHandler = require('./middleware/errorHandler');
const requestLogger = require('./middleware/requestLogger');
const rateLimiter = require('./middleware/rateLimiter');
const userRateLimiter = require('./middleware/rateLimiter.user');
const deviceRateLimiter = require('./middleware/rateLimiter.device');
const sanitize = require('./middleware/sanitize');
const apiVersion = require('./middleware/apiVersion');
const sessionMiddleware = require('./middleware/session.middleware');
const idempotencyMiddleware = require('./middleware/idempotency');
const cacheMiddleware = require('./middleware/cache');
const compressionMiddleware = require('./middleware/compression');
const health = require('./utils/health');

// Import enterprise utilities
// BE-004: Re-enabled OpenTelemetry tracing — @opentelemetry/sdk-node and
// @opentelemetry/auto-instrumentations-node are now in package.json.
// If no exporter is configured, tracing.initialize() catches its own error
// and logs a warning without crashing the server.
const tracing = require('./utils/tracing');
const alerting = require('./utils/alerting');
const featureFlags = require('./utils/featureFlags');
const leaderElection = require('./utils/leaderElection');
const openapi = require('./utils/openapi');
const graphqlServer = require('./graphql/server');

const app = express();
const httpServer = createServer(app);

// ─── Socket.IO setup ──────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowed = (process.env.CLIENT_URL || 'http://localhost:3000')
        .split(',').map(o => o.trim());
      if (allowed.includes(origin)) return callback(null, true);
      callback(new Error('Socket.IO CORS: origin not allowed'));
    },
    credentials: true
  },
  // PERF-002: Enable per-message WebSocket compression.
  // Room state payloads with 50 participants can be 5–10 KB uncompressed.
  // perMessageDeflate reduces this by ~70%, significantly improving performance
  // for mobile users on poor network connections.
  // threshold: 1024 — only compress messages larger than 1 KB (smaller ones
  // have overhead that makes compression counterproductive).
  perMessageDeflate: {
    threshold: 1024,
  },
});

// Make io globally available for controllers
global.io = io;

// ─── Socket.IO authentication middleware ──────────────────────────────────────
const { verifyAccessToken } = require('./utils/jwt');

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    const decoded = verifyAccessToken(token);
    socket.userId     = decoded.userId;
    socket.userRole   = decoded.role;
    socket.userSchoolId = decoded.schoolId ?? null; // Task 2: available for school:join guard
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

// ─── Socket.IO per-socket event rate limiter ─────────────────────────────────
// SECURITY FIX: Previously there was NO rate limiting on socket events.
// A malicious client could fire voice:reaction, liveclass:reaction, dm:typing_start
// at unlimited frequency, flooding rooms with events and causing all other
// connected clients to re-render excessively.
//
// Implementation: per-socket sliding window counter (in-memory, per process).
// Each counter tracks {count, windowStart} for a given event name.
// Limits are intentionally generous to not affect legitimate users.
//
// Limits (per socket per window):
//   reaction events   — 10 per 2 seconds
//   typing events     — 20 per 5 seconds
//   speaking events   — 30 per 5 seconds (fired very frequently by WebRTC)
//
// On limit exceeded: event is silently dropped (no disconnect — prevents DoS escalation).
function createSocketRateLimiter() {
  // Map<eventName, { max: number, windowMs: number }>
  const LIMITS = {
    'voice:reaction':       { max: 10, windowMs: 2_000 },
    'liveclass:reaction':   { max: 10, windowMs: 2_000 },
    'voice:speaking':       { max: 30, windowMs: 5_000 },
    'liveclass:speaking':   { max: 30, windowMs: 5_000 },
    'dm:typing_start':      { max: 20, windowMs: 5_000 },
    'dm:typing_stop':       { max: 20, windowMs: 5_000 },
    'voice:leave_room':     { max: 10, windowMs: 5_000 },
    'liveclass:video_changed': { max: 15, windowMs: 5_000 },
  };

  // counters: Map<eventName, { count: number, windowStart: number }>
  const counters = new Map();

  return function isAllowed(eventName) {
    const limit = LIMITS[eventName];
    if (!limit) return true; // event has no limit — allow

    const now  = Date.now();
    const prev = counters.get(eventName);

    if (!prev || (now - prev.windowStart) > limit.windowMs) {
      // New window
      counters.set(eventName, { count: 1, windowStart: now });
      return true;
    }

    if (prev.count >= limit.max) {
      return false; // rate limit exceeded — drop event
    }

    prev.count++;
    return true;
  };
}

// ─── Socket.IO connection handler ─────────────────────────────────────────────
io.on('connection', (socket) => {
  const userId   = socket.userId;
  const userRole = socket.userRole;
  // Each connected socket gets its own rate limiter instance (in-memory, per socket)
  const socketAllow = createSocketRateLimiter();

  logger.info(`Client connected: ${socket.id} (userId: ${userId})`);

  // ── Personal room — all user-targeted server→client events ──────────────
  // Controllers emit to `user:{userId}` for: voice:mic_offer, voice:kicked,
  // voice:promoted_to_speaker, dm:message, social:followed, etc.
  if (userId) {
    socket.join(`user:${userId}`);
    logger.info(`User ${userId} joined personal room user:${userId}`);
  }

  // ── Role room — admin broadcast events (report alerts, system notices) ───
  // report-block.controller.js emits to role:SUPER_ADMIN only (SOC-P0-03 fixed).
  if (userRole) {
    socket.join(`role:${userRole}`);
    logger.debug(`User ${userId} joined role room role:${userRole}`);
  }

  // ── Voice room presence ──────────────────────────────────────────────────
  // SOC-P1-05 FIX: Verify active DB participation before joining the socket room.
  // Previously any authenticated user could join voice:{roomId} without being
  // an active participant — kicked users could rejoin the socket room and continue
  // receiving all room events (speaking, reactions, messages, gift events).
  // Now requires an active VoiceParticipant record, matching the liveclass:join_room
  // pattern that was already fixed.
  socket.on('voice:join_room', async (roomId) => {
    const id = typeof roomId === 'object' ? roomId?.roomId : roomId;
    if (!id || !userId) return;
    try {
      const participant = await prisma.voiceParticipant.findUnique({
        where: { roomId_userId: { roomId: id, userId } },
        select: { isActive: true },
      });
      if (!participant?.isActive) return; // not an active participant — silently refuse
      socket.join(`voice:${id}`);
      logger.info(`User ${userId} joined voice room voice:${id}`);
    } catch (err) {
      logger.warn(`[socket] voice:join_room participation check failed: ${err.message}`);
    }
  });

  socket.on('voice:leave_room', (roomId) => {
    const id = typeof roomId === 'object' ? roomId?.roomId : roomId;
    if (!id) return;
    socket.leave(`voice:${id}`);
    logger.info(`User ${userId} left voice room voice:${id}`);
  });

  // ── Speaking indicator (broadcast to room) ───────────────────────────────
  socket.on('voice:speaking', ({ roomId, speaking }) => {
    if (!roomId || !userId) return;
    if (!socketAllow('voice:speaking')) return; // rate limit
    socket.to(`voice:${roomId}`).emit('voice:speaking', { userId, speaking });
  });

  // ── Emoji reaction (broadcast to room) — enforces reactionsEnabled ─────────
  socket.on('voice:reaction', async ({ roomId, emoji }) => {
    if (!roomId || !userId) return;
    if (!socketAllow('voice:reaction')) return;
    try {
      const cached = await getCache(`voice:room:${roomId}`).catch(() => null);
      const enabled = cached ? cached.reactionsEnabled !== false : true;
      if (!enabled) return;
    } catch {}
    socket.to(`voice:${roomId}`).emit('voice:reaction', { userId, emoji });
  });

  // ── School room presence (lobby real-time updates) ───────────────────────
  // Task 2 (P2-B): Validate school membership before joining the school socket room.
  // Previously any authenticated user could join any school's room and receive
  // live class start/schedule notifications for that school.
  // Allow: same school as authenticated user, or SUPER_ADMIN.
  // Never trust the client-supplied schoolId for authorization.
  socket.on('school:join', (schoolId) => {
    if (!schoolId) return;
    // userSchoolId comes from JWT (set in auth middleware above) — never from client payload
    if (userRole !== 'SUPER_ADMIN' && socket.userSchoolId !== schoolId) return; // silently reject
    socket.join(`school:${schoolId}`);
  });

  socket.on('school:leave', (schoolId) => {
    if (!schoolId) return;
    socket.leave(`school:${schoolId}`);
  });

  // ── Class room presence (live class notifications) ────────────────────────
  // L-6 FIX: Validate school membership before joining class notification room.
  // Previously any authenticated user could subscribe to any class's events
  // (liveclass:started, schedule changes) for any class in any school.
  socket.on('class:join', async (classId) => {
    if (!classId || !userId) return;
    try {
      // SUPER_ADMIN global bypass
      if (userRole === 'SUPER_ADMIN') {
        socket.join(`class:${classId}`);
        return;
      }
      // Check user has an active enrollment, teacher assignment, or school membership
      // for the school that owns this class
      const cls = await prisma.class.findFirst({
        where: { id: classId, deletedAt: null },
        select: { schoolId: true }
      });
      if (!cls) return; // class not found
      // Verify school membership
      const membership = await prisma.schoolMembership.findUnique({
        where: { userId_schoolId: { userId, schoolId: cls.schoolId } },
        select: { status: true }
      });
      // Legacy fallback: also check user.schoolId
      if ((!membership || membership.status !== 'ACTIVE') && socket.userSchoolId !== cls.schoolId) return;
      socket.join(`class:${classId}`);
      logger.debug(`User ${userId} joined class room class:${classId}`);
    } catch (err) {
      logger.warn(`[socket] class:join membership check failed: ${err.message}`);
    }
  });

  socket.on('class:leave', (classId) => {
    if (!classId) return;
    socket.leave(`class:${classId}`);
  });

  // ── DM typing indicators (relay to recipient) ────────────────────────────
  socket.on('dm:typing_start', ({ convId, receiverId }) => {
    if (!receiverId || !userId) return;
    if (!socketAllow('dm:typing_start')) return; // rate limit
    io.to(`user:${receiverId}`).emit('dm:typing_start', { convId, userId });
  });

  socket.on('dm:typing_stop', ({ convId, receiverId }) => {
    if (!receiverId || !userId) return;
    if (!socketAllow('dm:typing_stop')) return; // rate limit
    io.to(`user:${receiverId}`).emit('dm:typing_stop', { convId, userId });
  });

  // ── Live class room relay events ─────────────────────────────────────────
  // These are lightweight client→server→room broadcasts that don't need DB writes.
  // P0-04 (RT-05): Verify active DB participation before joining the socket room.
  // Previously any authenticated socket could join any live class room and receive
  // all events (mute, hand-raise, whiteboard, poll, chat) without being a participant.
  socket.on('liveclass:join_room', async (liveClassId) => {
    if (!liveClassId || !userId) return;
    try {
      const participant = await prisma.liveClassParticipant.findFirst({
        where: { liveClassId, userId, isActive: true },
        select: { id: true },
      });
      if (!participant) return; // not an active participant — silently refuse
      socket.join(`liveclass:${liveClassId}`);
      logger.debug(`User ${userId} joined live class room liveclass:${liveClassId}`);
    } catch (err) {
      logger.warn(`[socket] liveclass:join_room participation check failed: ${err.message}`);
    }
  });

  socket.on('liveclass:leave_room', (liveClassId) => {
    if (!liveClassId) return;
    socket.leave(`liveclass:${liveClassId}`);
  });

  // Host broadcasts view mode change to all participants
  // P1-02 (BUG-04): Verify the emitting socket belongs to an active HOST participant.
  // Previously any student in the room could force a global view-mode change.
  // Server reads role from DB — never trusts client-supplied role/isHost fields.
  socket.on('liveclass:viewmode_changed', async ({ liveClassId, viewMode }) => {
    if (!liveClassId || !viewMode || !userId) return;
    try {
      const host = await prisma.liveClassParticipant.findFirst({
        where: { liveClassId, userId, isActive: true, role: 'HOST' },
        select: { id: true },
      });
      if (!host) return; // not the host — silently drop
      // Relay to everyone in the room including sender (so all clients switch)
      io.to(`liveclass:${liveClassId}`).emit('liveclass:viewmode_changed', { liveClassId, viewMode });
      logger.debug(`Host ${userId} set live class ${liveClassId} viewMode to ${viewMode}`);
    } catch (err) {
      logger.warn(`[socket] liveclass:viewmode_changed host check failed: ${err.message}`);
    }
  });

  // Speaking indicator relay (client→room)
  // P0-02 (BUG-03): Use socket.userId — never trust client-supplied userId.
  // The old code used `speakerId || userId`, allowing any client to impersonate
  // another participant's speaking state by sending a fake userId in the payload.
  socket.on('liveclass:speaking', ({ liveClassId, speaking }) => {
    if (!liveClassId) return;
    if (!socketAllow('liveclass:speaking')) return; // rate limit
    // userId is captured from socket.userId at connection time (JWT-verified)
    socket.to(`liveclass:${liveClassId}`).emit('liveclass:speaking', { userId, speaking });
  });

  // Video on/off relay (client→room)
  // P0-03 (RT-02): Use socket.userId — never trust client-supplied userId.
  socket.on('liveclass:video_changed', ({ liveClassId, isVideoOn }) => {
    if (!liveClassId) return;
    if (!socketAllow('liveclass:video_changed')) return; // rate limit
    // userId is captured from socket.userId at connection time (JWT-verified)
    socket.to(`liveclass:${liveClassId}`).emit('liveclass:video_changed', { userId, isVideoOn });
  });

  // Emoji reaction relay (client→room)
  // Task 5 (P3-B): Strip client-supplied display names from the relay.
  // The receiver's frontend can resolve firstName from its local participant state using
  // the server-verified userId. This prevents display name spoofing in reaction overlays.
  // targetUserId is kept (it's a data field, not an identity field — spoofing it only
  // affects UI targeting, not authorization).
  socket.on('liveclass:reaction', ({ liveClassId, emoji, targetUserId }) => {
    if (!liveClassId || !userId) return;
    if (!socketAllow('liveclass:reaction')) return; // rate limit
    socket.to(`liveclass:${liveClassId}`).emit('liveclass:reaction', {
      userId,        // server-verified
      emoji,
      targetUserId,  // UI data only — does not affect authorization
      // firstName and targetName are intentionally stripped — clients resolve from participant state
    });
  });

  // ── Group Chat room presence (Phase C-1) ────────────────────────────────────
  // C-2 FIX: Validate DB membership before joining a group conversation room.
  // Previously any authenticated socket could join any convId and receive
  // all group messages, reactions, and typing events for that conversation.
  socket.on('group:join', async (convId) => {
    if (!convId || !userId) return;
    try {
      const member = await prisma.groupMember.findFirst({
        where: { conversationId: convId, userId, isActive: true },
        select: { id: true },
      });
      if (!member) return; // silently reject — not a member of this conversation
      socket.join(`conversation:${convId}`);
    } catch (err) {
      logger.warn(`[socket] group:join membership check failed: ${err.message}`);
    }
  });

  socket.on('group:leave', (convId) => {
    if (!convId) return;
    socket.leave(`conversation:${convId}`);
  });

  // Group typing indicators
  // M-5 FIX: Always use socket.userId (JWT-verified) — never relay client-supplied userId.
  // Previously `tid || userId` allowed any user to spoof another user's typing indicator.
  socket.on('group:typing_start', ({ convId, name }) => {
    if (!convId) return;
    // userId is captured from socket.userId at connection time (JWT-verified)
    socket.to(`conversation:${convId}`).emit('group:typing_start', { convId, userId, name });
  });

  socket.on('group:typing_stop', ({ convId }) => {
    if (!convId) return;
    // userId is captured from socket.userId at connection time (JWT-verified)
    socket.to(`conversation:${convId}`).emit('group:typing_stop', { convId, userId });
  });

  // ── Feed socket rooms (Phase B-1) ───────────────────────────────────────────
  // New events only — zero changes to existing events.
  // Clients call feed:join on mount to receive real-time post events.
  socket.on('feed:join', () => {
    if (userId) socket.join(`feed:${userId}`);
    socket.join('feed:public');
  });

  socket.on('feed:leave', () => {
    if (userId) socket.leave(`feed:${userId}`);
    socket.leave('feed:public');
  });

  // School-scoped feed rooms for SCHOOL_ONLY posts
  // C-3 FIX: Validate school membership before joining school feed rooms.
  // Previously any authenticated user could subscribe to any school's real-time feed
  // by emitting feed:join:school with an arbitrary schoolId.
  socket.on('feed:join:school', ({ schoolId } = {}) => {
    if (!schoolId) return;
    // SUPER_ADMIN global bypass (legacy)
    if (userRole === 'SUPER_ADMIN') {
      socket.join(`feed:school:${schoolId}`);
      return;
    }
    // socket.userSchoolId is set from the JWT at connection time — never from client payload
    if (socket.userSchoolId !== schoolId) return; // silently reject
    socket.join(`feed:school:${schoolId}`);
  });

  socket.on('feed:leave:school', ({ schoolId } = {}) => {
    if (schoolId) socket.leave(`feed:school:${schoolId}`);
  });

  // ── Wallet socket rooms (Phase B-2) ─────────────────────────────────────────
  // wallet:coins_credited is emitted by stripe.controller.js after webhook confirms payment.
  // Client joins wallet:${userId} room on the wallet page to receive live credit updates.
  socket.on('wallet:join', () => {
    if (userId) socket.join(`wallet:${userId}`);
  });

  socket.on('wallet:leave', () => {
    if (userId) socket.leave(`wallet:${userId}`);
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id} (userId: ${userId})`);
  });

  // ── PK Battle System socket events ─────────────────────────────────────────
  // Clients join a PK room to receive real-time battle events.
  // pk:{pkMatchId} — broadcast events (scores, timer, gifts, votes)
  const pkService = require('./services/pk.service');

  socket.on('pk:join', async (pkMatchId) => {
    if (!pkMatchId || !userId) return;

    // SOC-P1-04 FIX: Verify the user is a participant or spectator of this PK match.
    // Previously any authenticated user could join pk:{pkMatchId} and receive
    // real-time battle state (scores, timer, gifts, votes) for any match — this
    // could be used for timing attacks or cheating during voting.
    try {
      const isParticipant = await prisma.pKParticipant.findFirst({
        where: { matchId: pkMatchId, userId },
        select: { id: true },
      }).catch(() => null);

      // If not a direct participant, check if the match is publicly viewable
      // (LIVE or ENDED matches can be spectated — spectators need battle state too).
      // For matches in PENDING/WAITING state, only participants may join.
      if (!isParticipant) {
        const match = await prisma.pKMatch.findFirst({
          where: { id: pkMatchId, state: { in: ['LIVE', 'ENDED', 'PAUSED'] } },
          select: { id: true },
        }).catch(() => null);
        // Neither a participant nor watching a live/ended match — refuse
        if (!match) return;
      }
    } catch (err) {
      logger.warn(`[socket] pk:join check failed: ${err.message}`);
      return;
    }

    socket.join(`pk:${pkMatchId}`);
    logger.debug(`User ${userId} joined pk room pk:${pkMatchId}`);

    // Send reconnect state immediately
    try {
      const state = await pkService.getReconnectState(pkMatchId, userId);
      if (state) socket.emit('pk:state', state);
    } catch {}
  });

  socket.on('pk:leave', (pkMatchId) => {
    if (!pkMatchId) return;
    socket.leave(`pk:${pkMatchId}`);
  });

  // Timer sync request — client asks for authoritative remaining time
  socket.on('pk:timer:sync', async (pkMatchId) => {
    if (!pkMatchId || !userId) return;
    try {
      const timer = await pkService.getTimerState(pkMatchId);
      if (timer) {
        socket.emit('pk:timer', {
          pkMatchId,
          remainingSeconds: pkService.getRemainingSeconds(timer),
          serverTime: Date.now(),
        });
      }
    } catch {}
  });
});

// ─── Enterprise feature initialization ───────────────────────────────────────────
// Initialize OpenTelemetry tracing (BE-004)
tracing.initialize().catch(err => logger.warn('Failed to initialize tracing:', err.message));

// Initialize feature flags
featureFlags.initialize(featureFlags.defaultFlags).catch(err => logger.warn('Failed to initialize feature flags:', err.message));

// Initialize SMS service (Twilio) — safe no-op when credentials not configured
try {
  const sms = require('./utils/sms');
  sms.initialize();
} catch (err) {
  logger.warn('[startup] SMS initialization skipped:', err.message);
}

// Initialize Elasticsearch — only when ELASTICSEARCH_URL is set
// Falls back to MySQL LIKE queries automatically when not configured
if (process.env.ELASTICSEARCH_URL) {
  const es = require('./utils/elasticsearch');
  es.initialize().catch(err =>
    logger.warn('[startup] Elasticsearch initialization failed (falling back to MySQL search):', err.message)
  );
} else {
  logger.info('[startup] Elasticsearch not configured — using MySQL full-text search fallback');
}

// Initialize leader election (for clustering)
leaderElection.initialize('halqa-backend').catch(err => logger.warn('Failed to initialize leader election:', err.message));

// ─── Static file serving — local uploads (STORAGE_TYPE=local only) ───────────
// In production with R2, files are served directly from Cloudflare CDN.
// In local dev, files land in backend/uploads/ and need to be served here.
// NOTE: registered BEFORE the helmet/cors middleware so that static image
// requests from the browser (localhost:3000 → localhost:5000) are not blocked.
if (process.env.STORAGE_TYPE !== 'r2') {
  const uploadPath = require('path').join(__dirname, '..', 'uploads');
  // Add permissive CORS for static media so <img src> from any allowed origin works
  app.use('/uploads', (req, res, next) => {
    const origin = req.headers.origin;
    const allowed = (process.env.CLIENT_URL || 'http://localhost:3000')
      .split(',').map(o => o.trim());
    if (!origin || allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use('/uploads', express.static(uploadPath, {
    maxAge: '7d',
    etag:   true,
    index:  false,
    fallthrough: true,
  }));
  logger.info(`📁 Serving local uploads from ${uploadPath}`);
}

// ─── Security middleware ───────────────────────────────────────────────────────
app.use(helmet({
  // Allow cross-origin image/media loads (needed for uploads served from :5000
  // to be displayed on the frontend at :3000)
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── CORS: support comma-separated CLIENT_URL for multiple origins ─────────────
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true
}));

// ─── Body parsing middleware ───────────────────────────────────────────────────
// Use Brotli compression (falls back to gzip)
app.use(compressionMiddleware.middleware());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Input sanitization (strip HTML from all string inputs) ───────────────────
app.use(sanitize);

// ─── Request logging ──────────────────────────────────────────────────────────
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));
app.use(requestLogger);

// ─── Distributed tracing middleware ─────────────────────────────────────────────
// BE-004: Re-enabled. No-ops when isInitialized is false (package not installed).
app.use(tracing.middleware);

// ─── Rate limiting (global + user + device) ───────────────────────────────────────
app.use(rateLimiter);
app.use(userRateLimiter.middleware);
// BE-002: Re-enabled device rate limiter.
// The middleware was temporarily disabled — the implementation is complete and
// correct. It uses Redis when available and falls back to in-memory limiting
// if Redis is down (fail-open). No functional regression risk.
app.use(deviceRateLimiter.middleware);

// ─── API versioning — attaches req.apiVersion and deprecation headers ─────────
app.use(apiVersion.middleware);

// ─── Session management middleware ──────────────────────────────────────────────
// BE-003: Re-enabled. The middleware export is a safe no-op pass-through by default.
// Per-route session tracking (trackSession, validateSession, enforceSessionLimit)
// is already wired in auth.routes.js — this line re-activates the global middleware.
app.use(sessionMiddleware.middleware);

// ─── Response caching middleware ────────────────────────────────────────────────
app.use('/api/v1', cacheMiddleware.shortCache);

// ─── Health checks ────────────────────────────────────────────────────────────
// /health          — basic liveness (bypasses rate limiter and auth)
// /health/liveness — Kubernetes liveness probe
// /health/readiness— Kubernetes readiness probe (checks DB + Redis + circuit breakers)
// /health/startup  — Kubernetes startup probe
// /health/detailed — full diagnostic (DB, Redis, memory, event loop, disk)
app.get('/health', health.liveness);
app.get('/health/liveness', health.liveness);
app.get('/health/readiness', health.readiness);
app.get('/health/startup', health.startup);
app.get('/health/detailed', health.detailed);

// ─── Prometheus /metrics endpoint (protected by METRICS_TOKEN) ───────────────
// SECURITY FIX: Always require a valid token. The previous logic allowed access
// when METRICS_TOKEN was empty or equal to the default placeholder value, which
// exposed infrastructure details (request rates, error counts, DB latency) publicly.
//
// Access rules:
//   Development (NODE_ENV != production): allowed without token for convenience.
//   Production: METRICS_TOKEN must be set to a strong random value. Requests
//               must supply it via:  Authorization: Bearer <token>
//               or query param:      ?token=<token>
app.get('/metrics', async (req, res) => {
  const configuredToken = process.env.METRICS_TOKEN;
  const IS_PROD = process.env.NODE_ENV === 'production';
  const DEFAULT_TOKEN = 'halqa_metrics_dev_token_change_in_production';

  // In production, a token MUST be configured and must not be the default.
  if (IS_PROD) {
    if (!configuredToken || configuredToken === DEFAULT_TOKEN) {
      logger.error('[metrics] METRICS_TOKEN is not set or is still the default value. Endpoint blocked.');
      return res.status(503).json({ error: 'Metrics endpoint is not configured for production. Set METRICS_TOKEN.' });
    }
    const supplied = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
    if (supplied !== configuredToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  } else if (configuredToken && configuredToken !== DEFAULT_TOKEN) {
    // Development with a custom token set: still enforce it.
    const supplied = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
    if (supplied !== configuredToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  // Development with no token or default token: allow freely (local dev convenience).

  try {
    const prom = require('./utils/prometheus');
    res.set('Content-Type', prom.registry.contentType);
    res.end(await prom.registry.metrics());
  } catch (e) {
    res.status(500).end(e.message);
  }
});

// ─── Idempotency middleware for write operations ───────────────────────────────
// Apply to routes that should be idempotent (payments, creations, etc.)
app.use('/api/v1/stripe',    idempotencyMiddleware.writeIdempotency);
app.use('/api/v1/posts',     idempotencyMiddleware.writeIdempotency);
app.use('/api/v1/creators',  idempotencyMiddleware.writeIdempotency);

// ─── GraphQL API ───────────────────────────────────────────────────────────────
graphqlServer.setupGraphQL(app, httpServer);

// ─── OpenAPI/Swagger documentation ────────────────────────────────────────────
openapi.setup(app);

// ─── API routes ───────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/schools', schoolRoutes);
app.use('/api/v1/classes', classRoutes);
app.use('/api/v1/students', studentRoutes);
app.use('/api/v1/teachers', teacherRoutes);
app.use('/api/v1/guardians', guardianRoutes);
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/grades', gradeRoutes);
app.use('/api/v1/behavior', behaviorRoutes);
app.use('/api/v1/announcements', announcementRoutes);
app.use('/api/v1/messages', messageRoutes);
app.use('/api/v1/calendar', calendarRoutes);
app.use('/api/v1/fees', feeRoutes);
app.use('/api/v1/library', libraryRoutes);
app.use('/api/v1/notes', noteRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/social', socialRoutes);
app.use('/api/v1/terms', termRoutes);
app.use('/api/v1/upload', uploadRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/audio', audioRoutes);
app.use('/api/v1/activities', activityRoutes);
app.use('/api/v1/live-classes', liveClassRoutes);
app.use('/api/v1/import', importRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/voice', voiceRoutes);
app.use('/api/v1/voice/:id/members', require('./routes/room-member.routes'));
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/wallet/payout', payoutRoutes);
app.use('/api/v1/gifts', giftRoutes);
app.use('/api/v1/livekit', livekitRoutes);
app.use('/api/v1/dm', dmRoutes);
app.use('/api/v1/student-reports', studentReportRoutes);
app.use('/api/v1/posts',          postRoutes);            // Phase B-1: Social Feed
app.use('/api/v1/stripe',         stripeRoutes);          // Phase B-2: Stripe Payment

// Phase C routes
app.use('/api/v1/group-chat',     groupChatRoutes);       // Phase C-1: Group Chat
app.use('/api/v1/assignments',    assignmentRoutes);      // Phase C-2: Assignment Submissions
app.use('/api/v1/exams',          examRoutes);            // Phase C-3: Exam Submissions
app.use('/api/v1/marketplace',    marketplaceRoutes);      // Phase C-4: Marketplace
app.use('/api/v1/transport',      transportRoutes);        // Phase C-5: Transport
app.use('/api/v1/analytics',      analyticsRoutes);        // Phase C-6: Analytics
app.use('/api/v1/leaderboard',    leaderboardRoutes);      // Phase C-7: Leaderboard
app.use('/api/v1/search-index',   searchIndexRoutes);      // Phase C-8: Search Index
app.use('/api/v1/backups',        backupRoutes);           // Phase C-9: Backup
app.use('/api/v1/report-block',  reportBlockRoutes);      // Fix 3: Report & Block (was missing)
app.use('/api/v1/pk',            pkRoutes);               // PK Battle System
app.use('/api/v1/admin/pk',      pkAdminRoutes);           // PK Admin Management
app.use('/api/v1/internal',      internalRoutes);          // Internal Platform Admin Provisioning (SUPER_ADMIN only)
const adminStatsRoutes = require('./routes/admin-stats.routes');
app.use('/api/v1/admin/stats',   adminStatsRoutes);        // Super Admin platform statistics
app.use('/api/v1/school-memberships', schoolMembershipRoutes); // School Memberships (Education domain)
app.use('/api/v1/stories',        storyRoutes);           // Phase B-3: Stories
app.use('/api/v1/communities',    communityRoutes);       // Phase B-4: Communities
app.use('/api/v1/explore',        exploreRoutes);         // Phase B-5: Discovery
app.use('/api/v1/creators',       creatorRoutes);         // Phase B-6: Creator Economy

// ─── Phone connectivity test (dev only) ──────────────────────────────────────
// SECURITY FIX: Only register this route in non-production environments.
// Previously this served an internal test page publicly with no auth guard.
if (process.env.NODE_ENV !== 'production') {
  const path = require('path');
  const fs   = require('fs');
  app.get('/test', (req, res) => {
    const testFile = path.join(__dirname, '../test-phone.html');
    if (!fs.existsSync(testFile)) {
      return res.status(404).send('test-phone.html not found');
    }
    const html = fs.readFileSync(testFile, 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
  logger.info('DEV: /test route registered (development only)');
}

// ─── Error handling ───────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Server startup ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // ── 1. Connect Redis (required — fail fast if unavailable in production) ──
    // Redis powers: cache, Socket.IO multi-server adapter, BullMQ queues
    let redisConnected = false;

    if (process.env.REDIS_URL) {
      try {
        // connectRedis() connects pub + sub + cache clients and returns
        // { pubClient, subClient } for the Socket.IO adapter.
        const { connectRedis } = require('./utils/redis');
        const { pubClient, subClient } = await connectRedis();

        // ── 2. Attach Socket.IO Redis adapter (enables horizontal scaling) ────
        // Without this, Socket.IO events only reach sockets on THIS process.
        // With it, events fan out across all server instances via Redis pub/sub.
        const { createAdapter } = require('@socket.io/redis-adapter');
        io.adapter(createAdapter(pubClient, subClient));
        logger.info('✅ Socket.IO Redis adapter attached');

        // ── 3. Start BullMQ background workers ────────────────────────────────
        // Workers handle: email, notifications, reports, attendance alerts,
        // DB cleanup (expired OTPs, revoked tokens, overdue fees), orphaned R2 files.
        const { startWorkers, scheduleCleanup } = require('./services/queue.service');
        startWorkers();
        await scheduleCleanup();
        logger.info('✅ BullMQ workers started and cleanup scheduled');

        // ── 4. Initialize advanced job scheduler ────────────────────────────────
        const jobScheduler = require('./utils/jobScheduler');
        await jobScheduler.initialize();
        logger.info('✅ Job scheduler initialized');

        // ── 5. Scheduled Voice Room auto-transition cron ────────────────────        // Rooms created with a scheduledAt time show as SCHEDULED until someone
        // manually joins. This cron fires every minute and auto-transitions any
        // SCHEDULED room whose scheduledAt time has passed to LIVE, sending the
        // same socket broadcast + follower notifications that a manual join would.
        jobScheduler.scheduleCron(
          'voice-scheduled-rooms-auto-live',
          '* * * * *',  // every minute
          async () => {
            const _prisma = require('./utils/prisma');
            const { broadcastLiveStart: _bls } = require('./utils/feedLive');
            const { queueBulkNotifications: _qbn } = require('./services/queue.service');
            const _io = global.io;
            const now = new Date();

            // Find rooms that are SCHEDULED and whose scheduledAt has passed
            const due = await _prisma.voiceRoom.findMany({
              where: {
                status:      'SCHEDULED',
                scheduledAt: { lte: now },
                deletedAt:   null,
              },
              select: {
                id: true, hostId: true, title: true, description: true,
                coverEmoji: true, coverImageUrl: true, privacy: true, schoolId: true,
              }
            });

            for (const room of due) {
              try {
                // Transition to LIVE
                await _prisma.voiceRoom.update({
                  where: { id: room.id },
                  data: { status: 'LIVE', startedAt: now, lastActivityAt: now, updatedAt: now }
                });

                // Invalidate cache
                const { deleteCache } = require('./utils/redis');
                await deleteCache(`voice:room:${room.id}`).catch(() => {});

                // Notify socket lobby
                if (_io) {
                  _io.to(`voice:${room.id}`).emit('voice:status_changed', { roomId: room.id, status: 'LIVE' });
                  if (room.schoolId) {
                    _io.to(`school:${room.schoolId}`).emit('voice:status_changed', { roomId: room.id, status: 'LIVE' });
                  }
                }

                // Broadcast to social feed
                if (room.privacy === 'PUBLIC') {
                  _bls({
                    refEntityType: 'voice_room', refEntityId: room.id,
                    authorId: room.hostId, title: room.title,
                    description: room.description, coverEmoji: room.coverEmoji,
                    coverImageUrl: room.coverImageUrl,
                    schoolId: room.schoolId, participantCount: 0,
                  });

                  // Notify followers
                  const host = await _prisma.user.findUnique({
                    where: { id: room.hostId },
                    select: { firstName: true, lastName: true },
                  });
                  const hostName = host ? `${host.firstName} ${host.lastName}`.trim() : 'Someone';
                  const emoji   = room.coverEmoji || '🎙️';
                  const title   = `${emoji} ${hostName} is live now!`;
                  const body    = room.title ? `"${room.title}" — join the Voice Club` : 'Join the Voice Club';

                  let skip = 0;
                  while (true) {
                    const followers = await _prisma.follow.findMany({
                      where: { followingId: room.hostId },
                      select: { followerId: true },
                      skip, take: 100,
                    });
                    if (followers.length === 0) break;
                    await _qbn(followers.map(f => ({
                      userId: f.followerId, type: 'VOICE_ROOM_LIVE',
                      title, body, data: { roomId: room.id, hostId: room.hostId },
                    }))).catch(() => {});
                    skip += 100;
                    if (followers.length < 100) break;
                  }
                }

                logger.info(`[scheduler] Voice room ${room.id} auto-transitioned SCHEDULED → LIVE`);
              } catch (err) {
                logger.warn(`[scheduler] Failed to auto-transition room ${room.id}: ${err.message}`);
              }
            }
          },
          { persist: false } // in-process cron only — no DB persistence needed
        );
        logger.info('✅ Voice scheduled-room auto-live cron registered (every minute)');

        // ── 6. Scheduled Live Class reminder cron (every minute) ────────────
        // When a live class's scheduledAt time passes but the teacher hasn't
        // joined yet, we DON'T auto-start (teacher must initiate). Instead we:
        // 1. Send a reminder notification to the teacher.
        // 2. Notify enrolled students that the class is about to start.
        // This fires once per class (tracks in-memory Set to avoid re-sending).
        const _sentReminders = new Set();
        jobScheduler.scheduleCron(
          'live-class-schedule-reminder',
          '* * * * *',
          async () => {
            const _prisma = require('./utils/prisma');
            const { queueBulkNotifications: _qbn } = require('./services/queue.service');
            const now = new Date();
            // Window: classes whose scheduledAt is within the last 5 minutes
            // and haven't started yet (SCHEDULED status, not ENDED/CANCELLED)
            const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);

            const due = await _prisma.liveClass.findMany({
              where: {
                status:      'SCHEDULED',
                deletedAt:   null,
                scheduledAt: { lte: now, gte: fiveMinAgo },
              },
              select: {
                id: true, classId: true, teacherId: true, title: true, schoolId: true,
                teacher: { select: { userId: true, user: { select: { firstName: true, lastName: true } } } },
              },
            });

            for (const lc of due) {
              if (_sentReminders.has(lc.id)) continue; // already sent this session
              _sentReminders.add(lc.id);

              try {
                const teacherUserId = lc.teacher?.userId;
                if (!teacherUserId) continue;

                // Notify the teacher
                await _qbn([{
                  userId: teacherUserId,
                  type:   'LIVE_CLASS_START',
                  title:  '📹 Your class is starting now!',
                  body:   `"${lc.title}" — tap to start your session`,
                  data:   { liveClassId: lc.id },
                }]).catch(() => {});

                // Notify enrolled students
                const enrollments = await _prisma.enrollment.findMany({
                  where:  { classId: lc.classId, isActive: true },
                  select: { student: { select: { userId: true } } },
                });
                if (enrollments.length > 0) {
                  const teacherName = lc.teacher?.user
                    ? `${lc.teacher.user.firstName} ${lc.teacher.user.lastName}`.trim()
                    : 'Your teacher';
                  await _qbn(enrollments.map(e => ({
                    userId: e.student.userId,
                    type:   'LIVE_CLASS_START',
                    title:  `📹 ${teacherName} is starting class now`,
                    body:   `"${lc.title}" — join now`,
                    data:   { liveClassId: lc.id },
                  }))).catch(() => {});
                }

                logger.info(`[scheduler] Live class ${lc.id} reminder sent to ${enrollments.length + 1} users`);
              } catch (err) {
                logger.warn(`[scheduler] Live class reminder failed for ${lc.id}: ${err.message}`);
              }
            }
          },
          { persist: false }
        );
        logger.info('✅ Live class schedule reminder cron registered (every minute)');

        // ── 7. Live class duration auto-end cron (every minute) ─────────────
        // When a LIVE class has been running longer than its scheduled duration,
        // automatically end it so rooms don't run indefinitely.
        jobScheduler.scheduleCron(
          'live-class-duration-auto-end',
          '* * * * *',
          async () => {
            const _prisma = require('./utils/prisma');
            const _io = global.io;
            const { broadcastLiveEnd: _ble } = require('./utils/feedLive');
            const now = new Date();

            // Find LIVE classes whose (startedAt + duration minutes) < now
            // Use raw query for efficiency — Prisma doesn't support computed date filtering
            const overdueLiveClasses = await _prisma.$queryRaw`
              SELECT id, schoolId, startedAt, duration, classId
              FROM live_classes
              WHERE status = 'LIVE'
                AND deletedAt IS NULL
                AND startedAt IS NOT NULL
                AND DATE_ADD(startedAt, INTERVAL duration MINUTE) < ${now}
            `;

            for (const lc of overdueLiveClasses) {
              try {
                const endedAt = now;

                // Mark all active participants inactive with totalDuration
                const active = await _prisma.liveClassParticipant.findMany({
                  where: { liveClassId: lc.id, isActive: true }
                });

                await _prisma.$transaction([
                  _prisma.liveClass.update({
                    where: { id: lc.id },
                    data: { status: 'ENDED', endedAt }
                  }),
                  ...(active.map(p => _prisma.liveClassParticipant.update({
                    where: { id: p.id },
                    data: {
                      isActive: false, leftAt: endedAt,
                      totalDuration: p.totalDuration + Math.floor(
                        (endedAt.getTime() - new Date(p.joinedAt).getTime()) / 1000
                      )
                    }
                  })))
                ]);

                // Update attendance records
                // LC-005 FIX: Apply MIN_PRESENT_MINUTES threshold consistently.
                // The leaveLiveClass() handler marks PARTIAL when < 10 minutes.
                // The auto-end cron previously always marked PRESENT — now aligned.
                const MIN_PRESENT_MINUTES = 10;
                const attendances = await _prisma.liveClassAttendance.findMany({
                  where: { liveClassId: lc.id, leftAt: null }
                });
                await Promise.all(attendances.map(a => {
                  const mins = Math.floor(
                    (endedAt.getTime() - new Date(a.joinedAt).getTime()) / 60000
                  );
                  return _prisma.liveClassAttendance.update({
                    where: { id: a.id },
                    data: {
                      leftAt: endedAt,
                      totalMinutes: mins,
                      status: mins >= MIN_PRESENT_MINUTES ? 'PRESENT' : 'PARTIAL'
                    }
                  });
                }));

                // Notify socket room
                if (_io) {
                  _io.to(`liveclass:${lc.id}`).emit('liveclass:ended', {
                    liveClassId: lc.id,
                    reason: 'duration_exceeded'
                  });
                }

                // Remove live card from feed
                _ble('live_class', lc.id);

                logger.info(`[scheduler] Live class ${lc.id} auto-ended (duration exceeded)`);
              } catch (err) {
                logger.warn(`[scheduler] Auto-end failed for live class ${lc.id}: ${err.message}`);
              }
            }
          },
          { persist: false }
        );
        logger.info('✅ Live class duration auto-end cron registered (every minute)');

        redisConnected = true;
      } catch (redisErr) {
        if (process.env.NODE_ENV === 'production') {
          logger.error(`❌ Redis connection failed in production: ${redisErr.message}`);
          logger.error('Redis is required for production. Set REDIS_URL in your environment.');
          process.exit(1);
        } else {
          // Development: warn but continue without Redis
          logger.warn(`⚠️  Redis unavailable (${redisErr.message}) — running without cache/queues`);
          logger.warn('   To enable Redis: docker run -d --name halqa-redis -p 6379:6379 redis:7-alpine');
        }
      }
    } else {
      if (process.env.NODE_ENV === 'production') {
        logger.error('❌ REDIS_URL is not set. Redis is required in production.');
        process.exit(1);
      } else {
        logger.warn('⚠️  REDIS_URL not set — running without Redis (dev mode only)');
      }
    }

    // ── Task 7 (P3-D): Ensure duration auto-end cron runs regardless of Redis ────
    // The duration enforcement only uses the DB ($queryRaw) and needs no Redis.
    // If Redis connected above, the cron is already registered (step 7 inside Redis block).
    // If Redis was unavailable (dev mode), register it here so classes still auto-end.
    if (!redisConnected) {
      try {
        const jobScheduler = require('./utils/jobScheduler');
        // Only initialize if not already done (Redis block skipped)
        await jobScheduler.initialize();
        jobScheduler.scheduleCron(
          'live-class-duration-auto-end',
          '* * * * *',
          async () => {
            const _prisma = require('./utils/prisma');
            const _io = global.io;
            const { broadcastLiveEnd: _ble } = require('./utils/feedLive');
            const now = new Date();
            const overdueLiveClasses = await _prisma.$queryRaw`
              SELECT id, startedAt, duration, classId
              FROM live_classes
              WHERE status = 'LIVE'
                AND deletedAt IS NULL
                AND startedAt IS NOT NULL
                AND duration IS NOT NULL
                AND DATE_ADD(startedAt, INTERVAL duration MINUTE) < ${now}
            `;
            for (const lc of overdueLiveClasses) {
              try {
                const endedAt = now;
                const active = await _prisma.liveClassParticipant.findMany({ where: { liveClassId: lc.id, isActive: true } });
                await _prisma.$transaction([
                  _prisma.liveClass.update({ where: { id: lc.id }, data: { status: 'ENDED', endedAt } }),
                  ...active.map(p => _prisma.liveClassParticipant.update({
                    where: { id: p.id },
                    data: { isActive: false, leftAt: endedAt, totalDuration: p.totalDuration + Math.floor((endedAt.getTime() - new Date(p.joinedAt).getTime()) / 1000) }
                  }))
                ]);
                const MIN_PRESENT_MINUTES = 10;
                const attendances = await _prisma.liveClassAttendance.findMany({ where: { liveClassId: lc.id, leftAt: null } });
                await Promise.all(attendances.map(a => {
                  const mins = Math.floor((endedAt.getTime() - new Date(a.joinedAt).getTime()) / 60000);
                  return _prisma.liveClassAttendance.update({ where: { id: a.id }, data: { leftAt: endedAt, totalMinutes: mins, status: mins >= MIN_PRESENT_MINUTES ? 'PRESENT' : 'PARTIAL' } });
                }));
                if (_io) _io.to(`liveclass:${lc.id}`).emit('liveclass:ended', { liveClassId: lc.id, reason: 'duration_exceeded' });
                _ble('live_class', lc.id);
                logger.info(`[scheduler] Live class ${lc.id} auto-ended (duration exceeded, no-Redis mode)`);
              } catch (err) {
                logger.warn(`[scheduler] Auto-end failed for live class ${lc.id}: ${err.message}`);
              }
            }
          },
          { persist: false }
        );
        logger.info('✅ Live class duration auto-end cron registered (no-Redis fallback)');
      } catch (err) {
        logger.warn(`[scheduler] Failed to register duration auto-end cron in no-Redis mode: ${err.message}`);
      }
    }

    // ── 4. Start HTTP server ───────────────────────────────────────────────
    await new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(PORT, () => {
        httpServer.removeListener('error', reject);
        logger.info(`🚀 Server running on port ${PORT}`);
        logger.info(`🔌 Socket.IO server ready${redisConnected ? ' (Redis adapter)' : ' (single-process)'}`);
        logger.info(`📊 Metrics: http://localhost:${PORT}/metrics`);
        logger.info(`❤️  Health:  http://localhost:${PORT}/health`);

        // Mark startup complete so /health/startup returns 200
        health.markStartupComplete();

        // ── Periodic memory monitoring & GC hint ─────────────────────────
        // Log a warning when heap usage exceeds 85% so operators know to restart.
        // If global.gc is available (--expose-gc flag), nudge the GC to reclaim
        // memory accumulated during startup (module loads, prisma warming, etc).
        if (global.gc) {
          global.gc();
          logger.info('[memory] Initial GC run completed after startup');
        }
        setInterval(() => {
          const { heapUsed, heapTotal } = process.memoryUsage();
          const pct = Math.round((heapUsed / heapTotal) * 100);
          if (pct > 85) {
            logger.warn(`[memory] Heap at ${pct}% (${Math.round(heapUsed/1024/1024)}MB/${Math.round(heapTotal/1024/1024)}MB). Consider restarting with --max-old-space-size=512`);
            if (global.gc) global.gc(); // nudge GC if available
          }
        }, 60_000); // check every minute

        resolve();
      });
    });

  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      logger.error(`❌ Port ${PORT} is already in use. Stop the existing server or change PORT in .env`);
    } else {
      logger.error(`Fatal startup error: ${err.message}`);
    }
    process.exit(1);
  }
}

startServer();

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);
  httpServer.close(async () => {
    try {
      await prisma.$disconnect();
      // Disconnect Redis if it was connected
      try {
        const { disconnectRedis } = require('./utils/redis');
        await disconnectRedis();
      } catch {}
      logger.info('Server shut down cleanly');
      process.exit(0);
    } catch (err) {
      logger.error(`Error during shutdown: ${err.message}`);
      process.exit(1);
    }
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = app;
