'use client'
/**
 * LiveCard v2
 *
 * Voice Club card:
 *   ┌──────────────────────────────────────────┐
 *   │  🎙️ Voice Club           ● LIVE          │
 *   │                                          │
 *   │      ┌──────────────┐                    │
 *   │      │  [profile    │  Room Title        │
 *   │      │   circle]    │  description       │
 *   │      └──────────────┘                    │
 *   │   Host Name  ·  12 🎙️         [Join →]   │
 *   └──────────────────────────────────────────┘
 *
 * Live Class card — same card without large circle (uses cover emoji instead).
 */
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { getAvatarUrl } from '@/lib/avatar'
import { Users, Mic, Video, ArrowRight } from 'lucide-react'
import type { Post } from '@/lib/posts'

interface Props {
  post:             Post
  liveParticipants?: number
}

export function LiveCard({ post, liveParticipants }: Props) {
  const router   = useRouter()
  const liveData = post.liveData
  if (!liveData) return null

  const isVoice = post.type === 'LIVE_ROOM_SHARE'
  const count   = liveParticipants ?? liveData.participantCount ?? 0
  const avatarSrc = getAvatarUrl(post.author?.avatarUrl)
  const initials  = post.author
    ? `${post.author.firstName?.[0] ?? ''}${post.author.lastName?.[0] ?? ''}`
    : '?'

  const handleJoin = () => {
    if (isVoice) router.push(`/voice-club/${post.refEntityId}`)
    else         router.push(`/live-class/${post.refEntityId}`)
  }

  return (
    <div
      onClick={handleJoin}
      className={cn(
        'relative rounded-2xl border overflow-hidden cursor-pointer group transition-all select-none',
        'hover:shadow-lg hover:-translate-y-0.5',
        isVoice
          ? 'bg-gradient-to-br from-purple-600 via-purple-700 to-pink-700 border-purple-500'
          : 'bg-gradient-to-br from-red-600 via-red-700 to-rose-800 border-red-500'
      )}
    >
      {/* Background cover image (low opacity) */}
      {liveData.coverImageUrl && !isVoice && (
        <img
          src={liveData.coverImageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none"
        />
      )}

      {/* LIVE pulse — top right */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
        </span>
        <span className="text-white text-[11px] font-black tracking-widest uppercase">Live</span>
      </div>

      <div className="relative p-4">
        {/* Type badge */}
        <div className="flex items-center gap-2 mb-3">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-white/20 text-white">
            {isVoice
              ? <><Mic className="w-3 h-3" /> Voice Club</>
              : <><Video className="w-3 h-3" /> Live Class</>
            }
          </span>
          {liveData.className && (
            <span className="text-white/70 text-xs truncate">{liveData.className}</span>
          )}
        </div>

        {isVoice ? (
          /* ── VOICE CLUB — room cover circle (emoji or image) ──────────── */
          <div className="flex items-center gap-4 mb-4">
            {/* Room identity circle — shows coverImageUrl or coverEmoji */}
            <div className="relative flex-shrink-0">
              <div className="w-16 h-16 rounded-full ring-2 ring-white/60 ring-offset-2 ring-offset-purple-700 overflow-hidden bg-white/20 flex items-center justify-center">
                {liveData.coverImageUrl
                  ? <img src={liveData.coverImageUrl} alt="" className="w-full h-full object-cover" />
                  : (
                    <span className="text-3xl leading-none select-none">
                      {liveData.coverEmoji ?? '🎙️'}
                    </span>
                  )
                }
              </div>
            </div>

            {/* Room info beside circle */}
            <div className="flex-1 min-w-0">
              <h3 className="text-white font-bold text-sm leading-tight truncate">
                {liveData.title}
              </h3>
              {liveData.description && (
                <p className="text-white/70 text-xs mt-0.5 line-clamp-2 leading-relaxed">
                  {liveData.description}
                </p>
              )}
            </div>
          </div>
        ) : (
          /* ── LIVE CLASS — cover emoji in a styled circle ───────────────── */
          <div className="flex items-start gap-4 mb-4">
            {/* Red-tinted circle with emoji */}
            <div className="w-16 h-16 rounded-full ring-2 ring-white/60 ring-offset-2 ring-offset-red-700 bg-white/20 flex items-center justify-center flex-shrink-0">
              <span className="text-3xl leading-none select-none">
                {liveData.coverEmoji ?? '📹'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-white font-bold text-base leading-tight truncate">
                {liveData.title}
              </h3>
              {liveData.description && (
                <p className="text-white/70 text-xs mt-0.5 line-clamp-1">
                  {liveData.description}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Footer: host name · count · join */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-white/80 text-xs truncate max-w-[130px]">
              {post.author?.firstName} {post.author?.lastName}
            </span>
            {count > 0 && (
              <>
                <span className="text-white/40 text-xs flex-shrink-0">·</span>
                <span className="text-white/80 text-xs flex items-center gap-1 flex-shrink-0">
                  <Users className="w-3 h-3" />
                  {count.toLocaleString()}
                </span>
              </>
            )}
          </div>

          <button
            onClick={e => { e.stopPropagation(); handleJoin() }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-gray-900 hover:bg-gray-100 transition-colors flex-shrink-0 ml-2"
          >
            Join <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  )
}
