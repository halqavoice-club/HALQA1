/**
 * HALQA Mobile — Messages (WhatsApp-style DM list)
 *
 * Replaces the old email-style inbox.
 * Shows all DM conversations with:
 *   - Avatar + name + last message + timestamp
 *   - Unread badge
 *   - Search filter
 *   - New conversation button
 *   - Real-time socket updates (unread + last message preview)
 *   - Tap → opens dm/[id] thread
 */
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDistanceToNow, isToday, isYesterday, format } from 'date-fns';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { getSocket } from '@/lib/socket';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Conversation {
  id: string;
  other: { id: string; firstName: string; lastName: string; avatarUrl: string | null };
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastSenderId: string | null;
  unread: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const WA_GREEN = '#25d366';
const WA_DARK  = '#128c7e';
const WA_BG    = '#f0f2f5';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    if (isToday(d)) return format(d, 'h:mm a');
    if (isYesterday(d)) return 'Yesterday';
    return format(d, 'MMM d');
  } catch { return ''; }
}

function initials(first: string, last: string): string {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
}

// ─── Conversation row ─────────────────────────────────────────────────────────
function ConvRow({ conv, myId, onPress }: {
  conv: Conversation; myId?: string; onPress: () => void;
}) {
  const isUnread = conv.unread > 0;
  const ini = initials(conv.other.firstName, conv.other.lastName);

  return (
    <TouchableOpacity style={[s.row, isUnread && s.rowUnread]} onPress={onPress} activeOpacity={0.7}>
      {/* Avatar */}
      <View style={s.avatarWrap}>
        <Text style={s.avatarText}>{ini}</Text>
      </View>

      {/* Info */}
      <View style={s.info}>
        <View style={s.topRow}>
          <Text style={[s.name, isUnread && s.nameBold]} numberOfLines={1}>
            {conv.other.firstName} {conv.other.lastName}
          </Text>
          {conv.lastMessageAt && (
            <Text style={[s.time, isUnread && { color: WA_GREEN }]}>
              {fmtTime(conv.lastMessageAt)}
            </Text>
          )}
        </View>
        <View style={s.bottomRow}>
          <Text style={[s.preview, isUnread && s.previewBold]} numberOfLines={1}>
            {conv.lastSenderId === myId && conv.lastMessage
              ? `You: ${conv.lastMessage}`
              : conv.lastMessage || 'Tap to chat'}
          </Text>
          {isUnread && (
            <View style={s.badge}>
              <Text style={s.badgeText}>{conv.unread > 9 ? '9+' : conv.unread}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function MessagesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  // ── Fetch conversations ────────────────────────────────────────────────────
  const { data = [], isLoading, refetch } = useQuery<Conversation[]>({
    queryKey: ['dm-conversations'],
    queryFn: () => api.get('/dm/conversations').then(r => r.data.data ?? []),
    staleTime: 30_000,
  });

  // ── Real-time: new message or read event → refresh list ────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const refresh = () => qc.invalidateQueries({ queryKey: ['dm-conversations'] });
    socket.on('dm:message', refresh);
    socket.on('dm:read',    refresh);
    socket.on('dm:delivered', refresh);
    return () => {
      socket.off('dm:message', refresh);
      socket.off('dm:read',    refresh);
      socket.off('dm:delivered', refresh);
    };
  }, [qc]);

  // ── Filter ─────────────────────────────────────────────────────────────────
  const filtered = search.trim()
    ? (data as Conversation[]).filter(c =>
        `${c.other.firstName} ${c.other.lastName}`.toLowerCase().includes(search.toLowerCase())
      )
    : (data as Conversation[]);

  const totalUnread = (data as Conversation[]).reduce((sum, c) => sum + (c.unread ?? 0), 0);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={s.container} edges={['top']}>

        {/* ── Header ── */}
        <View style={s.header}>
          <Text style={s.headerTitle}>
            Messages{totalUnread > 0 ? ` (${totalUnread})` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {/* Groups shortcut */}
            <TouchableOpacity onPress={() => router.push('/group-chat' as any)} style={s.headerBtn} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
              <Ionicons name="people-outline" size={22} color={WA_DARK} />
            </TouchableOpacity>
            {/* New conversation */}
            <TouchableOpacity onPress={() => router.push('/new-message' as any)} style={s.headerBtn} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
              <Ionicons name="create-outline" size={22} color={WA_DARK} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Search bar ── */}
        <View style={s.searchWrap}>
          <Ionicons name="search-outline" size={16} color="#9ca3af" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search conversations…"
            placeholderTextColor="#9ca3af"
            style={s.searchInput}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
              <Ionicons name="close-circle" size={16} color="#9ca3af" />
            </TouchableOpacity>
          )}
        </View>

        {/* ── List ── */}
        {isLoading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={WA_DARK} />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={c => c.id}
            renderItem={({ item }) => (
              <ConvRow
                conv={item}
                myId={user?.id}
                onPress={() => router.push({ pathname: '/dm/[id]', params: { id: item.other.id } } as any)}
              />
            )}
            refreshControl={
              <RefreshControl refreshing={false} onRefresh={refetch} tintColor={WA_DARK} />
            }
            contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
            ItemSeparatorComponent={() => <View style={s.separator} />}
            ListEmptyComponent={
              <View style={s.empty}>
                <Ionicons name="chatbubbles-outline" size={56} color="#d1d5db" />
                <Text style={s.emptyTitle}>No conversations yet</Text>
                <Text style={s.emptySub}>Start a chat by tapping the compose icon above.</Text>
              </View>
            }
          />
        )}

        {/* ── FAB: new conversation ── */}
        <TouchableOpacity
          style={[s.fab, { bottom: 24 + insets.bottom }]}
          onPress={() => router.push('/new-message' as any)}
          activeOpacity={0.85}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={24} color="#fff" />
        </TouchableOpacity>

      </SafeAreaView>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#fff' },

  // Header
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  headerTitle:  { fontSize: 22, fontWeight: '900', color: '#111827' },
  headerBtn:    { padding: 4 },

  // Search
  searchWrap:   { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, marginBottom: 6, backgroundColor: WA_BG, borderRadius: 24, paddingHorizontal: 14, paddingVertical: 10 },
  searchInput:  { flex: 1, fontSize: 14, color: '#111827' },

  // Rows
  row:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff' },
  rowUnread:    { backgroundColor: '#fafffe' },
  avatarWrap:   { width: 52, height: 52, borderRadius: 26, backgroundColor: '#dcfce7', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  avatarText:   { fontSize: 18, fontWeight: '700', color: WA_DARK },
  info:         { flex: 1, minWidth: 0 },
  topRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  name:         { fontSize: 15, fontWeight: '500', color: '#111827', flex: 1, marginRight: 8 },
  nameBold:     { fontWeight: '700' },
  time:         { fontSize: 11, color: '#9ca3af', flexShrink: 0 },
  bottomRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  preview:      { flex: 1, fontSize: 13, color: '#9ca3af', marginRight: 8 },
  previewBold:  { color: '#374151', fontWeight: '600' },
  badge:        { backgroundColor: WA_GREEN, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, flexShrink: 0 },
  badgeText:    { color: '#fff', fontSize: 10, fontWeight: '900' },

  separator:    { height: 1, backgroundColor: '#f9fafb', marginLeft: 80 },

  // Empty
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  empty:        { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40, gap: 10 },
  emptyTitle:   { fontSize: 18, fontWeight: '700', color: '#374151' },
  emptySub:     { fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 20 },

  // FAB
  fab:          { position: 'absolute', right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: WA_GREEN, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
});
