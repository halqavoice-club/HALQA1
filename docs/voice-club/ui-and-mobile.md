# Voice Club — Web UI and Mobile

**Audit date:** 2026-08-26

---

## Web Frontend

### Routes

| Route | File | Purpose |
|-------|------|---------|
| `/voice-club` | `(dashboard)/voice-club/page.tsx` | Voice room list |
| `/voice-club/[id]` | `(dashboard)/voice-club/[id]/page.tsx` | Voice room |
| `/voice-club/[id]/members` | `(dashboard)/voice-club/[id]/members/page.tsx` | Room members management |
| `/voice-club/stats` | `(dashboard)/voice-club/stats/page.tsx` | Host statistics |
| `/voice-club/pk` | `(dashboard)/voice-club/pk/page.tsx` | PK battle lobby |
| `/voice-club/pk/[id]` | `(dashboard)/voice-club/pk/[id]/page.tsx` | PK battle room |

---

### Page: `/voice-club` (List)

**Stores/hooks used:** `useAuthStore`, `useVoiceStore`, `useVoiceRoom` (socket subscription for live updates)  
**API calls:** `GET /voice/`, `GET /voice/scheduled`  
**Socket events:** `voice:room_created`, `voice:room_updated`, `voice:room_deleted` (via `voice:lobby`)

Displays room cards with: title, host avatar, privacy badge, participant count, topic.  
"Create Room" opens `CreateRoomModal`.

---

### Component: `CreateRoomModal`

**File:** `frontend/src/components/voice/CreateRoomModal.tsx`

**Inputs:**
- Title (required, max 120)
- Description
- Privacy (PUBLIC / PRIVATE / INVITE_ONLY)
- Cover emoji picker
- Max speakers (1–20)
- Scheduled date/time (optional)

**API call:** `POST /voice/`

---

### Page: `/voice-club/[id]` (Room)

**File:** `frontend/src/app/(dashboard)/voice-club/[id]/page.tsx`

Wrapper that renders `<VoiceRoomWithBoundary id={id} />`.

---

### Component: `VoiceRoomWithBoundary`

**File:** `frontend/src/components/voice/VoiceRoomWithBoundary.tsx`

React error boundary wrapping `VoiceRoomView`. On error: shows recovery UI with Reconnect/Leave buttons.

---

### Component: `VoiceRoomView`

**File:** `frontend/src/components/voice/VoiceRoomView.tsx`

Main room UI. Uses two hooks:
- `useVoiceRoom(roomId)` — Socket.IO event handling, role state, participant management
- `useLiveKit(roomId)` — LiveKit audio connection

**Key state (from `useVoiceStore`):**
- `activeRoom` — current room object
- `participants` — all active participants with roles
- `messages` — chat history
- `speakerQueue` — FIFO queue state
- `activeSpeakers` — Set of currently speaking userIds
- `wallet` — own coin/diamond balance (for gift sending)

**Host detection:**
```typescript
const myRole = myParticipant?.role || (activeRoom.hostId === user?.id ? VOICE_ROLES.HOST : VOICE_ROLES.AUDIENCE)
const amModerating = canModerate(myParticipant?.role) || activeRoom.hostId === user?.id
const iCanSpeak = canSpeak(myParticipant?.role)
```

SUPER_ADMIN has no bypass — role comes exclusively from the `VoiceParticipant.role` DB field.

**API calls made by `VoiceRoomView`:**
- `POST /voice/:id/join` — on room entry
- `POST /voice/:id/leave` — on exit + `window.beforeunload`
- `POST /voice/:id/livekit-token` — to connect LiveKit
- `POST /voice/:id/queue/raise|cancel` — hand raise
- `PATCH /voice/:id/mute` — self-mute
- `POST /voice/:id/drop-mic` — self-demote
- Gift endpoints
- Speaker queue approval (HOST/MOD only)

**Socket.IO events subscribed:** All `voice:*` events listed in [realtime.md](./realtime.md).

---

### Component: `UserProfileSheet`

**File:** `frontend/src/components/voice/UserProfileSheet.tsx`

Per-participant action sheet. Shows moderation actions (mute, kick, promote/demote) only to HOST/MOD:

```typescript
const canModerate = (myRole === 'HOST' || myRole === 'MODERATOR') && !isMe
```

SUPER_ADMIN has no bypass here — `myRole` comes from `VoiceParticipant.role`.

---

### Component: `RoomSettingsSheet`

**File:** `frontend/src/components/voice/RoomSettingsSheet.tsx`

Host settings panel: update title, description, privacy, max speakers, open mic, mic lock, slow mode, reactions, message type.  
**API calls:** `PATCH /voice/:id`, `PATCH /voice/:id/open-mic`, `PATCH /voice/:id/mic-lock`

---

### Component: `GiftPanel` and `GiftOverlay`

Gift sending UI and animated gift display overlay.  
**API calls:** `POST /voice/:id/gifts`, `POST /voice/:id/gifts/all`

---

### Page: `/voice-club/[id]/members`

**File:** `frontend/src/app/(dashboard)/voice-club/[id]/members/page.tsx`

Permanent member management page:
- Member list with levels, roles, online status
- Role assignment (OWNER/CO_OWNER/ADMIN/MODERATOR/VIP etc.)
- Remove member
- Ban/unban

**Access control:** `isAdmin = ['OWNER','CO_OWNER','ADMIN','MODERATOR'].includes(myRole)` — client-side gate.

---

### Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useLiveKit(roomId)` | `hooks/useLiveKit.ts` | LiveKit Room connection, audio track management, reconnect |
| `useVoiceRoom(roomId)` | `hooks/useVoiceRoom.ts` | Socket.IO events, participant state, canModerate/canSpeak helpers |

---

### Store: `voice.store.ts`

**File:** `frontend/src/store/voice.store.ts`

Zustand store for voice room state:
- `activeRoom` — current room object
- `participants` — `VoiceParticipant[]`
- `messages` — `VoiceMessage[]`
- `activeSpeakers` — Map of userId → boolean
- `speakerQueue` — queue state
- `pendingMicOffer` — incoming mic pass offer
- `giftEvents` — recent gift animations
- `giftLeaderboard` — top gifters
- `wallet` — own wallet state

---

## Mobile (React Native / Expo)

### Screen: `mobile/app/voice/[id].tsx`

**Navigation:** `halqa://voice/[id]` deep link

**Components used:**
- `MemberManagementPanel` — permanent member management
- `MicPassModal` — mic pass accept/decline UI

**Hooks:**
- `useLiveKitAudio` — native audio via `@livekit/react-native-webrtc`

**State management:** `mobile/src/store/voice.store.ts` (Zustand)

**Role detection:**
```typescript
const myRole = participants.find(p => p.id === user?.id)?.role ?? (room?.host?.id === user?.id ? 'HOST' : 'AUDIENCE')
const canModerate = myRole === 'HOST' || myRole === 'MODERATOR'
```

No SUPER_ADMIN bypass.

**Socket.IO:** Same `voice:*` events as web.

---

### Mobile Components: `mobile/src/components/voice/`

| Component | Purpose |
|-----------|---------|
| `MemberManagementPanel.tsx` | Permanent member list, block/remove/role actions |
| `MicPassModal.tsx` | Incoming mic pass offer modal |

---

### Mobile Specific Behaviors

- Background audio: `useLiveKitAudio` keeps audio active in background using `@livekit/react-native-webrtc`
- Push-to-talk: not implemented (PTT would require additional UI)
- Lock screen controls: handled by `useLiveKit` MediaSession API (web only; mobile uses native audio session)

---

## Test Files

| File | Purpose |
|------|---------|
| `backend/src/tests/super-admin-scope.test.js` | SA-FIX-02 through SA-FIX-09: SUPER_ADMIN bypass removal tests |
| `backend/src/tests/p3-security-fixes.test.js` | Privacy guard for PRIVATE rooms, voice message checks |
| `backend/src/tests/integration/voice.integration.test.js` | Full integration tests (1600+ lines) |
| `backend/src/tests/p0-security-fixes.test.js` | P0 fixes including SOC-P1-05 (voice:join_room participation check) |
