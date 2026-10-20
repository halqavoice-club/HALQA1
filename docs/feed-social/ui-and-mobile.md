# Feed + Social — Web UI and Mobile

**Audit date:** 2026-08-26

---

## Web Frontend Pages

| Route | File | Purpose |
|-------|------|---------|
| `/feed` | `(dashboard)/feed/page.tsx` | Main social feed |
| `/feed/post/[id]` | `(dashboard)/feed/post/[id]/page.tsx` | Single post view |
| `/reels` | `(dashboard)/reels/page.tsx` | TikTok-style video feed |
| `/explore` | `(dashboard)/explore/page.tsx` | Discovery feed |
| `/explore/hashtag/[tag]` | `(dashboard)/explore/hashtag/[tag]/page.tsx` | Hashtag feed |
| `/social` | `(dashboard)/social/page.tsx` | Social hub (follow/friends) |
| `/social/friends` | `(dashboard)/social/friends/page.tsx` | Friends list |
| `/social/people` | `(dashboard)/social/people/page.tsx` | People to follow |
| `/social/requests` | `(dashboard)/social/requests/page.tsx` | Friend requests |
| `/social/profile/[id]` | `(dashboard)/social/profile/[id]/page.tsx` | User profile |
| `/profile` | `(dashboard)/profile/page.tsx` | Own profile |
| `/notifications` | `(dashboard)/notifications/page.tsx` | Notification inbox |
| `/communities` | `(dashboard)/communities/page.tsx` | Community list |
| `/communities/[slug]` | `(dashboard)/communities/[slug]/page.tsx` | Community feed |
| `/reports` | `(dashboard)/reports/page.tsx` | Reported content (user view) |
| `/settings/blocked` | `(dashboard)/settings/blocked/page.tsx` | Blocked users list |

---

## Key Frontend Components

| Component | File | Purpose |
|-----------|------|---------|
| `PostCard` | `components/feed/PostCard.tsx` | Full post display with interactions |
| `PostComposer` | `components/feed/PostComposer.tsx` | Create post form |
| `CommentsSection` | `components/feed/CommentsSection.tsx` | Comment thread |
| `LiveSection` | `components/feed/LiveSection.tsx` | Live sessions feed section |
| `LiveCard` | `components/feed/LiveCard.tsx` | Live session card |
| `ShareMenu` | `components/feed/ShareMenu.tsx` | Share/repost menu |
| `MediaGrid` | `components/feed/MediaGrid.tsx` | Post media grid display |
| `PollCard` | `components/feed/PollCard.tsx` | Poll voting UI |
| `StoriesBar` | `components/stories/StoriesBar.tsx` | Stories strip at top of feed |
| `StoryComposer` | `components/stories/StoryComposer.tsx` | Create story UI |
| `StoryViewer` | `components/stories/StoryViewer.tsx` | Story full-screen viewer |

---

## Key API Client Files

| File | Endpoints covered |
|------|------------------|
| `frontend/src/lib/posts.ts` | All `/posts/*` endpoints |
| `frontend/src/lib/social.ts` | All `/social/*` endpoints |
| `frontend/src/lib/stories.ts` | All `/stories/*` endpoints |
| `frontend/src/lib/explore.ts` | All `/explore/*` endpoints |
| `frontend/src/lib/communities.ts` | All `/communities/*` endpoints |

---

## Frontend Store

`frontend/src/store/social.store.ts` (Zustand):
- `pendingCount` — pending friend requests count
- `incrementPending`, `decrementPending`, `setPendingCount`

Used in navigation badge for pending friend requests.

---

## useSocialSocket Hook

`frontend/src/hooks/useSocial.ts`

Mounted once in the dashboard layout. Subscribes to:
- `social:followed` — someone followed me
- `social:friend_request` — incoming friend request
- `social:request_accepted` — my request accepted
- `social:notification` — general social notification
- `feed:live` — new live session card
- `feed:live_ended` — session ended
- `feed:live_update` — participant count update

---

## Mobile (React Native)

### Screens

| File | Purpose |
|------|---------|
| `mobile/app/(tabs)/feed.tsx` | Main feed tab |
| `mobile/app/(tabs)/explore.tsx` | Explore/discovery tab |
| `mobile/app/hashtag/[tag].tsx` | Hashtag feed |
| `mobile/app/community/[slug].tsx` | Community screen |
| `mobile/app/leaderboard.tsx` | Leaderboard screen |

### Feed Screen

`mobile/app/(tabs)/feed.tsx`:
- Infinite scroll feed using `useInfiniteQuery`
- `StoriesBar` at top
- `LiveSection` for active live rooms
- `PostCard` for each post
- Creates posts via `PostComposer`
- Connects to Socket.IO `feed:join` room for real-time updates

### Explore Screen

`mobile/app/(tabs)/explore.tsx`:
- Trending hashtags
- People to follow
- Trending communities
- Live sessions

---

## Realtime Feed Updates (Web + Mobile)

On `feed:join`, client joins `feed:public` and `feed:{userId}` rooms.

New posts received via `post:create` socket event are **prepended** to the feed via React Query cache update:
```typescript
queryClient.setQueryData(['feed'], (old) => ({
  pages: [{ items: [newPost, ...(old?.pages[0]?.items ?? [])] }, ...(old?.pages.slice(1) ?? [])]
}))
```

---

## Test Coverage

| Test file | Coverage |
|-----------|---------|
| `backend/src/tests/p3-security-fixes.test.js` | Post visibility, SQL parameterization |
| `backend/src/tests/architecture-separation.test.js` | Separation of concerns, school isolation |
| `backend/src/tests/p0-security-fixes.test.js` | Security fixes including social |
| `backend/src/tests/super-admin-scope.test.js` | SUPER_ADMIN scope for social features |
