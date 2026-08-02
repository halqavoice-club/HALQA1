/**
 * HALQA Mobile — Profile Screen (own profile)
 */
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '@/lib/api';
import { getBaseURL } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuthStore();

  const { data: counts } = useQuery({
    queryKey: ['social-counts', user?.id],
    queryFn: () => api.get(`/social/counts/${user?.id}`).then(r => r.data.data),
    enabled: !!user?.id,
  });

  const { data: wallet } = useQuery({
    queryKey: ['wallet-me'],
    queryFn: () => api.get('/wallet/me').then(r => r.data.data),
  });

  const initials = user ? `${user.firstName[0]}${user.lastName[0]}` : '?';
  const BASE = getBaseURL().replace('/api/v1', '');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text allowFontScaling={false} style={styles.title}>Profile</Text>
        <TouchableOpacity onPress={() => router.push('/settings' as any)}>
          <Ionicons name="settings-outline" size={24} color="#374151" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 80 + insets.bottom }}>
        {/* Profile card */}
        <View style={styles.card}>
          {/* Avatar */}
          <View style={styles.avatarArea}>
            {user?.avatarUrl ? (
              <Image source={{ uri: BASE + user.avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text allowFontScaling={false} style={styles.avatarText}>{initials}</Text>
              </View>
            )}
            <TouchableOpacity style={styles.editAvatarBtn}>
              <Ionicons name="camera-outline" size={14} color="#fff" />
            </TouchableOpacity>
          </View>

          <Text allowFontScaling={false} style={styles.name}>{user?.firstName} {user?.lastName}</Text>
          <Text allowFontScaling={false} style={styles.role}>{user?.role?.replace(/_/g, ' ').toLowerCase()}</Text>

          {/* Social stats — tap to navigate */}
          <View style={styles.statsRow}>
            {[
              { label: 'Followers', value: counts?.followers ?? 0, href: '/followers' },
              { label: 'Following', value: counts?.following ?? 0, href: '/following' },
              { label: 'Friends',   value: counts?.friends   ?? 0, href: '/friends'   },
            ].map(s => (
              <TouchableOpacity key={s.label} style={styles.stat} onPress={() => router.push(s.href as any)}>
                <Text allowFontScaling={false} style={styles.statValue}>{s.value.toLocaleString()}</Text>
                <Text allowFontScaling={false} style={styles.statLabel}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Action buttons */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/settings' as any)}>
              <Ionicons name="create-outline" size={16} color="#4f46e5" />
              <Text allowFontScaling={false} style={styles.actionBtnText}>Edit Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/(tabs)/wallet' as any)}>
              <Text allowFontScaling={false} style={{ fontSize: 16 }}>🪙</Text>
              <Text allowFontScaling={false} style={styles.actionBtnText}>{(wallet?.coins || 0).toLocaleString()} coins</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Quick links */}
        <View style={styles.section}>
          {[
            { icon: 'newspaper-outline',   label: 'My Posts',         href: `/profile/${user?.id}` },
            { icon: 'bookmark-outline',    label: 'Saved Posts',      href: '/bookmarks'              },
            { icon: 'mail-outline',        label: 'Messages',         href: '/messages'               },
            { icon: 'people-outline',      label: 'Communities',      href: '/(tabs)/communities'     },
            { icon: 'person-add-outline',  label: 'Friend Requests',  href: '/friend-requests'        },
            { icon: 'trophy-outline',    label: 'Leaderboard',      href: '/leaderboard'            },
            { icon: 'calendar-outline',  label: 'Calendar',         href: '/calendar'               },
            { icon: 'document-text-outline', label: 'Notes',        href: '/notes'                  },
            { icon: 'sparkles-outline',  label: 'Creator Studio',   href: '/creator'                },
            { icon: 'wallet-outline',    label: 'Wallet',           href: '/(tabs)/wallet'          },
            { icon: 'headset-outline',   label: 'Audio Lessons',    href: '/audio'                  },
            { icon: 'qr-code-outline',   label: 'QR Check-in',      href: '/qr-checkin'             },
            { icon: 'notifications-outline', label: 'Notifications',href: '/(tabs)/notifications'   },
            { icon: 'school-outline',    label: 'Education',        href: '/education'              },
            { icon: 'settings-outline',  label: 'Settings',         href: '/settings'               },
          ].map(item => (
            <TouchableOpacity key={item.label} style={styles.listItem} onPress={() => router.push(item.href as any)}>
              <Ionicons name={item.icon as any} size={22} color="#6b7280" />
              <Text allowFontScaling={false} style={styles.listLabel}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
            </TouchableOpacity>
          ))}
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Ionicons name="log-out-outline" size={20} color="#ef4444" />
          <Text allowFontScaling={false} style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#f9fafb' },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  title:         { fontSize: 22, fontWeight: '900', color: '#111827' },
  card:          { backgroundColor: '#fff', margin: 12, borderRadius: 20, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: '#f3f4f6' },
  avatarArea:    { position: 'relative', marginBottom: 12 },
  avatar:        { width: 80, height: 80, borderRadius: 40 },
  avatarPlaceholder: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center' },
  avatarText:    { fontSize: 28, fontWeight: '900', color: '#4f46e5' },
  editAvatarBtn: { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#4f46e5', borderRadius: 12, width: 24, height: 24, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#fff' },
  name:          { fontSize: 20, fontWeight: '900', color: '#111827' },
  role:          { fontSize: 13, color: '#9ca3af', textTransform: 'capitalize', marginTop: 2 },
  statsRow:      { flexDirection: 'row', marginTop: 20, gap: 32 },
  stat:          { alignItems: 'center' },
  statValue:     { fontSize: 20, fontWeight: '900', color: '#111827' },
  statLabel:     { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  actions:       { flexDirection: 'row', gap: 12, marginTop: 20, width: '100%' },
  actionBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, paddingVertical: 10 },
  actionBtnText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  section:       { backgroundColor: '#fff', marginHorizontal: 12, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#f3f4f6' },
  listItem:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  listLabel:     { flex: 1, fontSize: 15, color: '#374151', fontWeight: '500' },
  logoutBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, margin: 12, paddingVertical: 14, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#fee2e2' },
  logoutText:    { fontSize: 15, fontWeight: '700', color: '#ef4444' },
});
