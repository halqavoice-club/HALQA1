'use client'
/**
 * PostComposer v2 — Facebook-style post creation form
 * New features vs v1:
 *  - Emoji picker popover (no heavy dep — curated Tailwind grid)
 *  - @mention dropdown with live user search
 *  - Location label input
 *  - Up to 10 media items
 *  - Optimistic prepend to feed cache on success
 *  - Body text preserved on failure
 *
 * Requirements: 4.1–4.12
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { postsApi } from '@/lib/posts'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { getAvatarUrl } from '@/lib/avatar'
import { resolveMediaUrl } from '@/lib/media'
import { filterMentionCandidates, type UserSummary } from '@/lib/mentionUtils'
import { cn } from '@/lib/utils'
import api from '@/lib/api'
import {
  Image, Globe, Users, Lock, School, ChevronDown,
  Loader2, X, Smile, MapPin, Link2,
} from 'lucide-react'

// ─── Curated emoji palette ────────────────────────────────────────────────────
const EMOJI_GROUPS = [
  { label: 'Smileys', emojis: ['😀','😂','😍','🥰','😎','🤩','😭','😢','😡','🤔','😴','🤐','😷','🤮','🥳','🥺','😱','🤣','😇','🥸'] },
  { label: 'Gestures', emojis: ['👍','👎','👏','🙏','🤝','✌️','🤞','💪','🫶','❤️','🔥','⭐','✅','❌','💯','🎉','🎊','💡','🌙','☀️'] },
]

const VISIBILITY_OPTIONS = [
  { value: 'PUBLIC',      label: 'Everyone',    icon: Globe,   cls: 'text-green-600'  },
  { value: 'FOLLOWERS',   label: 'Followers',   icon: Users,   cls: 'text-blue-600'   },
  { value: 'PRIVATE',     label: 'Only me',     icon: Lock,    cls: 'text-gray-600'   },
  { value: 'SCHOOL_ONLY', label: 'School only', icon: School,  cls: 'text-purple-600' },
]

const MAX_BODY   = 5000
const MAX_MEDIA  = 10

interface Props {
  onCreated?:   () => void
  placeholder?: string
  compact?:     boolean
  communityId?: string
}

export function PostComposer({
  onCreated,
  placeholder = "What's on your mind?",
  compact = false,
  communityId,
}: Props) {
  const { user }    = useAuthStore()
  const { toast }   = useToast()
  const queryClient = useQueryClient()
  const fileRef     = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [body,        setBody]        = useState('')
  const [visibility,  setVisibility]  = useState('PUBLIC')
  const [showVis,     setShowVis]     = useState(false)
  const [media,       setMedia]       = useState<Array<{ url: string; type: string; mimeType: string }>>([])
  const [uploading,   setUploading]   = useState(false)
  const [focused,     setFocused]     = useState(false)
  const [showEmoji,   setShowEmoji]   = useState(false)
  const [location,    setLocation]    = useState('')
  const [showLocInput, setShowLocInput] = useState(false)

  // @mention dropdown
  const [mentionQuery,      setMentionQuery]      = useState<string | null>(null)
  const [mentionCandidates, setMentionCandidates] = useState<UserSummary[]>([])
  const [mentionStart,      setMentionStart]      = useState(0) // caret position of @

  // Link preview
  const [linkPreview,      setLinkPreview]      = useState<{ url: string; title: string | null; description: string | null; image: string | null } | null>(null)
  const [linkFetching,     setLinkFetching]     = useState(false)
  const [linkDismissed,    setLinkDismissed]    = useState<string | null>(null)  // URL user has dismissed
  const linkDebounceRef = useRef<ReturnType<typeof setTimeout>>()

  // URL regex — matches http(s):// URLs in text
  const URL_REGEX = /https?:\/\/[^\s<>"']+/gi

  // Debounced URL detector — fires 800ms after user stops typing
  const detectAndFetchLink = useCallback((text: string) => {
    clearTimeout(linkDebounceRef.current)
    linkDebounceRef.current = setTimeout(async () => {
      const matches = text.match(URL_REGEX)
      const firstUrl = matches?.[0]
      if (!firstUrl || firstUrl === linkDismissed || linkPreview?.url === firstUrl) return
      if (linkPreview) return // already have a preview
      setLinkFetching(true)
      try {
        const res = await postsApi.getLinkPreview(firstUrl)
        const data = res.data.data
        if (data.title) setLinkPreview(data)
      } catch { /* non-fatal */ }
      finally { setLinkFetching(false) }
    }, 800)
  }, [linkPreview, linkDismissed]) // eslint-disable-line react-hooks/exhaustive-deps
  // ── Detect @mention trigger in textarea ──────────────────────────────────
  const handleBodyChange = async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val   = e.target.value
    const caret = e.target.selectionStart ?? val.length

    setBody(val)
    detectAndFetchLink(val)

    // Find @ before caret
    const beforeCaret = val.slice(0, caret)
    const atIdx = beforeCaret.lastIndexOf('@')
    if (atIdx !== -1 && !beforeCaret.slice(atIdx + 1).includes(' ')) {
      const query = beforeCaret.slice(atIdx + 1)
      setMentionQuery(query)
      setMentionStart(atIdx)
      // Fetch candidates
      try {
        const res = await api.get('/users', { params: { search: query || undefined, limit: 10 } })
        const users: UserSummary[] = (res.data?.data?.items ?? res.data?.data ?? [])
          .map((u: any) => ({
            id: u.id, firstName: u.firstName, lastName: u.lastName,
            avatarUrl: u.avatarUrl, username: u.username,
          }))
        setMentionCandidates(filterMentionCandidates(query, users))
      } catch {
        setMentionCandidates([])
      }
    } else {
      setMentionQuery(null)
      setMentionCandidates([])
    }
  }

  const selectMention = (u: UserSummary) => {
    const before  = body.slice(0, mentionStart)
    const after   = body.slice(textareaRef.current?.selectionStart ?? body.length)
    // Always insert @username so backend mention resolver can match it.
    // Fall back to @firstName if the user hasn't set a username yet.
    const handle  = u.username ?? u.firstName
    const insert  = `@${handle} `
    setBody(before + insert + after)
    setMentionQuery(null)
    setMentionCandidates([])
    textareaRef.current?.focus()
  }

  // ── Insert emoji at caret ─────────────────────────────────────────────────
  const insertEmoji = (emoji: string) => {
    const ta    = textareaRef.current
    const caret = ta?.selectionStart ?? body.length
    const next  = body.slice(0, caret) + emoji + body.slice(caret)
    setBody(next.slice(0, MAX_BODY))
    setShowEmoji(false)
    ta?.focus()
  }

  // ── File upload ───────────────────────────────────────────────────────────
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    if (media.length + files.length > MAX_MEDIA) {
      toast({ title: `Max ${MAX_MEDIA} media items per post`, variant: 'destructive' })
      return
    }

    // Client-side size guard: 50 MB per file (matches backend multer limit)
    const oversized = files.filter(f => f.size > 50 * 1024 * 1024)
    if (oversized.length) {
      toast({ title: `${oversized[0].name} is too large (max 50 MB)`, variant: 'destructive' })
      if (fileRef.current) fileRef.current.value = ''
      return
    }

    setUploading(true)
    for (const f of files) {
      try {
        const form = new FormData()
        form.append('file', f)
        const r = await api.post('/upload', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          // Track per-file upload progress (future enhancement hook)
          timeout: 120_000, // 2 min for large videos
        })
        const uploaded = r.data.data
        setMedia(prev => [...prev, {
          url: uploaded.url,
          type: f.type.startsWith('video') ? 'VIDEO' : 'IMAGE',
          mimeType: f.type,
        }])
      } catch (err: any) {
        const msg = err?.response?.data?.message || err?.message || 'Upload failed'
        toast({ title: `Upload failed: ${msg}`, variant: 'destructive' })
      }
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Create post ───────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: () => postsApi.create({
      body: body.trim() || undefined,
      visibility,
      media,
      ...(location.trim() && { location: location.trim() }),
      ...(communityId && { communityId }),
      ...(linkPreview && {
        linkUrl:         linkPreview.url,
        linkTitle:       linkPreview.title ?? undefined,
        linkDescription: linkPreview.description ?? undefined,
        linkImage:       linkPreview.image ?? undefined,
      }),
    }),
    onSuccess: (response) => {
      const savedBody = body
      setBody(''); setMedia([]); setFocused(false); setLocation(''); setShowLocInput(false)
      setLinkPreview(null); setLinkDismissed(null)
      toast({ title: '✅ Posted!' })

      // Optimistic prepend to feed cache
      const newPost = response?.data?.data
      if (newPost) {
        queryClient.setQueryData(['feed'], (old: any) => {
          if (!old?.pages) return old
          return {
            ...old,
            pages: [
              { ...old.pages[0], items: [newPost, ...(old.pages[0]?.items ?? [])] },
              ...old.pages.slice(1),
            ],
          }
        })
      }
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      queryClient.invalidateQueries({ queryKey: ['user-posts'] })
      onCreated?.()
      void savedBody // satisfy linter
    },
    onError: (e: any) => {
      // Preserve body text on failure (Requirement 4.10)
      toast({ title: e?.response?.data?.message || 'Failed to post', variant: 'destructive' })
    },
  })

  const vis      = VISIBILITY_OPTIONS.find(v => v.value === visibility)!
  const canPost  = (body.trim().length > 0 || media.length > 0) && !createMutation.isPending && !uploading
  const avatarSrc = getAvatarUrl(user?.avatarUrl)
  const initials  = user ? `${user.firstName?.charAt(0) ?? ''}${user.lastName?.charAt(0) ?? ''}`.toUpperCase() || '?' : '?'

  return (
    <div className={cn('bg-white rounded-2xl border border-gray-100 shadow-sm', compact ? 'p-3' : 'p-4')}>
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full overflow-hidden bg-indigo-100 flex-shrink-0 flex items-center justify-center text-sm font-bold text-indigo-600">
          {avatarSrc ? <img src={avatarSrc} alt="" className="w-full h-full object-cover" /> : initials}
        </div>

        <div className="flex-1 min-w-0">
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={body}
            onChange={handleBodyChange}
            onFocus={() => setFocused(true)}
            placeholder={placeholder}
            rows={focused || body.length > 0 ? 3 : 1}
            maxLength={MAX_BODY}
            className="w-full resize-none text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent leading-relaxed"
          />

          {/* Character counter near limit */}
          {body.length > MAX_BODY * 0.8 && (
            <p className={cn('text-xs text-right', body.length >= MAX_BODY ? 'text-red-500' : 'text-gray-400')}>
              {MAX_BODY - body.length} left
            </p>
          )}

          {/* @mention dropdown */}
          {mentionQuery !== null && mentionCandidates.length > 0 && (
            <div className="absolute z-30 mt-1 bg-white rounded-xl shadow-lg border border-gray-100 py-1 min-w-[200px]">
              {mentionCandidates.map(u => (
                <button key={u.id} onClick={() => selectMention(u)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition-colors text-left">
                  <div className="w-6 h-6 rounded-full bg-indigo-100 flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-indigo-600">
                    {u.avatarUrl
                      ? <img src={resolveMediaUrl(u.avatarUrl)} alt="" className="w-full h-full object-cover rounded-full" />
                      : `${u.firstName?.charAt(0) ?? ''}${u.lastName?.charAt(0) ?? ''}`.toUpperCase() || '?'}
                  </div>
                  <span>{u.firstName} {u.lastName}</span>
                  {u.username && <span className="text-gray-400 text-xs">@{u.username}</span>}
                </button>
              ))}
            </div>
          )}

          {/* Location label input */}
          {showLocInput && (
            <div className="flex items-center gap-2 mt-2 bg-gray-50 rounded-xl px-3 py-2">
              <MapPin className="w-4 h-4 text-red-400 flex-shrink-0" />
              <input
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="Add a location…"
                maxLength={80}
                className="flex-1 text-sm text-gray-700 bg-transparent outline-none placeholder-gray-400"
              />
              <button onClick={() => { setShowLocInput(false); setLocation('') }}
                className="text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Link preview card */}
          {linkFetching && (
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              Fetching link preview…
            </div>
          )}
          {linkPreview && !linkFetching && (
            <div className="mt-2 rounded-xl border border-gray-200 overflow-hidden bg-gray-50 relative">
              <button
                onClick={() => { setLinkDismissed(linkPreview.url); setLinkPreview(null) }}
                className="absolute top-1.5 right-1.5 w-5 h-5 bg-white rounded-full shadow flex items-center justify-center hover:bg-gray-100 z-10"
              >
                <X className="w-3 h-3 text-gray-500" />
              </button>
              {linkPreview.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={linkPreview.image} alt="" className="w-full h-28 object-cover" />
              )}
              <div className="p-2.5">
                <div className="flex items-center gap-1 mb-0.5">
                  <Link2 className="w-3 h-3 text-gray-400 flex-shrink-0" />
                  <p className="text-[10px] text-gray-400 truncate">{new URL(linkPreview.url).hostname}</p>
                </div>
                {linkPreview.title && (
                  <p className="text-xs font-semibold text-gray-800 line-clamp-1">{linkPreview.title}</p>
                )}
                {linkPreview.description && (
                  <p className="text-[11px] text-gray-500 line-clamp-2 mt-0.5">{linkPreview.description}</p>
                )}
              </div>
            </div>
          )}

          {/* Media previews */}
          {media.length > 0 && (            <div className="flex flex-wrap gap-2 mt-2">
              {media.map((m, i) => (
                <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden bg-gray-100">
                  {m.type === 'IMAGE'
                    ? <img src={resolveMediaUrl(m.url)} alt="" className="w-full h-full object-cover" loading="lazy" />
                    : <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">VIDEO</div>
                  }
                  <button
                    onClick={() => setMedia(prev => prev.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center">
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Toolbar — shown when focused */}
          {(focused || body.length > 0) && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
              <div className="flex items-center gap-1">
                {/* Photo/Video upload */}
                <button onClick={() => fileRef.current?.click()} disabled={uploading || media.length >= MAX_MEDIA}
                  className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 hover:text-indigo-600 transition-colors disabled:opacity-40"
                  title="Add photo/video">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Image className="w-4 h-4" />}
                </button>
                <input ref={fileRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={handleFile} />

                {/* Emoji picker */}
                <div className="relative">
                  <button
                    onClick={() => setShowEmoji(v => !v)}
                    className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 hover:text-yellow-500 transition-colors"
                    title="Add emoji"
                  >
                    <Smile className="w-4 h-4" />
                  </button>
                  {showEmoji && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowEmoji(false)} />
                      <div className="absolute bottom-10 left-0 z-20 bg-white rounded-2xl shadow-xl border border-gray-100 p-3 w-72">
                        {EMOJI_GROUPS.map(g => (
                          <div key={g.label} className="mb-2">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">{g.label}</p>
                            <div className="flex flex-wrap gap-1">
                              {g.emojis.map(em => (
                                <button key={em} onClick={() => insertEmoji(em)}
                                  className="text-xl hover:scale-125 transition-transform">
                                  {em}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Location */}
                <button
                  onClick={() => setShowLocInput(v => !v)}
                  className={cn(
                    'p-2 rounded-xl transition-colors',
                    showLocInput
                      ? 'bg-red-50 text-red-500'
                      : 'hover:bg-gray-100 text-gray-500 hover:text-red-500'
                  )}
                  title="Add location"
                >
                  <MapPin className="w-4 h-4" />
                </button>

                {/* Visibility picker */}
                <div className="relative">
                  <button onClick={() => setShowVis(v => !v)}
                    className={cn('flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-colors', vis.cls, 'border-current/20 hover:bg-gray-50')}>
                    <vis.icon className="w-3.5 h-3.5" />
                    {vis.label}
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {showVis && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowVis(false)} />
                      <div className="absolute bottom-9 left-0 z-20 bg-white rounded-xl shadow-lg border border-gray-100 py-1 min-w-[140px]">
                        {VISIBILITY_OPTIONS.map(v => (
                          <button key={v.value} onClick={() => { setVisibility(v.value); setShowVis(false) }}
                            className={cn('w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 transition-colors', visibility === v.value && 'bg-gray-50 font-semibold')}>
                            <v.icon className={cn('w-3.5 h-3.5', v.cls)} />
                            {v.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Post button */}
              <button
                onClick={() => createMutation.mutate()}
                disabled={!canPost}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {createMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Post
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
