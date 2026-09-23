# Design Document — Halqa Economy Consolidation

## Overview

The Halqa virtual economy has grown organically across multiple controllers, with payout logic duplicated in both `payout.controller.js` and `creator.controller.js` using incompatible conversion rates, balance checks that happen outside transactions, financial amounts stored as `Float`, plaintext account details, ledger writes silently suppressed, and economy constants scattered across frontend and backend files.

This consolidation:

1. Establishes a single server-side **Economy Config** module as the authoritative source for all economy constants and conversion functions.
2. Deprecates the creator-scoped payout endpoint (HTTP 410) and routes everything through the canonical `payout.controller.js`.
3. Adds two new ledger types (`PAYOUT`, `PAYOUT_REVERSAL`) with a new `diamonds` column on `WalletTransaction`.
4. Fixes the subscription concurrency race via optimistic locking inside the transaction.
5. Hardens the gift daily cap with a DB fallback when Redis is absent.
6. Adds DB-level idempotency to fee-payment webhooks.
7. Encrypts payout account details at rest with AES-256-GCM.
8. Delivers a unified wallet history endpoint, extended roomResolver safety, two new BullMQ workers, a Stripe dispute handler, a revenue reporting endpoint, and SUPER_ADMIN isolation guards.

The design covers five new migrations (M-A through M-E), never editing any previously deployed migration file.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Client Layer                                │
│  Web (Next.js)          Mobile (Expo RN)                           │
│  /wallet/payout page    payout-request.tsx                         │
│  Calls: GET /wallet/payout/info                                    │
│  Calls: POST /wallet/payout/request                                │
└──────────────────┬──────────────────────────────────┬──────────────┘
                   │ HTTPS + JWT                        │
┌──────────────────▼──────────────────────────────────▼──────────────┐
│                      Express API (Node.js)                          │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              economy.config.js (singleton)                  │   │
│  │  PLATFORM_SHARE_PERCENT=50  CREATOR_SHARE_PERCENT=50       │   │
│  │  DIAMOND_TO_USD=0.005       PAYOUT_MIN_DIAMONDS=2000        │   │
│  │  toDiamonds(coins)          toUsd(diamonds)                 │   │
│  │  platformShare(coins)                                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         ↑ imported by all controllers                               │
│                                                                     │
│  payout.controller.js          wallet.controller.js                │
│  ├─ requestPayout               └─ getTransactionHistory (unified) │
│  ├─ cancelPayout                                                    │
│  ├─ listPayoutsAdmin            creator.controller.js              │
│  └─ processPayoutAdmin          ├─ subscribe (fixed OL)            │
│                                 └─ requestPayout → REMOVED         │
│  stripe.controller.js           gift.controller.js                 │
│  ├─ handleWebhook               └─ sendGift (DB cap fallback)      │
│  │  ├─ checkout.session.completed                                  │
│  │  │  ├─ coin purchase (existing)                                 │
│  │  │  └─ fee payment (DB idempotency)                             │
│  │  └─ charge.dispute.created (NEW)                                │
│  └─ createCheckoutSession                                          │
│                                                                     │
│  admin/economy.controller.js (NEW)                                 │
│  └─ getRevenueReport (SUPER_ADMIN only)                            │
│                                                                     │
│  roomResolver.js (extended)                                        │
│  ├─ resolveRoom → voice, live_class, pk, community                 │
│  ├─ resolveParticipant → all types, returns null on unknown        │
│  └─ resolveActiveRecipients → all types                            │
└─────────────────┬───────────────────────────────────────────────────┘
                  │
      ┌───────────┴───────────────┐
      │                           │
┌─────▼──────┐            ┌───────▼────────────────────────────────┐
│   Redis     │            │   MySQL 8 (Prisma 5)                   │
│  (BullMQ)  │            │                                         │
│  Daily cap  │            │  wallets                               │
│  Idempotency│            │  wallet_transactions (+diamonds col)   │
│  cache      │            │  payout_requests (Float→Decimal)       │
└─────┬──────┘            │  fee_records (+stripeSessionId UNIQUE)  │
      │                   └─────────────────────────────────────────┘
┌─────▼──────────────────────────────────────────────────────────────┐
│                        BullMQ Workers                              │
│  subscription-renewal.worker.js  (daily cron 01:00 UTC)           │
│  economy-reconciliation.worker.js (daily cron 02:00 UTC)          │
│  social-cleanup worker (existing, extracted)                       │
└────────────────────────────────────────────────────────────────────┘
```

---

## Components and Interfaces

### 1. `backend/src/services/economy.config.js` (NEW)

The singleton module that all other modules must import economy constants from.

```js
// Exports (all named):
const PLATFORM_SHARE_PERCENT  = 50;      // %
const CREATOR_SHARE_PERCENT   = 50;      // %
const DIAMOND_TO_USD          = 0.005;   // USD per diamond
const PAYOUT_MIN_DIAMONDS     = 2000;    // minimum withdrawal

// Pure functions:
function toDiamonds(coins)  // Math.floor(coins * CREATOR_SHARE_PERCENT / 100)
function toUsd(diamonds)    // parseFloat((diamonds * DIAMOND_TO_USD).toFixed(2))
function platformShare(coins) // Math.floor(coins * PLATFORM_SHARE_PERCENT / 100)

// Startup validation (runs at module load):
// Throws ConfigurationError if any constant is undefined, null, or NaN
```

Startup validation pattern:

```js
const REQUIRED = { PLATFORM_SHARE_PERCENT, CREATOR_SHARE_PERCENT, DIAMOND_TO_USD, PAYOUT_MIN_DIAMONDS };
for (const [k, v] of Object.entries(REQUIRED)) {
  if (v === undefined || v === null || Number.isNaN(v)) {
    throw new Error(`[economy.config] Required constant "${k}" is ${v}. Fix before starting.`);
  }
}
```

### 2. `payout.controller.js` (updated)

Replaces all local `DIAMOND_TO_USD`, `MIN_PAYOUT_DIAMONDS` constants with imports from `economy.config.js`. Adds:

- **Optimistic lock** inside the payout transaction: `tx.wallet.update({ where: { userId, diamonds: { gte: diamondAmount } } })`.
- **PAYOUT ledger entry** inside the same transaction (`WalletTransaction.type = 'PAYOUT'`, `diamonds = -diamondAmount`, `coins = 0`).
- **Encryption** of `accountDetails` using AES-256-GCM before write.
- **PAYOUT_REVERSAL** entry on reject/cancel.
- **Masked decryption** for admin list (last 4 chars of account + holder name).
- **Full redaction** for user history.

### 3. `creator.controller.js` (updated — subscription concurrency fix)

- Remove `requestPayout` and `getPayoutInfo` functions entirely.
- In `subscribe`:
  - Remove the pre-transaction balance check (`wallet.coins < tier.priceCoins`).
  - Inside the transaction, replace the plain `tx.wallet.update` with an optimistic lock:
    ```js
    await tx.wallet.update({
      where: { userId: subscriberId, coins: { gte: tier.priceCoins } },
      data:  { coins: { decrement: tier.priceCoins }, totalSpent: { increment: tier.priceCoins } }
    });
    ```
  - Remove `.catch(() => {})` from the `walletTransaction.create` inside the transaction.
- In `sendTip`: remove `.catch(() => {})` from the `walletTransaction.create` inside the transaction.

### 4. `gift.controller.js` (updated — DB cap fallback)

When `safeGetCache(dailySpendKey(senderId))` returns `null`:

```js
const rawSpent = await safeGetCache(dailySpendKey(senderId));
let spentToday;
if (rawSpent !== null) {
  spentToday = typeof rawSpent === 'number' ? rawSpent : parseInt(rawSpent, 10);
} else {
  // Redis miss — fall back to DB aggregate
  try {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const agg = await prisma.giftTransaction.aggregate({
      where: { senderId, createdAt: { gte: startOfDay } },
      _sum:  { coinsSpent: true }
    });
    spentToday = agg._sum.coinsSpent ?? 0;
  } catch (dbErr) {
    logger.error(`[gift] DB cap fallback failed: ${dbErr.message}`);
    return errorResponse(res, 'Service temporarily unavailable', 503);
  }
}
```

Also: remove `.catch(() => {})` from `walletTransaction.create` inside the sendGift and sendGiftToAll transactions.

### 5. `stripe.controller.js` (updated — fee DB idempotency + dispute handler)

**Fee payment DB idempotency:**

```js
// Before update, check for existing processed fee
const existingFee = await prisma.feeRecord.findFirst({
  where: { id: feeId, stripeSessionId: session.id }
});
if (existingFee?.status === 'PAID') {
  logger.info(`[stripe] Fee ${feeId} already paid (session ${session.id})`);
  return res.json({ received: true });
}
// Update with stripeSessionId
await prisma.feeRecord.update({
  where: { id: feeId },
  data:  { status: 'PAID', paidAt: new Date(), stripeSessionId: session.id, notes: `...` }
});
// P2002 catch → already processed → 200
```

**Dispute handler (NEW):**

```js
if (event.type === 'charge.dispute.created') {
  const dispute = event.data.object;
  logger.warn(`[stripe:dispute] charge.dispute.created: ${dispute.id}, amount: ${dispute.amount}, reason: ${dispute.reason}`);
  
  const tx = await prisma.walletTransaction.findFirst({
    where: { stripeSessionId: dispute.payment_intent }
  }).catch(() => null);
  
  if (!tx) {
    logger.error(`[stripe:dispute] No WalletTransaction for paymentIntent ${dispute.payment_intent}`);
    return res.json({ received: true });
  }
  
  // Flag transaction as disputed
  await prisma.walletTransaction.update({
    where: { id: tx.id },
    data:  { type: 'DISPUTED' } // new type value
  }).catch(() => {});
  
  const io = getIo();
  if (io) {
    io.to('role:SUPER_ADMIN').emit('stripe:dispute', {
      disputeId:       dispute.id,
      userId:          tx.userId,
      amount:          dispute.amount,
      reason:          dispute.reason,
      evidenceDueBy:   dispute.evidence_details?.due_by
    });
  }
  return res.json({ received: true });
}
```

### 6. `wallet.controller.js` (updated — unified history)

`getTransactionHistory` updated to:

- Query `WalletTransaction` for the authenticated user, ordered by `createdAt DESC`.
- For records with `type = 'GIFT_SEND'` and a non-null `giftTxId`, join `GiftTransaction` including `gift.name`, `gift.emoji`, `receiver.firstName`, `receiver.lastName`.
- Remove the broken `GiftTransaction.room` include.
- Return `accountDetails` fully redacted on PAYOUT entries (user-facing).
- Return paginated response with total count.

### 7. `roomResolver.js` (extended)

Add handlers for `pk` and `community` room types. Return `null` (not throw) for unknown types.

```js
async function resolveRoom(roomType, roomId) {
  if (roomType === 'voice') { /* existing */ }
  if (roomType === 'live_class') { /* existing */ }
  if (roomType === 'pk') {
    const match = await prisma.pKMatch.findFirst({
      where: { id: roomId, state: { in: ['PENDING', 'LIVE'] } },
      select: { id: true, state: true }
    });
    if (!match) return null;
    const status = match.state === 'LIVE' ? 'LIVE' : 'SCHEDULED';
    return { id: match.id, status };
  }
  if (roomType === 'community') {
    const community = await prisma.community.findFirst({
      where: { id: roomId, deletedAt: null },
      select: { id: true }
    });
    return community ? { id: community.id, status: 'LIVE' } : null;
  }
  // Unknown type → null (caller returns 404/403)
  return null;
}
```

Same pattern for `resolveParticipant` and `resolveActiveRecipients`.

### 8. `subscription-renewal.worker.js` (NEW)

BullMQ worker, daily cron at 01:00 UTC, extracted from `social-cleanup` worker.

Responsibilities:
- Batch query `CreatorSubscription WHERE expiresAt <= now() AND status = 'ACTIVE'`, batch size 100.
- Per subscription: attempt optimistic-lock coin deduction; on success extend `expiresAt` + 30 days and write `SUBSCRIPTION` WalletTransaction inside the same transaction.
- On failure: mark `status = 'EXPIRED'`, notify subscriber.
- Decrement `CreatorProfile.subscriberCount` for expired records.

### 9. `economy-reconciliation.worker.js` (NEW)

BullMQ worker, daily cron at 02:00 UTC, **read-only**.

Responsibilities:
- For each `Wallet` record (paginated, batch 500):
  - Compute expected `coins` = `SUM(WalletTransaction.coins) WHERE userId = wallet.userId`.
  - Compare against `Wallet.coins`.
  - If delta ≠ 0: `logger.error({ userId, expected, actual, delta })` + increment `economy_reconciliation_discrepancies_total`.
- On clean run: `logger.info` with wallet count + set `economy_reconciliation_last_run_timestamp` Prometheus gauge.

### 10. `admin/economy.controller.js` (NEW)

Endpoint: `GET /api/v1/admin/economy/revenue-report` (SUPER_ADMIN only).

Query parameters: `startDate`, `endDate` (ISO 8601). Max range: 90 days.

Aggregates via parallel Prisma queries:
- Total coins purchased via Stripe.
- Total coins spent on gifts.
- Total diamonds awarded.
- Total USD in completed payouts.
- Pending payout liability.
- Platform share retained (coins × `PLATFORM_SHARE_PERCENT / 100`).

### 11. Payout Account Encryption (`backend/src/utils/encryption.js` NEW)

```js
const crypto = require('crypto');
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // bytes

function getEncryptionKey() {
  const raw = process.env.PAYOUT_ENCRYPTION_KEY;
  if (!raw || Buffer.from(raw, 'utf8').length < KEY_LENGTH) {
    throw new Error('[encryption] PAYOUT_ENCRYPTION_KEY must be >= 32 bytes');
  }
  return Buffer.from(raw, 'utf8').slice(0, 32);
}

function encrypt(plaintext) {
  const key   = getEncryptionKey();
  const iv    = crypto.randomBytes(12); // 96-bit for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag   = cipher.getAuthTag();
  // Format: base64(iv):base64(tag):base64(ciphertext)
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decrypt(ciphertext) {
  const key = getEncryptionKey();
  const [ivB64, tagB64, encB64] = ciphertext.split(':');
  const iv         = Buffer.from(ivB64, 'base64');
  const tag        = Buffer.from(tagB64, 'base64');
  const encrypted  = Buffer.from(encB64, 'base64');
  const decipher   = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

function maskAccountDetails(decrypted) {
  const parsed = JSON.parse(decrypted);
  return {
    accountHolder: parsed.accountHolder || '',
    accountLast4:  (parsed.account || '').slice(-4) || '****'
  };
}
```

### 12. SUPER_ADMIN Isolation Guards

Add HTTP 403 guard at the top of:
- `creator.controller.js → becomeCreator`
- `voice.controller.js → joinVoiceRoom`
- `live-class.controller.js → joinLiveClass`
- `gift.controller.js → sendGift`

```js
if (req.user.role === 'SUPER_ADMIN') {
  return errorResponse(res, 'SUPER_ADMIN cannot participate in platform activities', 403);
}
```

### 13. Frontend/Mobile Parity

- Remove `const DIAMOND_TO_USD = 0.005` and `const MIN_DIAMONDS = 2000` from `frontend/src/app/(dashboard)/wallet/payout/page.tsx`.
- Fetch both from `GET /wallet/payout/info` response fields `diamondToUsd` and `minPayoutDiamonds`.
- Update `mobile/app/payout-request.tsx` to call `POST /api/v1/wallet/payout/request` instead of `/creators/me/payout-request`.
- Remove the hardcoded `DIAMOND_TO_USD` conversion factor from mobile.

---

## Data Models

### Migration M-A: Add `diamonds` column to `wallet_transactions`

```sql
-- M-A: add diamonds column to wallet_transactions
ALTER TABLE wallet_transactions
  ADD COLUMN diamonds INT NOT NULL DEFAULT 0
    COMMENT 'Diamond delta for this transaction. 0 for coin-only records.';

-- Back-fill existing rows (all coin-based, no diamond delta needed)
-- No back-fill required: default 0 is correct for all existing records.
```

Prisma schema addition to `WalletTransaction`:

```prisma
model WalletTransaction {
  // ... existing fields ...
  type             String   // STRIPE_PURCHASE | GIFT_SEND | TIP_SEND | SUBSCRIPTION
                            // | ADMIN_GRANT | REFUND | PAYOUT | PAYOUT_REVERSAL | DISPUTED
  coins            Int      // positive = credit, negative = debit (coins)
  diamonds         Int      @default(0) // positive = credit, negative = debit (diamonds)
  // ... rest of fields ...
}
```

**Rollback:** `ALTER TABLE wallet_transactions DROP COLUMN diamonds;`

### Migration M-B: `payout_requests.usdAmount` Float → DECIMAL(10,2)

```sql
-- M-B: change usdAmount from FLOAT to DECIMAL(10,2)
ALTER TABLE payout_requests
  MODIFY COLUMN usd_amount DECIMAL(10,2) NOT NULL
    COMMENT 'USD value stored as exact decimal, 2dp precision.';

-- Existing rows: DECIMAL cast rounds to 2dp — no data loss for values like 10.0, 50.0
-- Verify: SELECT id, usd_amount FROM payout_requests WHERE usd_amount != ROUND(usd_amount, 2);
```

Prisma schema update:

```prisma
model PayoutRequest {
  usdAmount  Decimal  @db.Decimal(10, 2)
  // ...
}
```

**Rollback:** `ALTER TABLE payout_requests MODIFY COLUMN usd_amount FLOAT NOT NULL;`

### Migration M-C: Add `stripeSessionId @unique` to `FeeRecord`

```sql
-- M-C: add stripeSessionId unique column to fee_records
ALTER TABLE fee_records
  ADD COLUMN stripe_session_id VARCHAR(255) NULL
    COMMENT 'Stripe Checkout session ID for idempotency guard.',
  ADD UNIQUE INDEX uq_fee_stripe_session (stripe_session_id);
```

Prisma schema addition:

```prisma
model FeeRecord {
  // ... existing fields ...
  stripeSessionId  String?  @unique @db.VarChar(255)
}
```

**Rollback:** `ALTER TABLE fee_records DROP INDEX uq_fee_stripe_session, DROP COLUMN stripe_session_id;`

### Migration M-D: App-layer encryption of `accountDetails`

No schema change. `accountDetails` remains `TEXT`. Existing plaintext rows are migrated at read time (decrypt fails gracefully → treat as unencrypted legacy, re-encrypt on next write) or via a one-time migration script:

```js
// scripts/encrypt-account-details.js
// Run once after deployment: node scripts/encrypt-account-details.js
const allPayouts = await prisma.payoutRequest.findMany({ select: { id: true, accountDetails: true } });
for (const p of allPayouts) {
  if (!p.accountDetails.startsWith('{"')) continue; // already encrypted
  const encrypted = encrypt(p.accountDetails);
  await prisma.payoutRequest.update({ where: { id: p.id }, data: { accountDetails: encrypted } });
}
```

**Rollback:** Re-run script with encrypt/decrypt swapped to restore plaintext. No schema change to revert.

### Migration M-E: Document `PAYOUT` / `PAYOUT_REVERSAL` as valid `WalletTransaction` types

```sql
-- M-E: informational migration (no DDL change)
-- Documents that wallet_transactions.type now accepts:
--   PAYOUT           : diamond reservation on payout request creation
--   PAYOUT_REVERSAL  : diamond restoration on reject/cancel
--   DISPUTED         : coin-purchase transaction flagged by Stripe dispute
-- The type column is VARCHAR(50) — no enum constraint to migrate.
-- This migration exists for audit trail and deploy ordering only.
SELECT 'M-E: No DDL change. PAYOUT, PAYOUT_REVERSAL, DISPUTED are now valid type values.' AS note;
```

### Updated `PayoutRequest` model summary

| Field | Before | After |
|---|---|---|
| `usdAmount` | `Float` | `Decimal(10,2)` |
| `accountDetails` | `TEXT` (plaintext) | `TEXT` (AES-256-GCM encrypted) |
| Relations | none | `walletTransactions` (virtual, via payoutRequestId) |

### `WalletTransaction` extended type set

| Type | Direction | Description |
|---|---|---|
| `STRIPE_PURCHASE` | +coins | Stripe checkout completed |
| `GIFT_SEND` | -coins | Gift sent from sender |
| `TIP_SEND` | -coins | Tip sent to creator |
| `SUBSCRIPTION` | -coins | Creator subscription charged |
| `ADMIN_GRANT` | +coins | Admin coin grant |
| `REFUND` | +coins | Legacy refund (not payout) |
| `PAYOUT` | -diamonds | Diamond reservation on payout request |
| `PAYOUT_REVERSAL` | +diamonds | Diamond restoration on reject/cancel |
| `DISPUTED` | 0 | Stripe chargeback flag |

---

## API Contract

### Deprecated endpoint

```
POST /api/v1/creators/me/payout-request
Response: 410 Gone
Body: { "success": false, "message": "This endpoint has been removed. Use POST /api/v1/wallet/payout/request" }
```

### `GET /api/v1/wallet/payout/info` (replaces `/creators/me/payout-info`)

**Auth:** JWT (any authenticated user)

Response `200`:

```json
{
  "success": true,
  "data": {
    "diamonds": 5000,
    "usdValue": "25.00",
    "minPayoutDiamonds": 2000,
    "minPayoutUsd": "10.00",
    "diamondToUsd": 0.005,
    "platformSharePercent": 50,
    "canRequest": true,
    "totalEarned": 12000,
    "pendingRequest": null
  }
}
```

### `POST /api/v1/wallet/payout/request`

**Auth:** JWT | **Body validation:** `diamonds` (int ≥ 2000), `method` (enum), `accountDetails` (object)

```json
// Request
{
  "diamonds": 5000,
  "method": "paypal",
  "accountDetails": { "accountHolder": "Jane Doe", "account": "jane@paypal.com" }
}

// Response 201
{
  "success": true,
  "data": {
    "request": {
      "id": "uuid",
      "diamonds": 5000,
      "usdAmount": "25.00",
      "method": "paypal",
      "status": "PENDING",
      "createdAt": "2025-01-01T00:00:00Z"
    }
  },
  "message": "Payout request submitted. Processing within 3-5 business days."
}

// Response 402 — insufficient diamonds
{ "success": false, "message": "Insufficient diamonds. You have 1000, requested 5000" }

// Response 400 — pending request exists
{ "success": false, "message": "You already have a pending payout request." }
```

### `GET /api/v1/wallet/payout/history`

**Auth:** JWT | `accountDetails` fully redacted from response.

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "diamonds": 5000,
      "usdAmount": "25.00",
      "method": "paypal",
      "status": "COMPLETED",
      "transactionRef": "PP-1234",
      "accountDetails": {},
      "createdAt": "2025-01-01T00:00:00Z",
      "processedAt": "2025-01-05T00:00:00Z"
    }
  ]
}
```

### `GET /api/v1/admin/payouts?status=PENDING`

**Auth:** JWT (SCHOOL_ADMIN | SUPER_ADMIN) | `accountDetails` masked (last 4 + holder name).

```json
{
  "data": [
    {
      "id": "uuid",
      "user": { "id": "...", "firstName": "Jane", "email": "jane@..." },
      "diamonds": 5000,
      "usdAmount": "25.00",
      "method": "paypal",
      "accountSummary": { "accountHolder": "Jane Doe", "accountLast4": "mail" },
      "status": "PENDING",
      "createdAt": "..."
    }
  ]
}
```

### `GET /api/v1/wallet/history`

**Auth:** JWT | Query: `page` (default 1), `limit` (default 20)

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "type": "GIFT_SEND",
      "coins": -100,
      "diamonds": 0,
      "description": "Sent 1x Lion to room ...",
      "createdAt": "...",
      "giftDetails": {
        "gift": { "name": "Lion", "emoji": "🦁" },
        "receiver": { "firstName": "Ahmed", "lastName": "Ali" }
      }
    },
    {
      "id": "uuid",
      "type": "PAYOUT",
      "coins": 0,
      "diamonds": -5000,
      "description": "Payout request pr_uuid",
      "createdAt": "..."
    },
    {
      "id": "uuid",
      "type": "STRIPE_PURCHASE",
      "coins": 1000,
      "diamonds": 0,
      "description": "Stripe purchase — package pkg_xxx",
      "createdAt": "..."
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 45 }
}
```

### `GET /api/v1/admin/economy/revenue-report?startDate=2025-01-01&endDate=2025-03-31`

**Auth:** JWT (SUPER_ADMIN only)

```json
{
  "success": true,
  "data": {
    "period": { "startDate": "2025-01-01", "endDate": "2025-03-31" },
    "coinsPurchased": 500000,
    "coinsSpentOnGifts": 320000,
    "diamondsAwardedToCreators": 160000,
    "completedPayoutsUsd": "450.00",
    "pendingPayoutLiabilityUsd": "125.00",
    "platformShareCoins": 160000,
    "platformShareUsd": "800.00"
  }
}
```

---

## Sequence Diagrams

### Payout Request Flow (Happy Path)

```
Client           API (payout.ctrl)     DB (Prisma tx)        Socket.IO
  │                    │                     │                    │
  │  POST /wallet/payout/request             │                    │
  │─────────────────►  │                     │                    │
  │                    │ validate body        │                    │
  │                    │ encrypt accountDetails                    │
  │                    │ check pending request│                    │
  │                    │─────────────────────►│                    │
  │                    │                     │ findFirst(PENDING)  │
  │                    │◄─────────────────────│ null               │
  │                    │                     │                    │
  │                    │ BEGIN TRANSACTION    │                    │
  │                    │─────────────────────►│                    │
  │                    │                     │ wallet.update       │
  │                    │                     │  WHERE diamonds ≥ N │
  │                    │                     │  (optimistic lock)  │
  │                    │                     │ payoutRequest.create│
  │                    │                     │ walletTransaction   │
  │                    │                     │  .create PAYOUT     │
  │                    │◄─────────────────────│ COMMIT             │
  │                    │                     │                    │
  │                    │ emit payout_requested│                    │
  │                    │───────────────────────────────────────►  │
  │                    │                     │                    │ → role:SUPER_ADMIN
  │  201 response      │                     │                    │
  │◄─────────────────  │                     │                    │
```

### Payout Rejection Flow

```
Admin            API (payout.ctrl)     DB (Prisma tx)
  │                    │                     │
  │  PATCH /admin/payouts/:id {action:"reject"}
  │─────────────────►  │                     │
  │                    │ validate status=PENDING|APPROVED
  │                    │ BEGIN TRANSACTION    │
  │                    │─────────────────────►│
  │                    │                     │ payoutRequest.update → REJECTED
  │                    │                     │ wallet.update diamonds +N
  │                    │                     │ walletTransaction.create PAYOUT_REVERSAL
  │                    │◄─────────────────────│ COMMIT
  │  200 OK            │                     │
  │◄─────────────────  │                     │
```

### Subscription Flow (Fixed Concurrency)

```
Subscriber A     Subscriber A (concurrent)   API (creator.ctrl)   DB
  │                    │                          │                │
  │  POST /creators/:id/subscribe                 │                │
  │───────────────────────────────────────────►   │                │
  │                    │  POST /creators/:id/subscribe              │
  │                    │──────────────────────────►│                │
  │                    │                          │                │
  │                    │                          │ BEGIN TX (both)│
  │                    │                          │                │
  │                    │                          │─────────────►  │
  │                    │                          │ wallet.update  │
  │                    │                          │  WHERE coins≥N │ ← only ONE wins
  │                    │                          │ subscription   │
  │                    │                          │  .upsert       │
  │                    │                          │ walletTx.create│ ← fatal (no catch)
  │                    │                          │◄─────────────  │
  │                    │                          │ COMMIT (winner)│
  │                    │                          │ ROLLBACK (loser)→ 402
  │  200 OK subscribed │                          │                │
  │◄──────────────────────────────────────────    │                │
  │                    │  402 Insufficient coins  │                │
  │                    │◄──────────────────────── │                │
```

---

## Security Model for Encryption

### Algorithm

AES-256-GCM is used because it provides both confidentiality (AES-256) and integrity authentication (GCM tag). Tampering with ciphertext is detected and rejected before decryption returns data.

### Key Management

```
PAYOUT_ENCRYPTION_KEY env var (≥ 32 UTF-8 bytes)
  └─ First 32 bytes used as the AES-256 key
  └─ NOT logged, NOT returned in API responses
  └─ Startup validation: throws if absent or < 32 bytes
  └─ Rotation: re-encrypt all payout_requests before removing old key
```

### Encryption Envelope Format

```
<base64(12-byte IV)>:<base64(16-byte GCM tag)>:<base64(ciphertext)>
```

Each encryption operation generates a fresh random IV. The GCM tag authenticates both the IV and ciphertext (authenticated encryption with associated data = empty).

### Admin Masking

When admin reads payout requests:
1. Ciphertext is decrypted server-side.
2. Only `accountHolder` (full) and last 4 chars of `account` field are returned.
3. Full plaintext is never serialised to JSON response or log.

### User History Redaction

The user history endpoint returns `accountDetails: {}` for all PAYOUT entries — no decryption occurs.

---

## Concurrency Model

### Payout Optimistic Lock

```
tx.wallet.update({
  where: { userId, diamonds: { gte: diamondAmount } },
  data:  { diamonds: { decrement: diamondAmount } }
})
```

If two concurrent payout requests arrive:
- Both read diamonds = 5000, amount = 5000.
- Both enter a Prisma interactive transaction.
- First commits: `WHERE diamonds >= 5000` matches → update succeeds.
- Second commits: `WHERE diamonds >= 5000` on diamonds = 0 → matches 0 rows → Prisma throws `P2025 RecordNotFound` → transaction rolls back → returns 402.

**Result:** Exactly one payout is created; `Wallet.diamonds` never goes below zero.

### Subscription Optimistic Lock

Same pattern applied to `tx.wallet.update({ where: { userId: subscriberId, coins: { gte: priceCoins } } })`. The pre-transaction balance check is removed so concurrent requests don't both pass the pre-check and then race to the update.

### Gift Daily Cap (Redis + DB fallback)

```
Redis available → use cached daily spend (fast path, O(1))
Redis null      → DB aggregate (SUM coinsSpent WHERE senderId + today)
Both fail       → HTTP 503 (no silent bypass)
```

After a successful gift transaction, the Redis cache is updated regardless of which path was used to read.

### Fee Payment Idempotency

```
Layer 1: Redis cache key `stripe:fee:<sessionId>` (fast path)
Layer 2: DB check feeRecord.stripeSessionId = session.id (authoritative)
Layer 3: UNIQUE constraint on fee_records.stripe_session_id (race guard)
  → P2002 on duplicate → log as already-processed → 200
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: `toDiamonds` Non-negativity and Upper Bound

*For any* non-negative integer `c`, `toDiamonds(c)` shall return a non-negative integer that is less than or equal to `c`. That is: `toDiamonds(c) >= 0` AND `toDiamonds(c) <= c` AND `Number.isInteger(toDiamonds(c))`.

**Validates: Requirements 1.2, 1.6**

### Property 2: `toUsd` Two-Decimal Precision

*For any* non-negative integer `d`, `toUsd(d)` shall equal `parseFloat((d * 0.005).toFixed(2))` and the result shall have at most two decimal places. That is, `toUsd(d).toString()` shall match `/^\d+(\.\d{1,2})?$/`.

**Validates: Requirements 1.3, 6.2**

### Property 3: Payout Optimistic Lock — No Diamond Overdraft

*For any* set of N concurrent payout requests submitted by the same user for an amount equal to the user's current diamond balance, after all N requests complete: `Wallet.diamonds >= 0` AND at most one `PayoutRequest` record with `status = 'PENDING'` exists for that user AND at most one `WalletTransaction` of type `PAYOUT` was created.

**Validates: Requirements 4.2, 4.5**

### Property 4: Payout Ledger Round-Trip

*For any* successful payout request of `N` diamonds: there exists exactly one `WalletTransaction` with `type = 'PAYOUT'`, `diamonds = -N`, `userId = requester.id` linked to that payout request, and `Wallet.diamonds` was decremented by exactly `N`.

**Validates: Requirements 5.2**

### Property 5: Payout Reversal Restores Balance

*For any* payout request that transitions to `REJECTED` or `CANCELLED` (starting from `PENDING` or `APPROVED`): there exists exactly one `WalletTransaction` with `type = 'PAYOUT_REVERSAL'`, `diamonds = +N`, and `Wallet.diamonds` after the reversal equals `Wallet.diamonds` before the original payout request was submitted.

**Validates: Requirements 5.3, 3.6**

### Property 6: Subscription Concurrency — No Coin Overdraft

*For any* set of N concurrent subscription requests submitted by the same subscriber for the same creator tier, after all N requests complete: `Wallet.coins >= 0` AND at most one `CreatorSubscription` with `status = 'ACTIVE'` exists for that subscriber/creator pair.

**Validates: Requirements 8.4**

### Property 7: Gift Daily Cap Always Enforced

*For any* gift send request where the sender's total coins spent today (from DB aggregate) plus the requested spend would exceed `GIFT_DAILY_CAP`, the request SHALL be rejected with HTTP 429 regardless of whether Redis is available or returns null.

**Validates: Requirements 9.1–9.4**

### Property 8: Wallet History Completeness

*For any* user with a set of `WalletTransaction` records spanning all valid type values, `GET /wallet/history` shall return all records for that user ordered by `createdAt DESC`, and for any record with `type = 'GIFT_SEND'` and a non-null `giftTxId`, the response shall include the enriched `giftDetails` with `gift.name`, `gift.emoji`, and `receiver.firstName`.

**Validates: Requirements 11.1–11.4**

### Property 9: Economy Reconciliation Detects All Discrepancies

*For any* `Wallet` record where `Wallet.coins ≠ SUM(WalletTransaction.coins WHERE userId)`, the reconciliation worker shall detect and log the discrepancy with `{ userId, expected, actual, delta }` and increment `economy_reconciliation_discrepancies_total`. For any wallet with zero discrepancy, the worker shall not log an error for that wallet.

**Validates: Requirements 18.2–18.5**

---

## Error Handling

| Scenario | HTTP Status | Behaviour |
|---|---|---|
| Insufficient diamonds for payout | 402 | Transaction rolled back, current balance returned |
| Payout request already pending | 400 | Rejected before transaction |
| Invalid state transition (admin) | 400 | Returns current status and allowed next states |
| `PAYOUT_ENCRYPTION_KEY` absent/short | 500 on startup | Application refuses to start |
| AES decryption failure (corrupted ciphertext) | 500 | Log error; return masked empty object |
| `toDiamonds` / `toUsd` called with NaN | 422 | Validation layer catches before reaching service |
| Subscription OL fails (coins insufficient) | 402 | Transaction rolled back, coins balance returned |
| Gift DB cap fallback DB fails | 503 | Gift rejected, error logged; Redis update skipped |
| Fee payment P2002 (duplicate webhook) | 200 | Already-processed logged; `{ received: true }` returned |
| Stripe dispute — no matching WalletTransaction | 200 | `logger.error` logged; `{ received: true }` returned |
| Revenue report date range > 90 days | 400 | Maximum range message returned |
| SUPER_ADMIN attempts platform activity | 403 | Isolation guard blocks operation |
| Unknown roomType in roomResolver | null | Caller returns 404 (not 500) |

All errors inside Prisma interactive transactions cause automatic rollback. No partial state is committed.

---

## Testing Strategy

### Unit Tests

**`payout.test.js`** — covers:
- Successful payout request: diamond reservation correct, `PAYOUT` ledger entry created, `usdAmount` stored as Decimal string.
- Rejection of requests below `PAYOUT_MIN_DIAMONDS`.
- Rejection when insufficient diamond balance (402).
- Concurrent payout requests: two simultaneous requests for same amount → at most one succeeds, `Wallet.diamonds ≥ 0`.
- Admin approve → 200; attempt from wrong state → 400.
- Admin reject → diamonds restored, `PAYOUT_REVERSAL` created.
- Admin complete → 200.
- `GET /creators/me/payout-request` → 410.
- `accountDetails` fully redacted in user history response.
- `accountDetails` masked (last 4 + holder name) in admin list response.

**`creator.test.js`** — covers:
- Successful subscription: coins deducted, diamonds credited, `SUBSCRIPTION` ledger entry created.
- Concurrent subscriptions: two simultaneous requests → at most one activation, `Wallet.coins ≥ 0`.
- Rejection when coin balance is insufficient (402).
- Tip send: coins deducted from sender, diamonds credited to creator.
- Creator dashboard returns correct aggregates.
- `becomeCreator` returns 403 for `SUPER_ADMIN` users.

**`economy.config.test.js`** — covers startup validation: missing constant throws.

### Property-Based Tests (Jest + `fast-check`)

Using `fast-check` (existing Node.js PBT library consistent with Jest 29):

```js
// Property 1: toDiamonds invariants
test('toDiamonds: non-negative, integer, <= coins (Property 1)', () => {
  fc.assert(
    fc.property(fc.nat(), (c) => {
      const d = toDiamonds(c);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(c);
      expect(Number.isInteger(d)).toBe(true);
    }),
    { numRuns: 1000 }
  );
});
// Feature: halqa-economy-consolidation, Property 1: toDiamonds non-negativity and upper bound

// Property 2: toUsd precision invariants
test('toUsd: two decimal places, correct value (Property 2)', () => {
  fc.assert(
    fc.property(fc.nat(), (d) => {
      const usd = toUsd(d);
      expect(usd).toBe(parseFloat((d * 0.005).toFixed(2)));
      expect(usd).toBeGreaterThanOrEqual(0);
      expect(String(usd)).toMatch(/^\d+(\.\d{1,2})?$/);
    }),
    { numRuns: 1000 }
  );
});
// Feature: halqa-economy-consolidation, Property 2: toUsd two-decimal precision
```

Each property test runs minimum 1000 iterations.

Tag format in test files: `// Feature: halqa-economy-consolidation, Property N: <property_text>`

### Integration Tests

- Stripe dispute webhook: mock `charge.dispute.created` event → assert `logger.warn` called, Socket.IO emits to `role:SUPER_ADMIN`.
- Fee payment idempotency: send same `checkout.session.completed` twice → assert `FeeRecord` updated once.
- Revenue report: seed transactions for known date range → assert computed sums match expected values.
- Wallet history: seed transactions of all types → assert endpoint returns all with correct enrichment.
- Reconciliation worker: seed wallet with deliberate discrepancy → assert `logger.error` called with correct delta.
- Subscription renewal worker: seed expired subscriptions → assert expired ones marked correctly.

### Existing Tests (Not Modified)

- `backend/src/tests/idempotency.test.js` — untouched.
- All other existing test files — untouched.

---

## Migration Plan (Ordered)

| Migration | File | Change | Risk | Rollback |
|---|---|---|---|---|
| M-A | `20260900_add_diamonds_to_wallet_transactions/` | ADD COLUMN diamonds INT DEFAULT 0 | Low — additive, nullable default | DROP COLUMN |
| M-B | `20260901_payout_usd_decimal/` | MODIFY usd_amount FLOAT → DECIMAL(10,2) | Low — no precision loss for existing values | MODIFY back to FLOAT |
| M-C | `20260902_fee_record_stripe_session_id/` | ADD COLUMN + UNIQUE INDEX | Low — additive | DROP INDEX, DROP COLUMN |
| M-D | `20260903_account_details_encryption_note/` | No DDL — deploy encryption script separately | Medium — requires PAYOUT_ENCRYPTION_KEY env var | Run decryption script |
| M-E | `20260904_wallet_transaction_types_doc/` | Informational only (no DDL) | None | N/A |

**Deployment order:** M-A first (unblocks PAYOUT ledger entries), then M-B (precision fix), then M-C (fee idempotency), then M-D (encryption), then M-E (doc).

**Never edit deployed migration files.** All changes are strictly additive or column modifications on existing columns.

---

## Observability

### Logging

| Event | Level | Fields |
|---|---|---|
| Payout request submitted | `info` | `userId, diamonds, usdAmount, requestId` |
| Payout approved/rejected/completed | `info` | `adminId, requestId, action, userId` |
| Payout OL miss (concurrent rejected) | `warn` | `userId, requested, available` |
| AES decrypt failure | `error` | `requestId` (no key/plaintext) |
| Dispute received | `warn` | `disputeId, amount, reason, evidenceDueBy` |
| Dispute — no matching WalletTransaction | `error` | `paymentIntentId, disputeId` |
| Gift cap DB fallback used | `warn` | `userId, reason` |
| Gift cap DB fallback failed | `error` | `userId, error.message` |
| Reconciliation discrepancy | `error` | `userId, expected, actual, delta` |
| Reconciliation clean run | `info` | `walletsChecked, timestamp` |

### Prometheus Metrics

| Metric | Type | Description |
|---|---|---|
| `economy_payout_requests_total` | Counter | Labels: `status` (submitted/approved/rejected/completed/cancelled) |
| `economy_payout_diamonds_reserved_total` | Counter | Total diamonds reserved in payout requests |
| `economy_payout_usd_completed_total` | Counter | Total USD value of completed payouts |
| `economy_reconciliation_discrepancies_total` | Counter | Wallet balance discrepancies detected |
| `economy_reconciliation_last_run_timestamp` | Gauge | Unix timestamp of last reconciliation run |
| `economy_gift_cap_db_fallback_total` | Counter | Gift cap DB fallback activations (Redis miss) |
| `economy_subscription_renewals_total` | Counter | Labels: `result` (success/failed/expired) |
| `economy_dispute_events_total` | Counter | Stripe dispute events received |

### Grafana Alerts

- `economy_reconciliation_discrepancies_total > 0` → PagerDuty alert.
- `economy_payout_requests_total{status="completed"} rate drops > 50%` for 1h → warn.
- `economy_dispute_events_total` increases → Slack alert to platform team.

---

## Rollback Strategy Per Component

| Component | Rollback Action |
|---|---|
| Economy Config module | Revert import statements to local constants (hotfix) |
| Payout OL | Remove `diamonds: { gte: amount }` from WHERE clause — reverts to pre-lock behaviour |
| Encryption | Run decryption script, remove encrypt/decrypt calls, redeploy |
| Migration M-A | `ALTER TABLE wallet_transactions DROP COLUMN diamonds` |
| Migration M-B | `ALTER TABLE payout_requests MODIFY COLUMN usd_amount FLOAT NOT NULL` |
| Migration M-C | `DROP INDEX uq_fee_stripe_session; DROP COLUMN stripe_session_id` |
| `/creators/me/payout-request` 410 | Restore handler from git history |
| Subscription OL | Restore pre-check `if (!wallet || wallet.coins < tier.priceCoins)` |
| Workers | `QUEUE_NAMES` entries removed from `queue.service.js`; worker files deleted |
