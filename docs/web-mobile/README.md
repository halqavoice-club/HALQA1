# HALQA Web + React Native Mobile — Documentation

**Audit date:** 2026-08-26  
**Status:** Read-only documentation audit. No application code modified.

---

## Web Frontend (Next.js 14 App Router)

**Location:** `frontend/`  
**Framework:** Next.js 14, React 18, TypeScript  
**State:** Zustand + React Query (TanStack Query v5)  
**UI:** Tailwind CSS + shadcn/ui  
**Real-time:** Socket.IO client  
**Media:** LiveKit `livekit-client` SDK

### Complete Route Map

| Route | Purpose | SUPER_ADMIN access |
|-------|---------|-------------------|
| `/feed` | Social feed | Same as any user |
| `/feed/post/[id]` | Single post | Same as any user |
| `/reels` | Video reels | Same as any user |
| `/explore` | Discovery | Same as any user |
| `/social/*` | Follow, friends | Same as any user |
| `/notifications` | Notifications | Same as any user |
| `/communities/[slug]` | Community | Same as any user |
| `/live-class` | Live class list | Same as any user |
| `/live-class/[id]` | Live class room | Same as any user (LCSV-001 violation) |
| `/live-class/camera-test` | Camera test | Same as any user |
| `/voice-club` | Voice room list | Same as any user |
| `/voice-club/[id]` | Voice room | Same as any user |
| `/voice-club/[id]/members` | Room members | Same as any user |
| `/voice-club/stats` | Host stats | Same as any user |
| `/voice-club/pk` | PK lobby | Same as any user |
| `/dm` | Direct messages | Same as any user |
| `/group-chat` | Group chat | Same as any user |
| `/wallet` | Wallet + purchases | Same as any user |
| `/wallet/payout` | Payout requests | Same as any user |
| `/profile` | Own profile | Same as any user |
| `/settings` | User settings | Same as any user |
| `/settings/blocked` | Blocked users | Same as any user |
| `/settings/security` | 2FA, security | Same as any user |
| `/leaderboard` | Leaderboard | Same as any user |
| `/creator` | Creator hub | Same as any user |
| `/admin/*` | **Platform admin** | **SUPER_ADMIN only** |

### Key Frontend Libraries

| File | Purpose |
|------|---------|
| `src/lib/api.ts` | Axios instance with base URL + auth header |
| `src/lib/posts.ts` | Posts API client |
| `src/lib/social.ts` | Social graph API client |
| `src/lib/stories.ts` | Stories API client |
| `src/lib/communities.ts` | Communities API client |
| `src/lib/explore.ts` | Explore API client |
| `src/lib/socket.ts` | Socket.IO client singleton |
| `src/lib/dm.ts` | DM API client |
| `src/lib/groupChat.ts` | Group chat API client |

### Key Stores (Zustand)

| File | State |
|------|-------|
| `store/auth.store.ts` | Current user, authentication state |
| `store/voice.store.ts` | Voice room state |
| `store/school.store.ts` | Active school context |
| `store/social.store.ts` | Social pending count |

---

## Mobile (React Native / Expo)

**Location:** `mobile/`  
**Framework:** Expo SDK, React Native  
**Navigation:** Expo Router (file-based)  
**State:** Zustand + React Query  
**Real-time:** Socket.IO client  
**Media:** `@livekit/react-native-webrtc` (native builds)

### Deep Link Scheme

`halqa://` prefix for all deep links:
- `halqa://feed`
- `halqa://voice/[id]`
- `halqa://live-class/[id]`
- `halqa://community/[slug]`
- `halqa://profile/[id]`

### Mobile Screen Map

| File | Route | Purpose |
|------|-------|---------|
| `app/(tabs)/feed.tsx` | `/` (tab) | Main social feed |
| `app/(tabs)/explore.tsx` | Explore tab | Discovery |
| `app/(tabs)/voice.tsx` | Voice tab | Voice room list |
| `app/voice/[id].tsx` | Voice room | Voice club room |
| `app/live-class/[id].tsx` | Live class | Live class room |
| `app/community/[slug].tsx` | Community | Community screen |
| `app/hashtag/[tag].tsx` | Hashtag | Hashtag feed |
| `app/leaderboard.tsx` | Leaderboard | Platform leaderboard |
| `app/messages.tsx` | DM | Direct messages |
| `app/settings.tsx` | Settings | User settings + school settings |
| `app/create-post.tsx` | Create | Post creation |

### Mobile-Specific Features

| Feature | Implementation |
|---------|---------------|
| Native audio (LiveKit) | `src/hooks/useLiveKitAudio.ts` via `@livekit/react-native-webrtc` |
| Background audio | Native audio session (iOS) / foreground service (Android) |
| Push notifications | FCM via `fcmToken` in `users.fcmToken` |
| Network status | `src/components/NetworkStatusBanner.tsx` — offline indicator |
| Deep links | Expo Router + `_layout.tsx` deep link config |

---

## Shared Patterns

Both web and mobile share:
1. **Same API** — identical REST endpoints
2. **Same Socket.IO** — same event names and room structure
3. **Same auth** — JWT Bearer token stored client-side
4. **Same LiveKit** — same token endpoints, same room names
5. **Same content filter** — server-side, not client-side

Platform differences:
- Web uses `useLiveKit` hook; mobile uses `useLiveKitAudio` hook
- Web has Admin UI (`/admin/*`); mobile has no admin UI
- Web uses `MediaSession API` for lock screen controls; mobile uses native audio session

---

## No Mobile Admin UI

There is no SUPER_ADMIN administration interface in the React Native mobile app. Platform administration is web-only. `mobile/app/settings.tsx` has an `isAdmin` check for school settings, but this is a school-level feature, not platform administration.
