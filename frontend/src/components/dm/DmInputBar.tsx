'use client'

/**
 * DmInputBar — full-featured input toolbar for DM messages.
 *
 * Supports:
 *  - Text input (Enter to send, Shift+Enter for newline)
 *  - Photo / Video / GIF attach (file picker)
 *  - Audio file attach
 *  - Document / File attach
 *  - Voice message recording (MediaRecorder)
 *  - Upload progress indicator
 *  - Cancel upload / cancel recording
 *  - Reply-to preview
 *  - Edit-mode banner
 *  - Typing emit
 */

import { useState, useRef, useCallback, type ChangeEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send, Mic, Paperclip, Image as ImageIcon, FileText,
  Music, X, Loader2, Pencil,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDmUpload, mimeToMsgType } from '@/hooks/useDmUpload'
import { useDmVoiceRecorder } from '@/hooks/useDmVoiceRecorder'
import type { DmMessage } from '@/store/dm.store'
import type { SendMessagePayload } from '@/lib/dm'

interface Props {
  convId: string | null
  replyTo: DmMessage | null
  editingMsg: DmMessage | null
  onSendText: (body: string, replyToId?: string) => Promise<void>
  onSendMedia: (payload: SendMessagePayload) => Promise<void>
  onTyping: () => void
  onClearReply: () => void
  onCancelEdit: () => void
  sending: boolean
  // WhatsApp color constants passed in so this component is theme-agnostic
  accentColor?: string
}

const WA_GREEN = '#25d366'
const WA_DARK  = '#128c7e'

function fmtDur(s: number) {
  const m = Math.floor(s / 60), sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export function DmInputBar({
  convId, replyTo, editingMsg,
  onSendText, onSendMedia, onTyping,
  onClearReply, onCancelEdit,
  sending,
  accentColor = WA_GREEN,
}: Props) {
  const [text, setText] = useState('')
  const inputRef      = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef  = useRef<HTMLInputElement>(null)
  const [showAttachMenu, setShowAttachMenu] = useState(false)

  const { state: uploadState, upload, cancel: cancelUpload } = useDmUpload()
  const { state: voiceState, audioBlob, start: startRec, stop: stopRec, cancel: cancelRec, reset: resetRec } = useDmVoiceRecorder()

  // ── Send text ────────────────────────────────────────────────────────────────
  const handleSendText = useCallback(async () => {
    if (!text.trim() || !convId || sending) return
    const body = text.trim()
    setText('')
    await onSendText(body, replyTo?.id)
    inputRef.current?.focus()
  }, [text, convId, sending, replyTo, onSendText])

  // ── Upload + send media ──────────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    if (!convId) return
    setShowAttachMenu(false)
    const result = await upload(file)
    if (!result) return
    await onSendMedia({
      msgType:  result.msgType,
      mediaUrl: result.mediaUrl,
      mimeType: result.mimeType,
      fileSize: result.fileSize,
      fileName: result.fileName,
      duration: result.duration,
      width:    result.width,
      height:   result.height,
    })
  }, [convId, upload, onSendMedia])

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
    e.target.value = ''
  }

  // ── Voice recording flow ─────────────────────────────────────────────────────
  const handleVoiceToggle = useCallback(async () => {
    if (voiceState.status === 'recording') {
      stopRec()
    } else if (voiceState.status === 'idle' || voiceState.status === 'error') {
      await startRec()
    }
  }, [voiceState.status, startRec, stopRec])

  // When recording stops and blob is ready, send it
  const sendVoice = useCallback(async () => {
    if (!audioBlob || !convId) return
    const file = new File([audioBlob], `voice-${Date.now()}.webm`, { type: audioBlob.type })
    const result = await upload(file)
    if (!result) return
    await onSendMedia({
      msgType:  'VOICE',
      mediaUrl: result.mediaUrl,
      mimeType: result.mimeType,
      fileSize: result.fileSize,
      fileName: result.fileName,
      duration: voiceState.duration,
    })
    resetRec()
  }, [audioBlob, convId, voiceState.duration, upload, onSendMedia, resetRec])

  const isRecording = voiceState.status === 'recording'
  const voiceReady  = voiceState.status === 'stopped' && !!audioBlob
  const isUploading = uploadState.uploading
  const canSend = (text.trim() || editingMsg) && !isUploading && !isRecording

  return (
    <div className="flex-shrink-0" style={{ backgroundColor: '#f0f2f5' }}>
      {/* Reply-to preview */}
      <AnimatePresence>
        {replyTo && !editingMsg && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="flex items-center gap-3 px-4 py-2 border-t border-gray-200"
            style={{ backgroundColor: '#f0f2f5' }}
          >
            <div className="w-0.5 h-9 rounded-full flex-shrink-0" style={{ backgroundColor: WA_DARK }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: WA_DARK }}>
                {replyTo.sender.firstName}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {replyTo.body || (replyTo.msgType !== 'TEXT' ? `📎 ${replyTo.msgType}` : '')}
              </p>
            </div>
            <button onClick={onClearReply} className="p-1 rounded-full hover:bg-gray-200 flex-shrink-0">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit-mode banner */}
      <AnimatePresence>
        {editingMsg && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="flex items-center gap-3 px-4 py-2 border-t border-gray-200"
            style={{ backgroundColor: '#f0fdf4' }}
          >
            <Pencil className="w-4 h-4 flex-shrink-0" style={{ color: WA_DARK }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold" style={{ color: WA_DARK }}>Editing</p>
              <p className="text-xs text-gray-500 truncate">{editingMsg.body}</p>
            </div>
            <button onClick={onCancelEdit} className="p-1 rounded-full hover:bg-gray-200 flex-shrink-0">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload progress */}
      {isUploading && (
        <div className="px-4 py-1.5 flex items-center gap-2 border-t border-gray-100">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
          <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-200"
              style={{ width: `${uploadState.progress}%`, backgroundColor: accentColor }} />
          </div>
          <span className="text-[10px] text-gray-400">{uploadState.progress}%</span>
          <button onClick={cancelUpload} className="p-1 text-gray-400 hover:text-red-400">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Voice recording state */}
      {isRecording && (
        <div className="px-4 py-2 flex items-center gap-3 border-t border-gray-100" style={{ backgroundColor: '#fff7f7' }}>
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-sm font-medium text-red-600">{fmtDur(voiceState.duration)}</span>
          <span className="text-xs text-gray-400 flex-1">Recording…</span>
          <button onClick={cancelRec} className="p-1.5 rounded-full hover:bg-red-50 text-red-400">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Voice message ready to send */}
      {voiceReady && (
        <div className="px-4 py-2 flex items-center gap-3 border-t border-gray-100" style={{ backgroundColor: '#f0fdf4' }}>
          <Mic className="w-4 h-4 flex-shrink-0" style={{ color: WA_DARK }} />
          <span className="text-sm flex-1" style={{ color: WA_DARK }}>
            Voice message ({fmtDur(voiceState.duration)}) ready
          </span>
          <button onClick={cancelRec} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
          <button
            onClick={sendVoice}
            disabled={isUploading}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white"
            style={{ backgroundColor: accentColor }}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main input row */}
      {!isRecording && !voiceReady && (
        <div className="px-3 py-2 flex items-end gap-2">
          {/* Attach menu */}
          <div className="relative pb-1.5">
            {/* Hidden file inputs */}
            <input ref={imageInputRef} type="file" accept="image/*,image/gif,video/*" className="hidden"
              onChange={onFileChange} />
            <input ref={audioInputRef} type="file" accept="audio/*" className="hidden"
              onChange={onFileChange} />
            <input ref={fileInputRef} type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar,.7z,application/*"
              className="hidden" onChange={onFileChange} />

            <button
              onClick={() => setShowAttachMenu(v => !v)}
              className="w-9 h-9 rounded-full hover:bg-gray-200 flex items-center justify-center transition-colors"
            >
              <Paperclip className={cn('w-5 h-5 transition-transform', showAttachMenu && 'rotate-45')} style={{ color: '#9ca3af' }} />
            </button>

            <AnimatePresence>
              {showAttachMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.95 }}
                  className="absolute bottom-12 left-0 bg-white rounded-2xl shadow-xl border border-gray-100 p-2 flex flex-col gap-1 min-w-[160px] z-20"
                >
                  {[
                    { icon: ImageIcon, label: 'Photo / Video / GIF', ref: imageInputRef, color: '#8b5cf6' },
                    { icon: Music,     label: 'Audio file',           ref: audioInputRef, color: '#0891b2' },
                    { icon: FileText,  label: 'Document / File',      ref: fileInputRef,  color: '#059669' },
                  ].map(({ icon: Icon, label, ref, color }) => (
                    <button key={label}
                      onClick={() => { ref.current?.click(); setShowAttachMenu(false) }}
                      className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-50 rounded-xl text-left transition-colors"
                    >
                      <div className="w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: `${color}20` }}>
                        <Icon className="w-4 h-4" style={{ color }} />
                      </div>
                      <span className="text-sm text-gray-700">{label}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Text input */}
          <div className="flex-1 bg-white rounded-3xl px-4 py-2 shadow-sm">
            <input
              ref={inputRef}
              value={text}
              onChange={e => { setText(e.target.value); onTyping() }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendText() } }}
              placeholder={editingMsg ? 'Edit message…' : replyTo ? `Reply to ${replyTo.sender.firstName}…` : 'Type a message'}
              className="w-full text-sm outline-none bg-transparent placeholder:text-gray-400"
              autoFocus
            />
          </div>

          {/* Send or Mic */}
          <button
            onClick={canSend ? handleSendText : handleVoiceToggle}
            disabled={sending || isUploading}
            className="w-11 h-11 rounded-full flex items-center justify-center text-white shadow transition-all hover:scale-105 flex-shrink-0 disabled:opacity-50"
            style={{ backgroundColor: accentColor }}
            title={canSend ? 'Send' : 'Voice message'}
          >
            {sending || isUploading
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : canSend
                ? <Send className="w-5 h-5" />
                : <Mic className="w-5 h-5" />
            }
          </button>
        </div>
      )}
    </div>
  )
}
