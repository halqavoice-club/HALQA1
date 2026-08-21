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

  return (
    <div className="relative flex flex-1" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <button
        ref={btnRef}
        disabled={disabled}
        onClick={() => { if (!open) onReact(current ?? 'LIKE') }}
        className={cn(
          'flex flex-1 items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors select-none',
          isActive
            ? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        {emoji
          ? <span className="text-base leading-none">{emoji}</span>
          : <ThumbsUp className="w-4 h-4" />
        }
        <span>{isActive ? (current!.charAt(0) + current!.slice(1).toLowerCase()) : 'Like'}</span>
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
