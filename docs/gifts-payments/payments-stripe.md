# Payments — Stripe Integration

**Source:** `backend/src/routes/stripe.routes.js`, `backend/src/controllers/stripe.controller.js`  
**Mounted at:** `/api/v1/stripe`  
**Audit date:** 2026-08-26

---

## Overview

HALQA uses Stripe Checkout Sessions to process real-money coin purchases. The flow is:

```
1. Client → POST /stripe/checkout { packageId }
   └─ Creates a Stripe Checkout Session
   └─ Returns { url: "https://checkout.stripe.com/..." }

2. User completes payment on Stripe's hosted page

3. Stripe → POST /stripe/webhook (raw body, signature verified)
   └─ On checkout.session.completed:
      a. Verify Stripe signature (STRIPE_WEBHOOK_SECRET)
      b. Find user from session metadata
      c. Calculate totalCoins = package.coins + package.bonusCoins
      d. prisma.$transaction:
         - wallet.update coins += totalCoins
         - WalletTransaction.create { type: 'STRIPE_PURCHASE', stripeSessionId }
      e. socket.emit wallet:coins_credited → user:{userId}
      f. socket.emit wallet:coins_credited → wallet:{userId}
      g. queueBulkNotifications COINS_PURCHASED
```

---

## API Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/webhook` | None (raw body + Stripe sig) | Stripe calls this — no user auth |
| POST | `/checkout` | ✅ authenticate | Creates Stripe Checkout Session |

---

## Webhook Security

```javascript
// stripe.controller.js: handleWebhook
const sig = req.headers['stripe-signature'];
const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
```

- Raw body required — `express.raw()` applied on the webhook route only
- Stripe signature verified before any processing
- Invalid signature → 400 rejection

---

## Double-Credit Prevention

Three layers:
1. **Stripe idempotency** — Stripe delivers each webhook event once (best-effort)
2. **Redis idempotency** — Event ID cached in Redis to detect re-delivery within TTL
3. **DB unique constraint** — `WalletTransaction.stripeSessionId` has `@unique` — if the same session is processed twice, the second DB write fails with a unique constraint violation

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Backend API calls to Stripe |
| `STRIPE_PUBLISHABLE_KEY` | Frontend Stripe.js initialization |
| `STRIPE_WEBHOOK_SECRET` | Signature verification for incoming webhooks |

---

## Realtime Credit Notification

After successful coin credit, two socket events fire:
```javascript
io.to(`user:${userId}`).emit('wallet:coins_credited', { coins, packageId, stripeSessionId });
io.to(`wallet:${userId}`).emit('wallet:coins_credited', { coins, packageId, stripeSessionId });
```

The `wallet:{userId}` room is joined by the client on the wallet page for live balance updates.

Also fires a `fee:paid` event for school fee payments:
```javascript
io.to(`user:${paidBy}`).emit('fee:paid', { feeId, stripeSessionId });
```
