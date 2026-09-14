/**
 * HALQA Mobile — My School Tab
 * Shows the user's school memberships and quick links to education features.
 * Mirrors the website's /school-memberships page.
 */
import { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Image, RefreshControl, ScrollView,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import api from '@/lib/api';
import { getAvatarUrl } from '@/lib/avatar';

type Membership = {
  id: string;
  role: string;
  status: string;
  school: {
    id: string; name: string; slug: string;
    logoUrl: string | null; type: string; city: string | null; country: string;
  };
};

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  SCHOOL_ADMIN: { bg: '#f3e8ff', text: '#7e22ce' },
  TEACHER:      { bg: '#dcfce7', text: '#15803d' },
  STUDENT:      { bg: '#dbeafe', text: '#1d4ed8' },
  GUARDIAN:     { bg: '#ffedd5', text: '#c2410c' },
};

const QUICK_LINKS = [
  { icon: 'people-outline',      label: 'Students',   route: '/students' },
  { icon: 'calendar-outline',    label: 'Attendance', route: '/attendance' },
  { icon: 'school-outline',      label: 'Classes',    route: '/classes' },
  { icon: 'trophy-outline',      label: 'Grades',     route: '/grades' },
  { icon: 'megaphone-outline',   label: 'Notices',    route: '/announcements' },
  { icon: 'videocam-outline',    label: 'Live Class', route: '/live-class' },
  { icon: 'calendar-clear-outline', label: 'Calendar', route: '/calendar' },
  { icon: 'bar-chart-outline',   label: 'Reports',    route: '/reports' },
  { icon: 'card-outline',        label: 'My ID Card', route: '/student-id-card' },
];

function SchoolCard({ membership, onPress }: { membership: Membership; onPress: () => void }) {
  const roleColor = ROLE_COLORS[membership.role] ?? { bg: '#f3f4f6', text: '#374151' };
  const logoUri = getAvatarUrl(membership.school.logoUrl);
  const isActive = membership.status === 'ACTIVE';

  return (
    <TouchableOpacity style={[styles.card, !isActive && styles.cardPending]} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.cardLeft}>
        {logoUri ? (
          <Image source={{ uri: logoUri }} style={styles.schoolLogo} />
        ) : (
          <View style={styles.schoolLogoFallback}>
            <Ionicons name="school" size={20} color="#4f46e5" />
          </View>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text allowFontScaling={false} style={styles.schoolName} numberOfLines={1}>
          {membership.school.name}
        </Text>
        <Text allowFontScaling={false} style={styles.schoolMeta}>
          {membership.school.type} {membership.school.city ? `· ${membership.school.city}` : ''}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
          <View style={[styles.rolePill, { backgroundColor: roleColor.bg }]}>
            <Text allowFontScaling={false} style={[styles.rolePillText, { color: roleColor.text }]}>
              {membership.role.replace(/_/g, ' ')}
            </Text>
          </View>
          {!isActive && (
            <View style={styles.pendingPill}>
              <Text allowFontScaling={false} style={styles.pendingText}>⏳ Pending</Text>
            </View>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
    </TouchableOpacity>
  );
}

export default function MySchoolScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: memberships = [], isLoading, refetch, isRefetching } = useQuery<Membership[]>({
    queryKey: ['school-memberships-mobile'],
    queryFn: () => api.get('/school-memberships/mine').then(r => {
      const d = r.data.data;
      return Array.isArray(d) ? d : (d?.memberships ?? []);
    }),
    staleTime: 60_000,
  });

  const activeMemberships = memberships.filter(m => m.status === 'ACTIVE');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 80 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#4f46e5" />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text allowFontScaling={false} style={styles.title}>My School</Text>
            <Text allowFontScaling={false} style={styles.subtitle}>
              {activeMemberships.length} active membership{activeMemberships.length !== 1 ? 's' : ''}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.joinBtn}
            onPress={() => router.push('/schools' as any)}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text allowFontScaling={false} style={styles.joinBtnText}>Join School</Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#4f46e5" />
          </View>
        ) : memberships.length === 0 ? (
          /* No schools — onboarding */
          <View style={styles.emptyContainer}>
            <Ionicons name="school-outline" size={64} color="#d1d5db" />
            <Text allowFontScaling={false} style={styles.emptyTitle}>No school yet</Text>
            <Text allowFontScaling={false} style={styles.emptySub}>
              Join a school to access attendance, grades, classes and more.
            </Text>
            <View style={{ gap: 10, width: '100%', paddingHorizontal: 32, marginTop: 16 }}>
              <TouchableOpacity
                style={styles.cta}
                onPress={() => router.push('/schools' as any)}
              >
                <Ionicons name="search-outline" size={18} color="#fff" />
                <Text allowFontScaling={false} style={styles.ctaText}>Browse Schools</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.cta, { backgroundColor: '#f3f4f6' }]}
                onPress={() => router.push('/create-school' as any)}
              >
                <Ionicons name="add-circle-outline" size={18} color="#4f46e5" />
                <Text allowFontScaling={false} style={[styles.ctaText, { color: '#4f46e5' }]}>Create a School</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            {/* School cards */}
            <View style={styles.section}>
              <Text allowFontScaling={false} style={styles.sectionTitle}>Your Schools</Text>
              {memberships.map(m => (
                <SchoolCard
                  key={m.id}
                  membership={m}
                  onPress={() => router.push('/education' as any)}
                />
              ))}
            </View>

            {/* Quick links — only shown when at least one active membership */}
            {activeMemberships.length > 0 && (
              <View style={styles.section}>
                <Text allowFontScaling={false} style={styles.sectionTitle}>Quick Access</Text>
                <View style={styles.quickGrid}>
                  {QUICK_LINKS.map(link => (
                    <TouchableOpacity
                      key={link.route}
                      style={styles.quickItem}
                      onPress={() => router.push(link.route as any)}
                      activeOpacity={0.75}
                    >
                      <View style={styles.quickIcon}>
                        <Ionicons name={link.icon as any} size={22} color="#4f46e5" />
                      </View>
                      <Text allowFontScaling={false} style={styles.quickLabel} numberOfLines={1}>
                        {link.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: '#f9fafb' },
  header:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  title:             { fontSize: 22, fontWeight: '900', color: '#111827' },
  subtitle:          { fontSize: 12, color: '#9ca3af', marginTop: 1 },
  joinBtn:           { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#4f46e5', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  joinBtnText:       { color: '#fff', fontWeight: '700', fontSize: 13 },
  center:            { paddingTop: 60, alignItems: 'center' },
  section:           { paddingHorizontal: 16, paddingTop: 16 },
  sectionTitle:      { fontSize: 12, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  card:              { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  cardPending:       { borderColor: '#fde68a', backgroundColor: '#fffbeb' },
  cardLeft:          { flexShrink: 0 },
  schoolLogo:        { width: 48, height: 48, borderRadius: 12, backgroundColor: '#ede9fe' },
  schoolLogoFallback:{ width: 48, height: 48, borderRadius: 12, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center' },
  schoolName:        { fontSize: 15, fontWeight: '700', color: '#111827' },
  schoolMeta:        { fontSize: 12, color: '#9ca3af', marginTop: 1, textTransform: 'capitalize' },
  rolePill:          { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  rolePillText:      { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  pendingPill:       { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: '#fef3c7' },
  pendingText:       { fontSize: 10, fontWeight: '700', color: '#92400e' },
  quickGrid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickItem:         { width: '22%', alignItems: 'center', gap: 6 },
  quickIcon:         { width: 52, height: 52, borderRadius: 14, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center' },
  quickLabel:        { fontSize: 11, fontWeight: '600', color: '#374151', textAlign: 'center' },
  emptyContainer:    { alignItems: 'center', paddingTop: 60, paddingHorizontal: 24 },
  emptyTitle:        { fontSize: 20, fontWeight: '700', color: '#374151', marginTop: 16 },
  emptySub:          { fontSize: 14, color: '#9ca3af', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  cta:               { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#4f46e5', paddingVertical: 14, borderRadius: 14 },
  ctaText:           { color: '#fff', fontWeight: '700', fontSize: 15 },
});
