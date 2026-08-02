/**
 * HALQA Mobile — Calendar
 * Month grid view, event type filters, upcoming list,
 * selected-day events. Teachers/Admins can create/delete events.
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ScrollView, ActivityIndicator, Modal,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, isToday, addMonths, subMonths, parseISO,
} from 'date-fns';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

const EVENT_TYPES = ['EXAM','ASSIGNMENT','HOLIDAY','MEETING','CLASS','PRAYER','ACTIVITY','OTHER'];

const TYPE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  EXAM:       { bg: '#fef2f2', text: '#dc2626', dot: '#ef4444' },
  ASSIGNMENT: { bg: '#eff6ff', text: '#1d4ed8', dot: '#3b82f6' },
  HOLIDAY:    { bg: '#f0fdf4', text: '#15803d', dot: '#22c55e' },
  MEETING:    { bg: '#faf5ff', text: '#7e22ce', dot: '#a855f7' },
  CLASS:      { bg: '#ede9fe', text: '#4f46e5', dot: '#6366f1' },
  PRAYER:     { bg: '#fefce8', text: '#a16207', dot: '#eab308' },
  ACTIVITY:   { bg: '#fff7ed', text: '#c2410c', dot: '#f97316' },
  OTHER:      { bg: '#f8fafc', text: '#475569', dot: '#94a3b8' },
};

const DAYS_OF_WEEK = ['S','M','T','W','T','F','S'];

export default function CalendarScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const canCreate = ['SUPER_ADMIN','SCHOOL_ADMIN','TEACHER'].includes(user?.role ?? '');

  const [month, setMonth]             = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [typeFilter, setTypeFilter]   = useState('');
  const [showCreate, setShowCreate]   = useState(false);
  const [form, setForm]               = useState({
    title: '', type: 'CLASS', startDate: '', endDate: '', description: '',
  });

  const monthStart = startOfMonth(month);
  const monthEnd   = endOfMonth(month);

  const { data: events = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ['calendar', format(monthStart, 'yyyy-MM')],
    queryFn: () => api.get('/calendar', {
      params: { startDate: monthStart.toISOString(), endDate: monthEnd.toISOString() }
    }).then(r => r.data.data ?? []),
  });

  const createMutation = useMutation({
    mutationFn: (d: typeof form) => api.post('/calendar', d),
    onSuccess: () => {
      showMessage({ message: 'Event created', type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      setShowCreate(false);
      setForm({ title: '', type: 'CLASS', startDate: '', endDate: '', description: '' });
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/calendar/${id}`),
    onSuccess: () => {
      showMessage({ message: 'Event deleted', type: 'info' });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }),
  });

  const filtered = useMemo(
    () => typeFilter ? events.filter(e => e.type === typeFilter) : events,
    [events, typeFilter]
  );

  const getDayEvents = useCallback(
    (day: Date) => filtered.filter(e => isSameDay(parseISO(e.startDate), day)),
    [filtered]
  );

  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startPad = monthStart.getDay(); // blank cells before first day

  const selectedEvents = selectedDay ? getDayEvents(selectedDay) : [];
  const upcoming = useMemo(() =>
    filtered
      .filter(e => new Date(e.startDate) >= new Date())
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
      .slice(0, 8),
    [filtered]
  );

  const listData = selectedDay ? selectedEvents : upcoming;

  return (
    <>
      <Stack.Screen options={{
        headerShown: true, title: 'Calendar',
        headerTintColor: '#4f46e5',
        headerStyle: { backgroundColor: '#fff' },
        headerTitleStyle: { color: '#111827', fontWeight: '900' },
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
            <Ionicons name="arrow-back" size={22} color="#4f46e5" />
          </TouchableOpacity>
        ),
        headerRight: canCreate ? () => (
          <TouchableOpacity onPress={() => setShowCreate(true)} style={{ padding: 4 }}>
            <Ionicons name="add-circle" size={26} color="#4f46e5" />
          </TouchableOpacity>
        ) : undefined,
      }} />
      <SafeAreaView style={cal.container} edges={['bottom']}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>

          {/* Month nav */}
          <View style={cal.monthNav}>
            <TouchableOpacity onPress={() => setMonth(m => subMonths(m, 1))} style={cal.navBtn}>
              <Ionicons name="chevron-back" size={20} color="#4f46e5" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setMonth(new Date())} style={cal.monthTitle}>
              <Text style={cal.monthTxt}>{format(month, 'MMMM yyyy')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setMonth(m => addMonths(m, 1))} style={cal.navBtn}>
              <Ionicons name="chevron-forward" size={20} color="#4f46e5" />
            </TouchableOpacity>
          </View>

          {/* Day-of-week headers */}
          <View style={cal.grid}>
            {DAYS_OF_WEEK.map((d, i) => (
              <View key={i} style={cal.dowCell}>
                <Text style={cal.dowTxt}>{d}</Text>
              </View>
            ))}
          </View>

          {/* Calendar days */}
          {isLoading ? (
            <ActivityIndicator size="large" color="#4f46e5" style={{ margin: 32 }} />
          ) : (
            <View style={cal.grid}>
              {/* Leading blank cells */}
              {Array.from({ length: startPad }).map((_, i) => (
                <View key={`pad-${i}`} style={cal.cell} />
              ))}
              {days.map(day => {
                const dayEvts = getDayEvents(day);
                const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
                const today = isToday(day);
                return (
                  <TouchableOpacity
                    key={day.toISOString()}
                    style={[cal.cell, isSelected && cal.cellSelected, today && !isSelected && cal.cellToday]}
                    onPress={() => setSelectedDay(isSelected ? null : day)}
                    activeOpacity={0.7}
                  >
                    <Text style={[cal.dayNum, today && cal.dayNumToday, isSelected && cal.dayNumSelected]}>
                      {format(day, 'd')}
                    </Text>
                    {/* Event dots (max 3) */}
                    <View style={cal.dotRow}>
                      {dayEvts.slice(0, 3).map((e, i) => (
                        <View key={i} style={[cal.dot, { backgroundColor: (TYPE_COLORS[e.type] ?? TYPE_COLORS.OTHER).dot }]} />
                      ))}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Type filter chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={cal.filterRow}>
            <TouchableOpacity
              style={[cal.filterChip, !typeFilter && cal.filterChipActive]}
              onPress={() => setTypeFilter('')}
            >
              <Text style={[cal.filterChipTxt, !typeFilter && cal.filterChipTxtActive]}>All</Text>
            </TouchableOpacity>
            {EVENT_TYPES.map(t => {
              const active = typeFilter === t;
              const col = TYPE_COLORS[t] ?? TYPE_COLORS.OTHER;
              return (
                <TouchableOpacity
                  key={t}
                  style={[cal.filterChip, active && { backgroundColor: col.bg, borderColor: col.dot }]}
                  onPress={() => setTypeFilter(typeFilter === t ? '' : t)}
                >
                  <View style={[cal.filterDot, { backgroundColor: col.dot }]} />
                  <Text style={[cal.filterChipTxt, active && { color: col.text }]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Event list */}
          <View style={cal.sectionHeader}>
            <Ionicons name="calendar-outline" size={14} color="#6b7280" />
            <Text style={cal.sectionTitle}>
              {selectedDay ? format(selectedDay, 'MMMM d, yyyy') : 'Upcoming Events'}
            </Text>
            {selectedDay && (
              <TouchableOpacity onPress={() => setSelectedDay(null)}>
                <Text style={cal.clearDay}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>

          {listData.length === 0 ? (
            <View style={cal.empty}>
              <Ionicons name="calendar-outline" size={36} color="#d1d5db" />
              <Text style={cal.emptyTxt}>{selectedDay ? 'No events this day' : 'No upcoming events'}</Text>
            </View>
          ) : (
            listData.map(event => {
              const col = TYPE_COLORS[event.type] ?? TYPE_COLORS.OTHER;
              const start = event.startDate ? parseISO(event.startDate) : null;
              return (
                <View key={event.id} style={[cal.eventCard, { borderLeftColor: col.dot }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={cal.eventTitle} numberOfLines={1}>{event.title}</Text>
                    <View style={cal.eventMeta}>
                      <View style={[cal.typePill, { backgroundColor: col.bg }]}>
                        <Text style={[cal.typePillTxt, { color: col.text }]}>{event.type}</Text>
                      </View>
                      {start && <Text style={cal.eventDate}>{format(start, 'MMM d · h:mm a')}</Text>}
                    </View>
                    {event.description ? (
                      <Text style={cal.eventDesc} numberOfLines={2}>{event.description}</Text>
                    ) : null}
                  </View>
                  {canCreate && (
                    <TouchableOpacity
                      style={cal.deleteBtn}
                      onPress={() => Alert.alert('Delete Event', `Delete "${event.title}"?`, [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(event.id) },
                      ])}
                    >
                      <Ionicons name="trash-outline" size={15} color="#ef4444" />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>

        {/* Create event modal */}
        {canCreate && (
          <Modal visible={showCreate} transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
            <TouchableOpacity style={cal.modalBackdrop} activeOpacity={1} onPress={() => setShowCreate(false)} />
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={cal.modalSheet}>
              <View style={cal.modalHandle} />
              <Text style={cal.modalTitle}>Create Event</Text>

              <Text style={cal.fieldLabel}>Title *</Text>
              <TextInput style={cal.input} value={form.title} onChangeText={v => setForm(f => ({ ...f, title: v }))} placeholder="Event title" placeholderTextColor="#9ca3af" />

              <Text style={cal.fieldLabel}>Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {EVENT_TYPES.map(t => {
                    const active = form.type === t;
                    const col = TYPE_COLORS[t] ?? TYPE_COLORS.OTHER;
                    return (
                      <TouchableOpacity
                        key={t}
                        style={[cal.filterChip, active && { backgroundColor: col.bg, borderColor: col.dot }]}
                        onPress={() => setForm(f => ({ ...f, type: t }))}
                      >
                        <Text style={[cal.filterChipTxt, active && { color: col.text, fontWeight: '700' }]}>{t}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              <Text style={cal.fieldLabel}>Start Date/Time *</Text>
              <TextInput style={cal.input} value={form.startDate} onChangeText={v => setForm(f => ({ ...f, startDate: v }))} placeholder="YYYY-MM-DDTHH:MM" placeholderTextColor="#9ca3af" />

              <Text style={cal.fieldLabel}>End Date/Time</Text>
              <TextInput style={cal.input} value={form.endDate} onChangeText={v => setForm(f => ({ ...f, endDate: v }))} placeholder="Optional" placeholderTextColor="#9ca3af" />

              <Text style={cal.fieldLabel}>Description</Text>
              <TextInput style={[cal.input, { height: 72, textAlignVertical: 'top' }]} value={form.description} onChangeText={v => setForm(f => ({ ...f, description: v }))} placeholder="Optional description…" placeholderTextColor="#9ca3af" multiline />

              <View style={cal.modalBtns}>
                <TouchableOpacity style={cal.cancelBtn} onPress={() => setShowCreate(false)}>
                  <Text style={cal.cancelTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[cal.createBtn, (!form.title || !form.startDate) && cal.createBtnDisabled]}
                  onPress={() => createMutation.mutate(form)}
                  disabled={!form.title || !form.startDate || createMutation.isPending}
                >
                  {createMutation.isPending
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={cal.createTxt}>Create</Text>}
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        )}
      </SafeAreaView>
    </>
  );
}

const CELL_SIZE = 46;

const cal = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#f8fafc' },
  monthNav:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  navBtn:           { width: 34, height: 34, borderRadius: 17, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center' },
  monthTitle:       { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 12, backgroundColor: '#ede9fe' },
  monthTxt:         { fontSize: 16, fontWeight: '800', color: '#4f46e5' },
  grid:             { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10 },
  dowCell:          { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 4 },
  dowTxt:           { fontSize: 11, fontWeight: '700', color: '#94a3b8' },
  cell:             { width: `${100 / 7}%`, height: CELL_SIZE, alignItems: 'center', paddingTop: 5, borderRadius: 10 },
  cellToday:        { backgroundColor: '#ede9fe' },
  cellSelected:     { backgroundColor: '#4f46e5' },
  dayNum:           { fontSize: 13, fontWeight: '600', color: '#374151' },
  dayNumToday:      { color: '#4f46e5', fontWeight: '800' },
  dayNumSelected:   { color: '#fff', fontWeight: '900' },
  dotRow:           { flexDirection: 'row', gap: 2, marginTop: 2 },
  dot:              { width: 5, height: 5, borderRadius: 3 },
  filterRow:        { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  filterChip:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: 'transparent' },
  filterChipActive: { backgroundColor: '#ede9fe', borderColor: '#4f46e5' },
  filterChipTxt:    { fontSize: 11, fontWeight: '600', color: '#6b7280' },
  filterChipTxtActive: { color: '#4f46e5', fontWeight: '700' },
  filterDot:        { width: 7, height: 7, borderRadius: 4 },
  sectionHeader:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  sectionTitle:     { flex: 1, fontSize: 13, fontWeight: '700', color: '#374151' },
  clearDay:         { fontSize: 12, color: '#4f46e5', fontWeight: '600' },
  eventCard:        { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#fff', borderRadius: 12, marginHorizontal: 12, marginBottom: 6, padding: 12, borderLeftWidth: 3, borderWidth: 1, borderColor: '#f1f5f9' },
  eventTitle:       { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  eventMeta:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  typePill:         { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  typePillTxt:      { fontSize: 10, fontWeight: '700' },
  eventDate:        { fontSize: 11, color: '#94a3b8' },
  eventDesc:        { fontSize: 12, color: '#64748b', marginTop: 4, lineHeight: 16 },
  deleteBtn:        { width: 28, height: 28, borderRadius: 8, backgroundColor: '#fef2f2', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  empty:            { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyTxt:         { fontSize: 14, color: '#94a3b8' },
  // Create modal
  modalBackdrop:    { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet:       { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, maxHeight: '90%' },
  modalHandle:      { width: 40, height: 4, backgroundColor: '#e2e8f0', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitle:       { fontSize: 18, fontWeight: '800', color: '#1e293b', marginBottom: 16 },
  fieldLabel:       { fontSize: 12, fontWeight: '700', color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  input:            { backgroundColor: '#f8fafc', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#1e293b', marginBottom: 12 },
  modalBtns:        { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn:        { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  cancelTxt:        { color: '#64748b', fontWeight: '700', fontSize: 14 },
  createBtn:        { flex: 2, backgroundColor: '#4f46e5', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  createBtnDisabled:{ backgroundColor: '#c7d2fe' },
  createTxt:        { color: '#fff', fontWeight: '800', fontSize: 14 },
});
