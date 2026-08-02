'use client'
import { useState, useEffect } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import type { PostMedia } from '@/lib/posts'
import { resolveMediaUrl } from '@/lib/media'

interface Props {
  media:        PostMedia[]
  initialIndex: number
  onClose:      () => void
}

export function MediaViewer({ media, initialIndex, onClose }: Props) {
  const [idx, setIdx] = useState(initialIndex)
  const current = media[idx]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')      onClose()
      if (e.key === 'ArrowLeft')   setIdx(i => Math.max(0, i - 1))
      if (e.key === 'ArrowRight')  setIdx(i => Math.min(media.length - 1, i + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [media.length, onClose])

  const src = resolveMediaUrl(current.url)

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}>

      {/* Close */}
      <button className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors"
        onClick={onClose}>
        <X className="w-5 h-5" />
      </button>

      {/* Prev */}
      {idx > 0 && (
        <button className="absolute left-4 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors"
          onClick={e => { e.stopPropagation(); setIdx(i => i - 1) }}>
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}

      {/* Media */}
      <div className="max-w-4xl max-h-[90vh] w-full mx-8" onClick={e => e.stopPropagation()}>
        {current.type === 'IMAGE'
          ? <img src={src} alt="" className="w-full h-full object-contain rounded-xl max-h-[85vh]" />
          : <video src={src} controls autoPlay className="w-full rounded-xl max-h-[85vh]" />
        }
      </div>

      {/* Next */}
      {idx < media.length - 1 && (
        <button className="absolute right-4 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors"
          onClick={e => { e.stopPropagation(); setIdx(i => i + 1) }}>
          <ChevronRight className="w-5 h-5" />
        </button>
      )}

      {/* Dots */}
      {media.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
          {media.map((_, i) => (
            <button key={i} onClick={e => { e.stopPropagation(); setIdx(i) }}
              className={`w-2 h-2 rounded-full transition-all ${i === idx ? 'bg-white w-4' : 'bg-white/40'}`} />
          ))}
        </div>
      )}
    </div>
  )
}
