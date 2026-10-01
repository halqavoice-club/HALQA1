/**
 * HALQA Mobile — Bottom Tab Navigator
 * Tabs: Feed | Voice | Live | Friend | My School | More
 * Fixed: uses useSafeAreaInsets for dynamic bottom padding
 * Fixed: disables system font scaling on tab labels
 */
import { Tabs, Redirect } from 'expo-router';
import { useAuthStore } from '@/store/auth.store';
import { useVoiceStore } from '@/store/voice.store';
import { useNotificationsStore } from '@/store/notifications.store';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '@/lib/api';

function TabIcon({ name, focused, badge, liveIndicator }: { name: any; focused: boolean; badge?: number; liveIndicator?: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <View>
        <Ionicons name={name} size={22} color={focused ? '#4f46e5' : '#9ca3af'} />
        {badge && badge > 0 ? (
          <View style={styles.badge}>
            <Text allowFontScaling={false} style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        ) : null}
        {/* Pulsing green dot when user is live in a voice room */}
        {liveIndicator && (
          <View style={styles.liveDot} />
        )}
      </View>
    </View>
  );
}

export default function TabLayout() {
  const { isAuthenticated } = useAuthStore();
  const { activeRoomId } = useVoiceStore();
  const { unreadCount: notifBadge } = useNotificationsStore();
  // Friend request pending count — lightweight poll every 60s
  const { data: friendRequestsData } = useQuery({
    queryKey: ['friend-requests-count'],
    queryFn: () => api.get('/social/requests/pending').then(r => {
      const data = r.data.data;
      return Array.isArray(data) ? data.length : (data?.count ?? 0);
    }),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const friendBadge: number = friendRequestsData ?? 0;
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  // Live class badge: count currently-live classes from cache (no extra fetch)
  const cachedClasses: any[] = (queryClient.getQueryData(['live-classes']) as any[]) || [];
  const liveClassCount = cachedClasses.filter((c: any) => c.status === 'LIVE').length;

  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;

  // Calculate tab bar height: base 52px + system bottom inset (gesture nav / home indicator)
  const tabBarHeight = 52 + insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#4f46e5',
        tabBarInactiveTintColor: '#9ca3af',
        tabBarAllowFontScaling: false,
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#f3f4f6',
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingBottom: insets.bottom > 0 ? insets.bottom : 4,
          paddingTop: 6,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          marginTop: -2,
        },
        tabBarItemStyle: {
          paddingTop: 4,
        },
      }}
    >
      {/* ── Primary visible tabs: Feed | Voice | Live | Friend | My School | More ── */}
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          tabBarIcon: ({ focused }) => <TabIcon name={focused ? 'newspaper' : 'newspaper-outline'} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="voice"
        options={{
          title: 'Voice',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              name={focused ? 'radio' : 'radio-outline'}
              focused={focused}
              liveIndicator={!!activeRoomId}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="live-class"
        options={{
          title: 'Live',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              name={focused ? 'videocam' : 'videocam-outline'}
              focused={focused}
              badge={liveClassCount > 0 ? liveClassCount : undefined}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="friend"
        options={{
          title: 'Friend',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              name={focused ? 'people' : 'people-outline'}
              focused={focused}
              badge={friendBadge > 0 ? friendBadge : undefined}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="my-school"
        options={{
          title: 'My School',
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? 'school' : 'school-outline'} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              name={focused ? 'ellipsis-horizontal-circle' : 'ellipsis-horizontal-circle-outline'}
              focused={focused}
              badge={notifBadge > 0 ? notifBadge : undefined}
            />
          ),
        }}
      />

      {/* ── Hidden tabs — navigated to programmatically or from More screen ── */}
      <Tabs.Screen name="explore"       options={{ href: null }} />
      <Tabs.Screen name="chat"          options={{ href: null }} />
      <Tabs.Screen name="communities"   options={{ href: null }} />
      <Tabs.Screen name="wallet"        options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="profile"       options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute', top: -4, right: -8,
    backgroundColor: '#ef4444', borderRadius: 8,
    minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  // Green pulsing dot shown on the Voice tab icon when user is in an active room
  liveDot: {
    position: 'absolute', top: -3, right: -5,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#22c55e',
    borderWidth: 1.5, borderColor: '#fff',
  },
});

function TabIcon({ name, focused, badge, liveIndicator }: { name: any; focused: boolean; badge?: number; liveIndicator?: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <View>
        <Ionicons name={name} size={22} color={focused ? '#4f46e5' : '#9ca3af'} />
        {badge && badge > 0 ? (
          <View style={styles.badge}>
            <Text allowFontScaling={false} style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        ) : null}
        {/* Pulsing green dot when user is live in a voice room */}
        {liveIndicator && (
          <View style={styles.liveDot} />
        )}
      </View>
    </View>
  );
}

export default function TabLayout() {
  const { isAuthenticated } = useAuthStore();
  const { activeRoomId } = useVoiceStore();
  const { unreadCount: notifBadge } = useNotificationsStore();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  // Live class badge: count currently-live classes from cache (no extra fetch)
  const cachedClasses: any[] = (queryClient.getQueryData(['live-classes']) as any[]) || [];
  const liveClassCount = cachedClasses.filter((c: any) => c.status === 'LIVE').length;

  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;

  // Calculate tab bar height: base 52px + system bottom inset (gesture nav / home indicator)
  const tabBarHeight = 52 + insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#4f46e5',
        tabBarInactiveTintColor: '#9ca3af',
        tabBarAllowFontScaling: false,
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#f3f4f6',
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingBottom: insets.bottom > 0 ? insets.bottom : 4,
          paddingTop: 6,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          marginTop: -2,
        },
        tabBarItemStyle: {
          paddingTop: 4,
        },
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          tabBarIcon: ({ focused }) => <TabIcon name={focused ? 'home' : 'home-outline'} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: ({ focused }) => <TabIcon name={focused ? 'compass' : 'compass-outline'} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="voice"
        options={{
          title: 'Voice',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              name={focused ? 'radio' : 'radio-outline'}
              focused={focused}
              liveIndicator={!!activeRoomId}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              name={focused ? 'chatbubbles' : 'chatbubbles-outline'}
              focused={focused}
              badge={notifBadge > 0 ? notifBadge : undefined}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="live-class"
        options={{
          title: 'Classes',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              name={focused ? 'videocam' : 'videocam-outline'}
              focused={focused}
              badge={liveClassCount > 0 ? liveClassCount : undefined}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <TabIcon name={focused ? 'person' : 'person-outline'} focused={focused} />,
        }}
      />
      {/* Hidden tabs — navigated to programmatically */}
      <Tabs.Screen name="communities"   options={{ href: null }} />
      <Tabs.Screen name="wallet"        options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute', top: -4, right: -8,
    backgroundColor: '#ef4444', borderRadius: 8,
    minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  // Green pulsing dot shown on the Voice tab icon when user is in an active room
  liveDot: {
    position: 'absolute', top: -3, right: -5,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#22c55e',
    borderWidth: 1.5, borderColor: '#fff',
  },
});
