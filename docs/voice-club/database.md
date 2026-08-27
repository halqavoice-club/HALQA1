# Voice Club — Database Models

**Source:** `backend/prisma/schema.prisma`  
**Audit date:** 2026-08-26

---

## Model 1 — `VoiceRoom` (`voice_rooms`)

**Purpose:** Central voice room record. Persistent — never auto-deleted.

### Fields

| Field | Type | Nullable | Default | Notes |
|-------|------|----------|---------|-------|
| `id` | String (UUID) | No | uuid() | Primary key |
| `schoolId` | String | Yes | null | Always null (rooms are global, not school-scoped) |
| `hostId` | String | No | — | FK → `users.id` (onDelete: Cascade) — room creator |
| `title` | String | No | — | Max 120 chars (validator) |
| `description` | String (Text) | Yes | — | |
| `privacy` | `VoiceRoomPrivacy` | No | `PUBLIC` | PUBLIC / PRIVATE / INVITE_ONLY |
| `status` | `VoiceRoomStatus` | No | `IDLE` | LIVE / IDLE / ENDED / SCHEDULED |
| `maxSpeakers` | Int | No | 10 | Max concurrent speakers on stage |
| `isOpenMic` | Boolean | No | false | When true, audience can grab mic directly |
| `micLocked` | Boolean | No | false | When true, nobody can grab mic or raise hand |
| `roomLevel` | Int | No | 1 | 1–10, controls max permanent members and capacity |
| `coverEmoji` | String | Yes | `'🎙️'` | Emoji display |
| `coverImageUrl` | String | Yes | null | Uploaded image |
| `topic` | String | Yes | null | Current room topic |
| `scheduledAt` | DateTime | Yes | null | For scheduled rooms |
| `startedAt` | DateTime | Yes | null | When first participant joined (LIVE transition) |
| `endedAt` | DateTime | Yes | null | When archived by SUPER_ADMIN |
| `lastActivityAt` | DateTime | Yes | null | Updated on participant join/leave |
| `recordingUrl` | String | Yes | null | |
| `commentsEnabled` | Boolean | No | true | Allow chat messages |
| `slowMode` | Boolean | No | false | 1 message per 5s per user |
| `messageType` | String | No | `'all'` | 'all' / 'followers' / 'none' |
| `reactionsEnabled` | Boolean | No | true | Allow emoji reactions |
| `lockedSeats` | Json | Yes | null | Array of locked seat indices |
| `deletedAt` | DateTime | Yes | null | Soft-delete (host DELETE action) |
| `createdAt` | DateTime | No | now() | |
| `updatedAt` | DateTime | No | updatedAt | |

### Enums

```
VoiceRoomPrivacy: PUBLIC | PRIVATE | INVITE_ONLY
VoiceRoomStatus: LIVE | IDLE | ENDED | SCHEDULED
VoiceParticipantRole: HOST | MODERATOR | SPEAKER | AUDIENCE
```

### Indexes

```
@@index([schoolId])
@@index([hostId])
@@index([status])
@@index([privacy])
@@index([status, privacy, schoolId])   // DB-001: most-hit listRooms query
```

### CRUD Authorization

| Operation | Who |
|-----------|-----|
| CREATE | Any authenticated user |
| READ (PUBLIC) | Any authenticated user |
| READ (PRIVATE/INVITE_ONLY) | Active `VoiceParticipant` or room host |
| UPDATE settings | HOST or active MODERATOR |
| UPDATE cover image | HOST only (SA-FIX-06) |
| DELETE (soft) | HOST only |
| END/ARCHIVE (status=ENDED) | **SUPER_ADMIN only** |

---

## Model 2 — `VoiceParticipant` (`voice_participants`)

**Purpose:** Active session participation record. One record per user per room.

### Fields

| Field | Type | Nullable | Default | Notes |
|-------|------|----------|---------|-------|
| `id` | String (UUID) | No | uuid() | |
| `roomId` | String | No | — | FK → `voice_rooms.id` (onDelete: Cascade) |
| `userId` | String | No | — | FK → `users.id` (onDelete: Cascade) |
| `role` | `VoiceParticipantRole` | No | `AUDIENCE` | HOST / MODERATOR / SPEAKER / AUDIENCE |
| `isMuted` | Boolean | No | true | Mic mute state (client-enforced) |
| `mutedByModerator` | Boolean | No | false | When true, user cannot self-unmute |
| `handRaised` | Boolean | No | false | In speaker queue |
| `handRaisedAt` | DateTime | Yes | null | Queue ordering |
| `isPinned` | Boolean | No | false | Pinned to top of stage grid |
| `joinedAt` | DateTime | No | now() | |
| `leftAt` | DateTime | Yes | null | |
| `isActive` | Boolean | No | true | Currently in room |
| `createdAt` | DateTime | No | now() | |
| `updatedAt` | DateTime | No | updatedAt | |

```
@@unique([roomId, userId])
@@index([roomId])
@@index([userId])
@@index([isActive])
@@index([roomId, isActive, role])            // active speakers query
@@index([roomId, isActive, handRaised, handRaisedAt])  // hand queue
```

---

## Model 3 — `VoiceRoomMember` (`voice_room_members`)

**Purpose:** Permanent membership registry — persists beyond individual sessions. Used for room-level bans, roles, contribution tracking.

### Fields

| Field | Type | Nullable | Default | Notes |
|-------|------|----------|---------|-------|
| `id` | String (UUID) | No | uuid() | |
| `roomId` | String | No | — | FK (onDelete: Cascade) |
| `userId` | String | No | — | FK (onDelete: Cascade) |
| `memberLevel` | Int | No | 1 | 1–5: Fan/Regular/VIP/Super/Legend |
| `role` | String | No | `'MEMBER'` | OWNER/CO_OWNER/ADMIN/MODERATOR/VIP/OFFICIAL/MEMBER/BLOCKED |
| `status` | String | No | `'ACTIVE'` | PENDING/ACTIVE/REMOVED |
| `nickname` | String | Yes | null | Custom display name in this room |
| `lastActiveAt` | DateTime | Yes | null | |
| `isOnline` | Boolean | No | false | |
| `contribution` | Int | No | 0 | Total coins gifted in this room |
| `invitedBy` | String | Yes | null | userId who invited them |
| `isBanned` | Boolean | No | false | Permanent ban |
| `joinedAt` | DateTime | No | now() | |
| `upgradedAt` | DateTime | Yes | null | Level upgrade timestamp |
| `note` | String | Yes | null | Admin note |

```
@@unique([roomId, userId])
@@index([roomId])
@@index([userId])
@@index([roomId, memberLevel])
@@index([roomId, isBanned])
@@index([roomId, status])
@@index([roomId, role])
@@index([roomId, isOnline])
```

**Note:** `isBanned = true` prevents the user from calling `joinRoom()` even if they have a valid `VoiceParticipant` record.

---

## Model 4 — `VoiceMessage` (`voice_messages`)

**Purpose:** Chat messages in a voice room.

### Fields

| Field | Type | Nullable | Default |
|-------|------|----------|---------|
| `id` | String (UUID) | No | uuid() |
| `roomId` | String | No | — |
| `userId` | String | No | — |
| `body` | String (Text) | No | — |
| `deletedAt` | DateTime | Yes | null |
| `createdAt` | DateTime | No | now() |

```
@@index([roomId])
@@index([userId])
@@index([roomId, createdAt])   // cursor pagination
```

---

## Model 5 — `VoiceHostStats` (`voice_host_stats`)

**Purpose:** Pre-aggregated per-host daily statistics.

### Fields

| Field | Type | Default |
|-------|------|---------|
| `id` | String (UUID) | uuid() |
| `userId` | String | — |
| `date` | DateTime (Date) | — |
| `roomsHosted` | Int | 0 |
| `totalMinutes` | Int | 0 |
| `peakAudience` | Int | 0 |
| `totalListeners` | Int | 0 |
| `totalSpeakers` | Int | 0 |
| `totalMessages` | Int | 0 |

```
@@unique([userId, date])
@@index([userId])
@@index([date])
```

---

## Supporting Models

| Model | Role in Voice Club |
|-------|-------------------|
| `User` | All participants |
| `GiftTransaction` | Gifts sent (`roomType='voice'`) |
| `RoomGiftLeaderboard` | Per-session gift totals |
| `PKMatch`, `PKParticipant` | PK battle system |
| `Notification` | VOICE_ROOM_LIVE type |
| `Post` | LIVE_ROOM_SHARE feed card |
| `DailyUserStats` | voiceMinutes tracking |

---

## Capacity Model by Room Level

`roomLevel` controls the maximum permanent members and audience capacity:

| Level | Max audience capacity | Max permanent members |
|-------|----------------------|----------------------|
| 1 | 500 | 500 |
| 2 | 1,000 | 1,000 |
| 3 | 2,000 | 2,000 |
| 4 | 3,500 | 3,500 |
| 5 | 5,000 | 5,000 |
| 6 | 8,000 | 8,000 |
| 7 | 12,000 | 12,000 |
| 8 | 18,000 | 18,000 |
| 9 | 25,000 | 25,000 |
| 10 | 50,000 | 50,000 |
