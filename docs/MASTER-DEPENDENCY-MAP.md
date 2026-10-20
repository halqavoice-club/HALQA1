# HALQA — Cross-Domain Dependency Map

**Version:** 1.0  
**Audit date:** 2026-08-26

---

## Core Dependency Chain

```
User Identity
    │
    ├── Authentication (JWT — auth.middleware.js)
    │       └── Redis auth cache (30s TTL) → MySQL users table
    │
    ├── Platform Role (User.role)
    │       └── SUPER_ADMIN → admin APIs only
    │       └── MEMBER/TEACHER/STUDENT → content participation
    │
    └── School Membership (SchoolMembership table)
            └── schoolAuth.middleware.js
            └── Redis membership cache (30s TTL)
```

---

## Feature Dependency Matrix

### Live Class

| Dependency type | Dependency |
|----------------|-----------|
| Database | `live_classes`, `live_class_participants`, `live_class_messages`, `live_class_hand_queue`, `live_class_attendance` |
| Database (upstream) | `users`, `schools`, `classes`, `students`, `teachers`, `enrollments`, `school_memberships` |
| API | `/api/v1/live-classes/*` |
| Authorization | `authenticate`, `resolveStreamAccess`, `resolveStreamStaffAccess`, `checkLiveClassSchool` |
| Realtime | Socket.IO `liveclass:{id}` room + `school:{schoolId}` + `class:{classId}` + `feed:public` |
| LiveKit | `POST /live-classes/:id/token` → LiveKit SFU |
| External | LiveKit SFU (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`) |
| External | `RoomServiceClient` for kick SFU eviction |
| Notifications | `LIVE_CLASS_START` push via FCM |
| Storage | Cover image upload (R2 or local) |
| Cron | `live-class-schedule-reminder` (every minute) |
| Cron | `live-class-duration-auto-end` (every minute) |
| Redis | Whiteboard/poll state (soft dependency — in-memory fallback) |
| Frontend | `LiveClassRoomImpl.tsx`, `live-class/page.tsx` |
| Mobile | `mobile/app/live-class/[id].tsx` |

---

### Voice Club

| Dependency type | Dependency |
|----------------|-----------|
| Database | `voice_rooms`, `voice_participants`, `voice_room_members`, `voice_messages`, `voice_host_stats` |
| Database (upstream) | `users`, `gift_transactions`, `room_gift_leaderboard` |
| API | `/api/v1/voice/*`, `/api/v1/voice/:id/members` |
| Authorization | `authenticate`, `checkVoiceRole` |
| Realtime | Socket.IO `voice:{roomId}` + `voice:lobby` |
| LiveKit | `POST /voice/:id/livekit-token` → LiveKit SFU |
| External | LiveKit SFU |
| Redis | Speaker queue FIFO (`voice:queue:{roomId}`), room cache (60s TTL) |
| Feed | `feedLive.js` → `LIVE_ROOM_SHARE` post + `feed:live` socket event |
| Notifications | `VOICE_ROOM_LIVE` push |
| Cron | `voice-scheduled-rooms-auto-live` (every minute) |
| Frontend | `VoiceRoomView.tsx`, `useLiveKit.ts`, `useVoiceRoom.ts` |
| Mobile | `mobile/app/voice/[id].tsx`, `useLiveKitAudio.ts` |

---

### Feed + Social

| Dependency type | Dependency |
|----------------|-----------|
| Database | `posts`, `post_media`, `post_reactions`, `post_comments`, `comment_reactions`, `post_hashtags`, `hashtags`, `post_bookmarks`, `post_views`, `post_mentions`, `stories`, `story_views`, `story_reactions`, `follows`, `friend_requests`, `communities`, `community_members`, `user_reports`, `user_blocks`, `notifications` |
| API | `/api/v1/posts/*`, `/api/v1/social/*`, `/api/v1/stories/*`, `/api/v1/explore/*`, `/api/v1/notifications/*`, `/api/v1/report-block/*` |
| Realtime | Socket.IO `feed:public`, `feed:{userId}`, `feed:school:{schoolId}`, `community:{id}` |
| Redis | Trending hashtags cache (5 min TTL), community ban sets |
| Storage | Media uploads (R2 or local) |
| Notifications | FOLLOW, LIKE, COMMENT, MENTION, FRIEND_REQUEST, etc. |
| Search | Elasticsearch (optional) / MySQL LIKE fallback |
| Content filter | `contentFilter.js` — profanity/toxicity check |
| Frontend | `PostCard`, `StoriesBar`, `feed/page.tsx` |
| Mobile | `mobile/app/(tabs)/feed.tsx` |

---

### Payments / Gifts

| Dependency type | Dependency |
|----------------|-----------|
| Database | `wallets`, `wallet_transactions`, `coin_packages`, `gifts`, `gift_transactions`, `room_gift_leaderboard`, `payout_requests` |
| API | `/api/v1/wallet/*`, `/api/v1/stripe/*`, `/api/v1/gifts/*`, `/api/v1/wallet/payout/*` |
| External | Stripe (checkout sessions, webhooks) |
| Realtime | `wallet:{userId}` room — `wallet:coins_credited` event |
| Redis | Gift combo state (soft dependency) |
| Idempotency | `GiftTransaction.idempotencyKey` `@unique`, `WalletTransaction.stripeSessionId` `@unique` |
| Security | STRIPE_WEBHOOK_SECRET for signature verification |
| Frontend | `wallet/page.tsx`, `GiftPanel.tsx` |
| Mobile | Stripe Checkout in embedded browser |

---

### Authentication

| Dependency type | Dependency |
|----------------|-----------|
| Database | `users`, `refresh_tokens`, `otp_codes`, `sessions`, `auth_providers` |
| Redis | Auth user cache (30s TTL) — invalidated on status/role change |
| External | Google OAuth, Apple OAuth (optional) |
| Security | `JWT_SECRET`, `JWT_REFRESH_SECRET` |
| Session limit | `sessions` table via `session.middleware.js` |

---

### School Management

| Dependency type | Dependency |
|----------------|-----------|
| Database | `schools`, `school_memberships`, `classes`, `students`, `teachers`, `guardians`, `terms`, `enrollments` |
| API | `/api/v1/schools/*`, `/api/v1/school-memberships/*`, `/api/v1/classes/*` |
| Authorization | `requireSchoolMember()`, `requireSchoolRole()` — `schoolAuth.middleware.js` |
| Redis | School membership cache (30s TTL) — invalidated on membership change |
| Admin | `GET/PATCH /admin/stats/schools` for platform-level activation |

---

## External Service Dependencies

| Service | Used by | Required for |
|---------|---------|-------------|
| LiveKit SFU | Live Class, Live Stream, Voice Club | Audio/video |
| Stripe | Wallet/Payments | Coin purchases |
| Firebase FCM | Notifications | Push notifications |
| Cloudflare R2 | Uploads | Media in production |
| Redis | Auth, voice queue, memberships, gifts | Performance (soft) |
| Elasticsearch | Search | Full-text search (soft) |
| ClamAV | File uploads | Virus scanning (soft) |
| Twilio | Notifications | SMS (soft) |

---

## Realtime Dependency Chain

```
Socket.IO connection
    ↓
JWT verification (auth middleware)
    ↓
socket.userId + socket.userRole + socket.userSchoolId set
    ↓
Auto-join: user:{userId}, voice:lobby, role:{role}
    ↓
On-demand joins (with server-side DB verification):
    voice:{roomId}          ← VoiceParticipant.isActive
    liveclass:{id}          ← LiveClassParticipant.isActive
    class:{classId}         ← SchoolMembership.status
    school:{schoolId}       ← socket.userSchoolId match
    feed:school:{schoolId}  ← socket.userSchoolId match (SVSV-001 bypass present)
    community:{id}          ← CommunityMember.status + ban check
    conversation:{convId}   ← GroupMember.isActive
    pk:{matchId}            ← PKParticipant or LIVE/ENDED match
    wallet:{userId}         ← self-join
```
