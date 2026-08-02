/**
 * HALQA Mobile — Friends Screen
 * Shows accepted friends with unfriend + message actions.
 */
import React, { useState } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, TextInput, Alert } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { showMessage } from 'react-native-flash-message';
import { Ionicons } from '@expo/vector-icons';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';
import { useAuthStore } from '@/store/auth.store';
import { useDebounce } from '@/hooks/useDebounce';

type Friend = { id: string; firstName: string; lastName: string; avatarUrl?: string; role: string; bio?: string; };

export default function FriendsScreen() {
  const router   = useRouter();
  const { user } = useAuthStore();
  const qc       = useQueryClient();
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300);

  const { data = [], isLoading } = useQuery<Friend[]>({
    queryKey: ['friends'],
    queryFn:  () => api.get('/social/friends', { params: { limit: 200 } }).then(r => r.data.data ?? []),
    staleTime: 60 * 1000,
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/social/friends/${id}`),
    onSuccess:  (_, id) => {
      qc.setQueryData<Friend[]>(['friends'], prev => (prev ?? []).filter(f => f.id !== id));
      showMessage({ message: 'Friend removed', type: 'info', duration: 2000 });
    },
    onError: (err: any) => showMessage({ message: err?.response?.data?.message || 'Failed', type: 'danger' }),
  });

  const handleMessage = async (friend: Friend) => {
    try {
      const res = await api.get(`/dm/conversations/${friend.id}`);
      router.push({ pathname: '/dm/[id]', params: { id: res.data.data.id } } as any);
    } catch { showMessage({ message: 'Could not open conversation', type: 'danger' }); }
  };

  const handleRemove = (friend: Friend) => {
    Alert.alert('Remove Friend', `Remove ${friend.firstName} from your friends?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeMutation.mutate(friend.id) }
    ]);
  };

  const filtered = debounced
    ? data.filter(f => `${f.firstName} ${f.lastName}`.toLowerCase().includes(debounced.toLowerCase()))
    : data;

  return (
    <>
      <Stack.Screen options={{ title: `Friends (${data.length})`, headerShown: true, headerTintColor: '#4f46e5',
        headerRight: () => (
          <TouchableOpacity onPress={() => router.push('/friend-requests' as any)} style={{ padding: 6 }}>
            <Ionicons name="person-add-outline" size={20} color="#4f46e5" />
          </TouchableOpacity>
        ),
      }} />
      <SafeAreaView style={styles.container}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={16} color="#94a3b8" />
          <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search friends…" placeholderTextColor="#94a3b8" />
        </View>
        {isLoading ? <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} /> : (
          <FlatList
            data={filtered}
            keyExtractor={f => f.id}
            renderItem={({ item: f }) => (
              <TouchableOpacity style={styles.row} onPress={() => router.push({ pathname: '/profile/[id]', params: { id: f.id } } as any)}>
                <Image source={{ uri: avatarUrl(f.avatarUrl, `${f.firstName} ${f.lastName}`) }} style={styles.avatar} />
                <View style={styles.info}>
                  <Text style={styles.name}>{f.firstName} {f.lastName}</Text>
                  {f.bio ? <Text style={styles.bio} numberOfLines={1}>{f.bio}</Text> : <Text style={styles.role}>{f.role?.replace(/_/g, ' ')?.toLowerCase()}</Text>}
                </View>
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.msgBtn} onPress={() => handleMessage(f)}>
                    <Ionicons name="chatbubble-outline" size={16} color="#6366f1" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemove(f)}>
                    <Ionicons name="person-remove-outline" size={16} color="#94a3b8" />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="people-outline" size={48} color="#d1d5db" />
                <Text style={styles.emptyText}>{debounced ? 'No results' : 'No friends yet'}</Text>
                <TouchableOpacity style={styles.findBtn} onPress={() => router.push('/(tabs)/explore' as any)}>
                  <Text style={styles.findBtnText}>Find people →</Text>
                </TouchableOpacity>
              </View>
            }
          />
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#f8fafc' },
  searchBar:   { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 14, paddingVertical: 11 },
  searchInput: { flex: 1, fontSize: 14, color: '#1e293b' },
  row:         { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  avatar:      { width: 48, height: 48, borderRadius: 24, backgroundColor: '#e0e7ff' },
  info:        { flex: 1 },
  name:        { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  bio:         { fontSize: 12, color: '#64748b', marginTop: 1 },
  role:        { fontSize: 12, color: '#94a3b8', marginTop: 1, textTransform: 'capitalize' },
  actions:     { flexDirection: 'row', gap: 8 },
  msgBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: '#e0e7ff', alignItems: 'center', justifyContent: 'center' },
  removeBtn:   { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  empty:       { alignItems: 'center', padding: 60 },
  emptyText:   { color: '#94a3b8', fontSize: 15, marginTop: 12 },
  findBtn:     { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#6366f1', borderRadius: 20 },
  findBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
