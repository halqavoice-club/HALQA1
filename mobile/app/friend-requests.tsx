/**
 * HALQA Mobile — Friend Requests
 * Incoming: accept / reject
 * Sent: cancel pending requests
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';

interface FriendUser {
  id: string; firstName: string; lastName: string;
  avatarUrl?: string | null; role?: string;
}
interface FriendRequest {
  requestId: string;
  user: FriendUser;
  createdAt?: string;
}

const TAB_COLORS = { incoming: '#4f46e5', sent: '#f59e0b' };

function RequestRow({ req, mode, onAction, loading }: {
  req: FriendRequest;
  mode: 'incoming' | 'sent';
  onAction: (action: 'accept' | 'reject' | 'cancel') => void;
  loading: boolean;
}) {
  const u = req.user;
  const src = u.avatarUrl;
  const initials = `${u.firstName?.charAt(0) ?? ''}${u.lastName?.charAt(0) ?? ''}`;
  return (
    <View style={s.row}>
      <TouchableOpacity onPress={() => {}}>
        <View style={s.avWrap}>
          {src
            ? <Image source={{ uri: avatarUrl(src, `${u.firstName} ${u.lastName}`) }} style={s.av} />
            : <Text style={s.avInitials}>{initials}</Text>}
        </View>
      </TouchableOpacity>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.name} numberOfLines={1}>{u.firstName} {u.lastName}</Text>
        <Text style={s.role} numberOfLines={1}>{(u.role ?? '').toLowerCase()}</Text>
      </View>
      {loading ? (
        <ActivityIndicator size="small" color="#4f46e5" />
      ) : mode === 'incoming' ? (
        <View style={s.actions}>
          <TouchableOpacity style={s.acceptBtn} onPress={() => onAction('accept')}>
            <Ionicons name="checkmark" size={14} color="#fff" />
            <Text style={s.acceptTxt}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.rejectBtn} onPress={() => onAction('reject')}>
            <Ionicons name="close" size={14} color="#6b7280" />
            <Text style={s.rejectTxt}>Reject</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.actions}>
          <View style={s.pendingBadge}>
            <Text style={s.pendingTxt}>Pending</Text>
          </View>
          <TouchableOpacity style={s.cancelBtn} onPress={() => onAction('cancel')}>
            <Ionicons name="close" size={14} color="#ef4444" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function FriendRequestsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'incoming' | 'sent'>('incoming');
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const { data: incoming = [], isLoading: loadIn, refetch: refetchIn } = useQuery<FriendRequest[]>({
    queryKey: ['friend-requests-incoming'],
    queryFn: () => api.get('/social/friends/requests').then(r => r.data.data ?? []),
  });

  const { data: sent = [], isLoading: loadSent, refetch: refetchSent } = useQuery<FriendRequest[]>({
    queryKey: ['friend-requests-sent'],
    queryFn: () => api.get('/social/friends/requests/sent').then(r => r.data.data ?? []),
    enabled: tab === 'sent',
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['friend-requests-incoming'] });
    queryClient.invalidateQueries({ queryKey: ['friend-requests-sent'] });
    queryClient.invalidateQueries({ queryKey: ['friends'] });
    queryClient.invalidateQueries({ queryKey: ['social-counts'] });
  }, [queryClient]);

  const handleAction = useCallback(async (userId: string, action: 'accept' | 'reject' | 'cancel') => {
    setLoadingId(userId);
    try {
      if (action === 'accept') {
        await api.post(`/social/friends/accept/${userId}`);
        showMessage({ message: '✅ Now friends!', type: 'success' });
      } else if (action === 'reject') {
        await api.post(`/social/friends/reject/${userId}`);
        showMessage({ message: 'Request rejected', type: 'info' });
      } else {
        await api.delete(`/social/friends/request/${userId}`);
        showMessage({ message: 'Request cancelled', type: 'info' });
      }
      invalidate();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    } finally {
      setLoadingId(null);
    }
  }, [invalidate]);

  const data = tab === 'incoming' ? incoming : sent;
  const loading = tab === 'incoming' ? loadIn : loadSent;
  const emptyIcon = tab === 'incoming' ? 'person-add-outline' : 'time-outline';
  const emptyText = tab === 'incoming' ? 'No pending requests' : 'No sent requests';

  return (
    <>
      <Stack.Screen options={{
        headerShown: true, title: 'Friend Requests',
        headerTintColor: '#4f46e5',
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
            <Ionicons name="arrow-back" size={22} color="#4f46e5" />
          </TouchableOpacity>
        ),
      }} />
      <SafeAreaView style={s.container} edges={['bottom']}>
        {/* Tab bar */}
        <View style={s.tabBar}>
          {(['incoming', 'sent'] as const).map(t => (
            <TouchableOpacity
              key={t}
              style={[s.tabBtn, tab === t && s.tabBtnActive]}
              onPress={() => setTab(t)}
            >
              <Text style={[s.tabTxt, tab === t && s.tabTxtActive]}>
                {t === 'incoming'
                  ? `Incoming${incoming.length > 0 ? ` (${incoming.length})` : ''}`
                  : `Sent${sent.length > 0 ? ` (${sent.length})` : ''}`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#4f46e5" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={data}
            keyExtractor={r => r.requestId}
            contentContainerStyle={{ padding: 12, paddingBottom: 40 + insets.bottom }}
            refreshControl={
              <RefreshControl
                refreshing={false}
                onRefresh={() => tab === 'incoming' ? refetchIn() : refetchSent()}
                tintColor="#4f46e5"
              />
            }
            renderItem={({ item }) => (
              <RequestRow
                req={item}
                mode={tab}
                loading={loadingId === item.user.id}
                onAction={action => handleAction(item.user.id, action)}
              />
            )}
            ListEmptyComponent={
              <View style={s.empty}>
                <Ionicons name={emptyIcon as any} size={48} color="#d1d5db" />
                <Text style={s.emptyTxt}>{emptyText}</Text>
              </View>
            }
          />
        )}
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f8fafc' },
  tabBar:       { flexDirection: 'row', backgroundColor: '#f1f5f9', margin: 12, borderRadius: 14, padding: 3 },
  tabBtn:       { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 11 },
  tabBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  tabTxt:       { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  tabTxtActive: { color: '#1e293b', fontWeight: '700' },
  row:          { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 8, gap: 10, borderWidth: 1, borderColor: '#f1f5f9' },
  avWrap:       { width: 46, height: 46, borderRadius: 23, backgroundColor: '#e0e7ff', overflow: 'hidden', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  av:           { width: 46, height: 46 },
  avInitials:   { fontSize: 15, fontWeight: '800', color: '#4f46e5' },
  name:         { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  role:         { fontSize: 11, color: '#94a3b8', marginTop: 1, textTransform: 'capitalize' },
  actions:      { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  acceptBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#4f46e5', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  acceptTxt:    { color: '#fff', fontSize: 11, fontWeight: '700' },
  rejectBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f1f5f9', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  rejectTxt:    { color: '#6b7280', fontSize: 11, fontWeight: '700' },
  pendingBadge: { backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  pendingTxt:   { color: '#92400e', fontSize: 11, fontWeight: '700' },
  cancelBtn:    { width: 28, height: 28, borderRadius: 8, backgroundColor: '#fef2f2', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#fee2e2' },
  empty:        { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTxt:     { fontSize: 15, color: '#94a3b8', marginTop: 12 },
});
