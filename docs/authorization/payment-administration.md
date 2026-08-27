# Payment Administration — SUPER_ADMIN Capabilities

---

## Overview of the Financial System

```
User purchases coins via Stripe
        ↓
WalletTransaction (type=STRIPE_PURCHASE) created
Wallet.coins incremented
        ↓
User spends coins on gifts → GiftTransaction created
Sender: Wallet.coins decremented
Receiver: Wallet.diamonds incremented
        ↓
Host requests payout via PayoutRequest
Diamonds → USD (pending manual approval)
        ↓
PayoutRequest.status = APPROVED → PROCESSING → COMPLETED
```

---

## What SUPER_ADMIN Can View

### Platform Wallet Overview

**API:** `GET /api/v1/admin/stats/payments`  
**Auth:** IP allowlist + authenticate + authorize('SUPER_ADMIN')

Returns:
```json
{
  "stats": {
    "totalWallets": 8420,
    "totalTransactions": 45321,
    "transactionsLast30d": 1234
  },
  "recentTransactions": [
    {
      "id": "...",
      "type": "STRIPE_PURCHASE",
      "coins": 1000,
      "description": "...",
      "createdAt": "...",
      "wallet": {
        "user": {
          "id": "...",
          "firstName": "Ahmad",
          "lastName": "Ali",
          "email": "..."
        }
      }
    }
  ]
}
```

**What is visible:** Transaction type, coin amount, description, Stripe session ID (partial), user identity for the last 50 transactions.

---

### Platform Gift Economy Overview

**API:** `GET /api/v1/admin/stats/gifts`  
**Auth:** IP allowlist + authenticate + authorize('SUPER_ADMIN')

Returns:
```json
{
  "stats": {
    "total": 12345,
    "last7d": 340,
    "last30d": 1120,
    "catalogSize": 25
  },
  "recentTransactions": [
    {
      "senderId": "...",
      "receiverId": "...",
      "giftId": "...",
      "coinsSpent": 100,
      "diamondsEarned": 80,
      "createdAt": "...",
      "sender": { "id": "...", "firstName": "...", "lastName": "..." },
      "receiver": { "id": "...", "firstName": "...", "lastName": "..." },
      "gift": { "id": "...", "name": "Rose", "priceCoins": 100 }
    }
  ],
  "catalog": [
    { "id": "...", "name": "Rose", "priceCoins": 100, "rarity": "common", "isActive": true }
  ]
}
```

---

## What SUPER_ADMIN Can Manage

### Coin Package Catalog

Currently: **READ ONLY via admin stats** (catalog returned in the gifts endpoint).

**No write endpoint exists** for creating, updating, or deactivating coin packages via the admin API.

**Gap:** Changes to the `coin_packages` table currently require direct database access. This is a HIGH-RISK gap — coin price changes affect revenue.

---

### Gift Catalog

Currently: **READ ONLY via admin stats**.

**No write endpoint exists** for managing the gift catalog via the admin API.

**Gap:** Adding, editing, or deactivating gifts requires direct database access.

---

## What SUPER_ADMIN Cannot Do

### Individual Wallet Operations

| Operation | Status | Reason |
|-----------|--------|--------|
| View a specific user's wallet balance | ❌ | No per-user wallet endpoint in admin API |
| Credit coins to a user (ADMIN_GRANT) | ❌ | `ADMIN_GRANT` transaction type exists in schema but no admin endpoint |
| Debit coins from a user | ❌ | No admin endpoint |
| Reset a user's wallet | ❌ | No admin endpoint |
| View a user's full transaction history | ❌ | No per-user transaction list endpoint |

### Transaction Management

| Operation | Status | Reason |
|-----------|--------|--------|
| Refund a Stripe transaction | ❌ | Stripe refunds must be processed in the Stripe dashboard or via a dedicated refund endpoint (not currently implemented) |
| Void a gift transaction | ❌ | Gift transactions are immutable — no void/reverse API |
| Reverse a coin purchase | ❌ | No admin reverse endpoint |
| View Stripe webhook delivery status | ❌ | No admin webhook delivery view |

---

## Payout Administration — CRITICAL GAP

**Current state:** There is **no admin API** for managing payout requests.

The `payout_requests` table has:
- Full records of diamond withdrawal requests
- `accountDetails` field containing bank/PayPal info (HIGH sensitivity)
- `status` field (PENDING → APPROVED → PROCESSING → COMPLETED | REJECTED | CANCELLED)

**Risk:** CRITICAL

- Platform cannot process or reject payouts without direct database access
- `accountDetails` contains sensitive financial account information
- No audit trail for payout approvals/rejections

**Required (not currently implemented):**
```
GET  /api/v1/admin/payouts              — list pending/all payout requests
PATCH /api/v1/admin/payouts/:id/status  — approve/reject/mark-complete
```

Every payout status change must:
1. Be authenticated via IP allowlist + SUPER_ADMIN role
2. Write a full audit log entry
3. Validate that the diamond amount matches the wallet balance
4. Use a database transaction (debit diamonds + create payout record atomically)
5. Log the `transactionRef` from the payment provider

---

## Financial Risk Matrix

| Operation | Risk Level | Currently Implemented | Audit Logged |
|-----------|-----------|----------------------|--------------|
| View wallet stats (aggregate) | LOW | ✅ | N/A |
| View gift transaction history | MEDIUM | ✅ | N/A |
| View coin package catalog | LOW | ✅ (read-only) | N/A |
| Create/update coin packages | HIGH | ❌ (no API) | N/A |
| Admin coin grant to user | HIGH | ❌ (no API) | Required if implemented |
| Approve payout request | CRITICAL | ❌ (no API) | Required if implemented |
| Refund Stripe transaction | CRITICAL | ❌ (no API) | Required if implemented |
| Void gift transaction | HIGH | ❌ (no API) | Required if implemented |
| View individual user wallet | MEDIUM | ❌ (no API) | Required if implemented |

---

## Financial Mutation Requirements

Any future financial mutation endpoint added to the SUPER_ADMIN API surface must follow these requirements:

**Authorization chain:**
```
IP Allowlist → authenticate → authorize('SUPER_ADMIN') → validate body → DB transaction
```

**Required for every mutation:**
1. Input validation (amounts must be positive integers, within safe ranges)
2. Database transaction (atomic operation — never partial)
3. Idempotency key (prevent duplicate operations)
4. Full audit log entry with:
   - `userId` (acting admin)
   - `entityId` (target user or transaction)
   - `oldValues` (balance before)
   - `newValues` (balance after)
   - `reason` (admin-supplied justification)
   - `ipAddress` and `userAgent`
5. User notification (affected user should know their balance changed)
6. Cannot result in negative wallet balance

**No financial operation may be performed outside a database transaction.**
