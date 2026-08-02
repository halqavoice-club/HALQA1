# Technical Design Document

## HALQA Platform — Incremental Improvements

## Overview

This document describes the technical design for 32 incremental improvements to the HALQA platform, derived from the Full Audit Report dated August 1, 2026. All changes are additive and backward-compatible — no API contracts, database schemas, or existing migrations are modified destructively.

After auditing every file referenced in the audit report, we found that 28 of the 57 original findings are **already implemented** in the codebase. The design below covers only the 32 items that still require work.

The improvements span: backend security hardening, input validation, caching, mobile security, frontend resilience, live feature reliability, DevOps, and test coverage.

## Architecture

HALQA follows a monorepo architecture with three independently deployable layers:

```
┌─────────────────────────────────────────────────────┐
│  frontend (Next.js 14)     mobile (React Native/Expo) │
│  Zustand + React Query     Zustand + Axios + MMKV      │
└──────────────────┬─────────────────┬─────────────────┘
                   │  HTTP/REST       │  HTTP/REST
                   │  Socket.IO       │  Socket.IO
┌──────────────────▼─────────────────▼─────────────────┐
│              backend (Node.js + Express)               │
│  Prisma ORM  ·  BullMQ  ·  Socket.IO  ·  Apollo GQL   │
└───────┬──────────────────────┬────────────────────────┘
        │                      │
   ┌────▼────┐           ┌─────▼──────┐
   │  MySQL  │           │   Redis    │
   │(MariaDB)│           │(cache/pub) │
   └─────────┘           └────────────┘
                         ┌────────────┐
                         │  LiveKit   │
                         │(media srv) │
                         └────────────┘
```

All 32 improvements work within this existing architecture. No new services, no new databases, no infrastructure changes beyond adding two npm packages (`file-type`, `@opentelemetry/sdk-node`).

## Components and Interfaces

### New Backend Middleware

**`ipAllowlist.js`** — Express middleware factory
- Input: `req.ip` from Express
- Config: `ADMIN_IP_ALLOWLIST` env var (comma-separated IPs/CIDRs)
- Output: passes request or returns HTTP 403

**`validators/*.js`** — Zod-based validators
- Pattern: `validate(zodSchema)` middleware (existing `validate.js` pattern)
- Applied at route registration level
- Returns HTTP 400 with structured errors on invalid input

### Modified Frontend Components

**`voice.store.ts`** — adds `resetRoom()` action
- Resets all room-related state to initial values
- Called by voice room component on unmount

**`socket.ts`** — `updateSocketToken(token)` function
- Disconnects and reconnects the socket with the new token
- Called by `auth.store.ts` on every token refresh

### New Mobile Hooks

**`useScreenProtection()`** — calls `expo-screen-capture` on mount/unmount
**`useLeaveConfirmation(onLeave, message)`** — intercepts Android hardware back button

## Data Models

No new database tables, columns, or migrations are introduced in this design.

The audit findings that required database indexes (DB-001, DB-002, DB-008) and connection pool tuning (DB-009) are **already implemented** in the current schema and `prisma.js` respectively.

The only database-adjacent work is:
- Audit log archival — exports old `audit_logs` rows to R2, then deletes them (existing table, no schema change)
- Orphaned gift transaction check — read-only query on existing `gift_transactions` table

## Correctness Properties

Every change in this design satisfies these invariants:

### Property 1: No API Breakage
HTTP status codes and response body field names are unchanged for valid requests. Input validators only add new 400 rejections for previously-invalid input.

**Validates: Requirements 4.5, 7.5, 8.6**

### Property 2: No Data Loss
Cleanup and archival jobs only delete records after a confirmed successful export to cold storage. If the export fails, the deletion is skipped and the error is logged.

**Validates: Requirements 3.5, 3.7**

### Property 3: Redis Unavailability is Non-Fatal
All Redis cache reads use try/catch with DB fallback. A Redis outage degrades performance (no caching) but never returns an error to the client.

**Validates: Requirements 6.5, 18.5**

### Property 4: Financial Atomicity Preserved
All gift transaction logic uses existing `prisma.$transaction` blocks. The `idempotencyKey` unique constraint on `gift_transactions` is preserved and not altered.

**Validates: Requirements 7.1, 7.4**

### Property 5: Backward Compatibility
No existing API routes, response shapes, database table names, Prisma model names, or column names are renamed or removed.

**Validates: Requirements 1.4, 1.5, 9.5, 9.6**

## Error Handling

| Component | Error | Behavior |
|---|---|---|
| Redis cache miss | Connection error | Fall back to DB, log error, return correct response |
| ClamAV unavailable | `CLAMAV_ENABLED=false` | Skip scan, allow upload |
| Audit log archival R2 failure | Export fails | Abort deletion, log error, retry next month |
| IP allowlist not configured | `ADMIN_IP_ALLOWLIST` empty | Allowlist check skipped (opt-in behavior) |
| OpenTelemetry exporter missing | No Jaeger/Tempo configured | Tracing no-ops silently |
| Magic bytes detection failure | `file-type` throws | Reject upload with HTTP 400 |

## Testing Strategy

Each implementation task should be verified with:

1. **Unit tests** — mock Redis/DB, verify business logic in isolation
2. **Integration tests** — real MySQL + Redis (CI job added in D-28)
3. **Manual regression** — verify existing flows still work after each change

Critical paths requiring test coverage (D-29):
- Gift send → wallet debit/credit consistency
- Voice room join → capacity enforcement
- Auth → lockout after 5 failures → reset on success
- Offline queue → retry → discard after 3 failures

**Date:** August 2, 2026
**Spec:** halqa-platform-improvements
**Stack:** Node.js + Express + Prisma + MySQL + Redis + Socket.IO + LiveKit + Next.js 14 + React Native + Expo

---

## Audit of Current Implementation

Before designing changes, we audited every file in the audit report. Many items are **already implemented**. The design below only covers items that still need work.

### Already Implemented (No Action Required)

| ID | Finding | Status |
|---|---|---|
| DB-001 | Composite index on `voice_rooms(status, privacy, schoolId)` | ✅ Done — `@@index([status, privacy, schoolId])` in schema |
| DB-002 | Composite index on `gift_transactions(createdAt, senderId)` | ✅ Done — `@@index([createdAt, senderId])` in schema |
| DB-008 | Composite index on `enrollments(studentId, classId, isActive)` | ✅ Done — `@@index([studentId, classId, isActive])` in schema |
| DB-009 | Prisma connection pool configuration | ✅ Done — `prisma.js` builds URL with `connection_limit=25`, `pool_timeout=10` |
| DB-004 | Notification cleanup cron | ✅ Done — `cleanup.worker.js` deletes read notifications >90 days |
| DB-005 | OTP cleanup cron | ✅ Done — `cleanup.worker.js` deletes expired/used OTPs |
| DB-006 | Refresh token cleanup cron | ✅ Done — `cleanup.worker.js` deletes revoked/expired tokens |
| BE-002 | Re-enable deviceRateLimiter | ✅ Done — `app.js` has `app.use(deviceRateLimiter.middleware)` |
| BE-006 | CSRF protection on cookie endpoints | ✅ Done — `sameSite: strict` cookie + JWT header separation |
| BE-007 | Stripe webhook sanitize bypass | ✅ Done — `sanitize.js` skips `/stripe/webhook` |
| BE-008 | Room list caching per school | ✅ Done — `listRooms()` has 10s Redis cache |
| BE-011 | sendGiftToAll transaction timeout | ✅ Done — `timeout: 30_000` in `sendGiftToAll()` |
| BE-012 | refreshToken response over-exposes fields | ⚠️ Partial — returns full `user` object including `fcmToken` etc. |
| BE-014 | GraphQL security hardening | ✅ Done — depth limit 7, introspection off in prod, CORS restricted |
| BE-015 | Bulk import row limit | ⚠️ Not found — needs implementation |
| SEC-001 | JWT_SECRET minimum length | ✅ Done — `validateEnv.js` enforces 32-char minimum |
| SEC-002 | Sensitive field redaction in logs | ✅ Done — `requestLogger.js` redacts password/otp/token/refreshToken |
| SEC-003 | Password complexity at registration | ✅ Done — `auth.routes.js` enforces 8-char, uppercase, digit rules |
| SEC-004 | Per-account login lockout | ✅ Done — `auth.controller.js` Redis-based 5-attempt lockout |
| SEC-007 | Remove default passwords from docker-compose | ✅ Done — both compose files use `${VAR:?error}` syntax |
| LV-002 | LiveKit token TTL shortened to 1h | ✅ Done — `livekit.controller.js` uses `ttl: '1h'` |
| DO-002 | Nginx rate limit for live endpoints | ✅ Done — `limit_req zone=live` in nginx.conf |
| DO-004 | Deploy pipeline safe migration order | ✅ Done — `deploy.yml` runs migrations in temp container first |
| DO-006 | Certbot auto-renewal | ✅ Done — `docker-compose.prod.yml` has certbot container |
| DO-007 | Frontend Docker health check | ✅ Done — `docker-compose.prod.yml` has frontend healthcheck |
| FE-001 | Access token out of localStorage | ✅ Done — `auth.store.ts` stores token in module-level memory only |
| PERF-001 | Dashboard aggregation caching | ✅ Done — `dashboard.controller.js` has 5-min Redis cache |
| PERF-002 | Socket.IO perMessageDeflate | ✅ Done — `app.js` enables `perMessageDeflate: { threshold: 1024 }` |
| PERF-003 | Participant list cap on room list | ✅ Done — `listRooms()` uses `take: 20` on participants |

---

## Items Requiring Implementation

The following 18 items still need changes. They are grouped by module and ordered by priority.

---

## Part 1 — Database

### D-1: Audit Log Archival Job (DB-007)

**Current state:** `cleanup.worker.js` handles OTPs, tokens, and notifications but has no audit log archival logic.

**Design:**
Add a new job type `'audit-log-archival'` to the cleanup worker (or schedule via `jobScheduler`). The job runs monthly (1st of each month at 05:00 UTC). It:
1. Queries `audit_logs` where `createdAt < now - 1 year`.
2. Exports them as gzipped JSON to R2 using the existing `storage.js` (`saveFile` or a new `uploadBuffer` call).
3. Only if the upload succeeds, deletes the exported rows.
4. Logs count and R2 key on success; logs error and aborts deletion on failure.

**Files to modify:**
- `backend/src/workers/cleanup.worker.js` — add audit-log-archival job handler
- `backend/src/services/queue.service.js` — add monthly schedule trigger for the new job

**Risk:** None — additive job. Uses existing R2 storage utilities.

---

### D-2: Orphaned Gift Transaction Check (DB-003)

**Current state:** No orphaned gift transaction check exists.

**Design:**
Add a weekly job to `cleanup.worker.js` that counts `gift_transactions` whose `roomId` does not exist in `voice_rooms` or `live_classes` (based on `roomType`). Log the count. **Do not delete.** This is an observability-only change.

```js
// Pseudo-query
const orphanCount = await prisma.$queryRaw`
  SELECT COUNT(*) as cnt FROM gift_transactions gt
  WHERE gt.room_type = 'voice'
  AND NOT EXISTS (SELECT 1 FROM voice_rooms vr WHERE vr.id = gt.roomId)
`;
```

**Files to modify:**
- `backend/src/workers/cleanup.worker.js` — add weekly orphan-check job

---

## Part 2 — Backend

### D-3: Input Validation Middleware (BE-001)

**Current state:** `backend/src/middleware/validators/` does not exist. `auth.routes.js` uses `express-validator` inline. Most other routes have no validation.

**Design:**
Create `backend/src/middleware/validators/` directory with one file per controller area. Use `zod` (already in `package.json` as `^4.3.6`) via the existing `validate.js` middleware pattern.

**Files to create:**
```
backend/src/middleware/validators/
  voice.validator.js
  gift.validator.js
  liveClass.validator.js
  import.validator.js
  marketplace.validator.js
```

Each exports `zod` schemas and `validate(schema)` middleware calls.

**Key schemas:**
```js
// voice.validator.js
const createRoomSchema = z.object({
  title:       z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  privacy:     z.enum(['PUBLIC', 'PRIVATE', 'INVITE_ONLY']).optional(),
  maxSpeakers: z.number().int().min(2).max(50).optional(),
});

// gift.validator.js
const sendGiftSchema = z.object({
  giftId:    z.string().uuid(),
  receiverId: z.string().uuid(),
  count:     z.number().int().min(1).max(100).optional(),
});
```

**Files to modify:**
- `backend/src/routes/voice.routes.js` — apply `createRoomSchema` on POST
- `backend/src/routes/gift.routes.js` — apply `sendGiftSchema` on POST
- `backend/src/routes/live-class.routes.js` — apply live class schemas
- `backend/src/routes/import.routes.js` — apply row-count guard (see D-4)

**Backward compatibility:** Only invalid input is rejected. Valid requests pass through unchanged.

---

### D-4: Bulk Import Row Count Limit (BE-015)

**Current state:** `import.controller.js` processes uploaded files with no row count guard.

**Design:**
After parsing the CSV/Excel file (before any DB inserts), count rows. If count > 1000, return HTTP 400 immediately.

```js
// In import.controller.js, after parsing:
if (rows.length > 1000) {
  return errorResponse(res,
    'Import exceeds the maximum of 1000 rows. Split into batches of 1000 or fewer.',
    400
  );
}
```

**Files to modify:**
- `backend/src/controllers/import.controller.js` — add row count guard after parse, before insert

---

### D-5: Session Middleware Re-enablement (BE-003)

**Current state:** `app.js` has `// app.use(sessionMiddleware.middleware); // Temporarily disabled`. The `session.middleware.js` exports `middleware: (req, res, next) => next()` — a no-op placeholder.

**Design:**
The session tracking is opt-in per-route (via `trackSession`, `validateSession`, `enforceSessionLimit`). The `middleware` export is already a no-op. Simply uncomment the line in `app.js` — it does nothing harmful because the no-op is the safe default. Per-route session tracking is already wired in `auth.routes.js`.

**Files to modify:**
- `backend/src/app.js` — uncomment `app.use(sessionMiddleware.middleware)`

**Risk:** None — the middleware is a no-op pass-through.

---

### D-6: OpenTelemetry Tracing Re-enablement (BE-004)

**Current state:** Tracing is commented out in `app.js` due to missing `@opentelemetry/*` packages.

**Design:**
Install the two required packages. Uncomment tracing initialization.

```bash
npm install @opentelemetry/sdk-node@0.52.1 @opentelemetry/auto-instrumentations-node@0.48.0 --save-exact
```

Check `backend/src/utils/tracing.js` — if it already exports `initialize()` and `middleware`, simply uncomment the two lines in `app.js`. If the file is missing, create a minimal one.

**Files to modify:**
- `backend/package.json` — add OpenTelemetry packages
- `backend/src/app.js` — uncomment tracing lines

**Risk:** Low. If the tracing exporter is not configured (no Jaeger/Tempo endpoint), OpenTelemetry fails silently in development.

---

### D-7: refreshToken Response Field Reduction (BE-012)

**Current state:** `auth.controller.js` `refreshToken()` spreads the full `user` object from `storedToken.user`, only stripping `passwordHash`. Fields like `fcmToken`, `twoFactorEnabled`, `phoneVerified` are included.

**Design:**
Add a `SAFE_USER_FIELDS` select constant. Use it in the `refreshToken` response.

```js
// At top of auth.controller.js
const REFRESH_USER_SELECT = {
  id: true, role: true, firstName: true,
  lastName: true, avatarUrl: true, schoolId: true
};

// In refreshToken(), change the include:
const storedToken = await prisma.refreshToken.findUnique({
  where: { token },
  include: { user: { select: REFRESH_USER_SELECT } }
});
```

**Files to modify:**
- `backend/src/controllers/auth.controller.js` — add `REFRESH_USER_SELECT`, apply to `refreshToken()`

**Backward compatibility:** Clients that used the extra fields will simply receive fewer fields. The access token payload is unchanged.

---

### D-8: getMe() Response Caching (BE-010)

**Current state:** `getMe()` does a 4-table join on every request with no caching.

**Design:**
Add a 60-second per-user Redis cache. Invalidate on user update.

```js
// In auth.controller.js getMe():
const cacheKey = `user:me:${req.user.id}`;
const cached = await safeGetCache(cacheKey);
if (cached) return successResponse(res, cached, 'Profile fetched');

const user = await prisma.user.findUnique({ where: ..., include: ... });
await safeSetCache(cacheKey, user, 60);
return successResponse(res, user, 'Profile fetched');
```

Invalidate in user update endpoint:
```js
await deleteCache(`user:me:${userId}`);
```

**Files to modify:**
- `backend/src/controllers/auth.controller.js` — add cache to `getMe()`
- `backend/src/controllers/user.controller.js` — add cache invalidation on update

---

### D-9: Admin IP Allowlist (SEC-005)

**Current state:** `backup.routes.js`, `audit.routes.js`, `analytics.routes.js` are protected by JWT + role check only.

**Design:**
Create `backend/src/middleware/ipAllowlist.js`:

```js
const ALLOWED_IPS = (process.env.ADMIN_IP_ALLOWLIST || '').split(',').map(s => s.trim()).filter(Boolean);

function ipAllowlist(req, res, next) {
  if (ALLOWED_IPS.length === 0) return next(); // not configured → skip
  const ip = req.ip || req.socket.remoteAddress;
  if (ALLOWED_IPS.includes(ip)) return next();
  return res.status(403).json({ success: false, message: 'Access denied' });
}
```

Apply to admin routes:
```js
// In backup.routes.js, audit.routes.js, analytics.routes.js
router.use(ipAllowlist);
```

**Files to create:**
- `backend/src/middleware/ipAllowlist.js`

**Files to modify:**
- `backend/src/routes/backup.routes.js`
- `backend/src/routes/audit.routes.js`
- `backend/src/routes/analytics.routes.js`

**Environment variable to add:**
- `ADMIN_IP_ALLOWLIST=192.168.1.0/24,10.0.0.1` (empty = allowlist disabled)

---

### D-10: File Upload Magic Bytes Validation (SEC-006)

**Current state:** `upload.routes.js` validates via Multer's `mimeType` (client-declared). `clamav.js` exists but is not wired to the upload route.

**Design:**
Install `file-type` package. In the upload route handler, after Multer reads the buffer, validate magic bytes before calling `saveFile`.

```js
// In upload.routes.js
const { fileTypeFromBuffer } = require('file-type');

// After multer processes the file, before saveFile:
const detected = await fileTypeFromBuffer(req.file.buffer);
if (!detected || !ALLOWED_MIMES.includes(detected.mime)) {
  return errorResponse(res, 'File type not permitted', 400);
}
```

Also wire `clamav.scanBuffer` (already exists in `clamav.js`) for ClamAV-enabled deployments:
```js
if (clamav.isEnabled()) {
  const scan = await clamav.scanBuffer(req.file.buffer, req.file.originalname);
  if (!scan.clean) return errorResponse(res, 'File failed security scan', 400);
}
```

**Files to modify:**
- `backend/package.json` — add `"file-type": "16.5.4"` (CJS-compatible version)
- `backend/src/routes/upload.routes.js` — add magic byte check + conditional ClamAV scan

---

### D-11: X-Content-Type-Options on Uploads Static Handler (BE-013)

**Current state:** The `/uploads` static handler in `app.js` sets CORS headers but not `X-Content-Type-Options: nosniff`.

**Design:**
Add one header in the existing static handler middleware block:

```js
app.use('/uploads', (req, res, next) => {
  // existing CORS headers...
  res.setHeader('X-Content-Type-Options', 'nosniff'); // ADD THIS
  // ...
  next();
});
```

**Files to modify:**
- `backend/src/app.js` — add `nosniff` header to uploads static handler

---

## Part 3 — Frontend

### D-12: Error Boundary on Live Components (FE-002)

**Current state:** `error-boundary.tsx` exists with a "Try Again" button that resets `hasError`. It is not applied to `LiveClassRoomImpl` or voice room components.

**Design:**
Wrap the root render of `LiveClassRoomImpl` and the voice room page component with `<ErrorBoundary>`. The existing `ErrorBoundary` component already has the correct "Try Again" (reset) behavior.

```tsx
// frontend/src/components/live-class/LiveClassRoomImpl.tsx
// Wrap the top-level return:
return (
  <ErrorBoundary>
    {/* existing JSX */}
  </ErrorBoundary>
)

// frontend/src/app/(dashboard)/voice/[id]/page.tsx (or wherever the room renders)
return (
  <ErrorBoundary>
    <VoiceRoom ... />
  </ErrorBoundary>
)
```

**Files to modify:**
- `frontend/src/components/live-class/LiveClassRoomImpl.tsx` — wrap return with ErrorBoundary
- `frontend/src/app/(dashboard)/voice/[id]/page.tsx` (or equivalent) — wrap with ErrorBoundary

---

### D-13: Voice Store Stale State Reset (FE-004)

**Current state:** `voice.store.ts` `setActiveRoom()` resets most state but there is no explicit `resetRoom()` action. Voice room components don't call cleanup on unmount.

**Design:**
Add a `resetRoom` action to the voice store that delegates to `setActiveRoom(null)`. Call it in the voice room component's `useEffect` cleanup.

```ts
// In voice.store.ts, add to the store:
resetRoom: () => set({
  activeRoom: null,
  messages: [],
  speakingUsers: {},
  reactions: [],
  speakerQueue: [],
  pendingMicOffer: null,
  activeGiftEvents: [],
  isGiftPanelOpen: false,
  giftLeaderboard: [],
  isChatOpen: false,
  isHandQueueOpen: false,
  isWaitingListOpen: false,
}),
```

```tsx
// In the voice room root component:
const resetRoom = useVoiceStore(s => s.resetRoom);
useEffect(() => {
  return () => resetRoom();
}, [resetRoom]);
```

**Files to modify:**
- `frontend/src/store/voice.store.ts` — add `resetRoom` action
- Voice room page/component — add `useEffect` cleanup calling `resetRoom`

---

### D-14: useSocket Token Refresh Reconnect (FE-010)

**Current state:** `auth.store.ts` calls `updateSocketToken(accessToken)` when `setToken()` is called. The `socket.ts` file exports `updateSocketToken`.

**Design:**
The auth store already calls `updateSocketToken` on token refresh (`setToken` and `refreshToken`). We need to verify `socket.ts` `updateSocketToken` properly disconnects and reconnects with the new token.

```ts
// In frontend/src/lib/socket.ts, updateSocketToken should:
export function updateSocketToken(token: string) {
  const socket = getSocket();
  if (!socket) return;
  socket.auth = { token };
  if (socket.connected) {
    socket.disconnect().connect(); // reconnect with new token
  }
}
```

**Files to modify:**
- `frontend/src/lib/socket.ts` — ensure `updateSocketToken` disconnects and reconnects

---

### D-15: Skeleton Loading States (FE-003)

**Current state:** Loading states show blank content on leaderboard, marketplace, and voice room list pages.

**Design:**
Add skeleton loader components to the `isLoading` branch of affected pages. Use the existing Radix UI / shadcn skeleton pattern (likely `frontend/src/components/ui/skeleton.tsx`).

Target pages:
- `frontend/src/app/(dashboard)/voice/page.tsx` — room list loading state
- `frontend/src/app/(dashboard)/leaderboard/page.tsx` — leaderboard loading state
- `frontend/src/app/(dashboard)/marketplace/page.tsx` — marketplace loading state

Each page gets a `<RoomListSkeleton />`, `<LeaderboardSkeleton />`, or `<MarketplaceCardSkeleton />` component rendered when React Query's `isLoading` is true.

**Files to create:**
- `frontend/src/components/skeletons/RoomListSkeleton.tsx`
- `frontend/src/components/skeletons/LeaderboardSkeleton.tsx`
- `frontend/src/components/skeletons/MarketplaceCardSkeleton.tsx`

**Files to modify:**
- The 3 page files above — add `if (isLoading) return <XxxSkeleton />`

---

### D-16: Group Chat Message Virtualization (FE-005)

**Current state:** `group-chat/page.tsx` renders all messages in the DOM.

**Design:**
Replace the message list `<div>` with `react-window` `FixedSizeList` (already in dependencies). Use `useRef` for auto-scroll-to-bottom behavior.

```tsx
import { FixedSizeList } from 'react-window';

<FixedSizeList
  height={messageListHeight}
  itemCount={messages.length}
  itemSize={72}
  ref={listRef}
>
  {({ index, style }) => (
    <div style={style}>
      <MessageItem message={messages[index]} />
    </div>
  )}
</FixedSizeList>
```

**Files to modify:**
- `frontend/src/app/(dashboard)/group-chat/page.tsx` — replace message list with FixedSizeList

---

### D-17: next.config.js Remote Patterns (FE-008)

**Current state:** Next.js `Image` components may lack R2/Cloudflare domain configuration.

**Design:**
Add `remotePatterns` to `next.config.js`:

```js
images: {
  remotePatterns: [
    { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
    { protocol: 'https', hostname: '*.cloudflare.com' },
    { protocol: 'https', hostname: process.env.NEXT_PUBLIC_R2_PUBLIC_HOSTNAME || '' },
  ].filter(p => p.hostname),
},
```

**Files to modify:**
- `frontend/next.config.js` — add `images.remotePatterns`

---

### D-18: Offline PWA Fallback Page (FE-009)

**Current state:** `next-pwa` is in dependencies. No `/offline` page exists.

**Design:**
Add an offline fallback page and configure `next-pwa`:

```tsx
// frontend/src/app/offline/page.tsx
export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1>HALQA</h1>
        <p>You're offline. Please check your connection.</p>
        <button onClick={() => window.location.reload()}>Try Again</button>
      </div>
    </div>
  );
}
```

```js
// next.config.js — add pwa config
const withPWA = require('next-pwa')({ dest: 'public', fallbacks: { document: '/offline' } });
module.exports = withPWA({ /* existing config */ });
```

**Files to create:**
- `frontend/src/app/offline/page.tsx`

**Files to modify:**
- `frontend/next.config.js` — wrap with `withPWA`, add fallback

---

## Part 4 — Mobile

### D-19: Mobile HTTPS Enforcement (MOB-001)

**Current state:** `mobile/src/lib/api.ts` uses `BUILD_API_URL` which can be `http://localhost:5000/api/v1` in dev.

**Design:**
Add a URL validator in `api.ts` that blocks `http://` in production builds:

```ts
// In applyURLOverride() and in the initial api.create():
if (process.env.NODE_ENV === 'production' && _baseURL.startsWith('http://')) {
  throw new Error('HALQA: HTTPS is required in production builds. API URL must use https://');
}
// In __DEV__ mode: allow http://localhost and http://127.0.0.1 only
if (!__DEV__ && _baseURL.startsWith('http://')) {
  console.warn('HALQA: Non-HTTPS API URL detected in non-dev build. Blocking request.');
  // Return error response without making network call
}
```

**Files to modify:**
- `mobile/src/lib/api.ts` — add HTTPS enforcement guard

---

### D-20: Screen Capture Protection on Financial Screens (MOB-003)

**Current state:** `mobile/src/lib/security.ts` has `setScreenCaptureProtectionEnabled` but it's user-preference-based. Financial screens don't auto-enforce it.

**Design:**
Add a `useScreenProtection` hook and call it in financial screens:

```ts
// mobile/src/hooks/useScreenProtection.ts
import * as ScreenCapture from 'expo-screen-capture';
import { useEffect } from 'react';

export function useScreenProtection() {
  useEffect(() => {
    ScreenCapture.preventScreenCaptureAsync();
    return () => { ScreenCapture.allowScreenCaptureAsync(); };
  }, []);
}
```

```tsx
// In buy-coins.tsx, wallet-history.tsx, payout-request.tsx:
useScreenProtection();
```

**Files to create:**
- `mobile/src/hooks/useScreenProtection.ts`

**Files to modify:**
- `mobile/app/buy-coins.tsx`
- `mobile/app/wallet-history.tsx`
- `mobile/app/payout-request.tsx`

---

### D-21: Android Back-Handler in Live Screens (MOB-004)

**Current state:** No hardware back-button interception in voice room or live class screens.

**Design:**
Use React Native's `BackHandler` API with a confirmation Alert:

```ts
// mobile/src/hooks/useLeaveConfirmation.ts
import { BackHandler, Alert } from 'react-native';
import { useEffect } from 'react';

export function useLeaveConfirmation(onLeave: () => void, message = 'Leave session?') {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert('Leave', message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: onLeave },
      ]);
      return true; // prevent default back behavior
    });
    return () => sub.remove();
  }, [onLeave, message]);
}
```

**Files to create:**
- `mobile/src/hooks/useLeaveConfirmation.ts`

**Files to modify:**
- Voice room mobile screen — add `useLeaveConfirmation(handleLeave)`
- Live class mobile screen — add `useLeaveConfirmation(handleLeave)`

---

### D-22: Background Sync Exponential Backoff (MOB-005)

**Current state:** `backgroundSync.ts` fires every 15 minutes unconditionally with no retry backoff.

**Design:**
Add exponential backoff state in SecureStore. On each failed sync attempt, double the interval (30s → 60s → 120s → ... → 1800s max). Reset on success.

```ts
// mobile/src/lib/backgroundSync.ts
const BACKOFF_KEY = 'halqa_sync_backoff_seconds';
const MIN_INTERVAL = 30;
const MAX_INTERVAL = 1800; // 30 minutes

async function getSyncInterval(): Promise<number> {
  const stored = await SecureStore.getItemAsync(BACKOFF_KEY);
  return stored ? parseInt(stored, 10) : MIN_INTERVAL;
}
async function onSyncFailed() {
  const current = await getSyncInterval();
  const next = Math.min(current * 2, MAX_INTERVAL);
  await SecureStore.setItemAsync(BACKOFF_KEY, String(next));
}
async function onSyncSuccess() {
  await SecureStore.deleteItemAsync(BACKOFF_KEY);
}
```

**Files to modify:**
- `mobile/src/lib/backgroundSync.ts` — add backoff helpers, call on task result

---

### D-23: Push Token Refresh Listener (MOB-007)

**Current state:** `mobile/src/lib/notifications.ts` registers for push notifications once. No token rotation listener.

**Design:**
Add `addPushTokenListener` from `expo-notifications`:

```ts
// In notifications.ts, after registering:
Notifications.addPushTokenListener(async (tokenData) => {
  const newToken = tokenData.data;
  try {
    await api.patch('/users/fcm-token', { fcmToken: newToken });
  } catch (err) {
    // retry on next app open — stored locally
    await SecureStore.setItemAsync('halqa_pending_fcm_token', newToken);
  }
});
```

**Files to modify:**
- `mobile/src/lib/notifications.ts` — add push token rotation listener

---

### D-24: Offline Mutation Queue — React Query Integration (MOB-008)

**Current state:** `offline.ts` implements a custom queue with `getStoredJSON`/`setStoredJSON`. It does not use React Query's `networkMode` or `mmkv` persistence. Failed mutations are kept until the next sync attempt but there's no per-mutation retry-count tracking.

**Design:**
Enhance the existing `offline.ts` with:
1. Max queue size guard (500 mutations).
2. Per-action retry counter (stored alongside each action).
3. Discard after 3 failures + show user notification.
4. Continue using the existing queue storage pattern (no architecture change).

```ts
// In queueOfflineAction: check queue length
if (existing.length >= 500) {
  logEvent('offline_queue_full', { url: action.url });
  return; // silently drop
}

// In syncPendingActions: track failure counts
if (action.failCount >= 3) {
  // discard + notify
  showDiscardNotification(action.url);
  continue; // skip to next
}
remaining.push({ ...action, failCount: (action.failCount || 0) + 1 });
```

**Files to modify:**
- `mobile/src/lib/offline.ts` — add max queue, retry counter, discard logic

---

## Part 5 — Live Features

### D-25: LiveKit Reconnect Strategy (LV-003)

**Current state:** LiveKit SDK's reconnect behavior is not explicitly configured in `useLiveKit.ts` or `useLiveKitAudio.ts`.

**Design:**
Pass reconnect options when creating the `Room`:

```ts
// frontend/src/hooks/useLiveKit.ts
import { Room, RoomOptions } from 'livekit-client';

const room = new Room({
  adaptiveStream: true,
  dynacast: true,
  reconnectPolicy: {
    nextRetryDelayInMs: (context) => {
      if (context.retryCount > 5) return null; // stop after 5 retries (~30s total)
      return Math.min(1000 * Math.pow(2, context.retryCount), 16000);
    }
  }
} as RoomOptions);
```

Show reconnecting UI on `RoomEvent.Reconnecting` and `RoomEvent.Disconnected`.

**Files to modify:**
- `frontend/src/hooks/useLiveKit.ts` — add reconnect policy
- `mobile/src/hooks/useLiveKitAudio.ts` — add reconnect policy
- Live room UI components — handle `RoomEvent.Reconnecting` / `RoomEvent.Disconnected`

---

### D-26: Voice Room Audience Capacity Enforcement (LV-001)

**Current state:** `joinRoom()` checks `maxSpeakers` but has no audience capacity check against `roomLevel` tier limits.

**Design:**
The capacity map already exists in `voice.store.ts` as `ROOM_LEVEL_CAPACITY`. Duplicate the same values on the backend:

```js
// In voice.controller.js joinRoom(), before the participant upsert:
const LEVEL_CAPACITY = { 1:500, 2:1000, 3:2000, 4:3500, 5:5000, 6:8000, 7:12000, 8:18000, 9:25000, 10:50000 };
const maxCapacity = LEVEL_CAPACITY[room.roomLevel ?? 1] ?? 500;
const currentCount = await prisma.voiceParticipant.count({ where: { roomId, isActive: true } });
if (currentCount >= maxCapacity) {
  return errorResponse(res, `Room is full (${maxCapacity} participants)`, 403);
}
```

**Files to modify:**
- `backend/src/controllers/voice.controller.js` — add capacity check in `joinRoom()`

---

## Part 6 — DevOps & Testing

### D-27: Backup Verification (DO-001)

**Current state:** `docker-compose.prod.yml` `db-backup` service runs `mysqldump` but does not verify the output file.

**Design:**
Extend the backup shell script to verify the output:

```sh
# After writing $FILE:
if [ ! -s "$FILE" ]; then
  echo "ERROR: Backup file is empty: $FILE" >&2
  exit 1
fi
# Check gzip integrity
if ! gzip -t "$FILE" 2>/dev/null; then
  echo "ERROR: Backup file is corrupt: $FILE" >&2
  exit 1
fi
echo "Backup verified: $FILE ($(du -sh $FILE | cut -f1))"
```

If a `SLACK_WEBHOOK_URL` or `ALERT_EMAIL` env var is set, `curl`/`mail` an alert on failure.

**Files to modify:**
- `scripts/backup.sh` (or create it if it doesn't exist) — add verification step

---

### D-28: CI Integration Tests (DO-003)

**Current state:** `ci.yml` runs unit tests (mock-based) but no integration tests against a real database.

**Design:**
Add a new CI job `backend-integration` that spins up MySQL + Redis services, runs migrations, then executes integration tests:

```yaml
backend-integration:
  name: Backend — Integration Tests
  runs-on: ubuntu-latest
  services:
    mysql:
      image: mariadb:10.11
      env:
        MYSQL_ROOT_PASSWORD: test_root
        MYSQL_DATABASE: halqa_test
        MYSQL_USER: halqa_test
        MYSQL_PASSWORD: test_pass
      ports: ['3306:3306']
    redis:
      image: redis:7-alpine
      ports: ['6379:6379']
  steps:
    - uses: actions/checkout@v4
    - name: Run migrations
      run: npx prisma migrate deploy
      working-directory: backend
      env:
        DATABASE_URL: 'mysql://halqa_test:test_pass@localhost:3306/halqa_test'
    - name: Run integration tests
      run: npm run test:integration -- --ci
      working-directory: backend
      env:
        DATABASE_URL: 'mysql://halqa_test:test_pass@localhost:3306/halqa_test'
        REDIS_URL: 'redis://localhost:6379'
        JWT_SECRET: 'ci_integration_secret_32_chars_exactly'
```

Requires creating integration test files (see Testing section below).

**Files to modify:**
- `.github/workflows/ci.yml` — add `backend-integration` job

---

### D-29: Test Coverage — Financial Controllers (TE-001, TE-002, TE-003, TE-004, TE-005)

**Current state:** Tests exist for auth, stripe, gift, wallet (unit). Zero integration tests. Zero E2E. Zero load tests.

**Design:** Add the following test files:

```
backend/src/tests/
  integration/
    auth.integration.test.js      — register → login → refresh → logout
    gift.integration.test.js      — send gift → check wallet debits/credits
    voice.integration.test.js     — create room → join → capacity check → leave
frontend/e2e/
  auth.spec.ts                    — Playwright: login flow
  voice.spec.ts                   — Playwright: join/leave voice room
load-tests/
  room-join.js                    — k6: 100 concurrent room joins
  gift-send.js                    — k6: 50 concurrent gift sends
```

**Files to create:** All of the above (new files, no modifications to existing tests).

---

## Part 7 — UX / Accessibility

### D-30: Empty States (UX-002)

**Design:**
Create a reusable `EmptyState` component:

```tsx
// frontend/src/components/ui/empty-state.tsx
interface EmptyStateProps {
  icon: React.ReactNode;
  message: string;
  cta?: { label: string; onClick: () => void };
}
```

Apply to voice room list, marketplace, and community pages when data arrays are empty after loading.

**Files to create:**
- `frontend/src/components/ui/empty-state.tsx`

**Files to modify:**
- Voice room list page, marketplace page, community page

---

### D-31: Accessibility Labels (UX-005)

**Design:**
Audit all icon-only buttons in voice room controls, gift panel, and live class controls. Add `aria-label` to every button that renders only an icon with no visible text.

Stateful toggles must update their label:
```tsx
<button aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}>
  {isMuted ? <MicOff /> : <Mic />}
</button>
```

**Files to modify:** Voice room controls, gift panel, live class toolbar components.

---

### D-32: Mobile Keyboard Avoidance in Group Chat (UX-004)

**Design:**
Wrap the group chat screen input area in `KeyboardAvoidingView`:

```tsx
<KeyboardAvoidingView
  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
>
  {/* message list + input */}
</KeyboardAvoidingView>
```

**Files to modify:**
- Mobile group chat screen

---

## Implementation Sequencing

### Priority 1 — Security (do first, lowest risk)
1. D-9: Admin IP allowlist
2. D-10: File upload magic bytes + ClamAV
3. D-11: X-Content-Type-Options on uploads
4. D-19: Mobile HTTPS enforcement
5. D-20: Screen capture on financial screens
6. D-7: refreshToken field reduction

### Priority 2 — Reliability (highest user impact)
7. D-12: Error boundary on live components
8. D-13: Voice store stale state reset
9. D-14: Socket reconnect on token refresh
10. D-21: Android back-handler in live screens
11. D-25: LiveKit reconnect strategy
12. D-26: Voice room audience capacity

### Priority 3 — Performance & UX
13. D-8: getMe() caching
14. D-15: Skeleton loading states
15. D-16: Group chat virtualization
16. D-30: Empty states
17. D-31: Accessibility labels
18. D-32: Mobile keyboard avoidance

### Priority 4 — Infrastructure & Testing
19. D-1: Audit log archival
20. D-2: Orphaned gift transaction check
21. D-3: Input validation middleware
22. D-4: Bulk import row limit
23. D-5: Session middleware uncomment
24. D-6: OpenTelemetry re-enable
25. D-17: next.config.js remote patterns
26. D-18: PWA offline page
27. D-22: Background sync backoff
28. D-23: Push token refresh listener
29. D-24: Offline mutation queue improvements
30. D-27: Backup verification
31. D-28: CI integration tests
32. D-29: Test coverage additions

---

## Files Affected Summary

| File | Changes |
|---|---|
| `backend/src/app.js` | Uncomment session middleware; add nosniff header to uploads handler |
| `backend/src/controllers/auth.controller.js` | refreshToken field reduction; getMe() caching |
| `backend/src/controllers/voice.controller.js` | Audience capacity check in joinRoom() |
| `backend/src/controllers/import.controller.js` | Row count limit |
| `backend/src/controllers/user.controller.js` | Cache invalidation on profile update |
| `backend/src/workers/cleanup.worker.js` | Audit log archival job; orphaned gift check |
| `backend/src/middleware/validators/*.js` | New Zod validator files |
| `backend/src/middleware/ipAllowlist.js` | New file |
| `backend/src/routes/upload.routes.js` | Magic bytes + ClamAV |
| `backend/src/routes/backup.routes.js` | Add ipAllowlist |
| `backend/src/routes/audit.routes.js` | Add ipAllowlist |
| `backend/src/routes/analytics.routes.js` | Add ipAllowlist |
| `backend/src/routes/voice.routes.js` | Add voice validators |
| `backend/src/routes/gift.routes.js` | Add gift validators |
| `backend/package.json` | Add `file-type`, `@opentelemetry/*` packages |
| `frontend/src/store/voice.store.ts` | Add resetRoom() action |
| `frontend/src/lib/socket.ts` | Fix updateSocketToken disconnect/reconnect |
| `frontend/src/components/live-class/LiveClassRoomImpl.tsx` | Wrap with ErrorBoundary |
| `frontend/src/components/skeletons/*.tsx` | New skeleton components |
| `frontend/src/components/ui/empty-state.tsx` | New component |
| `frontend/next.config.js` | Add remotePatterns; add withPWA |
| `frontend/src/app/offline/page.tsx` | New offline fallback page |
| `mobile/src/lib/api.ts` | HTTPS enforcement |
| `mobile/src/lib/backgroundSync.ts` | Exponential backoff |
| `mobile/src/lib/offline.ts` | Queue max + retry counter |
| `mobile/src/lib/notifications.ts` | Push token rotation listener |
| `mobile/src/hooks/useScreenProtection.ts` | New hook |
| `mobile/src/hooks/useLeaveConfirmation.ts` | New hook |
| `mobile/app/buy-coins.tsx` | useScreenProtection |
| `mobile/app/wallet-history.tsx` | useScreenProtection |
| `mobile/app/payout-request.tsx` | useScreenProtection |
| `frontend/src/hooks/useLiveKit.ts` | Reconnect policy |
| `mobile/src/hooks/useLiveKitAudio.ts` | Reconnect policy |
| `.github/workflows/ci.yml` | Integration test job |
| `scripts/backup.sh` | Backup verification |

**Total: ~35 files modified or created. Zero destructive changes. Zero API contract changes. Zero schema drops.**
