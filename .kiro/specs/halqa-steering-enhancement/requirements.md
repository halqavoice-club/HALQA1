# Requirements Document

## Introduction

The Halqa platform currently has three steering files (`tech.md`, `structure.md`, `product.md`) loaded automatically by Kiro for every task. As the platform has grown to 89+ documentation files and 13 security-sprint remediation records, these three files no longer carry enough domain-specific context for AI-assisted tasks in security, realtime, payments, and testing — yet they already cover the tech stack, project structure, and product overview completely.

This feature creates five additional, focused steering files that Kiro loads only when relevant. Together they encode the P0 security invariants, Socket.IO/LiveKit patterns, coin/diamond economy rules, test conventions, and the full 45-section master constitution — without duplicating content already in the existing three files.

## Glossary

- **Steering File**: A Markdown file in `.kiro/steering/` that Kiro loads into context before generating code or answering questions. Files with `inclusion: auto` load for every task; files with `inclusion: manual` or a `globs` pattern load only when matching files are active.
- **SUPER_ADMIN**: Platform-level administrator. Distinct from school-level admins. Cannot participate in content spaces (feed, live class, live stream, voice room, chat) via platform privilege alone.
- **P0 Invariant**: One of 16 architectural rules that must never be broken; documented in `docs/authorization/super-admin-production-invariants.md` (INV-001 through INV-016).
- **Content Participation**: The act of joining a content space (voice room, live class, live stream, social feed, chat) as a participant — explicitly prohibited for SUPER_ADMIN via platform role.
- **LiveKit**: The SFU (Selective Forwarding Unit) used for audio/video in Voice Club and Live Class. Issues per-session tokens from the backend.
- **Socket.IO Room**: A named channel that sockets join to receive targeted events. Requires a valid DB participant record or JWT school-match — never a SUPER_ADMIN bypass.
- **Coin**: Spendable in-app currency purchased via Stripe. 1 coin costs a fraction of a USD based on the package tier.
- **Diamond**: Earned currency received when a user is gifted coins. Converts to cash via the payout system at `diamonds × $0.005`.
- **WalletTransaction**: Immutable ledger record for every coin credit or debit. `stripeSessionId` has a `@unique` DB constraint as the primary double-credit defense.
- **EARS Pattern**: Easy Approach to Requirements Syntax — one of six structured patterns (Ubiquitous, Event-driven, State-driven, Unwanted event, Optional feature, Complex) used in this document.
- **PBT**: Property-Based Testing. Tests that verify mathematical invariants across randomly generated inputs using `fast-check` (TypeScript/frontend) or `fast-check` via Jest (backend).
- **Unit Test**: A Jest test that mocks all external dependencies (Prisma, Redis, JWT, Socket.IO) and does not require a running database.
- **Integration Test**: A Jest test that requires a live MySQL database and (optionally) Redis. Tagged `@integration` and placed in `backend/src/tests/integration/`.

---

## Requirements

### Requirement 1: security.md Steering File

**User Story:** As a developer working on SUPER_ADMIN boundaries or security-sensitive code, I want a concise, rules-only steering file loaded automatically when I edit security or authorization files, so that Kiro always has the 16 production invariants and content-participation prohibition in context without requiring me to recall them manually.

#### Acceptance Criteria

1. THE `security.md` Steering File SHALL use Kiro front-matter with `inclusion: manual` and a `globs` pattern matching `**/middleware/**`, `**/auth*`, `**/admin*`, `**/*security*`, `**/*invariant*`, `**/*permission*`, and `**/routes/**` so it loads automatically for security-related file edits.

2. THE `security.md` Steering File SHALL open with the P0 architectural invariant statement: `SUPER_ADMIN = PLATFORM ADMINISTRATION ONLY` and `SUPER_ADMIN ≠ CONTENT PARTICIPANT` as the single most important rule, matching the authoritative wording in `docs/authorization/README.md`.

3. THE `security.md` Steering File SHALL enumerate all 16 production invariants (INV-001 through INV-016) as a concise, rules-only list — each in one sentence or less — covering: feed participation, live class join, live stream join, voice room join, HOST role assignment, TEACHER/STUDENT role conversion, SPEAKER/STREAMER role, LiveKit token issuance, Socket.IO room membership, school authorization bypass, admin API vs participation API, audit requirements, financial transaction safety, silent role conversion, token TTL, and role assignment path.

4. THE `security.md` Steering File SHALL include the complete change-control checklist (16 checkbox items, one per invariant) that must be verified before any SUPER_ADMIN-related code change is deployed.

5. THE `security.md` Steering File SHALL list the correct admin-action patterns versus the prohibited content-participation patterns, using the `INV-011` example from `docs/authorization/super-admin-production-invariants.md`: dedicated `POST /api/v1/admin/…` endpoints versus content join APIs.

6. THE `security.md` Steering File SHALL reference the test file `backend/src/tests/platform-admin-scope.test.js` as the regression suite that must pass after any SUPER_ADMIN boundary change.

7. THE `security.md` Steering File SHALL NOT duplicate content already in `structure.md` (project structure, key architecture rules) or `product.md` (user roles definitions, core domain descriptions).

8. IF `security.md` is absent from `.kiro/steering/`, THEN THE Kiro Agent SHALL lack the 16 invariants in context when editing authorization middleware, increasing the probability of accidental P0 violations.

---

### Requirement 2: realtime.md Steering File

**User Story:** As a developer working on Socket.IO event handlers, LiveKit token generation, or real-time features, I want a detailed steering file with patterns and code snippets so that Kiro generates correct event names, room authorization guards, LiveKit grant structures, and reconnect policies without needing to cross-reference multiple docs.

#### Acceptance Criteria

1. THE `realtime.md` Steering File SHALL use Kiro front-matter with `inclusion: manual` and a `globs` pattern matching `**/sockets/**`, `**/*socket*`, `**/*livekit*`, `**/*voice*`, `**/*live-class*`, `**/*live_class*`, and `**/hooks/use*Audio*` so it loads for realtime-related file edits.

2. THE `realtime.md` Steering File SHALL document the Socket.IO authentication middleware pattern — JWT required at connection time via `socket.handshake.auth.token`, with `socket.userId`, `socket.userRole`, and `socket.userSchoolId` set from the JWT and immutable for the connection lifetime.

3. THE `realtime.md` Steering File SHALL specify the transport configuration rule: `polling` must be listed before `websocket` in the transports array. Starting with `websocket` only is prohibited per `structure.md` Key Architecture Rule 4.

4. THE `realtime.md` Steering File SHALL document the complete Socket.IO room taxonomy (14 rooms) with their authorization gates: `user:{userId}` (auto), `voice:lobby` (auto), `role:{role}` (auto), `voice:{roomId}` (active `VoiceParticipant`), `liveclass:{id}` (active `LiveClassParticipant`), `school:{schoolId}` (JWT schoolId match), `class:{classId}` (active `SchoolMembership`), `feed:{userId}` (own feed), `feed:public` (auto), `feed:school:{schoolId}` (JWT schoolId match — no SUPER_ADMIN bypass), `wallet:{userId}` (self-join), `pk:{pkMatchId}` (active `PKParticipant` or LIVE/ENDED match), `community:{id}` (active `CommunityMember`), `conversation:{convId}` (active `GroupMember`).

5. THE `realtime.md` Steering File SHALL document the rate limiter table for Socket.IO events, including all 11 event-rate pairs derived from `docs/authorization/realtime-architecture.md`: `voice:reaction` (10/2s), `voice:join_room` (5/10s), `liveclass:reaction` (10/2s), `voice:speaking` (30/5s), `liveclass:speaking` (30/5s), `dm:typing_start` (20/5s), `dm:typing_stop` (20/5s), `voice:leave_room` (10/5s), `liveclass:video_changed` (15/5s), `liveclass:screen_share_started` (5/10s), `liveclass:screen_share_stopped` (5/10s).

6. THE `realtime.md` Steering File SHALL document the LiveKit token structure for Voice Club — endpoint `POST /voice/:id/livekit-token`, required active `VoiceParticipant` record, grant fields (`roomJoin`, `room`, `canPublish: true`, `canSubscribe: true`, `canPublishData: true`, `canUpdateOwnMetadata: true`), TTL of 1 hour, and the `micEnabled` advisory field (not a LiveKit grant — client-side mic control only).

7. THE `realtime.md` Steering File SHALL document the LiveKit token structure for Live Class — endpoint `POST /live-classes/:id/token`, required active `LiveClassParticipant` record, identical grant fields to Voice Club, SFU-level screen share restriction via `canPublishSources` when `screenShareEnabled=false` and role ≠ HOST, and TTL of 1 hour.

8. THE `realtime.md` Steering File SHALL document the reason all participants receive `canPublish: true` regardless of role: role changes arrive via Socket.IO events (`voice:role_changed`, `liveclass:you_can_speak`) and the frontend calls `setMicrophoneEnabled()` without reconnect — issuing `canPublish: false` would require a token reissue and a 1–2 second reconnect gap.

9. THE `realtime.md` Steering File SHALL document the Voice Club reconnect policy: max 5 attempts, exponential backoff starting at 1.5s, no reconnect for `CLIENT_INITIATED`/`ROOM_DELETED`/`PARTICIPANT_REMOVED` disconnect reasons, and proactive token refresh at 55 minutes (5 minutes before the 1-hour TTL).

10. THE `realtime.md` Steering File SHALL include an event naming conventions table listing the namespace prefixes (`voice:`, `liveclass:`, `dm:`, `group:`, `community:`, `feed:`, `wallet:`, `gift:`, `admin:`, `pk:`) and the directional convention (`C→S` for client-emits-server-receives, `S→C` for targeted personal events, `S→room` for room broadcasts).

11. THE `realtime.md` Steering File SHALL document the SUPER_ADMIN Socket.IO boundary: SUPER_ADMIN has no special access to any content rooms; the `feed:school:{schoolId}` SUPER_ADMIN bypass (SVSV-001) was removed in Sprint 1 and must not be reintroduced.

12. THE `realtime.md` Steering File SHALL NOT duplicate the tech stack table (Socket.IO version, LiveKit SDK names) already in `tech.md`.

---

### Requirement 3: payments.md Steering File

**User Story:** As a developer working on the coin/diamond economy, Stripe integration, or payout flows, I want a detailed steering file with the financial integrity rules and code patterns so that Kiro generates correct atomic transactions, idempotency handling, and balance guards without introducing double-credit or negative balance bugs.

#### Acceptance Criteria

1. THE `payments.md` Steering File SHALL use Kiro front-matter with `inclusion: manual` and a `globs` pattern matching `**/stripe*`, `**/wallet*`, `**/gift*`, `**/payout*`, `**/coins*`, `**/*payment*`, and `**/*transaction*` so it loads for payment-related file edits.

2. THE `payments.md` Steering File SHALL document the economy model as a flow: real money (Stripe) → Coins → Gifts → Diamonds → Payout, with the conversion rates: 1 coin = 1 unit of spend; common gifts yield `totalCoins × 0.75` diamonds; rare `× 0.80`; epic `× 0.85`; legendary `× 0.90`; payout rate is `diamonds × $0.005` USD; minimum payout threshold is 2000 diamonds.

3. THE `payments.md` Steering File SHALL document the platform revenue split: the platform takes 50% of all gifted coin value (implied by the diamond conversion rates being less than 1:1); the `GIFT_DAILY_CAP` environment variable controls the daily spend ceiling.

4. THE `payments.md` Steering File SHALL document the five INV-013 financial integrity rules that every coin/diamond mutation must satisfy: (a) execute inside `prisma.$transaction` for atomicity, (b) write an audit log with before/after values, (c) use an idempotency key to prevent double-execution, (d) validate that the resulting balance cannot go negative, (e) require SUPER_ADMIN role + IP allowlist for admin-initiated mutations.

5. THE `payments.md` Steering File SHALL document the three-layer double-credit defense for Stripe webhooks: (1) Stripe delivers each event once (best-effort), (2) Redis caches the event ID to detect re-delivery within TTL, (3) `WalletTransaction.stripeSessionId` has a `@unique` DB constraint — the second write fails with a unique constraint violation.

6. THE `payments.md` Steering File SHALL include the canonical Stripe webhook flow as a code-comment pattern: verify signature with `stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET)`, use raw body (`express.raw()` on the webhook route), calculate `totalCoins = package.coins + package.bonusCoins`, execute `prisma.$transaction` with wallet update and `WalletTransaction` create, then emit `wallet:coins_credited` to `user:{userId}` and `wallet:{userId}`.

7. THE `payments.md` Steering File SHALL document the gift sending flow integrity requirements: sender must be an active room participant (`roomResolver.validateParticipant`), receiver must be an active room participant (`roomResolver.getReceivers`), coin balance must be checked before the transaction, the `prisma.$transaction` must atomically deduct sender coins, credit receiver diamonds, create `WalletTransaction`, create `GiftTransaction`, and upsert `RoomGiftLeaderboard`.

8. THE `payments.md` Steering File SHALL document the gift idempotency pattern: client generates a UUID `idempotencyKey` before calling the endpoint; on network timeout, client retries with the same key; server performs `GiftTransaction.findUnique({ where: { idempotencyKey } })` and returns `{ duplicate: true }` without double-charging if found.

9. THE `payments.md` Steering File SHALL document the `WalletTransaction` type enum — `STRIPE_PURCHASE`, `GIFT_SEND`, `TIP_SEND`, `SUBSCRIPTION`, `ADMIN_GRANT`, `REFUND` — and the rule that `WalletTransaction` records are immutable after creation (the ledger is append-only).

10. THE `payments.md` Steering File SHALL document the refund rules introduced in Sprint 8: refundable types are `STRIPE_PURCHASE` and `ADMIN_GRANT`; non-refundable types are `GIFT_SEND`, `TIP_SEND`, `SUBSCRIPTION`, and `REFUND`; refunds are idempotent (duplicate refund attempt returns 409); balance guard blocks refund if user has insufficient coins; Stripe refund via `stripe.refunds.create({ payment_intent })` is fire-and-forget (failure is non-fatal, coins still refunded).

11. THE `payments.md` Steering File SHALL document the realtime credit notification pattern: after successful coin credit, emit `wallet:coins_credited` to both `user:{userId}` and `wallet:{userId}`; after school fee payment, emit `fee:paid` to `user:{paidBy}`.

12. THE `payments.md` Steering File SHALL NOT duplicate the Stripe SDK version or `@stripe/stripe-react-native` package names already listed in `tech.md`.

---

### Requirement 4: testing.md Steering File

**User Story:** As a developer writing tests for the Halqa platform, I want a concise, rules-only steering file covering test naming conventions, category definitions, mock patterns, and PBT usage so that Kiro generates tests that are consistent with the existing 985-test suite.

#### Acceptance Criteria

1. THE `testing.md` Steering File SHALL use Kiro front-matter with `inclusion: manual` and a `globs` pattern matching `**/*.test.js`, `**/*.test.ts`, `**/*.spec.ts`, `**/*.pbt.test.ts`, and `**/tests/**` so it loads automatically when test files are active.

2. THE `testing.md` Steering File SHALL define three test categories and their rules: (a) **Unit tests** — mock all external deps (`jest.mock('../utils/prisma')`, `jest.mock('../utils/redis', ...)`, `jest.mock('../utils/jwt', ...)`, `jest.mock('../sockets', ...)`), run with `npm run test:unit`, no real DB required; (b) **Integration tests** — require live MySQL + Redis, placed in `backend/src/tests/integration/`, run with `npm run test:integration`; (c) **PBT (Property-Based Tests)** — use `fast-check` with `fc.assert(fc.property(...))`, placed as `*.pbt.test.ts`, run with vitest for TypeScript layout tests and Jest for backend PBT.

3. THE `testing.md` Steering File SHALL document the test file naming convention: `{domain}-{concern}.test.js` for unit/integration tests (e.g., `live-class-p0-security.test.js`, `super-admin-scope.test.js`, `idempotency.test.js`), and `{domain}.pbt.test.ts` for property-based tests (e.g., `computeLayout.pbt.test.ts`).

4. THE `testing.md` Steering File SHALL document the `describe`/`test` naming convention: `describe` blocks use the format `{FIX-ID or CATEGORY}: {plain-English description}` (e.g., `'SA-FIX-02: updateRoom — SUPER_ADMIN cannot edit room without room role'`); `test` names state the expected behavior in plain English (e.g., `'SUPER_ADMIN (non-participant) gets 403 on PATCH /voice/:id'`).

5. THE `testing.md` Steering File SHALL document the standard mock setup pattern: `asUser(id, role, status, schoolId)` helper that calls `verifyAccessToken.mockReturnValue(...)` and `prisma.user.findUnique.mockResolvedValue(...)` together; `tok(id)` helper that returns `Bearer t-${id}`; `beforeEach` calls `jest.clearAllMocks()` and resets Redis mock to unavailable.

6. THE `testing.md` Steering File SHALL document the source-level verification pattern: tests that cannot exercise behavior through HTTP (due to middleware ordering or mock depth limitations) should instead read the source file with `fs.readFileSync` and assert on the presence or absence of specific code patterns, with an explicit comment explaining why source inspection is used instead of a runtime test.

7. THE `testing.md` Steering File SHALL specify that security-related tests MUST include both a positive path (permitted user succeeds) and a negative path (denied user gets 403/401), and should include a source-level verification test to confirm the guard is implemented at the code level.

8. THE `testing.md` Steering File SHALL document the PBT configuration: use `{ numRuns: 100 }` as the default for CI speed; use higher counts (200–400) for critical invariants; use `fc.property(fcArbitrary, (value) => { /* assertion */ })` structure; the property function must not throw — use `expect()` assertions inside.

9. THE `testing.md` Steering File SHALL document the integration test guard pattern: integration tests must call `beforeAll(async () => { /* connect to DB */ })` and `afterAll(async () => { /* disconnect */ })`, and must be skipped with `test.skip` or a `@integration` tag when the database is unavailable, to prevent CI failures on unit-only runs.

10. THE `testing.md` Steering File SHALL NOT duplicate the Jest version, Supertest, or Playwright package names already listed in `tech.md`.

---

### Requirement 5: constitution.md Steering File

**User Story:** As a developer starting a new feature or conducting an architecture review, I want the full Halqa master constitution available as a single persistent steering file so that Kiro can reference all 45 sections of platform rules, violation history, domain boundaries, and production requirements in one place without reading through 89 separate documentation files.

#### Acceptance Criteria

1. THE `constitution.md` Steering File SHALL use Kiro front-matter with `inclusion: manual` (not `auto`) so it is loaded on-demand for broad architectural tasks rather than loaded on every task, avoiding unnecessary context overhead.

2. THE `constitution.md` Steering File SHALL contain a structured index of all major platform domains covered, organized into sections that correspond to the documentation phases: Authorization (Phases 1–5), Live Class (Phase 6), Live Stream (Phase 7), Voice Club (Phase 8), Feed + Social (Phase 9), Chat/DM (Phase 10), Gifts/Payments (Phase 11), Notifications (Phase 12), Web/Mobile (Phase 13), Deployment (Phase 14).

3. THE `constitution.md` Steering File SHALL include the complete violation register summary from `docs/MASTER-VIOLATIONS.md`: all 39 violations with their IDs, severity levels, domains, fix status (Sprint number and commit hash where available), and current production state.

4. THE `constitution.md` Steering File SHALL include all 16 production invariants (INV-001 through INV-016) in full detail — not as a reference to another file, but as the complete inline text — so they are available without requiring cross-file lookup.

5. THE `constitution.md` Steering File SHALL include the 14-step change control process from `docs/HALQA-MASTER.md` `CHANGE-CONTROL.md` reference: READ SUPER-ADMIN-MASTER-SPEC.md → CHECK api-matrix → CHECK db-inventory → CHECK admin-ui-matrix → CHECK realtime-boundary → CHECK livekit-architecture → UPDATE docs → REVIEW → CODE → TEST → AUDIT → DEPLOY, with the anti-pattern `CODE → BREAK → DOCUMENT` explicitly prohibited.

6. THE `constitution.md` Steering File SHALL include the production test suite status as a header statement: current test count (985 passing), and the rule that no code change may reduce the passing test count below the baseline.

7. THE `constitution.md` Steering File SHALL include the school isolation rules from `docs/live-class/production-rules.md`: `resolveStreamAccess` on every route reading class data, `assertSchoolAccess` inside controllers, `checkLiveClassSchool` on gift endpoints, cross-school access returns 403 for ALL roles including SUPER_ADMIN, and `SchoolMembership` as the authoritative source for school roles.

8. THE `constitution.md` Steering File SHALL include the key infrastructure dependency table: MySQL (fatal), Redis (soft — in-memory fallback), LiveKit SFU (graceful — REST still works), Socket.IO (fatal for realtime), Push/FCM (soft — fire-and-forget), and the Redis fallback rule that all Redis-dependent features must degrade gracefully with a `warn`-level log in dev (not `error`).

9. THE `constitution.md` Steering File SHALL include the SQL injection prevention rules: `updateLiveClass` column allowlist, `listLiveClasses` hardcoded literals with parameterized `?` placeholders, prohibition on string interpolation in `$queryRawUnsafe` calls.

10. WHEN the `constitution.md` Steering File is loaded by the Kiro Agent, THE Kiro Agent SHALL have sufficient context to answer questions about any of the 10 documentation phases without needing to read individual domain files.

11. THE `constitution.md` Steering File SHALL NOT duplicate content already in `tech.md`, `structure.md`, or `product.md` — it SHALL reference those files by name for tech stack, project structure, and product overview sections rather than repeating them inline.

---

### Requirement 6: Non-Duplication and Complementarity

**User Story:** As a developer maintaining the steering files, I want the five new files to be additive and non-overlapping with each other and with the existing three files so that the steering system does not send contradictory or redundant instructions to the Kiro Agent.

#### Acceptance Criteria

1. THE five new Steering Files (`security.md`, `realtime.md`, `payments.md`, `testing.md`, `constitution.md`) SHALL NOT include content that duplicates the tech stack table, Common Commands section, or Key Configuration Notes already in `tech.md`.

2. THE five new Steering Files SHALL NOT include content that duplicates the backend/frontend/mobile directory trees, controller/route naming conventions, or Key Architecture Rules 1–7 already in `structure.md`.

3. THE five new Steering Files SHALL NOT include content that duplicates the Core Domains, User Roles, or Islamic-Specific Features already in `product.md`.

4. WHEN a new steering file covers a topic partially addressed in an existing steering file, THE new Steering File SHALL reference the existing file by name rather than restating the content (e.g., `realtime.md` references `structure.md` Rule 4 for the Socket.IO transport order rather than restating it).

5. THE `security.md` file and `constitution.md` file both reference the 16 invariants; WHEN this overlap is intentional, THE `security.md` file SHALL provide the concise checklist form and THE `constitution.md` file SHALL provide the full detailed form, so the formats are complementary rather than duplicative.

6. THE five new Steering Files SHALL use Kiro steering front-matter format with `---` delimiters at the top of each file, specifying at minimum `inclusion` and either `description` or `globs` fields, consistent with the Kiro steering file specification.
