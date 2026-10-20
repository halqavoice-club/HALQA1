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
  TouchableOpacity, ActivityIndicator, ScrollView
} from 'react-native';
import { useInfiniteQuery, useQueryClient, useQuery } from '@tanstack/react-query';
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

type FeedTab = 'for-you' | 'following';

// ─── Trending hashtags panel (MF-014) ─────────────────────────────────────────
function TrendingPanel() {
  const router = useRouter();
  const { data: tags = [], isLoading } = useQuery<{ id: string; name: string; postCount: number }[]>({
    queryKey: ['trending-hashtags'],
    queryFn: () => api.get('/posts/trending').then(r => r.data.data ?? []),
    staleTime: 5 * 60_000,
  });

  if (isLoading || tags.length === 0) return null;

  return (
    <View style={tp.container}>
      <Text allowFontScaling={false} style={tp.label}>🔥 Trending</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={tp.scroll}>
        {tags.slice(0, 10).map(tag => (
          <TouchableOpacity
            key={tag.id}
            style={tp.pill}
            onPress={() => router.push({ pathname: '/explore/hashtag/[tag]', params: { tag: tag.name } } as any)}
          >
            <Text allowFontScaling={false} style={tp.pillTxt}>#{tag.name}</Text>
            <Text allowFontScaling={false} style={tp.pillCount}>{tag.postCount >= 1000 ? `${(tag.postCount / 1000).toFixed(1)}K` : tag.postCount}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const tp = StyleSheet.create({
  container:  { backgroundColor: '#fff', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  label:      { fontSize: 11, fontWeight: '700', color: '#6b7280', paddingHorizontal: 16, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  scroll:     { paddingHorizontal: 12, gap: 8 },
  pill:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f3f4f6', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  pillTxt:    { fontSize: 13, fontWeight: '600', color: '#4f46e5' },
  pillCount:  { fontSize: 11, color: '#9ca3af' },
});

export default function FeedScreen() {
  const router      = useRouter();
  const { user }    = useAuthStore();
  const queryClient = useQueryClient();
  const insets      = useSafeAreaInsets();

  const [activeTab,     setActiveTab]     = useState<FeedTab>('for-you');
  const [refreshing,    setRefreshing]    = useState(false);
  const [newPosts,      setNewPosts]      = useState<Post[]>([]);
  const [showNewBanner, setShowNewBanner] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // ── For You feed query ─────────────────────────────────────────────────────
  const {
    data: forYouData, fetchNextPage: fetchNextForYou, hasNextPage: hasNextForYou,
    isFetchingNextPage: fetchingMoreForYou, isLoading: loadingForYou,
    isError: errorForYou, refetch: refetchForYou,
  } = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam }) =>
      api.get('/posts/feed', { params: { cursor: pageParam, limit: 20 } })
        .then(r => r.data.data as FeedPage),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.nextCursor ?? undefined,
    staleTime: 60_000,
  });

  // ── Following feed query ───────────────────────────────────────────────────
  const {
    data: followingData, fetchNextPage: fetchNextFollowing, hasNextPage: hasNextFollowing,
    isFetchingNextPage: fetchingMoreFollowing, isLoading: loadingFollowing,
    isError: errorFollowing, refetch: refetchFollowing,
  } = useInfiniteQuery({
    queryKey: ['feed-following'],
    queryFn: ({ pageParam }) =>
      api.get('/posts/feed', { params: { cursor: pageParam, limit: 20, filter: 'following' } })
        .then(r => r.data.data as FeedPage),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.nextCursor ?? undefined,
    staleTime: 60_000,
    enabled: activeTab === 'following', // lazy load — only fetch when tab is visible
  });

  const forYouPosts    = forYouData?.pages.flatMap(p => p.items) ?? [];
  const followingPosts = followingData?.pages.flatMap(p => p.items) ?? [];

  // Active tab data helpers
  const isLoading          = activeTab === 'for-you' ? loadingForYou    : loadingFollowing;
  const isError            = activeTab === 'for-you' ? errorForYou      : errorFollowing;
  const hasNextPage        = activeTab === 'for-you' ? hasNextForYou    : hasNextFollowing;
  const isFetchingNextPage = activeTab === 'for-you' ? fetchingMoreForYou : fetchingMoreFollowing;
  const fetchNextPage      = activeTab === 'for-you' ? fetchNextForYou  : fetchNextFollowing;
  const refetch            = activeTab === 'for-you' ? refetchForYou    : refetchFollowing;

  // Merge real-time new posts into the For You feed only
  const allForYouPosts = [...newPosts, ...forYouPosts].filter(
    (p, i, self) => self.findIndex(x => x.id === p.id) === i
  );
  const activePosts = activeTab === 'for-you' ? allForYouPosts : followingPosts;

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

    // Increment comment count in feed cache when a new comment arrives
    const onCommentNew = (d: { postId: string }) => {
      queryClient.setQueryData<any>(['feed'], (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            items: page.items.map((p: Post) =>
              p.id === d.postId
                ? { ...p, _count: { ...(p._count ?? {}), comments: ((p._count?.comments ?? 0) + 1) } }
                : p
            ),
          })),
        };
      });
      setNewPosts(prev => prev.map(p =>
        p.id === d.postId
          ? { ...p, _count: { ...(p._count ?? {}), comments: ((p._count?.comments ?? 0) + 1) } }
          : p
      ));
    };

    socket.on('post:create', onPostCreate);
    socket.on('post:update', onPostUpdate);
    socket.on('post:delete', onPostDelete);
    socket.on('comment:create', onCommentNew);

    // Targeted reaction count patch — avoids full feed refetch on every like
    const onPostLike = (d: { postId: string; userId: string; type: string; action: 'added' | 'updated' | 'removed' }) => {
      const delta = d.action === 'added' ? 1 : d.action === 'removed' ? -1 : 0;
      if (delta === 0) return; // 'update' (type change) doesn't change total count
      const patch = (p: Post) =>
        p.id === d.postId
          ? { ...p, _count: { ...p._count, reactions: Math.max(0, (p._count?.reactions ?? 0) + delta) } }
          : p;
      queryClient.setQueryData<any>(['feed'], (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            items: page.items.map(patch),
          })),
        };
      });
      setNewPosts(prev => prev.map(patch));
    };

    socket.on('post:like', onPostLike);

    return () => {
      socket.emit('feed:leave');
      if (user?.schoolId) socket.emit('feed:leave:school', { schoolId: user.schoolId });
      socket.off('post:create', onPostCreate);
      socket.off('post:update', onPostUpdate);
      socket.off('post:delete', onPostDelete);
      socket.off('comment:create', onCommentNew);
      socket.off('post:like', onPostLike);
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
      {/* Trending hashtags — only on For You tab */}
      {activeTab === 'for-you' && <TrendingPanel />}
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

      {/* "New posts" banner — only on For You tab */}
      {activeTab === 'for-you' && showNewBanner && newPosts.length > 0 && (
        <TouchableOpacity style={ss.newBanner} onPress={handleBannerTap} activeOpacity={0.85}>
          <Ionicons name="arrow-up" size={16} color="#fff" />
          <Text allowFontScaling={false} style={ss.newBannerTxt}>
            {newPosts.length} new post{newPosts.length !== 1 ? 's' : ''} — tap to refresh
          </Text>
        </TouchableOpacity>
      )}
    </View>
  ), [user, router, activeTab, showNewBanner, newPosts.length, handleBannerTap]);

  const ListFooter = useCallback(() => {
    if (isFetchingNextPage) {
      return <View style={ss.footer}><ActivityIndicator color="#4f46e5" /></View>;
    }
    if (!hasNextPage && activePosts.length > 0) {
      return <Text allowFontScaling={false} style={ss.caughtUp}>You're all caught up ✓</Text>;
    }
    return null;
  }, [isFetchingNextPage, hasNextPage, activePosts.length]);

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

      {/* ── For You / Following tab bar ─────────────────────────────────────── */}
      <View style={ss.tabBar}>
        <TouchableOpacity
          style={[ss.tab, activeTab === 'for-you' && ss.tabActive]}
          onPress={() => setActiveTab('for-you')}
        >
          <Text allowFontScaling={false} style={[ss.tabTxt, activeTab === 'for-you' && ss.tabTxtActive]}>
            For You
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[ss.tab, activeTab === 'following' && ss.tabActive]}
          onPress={() => setActiveTab('following')}
        >
          <Text allowFontScaling={false} style={[ss.tabTxt, activeTab === 'following' && ss.tabTxtActive]}>
            Following
          </Text>
        </TouchableOpacity>
      </View>

      {/* Loading skeleton */}
      {isLoading ? (
        <View style={ss.center}>
          <ActivityIndicator size="large" color="#4f46e5" />
        </View>
      ) : isError ? (
        <View style={ss.errorCenter}>
          <Ionicons name="cloud-offline-outline" size={52} color="#d1d5db" />
          <Text allowFontScaling={false} style={ss.errorTitle}>Failed to load feed</Text>
          <Text allowFontScaling={false} style={ss.errorSub}>Check your connection and try again</Text>
          <TouchableOpacity style={ss.retryBtn} onPress={() => refetch()}>
            <Ionicons name="refresh" size={16} color="#fff" />
            <Text allowFontScaling={false} style={ss.retryTxt}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          key={activeTab}
          data={activePosts}
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
              <Text allowFontScaling={false} style={ss.emptyTitle}>
                {activeTab === 'following' ? 'Nothing from people you follow' : 'Your feed is empty'}
              </Text>
              <Text allowFontScaling={false} style={ss.emptySub}>
                {activeTab === 'following'
                  ? 'Follow people to see their posts here'
                  : 'Follow people to see their posts here'}
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
  // ── For You / Following tab bar ───────────────────────────────────────────
  tabBar:          { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  tab:             { flex: 1, alignItems: 'center', paddingVertical: 11 },
  tabActive:       { borderBottomWidth: 2, borderBottomColor: '#4f46e5' },
  tabTxt:          { fontSize: 14, fontWeight: '600', color: '#9ca3af' },
  tabTxtActive:    { color: '#4f46e5' },
});

