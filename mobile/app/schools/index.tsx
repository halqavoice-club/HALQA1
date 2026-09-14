/**
 * HALQA Mobile — My Schools / School Switcher
 * Route: /schools (or /schools/index)
 *
 * Shows all schools the user belongs to with their role.
 * Tapping a school:
 *   1. Sets it as the active school in the school store
 *   2. Navigates to /education — which now shows the correct role-aware hub
 *
 * One account can be TEACHER at school A, SCHOOL_ADMIN at school B, STUDENT at school C.
 *
 * LEAVE SCHOOL: Members (Student / Teacher / Guardian) can leave from this screen.
 * SCHOOL_ADMIN must use School Settings to leave.
 */
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, Image, Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import { useSchoolStore } from '@/store/school.store';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';

// ─── Role display config ──────────────────────────────────────────────────────
const ROLE_META: Record<string, {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
  description: string;
  quickAccess: string[];
}> = {
  SCHOOL_ADMIN: {
    label:       'School Admin',
    icon:        'shield-checkmark-outline',
    color:       '#7c3aed',
    bg:          '#f5f3ff',
    description: 'Full management — students, teachers, classes, fees, reports',
    quickAccess: ['Students', 'Teachers', 'Classes', 'Attendance', 'Grades', 'Fees', 'Reports'],
  },
  TEACHER: {
    label:       'Teacher',
    icon:        'person-outline',
    color:       '#16a34a',
    bg:          '#f0fdf4',
    description: 'Manage classes, grades, attendance and assignments',
    quickAccess: ['My Classes', 'Attendance', 'Grades', 'Assignments', 'Behavior'],
  },
  STUDENT: {
    label:       'Student',
    icon:        'school-outline',
    color:       '#2563eb',
    bg:          '#eff6ff',
    description: 'View grades, attendance, assignments and schedule',
    quickAccess: ['Grades', 'Attendance', 'Assignments', 'Library', 'Leaderboard'],
  },
  GUARDIAN: {
    label:       'Guardian',
    icon:        'people-outline',
    color:       '#ea580c',
    bg:          '#fff7ed',
    description: "Track your child's progress and school announcements",
    quickAccess: ['Attendance', 'Grades', 'Announcements', 'Calendar'],
  },
};

export default function MySchoolsScreen() {
  const router      = useRouter();
  const authStore   = useAuthStore();
  const schoolStore = useSchoolStore();
  const user        = authStore.user;

  const memberships = schoolStore.memberships.filter(m => m.status === 'ACTIVE');

  // Leave school state
  const [leaveTarget, setLeaveTarget] = useState<typeof memberships[0] | null>(null);
  const [leaveLoading, setLeaveLoading] = useState(false);

  function handleSelectSchool(schoolId: string, schoolName: string) {
    schoolStore.setActiveSchoolId(schoolId);
    showMessage({
      message:  `Switched to ${schoolName}`,
      type:     'success',
      duration: 1800,
    });
    router.push('/education' as any);
  }

  async function confirmLeave(m: typeof memberships[0]) {
    setLeaveLoading(true);
    try {
      await api.delete(`/school-memberships/${m.id}`);
      // Refresh membership list
      const res = await api.get('/school-memberships/me');
      const fresh = (res.data.data?.memberships ?? res.data.data ?? []).filter((x: any) => x.status === 'ACTIVE');
      schoolStore.setMemberships(fresh);
      // If we left the active school, clear it
      if (schoolStore.activeSchoolId === m.schoolId) {
        schoolStore.setActiveSchoolId(fresh[0]?.schoolId ?? null);
      }
      showMessage({ message: `Left ${m.school.name}`, type: 'success', duration: 2500 });
      setLeaveTarget(null);
    } catch (err: any) {
      showMessage({
        message: err?.response?.data?.message || 'Could not leave school. Please try again.',
        type: 'danger',
      });
    } finally {
      setLeaveLoading(false);
    }
  }

  function promptLeave(m: typeof memberships[0]) {
    Alert.alert(
      `Leave ${m.school.name}?`,
      m.role === 'STUDENT'
        ? 'You will lose access to your grades and classes here. Your data stays saved — you can join a new school as Student afterwards.'
        : 'You will lose access to this school\'s Education features. Your data stays saved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave School',
          style: 'destructive',
          onPress: () => confirmLeave(m),
        },
      ]
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={s.container}>
        <ActivityIndicator color="#4f46e5" style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  if (memberships.length === 0) {
    return (
      <SafeAreaView style={s.container}>
        <Stack.Screen options={{ title: 'My Schools', headerBackTitle: 'Back' }} />
        <View style={s.emptyWrap}>
          <Text style={{ fontSize: 56, marginBottom: 12 }}>🏫</Text>
          <Text style={s.emptyTitle}>No Schools Yet</Text>
          <Text style={s.emptySub}>
            Join an existing school or create your own to unlock the Education section.
          </Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => router.push('/schools/join' as any)}>
            <Ionicons name="enter-outline" size={18} color="#fff" />
            <Text style={s.primaryBtnText}>Join a School</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.outlineBtn} onPress={() => router.push('/schools/create' as any)}>
            <Ionicons name="add-circle-outline" size={18} color="#4f46e5" />
            <Text style={s.outlineBtnText}>Create a School</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const activeSchoolId = schoolStore.activeSchoolId;

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'My Schools', headerBackTitle: 'Back' }} />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.hint}>Tap a school to switch context and open its dashboard.</Text>

        {memberships.map(m => {
          const meta    = ROLE_META[m.role] ?? ROLE_META.STUDENT;
          const isActive = m.schoolId === activeSchoolId;

          return (
            <View key={m.schoolId} style={{ marginBottom: 12 }}>
              <TouchableOpacity
                style={[s.card, isActive && s.cardActive]}
                onPress={() => handleSelectSchool(m.schoolId, m.school.name)}
                activeOpacity={0.75}
              >
                {/* Logo */}
                <View style={s.logoWrap}>
                  {m.school.logoUrl ? (
                    <Image source={{ uri: m.school.logoUrl }} style={s.logo} resizeMode="contain" />
                  ) : (
                    <Ionicons name="school-outline" size={28} color="#6366f1" />
                  )}
                </View>

                {/* Content */}
                <View style={s.cardBody}>
                  {/* School name + active badge */}
                  <View style={s.nameRow}>
                    <Text style={s.schoolName} numberOfLines={2}>{m.school.name}</Text>
                    {isActive && (
                      <View style={s.activeBadge}>
                        <Ionicons name="checkmark-circle" size={12} color="#4f46e5" />
                        <Text style={s.activeBadgeText}>Active</Text>
                      </View>
                    )}
                  </View>

                  {/* Role badge */}
                  <View style={[s.roleBadge, { backgroundColor: meta.bg }]}>
                    <Ionicons name={meta.icon} size={12} color={meta.color} />
                    <Text style={[s.roleBadgeText, { color: meta.color }]}>{meta.label}</Text>
                  </View>

                  {/* Description */}
                  <Text style={s.description}>{meta.description}</Text>

                  {/* Quick access chips */}
                  <View style={s.chipsRow}>
                    {meta.quickAccess.map(item => (
                      <View key={item} style={s.chip}>
                        <Text style={s.chipText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* Arrow */}
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={isActive ? '#4f46e5' : '#d1d5db'}
                  style={s.arrow}
                />
              </TouchableOpacity>

              {/* Below-card action row */}
              <View style={s.belowCard}>
                {m.role === 'SCHOOL_ADMIN' ? (
                  <TouchableOpacity
                    style={s.settingsLink}
                    onPress={() => router.push({ pathname: '/schools/[id]', params: { id: m.schoolId } } as any)}
                  >
                    <Ionicons name="settings-outline" size={13} color="#4f46e5" />
                    <Text style={s.settingsLinkText}>School Settings</Text>
                  </TouchableOpacity>
                ) : (
                  <View /> /* spacer */
                )}

                {/* Leave school — not available for SCHOOL_ADMIN (use Settings) */}
                {m.role !== 'SCHOOL_ADMIN' && (
                  <TouchableOpacity
                    style={s.leaveLink}
                    onPress={() => promptLeave(m)}
                  >
                    <Ionicons name="log-out-outline" size={13} color="#ef4444" />
                    <Text style={s.leaveLinkText}>Leave school</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}

        {/* Add more */}
        <View style={s.addRow}>
          <TouchableOpacity style={s.addBtn} onPress={() => router.push('/schools/join' as any)}>
            <Ionicons name="add-circle-outline" size={16} color="#4f46e5" />
            <Text style={s.addBtnText}>Join another school</Text>
          </TouchableOpacity>
          <Text style={s.sep}>·</Text>
          <TouchableOpacity style={s.addBtn} onPress={() => router.push('/schools/create' as any)}>
            <Ionicons name="add-circle-outline" size={16} color="#4f46e5" />
            <Text style={s.addBtnText}>Create a school</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#f8fafc' },
  scroll:         { padding: 16, paddingBottom: 40 },
  hint:           { fontSize: 13, color: '#64748b', marginBottom: 16 },

  // Card
  card:           {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#fff', borderRadius: 18, padding: 16, marginBottom: 12,
    borderWidth: 2, borderColor: '#f1f5f9',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  cardActive:     { borderColor: '#4f46e5', shadowOpacity: 0.12, shadowRadius: 12 },

  logoWrap:       {
    width: 56, height: 56, borderRadius: 14,
    backgroundColor: '#eef2ff', justifyContent: 'center', alignItems: 'center',
    flexShrink: 0, marginRight: 12, overflow: 'hidden',
  },
  logo:           { width: 52, height: 52, borderRadius: 12 },

  cardBody:       { flex: 1 },
  nameRow:        { flexDirection: 'row', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap', marginBottom: 6 },
  schoolName:     { fontSize: 15, fontWeight: '700', color: '#111827', flex: 1 },

  activeBadge:    { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#eef2ff', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20, flexShrink: 0 },
  activeBadgeText:{ fontSize: 10, color: '#4f46e5', fontWeight: '700' },

  roleBadge:      { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, marginBottom: 6 },
  roleBadgeText:  { fontSize: 11, fontWeight: '700' },

  description:    { fontSize: 12, color: '#64748b', lineHeight: 17, marginBottom: 8 },

  chipsRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  chip:           { backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  chipText:       { fontSize: 10, color: '#475569', fontWeight: '500' },

  arrow:          { marginTop: 4, flexShrink: 0 },

  // Settings link below card
  settingsLink:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 4, paddingVertical: 6 },
  settingsLinkText: { fontSize: 12, color: '#4f46e5', fontWeight: '600' },

  // Below-card action row (settings + leave side by side)
  belowCard:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 2 },
  leaveLink:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  leaveLinkText:  { fontSize: 12, color: '#ef4444', fontWeight: '600' },

  // Add more row
  addRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8, paddingVertical: 12 },
  addBtn:         { flexDirection: 'row', alignItems: 'center', gap: 5 },
  addBtnText:     { fontSize: 13, color: '#4f46e5', fontWeight: '600' },
  sep:            { fontSize: 16, color: '#d1d5db' },

  // Empty state
  emptyWrap:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle:     { fontSize: 22, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 8 },
  emptySub:       { fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 20, marginBottom: 28 },
  primaryBtn:     { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#4f46e5', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14, marginBottom: 12 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  outlineBtn:     { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 2, borderColor: '#4f46e5', paddingHorizontal: 24, paddingVertical: 13, borderRadius: 14 },
  outlineBtnText: { color: '#4f46e5', fontSize: 15, fontWeight: '700' },
});
