/**
 * HALQA Mobile — Inbox Messages
 * Email-style inbox + sent, compose, reply, delete.
 * Separate from real-time DM chat (/dm).
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Modal, KeyboardAvoidingView,
  Platform, Alert, ScrollView,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { showMessage } from 'react-native-flash-message';
import { formatDistanceToNow, format, isToday, isYesterday } from 'date-fns';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { getSocket } from '@/lib/socket';
import { avatarUrl } from '@/lib/avatar';

type Tab = 'inbox' | 'sent';

function fmtTime(iso: string) {
  try {
    const d = new Date(iso);
    if (isToday(d)) return format(d, 'h:mm a');
    if (isYesterday(d)) return 'Yesterday';
    return format(d, 'MMM d');
  } catch { return ''; }
}

function initials(first?: string, last?: string) {
  return `${first?.charAt(0) ?? ''}${last?.charAt(0) ?? ''}`.toUpperCase();
}

// ─── Message Row ──────────────────────────────────────────────────────────────
function MsgRow({ item, tab, onPress }: { item: any; tab: Tab; onPress: () => void }) {
  const isInbox = tab === 'inbox';
  const person = isInbox ? item.message?.sender : item.recipients?.[0]?.recipient;
  const isUnread = isInbox && item.status === 'SENT';
  const src = avatarUrl(person?.avatarUrl, `${person?.firstName ?? ''} ${person?.lastName ?? ''}`);
  return (
    <TouchableOpacity style={[m.row, isUnread && m.rowUnread]} onPress={onPress} activeOpacity={0.8}>
      <View style={m.avWrap}>
        <Text style={m.avTxt}>{initials(person?.firstName, person?.lastName)}</Text>
        {isUnread && <View style={m.unreadDot} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={m.rowTop}>
          <Text style={[m.sender, isUnread && m.senderBold]} numberOfLines={1}>
            {person?.firstName} {person?.lastName}
          </Text>
          <Text style={m.time}>{fmtTime(item.message?.createdAt ?? item.createdAt)}</Text>
        </View>
        {item.message?.subject ? (
          <Text style={[m.subject, isUnread && m.subjectBold]} numberOfLines={1}>{item.message.subject}</Text>
        ) : null}
        <Text style={m.preview} numberOfLines={1}>
          {item.message?.body?.substring(0, 60) ?? 'No content'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Message Detail Modal ─────────────────────────────────────────────────────
function MsgDetailModal({ item, visible, tab, userId, onClose, onDeleted }: {
  item: any; visible: boolean; tab: Tab; userId?: string;
  onClose: () => void; onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const msgId = item?.message?.id ?? item?.id;

  const { data: detail } = useQuery({
    queryKey: ['message-detail', msgId],
    queryFn: () => api.get(`/messages/${msgId}`).then(r => r.data.data),
    enabled: !!msgId && visible,
  });

  const delMutation = useMutation({
    mutationFn: () => api.delete(`/messages/${item?.id}`),
    onSuccess: () => { showMessage({ message: 'Message deleted', type: 'info' }); onDeleted(); },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }),
  });

  const handleReply = async () => {
    const senderId = detail?.sender?.id;
    if (!senderId || senderId === userId || !reply.trim()) return;
    setReplying(true);
    try {
      await api.post('/messages', {
        recipientIds: [senderId],
        subject: `Re: ${detail?.subject ?? ''}`,
        body: reply.trim(),
      });
      showMessage({ message: 'Reply sent', type: 'success' });
      setReply('');
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' });
    } finally { setReplying(false); }
  };

  if (!item) return null;

  const sender = detail?.sender;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={m.detailContainer} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={m.detailHeader}>
          <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
            <Ionicons name="arrow-back" size={22} color="#4f46e5" />
          </TouchableOpacity>
          <Text style={m.detailHeaderTitle} numberOfLines={1}>
            {detail?.subject ?? 'Message'}
          </Text>
          <TouchableOpacity
            style={{ padding: 4 }}
            onPress={() => Alert.alert('Delete', 'Delete this message?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => delMutation.mutate() },
            ])}
          >
            <Ionicons name="trash-outline" size={20} color="#ef4444" />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={m.detailScroll}>
            {/* Sender info */}
            <View style={m.detailSender}>
              <View style={m.avWrapLg}>
                <Text style={m.avTxtLg}>{initials(sender?.firstName, sender?.lastName)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={m.detailSenderName}>{sender?.firstName} {sender?.lastName}</Text>
                {detail?.createdAt && (
                  <Text style={m.detailSenderTime}>{format(new Date(detail.createdAt), 'MMM d, yyyy · h:mm a')}</Text>
                )}
              </View>
              {/* Read status */}
              <View style={m.readBadge}>
                <Ionicons
                  name={detail?.recipients?.every((r: any) => r.status === 'READ') ? 'checkmark-done' : 'checkmark'}
                  size={14}
                  color={detail?.recipients?.every((r: any) => r.status === 'READ') ? '#4f46e5' : '#9ca3af'}
                />
              </View>
            </View>

            {/* Body */}
            <Text style={m.detailBody}>{detail?.body ?? ''}</Text>
          </ScrollView>

          {/* Reply — only for inbox messages */}
          {tab === 'inbox' && detail?.sender?.id !== userId && (
            <View style={m.replyBar}>
              <TextInput
                style={m.replyInput}
                value={reply}
                onChangeText={setReply}
                placeholder="Write a reply…"
                placeholderTextColor="#9ca3af"
                multiline
                allowFontScaling={false}
              />
              <TouchableOpacity
                style={[m.replyBtn, (!reply.trim() || replying) && m.replyBtnDisabled]}
                onPress={handleReply}
                disabled={!reply.trim() || replying}
              >
                {replying
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="send" size={16} color="#fff" />}
              </TouchableOpacity>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Compose Modal ────────────────────────────────────────────────────────────
function ComposeModal({ visible, userId, onClose, onSent }: {
  visible: boolean; userId?: string; onClose: () => void; onSent: () => void;
}) {
  const [recipientSearch, setRecipientSearch] = useState('');
  const [recipients, setRecipients] = useState<any[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const { data: searchResults = [] } = useQuery<any[]>({
    queryKey: ['users-search', recipientSearch],
    queryFn: () => api.get('/users', { params: { search: recipientSearch, limit: 8 } }).then(r => r.data.data ?? []),
    enabled: recipientSearch.length >= 2,
  });

  const addRecipient = (u: any) => {
    if (!recipients.find(r => r.id === u.id) && u.id !== userId) {
      setRecipients(p => [...p, u]);
    }
    setRecipientSearch('');
  };

  const handleSend = async () => {
    if (recipients.length === 0 || !body.trim()) return;
    setSending(true);
    try {
      await api.post('/messages', {
        recipientIds: recipients.map(r => r.id),
        subject: subject.trim(),
        body: body.trim(),
      });
      showMessage({ message: 'Message sent!', type: 'success' });
      setRecipients([]); setSubject(''); setBody(''); setRecipientSearch('');
      onSent();
    } catch (e: any) {
      showMessage({ message: e?.response?.data?.message ?? 'Failed to send', type: 'danger' });
    } finally { setSending(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={m.composeContainer} edges={['top', 'bottom']}>
        <View style={m.composeHeader}>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color="#6b7280" /></TouchableOpacity>
          <Text style={m.composeTitle}>New Message</Text>
          <TouchableOpacity
            style={[m.sendBtn, (recipients.length === 0 || !body.trim() || sending) && m.sendBtnDisabled]}
            onPress={handleSend}
            disabled={recipients.length === 0 || !body.trim() || sending}
          >
            {sending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={m.sendBtnTxt}>Send</Text>}
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 12 }}>
            {/* To field */}
            <View style={m.composeField}>
              <Text style={m.composeLabel}>To</Text>
              <View style={m.recipientRow}>
                {recipients.map(r => (
                  <View key={r.id} style={m.recipientChip}>
                    <Text style={m.recipientChipTxt}>{r.firstName}</Text>
                    <TouchableOpacity onPress={() => setRecipients(p => p.filter(x => x.id !== r.id))}>
                      <Ionicons name="close-circle" size={14} color="#4f46e5" />
                    </TouchableOpacity>
                  </View>
                ))}
                <TextInput
                  style={m.recipientInput}
                  value={recipientSearch}
                  onChangeText={setRecipientSearch}
                  placeholder="Search by name…"
                  placeholderTextColor="#9ca3af"
                  allowFontScaling={false}
                />
              </View>
              {searchResults.length > 0 && recipientSearch.length >= 2 && (
                <View style={m.searchDropdown}>
                  {searchResults.filter(u => u.id !== userId && !recipients.find(r => r.id === u.id)).map(u => (
                    <TouchableOpacity key={u.id} style={m.searchResultRow} onPress={() => addRecipient(u)}>
                      <View style={m.avWrapSm}><Text style={m.avTxtSm}>{initials(u.firstName, u.lastName)}</Text></View>
                      <View style={{ flex: 1 }}>
                        <Text style={m.searchResultName}>{u.firstName} {u.lastName}</Text>
                        <Text style={m.searchResultRole}>{(u.role ?? '').replace(/_/g, ' ').toLowerCase()}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
            <View style={m.composeField}>
              <Text style={m.composeLabel}>Subject</Text>
              <TextInput style={m.composeInput} value={subject} onChangeText={setSubject} placeholder="Optional subject…" placeholderTextColor="#9ca3af" allowFontScaling={false} />
            </View>
            <View style={m.composeField}>
              <Text style={m.composeLabel}>Message *</Text>
              <TextInput style={[m.composeInput, { height: 140, textAlignVertical: 'top', paddingTop: 10 }]} value={body} onChangeText={setBody} placeholder="Write your message…" placeholderTextColor="#9ca3af" multiline allowFontScaling={false} maxLength={5000} />
              <Text style={{ fontSize: 11, color: '#94a3b8', textAlign: 'right', marginTop: 4 }}>{body.length}/5000</Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function MessagesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [tab, setTab]               = useState<Tab>('inbox');
  const [search, setSearch]         = useState('');
  const [selectedItem, setSelected] = useState<any>(null);
  const [showCompose, setCompose]   = useState(false);

  // Real-time new message via socket
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onNew = () => queryClient.invalidateQueries({ queryKey: ['messages'] });
    socket.on('message:new', onNew);
    return () => { socket.off('message:new', onNew); };
  }, [queryClient]);

  const { data: inbox = [], isLoading: inboxLoading } = useQuery<any[]>({
    queryKey: ['messages', 'inbox'],
    queryFn: () => api.get('/messages/inbox').then(r => r.data.data ?? []),
    refetchInterval: 30_000,
  });

  const { data: sent = [], isLoading: sentLoading } = useQuery<any[]>({
    queryKey: ['messages', 'sent'],
    queryFn: () => api.get('/messages/sent').then(r => r.data.data ?? []),
    enabled: tab === 'sent',
  });

  // Mark as read when opening
  useEffect(() => {
    if (!selectedItem) return;
    if (selectedItem.status === 'SENT' && tab === 'inbox') {
      api.put(`/messages/${selectedItem.id}/read`).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['messages', 'inbox'] });
    }
  }, [selectedItem, tab, queryClient]);

  const raw     = tab === 'inbox' ? inbox : sent;
  const loading = tab === 'inbox' ? inboxLoading : sentLoading;
  const unread  = inbox.filter(i => i.status === 'SENT').length;

  const filtered = search.trim()
    ? raw.filter(i => {
        const q = search.toLowerCase();
        const p = tab === 'inbox' ? i.message?.sender : i.recipients?.[0]?.recipient;
        return (
          `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.toLowerCase().includes(q) ||
          (i.message?.subject ?? '').toLowerCase().includes(q) ||
          (i.message?.body ?? '').toLowerCase().includes(q)
        );
      })
    : raw;

  return (
    <>
      <Stack.Screen options={{
        headerShown: true, title: 'Messages',
        headerTintColor: '#4f46e5',
        headerStyle: { backgroundColor: '#fff' },
        headerTitleStyle: { color: '#111827', fontWeight: '800' },
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
            <Ionicons name="arrow-back" size={22} color="#4f46e5" />
          </TouchableOpacity>
        ),
        headerRight: () => (
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#ede9fe', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginRight: 4 }}
            onPress={() => setCompose(true)}
          >
            <Ionicons name="create-outline" size={15} color="#4f46e5" />
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#4f46e5' }}>Compose</Text>
          </TouchableOpacity>
        ),
      }} />
      <SafeAreaView style={m.container} edges={['bottom']}>
        {/* Tabs */}
        <View style={m.tabBar}>
          {(['inbox', 'sent'] as Tab[]).map(t => (
            <TouchableOpacity key={t} style={[m.tabBtn, tab === t && m.tabBtnActive]} onPress={() => setTab(t)}>
              <Text style={[m.tabTxt, tab === t && m.tabTxtActive]}>
                {t === 'inbox' ? `📥 Inbox${unread > 0 ? ` (${unread})` : ''}` : '📤 Sent'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Search */}
        <View style={m.searchRow}>
          <Ionicons name="search-outline" size={15} color="#9ca3af" />
          <TextInput
            value={search} onChangeText={setSearch}
            placeholder="Search messages…" placeholderTextColor="#9ca3af"
            style={m.searchInput} allowFontScaling={false}
          />
          {search ? <TouchableOpacity onPress={() => setSearch('')}><Ionicons name="close-circle" size={15} color="#9ca3af" /></TouchableOpacity> : null}
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#4f46e5" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={i => i.id}
            contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
            onRefresh={() => queryClient.invalidateQueries({ queryKey: ['messages'] })}
            refreshing={false}
            renderItem={({ item }) => (
              <MsgRow item={item} tab={tab} onPress={() => setSelected(item)} />
            )}
            ListEmptyComponent={
              <View style={m.empty}>
                <Ionicons name="mail-outline" size={48} color="#d1d5db" />
                <Text style={m.emptyTxt}>
                  {search ? 'No matching messages' : tab === 'inbox' ? 'No messages yet' : 'No sent messages'}
                </Text>
              </View>
            }
          />
        )}

        {/* Detail modal */}
        {selectedItem && (
          <MsgDetailModal
            item={selectedItem}
            visible={!!selectedItem}
            tab={tab}
            userId={user?.id}
            onClose={() => setSelected(null)}
            onDeleted={() => {
              setSelected(null);
              queryClient.invalidateQueries({ queryKey: ['messages'] });
            }}
          />
        )}

        {/* Compose modal */}
        <ComposeModal
          visible={showCompose}
          userId={user?.id}
          onClose={() => setCompose(false)}
          onSent={() => {
            setCompose(false);
            queryClient.invalidateQueries({ queryKey: ['messages'] });
          }}
        />
      </SafeAreaView>
    </>
  );
}

const m = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#f8fafc' },
  tabBar:           { flexDirection: 'row', backgroundColor: '#f1f5f9', margin: 12, borderRadius: 14, padding: 3 },
  tabBtn:           { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 11 },
  tabBtnActive:     { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  tabTxt:           { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  tabTxtActive:     { color: '#1e293b', fontWeight: '700' },
  searchRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginBottom: 8, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 9 },
  searchInput:      { flex: 1, fontSize: 14, color: '#1e293b' },

  // Message row
  row:              { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  rowUnread:        { backgroundColor: '#fafafe' },
  avWrap:           { width: 44, height: 44, borderRadius: 22, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center', flexShrink: 0, position: 'relative' },
  avTxt:            { fontSize: 15, fontWeight: '800', color: '#4f46e5' },
  unreadDot:        { position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: '#4f46e5', borderWidth: 2, borderColor: '#fff' },
  rowTop:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  sender:           { fontSize: 14, fontWeight: '500', color: '#374151', flex: 1 },
  senderBold:       { fontWeight: '700', color: '#1e293b' },
  time:             { fontSize: 11, color: '#9ca3af', flexShrink: 0 },
  subject:          { fontSize: 13, color: '#6b7280', marginTop: 2 },
  subjectBold:      { fontWeight: '600', color: '#1e293b' },
  preview:          { fontSize: 12, color: '#94a3b8', marginTop: 2 },

  // Empty
  empty:            { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTxt:         { fontSize: 15, color: '#94a3b8', marginTop: 12 },

  // Detail modal
  detailContainer:  { flex: 1, backgroundColor: '#f8fafc' },
  detailHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  detailHeaderTitle:{ flex: 1, fontSize: 16, fontWeight: '700', color: '#1e293b', textAlign: 'center', marginHorizontal: 8 },
  detailScroll:     { padding: 16, gap: 12 },
  detailSender:     { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#f1f5f9' },
  avWrapLg:         { width: 48, height: 48, borderRadius: 24, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  avTxtLg:          { fontSize: 17, fontWeight: '800', color: '#4f46e5' },
  detailSenderName: { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  detailSenderTime: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  readBadge:        { width: 28, height: 28, borderRadius: 14, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center' },
  detailBody:       { fontSize: 15, color: '#374151', lineHeight: 24, backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#f1f5f9' },
  replyBar:         { flexDirection: 'row', gap: 8, padding: 10, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  replyInput:       { flex: 1, backgroundColor: '#f8fafc', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: '#1e293b', maxHeight: 80 },
  replyBtn:         { width: 40, height: 40, borderRadius: 20, backgroundColor: '#4f46e5', justifyContent: 'center', alignItems: 'center' },
  replyBtnDisabled: { backgroundColor: '#c7d2fe' },

  // Compose modal
  composeContainer: { flex: 1, backgroundColor: '#fff' },
  composeHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  composeTitle:     { fontSize: 17, fontWeight: '800', color: '#1e293b' },
  sendBtn:          { backgroundColor: '#4f46e5', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  sendBtnDisabled:  { backgroundColor: '#c7d2fe' },
  sendBtnTxt:       { color: '#fff', fontWeight: '700', fontSize: 13 },
  composeField:     { gap: 4 },
  composeLabel:     { fontSize: 12, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 },
  composeInput:     { backgroundColor: '#f8fafc', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: '#1e293b' },
  recipientRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, backgroundColor: '#f8fafc', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', padding: 10, minHeight: 44 },
  recipientChip:    { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#ede9fe', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  recipientChipTxt: { fontSize: 12, fontWeight: '700', color: '#4f46e5' },
  recipientInput:   { flex: 1, fontSize: 14, color: '#1e293b', minWidth: 100 },
  searchDropdown:   { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', marginTop: 4, overflow: 'hidden' },
  searchResultRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  avWrapSm:         { width: 32, height: 32, borderRadius: 16, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  avTxtSm:          { fontSize: 12, fontWeight: '800', color: '#4f46e5' },
  searchResultName: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  searchResultRole: { fontSize: 11, color: '#94a3b8', textTransform: 'capitalize', marginTop: 1 },
});
