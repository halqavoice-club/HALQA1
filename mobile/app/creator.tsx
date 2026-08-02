/**
 * HALQA Mobile — Creator Studio Screen
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';

export default function CreatorScreen() {
  const router       = useRouter();
  const queryClient  = useQueryClient();

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['creator-dashboard'],
    queryFn:  () => api.get('/creators/me/dashboard').then(r => r.data.data),
    retry:    false,
  });

  const { data: payoutInfo } = useQuery({
    queryKey: ['payout-info'],
    queryFn:  () => api.get('/creators/me/payout-info').then(r => r.data.data),
    enabled:  !!dashboard?.profile,
    retry:    false,
  });

  const becomeMutation = useMutation({
    mutationFn: () => api.post('/creators/me/become'),
    onSuccess:  () => {
      showMessage({ message: 'Creator profile created!', type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['creator-dashboard'] });
    },
    onError: (err: any) => showMessage({ message: err?.response?.data?.message || 'Failed', type: 'danger' })
  });

  return (
    <>
      <Stack.Screen options={{ title: 'Creator Studio', headerShown: true, headerTintColor: '#4f46e5' }} />
      <SafeAreaView style={styles.container}>
        {isLoading ? (
          <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} />
        ) : !dashboard?.profile ? (
          <View style={styles.welcome}>
            <Text style={styles.welcomeEmoji}>🌟</Text>
            <Text style={styles.welcomeTitle}>Become a Creator</Text>
            <Text style={styles.welcomeDesc}>Create tiers, earn from tips and subscriptions, and build your audience on HALQA.</Text>
            <TouchableOpacity style={styles.becomeBtn} onPress={() => becomeMutation.mutate()} disabled={becomeMutation.isPending}>
              {becomeMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.becomeBtnText}>Get Started →</Text>}
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {/* Stats */}
            <View style={styles.statsGrid}>
              {[
                { label: 'Subscribers',  value: dashboard.profile?.subscriberCount ?? 0, icon: '👥' },
                { label: 'Total Tips',   value: dashboard.profile?.tipCount ?? 0,        icon: '💰' },
                { label: 'Diamonds',     value: dashboard.wallet?.diamonds ?? 0,         icon: '💎' },
                { label: 'Total Earned', value: dashboard.profile?.totalEarned ?? 0,     icon: '🏆' },
              ].map(s => (
                <View key={s.label} style={styles.statCard}>
                  <Text style={styles.statEmoji}>{s.icon}</Text>
                  <Text style={styles.statValue}>{s.value.toLocaleString()}</Text>
                  <Text style={styles.statLabel}>{s.label}</Text>
                </View>
              ))}
            </View>

            {/* Payout info */}
            {payoutInfo && (
              <View style={styles.payoutCard}>
                <Text style={styles.sectionTitle}>💸 Earnings</Text>
                <Text style={styles.payoutValue}>${payoutInfo.netValue?.toFixed(2) ?? '0.00'} available</Text>
                <Text style={styles.payoutRate}>{payoutInfo.conversionRate} · {payoutInfo.platformFeeRate} platform fee</Text>
                {payoutInfo.canRequest ? (
                  <TouchableOpacity style={styles.payoutBtn} onPress={() => router.push('/payout-request' as any)}>
                    <Text style={styles.payoutBtnText}>Request Payout</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.payoutNote}>{payoutInfo.message}</Text>
                )}
              </View>
            )}

            {/* Menu */}
            <View style={styles.menu}>
              {[
                { icon: 'layers-outline',   label: 'Manage Tiers',        href: '/creator-tiers' },
                { icon: 'people-outline',   label: 'Subscribers',         href: '/creator-subscribers' },
                { icon: 'heart-outline',    label: 'Recent Tips',         href: '/creator-tips' },
                { icon: 'stats-chart-outline', label: 'Analytics',        href: '/creator-analytics' },
              ].map(item => (
                <TouchableOpacity key={item.label} style={styles.menuItem} onPress={() => router.push(item.href as any)}>
                  <Ionicons name={item.icon as any} size={22} color="#6366f1" />
                  <Text style={styles.menuLabel}>{item.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
                </TouchableOpacity>
              ))}
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
  welcome:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  welcomeEmoji: { fontSize: 60, marginBottom: 16 },
  welcomeTitle: { fontSize: 24, fontWeight: '800', color: '#1e293b', marginBottom: 12, textAlign: 'center' },
  welcomeDesc:  { fontSize: 15, color: '#64748b', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  becomeBtn:    { backgroundColor: '#6366f1', borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14 },
  becomeBtnText:{ color: '#fff', fontSize: 16, fontWeight: '700' },
  statsGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCard:     { flex: 1, minWidth: '45%', backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  statEmoji:    { fontSize: 24, marginBottom: 6 },
  statValue:    { fontSize: 22, fontWeight: '800', color: '#1e293b' },
  statLabel:    { fontSize: 12, color: '#64748b', marginTop: 2 },
  payoutCard:   { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#475569', marginBottom: 8 },
  payoutValue:  { fontSize: 28, fontWeight: '900', color: '#1e293b' },
  payoutRate:   { fontSize: 12, color: '#94a3b8', marginTop: 4, marginBottom: 12 },
  payoutBtn:    { backgroundColor: '#6366f1', borderRadius: 10, padding: 12, alignItems: 'center' },
  payoutBtnText:{ color: '#fff', fontWeight: '700' },
  payoutNote:   { fontSize: 13, color: '#94a3b8', fontStyle: 'italic' },
  menu:         { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  menuItem:     { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: '#f8fafc' },
  menuLabel:    { flex: 1, fontSize: 15, fontWeight: '600', color: '#1e293b' },
});
