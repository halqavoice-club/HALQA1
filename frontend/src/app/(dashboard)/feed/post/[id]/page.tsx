'use client'
/**
 * /feed/post/:id — Post deep-link page
 * Renders a single post in full with inline comments.
 * Shared links from ShareMenu (buildShareUrl) resolve here.
 */
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { postsApi } from '@/lib/posts'
import { PostCard } from '@/components/feed/PostCard'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircle, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

interface Props {
  params: Promise<{ id: string }>
}

export default function PostDeepLinkPage({ params }: Props) {
  const { id } = use(params)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['post', id],
    queryFn: () => postsApi.getOne(id).then(r => r.data.data),
    staleTime: 30_000,
    retry: 1,
  })

  return (
    <div className="max-w-xl mx-auto space-y-4 pb-10">
      {/* Back */}
      <div className="flex items-center gap-2">
        <Link
          href="/feed"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-indigo-600 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to feed
        </Link>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-32 rounded" />
              <Skeleton className="h-2.5 w-20 rounded" />
            </div>
          </div>
          <Skeleton className="h-4 w-full rounded" />
          <Skeleton className="h-4 w-3/4 rounded" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mb-3" />
          <p className="text-gray-600 mb-2">Post not found or unavailable</p>
          <Link
            href="/feed"
            className="text-sm text-indigo-600 hover:underline"
          >
            Go back to feed
          </Link>
        </div>
      )}

      {/* Post card with comments open by default */}
      {data && (
        <PostCard post={data} defaultCommentsOpen />
      )}
    </div>
  )
}
