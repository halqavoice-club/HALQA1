# Voice Club — Realtime (Socket.IO + LiveKit)

**Source:** `backend/src/app.js`, `backend/src/controllers/voice*.controller.js`, `frontend/src/hooks/useLiveKit.ts`, `frontend/src/hooks/useVoiceRoom.ts`  
**Audit date:** 2026-08-26

---

## Socket.IO Room: `voice:{roomId}`

**Authorization:** `app.js` handler verifies active `VoiceParticipant.isActive` in DB before allowing join.

```javascript
socket.on('voice:join_room', async (roomId) => {
  if (!socketAllow('voice:join_room')) return; // 5 per 10s rate limit
  const participant = await prisma.voiceParticipant.findUnique({
    where: { roomId_userId: { roomId: id, userId } },
    select: { isActive: true },
  });
  if (!participant?.isActive) return; // silently refuse
  socket.join(`voice:${id}`);
});
```

Rate limit: 5 joins per 10 seconds per socket (prevents reconnect-loop attacks).

---

## Complete Server → Room Event Catalog

### Room Lifecycle

| Event | Target | Payload | Emitter |
|-------|--------|---------|---------|
| `voice:room_created` | `voice:lobby` + `school:{schoolId}` | full room object | `createRoom` |
| `voice:room_updated` | `voice:{roomId}` + `voice:lobby` + `school:{schoolId}` | partial room fields | `updateRoom`, `endRoom` |
| `voice:room_deleted` | `voice:lobby` + `school:{schoolId}` | `{ roomId }` | `deleteRoom`, `endRoom` |
| `voice:room_ended` | `voice:{roomId}` | `{ roomId }` | `endRoom`, `deleteRoom` |
| `voice:status_changed` | `voice:{roomId}` | `{ roomId, status }` | `syncRoomStatus` (IDLE→LIVE) |

### Participant Lifecycle

| Event | Target | Payload | Emitter |
|-------|--------|---------|---------|
| `voice:user_joined` | `voice:{roomId}` | `{ roomId, userId, firstName, lastName, avatarUrl, role }` | `joinRoom` |
| `voice:user_left` | `voice:{roomId}` | `{ roomId, userId }` | `leaveRoom` |
| `voice:kicked` | `voice:{roomId}` + `user:{kicked}` | `{ roomId, userId }` / `{ roomId }` | `kickParticipant` |
| `voice:banned` | `voice:{roomId}` + `user:{banned}` | `{ roomId, userId }` / `{ roomId, reason }` | `banParticipant` |
| `voice:member_joined` | `voice:{roomId}` | `{ roomId, userId, memberCount, maxMembers, ... }` | `joinRoom` |

### Role Events

| Event | Target | Payload | Emitter |
|-------|--------|---------|---------|
| `voice:role_changed` | `voice:{roomId}` | `{ roomId, userId, role }` | multiple controllers |
| `voice:your_role_changed` | `user:{userId}` | `{ roomId, role }` | `promoteParticipant` |
| `voice:you_are_moderator` | `user:{userId}` | `{ roomId, message }` | `assignModerator` |
| `voice:moderator_assigned` | `voice:{roomId}` | `{ roomId, userId, firstName, lastName, avatarUrl }` | `assignModerator` |
| `voice:moderator_removed` | `voice:{roomId}` + `user:{userId}` | `{ roomId, userId }` | `removeModerator` |
| `voice:admin_transferred` | `voice:{roomId}` | `{ roomId, newHostId, prevHostId, newHostName }` | `transferAdmin` |
| `voice:you_are_host` | `user:{userId}` | `{ roomId, message }` | `transferAdmin` |
| `voice:promoted_to_speaker` | `user:{userId}` | `{ roomId, message }` | `approveUser/approveNext` |

### Audio / Mic State

| Event | Target | Payload | Emitter |
|-------|--------|---------|---------|
| `voice:mute_changed` | `voice:{roomId}` | `{ roomId, userId, isMuted }` | `toggleMute`, `muteAll`, `unmuteAll`, `voice-roles` |
| `voice:mic_lock_changed` | `voice:{roomId}` | `{ roomId, micLocked, changedBy }` | `toggleMicLock` |
| `voice:open_mic_changed` | `voice:{roomId}` | `{ roomId, isOpenMic, changedBy }` | `toggleOpenMic` |
| `voice:mic_grabbed` | `voice:{roomId}` | `{ roomId, userId, firstName, lastName }` | `grabMic` |
| `voice:seat_lock_changed` | `voice:{roomId}` | `{ roomId, seatIndex, ... }` | `toggleSeatLock` |
| `voice:speaker_pinned` | `voice:{roomId}` | `{ roomId, userId, isPinned, pinnedBy }` | `pinSpeaker` |

### Speaker Queue

| Event | Target | Payload | Emitter |
|-------|--------|---------|---------|
| `voice:hand_raised` | `voice:{roomId}` | `{ roomId, userId, raised, firstName, lastName }` | `voice-queue.controller` |
| `voice:queue_position` | `user:{userId}` | `{ roomId, position }` | queue controller |
| `voice:queue_updated` | `voice:{roomId}` | `{ roomId, queue, queueLength }` | queue controller |
| `voice:queue_rejected` | `user:{userId}` | `{ roomId, message }` | `rejectUser` |

### Mic Pass

| Event | Target | Payload | Emitter |
|-------|--------|---------|---------|
| `voice:mic_offer` | `user:{targetUserId}` | `{ offerId, roomId, ... }` | `sendMicOffer` |
| `voice:mic_passed` | `voice:{roomId}` | `{ roomId, passerId, ... }` | `acceptMicOffer` |
| `voice:mic_received` | `user:{acceptorId}` | `{ roomId, message }` | `acceptMicOffer` |
| `voice:mic_declined` | `user:{passerId}` | `{ roomId, targetId }` | `declineMicOffer` |
| `voice:mic_offer_cancelled` | `user:{targetId}` | `{ roomId, offerId }` | `cancelMicOffer` |

### Chat and Reactions

| Event | Target | Payload | Emitter |
|-------|--------|---------|---------|
| `voice:message` | `voice:{roomId}` | `{ roomId, message }` | `sendMessage` |
| `voice:message_deleted` | `voice:{roomId}` | `{ roomId, msgId, deletedBy }` | `deleteMessage` |
| `voice:reaction` | `voice:{roomId}` | `{ userId, emoji }` | `app.js` relay |

### Gift Events

| Event | Target | Payload | Emitter |
|-------|--------|---------|---------|
| `gift:sent` | `voice:{roomId}` | full gift payload | `gift.controller.js` |
| `voice:gift_sent` | `voice:{roomId}` | same payload (compat alias) | `gift.controller.js` |
| `voice:gift_all` | `voice:{roomId}` | same payload | `gift.controller.js: sendGiftToAll` |
| `voice:premium_gift` | `voice:{roomId}` | same payload | `gift.controller.js` (premium only) |
| `gift:received` | `user:{receiverId}` | gift + balance info | `gift.controller.js` |

---

## Client → Server Events (Relayed by `app.js`)

| Event | Rate limit | Check | Relay |
|-------|-----------|-------|-------|
| `voice:join_room` | 5 per 10s | DB: active `VoiceParticipant` | Joins `voice:{roomId}` socket room |
| `voice:leave_room` | 10 per 5s | None | Leaves socket room |
| `voice:speaking` | 30 per 5s | Socket room membership | Relays `{ userId, speaking }` to room |
| `voice:reaction` | 10 per 2s | Checks `reactionsEnabled` from Redis cache | Relays `{ userId, emoji }` to room |

**Identity:** `socket.userId` from JWT is always used. Client-supplied `userId` in payload is ignored.

---

## LiveKit Integration

### Token Endpoint

`POST /api/v1/voice/:id/livekit-token`

**Authorization:** Active `VoiceParticipant.isActive` required. Room must not be ENDED.

**Grants (all participants):**
```javascript
{
  roomJoin:             true,
  room:                 roomId,   // voice room UUID directly
  canPublish:           true,     // all participants — mic control is app-level
  canSubscribe:         true,
  canPublishData:       true,
  canUpdateOwnMetadata: true
}
```

**Token TTL:** `1h`

**`micEnabled` field in response:**
```javascript
const micEnabled = role === 'HOST' || role === 'MODERATOR' || role === 'SPEAKER';
// AUDIENCE: false — mic disabled by default
```
This is advisory metadata for the frontend. Not a LiveKit SFU grant.

### Why `canPublish: true` for All Participants

Same reason as live classes — changing `canPublish` requires a WebRTC reconnect (1–2s). Instead, mic state is controlled via `room.localParticipant.setMicrophoneEnabled()` called by the frontend when `voice:role_changed` arrives via Socket.IO.

### Active Speakers → Socket.IO

The `useLiveKit` hook (`frontend/src/hooks/useLiveKit.ts`) listens to LiveKit's `RoomEvent.ActiveSpeakersChanged`:

```typescript
room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
  const socket = getSocket()
  if (socket) {
    socket.emit('voice:speaking', { roomId, speaking: newIds.has(room.localParticipant.identity) })
  }
  speakers.forEach((s) => setSpeaking(s.identity, true))
})
```

The local LiveKit SDK detects who is speaking and emits `voice:speaking` to the server, which relays to the room.

### Token Refresh (Proactive)

At 55 minutes (5 min before 1h TTL expiry), `useLiveKit` disconnects and reconnects with a fresh token:

```typescript
const tokenRefreshTimer = setTimeout(() => {
  r.disconnect() // triggers Disconnected → connect() with new token
}, 55 * 60 * 1000)
```

If the user has been kicked between token issuance and refresh, the new token request returns 403.

### Reconnect Policy

```typescript
reconnectPolicy: {
  nextRetryDelayInMs: (context) => {
    if (context.retryCount >= 5) return null   // stop after 5 attempts
    return Math.min((context.retryCount + 1) * 2000, 10_000)  // 2s, 4s, 6s, 8s, 10s
  }
}
```

No reconnect on: `CLIENT_INITIATED`, `ROOM_DELETED`, `PARTICIPANT_REMOVED` (kicked).

---

## Speaker Queue (FIFO — Redis-backed)

The speaker queue is stored in Redis for fast FIFO operations, with DB fallback when Redis is unavailable.

**Redis key:** `voice:queue:{roomId}` (sorted set by timestamp)

| Operation | Redis | DB fallback |
|-----------|-------|-------------|
| Enqueue | `zadd voice:queue:{roomId} {timestamp} {userId}` | `VoiceParticipant.handRaised = true` |
| Pop next | `zpopmin voice:queue:{roomId}` | First `handRaised=true` by `handRaisedAt` |
| Get queue | `zrange voice:queue:{roomId} 0 -1 withscores` | Count `handRaised=true` participants |
| Get position | `zrank voice:queue:{roomId} {userId}` | 1 if handRaised, else 0 |

**Auto-promote (`autoPromoteNext`):** Called on `leaveRoom()` and `dropMic()` to automatically promote the next person in queue when a speaker slot opens.

```javascript
// autoPromote.js
async function autoPromoteNext(roomId, io) {
  const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
  if (!room || room.micLocked || room.status === 'ENDED') return;
  
  const speakerCount = await countSpeakers(roomId);
  if (speakerCount >= (room.maxSpeakers || 10)) return; // stage full
  
  // Pop next from queue and promote
  const nextUserId = await queue.popNext(roomId);
  if (nextUserId) {
    await prisma.voiceParticipant.update({ data: { role: 'SPEAKER', isMuted: false } });
    // Emit: voice:role_changed, voice:promoted_to_speaker → user
  }
}
```

---

## Feed Integration

When a voice room goes LIVE, `broadcastLiveStart()` is called (via `syncRoomStatus` IDLE→LIVE transition):

```javascript
broadcastLiveStart({
  refEntityType: 'voice_room',
  refEntityId:   roomId,
  authorId:      room.hostId,
  title:         room.title,
  description:   room.description,
  coverEmoji:    room.coverEmoji,
  coverImageUrl: room.coverImageUrl,
  schoolId:      null,   // always null — rooms are global
  participantCount: activeCount,
})
```

This creates a `LIVE_ROOM_SHARE` post in the feed and emits `feed:live` to `feed:public`.
