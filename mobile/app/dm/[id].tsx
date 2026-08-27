/**
 * HALQA Mobile — DM Conversation Thread
 * Route: /dm/[id] where id = otherUserId
 * Backend: GET /dm/conversations/:userId/with → returns convId
 *          GET /dm/conversations/:convId/messages
 *          POST /dm/conversations/:convId/messages  { body }
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useInfiniteQuery, useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatDistanceToNow } from 'date-fns';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { getSocket } from '@/lib/socket';

interface Message {
  id: string;
  body: string;
  senderId: string;
  createdAt: string;
  isEdited?: boolean;      // Sprint 16 (CHAT-GAP-002): true when message was edited
  editedAt?:  string;      // Sprint 16: timestamp of last edit
  sender: { id: string; firstName: string; lastName: string };
}

export default function DMConversationScreen() {
  const { id: otherUserId } = useLocalSearchParams<{ id: string }>();
  const router   = useRouter();
  const { user } = useAuthStore();
  const qc       = useQueryClient();
  const [text, setText] = useState('');
  const [convId, setConvId] = useState<string | null>(null);
  const [otherName, setOtherName] = useState('Chat');
  const flatRef = useRef<FlatList>(null);

  // ── Step 1: resolve or create conversation ─────────────────────────────────
  useEffect(() => {
    if (!otherUserId) return;
    api.get(`/dm/conversations/${otherUserId}/with`)
      .then(r => {
        const conv = r.data.data;
        setConvId(conv?.id ?? null);
        // The response includes `other` directly (not `participants`)
        const other = conv?.other;
        if (other?.firstName) {
          setOtherName(`${other.firstName} ${other.lastName}`.trim());
        }
      })
      .catch(() => {
        showMessage({ message: 'Could not open conversation', type: 'danger' });
      });
  }, [otherUserId, user?.id]);

  // ── Step 2: load other user's info for the header ──────────────────────────
  useQuery({
    queryKey: ['user-basic', otherUserId],
    queryFn: () => api.get(`/users/${otherUserId}`).then(r => {
      const u = r.data.data;
      setOtherName(`${u.firstName} ${u.lastName}`.trim());
      return u;
    }),
    enabled: !!otherUserId && otherName === 'Chat',
  });

  // ── Step 3: load messages ──────────────────────────────────────────────────
  const { data, fetchNextPage, hasNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['dm-messages', convId],
    queryFn: ({ pageParam }) =>
      api.get(`/dm/conversations/${convId}/messages`, {
        params: { before: pageParam, limit: 30 },
      }).then(r => r.data.data ?? []),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: Message[]) =>
      page?.length === 30 ? page[0]?.createdAt : undefined,
    enabled: !!convId,
  });

  const messages: Message[] = (data?.pages.flatMap(p => p) ?? []).slice().reverse();

  // ── Step 4: send message ───────────────────────────────────────────────────
  const sendMutation = useMutation({
    mutationFn: (body: string) =>
      api.post(`/dm/conversations/${convId}/messages`, { body }),
    onSuccess: () => {
      setText('');
      qc.invalidateQueries({ queryKey: ['dm-messages', convId] });
      qc.invalidateQueries({ queryKey: ['dm-conversations'] });
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    },
    onError: () => {
      showMessage({ message: 'Failed to send message', type: 'danger' });
    },
  });

  // ── Step 5: Socket.IO real-time ────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !convId) return;

    // Backend emits { convId, message } to receiver's personal room
    const onMsg = (data: { convId: string; message: any }) => {
      if (data.convId !== convId) return;
      qc.invalidateQueries({ queryKey: ['dm-messages', convId] });
      qc.invalidateQueries({ queryKey: ['dm-conversations'] });
    };
    // Delivered / read receipts — just refresh to show tick update
    const onDelivered = (data: { convId: string }) => {
      if (data.convId === convId) qc.invalidateQueries({ queryKey: ['dm-messages', convId] });
    };
    const onRead = (data: { convId: string }) => {
      if (data.convId === convId) qc.invalidateQueries({ queryKey: ['dm-messages', convId] });
    };
    // Sprint 16 (CHAT-GAP-002): handle real-time message edit from sender
    // Backend emits { convId, messageId, newBody, editedAt } to receiver's personal room
    const onEdited = (data: { convId: string; messageId: string; newBody: string; editedAt: string }) => {
      if (data.convId !== convId) return;
      qc.setQueryData(['dm-messages', convId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page: Message[]) =>
            page.map(msg =>
              msg.id === data.messageId
                ? { ...msg, body: data.newBody, isEdited: true, editedAt: data.editedAt }
                : msg
            )
          ),
        };
      });
    };

    socket.on('dm:message',       onMsg);
    socket.on('dm:delivered',     onDelivered);
    socket.on('dm:read',          onRead);
    socket.on('dm:message_edited', onEdited);

    return () => {
      socket.off('dm:message',       onMsg);
      socket.off('dm:delivered',     onDelivered);
      socket.off('dm:read',          onRead);
      socket.off('dm:message_edited', onEdited);
    };
  }, [otherUserId, convId, qc]);

  // ── Mark as read when screen opens ────────────────────────────────────────
  useEffect(() => {
    if (!convId) return;
    api.patch(`/dm/conversations/${convId}/read`).catch(() => {});
  }, [convId]);

  const handleSend = () => {
    if (!text.trim() || !convId) return;
    sendMutation.mutate(text.trim());
  };

  const renderMsg = useCallback(({ item }: { item: Message }) => {
    const isMe = item.senderId === user?.id;
    return (
      <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
        <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
          <Text style={[styles.bubbleText, isMe && { color: '#fff' }]}>
            {item.body}
          </Text>
          <Text style={[styles.bubbleTime, isMe && { color: '#c7d2fe' }]}>
            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
            {item.isEdited && ' · edited'}
          </Text>
        </View>
      </View>
    );
  }, [user?.id]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color="#374151" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerName} numberOfLines={1}>{otherName}</Text>
          {convId && <Text style={styles.headerSub}>tap to view profile</Text>}
        </View>
        <TouchableOpacity
          style={styles.headerAction}
          onPress={() => router.push(`/profile/${otherUserId}` as any)}
        >
          <Ionicons name="person-outline" size={22} color="#4f46e5" />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}
      >
        {/* Messages list */}
        {isLoading || !convId ? (
          <View style={styles.center}>
            <ActivityIndicator color="#4f46e5" />
            <Text style={styles.loadingText}>
              {!convId ? 'Opening conversation…' : 'Loading messages…'}
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatRef}
            data={messages}
            keyExtractor={m => m.id}
            renderItem={renderMsg}
            contentContainerStyle={{ padding: 12, gap: 6, paddingBottom: 16 }}
            onEndReached={() => { if (hasNextPage) fetchNextPage(); }}
            onEndReachedThreshold={0.2}
            onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="chatbubbles-outline" size={40} color="#d1d5db" />
                <Text style={styles.emptyText}>Say hello to {otherName}</Text>
              </View>
            }
          />
        )}

        {/* Input bar */}
        <View style={styles.inputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Type a message…"
            placeholderTextColor="#9ca3af"
            style={styles.input}
            multiline
            maxLength={2000}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!text.trim() || sendMutation.isPending || !convId) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!text.trim() || sendMutation.isPending || !convId}
          >
            {sendMutation.isPending
              ? <ActivityIndicator color="#fff" size="small" />
              : <Ionicons name="send" size={18} color="#fff" />
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f9fafb' },
  header:       { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  backBtn:      { padding: 4 },
  headerCenter: { flex: 1 },
  headerName:   { fontSize: 16, fontWeight: '700', color: '#111827' },
  headerSub:    { fontSize: 11, color: '#9ca3af' },
  headerAction: { padding: 4 },
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  loadingText:  { color: '#9ca3af', fontSize: 13 },
  emptyWrap:    { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyText:    { color: '#9ca3af', fontSize: 14 },
  msgRow:       { flexDirection: 'row', marginVertical: 2 },
  msgRowMe:     { justifyContent: 'flex-end' },
  bubble:       { maxWidth: '75%', borderRadius: 18, padding: 12, paddingBottom: 8 },
  bubbleMe:     { backgroundColor: '#4f46e5', borderBottomRightRadius: 4 },
  bubbleThem:   { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderBottomLeftRadius: 4 },
  bubbleText:   { fontSize: 15, color: '#111827', lineHeight: 20 },
  bubbleTime:   { fontSize: 10, color: '#9ca3af', marginTop: 4, alignSelf: 'flex-end' },
  inputRow:     { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  input:        { flex: 1, backgroundColor: '#f9fafb', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: '#111827', maxHeight: 100, borderWidth: 1, borderColor: '#e5e7eb' },
  sendBtn:      { width: 40, height: 40, borderRadius: 20, backgroundColor: '#4f46e5', justifyContent: 'center', alignItems: 'center' },
  sendBtnDisabled: { backgroundColor: '#c7d2fe' },
});
