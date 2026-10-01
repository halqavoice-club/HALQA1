/**
 * HALQA Mobile — Mark Attendance
 * Route: /education/mark-attendance
 *
 * Teacher / School Admin marks attendance for a class.
 * Each student row shows avatar + name + tappable status circle.
 *
 * Status cycle (tap to change):
 *   PRESENT  → 🟢 green  ✓
 *   ABSENT   → 🔴 red    ✗
 *   LATE     → 🟠 orange 🕐
 *   EXCUSED  → 🔵 blue   ✗
 *
 * Tap "Save All" to bulk-submit via POST /attendance/bulk.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { getAvatarUrl, getAvatarInitials, avatarColor } from '@/lib/avatar';
import { format } from 'date-fns';

// ── Types & constants ──────────────────────────────────────────────────────────

type Status = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

const STATUS_CYCLE: Status[] = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];

const STATUS_CONFIG: Record<Status, {
  bg: string;
  border: string;
  icon: 'checkmark' | 'close' | 'time';
  iconColor: string;
}> = {
  PRESENT: { bg: '#22c55e', border: '#16a34a', icon: 'checkmark',  iconColor: '#fff' },
  ABSENT:  { bg: '#ef4444', border: '#dc2626', icon: 'close',      iconColor: '#fff' },
  LATE:    { bg: '#f97316', border: '#ea580c', icon: 'time',       iconColor: '#fff' },
  EXCUSED: { bg: '#3b82f6', border: '#2563eb', icon: 'close',      iconColor: '#fff' },
};

type Student = {
  id: string;
  studentId: string;
  user: { firstName: string; lastName: string; avatarUrl?: string | null };
};

// ── Status circle button ───────────────────────────────────────────────────────

function StatusCircle({ status, onPress }: { status: Status; onPress: () => void }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <TouchableOpacity
      style={[sc.circle, { backgroundColor: cfg.bg, borderColor: cfg.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons name={cfg.icon} size={22} color={cfg.iconColor} />
    </TouchableOpacity>
  );
}

const sc = StyleSheet.create({
  circle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2.5,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});

// ── Student row ────────────────────────────────────────────────────────────────

function StudentRow({
  student,
  status,
  onToggle,
  onNavigate,
}: {
  student: Student;
  status: Status;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const src      = student.user.avatarUrl ? getAvatarUrl(student.user.avatarUrl) : null;
  const initials = getAvatarInitials(student.user.firstName, student.user.lastName);
  const bg       = avatarColor(`${student.user.firstName}${student.user.lastName}`);
  const fullName = `${student.user.firstName} ${student.user.lastName}`;

  return (
    <View style={sr.row}>
      {/* Avatar */}
      <View style={[sr.avatar, { backgroundColor: bg + '30' }]}>
        {src
          ? <Image source={{ uri: src }} style={sr.avatarImg} />
          : <Text style={[sr.initials, { color: bg }]}>{initials}</Text>
        }
      </View>

      {/* Name + student ID */}
      <View style={sr.info}>
        <Text style={sr.name} numberOfLines={1}>{fullName}</Text>
        <Text style={sr.sid}>{student.studentId}</Text>
      </View>

      {/* Status circle */}
      <StatusCircle status={status} onPress={onToggle} />

      {/* Navigate to student detail */}
      <TouchableOpacity onPress={onNavigate} style={sr.arrow} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="chevron-forward" size={20} color="#86efac" />
      </TouchableOpacity>
    </View>
  );
}

const sr = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  avatar:    { width: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', flexShrink: 0 },
  avatarImg: { width: 46, height: 46, borderRadius: 23 },
  initials:  { fontSize: 16, fontWeight: '800' },
  info:      { flex: 1, marginHorizontal: 12, minWidth: 0 },
  name:      { fontSize: 15, fontWeight: '700', color: '#111827' },
  sid:       { fontSize: 12, color: '#9ca3af', marginTop: 1 },
  arrow:     { paddingHorizontal: 4 },
});

// ── Main screen ────────────────────────────────────────────────────────────────

export default function MarkAttendanceScreen() {
  const router      = useRouter();
  const queryClient = useQueryClient();
  const today       = format(new Date(), 'yyyy-MM-dd');

  const [selectedClassId, setSelectedClassId] = useState('');
  // studentId → status map
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [isSaving, setIsSaving] = useState(false);

  // ── Fetch classes ──────────────────────────────────────────────────────────
  const { data: classes = [], isLoading: loadingClasses } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['classes'],
    queryFn: () => api.get('/classes').then(r => r.data.data ?? []),
    onSuccess: (data) => {
      if (data.length > 0 && !selectedClassId) {
        setSelectedClassId(data[0].id);
      }
    },
  });

  // ── Fetch students for selected class ─────────────────────────────────────
  const { data: students = [], isLoading: loadingStudents } = useQuery<Student[]>({
    queryKey: ['students', selectedClassId],
    queryFn: () =>
      api.get('/students', { params: { classId: selectedClassId, limit: 500 } })
        .then(r => r.data.data ?? []),
    enabled: !!selectedClassId,
    onSuccess: (data) => {
      // Default all to PRESENT when class/data loads
      setStatuses(prev => {
        const next = { ...prev };
        data.forEach(s => { if (!next[s.id]) next[s.id] = 'PRESENT'; });
        return next;
      });
    },
  });

  // ── Fetch existing attendance to pre-fill today's data ────────────────────
  useQuery({
    queryKey: ['attendance-today', selectedClassId, today],
    queryFn: () =>
      api.get(`/attendance/class/${selectedClassId}`, { params: { date: today } })
        .then(r => {
          const records = r.data.data ?? [];
          setStatuses(prev => {
            const next = { ...prev };
            records.forEach((rec: any) => {
              if (rec.studentId) next[rec.studentId] = rec.status as Status;
            });
            return next;
          });
          return records;
        }),
    enabled: !!selectedClassId,
    staleTime: 30_000,
  });

  // ── Cycle status on tap ────────────────────────────────────────────────────
  const toggleStatus = useCallback((studentId: string) => {
    setStatuses(prev => {
      const current = prev[studentId] ?? 'PRESENT';
      const idx     = STATUS_CYCLE.indexOf(current);
      const next    = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
      return { ...prev, [studentId]: next };
    });
  }, []);

  // ── Save all ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!selectedClassId || students.length === 0) return;
    setIsSaving(true);
    try {
      const records = students.map(s => ({
        studentId: s.id,
        status: statuses[s.id] ?? 'PRESENT',
      }));

      await api.post('/attendance/bulk', {
        classId: selectedClassId,
        date:    today,
        records,
      });

      showMessage({ message: `✅ Attendance saved for ${records.length} students`, type: 'success', duration: 3000 });
      queryClient.invalidateQueries({ queryKey: ['attendance-today', selectedClassId] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
    } catch (e: any) {
      showMessage({
        message: e?.response?.data?.message || 'Failed to save attendance',
        type: 'danger',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const counts: Record<Status, number> = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
    students.forEach(s => {
      const st = statuses[s.id] ?? 'PRESENT';
      counts[st]++;
    });
    return counts;
  }, [statuses, students]);

  const selectedClass = classes.find(c => c.id === selectedClassId);

  return (
    <>
      <Stack.Screen options={{
        headerShown: true,
        title: 'Mark Attendance',
        headerStyle: { backgroundColor: '#fff' },
        headerTintColor: '#4f46e5',
        headerTitleStyle: { color: '#111827', fontWeight: '800', fontSize: 16 },
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
            <Ionicons name="arrow-back" size={22} color="#4f46e5" />
          </TouchableOpacity>
        ),
        headerRight: () => (
          <TouchableOpacity
            onPress={handleSave}
            disabled={isSaving || students.length === 0}
            style={[hdr.saveBtn, (isSaving || students.length === 0) && hdr.saveBtnDisabled]}
          >
            {isSaving
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={hdr.saveTxt}>Save All</Text>
            }
          </TouchableOpacity>
        ),
      }} />

      <SafeAreaView style={s.container} edges={['bottom']}>

        {/* Class selector */}
        <View style={s.classSelectorWrap}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={classes}
            keyExtractor={c => c.id}
            contentContainerStyle={s.classChips}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[s.classChip, selectedClassId === item.id && s.classChipActive]}
                onPress={() => {
                  setSelectedClassId(item.id);
                  setStatuses({});
                }}
              >
                <Text style={[s.classChipTxt, selectedClassId === item.id && s.classChipTxtActive]}>
                  {item.name}
                </Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              loadingClasses
                ? <ActivityIndicator color="#4f46e5" />
                : <Text style={s.noClasses}>No classes found</Text>
            }
          />
        </View>

        {/* Date + stats bar */}
        {selectedClass && (
          <View style={s.statsBar}>
            <Text style={s.dateLabel}>
              {format(new Date(), 'EEE, MMM d, yyyy')}
            </Text>
            <View style={s.statChips}>
              <View style={[s.statChip, { backgroundColor: '#dcfce7' }]}>
                <Ionicons name="checkmark" size={11} color="#16a34a" />
                <Text style={[s.statChipTxt, { color: '#16a34a' }]}>{stats.PRESENT}</Text>
              </View>
              <View style={[s.statChip, { backgroundColor: '#fee2e2' }]}>
                <Ionicons name="close" size={11} color="#dc2626" />
                <Text style={[s.statChipTxt, { color: '#dc2626' }]}>{stats.ABSENT}</Text>
              </View>
              <View style={[s.statChip, { backgroundColor: '#ffedd5' }]}>
                <Ionicons name="time" size={11} color="#ea580c" />
                <Text style={[s.statChipTxt, { color: '#ea580c' }]}>{stats.LATE}</Text>
              </View>
              {stats.EXCUSED > 0 && (
                <View style={[s.statChip, { backgroundColor: '#dbeafe' }]}>
                  <Text style={[s.statChipTxt, { color: '#2563eb' }]}>{stats.EXCUSED} exc</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Student list */}
        {loadingStudents ? (
          <ActivityIndicator size="large" color="#4f46e5" style={{ marginTop: 60 }} />
        ) : students.length === 0 && selectedClassId ? (
          <View style={s.emptyWrap}>
            <Ionicons name="people-outline" size={52} color="#d1d5db" />
            <Text style={s.emptyTxt}>No students in this class</Text>
          </View>
        ) : (
          <>
            <FlatList
              data={students}
              keyExtractor={s => s.id}
              renderItem={({ item }) => (
                <StudentRow
                  student={item}
                  status={statuses[item.id] ?? 'PRESENT'}
                  onToggle={() => toggleStatus(item.id)}
                  onNavigate={() =>
                    router.push({ pathname: '/students/[id]', params: { id: item.id } } as any)
                  }
                />
              )}
              ListFooterComponent={
                <Text style={s.footer}>
                  {students.length} student{students.length !== 1 ? 's' : ''} · {stats.PRESENT} present
                </Text>
              }
            />
          </>
        )}
      </SafeAreaView>
    </>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const hdr = StyleSheet.create({
  saveBtn:         { backgroundColor: '#4f46e5', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, minWidth: 74, alignItems: 'center' },
  saveBtnDisabled: { backgroundColor: '#c7d2fe' },
  saveTxt:         { color: '#fff', fontWeight: '800', fontSize: 13 },
});

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#f8fafc' },
  classSelectorWrap:{ backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  classChips:      { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  classChip:       { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f3f4f6', borderWidth: 1.5, borderColor: 'transparent' },
  classChipActive: { backgroundColor: '#eef2ff', borderColor: '#4f46e5' },
  classChipTxt:    { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  classChipTxtActive: { color: '#4f46e5' },
  noClasses:       { fontSize: 13, color: '#9ca3af', paddingVertical: 10, paddingHorizontal: 4 },
  statsBar:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  dateLabel:       { fontSize: 12, color: '#64748b', fontWeight: '600' },
  statChips:       { flexDirection: 'row', gap: 6 },
  statChip:        { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  statChipTxt:     { fontSize: 11, fontWeight: '700' },
  emptyWrap:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 60 },
  emptyTxt:        { fontSize: 14, color: '#9ca3af' },
  footer:          { textAlign: 'center', fontSize: 12, color: '#9ca3af', paddingVertical: 16 },
});
