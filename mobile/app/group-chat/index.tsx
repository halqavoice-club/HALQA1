/**
 * HALQA Mobile — Group Chat List
 * Route: /group-chat
 * Telegram-style: list all groups, create new, real-time unread badges
 */
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Modal, Pressable, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showMessage } from 'react-native-flash-message';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';

interface GcConversation {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  privacy: string;
  memberCount: number;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unread?: number;
}

function privacyEmoji(p: string) {
  if (p === 'PUBLIC') return '🌐';
  if (p === 'PRIVATE') return '🔒';
  return '#';
}

function GroupRow({ item, onPress }: { item: GcConversation; onPress: () => void }) {
  const initials = item.name.split(' ').map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2);
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatarWrap}>
        <Text style={styles.avatarText}>{initials}</Text>
        {(item.unread ?? 0) > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{(item.unread ?? 0) > 99 ? '99+' : item.unread}</Text>
          </View>
        )}
      </View>
      <View style={styles.rowInfo}>
        <View style={styles.rowTop}>
          <Text style={styles.rowName} numberOfLines={1}>
            {privacyEmoji(item.privacy)} {item.name}
          </Text>
          {item.lastMessageAt && (
            <Text style={styles.rowTime}>
              {formatDistanceToNow(new Date(item.lastMessageAt), { addSuffix: false })}
            </Text>
          )}
        </View>
        <Text style={styles.rowSub} numberOfLines={1}>
          {item.memberCount} members{item.lastMessage ? ` · ${item.lastMessage}` : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function GroupChatListScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [privacy, setPrivacy] = useState<'PRIVATE' | 'PUBLIC'>('PRIVATE');
  const [unreads, setUnreads] = useState<Record<string, number>>({});

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['group-conversations'],
    queryFn: () => api.get('/group-chat/conversations').then(r => r.data.data ?? []),
    staleTime: 30000,
  });

  const conversations: GcConversation[] = (data ?? []).map((c: GcConversation) => ({
    ...c,
    unread: unreads[c.id] ?? 0,
  }));

  const filtered = search
    ? conversations.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    : conversations;

  // Real-time: increment unread on incoming message
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    // Join all conversation rooms
    conversations.forEach(c => socket.emit('group:join', c.id));

    const onMsg = (msg: any) => {
      if (msg.senderId === user?.id) return;
      setUnreads(prev => ({ ...prev, [msg.conversationId]: (prev[msg.conversationId] ?? 0) + 1 }));
      qc.invalidateQueries({ queryKey: ['group-conversations'] });
    };
    socket.on('group:message', onMsg);
    return () => { socket.off('group:message', onMsg); };
  }, [conversations.length, user?.id]); // eslint-disable-line

  const createMutation = useMutation({
    mutationFn: () => api.post('/group-chat/conversations', {
      name: newName.trim(), description: newDesc.trim() || undefined, privacy,
    }),
    onSuccess: (r) => {
      setShowCreate(false);
      setNewName(''); setNewDesc(''); setPrivacy('PRIVATE');
      qc.invalidateQueries({ queryKey: ['group-conversations'] });
      router.push(`/group-chat/${r.data.data.id}` as any);
    },
    onError: () => showMessage({ message: 'Failed to create group', type: 'danger' }),
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color="#374151" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Groups</Text>
        <TouchableOpacity onPress={() => setShowCreate(true)} style={styles.newBtn}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color="#9ca3af" style={{ marginRight: 8 }} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search groups…"
          placeholderTextColor="#9ca3af" style={styles.searchInput} />
        {search ? <TouchableOpacity onPress={() => setSearch('')}><Ionicons name="close-circle" size={16} color="#9ca3af" /></TouchableOpacity> : null}
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color="#4f46e5" /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={c => c.id}
          renderItem={({ item }) => (
            <GroupRow item={item} onPress={() => {
              setUnreads(prev => ({ ...prev, [item.id]: 0 }));
              router.push(`/group-chat/${item.id}` as any);
            }} />
          )}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor="#4f46e5" />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="people-outline" size={48} color="#d1d5db" />
              <Text style={styles.emptyTitle}>{search ? 'No groups found' : 'No groups yet'}</Text>
              {!search && (
                <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowCreate(true)}>
                  <Text style={styles.emptyBtnText}>Create your first group</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          contentContainerStyle={filtered.length === 0 && { flex: 1 }}
        />
      )}

      {/* Create modal */}
      <Modal visible={showCreate} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowCreate(false)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowCreate(false)}>
              <Ionicons name="close" size={24} color="#374151" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New Group</Text>
            <View style={{ width: 24 }} />
          </View>

          <View style={styles.modalBody}>
            <View style={styles.modalAvatar}>
              <Ionicons name="people" size={32} color="#8b5cf6" />
            </View>
            <TextInput value={newName} onChangeText={setNewName} placeholder="Group name *"
              placeholderTextColor="#9ca3af" style={styles.modalInput} />
            <TextInput value={newDesc} onChangeText={setNewDesc} placeholder="Description (optional)"
              placeholderTextColor="#9ca3af" style={[styles.modalInput, { height: 80 }]}
              multiline textAlignVertical="top" />

            <View style={styles.privacyRow}>
              {(['PRIVATE', 'PUBLIC'] as const).map(p => (
                <TouchableOpacity key={p} style={[styles.privacyBtn, privacy === p && styles.privacyBtnActive]}
                  onPress={() => setPrivacy(p)}>
                  <Ionicons name={p === 'PRIVATE' ? 'lock-closed' : 'globe'} size={14}
                    color={privacy === p ? '#fff' : '#6b7280'} />
                  <Text style={[styles.privacyText, privacy === p && { color: '#fff' }]}>
                    {p === 'PRIVATE' ? 'Private' : 'Public'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.createBtn, (!newName.trim() || createMutation.isPending) && styles.createBtnDisabled]}
              onPress={() => createMutation.mutate()}
              disabled={!newName.trim() || createMutation.isPending}>
              {createMutation.isPending
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.createBtnText}>Create Group</Text>}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#fff' },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  headerTitle:   { fontSize: 17, fontWeight: '700', color: '#111827' },
  newBtn:        { width: 32, height: 32, borderRadius: 16, backgroundColor: '#4f46e5', alignItems: 'center', justifyContent: 'center' },
  searchWrap:    { flexDirection: 'row', alignItems: 'center', margin: 12, paddingHorizontal: 12, backgroundColor: '#f9fafb', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', height: 40 },
  searchInput:   { flex: 1, fontSize: 14, color: '#111827' },
  center:        { flex: 1, justifyContent: 'center', alignItems: 'center' },
  row:           { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  avatarWrap:    { width: 48, height: 48, borderRadius: 24, backgroundColor: '#ede9fe', alignItems: 'center', justifyContent: 'center' },
  avatarText:    { fontSize: 16, fontWeight: '700', color: '#7c3aed' },
  badge:         { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#4f46e5', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText:     { fontSize: 9, fontWeight: '900', color: '#fff' },
  rowInfo:       { flex: 1 },
  rowTop:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowName:       { fontSize: 15, fontWeight: '600', color: '#111827', flex: 1, marginRight: 8 },
  rowTime:       { fontSize: 11, color: '#9ca3af' },
  rowSub:        { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  emptyWrap:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingBottom: 60 },
  emptyTitle:    { fontSize: 16, color: '#6b7280', fontWeight: '500' },
  emptyBtn:      { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#4f46e5', borderRadius: 12 },
  emptyBtnText:  { color: '#fff', fontWeight: '600', fontSize: 14 },
  modal:         { flex: 1, backgroundColor: '#fff' },
  modalHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  modalTitle:    { fontSize: 17, fontWeight: '700', color: '#111827' },
  modalBody:     { padding: 20, gap: 14 },
  modalAvatar:   { width: 64, height: 64, borderRadius: 32, backgroundColor: '#ede9fe', alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  modalInput:    { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: '#111827' },
  privacyRow:    { flexDirection: 'row', gap: 10 },
  privacyBtn:    { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  privacyBtnActive: { backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  privacyText:   { fontSize: 14, fontWeight: '500', color: '#6b7280' },
  createBtn:     { backgroundColor: '#4f46e5', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  createBtnDisabled: { backgroundColor: '#c7d2fe' },
  createBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
