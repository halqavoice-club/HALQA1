# LiveKit Architecture — Complete Reference

**Audit date:** 2026-08-26  
**Source:** `backend/src/controllers/livekit.controller.js`, `frontend/src/hooks/useLiveKit.ts`, `frontend/src/components/live-class/LiveClassRoomImpl.tsx`, `mobile/src/hooks/useLiveKitAudio.ts`  
**Rule:** Read-only audit. No code modified.

---

## Overview

LiveKit is used as the SFU (Selective Forwarding Unit) for audio/video.

| System | LiveKit room name pattern | Token endpoint |
|--------|--------------------------|----------------|
| Voice Club | `{voiceRoomId}` (UUID) | `POST /voice/:id/livekit-token` |
| Live Class | `liveclass-{liveClassId}` | `POST /live-classes/:id/token` or `/live-classes/:id/livekit-token` |
| Generic | arbitrary | `POST /livekit/token` (with restrictions) |

---

## Token Generation

### Voice Room Token (`getLiveKitToken` — livekit.controller.js)

**Endpoint:** `POST /api/v1/voice/:id/livekit-token`  
**Authorization layers:**
1. `authenticate` — valid JWT required
2. Active `voiceParticipant` record (`isActive: true`) required
3. Room must not be ENDED

**Grant issued (ALL participants — identical regardless of role):**
```javascript
{
  roomJoin:             true,
  room:                 roomId,          // voice room UUID
  canPublish:           true,            // all participants
  canSubscribe:         true,
  canPublishData:       true,
  canUpdateOwnMetadata: true
}
```

**Token TTL:** `1h`  
**Identity:** `userId` (from JWT)  
**Display name:** `${firstName} ${lastName}`

**`micEnabled` field in response** (advisory — not a LiveKit grant):
```javascript
const micEnabled = role === 'HOST' || role === 'MODERATOR' || role === 'SPEAKER';
// AUDIENCE: micEnabled = false (mic disabled by default, enabled when promoted)
```

The frontend uses `micEnabled` to call `room.localParticipant.setMicrophoneEnabled(micEnabled)` after connecting. This is a client-side mic control — the LiveKit SFU always grants `canPublish: true`.

---

### Live Class Token (`getLiveKitToken` — live-class.controller.js)

**Endpoint:** `POST /api/v1/live-classes/:id/token` (or `/livekit-token`)  
**Authorization layers:**
1. `authenticate`
2. `resolveStreamAccess` — SCHOOL: school membership required; PUBLIC: any authenticated user
3. Active `liveClassParticipant` record (`isActive: true`) required
4. Class must not be ENDED or CANCELLED

**Grant issued (ALL participants — identical regardless of role):**
```javascript
{
  roomJoin:             true,
  room:                 lc.livekitRoomName,   // "liveclass-{uuid}"
  canPublish:           true,                 // ALL participants always
  canSubscribe:         true,
  canPublishData:       true,
  canUpdateOwnMetadata: true,
}
```

**Screen share restriction (SFU-level enforcement — GAP-03 fix):**
When `lc.screenShareEnabled === false` AND participant role is not `HOST`:
```javascript
grantOptions.canPublishSources = ['camera', 'microphone'];
// 'screen_share' and 'screen_share_audio' are EXCLUDED at SFU level
```
This is enforced by the LiveKit SFU itself — the client cannot override it.

**Token TTL:** `1h`

---

### Generic Token (`generateToken` — livekit.controller.js)

**Endpoint:** `POST /api/v1/livekit/token`  
**Authorization layers:**
1. `authenticate`
2. If `roomId` starts with `liveclass-`: school isolation check + active `liveClassParticipant` required
3. If `roomId` exists in `voice_rooms` table: active `voiceParticipant` required

**SUPER_ADMIN note:** The school isolation check in the generic endpoint has `if (req.user.role !== 'SUPER_ADMIN')` — SUPER_ADMIN bypasses the school check but is still blocked by the participant record check. See `known-gaps.md` LTSV-001.

**Grant issued:**
```javascript
{
  roomJoin:             true,
  room:                 roomId,
  canPublish:           Boolean(canPublish),   // caller-controlled via request body
  canSubscribe:         Boolean(canSubscribe),
  canPublishData:       Boolean(canPublish),
  canUpdateOwnMetadata: true
}
```

**Token TTL:** `1h`

---

## Why `canPublish: true` for All Participants

All voice and live class participants receive `canPublish: true` in their LiveKit token, regardless of their role (HOST, STUDENT, AUDIENCE). This is intentional:

**Reason:** If `canPublish: false` were used to mute a user, changing their role (AUDIENCE → SPEAKER) would require issuing a new token, which forces a WebRTC reconnect. A reconnect takes 1–2 seconds and causes an audible gap.

**Instead:**
- Token always has `canPublish: true`
- Mic state is controlled by `room.localParticipant.setMicrophoneEnabled(false/true)` on the client
- Role changes arrive via Socket.IO (`voice:role_changed`, `liveclass:you_can_speak`)
- Frontend enables/disables the mic track immediately without reconnect

**The LiveKit SFU does not enforce mute state.** If a malicious client were to call `setMicrophoneEnabled(true)` despite being AUDIENCE, the SFU would accept it. The HALQA application relies on:
1. Frontend correctly respecting `micEnabled` from the token response
2. Frontend correctly responding to `voice:role_changed` / `liveclass:you_can_speak` socket events
3. There is no server-side SFU enforcement of mic mute state except for screen share (GAP-03 fix)

---

## Frontend LiveKit Hook — Voice Club (`useLiveKit.ts`)

**File:** `frontend/src/hooks/useLiveKit.ts`  
**Scope:** Voice Club ONLY (`VoiceRoomView.tsx`)

### Connection Flow
```
useLiveKit(roomId) called
  └─ connect()
     └─ POST /voice/:id/livekit-token
        └─ token + livekitUrl + micEnabled
     └─ new Room({ adaptiveStream: false, dynacast: true, ... })
     └─ Register event handlers (see below)
     └─ room.connect(livekitUrl, token)
     └─ Attach existing remote audio tracks
     └─ room.localParticipant.setMicrophoneEnabled(micEnabled)
```

### LiveKit Room Events Handled

| LiveKit Event | Handler |
|-------------|---------|
| `RoomEvent.ConnectionStateChanged` | Updates `connectionState` state |
| `RoomEvent.Disconnected` | Cleans up audio, triggers reconnect (if not user-initiated) |
| `RoomEvent.Reconnecting` | Updates state to Reconnecting |
| `RoomEvent.Reconnected` | Resets attempts, re-attaches audio tracks |
| `RoomEvent.TrackSubscribed` | Calls `attachAudio(identity, track)` for audio tracks |
| `RoomEvent.TrackUnsubscribed` | Calls `detachAudio(identity)` |
| `RoomEvent.TrackMuted` | Updates `isMicEnabled` for local participant |
| `RoomEvent.TrackUnmuted` | Updates `isMicEnabled` for local participant |
| `RoomEvent.LocalTrackPublished` | Updates `isMicEnabled` |
| `RoomEvent.LocalTrackUnpublished` | Sets `isMicEnabled = false` |
| `RoomEvent.ParticipantDisconnected` | Detaches audio, clears speaking state |
| `RoomEvent.ActiveSpeakersChanged` | Updates `activeSpeakers` set + emits `voice:speaking` to Socket.IO |

### Audio Element Management

Remote audio tracks are attached via `track.attach()` creating `<audio>` elements appended to `document.body`. Elements are positioned off-screen (not `display:none`) to prevent browsers and LiveKit's `adaptiveStream` from pausing them.

### Reconnect Policy
- Max 5 reconnect attempts
- Exponential backoff: 1.5s → 3s → 6s → 12s → 24s
- No reconnect for: `CLIENT_INITIATED`, `ROOM_DELETED`, `PARTICIPANT_REMOVED`
- Token refresh: proactive reconnect at 55 minutes (5 min before 1h TTL expiry)

### Room Configuration
```javascript
new Room({
  adaptiveStream:  false,   // prevents silencing off-screen audio elements
  dynacast:        true,    // don't publish when no subscribers
  reconnectPolicy: { nextRetryDelayInMs: (ctx) => ctx.retryCount >= 5 ? null : (ctx.retryCount + 1) * 2000 },
  audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  publishDefaults: { dtx: true, red: true, audioPreset: { maxBitrate: 96_000 } }
})
```

### Mic Control API
```typescript
connect()     // fetches fresh token, creates Room, connects
disconnect()  // user-initiated: no reconnect
toggleMic()   // user mute button
enableMic()   // called by useVoiceRoom on Socket.IO voice:role_changed → SPEAKER
disableMic()  // called by useVoiceRoom on Socket.IO voice:role_changed → AUDIENCE
```

`enableMic()`/`disableMic()` never reconnect — they only call `setMicrophoneEnabled()`.

---

## Frontend LiveKit — Live Class (`LiveClassRoomImpl.tsx`)

**File:** `frontend/src/components/live-class/LiveClassRoomImpl.tsx`  
**Scope:** Live Class ONLY — separate implementation from Voice Club

The live class does NOT use `useLiveKit`. It manages the LiveKit `Room` instance inline via a `connectLiveKitRef` callback.

### Key Differences from Voice Club

| Aspect | Voice Club | Live Class |
|--------|-----------|-----------|
| Hook | `useLiveKit(roomId)` | Inline `connectLiveKit()` function |
| Socket event name | `voice:speaking` | `liveclass:speaking` |
| Token endpoint | `/voice/:id/livekit-token` | `/live-classes/:id/token` |
| Role derivation | From token response `role` | From `participant.role` in DB |
| Screen share | Not implemented | Yes (SFU-level restriction) |
| Video tracks | Audio-only | Camera + microphone + optional screen share |

### Live Class LiveKit Token: What Gets `canPublish`

Live class token grants `canPublish: true` to ALL participants. Camera/mic publication is managed by the frontend. Screen share may be restricted at SFU level (`canPublishSources` omits screen_share when `screenShareEnabled = false` and role ≠ HOST).

### `liveclass:you_can_speak` Handling

When a student's hand raise is approved:
```typescript
const onCanSpeak = () => {
  toast({ title: '🎙 You can speak now!' })
  const room = roomRef.current
  if (room?.state === ConnectionState.Connected) {
    room.localParticipant.setMicrophoneEnabled(true)  // no reconnect
    setMicOn(true)
  } else {
    connectLiveKitRef.current?.()  // connect and start with mic enabled
  }
}
```

---

## SUPER_ADMIN and LiveKit — Definitive Status

| Scenario | Can get token | Enforcement |
|----------|--------------|-------------|
| Voice room (own room as HOST) | ✅ Yes — if active participant | VoiceParticipant record required |
| Voice room (other's room as AUDIENCE) | ✅ Yes — if joined and active | VoiceParticipant record required |
| School live class | ❌ No | `resolveStreamAccess` requires school membership |
| PUBLIC live class | ✅ Yes — if joined (any auth user can join) | LiveClassParticipant record required |
| Generic endpoint for liveclass-* room | ❌ School check bypassed BUT participant check still blocks | LTSV-001 |
| Generic endpoint for voice room | ✅ Yes — if active participant | VoiceParticipant record required |

**The LiveKit SFU never knows or cares about SUPER_ADMIN.** The LiveKit identity field is `userId`. The SFU sees only what the token grants allow. Platform admin privilege cannot be exercised inside a LiveKit room — the only way in is to have a valid DB participant record.

---

## LiveKit SFU Enforcement vs Application Enforcement

| Restriction | Enforced by | How |
|------------|------------|-----|
| Can join room | LiveKit SFU | `roomJoin: true` in token |
| Can publish any track | LiveKit SFU | `canPublish: true` in token (always true) |
| Can subscribe to tracks | LiveKit SFU | `canSubscribe: true` in token (always true) |
| Screen share allowed | **LiveKit SFU** (GAP-03 fix) | `canPublishSources` excludes `screen_share` when restricted |
| Mic mute state | **Application only** | `setMicrophoneEnabled()` on client; no SFU enforcement |
| Kick from SFU room | **Application** | `RoomServiceClient.removeParticipant()` called after DB kick |
| Token expiry | LiveKit SFU | 1h TTL |
| Participant identity | LiveKit SFU | `identity` field in token = `userId` |
