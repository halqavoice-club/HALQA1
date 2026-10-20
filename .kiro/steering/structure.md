# Project Structure

## Root Layout

```
halqa-ms/
├── backend/        Node.js/Express API
├── frontend/       Next.js 14 web app
├── mobile/         React Native (Expo) app
├── docs/           Architecture and feature documentation
├── scripts/        Backup, restore, deployment scripts
├── nginx/          Nginx config for Docker prod
├── mysql-init/     MySQL init scripts for Docker
├── src/            Root-level PBT tests (layout algorithm)
├── .github/        CI/CD workflows
├── .kiro/          Kiro specs and steering
└── docker-compose*.yml
```

## Backend (`backend/`)

```
backend/
├── src/
│   ├── app.js                  Express entry point, middleware registration
│   ├── controllers/            One file per domain (e.g. voice.controller.js)
│   ├── routes/                 Express routers, one per domain
│   ├── middleware/
│   │   ├── auth.middleware.js  JWT verification, role guards
│   │   ├── voiceRole.middleware.js  Voice room role guards
│   │   └── validators/         express-validator schemas per route group
│   ├── services/               Business logic extracted from controllers
│   ├── sockets/index.js        All Socket.IO event handlers
│   ├── workers/                BullMQ background job workers
│   ├── graphql/                Apollo GraphQL schema + resolvers
│   ├── utils/                  Shared helpers (redis, voiceQueue, autoPromote, sms, etc.)
│   ├── prisma/
│   │   ├── seed.js             Base seed (users, school, roles)
│   │   └── seed-data.js        Demo data seed
│   └── tests/                  Jest tests (unit + integration subdirectory)
├── prisma/
│   ├── schema.prisma           Single source of truth for DB schema
│   └── migrations/             Timestamped SQL migration files
└── nodemon.json                Sets --max-old-space-size=512 for dev
```

**Controller naming convention:** `{domain}.controller.js` — voice domain is split across `voice.controller.js`, `voice-roles.controller.js`, `voice-queue.controller.js`, `voice-mic.controller.js`, `voice-stats.controller.js`.

**Route naming convention:** `{domain}.routes.js`, mounted under `/api/v1/{domain}`.

## Frontend (`frontend/src/`)

```
frontend/src/
├── app/                        Next.js App Router
│   ├── (auth)/                 Login, register, forgot-password pages
│   ├── (dashboard)/            All authenticated pages (layout.tsx wraps all)
│   │   ├── voice-club/         Voice rooms UI
│   │   ├── live-class/         Live class sessions
│   │   ├── live-stream/        Public live streams
│   │   ├── feed/               Social feed
│   │   ├── admin/              SUPER_ADMIN / SCHOOL_ADMIN admin pages
│   │   └── ...                 One folder per feature/module
│   └── api/                    Next.js API routes (thin proxies)
├── components/                 Shared + feature-specific components
│   ├── voice/                  Voice room components + CSS
│   ├── live-class/             Live class UI components
│   ├── ui/                     shadcn/ui primitives
│   └── layout/                 Sidebar, header, navigation
├── hooks/                      Custom React hooks (useVoiceRoom, useDmSocket, etc.)
├── store/                      Zustand stores (voice.store.ts, school.store.ts, etc.)
├── lib/                        API client helpers, socket singleton, utilities
└── types/                      TypeScript type definitions
```

**Routing pattern:** Next.js App Router with route groups. All authenticated routes live under `(dashboard)/`. Auth routes under `(auth)/`. Dynamic routes use `[id]` or `[slug]`.

## Mobile (`mobile/`)

```
mobile/
├── app/                        expo-router file-based routing
│   ├── (auth)/                 Auth screens
│   ├── (tabs)/                 Bottom-tab screens (feed, voice, live-class, chat, etc.)
│   ├── voice/[id].tsx          Voice room screen
│   ├── live-class/[id].tsx     Live class screen
│   ├── dm/[id].tsx             DM conversation screen
│   └── ...                     One file per top-level screen
├── src/
│   ├── components/             Shared RN components
│   ├── hooks/                  Custom hooks (useLiveKitAudio, useNetworkQuality, etc.)
│   └── store/                  Zustand stores
└── assets/                     Images, fonts
```

**Import alias:** Use `@/` for `mobile/` root. Do NOT use `@/src/` — broken paths were a known bug; all imports should be `@/store/...`, `@/hooks/...`, etc.

## Docs (`docs/`)

Organized by feature domain: `authorization/`, `live-class/`, `live-stream/`, `feed-social/`, `chat-dm/`, `gifts-payments/`, `notifications/`, `deployment/`, `web-mobile/`. `docs/HALQA-MASTER.md` is the top-level index.

## Key Architecture Rules

1. **SUPER_ADMIN scope** — SUPER_ADMIN is a platform admin, not a school admin. They must have an explicit `SchoolMembership` record to access school-level data. Never add global bypasses to `requireSchoolMember()` or `requireSchoolAccess()`.

2. **Live Class vs Voice Club** — These are distinct features with separate authorization models. Do not conflate them. Live Class uses `live_classes` + `live_class_participants` tables. Voice Club uses `voice_rooms` + `voice_participants`.

3. **Prisma + raw SQL** — After adding new columns via migration, regenerate the Prisma client (`npx prisma generate`) before using ORM access. If the client hasn't been regenerated yet, use raw SQL as a temporary workaround (see live-stream controller pattern).

4. **Socket.IO transport order** — Always configure `polling` first, then `websocket` upgrade. Do not start with `websocket` only.

5. **Redis fallback** — All Redis-dependent features (rate limiting, queue, caching) must degrade gracefully to in-memory fallback when Redis is unavailable. Log Redis connection errors as `warn` in dev, not `error`.

6. **Next.js `useSearchParams`** — Must be wrapped in a `<Suspense>` boundary (Next.js 14 requirement). Always add the boundary when using this hook.

7. **Mobile imports** — Use `@/` alias pointing to the `mobile/` root. Never use `@/src/` prefix.
