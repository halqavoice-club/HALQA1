# Tech Stack & Build System

## Stack Overview

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Radix UI, Framer Motion |
| Backend | Node.js, Express, Prisma ORM 5.x |
| Database | MySQL 8 (XAMPP locally; managed DB in production) |
| Real-time | Socket.IO 4.x (polling → WebSocket upgrade) |
| Audio/Video | LiveKit WebRTC (`livekit-server-sdk`, `@livekit/components-react`) |
| Auth | JWT (access 15m + refresh 7d), bcryptjs, Google OAuth, TOTP 2FA (otplib) |
| State (web) | Zustand + TanStack React Query |
| State (mobile) | Zustand + TanStack React Query |
| Payments | Stripe (`stripe` SDK + `@stripe/stripe-react-native`) |
| Cache / Queues | Redis + ioredis + BullMQ (in-memory fallback when Redis is absent) |
| Mobile | React Native (Expo SDK 54, expo-router 6) |
| Storage | Cloudflare R2 via `@aws-sdk/client-s3` (multer for local dev) |
| Monitoring | OpenTelemetry, Prometheus (`prom-client`), Grafana dashboards, Winston logging |
| Enterprise extras | Apollo GraphQL, Elasticsearch, BullMQ workers, ClamAV |
| Testing (backend) | Jest 29 + Supertest |
| Testing (frontend) | Jest 30 + Testing Library + Playwright (E2E) |
| Testing (mobile) | Jest 29 + jest-expo + Testing Library React Native |
| CI/CD | GitHub Actions (`.github/workflows/ci.yml`, `deploy.yml`) |
| Containerization | Docker + Docker Compose (`docker-compose.yml`, `docker-compose.prod.yml`) |
| Process manager | PM2 (`ecosystem.config.js`) |

## Common Commands

### Backend (`cd backend`)
```bash
npm run dev                     # Start dev server with nodemon (512MB heap)
npm start                       # Production start (512MB heap)
npm test                        # Run all unit tests (Jest, in-band)
npm run test:unit               # Unit tests only (skip integration)
npm run test:integration        # Integration tests (requires MySQL + Redis)
npm run test:coverage           # Unit tests + coverage report

npx prisma generate             # Regenerate Prisma client after schema changes
npx prisma migrate dev          # Create + apply a new migration (dev)
npx prisma migrate deploy       # Apply pending migrations (production/CI)
npx prisma studio               # Open Prisma Studio GUI

node src/prisma/seed.js         # Seed base users, school, roles
node src/prisma/seed-data.js    # Seed demo grades, attendance, announcements
node seed-check.js --add-coins  # Add test coins to all users
npm run secrets                 # Generate JWT secrets
```

> **Important:** Always use `npm run dev` (not `node src/app.js` directly) — nodemon.json sets `--max-old-space-size=512`. Without it the backend hits memory limits.

### Frontend (`cd frontend`)
```bash
npm run dev                     # Next.js dev server (HTTP, port 3000)
npm run dev:https               # Dev server with HTTPS (required for mobile camera)
npm run build                   # Production build
npm run lint                    # ESLint
npm test                        # Jest unit tests
npm run test:coverage           # Jest + coverage
npm run test:e2e                # Playwright E2E (requires running backend + frontend)
```

### Mobile (`cd mobile`)
```bash
npm start                       # Expo dev server
npm run start:lan               # Expo with LAN (for device testing)
npm test                        # Jest (jest-expo)
```

### Docker (root)
```bash
docker-compose up -d                                              # Local dev stack
docker-compose -f docker-compose.prod.yml --env-file .env.docker.local up -d --build  # Production
```

## Environment Files
- `backend/.env` — DB, JWT, LiveKit, Redis, Stripe, Twilio, R2, Slack
- `frontend/.env.local` — API URL, Socket URL, LiveKit URL
- `mobile/.env` — API base URL, LiveKit URL
- `.env.docker.local` — Docker production overrides (copy from `.env.docker`)

## Key Configuration Notes
- Prisma client must be regenerated (`npx prisma generate`) after any schema change or after adding new migration columns
- Backend uses raw SQL fallback for new columns until Prisma client is regenerated (pattern seen in live-stream controller)
- Redis is optional in dev; required in production (no fallback for rate limiting persistence)
- LiveKit credentials are required for Voice Club and Live Classes to function
- `NEXT_PUBLIC_API_URL` must point to the backend; in mobile LAN dev, set to PC IP not localhost
