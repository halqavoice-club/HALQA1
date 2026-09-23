---
inclusion: fileMatch
fileMatchPattern: "**/*stripe*,**/*wallet*,**/*gift*,**/*payout*,**/*coins*,**/*payment*,**/*transaction*"
description: Coin/diamond economy, Stripe integration, financial integrity rules, idempotency patterns
---

# Payments & Financial Integrity Rules

> **Financial operations are server authoritative.** Never trust client values for balances, gift values, payment status, or transaction totals.

---

## Economy Model

```
Real money (Stripe)
  ↓
Coins (spendable in-app, purchased via Stripe packages)
  ↓
Gifts (sent to hosts/recipients in content spaces)
  ↓
Diamonds (earned by receivers)
  ↓
Payout (cash withdrawal, minimum 2000 diamonds)
```

### Conversion Rates

| Gift rarity | Coin → Diamond multiplier |
|-------------|--------------------------|
| Common | `totalCoins × 0.75` |
| Rare | `totalCoins × 0.80` |
| Epic | `totalCoins × 0.85` |
| Legendary | `totalCoins × 0.90` |
| Ultimate | `totalCoins × 0.90` |

- Payout rate: `diamonds × $0.005` USD
- Minimum payout threshold: **2000 diamonds**
- Platform revenue: 50% of all gifted coin value (implied by sub-1:1 diamond conversion)
- Daily spend ceiling: `GIFT_DAILY_CAP` environment variable

### Key Routes

| Domain | Route prefix |
|--------|-------------|
| Wallet | `/api/v1/wallet` → `wallet.routes.js` |
| Stripe | `/api/v1/stripe` → `stripe.routes.js` |
| Gifts | `/api/v1/gifts` → `gift.routes.js` |
| Payouts | `/api/v1/wallet/payout` → `payout.routes.js` |

---

## INV-013 — Five Financial Integrity Rules

Every wallet/coin/diamond mutation **must** satisfy all five:

1. **Atomicity** — execute inside `prisma.$transaction()`; no partial state permitted
2. **Audit log** — write an `audit_logs` entry with before/after balance values
3. **Idempotency key** — prevent double-execution on retry
4. **Negative balance guard** — validate that resulting balance ≥ 0 before commit
5. **Access control** — require SUPER_ADMIN role + IP allowlist for admin-initiated mutations

---

## WalletTransaction Ledger

`WalletTransaction` records are **immutable after creation** — the ledger is append-only.

### Type Enum

| Type | Description | Refundable |
|------|-------------|-----------|
| `STRIPE_PURCHASE` | Coins purchased via Stripe | ✅ Yes |
| `GIFT_SEND` | Coins spent sending a gift | ❌ No |
| `TIP_SEND` | Coins spent on a creator tip | ❌ No |
| `SUBSCRIPTION` | Coins spent on a subscription | ❌ No |
| `ADMIN_GRANT` | Coins granted by platform admin | ✅ Yes |
| `REFUND` | Refund credit entry | ❌ No (cannot refund a refund) |

### Double-Credit Defense — Three Layers

1. **Stripe delivery** — Stripe best-effort delivers each event once
2. **Redis cache** — event ID cached on receipt; re-delivery within TTL is detected and rejected
3. **DB unique constraint** — `WalletTransaction.stripeSessionId @unique` — second write fails with unique constraint violation

---

## Stripe Webhook Flow

```javascript
// Route must use express.raw() — NOT express.json()
// app.use('/api/v1/stripe/webhook', express.raw({ type: 'application/json' }))

// 1. Verify signature
const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);

// 2. Calculate coin total
const totalCoins = package.coins + package.bonusCoins;

// 3. Atomic DB write
await prisma.$transaction([
  prisma.user.update({ where: { id: userId }, data: { coinBalance: { increment: totalCoins } } }),
  prisma.walletTransaction.create({
    data: {
      userId,
      type: 'STRIPE_PURCHASE',
      coins: totalCoins,
      stripeSessionId,   // @unique — prevents double-credit
    }
  }),
]);

// 4. Notify client
io.to(`user:${userId}`).emit('wallet:coins_credited', { coins: totalCoins });
io.to(`wallet:${userId}`).emit('wallet:coins_credited', { coins: totalCoins });
```

---

## Gift Sending Flow

All five DB operations must be in a single `prisma.$transaction`:

1. Validate sender is active room participant (`roomResolver.validateParticipant`)
2. Validate receiver is active room participant (`roomResolver.getReceivers`)
3. Check sender coin balance ≥ gift cost **before** the transaction
4. Inside transaction:
   - Deduct sender coins (`coinBalance: { decrement: cost }`)
   - Credit receiver diamonds (`diamondBalance: { increment: diamonds }`)
   - Create `WalletTransaction` (type: `GIFT_SEND`)
   - Create `GiftTransaction`
   - Upsert `RoomGiftLeaderboard`

### Gift Idempotency Pattern

```javascript
// Client generates UUID before calling the endpoint
// On network timeout, client retries with the same key

// Server-side check:
const existing = await prisma.giftTransaction.findUnique({
  where: { idempotencyKey }
});
if (existing) return res.status(200).json({ duplicate: true });
// else proceed with transaction
```

---

## Refund Rules (Sprint 8)

- **Endpoint:** `POST /api/v1/admin/actions/transactions/:id/refund`
- **Refundable types:** `STRIPE_PURCHASE`, `ADMIN_GRANT`
- **Non-refundable types:** `GIFT_SEND`, `TIP_SEND`, `SUBSCRIPTION`, `REFUND` → returns 400
- **Idempotency:** duplicate refund attempt returns 409
- **Balance guard:** refund blocked if user has insufficient coins
- **Stripe integration:** `stripe.refunds.create({ payment_intent })` is fire-and-forget — Stripe failure is non-fatal (coins still refunded, error logged)
- **Audit log:** required per INV-013

---

## Realtime Credit Notification

After any successful coin credit:
```javascript
io.to(`user:${userId}`).emit('wallet:coins_credited', { coins, newBalance });
io.to(`wallet:${userId}`).emit('wallet:coins_credited', { coins, newBalance });
```

After school fee payment:
```javascript
io.to(`user:${paidById}`).emit('fee:paid', { feeId, amount });
```

---

## Cross-References

- Stripe SDK version → `tech.md`
- SUPER_ADMIN financial mutation rules → `security.md` INV-013
- Idempotency middleware → `backend/src/middleware/idempotency.js`
- Room context validator → `backend/src/utils/roomResolver.js`
- Payments docs → `docs/gifts-payments/`
