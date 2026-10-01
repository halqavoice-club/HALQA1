'use client'

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useVoiceStore } from '@/store/voice.store'
import { useAuthStore } from '@/store/auth.store'
import { getAvatarUrl } from '@/lib/avatar'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────
interface QueueUser {
  userId: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  raisedAt: string
}

// ─── UserRow ──────────────────────────────────────────────────────────────────
function UserRow({
  user,
  position,
  isMe,
}: {
  user: QueueUser
  position: number
  isMe: boolean
}) {
  const rowRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to own row when modal opens
  useEffect(() => {
    if (isMe && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [isMe])

  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase()
  const src = getAvatarUrl(user.avatarUrl)
  const fullName = `${user.firstName} ${user.lastName}`

  return (
    <div
      ref={rowRef}
      className={cn('wl-row', isMe && 'wl-row--me')}
    >
      {/* Position number */}
      <span className="wl-position">{position}</span>

      {/* Avatar */}
      <div className="wl-avatar">
        {src
          ? <img src={src} alt={fullName} />
          : <span className="wl-avatar-initials">{initials}</span>
        }
      </div>

      {/* Name + icon */}
      <div className="wl-user-info">
        <span className="wl-username">
          {isMe ? `${user.firstName} (You)` : fullName}
        </span>
        <span className="wl-user-icon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
          </svg>
          Member
        </span>
      </div>

      {/* "You" badge */}
      {isMe && <span className="wl-me-badge">You</span>}
    </div>
  )
}

// ─── WaitingListModal ─────────────────────────────────────────────────────────
interface Props {
  roomId: string
  onRaiseHand: () => void
  onCancelHand: () => void
  isInQueue: boolean
  isLoading?: boolean
}

export function WaitingListModal({
  roomId,
  onRaiseHand,
  onCancelHand,
  isInQueue,
  isLoading = false,
}: Props) {
  const { user } = useAuthStore()
  const { speakerQueue, isWaitingListOpen, toggleWaitingList, activeRoom } = useVoiceStore()
  const isOpenMic = activeRoom?.isOpenMic ?? false
  // Stage is full when all maxSpeakers seats are occupied
  const speakers = activeRoom?.participants.filter(p => p.isActive && p.seatNumber != null) ?? []
  const stageFull = speakers.length >= (activeRoom?.maxSpeakers ?? 12)

  const myPosition = isInQueue
    ? speakerQueue.findIndex(u => u.userId === user?.id) + 1
    : 0

  const totalCount = speakerQueue.length

  const handleAction = () => {
    if (isInQueue) {
      onCancelHand()
    } else {
      onRaiseHand()
    }
  }

  return (
    <AnimatePresence>
      {isWaitingListOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="wl-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={toggleWaitingList}
          />

          {/* Bottom sheet */}
          <motion.div
            className="wl-sheet"
            initial={{ y: '100%', x: 0 }}
            animate={{ y: 0, x: 0 }}
            exit={{ y: '100%', x: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              width: '100%',
              maxWidth: 'none',
            }}
          >
            {/* Drag handle */}
            <div className="wl-handle" />

            {/* Header */}
            <div className="wl-header">
              <div className="wl-header-left">
                <h2 className="wl-title">
                  {isOpenMic && !stageFull ? 'Take Seat' : 'Waiting Queue'}
                </h2>
                <span className="wl-subtitle">
                  {totalCount} Member{totalCount !== 1 ? 's' : ''}
                </span>
              </div>
              <button
                className="wl-close"
                onClick={toggleWaitingList}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* My position hint */}
            {isInQueue && myPosition > 0 && (
              <motion.div
                className="wl-my-position"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <span className="wl-position-dot" />
                You are <strong>#{myPosition}</strong> in the queue
              </motion.div>
            )}

            {/* Queue list */}
            <div className="wl-list">
              {speakerQueue.length === 0 ? (
                <div className="wl-empty">
                  <span className="wl-empty-icon">✋</span>
                  <p className="wl-empty-text">No one is waiting yet</p>
                  <p className="wl-empty-sub">
                    {isOpenMic && !stageFull
                      ? 'Tap "Take Mic" to join the stage directly'
                      : isOpenMic
                        ? 'Stage is full — be the first to queue for the next seat'
                        : 'Be the first to raise your hand'}
                  </p>
                </div>
              ) : (
                speakerQueue.map((u, i) => (
                  <UserRow
                    key={u.userId}
                    user={u}
                    position={i + 1}
                    isMe={u.userId === user?.id}
                  />
                ))
              )}
            </div>

            {/* Action button */}
            <div className="wl-footer">
              <button
                className={cn('wl-action-btn', isInQueue && 'wl-action-btn--cancel')}
                onClick={handleAction}
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="wl-btn-spinner" />
                ) : isInQueue ? (
                  '✕  Cancel waiting'
                ) : isOpenMic && stageFull ? (
                  '✋  Join Queue'
                ) : isOpenMic ? (
                  '🎙️  Take Mic'
                ) : (
                  '✋  Raise Hand'
                )}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
