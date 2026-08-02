/**
 * HALQA Mobile — Creator Tips Screen
 */
import React from 'react';
import { View, Text, FlatList, Image, StyleSheet, SafeAreaView, ActivityIndicator, RefreshControl } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';

type Tip = {
  id: string; amount: number; diamondsEarned: number; message?: string; createdAt: string;
  sender: { id: string; firstName: string; lastName: string; avatarUrl?: string };
};

export default function CreatorTipsScreen() {
  const { data: dashboard, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['creator-dashboard'],
    queryFn:  () => api.get('/creators/me/dashboard').then(r => r.data.data),
    staleTime: 60 * 1000,
  });

  const tips: Tip[] = dashboard?.recentTips ?? [];
  const stats = dashboard?.stats ?? {};

  return (
    <>
      <Stack.Screen options={{ title: 'Recent Tips', headerShown: true, headerTintColor: '#4f46e5' }} />
      <SafeAreaView style={styles.container}>
        {isLoading ? <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} /> : (
          <FlatList
            data={tips}
            keyExtractor={t => t.id}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <View style={styles.statsRow}>
                <View style={styles.stat}><Text style={styles.statValue}>{stats.tipsLast30d ?? 0}</Text><Text style={styles.statLabel}>Tips (30d)</Text></View>
                <View style={styles.stat}><Text style={styles.statValue}>🪙{(stats.tipsTotal30d ?? 0).toLocaleString()}</Text><Text style={styles.statLabel}>Coins (30d)</Text></View>
                <View style={styles.stat}><Text style={styles.statValue}>{stats.totalTips ?? 0}</Text><Text style={styles.statLabel}>All Time</Text></View>
              </View>
            }
            renderItem={({ item: t }) => (
              <View style={styles.row}>
                <Image source={{ uri: avatarUrl(t.sender.avatarUrl, `${t.sender.firstName} ${t.sender.lastName}`) }} style={styles.avatar} />
                <View style={styles.info}>
                  <Text style={styles.name}>{t.sender.firstName} {t.sender.lastName}</Text>
                  {t.message ? <Text style={styles.message}>"{t.message}"</Text> : null}
                  <Text style={styles.meta}>{formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}</Text>
                </View>
                <View style={styles.amountCol}>
                  <Text style={styles.coins}>🪙 {t.amount}</Text>
                  <Text style={styles.diamonds}>💎 +{t.diamondsEarned}</Text>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={{ fontSize: 48 }}>💰</Text>
                <Text style={styles.emptyText}>No tips yet</Text>
                <Text style={styles.emptyHint}>Share your creator profile to start receiving tips</Text>
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
  list:       { padding: 16, paddingBottom: 40 },
  statsRow:   { flexDirection: 'row', gap: 8, marginBottom: 16 },
  stat:       { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  statValue:  { fontSize: 18, fontWeight: '800', color: '#1e293b' },
  statLabel:  { fontSize: 11, color: '#94a3b8', marginTop: 2, textAlign: 'center' },
  row:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, gap: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  avatar:     { width: 46, height: 46, borderRadius: 23, backgroundColor: '#e0e7ff' },
  info:       { flex: 1 },
  name:       { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  message:    { fontSize: 12, color: '#6366f1', fontStyle: 'italic', marginTop: 3 },
  meta:       { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  amountCol:  { alignItems: 'flex-end', gap: 2 },
  coins:      { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  diamonds:   { fontSize: 12, color: '#10b981', fontWeight: '600' },
  empty:      { alignItems: 'center', padding: 60 },
  emptyText:  { fontSize: 16, fontWeight: '700', color: '#374151', marginTop: 12 },
  emptyHint:  { fontSize: 13, color: '#94a3b8', marginTop: 6, textAlign: 'center' },
});
