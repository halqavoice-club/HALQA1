/**
 * HALQA Mobile — Behavior Screen
 * Students/Guardians: view behavior log history with points summary.
 * Teachers: record positive/negative behavior entries.
 */
import React from 'react';
import {
  View, Text, FlatList, StyleSheet, SafeAreaView,
  ActivityIndicator, RefreshControl
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';

type BehaviorLog = {
  id: string;
  type: 'POSITIVE' | 'NEGATIVE';
  category: string;
  points: number;
  description?: string;
  date: string;
  teacher?: { user?: { firstName: string; lastName: string } };
};

export default function BehaviorScreen() {
  const { user } = useAuthStore();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['behavior', user?.id],
    queryFn:  async () => {
      const res = await api.get('/behavior', { params: { limit: 50 } });
      const raw = res.data.data;
      return (Array.isArray(raw) ? raw : raw?.items ?? []) as BehaviorLog[];
    },
    enabled:   !!user,
    staleTime: 5 * 60 * 1000
  });

  const totalPoints = React.useMemo(() =>
    (data || []).reduce((s, b) => s + b.points, 0), [data]
  );

  const positiveCount = (data || []).filter(b => b.type === 'POSITIVE').length;
  const negativeCount = (data || []).filter(b => b.type === 'NEGATIVE').length;

  const renderItem = ({ item }: { item: BehaviorLog }) => {
    const isPos   = item.type === 'POSITIVE';
    const ptColor = isPos ? '#10b981' : '#ef4444';
    const ptBg    = isPos ? '#d1fae5' : '#fee2e2';

    return (
      <View style={styles.row}>
        <View style={[styles.typeIndicator, { backgroundColor: ptBg }]}>
          <Text style={{ fontSize: 18 }}>{isPos ? '⭐' : '⚠️'}</Text>
        </View>
        <View style={styles.rowContent}>
          <Text style={styles.category}>{item.category}</Text>
          {item.description && <Text style={styles.desc}>{item.description}</Text>}
          <Text style={styles.meta}>
            {new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            {item.teacher?.user
              ? ` · ${item.teacher.user.firstName} ${item.teacher.user.lastName}`
              : ''}
          </Text>
        </View>
        <View style={[styles.pointsBadge, { backgroundColor: ptBg }]}>
          <Text style={[styles.pointsText, { color: ptColor }]}>
            {item.points > 0 ? '+' : ''}{item.points}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Behavior</Text>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: '#e0e7ff' }]}>
          <Text style={[styles.statValue, { color: totalPoints >= 0 ? '#6366f1' : '#ef4444' }]}>
            {totalPoints > 0 ? '+' : ''}{totalPoints}
          </Text>
          <Text style={styles.statLabel}>Total Points</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#d1fae5' }]}>
          <Text style={[styles.statValue, { color: '#10b981' }]}>{positiveCount}</Text>
          <Text style={styles.statLabel}>Positive</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#fee2e2' }]}>
          <Text style={[styles.statValue, { color: '#ef4444' }]}>{negativeCount}</Text>
          <Text style={styles.statLabel}>Negative</Text>
        </View>
      </View>

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
            <Text style={styles.empty}>No behavior records found</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#f8fafc' },
  header:         { padding: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  title:          { fontSize: 22, fontWeight: '700', color: '#1e293b' },
  statsRow:       { flexDirection: 'row', padding: 12, gap: 8 },
  statCard:       { flex: 1, borderRadius: 10, padding: 10, alignItems: 'center' },
  statValue:      { fontSize: 20, fontWeight: '700' },
  statLabel:      { fontSize: 11, color: '#64748b', marginTop: 2 },
  list:           { padding: 12 },
  row:            {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 10, padding: 12, marginBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1
  },
  typeIndicator:  { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  rowContent:     { flex: 1 },
  category:       { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  desc:           { fontSize: 12, color: '#64748b', marginTop: 2 },
  meta:           { fontSize: 11, color: '#94a3b8', marginTop: 4 },
  pointsBadge:    { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, marginLeft: 8 },
  pointsText:     { fontSize: 14, fontWeight: '700' },
  empty:          { textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 14 },
});
