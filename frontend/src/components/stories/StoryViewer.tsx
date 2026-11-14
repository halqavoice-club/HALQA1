'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { storiesApi, type StoryGroup, type Story } from '@/lib/stories'
import { getAvatarUrl } from '@/lib/avatar'
import { resolveMediaUrl } from '@/lib/media'
import { cn } from '@/lib/utils'
import { X, ChevronLeft, ChevronRight, Eye, Trash2 } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { formatDistanceToNow } from 'date-fns'

const REACTIONS = ['❤️','😮','😂','😢','👏','🔥']

interface Props {
  groups:       StoryGroup[]
  initialGroup: number
  onClose:      () => void
}

export function StoryViewer({ groups, initialGroup, onClose }: Props) {
  const { user }    = useAuthStore()
  const queryClient = useQueryClient()

  const [groupIdx, setGroupIdx] = useState(initialGroup)
  const [storyIdx, setStoryIdx] = useState(0)
  const [progress, setProgress] = useState(0)
  const [paused,   setPaused]   = useState(false)
  const [showReact, setShowReact] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | undefined>(undefined)

  const group   = groups[groupIdx]
  const story   = group?.stories[storyIdx]
  const isOwn   = group?.isOwn
  const TICK    = 50  // ms per progress tick

  const viewMutation = useMutation({
    mutationFn: (id: string) => storiesApi.view(id),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['stories-feed'] })
  })
  const reactMutation = useMutation({
    mutationFn: ({ id, type }: { id: string; type: string }) => storiesApi.react(id, type),
    onSuccess:  () => { setShowReact(false); queryClient.invalidateQueries({ queryKey: ['stories-feed'] }) }
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => storiesApi.remove(id),
    onSuccess:  () => { queryClient.invalidateQueries({ queryKey: ['stories-feed'] }); advance() }
  })

  const advance = useCallback(() => {
    if (storyIdx < group.stories.length - 1) {
      setStoryIdx(i => i + 1); setProgress(0)
    } else if (groupIdx < groups.length - 1) {
      setGroupIdx(g => g + 1); setStoryIdx(0); setProgress(0)
    } else {
      onClose()
    }
  }, [storyIdx, groupIdx, group?.stories?.length, groups?.length, onClose])

  // Auto-advance timer
  useEffect(() => {
    if (!story || paused) return
    const duration = (story.duration || 5) * 1000
    const steps = duration / TICK
    clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      setProgress(p => {
        if (p >= 100) { clearInterval(intervalRef.current); advance(); return 100 }
        return p + (100 / steps)
      })
    }, TICK)
    return () => clearInterval(intervalRef.current)
  }, [story?.id, paused, advance])

  // Mark as viewed
  useEffect(() => {
    if (story && !story.seen && !isOwn) {
      viewMutation.mutate(story.id)
    }
  }, [story?.id])

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')     onClose()
      if (e.key === 'ArrowRight') advance()
      if (e.key === 'ArrowLeft')  { if (storyIdx > 0) { setStoryIdx(i=>i-1); setProgress(0) } else if (groupIdx > 0) { setGroupIdx(g=>g-1); setStoryIdx(0); setProgress(0) } }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, storyIdx, groupIdx, onClose])

  if (!group || !story) return null

  const avatarSrc = getAvatarUrl(group.author.avatarUrl)
  const initials  = `${group.author.firstName?.charAt(0) ?? ''}${group.author.lastName?.charAt(0) ?? ''}`.toUpperCase() || '?'
  const mediaSrc  = resolveMediaUrl(story.mediaUrl)

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      onClick={() => setPaused(false)}>

      {/* Story container — max 9:16 aspect */}
      <div className="relative w-full max-w-sm h-full max-h-[95vh] mx-auto flex flex-col"
        onMouseDown={() => setPaused(true)}
        onMouseUp={() => setPaused(false)}
        onTouchStart={() => setPaused(true)}
        onTouchEnd={() => setPaused(false)}>

        {/* Progress bars */}
        <div className="absolute top-0 left-0 right-0 z-20 flex gap-1 p-2">
          {group.stories.map((s, i) => (
            <div key={s.id} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
              <div className={cn('h-full bg-white rounded-full transition-none',
                i < storyIdx ? 'w-full' : i === storyIdx ? '' : 'w-0'
              )} style={i === storyIdx ? { width: `${progress}%` } : {}} />
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="absolute top-6 left-0 right-0 z-20 flex items-center justify-between px-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-white flex-shrink-0 bg-indigo-900 flex items-center justify-center text-xs font-bold text-white">
              {avatarSrc ? <img src={avatarSrc} alt="" className="w-full h-full object-cover" /> : initials}
            </div>
            <div>
              <p className="text-white text-xs font-semibold drop-shadow">
                {group.author.firstName} {group.author.lastName}
              </p>
              <p className="text-white/70 text-[10px]">
                {formatDistanceToNow(new Date(story.createdAt), { addSuffix: true })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {isOwn && (
              <button onClick={() => deleteMutation.mutate(story.id)}
                className="p-1.5 rounded-full bg-black/30 text-white hover:bg-red-500/50 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button onClick={onClose}
              className="p-1.5 rounded-full bg-black/30 text-white hover:bg-black/50 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Story content */}
        <div className="flex-1 relative rounded-2xl overflow-hidden">
          {story.type === 'TEXT' && (
            <div className="w-full h-full flex items-center justify-center p-8"
              style={{ background: story.bgGradient || story.bgColor || '#6366f1' }}>
              <p className="text-center text-2xl font-bold leading-relaxed break-words"
                style={{ color: story.textColor || '#ffffff' }}>
                {story.text}
              </p>
            </div>
          )}
          {story.type === 'IMAGE' && mediaSrc && (
            <img src={mediaSrc} alt="" className="w-full h-full object-cover" />
          )}
          {story.type === 'VIDEO' && mediaSrc && (
            <video src={mediaSrc} autoPlay muted playsInline className="w-full h-full object-cover" />
          )}

          {/* Caption */}
          {story.caption && (
            <div className="absolute bottom-16 left-0 right-0 px-4">
              <p className="text-white text-sm font-medium text-center drop-shadow-lg bg-black/20 rounded-xl px-3 py-2">
                {story.caption}
              </p>
            </div>
          )}

          {/* View count (own stories) */}
          {isOwn && (
            <div className="absolute bottom-4 left-4 flex items-center gap-1 text-white/80 text-xs bg-black/30 px-2 py-1 rounded-full">
              <Eye className="w-3 h-3" /> {story.viewCount}
            </div>
          )}

          {/* Reaction picker */}
          {!isOwn && (
            <div className="absolute bottom-4 right-4">
              {showReact ? (
                <div className="flex items-center gap-1 bg-black/60 rounded-2xl px-2 py-1.5">
                  {REACTIONS.map(r => (
                    <button key={r} onClick={() => reactMutation.mutate({ id: story.id, type: r })}
                      className="text-xl hover:scale-125 transition-transform p-0.5">
                      {r}
                    </button>
                  ))}
                  <button onClick={() => setShowReact(false)} className="text-white/60 ml-1">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowReact(true)}
                  className="text-2xl bg-black/40 rounded-full w-10 h-10 flex items-center justify-center hover:bg-black/60 transition-colors">
                  ❤️
                </button>
              )}
            </div>
          )}
        </div>

        {/* Tap zones for navigation */}
        <button className="absolute left-0 top-0 bottom-0 w-1/3 z-10"
          onClick={e => { e.stopPropagation(); if (storyIdx > 0) { setStoryIdx(i=>i-1); setProgress(0) } else if (groupIdx > 0) { setGroupIdx(g=>g-1); setStoryIdx(0); setProgress(0) } }} />
        <button className="absolute right-0 top-0 bottom-0 w-1/3 z-10"
          onClick={e => { e.stopPropagation(); advance() }} />
      </div>

      {/* Prev group */}
      {groupIdx > 0 && (
        <button className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors z-30"
          onClick={() => { setGroupIdx(g=>g-1); setStoryIdx(0); setProgress(0) }}>
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}
      {/* Next group */}
      {groupIdx < groups.length - 1 && (
        <button className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors z-30"
          onClick={() => { setGroupIdx(g=>g+1); setStoryIdx(0); setProgress(0) }}>
          <ChevronRight className="w-5 h-5" />
        </button>
      )}
    </div>
  )
}
