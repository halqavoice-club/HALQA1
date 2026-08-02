'use client'

/**
 * GiftOverlay
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders all non-premium gift animations in real-time.
 *
 * Animation types:
 *   bubble       → Coffee: small pop near bottom-left, steam effect
 *   avatar_effect → Romantic Love: floating hearts around receiver area
 *   racing       → Racing Car: zooms across screen with neon trail
 *   overlay      → Standard floating card (Fire, Star, etc.)
 *   banner       → Slide-in from right (Diamond, Crown)
 *   spotlight    → Glowing float card (Rocket)
 *   fullscreen   → Full room takeover (Galaxy, Trophy)
 *
 * Smart combo upgrades:
 *   Coffee  ×5  → bigger cup + steam cloud
 *   Coffee  ×10 → coffee rain (multiple cups)
 *   Love    ×3  → heart burst around receiver
 *   Love    ×10 → heart explosion 💖
 *   Racing  ×3  → speed boost (faster + trail)
 */

import { motion, AnimatePresence } from 'framer-motion'
import { useVoiceStore, GiftEvent } from '@/store/voice.store'
import { getAvatarUrl } from '@/lib/avatar'
import { cn } from '@/lib/utils'
import { RocketLaunchAnimation, RocketCinematicAnimation } from './RocketAnimation'

// ─── Rarity config ────────────────────────────────────────────────────────────
type RarityKey = 'common' | 'standard' | 'rare' | 'epic' | 'legendary'

const RARITY_CONFIG: Record<RarityKey, { scale: number[]; duration: number; color: string }> = {
  common:    { scale: [1, 1.2, 1],   duration: 0.4, color: '#9ca3af' },
  standard:  { scale: [1, 1.3, 1],   duration: 0.45, color: '#f472b6' },
  rare:      { scale: [1, 1.4, 1],   duration: 0.5, color: '#60a5fa' },
  epic:      { scale: [1, 1.6, 1.1], duration: 0.6, color: '#a78bfa' },
  legendary: { scale: [1, 2, 1.2],   duration: 0.8, color: '#fbbf24' },
}
const DEFAULT_CFG = RARITY_CONFIG.common
const getRarityCfg = (r: string) => RARITY_CONFIG[r as RarityKey] ?? DEFAULT_CFG

// ─── Combo badge ──────────────────────────────────────────────────────────────
function ComboBadge({ combo, color }: { combo: number; color?: string }) {
  if (combo < 5) return null
  const c = color ?? (combo >= 20 ? '#fbbf24' : combo >= 10 ? '#a78bfa' : '#60a5fa')
  return (
    <motion.div
      initial={{ scale: 0, rotate: -20 }}
      animate={{ scale: 1, rotate: 0 }}
      className="gift-combo-badge"
      style={{ color: c, borderColor: c }}
    >
      🔥 ×{combo}
    </motion.div>
  )
}

// ─── ☕ BUBBLE animation (Coffee) ─────────────────────────────────────────────
function BubbleAnimation({ event }: { event: GiftEvent }) {
  const combo      = event.combo
  const isBig      = combo >= 5   // bigger cup + steam
  const isRain     = combo >= 10  // coffee rain
  const senderName = event.sender.firstName

  // For rain: render multiple cups
  const cups = isRain
    ? Array.from({ length: Math.min(combo, 8) }, (_, i) => i)
    : [0]

  return (
    <div className="gift-bubble-wrap">
      {cups.map(i => (
        <motion.div
          key={i}
          className={cn('gift-bubble-cup', isBig && 'big', isRain && 'rain')}
          initial={{ opacity: 0, y: 20, scale: 0.5, x: isRain ? (i - cups.length / 2) * 28 : 0 }}
          animate={{ opacity: [0, 1, 1, 0], y: [20, 0, -20, -50], scale: isBig ? [0.5, 1.3, 1.1] : [0.5, 1, 0.9] }}
          transition={{ duration: isRain ? 1.8 : 1.4, delay: isRain ? i * 0.08 : 0, ease: 'easeOut' }}
        >
          ☕
          {/* Steam */}
          <motion.div
            className="gift-bubble-steam"
            initial={{ opacity: 0, y: 0 }}
            animate={{ opacity: [0, 0.7, 0], y: -16 }}
            transition={{ duration: 1, delay: 0.3 + (isRain ? i * 0.08 : 0) }}
          >
            ☁️
          </motion.div>
        </motion.div>
      ))}

      {/* Sender label */}
      <motion.div
        className="gift-bubble-label"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ duration: 1.6, delay: 0.1 }}
      >
        {senderName} ☕{combo > 1 ? ` ×${combo}` : ''}
      </motion.div>
    </div>
  )
}

// ─── ❤️ AVATAR_EFFECT animation (Romantic Love) ───────────────────────────────
function AvatarEffectAnimation({ event }: { event: GiftEvent }) {
  const combo       = event.combo
  const isBurst     = combo >= 3   // heart burst
  const isExplosion = combo >= 10  // heart explosion 💖
  const senderName  = event.sender.firstName
  const receiverName = event.receiver?.firstName ?? 'them'

  // Number of hearts scales with combo
  const heartCount = isExplosion ? 16 : isBurst ? 8 : 4
  const hearts = Array.from({ length: heartCount }, (_, i) => i)

  return (
    <div className="gift-love-wrap">
      {/* Floating hearts */}
      {hearts.map(i => {
        const angle  = (i / heartCount) * 360
        const radius = isExplosion ? 80 : isBurst ? 55 : 35
        const rad    = (angle * Math.PI) / 180
        const tx     = Math.cos(rad) * radius
        const ty     = Math.sin(rad) * radius
        const size   = isExplosion ? 22 : isBurst ? 18 : 14
        return (
          <motion.div
            key={i}
            className="gift-love-heart"
            style={{ fontSize: size }}
            initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
            animate={{ x: tx, y: ty, opacity: [0, 1, 1, 0], scale: [0, 1.2, 1, 0.8] }}
            transition={{ duration: isExplosion ? 1.8 : 1.4, delay: i * 0.04, ease: 'easeOut' }}
          >
            {isExplosion ? '💖' : '❤️'}
          </motion.div>
        )
      })}

      {/* Center pulse */}
      <motion.div
        className="gift-love-center"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.4, 1], opacity: [0, 1, 0.8] }}
        transition={{ duration: 0.6 }}
      >
        {isExplosion ? '💖' : '❤️'}
      </motion.div>

      {/* Info label */}
      <motion.div
        className="gift-love-label"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ duration: 2, delay: 0.3 }}
      >
        <span className="gift-love-sender">{senderName}</span>
        <span className="gift-love-action"> sent love to </span>
        <span className="gift-love-receiver">{receiverName}</span>
        {combo > 1 && <span className="gift-love-combo"> ×{combo}</span>}
      </motion.div>
    </div>
  )
}

// ─── 🏎️ RACING animation (Super Racing Car) ──────────────────────────────────
function RacingAnimation({ event }: { event: GiftEvent }) {
  const combo      = event.combo
  const isBoost    = combo >= 3   // speed boost + extra trail
  const senderName = event.sender.firstName

  // Speed: faster with combo
  const duration = isBoost ? Math.max(0.8, 1.6 - combo * 0.05) : 1.6

  return (
    <div className="gift-racing-wrap">
      {/* Neon trail */}
      <motion.div
        className={cn('gift-racing-trail', isBoost && 'boosted')}
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: 1, opacity: [0, 0.8, 0.4, 0] }}
        transition={{ duration: duration + 0.3, ease: 'easeOut' }}
      />

      {/* Car */}
      <motion.div
        className={cn('gift-racing-car', isBoost && 'boosted')}
        initial={{ x: '-120%' }}
        animate={{ x: '120vw' }}
        transition={{ duration, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        🏎️
        {/* Motion blur lines */}
        {isBoost && (
          <div className="gift-racing-blur">
            {[0, 1, 2].map(i => (
              <motion.div
                key={i}
                className="gift-racing-blur-line"
                initial={{ opacity: 0, scaleX: 0 }}
                animate={{ opacity: [0, 0.6, 0], scaleX: [0, 1] }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
              />
            ))}
          </div>
        )}
      </motion.div>

      {/* Info banner */}
      <motion.div
        className="gift-racing-label"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ duration: duration + 0.4, delay: 0.2 }}
      >
        <span className="gift-racing-sender">{senderName}</span>
        <span className="gift-racing-action"> sent </span>
        <span className="gift-racing-name">🏎️ Racing Car</span>
        {combo > 1 && <span className="gift-racing-combo"> ×{combo}{isBoost ? ' 🚀' : ''}</span>}
      </motion.div>
    </div>
  )
}

// ─── All-stage banner ─────────────────────────────────────────────────────────
function AllStageBanner({ event }: { event: GiftEvent }) {
  const cfg        = getRarityCfg(event.gift.rarity)
  const senderName = `${event.sender.firstName} ${event.sender.lastName}`
  const senderAvatar = getAvatarUrl(event.sender.avatarUrl)
  return (
    <motion.div
      className="gift-banner gift-banner-all"
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '-100%', opacity: 0 }}
      transition={{ type: 'spring', damping: 20, stiffness: 250 }}
      style={{ borderColor: cfg.color }}
    >
      <div className="gift-banner-avatar">
        {senderAvatar
          ? <img src={senderAvatar} alt={senderName} />
          : <span>{event.sender.firstName[0]}</span>
        }
      </div>
      <div className="gift-banner-content">
        <span className="gift-banner-sender">{senderName}</span>
        <span className="gift-banner-action"> gifted </span>
        <motion.span className="gift-banner-emoji" animate={{ scale: cfg.scale }} transition={{ duration: cfg.duration }}>
          {event.gift.emoji}
        </motion.span>
        <span className="gift-banner-name" style={{ color: cfg.color }}>{event.gift.name}</span>
        <span className="gift-banner-action"> to </span>
        <span className="gift-all-badge">🎪 everyone</span>
      </div>
    </motion.div>
  )
}

// ─── Standard float card (overlay / spotlight) ────────────────────────────────
function FloatCard({ event }: { event: GiftEvent }) {
  const cfg          = getRarityCfg(event.gift.rarity)
  const isSpotlight  = event.gift.animationType === 'spotlight'
  const senderAvatar = getAvatarUrl(event.sender.avatarUrl)
  const senderName   = `${event.sender.firstName} ${event.sender.lastName}`
  return (
    <motion.div
      className={cn('gift-float-card', isSpotlight && 'gift-spotlight')}
      initial={{ opacity: 0, y: 20, scale: 0.8 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -30, scale: 0.7 }}
      transition={{ type: 'spring', damping: 18, stiffness: 280 }}
      style={isSpotlight ? { boxShadow: `0 0 40px ${cfg.color}60` } : undefined}
    >
      <div className="gift-float-avatar">
        {senderAvatar
          ? <img src={senderAvatar} alt={senderName} />
          : <span>{event.sender.firstName[0]}</span>
        }
      </div>
      <div className="gift-float-body">
        <span className="gift-float-sender">{event.sender.firstName}</span>
        <motion.span
          className="gift-float-emoji"
          animate={{ scale: cfg.scale, rotate: [0, -15, 15, 0] }}
          transition={{ duration: cfg.duration }}
        >
          {event.gift.emoji}
        </motion.span>
        {event.count > 1 && (
          <span className="gift-float-count" style={{ color: cfg.color }}>×{event.count}</span>
        )}
      </div>
      <ComboBadge combo={event.combo} />
    </motion.div>
  )
}

// ─── Banner card ──────────────────────────────────────────────────────────────
function BannerCard({ event }: { event: GiftEvent }) {
  const cfg          = getRarityCfg(event.gift.rarity)
  const senderAvatar = getAvatarUrl(event.sender.avatarUrl)
  const senderName   = `${event.sender.firstName} ${event.sender.lastName}`
  return (
    <motion.div
      className="gift-banner"
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '-100%', opacity: 0 }}
      transition={{ type: 'spring', damping: 20, stiffness: 250 }}
      style={{ borderColor: cfg.color }}
    >
      <div className="gift-banner-avatar">
        {senderAvatar
          ? <img src={senderAvatar} alt={senderName} />
          : <span>{event.sender.firstName[0]}</span>
        }
      </div>
      <div className="gift-banner-content">
        <span className="gift-banner-sender">{senderName}</span>
        <span className="gift-banner-action"> sent </span>
        <motion.span className="gift-banner-emoji" animate={{ scale: cfg.scale }} transition={{ duration: cfg.duration }}>
          {event.gift.emoji}
        </motion.span>
        <span className="gift-banner-name" style={{ color: cfg.color }}>{event.gift.name}</span>
        {event.count > 1 && <span className="gift-banner-count"> ×{event.count}</span>}
      </div>
      <ComboBadge combo={event.combo} />
    </motion.div>
  )
}

// ─── Fullscreen card ──────────────────────────────────────────────────────────
function FullscreenCard({ event }: { event: GiftEvent }) {
  const cfg          = getRarityCfg(event.gift.rarity)
  const senderName   = `${event.sender.firstName} ${event.sender.lastName}`
  const receiverName = event.receiver
    ? `${event.receiver.firstName} ${event.receiver.lastName}`
    : ''
  return (
    <motion.div
      className="gift-fullscreen-overlay"
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.5 }}
      transition={{ type: 'spring', damping: 15, stiffness: 200 }}
    >
      <motion.div
        className="gift-fullscreen-emoji"
        animate={{ scale: cfg.scale, rotate: [0, -10, 10, -5, 5, 0] }}
        transition={{ duration: cfg.duration, repeat: 2 }}
      >
        {event.gift.emoji}
      </motion.div>
      <div className="gift-fullscreen-text">
        <span className="gift-fullscreen-sender">{senderName}</span>
        <span className="gift-fullscreen-label"> sent </span>
        <span className="gift-fullscreen-name" style={{ color: cfg.color }}>{event.gift.name}</span>
        {receiverName && (
          <>
            <span className="gift-fullscreen-label"> to </span>
            <span className="gift-fullscreen-receiver">{receiverName}</span>
          </>
        )}
      </div>
      {event.count > 1 && <div className="gift-fullscreen-count">×{event.count}</div>}
      <ComboBadge combo={event.combo} />
    </motion.div>
  )
}

// ─── Router — picks the right animation for each event ───────────────────────
function GiftEventCard({ event }: { event: GiftEvent }) {
  const animType = event.gift.animationType

  if (event.isAllStage)               return <AllStageBanner event={event} />
  if (animType === 'bubble')          return <BubbleAnimation event={event} />
  if (animType === 'avatar_effect')   return <AvatarEffectAnimation event={event} />
  if (animType === 'racing')          return <RacingAnimation event={event} />
  if (animType === 'rocket_launch')   return <RocketLaunchAnimation event={event} />
  if (animType === 'rocket_cinematic') return <RocketCinematicAnimation event={event} />
  if (animType === 'fullscreen')      return <FullscreenCard event={event} />
  if (animType === 'banner')          return <BannerCard event={event} />
  return <FloatCard event={event} />   // overlay | spotlight | default
}

// ─── Main overlay ─────────────────────────────────────────────────────────────
export function GiftOverlay() {
  const { activeGiftEvents } = useVoiceStore()

  // Premium gifts → PremiumGiftOverlay handles them
  const normalEvents = activeGiftEvents.filter(e => !e.isPremium)

  // Separate by display layer
  const fullscreen = normalEvents.filter(e => e.gift.animationType === 'fullscreen').slice(-1)
  const racing     = normalEvents.filter(e => e.gift.animationType === 'racing')
  const rockets    = normalEvents.filter(e => e.gift.animationType === 'rocket_launch' || e.gift.animationType === 'rocket_cinematic')
  const banners    = normalEvents.filter(e => e.gift.animationType === 'banner' || e.isAllStage)
  const bubbles    = normalEvents.filter(e => e.gift.animationType === 'bubble')
  const love       = normalEvents.filter(e => e.gift.animationType === 'avatar_effect')
  const floats     = normalEvents.filter(e =>
    !['fullscreen', 'racing', 'banner', 'bubble', 'avatar_effect', 'rocket_launch', 'rocket_cinematic'].includes(e.gift.animationType) &&
    !e.isAllStage
  )

  return (
    <>
      {/* Layer 1: Fullscreen (highest, blocks view) */}
      <AnimatePresence>
        {fullscreen.map(e => <GiftEventCard key={e.id} event={e} />)}
      </AnimatePresence>

      {/* Layer 2: Rocket cinematic — full screen takeover */}
      <AnimatePresence>
        {rockets.filter(e => e.gift.animationType === 'rocket_cinematic').slice(-1).map(e => (
          <GiftEventCard key={e.id} event={e} />
        ))}
      </AnimatePresence>

      {/* Layer 3: Rocket launch — vertical sweep */}
      <div className="gift-rocket-layer" aria-hidden="true">
        <AnimatePresence>
          {rockets.filter(e => e.gift.animationType === 'rocket_launch').slice(-1).map(e => (
            <GiftEventCard key={e.id} event={e} />
          ))}
        </AnimatePresence>
      </div>

      {/* Layer 4: Racing — horizontal sweep */}
      <div className="gift-racing-layer" aria-hidden="true">
        <AnimatePresence>
          {racing.map(e => <GiftEventCard key={e.id} event={e} />)}
        </AnimatePresence>
      </div>

      {/* Layer 5: Banners — top-right slide-in */}
      <AnimatePresence>
        {banners.slice(-1).map(e => <GiftEventCard key={e.id} event={e} />)}
      </AnimatePresence>

      {/* Layer 6: Love / avatar effects — center */}
      <div className="gift-love-layer" aria-hidden="true">
        <AnimatePresence>
          {love.slice(-1).map(e => <GiftEventCard key={e.id} event={e} />)}
        </AnimatePresence>
      </div>

      {/* Layer 7: Bubbles — bottom-left stack */}
      <div className="gift-bubble-layer" aria-hidden="true">
        <AnimatePresence>
          {bubbles.slice(-3).map(e => <GiftEventCard key={e.id} event={e} />)}
        </AnimatePresence>
      </div>

      {/* Layer 8: Float cards — bottom-left stack */}
      <div className="gift-float-stack" aria-live="polite" aria-atomic="false">
        <AnimatePresence>
          {floats.map(e => <GiftEventCard key={e.id} event={e} />)}
        </AnimatePresence>
      </div>
    </>
  )
}
