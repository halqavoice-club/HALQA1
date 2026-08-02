'use client'

import { VoiceRoom } from '@/store/voice.store'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Loader2, Mic, Users, Lock, UserCheck, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getAvatarUrl, getFileUrl } from '@/lib/avatar'

interface Props {
  room: VoiceRoom
  onJoin: () => void
  isJoining: boolean
  currentUserId: string
}

const PRIVACY_ICONS = {
  PUBLIC: Globe,
  PRIVATE: Lock,
  INVITE_ONLY: UserCheck
}

const PRIVACY_COLORS = {
  PUBLIC: 'bg-green-100 text-green-700',
  PRIVATE: 'bg-orange-100 text-orange-700',
  INVITE_ONLY: 'bg-blue-100 text-blue-700'
}

export function VoiceRoomCard({ room, onJoin, isJoining, currentUserId }: Props) {
  const PrivacyIcon = PRIVACY_ICONS[room.privacy]
  const speakers = room.participants?.filter(p => p.role === 'HOST' || p.role === 'MODERATOR' || p.role === 'SPEAKER') || []
  const audienceCount = (room._count?.participants || 0) - speakers.length
  const isHost = room.hostId === currentUserId
  const isInRoom = room.participants?.some(p => p.userId === currentUserId && p.isActive)

  return (
    <div
      className="bg-white rounded-2xl border border-purple-100 p-5 hover:shadow-md transition-all cursor-pointer group"
      onClick={onJoin}
    >
      {/* Top row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {/* Cover image or emoji */}
          {room.coverImageUrl ? (
            <img
              src={getFileUrl(room.coverImageUrl)}
              alt=""
              className="w-10 h-10 rounded-xl object-cover flex-shrink-0 border border-purple-100"
            />
          ) : (
            <span className="text-2xl flex-shrink-0">{room.coverEmoji || '🎙️'}</span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="font-semibold text-gray-900 text-sm leading-tight line-clamp-1">{room.title}</h3>
              {room.status === 'LIVE' && (
                <span className="flex-shrink-0 flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  LIVE
                </span>
              )}
              {room.status === 'IDLE' && (
                <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                  IDLE
                </span>
              )}
              {room.status === 'SCHEDULED' && (
                <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 border border-blue-200">
                  SCHEDULED
                </span>
              )}
            </div>
            {room.topic && (
              <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{room.topic}</p>
            )}
          </div>
        </div>
        <div className={cn('flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ml-2', PRIVACY_COLORS[room.privacy])}>
          <PrivacyIcon className="w-3 h-3" />
          <span className="hidden sm:inline">{room.privacy.replace('_', ' ')}</span>
        </div>
      </div>

      {/* Speakers avatars */}
      {speakers.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-gray-400 mb-1.5 font-medium">On stage</p>
          <div className="flex flex-wrap gap-2">
            {speakers.slice(0, 6).map(p => (
              <div key={p.userId} className="flex flex-col items-center gap-1">
                <div className="relative">
                  <Avatar className="w-9 h-9">
                    <AvatarImage src={getAvatarUrl(p.user.avatarUrl)} />
                    <AvatarFallback className="bg-purple-100 text-purple-700 text-xs font-bold">
                      {p.user.firstName[0]}{p.user.lastName[0]}
                    </AvatarFallback>
                  </Avatar>
                  {!p.isMuted && (
                    <span className="absolute inset-0 rounded-full ring-2 ring-purple-400 animate-pulse" />
                  )}
                  {p.isMuted && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-gray-400 rounded-full flex items-center justify-center">
                      <Mic className="w-2 h-2 text-white" />
                    </span>
                  )}
                  {p.role === 'HOST' && (
                    <span className="absolute -top-1 -right-1 text-[10px]">👑</span>
                  )}
                </div>
                <span className="text-[9px] text-gray-500 max-w-[36px] truncate text-center">
                  {p.user.firstName}
                </span>
              </div>
            ))}
            {speakers.length > 6 && (
              <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-xs text-gray-500 font-medium">
                +{speakers.length - 6}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty stage hint */}
      {speakers.length === 0 && (
        <p className="text-xs text-gray-400 mb-3 italic">💤 No one on stage yet — be the first</p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <Mic className="w-3 h-3" />
            {speakers.length}
          </span>
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            {audienceCount > 0 ? audienceCount : 0} listening
          </span>
          {/* Room level badge */}
          <span className="font-bold text-purple-600" style={{ fontSize: 9 }}>
            Lv{room.roomLevel ?? 1}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Members page link */}
          <a
            href={`/voice-club/${room.id}/members`}
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-semibold bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors"
            title="View members"
          >
            <Users className="w-3 h-3" />
            Members
          </a>

          <button
            onClick={(e) => { e.stopPropagation(); onJoin() }}
            disabled={isJoining}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all',
              isInRoom
                ? 'bg-purple-100 text-purple-700'
                : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:opacity-90 shadow-sm'
            )}
          >
            {isJoining ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mic className="w-3 h-3" />}
            {isInRoom ? 'Rejoin' : isHost ? 'My Room' : 'Join'}
          </button>
        </div>
      </div>
    </div>
  )
}
