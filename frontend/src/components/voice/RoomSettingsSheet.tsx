'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useVoiceStore, VoiceRoom } from '@/store/voice.store'
import { useAuthStore } from '@/store/auth.store'
import { getAvatarUrl, getFileUrl } from '@/lib/avatar'
import { cn } from '@/lib/utils'
import api from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { useQuery } from '@tanstack/react-query'
import {
  Users, Mic, MessageSquare,
  MessageCircle, ClipboardList, ChevronRight, X,
  Check, UserMinus, Camera, Upload, Trash2, Image,
  Music, Play, Pause, SkipForward, Volume2, StopCircle, Search,
} from 'lucide-react'
import { RoomMembersPanel } from './RoomMembersPanel'

interface Props {
  open: boolean
  onClose: () => void
  isHost: boolean
  amModerating: boolean
  onMuteAll?: () => void
  onUnmuteAll?: () => void
  onToggleOpenMic?: (enabled?: boolean) => void
  onToggleMicLock?: (locked?: boolean) => void
  isOpenMic?: boolean
  micLocked?: boolean
}

// ─── Sub-panel: Avatar (Room Cover Image) ────────────────────────────────────
function AvatarPanel({ onBack }: { onBack: () => void }) {
  const { activeRoom, updateRoom } = useVoiceStore()
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [preview, setPreview]   = useState<string | null>(null)
  const [file, setFile]         = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving]  = useState(false)

  // Build current image URL
  const currentImage = activeRoom?.coverImageUrl
    ? getFileUrl(activeRoom.coverImageUrl)
    : null

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 2 * 1024 * 1024) {
      toast({ title: 'Image must be under 2 MB', variant: 'destructive' })
      return
    }
    setFile(f)
    const reader = new FileReader()
    reader.onload = ev => setPreview(ev.target?.result as string)
    reader.readAsDataURL(f)
  }

  const handleUpload = async () => {
    if (!file || !activeRoom) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('cover', file)
      // Do NOT set Content-Type manually — let the browser/axios set it
      // automatically with the correct multipart boundary.
      const res = await api.post(`/voice/${activeRoom.id}/cover`, form)
      updateRoom({ coverImageUrl: res.data.data.coverImageUrl })
      setPreview(null)
      setFile(null)
      toast({ title: '🖼️ Room image updated!' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Upload failed', variant: 'destructive' })
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = async () => {
    if (!activeRoom) return
    setRemoving(true)
    try {
      await api.patch(`/voice/${activeRoom.id}`, { coverImageUrl: null })
      updateRoom({ coverImageUrl: null })
      setPreview(null)
      setFile(null)
      toast({ title: 'Room image removed' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
    } finally {
      setRemoving(false)
    }
  }

  const displaySrc = preview || currentImage

  return (
    <div className="rs-panel">
      <div className="rs-panel-header">
        <button className="rs-back" onClick={onBack}>←</button>
        <h3 className="rs-panel-title">Room Avatar</h3>
      </div>

      <div className="rs-avatar-body">
        {/* Preview circle */}
        <div className="rs-avatar-preview-wrap">
          <div className="rs-avatar-preview">
            {displaySrc ? (
              <img src={displaySrc} alt="Room cover" className="rs-avatar-img" />
            ) : (
              <span className="rs-avatar-emoji">{activeRoom?.coverEmoji || '🎙️'}</span>
            )}
            {/* Camera overlay */}
            <button
              className="rs-avatar-camera"
              onClick={() => fileRef.current?.click()}
              title="Change image"
            >
              <Camera className="w-5 h-5" />
            </button>
          </div>
          {preview && (
            <p className="rs-avatar-hint">Preview — tap Save to apply</p>
          )}
        </div>

        {/* Hidden file input */}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Action buttons */}
        <div className="rs-avatar-actions">
          <button
            className="rs-avatar-btn outline"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="w-4 h-4" />
            {currentImage || preview ? 'Change Image' : 'Upload Image'}
          </button>

          {preview && (
            <button
              className="rs-avatar-btn primary"
              onClick={handleUpload}
              disabled={uploading}
            >
              {uploading ? (
                <span className="rs-spinner" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {uploading ? 'Saving…' : 'Save'}
            </button>
          )}

          {currentImage && !preview && (
            <button
              className="rs-avatar-btn danger"
              onClick={handleRemove}
              disabled={removing}
            >
              {removing ? <span className="rs-spinner" /> : <Trash2 className="w-4 h-4" />}
              {removing ? 'Removing…' : 'Remove Image'}
            </button>
          )}

          {preview && (
            <button
              className="rs-avatar-btn ghost"
              onClick={() => { setPreview(null); setFile(null) }}
            >
              Cancel
            </button>
          )}
        </div>

        <p className="rs-avatar-note">
          Recommended: square image, at least 200×200px. Max 2 MB.
          Supported: JPG, PNG, WebP, GIF.
        </p>
      </div>
    </div>
  )
}

// ─── Sub-panel: Member Management ────────────────────────────────────────────
function MemberPanel({ onBack }: { onBack: () => void }) {
  const { activeRoom } = useVoiceStore()
  const { user } = useAuthStore()
  const { toast } = useToast()
  const participants = activeRoom?.participants.filter(p => p.isActive) || []

  const handleKick = async (userId: string, name: string) => {
    if (!activeRoom) return
    try {
      await api.delete(`/voice/${activeRoom.id}/kick/${userId}`)
      toast({ title: `🚫 ${name} removed` })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
    }
  }

  return (
    <div className="rs-panel">
      <div className="rs-panel-header">
        <button className="rs-back" onClick={onBack}>←</button>
        <h3 className="rs-panel-title">Member Management</h3>
      </div>
      <div className="rs-list">
        {participants.length === 0 && (
          <p className="rs-empty">No participants</p>
        )}
        {participants.map(p => {
          const isMe = p.userId === user?.id
          const name = `${p.user.firstName} ${p.user.lastName}`
          return (
            <div key={p.userId} className="rs-member-row">
              <div className="rs-member-avatar">
                {p.user.avatarUrl
                  ? <img src={getAvatarUrl(p.user.avatarUrl)} alt="" />
                  : <span>{p.user.firstName[0]}{p.user.lastName[0]}</span>
                }
              </div>
              <div className="rs-member-info">
                <span className="rs-member-name">{isMe ? `${name} (You)` : name}</span>
                <span className="rs-member-role">{p.role}</span>
              </div>
              {!isMe && p.role !== 'HOST' && (
                <button
                  className="rs-kick-btn"
                  onClick={() => handleKick(p.userId, name)}
                  title="Remove"
                >
                  <UserMinus className="w-4 h-4" />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Sub-panel: Mic Seat Settings ─────────────────────────────────────────────
function MicSeatPanel({ onBack }: { onBack: () => void }) {
  const { activeRoom } = useVoiceStore()
  const { toast } = useToast()
  const [maxSpeakers, setMaxSpeakers] = useState(activeRoom?.maxSpeakers ?? 10)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!activeRoom) return
    setSaving(true)
    try {
      await api.patch(`/voice/${activeRoom.id}`, { maxSpeakers })
      toast({ title: '✅ Mic seat limit updated' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rs-panel">
      <div className="rs-panel-header">
        <button className="rs-back" onClick={onBack}>←</button>
        <h3 className="rs-panel-title">Mic Seat Settings</h3>
      </div>
      <div className="rs-section">
        <p className="rs-section-label">Max speakers on stage</p>
        <div className="rs-seat-options">
          {[2, 4, 6, 8, 10].map(n => (
            <button
              key={n}
              onClick={() => setMaxSpeakers(n)}
              className={cn('rs-seat-opt', maxSpeakers === n && 'active')}
            >
              {n}
              {maxSpeakers === n && <Check className="w-3 h-3 ml-1" />}
            </button>
          ))}
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="rs-save-btn"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ─── Sub-panel: Comment Settings ──────────────────────────────────────────────
function CommentPanel({ onBack }: { onBack: () => void }) {
  const { activeRoom, updateRoom } = useVoiceStore()
  const { toast } = useToast()
  const [commentsEnabled, setCommentsEnabled] = useState(activeRoom?.commentsEnabled ?? true)
  const [slowMode, setSlowMode] = useState(activeRoom?.slowMode ?? false)
  const [reactionsEnabled, setReactionsEnabled] = useState(activeRoom?.reactionsEnabled ?? true)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!activeRoom) return
    setSaving(true)
    try {
      await api.patch(`/voice/${activeRoom.id}`, { commentsEnabled, slowMode, reactionsEnabled })
      updateRoom({ commentsEnabled, slowMode, reactionsEnabled })
      toast({ title: '✅ Room settings saved' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to save', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rs-panel">
      <div className="rs-panel-header">
        <button className="rs-back" onClick={onBack}>←</button>
        <h3 className="rs-panel-title">Chat & Reactions</h3>
      </div>
      <div className="rs-section">
        <div className="rs-toggle-row">
          <div>
            <p className="rs-toggle-label">Allow comments</p>
            <p className="rs-toggle-sub">Audience can send chat messages</p>
          </div>
          <button
            onClick={() => setCommentsEnabled(v => !v)}
            className={cn('rs-toggle', commentsEnabled && 'on')}
          >
            <span className="rs-toggle-thumb" />
          </button>
        </div>
        <div className="rs-toggle-row">
          <div>
            <p className="rs-toggle-label">Slow mode</p>
            <p className="rs-toggle-sub">Limit messages to 1 per 5 seconds</p>
          </div>
          <button
            onClick={() => setSlowMode(v => !v)}
            className={cn('rs-toggle', slowMode && 'on')}
            disabled={!commentsEnabled}
          >
            <span className="rs-toggle-thumb" />
          </button>
        </div>
        <div className="rs-toggle-row">
          <div>
            <p className="rs-toggle-label">Allow reactions</p>
            <p className="rs-toggle-sub">Audience can send emoji reactions</p>
          </div>
          <button
            onClick={() => setReactionsEnabled(v => !v)}
            className={cn('rs-toggle', reactionsEnabled && 'on')}
          >
            <span className="rs-toggle-thumb" />
          </button>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="rs-save-btn"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ─── Sub-panel: Message Type ───────────────────────────────────────────────────
function MessageTypePanel({ onBack }: { onBack: () => void }) {
  const { activeRoom, updateRoom } = useVoiceStore()
  const { toast } = useToast()
  const [selected, setSelected] = useState<'all' | 'followers' | 'none'>(
    (activeRoom?.messageType as 'all' | 'followers' | 'none') ?? 'all'
  )
  const [saving, setSaving] = useState(false)
  const [followerCount, setFollowerCount] = useState<number | null>(null)

  // Fetch follower count for the host so the host knows how many people can chat
  useEffect(() => {
    if (!activeRoom?.hostId) return
    api.get(`/social/counts/${activeRoom.hostId}`)
      .then(r => setFollowerCount(r.data.data?.followers ?? 0))
      .catch(() => {})
  }, [activeRoom?.hostId]) // eslint-disable-line

  const options = [
    { value: 'all',       label: 'Everyone',       sub: 'All users in the room can send messages', icon: '🌍' },
    { value: 'followers', label: 'Followers only',  sub: followerCount !== null ? `Only your ${followerCount} follower${followerCount !== 1 ? 's' : ''} can message` : 'Only your followers can message', icon: '👥' },
    { value: 'none',      label: 'Disabled',        sub: 'No one can send messages (host/mod exempt)', icon: '🔇' },
  ] as const

  const save = async () => {
    if (!activeRoom) return
    setSaving(true)
    try {
      await api.patch(`/voice/${activeRoom.id}`, { messageType: selected })
      updateRoom({ messageType: selected })
      toast({ title: '✅ Message type saved' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to save', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rs-panel">
      <div className="rs-panel-header">
        <button className="rs-back" onClick={onBack}>←</button>
        <h3 className="rs-panel-title">Message Type</h3>
      </div>
      <div className="rs-section">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => setSelected(opt.value)}
            className={cn('rs-radio-row', selected === opt.value && 'active')}
          >
            <div className="rs-radio-info">
              <span className="rs-radio-label">{opt.icon} {opt.label}</span>
              <span className="rs-radio-sub">{opt.sub}</span>
            </div>
            <div className={cn('rs-radio-dot', selected === opt.value && 'active')} />
          </button>
        ))}
        {selected === 'followers' && followerCount === 0 && (
          <p className="rs-section-label" style={{ color: '#f59e0b', marginTop: 8 }}>
            ⚠️ You have 0 followers — no one will be able to chat
          </p>
        )}
        <button
          onClick={save}
          disabled={saving}
          className="rs-save-btn"
          style={{ marginTop: 12 }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ─── Sub-panel: Operation History ─────────────────────────────────────────────
function OperationHistoryPanel({ onBack }: { onBack: () => void }) {
  const { activeRoom } = useVoiceStore()
  const participants = activeRoom?.participants || []

  // Build a simple history from participant join/leave data
  const events = participants
    .filter(p => p.joinedAt)
    .sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime())
    .slice(0, 20)
    .map(p => ({
      name: `${p.user.firstName} ${p.user.lastName}`,
      action: p.isActive ? 'joined' : 'left',
      time: new Date(p.joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      role: p.role,
    }))

  return (
    <div className="rs-panel">
      <div className="rs-panel-header">
        <button className="rs-back" onClick={onBack}>←</button>
        <h3 className="rs-panel-title">Operation History</h3>
      </div>
      <div className="rs-list">
        {events.length === 0 && <p className="rs-empty">No history yet</p>}
        {events.map((e, i) => (
          <div key={i} className="rs-history-row">
            <div className="rs-history-dot" style={{ background: e.action === 'joined' ? '#22c55e' : '#9ca3af' }} />
            <div className="rs-history-info">
              <span className="rs-history-name">{e.name}</span>
              <span className="rs-history-action">{e.action} as {(e.role ?? '').toLowerCase()}</span>
            </div>
            <span className="rs-history-time">{e.time}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Sub-panel: Background Music ──────────────────────────────────────────────
function BackgroundMusicPanel({
  onBack,
  audioRef, fileInputRef,
  activeTab, setActiveTab,
  search, setSearch,
  catFilter, setCatFilter,
  nowPlaying, setNowPlaying,
  isPlaying, setIsPlaying,
  volume, setVolume,
  currentTime, setCurrentTime,
  duration, setDuration,
}: {
  onBack: () => void
  audioRef: React.MutableRefObject<HTMLAudioElement | null>
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>
  activeTab: 'library' | 'device'; setActiveTab: (t: 'library' | 'device') => void
  search: string; setSearch: (s: string) => void
  catFilter: string; setCatFilter: (s: string) => void
  nowPlaying: any; setNowPlaying: (v: any) => void
  isPlaying: boolean; setIsPlaying: (v: boolean) => void
  volume: number; setVolume: (v: number) => void
  currentTime: number; setCurrentTime: (v: number) => void
  duration: number; setDuration: (v: number) => void
}) {
  const { activeRoom } = useVoiceStore()
  const { toast } = useToast()

  // Fetch categories
  const { data: categories = [] } = useQuery({
    queryKey: ['audio-categories'],
    queryFn: () => api.get('/audio/categories').then(r => r.data.data ?? []),
    staleTime: 5 * 60_000,
  })

  // Fetch lessons
  const { data: lessons = [], isLoading } = useQuery({
    queryKey: ['audio-lessons-music', catFilter, search],
    queryFn: () => api.get('/audio/lessons', {
      params: { categoryId: catFilter || undefined, search: search || undefined, limit: 100 }
    }).then(r => r.data.data ?? []),
  })

  // Resolve server audio URL
  const resolveUrl = (url: string) => {
    if (!url) return ''
    if (url.startsWith('http') || url.startsWith('blob:')) return url
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    return `${base}${url}`
  }

  // Core play function — works for both library lessons and device files
  const playAudio = async (lesson: any, src: string) => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
    }
    const audio = new Audio(src)
    audio.volume = volume / 100
    audio.loop = true
    audioRef.current = audio

    audio.ontimeupdate  = () => setCurrentTime(audio.currentTime)
    audio.onloadedmetadata = () => setDuration(audio.duration)
    audio.onplay        = () => setIsPlaying(true)
    audio.onpause       = () => setIsPlaying(false)
    audio.onended       = () => setIsPlaying(false)

    try {
      await audio.play()
      setNowPlaying(lesson)
      // Announce in room chat — only for library lessons
      if (!lesson.isDeviceFile && activeRoom?.id) {
        api.post(`/voice/${activeRoom.id}/messages`, {
          body: `🎵 Now playing: ${lesson.title}`,
        }).catch(() => {})
      }
    } catch {
      toast({ title: 'Failed to play audio', variant: 'destructive' })
    }
  }

  // Play a library lesson
  const play = (lesson: any) => playAudio(lesson, resolveUrl(lesson.audioUrl))

  // Pick a file from the device
  const handleDeviceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Validate — max 200 MB for device files
    if (file.size > 200 * 1024 * 1024) {
      toast({ title: 'File too large — max 200 MB', variant: 'destructive' })
      return
    }
    const objectUrl = URL.createObjectURL(file)
    const deviceLesson = {
      id:           `device-${Date.now()}`,
      title:        file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
      isDeviceFile: true,
      _objectUrl:   objectUrl,   // we'll revoke this when done
    }
    // Revoke previous object URL to avoid memory leak
    if (nowPlaying?._objectUrl) URL.revokeObjectURL(nowPlaying._objectUrl)
    await playAudio(deviceLesson, objectUrl)
    // Reset file input so the same file can be picked again
    e.target.value = ''
  }

  const togglePlay = () => {
    if (!audioRef.current) return
    if (isPlaying) audioRef.current.pause()
    else audioRef.current.play()
  }

  const stop = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }
    if (nowPlaying?._objectUrl) URL.revokeObjectURL(nowPlaying._objectUrl)
    setNowPlaying(null); setIsPlaying(false); setCurrentTime(0); setDuration(0)
  }

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100
  }, [volume])

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  return (
    <div className="rs-panel">
      <div className="rs-panel-header">
        <button className="rs-back" onClick={onBack}>←</button>
        <h3 className="rs-panel-title">🎵 Background Music</h3>
      </div>

      {/* ── Now playing bar ── */}
      {nowPlaying && (
        <div style={{ margin: '0 16px 12px', padding: '10px 14px', background: '#f0fdf4', borderRadius: 14, border: '1px solid #bbf7d0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#166534', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {nowPlaying.isDeviceFile ? '📱' : '🎵'} {nowPlaying.title}
              </p>
              <p style={{ margin: 0, fontSize: 11, color: '#4ade80', marginTop: 2 }}>
                {fmtTime(currentTime)} / {fmtTime(duration || 0)}
                {nowPlaying.isDeviceFile && <span style={{ marginLeft: 6, color: '#86efac', fontSize: 10 }}>Device File</span>}
              </p>
            </div>
            <button onClick={togglePlay} style={{ width: 32, height: 32, borderRadius: 16, background: '#22c55e', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button onClick={stop} style={{ width: 32, height: 32, borderRadius: 16, background: '#fee2e2', color: '#ef4444', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Stop">
              <StopCircle className="w-4 h-4" />
            </button>
          </div>
          {/* Volume + seek */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <Volume2 className="w-3 h-3" style={{ color: '#4ade80', flexShrink: 0 }} />
            <input type="range" min={0} max={100} value={volume} onChange={e => setVolume(Number(e.target.value))} style={{ flex: 1, accentColor: '#22c55e', height: 3, cursor: 'pointer' }} />
            <span style={{ fontSize: 11, color: '#4ade80', minWidth: 28, textAlign: 'right' }}>{volume}%</span>
          </div>
          {duration > 0 && (
            <input type="range" min={0} max={duration} step={0.1} value={currentTime}
              onChange={e => { if (audioRef.current) audioRef.current.currentTime = Number(e.target.value) }}
              style={{ width: '100%', marginTop: 6, accentColor: '#22c55e', height: 3, cursor: 'pointer' }} />
          )}
        </div>
      )}

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', gap: 4, margin: '0 16px 12px', background: '#f1f5f9', borderRadius: 12, padding: 3 }}>
        {([['library', '📚 Lesson Library'], ['device', '📁 From Device']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            flex: 1, padding: '7px 8px', borderRadius: 9, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
            background: activeTab === t ? '#fff' : 'transparent',
            color: activeTab === t ? '#7c3aed' : '#6b7280',
            boxShadow: activeTab === t ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
          }}>{label}</button>
        ))}
      </div>

      {/* ── Library Tab ── */}
      {activeTab === 'library' && (
        <>
          {/* Category filter */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '0 16px 8px', scrollbarWidth: 'none' }}>
            {[{ id: '', name: 'All' }, ...(categories as any[])].map((c: any) => (
              <button key={c.id} onClick={() => setCatFilter(c.id)} style={{
                padding: '4px 10px', borderRadius: 20, border: '1px solid',
                borderColor: catFilter === c.id ? '#7c3aed' : '#e5e7eb',
                background: catFilter === c.id ? '#ede9fe' : '#f9fafb',
                color: catFilter === c.id ? '#7c3aed' : '#6b7280',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              }}>{c.name}</button>
            ))}
          </div>

          {/* Search */}
          <div style={{ position: 'relative', margin: '0 16px 10px' }}>
            <Search className="w-3.5 h-3.5" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search lessons…"
              style={{ width: '100%', paddingLeft: 30, paddingRight: 10, paddingTop: 8, paddingBottom: 8, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f9fafb', fontSize: 13, color: '#111827', outline: 'none', boxSizing: 'border-box' }} />
          </div>

          {/* Lessons list */}
          <div style={{ overflowY: 'auto', maxHeight: 300, padding: '0 16px 16px' }}>
            {isLoading ? (
              <div style={{ textAlign: 'center', padding: 24, color: '#9ca3af', fontSize: 13 }}>Loading…</div>
            ) : (lessons as any[]).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: '#9ca3af', fontSize: 13 }}>No audio lessons found</div>
            ) : (lessons as any[]).map((lesson: any) => {
              const isNP = nowPlaying?.id === lesson.id
              return (
                <button key={lesson.id} onClick={() => play(lesson)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '9px 12px', borderRadius: 12, marginBottom: 4,
                  border: '1px solid', borderColor: isNP ? '#7c3aed' : '#f1f5f9',
                  background: isNP ? '#ede9fe' : '#fff', cursor: 'pointer', textAlign: 'left', transition: 'background 0.15s',
                }}>
                  <div style={{ width: 32, height: 32, borderRadius: 16, flexShrink: 0, background: isNP ? '#7c3aed' : '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isNP && isPlaying ? <Pause className="w-4 h-4" style={{ color: '#fff' }} /> : <Play className="w-4 h-4" style={{ color: isNP ? '#fff' : '#7c3aed', marginLeft: 2 }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: isNP ? '#4f46e5' : '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lesson.title}</p>
                    <p style={{ margin: 0, fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{lesson.category?.name} · {lesson.course?.title}</p>
                  </div>
                  {isNP && <span style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', background: '#ede9fe', padding: '2px 7px', borderRadius: 10, flexShrink: 0 }}>{isPlaying ? '▶ Playing' : '⏸ Paused'}</span>}
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* ── Device Tab ── */}
      {activeTab === 'device' && (
        <div style={{ padding: '0 16px 20px' }}>
          {/* Hidden file input */}
          <input ref={fileInputRef} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus" style={{ display: 'none' }} onChange={handleDeviceFile} />

          {/* Drop zone / pick button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
              width: '100%', padding: '28px 20px', marginBottom: 12,
              borderRadius: 16, border: '2px dashed #7c3aed', background: '#faf5ff',
              cursor: 'pointer', transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#ede9fe')}
            onMouseLeave={e => (e.currentTarget.style.background = '#faf5ff')}
          >
            <div style={{ width: 56, height: 56, borderRadius: 28, background: '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Music className="w-7 h-7" style={{ color: '#7c3aed' }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#4c1d95' }}>Click to pick audio from your device</p>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#7c3aed', opacity: 0.7 }}>MP3 · WAV · OGG · M4A · AAC · FLAC · Opus · Max 200 MB</p>
            </div>
          </button>

          {/* Currently playing device file */}
          {nowPlaying?.isDeviceFile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#ede9fe', borderRadius: 12, border: '1px solid #c4b5fd', marginBottom: 12 }}>
              <Music className="w-5 h-5" style={{ color: '#7c3aed', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#4c1d95', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nowPlaying.title}</p>
                <p style={{ margin: 0, fontSize: 11, color: '#7c3aed', marginTop: 1 }}>Playing from your device</p>
              </div>
              <button onClick={togglePlay} style={{ width: 30, height: 30, borderRadius: 15, background: '#7c3aed', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}

          {/* Tips */}
          <div style={{ background: '#f0f9ff', borderRadius: 12, padding: '10px 14px', border: '1px solid #bae6fd' }}>
            <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: '#0369a1' }}>💡 How it works</p>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: '#0284c7', lineHeight: 1.7 }}>
              <li>Music plays in your browser tab only</li>
              <li>If you&apos;re on a meeting app, your mic may pick it up for participants</li>
              <li>Use the volume slider above to balance voice and music</li>
              <li>The file never leaves your device — no upload to the server</li>
              <li>Click the pick area again to change the track</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Invite Link Button — only for INVITE_ONLY rooms ─────────────────────────
function InviteLinkButton({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)

  const inviteLink = typeof window !== 'undefined'
    ? `${window.location.origin}/voice-club/${roomId}?invite=1`
    : `/voice-club/${roomId}?invite=1`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      toast({ title: '🔗 Invite link copied!', description: 'Share it to let people request to join your room.' })
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard API unavailable — show the link in toast so user can copy manually
      toast({ title: 'Copy this link:', description: inviteLink })
    }
  }

  return (
    <button className="rs-menu-item" onClick={handleCopy}>
      <div className="rs-menu-icon" style={{ fontSize: 20 }}>🔗</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="rs-menu-label">{copied ? '✅ Copied!' : 'Copy Invite Link'}</span>
        <p style={{ margin: 0, fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
          Invite-only — share link for join requests
        </p>
      </div>
    </button>
  )
}

// ─── Quick Controls — HOST/MOD primary actions, always above the fold ────────
// Extracted as a named component so it can be unit-tested independently.
// Lives OUTSIDE rs-groups (the scrollable area) so it's always visible.
function QuickControls({
  isHost, amModerating,
  isOpenMic, micLocked,
  onToggleOpenMic, onToggleMicLock,
  onMuteAll, onUnmuteAll,
  onClose,
}: {
  isHost: boolean
  amModerating: boolean
  isOpenMic: boolean
  micLocked: boolean
  onToggleOpenMic?: (enabled?: boolean) => void
  onToggleMicLock?: (locked?: boolean) => void
  onMuteAll?: () => void
  onUnmuteAll?: () => void
  onClose: () => void
}) {
  const [mutingAll,   setMutingAll]   = useState(false)
  const [unmutingAll, setUnmutingAll] = useState(false)

  const handleMuteAll = async () => {
    if (mutingAll) return
    setMutingAll(true)
    try { await Promise.resolve(onMuteAll?.()) } finally { setMutingAll(false) }
    onClose()
  }

  const handleUnmuteAll = async () => {
    if (unmutingAll) return
    setUnmutingAll(true)
    try { await Promise.resolve(onUnmuteAll?.()) } finally { setUnmutingAll(false) }
    onClose()
  }

  const btnBase: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 12px', borderRadius: 12, border: 'none',
    cursor: 'pointer', textAlign: 'left', width: '100%',
  }

  return (
    <div
      data-testid="quick-controls"
      style={{
        margin: '0 16px 10px',
        padding: '12px',
        background: '#f9fafb',
        borderRadius: 14,
        border: '1px solid #f3f4f6',
        flexShrink: 0,  // critical — never pushed off screen
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        Quick Controls
      </div>

      {/* Row 1 — Open Mic + Lock Mic */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        {(onToggleOpenMic || isHost) && (
          <button
            aria-label={`Open Mic (free stage access) is ${isOpenMic ? 'on' : 'off'}. Tap to toggle.`}
            onClick={() => onToggleOpenMic?.()}
            style={{ ...btnBase, background: isOpenMic ? '#ede9fe' : '#fff', color: isOpenMic ? '#7c3aed' : '#374151', border: '1px solid', borderColor: isOpenMic ? '#c4b5fd' : '#e5e7eb' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Free Stage</div>
              <div style={{ fontSize: 10, opacity: 0.65 }}>{isOpenMic ? 'ON — anyone can join' : 'OFF — approval needed'}</div>
            </div>
          </button>
        )}
        {(onToggleMicLock || isHost) && (
          <button
            aria-label={`Mic is ${micLocked ? 'locked' : 'unlocked'}. Tap to toggle.`}
            onClick={() => onToggleMicLock?.()}
            style={{ ...btnBase, background: micLocked ? '#fef3c7' : '#fff', color: micLocked ? '#d97706' : '#374151', border: '1px solid', borderColor: micLocked ? '#fcd34d' : '#e5e7eb' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
              {micLocked
                ? <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>
                : <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></>}
            </svg>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{micLocked ? 'Unlock Mic' : 'Lock Mic'}</div>
              <div style={{ fontSize: 10, opacity: 0.65 }}>{micLocked ? 'Frozen' : 'Allow'}</div>
            </div>
          </button>
        )}
      </div>

      {/* Row 2 — Mute All + Unmute All (full-width pair) */}
      {(onMuteAll || onUnmuteAll || isHost) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {(onMuteAll || isHost) && (
            <button
              data-testid="btn-mute-all"
              aria-label="Mute all speakers on stage"
              onClick={handleMuteAll}
              disabled={mutingAll}
              style={{
                ...btnBase,
                background: mutingAll ? '#fee2e2' : '#fef2f2',
                color: '#dc2626',
                border: '1px solid #fecaca',
                opacity: mutingAll ? 0.65 : 1,
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {mutingAll
                ? <span style={{ fontSize: 12, fontWeight: 700 }}>…</span>
                : <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>🔇 Mute All</div>
                      <div style={{ fontSize: 10, opacity: 0.65 }}>Silence speakers on stage</div>
                    </div>
                  </>
              }
            </button>
          )}
          {(onUnmuteAll || isHost) && (
            <button
              data-testid="btn-unmute-all"
              aria-label="Unmute all speakers on stage"
              onClick={handleUnmuteAll}
              disabled={unmutingAll}
              style={{
                ...btnBase,
                background: unmutingAll ? '#dcfce7' : '#f0fdf4',
                color: '#16a34a',
                border: '1px solid #bbf7d0',
                opacity: unmutingAll ? 0.65 : 1,
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {unmutingAll
                ? <span style={{ fontSize: 12, fontWeight: 700 }}>…</span>
                : <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>🔊 Unmute All</div>
                      <div style={{ fontSize: 10, opacity: 0.65 }}>Unsilence speakers on stage</div>
                    </div>
                  </>
              }
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sub-panel: Edit Room (title, description, topic, privacy) ───────────────
function EditRoomPanel({ onBack }: { onBack: () => void }) {
  const { activeRoom, updateRoom } = useVoiceStore()
  const { toast } = useToast()
  const [title,       setTitle]    = useState(activeRoom?.title ?? '')
  const [description, setDesc]     = useState(activeRoom?.description ?? '')
  const [topic,       setTopic]    = useState(activeRoom?.topic ?? '')
  const [privacy,     setPrivacy]  = useState<'PUBLIC'|'PRIVATE'|'INVITE_ONLY'>(
    (activeRoom?.privacy as 'PUBLIC'|'PRIVATE'|'INVITE_ONLY') ?? 'PUBLIC'
  )
  const [saving, setSaving]        = useState(false)

  // Sync if room changes while panel is open
  useEffect(() => {
    setTitle(activeRoom?.title ?? '')
    setDesc(activeRoom?.description ?? '')
    setTopic(activeRoom?.topic ?? '')
    setPrivacy((activeRoom?.privacy as 'PUBLIC'|'PRIVATE'|'INVITE_ONLY') ?? 'PUBLIC')
  }, [activeRoom?.title, activeRoom?.description, activeRoom?.topic, activeRoom?.privacy]) // eslint-disable-line

  const save = async () => {
    if (!activeRoom) return
    if (!title.trim()) { toast({ title: 'Title is required', variant: 'destructive' }); return }
    setSaving(true)
    try {
      await api.patch(`/voice/${activeRoom.id}`, {
        title:       title.trim(),
        description: description.trim() || null,
        topic:       topic.trim() || null,
        privacy,
      })
      updateRoom({ title: title.trim(), description: description.trim() || null, topic: topic.trim() || null, privacy })
      toast({ title: '✅ Room updated' })
      onBack()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to save', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const privacyOptions = [
    { value: 'PUBLIC',      label: '🌍 Public',      sub: 'Anyone can join' },
    { value: 'PRIVATE',     label: '🔒 Private',     sub: 'Invite-only entry' },
    { value: 'INVITE_ONLY', label: '✉️ Invite Only', sub: 'Members must request' },
  ] as const

  return (
    <div className="rs-panel">
      <div className="rs-panel-header">
        <button className="rs-back" onClick={onBack}>←</button>
        <h3 className="rs-panel-title">Edit Room Info</h3>
      </div>
      <div className="rs-section" style={{ padding: '16px' }}>
        {/* Title */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Room Title *
          </label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={120}
            placeholder="Enter room title…"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 14, color: '#1e293b', background: '#f9fafb', outline: 'none', boxSizing: 'border-box' }}
          />
          <span style={{ fontSize: 10, color: '#9ca3af', float: 'right', marginTop: 3 }}>{title.length}/120</span>
        </div>

        {/* Topic */}
        <div style={{ marginBottom: 14, clear: 'both' }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Topic (optional)
          </label>
          <input
            value={topic}
            onChange={e => setTopic(e.target.value)}
            maxLength={100}
            placeholder="e.g. Quran recitation, discussion…"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 14, color: '#1e293b', background: '#f9fafb', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {/* Description */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={e => setDesc(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Tell people what your room is about…"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 13, color: '#1e293b', background: '#f9fafb', outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5 }}
          />
          <span style={{ fontSize: 10, color: '#9ca3af', float: 'right', marginTop: 3 }}>{description.length}/500</span>
        </div>

        {/* Privacy */}
        <div style={{ marginBottom: 20, clear: 'both' }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Privacy
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {privacyOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => setPrivacy(opt.value)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  borderRadius: 10, border: `1.5px solid ${privacy === opt.value ? '#7c3aed' : '#e5e7eb'}`,
                  background: privacy === opt.value ? '#ede9fe' : '#f9fafb',
                  cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s'
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: 8, border: `2px solid ${privacy === opt.value ? '#7c3aed' : '#9ca3af'}`,
                  background: privacy === opt.value ? '#7c3aed' : 'transparent',
                  flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  {privacy === opt.value && <div style={{ width: 6, height: 6, borderRadius: 3, background: '#fff' }} />}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{opt.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Save */}
        <button
          onClick={save}
          disabled={saving || !title.trim()}
          className="rs-save-btn"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ─── Main Sheet ────────────────────────────────────────────────────────────────
type Panel = 'avatar' | 'edit' | 'members' | 'room-members' | 'mic-seat' | 'comment' | 'message-type' | 'history' | 'music' | null

export function RoomSettingsSheet({ open, onClose, isHost, amModerating, onMuteAll, onUnmuteAll, onToggleOpenMic, onToggleMicLock, isOpenMic: isOpenMicProp = false, micLocked: micLockedProp = false }: Props) {
  const { activeRoom } = useVoiceStore()
  const [panel, setPanel] = useState<Panel>(null)

  // Read isOpenMic and micLocked directly from the live store so the toggles
  // reflect real-time socket updates without requiring the sheet to be reopened.
  // Fall back to props when activeRoom is not yet available (e.g. members page).
  const isOpenMic = activeRoom?.isOpenMic ?? isOpenMicProp
  const micLocked = activeRoom?.micLocked  ?? micLockedProp

  // ── Lifted audio state — persists across panel navigation ──────────────────
  const audioRef     = useRef<HTMLAudioElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [musicTab,     setMusicTab]     = useState<'library' | 'device'>('library')
  const [musicSearch,  setMusicSearch]  = useState('')
  const [musicCatFilter, setMusicCatFilter] = useState('')
  const [nowPlaying,   setNowPlaying]   = useState<any>(null)
  const [isPlaying,    setIsPlaying]    = useState(false)
  const [musicVolume,  setMusicVolume]  = useState(40)
  const [currentTime,  setCurrentTime]  = useState(0)
  const [musicDuration, setMusicDuration] = useState(0)

  const handleClose = () => {
    setPanel(null)
    onClose()
    // Music keeps playing — don't stop here
  }

  // Stop music only when sheet is fully closed AND user explicitly closes
  // (we intentionally do NOT stop on panel back — only on explicit stop button)
  // Cleanup: revoke object URL on full unmount (when sheet tears down)
  useEffect(() => {
    return () => {
      if (nowPlaying?._objectUrl) URL.revokeObjectURL(nowPlaying._objectUrl)
    }
  }, [nowPlaying])

  const menuItems = [
    {
      group: 'management',
      items: [
        { id: 'members',      icon: Users,         label: 'Member Management',  show: amModerating,           badge: 0 },
        { id: 'room-members', icon: Users,         label: '⭐ Room Members',     show: true,                   badge: 0 },
      ]
    },
    {
      group: 'settings',
      items: [
        { id: 'edit',         icon: ClipboardList, label: '✏️ Edit Title & Description', show: isHost,        badge: 0 },
        { id: 'mic-seat',     icon: Mic,           label: 'Mic Seat',           show: isHost,                    badge: 0 },
        { id: 'comment',      icon: MessageSquare, label: 'Chat & Reactions',   show: isHost || amModerating,    badge: 0 },
        { id: 'message-type', icon: MessageCircle, label: 'Message Type',       show: isHost,                    badge: 0 },
        { id: 'music',        icon: Music,         label: 'Background Music',   show: isHost || amModerating,    badge: 0 },
      ]
    },
    {
      group: 'history',
      items: [
        { id: 'history',      icon: ClipboardList, label: 'Operation History',   show: amModerating, badge: 0 },
      ]
    },
  ]

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="rs-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />

          {/* Sheet */}
          <motion.div
            className="rs-sheet"
            initial={{ y: '100%', x: 0 }}
            animate={{ y: 0, x: 0 }}
            exit={{ y: '100%', x: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              width: '100%',
              maxWidth: 'none',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '88vh',
              overflow: 'hidden',
            }}
          >
            {/* Drag handle */}
            <div className="rs-handle" />

            {/* Sub-panel or main menu */}
            <AnimatePresence mode="wait">
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {panel === 'avatar'       && <AvatarPanel           key="avatar"       onBack={() => setPanel(null)} />}
              {panel === 'edit'         && <EditRoomPanel         key="edit"         onBack={() => setPanel(null)} />}
              {panel === 'members'      && <MemberPanel          key="members"      onBack={() => setPanel(null)} />}
              {panel === 'room-members' && activeRoom && <RoomMembersPanel key="room-members" roomId={activeRoom.id} isHost={isHost} amModerating={amModerating} onBack={() => setPanel(null)} />}
              {panel === 'mic-seat'     && <MicSeatPanel         key="mic-seat"     onBack={() => setPanel(null)} />}
              {panel === 'comment'      && <CommentPanel         key="comment"      onBack={() => setPanel(null)} />}
              {panel === 'message-type' && <MessageTypePanel     key="message-type" onBack={() => setPanel(null)} />}
              {panel === 'history'      && <OperationHistoryPanel key="history"     onBack={() => setPanel(null)} />}
              {panel === 'music'        && <BackgroundMusicPanel  key="music"       onBack={() => setPanel(null)}
                audioRef={audioRef} fileInputRef={fileInputRef}
                activeTab={musicTab} setActiveTab={setMusicTab}
                search={musicSearch} setSearch={setMusicSearch}
                catFilter={musicCatFilter} setCatFilter={setMusicCatFilter}
                nowPlaying={nowPlaying} setNowPlaying={setNowPlaying}
                isPlaying={isPlaying} setIsPlaying={setIsPlaying}
                volume={musicVolume} setVolume={setMusicVolume}
                currentTime={currentTime} setCurrentTime={setCurrentTime}
                duration={musicDuration} setDuration={setMusicDuration}
              />}

              {!panel && (
                <motion.div
                  key="main"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}
                >
                  {/* Header */}
                  <div className="rs-header">
                    <h2 className="rs-title">Room Settings</h2>
                    <button className="rs-close" onClick={handleClose}>
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Room info card — click avatar area to change image (host only) */}
                  <div className="rs-room-card">
                    <button
                      className={cn('rs-room-avatar-btn', !isHost && 'no-hover')}
                      onClick={() => isHost && setPanel('avatar')}
                      title={isHost ? 'Change room image' : undefined}
                      style={{ cursor: isHost ? 'pointer' : 'default' }}
                    >
                      {activeRoom?.coverImageUrl ? (
                        <img
                          src={getFileUrl(activeRoom.coverImageUrl!)}
                          alt="Room"
                          className="rs-room-avatar-img"
                        />
                      ) : (
                        <span className="rs-room-emoji">{activeRoom?.coverEmoji || '🎙️'}</span>
                      )}
                      {isHost && (
                        <span className="rs-room-avatar-overlay">
                          <Camera className="w-4 h-4" />
                        </span>
                      )}
                    </button>
                    <div className="rs-room-info">
                      <p className="rs-room-name">{activeRoom?.title}</p>
                      {activeRoom?.topic && (
                        <p className="rs-room-topic">{activeRoom.topic}</p>
                      )}
                      {activeRoom?.description && (
                        <p className="rs-room-desc">{activeRoom.description}</p>
                      )}
                      {isHost && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                          <button
                            className="rs-room-edit-link"
                            onClick={() => setPanel('avatar')}
                          >
                            <Image className="w-3 h-3" /> Change cover
                          </button>
                          <button
                            className="rs-room-edit-link"
                            onClick={() => setPanel('edit')}
                            style={{ color: '#7c3aed' }}
                          >
                            ✏️ Edit title & description
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Persistent music bar — visible from any panel when music is playing ── */}
                  {nowPlaying && (
                    <div style={{
                      margin: '0 16px 12px', padding: '10px 14px',
                      background: 'linear-gradient(135deg, #f0fdf4, #ecfdf5)',
                      borderRadius: 14, border: '1px solid #bbf7d0',
                      display: 'flex', alignItems: 'center', gap: 10,
                      flexShrink: 0,
                    }}>
                      <span style={{ fontSize: 20, flexShrink: 0 }}>{nowPlaying.isDeviceFile ? '📱' : '🎵'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#166534', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {nowPlaying.title}
                        </p>
                        <p style={{ margin: 0, fontSize: 10, color: '#4ade80', marginTop: 1 }}>
                          {isPlaying ? '▶ Playing' : '⏸ Paused'}
                          {' · '}
                          <span
                            style={{ cursor: 'pointer', textDecoration: 'underline', color: '#7c3aed' }}
                            onClick={() => setPanel('music')}
                          >
                            Open controls
                          </span>
                        </p>
                      </div>
                      {/* Quick play/pause */}
                      <button
                        onClick={() => {
                          if (!audioRef.current) return
                          if (isPlaying) audioRef.current.pause()
                          else audioRef.current.play()
                        }}
                        style={{ width: 28, height: 28, borderRadius: 14, background: '#22c55e', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                      >
                        {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      </button>
                      {/* Quick stop */}
                      <button
                        onClick={() => {
                          if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; audioRef.current = null }
                          if (nowPlaying?._objectUrl) URL.revokeObjectURL(nowPlaying._objectUrl)
                          setNowPlaying(null); setIsPlaying(false); setCurrentTime(0); setMusicDuration(0)
                        }}
                        style={{ width: 28, height: 28, borderRadius: 14, background: '#fee2e2', color: '#ef4444', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                        title="Stop music"
                      >
                        <StopCircle className="w-3 h-3" />
                      </button>
                    </div>
                  )}

                  {/* ── Quick Controls — ABOVE THE FOLD, outside scroll area ──────────── */}
                  {/* HOST and authorized MODERATORs see: Open Mic, Lock Mic (row 1) +   */}
                  {/* Mute All, Unmute All (row 2) — all visible without scrolling.       */}
                  {(amModerating || isHost) && (
                    <QuickControls
                      isHost={isHost}
                      amModerating={amModerating}
                      isOpenMic={isOpenMic}
                      micLocked={micLocked}
                      onToggleOpenMic={onToggleOpenMic}
                      onToggleMicLock={onToggleMicLock}
                      onMuteAll={onMuteAll}
                      onUnmuteAll={onUnmuteAll}
                      onClose={handleClose}
                    />
                  )}

                  {/* Menu groups — scrollable secondary controls */}
                  <div className="rs-groups">
                    {menuItems.map(group => {
                      const visible = group.items.filter(i => i.show)
                      if (visible.length === 0) return null
                      return (
                        <div key={group.group} className="rs-group">
                          {visible.map(item => {
                            const Icon = item.icon
                            return (
                              <button
                                key={item.id}
                                className="rs-menu-item"
                                onClick={() => setPanel(item.id as Panel)}
                              >
                                <div className="rs-menu-icon">
                                  <Icon className="w-5 h-5" />
                                </div>
                                <span className="rs-menu-label">{item.label}</span>
                                <div className="rs-menu-right">
                                  {'badge' in item && item.badge > 0 && (
                                    <span className="rs-badge">{item.badge} users</span>
                                  )}
                                  <ChevronRight className="w-4 h-4 text-gray-400" />
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      )
                    })}

                    {/* Invite Link — only shown for INVITE_ONLY rooms (host + any user) */}
                    {activeRoom?.privacy === 'INVITE_ONLY' && (
                      <div className="rs-group">
                        <InviteLinkButton roomId={activeRoom.id} onClose={handleClose} />
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </div>
            </AnimatePresence>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
