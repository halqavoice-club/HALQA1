/**
 * HALQA Mobile — Reports Screen
 * Teachers/Admins: view generated reports, download PDF.
 */
import React from 'react';
import {
  View, Text, FlatList, StyleSheet, SafeAreaView,
  ActivityIndicator, RefreshControl, TouchableOpacity, Linking
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';
import { getBaseURL } from '@/lib/api';

type Report = {
  id: string; title: string; type: string; status: string;
  fileUrl?: string; createdAt: string; completedAt?: string;
};

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: string }> = {
  pending:    { color: '#f59e0b', bg: '#fef3c7', icon: 'time-outline' },
  processing: { color: '#6366f1', bg: '#e0e7ff', icon: 'sync-outline' },
  completed:  { color: '#10b981', bg: '#d1fae5', icon: 'checkmark-circle-outline' },
  failed:     { color: '#ef4444', bg: '#fee2e2', icon: 'alert-circle-outline' },
};

export default function ReportsScreen() {
  const BASE = getBaseURL().replace('/api/v1', '');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['reports'],
    queryFn:  async () => {
      const res = await api.get('/reports', { params: { limit: 30 } });
      const raw = res.data.data;
      return (Array.isArray(raw) ? raw : raw?.items ?? []) as Report[];
    },
    staleTime: 30 * 1000,
    refetchInterval: (data) => {
      // Auto-refresh if any report is still processing
      const list = data?.state?.data as Report[] | undefined;
      const hasProcessing = list?.some(r => r.status === 'processing' || r.status === 'pending');
      return hasProcessing ? 5000 : false;
    }
  });

  const handleDownload = async (report: Report) => {
    if (!report.fileUrl) return;
    const url = report.fileUrl.startsWith('http')
      ? report.fileUrl
      : `${BASE}${report.fileUrl}`;
    await Linking.openURL(url);
  };

  const renderItem = ({ item }: { item: Report }) => {
    const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.cardLeft}>
            <View style={[styles.iconCircle, { backgroundColor: cfg.bg }]}>
              <Ionicons name={cfg.icon as any} size={20} color={cfg.color} />
            </View>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.reportTitle}>{item.title}</Text>
            <Text style={styles.reportType}>{item.type.replace(/_/g, ' ')}</Text>
            <Text style={styles.reportTime}>
              {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
            <Text style={[styles.statusText, { color: cfg.color }]}>{item.status}</Text>
          </View>
        </View>

        {item.status === 'completed' && item.fileUrl && (
          <TouchableOpacity style={styles.downloadBtn} onPress={() => handleDownload(item)}>
            <Ionicons name="download-outline" size={16} color="#6366f1" />
            <Text style={styles.downloadText}>Download PDF</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
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
              <Ionicons name="document-text-outline" size={48} color="#d1d5db" />
              <Text style={styles.emptyText}>No reports generated yet</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f8fafc' },
  list:         { padding: 12 },
  card:         { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  cardTop:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardLeft:     {},
  iconCircle:   { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  cardBody:     { flex: 1 },
  reportTitle:  { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  reportType:   { fontSize: 12, color: '#64748b', marginTop: 2, textTransform: 'capitalize' },
  reportTime:   { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  statusBadge:  { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  statusText:   { fontSize: 11, fontWeight: '700' },
  downloadBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, padding: 10, backgroundColor: '#e0e7ff', borderRadius: 8, justifyContent: 'center' },
  downloadText: { color: '#6366f1', fontWeight: '700', fontSize: 13 },
  empty:        { alignItems: 'center', padding: 60 },
  emptyText:    { fontSize: 15, color: '#94a3b8', marginTop: 12 },
});
