# API Permissions — Per-Route Inventory

Complete per-endpoint permission requirements. Guards listed in the order they execute.

Legend:
- `auth` — `authenticate` middleware (valid JWT + active account)
- `SA` — `authorize('SUPER_ADMIN')`
- `IP` — `ipAllowlist` middleware
- `eduMember` — `requireSchoolMember()`
- `eduStaff` — `requireSchoolMember()` + `requireSchoolRole('TEACHER','SCHOOL_ADMIN','SUPER_ADMIN')`
- `eduAdmin` — `requireSchoolMember()` + `requireSchoolRole('SCHOOL_ADMIN','SUPER_ADMIN')`
- `streamAccess` — `resolveStreamAccess` (PUBLIC=auth; SCHOOL=eduMember)
- `streamStaff` — `resolveStreamStaffAccess` (PUBLIC=hostOnly; SCHOOL=eduStaff)
- `voiceRole(X)` — `checkVoiceRole([X])` — active VoiceParticipant with role X
- `participant` — active participant record required (checked in controller)

---

## Admin Stats — `/api/v1/admin/stats`

| Method | Path | Guards |
|--------|------|--------|
| GET | `/` | IP + auth + SA |
| GET | `/users` | IP + auth + SA |
| PATCH | `/users/:id/status` | IP + auth + SA |
| GET | `/schools` | IP + auth + SA |
| PATCH | `/schools/:id/status` | IP + auth + SA |
| GET | `/audit` | IP + auth + SA |
| GET | `/announcements` | IP + auth + SA |
| GET | `/live-voice` | IP + auth + SA |
| GET | `/gifts` | IP + auth + SA |
| GET | `/payments` | IP + auth + SA |
| GET | `/analytics` | IP + auth + SA |
| GET | `/security` | IP + auth + SA |

---

## Backups — `/api/v1/backups`

| Method | Path | Guards |
|--------|------|--------|
| POST | `/` | IP + auth + SA |
| PUT | `/:id/status` | IP + auth + SA |
| GET | `/` | IP + auth + SA |
| GET | `/:id` | IP + auth + SA |
| DELETE | `/:id` | IP + auth + SA |
| GET | `/stats` | IP + auth + SA |
| POST | `/prune` | IP + auth + SA |

---

## Internal Provisioning — `/api/v1/internal`

| Method | Path | Guards |
|--------|------|--------|
| POST | `/admin/provision` | IP + auth + SA |
| GET | `/admin/list` | IP + auth + SA |

---

## Live Classes — `/api/v1/live-classes`

| Method | Path | Guards | Notes |
|--------|------|--------|-------|
| GET | `/` | auth | Controller filters by school + PUBLIC |
| GET | `/:id` | auth + streamAccess | |
| POST | `/` | auth + (eduStaff if SCHOOL stream) | PUBLIC streams: auth only |
| PATCH | `/:id` | auth + streamStaff | |
| DELETE | `/:id` | auth + streamStaff | |
| POST | `/:id/start` | auth + streamStaff | |
| POST | `/:id/end` | auth + streamStaff | |
| POST | `/:id/join` | auth + streamAccess | Enrollment check in controller for SCHOOL streams |
| POST | `/:id/leave` | auth + streamAccess | |
| POST | `/:id/token` | auth + streamAccess + participant | |
| POST | `/:id/livekit-token` | auth + streamAccess + participant | |
| GET | `/:id/participants` | auth + streamAccess | |
| PATCH | `/:id/participants/:userId/mute` | auth + streamStaff | |
| PATCH | `/:id/participants/:userId/video` | auth + streamAccess | Self-only; SUPER_ADMIN bypass in controller (see known-gaps) |
| PATCH | `/:id/mute-all` | auth + streamStaff | |
| PATCH | `/:id/unmute-all` | auth + streamStaff | |
| DELETE | `/:id/participants/:userId` | auth + streamStaff | |
| POST | `/:id/hand/raise` | auth + streamAccess | |
| POST | `/:id/hand/lower` | auth + streamAccess | |
| POST | `/:id/hand/lower-all` | auth + streamStaff | |
| GET | `/:id/hand/queue` | auth + streamAccess | |
| POST | `/:id/hand/approve/:userId` | auth + streamStaff | |
| POST | `/:id/hand/reject/:userId` | auth + streamStaff | |
| GET | `/:id/messages` | auth + streamAccess | |
| POST | `/:id/messages` | auth + streamAccess | |
| DELETE | `/:id/messages/:messageId` | auth + streamAccess | Controller checks author or host |
| GET | `/:id/attendance` | auth + streamStaff | |
| POST | `/:id/speak-request` | auth + streamAccess | |
| POST | `/:id/open-mic` | auth + streamStaff | |
| POST | `/:id/recording/start` | auth + streamStaff | |
| POST | `/:id/recording/stop` | auth + streamStaff | |
| GET | `/:id/whiteboard/state` | auth + streamAccess | |
| POST | `/:id/whiteboard` | auth + streamStaff | |
| POST | `/:id/poll` | auth + streamStaff | |
| GET | `/:id/poll/state` | auth + streamAccess | |
| POST | `/:id/quran-position` | auth + streamStaff | |
| POST | `/:id/gifts` | auth + checkLiveClassSchool + rateLimit | SCHOOL: same-school; PUBLIC: any auth user |
| POST | `/:id/gifts/all` | auth + checkLiveClassSchool + rateLimit | |
| GET | `/:id/gifts/leaderboard` | auth + checkLiveClassSchool | |
| GET | `/:id/gifts/history` | auth + checkLiveClassSchool | |
| GET | `/:id/gifts/top-supporters` | auth + checkLiveClassSchool | |
| POST | `/:id/cover` | auth + streamStaff | Image upload |

---

## Voice Rooms — `/api/v1/voice`

| Method | Path | Guards | Notes |
|--------|------|--------|-------|
| GET | `/stats/me` | auth | |
| GET | `/stats/leaderboard` | auth | |
| GET | `/` | auth + moderateLimiter | |
| GET | `/search` | auth + moderateLimiter | |
| GET | `/my` | auth + moderateLimiter | |
| GET | `/scheduled` | auth + moderateLimiter | |
| GET | `/:id` | auth + moderateLimiter | |
| POST | `/` | auth + writeLimiter + deviceLimiter | |
| PATCH | `/:id` | auth | Controller checks host ownership |
| DELETE | `/:id` | auth | Controller checks host ownership |
| POST | `/:id/cover` | auth | Controller checks host ownership |
| POST | `/:id/join` | auth | Controller checks bans, room status |
| POST | `/:id/leave` | auth | |
| PATCH | `/:id/end` | auth | Controller checks host ownership |
| PATCH | `/:id/mute` | auth | Controller checks role |
| PATCH | `/:id/raise-hand` | auth | Controller checks AUDIENCE role |
| PATCH | `/:id/promote` | auth | Controller checks HOST/MOD role |
| DELETE | `/:id/kick/:userId` | auth | Controller checks HOST/MOD role |
| POST | `/:id/ban/:userId` | auth | Controller checks HOST/MOD role |
| DELETE | `/:id/ban/:userId` | auth | Controller checks HOST role |
| POST | `/:id/queue/raise` | auth | Controller checks AUDIENCE + micLocked |
| DELETE | `/:id/queue/cancel` | auth | Controller checks own participation |
| POST | `/:id/queue/approve` | auth | Controller checks HOST/MODERATOR |
| POST | `/:id/queue/approve/:userId` | auth | Controller checks HOST/MODERATOR |
| DELETE | `/:id/queue/reject/:userId` | auth | Controller checks HOST/MODERATOR |
| GET | `/:id/queue` | auth | Full queue: HOST/MOD only; own position: audience |
| POST | `/:id/moderator/:userId` | auth + voiceRole(HOST) | Route-level guard |
| DELETE | `/:id/moderator/:userId` | auth + voiceRole(HOST) | Route-level guard |
| POST | `/:id/transfer/:userId` | auth + voiceRole(HOST) | Route-level guard |
| PATCH | `/:id/mute-all` | auth + voiceRole(HOST,MOD) | Route-level guard |
| PATCH | `/:id/unmute-all` | auth + voiceRole(HOST,MOD) | Route-level guard |
| PATCH | `/:id/pin/:userId` | auth + voiceRole(HOST,MOD) | Route-level guard |
| GET | `/:id/participants` | auth | |
| PATCH | `/:id/open-mic` | auth + voiceRole(HOST,MOD) | Route-level guard |
| PATCH | `/:id/mic-lock` | auth + voiceRole(HOST,MOD) | Route-level guard |
| PATCH | `/:id/seat-lock` | auth | Controller checks role |
| POST | `/:id/grab-mic` | auth | Open mic mode; controller checks |
| POST | `/:id/drop-mic` | auth | Controller checks SPEAKER role |
| POST | `/:id/mic-pass/:targetUserId` | auth | Controller checks SPEAKER role |
| POST | `/:id/mic-pass/:offerId/accept` | auth | Controller checks offer recipient |
| POST | `/:id/mic-pass/:offerId/decline` | auth | |
| DELETE | `/:id/mic-pass/:offerId` | auth | Controller checks offer sender |
| GET | `/:id/messages` | auth | |
| POST | `/:id/messages` | auth | |
| DELETE | `/:id/messages/:msgId` | auth | Controller checks host/mod/author |
| GET | `/:id/hand-queue` | auth | Legacy endpoint |
| POST | `/:id/livekit-token` | auth + active participant | |
| POST | `/:id/gifts` | auth + rateLimit | |
| POST | `/:id/gifts/all` | auth + rateLimit | |
| GET | `/:id/gifts/leaderboard` | auth | |
| GET | `/:id/gifts/history` | auth | |
| GET | `/:id/gifts/top-supporters` | auth | |
| GET | `/:id/status` | auth | Lightweight status poll |

---

## LiveKit Generic Token — `/api/v1/livekit`

| Method | Path | Guards | Notes |
|--------|------|--------|-------|
| POST | `/token` | auth | liveclass-* rooms: requires active liveClassParticipant. voice rooms: requires active voiceParticipant. Other rooms: no extra check |

---

## Social — `/api/v1/social`

| Method | Path | Guards |
|--------|------|--------|
| GET | `/search` | auth |
| POST | `/follow/:userId` | auth + followLimit |
| DELETE | `/follow/:userId` | auth + followLimit |
| GET | `/followers/:userId` | auth |
| GET | `/following/:userId` | auth |
| GET | `/counts/:userId` | auth |
| GET | `/friends` | auth |
| GET | `/friends/requests` | auth |
| GET | `/friends/requests/sent` | auth |
| POST | `/friends/request/:userId` | auth + friendLimit |
| POST | `/friends/accept/:userId` | auth |
| POST | `/friends/reject/:userId` | auth |
| DELETE | `/friends/request/:userId` | auth |
| DELETE | `/friends/:userId` | auth |
| POST | `/report/:userId` | auth + reportLimit |
| GET | `/reports` | **auth + SA** |
| PATCH | `/reports/:id/review` | **auth + SA** |
| POST | `/block/:userId` | auth |
| DELETE | `/block/:userId` | auth |
| GET | `/blocked` | auth |
| GET | `/block/:userId/status` | auth |

---

## Users — `/api/v1/users`

| Method | Path | Guards | Notes |
|--------|------|--------|-------|
| GET | `/` | auth + eduAdmin[0] + eduAdmin[1] | School-scoped user list. SUPER_ADMIN sees across schools |
| GET | `/:id` | auth | Own profile: full PII. SUPER_ADMIN: full PII. Others: public profile only |
| PATCH | `/me` | auth | Own profile update |
| DELETE | `/me` | auth | Soft-delete self; blocks active admins |
| GET | `/me/schools` | auth | Own school memberships |
