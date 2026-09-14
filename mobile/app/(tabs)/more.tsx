/**
 * HALQA Mobile — More Tab
 * Overflow screen with access to all secondary features:
 * Explore, Chat, Communities, Notifications, Profile, Wallet, Settings, etc.
 */
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth.store';
import { useNotificationsStore } from '@/store/notifications.store';
import { getAvatarUrl } from '@/lib/avatar';

type MenuItem = {
  icon: string; label: string; route: string;
  badge?: number; color?: string;
};

type MenuGroup = { title: string; items: MenuItem[] };

export default function MoreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuthStore();
  const { unreadCount } = useNotificationsStore();

  const avatarUri = getAvatarUrl(user?.avatarUrl);
  const initials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`;

  const groups: MenuGroup[] = [
    {
      title: 'Social',
      items: [
        { icon: 'compass-outline',        label: 'Explore',        route: '/explore' },
        { icon: 'chatbubbles-outline',    label: 'Messages',       route: '/chat' },
        { icon: 'people-circle-outline',  label: 'Groups',         route: '/group-chat' },
        { icon: 'people-outline',         label: 'Communities',    route: '/communities' },
        { icon: 'notifications-outline',  label: 'Notifications',  route: '/notifications', badge: unreadCount },
        { icon: 'wallet-outline',         label: 'Wallet',         route: '/wallet' },
        { icon: 'sparkles-outline',       label: 'Creator',        route: '/creator' },
      ],
    },
    {
      title: 'Account',
      items: [
        { icon: 'person-outline',         label: 'Profile',        route: '/profile' },
        { icon: 'settings-outline',       label: 'Settings',       route: '/settings' },
        { icon: 'shield-outline',         label: 'Privacy',        route: '/settings' },
      ],
    },
    {
      title: 'Discover',
      items: [
        { icon: 'trophy-outline',         label: 'Leaderboard',    route: '/leaderboard' },
        { icon: 'storefront-outline',     label: 'Marketplace',    route: '/marketplace' },
      ],
    },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 80 + insets.bottom }}>
        {/* Header */}
        <View style={styles.header}>
          <Text allowFontScaling={false} style={styles.title}>More</Text>
        </View>

        {/* Profile banner */}
        <TouchableOpacity
          style={styles.profileBanner}
          onPress={() => router.push('/profile' as any)}
          activeOpacity={0.85}
        >
          <View style={styles.profileAvatar}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={{ width: 52, height: 52, borderRadius: 26 }} />
            ) : (
              <Text allowFontScaling={false} style={styles.profileInitials}>{initials}</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text allowFontScaling={false} style={styles.profileName}>
              {user?.firstName} {user?.lastName}
            </Text>
            <Text allowFontScaling={false} style={styles.profileRole}>
              {user?.role?.replace(/_/g, ' ').toLowerCase() ?? 'member'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#d1d5db" />
        </TouchableOpacity>

        {/* Menu groups */}
        {groups.map(group => (
          <View key={group.title} style={styles.group}>
            <Text allowFontScaling={false} style={styles.groupTitle}>{group.title}</Text>
            <View style={styles.groupCard}>
              {group.items.map((item, idx) => (
                <TouchableOpacity
                  key={item.route + item.label}
                  style={[
                    styles.menuItem,
                    idx < group.items.length - 1 && styles.menuItemBorder,
                  ]}
                  onPress={() => router.push(item.route as any)}
                  activeOpacity={0.7}
                >
                  <View style={styles.menuIconWrap}>
                    <Ionicons name={item.icon as any} size={20} color="#4f46e5" />
                  </View>
                  <Text allowFontScaling={false} style={styles.menuLabel}>{item.label}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {item.badge && item.badge > 0 ? (
                      <View style={styles.badge}>
                        <Text allowFontScaling={false} style={styles.badgeText}>
                          {item.badge > 99 ? '99+' : item.badge}
                        </Text>
                      </View>
                    ) : null}
                    <Ionicons name="chevron-forward" size={14} color="#d1d5db" />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* Logout */}
        <View style={styles.group}>
          <View style={styles.groupCard}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => logout()}
              activeOpacity={0.7}
            >
              <View style={[styles.menuIconWrap, { backgroundColor: '#fef2f2' }]}>
                <Ionicons name="log-out-outline" size={20} color="#ef4444" />
              </View>
              <Text allowFontScaling={false} style={[styles.menuLabel, { color: '#ef4444' }]}>
                Sign Out
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#f3f4f6' },
  header:          { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#f3f4f6' },
  title:           { fontSize: 22, fontWeight: '900', color: '#111827' },
  profileBanner:   { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#e5e7eb' },
  profileAvatar:   { width: 52, height: 52, borderRadius: 26, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  profileInitials: { fontSize: 18, fontWeight: '800', color: '#4f46e5' },
  profileName:     { fontSize: 16, fontWeight: '700', color: '#111827' },
  profileRole:     { fontSize: 12, color: '#9ca3af', marginTop: 1, textTransform: 'capitalize' },
  group:           { paddingHorizontal: 16, marginBottom: 12 },
  groupTitle:      { fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, paddingLeft: 4 },
  groupCard:       { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#e5e7eb' },
  menuItem:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  menuItemBorder:  { borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  menuIconWrap:    { width: 34, height: 34, borderRadius: 9, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  menuLabel:       { flex: 1, fontSize: 15, fontWeight: '500', color: '#111827' },
  badge:           { backgroundColor: '#ef4444', borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText:       { color: '#fff', fontSize: 10, fontWeight: '900' },
});
