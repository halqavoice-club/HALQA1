/**
 * HALQA Mobile — DM Conversation Thread
 * Route: /dm/[id] where id = otherUserId
 *
 * CHAT-GAP-002 fix: Full message edit UI
 *  - Long-press own message → edit / copy / delete action sheet
 *  - Edit mode: prefills input, shows "editing" bar, sends PATCH /dm/messages/:msgId
 *  - Socket event dm:message_edited handled + optimistic cache update
 *  - "edited" indicator on modified messages
 */
import KeyboardAvoidingView from '@/components/KeyboardAvoidingView';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  Platform, ActivityIndicator, Alert, ActionSheetIOS} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useInfiniteQuery, useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatDistanceToNow, differenceInMinutes } from 'date-fns';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { getSocket } from '@/lib/socket';

interface Message {
  id: string;
  body: string;
  senderId: string;
  createdAt: string;
  isEdited?: boolean;
  editedAt?:  string;
  sender: { id: string; firstName: string; lastName: string };
}

export default function DMConversationScreen() {
  const { id: otherUserId } = useLocalSearchParams<{ id: string }>();
  const router   = useRouter();
  const { user } = useAuthStore();
  const qc       = useQueryClient();
  const inputRef = useRef<TextInput>(null);
  const flatRef  = useRef<FlatList>(null);

  const [text,       setText]       = useState('');
  const [convId,     setConvId]     = useState<string | null>(null);
  const [otherName,  setOtherName]  = useState('Chat');
  // Edit state
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);

  // ── Resolve or create conversation ────────────────────────────────────────
  useEffect(() => {
    if (!otherUserId) return;
    api.get(`/dm/conversations/${otherUserId}/with`)
      .then(r => {
        const conv = r.data.data;
        setConvId(conv?.id ?? null);
        const other = conv?.other;
        if (other?.firstName) setOtherName(`${other.firstName} ${other.lastName}`.trim());
      })
      .catch(() => showMessage({ message: 'Could not open conversation', type: 'danger' }));
  }, [otherUserId, user?.id]);

  // ── Load other user info ───────────────────────────────────────────────────
  useQuery({
    queryKey: ['user-basic', otherUserId],
    queryFn: () => api.get(`/users/${otherUserId}`).then(r => {
      const u = r.data.data;
      setOtherName(`${u.firstName} ${u.lastName}`.trim());
      return u;
    }),
    enabled: !!otherUserId && otherName === 'Chat',
  });

  // ── Load messages ──────────────────────────────────────────────────────────
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

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMutation = useMutation({
    mutationFn: (body: string) =>
      api.post(`/dm/conversations/${convId}/messages`, { body }),
    onSuccess: () => {
      setText('');
      qc.invalidateQueries({ queryKey: ['dm-messages', convId] });
      qc.invalidateQueries({ queryKey: ['dm-conversations'] });
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    },
    onError: () => showMessage({ message: 'Failed to send message', type: 'danger' }),
  });

  // ── Edit message (CHAT-GAP-002) ────────────────────────────────────────────
  const editMutation = useMutation({
    mutationFn: ({ msgId, body }: { msgId: string; body: string }) =>
      api.patch(`/dm/messages/${msgId}`, { body }),
    onSuccess: (_, { msgId, body }) => {
      // Optimistic update — replace message body in cache immediately
      qc.setQueryData(['dm-messages', convId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page: Message[]) =>
            page.map(msg =>
              msg.id === msgId
                ? { ...msg, body, isEdited: true, editedAt: new Date().toISOString() }
                : msg
            )
          ),
        };
      });
      setText('');
      setEditingMsg(null);
      showMessage({ message: 'Message edited', type: 'success', duration: 1500 });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to edit message';
      showMessage({ message: msg, type: 'danger' });
    },
  });

  // ── Socket.IO real-time ────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !convId) return;

    const onMsg = (data: { convId: string; message: any }) => {
      if (data.convId !== convId) return;
      qc.invalidateQueries({ queryKey: ['dm-messages', convId] });
      qc.invalidateQueries({ queryKey: ['dm-conversations'] });
    };
    const onDelivered = (data: { convId: string }) => {
      if (data.convId === convId) qc.invalidateQueries({ queryKey: ['dm-messages', convId] });
    };
    const onRead = (data: { convId: string }) => {
      if (data.convId === convId) qc.invalidateQueries({ queryKey: ['dm-messages', convId] });
    };
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

    socket.on('dm:message',        onMsg);
    socket.on('dm:delivered',      onDelivered);
    socket.on('dm:read',           onRead);
    socket.on('dm:message_edited', onEdited);

    return () => {
      socket.off('dm:message',        onMsg);
      socket.off('dm:delivered',      onDelivered);
      socket.off('dm:read',           onRead);
      socket.off('dm:message_edited', onEdited);
    };
  }, [otherUserId, convId, qc]);

  // ── Mark as read on open ───────────────────────────────────────────────────
  useEffect(() => {
    if (!convId) return;
    api.patch(`/dm/conversations/${convId}/read`).catch(() => {});
  }, [convId]);

  // ── Handle send / save edit ────────────────────────────────────────────────
  const handleSend = () => {
    if (!text.trim() || !convId) return;
    if (editingMsg) {
      editMutation.mutate({ msgId: editingMsg.id, body: text.trim() });
    } else {
      sendMutation.mutate(text.trim());
    }
  };

  const cancelEdit = () => {
    setEditingMsg(null);
    setText('');
  };

  // ── Long-press own message: edit / copy / cancel ──────────────────────────
  const handleLongPress = useCallback((msg: Message) => {
    if (msg.senderId !== user?.id) return;

    // Check 15-minute edit window
    const ageMinutes = differenceInMinutes(new Date(), new Date(msg.createdAt));
    const canEdit = ageMinutes <= 15;

    if (Platform.OS === 'ios') {
      const options = canEdit
        ? ['Edit', 'Copy', 'Cancel']
        : ['Copy', 'Cancel'];
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: -1 },
        (idx) => {
          if (canEdit) {
            if (idx === 0) { startEdit(msg); }
            else if (idx === 1) { copyMsg(msg); }
          } else {
            if (idx === 0) { copyMsg(msg); }
          }
        }
      );
    } else {
      // Android fallback alert
      const editOption = canEdit ? [{
        text: 'Edit',
        onPress: () => startEdit(msg),
      }] : [];
      Alert.alert('Message', msg.body.slice(0, 80) + (msg.body.length > 80 ? '…' : ''), [
        ...editOption,
        { text: 'Copy', onPress: () => copyMsg(msg) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [user?.id]);

  const startEdit = (msg: Message) => {
    setEditingMsg(msg);
    setText(msg.body);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const copyMsg = async (msg: Message) => {
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(msg.body);
      showMessage({ message: 'Copied', type: 'success', duration: 1200 });
    } catch {
      // Clipboard not available in Expo Go — silent fail
    }
  };

  // ── Render message ─────────────────────────────────────────────────────────
  const renderMsg = useCallback(({ item }: { item: Message }) => {
    const isMe = item.senderId === user?.id;
    const isEditing = editingMsg?.id === item.id;

    return (
      <TouchableOpacity
        activeOpacity={isMe ? 0.75 : 1}
        onLongPress={isMe ? () => handleLongPress(item) : undefined}
        delayLongPress={400}
      >
        <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
          <View style={[
            styles.bubble,
            isMe ? styles.bubbleMe : styles.bubbleThem,
            isEditing && styles.bubbleEditing,
          ]}>
            <Text style={[styles.bubbleText, isMe && { color: '#fff' }]}>
              {item.body}
            </Text>
            <View style={styles.timeLine}>
              {item.isEdited && (
                <Text style={[styles.editedLabel, isMe && { color: '#c7d2fe' }]}>edited</Text>
              )}
              <Text style={[styles.bubbleTime, isMe && { color: '#c7d2fe' }]}>
                {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [user?.id, editingMsg, handleLongPress]);

  const isPending = sendMutation.isPending || editMutation.isPending;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color="#374151" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerName} numberOfLines={1}>{otherName}</Text>
          {convId && <Text style={styles.headerSub}>DM conversation</Text>}
        </View>
        <TouchableOpacity style={styles.headerAction}
          onPress={() => router.push(`/profile/${otherUserId}` as any)}>
          <Ionicons name="person-outline" size={22} color="#4f46e5" />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        {/* Messages */}
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

        {/* Edit mode banner */}
        {editingMsg && (
          <View style={styles.editBanner}>
            <View style={styles.editBannerContent}>
              <Ionicons name="pencil" size={14} color="#4f46e5" />
              <Text style={styles.editBannerText} numberOfLines={1}>
                Editing: {editingMsg.body}
              </Text>
            </View>
            <TouchableOpacity onPress={cancelEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={18} color="#6b7280" />
            </TouchableOpacity>
          </View>
        )}

        {/* Input bar */}
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            placeholder={editingMsg ? 'Edit message…' : 'Type a message…'}
            placeholderTextColor="#9ca3af"
            style={[styles.input, editingMsg && styles.inputEditing]}
            multiline
            maxLength={5000}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!text.trim() || isPending || !convId) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!text.trim() || isPending || !convId}
          >
            {isPending
              ? <ActivityIndicator color="#fff" size="small" />
              : <Ionicons name={editingMsg ? 'checkmark' : 'send'} size={18} color="#fff" />
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#f9fafb' },
  header:         { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  backBtn:        { padding: 4 },
  headerCenter:   { flex: 1 },
  headerName:     { fontSize: 16, fontWeight: '700', color: '#111827' },
  headerSub:      { fontSize: 11, color: '#9ca3af' },
  headerAction:   { padding: 4 },
  center:         { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  loadingText:    { color: '#9ca3af', fontSize: 13 },
  emptyWrap:      { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyText:      { color: '#9ca3af', fontSize: 14 },
  msgRow:         { flexDirection: 'row', marginVertical: 2 },
  msgRowMe:       { justifyContent: 'flex-end' },
  bubble:         { maxWidth: '75%', borderRadius: 18, padding: 12, paddingBottom: 8 },
  bubbleMe:       { backgroundColor: '#4f46e5', borderBottomRightRadius: 4 },
  bubbleThem:     { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderBottomLeftRadius: 4 },
  bubbleEditing:  { opacity: 0.7, borderWidth: 2, borderColor: '#a5b4fc' },
  bubbleText:     { fontSize: 15, color: '#111827', lineHeight: 20 },
  timeLine:       { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, alignSelf: 'flex-end' },
  editedLabel:    { fontSize: 10, color: '#6b7280', fontStyle: 'italic' },
  bubbleTime:     { fontSize: 10, color: '#9ca3af' },
  // Edit banner
  editBanner:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#eef2ff', paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#c7d2fe' },
  editBannerContent: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  editBannerText: { fontSize: 13, color: '#4f46e5', flex: 1 },
  // Input bar
  inputRow:       { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  input:          { flex: 1, backgroundColor: '#f9fafb', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: '#111827', maxHeight: 100, borderWidth: 1, borderColor: '#e5e7eb' },
  inputEditing:   { borderColor: '#a5b4fc', backgroundColor: '#f5f3ff' },
  sendBtn:        { width: 40, height: 40, borderRadius: 20, backgroundColor: '#4f46e5', justifyContent: 'center', alignItems: 'center' },
  sendBtnDisabled:{ backgroundColor: '#c7d2fe' },
});






