/**
 * HALQA Mobile — Creator Analytics Screen
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, RefreshControl } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import api from '@/lib/api';

type StatCard = { label: string; value: string | number; icon: string; color: string; bg: string; };

export default function CreatorAnalyticsScreen() {
  const { data: dashboard, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['creator-dashboard'],
    queryFn:  () => api.get('/creators/me/dashboard').then(r => r.data.data),
    staleTime: 2 * 60 * 1000,
  });

  const { data: payoutInfo } = useQuery({
    queryKey: ['payout-info'],
    queryFn:  () => api.get('/creators/me/payout-info').then(r => r.data.data),
    enabled:  !!dashboard?.profile,
  });

  const stats = dashboard?.stats ?? {};
  const wallet = dashboard?.wallet ?? {};

  const cards: StatCard[] = [
    { label: 'Active Subscribers', value: stats.activeSubs ?? 0,            icon: 'people',       color: '#6366f1', bg: '#e0e7ff' },
    { label: 'Tips (30 days)',      value: stats.tipsLast30d ?? 0,           icon: 'heart',        color: '#ef4444', bg: '#fee2e2' },
    { label: 'Coins Earned (30d)', value: `🪙 ${(stats.tipsTotal30d ?? 0).toLocaleString()}`, icon: 'cash', color: '#f59e0b', bg: '#fef3c7' },
    { label: 'Total Subscribers',  value: stats.subscriberCount ?? 0,       icon: 'person-add',   color: '#10b981', bg: '#d1fae5' },
    { label: 'All-Time Tips',      value: stats.totalTips ?? 0,             icon: 'gift',         color: '#8b5cf6', bg: '#ede9fe' },
    { label: 'Total Earned',       value: `💎 ${(stats.totalEarned ?? 0).toLocaleString()}`, icon: 'diamond', color: '#0ea5e9', bg: '#e0f2fe' },
  ];

  return (
    <>
      <Stack.Screen options={{ title: 'Analytics', headerShown: true, headerTintColor: '#4f46e5' }} />
      <SafeAreaView style={styles.container}>
        {isLoading ? (
          <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} />
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
            showsVerticalScrollIndicator={false}
          >
            {/* Wallet */}
            <View style={styles.walletCard}>
              <Text style={styles.walletTitle}>Current Balance</Text>
              <View style={styles.walletRow}>
                <View style={styles.walletItem}>
                  <Text style={styles.walletValue}>🪙 {(wallet.coins ?? 0).toLocaleString()}</Text>
                  <Text style={styles.walletLabel}>Coins</Text>
                </View>
                <View style={styles.walletDivider} />
                <View style={styles.walletItem}>
                  <Text style={styles.walletValue}>💎 {(wallet.diamonds ?? 0).toLocaleString()}</Text>
                  <Text style={styles.walletLabel}>Diamonds</Text>
                </View>
              </View>
              {payoutInfo && (
                <Text style={styles.payoutNote}>
                  Withdrawal available: ${payoutInfo.netValue?.toFixed(2) ?? '0.00'}
                  {payoutInfo.canRequest ? ' ✅' : ` (min ${payoutInfo.minPayout?.toLocaleString()} 💎)`}
                </Text>
              )}
            </View>

            {/* Stats grid */}
            <Text style={styles.sectionTitle}>Performance Overview</Text>
            <View style={styles.grid}>
              {cards.map(c => (
                <View key={c.label} style={[styles.card, { borderLeftColor: c.color }]}>
                  <View style={[styles.cardIcon, { backgroundColor: c.bg }]}>
                    <Ionicons name={c.icon as any} size={20} color={c.color} />
                  </View>
                  <Text style={styles.cardValue}>{c.value}</Text>
                  <Text style={styles.cardLabel}>{c.label}</Text>
                </View>
              ))}
            </View>

            {/* Period note */}
            <View style={styles.noteCard}>
              <Ionicons name="information-circle-outline" size={16} color="#6366f1" />
              <Text style={styles.noteText}>
                "30 days" metrics cover the last 30 days. Full analytics with charts coming soon.
              </Text>
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f8fafc' },
  scroll:       { padding: 16, paddingBottom: 40 },
  walletCard:   { backgroundColor: '#6366f1', borderRadius: 16, padding: 20, marginBottom: 20 },
  walletTitle:  { color: '#c7d2fe', fontSize: 13, fontWeight: '600', marginBottom: 12 },
  walletRow:    { flexDirection: 'row', alignItems: 'center' },
  walletItem:   { flex: 1, alignItems: 'center' },
  walletValue:  { color: '#fff', fontSize: 22, fontWeight: '900' },
  walletLabel:  { color: '#c7d2fe', fontSize: 12, marginTop: 3 },
  walletDivider:{ width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.2)' },
  payoutNote:   { color: '#a5b4fc', fontSize: 12, marginTop: 12, textAlign: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  grid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  card:         {
    width: '47%', backgroundColor: '#fff', borderRadius: 12, padding: 14,
    borderLeftWidth: 3, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  cardIcon:     { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  cardValue:    { fontSize: 20, fontWeight: '800', color: '#1e293b' },
  cardLabel:    { fontSize: 11, color: '#94a3b8', marginTop: 3 },
  noteCard:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#e0e7ff', borderRadius: 12, padding: 14 },
  noteText:     { flex: 1, fontSize: 13, color: '#3730a3', lineHeight: 18 },
});
