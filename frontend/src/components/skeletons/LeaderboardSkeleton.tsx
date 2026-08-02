import { Skeleton } from '@/components/ui/skeleton'

/**
 * A single placeholder row matching the LeaderRow layout in the leaderboard page.
 */
function LeaderRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl">
      {/* Rank icon */}
      <Skeleton className="w-5 h-5 rounded-full flex-shrink-0" />

      {/* Avatar */}
      <Skeleton className="w-9 h-9 rounded-full flex-shrink-0" />

      {/* Name + stats */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <Skeleton className="h-3.5 w-2/5 rounded-full" />
        <div className="flex gap-2">
          <Skeleton className="h-2.5 w-10 rounded-full" />
          <Skeleton className="h-2.5 w-8 rounded-full" />
          <Skeleton className="h-2.5 w-10 rounded-full" />
        </div>
      </div>

      {/* Score */}
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <Skeleton className="h-3 w-10 rounded-full" />
        <Skeleton className="h-2.5 w-6 rounded-full" />
      </div>
    </div>
  )
}

/** Placeholder podium for the top-3 section */
function PodiumSkeleton() {
  const heights = ['h-20', 'h-28', 'h-16']
  return (
    <div className="flex items-end justify-center gap-3 mb-6">
      {heights.map((h, i) => (
        <div key={i} className="flex flex-col items-center gap-1.5 w-20">
          <Skeleton className="w-12 h-12 rounded-full" />
          <Skeleton className="h-3 w-14 rounded-full" />
          <Skeleton className="h-2.5 w-10 rounded-full" />
          <Skeleton className={`w-full rounded-t-lg ${h}`} />
        </div>
      ))}
    </div>
  )
}

interface LeaderboardSkeletonProps {
  /** Number of placeholder rows to render (default 10) */
  count?: number
  /** Whether to show the top-3 podium placeholder (default true) */
  showPodium?: boolean
}

export function LeaderboardSkeleton({ count = 10, showPodium = true }: LeaderboardSkeletonProps) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden p-4">
      {showPodium && <PodiumSkeleton />}
      <div className="space-y-1">
        {Array.from({ length: count }).map((_, i) => (
          <LeaderRowSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}
