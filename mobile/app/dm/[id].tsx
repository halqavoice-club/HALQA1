/**
 * HALQA Mobile — DM Conversation Thread (Phase 4: Full media support)
 *
 * Uses DmMediaBubble for rendering all content types (text/image/video/GIF/voice/audio/file).
 * Uses DmInputBar for sending all message types including voice recording.
 *
 * Features: typing, read receipts, reply-to, reactions, edit, delete, dm:message_deleted realtime.
 */
import KeyboardAvoidingView from '@/components/KeyboardAvoidingView';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Platform, ActivityIndicator, Alert, Modal, Pressable, TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useInfiniteQuery, useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { differenceInMinutes, format, isToday } from 'date-fns';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { dmApi, type SendMessagePayload } from '@/lib/dm';
import { useAuthStore } from '@/store/auth.store';
import { getSocket } from '@/lib/socket';
import { DmMediaBubble } from '@/src/components/dm/DmMediaBubble';
import { DmInputBar } from '@/src/components/dm/DmInputBar';
import { MobileShareSheet, type MobileSharePayload } from '@/src/components/chat/MobileShareSheet';

// ─── Types ────────────────────────────────────────────────────────────────────
interface DmUser { id: string; firstName: string; lastName: string; avatarUrl?: string | null }
interface DmReaction { id: string; userId: string; emoji: string; user: DmUser }
interface DmReplyTo { id: string; body?: string | null; sender: DmUser; msgType?: string }

interface Message {
  id: string; body?: string | null; senderId: string;
  status: 'SENT' | 'DELIVERED' | 'READ';
  deliveredAt: string | null; readAt: string | null; createdAt: string;
  isEdited?: boolean; editedAt?: string;
  replyToId?: string | null; replyTo?: DmReplyTo | null;
  reactions?: DmReaction[];
  sender: DmUser;
  // Phase 4 media
  msgType?: string;
  mediaUrl?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  fileName?: string | null;
  duration?: number | null;
  width?: number | null; height?: number | null;
  thumbnail?: string | null;
  // Phase 6: structured entity reference (VOICE_ROOM_SHARE)
  refEntityType?: string | null;
  refEntityId?: string | null;
  voiceRoomData?: {
    id: string;
    title: string;
    coverEmoji?: string | null;
    coverImageUrl?: string | null;
    privacy?: string | null;
    status?: string | null;
    hostId?: string | null;
    maxSpeakers?: number | null;
  } | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const WA_GREEN = '#25d366';
const WA_DARK  = '#128c7e';
const WA_BG    = '#ece5dd';
const WA_SENT  = '#dcf8c6';
const WA_READ  = '#53bdeb';
const QUICK_REACT = ['❤️', '😂', '😮', '😢', '🙏', '👍'];

function fmtTime(iso: string) {
  const d = new Date(iso);
  return isToday(d) ? format(d, 'h:mm a') : format(d, 'MMM d, h:mm a');
}
function ini(first: string, last: string) {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

// ─── Read tick ────────────────────────────────────────────────────────────────
function Tick({ status }: { status: Message['status'] }) {
  if (status === 'READ') return (
    <View style={{ flexDirection: 'row', marginLeft: 3 }}>
      <Ionicons name="checkmark" size={11} color={WA_READ} style={{ marginRight: -5 }} />
      <Ionicons name="checkmark" size={11} color={WA_READ} />
    </View>
  );
  if (status === 'DELIVERED') return (
    <View style={{ flexDirection: 'row', marginLeft: 3 }}>
      <Ionicons name="checkmark" size={11} color="#92a8a8" style={{ marginRight: -5 }} />
      <Ionicons name="checkmark" size={11} color="#92a8a8" />
    </View>
  );
  return <Ionicons name="checkmark" size={11} color="#92a8a8" style={{ marginLeft: 3 }} />;
}

// ─── Typing dots ──────────────────────────────────────────────────────────────
function TypingDots({ name }: { name: string }) {
  return (
    <View style={s.typingRow}>
      <View style={s.typingBubble}>
        <View style={s.typingDotsWrap}>
          {[0,1,2].map(i => <View key={i} style={[s.typingDot, { opacity: 0.4 + i * 0.2 }]} />)}
        </View>
      </View>
      <Text style={s.typingName}>{name} is typing…</Text>
    </View>
  );
}

// ─── Date separator ───────────────────────────────────────────────────────────
function DateSep({ iso }: { iso: string }) {
  const d = new Date(iso);
  const label = isToday(d) ? 'Today' : format(d, 'MMMM d, yyyy');
  return (
    <View style={s.dateSep}>
      <Text style={s.dateText}>{label}</Text>
    </View>
  );
}

// ─── Bubble ───────────────────────────────────────────────────────────────────
function Bubble({ msg, isMe, onLongPress }: { msg: Message; isMe: boolean; onLongPress: () => void }) {
  const reactionGroups = (msg.reactions ?? []).reduce<Record<string,number>>((a,r) => {
    a[r.emoji] = (a[r.emoji] ?? 0) + 1; return a;
  }, {});

  const isMediaType = msg.msgType && msg.msgType !== 'TEXT';

  return (
    <TouchableOpacity activeOpacity={0.85} onLongPress={onLongPress} delayLongPress={350}
      style={[s.msgRow, isMe && s.msgRowMe]}>
      <View style={{ alignItems: isMe ? 'flex-end' : 'flex-start' }}>
        {/* Reply preview */}
        {msg.replyTo && (
          <View style={[s.replyBox, isMe && s.replyBoxMe]}>
            <View style={[s.replyBar, { backgroundColor: WA_DARK }]} />
            <View style={{ flex: 1 }}>
              <Text style={[s.replyName, { color: WA_DARK }]}>{msg.replyTo.sender.firstName}</Text>
              <Text style={s.replyBody} numberOfLines={1}>
                {msg.replyTo.body || (msg.replyTo.msgType !== 'TEXT' ? `📎 ${msg.replyTo.msgType}` : '')}
              </Text>
            </View>
          </View>
        )}

        {/* Bubble */}
        <View style={[
          s.bubble,
          isMe ? s.bubbleMe : s.bubbleThem,
          // No padding for image/video/GIF so they fill cleanly
          isMediaType && (msg.msgType === 'IMAGE' || msg.msgType === 'VIDEO' || msg.msgType === 'GIF')
            ? { padding: 2 } : {},
        ]}>
          <DmMediaBubble msg={msg} isMe={isMe} />
          <View style={s.metaRow}>
            {msg.isEdited && <Text style={[s.editedLabel, isMe && { color: '#555' }]}>edited </Text>}
            <Text style={[s.timeText, isMe && { color: '#555' }]}>{fmtTime(msg.createdAt)}</Text>
            {isMe && <Tick status={msg.status} />}
          </View>
        </View>

        {/* Reactions */}
        {Object.keys(reactionGroups).length > 0 && (
          <View style={s.reactRow}>
            {Object.entries(reactionGroups).map(([emoji, count]) => (
              <View key={emoji} style={s.reactPill}>
                <Text style={s.reactEmoji}>{emoji}</Text>
                {count > 1 && <Text style={s.reactCount}>{count}</Text>}
              </View>
            ))}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function DMConversationScreen() {
  const { id: otherUserId } = useLocalSearchParams<{ id: string }>();
  const router   = useRouter();
  const { user } = useAuthStore();
  const qc       = useQueryClient();
  const flatRef  = useRef<FlatList>(null);
  const typingTimer    = useRef<ReturnType<typeof setTimeout>>();
  const lastTypingEmit = useRef(0);

  const [convId,       setConvId]       = useState<string | null>(null);
  const [otherUser,    setOtherUser]    = useState<any>(null);
  const [editingMsg,   setEditingMsg]   = useState<Message | null>(null);
  const [replyTo,      setReplyTo]      = useState<Message | null>(null);
  const [isTyping,     setIsTyping]     = useState(false);
  const [actionTarget, setActionTarget] = useState<Message | null>(null);
  const [sending,      setSending]      = useState(false);
  const [showSearch,   setShowSearch]   = useState(false);
  const [searchQuery,  setSearchQuery]  = useState('');
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  // Forward
  const [forwardMsg,   setForwardMsg]   = useState<Message | null>(null);
  const [showForward,  setShowForward]  = useState(false);

  // ── Resolve conversation ────────────────────────────────────────────────────
  useEffect(() => {
    if (!otherUserId) return;
    api.get(`/dm/conversations/${otherUserId}/with`)
      .then(r => { const c = r.data.data; setConvId(c?.id ?? null); if (c?.other) setOtherUser(c.other); })
      .catch(() => showMessage({ message: 'Could not open conversation', type: 'danger' }));
  }, [otherUserId]);

  useQuery({
    queryKey: ['user-basic', otherUserId],
    queryFn: () => api.get(`/users/${otherUserId}`).then(r => { setOtherUser(r.data.data); return r.data.data; }),
    enabled: !!otherUserId && !otherUser,
  });

  // ── Messages ────────────────────────────────────────────────────────────────
  const { data, fetchNextPage, hasNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['dm-messages', convId],
    queryFn: ({ pageParam }) =>
      api.get(`/dm/conversations/${convId}/messages`, { params: { before: pageParam, limit: 30 } })
        .then(r => r.data.data ?? []),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: Message[]) => page?.length === 30 ? page[0]?.createdAt : undefined,
    enabled: !!convId,
  });

  const messages: Message[] = (data?.pages.flatMap(p => p) ?? []).slice().reverse();
  type Item = Message | { _sep: string };
  const listItems: Item[] = [];
  let lastDate = '';
  for (const msg of messages) {
    const d = msg.createdAt.slice(0, 10);
    if (d !== lastDate) { listItems.push({ _sep: msg.createdAt }); lastDate = d; }
    listItems.push(msg);
  }

  // ── Mark read ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!convId) return;
    // BUG-5 FIX: After marking read, invalidate the conversations list so the
    // unread badge in the DM list screen clears immediately without a manual refresh.
    api.patch(`/dm/conversations/${convId}/read`)
      .then(() => {
        qc.invalidateQueries({ queryKey: ['dm-conversations'] });
      })
      .catch(() => {});
  }, [convId, qc]);

  // ── Socket ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !convId) return;

    const patch = (fn: (pages: Message[][]) => Message[][]) =>
      qc.setQueryData(['dm-messages', convId], (old: any) =>
        old ? { ...old, pages: fn(old.pages) } : old
      );

    const onMsg = (d: any) => {
      if (d.convId !== convId) return;
      qc.invalidateQueries({ queryKey: ['dm-messages', convId] });
      qc.invalidateQueries({ queryKey: ['dm-conversations'] });
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    };
    const onDel      = (d: any) => { if (d.convId === convId) qc.invalidateQueries({ queryKey: ['dm-messages', convId] }); };
    const onRead     = (d: any) => { if (d.convId === convId) qc.invalidateQueries({ queryKey: ['dm-messages', convId] }); };
    const onEdit     = (d: any) => {
      if (d.convId !== convId) return;
      patch(pages => pages.map(pg => pg.map(m => m.id === d.messageId ? { ...m, body: d.newBody, isEdited: true } : m)));
    };
    const onDeleted  = (d: any) => {
      if (d.convId !== convId) return;
      // BUG-4 FIX: Receiver-only delete should not remove message from sender's view.
      if (!d.forEveryone && d.deletedBy !== user?.id) return;
      patch(pages => pages.map(pg => pg.filter(m => m.id !== d.messageId)));
    };
    const onReact    = (d: any) => {
      if (d.convId !== convId) return;
      patch(pages => pages.map(pg => pg.map(m => {
        if (m.id !== d.messageId) return m;
        let reactions = m.reactions ?? [];
        if (d.action === 'removed') reactions = reactions.filter(r => !(r.userId === d.userId && r.emoji === d.emoji));
        else if (d.reaction && !reactions.some(r => r.id === d.reaction.id)) reactions = [...reactions, d.reaction];
        return { ...m, reactions };
      })));
    };
    const onTypingStart = (d: any) => { if (d.convId === convId && d.userId !== user?.id) setIsTyping(true); };
    const onTypingStop  = (d: any) => { if (d.convId === convId) setIsTyping(false); };

    socket.on('dm:message',         onMsg);
    socket.on('dm:delivered',       onDel);
    socket.on('dm:read',            onRead);
    socket.on('dm:message_edited',  onEdit);
    socket.on('dm:message_deleted', onDeleted);
    socket.on('dm:reaction',        onReact);
    socket.on('dm:typing_start',    onTypingStart);
    socket.on('dm:typing_stop',     onTypingStop);
    return () => {
      socket.off('dm:message', onMsg); socket.off('dm:delivered', onDel);
      socket.off('dm:read', onRead); socket.off('dm:message_edited', onEdit);
      socket.off('dm:message_deleted', onDeleted); socket.off('dm:reaction', onReact);
      socket.off('dm:typing_start', onTypingStart); socket.off('dm:typing_stop', onTypingStop);
    };
  }, [convId, user?.id, qc]);

  // ── Typing emit ─────────────────────────────────────────────────────────────
  const handleTyping = useCallback(() => {
    if (!convId || !otherUser) return;
    const socket = getSocket();
    if (!socket) return;
    const now = Date.now();
    if (now - lastTypingEmit.current > 2500) { socket.emit('dm:typing_start', { convId, receiverId: otherUser.id }); lastTypingEmit.current = now; }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => { socket.emit('dm:typing_stop', { convId, receiverId: otherUser.id }); lastTypingEmit.current = 0; }, 2500);
  }, [convId, otherUser]);

  // ── In-conversation search ──────────────────────────────────────────────────
  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    clearTimeout(searchTimer.current);
    if (!q.trim() || !convId) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const r = await api.get(`/dm/conversations/${convId}/search`, { params: { q: q.trim(), limit: 20 } });
        setSearchResults(r.data.data ?? []);
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    }, 400);
  }, [convId]);

  // ── All DM conversations fetched by MobileShareSheet internally ────────────

  // ── Forward handler ─────────────────────────────────────────────────────────
  const handleForward = useCallback(async (targetConvId: string) => {
    if (!forwardMsg) return;
    try {
      const payload: any = {
        msgType: forwardMsg.msgType ?? 'TEXT',
      };
      if (forwardMsg.body?.trim()) payload.body = forwardMsg.body.trim();
      if (forwardMsg.msgType && forwardMsg.msgType !== 'TEXT' && forwardMsg.mediaUrl) {
        payload.mediaUrl = forwardMsg.mediaUrl;
        if (forwardMsg.mimeType) payload.mimeType = forwardMsg.mimeType;
        if (forwardMsg.fileSize) payload.fileSize = forwardMsg.fileSize;
        if (forwardMsg.fileName) payload.fileName = forwardMsg.fileName;
        if (forwardMsg.duration) payload.duration = forwardMsg.duration;
      }
      if (!payload.body && !payload.mediaUrl) {
        showMessage({ message: 'Nothing to forward', type: 'warning' }); return;
      }
      await api.post(`/dm/conversations/${targetConvId}/messages`, payload);
      setShowForward(false); setForwardMsg(null);
      showMessage({ message: 'Message forwarded', type: 'success', duration: 1500 });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to forward', type: 'danger' });
    }
  }, [forwardMsg]);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (msgId: string) => api.delete(`/dm/messages/${msgId}`),
    onSuccess: (_, msgId) => {
      qc.setQueryData(['dm-messages', convId], (old: any) => old ? { ...old, pages: old.pages.map((pg: Message[]) => pg.filter(m => m.id !== msgId)) } : old);
    },
    onError: () => showMessage({ message: 'Failed to delete', type: 'danger' }),
  });

  const reactMutation = useMutation({
    mutationFn: ({ msgId, emoji }: { msgId: string; emoji: string }) =>
      api.post(`/dm/messages/${msgId}/reactions`, { emoji }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dm-messages', convId] }),
  });

  const editMutation = useMutation({
    mutationFn: ({ msgId, body }: { msgId: string; body: string }) => api.patch(`/dm/messages/${msgId}`, { body }),
    onSuccess: (_, { msgId, body }) => {
      qc.setQueryData(['dm-messages', convId], (old: any) => old ? { ...old, pages: old.pages.map((pg: Message[]) =>
        pg.map(m => m.id === msgId ? { ...m, body, isEdited: true } : m)
      )} : old);
    },
    onError: (err: any) => showMessage({ message: err?.response?.data?.message ?? 'Failed to edit', type: 'danger' }),
  });

  // ── Long-press action ───────────────────────────────────────────────────────
  const handleAction = useCallback((action: 'reply' | 'edit' | 'copy' | 'delete' | 'forward') => {
    if (!actionTarget) return;
    setActionTarget(null);
    if (action === 'reply') { setReplyTo(actionTarget); setEditingMsg(null); }
    else if (action === 'copy') {
      import('expo-clipboard').then(C => { C.setStringAsync(actionTarget.body ?? ''); showMessage({ message: 'Copied', type: 'success', duration: 1200 }); }).catch(() => {});
    } else if (action === 'edit') {
      const age = differenceInMinutes(new Date(), new Date(actionTarget.createdAt));
      if (age > 15) { showMessage({ message: 'Can only edit within 15 minutes', type: 'warning' }); return; }
      setEditingMsg(actionTarget); setReplyTo(null);
    } else if (action === 'forward') {
      setForwardMsg(actionTarget); setShowForward(true);
    } else if (action === 'delete') {
      Alert.alert('Delete message', 'Remove this message?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(actionTarget.id) },
      ]);
    }
  }, [actionTarget, deleteMutation]);

  const canEdit = actionTarget?.senderId === user?.id && differenceInMinutes(new Date(), new Date(actionTarget?.createdAt ?? 0)) <= 15;
  const isOwn   = actionTarget?.senderId === user?.id;
  const otherName = otherUser ? `${otherUser.firstName} ${otherUser.lastName}`.trim() : 'Chat';

  const renderItem = useCallback(({ item }: { item: Item }) => {
    if ('_sep' in item) return <DateSep iso={item._sep} />;
    const msg = item as Message;
    return <Bubble msg={msg} isMe={msg.senderId === user?.id} onLongPress={() => setActionTarget(msg)} />;
  }, [user?.id]);

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}
          hitSlop={{ top:10, bottom:10, left:10, right:10 }}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={s.headerAv}>
          <View style={s.avCircle}>
            <Text style={s.avText}>{otherUser ? ini(otherUser.firstName, otherUser.lastName) : '?'}</Text>
          </View>
          <View style={s.onlineDot} />
        </View>
        <View style={s.headerCenter}>
          <Text style={s.headerName} numberOfLines={1}>{otherName}</Text>
          <Text style={{ fontSize: 11, marginTop: 1, color: '#a7f3d0' }}>{isTyping ? 'typing…' : 'online'}</Text>
        </View>
        <View style={s.headerActions}>
          <TouchableOpacity style={s.headerBtn} onPress={() => { setShowSearch(v => !v); setSearchQuery(''); setSearchResults([]); }}><Ionicons name="search-outline" size={20} color="#fff" /></TouchableOpacity>
          <TouchableOpacity style={s.headerBtn}><Ionicons name="call-outline" size={20} color="#fff" /></TouchableOpacity>
          <TouchableOpacity style={s.headerBtn}><Ionicons name="videocam-outline" size={20} color="#fff" /></TouchableOpacity>
          <TouchableOpacity style={s.headerBtn} onPress={() => router.push(`/profile/${otherUserId}` as any)}>
            <Ionicons name="ellipsis-vertical" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* In-conversation search bar */}
      {showSearch && (
        <View style={{ backgroundColor: WA_DARK, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="search-outline" size={16} color="#a7f3d0" />
          <TextInput
            autoFocus
            value={searchQuery}
            onChangeText={handleSearch}
            placeholder="Search in conversation…"
            placeholderTextColor="#a7f3d0"
            style={{ flex: 1, color: '#fff', fontSize: 14 }}
          />
          {searchLoading && <ActivityIndicator size="small" color="#a7f3d0" />}
          {searchQuery.length > 0 && !searchLoading && (
            <Text style={{ color: '#a7f3d0', fontSize: 11 }}>{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</Text>
          )}
          <TouchableOpacity onPress={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={18} color="#a7f3d0" />
          </TouchableOpacity>
        </View>
      )}

      {/* Search results overlay */}
      {showSearch && searchResults.length > 0 && (
        <View style={{ backgroundColor: '#fff', maxHeight: 200, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
          <FlatList
            data={searchResults}
            keyExtractor={m => m.id}
            renderItem={({ item }) => (
              <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f9fafb' }}>
                <Text style={{ fontSize: 11, color: '#9ca3af', marginBottom: 2 }}>
                  {format(new Date(item.createdAt), 'MMM d, h:mm a')}
                </Text>
                <Text style={{ fontSize: 14, color: '#111827' }} numberOfLines={2}>{item.body}</Text>
              </View>
            )}
          />
        </View>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        {isLoading || !convId ? (
          <View style={s.center}>
            <ActivityIndicator color={WA_DARK} />
            <Text style={s.loadingText}>{!convId ? 'Opening conversation…' : 'Loading messages…'}</Text>
          </View>
        ) : (
          <FlatList ref={flatRef} data={listItems}
            keyExtractor={(item, i) => ('_sep' in item ? `sep-${i}` : (item as Message).id)}
            renderItem={renderItem}
            contentContainerStyle={s.msgList}
            onEndReached={() => { if (hasNextPage) fetchNextPage(); }}
            onEndReachedThreshold={0.2}
            onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
            style={{ backgroundColor: WA_BG }}
            ListEmptyComponent={
              <View style={s.emptyWrap}>
                <Ionicons name="chatbubbles-outline" size={48} color="#b2dfdb" />
                <Text style={s.emptyText}>Say hello to {otherName} 👋</Text>
              </View>
            }
          />
        )}

        {isTyping && otherUser && <TypingDots name={otherUser.firstName} />}

        {/* DmInputBar — Phase 4: all media types + voice */}
        <DmInputBar
          convId={convId}
          replyTo={replyTo}
          editingMsg={editingMsg}
          onSendText={async (body, replyToId) => {
            if (editingMsg) {
              await editMutation.mutateAsync({ msgId: editingMsg.id, body });
              setEditingMsg(null);
            } else {
              setSending(true);
              getSocket()?.emit('dm:typing_stop', { convId, receiverId: otherUser?.id });
              try {
                await dmApi.send(convId!, { body, replyToId });
                qc.invalidateQueries({ queryKey: ['dm-messages', convId] });
                qc.invalidateQueries({ queryKey: ['dm-conversations'] });
                setReplyTo(null);
                setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
              } catch (e: any) { showMessage({ message: e?.response?.data?.message ?? 'Failed to send', type: 'danger' }); }
              finally { setSending(false); }
            }
          }}
          onSendMedia={async (payload) => {
            if (!convId) return;
            try {
              const r = await dmApi.send(convId, payload);
              const msg = r.data.data;
              // Add to cache immediately — no refetch flash
              qc.setQueryData(['dm-messages', convId], (old: any) => {
                if (!old) return old;
                const normalized = {
                  ...msg,
                  createdAt: typeof msg.createdAt === 'string' ? msg.createdAt : new Date(msg.createdAt).toISOString(),
                  reactions: msg.reactions ?? [],
                };
                return { ...old, pages: old.pages.map((pg: any[], i: number) =>
                  i === old.pages.length - 1 ? [...pg, normalized] : pg
                )};
              });
              qc.invalidateQueries({ queryKey: ['dm-conversations'] });
              setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
            } catch (e: any) { showMessage({ message: e?.message ?? 'Failed to send', type: 'danger' }); }
          }}
          onTyping={handleTyping}
          onClearReply={() => setReplyTo(null)}
          onCancelEdit={() => setEditingMsg(null)}
          sending={sending}
        />
      </KeyboardAvoidingView>

      {/* Action sheet */}
      <Modal visible={!!actionTarget} transparent animationType="fade" onRequestClose={() => setActionTarget(null)}>
        <Pressable style={s.overlay} onPress={() => setActionTarget(null)}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>React</Text>
            <View style={s.emojiRow}>
              {QUICK_REACT.map(e => (
                <TouchableOpacity key={e} style={s.emojiBtn}
                  onPress={() => { if (actionTarget) reactMutation.mutate({ msgId: actionTarget.id, emoji: e }); setActionTarget(null); }}>
                  <Text style={s.emojiText}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.sheetDivider} />
            <TouchableOpacity style={s.sheetRow} onPress={() => handleAction('reply')}>
              <Ionicons name="return-down-forward-outline" size={18} color="#4f46e5" />
              <Text style={s.sheetRowText}>Reply</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.sheetRow} onPress={() => handleAction('copy')}>
              <Ionicons name="copy-outline" size={18} color="#374151" />
              <Text style={s.sheetRowText}>Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.sheetRow} onPress={() => handleAction('forward')}>
              <Ionicons name="arrow-redo-outline" size={18} color="#374151" />
              <Text style={s.sheetRowText}>Forward</Text>
            </TouchableOpacity>
            {canEdit && (
              <TouchableOpacity style={s.sheetRow} onPress={() => handleAction('edit')}>
                <Ionicons name="pencil-outline" size={18} color="#4f46e5" />
                <Text style={s.sheetRowText}>Edit</Text>
              </TouchableOpacity>
            )}
            {isOwn && (
              <TouchableOpacity style={s.sheetRow} onPress={() => handleAction('delete')}>
                <Ionicons name="trash-outline" size={18} color="#ef4444" />
                <Text style={[s.sheetRowText, { color: '#ef4444' }]}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        </Pressable>
      </Modal>

      {/* ── MobileShareSheet — DM, Group, Feed, Community ── */}
      <MobileShareSheet
        visible={showForward}
        payload={forwardMsg ? {
          body:     forwardMsg.body,
          msgType:  forwardMsg.msgType ?? 'TEXT',
          mediaUrl: forwardMsg.mediaUrl,
          mimeType: forwardMsg.mimeType,
          fileSize: forwardMsg.fileSize,
          fileName: forwardMsg.fileName,
          duration: forwardMsg.duration,
        } : null}
        onClose={() => { setShowForward(false); setForwardMsg(null); }}
      />

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: WA_BG },
  header:          { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: WA_DARK },
  backBtn:         { padding: 4 },
  headerAv:        { position: 'relative' },
  avCircle:        { width: 38, height: 38, borderRadius: 19, backgroundColor: '#4db6ac', alignItems: 'center', justifyContent: 'center' },
  avText:          { fontSize: 14, fontWeight: '700', color: '#fff' },
  onlineDot:       { position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: WA_GREEN, borderWidth: 2, borderColor: WA_DARK },
  headerCenter:    { flex: 1 },
  headerName:      { fontSize: 15, fontWeight: '700', color: '#fff' },
  headerActions:   { flexDirection: 'row', gap: 4 },
  headerBtn:       { padding: 6 },
  msgList:         { padding: 10, gap: 2, paddingBottom: 16 },
  msgRow:          { flexDirection: 'row', marginVertical: 1 },
  msgRowMe:        { justifyContent: 'flex-end' },
  bubble:          { maxWidth: '75%', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMe:        { backgroundColor: WA_SENT, borderTopRightRadius: 3 },
  bubbleThem:      { backgroundColor: '#fff', borderTopLeftRadius: 3, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 2, elevation: 1 },
  metaRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 3, gap: 2 },
  editedLabel:     { fontSize: 9, color: '#9ca3af', fontStyle: 'italic' },
  timeText:        { fontSize: 10, color: '#9ca3af' },
  replyBox:        { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 8, padding: 6, marginBottom: 3, gap: 6, maxWidth: '75%' },
  replyBoxMe:      { backgroundColor: 'rgba(0,0,0,0.08)' },
  replyBar:        { width: 3, borderRadius: 2 },
  replyName:       { fontSize: 10, fontWeight: '700' },
  replyBody:       { fontSize: 11, color: '#6b7280' },
  reactRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginTop: 2 },
  reactPill:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#e5e7eb', gap: 2 },
  reactEmoji:      { fontSize: 12 },
  reactCount:      { fontSize: 10, fontWeight: '700', color: '#6b7280' },
  typingRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 4 },
  typingBubble:    { backgroundColor: '#fff', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, borderTopLeftRadius: 3 },
  typingDotsWrap:  { flexDirection: 'row', gap: 3, alignItems: 'center' },
  typingDot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: '#9ca3af' },
  typingName:      { fontSize: 11, color: '#9ca3af', fontStyle: 'italic' },
  dateSep:         { alignItems: 'center', marginVertical: 8 },
  dateText:        { fontSize: 11, color: '#8e8e8e', backgroundColor: 'rgba(255,255,255,0.7)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  emptyWrap:       { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText:       { color: '#9ca3af', fontSize: 14 },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  loadingText:     { color: '#9ca3af', fontSize: 13 },
  overlay:         { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:           { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  sheetTitle:      { fontSize: 13, fontWeight: '600', color: '#374151', textAlign: 'center', marginBottom: 12 },
  emojiRow:        { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 },
  emojiBtn:        { padding: 8 },
  emojiText:       { fontSize: 28 },
  sheetDivider:    { height: 1, backgroundColor: '#f3f4f6', marginVertical: 8 },
  sheetRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#f9fafb' },
  sheetRowText:    { fontSize: 15, color: '#111827', fontWeight: '500' },
});
