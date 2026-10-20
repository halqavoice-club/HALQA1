# HALQA Live Stream — Documentation Index

**Audit date:** 2026-08-26  
**Status:** Read-only documentation audit. No application code modified.

---

## What is a Live Stream

A **Live Stream** in HALQA is a `LiveClass` record with `streamType = 'PUBLIC'`. It is not a separate system — it shares the entire Live Class backend, database, and realtime infrastructure.

**Key distinction from School Live Class:**

| Dimension | School Live Class | Public Live Stream |
|-----------|------------------|-------------------|
| `streamType` | `'SCHOOL'` | `'PUBLIC'` |
| Requires school | Yes | No |
| Requires class enrollment | Yes | No |
| Host identity | Teacher (via Teacher record) | Any authenticated user (via `hostUserId`) |
| Audience | School members only | Any authenticated platform user |
| Features | Full (whiteboard, polls, Quran, attendance) | Configurable (all optional) |
| Visibility in feed | `SCHOOL_ONLY` | `PUBLIC` |
| Gift sending | Same-school users only | Any authenticated user |

---

## Document Index

| Document | Contents |
|----------|---------|
| **[README.md](./README.md)** | This index |
| [overview.md](./overview.md) | Architecture, creation flow, lifecycle, SUPER_ADMIN boundary |
| [api.md](./api.md) | API endpoints (subset of live-class API) |
| [permissions.md](./permissions.md) | Who can create, join, host, and manage |
| [realtime.md](./realtime.md) | Socket.IO + LiveKit + feed integration |
| [ui-and-mobile.md](./ui-and-mobile.md) | Web and mobile creation/room UI |
| [gaps.md](./gaps.md) | Known gaps and violations |

---

## Quick Facts

- **Backend:** Shares `backend/src/routes/live-class.routes.js` and `backend/src/controllers/live-class.controller.js`
- **Database model:** `LiveClass` (same table — `stream_type = 'PUBLIC'`)
- **Migration:** `20260819_add_public_livestream/migration.sql`
- **Feed integration:** `backend/src/utils/feedLive.js` — `broadcastLiveStart()` / `broadcastLiveEnd()`
- **Create UI:** `frontend/src/components/live-class/CreateLiveClassModal.tsx` (Public Live Stream option)
- **Room UI:** Same as live class — `frontend/src/components/live-class/LiveClassRoomImpl.tsx`
- **Mobile:** `mobile/app/live-class/[id].tsx` (same screen as school classes)

---

## SUPER_ADMIN Boundary

SUPER_ADMIN joining a PUBLIC stream they did not create receives HOST role due to LCSV-001 violation. See [gaps.md](./gaps.md).
