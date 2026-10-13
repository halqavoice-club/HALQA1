/**
 * HALQA Mobile — Friend Tab
 * Friends list, pending friend requests, and people you may know.
 * Mirrors the website's /social page functionality.
 *
 * FIX FEAT-001:
 *  - Requests tab: GET /social/friends/requests (was /social/requests/pending)
 *  - Accept:  POST /social/friends/accept/:userId (was PATCH /social/requests/:id/accept)
 *  - Decline: POST /social/friends/reject/:userId (was PATCH /social/requests/:id/decline)
 *  - Discover: GET /social/search (was /social/suggestions), only fires when >= 2 chars
 *  - FriendRequest type updated to match backend response { requestId, user, sentAt }
 */
import { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, TextInput, Image, RefreshControl,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { getAvatarUrl } from '@/lib/avatar';

type User = {
  id: string; firstName: string; lastName: string;
  avatarUrl: string | null; username?: string | null;
  friendStatus?: 'none' | 'pending_sent' | 'pending_received' | 'friends';
};

// Backend returns { requestId, user, sentAt }[] from GET /social/friends/requests
type FriendRequest = { requestId: string; user: User; sentAt: string };

function Avatar({ user, size = 44 }: { user: User; size?: number }) {
  const uri = getAvatarUrl(user.avatarUrl);
  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`;
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2 }, styles.avatarFallback]}>
      <Text allowFontScaling={false} style={[styles.avatarText, { fontSize: size * 0.35 }]}>{initials}</Text>
    </View>
  );
}

export default function FriendScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'requests' | 'friends' | 'discover'>('requests');
  const [search, setSearch] = useState('');

  // ── Pending friend requests ──────────────────────────────────────────────
  // Backend: GET /social/friends/requests → { requestId, user, sentAt }[]
  const { data: requests = [], isLoading: loadingReq, refetch: refetchReq } = useQuery<FriendRequest[]>({
    queryKey: ['friend-requests'],
    queryFn: () => api.get('/social/friends/requests').then(r => {
      const d = r.data.data;
      return Array.isArray(d) ? d : [];
    }),
    staleTime: 30_000,
  });

  // ── My friends / following ───────────────────────────────────────────────
  const { data: friends = [], isLoading: loadingFriends, refetch: refetchFriends } = useQuery<User[]>({
    queryKey: ['friends-list'],
    queryFn: () => api.get('/social/friends').then(r => {
      const d = r.data.data;
      return Array.isArray(d) ? d : (d?.friends ?? []);
    }),
    enabled: tab === 'friends',
    staleTime: 60_000,
  });

  // ── Discover / search ────────────────────────────────────────────────────
  // Backend: GET /social/search?q= → User[] (requires q.length >= 2)
  const { data: suggested = [], isLoading: loadingSuggested } = useQuery<User[]>({
    queryKey: ['suggested-users', search],
    queryFn: () => api.get('/social/search', {
      params: { q: search.trim(), limit: 20 }
    }).then(r => {
      const d = r.data.data;
      return Array.isArray(d) ? d : [];
    }),
    // Only fire when on discover tab AND search has >= 2 chars
    enabled: tab === 'discover' && search.trim().length >= 2,
    staleTime: 60_000,
  });

  // ── Accept: POST /social/friends/accept/:userId ──────────────────────────
  const acceptMutation = useMutation({
    mutationFn: (userId: string) => api.post(`/social/friends/accept/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friend-requests'] });
      queryClient.invalidateQueries({ queryKey: ['friend-requests-count'] });
      queryClient.invalidateQueries({ queryKey: ['friends-list'] });
    },
  });

  // ── Decline: POST /social/friends/reject/:userId ─────────────────────────
  const declineMutation = useMutation({
    mutationFn: (userId: string) => api.post(`/social/friends/reject/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friend-requests'] });
      queryClient.invalidateQueries({ queryKey: ['friend-requests-count'] });
    },
  });

  // ── Follow (from Discover tab) ───────────────────────────────────────────
  const followMutation = useMutation({
    mutationFn: (userId: string) => api.post(`/social/follow/${userId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['suggested-users'] }),
  });

  const isLoading = tab === 'requests' ? loadingReq
    : tab === 'friends' ? loadingFriends
    : loadingSuggested;

  const onRefresh = () => {
    if (tab === 'requests') refetchReq();
    else if (tab === 'friends') refetchFriends();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text allowFontScaling={false} style={styles.title}>Friends</Text>
          {requests.length > 0 && tab !== 'requests' && (
            <Text allowFontScaling={false} style={styles.subtitle}>
              {requests.length} pending request{requests.length !== 1 ? 's' : ''}
            </Text>
          )}
        </View>
        <TouchableOpacity onPress={() => router.push('/friend-requests' as any)} style={styles.headerBtn}>
          <Ionicons name="person-add-outline" size={20} color="#4f46e5" />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {([
          { key: 'requests', label: 'Requests', badge: requests.length },
          { key: 'friends',  label: 'Friends', badge: 0 },
          { key: 'discover', label: 'Discover', badge: 0 },
        ] as const).map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text allowFontScaling={false} style={[styles.tabText, tab === t.key && styles.tabTextActive]}>
                {t.label}
              </Text>
              {t.badge > 0 && (
                <View style={styles.tabBadge}>
                  <Text allowFontScaling={false} style={styles.tabBadgeText}>
                    {t.badge > 9 ? '9+' : t.badge}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* Search bar for Discover */}
      {tab === 'discover' && (
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={16} color="#9ca3af" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Type to search people..."
            placeholderTextColor="#9ca3af"
            style={styles.searchInput}
            allowFontScaling={false}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color="#9ca3af" />
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4f46e5" />
        </View>
      ) : (
        <>
          {/* ── Friend Requests ── */}
          {tab === 'requests' && (
            <FlatList
              data={requests}
              keyExtractor={r => r.requestId}
              contentContainerStyle={{ paddingBottom: 80 + insets.bottom }}
              refreshControl={<RefreshControl refreshing={loadingReq} onRefresh={refetchReq} tintColor="#4f46e5" />}
              renderItem={({ item }) => (
                <View style={styles.requestRow}>
                  <TouchableOpacity onPress={() => router.push({ pathname: '/profile/[id]', params: { id: item.user.id } } as any)}>
                    <Avatar user={item.user} />
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text allowFontScaling={false} style={styles.userName}>
                      {item.user.firstName} {item.user.lastName}
                    </Text>
                    {item.user.username && (
                      <Text allowFontScaling={false} style={styles.userHandle}>@{item.user.username}</Text>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      style={styles.acceptBtn}
                      onPress={() => acceptMutation.mutate(item.user.id)}
                      disabled={acceptMutation.isPending}
                    >
                      <Text allowFontScaling={false} style={styles.acceptBtnText}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.declineBtn}
                      onPress={() => declineMutation.mutate(item.user.id)}
                      disabled={declineMutation.isPending}
                    >
                      <Text allowFontScaling={false} style={styles.declineBtnText}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Ionicons name="person-outline" size={48} color="#d1d5db" />
                  <Text allowFontScaling={false} style={styles.emptyTitle}>No pending requests</Text>
                  <Text allowFontScaling={false} style={styles.emptySub}>You're all caught up</Text>
                </View>
              }
            />
          )}

          {/* ── Friends List ── */}
          {tab === 'friends' && (
            <FlatList
              data={friends}
              keyExtractor={u => u.id}
              contentContainerStyle={{ paddingBottom: 80 + insets.bottom }}
              refreshControl={<RefreshControl refreshing={loadingFriends} onRefresh={refetchFriends} tintColor="#4f46e5" />}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.friendRow}
                  onPress={() => router.push({ pathname: '/profile/[id]', params: { id: item.id } } as any)}
                  activeOpacity={0.7}
                >
                  <Avatar user={item} />
                  <View style={{ flex: 1 }}>
                    <Text allowFontScaling={false} style={styles.userName}>
                      {item.firstName} {item.lastName}
                    </Text>
                    {item.username && (
                      <Text allowFontScaling={false} style={styles.userHandle}>@{item.username}</Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={styles.msgBtn}
                    onPress={() => router.push({ pathname: '/dm/[id]', params: { id: item.id } } as any)}
                  >
                    <Ionicons name="chatbubble-outline" size={18} color="#4f46e5" />
                  </TouchableOpacity>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Ionicons name="people-outline" size={48} color="#d1d5db" />
                  <Text allowFontScaling={false} style={styles.emptyTitle}>No friends yet</Text>
                  <TouchableOpacity style={styles.discoverBtn} onPress={() => setTab('discover')}>
                    <Text allowFontScaling={false} style={styles.discoverBtnText}>Find people →</Text>
                  </TouchableOpacity>
                </View>
              }
            />
          )}

          {/* ── Discover / Search ── */}
          {tab === 'discover' && (
            <FlatList
              data={suggested}
              keyExtractor={u => u.id}
              contentContainerStyle={{ paddingBottom: 80 + insets.bottom }}
              renderItem={({ item }) => (
                <View style={styles.friendRow}>
                  <TouchableOpacity onPress={() => router.push({ pathname: '/profile/[id]', params: { id: item.id } } as any)}>
                    <Avatar user={item} />
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text allowFontScaling={false} style={styles.userName}>
                      {item.firstName} {item.lastName}
                    </Text>
                    {item.username && (
                      <Text allowFontScaling={false} style={styles.userHandle}>@{item.username}</Text>
                    )}
                  </View>
                  {/* Show button based on friendStatus from search results */}
                  {item.friendStatus === 'friends' ? (
                    <View style={styles.friendedBtn}>
                      <Text allowFontScaling={false} style={styles.friendedBtnText}>Friends</Text>
                    </View>
                  ) : item.friendStatus === 'pending_sent' ? (
                    <View style={styles.pendingBtn}>
                      <Text allowFontScaling={false} style={styles.pendingBtnText}>Pending</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.followBtn}
                      onPress={() => followMutation.mutate(item.id)}
                      disabled={followMutation.isPending}
                    >
                      <Text allowFontScaling={false} style={styles.followBtnText}>Follow</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Ionicons name="search-outline" size={48} color="#d1d5db" />
                  <Text allowFontScaling={false} style={styles.emptyTitle}>
                    {search.trim().length < 2 ? 'Type to search people...' : 'No people found'}
                  </Text>
                  {search.trim().length < 2 && (
                    <Text allowFontScaling={false} style={styles.emptySub}>
                      Enter at least 2 characters to search
                    </Text>
                  )}
                </View>
              }
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#f9fafb' },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  title:           { fontSize: 22, fontWeight: '900', color: '#111827' },
  subtitle:        { fontSize: 12, color: '#4f46e5', fontWeight: '600', marginTop: 1 },
  headerBtn:       { padding: 8 },
  tabs:            { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  tab:             { flex: 1, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  tabActive:       { borderBottomWidth: 2, borderBottomColor: '#4f46e5' },
  tabText:         { fontSize: 13, fontWeight: '600', color: '#9ca3af' },
  tabTextActive:   { color: '#4f46e5' },
  tabBadge:        { backgroundColor: '#ef4444', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  tabBadgeText:    { color: '#fff', fontSize: 9, fontWeight: '900' },
  searchBar:       { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', paddingHorizontal: 12, paddingVertical: 10 },
  searchInput:     { flex: 1, fontSize: 14, color: '#111827' },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  empty:           { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle:      { fontSize: 16, fontWeight: '700', color: '#374151', marginTop: 12 },
  emptySub:        { fontSize: 13, color: '#9ca3af' },
  requestRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  friendRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  avatarFallback:  { backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center' },
  avatarText:      { fontWeight: '700', color: '#4f46e5' },
  userName:        { fontSize: 15, fontWeight: '700', color: '#111827' },
  userHandle:      { fontSize: 12, color: '#9ca3af', marginTop: 1 },
  acceptBtn:       { backgroundColor: '#4f46e5', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 },
  acceptBtnText:   { color: '#fff', fontWeight: '700', fontSize: 13 },
  declineBtn:      { backgroundColor: '#f3f4f6', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 },
  declineBtnText:  { color: '#374151', fontWeight: '600', fontSize: 13 },
  followBtn:       { backgroundColor: '#ede9fe', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 },
  followBtnText:   { color: '#4f46e5', fontWeight: '700', fontSize: 13 },
  friendedBtn:     { backgroundColor: '#f0fdf4', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: '#86efac' },
  friendedBtnText: { color: '#16a34a', fontWeight: '600', fontSize: 13 },
  pendingBtn:      { backgroundColor: '#fafafa', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  pendingBtnText:  { color: '#9ca3af', fontWeight: '600', fontSize: 13 },
  msgBtn:          { padding: 8 },
  discoverBtn:     { marginTop: 12, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#4f46e5', borderRadius: 12 },
  discoverBtnText: { color: '#fff', fontWeight: '700' },
});
