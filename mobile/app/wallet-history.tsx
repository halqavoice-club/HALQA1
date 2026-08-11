/**
 * HALQA Mobile — Wallet Transaction History
 */
import React from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView, ActivityIndicator, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { formatDistanceToNow } from 'date-fns';
import { useScreenProtection } from '@/hooks/useScreenProtection';
import api from '@/lib/api';

type WalletTx = {
  id: string; type: string; coins: number; description?: string; createdAt: string;
};

export default function WalletHistoryScreen() {
  // MOB-003: Prevent screenshots on transaction history screen.
  useScreenProtection();
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['wallet-history'],
    queryFn:  async () => {
      const res = await api.get('/wallet/history', { params: { limit: 50 } });
      const raw = res.data.data;
      // Backend returns { sent, received, total } — merge for display
      const sent     = (raw?.sent     || []).map((t: any) => ({ ...t, direction: 'out' }));
      const received = (raw?.received || []).map((t: any) => ({ ...t, direction: 'in' }));
      return [...sent, ...received].sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    },
    staleTime: 60 * 1000
  });

  const renderItem = ({ item }: { item: any }) => {
    const isOut   = item.direction === 'out';
    const txColor = isOut ? '#ef4444' : '#10b981';
    const txSign  = isOut ? '-' : '+';
    return (
      <View style={styles.row}>
        <View style={[styles.typeIcon, { backgroundColor: isOut ? '#fee2e2' : '#d1fae5' }]}>
          <Text style={{ fontSize: 18 }}>{isOut ? '🎁' : '💰'}</Text>
        </View>
        <View style={styles.rowInfo}>
          <Text style={styles.rowType}>{item.gift?.name || item.type || (isOut ? 'Gift Sent' : 'Gift Received')}</Text>
          <Text style={styles.rowTime}>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</Text>
        </View>
        <Text style={[styles.rowCoins, { color: txColor }]}>
          {txSign}{item.coinsSpent || item.diamondsEarned || '?'}
          {isOut ? ' 🪙' : ' 💎'}
        </Text>
      </View>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Transaction History', headerShown: true, headerTintColor: '#4f46e5' }} />
      <SafeAreaView style={styles.container}>
        {isLoading ? (
          <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={data || []}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No transactions yet</Text>
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
  list:       { padding: 12 },
  row:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  typeIcon:   { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  rowInfo:    { flex: 1 },
  rowType:    { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  rowTime:    { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  rowCoins:   { fontSize: 16, fontWeight: '800' },
  empty:      { alignItems: 'center', padding: 60 },
  emptyText:  { color: '#94a3b8', fontSize: 15 },
});
