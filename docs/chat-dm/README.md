# HALQA Chat, DM, Group Chat — Documentation Index

**Audit date:** 2026-08-26  
**Status:** Read-only documentation audit. No application code modified.

---

## Systems Covered

HALQA has three distinct chat systems:

| System | Purpose | Realtime room |
|--------|---------|---------------|
| **Direct Messages (DM)** | Private 1:1 conversations | `user:{userId}` personal room |
| **Group Chat** | Multi-user group conversations | `conversation:{convId}` room |
| **Community Feed Chat** | Posts/comments in communities | `community:{id}` room |

These are separate systems with separate APIs and models.

---

## Document Index

| File | Contents |
|------|---------|
| [README.md](./README.md) | This index |
| [dm.md](./dm.md) | Direct Messages — API, database, realtime, authorization |
| [group-chat.md](./group-chat.md) | Group Chat — API, database, realtime, authorization |
| [realtime.md](./realtime.md) | Socket.IO events for all chat systems |
| [gaps.md](./gaps.md) | Known gaps and missing features |

---

## Quick Facts

- **DM routes:** `backend/src/routes/dm.routes.js` → `/api/v1/dm`
- **DM controller:** `backend/src/controllers/dm.controller.js`
- **Group chat routes:** `backend/src/routes/groupChat.routes.js` → `/api/v1/group-chat`
- **Group chat controller:** `backend/src/controllers/groupChat.controller.js`
- **Frontend DM page:** `frontend/src/app/(dashboard)/dm/page.tsx`
- **Frontend group chat page:** `frontend/src/app/(dashboard)/group-chat/page.tsx`
- **Frontend DM lib:** `frontend/src/lib/dm.ts`

---

## SUPER_ADMIN Boundary

SUPER_ADMIN has no special access to DM or group chat. Both systems are user-content participation spaces. SUPER_ADMIN cannot:
- Read other users' private DMs
- Join group chat conversations they were not added to
- Send messages in conversations without being a member

All chat routes require only `authenticate` — there is no role-based gate beyond membership in the conversation.
