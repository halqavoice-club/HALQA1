/**
 * HALQA Mobile — Explore / Discovery Screen
 * Updated: voice rooms as circles + live classes as cards
 */
import { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView,
  TouchableOpacity, ActivityIndicator, Image,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import UserCard from '@/components/social/UserCard';
import CommunityCard from '@/components/communities/CommunityCard';
import { LiveCard, type LiveCardData } from '@/components/feed/LiveCard';
import { getAvatarUrl } from '@/lib/avatar';

export default function ExploreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 350);
  const isSearching = debounced.length >= 2;

  const { data: feed, isLoading: loadingFeed } = useQuery({
    queryKey: ['explore-feed'],
    queryFn: () => api.get('/explore').then(r => r.data.data),
    enabled: !isSearching,
    staleTime: 120_000,
  });

  const { data: results, isLoading: loadingSearch } = useQuery({
    queryKey: ['explore-search', debounced],
    queryFn: () => api.get('/explore/search', { params: { q: debounced, limit: 20 } }).then(r => r.data.data),
    enabled: isSearching,
  });

  const isLoading = isSearching ? loadingSearch : loadingFeed;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header + Search */}
      <View style={styles.header}>
        <Text allowFontScaling={false} style={styles.title}>Explore</Text>
      </View>
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color="#9ca3af" style={styles.searchIcon} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search posts, people, communities…"
          placeholderTextColor="#9ca3af"
          style={styles.searchInput}
          autoCapitalize="none"
          allowFontScaling={false}
        />
        {isLoading && <ActivityIndicator size="small" color="#4f46e5" />}
      </View>

      {isLoading && !results && !feed ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#4f46e5" /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 80 + insets.bottom }} showsVerticalScrollIndicator={false}>
          {/* SEARCH RESULTS */}
          {isSearching && results && (
            <View style={styles.section}>
              {results.people?.length > 0 && (
                <>
                  <Text allowFontScaling={false} style={styles.sectionTitle}>People</Text>
                  {results.people.map((u: any) => (
                    <UserCard key={u.id} user={u} onPress={() => router.push({ pathname: '/profile/[id]', params: { id: u.id } } as any)} />
                  ))}
                </>
              )}
              {results.communities?.length > 0 && (
                <>
                  <Text allowFontScaling={false} style={styles.sectionTitle}>Communities</Text>
                  {results.communities.map((c: any) => (
                    <CommunityCard key={c.id} community={c} />
                  ))}
                </>
              )}
              {results.hashtags?.length > 0 && (
                <>
                  <Text allowFontScaling={false} style={styles.sectionTitle}>Hashtags</Text>
                  <View style={styles.tagsRow}>
                    {results.hashtags.map((t: any) => (
                      <TouchableOpacity key={t.id} style={styles.tag}
                        onPress={() => router.push({ pathname: '/hashtag/[tag]', params: { tag: t.name } } as any)}>
                        <Text allowFontScaling={false} style={styles.tagText}>#{t.name}</Text>
                        <Text allowFontScaling={false} style={styles.tagCount}>{t.postCount}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              {!results.people?.length && !results.communities?.length && !results.hashtags?.length && (
                <Text allowFontScaling={false} style={styles.empty}>No results for "{debounced}"</Text>
              )}
            </View>
          )}

          {/* EXPLORE FEED */}
          {!isSearching && feed && (
            <>
              {/* Live Voice Rooms — cards with profile circle inside */}
              {feed.liveVoiceRooms?.length > 0 && (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <View style={styles.liveDot} />
                    <Ionicons name="mic" size={14} color="#7c3aed" />
                    <Text allowFontScaling={false} style={[styles.sectionTitle, { color: '#7c3aed' }]}>
                      Live Voice Rooms
                    </Text>
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.cardsRow}
                  >
                    {feed.liveVoiceRooms.map((room: any) => {
                      const card: LiveCardData = {
                        id:            `live-voice-${room.id}`,
                        type:          'LIVE_ROOM_SHARE',
                        refEntityId:   room.id,
                        authorId:      room.host?.id ?? '',
                        author:        room.host ?? null,
                        liveData: {
                          title:            room.title,
                          description:      room.description,
                          coverEmoji:       room.coverEmoji ?? '🎙️',
                          coverImageUrl:    room.coverImageUrl ?? null,
                          participantCount: room._count?.participants ?? 0,
                          isLive:           true,
                        },
                      }
                      return (
                        <View key={room.id} style={styles.cardWrapper}>
                          <LiveCard card={card} />
                        </View>
                      )
                    })}
                  </ScrollView>
                </View>
              )}

              {/* Live Classes */}
              {feed.liveLiveClasses?.length > 0 && (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <View style={styles.liveDot} />
                    <Ionicons name="videocam" size={14} color="#ef4444" />
                    <Text allowFontScaling={false} style={[styles.sectionTitle, { color: '#ef4444' }]}>
                      Live Classes
                    </Text>
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.cardsRow}
                  >
                    {feed.liveLiveClasses.map((lc: any) => {
                      const card: LiveCardData = {
                        id:            `live-class-${lc.id}`,
                        type:          'LIVE_CLASS_SHARE',
                        refEntityId:   lc.id,
                        authorId:      lc.teacher?.user?.id ?? '',
                        author:        lc.teacher?.user ?? null,
                        liveData: {
                          title:            lc.title,
                          description:      lc.description,
                          coverEmoji:       '📹',
                          coverImageUrl:    null,
                          participantCount: lc._count?.participants ?? 0,
                          className:        lc.class?.name ?? null,
                          isLive:           true,
                        },
                      }
                      return (
                        <View key={lc.id} style={styles.cardWrapper}>
                          <LiveCard card={card} />
                        </View>
                      )
                    })}
                  </ScrollView>
                </View>
              )}
              {/* Trending hashtags */}
              {feed.trendingHashtags?.length > 0 && (
                <View style={styles.section}>
                  <Text allowFontScaling={false} style={styles.sectionTitle}>🔥 Trending</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
                    {feed.trendingHashtags.map((t: any) => (
                      <TouchableOpacity key={t.id} style={styles.tag}
                        onPress={() => router.push({ pathname: '/hashtag/[tag]', params: { tag: t.name } } as any)}>
                        <Text allowFontScaling={false} style={styles.tagText}>#{t.name}</Text>
                        <Text allowFontScaling={false} style={styles.tagCount}>{t.postCount}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Suggested people */}
              {feed.suggestedPeople?.length > 0 && (
                <View style={styles.section}>
                  <Text allowFontScaling={false} style={styles.sectionTitle}>👥 People you may know</Text>
                  {feed.suggestedPeople.map((u: any) => (
                    <UserCard key={u.id} user={u} onPress={() => router.push({ pathname: '/profile/[id]', params: { id: u.id } } as any)} />
                  ))}
                </View>
              )}

              {/* Suggested communities */}
              {feed.suggestedCommunities?.length > 0 && (
                <View style={styles.section}>
                  <Text allowFontScaling={false} style={styles.sectionTitle}>🏘 Communities to join</Text>
                  {feed.suggestedCommunities.map((c: any) => (
                    <CommunityCard key={c.id} community={c} />
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

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#f9fafb' },
  header:      { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff' },
  title:       { fontSize: 22, fontWeight: '900', color: '#111827' },
  searchBar:   { flexDirection: 'row', alignItems: 'center', margin: 12, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', paddingHorizontal: 12, paddingVertical: 10 },
  searchIcon:  { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#111827' },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center' },
  section:     { marginBottom: 8 },
  sectionTitle:{ fontSize: 14, fontWeight: '700', color: '#374151', paddingHorizontal: 16, paddingVertical: 10 },
  tagsRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  tag:         { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#ede9fe', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  tagText:     { fontSize: 13, fontWeight: '600', color: '#4f46e5' },
  tagCount:    { fontSize: 11, color: '#7c3aed' },
  empty:       { textAlign: 'center', color: '#9ca3af', padding: 32 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  liveDot:     { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ef4444' },
  cardsRow:    { paddingHorizontal: 16, gap: 10 },
  cardWrapper: { width: 270 },
});
