'use client'

/**
 * SpeakingRing.tsx
 *
 * Animated speaking indicator ring rendered as an absolutely-positioned
 * circular border around a SeatCard.
 *
 * State machine (per design doc):
 *   IDLE ──→ SPEAKING ──→ IDLE
 *              │
 *              ↓
 *          PEAK (brief scale burst when audio peaks)
 *
 * Transitions:
 *   IDLE → SPEAKING : opacity 0→1 (200ms), scale 1→1.05 (spring)
 *   SPEAKING → IDLE : opacity 1→0 (300ms ease-out), scale 1.05→1
 *   PEAK            : scale 1.05→1.12→1.05 (100ms bounce)
 *
 * Requirements: 4.1, 4.2, 4.3, 4.5
 */

import React, { useEffect, useRef } from 'react'
import { animate, motion, useMotionValue, useSpring } from 'framer-motion'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SpeakingRingProps {
  /** Whether the participant is currently speaking. Controls IDLE↔SPEAKING transitions. */
  isSpeaking: boolean
  /**
   * Set to `true` briefly when audio peaks — triggers a scale burst (PEAK transition).
   * The parent should toggle this value back to `false` after a short interval
   * (e.g. 150ms) so the effect fires on the rising edge only.
   */
  onAudioPeak?: boolean
  /** Ring border color. Defaults to the design-system speaking green. */
  color?: string
  /**
   * Explicit diameter in pixels. When omitted the ring fills the parent via
   * `inset: -3px` (i.e. slightly outside a square/circular parent container).
   */
  size?: number
  className?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_COLOR = '#10b981'

// Spring config for the scale animations
const SPEAKING_SPRING = { type: 'spring' as const, stiffness: 300, damping: 20 }
const IDLE_SPRING = { type: 'spring' as const }

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SpeakingRing = React.memo(function SpeakingRing({
  isSpeaking,
  onAudioPeak = false,
  color = DEFAULT_COLOR,
  size,
  className,
}: SpeakingRingProps) {
  // -------------------------------------------------------------------------
  // Motion values
  // -------------------------------------------------------------------------

  // opacity is driven by a plain MotionValue so we can hand it smooth transitions
  const opacity = useMotionValue(0)

  // scale uses a spring so the bounce feel is natural
  const rawScale = useMotionValue(1)
  const scale = useSpring(rawScale, { stiffness: 300, damping: 20 })

  // Track the previous isSpeaking value to detect transitions
  const prevSpeakingRef = useRef<boolean>(false)

  // -------------------------------------------------------------------------
  // IDLE ↔ SPEAKING transitions
  // -------------------------------------------------------------------------

  useEffect(() => {
    const wasSpeeking = prevSpeakingRef.current
    prevSpeakingRef.current = isSpeaking

    if (isSpeaking && !wasSpeeking) {
      // IDLE → SPEAKING
      animate(opacity, 1, { duration: 0.2 })
      animate(rawScale, 1.05, SPEAKING_SPRING)
    } else if (!isSpeaking && wasSpeeking) {
      // SPEAKING → IDLE
      animate(opacity, 0, { duration: 0.3, ease: 'easeOut' })
      animate(rawScale, 1, IDLE_SPRING)
    }
  }, [isSpeaking, opacity, rawScale])

  // -------------------------------------------------------------------------
  // PEAK transition — fires on the rising edge of onAudioPeak
  // -------------------------------------------------------------------------

  const prevPeakRef = useRef<boolean>(false)

  useEffect(() => {
    const wasPeak = prevPeakRef.current
    prevPeakRef.current = onAudioPeak

    if (onAudioPeak && !wasPeak && isSpeaking) {
      // Scale burst: 1.05 → 1.12 → 1.05, each leg 50ms (total ~100ms)
      animate(rawScale, [1.05, 1.12, 1.05], {
        duration: 0.1,
        ease: 'easeInOut',
        times: [0, 0.5, 1],
      })
    }
  }, [onAudioPeak, isSpeaking, rawScale])

  // -------------------------------------------------------------------------
  // Sizing
  // -------------------------------------------------------------------------

  const sizeStyle: React.CSSProperties =
    size !== undefined
      ? { width: size, height: size }
      : { inset: -3 }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <motion.div
      aria-hidden="true"
      className={className}
      style={{
        // Positioning
        position: 'absolute',
        ...sizeStyle,
        // Shape
        borderRadius: '50%',
        border: `2px solid ${color}`,
        // Interaction
        pointerEvents: 'none',
        // Motion values
        opacity,
        scale,
      }}
    />
  )
})

SpeakingRing.displayName = 'SpeakingRing'
