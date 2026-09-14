/**
 * HALQA Mobile — Reels Screen
 * Route: /reels
 *
 * TikTok-style vertical snap scroll of video posts.
 * - Full-screen per reel with FlatList + pagingEnabled
 * - Like, Comment, Share, Bookmark actions
 * - Author info + caption overlay
 * - Infinite scroll
 */
import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, Dimensions, StatusBar
} from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDistanceToNow } from 'date-fns';
import { showMessage } from 'react-native-flash-message';
import { Video, ResizeMode } from 'expo-av';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';
import { useAuthStore } from '@/store/auth.store';

const { width: SW, height: SH } = Dimensions.get('window');

interface ReelPost {
  id: string;
  body: string;
  authorId: string;
  author: { id: string; firstName: string; lastName: string; avatarUrl: string | null };
  media: { id: string; url: string; type: string }[];
  _count: { reactions: number; comments: number };
  reactions?: { type: string; userId: string }[];
  isFollowing?: boolean;
  bookmarks?: any[];
  createdAt: string;
}

function ReelItem({
  item, isActive, onComment,
}: {
  item: ReelPost;
  isActive: boolean;
  onComment: (postId: string) => void;
}) {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const video = item.media.find(m => m.type === 'VIDEO');
  const videoRef = useRef<Video>(null);

  const myReaction = item.reactions?.find(r => r.userId === user?.id)?.type ?? null;
  const [liked,      setLiked]      = useState(!!myReaction);
  const [likeCount,  setLikeCount]  = useState(item._count.reactions);
  const [bookmarked, setBookmarked] = useState((item.bookmarks?.length ?? 0) > 0);
  const [following,  setFollowing]  = useState(item.isFollowing ?? false);

  // Mute state
  const [muted, setMuted] = useState(true);

  // React mutation
  const reactMutation = useMutation({
    mutationFn: () => liked
      ? api.delete(`/posts/${item.id}/react`)
      : api.post(`/posts/${item.id}/react`, { type: 'LIKE' }),
    onMutate: () => {
      setLiked(v => !v);
      setLikeCount(v => liked ? v - 1 : v + 1);
    },
    onError: () => {
      setLiked(v => !v);
      setLikeCount(v => liked ? v + 1 : v - 1);
    },
  });

  const bookmarkMutation = useMutation({
    mutationFn: () => bookmarked
      ? api.delete(`/posts/${item.id}/bookmark`)
      : api.post(`/posts/${item.id}/bookmark`),
    onMutate: () => setBookmarked(v => !v),
    onError:  () => setBookmarked(v => !v),
  });

  const followMutation = useMutation({
    mutationFn: () => following
      ? api.delete(`/social/follow/${item.authorId}`)
      : api.post(`/social/follow/${item.authorId}`),
    onMutate: () => setFollowing(v => !v),
    onError:  () => setFollowing(v => !v),
    onSuccess: () => showMessage({ message: following ? 'Unfollowed' : 'Following', type: 'success', duration: 1200 }),
  });

  const initials = `${item.author.firstName?.charAt(0) ?? ''}${item.author.lastName?.charAt(0) ?? ''}`.toUpperCase();
  const isOwn = user?.id === item.authorId;

  return (
    <View style={r.reel}>
      <StatusBar hidden />

      {/* Video or fallback */}
      {video ? (
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setMuted(v => !v)}>
          <Video
            ref={videoRef}
            source={{ uri: video.url.startsWith('http') ? video.url : `${api.defaults.baseURL?.replace('/api/v1', '')}${video.url}` }}
            style={StyleSheet.absoluteFill}
            resizeMode={ResizeMode.COVER}
            shouldPlay={isActive}
            isLooping
            isMuted={muted}
          />
          {/* Mute indicator */}
          <View style={r.muteBtn}>
            <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={20} color="rgba(255,255,255,0.9)" />
          </View>
        </TouchableOpacity>
      ) : (
        <View style={[StyleSheet.absoluteFill, r.noVideo]}>
          <Ionicons name="videocam-off-outline" size={48} color="rgba(255,255,255,0.3)" />
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 8 }}>No video</Text>
        </View>
      )}

      {/* Right action bar */}
      <View style={r.rightBar}>
        {/* Author avatar */}
        <View style={r.avatarWrap}>
          {item.author.avatarUrl
            ? <Image source={{ uri: avatarUrl(item.author.avatarUrl, `${item.author.firstName} ${item.author.lastName}`) }} style={r.avatar} />
            : <Text style={r.avatarInitials}>{initials}</Text>
          }
          {!isOwn && (
            <TouchableOpacity style={[r.followBtn, following && r.followBtnActive]}
              onPress={() => followMutation.mutate(undefined)}>
              <Ionicons name={following ? 'checkmark' : 'add'} size={12} color="#fff" />
            </TouchableOpacity>
          )}
        </View>

        {/* Like */}
        <TouchableOpacity style={r.actionBtn} onPress={() => reactMutation.mutate(undefined)}>
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={32} color={liked ? '#ef4444' : '#fff'} />
          <Text style={r.actionCount}>{likeCount}</Text>
        </TouchableOpacity>

        {/* Comment */}
        <TouchableOpacity style={r.actionBtn} onPress={() => onComment(item.id)}>
          <Ionicons name="chatbubble-outline" size={30} color="#fff" />
          <Text style={r.actionCount}>{item._count.comments}</Text>
        </TouchableOpacity>

        {/* Bookmark */}
        <TouchableOpacity style={r.actionBtn} onPress={() => bookmarkMutation.mutate(undefined)}>
          <Ionicons name={bookmarked ? 'bookmark' : 'bookmark-outline'} size={28} color={bookmarked ? '#fbbf24' : '#fff'} />
        </TouchableOpacity>
      </View>

      {/* Bottom info */}
      <View style={r.bottomOverlay}>
        <Text style={r.authorName} numberOfLines={1}>
          @{item.author.firstName} {item.author.lastName}
        </Text>
        {item.body ? (
          <Text style={r.caption} numberOfLines={3}>{item.body}</Text>
        ) : null}
        <Text style={r.timeAgo}>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</Text>
      </View>
    </View>
  );
}

export default function ReelsScreen() {
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(0);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);

  const { data, fetchNextPage, hasNextPage, isLoading, isError } = useInfiniteQuery({
    queryKey: ['reels'],
    queryFn: ({ pageParam }) =>
      api.get('/posts/feed', { params: { cursor: pageParam, limit: 10, mediaType: 'VIDEO' } })
        .then(r => r.data.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: any) => page?.nextCursor ?? undefined,
    staleTime: 60_000,
  });

  const reels: ReelPost[] = data?.pages.flatMap((p: any) => p?.items ?? []).filter((p: ReelPost) =>
    p.media?.some(m => m.type === 'VIDEO')
  ) ?? [];

  const handleViewableChange = useCallback(({ viewableItems }: any) => {
    if (viewableItems?.[0]?.index != null) {
      setActiveIndex(viewableItems[0].index);
    }
  }, []);

  if (isLoading) {
    return (
      <View style={[r.screen, r.center]}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (isError || reels.length === 0) {
    return (
      <View style={[r.screen, r.center]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Ionicons name="videocam-outline" size={56} color="rgba(255,255,255,0.3)" />
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 12 }}>No Reels Yet</Text>
        <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, marginTop: 6, textAlign: 'center', paddingHorizontal: 32 }}>
          Post a video to see it appear here
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 24 }}>
          <Text style={{ color: '#a5b4fc', fontSize: 16, fontWeight: '600' }}>← Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={r.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Back button */}
      <TouchableOpacity style={[r.backBtn, { top: insets.top + 8 }]} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={26} color="#fff" />
      </TouchableOpacity>

      <FlatList
        data={reels}
        keyExtractor={item => item.id}
        renderItem={({ item, index }) => (
          <ReelItem
            item={item}
            isActive={index === activeIndex}
            onComment={setCommentPostId}
          />
        )}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={SH}
        decelerationRate="fast"
        onViewableItemsChanged={handleViewableChange}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        onEndReached={() => { if (hasNextPage) fetchNextPage(); }}
        onEndReachedThreshold={0.5}
        getItemLayout={(_, index) => ({ length: SH, offset: SH * index, index })}
      />
    </View>
  );
}

const r = StyleSheet.create({
  screen:        { flex: 1, backgroundColor: '#000' },
  center:        { justifyContent: 'center', alignItems: 'center' },
  reel:          { width: SW, height: SH, backgroundColor: '#111' },
  noVideo:       { justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e' },
  muteBtn:       { position: 'absolute', top: 60, right: 16, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20, padding: 6 },
  rightBar:      { position: 'absolute', right: 12, bottom: 120, alignItems: 'center', gap: 20 },
  avatarWrap:    { alignItems: 'center', marginBottom: 4 },
  avatar:        { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: '#fff' },
  avatarInitials:{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#4f46e5', justifyContent: 'center', alignItems: 'center', fontSize: 16, fontWeight: '800', color: '#fff', overflow: 'hidden', textAlign: 'center', lineHeight: 44 },
  followBtn:     { width: 20, height: 20, borderRadius: 10, backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', marginTop: -8, borderWidth: 2, borderColor: '#fff' },
  followBtnActive: { backgroundColor: '#22c55e' },
  actionBtn:     { alignItems: 'center', gap: 2 },
  actionCount:   { color: '#fff', fontSize: 12, fontWeight: '700' },
  bottomOverlay: { position: 'absolute', left: 16, right: 80, bottom: 60 },
  authorName:    { color: '#fff', fontSize: 15, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  caption:       { color: 'rgba(255,255,255,0.9)', fontSize: 14, lineHeight: 20, marginTop: 4, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  timeAgo:       { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 4 },
  backBtn:       { position: 'absolute', left: 12, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 20, padding: 6 },
});

