# Bugfix Requirements Document

## Introduction

This document covers 11 confirmed bugs found during a production-readiness audit of the HALQA platform's Live Class / Live Video feature. The bugs span three files: `backend/src/controllers/live-class.controller.js`, `backend/src/app.js`, and `frontend/src/components/live-class/LiveClassRoomImpl.tsx`.

The issues range from critical security vulnerabilities (cross-school data access, identity spoofing, unauthenticated room access) to reliability problems (timer accumulation, missing auto-end enforcement, enrollment bypass) and hardening gaps (unbounded Redis writes, client-trusted vote identity, unsupported API calls on mobile).

No database migrations or API contract changes are required. All fixes are confined to the three files listed above.

### Glossary

- **LiveKit SFU** — the Selective Forwarding Unit that routes audio/video streams between participants
- **RoomServiceClient** — the LiveKit Server SDK class for administrative room operations (not used today)
- **IDOR** — Insecure Direct Object Reference; accessing a resource by ID without ownership check
- **Socket.IO room** — a named channel that a socket can join to receive broadcast events
- **socket.userId** — the server-verified user ID attached to a socket by the JWT authentication middleware on connection

---

## Bug Analysis

### Current Behavior (Defect)

**BUG-01** — 1.1 WHEN a host calls `kickParticipant` for a live class participant THEN the system marks `isActive: false` in the database and emits `liveclass:you_were_kicked` via Socket.IO but does NOT remove the participant from the LiveKit SFU room, leaving them able to continue receiving audio and video streams.

**BUG-02** — 1.2 WHEN any authenticated user calls `joinLiveClass`, `getLiveKitToken`, `sendMessage`, `muteParticipant`, `kickParticipant`, `raiseHand`, `lowerHand`, `approveHand`, `rejectHand`, `getHandQueue`, or `getMessages` with the ID of a live class belonging to a different school THEN the system processes the request without verifying school membership, allowing cross-school data access and action execution.

**BUG-03** — 1.3 WHEN the `liveclass:speaking` socket event is received THEN the system relays `speakerId` from the client-supplied payload (`userId` field) rather than the server-verified `socket.userId`, allowing any client to set `userId` to an arbitrary victim's ID and make all other participants' UIs display that victim as currently speaking.

**RT-05** — 1.4 WHEN any authenticated socket emits `liveclass:join_room` with any `liveClassId` THEN the system adds the socket to the `liveclass:{liveClassId}` room unconditionally, without verifying the user has an active participant record, allowing them to receive all room events (mute changes, hand raises, chat messages, whiteboard strokes, poll votes).

**RT-02** — 1.5 WHEN the `liveclass:video_changed` socket event is received THEN the system relays the `userId` field from the client-supplied payload rather than `socket.userId`, allowing any client to corrupt another participant's video status badge.

**BUG-04** — 1.6 WHEN any socket in a live class room emits `liveclass:viewmode_changed` THEN the system broadcasts the new view mode to all participants regardless of whether the emitting socket belongs to the class host, allowing any student to force everyone to switch view modes.

**BUG-05** — 1.7 WHEN a live class has `startedAt` set and a non-null `duration` (in minutes) configured THEN the system never ends the class automatically when `startedAt + duration` minutes have elapsed — no background job, cron, or scheduled task exists.

**BUG-06** — 1.8 WHEN a student calls `joinLiveClass` THEN the system checks only that the class exists, is not ended, and is within participant limit — it does NOT verify the student has an active `Enrollment` record for `liveClass.classId`.

**PERF-05** — 1.9 WHEN the LiveKit connection state oscillates to `Disconnected` multiple times in `LiveClassRoomImpl.tsx` THEN multiple `setTimeout` reconnect timers accumulate because the cleanup is returned inside a `room.on(...)` callback rather than from a `useEffect`, meaning previous timers are never cancelled.

**SEC-06** — 1.10 WHEN `broadcastDraw` receives a draw event with `type === 'snapshot'` THEN the system stores `event.dataUrl` in Redis with no size validation, allowing a malicious host to send arbitrarily large strings and exhaust Redis memory.

**SEC-07** — 1.11 WHEN `broadcastPoll` processes a vote event THEN the system uses `event.userId` from the request body to check for duplicate votes, allowing a student to bypass the duplicate-vote guard by submitting requests with different `userId` values.

**PLAT-02** — 1.12 WHEN a user on iOS or mobile Chrome views a live class with `screenShareEnabled: true` THEN the screen share button is rendered and interactive even though `navigator.mediaDevices.getDisplayMedia` is not supported on those platforms, causing an unhandled error.

---

### Expected Behavior (Correct)

**BUG-01** — 2.1 WHEN a host calls `kickParticipant` for a live class participant THEN the system SHALL call `RoomServiceClient.removeParticipant(roomName, participantIdentity)` via the LiveKit Server SDK to forcibly terminate the participant's SFU connection, in addition to the existing database update and socket notification.

**BUG-02** — 2.2 WHEN any authenticated user (who is not `SUPER_ADMIN`) calls any individual live class action endpoint THEN the system SHALL assert `liveClass.schoolId === req.user.schoolId` and return a 403 error if the check fails, before any data is read or written.

**BUG-02** — 2.3 WHEN a `SUPER_ADMIN` user calls any individual live class action endpoint THEN the system SHALL skip the school isolation check and allow the action.

**BUG-03** — 2.4 WHEN the `liveclass:speaking` socket event is received THEN the system SHALL use `socket.userId` (set by JWT authentication middleware) as the speaker identity in the relayed event, ignoring any `userId` field from the client payload.

**RT-05** — 2.5 WHEN a socket emits `liveclass:join_room` THEN the system SHALL query the database to verify an active `LiveClassParticipant` record exists for `(liveClassId, socket.userId)` before adding the socket to the room, and SHALL silently ignore the join if no such record exists.

**RT-02** — 2.6 WHEN the `liveclass:video_changed` socket event is received THEN the system SHALL use `socket.userId` as the identity in the relayed event, ignoring any `userId` field from the client payload.

**BUG-04** — 2.7 WHEN a socket emits `liveclass:viewmode_changed` THEN the system SHALL verify that `socket.userId` corresponds to a HOST participant of the specified live class before relaying the event, and SHALL silently drop the event if the sender is not the host.

**BUG-05** — 2.8 WHEN `startLiveClass` or `joinLiveClass` transitions a class to `LIVE` status with a non-null `duration` THEN the system SHALL schedule a background timer to automatically invoke the `endLiveClass` logic when `startedAt + duration` minutes have elapsed.

**BUG-05** — 2.9 WHEN a live class with a scheduled auto-end is manually ended by the host before the timer fires THEN the system SHALL cancel the pending auto-end timer so it does not trigger after the class has already ended.

**BUG-06** — 2.10 WHEN a student (role `STUDENT`) calls `joinLiveClass` THEN the system SHALL verify an active `Enrollment` record exists (`isActive: true`) for the student's user ID linked to `liveClass.classId` and SHALL return a 403 error if no such enrollment exists.

**BUG-06** — 2.11 WHEN a user with role `TEACHER`, `SCHOOL_ADMIN`, or `SUPER_ADMIN` calls `joinLiveClass` THEN the system SHALL skip the enrollment check and allow them to join as before.

**PERF-05** — 2.12 WHEN the LiveKit connection state changes to `Disconnected` THEN the system SHALL store the reconnect timer ID in a `useRef` and SHALL cancel any previously pending reconnect timer before starting a new one, ensuring at most one reconnect attempt is in-flight at any time.

**SEC-06** — 2.13 WHEN `broadcastDraw` receives a snapshot draw event THEN the system SHALL reject the request with a 400 error if `event.dataUrl` exceeds 200,000 characters, and SHALL NOT write the payload to Redis.

**SEC-07** — 2.14 WHEN `broadcastPoll` processes a vote event THEN the system SHALL use `req.user.id` (the server-verified identity) as the voter identity for both the duplicate-vote check and the vote record, ignoring any `userId` field in the request body.

**PLAT-02** — 2.15 WHEN rendering the screen share button THEN the system SHALL check for `navigator.mediaDevices?.getDisplayMedia` availability and SHALL hide or disable the button on platforms where the API is not supported.

---

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a participant voluntarily leaves a live class via `leaveLiveClass` THEN the system SHALL CONTINUE TO mark `isActive: false` in the database and emit `liveclass:user_left` without calling `removeParticipant`.

3.2 WHEN the host ends a live class via `endLiveClass` THEN the system SHALL CONTINUE TO mark all participants inactive and emit `liveclass:ended` as before.

3.3 WHEN `listLiveClasses` is called THEN the system SHALL CONTINUE TO filter results by `req.user.schoolId` for non-`SUPER_ADMIN` users as it does today.

3.4 WHEN a user with the correct `schoolId` calls any live class action endpoint THEN the system SHALL CONTINUE TO process the request as before.

3.5 WHEN a legitimate participant emits `liveclass:speaking` with their own correct identity THEN the system SHALL CONTINUE TO relay the speaking indicator to all other room participants.

3.6 WHEN a user who has properly joined via the REST endpoint emits `liveclass:join_room` THEN the system SHALL CONTINUE TO add their socket to the room and they SHALL CONTINUE TO receive all live class room events.

3.7 WHEN a participant legitimately toggles their video THEN the system SHALL CONTINUE TO relay the `liveclass:video_changed` event with the correct video state to all other room participants.

3.8 WHEN the actual host of a live class emits `liveclass:viewmode_changed` THEN the system SHALL CONTINUE TO broadcast the view mode change to all participants in the room.

3.9 WHEN a live class has `duration = null` THEN the system SHALL CONTINUE TO run indefinitely until the host manually ends it.

3.10 WHEN a live class is manually ended by the host THEN the system SHALL CONTINUE TO process `endLiveClass` exactly as it does today (mark participants inactive, update attendance, emit `liveclass:ended`).

3.11 WHEN an enrolled student calls `joinLiveClass` THEN the system SHALL CONTINUE TO add them as a participant and return the participant record as before.

3.12 WHEN the participant limit is reached THEN the system SHALL CONTINUE TO reject the join with a 403 error regardless of enrollment status.

3.13 WHEN the LiveKit connection drops and reconnect is triggered THEN the system SHALL CONTINUE TO attempt to reconnect after a 3-second delay by calling `connectLiveKitRef.current?.()`.

3.14 WHEN the component is unmounted THEN the system SHALL CONTINUE TO skip the reconnect attempt and cancel any pending timers.

3.15 WHEN a snapshot draw event with a `dataUrl` within the 200,000-character limit is received THEN the system SHALL CONTINUE TO store it in Redis and broadcast it to room participants as before.

3.16 WHEN non-snapshot draw events (pen strokes, clears, shape events) are received THEN the system SHALL CONTINUE TO process them without any size restriction change.

3.17 WHEN a student votes in a poll for the first time THEN the system SHALL CONTINUE TO record their vote and broadcast the updated poll state to the room.

3.18 WHEN a student attempts to vote a second time using the same verified identity THEN the system SHALL CONTINUE TO reject the duplicate vote.

3.19 WHEN a user on a desktop browser with `getDisplayMedia` support views a live class with `screenShareEnabled: true` THEN the screen share button SHALL CONTINUE TO be visible and functional.

3.20 WHEN `screenShareEnabled` is `false` THEN the system SHALL CONTINUE TO hide the screen share button regardless of platform.
