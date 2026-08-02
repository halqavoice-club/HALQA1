# HALQA — Stripe Payment Setup Guide

## Phase B-2 Implementation Complete

Stripe is integrated but requires your API keys to go live.
In development the system falls back to instant coin credits (existing dev mode).

---

## Step 1 — Create a Stripe Account

1. Go to https://dashboard.stripe.com/register
2. Create and activate your account

---

## Step 2 — Get API Keys

1. Go to https://dashboard.stripe.com/test/apikeys
2. Copy your **Publishable key** (starts with `pk_test_...`)
3. Copy your **Secret key** (starts with `sk_test_...`)

---

## Step 3 — Set Backend Keys

Edit `backend/.env`:

```env
STRIPE_SECRET_KEY=sk_test_YOUR_ACTUAL_KEY_HERE
STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET_HERE   # see Step 5
STRIPE_SUCCESS_URL=http://localhost:3000/wallet?payment=success
STRIPE_CANCEL_URL=http://localhost:3000/wallet?payment=cancelled
```

---

## Step 4 — Set Frontend Key

Edit `frontend/.env.local`:

```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_ACTUAL_KEY_HERE
```

---

## Step 5 — Set Up Webhook (for real payment confirmation)

The webhook is what actually credits coins after payment.

### Development (local testing with Stripe CLI):

```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
stripe login
stripe listen --forward-to localhost:5000/api/v1/stripe/webhook
```

Copy the webhook signing secret printed by the CLI (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.

### Production:

1. Go to https://dashboard.stripe.com/webhooks
2. Add endpoint: `https://yourdomain.com/api/v1/stripe/webhook`
3. Select event: `checkout.session.completed`
4. Copy the webhook signing secret → `STRIPE_WEBHOOK_SECRET`

---

## Step 6 — Restart Backend

```bash
node src/app.js
```

---

## How It Works

```
User clicks Buy → POST /api/v1/stripe/checkout
                → Stripe Checkout Session created
                → User redirected to Stripe payment page
                → User pays with card
                → Stripe calls POST /api/v1/stripe/webhook
                → Signature verified (tamper-proof)
                → Coins credited to wallet via DB transaction
                → Socket event wallet:coins_credited sent to user
                → User notified in real-time
                → Wallet page auto-refreshes
```

## Fallback (Development)

When `STRIPE_SECRET_KEY` is not set (or starts with `sk_test_REPLACE`):
- The buy button calls existing `POST /api/v1/wallet/purchase` (dev mode)
- Coins are credited instantly without payment
- Existing dev workflow is completely preserved

---

## Production Checklist

- [ ] Replace `sk_test_` with `sk_live_` keys
- [ ] Replace `pk_test_` with `pk_live_` keys  
- [ ] Set `STRIPE_SUCCESS_URL` to your production domain
- [ ] Set `STRIPE_CANCEL_URL` to your production domain
- [ ] Configure webhook endpoint in Stripe dashboard
- [ ] Test with Stripe test cards: `4242 4242 4242 4242`
