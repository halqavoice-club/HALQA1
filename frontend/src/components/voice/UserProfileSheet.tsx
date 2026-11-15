'use client'

/**
 * UserProfileSheet
 * ─────────────────────────────────────────────────────────────────────────────
 * Bottom sheet that slides up when a user taps any avatar inside a voice room.
 *
 * Shows:
 *   - Avatar + name + role badge
 *   - Bio (if set)
 *   - Followers / Following counts
 *   - Follow / Unfollow button
 *   - Add Friend / Requested / Accept / Friends button
 *   - "Send Message" shortcut (friends only)
 *   - Moderator actions (mute / demote / kick / make-mod / transfer) — host/mod only
 *
 * Real-time:
 *   - Counts and relationship state fetched fresh on open
 *   - UI updates instantly after any action (optimistic + server confirm)
 *   - Socket events (social:followed, social:request_accepted, etc.) trigger
 *     re-fetch via React Query invalidation (handled by useSocialSocket in layout)
 */

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { socialApi } from '@/lib/social'
import { getAvatarUrl } from '@/lib/avatar'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { cn } from '@/lib/utils'
import { MessageSquare, Loader2, X, Users, UserCheck, Mic, ShieldCheck, UserMinus, Crown } from 'lucide-react'
import Link from 'next/link'
import { AlertDialog } from '@/components/ui/alert-dialog'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SheetParticipant {
  userId: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  role: string          // HOST | MODERATOR | SPEAKER | AUDIENCE
  isMuted: boolean
  bio?: string | null   // pre-populated if available, otherwise fetched
}

interface SocialCounts {
  followers: number
  following: number
  friends: number
  isFollowing: boolean
  friendStatus: 'none' | 'pending_sent' | 'pending_received' | 'friends'
  mutualFriends: number
}

interface Props {
  participant: SheetParticipant | null
  onClose: () => void
  // Moderator actions (only passed when caller has permission)
  onMute?:       () => void
  onDemote?:     () => void
  onKick?:       () => void
  onBan?:        () => void
  onUnban?:      () => void
  onMakeMod?:    () => void
  onRemoveMod?:  () => void
  onTransfer?:   () => void
  onPassMic?:    () => void
  // Context
  myRole: string
  roomId: string | null
}

// ─── Role badge ───────────────────────────────────────────────────────────────
const ROLE_META: Record<string, { icon: string; label: string; color: string }> = {
  HOST:      { icon: '👑', label: 'Host',      color: '#f59e0b' },
  MODERATOR: { icon: '🛡️', label: 'Moderator', color: '#8b5cf6' },
  SPEAKER:   { icon: '🎙️', label: 'Speaker',   color: '#10b981' },
  AUDIENCE:  { icon: '👂', label: 'Listener',  color: '#6b7280' },
}

// ─── Follow button ────────────────────────────────────────────────────────────
function FollowButton({
  userId, isFollowing, onToggle, loading,
}: {
  userId: string; isFollowing: boolean; onToggle: () => void; loading: boolean
}) {
  return (
    <button
      onClick={onToggle}
      disabled={loading}
      className={cn(
        'ups-action-btn',
        isFollowing ? 'ups-action-btn--following' : 'ups-action-btn--follow'
      )}
    >
      {loading
        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
        : isFollowing ? <UserCheck className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />
      }
      {isFollowing ? 'Following' : 'Follow'}
    </button>
  )
}

// ─── Friend button ────────────────────────────────────────────────────────────
function FriendButton({
  friendStatus, onAction, loading,
}: {
  friendStatus: SocialCounts['friendStatus']; onAction: () => void; loading: boolean
}) {
  const cfg = {
    none:             { label: 'Add Friend',  cls: 'ups-action-btn--friend' },
    pending_sent:     { label: 'Requested',   cls: 'ups-action-btn--requested' },
    pending_received: { label: 'Accept',      cls: 'ups-action-btn--accept' },
    friends:          { label: 'Friends ✓',   cls: 'ups-action-btn--friends' },
  }[friendStatus]

  return (
    <button
      onClick={friendStatus === 'pending_sent' ? undefined : onAction}
      disabled={loading || friendStatus === 'pending_sent'}
      className={cn('ups-action-btn', cfg.cls)}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
      {cfg.label}
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export function UserProfileSheet({
  participant, onClose,
  onMute, onDemote, onKick, onBan, onUnban, onMakeMod, onRemoveMod, onTransfer, onPassMic,
  myRole, roomId,
}: Props) {
  const { user: me } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [followLoading, setFollowLoading] = useState(false)
  const [friendLoading, setFriendLoading] = useState(false)
  const [banDialogOpen, setBanDialogOpen] = useState(false)

  // Optimistic local state — starts from server data, updates instantly on action
  const [localCounts, setLocalCounts] = useState<SocialCounts | null>(null)

  const isOpen = !!participant
  const isMe   = participant?.userId === me?.id

  // ── Fetch social counts when sheet opens ──────────────────────────────────
  const { data: counts, isLoading: countsLoading } = useQuery<SocialCounts>({
    queryKey: ['ups-counts', participant?.userId],
    queryFn:  () => socialApi.counts(participant!.userId).then(r => r.data.data),
    enabled:  isOpen && !isMe && !!participant?.userId,
    staleTime: 0,
  })

  // ── Fetch bio (only if not already in participant data) ───────────────────
  const { data: userProfile } = useQuery<{ bio?: string | null }>({
    queryKey: ['ups-profile', participant?.userId],
    queryFn:  () => import('@/lib/api').then(m => m.default.get(`/users/${participant!.userId}`)).then(r => r.data.data),
    enabled:  isOpen && !!participant?.userId && participant?.bio === undefined,
    staleTime: 60000,
  })

  const bio = participant?.bio !== undefined ? participant.bio : userProfile?.bio

  // Sync server data into local optimistic state
  useEffect(() => {
    if (counts) setLocalCounts(counts)
  }, [counts])

  // Reset local state when sheet closes
  useEffect(() => {
    if (!isOpen) setLocalCounts(null)
  }, [isOpen])

  // ── Follow / Unfollow ─────────────────────────────────────────────────────
  const handleFollow = useCallback(async () => {
    if (!participant || !localCounts) return
    const wasFollowing = localCounts.isFollowing

    // Optimistic update
    setLocalCounts(c => c ? {
      ...c,
      isFollowing: !wasFollowing,
      followers: wasFollowing ? c.followers - 1 : c.followers + 1,
    } : c)

    setFollowLoading(true)
    try {
      if (wasFollowing) {
        await socialApi.unfollow(participant.userId)
      } else {
        await socialApi.follow(participant.userId)
        toast({ title: `✅ Following ${participant.firstName}` })
      }
      // Invalidate global queries so sidebar badge and other pages update
      queryClient.invalidateQueries({ queryKey: ['social-counts', participant.userId] })
      queryClient.invalidateQueries({ queryKey: ['profile-followers', participant.userId] })
    } catch (e: any) {
      // Revert on error
      setLocalCounts(c => c ? {
        ...c,
        isFollowing: wasFollowing,
        followers: wasFollowing ? c.followers + 1 : c.followers - 1,
      } : c)
      toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
    } finally {
      setFollowLoading(false)
    }
  }, [participant, localCounts, queryClient, toast])

  // ── Friend actions ────────────────────────────────────────────────────────
  const handleFriend = useCallback(async () => {
    if (!participant || !localCounts) return
    const status = localCounts.friendStatus

    setFriendLoading(true)
    try {
      if (status === 'none') {
        await socialApi.sendRequest(participant.userId)
        setLocalCounts(c => c ? { ...c, friendStatus: 'pending_sent' } : c)
        toast({ title: `🤝 Friend request sent to ${participant.firstName}` })
      } else if (status === 'pending_received') {
        await socialApi.acceptRequest(participant.userId)
        setLocalCounts(c => c ? {
          ...c,
          friendStatus: 'friends',
          friends: c.friends + 1,
          // accepting also auto-follows
          isFollowing: true,
          followers: c.isFollowing ? c.followers : c.followers + 1,
        } : c)
        toast({ title: `✅ You and ${participant.firstName} are now friends!` })
        queryClient.invalidateQueries({ queryKey: ['friends'] })
        queryClient.invalidateQueries({ queryKey: ['friend-requests-incoming'] })
      } else if (status === 'friends') {
        await socialApi.removeFriend(participant.userId)
        setLocalCounts(c => c ? { ...c, friendStatus: 'none', friends: c.friends - 1 } : c)
        toast({ title: 'Friend removed' })
        queryClient.invalidateQueries({ queryKey: ['friends'] })
      }
      queryClient.invalidateQueries({ queryKey: ['social-counts', participant.userId] })
    } catch (e: any) {
      // Revert
      setLocalCounts(counts ?? null)
      toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
    } finally {
      setFriendLoading(false)
    }
  }, [participant, localCounts, counts, queryClient, toast])

  // ── Moderator action wrapper (closes sheet + shows toast) ────────────────
  const modAction = (fn?: () => void, label?: string) => () => {
    fn?.()
    if (label) toast({ title: label })
    onClose()
  }

  if (!participant) return null

  const roleMeta  = ROLE_META[participant.role] ?? ROLE_META.AUDIENCE
  const src       = getAvatarUrl(participant.avatarUrl)
  const initials  = `${participant.firstName[0] ?? ''}${participant.lastName[0] ?? ''}`.toUpperCase()
  const fullName  = `${participant.firstName} ${participant.lastName}`

  const canModerate = (myRole === 'HOST' || myRole === 'MODERATOR') && !isMe
  const isTargetHost = participant.role === 'HOST'
  const isTargetMod  = participant.role === 'MODERATOR'
  const amHost       = myRole === 'HOST'
  const isSpeaker    = participant.role === 'HOST' || participant.role === 'MODERATOR' || participant.role === 'SPEAKER'

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Ban confirmation dialog */}
          {participant && onBan && (
            <AlertDialog
              open={banDialogOpen}
              variant="danger"
              title="Ban Participant"
              message={`Ban ${participant.firstName} ${participant.lastName} from this room? They will not be able to rejoin.`}
              confirmLabel="Ban"
              onConfirm={() => { modAction(onBan, `⛔ ${participant.firstName} banned`)(); setBanDialogOpen(false) }}
              onCancel={() => setBanDialogOpen(false)}
            />
          )}
          {/* Backdrop */}
          <motion.div
            className="ups-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            className="ups-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          >
            {/* Drag handle */}
            <div className="ups-handle" />

            {/* Close button */}
            <button className="ups-close" onClick={onClose} aria-label="Close">
              <X className="w-4 h-4" />
            </button>

            {/* ── Profile header ── */}
            <div className="ups-header">
              {/* Avatar */}
              <div className="ups-avatar-wrap">
                <div className="ups-avatar">
                  {src
                    ? <img src={src} alt={fullName} className="ups-avatar-img" />
                    : <span className="ups-avatar-initials">{initials}</span>
                  }
                </div>
                {/* Speaking ring */}
                {isSpeaker && !participant.isMuted && (
                  <span className="ups-speaking-ring" />
                )}
                {/* Role badge */}
                <span
                  className="ups-role-badge"
                  style={{ background: roleMeta.color + '22', color: roleMeta.color, borderColor: roleMeta.color + '44' }}
                >
                  {roleMeta.icon} {roleMeta.label}
                </span>
              </div>

              {/* Name + mute state */}
              <div className="ups-name-block">
                <h2 className="ups-name">{fullName}</h2>
                {isMe && <span className="ups-you-badge">You</span>}
                {!isMe && participant.isMuted && isSpeaker && (
                  <span className="ups-muted-badge">🔇 Muted</span>
                )}
              </div>

              {/* Bio */}
              {bio && <p className="ups-bio">{bio}</p>}
            </div>

            {/* ── Social stats (not shown for self) ── */}
            {!isMe && (
              <div className="ups-stats">
                {countsLoading || !localCounts ? (
                  <>
                    <div className="ups-stat-skeleton" />
                    <div className="ups-stat-skeleton" />
                    <div className="ups-stat-skeleton" />
                  </>
                ) : (
                  <>
                    <div className="ups-stat">
                      <span className="ups-stat-value">{localCounts.followers.toLocaleString()}</span>
                      <span className="ups-stat-label">Followers</span>
                    </div>
                    <div className="ups-stat-divider" />
                    <div className="ups-stat">
                      <span className="ups-stat-value">{localCounts.following.toLocaleString()}</span>
                      <span className="ups-stat-label">Following</span>
                    </div>
                    <div className="ups-stat-divider" />
                    <div className="ups-stat">
                      <span className="ups-stat-value">{localCounts.friends.toLocaleString()}</span>
                      <span className="ups-stat-label">Friends</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Mutual friends hint */}
            {!isMe && localCounts && localCounts.mutualFriends > 0 && (
              <p className="ups-mutual">
                👥 {localCounts.mutualFriends} mutual friend{localCounts.mutualFriends !== 1 ? 's' : ''}
              </p>
            )}

            {/* ── Social actions (not shown for self) ── */}
            {!isMe && (
              <div className="ups-actions">
                {localCounts ? (
                  <>
                    <FollowButton
                      userId={participant.userId}
                      isFollowing={localCounts.isFollowing}
                      onToggle={handleFollow}
                      loading={followLoading}
                    />
                    <FriendButton
                      friendStatus={localCounts.friendStatus}
                      onAction={handleFriend}
                      loading={friendLoading}
                    />
                    {localCounts.friendStatus === 'friends' && (
                      <Link
                        href={`/dm?userId=${participant.userId}`}
                        className="ups-action-btn ups-action-btn--message"
                        onClick={onClose}
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        Message
                      </Link>
                    )}
                  </>
                ) : (
                  // Loading skeleton for action buttons
                  <div className="ups-actions-skeleton">
                    <div className="ups-btn-skeleton" />
                    <div className="ups-btn-skeleton" />
                  </div>
                )}
              </div>
            )}

            {/* ── View full profile link ── */}
            <Link
              href={`/social/profile/${participant.userId}`}
              className="ups-profile-link"
              onClick={onClose}
            >
              View full profile →
            </Link>

            {/* ── Moderator actions ── */}
            {canModerate && (
              <div className="ups-mod-section">
                <p className="ups-mod-title">Moderation</p>
                <div className="ups-mod-actions">
                  {/* Mute/Unmute — not for host */}
                  {!isTargetHost && onMute && (
                    <button className="ups-mod-btn" onClick={modAction(onMute,
                      participant.isMuted ? `🎙️ ${participant.firstName} unmuted` : `🔇 ${participant.firstName} muted`
                    )}>
                      {participant.isMuted ? '🎙️ Unmute' : '🔇 Mute'}
                    </button>
                  )}

                  {/* Demote — not for host, MOD can't demote MOD */}
                  {!isTargetHost && !(isTargetMod && !amHost) && onDemote && (
                    <button className="ups-mod-btn" onClick={modAction(onDemote, `⬇️ ${participant.firstName} moved to audience`)}>
                      ⬇️ To Audience
                    </button>
                  )}

                  {/* Make moderator — host only, not already mod/host */}
                  {amHost && !isTargetHost && !isTargetMod && onMakeMod && (
                    <button className="ups-mod-btn" onClick={modAction(onMakeMod, `🛡️ ${participant.firstName} is now a moderator`)}>
                      🛡️ Make Moderator
                    </button>
                  )}

                  {/* Remove moderator — host only */}
                  {amHost && isTargetMod && onRemoveMod && (
                    <button className="ups-mod-btn" onClick={modAction(onRemoveMod, `🛡️ ${participant.firstName} removed as moderator`)}>
                      🛡️ Remove Moderator
                    </button>
                  )}

                  {/* Transfer host — host only */}
                  {amHost && !isTargetHost && onTransfer && (
                    <button className="ups-mod-btn" onClick={modAction(onTransfer, `👑 Host transferred to ${participant.firstName}`)}>
                      👑 Transfer Host
                    </button>
                  )}

                  {/* Kick — not host, MOD can't kick MOD */}
                  {!isTargetHost && !(isTargetMod && !amHost) && onKick && (
                    <button className="ups-mod-btn danger" onClick={modAction(onKick, `🚫 ${participant.firstName} removed from room`)}>
                      🚫 Remove from Room
                    </button>
                  )}

                  {/* Ban — HOST/MOD only; not for HOST target; MOD can't ban MOD */}
                  {!isTargetHost && !(isTargetMod && !amHost) && onBan && (
                    <button
                      className="ups-mod-btn danger"
                      onClick={() => setBanDialogOpen(true)}
                    >
                      ⛔ Ban from Room
                    </button>
                  )}

                  {/* Unban — HOST/MOD only */}
                  {onUnban && (
                    <button className="ups-mod-btn" onClick={modAction(onUnban, `✅ ${participant.firstName} unbanned`)}>
                      ✅ Unban
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Pass mic for self (HOST/SPEAKER) — outside mod section */}
            {isMe && onPassMic && isSpeaker && (
              <div className="ups-mod-section">
                <div className="ups-mod-actions">
                  <button className="ups-mod-btn" onClick={modAction(onPassMic)}>
                    🎙️ Pass Mic to Someone
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
