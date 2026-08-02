/**
 * HALQA Mobile — My Followers Screen
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

type User = { id: string; firstName: string; lastName: string; avatarUrl?: string; role: string; bio?: string; iFollowThem?: boolean; };

export default function FollowersScreen() {
  const router     = useRouter();
  const { user }   = useAuthStore();
  const qc         = useQueryClient();
  const [search, setSearch] = useState('');
  const debounced  = useDebounce(search, 300);

  const { data = [], isLoading } = useQuery<User[]>({
    queryKey: ['followers', user?.id],
    queryFn:  () => api.get(`/social/followers/${user?.id}`, { params: { limit: 100 } }).then(r => r.data.data ?? []),
    enabled:  !!user?.id,
  });

  const followMutation = useMutation({
    mutationFn: ({ id, following }: { id: string; following: boolean }) =>
      following ? api.delete(`/social/follow/${id}`) : api.post(`/social/follow/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['followers'] }),
    onError:   (err: any) => showMessage({ message: err?.response?.data?.message || 'Failed', type: 'danger' }),
  });

  const filtered = debounced
    ? data.filter(u => `${u.firstName} ${u.lastName}`.toLowerCase().includes(debounced.toLowerCase()))
    : data;

  return (
    <>
      <Stack.Screen options={{ title: `Followers (${data.length})`, headerShown: true, headerTintColor: '#4f46e5' }} />
      <SafeAreaView style={styles.container}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={16} color="#94a3b8" />
          <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search followers…" placeholderTextColor="#94a3b8" />
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
                  <TouchableOpacity
                    style={[styles.followBtn, u.iFollowThem && styles.followingBtn]}
                    onPress={() => followMutation.mutate({ id: u.id, following: !!u.iFollowThem })}
                  >
                    <Text style={[styles.followBtnText, u.iFollowThem && styles.followingBtnText]}>
                      {u.iFollowThem ? 'Following' : 'Follow'}
                    </Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            )}
            ListEmptyComponent={<View style={styles.empty}><Ionicons name="people-outline" size={48} color="#d1d5db" /><Text style={styles.emptyText}>{debounced ? 'No results' : 'No followers yet'}</Text></View>}
          />
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#f8fafc' },
  searchBar:       { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 14, paddingVertical: 11 },
  searchInput:     { flex: 1, fontSize: 14, color: '#1e293b' },
  row:             { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  avatar:          { width: 48, height: 48, borderRadius: 24, backgroundColor: '#e0e7ff' },
  info:            { flex: 1 },
  name:            { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  bio:             { fontSize: 12, color: '#64748b', marginTop: 1 },
  role:            { fontSize: 12, color: '#94a3b8', marginTop: 1, textTransform: 'capitalize' },
  followBtn:       { paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#6366f1', borderRadius: 20 },
  followingBtn:    { backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  followBtnText:   { color: '#fff', fontWeight: '700', fontSize: 13 },
  followingBtnText:{ color: '#475569' },
  empty:           { alignItems: 'center', padding: 60 },
  emptyText:       { color: '#94a3b8', fontSize: 15, marginTop: 12 },
});
