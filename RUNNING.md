# 🚀 Running Halqa Management System

## Prerequisites

| Tool | Version | Status |
|------|---------|--------|
| Node.js | 18+ | Required |
| XAMPP (MySQL) | 8.0+ | Required |
| Redis | 7+ | Optional (system works without it) |

---

## Step 1 — Start XAMPP MySQL

1. Open **XAMPP Control Panel**
2. Click **Start** next to **MySQL**
3. Open **phpMyAdmin** → `http://localhost/phpmyadmin`
4. Create database: click **New** → name it `halqa_db` → **Create**

---

## Step 2 — Backend Setup (first time only)

```bash
cd backend

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run ALL database migrations (creates tables + applies latest changes)


# Seed demo data
node src/prisma/seed.js
```

---

## Step 3 — Start Backend

```bash
cd backend
npm run dev
```

✅ API running at: `http://localhost:5000`  
✅ Swagger docs: `http://localhost:5000/api-docs`

---

## Step 4 — Start Frontend

Open a **new terminal**:

```bash
cd frontend
npm install   # first time only
npm run dev
```

✅ App running at: `http://localhost:3000`

---

## Login Credentials

| Role | Email | Password |
|------|-------|----------|
| Super Admin | superadmin@halqa.com | Admin@2024 |
| School Admin | admin@halqa-academy.com | Admin@2024 |
| Teacher | teacher@halqa-academy.com | Teacher@2024 |
| Student | student1@halqa.com | Student@2024 |
| Guardian | parent@halqa.com | Guardian@2024 |

---

## Connection Architecture

```
Browser (localhost:3000)
    │
    │  HTTP / Socket.IO (polling → WebSocket upgrade)
    ▼
Next.js Frontend (localhost:3000)
    │
    │  REST API + Socket.IO
    ▼
Express Backend (localhost:5000)
    │
    ├── MySQL (XAMPP, localhost:3306)
    └── Redis (optional, localhost:6379)
```

---

## Environment Files

**backend/.env** — already configured for XAMPP:
```
DATABASE_URL="mysql://root:@localhost:3306/halqa_db"
PORT=5000
CLIENT_URL=http://localhost:3000
```

**frontend/.env.local** — already configured:
```
NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1
NEXT_PUBLIC_SOCKET_URL=http://localhost:5000
```

---

## Troubleshooting

**Backend won't start:**
- Make sure XAMPP MySQL is running
- Make sure `halqa_db` database exists in phpMyAdmin
- Run `npx prisma migrate deploy` to apply any pending migrations
- Run `npx prisma generate` to regenerate the Prisma client after schema changes

**Port already in use:**
```bash
# Kill process on port 5000

npx kill-port 5000\


# Kill process on port 3000
non
```

**Frontend shows blank page:**
- Make sure backend is running on port 5000
- Check browser console for CORS errors
- Verify `.env.local` has correct API URL

**Login fails:**
- Make sure seed data was run: `node src/prisma/seed.js`
- Check backend logs for database errors

**WebSocket shows "Invalid frame header" in console:**
- This is cosmetic — Socket.IO connects via HTTP polling first then upgrades
- It resolves automatically and does not affect functionality

---

## ✅ Fix Log (July 2026)

All issues resolved. Run `npx prisma migrate deploy` once in the backend
folder if you haven't already — it applies the `location` field migration.

After the messaging audit sessions, also run:
```bash
cd backend
npx prisma db push   # applies isPinned + parentMessageId schema changes
```

### Backend fixes
| File | Fix |
|------|-----|
| `prisma/schema.prisma` | Added `location String? @db.VarChar(120)` to `Post` model |
| `prisma/migrations/20260724_add_post_location/` | Migration: `ALTER TABLE posts ADD COLUMN location` |
| `controllers/post.controller.js` | `createPost` + `updatePost` now save `location` field |
| `routes/post.routes.js` | Added `location` validation to POST and PATCH |
| `app.js` | Added `feed:join:school` / `feed:leave:school` socket room handlers |
| `controllers/attendance.controller.js` | Fixed P2002/P2025 race condition with retry-upsert pattern |
| `middleware/errorHandler.js` | Catches `PrismaClientValidationError` with 400 instead of 500 |
| `utils/redis.js` | ECONNREFUSED in dev logged as `warn` not `error` (no more log spam) |

### Messaging system fixes (August 2026)| File | Fix |
|------|-----|
| `prisma/schema.prisma` | Added `GroupMessage.isPinned`, `pinnedAt`, `pinnedBy` fields + index |
| `prisma/schema.prisma` | Added `Message.parentMessageId` self-relation for reply threading |
| `controllers/groupChat.controller.js` | Added `deleteGroupMessage` (soft/hard delete), `pinGroupMessage` endpoints |
| `controllers/groupChat.controller.js` | `sendGroupMessage` now creates in-app notifications for offline members |
| `routes/groupChat.routes.js` | Added input validation, rate limiting (60 msg/min), new delete + pin routes |
| `controllers/dm.controller.js` | Fixed `areFriends()` — teachers/admins can DM students in same school; guardians can DM their linked students |
| `controllers/message.controller.js` | `sendMessage` now accepts `parentMessageId`; `getMessage` includes reply thread + parent |

### Frontend fixes
| File | Fix |
|------|-----|
| `app/layout.tsx` | Added `mobile-web-app-capable` meta tag (removes browser deprecation warning) |
| `lib/socket.ts` | Transport order: `polling` first then `websocket` — fixes "Invalid frame header" |
| `components/layout/sidebar.tsx` | Fixed duplicate `/wallet` key; all nav keys now `href__label` composite |
| `components/layout/sidebar.tsx` | Added group chat unread badge (purple) to sidebar Groups nav item |
| `components/feed/PostCard.tsx` | Added full inline Edit post UI (body + visibility, save/cancel) |
| `components/feed/CommentsSection.tsx` | Upgraded to `useInfiniteQuery`, added edit/delete/react per comment |
| `components/feed/ShareMenu.tsx` | "Share to group" now opens real group picker — sends post link to chosen group |
| `app/(dashboard)/layout.tsx` | Mounted `useGroupChatSocket` hook for global group notifications |
| `app/(dashboard)/feed/page.tsx` | Added Trending tab, school socket room, `useSearchParams` Suspense boundary |
| `app/(dashboard)/feed/post/[id]/page.tsx` | New: deep-link page for shared post URLs |
| `app/(dashboard)/group-chat/page.tsx` | **Fixed 4 critical bugs:** response shape, `group:join` socket, typing key, `readBy` mapping |
| `app/(dashboard)/group-chat/page.tsx` | Added: delete message (wired), emoji picker for reactions, add-member UI, pin/unpin |
| `app/(dashboard)/group-chat/page.tsx` | Added: infinite scroll (load more on scroll up), media/file attachment upload |
| `app/(dashboard)/messages/page.tsx` | Fixed `markAsRead` ID bug; added reply threading display; file attachment in compose |
| `app/(dashboard)/dm/page.tsx` | Added file/media attachment button with inline image/video/file rendering |
| `app/(dashboard)/students/page.tsx` | Removed `console.log` stub — bulk message action now opens compose |
| `app/(dashboard)/teachers/page.tsx` | Removed `console.log` stub — bulk message action now opens compose |
| `hooks/useDmSocket.ts` | Guard against Strict Mode double-fetch; `isAuthenticated` check |
| `hooks/useGroupChatSocket.ts` | New: global group chat socket hook — toasts + unread badges when off-page |
| `hooks/useSocial.ts` | Guard against Strict Mode double-fetch; `isAuthenticated` check |
| `hooks/useSocket.ts` | Socket listeners only register after authentication confirmed |
| `lib/groupChat.ts` | Added `deleteMessage`, `pinMessage` API helpers |
| `store/groupChat.store.ts` | Added `removeMessage`, `updateMessagePin` store actions |
| `components/providers.tsx` | `analytics.initialize()` in own effect; `SocketManager` only after auth |

### Mobile fixes
| File | Fix |
|------|-----|
| `src/components/feed/PostCard.tsx` | Full rewrite: media grid (4 layouts), location, 6 reactions, inline comments |
| `app/(tabs)/feed.tsx` | Real-time socket events, new-post banner, school room, error state |
| `app/(tabs)/chat.tsx` | Added `dm:message` + `dm:read` socket listeners — real-time conversation list refresh |
| `app/(tabs)/_layout.tsx` | Fixed broken `@/src/store/voice.store` import → `@/store/voice.store` |
| `app/(tabs)/voice.tsx` | Fixed `@/src/hooks/useDebounce` + `@/src/store/voice.store` imports |
| `app/voice/[id].tsx` | Fixed 4 broken `@/src/` imports (useLiveKitAudio, useNetworkQuality, MicPassModal, voice.store) |
| `app/voice/stats.tsx` | Removed unused `recharts` import (web library, not RN compatible) |
| `app/live-class/[id].tsx` | Fixed 4 broken `@/src/` imports (useLiveKitAudio, PollPanel, QuranPanel, Whiteboard) |
| `app/dm/[id].tsx` | Fixed broken `participants` lookup → uses `other` field from DM conversation response |
| `app/dm/[id].tsx` | Fixed socket handler — now matches `{ convId, message }` payload from backend |
| `app/dm/[id].tsx` | Added `dm:delivered` + `dm:read` socket listeners |
| `app/group-chat/[id].tsx` | Added `group:message_deleted` socket handler |
| `app/post/[id].tsx` | Correct API field names, infinite comments, edit/delete, reply flow |
| `app/(dashboard)/dm/page.tsx` | Added file/media attachment; Suspense boundary for `useSearchParams` |
| `app/(dashboard)/wallet/page.tsx` | Suspense boundary for `useSearchParams` (Next.js 14 requirement) |
| `app/(dashboard)/assignments/page.tsx` | Suspense boundary for `useSearchParams` (Next.js 14 requirement) |
| `app/(dashboard)/students/[id]/report/page.tsx` | **New page**: full printable report card with grades, attendance, behavior summary |
| `app/(dashboard)/students/page.tsx` | Bulk "message" action now opens compose instead of console.log |
| `app/(dashboard)/teachers/page.tsx` | Bulk "message" action now opens compose instead of console.log |
| `hooks/useRealtimeNotifications.ts` | Fixed event name: now listens to `notification:new` (backend emits this, not `notification`) |
| `hooks/useGroupChatSocket.ts` | **New hook**: global group chat socket — unread badges + toasts from any page |
| `lib/groupChat.ts` | Added `deleteMessage`, `pinMessage` API helpers |
| `store/groupChat.store.ts` | Added `removeMessage`, `updateMessagePin` store actions |

### Mobile fixes (August 2026)
| File | Fix |
|------|-----|
| `app/(tabs)/_layout.tsx` | Fixed `@/src/store/voice.store` broken import |
| `app/(tabs)/voice.tsx` | Fixed `@/src/hooks/useDebounce` + `@/src/store/voice.store` broken imports |
| `app/(tabs)/chat.tsx` | Added `dm:message` + `dm:read` socket listeners — real-time list refresh |
| `app/(tabs)/notifications.tsx` | Added `notification:new` socket listener; added missing `useEffect` + `getSocket` imports |
| `app/voice/[id].tsx` | Fixed 4 broken `@/src/` import paths |
| `app/voice/stats.tsx` | Removed unused `recharts` import (web-only library, crashes in React Native) |
| `app/live-class/[id].tsx` | Fixed 4 broken `@/src/` import paths |
| `app/dm/[id].tsx` | Fixed broken `participants` lookup → uses `other` field; fixed socket payload; added `dm:delivered`/`dm:read` |
| `app/group-chat/[id].tsx` | Added `group:message_deleted` socket handler |
