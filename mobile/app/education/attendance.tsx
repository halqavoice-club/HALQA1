/**
 * HALQA Mobile — Attendance Screen
 * Students: view their own attendance history + stats.
 * Teachers/Admins: view class attendance, mark present/absent.
 * Guardians: view their child's attendance.
 */
import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator, RefreshControl
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';

type AttendanceRecord = {
  id: string;
  date: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'LEFT_EARLY';
  class: { name: string };
  checkInTime?: string;
  notes?: string;
};

const STATUS_CONFIG = {
  PRESENT:    { label: 'Present',    color: '#10b981', bg: '#d1fae5' },
  ABSENT:     { label: 'Absent',     color: '#ef4444', bg: '#fee2e2' },
  LATE:       { label: 'Late',       color: '#f59e0b', bg: '#fef3c7' },
  EXCUSED:    { label: 'Excused',    color: '#6366f1', bg: '#e0e7ff' },
  LEFT_EARLY: { label: 'Left Early', color: '#64748b', bg: '#f1f5f9' },
};

function StatusBadge({ status }: { status: keyof typeof STATUS_CONFIG }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.PRESENT;
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

export default function AttendanceScreen() {
  const { user } = useAuthStore();
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['attendance', user?.id, selectedMonth],
    queryFn:  async () => {
      // Build the correct query params based on role
      // STUDENT/GUARDIAN: fetch their own attendance
      // TEACHER/SCHOOL_ADMIN: fetch all attendance for their school
      const params: Record<string, string> = { month: selectedMonth, limit: '100' };

      if (user?.role === 'STUDENT') {
        // The attendance endpoint filters by studentId (Student record, not User)
        // We query by the authenticated user — backend resolves via student.userId
        params.myAttendance = 'true';
      } else if (user?.role === 'GUARDIAN') {
        params.guardianView = 'true';
      }

      const res = await api.get('/attendance', { params });
      // Normalize response: backend returns { items, total } or direct array
      const raw = res.data.data;
      return (Array.isArray(raw) ? raw : raw?.items ?? []) as AttendanceRecord[];
    },
    enabled: !!user,
    staleTime: 2 * 60 * 1000
  });

  // Calculate stats
  const stats = React.useMemo(() => {
    if (!data?.length) return { present: 0, absent: 0, late: 0, total: 0, rate: 0 };
    const present = data.filter(r => r.status === 'PRESENT').length;
    const absent  = data.filter(r => r.status === 'ABSENT').length;
    const late    = data.filter(r => r.status === 'LATE').length;
    const total   = data.length;
    return { present, absent, late, total, rate: Math.round((present / total) * 100) };
  }, [data]);

  const renderItem = ({ item }: { item: AttendanceRecord }) => (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.date}>
          {new Date(item.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </Text>
        <Text style={styles.className}>{item.class?.name}</Text>
      </View>
      <StatusBadge status={item.status} />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Attendance</Text>
      </View>

      {/* Stats cards */}
      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: '#d1fae5' }]}>
          <Text style={[styles.statValue, { color: '#10b981' }]}>{stats.present}</Text>
          <Text style={styles.statLabel}>Present</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#fee2e2' }]}>
          <Text style={[styles.statValue, { color: '#ef4444' }]}>{stats.absent}</Text>
          <Text style={styles.statLabel}>Absent</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#fef3c7' }]}>
          <Text style={[styles.statValue, { color: '#f59e0b' }]}>{stats.late}</Text>
          <Text style={styles.statLabel}>Late</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#e0e7ff' }]}>
          <Text style={[styles.statValue, { color: '#6366f1' }]}>{stats.rate}%</Text>
          <Text style={styles.statLabel}>Rate</Text>
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
            <Text style={styles.empty}>No attendance records for this period</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#f8fafc' },
  header:     { padding: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  title:      { fontSize: 22, fontWeight: '700', color: '#1e293b' },
  statsRow:   { flexDirection: 'row', padding: 12, gap: 8 },
  statCard:   { flex: 1, borderRadius: 10, padding: 10, alignItems: 'center' },
  statValue:  { fontSize: 20, fontWeight: '700' },
  statLabel:  { fontSize: 11, color: '#64748b', marginTop: 2 },
  list:       { padding: 12 },
  row:        {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1
  },
  rowLeft:    { flex: 1 },
  date:       { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  className:  { fontSize: 12, color: '#64748b', marginTop: 2 },
  badge:      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText:  { fontSize: 12, fontWeight: '600' },
  empty:      { textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 14 },
});
