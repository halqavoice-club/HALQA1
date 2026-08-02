'use client'

/**
 * GiftLeaderboard
 * ─────────────────────────────────────────────────────────────────────────────
 * Two modes:
 *
 * compact (default) — fits in the header right section
 *   Shows top 3 avatar stack + 🏆 icon
 *   Tap to open a popover with the full ranked list
 *
 * full — standalone card (not used in header)
 */

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useVoiceStore } from '@/store/voice.store'
import { getAvatarUrl } from '@/lib/avatar'

const RANK_ICONS  = ['🥇', '🥈', '🥉']
const RANK_COLORS = ['#fbbf24', '#9ca3af', '#cd7f32']

// ─── Compact header widget ────────────────────────────────────────────────────
export function GiftLeaderboard() {
  const { giftLeaderboard } = useVoiceStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close popover on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Nothing to show
  if (giftLeaderboard.length === 0) return null

  const top3 = giftLeaderboard.slice(0, 3)

  return (
    <div className="gift-lb-compact" ref={ref}>
      {/* Trigger button — avatar stack + trophy */}
      <button
        className="gift-lb-trigger"
        onClick={() => setOpen(v => !v)}
        title="Top Supporters"
        aria-label="Top Supporters"
      >
        {/* Stacked avatars (up to 3) */}
        <div className="gift-lb-avatars">
          {top3.map((entry, i) => {
            const src = getAvatarUrl(entry.user.avatarUrl)
            return (
              <div
                key={entry.userId}
                className="gift-lb-avatar-chip"
                style={{ zIndex: 3 - i, marginLeft: i === 0 ? 0 : -8 }}
                title={`${entry.user.firstName} ${entry.user.lastName}`}
              >
                {src
                  ? <img src={src} alt={entry.user.firstName} />
                  : <span>{entry.user.firstName[0]}{entry.user.lastName[0]}</span>
                }
                {/* Gold ring on #1 */}
                {i === 0 && <div className="gift-lb-gold-ring" />}
              </div>
            )
          })}
        </div>
        <span className="gift-lb-trophy">🏆</span>
      </button>

      {/* Popover — full ranked list */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="gift-lb-popover"
            initial={{ opacity: 0, scale: 0.9, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -6 }}
            transition={{ type: 'spring', damping: 22, stiffness: 320 }}
          >
            <div className="gift-lb-popover-header">
              <span className="gift-lb-popover-title">🏆 Top Supporters</span>
              <button className="gift-lb-popover-close" onClick={() => setOpen(false)}>✕</button>
            </div>

            <div className="gift-lb-popover-list">
              {giftLeaderboard.slice(0, 5).map((entry, i) => {
                const src = getAvatarUrl(entry.user.avatarUrl)
                const rankIcon  = RANK_ICONS[i]  || `#${i + 1}`
                const rankColor = RANK_COLORS[i] || '#6b7280'
                return (
                  <motion.div
                    key={entry.userId}
                    className="gift-lb-popover-row"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <span className="gift-lb-popover-rank" style={{ color: rankColor }}>
                      {rankIcon}
                    </span>
                    <div className="gift-lb-popover-avatar">
                      {src
                        ? <img src={src} alt={entry.user.firstName} />
                        : <span>{entry.user.firstName[0]}{entry.user.lastName[0]}</span>
                      }
                    </div>
                    <div className="gift-lb-popover-info">
                      <span className="gift-lb-popover-name">
                        {entry.user.firstName} {entry.user.lastName}
                      </span>
                      <span className="gift-lb-popover-gifts">
                        {entry.giftCount} gift{entry.giftCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <span className="gift-lb-popover-coins">
                      🪙 {entry.totalCoins.toLocaleString()}
                    </span>
                  </motion.div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
