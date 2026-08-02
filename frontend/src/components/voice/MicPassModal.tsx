'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useVoiceStore } from '@/store/voice.store'
import { getAvatarUrl } from '@/lib/avatar'
import api from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'

export function MicPassModal({ roomId }: { roomId: string }) {
  const { pendingMicOffer, clearPendingMicOffer } = useVoiceStore()
  const { toast } = useToast()
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    if (!pendingMicOffer) return
    const elapsed = Math.floor((Date.now() - pendingMicOffer.receivedAt) / 1000)
    const remaining = Math.max(0, pendingMicOffer.expiresIn - elapsed)
    setSecondsLeft(remaining)
    if (remaining === 0) { clearPendingMicOffer(); return }
    const interval = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) { clearInterval(interval); clearPendingMicOffer(); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [pendingMicOffer?.offerId]) // eslint-disable-line

  const handleAccept = useCallback(async () => {
    if (!pendingMicOffer) return
    setAccepting(true)
    try {
      await api.post('/voice/' + roomId + '/mic-pass/' + pendingMicOffer.offerId + '/accept')
      clearPendingMicOffer()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to accept mic', variant: 'destructive' })
      clearPendingMicOffer()
    } finally { setAccepting(false) }
  }, [pendingMicOffer, roomId]) // eslint-disable-line

  const handleDecline = useCallback(async () => {
    if (!pendingMicOffer) return
    try { await api.post('/voice/' + roomId + '/mic-pass/' + pendingMicOffer.offerId + '/decline') } catch {}
    clearPendingMicOffer()
  }, [pendingMicOffer, roomId]) // eslint-disable-line

  const progress = pendingMicOffer ? (secondsLeft / pendingMicOffer.expiresIn) * 100 : 0
  const urgentColor = secondsLeft <= 10 ? '#ef4444' : secondsLeft <= 20 ? '#f59e0b' : '#6366f1'
  const PI28 = 2 * Math.PI * 28

  return (
    <AnimatePresence>
      {pendingMicOffer && (
        <motion.div className="mic-pass-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            className="mic-pass-card"
            initial={{ scale: 0.8, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, y: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 300 }}
          >
            <div className="mic-pass-icon">
              <motion.span animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1.2 }}
                style={{ fontSize: 40, display: 'block' }}>
                {String.fromCodePoint(0x1F3A4)}
              </motion.span>
            </div>

            <div className="mic-pass-passer">
              <div className="mic-pass-avatar">
                {pendingMicOffer.passerAvatar
                  ? <img src={getAvatarUrl(pendingMicOffer.passerAvatar)} alt="" />
                  : <span>{pendingMicOffer.passerName[0]}</span>}
              </div>
              <div className="mic-pass-text">
                <p className="mic-pass-title">
                  <strong>{pendingMicOffer.passerName}</strong> is passing the mic to you!
                </p>
                <p className="mic-pass-sub">
                  {pendingMicOffer.passerRole === 'HOST' ? 'Host' :
                   pendingMicOffer.passerRole === 'MODERATOR' ? 'Moderator' : 'Speaker'}
                </p>
              </div>
            </div>

            <div className="mic-pass-countdown">
              <svg width="64" height="64" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="28" fill="none" stroke="#e5e7eb" strokeWidth="4" />
                <circle cx="32" cy="32" r="28" fill="none" stroke={urgentColor} strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={String(PI28)}
                  strokeDashoffset={String(PI28 * (1 - progress / 100))}
                  transform="rotate(-90 32 32)"
                  style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s' }}
                />
              </svg>
              <span className="mic-pass-seconds" style={{ color: urgentColor }}>{secondsLeft}</span>
            </div>

            <div className="mic-pass-actions">
              <button className="mic-pass-decline" onClick={handleDecline} disabled={accepting}>
                Decline
              </button>
              <button className="mic-pass-accept" onClick={handleAccept} disabled={accepting}>
                {accepting ? 'Accepting...' : 'Accept Mic'}
              </button>
            </div>

            {secondsLeft <= 10 && (
              <motion.p className="mic-pass-urgent" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                style={{ color: urgentColor }}>
                Offer expires soon!
              </motion.p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
