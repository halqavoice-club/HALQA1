/**
 * HALQA Mobile — Creator Subscribers Screen
 */
import React from 'react';
import { View, Text, FlatList, Image, StyleSheet, SafeAreaView, ActivityIndicator, RefreshControl } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';

type Sub = {
  id: string; status: string; startedAt: string; expiresAt: string;
  tier: { name: string; priceCoins: number };
  subscriber: { id: string; firstName: string; lastName: string; avatarUrl?: string };
};

export default function CreatorSubscribersScreen() {
  const { data: dashboard, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['creator-dashboard'],
    queryFn:  () => api.get('/creators/me/dashboard').then(r => r.data.data),
    staleTime: 60 * 1000,
  });

  const subs: Sub[] = dashboard?.recentSubs ?? [];
  const activeSubs: number = dashboard?.stats?.activeSubs ?? 0;

  return (
    <>
      <Stack.Screen options={{ title: `Subscribers (${activeSubs} active)`, headerShown: true, headerTintColor: '#4f46e5' }} />
      <SafeAreaView style={styles.container}>
        {isLoading ? <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} /> : (
          <FlatList
            data={subs}
            keyExtractor={s => s.id}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <View style={styles.statsRow}>
                <View style={styles.stat}><Text style={styles.statValue}>{activeSubs}</Text><Text style={styles.statLabel}>Active</Text></View>
                <View style={styles.stat}><Text style={styles.statValue}>{subs.length}</Text><Text style={styles.statLabel}>Recent 30d</Text></View>
              </View>
            }
            renderItem={({ item: s }) => (
              <View style={[styles.row, s.status !== 'ACTIVE' && { opacity: 0.6 }]}>
                <Image source={{ uri: avatarUrl(s.subscriber.avatarUrl, `${s.subscriber.firstName} ${s.subscriber.lastName}`) }} style={styles.avatar} />
                <View style={styles.info}>
                  <Text style={styles.name}>{s.subscriber.firstName} {s.subscriber.lastName}</Text>
                  <Text style={styles.tierName}>{s.tier.name} · 🪙{s.tier.priceCoins}/mo</Text>
                  <Text style={styles.meta}>Started {formatDistanceToNow(new Date(s.startedAt), { addSuffix: true })}</Text>
                </View>
                <View style={[styles.statusBadge, s.status === 'ACTIVE' ? styles.badgeActive : styles.badgeExpired]}>
                  <Text style={[styles.statusText, s.status === 'ACTIVE' ? { color: '#10b981' } : { color: '#94a3b8' }]}>{s.status}</Text>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="people-outline" size={48} color="#d1d5db" />
                <Text style={styles.emptyText}>No subscribers yet</Text>
                <Text style={styles.emptyHint}>Create tiers to start earning from subscriptions</Text>
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
  list:        { padding: 16, paddingBottom: 40 },
  statsRow:    { flexDirection: 'row', gap: 12, marginBottom: 16 },
  stat:        { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  statValue:   { fontSize: 24, fontWeight: '800', color: '#1e293b' },
  statLabel:   { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  row:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, gap: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  avatar:      { width: 46, height: 46, borderRadius: 23, backgroundColor: '#e0e7ff' },
  info:        { flex: 1 },
  name:        { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  tierName:    { fontSize: 12, color: '#6366f1', fontWeight: '600', marginTop: 2 },
  meta:        { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeActive: { backgroundColor: '#d1fae5' },
  badgeExpired:{ backgroundColor: '#f1f5f9' },
  statusText:  { fontSize: 11, fontWeight: '700' },
  empty:       { alignItems: 'center', padding: 60 },
  emptyText:   { fontSize: 16, fontWeight: '700', color: '#374151', marginTop: 12 },
  emptyHint:   { fontSize: 13, color: '#94a3b8', marginTop: 6, textAlign: 'center' },
});
