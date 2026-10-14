/**
 * HALQA Mobile — Public Profile Screen
 * Shows another user's profile: posts, followers, following, follow button
 */
import React, { useCallback } from 'react';
import {
  View, Text, Image, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, FlatList, RefreshControl
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';
import { useAuthStore } from '@/store/auth.store';
import { formatDistanceToNow } from 'date-fns';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface UserProfile {
  id: string;
  name: string;
  username?: string;
  avatar?: string;
  bio?: string;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  friendsCount: number;
  isFollowing: boolean;
  /** Backend returns friendStatus enum, not a boolean isFriend */
  friendStatus: 'none' | 'pending_sent' | 'pending_received' | 'friends';
  role: string;
  createdAt: string;
}

interface PostMedia {
  url: string;
  type: string;
}

interface Post {
  id: string;
  /** API returns 'body', not 'content' */
  body: string;
  media?: PostMedia[];
  type: string;
  /** API returns nested _count object, not flat counters */
  _count: {
    reactions: number;
    comments: number;
  };
  createdAt: string;
}

// ─── Stat Box ──────────────────────────────────────────────────────────────────
function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Post Grid Item ────────────────────────────────────────────────────────────
function PostGridItem({ post, onPress }: { post: Post; onPress: () => void }) {
  // API returns media[] array; use first item's url if present
  const firstMediaUrl = post.media?.[0]?.url;
  return (
    <TouchableOpacity style={styles.gridItem} onPress={onPress}>
      {firstMediaUrl ? (
        <Image source={{ uri: firstMediaUrl }} style={styles.gridImage} />
      ) : (
        <View style={[styles.gridImage, styles.textPost]}>
          <Text numberOfLines={4} style={styles.textPostContent}>{post.body}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function PublicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuthStore();

  const isOwnProfile = currentUser?.id === id;

  // Fetch profile
  const { data: profile, isLoading, refetch, isRefetching } = useQuery<UserProfile>({
    queryKey: ['profile', id],
    queryFn: async () => {
      const [userRes, countsRes] = await Promise.all([
        api.get(`/users/${id}`),
        api.get(`/social/counts/${id}`),
      ]);
      const u = userRes.data.data;
      const c = countsRes.data.data ?? {};
      return {
        ...u,
        name: `${u.firstName} ${u.lastName}`.trim(),
        followersCount: c.followers ?? 0,
        followingCount: c.following ?? 0,
        postsCount: c.posts ?? 0,
        friendsCount: c.friends ?? 0,
        isFollowing: c.isFollowing ?? false,
        friendStatus: (c.friendStatus ?? 'none') as UserProfile['friendStatus'],
      } as UserProfile;
    },
    enabled: !!id,
  });

  // Fetch posts
  const { data: postsData } = useQuery<{ posts: Post[] }>({
    queryKey: ['user-posts', id],
    queryFn: async () => {
      const res = await api.get(`/posts/user/${id}?limit=12`);
      return { posts: res.data.data?.items ?? res.data.data ?? [] };
    },
    enabled: !!id,
  });

  // Follow / Unfollow
  const followMutation = useMutation({
    mutationFn: async () => {
      if (profile?.isFollowing) {
        await api.delete(`/social/follow/${id}`);
      } else {
        await api.post(`/social/follow/${id}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', id] });
    },
    onError: () => {
      showMessage({ message: 'Action failed. Please try again.', type: 'danger' });
    },
  });

  // Friend request — branches on friendStatus enum
  // friends        → DELETE /social/friends/:id       (remove friend)
  // pending_received → POST /social/friends/accept/:id (accept their request)
  // pending_sent   → DELETE /social/friends/request/:id (cancel own request)
  // none           → POST /social/friends/request/:id  (send request)
  const friendMutation = useMutation({
    mutationFn: async () => {
      const status = profile?.friendStatus ?? 'none';
      if (status === 'friends') {
        await api.delete(`/social/friends/${id}`);
      } else if (status === 'pending_received') {
        await api.post(`/social/friends/accept/${id}`);
      } else if (status === 'pending_sent') {
        await api.delete(`/social/friends/request/${id}`);
      } else {
        await api.post(`/social/friends/request/${id}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', id] });
      const status = profile?.friendStatus ?? 'none';
      const msg =
        status === 'friends' ? 'Friend removed' :
        status === 'pending_received' ? 'Friend request accepted!' :
        status === 'pending_sent' ? 'Request cancelled' :
        'Friend request sent!';
      showMessage({ message: msg, type: 'success' });
    },
    onError: () => showMessage({ message: 'Action failed', type: 'danger' }),
  });

  // DM
  const handleDm = useCallback(async () => {    try {
      const res = await api.get(`/dm/conversations/${id}/with`);
      const convId = res.data.data?.id;
      if (convId) router.push(`/dm/${convId}`);
    } catch {
      showMessage({ message: 'Could not open chat.', type: 'danger' });
    }
  }, [id, router]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>User not found</Text>
      </View>
    );
  }

  const posts = postsData?.posts ?? [];

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: profile.name,
          headerBackTitle: 'Back',
          headerTintColor: '#4f46e5',
        }}
      />
      <ScrollView
        style={styles.container}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <Image source={{ uri: avatarUrl(profile.avatar, profile.name) }} style={styles.avatar} />
          <View style={styles.headerInfo}>
            <Text style={styles.name}>{profile.name}</Text>
            {profile.username && <Text style={styles.username}>@{profile.username}</Text>}
            <Text style={styles.role}>{profile.role}</Text>
          </View>
        </View>

        {/* Bio */}
        {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatBox label="Posts" value={profile.postsCount} />
          <StatBox label="Followers" value={profile.followersCount} />
          <StatBox label="Following" value={profile.followingCount} />
          <StatBox label="Friends" value={profile.friendsCount} />
        </View>

        {/* Action buttons */}
        {!isOwnProfile && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, profile.isFollowing ? styles.btnSecondary : styles.btnPrimary]}
              onPress={() => followMutation.mutate()}
              disabled={followMutation.isPending}
            >
              {followMutation.isPending
                ? <ActivityIndicator size="small" color={profile.isFollowing ? '#4f46e5' : '#fff'} />
                : <Text style={profile.isFollowing ? styles.btnSecondaryText : styles.btnPrimaryText}>
                    {profile.isFollowing ? 'Unfollow' : 'Follow'}
                  </Text>
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.btn,
                profile.friendStatus === 'friends' ? styles.btnSecondary :
                profile.friendStatus === 'pending_sent' ? styles.btnPending :
                profile.friendStatus === 'pending_received' ? styles.btnFriend :
                styles.btnFriend,
              ]}
              onPress={() => friendMutation.mutate()}
              disabled={friendMutation.isPending}
            >
              {friendMutation.isPending
                ? <ActivityIndicator size="small" color={profile.friendStatus === 'friends' ? '#4f46e5' : '#fff'} />
                : (() => {
                    const fs = profile.friendStatus;
                    if (fs === 'friends') return (
                      <>
                        <Ionicons name="person-remove-outline" size={14} color="#4f46e5" />
                        <Text style={[{ marginLeft: 4, fontSize: 13, fontWeight: '600' }, styles.btnSecondaryText]}>Friends</Text>
                      </>
                    );
                    if (fs === 'pending_sent') return (
                      <>
                        <Ionicons name="time-outline" size={14} color="#6b7280" />
                        <Text style={[{ marginLeft: 4, fontSize: 13, fontWeight: '600' }, styles.btnPendingText]}>Pending (cancel)</Text>
                      </>
                    );
                    if (fs === 'pending_received') return (
                      <>
                        <Ionicons name="checkmark-outline" size={14} color="#fff" />
                        <Text style={{ marginLeft: 4, fontSize: 13, fontWeight: '600', color: '#fff' }}>Accept Request</Text>
                      </>
                    );
                    return (
                      <>
                        <Ionicons name="person-add-outline" size={14} color="#fff" />
                        <Text style={{ marginLeft: 4, fontSize: 13, fontWeight: '600', color: '#fff' }}>Add Friend</Text>
                      </>
                    );
                  })()
              }
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnSecondary, { flex: 0, paddingHorizontal: 14 }]} onPress={handleDm}>
              <Ionicons name="chatbubble-outline" size={18} color="#4f46e5" />
            </TouchableOpacity>
          </View>
        )}
        {isOwnProfile && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary, { flex: 1 }]}
              onPress={() => router.push('/settings')}
            >
              <Text style={styles.btnSecondaryText}>Edit Profile</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Posts Grid */}
        <Text style={styles.sectionTitle}>Posts</Text>
        {posts.length === 0 ? (
          <Text style={styles.emptyText}>No posts yet</Text>
        ) : (
          <View style={styles.grid}>
            {posts.map(post => (
              <PostGridItem
                key={post.id}
                post={post}
                onPress={() => router.push(`/post/${post.id}`)}
              />
            ))}
          </View>
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#6b7280', fontSize: 16 },
  header: { flexDirection: 'row', padding: 16, alignItems: 'center', backgroundColor: '#fff' },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#e5e7eb' },
  headerInfo: { marginLeft: 16, flex: 1 },
  name: { fontSize: 20, fontWeight: '700', color: '#111827' },
  username: { fontSize: 14, color: '#6b7280', marginTop: 2 },
  role: { fontSize: 12, color: '#4f46e5', marginTop: 4, textTransform: 'capitalize' },
  bio: { paddingHorizontal: 16, paddingVertical: 8, color: '#374151', backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#f3f4f6' },
  statsRow: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#f3f4f6', marginTop: 1 },
  statBox: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  statValue: { fontSize: 18, fontWeight: '700', color: '#111827' },
  statLabel: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: '#fff' },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 8 },
  btnPrimary: { backgroundColor: '#4f46e5' },
  btnPrimaryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  btnSecondary: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#4f46e5' },
  btnSecondaryText: { color: '#4f46e5', fontWeight: '600', fontSize: 14 },
  btnFriend: { backgroundColor: '#10b981', borderWidth: 0 },
  btnPending: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#d1d5db' },
  btnPendingText: { color: '#6b7280', fontWeight: '600', fontSize: 14 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111827', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  emptyText: { textAlign: 'center', color: '#9ca3af', paddingVertical: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 },
  gridItem: { width: '33.33%', padding: 2 },
  gridImage: { width: '100%', aspectRatio: 1, borderRadius: 4, backgroundColor: '#e5e7eb' },
  textPost: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#ede9fe', padding: 8 },
  textPostContent: { fontSize: 11, color: '#374151', textAlign: 'center' },
});

