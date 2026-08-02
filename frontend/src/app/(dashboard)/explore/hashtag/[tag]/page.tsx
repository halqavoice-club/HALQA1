'use client'
import { useParams } from 'next/navigation'
import { useInfiniteQuery } from '@tanstack/react-query'
import { exploreApi } from '@/lib/explore'
import { PostCard } from '@/components/feed/PostCard'
import { Skeleton } from '@/components/ui/skeleton'
import { Hash, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function HashtagPage() {
  const { tag }       = useParams<{ tag: string }>()
  const decoded       = decodeURIComponent(tag).replace(/^#/, '')

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['hashtag-feed', decoded],
    queryFn:  ({ pageParam }) => exploreApi.getHashtagFeed(decoded, pageParam as string | undefined).then(r => r.data.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!decoded,
  })

  const hashtag = data?.pages[0]?.hashtag
  const posts   = data?.pages.flatMap(p => p.items) ?? []

  return (
    <div className="max-w-2xl space-y-4">
      <Link href="/explore" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="w-4 h-4" /> Explore
      </Link>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
            <Hash className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-black text-gray-900">#{decoded}</h1>
            {hashtag && (
              <p className="text-sm text-gray-400">{hashtag.postCount.toLocaleString()} post{hashtag.postCount !== 1 ? 's' : ''}</p>
            )}
            {!isLoading && !hashtag && (
              <p className="text-sm text-gray-400">No posts yet with this tag</p>
            )}
          </div>
        </div>
      </div>

      {/* Posts */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Hash className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No posts with #{decoded} yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map(p => <PostCard key={p.id} post={p} />)}
          {hasNextPage && (
            <button onClick={() => fetchNextPage()} disabled={isFetchingNextPage}
              className="w-full py-2 text-xs text-indigo-500 hover:underline">
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
