/**
 * HALQA Mobile — Public Profile Screen
 * Shows another user's profile: posts, followers, following, follow button
 */
import React, { useCallback } from 'react';
import {
  View, Text, Image, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, FlatList, RefreshControl,
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
  isFollowing: boolean;
  isFriend: boolean;
  role: string;
  createdAt: string;
}

interface Post {
  id: string;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
  likesCount: number;
  commentsCount: number;
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
  return (
    <TouchableOpacity style={styles.gridItem} onPress={onPress}>
      {post.mediaUrl ? (
        <Image source={{ uri: post.mediaUrl }} style={styles.gridImage} />
      ) : (
        <View style={[styles.gridImage, styles.textPost]}>
          <Text numberOfLines={4} style={styles.textPostContent}>{post.content}</Text>
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
        isFollowing: c.isFollowing ?? false,
        isFriend: c.isFriend ?? false,
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

  // Friend request
  const friendMutation = useMutation({
    mutationFn: async () => {
      if (profile?.isFriend) {
        await api.delete(`/social/friends/${id}`);
      } else {
        await api.post(`/social/friends/request/${id}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', id] });
      showMessage({ message: profile?.isFriend ? 'Friend removed' : 'Friend request sent!', type: 'success' });
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
              style={[styles.btn, profile.isFriend ? styles.btnSecondary : styles.btnFriend]}
              onPress={() => friendMutation.mutate()}
              disabled={friendMutation.isPending}
            >
              {friendMutation.isPending
                ? <ActivityIndicator size="small" color="#fff" />
                : <>
                    <Ionicons name={profile.isFriend ? 'person-remove-outline' : 'person-add-outline'} size={14} color={profile.isFriend ? '#4f46e5' : '#fff'} />
                    <Text style={[{ marginLeft: 4, fontSize: 13, fontWeight: '600' }, profile.isFriend ? styles.btnSecondaryText : { color: '#fff' }]}>
                      {profile.isFriend ? 'Friends' : 'Add Friend'}
                    </Text>
                  </>
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
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111827', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  emptyText: { textAlign: 'center', color: '#9ca3af', paddingVertical: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 },
  gridItem: { width: '33.33%', padding: 2 },
  gridImage: { width: '100%', aspectRatio: 1, borderRadius: 4, backgroundColor: '#e5e7eb' },
  textPost: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#ede9fe', padding: 8 },
  textPostContent: { fontSize: 11, color: '#374151', textAlign: 'center' },
});
