# Voice Club — Feature Reference

**Audit date:** 2026-08-26

---

## 1. Speaker Queue (FIFO)

The speaker queue lets AUDIENCE members request to speak. Requests are processed in first-in-first-out order.

**Flow:**
```
AUDIENCE → POST /voice/:id/queue/raise
  └─ Checks: not HOST/MOD/SPEAKER, micLocked=false, room not ENDED
  └─ Enqueues in Redis; sets VoiceParticipant.handRaised=true
  └─ Emit: voice:hand_raised → room
         voice:queue_position → user (own position)
         voice:queue_updated → room (full queue for HOST/MOD)

HOST/MOD → POST /voice/:id/queue/approve  (approveNext)
         → POST /voice/:id/queue/approve/:userId  (approveUser)
  └─ Checks: HOST or MODERATOR participant, not micLocked, speaker count < maxSpeakers
  └─ Pops from Redis queue; sets role=SPEAKER, isMuted=false
  └─ Emit: voice:role_changed → room
         voice:promoted_to_speaker → user

HOST/MOD → DELETE /voice/:id/queue/reject/:userId
  └─ Removes from Redis queue; sets handRaised=false
  └─ Emit: voice:queue_rejected → user
         voice:hand_raised { raised: false } → room

AUDIENCE → DELETE /voice/:id/queue/cancel
  └─ Removes own position from queue
  └─ Emit: voice:hand_raised { raised: false } → room
```

**micLocked:** When `room.micLocked = true`:
- `raiseHand` returns 403 ("The mic is locked")
- `approveNext`/`approveUser` returns 403
- Queue remains; nobody can be promoted until unlocked

**Speaker limit:** `room.maxSpeakers` (default 10). Checked before approval.

---

## 2. Open Mic Mode

When `room.isOpenMic = true`, AUDIENCE members can grab the mic directly without going through the queue.

**Flow:**
```
HOST/MOD → PATCH /voice/:id/open-mic
  └─ checkVoiceRole([HOST, MOD])
  └─ Toggles isOpenMic; updates DB + Redis cache
  └─ Emit: voice:open_mic_changed → room

AUDIENCE → POST /voice/:id/grab-mic (when isOpenMic=true)
  └─ Checks: role === AUDIENCE, isOpenMic=true, not micLocked
  └─ If speaker slot available → immediate SPEAKER promotion
  └─ If no slot → enters FIFO queue (same as raiseHand)
  └─ Emit: voice:role_changed, voice:mic_grabbed → room
         voice:queue_position / voice:queue_updated if queued
```

---

## 3. Mic Lock

When `room.micLocked = true`, no new speakers can enter the stage.

**What micLocked blocks:**
- `raiseHand` / `grabMic` → 403
- `approveNext` / `approveUser` → 403

**What micLocked does NOT affect:**
- Current speakers keep their mic
- HOST/MOD can still mute/unmute speakers
- Chat and reactions continue normally

```
HOST/MOD → PATCH /voice/:id/mic-lock
  └─ checkVoiceRole([HOST, MOD])
  └─ Toggles micLocked
  └─ Emit: voice:mic_lock_changed → room
```

---

## 4. Mic Pass

A SPEAKER or HOST can pass the mic directly to an AUDIENCE member without queue approval.

**Flow:**
```
SPEAKER → POST /voice/:id/mic-pass/:targetUserId  (sendMicOffer)
  └─ Creates MicOffer record (or in-memory if no DB table)
  └─ Emit: voice:mic_offer → user:{target}

Target → POST /voice/:id/mic-pass/:offerId/accept  (acceptMicOffer)
  └─ Promotes target to SPEAKER
  └─ If passer is NOT HOST: passer demoted to AUDIENCE
  └─ Emit: voice:mic_passed → room
         voice:role_changed (x2) → room
         voice:mic_received → user:{acceptor}

Target → POST /voice/:id/mic-pass/:offerId/decline  (declineMicOffer)
  └─ Emit: voice:mic_declined → user:{passer}

Passer → DELETE /voice/:id/mic-pass/:offerId  (cancelMicOffer)
  └─ Emit: voice:mic_offer_cancelled → user:{target}
```

**HOST keeps their role when passing mic.** Only non-HOST speakers are demoted on pass.

---

## 5. Seat Lock

Locks a specific speaker seat slot by index (0 to maxSpeakers-1).

```
HOST/MOD → PATCH /voice/:id/seat-lock
  { seatIndex: 3 }
  └─ Toggles the seat at index 3 in room.lockedSeats array
  └─ Emit: voice:seat_lock_changed → room
```

When a seat is locked:
- If occupied: current speaker keeps it until they leave
- When freed: slot cannot be re-filled (autoPromote skips locked seats)

---

## 6. Gifts

Any participant (including AUDIENCE) can send gifts to HOST/SPEAKER.

**Send to one recipient:**
```
POST /voice/:id/gifts
{ giftId, receiverId, count: 1, idempotencyKey: 'uuid' }
  └─ authenticate + giftRateLimit (30/10s)
  └─ roomResolver.validateRoom() → room must be LIVE
  └─ roomResolver.validateParticipant() → sender must be active participant
  └─ roomResolver.getReceivers() → receiver must be active participant
  └─ prisma.$transaction: deduct sender coins, credit receiver diamonds
  └─ Emit: gift:sent, voice:gift_sent → voice:{roomId}
         voice:premium_gift (if isPremium) → voice:{roomId}
         gift:received → user:{receiver}
```

**Send to all on stage:**
```
POST /voice/:id/gifts/all
  └─ Same flow, receiver = all SPEAKER + HOST + MODERATOR
  └─ Emit: gift:sent, voice:gift_sent, voice:gift_all → room
         gift:received → each receiver individually
```

**Idempotency:** `GiftTransaction.idempotencyKey` is `@unique` — duplicate gift requests are silently ignored at DB level.

---

## 7. Voice Host Stats

When a room is ended via `endRoom()`, daily stats are upserted for the host:

```javascript
await upsertDailyStats(room.hostId, {
  durationMinutes,      // session length in minutes
  peakAudience,         // max audience count ever
  totalListeners,       // total participants who joined
  totalSpeakers,        // total speaker promotions
  totalMessages         // chat message count
})
```

Stored in `voice_host_stats` (one record per user per day).

Stats are available at:
- `GET /voice/stats/me` — own hosting stats
- `GET /voice/stats/leaderboard` — global leaderboard ranked by coins received

---

## 8. Reactions

Emoji reactions from participants are broadcast to the room.

```javascript
// app.js socket handler
socket.on('voice:reaction', async ({ roomId, emoji }) => {
  // Check reactionsEnabled from Redis cache
  const cached = await getCache(`voice:room:${roomId}`);
  const enabled = cached ? cached.reactionsEnabled !== false : true;
  if (!enabled) return; // drop silently — not relayed
  socket.to(`voice:${roomId}`).emit('voice:reaction', { userId, emoji });
});
```

Rate limited: 10 per 2 seconds per socket. `reactionsEnabled` on the room prevents reactions when disabled by HOST/MOD.

---

## 9. Room Cover Image

```
HOST → POST /voice/:id/cover  (multipart/form-data, 'cover' field)
  └─ Multer: 2MB max, images only
  └─ Magic byte validation (file-type library)
  └─ SA-FIX-06: Only hostId === req.user.id passes
  └─ Saves file via storage utility
  └─ Updates room.coverImageUrl
  └─ Emit: voice:room_updated → room + voice:lobby + school:{schoolId}
```

---

## 10. Permanent Room Members

Every user who joins a room gets a `VoiceRoomMember` record created automatically (on first join):

```javascript
// joinRoom() auto-membership creation
await prisma.voiceRoomMember.create({
  data: {
    roomId, userId,
    role: room.hostId === userId ? 'OWNER' : 'MEMBER',
    status: 'ACTIVE',
    memberLevel: 1,
    isBanned: false,
  }
})
```

This supports:
- Ban persistence (user cannot rejoin even after leaving)
- Level system and contribution tracking
- Permanent member list per room
