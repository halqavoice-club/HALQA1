/**
 * HALQA Mobile — Feed Screen v2
 * Fixes:
 *  - Real-time socket events (post:create, post:update, post:delete)
 *  - "N new posts — tap to refresh" banner
 *  - SCHOOL_ONLY room join (feed:join:school)
 *  - Error state with Retry button
 *  - "You're all caught up ✓" end marker
 *  - PostCard v2 with all gaps fixed
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList, View, Text, StyleSheet, RefreshControl,
  TouchableOpacity, ActivityIndicator
} from 'react-native';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { getSocket } from '@/lib/socket';
import PostCard, { type Post } from '@/components/feed/PostCard';
import StoriesBar from '@/components/stories/StoriesBar';
import { LiveSection } from '@/components/feed/LiveSection';

interface FeedPage { items: Post[]; nextCursor: string | null; hasMore: boolean }

export default function FeedScreen() {
  const router      = useRouter();
  const { user }    = useAuthStore();
  const queryClient = useQueryClient();
  const insets      = useSafeAreaInsets();

  const [refreshing,    setRefreshing]    = useState(false);
  const [newPosts,      setNewPosts]      = useState<Post[]>([]);
  const [showNewBanner, setShowNewBanner] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // ── Infinite feed query ────────────────────────────────────────────────────
  const {
    data, fetchNextPage, hasNextPage, isFetchingNextPage,
    isLoading, isError, refetch,
  } = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam }) =>
      api.get('/posts/feed', { params: { cursor: pageParam, limit: 20 } })
        .then(r => r.data.data as FeedPage),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.nextCursor ?? undefined,
    staleTime: 60_000,
  });

  const fetchedPosts = data?.pages.flatMap(p => p.items) ?? [];

  // Merge incoming real-time posts, deduplicating by id
  const allPosts = [...newPosts, ...fetchedPosts].filter(
    (p, i, self) => self.findIndex(x => x.id === p.id) === i
  );

  // ── Real-time socket ───────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.emit('feed:join');
    if (user?.schoolId) {
      socket.emit('feed:join:school', { schoolId: user.schoolId });
    }

    const onPostCreate = (d: { post: Post }) => {
      if (d.post.authorId === user?.id) return; // own posts handled optimistically
      setNewPosts(prev => {
        if (prev.find(p => p.id === d.post.id)) return prev;
        return [d.post, ...prev];
      });
      setShowNewBanner(true);
    };

    const onPostUpdate = (d: { post: Post }) => {
      queryClient.setQueryData<any>(['feed'], (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            items: page.items.map((p: Post) => p.id === d.post.id ? d.post : p),
          })),
        };
      });
      setNewPosts(prev => prev.map(p => p.id === d.post.id ? d.post : p));
    };

    const onPostDelete = (d: { postId: string }) => {
      queryClient.setQueryData<any>(['feed'], (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            items: page.items.filter((p: Post) => p.id !== d.postId),
          })),
        };
      });
      setNewPosts(prev => prev.filter(p => p.id !== d.postId));
    };

    socket.on('post:create', onPostCreate);
    socket.on('post:update', onPostUpdate);
    socket.on('post:delete', onPostDelete);

    return () => {
      socket.emit('feed:leave');
      if (user?.schoolId) socket.emit('feed:leave:school', { schoolId: user.schoolId });
      socket.off('post:create', onPostCreate);
      socket.off('post:update', onPostUpdate);
      socket.off('post:delete', onPostDelete);
    };
  }, [user?.id, user?.schoolId, queryClient]);


  // ── Pull-to-refresh ────────────────────────────────────────────────────────
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setNewPosts([]);
    setShowNewBanner(false);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // ── Banner tap → scroll to top + absorb new posts ─────────────────────────
  const handleBannerTap = useCallback(() => {
    setShowNewBanner(false);
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const renderPost = useCallback(({ item }: { item: Post }) => (
    <PostCard
      post={item}
      onNavigateToDetail={() => router.push({ pathname: '/post/[id]', params: { id: item.id } } as any)}
    />
  ), [router]);

  const ListHeader = useCallback(() => (
    <View>
      <StoriesBar />
      {/* Live sessions */}
      <LiveSection />
      {/* Compose tap-target — hidden for SUPER_ADMIN (platform admin cannot create posts) */}
      {user?.role !== 'SUPER_ADMIN' && (
        <TouchableOpacity style={ss.compose} onPress={() => router.push('/create-post' as any)}>
          <View style={ss.composeAvatar}>
            <Text allowFontScaling={false} style={ss.composeInitials}>
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </Text>
          </View>
          <Text allowFontScaling={false} style={ss.composePlaceholder}>What's on your mind?</Text>
          <Ionicons name="image-outline" size={20} color="#9ca3af" />
        </TouchableOpacity>
      )}

      {/* "New posts" banner */}
      {showNewBanner && newPosts.length > 0 && (
        <TouchableOpacity style={ss.newBanner} onPress={handleBannerTap} activeOpacity={0.85}>
          <Ionicons name="arrow-up" size={16} color="#fff" />
          <Text allowFontScaling={false} style={ss.newBannerTxt}>
            {newPosts.length} new post{newPosts.length !== 1 ? 's' : ''} — tap to refresh
          </Text>
        </TouchableOpacity>
      )}
    </View>
  ), [user, router, showNewBanner, newPosts.length, handleBannerTap]);

  const ListFooter = useCallback(() => {
    if (isFetchingNextPage) {
      return <View style={ss.footer}><ActivityIndicator color="#4f46e5" /></View>;
    }
    if (!hasNextPage && allPosts.length > 0) {
      return <Text allowFontScaling={false} style={ss.caughtUp}>You're all caught up ✓</Text>;
    }
    return null;
  }, [isFetchingNextPage, hasNextPage, allPosts.length]);

  // ── Error state ────────────────────────────────────────────────────────────
  if (isError && !isLoading) {
    return (
      <SafeAreaView style={ss.container} edges={['top']}>
        <View style={ss.header}>
          <Text allowFontScaling={false} style={ss.headerTitle}>HALQA</Text>
        </View>
        <View style={ss.errorCenter}>
          <Ionicons name="cloud-offline-outline" size={52} color="#d1d5db" />
          <Text allowFontScaling={false} style={ss.errorTitle}>Failed to load feed</Text>
          <Text allowFontScaling={false} style={ss.errorSub}>Check your connection and try again</Text>
          <TouchableOpacity style={ss.retryBtn} onPress={() => refetch()}>
            <Ionicons name="refresh" size={16} color="#fff" />
            <Text allowFontScaling={false} style={ss.retryTxt}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={ss.container} edges={['top']}>
      {/* Header */}
      <View style={ss.header}>
        <Text allowFontScaling={false} style={ss.headerTitle}>HALQA</Text>
        <View style={ss.headerRight}>
          <TouchableOpacity
            onPress={() => router.push('/reels' as any)}
            style={ss.iconBtn}
          >
            <Ionicons name="play-circle-outline" size={22} color="#374151" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/notifications' as any)}
            style={ss.iconBtn}
          >
            <Ionicons name="notifications-outline" size={22} color="#374151" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/chat' as any)}
            style={ss.iconBtn}
          >
            <Ionicons name="chatbubble-outline" size={22} color="#374151" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Loading skeleton */}
      {isLoading ? (
        <View style={ss.center}>
          <ActivityIndicator size="large" color="#4f46e5" />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={allPosts}
          keyExtractor={item => item.id}
          renderItem={renderPost}
          ListHeaderComponent={ListHeader}
          ListFooterComponent={ListFooter}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          onEndReachedThreshold={0.3}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#4f46e5"
              colors={['#4f46e5']}
            />
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 80 + insets.bottom }}
          ListEmptyComponent={
            <View style={ss.empty}>
              <Ionicons name="newspaper-outline" size={48} color="#d1d5db" />
              <Text allowFontScaling={false} style={ss.emptyTitle}>Your feed is empty</Text>
              <Text allowFontScaling={false} style={ss.emptySub}>
                Follow people to see their posts here
              </Text>
              <TouchableOpacity
                style={ss.emptyBtn}
                onPress={() => router.push('/(tabs)/explore' as any)}
              >
                <Text allowFontScaling={false} style={ss.emptyBtnTxt}>Find people →</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#f9fafb' },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  headerTitle:     { fontSize: 20, fontWeight: '900', color: '#4f46e5' },
  headerRight:     { flexDirection: 'row', gap: 8 },
  iconBtn:         { padding: 4 },
  compose:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', margin: 12, marginBottom: 4, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb', gap: 10 },
  composeAvatar:   { width: 32, height: 32, borderRadius: 16, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center' },
  composeInitials: { fontSize: 11, fontWeight: '700', color: '#4f46e5' },
  composePlaceholder: { flex: 1, color: '#9ca3af', fontSize: 14 },
  newBanner:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 12, marginBottom: 4, paddingVertical: 10, backgroundColor: '#4f46e5', borderRadius: 12 },
  newBannerTxt:    { color: '#fff', fontWeight: '700', fontSize: 13 },
  footer:          { padding: 16, alignItems: 'center' },
  caughtUp:        { textAlign: 'center', color: '#d1d5db', fontSize: 12, paddingVertical: 16 },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorCenter:     { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 8 },
  errorTitle:      { fontSize: 17, fontWeight: '700', color: '#374151', marginTop: 12 },
  errorSub:        { fontSize: 13, color: '#9ca3af', textAlign: 'center' },
  retryBtn:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#4f46e5', borderRadius: 12 },
  retryTxt:        { color: '#fff', fontWeight: '700', fontSize: 14 },
  empty:           { alignItems: 'center', padding: 40 },
  emptyTitle:      { fontSize: 16, fontWeight: '700', color: '#374151', marginTop: 16 },
  emptySub:        { color: '#9ca3af', textAlign: 'center', marginTop: 8, fontSize: 13 },
  emptyBtn:        { marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#4f46e5', borderRadius: 12 },
  emptyBtnTxt:     { color: '#fff', fontWeight: '700', fontSize: 14 },
});

