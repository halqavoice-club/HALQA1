# Requirements Document

## Introduction

The HALQA platform has accumulated critical defects in its virtual economy: two conflicting payout implementations with incompatible conversion rates, a race-condition in creator subscriptions that can overdraft wallets past zero, financial amounts stored as floating-point, bank account details stored as plaintext, ledger writes silently swallowed, transaction history that shows only gift records, and hardcoded economy constants scattered across backend and frontend files. This feature consolidates all economy behaviour into a single, correct, and auditable implementation. It fixes every confirmed bug identified in the production audit, establishes a single source of truth for economy constants, and adds the test coverage and operational tooling needed to keep the economy healthy going forward.

---

## Glossary

- **Economy_Config**: The singleton server-side module that exposes all economy constants (`PLATFORM_SHARE_PERCENT`, `CREATOR_SHARE_PERCENT`, `DIAMOND_TO_USD`, `PAYOUT_MIN_DIAMONDS`). Never read from environment variables at call sites; always import from this module.
- **Wallet**: The Prisma model holding `coins`, `diamonds`, `totalSpent`, `totalEarned` for a user. Subject to DB CHECK constraints (coins ≥ 0, diamonds ≥ 0).
- **WalletTransaction**: The authoritative ledger model. Every financial mutation (coin debit, diamond credit, payout reservation, payout reversal, admin grant, Stripe purchase, refund) MUST produce a `WalletTransaction` record.
- **PayoutRequest**: The Prisma model representing a creator's request to withdraw diamond earnings. States: `PENDING → APPROVED → PROCESSING → COMPLETED | REJECTED | CANCELLED`.
- **Diamond_Reservation**: The act of decrementing `Wallet.diamonds` atomically at payout-request creation time so the same diamonds cannot be withdrawn twice.
- **PAYOUT**: `WalletTransaction.type` value representing a diamond reservation on payout request submission.
- **PAYOUT_REVERSAL**: `WalletTransaction.type` value representing diamond restoration when a payout request is rejected or cancelled.
- **Payout_Controller**: The canonical payout implementation at `POST /api/v1/wallet/payout/request` (payout.controller.js). The only valid entry point for payout requests after consolidation.
- **Creator_Controller**: The controller at `backend/src/controllers/creator.controller.js`. Its `requestPayout` function must be removed and all payout routes redirected to the Payout_Controller.
- **Optimistic_Lock**: A Prisma `WHERE` clause filter (`coins: { gte: amount }`) on a wallet update that causes the update to fail atomically if the balance is insufficient at commit time, preventing overdraft under concurrent load.
- **Daily_Spend_Cap**: A per-user, per-day ceiling on gift coin expenditure. Primary store: Redis. Must fall back to a DB aggregate query when Redis is unavailable — never default to zero (cap bypass).
- **Fee_Payment_Session**: A Stripe Checkout session created for school fee payment, identified by `session.metadata.type === 'fee_payment'`. Requires DB-level idempotency guard identical to coin-purchase sessions.
- **Transaction_History**: The unified paginated endpoint `GET /api/v1/wallet/history` that returns all `WalletTransaction` records (STRIPE_PURCHASE, GIFT_SEND, TIP_SEND, SUBSCRIPTION, ADMIN_GRANT, REFUND, PAYOUT, PAYOUT_REVERSAL) together with enriched `GiftTransaction` details.
- **roomResolver**: `backend/src/utils/roomResolver.js`. Resolves room objects and participant records for gift operations across room types (`voice`, `live_class`, `pk`, `community`).
- **AES_256_GCM**: The symmetric encryption algorithm used to encrypt `PayoutRequest.accountDetails` at rest, with a key sourced from the `PAYOUT_ENCRYPTION_KEY` environment variable.
- **Subscription_Renewal_Worker**: A BullMQ worker that expires and auto-renews `CreatorSubscription` records whose `expiresAt` has passed.
- **Dispute_Handler**: The Stripe webhook handler for `charge.dispute.created` events.
- **Platform_Revenue_Report**: An admin-only API response summarising total coin sales, total diamonds awarded, total payout USD, and platform share retained within a date range.
- **Economy_Reconciliation**: A scheduled job that cross-checks `WalletTransaction` aggregate totals against `Wallet` balances and flags discrepancies.
- **SUPER_ADMIN**: The platform-level administrator role. Holds no school-scoped education privileges by default and must not receive creator, voice-host, live-participant, or school-member capabilities purely by virtue of having the `SUPER_ADMIN` role.

---

## Requirements

---

### Requirement 1: Central Economy Configuration

**User Story:** As a backend engineer, I want all economy constants defined in one server-side module, so that rate changes are made in one place and inconsistencies across files are eliminated.

#### Acceptance Criteria

1. THE `Economy_Config` SHALL export `PLATFORM_SHARE_PERCENT = 50`, `CREATOR_SHARE_PERCENT = 50`, `DIAMOND_TO_USD = 0.005`, and `PAYOUT_MIN_DIAMONDS = 2000` as named constants.
2. THE `Economy_Config` SHALL export a pure function `toDiamonds(coins)` that returns `Math.floor(coins × (CREATOR_SHARE_PERCENT / 100))`.
3. THE `Economy_Config` SHALL export a pure function `toUsd(diamonds)` that returns `diamonds × DIAMOND_TO_USD` as a number rounded to two decimal places.
4. WHEN any backend module requires economy constants, THE module SHALL import them exclusively from `Economy_Config` and SHALL NOT declare local copies of `DIAMOND_TO_USD`, `PLATFORM_CUT`, `MIN_PAYOUT`, or equivalent.
5. IF the `Economy_Config` module is imported and any required constant is missing or `NaN`, THEN THE application SHALL throw a startup error and refuse to serve requests.
6. FOR ALL valid integer coin inputs `c ≥ 0`, `toDiamonds(c)` SHALL return a non-negative integer and SHALL satisfy `toDiamonds(c) ≤ c`.

---

### Requirement 2: Unified Payout Flow

**User Story:** As a creator, I want a single payout endpoint that correctly calculates my earnings and creates an auditable payout record, so that I receive the right amount and my request is tracked by platform admins.

#### Acceptance Criteria

1. THE platform SHALL expose exactly one payout-submission endpoint: `POST /api/v1/wallet/payout/request` (Payout_Controller).
2. WHEN `POST /api/v1/creators/me/payout-request` is called, THE API SHALL respond with HTTP 410 Gone and a message directing clients to `POST /api/v1/wallet/payout/request`.
3. THE Payout_Controller `requestPayout` function SHALL use `PAYOUT_MIN_DIAMONDS` and `DIAMOND_TO_USD` exclusively from `Economy_Config`.
4. WHEN a payout request is submitted, THE Payout_Controller SHALL create a `PayoutRequest` record with `status = 'PENDING'` and SHALL initiate the admin approval workflow.
5. THE mobile payout screen (`mobile/app/payout-request.tsx`) SHALL call `POST /api/v1/wallet/payout/request` and SHALL NOT call `/api/v1/creators/me/payout-request`.
6. THE web payout page SHALL display the conversion rate sourced from the backend API response and SHALL NOT hardcode `DIAMOND_TO_USD` or any conversion factor in TypeScript source.
7. WHEN a payout request is successfully submitted, THE Payout_Controller SHALL emit a Socket.IO event to the `role:SUPER_ADMIN` room with `{ userId, diamonds, usdAmount, requestedAt }` and SHALL NOT include raw account details in the socket payload.

---

### Requirement 3: Payout State Machine

**User Story:** As a platform admin, I want payout requests to follow strictly defined state transitions, so that no request can skip approval or be processed in an invalid state.

#### Acceptance Criteria

1. THE `PayoutRequest` status field SHALL only contain values in the set `{ PENDING, APPROVED, PROCESSING, COMPLETED, REJECTED, CANCELLED }`.
2. WHEN an admin calls `approve` on a payout request, THE Payout_Controller SHALL only accept the action IF the current status is `PENDING`; otherwise THE Payout_Controller SHALL return HTTP 400.
3. WHEN an admin calls `reject` on a payout request, THE Payout_Controller SHALL only accept the action IF the current status is `PENDING` or `APPROVED`; otherwise THE Payout_Controller SHALL return HTTP 400.
4. WHEN an admin calls `complete` on a payout request, THE Payout_Controller SHALL only accept the action IF the current status is `APPROVED` or `PROCESSING`; otherwise THE Payout_Controller SHALL return HTTP 400.
5. WHEN a user calls `cancel` on a payout request, THE Payout_Controller SHALL only accept the action IF the current status is `PENDING`; otherwise THE Payout_Controller SHALL return HTTP 400.
6. IF a payout request transitions to `REJECTED` or `CANCELLED`, THEN THE Payout_Controller SHALL atomically restore the reserved diamonds to `Wallet.diamonds` and create a `WalletTransaction` of type `PAYOUT_REVERSAL` within the same database transaction.
7. FOR ALL valid state transition sequences, the final `PayoutRequest.status` SHALL match the last applied admin action with no intermediate state persisted if any step in the atomic transaction fails.

---

### Requirement 4: Diamond Reservation on Payout Request

**User Story:** As a platform operator, I want diamonds to be atomically reserved the moment a payout request is created, so that a creator cannot submit two overlapping withdrawal requests for the same balance.

#### Acceptance Criteria

1. WHEN a payout request is submitted, THE Payout_Controller SHALL execute a single Prisma interactive transaction that both deducts `diamonds` from `Wallet` and creates the `PayoutRequest` record.
2. WITHIN the payout transaction, THE Payout_Controller SHALL update the wallet using `WHERE { userId, diamonds: { gte: diamondAmount } }` (Optimistic_Lock) so that a concurrent deduction by a racing request causes one of the transactions to fail with a record-not-found error.
3. IF `Wallet.diamonds` is less than the requested `diamondAmount` at commit time, THEN THE Payout_Controller SHALL roll back the transaction and return HTTP 402 with the user's current balance.
4. THE Payout_Controller SHALL reject a new payout request with HTTP 400 if the user already has a `PayoutRequest` with status `PENDING`, `APPROVED`, or `PROCESSING`.
5. FOR ALL concurrent payout attempts by the same user submitting the same diamond amount simultaneously, at most one `PayoutRequest` SHALL be created and `Wallet.diamonds` SHALL never go below zero.

---

### Requirement 5: Payout Ledger

**User Story:** As a finance auditor, I want every payout event to produce a typed ledger entry, so that the audit trail distinguishes payout reservations and reversals from unrelated refund operations.

#### Acceptance Criteria

1. THE `WalletTransaction` type enum SHALL include `PAYOUT` and `PAYOUT_REVERSAL` as valid values in the Prisma schema.
2. WHEN a `PayoutRequest` is created, THE Payout_Controller SHALL create a `WalletTransaction` with `type = 'PAYOUT'`, `coins = 0`, `diamonds = -diamondAmount`, and `description` referencing the `PayoutRequest.id`, within the same database transaction.
3. WHEN a `PayoutRequest` transitions to `REJECTED` or `CANCELLED`, THE Payout_Controller SHALL create a `WalletTransaction` with `type = 'PAYOUT_REVERSAL'`, `coins = 0`, `diamonds = +diamondAmount`, and `description` referencing the `PayoutRequest.id`, within the same database transaction.
4. THE `WalletTransaction` table SHALL NOT contain any records of `type = 'REFUND'` that were created by payout flows; existing legacy records are exempt from retroactive modification.
5. THE `creator.controller.js` `requestPayout` function SHALL be removed entirely; no code path SHALL write a `WalletTransaction` of type `REFUND` to record a payout action after the consolidation migration.

---

### Requirement 6: Payout Decimal Precision

**User Story:** As a platform operator, I want payout amounts stored as exact decimal values, so that floating-point drift does not cause creators to receive incorrect USD amounts.

#### Acceptance Criteria

1. THE `PayoutRequest.usdAmount` field SHALL be declared as `Decimal(10,2)` in `schema.prisma` (not `Float`).
2. WHEN a `PayoutRequest` is created, THE Payout_Controller SHALL compute `usdAmount` using `Economy_Config.toUsd(diamonds)` and store the result as a `Decimal` value with exactly two decimal places.
3. WHEN the admin payout list endpoint returns `PayoutRequest` records, THE response SHALL serialize `usdAmount` as a string representation of the decimal (e.g., `"10.00"`) and SHALL NOT apply JavaScript floating-point arithmetic to the value before sending.
4. IF a migration to change the column type from `Float` to `Decimal(10,2)` is applied, THEN existing rows SHALL be preserved with their `usdAmount` values rounded to two decimal places.

---

### Requirement 7: Payout Account Security

**User Story:** As a creator, I want my bank account details encrypted at rest, so that a database breach does not expose my financial account information.

#### Acceptance Criteria

1. THE `PayoutRequest.accountDetails` field SHALL be stored as AES_256_GCM-encrypted ciphertext using a key sourced from the `PAYOUT_ENCRYPTION_KEY` environment variable.
2. WHEN a payout request is created, THE Payout_Controller SHALL encrypt `accountDetails` before writing to the database and SHALL NOT persist plaintext account information.
3. WHEN an admin reads a payout request via `GET /api/v1/wallet/payout/admin/list`, THE Payout_Controller SHALL decrypt `accountDetails` server-side and return only a masked summary (e.g., last four characters of account number, account holder name) to the API response.
4. IF `PAYOUT_ENCRYPTION_KEY` is absent or fewer than 32 bytes at startup, THEN THE application SHALL throw a startup error and refuse to accept payout requests.
5. WHEN a creator calls `GET /api/v1/wallet/payout/history`, THE Payout_Controller SHALL return payout records with `accountDetails` fully redacted (empty object or masked fields only).
6. THE encryption key SHALL never appear in application logs, error messages, API responses, or Socket.IO payloads.

---

### Requirement 8: Creator Subscription Concurrency Fix

**User Story:** As a subscriber, I want my subscription payment to be processed atomically without race conditions, so that concurrent subscription attempts cannot overdraft my wallet balance below zero.

#### Acceptance Criteria

1. WHEN `POST /api/v1/creators/:userId/subscribe` is called, THE Creator_Controller SHALL perform the balance check exclusively inside the Prisma interactive transaction, not before it.
2. WITHIN the subscription transaction, THE Creator_Controller SHALL deduct coins using `tx.wallet.update({ where: { userId: subscriberId, coins: { gte: priceCoins } }, data: { coins: { decrement: priceCoins } } })` (Optimistic_Lock).
3. IF the Optimistic_Lock wallet update matches zero rows at commit time, THEN THE Creator_Controller SHALL roll back the transaction and return HTTP 402 with the user's current coin balance.
4. FOR ALL concurrent subscription attempts by the same subscriber to the same tier arriving simultaneously, at most one subscription SHALL be activated and `Wallet.coins` SHALL never go below zero.
5. WHEN the subscription transaction succeeds, THE Creator_Controller SHALL create a `WalletTransaction` record of type `SUBSCRIPTION` inside the same transaction; this write SHALL be treated as a fatal operation and SHALL NOT use `.catch(() => {})` suppression.

---

### Requirement 9: Gift Daily Spend Cap DB Fallback

**User Story:** As a platform operator, I want the daily gift spend cap to be enforced even during Redis outages, so that the cap cannot be bypassed by cache unavailability.

#### Acceptance Criteria

1. WHEN the `gift.controller.js` reads the daily spend cache key and Redis is unavailable (returns `null`), THE Gift_Controller SHALL NOT treat a `null` result as zero spent; instead THE Gift_Controller SHALL query the database for the sum of `GiftTransaction.coinsSpent` for the sender on the current UTC day.
2. THE DB fallback query SHALL use `WHERE { senderId, createdAt: { gte: startOfDayUtc } }` and aggregate `_sum.coinsSpent`.
3. WHEN the DB fallback query returns a value, THE Gift_Controller SHALL apply the daily spend cap check against that value exactly as it would against the Redis value.
4. IF both Redis and the DB fallback query fail, THEN THE Gift_Controller SHALL reject the gift send request with HTTP 503 and log the error, rather than allowing the transaction to proceed without a cap check.
5. WHILE Redis is available and returns a non-null value, THE Gift_Controller SHALL use the cached value without querying the database, preserving the existing fast path.

---

### Requirement 10: Fee Payment DB Idempotency

**User Story:** As a school administrator, I want fee payment webhooks to be idempotent at the database level, so that Stripe retries do not mark a fee as paid multiple times or create duplicate records.

#### Acceptance Criteria

1. THE `stripe.controller.js` fee-payment webhook handler SHALL check for an existing `FeeRecord` with `stripeSessionId = session.id` before applying the update, using the same DB-first idempotency pattern as the coin-purchase handler.
2. WHEN a fee-payment `checkout.session.completed` event arrives and a matching `FeeRecord` already has `status = 'PAID'` with the same `stripeSessionId`, THE Stripe_Controller SHALL return HTTP 200 `{ received: true }` without modifying the database.
3. THE `FeeRecord` model SHALL have a `stripeSessionId` field with a `@unique` constraint so that a concurrent duplicate webhook delivery is rejected by the database constraint (P2002) and caught as an idempotency guard.
4. IF a P2002 unique constraint violation occurs during fee-payment processing, THEN THE Stripe_Controller SHALL log the event as already-processed and return HTTP 200 `{ received: true }`.
5. WHEN Redis is unavailable, THE fee-payment webhook handler SHALL rely on the DB unique constraint as the sole idempotency guard and SHALL NOT return an error or allow duplicate processing.

---

### Requirement 11: Wallet Transaction History

**User Story:** As a user, I want my wallet history to show all financial events including purchases, tips, subscriptions, admin grants, and payouts — not just gift transactions — so that I have a complete picture of my coin and diamond activity.

#### Acceptance Criteria

1. WHEN `GET /api/v1/wallet/history` is called, THE Wallet_Controller SHALL return a paginated list of `WalletTransaction` records for the authenticated user, ordered by `createdAt` descending.
2. THE history response SHALL include transactions of all types: `STRIPE_PURCHASE`, `GIFT_SEND`, `TIP_SEND`, `SUBSCRIPTION`, `ADMIN_GRANT`, `REFUND`, `PAYOUT`, and `PAYOUT_REVERSAL`.
3. WHEN a `WalletTransaction` record has `type = 'GIFT_SEND'` and a linked `giftTxId`, THE Wallet_Controller SHALL join and include the associated `GiftTransaction` fields (`gift.name`, `gift.emoji`, `receiver.firstName`, `receiver.lastName`) in the enriched response.
4. THE history endpoint SHALL accept `page` and `limit` query parameters (defaults: `page=1`, `limit=20`) and SHALL return total count for client-side pagination.
5. THE Wallet_Controller `getTransactionHistory` function SHALL NOT query `GiftTransaction.room` without a valid foreign key; it SHALL remove or replace the `room` include that references a non-FK field.
6. WHERE a user has zero `WalletTransaction` records, THE Wallet_Controller SHALL return an empty array with HTTP 200 and SHALL NOT return an error.

---

### Requirement 12: roomResolver Safety

**User Story:** As a platform engineer, I want the roomResolver to handle all valid room types without throwing, so that gift operations in PK and community rooms do not produce unhandled exceptions.

#### Acceptance Criteria

1. THE `roomResolver.resolveRoom` function SHALL handle `roomType` values `'voice'`, `'live_class'`, `'pk'`, and `'community'` without throwing an exception.
2. THE `roomResolver.resolveParticipant` function SHALL handle `roomType` values `'voice'`, `'live_class'`, `'pk'`, and `'community'` without throwing an exception.
3. WHEN `resolveRoom` is called with an unrecognised `roomType`, THE function SHALL return `null` rather than throwing, allowing the caller to return HTTP 404.
4. WHEN `resolveParticipant` is called with an unrecognised `roomType`, THE function SHALL return `null` rather than throwing, allowing the caller to return HTTP 403.
5. WHEN `roomType = 'pk'`, THE `resolveRoom` function SHALL query `PKMatch` for an active match associated with the given `roomId` and return a normalised object with at minimum `{ id, status }`.
6. WHEN `roomType = 'community'`, THE `resolveRoom` function SHALL query the `Community` model for the given `roomId` and return a normalised object compatible with the gift controller's room validation logic.

---

### Requirement 13: WalletTransaction Ledger Atomicity

**User Story:** As a finance auditor, I want every critical wallet mutation to produce a corresponding ledger record or fail entirely, so that silent audit gaps cannot occur in production.

#### Acceptance Criteria

1. WHEN a `WalletTransaction` write is performed inside a Prisma interactive transaction for a gift send, tip send, or subscription flow, THE write SHALL be treated as a fatal step; the `.catch(() => {})` suppression pattern SHALL be removed from these writes.
2. IF a `WalletTransaction` write fails inside a Prisma interactive transaction for a gift send, tip send, or subscription, THEN THE entire transaction SHALL roll back and the API SHALL return HTTP 500.
3. THE `gift.controller.js` `sendGift` and `sendGiftToAll` functions SHALL remove the `.catch(() => {})` on the `walletTransaction.create` call inside the Prisma interactive transaction.
4. THE `creator.controller.js` `subscribe` and `sendTip` functions SHALL remove the `.catch(() => {})` on the `walletTransaction.create` call inside the Prisma interactive transaction.
5. WHERE a `WalletTransaction` write fails due to a non-fatal operational reason outside a financial transaction (e.g., a post-hoc analytics write after a committed transaction), THE system MAY log the failure with `logger.error` and continue without propagating the error.

---

### Requirement 14: Creator Economy Tests

**User Story:** As a backend engineer, I want comprehensive test coverage for payout and creator subscription flows, so that regressions in financial logic are caught before reaching production.

#### Acceptance Criteria

1. THE codebase SHALL contain a test file `backend/src/tests/payout.test.js` that covers the following scenarios: successful payout request creation with correct diamond reservation; rejection of payout requests below minimum diamonds; rejection when `diamonds >= requested` check fails (insufficient balance); concurrent payout requests by the same user result in at most one success; admin approve, reject, and complete transitions; diamond restoration on rejection; HTTP 410 response from the deprecated creator payout endpoint.
2. THE codebase SHALL contain a test file `backend/src/tests/creator.test.js` that covers the following scenarios: successful subscription with coin deduction and diamond credit; concurrent subscription attempts by the same subscriber result in at most one activation and no overdraft; rejection when coin balance is insufficient; tip send with diamond credit; creator dashboard data accuracy.
3. WHEN `payout.test.js` tests concurrent payout requests, THE test SHALL submit at least two simultaneous requests and assert that `Wallet.diamonds` remains non-negative after all requests complete.
4. WHEN `creator.test.js` tests concurrent subscriptions, THE test SHALL submit at least two simultaneous requests and assert that `Wallet.coins` remains non-negative after all requests complete.
5. THE tests in `payout.test.js` and `creator.test.js` SHALL use Jest 29 and Supertest, consistent with the existing test suite conventions in the repository.

---

### Requirement 15: Subscription Renewal Worker

**User Story:** As a creator subscriber, I want my subscription to expire at the correct time and be auto-renewable, so that access to creator content is consistently gated by subscription validity.

#### Acceptance Criteria

1. THE platform SHALL include a BullMQ worker (`subscription-renewal.worker.js`) that processes subscription expiry jobs.
2. WHEN `CreatorSubscription.expiresAt` passes, THE Subscription_Renewal_Worker SHALL update the subscription `status` to `EXPIRED` if the subscriber has insufficient coins to renew.
3. WHERE a subscriber has sufficient coins for renewal and has not explicitly cancelled, THE Subscription_Renewal_Worker SHALL attempt to renew the subscription by deducting coins atomically using the Optimistic_Lock pattern and extending `expiresAt` by 30 days.
4. WHEN renewal deduction succeeds, THE Subscription_Renewal_Worker SHALL create a `WalletTransaction` of type `SUBSCRIPTION` inside the renewal transaction.
5. IF renewal deduction fails due to insufficient coins, THEN THE Subscription_Renewal_Worker SHALL set `status = 'EXPIRED'` and notify the subscriber via the platform notification service.
6. THE Subscription_Renewal_Worker SHALL use the `CreatorSubscription.expiresAt` index for efficient batch queries and SHALL process renewals in configurable batch sizes (default: 100 per run).

---

### Requirement 16: Stripe Dispute Handling

**User Story:** As a platform operator, I want disputed Stripe payments to trigger an automated internal workflow, so that the platform can respond to chargebacks before the dispute deadline.

#### Acceptance Criteria

1. THE `stripe.controller.js` webhook handler SHALL handle the `charge.dispute.created` event type.
2. WHEN a `charge.dispute.created` event is received, THE Stripe_Controller SHALL retrieve the `paymentIntentId` from the dispute object and look up the corresponding `WalletTransaction` by `stripeSessionId` or related metadata.
3. WHEN a matching `WalletTransaction` is found, THE Stripe_Controller SHALL create an internal dispute record or flag on the transaction with `status = 'DISPUTED'` and record `dispute.amount`, `dispute.reason`, and `dispute.evidence_due_by`.
4. WHEN a `charge.dispute.created` event is received, THE Stripe_Controller SHALL emit a Socket.IO event to the `role:SUPER_ADMIN` room with `{ disputeId, userId, amount, reason, evidenceDueBy }`.
5. THE Stripe_Controller SHALL log all `charge.dispute.created` events at `logger.warn` level regardless of whether a matching transaction is found, to ensure no dispute goes unlogged.
6. IF no matching `WalletTransaction` is found for the disputed charge, THEN THE Stripe_Controller SHALL log a `logger.error` entry and return HTTP 200 `{ received: true }` to prevent Stripe from retrying.

---

### Requirement 17: Platform Revenue Reporting API

**User Story:** As a SUPER_ADMIN, I want a platform revenue report endpoint, so that I can see total coin sales, diamond awards, platform share retained, and payout liability at a glance.

#### Acceptance Criteria

1. THE platform SHALL expose `GET /api/v1/admin/economy/revenue-report` accessible only to users with the `SUPER_ADMIN` role.
2. THE endpoint SHALL accept `startDate` and `endDate` query parameters (ISO 8601 date strings) to scope the report.
3. WHEN the revenue report is requested, THE report SHALL include: total coins purchased via Stripe (`sum of WalletTransaction.coins WHERE type = 'STRIPE_PURCHASE'`); total coins spent on gifts (`sum of abs(coins) WHERE type = 'GIFT_SEND'`); total diamonds awarded to creators (`sum of diamondsEarned FROM GiftTransaction`); total USD in completed payouts (`sum of usdAmount FROM PayoutRequest WHERE status = 'COMPLETED'`); pending payout liability in USD (`sum of usdAmount FROM PayoutRequest WHERE status IN ('PENDING','APPROVED','PROCESSING')`); platform share retained (coins spent on gifts multiplied by `PLATFORM_SHARE_PERCENT / 100`, expressed in coins and USD equivalent).
4. THE revenue report endpoint SHALL complete within 5 seconds for date ranges up to 90 days on production dataset sizes.
5. WHERE the requested date range exceeds 90 days, THE Reporting_Controller SHALL return HTTP 400 with a message indicating the maximum allowed range.

---

### Requirement 18: Economy Reconciliation

**User Story:** As a platform operator, I want a scheduled reconciliation job that cross-checks wallet balances against ledger aggregates, so that any balance discrepancy is detected and alerted before it compounds.

#### Acceptance Criteria

1. THE platform SHALL include a reconciliation worker (`economy-reconciliation.worker.js`) that runs on a configurable schedule (default: daily at 02:00 UTC).
2. WHEN the reconciliation worker runs, THE worker SHALL for each `Wallet` record compute the expected coin balance as the sum of all `WalletTransaction.coins` for that user and compare it against `Wallet.coins`.
3. IF the computed expected balance differs from `Wallet.coins` by more than zero, THEN THE reconciliation worker SHALL log a `logger.error` entry with `{ userId, expected, actual, delta }` and increment a Prometheus counter `economy_reconciliation_discrepancies_total`.
4. THE reconciliation worker SHALL NOT modify `Wallet` balances automatically; it SHALL only report discrepancies.
5. WHEN the reconciliation worker completes a run without discrepancies, THE worker SHALL log a `logger.info` entry with the count of wallets checked and set a Prometheus gauge `economy_reconciliation_last_run_timestamp` to the current Unix timestamp.
6. THE reconciliation worker SHALL process wallets in batches of configurable size (default: 500) to avoid memory exhaustion on large datasets.

---

### Requirement 19: Web and Mobile Payout Parity

**User Story:** As a product owner, I want the web and mobile payout screens to read all financial constants from the backend API, so that no rate, minimum, or fee percentage is hardcoded in frontend or mobile source files.

#### Acceptance Criteria

1. THE frontend payout page SHALL display conversion rate, minimum payout diamonds, minimum payout USD, and platform fee percentage values sourced exclusively from the `GET /api/v1/wallet/payout/info` API response.
2. THE mobile payout screen SHALL call `GET /api/v1/wallet/payout/info` (NOT `/api/v1/creators/me/payout-info`) to retrieve balance and conversion information.
3. THE `GET /api/v1/wallet/payout/info` endpoint SHALL return `{ diamonds, usdValue, minPayout, minPayoutUsd, conversionRate, platformFeeRate, canRequest }` computed server-side using `Economy_Config` constants.
4. THE frontend TypeScript source SHALL contain no occurrences of the literal string `0.005` or `DIAMOND_TO_USD` used as a numeric assignment or calculation outside of test files.
5. THE mobile React Native source SHALL compute the USD preview by parsing `conversionRate` and `platformFeeRate` from the API response fields; it SHALL NOT compute the conversion from a string like `"100 diamonds = $1"` via fragile string-split logic.
6. WHEN the backend `Economy_Config` constants change, THE web and mobile payout screens SHALL reflect the new values on the next API call without requiring a frontend code change or redeployment.

---

### Requirement 20: SUPER_ADMIN Economy Isolation

**User Story:** As a security engineer, I want the SUPER_ADMIN role to be isolated from economy participation roles, so that platform administrators cannot accidentally or intentionally acquire creator, voice-host, or school-member privileges through their admin role alone.

#### Acceptance Criteria

1. WHEN `POST /api/v1/creators/me/become` is called by a user whose `User.role = 'SUPER_ADMIN'`, THE Creator_Controller SHALL return HTTP 403 with message `'Platform administrators cannot become creators'`.
2. WHEN a `SUPER_ADMIN` user attempts to join a voice room as HOST or SPEAKER via any voice room API endpoint, THE Voice_Controller SHALL return HTTP 403.
3. WHEN a `SUPER_ADMIN` user attempts to join a live class as a participant via `POST /api/v1/live-class/:id/join`, THE Live_Class_Controller SHALL return HTTP 403.
4. WHEN a `SUPER_ADMIN` user is added to a school via `POST /api/v1/schools/:id/members`, THE School_Controller SHALL return HTTP 403 with message `'SUPER_ADMIN cannot hold a school membership role'`.
5. THE `SUPER_ADMIN` isolation rules SHALL be enforced at the controller layer for each affected endpoint and SHALL NOT be bypassable by any client-supplied parameter, header, or body field.
6. WHEN a `SUPER_ADMIN` user sends a gift via `POST /api/v1/voice/:id/gifts`, THE Gift_Controller SHALL return HTTP 403 before deducting any coins.
