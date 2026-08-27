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
npx prisma migrate deploy

# Seed base data (users, school, roles)
node src/prisma/seed.js

# Seed demo data (grades, attendance, announcements)
node src/prisma/seed-data.js

# Optional: add test coins for gift system testing
node seed-check.js --add-coins
```

---

## Step 3 — Start Backend

> ⚠️ **Important:** Always start the backend with `npm run dev` (not `node src/app.js` directly).
> The `nodemon.json` config sets `--max-old-space-size=512` so Node gets 512MB heap instead
> of the default ~93MB. Without this, the backend will hit memory limits under normal load.

```bash
cd backend
npm run dev
```

✅ API running at: `http://localhost:5000`  
✅ Health check: `http://localhost:5000/health/liveness`  
✅ Swagger docs: `http://localhost:5000/api-docs`

**If the admin dashboard shows "Failed to load admin stats":**

1. Check backend memory: open `http://localhost:5000/health/detailed`
   - If `memory.heapUsagePercent > 90%` → restart the backend
2. Stop backend (`Ctrl+C` in backend terminal)
3. Run: `npm run dev` (picks up 512MB heap from nodemon.json)
4. After restart, in a separate terminal: `npx prisma generate`

**Quick restart** (Windows): double-click `backend/restart-backend.bat`
This script kills port 5000, regenerates Prisma client, then restarts with 512MB heap.

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

### Demo Accounts (Halqa Academy Demo school)

| Role | Email | Password |
|------|-------|----------|
| Super Admin | super.admin@demo.halqa.app | Demo@1234 |
| School Admin | admin@demo.halqa.app | Demo@1234 |
| Teacher | teacher@demo.halqa.app | Demo@1234 |
| Student | student@demo.halqa.app | Demo@1234 |
| Guardian | guardian@demo.halqa.app | Demo@1234 |

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

## Redis (optional but recommended)

Install Redis for Windows via WSL or use the Windows port:
```bash
# Option A — WSL (recommended)
wsl --install
wsl -d Ubuntu -e sudo apt-get install -y redis-server
wsl -d Ubuntu -e sudo service redis-server start

# Option B — Windows binary
# Download from https://github.com/microsoftarchive/redis/releases
# Run: redis-server.exe
```
Without Redis the system runs in-memory fallback mode (rate limiting and caching still work, but do not persist across restarts).

## LiveKit (required for Voice Club + Live Classes)

Voice Club and Live Classes require a LiveKit server. For local development, use LiveKit Cloud:
1. Create a free account at https://livekit.io
2. Get your `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`
3. Add them to `backend/.env`
4. Add `NEXT_PUBLIC_LIVEKIT_URL` to `frontend/.env.local`

Without LiveKit configured, Voice Club and Live Classes will not work.

## Camera & Microphone in Live Classes

Browsers block `getUserMedia()` (camera/mic) on HTTP except on `localhost`.

### ✅ Easiest fix — use localhost

Open the app at **`http://localhost:3000`** (not via IP address). Browsers treat `localhost` as a secure context.

**If you currently open the app via IP (e.g. `http://192.168.1.x:3000`), change to `http://localhost:3000` — camera will work immediately.**

### ✅ HTTPS dev server (needed for phone/tablet access)

The frontend `npm run dev` now starts with HTTPS automatically (`--experimental-https` flag):

```bash
cd frontend
npm run dev
# App runs at https://localhost:3000
```

Accept the self-signed certificate warning in your browser (click "Advanced → Proceed").

For phone access: open `https://<your-PC-IP>:3000` and accept the cert warning.

Update `frontend/.env.local` API URL when using phone:
```
NEXT_PUBLIC_API_URL=http://<your-PC-IP>:5000/api/v1
NEXT_PUBLIC_SOCKET_URL=http://<your-PC-IP>:5000
```

---

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

**Admin dashboard shows "Failed to load admin stats":**
- Open `http://localhost:5000/health/detailed` in browser
- If `memory.heapUsagePercent > 90%`: backend ran out of heap
- Fix: **Ctrl+C** the backend terminal, then `npm run dev` again
- `nodemon.json` has `"exec": "node --max-old-space-size=512"` → 512MB heap
- After restart, run `npx prisma generate` in a separate terminal

**Backend won't start:**
- Make sure XAMPP MySQL is running
- Make sure `halqa_db` database exists in phpMyAdmin
- Run `npx prisma migrate deploy` to apply any pending migrations
- Run `npx prisma generate` to regenerate the Prisma client after schema changes

**Port already in use:**
```bash
# Kill process on port 5000
npx kill-port 5000

# Kill process on port 3000
npx kill-port 3000
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

## ✅ Fix Log (August 2026)

### ARCH-01 — SUPER_ADMIN strict platform separation

**SUPER_ADMIN is now a pure platform administrator and no longer has implicit access to individual school operational data.**

Previously `requireSchoolMember()` injected a synthetic global membership for any SUPER_ADMIN, giving them unrestricted read/write access to every school's students, teachers, grades, and attendance records. This has been removed.

**What changed:**
- `requireSchoolMember()` — removed global bypass; SUPER_ADMIN must have a real `SchoolMembership` record
- `requireSchoolAccess()` — removed bypass
- `assertSchoolAccess()` in live-class controller — removed bypass
- `assertHostAccess()` in live-class controller — removed bypass  
- `listStudents`, `listTeachers`, `getStudent`, `getTeacher`, etc. — removed `...(role !== 'SUPER_ADMIN' && schoolId && { schoolId })` patterns; school filter now always applies
- `listLiveClasses` — SUPER_ADMIN now sees the same filtered view as any user
- School membership approval/role-change routes — `isLegacySuperAdmin` bypass removed; must have an active school membership
- `PUT /schools/:id` and `PUT /schools/:id/settings` — require explicit school membership

**What SUPER_ADMIN can still do (platform admin):**
- All `/admin/*` routes (users, schools list, payments, moderation, system health)
- Emergency live class/voice room termination via admin dashboard
- Social content moderation (post/story/comment deletion)
- User status management (suspend/ban)

**To give a SUPER_ADMIN access to a specific school's operational data:**
```bash
POST /api/v1/school-memberships/invite
{ schoolId: "<id>", userEmail: "admin@halqa.com", role: "SCHOOL_ADMIN" }
```

### Public Live Stream feature
The `stream_type` and `host_user_id` columns were added to `live_classes` via migration
`20260819_add_public_livestream`. These columns ARE in the database but the Prisma
client binary needs regeneration to use them via ORM.

**The controller uses raw SQL as a workaround** — the feature works without any restart.

**To complete the upgrade properly** (one-time, after next backend restart):
```bash
cd backend
# Stop the backend server first, then:
npx prisma generate    # regenerates the Prisma client binary
npm run dev            # restart backend
node test-live-create.js  # verify everything works
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

---

## New Features (Added August 2026)

### 🔐 Two-Factor Authentication (2FA)
Users can enable TOTP-based 2FA from **Settings → Security**.
- Backend: `POST /api/v1/auth/2fa/setup` → `verify` → `disable`
- Web: `/settings/security`
- Requires `otplib` (already installed)

### 💸 Diamond Payout
Hosts can request cash withdrawals for earned diamonds.
- Backend: `POST /api/v1/wallet/payout/request`
- Web: `/wallet/payout`
- Minimum: 2,000 diamonds = $10 USD
- Run migration: `npx prisma migrate deploy` (adds `payout_requests` table)

### 🛡️ Admin Content Moderation
Admins can review and act on reported content.
- Web: `/admin/moderation` (SCHOOL_ADMIN / SUPER_ADMIN only)
- Backend: existing `/api/v1/report-block/reports` endpoint

### ⏰ Scheduled Room Reminders
When creating a scheduled voice room, followers automatically receive push notifications 15 minutes before start.
- Requires Redis + BullMQ (already set up)
- No configuration needed — activates automatically

### 🔍 Elasticsearch Search
Set `ELASTICSEARCH_URL` in `.env` to activate full-text search.
Without it, the app uses MySQL LIKE queries as fallback.

### 📊 Monitoring Alerts
Import `backend/grafana/alert_rules.json` into Grafana to activate Prometheus alert rules for:
- Backend down, high error rate, slow queries, Redis latency, missing backups

---

## Running Tests

```bash
# Backend unit tests
cd backend && npm test

# Backend integration tests (requires MySQL + Redis)
cd backend && npm run test:integration

# Frontend unit + PBT tests
cd frontend && npm test

# Mobile tests
cd mobile && npm test

# Frontend E2E tests (requires running backend + frontend)
cd frontend && npm run test:e2e
```

---

## 🚀 Production Deployment

### Step 1 — Prepare your server

Any Linux VPS with:
- Docker + Docker Compose installed
- Port 80 and 443 open
- At least 2GB RAM (4GB recommended)
- Domain pointed to server IP

### Step 2 — Set up environment

```bash
# On your production server
git clone <your-repo> /opt/halqa
cd /opt/halqa

# Create your production env file from the template
cp .env.docker .env.docker.local

# Fill in ALL values (open with nano/vim)
nano .env.docker.local
```

### Step 3 — Validate all secrets before deploying

```bash
# Run the validator script — catches placeholder values before they cause issues
node scripts/validate-prod-env.js .env.docker.local
```

You must see: `✅ All required environment variables look good.`

If there are errors, fix them before continuing.

### Step 4 — Deploy

```bash
docker-compose -f docker-compose.prod.yml --env-file .env.docker.local up -d --build
```

This will:
1. Build the backend image (runs `npx prisma generate` + installs deps)
2. Build the frontend image (runs `npm run build`)
3. Start MySQL, Redis, backend, frontend, nginx, certbot, db-backup
4. Run `npx prisma migrate deploy` automatically on backend startup
5. Backend starts with `--max-old-space-size=512` (512MB heap)

### Step 5 — Verify

```bash
# Check all containers are running
docker-compose -f docker-compose.prod.yml ps

# Check backend health
curl https://yourdomain.com/api/v1/health

# Check logs if something fails
docker-compose -f docker-compose.prod.yml logs --tail=50 backend
docker-compose -f docker-compose.prod.yml logs --tail=50 frontend
```

### Step 6 — Create first SUPER_ADMIN

```bash
# On the server, get a shell into the backend container
docker exec -it halqa-backend sh

# Inside the container, run the seed
node src/prisma/seed-demo-accounts.js

# Or promote an existing user directly via DB:
# docker exec -it halqa-mysql mysql -u halqa_user -p halqa_db
# UPDATE users SET role='SUPER_ADMIN' WHERE email='your@email.com';
```

### Production Checklist

Before going live, confirm every item:

```
[ ] node scripts/validate-prod-env.js .env.docker.local → passes with 0 errors
[ ] CLIENT_URL is your real domain (https://yourdomain.com)
[ ] STRIPE_SECRET_KEY starts with sk_live_
[ ] STRIPE_WEBHOOK_SECRET starts with whsec_ (from Stripe dashboard, not placeholder)
[ ] ADMIN_IP_ALLOWLIST is set to your VPN/office IP
[ ] JWT_SECRET and JWT_REFRESH_SECRET are 64+ char random strings, different from each other
[ ] MYSQL_ROOT_PASSWORD and MYSQL_PASSWORD are strong unique passwords
[ ] REDIS_PASSWORD is set
[ ] R2_* values point to your real Cloudflare R2 bucket
[ ] docker-compose ps shows all containers healthy
[ ] https://yourdomain.com/api/v1/health returns {"status":"ready"}
[ ] Login works at https://yourdomain.com
[ ] /admin works for SUPER_ADMIN
[ ] School dashboard works for SCHOOL_ADMIN
```

### Updating production after code changes

```bash
cd /opt/halqa
git pull origin main

# Run the env validator first
node scripts/validate-prod-env.js .env.docker.local

# Deploy (migrations run automatically before backend starts)
docker-compose -f docker-compose.prod.yml --env-file .env.docker.local up -d --build --no-deps backend frontend

# Watch logs
docker-compose -f docker-compose.prod.yml logs -f backend
```
