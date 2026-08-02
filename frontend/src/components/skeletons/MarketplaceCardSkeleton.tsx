import { Skeleton } from '@/components/ui/skeleton'

/**
 * A single placeholder card matching a typical marketplace product card layout.
 */
function ProductCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      {/* Product image */}
      <Skeleton className="w-full aspect-square" />

      {/* Card body */}
      <div className="p-3 space-y-2">
        {/* Title */}
        <Skeleton className="h-3.5 w-4/5 rounded-full" />
        {/* Subtitle / category */}
        <Skeleton className="h-2.5 w-1/2 rounded-full" />

        {/* Price + action */}
        <div className="flex items-center justify-between pt-1">
          <Skeleton className="h-4 w-14 rounded-full" />
          <Skeleton className="h-7 w-16 rounded-xl" />
        </div>
      </div>
    </div>
  )
}

interface MarketplaceCardSkeletonProps {
  /** Number of placeholder product cards to render (default 6) */
  count?: number
}

export function MarketplaceCardSkeleton({ count = 6 }: MarketplaceCardSkeletonProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  )
}
