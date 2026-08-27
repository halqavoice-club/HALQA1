# HALQA Voice Club — Documentation Index

**Audit date:** 2026-08-26  
**Status:** Read-only documentation audit. No application code modified.

---

## What is Voice Club

Voice Club is HALQA's real-time audio broadcasting system. Users create **permanent** voice rooms where the host and promoted speakers can talk while the audience listens. Rooms are persistent — they never auto-delete when participants leave.

Key characteristics:
- **Permanent rooms** — remain IDLE when empty, can be rejoined anytime
- **Role-based audio** — HOST/MODERATOR/SPEAKER can publish audio; AUDIENCE listens only
- **FIFO speaker queue** — audience raises hand; host/mod approves in order
- **Gifts** — audience sends virtual gifts to speakers/host
- **Mic pass** — speakers can pass the mic directly to an audience member
- **PK battles** — competitive gift battles between two rooms or hosts

---

## Document Index

| Document | Contents |
|----------|---------|
| **[README.md](./README.md)** | This index |
| [database.md](./database.md) | All Prisma models (VoiceRoom, VoiceParticipant, VoiceRoomMember, VoiceMessage, VoiceHostStats) |
| [api.md](./api.md) | Complete API endpoint inventory |
| [permissions.md](./permissions.md) | Role model, permission matrix, SUPER_ADMIN boundary |
| [lifecycle.md](./lifecycle.md) | Room states, transitions, permanent room contract |
| [realtime.md](./realtime.md) | Socket.IO events, LiveKit integration, speaker queue |
| [features.md](./features.md) | Gifts, mic pass, speaker queue, seat lock, open mic, mic lock |
| [ui-and-mobile.md](./ui-and-mobile.md) | Web pages/components, mobile screen |
| [gaps.md](./gaps.md) | Known gaps, SUPER_ADMIN violations |

---

## Quick Facts

- **Backend routes:** `backend/src/routes/voice.routes.js`
- **Main controller:** `backend/src/controllers/voice.controller.js`
- **Role controller:** `backend/src/controllers/voice-roles.controller.js`
- **Queue controller:** `backend/src/controllers/voice-queue.controller.js`
- **Mic pass controller:** `backend/src/controllers/voice-mic.controller.js`
- **Stats controller:** `backend/src/controllers/voice-stats.controller.js`
- **Auto-promote util:** `backend/src/utils/autoPromote.js`
- **Speaker queue util:** `backend/src/utils/voiceQueue.js`
- **Frontend room:** `frontend/src/components/voice/VoiceRoomView.tsx`
- **Frontend list:** `frontend/src/app/(dashboard)/voice-club/page.tsx`
- **Mobile screen:** `mobile/app/voice/[id].tsx`

---

## SUPER_ADMIN Boundary

`PATCH /voice/:id/end` is intentionally restricted to SUPER_ADMIN only — it archives (terminates) a room permanently. All other voice room operations require content-participation roles (HOST/MODERATOR). SUPER_ADMIN has no implicit voice room privileges beyond archiving. See [permissions.md](./permissions.md) and [gaps.md](./gaps.md).
