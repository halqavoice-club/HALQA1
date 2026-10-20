/**
 * HALQA Mobile — Attendance Screen
 *
 * Role-aware attendance viewer:
 *   STUDENT   → own attendance via GET /attendance/student/:studentId
 *   GUARDIAN  → each linked child's attendance via GET /attendance/student/:childStudentId
 *   TEACHER / SCHOOL_ADMIN → class attendance via GET /attendance/class/:classId (with class picker)
 */
import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator, RefreshControl, ScrollView,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/auth.store';
import { useSchoolStore } from '@/store/school.store';
import api from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type AttendanceRecord = {
  id: string;
  date: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'LEFT_EARLY';
  class?: { name: string };
  student?: { user?: { firstName: string; lastName: string } };
  checkInTime?: string;
  notes?: string;
};

type ClassItem = { id: string; name: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  PRESENT:    { label: 'Present',    color: '#10b981', bg: '#d1fae5', icon: 'checkmark-circle' },
  ABSENT:     { label: 'Absent',     color: '#ef4444', bg: '#fee2e2', icon: 'close-circle' },
  LATE:       { label: 'Late',       color: '#f59e0b', bg: '#fef3c7', icon: 'time' },
  EXCUSED:    { label: 'Excused',    color: '#6366f1', bg: '#e0e7ff', icon: 'information-circle' },
  LEFT_EARLY: { label: 'Left Early', color: '#64748b', bg: '#f1f5f9', icon: 'exit' },
} as const;

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.PRESENT;
  return (
    <View style={[s.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[s.badgeTxt, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

function buildStats(records: AttendanceRecord[]) {
  if (!records.length) return { present: 0, absent: 0, late: 0, total: 0, rate: 0 };
  const present = records.filter(r => r.status === 'PRESENT').length;
  const absent  = records.filter(r => r.status === 'ABSENT').length;
  const late    = records.filter(r => r.status === 'LATE').length;
  const total   = records.length;
  return { present, absent, late, total, rate: Math.round(((present + late) / total) * 100) };
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function AttendanceScreen() {
  const { user } = useAuthStore();
  const schoolStore = useSchoolStore();
  const activeMembership = schoolStore.getActiveMembership();
  // Use school membership role for new-arch users, fallback to User.role for legacy
  const effectiveRole = activeMembership?.role ?? user?.role ?? 'STUDENT';

  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [selectedClassId, setSelectedClassId] = useState<string>('');

  // ── Staff: fetch class list ────────────────────────────────────────────────
  const isStaff = effectiveRole === 'TEACHER' || effectiveRole === 'SCHOOL_ADMIN';
  const isGuardian = effectiveRole === 'GUARDIAN';
  const isStudent  = effectiveRole === 'STUDENT';

  const { data: classes = [] } = useQuery<ClassItem[]>({
    queryKey: ['classes'],
    queryFn: () => api.get('/classes').then(r => r.data.data ?? []),
    enabled: isStaff,
    staleTime: 60_000,
  });

  // Auto-select first class when list loads
  React.useEffect(() => {
    if (classes.length > 0 && !selectedClassId) {
      setSelectedClassId(classes[0].id);
    }
  }, [classes, selectedClassId]);

  // ── Student: /me endpoint resolves student record automatically ─────────────
  // No need to extract student record ID manually

  // ── Guardian: get linked children ─────────────────────────────────────────
  const { data: guardianProfile } = useQuery({
    queryKey: ['guardian-self'],
    queryFn: () => api.get(`/guardians/${user?.guardian?.id}`).then(r => r.data.data),
    enabled: isGuardian && !!user?.guardian?.id,
    staleTime: 60_000,
  });
  const linkedStudents: any[] = guardianProfile?.students ?? [];

  // ── Student attendance query — uses /student/me (no need to know student record ID) ──
  const { data: studentData, isLoading: loadingStudent, refetch: refetchStudent, isRefetching: refetchingStudent } = useQuery<AttendanceRecord[]>({
    queryKey: ['attendance-student-me', selectedMonth],
    queryFn: () =>
      api.get('/attendance/student/me', {
        params: { month: selectedMonth, limit: 100 }
      }).then(r => {
        const raw = r.data.data;
        return (Array.isArray(raw) ? raw : raw?.records ?? []);
      }),
    enabled: isStudent,
    staleTime: 2 * 60_000,
  });

  // ── Class attendance query (teacher/admin) ────────────────────────────────
  const { data: classData, isLoading: loadingClass, refetch: refetchClass, isRefetching: refetchingClass } = useQuery<AttendanceRecord[]>({
    queryKey: ['attendance-class', selectedClassId, selectedMonth],
    queryFn: () =>
      api.get(`/attendance/class/${selectedClassId}`, {
        params: { month: selectedMonth, limit: 200 }
      }).then(r => {
        const raw = r.data.data;
        return (Array.isArray(raw) ? raw : raw?.records ?? []);
      }),
    enabled: isStaff && !!selectedClassId,
    staleTime: 2 * 60_000,
  });

  // ── Guardian: first child attendance ─────────────────────────────────────
  const firstChildStudentId = linkedStudents[0]?.student?.id;
  const [selectedChildIdx, setSelectedChildIdx] = useState(0);
  const selectedChildStudentId = linkedStudents[selectedChildIdx]?.student?.id;

  const { data: childData, isLoading: loadingChild, refetch: refetchChild, isRefetching: refetchingChild } = useQuery<AttendanceRecord[]>({
    queryKey: ['attendance-child', selectedChildStudentId, selectedMonth],
    queryFn: () =>
      api.get(`/attendance/student/${selectedChildStudentId}`, {
        params: { month: selectedMonth, limit: 100 }
      }).then(r => {
        const raw = r.data.data;
        return (Array.isArray(raw) ? raw : raw?.records ?? []);
      }),
    enabled: isGuardian && !!selectedChildStudentId,
    staleTime: 2 * 60_000,
  });

  // ── Resolve active data, loading, refetch ─────────────────────────────────
  const records   = isStudent ? (studentData ?? []) : isGuardian ? (childData ?? []) : (classData ?? []);
  const isLoading = isStudent ? loadingStudent : isGuardian ? loadingChild : loadingClass;
  const isRefreshing = isStudent ? refetchingStudent : isGuardian ? refetchingChild : refetchingClass;
  const doRefresh = isStudent ? refetchStudent : isGuardian ? refetchChild : refetchClass;

  const stats = React.useMemo(() => buildStats(records), [records]);

  // ── Month navigator helpers ───────────────────────────────────────────────
  function prevMonth() {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  function nextMonth() {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m, 1);
    const now = new Date();
    if (d > now) return;
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const monthLabel = new Date(selectedMonth + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>Attendance</Text>

        {/* Month navigator */}
        <View style={s.monthNav}>
          <TouchableOpacity onPress={prevMonth} style={s.navBtn}>
            <Ionicons name="chevron-back" size={18} color="#4f46e5" />
          </TouchableOpacity>
          <Text style={s.monthLabel}>{monthLabel}</Text>
          <TouchableOpacity onPress={nextMonth} style={s.navBtn}>
            <Ionicons name="chevron-forward" size={18} color="#4f46e5" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Guardian: child selector */}
      {isGuardian && linkedStudents.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.childTabRow} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
          {linkedStudents.map((gs: any, i: number) => (
            <TouchableOpacity
              key={gs.student?.id}
              style={[s.childTab, selectedChildIdx === i && s.childTabActive]}
              onPress={() => setSelectedChildIdx(i)}
            >
              <Text style={[s.childTabTxt, selectedChildIdx === i && s.childTabTxtActive]}>
                {gs.student?.user?.firstName ?? `Child ${i + 1}`}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Staff: class picker */}
      {isStaff && classes.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.childTabRow} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
          {classes.map((c: ClassItem) => (
            <TouchableOpacity
              key={c.id}
              style={[s.childTab, selectedClassId === c.id && s.childTabActive]}
              onPress={() => setSelectedClassId(c.id)}
            >
              <Text style={[s.childTabTxt, selectedClassId === c.id && s.childTabTxtActive]}>{c.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Stats row */}
      <View style={s.statsRow}>
        {[
          { label: 'Present', value: stats.present, color: '#10b981', bg: '#d1fae5' },
          { label: 'Absent',  value: stats.absent,  color: '#ef4444', bg: '#fee2e2' },
          { label: 'Late',    value: stats.late,    color: '#f59e0b', bg: '#fef3c7' },
          { label: 'Rate',    value: `${stats.rate}%`, color: '#6366f1', bg: '#e0e7ff' },
        ].map(item => (
          <View key={item.label} style={[s.statCard, { backgroundColor: item.bg }]}>
            <Text style={[s.statValue, { color: item.color }]}>{item.value}</Text>
            <Text style={s.statLabel}>{item.label}</Text>
          </View>
        ))}
      </View>

      {/* Records list */}
      {isLoading ? (
        <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={records}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={doRefresh} />}
          contentContainerStyle={s.list}
          ListEmptyComponent={
            <View style={s.emptyWrap}>
              <Ionicons name="calendar-outline" size={48} color="#d1d5db" />
              <Text style={s.emptyTxt}>No attendance records for {monthLabel}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={s.row}>
              <View style={s.rowLeft}>
                <Text style={s.date}>
                  {new Date(item.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </Text>
                {item.class?.name && <Text style={s.className}>{item.class.name}</Text>}
                {/* Show student name in class view */}
                {isStaff && item.student?.user && (
                  <Text style={s.studentName}>
                    {item.student.user.firstName} {item.student.user.lastName}
                  </Text>
                )}
                {item.notes ? <Text style={s.notes}>{item.notes}</Text> : null}
              </View>
              <StatusBadge status={item.status} />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#f8fafc' },
  header:          { padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0', gap: 8 },
  title:           { fontSize: 22, fontWeight: '700', color: '#1e293b' },
  monthNav:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  navBtn:          { padding: 4 },
  monthLabel:      { fontSize: 14, fontWeight: '600', color: '#374151', flex: 1, textAlign: 'center' },
  childTabRow:     { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  childTab:        { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f3f4f6' },
  childTabActive:  { backgroundColor: '#eef2ff' },
  childTabTxt:     { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  childTabTxtActive:{ color: '#4f46e5' },
  statsRow:        { flexDirection: 'row', padding: 12, gap: 8 },
  statCard:        { flex: 1, borderRadius: 10, padding: 10, alignItems: 'center' },
  statValue:       { fontSize: 20, fontWeight: '700' },
  statLabel:       { fontSize: 11, color: '#64748b', marginTop: 2 },
  list:            { padding: 12, paddingBottom: 24 },
  row:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  rowLeft:         { flex: 1, marginRight: 8 },
  date:            { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  className:       { fontSize: 12, color: '#64748b', marginTop: 2 },
  studentName:     { fontSize: 12, color: '#4f46e5', marginTop: 1 },
  notes:           { fontSize: 11, color: '#9ca3af', marginTop: 2, fontStyle: 'italic' },
  badge:           { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, flexShrink: 0 },
  badgeTxt:        { fontSize: 12, fontWeight: '600' },
  emptyWrap:       { alignItems: 'center', paddingTop: 48, gap: 10 },
  emptyTxt:        { color: '#94a3b8', fontSize: 14, textAlign: 'center' },
});
