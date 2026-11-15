'use client'

/**
 * MicEmojiReaction
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles all mic-tap emoji reactions and speaking-state animations.
 *
 * Features:
 *  1. Mic tap → random emoji pops above mic (scale + float + fade, 2s auto-hide)
 *  2. Speaking state → looping pulse glow + intensity-based emoji
 *  3. Combo system → rapid taps trigger burst + "🔥 x3" text
 *  4. Real-time broadcast via Socket.IO (voice:mic_reaction)
 *  5. Rate-limited: 1 reaction per 2s per user (client-side debounce)
 *  6. Receives remote reactions and floats them above the correct avatar
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getSocket } from '@/lib/socket'
import { useAuthStore } from '@/store/auth.store'

// ─── Emoji config ─────────────────────────────────────────────────────────────
// Using the 3 custom images you provided + Unicode fallbacks
export const MIC_EMOJIS = [
  { id: 'laugh',    src: '/emoji/laugh.png',    unicode: '😂', label: 'Laugh'    },
  { id: 'facepalm', src: '/emoji/facepalm.png', unicode: '🤦', label: 'Facepalm' },
  { id: 'angry',    src: '/emoji/angry.png',    unicode: '😤', label: 'Angry'    },
] as const

export type MicEmojiId = typeof MIC_EMOJIS[number]['id']

// Speaking intensity → emoji
const SPEAKING_EMOJIS = {
  low:    { unicode: '😌', label: 'calm'   },
  medium: { unicode: '🗣️', label: 'talking' },
  high:   { unicode: '🔥', label: 'loud'   },
} as const

// ─── Types ────────────────────────────────────────────────────────────────────
interface FloatingEmoji {
  id:      string
  emoji:   typeof MIC_EMOJIS[number]
  x:       number   // random horizontal offset
  rot:     number   // random rotation
  combo:   number   // combo count at time of emission
}

interface RemoteReaction {
  id:       string
  userId:   string
  emojiId:  MicEmojiId
  x:        number
  rot:      number
}

// ─── Hook: mic reaction logic ─────────────────────────────────────────────────
export function useMicReaction(roomId: string | null) {
  const { user } = useAuthStore()
  const lastReactionAt = useRef(0)
  const comboTimer     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const comboCount     = useRef(0)

  const [localEmojis,  setLocalEmojis]  = useState<FloatingEmoji[]>([])
  const [remoteEmojis, setRemoteEmojis] = useState<RemoteReaction[]>([])
  const [comboText,    setComboText]    = useState<string | null>(null)

  // ── Listen for remote reactions ──────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return
    const socket = getSocket()
    if (!socket) return

    const onReaction = (data: { userId: string; emojiId: MicEmojiId; roomId: string }) => {
      if (data.roomId !== roomId) return
      if (data.userId === user?.id) return // own reaction already shown locally

      const id = `remote-${Date.now()}-${Math.random()}`
      const reaction: RemoteReaction = {
        id,
        userId:  data.userId,
        emojiId: data.emojiId,
        x:       Math.random() * 40 - 20,
        rot:     Math.random() * 20 - 10,
      }
      setRemoteEmojis(prev => [...prev.slice(-9), reaction])
      setTimeout(() => {
        setRemoteEmojis(prev => prev.filter(r => r.id !== id))
      }, 2200)
    }

    socket.on('voice:mic_reaction', onReaction)
    return () => { socket.off('voice:mic_reaction', onReaction) }
  }, [roomId, user?.id])

  // ── Trigger a local reaction + broadcast ────────────────────────────────
  const triggerReaction = useCallback((emojiIndex?: number) => {
    const now = Date.now()
    if (now - lastReactionAt.current < 2000) return // rate limit: 1 per 2s
    lastReactionAt.current = now

    // Combo tracking
    comboCount.current += 1
    if (comboTimer.current) clearTimeout(comboTimer.current)
    comboTimer.current = setTimeout(() => { comboCount.current = 0 }, 1500)

    const combo = comboCount.current
    if (combo >= 3) {
      setComboText(`🔥 x${combo}`)
      setTimeout(() => setComboText(null), 1200)
    }

    // Pick emoji
    const idx   = emojiIndex !== undefined ? emojiIndex : Math.floor(Math.random() * MIC_EMOJIS.length)
    const emoji = MIC_EMOJIS[idx]

    // Burst: if combo ≥ 3, emit multiple
    const count = combo >= 3 ? Math.min(combo, 5) : 1
    for (let i = 0; i < count; i++) {
      const id = `local-${Date.now()}-${i}-${Math.random()}`
      const item: FloatingEmoji = {
        id,
        emoji,
        x:   Math.random() * 60 - 30,
        rot: Math.random() * 20 - 10,
        combo,
      }
      setTimeout(() => {
        setLocalEmojis(prev => [...prev.slice(-9), item])
        setTimeout(() => {
          setLocalEmojis(prev => prev.filter(e => e.id !== id))
        }, 2200)
      }, i * 120)
    }

    // Broadcast via Socket.IO
    const socket = getSocket()
    if (socket && roomId) {
      socket.emit('voice:mic_reaction', {
        roomId,
        userId:  user?.id,
        emojiId: emoji.id,
        timestamp: now,
      })
    }
  }, [roomId, user?.id])

  return { localEmojis, remoteEmojis, comboText, triggerReaction }
}

// ─── Component: floating emoji above mic button ───────────────────────────────
interface MicEmojiOverlayProps {
  localEmojis:  FloatingEmoji[]
  comboText:    string | null
  isSpeaking:   boolean
  speakingLevel: 'low' | 'medium' | 'high'
}

export function MicEmojiOverlay({
  localEmojis, comboText, isSpeaking, speakingLevel,
}: MicEmojiOverlayProps) {
  const speakingEmoji = SPEAKING_EMOJIS[speakingLevel]

  return (
    <div className="mic-emoji-overlay" aria-hidden="true">

      {/* Speaking state — looping pulse when mic is live */}
      <AnimatePresence>
        {isSpeaking && (
          <motion.div
            key="speaking"
            className="mic-speaking-indicator"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: [1, 1.15, 1], transition: { scale: { repeat: Infinity, duration: 0.6 } } }}
            exit={{ opacity: 0, scale: 0.6 }}
          >
            <span className="mic-speaking-emoji">{speakingEmoji.unicode}</span>
            <span className={`mic-speaking-glow mic-glow-${speakingLevel}`} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Combo text burst */}
      <AnimatePresence>
        {comboText && (
          <motion.div
            key="combo"
            className="mic-combo-text"
            initial={{ opacity: 0, scale: 0.5, y: 0 }}
            animate={{ opacity: 1, scale: 1.3, y: -20 }}
            exit={{ opacity: 0, scale: 0.8, y: -40 }}
            transition={{ duration: 0.4, ease: 'backOut' }}
          >
            {comboText}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Local floating emojis */}
      <AnimatePresence>
        {localEmojis.map(item => (
          <motion.div
            key={item.id}
            className="mic-float-emoji"
            style={{ '--x': `${item.x}px`, '--rot': `${item.rot}deg` } as React.CSSProperties}
            initial={{ opacity: 0, scale: 0, y: 0, rotate: 0 }}
            animate={{
              opacity: [0, 1, 1, 0],
              scale:   [0, 1.2, 1, 0.8],
              y:       [0, -20, -40, -60],
              rotate:  [0, item.rot, item.rot * 0.5, 0],
            }}
            transition={{ duration: 0.8, ease: 'easeOut', times: [0, 0.2, 0.7, 1] }}
          >
            <img
              src={item.emoji.src}
              alt={item.emoji.label}
              className="mic-emoji-img"
              onError={(e) => {
                // Fallback to unicode if image fails to load
                const el = e.currentTarget
                el.style.display = 'none'
                const span = document.createElement('span')
                span.textContent = item.emoji.unicode
                span.className = 'mic-emoji-unicode'
                el.parentElement?.appendChild(span)
              }}
            />
            {/* Glow behind emoji */}
            <span className="mic-emoji-glow" />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

// ─── Component: floating emoji above an avatar circle (stage) ────────────────
// Used for BOTH local (my own) and remote reactions — shown on the speaker tile
interface AvatarReactionBubbleProps {
  reactions: RemoteReaction[]
  userId:    string
  localEmojis?: FloatingEmoji[]  // only passed for isMe tile
}

export function AvatarReactionBubble({ reactions, userId, localEmojis = [] }: AvatarReactionBubbleProps) {
  // Merge remote reactions for this user + local emojis (when isMe)
  const items = [
    ...reactions.filter(r => r.userId === userId).map(r => ({
      id:    r.id,
      emoji: MIC_EMOJIS.find(e => e.id === r.emojiId) ?? MIC_EMOJIS[0],
      x:     r.x,
      rot:   r.rot ?? 0,
    })),
    ...localEmojis.map(e => ({
      id:    e.id,
      emoji: e.emoji,
      x:     e.x,
      rot:   e.rot,
    })),
  ]

  if (items.length === 0) return null

  return (
    <div className="avatar-reaction-wrap" aria-hidden="true">
      <AnimatePresence>
        {items.map(item => (
          <motion.div
            key={item.id}
            className="avatar-reaction-bubble"
            style={{ '--x': `${item.x}px` } as React.CSSProperties}
            initial={{ opacity: 0, scale: 0, y: 0, rotate: 0 }}
            animate={{
              opacity: [0, 1, 1, 0],
              scale:   [0, 1.25, 1.1, 0.8],
              y:       [0, -18, -38, -58],
              rotate:  [0, item.rot, item.rot * 0.5, 0],
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.85, ease: 'easeOut', times: [0, 0.18, 0.65, 1] }}
          >
            <img
              src={item.emoji.src}
              alt={item.emoji.label}
              className="avatar-reaction-img"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
                const span = document.createElement('span')
                span.textContent = item.emoji.unicode
                span.className = 'avatar-reaction-unicode'
                e.currentTarget.parentElement?.appendChild(span)
              }}
            />
            <span className="avatar-reaction-glow" />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

// ─── Hook: speaking level from activeSpeakers + volume analysis ───────────────
export function useSpeakingLevel(
  isSpeaking: boolean,
  roomRef: React.MutableRefObject<any>
): 'low' | 'medium' | 'high' {
  const [level, setLevel] = useState<'low' | 'medium' | 'high'>('low')
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef      = useRef<number | null>(null)

  useEffect(() => {
    if (!isSpeaking) return

    // Try to get audio level from the local mic track via Web Audio API
    let stream: MediaStream | null = null
    let ctx: AudioContext | null   = null

    const setup = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        ctx    = new AudioContext()
        const source   = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        analyserRef.current = analyser

        const data = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          analyser.getByteFrequencyData(data)
          const avg = data.reduce((a, b) => a + b, 0) / data.length
          if      (avg > 60) setLevel('high')
          else if (avg > 25) setLevel('medium')
          else               setLevel('low')
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      } catch {
        // Mic access denied or not available — default to medium when speaking
        setLevel('medium')
      }
    }

    setup()

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      stream?.getTracks().forEach(t => t.stop())
      ctx?.close()
      analyserRef.current = null
      // Reset level when isSpeaking goes false or component unmounts
      setLevel('low')
    }
  }, [isSpeaking])

  return level
}

// ─── Component: emoji picker bar (shown above bottom bar for speakers) ────────
// Clicking an emoji fires triggerReaction(index) → shows on YOUR stage circle
interface EmojiReactionPickerProps {
  onPick: (index: number) => void
  visible: boolean
}

export function EmojiReactionPicker({ onPick, visible }: EmojiReactionPickerProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="emoji-picker-bar"
          initial={{ opacity: 0, y: 12, scale: 0.9 }}
          animate={{ opacity: 1, y: 0,  scale: 1   }}
          exit={{    opacity: 0, y: 12, scale: 0.9 }}
          transition={{ duration: 0.22, ease: 'backOut' }}
        >
          {MIC_EMOJIS.map((emoji, idx) => (
            <motion.button
              key={emoji.id}
              className="emoji-picker-btn"
              onClick={() => onPick(idx)}
              whileTap={{ scale: 0.85 }}
              whileHover={{ scale: 1.18 }}
              title={emoji.label}
            >
              <img
                src={emoji.src}
                alt={emoji.label}
                className="emoji-picker-img"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                  const span = document.createElement('span')
                  span.textContent = emoji.unicode
                  span.style.fontSize = '28px'
                  e.currentTarget.parentElement?.appendChild(span)
                }}
              />
            </motion.button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
