/**
 * HALQA Mobile — Announcements Screen
 * Tap an announcement to view its full detail.
 */
import React from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  RefreshControl, TouchableOpacity
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';

type Announcement = {
  id: string; title: string; content: string; isPinned: boolean;
  publishAt: string; authorId: string;
};

export default function AnnouncementsScreen() {
  const router = useRouter();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['announcements'],
    queryFn:  async () => {
      const res = await api.get('/announcements', { params: { limit: 50 } });
      const raw = res.data.data;
      return (Array.isArray(raw) ? raw : raw?.items ?? []) as Announcement[];
    },
    staleTime: 2 * 60 * 1000,
  });

  const renderItem = ({ item }: { item: Announcement }) => (
    <TouchableOpacity
      style={[styles.card, item.isPinned && styles.pinnedCard]}
      onPress={() => router.push(`/education/announcement/${item.id}` as any)}
      activeOpacity={0.75}
    >
      {item.isPinned && (
        <View style={styles.pinnedBadge}>
          <Ionicons name="pin" size={10} color="#6366f1" />
          <Text style={styles.pinnedText}>Pinned</Text>
        </View>
      )}
      <View style={styles.cardBody}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.content} numberOfLines={3}>{item.content}</Text>
          <Text style={styles.time}>
            {formatDistanceToNow(new Date(item.publishAt), { addSuffix: true })}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#d1d5db" style={{ alignSelf: 'center' }} />
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Announcements', headerBackTitle: 'Education' }} />
      {isLoading ? (
        <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={data || []}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#6366f1" />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="megaphone-outline" size={48} color="#d1d5db" />
              <Text style={styles.emptyText}>No announcements</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#f8fafc' },
  list:        { padding: 12 },
  card:        { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  pinnedCard:  { borderLeftWidth: 3, borderLeftColor: '#6366f1' },
  pinnedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  pinnedText:  { fontSize: 11, fontWeight: '700', color: '#6366f1' },
  cardBody:    { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title:       { fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 6 },
  content:     { fontSize: 13, color: '#64748b', lineHeight: 20 },
  time:        { fontSize: 11, color: '#94a3b8', marginTop: 8 },
  empty:       { alignItems: 'center', padding: 60 },
  emptyText:   { fontSize: 15, color: '#94a3b8', marginTop: 12 },
});

