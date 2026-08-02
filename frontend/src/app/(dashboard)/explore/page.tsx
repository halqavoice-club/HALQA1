'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { exploreApi, type SearchType } from '@/lib/explore'
import { socialApi } from '@/lib/social'
import { PostCard } from '@/components/feed/PostCard'
import { CommunityCard } from '@/components/communities/CommunityCard'
import { LiveCard } from '@/components/feed/LiveCard'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { getAvatarUrl } from '@/lib/avatar'
import { useDebounce } from '@/hooks/useDebounce'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Compass, TrendingUp, Hash, Users, Radio,
  Search, UserPlus, Loader2, Video,
} from 'lucide-react'
import Link from 'next/link'
import type { Post } from '@/lib/posts'

// ─── People suggestion card ───────────────────────────────────────────────────
function PeopleCard({ person }: { person: any }) {
  const { toast }   = useToast()
  const queryClient = useQueryClient()
  const avatarSrc   = getAvatarUrl(person.avatarUrl)
  // Safe initials — guard against null/undefined/empty firstName or lastName
  const firstName   = person.firstName ?? ''
  const lastName    = person.lastName  ?? ''
  const initials    = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || '?'

  const followMutation = useMutation({
    mutationFn: () => person.isFollowing ? socialApi.unfollow(person.id) : socialApi.follow(person.id),
    onSuccess: () => {
      toast({ title: person.isFollowing ? 'Unfollowed' : '✅ Following!' })
      queryClient.invalidateQueries({ queryKey: ['explore-feed'] })
    }
  })

  return (
    <div className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-gray-100 shadow-sm">
      <Link href={`/social/profile/${person.id}`} className="flex-shrink-0">
        <div className="w-10 h-10 rounded-full overflow-hidden bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600">
          {avatarSrc ? <img src={avatarSrc} alt="" className="w-full h-full object-cover" /> : initials}
        </div>
      </Link>
      <div className="flex-1 min-w-0">
        <Link href={`/social/profile/${person.id}`}
          className="text-sm font-semibold text-gray-800 hover:underline truncate block">
          {firstName} {lastName}
        </Link>
        <p className="text-xs text-gray-400 capitalize truncate">
          {person.role ? person.role.toLowerCase().replace(/_/g, ' ') : ''}
          {(person._count?.followers ?? 0) > 0 && ` · ${person._count.followers} followers`}
        </p>
      </div>
      <button onClick={() => followMutation.mutate()} disabled={followMutation.isPending}
        className={cn('flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors',
          person.isFollowing ? 'bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600' : 'bg-indigo-600 text-white hover:bg-indigo-700')}>
        {followMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
        {person.isFollowing ? 'Following' : 'Follow'}
      </button>
    </div>
  )
}

// ─── Trending hashtag pill ────────────────────────────────────────────────────
function HashtagPill({ tag }: { tag: { id: string; name: string; postCount: number } }) {
  return (
    <Link href={`/explore/hashtag/${tag.name}`}
      className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-100 rounded-xl hover:border-indigo-300 hover:bg-indigo-50 transition-colors group">
      <Hash className="w-3.5 h-3.5 text-indigo-500" />
      <span className="text-sm font-semibold text-gray-700 group-hover:text-indigo-700">{tag.name}</span>
      <span className="text-xs text-gray-400 ml-auto">{tag.postCount}</span>
    </Link>
  )
}

// ─── Live class card (reuses LiveCard with a shaped Post) ────────────────────
function ExploreLiveClassCard({ lc }: { lc: any }) {
  const post: Post = {
    id:            `live-class-${lc.id}`,
    type:          'LIVE_CLASS_SHARE',
    refEntityType: 'live_class',
    refEntityId:   lc.id,
    authorId:      lc.teacher?.user?.id ?? '',
    author:        lc.teacher?.user ?? { id: '', firstName: '', lastName: '', avatarUrl: null, role: '', schoolId: null },
    body:          lc.description ? `${lc.title}\n\n${lc.description}` : lc.title,
    visibility:    'SCHOOL_ONLY',
    media: [], hashtags: [], reactions: [], bookmarks: [],
    _count:        { reactions: 0, comments: 0 },
    likeCount: 0, commentCount: 0, shareCount: 0, viewCount: 0, bookmarkCount: 0,
    isPinned: false, isDraft: false, scheduledAt: null,
    linkUrl: null, linkTitle: null, linkDescription: null, linkImage: null,
    pollData: null, originalPostId: null, originalPost: null, quotedBody: null, location: undefined,
    createdAt: lc.startedAt ?? lc.createdAt ?? new Date().toISOString(),
    updatedAt: lc.updatedAt ?? new Date().toISOString(),
    liveData: {
      title:            lc.title,
      description:      lc.description,
      coverEmoji:       '📹',
      coverImageUrl:    lc.coverImageUrl ?? null,
      participantCount: lc._count?.participants ?? 0,
      className:        lc.class?.name ?? null,
      isLive:           true,
    },
  }
  return <LiveCard post={post} />
}

// ─── Search bar with type tabs ────────────────────────────────────────────────
const SEARCH_TABS: { type: SearchType; label: string }[] = [
  { type: 'all',         label: 'All'         },
  { type: 'posts',       label: 'Posts'       },
  { type: 'people',      label: 'People'      },
  { type: 'communities', label: 'Communities' },
  { type: 'hashtags',    label: '#Tags'       },
]

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ExplorePage() {
  const { user }    = useAuthStore()
  const { toast }   = useToast()
  const queryClient = useQueryClient()

  const [searchQ,     setSearchQ]     = useState('')
  const [searchType,  setSearchType]  = useState<SearchType>('all')
  const debouncedQ = useDebounce(searchQ, 350)
  const isSearching = debouncedQ.length >= 2

  const { data: feed, isLoading: loadingFeed } = useQuery({
    queryKey: ['explore-feed'],
    queryFn:  () => exploreApi.getFeed().then(r => r.data.data),
    staleTime: 60_000,
    enabled:  !isSearching,
  })

  const { data: searchResults, isLoading: loadingSearch } = useQuery({
    queryKey: ['explore-search', debouncedQ, searchType],
    queryFn:  () => exploreApi.search(debouncedQ, searchType).then(r => r.data.data),
    enabled:  isSearching,
    staleTime: 30_000,
  })

  const isLoading = isSearching ? loadingSearch : loadingFeed

  return (
    <div className="max-w-2xl space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Compass className="w-6 h-6 text-indigo-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Explore</h1>
          <p className="text-sm text-gray-400">Discover people, posts, communities</p>
        </div>
      </div>

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          placeholder="Search posts, people, communities, #tags…"
          className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-2xl text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-indigo-400 shadow-sm transition-colors"
        />
        {isLoading && isSearching && (
          <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
        )}
      </div>

      {/* Search type filter (only when searching) */}
      {isSearching && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
          {SEARCH_TABS.map(t => (
            <button key={t.type} onClick={() => setSearchType(t.type)}
              className={cn('flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors',
                searchType === t.type ? 'bg-indigo-600 text-white' : 'bg-white border text-gray-600 hover:bg-gray-50')}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── SEARCH RESULTS ── */}
      {isSearching && searchResults && (
        <div className="space-y-5">
          {/* Posts */}
          {(searchType === 'all' || searchType === 'posts') && searchResults.posts.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" /> Posts ({searchResults.posts.length})
              </h2>
              <div className="space-y-3">
                {searchResults.posts.map(p => (
                  <PostCard key={p.id} post={p} />
                ))}
              </div>
            </section>
          )}

          {/* People */}
          {(searchType === 'all' || searchType === 'people') && searchResults.people.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> People ({searchResults.people.length})
              </h2>
              <div className="space-y-2">
                {searchResults.people.map(p => <PeopleCard key={p.id} person={p} />)}
              </div>
            </section>
          )}

          {/* Communities */}
          {(searchType === 'all' || searchType === 'communities') && searchResults.communities.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Communities ({searchResults.communities.length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {searchResults.communities.map(c => <CommunityCard key={c.id} community={c} />)}
              </div>
            </section>
          )}

          {/* Hashtags */}
          {(searchType === 'all' || searchType === 'hashtags') && searchResults.hashtags.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5" /> Hashtags ({searchResults.hashtags.length})
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {searchResults.hashtags.map(t => <HashtagPill key={t.id} tag={t} />)}
              </div>
            </section>
          )}

          {/* No results */}
          {!isLoading && searchResults.posts.length === 0 && searchResults.people.length === 0 &&
           searchResults.communities.length === 0 && searchResults.hashtags.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <Search className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium text-gray-500">No results for "{debouncedQ}"</p>
            </div>
          )}
        </div>
      )}

      {/* ── EXPLORE FEED (not searching) ── */}
      {!isSearching && (
        <div className="space-y-6">
          {loadingFeed ? (
            <div className="space-y-4">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
            </div>
          ) : (
            <>
              {/* Live Voice Rooms — same card style as live class, with profile circle inside */}
              {(feed?.liveVoiceRooms?.length ?? 0) > 0 && (
                <section>
                  <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                    <Radio className="w-3.5 h-3.5 text-red-500" /> Live Voice Rooms
                  </h2>
                  <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide -mx-1 px-1">
                    {feed!.liveVoiceRooms.map(r => {
                      const post = {
                        id: `live-voice-${r.id}`,
                        type: 'LIVE_ROOM_SHARE' as const,
                        refEntityType: 'voice_room',
                        refEntityId: r.id,
                        authorId: r.host?.id ?? '',
                        author: r.host ?? null,
                        body: r.title,
                        visibility: 'PUBLIC',
                        media: [], hashtags: [], reactions: [], bookmarks: [],
                        _count: { reactions: 0, comments: 0 },
                        likeCount: 0, commentCount: 0, shareCount: 0, viewCount: 0, bookmarkCount: 0,
                        isPinned: false, isDraft: false, scheduledAt: null,
                        linkUrl: null, linkTitle: null, linkDescription: null, linkImage: null,
                        pollData: null, originalPostId: null, originalPost: null, quotedBody: null, location: undefined,
                        createdAt: r.startedAt ?? r.createdAt ?? new Date().toISOString(),
                        updatedAt: r.updatedAt ?? new Date().toISOString(),
                        liveData: {
                          title: r.title,
                          description: r.description,
                          coverEmoji: r.coverEmoji ?? '🎙️',
                          coverImageUrl: r.coverImageUrl ?? null,
                          participantCount: r._count?.participants ?? 0,
                          isLive: true,
                        },
                      } as any
                      return (
                        <div key={r.id} className="flex-shrink-0 w-[280px]">
                          <LiveCard post={post} />
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              {/* Live Classes */}
              {(feed?.liveLiveClasses?.length ?? 0) > 0 && (
                <section>
                  <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                    <Video className="w-3.5 h-3.5 text-red-500" /> Live Classes
                  </h2>
                  <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide -mx-1 px-1">
                    {feed!.liveLiveClasses.map(lc => (
                      <div key={lc.id} className="flex-shrink-0 w-[280px]">
                        <ExploreLiveClassCard lc={lc} />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Trending Hashtags */}
              {(feed?.trendingHashtags?.length ?? 0) > 0 && (
                <section>
                  <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" /> Trending
                  </h2>
                  <div className="grid grid-cols-2 gap-2">
                    {feed!.trendingHashtags.slice(0, 10).map(t => <HashtagPill key={t.id} tag={t} />)}
                  </div>
                </section>
              )}

              {/* Suggested People */}
              {(feed?.suggestedPeople?.length ?? 0) > 0 && (
                <section>
                  <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" /> People you may know
                  </h2>
                  <div className="space-y-2">
                    {feed!.suggestedPeople.slice(0, 6).map(p => <PeopleCard key={p.id} person={p} />)}
                  </div>
                </section>
              )}

              {/* Suggested Communities */}
              {(feed?.suggestedCommunities?.length ?? 0) > 0 && (
                <section>
                  <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" /> Communities to join
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {feed!.suggestedCommunities.slice(0, 4).map(c => (
                      <CommunityCard key={c.id} community={c} />
                    ))}
                  </div>
                </section>
              )}

              {/* Trending Posts */}
              {(feed?.trendingPosts?.length ?? 0) > 0 && (
                <section>
                  <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" /> Trending Posts
                  </h2>
                  <div className="space-y-3">
                    {feed!.trendingPosts.slice(0, 5).map(p => (
                      <PostCard key={p.id} post={p} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
