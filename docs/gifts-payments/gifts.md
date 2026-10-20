# Gift System (Universal Gift Engine)

**Source:** `backend/src/controllers/gift.controller.js`, `backend/src/utils/roomResolver.js`  
**Audit date:** 2026-08-26

---

## Gift Catalog (`Gift` model)

| Field | Notes |
|-------|-------|
| `name` | Gift display name |
| `emoji` | Fallback emoji |
| `imageUrl?` | Static image |
| `videoUrl?` | Optional animation video |
| `animationType` | overlay / banner / spotlight / fullscreen / cinematic / video |
| `soundEffect?` | |
| `priceCoins` | Cost in coins |
| `rarity` | common / rare / epic / legendary / ultimate |
| `comboEnabled` | Whether combos are triggered |
| `priority` | normal / high / ultra |
| `isPremium` | Premium gift flag |
| `isActive` | Whether purchasable |
| `sortOrder` | Catalog order |

---

## Gift Sending — Universal Engine

Gifts can be sent in multiple room types via a shared engine:

| Room type | Endpoint | `req.roomType` |
|-----------|----------|----------------|
| Voice room | `POST /voice/:id/gifts` | `'voice'` |
| Live class | `POST /live-classes/:id/gifts` | `'live_class'` |
| PK battle | Via PK gift event | `'pk'` |

The controller function `sendGift()` handles all room types. `req.roomType` is injected by the route middleware.

### Gift Flow (`sendGift`)

```
Client → POST /voice/:id/gifts { giftId, receiverId, count?, idempotencyKey }
  └─ Rate limit: 30 per 10 seconds
  └─ Validation: giftId + receiverId required, count 1–100
  └─ sendGift():
     1. Idempotency check:
        GiftTransaction.findUnique({ where: { idempotencyKey } })
        If found → return 200 duplicate: true
     2. Validate room:
        roomResolver.validateRoom(roomType, roomId)
        Room must be LIVE/active
     3. Validate participant:
        roomResolver.validateParticipant(roomType, roomId, senderId)
        Sender must be active participant
     4. Validate receiver:
        roomResolver.getReceivers(roomType, roomId, receiverId)
        Receiver must be active participant
     5. Check sender wallet (coins >= priceCoins × count)
     6. Calculate combo multiplier (Redis-cached per room)
     7. prisma.$transaction:
        a. Deduct sender coins
        b. Credit receiver diamonds
        c. Create WalletTransaction (type='GIFT_SEND', coins=-totalCoins)
        d. Create GiftTransaction
        e. Upsert RoomGiftLeaderboard
     8. Emit socket events:
        gift:sent → voice:{roomId} (universal)
        voice:gift_sent → voice:{roomId} (compat alias)
        voice:premium_gift → voice:{roomId} (if isPremium)
        gift:received → user:{receiverId}
     9. Return transaction + senderCoinsRemaining + diamondsEarned
```

---

## Idempotency

`GiftTransaction.idempotencyKey` has a `@unique` constraint. The client should:
1. Generate a UUID before calling the endpoint
2. On network timeout, retry with the same `idempotencyKey`
3. Server detects duplicate and returns `{ duplicate: true }` without double-charging

---

## Send Gift to All (`sendGiftToAll`)

Sends the same gift to ALL active speakers (HOST + MODERATOR + SPEAKER) simultaneously.

- Total cost = `priceCoins × count × receiverCount`
- Each receiver gets a separate `GiftTransaction` with unique `idempotencyKey`
- Single socket event with all receivers listed

---

## Gift Catalog API — `/api/v1/gifts`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | List all active gifts |
| GET | `/leaderboard/daily` | Top 10 gifters today (sum of coinsSpent) |

Per-room gift endpoints are on the room routes (not `/api/v1/gifts`):
- `GET /voice/:id/gifts/leaderboard`
- `GET /voice/:id/gifts/history`
- `GET /voice/:id/gifts/top-supporters`
- Same pattern at `/live-classes/:id/gifts/*`

---

## `RoomGiftLeaderboard` Model

Tracks total coins gifted per user per room session:

```
@@unique([roomId, userId])
@@index([roomId])
@@index([totalCoins])
```

Updated via `upsert` on every successful gift send.

---

## Authorization

- Sender must be authenticated (`authenticate`)
- Sender must be an active participant in the room (`roomResolver.validateParticipant`)
- For SCHOOL streams: `checkLiveClassSchool` enforces same-school check (SUPER_ADMIN bypass removed — ARCH-02)
- For PUBLIC streams and voice rooms: any authenticated participant can gift

---

## Combo System

Consecutive gifts from the same sender in a short time window trigger combo multipliers:

- Combo state stored in Redis (per room, per sender)
- Combo level determines visual animation intensity
- `comboEnabled = false` on a gift disables combo for that gift type
