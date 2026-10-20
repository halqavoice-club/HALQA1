/**
 * HALQA Mobile — Notes
 * Create, edit, delete, and search personal/shared notes.
 */
import KeyboardAvoidingView from '@/components/KeyboardAvoidingView';
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Modal,
  Platform, Switch, ScrollView} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { showMessage } from 'react-native-flash-message';
import { format } from 'date-fns';
import api from '@/lib/api';

interface Note {
  id: string;
  title: string;
  content: string;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Note Card ────────────────────────────────────────────────────────────────
function NoteCard({ note, onEdit, onDelete }: {
  note: Note;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const dateStr = (() => {
    try { return format(new Date(note.createdAt), 'MMM d, yyyy'); } catch { return ''; }
  })();

  return (
    <View style={nc.card}>
      <View style={nc.cardHeader}>
        <Text style={nc.title} numberOfLines={1}>{note.title}</Text>
        <View style={nc.actions}>
          <TouchableOpacity style={nc.actionBtn} onPress={onEdit}>
            <Ionicons name="create-outline" size={16} color="#6b7280" />
          </TouchableOpacity>
          <TouchableOpacity style={nc.actionBtn} onPress={onDelete}>
            <Ionicons name="trash-outline" size={16} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>
      <Text style={nc.content} numberOfLines={4}>{note.content}</Text>
      <View style={nc.cardFooter}>
        <Text style={nc.date}>{dateStr}</Text>
        <View style={[nc.badge, note.isPrivate ? nc.badgePrivate : nc.badgeShared]}>
          <Ionicons name={note.isPrivate ? 'lock-closed' : 'earth'} size={10} color={note.isPrivate ? '#7c3aed' : '#0891b2'} />
          <Text style={[nc.badgeTxt, { color: note.isPrivate ? '#7c3aed' : '#0891b2' }]}>
            {note.isPrivate ? 'Private' : 'Shared'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const nc = StyleSheet.create({
  card:        { backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#f1f5f9', borderTopWidth: 3, borderTopColor: '#fbbf24' },
  cardHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title:       { fontSize: 15, fontWeight: '700', color: '#1e293b', flex: 1, marginRight: 8 },
  actions:     { flexDirection: 'row', gap: 4 },
  actionBtn:   { width: 28, height: 28, borderRadius: 8, backgroundColor: '#f9fafb', justifyContent: 'center', alignItems: 'center' },
  content:     { fontSize: 13, color: '#64748b', lineHeight: 20 },
  cardFooter:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  date:        { fontSize: 11, color: '#94a3b8' },
  badge:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  badgePrivate:{ backgroundColor: '#f5f3ff' },
  badgeShared: { backgroundColor: '#ecfeff' },
  badgeTxt:    { fontSize: 10, fontWeight: '700' },
});

// ─── Note Form Modal ──────────────────────────────────────────────────────────
function NoteFormModal({ visible, initial, onSave, onClose, saving }: {
  visible: boolean;
  initial: { title: string; content: string; isPrivate: boolean } | null;
  onSave: (data: { title: string; content: string; isPrivate: boolean }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [title,     setTitle]     = useState(initial?.title     ?? '');
  const [content,   setContent]   = useState(initial?.content   ?? '');
  const [isPrivate, setIsPrivate] = useState(initial?.isPrivate ?? false);

  // Sync when initial changes (opening modal)
  React.useEffect(() => {
    if (visible) {
      setTitle(initial?.title     ?? '');
      setContent(initial?.content ?? '');
      setIsPrivate(initial?.isPrivate ?? false);
    }
  }, [visible, initial]);

  const canSave = title.trim().length > 0 && content.trim().length > 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={nf.backdrop} activeOpacity={1} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={nf.sheet}>
        <View style={nf.handle} />
        <Text style={nf.sheetTitle}>{initial ? 'Edit Note' : 'New Note'}</Text>

        <Text style={nf.fieldLabel}>Title</Text>
        <TextInput
          style={nf.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Note title…"
          placeholderTextColor="#9ca3af"
          allowFontScaling={false}
          maxLength={200}
          autoFocus={!initial}
        />

        <Text style={nf.fieldLabel}>Content</Text>
        <TextInput
          style={[nf.input, nf.inputMulti]}
          value={content}
          onChangeText={setContent}
          placeholder="Write your note here…"
          placeholderTextColor="#9ca3af"
          multiline
          allowFontScaling={false}
          maxLength={5000}
          textAlignVertical="top"
        />

        <View style={nf.privacyRow}>
          <View style={{ flex: 1 }}>
            <Text style={nf.privacyLabel}>{isPrivate ? '🔒 Private — only you' : '🌐 Shared with class'}</Text>
            <Text style={nf.privacySub}>Toggle to change visibility</Text>
          </View>
          <Switch
            value={isPrivate}
            onValueChange={setIsPrivate}
            trackColor={{ true: '#7c3aed', false: '#e2e8f0' }}
            thumbColor="#fff"
          />
        </View>

        <View style={nf.btnRow}>
          <TouchableOpacity style={nf.cancelBtn} onPress={onClose} disabled={saving}>
            <Text style={nf.cancelTxt}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[nf.saveBtn, (!canSave || saving) && nf.saveBtnDisabled]}
            onPress={() => onSave({ title: title.trim(), content: content.trim(), isPrivate })}
            disabled={!canSave || saving}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={nf.saveTxt}>{initial ? 'Update' : 'Save Note'}</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const nf = StyleSheet.create({
  backdrop:       { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet:          { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, maxHeight: '90%' },
  handle:         { width: 40, height: 4, backgroundColor: '#e2e8f0', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetTitle:     { fontSize: 18, fontWeight: '800', color: '#1e293b', marginBottom: 16 },
  fieldLabel:     { fontSize: 12, fontWeight: '700', color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  input:          { backgroundColor: '#f8fafc', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: '#1e293b', marginBottom: 12 },
  inputMulti:     { height: 140, textAlignVertical: 'top', paddingTop: 10 },
  privacyRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f8fafc', borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  privacyLabel:   { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  privacySub:     { fontSize: 11, color: '#94a3b8', marginTop: 1 },
  btnRow:         { flexDirection: 'row', gap: 10 },
  cancelBtn:      { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  cancelTxt:      { color: '#64748b', fontWeight: '700', fontSize: 14 },
  saveBtn:        { flex: 2, backgroundColor: '#fbbf24', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  saveBtnDisabled:{ backgroundColor: '#fde68a' },
  saveTxt:        { color: '#fff', fontWeight: '800', fontSize: 14 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function NotesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [search,     setSearch]     = useState('');
  const [showForm,   setShowForm]   = useState(false);
  const [editNote,   setEditNote]   = useState<Note | null>(null);

  const { data: notes = [], isLoading, refetch } = useQuery<Note[]>({
    queryKey: ['notes'],
    queryFn: () => api.get('/notes', { params: { limit: 100 } }).then(r => {
      const raw = r.data.data;
      return Array.isArray(raw) ? raw : raw?.items ?? [];
    }),
    staleTime: 2 * 60_000,
  });

  const createMutation = useMutation({
    mutationFn: (d: any) => editNote
      ? api.put(`/notes/${editNote.id}`, d)
      : api.post('/notes', d),
    onSuccess: () => {
      showMessage({ message: editNote ? 'Note updated' : 'Note saved', type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      setShowForm(false);
      setEditNote(null);
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/notes/${id}`),
    onSuccess: () => {
      showMessage({ message: 'Note deleted', type: 'info' });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }),
  });

  const handleDelete = useCallback((note: Note) => {
    Alert.alert('Delete Note', `Delete "${note.title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(note.id) },
    ]);
  }, [deleteMutation]);

  const filtered = search.trim()
    ? notes.filter(n =>
        n.title.toLowerCase().includes(search.toLowerCase()) ||
        n.content.toLowerCase().includes(search.toLowerCase())
      )
    : notes;

  return (
    <>
      <Stack.Screen options={{
        headerShown: true, title: 'Notes',
        headerTintColor: '#92400e',
        headerStyle: { backgroundColor: '#fff' },
        headerTitleStyle: { color: '#1e293b', fontWeight: '800' },
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
            <Ionicons name="arrow-back" size={22} color="#92400e" />
          </TouchableOpacity>
        ),
        headerRight: () => (
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fef3c7', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, marginRight: 4 }}
            onPress={() => { setEditNote(null); setShowForm(true); }}
          >
            <Ionicons name="add" size={16} color="#92400e" />
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#92400e' }}>New</Text>
          </TouchableOpacity>
        ),
      }} />
      <SafeAreaView style={s.container} edges={['bottom']}>
        {/* Search */}
        <View style={s.searchRow}>
          <Ionicons name="search-outline" size={16} color="#9ca3af" />
          <TextInput
            value={search} onChangeText={setSearch}
            placeholder="Search notes…" placeholderTextColor="#9ca3af"
            style={s.searchInput} allowFontScaling={false}
          />
          {search ? <TouchableOpacity onPress={() => setSearch('')}><Ionicons name="close-circle" size={16} color="#9ca3af" /></TouchableOpacity> : null}
        </View>

        {isLoading ? (
          <View style={s.center}><ActivityIndicator size="large" color="#fbbf24" /></View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={n => n.id}
            numColumns={2}
            columnWrapperStyle={{ gap: 10 }}
            contentContainerStyle={{ padding: 12, paddingBottom: 40 + insets.bottom, gap: 0 }}
            onRefresh={refetch}
            refreshing={false}
            renderItem={({ item }) => (
              <View style={{ flex: 1 }}>
                <NoteCard
                  note={item}
                  onEdit={() => { setEditNote(item); setShowForm(true); }}
                  onDelete={() => handleDelete(item)}
                />
              </View>
            )}
            ListEmptyComponent={
              <View style={s.empty}>
                <Text style={{ fontSize: 40 }}>📝</Text>
                <Text style={s.emptyTitle}>
                  {search ? 'No matching notes' : 'No notes yet'}
                </Text>
                <Text style={s.emptySub}>
                  {search ? 'Try a different search term' : 'Tap "+ New" to create your first note'}
                </Text>
              </View>
            }
          />
        )}

        <NoteFormModal
          visible={showForm}
          initial={editNote ? { title: editNote.title, content: editNote.content, isPrivate: editNote.isPrivate } : null}
          onSave={data => createMutation.mutate(data)}
          onClose={() => { setShowForm(false); setEditNote(null); }}
          saving={createMutation.isPending}
        />
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#fffbeb' },
  searchRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 9 },
  searchInput: { flex: 1, fontSize: 14, color: '#1e293b' },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  empty:       { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle:  { fontSize: 16, fontWeight: '700', color: '#374151', marginTop: 8 },
  emptySub:    { fontSize: 13, color: '#94a3b8', textAlign: 'center', paddingHorizontal: 24 },
});





