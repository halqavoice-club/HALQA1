/**
 * HALQA Mobile — Live Classes Screen
 */
import { useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { getSocket } from '@/lib/socket';

interface LiveClass {
  id: string; title: string; status: string; duration: number
  scheduledAt: string | null; startedAt: string | null
  class: { id: string; name: string }
  teacher: { user: { firstName: string; lastName: string } }
  _count: { participants: number }
}

function ClassCard({ lc, onPress }: { lc: LiveClass; onPress: () => void }) {
  const isLive = lc.status === 'LIVE';
  return (
    <TouchableOpacity style={[styles.card, isLive && styles.liveCard]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardContent}>
        <View style={[styles.iconArea, isLive && { backgroundColor: '#fef2f2' }]}>
          <Ionicons name="videocam-outline" size={24} color={isLive ? '#ef4444' : '#4f46e5'} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            {isLive && <View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View>}
            <Text style={styles.cardTitle} numberOfLines={1}>{lc.title}</Text>
          </View>
          <Text style={styles.cardMeta}>{lc.class.name} · {lc.duration}m</Text>
          <Text style={styles.cardTeacher}>{lc.teacher.user.firstName} {lc.teacher.user.lastName}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.cardParticipants}>{lc._count.participants} <Ionicons name="people-outline" size={12} /></Text>
          {lc.scheduledAt && !isLive && (
            <Text style={styles.cardTime}>{formatDistanceToNow(new Date(lc.scheduledAt), { addSuffix: true })}</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function LiveClassScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const canCreate = ['TEACHER','SCHOOL_ADMIN','SUPER_ADMIN'].includes(user?.role || '');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['live-classes'],
    queryFn: () => api.get('/live-classes', { params: { limit: 50 } }).then(r => r.data.data?.items || []),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // Real-time socket: refresh list when a class starts/ends/is scheduled
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const schoolId = user?.schoolId;
    if (schoolId) socket.emit('school:join', schoolId);

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['live-classes'] });
    socket.on('liveclass:started',   refresh);
    socket.on('liveclass:scheduled', refresh);
    socket.on('liveclass:ended',     refresh);
    socket.on('liveclass:updated',   refresh);

    return () => {
      if (schoolId) socket.emit('school:leave', schoolId);
      socket.off('liveclass:started',   refresh);
      socket.off('liveclass:scheduled', refresh);
      socket.off('liveclass:ended',     refresh);
      socket.off('liveclass:updated',   refresh);
    };
  }, [queryClient, user?.schoolId]);

  const classes: LiveClass[] = data || [];
  const live      = classes.filter(c => c.status === 'LIVE');
  const scheduled = classes.filter(c => c.status === 'SCHEDULED');
  const past      = classes.filter(c => c.status === 'ENDED');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Live Classes</Text>
        {canCreate && (
          <TouchableOpacity onPress={() => router.push('/create-live-class' as any)}>
            <Ionicons name="add-circle-outline" size={26} color="#4f46e5" />
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#4f46e5" /></View>
      ) : (
        <FlatList
          data={[
            ...live.map(c => ({ ...c, _section: 'live' })),
            ...scheduled.map(c => ({ ...c, _section: 'scheduled' })),
            ...past.slice(0, 10).map(c => ({ ...c, _section: 'past' })),
          ]}
          keyExtractor={c => c.id}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#4f46e5" />
          }
          renderItem={({ item, index }: any) => {
            const sections = [{ key: 'live', label: '🔴 Live Now' }, { key: 'scheduled', label: '📅 Upcoming' }, { key: 'past', label: '✅ Past' }];
            const showHeader = index === 0 ||
              (item._section !== ([...live,...scheduled,...past.slice(0,10)][index-1] as any)?._section);
            const section = sections.find(s => s.key === item._section);
            return (
              <View>
                {showHeader && section && (
                  <Text style={styles.sectionHeader}>{section.label}</Text>
                )}
                <ClassCard lc={item} onPress={() => router.push({ pathname: '/live-class/[id]', params: { id: item.id } } as any)} />
              </View>
            );
          }}
          contentContainerStyle={{ paddingBottom: 100 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="videocam-off-outline" size={48} color="#d1d5db" />
              <Text style={styles.emptyTitle}>No live classes yet</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f9fafb' },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  title:        { fontSize: 22, fontWeight: '900', color: '#111827' },
  sectionHeader:{ fontSize: 13, fontWeight: '700', color: '#6b7280', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  card:         { backgroundColor: '#fff', marginHorizontal: 12, marginBottom: 8, borderRadius: 16, borderWidth: 1, borderColor: '#f3f4f6', overflow: 'hidden' },
  liveCard:     { borderColor: '#fecaca' },
  cardContent:  { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  iconArea:     { width: 48, height: 48, borderRadius: 12, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center' },
  liveBadge:    { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#fef2f2', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  liveDot:      { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#ef4444' },
  liveText:     { fontSize: 9, fontWeight: '900', color: '#ef4444' },
  cardTitle:    { fontSize: 14, fontWeight: '700', color: '#111827', flex: 1 },
  cardMeta:     { fontSize: 12, color: '#9ca3af' },
  cardTeacher:  { fontSize: 12, color: '#6b7280', marginTop: 2 },
  cardParticipants: { fontSize: 12, color: '#9ca3af' },
  cardTime:     { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty:        { alignItems: 'center', padding: 60 },
  emptyTitle:   { fontSize: 16, fontWeight: '600', color: '#9ca3af', marginTop: 12 },
});
