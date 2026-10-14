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
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, Dimensions, StatusBar,
  Modal, Pressable, TextInput, Platform, KeyboardAvoidingView as RNKeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDistanceToNow } from 'date-fns';
import { showMessage } from 'react-native-flash-message';
import { VideoView, useVideoPlayer } from 'expo-video';
import api from '@/lib/api';
import { avatarUrl } from '@/lib/avatar';
import { useAuthStore } from '@/store/auth.store';
import { Share } from 'react-native';
import { getSocket } from '@/lib/socket';

const { width: SW, height: SH } = Dimensions.get('window');

// ─── Inline comment sheet rendered inside the reels Modal ─────────────────────
function ReelCommentsSheet({ postId, onClose }: { postId: string; onClose: () => void }) {
  const { user }    = useAuthStore();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['comments', postId],
    queryFn: ({ pageParam }) =>
      api.get(`/posts/${postId}/comments`, { params: { cursor: pageParam, limit: 20 } })
        .then(r => r.data.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: any) => page?.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const comments: any[] = data?.pages.flatMap((p: any) => p.items ?? []) ?? [];

  const addMutation = useMutation({
    mutationFn: (body: string) => api.post(`/posts/${postId}/comments`, { body }),
    onSuccess: () => {
      setText('');
      queryClient.invalidateQueries({ queryKey: ['comments', postId] });
      queryClient.invalidateQueries({ queryKey: ['reels'] });
    },
    onError: () => showMessage({ message: 'Failed to post comment', type: 'danger' }),
  });

  const handleSend = () => {
    const t = text.trim();
    if (!t || addMutation.isPending) return;
    addMutation.mutate(t);
  };

  return (
    <Pressable style={r.sheetBackdrop} onPress={onClose}>
      <Pressable style={r.sheet} onPress={e => e.stopPropagation()}>
        {/* Handle bar */}
        <View style={r.sheetHandle} />
        <Text style={r.sheetTitle}>Comments</Text>

        {isLoading ? (
          <ActivityIndicator size="small" color="#4f46e5" style={{ marginVertical: 20 }} />
        ) : (
          <ScrollView style={{ maxHeight: SH * 0.45 }} keyboardShouldPersistTaps="handled">
            {comments.length === 0 && (
              <Text style={r.sheetEmpty}>No comments yet — be the first!</Text>
            )}
            {comments.map((c: any) => (
              <View key={c.id} style={r.commentItem}>
                <View style={r.commentAv}>
                  <Text style={r.commentAvTxt}>
                    {(c.author?.firstName?.[0] ?? '') + (c.author?.lastName?.[0] ?? '')}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={r.commentName}>{c.author?.firstName} {c.author?.lastName}</Text>
                  <Text style={r.commentBody}>{c.body}</Text>
                </View>
              </View>
            ))}
            {hasNextPage && (
              <TouchableOpacity onPress={() => fetchNextPage()} style={{ alignItems: 'center', padding: 8 }}>
                {isFetchingNextPage
                  ? <ActivityIndicator size="small" color="#4f46e5" />
                  : <Text style={{ color: '#4f46e5', fontSize: 13, fontWeight: '600' }}>Load more</Text>
                }
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {/* Input */}
        <RNKeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={r.sheetInput}>
            <TextInput
              style={r.sheetTextInput}
              value={text}
              onChangeText={setText}
              placeholder="Add a comment…"
              placeholderTextColor="#9ca3af"
              multiline
              maxLength={1000}
            />
            <TouchableOpacity
              style={[r.sheetSend, (!text.trim() || addMutation.isPending) && { opacity: 0.4 }]}
              onPress={handleSend}
              disabled={!text.trim() || addMutation.isPending}
            >
              {addMutation.isPending
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="send" size={16} color="#fff" />
              }
            </TouchableOpacity>
          </View>
        </RNKeyboardAvoidingView>
      </Pressable>
    </Pressable>
  );
}

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
  const videoUri = video
    ? (video.url.startsWith('http') ? video.url : `${api.defaults.baseURL?.replace('/api/v1', '')}${video.url}`)
    : null;

  const myReaction = item.reactions?.find(r => r.userId === user?.id)?.type ?? null;
  const [liked,      setLiked]      = useState(!!myReaction);
  const [likeCount,  setLikeCount]  = useState(item._count.reactions);
  const [bookmarked, setBookmarked] = useState((item.bookmarks?.length ?? 0) > 0);
  const [following,  setFollowing]  = useState(item.isFollowing ?? false);
  const [muted,      setMuted]      = useState(true);

  // expo-video: create player instance; loop and muted by default
  const player = useVideoPlayer(videoUri ?? '', p => {
    p.loop    = true;
    p.muted   = true;
    p.volume  = 1;
  });

  // MF-005: track buffering and error state for playback feedback
  const [isBuffering, setIsBuffering] = useState(false);
  const [videoError,  setVideoError]  = useState(false);

  // Play/pause based on whether this reel is the visible one
  React.useEffect(() => {
    if (!videoUri) return;
    if (isActive) {
      player.play();
    } else {
      player.pause();
    }
  }, [isActive, player, videoUri]);

  // Mirror mute state to player
  React.useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  // Buffering / error status via player events
  React.useEffect(() => {
    const sub = player.addListener('statusChange', (status: any) => {
      if (status === 'error') {
        setVideoError(true);
        setIsBuffering(false);
      } else {
        setVideoError(false);
        setIsBuffering(status === 'loading');
      }
    });
    return () => sub.remove();
  }, [player]);

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
          {/* Error fallback — shown when video fails to load */}
          {videoError ? (
            <View style={[StyleSheet.absoluteFill, r.noVideo]}>
              <Ionicons name="alert-circle-outline" size={48} color="rgba(255,100,100,0.8)" />
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 8 }}>Video unavailable</Text>
            </View>
          ) : (
            <VideoView
              player={player}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              nativeControls={false}
            />
          )}
          {/* Buffering spinner overlay */}
          {isBuffering && !videoError && (
            <View style={r.bufferOverlay} pointerEvents="none">
              <ActivityIndicator size="large" color="rgba(255,255,255,0.85)" />
            </View>
          )}
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

        {/* Share */}
        <TouchableOpacity
          style={r.actionBtn}
          onPress={() => {
            const url = `${api.defaults.baseURL?.replace('/api/v1', '') ?? ''}/feed/post/${item.id}`;
            Share.share({ message: url, title: 'Check out this reel on HALQA' }).catch(() => {});
          }}
        >
          <Ionicons name="share-social-outline" size={26} color="#fff" />
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
  const queryClient = useQueryClient();
  const [activeIndex, setActiveIndex] = useState(0);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);

  const { data, fetchNextPage, hasNextPage, isLoading, isError } = useInfiniteQuery({
    queryKey: ['reels'],
    queryFn: ({ pageParam }) =>
      api.get('/posts/reels', { params: { cursor: pageParam, limit: 10 } })
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
      const idx = viewableItems[0].index;
      setActiveIndex(idx);
      // Fire-and-forget view tracking when a reel becomes active
      const activeReel = reels[idx];
      if (activeReel?.id) {
        api.post(`/posts/${activeReel.id}/view`).catch(() => {});
      }
    }
  }, [reels]);

  // ── Socket — invalidate reels cache when a new VIDEO post is created ─────────
  React.useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('feed:join');

    const onPostCreate = (d: { post: ReelPost }) => {
      if (d.post.media?.some((m: any) => m.type === 'VIDEO')) {
        queryClient.invalidateQueries({ queryKey: ['reels'] });
      }
    };

    socket.on('post:create', onPostCreate);
    return () => {
      socket.emit('feed:leave');
      socket.off('post:create', onPostCreate);
    };
  }, [queryClient]);

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

      {/* Comment sheet — renders when user taps Comment on any reel */}
      <Modal
        visible={!!commentPostId}
        transparent
        animationType="slide"
        onRequestClose={() => setCommentPostId(null)}
      >
        {commentPostId && (
          <ReelCommentsSheet
            postId={commentPostId}
            onClose={() => setCommentPostId(null)}
          />
        )}
      </Modal>
    </View>
  );
}

const r = StyleSheet.create({
  screen:        { flex: 1, backgroundColor: '#000' },
  center:        { justifyContent: 'center', alignItems: 'center' },
  reel:          { width: SW, height: SH, backgroundColor: '#111' },
  noVideo:       { justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e' },
  bufferOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
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
  // ─── Comment sheet styles ───────────────────────────────────────────────────
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet:         { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12, maxHeight: SH * 0.75 },
  sheetHandle:   { width: 40, height: 4, backgroundColor: '#e5e7eb', borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  sheetTitle:    { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12, textAlign: 'center' },
  sheetEmpty:    { textAlign: 'center', color: '#9ca3af', paddingVertical: 24, fontSize: 14 },
  commentItem:   { flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  commentAv:     { width: 32, height: 32, borderRadius: 16, backgroundColor: '#4f46e5', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  commentAvTxt:  { fontSize: 12, fontWeight: '700', color: '#fff' },
  commentName:   { fontSize: 12, fontWeight: '700', color: '#111827', marginBottom: 2 },
  commentBody:   { fontSize: 13, color: '#374151', lineHeight: 18 },
  sheetInput:    { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f3f4f6', marginTop: 8 },
  sheetTextInput:{ flex: 1, backgroundColor: '#f3f4f6', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, fontSize: 14, color: '#111827', maxHeight: 80 },
  sheetSend:     { width: 36, height: 36, borderRadius: 18, backgroundColor: '#4f46e5', justifyContent: 'center', alignItems: 'center' },
});

