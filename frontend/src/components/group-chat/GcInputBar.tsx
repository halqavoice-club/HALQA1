'use client'

/**
 * GcInputBar — full-featured input bar for Group Chat.
 * Mirrors DmInputBar: text, photo/video/GIF, audio, file, voice recording.
 * Uses the existing /upload endpoint + groupChatApi.send().
 */

import { useState, useRef, useCallback, type ChangeEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Mic, Paperclip, Image as ImageIcon, FileText, Music, X, Loader2, Pencil, Reply } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDmUpload } from '@/hooks/useDmUpload'
import { useDmVoiceRecorder } from '@/hooks/useDmVoiceRecorder'
import { groupChatApi } from '@/lib/groupChat'
import type { GcMessage } from '@/store/groupChat.store'

interface Props {
  convId: string | null
  replyTo: GcMessage | null
  editingMsg: GcMessage | null
  onSent: () => void           // called after send so parent can scroll / invalidate
  onTyping: () => void
  onClearReply: () => void
  onCancelEdit: () => void
  // BUG-7 FIX: Restriction-awareness — disables input when group restricts members
  isAdmin?: boolean
  onlyAdminsCanSendMessages?: boolean
  onlyAdminsCanSendMedia?: boolean
}

const TG_BLUE  = '#2AABEE'
const TG_DARK  = '#17212b'
const TG_PANEL = '#232e3c'

function fmtDur(s: number) {
  const m = Math.floor(s / 60), sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export function GcInputBar({
  convId, replyTo, editingMsg,
  onSent, onTyping, onClearReply, onCancelEdit,
  isAdmin = false,
  onlyAdminsCanSendMessages = false,
  onlyAdminsCanSendMedia = false,
}: Props) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const inputRef      = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef  = useRef<HTMLInputElement>(null)
  const [showAttach, setShowAttach] = useState(false)

  // BUG-7 FIX: Determine if this member is blocked from sending
  const msgRestricted   = onlyAdminsCanSendMessages && !isAdmin
  const mediaRestricted = onlyAdminsCanSendMedia && !isAdmin

  const { state: uploadState, upload, cancel: cancelUpload } = useDmUpload()
  const { state: voiceState, audioBlob, start: startRec, stop: stopRec, cancel: cancelRec, reset: resetRec } = useDmVoiceRecorder()

  const isRecording = voiceState.status === 'recording'
  const voiceReady  = voiceState.status === 'stopped' && !!audioBlob
  const isUploading = uploadState.uploading

  // ── Send text / edit ────────────────────────────────────────────────────────
  const handleSendText = useCallback(async () => {
    const body = text.trim()
    if (!body || !convId || sending) return
    setText('')
    setSending(true)
    try {
      if (editingMsg) {
        await groupChatApi.editMessage(editingMsg.id, body)
        onCancelEdit()
      } else {
        await groupChatApi.send(convId, { body, type: 'TEXT', replyToId: replyTo?.id })
        onClearReply()
      }
      onSent()
    } catch { /* toast handled by parent */ }
    finally { setSending(false); inputRef.current?.focus() }
  }, [text, convId, sending, editingMsg, replyTo, onSent, onCancelEdit, onClearReply])

  // ── Upload + send media ──────────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    if (!convId) return
    setShowAttach(false)
    const result = await upload(file)
    if (!result) return
    // Map DmMsgType → GroupMessageType string
    const typeMap: Record<string, string> = {
      IMAGE: 'IMAGE', VIDEO: 'VIDEO', GIF: 'GIF',
      AUDIO: 'AUDIO', VOICE: 'VOICE', FILE: 'FILE',
    }
    await groupChatApi.send(convId, {
      type:     typeMap[result.msgType] ?? 'FILE',
      mediaUrl: result.mediaUrl,
      mimeType: result.mimeType,
      fileSize: result.fileSize,
      fileName: result.fileName,
      duration: result.duration,
    })
    onSent()
  }, [convId, upload, onSent])

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
    e.target.value = ''
  }

  // ── Voice ────────────────────────────────────────────────────────────────────
  const handleVoiceToggle = useCallback(async () => {
    if (voiceState.status === 'recording') stopRec()
    else if (voiceState.status === 'idle' || voiceState.status === 'error') await startRec()
  }, [voiceState.status, startRec, stopRec])

  const sendVoice = useCallback(async () => {
    if (!audioBlob || !convId) return
    const file = new File([audioBlob], `voice-${Date.now()}.webm`, { type: audioBlob.type })
    const result = await upload(file)
    if (!result) return
    await groupChatApi.send(convId, {
      type: 'VOICE', mediaUrl: result.mediaUrl,
      mimeType: result.mimeType, fileSize: result.fileSize,
      fileName: result.fileName, duration: voiceState.duration,
    })
    resetRec()
    onSent()
  }, [audioBlob, convId, voiceState.duration, upload, onSent, resetRec])

  const canSend = (text.trim() || editingMsg) && !isUploading && !isRecording

  return (
    <div className="flex-shrink-0" style={{ backgroundColor: TG_PANEL }}>

      {/* BUG-7 FIX: Show restriction notice when member can't send */}
      {msgRestricted && (
        <div className="px-4 py-3 text-center text-sm" style={{ color: '#8e99a4', borderTop: `1px solid #0e1621` }}>
          🔒 Only admins can send messages in this group
        </div>
      )}

      {/* Reply preview */}
      <AnimatePresence>
        {replyTo && !editingMsg && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="flex items-center gap-3 px-4 py-2 border-t"
            style={{ borderColor: '#0e1621', backgroundColor: TG_PANEL }}>
            <div className="w-0.5 h-9 rounded-full flex-shrink-0" style={{ backgroundColor: TG_BLUE }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: TG_BLUE }}>{replyTo.sender?.firstName}</p>
              <p className="text-xs truncate" style={{ color: '#aab8c2' }}>
                {replyTo.body || (replyTo.type !== 'TEXT' ? `📎 ${replyTo.type}` : '')}
              </p>
            </div>
            <button onClick={onClearReply} className="p-1 rounded-full hover:opacity-70">
              <X className="w-4 h-4" style={{ color: '#8e99a4' }} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit banner */}
      <AnimatePresence>
        {editingMsg && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="flex items-center gap-3 px-4 py-2 border-t"
            style={{ borderColor: '#0e1621', backgroundColor: TG_PANEL }}>
            <Pencil className="w-4 h-4 flex-shrink-0" style={{ color: TG_BLUE }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold" style={{ color: TG_BLUE }}>Editing</p>
              <p className="text-xs truncate" style={{ color: '#aab8c2' }}>{editingMsg.body}</p>
            </div>
            <button onClick={onCancelEdit} className="p-1 rounded-full hover:opacity-70">
              <X className="w-4 h-4" style={{ color: '#8e99a4' }} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload progress */}
      {isUploading && (
        <div className="px-4 py-1.5 flex items-center gap-2 border-t" style={{ borderColor: '#0e1621' }}>
          <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: TG_BLUE }} />
          <div className="flex-1 h-1 rounded-full overflow-hidden bg-white/10">
            <div className="h-full rounded-full transition-all" style={{ width: `${uploadState.progress}%`, backgroundColor: TG_BLUE }} />
          </div>
          <span className="text-[10px]" style={{ color: '#8e99a4' }}>{uploadState.progress}%</span>
          <button onClick={cancelUpload} className="p-1 hover:opacity-70">
            <X className="w-3.5 h-3.5" style={{ color: '#8e99a4' }} />
          </button>
        </div>
      )}

      {/* Voice recording */}
      {isRecording && (
        <div className="px-4 py-2 flex items-center gap-3 border-t" style={{ borderColor: '#0e1621', backgroundColor: 'rgba(239,68,68,0.08)' }}>
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-sm font-medium text-red-400">{fmtDur(voiceState.duration)}</span>
          <span className="text-xs flex-1" style={{ color: '#8e99a4' }}>Recording…</span>
          <button onClick={cancelRec} className="p-1.5 rounded-full hover:opacity-70">
            <X className="w-4 h-4 text-red-400" />
          </button>
        </div>
      )}

      {/* Voice ready */}
      {voiceReady && (
        <div className="px-4 py-2 flex items-center gap-3 border-t" style={{ borderColor: '#0e1621', backgroundColor: 'rgba(42,171,238,0.08)' }}>
          <Mic className="w-4 h-4 flex-shrink-0" style={{ color: TG_BLUE }} />
          <span className="text-sm flex-1" style={{ color: TG_BLUE }}>Voice ({fmtDur(voiceState.duration)}) ready</span>
          <button onClick={cancelRec} className="p-1.5 rounded-full hover:opacity-70">
            <X className="w-4 h-4" style={{ color: '#8e99a4' }} />
          </button>
          <button onClick={sendVoice} disabled={isUploading}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white"
            style={{ backgroundColor: TG_BLUE }}>
            <Send className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main input row */}
      {!isRecording && !voiceReady && (
        <div className="px-3 py-2 flex items-end gap-2">
          {/* Hidden file inputs */}
          <input ref={imageInputRef} type="file" accept="image/*,image/gif,video/*" className="hidden" onChange={onFileChange} />
          <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={onFileChange} />
          <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar,application/*" className="hidden" onChange={onFileChange} />

          {/* Attach — hidden when media is restricted for this member */}
          {!mediaRestricted && (
          <div className="relative pb-1.5 flex-shrink-0">
            <button onClick={() => setShowAttach(v => !v)}
              className="w-9 h-9 rounded-full hover:opacity-70 flex items-center justify-center transition-opacity">
              <Paperclip className={cn('w-5 h-5 transition-transform', showAttach && 'rotate-45')} style={{ color: '#8e99a4' }} />
            </button>
            <AnimatePresence>
              {showAttach && (
                <motion.div initial={{ opacity: 0, y: 6, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.95 }}
                  className="absolute bottom-12 left-0 rounded-2xl shadow-xl p-2 flex flex-col gap-1 min-w-[160px] z-20"
                  style={{ backgroundColor: TG_PANEL, border: '1px solid #0e1621' }}>
                  {[
                    { icon: ImageIcon, label: 'Photo / Video / GIF', ref: imageInputRef, color: '#8b5cf6' },
                    { icon: Music,     label: 'Audio file',           ref: audioInputRef, color: '#0891b2' },
                    { icon: FileText,  label: 'Document / File',      ref: fileInputRef,  color: '#059669' },
                  ].map(({ icon: Icon, label, ref, color }) => (
                    <button key={label} onClick={() => { ref.current?.click(); setShowAttach(false) }}
                      className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left hover:opacity-80 transition-opacity">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${color}25` }}>
                        <Icon className="w-4 h-4" style={{ color }} />
                      </div>
                      <span className="text-sm" style={{ color: '#e8e8e8' }}>{label}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          )} {/* end !mediaRestricted */}

          {/* Text area — disabled when messaging is restricted for this member */}
          <div className="flex-1 rounded-2xl px-4 py-2" style={{ backgroundColor: TG_DARK }}>
            <textarea
              ref={inputRef}
              value={editingMsg && !text ? (editingMsg.body ?? '') : text}
              onChange={e => { setText(e.target.value); onTyping() }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!msgRestricted) handleSendText() } }}
              placeholder={msgRestricted ? 'Only admins can send messages' : editingMsg ? 'Edit message…' : replyTo ? `Reply to ${replyTo.sender?.firstName}…` : 'Message'}
              rows={1}
              disabled={msgRestricted}
              readOnly={msgRestricted}
              className="w-full text-sm resize-none outline-none bg-transparent max-h-32 placeholder:text-gray-500 disabled:cursor-not-allowed"
              style={{ color: msgRestricted ? '#6c8998' : '#e8e8e8' }}
            />
          </div>

          {/* Send or Mic — hidden when messaging is restricted */}
          {!msgRestricted && (
          <button
            onClick={canSend ? handleSendText : handleVoiceToggle}
            disabled={sending || isUploading}
            className="w-10 h-10 rounded-full flex items-center justify-center text-white transition-all hover:scale-105 disabled:opacity-50 flex-shrink-0"
            style={{ backgroundColor: TG_BLUE }}>
            {sending || isUploading
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : canSend ? <Send className="w-5 h-5" /> : <Mic className="w-5 h-5" />
            }
          </button>
          )} {/* end !msgRestricted */}
        </div>
      )}
    </div>
  )
}
