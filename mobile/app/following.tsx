/**
 * HALQA Mobile — My Following Screen
 */
import React, { useState } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, TextInput } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { showMessage } from 'react-native-flash-message';
import { Ionicons } from '@expo/vector-icons';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';
import { useAuthStore } from '@/store/auth.store';
import { useDebounce } from '@/hooks/useDebounce';

type User = { id: string; firstName: string; lastName: string; avatarUrl?: string; role: string; bio?: string; };

export default function FollowingScreen() {
  const router   = useRouter();
  const { user } = useAuthStore();
  const qc       = useQueryClient();
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300);

  const { data = [], isLoading } = useQuery<User[]>({
    queryKey: ['following', user?.id],
    queryFn:  () => api.get(`/social/following/${user?.id}`, { params: { limit: 100 } }).then(r => r.data.data ?? []),
    enabled:  !!user?.id,
  });

  const unfollowMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/social/follow/${id}`),
    onSuccess:  (_, id) => {
      qc.setQueryData<User[]>(['following', user?.id], prev => (prev ?? []).filter(u => u.id !== id));
      showMessage({ message: 'Unfollowed', type: 'info', duration: 1500 });
    },
    onError: (err: any) => showMessage({ message: err?.response?.data?.message || 'Failed', type: 'danger' }),
  });

  const filtered = debounced
    ? data.filter(u => `${u.firstName} ${u.lastName}`.toLowerCase().includes(debounced.toLowerCase()))
    : data;

  return (
    <>
      <Stack.Screen options={{ title: `Following (${data.length})`, headerShown: true, headerTintColor: '#4f46e5' }} />
      <SafeAreaView style={styles.container}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={16} color="#94a3b8" />
          <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search following…" placeholderTextColor="#94a3b8" />
        </View>
        {isLoading ? <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} /> : (
          <FlatList
            data={filtered}
            keyExtractor={u => u.id}
            renderItem={({ item: u }) => (
              <TouchableOpacity style={styles.row} onPress={() => router.push({ pathname: '/profile/[id]', params: { id: u.id } } as any)}>
                <Image source={{ uri: avatarUrl(u.avatarUrl, `${u.firstName} ${u.lastName}`) }} style={styles.avatar} />
                <View style={styles.info}>
                  <Text style={styles.name}>{u.firstName} {u.lastName}</Text>
                  {u.bio ? <Text style={styles.bio} numberOfLines={1}>{u.bio}</Text> : <Text style={styles.role}>{u.role?.replace(/_/g, ' ')?.toLowerCase()}</Text>}
                </View>
                {u.id !== user?.id && (
                  <TouchableOpacity style={styles.unfollowBtn} onPress={() => unfollowMutation.mutate(u.id)}>
                    <Text style={styles.unfollowBtnText}>Unfollow</Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            )}
            ListEmptyComponent={<View style={styles.empty}><Ionicons name="people-outline" size={48} color="#d1d5db" /><Text style={styles.emptyText}>{debounced ? 'No results' : 'Not following anyone yet'}</Text></View>}
          />
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#f8fafc' },
  searchBar:      { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 14, paddingVertical: 11 },
  searchInput:    { flex: 1, fontSize: 14, color: '#1e293b' },
  row:            { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  avatar:         { width: 48, height: 48, borderRadius: 24, backgroundColor: '#e0e7ff' },
  info:           { flex: 1 },
  name:           { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  bio:            { fontSize: 12, color: '#64748b', marginTop: 1 },
  role:           { fontSize: 12, color: '#94a3b8', marginTop: 1, textTransform: 'capitalize' },
  unfollowBtn:    { paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#f1f5f9', borderRadius: 20, borderWidth: 1, borderColor: '#e2e8f0' },
  unfollowBtnText:{ color: '#475569', fontWeight: '700', fontSize: 13 },
  empty:          { alignItems: 'center', padding: 60 },
  emptyText:      { color: '#94a3b8', fontSize: 15, marginTop: 12 },
});
