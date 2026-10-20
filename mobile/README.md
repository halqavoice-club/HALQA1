# HALQA Mobile — React Native App

Expo SDK 54 · Expo Router 6 · React Native 0.76 · TypeScript · TanStack Query · Zustand · Socket.IO · LiveKit

**Last updated:** September 2026 — Full parity pass with web frontend completed.

---

## What's New (Sep 2026 Gap-Fix Pass)

### P0 — Critical Fixes
- ✅ Downgraded React 19 → **React 18.3.1** (stable with Expo SDK 54)
- ✅ Fixed `leaderboard.tsx` syntax error (`c/**` → `/**`)

### P1 — Missing Core Flows
- ✅ **Change Password screen** (`/change-password`) — for admin-created accounts
- ✅ **`mustChangePassword` flag** handled in auth store + login redirect
- ✅ **`school.store.ts`** — multi-school context with MMKV persistence
- ✅ **Join School** (`/schools/join`) — search + role select + request
- ✅ **Create School** (`/schools/create`) — full form with timezone
- ✅ **DM Message Edit UI** — long-press own message → edit (CHAT-GAP-002 resolved)

### P2 — Feature Parity
- ✅ **Reels screen** (`/reels`) — vertical snap scroll TikTok-style
- ✅ **Camera Test** (`/live-class/camera-test`) — pre-join mic/camera check
- ✅ **Exams screen** (`/education/exams`) — routes to assignments exams tab
- ✅ **Announcement Detail** (`/education/announcement/[id]`)
- ✅ **Security Settings** (`/security-settings`) — password change, 2FA, sessions
- ✅ **PollCard** in feed — renders polls embedded in posts
- ✅ **LinkPreviewCard** in feed — shows scraped link metadata
- ✅ **MediaViewer lightbox** — `react-native-image-viewing` wired into PostCard
- ✅ **GiftLeaderboard** compact widget in voice room header
- ✅ **RoomSettingsSheet** for voice hosts — chat, seats, message type, members
- ✅ **`notifications.store.ts`** — unread badge synced to tab bar
- ✅ **`pk.store.ts`** — PK match state shared across screens
- ✅ **Reels button** in Feed header + Explore header
- ✅ **Security Settings link** in Settings → Account tab
- ✅ **School join/create links** in Settings → Account tab
- ✅ **Camera test pre-join** — offered when tapping a LIVE class card
- ✅ **Notification badge** on Chat tab from `notifications.store`

---

## Quick Start

### 1. Set your machine's IP address

Open `mobile/.env` and replace `192.168.1.x` with your actual LAN IP:

```
EXPO_PUBLIC_API_URL=http://192.168.1.100:5000/api/v1
EXPO_PUBLIC_SOCKET_URL=http://192.168.1.100:5000
```

> Use `ipconfig` (Windows) to find your IP. Never use `localhost` — it won't work on a physical device.

### 2. Make sure backend is running

```
cd backend
node src/app.js
```

Backend must be on port 5000 and reachable from your device.

### 3. Install dependencies

```
cd mobile
npm install --legacy-peer-deps
```

### 4. Start Expo

```
npx expo start
```

Scan the QR code with **Expo Go** (Android/iOS) or press `a` for Android emulator.

---

## Project Structure

```
mobile/
├── app/                        # Expo Router screens
│   ├── _layout.tsx             # Root layout (auth restore, query client)
│   ├── index.tsx               # Auth redirect entry
│   ├── (auth)/
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   └── forgot-password.tsx
│   ├── (tabs)/                 # Bottom tab navigator
│   │   ├── feed.tsx            # Social feed + stories
│   │   ├── explore.tsx         # Discovery + search
│   │   ├── voice.tsx           # Voice club rooms list
│   │   ├── chat.tsx            # DM conversations
│   │   ├── profile.tsx         # Own profile
│   │   ├── communities.tsx     # Communities browser
│   │   ├── wallet.tsx          # Coins + packages
│   │   ├── notifications.tsx   # All notifications
│   │   └── live-class.tsx      # Live classes list
│   ├── post/[id].tsx           # Post detail + comments
│   ├── profile/[id].tsx        # Public user profile
│   ├── community/[slug].tsx    # Community detail + posts
│   ├── voice/[id].tsx          # Voice room (LiveKit audio)
│   ├── live-class/[id].tsx     # Live class (LiveKit video)
│   ├── story/[userId].tsx      # Story viewer (full-screen)
│   ├── hashtag/[tag].tsx       # Hashtag feed
│   ├── dm/[id].tsx             # DM conversation thread
│   ├── create-post.tsx         # Post composer
│   ├── create-story.tsx        # Story creator
│   ├── education.tsx           # Education hub
│   └── settings.tsx            # Settings + profile edit
├── src/
│   ├── lib/
│   │   ├── api.ts              # Axios + auto-refresh
│   │   ├── socket.ts           # Socket.IO client
│   │   ├── queryClient.ts      # TanStack Query config
│   │   └── avatar.ts           # Avatar URL helpers
│   ├── store/
│   │   └── auth.store.ts       # Zustand auth (SecureStore)
│   ├── hooks/
│   │   └── useDebounce.ts
│   └── components/
│       ├── feed/PostCard.tsx
│       ├── stories/StoriesBar.tsx
│       ├── social/UserCard.tsx
│       └── communities/CommunityCard.tsx
├── assets/                     # icon.png, splash.png, etc.
├── app.json                    # Expo config
├── babel.config.js
├── tsconfig.json
└── .env                        # Environment variables
```

---

## Screen Overview

| Screen | Route | Description |
|--------|-------|-------------|
| Feed | `/feed` | Infinite scroll posts + stories bar |
| Explore | `/explore` | Search people, communities, hashtags |
| Voice | `/voice` | Live voice rooms list |
| Chat | `/chat` | DM conversations |
| Profile | `/profile` | Own profile + stats |
| Communities | `/communities` | Discover & join communities |
| Wallet | `/wallet` | Coins balance + buy packages |
| Notifications | `/notifications` | All alerts with mark-read |
| Live Classes | `/live-class` | Scheduled/live/past classes |
| Post Detail | `/post/[id]` | Full post + comment thread |
| User Profile | `/profile/[id]` | Public profile + follow |
| Community | `/community/[slug]` | Community posts + join |
| Voice Room | `/voice/[id]` | LiveKit audio room |
| Live Class | `/live-class/[id]` | LiveKit video session |
| Story Viewer | `/story/[userId]` | Full-screen story viewer |
| Hashtag Feed | `/hashtag/[tag]` | Posts by hashtag |
| DM Thread | `/dm/[id]` | Real-time message thread |
| Settings | `/settings` | Profile edit + preferences |
| Education | `/education` | Education hub |

---

## Tech Stack

| Library | Purpose |
|---------|---------|
| Expo SDK 52 | Build & native APIs |
| Expo Router 4 | File-based navigation |
| React Native 0.76 | UI framework |
| TanStack Query 5 | Server state + caching |
| Zustand 5 | Client state (auth) |
| Axios | HTTP client with auto-refresh |
| Socket.IO Client | Real-time events |
| @livekit/react-native | Voice & video rooms |
| @stripe/stripe-react-native | Payments |
| expo-secure-store | Secure token storage |
| expo-av | Audio/video playback |
| @expo/vector-icons | Ionicons |
| date-fns | Date formatting |
| react-native-flash-message | Toast notifications |

---

## Environment Variables

```env
EXPO_PUBLIC_API_URL=http://192.168.1.x:5000/api/v1
EXPO_PUBLIC_SOCKET_URL=http://192.168.1.x:5000
EXPO_PUBLIC_LIVEKIT_URL=wss://halqa-voice-club-f0u88j45.livekit.cloud
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

# Public web app origin — used for Voice Club share links (NOT the API URL).
# Dev (emulator):  http://localhost:3000
# Dev (device):    http://192.168.1.x:3000  (same LAN IP as the frontend server)
# Production:      https://your-web-domain.com
EXPO_PUBLIC_WEB_URL=http://localhost:3000
```

> **Important:** `EXPO_PUBLIC_WEB_URL` must point to the **web application** (Next.js frontend),
> not the backend API. Share links take the form `{EXPO_PUBLIC_WEB_URL}/voice-club/{roomId}`.
> Update `eas.json` build profiles with the correct value for each environment.

---

## Build for Android (APK)

Once you have confirmed the app works in Expo Go:

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Configure build
eas build:configure

# Build APK (development)
eas build -p android --profile preview
```

---

## Notes

- **LiveKit audio/video** requires a native build (`expo run:android`), not Expo Go
- **Stripe payments** also require a native build
- All screens work in Expo Go except LiveKit rooms and Stripe checkout
- Test credentials: `superadmin@halqa.com` / `Admin@2024`

---

## ⚠️ React Version Compatibility Note (MOB-006)

`package.json` currently specifies `react: 19.1.0` with `expo: ~54.0.0` (Expo SDK 54).

**Expo SDK 54 officially supports React 18**. React 19 with Expo SDK 54 is experimental and may cause unexpected behavior in production builds — particularly with `expo-router` navigation transitions and Concurrent Mode features.

### Recommended options

**Option A — Downgrade React to 18 (stable, recommended for production):**
```bash
cd mobile
npm install react@18.3.1 react-dom@18.3.1 react-native@0.76.x
```

**Option B — Upgrade Expo SDK (if React 19 features are needed):**
```bash
cd mobile
npx expo upgrade
# Follow the migration guide at https://expo.dev/changelog
```

**Current status:** The app works in development (`expo start`) with React 19. Production APK builds on EAS may encounter edge cases. Run `eas build --platform android --profile preview` to validate before production release.

---

## OTA Updates

Push JavaScript-only changes without rebuilding the APK:
```bash
eas update --channel production --message "description of change"
```
See `BUILD_APK.md` for full details.
