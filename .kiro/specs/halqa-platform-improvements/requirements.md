# Requirements Document

## Introduction

This document defines the incremental improvement requirements for the HALQA platform, derived from the Full Audit Report dated August 1, 2026. HALQA is a production enterprise platform combining a school ERP with a social/live platform (Voice Club, Live Classes, Marketplace, Creator Economy).

All improvements in this spec are **additive and backward-compatible**. No existing API contracts, response formats, database table names, Prisma model names, column names, or migration files will be modified destructively. Every change must be safe to deploy to production without downtime or data loss.

**Stack:** Node.js + Express + Prisma + MySQL + Redis + Socket.IO + LiveKit + Next.js 14 + React Native + Expo

---

## Glossary

- **Platform**: The HALQA application comprising backend, web frontend, and mobile app
- **Backend**: The Node.js + Express + Prisma server (`backend/`)
- **Frontend**: The Next.js 14 web application (`frontend/`)
- **Mobile**: The React Native + Expo application (`mobile/`)
- **Cleanup_Worker**: The `backend/src/workers/cleanup.worker.js` cron job scheduler
- **Voice_Controller**: The `backend/src/controllers/voice.controller.js` module handling voice room operations
- **Gift_Controller**: The `backend/src/controllers/gift.controller.js` module handling gift transactions
- **Auth_Controller**: The `backend/src/controllers/auth.controller.js` module handling authentication
- **Dashboard_Controller**: The `backend/src/controllers/dashboard.controller.js` module handling dashboard data
- **Redis_Cache**: The ioredis-backed caching layer used across the Platform
- **LiveKit**: The real-time media server SDK used for voice rooms and live classes
- **Prisma**: The ORM layer connecting the Backend to MySQL
- **Migration**: A Prisma database migration file that adds indexes or schema elements additively
- **Validator**: A Zod-based input validation middleware applied at the route level
- **Socket_IO**: The WebSocket server (socket.io) used for real-time communication
- **Auth_Store**: The Zustand auth state store in `frontend/src/store/auth.store.ts`
- **Voice_Store**: The Zustand voice state store in `frontend/src/store/voice.store.ts`
- **Error_Boundary**: The React error boundary component in `frontend/src/components/error-boundary.tsx`
- **Background_Sync**: The `mobile/src/lib/backgroundSync.ts` background fetch module
- **Offline_Manager**: The `mobile/src/lib/offline.ts` offline state management module

---

## Requirements

### Requirement 1: Database Index Optimization

**User Story:** As a platform operator, I want critical database queries to use composite indexes, so that room listing, leaderboard, and attendance queries remain fast as data volume grows.

#### Acceptance Criteria

1. WHEN the Migration for voice room indexes is deployed, THE Platform SHALL add a composite index on `voice_rooms(status, privacy, schoolId)` without modifying any existing index or column.
2. WHEN the Migration for gift transaction indexes is deployed, THE Platform SHALL add a composite index on `gift_transactions(createdAt, senderId)` without modifying any existing index or column.
3. WHEN the Migration for enrollment indexes is deployed, THE Platform SHALL add a composite index on `enrollments(studentId, classId, isActive)` without modifying any existing index or column.
4. WHEN a Migration is deployed, THE Platform SHALL execute it using `prisma migrate deploy` and all existing queries that ran correctly before the migration SHALL continue to return correct results after the migration.
5. WHEN a Migration for a new index is deployed, THE Platform SHALL not alter any existing column definition, existing index, or table structure other than adding the new index.
6. IF a Migration fails during deployment, THEN THE Platform SHALL leave the database in the exact schema state it was in before migration initiation, with no new index partially or fully created.

---

### Requirement 2: Database Connection Pool Configuration

**User Story:** As a platform operator, I want the database connection pool to be properly sized for production load, so that high-concurrency requests do not queue waiting for a database connection.

#### Acceptance Criteria

1. WHEN the Backend starts, THE Prisma SHALL use a connection pool with a ceiling of 25 connections as configured via `connection_limit=25` in the `DATABASE_URL` parameter.
2. WHEN a connection cannot be obtained from the pool within 10 seconds, THE Prisma SHALL reject the operation and return an error to the caller rather than waiting indefinitely.
3. WHEN pool settings are applied, THE Platform SHALL configure them exclusively via environment variable or Prisma datasource URL parameters, leaving all existing Prisma models, migration files, and API response shapes unchanged.
4. IF the Backend starts and the `DATABASE_URL` environment variable does not include `connection_limit`, THEN THE Platform SHALL emit a warning-level log entry stating that the connection pool size has not been explicitly configured and recommending the parameter be added.

---

### Requirement 3: Database Cleanup Cron Jobs

**User Story:** As a platform operator, I want stale database records to be cleaned up automatically, so that table growth does not degrade query performance over time.

#### Acceptance Criteria

1. WHEN the Cleanup_Worker runs its notification cleanup job (daily at 02:00 UTC), THE Platform SHALL delete `notifications` records where `isRead = true` AND `createdAt` is older than 90 days AND `type` is NOT IN (`SYSTEM`, `COINS_PURCHASED`, `GRADE`).
2. WHEN the Cleanup_Worker runs its OTP cleanup job (every 6 hours), THE Platform SHALL delete `otp_codes` records where `isUsed = true` OR `expiresAt` is older than 24 hours from the current time.
3. WHEN the Cleanup_Worker runs its refresh token cleanup job (daily at 03:00 UTC), THE Platform SHALL delete `refresh_tokens` records where `isRevoked = true` OR `expiresAt` is older than 7 days from the current time.
4. WHEN the Cleanup_Worker runs its orphaned gift transaction check (weekly on Sunday at 04:00 UTC), THE Platform SHALL log a count of `gift_transactions` with no matching room but SHALL NOT delete any records.
5. WHEN the Cleanup_Worker runs its audit log archival job (monthly on the 1st at 05:00 UTC) and the export to R2/cold storage succeeds, THE Platform SHALL delete the exported `audit_logs` records from MySQL. IF the export fails, THE Platform SHALL not delete any records and SHALL log the failure.
6. IF any cleanup job encounters an error, THEN THE Cleanup_Worker SHALL log an entry containing: the job name, the error message, the full stack trace, and the UTC timestamp of the failure, then continue executing the remaining scheduled jobs.
7. THE Cleanup_Worker SHALL execute all scheduled jobs asynchronously so that job execution does not block or delay the handling of API requests.

---

### Requirement 4: Backend Input Validation

**User Story:** As a security engineer, I want all controller routes to validate input with Zod schemas, so that malformed or oversized input is rejected before it reaches the database or business logic layer.

#### Acceptance Criteria

1. THE Validator SHALL enforce Zod schemas on all POST, PUT, and PATCH routes for voice, gift, auth, live class, marketplace, and import controllers.
2. WHEN a request body contains a field that fails Zod validation, THE Validator SHALL return HTTP 400 with a JSON response body containing an `errors` array where each element includes the field name and a human-readable error message, without processing the request further.
3. THE Validator SHALL reject the following string fields if they exceed their maximum lengths: room title (100 chars), room description (500 chars), user bio (300 chars), message content (2000 chars), community name (100 chars), and community description (500 chars), returning HTTP 400.
4. THE Validator SHALL reject any field declared as a UUID if the value does not match UUID v4 format, returning HTTP 400.
5. WHEN a valid request is received, THE Validator SHALL pass the request to the controller with the parsed body unchanged and all existing API response formats SHALL be preserved.
6. WHEN the bulk import endpoint receives a request, THE Platform SHALL parse the uploaded file first, count the rows, and reject the request with HTTP 400 and the message "Import exceeds the maximum of 1000 rows" if the row count exceeds 1000, before performing any database operations.

---

### Requirement 5: Backend Security Middleware Re-enablement

**User Story:** As a security engineer, I want all previously disabled security middleware to be re-enabled, so that the platform's defense-in-depth layers are fully active.

#### Acceptance Criteria

1. WHEN the Backend starts, THE Platform SHALL enable `deviceRateLimiter.middleware` on all API routes, limiting each device fingerprint to no more than 100 requests per 15-minute window.
2. WHEN the Backend starts, THE Platform SHALL enable `sessionMiddleware.middleware`, and existing JWT-authenticated requests SHALL continue to succeed without modification to their request headers or response bodies.
3. WHEN the Backend starts and `@opentelemetry/sdk-node` is installed, THE Platform SHALL initialize and enable OpenTelemetry tracing so that trace spans appear in the configured exporter.
4. IF `deviceRateLimiter` encounters an initialization error on startup, THEN THE Platform SHALL log the error at ERROR level and continue starting up rather than crashing, with all other middleware remaining active.
5. IF `sessionMiddleware` encounters an initialization error on startup, THEN THE Platform SHALL log the error at ERROR level and continue starting up rather than crashing.
6. WHEN `deviceRateLimiter`, `sessionMiddleware`, and OpenTelemetry tracing are all active, THE Platform SHALL not add any fields to existing API response bodies and SHALL not change any HTTP status codes for valid requests.


---

### Requirement 6: Voice Room Performance Optimization

**User Story:** As a platform operator, I want voice room join and list operations to be optimized, so that concurrent room joins and room discovery remain fast under high load.

#### Acceptance Criteria

1. WHEN a user joins a voice room, THE Voice_Controller SHALL complete the join flow using no more than 3 sequential database round-trips, combining the room lookup and status sync into a single transaction.
2. WHEN the room member membership check is performed during a join, THE Voice_Controller SHALL cache the result in Redis with a 30-second TTL keyed by the user-room pair, and use the cached result on subsequent checks within that window.
3. WHEN a request is made to list voice rooms for a school and a valid cache entry exists, THE Voice_Controller SHALL serve the response from Redis without querying the database, with a maximum TTL of 10 seconds per school.
4. WHEN a room is created, joined, or ended, THE Voice_Controller SHALL delete the school's room list cache entry so the next list request fetches fresh data.
5. IF a Redis operation fails due to a connection error or timeout, THEN THE Voice_Controller SHALL fall back to querying the database directly and SHALL return the correct data response to the client without returning an error.

---

### Requirement 7: Gift System Reliability

**User Story:** As a user, I want gift transactions to complete reliably even in large rooms, so that senders are never debited without all receivers being credited.

#### Acceptance Criteria

1. WHEN `sendGiftToAll()` is called in a room with more than 10 users currently holding a speaker slot, THE Gift_Controller SHALL process receiver wallet credits in sequential batches of 10 rather than in a single transaction containing all receivers.
2. WHEN a gift-to-all transaction batch is processed, THE Gift_Controller SHALL use a Prisma transaction timeout of 30,000 milliseconds instead of the default 5,000 milliseconds.
3. WHEN the combo detection Redis cache entry is written, THE Platform SHALL set the TTL in whole seconds equal to the ceiling of the combo window duration, and the combo window duration SHALL be defined as a single constant in milliseconds.
4. IF any batch in a gift-to-all operation fails, THEN THE Gift_Controller SHALL log a structured error entry containing the room ID, the sender ID, and the list of user IDs that were not credited, and SHALL NOT silently suppress the error.
5. WHEN any gift endpoint returns a response, THE response HTTP status codes and JSON body field names SHALL be identical to those returned before this change.

---

### Requirement 8: Auth and Security Hardening

**User Story:** As a security engineer, I want the authentication system to enforce strong credentials, prevent brute-force attacks, and minimize data exposure in token responses.

#### Acceptance Criteria

1. WHEN the Backend starts, THE Platform SHALL validate that `JWT_SECRET` is at least 32 characters in length and SHALL refuse to start, logging an error naming the minimum length requirement, if the check fails.
2. WHEN a user registers, THE Auth_Controller SHALL reject a password that is shorter than 8 characters, or contains no uppercase letter, or contains no numeric digit, returning HTTP 400 with an error message identifying which rule was violated.
3. WHEN a login attempt fails due to incorrect credentials, THE Auth_Controller SHALL increment a per-email failure counter in Redis with a 15-minute TTL and lock the account after 5 consecutive failures within that window.
4. WHEN an account is locked, THE Auth_Controller SHALL return HTTP 429 with a JSON body containing the remaining lockout duration in seconds and SHALL return the same response whether the provided password was correct or incorrect.
5. WHEN a login attempt succeeds and a lockout counter exists for that email in Redis, THE Auth_Controller SHALL delete the counter so the 5-failure window resets.
6. IF the Redis lockout counter cannot be read or written, THEN THE Auth_Controller SHALL log the Redis error and allow the login attempt to proceed rather than blocking access due to infrastructure failure.
7. WHEN the `refreshToken` endpoint responds successfully, THE response body SHALL contain only the fields: `id`, `role`, `firstName`, `lastName`, `avatarUrl`, and `schoolId`, and SHALL NOT include `fcmToken`, `twoFactorEnabled`, `phoneVerified`, or `passwordHash`.
8. WHEN a request log entry is written, THE Request_Logger SHALL replace the value of any key named `password`, `otp`, `token`, or `refreshToken` within the logged request body with the literal string `[REDACTED]`.


---

### Requirement 9: CSRF and Webhook Protection

**User Story:** As a security engineer, I want cookie-consuming endpoints to be protected against CSRF and Stripe webhooks to receive unmodified request bodies, so that payment processing is reliable and session endpoints cannot be cross-site forged.

#### Acceptance Criteria

1. WHEN a request is received on a cookie-consuming endpoint (`POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`), THE Platform SHALL verify that either the `Origin` header matches the Platform's configured public base URL (scheme + host) or a valid `X-CSRF-Token` header matching the session-issued token is present, and SHALL allow the request to proceed only if one of these conditions is met.
2. WHEN neither the `Origin` check nor the `X-CSRF-Token` check passes for a cookie-consuming endpoint, THE Platform SHALL return HTTP 403 and SHALL NOT mutate any session or authentication state.
3. WHEN a Stripe webhook request is received at the webhook route, THE request body SHALL be delivered to `stripe.webhooks.constructEvent()` byte-for-byte identical to the raw body as received over the network, with no field sanitization applied.
4. IF the Stripe webhook signature verification fails, THEN THE Platform SHALL return HTTP 400 and record a log entry indicating the signature failure, without processing the event payload.
5. WHEN a legitimate same-origin request is received on a cookie-consuming endpoint and the CSRF check passes, THE response body, response headers (excluding the new security header), and HTTP status code SHALL be identical to those returned before this change.
6. WHEN a request passes the CSRF check on a cookie-consuming endpoint, THE Platform SHALL process it normally and all existing response formats SHALL be preserved.

---

### Requirement 10: Admin and Upload Security

**User Story:** As a security engineer, I want admin endpoints to be IP-restricted and file uploads to be validated against magic bytes, so that data exfiltration and malicious file storage are prevented.

#### Acceptance Criteria

1. WHEN a request reaches an admin-only route (backup, audit, analytics), THE Platform SHALL check the request source IP against a configured allowlist and return HTTP 403 with no response body if the IP is not in the list.
2. WHEN the IP allowlist is configured, THE Platform SHALL read the allowed IPs from an environment variable, parsing the value as a comma-separated list of IPv4 addresses or CIDR ranges.
3. WHEN a file is uploaded, THE Platform SHALL read the file's first bytes and validate the magic byte signature against the declared MIME type using the `file-type` package.
4. WHEN a file fails magic byte validation, THE Platform SHALL return HTTP 400 and SHALL NOT write the file to storage or the database.
5. IF the `clamav.js` utility is available and a ClamAV daemon is reachable, THEN THE Platform SHALL scan each uploaded file and return HTTP 400 with a message indicating malware detection if the scan reports a positive result, without storing the file.
6. WHEN the uploads static file handler sends a response, THE response SHALL include the header `X-Content-Type-Options: nosniff` on every request regardless of file type.
7. WHEN multer processes a file upload on any upload route, THE Platform SHALL enforce a maximum file size of 50 MB and return HTTP 413 if the file exceeds this limit.
8. WHEN an upload request arrives with no declared `Content-Type` or with a MIME type not in the route's allowed list, THE Platform SHALL return HTTP 415 before reading the file body.

---

### Requirement 11: GraphQL Security

**User Story:** As a security engineer, I want the GraphQL endpoint to be secured with authentication and depth limiting, so that unauthorized schema enumeration and denial-of-service via nested queries are prevented.

#### Acceptance Criteria

1. IF the Backend is running with `NODE_ENV=production`, THEN introspection queries to the GraphQL endpoint SHALL return an error response indicating that introspection is disabled, and no schema fields SHALL be returned.
2. WHEN a request reaches the GraphQL endpoint without an `Authorization` header, or with an expired or invalid-signature JWT, THE Platform SHALL return HTTP 401 before executing the query.
3. WHEN a GraphQL query has a nesting depth exceeding 7 levels, THE Platform SHALL return an error response indicating the depth limit was exceeded and SHALL NOT execute any part of the query. No partial results SHALL be returned.
4. WHERE the Backend is running with `NODE_ENV=development`, introspection queries to the GraphQL endpoint SHALL return the full schema definition.


---

### Requirement 12: Frontend Authentication Security

**User Story:** As a security engineer, I want the access token to be stored only in memory and not in localStorage, so that XSS attacks cannot steal persistent session credentials.

#### Acceptance Criteria

1. WHEN a user authenticates, THE Auth_Store SHALL hold the `accessToken` exclusively in Zustand in-memory state and SHALL NOT persist it to `localStorage`, `sessionStorage`, `IndexedDB`, or any non-httpOnly cookie.
2. WHEN the browser page is refreshed and the Auth_Store has no in-memory access token, THE Frontend SHALL call `POST /api/v1/auth/refresh` using the existing httpOnly cookie. If the call succeeds within 10 seconds, THE user SHALL be considered re-authenticated without being redirected to the login page.
3. WHEN an API call receives an HTTP 401 response, THE Frontend SHALL invoke the refresh flow to obtain a new access token, then retry the original request once with the new token, without requiring user interaction.
4. THE Auth_Store SHALL continue to persist non-sensitive user metadata (`firstName`, `lastName`, `role`, `avatarUrl`) to `localStorage` for display purposes between sessions.
5. IF the `POST /api/v1/auth/refresh` call fails or returns a non-2xx response, THEN THE Frontend SHALL clear all in-memory auth state and redirect the user to the login page.

---

### Requirement 13: Frontend Resilience and Real-Time Connectivity

**User Story:** As a user, I want live class and voice room sessions to recover from errors and network interruptions automatically, so that transient issues do not require me to manually leave and rejoin.

#### Acceptance Criteria

1. WHEN a runtime error occurs inside `LiveClassRoomImpl` or a voice room component, THE Error_Boundary SHALL catch the error, display an application-branded fallback UI containing the application name, a brief error summary, and a "Reconnect" button, and log the error to the browser console, without unmounting or affecting any part of the page outside the errored component.
2. WHEN the "Reconnect" button is clicked, THE Error_Boundary SHALL reset its error state and attempt to re-render the wrapped component.
3. WHEN a voice room component unmounts, THE Voice_Store SHALL reset so that the participant list count is 0 when the same or a different room is next opened.
4. WHEN the access token is refreshed, THE useSocket hook SHALL re-establish the Socket.IO connection with the new token without requiring any user action.
5. IF Socket.IO reconnects after a token refresh, THEN all rooms that were active at the time of disconnection SHALL resume receiving real-time events within 10 seconds without requiring user action.
6. IF Socket.IO fails to re-join a previously active room after reconnection, THEN THE Frontend SHALL display an error message identifying the room that failed to rejoin and offer a manual "Rejoin" button.
7. IF the Error_Boundary attempts to re-render a component and the component continues to throw for 15 consecutive seconds, THEN THE Error_Boundary SHALL stop automatic attempts and display a message instructing the user to reload the page.

---

### Requirement 14: Frontend Performance and UX

**User Story:** As a user, I want data-heavy pages to load with visual feedback, large message lists to scroll smoothly, and the interface to follow web security best practices.

#### Acceptance Criteria

1. WHEN a leaderboard, marketplace, or voice room list page is in a loading state while fetching data, THE Frontend SHALL display placeholder skeleton components matching the layout of the expected content in place of blank space.
2. WHEN the group chat message list contains more than 100 messages, THE Frontend SHALL render only the messages currently visible in the viewport using a virtualized list, with no more than 30 additional messages rendered above and below the visible area as a buffer.
3. WHEN a link with `target="_blank"` is rendered, THE Frontend SHALL include `rel="noopener noreferrer"` on the anchor element.
4. WHEN the Next.js middleware generates a page response, THE Frontend SHALL inject a cryptographic nonce into the `Content-Security-Policy` header and apply it to inline scripts, with no `'unsafe-inline'` directive present in the script-src policy.
5. WHEN a Next.js `Image` component loads an image from an R2 or Cloudflare domain, THE Frontend SHALL have those domains listed in `next.config.js` `images.remotePatterns`, and the build SHALL not emit a "hostname not configured" warning for those domains.
6. WHEN the user is offline and navigates to any page that fails to load, THE Frontend SHALL serve a fallback page containing the application name, an offline status message, and a "Try again" button via the `next-pwa` service worker configuration.
7. WHEN a voice room, marketplace, or community page finishes loading and has no items to display, THE Frontend SHALL render an empty state component containing an illustrative element, a context-specific message, and a call-to-action button appropriate to the page.
8. WHEN any API call returns an error or completes successfully with a user-visible result, THE Frontend SHALL surface the feedback using the `useToast()` hook. No `window.alert()` calls and no silently swallowed errors SHALL remain in the codebase for user-facing flows.


---

### Requirement 15: Mobile Security

**User Story:** As a security engineer, I want the mobile app to enforce HTTPS, protect financial screens, and provide biometric auth fallback, so that user data is protected on device.

#### Acceptance Criteria

1. WHEN the mobile API client makes a request in a production build, THE Platform SHALL abort the request and return an error to the caller if the target URL uses the `http://` scheme, with no data transmitted.
2. WHERE the app is running in `__DEV__` mode, THE Platform SHALL allow connections to `http://` URLs on `localhost` or `127.0.0.1` only.
3. WHEN a financial screen (buy-coins, wallet-history, payout-request) mounts, THE Mobile SHALL activate OS-level screen recording and screenshot prevention so that the screen content is not capturable.
4. WHEN a financial screen unmounts, THE Mobile SHALL deactivate screen recording prevention, restoring the default capture state for all subsequent screens.
5. WHEN biometric authentication fails 3 consecutive times, THE Mobile SHALL present a fallback authentication option using the device PIN, password, or pattern instead of biometrics.
6. WHEN the Android hardware back button is pressed inside a live class or voice room screen, THE Mobile SHALL display a confirmation dialog asking the user to confirm they want to leave before navigating away.
7. WHEN the user confirms leaving the live screen, THE Mobile SHALL call the appropriate leave API and then navigate away.
8. IF the user dismisses the leave confirmation dialog, THEN THE Mobile SHALL remain on the live screen without calling any leave API or triggering any navigation.

---

### Requirement 16: Mobile Performance and Reliability

**User Story:** As a mobile user, I want the app to sync data efficiently in the background, queue failed actions for retry, and use a compatible SDK version, so that battery life and data reliability are preserved.

#### Acceptance Criteria

1. WHEN the Background_Sync task retries after a failure, THE Mobile SHALL wait before the next attempt using exponential backoff starting at 30 seconds and doubling each time up to a maximum interval of 30 minutes.
2. WHEN the Background_Sync task runs, THE Mobile SHALL batch all data fetches required by that run into a single API call rather than issuing multiple sequential requests.
3. IF a mutation (attendance mark, message send) fails because the device has no network connectivity, THEN THE Offline_Manager SHALL queue the mutation for later retry, storing a maximum of 500 pending mutations.
4. WHEN network connectivity is restored, THE Offline_Manager SHALL replay all queued mutations in the order they were originally created. IF a replayed mutation receives a server error response, THE Offline_Manager SHALL re-queue it. IF a mutation fails 3 consecutive replay attempts, THE Offline_Manager SHALL discard it and display a notification informing the user that the action could not be completed.
5. WHEN the mobile app is built, THE build SHALL complete without unresolved peer dependency errors related to the React version and the declared Expo SDK version.
6. WHEN the APNS or FCM push token changes, THE Mobile SHALL detect the change and send the new token to the backend within 5 seconds, retrying with the backoff policy from criterion 1 if the request fails.

---

### Requirement 17: Live Features — Capacity and Token Security

**User Story:** As a platform operator, I want voice rooms to enforce capacity limits and use short-lived LiveKit tokens, so that resource costs are bounded and kicked users cannot continue broadcasting.

#### Acceptance Criteria

1. WHEN a user attempts to join a voice room as audience and the current participant count equals or exceeds the `roomLevel` tier capacity limit, THE Voice_Controller SHALL return HTTP 403 with a message indicating the room is full.
2. THE `roomLevel` tier capacity limits are: Level 1 = 500 participants; Level 2 = 1000 participants; Level 3 = 2000 participants. THE Voice_Controller SHALL use these values when enforcing the audience capacity check.
3. WHEN the Platform generates a LiveKit access token, THE token TTL SHALL be set to a minimum of 5 minutes and a maximum of 60 minutes.
4. WHEN a LiveKit webhook event indicating a participant was kicked is received, THE Platform SHALL update the participant's status in the database and delete the Redis cache entries for the affected room.
5. WHEN a LiveKit webhook event indicating a room has ended is received, THE Platform SHALL update the room status in the database and delete the Redis cache entries for the affected room.
6. WHEN a LiveKit connection drops due to a network interruption, THE Frontend and Mobile SHALL automatically attempt to reconnect using exponential backoff, starting at 1 second and doubling up to a maximum of 16 seconds per attempt.
7. IF the reconnection attempt has been running for more than 30 seconds without success, THEN THE Frontend and Mobile SHALL display a "Reconnecting…" indicator visible to the user.
8. IF the LiveKit reconnection fails completely after the backoff sequence is exhausted, THEN THE Frontend and Mobile SHALL display a "Session ended" message and a rejoin button.


---

### Requirement 18: Performance Caching

**User Story:** As a platform operator, I want dashboard, getMe, and Socket.IO to use caching and compression, so that CPU and bandwidth costs are reduced under high concurrent load.

#### Acceptance Criteria

1. WHEN a dashboard aggregation is requested for a school and a valid cache entry exists, THE Dashboard_Controller SHALL return the cached response without querying the database, with a maximum TTL of 5 minutes per school.
2. WHEN attendance or grade data is created, updated, or deleted for a school, THE Dashboard_Controller SHALL delete the school's dashboard cache entry so the next request fetches fresh data.
3. WHEN `getMe()` is called for a user and a valid cache entry exists, THE Auth_Controller SHALL return the cached response without querying the database, with a maximum TTL of 60 seconds per user.
4. WHEN a user's profile is updated, THE Auth_Controller SHALL delete that user's `getMe` cache entry so the next call fetches fresh data.
5. IF Redis is unavailable for a dashboard or `getMe` cache read, THEN THE Platform SHALL query the database directly and return the correct data. IF the database query also fails, THEN THE Platform SHALL return an HTTP 503 response indicating the service is temporarily unavailable.
6. WHEN the Socket.IO server is initialized, THE Platform SHALL enable per-message WebSocket compression so that message payloads are compressed before transmission.
7. WHEN the room list endpoint is called, THE Voice_Controller SHALL include at most 20 participants per room in the response, ordered by join time ascending.
8. WHEN the room list endpoint is called, THE Voice_Controller SHALL return the total participant count for each room as a separate numeric field rather than deriving it by counting the included participant array.

---

### Requirement 19: DevOps and Deployment

**User Story:** As a DevOps engineer, I want the deployment pipeline, Docker configuration, and Nginx to be hardened, so that deployments are safe, SSL does not expire, and the system is resilient to process failures.

#### Acceptance Criteria

1. WHEN the CI/CD deploy pipeline runs, THE Platform SHALL execute `prisma migrate deploy` against the target database while the currently running container version remains active and serving traffic, before starting the new container.
2. IF a database migration fails during the deploy pipeline, THEN THE pipeline SHALL abort, keep the prior container version running, and send an alert notification to the configured channel before exiting with a non-zero status.
3. WHEN the CI pipeline runs, THE Platform SHALL start MySQL and Redis Docker containers, run all Prisma migrations against them, and execute the full integration test suite against those containers before the Docker image build step.
4. IF any test in the integration test suite fails in CI, THEN THE CI job SHALL exit with a non-zero status and the Docker image build step SHALL not run.
5. WHEN the database backup job runs, THE Platform SHALL verify that the resulting backup file has a size greater than zero bytes and passes a gzip integrity check, and SHALL send an alert notification if either check fails.
6. WHEN `docker-compose.prod.yml` is deployed, THE Platform SHALL include a certbot service configured to automatically renew Let's Encrypt certificates on a scheduled basis before expiry.
7. WHEN the frontend Docker container is started, THE Platform SHALL have a Docker health check defined that polls `GET http://localhost:3000/api/health` and marks the container as unhealthy after 3 consecutive failures.
8. THE `docker-compose.yml` development file SHALL contain no inline default password values for `MYSQL_ROOT_PASSWORD` or `MYSQL_PASSWORD`, and the compose file SHALL fail to start with an explicit error message if the required `.env` file is absent.
9. THE `ecosystem.config.js` file SHALL either be deleted from the repository or contain inline comments at the top clearly stating whether PM2 or Docker is the supported deployment method and that the other is not supported.
10. WHEN the Nginx configuration for live feature routes is deployed, THE Platform SHALL apply a dedicated rate-limiting zone to `/api/v1/voice/` and `/api/v1/live-class/` that is separate from the general API rate-limiting zone.

---

### Requirement 20: Testing Coverage

**User Story:** As a developer, I want critical financial, authentication, and UI code paths to have automated test coverage, so that regressions are caught before reaching production.

#### Acceptance Criteria

1. THE Platform SHALL have unit and integration tests for the Stripe webhook handler that cover: processing a valid signed event, rejecting an event with an invalid signature, and preventing double-processing of a duplicate event ID.
2. THE Platform SHALL have unit and integration tests for the gift system that cover: sending a single gift, sending a gift to all speakers with batching, verifying that the sender wallet is debited and all receiver wallets are credited consistently, and detecting a combo sequence.
3. THE Platform SHALL have unit and integration tests for the wallet that cover: crediting an amount, debiting an amount, rejecting a debit when the balance is insufficient, and handling two concurrent debits that would together overdraw the balance.
4. THE Platform SHALL have unit and integration tests for the auth controller that cover: registering with an invalid password, triggering account lockout after 5 failed logins, refreshing a valid token, and logging out.
5. THE Platform SHALL have unit and integration tests for the voice controller that cover: creating a room, joining a room within capacity, being rejected when the room is at capacity, and leaving a room.
6. THE Platform SHALL have Playwright E2E tests for each of the following flows where each test asserts key state transitions and completes without errors: user login, joining and leaving a voice room, completing a coin purchase, and creating a live class.
7. THE Platform SHALL have load test scripts for: 100 users concurrently joining voice rooms (p95 latency ≤ 2000 ms, error rate ≤ 1%), 50 users concurrently sending gifts (p95 latency ≤ 2000 ms, error rate ≤ 1%), and Socket.IO connection limit under sustained concurrent connections.
8. THE Frontend SHALL have React Testing Library tests for the auth store (login, logout, token expiry), the voice store (join, leave, reset), and the gift panel component (render, send action, error state).
9. WHEN integration tests run in CI, THE Platform SHALL use dedicated MySQL and Redis Docker containers, run all Prisma migrations before the first test, and fail the CI job if any test in the suite fails.

---

### Requirement 21: Accessibility

**User Story:** As a user relying on assistive technologies, I want all interactive elements to be properly labeled, so that screen readers can announce the purpose of every button and control.

#### Acceptance Criteria

1. THE Frontend SHALL add an `aria-label` attribute to every icon-only interactive element (mic toggle, camera toggle, gift button, reaction buttons, and similar controls). Each label SHALL convey the control's action or purpose, and stateful toggles SHALL update their `aria-label` to reflect the current state (e.g., "Mute microphone" when active, "Unmute microphone" when muted).
2. THE Mobile SHALL add an `accessibilityLabel` prop to every icon-only `Pressable` and `TouchableOpacity` element. Each label SHALL convey the control's action or purpose, and stateful toggles SHALL update their `accessibilityLabel` to reflect the current state.
3. WHEN the software keyboard opens in the mobile group chat screen, THE message input field SHALL remain fully visible and not be overlapped by the keyboard on any supported Android or iOS device.
4. WHEN the mobile app initializes, THE Platform SHALL keep the splash screen visible until the user's theme preference (light or dark) has been applied to the root component, so that no unstyled flash of the opposite theme is visible to the user.
5. THE Frontend SHALL have no `<a target="_blank">` elements missing `rel="noopener noreferrer"`, as enforced by `eslint-plugin-jsx-a11y` in the project's ESLint configuration.
