/**
 * Mobile Voice Club — Member Management Panel
 * Full-featured bottom-sheet for host/mod to manage permanent room members.
 * Features:
 *   - List all active members (paginated, searchable)
 *   - Approve / reject pending join requests
 *   - Set member role (MEMBER→VIP→MODERATOR etc.)
 *   - Upgrade member level (Fan→Regular→VIP→Super→Legend)
 *   - Block / unblock members
 *   - Remove member from room
 *   - View pending request count badge
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  FlatList, Image, TextInput, ActivityIndicator,
  Alert, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';

// ─── Types ────────────────────────────────────────────────────────────────────

type MemberRole = 'OWNER' | 'CO_OWNER' | 'ADMIN' | 'MODERATOR' | 'VIP' | 'OFFICIAL' | 'MEMBER' | 'BLOCKED';

interface RoomMember {
  id: string;
  userId: string;
  role: MemberRole;
  memberLevel: number;
  status: 'ACTIVE' | 'PENDING' | 'REMOVED';
  isBanned: boolean;
  contribution: number;
  isOnline: boolean;
  lastActiveLabel: string | null;
  nickname: string | null;
  levelMeta: { label: string; emoji: string; color: string };
  user: { id: string; firstName: string; lastName: string; avatarUrl: string | null };
}

interface Props {
  visible: boolean;
  roomId: string;
  myRole: 'HOST' | 'MODERATOR' | 'SPEAKER' | 'AUDIENCE';
  onClose: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_OPTIONS: { value: MemberRole; label: string; color: string }[] = [
  { value: 'CO_OWNER',  label: '👑 Co-Owner',  color: '#f59e0b' },
  { value: 'ADMIN',     label: '🛡️ Admin',      color: '#6366f1' },
  { value: 'MODERATOR', label: '⚙️ Moderator',  color: '#10b981' },
  { value: 'VIP',       label: '💎 VIP',        color: '#06b6d4' },
  { value: 'OFFICIAL',  label: '✅ Official',   color: '#8b5cf6' },
  { value: 'MEMBER',    label: '👤 Member',     color: '#9ca3af' },
];

const LEVEL_OPTIONS = [
  { level: 1, label: '⭐ Fan' },
  { level: 2, label: '🌟 Regular' },
  { level: 3, label: '💎 VIP' },
  { level: 4, label: '🔥 Super' },
  { level: 5, label: '👑 Legend' },
];

const ROLE_COLORS: Record<MemberRole, string> = {
  OWNER:     '#f59e0b',
  CO_OWNER:  '#f59e0b',
  ADMIN:     '#6366f1',
  MODERATOR: '#10b981',
  VIP:       '#06b6d4',
  OFFICIAL:  '#8b5cf6',
  MEMBER:    '#9ca3af',
  BLOCKED:   '#ef4444',
};

// ─── Member Row ───────────────────────────────────────────────────────────────

function MemberRow({
  member, canManage, onBlock, onUnblock, onRemove, onSetRole, onSetLevel,
}: {
  member: RoomMember;
  canManage: boolean;
  onBlock: () => void;
  onUnblock: () => void;
  onRemove: () => void;
  onSetRole: () => void;
  onSetLevel: () => void;
}) {
  const name = `${member.user.firstName} ${member.user.lastName}`.trim();
  const roleColor = ROLE_COLORS[member.role] ?? '#9ca3af';
  const av = member.user.avatarUrl;

  return (
    <View style={ms.row}>
      {/* Avatar + online dot */}
      <View style={{ position: 'relative', flexShrink: 0 }}>
        {av
          ? <Image source={{ uri: avatarUrl(av, name) }} style={ms.av} />
          : <View style={[ms.av, { backgroundColor: '#ede9fe', alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#7c3aed' }}>
                {member.user.firstName.charAt(0)}{member.user.lastName.charAt(0)}
              </Text>
            </View>
        }
        {member.isOnline && <View style={ms.onlineDot} />}
      </View>

      {/* Info */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Text style={ms.name} numberOfLines={1}>{name}</Text>
          {member.nickname && (
            <Text style={ms.nickname} numberOfLines={1}>"{member.nickname}"</Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
          <View style={[ms.roleTag, { backgroundColor: roleColor + '22', borderColor: roleColor + '55' }]}>
            <Text style={[ms.roleTagTxt, { color: roleColor }]}>{member.role}</Text>
          </View>
          <Text style={ms.levelBadge}>{member.levelMeta.emoji} {member.levelMeta.label}</Text>
          {member.contribution > 0 && (
            <Text style={ms.coins}>🪙 {member.contribution.toLocaleString()}</Text>
          )}
        </View>
        {member.lastActiveLabel && (
          <Text style={ms.lastActive}>{member.lastActiveLabel}</Text>
        )}
      </View>

      {/* Actions */}
      {canManage && !['OWNER', 'CO_OWNER'].includes(member.role) && (
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {/* Role */}
          <TouchableOpacity style={ms.actionBtn} onPress={onSetRole} accessibilityLabel="Change role">
            <Ionicons name="shield-outline" size={16} color="#a5b4fc" />
          </TouchableOpacity>
          {/* Level */}
          <TouchableOpacity style={ms.actionBtn} onPress={onSetLevel} accessibilityLabel="Change level">
            <Ionicons name="star-outline" size={16} color="#fbbf24" />
          </TouchableOpacity>
          {/* Block / Unblock */}
          {member.isBanned
            ? <TouchableOpacity style={[ms.actionBtn, { backgroundColor: '#22c55e22' }]} onPress={onUnblock} accessibilityLabel="Unblock">
                <Ionicons name="lock-open-outline" size={16} color="#22c55e" />
              </TouchableOpacity>
            : <TouchableOpacity style={[ms.actionBtn, { backgroundColor: '#ef444422' }]} onPress={onBlock} accessibilityLabel="Block">
                <Ionicons name="ban-outline" size={16} color="#ef4444" />
              </TouchableOpacity>
          }
          {/* Remove */}
          <TouchableOpacity style={[ms.actionBtn, { backgroundColor: '#f9731622' }]} onPress={onRemove} accessibilityLabel="Remove member">
            <Ionicons name="person-remove-outline" size={16} color="#f97316" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Pending Request Row ──────────────────────────────────────────────────────

function PendingRow({
  member, onApprove, onReject,
}: {
  member: RoomMember;
  onApprove: () => void;
  onReject: () => void;
}) {
  const name = `${member.user.firstName} ${member.user.lastName}`.trim();
  const av = member.user.avatarUrl;

  return (
    <View style={ms.row}>
      <View style={{ flexShrink: 0 }}>
        {av
          ? <Image source={{ uri: avatarUrl(av, name) }} style={ms.av} />
          : <View style={[ms.av, { backgroundColor: '#ede9fe', alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#7c3aed' }}>
                {member.user.firstName.charAt(0)}{member.user.lastName.charAt(0)}
              </Text>
            </View>
        }
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={ms.name} numberOfLines={1}>{name}</Text>
        <Text style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>⏳ Pending approval</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <TouchableOpacity
          style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#22c55e', borderRadius: 10 }}
          onPress={onApprove}
        >
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✅ Approve</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#374151', borderRadius: 10 }}
          onPress={onReject}
        >
          <Text style={{ color: '#9ca3af', fontSize: 12, fontWeight: '700' }}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function MemberManagementPanel({ visible, roomId, myRole, onClose }: Props) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'members' | 'pending'>('members');
  const [search, setSearch] = useState('');
  const canManage = myRole === 'HOST' || myRole === 'MODERATOR';

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: membersData, isLoading } = useQuery({
    queryKey: ['room-members', roomId, tab, search],
    queryFn: () => api.get(`/voice/${roomId}/members`, {
      params: { limit: 50, ...(search ? { search } : {}) }
    }).then(r => r.data.data as RoomMember[]),
    enabled: visible && tab === 'members',
    staleTime: 15_000,
  });

  const { data: pendingData, isLoading: pendingLoading } = useQuery({
    queryKey: ['room-members-pending', roomId],
    queryFn: () => api.get(`/voice/${roomId}/members/pending`).then(r => r.data.data as RoomMember[]),
    enabled: visible && tab === 'pending',
    staleTime: 15_000,
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['room-members', roomId] });
    qc.invalidateQueries({ queryKey: ['room-members-pending', roomId] });
  }, [qc, roomId]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleApprove = useCallback(async (userId: string) => {
    try {
      await api.post(`/voice/${roomId}/members/${userId}/approve`);
      showMessage({ message: '✅ Member approved', type: 'success' });
      invalidate();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    }
  }, [roomId, invalidate]);

  const handleReject = useCallback(async (userId: string) => {
    try {
      await api.delete(`/voice/${roomId}/members/${userId}/reject`);
      showMessage({ message: 'Request rejected', type: 'info' });
      invalidate();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    }
  }, [roomId, invalidate]);

  const handleSetRole = useCallback((userId: string, name: string) => {
    Alert.alert(`Set Role — ${name}`, 'Choose a role:', [
      { text: 'Cancel', style: 'cancel' },
      ...ROLE_OPTIONS.map(opt => ({
        text: opt.label,
        onPress: async () => {
          try {
            await api.patch(`/voice/${roomId}/members/${userId}/role`, { role: opt.value });
            showMessage({ message: `${opt.label} set for ${name}`, type: 'success' });
            invalidate();
          } catch (e: any) {
            showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
          }
        },
      })),
    ]);
  }, [roomId, invalidate]);

  const handleSetLevel = useCallback((userId: string, name: string) => {
    Alert.alert(`Member Level — ${name}`, 'Choose a level:', [
      { text: 'Cancel', style: 'cancel' },
      ...LEVEL_OPTIONS.map(opt => ({
        text: opt.label,
        onPress: async () => {
          try {
            await api.patch(`/voice/${roomId}/members/${userId}/member-level`, { memberLevel: opt.level });
            showMessage({ message: `${opt.label} for ${name}`, type: 'success' });
            invalidate();
          } catch (e: any) {
            showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
          }
        },
      })),
    ]);
  }, [roomId, invalidate]);

  const handleBlock = useCallback((userId: string, name: string) => {
    Alert.alert('Block Member', `Block ${name} from this room?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: async () => {
        try {
          await api.patch(`/voice/${roomId}/members/${userId}/block`);
          showMessage({ message: `${name} blocked`, type: 'info' });
          invalidate();
        } catch (e: any) {
          showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
        }
      }},
    ]);
  }, [roomId, invalidate]);

  const handleUnblock = useCallback(async (userId: string, name: string) => {
    try {
      await api.patch(`/voice/${roomId}/members/${userId}/unblock`);
      showMessage({ message: `${name} unblocked`, type: 'success' });
      invalidate();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    }
  }, [roomId, invalidate]);

  const handleRemove = useCallback((userId: string, name: string) => {
    Alert.alert('Remove Member', `Remove ${name} from this room?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try {
          await api.delete(`/voice/${roomId}/members/${userId}/remove`);
          showMessage({ message: `${name} removed`, type: 'info' });
          invalidate();
        } catch (e: any) {
          showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
        }
      }},
    ]);
  }, [roomId, invalidate]);

  const members  = membersData ?? [];
  const pending  = pendingData ?? [];
  const loading  = tab === 'members' ? isLoading : pendingLoading;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={onClose}
    >
      <View style={ms.container}>
        {/* Header */}
        <View style={ms.header}>
          <Text style={ms.headerTitle}>⭐ Room Members</Text>
          <TouchableOpacity onPress={onClose} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color="#9ca3af" />
          </TouchableOpacity>
        </View>

        {/* Tab bar */}
        <View style={ms.tabBar}>
          <TouchableOpacity
            style={[ms.tabBtn, tab === 'members' && ms.tabBtnActive]}
            onPress={() => setTab('members')}
          >
            <Text style={[ms.tabTxt, tab === 'members' && ms.tabTxtActive]}>
              Members {members.length > 0 ? `(${members.length})` : ''}
            </Text>
          </TouchableOpacity>
          {canManage && (
            <TouchableOpacity
              style={[ms.tabBtn, tab === 'pending' && ms.tabBtnActive]}
              onPress={() => setTab('pending')}
            >
              <Text style={[ms.tabTxt, tab === 'pending' && ms.tabTxtActive]}>
                Pending {pending.length > 0 ? `(${pending.length})` : ''}
              </Text>
              {pending.length > 0 && (
                <View style={ms.pendingBadge}>
                  <Text style={ms.pendingBadgeTxt}>{pending.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Search (members tab only) */}
        {tab === 'members' && (
          <View style={ms.searchRow}>
            <Ionicons name="search-outline" size={14} color="#6b7280" />
            <TextInput
              style={ms.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search members…"
              placeholderTextColor="#6b7280"
            />
            {search ? (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Ionicons name="close-circle" size={14} color="#6b7280" />
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* Content */}
        {loading ? (
          <View style={ms.loading}>
            <ActivityIndicator color="#7c3aed" />
          </View>
        ) : tab === 'members' ? (
          <FlatList
            data={members}
            keyExtractor={m => m.id}
            contentContainerStyle={ms.list}
            renderItem={({ item: m }) => (
              <MemberRow
                member={m}
                canManage={canManage}
                onSetRole={() => handleSetRole(m.userId, `${m.user.firstName} ${m.user.lastName}`)}
                onSetLevel={() => handleSetLevel(m.userId, `${m.user.firstName} ${m.user.lastName}`)}
                onBlock={() => handleBlock(m.userId, `${m.user.firstName} ${m.user.lastName}`)}
                onUnblock={() => handleUnblock(m.userId, `${m.user.firstName} ${m.user.lastName}`)}
                onRemove={() => handleRemove(m.userId, `${m.user.firstName} ${m.user.lastName}`)}
              />
            )}
            ListEmptyComponent={
              <Text style={ms.empty}>
                {search ? `No members matching "${search}"` : 'No active members yet'}
              </Text>
            }
          />
        ) : (
          <FlatList
            data={pending}
            keyExtractor={m => m.id}
            contentContainerStyle={ms.list}
            renderItem={({ item: m }) => (
              <PendingRow
                member={m}
                onApprove={() => handleApprove(m.userId)}
                onReject={() => handleReject(m.userId)}
              />
            )}
            ListEmptyComponent={
              <Text style={ms.empty}>No pending requests</Text>
            }
          />
        )}
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ms = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0f0f23' },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e3a' },
  headerTitle:  { color: '#fff', fontSize: 17, fontWeight: '700' },

  tabBar:       { flexDirection: 'row', backgroundColor: '#111827', margin: 12, borderRadius: 12, padding: 3 },
  tabBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 9 },
  tabBtnActive: { backgroundColor: '#1e1040' },
  tabTxt:       { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  tabTxtActive: { color: '#a5b4fc' },
  pendingBadge: { backgroundColor: '#f59e0b', borderRadius: 10, paddingHorizontal: 5, paddingVertical: 1, minWidth: 18, alignItems: 'center' },
  pendingBadgeTxt: { color: '#fff', fontSize: 10, fontWeight: '800' },

  searchRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#111827', borderRadius: 10, borderWidth: 1, borderColor: '#374151', paddingHorizontal: 10, paddingVertical: 7, marginHorizontal: 12, marginBottom: 8 },
  searchInput:  { flex: 1, fontSize: 13, color: '#e5e7eb' },

  list:         { paddingHorizontal: 12, paddingBottom: 40, gap: 2 },
  loading:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  empty:        { textAlign: 'center', color: '#6b7280', fontSize: 14, padding: 32 },

  row:          { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1e1e3a', borderRadius: 12, padding: 10, marginBottom: 4 },
  av:           { width: 40, height: 40, borderRadius: 20 },
  onlineDot:    { position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: '#22c55e', borderWidth: 2, borderColor: '#1e1e3a' },
  name:         { color: '#e5e7eb', fontSize: 14, fontWeight: '600' },
  nickname:     { color: '#9ca3af', fontSize: 11, fontStyle: 'italic' },
  roleTag:      { borderRadius: 8, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  roleTagTxt:   { fontSize: 10, fontWeight: '700' },
  levelBadge:   { fontSize: 11, color: '#a5b4fc' },
  coins:        { fontSize: 11, color: '#fbbf24' },
  lastActive:   { fontSize: 10, color: '#6b7280', marginTop: 1 },
  actionBtn:    { width: 30, height: 30, borderRadius: 8, backgroundColor: '#374151', alignItems: 'center', justifyContent: 'center' },
});
