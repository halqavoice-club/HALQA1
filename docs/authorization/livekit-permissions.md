# LiveKit Permissions

How LiveKit tokens are issued, what grants they contain, and what the SFU enforces.

---

## Token Endpoints

| Endpoint | File | Used for |
|----------|------|---------|
| `POST /live-classes/:id/token` | `live-class.controller.js → getLiveKitToken` | Live class participants |
| `POST /live-classes/:id/livekit-token` | Same as above (alias) | Live class participants (alternate path) |
| `POST /voice/:id/livekit-token` | `livekit.controller.js → getLiveKitToken` | Voice room participants |
| `POST /livekit/token` | `livekit.controller.js → generateToken` | Generic/custom rooms |

---

## Live Class Token

### Prerequisites

```
1. User must be authenticated (authenticate middleware)
2. User must pass resolveStreamAccess:
   - PUBLIC stream → any authenticated user
   - SCHOOL stream → active school membership
3. User must have an active liveClassParticipant record (isActive: true)
4. Class must not be ENDED or CANCELLED
```

### Grants (ALL participants receive identical token grants)

```javascript
{
  roomJoin:             true,
  room:                 lc.livekitRoomName,   // "liveclass-{uuid}"
  canPublish:           true,                 // ALL participants
  canSubscribe:         true,
  canPublishData:       true,
  canUpdateOwnMetadata: true,
}
```

### Screen Share Restriction (GAP-03 fix — SFU-enforced)

When `lc.screenShareEnabled === false` AND the participant is NOT HOST:

```javascript
// canPublishSources restricts to camera + microphone only at SFU level
grantOptions.canPublishSources = ['camera', 'microphone'];
// 'screen_share' and 'screen_share_audio' are excluded
```

This is enforced by the LiveKit SFU itself — not just the UI. A non-host participant with `screenShareEnabled = false` cannot publish a screen share track regardless of client-side manipulation.

### Token TTL

`1h` (reduced from previous `8h` to limit post-kick token reuse window)

### Mic State

The `micEnabled` field in the response tells the frontend whether to start with mic ON:

```javascript
// This is NOT a LiveKit grant — it's advisory metadata for the frontend
const isHost = participant.role === 'HOST';
// ALL participants get canPublish: true; mic state controlled by socket events
```

The initial mute state is set from `participant.isMuted` in the DB:
- HOST/staff/isPublicHost → join unmuted
- Other participants → join muted (unless `lc.isOpenMic === true`)

---

## Voice Room Token

### Prerequisites

```
1. User must be authenticated
2. Room must not be ENDED or deleted
3. User must have an active voiceParticipant record (isActive: true)
```

### Grants (ALL participants receive identical token grants)

```javascript
{
  roomJoin:             true,
  room:                 roomId,   // voice room DB id (UUID)
  canPublish:           true,     // ALL participants
  canSubscribe:         true,
  canPublishData:       true,
  canUpdateOwnMetadata: true
}
```

No screen-share restriction for voice rooms — voice rooms are audio-only by design (the SFU's screen share tracks would be unused).

### Mic State (advisory, not SFU-enforced)

```javascript
const micEnabled = role === 'HOST' || role === 'MODERATOR' || role === 'SPEAKER';
// AUDIENCE members start with mic OFF (they cannot speak until promoted)
```

This tells the frontend to start with mic enabled or disabled. The frontend controls the actual `LocalAudioTrack.setMuted()` call. It is NOT enforced at the SFU level — canPublish is always true.

**Design rationale:** Using `canPublish: true` for all and frontend-enforced mute avoids LiveKit reconnects when a user's role changes (AUDIENCE → SPEAKER). A reconnect would take 1–2 seconds and cause audio gaps.

### Token TTL

`1h`

---

## Generic Token (`/livekit/token`)

### Additional Restrictions (Task 1 / P2-A hardening)

This endpoint applies extra checks based on the `roomId` pattern:

#### Live class rooms (`roomId` starts with `"liveclass-"`)

```
1. Extract liveClassId from roomId
2. Verify live class exists and is not ENDED/CANCELLED
3. School isolation check:
   - SUPER_ADMIN: bypassed (see LTSV-001 in known-gaps.md)
   - Others: must have active SchoolMembership or matching user.schoolId
4. Must have active liveClassParticipant record
```

#### Voice rooms (roomId exists in voice_rooms table)

```
1. Room must exist and not be deleted
2. Room must not be ENDED
3. Must have active voiceParticipant record
```

#### Other rooms

No extra checks — caller controls `canPublish` and `canSubscribe` via request body.

### Grants

```javascript
{
  roomJoin:             true,
  room:                 roomId,
  canPublish:           Boolean(canPublish),   // caller-controlled
  canSubscribe:         Boolean(canSubscribe), // caller-controlled
  canPublishData:       Boolean(canPublish),
  canUpdateOwnMetadata: true
}
```

### Token TTL

`1h`

---

## SUPER_ADMIN and LiveKit Tokens

| Scenario | Can get token | Reason |
|----------|--------------|--------|
| Joining a school live class token endpoint | ❌ | `resolveStreamAccess` requires school membership |
| Joining a PUBLIC live class token endpoint | ✅ (as any auth user) | PUBLIC → any authenticated user |
| Voice room token endpoint | ✅ if active participant | Same as anyone — needs VoiceParticipant record |
| Generic endpoint for a liveclass-* room | ❌ | School isolation check (note: SUPER_ADMIN has bypass here — LTSV-001) |
| Generic endpoint for a voice room | ✅ if active participant | Same as anyone |

⚠️ **LTSV-001:** In `generateToken` (generic endpoint), the school isolation check for live class rooms has `if (req.user.role !== 'SUPER_ADMIN')` — meaning SUPER_ADMIN bypasses the school isolation check. They would still be blocked by step 4 (must have active liveClassParticipant record), but the school check is bypassed. See [known-gaps.md](./known-gaps.md).

---

## What LiveKit Enforces vs What the Application Enforces

| Restriction | Enforced by |
|------------|-------------|
| Can join room | LiveKit token `roomJoin: true` |
| Can publish any track | LiveKit token `canPublish: true` (always true — no SFU enforcement for mic/camera) |
| Can screen share | **LiveKit SFU** when `canPublishSources` omits screen_share (GAP-03 fix) |
| Mic mute state | **Frontend only** — based on `isMuted` DB field and socket events |
| Role assignment (HOST/STUDENT/SPEAKER) | **Application** — database, not LiveKit |
| Kick from room | **Application** — sets `isActive: false` in DB + LiveKit RoomService API to remove participant |
| Token expiry | **LiveKit SFU** — 1h TTL |

The application deliberately does NOT use LiveKit `canPublish: false` for muting because toggling it requires generating a new token and reconnecting the WebRTC peer connection (~1–2 second latency). Instead, mic state is frontend-controlled via socket events, which is near-instant.
