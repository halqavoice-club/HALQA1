/**
 * HALQA Mobile — Community Detail Screen v2
 * Fixed: correct API response shape { items, nextCursor, hasMore, community }
 * Fixed: post fields match real Post type (body, author.firstName/lastName, _count)
 * Fixed: compose button passes communityId to create-post
 * Added: join-request handling for PRIVATE communities
 */
import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import {
  useQuery, useMutation, useInfiniteQuery, useQueryClient,
} from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showMessage } from 'react-native-flash-message';
import api, { getBaseURL } from '@/lib/api';
import PostCard, { type Post } from '@/components/feed/PostCard';

const BASE = getBaseURL().replace('/api/v1', '');

function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return BASE + url;
}

interface Community {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  coverUrl?: string | null;
  avatarUrl?: string | null;
  memberCount: number;
  postCount: number;
  myRole?: string | null;
  privacy: 'PUBLIC' | 'PRIVATE' | 'INVITE_ONLY';
  category?: string | null;
  rules?: string | null;
  createdAt: string;
  owner: { id: string; firstName: string; lastName: string; avatarUrl: string | null };
  isVerified: boolean;
}

export default function CommunityDetailScreen() {
  const { slug }    = useLocalSearchParams<{ slug: string }>();
  const router      = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'feed' | 'about'>('feed');

  // ── Fetch community ───────────────────────────────────────────────────────
  const {
    data: community, isLoading, refetch: refetchCommunity, isRefetching,
  } = useQuery<Community>({
    queryKey: ['community', slug],
    queryFn: () => api.get(`/communities/${slug}`).then(r => r.data.data),
    enabled: !!slug,
  });

  // ── Fetch posts (cursor-paginated) ────────────────────────────────────────
  const {
    data: feedData,
    fetchNextPage, hasNextPage, isFetchingNextPage,
    refetch: refetchFeed,
  } = useInfiniteQuery({
    queryKey: ['community-feed', slug],
    queryFn: ({ pageParam }) =>
      api.get(`/communities/${slug}/feed`, {
        params: { cursor: pageParam, limit: 15 }
      }).then(r => r.data.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: any) => page.nextCursor ?? undefined,
    enabled: !!slug,
  });

  const allPosts: Post[] = feedData?.pages.flatMap((p: any) => p.items ?? []) ?? [];

  // ── Join / Leave ──────────────────────────────────────────────────────────
  const joinMutation = useMutation({
    mutationFn: async () => {
      if (community?.myRole) {
        return api.post(`/communities/${community.id}/leave`);
      }
      return api.post(`/communities/${community?.id}/join`);
    },
    onSuccess: (res) => {
      const data = (res as any)?.data?.data;
      if (data?.status === 'pending') {
        showMessage({ message: 'Join request sent — awaiting approval', type: 'info' });
      } else if (community?.myRole) {
        showMessage({ message: 'Left community', type: 'success' });
      } else {
        showMessage({ message: 'Joined community!', type: 'success' });
      }
      queryClient.invalidateQueries({ queryKey: ['community', slug] });
      queryClient.invalidateQueries({ queryKey: ['my-communities'] });
    },
    onError: (e: any) => {
      showMessage({
        message: e?.response?.data?.message || 'Action failed',
        type: 'danger',
      });
    },
  });

  const handleRefresh = useCallback(async () => {
    await Promise.all([refetchCommunity(), refetchFeed()]);
  }, [refetchCommunity, refetchFeed]);

  const goToPost = useCallback((postId: string) => {
    router.push({ pathname: '/post/[id]', params: { id: postId } } as any);
  }, [router]);

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderPost = useCallback(({ item }: { item: Post }) => (
    <PostCard post={item} onNavigateToDetail={() => goToPost(item.id)} />
  ), [goToPost]);

  const isOwner  = community?.myRole === 'OWNER';
  const isMember = !!community?.myRole;
  const showJoin = community?.privacy !== 'INVITE_ONLY' || isOwner;
  const joinLabel = community?.myRole ? 'Leave' : (community?.privacy === 'PRIVATE' ? 'Request to Join' : 'Join');

  if (isLoading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  if (!community) {
    return (
      <View style={s.centered}>
        <Text style={s.errorText}>Community not found</Text>
      </View>
    );
  }

  const coverSrc = community.coverUrl
    ? resolveMediaUrl(community.coverUrl)
    : null;
  const avatarSrc = community.avatarUrl
    ? resolveMediaUrl(community.avatarUrl)
    : null;

  const ListHeader = () => (
    <View>
      {/* Cover */}
      <View style={s.cover}>
        {coverSrc
          ? <Image source={{ uri: coverSrc }} style={StyleSheet.absoluteFillObject as any} resizeMode="cover" />
          : <View style={[StyleSheet.absoluteFillObject as any, { backgroundColor: '#4f46e5' }]} />
        }
        <View style={s.coverOverlay} />
        {/* Avatar */}
        <View style={s.communityAvatar}>
          {avatarSrc
            ? <Image source={{ uri: avatarSrc }} style={{ width: '100%', height: '100%' }} />
            : <Text allowFontScaling={false} style={s.communityAvatarText}>
                {community.name.slice(0, 2).toUpperCase()}
              </Text>
          }
        </View>
      </View>

      {/* Info card */}
      <View style={s.infoCard}>
        <View style={s.nameRow}>
          <Text allowFontScaling={false} style={s.communityName}>{community.name}</Text>
          {community.isVerified && (
            <Ionicons name="checkmark-circle" size={18} color="#4f46e5" />
          )}
        </View>
        {community.category && (
          <Text allowFontScaling={false} style={s.category}>{community.category}</Text>
        )}
        {community.description && (
          <Text allowFontScaling={false} style={s.description} numberOfLines={3}>
            {community.description}
          </Text>
        )}

        <View style={s.statsRow}>
          <View style={s.stat}>
            <Text allowFontScaling={false} style={s.statValue}>{community.memberCount}</Text>
            <Text allowFontScaling={false} style={s.statLabel}>Members</Text>
          </View>
          <View style={s.stat}>
            <Ionicons
              name={community.privacy === 'PUBLIC' ? 'globe-outline' : 'lock-closed-outline'}
              size={16}
              color="#6b7280"
            />
            <Text allowFontScaling={false} style={s.statLabel}>
              {community.privacy === 'INVITE_ONLY' ? 'Invite only' : community.privacy.toLowerCase()}
            </Text>
          </View>
          {community.myRole && (
            <View style={s.roleBadge}>
              <Text allowFontScaling={false} style={s.roleText}>{community.myRole}</Text>
            </View>
          )}
        </View>

        {/* Join/Leave */}
        {showJoin && !isOwner && (
          <TouchableOpacity
            style={[s.joinBtn, isMember && s.leaveBtn]}
            onPress={() => joinMutation.mutate()}
            disabled={joinMutation.isPending}
          >
            {joinMutation.isPending
              ? <ActivityIndicator size="small" color={isMember ? '#ef4444' : '#fff'} />
              : <Text allowFontScaling={false} style={isMember ? s.leaveBtnText : s.joinBtnText}>
                  {joinLabel}
                </Text>
            }
          </TouchableOpacity>
        )}
        {/* INVITE_ONLY and not a member: show prompt */}
        {community.privacy === 'INVITE_ONLY' && !isMember && !isOwner && (
          <View style={s.inviteOnlyBanner}>
            <Ionicons name="mail-outline" size={16} color="#4f46e5" />
            <Text allowFontScaling={false} style={s.inviteOnlyText}>
              This community is invite-only. Ask an admin for an invite.
            </Text>
          </View>
        )}
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        {(['feed', 'about'] as const).map(t => (
          <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
            <Text allowFontScaling={false} style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'feed' ? '📰 Feed' : 'ℹ️ About'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Compose tap — passes communityId so the post lands in this community */}
      {tab === 'feed' && isMember && (
        <TouchableOpacity
          style={s.compose}
          onPress={() => router.push({
            pathname: '/create-post' as any,
            params: { communityId: community.id, communityName: community.name }
          })}
        >
          <View style={s.composeAvatar}>
            <Ionicons name="create-outline" size={18} color="#4f46e5" />
          </View>
          <Text allowFontScaling={false} style={s.composePlaceholder}>
            Share something with {community.name}…
          </Text>
        </TouchableOpacity>
      )}

      {/* About tab content */}
      {tab === 'about' && (
        <View style={s.aboutCard}>
          {community.description && (
            <View style={s.aboutSection}>
              <Text allowFontScaling={false} style={s.aboutTitle}>About</Text>
              <Text allowFontScaling={false} style={s.aboutText}>{community.description}</Text>
            </View>
          )}
          {community.rules && (
            <View style={s.aboutSection}>
              <Text allowFontScaling={false} style={s.aboutTitle}>Community Rules</Text>
              <Text allowFontScaling={false} style={s.aboutText}>{community.rules}</Text>
            </View>
          )}
          <View style={s.aboutSection}>
            <Text allowFontScaling={false} style={s.aboutMeta}>
              Created by {community.owner.firstName} {community.owner.lastName}
            </Text>
          </View>
        </View>
      )}

      {tab === 'feed' && allPosts.length === 0 && !isFetchingNextPage && (
        <View style={s.empty}>
          <Ionicons name="newspaper-outline" size={48} color="#d1d5db" />
          <Text allowFontScaling={false} style={s.emptyText}>
            No posts yet{isMember ? '. Be the first!' : '. Join to post.'}
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: community.name,
          headerTintColor: '#4f46e5',
          headerBackTitle: 'Communities',
        }}
      />
      {tab === 'feed' ? (
        <FlatList
          data={allPosts}
          keyExtractor={(item: Post) => item.id}
          renderItem={renderPost}
          ListHeaderComponent={ListHeader}
          ListFooterComponent={
            hasNextPage ? (
              <View style={s.footer}>
                {isFetchingNextPage
                  ? <ActivityIndicator size="small" color="#4f46e5" />
                  : null}
              </View>
            ) : allPosts.length > 0 ? (
              <Text allowFontScaling={false} style={s.caughtUp}>
                You're all caught up ✓
              </Text>
            ) : null
          }
          onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={handleRefresh}
              tintColor="#4f46e5"
              colors={['#4f46e5']}
            />
          }
          contentContainerStyle={{ paddingBottom: 80 }}
          style={s.container}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <FlatList
          data={[]}
          renderItem={null}
          ListHeaderComponent={ListHeader}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={handleRefresh}
              tintColor="#4f46e5"
            />
          }
          contentContainerStyle={{ paddingBottom: 80 }}
          style={s.container}
        />
      )}
    </>
  );
}

const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#f9fafb' },
  centered:         { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText:        { color: '#6b7280' },
  cover:            { height: 160, justifyContent: 'flex-end', padding: 16 },
  coverOverlay:     { ...StyleSheet.absoluteFillObject as any, backgroundColor: 'rgba(0,0,0,0.3)' },
  communityAvatar:  { width: 72, height: 72, borderRadius: 12, borderWidth: 3, borderColor: '#fff',
                      backgroundColor: '#ede9fe', overflow: 'hidden',
                      justifyContent: 'center', alignItems: 'center' },
  communityAvatarText: { fontSize: 24, fontWeight: '800', color: '#4f46e5' },
  infoCard:         { backgroundColor: '#fff', padding: 16, marginBottom: 8 },
  nameRow:          { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  communityName:    { fontSize: 20, fontWeight: '800', color: '#111827', flex: 1 },
  category:         { fontSize: 13, color: '#4f46e5', fontWeight: '600', marginBottom: 6 },
  description:      { color: '#6b7280', lineHeight: 20, marginBottom: 12 },
  statsRow:         { flexDirection: 'row', gap: 20, alignItems: 'center', marginBottom: 14 },
  stat:             { alignItems: 'center', gap: 2 },
  statValue:        { fontSize: 17, fontWeight: '700', color: '#111827' },
  statLabel:        { fontSize: 12, color: '#6b7280' },
  roleBadge:        { backgroundColor: '#ede9fe', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  roleText:         { fontSize: 11, fontWeight: '700', color: '#4f46e5' },
  joinBtn:          { backgroundColor: '#4f46e5', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  leaveBtn:         { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#ef4444' },
  joinBtnText:      { color: '#fff', fontWeight: '700', fontSize: 15 },
  leaveBtnText:     { color: '#ef4444', fontWeight: '700', fontSize: 15 },
  tabs:             { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1,
                      borderBottomColor: '#f3f4f6', marginBottom: 4 },
  tab:              { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive:        { borderBottomWidth: 2, borderBottomColor: '#4f46e5' },
  tabText:          { fontSize: 13, fontWeight: '600', color: '#9ca3af' },
  tabTextActive:    { color: '#4f46e5' },
  compose:          { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
                      margin: 12, marginBottom: 4, padding: 12, borderRadius: 14,
                      borderWidth: 1, borderColor: '#e5e7eb', gap: 10 },
  composeAvatar:    { width: 34, height: 34, borderRadius: 17, backgroundColor: '#ede9fe',
                      justifyContent: 'center', alignItems: 'center' },
  composePlaceholder: { flex: 1, color: '#9ca3af', fontSize: 14 },
  empty:            { alignItems: 'center', padding: 48, gap: 10 },
  emptyText:        { color: '#9ca3af', fontSize: 14 },
  footer:           { padding: 16, alignItems: 'center' },
  caughtUp:         { textAlign: 'center', color: '#d1d5db', fontSize: 12, paddingVertical: 20 },
  aboutCard:        { backgroundColor: '#fff', margin: 12, borderRadius: 16,
                      padding: 16, gap: 12 },
  aboutSection:     { gap: 6 },
  aboutTitle:       { fontSize: 15, fontWeight: '700', color: '#111827' },
  aboutText:        { color: '#6b7280', lineHeight: 22 },
  aboutMeta:        { fontSize: 13, color: '#9ca3af' },
  inviteOnlyBanner: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
                      backgroundColor: '#ede9fe', borderRadius: 10, padding: 12, marginTop: 4 },
  inviteOnlyText:   { flex: 1, fontSize: 13, color: '#4f46e5', lineHeight: 18 },
});
