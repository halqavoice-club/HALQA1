# Realtime Event Catalog — Complete Socket.IO Event Reference

**Audit date:** 2026-08-26  
**Source:** `backend/src/app.js`, all backend controllers  
**Rule:** Read-only audit. No code modified.

Direction key:
- `C→S` — client emits, server receives
- `S→C` — server emits, client receives
- `S→room` — server emits to all sockets in a room

---

## Voice Club Events

### Room Lifecycle

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `voice:room_created` | S→room | `voice:lobby` + `school:{schoolId}` | full room object | `voice.controller.js: createRoom` |
| `voice:room_updated` | S→room | `voice:{roomId}` + `voice:lobby` + `school:{schoolId}` | partial room fields | `voice.controller.js: updateRoom` |
| `voice:room_deleted` | S→room | `voice:lobby` + `school:{schoolId}` | `{ roomId }` | `voice.controller.js: deleteRoom` |
| `voice:room_ended` | S→room | `voice:{roomId}` | `{ roomId }` | `voice.controller.js: endRoom` |
| `voice:status_changed` | S→room | `voice:{roomId}` | `{ roomId, status }` | `voice.controller.js: joinRoom` (when IDLE→LIVE) |

### Participant Lifecycle

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `voice:user_joined` | S→room | `voice:{roomId}` | `{ roomId, userId, role, isMuted, user }` | `voice.controller.js: joinRoom` |
| `voice:user_left` | S→room | `voice:{roomId}` | `{ roomId, userId }` | `voice.controller.js: leaveRoom` |
| `voice:kicked` | S→room + S→user | `voice:{roomId}` + `user:{kicked}` | `{ roomId, userId }` / `{ roomId }` | `voice.controller.js: kickParticipant` |
| `voice:banned` | S→user | `user:{banned}` | `{ roomId, reason }` | `voice.controller.js: banParticipant` |
| `voice:join_room` | C→S | server | `roomId` | client (verified against DB) |
| `voice:leave_room` | C→S | server | `roomId` | client |

### Role Events

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `voice:role_changed` | S→room | `voice:{roomId}` | `{ roomId, userId, role }` | multiple controllers |
| `voice:your_role_changed` | S→user | `user:{userId}` | `{ roomId, role }` | `voice.controller.js: promoteParticipant` |
| `voice:you_are_moderator` | S→user | `user:{userId}` | `{ roomId, message }` | `voice-roles.controller.js: assignModerator` |
| `voice:moderator_assigned` | S→room | `voice:{roomId}` | `{ roomId, userId, firstName, lastName, avatarUrl }` | `voice-roles.controller.js` |
| `voice:moderator_removed` | S→room + S→user | `voice:{roomId}` + `user:{userId}` | `{ roomId, userId }` | `voice-roles.controller.js` |
| `voice:admin_transferred` | S→room | `voice:{roomId}` | `{ roomId, newHostId, prevHostId, newHostName }` | `voice-roles.controller.js` |
| `voice:you_are_host` | S→user | `user:{userId}` | `{ roomId, message }` | `voice-roles.controller.js` |
| `voice:promoted_to_speaker` | S→user | `user:{userId}` | `{ roomId, message }` | `voice-queue.controller.js: approveUser` |

### Audio / Mic Events

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `voice:speaking` | C→S | server | `{ roomId, speaking }` | client (relayed from LiveKit ActiveSpeakersChanged) |
| `voice:speaking` | S→room | `voice:{roomId}` | `{ userId, speaking }` | `app.js` relay (socket room membership = auth) |
| `voice:mute_changed` | S→room | `voice:{roomId}` | `{ roomId, userId, isMuted }` | `voice.controller.js`, `voice-roles.controller.js` |
| `voice:mic_lock_changed` | S→room | `voice:{roomId}` | `{ roomId, micLocked, changedBy }` | `voice.controller.js: toggleMicLock` |
| `voice:open_mic_changed` | S→room | `voice:{roomId}` | `{ roomId, isOpenMic, changedBy }` | `voice.controller.js: toggleOpenMic` |
| `voice:mic_grabbed` | S→room | `voice:{roomId}` | `{ roomId, userId, firstName, lastName }` | `voice.controller.js: grabMic` |
| `voice:seat_lock_changed` | S→room | `voice:{roomId}` | `{ roomId, seatIndex, ... }` | `voice.controller.js: toggleSeatLock` |

### Mic Pass Events

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `voice:mic_offer` | S→user | `user:{targetUserId}` | `{ offerId, roomId, ... }` | `voice-mic.controller.js: sendMicOffer` |
| `voice:mic_passed` | S→room | `voice:{roomId}` | `{ roomId, passerId, ... }` | `voice-mic.controller.js: acceptMicOffer` |
| `voice:mic_received` | S→user | `user:{acceptorId}` | `{ roomId, message }` | `voice-mic.controller.js: acceptMicOffer` |
| `voice:mic_declined` | S→user | `user:{passerId}` | `{ roomId, targetId }` | `voice-mic.controller.js: declineMicOffer` |
| `voice:mic_offer_cancelled` | S→user | `user:{targetId}` | `{ roomId, offerId }` | `voice-mic.controller.js: cancelMicOffer` |

### Speaker Queue Events

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `voice:hand_raised` | S→room | `voice:{roomId}` | `{ roomId, userId, raised, firstName, lastName }` | `voice-queue.controller.js`, `voice.controller.js` |
| `voice:queue_position` | S→user | `user:{userId}` | `{ roomId, position }` | `voice-queue.controller.js` |
| `voice:queue_updated` | S→room | `voice:{roomId}` | `{ roomId, queue, queueLength }` | `voice-queue.controller.js` |
| `voice:queue_rejected` | S→user | `user:{targetUserId}` | `{ roomId, message }` | `voice-queue.controller.js: rejectUser` |

### Chat and Reactions

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `voice:message` | S→room | `voice:{roomId}` | `{ roomId, message }` | `voice.controller.js: sendMessage` |
| `voice:message_deleted` | S→room | `voice:{roomId}` | `{ roomId, msgId, deletedBy }` | `voice.controller.js: deleteMessage` |
| `voice:reaction` | C→S | server | `{ roomId, emoji }` | client |
| `voice:reaction` | S→room | `voice:{roomId}` | `{ userId, emoji }` | `app.js` relay |
| `voice:speaker_pinned` | S→room | `voice:{roomId}` | `{ roomId, userId, isPinned, firstName, lastName, pinnedBy }` | `voice-roles.controller.js: pinSpeaker` |

### Gift Events (Voice)

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `gift:sent` | S→room | `voice:{roomId}` (universal) | full gift payload | `gift.controller.js: sendGift` |
| `voice:gift_sent` | S→room | `voice:{roomId}` | same payload | `gift.controller.js` (backward compat alias) |
| `voice:gift_all` | S→room | `voice:{roomId}` | same payload | `gift.controller.js: sendGiftToAll` |
| `voice:premium_gift` | S→room | `voice:{roomId}` | same payload | `gift.controller.js` (premium gifts only) |
| `gift:received` | S→user | `user:{receiverId}` | gift payload + newDiamondBalance | `gift.controller.js` |

---

## Live Class Events

### Lifecycle

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `liveclass:scheduled` | S→room | `school:{schoolId}` or `feed:public` | `{ liveClass }` | `live-class.controller.js: createLiveClass` |
| `liveclass:started` | S→room | `school:{schoolId}` + `class:{classId}` + `feed:public` | `{ liveClassId, title, classId }` | `live-class.controller.js: startLiveClass` / `joinLiveClass` (auto-start) |
| `liveclass:updated` | S→room | `liveclass:{id}` | `{ liveClass }` | `live-class.controller.js: updateLiveClass` |
| `liveclass:ended` | S→room | `liveclass:{id}` | `{ liveClassId }` | `live-class.controller.js: endLiveClass` |
| `liveclass:recording_started` | S→room | `liveclass:{id}` | `{ liveClassId }` | `live-class.controller.js: startRecording` |
| `liveclass:recording_stopped` | S→room | `liveclass:{id}` | `{ liveClassId, recordingUrl }` | `live-class.controller.js: stopRecording` |

### Participant Lifecycle

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `liveclass:user_joined` | S→room | `liveclass:{id}` | `{ liveClassId, userId, role, user }` | `live-class.controller.js: joinLiveClass` |
| `liveclass:user_left` | S→room | `liveclass:{id}` | `{ liveClassId, userId }` | `live-class.controller.js: leaveLiveClass` |
| `liveclass:kicked` | S→room | `liveclass:{id}` | `{ liveClassId, userId }` | `live-class.controller.js: kickParticipant` |
| `liveclass:you_were_kicked` | S→user | `user:{kicked}` | `{ liveClassId }` | `live-class.controller.js: kickParticipant` |
| `liveclass:join_room` | C→S | server | `liveClassId` | client (verified against DB) |
| `liveclass:leave_room` | C→S | server | `liveClassId` | client |

### Audio / Video State

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `liveclass:mute_changed` | S→room | `liveclass:{id}` | `{ liveClassId, userId, isMuted }` | `live-class.controller.js: muteParticipant` |
| `liveclass:mute_all` | S→room | `liveclass:{id}` | `{ liveClassId }` | `live-class.controller.js: muteAll` |
| `liveclass:unmute_all` | S→room | `liveclass:{id}` | `{ liveClassId }` | `live-class.controller.js: unmuteAll` |
| `liveclass:you_can_speak` | S→user | `user:{userId}` | `{ liveClassId }` | `live-class.controller.js: approveHand` |
| `liveclass:open_mic_changed` | S→room | `liveclass:{id}` | `{ liveClassId, isOpenMic }` | `live-class.controller.js: toggleOpenMic` |
| `liveclass:speaking` | C→S | server | `{ liveClassId, speaking }` | client relay (rate-limited, userId from socket) |
| `liveclass:speaking` | S→room | `liveclass:{id}` | `{ userId, speaking }` | `app.js` relay |
| `liveclass:video_changed` | C→S | server | `{ liveClassId, isVideoOn }` | client relay |
| `liveclass:video_changed` | S→room | `liveclass:{id}` | `{ userId, isVideoOn }` | `app.js` relay |
| `liveclass:viewmode_changed` | C→S | server | `{ liveClassId, viewMode }` | client (HOST only — DB-verified) |
| `liveclass:viewmode_changed` | S→room | `liveclass:{id}` | `{ liveClassId, viewMode }` | `app.js` relay (after HOST check) |

### Hand Raise

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `liveclass:hand_raised` | S→room | `liveclass:{id}` | `{ liveClassId, userId, firstName, lastName }` | `live-class.controller.js: raiseHand` |
| `liveclass:hand_lowered` | S→room | `liveclass:{id}` | `{ liveClassId, userId }` | `live-class.controller.js: lowerHand` |
| `liveclass:all_hands_lowered` | S→room | `liveclass:{id}` | `{ liveClassId }` | `live-class.controller.js: lowerAllHands` |
| `liveclass:hand_approved` | S→room | `liveclass:{id}` | `{ liveClassId, userId }` | `live-class.controller.js: approveHand` |
| `liveclass:hand_rejected` | S→room | `liveclass:{id}` | `{ liveClassId, userId }` | `live-class.controller.js: rejectHand` |
| `liveclass:speak_request` | S→room | `liveclass:{id}` | `{ liveClassId, userId, firstName, lastName }` | `live-class.controller.js: requestSpeak` |

### Chat, Reactions, Screen Share

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `liveclass:message` | S→room | `liveclass:{id}` | message object | `live-class.controller.js: sendMessage` |
| `liveclass:reaction` | C→S | server | `{ liveClassId, emoji, targetUserId }` | client relay (rate-limited) |
| `liveclass:reaction` | S→room | `liveclass:{id}` | `{ userId, emoji, targetUserId }` | `app.js` (strips display names) |
| `liveclass:screen_share_started` | C→S | server | `{ liveClassId }` | client (DB-verified participation + permission) |
| `liveclass:screen_share_started` | S→room | `liveclass:{id}` | `{ liveClassId, userId }` | `app.js` relay |
| `liveclass:screen_share_stopped` | C→S | server | `{ liveClassId }` | client (DB-verified participation) |
| `liveclass:screen_share_stopped` | S→room | `liveclass:{id}` | `{ liveClassId, userId }` | `app.js` relay |

### Interactive Features

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `liveclass:whiteboard` | S→room | `liveclass:{id}` | whiteboard event | `live-class.controller.js: broadcastDraw` |
| `liveclass:poll` | S→room | `liveclass:{id}` | poll event | `live-class.controller.js: broadcastPoll` |
| `liveclass:quran_position` | S→room | `liveclass:{id}` | `{ surahNumber, ayahNumber }` | `live-class.controller.js: broadcastQuranPosition` |

### Gift Events (Live Class)

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `gift:sent` | S→room | `liveclass:{id}` (universal) | full gift payload | `gift.controller.js` |
| `liveclass:gift_sent` | S→room | `liveclass:{id}` | same payload | `gift.controller.js` (backward compat) |

---

## Feed Events

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `feed:join` | C→S | server | — | client (joins `feed:{userId}` + `feed:public`) |
| `feed:leave` | C→S | server | — | client |
| `feed:join:school` | C→S | server | `{ schoolId }` | client (⚠️ SUPER_ADMIN bypass present) |
| `feed:leave:school` | C→S | server | `{ schoolId }` | client |
| `liveclass:scheduled` | S→room | `feed:public` | `{ liveClass }` | PUBLIC stream creation |
| `liveclass:started` | S→room | `feed:public` | `{ liveClassId, title }` | PUBLIC stream start |

Feed broadcast events (post reactions, comments, etc.) are emitted to `feed:{userId}` by post controllers (not fully enumerated here — see `post.controller.js`).

---

## Direct Message Events

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `dm:message` | S→user | `user:{receiverId}` | `{ convId, message }` | `dm.controller.js: sendMessage` |
| `dm:delivered` | S→user | `user:{senderId}` | `{ convId, messageIds }` | `dm.controller.js: sendMessage` |
| `dm:read` | S→user | `user:{otherId}` | `{ convId, readBy, readAt }` | `dm.controller.js: markRead` |
| `dm:typing_start` | C→S | server | `{ convId, receiverId }` | client (rate-limited) |
| `dm:typing_start` | S→user | `user:{receiverId}` | `{ convId, userId }` | `app.js` relay |
| `dm:typing_stop` | C→S | server | `{ convId, receiverId }` | client |
| `dm:typing_stop` | S→user | `user:{receiverId}` | `{ convId, userId }` | `app.js` relay |

---

## Group Chat Events

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `group:join` | C→S | server | `convId` | client (DB-verified membership) |
| `group:leave` | C→S | server | `convId` | client |
| `group:typing_start` | C→S | server | `{ convId, name }` | client (relayed with server-verified userId) |
| `group:typing_start` | S→room | `conversation:{convId}` | `{ convId, userId, name }` | `app.js` relay |
| `group:typing_stop` | C→S | server | `{ convId }` | client |
| `group:typing_stop` | S→room | `conversation:{convId}` | `{ convId, userId }` | `app.js` relay |

Group message creation events emitted by `group-chat.controller.js` to `conversation:{convId}` (not fully enumerated).

---

## Community Events

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `community:join` | C→S | server | `communityId` | client (DB-verified membership + ban check) |
| `community:leave` | C→S | server | `communityId` | client |
| `community:join_rejected` | S→user | `user:{userId}` | `{ communityId, reason }` | `app.js` (not_found, banned, membership_required) |
| `community:updated` | S→room | `community:{id}` | `{ community }` | `community.controller.js` |
| `community:deleted` | S→room | `community:{id}` | `{ communityId }` | `community.controller.js` |
| `community:member_joined` | S→room | `community:{id}` | `{ communityId, user }` | `community.controller.js` |
| `community:member_left` | S→room | `community:{id}` | `{ communityId, userId }` | `community.controller.js` |
| `community:member_role_changed` | S→room | `community:{id}` | `{ communityId, userId, role }` | `community.controller.js` |
| `community:member_kicked` | S→room + S→user | `community:{id}` + `user:{kicked}` | `{ communityId, userId }` / `{ communityId, communityName }` | `community.controller.js` |
| `community:banned` | S→user | `user:{banned}` | `{ communityId, reason }` | `community.controller.js` |
| `community:join_request` | S→user | `user:{ownerId}` | `{ communityId, requestId }` | `community.controller.js` |
| `community:join_accepted` | S→user | `user:{userId}` | `{ communityId, communityName }` | `community.controller.js` |
| `community:join_declined` | S→user | `user:{userId}` | `{ communityId, communityName }` | `community.controller.js` |
| `community:invite` | S→user | `user:{invitedUserId}` | `{ communityId, communityName, ... }` | `community.controller.js` |

---

## Wallet / Payment Events

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `wallet:join` | C→S | server | — | client (joins `wallet:{userId}`) |
| `wallet:leave` | C→S | server | — | client |
| `wallet:coins_credited` | S→user | `user:{userId}` + `wallet:{userId}` | `{ coins, packageId, stripeSessionId }` | `stripe.controller.js` |
| `fee:paid` | S→user | `user:{paidBy}` | `{ feeId, stripeSessionId }` | `stripe.controller.js` |

---

## Platform Admin Events

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `admin:user_reported` | S→room | `role:SUPER_ADMIN` | `{ reportId, reporter, reported, reason }` | `report-block.controller.js: reportUser` |
| `creator:payout_requested` | S→room | `role:SUPER_ADMIN` | `{ userId, creatorName, ... }` | `creator.controller.js` |

---

## PK Battle Events

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `pk:join` | C→S | server | `pkMatchId` | client (DB-verified participant or LIVE/ENDED match) |
| `pk:leave` | C→S | server | `pkMatchId` | client |
| `pk:state` | S→user | `user:{userId}` | reconnect state | `app.js` on `pk:join` |
| `pk:timer:sync` | C→S | server | `pkMatchId` | client |
| `pk:timer` | S→user | `user:{userId}` | `{ pkMatchId, remainingSeconds, serverTime }` | `app.js` on `pk:timer:sync` |

PK battle score, gift, vote events emitted to `pk:{pkMatchId}` by `pk.service.js`.

---

## Attendance Events

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `attendance:alert` | S→user | `user:{guardianUserId}` | attendance record | `attendance.controller.js` |

---

## Creator Economy Events

| Event | Direction | Room / Target | Payload | Emitter |
|-------|-----------|--------------|---------|---------|
| `creator:tip_received` | S→user | `user:{creatorUserId}` | `{ senderId, amount, diamonds, message, tipId }` | `creator.controller.js` |
