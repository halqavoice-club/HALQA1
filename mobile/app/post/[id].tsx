/**
 * HALQA Mobile — Post Detail Screen v2
 * Full post + infinite-scroll comments with correct API shape.
 * Comments use the same GET /posts/:id/comments endpoint as web.
 */
import KeyboardAvoidingView from '@/components/KeyboardAvoidingView';
import { useState, useRef, useCallback } from 'react';
import {
  View, Text, Image, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Platform, ActivityIndicator,
  RefreshControl, Alert} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery, useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '@/lib/api';
import { getAvatarUrl, getAvatarInitials, avatarColor } from '@/lib/avatar';
import { useAuthStore } from '@/store/auth.store';
import { formatDistanceToNow } from 'date-fns';
import type { Post } from '@/components/feed/PostCard';

interface Comment {
  id: string; postId: string; authorId: string; parentId: string | null;
  body: string;
  author: { id: string; firstName: string; lastName: string; avatarUrl: string | null };
  reactions: { type: string }[];
  _count: { replies: number; reactions: number };
  createdAt: string; deletedAt: string | null;
}

// ─── Comment row ────────────────────────────────────────────────────────────────
function CommentRow({
  comment, postId, onReply,
}: { comment: Comment; postId: string; onReply: (name: string) => void }) {
  const { user }    = useAuthStore();
  const queryClient = useQueryClient();
  const isOwn       = comment.authorId === user?.id;
  const avSrc       = getAvatarUrl(comment.author.avatarUrl);
  const initials    = getAvatarInitials(comment.author.firstName, comment.author.lastName);
  const bg          = avatarColor(`${comment.author.firstName}${comment.author.lastName}`);

  const [editing, setEditing]   = useState(false);
  const [editBody, setEditBody] = useState(comment.body);

  const editMutation = useMutation({
    mutationFn: (body: string) => api.patch(`/posts/${postId}/comments/${comment.id}`, { body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', postId] });
      setEditing(false);
    },
    onError: () => showMessage({ message: 'Failed to edit', type: 'danger' }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/posts/${postId}/comments/${comment.id}`),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['comments', postId] }),
    onError:    () => showMessage({ message: 'Failed to delete', type: 'danger' }),
  });

  return (
    <View style={st.commentRow}>
      <View style={[st.commentAv, { backgroundColor: bg }]}>
        {avSrc
          ? <Image source={{ uri: avSrc }} style={st.commentAvImg} />
          : <Text style={st.commentAvTxt}>{initials}</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <View style={st.commentBubble}>
          <Text style={st.commentAuthor}>{comment.author.firstName} {comment.author.lastName}</Text>
          {editing ? (
            <View>
              <TextInput
                value={editBody} onChangeText={setEditBody} multiline autoFocus
                style={st.editInput}
              />
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                <TouchableOpacity onPress={() => editMutation.mutate(editBody.trim())}
                  disabled={!editBody.trim() || editMutation.isPending}>
                  <Text style={st.actionLink}>{editMutation.isPending ? '…' : 'Save'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setEditing(false); setEditBody(comment.body); }}>
                  <Text style={[st.actionLink, { color: '#9ca3af' }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <Text style={st.commentBody}>{comment.body}</Text>
          )}
        </View>
        <View style={st.commentMeta}>
          <Text style={st.commentTime}>{formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}</Text>
          <TouchableOpacity onPress={() => onReply(comment.author.firstName)}>
            <Text style={st.actionLink}>Reply</Text>
          </TouchableOpacity>
          {isOwn && (
            <>
              <TouchableOpacity onPress={() => { setEditing(true); setEditBody(comment.body); }}>
                <Text style={st.actionLink}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => Alert.alert('Delete comment?', '', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate() },
              ])}>
                <Text style={[st.actionLink, { color: '#ef4444' }]}>Delete</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

// ─── Post header rendered above comment list ───────────────────────────────────
function PostHeader({ post, onLike }: { post: Post; onLike: () => void }) {
  const router     = useRouter();
  const myReaction = post.reactions?.[0]?.type;
  const avSrc      = getAvatarUrl(post.author.avatarUrl);
  const initials   = getAvatarInitials(post.author.firstName, post.author.lastName);
  const bg         = avatarColor(`${post.author.firstName}${post.author.lastName}`);
  const BASE       = api.defaults.baseURL?.replace('/api/v1', '') ?? '';

  return (
    <View style={st.postCard}>
      {/* Author */}
      <TouchableOpacity
        style={st.postAuthorRow}
        onPress={() => router.push(`/profile/${post.author.id}` as any)}
      >
        <View style={[st.postAv, { backgroundColor: bg }]}>
          {avSrc
            ? <Image source={{ uri: avSrc }} style={st.postAvImg} />
            : <Text style={st.postAvTxt}>{initials}</Text>}
        </View>
        <View>
          <Text style={st.postAuthorName}>{post.author.firstName} {post.author.lastName}</Text>
          <Text style={st.postTime}>{formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}</Text>
        </View>
      </TouchableOpacity>

      {/* Body */}
      {post.body ? <Text style={st.postBody}>{post.body}</Text> : null}

      {/* First media image */}
      {post.media?.length > 0 && post.media[0].type !== 'VIDEO' && (
        <Image
          source={{ uri: post.media[0].url.startsWith('http') ? post.media[0].url : BASE + post.media[0].url }}
          style={st.postMedia}
          resizeMode="cover"
        />
      )}

      {/* Actions */}
      <View style={st.postActions}>
        <TouchableOpacity style={st.postAction} onPress={onLike}>
          <Ionicons
            name={myReaction ? 'heart' : 'heart-outline'}
            size={20}
            color={myReaction ? '#4f46e5' : '#6b7280'}
          />
          <Text style={[st.postActionTxt, myReaction ? { color: '#4f46e5' } : {}]}>
            {post._count.reactions}
          </Text>
        </TouchableOpacity>
        <View style={st.postAction}>
          <Ionicons name="chatbubble-outline" size={20} color="#6b7280" />
          <Text style={st.postActionTxt}>{post._count.comments}</Text>
        </View>
      </View>
      <Text style={st.commentsHeader}>Comments</Text>
    </View>
  );
}

// ─── Main screen ────────────────────────────────────────────────────────────────
export default function PostDetailScreen() {
  const { id }      = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { user }    = useAuthStore();
  const inputRef    = useRef<TextInput>(null);
  const [commentText, setCommentText] = useState('');
  const [replyTo, setReplyTo]         = useState<string | null>(null);

  // ── Fetch single post ──────────────────────────────────────────────────────
  const { data: post, isLoading: postLoading, refetch, isRefetching } = useQuery<Post>({
    queryKey: ['post', id],
    queryFn:  () => api.get(`/posts/${id}`).then(r => r.data.data),
    enabled:  !!id,
  });

  // ── Fetch comments (infinite) ──────────────────────────────────────────────
  const {
    data: commentsData, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['comments', id],
    queryFn: ({ pageParam }) =>
      api.get(`/posts/${id}/comments`, { params: { cursor: pageParam } })
         .then(r => r.data.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: any) => page.nextCursor ?? undefined,
    enabled: !!id,
  });

  const allComments: Comment[] = commentsData?.pages.flatMap((p: any) => p.items) ?? [];

  // ── React to post ──────────────────────────────────────────────────────────
  const reactMutation = useMutation({
    mutationFn: () => api.post(`/posts/${id}/react`, {
      type: post?.reactions?.[0]?.type ?? 'LIKE',
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['post', id] }),
  });

  // ── Add comment ────────────────────────────────────────────────────────────
  const commentMutation = useMutation({
    mutationFn: (body: string) => api.post(`/posts/${id}/comments`, { body }),
    onSuccess: () => {
      setCommentText('');
      setReplyTo(null);
      queryClient.invalidateQueries({ queryKey: ['comments', id] });
      queryClient.invalidateQueries({ queryKey: ['post', id] });
    },
    onError: () => showMessage({ message: 'Failed to post comment', type: 'danger' }),
  });

  const handleReply = useCallback((name: string) => {
    setReplyTo(name);
    setCommentText(`@${name} `);
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const t = commentText.trim();
    if (!t) return;
    commentMutation.mutate(t);
  };

  if (postLoading) {
    return (
      <View style={st.centered}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  if (!post) {
    return (
      <View style={st.centered}>
        <Text style={{ color: '#6b7280' }}>Post not found</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Post', headerTintColor: '#4f46e5' }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <FlatList
          data={allComments}
          keyExtractor={(item: Comment) => item.id}
          renderItem={({ item }) => (
            <CommentRow comment={item} postId={id!} onReply={handleReply} />
          )}
          ListHeaderComponent={
            <PostHeader post={post} onLike={() => reactMutation.mutate()} />
          }
          ListEmptyComponent={
            <Text style={st.emptyTxt}>No comments yet. Be the first!</Text>
          }
          ListFooterComponent={
            hasNextPage ? (
              <TouchableOpacity style={st.loadMore} onPress={() => fetchNextPage()}>
                {isFetchingNextPage
                  ? <ActivityIndicator size="small" color="#4f46e5" />
                  : <Text style={st.loadMoreTxt}>Load more comments</Text>}
              </TouchableOpacity>
            ) : <View style={{ height: 80 }} />
          }
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          style={st.list}
        />

        {/* Reply indicator */}
        {replyTo && (
          <View style={st.replyBanner}>
            <Text style={st.replyTxt}>Replying to @{replyTo}</Text>
            <TouchableOpacity onPress={() => { setReplyTo(null); setCommentText(''); }}>
              <Ionicons name="close" size={16} color="#4f46e5" />
            </TouchableOpacity>
          </View>
        )}

        {/* Comment input */}
        <View style={st.inputBar}>
          <TextInput
            ref={inputRef}
            style={st.input}
            placeholder="Write a comment…"
            value={commentText}
            onChangeText={setCommentText}
            multiline
            maxLength={2000}
            returnKeyType="send"
            onSubmitEditing={handleSubmit}
          />
          <TouchableOpacity
            style={[st.sendBtn, (!commentText.trim() || commentMutation.isPending) && { opacity: 0.4 }]}
            onPress={handleSubmit}
            disabled={!commentText.trim() || commentMutation.isPending}
          >
            {commentMutation.isPending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="send" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const st = StyleSheet.create({
  list:          { flex: 1, backgroundColor: '#f9fafb' },
  centered:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  postCard:      { backgroundColor: '#fff', marginBottom: 8 },
  postAuthorRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  postAv:        { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  postAvImg:     { width: 40, height: 40, borderRadius: 20 },
  postAvTxt:     { fontSize: 14, fontWeight: '700', color: '#fff' },
  postAuthorName: { fontWeight: '700', color: '#111827', fontSize: 14 },
  postTime:      { fontSize: 12, color: '#9ca3af', marginTop: 1 },
  postBody:      { paddingHorizontal: 12, paddingBottom: 12, color: '#374151', lineHeight: 22, fontSize: 15 },
  postMedia:     { width: '100%', height: 240, backgroundColor: '#e5e7eb' },
  postActions:   { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderColor: '#f3f4f6', gap: 20 },
  postAction:    { flexDirection: 'row', alignItems: 'center', gap: 5 },
  postActionTxt: { color: '#6b7280', fontSize: 14 },
  commentsHeader: { fontSize: 15, fontWeight: '700', paddingHorizontal: 12, paddingVertical: 10, color: '#111827', borderTopWidth: 1, borderColor: '#f3f4f6' },
  commentRow:    { flexDirection: 'row', padding: 12, borderBottomWidth: 1, borderColor: '#f3f4f6', backgroundColor: '#fff', gap: 8 },
  commentAv:     { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', flexShrink: 0, marginTop: 2 },
  commentAvImg:  { width: 32, height: 32, borderRadius: 16 },
  commentAvTxt:  { fontSize: 11, fontWeight: '700', color: '#fff' },
  commentBubble: { backgroundColor: '#f3f4f6', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 7, flex: 1 },
  commentAuthor: { fontSize: 12, fontWeight: '700', color: '#111827', marginBottom: 2 },
  commentBody:   { fontSize: 13, color: '#374151', lineHeight: 18 },
  commentMeta:   { flexDirection: 'row', gap: 10, marginTop: 4, flexWrap: 'wrap' },
  commentTime:   { fontSize: 11, color: '#9ca3af' },
  actionLink:    { fontSize: 11, color: '#4f46e5', fontWeight: '600' },
  editInput:     { borderWidth: 1, borderColor: '#c7d2fe', borderRadius: 8, padding: 6, fontSize: 13, color: '#374151', marginTop: 4 },
  emptyTxt:      { textAlign: 'center', color: '#9ca3af', padding: 32 },
  loadMore:      { alignItems: 'center', padding: 16 },
  loadMoreTxt:   { color: '#4f46e5', fontWeight: '600', fontSize: 13 },
  replyBanner:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#ede9fe', paddingHorizontal: 12, paddingVertical: 8 },
  replyTxt:      { fontSize: 12, color: '#4f46e5' },
  inputBar:      { flexDirection: 'row', alignItems: 'flex-end', padding: 8, backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#e5e7eb', gap: 8 },
  input:         { flex: 1, backgroundColor: '#f3f4f6', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, maxHeight: 100, fontSize: 14, color: '#374151' },
  sendBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: '#4f46e5', alignItems: 'center', justifyContent: 'center' },
});





