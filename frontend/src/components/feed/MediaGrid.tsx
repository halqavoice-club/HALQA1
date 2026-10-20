'use client'
import { resolveMediaUrl } from '@/lib/media'
import { resolveMediaLayout } from '@/lib/mediaUtils'
import type { PostMedia } from '@/lib/posts'
import { cn } from '@/lib/utils'
import { Play, Clapperboard } from 'lucide-react'

interface Props {
  media:          PostMedia[]
  onOpen:         (index: number) => void
  onOpenReels?:   () => void   // called when user clicks a VIDEO cell — navigates to Reels
}

export function MediaGrid({ media, onOpen, onOpenReels }: Props) {
  if (!media.length) return null
  const layout = resolveMediaLayout(media)

  // Helper: decide click handler — video → reels, image → lightbox
  const handleClick = (m: PostMedia, index: number) => {
    if (m.type === 'VIDEO' && onOpenReels) {
      onOpenReels()
    } else {
      onOpen(index)
    }
  }

  // Single item — full width 16:9
  if (layout.type === 'single') {
    const m = media[0]
    return (
      <div
        className="relative w-full aspect-video rounded-xl overflow-hidden bg-gray-100 cursor-pointer"
        onClick={() => handleClick(m, 0)}
      >
        <MediaCell m={m} />
      </div>
    )
  }

  // Two items — 50/50 side by side
  if (layout.type === 'sideBySide') {
    return (
      <div className="grid grid-cols-2 gap-0.5 rounded-xl overflow-hidden">
        {media.slice(0, 2).map((m, i) => (
          <div
            key={m.id}
            className="relative aspect-square bg-gray-100 cursor-pointer overflow-hidden"
            onClick={() => handleClick(m, i)}
          >
            <MediaCell m={m} />
          </div>
        ))}
      </div>
    )
  }

  // Three items — left tall + right 2 stacked
  if (layout.type === 'leftPlusStack') {
    return (
      <div className="grid grid-cols-2 gap-0.5 rounded-xl overflow-hidden">
        <div
          className="row-span-2 relative bg-gray-100 cursor-pointer overflow-hidden"
          style={{ aspectRatio: '1/1' }}
          onClick={() => handleClick(media[0], 0)}
        >
          <MediaCell m={media[0]} fill />
        </div>
        {media.slice(1, 3).map((m, i) => (
          <div
            key={m.id}
            className="relative aspect-square bg-gray-100 cursor-pointer overflow-hidden"
            onClick={() => handleClick(m, i + 1)}
          >
            <MediaCell m={m} />
          </div>
        ))}
      </div>
    )
  }

  // Mosaic — 2×2, last cell gets +N overlay
  const displayed = media.slice(0, 4)
  const overflow = layout.overflow ?? 0
  return (
    <div className="grid grid-cols-2 gap-0.5 rounded-xl overflow-hidden">
      {displayed.map((m, i) => (
        <div
          key={m.id}
          className="relative aspect-square bg-gray-100 cursor-pointer overflow-hidden"
          onClick={() => handleClick(m, i)}
        >
          <MediaCell m={m} />
          {i === 3 && overflow > 0 && (
            <div className="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-2xl font-bold">
              +{overflow}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Single cell renderer ──────────────────────────────────────────────────────
function MediaCell({ m, fill = false }: { m: PostMedia; fill?: boolean }) {
  const src = resolveMediaUrl(m.url)
  const isVideo = m.type === 'VIDEO'

  if (isVideo) {
    return (
      <>
        <video
          src={src}
          className={cn('w-full h-full object-cover', fill && 'absolute inset-0')}
          preload="metadata"
          muted
          playsInline
        />
        {/* Play overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
          <div className="w-10 h-10 bg-black/50 rounded-full flex items-center justify-center">
            <Play className="w-5 h-5 text-white fill-white" />
          </div>
          {/* Reels hint badge */}
          <div className="flex items-center gap-1 bg-black/50 rounded-full px-2 py-0.5">
            <Clapperboard className="w-3 h-3 text-white" />
            <span className="text-white text-[10px] font-semibold">Reels</span>
          </div>
        </div>
      </>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      className={cn('w-full h-full object-cover', fill && 'absolute inset-0')}
    />
  )
}
