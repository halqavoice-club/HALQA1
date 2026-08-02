'use client'

/**
 * PremiumGiftOverlay
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders high-priority gift animations that interrupt normal gift flow.
 *
 * Priority tiers:
 *   ultra  → Burj Khalifa (cinematic, 6s, full room takeover)
 *   high   → Lion (fullscreen, 4s), Horse (overlay sweep, 3s)
 *   normal → handled by GiftOverlay
 *
 * Rules:
 *   - Only ONE premium animation plays at a time
 *   - ultra always beats high (queued, not dropped)
 *   - Audio is NEVER interrupted — animations are visual-only overlays
 *   - All animations auto-dismiss; no user interaction required
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useVoiceStore, GiftEvent } from '@/store/voice.store'
import { getAvatarUrl } from '@/lib/avatar'

// ─── Particle helpers ─────────────────────────────────────────────────────────
function randomBetween(a: number, b: number) {
  return a + Math.random() * (b - a)
}

// ─── Firework particle ────────────────────────────────────────────────────────
function FireworkParticle({ delay, color }: { delay: number; color: string }) {
  const angle  = randomBetween(0, 360)
  const dist   = randomBetween(80, 200)
  const rad    = (angle * Math.PI) / 180
  const tx     = Math.cos(rad) * dist
  const ty     = Math.sin(rad) * dist

  return (
    <motion.div
      className="burj-particle"
      style={{ background: color }}
      initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
      animate={{ x: tx, y: ty, opacity: 0, scale: 0 }}
      transition={{ duration: 1.2, delay, ease: 'easeOut' }}
    />
  )
}

// ─── Fireworks burst ──────────────────────────────────────────────────────────
function FireworksBurst({ x, y, colors }: { x: number; y: number; colors: string[] }) {
  return (
    <div className="burj-burst" style={{ left: x, top: y }}>
      {Array.from({ length: 16 }).map((_, i) => (
        <FireworkParticle
          key={i}
          delay={i * 0.04}
          color={colors[i % colors.length]}
        />
      ))}
    </div>
  )
}

// ─── HORSE animation ──────────────────────────────────────────────────────────
function HorseAnimation({ event }: { event: GiftEvent }) {
  const senderName   = `${event.sender.firstName} ${event.sender.lastName}`
  const receiverName = event.receiver
    ? `${event.receiver.firstName} ${event.receiver.lastName}`
    : event.isAllStage ? 'everyone on stage' : ''

  return (
    <motion.div
      className="premium-horse-wrap"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Dust trail */}
      <motion.div
        className="horse-dust"
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: 1, opacity: [0, 0.6, 0] }}
        transition={{ duration: 1.5, delay: 0.3 }}
      />

      {/* Horse running across */}
      <motion.div
        className="horse-emoji"
        initial={{ x: '-120%', rotate: 0 }}
        animate={{ x: '120vw', rotate: [0, -5, 5, -3, 3, 0] }}
        transition={{ duration: 2.2, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        🐎
      </motion.div>

      {/* Info banner */}
      <motion.div
        className="premium-info-banner horse-banner"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ delay: 0.4, duration: 0.4 }}
      >
        <div className="premium-sender-avatar">
          {getAvatarUrl(event.sender.avatarUrl)
            ? <img src={getAvatarUrl(event.sender.avatarUrl)!} alt={senderName} />
            : <span>{event.sender.firstName[0]}</span>
          }
        </div>
        <div className="premium-info-text">
          <span className="premium-sender-name">{senderName}</span>
          <span className="premium-action"> sent </span>
          <span className="premium-gift-name horse-color">🐎 Horse</span>
          <span className="premium-action"> to </span>
          <span className="premium-receiver-name">{receiverName}</span>
        </div>
        {event.combo >= 5 && (
          <div className="premium-combo-badge horse-color">🔥 ×{event.combo}</div>
        )}
      </motion.div>
    </motion.div>
  )
}

// ─── LION animation — CINEMATIC (10s, 4 scenes) ──────────────────────────────
//
// Scene 1 (0–2s):   Dark arena fade-in, gold dust particles, low glow
// Scene 2 (2–5s):   Lion walks in from left, ground shadow, camera zoom
// Scene 3 (5–8s):   Lion stops center, head lift, ROAR, screen shake, gold burst
// Scene 4 (8–10s):  Lion fades to particles, gold crown appears on receiver
//
// Combo variants:
//   ×1   → standard gold royal style
//   ×2+  → bigger arena + louder shockwaves
//   ×5+  → "Royal Lion Mode" — purple highlights + dual crown
//
function LionAnimation({ event }: { event: GiftEvent }) {
  const senderName     = `${event.sender.firstName} ${event.sender.lastName}`
  const receiverName   = event.receiver
    ? `${event.receiver.firstName} ${event.receiver.lastName}`
    : event.isAllStage ? 'everyone on stage' : ''
  const receiverAvatar = getAvatarUrl(event.receiver?.avatarUrl ?? null)
  const senderAvatar   = getAvatarUrl(event.sender.avatarUrl)

  const combo    = event.combo ?? 1
  const isBig    = combo >= 2   // bigger arena + louder shockwaves
  const isRoyal  = combo >= 5   // Royal Lion Mode

  // Gold dust particle positions (pre-computed for determinism)
  const dustParticles = Array.from({ length: 24 }, (_, i) => ({
    x:     ((i * 137.5) % 100),   // golden-ratio spread
    y:     ((i * 97.3)  % 100),
    size:  2 + (i % 4),
    delay: i * 0.08,
    dur:   1.5 + (i % 3) * 0.4,
  }))

  // Gold burst particles (scene 3)
  const burstCount = isRoyal ? 32 : isBig ? 24 : 16
  const burstParticles = Array.from({ length: burstCount }, (_, i) => {
    const angle = (i / burstCount) * 360
    const dist  = 80 + (i % 4) * 30
    const rad   = (angle * Math.PI) / 180
    return {
      tx:    Math.cos(rad) * dist,
      ty:    Math.sin(rad) * dist,
      color: isRoyal
        ? ['#fbbf24', '#a78bfa', '#f59e0b', '#8b5cf6'][i % 4]
        : ['#fbbf24', '#f59e0b', '#fde68a', '#d97706'][i % 4],
      delay: 5.2 + i * 0.025,
    }
  })

  // Shockwave rings (scene 3 roar)
  const shockwaveCount = isBig ? 5 : 3

  return (
    <motion.div
      className="lion-cinematic-wrap"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* ── SCENE 1: Dark arena background ── */}
      <motion.div
        className={`lion-arena-bg ${isRoyal ? 'royal' : ''}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
      />

      {/* Ambient glow (low rumble) */}
      <motion.div
        className="lion-ambient-glow"
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: [0, 0.3, 0.2, 0.4, 0.2], scale: [0.5, 1.2, 1.0, 1.3, 1.0] }}
        transition={{ duration: 2.0, times: [0, 0.3, 0.5, 0.7, 1] }}
      />

      {/* Gold dust particles (scene 1) */}
      {dustParticles.map((p, i) => (
        <motion.div
          key={`dust-${i}`}
          className="lion-dust-particle"
          style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.size, height: p.size }}
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: [0, 0.8, 0.4, 0], y: [-10, -30, -50] }}
          transition={{ duration: p.dur, delay: p.delay, repeat: 2, repeatDelay: 0.3 }}
        />
      ))}

      {/* ── SCENE 2: Lion walks in from left ── */}
      {/* Ground shadow */}
      <motion.div
        className="lion-ground-shadow"
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: [0, 0, 0.3, 1, 1, 1, 0.8, 0], opacity: [0, 0, 0.4, 0.6, 0.6, 0.5, 0.3, 0] }}
        transition={{ duration: 10, times: [0, 0.18, 0.25, 0.4, 0.5, 0.7, 0.85, 1] }}
      />

      {/* Lion body — walk in + roar + fade */}
      <motion.div
        className={`lion-cinematic-body ${isRoyal ? 'royal' : ''}`}
        initial={{ x: '-120%', scale: 0.7, opacity: 0 }}
        animate={{
          x:       ['-120%', '-120%', '-20%', '0%',  '0%',   '0%',   '0%',   '0%',   '20%'],
          y:       [0,        0,       0,      0,      0,      -8,     0,      0,      0   ],
          scale:   [0.7,      0.7,     0.9,    1.0,    1.0,    1.05,   1.0,    0.95,   0.7 ],
          opacity: [0,        0,       1,      1,      1,      1,      1,      0.6,    0   ],
          rotate:  [0,        0,       0,      0,      0,      -3,     0,      0,      0   ],
        }}
        transition={{
          duration: 10,
          times:    [0, 0.18, 0.28, 0.42, 0.50, 0.58, 0.65, 0.82, 1.0],
          ease:     'easeInOut',
        }}
      >
        🦁
      </motion.div>

      {/* Camera zoom-in effect (scene 2 → 3) */}
      <motion.div
        className="lion-camera-zoom"
        initial={{ scale: 1, opacity: 0 }}
        animate={{ scale: [1, 1, 1, 1.04, 1.08, 1.04, 1], opacity: [0, 0, 0, 0.15, 0.25, 0.1, 0] }}
        transition={{ duration: 10, times: [0, 0.35, 0.45, 0.52, 0.60, 0.68, 0.75] }}
      />

      {/* ── SCENE 3: ROAR — screen shake + shockwaves + gold burst ── */}
      {/* Screen shake wrapper */}
      <motion.div
        className="lion-shake-wrap"
        animate={{
          x: [0, 0, 0, 0, 0, -6, 6, -5, 5, -3, 3, -1, 1, 0, 0, 0, 0],
          y: [0, 0, 0, 0, 0,  3,-3,  2,-2,  1,-1,  0, 0, 0, 0, 0, 0],
        }}
        transition={{
          duration: 10,
          times:    [0, 0.45, 0.50, 0.54, 0.56, 0.57, 0.58, 0.59, 0.60, 0.61, 0.62, 0.63, 0.64, 0.65, 0.70, 0.85, 1.0],
        }}
      >
        {/* Roar flash */}
        <motion.div
          className="lion-roar-flash"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0, 0, 0, 0, 1, 0.5, 0.2, 0] }}
          transition={{ duration: 10, times: [0, 0.50, 0.54, 0.56, 0.57, 0.58, 0.60, 0.63, 0.68] }}
        />

        {/* Shockwave rings */}
        {Array.from({ length: shockwaveCount }, (_, i) => (
          <motion.div
            key={`shock-${i}`}
            className={`lion-shockwave-ring ${isRoyal ? 'royal' : ''}`}
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: [0.3, 0.3, 0.3, 0.3, 0.3, 0.5, 2 + i * 0.8, 4 + i], opacity: [0, 0, 0, 0, 0, 0.9, 0.5, 0] }}
            transition={{
              duration: 10,
              times:    [0, 0.45, 0.50, 0.54, 0.56, 0.58, 0.65, 0.75],
              delay:    i * 0.08,
            }}
          />
        ))}
      </motion.div>

      {/* Gold burst particles (scene 3) */}
      {burstParticles.map((p, i) => (
        <motion.div
          key={`burst-${i}`}
          className="lion-burst-particle"
          style={{ background: p.color }}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
          animate={{ x: p.tx, y: p.ty, opacity: [0, 1, 0.8, 0], scale: [0, 1.2, 0.8, 0] }}
          transition={{ duration: 1.4, delay: p.delay, ease: 'easeOut' }}
        />
      ))}

      {/* ── SCENE 4: Receiver spotlight + crown ── */}
      {/* Receiver avatar with golden crown */}
      <motion.div
        className="lion-receiver-spotlight"
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: [0, 0, 0, 0, 0, 0, 0, 1, 1, 0.8], scale: [0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 1, 1.05, 1] }}
        transition={{ duration: 10, times: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.72, 0.85, 1] }}
      >
        <div className="lion-receiver-avatar-wrap">
          <div className="lion-receiver-avatar-img">
            {receiverAvatar
              ? <img src={receiverAvatar} alt={receiverName} />
              : <span>{event.receiver?.firstName?.[0] ?? '🎪'}</span>
            }
          </div>
          {/* Pulsing golden ring */}
          <motion.div
            className="lion-receiver-ring"
            animate={{ scale: [1, 1.15, 1], opacity: [0.8, 1, 0.8] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
          {/* Crown appears */}
          <motion.div
            className={`lion-crown-badge ${isRoyal ? 'royal' : ''}`}
            initial={{ scale: 0, y: 10, opacity: 0 }}
            animate={{ scale: [0, 0, 0, 0, 0, 0, 0, 1.3, 1], y: [10, 10, 10, 10, 10, 10, 10, -5, 0], opacity: [0, 0, 0, 0, 0, 0, 0, 1, 1] }}
            transition={{ duration: 10, times: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.73, 0.80] }}
          >
            {isRoyal ? '👑✨' : '👑'}
          </motion.div>
        </div>
        <motion.div
          className="lion-top-supporter-badge"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1], y: [8, 8, 8, 8, 8, 8, 8, 8, 0, 0] }}
          transition={{ duration: 10, times: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.70, 0.76, 1] }}
        >
          {isRoyal ? '⭐ Royal Supporter' : '👑 Top Supporter'}
        </motion.div>
      </motion.div>

      {/* ── Sender info banner (visible throughout) ── */}
      <motion.div
        className="lion-cinematic-info"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: [0, 0, 1, 1, 1, 1, 1, 1, 0], y: [20, 20, 0, 0, 0, 0, 0, 0, -10] }}
        transition={{ duration: 10, times: [0, 0.20, 0.28, 0.40, 0.55, 0.65, 0.75, 0.88, 1.0] }}
      >
        <div className="lion-info-sender-row">
          <div className="lion-info-avatar">
            {senderAvatar
              ? <img src={senderAvatar} alt={senderName} />
              : <span>{event.sender.firstName[0]}</span>
            }
          </div>
          <div className="lion-info-text">
            <span className={`lion-info-sender ${isRoyal ? 'royal' : ''}`}>{senderName}</span>
            <span className="lion-info-action"> sent a </span>
            <span className="lion-info-gift">🦁 Lion</span>
            {receiverName && (
              <>
                <span className="lion-info-action"> to </span>
                <span className="lion-info-receiver">{receiverName}</span>
              </>
            )}
            {combo > 1 && (
              <span className={`lion-info-combo ${isRoyal ? 'royal' : ''}`}>
                {isRoyal ? ' 👑 Royal Mode' : ` ×${combo}`}
              </span>
            )}
          </div>
        </div>
        <div className="lion-info-value">🪙 1,000 coins</div>
      </motion.div>
    </motion.div>
  )
}

// ─── BURJ KHALIFA animation ───────────────────────────────────────────────────
function BurjAnimation({ event }: { event: GiftEvent }) {
  const senderName   = `${event.sender.firstName} ${event.sender.lastName}`
  const receiverName = event.receiver
    ? `${event.receiver.firstName} ${event.receiver.lastName}`
    : event.isAllStage ? 'everyone on stage' : ''

  const FIREWORK_COLORS = ['#fbbf24', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6', '#10b981', '#fff']
  const bursts = [
    { x: '20%', y: '30%' }, { x: '75%', y: '20%' }, { x: '50%', y: '15%' },
    { x: '30%', y: '50%' }, { x: '70%', y: '45%' }, { x: '15%', y: '65%' },
    { x: '85%', y: '60%' }, { x: '50%', y: '70%' },
  ]

  return (
    <motion.div
      className="premium-burj-wrap"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Dark cinematic overlay */}
      <motion.div
        className="burj-cinematic-bg"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
      />

      {/* Burj Khalifa rising from bottom */}
      <motion.div
        className="burj-building"
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 20, stiffness: 120, delay: 0.3 }}
      >
        <div className="burj-tower">🏙️</div>
        {/* Light beam from top */}
        <motion.div
          className="burj-beam"
          initial={{ scaleY: 0, opacity: 0 }}
          animate={{ scaleY: 1, opacity: [0, 1, 0.6] }}
          transition={{ duration: 1, delay: 1.2 }}
        />
      </motion.div>

      {/* Fireworks bursts */}
      {bursts.map((pos, i) => (
        <motion.div
          key={i}
          style={{ position: 'absolute', left: pos.x, top: pos.y }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.0 + i * 0.15 }}
        >
          <FireworksBurst
            x={0} y={0}
            colors={FIREWORK_COLORS}
          />
        </motion.div>
      ))}

      {/* Sender name — BIG, prominent */}
      <motion.div
        className="burj-sender-display"
        initial={{ opacity: 0, scale: 0.7, y: -20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: 0.8, type: 'spring', damping: 15 }}
      >
        <div className="burj-sender-avatar">
          {getAvatarUrl(event.sender.avatarUrl)
            ? <img src={getAvatarUrl(event.sender.avatarUrl)!} alt={senderName} />
            : <span>{event.sender.firstName[0]}</span>
          }
        </div>
        <div className="burj-sender-info">
          <div className="burj-sender-name">{senderName}</div>
          <div className="burj-gift-label">sent the</div>
          <div className="burj-gift-title">🏙️ Burj Khalifa</div>
        </div>
      </motion.div>

      {/* Receiver highlight */}
      <motion.div
        className="burj-receiver-display"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.2, duration: 0.5 }}
      >
        <span className="burj-to-label">to</span>
        <span className="burj-receiver-name">{receiverName}</span>
        <span className="burj-top-badge">🏆 Top Supporter</span>
      </motion.div>

      {/* Coin value */}
      <motion.div
        className="burj-value-badge"
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1.5, type: 'spring', damping: 12 }}
      >
        🪙 5,000 coins
      </motion.div>
    </motion.div>
  )
}

// ─── Priority queue manager ───────────────────────────────────────────────────
// Ensures only one premium animation plays at a time.
// ultra always preempts high; high queues behind ultra.

export function PremiumGiftOverlay() {
  const { activeGiftEvents } = useVoiceStore()
  const [videoError, setVideoError] = useState<Record<string, boolean>>({})

  // Filter to premium only, sorted by priority (ultra first)
  const premiumEvents = activeGiftEvents
    .filter(e => e.isPremium)
    .sort((a, b) => {
      const order = { ultra: 0, high: 1, normal: 2 }
      return (order[a.priority] ?? 2) - (order[b.priority] ?? 2)
    })

  // Show only the highest-priority event at a time
  const current = premiumEvents[0] ?? null

  if (!current) return null

  const animType = current.gift.animationType
  const giftName = current.gift.name.toLowerCase()
  const videoUrl = (current.gift as any).videoUrl as string | undefined

  return (
    <AnimatePresence mode="wait">
      {current && (
        <div key={current.id} className="premium-overlay-root">
          {/* Video animation takes priority if videoUrl is set and hasn't errored */}
          {videoUrl && !videoError[current.id]
            ? (
              <video
                src={videoUrl}
                autoPlay
                playsInline
                onError={() => setVideoError(prev => ({ ...prev, [current.id]: true }))}
                style={{
                  position: 'fixed', inset: 0, width: '100%', height: '100%',
                  objectFit: 'contain', background: 'rgba(0,0,0,0.8)',
                  zIndex: 600, pointerEvents: 'none',
                }}
              />
            )
            /* Route to existing animation components */
            : animType === 'cinematic' || animType === 'rocket_cinematic' || giftName.includes('burj')
            ? <BurjAnimation event={current} />
            : animType === 'fullscreen' || giftName === 'lion'
            ? <LionAnimation event={current} />
            : animType === 'spotlight' || giftName === 'horse'
            ? <HorseAnimation event={current} />
            : null
          }
        </div>
      )}
    </AnimatePresence>
  )
}
