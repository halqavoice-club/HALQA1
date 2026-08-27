# Coins and Wallet

**Audit date:** 2026-08-26

---

## Database Models

### `Wallet`

One wallet per user. Created automatically.

| Field | Notes |
|-------|-------|
| `coins` | Spendable currency (purchased or granted) |
| `diamonds` | Earned by receiving gifts/tips |
| `totalSpent` | Lifetime coins spent |
| `totalEarned` | Lifetime diamonds earned |

```
@@unique([userId])
```

### `WalletTransaction` (Immutable Ledger)

Every coin credit and debit is recorded here. Never modified after creation.

| Field | Notes |
|-------|-------|
| `type` | STRIPE_PURCHASE / GIFT_SEND / TIP_SEND / SUBSCRIPTION / ADMIN_GRANT / REFUND |
| `coins` | Positive = credit, negative = debit |
| `stripeSessionId?` | `@unique` — prevents Stripe double-credit at DB layer |
| `packageId?` | FK → `CoinPackage` |
| `giftTxId?` | FK → `GiftTransaction` |
| `tipId?` | FK → `CreatorTip` |

The `@unique` on `stripeSessionId` is the **primary defense against Stripe webhook double-credit** at the DB layer. Even if the webhook fires twice, the second write fails with a unique constraint violation.

### `CoinPackage`

Platform-defined coin packages for purchase.

| Field | Notes |
|-------|-------|
| `name` | Package display name |
| `coins` | Base coins included |
| `priceUsd` | Price in USD |
| `bonusCoins` | Bonus coins |
| `isActive` | Whether purchasable |
| `sortOrder` | Display order |

---

## Wallet API — `/api/v1/wallet`

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/me` | ✅ | Own wallet balance (coins, diamonds, totals) |
| GET | `/packages` | ✅ | List active coin packages |
| POST | `/purchase` | ✅ | Purchase coins (dev mode direct grant; prod uses Stripe) |
| GET | `/history` | ✅ | Transaction history (cursor-paginated) |

---

## Coin Economy

### Debit (spending coins)

Coins are debited in a DB transaction when:
1. **Sending a gift** (`sendGift`)
2. **Sending a tip** (`creatorTip`)
3. **Subscribing to creator tier** (`creatorSubscription`)

The debit uses `prisma.$transaction` to ensure atomicity:
```javascript
// In sendGift:
await prisma.$transaction([
  prisma.wallet.update({ where: { userId: senderId }, data: { coins: { decrement: totalCoins } } }),
  prisma.wallet.update({ where: { userId: receiverId }, data: { diamonds: { increment: totalDiamonds } } }),
  prisma.walletTransaction.create({ data: { type: 'GIFT_SEND', coins: -totalCoins, ... } }),
  prisma.giftTransaction.create({ data: { ... } }),
  prisma.roomGiftLeaderboard.upsert({ ... }),
]);
```

### Credit (earning coins)

Coins are credited:
1. **Stripe webhook** (`handleWebhook`) — `wallet:coins_credited` socket event + `WalletTransaction` created
2. **Dev mode direct purchase** (`purchaseCoins`) — bypasses Stripe
3. **ADMIN_GRANT** — schema supports this type but no admin API endpoint exists yet (UIGAP-005)

---

## Diamond Economy

Diamonds are earned by receiving gifts and tips. 

Conversion rate (from gift controller):
```javascript
const diamondsPerCoin = gift.rarity === 'legendary' ? 0.9
                      : gift.rarity === 'epic'       ? 0.85
                      : gift.rarity === 'rare'       ? 0.8
                      : 0.75;  // common
const totalDiamonds = Math.floor(totalCoins * diamondsPerCoin);
```

Diamonds are converted to cash via the payout system (minimum 2000 diamonds). Diamond → USD rate: `diamonds × 0.005` (stored in `PayoutRequest.usdAmount`).

---

## Transaction Safety

All coin/diamond balance changes use `prisma.$transaction`:
- Coin deduction and diamond credit are atomic
- If any step fails, the entire transaction rolls back
- `WalletTransaction` is the source of truth (immutable)
- `Wallet.coins`/`diamonds` are derived counts that can be reconciled against `WalletTransaction` if needed
