import { Skeleton } from '@/components/ui/skeleton'

/**
 * Placeholder grid matching the VoiceRoomCard layout shown while rooms are loading.
 */
function RoomCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-purple-100 p-5 space-y-3">
      {/* Top row: emoji/cover + title + privacy badge */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Skeleton className="w-10 h-10 rounded-xl flex-shrink-0" />
          <div className="space-y-1.5 flex-1 min-w-0">
            <Skeleton className="h-3.5 w-3/4 rounded-full" />
            <Skeleton className="h-2.5 w-1/2 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-5 w-16 rounded-full flex-shrink-0 ml-2" />
      </div>

      {/* On-stage avatars row */}
      <div className="space-y-1.5">
        <Skeleton className="h-2.5 w-12 rounded-full" />
        <div className="flex gap-2">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="w-9 h-9 rounded-full" />
          ))}
        </div>
      </div>

      {/* Footer: stats + join button */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex gap-3">
          <Skeleton className="h-3 w-8 rounded-full" />
          <Skeleton className="h-3 w-16 rounded-full" />
        </div>
        <Skeleton className="h-7 w-16 rounded-xl" />
      </div>
    </div>
  )
}

interface RoomListSkeletonProps {
  /** Number of placeholder cards to render (default 4) */
  count?: number
}

export function RoomListSkeleton({ count = 4 }: RoomListSkeletonProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <RoomCardSkeleton key={i} />
      ))}
    </div>
  )
}
