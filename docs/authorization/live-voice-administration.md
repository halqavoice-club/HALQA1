# Live Class & Voice Room Administration — SUPER_ADMIN

---

## The Critical Line

```
SUPER_ADMIN CAN:                        SUPER_ADMIN CANNOT:
──────────────────────────────────       ──────────────────────────────────
View live class/room counts              Join a live class as HOST or STUDENT
View participant counts                  Join a voice room as HOST or MODERATOR
View room metadata in dashboard          Publish microphone or camera
Inspect via admin dashboard              Publish screen share
View gift activity in sessions           Become a teacher or speaker
View related audit logs                  Approve voice speaker queue
Suspend a room host                      Mute/kick participants in a room
Review reports about room activity       Auto-start a scheduled class
Terminate a session indirectly           View the hand-raise queue as host
(by suspending the host user)            View private INVITE_ONLY room contents
                                         Receive a LiveKit SFU token for a session
                                         they have not legitimately joined
```

---

## Live Class Administration (Platform Level)

### Available to SUPER_ADMIN

**Operational overview:**  
`GET /api/v1/admin/stats/live-voice`

Returns:
```json
{
  "live": {
    "active": 5,
    "total": 847,
    "participants": 124,
    "sessions": [
      {
        "id": "...",
        "title": "Grade 5 Quran Class",
        "status": "LIVE",
        "createdAt": "...",
        "_count": { "participants": 23 }
      }
    ]
  }
}
```

This is **observation only** — no participant details, no content, no chat.

---

### Actions Available via Platform Admin Tools

| Scenario | Platform Admin Action |
|----------|----------------------|
| A live class has abusive content | Suspend the host user via `PATCH /admin/stats/users/:id/status` |
| A live class is violating platform terms | Suspend host user; contact school admin to terminate the class |
| A school is misusing live class | Deactivate the school via `PATCH /admin/stats/schools/:id/status` |
| A report was filed about a live class participant | Review via `GET /social/reports`, take action on the reported user |

---

### What SUPER_ADMIN Cannot Do Directly to Live Classes

| Action | Status | Current violation |
|--------|--------|-----------------|
| Terminate/end a live class | ❌ No admin endpoint | Suspend host instead |
| View live class chat messages | ❌ No admin endpoint | |
| View attendance records | ❌ No admin endpoint | |
| Join as HOST | ❌ Should be denied | LCSV-001: SUPER_ADMIN receives HOST role on join (violation) |
| Join as STUDENT/observer | ⚠️ Technically possible | Would create a participant record — should require explicit admin observer mode |
| Receive LiveKit token | ❌ Should be denied | LCSV-001 enables this as a side effect |
| Mute/kick participants | ❌ Should be denied | LCSV-001 grants HOST controls |

---

## Voice Room Administration (Platform Level)

### Available to SUPER_ADMIN

Same operational overview endpoint as above:  
`GET /api/v1/admin/stats/live-voice`

Returns:
```json
{
  "voice": {
    "active": 3,
    "total": 412,
    "participants": 89,
    "rooms": [
      {
        "id": "...",
        "title": "Islamic Studies Circle",
        "status": "LIVE",
        "privacy": "PUBLIC",
        "host": { "id": "...", "firstName": "Ahmad", "lastName": "Ali" },
        "_count": { "participants": 31 }
      }
    ]
  }
}
```

---

### Voice Room Actions Available to SUPER_ADMIN

| Action | Status | Notes |
|--------|--------|-------|
| List active voice rooms | ✅ (same as any user) | `GET /voice/` |
| Search voice rooms | ✅ (same as any user) | `GET /voice/search` |
| View room metadata | ✅ (same as any user) | `GET /voice/:id` |
| View participant list | ✅ (same as any user) | `GET /voice/:id/participants` |
| Join room as AUDIENCE | ✅ (same as any user) | `POST /voice/:id/join` |
| Create a voice room | ✅ (same as any user) | `POST /voice/` |
| View platform-level aggregate stats | ✅ (admin only) | `GET /admin/stats/live-voice` |

---

### Voice Room Actions NOT Available to SUPER_ADMIN

| Action | Status | Reason |
|--------|--------|--------|
| Become HOST | ❌ | HOST = room creator; not auto-assigned by platform role |
| Approve speaker queue | ❌ | SA-FIX-09: requires HOST/MOD VoiceParticipant record |
| Mute/kick participants | ❌ | Requires HOST/MOD VoiceParticipant record |
| View full speaker queue | ❌ | SA-FIX-09: SUPER_ADMIN explicitly excluded |
| Terminate a room | ❌ | No admin termination endpoint; suspend host instead |
| Access PRIVATE/INVITE_ONLY room | ⚠️ No bypass | Same join checks as any user (may be blocked by privacy) |
| Get LiveKit token for room they haven't joined | ❌ | Requires active voiceParticipant record |

---

## Investigating Reported Live Sessions

**Workflow for platform admin when a live session is reported:**

```
1. Receive alert via role:SUPER_ADMIN socket room
   (report-block.controller.js emits to this room on new reports)

2. View report details:
   GET /api/v1/social/reports
   (filter by status=PENDING)

3. View reported user's profile:
   GET /api/v1/users/:reportedUserId
   (full PII available to SUPER_ADMIN)

4. Check user's history:
   GET /api/v1/admin/stats/audit?userId=:reportedUserId

5. Take action:
   PATCH /api/v1/admin/stats/users/:id/status { "status": "SUSPENDED" }
   (suspends access immediately via cache invalidation)

6. Mark report as reviewed:
   PATCH /api/v1/social/reports/:id/review { "status": "ACTION_TAKEN" }
```

**What the admin cannot do in this flow:**
- Enter the room to observe directly (that would make them a participant)
- Read the room's chat history
- Listen to the audio stream
- View recording content

---

## Terminating a Live Session (No Direct API)

There is no "terminate room" or "terminate class" endpoint in the SUPER_ADMIN API surface.

**Correct approach for immediate termination:**

1. Suspend the host user → their account is denied on next request
2. The frontend detects the session has become inactive (no host = class typically ends)
3. For voice rooms: when the host is removed, they leave the room → room becomes HOST-less → the room remains but no longer has an active host

**Gap:** There is no server-side mechanism to force-end a room from the platform admin level without the host user being the one to end it. A dedicated admin room termination endpoint would be needed for emergency response.

---

## View Gift Activity in Sessions

**API:** `GET /api/v1/admin/stats/gifts`

Returns:
- Gift transactions (last 50, including sender/receiver names)
- Aggregate counts by period
- Full gift catalog

This is **observation only** — no ability to reverse or void individual gift transactions.

---

## Voice Room Statistics

**API:** `GET /api/v1/admin/stats/analytics`

Provides platform-level aggregate:
- `totalVoiceRooms` — all-time count
- DAU/WAU/MAU approximations (based on lastLoginAt, not room participation)

No per-room analytics in the admin stats API.
