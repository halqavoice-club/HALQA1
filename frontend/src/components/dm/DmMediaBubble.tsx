'use client'

/**
 * DmMediaBubble — renders the content area of a DM message bubble.
 *
 * Handles all message types:
 *   TEXT   — plain text
 *   IMAGE  — inline photo with lightbox trigger
 *   VIDEO  — HTML5 video player
 *   GIF    — animated image (rendered same as IMAGE)
 *   VOICE  — waveform + duration + play/pause audio
 *   AUDIO  — audio file with player bar
 *   FILE   — download card with filename + size
 *
 * Used by both the DM page Bubble component and any future media gallery.
 */

import { useState, useRef, useCallback } from 'react'
import { Paperclip, Play, Pause, Download, Volume2, FileText, FileSpreadsheet, FileVideo } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getFileUrl } from '@/lib/avatar'
import type { DmMessage } from '@/store/dm.store'
import { VoiceRoomShareCard } from '@/components/chat/VoiceRoomShareCard'

interface Props {
  msg: DmMessage
  isMe: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtBytes(bytes: number | null | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function fmtDuration(secs: number | null | undefined): string {
  if (!secs) return '0:00'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function fileIcon(mimeType: string | null) {
  if (!mimeType) return Paperclip
  if (mimeType.startsWith('video/')) return FileVideo
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return FileSpreadsheet
  if (mimeType.includes('pdf') || mimeType.includes('word') || mimeType.includes('document')) return FileText
  return Paperclip
}

// ─── Audio player ──────────────────────────────────────────────────────────────
function AudioPlayer({ url, duration, isMe, isVoice }: {
  url: string; duration: number | null; isMe: boolean; isVoice?: boolean
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
    <div className={cn('flex items-center gap-2 min-w-[180px] max-w-[240px]', isMe ? 'flex-row-reverse' : 'flex-row')}>
      <audio ref={audioRef} src={url} onTimeUpdate={onTimeUpdate} onEnded={onEnded} preload="metadata" />

      {/* Play/Pause */}
      <button
        onClick={toggle}
        className={cn(
          'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors',
          isMe ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
        )}>
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>

      {/* Waveform / progress bar */}
      <div className="flex-1 flex flex-col gap-1">
        <div className={cn('h-1.5 rounded-full overflow-hidden', isMe ? 'bg-green-200' : 'bg-gray-200')}>
          <div
            className={cn('h-full rounded-full transition-all', isMe ? 'bg-green-700' : 'bg-gray-500')}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className={cn('flex items-center justify-between text-[10px]', isMe ? 'text-green-700' : 'text-gray-400')}>
          <span>{isVoice ? '🎤' : <Volume2 className="w-3 h-3 inline" />}</span>
          <span>{fmtDuration(playing || current > 0 ? current : total)}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────
export function DmMediaBubble({ msg, isMe }: Props) {
  const [lightbox, setLightbox] = useState(false)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const { msgType = 'TEXT', mimeType, fileSize, fileName, duration, body } = msg
  // Always resolve mediaUrl through getFileUrl so relative backend paths
  // (/uploads/media/…) are prefixed with the backend origin (localhost:5000).
  const mediaUrl = getFileUrl(msg.mediaUrl)
  const thumbUrl = getFileUrl(msg.thumbnail)

  // Phase 5: VOICE_ROOM_SHARE — render structured Voice Club card using server-authoritative data
  if (msgType === 'VOICE_ROOM_SHARE') {
    return (
      <VoiceRoomShareCard
        refEntityId={(msg as any).refEntityId}
        voiceRoomData={(msg as any).voiceRoomData}
        body={body}
        isMe={isMe}
      />
    )
  }

  // Legacy: if msgType is TEXT but body looks like a URL, render as link
  if (msgType === 'TEXT' || !msgType) {
    if (!body) return null
    const isUrl = (body.startsWith('http') || body.startsWith('/uploads')) && !body.includes(' ')
    const resolvedBody = isUrl ? (getFileUrl(body) || body) : body
    const isImg = isUrl && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(body)
    if (isImg) return (
      <>
        <img
          src={resolvedBody} alt="image" loading="lazy"
          className="max-w-[220px] rounded-xl cursor-pointer object-cover"
          onClick={() => setLightbox(true)}
        />
        {lightbox && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setLightbox(false)}>
            <img src={resolvedBody} alt="" className="max-h-[90vh] max-w-[90vw] rounded-xl" />
          </div>
        )}
      </>
    )
    if (isUrl) return (
      <a href={resolvedBody} target="_blank" rel="noopener noreferrer"
        className={cn('flex items-center gap-1.5 text-xs underline', isMe ? 'text-green-200' : 'text-teal-600')}>
        <Paperclip className="w-3 h-3 flex-shrink-0" />
        {body.split('/').pop()}
      </a>
    )
    return <span className="break-words whitespace-pre-wrap">{body}</span>
  }

  switch (msgType) {
    case 'IMAGE':
    case 'GIF':
      if (!mediaUrl) return null
      return (
        <>
          <img
            src={mediaUrl} alt={fileName || 'image'} loading="lazy"
            className="max-w-[260px] rounded-xl cursor-pointer block"
            style={{ maxHeight: 360, width: 'auto', height: 'auto' }}
            onClick={() => setLightbox(true)}
          />
          {msgType === 'GIF' && (
            <span className="text-[10px] font-bold text-gray-400 mt-0.5 block">GIF</span>
          )}
          {lightbox && (
            <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
              onClick={() => setLightbox(false)}>
              <img src={mediaUrl} alt="" className="max-h-[90vh] max-w-[90vw] rounded-xl" style={{ objectFit: 'contain' }} />
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
            poster={thumbUrl ?? undefined}
            className="rounded-xl w-full"
            style={{ maxHeight: 280, backgroundColor: '#000' }}
            controls
            controlsList="nodownload"
            preload="metadata"
            onPlay={() => setVideoPlaying(true)}
            onPause={() => setVideoPlaying(false)}
          />
          {/* Download + duration overlay */}
          <div className="absolute top-2 right-2 flex items-center gap-1">
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
            <p className="text-[10px] text-gray-400 mt-0.5 truncate max-w-[260px]">{fileName}</p>
          )}
        </div>
      )

    case 'AUDIO':
      if (!mediaUrl) return null
      return (
        <div className="min-w-[200px]">
          {fileName && <p className="text-[11px] text-gray-400 mb-1 truncate max-w-[240px]">{fileName}</p>}
          <AudioPlayer url={mediaUrl} duration={duration} isMe={isMe} />
          <a
            href={mediaUrl}
            download={fileName || 'audio'}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'flex items-center gap-1.5 mt-1.5 text-[10px] font-medium transition-colors',
              isMe ? 'text-green-700 hover:text-green-800' : 'text-gray-400 hover:text-gray-600'
            )}
          >
            <Download className="w-3 h-3 flex-shrink-0" />
            Save audio
          </a>
        </div>
      )

    case 'VOICE':
      if (!mediaUrl) return null
      return (
        <div>
          <AudioPlayer url={mediaUrl} duration={duration} isMe={isMe} isVoice />
          <a
            href={mediaUrl}
            download={fileName || 'voice-message'}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'flex items-center gap-1.5 mt-1.5 text-[10px] font-medium transition-colors',
              isMe ? 'text-green-700 hover:text-green-800' : 'text-gray-400 hover:text-gray-600'
            )}
          >
            <Download className="w-3 h-3 flex-shrink-0" />
            Save voice message
          </a>
        </div>
      )

    case 'FILE': {
      if (!mediaUrl) return null
      const Icon = fileIcon(mimeType)
      return (
        <a
          href={mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          download={fileName || true}
          className={cn(
            'flex items-center gap-2.5 px-3 py-2.5 rounded-xl min-w-[160px] max-w-[220px] transition-colors',
            isMe ? 'bg-green-600/20 hover:bg-green-600/30' : 'bg-gray-100 hover:bg-gray-200'
          )}
        >
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
            isMe ? 'bg-green-600 text-white' : 'bg-gray-300 text-gray-700'
          )}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className={cn('text-xs font-semibold truncate', isMe ? 'text-gray-900' : 'text-gray-800')}>
              {fileName || 'File'}
            </p>
            <p className={cn('text-[10px]', isMe ? 'text-gray-500' : 'text-gray-400')}>
              {fmtBytes(fileSize)}
            </p>
          </div>
          <Download className={cn('w-4 h-4 flex-shrink-0', isMe ? 'text-gray-500' : 'text-gray-400')} />
        </a>
      )
    }

    default:
      return body ? <span className="break-words whitespace-pre-wrap">{body}</span> : null
  }
}
