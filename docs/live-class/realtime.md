# Live Class — Realtime (Socket.IO + LiveKit)

**Source:** `backend/src/app.js`, `backend/src/controllers/live-class.controller.js`, `frontend/src/components/live-class/LiveClassRoomImpl.tsx`, `mobile/app/live-class/[id].tsx`  
**Audit date:** 2026-08-26

---

## Socket.IO — Complete Event Reference

### Room: `liveclass:{id}`

Joined via `socket.emit('liveclass:join_room', liveClassId)`.

**Authorization:** `app.js` handler verifies active `LiveClassParticipant` record in DB before allowing join.

```javascript
socket.on('liveclass:join_room', async (liveClassId) => {
  const participant = await prisma.liveClassParticipant.findFirst({
    where: { liveClassId, userId, isActive: true }
  });
  if (!participant) return; // silently refuse
  socket.join(`liveclass:${liveClassId}`);
});
```

---

### Server → Room Events (S → `liveclass:{id}`)

| Event | Payload | Emitter |
|-------|---------|---------|
| `liveclass:started` | `{ liveClassId, title, classId? }` | `startLiveClass`, `joinLiveClass` (auto-start) |
| `liveclass:ended` | `{ liveClassId }` | `endLiveClass`, auto-end cron |
| `liveclass:updated` | `{ liveClass }` | `updateLiveClass` |
| `liveclass:user_joined` | `{ liveClassId, userId, role, user }` | `joinLiveClass` |
| `liveclass:user_left` | `{ liveClassId, userId }` | `leaveLiveClass` |
| `liveclass:kicked` | `{ liveClassId, userId }` | `kickParticipant` |
| `liveclass:mute_changed` | `{ liveClassId, userId, isMuted }` | `muteParticipant` |
| `liveclass:mute_all` | `{ liveClassId }` | `muteAll` |
| `liveclass:unmute_all` | `{ liveClassId }` | `unmuteAll` |
| `liveclass:hand_raised` | `{ liveClassId, userId, firstName, lastName }` | `raiseHand` |
| `liveclass:hand_lowered` | `{ liveClassId, userId }` | `lowerHand` |
| `liveclass:all_hands_lowered` | `{ liveClassId }` | `lowerAllHands` |
| `liveclass:hand_approved` | `{ liveClassId, userId }` | `approveHand` |
| `liveclass:hand_rejected` | `{ liveClassId, userId }` | `rejectHand` |
| `liveclass:message` | message object | `sendMessage` |
| `liveclass:message_deleted` | `{ messageId }` | `deleteMessage` |
| `liveclass:open_mic_changed` | `{ liveClassId, isOpenMic }` | `toggleOpenMic` |
| `liveclass:recording_started` | `{ liveClassId }` | `startRecording` |
| `liveclass:recording_stopped` | `{ liveClassId, recordingUrl }` | `stopRecording` |
| `liveclass:speak_request` | `{ liveClassId, userId, firstName, lastName }` | `requestSpeak` |
| `liveclass:whiteboard` / `liveclass:draw` | whiteboard event | `broadcastDraw` |
| `liveclass:poll` | poll event | `broadcastPoll` |
| `liveclass:quran_position` | `{ surahNumber, ayahNumber }` | `broadcastQuranPosition` |
| `liveclass:gift_sent` | gift payload | `gift.controller.js` |
| `gift:sent` | gift payload (universal) | `gift.controller.js` |

### Server → Room events for School/Feed rooms

| Event | Target room | Payload |
|-------|-------------|---------|
| `liveclass:scheduled` | `school:{schoolId}` or `feed:public` | `{ liveClass }` |
| `liveclass:started` | `school:{schoolId}` + `class:{classId}` + `feed:public` | `{ liveClassId, title }` |

### Server → User Events (S → `user:{userId}`)

| Event | When |
|-------|------|
| `liveclass:you_were_kicked` | Participant kicked by HOST |
| `liveclass:you_can_speak` | Hand raise approved by HOST |

---

### Client → Server Events (C → S, relayed by `app.js`)

All client events use `socket.userId` (from JWT) — never the client-supplied `userId` in the payload.

| Event | Rate limit | Auth check | Relay |
|-------|-----------|-----------|-------|
| `liveclass:join_room` | — | DB: active participant required | Joins socket room |
| `liveclass:leave_room` | — | None | Leaves socket room |
| `liveclass:speaking` | 30/5s | Socket room membership | Relays `{ userId, speaking }` to room |
| `liveclass:video_changed` | 15/5s | Socket room membership | Relays `{ userId, isVideoOn }` to room |
| `liveclass:reaction` | 10/2s | Socket room membership | Relays `{ userId, emoji, targetUserId }` — strips display names |
| `liveclass:viewmode_changed` | — | DB: HOST role re-read | Relays to room only if HOST |
| `liveclass:screen_share_started` | 5/10s | DB: participant + screenShareEnabled | Relays to room |
| `liveclass:screen_share_stopped` | 5/10s | DB: active participant | Relays to room |

---

### Security Notes on Socket Events

**P0-02 / P0-03:** `liveclass:speaking` and `liveclass:video_changed` use `socket.userId` from the JWT. Client-supplied `userId` in the payload is ignored. This prevents identity spoofing.

**P0-04:** `liveclass:join_room` verifies `LiveClassParticipant.isActive` in the DB. A kicked user (isActive=false) cannot rejoin the socket room.

**P1-02:** `liveclass:viewmode_changed` re-reads `LiveClassParticipant WHERE role='HOST'` from DB. Client cannot spoof `role=HOST` or `isHost=true` in the payload.

**GAP-02:** `liveclass:screen_share_started` verifies HOST role OR `screenShareEnabled=true` for the class before relaying.

---

## LiveKit Integration

### Token Endpoint

`POST /api/v1/live-classes/:id/token` (or `/:id/livekit-token`)

**Authorization chain:**
1. `authenticate` — valid JWT
2. `resolveStreamAccess` — school membership (SCHOOL) or any auth (PUBLIC)
3. Controller checks active `LiveClassParticipant` record
4. Class must not be ENDED or CANCELLED

**Token grants (ALL participants get identical grants):**
```javascript
{
  roomJoin:             true,
  room:                 lc.livekitRoomName,    // "liveclass-{uuid}"
  canPublish:           true,                   // ALL participants always
  canSubscribe:         true,
  canPublishData:       true,
  canUpdateOwnMetadata: true,
}
```

**Screen share restriction (SFU-level — GAP-03 fix):**
When `lc.screenShareEnabled === false` AND participant role is NOT HOST:
```javascript
grantOptions.canPublishSources = ['camera', 'microphone'];
// 'screen_share' and 'screen_share_audio' excluded at SFU level
```

**Token TTL:** `1h`  
**Identity:** `userId` (from JWT)  
**Display name:** `${firstName} ${lastName}`

**Response:**
```json
{
  "token": "...",
  "livekitUrl": "wss://...",
  "roomName": "liveclass-{uuid}",
  "role": "HOST|STUDENT"
}
```

---

### Why `canPublish: true` for All Participants

All participants receive `canPublish: true`. Mic/camera state is NOT enforced at the LiveKit SFU level (except screen share). Instead:

- Initial mute state: `isMuted = !(isHost || isOpenMic)`
- State changes: `liveclass:mute_changed` socket event → frontend calls `room.localParticipant.setMicrophoneEnabled()`
- Approval: `liveclass:you_can_speak` → `setMicrophoneEnabled(true)` (no reconnect needed)

**Rationale:** Changing `canPublish` via token requires a WebRTC reconnect (1–2s gap). Using frontend-controlled mic avoids this lag.

---

### LiveKit in Frontend (Web)

The web live class does NOT use the `useLiveKit` hook (that is voice-club only). It manages a `Room` instance inline in `LiveClassRoomImpl.tsx` via a `connectLiveKitRef` callback.

**Connection flow:**
```typescript
const connectLiveKit = async () => {
  const { data } = await api.post(`/live-classes/${id}/token`)
  const { token, livekitUrl, role } = data.data
  
  const room = new Room({ adaptiveStream: false, ... })
  await room.connect(livekitUrl, token)
  
  await room.localParticipant.setMicrophoneEnabled(!isMuted)
  // isMuted from participant record in join response
}
```

`liveclass:you_can_speak` socket event:
```typescript
const onCanSpeak = () => {
  if (room?.state === ConnectionState.Connected) {
    room.localParticipant.setMicrophoneEnabled(true) // no reconnect
  } else {
    connectLiveKitRef.current?.() // connect if not yet connected
  }
}
```

---

### LiveKit in Mobile

File: `mobile/src/hooks/useLiveKitAudio.ts`

The mobile app uses `useLiveKitAudio` hook which uses `@livekit/react-native-webrtc` for native builds, with graceful degradation in Expo Go (no native audio module).

```typescript
// Mobile connects via:
const { token, livekitUrl } = await api.post(`/live-classes/${id}/join`)
// Token is included in the join response on mobile
```

Mobile socket events subscribed: same 20+ `liveclass:*` events as web. See `mobile/app/live-class/[id].tsx` for the complete list.

---

### LiveKit Kick — Server-Side SFU Eviction

When `kickParticipant()` is called:
1. DB: `LiveClassParticipant.isActive = false`, `wasKicked = true`
2. Socket: `liveclass:kicked` → room, `liveclass:you_were_kicked` → user
3. **LiveKit SFU:** `RoomServiceClient.removeParticipant(livekitRoomName, userId)`

The LiveKit call is best-effort — if the SFU is unreachable, the DB kick still succeeds. The kicked user cannot get a new token (participant check returns 403) and cannot rejoin the socket room.

**Post-kick token reuse window:** Up to 1h (the token TTL). The SFU eviction prevents immediate reconnection; the 1h cap limits persistent reuse.

---

## Reconnect Behavior

Web reconnect: if the LiveKit room disconnects unexpectedly, `connectLiveKitRef.current?.()` is called which fetches a fresh token. The token endpoint checks `isActive` — if the user has been kicked, reconnect fails with 403.

Mobile reconnect: similar pattern via `useLiveKitAudio`. Network reconnects automatically attempt token refresh.
