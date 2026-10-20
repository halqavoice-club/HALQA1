/**
 * HALQA Mobile — Explore / Discovery Screen v3
 * Full parity with web:
 *  - Search with type filter tabs (All / Posts / People / Communities / #Tags)
 *  - Explore feed: trending posts, trending hashtags, suggested people,
 *    suggested communities, live voice rooms, live classes
 */
import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, FlatList,
  TouchableOpacity, ActivityIndicator, RefreshControl
} from 'react-native';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import UserCard from '@/components/social/UserCard';
import CommunityCard from '@/components/communities/CommunityCard';
import { LiveCard, type LiveCardData } from '@/components/feed/LiveCard';
import PostCard, { type Post } from '@/components/feed/PostCard';

// ─── Types ─────────────────────────────────────────────────────────────────────
type SearchType = 'all' | 'posts' | 'people' | 'communities' | 'hashtags';

const SEARCH_TABS: { type: SearchType; label: string }[] = [
  { type: 'all',         label: 'All'       },
  { type: 'posts',       label: 'Posts'     },
  { type: 'people',      label: 'People'    },
  { type: 'communities', label: 'Groups'    },
  { type: 'hashtags',    label: '#Tags'     },
];

// ─── Hashtag pill ──────────────────────────────────────────────────────────────
function HashtagPill({ tag, onPress }: { tag: { id: string; name: string; postCount: number }; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.tag} onPress={onPress} activeOpacity={0.7}>
      <Text allowFontScaling={false} style={s.tagHash}>#</Text>
      <Text allowFontScaling={false} style={s.tagName}>{tag.name}</Text>
      <Text allowFontScaling={false} style={s.tagCount}>{tag.postCount}</Text>
    </TouchableOpacity>
  );
}

// ─── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ title, live }: { title: string; live?: boolean }) {
  return (
    <View style={s.sectionHeader}>
      {live && <View style={s.liveDot} />}
      <Text allowFontScaling={false} style={[s.sectionTitle, live && { color: '#ef4444' }]}>
        {title}
      </Text>
    </View>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────────
export default function ExploreScreen() {
  const router     = useRouter();
  const insets     = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [query,      setQuery]      = useState('');
  const [searchType, setSearchType] = useState<SearchType>('all');
  const debounced    = useDebounce(query, 350);
  const isSearching  = debounced.length >= 2;

  // ── Explore feed (not searching) ──────────────────────────────────────────
  const { data: feed, isLoading: loadingFeed, refetch: refetchFeed, isRefetching } = useQuery({
    queryKey: ['explore-feed'],
    queryFn: () => api.get('/explore').then(r => r.data.data),
    enabled: !isSearching,
    staleTime: 120_000,
  });

  // ── Search results ────────────────────────────────────────────────────────
  const { data: results, isLoading: loadingSearch } = useQuery({
    queryKey: ['explore-search', debounced, searchType],
    queryFn: () =>
      api.get('/explore/search', { params: { q: debounced, type: searchType, limit: 20 } })
         .then(r => r.data.data),
    enabled: isSearching,
    staleTime: 30_000,
  });

  const isLoading = isSearching ? loadingSearch : loadingFeed;

  // ── Navigate to hashtag ───────────────────────────────────────────────────
  const goHashtag = useCallback((name: string) => {
    router.push({ pathname: '/hashtag/[tag]', params: { tag: name } } as any);
  }, [router]);

  // ── Navigate to post detail ───────────────────────────────────────────────
  const goPost = useCallback((id: string) => {
    router.push({ pathname: '/post/[id]', params: { id } } as any);
  }, [router]);

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <Text allowFontScaling={false} style={s.title}>Explore</Text>
        <TouchableOpacity onPress={() => router.push('/reels' as any)} style={s.reelsBtn}>
          <Ionicons name="play-circle-outline" size={20} color="#4f46e5" />
          <Text allowFontScaling={false} style={s.reelsBtnTxt}>Reels</Text>
        </TouchableOpacity>
      </View>

      {/* ── Search bar ─────────────────────────────────────────────────────── */}
      <View style={s.searchWrap}>
        <Ionicons name="search-outline" size={18} color="#9ca3af" style={{ marginRight: 8 }} />
        <TextInput
          value={query}
          onChangeText={t => { setQuery(t); setSearchType('all'); }}
          placeholder="Search posts, people, communities, #tags…"
          placeholderTextColor="#9ca3af"
          style={s.searchInput}
          autoCapitalize="none"
          returnKeyType="search"
          allowFontScaling={false}
        />
        {isLoading && isSearching && (
          <ActivityIndicator size="small" color="#4f46e5" style={{ marginLeft: 8 }} />
        )}
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} style={{ marginLeft: 6 }}>
            <Ionicons name="close-circle" size={18} color="#9ca3af" />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Search type tabs (only when searching) ───────────────────────── */}
      {isSearching && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.tabs}
          contentContainerStyle={s.tabsContent}
        >
          {SEARCH_TABS.map(t => (
            <TouchableOpacity
              key={t.type}
              onPress={() => setSearchType(t.type)}
              style={[s.tab, searchType === t.type && s.tabActive]}
            >
              <Text allowFontScaling={false} style={[s.tabText, searchType === t.type && s.tabTextActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* ── Content ────────────────────────────────────────────────────────── */}
      {isLoading && !results && !feed ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color="#4f46e5" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 80 + insets.bottom }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            !isSearching ? (
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={refetchFeed}
                tintColor="#4f46e5"
                colors={['#4f46e5']}
              />
            ) : undefined
          }
        >
          {/* ══ SEARCH RESULTS ══ */}
          {isSearching && results && (
            <View>
              {/* Posts */}
              {(searchType === 'all' || searchType === 'posts') &&
               results.posts?.length > 0 && (
                <View style={s.section}>
                  <SectionHeader title={`Posts (${results.posts.length})`} />
                  {results.posts.map((p: Post) => (
                    <PostCard
                      key={p.id}
                      post={p}
                      onNavigateToDetail={() => goPost(p.id)}
                    />
                  ))}
                </View>
              )}

              {/* People */}
              {(searchType === 'all' || searchType === 'people') &&
               results.people?.length > 0 && (
                <View style={s.section}>
                  <SectionHeader title={`People (${results.people.length})`} />
                  {results.people.map((u: any) => (
                    <UserCard
                      key={u.id}
                      user={u}
                      onPress={() =>
                        router.push({ pathname: '/profile/[id]', params: { id: u.id } } as any)
                      }
                    />
                  ))}
                </View>
              )}

              {/* Communities */}
              {(searchType === 'all' || searchType === 'communities') &&
               results.communities?.length > 0 && (
                <View style={s.section}>
                  <SectionHeader title={`Communities (${results.communities.length})`} />
                  {results.communities.map((c: any) => (
                    <CommunityCard key={c.id} community={c} />
                  ))}
                </View>
              )}

              {/* Hashtags */}
              {(searchType === 'all' || searchType === 'hashtags') &&
               results.hashtags?.length > 0 && (
                <View style={s.section}>
                  <SectionHeader title={`Hashtags (${results.hashtags.length})`} />
                  <View style={s.tagsWrap}>
                    {results.hashtags.map((t: any) => (
                      <HashtagPill key={t.id} tag={t} onPress={() => goHashtag(t.name)} />
                    ))}
                  </View>
                </View>
              )}

              {/* Empty state */}
              {!isLoading &&
               !results.posts?.length &&
               !results.people?.length &&
               !results.communities?.length &&
               !results.hashtags?.length && (
                <View style={s.center}>
                  <Ionicons name="search-outline" size={48} color="#d1d5db" />
                  <Text allowFontScaling={false} style={s.emptyText}>
                    No results for "{debounced}"
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* ══ EXPLORE FEED ══ */}
          {!isSearching && feed && (
            <>
              {/* Live Voice Rooms */}
              {feed.liveVoiceRooms?.length > 0 && (
                <View style={s.section}>
                  <SectionHeader title="Live Voice Rooms" live />
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={s.cardsRow}
                  >
                    {feed.liveVoiceRooms.map((room: any) => {
                      const card: LiveCardData = {
                        id:          `live-voice-${room.id}`,
                        type:        'LIVE_ROOM_SHARE',
                        refEntityId: room.id,
                        authorId:    room.host?.id ?? '',
                        author:      room.host ?? null,
                        liveData: {
                          title:            room.title,
                          description:      room.description,
                          coverEmoji:       room.coverEmoji ?? '🎙️',
                          coverImageUrl:    room.coverImageUrl ?? null,
                          participantCount: room._count?.participants ?? 0,
                          isLive:           true,
                        },
                      };
                      return (
                        <View key={room.id} style={s.cardWrapper}>
                          <LiveCard card={card} />
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              {/* Live Classes */}
              {feed.liveLiveClasses?.length > 0 && (
                <View style={s.section}>
                  <SectionHeader title="Live Classes" live />
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={s.cardsRow}
                  >
                    {feed.liveLiveClasses.map((lc: any) => {
                      const card: LiveCardData = {
                        id:          `live-class-${lc.id}`,
                        type:        'LIVE_CLASS_SHARE',
                        refEntityId: lc.id,
                        authorId:    lc.teacher?.user?.id ?? '',
                        author:      lc.teacher?.user ?? null,
                        liveData: {
                          title:            lc.title,
                          description:      lc.description,
                          coverEmoji:       '📹',
                          coverImageUrl:    null,
                          participantCount: lc._count?.participants ?? 0,
                          className:        lc.class?.name ?? null,
                          isLive:           true,
                        },
                      };
                      return (
                        <View key={lc.id} style={s.cardWrapper}>
                          <LiveCard card={card} />
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              {/* Trending hashtags */}
              {feed.trendingHashtags?.length > 0 && (
                <View style={s.section}>
                  <SectionHeader title="🔥 Trending" />
                  <View style={s.tagsWrap}>
                    {feed.trendingHashtags.map((t: any) => (
                      <HashtagPill key={t.id} tag={t} onPress={() => goHashtag(t.name)} />
                    ))}
                  </View>
                </View>
              )}

              {/* Suggested people */}
              {feed.suggestedPeople?.length > 0 && (
                <View style={s.section}>
                  <SectionHeader title="👥 People you may know" />
                  {feed.suggestedPeople.map((u: any) => (
                    <UserCard
                      key={u.id}
                      user={u}
                      onPress={() =>
                        router.push({ pathname: '/profile/[id]', params: { id: u.id } } as any)
                      }
                    />
                  ))}
                </View>
              )}

              {/* Suggested communities */}
              {feed.suggestedCommunities?.length > 0 && (
                <View style={s.section}>
                  <SectionHeader title="🏘 Communities to join" />
                  {feed.suggestedCommunities.map((c: any) => (
                    <CommunityCard key={c.id} community={c} />
                  ))}
                </View>
              )}

              {/* Trending posts */}
              {feed.trendingPosts?.length > 0 && (
                <View style={s.section}>
                  <SectionHeader title="📈 Trending Posts" />
                  {feed.trendingPosts.map((p: Post) => (
                    <PostCard
                      key={p.id}
                      post={p}
                      onNavigateToDetail={() => goPost(p.id)}
                    />
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f9fafb' },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff',
                  borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  title:        { fontSize: 22, fontWeight: '900', color: '#111827' },
  reelsBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#eef2ff',
                  paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  reelsBtnTxt:  { fontSize: 13, fontWeight: '700', color: '#4f46e5' },
  searchWrap:   { flexDirection: 'row', alignItems: 'center', margin: 12, marginBottom: 0,
                  backgroundColor: '#fff', borderRadius: 14, borderWidth: 1,
                  borderColor: '#e5e7eb', paddingHorizontal: 12, paddingVertical: 10 },
  searchInput:  { flex: 1, fontSize: 14, color: '#111827' },
  tabs:         { maxHeight: 44 },
  tabsContent:  { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  tab:          { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
                  backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb' },
  tabActive:    { backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  tabText:      { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  tabTextActive:{ color: '#fff' },
  center:       { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText:    { color: '#9ca3af', fontSize: 15 },
  section:      { marginTop: 8 },
  sectionHeader:{ flexDirection: 'row', alignItems: 'center', gap: 6,
                  paddingHorizontal: 16, paddingVertical: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#374151' },
  liveDot:      { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ef4444' },
  tagsWrap:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8,
                  paddingHorizontal: 16, paddingBottom: 8 },
  tag:          { flexDirection: 'row', alignItems: 'center', gap: 3,
                  backgroundColor: '#ede9fe', paddingHorizontal: 12,
                  paddingVertical: 6, borderRadius: 20 },
  tagHash:      { fontSize: 13, fontWeight: '800', color: '#4f46e5' },
  tagName:      { fontSize: 13, fontWeight: '600', color: '#4f46e5' },
  tagCount:     { fontSize: 11, color: '#7c3aed', marginLeft: 2 },
  cardsRow:     { paddingHorizontal: 16, gap: 10, paddingBottom: 4 },
  cardWrapper:  { width: 270 },
});

