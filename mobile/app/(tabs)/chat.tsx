/**
 * HALQA Mobile — DM Chat Screen
 */
import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { getSocket } from '@/lib/socket';

interface Conversation {
  id: string; other: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
  lastMessage: string | null; lastMessageAt: string | null; unread: number
}

function ConvItem({ conv, onPress }: { conv: Conversation; onPress: () => void }) {
  const initials = `${conv.other.firstName[0]}${conv.other.lastName[0]}`;
  return (
    <TouchableOpacity style={styles.conv} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatar}>
        <Text allowFontScaling={false} style={styles.avatarText}>{initials}</Text>
      </View>
      <View style={styles.convInfo}>
        <View style={styles.convRow}>
          <Text allowFontScaling={false} style={styles.convName}>{conv.other.firstName} {conv.other.lastName}</Text>
          {conv.lastMessageAt && (
            <Text allowFontScaling={false} style={styles.convTime}>{formatDistanceToNow(new Date(conv.lastMessageAt), { addSuffix: false })}</Text>
          )}
        </View>
        <View style={styles.convRow}>
          <Text allowFontScaling={false} style={styles.convPreview} numberOfLines={1}>{conv.lastMessage || 'No messages yet'}</Text>
          {conv.unread > 0 && (
            <View style={styles.unreadBadge}>
              <Text allowFontScaling={false} style={styles.unreadText}>{conv.unread > 9 ? '9+' : conv.unread}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ['dm-conversations'],
    queryFn: () => api.get('/dm/conversations').then(r => r.data.data),
    staleTime: 30_000,
  });

  // ── Real-time socket updates ────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    // New DM message → refresh conversation list (updates unread counts + last message)
    const onDmMessage = () => {
      qc.invalidateQueries({ queryKey: ['dm-conversations'] });
    };
    // Read receipt from other side → clear unread
    const onDmRead = () => {
      qc.invalidateQueries({ queryKey: ['dm-conversations'] });
    };

    socket.on('dm:message', onDmMessage);
    socket.on('dm:read',    onDmRead);

    return () => {
      socket.off('dm:message', onDmMessage);
      socket.off('dm:read',    onDmRead);
    };
  }, [qc]);

  const filtered = search
    ? (data as Conversation[]).filter(c =>
        `${c.other.firstName} ${c.other.lastName}`.toLowerCase().includes(search.toLowerCase())
      )
    : (data as Conversation[]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text allowFontScaling={false} style={styles.title}>Messages</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity onPress={() => router.push('/group-chat' as any)} style={styles.headerBtn}>
            <Ionicons name="people-outline" size={20} color="#4f46e5" />
            <Text style={styles.headerBtnText}>Groups</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/new-message' as any)}>
            <Ionicons name="create-outline" size={24} color="#4f46e5" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={16} color="#9ca3af" />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search conversations…"
          placeholderTextColor="#9ca3af" style={styles.searchInput} />
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#4f46e5" /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={c => c.id}
          renderItem={({ item }) => (
            <ConvItem conv={item} onPress={() => router.push({ pathname: '/dm/[id]', params: { id: item.other.id } } as any)} />
          )}
          contentContainerStyle={{ paddingBottom: 80 + insets.bottom }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={48} color="#d1d5db" />
              <Text allowFontScaling={false} style={styles.emptyTitle}>No conversations yet</Text>
              <Text allowFontScaling={false} style={styles.emptyText}>Start a chat with someone you follow</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#f9fafb' },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  title:       { fontSize: 22, fontWeight: '900', color: '#111827' },
  searchBar:   { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 14, color: '#111827' },
  conv:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  avatar:      { width: 48, height: 48, borderRadius: 24, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center' },
  avatarText:  { fontSize: 16, fontWeight: '700', color: '#4f46e5' },
  convInfo:    { flex: 1 },
  convRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  convName:    { fontSize: 15, fontWeight: '700', color: '#111827' },
  convTime:    { fontSize: 11, color: '#9ca3af' },
  convPreview: { flex: 1, fontSize: 13, color: '#6b7280', marginTop: 2 },
  unreadBadge: { backgroundColor: '#4f46e5', borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  unreadText:  { color: '#fff', fontSize: 10, fontWeight: '900' },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty:       { alignItems: 'center', padding: 60 },
  emptyTitle:  { fontSize: 18, fontWeight: '700', color: '#374151', marginTop: 16 },
  headerBtn:   { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#eef2ff', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  headerBtnText: { fontSize: 13, fontWeight: '600', color: '#4f46e5' },
  emptyText:   { color: '#9ca3af', marginTop: 8 },
});
