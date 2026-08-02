'use client'

/**
 * RoomMembersPanel
 * Shown inside the ⋮ Room Settings Sheet for hosts/mods.
 * Features:
 *  - Room level display (1-10) with capacity bar
 *  - Upgrade room level button (host only)
 *  - Paginated member list with level badges
 *  - Upgrade / ban individual members
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import api from '@/lib/api'
import { getAvatarUrl } from '@/lib/avatar'
import { useToast } from '@/components/ui/use-toast'
import { useVoiceStore, ROOM_LEVEL_CAPACITY, MEMBER_LEVEL_META } from '@/store/voice.store'
import { cn } from '@/lib/utils'

// ─── Level badge ──────────────────────────────────────────────────────────────
function MemberLevelBadge({ level }: { level: number }) {
  const meta = MEMBER_LEVEL_META[level] ?? MEMBER_LEVEL_META[1]
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 8,
      background: meta.color + '22', color: meta.color, border: `1px solid ${meta.color}44`,
      whiteSpace: 'nowrap',
    }}>
      {meta.emoji} {meta.label}
    </span>
  )
}

// ─── Room Level Progress Bar ──────────────────────────────────────────────────
function RoomLevelBar({
  roomId, currentLevel, isHost, onUpgradeLevel,
}: {
  roomId: string; currentLevel: number; isHost: boolean; onUpgradeLevel: () => void
}) {
  const { data: stats } = useQuery({
    queryKey: ['room-level-stats', roomId],
    queryFn: () => api.get(`/voice/${roomId}/members/level-stats`).then(r => r.data.data),
    staleTime: 30_000,
  })

  const maxMembers = ROOM_LEVEL_CAPACITY[currentLevel] ?? 500
  const totalMembers = stats?.totalMembers ?? 0
  const fillPercent = Math.min(100, Math.round((totalMembers / maxMembers) * 100))

  return (
    <div style={{ margin: '0 16px 16px', background: '#f8fafc', borderRadius: 14, padding: '14px 16px', border: '1px solid #e2e8f0' }}>
      {/* Level header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 20,
            background: 'linear-gradient(135deg, #7c3aed, #db2777)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 16, fontWeight: 800,
          }}>
            {currentLevel}
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#1e293b' }}>Room Level {currentLevel}</p>
            <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>
              {totalMembers.toLocaleString()} / {maxMembers.toLocaleString()} permanent members
            </p>
          </div>
        </div>
        {isHost && currentLevel < 10 && (
          <button
            onClick={onUpgradeLevel}
            style={{
              padding: '6px 14px', borderRadius: 10, border: 'none',
              background: 'linear-gradient(135deg, #7c3aed, #db2777)',
              color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            ↑ Upgrade
          </button>
        )}
        {isHost && currentLevel >= 10 && (
          <span style={{ fontSize: 11, color: '#7c3aed', fontWeight: 700 }}>MAX LEVEL</span>
        )}
      </div>

      {/* Progress bar */}
      <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
        <motion.div
          style={{ height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, #7c3aed, #db2777)' }}
          initial={{ width: 0 }}
          animate={{ width: `${fillPercent}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
      <p style={{ margin: '6px 0 0', fontSize: 10, color: '#94a3b8', textAlign: 'right' }}>
        {fillPercent}% full{fillPercent >= 90 && currentLevel < 10 ? ' — consider upgrading!' : ''}
      </p>

      {/* Level capacity reference */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 10 }}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map(lv => (
          <div key={lv} style={{
            flex: '0 0 calc(20% - 4px)', padding: '4px 0', borderRadius: 6, textAlign: 'center',
            background: lv === currentLevel ? '#ede9fe' : lv < currentLevel ? '#f0fdf4' : '#f8fafc',
            border: `1px solid ${lv === currentLevel ? '#7c3aed' : lv < currentLevel ? '#86efac' : '#e2e8f0'}`,
          }}>
            <p style={{ margin: 0, fontSize: 9, fontWeight: 700, color: lv === currentLevel ? '#7c3aed' : '#64748b' }}>Lv{lv}</p>
            <p style={{ margin: 0, fontSize: 8, color: '#94a3b8' }}>
              {(ROOM_LEVEL_CAPACITY[lv] ?? 0).toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Upgrade Room Level Modal ──────────────────────────────────────────────────
function UpgradeLevelModal({
  roomId, currentLevel, onClose,
}: { roomId: string; currentLevel: number; onClose: () => void }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { updateRoom } = useVoiceStore()
  const [targetLevel, setTargetLevel] = useState(currentLevel + 1)
  const [upgrading, setUpgrading] = useState(false)

  const confirm = async () => {
    setUpgrading(true)
    try {
      await api.patch(`/voice/${roomId}/members/room-level`, { level: targetLevel })
      updateRoom({ roomLevel: targetLevel })
      queryClient.invalidateQueries({ queryKey: ['room-level-stats', roomId] })
      toast({ title: `🎉 Room upgraded to Level ${targetLevel}!`, description: `Max members: ${(ROOM_LEVEL_CAPACITY[targetLevel] ?? 0).toLocaleString()}` })
      onClose()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Upgrade failed', variant: 'destructive' })
    } finally {
      setUpgrading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        style={{
          position: 'relative', width: '100%', maxWidth: 480,
          background: '#fff', borderRadius: '20px 20px 0 0', padding: 24, zIndex: 1,
        }}
      >
        <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700 }}>Upgrade Room Level</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#64748b' }}>
          Current: Level {currentLevel} ({(ROOM_LEVEL_CAPACITY[currentLevel] ?? 0).toLocaleString()} members max)
        </p>

        {/* Level selector */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
          {Array.from({ length: 10 - currentLevel }, (_, i) => currentLevel + 1 + i).map(lv => (
            <button
              key={lv}
              onClick={() => setTargetLevel(lv)}
              style={{
                padding: '8px 14px', borderRadius: 10, border: '2px solid',
                borderColor: targetLevel === lv ? '#7c3aed' : '#e2e8f0',
                background: targetLevel === lv ? '#ede9fe' : '#f8fafc',
                cursor: 'pointer', fontSize: 13, fontWeight: 600,
                color: targetLevel === lv ? '#7c3aed' : '#374151',
              }}
            >
              Lv{lv} — {(ROOM_LEVEL_CAPACITY[lv] ?? 0).toLocaleString()}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '12px', borderRadius: 12, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', fontWeight: 600 }}>
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={upgrading}
            style={{
              flex: 2, padding: '12px', borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg, #7c3aed, #db2777)',
              color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14,
            }}
          >
            {upgrading ? 'Upgrading…' : `Upgrade to Level ${targetLevel}`}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Main RoomMembersPanel ─────────────────────────────────────────────────────
interface Props {
  roomId: string
  isHost: boolean
  amModerating: boolean
  onBack: () => void
}

export function RoomMembersPanel({ roomId, isHost, amModerating, onBack }: Props) {
  const { activeRoom } = useVoiceStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [search, setSearch] = useState('')
  const [filterLevel, setFilterLevel] = useState<number | null>(null)
  const [upgrading, setUpgrading] = useState<string | null>(null)
  const [banning, setBanning] = useState<string | null>(null)

  const currentLevel = activeRoom?.roomLevel ?? 1

  const { data, isLoading } = useQuery({
    queryKey: ['room-members', roomId, filterLevel, search],
    queryFn: () => api.get(`/voice/${roomId}/members`, {
      params: { limit: 50, memberLevel: filterLevel || undefined, search: search || undefined }
    }).then(r => r.data),
    staleTime: 15_000,
  })

  const members = data?.data ?? []

  const handleUpgradeMember = async (userId: string, newLevel: number) => {
    setUpgrading(userId)
    try {
      await api.patch(`/voice/${roomId}/members/${userId}/upgrade`, { memberLevel: newLevel })
      queryClient.invalidateQueries({ queryKey: ['room-members', roomId] })
      toast({ title: `${MEMBER_LEVEL_META[newLevel]?.emoji} Member upgraded to ${MEMBER_LEVEL_META[newLevel]?.label}` })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
    } finally {
      setUpgrading(null)
    }
  }

  const handleBan = async (userId: string, name: string) => {
    setBanning(userId)
    try {
      await api.patch(`/voice/${roomId}/members/${userId}/ban`)
      queryClient.invalidateQueries({ queryKey: ['room-members', roomId] })
      toast({ title: `🚫 ${name} banned from room` })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
    } finally {
      setBanning(null)
    }
  }

  return (
    <div className="rs-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="rs-panel-header">
        <button className="rs-back" onClick={onBack}>←</button>
        <h3 className="rs-panel-title">Room Members</h3>
      </div>

      {/* Room level bar */}
      <RoomLevelBar
        roomId={roomId}
        currentLevel={currentLevel}
        isHost={isHost}
        onUpgradeLevel={() => setShowUpgradeModal(true)}
      />

      {/* Filter bar */}
      <div style={{ padding: '0 16px 10px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          onClick={() => setFilterLevel(null)}
          style={{
            padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            border: `1px solid ${!filterLevel ? '#7c3aed' : '#e2e8f0'}`,
            background: !filterLevel ? '#ede9fe' : '#f8fafc',
            color: !filterLevel ? '#7c3aed' : '#64748b',
          }}
        >All</button>
        {[1, 2, 3, 4, 5].map(lv => {
          const meta = MEMBER_LEVEL_META[lv]
          return (
            <button
              key={lv}
              onClick={() => setFilterLevel(filterLevel === lv ? null : lv)}
              style={{
                padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${filterLevel === lv ? meta.color : '#e2e8f0'}`,
                background: filterLevel === lv ? meta.color + '22' : '#f8fafc',
                color: filterLevel === lv ? meta.color : '#64748b',
              }}
            >
              {meta.emoji} {meta.label}
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div style={{ padding: '0 16px 10px' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search members…"
          style={{
            width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #e2e8f0',
            fontSize: 13, color: '#1e293b', outline: 'none', boxSizing: 'border-box',
            background: '#f8fafc',
          }}
        />
      </div>

      {/* Member list */}
      <div style={{ overflowY: 'auto', flex: 1, padding: '0 16px 16px' }}>
        {isLoading ? (
          <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: 20 }}>Loading…</p>
        ) : members.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <p style={{ fontSize: 32, margin: '0 0 8px' }}>👥</p>
            <p style={{ fontSize: 14, color: '#64748b', fontWeight: 600 }}>No permanent members yet</p>
            <p style={{ fontSize: 12, color: '#94a3b8' }}>Members who join permanently will appear here</p>
          </div>
        ) : (
          members.map((m: any) => {
            const name = `${m.user.firstName} ${m.user.lastName}`
            const src = getAvatarUrl(m.user.avatarUrl)
            const isUpgrading = upgrading === m.userId
            const isBanning = banning === m.userId

            return (
              <div key={m.userId} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                borderRadius: 12, marginBottom: 4, border: '1px solid #f1f5f9',
                background: '#fff',
              }}>
                {/* Avatar */}
                <div style={{ width: 36, height: 36, borderRadius: 18, overflow: 'hidden', flexShrink: 0, background: '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#6366f1' }}>
                  {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : `${m.user.firstName[0]}${m.user.lastName[0]}`}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <MemberLevelBadge level={m.memberLevel} />
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>
                      Joined {new Date(m.joinedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Actions — host/mod only */}
                {amModerating && (
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {/* Upgrade level dropdown */}
                    <select
                      disabled={isUpgrading}
                      value={m.memberLevel}
                      onChange={e => handleUpgradeMember(m.userId, parseInt(e.target.value))}
                      style={{
                        padding: '4px 6px', borderRadius: 8, border: '1px solid #e2e8f0',
                        fontSize: 11, cursor: 'pointer', background: '#f8fafc', color: '#374151',
                      }}
                      title="Upgrade member level"
                    >
                      {[1, 2, 3, 4, 5].map(lv => (
                        <option key={lv} value={lv}>{MEMBER_LEVEL_META[lv]?.emoji} Lv{lv}</option>
                      ))}
                    </select>

                    {/* Ban button */}
                    <button
                      onClick={() => handleBan(m.userId, name)}
                      disabled={isBanning}
                      style={{
                        padding: '4px 8px', borderRadius: 8, border: '1px solid #fee2e2',
                        background: '#fff5f5', cursor: 'pointer', fontSize: 11, color: '#ef4444',
                      }}
                      title="Ban member"
                    >
                      🚫
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Upgrade level modal */}
      {showUpgradeModal && (
        <UpgradeLevelModal
          roomId={roomId}
          currentLevel={currentLevel}
          onClose={() => setShowUpgradeModal(false)}
        />
      )}
    </div>
  )
}
