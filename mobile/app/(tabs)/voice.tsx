/**
 * HALQA Mobile — Voice Club Lobby
 * Discover tab + My Rooms tab, search, privacy filter,
 * real-time socket updates, Stats button.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Image, RefreshControl, Alert,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useDebounce } from '@/hooks/useDebounce';
import { getAvatarUrl } from '@/lib/avatar';
import { useAuthStore } from '@/store/auth.store';
import { useVoiceStore } from '@/store/voice.store';

interface VoiceRoom {
  id: string; title: string; description: string | null;
  topic: string | null; privacy: string; status: string;
  coverEmoji: string; coverImageUrl: string | null;
  isOpenMic: boolean;
  host: { id: string; firstName: string; lastName: string; avatarUrl: string | null };
  participants: { userId: string; role: string; isActive: boolean;
    user: { id: string; firstName: string; lastName: string; avatarUrl: string | null } }[];
  _count: { participants: number };
  startedAt: string | null; createdAt: string;
}

const PRIVACY_FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Public', value: 'PUBLIC' },
  { label: 'Private', value: 'PRIVATE' },
  { label: 'Invite Only', value: 'INVITE_ONLY' },
];

const STATUS_COLOR: Record<string, string> = {
  LIVE: '#dc2626', IDLE: '#6b7280', SCHEDULED: '#3b82f6', ENDED: '#9ca3af',
};

function RoomCard({ room, onJoin, joining }: { room: VoiceRoom; onJoin: () => void; joining: boolean }) {
  const isLive = room.status === 'LIVE';
  const speakers = room.participants?.filter(p => ['HOST','MODERATOR','SPEAKER'].includes(p.role) && p.isActive) ?? [];
  const count = room._count?.participants ?? 0;
  return (
    <TouchableOpacity style={[s.card, isLive && s.cardLive]} onPress={onJoin} activeOpacity={0.85}>
      <View style={s.coverCircle}>
        {room.coverImageUrl
          ? <Image source={{ uri: getAvatarUrl(room.coverImageUrl) ?? '' }} style={s.coverImg} />
          : <Text style={s.coverEmoji}>{room.coverEmoji ?? '🎙️'}</Text>}
        {isLive && <View style={s.liveRing} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.cardTitleRow}>
          <Text allowFontScaling={false} style={s.cardTitle} numberOfLines={1}>{room.title}</Text>
          {isLive && (
            <View style={s.livePill}>
              <View style={s.liveDot} />
              <Text allowFontScaling={false} style={s.liveTxt}>LIVE</Text>
            </View>
          )}
        </View>
        {room.topic ? <Text allowFontScaling={false} style={s.cardTopic} numberOfLines={1}>{room.topic}</Text> : null}
        <View style={s.cardMeta}>
          {speakers.slice(0, 4).map(p => {
            const avSrc = getAvatarUrl(p.user.avatarUrl);
            const initials = `${p.user.firstName?.charAt(0) ?? ''}${p.user.lastName?.charAt(0) ?? ''}`;
            return (
              <View key={p.userId} style={s.speakerAv}>
                {avSrc ? <Image source={{ uri: avSrc }} style={s.speakerAvImg} /> : <Text style={s.speakerAvTxt}>{initials}</Text>}
              </View>
            );
          })}
          {count > 0 && <Text allowFontScaling={false} style={s.countTxt}>{count} listening</Text>}
        </View>
      </View>
      <TouchableOpacity style={[s.joinBtn, isLive && s.joinBtnLive]} onPress={onJoin} disabled={joining}>
        {joining ? <ActivityIndicator size="small" color="#fff" /> : <Text allowFontScaling={false} style={s.joinBtnTxt}>Join</Text>}
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function MyRoomRow({ room, onJoin, onDelete, joining, deleting }: {
  room: VoiceRoom; onJoin: () => void; onDelete: () => void;
  joining: boolean; deleting: boolean;
}) {
  const isEnded = room.status === 'ENDED';
  const statusColor = STATUS_COLOR[room.status] ?? '#6b7280';
  const count = room._count?.participants ?? 0;
  return (
    <View style={[s.myRoomCard, isEnded && s.myRoomCardEnded]}>
      <Text style={{ fontSize: 22, marginRight: 10 }}>{room.coverEmoji ?? '🎙️'}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.cardTitleRow}>
          <Text allowFontScaling={false} style={s.cardTitle} numberOfLines={1}>{room.title}</Text>
          <View style={[s.statusPill, { backgroundColor: statusColor + '20' }]}>
            <Text allowFontScaling={false} style={[s.statusTxt, { color: statusColor }]}>{room.status}</Text>
          </View>
        </View>
        {room.topic ? <Text allowFontScaling={false} style={s.cardTopic} numberOfLines={1}>{room.topic}</Text> : null}
        <Text allowFontScaling={false} style={s.myRoomMeta}>
          👥 {count} · {(room.privacy ?? '').replace('_', ' ').toLowerCase()}
        </Text>
      </View>
      <View style={s.myRoomActions}>
        {!isEnded && (
          <TouchableOpacity style={s.myRoomJoin} onPress={onJoin} disabled={joining}>
            {joining ? <ActivityIndicator size="small" color="#fff" /> : <Text allowFontScaling={false} style={s.myRoomJoinTxt}>{room.status === 'LIVE' ? 'Join' : 'Enter'}</Text>}
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.myRoomDel} onPress={onDelete} disabled={deleting}>
          {deleting ? <ActivityIndicator size="small" color="#ef4444" /> : <Ionicons name="trash-outline" size={15} color="#ef4444" />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function VoiceClubScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { activeRoomId, setActiveRoom, clearActiveRoom } = useVoiceStore();
  const [tab, setTab] = useState<'discover' | 'my-rooms'>('discover');
  const [privacyFilter, setPrivacyFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const debouncedSearch = useDebounce(search, 350);

  const { data: rooms = [], isLoading, refetch } = useQuery<VoiceRoom[]>({
    queryKey: ['voice-rooms-mobile', privacyFilter],
    queryFn: () => api.get('/voice', {
      params: { ...(privacyFilter !== 'all' && { privacy: privacyFilter }), limit: 50 }
    }).then(r => r.data.data ?? []),
    refetchInterval: 60_000,
    enabled: !debouncedSearch && tab === 'discover',
  });

  const { data: searchResults = [], isLoading: searchLoading } = useQuery<VoiceRoom[]>({
    queryKey: ['voice-search-mobile', debouncedSearch],
    queryFn: () => api.get('/voice/search', { params: { q: debouncedSearch } }).then(r => r.data.data ?? []),
    enabled: !!debouncedSearch && debouncedSearch.length >= 2,
  });

  const { data: myRooms = [], isLoading: myLoading, refetch: refetchMy } = useQuery<VoiceRoom[]>({
    queryKey: ['voice-my-rooms-mobile'],
    queryFn: () => api.get('/voice/my').then(r => r.data.data ?? []),
    enabled: tab === 'my-rooms',
  });

  const displayed = debouncedSearch ? searchResults : rooms;
  const loading = debouncedSearch ? searchLoading : isLoading;

  // Real-time socket updates
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const patch = (old: VoiceRoom[] | undefined, roomId: string, updates: Partial<VoiceRoom>) =>
      old ? old.map(r => r.id === roomId ? { ...r, ...updates } : r) : old;

    const onCreated = (room: VoiceRoom) => {
      queryClient.setQueryData<VoiceRoom[]>(['voice-rooms-mobile', privacyFilter], old => {
        if (!old) return [room];
        if (old.some(r => r.id === room.id)) return old;
        return [room, ...old];
      });
    };
    const onStatus = (d: { roomId: string; status: string }) => {
      queryClient.setQueryData<VoiceRoom[]>(['voice-rooms-mobile', privacyFilter], old => patch(old, d.roomId, { status: d.status }));
      queryClient.setQueryData<VoiceRoom[]>(['voice-my-rooms-mobile'], old => patch(old, d.roomId, { status: d.status }));
    };
    const onDeleted = (d: { roomId: string }) => {
      queryClient.setQueryData<VoiceRoom[]>(['voice-rooms-mobile', privacyFilter], old => old?.filter(r => r.id !== d.roomId));
      queryClient.setQueryData<VoiceRoom[]>(['voice-my-rooms-mobile'], old => old?.filter(r => r.id !== d.roomId));
    };
    const onUpdated = (d: { roomId: string; title: string; description: string | null; topic: string | null; privacy: string; coverEmoji: string; coverImageUrl?: string | null }) => {
      const updates = { title: d.title, description: d.description, topic: d.topic, privacy: d.privacy, coverEmoji: d.coverEmoji, coverImageUrl: d.coverImageUrl };
      queryClient.setQueryData<VoiceRoom[]>(['voice-rooms-mobile', privacyFilter], old => patch(old, d.roomId, updates));
      queryClient.setQueryData<VoiceRoom[]>(['voice-my-rooms-mobile'], old => patch(old, d.roomId, updates));
    };
    socket.on('voice:room_created',   onCreated);
    socket.on('voice:status_changed', onStatus);
    socket.on('voice:room_deleted',   onDeleted);
    socket.on('voice:room_updated',   onUpdated);
    return () => {
      socket.off('voice:room_created',   onCreated);
      socket.off('voice:status_changed', onStatus);
      socket.off('voice:room_deleted',   onDeleted);
      socket.off('voice:room_updated',   onUpdated);
    };
  }, [queryClient, privacyFilter]);

  const handleJoin = useCallback(async (room: VoiceRoom) => {
    // If already in this room, just navigate back to it
    if (activeRoomId === room.id) {
      router.push({ pathname: '/voice/[id]', params: { id: room.id } } as any);
      return;
    }
    setJoiningId(room.id);
    try {
      await api.post(`/voice/${room.id}/join`);
      // Store the active room summary so the tab bar badge lights up
      setActiveRoom({
        id:              room.id,
        title:           room.title,
        status:          room.status as any,
        privacy:         room.privacy as any,
        coverEmoji:      room.coverEmoji,
        coverImageUrl:   room.coverImageUrl,
        topic:           room.topic,
        hostId:          room.host?.id ?? '',
        isOpenMic:       room.isOpenMic ?? false,
        micLocked:       false,
        commentsEnabled: true,
        slowMode:        false,
        messageType:     'all',
        reactionsEnabled: true,
        roomLevel:       1,
        schoolId:        null,
      });
      router.push({ pathname: '/voice/[id]', params: { id: room.id } } as any);
    } catch (e: any) {
      alert(e?.response?.data?.message ?? 'Failed to join');
    } finally { setJoiningId(null); }
  }, [router, activeRoomId, setActiveRoom]);

  const handleDelete = useCallback((room: VoiceRoom) => {
    Alert.alert('Delete Room', `Delete "${room.title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setDeletingId(room.id);
        try {
          await api.delete(`/voice/${room.id}`);
          queryClient.invalidateQueries({ queryKey: ['voice-my-rooms-mobile'] });
          queryClient.invalidateQueries({ queryKey: ['voice-rooms-mobile'] });
        } catch (e: any) {
          alert(e?.response?.data?.message ?? 'Failed to delete');
        } finally { setDeletingId(null); }
      }},
    ]);
  }, [queryClient]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await (tab === 'my-rooms' ? refetchMy() : refetch());
    setRefreshing(false);
  }, [refetch, refetchMy, tab]);

  const liveRooms  = displayed.filter(r => r.status === 'LIVE');
  const otherRooms = displayed.filter(r => r.status !== 'LIVE');
  const activeMyRooms = myRooms.filter(r => r.status !== 'ENDED');

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.headerIcon}><Ionicons name="radio" size={20} color="#fff" /></View>
          <View>
            <Text allowFontScaling={false} style={s.headerTitle}>Voice Club</Text>
            <Text allowFontScaling={false} style={s.headerSub}>Live audio rooms</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={s.statsBtn} onPress={() => router.push('/voice/stats' as any)}>
            <Ionicons name="bar-chart-outline" size={18} color="#7c3aed" />
          </TouchableOpacity>
          <TouchableOpacity style={s.createBtn} onPress={() => router.push('/voice/create' as any)}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text allowFontScaling={false} style={s.createBtnTxt}>Start</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Active room banner — tap to return */}
      {activeRoomId && (
        <TouchableOpacity
          style={s.activeRoomBanner}
          onPress={() => router.push({ pathname: '/voice/[id]', params: { id: activeRoomId } } as any)}
          activeOpacity={0.85}
        >
          <View style={s.activeRoomDot} />
          <Text allowFontScaling={false} style={s.activeRoomTxt} numberOfLines={1}>
            🎙️ You're in a room — tap to return
          </Text>
          <Ionicons name="chevron-forward" size={14} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Tabs */}
      <View style={s.tabBar}>
        <TouchableOpacity style={[s.tabBtn, tab === 'discover' && s.tabBtnActive]} onPress={() => setTab('discover')}>
          <Text allowFontScaling={false} style={[s.tabTxt, tab === 'discover' && s.tabTxtActive]}>🔍 Discover</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tabBtn, tab === 'my-rooms' && s.tabBtnActive]} onPress={() => setTab('my-rooms')}>
          <Text allowFontScaling={false} style={[s.tabTxt, tab === 'my-rooms' && s.tabTxtActive]}>🎙️ My Rooms</Text>
          {activeMyRooms.length > 0 && (
            <View style={s.tabBadge}><Text allowFontScaling={false} style={s.tabBadgeTxt}>{activeMyRooms.length}</Text></View>
          )}
        </TouchableOpacity>
      </View>

      {tab === 'discover' ? (
        <>
          {/* Search */}
          <View style={s.searchRow}>
            <Ionicons name="search-outline" size={16} color="#9ca3af" />
            <TextInput value={search} onChangeText={setSearch} placeholder="Search rooms…" placeholderTextColor="#9ca3af" style={s.searchInput} allowFontScaling={false} />
            {search ? <TouchableOpacity onPress={() => setSearch('')}><Ionicons name="close-circle" size={16} color="#9ca3af" /></TouchableOpacity> : null}
          </View>
          {/* Privacy filters */}
          <View style={s.filters}>
            {PRIVACY_FILTERS.map(f => (
              <TouchableOpacity key={f.value} style={[s.filterBtn, privacyFilter === f.value && s.filterBtnActive]} onPress={() => setPrivacyFilter(f.value)}>
                <Text allowFontScaling={false} style={[s.filterTxt, privacyFilter === f.value && s.filterTxtActive]}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {loading ? (
            <View style={s.center}><ActivityIndicator size="large" color="#7c3aed" /></View>
          ) : (
            <FlatList
              data={[
                ...(liveRooms.length > 0 ? [{ type: 'header', label: `🔴 Live Now (${liveRooms.length})` } as any, ...liveRooms] : []),
                ...(otherRooms.length > 0 ? [{ type: 'header', label: 'Rooms' } as any, ...otherRooms] : []),
              ]}
              keyExtractor={(item, i) => item.id ?? `header-${i}`}
              contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 80 + insets.bottom }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7c3aed" />}
              renderItem={({ item }) => {
                if (item.type === 'header') return <Text allowFontScaling={false} style={s.sectionHeader}>{item.label}</Text>;
                const room = item as VoiceRoom;
                return <RoomCard room={room} onJoin={() => handleJoin(room)} joining={joiningId === room.id} />;
              }}
              ListEmptyComponent={
                <View style={s.empty}>
                  <Ionicons name="radio-outline" size={48} color="#d1d5db" />
                  <Text allowFontScaling={false} style={s.emptyTitle}>No rooms yet</Text>
                  <Text allowFontScaling={false} style={s.emptySub}>Be the first to start a conversation</Text>
                  <TouchableOpacity style={s.createBtn} onPress={() => router.push('/voice/create' as any)}>
                    <Ionicons name="add" size={16} color="#fff" />
                    <Text allowFontScaling={false} style={s.createBtnTxt}>Start a Room</Text>
                  </TouchableOpacity>
                </View>
              }
            />
          )}
        </>
      ) : (
        /* My Rooms tab */
        myLoading ? (
          <View style={s.center}><ActivityIndicator size="large" color="#7c3aed" /></View>
        ) : (
          <FlatList
            data={myRooms}
            keyExtractor={r => r.id}
            contentContainerStyle={{ padding: 12, paddingBottom: 80 + insets.bottom }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7c3aed" />}
            renderItem={({ item }) => (
              <MyRoomRow
                room={item}
                onJoin={() => handleJoin(item)}
                onDelete={() => handleDelete(item)}
                joining={joiningId === item.id}
                deleting={deletingId === item.id}
              />
            )}
            ListEmptyComponent={
              <View style={s.empty}>
                <Ionicons name="mic-outline" size={48} color="#d1d5db" />
                <Text allowFontScaling={false} style={s.emptyTitle}>No rooms yet</Text>
                <Text allowFontScaling={false} style={s.emptySub}>Create your first voice room</Text>
                <TouchableOpacity style={s.createBtn} onPress={() => router.push('/voice/create' as any)}>
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text allowFontScaling={false} style={s.createBtnTxt}>Start a Room</Text>
                </TouchableOpacity>
              </View>
            }
          />
        )
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#f9fafb' },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  headerLeft:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon:      { width: 36, height: 36, borderRadius: 10, backgroundColor: '#7c3aed', justifyContent: 'center', alignItems: 'center' },
  headerTitle:     { fontSize: 18, fontWeight: '900', color: '#111827' },
  headerSub:       { fontSize: 11, color: '#9ca3af' },
  createBtn:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#7c3aed', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  createBtnTxt:    { color: '#fff', fontWeight: '700', fontSize: 13 },
  statsBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center' },
  tabBar:          { flexDirection: 'row', backgroundColor: '#f3f4f6', margin: 12, borderRadius: 14, padding: 3 },
  tabBtn:          { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: 11 },
  tabBtnActive:    { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabTxt:          { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  tabTxtActive:    { color: '#111827', fontWeight: '700' },
  tabBadge:        { backgroundColor: '#7c3aed', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  tabBadgeTxt:     { color: '#fff', fontSize: 9, fontWeight: '800' },
  searchRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginBottom: 8, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', paddingHorizontal: 12, paddingVertical: 9 },
  searchInput:     { flex: 1, fontSize: 14, color: '#111827' },
  filters:         { flexDirection: 'row', gap: 8, paddingHorizontal: 12, marginBottom: 8 },
  filterBtn:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#f3f4f6' },
  filterBtnActive: { backgroundColor: '#ede9fe' },
  filterTxt:       { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  filterTxtActive: { color: '#7c3aed' },
  sectionHeader:   { fontSize: 12, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, paddingVertical: 8, paddingHorizontal: 4 },
  card:            { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#f3f4f6' },
  cardLive:        { borderColor: '#ddd6fe' },
  coverCircle:     { width: 52, height: 52, borderRadius: 26, overflow: 'hidden', backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center', flexShrink: 0, position: 'relative' },
  coverImg:        { width: 52, height: 52 },
  coverEmoji:      { fontSize: 26 },
  liveRing:        { position: 'absolute', top: -2, left: -2, right: -2, bottom: -2, borderRadius: 28, borderWidth: 2, borderColor: '#7c3aed' },
  cardTitleRow:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  cardTitle:       { fontSize: 14, fontWeight: '700', color: '#111827', flex: 1 },
  livePill:        { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#fce7f3', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  liveDot:         { width: 5, height: 5, borderRadius: 3, backgroundColor: '#ec4899' },
  liveTxt:         { fontSize: 9, fontWeight: '800', color: '#db2777' },
  cardTopic:       { fontSize: 11, color: '#9ca3af', marginBottom: 4 },
  cardMeta:        { flexDirection: 'row', alignItems: 'center', gap: 4 },
  speakerAv:       { width: 20, height: 20, borderRadius: 10, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', marginLeft: -4 },
  speakerAvImg:    { width: 20, height: 20 },
  speakerAvTxt:    { fontSize: 7, fontWeight: '800', color: '#7c3aed' },
  countTxt:        { fontSize: 11, color: '#9ca3af', marginLeft: 4 },
  joinBtn:         { backgroundColor: '#9ca3af', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  joinBtnLive:     { backgroundColor: '#7c3aed' },
  joinBtnTxt:      { color: '#fff', fontWeight: '700', fontSize: 12 },
  myRoomCard:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#f3f4f6' },
  myRoomCardEnded: { opacity: 0.55 },
  statusPill:      { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  statusTxt:       { fontSize: 9, fontWeight: '800' },
  myRoomMeta:      { fontSize: 11, color: '#9ca3af', marginTop: 3 },
  myRoomActions:   { flexDirection: 'row', gap: 6, alignItems: 'center', marginLeft: 8 },
  myRoomJoin:      { backgroundColor: '#7c3aed', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  myRoomJoinTxt:   { color: '#fff', fontWeight: '700', fontSize: 11 },
  myRoomDel:       { width: 30, height: 30, borderRadius: 8, backgroundColor: '#fef2f2', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#fee2e2' },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  empty:           { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle:      { fontSize: 16, fontWeight: '700', color: '#374151', marginTop: 12 },
  emptySub:        { fontSize: 13, color: '#9ca3af' },
  // Active room banner
  activeRoomBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#7c3aed', marginHorizontal: 12, marginBottom: 4, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  activeRoomDot:    { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },
  activeRoomTxt:    { flex: 1, color: '#fff', fontSize: 12, fontWeight: '700' },
});
