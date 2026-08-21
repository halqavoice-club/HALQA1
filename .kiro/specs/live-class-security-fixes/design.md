# Live Class Security Fixes — Bugfix Design

## Overview

This document formalises the fix strategy for 11 confirmed bugs found during a production-readiness audit of the HALQA platform's Live Class feature. The bugs span three files:

- `backend/src/controllers/live-class.controller.js` — REST endpoint logic
- `backend/src/app.js` — Express app and Socket.IO connection handler
- `frontend/src/components/live-class/LiveClassRoomImpl.tsx` — React live class room component

Issues range from critical security vulnerabilities (cross-school IDOR, identity spoofing, unauthenticated socket room access) to reliability problems (timer accumulation, missing auto-end) and hardening gaps (unbounded Redis writes, client-trusted vote identity, unsupported API on mobile).

No database migrations or API contract changes are required. All fixes are confined to the three files above.

---

## Glossary

- **Bug_Condition (C)**: The specific input state that triggers the defective code path, formally captured in `isBugCondition(input)` pseudocode for each bug.
- **Property (P)**: The desired correct behaviour when the bug condition holds, captured in `expectedBehavior(result)` pseudocode.
- **Preservation**: Existing correct behaviour (inputs where `¬C(X)`) that must remain unchanged by each fix.
- **LiveKit SFU**: The Selective Forwarding Unit that routes audio/video streams between participants.
- **RoomServiceClient**: LiveKit Server SDK class for administrative room operations (eviction, muting, etc.).
- **socket.userId**: Server-verified user ID set by the JWT authentication middleware on every socket connection in `app.js`. Cannot be spoofed by the client.
- **IDOR**: Insecure Direct Object Reference — accessing a resource by ID without ownership/authorization check.
- **assertSchoolAccess(lc, user)**: The new helper function added in `live-class.controller.js` that enforces school-level isolation on every individual live class action.
- **autoEndTimers**: Module-level `Map<liveClassId, NodeJS.Timeout>` in `live-class.controller.js` tracking pending auto-end timers.
- **isBugCondition(input)**: Pseudocode function that returns `true` when a given input triggers the defective behaviour being fixed.
- **reconnectTimerRef**: New `useRef<ReturnType<typeof setTimeout> | null>` added to `LiveClassRoomImpl.tsx` to prevent timer accumulation.

---

## Bug Details

### BUG-01: LiveKit SFU eviction missing on kick

The bug manifests when a host kicks a participant. The controller marks `isActive: false` and emits `liveclass:you_were_kicked` but does not call `RoomServiceClient.removeParticipant`, leaving the kicked user connected to the LiveKit SFU indefinitely.

**Formal Specification:**
```
FUNCTION isBugCondition_BUG01(input)
  INPUT: input = { liveClassId, userId, lc }
  OUTPUT: boolean

  RETURN kickParticipant was called
         AND lc.livekitRoomName IS NOT NULL
         AND RoomServiceClient.removeParticipant was NOT called for (lc.livekitRoomName, userId)
END FUNCTION
```

**Examples:**
- Host kicks student A. DB sets `isActive: false`, socket emits `you_were_kicked`. Student A's browser receives the kick and navigates away, BUT student A's LiveKit connection remains open — they keep receiving audio/video streams for the remainder of the session.
- Host kicks student B in a class with `livekitRoomName = null` (class was never started via LiveKit). `removeParticipant` is not called (no room to remove from) — this is acceptable, not a bug.
- Host kicks student C in a class with a valid `livekitRoomName` but LiveKit API is unreachable. The kick is still recorded in DB and socket emitted — `removeParticipant` failure is logged and swallowed (best-effort).

---

### BUG-02: No school isolation on individual live class endpoints

The bug manifests when any action endpoint (e.g., `joinLiveClass`, `kickParticipant`, `getLiveKitToken`) receives a `liveClassId` belonging to a different school. The controller performs a `findFirst` with only `id` and `deletedAt` in the `where` clause — no `schoolId` check.

**Formal Specification:**
```
FUNCTION isBugCondition_BUG02(input)
  INPUT: input = { lc, user }
  OUTPUT: boolean

  RETURN user.role != 'SUPER_ADMIN'
         AND lc.schoolId != user.schoolId
         AND assertSchoolAccess was NOT called (or not present)
END FUNCTION
```

**Examples:**
- A student from School A (`schoolId = "school-a"`) calls `GET /live-classes/{id}` where `id` belongs to School B. Currently returns 200 with School B's class data. After fix: returns 403.
- A SUPER_ADMIN calls the same endpoint. After fix: returns 200 (school check is bypassed).
- A teacher from the correct school calls an endpoint. After fix: check passes, request proceeds normally.

---

### BUG-03: speaking event relays client-supplied userId

The bug manifests when the server receives a `liveclass:speaking` socket event. The handler destructures `userId: speakerId` from the client payload and uses `speakerId || userId` in the relay — allowing the client to inject a victim's user ID.

**Formal Specification:**
```
FUNCTION isBugCondition_BUG03(input)
  INPUT: input = { socketEvent, socket }
  OUTPUT: boolean

  RETURN socketEvent.name = 'liveclass:speaking'
         AND socketEvent.payload.userId != socket.userId
         AND relayed event uses socketEvent.payload.userId
END FUNCTION
```

**Examples:**
- Attacker emits `liveclass:speaking` with `{ userId: "victim-id", speaking: true }`. All other clients show "victim-id" as speaking. After fix: relayed with `socket.userId` (attacker's own ID), not the injected value.
- Legitimate speaker emits `liveclass:speaking` with their own `userId` (or no `userId`). After fix: relayed with `socket.userId` — same result, no regression.

---

### RT-05: Socket room join has no DB participation check

The bug manifests when any authenticated socket emits `liveclass:join_room`. The handler calls `socket.join(...)` unconditionally — no check that the user has an active `LiveClassParticipant` record.

**Formal Specification:**
```
FUNCTION isBugCondition_RT05(input)
  INPUT: input = { liveClassId, socketUserId }
  OUTPUT: boolean

  RETURN liveclass:join_room was emitted
         AND NO active LiveClassParticipant record exists for (liveClassId, socketUserId)
         AND socket.join was called anyway
END FUNCTION
```

**Examples:**
- A user who never called `joinLiveClass` emits `liveclass:join_room`. Currently added to the room and receives all events. After fix: DB query finds no record, socket is not added.
- A legitimate participant emits `liveclass:join_room`. DB query finds `isActive: true` record, socket is added normally.

---

### RT-02: video_changed event relays client-supplied userId

Identical attack surface to BUG-03 but for the `liveclass:video_changed` event.

**Formal Specification:**
```
FUNCTION isBugCondition_RT02(input)
  INPUT: input = { socketEvent, socket }
  OUTPUT: boolean

  RETURN socketEvent.name = 'liveclass:video_changed'
         AND socketEvent.payload.userId != socket.userId
         AND relayed event uses socketEvent.payload.userId
END FUNCTION
```

**Examples:**
- Attacker emits `liveclass:video_changed` with `{ userId: "victim-id", isVideoOn: false }`. Other clients show victim's video as off. After fix: relayed with `socket.userId`.

---

### BUG-04: Any socket can broadcast view mode change

The bug manifests when a `liveclass:viewmode_changed` event is received. The handler relays it to all room participants without verifying the sender is a HOST.

**Formal Specification:**
```
FUNCTION isBugCondition_BUG04(input)
  INPUT: input = { socketUserId, liveClassId }
  OUTPUT: boolean

  RETURN liveclass:viewmode_changed was emitted
         AND no LiveClassParticipant with (liveClassId, socketUserId, role='HOST', isActive=true) exists
         AND event was relayed
END FUNCTION
```

**Examples:**
- A student emits `liveclass:viewmode_changed`. Currently broadcast to all. After fix: DB check finds no HOST record for the student, event is silently dropped.
- The actual host emits `liveclass:viewmode_changed`. DB check confirms HOST role, event is broadcast normally.

---

### BUG-05: No auto-end timer for duration-limited classes

The bug manifests when a live class with `duration > 0` transitions to LIVE status. No timer, cron, or background job is scheduled to end the class when `startedAt + duration` has elapsed.

**Formal Specification:**
```
FUNCTION isBugCondition_BUG05(input)
  INPUT: input = { lc }
  OUTPUT: boolean

  RETURN (startLiveClass or joinLiveClass auto-start was called)
         AND lc.duration IS NOT NULL
         AND autoEndTimers.has(lc.id) = false
END FUNCTION
```

**Examples:**
- Teacher starts a 60-minute class. No timer is scheduled. Class runs indefinitely until manually ended. After fix: `scheduleAutoEnd` is called, class auto-ends at `startedAt + 60min`.
- Teacher manually ends the class at 45 minutes. After fix: `cancelAutoEnd(lc.id)` is called before DB update, timer is cleared.
- Class has `duration = null`. After fix: no timer is scheduled (no regression).

---

### BUG-06: No enrollment check in joinLiveClass for students

The bug manifests when a student calls `joinLiveClass`. The handler checks class existence, status, and participant limit but not whether the student is enrolled in the class.

**Formal Specification:**
```
FUNCTION isBugCondition_BUG06(input)
  INPUT: input = { userId, lc, userRole }
  OUTPUT: boolean

  RETURN userRole = 'STUDENT'
         AND NO active Enrollment record exists for (student.userId=userId, classId=lc.classId, isActive=true)
         AND join was allowed
END FUNCTION
```

**Examples:**
- A student from a different class calls `joinLiveClass`. Currently allowed in (if under capacity). After fix: returns 403 "You are not enrolled in this class".
- An enrolled student calls `joinLiveClass`. Enrollment found, join proceeds normally.
- A teacher calls `joinLiveClass`. `isTeacher` check skips enrollment logic entirely.

---

### PERF-05: Reconnect timer accumulation in LiveClassRoomImpl.tsx

The bug manifests when the LiveKit connection oscillates to `Disconnected` multiple times. Inside the `room.on(RoomEvent.ConnectionStateChanged, ...)` callback, a `setTimeout` is created on each disconnect but the cleanup `return () => clearTimeout(retryTimer)` is inside the callback, not a `useEffect` return — so it is never executed by React.

**Formal Specification:**
```
FUNCTION isBugCondition_PERF05(input)
  INPUT: input = { disconnectCount }
  OUTPUT: boolean

  RETURN ConnectionState.Disconnected was received N > 1 times
         AND reconnectTimerRef does NOT exist (or was not cancelled before creating new timer)
         AND N concurrent timers are alive
END FUNCTION
```

**Examples:**
- Connection drops 3 times in 5 seconds. 3 concurrent `setTimeout` callbacks are queued, each calling `connectLiveKitRef.current?.()`. After fix: only one timer is alive at any time.
- Component unmounts while a reconnect timer is pending. After fix: unmount cleanup cancels the timer via `reconnectTimerRef`.

---

### SEC-06: Unbounded whiteboard snapshot size

The bug manifests when `broadcastDraw` receives a draw event with `type === 'snapshot'`. No validation is applied to `event.dataUrl` length before writing to Redis.

**Formal Specification:**
```
FUNCTION isBugCondition_SEC06(input)
  INPUT: input = { event }
  OUTPUT: boolean

  RETURN event.type = 'snapshot'
         AND event.dataUrl IS NOT NULL
         AND event.dataUrl.length > 200_000
         AND event was written to Redis
END FUNCTION
```

**Examples:**
- Host sends a snapshot with a 10 MB `dataUrl`. Currently stored in Redis, exhausting memory over repeated snapshots. After fix: returns 413, Redis write is skipped.
- Host sends a snapshot with a 180,000-character `dataUrl`. Within limit, stored normally.
- Host sends a non-snapshot draw event (pen stroke). No size check applied, processed normally.

---

### SEC-07: Poll vote uses client-supplied userId

The bug manifests in the vote branch of `broadcastPoll`. The duplicate-vote guard uses `event.userId` from the request body instead of `req.user.id`.

**Formal Specification:**
```
FUNCTION isBugCondition_SEC07(input)
  INPUT: input = { eventUserId, reqUserId }
  OUTPUT: boolean

  RETURN event.type = 'vote'
         AND eventUserId != reqUserId
         AND vote was recorded using eventUserId (not reqUserId)
END FUNCTION
```

**Examples:**
- Student submits two votes with different `event.userId` values. Currently both recorded. After fix: second vote rejected because `req.user.id` is the same.
- Student submits one legitimate vote. `req.user.id` used as voter identity, duplicate check works correctly.

---

### PLAT-02: Screen share button shown on unsupported platforms

The bug manifests when a user on iOS Safari or mobile Chrome views a live class with `screenShareEnabled: true`. The screen share button is rendered and clickable, but `navigator.mediaDevices.getDisplayMedia` is undefined on those platforms, causing an unhandled runtime error on click.

**Formal Specification:**
```
FUNCTION isBugCondition_PLAT02(input)
  INPUT: input = { navigatorEnv, screenShareEnabled }
  OUTPUT: boolean

  RETURN screenShareEnabled = true
         AND navigator.mediaDevices?.getDisplayMedia IS undefined
         AND screen share button IS rendered
END FUNCTION
```

**Examples:**
- iOS Safari: `getDisplayMedia` is absent. Currently button is shown and clicking throws an error. After fix: button is hidden.
- Desktop Chrome: `getDisplayMedia` is present. Button is shown and functional.
- `screenShareEnabled = false`: button hidden regardless of platform (no regression).

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- `leaveLiveClass` SHALL continue to mark `isActive: false` and emit `liveclass:user_left` without calling `removeParticipant` (BUG-01 fix is kick-only).
- `endLiveClass` SHALL continue to mark all participants inactive, update attendance, and emit `liveclass:ended` without any LiveKit eviction calls.
- `listLiveClasses` SHALL continue to filter by `req.user.schoolId` for non-SUPER_ADMIN users as it does today (BUG-02 fix applies only to individual resource endpoints).
- Users from the correct school calling any endpoint SHALL continue to have requests processed as before — `assertSchoolAccess` is a no-op when `lc.schoolId === user.schoolId`.
- The `liveclass:speaking` event SHALL continue to relay the speaking state to all other room participants for legitimate senders.
- A user who has properly joined via the REST endpoint emitting `liveclass:join_room` SHALL continue to be added to the socket room and receive all events.
- The `liveclass:video_changed` event SHALL continue to relay the correct video state for legitimate senders.
- The actual host emitting `liveclass:viewmode_changed` SHALL continue to have the view mode change broadcast to all participants.
- Live classes with `duration = null` SHALL continue to run indefinitely until manually ended.
- `endLiveClass` (manual) SHALL continue to process exactly as today.
- Enrolled students calling `joinLiveClass` SHALL continue to be added as participants.
- The participant-limit check SHALL continue to reject joins when capacity is reached, regardless of enrollment status.
- When LiveKit disconnects, the system SHALL continue to attempt reconnect after a 3-second delay.
- Component unmount SHALL continue to suppress reconnect attempts.
- Snapshot draw events within the 200,000-character limit SHALL continue to be stored in Redis and broadcast.
- Non-snapshot draw events (pen strokes, clears, shapes) SHALL continue to be processed without any size restriction.
- Students voting in a poll for the first time SHALL continue to have their vote recorded and broadcast.
- Students attempting a second vote with the same verified identity SHALL continue to be rejected by the duplicate-vote guard.
- Desktop browsers with `getDisplayMedia` support SHALL continue to show a functional screen share button.
- When `screenShareEnabled = false`, the screen share button SHALL continue to be hidden regardless of platform.

**Scope:**
All inputs that do not trigger the bug condition for each respective fix should be completely unaffected. The fixes are surgical: each adds a guard or replaces one variable reference, with no restructuring of surrounding logic.

---

## Hypothesized Root Cause

1. **BUG-01 — LiveKit SDK not used for administrative operations**: The controller imports only `AccessToken` from `livekit-server-sdk` for token generation. `RoomServiceClient` (the admin API client) was never instantiated. The kick flow was designed thinking the frontend-side `you_were_kicked` socket event would be sufficient to disconnect the user.

2. **BUG-02 — Incremental feature development without cross-cutting authorization**: Each action function was written to handle its own business logic. School isolation was applied to `listLiveClasses` (via a `where` clause) but never extracted into a shared helper callable by individual resource actions.

3. **BUG-03 / RT-02 — Defensive fallback creates an injection path**: The original code was `userId: speakerId || userId` / `userId: vid || userId`, intending to fall back to `socket.userId` when the client omits the field. In practice any non-empty client-supplied value takes precedence over the server-verified identity.

4. **RT-05 — Socket room treated as a lightweight presence mechanism**: The `liveclass:join_room` handler mirrors the pattern of `voice:join_room` and `class:join`, which are low-sensitivity (class lobby notifications). The live class room carries sensitive events (hand queues, whiteboard strokes, poll votes, chat messages) that require verified participation.

5. **BUG-04 — Host-only semantics not enforced at the relay layer**: The `liveclass:viewmode_changed` handler was written as a simple broadcast relay, with the assumption that only the host's UI would emit the event. No server-side role check was added.

6. **BUG-05 — No background scheduling infrastructure**: The platform does not use a persistent job queue or cron library. Duration enforcement was deferred without a plan, leaving `duration` stored in the DB but never acted upon.

7. **BUG-06 — `joinLiveClass` authorization was incomplete**: The function checks role, capacity, and class status but the enrollment guard was an unimplemented TODO item. Students could join any live class for any class they knew the ID of.

8. **PERF-05 — Cleanup closure scope mismatch**: The `return () => clearTimeout(retryTimer)` inside `room.on(RoomEvent.ConnectionStateChanged, callback)` returns a function to the `room.on` API, not to React's `useEffect` cleanup slot. React never sees or calls this cleanup, so timers accumulate.

9. **SEC-06 — Redis writes assumed to be bounded by frontend validation**: Snapshot payloads are generated by the `LiveClassWhiteboard` component, which in normal use produces reasonable-sized data URLs. No server-side cap was added because the threat model of a malicious host wasn't considered.

10. **SEC-07 — Copy-paste from an earlier draft that used client userId**: The `broadcastPoll` vote branch was written referencing `event.userId` throughout. When the duplicate-vote guard was added, it was checked against `event.userId` rather than `req.user.id`, defeating its own purpose.

11. **PLAT-02 — Feature availability assumed to be desktop-only context**: The screen share feature was built and tested on desktop browsers. No runtime capability check was added, causing silent failures on mobile platforms.

---

## Correctness Properties

Property 1: BUG-01 — Kicked participant is evicted from LiveKit SFU

_For any_ call to `kickParticipant` where `lc.livekitRoomName` is non-null and the LiveKit env vars are configured, the fixed `kickParticipant` function SHALL call `RoomServiceClient.removeParticipant(lc.livekitRoomName, userId)` in addition to marking `isActive: false` in the DB and emitting the socket notification.

**Validates: Requirements 2.1**

Property 2: BUG-02 — School isolation enforced for non-SUPER_ADMIN

_For any_ individual live class action call where `lc.schoolId !== req.user.schoolId` and `req.user.role !== 'SUPER_ADMIN'`, the fixed function SHALL return a 403 response and SHALL NOT read or write any data.

**Validates: Requirements 2.2, 2.3**

Property 3: BUG-03 — speaking event identity is always socket.userId

_For any_ `liveclass:speaking` socket event, regardless of what `userId` value the client includes in the payload, the fixed handler SHALL relay the event with `userId = socket.userId` (the server-verified identity).

**Validates: Requirements 2.4**

Property 4: RT-05 — Socket room join requires active DB participation

_For any_ socket emitting `liveclass:join_room` where no active `LiveClassParticipant` record exists for `(liveClassId, socket.userId)`, the fixed handler SHALL NOT add the socket to the `liveclass:{liveClassId}` room.

**Validates: Requirements 2.5**

Property 5: RT-02 — video_changed event identity is always socket.userId

_For any_ `liveclass:video_changed` socket event, regardless of what `userId` value the client includes in the payload, the fixed handler SHALL relay the event with `userId = socket.userId`.

**Validates: Requirements 2.6**

Property 6: BUG-04 — View mode change is restricted to the host

_For any_ `liveclass:viewmode_changed` socket event where `socket.userId` does NOT correspond to an active HOST participant of `liveClassId`, the fixed handler SHALL silently drop the event and SHALL NOT broadcast it to the room.

**Validates: Requirements 2.7**

Property 7: BUG-05 — Auto-end timer is scheduled on class start

_For any_ transition to LIVE status where `lc.duration` is non-null and greater than zero, the fixed code SHALL register a timer in `autoEndTimers` and SHALL cancel any pre-existing timer for the same `liveClassId` before registering the new one.

**Validates: Requirements 2.8, 2.9**

Property 8: BUG-06 — Enrollment check gates student join

_For any_ `joinLiveClass` call where `req.user.role === 'STUDENT'` and no active `Enrollment` record exists for `(student.userId = req.user.id, classId = lc.classId, isActive = true)`, the fixed function SHALL return a 403 response before creating a participant record.

**Validates: Requirements 2.10, 2.11**

Property 9: PERF-05 — At most one reconnect timer is active at a time

_For any_ sequence of `ConnectionState.Disconnected` events of length N ≥ 1, the fixed `connectLiveKit` callback SHALL ensure that at most one reconnect timer is alive at any point, by cancelling the previous `reconnectTimerRef.current` before calling `setTimeout`.

**Validates: Requirements 2.12**

Property 10: SEC-06 — Snapshot payload size is bounded

_For any_ draw event where `event.type === 'snapshot'` and `event.dataUrl.length > 200_000`, the fixed `broadcastDraw` function SHALL return a 413 error and SHALL NOT write the payload to Redis. For payloads within the limit, behaviour is unchanged.

**Validates: Requirements 2.13**

Property 11: SEC-07 — Poll vote identity is always req.user.id

_For any_ poll vote event, regardless of what `userId` value is included in the request body, the fixed `broadcastPoll` function SHALL use `req.user.id` for both the duplicate-vote check and the vote record in the poll state.

**Validates: Requirements 2.14**

Property 12: PLAT-02 — Screen share button hidden when API unavailable

_For any_ render where `navigator.mediaDevices?.getDisplayMedia` is falsy, the fixed `LiveClassRoomImpl` SHALL not render the screen share button, regardless of the `screenShareEnabled` flag value.

**Validates: Requirements 2.15**

---

## Fix Implementation

### Changes Required

#### File: `backend/src/controllers/live-class.controller.js`

**BUG-01 — LiveKit RoomServiceClient for kick eviction**

1. Update the `require` at the top to destructure `RoomServiceClient`:
   ```js
   const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
   ```
2. Add a lazy factory function below the imports:
   ```js
   function getLivekitRoomService() {
     const url    = process.env.LIVEKIT_URL;
     const key    = process.env.LIVEKIT_API_KEY;
     const secret = process.env.LIVEKIT_API_SECRET;
     if (!url || !key || !secret) return null;
     return new RoomServiceClient(url, key, secret);
   }
   ```
3. In `kickParticipant`, after the DB update and before the success response, add:
   ```js
   const svc = getLivekitRoomService();
   if (svc && lc.livekitRoomName) {
     await svc.removeParticipant(lc.livekitRoomName, userId).catch(err =>
       logger.warn(`[kick] LiveKit eviction failed for ${userId}: ${err.message}`)
     );
   }
   ```
   The kick is recorded in the DB regardless of whether LiveKit eviction succeeds (best-effort).

**BUG-02 — School isolation helper**

4. Add the helper function near the top of the file (after imports, before action functions):
   ```js
   function assertSchoolAccess(lc, user) {
     if (user.role === 'SUPER_ADMIN') return;
     if (lc.schoolId !== user.schoolId) {
       const err = new Error('Access denied to this school\'s resource');
       err.status = 403;
       throw err;
     }
   }
   ```
5. Call `assertSchoolAccess(lc, req.user)` in every action function immediately after the `prisma.liveClass.findFirst` result is confirmed non-null. Affected functions: `getLiveClass`, `updateLiveClass`, `deleteLiveClass`, `startLiveClass`, `endLiveClass`, `joinLiveClass`, `leaveLiveClass`, `getLiveKitToken`, `getParticipants`, `muteParticipant`, `muteAll`, `unmuteAll`, `lowerAllHands`, `kickParticipant`, `raiseHand`, `lowerHand`, `approveHand`, `rejectHand`, `getHandQueue`, `sendMessage`, `getMessages`, `deleteMessage`, `getAttendance`, `requestSpeak`, `toggleOpenMic`, `startRecording`, `stopRecording`, `broadcastPoll`, `getPollState`, `broadcastDraw`, `getWhiteboardState`, `broadcastQuranPosition`, `uploadCoverImage`.
   - For functions that do not perform a `findFirst` (e.g., `getParticipants`, `getHandQueue`), add the `findFirst` call first so the check can be applied.
   - The thrown error propagates via `next(e)` to the global `errorHandler` middleware, which reads `err.status` to set the HTTP status code.

**BUG-05 — Auto-end timer registry**

6. Add module-level timer registry and helper functions after the imports:
   ```js
   // NOTE: In-process only — timers are lost on server restart.
   // For multi-process / Kubernetes deployments, replace with a Redis-backed scheduler.
   const autoEndTimers = new Map(); // liveClassId → NodeJS.Timeout

   function scheduleAutoEnd(liveClassId, startedAt, durationMinutes) {
     cancelAutoEnd(liveClassId);
     const elapsed = Date.now() - new Date(startedAt).getTime();
     const delay   = Math.max(0, durationMinutes * 60_000 - elapsed);
     const timer   = setTimeout(async () => {
       autoEndTimers.delete(liveClassId);
       try {
         const lc = await prisma.liveClass.findFirst({
           where: { id: liveClassId, status: 'LIVE', deletedAt: null }
         });
         if (!lc) return;
         await _endLiveClassById(lc);
       } catch (err) {
         logger.warn(`[auto-end] Failed to auto-end class ${liveClassId}: ${err.message}`);
       }
     }, delay);
     autoEndTimers.set(liveClassId, timer);
   }

   function cancelAutoEnd(liveClassId) {
     const existing = autoEndTimers.get(liveClassId);
     if (existing) { clearTimeout(existing); autoEndTimers.delete(liveClassId); }
   }
   ```
7. Extract the core end logic from `endLiveClass` into `async function _endLiveClassById(lc)` so both the manual endpoint and the auto-end timer can call it.
8. Call `scheduleAutoEnd(lc.id, lc.startedAt || now, lc.duration)` at the end of `startLiveClass` (when `lc.duration` is non-null) and at the end of the auto-start block in `joinLiveClass`.
9. Call `cancelAutoEnd(lc.id)` at the start of `endLiveClass` before the DB work.

**BUG-06 — Enrollment check in joinLiveClass**

10. In `joinLiveClass`, after the `isTeacher` check and before the `maxParticipants` check, add:
    ```js
    if (!isTeacher) {
      const student = await prisma.student.findFirst({ where: { userId } });
      if (!student) return errorResponse(res, 'Student profile not found', 403);
      const enrolled = await prisma.enrollment.findFirst({
        where: { student: { userId }, classId: lc.classId, isActive: true },
      });
      if (!enrolled) return errorResponse(res, 'You are not enrolled in this class', 403);
    }
    ```
    The `student` variable found here can be reused later in the function for the attendance upsert (avoid double lookup).

**SEC-06 — Whiteboard snapshot size cap**

11. In `broadcastDraw`, before the Redis write, add:
    ```js
    if (event.type === 'snapshot' && event.dataUrl) {
      if (event.dataUrl.length > 200_000) {
        return errorResponse(res, 'Snapshot payload too large (max 200,000 characters)', 413);
      }
    }
    ```

**SEC-07 — Poll vote uses server identity**

12. In `broadcastPoll`, in the vote branch, replace all occurrences of `event.userId` with `req.user.id`:
    ```js
    // BEFORE:
    const already = o.votes.includes(event.userId);
    return { ...o, votes: already ? o.votes : [...o.votes, event.userId] };

    // AFTER:
    const already = o.votes.includes(req.user.id);
    return { ...o, votes: already ? o.votes : [...o.votes, req.user.id] };
    ```
    Also update the socket broadcast payload to include `userId: req.user.id` so other clients can update their local poll state.

---

#### File: `backend/src/app.js`

**BUG-03 — Fix speaking event to use socket.userId**

13. Replace the `liveclass:speaking` handler:
    ```js
    socket.on('liveclass:speaking', ({ liveClassId, speaking }) => {
      if (!liveClassId) return;
      if (!socketAllow('liveclass:speaking')) return;
      socket.to(`liveclass:${liveClassId}`).emit('liveclass:speaking', { userId, speaking });
    });
    ```
    Remove `userId: speakerId` from the destructure entirely — `socket.userId` (captured as `userId` at connection time) is always used.

**RT-02 — Fix video_changed event to use socket.userId**

14. Replace the `liveclass:video_changed` handler:
    ```js
    socket.on('liveclass:video_changed', ({ liveClassId, isVideoOn }) => {
      if (!liveClassId) return;
      if (!socketAllow('liveclass:video_changed')) return;
      socket.to(`liveclass:${liveClassId}`).emit('liveclass:video_changed', { userId, isVideoOn });
    });
    ```
    Remove `userId: vid` from the destructure entirely.

**RT-05 — DB participation check on socket room join**

15. Replace the `liveclass:join_room` handler with an async version:
    ```js
    socket.on('liveclass:join_room', async (liveClassId) => {
      if (!liveClassId || !userId) return;
      try {
        const participant = await prisma.liveClassParticipant.findFirst({
          where: { liveClassId, userId, isActive: true },
          select: { id: true },
        });
        if (!participant) return;
        socket.join(`liveclass:${liveClassId}`);
        logger.debug(`User ${userId} joined live class room liveclass:${liveClassId}`);
      } catch (err) {
        logger.warn(`[socket] liveclass:join_room check failed: ${err.message}`);
      }
    });
    ```

**BUG-04 — Host-only view mode change**

16. Replace the `liveclass:viewmode_changed` handler with an async version:
    ```js
    socket.on('liveclass:viewmode_changed', async ({ liveClassId, viewMode }) => {
      if (!liveClassId || !viewMode || !userId) return;
      try {
        const host = await prisma.liveClassParticipant.findFirst({
          where: { liveClassId, userId, isActive: true, role: 'HOST' },
          select: { id: true },
        });
        if (!host) return;
        io.to(`liveclass:${liveClassId}`).emit('liveclass:viewmode_changed', { liveClassId, viewMode });
        logger.debug(`Host ${userId} set live class ${liveClassId} viewMode to ${viewMode}`);
      } catch (err) {
        logger.warn(`[socket] liveclass:viewmode_changed check failed: ${err.message}`);
      }
    });
    ```

---

#### File: `frontend/src/components/live-class/LiveClassRoomImpl.tsx`

**PERF-05 — Fix reconnect timer accumulation**

17. Add a new ref alongside the existing refs at the top of `LiveClassRoomPage`:
    ```tsx
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    ```
18. In `connectLiveKit`, replace the broken cleanup-inside-callback pattern:
    ```tsx
    // BEFORE:
    if (s === ConnectionState.Disconnected && !isUnmounted.current) {
      const retryTimer = setTimeout(() => { connectLiveKitRef.current?.() }, 3000)
      return () => clearTimeout(retryTimer)
    }

    // AFTER:
    if (s === ConnectionState.Disconnected && !isUnmounted.current) {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null
        connectLiveKitRef.current?.()
      }, 3000)
    }
    ```
19. In the unmount cleanup `useEffect` (where `isUnmounted.current = true` is set), add:
    ```tsx
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    ```

**PLAT-02 — Screen share feature detection**

20. Add state and detection effect at the top of `LiveClassRoomPage`:
    ```tsx
    const [canScreenShare, setCanScreenShare] = useState(false)

    useEffect(() => {
      setCanScreenShare(typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia)
    }, [])
    ```
21. In the screen share button render condition, add `&& canScreenShare`:
    ```tsx
    {viewMode === 'video' && (isHost || lc.screenShareEnabled !== false) && canScreenShare && (
      <button onClick={toggleScreen} ...>
    ```
22. Update `toggleScreen` to guard against the API being unavailable:
    ```tsx
    const toggleScreen = async () => {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        toast({ title: '📵 Screen share not supported on this device', variant: 'destructive' })
        return
      }
      // ... existing logic unchanged
    }
    ```

**Cosmetic cleanup (BUG-03 / RT-02 frontend side)**

23. In `LiveClassRoomImpl.tsx`, remove `userId` from the payload of `liveclass:speaking` and `liveclass:video_changed` emits (the server now ignores it). This is cosmetic — it does not block the fix.

---

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach:
1. **Exploratory** — run tests against the unfixed code to surface counterexamples that confirm each bug's root cause.
2. **Fix + Preservation checking** — after implementing each fix, run both the fix tests and the preservation tests to confirm correct behaviour and no regressions.

---

### Exploratory Bug Condition Checking

**Goal**: Demonstrate each bug on the unfixed code to confirm the root cause analysis.

**Test Cases:**

1. **BUG-01 Exploration**: Call `kickParticipant` with a mock `RoomServiceClient`. Assert `removeParticipant` is never called on unfixed code. *(will fail on unfixed code — confirms bug)*
2. **BUG-02 Exploration**: Call `getLiveClass` with `req.user.schoolId = "school-b"` against a class with `schoolId = "school-a"`. Assert response is 403. *(will return 200 on unfixed code — confirms IDOR)*
3. **BUG-03 Exploration**: Emit `liveclass:speaking` with `{ userId: "victim", speaking: true }` from a socket with `socket.userId = "attacker"`. Assert relayed event has `userId = "victim"`. *(will pass on unfixed code — confirms injection)*
4. **RT-05 Exploration**: Emit `liveclass:join_room` from a user with no participant record. Assert socket is added to the room. *(will pass on unfixed code — confirms unauthenticated join)*
5. **BUG-04 Exploration**: Emit `liveclass:viewmode_changed` from a non-host socket. Assert event is broadcast. *(will pass on unfixed code — confirms privilege escalation)*
6. **BUG-06 Exploration**: Call `joinLiveClass` as a student with no enrollment. Assert response is 403. *(will return 200 on unfixed code — confirms bypass)*
7. **SEC-07 Exploration**: Submit two poll votes with different `event.userId` values. Assert both are recorded. *(will pass on unfixed code — confirms identity spoofing)*

**Expected Counterexamples:**
- BUG-02: 200 response returned for cross-school access instead of 403.
- BUG-03: Relayed event contains injected victim userId instead of attacker's socket.userId.
- RT-05: Socket joins room without DB check.
- BUG-04: View mode change broadcast from non-host socket.
- BUG-06: Student without enrollment successfully joins class.

---

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behaviour.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedFunction(input)
  ASSERT expectedBehavior(result)
END FOR
```

**Test Cases per Bug:**

- **BUG-01**: Mock `RoomServiceClient`. Call `kickParticipant`. Assert `removeParticipant` is called with `(lc.livekitRoomName, userId)`. Assert DB update and socket emit still occur.
- **BUG-02**: Generate combinations of `(lc.schoolId, user.schoolId, user.role)`. Assert every case where `schoolId !== match AND role !== SUPER_ADMIN` returns 403. Assert SUPER_ADMIN always passes.
- **BUG-03**: Emit `liveclass:speaking` with arbitrary injected `userId`. Assert relayed event always contains `socket.userId`.
- **RT-05**: Emit `liveclass:join_room` with no active participant record. Assert socket is NOT in the room after the event.
- **RT-02**: Emit `liveclass:video_changed` with arbitrary injected `userId`. Assert relayed event always contains `socket.userId`.
- **BUG-04**: Emit `liveclass:viewmode_changed` from non-host. Assert event is not broadcast.
- **BUG-05**: Mock `setTimeout`/`clearTimeout`. Call `startLiveClass` with `duration = 60`. Assert `autoEndTimers.has(lc.id)` is true. Call `endLiveClass`. Assert `autoEndTimers.has(lc.id)` is false.
- **BUG-06**: Call `joinLiveClass` as a student with no enrollment. Assert 403 with message "You are not enrolled in this class".
- **PERF-05**: Trigger disconnect event 3 times. Assert `reconnectTimerRef.current` has only one live timer after all 3 events.
- **SEC-06**: Send snapshot with `dataUrl.length = 200_001`. Assert 413 response. Assert Redis `set` is not called.
- **SEC-07**: Submit vote with `event.userId = "other-user"` as user `req.user.id = "me"`. Assert stored vote has `userId = "me"`. Submit second request with same `req.user.id`. Assert duplicate vote rejected.
- **PLAT-02**: Render with `navigator.mediaDevices.getDisplayMedia = undefined` and `screenShareEnabled = true`. Assert screen share button is absent from the DOM.

---

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, behaviour is unchanged.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalFunction(input) = fixedFunction(input)
END FOR
```

**Testing Approach**: Property-based testing is used for BUG-02, RT-05, BUG-04, BUG-06, SEC-06, and SEC-07 because they have clear input domains that can be exhaustively sampled. Unit tests suffice for the others.

**Test Cases:**

- **BUG-01 Preservation**: Call `leaveLiveClass`. Assert `RoomServiceClient.removeParticipant` is NOT called. Assert DB and socket behaviour unchanged.
- **BUG-02 Preservation** *(property)*: Generate random `(lc.schoolId, user.schoolId, user.role)` where `schoolId === match OR role === SUPER_ADMIN`. Assert all requests proceed as before (not rejected).
- **BUG-03 Preservation**: Emit `liveclass:speaking` with the speaker's own correct userId, or no userId at all. Assert relay is correct and no event is dropped.
- **RT-05 Preservation**: Emit `liveclass:join_room` for a user with an active participant record. Assert socket is added to the room normally.
- **RT-02 Preservation**: Emit `liveclass:video_changed` from a legitimate sender. Assert relay is correct.
- **BUG-04 Preservation**: Emit `liveclass:viewmode_changed` from the actual host. Assert event is broadcast to all participants.
- **BUG-05 Preservation**: Start a class with `duration = null`. Assert no timer is registered. Manually end any class. Assert the `endLiveClass` logic completes normally.
- **BUG-06 Preservation**: Call `joinLiveClass` as an enrolled student. Assert join succeeds normally. Call `joinLiveClass` as a teacher. Assert join succeeds (enrollment check skipped).
- **PERF-05 Preservation**: Trigger a single disconnect event. Assert one reconnect timer fires after 3s and calls `connectLiveKitRef.current?.()`. Assert unmount cancels the timer.
- **SEC-06 Preservation** *(property)*: Generate random `dataUrl` strings with `length ≤ 200_000`. Assert all are written to Redis. Generate random non-snapshot draw events. Assert no size check is applied.
- **SEC-07 Preservation** *(property)*: Generate first-time vote requests. Assert all are accepted regardless of `event.userId`. Assert stored voter identity always equals `req.user.id`.
- **PLAT-02 Preservation**: Render with `getDisplayMedia` available. Assert button is rendered. Render with `screenShareEnabled = false`. Assert button is hidden.

---

### Unit Tests

- `assertSchoolAccess`: called with matching schoolId → no throw; mismatched schoolId and non-SUPER_ADMIN → throws 403; SUPER_ADMIN + mismatched → no throw.
- `getLivekitRoomService`: missing env vars → returns null; all vars present → returns `RoomServiceClient` instance.
- `kickParticipant`: with mock SFU → `removeParticipant` called; SFU returns error → kick still succeeds (best-effort).
- `scheduleAutoEnd` / `cancelAutoEnd`: duration class → timer registered; `cancelAutoEnd` clears it; `duration = null` → no timer.
- `_endLiveClassById`: same assertions as current `endLiveClass` tests — participants marked inactive, attendance updated, socket emitted.
- `broadcastDraw` (snapshot size): `dataUrl.length = 200_000` → passes; `dataUrl.length = 200_001` → 413.
- `broadcastPoll` (vote identity): `event.userId` ignored, `req.user.id` used for dedup and storage.
- `reconnectTimerRef`: single disconnect → one timer; three disconnects → timer cancelled and reset on each; unmount → timer cleared.
- `canScreenShare` state: `getDisplayMedia` present → `true`; absent → `false`; `screenShareEnabled = false` → button hidden regardless.

### Property-Based Tests

- **BUG-02 school isolation** (jest-fast-check or similar): Generate tuples of `(lc.schoolId: string, user.schoolId: string, user.role: UserRole)`. Property: `assertSchoolAccess` throws iff `role !== 'SUPER_ADMIN' && lc.schoolId !== user.schoolId`.
- **RT-05 participation guard** (fast-check): Generate `(liveClassId: string, userId: string, hasActiveRecord: boolean)`. Property: socket join occurs iff `hasActiveRecord === true`.
- **BUG-04 host-only relay** (fast-check): Generate `(userId: string, role: 'HOST' | 'STUDENT' | 'OBSERVER', isActive: boolean)`. Property: event is relayed iff `role === 'HOST' && isActive === true`.
- **BUG-06 enrollment guard** (fast-check): Generate `(userRole: string, hasEnrollment: boolean)`. Property: 403 returned iff `userRole === 'STUDENT' && !hasEnrollment`.
- **SEC-06 snapshot cap** (fast-check): Generate `dataUrl: string` with arbitrary length. Property: 413 returned iff `dataUrl.length > 200_000`.
- **SEC-07 vote identity** (fast-check): Generate `(reqUserId: string, eventUserId: string)`. Property: stored voter identity always equals `reqUserId`.

### Integration Tests

- Full kick flow: teacher joins → student joins → teacher calls kick → assert `removeParticipant` called → assert student's subsequent `getLiveKitToken` call returns 403 (not an active participant).
- Cross-school IDOR: create two schools, one class each, one live class each → user from school A calls endpoints for school B's live class → assert all return 403.
- Auto-end flow: start class with `duration = 1` minute → wait for timer to fire (use fake timers in tests) → assert class status is `ENDED`, participants marked inactive, `liveclass:ended` emitted.
- Enrollment join gate: create class, enroll one student, not enroll another → non-enrolled student join → 403; enrolled student join → 200.
- Socket integrity: user without participant record emits `liveclass:join_room` → assert they do NOT receive subsequent `liveclass:message` events; legitimate participant → does receive events.
