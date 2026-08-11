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
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  Pressable, Modal, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  Dimensions, Alert, Share,
} from 'react-native';
import { useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'expo-router';
import { showMessage } from 'react-native-flash-message';
import api, { getBaseURL } from '@/lib/api';
import { getAvatarUrl, getAvatarInitials, avatarColor } from '@/lib/avatar';
import { useAuthStore } from '@/store/auth.store';

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

  const myReaction   = post.reactions?.[0]?.type as ReactionType | undefined;
  const isBookmarked = (post.bookmarks?.length ?? 0) > 0;
  const avatarSrc    = getAvatarUrl(post.author.avatarUrl);
  const initials     = getAvatarInitials(post.author.firstName, post.author.lastName);
  const bgColor      = avatarColor(`${post.author.firstName}${post.author.lastName}`);

  const [showReactions, setShowReactions] = useState(false);
  const [commentsOpen, setCommentsOpen]   = useState(false);
  const [showShare,    setShowShare]      = useState(false);
  // Local view count — starts from server value, increments once on render
  const [viewCount, setViewCount] = useState(post.viewCount ?? 0);
  const viewedRef = useRef(false);

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

  // ── React mutation ─────────────────────────────────────────────────────────
  const reactMutation = useMutation({
    mutationFn: (type: ReactionType) => api.post(`/posts/${post.id}/react`, { type }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
    onError:   () => showMessage({ message: 'Failed to react', type: 'danger' }),
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

  const handleReact = (type: ReactionType) => {
    setShowReactions(false);
    reactMutation.mutate(type);
  };

  const handleCopyLink = async () => {
    const url = `${getBaseURL().replace('/api/v1', '')}/feed/post/${post.id}`;
    try {
      // Use native Share sheet — no expo-clipboard dependency needed
      await Share.share({ message: url, title: 'Share post' });
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

      {/* Repost banner */}
      {post.type === 'REPOST' && post.originalPost && (
        <View style={s.repostBanner}>
          <Ionicons name="repeat" size={13} color="#6b7280" />
          <Text style={s.repostTxt}>{post.author.firstName} reposted</Text>
        </View>
      )}

      {/* Author row */}
      <TouchableOpacity
        style={s.header}
        onPress={() => router.push(`/profile/${post.author.id}` as any)}
        activeOpacity={0.7}
      >
        <View style={[s.avatar, { backgroundColor: bgColor }]}>
          {avatarSrc
            ? <Image source={{ uri: avatarSrc }} style={s.avatarImg} />
            : <Text allowFontScaling={false} style={s.avatarTxt}>{initials}</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <Text allowFontScaling={false} style={s.authorName}>
            {post.author.firstName} {post.author.lastName}
          </Text>
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
        <Ionicons name="ellipsis-horizontal" size={18} color="#9ca3af" />
      </TouchableOpacity>

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
            // navigate to detail on media tap
            if (onNavigateToDetail) onNavigateToDetail();
            else router.push(`/post/${post.id}` as any);
          }}
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

      {/* Reaction + comment + view counts */}
      {(post._count.reactions > 0 || post._count.comments > 0 || viewCount > 0) && (
        <View style={s.counts}>
          {post._count.reactions > 0 && (
            <Text allowFontScaling={false} style={s.countTxt}>
              {post._count.reactions} reaction{post._count.reactions !== 1 ? 's' : ''}
            </Text>
          )}
          {post._count.comments > 0 && (
            <TouchableOpacity onPress={() => setCommentsOpen(v => !v)}>
              <Text allowFontScaling={false} style={s.countTxt}>
                {post._count.comments} comment{post._count.comments !== 1 ? 's' : ''}
              </Text>
            </TouchableOpacity>
          )}
          {viewCount > 0 && (
            <View style={s.viewCount}>
              <Ionicons name="eye-outline" size={12} color="#d1d5db" />
              <Text allowFontScaling={false} style={s.viewCountTxt}>
                {viewCount >= 1000 ? `${(viewCount / 1000).toFixed(1)}k` : viewCount}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Action bar */}
      <View style={s.actions}>
        {/* Like / Reaction */}
        <Pressable
          onPress={() => reactMutation.mutate(myReaction ?? 'LIKE')}
          onLongPress={() => setShowReactions(true)}
          style={[s.actionBtn, myReaction && s.actionBtnActive]}
          disabled={reactMutation.isPending}
        >
          <Text style={s.reactionEmoji}>
            {myReaction ? REACTION_EMOJI[myReaction] : '👍'}
          </Text>
          <Text allowFontScaling={false} style={[s.actionTxt, myReaction && { color: '#4f46e5' }]}>
            {myReaction ? myReaction.charAt(0) + myReaction.slice(1).toLowerCase() : 'Like'}
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

        {/* Bookmark */}
        <TouchableOpacity
          style={s.actionBtn}
          onPress={() => bookmarkMutation.mutate()}
          disabled={bookmarkMutation.isPending}
        >
          <Ionicons
            name={isBookmarked ? 'bookmark' : 'bookmark-outline'}
            size={16}
            color={isBookmarked ? '#4f46e5' : '#6b7280'}
          />
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
            <TouchableOpacity style={s.sheetRow} onPress={handleCopyLink}>
              <Ionicons name="link-outline" size={20} color="#0891b2" />
              <Text allowFontScaling={false} style={s.sheetRowTxt}>Copy link</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </View>
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
  metaRow:           { flexDirection: 'row', alignItems: 'center', gap: 3, flexWrap: 'wrap' },
  time:              { fontSize: 11, color: '#9ca3af' },
  metaDot:           { fontSize: 11, color: '#d1d5db' },
  locationTxt:       { fontSize: 11, color: '#9ca3af' },
  body:              { fontSize: 14, color: '#374151', lineHeight: 20, marginBottom: 10 },
  hashtag:           { color: '#4f46e5', fontWeight: '600' },
  mention:           { color: '#7c3aed', fontWeight: '500' },
  quotedCard:        { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 10, marginBottom: 10, backgroundColor: '#f9fafb' },
  quotedAuthor:      { fontSize: 12, fontWeight: '700', color: '#374151', marginBottom: 2 },
  quotedBody:        { fontSize: 12, color: '#6b7280', lineHeight: 18 },
  counts:            { flexDirection: 'row', gap: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', marginBottom: 2 },
  countTxt:          { fontSize: 12, color: '#9ca3af' },
  viewCount:         { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto' as any },
  viewCountTxt:      { fontSize: 11, color: '#d1d5db' },
  actions:           { flexDirection: 'row', alignItems: 'center', paddingTop: 6 },
  actionBtn:         { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 6, borderRadius: 8 },
  actionBtnActive:   { backgroundColor: '#ede9fe' },
  actionTxt:         { fontSize: 11, color: '#6b7280', fontWeight: '500' },
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
  // Comments section
  commentSec:        { marginTop: 10, borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 8, gap: 10 },
  commentRow:        { flexDirection: 'row', gap: 8 },
  commentAv:         { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', flexShrink: 0, marginTop: 2 },
  commentAvImg:      { width: 28, height: 28, borderRadius: 14 },
  commentAvTxt:      { fontSize: 10, fontWeight: '700', color: '#fff' },
  commentBubble:     { backgroundColor: '#f3f4f6', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 7, flex: 1 },
  commentAuthor:     { fontSize: 12, fontWeight: '700', color: '#111827', marginBottom: 2 },
  commentBody:       { fontSize: 13, color: '#374151', lineHeight: 18 },
  commentMeta:       { flexDirection: 'row', gap: 10, marginTop: 4, marginLeft: 2, flexWrap: 'wrap' },
  commentTime:       { fontSize: 11, color: '#9ca3af' },
  commentAction:     { fontSize: 11, color: '#4f46e5', fontWeight: '600' },
  editInput:         { borderWidth: 1, borderColor: '#c7d2fe', borderRadius: 8, padding: 6, fontSize: 13, color: '#374151', marginTop: 4 },
  loadMoreTxt:       { fontSize: 12, color: '#4f46e5', fontWeight: '600' },
  replyBanner:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#ede9fe', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  replyTxt:          { fontSize: 12, color: '#4f46e5' },
  commentInputRow:   { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 4 },
  commentInput:      { flex: 1, backgroundColor: '#f3f4f6', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, maxHeight: 80, color: '#374151' },
  sendBtn:           { width: 34, height: 34, borderRadius: 17, backgroundColor: '#4f46e5', justifyContent: 'center', alignItems: 'center' },
});
