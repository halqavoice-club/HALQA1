/**
 * HALQA Mobile — Communities Screen
 */
import { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import api from '@/lib/api';
import CommunityCard from '@/components/communities/CommunityCard';
import { useDebounce } from '@/hooks/useDebounce';

export default function CommunitiesScreen() {
  const router = useRouter();
  const [tab,    setTab]    = useState<'discover' | 'mine'>('discover');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 350);

  const { data: discoverData, isLoading: loadingDiscover } = useQuery({
    queryKey: ['communities', debounced],
    queryFn:  () => api.get('/communities', { params: { q: debounced || undefined, limit: 30 } }).then(r => r.data.data),
    enabled:  tab === 'discover',
  });

  const { data: mineData = [], isLoading: loadingMine } = useQuery({
    queryKey: ['my-communities'],
    queryFn:  () => api.get('/communities/mine').then(r => r.data.data),
    enabled:  tab === 'mine',
  });

  const communities = tab === 'discover' ? (discoverData?.items ?? []) : (mineData as any[]);
  const isLoading   = tab === 'discover' ? loadingDiscover : loadingMine;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Communities</Text>
        <TouchableOpacity onPress={() => router.push('/create-community' as any)}>
          <Ionicons name="add-circle-outline" size={26} color="#4f46e5" />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['discover', 'mine'] as const).map(t => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'discover' ? '🔭 Discover' : '👤 My Communities'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Search (discover only) */}
      {tab === 'discover' && (
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={16} color="#9ca3af" />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search communities…"
            placeholderTextColor="#9ca3af" style={styles.searchInput} />
        </View>
      )}

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#4f46e5" /></View>
      ) : (
        <FlatList
          data={communities}
          keyExtractor={(c: any) => c.id}
          renderItem={({ item }: any) => <CommunityCard community={item} />}
          contentContainerStyle={{ paddingBottom: 100 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={48} color="#d1d5db" />
              <Text style={styles.emptyTitle}>{tab === 'mine' ? 'No communities yet' : 'No results'}</Text>
              <TouchableOpacity style={styles.createBtn} onPress={() => router.push('/create-community' as any)}>
                <Text style={styles.createBtnText}>Create one →</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#f9fafb' },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  title:         { fontSize: 22, fontWeight: '900', color: '#111827' },
  tabs:          { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  tab:           { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive:     { borderBottomWidth: 2, borderBottomColor: '#4f46e5' },
  tabText:       { fontSize: 13, fontWeight: '600', color: '#9ca3af' },
  tabTextActive: { color: '#4f46e5' },
  searchBar:     { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', paddingHorizontal: 12, paddingVertical: 10 },
  searchInput:   { flex: 1, fontSize: 14, color: '#111827' },
  center:        { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty:         { alignItems: 'center', padding: 60 },
  emptyTitle:    { fontSize: 16, fontWeight: '600', color: '#9ca3af', marginTop: 12 },
  createBtn:     { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#4f46e5', borderRadius: 12 },
  createBtnText: { color: '#fff', fontWeight: '700' },
});
