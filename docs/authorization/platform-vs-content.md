# Platform Administration vs Content Participation

This document defines the boundary between the two authorization domains in HALQA.

---

## The Core Principle

```
┌──────────────────────────────────────────────────────────────────┐
│  PLATFORM ADMINISTRATION                                         │
│  ─────────────────────────                                       │
│  The ability to MANAGE the platform.                             │
│                                                                  │
│  Examples:                                                       │
│   - View live classes in the admin dashboard                     │
│   - Terminate a live class (platform moderation action)          │
│   - Suspend the user who hosts a live class                      │
│   - View report history for a voice room                         │
│   - Inspect participant counts and audit logs                     │
│                                                                  │
│  Held by: SUPER_ADMIN                                            │
└──────────────────────────────────────────────────────────────────┘

                         ≠ (NOT EQUAL TO)

┌──────────────────────────────────────────────────────────────────┐
│  CONTENT PARTICIPATION                                           │
│  ──────────────────────                                          │
│  The ability to PARTICIPATE in a content space.                  │
│                                                                  │
│  Examples:                                                       │
│   - Join a live class as a student                               │
│   - Host a live class as a teacher                               │
│   - Become a speaker in a voice room                             │
│   - Publish a microphone or camera                               │
│   - Appear in the participant list of a session                  │
│                                                                  │
│  Held by: School members (education roles), room creators,       │
│           and promoted participants                              │
└──────────────────────────────────────────────────────────────────┘
```

---

## What SUPER_ADMIN CAN do regarding Live Classes (Platform Admin)

All of these are platform-level MANAGEMENT actions, not participation:

| Action | API | Implementation |
|--------|-----|----------------|
| View list of all live sessions | `GET /admin/stats/live-voice` | Admin stats route — SUPER_ADMIN only |
| See participant counts per session | `GET /admin/stats/live-voice` | Admin stats route |
| View a user's live class participation history | Via audit logs | Admin stats audit endpoint |
| Suspend the host of a live class | `PATCH /admin/stats/users/:id/status` | Admin stats — changes user status, not room |
| View social reports filed against live class participants | `GET /social/reports` | Platform report moderation |

---

## What SUPER_ADMIN CANNOT do regarding Live Classes (Content Participation)

These require the user to have content-participation credentials, not just a platform role:

| Action | Why blocked |
|--------|-------------|
| Join a school live class as any role | No SchoolMembership → `requireSchoolMember` returns 403 |
| Join a public live class (unless created by them) | Must have an active `liveClassParticipant` record |
| Start/end a live class | `resolveStreamStaffAccess` requires `eduStaff` — needs school membership |
| Mute/kick participants | Same — `resolveStreamStaffAccess` |
| Receive a LiveKit token | Requires active `liveClassParticipant` in DB |
| See hand-raise queue as host | Socket.IO join requires active participant record |

---

## What SUPER_ADMIN CAN do regarding Voice Rooms (Platform Admin)

| Action | API | Implementation |
|--------|-----|----------------|
| View active voice rooms and participant counts | `GET /admin/stats/live-voice` | Admin stats route |
| View gift transactions in voice rooms | `GET /admin/stats/gifts` | Admin stats route |
| View social reports from voice rooms | `GET /social/reports` | Platform report moderation |
| Suspend a voice room host | `PATCH /admin/stats/users/:id/status` | Changes user status globally |

---

## What SUPER_ADMIN CANNOT do regarding Voice Rooms (Content Participation)

| Action | Why blocked |
|--------|-------------|
| Join a voice room as HOST | HOST is room creator; assigned at creation |
| Approve speaker queue | `checkVoiceRole([HOST, MODERATOR])` — needs VoiceParticipant record |
| Mute/kick users | `checkVoiceRole([HOST, MODERATOR])` — needs VoiceParticipant record |
| See full speaker queue | SA-FIX-09: SUPER_ADMIN has no queue admin privilege (no active participant check) |
| Receive a LiveKit voice token | Requires active `voiceParticipant` record in DB |

---

## Concrete Examples

### Example 1 — Moderating a reported live class

**CORRECT (platform admin approach):**
```
SUPER_ADMIN sees report in dashboard
→ Views the reporter's details via /admin/stats/users
→ Suspends the reported user via /admin/stats/users/:id/status
→ Logs the action in the audit trail
```

**INCORRECT (would violate separation):**
```
SUPER_ADMIN joins the live class room
→ Appears in participant list
→ Has host controls
→ Mutes/kicks users directly from inside the room
```

### Example 2 — Monitoring a voice room issue

**CORRECT (platform admin approach):**
```
SUPER_ADMIN views /admin/stats/live-voice
→ Sees room has 45 participants and unusual activity
→ Views social reports for that room
→ Suspends offending users from admin dashboard
```

**INCORRECT (would violate separation):**
```
SUPER_ADMIN calls /voice/:id/join
→ Enters room as AUDIENCE
→ Raises hand to become SPEAKER
→ Uses platform role to bypass queue approval
```

---

## Why This Separation Matters

1. **Accountability:** A platform admin inside a content space creates ambiguity about their intent and visibility to other participants.

2. **Least privilege:** Platform admin rights are extremely powerful. They should not extend beyond the admin console unless explicitly required.

3. **Data integrity:** Live class participant records and voice room participant records represent real participation events. Injecting platform admin accounts pollutes attendance records, gift leaderboards, and analytics.

4. **Security surface:** If a SUPER_ADMIN account is compromised, the attacker should gain platform management access but NOT automatic HOST access to all live sessions.

5. **User trust:** Participants in a school live class or voice room have a reasonable expectation that unknown users cannot enter their session with elevated privileges simply by virtue of a platform admin role.
