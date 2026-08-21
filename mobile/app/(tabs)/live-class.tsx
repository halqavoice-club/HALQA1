/**
 * HALQA Mobile — Live Screen
 *
 * Shows both PUBLIC streams (visible to all users) and SCHOOL class streams
 * (visible to school members). Any authenticated user can go live.
 */
import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { getSocket } from '@/lib/socket';
import { showMessage } from 'react-native-flash-message';

// ─── Types ────────────────────────────────────────────────────────────────────
interface LiveClass {
  id: string
  streamType: 'SCHOOL' | 'PUBLIC'
  title: string
  status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'
  duration: number | null
  scheduledAt: string | null
  class?: { id: string; name: string } | null
  teacher?: { user: { firstName: string; lastName: string } } | null
  hostUser?: { firstName: string; lastName: string } | null
  _count: { participants: number }
}

// ─── Stream type badge ────────────────────────────────────────────────────────
function StreamTypeBadge({ streamType }: { streamType: 'SCHOOL' | 'PUBLIC' }) {
  const isPublic = streamType === 'PUBLIC';
  return (
    <View style={[styles.typeBadge, isPublic ? styles.typeBadgePublic : styles.typeBadgeSchool]}>
      <Ionicons name={isPublic ? 'globe-outline' : 'school-outline'} size={9} color={isPublic ? '#7c3aed' : '#3730a3'} />
      <Text style={[styles.typeBadgeText, { color: isPublic ? '#7c3aed' : '#3730a3' }]}>
        {isPublic ? 'Public' : 'Class'}
      </Text>
    </View>
  );
}

// ─── Class card ───────────────────────────────────────────────────────────────
function ClassCard({ lc, onPress }: { lc: LiveClass; onPress: () => void }) {
  const isLive = lc.status === 'LIVE';
  const hostName = lc.teacher?.user
    ? `${lc.teacher.user.firstName} ${lc.teacher.user.lastName}`
    : lc.hostUser
    ? `${lc.hostUser.firstName} ${lc.hostUser.lastName}`
    : null;
  const contextLine = lc.streamType === 'SCHOOL' && lc.class?.name
    ? lc.class.name
    : null;

  return (
    <TouchableOpacity
      style={[styles.card, isLive && styles.liveCard]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.cardContent}>
        <View style={[
          styles.iconArea,
          isLive
            ? { backgroundColor: '#fef2f2' }
            : lc.streamType === 'PUBLIC'
            ? { backgroundColor: '#f5f3ff' }
            : { backgroundColor: '#ede9fe' },
        ]}>
          <Ionicons
            name="videocam-outline"
            size={24}
            color={isLive ? '#ef4444' : lc.streamType === 'PUBLIC' ? '#7c3aed' : '#4f46e5'}
          />
        </View>

        <View style={{ flex: 1 }}>
          <View style={styles.cardTopRow}>
            {isLive && (
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            )}
            <StreamTypeBadge streamType={lc.streamType} />
          </View>
          <Text style={styles.cardTitle} numberOfLines={1}>{lc.title}</Text>
          {contextLine && <Text style={styles.cardMeta}>{contextLine}</Text>}
          {hostName && <Text style={styles.cardTeacher}>{hostName}</Text>}
        </View>

        <View style={{ alignItems: 'flex-end', minWidth: 48 }}>
          <Text style={styles.cardParticipants}>
            {lc._count.participants}{' '}
            <Ionicons name="people-outline" size={11} color="#9ca3af" />
          </Text>
          {lc.duration && (
            <Text style={styles.cardTime}>{lc.duration}m</Text>
          )}
          {lc.scheduledAt && !isLive && (
            <Text style={styles.cardTime}>
              {formatDistanceToNow(new Date(lc.scheduledAt), { addSuffix: true })}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Go Live Modal ────────────────────────────────────────────────────────────
function GoLiveModal({ visible, onClose, onCreated }: {
  visible: boolean; onClose: () => void; onCreated: () => void
}) {
  const [title, setTitle]       = useState('');
  const [description, setDesc]  = useState('');
  const [chatEnabled, setChat]  = useState(true);
  const [loading, setLoading]   = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) {
      showMessage({ message: 'Please enter a title', type: 'warning' });
      return;
    }
    setLoading(true);
    try {
      await api.post('/live-classes', {
        streamType: 'PUBLIC',
        title: title.trim(),
        description: description.trim() || undefined,
        chatEnabled,
        handRaiseEnabled: true,
        screenShareEnabled: true,
        isOpenMic: true,
        maxParticipants: 500,
      });
      showMessage({ message: 'You\'re live!', type: 'success' });
      setTitle(''); setDesc('');
      onCreated();
    } catch (e: any) {
      showMessage({
        message: e?.response?.data?.message || 'Failed to go live',
        type: 'danger',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={styles.modalBox}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Go Live</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 440 }} keyboardShouldPersistTaps="handled">
            {/* Type info */}
            <View style={styles.infoBox}>
              <Ionicons name="globe-outline" size={16} color="#7c3aed" />
              <Text style={styles.infoText}>
                Public stream — anyone can watch. No school required.
              </Text>
            </View>

            <Text style={styles.fieldLabel}>Title *</Text>
            <TextInput
              style={styles.input}
              placeholder="What are you streaming about?"
              placeholderTextColor="#9ca3af"
              value={title}
              onChangeText={setTitle}
              maxLength={100}
            />

            <Text style={styles.fieldLabel}>Description (optional)</Text>
            <TextInput
              style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
              placeholder="Tell viewers what to expect..."
              placeholderTextColor="#9ca3af"
              value={description}
              onChangeText={setDesc}
              multiline
              maxLength={500}
            />

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>💬 Live chat</Text>
              <Switch
                value={chatEnabled}
                onValueChange={setChat}
                trackColor={{ false: '#e5e7eb', true: '#c4b5fd' }}
                thumbColor={chatEnabled ? '#7c3aed' : '#9ca3af'}
              />
            </View>
          </ScrollView>

          <TouchableOpacity
            style={[styles.goLiveBtn, loading && { opacity: 0.6 }]}
            onPress={handleCreate}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Ionicons name="videocam" size={18} color="#fff" />
                  <Text style={styles.goLiveBtnText}>Go Live</Text>
                </>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function LiveClassScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [showGoLive, setShowGoLive] = useState(false);

  // All authenticated users can go live
  const canCreate = !!user;

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['live-classes'],
    queryFn: () =>
      api.get('/live-classes', { params: { limit: 50 } })
        .then(r => r.data.data?.items || []),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // Real-time socket updates
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const schoolId = user?.schoolId;
    if (schoolId) socket.emit('school:join', schoolId);
    socket.emit('feed:join:public');  // listen for public stream notifications

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['live-classes'] });
    socket.on('liveclass:started',   refresh);
    socket.on('liveclass:scheduled', refresh);
    socket.on('liveclass:ended',     refresh);
    socket.on('liveclass:updated',   refresh);

    return () => {
      if (schoolId) socket.emit('school:leave', schoolId);
      socket.emit('feed:leave:public');
      socket.off('liveclass:started',   refresh);
      socket.off('liveclass:scheduled', refresh);
      socket.off('liveclass:ended',     refresh);
      socket.off('liveclass:updated',   refresh);
    };
  }, [queryClient, user?.schoolId]);

  const classes: LiveClass[] = data || [];
  const live      = classes.filter(c => c.status === 'LIVE');
  const scheduled = classes.filter(c => c.status === 'SCHEDULED');
  const past      = classes.filter(c => c.status === 'ENDED').slice(0, 10);

  // Build flat list with section markers
  type ListItem = LiveClass & { _section: string };
  const listData: ListItem[] = [
    ...live.map(c => ({ ...c, _section: 'live' })),
    ...scheduled.map(c => ({ ...c, _section: 'scheduled' })),
    ...past.map(c => ({ ...c, _section: 'past' })),
  ];

  const allItems = [...live, ...scheduled, ...past.slice(0, 10)];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Live</Text>
          <Text style={styles.subtitle}>
            {live.length > 0 ? `${live.length} live now` : 'Public streams & classes'}
          </Text>
        </View>
        {canCreate && (
          <TouchableOpacity
            style={styles.goLiveHeaderBtn}
            onPress={() => setShowGoLive(true)}
          >
            <Ionicons name="radio-outline" size={16} color="#fff" />
            <Text style={styles.goLiveHeaderText}>Go Live</Text>
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4f46e5" />
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={c => c.id}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#4f46e5" />
          }
          renderItem={({ item, index }: { item: ListItem; index: number }) => {
            const SECTIONS = [
              { key: 'live',      label: '🔴 Live Now' },
              { key: 'scheduled', label: '📅 Upcoming' },
              { key: 'past',      label: '✅ Past' },
            ];
            const prevSection = index > 0 ? allItems[index - 1] as any : null;
            const showHeader = index === 0 || item._section !== prevSection?._section;
            const section = SECTIONS.find(s => s.key === item._section);
            return (
              <View>
                {showHeader && section && (
                  <Text style={styles.sectionHeader}>{section.label}</Text>
                )}
                <ClassCard
                  lc={item}
                  onPress={() =>
                    router.push({ pathname: '/live-class/[id]', params: { id: item.id } } as any)
                  }
                />
              </View>
            );
          }}
          contentContainerStyle={{ paddingBottom: 100 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="videocam-off-outline" size={48} color="#d1d5db" />
              <Text style={styles.emptyTitle}>No live streams yet</Text>
              <Text style={styles.emptySubtitle}>Tap "Go Live" to start broadcasting</Text>
              {canCreate && (
                <TouchableOpacity style={[styles.goLiveHeaderBtn, { marginTop: 16 }]} onPress={() => setShowGoLive(true)}>
                  <Ionicons name="radio-outline" size={16} color="#fff" />
                  <Text style={styles.goLiveHeaderText}>Go Live</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}

      <GoLiveModal
        visible={showGoLive}
        onClose={() => setShowGoLive(false)}
        onCreated={() => {
          setShowGoLive(false);
          queryClient.invalidateQueries({ queryKey: ['live-classes'] });
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: '#f9fafb' },
  header:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  title:             { fontSize: 22, fontWeight: '900', color: '#111827' },
  subtitle:          { fontSize: 12, color: '#9ca3af', marginTop: 1 },
  goLiveHeaderBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#4f46e5', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  goLiveHeaderText:  { color: '#fff', fontWeight: '700', fontSize: 13 },
  sectionHeader:     { fontSize: 13, fontWeight: '700', color: '#6b7280', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  card:              { backgroundColor: '#fff', marginHorizontal: 12, marginBottom: 8, borderRadius: 16, borderWidth: 1, borderColor: '#f3f4f6' },
  liveCard:          { borderColor: '#fecaca' },
  cardContent:       { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  iconArea:          { width: 48, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  cardTopRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' },
  liveBadge:         { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#fef2f2', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  liveDot:           { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#ef4444' },
  liveText:          { fontSize: 9, fontWeight: '900', color: '#ef4444' },
  typeBadge:         { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  typeBadgePublic:   { backgroundColor: '#f5f3ff' },
  typeBadgeSchool:   { backgroundColor: '#ede9fe' },
  typeBadgeText:     { fontSize: 9, fontWeight: '700' },
  cardTitle:         { fontSize: 14, fontWeight: '700', color: '#111827' },
  cardMeta:          { fontSize: 12, color: '#9ca3af', marginTop: 1 },
  cardTeacher:       { fontSize: 12, color: '#6b7280', marginTop: 1 },
  cardParticipants:  { fontSize: 12, color: '#9ca3af' },
  cardTime:          { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  center:            { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty:             { alignItems: 'center', padding: 60 },
  emptyTitle:        { fontSize: 16, fontWeight: '600', color: '#9ca3af', marginTop: 12 },
  emptySubtitle:     { fontSize: 13, color: '#d1d5db', marginTop: 4 },
  // Modal
  modalOverlay:      { flex: 1, justifyContent: 'flex-end' },
  modalBox:          { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  modalHeader:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle:        { fontSize: 18, fontWeight: '800', color: '#111827' },
  infoBox:           { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#f5f3ff', borderRadius: 12, padding: 12, marginBottom: 16 },
  infoText:          { fontSize: 13, color: '#6d28d9', flex: 1, lineHeight: 18 },
  fieldLabel:        { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 12 },
  input:             { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 12, fontSize: 15, color: '#111827', backgroundColor: '#f9fafb' },
  toggleRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#f3f4f6', marginTop: 12 },
  toggleLabel:       { fontSize: 14, color: '#374151', fontWeight: '500' },
  goLiveBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#4f46e5', borderRadius: 14, paddingVertical: 16, marginTop: 20 },
  goLiveBtnText:     { color: '#fff', fontWeight: '800', fontSize: 16 },
});
