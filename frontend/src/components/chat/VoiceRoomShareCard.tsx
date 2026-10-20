'use client'

/**
 * VoiceRoomShareCard — renders a structured Voice Club share card in DM and Group Chat.
 *
 * Used by:
 *   - DmMediaBubble (msgType === 'VOICE_ROOM_SHARE')
 *   - GcMediaBubble (type === 'VOICE_ROOM_SHARE')
 *
 * Data source: voiceRoomData from the backend (authoritative).
 * refEntityId is used for navigation — never a client-supplied title.
 *
 * States:
 *   voiceRoomData exists  → full card with title, emoji, status, Join button
 *   voiceRoomData === null → "Voice Club unavailable" fallback (safe, no crash)
 *   refEntityId missing   → minimal safe fallback
 */

import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

interface VoiceRoomData {
  id: string
  title: string
  coverEmoji?: string | null
  coverImageUrl?: string | null
  privacy?: string | null
  status?: string | null
  hostId?: string | null
  maxSpeakers?: number | null
}

interface Props {
  /** Authoritative room ID — used for navigation */
  refEntityId: string | null | undefined
  /** Server-provided room data — null means room is unavailable */
  voiceRoomData: VoiceRoomData | null | undefined
  /** Optional note/body the sender added */
  body?: string | null
  /** Whether this message was sent by the current user */
  isMe: boolean
}

export function VoiceRoomShareCard({ refEntityId, voiceRoomData, body, isMe }: Props) {
  const router = useRouter()

  const handleJoin = () => {
    if (!refEntityId) return
    // Navigate to the existing Voice Club room page using the authoritative refEntityId
    router.push(`/voice-club/${refEntityId}`)
  }

  // ── Missing refEntityId — minimal safe fallback ─────────────────────────
  if (!refEntityId) {
    return (
      <div className={cn(
        'rounded-xl border p-3 text-sm max-w-[260px]',
        isMe ? 'border-green-300/40 bg-green-600/10' : 'border-gray-200 bg-gray-50'
      )}>
        <div className="flex items-center gap-2">
          <span className="text-xl">🎙️</span>
          <span className={cn('text-xs font-medium', isMe ? 'text-gray-700' : 'text-gray-500')}>
            Voice Club
          </span>
        </div>
      </div>
    )
  }

  // ── Room unavailable (deleted or not found) ─────────────────────────────
  if (voiceRoomData === null || voiceRoomData === undefined) {
    return (
      <div className={cn(
        'rounded-xl border p-3 text-sm max-w-[260px]',
        isMe ? 'border-green-300/40 bg-green-600/10' : 'border-gray-200 bg-gray-50'
      )}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">🎙️</span>
          <span className={cn('text-xs font-semibold uppercase tracking-wide', isMe ? 'text-gray-500' : 'text-gray-400')}>
            Voice Club
          </span>
        </div>
        <p className={cn('text-xs', isMe ? 'text-gray-500' : 'text-gray-400')}>
          This Voice Club is no longer available
        </p>
        {body && (
          <p className={cn('mt-1 text-xs italic', isMe ? 'text-gray-600' : 'text-gray-500')}>
            {body}
          </p>
        )}
      </div>
    )
  }

  // ── Full card ───────────────────────────────────────────────────────────
  const isLive = voiceRoomData.status === 'LIVE'
  const emoji  = voiceRoomData.coverEmoji ?? '🎙️'

  return (
    <div className={cn(
      'rounded-xl border overflow-hidden max-w-[260px] cursor-pointer transition-opacity hover:opacity-90',
      isMe ? 'border-green-300/50 bg-green-600/10' : 'border-gray-200 bg-white'
    )}>
      {/* Cover strip */}
      <div
        className="flex items-center justify-center h-14 text-3xl select-none"
        style={{
          background: voiceRoomData.coverImageUrl
            ? `url(${voiceRoomData.coverImageUrl}) center/cover no-repeat`
            : isMe ? 'rgba(22,163,74,0.15)' : '#f3f0ff',
        }}
        onClick={handleJoin}
      >
        {!voiceRoomData.coverImageUrl && emoji}
      </div>

      {/* Info */}
      <div className="px-3 py-2">
        {/* Header row */}
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-purple-600">
            🎙️ Voice Club
          </span>
          {isLive && (
            <span className="flex items-center gap-0.5 text-[9px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
              LIVE
            </span>
          )}
        </div>

        {/* Title — server-provided, never client-supplied */}
        <p className={cn('text-sm font-semibold leading-tight truncate', isMe ? 'text-gray-900' : 'text-gray-900')}>
          {voiceRoomData.title}
        </p>

        {/* Privacy / status sub-line */}
        {voiceRoomData.privacy && (
          <p className="text-[10px] text-gray-400 mt-0.5">
            {voiceRoomData.privacy === 'PUBLIC' ? '🌍 Public' :
             voiceRoomData.privacy === 'PRIVATE' ? '🔒 Private' :
             voiceRoomData.privacy === 'INVITE_ONLY' ? '✉️ Invite Only' :
             voiceRoomData.privacy}
            {voiceRoomData.maxSpeakers ? ` · Up to ${voiceRoomData.maxSpeakers} speakers` : ''}
          </p>
        )}

        {/* Optional note from sender */}
        {body && (
          <p className={cn('mt-1.5 text-xs italic border-t pt-1.5', isMe ? 'text-gray-600 border-green-200/40' : 'text-gray-500 border-gray-100')}>
            {body}
          </p>
        )}

        {/* Join button */}
        <button
          onClick={handleJoin}
          className={cn(
            'mt-2 w-full py-1.5 rounded-lg text-xs font-bold transition-colors',
            isLive
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'bg-purple-600 hover:bg-purple-700 text-white'
          )}
        >
          {isLive ? '🔴 Join Live Room' : '🎙️ Open Voice Club'}
        </button>
      </div>
    </div>
  )
}
