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

interface MenuItem {
  icon: string;
  label: string;
  route: string;
  roles: string[];
  color: string;
}

const MENU_ITEMS: MenuItem[] = [
  { icon: '📋', label: 'Attendance',    route: '/education/attendance',   roles: ['STUDENT','TEACHER','SCHOOL_ADMIN','GUARDIAN'], color: '#6366f1' },
  { icon: '📊', label: 'Grades',        route: '/education/grades',       roles: ['STUDENT','TEACHER','SCHOOL_ADMIN','GUARDIAN'], color: '#0ea5e9' },
  { icon: '📝', label: 'Assignments',   route: '/education/assignments',  roles: ['STUDENT','TEACHER','SCHOOL_ADMIN'],             color: '#4f46e5' },
  { icon: '📄', label: 'Exams',         route: '/education/assignments',  roles: ['STUDENT','TEACHER','SCHOOL_ADMIN'],             color: '#7c3aed' },
  { icon: '🌟', label: 'Behavior',      route: '/education/behavior',     roles: ['STUDENT','TEACHER','SCHOOL_ADMIN','GUARDIAN'], color: '#f59e0b' },
  { icon: '💳', label: 'Fees',          route: '/education/fees',         roles: ['SCHOOL_ADMIN','GUARDIAN'],                    color: '#10b981' },
  { icon: '📅', label: 'Schedule',      route: '/education/schedule',     roles: ['STUDENT','TEACHER','SCHOOL_ADMIN','GUARDIAN'], color: '#8b5cf6' },
  { icon: '📚', label: 'Library',       route: '/education/library',      roles: ['STUDENT','TEACHER','SCHOOL_ADMIN'],            color: '#ec4899' },
  { icon: '📢', label: 'Announcements', route: '/education/announcements',roles: ['STUDENT','TEACHER','SCHOOL_ADMIN','GUARDIAN'], color: '#ef4444' },
  { icon: '📁', label: 'Reports',       route: '/education/reports',      roles: ['TEACHER','SCHOOL_ADMIN'],                     color: '#64748b' },
  { icon: '🎵', label: 'Audio Lessons', route: '/audio',                  roles: ['STUDENT','TEACHER','SCHOOL_ADMIN'],            color: '#8b5cf6' },
  { icon: '📱', label: 'QR Check-in',   route: '/qr-checkin',             roles: ['STUDENT','TEACHER','SCHOOL_ADMIN'],            color: '#0ea5e9' },
  { icon: '📝', label: 'Notes',         route: '/notes',                  roles: ['STUDENT','TEACHER','SCHOOL_ADMIN'],            color: '#f59e0b' },
  { icon: '🗓️', label: 'Calendar',      route: '/calendar',               roles: ['STUDENT','TEACHER','SCHOOL_ADMIN','GUARDIAN'], color: '#6366f1' },
  { icon: '🏆', label: 'Leaderboard',   route: '/leaderboard',            roles: ['STUDENT','TEACHER','SCHOOL_ADMIN'],            color: '#f59e0b' },
];

export default function EducationScreen() {
  const { user } = useAuthStore();
  if (!user) return null;

  const visibleItems = MENU_ITEMS.filter(item => item.roles.includes(user.role));

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ title: 'Education', headerShown: true, headerTintColor: '#4f46e5' }} />
      <View style={styles.header}>
        <Text style={styles.title}>Education</Text>
        <Text style={styles.subtitle}>
          {user.role === 'STUDENT' ? 'Your academic portal' :
           user.role === 'TEACHER' ? 'Class management' :
           user.role === 'GUARDIAN' ? "Your child's progress" :
           'School administration'}
        </Text>
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
  container:  { flex: 1, backgroundColor: '#f8fafc' },
  header:     { padding: 20, paddingTop: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  title:      { fontSize: 24, fontWeight: '700', color: '#1e293b' },
  subtitle:   { fontSize: 14, color: '#64748b', marginTop: 2 },
  grid:       { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 12 },
  card:       {
    width: '47%', backgroundColor: '#fff', borderRadius: 12, padding: 16,
    borderLeftWidth: 4, shadowColor: '#000', shadowOpacity: 0.06,
    shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardIcon:   { fontSize: 28, marginBottom: 8 },
  cardLabel:  { fontSize: 15, fontWeight: '600', color: '#1e293b' },
});
