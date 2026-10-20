# Voice Club — API Endpoint Inventory

**Mounted at:** `/api/v1/voice`  
**Base auth:** `authenticate` on all routes  
**Audit date:** 2026-08-26

---

## Room Management

| Method | Path | Auth | Controller | Notes |
|--------|------|------|-----------|-------|
| GET | `/` | authenticate + moderateLimiter | `listRooms` | Filter by status/privacy/page |
| GET | `/search` | authenticate + moderateLimiter | `searchRooms` | Full-text search by title |
| GET | `/my` | authenticate + moderateLimiter | `getMyRooms` | Rooms created by current user |
| GET | `/scheduled` | authenticate + moderateLimiter | `getScheduledRooms` | Upcoming scheduled rooms |
| GET | `/:id` | authenticate + moderateLimiter | `getRoom` | PRIVATE/INVITE_ONLY: active participant required |
| POST | `/` | authenticate + writeLimiter + deviceLimiter | `createRoom` | Any auth user |
| PATCH | `/:id` | authenticate | `updateRoom` | HOST or active MODERATOR (SA-FIX-02) |
| DELETE | `/:id` | authenticate | `deleteRoom` | HOST only (SA-FIX-03) |
| POST | `/:id/cover` | authenticate | `uploadRoomCover` | HOST only (SA-FIX-06) |

### `GET /` — List Rooms Request/Response

```
GET /api/v1/voice?status=LIVE&privacy=PUBLIC&page=1&limit=50
```

Response: paginated list with host info, participant count, room metadata. List is cached (Redis, 10s TTL with pattern invalidation).

---

## Participant Lifecycle

| Method | Path | Auth | Controller | Notes |
|--------|------|------|-----------|-------|
| POST | `/:id/join` | authenticate | `joinRoom` | Privacy check, ban check, capacity |
| POST | `/:id/leave` | authenticate | `leaveRoom` | Auto-promotes next in queue |
| PATCH | `/:id/end` | authenticate | `endRoom` | **SUPER_ADMIN only** — archives room permanently |
| GET | `/:id/participants` | authenticate | `getParticipants` | All active participants grouped by role |
| GET | `/:id/status` | authenticate | Inline handler | Lightweight status poll (`{ status, hostId, participantCount }`) |

---

## Moderation

| Method | Path | Auth | Controller | Notes |
|--------|------|------|-----------|-------|
| PATCH | `/:id/mute` | authenticate | `toggleMute` | HOST/MOD can mute others; anyone can mute self |
| PATCH | `/:id/promote` | authenticate | `promoteParticipant` | HOST/MOD; body: `{ targetUserId, role: 'SPEAKER'|'AUDIENCE' }` |
| DELETE | `/:id/kick/:userId` | authenticate | `kickParticipant` | HOST/MOD (cannot kick HOST/other MOD) |
| POST | `/:id/ban/:userId` | authenticate | `banParticipant` | HOST/MOD; creates persistent `VoiceRoomMember.isBanned` |
| DELETE | `/:id/ban/:userId` | authenticate | `unbanParticipant` | HOST/MOD; removes ban |

---

## Role Management

| Method | Path | Auth | Controller | Notes |
|--------|------|------|-----------|-------|
| POST | `/:id/moderator/:userId` | authenticate + `checkVoiceRole([HOST])` | `assignModerator` | HOST assigns MOD |
| DELETE | `/:id/moderator/:userId` | authenticate + `checkVoiceRole([HOST])` | `removeModerator` | HOST removes MOD |
| POST | `/:id/transfer/:userId` | authenticate + `checkVoiceRole([HOST])` | `transferAdmin` | Transfer ownership; old HOST → MOD |
| PATCH | `/:id/mute-all` | authenticate + `checkVoiceRole([HOST, MOD])` | `muteAll` | Mutes all SPEAKER/MOD |
| PATCH | `/:id/unmute-all` | authenticate + `checkVoiceRole([HOST, MOD])` | `unmuteAll` | Unmutes all SPEAKER/MOD |
| PATCH | `/:id/pin/:userId` | authenticate + `checkVoiceRole([HOST, MOD])` | `pinSpeaker` | Pins/unpins speaker to top of grid |

---

## Speaker Queue (FIFO)

| Method | Path | Auth | Controller | Notes |
|--------|------|------|-----------|-------|
| POST | `/:id/queue/raise` | authenticate | `queueRaiseHand` | AUDIENCE only; blocked if micLocked |
| DELETE | `/:id/queue/cancel` | authenticate | `cancelHand` | Own hand only |
| POST | `/:id/queue/approve` | authenticate | `approveNext` | HOST/MOD; promotes first in queue |
| POST | `/:id/queue/approve/:userId` | authenticate | `approveUser` | HOST/MOD; promotes specific user |
| DELETE | `/:id/queue/reject/:userId` | authenticate | `rejectUser` | HOST/MOD; removes from queue |
| GET | `/:id/queue` | authenticate | `getQueueHandler` | Full queue: HOST/MOD; own position: audience (SA-FIX-09) |

---

## Mic Controls

| Method | Path | Auth | Controller | Notes |
|--------|------|------|-----------|-------|
| PATCH | `/:id/raise-hand` | authenticate | `raiseHand` (legacy) | Delegates to queue system |
| PATCH | `/:id/open-mic` | authenticate + `checkVoiceRole([HOST, MOD])` | `toggleOpenMic` | Audience can grab mic directly when true |
| PATCH | `/:id/mic-lock` | authenticate + `checkVoiceRole([HOST, MOD])` | `toggleMicLock` | Blocks queue + grab mic when true |
| PATCH | `/:id/seat-lock` | authenticate | `toggleSeatLock` | HOST/MOD; locks/unlocks a seat slot by index |
| POST | `/:id/grab-mic` | authenticate | `grabMic` | AUDIENCE: instant speaker if slot available, queue if full |
| POST | `/:id/drop-mic` | authenticate | `dropMic` | SPEAKER: self-demote to AUDIENCE; auto-promotes next in queue |

---

## Mic Pass

| Method | Path | Auth | Controller | Notes |
|--------|------|------|-----------|-------|
| POST | `/:id/mic-pass/:targetUserId` | authenticate | `sendMicOffer` | SPEAKER/HOST passes mic |
| POST | `/:id/mic-pass/:offerId/accept` | authenticate | `acceptMicOffer` | Target accepts; passer → AUDIENCE (unless HOST) |
| POST | `/:id/mic-pass/:offerId/decline` | authenticate | `declineMicOffer` | Target declines |
| DELETE | `/:id/mic-pass/:offerId` | authenticate | `cancelMicOffer` | Passer cancels before acceptance |

---

## Chat

| Method | Path | Auth | Controller | Notes |
|--------|------|------|-----------|-------|
| GET | `/:id/messages` | authenticate | `getMessages` | PRIVATE/INVITE_ONLY: active participant required (SA-FIX-08) |
| POST | `/:id/messages` | authenticate | `sendMessage` | All active participants |
| DELETE | `/:id/messages/:msgId` | authenticate | `deleteMessage` | Author, HOST, or MODERATOR |

---

## LiveKit Token

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/:id/livekit-token` | authenticate | Requires active `VoiceParticipant.isActive`; room must not be ENDED |

---

## Gifts

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/:id/gifts` | authenticate + giftRateLimit (30/10s) | Send gift to one recipient |
| POST | `/:id/gifts/all` | authenticate + giftRateLimit | Send gift to all speakers/host |
| GET | `/:id/gifts/leaderboard` | authenticate | Top gifters |
| GET | `/:id/gifts/history` | authenticate | Gift transaction history |
| GET | `/:id/gifts/top-supporters` | authenticate | Top 3 supporters |

---

## Stats

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/stats/me` | authenticate | Own hosting stats |
| GET | `/stats/leaderboard` | authenticate | Global/weekly/monthly leaderboard |

---

## Member Management (`/api/v1/voice/:id/members`)

Mounted separately at `app.use('/api/v1/voice/:id/members', roomMemberRoutes)`.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | List members (paginated, filterable by role/status) |
| GET | `/:userId` | Get specific member |
| PATCH | `/:userId/role` | HOST/CO_OWNER assigns member role |
| DELETE | `/:userId` | HOST removes member from room |
