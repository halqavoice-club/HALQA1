/**
 * HALQA Mobile — Library Screen
 * Students: see their issued books with due dates and overdue warnings.
 * Teachers/Admins: browse book catalog, search, issue to students, mark returns.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl, Modal,
  Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { showMessage } from 'react-native-flash-message';
import { format } from 'date-fns';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

const STATUS_CFG: Record<string, { color: string; bg: string }> = {
  ISSUED:   { color: '#6366f1', bg: '#e0e7ff' },
  RETURNED: { color: '#10b981', bg: '#d1fae5' },
  OVERDUE:  { color: '#ef4444', bg: '#fee2e2' },
  LOST:     { color: '#ef4444', bg: '#fee2e2' },
};

// ─── Student View ─────────────────────────────────────────────────────────────
function StudentView() {
  const insets = useSafeAreaInsets();
  const { data = [], isLoading, refetch, isRefetching } = useQuery<any[]>({
    queryKey: ['library-my-issues'],
    queryFn: () => api.get('/library/issues', { params: { limit: 50 } }).then(r => {
      const raw = r.data.data;
      return Array.isArray(raw) ? raw : raw?.items ?? [];
    }),
    staleTime: 5 * 60_000,
  });

  return (
    <FlatList
      data={data}
      keyExtractor={i => i.id}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#6366f1" />}
      contentContainerStyle={{ padding: 12, paddingBottom: 40 + insets.bottom }}
      ListHeaderComponent={isLoading ? <ActivityIndicator size="large" color="#6366f1" style={{ margin: 32 }} /> : null}
      renderItem={({ item }) => {
        const isOverdue = item.status === 'ISSUED' && new Date(item.dueDate) < new Date();
        const statusKey = isOverdue ? 'OVERDUE' : item.status;
        const cfg = STATUS_CFG[statusKey] ?? STATUS_CFG.ISSUED;
        return (
          <View style={[lb.card, isOverdue && lb.cardOverdue]}>
            <Text style={lb.bookEmoji}>📖</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={lb.bookTitle} numberOfLines={1}>{item.book?.title}</Text>
              {item.book?.author && <Text style={lb.bookMeta}>by {item.book.author}</Text>}
              <Text style={lb.bookMeta}>{item.book?.category}</Text>
              <Text style={[lb.dueDate, isOverdue && { color: '#ef4444', fontWeight: '700' }]}>
                {isOverdue ? '⚠️ Overdue: ' : 'Due: '}
                {item.dueDate ? format(new Date(item.dueDate), 'MMM d, yyyy') : '—'}
              </Text>
            </View>
            <View style={[lb.badge, { backgroundColor: cfg.bg }]}>
              <Text style={[lb.badgeTxt, { color: cfg.color }]}>{statusKey}</Text>
            </View>
          </View>
        );
      }}
      ListEmptyComponent={!isLoading ? (
        <View style={lb.empty}>
          <Ionicons name="library-outline" size={48} color="#d1d5db" />
          <Text style={lb.emptyTxt}>No books issued</Text>
        </View>
      ) : null}
    />
  );
}

// ─── Admin View ───────────────────────────────────────────────────────────────
function AdminView() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'books' | 'issued'>('books');
  const [search, setSearch] = useState('');
  const [issueModal, setIssueModal] = useState<any>(null); // book to issue
  const [studentId, setStudentId] = useState('');
  const [dueDate, setDueDate] = useState('');

  const { data: books = [], isLoading: booksLoading, refetch: refetchBooks } = useQuery<any[]>({
    queryKey: ['library-books', search],
    queryFn: () => api.get('/library/books', {
      params: { search: search || undefined, limit: 50 }
    }).then(r => r.data.data ?? r.data?.data ?? []),
    enabled: tab === 'books',
  });

  const { data: issues = [], isLoading: issuesLoading, refetch: refetchIssues } = useQuery<any[]>({
    queryKey: ['library-all-issues'],
    queryFn: () => api.get('/library/issues', { params: { limit: 100 } }).then(r => {
      const raw = r.data.data;
      return Array.isArray(raw) ? raw : raw?.items ?? [];
    }),
    enabled: tab === 'issued',
  });

  const issueMutation = useMutation({
    mutationFn: ({ bookId, data }: any) => api.post(`/library/books/${bookId}/issue`, data),
    onSuccess: () => {
      showMessage({ message: 'Book issued successfully', type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['library-books'] });
      queryClient.invalidateQueries({ queryKey: ['library-all-issues'] });
      setIssueModal(null); setStudentId(''); setDueDate('');
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }),
  });

  const returnMutation = useMutation({
    mutationFn: (issueId: string) => api.put(`/library/issues/${issueId}/return`),
    onSuccess: () => {
      showMessage({ message: 'Book returned', type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['library-all-issues'] });
      queryClient.invalidateQueries({ queryKey: ['library-books'] });
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message ?? 'Failed', type: 'danger' }),
  });

  return (
    <View style={{ flex: 1 }}>
      {/* Tabs */}
      <View style={lb.tabBar}>
        <TouchableOpacity style={[lb.tabBtn, tab === 'books' && lb.tabBtnActive]} onPress={() => setTab('books')}>
          <Text style={[lb.tabTxt, tab === 'books' && lb.tabTxtActive]}>📚 Catalog</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[lb.tabBtn, tab === 'issued' && lb.tabBtnActive]} onPress={() => setTab('issued')}>
          <Text style={[lb.tabTxt, tab === 'issued' && lb.tabTxtActive]}>📋 Issued</Text>
        </TouchableOpacity>
      </View>

      {tab === 'books' && (
        <>
          <View style={lb.searchRow}>
            <Ionicons name="search-outline" size={15} color="#9ca3af" />
            <TextInput value={search} onChangeText={setSearch} placeholder="Search books…" placeholderTextColor="#9ca3af" style={lb.searchInput} allowFontScaling={false} />
            {search ? <TouchableOpacity onPress={() => setSearch('')}><Ionicons name="close-circle" size={15} color="#9ca3af" /></TouchableOpacity> : null}
          </View>
          {booksLoading ? (
            <ActivityIndicator size="large" color="#6366f1" style={{ margin: 32 }} />
          ) : (
            <FlatList
              data={books}
              keyExtractor={b => b.id}
              refreshControl={<RefreshControl refreshing={false} onRefresh={refetchBooks} tintColor="#6366f1" />}
              contentContainerStyle={{ padding: 12, paddingBottom: 40 + insets.bottom }}
              renderItem={({ item: book }) => (
                <View style={lb.bookCard}>
                  <View style={lb.bookIconWrap}><Ionicons name="book-outline" size={22} color="#6366f1" /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={lb.bookTitle} numberOfLines={1}>{book.title}</Text>
                    {book.author && <Text style={lb.bookMeta}>{book.author}</Text>}
                    <View style={lb.bookRow}>
                      <View style={lb.catBadge}><Text style={lb.catBadgeTxt}>{book.category}</Text></View>
                      <Text style={[lb.bookMeta, { color: book.availableCopies > 0 ? '#10b981' : '#ef4444' }]}>
                        {book.availableCopies > 0 ? `${book.availableCopies} available` : 'All issued'}
                      </Text>
                    </View>
                  </View>
                  {book.availableCopies > 0 && (
                    <TouchableOpacity style={lb.issueBtn} onPress={() => setIssueModal(book)}>
                      <Text style={lb.issueBtnTxt}>Issue</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              ListEmptyComponent={
                <View style={lb.empty}><Ionicons name="library-outline" size={48} color="#d1d5db" /><Text style={lb.emptyTxt}>No books found</Text></View>
              }
            />
          )}
        </>
      )}

      {tab === 'issued' && (
        issuesLoading ? (
          <ActivityIndicator size="large" color="#6366f1" style={{ margin: 32 }} />
        ) : (
          <FlatList
            data={issues}
            keyExtractor={i => i.id}
            refreshControl={<RefreshControl refreshing={false} onRefresh={refetchIssues} tintColor="#6366f1" />}
            contentContainerStyle={{ padding: 12, paddingBottom: 40 + insets.bottom }}
            renderItem={({ item }) => {
              const isOverdue = item.status === 'ISSUED' && new Date(item.dueDate) < new Date();
              const cfg = STATUS_CFG[isOverdue ? 'OVERDUE' : item.status] ?? STATUS_CFG.ISSUED;
              return (
                <View style={[lb.card, isOverdue && lb.cardOverdue]}>
                  <Text style={lb.bookEmoji}>📖</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={lb.bookTitle} numberOfLines={1}>{item.book?.title}</Text>
                    <Text style={lb.bookMeta}>{item.student?.user?.firstName} {item.student?.user?.lastName}</Text>
                    <Text style={[lb.dueDate, isOverdue && { color: '#ef4444', fontWeight: '700' }]}>
                      {isOverdue ? '⚠️ ' : ''}Due: {item.dueDate ? format(new Date(item.dueDate), 'MMM d, yyyy') : '—'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <View style={[lb.badge, { backgroundColor: cfg.bg }]}>
                      <Text style={[lb.badgeTxt, { color: cfg.color }]}>{isOverdue ? 'OVERDUE' : item.status}</Text>
                    </View>
                    {item.status === 'ISSUED' && (
                      <TouchableOpacity style={lb.returnBtn} onPress={() => returnMutation.mutate(item.id)} disabled={returnMutation.isPending}>
                        <Text style={lb.returnBtnTxt}>Return</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={lb.empty}><Ionicons name="library-outline" size={48} color="#d1d5db" /><Text style={lb.emptyTxt}>No issued books</Text></View>
            }
          />
        )
      )}

      {/* Issue Book Modal */}
      <Modal visible={!!issueModal} transparent animationType="slide" onRequestClose={() => setIssueModal(null)}>
        <TouchableOpacity style={lb.modalBackdrop} activeOpacity={1} onPress={() => setIssueModal(null)} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={lb.modalSheet}>
          <View style={lb.modalHandle} />
          <Text style={lb.modalTitle}>Issue: {issueModal?.title}</Text>
          <Text style={lb.fieldLabel}>Student ID *</Text>
          <TextInput style={lb.input} value={studentId} onChangeText={setStudentId} placeholder="Enter student ID" placeholderTextColor="#9ca3af" allowFontScaling={false} />
          <Text style={lb.fieldLabel}>Due Date * (YYYY-MM-DD)</Text>
          <TextInput style={lb.input} value={dueDate} onChangeText={setDueDate} placeholder={format(new Date(Date.now() + 14 * 86400_000), 'yyyy-MM-dd')} placeholderTextColor="#9ca3af" allowFontScaling={false} />
          <View style={lb.modalBtns}>
            <TouchableOpacity style={lb.cancelBtn} onPress={() => setIssueModal(null)}><Text style={lb.cancelTxt}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity
              style={[lb.confirmBtn, (!studentId || !dueDate || issueMutation.isPending) && lb.confirmBtnDisabled]}
              onPress={() => issueMutation.mutate({ bookId: issueModal.id, data: { studentId, dueDate } })}
              disabled={!studentId || !dueDate || issueMutation.isPending}
            >
              {issueMutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={lb.confirmTxt}>Issue Book</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function LibraryScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const isAdmin = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(user?.role ?? '');

  return (
    <>
      <Stack.Screen options={{
        headerShown: true, title: 'Library',
        headerTintColor: '#6366f1',
        headerStyle: { backgroundColor: '#fff' },
        headerTitleStyle: { color: '#111827', fontWeight: '800' },
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
            <Ionicons name="arrow-back" size={22} color="#6366f1" />
          </TouchableOpacity>
        ),
      }} />
      <SafeAreaView style={lb.container} edges={['bottom']}>
        {isAdmin ? <AdminView /> : <StudentView />}
      </SafeAreaView>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const lb = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#f8fafc' },
  tabBar:           { flexDirection: 'row', backgroundColor: '#f1f5f9', margin: 12, borderRadius: 14, padding: 3 },
  tabBtn:           { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 11 },
  tabBtnActive:     { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  tabTxt:           { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  tabTxtActive:     { color: '#1e293b', fontWeight: '700' },
  searchRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginBottom: 8, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 9 },
  searchInput:      { flex: 1, fontSize: 14, color: '#1e293b' },
  card:             { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 8, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#f1f5f9' },
  cardOverdue:      { borderColor: '#fca5a5' },
  bookCard:         { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 8, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#f1f5f9' },
  bookIconWrap:     { width: 42, height: 42, borderRadius: 10, backgroundColor: '#ede9fe', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  bookEmoji:        { fontSize: 26, flexShrink: 0 },
  bookTitle:        { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  bookMeta:         { fontSize: 11, color: '#64748b', marginTop: 1 },
  bookRow:          { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  catBadge:         { backgroundColor: '#e0e7ff', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  catBadgeTxt:      { fontSize: 10, fontWeight: '700', color: '#4f46e5' },
  dueDate:          { fontSize: 12, color: '#64748b', marginTop: 4 },
  badge:            { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  badgeTxt:         { fontSize: 10, fontWeight: '800' },
  issueBtn:         { backgroundColor: '#4f46e5', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  issueBtnTxt:      { color: '#fff', fontSize: 11, fontWeight: '700' },
  returnBtn:        { backgroundColor: '#d1fae5', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: '#6ee7b7' },
  returnBtnTxt:     { color: '#065f46', fontSize: 11, fontWeight: '700' },
  empty:            { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTxt:         { fontSize: 15, color: '#94a3b8', marginTop: 12 },
  // Issue modal
  modalBackdrop:    { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet:       { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  modalHandle:      { width: 40, height: 4, backgroundColor: '#e2e8f0', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitle:       { fontSize: 17, fontWeight: '800', color: '#1e293b', marginBottom: 16 },
  fieldLabel:       { fontSize: 12, fontWeight: '700', color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  input:            { backgroundColor: '#f8fafc', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: '#1e293b', marginBottom: 12 },
  modalBtns:        { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn:        { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  cancelTxt:        { color: '#64748b', fontWeight: '700', fontSize: 14 },
  confirmBtn:       { flex: 2, backgroundColor: '#6366f1', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  confirmBtnDisabled: { backgroundColor: '#c7d2fe' },
  confirmTxt:       { color: '#fff', fontWeight: '800', fontSize: 14 },
});
