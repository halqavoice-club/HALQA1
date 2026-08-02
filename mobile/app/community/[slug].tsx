/**
 * HALQA Mobile — Community Detail Screen
 * Shows community info, members count, posts feed, join/leave
 */
import React, { useState } from 'react';
import {
  View, Text, Image, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery, useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';
import { formatDistanceToNow } from 'date-fns';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Community {
  id: string;
  name: string;
  slug: string;
  description?: string;
  coverImage?: string;
  avatar?: string;
  membersCount: number;
  postsCount: number;
  isMember: boolean;
  privacy: 'PUBLIC' | 'PRIVATE';
  category?: string;
  createdAt: string;
}

interface Post {
  id: string;
  content: string;
  mediaUrl?: string;
  author: { id: string; name: string; avatar?: string };
  likesCount: number;
  commentsCount: number;
  isLiked: boolean;
  createdAt: string;
}

// ─── Post Item ──────────────────────────────────────────────────────────────────
function CommunityPost({ post }: { post: Post }) {
  const router = useRouter();
  return (
    <TouchableOpacity style={styles.postCard} onPress={() => router.push(`/post/${post.id}`)}>
      <View style={styles.postAuthorRow}>
        <Image source={{ uri: avatarUrl(post.author.avatar, post.author.name) }} style={styles.postAvatar} />
        <View style={{ flex: 1 }}>
          <Text style={styles.postAuthorName}>{post.author.name}</Text>
          <Text style={styles.postTime}>{formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}</Text>
        </View>
      </View>
      <Text style={styles.postContent} numberOfLines={3}>{post.content}</Text>
      {post.mediaUrl && (
        <Image source={{ uri: post.mediaUrl }} style={styles.postMedia} resizeMode="cover" />
      )}
      <View style={styles.postMeta}>
        <View style={styles.postStat}>
          <Ionicons name={post.isLiked ? 'heart' : 'heart-outline'} size={16} color={post.isLiked ? '#ef4444' : '#9ca3af'} />
          <Text style={styles.postStatText}>{post.likesCount}</Text>
        </View>
        <View style={styles.postStat}>
          <Ionicons name="chatbubble-outline" size={16} color="#9ca3af" />
          <Text style={styles.postStatText}>{post.commentsCount}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function CommunityDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Fetch community
  const { data: community, isLoading, refetch, isRefetching } = useQuery<Community>({
    queryKey: ['community', slug],
    queryFn: async () => {
      const res = await api.get(`/communities/${slug}`);
      const c = res.data.data;
      // Normalize field names
      return {
        ...c,
        membersCount: c.membersCount ?? c._count?.members ?? c.memberCount ?? 0,
        postsCount: c.postsCount ?? c._count?.posts ?? 0,
        isMember: c.isMember ?? (c.myRole != null),
      } as Community;
    },
    enabled: !!slug,
  });

  // Fetch posts
  const {
    data: postsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['community-posts', slug],
    queryFn: async ({ pageParam = 1 }) => {
      const res = await api.get(`/communities/${slug}/feed?page=${pageParam}&limit=10`);
      return res.data.data;
    },
    getNextPageParam: (last: any) =>
      last.pagination?.hasNext ? (last.pagination.page ?? 1) + 1 : undefined,
    initialPageParam: 1,
    enabled: !!slug,
  });

  // Join / Leave
  const memberMutation = useMutation({
    mutationFn: async () => {
      if (community?.isMember) {
        await api.post(`/communities/${community.id}/leave`);
      } else {
        await api.post(`/communities/${community?.id}/join`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community', slug] });
      showMessage({
        message: community?.isMember ? 'Left community' : 'Joined community',
        type: 'success',
      });
    },
    onError: () => {
      showMessage({ message: 'Action failed', type: 'danger' });
    },
  });

  const allPosts = postsData?.pages.flatMap((p: any) => p.posts ?? []) ?? [];

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  if (!community) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Community not found</Text>
      </View>
    );
  }

  const ListHeader = () => (
    <View>
      {/* Cover */}
      <View style={styles.cover}>
        {community.coverImage ? (
          <Image source={{ uri: community.coverImage }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#4f46e5' }]} />
        )}
        <View style={styles.coverOverlay} />
        <Image source={{ uri: avatarUrl(community.avatar, community.name) }} style={styles.communityAvatar} />
      </View>

      {/* Info */}
      <View style={styles.infoCard}>
        <Text style={styles.communityName}>{community.name}</Text>
        {community.category && <Text style={styles.category}>{community.category}</Text>}
        {community.description && <Text style={styles.description}>{community.description}</Text>}

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{community.membersCount}</Text>
            <Text style={styles.statLabel}>Members</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{community.postsCount}</Text>
            <Text style={styles.statLabel}>Posts</Text>
          </View>
          <View style={styles.stat}>
            <Ionicons
              name={community.privacy === 'PUBLIC' ? 'globe-outline' : 'lock-closed-outline'}
              size={18}
              color="#6b7280"
            />
            <Text style={styles.statLabel}>{community.privacy}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.joinBtn, community.isMember && styles.leaveBtn]}
          onPress={() => memberMutation.mutate()}
          disabled={memberMutation.isPending}
        >
          {memberMutation.isPending
            ? <ActivityIndicator size="small" color={community.isMember ? '#ef4444' : '#fff'} />
            : <Text style={community.isMember ? styles.leaveBtnText : styles.joinBtnText}>
                {community.isMember ? 'Leave Community' : 'Join Community'}
              </Text>
          }
        </TouchableOpacity>
      </View>

      <View style={styles.postsHeader}>
        <Text style={styles.postsHeaderText}>Community Posts</Text>
        {community.isMember && (
          <TouchableOpacity onPress={() => router.push('/create-post')}>
            <Ionicons name="create-outline" size={22} color="#4f46e5" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: community.name, headerTintColor: '#4f46e5' }}
      />
      <FlatList
        data={allPosts}
        keyExtractor={(item: Post) => item.id}
        renderItem={({ item }) => <CommunityPost post={item} />}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No posts in this community yet</Text>
        }
        ListFooterComponent={
          hasNextPage ? (
            <TouchableOpacity style={styles.loadMore} onPress={() => fetchNextPage()}>
              {isFetchingNextPage
                ? <ActivityIndicator size="small" color="#4f46e5" />
                : <Text style={styles.loadMoreText}>Load more</Text>
              }
            </TouchableOpacity>
          ) : <View style={{ height: 32 }} />
        }
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        style={styles.container}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#6b7280' },
  cover: { height: 160, justifyContent: 'flex-end', padding: 16 },
  coverOverlay: { ...StyleSheet.absoluteFillObject as any, backgroundColor: 'rgba(0,0,0,0.25)' },
  communityAvatar: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: '#fff', backgroundColor: '#e5e7eb' },
  infoCard: { backgroundColor: '#fff', padding: 16, marginBottom: 8 },
  communityName: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 2 },
  category: { fontSize: 13, color: '#4f46e5', fontWeight: '600', marginBottom: 6 },
  description: { color: '#6b7280', lineHeight: 20, marginBottom: 12 },
  statsRow: { flexDirection: 'row', gap: 24, marginBottom: 16 },
  stat: { alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '700', color: '#111827' },
  statLabel: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  joinBtn: { backgroundColor: '#4f46e5', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  leaveBtn: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#ef4444' },
  joinBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  leaveBtnText: { color: '#ef4444', fontWeight: '700', fontSize: 15 },
  postsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#f3f4f6', marginBottom: 4 },
  postsHeaderText: { fontSize: 16, fontWeight: '700', color: '#111827' },
  postCard: { backgroundColor: '#fff', marginBottom: 4, padding: 12 },
  postAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  postAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#e5e7eb' },
  postAuthorName: { fontWeight: '600', color: '#111827', fontSize: 14 },
  postTime: { fontSize: 12, color: '#9ca3af' },
  postContent: { color: '#374151', lineHeight: 20, marginBottom: 8 },
  postMedia: { width: '100%', height: 200, borderRadius: 8, backgroundColor: '#e5e7eb', marginBottom: 8 },
  postMeta: { flexDirection: 'row', gap: 16 },
  postStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  postStatText: { fontSize: 13, color: '#6b7280' },
  emptyText: { textAlign: 'center', color: '#9ca3af', padding: 32 },
  loadMore: { alignItems: 'center', padding: 16 },
  loadMoreText: { color: '#4f46e5', fontWeight: '600' },
});
