'use client'

/**
 * VoiceShareSheet — Share a Voice Club room to DM, Group Chat, Feed, Community, or copy link.
 *
 * Reuses existing endpoints:
 *   DM:         GET /dm/conversations         → POST /dm/conversations/:convId/messages
 *   Group Chat: GET /group-chat/conversations → POST /group-chat/conversations/:convId/messages
 *   Feed:       POST /posts { type:'LIVE_ROOM_SHARE', refEntityType:'VoiceRoom', refEntityId }
 *   Community:  GET /communities/mine         → POST /posts { ...feed, communityId }
 *   Copy Link:  navigator.clipboard.writeText
 *
 * BUG-005 FIX: Feed and Community share now use LIVE_ROOM_SHARE post type so the
 * existing enrichLivePosts() + LiveCard infrastructure renders a rich room card.
 *
 * BUG-007 (partial): Share sheet header shows room cover emoji/title from active
 * room store — no extra API call needed.
 */

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { getAvatarUrl } from '@/lib/avatar'
import api from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'

type Tab = 'dm' | 'group' | 'feed' | 'community' | 'copy'

interface Props {
  roomId: string
  roomTitle: string
  onClose: () => void
}

export function VoiceShareSheet({ roomId, roomTitle, onClose }: Props) {
  const { toast } = useToast()
  const [tab, setTab]           = useState<Tab>('dm')
  const [search, setSearch]     = useState('')
  const [sending, setSending]   = useState<string | null>(null) // convId, 'feed', or communityId
  const [feedNote, setFeedNote] = useState('')

  // Web uses window.origin for the share URL — correct web app domain
  const roomUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/voice-club/${roomId}`
    : `/voice-club/${roomId}`

  // Plain-text fallback for DM/Group (these use text messages, not structured cards)
  const shareBody = `🎙️ Join me in "${roomTitle}" on Halqa Voice Club!\n${roomUrl}`

  // ── Fetch friends (all accepted friends, not just existing conversations) ────
  // Using the friends list ensures ALL friends appear even if no conversation exists yet.
  // GET /social/friends returns: [{ id, firstName, lastName, avatarUrl, ... }]
  const { data: dmConvs = [] } = useQuery({
    queryKey: ['dm-friends-share'],
    queryFn: () => api.get('/social/friends?limit=100').then(r => {
      const friends: any[] = r.data.data ?? []
      // Normalize to { id: userId, otherUser: friend } shape for DM tab rendering
      return friends.map((f: any) => ({ id: f.id, otherUser: f }))
    }),
    staleTime: 30_000,
  })

  // ── Fetch Group Chats ───────────────────────────────────────────────────────
  const { data: groupConvs = [] } = useQuery({
    queryKey: ['group-conversations-share'],
    queryFn: () => api.get('/group-chat/conversations?limit=50').then(r => r.data.data ?? []),
    staleTime: 30_000,
  })

  // ── Fetch user's communities ────────────────────────────────────────────────
  const { data: myCommunities = [] } = useQuery({
    queryKey: ['my-communities-share'],
    queryFn: () => api.get('/communities/mine').then(r => r.data.data?.items ?? r.data.data ?? []),
    enabled: tab === 'community',
    staleTime: 60_000,
  })

  const handleSendDM = useCallback(async (conv: any) => {
    const friendUserId = conv.id  // conv.id is the friend's userId from the friends list
    setSending(friendUserId)
    try {
      // Get or create a DM conversation with this friend, then send
      const convRes = await api.get(`/dm/conversations/${friendUserId}/with`)
      const convId = convRes.data.data?.id
      if (!convId) throw new Error('Could not start conversation')
      // Phase 5: send structured VOICE_ROOM_SHARE — only roomId is authoritative
      await api.post(`/dm/conversations/${convId}/messages`, {
        msgType:       'VOICE_ROOM_SHARE',
        refEntityType: 'VoiceRoom',
        refEntityId:   roomId,
        body:          feedNote.trim() || null,
      })
      toast({ title: `✅ Sent to ${conv.otherUser?.firstName ?? 'DM'}` })
      onClose()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to send', variant: 'destructive' })
    } finally { setSending(null) }
  }, [feedNote, roomId, toast, onClose])

  const handleSendGroup = useCallback(async (conv: any) => {
    const convId = conv.id
    setSending(convId)
    try {
      // Phase 5: send structured VOICE_ROOM_SHARE — only roomId is authoritative
      await api.post(`/group-chat/conversations/${convId}/messages`, {
        type:          'VOICE_ROOM_SHARE',
        refEntityType: 'VoiceRoom',
        refEntityId:   roomId,
        body:          feedNote.trim() || null,
      })
      toast({ title: `✅ Sent to ${conv.name ?? 'Group'}` })
      onClose()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to send', variant: 'destructive' })
    } finally { setSending(null) }
  }, [feedNote, roomId, toast, onClose])

  // BUG-005 FIX: Use LIVE_ROOM_SHARE so enrichLivePosts() + LiveCard render a
  // rich room card instead of a plain text post.
  const handlePostFeed = useCallback(async () => {
    setSending('feed')
    try {
      await api.post('/posts', {
        type:          'LIVE_ROOM_SHARE',
        refEntityType: 'VoiceRoom',
        refEntityId:   roomId,
        body:          feedNote.trim() || null,
        visibility:    'PUBLIC',
      })
      toast({ title: '✅ Posted to your feed' })
      onClose()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to post', variant: 'destructive' })
    } finally { setSending(null) }
  }, [feedNote, roomId, toast, onClose])

  // Community share — same LIVE_ROOM_SHARE type with communityId
  const handlePostCommunity = useCallback(async (community: any) => {
    setSending(community.id)
    try {
      await api.post('/posts', {
        type:          'LIVE_ROOM_SHARE',
        refEntityType: 'VoiceRoom',
        refEntityId:   roomId,
        communityId:   community.id,
        body:          feedNote.trim() || null,
        visibility:    'PUBLIC',
      })
      toast({ title: `✅ Shared to ${community.name}` })
      onClose()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to share', variant: 'destructive' })
    } finally { setSending(null) }
  }, [feedNote, roomId, toast, onClose])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomUrl)
      toast({ title: '🔗 Link copied!' })
    } catch {
      toast({ title: 'Failed to copy', variant: 'destructive' })
    }
  }, [roomUrl, toast])

  const filteredDM = search
    ? dmConvs.filter((c: any) =>
        `${c.otherUser?.firstName} ${c.otherUser?.lastName}`.toLowerCase().includes(search.toLowerCase())
      )
    : dmConvs

  const filteredGroup = search
    ? groupConvs.filter((c: any) => (c.name ?? '').toLowerCase().includes(search.toLowerCase()))
    : groupConvs

  const filteredCommunities = search
    ? myCommunities.filter((c: any) => (c.name ?? '').toLowerCase().includes(search.toLowerCase()))
    : myCommunities

  const tabs: { id: Tab; label: string; emoji: string }[] = [
    { id: 'dm',        label: 'Friend',     emoji: '👤' },
    { id: 'group',     label: 'Group',      emoji: '👥' },
    { id: 'feed',      label: 'Feed',       emoji: '📢' },
    { id: 'community', label: 'Community',  emoji: '🏘️' },
    { id: 'copy',      label: 'Copy Link',  emoji: '🔗' },
  ]

  return (
    <AnimatePresence>
      <>
        {/* Backdrop */}
        <motion.div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 299 }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        />

        {/* Sheet */}
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
              <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1e293b' }}>Share Room</p>
              <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', marginTop: 2 }} title={roomTitle}>
                🎙️ {roomTitle.length > 35 ? roomTitle.slice(0, 35) + '…' : roomTitle}
              </p>
            </div>
            <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, color: '#94a3b8' }}>✕</button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 6, padding: '12px 16px 0', overflowX: 'auto', scrollbarWidth: 'none' }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setSearch('') }}
                style={{
                  padding: '6px 14px', borderRadius: 20, border: '1px solid',
                  borderColor: tab === t.id ? '#7c3aed' : '#e5e7eb',
                  background: tab === t.id ? '#ede9fe' : '#f9fafb',
                  color: tab === t.id ? '#7c3aed' : '#64748b',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                {t.emoji} {t.label}
              </button>
            ))}
          </div>

          {/* Search (DM + Group + Community) */}
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

            {/* DM */}
            {tab === 'dm' && (
              <div>
                {/* Optional note for the share */}
                <div style={{ padding: '8px 16px 0' }}>
                  <textarea
                    value={feedNote}
                    onChange={e => setFeedNote(e.target.value)}
                    maxLength={500}
                    rows={2}
                    placeholder="Add a note (optional)…"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 12, resize: 'none', outline: 'none', boxSizing: 'border-box', background: '#f9fafb', color: '#374151' }}
                  />
                </div>
                {filteredDM.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: 24 }}>No conversations found</p>
                ) : filteredDM.map((conv: any) => (
                  <div key={conv.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px' }}>
                    <div style={{ width: 42, height: 42, borderRadius: 21, overflow: 'hidden', background: '#e0e7ff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#6366f1' }}>
                      {conv.otherUser?.avatarUrl
                        ? <img src={getAvatarUrl(conv.otherUser.avatarUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : `${conv.otherUser?.firstName?.[0] ?? '?'}${conv.otherUser?.lastName?.[0] ?? ''}`}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{conv.otherUser?.firstName} {conv.otherUser?.lastName}</p>
                    </div>
                    <button
                      onClick={() => handleSendDM(conv)}
                      disabled={!!sending}
                      style={{ padding: '6px 14px', borderRadius: 10, border: 'none', background: sending === conv.id ? '#f1f5f9' : '#7c3aed', color: sending === conv.id ? '#94a3b8' : '#fff', fontSize: 12, fontWeight: 600, cursor: sending === conv.id ? 'default' : 'pointer' }}
                    >
                      {sending === conv.id ? '…' : 'Send'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Group */}
            {tab === 'group' && (
              <div>
                {/* Optional note for the share */}
                <div style={{ padding: '8px 16px 0' }}>
                  <textarea
                    value={feedNote}
                    onChange={e => setFeedNote(e.target.value)}
                    maxLength={500}
                    rows={2}
                    placeholder="Add a note (optional)…"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 12, resize: 'none', outline: 'none', boxSizing: 'border-box', background: '#f9fafb', color: '#374151' }}
                  />
                </div>
                {filteredGroup.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: 24 }}>No groups found</p>
                ) : filteredGroup.map((conv: any) => (
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
                    <button
                      onClick={() => handleSendGroup(conv)}
                      disabled={!!sending}
                      style={{ padding: '6px 14px', borderRadius: 10, border: 'none', background: sending === conv.id ? '#f1f5f9' : '#7c3aed', color: sending === conv.id ? '#94a3b8' : '#fff', fontSize: 12, fontWeight: 600, cursor: sending === conv.id ? 'default' : 'pointer' }}
                    >
                      {sending === conv.id ? '…' : 'Send'}
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
                  A Voice Club card will appear in your feed — recipients can tap "Join" directly.
                </p>
                <textarea
                  value={feedNote}
                  onChange={e => setFeedNote(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Say something about the room…"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 13, resize: 'vertical', outline: 'none', boxSizing: 'border-box', background: '#f9fafb' }}
                />
                <button
                  onClick={handlePostFeed}
                  disabled={!!sending}
                  style={{ marginTop: 12, width: '100%', padding: '12px 0', borderRadius: 12, border: 'none', background: sending ? '#f1f5f9' : '#7c3aed', color: sending ? '#94a3b8' : '#fff', fontSize: 14, fontWeight: 700, cursor: sending ? 'default' : 'pointer' }}
                >
                  {sending === 'feed' ? 'Posting…' : '📢 Post to Feed'}
                </button>
              </div>
            )}

            {/* Community */}
            {tab === 'community' && (
              filteredCommunities.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: 24 }}>
                  {myCommunities.length === 0 ? 'You are not a member of any communities' : 'No communities found'}
                </p>
              ) : (
                <div>
                  {/* Optional note input */}
                  <div style={{ padding: '10px 16px 4px' }}>
                    <textarea
                      value={feedNote}
                      onChange={e => setFeedNote(e.target.value)}
                      maxLength={500}
                      rows={2}
                      placeholder="Add a note (optional)…"
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 12, resize: 'none', outline: 'none', boxSizing: 'border-box', background: '#f9fafb', color: '#374151' }}
                    />
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
                        <p style={{ margin: 0, fontSize: 11, color: '#94a3b8' }}>
                          {community.privacy} · {community._count?.members ?? community.memberCount ?? ''} members
                        </p>
                      </div>
                      <button
                        onClick={() => handlePostCommunity(community)}
                        disabled={!!sending}
                        style={{ padding: '6px 14px', borderRadius: 10, border: 'none', background: sending === community.id ? '#f1f5f9' : '#7c3aed', color: sending === community.id ? '#94a3b8' : '#fff', fontSize: 12, fontWeight: 600, cursor: sending === community.id ? 'default' : 'pointer' }}
                      >
                        {sending === community.id ? '…' : 'Share'}
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* Copy */}
            {tab === 'copy' && (
              <div style={{ padding: '16px' }}>
                <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px', fontSize: 12, color: '#64748b', wordBreak: 'break-all', marginBottom: 12, border: '1px solid #e5e7eb' }}>
                  {roomUrl}
                </div>
                <button
                  onClick={handleCopy}
                  style={{ width: '100%', padding: '12px 0', borderRadius: 12, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                >
                  📋 Copy Link
                </button>
                <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 11, marginTop: 8 }}>
                  Anyone with this link can join the room
                </p>
              </div>
            )}

          </div>
        </motion.div>
      </>
    </AnimatePresence>
  )
}
