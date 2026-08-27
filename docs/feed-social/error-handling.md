# Feed + Social — Error Handling

**Audit date:** 2026-08-26

---

## HTTP Error Codes

### 400 Bad Request

| Cause | Endpoint |
|-------|---------|
| Post body empty AND no media/poll | POST /posts |
| Comment body empty | POST /posts/:id/comments |
| Invalid visibility value | POST/PATCH /posts |
| Invalid reaction type | POST /posts/:id/react |
| Invalid story type | POST /stories |
| Story text > 500 chars | POST /stories |
| Already friends | POST /social/friends/request |
| Cannot friend-request yourself | POST /social/friends/request |

### 401 Unauthorized

| Cause |
|-------|
| No Bearer token |
| Invalid/expired JWT |

### 403 Forbidden

| Cause | Endpoint |
|-------|---------|
| Not post author (edit) | PATCH /posts/:id |
| Not post author, not admin (delete) | DELETE /posts/:id |
| Not story author (delete) | DELETE /stories/:id |
| Cannot see PRIVATE post | GET /posts/:id |
| Non-member trying to access PRIVATE community | GET /communities/:idOrSlug |
| Non-member trying to read PRIVATE community feed | GET /communities/:idOrSlug/feed |
| Not community OWNER/ADMIN for management actions | PATCH/DELETE on community |
| Blocked by the user you're trying to follow | POST /social/follow/:userId |

### 404 Not Found

| Cause |
|-------|
| Post not found or soft-deleted |
| Story not found or soft-deleted |
| Story expired (expiresAt < now) |
| Comment not found or soft-deleted |
| Community not found or soft-deleted |
| User not found |
| Report not found |

### 409 Conflict

| Cause |
|-------|
| Already following this user |
| Already blocked this user |
| Already reacted with this type (toggle — actually 200 on toggle) |

### 422 Unprocessable Entity

| Cause |
|-------|
| express-validator failures |
| Content filter rejection (toxic/profane content) |

### 429 Too Many Requests

| Endpoint | Limit |
|----------|-------|
| POST /posts | 20/min |
| POST /posts/:id/comments | 30/min |
| POST /stories | 30/hour |
| POST /social/follow | 30/min |
| POST /social/friends/request | 20/min |
| POST /social/report | 10/hour |

---

## Special Cases

### Deleted Post

`GET /posts/:id` returns 404 if `post.deletedAt` is set.  
Reactions and comments on a deleted post return 404.

### Private Post (Unauthorized)

`GET /posts/:id` for a PRIVATE post by another user returns 403 ("Not authorized to view this post").

### Expired Story

`POST /stories/:id/view` for an expired story returns 404 ("Story not found or expired").

### Blocked User

Following a user who has blocked you returns 403.  
The block status check happens before the follow operation.

---

## Frontend Error Handling

The `PostCard` component uses `useMutation` from React Query with `onError` handlers that display toast notifications.

For feed loading failures, the feed page shows an error state with a retry button.

For stories bar failures, the `StoriesBar` component falls back to showing nothing (silent failure — stories are non-critical).

---

## Mobile Error Handling

Mobile uses `showMessage()` from `react-native-flash-message` for operation feedback.  
Network errors during feed scroll show a toast; infinite scroll stops.
