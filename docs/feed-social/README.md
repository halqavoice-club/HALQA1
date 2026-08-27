# HALQA Feed + Social — Documentation Index

**Audit date:** 2026-08-26  
**Status:** Read-only documentation audit. No application code modified.

---

## Document Index

| Document | Contents |
|----------|---------|
| **[README.md](./README.md)** | This index |
| [architecture.md](./architecture.md) | System architecture, data flow, dependencies |
| [database.md](./database.md) | All Prisma models: Post, Comment, Reaction, Follow, Story, Block, Report, etc. |
| [api.md](./api.md) | Complete API endpoint inventory |
| [feed-system.md](./feed-system.md) | Feed generation, visibility, school isolation, pagination |
| [posts.md](./posts.md) | Post lifecycle, types, media, visibility, realtime |
| [social-graph.md](./social-graph.md) | Follow, Friends, Block, Mute systems |
| [stories.md](./stories.md) | Story system complete reference |
| [communities.md](./communities.md) | Communities and community feeds |
| [realtime.md](./realtime.md) | Socket.IO events for feed and social |
| [notifications.md](./notifications.md) | Social notification types and delivery |
| [moderation.md](./moderation.md) | Reporting, blocking, content moderation |
| [security.md](./security.md) | Authorization, school isolation, SUPER_ADMIN boundary |
| [error-handling.md](./error-handling.md) | Error codes and recovery |
| [production-rules.md](./production-rules.md) | Production deployment requirements |
| [gaps.md](./gaps.md) | Known gaps and violations (SVSV-001 and more) |

---

## Quick Facts

- **Backend posts routes:** `backend/src/routes/post.routes.js` → `/api/v1/posts`
- **Backend social routes:** `backend/src/routes/social.routes.js` → `/api/v1/social`
- **Backend story routes:** `backend/src/routes/story.routes.js` → `/api/v1/stories`
- **Backend explore routes:** `backend/src/routes/explore.routes.js` → `/api/v1/explore`
- **Backend notification routes:** `backend/src/routes/notification.routes.js` → `/api/v1/notifications`
- **Backend report-block routes:** `backend/src/routes/report-block.routes.js` → `/api/v1/report-block`
- **Post controller:** `backend/src/controllers/post.controller.js`
- **Social controller:** `backend/src/controllers/social.controller.js`
- **Report-block controller:** `backend/src/controllers/report-block.controller.js`
- **Frontend feed page:** `frontend/src/app/(dashboard)/feed/page.tsx`
- **Frontend post card:** `frontend/src/components/feed/PostCard.tsx`
- **Frontend posts API client:** `frontend/src/lib/posts.ts`
- **Mobile feed:** `mobile/app/(tabs)/feed.tsx`

---

## SUPER_ADMIN Boundary

SUPER_ADMIN is a platform administrator and must not participate in feed or social content.

- **SVSV-001** — `feed:join:school` socket event has a legacy SUPER_ADMIN bypass allowing SUPER_ADMIN to subscribe to any school's feed room. Documented in [gaps.md](./gaps.md). **Not fixed.**

See [docs/authorization/SUPER-ADMIN-MASTER-SPEC.md](../authorization/SUPER-ADMIN-MASTER-SPEC.md) for the canonical rule.
