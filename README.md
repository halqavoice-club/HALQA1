# HALQA Platform

A general-purpose social, community, live communication, creator, and learning platform developed by **Ustaaz Abuhureyra Shek Nura**. HALQA enables people to connect, communicate, learn, create, teach, build communities, and earn. School management and Islamic education are supported domains within the platform — they are not the entire product identity.

Built with Next.js 14, Node.js/Express, Prisma ORM 5.x, MySQL 8, Socket.IO 4.x, and LiveKit WebRTC.

> **Full developer setup:** see [`RUNNING.md`](RUNNING.md)\
> **Platform documentation index:** see [`docs/HALQA-MASTER.md`](docs/HALQA-MASTER.md)

---

## Platform Domains

| Domain | Description |
|--------|-------------|
| **Social Feed** | Posts, stories, reels, reactions, comments, bookmarks, hashtags |
| **Communities** | Create and join communities, roles, join requests, invitations, bans |
| **Voice Club** | Live audio rooms with host/speaker/audience roles, gift economy, PK battles |
| **Public Live Streaming** | Any authenticated user can host a public live video broadcast |
| **School Live Classes** | Interactive school video sessions (separate auth model from Voice Club) |
| **Direct Messages** | 1-to-1 DMs with media, reactions, replies, and read receipts |
| **Group Chat** | Multi-user group conversations with roles and media |
| **Creator Economy** | Creator tiers, subscriptions, tips, and fan relationships |
| **Virtual Gift Economy** | Coins, diamonds, 13 gifts, combo animations, payout for hosts |
| **School Management (ERP)** | Students, teachers, guardians, attendance, grades, fees, library, timetables |
| **Islamic Features** | Prayer times (Aladhan API), Hijri date, audio lessons by course/category |
| **Explore & Discovery** | Hashtag trending, suggested users, content discovery |
| **Leaderboard** | Global and school-level rankings |
| **Marketplace** | Product listings and orders |
| **PK Battles** | Real-time competitive battles between Voice Club hosts |
| **Practice Quizzes** | In-app quizzes with attempts and scoring |
| **Analytics** | Platform usage dashboards |
| **Transport** | School bus routing and assignment management |

> Users do not need a school membership to use social, voice, live, messaging, creator, or community features.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14.1.0 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Radix UI, Framer Motion |
| Backend | Node.js (20+ recommended), Express 4.x, Prisma ORM 5.22.0 |
| Database | MySQL 8.0 (XAMPP locally; managed DB in production) |
| Real-time | Socket.IO 4.8.3 (polling → WebSocket upgrade) |
| Audio/Video | LiveKit WebRTC (`livekit-server-sdk ^2.6.1`, `@livekit/components-react`) |
| Auth | JWT (access 15 m + refresh 7 d), bcryptjs, Google OAuth, TOTP 2FA (otplib) |
| State (web) | Zustand + TanStack React Query v5 |
| State (mobile) | Zustand + TanStack React Query v5 |
| Payments | Stripe (`stripe ^17.7.0` + `@stripe/stripe-react-native 0.50.3`) |
| Cache / Queues | Redis + ioredis + BullMQ (in-memory fallback when Redis is absent) |
| Mobile | React Native 0.81.5 (Expo SDK ~54.0.37, expo-router ~6.0.24) |
| Storage | Cloudflare R2 via `@aws-sdk/client-s3` (multer for local dev) |
| Monitoring | OpenTelemetry, Prometheus (`prom-client`), Grafana, Winston |
| Enterprise extras | Apollo GraphQL, Elasticsearch, BullMQ workers, ClamAV |
| Testing (backend) | Jest 29 + Supertest |
| Testing (frontend) | Jest 30 + Testing Library + Playwright 1.45.3 |
| Testing (mobile) | Jest + jest-expo + Testing Library React Native |

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | **20+** (22 recommended) | CI validates 20 and 22. Node 18 is untested. |
| XAMPP (MySQL) | 8.0+ | Required for local development |
| Git | Any recent | — |
| Redis | 7+ | **Optional** in development (in-memory fallback active). **Recommended** in production — without Redis, speaker queues, trending hashtags, community bans, and auth caching degrade to database fallback. |
| Expo CLI | Via `npx` | Required for mobile development only |

---

## Quick Start

> For the complete step-by-step setup guide (including screenshots and troubleshooting), see [`RUNNING.md`](RUNNING.md).

### 1. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Create database

```sql
-- In XAMPP phpMyAdmin or MySQL CLI:
CREATE DATABASE halqa_db;
```

### 3. Run migrations & seed

```bash
cd backend

# Apply all migrations (creates all tables)
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate

# Seed base data (users, school, classes)
# ⚠️ Creates demo accounts with known passwords, including a SUPER_ADMIN account.
# See the "Demo Accounts" section below before running on any shared environment.
node src/prisma/seed.js

# Seed demo data (grades, attendance, announcements)
node src/prisma/seed-data.js

# Seed gift catalog and coin packages (required for gift system)
npm run seed:gifts

# ⚠️ DEVELOPMENT ONLY — adds test coins to all users.
# Do NOT run this against a production or staging database.
node seed-check.js --add-coins
```

### 4. Start the app

```bash
# Terminal 1 — Backend (port 5000)
cd backend && npm run dev

# Terminal 2 — Frontend (port 3000)
cd frontend && npm run dev
```

Open http://localhost:3000\
Swagger API docs: http://localhost:5000/api-docs

### 5. Mobile app (optional)

Prerequisites: a physical device or emulator with the **Expo Go** app installed.

```bash
cd mobile && npm install

# Copy the environment template
# (edit .env and replace YOUR_LAN_IP with your machine's local IP)
cp .env.example .env

npm start   # starts the Expo dev server
```

See [`mobile/MOBILE_INTEGRATION.md`](mobile/MOBILE_INTEGRATION.md) for the mobile setup guide, dual-domain architecture notes, and LAN IP configuration.

---

## Demo Accounts

> ⚠️ **Security warning:** These accounts are created by `node src/prisma/seed.js`.
> The `superadmin@halqa.com` account has platform-wide **SUPER_ADMIN** access.
> **Delete or rotate all demo account passwords before any internet-facing deployment.**
> Do not run `seed.js` against an existing production database.

| Role | Email | Password |
|------|-------|----------|
| Super Admin | superadmin@halqa.com | Admin@2024 |
| School Admin | admin@halqa-academy.com | Admin@2024 |
| Teacher | teacher@halqa-academy.com | Teacher@2024 |
| Student | student1@halqa.com | Student@2024 |
| Guardian | parent@halqa.com | Guardian@2024 |

---

## Features

### 🎙️ Voice Club (Live Audio Rooms)

Real-time voice rooms backed by LiveKit WebRTC, inspired by TikTok Live audio rooms.

**Room roles:**
- **HOST** — full control, earns diamonds from gifts
- **MODERATOR** — co-host, can approve queue / mute / kick
- **SPEAKER** — on stage, can speak
- **AUDIENCE** — listen only, can raise hand

**Features:**
- Persistent rooms (never auto-delete when empty)
- Speaker stage — up to 12 speakers (configurable via `maxSpeakers`)
- FIFO speaker queue with auto-promote
- Open Mic mode (audience grabs mic instantly)
- Mic pass (speaker passes to audience member)
- Mic lock and seat lock controls
- Room pin protection
- Real-time chat with slow mode and message type controls
- Emoji reactions with floating animations
- Room settings (cover image, privacy, topic)
- Room members panel (persistent membership)
- Share Voice Club room via DM
- PK Battles (real-time competitive battles between hosts)
- LiveKit WebRTC audio integration
- Dark / Light mode toggle

### 🎁 Virtual Gift System

Complete virtual economy with real-time animations. See [`docs/gifts-payments/README.md`](docs/gifts-payments/README.md) for the full architecture.

**Economy:**
```
100 coins = $1
Platform cut = 50%
1 coin sent → 0.5 diamonds earned by receiver
Daily spend cap = 50,000 coins (configurable via GIFT_DAILY_CAP)
Diamonds can be withdrawn as cash via the payout system
```

**Gift catalog (13 gifts — authoritative source: `backend/src/prisma/seed-gifts.js`):**

| Gift | Coins | Rarity | Animation type |
|------|-------|--------|----------------|
| ☕ Coffee | 1 | common | Bubble pop |
| 🌹 Rose | 5 | common | Float card |
| ❤️ Romantic Love | 10 | standard | Avatar hearts effect |
| 🎙️ Golden Mic | 20 | standard | Float card |
| ⭐ Star | 50 | rare | Spotlight float card |
| 💎 Diamond | 100 | rare | Banner slide |
| 🚀 Rocket | 200 | epic | Rocket launch animation |
| 👑 Crown | 300 | epic | Banner slide |
| 🏎️ Racing Car | 500 | epic | Horizontal sweep |
| 🌌 Galaxy | 999 | legendary | Fullscreen |
| 🐎 Horse | 500 | legendary | Float card (PREMIUM) |
| 🦁 Lion | 1,000 | legendary | Fullscreen cinematic (PREMIUM) |
| 🏙️ Burj Khalifa | 5,000 | ultimate | Cinematic (PREMIUM) |

> Gift prices and catalog are seeded by `npm run seed:gifts` and stored in the database. The table above reflects `seed-gifts.js` at the time of this writing. If the catalog has been updated in the database, query `GET /api/v1/gifts` for the live values.

**Send modes:**
- Send to HOST only
- Send to specific SPEAKER
- Send to ALL on stage (fans out to every HOST + SPEAKER)

**Coin packages (authoritative source: `backend/src/prisma/seed-gifts.js`):**

| Package | Coins | Bonus | Price |
|---------|-------|-------|-------|
| Starter | 100 | 0 | $0.99 |
| Basic | 500 | +50 | $4.99 |
| Popular | 1,000 | +150 | $9.99 |
| Value | 2,500 | +500 | $19.99 |
| Premium | 5,000 | +1,500 | $39.99 |
| Ultimate | 10,000 | +4,000 | $79.99 |

### 📚 School Management

School management and education features are optional, school-scoped modules. Users without a school membership can still use all social, voice, live, and creator features.

**Core Modules:**
- Dashboard — role-specific (Admin, Teacher, Student, Guardian)
- Students — CRUD, enrollment, QR codes, report cards
- Teachers — CRUD, class assignments
- Guardians — CRUD, linked students
- Classes — CRUD, enrollment management
- School Memberships — authoritative source for school-scoped roles

**Academic:**
- Attendance — mark/bulk/QR check-in, calendar, analytics, CSV/Excel/PDF
- Grades — per-student grading, letter grades, GPA, Excel export
- Behavior — positive/negative points, categories, class leaderboard
- Activities — timed sessions (exams, prayer, memorization)
- Assignments & Exams — submission tracking
- Practice Quizzes — in-app quizzes with attempts and scoring

**Communication:**
- Messages — real-time inbox with Socket.IO
- Announcements — pinned notices with target audience
- Notifications — auto-generated alerts
- Calendar — school events with monthly grid

**Islamic Features:**
- Audio Lessons — upload/stream MP3s by course & category
- Prayer Times — live via Aladhan API
- Hijri Date — displayed on dashboards

**Administration:**
- Fee Management — track payments, mark paid/waived, Stripe integration
- Library — book catalog, issue/return tracking
- Import/Export — bulk import via Excel
- Audit Logs — full action history
- Transport — school bus routes and assignments
- Multi-school support (Super Admin)

---

## API Reference

> **Full interactive API reference:** [`http://localhost:5000/api-docs`](http://localhost:5000/api-docs) (Swagger UI — requires running backend)

### Gift System

```
GET  /api/v1/gifts                          Gift catalog (live database values)
GET  /api/v1/gifts/leaderboard/daily        Daily top gifters

GET  /api/v1/wallet/me                      Your coin/diamond balance
GET  /api/v1/wallet/packages                Coin packages
GET  /api/v1/wallet/history                 Transaction history

# Production coin purchase (requires Stripe configuration):
POST /api/v1/stripe/checkout                Create Stripe checkout session { packageId }

# ⚠️ Development only — grants coins without payment. Returns HTTP 403 in production:
POST /api/v1/wallet/purchase                Dev coin grant { packageId }

POST /api/v1/voice/:id/gifts                Send gift { giftId, receiverId, count }
POST /api/v1/voice/:id/gifts/all            Send to all on stage { giftId, count }
GET  /api/v1/voice/:id/gifts/leaderboard    Room top gifters
GET  /api/v1/voice/:id/gifts/history        Room gift log
GET  /api/v1/voice/:id/gifts/top-supporters Top 3 supporters
```

### Voice Club

```
GET    /api/v1/voice                        List rooms
POST   /api/v1/voice                        Create room
GET    /api/v1/voice/:id                    Get room with participants
POST   /api/v1/voice/:id/join               Join room
POST   /api/v1/voice/:id/leave              Leave room
PATCH  /api/v1/voice/:id/end                End room (host only)
POST   /api/v1/voice/:id/livekit-token      Get LiveKit audio token

PATCH  /api/v1/voice/:id/mute               Toggle mute
PATCH  /api/v1/voice/:id/promote            Promote participant
DELETE /api/v1/voice/:id/kick/:userId       Kick participant
PATCH  /api/v1/voice/:id/mute-all           Mute all speakers

POST   /api/v1/voice/:id/queue/raise        Raise hand (join queue)
DELETE /api/v1/voice/:id/queue/cancel       Cancel queue position
POST   /api/v1/voice/:id/queue/approve      Approve next in queue
GET    /api/v1/voice/:id/queue              Get queue

POST   /api/v1/voice/:id/moderator/:userId  Assign moderator
DELETE /api/v1/voice/:id/moderator/:userId  Remove moderator
POST   /api/v1/voice/:id/transfer/:userId   Transfer host ownership

PATCH  /api/v1/voice/:id/open-mic           Toggle open mic
POST   /api/v1/voice/:id/grab-mic           Grab mic (audience)
POST   /api/v1/voice/:id/drop-mic           Drop mic (speaker)

POST   /api/v1/voice/:id/mic-pass/:userId       Send mic offer
POST   /api/v1/voice/:id/mic-pass/:id/accept    Accept mic offer
POST   /api/v1/voice/:id/mic-pass/:id/decline   Decline mic offer

GET    /api/v1/voice/stats/me               Your hosting stats
GET    /api/v1/voice/stats/leaderboard      Top hosts leaderboard
```

All endpoints require `Authorization: Bearer <access_token>`. See Swagger UI for full request/response schemas and error codes.

### Socket Events

> **Complete socket event catalog with payloads:** [`docs/authorization/realtime-event-catalog.md`](docs/authorization/realtime-event-catalog.md)

```
# Client → Server (selected)
voice:join_room       { roomId }
voice:leave_room      { roomId }
voice:speaking        { roomId, speaking }
voice:reaction        { roomId, emoji }
liveclass:join_room   liveClassId
dm:typing_start       { convId, receiverId }
group:typing_start    { convId, name, userName }

# Server → Client (selected)
voice:user_joined     { roomId, userId, firstName, lastName, role }
voice:user_left       { roomId, userId }
voice:role_changed    { roomId, userId, role }
voice:mute_changed    { roomId, userId, isMuted }
voice:gift_sent       { type, roomId, sender, receiver, gift, count, combo, ... }
voice:gift_all        { type, roomId, sender, receivers[], gift, ... }
voice:premium_gift    { ...gift_sent } (premium gifts only)
voice:status_changed  { roomId, status }
liveclass:ended       { liveClassId, reason }
```

> ⚠️ **Known defect (tracked separately):** The server emits `gift:received` on a private `user:{id}` socket room when a user receives a gift. The voice-room client (`useVoiceRoom.ts`) listens on `voice:gift_received`. These do not match — the wallet-balance refresh on receipt does not fire. This is a code defect, not a documentation issue; it requires changes to `backend/src/controllers/gift.controller.js` and `frontend/src/hooks/useVoiceRoom.ts` and is tracked separately.

---

## Database Schema

99 migrations, 140 Prisma models. See [`docs/authorization/database-model-inventory.md`](docs/authorization/database-model-inventory.md) for the full schema inventory.

Key tables for the gift and voice systems:

```
wallets                   coins + diamonds per user
coin_packages             purchasable coin bundles
gifts                     gift catalog (seeded by seed-gifts.js)
gift_transactions         ledger (idempotency, combo, priority)
room_gift_leaderboard     per-room top gifters
user_daily_gift_spend     daily spend cap enforcement
payout_requests           diamond → cash withdrawal requests
voice_rooms               persistent rooms
voice_participants        role: HOST/MODERATOR/SPEAKER/AUDIENCE
voice_room_members        persistent room membership
voice_messages            room chat
voice_host_stats          daily hosting analytics
```

---

## Project Structure

```
halqa-ms/
├── backend/
│   ├── src/
│   │   ├── app.js                  Express entry point, Socket.IO setup,
│   │   │                           and all socket event handlers
│   │   ├── controllers/            48 controller files, one per domain
│   │   ├── routes/                 59 route files, mounted under /api/v1/
│   │   ├── middleware/
│   │   │   ├── auth.middleware.js
│   │   │   ├── voiceRole.middleware.js
│   │   │   └── validators/
│   │   ├── services/               Business logic extracted from controllers
│   │   ├── sockets/index.js        Socket.IO utility — exports getIo()
│   │   │                           (event handlers are registered in app.js)
│   │   ├── workers/                BullMQ background job workers
│   │   ├── graphql/                Apollo GraphQL schema + resolvers
│   │   └── utils/                  Redis, voiceQueue, autoPromote, sms, etc.
│   ├── prisma/
│   │   ├── schema.prisma           140 models — single source of truth
│   │   └── migrations/             99 SQL migrations
│   └── seed-check.js               ⚠️ Test utility — adds coins to all users
│                                   (development/staging only)
├── frontend/
│   └── src/
│       ├── app/                    Next.js App Router pages
│       │   ├── (auth)/             Login, register, forgot-password
│       │   └── (dashboard)/        All authenticated pages
│       ├── components/             Shared + feature-specific components
│       │   ├── voice/              Voice room components
│       │   ├── live-class/         Live class components
│       │   └── ui/                 shadcn/ui primitives
│       ├── hooks/                  Custom React hooks
│       ├── store/                  Zustand stores
│       ├── lib/                    API client helpers, socket singleton
│       └── types/                  TypeScript type definitions
├── mobile/                         React Native (Expo) app
│   ├── app/                        expo-router file-based routing
│   ├── src/
│   │   ├── components/             Shared RN components
│   │   ├── hooks/                  Custom hooks (useLiveKitAudio, etc.)
│   │   └── store/                  Zustand stores
│   └── MOBILE_INTEGRATION.md       Mobile setup and dual-domain guide
├── docs/                           Architecture and feature documentation
├── scripts/                        Backup, restore, deployment scripts
├── nginx/                          Nginx config for Docker production
├── mysql-init/                     MySQL init scripts for Docker
├── .github/                        CI/CD workflows (ci.yml, deploy.yml)
├── ecosystem.config.js             PM2 process manager config
└── docker-compose*.yml
```

> The controller and route directories are large. Browse `backend/src/controllers/` and `backend/src/routes/` directly — the lists above are not exhaustive.

---

## Environment Variables

> **Complete variable inventory with descriptions:** [`backend/.env.example`](backend/.env.example)

### Backend (`backend/.env`)

```env
NODE_ENV=development
PORT=5000
CLIENT_URL=http://localhost:3000

DATABASE_URL="mysql://root:@localhost:3306/halqa_db"

# ⚠️ These placeholder values are publicly known strings.
# Generate real secrets before any deployment:
#   cd backend && npm run secrets
JWT_SECRET=change_in_production_use_npm_run_secrets
JWT_REFRESH_SECRET=change_in_production_use_npm_run_secrets
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

REDIS_URL=redis://localhost:6379   # optional in dev

LIVEKIT_URL=wss://your-livekit-server.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

GIFT_DAILY_CAP=50000   # max coins per user per day
```

**Additional required variables for full functionality:**

| Variable | Purpose | Production impact if absent |
|----------|---------|----------------------------|
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Email (OTP, notifications) | OTP and notification emails fail silently |
| `GOOGLE_CLIENT_ID` | Google OAuth login | Google sign-in unavailable |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | SMS OTP | SMS disabled; email OTP only |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` | Payments | Coin purchases unavailable |
| `STORAGE_TYPE=r2` + `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` | File storage | Uploads broken in production |
| `PAYOUT_ENCRYPTION_KEY` | Payout account encryption | **All payout requests return HTTP 503** |
| `TOTP_ENCRYPTION_KEY` | 2FA secret encryption | Falls back to JWT_SECRET (weaker) |
| `HEALTH_TOKEN` | Protects `/health/detailed` | Endpoint blocked |
| `METRICS_TOKEN` | Protects `/metrics` | Prometheus endpoint unprotected or blocked |
| `ADMIN_IP_ALLOWLIST` | Restricts admin routes | Admin APIs accessible from all IPs |
| `CONTENT_FILTER_ENABLED` | Content moderation | Moderation disabled |

> ⚠️ **`STRIPE_SKIP_SIGNATURE`** bypasses Stripe webhook signature verification. It **must never be set in production or staging**. Use only with the Stripe CLI in local development.

See `backend/.env.example` for the full list with documentation and setup instructions.

### Frontend (`frontend/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1
NEXT_PUBLIC_SOCKET_URL=http://localhost:5000
NEXT_PUBLIC_LIVEKIT_URL=wss://your-livekit-server.livekit.cloud
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id
```

### Mobile (`mobile/.env`)

```env
EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:5000/api/v1
EXPO_PUBLIC_SOCKET_URL=http://YOUR_LAN_IP:5000
EXPO_PUBLIC_WEB_URL=http://localhost:3000
EXPO_PUBLIC_LIVEKIT_URL=wss://your-livekit-server.livekit.cloud
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

> Use your machine's LAN IP (not `localhost`) — a physical device cannot reach `localhost`. See [`mobile/MOBILE_INTEGRATION.md`](mobile/MOBILE_INTEGRATION.md).

---

## Deployment

> **Full deployment guide:** [`docs/deployment/README.md`](docs/deployment/README.md)

### Option A — Railway (Easiest)

1. Push to GitHub
2. New Project → Deploy from GitHub at railway.app
3. Add a MySQL 8.0 plugin → copy `DATABASE_URL`
4. Set all environment variables (see section above)
5. Deploy

> Railway deployment details and migration procedures are documented in [`docs/deployment/README.md`](docs/deployment/README.md).

### Option B — VPS with PM2

```bash
git clone https://github.com/yourname/halqa-ms.git
cd halqa-ms
cp backend/.env.production.example backend/.env
nano backend/.env          # fill in all values
cd backend && npm run secrets   # generate JWT secrets

# Build the frontend before starting PM2
cd ../frontend && npm run build
cd ..

pm2 start ecosystem.config.js --env production
pm2 save && pm2 startup
```

### Option C — Docker

```bash
cp .env.docker .env.docker.local
# Edit .env.docker.local with your production values
docker-compose -f docker-compose.prod.yml --env-file .env.docker.local up -d
```

### After deployment

```bash
cd backend
npx prisma migrate deploy
npx prisma generate

# ⚠️ First-time setup only — creates demo accounts with known passwords.
# See "Demo Accounts" section above. Delete or rotate demo accounts
# immediately after first-time setup. Do NOT run on an existing production DB.
node src/prisma/seed.js

# Seed the gift catalog (safe to run on any environment — uses upsert):
npm run seed:gifts

curl https://yourdomain.com/health
```

---

## Troubleshooting

**Gifts not loading (empty gift panel or 500 error):**
```bash
cd backend
npx prisma migrate deploy
npx prisma generate
npm run seed:gifts   # populates gift catalog and coin packages
# Restart the server
```

**No coins to send gifts:**
```bash
cd backend
# ⚠️ Development/staging only — grants coins to ALL users.
node seed-check.js --add-coins
```

**Check full system state:**
```bash
cd backend
node seed-check.js
```

**MySQL crashes in XAMPP (Windows only):**
1. Open `C:\xampp\mysql\bin\my.ini`
2. Set `innodb_buffer_pool_size=128M`
3. Restart MySQL

**Voice Club / Live Classes not working:**
- Confirm `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` are set in `backend/.env`
- Confirm `NEXT_PUBLIC_LIVEKIT_URL` is set in `frontend/.env.local`
- Test connectivity: `GET http://localhost:5000/health/detailed` — look for `"livekit": { "status": "ok" }`
  (requires `HEALTH_TOKEN` to be set — see `backend/.env.example`)
- Sign up free at https://livekit.io to get credentials

**SMS OTP not sending:**
- Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` in `backend/.env`
- Without these, OTPs are sent via email only — SMS is silently disabled

**Payout requests returning 503:**
- `PAYOUT_ENCRYPTION_KEY` is not set in `backend/.env`
- Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Add it to `backend/.env` and restart the server

**Alerts / monitoring not firing:**
- Set `SLACK_WEBHOOK_URL` in `backend/.env` to receive production alerts
- Import `backend/grafana/alert_rules.json` into Grafana
- See [`docs/SCALING.md`](docs/SCALING.md) for full monitoring setup

---

## Testing

### Backend
```bash
cd backend
npm run test:unit           # unit tests only (mocked deps, fast)
npm run test:integration    # requires running MySQL + Redis
npm run test:coverage       # unit tests + coverage report
```

### Frontend
```bash
cd frontend
npm test                    # Jest unit tests
npm run test:coverage       # Jest + coverage
npm run test:e2e            # Playwright E2E (requires running backend + frontend)
```

### Mobile
```bash
cd mobile
npm test                    # Jest unit tests
```

CI pipeline (`.github/workflows/ci.yml`) runs backend unit tests, frontend type-check + lint + Jest, mobile type-check + lint + Jest, Docker build tests, and Playwright E2E on every push to `main` and `develop`. See [`docs/deployment/README.md`](docs/deployment/README.md) for the full CI/CD pipeline description.

---

## Documentation

| Document | Contents |
|----------|---------|
| [`RUNNING.md`](RUNNING.md) | Complete local dev setup guide |
| [`docs/HALQA-MASTER.md`](docs/HALQA-MASTER.md) | Platform documentation master index |
| [`docs/deployment/README.md`](docs/deployment/README.md) | Deployment, CI/CD, production rules |
| [`docs/SCALING.md`](docs/SCALING.md) | Horizontal scaling, Redis cluster, Elasticsearch, load testing |
| [`docs/authorization/realtime-event-catalog.md`](docs/authorization/realtime-event-catalog.md) | Complete Socket.IO event catalog with payloads |
| [`mobile/MOBILE_INTEGRATION.md`](mobile/MOBILE_INTEGRATION.md) | Mobile setup, dual-domain architecture, LAN dev |
| [`HALQA_FULL_AUDIT_REPORT.md`](HALQA_FULL_AUDIT_REPORT.md) | August 2026 security and performance audit |
| [`AUDIT_REPORT.md`](AUDIT_REPORT.md) | July 2026 auth / mobile APK audit |
| [`scripts/restore.sh`](scripts/restore.sh) | Database restore procedure |
| [`backend/grafana/alert_rules.json`](backend/grafana/alert_rules.json) | Prometheus alert rules for Grafana |
| `http://localhost:5000/api-docs` | Swagger UI — interactive API reference (requires running backend) |

---

## Production Checklist

- [ ] Generate JWT secrets — `cd backend && npm run secrets`
- [ ] Set `NODE_ENV=production`
- [ ] **Delete or rotate all demo seed accounts** (created by `node src/prisma/seed.js`)
- [ ] Configure SMTP provider (Gmail or SendGrid) — `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`
- [ ] Set `GOOGLE_CLIENT_ID` for Google OAuth
- [ ] Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`
- [ ] Set `STORAGE_TYPE=r2` and configure all Cloudflare R2 credentials
- [ ] Use managed MySQL 8.0 (PlanetScale, AWS RDS, or MariaDB with connection pool)
- [ ] Add `?connection_limit=25&pool_timeout=10` to `DATABASE_URL`
- [ ] Set `CLIENT_URL` to your frontend domain
- [ ] Configure LiveKit production server and set all three LiveKit env vars
- [ ] Set `GIFT_DAILY_CAP` appropriately for your user base
- [ ] Enable Redis with `REDIS_PASSWORD` — required for speaker queues, trending, community bans
- [ ] Set `PAYOUT_ENCRYPTION_KEY` — **required or all payout requests return HTTP 503**
- [ ] Set `TOTP_ENCRYPTION_KEY` — required for secure 2FA storage
- [ ] Set `METRICS_TOKEN` to protect the `/metrics` endpoint
- [ ] Set `HEALTH_TOKEN` to protect the `/health/detailed` endpoint
- [ ] Set `ADMIN_IP_ALLOWLIST` to your office/VPN IP
- [ ] Set `SLACK_WEBHOOK_URL` for production alerting
- [ ] **Never set `STRIPE_SKIP_SIGNATURE` in production or staging**
- [ ] Build the frontend before PM2 start — `cd frontend && npm run build`
- [ ] Import `backend/grafana/alert_rules.json` into Grafana
- [ ] Run `sh scripts/restore.sh` monthly to verify backup integrity
