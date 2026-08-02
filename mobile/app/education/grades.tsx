/**
 * HALQA Mobile — Grades Screen
 * Students/Guardians: view grade history grouped by class and term.
 * Teachers: view class grades, see averages.
 */
import React, { useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, SafeAreaView,
  ActivityIndicator, RefreshControl, SectionList
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';

type Grade = {
  id: string;
  title: string;
  type: string;
  score: number;
  maxScore: number;
  percentage: number;
  letterGrade: string;
  feedback?: string;
  gradedAt: string;
  class: { name: string };
  term?: { name: string };
};

function GradeBar({ percentage }: { percentage: number }) {
  const color = percentage >= 90 ? '#10b981' : percentage >= 75 ? '#6366f1' : percentage >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <View style={styles.barBg}>
      <View style={[styles.barFill, { width: `${Math.min(percentage, 100)}%` as any, backgroundColor: color }]} />
    </View>
  );
}

export default function GradesScreen() {
  const { user } = useAuthStore();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['grades', user?.id],
    queryFn:  async () => {
      // Students and Guardians: fetch own grades via the student-report endpoint
      // Teachers/Admins: fetch class grades via /grades
      const isStudentView = ['STUDENT', 'GUARDIAN'].includes(user?.role || '');
      const endpoint = isStudentView ? '/student-reports/grades' : '/grades';
      const res = await api.get(endpoint, { params: { limit: 100 } });
      const raw = res.data.data;
      return (Array.isArray(raw) ? raw : raw?.items ?? []) as Grade[];
    },
    enabled:   !!user,
    staleTime: 5 * 60 * 1000
  });

  // Calculate GPA-style average
  const average = React.useMemo(() => {
    if (!data?.length) return 0;
    return Math.round(data.reduce((s, g) => s + (g.percentage || 0), 0) / data.length);
  }, [data]);

  // Group by class name
  const sections = React.useMemo(() => {
    if (!data?.length) return [];
    const map = new Map<string, Grade[]>();
    data.forEach(g => {
      const key = g.class?.name || 'General';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(g);
    });
    return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
  }, [data]);

  const renderGrade = ({ item }: { item: Grade }) => {
    const pct = item.percentage || Math.round((item.score / item.maxScore) * 100);
    const color = pct >= 90 ? '#10b981' : pct >= 75 ? '#6366f1' : pct >= 60 ? '#f59e0b' : '#ef4444';
    return (
      <View style={styles.gradeRow}>
        <View style={styles.gradeLeft}>
          <Text style={styles.gradeTitle}>{item.title}</Text>
          <Text style={styles.gradeType}>{item.type} • {item.term?.name || ''}</Text>
          <GradeBar percentage={pct} />
        </View>
        <View style={styles.gradeRight}>
          <Text style={[styles.gradeScore, { color }]}>{item.score}/{item.maxScore}</Text>
          <Text style={[styles.gradeLetter, { color }]}>{item.letterGrade || `${pct}%`}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Grades</Text>
        {data && data.length > 0 && (
          <View style={styles.avgBadge}>
            <Text style={styles.avgText}>Avg: {average}%</Text>
          </View>
        )}
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => item.id}
          renderItem={renderGrade}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
          )}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>No grades recorded yet</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f8fafc' },
  header:       { padding: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:        { fontSize: 22, fontWeight: '700', color: '#1e293b' },
  avgBadge:     { backgroundColor: '#e0e7ff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  avgText:      { color: '#6366f1', fontWeight: '700', fontSize: 14 },
  sectionHeader:{ backgroundColor: '#f1f5f9', paddingHorizontal: 16, paddingVertical: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 },
  list:         { padding: 12 },
  gradeRow:     { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  gradeLeft:    { flex: 1 },
  gradeRight:   { alignItems: 'flex-end', justifyContent: 'center', marginLeft: 12 },
  gradeTitle:   { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  gradeType:    { fontSize: 12, color: '#64748b', marginTop: 2, marginBottom: 6 },
  barBg:        { height: 4, backgroundColor: '#e2e8f0', borderRadius: 2 },
  barFill:      { height: 4, borderRadius: 2 },
  gradeScore:   { fontSize: 13, fontWeight: '600' },
  gradeLetter:  { fontSize: 16, fontWeight: '700', marginTop: 2 },
  empty:        { textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 14 },
});
