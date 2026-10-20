/**
 * HALQA Mobile — Education Hub Screen
 * Entry point for all education module features.
 * Routes to Attendance, Grades, Behavior, Fees, Schedule.
 */
import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView
} from 'react-native';
import { router, Stack } from 'expo-router';
import { useAuthStore } from '@/store/auth.store';
import { useSchoolStore } from '@/store/school.store';

interface MenuItem {
  icon: string;
  label: string;
  route: string;
  roles: string[];
  color: string;
}

const MENU_ITEMS: MenuItem[] = [
  { icon: '📋', label: 'Attendance',    route: '/education/attendance',        roles: ['STUDENT','TEACHER','SCHOOL_ADMIN','GUARDIAN'], color: '#6366f1' },
  { icon: '✅', label: 'Mark Attendance', route: '/education/mark-attendance',  roles: ['TEACHER','SCHOOL_ADMIN'],                     color: '#22c55e' },
  { icon: '📊', label: 'Grades',        route: '/education/grades',       roles: ['STUDENT','TEACHER','SCHOOL_ADMIN','GUARDIAN'], color: '#0ea5e9' },
  { icon: '📝', label: 'Assignments',   route: '/education/assignments',  roles: ['STUDENT','TEACHER','SCHOOL_ADMIN'],             color: '#4f46e5' },
  { icon: '📄', label: 'Exams',         route: '/education/exams',        roles: ['STUDENT','TEACHER','SCHOOL_ADMIN'],             color: '#7c3aed' },
  { icon: '🌟', label: 'Behavior',      route: '/education/behavior',     roles: ['STUDENT','TEACHER','SCHOOL_ADMIN','GUARDIAN'], color: '#f59e0b' },
  { icon: '💳', label: 'Fees',          route: '/education/fees',         roles: ['SCHOOL_ADMIN','GUARDIAN'],                    color: '#10b981' },
  { icon: '📅', label: 'Schedule',      route: '/education/schedule',     roles: ['STUDENT','TEACHER','SCHOOL_ADMIN','GUARDIAN'], color: '#8b5cf6' },
  { icon: '📚', label: 'Library',       route: '/education/library',      roles: ['STUDENT','TEACHER','SCHOOL_ADMIN'],            color: '#ec4899' },
  { icon: '📢', label: 'Announcements', route: '/education/announcements',roles: ['STUDENT','TEACHER','SCHOOL_ADMIN','GUARDIAN'], color: '#ef4444' },
  { icon: '📁', label: 'Reports',       route: '/education/reports',      roles: ['TEACHER','SCHOOL_ADMIN'],                     color: '#64748b' },
  { icon: '🎵', label: 'Audio Lessons', route: '/audio',                  roles: ['STUDENT','TEACHER','SCHOOL_ADMIN'],            color: '#8b5cf6' },
  { icon: '📱', label: 'QR Check-in',   route: '/qr-checkin',             roles: ['STUDENT','TEACHER','SCHOOL_ADMIN'],            color: '#0ea5e9' },
  // Student ID Card — students view their own; admins/teachers navigate via student detail
  { icon: '🪪', label: 'My ID Card',    route: '/student-id-card',        roles: ['STUDENT'],                                    color: '#6366f1' },
  // School Admin: add students from social friends
  { icon: '👤➕', label: 'Add from Friends', route: '/add-student-from-friends', roles: ['SCHOOL_ADMIN'],              color: '#10b981' },
  { icon: '👨‍🏫➕', label: 'Add Teacher Friend', route: '/add-teacher-from-friends', roles: ['SCHOOL_ADMIN'],           color: '#16a34a' },
  { icon: '👨‍👩‍👧➕', label: 'Add Guardian Friend', route: '/add-guardian-from-friends', roles: ['SCHOOL_ADMIN'],        color: '#ea580c' },
  { icon: '📝', label: 'Notes',         route: '/notes',                  roles: ['STUDENT','TEACHER','SCHOOL_ADMIN'],            color: '#f59e0b' },
  { icon: '🗓️', label: 'Calendar',      route: '/calendar',               roles: ['STUDENT','TEACHER','SCHOOL_ADMIN','GUARDIAN'], color: '#6366f1' },
  { icon: '🏆', label: 'Leaderboard',   route: '/leaderboard',            roles: ['STUDENT','TEACHER','SCHOOL_ADMIN'],            color: '#f59e0b' },
  { icon: '👥', label: 'Members',       route: '/schools/members',        roles: ['SCHOOL_ADMIN'],                               color: '#4f46e5' },
  { icon: '⚙️', label: 'School Settings', route: '/schools',             roles: ['SCHOOL_ADMIN'],                               color: '#374151' },
];

// Roles shown on the Education hub when user has no school membership yet
const ONBOARDING_ITEMS: MenuItem[] = [
  { icon: '🏫', label: 'Join a School',   route: '/schools/join',             roles: [], color: '#4f46e5' },
  { icon: '➕', label: 'Create a School', route: '/schools/create',           roles: [], color: '#10b981' },
];

export default function EducationScreen() {
  const { user }          = useAuthStore();
  const schoolStore       = useSchoolStore();
  const activeMembership  = schoolStore.getActiveMembership();

  if (!user) return null;

  // Use the school membership role for filtering (not the global user.role which is 'USER').
  // Falls back to user.role for legacy users who have the old role fields set directly.
  const effectiveRole = activeMembership?.role ?? user.role;
  const hasSchool     = !!activeMembership;

  // No school membership → show onboarding
  if (!hasSchool) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: 'Education', headerShown: true, headerTintColor: '#4f46e5' }} />
        <View style={styles.header}>
          <Text style={styles.title}>Education</Text>
          <Text style={styles.subtitle}>Join or create a school to get started</Text>
        </View>
        <View style={styles.onboardingWrap}>
          <Text style={{ fontSize: 48, textAlign: 'center', marginBottom: 12 }}>🏫</Text>
          <Text style={styles.onboardingTitle}>No school yet</Text>
          <Text style={styles.onboardingSub}>
            Join an existing school or create your own to access attendance, grades, assignments, and more.
          </Text>
          <ScrollView contentContainerStyle={[styles.grid, { marginTop: 20 }]} showsVerticalScrollIndicator={false}>
            {ONBOARDING_ITEMS.map(item => (
              <TouchableOpacity
                key={item.route}
                style={[styles.card, { borderLeftColor: item.color, width: '100%' }]}
                onPress={() => router.push(item.route as any)}
                activeOpacity={0.7}
              >
                <Text style={styles.cardIcon}>{item.icon}</Text>
                <Text style={styles.cardLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </SafeAreaView>
    );
  }

  const visibleItems = MENU_ITEMS.filter(item =>
    item.roles.length === 0 || item.roles.includes(effectiveRole)
  );

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ title: 'Education', headerShown: true, headerTintColor: '#4f46e5' }} />
      <View style={styles.header}>
        <Text style={styles.title}>Education</Text>
        <Text style={styles.subtitle}>
          {effectiveRole === 'STUDENT'      ? 'Your academic portal' :
           effectiveRole === 'TEACHER'      ? 'Class management' :
           effectiveRole === 'GUARDIAN'     ? "Your child's progress" :
           effectiveRole === 'SCHOOL_ADMIN' ? 'School administration' :
           activeMembership.school.name}
        </Text>
        {/* Active school name pill */}
        <View style={styles.schoolPill}>
          <Text style={styles.schoolPillText}>🏫 {activeMembership.school.name}</Text>
          <Text style={styles.rolePillText}>{effectiveRole.replace(/_/g, ' ')}</Text>
          {schoolStore.memberships.filter(m => m.status === 'ACTIVE').length > 1 && (
            <TouchableOpacity
              onPress={() => router.push('/schools' as any)}
              style={styles.switchBtn}
            >
              <Text style={styles.switchBtnText}>Switch ›</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
        {visibleItems.map((item) => (
          <TouchableOpacity
            key={item.route}
            style={[styles.card, { borderLeftColor: item.color }]}
            onPress={() => router.push(item.route as any)}
            activeOpacity={0.7}
          >
            <Text style={styles.cardIcon}>{item.icon}</Text>
            <Text style={styles.cardLabel}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#f8fafc' },
  header:          { padding: 20, paddingTop: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  title:           { fontSize: 24, fontWeight: '700', color: '#1e293b' },
  subtitle:        { fontSize: 14, color: '#64748b', marginTop: 2 },
  schoolPill:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  schoolPillText:  { fontSize: 12, color: '#4f46e5', fontWeight: '600' },
  rolePillText:    { fontSize: 11, color: '#9ca3af', textTransform: 'capitalize' },
  switchBtn:       { backgroundColor: '#eef2ff', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  switchBtnText:   { fontSize: 11, color: '#4f46e5', fontWeight: '700' },
  grid:            { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 12 },
  card:            {
    width: '47%', backgroundColor: '#fff', borderRadius: 12, padding: 16,
    borderLeftWidth: 4, shadowColor: '#000', shadowOpacity: 0.06,
    shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardIcon:        { fontSize: 28, marginBottom: 8 },
  cardLabel:       { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  // Onboarding
  onboardingWrap:  { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' },
  onboardingTitle: { fontSize: 20, fontWeight: '700', color: '#1e293b', textAlign: 'center', marginBottom: 8 },
  onboardingSub:   { fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 20 },
});
