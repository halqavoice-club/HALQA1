'use client'

/**
 * LiveClassGiftOverlay.tsx
 *
 * TikTok-style gift animation overlay for Live Class.
 * Renders independently at fixed z-index 500+, never blocking audio/video/whiteboard.
 *
 * Animation tiers:
 *   common/standard  → FloatingGiftCard  — slides in from right, drifts up
 *   rare/epic        → GlowingGiftCard   — particle burst + glow
 *   legendary/ultimate → CinematicFallback — fullscreen emoji cinematic
 *   animationType='video' OR videoUrl set → VideoGiftAnimation — plays MP4/WebM fullscreen
 */

import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useVoiceStore, type GiftEvent } from '@/store/voice.store'
import { getAvatarUrl } from '@/lib/avatar'

// ─── helpers ─────────────────────────────────────────────────────────────────

const RARITY_COLOR: Record<string, string> = {
  common:    '#9ca3af',
  standard:  '#f472b6',
  rare:      '#60a5fa',
  epic:      '#a78bfa',
  legendary: '#fbbf24',
  ultimate:  '#f43f5e',
}
const rarityColor = (r: string) => RARITY_COLOR[r] ?? RARITY_COLOR.common

function isCinematic(event: GiftEvent) {
  return event.gift.rarity === 'legendary' || event.gift.rarity === 'ultimate'
}
function isVideoGift(event: GiftEvent) {
  return !!(event.gift as any).videoUrl || event.gift.animationType === 'video'
}
function isRareOrEpic(event: GiftEvent) {
  return event.gift.rarity === 'rare' || event.gift.rarity === 'epic'
}

// ─── ParticleBurst ───────────────────────────────────────────────────────────

function ParticleBurst({ color, count = 14 }: { color: string; count?: number }) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {Array.from({ length: count }, (_, i) => {
        const angle = (360 / count) * i
        const dist  = 55 + Math.random() * 40
        return (
          <motion.div
            key={i}
            initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            animate={{
              opacity: 0,
              x: Math.cos((angle * Math.PI) / 180) * dist,
              y: Math.sin((angle * Math.PI) / 180) * dist,
              scale: 0,
            }}
            transition={{ duration: 0.75, delay: i * 0.02, ease: 'easeOut' }}
            style={{
              position: 'absolute', top: '50%', left: '50%',
              width: 6, height: 6, borderRadius: '50%',
              backgroundColor: color, marginTop: -3, marginLeft: -3,
            }}
          />
        )
      })}
    </div>
  )
}

// ─── ComboBadge ──────────────────────────────────────────────────────────────

function ComboBadge({ combo }: { combo: number }) {
  if (combo < 2) return null
  const color = combo >= 99 ? '#f59e0b' : combo >= 20 ? '#a78bfa' : combo >= 10 ? '#60a5fa' : '#34d399'
  return (
    <motion.div
      key={combo}
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: [0.4, 1.5, 1], opacity: 1 }}
      transition={{ duration: 0.35, type: 'spring' }}
      style={{
        position: 'absolute', top: -22, right: -6,
        background: color, color: '#fff',
        borderRadius: 10, padding: '2px 7px',
        fontSize: 11, fontWeight: 900,
        boxShadow: `0 0 8px ${color}99`,
        whiteSpace: 'nowrap',
      }}
    >
      🔥×{combo}
    </motion.div>
  )
}

// ─── FloatingGiftCard — common/standard ──────────────────────────────────────

function FloatingGiftCard({ event }: { event: GiftEvent }) {
  const src = getAvatarUrl(event.sender?.avatarUrl)
  return (
    <motion.div
      initial={{ opacity: 0, x: 80, scale: 0.7 }}
      animate={{ opacity: [0, 1, 1, 0], x: [80, 0, -8, -40], y: [0, 0, -20, -70], scale: [0.7, 1, 1, 0.85] }}
      transition={{ duration: 2.6, times: [0, 0.12, 0.65, 1], ease: 'easeOut' }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'rgba(10,10,25,0.88)', borderRadius: 28,
        padding: '7px 14px 7px 7px',
        border: '1px solid rgba(255,255,255,0.12)',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
        maxWidth: 210, position: 'relative',
      }}
    >
      <div style={{
        width: 30, height: 30, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
        background: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color: '#a5b4fc',
      }}>
        {src
          ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : event.sender?.firstName?.[0] ?? '?'}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>
          {event.sender?.firstName ?? 'Someone'}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 20 }}>{event.gift.emoji}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>
            {event.gift.name}
          </span>
        </div>
      </div>
      <ComboBadge combo={event.combo} />
    </motion.div>
  )
}

// ─── GlowingGiftCard — rare/epic ─────────────────────────────────────────────

function GlowingGiftCard({ event }: { event: GiftEvent }) {
  const color = rarityColor(event.gift.rarity)
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.4, y: 50 }}
      animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.12, 1, 0.9], y: [50, 0, -30, -90] }}
      transition={{ duration: 3.2, times: [0, 0.1, 0.65, 1], ease: 'easeOut' }}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        background: `radial-gradient(ellipse at center, ${color}20, rgba(10,10,25,0.92))`,
        borderRadius: 18, padding: '14px 22px',
        border: `1.5px solid ${color}55`,
        boxShadow: `0 0 28px ${color}44, 0 0 70px ${color}18`,
        position: 'relative', minWidth: 130,
      }}
    >
      <ParticleBurst color={color} count={18} />
      <motion.div
        animate={{ scale: [1, 1.25, 1], rotate: [0, 12, -12, 0] }}
        transition={{ duration: 0.55, repeat: 2 }}
        style={{ fontSize: 44, filter: `drop-shadow(0 0 12px ${color})` }}
      >
        {event.gift.emoji}
      </motion.div>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', textAlign: 'center' }}>{event.gift.name}</div>
      <div style={{ fontSize: 10, color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
        {event.gift.rarity}
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af' }}>
        {event.sender?.firstName} → {event.receiver?.firstName ?? 'All'}
      </div>
      <ComboBadge combo={event.combo} />
    </motion.div>
  )
}

// ─── CinematicFallback — legendary/ultimate (no video) ───────────────────────

function CinematicFallback({ event, onDone }: { event: GiftEvent; onDone: () => void }) {
  const colors = event.gift.rarity === 'ultimate'
    ? ['#f43f5e', '#ec4899', '#a855f7']
    : ['#f59e0b', '#ef4444', '#f97316']

  useEffect(() => {
    const t = setTimeout(onDone, 4500)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 610,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: `radial-gradient(ellipse at center, ${colors[0]}30, rgba(0,0,0,0.92))`,
        pointerEvents: 'none',
      }}
    >
      {/* Pulsing rings */}
      {[1, 2, 3].map(i => (
        <motion.div
          key={i}
          initial={{ scale: 0.3, opacity: 0.7 }}
          animate={{ scale: 2 + i * 0.5, opacity: 0 }}
          transition={{ duration: 1.5, delay: i * 0.22, repeat: Infinity, repeatDelay: 1.6 }}
          style={{
            position: 'absolute', width: 200, height: 200, borderRadius: '50%',
            border: `2px solid ${colors[i % colors.length]}`,
          }}
        />
      ))}

      {/* Big emoji */}
      <motion.div
        initial={{ scale: 0, rotate: -180 }}
        animate={{ scale: [0, 1.6, 1.25], rotate: [-180, 15, 0] }}
        transition={{ duration: 0.85, type: 'spring', stiffness: 220 }}
        style={{ fontSize: 100, filter: `drop-shadow(0 0 35px ${colors[0]})`, zIndex: 1 }}
      >
        {event.gift.emoji}
      </motion.div>

      {/* Gift name */}
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        style={{ color: '#fff', fontSize: 30, fontWeight: 900, marginTop: 10, textShadow: `0 0 22px ${colors[0]}`, zIndex: 1 }}
      >
        {event.gift.name}
      </motion.div>

      {/* Sender info */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.85 }}
        style={{ color: '#e5e7eb', fontSize: 16, marginTop: 8, zIndex: 1 }}
      >
        {event.sender?.firstName} → {event.receiver?.firstName ?? (event.receivers?.length ? 'everyone' : '?')}
      </motion.div>

      {/* Combo */}
      {event.combo >= 2 && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1.35, 1] }}
          transition={{ delay: 1.1, type: 'spring' }}
          style={{ marginTop: 14, background: colors[0], color: '#fff', borderRadius: 20, padding: '6px 22px', fontSize: 22, fontWeight: 900, boxShadow: `0 0 22px ${colors[0]}`, zIndex: 1 }}
        >
          🔥 ×{event.combo}
        </motion.div>
      )}

      <div style={{ position: 'absolute', top: '50%', left: '50%' }}>
        <ParticleBurst color={colors[0]} count={32} />
      </div>
    </motion.div>
  )
}

// ─── VideoGiftAnimation — plays MP4/WebM fullscreen ───────────────────────────

function VideoGiftAnimation({ event, onDone }: { event: GiftEvent; onDone: () => void }) {
  const videoUrl = (event.gift as any).videoUrl as string | undefined
  const [videoFailed, setVideoFailed] = useState(false)

  useEffect(() => {
    const ms = event.holdMs > 0 ? event.holdMs + 600 : 7000
    const t = setTimeout(onDone, ms)
    return () => clearTimeout(t)
  }, [onDone, event.holdMs])

  // Graceful fallback: if no URL or video errors, show cinematic
  if (!videoUrl || videoFailed) {
    return <CinematicFallback event={event} onDone={onDone} />
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 610,
        background: 'rgba(0,0,0,0.8)',
        pointerEvents: 'none',
      }}
    >
      {/* Video fills screen */}
      <video
        src={videoUrl}
        autoPlay
        playsInline
        onEnded={onDone}
        onError={() => setVideoFailed(true)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
      />

      {/* Sender / gift info at bottom */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        style={{
          position: 'absolute', bottom: 88, left: 0, right: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, zIndex: 1,
        }}
      >
        <div style={{
          background: 'rgba(0,0,0,0.72)', borderRadius: 22, padding: '9px 22px',
          color: '#fff', fontSize: 18, fontWeight: 700, backdropFilter: 'blur(10px)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 26 }}>{event.gift.emoji}</span>
          {event.gift.name}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.82)', fontSize: 14 }}>
          {event.sender?.firstName} → {event.receiver?.firstName ?? 'everyone'}
        </div>
        {event.combo >= 2 && (
          <div style={{ background: '#f59e0b', color: '#fff', borderRadius: 12, padding: '4px 18px', fontSize: 16, fontWeight: 900 }}>
            🔥 ×{event.combo}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

// ─── CinematicRouter — picks video or fallback ────────────────────────────────

function CinematicRouter({ event, onDone }: { event: GiftEvent; onDone: () => void }) {
  if (isVideoGift(event)) return <VideoGiftAnimation event={event} onDone={onDone} />
  return <CinematicFallback event={event} onDone={onDone} />
}

// ─── Main overlay ─────────────────────────────────────────────────────────────

export function LiveClassGiftOverlay({ isLowEnd = false }: { isLowEnd?: boolean }) {
  const { activeGiftEvents } = useVoiceStore()
  const [cinematicEvent, setCinematicEvent] = useState<GiftEvent | null>(null)

  // Pick the latest cinematic/video event to show fullscreen
  useEffect(() => {
    if (isLowEnd) return
    const next = activeGiftEvents.find(e => isCinematic(e) || isVideoGift(e))
    if (next && next.id !== cinematicEvent?.id) {
      setCinematicEvent(next)
    }
  }, [activeGiftEvents, isLowEnd, cinematicEvent?.id])

  // Normal events (non-cinematic) stacked bottom-right
  const normalEvents = activeGiftEvents.filter(e => !isCinematic(e) && !isVideoGift(e))

  return (
    <>
      {/* Fullscreen cinematic / video layer */}
      <AnimatePresence>
        {cinematicEvent && !isLowEnd && (
          <CinematicRouter
            key={cinematicEvent.id}
            event={cinematicEvent}
            onDone={() => setCinematicEvent(null)}
          />
        )}
      </AnimatePresence>

      {/* Floating cards — bottom-right stack, max 5 visible */}
      <div
        style={{
          position: 'fixed', bottom: 90, right: 16, zIndex: 500,
          display: 'flex', flexDirection: 'column-reverse', gap: 8,
          pointerEvents: 'none', maxWidth: 230,
        }}
      >
        <AnimatePresence>
          {normalEvents.slice(-5).map(event => (
            <div key={event.id} style={{ position: 'relative' }}>
              {isRareOrEpic(event) && !isLowEnd
                ? <GlowingGiftCard event={event} />
                : <FloatingGiftCard event={event} />
              }
            </div>
          ))}
        </AnimatePresence>
      </div>
    </>
  )
}
