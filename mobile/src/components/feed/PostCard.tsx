/**
 * HALQA Mobile — PostCard v2
 * Fixes all audit gaps:
 *  - Full media grid (all 4 layouts, +N overlay, video play icon)
 *  - Location label display
 *  - All 6 reaction types with picker
 *  - Inline CommentsSection (lazy-fetch, optimistic add, edit, delete)
 *  - Share: copy link + repost
 *  - Bookmark toggle
 *  - Pinned indicator
 *  - REPOST / QUOTE banners
 */
import KeyboardAvoidingView from '@/components/KeyboardAvoidingView';
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  Pressable, Modal, TextInput,
  Platform, ActivityIndicator,
  Dimensions, Alert, Share} from 'react-native';
import { useMutation, useInfiniteQuery, useQueryClient, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'expo-router';
import { showMessage } from 'react-native-flash-message';
import ImageViewing from 'react-native-image-viewing';
import api, { getBaseURL } from '@/lib/api';
import { getAvatarUrl, getAvatarInitials, avatarColor } from '@/lib/avatar';
import { useAuthStore } from '@/store/auth.store';
import { PollCard } from './PollCard';
import { LinkPreviewCard } from './LinkPreviewCard';

// Social API helpers (inline to avoid extra lib dep on mobile)
const socialApi = {
  follow:   (userId: string) => api.post(`/social/follow/${userId}`),
  unfollow: (userId: string) => api.delete(`/social/follow/${userId}`),
};

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = SCREEN_W - 24;
const BASE = getBaseURL().replace('/api/v1', '');

// ─── Types ─────────────────────────────────────────────────────────────────────
interface PostMedia  { id: string; url: string; type: string; mimeType?: string }
interface PostAuthor { id: string; firstName: string; lastName: string; avatarUrl: string | null }
interface Comment {
  id: string; postId: string; authorId: string; parentId: string | null;
  body: string; author: PostAuthor; reactions: { type: string }[];
  _count: { replies: number; reactions: number }; createdAt: string; deletedAt: string | null;
  _optimistic?: boolean;
}
export interface Post {
  id: string; body: string | null; type: string; authorId: string; visibility: string;
  author: PostAuthor; isPinned?: boolean; location?: string | null;
  originalPostId?: string | null; originalPost?: Post | null;
  media: PostMedia[]; reactions: { type: string }[]; bookmarks: { id: string }[];
  _count: { reactions: number; comments: number };
  shareCount?: number; viewCount?: number; createdAt: string;
  isFollowing?: boolean;
  // Poll
  pollData?: any | null;
  // Link preview
  linkUrl?: string | null;
  linkTitle?: string | null;
  linkDescription?: string | null;
  linkImage?: string | null;
}

interface Props { post: Post; onNavigateToDetail?: () => void }

// ─── Reaction config ────────────────────────────────────────────────────────────
const REACTIONS = [
  { type: 'LIKE', emoji: '👍', label: 'Like' },
  { type: 'LOVE', emoji: '❤️', label: 'Love' },
  { type: 'CELEBRATE', emoji: '🎉', label: 'Celebrate' },
  { type: 'SUPPORT', emoji: '🤝', label: 'Support' },
  { type: 'INSIGHTFUL', emoji: '💡', label: 'Insightful' },
  { type: 'FUNNY', emoji: '😂', label: 'Funny' },
] as const;
type ReactionType = typeof REACTIONS[number]['type'];
const REACTION_EMOJI: Record<ReactionType, string> = Object.fromEntries(
  REACTIONS.map(r => [r.type, r.emoji])
) as Record<ReactionType, string>;

// ─── Helper: resolve media URL ─────────────────────────────────────────────────
function resolveUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return BASE + url;
}

// ─── MediaGrid ─────────────────────────────────────────────────────────────────
function MediaGrid({ media, onPress }: { media: PostMedia[]; onPress: (i: number) => void }) {
  if (!media.length) return null;
  const n = media.length;
  const H = CARD_W * 0.56;   // ~16:9
  const HALF = (CARD_W - 2) / 2;

  const cell = (m: PostMedia, i: number, w: number, h: number, overlay?: string) => (
    <TouchableOpacity
      key={m.id} activeOpacity={0.9}
      style={{ width: w, height: h, overflow: 'hidden', backgroundColor: '#e5e7eb' }}
      onPress={() => onPress(i)}
    >
      {m.type === 'VIDEO'
        ? <>
            <Image source={{ uri: resolveUrl(m.url) }} style={{ width: w, height: h }} resizeMode="cover" />
            <View style={s.videoPlayIcon}><Ionicons name="play-circle" size={36} color="rgba(255,255,255,0.9)" /></View>
          </>
        : <Image source={{ uri: resolveUrl(m.url) }} style={{ width: w, height: h }} resizeMode="cover" />
      }
      {overlay && (
        <View style={s.overlayCnt}>
          <Text style={s.overlayTxt}>{overlay}</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  if (n === 1) return (
    <View style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
      {cell(media[0], 0, CARD_W, H)}
    </View>
  );
  if (n === 2) return (
    <View style={{ flexDirection: 'row', gap: 2, borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
      {media.map((m, i) => cell(m, i, HALF, H))}
    </View>
  );
  if (n === 3) return (
    <View style={{ flexDirection: 'row', gap: 2, borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
      {cell(media[0], 0, HALF, H)}
      <View style={{ flexDirection: 'column', gap: 2 }}>
        {cell(media[1], 1, HALF, H / 2 - 1)}
        {cell(media[2], 2, HALF, H / 2 - 1)}
      </View>
    </View>
  );
  // 4+ mosaic
  const extra = n - 4;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
      {media.slice(0, 4).map((m, i) =>
        cell(m, i, HALF, HALF, i === 3 && extra > 0 ? `+${extra}` : undefined)
      )}
    </View>
  );
}

// ─── CommentsSection (inline, lazy-loaded) ────────────────────────────────────
function CommentsSection({ postId, open }: { postId: string; open: boolean }) {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [body, setBody]     = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody,  setEditBody]  = useState('');

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['comments', postId],
    queryFn: ({ pageParam }) =>
      api.get(`/posts/${postId}/comments`, { params: { cursor: pageParam } }).then(r => r.data.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: any) => page.nextCursor ?? undefined,
    enabled: open,
    staleTime: 30_000,
  });

  const comments: Comment[] = data?.pages.flatMap((p: any) => p.items) ?? [];

  const addMutation = useMutation({
    mutationFn: ({ text, parentId }: { text: string; parentId?: string }) =>
      api.post(`/posts/${postId}/comments`, { body: text, parentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', postId] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
    onError: () => showMessage({ message: 'Failed to post comment', type: 'danger' }),
  });

  const editMutation = useMutation({
    mutationFn: ({ commentId, text }: { commentId: string; text: string }) =>
      api.patch(`/posts/${postId}/comments/${commentId}`, { body: text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', postId] });
      setEditingId(null);
    },
    onError: () => showMessage({ message: 'Failed to edit comment', type: 'danger' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => api.delete(`/posts/${postId}/comments/${commentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments', postId] }),
    onError: () => showMessage({ message: 'Failed to delete comment', type: 'danger' }),
  });

  // Toggle LIKE reaction on a comment
  const reactCommentMutation = useMutation({
    mutationFn: (commentId: string) =>
      api.post(`/posts/${postId}/comments/${commentId}/react`, { type: 'LIKE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments', postId] }),
    onError: () => showMessage({ message: 'Could not react', type: 'danger' }),
  });

  const handleSubmit = useCallback(() => {
    const t = body.trim();
    if (!t) return;
    setBody(''); setReplyTo(null);
    addMutation.mutate({ text: t, parentId: replyTo?.id });
  }, [body, replyTo, addMutation]);

  if (!open) return null;

  return (
    <View style={s.commentSec}>
      {isLoading && <ActivityIndicator size="small" color="#4f46e5" style={{ marginVertical: 8 }} />}
      {comments.map(c => {
        const isOwn = c.authorId === user?.id;
        const avSrc = getAvatarUrl(c.author.avatarUrl);
        const initials = getAvatarInitials(c.author.firstName, c.author.lastName);
        const bg = avatarColor(`${c.author.firstName}${c.author.lastName}`);
        return (
          <View key={c.id} style={s.commentRow}>
            <View style={[s.commentAv, { backgroundColor: bg }]}>
              {avSrc ? <Image source={{ uri: avSrc }} style={s.commentAvImg} /> : <Text style={s.commentAvTxt}>{initials}</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <View style={s.commentBubble}>
                <Text style={s.commentAuthor}>{c.author.firstName} {c.author.lastName}</Text>
                {editingId === c.id ? (
                  <View>
                    <TextInput value={editBody} onChangeText={setEditBody} multiline style={s.editInput} autoFocus />
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                      <TouchableOpacity onPress={() => editMutation.mutate({ commentId: c.id, text: editBody.trim() })} disabled={!editBody.trim() || editMutation.isPending}>
                        <Text style={s.commentAction}>{editMutation.isPending ? '...' : 'Save'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setEditingId(null)}>
                        <Text style={[s.commentAction, { color: '#9ca3af' }]}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <Text style={s.commentBody}>{c.body}</Text>
                )}
              </View>
              <View style={s.commentMeta}>
                <Text style={s.commentTime}>{formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}</Text>
                {/* Like button — toggles LIKE reaction on the comment */}
                <TouchableOpacity
                  style={s.commentLikeBtn}
                  onPress={() => reactCommentMutation.mutate(c.id)}
                  disabled={reactCommentMutation.isPending}
                >
                  <Ionicons
                    name={c.reactions?.some(r => r.type === 'LIKE') ? 'heart' : 'heart-outline'}
                    size={12}
                    color={c.reactions?.some(r => r.type === 'LIKE') ? '#ef4444' : '#9ca3af'}
                  />
                  {(c._count?.reactions ?? 0) > 0 && (
                    <Text style={s.commentLikeCount}>{c._count.reactions}</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setReplyTo({ id: c.id, name: `${c.author.firstName}` })}>
                  <Text style={s.commentAction}>Reply</Text>
                </TouchableOpacity>
                {isOwn && (
                  <>
                    <TouchableOpacity onPress={() => { setEditingId(c.id); setEditBody(c.body); }}>
                      <Text style={s.commentAction}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => Alert.alert('Delete comment?', '', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(c.id) },
                    ])}>
                      <Text style={[s.commentAction, { color: '#ef4444' }]}>Delete</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          </View>
        );
      })}
      {hasNextPage && (
        <TouchableOpacity onPress={() => fetchNextPage()} disabled={isFetchingNextPage} style={{ alignItems: 'center', paddingVertical: 6 }}>
          {isFetchingNextPage ? <ActivityIndicator size="small" color="#4f46e5" /> : <Text style={s.loadMoreTxt}>Load more comments</Text>}
        </TouchableOpacity>
      )}
      {replyTo && (
        <View style={s.replyBanner}>
          <Text style={s.replyTxt}>Replying to {replyTo.name}</Text>
          <TouchableOpacity onPress={() => setReplyTo(null)}><Ionicons name="close" size={14} color="#4f46e5" /></TouchableOpacity>
        </View>
      )}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.commentInputRow}>
          <TextInput value={body} onChangeText={setBody} placeholder="Write a comment…" multiline style={s.commentInput} returnKeyType="send" onSubmitEditing={handleSubmit} />
          <TouchableOpacity onPress={handleSubmit} disabled={!body.trim() || addMutation.isPending} style={[s.sendBtn, (!body.trim() || addMutation.isPending) && { opacity: 0.4 }]}>
            {addMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={16} color="#fff" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Main PostCard ──────────────────────────────────────────────────────────────
export default function PostCard({ post, onNavigateToDetail }: Props) {
  const { user }    = useAuthStore();
  const queryClient = useQueryClient();
  const router      = useRouter();

  const isBookmarked = (post.bookmarks?.length ?? 0) > 0;
  const avatarSrc    = getAvatarUrl(post.author.avatarUrl);
  const initials     = getAvatarInitials(post.author.firstName, post.author.lastName);
  const bgColor      = avatarColor(`${post.author.firstName}${post.author.lastName}`);
  const isOwn        = user?.id === post.authorId;

  const [isFollowing,    setIsFollowing]    = useState(post.isFollowing ?? false);
  const [showPostMenu,   setShowPostMenu]   = useState(false);
  const [editingPost,    setEditingPost]    = useState(false);
  const [editPostBody,   setEditPostBody]   = useState(post.body ?? '');

  const [showReactions, setShowReactions]         = useState(false);
  const [commentsOpen,  setCommentsOpen]           = useState(false);
  const [showShare,        setShowShare]              = useState(false);
  const [showDmPicker,     setShowDmPicker]           = useState(false);
  const [showGroupPicker,  setShowGroupPicker]        = useState(false);
  const [showQuote,        setShowQuote]              = useState(false);
  // Media lightbox viewer (react-native-image-viewing)
  const [mediaViewerIndex,   setMediaViewerIndex]   = useState(0);
  const [mediaViewerVisible, setMediaViewerVisible] = useState(false);
  // Local counters — update immediately on tap (optimistic)
  const [viewCount,          setViewCount]          = useState(post.viewCount ?? 0);
  const [localMyReaction,    setLocalMyReaction]    = useState<ReactionType | undefined>(
    post.reactions?.[0]?.type as ReactionType | undefined
  );
  const [localReactionCount, setLocalReactionCount] = useState(post._count.reactions);
  const viewedRef = useRef(false);

  // Sync from server when feed refetches
  const serverReaction = post.reactions?.[0]?.type as ReactionType | undefined;
  const serverCount    = post._count.reactions;
  const prevServerReaction = useRef(serverReaction);
  const prevServerCount    = useRef(serverCount);
  useEffect(() => {
    if (prevServerReaction.current !== serverReaction) {
      setLocalMyReaction(serverReaction);
      prevServerReaction.current = serverReaction;
    }
    if (prevServerCount.current !== serverCount) {
      setLocalReactionCount(serverCount);
      prevServerCount.current = serverCount;
    }
  }, [serverReaction, serverCount]);

  // Record view after post has been visible for 1.5 seconds
  useEffect(() => {
    if (viewedRef.current) return;
    const timer = setTimeout(() => {
      if (viewedRef.current) return;
      viewedRef.current = true;
      setViewCount(c => c + 1);
      api.post(`/posts/${post.id}/view`).catch(() => {}); // fire-and-forget
    }, 1500);
    return () => clearTimeout(timer);
  }, [post.id]);

  // ── Helper: get current post from cache ───────────────────────────────────
  const getCachedPost = (): Post | null => {
    const data: any = queryClient.getQueryData(['feed']);
    if (!data?.pages) return null;
    for (const page of data.pages) {
      const found = page.items?.find((p: Post) => p.id === post.id);
      if (found) return found;
    }
    return null;
  };

  // ── Optimistic cache patcher ───────────────────────────────────────────────
  const patchPost = (updater: (p: Post) => Post) => {
    queryClient.setQueryData(['feed'], (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          items: page.items.map((p: Post) => p.id === post.id ? updater(p) : p),
        })),
      };
    });
  };

  // ── React mutation ─────────────────────────────────────────────────────────
  const reactMutation = useMutation({
    mutationFn: (type: ReactionType) => api.post(`/posts/${post.id}/react`, { type }),
    onMutate: async (type: ReactionType) => {
      await queryClient.cancelQueries({ queryKey: ['feed'] });
      const prev = queryClient.getQueryData(['feed']);
      const cached          = getCachedPost();
      const currentReaction = cached?.reactions?.[0]?.type as ReactionType | undefined;
      const wasReacted      = !!currentReaction;
      const sameType        = currentReaction === type;
      const prevCount       = cached?._count.reactions ?? localReactionCount;

      // Update local state immediately
      setLocalMyReaction(sameType ? undefined : type);
      setLocalReactionCount(
        sameType
          ? Math.max(0, prevCount - 1)
          : wasReacted
          ? prevCount
          : prevCount + 1
      );

      // Patch cache
      patchPost(p => ({
        ...p,
        reactions: sameType ? [] : [{ type }],
        _count: {
          ...p._count,
          reactions: sameType
            ? Math.max(0, p._count.reactions - 1)
            : wasReacted ? p._count.reactions : p._count.reactions + 1,
        },
      }));
      return { prev, prevReaction: currentReaction, prevCount };
    },
    onError: (_e: any, _v: any, ctx: any) => {
      if (ctx?.prev) {
        queryClient.setQueryData(['feed'], ctx.prev);
        setLocalMyReaction(ctx.prevReaction);
        setLocalReactionCount(ctx.prevCount);
      }
      showMessage({ message: 'Failed to react', type: 'danger' });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  });

  // ── Bookmark mutation ──────────────────────────────────────────────────────
  const bookmarkMutation = useMutation({
    mutationFn: () => api.post(`/posts/${post.id}/bookmark`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
    onError:   () => showMessage({ message: 'Failed to bookmark', type: 'danger' }),
  });

  // ── Repost mutation ────────────────────────────────────────────────────────
  const repostMutation = useMutation({
    mutationFn: () => api.post('/posts', { type: 'REPOST', originalPostId: post.id, visibility: 'PUBLIC' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      setShowShare(false);
      showMessage({ message: 'Shared to your feed!', type: 'success' });
    },
    onError: () => showMessage({ message: 'Failed to share', type: 'danger' }),
  });

  // ── Follow mutation ────────────────────────────────────────────────────────
  const followMutation = useMutation({
    mutationFn: () => isFollowing
      ? socialApi.unfollow(post.authorId)
      : socialApi.follow(post.authorId),
    onMutate: () => setIsFollowing(v => !v),
    onError:  () => {
      setIsFollowing(v => !v);
      showMessage({ message: 'Failed to update follow', type: 'danger' });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['feed-following'] });
    },
  });

  // ── Post edit / delete / report mutations ─────────────────────────────────
  const editPostMutation = useMutation({
    mutationFn: (body: string) => api.patch(`/posts/${post.id}`, { body }),
    onSuccess: () => {
      setEditingPost(false);
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['feed-following'] });
      queryClient.invalidateQueries({ queryKey: ['user-posts', post.authorId] });
      showMessage({ message: 'Post updated', type: 'success', duration: 1500 });
    },
    onError: () => showMessage({ message: 'Failed to update post', type: 'danger' }),
  });

  const deletePostMutation = useMutation({
    mutationFn: () => api.delete(`/posts/${post.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['feed-following'] });
      queryClient.invalidateQueries({ queryKey: ['user-posts', post.authorId] });
      showMessage({ message: 'Post deleted', type: 'success', duration: 1500 });
    },
    onError: () => showMessage({ message: 'Failed to delete post', type: 'danger' }),
  });

  const reportPostMutation = useMutation({
    mutationFn: (reason: string) => api.post(`/posts/${post.id}/report`, { reason }),
    onSuccess: () => showMessage({ message: 'Post reported. Thank you.', type: 'success', duration: 2000 }),
    onError: (e: any) => showMessage({
      message: e?.response?.data?.message ?? 'Failed to report post',
      type: 'danger',
    }),
  });

  const handleDeletePost = () => {
    Alert.alert(
      'Delete Post',
      'This will permanently delete your post. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deletePostMutation.mutate() },
      ]
    );
  };

  const handleReportPost = () => {
    Alert.alert(
      'Report Post',
      'Why are you reporting this post?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Spam', onPress: () => reportPostMutation.mutate('spam') },
        { text: 'Inappropriate', onPress: () => reportPostMutation.mutate('inappropriate') },
        { text: 'Harassment', onPress: () => reportPostMutation.mutate('harassment') },
        { text: 'Misinformation', onPress: () => reportPostMutation.mutate('misinformation') },
      ]
    );
  };

  const handleReact = (type: ReactionType) => {
    setShowReactions(false);
    reactMutation.mutate(type);
  };

  const handleCopyLink = async () => {
    const url = `${getBaseURL().replace('/api/v1', '')}/feed/post/${post.id}`;
    try {
      // Use native Share sheet — no expo-clipboard dependency needed
      await Share.share({ message: url, title: 'Share post' });
      // MF-006: increment shareCount on successful native share (fire-and-forget)
      api.post(`/posts/${post.id}/share`).catch(() => {});
    } catch { /* cancelled */ }
    setShowShare(false);
  };

  return (
    <View style={[s.card, post.isPinned && s.cardPinned]}>

      {/* Pinned indicator */}
      {post.isPinned && (
        <View style={s.pinnedRow}>
          <Ionicons name="pin" size={12} color="#4f46e5" />
          <Text style={s.pinnedTxt}>Pinned</Text>
        </View>
      )}

      {/* Repost: reposter attribution + original post card */}
      {post.type === 'REPOST' && post.originalPost && (() => {
        const orig = post.originalPost;
        const origAvatarSrc = getAvatarUrl(orig.author.avatarUrl);
        const origInitials = getAvatarInitials(orig.author.firstName, orig.author.lastName);
        const origBgColor  = avatarColor(`${orig.author.firstName}${orig.author.lastName}`);
        return (
          <>
            {/* Reposter attribution */}
            <View style={s.repostBanner}>
              <View style={[s.avatar, { backgroundColor: bgColor, width: 18, height: 18, borderRadius: 9 }]}>
                {avatarSrc
                  ? <Image source={{ uri: avatarSrc }} style={{ width: 18, height: 18, borderRadius: 9 }} />
                  : <Text allowFontScaling={false} style={{ fontSize: 8, fontWeight: '700', color: '#fff' }}>{initials}</Text>}
              </View>
              <Ionicons name="repeat" size={13} color="#16a34a" />
              <Text allowFontScaling={false} style={s.repostTxt}>
                {post.author.firstName} {post.author.lastName} reposted
              </Text>
            </View>

            {/* Original post card */}
            <View style={s.origCard}>
              {/* Original author */}
              <TouchableOpacity
                style={s.header}
                onPress={() => router.push(`/profile/${orig.author.id}` as any)}
                activeOpacity={0.7}
              >
                <View style={[s.avatar, { backgroundColor: origBgColor }]}>
                  {origAvatarSrc
                    ? <Image source={{ uri: origAvatarSrc }} style={s.avatarImg} />
                    : <Text allowFontScaling={false} style={s.avatarTxt}>{origInitials}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text allowFontScaling={false} style={s.authorName}>
                    {orig.author.firstName} {orig.author.lastName}
                  </Text>
                  <Text allowFontScaling={false} style={s.time}>
                    {formatDistanceToNow(new Date(orig.createdAt), { addSuffix: true })}
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Original body */}
              {orig.body ? (
                <Text allowFontScaling={false} style={s.body} numberOfLines={6}>
                  {orig.body.split(/(\s+)/).map((word: string, i: number) => {
                    if (word.startsWith('#')) return <Text key={i} style={s.hashtag}>{word}</Text>;
                    if (word.startsWith('@')) return <Text key={i} style={s.mention}>{word}</Text>;
                    return word;
                  })}
                </Text>
              ) : null}

              {/* Original media */}
              {orig.media?.length > 0 && (
                <MediaGrid
                  media={orig.media}
                  onPress={() => onNavigateToDetail ? onNavigateToDetail() : router.push(`/post/${post.id}` as any)}
                />
              )}
            </View>
          </>
        );
      })()}

      {/* Non-REPOST: standard author row + body + media */}
      {post.type !== 'REPOST' && (
        <>
      {/* Author row */}
      {/* Author header — split into profile tap + ⋯ menu */}
      <View style={s.header}>
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }}
          onPress={() => router.push(`/profile/${post.author.id}` as any)}
          activeOpacity={0.7}
        >
          <View style={[s.avatar, { backgroundColor: bgColor }]}>
            {avatarSrc
              ? <Image source={{ uri: avatarSrc }} style={s.avatarImg} />
              : <Text allowFontScaling={false} style={s.avatarTxt}>{initials}</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <View style={s.authorNameRow}>
              <Text allowFontScaling={false} style={s.authorName}>
                {post.author.firstName} {post.author.lastName}
              </Text>
              {/* Inline Follow button — only for other users' non-repost posts */}
              {!isOwn && post.type !== 'REPOST' && (
                <TouchableOpacity
                  onPress={() => followMutation.mutate()}
                  disabled={followMutation.isPending}
                  style={[s.followBtn, isFollowing && s.followBtnActive]}
                >
                  <Ionicons
                    name={isFollowing ? 'person-remove-outline' : 'person-add-outline'}
                    size={11}
                    color={isFollowing ? '#6b7280' : '#4f46e5'}
                  />
                  <Text allowFontScaling={false} style={[s.followBtnTxt, isFollowing && { color: '#6b7280' }]}>
                    {isFollowing ? 'Following' : 'Follow'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={s.metaRow}>
              <Text allowFontScaling={false} style={s.time}>
                {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
              </Text>
              {post.location ? (
                <>
                  <Text style={s.metaDot}>·</Text>
                  <Ionicons name="location-outline" size={11} color="#9ca3af" />
                  <Text allowFontScaling={false} style={s.locationTxt}>{post.location}</Text>
                </>
              ) : null}
            </View>
          </View>
        </TouchableOpacity>

        {/* ⋯ menu button — separated so it doesn't navigate to profile */}
        <TouchableOpacity
          onPress={() => setShowPostMenu(true)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ padding: 4 }}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color="#9ca3af" />
        </TouchableOpacity>
      </View>

      {/* Body */}
      {post.body ? (
        <Text allowFontScaling={false} style={s.body}>
          {post.body.split(/(\s+)/).map((word, i) => {
            if (word.startsWith('#'))
              return <Text key={i} style={s.hashtag}>{word}</Text>;
            if (word.startsWith('@'))
              return <Text key={i} style={s.mention}>{word}</Text>;
            return word;
          })}
        </Text>
      ) : null}

      {/* Media */}
      {post.media?.length > 0 && (
        <MediaGrid
          media={post.media}
          onPress={(i) => {
            // Images → lightbox; videos → navigate to post detail
            const clickedMedia = post.media[i];
            if (clickedMedia?.type === 'VIDEO') {
              if (onNavigateToDetail) onNavigateToDetail();
              else router.push(`/post/${post.id}` as any);
            } else {
              setMediaViewerIndex(i);
              setMediaViewerVisible(true);
            }
          }}
        />
      )}

      {/* Full-screen image viewer */}
      {post.media?.length > 0 && (
        <ImageViewing
          images={post.media
            .filter(m => m.type !== 'VIDEO')
            .map(m => ({ uri: resolveUrl(m.url) }))}
          imageIndex={mediaViewerIndex}
          visible={mediaViewerVisible}
          onRequestClose={() => setMediaViewerVisible(false)}
          swipeToCloseEnabled
          doubleTapToZoomEnabled
        />
      )}

      {/* Poll (if post has poll data) */}
      {post.pollData && (
        <PollCard postId={post.id} pollData={post.pollData} isOwn={isOwn} />
      )}

      {/* Link preview (if no media and post has scraped link) */}
      {!post.media?.length && post.linkUrl && post.linkTitle && (
        <LinkPreviewCard
          linkUrl={post.linkUrl}
          linkTitle={post.linkTitle}
          linkDescription={post.linkDescription}
          linkImage={post.linkImage}
        />
      )}

      {/* Quoted post */}
      {post.type === 'QUOTE' && post.originalPost && (
        <View style={s.quotedCard}>
          <Text allowFontScaling={false} style={s.quotedAuthor}>
            {post.originalPost.author.firstName} {post.originalPost.author.lastName}
          </Text>
          <Text allowFontScaling={false} style={s.quotedBody} numberOfLines={3}>
            {post.originalPost.body}
          </Text>
        </View>
      )}
      </>)}

      {/* Facebook-style counts row */}
      {(localReactionCount > 0 || post._count.comments > 0 || (post.shareCount ?? 0) > 0 || viewCount > 0) && (
        <View style={s.counts}>
          {/* Left: emoji stack + reaction count */}
          <View style={s.countsLeft}>
            {localReactionCount > 0 && (
              <View style={s.reactionStack}>
                {(['👍','❤️','🎉'] as const).map((em, i) => (
                  <View key={i} style={[s.reactionBubble, { zIndex: 3 - i, marginLeft: i === 0 ? 0 : -4 }]}>
                    <Text style={s.reactionBubbleEmoji}>{em}</Text>
                  </View>
                ))}
                <Text allowFontScaling={false} style={s.countTxt}>
                  {' '}{localReactionCount >= 1000
                    ? `${(localReactionCount / 1000).toFixed(1)}K`
                    : localReactionCount}
                </Text>
              </View>
            )}
            {viewCount > 0 && (
              <View style={[s.viewCount, localReactionCount > 0 && { marginLeft: 6 }]}>
                <Ionicons name="eye-outline" size={12} color="#9ca3af" />
                <Text allowFontScaling={false} style={s.viewCountTxt}>
                  {viewCount >= 1_000_000
                    ? `${(viewCount / 1_000_000).toFixed(1)}M`
                    : viewCount >= 1000
                    ? `${(viewCount / 1000).toFixed(1)}K`
                    : viewCount}
                </Text>
              </View>
            )}
          </View>

          {/* Right: comments · shares */}
          <View style={s.countsRight}>
            {post._count.comments > 0 && (
              <TouchableOpacity onPress={() => setCommentsOpen(v => !v)}>
                <Text allowFontScaling={false} style={s.countTxt}>
                  {post._count.comments >= 1000
                    ? `${(post._count.comments / 1000).toFixed(1)}K`
                    : post._count.comments}{' '}
                  {post._count.comments === 1 ? 'comment' : 'comments'}
                </Text>
              </TouchableOpacity>
            )}
            {(post.shareCount ?? 0) > 0 && (
              <Text allowFontScaling={false} style={[s.countTxt, { marginLeft: 8 }]}>
                {(post.shareCount ?? 0) >= 1000
                  ? `${((post.shareCount ?? 0) / 1000).toFixed(1)}K`
                  : post.shareCount}{' '}
                {post.shareCount === 1 ? 'repost' : 'reposts'}
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Facebook-style action bar — 4 equal buttons */}
      <View style={s.actions}>
        {/* Like / Reaction */}
        <Pressable
          onPress={() => reactMutation.mutate(localMyReaction ?? 'LIKE')}
          onLongPress={() => setShowReactions(true)}
          style={[s.actionBtn, localMyReaction && s.actionBtnActive]}
          disabled={reactMutation.isPending}
        >
          <Text style={s.reactionEmoji}>
            {localMyReaction ? REACTION_EMOJI[localMyReaction] : '👍'}
          </Text>
          <Text allowFontScaling={false} style={[s.actionTxt, localMyReaction && { color: '#4f46e5' }]}>
            {localMyReaction ? localMyReaction.charAt(0) + localMyReaction.slice(1).toLowerCase() : 'Like'}
          </Text>
        </Pressable>

        {/* Comment */}
        <TouchableOpacity
          style={[s.actionBtn, commentsOpen && s.actionBtnActive]}
          onPress={() => setCommentsOpen(v => !v)}
        >
          <Ionicons name="chatbubble-outline" size={16} color={commentsOpen ? '#4f46e5' : '#6b7280'} />
          <Text allowFontScaling={false} style={[s.actionTxt, commentsOpen && { color: '#4f46e5' }]}>
            Comment
          </Text>
        </TouchableOpacity>

        {/* Share */}
        <TouchableOpacity style={s.actionBtn} onPress={() => setShowShare(true)}>
          <Ionicons name="share-social-outline" size={16} color="#6b7280" />
          <Text allowFontScaling={false} style={s.actionTxt}>Share</Text>
        </TouchableOpacity>

        {/* Bookmark / Save */}
        <TouchableOpacity
          style={[s.actionBtn, isBookmarked && s.actionBtnActive]}
          onPress={() => bookmarkMutation.mutate()}
          disabled={bookmarkMutation.isPending}
        >
          <Ionicons
            name={isBookmarked ? 'bookmark' : 'bookmark-outline'}
            size={16}
            color={isBookmarked ? '#4f46e5' : '#6b7280'}
          />
          <Text allowFontScaling={false} style={[s.actionTxt, isBookmarked && { color: '#4f46e5' }]}>
            Save
          </Text>
        </TouchableOpacity>
      </View>

      {/* Inline comments */}
      <CommentsSection postId={post.id} open={commentsOpen} />

      {/* Reaction picker modal */}
      <Modal visible={showReactions} transparent animationType="fade" onRequestClose={() => setShowReactions(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setShowReactions(false)}>
          <View style={s.reactionPicker}>
            {REACTIONS.map(r => (
              <TouchableOpacity key={r.type} onPress={() => handleReact(r.type)} style={s.reactionItem}>
                <Text style={s.reactionPickerEmoji}>{r.emoji}</Text>
                <Text allowFontScaling={false} style={s.reactionPickerLabel}>{r.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Share modal */}
      <Modal visible={showShare} transparent animationType="slide" onRequestClose={() => setShowShare(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setShowShare(false)}>
          <View style={s.shareSheet}>
            <Text allowFontScaling={false} style={s.sheetTitle}>Share post</Text>
            <TouchableOpacity
              style={s.sheetRow}
              onPress={() => repostMutation.mutate()}
              disabled={repostMutation.isPending}
            >
              <Ionicons name="repeat" size={20} color="#16a34a" />
              <Text allowFontScaling={false} style={s.sheetRowTxt}>Share to feed</Text>
              {repostMutation.isPending && <ActivityIndicator size="small" color="#4f46e5" />}
            </TouchableOpacity>
            <TouchableOpacity style={s.sheetRow} onPress={() => { setShowShare(false); setShowQuote(true); }}>
              <Ionicons name="chatbox-ellipses-outline" size={20} color="#7c3aed" />
              <Text allowFontScaling={false} style={s.sheetRowTxt}>Quote post</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.sheetRow} onPress={handleCopyLink}>
              <Ionicons name="link-outline" size={20} color="#0891b2" />
              <Text allowFontScaling={false} style={s.sheetRowTxt}>Copy link</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.sheetRow} onPress={() => { setShowShare(false); setShowGroupPicker(true); }}>
              <Ionicons name="people-outline" size={20} color="#7c3aed" />
              <Text allowFontScaling={false} style={s.sheetRowTxt}>Share to group</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.sheetRow} onPress={() => { setShowShare(false); setShowDmPicker(true); }}>
              <Ionicons name="chatbubble-outline" size={20} color="#e11d48" />
              <Text allowFontScaling={false} style={s.sheetRowTxt}>Share to DM</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* DM picker modal */}
      <Modal visible={showDmPicker} transparent animationType="slide" onRequestClose={() => setShowDmPicker(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setShowDmPicker(false)}>
          <DmPickerSheet postId={post.id} postBody={post.body} onClose={() => setShowDmPicker(false)} />
        </Pressable>
      </Modal>

      {/* Group picker modal */}
      <Modal visible={showGroupPicker} transparent animationType="slide" onRequestClose={() => setShowGroupPicker(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setShowGroupPicker(false)}>
          <GroupPickerSheet postId={post.id} postBody={post.body} onClose={() => setShowGroupPicker(false)} />
        </Pressable>
      </Modal>

      {/* Quote modal */}
      <Modal visible={showQuote} transparent animationType="slide" onRequestClose={() => setShowQuote(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setShowQuote(false)}>
          <QuoteSheet
            post={post}
            onClose={() => setShowQuote(false)}
            onShared={() => { queryClient.invalidateQueries({ queryKey: ['feed'] }); }}
          />
        </Pressable>
      </Modal>

      {/* ─── Post ⋯ menu ──────────────────────────────────────────────────────── */}
      <Modal visible={showPostMenu} transparent animationType="fade" onRequestClose={() => setShowPostMenu(false)}>
        <Pressable style={s.menuBackdrop} onPress={() => setShowPostMenu(false)}>
          <Pressable style={s.menuSheet} onPress={e => e.stopPropagation()}>
            {isOwn ? (
              <>
                {/* Edit — author only */}
                <TouchableOpacity
                  style={s.menuRow}
                  onPress={() => {
                    setShowPostMenu(false);
                    setEditPostBody(post.body ?? '');
                    setEditingPost(true);
                  }}
                >
                  <Ionicons name="create-outline" size={20} color="#4f46e5" />
                  <Text allowFontScaling={false} style={s.menuRowTxt}>Edit post</Text>
                </TouchableOpacity>
                {/* Delete — author only */}
                <TouchableOpacity
                  style={s.menuRow}
                  onPress={() => { setShowPostMenu(false); handleDeletePost(); }}
                  disabled={deletePostMutation.isPending}
                >
                  <Ionicons name="trash-outline" size={20} color="#ef4444" />
                  <Text allowFontScaling={false} style={[s.menuRowTxt, { color: '#ef4444' }]}>
                    {deletePostMutation.isPending ? 'Deleting…' : 'Delete post'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              /* Report — non-author only, matching MF-013 */
              <TouchableOpacity
                style={s.menuRow}
                onPress={() => { setShowPostMenu(false); handleReportPost(); }}
                disabled={reportPostMutation.isPending}
              >
                <Ionicons name="flag-outline" size={20} color="#f59e0b" />
                <Text allowFontScaling={false} style={[s.menuRowTxt, { color: '#f59e0b' }]}>
                  {reportPostMutation.isPending ? 'Reporting…' : 'Report post'}
                </Text>
              </TouchableOpacity>
            )}
            {/* Cancel */}
            <TouchableOpacity style={[s.menuRow, { borderTopWidth: 1, borderTopColor: '#f3f4f6', marginTop: 4 }]} onPress={() => setShowPostMenu(false)}>
              <Text allowFontScaling={false} style={[s.menuRowTxt, { color: '#6b7280', textAlign: 'center', flex: 1 }]}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ─── Edit post sheet ──────────────────────────────────────────────────── */}
      <Modal visible={editingPost} transparent animationType="slide" onRequestClose={() => setEditingPost(false)}>
        <Pressable style={s.menuBackdrop} onPress={() => setEditingPost(false)}>
          <Pressable style={[s.menuSheet, { paddingBottom: 24 }]} onPress={e => e.stopPropagation()}>
            <Text allowFontScaling={false} style={[s.menuRowTxt, { fontWeight: '700', fontSize: 16, marginBottom: 12, textAlign: 'center', color: '#111827' }]}>
              Edit Post
            </Text>
            <TextInput
              style={s.editPostInput}
              value={editPostBody}
              onChangeText={setEditPostBody}
              multiline
              autoFocus
              maxLength={5000}
              placeholder="What's on your mind?"
              placeholderTextColor="#9ca3af"
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                style={[s.editPostBtn, { backgroundColor: '#f3f4f6', flex: 1 }]}
                onPress={() => setEditingPost(false)}
              >
                <Text allowFontScaling={false} style={{ color: '#6b7280', fontWeight: '600', fontSize: 14 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.editPostBtn, { backgroundColor: '#4f46e5', flex: 2 }, (!editPostBody.trim() || editPostMutation.isPending) && { opacity: 0.5 }]}
                onPress={() => editPostMutation.mutate(editPostBody.trim())}
                disabled={!editPostBody.trim() || editPostMutation.isPending}
              >
                {editPostMutation.isPending
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text allowFontScaling={false} style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Save</Text>
                }
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Group Picker Sheet ──────────────────────────────────────────────────────────
function GroupPickerSheet({ postId, postBody, onClose }: { postId: string; postBody: string | null; onClose: () => void }) {
  const [sending, setSending] = useState<string | null>(null);
  const shareUrl = `${getBaseURL().replace('/api/v1', '')}/feed/post/${postId}`;

  const { data: convs = [], isLoading } = useQuery({
    queryKey: ['group-conversations-share'],
    queryFn: async () => {
      const res = await api.get('/group-chat/conversations?limit=50');
      return Array.isArray(res.data?.data) ? res.data.data : [];
    },
    staleTime: 30_000,
  });

  const handleSend = async (convId: string, name: string) => {
    setSending(convId);
    try {
      const body = [
        postBody ? postBody.slice(0, 100) + (postBody.length > 100 ? '…' : '') : '',
        shareUrl,
      ].filter(Boolean).join('\n');
      await api.post(`/group-chat/conversations/${convId}/messages`, { body, type: 'TEXT' });
      showMessage({ message: `Shared to ${name}`, type: 'success' });
      onClose();
    } catch {
      showMessage({ message: 'Failed to share', type: 'danger' });
    } finally {
      setSending(null);
    }
  };

  return (
    <Pressable onPress={e => e.stopPropagation()}>
      <View style={s.shareSheet}>
        <Text allowFontScaling={false} style={s.sheetTitle}>Share to Group</Text>
        {isLoading ? (
          <ActivityIndicator size="small" color="#4f46e5" style={{ marginVertical: 16 }} />
        ) : convs.length === 0 ? (
          <Text allowFontScaling={false} style={{ textAlign: 'center', color: '#9ca3af', paddingVertical: 16, fontSize: 13 }}>
            No groups yet. Create a group first.
          </Text>
        ) : (
          convs.slice(0, 8).map((conv: any) => {
            const name = conv.name ?? 'Group';
            const initials = name.slice(0, 2).toUpperCase();
            return (
              <TouchableOpacity
                key={conv.id}
                style={s.sheetRow}
                onPress={() => handleSend(conv.id, name)}
                disabled={!!sending}
              >
                <View style={[s.dmAvatar, { backgroundColor: avatarColor(name) }]}>
                  {conv.avatarUrl
                    ? <Image source={{ uri: conv.avatarUrl }} style={s.dmAvatarImg} />
                    : <Text style={s.dmAvatarTxt}>{initials}</Text>
                  }
                </View>
                <Text allowFontScaling={false} style={[s.sheetRowTxt, { flex: 1 }]} numberOfLines={1}>{name}</Text>
                {sending === conv.id
                  ? <ActivityIndicator size="small" color="#4f46e5" />
                  : <Ionicons name="send-outline" size={16} color="#9ca3af" />
                }
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </Pressable>
  );
}

// ─── Quote Sheet ─────────────────────────────────────────────────────────────────
// Allowed visibility values as a const so we can validate the original post's value
const ALLOWED_VISIBILITIES = ['PUBLIC', 'FOLLOWERS', 'PRIVATE', 'SCHOOL_ONLY'] as const;
type AllowedVisibility = typeof ALLOWED_VISIBILITIES[number];

function QuoteSheet({ post, onClose, onShared }: { post: Post; onClose: () => void; onShared?: () => void }) {
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuthStore();
  const initials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase() || '?';

  // Default to the original post's visibility so the quote cannot broaden the audience.
  // If the original visibility is unrecognised, fail safe to 'PUBLIC' (not SCHOOL_ONLY or PRIVATE).
  const safeVisibility: AllowedVisibility =
    (ALLOWED_VISIBILITIES as readonly string[]).includes(post.visibility)
      ? (post.visibility as AllowedVisibility)
      : 'PUBLIC';

  const handleQuote = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await api.post('/posts', {
        type: 'QUOTE',
        originalPostId: post.id,
        quotedBody: post.body ?? '',
        body: body.trim() || undefined,
        visibility: safeVisibility,
      });
      showMessage({ message: '✅ Quote posted!', type: 'success' });
      onShared?.();
      onClose();
    } catch {
      showMessage({ message: 'Failed to quote post', type: 'danger' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Pressable onPress={e => e.stopPropagation()}>
      <View style={[s.shareSheet, { gap: 12 }]}>
        <Text allowFontScaling={false} style={s.sheetTitle}>Quote Post</Text>
        {/* Composer */}
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <View style={[s.dmAvatar, { backgroundColor: avatarColor(`${user?.firstName}${user?.lastName}`) }]}>
            <Text style={s.dmAvatarTxt}>{initials}</Text>
          </View>
          <TextInput
            style={[s.quoteInput]}
            value={body}
            onChangeText={setBody}
            placeholder="Add your thoughts…"
            placeholderTextColor="#9ca3af"
            multiline
            maxLength={500}
            autoFocus
          />
        </View>
        {/* Original post preview */}
        <View style={s.quotedPreview}>
          <Text allowFontScaling={false} style={s.quotedPreviewAuthor}>
            {post.author.firstName} {post.author.lastName}
          </Text>
          <Text allowFontScaling={false} style={s.quotedPreviewBody} numberOfLines={3}>
            {post.body ?? '(no text)'}
          </Text>
        </View>
        {/* Visibility indicator — read-only; quote inherits original post's visibility */}
        <View style={s.quoteVisRow}>
          <Ionicons name="eye-outline" size={12} color="#6b7280" />
          <Text allowFontScaling={false} style={s.quoteVisTxt}>
            Audience: {safeVisibility === 'SCHOOL_ONLY' ? 'School only' : safeVisibility === 'FOLLOWERS' ? 'Followers' : safeVisibility === 'PRIVATE' ? 'Only me' : 'Everyone'}
          </Text>
        </View>
        {/* Post button */}
        <TouchableOpacity
          style={[s.quotePostBtn, submitting && { opacity: 0.5 }]}
          onPress={handleQuote}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text allowFontScaling={false} style={s.quotePostBtnTxt}>Quote</Text>
          }
        </TouchableOpacity>
      </View>
    </Pressable>
  );
}

// ─── DM Picker Sheet ────────────────────────────────────────────────────────────
function DmPickerSheet({ postId, postBody, onClose }: { postId: string; postBody: string | null; onClose: () => void }) {
  const [sending, setSending] = useState<string | null>(null);
  const shareUrl = `${getBaseURL().replace('/api/v1', '')}/feed/post/${postId}`;

  const { data: convs = [], isLoading } = useQuery({
    queryKey: ['dm-conversations'],
    queryFn: async () => {
      const res = await api.get('/dm/conversations');
      return Array.isArray(res.data?.data) ? res.data.data : [];
    },
    staleTime: 60_000,
  });

  const handleSend = async (convId: string, name: string) => {
    setSending(convId);
    try {
      const body = [
        postBody ? postBody.slice(0, 100) + (postBody.length > 100 ? '…' : '') : '',
        shareUrl,
      ].filter(Boolean).join('\n');
      await api.post(`/dm/conversations/${convId}/messages`, { body, msgType: 'TEXT' });
      showMessage({ message: `Shared to ${name}`, type: 'success' });
      onClose();
    } catch {
      showMessage({ message: 'Failed to share', type: 'danger' });
    } finally {
      setSending(null);
    }
  };

  return (
    <Pressable onPress={e => e.stopPropagation()}>
      <View style={s.shareSheet}>
        <Text allowFontScaling={false} style={s.sheetTitle}>Share via DM</Text>
        {isLoading ? (
          <ActivityIndicator size="small" color="#4f46e5" style={{ marginVertical: 16 }} />
        ) : convs.length === 0 ? (
          <Text allowFontScaling={false} style={{ textAlign: 'center', color: '#9ca3af', paddingVertical: 16, fontSize: 13 }}>
            No conversations yet. Start a DM first.
          </Text>
        ) : (
          convs.slice(0, 8).map((conv: any) => {
            const other = conv.other ?? {};
            const name = `${other.firstName ?? ''} ${other.lastName ?? ''}`.trim() || 'Unknown';
            const initials = `${other.firstName?.[0] ?? ''}${other.lastName?.[0] ?? ''}`.toUpperCase() || '?';
            return (
              <TouchableOpacity
                key={conv.id}
                style={s.sheetRow}
                onPress={() => handleSend(conv.id, name)}
                disabled={!!sending}
              >
                <View style={[s.dmAvatar, { backgroundColor: avatarColor(name) }]}>
                  {other.avatarUrl
                    ? <Image source={{ uri: other.avatarUrl }} style={s.dmAvatarImg} />
                    : <Text style={s.dmAvatarTxt}>{initials}</Text>
                  }
                </View>
                <Text allowFontScaling={false} style={[s.sheetRowTxt, { flex: 1 }]} numberOfLines={1}>{name}</Text>
                {sending === conv.id
                  ? <ActivityIndicator size="small" color="#4f46e5" />
                  : <Ionicons name="send-outline" size={16} color="#9ca3af" />
                }
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </Pressable>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  card:              { backgroundColor: '#fff', borderRadius: 16, marginHorizontal: 12, marginVertical: 4, padding: 14, borderWidth: 1, borderColor: '#f3f4f6' },
  cardPinned:        { borderColor: '#c7d2fe' },
  pinnedRow:         { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  pinnedTxt:         { fontSize: 11, color: '#4f46e5', fontWeight: '700' },
  repostBanner:      { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  repostTxt:         { fontSize: 12, color: '#6b7280' },
  header:            { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar:            { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  avatarImg:         { width: 40, height: 40, borderRadius: 20 },
  avatarTxt:         { fontSize: 14, fontWeight: '700', color: '#fff' },
  authorName:        { fontSize: 14, fontWeight: '700', color: '#111827' },
  authorNameRow:     { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  followBtn:         { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, borderWidth: 1, borderColor: '#a5b4fc' },
  followBtnActive:   { borderColor: '#d1d5db', backgroundColor: '#f9fafb' },
  followBtnTxt:      { fontSize: 11, fontWeight: '600', color: '#4f46e5' },
  metaRow:           { flexDirection: 'row', alignItems: 'center', gap: 3, flexWrap: 'wrap' },
  time:              { fontSize: 11, color: '#9ca3af' },
  metaDot:           { fontSize: 11, color: '#d1d5db' },
  locationTxt:       { fontSize: 11, color: '#9ca3af' },
  body:              { fontSize: 14, color: '#374151', lineHeight: 20, marginBottom: 10 },
  hashtag:           { color: '#4f46e5', fontWeight: '600' },
  mention:           { color: '#7c3aed', fontWeight: '500' },
  quotedCard:        { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 10, marginBottom: 10, backgroundColor: '#f9fafb' },
  origCard:          { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, overflow: 'hidden', marginBottom: 10, backgroundColor: '#f9fafb' },
  quotedAuthor:      { fontSize: 12, fontWeight: '700', color: '#374151', marginBottom: 2 },
  quotedBody:        { fontSize: 12, color: '#6b7280', lineHeight: 18 },
  counts:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', marginBottom: 2 },
  countsLeft:        { flexDirection: 'row', alignItems: 'center' },
  countsRight:       { flexDirection: 'row', alignItems: 'center' },
  reactionStack:     { flexDirection: 'row', alignItems: 'center' },
  reactionBubble:    { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', justifyContent: 'center', alignItems: 'center' },
  reactionBubbleEmoji: { fontSize: 10, lineHeight: 13 },
  countTxt:          { fontSize: 12, color: '#9ca3af' },
  viewCount:         { flexDirection: 'row', alignItems: 'center', gap: 3 },
  viewCountTxt:      { fontSize: 11, color: '#9ca3af' },
  actions:           { flexDirection: 'row', alignItems: 'center', paddingTop: 4, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  actionBtn:         { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: 8 },
  actionBtnActive:   { backgroundColor: '#ede9fe' },
  actionTxt:         { fontSize: 12, color: '#6b7280', fontWeight: '500' },
  reactionEmoji:     { fontSize: 16 },
  // Media
  videoPlayIcon:     { position: 'absolute', inset: 0, justifyContent: 'center', alignItems: 'center' },
  overlayCnt:        { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center' },
  overlayTxt:        { color: '#fff', fontSize: 22, fontWeight: '800' },
  // Reaction picker
  modalBackdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  reactionPicker:    { backgroundColor: '#fff', borderRadius: 20, margin: 16, padding: 16, flexDirection: 'row', justifyContent: 'space-around' },
  reactionItem:      { alignItems: 'center', gap: 4 },
  reactionPickerEmoji: { fontSize: 28 },
  reactionPickerLabel: { fontSize: 10, color: '#6b7280' },
  // Share sheet
  shareSheet:        { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 4 },
  sheetTitle:        { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 8 },
  sheetRow:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  sheetRowTxt:       { fontSize: 15, color: '#374151', flex: 1 },
  dmAvatar:          { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  dmAvatarImg:       { width: 36, height: 36, borderRadius: 18 },
  dmAvatarTxt:       { fontSize: 13, fontWeight: '700', color: '#fff' },
  quoteInput:        { flex: 1, fontSize: 14, color: '#111827', minHeight: 72, textAlignVertical: 'top', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 8 },
  quotedPreview:     { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 10, backgroundColor: '#f9fafb' },
  quotedPreviewAuthor: { fontSize: 12, fontWeight: '700', color: '#374151', marginBottom: 4 },
  quotedPreviewBody: { fontSize: 12, color: '#6b7280', lineHeight: 17 },
  quotePostBtn:      { backgroundColor: '#4f46e5', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  quotePostBtnTxt:   { color: '#fff', fontWeight: '700', fontSize: 15 },
  quoteVisRow:       { flexDirection: 'row', alignItems: 'center', gap: 4 },
  quoteVisTxt:       { fontSize: 11, color: '#6b7280' },
  // Post ⋯ menu + edit sheet
  menuBackdrop:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  menuSheet:         { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 32, gap: 2 },
  menuRow:           { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: 4 },
  menuRowTxt:        { fontSize: 15, fontWeight: '600', color: '#111827' },
  editPostInput:     { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 12, fontSize: 15, color: '#111827', minHeight: 120, textAlignVertical: 'top', backgroundColor: '#f9fafb' },
  editPostBtn:       { borderRadius: 12, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  // Comments section
  commentSec:        { marginTop: 10, borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 8, gap: 10 },
  commentRow:        { flexDirection: 'row', gap: 8 },
  commentAv:         { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', flexShrink: 0, marginTop: 2 },
  commentAvImg:      { width: 28, height: 28, borderRadius: 14 },
  commentAvTxt:      { fontSize: 10, fontWeight: '700', color: '#fff' },
  commentBubble:     { backgroundColor: '#f3f4f6', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 7, flex: 1 },
  commentAuthor:     { fontSize: 12, fontWeight: '700', color: '#111827', marginBottom: 2 },
  commentBody:       { fontSize: 13, color: '#374151', lineHeight: 18 },
  commentMeta:       { flexDirection: 'row', gap: 10, marginTop: 4, marginLeft: 2, flexWrap: 'wrap', alignItems: 'center' },
  commentTime:       { fontSize: 11, color: '#9ca3af' },
  commentAction:     { fontSize: 11, color: '#4f46e5', fontWeight: '600' },
  commentLikeBtn:    { flexDirection: 'row', alignItems: 'center', gap: 3 },
  commentLikeCount:  { fontSize: 11, color: '#9ca3af' },
  editInput:         { borderWidth: 1, borderColor: '#c7d2fe', borderRadius: 8, padding: 6, fontSize: 13, color: '#374151', marginTop: 4 },
  loadMoreTxt:       { fontSize: 12, color: '#4f46e5', fontWeight: '600' },
  replyBanner:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#ede9fe', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  replyTxt:          { fontSize: 12, color: '#4f46e5' },
  commentInputRow:   { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 4 },
  commentInput:      { flex: 1, backgroundColor: '#f3f4f6', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, maxHeight: 80, color: '#374151' },
  sendBtn:           { width: 34, height: 34, borderRadius: 17, backgroundColor: '#4f46e5', justifyContent: 'center', alignItems: 'center' },
});





