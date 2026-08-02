/**
 * HALQA Mobile — Hashtag Feed Screen
 * Shows all posts with a given hashtag
 */
import React from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Image, RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';
import { formatDistanceToNow } from 'date-fns';

interface Post {
  id: string;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
  author: { id: string; name: string; avatar?: string };
  likesCount: number;
  commentsCount: number;
  isLiked: boolean;
  createdAt: string;
}

function PostItem({ post }: { post: Post }) {
  const router = useRouter();
  return (
    <TouchableOpacity style={styles.postCard} onPress={() => router.push(`/post/${post.id}`)}>
      <View style={styles.postHeader}>
        <TouchableOpacity onPress={() => router.push(`/profile/${post.author.id}`)}>
          <Image source={{ uri: avatarUrl(post.author.avatar, post.author.name) }} style={styles.avatar} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.authorName}>{post.author.name}</Text>
          <Text style={styles.postTime}>{formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}</Text>
        </View>
      </View>
      <Text style={styles.postContent} numberOfLines={4}>{post.content}</Text>
      {post.mediaUrl && post.mediaType !== 'video' && (
        <Image source={{ uri: post.mediaUrl }} style={styles.postMedia} resizeMode="cover" />
      )}
      <View style={styles.postFooter}>
        <View style={styles.postStat}>
          <Ionicons name={post.isLiked ? 'heart' : 'heart-outline'} size={16} color={post.isLiked ? '#ef4444' : '#9ca3af'} />
          <Text style={styles.statText}>{post.likesCount}</Text>
        </View>
        <View style={styles.postStat}>
          <Ionicons name="chatbubble-outline" size={16} color="#9ca3af" />
          <Text style={styles.statText}>{post.commentsCount}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function HashtagFeedScreen() {
  const { tag } = useLocalSearchParams<{ tag: string }>();
  const router = useRouter();

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
    isRefetching,
  } = useInfiniteQuery({
    queryKey: ['hashtag-posts', tag],
    queryFn: async ({ pageParam = 1 }) => {
      const res = await api.get(`/explore/hashtag/${encodeURIComponent(tag ?? '')}?page=${pageParam}&limit=15`);
      return res.data.data;
    },
    getNextPageParam: (last: any) =>
      last.pagination?.hasNext ? (last.pagination.page ?? 1) + 1 : undefined,
    initialPageParam: 1,
    enabled: !!tag,
  });

  const allPosts = data?.pages.flatMap((p: any) => p.posts ?? []) ?? [];
  const totalPosts = data?.pages[0]?.pagination?.total ?? 0;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: `#${tag}`,
          headerTintColor: '#4f46e5',
        }}
      />
      <FlatList
        data={allPosts}
        keyExtractor={(item: Post) => item.id}
        renderItem={({ item }) => <PostItem post={item} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.hashtagBadge}>
              <Text style={styles.hashtagSymbol}>#</Text>
              <Text style={styles.hashtagName}>{tag}</Text>
            </View>
            {totalPosts > 0 && (
              <Text style={styles.postCount}>{totalPosts} posts</Text>
            )}
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color="#4f46e5" />
            </View>
          ) : (
            <View style={styles.centered}>
              <Ionicons name="search-outline" size={48} color="#d1d5db" />
              <Text style={styles.emptyText}>No posts found for #{tag}</Text>
            </View>
          )
        }
        ListFooterComponent={
          hasNextPage ? (
            <TouchableOpacity style={styles.loadMore} onPress={() => fetchNextPage()}>
              {isFetchingNextPage
                ? <ActivityIndicator size="small" color="#4f46e5" />
                : <Text style={styles.loadMoreText}>Load more</Text>
              }
            </TouchableOpacity>
          ) : <View style={{ height: 24 }} />
        }
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        style={styles.container}
        ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  header: { padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#f3f4f6', alignItems: 'center', gap: 6, marginBottom: 4 },
  hashtagBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ede9fe', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  hashtagSymbol: { fontSize: 24, fontWeight: '900', color: '#4f46e5' },
  hashtagName: { fontSize: 22, fontWeight: '800', color: '#4f46e5' },
  postCount: { color: '#6b7280', fontSize: 14 },
  postCard: { backgroundColor: '#fff', padding: 12, marginHorizontal: 0 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#e5e7eb' },
  authorName: { fontWeight: '600', color: '#111827', fontSize: 14 },
  postTime: { fontSize: 12, color: '#9ca3af' },
  postContent: { color: '#374151', lineHeight: 20, marginBottom: 8 },
  postMedia: { width: '100%', height: 200, borderRadius: 8, marginBottom: 8, backgroundColor: '#e5e7eb' },
  postFooter: { flexDirection: 'row', gap: 16 },
  postStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { fontSize: 13, color: '#6b7280' },
  emptyText: { color: '#9ca3af', fontSize: 15 },
  loadMore: { alignItems: 'center', padding: 16 },
  loadMoreText: { color: '#4f46e5', fontWeight: '600' },
});
