'use client'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { ThumbsUp } from 'lucide-react'
import type { ReactionType } from '@/lib/posts'

const REACTIONS: { type: ReactionType; emoji: string; label: string }[] = [
  { type: 'LIKE',        emoji: '👍', label: 'Like'       },
  { type: 'LOVE',        emoji: '❤️', label: 'Love'       },
  { type: 'CELEBRATE',   emoji: '🎉', label: 'Celebrate'  },
  { type: 'SUPPORT',     emoji: '🤝', label: 'Support'    },
  { type: 'INSIGHTFUL',  emoji: '💡', label: 'Insightful' },
  { type: 'FUNNY',       emoji: '😂', label: 'Funny'      },
]

const REACTION_EMOJI: Record<ReactionType, string> = {
  LIKE: '👍', LOVE: '❤️', CELEBRATE: '🎉',
  SUPPORT: '🤝', INSIGHTFUL: '💡', FUNNY: '😂',
}

interface Props {
  postId:   string
  current?: ReactionType
  count:    number
  onReact:  (type: ReactionType) => void
  disabled?: boolean
}

export function ReactionPicker({ postId, current, count, onReact, disabled }: Props) {
  const [open,    setOpen]    = useState(false)
  const [hovered, setHovered] = useState<ReactionType | null>(null)
  const btnRef   = useRef<HTMLButtonElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const [pickerPos, setPickerPos] = useState({ top: 0, left: 0 })

  // Open picker after 300ms hover
  const handleMouseEnter = () => {
    timerRef.current = setTimeout(() => {
      if (btnRef.current) {
        const rect = btnRef.current.getBoundingClientRect()
        setPickerPos({
          top:  rect.top - 60 + window.scrollY,
          left: rect.left + window.scrollX,
        })
      }
      setOpen(true)
    }, 300)
  }

  const handleMouseLeave = () => {
    clearTimeout(timerRef.current)
  }

  const handlePickerLeave = () => {
    setOpen(false)
    setHovered(null)
  }

  const handleSelect = (type: ReactionType) => {
    setOpen(false)
    setHovered(null)
    onReact(type)
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = () => { setOpen(false); setHovered(null) }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [open])

  const isActive = !!current
  const emoji    = current ? REACTION_EMOJI[current] : null

  const formatCount = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000   ? `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
    : n > 0        ? `${n}`
    : ''

  return (
    <div className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <button
        ref={btnRef}
        disabled={disabled}
        onClick={() => { if (!open) onReact(current ?? 'LIKE') }}
        className={cn(
          'flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold transition-colors select-none',
          isActive
            ? 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        {emoji
          ? <span className="text-base leading-none">{emoji}</span>
          : <ThumbsUp className={cn('w-4 h-4', isActive ? 'text-indigo-600 fill-indigo-600' : 'text-gray-500')} />
        }
        {formatCount(count) && (
          <span>{formatCount(count)}</span>
        )}
      </button>

      {/* Portal-rendered picker */}
      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[9999] flex items-center gap-1 bg-white rounded-2xl shadow-xl border border-gray-100 px-3 py-2 animate-in fade-in zoom-in-95 duration-150"
          style={{ top: pickerPos.top, left: pickerPos.left }}
          onMouseLeave={handlePickerLeave}
          onClick={e => e.stopPropagation()}
        >
          {REACTIONS.map(r => (
            <button
              key={r.type}
              title={r.label}
              onMouseEnter={() => setHovered(r.type)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => handleSelect(r.type)}
              className={cn(
                'text-2xl transition-transform duration-100 hover:scale-125 active:scale-110',
                hovered === r.type && 'scale-125',
                current === r.type && 'ring-2 ring-indigo-400 rounded-full'
              )}
            >
              {r.emoji}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
