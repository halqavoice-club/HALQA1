'use client'

/**
 * GcMediaBubble — renders group chat message content for all media types.
 * Mirrors DmMediaBubble exactly but accepts GcMessage shape.
 *
 * TEXT | IMAGE | VIDEO | GIF | VOICE | AUDIO | FILE | DOCUMENT
 */

import { useState, useRef, useCallback } from 'react'
import { Paperclip, Play, Pause, Download, Volume2, FileText, FileSpreadsheet, FileVideo } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getFileUrl } from '@/lib/avatar'
import { VoiceRoomShareCard } from '@/components/chat/VoiceRoomShareCard'

export interface GcMsgMedia {
  body?: string | null
  type?: string
  mediaUrl?: string | null
  mimeType?: string | null
  fileSize?: number | null
  fileName?: string | null
  duration?: number | null
  // Phase 5: structured entity reference fields
  refEntityType?: string | null
  refEntityId?: string | null
  voiceRoomData?: {
    id: string
    title: string
    coverEmoji?: string | null
    coverImageUrl?: string | null
    privacy?: string | null
    status?: string | null
    hostId?: string | null
    maxSpeakers?: number | null
  } | null
}

interface Props {
  msg: GcMsgMedia
  isOwn: boolean
}

function fmtBytes(bytes?: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function fmtDuration(secs?: number | null): string {
  if (!secs) return '0:00'
  const m = Math.floor(secs / 60), s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function fileIcon(mime?: string | null) {
  if (!mime) return Paperclip
  if (mime.startsWith('video/')) return FileVideo
  if (mime.includes('spreadsheet') || mime.includes('excel')) return FileSpreadsheet
  if (mime.includes('pdf') || mime.includes('word') || mime.includes('document')) return FileText
  return Paperclip
}

function AudioPlayer({ url, duration, isOwn, isVoice }: {
  url: string; duration?: number | null; isOwn: boolean; isVoice?: boolean
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [total, setTotal] = useState(duration ?? 0)

  const toggle = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    if (playing) { el.pause(); setPlaying(false) }
    else { el.play(); setPlaying(true) }
  }, [playing])

  const onTimeUpdate = () => {
    const el = audioRef.current
    if (!el) return
    setCurrent(Math.floor(el.currentTime))
    if (el.duration && !duration) setTotal(Math.floor(el.duration))
  }
  const onEnded = () => { setPlaying(false); setCurrent(0) }
  const pct = total > 0 ? (current / total) * 100 : 0

  return (
    <div className={cn('flex items-center gap-2 min-w-[180px] max-w-[240px]', isOwn ? 'flex-row-reverse' : 'flex-row')}>
      <audio ref={audioRef} src={url} onTimeUpdate={onTimeUpdate} onEnded={onEnded} preload="metadata" />
      <button onClick={toggle}
        className={cn('w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
          isOwn ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-white/20 text-white hover:bg-white/30'
        )}>
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
      <div className="flex-1 flex flex-col gap-1">
        <div className="h-1.5 rounded-full overflow-hidden bg-white/20">
          <div className="h-full rounded-full bg-white/70 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between text-[10px] text-white/60">
          <span>{isVoice ? '🎤' : <Volume2 className="w-3 h-3 inline" />}</span>
          <span>{fmtDuration(playing || current > 0 ? current : total)}</span>
        </div>
      </div>
    </div>
  )
}

export function GcMediaBubble({ msg, isOwn }: Props) {
  const [lightbox, setLightbox] = useState(false)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const { type = 'TEXT', mimeType, fileSize, fileName, duration, body } = msg
  const mediaUrl = getFileUrl(msg.mediaUrl)

  // Phase 5: VOICE_ROOM_SHARE — render structured Voice Club card using server-authoritative data
  if (type === 'VOICE_ROOM_SHARE') {
    return (
      <VoiceRoomShareCard
        refEntityId={msg.refEntityId}
        voiceRoomData={msg.voiceRoomData}
        body={body}
        isMe={isOwn}
      />
    )
  }

  if (type === 'TEXT' || !type) {
    if (!body) return null
    return <span className="break-words whitespace-pre-wrap">{body}</span>
  }

  switch (type) {
    case 'IMAGE':
    case 'GIF':
      if (!mediaUrl) return null
      return (
        <>
          <img src={mediaUrl} alt={fileName || 'image'} loading="lazy"
            className="max-w-[220px] rounded-lg cursor-pointer object-cover"
            style={{ maxHeight: 200 }} onClick={() => setLightbox(true)} />
          {type === 'GIF' && <span className="text-[10px] font-bold text-white/50 mt-0.5 block">GIF</span>}
          {lightbox && (
            <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4"
              onClick={() => setLightbox(false)}>
              <img src={mediaUrl} alt="" className="max-h-[90vh] max-w-[90vw] rounded-xl" />
            </div>
          )}
        </>
      )

    case 'VIDEO':
      if (!mediaUrl) return null
      return (
        <div className="relative max-w-[280px]">
          <video
            ref={videoRef}
            src={mediaUrl}
            className="rounded-lg w-full"
            style={{ maxHeight: 280, backgroundColor: '#000' }}
            controls
            controlsList="nodownload"
            preload="metadata"
            onPlay={() => setVideoPlaying(true)}
            onPause={() => setVideoPlaying(false)}
          />
          <div className="absolute top-2 right-2">
            <a
              href={mediaUrl}
              download={fileName || 'video'}
              target="_blank"
              rel="noopener noreferrer"
              className="w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center transition-colors"
              onClick={e => e.stopPropagation()}
            >
              <Download className="w-3.5 h-3.5 text-white" />
            </a>
          </div>
          {duration && !videoPlaying && (
            <span className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
              {fmtDuration(duration)}
            </span>
          )}
          {fileName && (
            <p className="text-[10px] text-white/50 mt-0.5 truncate max-w-[260px]">{fileName}</p>
          )}
        </div>
      )

    case 'VOICE':
      if (!mediaUrl) return null
      return (
        <div>
          <AudioPlayer url={mediaUrl} duration={duration} isOwn={isOwn} isVoice />
          <a
            href={mediaUrl}
            download={fileName || 'voice-message'}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 mt-1.5 text-[10px] font-medium text-white/50 hover:text-white/80 transition-colors"
          >
            <Download className="w-3 h-3 flex-shrink-0" />
            Save voice message
          </a>
        </div>
      )

    case 'AUDIO':
      if (!mediaUrl) return null
      return (
        <div className="min-w-[200px]">
          {fileName && <p className="text-[11px] text-white/50 mb-1 truncate max-w-[240px]">{fileName}</p>}
          <AudioPlayer url={mediaUrl} duration={duration} isOwn={isOwn} />
          <a
            href={mediaUrl}
            download={fileName || 'audio'}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 mt-1.5 text-[10px] font-medium text-white/50 hover:text-white/80 transition-colors"
          >
            <Download className="w-3 h-3 flex-shrink-0" />
            Save audio
          </a>
        </div>
      )

    case 'FILE':
    case 'DOCUMENT': {
      if (!mediaUrl) return null
      const Icon = fileIcon(mimeType)
      return (
        <a href={mediaUrl} target="_blank" rel="noopener noreferrer" download={fileName || true}
          className={cn(
            'flex items-center gap-2.5 px-3 py-2.5 rounded-xl min-w-[160px] max-w-[220px] transition-colors',
            isOwn ? 'bg-white/10 hover:bg-white/20' : 'bg-white/10 hover:bg-white/20'
          )}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/20">
            <Icon className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold truncate text-white">{fileName || 'File'}</p>
            <p className="text-[10px] text-white/50">{fmtBytes(fileSize)}</p>
          </div>
          <Download className="w-4 h-4 flex-shrink-0 text-white/50" />
        </a>
      )
    }

    default:
      return body ? <span className="break-words whitespace-pre-wrap">{body}</span> : null
  }
}
