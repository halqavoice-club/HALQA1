'use client'
/**
 * VoiceCircleCard — Instagram-Stories-style circle card for a live voice room.
 *
 * Layout:
 *   ┌─────────────────┐
 *   │  [animated ring] │
 *   │    [circle]      │  ← cover emoji or cover image
 *   │   🔴 LIVE badge  │
 *   │  Room title      │
 *   │  N 🎙️ listeners  │
 *   └─────────────────┘
 *
 * Clicking navigates to /voice-club and opens that room.
 */
import { useRouter } from 'next/navigation'
import { getAvatarUrl } from '@/lib/avatar'
import { cn } from '@/lib/utils'
import { Users } from 'lucide-react'

export interface VoiceCircleData {
  id:              string
  title:           string
  coverEmoji?:     string | null
  coverImageUrl?:  string | null
  participantCount: number
  host?: {
    firstName: string
    lastName:  string
    avatarUrl: string | null
  } | null
}

interface Props {
  room:             VoiceCircleData
  participantCount?: number  // real-time override
}

export function VoiceCircleCard({ room, participantCount }: Props) {
  const router = useRouter()
  const count  = participantCount ?? room.participantCount ?? 0
  const avSrc  = room.coverImageUrl ? getAvatarUrl(room.coverImageUrl) : null

  return (
    <button
      onClick={() => router.push(`/voice-club`)}
      className="flex flex-col items-center gap-1.5 w-[72px] flex-shrink-0 group"
      title={room.title}
    >
      {/* Animated purple ring + circle */}
      <div className="relative">
        {/* Outer animated gradient ring */}
        <div className={cn(
          'w-[64px] h-[64px] rounded-full p-[2.5px]',
          'bg-gradient-to-tr from-purple-500 via-pink-500 to-purple-400',
          'animate-[spin_3s_linear_infinite]',
          // pause animation on hover for better UX
          'group-hover:animate-none group-hover:ring-4 group-hover:ring-purple-400'
        )}>
          <div className="w-full h-full rounded-full overflow-hidden bg-white p-[2px]">
            {avSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avSrc}
                alt={room.title}
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              <div className="w-full h-full rounded-full bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center text-2xl leading-none">
                {room.coverEmoji ?? '🎙️'}
              </div>
            )}
          </div>
        </div>

        {/* LIVE badge */}
        <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full leading-none whitespace-nowrap flex items-center gap-0.5">
          <span className="w-1 h-1 bg-white rounded-full inline-block" />
          LIVE
        </span>
      </div>

      {/* Room title */}
      <span className="text-[11px] font-semibold text-gray-700 text-center leading-tight line-clamp-2 max-w-full">
        {room.title}
      </span>

      {/* Listener count */}
      {count > 0 && (
        <span className="text-[10px] text-gray-400 flex items-center gap-0.5 leading-none">
          <Users className="w-2.5 h-2.5" />
          {count}
        </span>
      )}
    </button>
  )
}
