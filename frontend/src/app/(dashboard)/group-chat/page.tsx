'use client'

/**
 * Group Chat Page — Telegram style
 * - Dark blue sidebar with group list, search, unread badges
 * - Chat header: group avatar, name, member count, mute/search/info actions
 * - Bubbles: clustered by sender, avatar shown once per cluster
 * - Pinned message banner (dismissible)
 * - Reply preview bar above input
 * - Context menu: reply, copy, pin, forward, delete
 * - Quick emoji reactions (popover on hover)
 * - Right panel: group info, member list, media
 * - Create group modal
 * - DOM windowing: only render last 80 messages when list > 100
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { groupChatApi } from '@/lib/groupChat'
import {
  useGroupChatStore,
  type GcConversation,
  type GcMessage,
  type GcMember,
} from '@/store/groupChat.store'
import { useAuthStore } from '@/store/auth.store'
import { getAvatarUrl, getFileUrl } from '@/lib/avatar'
import { getSocket } from '@/lib/socket'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { buildMessageClusters, resolveReadReceipt } from '@/lib/chatUtils'
import { format, isToday, isYesterday } from 'date-fns'
import api from '@/lib/api'
import { useDmUpload } from '@/hooks/useDmUpload'
import { GcMediaBubble } from '@/components/group-chat/GcMediaBubble'
import { GcInputBar } from '@/components/group-chat/GcInputBar'
import { ShareSheet, type SharePayload } from '@/components/chat/ShareSheet'
import {
  Send, Search, ArrowLeft, Loader2, Plus, X,
  MoreVertical, Reply, Globe, Lock, Hash, UserPlus, LogOut,
  MessageSquare, Pin, Copy, Trash2, Forward, Check, CheckCheck,
  Paperclip, Smile, Bell, Info, ChevronRight, Image as ImageIcon,
  Users, Settings, Shield, Volume2, VolumeX, Pencil, ChevronDown,
} from 'lucide-react'

// ─── Constants ─────────────────────────────────────────────────────────────────
const TG_BLUE = '#2AABEE'
const TG_DARK = '#17212b'
const TG_PANEL = '#232e3c'
const TG_HOVER = '#2b5278'
const TG_ACTIVE = '#2b5278'
const TG_MSG_OUT = '#2b5278'   // sent bubble
const TG_MSG_IN = '#182533'    // received bubble
const TG_BORDER = '#0e1621'

const VIRTUALIZE_THRESHOLD = 100
const MESSAGES_DOM_WINDOW = 80
const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏']

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(iso: string) {
  const d = new Date(iso)
  if (isToday(d)) return format(d, 'HH:mm')
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'MMM d')
}
function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Av({ url, name, size = 40, color = TG_BLUE }: {
  url?: string | null; name: string; size?: number; color?: string
}) {
  const src = getAvatarUrl(url)
  return (
    <div className="rounded-full overflow-hidden flex items-center justify-center font-bold text-white flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.35, backgroundColor: src ? 'transparent' : color }}>
      {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : initials(name)}
    </div>
  )
}

// ─── Privacy icon ──────────────────────────────────────────────────────────────
function PrivacyIcon({ privacy }: { privacy: string }) {
  if (privacy === 'PUBLIC') return <Globe className="w-3 h-3 text-gray-400" />
  if (privacy === 'PRIVATE') return <Lock className="w-3 h-3 text-gray-400" />
  return <Hash className="w-3 h-3 text-gray-400" />
}

// ─── Date separator ────────────────────────────────────────────────────────────
function DateSep({ dateKey }: { dateKey: string }) {
  const d = new Date(dateKey)
  const label = isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'MMMM d, yyyy')
  return (
    <div className="flex justify-center my-3">
      <span className="text-[11px] font-medium px-3 py-1 rounded-full"
        style={{ backgroundColor: 'rgba(17,27,38,0.8)', color: '#8e99a4' }}>
        {label}
      </span>
    </div>
  )
}

// ─── Typing indicator ──────────────────────────────────────────────────────────
function TypingRow({ names }: { names: string[] }) {
  if (names.length === 0) return null
  const label = names.length === 1 ? `${names[0]} is typing…` : `${names.length} people are typing…`
  return (
    <div className="flex items-center gap-2 px-4 py-1">
      <div className="flex gap-0.5">
        {[0, 1, 2].map(i => (
          <span key={i} className="w-1.5 h-1.5 rounded-full animate-bounce block"
            style={{ backgroundColor: TG_BLUE, animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
      <span className="text-[11px]" style={{ color: TG_BLUE }}>{label}</span>
    </div>
  )
}

// ─── Context menu ──────────────────────────────────────────────────────────────
interface CtxMenu { x: number; y: number; msg: GcMessage }

function ContextMenu({ ctx, isAdmin, isOwn, canDeleteMsg, onReply, onCopy, onEdit, onPin, onDelete, onForward, onClose }: {
  ctx: CtxMenu; isAdmin: boolean; isOwn: boolean; canDeleteMsg: boolean
  onReply: () => void; onCopy: () => void; onEdit: () => void; onPin: () => void
  onDelete: () => void; onForward: () => void; onClose: () => void
}) {
  const items = [
    { icon: Reply, label: 'Reply', action: onReply },
    { icon: Copy, label: 'Copy', action: onCopy },
    { icon: Forward, label: 'Forward', action: onForward },
    ...(isOwn ? [{ icon: Pencil, label: 'Edit', action: onEdit }] : []),
    ...(isAdmin ? [{ icon: Pin, label: ctx.msg.isPinned ? 'Unpin' : 'Pin', action: onPin }] : []),
    ...(canDeleteMsg ? [{ icon: Trash2, label: 'Delete', action: onDelete, danger: true }] : []),
  ]

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="fixed z-50 rounded-xl shadow-2xl overflow-hidden min-w-[160px]"
        style={{ top: ctx.y, left: ctx.x, backgroundColor: TG_PANEL, border: `1px solid ${TG_BORDER}` }}
      >
        {items.map(({ icon: Icon, label, action, danger }) => (
          <button key={label} onClick={() => { action(); onClose() }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:opacity-80"
            style={{ color: (danger as any) ? '#ff4f4f' : '#e8e8e8' }}>
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </motion.div>
    </>
  )
}

// ─── Message Bubble ────────────────────────────────────────────────────────────
function Bubble({
  msg, isOwn, showAvatar, showName, memberIds,
  onContextMenu, onReact,
}: {
  msg: GcMessage; isOwn: boolean; showAvatar: boolean; showName: boolean
  memberIds: string[]
  onContextMenu: (e: React.MouseEvent) => void
  onReact: (emoji: string) => void
}) {
  const [showReact, setShowReact] = useState(false)
  const [hovered, setHovered] = useState(false)

  const receipt = resolveReadReceipt(msg, memberIds)
  const reactionGroups = useMemo(() =>
    Object.entries((msg.reactions ?? []).reduce((a, r) => {
      a[r.type] = (a[r.type] || 0) + 1; return a
    }, {} as Record<string, number>)),
    [msg.reactions]
  )

  const renderContent = () => {
    return <GcMediaBubble msg={msg} isOwn={isOwn} />
  }

  return (
    <div
      className={cn('flex items-end gap-2 mb-0.5 px-4 group', isOwn ? 'flex-row-reverse' : 'flex-row')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setShowReact(false) }}
      onContextMenu={onContextMenu}
    >
      {/* Avatar placeholder / real avatar */}
      <div className="w-8 flex-shrink-0 mb-1">
        {!isOwn && showAvatar && (
          <Av url={msg.sender?.avatarUrl} name={`${msg.sender?.firstName} ${msg.sender?.lastName}`} size={32} />
        )}
      </div>

      <div className={cn('flex flex-col max-w-[65%]', isOwn && 'items-end')}>
        {/* Sender name */}
        {!isOwn && showName && (
          <span className="text-xs font-semibold mb-1 ml-1" style={{ color: TG_BLUE }}>
            {msg.sender?.firstName} {msg.sender?.lastName}
          </span>
        )}

        {/* Reply preview */}
        {msg.replyTo && (
          <div className={cn('mb-1 px-2 py-1.5 rounded-lg border-l-2 text-xs', isOwn ? 'mr-1' : 'ml-1')}
            style={{ backgroundColor: 'rgba(255,255,255,0.07)', borderLeftColor: TG_BLUE, color: '#aab8c2' }}>
            <p className="font-semibold" style={{ color: TG_BLUE }}>
              {msg.replyTo.sender?.firstName}
            </p>
            <p className="truncate">{msg.replyTo.body}</p>
          </div>
        )}

        {/* Bubble */}
        <div
          className="relative px-3 py-2 rounded-2xl text-sm text-white"
          style={{
            backgroundColor: isOwn ? TG_MSG_OUT : TG_MSG_IN,
            borderRadius: isOwn
              ? '18px 18px 4px 18px'
              : '18px 18px 18px 4px',
          }}
        >
          {renderContent()}

          {/* Time + receipt */}
          <div className={cn('flex items-center gap-1 mt-0.5', isOwn ? 'justify-end' : 'justify-start')}>
            <span className="text-[10px]" style={{ color: '#6c8998' }}>{format(new Date(msg.createdAt), 'HH:mm')}</span>
            {isOwn && (
              receipt === 'read'
                ? <CheckCheck className="w-3 h-3" style={{ color: TG_BLUE }} />
                : receipt === 'delivered'
                ? <CheckCheck className="w-3 h-3 text-gray-500" />
                : <Check className="w-3 h-3 text-gray-500" />
            )}
          </div>
        </div>

        {/* Reactions */}
        {reactionGroups.length > 0 && (
          <div className={cn('flex flex-wrap gap-1 mt-1', isOwn ? 'justify-end' : 'justify-start')}>
            {reactionGroups.map(([emoji, count]) => (
              <button key={emoji} onClick={() => onReact(emoji)}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs transition-opacity hover:opacity-80"
                style={{ backgroundColor: 'rgba(42,171,238,0.15)', color: '#e8e8e8' }}>
                {emoji} {count > 1 ? count : ''}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Hover quick actions */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className={cn('flex items-center gap-0.5 flex-shrink-0 self-center', isOwn ? 'flex-row-reverse' : '')}
          >
            <div className="relative">
              <button
                onClick={() => setShowReact(v => !v)}
                className="w-7 h-7 rounded-full flex items-center justify-center transition-colors"
                style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
              >
                <Smile className="w-4 h-4" style={{ color: '#8e99a4' }} />
              </button>
              <AnimatePresence>
                {showReact && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    className={cn(
                      'absolute bottom-8 z-50 rounded-2xl px-2 py-1.5 flex gap-1 shadow-2xl',
                      isOwn ? 'right-0' : 'left-0'
                    )}
                    style={{ backgroundColor: TG_PANEL, border: `1px solid ${TG_BORDER}` }}
                  >
                    {QUICK_EMOJIS.map(e => (
                      <button key={e} onClick={() => { onReact(e); setShowReact(false) }}
                        className="text-lg hover:scale-125 transition-transform leading-none">
                        {e}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button
              onClick={onContextMenu as any}
              className="w-7 h-7 rounded-full flex items-center justify-center transition-colors"
              style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
            >
              <MoreVertical className="w-4 h-4" style={{ color: '#8e99a4' }} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Group Settings Panel ──────────────────────────────────────────────────────
function GroupSettingsPanel({
  conv, isOwner, isAdmin, onClose, onUpdateGroup, onUpdatePermissions, onUpdateRole, onKick, onDeleteGroup,
}: {
  conv: GcConversation
  isOwner: boolean
  isAdmin: boolean
  onClose: () => void
  onUpdateGroup: (data: { name?: string; description?: string; privacy?: string; avatarUrl?: string }) => void
  onUpdatePermissions: (data: { onlyAdminsCanSendMessages?: boolean; onlyAdminsCanSendMedia?: boolean }) => void
  onUpdateRole: (userId: string, role: 'ADMIN' | 'MEMBER' | 'OWNER') => void
  onKick: (userId: string) => void
  onDeleteGroup: () => void
}) {
  const [tab, setTab] = useState<'info' | 'members' | 'permissions'>('info')
  const [editName, setEditName] = useState(conv.name)
  const [editDesc, setEditDesc] = useState(conv.description ?? '')
  const [editPrivacy, setEditPrivacy] = useState(conv.privacy)
  const [msgRestrict, setMsgRestrict] = useState(conv.onlyAdminsCanSendMessages ?? false)
  const [mediaRestrict, setMediaRestrict] = useState(conv.onlyAdminsCanSendMedia ?? false)
  const [avatarUrl, setAvatarUrl] = useState(conv.avatarUrl)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const canEdit = isOwner || isAdmin
  const { upload: uploadAvatar, state: avatarUploadState } = useDmUpload()

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return
    if (avatarInputRef.current) avatarInputRef.current.value = ''
    const result = await uploadAvatar(file)
    if (!result?.mediaUrl) return
    setAvatarUrl(result.mediaUrl)
    onUpdateGroup({ avatarUrl: result.mediaUrl })
  }

  return (
    <div className="w-80 flex flex-col flex-shrink-0" style={{ backgroundColor: TG_DARK, borderLeft: `1px solid ${TG_BORDER}` }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${TG_BORDER}` }}>
        <span className="font-semibold text-white text-sm">Group Settings</span>
        <button onClick={onClose} className="p-1 rounded-full hover:opacity-70">
          <X className="w-5 h-5" style={{ color: '#8e99a4' }} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: TG_BORDER }}>
        {(['info', 'members', 'permissions'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors"
            style={{ color: tab === t ? TG_BLUE : '#8e99a4', borderBottom: tab === t ? `2px solid ${TG_BLUE}` : 'none' }}>
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── INFO TAB ── */}
        {tab === 'info' && (
          <div className="p-4 space-y-4">
            {/* Clickable avatar upload */}
            <div className="flex flex-col items-center py-3">
              <div className="relative group">
                <Av url={avatarUrl} name={conv.name} size={72} />
                {canEdit && (
                  <>
                    <button
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={avatarUploadState.uploading}
                      className="absolute inset-0 rounded-full flex items-center justify-center transition-opacity opacity-0 group-hover:opacity-100"
                      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
                      title="Change group photo"
                    >
                      {avatarUploadState.uploading
                        ? <Loader2 className="w-5 h-5 animate-spin text-white" />
                        : <ImageIcon className="w-5 h-5 text-white" />}
                    </button>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={handleAvatarUpload}
                    />
                  </>
                )}
              </div>
              {canEdit && (
                <p className="text-[10px] mt-1.5" style={{ color: '#6c8998' }}>Tap to change photo</p>
              )}
            </div>
            {canEdit ? (
              <>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: '#8e99a4' }}>Group Name</label>
                  <input value={editName} onChange={e => setEditName(e.target.value)}
                    className="w-full text-sm px-3 py-2 rounded-xl outline-none"
                    style={{ backgroundColor: TG_PANEL, color: '#e8e8e8', border: `1px solid ${TG_BORDER}` }} />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: '#8e99a4' }}>Description</label>
                  <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={3}
                    className="w-full text-sm px-3 py-2 rounded-xl outline-none resize-none"
                    style={{ backgroundColor: TG_PANEL, color: '#e8e8e8', border: `1px solid ${TG_BORDER}` }} />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: '#8e99a4' }}>Privacy</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['PUBLIC', 'PRIVATE', 'SCHOOL_ONLY', 'CLASS_ONLY'] as const).map(p => (
                      <button key={p} onClick={() => setEditPrivacy(p)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{
                          backgroundColor: editPrivacy === p ? 'rgba(42,171,238,0.2)' : TG_PANEL,
                          color: editPrivacy === p ? TG_BLUE : '#8e99a4',
                          border: `1px solid ${editPrivacy === p ? TG_BLUE : TG_BORDER}`,
                        }}>
                        <PrivacyIcon privacy={p} />
                        {p.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => onUpdateGroup({ name: editName, description: editDesc, privacy: editPrivacy })}
                  className="w-full py-2.5 rounded-xl text-white text-sm font-semibold transition-opacity hover:opacity-90"
                  style={{ backgroundColor: TG_BLUE }}>
                  Save Changes
                </button>
                {isOwner && (
                  <button
                    onClick={() => {
                      if (confirm('Delete this group permanently? All messages will be lost. This cannot be undone.')) {
                        onDeleteGroup()
                      }
                    }}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 mt-1"
                    style={{ backgroundColor: 'rgba(255,79,79,0.1)', color: '#ff4f4f', border: '1px solid rgba(255,79,79,0.2)' }}>
                    Delete Group
                  </button>
                )}
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-white">{conv.name}</p>
                {conv.description && <p className="text-xs" style={{ color: '#aab8c2' }}>{conv.description}</p>}
                <div className="flex items-center gap-1.5">
                  <PrivacyIcon privacy={conv.privacy} />
                  <span className="text-xs" style={{ color: '#8e99a4' }}>{conv.privacy.replace('_', ' ')} · {conv.memberCount} members</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── MEMBERS TAB ── */}
        {tab === 'members' && (
          <div>
            {(conv.members || []).map(m => (
              <div key={m.userId} className="flex items-center gap-3 px-4 py-2.5 hover:opacity-80 transition-opacity group"
                style={{ borderBottom: `1px solid ${TG_BORDER}` }}>
                <Av url={m.user?.avatarUrl} name={`${m.user?.firstName} ${m.user?.lastName}`} size={36} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{m.user?.firstName} {m.user?.lastName}</p>
                  <p className="text-[10px] capitalize" style={{ color: m.role === 'OWNER' ? TG_BLUE : m.role === 'ADMIN' ? '#a78bfa' : '#8e99a4' }}>
                    {m.role.toLowerCase()}
                  </p>
                </div>
                {/* Owner can promote/demote/kick; admin can kick members only */}
                {isOwner && m.role !== 'OWNER' && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onUpdateRole(m.userId, m.role === 'ADMIN' ? 'MEMBER' : 'ADMIN')}
                      title={m.role === 'ADMIN' ? 'Demote to Member' : 'Promote to Admin'}
                      className="p-1.5 rounded-lg hover:opacity-70 text-xs font-medium"
                      style={{ backgroundColor: 'rgba(42,171,238,0.1)', color: TG_BLUE }}>
                      {m.role === 'ADMIN' ? <ChevronDown className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Transfer group ownership to ${m.user?.firstName}? You will become an admin.`)) {
                          onUpdateRole(m.userId, 'OWNER')
                        }
                      }}
                      title="Transfer Ownership"
                      className="p-1.5 rounded-lg hover:opacity-70 text-xs"
                      style={{ backgroundColor: 'rgba(251,191,36,0.1)', color: '#f59e0b' }}>
                      <Shield className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => onKick(m.userId)} title="Remove"
                      className="p-1.5 rounded-lg hover:opacity-70"
                      style={{ backgroundColor: 'rgba(255,79,79,0.1)', color: '#ff4f4f' }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {isAdmin && !isOwner && m.role === 'MEMBER' && (
                  <button onClick={() => onKick(m.userId)} title="Remove"
                    className="p-1.5 rounded-lg hover:opacity-70 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ backgroundColor: 'rgba(255,79,79,0.1)', color: '#ff4f4f' }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── PERMISSIONS TAB ── */}
        {tab === 'permissions' && (
          <div className="p-4 space-y-4">
            <p className="text-xs" style={{ color: '#8e99a4' }}>
              Control what members can do in this group.
            </p>
            {canEdit ? (
              <>
                <div className="flex items-center justify-between py-3 px-1" style={{ borderBottom: `1px solid ${TG_BORDER}` }}>
                  <div>
                    <p className="text-sm font-medium text-white">Restrict Messages</p>
                    <p className="text-[11px] mt-0.5" style={{ color: '#8e99a4' }}>Only admins can send messages</p>
                  </div>
                  <button
                    onClick={() => {
                      setMsgRestrict(v => { onUpdatePermissions({ onlyAdminsCanSendMessages: !v }); return !v })
                    }}
                    className="w-12 h-6 rounded-full relative transition-colors flex-shrink-0"
                    style={{ backgroundColor: msgRestrict ? TG_BLUE : '#374151' }}>
                    <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
                      style={{ transform: msgRestrict ? 'translateX(26px)' : 'translateX(2px)' }} />
                  </button>
                </div>
                <div className="flex items-center justify-between py-3 px-1">
                  <div>
                    <p className="text-sm font-medium text-white">Restrict Media</p>
                    <p className="text-[11px] mt-0.5" style={{ color: '#8e99a4' }}>Only admins can send photos, videos, files</p>
                  </div>
                  <button
                    onClick={() => {
                      setMediaRestrict(v => { onUpdatePermissions({ onlyAdminsCanSendMedia: !v }); return !v })
                    }}
                    className="w-12 h-6 rounded-full relative transition-colors flex-shrink-0"
                    style={{ backgroundColor: mediaRestrict ? TG_BLUE : '#374151' }}>
                    <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
                      style={{ transform: mediaRestrict ? 'translateX(26px)' : 'translateX(2px)' }} />
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-white">Message Restriction: <span style={{ color: TG_BLUE }}>{conv.onlyAdminsCanSendMessages ? 'Admins only' : 'All members'}</span></p>
                <p className="text-sm text-white">Media Restriction: <span style={{ color: TG_BLUE }}>{conv.onlyAdminsCanSendMedia ? 'Admins only' : 'All members'}</span></p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Right panel: Group Info ───────────────────────────────────────────────────
function GroupInfoPanel({
  conv, onClose, onLeave, onAddMember,
}: {
  conv: GcConversation
  onClose: () => void
  onLeave: () => void
  onAddMember: () => void
}) {
  return (
    <div className="w-72 flex flex-col flex-shrink-0" style={{ backgroundColor: TG_DARK, borderLeft: `1px solid ${TG_BORDER}` }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${TG_BORDER}` }}>
        <span className="font-semibold text-white">Group Info</span>
        <button onClick={onClose} className="p-1 rounded-full hover:opacity-70 transition-opacity">
          <X className="w-5 h-5" style={{ color: '#8e99a4' }} />
        </button>
      </div>

      {/* Group avatar + name */}
      <div className="flex flex-col items-center py-6 px-4" style={{ borderBottom: `1px solid ${TG_BORDER}` }}>
        <Av url={conv.avatarUrl} name={conv.name} size={80} />
        <h2 className="mt-3 font-bold text-white text-lg text-center">{conv.name}</h2>
        <div className="flex items-center gap-1.5 mt-1">
          <PrivacyIcon privacy={conv.privacy} />
          <span className="text-xs" style={{ color: '#8e99a4' }}>
            {conv.privacy.replace('_', ' ')} · {conv.memberCount} members
          </span>
        </div>
        {conv.description && (
          <p className="mt-2 text-sm text-center" style={{ color: '#aab8c2' }}>{conv.description}</p>
        )}
      </div>

      {/* Actions */}
      <div className="p-3 space-y-1" style={{ borderBottom: `1px solid ${TG_BORDER}` }}>
        <button onClick={onAddMember}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors hover:opacity-80 text-sm font-medium"
          style={{ color: TG_BLUE }}>
          <UserPlus className="w-4 h-4" />
          Add Member
        </button>
        <button onClick={onLeave}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors hover:opacity-80 text-sm font-medium"
          style={{ color: '#ff4f4f' }}>
          <LogOut className="w-4 h-4" />
          Leave Group
        </button>
      </div>

      {/* Member list */}
      <div className="flex-1 overflow-y-auto">
        <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: '#8e99a4' }}>
          {conv.memberCount} Members
        </p>
        {(conv.members || []).map(m => (
          <div key={m.userId} className="flex items-center gap-3 px-4 py-2.5 hover:opacity-80 transition-opacity">
            <Av url={m.user?.avatarUrl} name={`${m.user?.firstName} ${m.user?.lastName}`} size={36} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{m.user?.firstName} {m.user?.lastName}</p>
              <p className="text-[10px]" style={{ color: '#8e99a4' }}>{m.role}</p>
            </div>
            {(m.role === 'OWNER' || m.role === 'ADMIN') && (
              <Shield className="w-3.5 h-3.5 flex-shrink-0" style={{ color: TG_BLUE }} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function GroupChatPage() {
  const { toast } = useToast()
  const { user } = useAuthStore()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const qc = useQueryClient()

  const {
    conversations, setConversations, activeConvId, setActiveConvId,
    messages, setMessages, prependMessages, addMessage, removeMessage,
    updateMessagePin, updateReaction, typing, setTyping, clearUnread,
    showCreate, setShowCreate,
  } = useGroupChatStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [replyTo, setReplyTo] = useState<GcMessage | null>(null)
  const [editingMsg, setEditingMsg] = useState<GcMessage | null>(null)
  const [contextMenu, setContextMenu] = useState<CtxMenu | null>(null)
  const [forwardMsg, setForwardMsg] = useState<GcMessage | null>(null)
  const [showForwardPicker, setShowForwardPicker] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showThreeDot, setShowThreeDot] = useState(false)
  const [addMemberSearch, setAddMemberSearch] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  // In-thread search
  const [showGroupSearch, setShowGroupSearch] = useState(false)
  const [groupSearchQuery, setGroupSearchQuery] = useState('')
  const [groupSearchResults, setGroupSearchResults] = useState<GcMessage[]>([])
  const [groupSearchLoading, setGroupSearchLoading] = useState(false)
  const groupSearchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Create group form
  const [groupName, setGroupName] = useState('')
  const [groupDesc, setGroupDesc] = useState('')
  const [groupPrivacy, setGroupPrivacy] = useState<'PUBLIC' | 'PRIVATE' | 'SCHOOL_ONLY' | 'CLASS_ONLY'>('PRIVATE')
  const [groupAvatarUrl, setGroupAvatarUrl] = useState<string | null>(null)
  const [groupAvatarUploading, setGroupAvatarUploading] = useState(false)
  const createAvatarRef = useRef<HTMLInputElement>(null)
  const { upload: uploadGroupAvatar, state: groupAvatarUploadState } = useDmUpload()

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastTypingEmit = useRef(0)

  // Reset load-more when conversation changes
  useEffect(() => { setHasMore(true); setLoadingMore(false) }, [activeConvId])

  // Fetch conversations
  const { isLoading: convsLoading } = useQuery({
    queryKey: ['group-chat-conversations'],
    queryFn: async () => {
      const res = await groupChatApi.list()
      const data = Array.isArray(res.data?.data) ? res.data.data : []
      setConversations(data)
      return data
    },
  })

  // Fetch messages
  const { isLoading: msgsLoading } = useQuery({
    queryKey: ['group-chat-messages', activeConvId],
    queryFn: async () => {
      if (!activeConvId) return []
      const res = await groupChatApi.messages(activeConvId, undefined, 50)
      const raw = Array.isArray(res.data?.data) ? res.data.data : (Array.isArray(res.data) ? res.data : [])
      const data = raw.map((m: any) => ({
        ...m,
        readBy: Array.isArray(m.reads) ? m.reads.map((r: any) => r.userId) : (m.readBy ?? []),
      }))
      setMessages(activeConvId, data)
      setHasMore(data.length >= 50)
      const toMark = data.slice(-20).map((m: any) => m.id)
      if (toMark.length > 0) {
        await groupChatApi.markRead(activeConvId, toMark)
        clearUnread(activeConvId)
      }
      return data
    },
    enabled: !!activeConvId,
  })

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [(activeConvId ? (messages[activeConvId] ?? []) : []).length, activeConvId])

  // Load older messages
  const loadMore = useCallback(async () => {
    if (!activeConvId || loadingMore || !hasMore) return
    const currentMsgs = useGroupChatStore.getState().messages[activeConvId] ?? []
    const oldest = currentMsgs[0]
    if (!oldest) return
    setLoadingMore(true)
    try {
      const res = await groupChatApi.messages(activeConvId, oldest.createdAt, 50)
      const raw = Array.isArray(res.data?.data) ? res.data.data : (Array.isArray(res.data) ? res.data : [])
      const older = raw.map((m: any) => ({
        ...m,
        readBy: Array.isArray(m.reads) ? m.reads.map((r: any) => r.userId) : (m.readBy ?? []),
      }))
      if (older.length < 50) setHasMore(false)
      prependMessages(activeConvId, older)
    } catch { toast({ title: 'Failed to load history', variant: 'destructive' }) }
    finally { setLoadingMore(false) }
  }, [activeConvId, loadingMore, hasMore, prependMessages, toast])

  // Socket
  useEffect(() => {
    const socket = getSocket()
    if (!socket || !activeConvId) return
    socket.emit('group:join', activeConvId)

    const onMsg = (msg: GcMessage) => {
      if (msg.conversationId === activeConvId) {
        const normalised = { ...msg, readBy: Array.isArray((msg as any).reads) ? (msg as any).reads.map((r: any) => r.userId) : (msg.readBy ?? []) }
        addMessage(activeConvId, normalised)
        groupChatApi.markRead(activeConvId, [msg.id])
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }
    }
    const onReaction = (data: { messageId: string; reaction: any }) => {
      if (activeConvId) updateReaction(activeConvId, data.messageId, data.reaction)
    }
    const onTypingStart = (data: { convId: string; userId: string; userName: string }) => {
      if (data.convId === activeConvId && data.userId !== user?.id) setTyping(activeConvId, data.userId, true)
    }
    const onTypingStop = (data: { convId: string; userId: string }) => {
      if (data.convId === activeConvId) setTyping(activeConvId, data.userId, false)
    }
    const onDeleted = (data: { messageId: string; conversationId: string }) => {
      if (data.conversationId === activeConvId) removeMessage(activeConvId, data.messageId)
    }
    const onPinned = (data: { messageId: string; conversationId: string; pin: boolean }) => {
      if (data.conversationId === activeConvId) updateMessagePin(activeConvId, data.messageId, data.pin)
    }
    const onEdited = (data: { messageId: string; conversationId: string; newBody: string }) => {
      if (data.conversationId === activeConvId) {
        // Update message body in place
        const msgs = useGroupChatStore.getState().messages[activeConvId] ?? []
        useGroupChatStore.setState(s => ({
          messages: {
            ...s.messages,
            [activeConvId]: msgs.map(m =>
              m.id === data.messageId ? { ...m, body: data.newBody } : m
            )
          }
        }))
      }
    }
    // Refresh conversation when roles/ownership change
    const onRoleChanged = (data: { conversationId: string }) => {
      if (data.conversationId === activeConvId) {
        qc.invalidateQueries({ queryKey: ['group-chat-conversations'] })
      }
    }
    const onOwnershipTransferred = (data: { conversationId: string }) => {
      if (data.conversationId === activeConvId) {
        qc.invalidateQueries({ queryKey: ['group-chat-conversations'] })
        toast({ title: 'Group ownership has been transferred' })
      }
    }
    const onSettingsUpdated = (data: { conversationId: string }) => {
      if (data.conversationId === activeConvId) {
        qc.invalidateQueries({ queryKey: ['group-chat-conversations'] })
      }
    }
    const onGroupDeleted = (data: { conversationId: string; name: string }) => {
      // Remove from store regardless of which group was deleted
      setConversations(useGroupChatStore.getState().conversations.filter(c => c.id !== data.conversationId))
      if (data.conversationId === activeConvId) {
        setActiveConvId(null)
        setShowSettings(false)
        toast({ title: `Group "${data.name}" has been deleted` })
      }
    }

    socket.on('group:message', onMsg)
    socket.on('group:reaction', onReaction)
    socket.on('group:typing_start', onTypingStart)
    socket.on('group:typing_stop', onTypingStop)
    socket.on('group:message_deleted', onDeleted)
    socket.on('group:message_pinned', onPinned)
    socket.on('group:message_edited', onEdited)
    socket.on('group:member_role_changed', onRoleChanged)
    socket.on('group:ownership_transferred', onOwnershipTransferred)
    socket.on('group:settings_updated', onSettingsUpdated)
    socket.on('group:permissions_updated', onSettingsUpdated)
    socket.on('group:deleted', onGroupDeleted)
    // BUG-9 FIX: Refresh conversation when members are added or removed
    const onMemberChanged = (data: { conversationId: string; memberCount?: number }) => {
      if (data.conversationId === activeConvId) {
        qc.invalidateQueries({ queryKey: ['group-chat-conversations'] })
      }
    }
    socket.on('group:member_added', onMemberChanged)
    socket.on('group:member_removed', onMemberChanged)

    return () => {
      socket.emit('group:leave', activeConvId)
      socket.off('group:message', onMsg)
      socket.off('group:reaction', onReaction)
      socket.off('group:typing_start', onTypingStart)
      socket.off('group:typing_stop', onTypingStop)
      socket.off('group:message_deleted', onDeleted)
      socket.off('group:message_pinned', onPinned)
      socket.off('group:message_edited', onEdited)
      socket.off('group:member_role_changed', onRoleChanged)
      socket.off('group:ownership_transferred', onOwnershipTransferred)
      socket.off('group:settings_updated', onSettingsUpdated)
      socket.off('group:permissions_updated', onSettingsUpdated)
      socket.off('group:deleted', onGroupDeleted)
      socket.off('group:member_added', onMemberChanged)
      socket.off('group:member_removed', onMemberChanged)
    }
  }, [activeConvId, user?.id, addMessage, removeMessage, updateMessagePin, updateReaction, setTyping, qc, toast, setConversations, setActiveConvId, conversations])

  // Typing emit (used by GcInputBar callback)
  const handleTyping = useCallback(() => {
    if (!activeConvId) return
    const now = Date.now()
    if (now - lastTypingEmit.current > 2500) {
      // BUG-5 FIX: Include the user's name so the server can relay it as `userName`
      getSocket()?.emit('group:typing_start', { convId: activeConvId, name: user?.firstName })
      lastTypingEmit.current = now
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => getSocket()?.emit('group:typing_stop', { convId: activeConvId }), 2500)
  }, [activeConvId, user?.firstName])

  // Called by GcInputBar after any successful send — scroll + invalidate
  const handleSent = useCallback(() => {
    // Do NOT invalidate group-chat-messages — the socket listener (group:message)
    // already calls addMessage() to add the new message to the store.
    // Invalidating would trigger a full refetch which previously caused deleted
    // messages to reappear.
    qc.invalidateQueries({ queryKey: ['group-chat-conversations'] })
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }, [activeConvId, qc])

  const handleReaction = async (msgId: string, emoji: string) => {
    try { await groupChatApi.react(msgId, emoji) } catch {}
  }

  const handleDelete = async (msgId: string) => {
    if (!activeConvId) return
    try {
      await groupChatApi.deleteMessage(msgId)
      removeMessage(activeConvId, msgId)
      setContextMenu(null)
    } catch { toast({ title: 'Failed to delete', variant: 'destructive' }) }
  }

  const handlePin = async (msg: GcMessage) => {
    if (!activeConvId) return
    try {
      await groupChatApi.pinMessage(activeConvId, msg.id, !msg.isPinned)
      updateMessagePin(activeConvId, msg.id, !msg.isPinned)
      toast({ title: msg.isPinned ? 'Unpinned' : 'Pinned' })
    } catch (e: any) { toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' }) }
  }

  const handleLeave = async () => {
    if (!activeConvId || !user?.id) return
    try {
      await groupChatApi.removeMember(activeConvId, user.id)
      setActiveConvId(null); setShowInfo(false)
    } catch { toast({ title: 'Failed to leave', variant: 'destructive' }) }
  }

  const handleUpdateGroup = async (data: { name?: string; description?: string; privacy?: string; avatarUrl?: string }) => {
    if (!activeConvId) return
    // Optimistic update — apply immediately so the UI reflects the change
    setConversations(conversations.map(c => c.id === activeConvId ? { ...c, ...data } : c))
    try {
      await groupChatApi.update(activeConvId, data as any)
      toast({ title: data.avatarUrl ? 'Group photo updated' : 'Group updated' })
    } catch (e: any) {
      // Revert optimistic update on failure
      qc.invalidateQueries({ queryKey: ['group-chat-conversations'] })
      toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
    }
  }

  const handleUpdatePermissions = async (data: { onlyAdminsCanSendMessages?: boolean; onlyAdminsCanSendMedia?: boolean }) => {
    if (!activeConvId) return
    try {
      await groupChatApi.updatePermissions(activeConvId, data)
      setConversations(conversations.map(c => c.id === activeConvId ? { ...c, ...data } : c))
      toast({ title: 'Permissions updated' })
    } catch (e: any) { toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' }) }
  }

  const handleUpdateRole = async (targetUserId: string, role: 'ADMIN' | 'MEMBER' | 'OWNER') => {
    if (!activeConvId) return
    try {
      await groupChatApi.updateMemberRole(activeConvId, targetUserId, role)
      qc.invalidateQueries({ queryKey: ['group-chat-conversations'] })
      const msg = role === 'OWNER' ? 'Ownership transferred' : role === 'ADMIN' ? 'Promoted to admin' : 'Demoted to member'
      toast({ title: msg })
    } catch (e: any) { toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' }) }
  }

  const handleKickMember = async (targetUserId: string) => {
    if (!activeConvId) return
    try {
      await groupChatApi.removeMember(activeConvId, targetUserId)
      qc.invalidateQueries({ queryKey: ['group-chat-conversations'] })
      toast({ title: 'Member removed' })
    } catch (e: any) { toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' }) }
  }

  const handleDeleteGroup = async () => {
    if (!activeConvId) return
    try {
      await groupChatApi.deleteGroup(activeConvId)
      setConversations(conversations.filter(c => c.id !== activeConvId))
      setActiveConvId(null)
      setShowSettings(false)
      toast({ title: 'Group deleted' })
    } catch (e: any) { toast({ title: e?.response?.data?.message || 'Failed to delete group', variant: 'destructive' }) }
  }

  const handleForward = async (targetConvId: string) => {
    if (!forwardMsg) return
    try {
      const payload: any = {
        type: forwardMsg.type ?? 'TEXT',
      }
      if (forwardMsg.body?.trim()) payload.body = forwardMsg.body.trim()
      if (forwardMsg.type && forwardMsg.type !== 'TEXT' && forwardMsg.mediaUrl) {
        payload.mediaUrl = forwardMsg.mediaUrl
        if (forwardMsg.mimeType) payload.mimeType = forwardMsg.mimeType
        if (forwardMsg.fileSize) payload.fileSize = forwardMsg.fileSize
        if (forwardMsg.fileName) payload.fileName = forwardMsg.fileName
        if (forwardMsg.duration) payload.duration = forwardMsg.duration
      }
      if (!payload.body && !payload.mediaUrl) {
        toast({ title: 'Nothing to forward', variant: 'destructive' }); return
      }
      await groupChatApi.send(targetConvId, payload)
      setShowForwardPicker(false); setForwardMsg(null)
      toast({ title: 'Message forwarded' })
    } catch (e: any) { toast({ title: e?.response?.data?.message || 'Forward failed', variant: 'destructive' }) }
  }

  // Build ShareSheet payload from the message being forwarded
  const sharePayload: SharePayload | null = forwardMsg ? {
    body:     forwardMsg.body,
    type:     forwardMsg.type ?? 'TEXT',
    msgType:  forwardMsg.type ?? 'TEXT',
    mediaUrl: forwardMsg.mediaUrl,
    mimeType: forwardMsg.mimeType,
    fileSize: forwardMsg.fileSize,
    fileName: forwardMsg.fileName,
    duration: forwardMsg.duration,
  } : null

  const handleGroupSearch = useCallback((q: string) => {
    setGroupSearchQuery(q)
    clearTimeout(groupSearchTimer.current)
    if (!q.trim() || !activeConvId) { setGroupSearchResults([]); return }
    groupSearchTimer.current = setTimeout(async () => {
      setGroupSearchLoading(true)
      try {
        const r = await groupChatApi.searchMessages(activeConvId, q.trim())
        setGroupSearchResults(r.data.data ?? [])
      } catch { setGroupSearchResults([]) }
      finally { setGroupSearchLoading(false) }
    }, 400)
  }, [activeConvId])

  const createGroupMutation = useMutation({
    mutationFn: () => groupChatApi.create({ name: groupName, description: groupDesc, privacy: groupPrivacy, avatarUrl: groupAvatarUrl ?? undefined }),
    onSuccess: (res) => {
      const newGroup = res.data?.data
      if (newGroup) { setConversations([newGroup, ...conversations]); setActiveConvId(newGroup.id) }
      setShowCreate(false); setGroupName(''); setGroupDesc(''); setGroupAvatarUrl(null)
      toast({ title: 'Group created' })
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' }),
  })

  // Search users for add member — uses social/search which is platform-wide (no school restriction)
  const { data: addMemberResults } = useQuery({
    queryKey: ['users-search', addMemberSearch],
    queryFn: () => api.get('/social/search', { params: { q: addMemberSearch, limit: 8 } }).then(r => r.data.data),
    enabled: addMemberSearch.length >= 2,
  })

  // DM conversations for ShareSheet
  const { data: dmConvs = [] } = useQuery({
    queryKey: ['dm-conversations'],
    queryFn: () => api.get('/dm/conversations').then(r => r.data.data ?? []),
    staleTime: 60000,
  })

  // Derived
  const activeConv = conversations.find(c => c.id === activeConvId)
  const activeMessages = activeConvId ? (messages[activeConvId] ?? []) : []
  const memberIds = activeConv?.members?.map(m => m.userId) ?? []
  const currentUserMember = activeConv?.members?.find(m => m.userId === user?.id)
  const isAdmin = currentUserMember?.role === 'ADMIN' || currentUserMember?.role === 'OWNER'
  const isOwner = currentUserMember?.role === 'OWNER'
  const pinnedMsg = activeMessages.find(m => m.isPinned)
  const typingNames = (activeConvId ? (typing[activeConvId] ?? []) : [])
    .map(uid => activeConv?.members?.find(m => m.userId === uid)?.user?.firstName ?? 'Someone')

  const filteredConvs = conversations.filter(c =>
    c.name?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // DOM windowing
  const visibleMessages = useMemo(() =>
    activeMessages.length > VIRTUALIZE_THRESHOLD
      ? activeMessages.slice(-MESSAGES_DOM_WINDOW)
      : activeMessages,
    [activeMessages]
  )

  // Group by date
  const groupedByDate = useMemo(() => {
    const groups: Record<string, GcMessage[]> = {}
    for (const msg of visibleMessages) {
      const key = new Date(msg.createdAt).toDateString()
      if (!groups[key]) groups[key] = []
      groups[key].push(msg)
    }
    return groups
  }, [visibleMessages])

  // Group color per sender (stable hash)
  const senderColors = ['#e17076', '#faa774', '#a695e7', '#7bc862', '#6ec9cb', '#65aadd', '#ee7aae']
  const colorForUser = (uid: string) => senderColors[uid.charCodeAt(0) % senderColors.length]

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden" style={{ backgroundColor: TG_DARK }}>

      {/* ── LEFT SIDEBAR ── */}
      <div className={cn(
        'flex flex-col flex-shrink-0',
        activeConvId ? 'hidden md:flex w-[320px]' : 'flex w-full md:w-[320px]'
      )} style={{ backgroundColor: TG_DARK, borderRight: `1px solid ${TG_BORDER}` }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: TG_PANEL }}>
          <button className="w-9 h-9 rounded-full flex items-center justify-center hover:opacity-70 transition-opacity">
            <MoreVertical className="w-5 h-5" style={{ color: '#8e99a4' }} />
          </button>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: '#8e99a4' }} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search"
              className="w-full pl-9 pr-3 py-1.5 text-sm rounded-xl outline-none"
              style={{ backgroundColor: TG_DARK, color: '#e8e8e8', border: 'none' }}
            />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:opacity-70 transition-opacity"
            style={{ display: isSuperAdmin ? 'none' : undefined }}
          >
            <Plus className="w-5 h-5" style={{ color: TG_BLUE }} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {convsLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-2">
                  <div className="w-12 h-12 rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor: TG_PANEL }} />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 rounded animate-pulse w-3/4" style={{ backgroundColor: TG_PANEL }} />
                    <div className="h-2.5 rounded animate-pulse w-1/2" style={{ backgroundColor: TG_PANEL }} />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredConvs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <MessageSquare className="w-12 h-12 mb-3 opacity-20" style={{ color: '#8e99a4' }} />
              <p className="text-sm" style={{ color: '#8e99a4' }}>
                {searchQuery ? 'No groups found' : 'No groups yet'}
              </p>
              <button onClick={() => setShowCreate(true)}
                className="mt-3 text-sm font-medium" style={{ color: TG_BLUE, display: isSuperAdmin ? 'none' : undefined }}>
                Create a group
              </button>
            </div>
          ) : filteredConvs.map(conv => (
            <button
              key={conv.id}
              onClick={() => { setActiveConvId(conv.id); clearUnread(conv.id) }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
              style={{ backgroundColor: activeConvId === conv.id ? TG_ACTIVE : 'transparent' }}
            >
              <div className="relative">
                <Av url={conv.avatarUrl} name={conv.name} size={48} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="text-sm font-semibold truncate text-white">{conv.name}</p>
                    <PrivacyIcon privacy={conv.privacy} />
                  </div>
                  {conv.lastMessageAt && (
                    <span className="text-[10px] flex-shrink-0 ml-1" style={{ color: (conv.unread ?? 0) > 0 ? TG_BLUE : '#8e99a4' }}>
                      {fmtTime(conv.lastMessageAt)}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <p className="text-xs truncate" style={{ color: '#8e99a4' }}>
                    {conv.lastMessage || 'No messages yet'}
                  </p>
                  {(conv.unread ?? 0) > 0 && (
                    <span className="ml-2 min-w-[18px] h-[18px] rounded-full text-white text-[10px] font-bold flex items-center justify-center px-1 flex-shrink-0"
                      style={{ backgroundColor: TG_BLUE }}>
                      {conv.unread}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── CHAT WINDOW ── */}
      <div className={cn('flex-1 flex flex-col min-w-0', !activeConvId && 'hidden md:flex')}
        style={{ backgroundColor: '#0e1621' }}>
        {activeConv ? (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0"
              style={{ backgroundColor: TG_PANEL, borderBottom: `1px solid ${TG_BORDER}` }}>
              <button className="md:hidden p-1.5 rounded-full hover:opacity-70" onClick={() => setActiveConvId(null)}>
                <ArrowLeft className="w-5 h-5" style={{ color: '#8e99a4' }} />
              </button>
              <button onClick={() => setShowInfo(v => !v)}>
                <Av url={activeConv.avatarUrl} name={activeConv.name} size={40} />
              </button>
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setShowInfo(v => !v)}>
                <p className="font-semibold text-white text-sm">{activeConv.name}</p>
                <p className="text-[11px]" style={{ color: TG_BLUE }}>
                  {typingNames.length > 0 ? `${typingNames[0]} is typing…` : `${activeConv.memberCount} members`}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setShowGroupSearch(v => !v); setGroupSearchQuery(''); setGroupSearchResults([]) }}
                  className="w-9 h-9 rounded-full flex items-center justify-center hover:opacity-70 transition-opacity"
                  style={showGroupSearch ? { backgroundColor: 'rgba(42,171,238,0.15)' } : {}}
                >
                  <Search className="w-5 h-5" style={{ color: showGroupSearch ? TG_BLUE : '#8e99a4' }} />
                </button>

                {/* Three-dot menu — owner/admin get Settings; all get Leave */}
                <div className="relative">
                  <button
                    onClick={() => setShowThreeDot(v => !v)}
                    className="w-9 h-9 rounded-full flex items-center justify-center hover:opacity-70 transition-opacity"
                    style={showThreeDot ? { backgroundColor: 'rgba(42,171,238,0.15)' } : {}}
                  >
                    <MoreVertical className="w-5 h-5" style={{ color: '#8e99a4' }} />
                  </button>
                  <AnimatePresence>
                    {showThreeDot && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowThreeDot(false)} />
                        <motion.div
                          initial={{ opacity: 0, scale: 0.9, y: -4 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.9, y: -4 }}
                          className="absolute right-0 top-10 z-50 rounded-xl shadow-2xl overflow-hidden min-w-[200px]"
                          style={{ backgroundColor: TG_PANEL, border: `1px solid ${TG_BORDER}` }}
                        >
                          {(isAdmin || isOwner) && (
                            <button
                              onClick={() => { setShowSettings(true); setShowInfo(false); setShowThreeDot(false) }}
                              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white hover:opacity-80 transition-opacity"
                            >
                              <Settings className="w-4 h-4" style={{ color: TG_BLUE }} />
                              Group Settings
                            </button>
                          )}
                          {(isAdmin || isOwner) && (
                            <button
                              onClick={() => { setShowAddMember(true); setShowThreeDot(false) }}
                              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white hover:opacity-80 transition-opacity"
                              style={{ borderTop: `1px solid ${TG_BORDER}` }}
                            >
                              <UserPlus className="w-4 h-4" style={{ color: TG_BLUE }} />
                              Add Member
                            </button>
                          )}
                          <button
                            onClick={() => { setShowInfo(v => !v); setShowSettings(false); setShowThreeDot(false) }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white hover:opacity-80 transition-opacity"
                            style={{ borderTop: `1px solid ${TG_BORDER}` }}
                          >
                            <Info className="w-4 h-4" style={{ color: '#8e99a4' }} />
                            Group Info
                          </button>
                          <button
                            onClick={async () => {
                              setShowThreeDot(false)
                              if (confirm('Leave this group?')) handleLeave()
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:opacity-80 transition-opacity"
                            style={{ color: '#ff4f4f', borderTop: `1px solid ${TG_BORDER}` }}
                          >
                            <LogOut className="w-4 h-4" />
                            Leave Group
                          </button>
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>

                <button
                  onClick={() => { setShowInfo(v => !v); setShowSettings(false) }}
                  className="w-9 h-9 rounded-full flex items-center justify-center hover:opacity-70 transition-opacity"
                  style={showInfo ? { backgroundColor: 'rgba(42,171,238,0.15)' } : {}}
                >
                  <Info className="w-5 h-5" style={{ color: showInfo ? TG_BLUE : '#8e99a4' }} />
                </button>
              </div>
            </div>

            {/* In-thread search bar */}
            <AnimatePresence>
              {showGroupSearch && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="flex items-center gap-2 px-4 py-2 flex-shrink-0"
                  style={{ backgroundColor: TG_PANEL, borderBottom: `1px solid ${TG_BORDER}` }}>
                  <Search className="w-4 h-4 flex-shrink-0" style={{ color: '#8e99a4' }} />
                  <input
                    autoFocus
                    value={groupSearchQuery}
                    onChange={e => handleGroupSearch(e.target.value)}
                    placeholder="Search in group…"
                    className="flex-1 text-sm outline-none bg-transparent placeholder:text-gray-500"
                    style={{ color: '#e8e8e8' }}
                  />
                  {groupSearchLoading && <Loader2 className="w-4 h-4 animate-spin" style={{ color: TG_BLUE }} />}
                  {groupSearchQuery && !groupSearchLoading && (
                    <span className="text-[10px]" style={{ color: '#8e99a4' }}>{groupSearchResults.length} result{groupSearchResults.length !== 1 ? 's' : ''}</span>
                  )}
                  <button onClick={() => { setShowGroupSearch(false); setGroupSearchQuery(''); setGroupSearchResults([]) }}
                    className="p-1 hover:opacity-70">
                    <X className="w-4 h-4" style={{ color: '#8e99a4' }} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Search results overlay */}
            {showGroupSearch && groupSearchResults.length > 0 && (
              <div className="flex-shrink-0 max-h-56 overflow-y-auto"
                style={{ backgroundColor: TG_DARK, borderBottom: `1px solid ${TG_BORDER}` }}>
                {groupSearchResults.map(m => (
                  <div key={m.id} className="px-4 py-3 cursor-pointer hover:opacity-80 transition-opacity"
                    style={{ borderBottom: `1px solid ${TG_BORDER}` }}>
                    <p className="text-[10px] mb-0.5" style={{ color: '#6c8998' }}>
                      {m.sender?.firstName} · {format(new Date(m.createdAt), 'MMM d, HH:mm')}
                    </p>
                    <p className="text-sm truncate" style={{ color: '#e8e8e8' }}>{m.body}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Pinned message */}
            <AnimatePresence>
              {pinnedMsg && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="flex items-center gap-3 px-4 py-2 flex-shrink-0 cursor-pointer"
                  style={{ backgroundColor: 'rgba(42,171,238,0.1)', borderBottom: `1px solid ${TG_BORDER}` }}
                >
                  <Pin className="w-4 h-4 flex-shrink-0" style={{ color: TG_BLUE }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold" style={{ color: TG_BLUE }}>Pinned Message</p>
                    <p className="text-xs truncate" style={{ color: '#aab8c2' }}>{pinnedMsg.body}</p>
                  </div>
                  <button onClick={() => handlePin(pinnedMsg)}
                    className="p-1 hover:opacity-70 transition-opacity">
                    <X className="w-4 h-4" style={{ color: '#8e99a4' }} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Messages area */}
            <div
              className="flex-1 overflow-y-auto py-2"
              style={{
                backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.03) 1px, transparent 0)`,
                backgroundSize: '24px 24px',
              }}
              onScroll={e => { if ((e.target as HTMLDivElement).scrollTop < 80) loadMore() }}
            >
              {loadingMore && (
                <div className="flex justify-center py-2">
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: TG_BLUE }} />
                </div>
              )}
              {!loadingMore && !hasMore && activeMessages.length > 0 && (
                <div className="flex justify-center py-2">
                  <span className="text-[10px] px-3 py-1 rounded-full" style={{ color: '#6c8998', backgroundColor: 'rgba(17,27,38,0.7)' }}>
                    Beginning of group
                  </span>
                </div>
              )}

              {msgsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: TG_BLUE }} />
                </div>
              ) : activeMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mb-3"
                    style={{ backgroundColor: 'rgba(42,171,238,0.1)' }}>
                    <MessageSquare className="w-8 h-8" style={{ color: TG_BLUE }} />
                  </div>
                  <p className="text-sm font-medium text-white">{activeConv.name}</p>
                  <p className="text-xs mt-1" style={{ color: '#8e99a4' }}>No messages yet. Say something!</p>
                </div>
              ) : (
                Object.entries(groupedByDate).map(([dateKey, msgs]) => (
                  <div key={dateKey}>
                    <DateSep dateKey={dateKey} />
                    {buildMessageClusters(msgs).map(({ msg, showAvatar }) => {
                      const isOwn = msg.senderId === user?.id
                      return (
                        <Bubble
                          key={msg.id}
                          msg={msg}
                          isOwn={isOwn}
                          showAvatar={showAvatar}
                          showName={showAvatar && !isOwn}
                          memberIds={memberIds}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            setContextMenu({ x: e.clientX, y: e.clientY, msg })
                          }}
                          onReact={(emoji) => handleReaction(msg.id, emoji)}
                        />
                      )
                    })}
                  </div>
                ))
              )}

              <TypingRow names={typingNames} />
              <div ref={messagesEndRef} />
            </div>

            {/* Reply preview — now handled inside GcInputBar */}

            {/* Input bar — GcInputBar handles text + all media + voice */}
            <GcInputBar
              convId={activeConvId}
              replyTo={replyTo}
              editingMsg={editingMsg}
              onSent={handleSent}
              onTyping={handleTyping}
              onClearReply={() => setReplyTo(null)}
              onCancelEdit={() => setEditingMsg(null)}
              isAdmin={isAdmin}
              onlyAdminsCanSendMessages={activeConv?.onlyAdminsCanSendMessages}
              onlyAdminsCanSendMedia={activeConv?.onlyAdminsCanSendMedia}
            />
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="w-24 h-24 rounded-full flex items-center justify-center mb-6"
              style={{ backgroundColor: 'rgba(42,171,238,0.1)' }}>
              <Users className="w-12 h-12" style={{ color: TG_BLUE }} />
            </div>
            <h2 className="text-2xl font-light text-white mb-2">Open a group</h2>
            <p className="text-sm text-center max-w-xs" style={{ color: '#8e99a4' }}>
              {isSuperAdmin
                ? 'Select a group from the left to view messages.'
                : 'Select a group from the left to start messaging, or create a new one.'}
            </p>
            {!isSuperAdmin && (
              <button
                onClick={() => setShowCreate(true)}
                className="mt-6 px-6 py-2.5 rounded-full text-white font-semibold text-sm transition-all hover:opacity-90"
                style={{ backgroundColor: TG_BLUE }}
              >
                Create Group
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── RIGHT INFO PANEL ── */}
      <AnimatePresence>
        {showInfo && activeConv && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 288, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="overflow-hidden flex-shrink-0"
          >
            <GroupInfoPanel
              conv={activeConv}
              onClose={() => setShowInfo(false)}
              onLeave={handleLeave}
              onAddMember={() => setShowAddMember(true)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── RIGHT SETTINGS PANEL ── */}
      <AnimatePresence>
        {showSettings && activeConv && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="overflow-hidden flex-shrink-0"
          >
            <GroupSettingsPanel
              conv={activeConv}
              isOwner={isOwner}
              isAdmin={isAdmin}
              onClose={() => setShowSettings(false)}
              onUpdateGroup={handleUpdateGroup}
              onUpdatePermissions={handleUpdatePermissions}
              onUpdateRole={handleUpdateRole}
              onKick={handleKickMember}
              onDeleteGroup={handleDeleteGroup}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── CONTEXT MENU ── */}
      <AnimatePresence>
        {contextMenu && (
          <ContextMenu
            ctx={contextMenu}
            isAdmin={isAdmin}
            isOwn={contextMenu.msg.senderId === user?.id}
            canDeleteMsg={(() => {
              const isOwn = contextMenu.msg.senderId === user?.id
              if (isOwn) return true           // always delete own
              if (!isAdmin) return false        // non-admin can't delete others
              if (isOwner) return true          // group OWNER can delete anyone's message
              // ADMIN cannot delete the group OWNER's message
              const senderMember = activeConv?.members?.find(m => m.userId === contextMenu.msg.senderId)
              return senderMember?.role !== 'OWNER'
            })()}
            onReply={() => { setReplyTo(contextMenu.msg); setEditingMsg(null); setContextMenu(null) }}
            onCopy={() => { navigator.clipboard.writeText(contextMenu.msg.body ?? '') }}
            onEdit={() => { setEditingMsg(contextMenu.msg); setReplyTo(null); setContextMenu(null) }}
            onPin={() => handlePin(contextMenu.msg)}
            onDelete={() => handleDelete(contextMenu.msg.id)}
            onForward={() => { setForwardMsg(contextMenu.msg); setShowForwardPicker(true); setContextMenu(null) }}
            onClose={() => setContextMenu(null)}
          />
        )}
      </AnimatePresence>

      {/* ── CREATE GROUP MODAL ── */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
            onClick={e => { if (e.target === e.currentTarget) setShowCreate(false) }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
              style={{ backgroundColor: TG_PANEL }}
            >
              <div className="flex items-center justify-between px-5 py-4"
                style={{ borderBottom: `1px solid ${TG_BORDER}` }}>
                <h2 className="font-bold text-white text-lg">New Group</h2>
                <button onClick={() => setShowCreate(false)} className="p-1.5 rounded-full hover:opacity-70">
                  <X className="w-5 h-5" style={{ color: '#8e99a4' }} />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="flex items-center gap-4">
                  {/* Clickable avatar for create modal */}
                  <div className="relative flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => createAvatarRef.current?.click()}
                      disabled={groupAvatarUploadState.uploading}
                      className="w-16 h-16 rounded-full flex items-center justify-center cursor-pointer overflow-hidden transition-opacity hover:opacity-80"
                      style={groupAvatarUrl
                        ? {}
                        : { backgroundColor: 'rgba(42,171,238,0.15)', border: `2px dashed ${TG_BLUE}` }
                      }
                    >
                      {groupAvatarUploadState.uploading
                        ? <Loader2 className="w-5 h-5 animate-spin" style={{ color: TG_BLUE }} />
                        : groupAvatarUrl
                          ? <img src={getAvatarUrl(groupAvatarUrl)} alt="" className="w-full h-full object-cover" />
                          : <Plus className="w-6 h-6" style={{ color: TG_BLUE }} />}
                    </button>
                    <input
                      ref={createAvatarRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        if (createAvatarRef.current) createAvatarRef.current.value = ''
                        const result = await uploadGroupAvatar(file)
                        if (result?.mediaUrl) setGroupAvatarUrl(result.mediaUrl)
                      }}
                    />
                  </div>
                  <input
                    value={groupName}
                    onChange={e => setGroupName(e.target.value)}
                    placeholder="Group Name"
                    className="flex-1 text-base font-medium outline-none bg-transparent border-b pb-1"
                    style={{ color: '#e8e8e8', borderColor: TG_BLUE }}
                    autoFocus
                  />
                </div>

                <textarea
                  value={groupDesc}
                  onChange={e => setGroupDesc(e.target.value)}
                  placeholder="Description (optional)"
                  rows={2}
                  className="w-full text-sm rounded-xl px-3 py-2.5 outline-none resize-none"
                  style={{ backgroundColor: TG_DARK, color: '#e8e8e8', border: `1px solid ${TG_BORDER}` }}
                />

                {/* Privacy */}
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: '#8e99a4' }}>PRIVACY</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(['PUBLIC', 'PRIVATE', 'SCHOOL_ONLY', 'CLASS_ONLY'] as const).map(p => (
                      <button key={p} onClick={() => setGroupPrivacy(p)}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all"
                        style={{
                          backgroundColor: groupPrivacy === p ? 'rgba(42,171,238,0.2)' : TG_DARK,
                          color: groupPrivacy === p ? TG_BLUE : '#8e99a4',
                          border: `1px solid ${groupPrivacy === p ? TG_BLUE : TG_BORDER}`,
                        }}>
                        <PrivacyIcon privacy={p} />
                        {p.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setShowCreate(false)}
                    className="px-4 py-2 rounded-xl text-sm font-medium hover:opacity-70 transition-opacity"
                    style={{ color: '#8e99a4' }}>
                    Cancel
                  </button>
                  <button
                    onClick={() => createGroupMutation.mutate()}
                    disabled={!groupName.trim() || createGroupMutation.isPending}
                    className="px-5 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-2"
                    style={{ backgroundColor: TG_BLUE }}
                  >
                    {createGroupMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Create
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── ADD MEMBER MODAL ── */}
      <AnimatePresence>
        {showAddMember && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
            onClick={e => { if (e.target === e.currentTarget) setShowAddMember(false) }}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl"
              style={{ backgroundColor: TG_PANEL }}
            >
              <div className="flex items-center justify-between px-5 py-4"
                style={{ borderBottom: `1px solid ${TG_BORDER}` }}>
                <h2 className="font-bold text-white">Add Member</h2>
                <button onClick={() => setShowAddMember(false)}>
                  <X className="w-5 h-5" style={{ color: '#8e99a4' }} />
                </button>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3"
                  style={{ backgroundColor: TG_DARK }}>
                  <Search className="w-4 h-4" style={{ color: '#8e99a4' }} />
                  <input
                    value={addMemberSearch}
                    onChange={e => setAddMemberSearch(e.target.value)}
                    placeholder="Search users…"
                    className="flex-1 text-sm outline-none bg-transparent"
                    style={{ color: '#e8e8e8' }}
                    autoFocus
                  />
                </div>
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {(addMemberResults ?? [])
                    // Filter out users already in the group
                    .filter((u: any) => !activeConv?.members?.some(m => m.userId === u.id))
                    .map((u: any) => (
                    <button key={u.id}
                      onClick={async () => {
                        if (!activeConvId) return
                        try {
                          await groupChatApi.addMember(activeConvId, u.id)
                          // Refresh the conversations list — it contains the full member arrays
                          qc.invalidateQueries({ queryKey: ['group-chat-conversations'] })
                          setAddMemberSearch('')
                          setShowAddMember(false)
                          toast({ title: `${u.firstName} added` })
                        } catch (e: any) {
                          toast({ title: e?.response?.data?.message || 'Failed to add member', variant: 'destructive' })
                        }
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:opacity-80 text-left transition-opacity"
                      style={{ backgroundColor: TG_DARK }}
                    >
                      <Av url={u.avatarUrl} name={`${u.firstName} ${u.lastName}`} size={36} />
                      <div>
                        <p className="text-sm font-medium text-white">{u.firstName} {u.lastName}</p>
                        <p className="text-xs" style={{ color: '#8e99a4' }}>{u.role?.replace(/_/g, ' ')}</p>
                      </div>
                    </button>
                  ))}
                  {addMemberSearch.length >= 2 && (addMemberResults ?? []).filter((u: any) => !activeConv?.members?.some(m => m.userId === u.id)).length === 0 && (
                    <p className="text-sm text-center py-4" style={{ color: '#8e99a4' }}>
                      {(addMemberResults ?? []).length > 0 ? 'All found users are already members' : 'No users found'}
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── SHARE SHEET — DM, Group, Feed, Community ── */}
      <ShareSheet
        open={showForwardPicker}
        payload={sharePayload}
        onClose={() => { setShowForwardPicker(false); setForwardMsg(null) }}
        onSuccess={() => { setShowForwardPicker(false); setForwardMsg(null); toast({ title: 'Shared successfully' }) }}
        dmConversations={dmConvs}
        groupConversations={conversations.filter(c => c.id !== activeConvId)}
      />
    </div>
  )
}
