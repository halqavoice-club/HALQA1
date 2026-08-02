# Implementation Plan

## Overview

32 incremental, backward-compatible improvements to the HALQA platform derived from the August 2026 audit. All changes are additive — no API contracts, database schemas, or existing migrations are modified destructively.

Tasks are grouped into 4 phases by priority. Each task is independently executable. The dependency graph below shows the safe execution order.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "tasks": ["1", "2", "3", "4", "5", "6"],
      "description": "Phase 1 — Security hardening, all independent"
    },
    {
      "wave": 2,
      "tasks": ["7", "8", "9", "10", "11", "12", "13", "14"],
      "description": "Phase 2 — Reliability improvements, all independent"
    },
    {
      "wave": 3,
      "tasks": ["15", "16", "17", "18", "19", "20", "21", "22"],
      "description": "Phase 3 — Performance and UX, all independent"
    },
    {
      "wave": 4,
      "tasks": ["23", "24", "25", "26", "27", "28", "29", "30", "32"],
      "description": "Phase 4 — Infrastructure, mostly independent"
    },
    {
      "wave": 5,
      "tasks": ["31"],
      "description": "Integration tests — depends on CI job (Task 30)"
    }
  ]
}
```

## Tasks

## Phase 1: Security Hardening

- [x] 1. Narrow refreshToken response to safe fields only
  - In `backend/src/controllers/auth.controller.js`, add a `REFRESH_USER_SELECT` constant that selects only `id`, `role`, `firstName`, `lastName`, `avatarUrl`, `schoolId`
  - Update the `refreshToken()` function to use `include: { user: { select: REFRESH_USER_SELECT } }` instead of `include: { user: true }`
  - Remove the `const { passwordHash, ...u } = user` spread pattern from refreshToken response — the select already excludes passwordHash, fcmToken, twoFactorEnabled, phoneVerified
  - Verify the P2002 concurrent-refresh path also returns only safe fields
  - **Requirements:** 8.7
  - **Files:** `backend/src/controllers/auth.controller.js`

- [x] 2. Create admin IP allowlist middleware
  - Create `backend/src/middleware/ipAllowlist.js` that reads `ADMIN_IP_ALLOWLIST` env var (comma-separated IPs/CIDRs), returns 403 for non-matching IPs, and passes through when the env var is empty
  - Apply `router.use(ipAllowlist)` at the top of `backend/src/routes/backup.routes.js`, `audit.routes.js`, and `analytics.routes.js`
  - Add `ADMIN_IP_ALLOWLIST=` (empty default) to `.env.example` and `.env.production.example`
  - **Requirements:** 10.1, 10.2
  - **Files:** `backend/src/middleware/ipAllowlist.js` (new), `backend/src/routes/backup.routes.js`, `backend/src/routes/audit.routes.js`, `backend/src/routes/analytics.routes.js`

- [x] 3. Add file upload magic bytes validation and ClamAV scanning
  - Add `"file-type": "16.5.4"` to `backend/package.json` dependencies (CJS-compatible version)
  - In `backend/src/routes/upload.routes.js`, after Multer processes the file, call `fileTypeFromBuffer(req.file.buffer)` and reject with HTTP 400 if the detected MIME type is not in the allowed list
  - Wire `clamav.scanBuffer(req.file.buffer)` after magic-byte validation — only when `clamav.isEnabled()` returns true; reject with HTTP 400 on positive scan result
  - Apply the same validation to the `/multiple` route for each file in `req.files`
  - **Requirements:** 10.3, 10.4, 10.5
  - **Files:** `backend/package.json`, `backend/src/routes/upload.routes.js`

- [x] 4. Add X-Content-Type-Options header to uploads static handler
  - In `backend/src/app.js`, inside the existing `app.use('/uploads', ...)` middleware block, add `res.setHeader('X-Content-Type-Options', 'nosniff')` before calling `next()`
  - This is a one-line addition to the existing uploads CORS handler
  - **Requirements:** 10.6
  - **Files:** `backend/src/app.js`

- [x] 5. Enforce HTTPS-only URLs in mobile API client
  - In `mobile/src/lib/api.ts`, add a validation function `assertHttps(url: string)` that throws/logs when the URL starts with `http://` in non-`__DEV__` builds
  - Call `assertHttps` in `applyURLOverride()` and in the initial `BUILD_API_URL` assignment for production builds
  - In `__DEV__` mode, allow `http://localhost` and `http://127.0.0.1` only — reject other `http://` targets
  - **Requirements:** 15.1, 15.2
  - **Files:** `mobile/src/lib/api.ts`

- [x] 6. Add screen capture protection to financial screens
  - Create `mobile/src/hooks/useScreenProtection.ts` that calls `ScreenCapture.preventScreenCaptureAsync()` on mount and `ScreenCapture.allowScreenCaptureAsync()` on unmount using `expo-screen-capture`
  - Add `useScreenProtection()` call inside the component body of `mobile/app/buy-coins.tsx`, `mobile/app/wallet-history.tsx`, and `mobile/app/payout-request.tsx`
  - **Requirements:** 15.3, 15.4
  - **Files:** `mobile/src/hooks/useScreenProtection.ts` (new), `mobile/app/buy-coins.tsx`, `mobile/app/wallet-history.tsx`, `mobile/app/payout-request.tsx`


## Phase 2: Reliability Improvements

- [x] 7. Uncomment session middleware in app.js
  - In `backend/src/app.js`, remove the comment markers from `// app.use(sessionMiddleware.middleware); // Temporarily disabled`
  - The `sessionMiddleware.middleware` export is already a safe no-op pass-through — no functional change occurs; this simply re-activates the exported function
  - Verify the server starts without errors after this change
  - **Requirements:** 5.2, 5.5
  - **Files:** `backend/src/app.js`

- [x] 8. Re-enable OpenTelemetry tracing
  - Add `"@opentelemetry/sdk-node": "0.52.1"` and `"@opentelemetry/auto-instrumentations-node": "0.48.0"` to `backend/package.json` dependencies with exact versions
  - In `backend/src/app.js`, uncomment `// const tracing = require('./utils/tracing');` and `// tracing.initialize().catch(...)` in the enterprise feature initialization block
  - Verify `backend/src/utils/tracing.js` exists and exports `initialize()` — if missing, create a minimal stub that logs a warning
  - **Requirements:** 5.3, 5.4
  - **Files:** `backend/package.json`, `backend/src/app.js`

- [x] 9. Wrap live class and voice room components with Error Boundary
  - In `frontend/src/components/live-class/LiveClassRoomImpl.tsx`, import `ErrorBoundary` from `@/components/error-boundary` and wrap the entire component return in `<ErrorBoundary>`
  - Find the voice room root page component (likely `frontend/src/app/(dashboard)/voice/[id]/page.tsx`) and wrap its render with `<ErrorBoundary>`
  - The existing `ErrorBoundary` component already has the correct "Try Again" reset button — no changes needed to the component itself
  - **Requirements:** 13.1, 13.2
  - **Files:** `frontend/src/components/live-class/LiveClassRoomImpl.tsx`, voice room page component

- [x] 10. Add resetRoom action to voice store and call on unmount
  - In `frontend/src/store/voice.store.ts`, add `resetRoom: () => void` to the `VoiceState` interface
  - Implement `resetRoom` in the store that sets `activeRoom: null`, `messages: []`, `speakingUsers: {}`, `reactions: []`, `speakerQueue: []`, `pendingMicOffer: null`, `activeGiftEvents: []`, `isGiftPanelOpen: false`, `giftLeaderboard: []`, `isChatOpen: false`, `isHandQueueOpen: false`, `isWaitingListOpen: false`
  - In the voice room page component, add `const resetRoom = useVoiceStore(s => s.resetRoom)` and call it in a `useEffect` cleanup: `useEffect(() => () => resetRoom(), [resetRoom])`
  - **Requirements:** 13.3
  - **Files:** `frontend/src/store/voice.store.ts`, voice room page component

- [x] 11. Fix socket reconnect on token refresh
  - In `frontend/src/lib/socket.ts`, update the `updateSocketToken(token: string)` function to call `socket.auth = { token }` followed by `socket.disconnect().connect()` when the socket is currently connected
  - If the socket is not yet connected, only update `socket.auth` — do not force a reconnect
  - The `auth.store.ts` already calls `updateSocketToken` on every `setToken()` and `refreshToken()` call — no changes needed there
  - **Requirements:** 13.4, 13.5
  - **Files:** `frontend/src/lib/socket.ts`

- [x] 12. Add Android back-handler hook and apply to mobile live screens
  - Create `mobile/src/hooks/useLeaveConfirmation.ts` that uses `BackHandler.addEventListener('hardwareBackPress', ...)` to intercept the Android back button, shows an `Alert.alert` confirmation dialog, and calls `onLeave()` only if the user confirms
  - Apply `useLeaveConfirmation(handleLeave, 'Leave this session?')` to the voice room mobile screen and the live class mobile screen
  - **Requirements:** 15.6, 15.7, 15.8
  - **Files:** `mobile/src/hooks/useLeaveConfirmation.ts` (new), mobile voice room screen, mobile live class screen

- [x] 13. Add LiveKit reconnect policy to frontend and mobile
  - In `frontend/src/hooks/useLiveKit.ts`, pass `reconnectPolicy` to the `Room` constructor with exponential backoff starting at 1s, doubling up to 16s, stopping after 5 retries
  - Handle `RoomEvent.Reconnecting` to show a "Reconnecting…" indicator in the live room UI
  - Handle `RoomEvent.Disconnected` (after reconnect exhaustion) to show a "Session ended" message with a rejoin button
  - Apply the same reconnect policy to `mobile/src/hooks/useLiveKitAudio.ts`
  - **Requirements:** 17.4, 17.5, 17.6, 17.7, 17.8
  - **Files:** `frontend/src/hooks/useLiveKit.ts`, `mobile/src/hooks/useLiveKitAudio.ts`

- [x] 14. Add audience capacity enforcement in joinRoom
  - In `backend/src/controllers/voice.controller.js`, in the `joinRoom()` function, after confirming the room exists and is not ENDED, count current active participants with `prisma.voiceParticipant.count({ where: { roomId, isActive: true } })`
  - Define the capacity map `{ 1:500, 2:1000, 3:2000, 4:3500, 5:5000, 6:8000, 7:12000, 8:18000, 9:25000, 10:50000 }` and look up the limit by `room.roomLevel ?? 1`
  - If `currentCount >= maxCapacity`, return `errorResponse(res, 'Room is full (${maxCapacity} participants)', 403)`
  - **Requirements:** 17.1, 17.2
  - **Files:** `backend/src/controllers/voice.controller.js`


## Phase 3: Performance and UX

- [x] 15. Add getMe() response caching with invalidation
  - In `backend/src/controllers/auth.controller.js`, in `getMe()`, check Redis for key `user:me:${req.user.id}` (60s TTL) before querying the DB — return cached result if hit
  - After a DB hit, store the result in Redis with 60s TTL
  - Wrap Redis operations in try/catch so a Redis failure falls back to DB without returning an error
  - In `backend/src/controllers/user.controller.js`, after any user profile update, call `deleteCache('user:me:${userId}')` to invalidate the cache
  - **Requirements:** 18.3, 18.4, 18.5
  - **Files:** `backend/src/controllers/auth.controller.js`, `backend/src/controllers/user.controller.js`

- [x] 16. Create skeleton loading components and apply to three pages
  - Create `frontend/src/components/skeletons/RoomListSkeleton.tsx` — renders a grid of placeholder room cards matching the room list layout using the existing `Skeleton` UI component
  - Create `frontend/src/components/skeletons/LeaderboardSkeleton.tsx` — renders placeholder leaderboard rows
  - Create `frontend/src/components/skeletons/MarketplaceCardSkeleton.tsx` — renders placeholder product cards
  - In the voice room list page, leaderboard page, and marketplace page, replace the blank loading state (`if (isLoading) return null` or similar) with the appropriate skeleton component
  - **Requirements:** 14.1
  - **Files:** `frontend/src/components/skeletons/RoomListSkeleton.tsx` (new), `frontend/src/components/skeletons/LeaderboardSkeleton.tsx` (new), `frontend/src/components/skeletons/MarketplaceCardSkeleton.tsx` (new), voice list page, leaderboard page, marketplace page

- [x] 17. Virtualize group chat message list
  - In `frontend/src/app/(dashboard)/group-chat/page.tsx`, replace the current message list render with a `FixedSizeList` from `react-window`
  - Calculate the container height dynamically using a `useRef` on the container div and a `ResizeObserver` or `useEffect` measurement
  - Render each message row via the `FixedSizeList` render prop — pass `style` from the row renderer to the outer div for correct positioning
  - Implement auto-scroll-to-bottom using `listRef.current.scrollToItem(messages.length - 1)` when new messages arrive
  - Activate virtualization only when message count exceeds 100 — below that threshold render the list normally to avoid overhead
  - **Requirements:** 14.2
  - **Files:** `frontend/src/app/(dashboard)/group-chat/page.tsx`

- [x] 18. Add R2 and Cloudflare remote patterns to next.config.js
  - In `frontend/next.config.js`, add an `images.remotePatterns` array that includes entries for `*.r2.cloudflarestorage.com`, `*.cloudflare.com`, and the value of `NEXT_PUBLIC_R2_PUBLIC_HOSTNAME` env var if set
  - Filter out entries with empty hostnames to avoid Next.js config errors
  - **Requirements:** 14.5
  - **Files:** `frontend/next.config.js`

- [x] 19. Add PWA offline fallback page
  - Create `frontend/src/app/offline/page.tsx` with an application-branded layout, an offline status message, and a "Try again" button that calls `window.location.reload()`
  - In `frontend/next.config.js`, wrap the config export with `withPWA` from `next-pwa` and set `fallbacks: { document: '/offline' }` and `dest: 'public'`
  - **Requirements:** 14.6
  - **Files:** `frontend/src/app/offline/page.tsx` (new), `frontend/next.config.js`

- [x] 20. Create EmptyState component and apply to key pages
  - Create `frontend/src/components/ui/empty-state.tsx` with props: `icon`, `message` (string), and optional `cta: { label: string; onClick: () => void }`
  - Apply the `EmptyState` component to the voice room list page when the rooms array is empty after loading (with CTA "Start a room"), marketplace page when products are empty (with CTA "List an item"), and community page when communities are empty (with CTA "Create a community")
  - Only show the empty state after loading completes — not during the loading state
  - **Requirements:** 14.7
  - **Files:** `frontend/src/components/ui/empty-state.tsx` (new), voice room list page, marketplace page, community page

- [x] 21. Add accessibility labels to icon-only interactive elements
  - Audit all icon-only buttons in the voice room controls (mic toggle, camera toggle, hand raise, leave button), gift panel (send gift button, close button), and live class toolbar
  - Add `aria-label` to each button with a descriptive label that matches the action
  - For stateful toggles (mic muted/unmuted), make the `aria-label` dynamic: `aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}`
  - In mobile, add matching `accessibilityLabel` props to the same controls in `Pressable` and `TouchableOpacity` elements
  - **Requirements:** 21.1, 21.2
  - **Files:** Voice room control components, gift panel component, live class toolbar component, corresponding mobile components

- [x] 22. Add keyboard avoidance in mobile group chat
  - In the mobile group chat screen component, wrap the message list and input area in `KeyboardAvoidingView` with `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}` and `keyboardVerticalOffset` set per platform
  - Ensure the message input field remains visible and not occluded by the software keyboard on both iOS and Android
  - **Requirements:** 21.3
  - **Files:** Mobile group chat screen


## Phase 4: Infrastructure and Maintenance

- [x] 23. Add audit log archival and orphaned gift check to cleanup worker
  - In `backend/src/workers/cleanup.worker.js`, add a new job handler for `'audit-log-archival'` that: queries `audit_logs` where `createdAt < now - 1 year`, exports them as gzipped JSON to R2 using existing `storage.js` utilities, and only deletes the exported rows if the upload succeeds
  - Add a second job handler for `'orphaned-gift-check'` that runs a raw SQL count of `gift_transactions` whose `roomId` does not exist in `voice_rooms` (for `roomType='voice'`) or `live_classes` (for `roomType='live_class'`) and logs the count without deleting anything
  - Schedule the audit archival job monthly (1st at 05:00 UTC) and the orphaned gift check weekly (Sunday at 04:00 UTC) via the existing `jobScheduler` in `backend/src/services/queue.service.js`
  - If any job encounters an error, log the job name, error message, stack trace, and UTC timestamp, then continue — do not crash the worker
  - **Requirements:** 3.4, 3.5, 3.6, 3.7
  - **Files:** `backend/src/workers/cleanup.worker.js`, `backend/src/services/queue.service.js`

- [x] 24. Create Zod input validation middleware for voice, gift, liveClass, import, and marketplace routes
  - Create `backend/src/middleware/validators/` directory
  - Create `voice.validator.js` with Zod schemas for createRoom (title max 100, description max 500, privacy enum, maxSpeakers 2-50), updateRoom, and sendMessage (body max 2000)
  - Create `gift.validator.js` with Zod schemas for sendGift (giftId UUID, receiverId UUID, count int 1-100) and sendGiftToAll (giftId UUID, count int 1-100)
  - Create `liveClass.validator.js` with Zod schemas for create and update live class (title max 100, description max 500)
  - Create `import.validator.js` that validates file presence and applies the row count check
  - Create `marketplace.validator.js` with Zod schemas for product create/update (title max 100, description max 500, price positive decimal)
  - Apply the validators to the respective route files using the existing `validate(schema)` middleware pattern from `backend/src/middleware/validate.js`
  - When a request passes validation, the controller receives the request unchanged with all existing response formats preserved
  - **Requirements:** 4.1, 4.2, 4.3, 4.4, 4.5
  - **Files:** `backend/src/middleware/validators/voice.validator.js` (new), `gift.validator.js` (new), `liveClass.validator.js` (new), `import.validator.js` (new), `marketplace.validator.js` (new), `backend/src/routes/voice.routes.js`, `backend/src/routes/gift.routes.js`, `backend/src/routes/live-class.routes.js`, `backend/src/routes/marketplace.routes.js`

- [x] 25. Add bulk import row count limit
  - In `backend/src/controllers/import.controller.js`, after parsing the uploaded CSV or Excel file into rows and before performing any database inserts, check if `rows.length > 1000`
  - If the count exceeds 1000, return `errorResponse(res, 'Import exceeds the maximum of 1000 rows. Split into batches of 1000 or fewer.', 400)` immediately without touching the database
  - **Requirements:** 4.6
  - **Files:** `backend/src/controllers/import.controller.js`

- [x] 26. Add exponential backoff to mobile background sync
  - In `mobile/src/lib/backgroundSync.ts`, add helper functions `getSyncBackoffSeconds()`, `onSyncSuccess()`, and `onSyncFailed()` using `SecureStore` to persist the current backoff interval
  - Start at 30 seconds, double on each failure up to a maximum of 1800 seconds (30 minutes), reset to 30 seconds on success
  - In the `BACKGROUND_SYNC_TASK` definition, call `onSyncSuccess()` when `syncPendingActions()` returns `true`, and `onSyncFailed()` when it throws or returns `false`
  - **Requirements:** 16.1
  - **Files:** `mobile/src/lib/backgroundSync.ts`

- [x] 27. Add push token refresh listener in mobile notifications
  - In `mobile/src/lib/notifications.ts`, after the existing push notification registration logic, add `Notifications.addPushTokenListener(async (tokenData) => { ... })` from `expo-notifications`
  - In the listener callback, call `api.patch('/users/fcm-token', { fcmToken: tokenData.data })` to update the token on the backend
  - If the API call fails, store the new token in SecureStore under key `halqa_pending_fcm_token` for retry on next app open
  - **Requirements:** 16.6
  - **Files:** `mobile/src/lib/notifications.ts`

- [x] 28. Improve offline mutation queue with max cap and retry counting
  - In `mobile/src/lib/offline.ts`, update the `OfflineAction` type to include `failCount?: number`
  - In `queueOfflineAction()`, check if the existing queue length is already 500 or more — if so, log an event and return without queuing the action
  - In `syncPendingActions()`, for each failed action, check if `action.failCount >= 3` — if so, discard the action (do not re-queue) and show a user notification indicating the action could not be completed; otherwise, re-queue with `failCount: (action.failCount || 0) + 1`
  - **Requirements:** 16.3, 16.4
  - **Files:** `mobile/src/lib/offline.ts`

- [x] 29. Add backup file verification to backup script
  - In `scripts/backup.sh` (create the file if it does not exist, using the inline backup logic from `docker-compose.prod.yml` as the base), add verification steps after the `gzip` write completes:
    - Check `[ ! -s "$FILE" ]` and exit with error message if the file is empty
    - Run `gzip -t "$FILE"` to verify integrity and exit with error message if it fails
    - If `SLACK_WEBHOOK_URL` is set in the environment, `curl` a failure notification to it on any error
    - Log success with file size on completion
  - **Requirements:** 19.4
  - **Files:** `scripts/backup.sh` (new or modify)

- [x] 30. Add integration test CI job to ci.yml
  - In `.github/workflows/ci.yml`, add a new job `backend-integration` that runs after `backend` and `backend-tests` jobs
  - Configure MySQL (mariadb:10.11) and Redis (redis:7-alpine) as GitHub Actions services with health checks
  - Add steps to: install backend dependencies, run `npx prisma migrate deploy` against the test DB, then run `npm run test:integration -- --ci`
  - If any test fails, the job must exit with a non-zero status and block the Docker build step
  - Add `"test:integration": "jest --runInBand --forceExit --testPathPattern='integration'"` to `backend/package.json` scripts
  - **Requirements:** 19.3, 20.9
  - **Files:** `.github/workflows/ci.yml`, `backend/package.json`

- [x] 31. Create backend integration tests for auth, gift, and voice controllers
  - Create `backend/src/tests/integration/auth.integration.test.js` — tests for: register with valid data, register with weak password (HTTP 400), login with wrong password increments lockout counter, login locked after 5 failures (HTTP 429), successful login resets counter, refresh token, logout
  - Create `backend/src/tests/integration/gift.integration.test.js` — tests for: send single gift (wallet debit + receiver credit), send gift to all speakers (batch processing, all credited), insufficient balance (HTTP 402), idempotent duplicate send returns existing transaction
  - Create `backend/src/tests/integration/voice.integration.test.js` — tests for: create room, join room within capacity, join room at capacity returns HTTP 403, leave room
  - Each test file uses a real test database (configured via environment), runs migrations before tests, and cleans up test data after each test
  - **Requirements:** 20.1, 20.2, 20.3, 20.4, 20.5, 20.9
  - **Files:** `backend/src/tests/integration/auth.integration.test.js` (new), `backend/src/tests/integration/gift.integration.test.js` (new), `backend/src/tests/integration/voice.integration.test.js` (new)

- [x] 32. Create Playwright E2E tests for critical user flows
  - Create `frontend/e2e/` directory with `playwright.config.ts` configured to run against `http://localhost:3000`
  - Create `frontend/e2e/auth.spec.ts` — login flow: navigate to login page, fill credentials, submit, assert dashboard is visible, assert user name appears in header
  - Create `frontend/e2e/voice.spec.ts` — voice room join/leave: navigate to voice page, assert room list loads, click join on a room, assert room UI is visible, click leave, assert back on room list
  - Create `frontend/e2e/purchase.spec.ts` — coin purchase: navigate to wallet, click buy coins, assert Stripe checkout page loads or purchase modal appears
  - Create `frontend/e2e/live-class.spec.ts` — live class creation: navigate to live classes as teacher, click create, fill title, submit, assert live class appears in list
  - Each test asserts key state transitions and must complete without errors
  - **Requirements:** 20.6
  - **Files:** `frontend/e2e/playwright.config.ts` (new), `frontend/e2e/auth.spec.ts` (new), `frontend/e2e/voice.spec.ts` (new), `frontend/e2e/purchase.spec.ts` (new), `frontend/e2e/live-class.spec.ts` (new)


## Notes

- Every task preserves 100% backward compatibility — no API contracts, response shapes, database table names, Prisma model names, column names, or existing migrations are changed
- Redis operations in caching tasks must use try/catch with DB fallback so Redis unavailability never returns an error to clients
- Financial transaction logic (gift send, wallet debit/credit) must not be altered — only additive changes around it
- The `biometrics.ts` file already has `disableDeviceFallback: true` and `fallbackLabel: 'Use passcode'` — Task 6 does not need to change it, only the screen protection hook is new
- Tasks 9 and 10 both touch the voice room page component — coordinate file edits to avoid conflicts when running concurrently
- Task 30 (CI job) must be merged before Task 31 (integration tests) since the job needs the test script to exist
- Load tests (k6/Artillery) from Requirement 20.7 are optional and not included in the main task list — they can be added as a follow-up after integration tests pass
