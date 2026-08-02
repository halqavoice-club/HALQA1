# HALQA — Phase A Freeze Baseline
**Date:** 2026-07-16  
**Status:** ✅ FROZEN — Production-stable baseline  
**Platform version:** Pre-Phase-B (Social Platform Layer)

---

## Phase A Rule

> **EXTEND ONLY. NEVER REPLACE. NEVER REMOVE. NEVER BREAK.**  
> The existing system is the immutable foundation for all future phases.

---

## System Verification Results

| Check | Result |
|-------|--------|
| API endpoints (40 tested) | ✅ 40/40 PASS |
| TypeScript diagnostics | ✅ 0 errors |
| Backend startup (Redis + BullMQ) | ✅ Clean |
| Database migrations | ✅ 25 applied |
| Prisma client | ✅ Generated |

---

## Frozen Modules — Do Not Modify

### Backend Controllers (READ ONLY)
| File | Module |
|------|--------|
| `auth.controller.js` | Authentication |
| `class.controller.js` | Classes |
| `school.controller.js` | Schools |
| `import.controller.js` | Bulk import |
| `gift.controller.js` | Gifts |
| `live-class.controller.js` | Live classes |
| All other controllers | All other modules |

### Backend Routes (READ ONLY)
| File | API Base |
|------|----------|
| `auth.routes.js` | `/api/v1/auth` |
| `user.routes.js` | `/api/v1/users` |
| `school.routes.js` | `/api/v1/schools` |
| `class.routes.js` | `/api/v1/classes` |
| `student.routes.js` | `/api/v1/students` |
| `teacher.routes.js` | `/api/v1/teachers` |
| `guardian.routes.js` | `/api/v1/guardians` |
| `attendance.routes.js` | `/api/v1/attendance` |
| `grade.routes.js` | `/api/v1/grades` |
| `behavior.routes.js` | `/api/v1/behavior` |
| `announcement.routes.js` | `/api/v1/announcements` |
| `message.routes.js` | `/api/v1/messages` |
| `calendar.routes.js` | `/api/v1/calendar` |
| `fee.routes.js` | `/api/v1/fees` |
| `library.routes.js` | `/api/v1/library` |
| `note.routes.js` | `/api/v1/notes` |
| `notification.routes.js` | `/api/v1/notifications` |
| `report.routes.js` | `/api/v1/reports` |
| `search.routes.js` | `/api/v1/search` |
| `social.routes.js` | `/api/v1/social` |
| `term.routes.js` | `/api/v1/terms` |
| `upload.routes.js` | `/api/v1/upload` |
| `dashboard.routes.js` | `/api/v1/dashboard` |
| `audio.routes.js` | `/api/v1/audio` |
| `activity.routes.js` | `/api/v1/activities` |
| `live-class.routes.js` | `/api/v1/live-classes` |
| `import.routes.js` | `/api/v1/import` |
| `audit.routes.js` | `/api/v1/audit` |
| `voice.routes.js` | `/api/v1/voice` |
| `wallet.routes.js` | `/api/v1/wallet` |
| `gift.routes.js` | `/api/v1/gifts` |
| `livekit.routes.js` | `/api/v1/livekit` |
| `dm.routes.js` | `/api/v1/dm` |
| `student-report.routes.js` | `/api/v1/student-reports` |

### Database Schema (READ ONLY — no new migrations that modify existing tables)
| Model | Table |
|-------|-------|
| `User` | `users` |
| `School` | `schools` |
| `SchoolSettings` | `school_settings` |
| `Student` | `students` |
| `Teacher` | `teachers` |
| `Guardian` | `guardians` |
| `Class` | `classes` |
| `Term` | `terms` |
| `Enrollment` | `enrollments` |
| `Attendance` | `attendance` |
| `AttendanceLog` | `attendance_logs` |
| `BehaviorLog` | `behavior_logs` |
| `Grade` | `grades` |
| `GradeCategory` | `grade_categories` |
| `Activity` | `activities` |
| `ActivityParticipant` | `activity_participants` |
| `Message` | `messages` |
| `MessageRecipient` | `message_recipients` |
| `Notification` | `notifications` |
| `CalendarEvent` | `calendar_events` |
| `Note` | `notes` |
| `Announcement` | `announcements` |
| `FileUpload` | `file_uploads` |
| `Report` | `reports` |
| `LibraryBook` | `library_books` |
| `LibraryIssue` | `library_issues` |
| `FeeRecord` | `fee_records` |
| `AudioCategory` | `audio_categories` |
| `AudioCourse` | `audio_courses` |
| `AudioLesson` | `audio_lessons` |
| `VoiceRoom` | `voice_rooms` |
| `VoiceParticipant` | `voice_participants` |
| `VoiceMessage` | `voice_messages` |
| `VoiceHostStats` | `voice_host_stats` |
| `Wallet` | `wallets` |
| `WalletTransaction` | `wallet_transactions` |
| `CoinPackage` | `coin_packages` |
| `Gift` | `gifts` |
| `GiftTransaction` | `gift_transactions` |
| `RoomGiftLeaderboard` | `room_gift_leaderboard` |
| `Follow` | `follows` |
| `FriendRequest` | `friend_requests` |
| `DmConversation` | `dm_conversations` |
| `DirectMessage` | `direct_messages` |
| `UserReport` | `user_reports` |
| `UserBlock` | `user_blocks` |
| `LiveClass` | `live_classes` |
| `LiveClassParticipant` | `live_class_participants` |
| `LiveClassMessage` | `live_class_messages` |
| `LiveClassAttendance` | `live_class_attendance` |
| `LiveClassHandQueue` | `live_class_hand_queue` |
| `RefreshToken` | `refresh_tokens` |
| `OtpCode` | `otp_codes` |
| `AuditLog` | `audit_logs` |

### Socket.IO Events (READ ONLY — never rename, never change payload)
**Live class events:**
- `liveclass:join_room` / `liveclass:leave_room`
- `liveclass:user_joined` / `liveclass:user_left`
- `liveclass:started` / `liveclass:ended`
- `liveclass:scheduled` / `liveclass:updated`
- `liveclass:mute_changed` / `liveclass:mute_all`
- `liveclass:hand_raised` / `liveclass:hand_lowered`
- `liveclass:hand_approved` / `liveclass:hand_rejected`
- `liveclass:you_can_speak` / `liveclass:you_were_kicked`
- `liveclass:kicked` / `liveclass:speak_request`
- `liveclass:message` / `liveclass:open_mic_changed`
- `liveclass:viewmode_changed` / `liveclass:speaking`
- `liveclass:video_changed` / `liveclass:reaction`
- `liveclass:recording_started` / `liveclass:recording_stopped`
- `liveclass:quran_position` / `liveclass:draw` / `liveclass:poll`

**Voice events:**
- `voice:join_room` / `voice:leave_room`
- `voice:speaking` / `voice:reaction`
- `voice:mic_offer` / `voice:mic_accepted` / `voice:mic_declined`
- `voice:kicked` / `voice:promoted_to_speaker`
- `voice:room_created` / `voice:room_updated` / `voice:room_deleted`

**DM events:**
- `dm:message` / `dm:typing_start` / `dm:typing_stop`

**Social events:**
- `social:followed` / `social:friend_request`
- `social:request_accepted` / `social:request_rejected`
- `social:friend_removed`

**System events:**
- `school:join` / `school:leave`
- `class:join` / `class:leave`

### Frontend Pages (READ ONLY — no redesign, no route changes)
All pages under `frontend/src/app/(dashboard)/` and `frontend/src/app/(auth)/` are frozen.

### Redis Keys (READ ONLY)
- `whiteboard:{liveClassId}` — whiteboard snapshot TTL 4h
- All BullMQ queue names are frozen

---

## What Phase B MAY Add (extension only)

New items that may be added **without touching anything above**:

| Category | What can be added |
|----------|-------------------|
| DB | New tables only (no changes to existing) |
| API | New route files + new endpoints (new prefixes) |
| Socket.IO | New event names only |
| Frontend | New pages, new menu items, new components |
| Redis | New cache keys, new queues |

**Phase B scope (Social Platform layer):**
- `Post` model + feed API
- Stories
- Communities / Clubs
- Cross-org user discovery
- Post reactions + comments
- Stripe payment gateway

---

## Change Checklist (required before every future change)

Before modifying **any** file, answer:

- [ ] Will this break an existing API endpoint?
- [ ] Will this change a Prisma model or table?
- [ ] Will this break frontend routing?
- [ ] Will this change authentication or authorization?
- [ ] Will this change a Socket.IO event name or payload?
- [ ] Will this change LiveKit token generation?
- [ ] Will this change Redis key naming?
- [ ] Will this break existing BullMQ queues?

**If ANY answer is YES → STOP. Use extension strategy instead.**

---

*This document is the source of truth for Phase A completion.*  
*Do not modify this file. It is the frozen baseline record.*
