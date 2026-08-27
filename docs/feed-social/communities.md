# Feed + Social — Communities

**Audit date:** 2026-08-26

---

## Overview

Communities are persistent groups/clubs where members can post and discuss. They have their own feed separate from the main feed.

---

## Community Roles

| Role | Privileges |
|------|-----------|
| `OWNER` | Full control — delete community, manage all members |
| `ADMIN` | Manage members, approve join requests, ban users |
| `MODERATOR` | Delete content, kick members |
| `MEMBER` | Post, comment, react |

---

## Privacy Modes

| Mode | Who can join | Who sees content |
|------|-------------|-----------------|
| `PUBLIC` | Anyone can join directly | Anyone |
| `PRIVATE` | Must request + get approved | Only members |
| `INVITE_ONLY` | Must receive an invite | Only members |

---

## Key Routes (`/api/v1/communities`)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/` | ✅ | List communities (search, filter by category) |
| POST | `/` | ✅ | Create community (any user) |
| GET | `/:idOrSlug` | ✅ | Get community (PRIVATE: must be member) |
| PATCH | `/:idOrSlug` | ✅ OWNER/ADMIN | Update settings |
| DELETE | `/:idOrSlug` | ✅ OWNER | Soft-delete |
| POST | `/:idOrSlug/join` | ✅ | Join (PUBLIC) or request (PRIVATE/INVITE_ONLY) |
| DELETE | `/:idOrSlug/leave` | ✅ | Leave |
| GET | `/:idOrSlug/members` | ✅ | Member list |
| PATCH | `/:idOrSlug/members/:userId/role` | ✅ OWNER/ADMIN | Assign role |
| DELETE | `/:idOrSlug/members/:userId` | ✅ ADMIN/MODERATOR | Kick |
| POST | `/:idOrSlug/members/:userId/ban` | ✅ ADMIN | Ban |
| DELETE | `/:idOrSlug/members/:userId/ban` | ✅ ADMIN | Unban |
| GET | `/:idOrSlug/join-requests` | ✅ ADMIN | List pending requests |
| POST | `/:idOrSlug/join-requests/:userId/approve` | ✅ ADMIN | Approve |
| POST | `/:idOrSlug/join-requests/:userId/decline` | ✅ ADMIN | Decline |
| POST | `/:idOrSlug/invite/:userId` | ✅ ADMIN | Invite user |
| POST | `/invites/:token/accept` | ✅ | Accept invite |
| POST | `/invites/:token/decline` | ✅ | Decline invite |
| GET | `/:idOrSlug/feed` | ✅ (member for PRIVATE) | Community feed |

---

## Community Feed

```
GET /communities/:idOrSlug/feed?cursor=...&limit=20

getCommunityFeed():
  └─ Fetch posts WHERE communityId = community.id AND deletedAt IS NULL
  └─ For PRIVATE/INVITE_ONLY: verify viewer is an active member
  └─ Cursor-paginated, reverse-chronological
  └─ Returns posts with author, media, reactions, comments count
```

---

## Community Ban System

Persistent bans are stored in `community_bans` table AND cached in Redis:

```
Redis key: community:ban:{communityId}  (Set type)
```

When checking if a user is banned on `community:join` socket:
1. Check Redis: `SISMEMBER community:ban:{communityId} userId`
2. If Redis unavailable or returns false: check DB `CommunityBan` table
3. DB is always the source of truth; Redis is a cache layer

---

## Socket.IO for Communities

The `community:join` socket event performs multi-step DB authorization before allowing room subscription. See [realtime.md](./realtime.md) for the full flow.

Community events are emitted to `community:{id}` room and/or `user:{userId}` personal rooms.

---

## Community Posts

Posts with `communityId` set belong to that community. They appear in:
1. The community's own feed (`GET /communities/:id/feed`)
2. Optionally in the main `feed:public` (if the community is PUBLIC and post visibility is PUBLIC/FOLLOWERS)

The community post creation flow:
```javascript
// In post.controller.js: createPost()
if (communityId) {
  const community = await prisma.community.findUnique(...);
  // Verify membership for PRIVATE/INVITE_ONLY
  // Emit to community:{id} room
  // Also emit to feed:public if community is PUBLIC and post is PUBLIC/FOLLOWERS
}
```
