'use client'

/**
 * Voice Room Members Page
 * Route: /voice-club/[id]/members
 * TikTok/BIGO-style with Room Details / Event / Member tabs
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import api from '@/lib/api'
import { getSocket } from '@/lib/socket'
import { useAuthStore } from '@/store/auth.store'
import { getAvatarUrl } from '@/lib/avatar'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'
import {
  Search, ChevronRight, Plus, MoreHorizontal, X,
  Shield, Star, Crown, Check, UserX, UserPlus, Ban,
} from 'lucide-react'
import Link from 'next/link'
import { RoomSettingsSheet } from '@/components/voice/RoomSettingsSheet'

// ─── Constants ────────────────────────────────────────────────────────────────
const MEMBER_ROLES = ['OWNER','CO_OWNER','ADMIN','MODERATOR','VIP','OFFICIAL','MEMBER'] as const
type MemberRole = typeof MEMBER_ROLES[number]

const ROLE_META: Record<string, { label: string; emoji: string; color: string }> = {
  OWNER:    { label: 'Owner',    emoji: '👑', color: '#f59e0b' },
  CO_OWNER: { label: 'Co-Owner', emoji: '🔶', color: '#f97316' },
  ADMIN:    { label: 'Admin',    emoji: '🛡️',  color: '#8b5cf6' },
  MODERATOR:{ label: 'Moderator',emoji: '🔧', color: '#06b6d4' },
  VIP:      { label: 'VIP',      emoji: '💎', color: '#ec4899' },
  OFFICIAL: { label: 'Official', emoji: '✅', color: '#10b981' },
  MEMBER:   { label: 'Member',   emoji: '👤', color: '#6b7280' },
  BLOCKED:  { label: 'Blocked',  emoji: '🚫', color: '#ef4444' },
}

const LEVEL_META: Record<number, { label: string; emoji: string; color: string }> = {
  1: { label: 'Fan',     emoji: '⭐', color: '#9ca3af' },
  2: { label: 'Regular', emoji: '🌟', color: '#6366f1' },
  3: { label: 'VIP',     emoji: '💎', color: '#06b6d4' },
  4: { label: 'Super',   emoji: '🔥', color: '#f59e0b' },
  5: { label: 'Legend',  emoji: '👑', color: '#ef4444' },
}

type Tab = 'details' | 'events' | 'members'

// ─── Role Badge ───────────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  const meta = ROLE_META[role] ?? ROLE_META.MEMBER
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 8,
      background: meta.color + '22', color: meta.color, border: `1px solid ${meta.color}44` }}>
      {meta.emoji} {meta.label}
    </span>
  )
}

// ─── Level Badge ──────────────────────────────────────────────────────────────
function LevelBadge({ level }: { level: number }) {
  const meta = LEVEL_META[level] ?? LEVEL_META[1]
  return (
    <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 6,
      background: meta.color + '22', color: meta.color }}>
      {meta.emoji} Lv{level}
    </span>
  )
}

// ─── Member Row ───────────────────────────────────────────────────────────────
function MemberRow({ member, myRole, roomId, onAction }: {
  member: any; myRole: string; roomId: string; onAction: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const ref = useRef<HTMLDivElement>(null)

  const src = getAvatarUrl(member.user.avatarUrl)
  const name = member.nickname || `${member.user.firstName} ${member.user.lastName}`
  const WEIGHT: Record<string, number> = { OWNER:8,CO_OWNER:7,ADMIN:6,MODERATOR:5,VIP:4,OFFICIAL:3,MEMBER:2,BLOCKED:1 }
  const myWeight     = WEIGHT[myRole]       ?? 0
  const targetWeight = WEIGHT[member.role]  ?? 0
  const canManage = myWeight > targetWeight && member.role !== 'OWNER'

  const doAction = async (url: string, method: 'patch'|'delete'|'post', body?: any, msg?: string) => {
    setMenuOpen(false)
    try {
      if (method === 'patch') await api.patch(url, body)
      else if (method === 'delete') await api.delete(url)
      else await api.post(url, body)
      toast({ title: msg ?? 'Done' })
      queryClient.invalidateQueries({ queryKey: ['room-members', roomId] })
      queryClient.invalidateQueries({ queryKey: ['room-pending', roomId] })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Action failed', variant: 'destructive' })
    }
  }

  const promoteOptions = MEMBER_ROLES.filter(r => r !== 'OWNER' && r !== member.role)

  return (
    <div ref={ref} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
      borderBottom: '1px solid #f1f5f9', position: 'relative' }}>
      {/* Avatar */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{ width: 44, height: 44, borderRadius: 22, overflow: 'hidden', background: '#e0e7ff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: '#6366f1' }}>
          {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : `${member.user.firstName[0]}${member.user.lastName[0]}`}
        </div>
        {/* Level number overlay */}
        <div style={{ position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9,
          background: LEVEL_META[member.memberLevel]?.color ?? '#9ca3af',
          border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 8, fontWeight: 800, color: '#fff' }}>
          {member.memberLevel}
        </div>
        {/* Online dot */}
        {member.isOnline && (
          <div style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderRadius: 5,
            background: '#22c55e', border: '2px solid #fff' }} />
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#1e293b',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
            {name}
          </span>
          <RoleBadge role={member.role} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
          <span style={{ fontSize: 11, color: member.isOnline ? '#22c55e' : '#64748b' }}>
            👤 {member.lastActiveLabel ?? (member.isOnline ? 'Active' : 'Offline')}
          </span>
          {member.contribution > 0 && (
            <span style={{ fontSize: 10, color: '#f59e0b' }}>🪙 {member.contribution.toLocaleString()}</span>
          )}
        </div>
      </div>

      {/* Three-dot menu */}
      {canManage && (
        <div style={{ position: 'relative' }}>
          <button onClick={() => setMenuOpen(v => !v)}
            aria-label={`Member options for ${name}`}
            style={{ width: 32, height: 32, borderRadius: 16, border: 'none', background: 'transparent',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
            <MoreHorizontal size={18} />
          </button>

          <AnimatePresence>
            {menuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setMenuOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: -8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: -8 }}
                  style={{ position: 'absolute', right: 0, top: 36, background: '#fff', borderRadius: 14,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.15)', zIndex: 50, minWidth: 180, overflow: 'hidden' }}>

                  {/* Promote/Demote submenu */}
                  {promoteOptions.slice(0, 4).map(r => (
                    <button key={r} onClick={() => doAction(`/voice/${roomId}/members/${member.userId}/role`, 'patch', { role: r }, `${ROLE_META[r]?.emoji} Set as ${ROLE_META[r]?.label}`)}
                      style={{ width: '100%', padding: '10px 16px', border: 'none', background: 'transparent',
                        cursor: 'pointer', textAlign: 'left', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>{ROLE_META[r]?.emoji}</span> Set as {ROLE_META[r]?.label}
                    </button>
                  ))}

                  <div style={{ height: 1, background: '#f1f5f9', margin: '4px 0' }} />

                  <button onClick={() => doAction(`/voice/${roomId}/members/${member.userId}/remove`, 'delete', undefined, '🚫 Member removed')}
                    style={{ width: '100%', padding: '10px 16px', border: 'none', background: 'transparent',
                      cursor: 'pointer', textAlign: 'left', fontSize: 13, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <UserX size={14} /> Remove
                  </button>
                  <button onClick={() => doAction(`/voice/${roomId}/members/${member.userId}/block`, 'patch', undefined, '🔒 Member blocked')}
                    style={{ width: '100%', padding: '10px 16px', border: 'none', background: 'transparent',
                      cursor: 'pointer', textAlign: 'left', fontSize: 13, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Ban size={14} /> Block
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

// ─── Pending Requests Row ─────────────────────────────────────────────────────
function PendingRow({ req, roomId }: { req: any; roomId: string }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const src = getAvatarUrl(req.user.avatarUrl)

  const act = async (url: string, method: 'post'|'delete', msg: string) => {
    try {
      if (method === 'post') await api.post(url)
      else await api.delete(url)
      toast({ title: msg })
      queryClient.invalidateQueries({ queryKey: ['room-pending', roomId] })
      queryClient.invalidateQueries({ queryKey: ['room-level-stats', roomId] })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ width: 40, height: 40, borderRadius: 20, overflow: 'hidden', background: '#e0e7ff', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#6366f1' }}>
        {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : `${req.user.firstName[0]}${req.user.lastName[0]}`}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{req.user.firstName} {req.user.lastName}</p>
        <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>Wants to join</p>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => act(`/voice/${roomId}/members/${req.userId}/approve`, 'post', '✅ Approved')}
          style={{ padding: '6px 12px', borderRadius: 10, border: 'none', background: '#22c55e', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          <Check size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />Approve
        </button>
        <button onClick={() => act(`/voice/${roomId}/members/${req.userId}/reject`, 'delete', '❌ Rejected')}
          style={{ padding: '6px 12px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          <X size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />Reject
        </button>
      </div>
    </div>
  )
}

// ─── MEMBERS TAB ──────────────────────────────────────────────────────────────
function MembersTab({ roomId, myRole }: { roomId: string; myRole: string }) {
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('ALL')
  const [sortBy, setSortBy] = useState('joinedAt')
  const [showPending, setShowPending] = useState(false)
  const queryClient = useQueryClient()
  const { toast } = useToast()


  // Real-time updates
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['room-members', roomId] })
      queryClient.invalidateQueries({ queryKey: ['room-pending', roomId] })
      queryClient.invalidateQueries({ queryKey: ['room-level-stats', roomId] })
    }
    socket.on('voice:member_joined',      refresh)
    socket.on('voice:member_left',        refresh)
    socket.on('voice:join_request',       refresh)
    socket.on('voice:join_approved',      refresh)
    socket.on('voice:member_role_changed',refresh)
    return () => {
      socket.off('voice:member_joined',      refresh)
      socket.off('voice:member_left',        refresh)
      socket.off('voice:join_request',       refresh)
      socket.off('voice:join_approved',      refresh)
      socket.off('voice:member_role_changed',refresh)
    }
  }, [roomId, queryClient])
  const isAdmin = ['OWNER','CO_OWNER','ADMIN','MODERATOR'].includes(myRole)

  const { data: membersData } = useQuery({
    queryKey: ['room-members', roomId, roleFilter, sortBy, search],
    queryFn: () => api.get(`/voice/${roomId}/members`, {
      params: { role: roleFilter === 'ALL' ? undefined : roleFilter, sortBy, search: search || undefined, limit: 100 }
    }).then(r => r.data),
    staleTime: 15_000,
  })

  const { data: pendingData } = useQuery({
    queryKey: ['room-pending', roomId],
    queryFn: () => api.get(`/voice/${roomId}/members/pending`).then(r => r.data),
    enabled: isAdmin,
    staleTime: 10_000,
  })

  const { data: statsData } = useQuery({
    queryKey: ['room-level-stats', roomId],
    queryFn: () => api.get(`/voice/${roomId}/members/level-stats`).then(r => r.data.data),
    staleTime: 30_000,
  })

  const members = membersData?.data ?? []
  const pending = pendingData?.data ?? []
  const stats = statsData

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {/* Member Request row */}
      {isAdmin && (
        <button onClick={() => setShowPending(v => !v)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 16,
            padding: '14px 16px', border: 'none', background: '#fff', cursor: 'pointer',
            borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#f1f5f9',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <UserPlus size={20} color="#64748b" />
          </div>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#1e293b' }}>Member request</p>
            {pending.length > 0 && (
              <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>{pending.length} pending</p>
            )}
          </div>
          {pending.length > 0 && (
            <span style={{ background: '#ef4444', color: '#fff', borderRadius: 10, fontSize: 11,
              fontWeight: 700, padding: '2px 7px' }}>{pending.length}</span>
          )}
          <ChevronRight size={16} color="#94a3b8" />
        </button>
      )}

      {/* Pending requests expanded */}
      {showPending && pending.length > 0 && (
        <div style={{ background: '#fafafa', borderBottom: '2px solid #e2e8f0' }}>
          {pending.map((r: any) => <PendingRow key={r.userId} req={r} roomId={roomId} />)}
        </div>
      )}

      {/* Add Members */}
      <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 16,
        padding: '14px 16px', border: 'none', background: '#fff', cursor: 'pointer',
        borderBottom: '2px solid #f1f5f9' }}>
        <div style={{ width: 40, height: 40, borderRadius: 20, border: '2px dashed #d1d5db',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Plus size={20} color="#94a3b8" />
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>Add Members</span>
      </button>

      {/* Stats bar */}
      {stats && (
        <div style={{ display: 'flex', gap: 12, padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>👥 {stats.totalMembers?.toLocaleString()} members</span>
          <span style={{ fontSize: 12, color: '#22c55e' }}>🟢 {stats.onlineCount} online</span>
          <span style={{ fontSize: 12, color: '#7c3aed', fontWeight: 700 }}>Lv{stats.roomLevel} · {stats.maxMembers?.toLocaleString()} max</span>
        </div>
      )}

      {/* Search + Filter */}
      <div style={{ padding: '10px 16px', background: '#fff', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f1f5f9', borderRadius: 10, padding: '8px 12px', marginBottom: 8 }}>
          <Search size={14} color="#94a3b8" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search members…"
            style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 13, outline: 'none', color: '#1e293b' }} />
        </div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {['ALL', ...MEMBER_ROLES].map(r => (
            <button key={r} onClick={() => setRoleFilter(r)}
              style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                border: `1px solid ${roleFilter === r ? (ROLE_META[r]?.color ?? '#7c3aed') : '#e2e8f0'}`,
                background: roleFilter === r ? ((ROLE_META[r]?.color ?? '#7c3aed') + '22') : '#f8fafc',
                color: roleFilter === r ? (ROLE_META[r]?.color ?? '#7c3aed') : '#64748b',
                cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {r === 'ALL' ? 'All' : `${ROLE_META[r]?.emoji ?? ''} ${ROLE_META[r]?.label ?? r}`}
            </button>
          ))}
        </div>
      </div>

      {/* Member list */}
      {members.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
          <p style={{ fontSize: 32 }}>👥</p>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>No members yet</p>
          <p style={{ fontSize: 12 }}>Be the first to join this room permanently</p>
        </div>
      ) : (
        members.map((m: any) => (
          <MemberRow key={m.userId} member={m} myRole={myRole} roomId={roomId} onAction={() => {}} />
        ))
      )}
    </div>
  )
}

// ─── ROOM DETAILS TAB (BIGO-style) ─────────────────────────────────────────
function DetailsTab({ room, roomId, onOpenSettings }: { room: any; roomId: string; onOpenSettings: () => void }) {
  const { data: statsData } = useQuery({
    queryKey: ['room-level-stats', roomId],
    queryFn: () => api.get(`/voice/${roomId}/members/level-stats`).then(r => r.data.data),
    staleTime: 30_000,
  });
  const { data: socialData } = useQuery({
    queryKey: ['host-social-counts', room?.hostId],
    queryFn: () => api.get(`/social/counts/${room?.hostId}`).then(r => r.data.data),
    enabled: !!room?.hostId,
    staleTime: 60_000,
  });

  const stats = statsData;
  const totalMembers = stats?.totalMembers ?? 0;
  const followers = socialData?.followers ?? 0;
  const host = room?.host;
  const hostName = host ? `${host.firstName} ${host.lastName}` : 'Unknown';
  const hostSrc = host?.avatarUrl ? getAvatarUrl(host.avatarUrl) : null;

  const Card = ({ label, value, onClick }: { label: string; value: React.ReactNode; onClick?: () => void }) => (
    <div onClick={onClick} style={{ background: '#fff', borderRadius: 14, padding: '16px 18px', marginBottom: 10, border: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: onClick ? 'pointer' : 'default' }}>
      <div>
        <p style={{ margin: 0, fontSize: 12, color: '#64748b', marginBottom: 4 }}>{label}</p>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#1e293b' }}>{value}</div>
      </div>
      {onClick && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>}
    </div>
  );

  return (
    <div style={{ padding: '16px', background: '#f8fafc', minHeight: '100%' }}>
      {/* Room Owner */}
      <div style={{ background: '#fff', borderRadius: 14, padding: '14px 18px', marginBottom: 10, border: '1px solid #f1f5f9' }}>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#64748b' }}>Room Owner</p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 48, height: 48, borderRadius: 24, overflow: 'hidden', background: '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: '#6366f1', flexShrink: 0 }}>
              {hostSrc ? <img src={hostSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : hostName.charAt(0)}
            </div>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#1e293b' }}>{hostName}</span>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>

      {/* Room Management Center */}
      <div style={{ background: '#fff', borderRadius: 14, padding: '16px 18px', marginBottom: 10, border: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
        onClick={onOpenSettings}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>⚙️</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#1e293b' }}>Room Management Center</span>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>

      {/* Room Level */}
      <Card label="Room Level" value={`Lv.${room?.roomLevel ?? 1}`} onClick={() => {}} />

      {/* Members */}
      <Card label="Members" value={totalMembers.toLocaleString()} />

      {/* Followers of host */}
      <Card label="Followers" value={followers.toLocaleString()} />

      {/* Room description */}
      {room?.description && (
        <div style={{ background: '#fff', borderRadius: 14, padding: '14px 18px', border: '1px solid #f1f5f9' }}>
          <p style={{ margin: 0, fontSize: 12, color: '#64748b', marginBottom: 6 }}>About</p>
          <p style={{ margin: 0, fontSize: 14, color: '#374151', lineHeight: 1.6 }}>{room.description}</p>
        </div>
      )}
    </div>
  );
}
function EventsTab({ roomId }: { roomId: string }) {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
      <p style={{ fontSize: 32 }}>📅</p>
      <p style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>No events yet</p>
      <p style={{ fontSize: 12 }}>Room events and announcements will appear here</p>
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function RoomMembersPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuthStore()
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>('members')
  const [showSettings, setShowSettings] = useState(false)

  const roomId = params?.id ?? ''

  const { data: statusData } = useQuery({
    queryKey: ['room-membership', roomId],
    queryFn: () => api.get(`/voice/${roomId}/members/status`).then(r => r.data.data),
    enabled: !!roomId,
    staleTime: 30_000,
  })

  const { data: roomData, refetch: refetchRoom } = useQuery({
    queryKey: ['voice-room-detail', roomId],
    queryFn: () => api.get(`/voice/${roomId}`).then(r => r.data.data),
    enabled: !!roomId,
    staleTime: 60_000,
  })

  const myRole = statusData?.member?.role ?? (roomData?.hostId === user?.id ? 'OWNER' : 'MEMBER')
  const room = roomData

  // Only HOST or CO_OWNER / ADMIN can use the Room Management Center controls
  const isHost      = roomData?.hostId === user?.id
  const amModerating = ['OWNER','CO_OWNER','ADMIN','MODERATOR'].includes(myRole) || isHost

  // ── Room control handlers (call API directly from this standalone page) ─────
  const handleMuteAll = useCallback(async () => {
    try {
      await api.patch(`/voice/${roomId}/mute-all`)
      toast({ title: '🔇 All speakers muted' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
    }
  }, [roomId, toast])

  const handleUnmuteAll = useCallback(async () => {
    try {
      await api.patch(`/voice/${roomId}/unmute-all`)
      toast({ title: '🎙️ All speakers unmuted' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
    }
  }, [roomId, toast])

  const handleToggleOpenMic = useCallback(async () => {
    try {
      await api.patch(`/voice/${roomId}/open-mic`, { enabled: !(room?.isOpenMic ?? false) })
      refetchRoom()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
    }
  }, [roomId, room?.isOpenMic, refetchRoom, toast])

  const handleToggleMicLock = useCallback(async () => {
    try {
      await api.patch(`/voice/${roomId}/mic-lock`, { locked: !(room?.micLocked ?? false) })
      refetchRoom()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
    }
  }, [roomId, room?.micLocked, refetchRoom, toast])

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', background: '#fff', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #f1f5f9', background: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={() => router.back()} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4 }}>
          ← Back
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          {room?.coverImageUrl
            ? <img src={room.coverImageUrl} alt="" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }} />
            : <span style={{ fontSize: 24 }}>{room?.coverEmoji ?? '🎙️'}</span>
          }
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#1e293b', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {room?.title ?? 'Room'}
            </p>
            <RoleBadge role={myRole} />
          </div>
        </div>
        {/* Gear icon — opens Room Management Center (settings sheet) */}
        <button
          onClick={() => setShowSettings(true)}
          title="Room Management Center"
          aria-label="Room Management Center"
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, fontSize: 20, lineHeight: 1 }}
        >
          ⚙️
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#fff' }}>
        {(['details','events','members'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ flex: 1, padding: '12px 0', border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: 14, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? '#1e293b' : '#64748b',
              borderBottom: tab === t ? '2px solid #1e293b' : '2px solid transparent',
              marginBottom: -1, textTransform: 'capitalize' }}>
            {t === 'details' ? 'Room Details' : t === 'events' ? 'Event' : 'Member'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'details' && <DetailsTab room={room} roomId={roomId} onOpenSettings={() => setShowSettings(true)} />}
        {tab === 'events'  && <EventsTab roomId={roomId} />}
        {tab === 'members' && <MembersTab roomId={roomId} myRole={myRole} />}
      </div>

      {/* Room Settings Sheet — same sheet used inside the live room */}
      <RoomSettingsSheet
        open={showSettings}
        onClose={() => setShowSettings(false)}
        isHost={isHost}
        amModerating={amModerating}
        onMuteAll={amModerating ? handleMuteAll : undefined}
        onUnmuteAll={amModerating ? handleUnmuteAll : undefined}
        onToggleOpenMic={amModerating ? handleToggleOpenMic : undefined}
        onToggleMicLock={amModerating ? handleToggleMicLock : undefined}
        isOpenMic={room?.isOpenMic ?? false}
        micLocked={room?.micLocked ?? false}
      />
    </div>
  )
}
