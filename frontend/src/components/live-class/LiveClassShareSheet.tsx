'use client'

/**
 * LiveClassShareSheet — Share a Live Class / Live Stream room to DM, Group Chat,
 * Community, Feed, or copy link.
 *
 * SCHOOL streams: share is restricted to school members only (DM with school members,
 * school group chats). Community and Feed tabs are hidden for SCHOOL streams.
 *
 * PUBLIC streams: share anywhere (any friend, group, community, feed).
 */

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { getAvatarUrl } from '@/lib/avatar'
import api from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'

type Tab = 'dm' | 'group' | 'community' | 'feed' | 'copy'

interface Props {
  liveClassId: string
  title: string
  streamType: 'SCHOOL' | 'PUBLIC'
  onClose: () => void
}

export function LiveClassShareSheet({ liveClassId, title, streamType, onClose }: Props) {
  const { toast } = useToast()
  const { user } = useAuthStore()
  const isSchool = streamType === 'SCHOOL'
  // SCHOOL streams: only DM, Group, Copy. PUBLIC streams: all tabs.
  const [tab, setTab]           = useState<Tab>('dm')
  const [search, setSearch]     = useState('')
  const [sending, setSending]   = useState<string | null>(null)
  const [note, setNote]         = useState('')

  const roomUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/live-class/${liveClassId}`
    : `/live-class/${liveClassId}`

  // ── Friends for DM ────────────────────────────────────────────────────────
  // SCHOOL streams: fetch school members (people in the same school) so only
  // school members can be selected. PUBLIC: fetch all friends.
  const { data: friends = [] } = useQuery({
    queryKey: ['dm-friends-share-lc', isSchool, user?.schoolId],
    queryFn: async () => {
      if (isSchool && user?.schoolId) {
        // Fetch school members — these are the people who can actually join the class
        const r = await api.get(`/school-memberships/${user.schoolId}/members?limit=100`)
        const members: any[] = r.data.data?.members ?? r.data.data ?? []
        return members
          .filter((m: any) => m.userId !== user?.id)
          .map((m: any) => ({
            id: m.userId,
            otherUser: { id: m.userId, firstName: m.firstName ?? m.user?.firstName, lastName: m.lastName ?? m.user?.lastName, avatarUrl: m.avatarUrl ?? m.user?.avatarUrl },
          }))
      }
      // PUBLIC: all friends
      const r = await api.get('/social/friends?limit=100')
      const list: any[] = r.data.data ?? []
      return list.map((f: any) => ({ id: f.id, otherUser: f }))
    },
    staleTime: 30_000,
  })

  // ── Group Chats ───────────────────────────────────────────────────────────
  // SCHOOL streams: show all groups (school groups will be at the top naturally).
  // The note in the UI makes it clear this is a school-only class.
  const { data: groups = [] } = useQuery({
    queryKey: ['group-conversations-share-lc'],
    queryFn: () => api.get('/group-chat/conversations?limit=50').then(r => r.data.data ?? []),
    staleTime: 30_000,
  })

  // ── Communities — only for PUBLIC streams ─────────────────────────────────
  const { data: communities = [] } = useQuery({
    queryKey: ['my-communities-share-lc'],
    queryFn: () => api.get('/communities/mine').then(r => r.data.data?.items ?? r.data.data ?? []),
    enabled: tab === 'community' && !isSchool,
    staleTime: 60_000,
  })

  const handleSendDM = useCallback(async (conv: any) => {
    const friendUserId = conv.id
    setSending(friendUserId)
    try {
      const convRes = await api.get(`/dm/conversations/${friendUserId}/with`)
      const convId = convRes.data.data?.id
      if (!convId) throw new Error('Could not start conversation')
      await api.post(`/dm/conversations/${convId}/messages`, {
        msgType:       'LIVE_CLASS_SHARE',
        refEntityType: 'LiveClass',
        refEntityId:   liveClassId,
        body:          note.trim() || null,
      })
      toast({ title: `✅ Sent to ${conv.otherUser?.firstName ?? 'DM'}` })
      onClose()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to send', variant: 'destructive' })
    } finally { setSending(null) }
  }, [liveClassId, note, toast, onClose])

  const handleSendGroup = useCallback(async (conv: any) => {
    setSending(conv.id)
    try {
      await api.post(`/group-chat/conversations/${conv.id}/messages`, {
        type:          'LIVE_CLASS_SHARE',
        refEntityType: 'LiveClass',
        refEntityId:   liveClassId,
        body:          note.trim() || null,
      })
      toast({ title: `✅ Sent to ${conv.name ?? 'Group'}` })
      onClose()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to send', variant: 'destructive' })
    } finally { setSending(null) }
  }, [liveClassId, note, toast, onClose])

  const handlePostFeed = useCallback(async () => {
    setSending('feed')
    try {
      await api.post('/posts', {
        type:          'LIVE_CLASS_SHARE',
        refEntityType: 'LiveClass',
        refEntityId:   liveClassId,
        body:          note.trim() || null,
        visibility:    'PUBLIC',
      })
      toast({ title: '✅ Posted to your feed' })
      onClose()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to post', variant: 'destructive' })
    } finally { setSending(null) }
  }, [liveClassId, note, toast, onClose])

  const handlePostCommunity = useCallback(async (community: any) => {
    setSending(community.id)
    try {
      await api.post('/posts', {
        type:          'LIVE_CLASS_SHARE',
        refEntityType: 'LiveClass',
        refEntityId:   liveClassId,
        communityId:   community.id,
        body:          note.trim() || null,
        visibility:    'PUBLIC',
      })
      toast({ title: `✅ Shared to ${community.name}` })
      onClose()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to share', variant: 'destructive' })
    } finally { setSending(null) }
  }, [liveClassId, note, toast, onClose])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomUrl)
      toast({ title: '🔗 Link copied!' })
    } catch {
      toast({ title: 'Failed to copy', variant: 'destructive' })
    }
  }, [roomUrl, toast])

  const filteredFriends    = friends.filter((c: any) =>
    !search || `${c.otherUser?.firstName} ${c.otherUser?.lastName}`.toLowerCase().includes(search.toLowerCase())
  )
  const filteredGroups     = groups.filter((c: any) =>
    !search || (c.name ?? '').toLowerCase().includes(search.toLowerCase())
  )
  const filteredCommunities = communities.filter((c: any) =>
    !search || (c.name ?? '').toLowerCase().includes(search.toLowerCase())
  )

  // SCHOOL streams: DM (school members only) + Group + Copy
  // PUBLIC streams: DM + Group + Community + Feed + Copy
  const tabs: { id: Tab; label: string; emoji: string }[] = isSchool ? [
    { id: 'dm',    label: 'School Member', emoji: '👤' },
    { id: 'group', label: 'Group',         emoji: '👥' },
    { id: 'copy',  label: 'Copy Link',     emoji: '🔗' },
  ] : [
    { id: 'dm',        label: 'Friend',    emoji: '👤' },
    { id: 'group',     label: 'Group',     emoji: '👥' },
    { id: 'community', label: 'Community', emoji: '🏘️' },
    { id: 'feed',      label: 'Feed',      emoji: '📢' },
    { id: 'copy',      label: 'Copy Link', emoji: '🔗' },
  ]

  const streamEmoji = streamType === 'PUBLIC' ? '🌐' : '🎓'

  return (
    <AnimatePresence>
      <>
        <motion.div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 299 }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        />
        <motion.div
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 300,
            background: '#fff', borderRadius: '20px 20px 0 0',
            maxHeight: '72vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Handle */}
          <div style={{ width: 40, height: 4, background: '#e2e8f0', borderRadius: 2, margin: '12px auto 0' }} />

          {/* Header */}
          <div style={{ padding: '12px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1e293b' }}>Share</p>
              <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', marginTop: 2 }} title={title}>
                {streamEmoji} {title.length > 38 ? title.slice(0, 38) + '…' : title}
              </p>
              {isSchool && (
                <p style={{ margin: '4px 0 0', fontSize: 11, color: '#6366f1', fontWeight: 600 }}>
                  🔒 School class — only visible to school members
                </p>
              )}
            </div>
            <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, color: '#94a3b8' }}>✕</button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 6, padding: '12px 16px 0', overflowX: 'auto', scrollbarWidth: 'none' }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setSearch('') }}
                style={{
                  padding: '6px 14px', borderRadius: 20, border: '1px solid',
                  borderColor: tab === t.id ? '#4f46e5' : '#e5e7eb',
                  background: tab === t.id ? '#eef2ff' : '#f9fafb',
                  color: tab === t.id ? '#4f46e5' : '#64748b',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                {t.emoji} {t.label}
              </button>
            ))}
          </div>

          {/* Search */}
          {(tab === 'dm' || tab === 'group' || tab === 'community') && (
            <div style={{ padding: '10px 16px 0' }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={tab === 'dm' ? 'Search friends…' : tab === 'group' ? 'Search groups…' : 'Search communities…'}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#f9fafb' }}
              />
            </div>
          )}

          {/* Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0 24px' }}>

            {tab === 'dm' && (
              <div>
                {isSchool && (
                  <div style={{ margin: '8px 16px 0', padding: '8px 12px', backgroundColor: '#eef2ff', borderRadius: 10, border: '1px solid #c7d2fe' }}>
                    <p style={{ margin: 0, fontSize: 11, color: '#4f46e5', fontWeight: 600 }}>
                      🔒 Showing school members only. Only they can join this class.
                    </p>
                  </div>
                )}
                <div style={{ padding: '8px 16px 0' }}>
                  <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={2}
                    placeholder="Add a note (optional)…"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 12, resize: 'none', outline: 'none', boxSizing: 'border-box', background: '#f9fafb', color: '#374151' }} />
                </div>
                {filteredFriends.length === 0
                  ? <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: 24 }}>
                      {isSchool ? 'No school members found' : 'No friends found'}
                    </p>
                  : filteredFriends.map((conv: any) => (
                    <div key={conv.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px' }}>
                      <div style={{ width: 42, height: 42, borderRadius: 21, overflow: 'hidden', background: '#e0e7ff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#6366f1' }}>
                        {conv.otherUser?.avatarUrl
                          ? <img src={getAvatarUrl(conv.otherUser.avatarUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : `${conv.otherUser?.firstName?.[0] ?? '?'}${conv.otherUser?.lastName?.[0] ?? ''}`}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{conv.otherUser?.firstName} {conv.otherUser?.lastName}</p>
                      </div>
                      <button onClick={() => handleSendDM(conv)} disabled={!!sending}
                        style={{ padding: '6px 14px', borderRadius: 10, border: 'none', background: sending === conv.id ? '#f1f5f9' : '#4f46e5', color: sending === conv.id ? '#94a3b8' : '#fff', fontSize: 12, fontWeight: 600, cursor: sending === conv.id ? 'default' : 'pointer' }}>
                        {sending === conv.id ? '…' : 'Send'}
                      </button>
                    </div>
                  ))}
              </div>
            )}

            {/* Group */}
            {tab === 'group' && (
              <div>
                <div style={{ padding: '8px 16px 0' }}>
                  <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={2}
                    placeholder="Add a note (optional)…"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 12, resize: 'none', outline: 'none', boxSizing: 'border-box', background: '#f9fafb', color: '#374151' }} />
                </div>
                {filteredGroups.length === 0
                  ? <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: 24 }}>No groups found</p>
                  : filteredGroups.map((conv: any) => (
                    <div key={conv.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px' }}>
                      <div style={{ width: 42, height: 42, borderRadius: 21, overflow: 'hidden', background: '#e0e7ff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#6366f1' }}>
                        {conv.avatarUrl
                          ? <img src={getAvatarUrl(conv.avatarUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : (conv.name?.[0] ?? '?')}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{conv.name}</p>
                        <p style={{ margin: 0, fontSize: 11, color: '#94a3b8' }}>{conv.memberCount ?? ''} members</p>
                      </div>
                      <button onClick={() => handleSendGroup(conv)} disabled={!!sending}
                        style={{ padding: '6px 14px', borderRadius: 10, border: 'none', background: sending === conv.id ? '#f1f5f9' : '#4f46e5', color: sending === conv.id ? '#94a3b8' : '#fff', fontSize: 12, fontWeight: 600, cursor: sending === conv.id ? 'default' : 'pointer' }}>
                        {sending === conv.id ? '…' : 'Send'}
                      </button>
                    </div>
                  ))}
              </div>
            )}

            {/* Community */}
            {tab === 'community' && (
              filteredCommunities.length === 0
                ? <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: 24 }}>
                    {communities.length === 0 ? 'You are not in any communities' : 'No communities found'}
                  </p>
                : <div>
                    <div style={{ padding: '10px 16px 4px' }}>
                      <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={2}
                        placeholder="Add a note (optional)…"
                        style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 12, resize: 'none', outline: 'none', boxSizing: 'border-box', background: '#f9fafb', color: '#374151' }} />
                    </div>
                    {filteredCommunities.map((community: any) => (
                      <div key={community.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px' }}>
                        <div style={{ width: 42, height: 42, borderRadius: 21, overflow: 'hidden', background: '#faf5ff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#7c3aed' }}>
                          {community.avatarUrl
                            ? <img src={getAvatarUrl(community.avatarUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : (community.name?.[0] ?? '?')}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{community.name}</p>
                          <p style={{ margin: 0, fontSize: 11, color: '#94a3b8' }}>{community.privacy} · {community._count?.members ?? ''} members</p>
                        </div>
                        <button onClick={() => handlePostCommunity(community)} disabled={!!sending}
                          style={{ padding: '6px 14px', borderRadius: 10, border: 'none', background: sending === community.id ? '#f1f5f9' : '#4f46e5', color: sending === community.id ? '#94a3b8' : '#fff', fontSize: 12, fontWeight: 600, cursor: sending === community.id ? 'default' : 'pointer' }}>
                          {sending === community.id ? '…' : 'Share'}
                        </button>
                      </div>
                    ))}
                  </div>
            )}

            {/* Feed */}
            {tab === 'feed' && (
              <div style={{ padding: '12px 16px' }}>
                <p style={{ margin: '0 0 4px', fontSize: 12, color: '#64748b' }}>Add a note (optional)</p>
                <p style={{ margin: '0 0 8px', fontSize: 11, color: '#94a3b8' }}>
                  A live stream card will appear in your feed — others can tap to join directly.
                </p>
                <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={3}
                  placeholder="Say something about the stream…"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 13, resize: 'vertical', outline: 'none', boxSizing: 'border-box', background: '#f9fafb' }} />
                <button onClick={handlePostFeed} disabled={!!sending}
                  style={{ marginTop: 12, width: '100%', padding: '12px 0', borderRadius: 12, border: 'none', background: sending ? '#f1f5f9' : '#4f46e5', color: sending ? '#94a3b8' : '#fff', fontSize: 14, fontWeight: 700, cursor: sending ? 'default' : 'pointer' }}>
                  {sending === 'feed' ? 'Posting…' : '📢 Post to Feed'}
                </button>
              </div>
            )}

            {/* Copy */}
            {tab === 'copy' && (
              <div style={{ padding: 16 }}>
                <div style={{ background: '#f8fafc', borderRadius: 10, padding: 12, fontSize: 12, color: '#64748b', wordBreak: 'break-all', marginBottom: 12, border: '1px solid #e5e7eb' }}>
                  {roomUrl}
                </div>
                <button onClick={handleCopy}
                  style={{ width: '100%', padding: '12px 0', borderRadius: 12, border: 'none', background: '#4f46e5', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  📋 Copy Link
                </button>
                <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 11, marginTop: 8 }}>
                  Anyone with this link can join the {streamType === 'PUBLIC' ? 'stream' : 'class'}
                </p>
              </div>
            )}

          </div>
        </motion.div>
      </>
    </AnimatePresence>
  )
}
