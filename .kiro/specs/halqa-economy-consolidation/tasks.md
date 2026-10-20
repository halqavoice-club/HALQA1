# Tasks — Halqa Economy Consolidation

## Implementation Status Key
- [ ] Not started
- [x] Complete

---

## Phase 1 — Economy Configuration (Foundation)

### Task 1.1 — Create `economy.config.js` singleton
- [ ] Create `backend/src/services/economy.config.js`
  - Export named constants: `PLATFORM_SHARE_PERCENT = 50`, `CREATOR_SHARE_PERCENT = 50`, `DIAMOND_TO_USD = 0.005`, `PAYOUT_MIN_DIAMONDS = 2000`
  - Export pure functions: `toDiamonds(coins)`, `toUsd(diamonds)`, `platformShare(coins)`
  - Run startup validation: throw `ConfigurationError` if any constant is missing, null, or NaN
  - `toDiamonds(c)` must return `Math.floor(c * CREATOR_SHARE_PERCENT / 100)`
  - `toUsd(d)` must return `parseFloat((d * DIAMOND_TO_USD).toFixed(2))`
  - `platformShare(c)` must return `Math.floor(c * PLATFORM_SHARE_PERCENT / 100)`

**Files affected:**
- `backend/src/services/economy.config.js` (NEW)

**Files protected:**
- All existing controllers (read-only in this task)
- All existing migrations

**Dependencies:** None

**Tests:** Verify in Task 1.2

**Security checks:**
- Constants must not be read from environment variables at runtime (they are fixed platform policy)
- Startup validation prevents silent misconfiguration

**Migration impact:** None

**Rollback:** Delete new file — zero impact on existing code

**Acceptance criteria:**
- [ ] File exists and exports all 4 constants + 3 functions
- [ ] Startup validation throws on invalid config
- [ ] `toDiamonds(100)` === 50
- [ ] `toUsd(2000)` === "10.00"
- [ ] `platformShare(100)` === 50
- [ ] `toDiamonds(c) + platformShare(c) === c` for all even integers ≥ 0 (no rounding loss)

---

### Task 1.2 — Unit tests for `economy.config.js`
- [ ] Create `backend/src/tests/economy-config.test.js`
  - Test `toDiamonds` for boundary values: 0, 1, 2, 99, 100, 1000
  - Test `toUsd` for boundary values: 0, 1, 2000, 10000
  - Test `platformShare` for boundary values
  - Test startup validation throws on missing constant
  - Test `PLATFORM_SHARE_PERCENT + CREATOR_SHARE_PERCENT === 100`

**Files affected:**
- `backend/src/tests/economy-config.test.js` (NEW)

**Files protected:** All production code

**Dependencies:** Task 1.1

**Acceptance criteria:**
- [ ] All tests pass
- [ ] No production file modified

---

## Phase 2 — Central Config Adoption

### Task 2.1 — Replace hardcoded constants in `payout.controller.js`
- [ ] Import `PAYOUT_MIN_DIAMONDS`, `DIAMOND_TO_USD`, `toUsd` from `economy.config.js`
- [ ] Remove local `const DIAMOND_TO_USD = 0.005` and `const MIN_PAYOUT_DIAMONDS = 2000`
- [ ] Replace all `MIN_PAYOUT_USD`, `MIN_PAYOUT_DIAMONDS` usages with config imports
- [ ] Replace `diamondAmount * DIAMOND_TO_USD` with `toUsd(diamondAmount)`

**Files affected:**
- `backend/src/controllers/payout.controller.js`

**Files protected:**
- `backend/src/tests/sprint8-refund.test.js` (must not break)
- `backend/prisma/migrations/` (untouched)

**Dependencies:** Task 1.1

**Tests:** Existing payout routes tests must still pass after this change

**Security checks:** No logic change — pure constant substitution

**Migration impact:** None

**Rollback:** Revert import changes (local constants were functionally equivalent)

**Acceptance criteria:**
- [ ] No local `DIAMOND_TO_USD` or `MIN_PAYOUT_DIAMONDS` constants remain in `payout.controller.js`
- [ ] All existing payout controller behaviour is unchanged
- [ ] `npm test` passes for payout-related tests

---

### Task 2.2 — Replace hardcoded constants in `creator.controller.js`
- [ ] Import `PAYOUT_MIN_DIAMONDS`, `DIAMOND_TO_USD`, `toUsd`, `toDiamonds`, `PLATFORM_CUT` from `economy.config.js`
- [ ] Remove local `const PLATFORM_CUT = 0.5` and `const toDiamonds = ...`
- [ ] Remove local `const DIAMOND_TO_USD = parseFloat(process.env.DIAMOND_TO_USD || '100')`
- [ ] Remove local `const MIN_PAYOUT = parseInt(process.env.MIN_PAYOUT_DIAMONDS || '1000')`
- [ ] Replace all usages of the removed local symbols with config imports

**Files affected:**
- `backend/src/controllers/creator.controller.js`

**Files protected:**
- `backend/src/tests/sprint8-refund.test.js`

**Dependencies:** Task 1.1

**CRITICAL STOP CONDITION:** If the existing `DIAMOND_TO_USD = 100` env-driven constant is discovered to have already been deployed and used for real payouts in production, stop this task, report the discrepancy, and await explicit authorization before proceeding with the rate change.

**Security checks:** Verify no env var can now override the platform rate

**Migration impact:** None (behaviour change: creator payout rate normalised to 0.005 from 100 — this is intentional, but see stop condition above)

**Rollback:** Revert import changes

**Acceptance criteria:**
- [ ] No local economy constants remain in `creator.controller.js`
- [ ] `toDiamonds` in `creator.controller.js` uses `economy.config.js` implementation
- [ ] All existing creator subscription and tip logic unchanged

---

### Task 2.3 — Replace hardcoded constants in `gift.controller.js`
- [ ] Import `PLATFORM_CUT`, `toDiamonds`, `platformShare` from `economy.config.js`
- [ ] Remove local `const PLATFORM_CUT = 0.5` and local `function toDiamonds(coins)`
- [ ] Verify `DAILY_CAP` remains driven by `GIFT_DAILY_CAP` env var (this is a configurable cap, not a platform constant — keep as-is)

**Files affected:**
- `backend/src/controllers/gift.controller.js`

**Files protected:**
- `backend/src/tests/gift.test.js` (must not break)
- Existing gift optimistic lock logic (do not alter)
- Existing Stripe idempotency (untouched)

**Dependencies:** Task 1.1

**Tests:** Run `gift.test.js` after change — all must pass

**Acceptance criteria:**
- [ ] No local `PLATFORM_CUT` or `toDiamonds` function in `gift.controller.js`
- [ ] `gift.test.js` passes unchanged

---

## Phase 3 — Database Migrations

### Task 3.1 — Migration M-A: Add `diamonds` column to `wallet_transactions`
- [ ] Create migration `backend/prisma/migrations/20260921_add_diamonds_to_wallet_transactions/migration.sql`
  ```sql
  ALTER TABLE wallet_transactions
    ADD COLUMN diamonds INT NOT NULL DEFAULT 0
      COMMENT 'Diamond delta for this transaction. 0 for coin-only records.';
  ```
- [ ] Update `schema.prisma` `WalletTransaction` model: add `diamonds Int @default(0)`
- [ ] Run `npx prisma generate`
- [ ] Verify all existing `walletTransaction.create` calls still compile (adding `diamonds: 0` is optional since it has a default)

**Files affected:**
- `backend/prisma/migrations/20260921_add_diamonds_to_wallet_transactions/migration.sql` (NEW)
- `backend/prisma/schema.prisma`

**Files protected:**
- All existing migrations (must not be edited)

**Dependencies:** Tasks 2.1–2.3 (constants adopted before schema change)

**Migration impact:**
- Non-breaking: adds column with DEFAULT 0 — zero downtime
- All existing rows back-filled to 0 automatically by MySQL DEFAULT

**Rollback:** `ALTER TABLE wallet_transactions DROP COLUMN diamonds;`

**Acceptance criteria:**
- [ ] Migration file exists and is valid SQL
- [ ] `schema.prisma` updated with `diamonds Int @default(0)` on `WalletTransaction`
- [ ] `npx prisma generate` succeeds
- [ ] `npx prisma migrate deploy` runs cleanly on a test DB
- [ ] All existing tests pass after regeneration

---

### Task 3.2 — Migration M-B: `payout_requests.usdAmount` Float → Decimal(10,2)
- [ ] Create migration `backend/prisma/migrations/20260921_payout_usd_amount_decimal/migration.sql`
  ```sql
  ALTER TABLE payout_requests
    MODIFY COLUMN usd_amount DECIMAL(10,2) NOT NULL
      COMMENT 'USD value stored as exact decimal, 2dp precision.';
  ```
- [ ] Update `schema.prisma` `PayoutRequest.usdAmount` from `Float` to `Decimal @db.Decimal(10, 2)`
- [ ] Run `npx prisma generate`
- [ ] Add pre-migration verification step: `SELECT id FROM payout_requests WHERE usd_amount != ROUND(usd_amount, 2)` — if any rows found, run data-fix first

**Files affected:**
- `backend/prisma/migrations/20260921_payout_usd_amount_decimal/migration.sql` (NEW)
- `backend/prisma/schema.prisma`

**Files protected:**
- All existing migration files

**Dependencies:** Task 3.1

**Migration impact:**
- Breaking if any `usdAmount` has more than 2 decimal places (unlikely: derived from `diamonds * 0.005`)
- Run verification query before deploying

**Rollback:** `ALTER TABLE payout_requests MODIFY COLUMN usd_amount FLOAT NOT NULL;`

**Acceptance criteria:**
- [ ] Migration SQL is valid
- [ ] `schema.prisma` has `usdAmount Decimal @db.Decimal(10, 2)`
- [ ] `npx prisma generate` succeeds
- [ ] Payout controller serialises `usdAmount` as string in API responses (no JS float arithmetic applied)

---

### Task 3.3 — Migration M-C: Add `stripeSessionId` unique to `FeeRecord`
- [ ] Inspect `schema.prisma` for `FeeRecord` model and verify current columns
- [ ] Create migration `backend/prisma/migrations/20260921_fee_record_stripe_session_id/migration.sql`
  ```sql
  ALTER TABLE fee_records
    ADD COLUMN stripe_session_id VARCHAR(255) NULL
      COMMENT 'Stripe Checkout session ID for idempotency guard.',
    ADD UNIQUE INDEX uq_fee_stripe_session (stripe_session_id);
  ```
- [ ] Update `schema.prisma` `FeeRecord` model: add `stripeSessionId String? @unique @db.VarChar(255)`
- [ ] Run `npx prisma generate`

**Files affected:**
- `backend/prisma/migrations/20260921_fee_record_stripe_session_id/migration.sql` (NEW)
- `backend/prisma/schema.prisma`

**Files protected:**
- All existing migration files
- `stripe.controller.js` (updated in Task 5.2, not here)

**Dependencies:** Task 3.2

**Migration impact:**
- Non-breaking: nullable column with unique index — existing rows have `NULL` which does not trigger unique violation

**Rollback:** `ALTER TABLE fee_records DROP INDEX uq_fee_stripe_session, DROP COLUMN stripe_session_id;`

**Acceptance criteria:**
- [ ] Migration SQL valid
- [ ] `FeeRecord` in `schema.prisma` has `stripeSessionId String? @unique @db.VarChar(255)`
- [ ] `npx prisma generate` succeeds
- [ ] Existing fee payment flow continues to work (stripeSessionId is null for legacy records)

---

### Task 3.4 — Migration M-D: Document `PAYOUT`, `PAYOUT_REVERSAL`, `DISPUTED` types
- [ ] Create migration `backend/prisma/migrations/20260921_wallet_transaction_new_types/migration.sql`
  ```sql
  -- Informational migration: no DDL change.
  -- Documents that wallet_transactions.type now accepts:
  --   PAYOUT           : diamond reservation on payout request creation
  --   PAYOUT_REVERSAL  : diamond restoration on reject/cancel
  --   DISPUTED         : coin-purchase transaction flagged by Stripe dispute
  SELECT 'M-D: PAYOUT, PAYOUT_REVERSAL, DISPUTED are now valid type values.' AS note;
  ```
- [ ] Update `WalletTransaction` model comment in `schema.prisma` to include `PAYOUT | PAYOUT_REVERSAL | DISPUTED`

**Files affected:**
- `backend/prisma/migrations/20260921_wallet_transaction_new_types/migration.sql` (NEW)
- `backend/prisma/schema.prisma` (comment update only)

**Files protected:** All existing data

**Dependencies:** Task 3.1

**Migration impact:** None (no DDL)

**Rollback:** Delete migration file — no data affected

**Acceptance criteria:**
- [ ] Migration file exists and is harmless to deploy
- [ ] Schema comment updated

---

## Phase 4 — Payout Encryption

### Task 4.1 — Create `encryption.js` utility
- [ ] Create `backend/src/utils/encryption.js`
  - Implement `encrypt(plaintext)` → AES-256-GCM, returns `base64(iv):base64(tag):base64(ciphertext)`
  - Implement `decrypt(ciphertext)` → verifies GCM auth tag, returns plaintext or throws
  - Implement `maskAccountDetails(decryptedJson)` → returns `{ accountHolder, accountLast4 }`
  - Implement `getEncryptionKey()` → reads `PAYOUT_ENCRYPTION_KEY` env var, throws if missing or < 32 bytes
  - Key sliced to exactly 32 bytes from UTF-8 encoding

**Files affected:**
- `backend/src/utils/encryption.js` (NEW)

**Files protected:** All existing utilities

**Dependencies:** None

**Tests:** Covered in Task 4.2

**Security checks:**
- Key must never appear in logs, error messages, or API responses
- Auth tag verification must throw on tampered ciphertext
- IV must be random per encryption call (never reused)

**Migration impact:** None

**Rollback:** Delete new file

**Acceptance criteria:**
- [ ] `encrypt(x)` then `decrypt(result)` === x for arbitrary strings
- [ ] Tampered ciphertext throws during decryption
- [ ] Missing key throws at call time (not at startup — key is only needed for payout operations)
- [ ] IV randomness: two calls to `encrypt` with same input produce different ciphertexts

---

### Task 4.2 — Unit tests for `encryption.js`
- [ ] Create `backend/src/tests/encryption.test.js`
  - Round-trip test: encrypt → decrypt === original
  - Tamper test: mutate ciphertext → decrypt throws
  - Missing key test: throws with descriptive error
  - Short key test: throws when key < 32 bytes
  - IV randomness test: same plaintext → different ciphertext on each call
  - `maskAccountDetails` test: last4 and holder extraction

**Files affected:**
- `backend/src/tests/encryption.test.js` (NEW)

**Files protected:** All production code

**Dependencies:** Task 4.1

**Acceptance criteria:**
- [ ] All tests pass
- [ ] No env var leakage in test output

---

### Task 4.3 — Apply encryption to payout `accountDetails`
- [ ] Import `encrypt`, `decrypt`, `maskAccountDetails` from `encryption.js` in `payout.controller.js`
- [ ] In `requestPayout`: call `encrypt(JSON.stringify(accountDetails))` before `payoutRequest.create`
- [ ] In `listPayoutsAdmin`: call `decrypt` on each record's `accountDetails`, then `maskAccountDetails` for the API response
- [ ] In `processPayoutAdmin`: call `decrypt` for admin inspection when needed
- [ ] In `getPayoutHistory` (user-facing): return `accountDetails: {}` (fully redacted, no decryption)
- [ ] Add startup check: if `PAYOUT_ENCRYPTION_KEY` is absent, log `error` and set a flag that blocks payout request creation (but does not crash the entire server — payout is one subsystem)

**Files affected:**
- `backend/src/controllers/payout.controller.js`
- `backend/src/utils/encryption.js` (read)

**Files protected:**
- `backend/src/tests/sprint8-refund.test.js` (mock `encrypt`/`decrypt` in tests)
- Existing payout route structure

**Dependencies:** Tasks 4.1, 2.1

**Security checks:**
- Never log decrypted account details
- Never return full account details to non-admin callers
- Mask in admin response: `{ accountHolder: "Jane Doe", accountLast4: "mail" }`

**Migration impact:**
- Existing plaintext `accountDetails` rows: write a migration script `scripts/encrypt-account-details.js` that encrypts them in place
- Script must be idempotent: skip records that already look like `iv:tag:ciphertext` format

**Rollback:** Remove encryption calls from controller; run decryption migration script to restore plaintext (data format is reversible)

**Acceptance criteria:**
- [ ] New payout requests store encrypted `accountDetails`
- [ ] Admin list returns only masked summary
- [ ] User history returns empty `accountDetails`
- [ ] `scripts/encrypt-account-details.js` exists and is idempotent
- [ ] No plaintext credentials in logs

---

## Phase 5 — Unified Payout Flow

### Task 5.1 — Remove `requestPayout` and `getPayoutInfo` from `creator.controller.js`
- [ ] Delete the `requestPayout` function body from `creator.controller.js`
- [ ] Delete the `getPayoutInfo` function body from `creator.controller.js`
- [ ] Delete `const DIAMOND_TO_USD` and `const MIN_PAYOUT` local constants (already done in Task 2.2)
- [ ] Update `module.exports` to remove `requestPayout` and `getPayoutInfo`

**Files affected:**
- `backend/src/controllers/creator.controller.js`

**Files protected:**
- All other creator controller functions (becomeCreator, subscribe, sendTip, etc.)
- `backend/src/tests/sprint8-refund.test.js`

**Dependencies:** Task 2.2 (constants replaced), Tasks 4.3 (encryption in payout controller)

**STOP CONDITION:** Confirm `POST /api/v1/wallet/payout/request` is fully functional (Tasks 2.1, 4.3, 5.3 complete) before removing the creator payout functions. Do not leave users without a working payout path.

**Acceptance criteria:**
- [ ] `creator.controller.js` no longer exports `requestPayout` or `getPayoutInfo`
- [ ] No `DIAMOND_TO_USD`, `MIN_PAYOUT`, `PLATFORM_CUT` local constants remain in the file

---

### Task 5.2 — Deprecate creator payout routes (HTTP 410)
- [ ] In `creator.routes.js`, replace the `POST /me/payout-request` handler with a 410 response:
  ```js
  router.post('/me/payout-request', (req, res) => {
    return res.status(410).json({
      success: false,
      message: 'This endpoint has been removed. Use POST /api/v1/wallet/payout/request'
    });
  });
  ```
- [ ] Replace the `GET /me/payout-info` handler with a redirect response pointing to `GET /api/v1/wallet/payout/info`

**Files affected:**
- `backend/src/routes/creator.routes.js`

**Files protected:**
- All other creator routes (subscribe, tip, profile, tiers)

**Dependencies:** Task 5.1

**Tests:** Verify 410 response in `payout.test.js` (Task 8.1)

**Rollback:** Restore original handlers (requires Task 5.1 rollback too)

**Acceptance criteria:**
- [ ] `POST /api/v1/creators/me/payout-request` returns HTTP 410
- [ ] `GET /api/v1/creators/me/payout-info` redirects or returns 410 with a link to the replacement endpoint

---

### Task 5.3 — Add optimistic lock and PAYOUT ledger to `payout.controller.requestPayout`
- [ ] Inside `requestPayout` Prisma transaction, replace the existing `wallet.update` with:
  ```js
  const updatedWallet = await tx.wallet.update({
    where: { userId, diamonds: { gte: diamondAmount } },
    data:  { diamonds: { decrement: diamondAmount } }
  });
  ```
  If this update affects 0 rows, the transaction will throw `P2025` — catch this and return HTTP 402
- [ ] Inside the same transaction, after `payoutRequest.create`, add:
  ```js
  await tx.walletTransaction.create({
    data: {
      userId,
      type:          'PAYOUT',
      coins:         0,
      diamonds:      -diamondAmount,
      description:   `Payout request ${request.id}: ${diamondAmount} diamonds reserved`,
    }
  });
  ```
  This write is **fatal** — do NOT use `.catch(() => {})`
- [ ] Import `toUsd` from `economy.config.js` and replace manual USD calculation

**Files affected:**
- `backend/src/controllers/payout.controller.js`

**Files protected:**
- Existing `cancelPayout`, `listPayoutsAdmin`, `processPayoutAdmin` (untouched in this task)
- `backend/src/tests/sprint8-refund.test.js`

**Dependencies:** Tasks 2.1, 3.1 (diamonds column on WalletTransaction)

**Security checks:** Optimistic lock prevents double-spend under concurrent requests

**Migration impact:** Requires M-A (diamonds column) to be deployed first

**Rollback:** Revert to previous transaction implementation (remove OL and PAYOUT ledger write)

**Acceptance criteria:**
- [ ] Two simultaneous payout requests result in at most one `PayoutRequest` created
- [ ] `Wallet.diamonds` never goes below zero under concurrent load
- [ ] Every successful payout request creates a `WalletTransaction(type='PAYOUT', diamonds=-N)`
- [ ] P2025 (optimistic lock miss) returns HTTP 402 with current balance

---

### Task 5.4 — Add PAYOUT_REVERSAL ledger to `payout.controller.processPayoutAdmin` (reject path)
- [ ] In the `reject` branch of `processPayoutAdmin`, add `walletTransaction.create` inside the transaction:
  ```js
  await tx.walletTransaction.create({
    data: {
      userId:      request.userId,
      type:        'PAYOUT_REVERSAL',
      coins:       0,
      diamonds:    +request.diamonds,
      description: `Payout ${id} rejected by admin ${req.user.id}: ${adminNote || 'no note'}`,
    }
  });
  ```
- [ ] Apply the same PAYOUT_REVERSAL pattern to `cancelPayout` (user-initiated cancel)

**Files affected:**
- `backend/src/controllers/payout.controller.js`

**Files protected:**
- Approve and complete branches (untouched)
- `backend/src/tests/sprint8-refund.test.js`

**Dependencies:** Task 5.3

**Migration impact:** Requires M-A (diamonds column)

**Rollback:** Remove PAYOUT_REVERSAL create calls

**Acceptance criteria:**
- [ ] Rejected payout creates `WalletTransaction(type='PAYOUT_REVERSAL', diamonds=+N)`
- [ ] Cancelled payout creates `WalletTransaction(type='PAYOUT_REVERSAL', diamonds=+N)`
- [ ] Diamond balance is atomically restored in the same transaction as status change
- [ ] Admin note is recorded in the reversal description

---

### Task 5.5 — Add `GET /wallet/payout/info` endpoint
- [ ] Add `getPayoutInfo` function to `payout.controller.js` using `economy.config.js` for all rate values
- [ ] Add route `GET /wallet/payout/info` to `payout.routes.js`
- [ ] Response must include: `diamonds`, `usdValue` (string), `minPayoutDiamonds`, `minPayoutUsd` (string), `diamondToUsd`, `platformSharePercent`, `canRequest`, `totalEarned`, `pendingRequest` (or null)
- [ ] Remove equivalent function from `creator.controller.js` (already done in Task 5.1)

**Files affected:**
- `backend/src/controllers/payout.controller.js`
- `backend/src/routes/payout.routes.js`

**Files protected:** All existing payout routes

**Dependencies:** Tasks 2.1, 5.1

**Acceptance criteria:**
- [ ] `GET /api/v1/wallet/payout/info` returns all required fields
- [ ] `usdValue` and `minPayoutUsd` are string decimals (e.g., `"10.00"`)
- [ ] `diamondToUsd` matches `economy.config.DIAMOND_TO_USD`
- [ ] `canRequest` is false if user has a pending/approved/processing request

---

## Phase 6 — Creator Subscription Concurrency Fix

### Task 6.1 — Fix optimistic lock in `creator.controller.subscribe`
- [ ] Remove the pre-transaction balance check:
  ```js
  // DELETE:
  const wallet = await prisma.wallet.findUnique({ where: { userId: subscriberId } });
  if (!wallet || wallet.coins < tier.priceCoins) { return errorResponse(...) }
  ```
- [ ] Inside the Prisma transaction, replace the plain `wallet.update` coin deduction with:
  ```js
  await tx.wallet.update({
    where: { userId: subscriberId, coins: { gte: tier.priceCoins } },
    data:  { coins: { decrement: tier.priceCoins }, totalSpent: { increment: tier.priceCoins } }
  });
  ```
- [ ] Catch `P2025` (record not found = optimistic lock miss) and return HTTP 402 with user's balance
- [ ] Remove `.catch(() => {})` from the `walletTransaction.create` call inside the transaction — make it fatal

**Files affected:**
- `backend/src/controllers/creator.controller.js`

**Files protected:**
- All other creator controller functions
- `backend/src/tests/sprint8-refund.test.js`

**Dependencies:** Tasks 2.2, 3.1

**Tests:** Covered in Task 8.2 (creator.test.js concurrent subscription test)

**Security checks:** Optimistic lock prevents wallet overdraft under concurrent subscribe requests

**Migration impact:** None (wallet already has CHECK constraint coins >= 0)

**Rollback:** Restore previous balance check + plain update (less safe but functionally equivalent for single requests)

**Acceptance criteria:**
- [ ] Two simultaneous subscribe requests for the same user result in at most one successful subscription
- [ ] `Wallet.coins` never goes below zero
- [ ] P2025 returns HTTP 402 with descriptive message
- [ ] `WalletTransaction(type='SUBSCRIPTION')` is always created when subscription succeeds — never silently skipped

---

### Task 6.2 — Fix `.catch(() => {})` in `creator.controller.sendTip`
- [ ] Remove `.catch(() => {})` from the `walletTransaction.create` inside `sendTip`'s Prisma transaction
- [ ] Treat the ledger write as fatal: if it fails, the entire tip transaction rolls back

**Files affected:**
- `backend/src/controllers/creator.controller.js`

**Files protected:** All other creator functions

**Dependencies:** Task 2.2

**Acceptance criteria:**
- [ ] `sendTip` never silently suppresses ledger write failures
- [ ] Tip transaction fully rolls back if ledger write fails (no coins deducted, no diamonds credited, no tip record)

---

## Phase 7 — Gift Controller Hardening

### Task 7.1 — Gift daily spend cap DB fallback
- [ ] In `gift.controller.js`, replace the `safeGetCache → spentToday = 0` null path with a DB fallback:
  ```js
  const rawSpent = await safeGetCache(dailySpendKey(senderId));
  let spentToday;
  if (rawSpent !== null && rawSpent !== undefined) {
    spentToday = typeof rawSpent === 'number' ? rawSpent : parseInt(rawSpent, 10);
  } else {
    try {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const agg = await prisma.giftTransaction.aggregate({
        where: { senderId, createdAt: { gte: startOfDay } },
        _sum:  { coinsSpent: true }
      });
      spentToday = agg._sum.coinsSpent ?? 0;
    } catch (dbErr) {
      logger.error(`[gift] DB cap fallback failed for user ${senderId}: ${dbErr.message}`);
      return errorResponse(res, 'Service temporarily unavailable — please retry', 503);
    }
  }
  ```
- [ ] Apply the same fallback in `sendGiftToAll`

**Files affected:**
- `backend/src/controllers/gift.controller.js`

**Files protected:**
- `backend/src/tests/gift.test.js` (must still pass; add new Redis-unavailable test)
- Existing optimistic lock logic in gift transactions (untouched)

**Dependencies:** Tasks 2.3

**Tests:** Add test case in `gift.test.js`: Redis unavailable → DB fallback used → cap still enforced

**Security checks:** Null Redis response no longer bypasses daily cap

**Migration impact:** None

**Rollback:** Revert the null-path to `spentToday = 0` (less safe)

**Acceptance criteria:**
- [ ] When Redis returns null for daily spend key: DB aggregate is queried
- [ ] When DB fallback returns a value: cap check is applied correctly
- [ ] When both Redis and DB fail: HTTP 503 returned, not a gift send with no cap
- [ ] When Redis returns a valid value: DB is not queried (fast path preserved)

---

### Task 7.2 — Remove `.catch(() => {})` from gift ledger writes
- [ ] In `sendGift`: remove `.catch(() => {})` from `walletTransaction.create` inside the Prisma transaction
- [ ] In `sendGiftToAll`: remove `.catch(() => {})` from `walletTransaction.create` inside the Prisma transaction
- [ ] Both writes become fatal — ledger failure rolls back the entire gift transaction

**Files affected:**
- `backend/src/controllers/gift.controller.js`

**Files protected:**
- `backend/src/tests/gift.test.js` (update test mocks to not expect catch-swallowing)

**Dependencies:** Task 3.1 (diamonds column exists so walletTransaction.create works)

**Migration impact:** None (schema already supports it after M-A)

**Rollback:** Re-add `.catch(() => {})` (less safe)

**Acceptance criteria:**
- [ ] `sendGift` rolls back entirely if ledger write fails
- [ ] `sendGiftToAll` rolls back entirely if any ledger write fails
- [ ] `gift.test.js` passes

---

## Phase 8 — Stripe Hardening

### Task 8.1 — Fee payment DB idempotency in `stripe.controller.js`
- [ ] In the `fee_payment` branch of `handleWebhook`:
  - Before `feeRecord.update`, check: `prisma.feeRecord.findFirst({ where: { id: feeId, stripeSessionId: session.id } })`
  - If found with `status = 'PAID'`: return `{ received: true }` immediately
  - Update fee record with `stripeSessionId: session.id` in addition to existing fields
  - Wrap the update in a try/catch for P2002 (unique constraint on `stripeSessionId`): if P2002, the session was already processed — return `{ received: true }`
- [ ] Remove the Redis-only idempotency check from the fee payment path (keep Redis as a fast-path supplement, not the sole guard)

**Files affected:**
- `backend/src/controllers/stripe.controller.js`

**Files protected:**
- `backend/src/tests/stripe.test.js` (existing tests must pass; add fee idempotency tests)
- Coin purchase webhook path (untouched)

**Dependencies:** Task 3.3 (stripeSessionId column on FeeRecord)

**Tests:** Add to `stripe.test.js`:
- Fee payment already processed (DB check) → 200, no duplicate update
- Concurrent fee webhooks → only one update via P2002 guard

**Acceptance criteria:**
- [ ] Duplicate fee webhook returns `{ received: true }` without modifying the database
- [ ] Concurrent webhooks for the same fee session result in exactly one `PAID` update
- [ ] Existing coin-purchase webhook path is unchanged and tests still pass

---

### Task 8.2 — Stripe dispute handler (`charge.dispute.created`)
- [ ] In `stripe.controller.js` `handleWebhook`, add a handler for `charge.dispute.created`:
  - Log `logger.warn` with dispute ID, amount, reason
  - Look up `WalletTransaction` by `stripeSessionId` matching `dispute.payment_intent`
  - If found: update `type` to `'DISPUTED'`
  - Emit `stripe:dispute` Socket.IO event to `role:SUPER_ADMIN` room
  - If not found: log `logger.error`, return `{ received: true }`
- [ ] Do NOT automatically clawback coins — only flag and notify

**Files affected:**
- `backend/src/controllers/stripe.controller.js`

**Files protected:**
- `backend/src/tests/stripe.test.js`
- Existing webhook signature verification (untouched)

**Dependencies:** Task 3.4 (`DISPUTED` type documented), Tasks 2.1–2.3

**Tests:** Add to `stripe.test.js`:
- `charge.dispute.created` with matching WalletTransaction → flags DISPUTED + emits socket
- `charge.dispute.created` with no matching transaction → logs error, returns 200

**Acceptance criteria:**
- [ ] `charge.dispute.created` is handled without throwing
- [ ] SUPER_ADMIN receives socket notification
- [ ] No coins are automatically removed
- [ ] All existing stripe.test.js tests pass

---

## Phase 9 — Wallet History & roomResolver

### Task 9.1 — Unified wallet transaction history
- [ ] Rewrite `wallet.controller.getTransactionHistory` to:
  - Query `WalletTransaction` for `req.user.id`, ordered by `createdAt DESC`
  - For `type = 'GIFT_SEND'` records with a non-null `giftTxId`: join `GiftTransaction` including `gift.name`, `gift.emoji`, `receiver.firstName`, `receiver.lastName`
  - For `type = 'PAYOUT'` and `type = 'PAYOUT_REVERSAL'` records: return `accountDetails: {}` (fully redacted)
  - Remove the existing broken `giftTransaction.room` include
  - Accept `page` (default 1) and `limit` (default 20) query params
  - Return `{ data: WalletTransaction[], pagination: { page, limit, total } }`
- [ ] Update the route `GET /wallet/history` to pass through page/limit
- [ ] Remove the old parallel `giftTransaction.findMany` queries

**Files affected:**
- `backend/src/controllers/wallet.controller.js`
- `backend/src/routes/wallet.routes.js` (add query param docs)

**Files protected:**
- `backend/src/tests/wallet.test.js` (update to new response shape)

**Dependencies:** Task 3.1 (diamonds column), Tasks 5.3–5.4 (PAYOUT types exist)

**Tests:** Update `wallet.test.js`:
- History returns WalletTransaction records (not GiftTransaction directly)
- GIFT_SEND records include enriched gift details
- PAYOUT records have redacted accountDetails
- Pagination works correctly

**Acceptance criteria:**
- [ ] `GET /wallet/history` returns all transaction types for the user
- [ ] GIFT_SEND records include `giftDetails` enrichment
- [ ] No `room` include attempted (broken FK removed)
- [ ] Pagination metadata present in all responses
- [ ] `wallet.test.js` passes

---

### Task 9.2 — Extend `roomResolver.js` for PK and community room types
- [ ] Add `pk` handler to `resolveRoom`:
  - Query `PKMatch WHERE id = roomId AND state IN ['PENDING','LIVE']`
  - Return `{ id, status: 'LIVE' }` if found, `null` if not
- [ ] Add `community` handler to `resolveRoom`:
  - Query `Community WHERE id = roomId AND deletedAt = null`
  - Return `{ id, status: 'LIVE' }` if found, `null` if not
- [ ] For unknown roomType: return `null` instead of throwing
- [ ] Add `pk` handler to `resolveParticipant`:
  - Query `PKParticipant WHERE pkMatchId = roomId AND userId = userId`
  - Return normalised `{ userId, role: 'PARTICIPANT', isActive: true, user }` or `null`
- [ ] Add `community` handler to `resolveParticipant`:
  - Query `CommunityMember WHERE communityId = roomId AND userId = userId AND status = 'ACTIVE'`
  - Return normalised `{ userId, role, isActive: true, user }` or `null`
- [ ] Add `pk` and `community` handlers to `resolveActiveRecipients` with appropriate role filters

**Files affected:**
- `backend/src/utils/roomResolver.js`

**Files protected:**
- `backend/src/tests/gift.test.js` (existing voice/live_class mock paths must still work)
- `voice.controller.js`, `live-class.controller.js` (untouched)

**Dependencies:** None beyond existing Prisma models

**Tests:** Add roomResolver unit tests for pk and community types; unknown type returns null not throws

**Acceptance criteria:**
- [ ] `resolveRoom('pk', id)` returns normalised room or null
- [ ] `resolveRoom('community', id)` returns normalised room or null
- [ ] `resolveRoom('unknown', id)` returns null (no throw)
- [ ] `resolveParticipant('pk', ...)` returns normalised participant or null
- [ ] All existing `gift.test.js` tests pass

---

## Phase 10 — SUPER_ADMIN Isolation Guards

### Task 10.1 — Add SUPER_ADMIN participation guards
- [ ] In `creator.controller.becomeCreator`: add guard at top:
  ```js
  if (req.user.role === 'SUPER_ADMIN') {
    return errorResponse(res, 'SUPER_ADMIN cannot create a creator profile', 403);
  }
  ```
- [ ] In `gift.controller.sendGift` and `sendGiftToAll`: add SUPER_ADMIN guard after auth
- [ ] In `creator.controller.subscribe` and `sendTip`: add SUPER_ADMIN guard

**Files affected:**
- `backend/src/controllers/creator.controller.js`
- `backend/src/controllers/gift.controller.js`

**Files protected:**
- `backend/src/tests/super-admin-scope.test.js` (must pass — may need new test cases added)
- Voice/live-class authorization (untouched — already has separate auth)

**Dependencies:** None

**Tests:** Verify existing `super-admin-scope.test.js` covers these; add new cases if needed

**Security checks:** SUPER_ADMIN role must not enable creator earnings, gift receiving, or subscription access

**Migration impact:** None

**Rollback:** Remove the guards (reverts to pre-guard behaviour)

**Acceptance criteria:**
- [ ] `POST /creators/me/become` with SUPER_ADMIN JWT returns 403
- [ ] `POST /voice/:id/gifts` with SUPER_ADMIN JWT returns 403
- [ ] `POST /creators/:userId/subscribe` with SUPER_ADMIN JWT returns 403
- [ ] `POST /creators/:userId/tip` with SUPER_ADMIN JWT returns 403
- [ ] Existing `super-admin-scope.test.js` passes

---

## Phase 11 — Frontend & Mobile Parity

### Task 11.1 — Remove hardcoded economy constants from web payout page
- [ ] In `frontend/src/app/(dashboard)/wallet/payout/page.tsx`:
  - Remove `const DIAMOND_TO_USD = 0.005` and `const MIN_DIAMONDS = 2000`
  - Fetch both from `GET /wallet/payout/info` response fields `diamondToUsd` and `minPayoutDiamonds`
  - Update all display calculations to use server-provided values
  - Add a loading state while `payout/info` is being fetched

**Files affected:**
- `frontend/src/app/(dashboard)/wallet/payout/page.tsx`

**Files protected:**
- All backend controllers
- Other frontend pages

**Dependencies:** Task 5.5 (payout info endpoint exists)

**Acceptance criteria:**
- [ ] No hardcoded `DIAMOND_TO_USD` or `MIN_DIAMONDS` in the file
- [ ] Page displays correct values when `GET /wallet/payout/info` returns data
- [ ] Loading state shown while fetching

---

### Task 11.2 — Update mobile payout screen endpoint and remove hardcoded constants
- [ ] In `mobile/app/payout-request.tsx`:
  - Change the API call from `POST /api/v1/creators/me/payout-request` to `POST /api/v1/wallet/payout/request`
  - Update the request body shape to match `payout.controller.requestPayout` (diamonds, method, accountDetails)
  - Fetch payout info from `GET /api/v1/wallet/payout/info` instead of `/creators/me/payout-info`
  - Remove any hardcoded conversion rate or minimum diamond constant
  - Use server-provided `diamondToUsd`, `minPayoutDiamonds`, `minPayoutUsd` from the info endpoint

**Files affected:**
- `mobile/app/payout-request.tsx`

**Files protected:**
- All backend code
- Other mobile screens

**Dependencies:** Tasks 5.2 (old endpoint deprecated), 5.5 (new info endpoint)

**Acceptance criteria:**
- [ ] Mobile payout request hits `POST /api/v1/wallet/payout/request`
- [ ] No hardcoded `DIAMOND_TO_USD` or minimum constants in the mobile file
- [ ] Conversion rate displayed comes from server response

---

## Phase 12 — New Workers

### Task 12.1 — Subscription renewal worker
- [ ] Create `backend/src/workers/subscription-renewal.worker.js`
  - BullMQ worker consuming jobs from a `subscription-renewal` queue
  - Add a daily cron job at 01:00 UTC in `queue.service.js` or worker registration
  - Per run: batch query `CreatorSubscription WHERE expiresAt <= now() AND status = 'ACTIVE'` (batch size 100)
  - For each subscription: attempt optimistic-lock coin deduction (`WHERE coins >= priceCoins`)
  - On success: extend `expiresAt` by 30 days, write `SUBSCRIPTION` WalletTransaction (fatal, no catch)
  - On P2025 (insufficient coins): set `status = 'EXPIRED'`, notify subscriber, decrement `CreatorProfile.subscriberCount`
  - Processing must be idempotent: check if subscription was already renewed in current billing period before charging

**Files affected:**
- `backend/src/workers/subscription-renewal.worker.js` (NEW)
- `backend/src/services/queue.service.js` (add cron job registration)

**Files protected:**
- All existing workers
- `creator.controller.js` subscribe flow (untouched)

**Dependencies:** Task 6.1 (optimistic lock pattern), Tasks 2.2 (economy config)

**Security checks:** Worker runs with server-side credentials only, no client trust

**Migration impact:** None

**Rollback:** Disable the BullMQ cron job registration; existing subscriptions remain unchanged

**Acceptance criteria:**
- [ ] Worker file exists and is registered
- [ ] Expired subscriptions are set to `EXPIRED`
- [ ] Renewable subscriptions are renewed with correct coin deduction and ledger entry
- [ ] Idempotency: running the worker twice in the same billing period does not double-charge

---

### Task 12.2 — Economy reconciliation worker
- [ ] Create `backend/src/workers/economy-reconciliation.worker.js`
  - BullMQ worker, daily cron at 02:00 UTC
  - Read-only: never modifies wallet balances
  - Batch query wallets (batch 500)
  - For each wallet: compute expected coins = `SUM(WalletTransaction.coins) WHERE userId`
  - Compare expected vs actual; if delta ≠ 0: `logger.error({ userId, expected, actual, delta })` + Prometheus counter increment
  - On clean run: `logger.info` with wallet count + set Prometheus gauge `economy_reconciliation_last_run_timestamp`

**Files affected:**
- `backend/src/workers/economy-reconciliation.worker.js` (NEW)
- `backend/src/services/queue.service.js` (add cron job registration)
- `backend/src/utils/prometheus.js` (add new counter and gauge)

**Files protected:**
- All existing workers
- All wallet data (read-only worker)

**Dependencies:** Tasks 3.1 (diamonds column), 5.3 (PAYOUT ledger entries)

**Security checks:** Worker is read-only; no financial mutations

**Migration impact:** None

**Rollback:** Disable the BullMQ cron job registration

**Acceptance criteria:**
- [ ] Worker runs without error on a clean database
- [ ] Discrepancy detection logs correct `{ userId, expected, actual, delta }` format
- [ ] Prometheus counter incremented on discrepancy
- [ ] Prometheus gauge updated on clean run
- [ ] Worker does NOT modify any wallet or transaction records

---

## Phase 13 — Admin Revenue Reporting

### Task 13.1 — Revenue report endpoint
- [ ] Create `backend/src/controllers/admin-economy.controller.js`
- [ ] Implement `getRevenueReport(req, res)`:
  - Validate `startDate` and `endDate` query params (ISO 8601)
  - Enforce max 90-day range (return 400 if exceeded)
  - Run parallel Prisma queries for all report metrics
  - Return structured response (see design.md API contract)
- [ ] Create route `GET /api/v1/admin/economy/revenue-report` in `admin-stats.routes.js` or a new `admin-economy.routes.js`
- [ ] Apply `authorize('SUPER_ADMIN')` guard

**Files affected:**
- `backend/src/controllers/admin-economy.controller.js` (NEW)
- `backend/src/routes/admin-stats.routes.js` OR `backend/src/routes/admin-economy.routes.js` (NEW)
- `backend/src/app.js` (mount new route if new file)

**Files protected:**
- All existing admin routes
- `backend/src/tests/super-admin-scope.test.js`

**Dependencies:** Tasks 5.3–5.4 (PAYOUT ledger populated), 3.2 (Decimal amounts)

**Tests:** Add `admin-economy.test.js`:
- SUPER_ADMIN can access endpoint
- Non-SUPER_ADMIN gets 403
- Date range > 90 days returns 400
- Report totals are correct for known fixture data

**Acceptance criteria:**
- [ ] Endpoint returns all required revenue fields
- [ ] Enforces 90-day max range
- [ ] SUPER_ADMIN only access
- [ ] Response completes within 5 seconds for normal date ranges

---

## Phase 14 — Test Suite

### Task 14.1 — Create `payout.test.js`
- [ ] Create `backend/src/tests/payout.test.js` using Jest 29 + Supertest
- [ ] Test cases:
  - Successful payout request: diamonds reserved, PayoutRequest created, PAYOUT ledger created
  - Below minimum diamonds: 400 returned
  - Insufficient balance: 402 returned with current balance
  - Concurrent payout requests: at most one succeeds, no overdraft
  - Admin approve: status → APPROVED (valid from PENDING)
  - Admin reject (from PENDING): status → REJECTED, diamonds refunded, PAYOUT_REVERSAL ledger created
  - Admin complete (from APPROVED): status → COMPLETED
  - Invalid state transitions: each returns 400
  - User cancel (PENDING): status → CANCELLED, diamonds refunded
  - HTTP 410 from deprecated creator endpoint
  - Encrypted accountDetails: verify ciphertext stored, masked in admin response, redacted in user history
  - `GET /wallet/payout/info`: returns correct server-calculated values

**Files affected:**
- `backend/src/tests/payout.test.js` (NEW)

**Files protected:** All production code (test-only changes)

**Dependencies:** Tasks 5.1–5.5, 4.1–4.3

**Acceptance criteria:**
- [ ] All test cases listed above pass
- [ ] Concurrent test uses at least 2 parallel requests
- [ ] `npm test` includes this file and it passes

---

### Task 14.2 — Create `creator.test.js`
- [ ] Create `backend/src/tests/creator.test.js` using Jest 29 + Supertest
- [ ] Test cases:
  - Subscribe: coins deducted, diamonds credited, SUBSCRIPTION ledger created
  - Subscribe: insufficient balance returns 402
  - Concurrent subscriptions: at most one succeeds, no overdraft
  - Subscribe: SUBSCRIPTION ledger write failure rolls back entire transaction
  - Tip: coins deducted, diamonds credited, TIP_SEND ledger created
  - Tip: insufficient balance returns 402
  - Tip: idempotency key prevents double-tip
  - Creator dashboard: correct aggregation of earnings
  - `becomeCreator` with SUPER_ADMIN JWT returns 403

**Files affected:**
- `backend/src/tests/creator.test.js` (NEW)

**Files protected:** All production code

**Dependencies:** Tasks 6.1–6.2, 10.1

**Acceptance criteria:**
- [ ] All test cases pass
- [ ] Concurrent subscription test passes
- [ ] `npm test` includes this file and it passes

---

### Task 14.3 — Extend existing tests for new behaviour
- [ ] `gift.test.js`: add test for Redis unavailable → DB fallback for daily cap
- [ ] `gift.test.js`: add test that GIFT_SEND ledger failure rolls back entire gift transaction
- [ ] `stripe.test.js`: add fee idempotency tests (duplicate webhook, P2002 guard)
- [ ] `stripe.test.js`: add `charge.dispute.created` handler tests
- [ ] `wallet.test.js`: update history test for new WalletTransaction-based response shape
- [ ] `super-admin-scope.test.js`: add SUPER_ADMIN isolation tests for gift send, creator become, subscribe

**Files affected:**
- `backend/src/tests/gift.test.js`
- `backend/src/tests/stripe.test.js`
- `backend/src/tests/wallet.test.js`
- `backend/src/tests/super-admin-scope.test.js`

**Files protected:**
- `backend/src/tests/sprint8-refund.test.js` (must not be modified or broken)

**Dependencies:** All Phase 7–10 tasks

**Acceptance criteria:**
- [ ] All existing tests in the extended files still pass
- [ ] New test cases for new behaviour pass
- [ ] `sprint8-refund.test.js` passes unchanged

---

## Phase 15 — Documentation & Stale File Cleanup

### Task 15.1 — Update `docs/gifts-payments/gaps.md`
- [ ] Mark all 5 previously-listed gaps as fixed with their fix date
- [ ] Add new section documenting gaps resolved in this consolidation spec
- [ ] Add section for remaining known gaps (Stripe Connect automated payouts, PayPal integration)

**Files affected:**
- `docs/gifts-payments/gaps.md`

**Files protected:** All code files

**Dependencies:** All previous tasks complete

**Acceptance criteria:**
- [ ] No gap marked ❌ that is actually fixed
- [ ] New gaps from this spec's scope are documented

---

### Task 15.2 — Add `PAYOUT_ENCRYPTION_KEY` to environment examples
- [ ] Add `PAYOUT_ENCRYPTION_KEY=<32-char-random-string>` to `backend/.env.example`
- [ ] Add to `backend/.env.production.example`
- [ ] Add a comment in both files: "REQUIRED for payout account encryption. Must be exactly 32+ bytes. NEVER commit the real value."
- [ ] Add `PAYOUT_ENCRYPTION_KEY` to `.env.docker` and `.env.docker.local` placeholder

**Files affected:**
- `backend/.env.example`
- `backend/.env.production.example`
- `.env.docker` (placeholder only)

**Files protected:**
- `backend/.env` (never commit real secrets)

**Dependencies:** Task 4.1

**Acceptance criteria:**
- [ ] All example env files contain the key placeholder
- [ ] Real key is NOT in any committed file

---

## Phase Summary

| Phase | Tasks | Focus | Risk |
|-------|-------|-------|------|
| 1 | 1.1–1.2 | Economy config singleton | Low |
| 2 | 2.1–2.3 | Adopt config in all controllers | Low |
| 3 | 3.1–3.4 | DB migrations | Medium |
| 4 | 4.1–4.3 | Payout encryption | Medium |
| 5 | 5.1–5.5 | Unified payout flow | High |
| 6 | 6.1–6.2 | Subscription concurrency fix | High |
| 7 | 7.1–7.2 | Gift hardening | Medium |
| 8 | 8.1–8.2 | Stripe hardening | Medium |
| 9 | 9.1–9.2 | Wallet history + roomResolver | Low |
| 10 | 10.1 | SUPER_ADMIN isolation | Low |
| 11 | 11.1–11.2 | Frontend/mobile parity | Low |
| 12 | 12.1–12.2 | New BullMQ workers | Medium |
| 13 | 13.1 | Revenue reporting | Low |
| 14 | 14.1–14.3 | Test suite | Low |
| 15 | 15.1–15.2 | Docs + env cleanup | Low |

**Total tasks: 27**

---

## Critical Path

The following tasks must complete in order — each is a hard dependency of the next:

```
Task 1.1 (economy.config)
  → Tasks 2.1, 2.2, 2.3 (adopt config)
    → Tasks 3.1, 3.2, 3.3, 3.4 (migrations)
      → Task 4.1 (encryption util)
        → Task 4.3 (encrypt payout)
          → Task 5.1 (remove creator payout)
            → Task 5.2 (deprecate route)
              → Task 5.3 (OL + PAYOUT ledger)
                → Task 5.4 (PAYOUT_REVERSAL)
                  → Tasks 14.1, 14.2 (tests)
```

Phases 6–11 can proceed in parallel with Phase 5 after Phase 3 completes.
Phases 12–13 require Phase 6 to be complete.
Phase 14 should accompany each phase (write tests alongside implementation, not after).

---

## Acceptance Checklist (Final)

Before this spec is considered complete, every item must be checked:

- [ ] One authoritative payout implementation (`payout.controller.js`)
- [ ] No conflicting payout rates anywhere in the codebase
- [ ] No conflicting payout minimums
- [ ] `PLATFORM_SHARE_PERCENT = 50` in `economy.config.js`
- [ ] `CREATOR_SHARE_PERCENT = 50` in `economy.config.js`
- [ ] One authoritative `toDiamonds` function (in `economy.config.js`)
- [ ] `PayoutRequest.usdAmount` is `Decimal(10,2)`
- [ ] `PayoutRequest.accountDetails` is AES-256-GCM encrypted
- [ ] Payout state machine enforced (invalid transitions return 400)
- [ ] PAYOUT ledger entry created on payout request
- [ ] PAYOUT_REVERSAL ledger entry created on reject/cancel
- [ ] Rejected payout refunds diamonds atomically
- [ ] Concurrent payout requests cannot double-spend diamonds
- [ ] Concurrent subscriptions cannot overdraft coins
- [ ] Gift ledger writes are fatal (no silent `.catch(() => {})`)
- [ ] Subscription ledger writes are fatal
- [ ] Tip ledger writes are fatal
- [ ] Gift idempotency key works
- [ ] Tip idempotency key works
- [ ] Payout idempotency (single pending request per user) works
- [ ] Stripe webhook triple idempotency is intact and unchanged
- [ ] Fee payment has DB-level idempotency (P2002 guard)
- [ ] Redis failure does not bypass gift daily spend cap
- [ ] Wallet history returns all transaction types
- [ ] Creator dashboard is accurate
- [ ] Admin revenue report endpoint exists (SUPER_ADMIN only)
- [ ] Stripe dispute handler exists and notifies SUPER_ADMIN
- [ ] Subscription renewal worker exists
- [ ] Economy reconciliation worker exists (read-only)
- [ ] Web payout page uses server-provided rates
- [ ] Mobile payout screen calls correct endpoint with server-provided rates
- [ ] SUPER_ADMIN cannot become creator, send gifts, or subscribe
- [ ] Existing Stripe webhook tests pass unchanged
- [ ] Existing gift controller tests pass unchanged
- [ ] Existing refund regression tests (`sprint8-refund.test.js`) pass unchanged
- [ ] New `payout.test.js` exists and passes
- [ ] New `creator.test.js` exists and passes
- [ ] No deployed migration was edited
- [ ] `PAYOUT_ENCRYPTION_KEY` is in all env example files
- [ ] `docs/gifts-payments/gaps.md` is up to date
