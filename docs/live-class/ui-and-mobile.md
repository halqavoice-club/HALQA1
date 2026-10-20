# Live Class — Web UI and Mobile

**Audit date:** 2026-08-26  
**Rule:** Read-only documentation audit. No code modified.

---

## Web Frontend

### Routes

| Route | File | Purpose |
|-------|------|---------|
| `/live-class` | `(dashboard)/live-class/page.tsx` | List of live classes (search, filter, create) |
| `/live-class/[id]` | `(dashboard)/live-class/[id]/page.tsx` | Live class room |
| `/live-class/camera-test` | `(dashboard)/live-class/camera-test/page.tsx` | Camera/microphone test page |

---

### Page: `/live-class` (List Page)

**File:** `frontend/src/app/(dashboard)/live-class/page.tsx`

**Components/hooks used:**
- `useAuthStore` — current user
- `useEducationRole()` — determines `isAdmin` / `isTeacher` for "Create" button visibility
- `useQuery` — loads live class list
- `useMutation` — delete live class
- `CreateLiveClassModal` — create new live class dialog
- `getSocket()` — subscribes to `liveclass:started` for real-time list updates

**API calls:**
- `GET /live-classes` — paginated list with search/filter
- `DELETE /live-classes/:id` — soft-delete (host only)

**Socket.IO events listened:**
- `liveclass:started` — refreshes the list query
- `liveclass:scheduled` — refreshes the list query

**Filters available:** status (all/LIVE/SCHEDULED/ENDED), search by title, stream type pill (SCHOOL/PUBLIC)

**Create button:** Shown to `isAdmin` or `isTeacher` users (from `useEducationRole`)

**Card display:** title, status badge, stream type pill (SCHOOL=class, PUBLIC=globe), host/teacher name, class name (SCHOOL only), participant count, scheduled time, duration

---

### Component: `CreateLiveClassModal`

**File:** `frontend/src/components/live-class/CreateLiveClassModal.tsx`

**Inputs:**
- Title (required)
- Stream type (SCHOOL / PUBLIC)
- Class (required for SCHOOL, from school's class list)
- Description
- Scheduled time
- Duration
- Max participants
- Feature toggles: chat, hand raise, whiteboard, Quran panel, screen share

**API calls:**
- `GET /classes` — populate class selector (SCHOOL mode)
- `POST /live-classes` — create the class

---

### Page: `/live-class/[id]` (Room Page)

**File:** `frontend/src/app/(dashboard)/live-class/[id]/page.tsx`

Simple wrapper that renders `<LiveClassRoomWithBoundary id={id} />`.

---

### Component: `LiveClassRoomWithBoundary`

**File:** `frontend/src/components/live-class/LiveClassRoomWithBoundary.tsx`

React error boundary wrapping `LiveClassRoomPage`. On error:
- Shows recovery UI (Radio icon, Reconnect / Leave buttons)
- Errors logged to console (should go to Sentry in production)

---

### Component: `LiveClassRoomImpl` / `LiveClassRoomPage`

**File:** `frontend/src/components/live-class/LiveClassRoomImpl.tsx`

This is the main live class room UI. It is large (~1000+ lines) and handles all room interactions.

**Key state:**
- `participants` — list of active participants
- `messages` — chat history
- `joined` — whether user has joined the class
- `micOn` — microphone state
- `isOpenMic` — open mic mode
- `activeSpeakers` — Set of userId speaking
- `handRaised` — own hand state
- `viewMode` — 'video' | 'audio'
- `tab` — active UI tab ('class' | 'chat' | 'host' | 'features')

**Host detection:**
```typescript
const isStaffRole = ['TEACHER', 'SCHOOL_ADMIN'].includes(user?.role || '')
// SUPER_ADMIN deliberately excluded
const isHost = isStaffRole || (!!lc && !!user && lc.hostUserId === user.id)
```

**API calls:**
- `GET /live-classes/:id` — load class info
- `POST /live-classes/:id/join` — join the class
- `POST /live-classes/:id/leave` — leave
- `POST /live-classes/:id/start` — start (HOST)
- `POST /live-classes/:id/end` — end (HOST)
- `POST /live-classes/:id/token` — get LiveKit token
- `POST /live-classes/:id/hand/raise/lower/approve/reject` — hand queue
- `POST /live-classes/:id/messages` — send message
- `DELETE /live-classes/:id/messages/:msgId` — delete message
- `GET /live-classes/:id/messages` — load history
- `GET /live-classes/:id/hand/queue` — load hand queue (HOST)
- `GET /live-classes/:id/attendance` — attendance (HOST)
- `PATCH /live-classes/:id/participants/:userId/mute` — mute
- `PATCH /live-classes/:id/mute-all` — mute all
- `PATCH /live-classes/:id/unmute-all` — unmute all
- `DELETE /live-classes/:id/participants/:userId` — kick
- `POST /live-classes/:id/open-mic` — toggle open mic
- `POST /live-classes/:id/recording/start|stop` — recording
- `POST /live-classes/:id/whiteboard` — whiteboard broadcast
- `POST /live-classes/:id/poll` — poll broadcast
- `POST /live-classes/:id/quran-position` — Quran sync
- Gift endpoints

**Socket.IO events:**
All 20+ `liveclass:*` events. See [realtime.md](./realtime.md).

**LiveKit:**
Inline `connectLiveKit()` function — manages its own `Room` instance, not `useLiveKit` hook.

---

### Sub-components

| Component | File | Purpose |
|-----------|------|---------|
| `LiveClassHostControls` | `components/live-class/LiveClassHostControls.tsx` | Host-only controls panel (mute, kick, hand queue, recording) |
| `LiveClassPoll` | `components/live-class/LiveClassPoll.tsx` | Poll creation and display |
| `LiveClassQuranPanel` | `components/live-class/LiveClassQuranPanel.tsx` | Quran synchronized reading panel |
| `LiveClassWhiteboard` | `components/live-class/LiveClassWhiteboard.tsx` | Canvas whiteboard with real-time sync |
| `LiveClassGiftOverlay` | `components/live-class/LiveClassGiftOverlay.tsx` | Animated gift overlay display |
| `GiftEarningsWidget` | `components/live-class/GiftEarningsWidget.tsx` | Host earnings widget |
| `SpeakerGrid` | `components/live-class/layout/SpeakerGrid.tsx` | Dynamic speaker grid layout |
| `SeatCard` | `components/live-class/layout/SeatCard.tsx` | Individual participant video/audio card |
| `SeatAdminMenu` | `components/live-class/layout/SeatAdminMenu.tsx` | Per-seat host moderation menu |
| `useDynamicLayout` | `components/live-class/layout/useDynamicLayout.ts` | Dynamic grid layout hook |
| `useDynamicLayoutStore` | `components/live-class/layout/useDynamicLayoutStore.ts` | Zustand store for layout state |
| `GiftOverlay` | `components/live-class/layout/GiftOverlay.tsx` | Gift animation overlay |
| `LayoutControlBar` | `components/live-class/layout/LayoutControlBar.tsx` | Layout view toggle bar |
| `SpeakingRing` | `components/live-class/layout/SpeakingRing.tsx` | Animated speaking indicator |
| `PaginationDots` | `components/live-class/layout/PaginationDots.tsx` | Video page navigation |

---

### Page: `/live-class/camera-test`

**File:** `frontend/src/app/(dashboard)/live-class/camera-test/page.tsx`

Pre-join camera and microphone test page. Tests media device access before joining a live class.

---

## Mobile (React Native / Expo)

### Screen: `mobile/app/live-class/[id].tsx`

**Navigation:** `halqa://live-class/[id]` deep link

**Components used:**
- `LiveClassPollPanel` — poll display/voting
- `LiveClassQuranPanel` — Quran synchronized panel
- `LiveClassWhiteboard` — canvas whiteboard
- `useLiveKitAudio` — native audio via `@livekit/react-native-webrtc` (degrades in Expo Go)

**Host detection:**
```typescript
// SUPER_ADMIN is platform-admin only — must NOT auto-become host
const isTeacher = ['TEACHER','SCHOOL_ADMIN'].includes(user?.role || '');
const isHost = user?.id === liveClass?.host?.id || isTeacher;
```

**API calls:**
- `GET /live-classes/:id` — load class info
- `POST /live-classes/:id/join` — join
- `POST /live-classes/:id/leave` — leave (on unmount)
- `POST /live-classes/:id/messages` — send message
- `GET /live-classes/:id/hand/queue` — load queue (HOST)
- `GET /live-classes/:id/attendance` — load attendance (HOST)
- `POST /live-classes/:id/hand/raise|lower|approve|reject` — hand queue
- `PATCH /live-classes/:id/participants/:userId/mute` — mute (HOST)
- `DELETE /live-classes/:id/participants/:userId` — kick (HOST)
- `POST /live-classes/:id/open-mic` — toggle open mic (HOST)
- `POST /live-classes/:id/recording/start|stop` — recording (HOST)

**Socket.IO events:** Same 20+ events as web. On mount: `socket.emit('liveclass:join_room', id)`. On unmount: `socket.emit('liveclass:leave_room', id)`.

**UI Tabs:** Class (video grid), Chat, Host (hand queue + attendance), Features (whiteboard, poll, Quran)

**Background behavior:** Leave API called on unmount. Socket leaves room. LiveKit audio stops.

---

### Mobile Components: `mobile/src/components/live-class/`

| Component | Purpose |
|-----------|---------|
| `LiveClassPollPanel.tsx` | Poll display, option selection, vote submission |
| `LiveClassQuranPanel.tsx` | Quran panel with surah/ayah navigation |
| `LiveClassWhiteboard.tsx` | Canvas drawing with real-time sync |

---

### Feed Integration

**File:** `mobile/src/components/feed/LiveCard.tsx`, `mobile/src/components/feed/LiveSection.tsx`

Live class cards appear in the social feed when `refEntityType = 'live_class'`. Cards show class title, host info, and participant count. Tapping navigates to `live-class/[id]`.

---

## Authorization Guards

### Web
- Route `/live-class` — accessible to all authenticated users
- Route `/live-class/[id]` — accessible to all authenticated users; access control enforced by the backend
- Host-only UI elements hidden via `isHost` check

### Mobile
- Screen accessible to all authenticated users
- Host controls hidden via `isHost` check
- No client-side route guard — backend enforces all authorization

---

## Test Files

| File | Purpose |
|------|---------|
| `backend/src/tests/live-class-p0-security.test.js` | P0: Cross-school IDOR, socket identity, kicked participant SFU removal |
| `backend/src/tests/live-class-p1-reliability.test.js` | P1: Enrollment gate, view-mode authorization, duration auto-end |
| `backend/src/tests/live-class-p2-hardening.test.js` | P2: Poll vote identity, whiteboard size cap, gift school isolation |
| `backend/src/tests/p3-security-fixes.test.js` | P3: SQL column allowlist in updateLiveClass, listLiveClasses parameterization |
| `backend/src/tests/super-admin-scope.test.js` | SA-FIX-01: isStaffRole source verification (frontend + mobile files) |
| `backend/src/tests/platform-admin-scope.test.js` | SUPER_ADMIN scope tests |
| `src/lib/layout/__tests__/computeLayout.pbt.test.ts` | Property-based tests for the dynamic speaker grid layout |
