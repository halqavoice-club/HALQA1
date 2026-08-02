/**
 * HALQA Mobile — Schedule / Calendar Screen
 * Shows class schedule and upcoming calendar events.
 */
import React from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView, ActivityIndicator, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import api from '@/lib/api';

type CalendarEvent = {
  id: string; title: string; type: string; startDate: string;
  endDate?: string; allDay: boolean; location?: string; description?: string;
};

const EVENT_COLORS: Record<string, string> = {
  EXAM: '#ef4444', ASSIGNMENT: '#f59e0b', HOLIDAY: '#10b981',
  MEETING: '#6366f1', CLASS: '#0ea5e9', PRAYER: '#8b5cf6',
  ACTIVITY: '#ec4899', OTHER: '#64748b',
};

export default function ScheduleScreen() {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['calendar-events'],
    queryFn:  async () => {
      const now   = new Date();
      const end   = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const res   = await api.get('/calendar', {
        params: { startDate: now.toISOString(), endDate: end.toISOString(), limit: 50 }
      });
      const raw = res.data.data;
      return (Array.isArray(raw) ? raw : raw?.items ?? []) as CalendarEvent[];
    },
    staleTime: 5 * 60 * 1000
  });

  const events = data || [];

  // Group by date
  const grouped = React.useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach(e => {
      const day = e.startDate.slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(e);
    });
    return Array.from(map.entries()).map(([date, items]) => ({ date, items }));
  }, [events]);

  const renderGroup = ({ item }: { item: { date: string; items: CalendarEvent[] } }) => (
    <View style={styles.group}>
      <Text style={styles.dateHeader}>
        {new Date(item.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
      </Text>
      {item.items.map(ev => {
        const color = EVENT_COLORS[ev.type] || EVENT_COLORS.OTHER;
        return (
          <View key={ev.id} style={[styles.eventCard, { borderLeftColor: color }]}>
            <View style={styles.eventLeft}>
              <Text style={[styles.eventType, { color }]}>{ev.type}</Text>
              <Text style={styles.eventTitle}>{ev.title}</Text>
              {ev.location && <Text style={styles.eventMeta}>📍 {ev.location}</Text>}
            </View>
            {!ev.allDay && (
              <Text style={styles.eventTime}>
                {new Date(ev.startDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {isLoading ? (
        <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={g => g.date}
          renderItem={renderGroup}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={48} color="#d1d5db" />
              <Text style={styles.emptyText}>No upcoming events</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#f8fafc' },
  list:        { padding: 12 },
  group:       { marginBottom: 16 },
  dateHeader:  { fontSize: 13, fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginLeft: 4 },
  eventCard:   { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 6, borderLeftWidth: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  eventLeft:   { flex: 1 },
  eventType:   { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  eventTitle:  { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  eventMeta:   { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  eventTime:   { fontSize: 13, fontWeight: '600', color: '#64748b', marginLeft: 8 },
  empty:       { alignItems: 'center', padding: 60 },
  emptyText:   { fontSize: 15, color: '#94a3b8', marginTop: 12 },
});
