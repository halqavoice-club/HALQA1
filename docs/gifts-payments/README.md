# HALQA Gifts, Coins, Payments — Documentation Index

**Audit date:** 2026-08-26  
**Status:** Read-only documentation audit. No application code modified.

---

## Economy Overview

```
Real money (Stripe) → Coins (spendable in-app)
Coins → Gifts → Diamonds (earned by receivers)
Diamonds → Payout (cash withdrawal by hosts)
```

| Currency | Earned by | Spent on |
|----------|-----------|---------|
| Coins | Purchasing via Stripe | Sending gifts, creator tips, subscriptions |
| Diamonds | Receiving gifts, receiving tips | Payout withdrawal |

---

## Document Index

| File | Contents |
|------|---------|
| [README.md](./README.md) | This index |
| [coins-wallet.md](./coins-wallet.md) | Wallet, coins, transaction ledger, coin packages |
| [gifts.md](./gifts.md) | Gift catalog, sending gifts, universal gift engine |
| [payments-stripe.md](./payments-stripe.md) | Stripe checkout, webhook, coin credits |
| [payouts.md](./payouts.md) | Diamond → cash payout flow, admin approval |
| [gaps.md](./gaps.md) | Known gaps (UIGAP-004, UIGAP-005, etc.) |

---

## Quick Facts

- **Wallet routes:** `backend/src/routes/wallet.routes.js` → `/api/v1/wallet`
- **Stripe routes:** `backend/src/routes/stripe.routes.js` → `/api/v1/stripe`
- **Gift routes:** `backend/src/routes/gift.routes.js` → `/api/v1/gifts`
- **Payout routes:** `backend/src/routes/payout.routes.js` → `/api/v1/wallet/payout`
- **Gift controller:** `backend/src/controllers/gift.controller.js`
- **Wallet controller:** `backend/src/controllers/wallet.controller.js`
- **Stripe controller:** `backend/src/controllers/stripe.controller.js`
- **Payout controller:** `backend/src/controllers/payout.controller.js`
- **Room resolver:** `backend/src/utils/roomResolver.js` (validates room context for gifts)
