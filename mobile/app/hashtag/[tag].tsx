/**
 * HALQA Mobile — Hashtag Feed Screen v2
 * Cursor-paginated list of all posts tagged with a given hashtag.
 * Matches the backend shape: { hashtag, items, nextCursor, hasMore }
 */
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
  RefreshControl
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '@/lib/api';
import PostCard, { type Post } from '@/components/feed/PostCard';

export default function HashtagFeedScreen() {
  const { tag }  = useLocalSearchParams<{ tag: string }>();
  const router   = useRouter();
  const decoded  = decodeURIComponent(tag ?? '').replace(/^#/, '');

  const {
    data, isLoading, isError,
    fetchNextPage, hasNextPage, isFetchingNextPage,
    refetch, isRefetching,
  } = useInfiniteQuery({
    queryKey: ['hashtag-feed', decoded],
    queryFn: ({ pageParam }) =>
      api.get(`/explore/hashtag/${encodeURIComponent(decoded)}`, {
        params: { cursor: pageParam, limit: 20 },
      }).then(r => r.data.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: any) => page.nextCursor ?? undefined,
    enabled: !!decoded,
    staleTime: 60_000,
  });

  const hashtag  = data?.pages[0]?.hashtag;
  const allPosts: Post[] = data?.pages.flatMap((p: any) => p.items ?? []) ?? [];

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: `#${decoded}`,
          headerTintColor: '#4f46e5',
          headerBackTitle: 'Explore',
        }}
      />

      <FlatList
        data={allPosts}
        keyExtractor={(item: Post) => item.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onNavigateToDetail={() =>
              router.push({ pathname: '/post/[id]', params: { id: item.id } } as any)
            }
          />
        )}
        ListHeaderComponent={
          <View style={s.header}>
            <View style={s.badge}>
              <Text allowFontScaling={false} style={s.hashSymbol}>#</Text>
              <Text allowFontScaling={false} style={s.hashName}>{decoded}</Text>
            </View>
            {hashtag && (
              <Text allowFontScaling={false} style={s.count}>
                {hashtag.postCount.toLocaleString()}{' '}
                {hashtag.postCount === 1 ? 'post' : 'posts'}
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={s.center}>
              <ActivityIndicator size="large" color="#4f46e5" />
            </View>
          ) : isError ? (
            <View style={s.center}>
              <Ionicons name="alert-circle-outline" size={48} color="#d1d5db" />
              <Text allowFontScaling={false} style={s.emptyText}>Failed to load posts</Text>
            </View>
          ) : (
            <View style={s.center}>
              <Ionicons name="search-outline" size={48} color="#d1d5db" />
              <Text allowFontScaling={false} style={s.emptyText}>
                No posts with #{decoded} yet
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          hasNextPage ? (
            <View style={s.footer}>
              {isFetchingNextPage
                ? <ActivityIndicator size="small" color="#4f46e5" />
                : null}
            </View>
          ) : allPosts.length > 0 ? (
            <Text allowFontScaling={false} style={s.caughtUp}>
              You've seen all posts with #{decoded}
            </Text>
          ) : null
        }
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor="#4f46e5"
            colors={['#4f46e5']}
          />
        }
        contentContainerStyle={{ paddingBottom: 80 }}
        style={s.list}
        showsVerticalScrollIndicator={false}
      />
    </>
  );
}

const s = StyleSheet.create({
  list:      { flex: 1, backgroundColor: '#f9fafb' },
  header:    { alignItems: 'center', backgroundColor: '#fff', padding: 20,
               borderBottomWidth: 1, borderBottomColor: '#f3f4f6', gap: 6, marginBottom: 4 },
  badge:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ede9fe',
               paddingHorizontal: 18, paddingVertical: 10, borderRadius: 24 },
  hashSymbol:{ fontSize: 24, fontWeight: '900', color: '#4f46e5' },
  hashName:  { fontSize: 22, fontWeight: '800', color: '#4f46e5' },
  count:     { color: '#6b7280', fontSize: 13 },
  center:    { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { color: '#9ca3af', fontSize: 15 },
  footer:    { padding: 16, alignItems: 'center' },
  caughtUp:  { textAlign: 'center', color: '#d1d5db', fontSize: 12,
               paddingVertical: 20 },
});

