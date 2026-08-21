# Live Class Security Fixes — Implementation Tasks

## Overview

12 confirmed bugs across 3 files. All fixes are surgical — no API contracts, DB schema,
or existing migrations changed. No new dependencies required.

**Files changed:**
- `backend/src/controllers/live-class.controller.js`
- `backend/src/app.js`
- `frontend/src/components/live-class/LiveClassRoomImpl.tsx`

---

## Tasks

- [x] 1. BUG-01 — LiveKit SFU eviction on kick
  - `kickParticipant` calls `RoomServiceClient.removeParticipant(lc.livekitRoomName, userId)`
  - Best-effort: LiveKit API failure is logged and swallowed; DB kick always persists
  - `getLivekitRoomService()` factory returns `null` when env vars not configured
  - **Files:** `backend/src/controllers/live-class.controller.js`
  - **Status:** Already implemented (found in place during audit)

- [x] 2. BUG-02 — School isolation on all individual live class endpoints
  - `assertSchoolAccess(lc, user)` helper: skips check for SUPER_ADMIN, returns 403 for cross-school access
  - Called in every action function after `findFirst` result is confirmed non-null
  - Affected functions: getLiveClass, updateLiveClass, deleteLiveClass, startLiveClass, endLiveClass, joinLiveClass, leaveLiveClass, getLiveKitToken, getParticipants, muteParticipant, muteAll, unmuteAll, lowerAllHands, kickParticipant, raiseHand, lowerHand, approveHand, rejectHand, getHandQueue, sendMessage, getMessages, getAttendance, requestSpeak, toggleOpenMic, startRecording, stopRecording, broadcastPoll, getPollState, broadcastDraw
  - **Files:** `backend/src/controllers/live-class.controller.js`
  - **Status:** Already implemented (found in place during audit)

- [x] 3. BUG-03 — speaking event uses socket.userId not client payload
  - `liveclass:speaking` handler: uses `socket.userId` (JWT-verified), never `payload.userId`
  - **Files:** `backend/src/app.js`
  - **Status:** Already implemented (fixed as part of Social P0/P1 audit fixes)

- [x] 4. RT-05 — Socket room join requires active DB participation
  - `liveclass:join_room` handler: queries `prisma.liveClassParticipant.findFirst({ where: { liveClassId, userId, isActive: true } })` before `socket.join()`
  - Silently refuses if no active participant record found
  - **Files:** `backend/src/app.js`
  - **Status:** Already implemented (fixed as part of Social P0/P1 audit fixes)

- [x] 5. RT-02 — video_changed event uses socket.userId not client payload
  - `liveclass:video_changed` handler: uses `socket.userId` (JWT-verified), never `payload.userId`
  - **Files:** `backend/src/app.js`
  - **Status:** Already implemented (fixed as part of Social P0/P1 audit fixes)

- [x] 6. BUG-04 — View mode change restricted to HOST only
  - `liveclass:viewmode_changed` handler: queries `prisma.liveClassParticipant.findFirst({ where: { liveClassId, userId, isActive: true, role: 'HOST' } })`
  - Silently drops event if sender is not the active HOST
  - **Files:** `backend/src/app.js`
  - **Status:** Already implemented (fixed as part of Social P0/P1 audit fixes)

- [x] 7. BUG-05 — Auto-end timer for duration-limited classes
  - Added `autoEndTimers` Map at module level (liveClassId → NodeJS.Timeout)
  - Added `_endLiveClassById(lc)` — extracted end logic shared by manual end + auto-end
  - Added `scheduleAutoEnd(liveClassId, startedAt, durationMinutes)` — calculates remaining delay, sets timer
  - Added `cancelAutoEnd(liveClassId)` — clears existing timer
  - `startLiveClass`: calls `scheduleAutoEnd` after DB update when `lc.duration` is set
  - `joinLiveClass` (teacher auto-start): calls `scheduleAutoEnd` when `lc.duration` is set
  - `endLiveClass`: calls `cancelAutoEnd` before DB work to prevent stale timer firing
  - **Files:** `backend/src/controllers/live-class.controller.js`

- [x] 8. BUG-06 — Enrollment check in joinLiveClass for students
  - Before maxParticipants check: fetches `prisma.student.findFirst({ where: { userId } })`
  - Then `prisma.enrollment.findFirst({ where: { studentId, classId: lc.classId, isActive: true } })`
  - Returns 403 if no student profile or no active enrollment
  - Teachers/SCHOOL_ADMIN/SUPER_ADMIN skip this check entirely
  - Student record reused later for attendance upsert (no duplicate DB call)
  - **Files:** `backend/src/controllers/live-class.controller.js`
  - **Status:** Already implemented (found in place during audit)

- [x] 9. PERF-05 — Reconnect timer accumulation in LiveClassRoomImpl
  - `reconnectTimerRef` (useRef) stores timer ID
  - Before starting a new timer: `if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)`
  - Unmount cleanup: cancels timer via `reconnectTimerRef`
  - handleLeave: cancels timer before disconnecting
  - **Files:** `frontend/src/components/live-class/LiveClassRoomImpl.tsx`
  - **Status:** Already implemented (found in place during audit)

- [x] 10. SEC-06 — Whiteboard snapshot size cap
  - In `broadcastDraw`: checks `event.dataUrl.length > 200_000` before Redis write
  - Returns HTTP 413 if exceeded; Redis write is skipped
  - Non-snapshot draw events are unaffected
  - **Files:** `backend/src/controllers/live-class.controller.js`
  - **Status:** Already implemented (found in place during audit)

- [x] 11. SEC-07 — Poll vote uses req.user.id not client payload
  - In `broadcastPoll` vote branch: `voterId = req.user.id` (JWT-verified)
  - Duplicate-vote check uses `req.user.id`; vote record uses `req.user.id`
  - Emitted normalizedEvent also carries `userId: req.user.id`
  - **Files:** `backend/src/controllers/live-class.controller.js`
  - **Status:** Already implemented (found in place during audit)

- [x] 12. PLAT-02 — Screen share button hidden on unsupported platforms
  - Screen share button render condition extended with platform capability check:
    `typeof window !== 'undefined' && !!(navigator.mediaDevices?.getDisplayMedia)`
  - Button hidden on iOS Safari and mobile Chrome (where `getDisplayMedia` is undefined)
  - Button remains fully functional on all desktop browsers
  - `screenShareEnabled: false` continues to hide the button regardless of platform
  - **Files:** `frontend/src/components/live-class/LiveClassRoomImpl.tsx`

---

## Test Results

All 12 bugs addressed. Full test suite: **567/567 passing**.

The LiveKit eviction warning in `live-class-p2-hardening.test.js` is expected —
the test intentionally simulates a LiveKit connection refusal to verify the DB kick
still persists even when the LiveKit API is unreachable (best-effort behaviour).
