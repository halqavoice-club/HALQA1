# Live Stream — Realtime (Socket.IO, LiveKit, Feed)

**Audit date:** 2026-08-26

---

## Socket.IO Events

Public live streams emit and receive **the same `liveclass:*` socket events** as school live classes. See [docs/live-class/realtime.md](../live-class/realtime.md) for the full event catalog.

**Key differences for PUBLIC streams:**

| Event | School target | PUBLIC target |
|-------|-------------|--------------|
| `liveclass:scheduled` | `school:{schoolId}` | `feed:public` |
| `liveclass:started` | `school:{schoolId}` + `class:{classId}` | `feed:public` |

All other `liveclass:*` events target `liveclass:{id}` regardless of stream type.

---

## Feed Real-Time Integration

The `feedLive.js` module provides the bridge between the live stream system and the social feed.

### `broadcastLiveStart(opts)`

Called when a PUBLIC stream starts. Fire-and-forget.

```javascript
// Called from startLiveClass() and joinLiveClass() auto-start
broadcastLiveStart({
  refEntityType: 'live_class',
  refEntityId:   lc.id,
  authorId:      req.user.id,
  title:         lc.title,
  description:   lc.description,
  schoolId:      null,            // null → PUBLIC visibility
  participantCount: 0,
})
```

**Effect:**
1. Upserts a `Post` with `type = 'LIVE_CLASS_SHARE'`, `visibility = 'PUBLIC'` in the database (idempotent)
2. Emits `feed:live` to `feed:public` Socket.IO room with a `liveCard` payload
3. If `schoolId` is set (school streams), also emits to `feed:school:{schoolId}`

### `broadcastLiveEnd(refEntityType, refEntityId)`

Called when a PUBLIC stream ends.

**Effect:**
1. Finds the `LIVE_CLASS_SHARE` post in DB
2. Emits `feed:live_ended` to `feed:public` — clients update the card to "ended" state
3. Does NOT delete the post (remains as a record of the session)

### `broadcastLiveUpdate(refEntityType, refEntityId, participantCount)`

Called to update participant count on an active feed card. Socket-only, no DB write.

---

## Feed Socket Events

| Event | Direction | Room | Payload |
|-------|-----------|------|---------|
| `feed:live` | S→room | `feed:public` | Full `liveCard` object with `liveData.isLive=true` |
| `feed:live_ended` | S→room | `feed:public` | `{ refEntityType, refEntityId, postId }` |
| `feed:live_update` | S→room | `feed:public` | `{ refEntityType, refEntityId, participantCount }` |

**Frontend listener** (`frontend/src/components/feed/LiveSection.tsx`):
```typescript
socket.on('feed:live',        onLive)        // add/update live card in feed
socket.on('feed:live_ended',  onLiveEnded)   // mark card as ended
socket.on('feed:live_update', onLiveUpdate)  // update participant count
```

---

## LiveKit

Live Streams use the exact same LiveKit token flow as school live classes. See [docs/live-class/realtime.md](../live-class/realtime.md) and [docs/authorization/livekit-architecture.md](../authorization/livekit-architecture.md).

**Key points specific to PUBLIC streams:**
- Token endpoint: `POST /live-classes/:id/token`
- Room name: `liveclass-{id}`
- All participants (HOST and STUDENT) get `canPublish: true`
- Screen share: SFU-restricted when `screenShareEnabled = false`
- Token TTL: `1h`
- Kicked participants are removed from SFU via `RoomServiceClient.removeParticipant()`

---

## Feed Card Post (DB)

When `broadcastLiveStart()` runs, it upserts a `Post` record:

| Field | Value |
|-------|-------|
| `type` | `'LIVE_CLASS_SHARE'` |
| `visibility` | `'PUBLIC'` (no schoolId) |
| `authorId` | stream creator's userId |
| `refEntityType` | `'live_class'` |
| `refEntityId` | `liveClass.id` |
| `body` | stream title (+ description if present) |
| `isDraft` | `false` |

This post appears in the public feed. Viewers who load the feed after the stream started will see the card from the DB. Real-time viewers see it via the `feed:live` socket event.
