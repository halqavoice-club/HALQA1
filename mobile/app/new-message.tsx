/**
 * HALQA Mobile — New Message / Start DM Screen
 * Search for a friend to start a conversation with.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';

export default function NewMessageScreen() {
  const router    = useRouter();
  const [search, setSearch]  = useState('');
  const [starting, setStarting] = useState<string | null>(null);
  const debounced = useDebounce(search, 350);

  const { data: friends = [], isLoading } = useQuery({
    queryKey: ['friends', debounced],
    queryFn:  () => api.get('/social/friends', {
      params: { search: debounced || undefined, limit: 30 }
    }).then(r => r.data.data ?? []),
    staleTime: 60 * 1000,
  });

  const handleStart = async (userId: string) => {
    setStarting(userId);
    try {
      const res = await api.get(`/dm/conversations/${userId}`);
      const conv = res.data.data;
      router.replace({ pathname: '/dm/[id]', params: { id: conv.id } } as any);
    } catch (err: any) {
      showMessage({ message: err?.response?.data?.message || 'Cannot start conversation', type: 'danger' });
    } finally { setStarting(null); }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'New Message', headerShown: true, headerTintColor: '#4f46e5' }} />
      <SafeAreaView style={styles.container}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={16} color="#9ca3af" />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search friends…"
            placeholderTextColor="#94a3b8" style={styles.searchInput} autoFocus />
        </View>

        {isLoading ? (
          <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={friends as any[]}
            keyExtractor={(f: any) => f.id}
            renderItem={({ item: f }: any) => (
              <TouchableOpacity style={styles.row} onPress={() => handleStart(f.id)} disabled={starting === f.id}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{f.firstName?.[0]}{f.lastName?.[0]}</Text>
                </View>
                <View style={styles.info}>
                  <Text style={styles.name}>{f.firstName} {f.lastName}</Text>
                  {f.username && <Text style={styles.username}>@{f.username}</Text>}
                </View>
                {starting === f.id
                  ? <ActivityIndicator size="small" color="#6366f1" />
                  : <Ionicons name="chatbubble-outline" size={20} color="#6366f1" />
                }
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="people-outline" size={48} color="#d1d5db" />
                <Text style={styles.emptyText}>{debounced ? 'No friends found' : 'Search for friends to message'}</Text>
              </View>
            }
          />
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#f8fafc' },
  searchBar:  { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 14, paddingVertical: 12 },
  searchInput:{ flex: 1, fontSize: 15, color: '#1e293b' },
  row:        { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  avatar:     { width: 48, height: 48, borderRadius: 24, backgroundColor: '#e0e7ff', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '700', color: '#6366f1' },
  info:       { flex: 1 },
  name:       { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  username:   { fontSize: 13, color: '#94a3b8', marginTop: 1 },
  empty:      { alignItems: 'center', padding: 60 },
  emptyText:  { fontSize: 14, color: '#94a3b8', marginTop: 12, textAlign: 'center' },
});
