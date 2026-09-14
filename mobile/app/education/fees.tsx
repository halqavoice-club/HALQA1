/**
 * HALQA Mobile — Fees Screen
 * Guardians: view pending/overdue fees, pay via Stripe.
 * School Admins: view all fees, mark paid, waive.
 */
import React from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator, RefreshControl, Linking, Alert
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';
import { showMessage } from 'react-native-flash-message';

type FeeRecord = {
  id: string;
  feeType: string;
  amount: string;
  status: 'PENDING' | 'PAID' | 'OVERDUE' | 'WAIVED';
  dueDate?: string;
  paidAt?: string;
  description?: string;
  student?: { user?: { firstName: string; lastName: string } };
};

const STATUS_CONFIG = {
  PENDING: { label: 'Pending', color: '#f59e0b', bg: '#fef3c7' },
  PAID:    { label: 'Paid',    color: '#10b981', bg: '#d1fae5' },
  OVERDUE: { label: 'Overdue', color: '#ef4444', bg: '#fee2e2' },
  WAIVED:  { label: 'Waived',  color: '#64748b', bg: '#f1f5f9' },
};

export default function FeesScreen() {
  const { user }        = useAuthStore();
  const queryClient     = useQueryClient();
  // SA-EDU-02: SUPER_ADMIN is a platform role — not a school-scoped admin.
  // Fee administration belongs to SCHOOL_ADMIN (school membership role).
  const isAdmin = user?.role === 'SCHOOL_ADMIN';

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['fees', user?.id],
    queryFn:  async () => {
      const res = await api.get('/fees?limit=50');
      return res.data.data as FeeRecord[];
    },
    enabled:   !!user,
    staleTime: 2 * 60 * 1000
  });

  const payMutation = useMutation({
    mutationFn: async (feeId: string) => {
      const res = await api.post(`/fees/${feeId}/checkout`);
      return res.data.data as { checkoutUrl: string };
    },
    onSuccess: async (data) => {
      if (data.checkoutUrl) {
        const canOpen = await Linking.canOpenURL(data.checkoutUrl);
        if (canOpen) {
          await Linking.openURL(data.checkoutUrl);
        }
      }
    },
    onError: (err: any) => {
      showMessage({
        message: 'Payment error',
        description: err.response?.data?.message || 'Could not start payment',
        type: 'danger'
      });
    }
  });

  const handlePay = (fee: FeeRecord) => {
    Alert.alert(
      'Pay Fee',
      `Pay $${Number(fee.amount).toFixed(2)} for ${fee.feeType}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Pay with Stripe', onPress: () => payMutation.mutate(fee.id) }
      ]
    );
  };

  // Summary
  const summary = React.useMemo(() => {
    if (!data) return { pending: 0, overdue: 0, total: 0 };
    return {
      pending: data.filter(f => f.status === 'PENDING').length,
      overdue: data.filter(f => f.status === 'OVERDUE').length,
      total:   data.filter(f => ['PENDING','OVERDUE'].includes(f.status))
                    .reduce((s, f) => s + Number(f.amount), 0)
    };
  }, [data]);

  const renderFee = ({ item }: { item: FeeRecord }) => {
    const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.PENDING;
    const canPay = (item.status === 'PENDING' || item.status === 'OVERDUE') &&
                   (isAdmin || user?.role === 'GUARDIAN');

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View>
            <Text style={styles.feeType}>{item.feeType}</Text>
            {item.student && (
              <Text style={styles.studentName}>
                {item.student.user?.firstName} {item.student.user?.lastName}
              </Text>
            )}
            {item.description && <Text style={styles.desc}>{item.description}</Text>}
            {item.dueDate && (
              <Text style={styles.dueDate}>
                Due: {new Date(item.dueDate).toLocaleDateString()}
              </Text>
            )}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.amount}>${Number(item.amount).toFixed(2)}</Text>
            <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
              <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
            </View>
          </View>
        </View>

        {canPay && (
          <TouchableOpacity
            style={styles.payBtn}
            onPress={() => handlePay(item)}
            disabled={payMutation.isPending}
          >
            <Text style={styles.payBtnText}>
              {payMutation.isPending ? 'Processing…' : 'Pay Now'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Fees</Text>
      </View>

      {/* Summary banner */}
      {(summary.pending > 0 || summary.overdue > 0) && (
        <View style={[styles.summaryBanner, summary.overdue > 0 ? { backgroundColor: '#fee2e2' } : { backgroundColor: '#fef3c7' }]}>
          <Text style={[styles.summaryText, { color: summary.overdue > 0 ? '#ef4444' : '#f59e0b' }]}>
            {summary.overdue > 0 ? `⚠️ ${summary.overdue} overdue fee${summary.overdue > 1 ? 's' : ''}` : `${summary.pending} pending fee${summary.pending > 1 ? 's' : ''}`}
            {' · '}Total due: ${summary.total.toFixed(2)}
          </Text>
        </View>
      )}

      {isLoading ? (
        <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={data || []}
          keyExtractor={item => item.id}
          renderItem={renderFee}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>No fee records found</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#f8fafc' },
  header:        { padding: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  title:         { fontSize: 22, fontWeight: '700', color: '#1e293b' },
  summaryBanner: { padding: 12, margin: 12, borderRadius: 10 },
  summaryText:   { fontWeight: '600', textAlign: 'center' },
  list:          { padding: 12 },
  card:          { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  cardTop:       { flexDirection: 'row', justifyContent: 'space-between' },
  feeType:       { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  studentName:   { fontSize: 13, color: '#6366f1', marginTop: 2 },
  desc:          { fontSize: 12, color: '#64748b', marginTop: 2 },
  dueDate:       { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  amount:        { fontSize: 18, fontWeight: '700', color: '#1e293b' },
  badge:         { marginTop: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  badgeText:     { fontSize: 11, fontWeight: '600' },
  payBtn:        { marginTop: 12, backgroundColor: '#6366f1', borderRadius: 8, padding: 12, alignItems: 'center' },
  payBtnText:    { color: '#fff', fontWeight: '700', fontSize: 14 },
  empty:         { textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 14 },
});
