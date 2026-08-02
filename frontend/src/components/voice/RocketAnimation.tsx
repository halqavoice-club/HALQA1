'use client'

/**
 * RocketAnimation
 * ─────────────────────────────────────────────────────────────────────────────
 * Two versions of the rocket launch animation — no external files required.
 * All motion is pure Framer Motion + CSS.
 *
 * VERSION 1 — rocket_launch (mid-tier, combo-enabled)
 *   Timeline:
 *     0–300ms   → ignition flash + engine glow
 *     300–1000ms → lift-off (slow → fast easing)
 *     1–4s      → trail + fade
 *   Combo upgrades:
 *     ×3  → bigger flame + screen shake
 *     ×5  → dual exhaust trails
 *     ×10 → starburst on exit
 *
 * VERSION 2 — rocket_cinematic (premium, no combo)
 *   Timeline:
 *     0–2s  → launch pad: rocket standing still, smoke builds
 *     2–3s  → ignition: bright flame burst + screen glow + shake
 *     3–6s  → liftoff: rocket accelerates upward, long flame trail
 *     6–8s  → exit + starburst energy wave
 */

import { motion } from 'framer-motion'
import { getAvatarUrl } from '@/lib/avatar'
import { GiftEvent } from '@/store/voice.store'

// ─── Particle helpers ─────────────────────────────────────────────────────────
function StarburstParticle({ i, total, color }: { i: number; total: number; color: string }) {
  const angle  = (i / total) * 360
  const dist   = 60 + Math.random() * 80
  const rad    = (angle * Math.PI) / 180
  const tx     = Math.cos(rad) * dist
  const ty     = Math.sin(rad) * dist
  const delay  = i * 0.02
  return (
    <motion.div
      style={{
        position: 'absolute', top: '50%', left: '50%',
        width: 6, height: 6, borderRadius: '50%',
        background: color, marginTop: -3, marginLeft: -3,
      }}
      initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
      animate={{ x: tx, y: ty, opacity: 0, scale: 0 }}
      transition={{ duration: 1.0, delay, ease: 'easeOut' }}
    />
  )
}

function SmokeParticle({ i }: { i: number }) {
  const x = (i - 2) * 12
  return (
    <motion.div
      className="rocket-smoke-particle"
      style={{ left: `calc(50% + ${x}px)` }}
      initial={{ opacity: 0, y: 0, scale: 0.3 }}
      animate={{ opacity: [0, 0.5, 0.3, 0], y: [-10, -30, -50], scale: [0.3, 1.2, 1.8] }}
      transition={{ duration: 1.5, delay: i * 0.15, ease: 'easeOut', repeat: Infinity, repeatDelay: 0.5 }}
    />
  )
}

// ─── VERSION 1: rocket_launch ─────────────────────────────────────────────────
export function RocketLaunchAnimation({ event }: { event: GiftEvent }) {
  const combo      = event.combo
  const isBig      = combo >= 3
  const isDual     = combo >= 5
  const isBurst    = combo >= 10
  const senderName = `${event.sender.firstName} ${event.sender.lastName}`
  const senderAvatar = getAvatarUrl(event.sender.avatarUrl)

  // Shake intensity scales with combo
  const shakeX = isBig ? [0, -4, 4, -3, 3, -1, 1, 0] : [0, -2, 2, -1, 1, 0]
  const shakeY = isBig ? [0, 2, -2, 1, -1, 0] : [0, 1, -1, 0]

  return (
    <div className="rocket-launch-wrap">
      {/* Screen shake on ignition */}
      <motion.div
        className="rocket-launch-scene"
        animate={{ x: shakeX, y: shakeY }}
        transition={{ duration: 0.4, delay: 0.25, ease: 'easeInOut' }}
      >
        {/* Ignition flash */}
        <motion.div
          className="rocket-ignition-flash"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: [0, 0.9, 0], scale: [0.5, 1.8, 0.3] }}
          transition={{ duration: 0.35, delay: 0.1 }}
        />

        {/* Engine glow */}
        <motion.div
          className="rocket-engine-glow"
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: [0, 1, 0.6, 0], scale: [0, 1.4, 1, 0] }}
          transition={{ duration: 1.2, delay: 0.1 }}
        />

        {/* Main rocket */}
        <motion.div
          className="rocket-body"
          style={{ fontSize: isBig ? 52 : 40 }}
          initial={{ y: 0, scale: 0.6, opacity: 0 }}
          animate={{
            y:       [0, 0, -20, -80, -200, -500],
            scale:   [0.6, 1.0, 1.0, 1.05, 1.1, 0.8],
            opacity: [0, 1, 1, 1, 0.8, 0],
          }}
          transition={{
            duration: 3.5,
            times:    [0, 0.08, 0.15, 0.3, 0.6, 1],
            ease:     'easeIn',
          }}
        >
          🚀
        </motion.div>

        {/* Primary exhaust trail */}
        <motion.div
          className="rocket-trail"
          initial={{ scaleY: 0, opacity: 0 }}
          animate={{ scaleY: [0, 0.3, 1, 1.5, 0], opacity: [0, 0.8, 1, 0.6, 0] }}
          transition={{ duration: 3.2, delay: 0.3, ease: 'easeIn' }}
        />

        {/* Dual exhaust (combo ×5+) */}
        {isDual && (
          <>
            <motion.div
              className="rocket-trail rocket-trail-left"
              initial={{ scaleY: 0, opacity: 0 }}
              animate={{ scaleY: [0, 0.2, 0.8, 1.2, 0], opacity: [0, 0.6, 0.8, 0.4, 0] }}
              transition={{ duration: 3.0, delay: 0.4, ease: 'easeIn' }}
            />
            <motion.div
              className="rocket-trail rocket-trail-right"
              initial={{ scaleY: 0, opacity: 0 }}
              animate={{ scaleY: [0, 0.2, 0.8, 1.2, 0], opacity: [0, 0.6, 0.8, 0.4, 0] }}
              transition={{ duration: 3.0, delay: 0.45, ease: 'easeIn' }}
            />
          </>
        )}

        {/* Starburst on exit (combo ×10+) */}
        {isBurst && (
          <motion.div
            className="rocket-starburst"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 0.8, delay: 2.8 }}
          >
            {Array.from({ length: 16 }, (_, i) => (
              <StarburstParticle key={i} i={i} total={16} color={i % 2 === 0 ? '#fbbf24' : '#f97316'} />
            ))}
          </motion.div>
        )}
      </motion.div>

      {/* Sender info */}
      <motion.div
        className="rocket-launch-label"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ duration: 3.5, delay: 0.2 }}
      >
        <div className="rocket-label-avatar">
          {senderAvatar
            ? <img src={senderAvatar} alt={senderName} />
            : <span>{event.sender.firstName[0]}</span>
          }
        </div>
        <div className="rocket-label-text">
          <span className="rocket-label-sender">{senderName}</span>
          <span className="rocket-label-action"> launched </span>
          <span className="rocket-label-name">🚀 Rocket</span>
          {combo > 1 && <span className="rocket-label-combo"> ×{combo}{isBig ? ' 🔥' : ''}</span>}
        </div>
      </motion.div>
    </div>
  )
}

// ─── VERSION 2: rocket_cinematic ─────────────────────────────────────────────
export function RocketCinematicAnimation({ event }: { event: GiftEvent }) {
  const senderName   = `${event.sender.firstName} ${event.sender.lastName}`
  const receiverName = event.receiver
    ? `${event.receiver.firstName} ${event.receiver.lastName}`
    : ''
  const senderAvatar = getAvatarUrl(event.sender.avatarUrl)

  return (
    <div className="rocket-cinematic-wrap">
      {/* Dark cinematic background */}
      <motion.div
        className="rocket-cinematic-bg"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.6 }}
      />

      {/* Stars field */}
      <div className="rocket-stars">
        {Array.from({ length: 30 }, (_, i) => (
          <motion.div
            key={i}
            className="rocket-star"
            style={{
              left:  `${Math.random() * 100}%`,
              top:   `${Math.random() * 100}%`,
              width:  Math.random() * 3 + 1,
              height: Math.random() * 3 + 1,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0.5, 1] }}
            transition={{ duration: 1.5, delay: 0.5 + i * 0.05, repeat: Infinity, repeatType: 'reverse' }}
          />
        ))}
      </div>

      {/* Launch pad */}
      <motion.div
        className="rocket-pad"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <div className="rocket-pad-base" />
        <div className="rocket-pad-arms">
          <div className="rocket-pad-arm left" />
          <div className="rocket-pad-arm right" />
        </div>
      </motion.div>

      {/* Pre-launch smoke (0–2s) */}
      <div className="rocket-prelaunch-smoke">
        {Array.from({ length: 5 }, (_, i) => <SmokeParticle key={i} i={i} />)}
      </div>

      {/* Ignition flash (2–3s) */}
      <motion.div
        className="rocket-cinematic-flash"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0, 0, 1, 0.5, 0] }}
        transition={{ duration: 1.0, delay: 2.0, times: [0, 0.5, 0.7, 0.8, 0.9, 1] }}
      />

      {/* Screen glow (2–3s) */}
      <motion.div
        className="rocket-cinematic-glow"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0, 0.6, 0.3, 0] }}
        transition={{ duration: 2.0, delay: 2.0 }}
      />

      {/* Main rocket body */}
      <motion.div
        className="rocket-cinematic-body"
        initial={{ y: 0, scale: 1, opacity: 0 }}
        animate={{
          y:       [0, 0, 0, 0, -10, -40, -120, -300, -700],
          scale:   [1, 1, 1, 1, 1.05, 1.1, 1.15, 1.0, 0.6],
          opacity: [0, 1, 1, 1, 1, 1, 1, 0.8, 0],
          rotate:  [0, 0, 0, 0, 0, -1, -2, -3, -5],
        }}
        transition={{
          duration: 7.5,
          times:    [0, 0.05, 0.2, 0.27, 0.32, 0.42, 0.55, 0.75, 1],
          ease:     'easeIn',
        }}
      >
        🚀
      </motion.div>

      {/* Long flame trail (3–6s) */}
      <motion.div
        className="rocket-cinematic-trail"
        initial={{ scaleY: 0, opacity: 0 }}
        animate={{
          scaleY:  [0, 0, 0, 0.5, 1.5, 3, 4, 2, 0],
          opacity: [0, 0, 0, 0.9, 1, 0.9, 0.7, 0.3, 0],
        }}
        transition={{
          duration: 7.5,
          times:    [0, 0.2, 0.3, 0.38, 0.5, 0.65, 0.75, 0.88, 1],
          ease:     'easeIn',
        }}
      />

      {/* Flame core (brighter inner trail) */}
      <motion.div
        className="rocket-cinematic-flame-core"
        initial={{ scaleY: 0, opacity: 0 }}
        animate={{
          scaleY:  [0, 0, 0, 0.3, 1, 2, 2.5, 1, 0],
          opacity: [0, 0, 0, 1, 1, 0.8, 0.5, 0.2, 0],
        }}
        transition={{
          duration: 7.5,
          times:    [0, 0.2, 0.3, 0.38, 0.5, 0.65, 0.75, 0.88, 1],
          ease:     'easeIn',
        }}
      />

      {/* Exit starburst (6–8s) */}
      <motion.div
        className="rocket-cinematic-burst"
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: [0, 0, 0, 0, 0, 0, 0, 1, 0], scale: [0, 0, 0, 0, 0, 0, 0, 1.5, 3] }}
        transition={{ duration: 7.5, times: [0, 0.1, 0.2, 0.3, 0.5, 0.65, 0.75, 0.88, 1] }}
      >
        {Array.from({ length: 24 }, (_, i) => (
          <StarburstParticle
            key={i} i={i} total={24}
            color={['#fbbf24', '#f97316', '#ef4444', '#a78bfa', '#60a5fa'][i % 5]}
          />
        ))}
        <motion.div
          className="rocket-burst-ring"
          initial={{ scale: 0, opacity: 1 }}
          animate={{ scale: 4, opacity: 0 }}
          transition={{ duration: 1.0, delay: 6.8 }}
        />
      </motion.div>

      {/* Sender + receiver display */}
      <motion.div
        className="rocket-cinematic-info"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: [0, 0, 1, 1, 1, 0] }}
        transition={{ duration: 7.5, times: [0, 0.1, 0.2, 0.6, 0.85, 1] }}
      >
        <div className="rocket-cinematic-sender-row">
          <div className="rocket-cinematic-avatar">
            {senderAvatar
              ? <img src={senderAvatar} alt={senderName} />
              : <span>{event.sender.firstName[0]}</span>
            }
          </div>
          <div className="rocket-cinematic-names">
            <span className="rocket-cinematic-sender">{senderName}</span>
            <span className="rocket-cinematic-action"> launched </span>
            <span className="rocket-cinematic-gift">🚀 Rocket Pro</span>
            {receiverName && (
              <>
                <span className="rocket-cinematic-action"> for </span>
                <span className="rocket-cinematic-receiver">{receiverName}</span>
              </>
            )}
          </div>
        </div>
        <div className="rocket-cinematic-value">🪙 2,000 coins</div>
      </motion.div>
    </div>
  )
}
