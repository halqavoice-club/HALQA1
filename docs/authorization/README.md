# HALQA Authorization Documentation

**Last updated:** 2026-08-26  
**Status:** Complete — 5-phase read-only codebase audit  
**Rule:** All documents in this directory are derived from direct source inspection. No application code was modified.

---

## Purpose

This directory contains the complete authorization specification for the HALQA platform, focusing on the SUPER_ADMIN role and the boundary between platform administration and content participation.

---

## The Single Most Important Rule

```
SUPER_ADMIN = PLATFORM ADMINISTRATION ONLY

SUPER_ADMIN does NOT automatically become:
  - HOST       - TEACHER    - STUDENT
  - SPEAKER    - STREAMER   - VIEWER
  - ROOM PARTICIPANT       - LIVE CLASS PARTICIPANT
  - VOICE ROOM PARTICIPANT - CONTENT CHAT PARTICIPANT

Administrative access to content spaces must be implemented
through dedicated administrative APIs, not by joining
content spaces as a participant.
```

---

## Document Index

### ★ Canonical Master Specification (START HERE)

| File | Description |
|------|-------------|
| **[SUPER-ADMIN-MASTER-SPEC.md](./SUPER-ADMIN-MASTER-SPEC.md)** | **The authoritative contract for all SUPER_ADMIN development. Read this first.** |

---

### Authorization Architecture

| File | Description |
|------|-------------|
| [role-model.md](./role-model.md) | Three role domains: Platform, SchoolMembership, Content Participation |
| [permission-model.md](./permission-model.md) | Every middleware layer in the permission chain |
| [platform-vs-content.md](./platform-vs-content.md) | The permanent distinction between administration and participation |
| [super-admin-scope.md](./super-admin-scope.md) | SUPER_ADMIN capability matrix — ALLOWED / DENIED per capability |

---

### Database

| File | Description |
|------|-------------|
| [database-model-inventory.md](./database-model-inventory.md) | Every Prisma model — SUPER_ADMIN read/write/delete access, sensitive fields, audit requirements |

---

### API

| File | Description |
|------|-------------|
| [super-admin-api-matrix.md](./super-admin-api-matrix.md) | Master API matrix — every endpoint, allowed/denied/missing, risk, audit |
| [api-permissions.md](./api-permissions.md) | Per-route permission requirements for all API endpoints |
| [admin-permissions.md](./admin-permissions.md) | Full SUPER_ADMIN platform API surface (admin stats, backups, internal) |

---

### Domain Administration

| File | Description |
|------|-------------|
| [user-management.md](./user-management.md) | SUPER_ADMIN user management capabilities + MANAGE vs ACT AS distinction |
| [school-management.md](./school-management.md) | Platform-level school admin vs school-internal administration |
| [live-voice-administration.md](./live-voice-administration.md) | What admin can observe vs what requires content participation |
| [payment-administration.md](./payment-administration.md) | Wallet, transactions, gifts, payouts — access map + risk matrix |
| [security-administration.md](./security-administration.md) | Sessions, audit logs, 2FA, IP controls, what secrets are never accessible |

---

### Content Permission Details

| File | Description |
|------|-------------|
| [live-class-permissions.md](./live-class-permissions.md) | Who can do what in a Live Class |
| [live-stream-permissions.md](./live-stream-permissions.md) | Who can do what in a Public Live Stream |
| [voice-permissions.md](./voice-permissions.md) | Who can do what in a Voice Club / Voice Room |
| [realtime-permissions.md](./realtime-permissions.md) | Socket.IO event authorization |
| [livekit-permissions.md](./livekit-permissions.md) | LiveKit token grants and SFU-level enforcement |

---

### Admin UI

| File | Description |
|------|-------------|
| [admin-ui-overview.md](./admin-ui-overview.md) | Admin UI architecture, route guard, 14-section sidebar, route inventory |
| [admin-ui-pages.md](./admin-ui-pages.md) | Per-page documentation for all 14 admin pages |
| [admin-ui-action-matrix.md](./admin-ui-action-matrix.md) | Full action matrix — ALLOWED/DENIED/NO UI per action with risk ratings |
| [admin-ui-gaps.md](./admin-ui-gaps.md) | 19 documented UI gaps and permission leaks |
| [admin-ui-backend-trace.md](./admin-ui-backend-trace.md) | 7 full UI → DB traces for key admin actions |

---

### Realtime (Socket.IO + LiveKit)

| File | Description |
|------|-------------|
| [realtime-architecture.md](./realtime-architecture.md) | Socket.IO setup, auth, rate limiters, room taxonomy, SUPER_ADMIN socket status |
| [realtime-event-catalog.md](./realtime-event-catalog.md) | Complete catalog of every Socket.IO event — direction, payload, emitter |
| [realtime-super-admin-boundary.md](./realtime-super-admin-boundary.md) | Definitive SUPER_ADMIN realtime boundary — every room, every system |
| [realtime-security-model.md](./realtime-security-model.md) | Defense layers, kicked user prevention, school isolation, identity spoofing prevention |
| [livekit-architecture.md](./livekit-architecture.md) | Token generation, grants, reconnect policy, SFU vs application enforcement |
| [participant-lifecycle.md](./participant-lifecycle.md) | Join → promote → kick → leave → reconnect flows for Voice Club and Live Class |

---

### Violation Register

| File | Description |
|------|-------------|
| [known-gaps.md](./known-gaps.md) | Original gap inventory (authorization audit phase) |
| [super-admin-current-violations.md](./super-admin-current-violations.md) | **Full violation register — all confirmed violations with evidence** |

---

### Production Rules

| File | Description |
|------|-------------|
| [super-admin-production-invariants.md](./super-admin-production-invariants.md) | **16 invariants that must never be violated — includes change-control checklist** |

---

## Violation Register Summary

| ID | Severity | Description | Fixed? |
|----|---------|-------------|--------|
| LCSV-001 | 🚨 CRITICAL | SUPER_ADMIN receives HOST role when joining live class | ❌ |
| LCSV-002 | 🔴 HIGH | SUPER_ADMIN in staff checks in live class controllers | ❌ |
| LCSV-003 | 🟢 LOW | SUPER_ADMIN bypasses self-only video state check | ❌ |
| SVSV-001 | 🟡 MEDIUM | Legacy bypass: SA joins any school's feed socket room | ❌ |
| LTSV-001 | 🟢 LOW (mitigated) | SA bypasses school check in generic LiveKit token | ❌ |
| UIGAP-002 | 🔴 HIGH | No user session management UI or API | ❌ missing |
| UIGAP-004 | 🚨 CRITICAL | No payout management UI or API | ❌ missing |
| UIGAP-005 | 🔴 HIGH | No admin coin grant UI or API | ❌ missing |
| UIGAP-007 | 🔴 HIGH | Emergency "End" buttons return 403 for SUPER_ADMIN | ❌ missing endpoint |
| UIGAP-008 | 🟡 MEDIUM | Moderation page API path may be wrong | ❓ verify |
| UIGAP-013 | 🔴 HIGH | Audit logs missing for PII reads, report reviews, backups | ❌ |
| UIGAP-014 | 🟡 MEDIUM | /health/detailed may not require SUPER_ADMIN auth | ❓ verify |
| UILEAK-001 | 🔴 HIGH | Backend/frontend role discrepancy from LCSV-001 | ❌ symptom |

---

## Previously Fixed Violations (Correct State Confirmed)

| Fix | Description |
|-----|-------------|
| ARCH-01 | SUPER_ADMIN school bypass removed from requireSchoolMember, assertSchoolAccess |
| ARCH-02 | SUPER_ADMIN bypass removed from checkLiveClassSchool gift endpoint |
| ARCH-04 | Frontend LiveClassRoomImpl excludes SUPER_ADMIN from isStaffRole |
| SA-FIX-09 | SUPER_ADMIN removed from voice speaker queue admin check |
| SA-FIX-10 | SUPER_ADMIN bypass removed from school:join socket event |
| SA-FIX-11 | SUPER_ADMIN bypass removed from class:join socket event |
| SOC-P0-03 | Report alerts emit to role:SUPER_ADMIN only (not SCHOOL_ADMIN) |
| SOC-P1-05 | voice:join_room requires active VoiceParticipant DB record |
| P0-04/RT-05 | liveclass:join_room requires active LiveClassParticipant DB record |
| GAP-03 | Screen share enforced at SFU level via canPublishSources restriction |

---

## Change Control Process

**Before changing any SUPER_ADMIN-related behavior:**

```
1. READ   → SUPER-ADMIN-MASTER-SPEC.md
2. CHECK  → super-admin-api-matrix.md
3. CHECK  → database-model-inventory.md
4. CHECK  → admin-ui-action-matrix.md
5. CHECK  → realtime-super-admin-boundary.md
6. CHECK  → livekit-architecture.md
7. UPDATE → Relevant documentation FIRST
8. REVIEW → Get a second opinion
9. CODE   → Implement the change
10. TEST  → Run platform-admin-scope.test.js
11. AUDIT → Verify audit logging is in place
12. DEPLOY
```

**Never: CODE → BREAK → DOCUMENT**

---

## File Count

Total documentation files in `docs/authorization/`: **31 files**
