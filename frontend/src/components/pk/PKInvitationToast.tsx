'use client'

/**
 * PKInvitationToast
 * ─────────────────────────────────────────────────────────────────────────────
 * Global overlay that shows an incoming PK challenge on any page.
 *
 * HOW IT RECEIVES THE INVITATION
 * ─────────────────────────────────────────────────────────────────────────────
 * We do NOT subscribe to Socket.IO directly here because the socket may not
 * be initialised when this component mounts (it renders in layout.tsx before
 * the socket handshake completes).
 *
 * Instead, useRealtimeNotifications.ts — which already runs inside the layout
 * after auth+socket are confirmed ready — listens for `pk:invitation` and
 * fires a window CustomEvent `pk:invitation:received`. This component listens
 * for that safe DOM event and shows the Accept / Decline UI.
 *
 * EXPIRY COUNTDOWN
 * The invitation expires in 5 min on the backend. We show a local countdown
 * so the receiver always knows how much time remains.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { getAvatarUrl } from '@/lib/avatar'
import api from '@/lib/api'
import { cn } from '@/lib/utils'

interface PKInvitation {
  id:              string
  senderId:        string
  type:            string
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

export function PKInvitationToast() {
  const router = useRouter()
  const [invitation,  setInvitation]  = useState<PKInvitation | null>(null)
  const [accepting,   setAccepting]   = useState(false)
  const [rejecting,   setRejecting]   = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const initialSecs = useRef(300)

  const dismiss = useCallback(() => {
    setInvitation(null)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  // Listen for the safe DOM event fired by useRealtimeNotifications
  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail as { invitation: PKInvitation; sender: PKInvitation['sender'] }
      if (!data?.invitation) return

      const inv = { ...data.invitation, sender: data.sender }
      setInvitation(inv)
      setAccepting(false)
      setRejecting(false)

      // Calculate seconds until expiry
      const expiresMs  = new Date(inv.expiresAt).getTime() - Date.now()
      const expirySecs = Math.max(0, Math.floor(expiresMs / 1000))
      initialSecs.current = expirySecs || 300
      setSecondsLeft(expirySecs || 300)

      // Start countdown
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        setSecondsLeft(s => {
          if (s <= 1) {
            clearInterval(timerRef.current!)
            timerRef.current = null
            setInvitation(null)
            return 0
          }
          return s - 1
        })
      }, 1000)
    }

    window.addEventListener('pk:invitation:received', handler)
    return () => {
      window.removeEventListener('pk:invitation:received', handler)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const handleAccept = useCallback(async () => {
    if (!invitation || accepting) return
    setAccepting(true)
    try {
      const res = await api.post(`/pk/invitations/${invitation.id}/accept`)
      const pkMatchId = res.data.data?.match?.id
      dismiss()
      // If the user is currently inside a Voice Club room, stay there —
      // the VoiceRoomPKBanner will appear automatically via pk:room:started.
      // Only navigate to the full PK page if they are NOT in a voice room.
      const isInVoiceRoom = window.location.pathname.startsWith('/voice-club/')
      if (pkMatchId && !isInVoiceRoom) {
        router.push(`/voice-club/pk/${pkMatchId}`)
      }
    } catch {
      dismiss()
    }
  }, [invitation, accepting, dismiss, router])

  const handleDecline = useCallback(async () => {
    if (!invitation || rejecting) return
    setRejecting(true)
    try {
      await api.post(`/pk/invitations/${invitation.id}/reject`)
    } catch {}
    dismiss()
  }, [invitation, rejecting, dismiss])

  const senderName = invitation?.sender
    ? `${invitation.sender.firstName} ${invitation.sender.lastName}`
    : 'Someone'

  const durationLabel = invitation
    ? `${Math.floor(invitation.durationSeconds / 60)} min battle`
    : ''

  const pctLeft = secondsLeft > 0
    ? (secondsLeft / initialSecs.current) * 100
    : 0

  return (
    <AnimatePresence>
      {invitation && (
        <motion.div
          initial={{ opacity: 0, y: -80, scale: 0.95 }}
          animate={{ opacity: 1, y: 0,   scale: 1    }}
          exit={{    opacity: 0, y: -80, scale: 0.95 }}
          transition={{ type: 'spring', damping: 22, stiffness: 280 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] w-full max-w-sm px-4"
        >
          <div
            className="rounded-2xl overflow-hidden shadow-2xl border border-white/10"
            style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)' }}
          >
            {/* Expiry progress bar */}
            <div className="h-1 w-full bg-white/10">
              <div
                className="h-full bg-indigo-500 transition-all duration-1000"
                style={{ width: `${pctLeft}%` }}
              />
            </div>

            <div className="p-4">
              {/* Sender row */}
              <div className="flex items-center gap-3 mb-3">
                <div className="relative shrink-0">
                  {invitation.sender?.avatarUrl
                    ? <img
                        src={getAvatarUrl(invitation.sender.avatarUrl)}
                        className="w-12 h-12 rounded-full object-cover ring-2 ring-indigo-500"
                        alt={senderName}
                      />
                    : <div className="w-12 h-12 rounded-full bg-indigo-700 flex items-center justify-center text-white font-bold text-lg">
                        {invitation.sender?.firstName?.[0] ?? '?'}
                      </div>
                  }
                  <span className="absolute -bottom-1 -right-1 text-lg leading-none">⚔️</span>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold text-sm truncate">{senderName}</p>
                  <p className="text-indigo-300 text-xs font-semibold">challenges you to a PK battle!</p>
                  <p className="text-white/40 text-xs mt-0.5">
                    {durationLabel} · expires in {secondsLeft}s
                  </p>
                </div>

                <button
                  onClick={dismiss}
                  className="text-white/30 hover:text-white/60 text-xl leading-none self-start shrink-0"
                >✕</button>
              </div>

              {/* Optional challenger message */}
              {invitation.message && (
                <p className="text-white/50 text-xs italic mb-3 px-1 line-clamp-2">
                  "{invitation.message}"
                </p>
              )}

              {/* Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleDecline}
                  disabled={rejecting || accepting}
                  className={cn(
                    'flex-1 py-2.5 rounded-xl text-sm font-semibold border border-white/10 transition-all',
                    'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white',
                    (rejecting || accepting) && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  {rejecting ? '…' : '✕ Decline'}
                </button>
                <button
                  onClick={handleAccept}
                  disabled={accepting || rejecting}
                  className={cn(
                    'flex-1 py-2.5 rounded-xl text-sm font-bold transition-all',
                    'bg-indigo-600 hover:bg-indigo-500 text-white',
                    (accepting || rejecting) && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  {accepting ? '⏳ Joining…' : '⚔️ Accept'}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
