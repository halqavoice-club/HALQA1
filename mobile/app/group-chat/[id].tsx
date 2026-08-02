/**
 * HALQA Mobile — Group Chat Thread
 * Route: /group-chat/[id]
 * Telegram-style: bubbles, reply, emoji reactions, member count, typing
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Modal, Pressable,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useInfiniteQuery, useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, isToday, isYesterday } from 'date-fns';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';

interface GcUser  { id: string; firstName: string; lastName: string; avatarUrl: string | null }
interface GcReply { id: string; body: string | null; sender: GcUser }
interface GcReact { id: string; type: string; userId: string; user: GcUser }
interface GcMsg {
  id: string; conversationId: string; senderId: string; sender: GcUser;
  type: string; body: string | null; replyToId: string | null; replyTo: GcReply | null;
  reactions: GcReact[]; deletedAt: string | null; createdAt: string;
}
interface GcMember { userId: string; role: string; user: GcUser }
interface GcConv {
  id: string; name: string; description: string | null; privacy: string;
  memberCount: number; members: GcMember[]; createdBy: string;
}

const QUICK_EMOJI = ['👍','❤️','😂','😮','😢','🙏'];

function fmtTime(iso: string) {
  const d = new Date(iso);
  if (isToday(d))     return format(d, 'h:mm a');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM d');
}

function initials(u: GcUser) {
  return `${u.firstName[0] ?? ''}${u.lastName[0] ?? ''}`.toUpperCase();
}

// ─── Reaction pills ────────────────────────────────────────────────────────────
function Reactions({ reactions, myId, onToggle }: {
  reactions: GcReact[]; myId: string; onToggle: (type: string) => void;
}) {
  if (!reactions.length) return null;
  const grouped = reactions.reduce<Record<string,number>>((a,r) => { a[r.type]=(a[r.type]??0)+1; return a; }, {});
  return (
    <View style={styles.reactRow}>
      {Object.entries(grouped).map(([type, count]) => {
        const mine = reactions.some(r => r.type === type && r.userId === myId);
        return (
          <TouchableOpacity key={type} onPress={() => onToggle(type)}
            style={[styles.reactPill, mine && styles.reactPillMine]}>
            <Text style={styles.reactEmoji}>{type}</Text>
            <Text style={[styles.reactCount, mine && { color: '#4f46e5' }]}>{count}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Message bubble ─────────────────────────────────────────────────────────
function Bubble({ msg, isMe, showSender, myId, onLongPress, onReact }: {
  msg: GcMsg; isMe: boolean; showSender: boolean;
  myId: string; onLongPress: () => void; onReact: (type: string) => void;
}) {
  return (
    <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
      {/* Avatar (others) */}
      {!isMe && (
        <View style={styles.senderAvatar}>
          {showSender ? (
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{initials(msg.sender)}</Text>
            </View>
          ) : <View style={{ width: 30 }} />}
        </View>
      )}

      <View style={[styles.bubbleCol, isMe && styles.bubbleColMe]}>
        {/* Sender name */}
        {!isMe && showSender && (
          <Text style={styles.senderName}>{msg.sender.firstName} {msg.sender.lastName}</Text>
        )}

        {/* Reply context */}
        {msg.replyTo && (
          <View style={[styles.replyBox, isMe && styles.replyBoxMe]}>
            <View style={styles.replyBar} />
            <View style={{ flex: 1 }}>
              <Text style={styles.replyName}>{msg.replyTo.sender.firstName}</Text>
              <Text style={styles.replyBody} numberOfLines={1}>{msg.replyTo.body ?? '📎 Media'}</Text>
            </View>
          </View>
        )}

        {/* Bubble */}
        <TouchableOpacity activeOpacity={0.85} onLongPress={onLongPress}
          style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
          <Text style={[styles.bubbleText, isMe && { color: '#fff' }]}>{msg.body}</Text>
          <Text style={[styles.bubbleTime, isMe && { color: '#c7d2fe' }]}>
            {fmtTime(msg.createdAt)}
          </Text>
        </TouchableOpacity>

        {/* Reactions */}
        <Reactions reactions={msg.reactions} myId={myId} onToggle={onReact} />
      </View>
    </View>
  );
}

// ─── Date separator ──────────────────────────────────────────────────────────
function DateSep({ iso }: { iso: string }) {
  const d = new Date(iso);
  const label = isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'MMMM d, yyyy');
  return (
    <View style={styles.dateSep}>
      <View style={styles.dateLine} />
      <Text style={styles.dateText}>{label}</Text>
      <View style={styles.dateLine} />
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────
export default function GroupChatThreadScreen() {
  const { id: convId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const flatRef = useRef<FlatList>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<GcMsg | null>(null);
  const [selected, setSelected] = useState<GcMsg | null>(null); // long-press menu
  const [showMembers, setShowMembers] = useState(false);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>();

  // ── Load conversation info ─────────────────────────────────────────────────
  const { data: conv } = useQuery<GcConv>({
    queryKey: ['group-conv', convId],
    queryFn: () => api.get(`/group-chat/conversations/${convId}`).then(r => r.data.data),
    enabled: !!convId,
  });

  // ── Load messages (paginated) ─────────────────────────────────────────────
  const { data, fetchNextPage, hasNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['group-messages', convId],
    queryFn: ({ pageParam }) =>
      api.get(`/group-chat/conversations/${convId}/messages`, {
        params: { before: pageParam, limit: 50 },
      }).then(r => r.data.data ?? []),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: GcMsg[]) => page?.length === 50 ? page[0]?.createdAt : undefined,
    enabled: !!convId,
  });

  const rawMessages: GcMsg[] = (data?.pages.flatMap(p => p) ?? []).slice().reverse();

  // Build date-separated list
  type ListItem = GcMsg | { _sep: string };
  const listItems: ListItem[] = [];
  let lastDate = '';
  for (const msg of rawMessages) {
    const d = msg.createdAt.slice(0, 10);
    if (d !== lastDate) { listItems.push({ _sep: msg.createdAt }); lastDate = d; }
    listItems.push(msg);
  }

  // ── Socket.IO ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !convId) return;
    socket.emit('group:join', convId);

    const onMsg = (msg: GcMsg) => {
      if (msg.conversationId !== convId) return;
      qc.invalidateQueries({ queryKey: ['group-messages', convId] });
      qc.invalidateQueries({ queryKey: ['group-conversations'] });
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    };
    const onReact = () => qc.invalidateQueries({ queryKey: ['group-messages', convId] });
    const onDeleted = (data: { conversationId: string }) => {
      if (data.conversationId === convId) qc.invalidateQueries({ queryKey: ['group-messages', convId] });
    };
    const onTypingStart = ({ userId: tid, name }: any) => {
      if (tid === user?.id) return;
      setTypingNames(prev => prev.includes(name) ? prev : [...prev, name]);
    };
    const onTypingStop = ({ userId: tid, name }: any) => {
      setTypingNames(prev => prev.filter(n => n !== name));
    };

    socket.on('group:message',         onMsg);
    socket.on('group:reaction',        onReact);
    socket.on('group:message_deleted', onDeleted);
    socket.on('group:typing_start',    onTypingStart);
    socket.on('group:typing_stop',     onTypingStop);

    return () => {
      socket.off('group:message',         onMsg);
      socket.off('group:reaction',        onReact);
      socket.off('group:message_deleted', onDeleted);
      socket.off('group:typing_start',    onTypingStart);
      socket.off('group:typing_stop',     onTypingStop);
    };
  }, [convId, user?.id, qc]);

  // ── Mark read on open ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!convId || !rawMessages.length) return;
    const ids = rawMessages.slice(-20).map(m => m.id);
    api.post(`/group-chat/conversations/${convId}/read`, { messageIds: ids }).catch(() => {});
  }, [convId, rawMessages.length]); // eslint-disable-line

  // ── Send ──────────────────────────────────────────────────────────────────
  const sendMutation = useMutation({
    mutationFn: (body: string) =>
      api.post(`/group-chat/conversations/${convId}/messages`, {
        body, replyToId: replyTo?.id,
      }),
    onSuccess: () => {
      setText(''); setReplyTo(null);
      const socket = getSocket();
      if (socket) socket.emit('group:typing_stop', { convId, userId: user?.id, name: user?.firstName });
      qc.invalidateQueries({ queryKey: ['group-messages', convId] });
      qc.invalidateQueries({ queryKey: ['group-conversations'] });
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    },
    onError: () => showMessage({ message: 'Failed to send', type: 'danger' }),
  });

  // ── Typing ────────────────────────────────────────────────────────────────
  const handleTyping = useCallback((t: string) => {
    setText(t);
    const socket = getSocket();
    if (!socket) return;
    if (!typingTimer.current) {
      socket.emit('group:typing_start', { convId, userId: user?.id, name: user?.firstName });
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socket.emit('group:typing_stop', { convId, userId: user?.id, name: user?.firstName });
      typingTimer.current = undefined;
    }, 2500);
  }, [convId, user]);

  // ── React ─────────────────────────────────────────────────────────────────
  const reactMutation = useMutation({
    mutationFn: ({ msgId, type }: { msgId: string; type: string }) =>
      api.post(`/group-chat/messages/${msgId}/reactions`, { type }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['group-messages', convId] }),
  });

  const renderItem = useCallback(({ item, index }: { item: ListItem; index: number }) => {
    if ('_sep' in item) return <DateSep iso={item._sep} />;
    const msg = item as GcMsg;
    const isMe = msg.senderId === user?.id;
    const prev = listItems[index - 1];
    const prevMsg = prev && !('_sep' in prev) ? prev as GcMsg : null;
    const showSender = !prevMsg || prevMsg.senderId !== msg.senderId;
    return (
      <Bubble msg={msg} isMe={isMe} showSender={showSender} myId={user?.id ?? ''}
        onLongPress={() => setSelected(msg)}
        onReact={(type) => reactMutation.mutate({ msgId: msg.id, type })} />
    );
  }, [user?.id, listItems, reactMutation]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top:10, bottom:10, left:10, right:10 }}>
          <Ionicons name="chevron-back" size={24} color="#374151" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>{conv?.name ?? '…'}</Text>
          <Text style={styles.headerSub}>
            {typingNames.length > 0
              ? `${typingNames.join(', ')} typing…`
              : `${conv?.memberCount ?? 0} members`}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setShowMembers(true)} style={styles.membersBtn}>
          <Ionicons name="people-outline" size={22} color="#4f46e5" />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
        {/* Messages */}
        {isLoading ? (
          <View style={styles.center}><ActivityIndicator color="#4f46e5" /></View>
        ) : (
          <FlatList ref={flatRef} data={listItems} keyExtractor={(item, i) => ('_sep' in item ? `sep-${i}` : (item as GcMsg).id)}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 12, gap: 2, paddingBottom: 8 }}
            onEndReached={() => { if (hasNextPage) fetchNextPage(); }}
            onEndReachedThreshold={0.2}
            onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="chatbubbles-outline" size={48} color="#d1d5db" />
                <Text style={styles.emptyText}>No messages yet. Say hello! 👋</Text>
              </View>
            }
          />
        )}

        {/* Typing indicator */}
        {typingNames.length > 0 && (
          <View style={styles.typingWrap}>
            <View style={styles.typingDots}>
              {[0,1,2].map(i => <View key={i} style={styles.typingDot} />)}
            </View>
            <Text style={styles.typingText}>{typingNames.join(', ')} typing…</Text>
          </View>
        )}

        {/* Reply bar */}
        {replyTo && (
          <View style={styles.replyPreview}>
            <Ionicons name="return-down-forward" size={14} color="#4f46e5" />
            <View style={{ flex: 1 }}>
              <Text style={styles.replyPreviewName}>{replyTo.sender.firstName}</Text>
              <Text style={styles.replyPreviewBody} numberOfLines={1}>{replyTo.body}</Text>
            </View>
            <TouchableOpacity onPress={() => setReplyTo(null)}>
              <Ionicons name="close" size={16} color="#9ca3af" />
            </TouchableOpacity>
          </View>
        )}

        {/* Input */}
        <View style={styles.inputRow}>
          <TextInput value={text} onChangeText={handleTyping} placeholder="Message…"
            placeholderTextColor="#9ca3af" style={styles.input}
            multiline maxLength={2000} returnKeyType="default" />
          <TouchableOpacity
            style={[styles.sendBtn, (!text.trim() || sendMutation.isPending) && styles.sendBtnOff]}
            onPress={() => { if (text.trim()) sendMutation.mutate(text.trim()); }}
            disabled={!text.trim() || sendMutation.isPending}>
            {sendMutation.isPending
              ? <ActivityIndicator color="#fff" size="small" />
              : <Ionicons name="send" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Long-press action sheet */}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.overlay} onPress={() => setSelected(null)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>React</Text>
            <View style={styles.emojiRow}>
              {QUICK_EMOJI.map(e => (
                <TouchableOpacity key={e} style={styles.emojiBtn}
                  onPress={() => { if (selected) reactMutation.mutate({ msgId: selected.id, type: e }); setSelected(null); }}>
                  <Text style={styles.emojiText}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.sheetAction} onPress={() => { setReplyTo(selected); setSelected(null); }}>
              <Ionicons name="return-down-forward-outline" size={18} color="#4f46e5" />
              <Text style={styles.sheetActionText}>Reply</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Members modal */}
      <Modal visible={showMembers} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowMembers(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
          <View style={styles.membersHeader}>
            <Text style={styles.membersTitle}>Members ({conv?.memberCount})</Text>
            <TouchableOpacity onPress={() => setShowMembers(false)}><Ionicons name="close" size={24} color="#374151" /></TouchableOpacity>
          </View>
          <FlatList
            data={conv?.members ?? []}
            keyExtractor={m => m.userId}
            renderItem={({ item: m }) => (
              <View style={styles.memberRow}>
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarText}>{initials(m.user)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{m.user.firstName} {m.user.lastName}</Text>
                  <Text style={styles.memberRole}>{m.role.toLowerCase()}</Text>
                </View>
                {m.role === 'OWNER' && <View style={styles.ownerBadge}><Text style={styles.ownerBadgeText}>Owner</Text></View>}
              </View>
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#f9fafb' },
  header:          { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  headerInfo:      { flex: 1 },
  headerName:      { fontSize: 16, fontWeight: '700', color: '#111827' },
  headerSub:       { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  membersBtn:      { padding: 4 },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyWrap:       { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText:       { color: '#9ca3af', fontSize: 14 },
  // Messages
  msgRow:          { flexDirection: 'row', marginVertical: 1, alignItems: 'flex-end', gap: 6 },
  msgRowMe:        { justifyContent: 'flex-end' },
  senderAvatar:    { width: 30, alignItems: 'center', alignSelf: 'flex-end' },
  avatarCircle:    { width: 28, height: 28, borderRadius: 14, backgroundColor: '#ede9fe', alignItems: 'center', justifyContent: 'center' },
  avatarText:      { fontSize: 10, fontWeight: '700', color: '#7c3aed' },
  bubbleCol:       { maxWidth: '75%' },
  bubbleColMe:     { alignItems: 'flex-end' },
  senderName:      { fontSize: 11, fontWeight: '600', color: '#4f46e5', marginBottom: 2, marginLeft: 2 },
  replyBox:        { flexDirection: 'row', backgroundColor: 'rgba(79,70,229,0.08)', borderRadius: 8, padding: 6, marginBottom: 2, gap: 6 },
  replyBoxMe:      { backgroundColor: 'rgba(255,255,255,0.2)' },
  replyBar:        { width: 3, borderRadius: 2, backgroundColor: '#4f46e5', marginRight: 4 },
  replyName:       { fontSize: 10, fontWeight: '700', color: '#4f46e5' },
  replyBody:       { fontSize: 11, color: '#6b7280' },
  bubble:          { borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleMe:        { backgroundColor: '#4f46e5', borderBottomRightRadius: 4 },
  bubbleThem:      { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderBottomLeftRadius: 4 },
  bubbleText:      { fontSize: 15, color: '#111827', lineHeight: 21 },
  bubbleTime:      { fontSize: 10, color: '#9ca3af', marginTop: 3, alignSelf: 'flex-end' },
  reactRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 },
  reactPill:       { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#f3f4f6', borderRadius: 12, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: '#e5e7eb' },
  reactPillMine:   { backgroundColor: '#eef2ff', borderColor: '#a5b4fc' },
  reactEmoji:      { fontSize: 13 },
  reactCount:      { fontSize: 11, fontWeight: '600', color: '#6b7280' },
  // Date sep
  dateSep:         { flexDirection: 'row', alignItems: 'center', marginVertical: 10, gap: 8 },
  dateLine:        { flex: 1, height: 1, backgroundColor: '#e5e7eb' },
  dateText:        { fontSize: 11, color: '#9ca3af', fontWeight: '600' },
  // Typing
  typingWrap:      { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 6 },
  typingDots:      { flexDirection: 'row', gap: 3 },
  typingDot:       { width: 5, height: 5, borderRadius: 3, backgroundColor: '#9ca3af' },
  typingText:      { fontSize: 11, color: '#9ca3af', fontStyle: 'italic' },
  // Reply preview
  replyPreview:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#eef2ff', paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#c7d2fe' },
  replyPreviewName:{ fontSize: 11, fontWeight: '700', color: '#4f46e5' },
  replyPreviewBody:{ fontSize: 12, color: '#6b7280' },
  // Input
  inputRow:        { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  input:           { flex: 1, backgroundColor: '#f9fafb', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: '#111827', maxHeight: 100, borderWidth: 1, borderColor: '#e5e7eb' },
  sendBtn:         { width: 42, height: 42, borderRadius: 21, backgroundColor: '#4f46e5', justifyContent: 'center', alignItems: 'center' },
  sendBtnOff:      { backgroundColor: '#c7d2fe' },
  // Long-press sheet
  overlay:         { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:           { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36, gap: 14 },
  sheetTitle:      { fontSize: 13, fontWeight: '600', color: '#374151', textAlign: 'center' },
  emojiRow:        { flexDirection: 'row', justifyContent: 'space-around' },
  emojiBtn:        { padding: 8 },
  emojiText:       { fontSize: 28 },
  sheetAction:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  sheetActionText: { fontSize: 15, color: '#4f46e5', fontWeight: '600' },
  // Members
  membersHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  membersTitle:    { fontSize: 17, fontWeight: '700', color: '#111827' },
  memberRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  memberAvatar:    { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ede9fe', alignItems: 'center', justifyContent: 'center' },
  memberAvatarText:{ fontSize: 14, fontWeight: '700', color: '#7c3aed' },
  memberName:      { fontSize: 15, fontWeight: '600', color: '#111827' },
  memberRole:      { fontSize: 11, color: '#9ca3af', textTransform: 'capitalize' },
  ownerBadge:      { backgroundColor: '#fef9c3', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  ownerBadgeText:  { fontSize: 10, fontWeight: '700', color: '#a16207' },
});
