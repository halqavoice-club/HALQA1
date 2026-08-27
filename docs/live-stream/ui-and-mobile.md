# Live Stream — Web UI and Mobile

**Audit date:** 2026-08-26

---

## Web Frontend

### Creation — `CreateLiveClassModal`

**File:** `frontend/src/components/live-class/CreateLiveClassModal.tsx`

The modal uses a 3-step flow:

**Step 1 — Stream Mode:**
- "Public Live Stream" (Globe icon) — shown to ALL users
- "School Live Class" (GraduationCap icon) — shown only to `isTeacher || isAdmin` users. Greyed out with "Join a school as a teacher or admin" message for others.

**Step 2 — Room Type:**
| Type | Description |
|------|-------------|
| Immediate | Start now |
| Scheduled | Choose a future date and time |
| Permanent | No auto-end (duration=null) |
| Limited | Auto-end after a selected duration |

**Step 3 — Room Details:**
For PUBLIC streams:
- Title (required, max 120)
- Description (optional)
- Visibility (Public / Private — UI only field, maps to `privacy` but backend ignores it for PUBLIC streams)
- Scheduled date/time (if scheduled type)
- Duration (if not permanent)
- Max Viewers (maxParticipants)
- Cover image (optional upload)
- Feature toggles: Chat, Hand raise, Screen sharing, Record stream
  - Note: Whiteboard and Quran panel toggles only shown for SCHOOL streams

**Form submission:**
```typescript
const payload = {
  streamType: 'PUBLIC',
  title, description, duration, scheduledAt, maxParticipants,
  chatEnabled, handRaiseEnabled, screenShareEnabled, isRecorded,
  // classId is NOT included for PUBLIC streams
}
await api.post('/live-classes', payload)

// If cover image selected, upload separately:
await api.post(`/live-classes/${lc.id}/cover`, formData)
```

---

### Listing — `/live-class`

**File:** `frontend/src/app/(dashboard)/live-class/page.tsx`

The live class list shows both SCHOOL and PUBLIC streams. PUBLIC streams display a purple "Public" pill badge. SCHOOL streams display an indigo "Class" badge.

Cards for PUBLIC streams show:
- Title, status badge, stream type pill
- Host name (from `hostUser.firstName lastName` — no teacher display)
- No class name line (school class only)
- Participant count

---

### Room — `LiveClassRoomImpl`

**File:** `frontend/src/components/live-class/LiveClassRoomImpl.tsx`

Same component for both stream types. The key behavioral difference for PUBLIC streams:

```typescript
const isStaffRole = ['TEACHER', 'SCHOOL_ADMIN'].includes(user?.role || '')
// MEMBER-role user who created a PUBLIC stream gets isHost=true via hostUserId check:
const isHost = isStaffRole || (!!lc && !!user && lc.hostUserId === user.id)
```

This ensures a MEMBER user who created a public stream sees host controls, even though their `user.role` is `'MEMBER'`.

**SUPER_ADMIN note:** SUPER_ADMIN is deliberately excluded from `isStaffRole`. A SUPER_ADMIN sees STUDENT controls unless they are the `hostUserId`. However, the backend assigns them HOST role (LCSV-001), creating a frontend/backend discrepancy.

---

### Feed Card — `LiveSection`

**File:** `frontend/src/components/feed/LiveSection.tsx`

The feed section displays `LIVE_CLASS_SHARE` post cards. When a PUBLIC stream goes live, a card appears automatically (via `feed:live` socket event or on next feed refresh). The card links to `/live-class/{id}`.

---

## Mobile

### Screen: `mobile/app/live-class/[id].tsx`

Same screen for both PUBLIC and SCHOOL streams. The mobile app uses the same screen URL `live-class/[id]` for both types.

**Host detection for PUBLIC streams:**
```typescript
const isTeacher = ['TEACHER','SCHOOL_ADMIN'].includes(user?.role || '');
// MEMBER user who owns public stream: isHost via host.id check
const isHost = user?.id === liveClass?.host?.id || isTeacher;
```

The `liveClass.host` object is:
```typescript
// For PUBLIC streams, host comes from hostUser field:
const teacherUser = lc.teacher?.user ?? lc.host ?? {};
```

**Join/leave behavior:** Identical to school classes.

**UI differences for PUBLIC streams:**
- No attendance tab
- No class name display
- Same Chat, Hand Raise, Host Controls, and Features tabs

---

## Mobile Feed Cards

**File:** `mobile/src/components/feed/LiveCard.tsx`, `mobile/src/components/feed/LiveSection.tsx`

Live stream cards appear in the mobile feed. Tapping a `LIVE_CLASS_SHARE` card navigates to `live-class/[id]`.

---

## What the UI Does NOT Show

For PUBLIC streams, the following school-specific UI elements are absent or hidden:
- Class selector (hidden in create modal)
- Attendance tab in the room
- Enrollment status
- Student/teacher role badge differentiation beyond HOST/STUDENT
