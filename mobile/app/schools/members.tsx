/**
 * HALQA Mobile — School Members Management
 * Route: /schools/members
 *
 * SCHOOL_ADMIN only.
 * - View all members (filter by role/status)
 * - Approve / reject pending join requests
 * - Suspend / reactivate active members
 * - Change member role
 * - Remove member
 * - Invite by email
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, Modal, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { showMessage } from 'react-native-flash-message';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import api from '@/lib/api';
import { useSchoolStore } from '@/store/school.store';
import { useAuthStore } from '@/store/auth.store';

type Member = {
  id: string;
  userId: string;
  role: string;
  status: string;
  joinedAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    avatarUrl: string | null;
  };
};

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  SCHOOL_ADMIN: { bg: '#f5f3ff', text: '#7c3aed' },
  TEACHER:      { bg: '#f0fdf4', text: '#16a34a' },
  STUDENT:      { bg: '#eff6ff', text: '#2563eb' },
  GUARDIAN:     { bg: '#fff7ed', text: '#ea580c' },
};

const STATUS_ICON: Record<string, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
  ACTIVE:    { name: 'checkmark-circle',   color: '#10b981' },
  PENDING:   { name: 'time-outline',        color: '#f59e0b' },
  SUSPENDED: { name: 'close-circle',        color: '#ef4444' },
};

const EDUCATION_ROLES = ['TEACHER', 'STUDENT', 'GUARDIAN', 'SCHOOL_ADMIN'];

export default function SchoolMembersScreen() {
  const router      = useRouter();
  const qc          = useQueryClient();  const user        = useAuthStore(s => s.user);
  const schoolStore = useSchoolStore();
  const activeSchoolId = schoolStore.activeSchoolId ?? schoolStore.memberships.find(m => m.status === 'ACTIVE')?.schoolId;
  const myMembership   = schoolStore.memberships.find(m => m.schoolId === activeSchoolId);
  const isAdmin        = myMembership?.role === 'SCHOOL_ADMIN' || user?.role === 'SUPER_ADMIN';
  const activeSchoolName = myMembership?.school?.name ?? 'School';

  const [search, setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [actionId, setActionId]   = useState<string | null>(null);

  // Invite modal state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole]   = useState('STUDENT');
  const [inviting, setInviting]       = useState(false);

  // Role change modal
  const [roleModal, setRoleModal] = useState<Member | null>(null);
  const [newRole, setNewRole]     = useState('');

  const { data: members = [], isLoading, refetch } = useQuery<Member[]>({
    queryKey: ['school-members', activeSchoolId, statusFilter],
    queryFn: async () => {
      const status = statusFilter !== 'all' ? `&status=${statusFilter}` : '';
      const res = await api.get(`/school-memberships/school/${activeSchoolId}?limit=200${status}`);
      return res.data.data ?? [];
    },
    enabled: !!activeSchoolId && isAdmin,
  });

  const pendingCount = members.filter(m => m.status === 'PENDING').length;

  const filtered = members.filter(m => {
    const name = `${m.user.firstName} ${m.user.lastName} ${m.user.email}`.toLowerCase();
    return name.includes(search.toLowerCase());
  });

  async function doAction(memberId: string, action: () => Promise<any>, label: string) {
    setActionId(memberId);
    try {
      await action();
      showMessage({ message: label, type: 'success' });
      qc.invalidateQueries({ queryKey: ['school-members'] });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message || 'Action failed', type: 'danger' });
    } finally {
      setActionId(null);
    }
  }

  function confirmRemove(m: Member) {
    Alert.alert(
      'Remove Member',
      `Remove ${m.user.firstName} ${m.user.lastName} from ${activeSchoolName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () =>
          doAction(m.id, () => api.delete(`/school-memberships/${m.id}`), 'Member removed')
        },
      ]
    );
  }

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await api.post('/school-memberships/invite', {
        schoolId: activeSchoolId,
        userEmail: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
      });
      showMessage({ message: `${inviteEmail} invited as ${inviteRole}`, type: 'success' });
      setInviteEmail('');
      setShowInvite(false);
      qc.invalidateQueries({ queryKey: ['school-members'] });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message || 'Invite failed', type: 'danger' });
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange() {
    if (!roleModal || !newRole || newRole === roleModal.role) return;
    doAction(roleModal.id, () =>
      api.put(`/school-memberships/${roleModal.id}/role`, { role: newRole }),
      `Role changed to ${newRole}`
    );
    setRoleModal(null);
  }

  if (!isAdmin) {
    return (
      <SafeAreaView style={s.container}>
        <Stack.Screen options={{ title: 'Members' }} />
        <View style={s.emptyWrap}>
          <Text style={s.emptyTitle}>Admin access required</Text>
        </View>
      </SafeAreaView>
    );
  }

  const renderMember = ({ item: m }: { item: Member }) => {
    const roleStyle = ROLE_COLORS[m.role] ?? { bg: '#f1f5f9', text: '#64748b' };
    const statusCfg = STATUS_ICON[m.status] ?? STATUS_ICON.PENDING;
    const isActing  = actionId === m.id;
    const initials  = `${m.user.firstName[0]}${m.user.lastName[0]}`.toUpperCase();

    return (
      <View style={s.memberRow}>
        {/* Avatar — tappable for STUDENT members to view their ID card, GUARDIAN to view profile */}
        <TouchableOpacity
          style={s.avatar}
          onPress={() => {
            if (m.role === 'STUDENT' && m.user.id) {
              router.push({ pathname: '/student-id-card', params: { studentId: m.user.id } } as any);
            } else if (m.role === 'GUARDIAN' && m.user.id) {
              // Navigate to guardian detail — but we need the guardian record ID, not user ID.
              // We navigate with userId and the guardian detail screen resolves the guardian record.
              router.push({ pathname: '/guardians/by-user', params: { userId: m.user.id } } as any);
            }
          }}
          activeOpacity={(m.role === 'STUDENT' || m.role === 'GUARDIAN') ? 0.7 : 1}
        >
          <Text style={s.avatarText}>{initials}</Text>
          {m.role === 'STUDENT' && (
            <View style={s.idCardDot}>
              <Ionicons name="card-outline" size={8} color="#fff" />
            </View>
          )}
          {m.role === 'GUARDIAN' && (
            <View style={[s.idCardDot, { backgroundColor: '#ea580c' }]}>
              <Ionicons name="people-outline" size={8} color="#fff" />
            </View>
          )}
        </TouchableOpacity>

        {/* Info */}
        <View style={s.memberInfo}>
          <Text style={s.memberName} numberOfLines={1}>{m.user.firstName} {m.user.lastName}</Text>
          <Text style={s.memberEmail} numberOfLines={1}>{m.user.email}</Text>
          <View style={s.memberBadges}>
            <TouchableOpacity
              style={[s.roleBadge, { backgroundColor: roleStyle.bg }]}
              onPress={() => { setRoleModal(m); setNewRole(m.role); }}
            >
              <Text style={[s.roleBadgeText, { color: roleStyle.text }]}>
                {m.role.replace(/_/g, ' ')}
              </Text>
              <Ionicons name="chevron-down" size={10} color={roleStyle.text} />
            </TouchableOpacity>
            <Ionicons name={statusCfg.name} size={14} color={statusCfg.color} />
          </View>
        </View>

        {/* Actions */}
        {isActing ? (
          <ActivityIndicator size="small" color="#4f46e5" style={{ marginLeft: 8 }} />
        ) : (
          <View style={s.actions}>
            {m.status === 'PENDING' && (
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: '#d1fae5' }]}
                onPress={() => doAction(m.id, () => api.put(`/school-memberships/${m.id}/status`, { status: 'ACTIVE' }), '✅ Approved')}
              >
                <Ionicons name="checkmark" size={16} color="#10b981" />
              </TouchableOpacity>
            )}
            {m.status === 'PENDING' && (
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: '#fee2e2' }]}
                onPress={() => doAction(m.id, () => api.delete(`/school-memberships/${m.id}`), 'Rejected')}
              >
                <Ionicons name="close" size={16} color="#ef4444" />
              </TouchableOpacity>
            )}
            {m.status === 'ACTIVE' && (
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: '#fef3c7' }]}
                onPress={() => doAction(m.id, () => api.put(`/school-memberships/${m.id}/status`, { status: 'SUSPENDED' }), 'Suspended')}
              >
                <Ionicons name="pause" size={16} color="#f59e0b" />
              </TouchableOpacity>
            )}
            {m.status === 'SUSPENDED' && (
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: '#d1fae5' }]}
                onPress={() => doAction(m.id, () => api.put(`/school-memberships/${m.id}/status`, { status: 'ACTIVE' }), 'Reactivated')}
              >
                <Ionicons name="play" size={16} color="#10b981" />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: '#fee2e2' }]}
              onPress={() => confirmRemove(m)}
            >
              <Ionicons name="trash-outline" size={16} color="#ef4444" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <Stack.Screen options={{
        title: 'Members',
        headerRight: () => (
          <TouchableOpacity onPress={() => setShowInvite(true)} style={{ marginRight: 8 }}>
            <Ionicons name="person-add-outline" size={22} color="#4f46e5" />
          </TouchableOpacity>
        )
      }} />

      {/* Pending banner */}
      {pendingCount > 0 && (
        <TouchableOpacity
          style={s.pendingBanner}
          onPress={() => setStatusFilter('PENDING')}
        >
          <Ionicons name="time-outline" size={16} color="#92400e" />
          <Text style={s.pendingText}>{pendingCount} pending request{pendingCount > 1 ? 's' : ''} — tap to review</Text>
          <Ionicons name="chevron-forward" size={14} color="#92400e" />
        </TouchableOpacity>
      )}

      {/* Search + filter */}
      <View style={s.filterRow}>
        <View style={s.searchWrap}>
          <Ionicons name="search-outline" size={15} color="#9ca3af" />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search members…"
            placeholderTextColor="#9ca3af"
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipScroll} contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}>
          {['all', 'ACTIVE', 'PENDING', 'SUSPENDED'].map(f => (
            <TouchableOpacity
              key={f}
              style={[s.chip, statusFilter === f && s.chipActive]}
              onPress={() => setStatusFilter(f)}
            >
              <Text style={[s.chipText, statusFilter === f && s.chipTextActive]}>
                {f === 'all' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color="#4f46e5" style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={m => m.id}
          renderItem={renderMember}
          refreshing={false}
          onRefresh={refetch}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={s.emptyWrap}>
              <Ionicons name="people-outline" size={40} color="#d1d5db" />
              <Text style={s.emptyTitle}>No members found</Text>
            </View>
          }
        />
      )}

      {/* Invite Modal */}
      <Modal visible={showInvite} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowInvite(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Invite Member</Text>
            <TouchableOpacity onPress={() => setShowInvite(false)}>
              <Ionicons name="close" size={22} color="#374151" />
            </TouchableOpacity>
          </View>
          <View style={{ padding: 20, gap: 14 }}>
            <View>
              <Text style={s.fieldLabel}>Email Address</Text>
              <TextInput
                style={s.fieldInput}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="user@example.com"
                placeholderTextColor="#9ca3af"
              />
            </View>
            <View>
              <Text style={s.fieldLabel}>Role</Text>
              <View style={s.roleOptions}>
                {['STUDENT', 'TEACHER', 'GUARDIAN', 'SCHOOL_ADMIN'].map(r => (
                  <TouchableOpacity
                    key={r}
                    style={[s.roleOption, inviteRole === r && s.roleOptionActive]}
                    onPress={() => setInviteRole(r)}
                  >
                    <Text style={[s.roleOptionText, inviteRole === r && { color: '#4f46e5', fontWeight: '700' }]}>
                      {r.replace(/_/g, ' ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <TouchableOpacity
              style={[s.inviteBtn, (!inviteEmail.trim() || inviting) && { opacity: 0.5 }]}
              onPress={handleInvite}
              disabled={!inviteEmail.trim() || inviting}
            >
              {inviting
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <Ionicons name="person-add-outline" size={16} color="#fff" />
                    <Text style={s.inviteBtnText}>Send Invite</Text>
                  </>
              }
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Role Change Modal */}
      <Modal visible={!!roleModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setRoleModal(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Change Role</Text>
            <TouchableOpacity onPress={() => setRoleModal(null)}>
              <Ionicons name="close" size={22} color="#374151" />
            </TouchableOpacity>
          </View>
          <View style={{ padding: 20 }}>
            <Text style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>
              Changing role for <Text style={{ fontWeight: '700', color: '#111827' }}>{roleModal?.user.firstName} {roleModal?.user.lastName}</Text>
            </Text>
            <View style={s.roleOptions}>
              {['STUDENT', 'TEACHER', 'GUARDIAN', 'SCHOOL_ADMIN'].map(r => (
                <TouchableOpacity
                  key={r}
                  style={[s.roleOption, newRole === r && s.roleOptionActive]}
                  onPress={() => setNewRole(r)}
                >
                  <Text style={[s.roleOptionText, newRole === r && { color: '#4f46e5', fontWeight: '700' }]}>
                    {r.replace(/_/g, ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[s.inviteBtn, { marginTop: 20 }, (newRole === roleModal?.role || !newRole) && { opacity: 0.5 }]}
              onPress={handleRoleChange}
              disabled={newRole === roleModal?.role || !newRole}
            >
              <Text style={s.inviteBtnText}>Save Role</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#f8fafc' },
  pendingBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fef3c7', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#fde68a' },
  pendingText:   { flex: 1, fontSize: 13, color: '#92400e', fontWeight: '600' },
  filterRow:     { padding: 12, gap: 8 },
  searchWrap:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  searchInput:   { flex: 1, fontSize: 14, color: '#111827' },
  chipScroll:    { flexGrow: 0 },
  chip:          { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  chipActive:    { backgroundColor: '#eef2ff', borderColor: '#4f46e5' },
  chipText:      { fontSize: 12, color: '#64748b', fontWeight: '500' },
  chipTextActive:{ color: '#4f46e5', fontWeight: '700' },

  memberRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#f1f5f9', gap: 10 },
  avatar:        { width: 40, height: 40, borderRadius: 20, backgroundColor: '#eef2ff', justifyContent: 'center', alignItems: 'center', flexShrink: 0, position: 'relative' },
  avatarText:    { fontSize: 14, fontWeight: '700', color: '#4f46e5' },
  idCardDot:     { position: 'absolute', bottom: -2, right: -2, width: 14, height: 14, borderRadius: 7, backgroundColor: '#4f46e5', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: '#fff' },
  memberInfo:    { flex: 1, minWidth: 0 },
  memberName:    { fontSize: 14, fontWeight: '600', color: '#111827' },
  memberEmail:   { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  memberBadges:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  roleBadge:     { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10 },
  roleBadgeText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  actions:       { flexDirection: 'row', gap: 5, flexShrink: 0 },
  actionBtn:     { width: 30, height: 30, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },

  // Modal
  modalHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  modalTitle:    { fontSize: 18, fontWeight: '700', color: '#111827' },
  fieldLabel:    { fontSize: 12, fontWeight: '600', color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  fieldInput:    { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: '#111827', backgroundColor: '#f9fafb' },
  roleOptions:   { gap: 8 },
  roleOption:    { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  roleOptionActive: { borderColor: '#4f46e5', backgroundColor: '#eef2ff' },
  roleOptionText:{ fontSize: 14, color: '#374151', textTransform: 'capitalize' },
  inviteBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#4f46e5', borderRadius: 12, paddingVertical: 14 },
  inviteBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  emptyWrap:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle:    { fontSize: 15, color: '#9ca3af' },
});
