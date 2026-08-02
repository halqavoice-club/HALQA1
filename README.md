# Halqa Management System

A full-stack Islamic school management system with a built-in **Voice Club** — live audio rooms with a complete virtual gift economy.

Built with Next.js 14, Node.js/Express, Prisma ORM, MySQL, Socket.IO, and LiveKit.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Framer Motion |
| Backend | Node.js, Express, Prisma ORM |
| Database | MySQL (XAMPP) |
| Real-time | Socket.IO |
| Audio | LiveKit (WebRTC) |
| Auth | JWT (access + refresh tokens) |
| Cache | Redis (optional — in-memory fallback) |
| Charts | Recharts |
| PDF Export | PDFKit |
| Excel Export | xlsx |
| Enterprise Features | OpenTelemetry, Prometheus, GraphQL, Elasticsearch, BullMQ, ClamAV |

---

## Prerequisites

- Node.js 18+
- XAMPP (MySQL running on port 3306)
- Git

---

## Quick Start

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

# Apply all migrations
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate

# Seed base data (users, school, classes)
node src/prisma/seed.js

# Seed demo data (grades, attendance, announcements)
node src/prisma/seed-data.js

# Add test coins to all users (for gift system testing)
node seed-check.js --add-coins
```

### 4. Start the app

```bash
# Terminal 1 — Backend (port 5000)
cd backend && npm run dev

# Terminal 2 — Frontend (port 3000)
cd frontend && npm run dev
```

Open http://localhost:3000

---

## Demo Accounts

| Role | Email | Password |
|---|---|---|
| Super Admin | superadmin@halqa.com | Admin@2024 |
| School Admin | admin@halqa-academy.com | Admin@2024 |
| Teacher | teacher@halqa-academy.com | Teacher@2024 |
| Student | student1@halqa.com | Student@2024 |
| Guardian | parent@halqa.com | Guardian@2024 |

---

## Features

### 🎙️ Voice Club (Live Audio Rooms)

Real-time voice rooms inspired by TikTok Live + IMO Voice Club.

**Room roles:**
- **HOST** — full control, earns diamonds from gifts
- **MODERATOR** — co-host, can approve queue / mute / kick
- **SPEAKER** — on stage, can speak
- **AUDIENCE** — listen only, can raise hand

**Features:**
- Persistent rooms (never auto-delete when empty)
- Speaker grid (5×2, up to 10 on stage)
- FIFO speaker queue with auto-promote
- Open Mic mode (audience grabs mic instantly)
- Mic pass (speaker passes to audience member)
- Real-time chat with slow mode + message type controls
- Emoji reactions with floating animations
- Room settings (cover image, privacy, topic)
- LiveKit WebRTC audio integration
- Dark / Light mode toggle (☀️/🌙)

### 🎁 Virtual Gift System

Complete virtual economy with real-time animations.

**Economy:**
```
100 coins = $1
Platform cut = 50%
1 coin sent → 0.5 diamonds earned by receiver
Daily spend cap = 50,000 coins
```

**Gift catalog (17 gifts):**

| Gift | Coins | Rarity | Animation |
|------|-------|--------|-----------|
| ☕ Coffee | 5 | common | Bubble pop + steam |
| 🌹 Rose | 5 | common | Float card |
| ❤️ Heart | 10 | common | Float card |
| 👏 Clap | 10 | common | Float card |
| 🔥 Fire | 20 | common | Float card |
| ⭐ Star | 50 | rare | Float card |
| 💎 Diamond | 100 | rare | Banner slide |
| ❤️ Romantic Love | 50 | standard | Hearts radiate |
| 👑 Crown | 200 | epic | Banner slide |
| 🏎️ Racing Car | 200 | rare | Horizontal sweep |
| 🚀 Rocket | 500 | epic | Vertical liftoff |
| 🌌 Galaxy | 1,000 | legendary | Fullscreen |
| 🏆 Trophy | 2,000 | legendary | Fullscreen |
| 🐎 Horse | 500 | epic | Sweep (PREMIUM) |
| 🦁 Lion | 1,000 | legendary | 10s cinematic (PREMIUM) |
| 🏙️ Burj Khalifa | 5,000 | ultimate | 8s cinematic (PREMIUM) |
| 🚀 Rocket Pro | 2,000 | legendary | 8s cinematic (PREMIUM) |

**Smart combo upgrades:**
- ☕ Coffee ×5 → bigger cup | ×10 → coffee rain
- ❤️ Love ×3 → heart burst | ×10 → heart explosion
- 🏎️ Racing ×3 → speed boost + motion blur
- 🚀 Rocket ×3 → screen shake | ×5 → dual trail | ×10 → starburst
- 🦁 Lion ×2 → bigger shockwaves | ×5 → Royal Lion Mode (purple)

**Send modes:**
- Send to HOST only
- Send to specific SPEAKER
- Send to ALL on stage (fans out to every HOST + SPEAKER)

**Coin packages:**
| Package | Coins | Price |
|---------|-------|-------|
| Starter | 100 | $0.99 |
| Popular | 500 + 50 bonus | $4.99 |
| Value | 1,000 + 150 bonus | $9.99 |
| Pro | 5,000 + 1,000 bonus | $49.99 |
| Elite | 10,000 + 3,000 bonus | $99.99 |

### 📚 School Management

**Core Modules:**
- Dashboard — role-specific (Admin, Teacher, Student, Guardian)
- Students — CRUD, enrollment, QR codes, report cards
- Teachers — CRUD, class assignments
- Guardians — CRUD, linked students
- Classes — CRUD, enrollment management

**Academic:**
- Attendance — mark/bulk/QR check-in, calendar, analytics, CSV/Excel/PDF
- Grades — per-student grading, letter grades, GPA, Excel export
- Behavior — positive/negative points, categories, class leaderboard
- Activities — timed sessions (exams, prayer, memorization)

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
- Fee Management — track payments, mark paid/waived
- Library — book catalog, issue/return tracking
- Import/Export — bulk import via Excel
- Audit Logs — full action history
- Multi-school support (Super Admin)

---

## API Reference

### Gift System

```
GET  /api/v1/gifts                          Gift catalog (17 gifts)
GET  /api/v1/gifts/leaderboard/daily        Daily top gifters

GET  /api/v1/wallet/me                      Your coin/diamond balance
GET  /api/v1/wallet/packages                Coin packages
POST /api/v1/wallet/purchase                Purchase coins { packageId }
GET  /api/v1/wallet/history                 Transaction history

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

POST   /api/v1/voice/:id/mic-pass/:userId   Send mic offer
POST   /api/v1/voice/:id/mic-pass/:id/accept  Accept mic offer
POST   /api/v1/voice/:id/mic-pass/:id/decline Decline mic offer

GET    /api/v1/voice/stats/me               Your hosting stats
GET    /api/v1/voice/stats/leaderboard      Top hosts leaderboard
```

### Socket Events

```
# Client → Server
voice:join_room       { roomId }
voice:leave_room      { roomId }
voice:speaking        { roomId, speaking }
voice:reaction        { roomId, emoji }

# Server → Client
voice:user_joined     { roomId, userId, firstName, lastName, role }
voice:user_left       { roomId, userId }
voice:role_changed    { roomId, userId, role }
voice:mute_changed    { roomId, userId, isMuted }
voice:gift_sent       { type, roomId, sender, receiver, gift, count, combo, ... }
voice:gift_all        { type, roomId, sender, receivers[], gift, ... }
voice:gift_received   { ...gift_sent, receiver }
voice:premium_gift    { ...gift_sent } (premium only)
```

---

## Database Schema

16 migrations, 40+ tables including:

```
wallets              coins + diamonds per user
coin_packages        purchasable coin bundles
gifts                gift catalog (17 gifts)
gift_transactions    ledger (idempotency, combo, priority)
room_gift_leaderboard  per-room top gifters
voice_rooms          persistent rooms
voice_participants   role: HOST/MODERATOR/SPEAKER/AUDIENCE
voice_messages       room chat
voice_host_stats     daily hosting analytics
```

---

## Project Structure

```
halqa-ms/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   │   ├── gift.controller.js      Gift send, leaderboard, history
│   │   │   ├── wallet.controller.js    Coin/diamond balance
│   │   │   ├── voice.controller.js     Room CRUD, participants
│   │   │   ├── voice-roles.controller.js  Moderator management
│   │   │   ├── voice-queue.controller.js  FIFO speaker queue
│   │   │   ├── voice-mic.controller.js    Mic pass feature
│   │   │   └── voice-stats.controller.js  Hosting analytics
│   │   ├── routes/
│   │   │   ├── gift.routes.js
│   │   │   ├── wallet.routes.js
│   │   │   └── voice.routes.js
│   │   ├── middleware/
│   │   │   ├── auth.middleware.js
│   │   │   └── voiceRole.middleware.js
│   │   ├── sockets/index.js            Socket.IO event handlers
│   │   └── utils/
│   │       ├── voiceQueue.js           Redis FIFO queue
│   │       └── autoPromote.js          Auto-promote on speaker leave
│   ├── prisma/
│   │   ├── schema.prisma               40+ table schema
│   │   └── migrations/                 16 SQL migrations
│   └── seed-check.js                   DB health check utility
└── frontend/
    └── src/
        ├── components/voice/
        │   ├── VoiceRoomView.tsx        Main room UI (974 lines)
        │   ├── GiftPanel.tsx            Gift bottom sheet
        │   ├── GiftOverlay.tsx          9 animation types router
        │   ├── GiftLeaderboard.tsx      Top supporters widget
        │   ├── PremiumGiftOverlay.tsx   Horse/Lion/Burj animations
        │   ├── RocketAnimation.tsx      Rocket v1 + v2 animations
        │   ├── voice-room.css           Base styles (103 KB)
        │   └── voice-room-dark.css      Light + dark theme (47 KB)
        ├── hooks/useVoiceRoom.ts        All room actions + socket listeners
        └── store/voice.store.ts         Zustand state (room, gifts, wallet)
```

---

## Environment Variables

### Backend (`backend/.env`)

```env
NODE_ENV=development
PORT=5000
CLIENT_URL=http://localhost:3000

DATABASE_URL="mysql://root:@localhost:3306/halqa_db"

JWT_SECRET=change_in_production_32chars
JWT_REFRESH_SECRET=change_in_production_32chars
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

REDIS_URL=redis://localhost:6379   # optional

LIVEKIT_URL=wss://your-livekit-server.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

GIFT_DAILY_CAP=50000   # max coins per user per day
```

### Frontend (`frontend/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1
NEXT_PUBLIC_SOCKET_URL=http://localhost:5000
NEXT_PUBLIC_LIVEKIT_URL=wss://your-livekit-server.livekit.cloud
```

---

## Deployment

### Option A — Railway (Easiest)

1. Push to GitHub
2. New Project → Deploy from GitHub at railway.app
3. Add MySQL plugin → copy `DATABASE_URL`
4. Set environment variables
5. Deploy

### Option B — VPS with PM2

```bash
git clone https://github.com/yourname/halqa-ms.git
cd halqa-ms
cp backend/.env.production.example backend/.env
nano backend/.env   # fill in all values
cd backend && npm run secrets   # generate JWT secrets
pm2 start ecosystem.config.js --env production
pm2 save && pm2 startup
```

### Option C — Docker

```bash
cp .env.docker .env.docker.local
docker-compose -f docker-compose.prod.yml --env-file .env.docker.local up -d
```

### After deployment

```bash
cd backend
npx prisma migrate deploy
npx prisma generate
node src/prisma/seed.js
curl https://yourdomain.com/health
```

---

## Troubleshooting

**Gifts not loading (500 error):**
```bash
cd backend
npx prisma migrate deploy
npx prisma generate
# Restart the server
```

**No coins to send gifts:**
```bash
cd backend
node seed-check.js --add-coins
```

**Check full system state:**
```bash
cd backend
node seed-check.js
```

**MySQL crashes in XAMPP:**
1. Open `C:\xampp\mysql\bin\my.ini`
2. Set `innodb_buffer_pool_size=128M`
3. Restart MySQL

---

## Production Checklist

- [ ] Change all JWT secrets
- [ ] Set `NODE_ENV=production`
- [ ] Configure SMTP provider
- [ ] Set `STORAGE_TYPE=s3` for file uploads
- [ ] Use managed MySQL (PlanetScale, AWS RDS)
- [ ] Set `CLIENT_URL` to your frontend domain
- [ ] Configure LiveKit production server
- [ ] Set `GIFT_DAILY_CAP` appropriately
- [ ] Enable Redis for production caching
