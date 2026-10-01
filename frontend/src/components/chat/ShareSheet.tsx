'use client'

/**
 * ShareSheet — unified share/forward panel for DM and Group Chat messages.
 *
 * Destinations:
 *   DM          → forward to a 1:1 DM conversation
 *   Group Chat  → forward to a group chat
 *   Feed        → create a new public post with the media
 *   Community   → create a post in a specific community
 *
 * Used by dm/page.tsx and group-chat/page.tsx when user clicks Forward.
 */

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, MessageSquare, Users, Globe, Hash, Search, Loader2, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getAvatarUrl } from '@/lib/avatar'
import api from '@/lib/api'
import { dmApi } from '@/lib/dm'
import { groupChatApi } from '@/lib/groupChat'

// ─── Types ────────────────────────────────────────────────────────────────────
export interface SharePayload {
  body?: string | null
  // DM fields
  msgType?: string
  // Group chat fields
  type?: string
  // Media (shared for both)
  mediaUrl?: string | null
  mimeType?: string | null
  fileSize?: number | null
  fileName?: string | null
  duration?: number | null
}

interface Props {
  open: boolean
  payload: SharePayload | null
  onClose: () => void
  onSuccess?: (destination: string) => void
  // Pre-loaded lists (pass from parent to avoid extra fetches)
  dmConversations?: any[]
  groupConversations?: any[]
}

type Tab = 'dm' | 'group' | 'feed' | 'community'

const TAB_LABELS: Record<Tab, { icon: any; label: string }> = {
  dm:        { icon: MessageSquare, label: 'DM' },
  group:     { icon: Users,         label: 'Groups' },
  feed:      { icon: Globe,         label: 'Feed' },
  community: { icon: Hash,          label: 'Community' },
}

// ─── Component ────────────────────────────────────────────────────────────────
export function ShareSheet({ open, payload, onClose, onSuccess, dmConversations = [], groupConversations = [] }: Props) {
  const [tab, setTab] = useState<Tab>('dm')
  const [search, setSearch] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  // Feed / community caption
  const [caption, setCaption] = useState('')
  const [communitySearch, setCommunitySearch] = useState('')
  const [communities, setCommunities] = useState<any[]>([])
  const [commLoading, setCommLoading] = useState(false)

  const reset = useCallback(() => {
    setTab('dm'); setSearch(''); setSending(false); setSent(null)
    setCaption(''); setCommunitySearch(''); setCommunities([])
  }, [])

  const handleClose = () => { reset(); onClose() }

  // Build the media payload correctly for each destination
  const buildMediaFields = useCallback(() => {
    if (!payload) return {}
    const msgType = payload.msgType ?? payload.type ?? 'TEXT'
    if (msgType === 'TEXT' || !payload.mediaUrl) return {}
    return {
      mediaUrl: payload.mediaUrl,
      mimeType: payload.mimeType,
      fileSize: payload.fileSize,
      fileName: payload.fileName,
      duration: payload.duration,
    }
  }, [payload])

  // ── Forward to DM ────────────────────────────────────────────────────────────
  const forwardToDm = useCallback(async (convId: string) => {
    if (!payload || sending) return
    setSending(true)
    try {
      const msgType = payload.msgType ?? 'TEXT'
      const p: any = { msgType }
      if (payload.body?.trim()) p.body = payload.body.trim()
      const media = buildMediaFields()
      if (media.mediaUrl) Object.assign(p, media)
      if (!p.body && !p.mediaUrl) throw new Error('Nothing to forward')
      await dmApi.send(convId, p)
      setSent(convId); onSuccess?.('dm')
    } catch (e: any) { /* show inline */ }
    finally { setSending(false) }
  }, [payload, sending, buildMediaFields, onSuccess])

  // ── Forward to Group ─────────────────────────────────────────────────────────
  const forwardToGroup = useCallback(async (convId: string) => {
    if (!payload || sending) return
    setSending(true)
    try {
      const type = payload.type ?? payload.msgType ?? 'TEXT'
      const p: any = { type }
      if (payload.body?.trim()) p.body = payload.body.trim()
      const media = buildMediaFields()
      if (media.mediaUrl) Object.assign(p, media)
      if (!p.body && !p.mediaUrl) throw new Error('Nothing to forward')
      await groupChatApi.send(convId, p)
      setSent(convId); onSuccess?.('group')
    } catch { /* inline */ }
    finally { setSending(false) }
  }, [payload, sending, buildMediaFields, onSuccess])

  // ── Share to Feed ─────────────────────────────────────────────────────────────
  const shareToFeed = useCallback(async () => {
    if (!payload || sending) return
    setSending(true)
    try {
      const media = buildMediaFields()
      const mediaArr = media.mediaUrl ? [{
        url: media.mediaUrl,
        type: (payload.msgType ?? payload.type ?? 'TEXT').toUpperCase() === 'VIDEO' ? 'VIDEO' : 'IMAGE',
        mimeType: media.mimeType,
        size: media.fileSize,
        duration: media.duration,
      }] : []
      const body = caption.trim() || payload.body?.trim() || ''
      if (!body && !mediaArr.length) throw new Error('Nothing to share')
      await api.post('/posts', {
        body: body || null,
        type: mediaArr.length ? (mediaArr[0].type === 'VIDEO' ? 'VIDEO' : 'IMAGE') : 'TEXT',
        visibility: 'PUBLIC',
        media: mediaArr,
      })
      setSent('feed'); onSuccess?.('feed')
    } catch { /* inline */ }
    finally { setSending(false) }
  }, [payload, sending, caption, buildMediaFields, onSuccess])

  // ── Share to Community ───────────────────────────────────────────────────────
  const loadCommunities = useCallback(async (q: string) => {
    if (!q.trim()) { setCommunities([]); return }
    setCommLoading(true)
    try {
      const r = await api.get('/communities', { params: { search: q, limit: 8, memberOnly: true } })
      setCommunities(r.data.data ?? [])
    } catch { setCommunities([]) }
    finally { setCommLoading(false) }
  }, [])

  const shareToCommunity = useCallback(async (communityId: string) => {
    if (!payload || sending) return
    setSending(true)
    try {
      const media = buildMediaFields()
      const mediaArr = media.mediaUrl ? [{
        url: media.mediaUrl,
        type: (payload.msgType ?? payload.type ?? 'TEXT').toUpperCase() === 'VIDEO' ? 'VIDEO' : 'IMAGE',
        mimeType: media.mimeType,
        size: media.fileSize,
        duration: media.duration,
      }] : []
      const body = caption.trim() || payload.body?.trim() || ''
      if (!body && !mediaArr.length) throw new Error('Nothing to share')
      await api.post('/posts', {
        body: body || null,
        type: mediaArr.length ? (mediaArr[0].type === 'VIDEO' ? 'VIDEO' : 'IMAGE') : 'TEXT',
        visibility: 'COMMUNITY',
        communityId,
        media: mediaArr,
      })
      setSent(communityId); onSuccess?.('community')
    } catch { /* inline */ }
    finally { setSending(false) }
  }, [payload, sending, caption, buildMediaFields, onSuccess])

  // ── Filter lists ─────────────────────────────────────────────────────────────
  const filteredDms = (dmConversations ?? []).filter((c: any) =>
    `${c.other?.firstName} ${c.other?.lastName}`.toLowerCase().includes(search.toLowerCase())
  )
  const filteredGroups = (groupConversations ?? []).filter((c: any) =>
    c.name?.toLowerCase().includes(search.toLowerCase())
  )

  if (!open || !payload) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 z-[200] flex items-end sm:items-center justify-center p-4"
        onClick={e => { if (e.target === e.currentTarget) handleClose() }}
      >
        <motion.div
          initial={{ y: 40, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 40, opacity: 0, scale: 0.97 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          style={{ maxHeight: '85vh' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-900 text-base">Share to…</h2>
            <button onClick={handleClose} className="p-1.5 rounded-full hover:bg-gray-100 transition-colors">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Preview */}
          {payload && (
            <div className="px-5 py-2 bg-gray-50 border-b border-gray-100">
              <p className="text-[10px] text-gray-400 uppercase font-semibold mb-0.5">Sharing</p>
              <p className="text-xs text-gray-600 truncate">
                {(payload.msgType ?? payload.type) && (payload.msgType ?? payload.type) !== 'TEXT'
                  ? `📎 ${payload.msgType ?? payload.type}${payload.fileName ? ` — ${payload.fileName}` : ''}`
                  : payload.body?.slice(0, 80) || '(empty)'}
              </p>
            </div>
          )}

          {/* Tabs */}
          <div className="flex border-b border-gray-100">
            {(Object.entries(TAB_LABELS) as [Tab, any][]).map(([key, { icon: Icon, label }]) => (
              <button key={key} onClick={() => { setTab(key); setSearch(''); setSent(null) }}
                className={cn(
                  'flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition-colors',
                  tab === key ? 'text-teal-700 border-b-2 border-teal-600' : 'text-gray-400 hover:text-gray-600'
                )}>
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="overflow-y-auto" style={{ maxHeight: 320 }}>

            {/* ── DM tab ── */}
            {tab === 'dm' && (
              <>
                <div className="px-4 py-2 border-b border-gray-50">
                  <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-1.5">
                    <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <input value={search} onChange={e => setSearch(e.target.value)}
                      placeholder="Search conversations…"
                      className="flex-1 text-sm bg-transparent outline-none placeholder:text-gray-400" />
                  </div>
                </div>
                {filteredDms.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">No conversations</p>
                ) : filteredDms.map((c: any) => (
                  <button key={c.id} onClick={() => forwardToDm(c.id)}
                    disabled={sending}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors border-b border-gray-50 last:border-0">
                    <div className="w-9 h-9 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0 text-sm font-bold text-teal-700">
                      {c.other?.firstName?.[0]}{c.other?.lastName?.[0]}
                    </div>
                    <p className="flex-1 text-sm font-medium text-gray-900 truncate">{c.other?.firstName} {c.other?.lastName}</p>
                    {sent === c.id
                      ? <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                      : sending ? <Loader2 className="w-4 h-4 animate-spin text-gray-300 flex-shrink-0" /> : null}
                  </button>
                ))}
              </>
            )}

            {/* ── Group tab ── */}
            {tab === 'group' && (
              <>
                <div className="px-4 py-2 border-b border-gray-50">
                  <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-1.5">
                    <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <input value={search} onChange={e => setSearch(e.target.value)}
                      placeholder="Search groups…"
                      className="flex-1 text-sm bg-transparent outline-none placeholder:text-gray-400" />
                  </div>
                </div>
                {filteredGroups.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">No groups</p>
                ) : filteredGroups.map((c: any) => (
                  <button key={c.id} onClick={() => forwardToGroup(c.id)}
                    disabled={sending}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors border-b border-gray-50 last:border-0">
                    <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0 text-sm font-bold text-indigo-700">
                      {(c.name || '?').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                      <p className="text-[10px] text-gray-400">{c.memberCount} members</p>
                    </div>
                    {sent === c.id ? <Check className="w-4 h-4 text-green-500 flex-shrink-0" /> : null}
                  </button>
                ))}
              </>
            )}

            {/* ── Feed tab ── */}
            {tab === 'feed' && (
              <div className="p-4 space-y-3">
                <p className="text-xs text-gray-500">Share as a public feed post. Add an optional caption:</p>
                <textarea
                  value={caption}
                  onChange={e => setCaption(e.target.value)}
                  placeholder="Add a caption… (optional)"
                  rows={3}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-teal-400 resize-none"
                  maxLength={2000}
                />
                <button
                  onClick={shareToFeed}
                  disabled={sending || !!sent}
                  className={cn(
                    'w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all',
                    sent ? 'bg-green-500' : 'bg-teal-600 hover:bg-teal-700 disabled:opacity-50'
                  )}>
                  {sent ? '✓ Posted to Feed' : sending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Post to Feed'}
                </button>
              </div>
            )}

            {/* ── Community tab ── */}
            {tab === 'community' && (
              <div className="p-4 space-y-3">
                <textarea
                  value={caption}
                  onChange={e => setCaption(e.target.value)}
                  placeholder="Add a caption… (optional)"
                  rows={2}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-teal-400 resize-none"
                />
                <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-1.5 border border-gray-200">
                  <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  <input
                    value={communitySearch}
                    onChange={e => { setCommunitySearch(e.target.value); loadCommunities(e.target.value) }}
                    placeholder="Search your communities…"
                    className="flex-1 text-sm bg-transparent outline-none placeholder:text-gray-400"
                  />
                  {commLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
                </div>
                {communities.map((c: any) => (
                  <button key={c.id} onClick={() => shareToCommunity(c.id)}
                    disabled={sending}
                    className="w-full flex items-center gap-3 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl text-left transition-colors">
                    <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-purple-700">
                      {(c.name || '?').slice(0, 2).toUpperCase()}
                    </div>
                    <p className="flex-1 text-sm font-medium text-gray-900 truncate">{c.name}</p>
                    {sent === c.id ? <Check className="w-4 h-4 text-green-500" /> : null}
                  </button>
                ))}
                {communitySearch.length >= 2 && communities.length === 0 && !commLoading && (
                  <p className="text-sm text-gray-400 text-center py-4">No communities found</p>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
