# Feed + Social — Social Graph (Follow, Friends, Block)

**Audit date:** 2026-08-26

---

## Follow System (One-Way)

### Model: `Follow`

```
followerId  → User who follows
followingId → User being followed
@@unique([followerId, followingId])
```

### Behavior

- **No approval required** — following is instantaneous
- **TikTok-style** — following affects `FOLLOWERS` visibility posts in feed
- Following a user does NOT make you friends

### API

| Method | Endpoint | Rate limit |
|--------|----------|-----------|
| POST | `/social/follow/:userId` | 30/min |
| DELETE | `/social/follow/:userId` | 30/min |
| GET | `/social/followers/:userId` | — |
| GET | `/social/following/:userId` | — |
| GET | `/social/counts/:userId` | — |

### Notifications

Following a user triggers a `FOLLOW` in-app notification to the followed user.

### Effect on Feed

Posts with `visibility = 'FOLLOWERS'` are visible to users who follow the author:
```javascript
{ visibility: 'FOLLOWERS', isExclusive: false, authorId: { in: followingIds } }
```

---

## Friend System (Two-Way)

### Model: `FriendRequest`

```
senderId    → FK users.id
receiverId  → FK users.id
status      → PENDING | ACCEPTED | REJECTED
@@unique([senderId, receiverId])
```

### States

```
senderId sends request → PENDING
receiverId accepts     → ACCEPTED
receiverId rejects     → REJECTED
senderId cancels       → deleted (DELETE /friends/request/:userId)
accepted user removes  → deleted (DELETE /friends/:userId)
```

### API

| Method | Endpoint | Rate limit |
|--------|----------|-----------|
| GET | `/social/friends` | — |
| GET | `/social/friends/requests` | — (incoming) |
| GET | `/social/friends/requests/sent` | — (outgoing) |
| POST | `/social/friends/request/:userId` | 20/min |
| POST | `/social/friends/accept/:userId` | — |
| POST | `/social/friends/reject/:userId` | — |
| DELETE | `/social/friends/request/:userId` | — (cancel own request) |
| DELETE | `/social/friends/:userId` | — (remove friend) |

### Notifications

Sending a friend request → `FRIEND_REQUEST` notification to receiver.  
Accepting a friend request → `FRIEND_ACCEPTED` notification to sender.

### Friendship vs Following

These are **separate systems**. Being friends does not automatically mean you follow each other. Following and friendship are independent relationships.

---

## Block System

### Model: `UserBlock`

```
blockerId → Who blocked
blockedId → Who was blocked
@@unique([blockerId, blockedId])
```

### Effect of Blocking

| System | Effect |
|--------|--------|
| Feed | Blocked user's posts excluded from blocker's feed |
| Posts | Blocked user cannot view/interact with blocker's posts |
| DM | DM cannot be initiated to/from blocked user |
| Social | Follow/friend actions blocked |
| Voice room | Blocked users cannot gift each other |
| Search | Blocked users hidden from search results |

### API

| Method | Endpoint |
|--------|----------|
| POST | `/social/block/:userId` |
| DELETE | `/social/block/:userId` |
| GET | `/social/blocked` |
| GET | `/social/block/:userId/status` |

Also at `/report-block`:
- POST `/report-block/block/:userId`
- DELETE `/report-block/block/:userId`
- GET `/report-block/blocked`
- GET `/report-block/block/:userId/status`

Both route namespaces point to the same controller functions.

---

## User Search

`GET /social/search?q=...`

Searches users by firstName, lastName, username. Returns public profile fields.

Blocked users are excluded from search results for the searcher (and blocked users cannot see the blocker in search).

---

## Social Counts

`GET /social/counts/:userId` returns:
```json
{ "followers": 142, "following": 89 }
```

---

## SUPER_ADMIN and Social Graph

SUPER_ADMIN can follow, unfollow, send friend requests, and block users like any other user — these are standard user operations.

**Content participation rule:** SUPER_ADMIN should not be using these features in their administrative capacity. These are personal-account actions.

No authorization gate blocks SUPER_ADMIN from social graph operations. This is consistent with the fact that SUPER_ADMIN accounts are operated by humans who may have personal social interactions.
