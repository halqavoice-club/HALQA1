'use client'

/**
 * PKChallengeIncoming
 * ─────────────────────────────────────────────────────────────────────────────
 * Shows Accept / Decline UI inside the Voice Room when a PK challenge arrives.
 *
 * This component is mounted inside VoiceRoomView so it shares the same
 * already-connected socket. It subscribes to pk:invitation on the socket
 * that joined the voice room — the socket is guaranteed live at this point.
 *
 * It also shows for audience members (not just hosts) since anyone on stage
 * can be challenged.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getSocket } from '@/lib/socket'
import { getAvatarUrl } from '@/lib/avatar'
import api from '@/lib/api'
import { cn } from '@/lib/utils'

interface Invitation {
  id:              string
  senderId:        string
  durationSeconds: number
  expiresAt:       string
  message:         string | null
  sender?: {
    id:        string
    firstName: string
    lastName:  string
    avatarUrl: string | null
  }
}

interface Props {
  myUserId: string
}

export function PKChallengeIncoming({ myUserId }: Props) {
  const [invitation,  setInvitation]  = useState<Invitation | null>(null)
  const [accepting,   setAccepting]   = useState(false)
  const [rejecting,   setRejecting]   = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const initialRef  = useRef(300)
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null)

  const dismiss = useCallback(() => {
    setInvitation(null)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  // The Voice Room already has a live socket — subscribe directly
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    const handler = (data: { invitation: Invitation; sender: Invitation['sender'] }) => {
      const inv = { ...data.invitation, sender: data.sender }
      // The socket event is already routed to user:{myUserId} by the backend,
      // so no receiverId filter needed — every event here is for this user.
      setInvitation(inv)
      setAccepting(false)
      setRejecting(false)

      const expiresMs  = new Date(inv.expiresAt).getTime() - Date.now()
      const expirySecs = Math.max(30, Math.floor(expiresMs / 1000))
      initialRef.current = expirySecs
      setSecondsLeft(expirySecs)

      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        setSecondsLeft(s => {
          if (s <= 1) { clearInterval(timerRef.current!); timerRef.current = null; setInvitation(null); return 0 }
          return s - 1
        })
      }, 1000)
    }

    socket.on('pk:invitation', handler)

    // Dismiss if the sender cancels their own invitation before we respond
    const cancelHandler = (data: { invitationId: string }) => {
      setInvitation(inv => inv?.id === data.invitationId ? null : inv)
    }
    socket.on('pk:cancelled', cancelHandler)

    return () => {
      socket.off('pk:invitation', handler)
      socket.off('pk:cancelled', cancelHandler)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [myUserId])

  const handleAccept = useCallback(async () => {
    if (!invitation || accepting) return
    setAccepting(true)
    try {
      const res = await api.post(`/pk/invitations/${invitation.id}/accept`)
      // Stay in the voice room — the VoiceRoomPKBanner will appear automatically
      // when pk:room:started fires. Do NOT navigate away; the banner IS the in-room PK view.
      dismiss()
    } catch { dismiss() }
  }, [invitation, accepting, dismiss])

  const handleDecline = useCallback(async () => {
    if (!invitation || rejecting) return
    setRejecting(true)
    try { await api.post(`/pk/invitations/${invitation.id}/reject`) } catch {}
    dismiss()
  }, [invitation, rejecting, dismiss])

  const pctLeft = secondsLeft > 0 ? (secondsLeft / initialRef.current) * 100 : 0
  const senderName = invitation?.sender
    ? `${invitation.sender.firstName} ${invitation.sender.lastName}`
    : 'Someone'

  return (
    <AnimatePresence>
      {invitation && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1,   y: 0  }}
          exit={{    opacity: 0, scale: 0.9, y: 20  }}
          transition={{ type: 'spring', damping: 20, stiffness: 260 }}
          className="absolute bottom-24 left-4 right-4 z-50 rounded-2xl overflow-hidden shadow-2xl border border-white/10"
          style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)' }}
        >
          {/* Expiry drain bar */}
          <div className="h-1 w-full bg-white/10">
            <div
              className="h-full bg-indigo-400 transition-all duration-1000"
              style={{ width: `${pctLeft}%` }}
            />
          </div>

          <div className="p-3">
            <div className="flex items-center gap-2.5 mb-2.5">
              {/* Avatar */}
              <div className="relative shrink-0">
                {invitation.sender?.avatarUrl
                  ? <img src={getAvatarUrl(invitation.sender.avatarUrl)} className="w-10 h-10 rounded-full object-cover ring-2 ring-indigo-500" alt={senderName} />
                  : <div className="w-10 h-10 rounded-full bg-indigo-700 flex items-center justify-center text-white font-bold">{invitation.sender?.firstName?.[0] ?? '?'}</div>
                }
                <span className="absolute -bottom-1 -right-1 text-base leading-none">⚔️</span>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-bold truncate">{senderName}</p>
                <p className="text-indigo-300 text-xs">
                  challenges you! · {Math.floor(invitation.durationSeconds / 60)}m · {secondsLeft}s left
                </p>
              </div>

              <button onClick={dismiss} className="text-white/30 hover:text-white/60 text-lg leading-none">✕</button>
            </div>

            {invitation.message && (
              <p className="text-white/50 text-xs italic mb-2.5 line-clamp-1">"{invitation.message}"</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleDecline}
                disabled={rejecting || accepting}
                className={cn(
                  'flex-1 py-2 rounded-xl text-xs font-semibold border border-white/15 bg-white/5 text-white/60',
                  'hover:bg-white/10 hover:text-white transition-all',
                  (rejecting || accepting) && 'opacity-40 cursor-not-allowed'
                )}
              >
                {rejecting ? '…' : '✕ Decline'}
              </button>
              <button
                onClick={handleAccept}
                disabled={accepting || rejecting}
                className={cn(
                  'flex-1 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all',
                  (accepting || rejecting) && 'opacity-40 cursor-not-allowed'
                )}
              >
                {accepting ? '⏳ Joining…' : '⚔️ Accept'}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
