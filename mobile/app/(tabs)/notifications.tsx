/**
 * HALQA Mobile — Notifications Screen
 * Type filter chips, unread-only toggle, date-grouped list,
 * mark-read on tap, mark-all-read button.
 */
import React, { useState, useMemo, useEffect } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, ScrollView
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { formatDistanceToNow, isToday, isYesterday, format } from 'date-fns';
import api from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useNotificationsStore } from '@/store/notifications.store';

type Notification = {
  id: string; type: string; title: string; body: string;
  isRead: boolean; createdAt: string; data?: any;
};

const TYPE_CFG: Record<string, { icon: string; color: string; label: string }> = {
  ATTENDANCE:      { icon: 'calendar-outline',           color: '#6366f1', label: 'Attendance' },
  GRADE:           { icon: 'school-outline',             color: '#0ea5e9', label: 'Grade' },
  BEHAVIOR:        { icon: 'star-outline',               color: '#f59e0b', label: 'Behavior' },
  MESSAGE:         { icon: 'chatbubble-outline',         color: '#10b981', label: 'Message' },
  ANNOUNCEMENT:    { icon: 'megaphone-outline',          color: '#8b5cf6', label: 'Announcement' },
  REMINDER:        { icon: 'alarm-outline',              color: '#f97316', label: 'Reminder' },
  SYSTEM:          { icon: 'information-circle-outline', color: '#64748b', label: 'System' },
  FOLLOW:          { icon: 'person-add-outline',         color: '#4f46e5', label: 'Follow' },
  LIKE:            { icon: 'heart-outline',              color: '#ef4444', label: 'Like' },
  COMMENT:         { icon: 'chatbubble-ellipses-outline',color: '#6366f1', label: 'Comment' },
  FRIEND_REQUEST:  { icon: 'people-outline',             color: '#0ea5e9', label: 'Friend' },
  GIFT_RECEIVED:   { icon: 'gift-outline',               color: '#f59e0b', label: 'Gift' },
  TIP_RECEIVED:    { icon: 'cash-outline',               color: '#10b981', label: 'Tip' },
  COINS_PURCHASED: { icon: 'wallet-outline',             color: '#8b5cf6', label: 'Coins' },
  MENTION:         { icon: 'at-outline',                 color: '#6366f1', label: 'Mention' },
};

function dateLabel(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMMM d, yyyy');
}

function NotifRow({ notif, onMarkRead, router }: { notif: Notification; onMarkRead: () => void; router: any }) {
  const cfg = TYPE_CFG[notif.type] ?? TYPE_CFG.SYSTEM;

  const handlePress = () => {
    if (!notif.isRead) onMarkRead();
    // Navigate for friend requests
    if (notif.type === 'FRIEND_REQUEST') {
      router.push('/friend-requests');
    }
  };

  return (
    <TouchableOpacity
      style={[n.row, !notif.isRead && n.rowUnread]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <View style={[n.iconCircle, { backgroundColor: cfg.color + '22' }]}>
        <Ionicons name={cfg.icon as any} size={20} color={cfg.color} />
      </View>
      <View style={n.rowContent}>
        <View style={n.rowTop}>
          <Text style={[n.rowTitle, !notif.isRead && n.rowTitleBold]} numberOfLines={1}>
            {notif.title}
          </Text>
          <Text style={n.rowTime}>
            {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
          </Text>
        </View>
        <Text style={n.rowBody} numberOfLines={2}>{notif.body}</Text>
        <View style={n.rowFooter}>
          <View style={[n.typePill, { backgroundColor: cfg.color + '18' }]}>
            <Text style={[n.typePillTxt, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
          {notif.isRead && (
            <Text style={n.readTxt}>✓ Read</Text>
          )}
        </View>
      </View>
      {!notif.isRead && <View style={[n.unreadDot, { backgroundColor: cfg.color }]} />}
    </TouchableOpacity>
  );
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Import notifications store for badge count sync
  const { setUnreadCount, markAllRead: clearBadge } = useNotificationsStore();

  const { data: all = [], isLoading, refetch, isRefetching } = useQuery<Notification[]>({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications', { params: { limit: 100 } }).then(r => {
      const raw = r.data.data;
      return (Array.isArray(raw) ? raw : raw?.items ?? []) as Notification[];
    }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // ── Real-time: refresh when a new notification arrives ─────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onNew = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
    socket.on('notification:new', onNew);
    return () => { socket.off('notification:new', onNew); };
  }, [queryClient]);

  const markAll = useMutation({
    mutationFn: () => api.patch('/notifications/read-all').catch(() => api.put('/notifications/read-all')),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      clearBadge(); // clear store badge count
    },
  });

  const markOne = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`).catch(() => api.put(`/notifications/${id}/read`)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unreadCount = useMemo(() => all.filter(n => !n.isRead).length, [all]);

  // Sync unread count to store (for tab badge)
  useEffect(() => {
    setUnreadCount(unreadCount);
  }, [unreadCount]); // eslint-disable-line

  // Types that actually appear in data
  const presentTypes = useMemo(() => {
    const set = new Set(all.map(n => n.type));
    return Object.entries(TYPE_CFG).filter(([k]) => set.has(k)).map(([k, v]) => ({ key: k, ...v }));
  }, [all]);

  // Filtered list
  const filtered = useMemo(() => all.filter(n => {
    if (unreadOnly && n.isRead) return false;
    if (typeFilter && n.type !== typeFilter) return false;
    return true;
  }), [all, unreadOnly, typeFilter]);

  // Date-grouped
  const grouped = useMemo(() => {
    const map: Record<string, Notification[]> = {};
    filtered.forEach(notif => {
      const key = dateLabel(notif.createdAt);
      if (!map[key]) map[key] = [];
      map[key].push(notif);
    });
    return map;
  }, [filtered]);

  // Build flat list with date-header items
  const listData = useMemo(() => {
    const items: ({ type: 'header'; label: string } | { type: 'notif'; notif: Notification })[] = [];
    Object.entries(grouped).forEach(([label, notifs]) => {
      items.push({ type: 'header', label });
      notifs.forEach(notif => items.push({ type: 'notif', notif }));
    });
    return items;
  }, [grouped]);

  return (
    <SafeAreaView style={n.container} edges={['top']}>
      {/* Header */}
      <View style={n.header}>
        <View>
          <Text style={n.title}>Notifications</Text>
          <Text style={n.subtitle}>
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
            {all.length > 0 ? ` · ${all.length} total` : ''}
          </Text>
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={() => markAll.mutate()} disabled={markAll.isPending}>
            {markAll.isPending
              ? <ActivityIndicator size="small" color="#6366f1" />
              : <Text style={n.markAll}>Mark all read</Text>}
          </TouchableOpacity>
        )}
      </View>

      {/* Filter bar */}
      <View style={n.filterOuter}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={n.filterRow}>
          {/* Unread toggle */}
          <TouchableOpacity
            style={[n.chip, unreadOnly && n.chipActive]}
            onPress={() => setUnreadOnly(v => !v)}
          >
            <Ionicons name="notifications-outline" size={12} color={unreadOnly ? '#fff' : '#6b7280'} />
            <Text style={[n.chipTxt, unreadOnly && n.chipTxtActive]}>
              Unread{unreadCount > 0 ? ` (${unreadCount})` : ''}
            </Text>
          </TouchableOpacity>

          <View style={n.separator} />

          {/* All types button */}
          <TouchableOpacity
            style={[n.chip, !typeFilter && n.chipDark]}
            onPress={() => setTypeFilter('')}
          >
            <Text style={[n.chipTxt, !typeFilter && n.chipTxtDark]}>All</Text>
          </TouchableOpacity>

          {/* Per-type chips */}
          {presentTypes.map(t => {
            const count = all.filter(nn => nn.type === t.key).length;
            const active = typeFilter === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                style={[n.chip, active && { backgroundColor: t.color + '25', borderColor: t.color }]}
                onPress={() => setTypeFilter(typeFilter === t.key ? '' : t.key)}
              >
                <Text style={[n.chipTxt, active && { color: t.color }]}>
                  {t.label} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item, i) => item.type === 'header' ? `h-${item.label}` : item.notif.id}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#6366f1" />}
          contentContainerStyle={{ paddingBottom: 80 + insets.bottom }}
          renderItem={({ item }) => {
            if (item.type === 'header') {
              return <Text style={n.dateLabel}>{item.label}</Text>;
            }
            return (
              <NotifRow
                notif={item.notif}
                onMarkRead={() => markOne.mutate(item.notif.id)}
                router={router}
              />
            );
          }}
          ListEmptyComponent={
            <View style={n.empty}>
              <Ionicons name="notifications-off-outline" size={48} color="#d1d5db" />
              <Text style={n.emptyTitle}>
                {unreadOnly || typeFilter ? 'No matching notifications' : 'No notifications'}
              </Text>
              {(unreadOnly || typeFilter) && (
                <TouchableOpacity onPress={() => { setUnreadOnly(false); setTypeFilter(''); }}>
                  <Text style={n.clearFilters}>Clear filters</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const n = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#f8fafc' },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  title:         { fontSize: 22, fontWeight: '700', color: '#1e293b' },
  subtitle:      { fontSize: 12, color: '#94a3b8', marginTop: 1 },
  markAll:       { fontSize: 13, fontWeight: '600', color: '#6366f1' },
  filterOuter:   { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  filterRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  separator:     { width: 1, height: 16, backgroundColor: '#e2e8f0', marginHorizontal: 2 },
  chip:          { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: 'transparent' },
  chipActive:    { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  chipDark:      { backgroundColor: '#1e293b', borderColor: '#1e293b' },
  chipTxt:       { fontSize: 11, fontWeight: '600', color: '#6b7280' },
  chipTxtActive: { color: '#fff' },
  chipTxtDark:   { color: '#fff' },
  dateLabel:     { fontSize: 11, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 14, paddingVertical: 8, paddingTop: 14 },
  row:           { flexDirection: 'row', alignItems: 'flex-start', padding: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', gap: 12 },
  rowUnread:     { backgroundColor: '#f5f3ff' },
  iconCircle:    { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginTop: 2, flexShrink: 0 },
  rowContent:    { flex: 1 },
  rowTop:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 },
  rowTitle:      { fontSize: 14, color: '#1e293b', flex: 1 },
  rowTitleBold:  { fontWeight: '700' },
  rowTime:       { fontSize: 10, color: '#94a3b8', flexShrink: 0 },
  rowBody:       { fontSize: 13, color: '#64748b', marginTop: 3, lineHeight: 18 },
  rowFooter:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  typePill:      { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  typePillTxt:   { fontSize: 10, fontWeight: '700' },
  readTxt:       { fontSize: 10, color: '#94a3b8' },
  unreadDot:     { width: 8, height: 8, borderRadius: 4, marginTop: 6, flexShrink: 0 },
  empty:         { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle:    { fontSize: 15, color: '#94a3b8', marginTop: 12 },
  clearFilters:  { fontSize: 13, color: '#6366f1', fontWeight: '600', marginTop: 4 },
});

