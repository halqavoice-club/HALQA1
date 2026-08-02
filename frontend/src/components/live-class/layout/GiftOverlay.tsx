'use client'

/**
 * GiftOverlay.tsx
 *
 * Floating gift burst animation overlay shown above the host seat.
 * Uses Framer Motion AnimatePresence for mount/unmount transitions.
 *
 * Requirement: 2.6 — Hidden in Minimal mode (showGifts === false)
 */

import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'

export interface GiftEvent {
  id: string
  emoji: string
  label?: string
}

export interface GiftOverlayProps {
  giftEvents: GiftEvent[]
  /** Set to false in Minimal mode to hide all gift animations */
  showGifts?: boolean
}

export function GiftOverlay({ giftEvents, showGifts = true }: GiftOverlayProps) {
  if (!showGifts) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
      aria-hidden="true"
    >
      <AnimatePresence>
        {giftEvents.map((gift) => (
          <motion.div
            key={gift.id}
            initial={{ opacity: 0, y: 0, scale: 0.5 }}
            animate={{ opacity: 1, y: -60, scale: 1.2 }}
            exit={{ opacity: 0, y: -120, scale: 0.8 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            style={{
              position: 'absolute',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <span style={{ fontSize: 32, lineHeight: 1 }}>{gift.emoji}</span>
            {gift.label && (
              <span style={{ fontSize: 11, color: '#e5e7eb', fontWeight: 600 }}>
                {gift.label}
              </span>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
