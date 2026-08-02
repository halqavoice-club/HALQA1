# Design Document: Universal Gift Engine

## Overview

The Universal Gift Engine is a **platform-level service** shared by every live product in HALQA — Voice Club, Live Class, Video Live, PK Battles, Community Rooms, Club Events, Workshops, and any future live product. There is exactly **one** gift engine. Room types plug in; they do not duplicate.

The core principle: **wire, don't rewrite**. The existing `gift.controller.js`, `GiftPanel`, `GiftOverlay`, and `PremiumGiftOverlay` are the engine. New room types supply an adapter — a thin shim that maps their room/participant model to the engine's interface.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    HALQA Universal Gift Engine                      │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Shared Backend Layer                      │   │
│  │  gift.controller.js   (sendGift, sendGiftToAll, leaderboard)│   │
│  │  gift.routes.js       (/api/v1/gifts)                       │   │
│  │  DB: Gift, GiftTransaction, RoomGiftLeaderboard, Wallet     │   │
│  └──────────────────────────┬──────────────────────────────────┘   │
│                             │  Room Adapter Interface               │
│           ┌─────────────────┼─────────────────────┐                │
│           ▼                 ▼                       ▼               │
│  ┌────────────────┐ ┌──────────────────┐ ┌──────────────────┐     │
│  │  Voice Club    │ │   Live Class     │ │  Future Products │     │
│  │  Adapter       │ │   Adapter        │ │  Adapter         │     │
│  │  (existing)    │ │  (NEW - thin)    │ │  (plug-in)       │     │
│  └────────────────┘ └──────────────────┘ └──────────────────┘     │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Shared Frontend Layer                    │   │
│  │  GiftPanel (voice/GiftPanel.tsx)                           │   │
│  │  GiftOverlay (voice/GiftOverlay.tsx)                       │   │
│  │  PremiumGiftOverlay (voice/PremiumGiftOverlay.tsx)         │   │
│  │  useGiftEngine hook (NEW - universal)                      │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Room Adapter Interface

Each room type implements a **Room Adapter** — a small object that maps the room's model to the engine's generic interface:

```typescript
interface RoomGiftAdapter {
  roomType:    'voice' | 'live_class' | 'video_live' | 'pk' | 'community'
  roomId:      string
  sendUrl:     string   // POST endpoint for single gift
  sendAllUrl:  string   // POST endpoint for all-stage gift
  leaderboardUrl: string
  historyUrl:  string
  socketRoom:  string   // Socket.IO room name to join for gift events
  // Map room participants to the generic GiftRecipient shape
  mapParticipants: (raw: any[]) => GiftRecipient[]
  // Check permission: can `senderRole` gift `recipientRole`?
  canSend: (senderRole: string, recipientRole: string, settings: RoomGiftSettings) => boolean
}
```

### Live Class Adapter (new)

```typescript
const liveClassAdapter: RoomGiftAdapter = {
  roomType:       'live_class',
  roomId:         liveClassId,
  sendUrl:        `/live-classes/${liveClassId}/gifts`,
  sendAllUrl:     `/live-classes/${liveClassId}/gifts/all`,
  leaderboardUrl: `/live-classes/${liveClassId}/gifts/leaderboard`,
  historyUrl:     `/live-classes/${liveClassId}/gifts/history`,
  socketRoom:     `liveclass:${liveClassId}`,
  mapParticipants: (participants: LCParticipant[]) =>
    participants.map(p => ({
      userId:    p.userId,
      firstName: p.user.firstName,
      lastName:  p.user.lastName,
      avatarUrl: p.user.avatarUrl,
      role:      p.role,   // HOST | STUDENT | OBSERVER
    })),
  canSend: (senderRole, recipientRole, settings) =>
    giftPermissionEngine.check(senderRole, recipientRole, settings),
}
```

### Voice Club Adapter (existing — wrapped)

```typescript
const voiceAdapter: RoomGiftAdapter = {
  roomType:       'voice',
  roomId:         voiceRoomId,
  sendUrl:        `/voice/${voiceRoomId}/gifts`,
  sendAllUrl:     `/voice/${voiceRoomId}/gifts/all`,
  leaderboardUrl: `/voice/${voiceRoomId}/gifts/leaderboard`,
  historyUrl:     `/voice/${voiceRoomId}/gifts/history`,
  socketRoom:     `voice:${voiceRoomId}`,
  mapParticipants: (participants: VoiceParticipant[]) =>
    participants.map(p => ({ ...p.user, role: p.role })),
  canSend: (senderRole, recipientRole, settings) =>
    giftPermissionEngine.check(senderRole, recipientRole, settings),
}
```

---

## Backend Changes

### 1. Generalize `gift.controller.js`

The current controller hardcodes `voiceRoom` and `voiceParticipant` lookups. We add a **room resolver** that routes to the correct Prisma model based on `roomType`:

```javascript
// room-resolver.js (new)
async function resolveRoom(roomType, roomId) {
  if (roomType === 'voice') {
    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } })
    return room ? { id: room.id, status: room.status } : null
  }
  if (roomType === 'live_class') {
    const lc = await prisma.liveClass.findFirst({ where: { id: roomId, deletedAt: null } })
    return lc ? { id: lc.id, status: lc.status === 'LIVE' ? 'LIVE' : lc.status } : null
  }
  // future: video_live, pk, community
  throw new Error(`Unknown roomType: ${roomType}`)
}

async function resolveParticipant(roomType, roomId, userId) {
  if (roomType === 'voice') {
    return prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } },
      include: { user: { select: userSelect } }
    })
  }
  if (roomType === 'live_class') {
    return prisma.liveClassParticipant.findFirst({
      where: { liveClassId: roomId, userId, isActive: true },
      include: { user: { select: userSelect } }
    })
  }
}

async function resolveActiveRecipients(roomType, roomId, excludeUserId) {
  if (roomType === 'voice') {
    return prisma.voiceParticipant.findMany({
      where: { roomId, isActive: true, role: { in: ['HOST','MODERATOR','SPEAKER'] }, userId: { not: excludeUserId } },
      include: { user: { select: userSelect } }
    })
  }
  if (roomType === 'live_class') {
    return prisma.liveClassParticipant.findMany({
      where: { liveClassId: roomId, isActive: true, userId: { not: excludeUserId } },
      include: { user: { select: userSelect } }
    })
  }
}
```

### 2. New Live Class Gift Routes

```javascript
// In live-class.routes.js (additions)
router.post('/:id/gifts',
  giftRateLimit,
  [body('giftId').notEmpty(), body('receiverId').notEmpty(), body('count').optional().isInt({ min:1, max:100 })],
  validate,
  (req, res) => { req.roomType = 'live_class'; sendGift(req, res) }
)
router.post('/:id/gifts/all',
  giftRateLimit,
  [body('giftId').notEmpty()],
  validate,
  (req, res) => { req.roomType = 'live_class'; sendGiftToAll(req, res) }
)
router.get('/:id/gifts/leaderboard', getRoomLeaderboard)
router.get('/:id/gifts/history',     getRoomGiftHistory)
router.get('/:id/gifts/top-supporters', getTopSupporters)
```

### 3. Socket.IO Event Normalization

Live class gift events are broadcast to `liveclass:{id}` room using the same payload shape as voice gifts:

```javascript
// In gift.controller.js — after transaction commits:
const socketRoom = roomType === 'live_class'
  ? `liveclass:${roomId}`
  : `voice:${roomId}`

io.to(socketRoom).emit('gift:sent', payload)   // universal event name
// Keep backward-compat aliases:
if (roomType === 'voice') io.to(socketRoom).emit('voice:gift_sent', payload)
if (roomType === 'live_class') io.to(socketRoom).emit('liveclass:gift_sent', payload)
```

---

## Frontend: `useGiftEngine` Hook

A single reusable hook that any room component calls:

```typescript
// hooks/useGiftEngine.ts (new)
interface UseGiftEngineOptions {
  adapter:    RoomGiftAdapter
  onGiftSent?: (event: GiftEvent) => void
}

function useGiftEngine({ adapter, onGiftSent }: UseGiftEngineOptions) {
  const { wallet, addGiftEvent, deductCoins } = useVoiceStore()

  const sendGift = async (giftId: string, receiverId: string, count: number, key: string) => {
    const res = await api.post(adapter.sendUrl, { giftId, receiverId, count, idempotencyKey: key })
    deductCoins(res.data.data.coinsSpentTotal ?? 0)
    return res
  }

  const sendGiftToAll = async (giftId: string, count: number, key: string) => {
    const res = await api.post(adapter.sendAllUrl, { giftId, count, idempotencyKey: key })
    deductCoins(res.data.data.totalCoinsSpent ?? 0)
    return res
  }

  // Subscribe to socket events for this room
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    const handler = (event: GiftEvent) => {
      addGiftEvent(event)
      onGiftSent?.(event)
    }
    socket.on('gift:sent', handler)
    socket.on('liveclass:gift_sent', handler)
    socket.on('voice:gift_sent', handler)
    return () => {
      socket.off('gift:sent', handler)
      socket.off('liveclass:gift_sent', handler)
      socket.off('voice:gift_sent', handler)
    }
  }, [adapter.socketRoom])

  return { sendGift, sendGiftToAll, wallet }
}
```

---

## Permission Engine

```typescript
// lib/giftPermissions.ts (new)
export interface RoomGiftSettings {
  giftsEnabled:       boolean
  anonymousGifts:     boolean
  premiumOnly:        boolean
  senderRoles:        string[]   // roles that can send
  recipientRoles:     string[]   // roles that can receive
}

export const DEFAULT_LIVE_CLASS_SETTINGS: RoomGiftSettings = {
  giftsEnabled:   true,
  anonymousGifts: false,
  premiumOnly:    false,
  senderRoles:    ['HOST', 'STUDENT', 'OBSERVER'],    // everyone can send
  recipientRoles: ['HOST', 'STUDENT'],                 // teachers + students can receive
}

export const giftPermissionEngine = {
  check(senderRole: string, recipientRole: string, settings: RoomGiftSettings): boolean {
    if (!settings.giftsEnabled) return false
    if (!settings.senderRoles.includes(senderRole)) return false
    if (!settings.recipientRoles.includes(recipientRole)) return false
    return true
  }
}
```

---

## Educational Gift Collection (new catalog additions)

These are added to the `Gift` table via a seed/migration:

| Name | Emoji | Rarity | Price (coins) | Animation |
|---|---|---|---|---|
| Notebook | 📔 | common | 1 | floating |
| Book | 📚 | common | 5 | floating |
| Golden Pencil | ✏️ | rare | 20 | glow |
| Certificate | 📜 | rare | 50 | glow |
| Graduation Cap | 🎓 | epic | 100 | stage-wide |
| Knowledge Tree | 🌳 | epic | 200 | stage-wide |
| Microscope | 🔬 | rare | 30 | glow |
| Telescope | 🔭 | rare | 30 | glow |
| Laptop | 💻 | epic | 150 | stage-wide |
| Library | 🏛️ | epic | 300 | stage-wide |
| Globe | 🌍 | rare | 25 | glow |
| Teacher Medal | 🏅 | epic | 500 | camera-shake |
| Star Student | ⭐ | rare | 100 | glow |
| Golden Trophy | 🏆 | legendary | 1000 | fullscreen-cinematic |
| Brain | 🧠 | rare | 50 | glow |
| Rocket | 🚀 | epic | 200 | stage-wide |
| Diamond Book | 💎 | legendary | 2000 | fullscreen-cinematic |
| Magic Blackboard | 🖊️ | epic | 500 | camera-shake |
| Wisdom Crown | 👑 | legendary | 5000 | fullscreen-cinematic |
| Scholarship Award | 🎖️ | legendary | 10000 | fullscreen-cinematic |

---

## Animation Layer Isolation

Gift animations render in a `position: fixed; z-index: 400+` layer, **completely independent** of the room content. They never affect:
- LiveKit audio/video tracks (different DOM tree)
- Whiteboard canvas (lower z-index)
- Chat and polls (below z-index: 300)
- Recording state

Low-end device mode: detect via `navigator.hardwareConcurrency <= 2 || navigator.deviceMemory <= 2` → disable cinematic/premium animations, keep common/rare floating animations.

---

## Database Changes

### `GiftTransaction` — add `roomType` field

```sql
ALTER TABLE gift_transactions ADD COLUMN room_type VARCHAR(30) NOT NULL DEFAULT 'voice';
ALTER TABLE room_gift_leaderboard ADD COLUMN room_type VARCHAR(30) NOT NULL DEFAULT 'voice';
```

This allows cross-room analytics and leaderboards.

### Prisma Schema

```prisma
model GiftTransaction {
  roomType  String  @default("voice")  // voice | live_class | video_live | pk
  // ... existing fields
}

model RoomGiftLeaderboard {
  roomType  String  @default("voice")
  // ... existing fields
}
```

---

## Security

- Rate limit: 30 gifts per 10 seconds per user (existing, reused)
- Daily cap: 50,000 coins (existing, reused)
- Server-side balance validation in atomic DB transaction (existing, reused)
- Idempotency key prevents double-send (existing, reused)
- `roomType` validated server-side — client cannot spoof room type

---

## Correctness Properties

1. **Wallet invariant**: After any gift transaction, `sender.coins_before - totalCoins = sender.coins_after`
2. **Diamond invariant**: Each receiver's `diamonds_before + floor(coinsPerReceiver * 0.5) = diamonds_after`
3. **No self-gift**: `senderId !== receiverId` always enforced
4. **Idempotency**: Replaying the same `idempotencyKey` returns the original transaction without re-charging
5. **Permission gate**: `canSend(senderRole, recipientRole, settings) === false` → 403, no coins deducted
6. **Atomicity**: If any step in the DB transaction fails, no coins are deducted and no diamonds credited
