# HALQA Live Class — Documentation Index

**Audit date:** 2026-08-26  
**Status:** Read-only documentation audit. No application code modified.

---

## Overview

The Live Class system is HALQA's real-time educational broadcasting feature. It supports two stream types:

| Type | Purpose | Access |
|------|---------|--------|
| `SCHOOL` | Traditional school class tied to a Class record | School members only (enrollment required for students) |
| `PUBLIC` | Open live stream — no school required | Any authenticated platform user |

---

## Document Index

| Document | Contents |
|----------|---------|
| **[README.md](./README.md)** | This index |
| [database.md](./database.md) | All Prisma models, fields, indexes, relations |
| [api.md](./api.md) | Complete API endpoint inventory |
| [permissions.md](./permissions.md) | Role model and permission matrix |
| [lifecycle.md](./lifecycle.md) | Room states, transitions, triggers |
| [realtime.md](./realtime.md) | Socket.IO events + LiveKit integration |
| [error-handling.md](./error-handling.md) | Error codes, causes, recovery |
| [production-rules.md](./production-rules.md) | Production deployment rules |
| [gaps.md](./gaps.md) | Known gaps and violations |

---

## Quick Facts

- **Backend controller:** `backend/src/controllers/live-class.controller.js`
- **Backend routes:** `backend/src/routes/live-class.routes.js`
- **Frontend list page:** `frontend/src/app/(dashboard)/live-class/page.tsx`
- **Frontend room page:** `frontend/src/app/(dashboard)/live-class/[id]/page.tsx`
- **Frontend room component:** `frontend/src/components/live-class/LiveClassRoomImpl.tsx`
- **Mobile screen:** `mobile/app/live-class/[id].tsx`
- **LiveKit token:** `backend/src/controllers/live-class.controller.js: getLiveKitToken()`
- **Validators:** `backend/src/middleware/validators/liveClass.validator.js`
- **Gift integration:** `backend/src/utils/roomResolver.js`

---

## SUPER_ADMIN Boundary

SUPER_ADMIN is a platform administrator and must never become a live class participant.

Current violations: [LCSV-001](../authorization/super-admin-current-violations.md#lcsv-001), [LCSV-002](../authorization/super-admin-current-violations.md#lcsv-002), [LCSV-003](../authorization/super-admin-current-violations.md#lcsv-003)

See [gaps.md](./gaps.md) for details.
