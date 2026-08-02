/**
 * HALQA Mobile — Assignments & Exams
 * Students: view + submit work, see grades + feedback
 * Teachers: review queue, grade submissions
 */
import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Modal, ScrollView, ActivityIndicator,
  RefreshControl, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, isPast } from 'date-fns';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

type TabType = 'assignments' | 'exams';
type SubmissionStatus = 'DRAFT' | 'SUBMITTED' | 'REVIEWED' | 'GRADED' | 'REJECTED' | 'LATE';

interface Submission {
  id: string;
  title: string;
  description?: string | null;
  textContent?: string | null;
  answers?: Record<string, string> | null;
  status: SubmissionStatus;
  score?: number | null;
  maxScore?: number | null;
  percentage?: number | null;
  feedback?: string | null;
  isLate?: boolean;
  submittedAt?: string | null;
  gradedAt?: string | null;
  createdAt: string;
  grade?: { id: string; title: string; type: string; dueDate?: string | null; class?: { name: string } } | null;
  student?: { id: string; firstName: string; lastName: string };
}

const STATUS_COLOR: Record<SubmissionStatus, string> = {
  DRAFT:     '#6b7280', SUBMITTED: '#2563eb', REVIEWED:  '#d97706',
  GRADED:    '#16a34a', REJECTED:  '#dc2626', LATE:      '#ea580c',
};
const STATUS_BG: Record<SubmissionStatus, string> = {
  DRAFT:     '#f3f4f6', SUBMITTED: '#dbeafe', REVIEWED:  '#fef3c7',
  GRADED:    '#dcfce7', REJECTED:  '#fee2e2', LATE:      '#ffedd5',
};

function StatusPill({ status }: { status: SubmissionStatus }) {
  return (
    <View style={[styles.pill, { backgroundColor: STATUS_BG[status] }]}>
      <Text style={[styles.pillText, { color: STATUS_COLOR[status] }]}>{status}</Text>
    </View>
  );
}

// ─── Submission row ─────────────────────────────────────────────────────────
function SubRow({ item, isTeacher, onPress }: {
  item: Submission; isTeacher: boolean; onPress: () => void;
}) {
  const dueDate = item.grade?.dueDate;
  const overdue = dueDate && isPast(new Date(dueDate)) && item.status === 'DRAFT';
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1, marginRight: 10 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          {item.grade && (
            <Text style={styles.cardSub} numberOfLines={1}>
              {item.grade.class?.name ?? ''}{item.grade.class?.name ? ' · ' : ''}{item.grade.title}
            </Text>
          )}
          {isTeacher && item.student && (
            <Text style={styles.cardStudent}>
              {item.student.firstName} {item.student.lastName}
            </Text>
          )}
          {dueDate && (
            <Text style={[styles.cardDue, overdue && { color: '#dc2626', fontWeight: '700' }]}>
              Due {format(new Date(dueDate), 'MMM d')}
              {overdue ? ' · OVERDUE' : ''}
            </Text>
          )}
        </View>
        <StatusPill status={item.status} />
      </View>

      {item.status === 'GRADED' && item.score != null && (
        <View style={styles.scoreRow}>
          <Ionicons name="star" size={13} color="#f59e0b" />
          <Text style={styles.scoreText}>{item.score}/{item.maxScore}</Text>
          <Text style={styles.scorePct}>({item.percentage?.toFixed(0)}%)</Text>
        </View>
      )}

      {item.feedback && (
        <View style={styles.feedbackBox}>
          <Text style={styles.feedbackText} numberOfLines={2}>
            📝 {item.feedback}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── View/Detail modal ──────────────────────────────────────────────────────
function ViewModal({ sub, tab, visible, onClose }: {
  sub: Submission | null; tab: TabType; visible: boolean; onClose: () => void;
}) {
  if (!sub) return null;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle} numberOfLines={1}>{sub.title}</Text>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color="#374151" /></TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 16 }}>
          <View style={styles.detailRow}>
            <StatusPill status={sub.status} />
            {sub.isLate && <View style={[styles.pill, { backgroundColor: '#ffedd5' }]}><Text style={[styles.pillText, { color: '#ea580c' }]}>LATE</Text></View>}
          </View>

          {sub.grade && (
            <View style={styles.detailBox}>
              <Text style={styles.detailLabel}>Assignment</Text>
              <Text style={styles.detailValue}>{sub.grade.title}</Text>
              {sub.grade.dueDate && (
                <Text style={styles.detailMeta}>Due: {format(new Date(sub.grade.dueDate), 'MMM d, yyyy')}</Text>
              )}
            </View>
          )}

          {sub.description && (
            <View style={styles.detailBox}>
              <Text style={styles.detailLabel}>Description</Text>
              <Text style={styles.detailValue}>{sub.description}</Text>
            </View>
          )}

          {sub.textContent && (
            <View style={styles.detailBox}>
              <Text style={styles.detailLabel}>Your Answer</Text>
              <Text style={styles.detailValue}>{sub.textContent}</Text>
            </View>
          )}

          {sub.answers && Object.keys(sub.answers).length > 0 && (
            <View style={styles.detailBox}>
              <Text style={styles.detailLabel}>Answers</Text>
              {Object.entries(sub.answers).map(([q, a]) => (
                <Text key={q} style={styles.detailValue}>Q{q}: {a}</Text>
              ))}
            </View>
          )}

          {sub.status === 'GRADED' && sub.score != null && (
            <View style={[styles.detailBox, { backgroundColor: '#f0fdf4', borderColor: '#86efac' }]}>
              <Text style={[styles.detailLabel, { color: '#16a34a' }]}>Grade</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <Ionicons name="star" size={16} color="#f59e0b" />
                <Text style={[styles.detailValue, { fontWeight: '800', fontSize: 18, color: '#16a34a' }]}>
                  {sub.score}/{sub.maxScore}
                </Text>
                <Text style={{ color: '#6b7280', fontSize: 13 }}>({sub.percentage?.toFixed(0)}%)</Text>
              </View>
              {sub.feedback && (
                <Text style={[styles.detailValue, { marginTop: 8, color: '#374151' }]}>
                  <Text style={{ fontWeight: '700' }}>Feedback: </Text>{sub.feedback}
                </Text>
              )}
            </View>
          )}

          {sub.submittedAt && (
            <Text style={styles.detailMeta}>Submitted {format(new Date(sub.submittedAt), 'MMM d, h:mm a')}</Text>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Grade modal (teacher) ──────────────────────────────────────────────────
function GradeModal({ sub, tab, visible, onClose, onDone }: {
  sub: Submission | null; tab: TabType; visible: boolean; onClose: () => void; onDone: () => void;
}) {
  const qc = useQueryClient();
  const [score, setScore] = useState('');
  const [maxScore, setMaxScore] = useState('100');
  const [feedback, setFeedback] = useState('');

  const gradeMutation = useMutation({
    mutationFn: () => api.post(`/${tab === 'assignments' ? 'assignments' : 'exams'}/submissions/${sub!.id}/grade`, {
      score: parseFloat(score), maxScore: parseFloat(maxScore), feedback: feedback.trim() || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['submissions'] });
      showMessage({ message: 'Graded successfully', type: 'success' });
      onDone();
    },
    onError: () => showMessage({ message: 'Failed to grade', type: 'danger' }),
  });

  if (!sub) return null;
  const pct = score && maxScore ? ((parseFloat(score) / parseFloat(maxScore)) * 100).toFixed(0) : null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Grade Submission</Text>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color="#374151" /></TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
            <View style={styles.detailBox}>
              <Text style={styles.detailValue}>{sub.title}</Text>
              {sub.student && <Text style={styles.cardStudent}>{sub.student.firstName} {sub.student.lastName}</Text>}
            </View>

            {(sub.textContent || sub.description) && (
              <View style={[styles.detailBox, { backgroundColor: '#f9fafb' }]}>
                <Text style={styles.detailLabel}>Student Answer</Text>
                <Text style={styles.detailValue} numberOfLines={6}>{sub.textContent ?? sub.description}</Text>
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.detailLabel}>Score</Text>
                <TextInput value={score} onChangeText={setScore} keyboardType="decimal-pad"
                  style={styles.input} placeholder="0" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.detailLabel}>Max Score</Text>
                <TextInput value={maxScore} onChangeText={setMaxScore} keyboardType="decimal-pad"
                  style={styles.input} placeholder="100" />
              </View>
            </View>

            {pct && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#eef2ff', padding: 10, borderRadius: 10 }}>
                <Ionicons name="star" size={14} color="#f59e0b" />
                <Text style={{ fontWeight: '700', color: '#4f46e5', fontSize: 14 }}>
                  {score}/{maxScore} = {pct}%
                </Text>
              </View>
            )}

            <View>
              <Text style={styles.detailLabel}>Feedback (optional)</Text>
              <TextInput value={feedback} onChangeText={setFeedback} multiline
                style={[styles.input, { height: 90, textAlignVertical: 'top', paddingTop: 10 }]}
                placeholder="Write feedback for the student…" />
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, (!score || !maxScore || gradeMutation.isPending) && styles.submitBtnDisabled]}
              onPress={() => gradeMutation.mutate()}
              disabled={!score || !maxScore || gradeMutation.isPending}>
              {gradeMutation.isPending
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Ionicons name="checkmark-circle" size={18} color="#fff" /><Text style={styles.submitBtnText}>Submit Grade</Text></>}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Submit modal (student) ─────────────────────────────────────────────────
function SubmitModal({ tab, visible, onClose, onDone, studentId }: {
  tab: TabType; visible: boolean; onClose: () => void; onDone: () => void; studentId: string;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [desc, setDesc] = useState('');

  const { data: classes } = useQuery({
    queryKey: ['classes-simple'],
    queryFn: () => api.get('/classes').then(r => r.data.data ?? []),
    staleTime: 60000,
  });
  const [classId, setClassId] = useState('');

  const submitMutation = useMutation({
    mutationFn: async () => {
      const endpoint = tab === 'assignments' ? 'assignments' : 'exams';
      const created = await api.post(`/${endpoint}/submissions`, {
        classId, studentId, title: title.trim(),
        description: desc.trim() || undefined,
        textContent: tab === 'assignments' ? (text.trim() || undefined) : undefined,
      });
      const id = created.data.data.id;
      await api.post(`/${endpoint}/submissions/${id}/submit`,
        tab === 'assignments' ? { textContent: text.trim() || undefined } : {}
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['submissions'] });
      showMessage({ message: `${tab === 'assignments' ? 'Assignment' : 'Exam'} submitted!`, type: 'success' });
      setTitle(''); setText(''); setDesc(''); setClassId('');
      onDone();
    },
    onError: () => showMessage({ message: 'Failed to submit', type: 'danger' }),
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>New {tab === 'assignments' ? 'Assignment' : 'Exam'} Submission</Text>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color="#374151" /></TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
            <View>
              <Text style={styles.detailLabel}>Title *</Text>
              <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="e.g. Chapter 3 Homework" />
            </View>
            <View>
              <Text style={styles.detailLabel}>Class</Text>
              <View style={styles.pickerWrap}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                  {(classes ?? []).map((c: any) => (
                    <TouchableOpacity key={c.id} onPress={() => setClassId(c.id)}
                      style={[styles.classChip, classId === c.id && styles.classChipActive]}>
                      <Text style={[styles.classChipText, classId === c.id && { color: '#fff' }]}>{c.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
            {tab === 'assignments' && (
              <View>
                <Text style={styles.detailLabel}>Description (optional)</Text>
                <TextInput value={desc} onChangeText={setDesc} multiline
                  style={[styles.input, { height: 60, textAlignVertical: 'top', paddingTop: 10 }]} placeholder="Brief note…" />
              </View>
            )}
            <View>
              <Text style={styles.detailLabel}>Your Answer (optional)</Text>
              <TextInput value={text} onChangeText={setText} multiline
                style={[styles.input, { height: 140, textAlignVertical: 'top', paddingTop: 10 }]}
                placeholder="Write your answer here…" />
            </View>
            <TouchableOpacity
              style={[styles.submitBtn, (!title.trim() || submitMutation.isPending) && styles.submitBtnDisabled]}
              onPress={() => submitMutation.mutate()}
              disabled={!title.trim() || submitMutation.isPending}>
              {submitMutation.isPending
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Ionicons name="send" size={18} color="#fff" /><Text style={styles.submitBtnText}>Submit</Text></>}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main screen ────────────────────────────────────────────────────────────
export default function AssignmentsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuthStore();

  const isTeacher = user?.role === 'TEACHER' || user?.role === 'SCHOOL_ADMIN' || user?.role === 'SUPER_ADMIN';
  const isStudent = user?.role === 'STUDENT';

  const [tab, setTab] = useState<TabType>('assignments');
  const [viewSub, setViewSub] = useState<Submission | null>(null);
  const [gradeSub, setGradeSub] = useState<Submission | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const endpoint = tab === 'assignments' ? 'assignments' : 'exams';

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['submissions', tab, user?.id],
    queryFn: () => user?.id
      ? api.get(`/${endpoint}/students/${user.id}/submissions`).then(r => r.data.data ?? [])
      : Promise.resolve([]),
    enabled: !!user?.id,
    staleTime: 30000,
  });

  const subs: Submission[] = (data ?? []).filter((s: Submission) =>
    statusFilter === 'ALL' || s.status === statusFilter
  );

  // Stats
  const all: Submission[] = data ?? [];
  const graded  = all.filter(s => s.status === 'GRADED').length;
  const pending = all.filter(s => s.status === 'SUBMITTED' || s.status === 'LATE').length;
  const avgPct  = all.filter(s => s.percentage != null).length
    ? Math.round(all.reduce((a: number, s: Submission) => a + (s.percentage ?? 0), 0) / all.filter(s => s.percentage != null).length)
    : null;

  const STATUSES = ['ALL', 'DRAFT', 'SUBMITTED', 'GRADED', 'LATE', 'REJECTED'];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top:10, bottom:10, left:10, right:10 }}>
          <Ionicons name="chevron-back" size={24} color="#374151" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isTeacher ? 'Submissions' : 'My Work'}</Text>
        {isStudent && (
          <TouchableOpacity onPress={() => setShowSubmit(true)} style={styles.addBtn}>
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {/* Tab switcher */}
      <View style={styles.tabRow}>
        {(['assignments', 'exams'] as TabType[]).map(t => (
          <TouchableOpacity key={t} onPress={() => setTab(t)}
            style={[styles.tabBtn, tab === t && styles.tabBtnActive]}>
            <Ionicons name={t === 'assignments' ? 'document-text-outline' : 'clipboard-outline'}
              size={15} color={tab === t ? '#fff' : '#6b7280'} />
            <Text style={[styles.tabText, tab === t && { color: '#fff' }]}>
              {t === 'assignments' ? 'Assignments' : 'Exams'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Stats bar */}
      <View style={styles.statsBar}>
        {[
          { label: 'Total', value: all.length, color: '#4f46e5' },
          { label: isTeacher ? 'To Grade' : 'Pending', value: pending, color: '#ea580c' },
          { label: 'Graded', value: graded, color: '#16a34a' },
          { label: 'Avg', value: avgPct != null ? `${avgPct}%` : '—', color: '#d97706' },
        ].map(s => (
          <View key={s.label} style={styles.statItem}>
            <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Status filter chips */}
      <View style={styles.filterWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 4 }}>
          {STATUSES.map(s => (
            <TouchableOpacity key={s} onPress={() => setStatusFilter(s)}
              style={[styles.filterChip, statusFilter === s && styles.filterChipActive]}>
              <Text style={[styles.filterChipText, statusFilter === s && { color: '#fff' }]}>
                {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color="#4f46e5" size="large" /></View>
      ) : (
        <FlatList
          data={subs}
          keyExtractor={s => s.id}
          renderItem={({ item }) => (
            <SubRow item={item} isTeacher={isTeacher}
              onPress={() => {
                if (isTeacher && (item.status === 'SUBMITTED' || item.status === 'LATE' || item.status === 'REVIEWED')) {
                  setGradeSub(item);
                } else {
                  setViewSub(item);
                }
              }} />
          )}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor="#4f46e5" />}
          contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 24 }}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="document-text-outline" size={48} color="#d1d5db" />
              <Text style={styles.emptyTitle}>No {tab} found</Text>
              {isStudent && (
                <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowSubmit(true)}>
                  <Text style={styles.emptyBtnText}>Submit your first {tab === 'assignments' ? 'assignment' : 'exam'}</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          ListHeaderComponent={
            isTeacher && pending > 0 ? (
              <View style={styles.teacherBanner}>
                <Ionicons name="alert-circle" size={16} color="#d97706" />
                <Text style={styles.teacherBannerText}>{pending} submission{pending > 1 ? 's' : ''} waiting to be graded</Text>
              </View>
            ) : null
          }
        />
      )}

      {/* Modals */}
      <ViewModal  sub={viewSub}  tab={tab} visible={!!viewSub}  onClose={() => setViewSub(null)} />
      <GradeModal sub={gradeSub} tab={tab} visible={!!gradeSub} onClose={() => setGradeSub(null)} onDone={() => setGradeSub(null)} />
      <SubmitModal tab={tab} visible={showSubmit} studentId={user?.id ?? ''} onClose={() => setShowSubmit(false)} onDone={() => setShowSubmit(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#f9fafb' },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  headerTitle:     { fontSize: 17, fontWeight: '700', color: '#111827' },
  addBtn:          { width: 32, height: 32, borderRadius: 16, backgroundColor: '#4f46e5', alignItems: 'center', justifyContent: 'center' },
  tabRow:          { flexDirection: 'row', margin: 12, backgroundColor: '#f3f4f6', borderRadius: 12, padding: 4, gap: 4 },
  tabBtn:          { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 9 },
  tabBtnActive:    { backgroundColor: '#4f46e5' },
  tabText:         { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  statsBar:        { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, marginHorizontal: 12, marginBottom: 8, paddingVertical: 12, borderWidth: 1, borderColor: '#f3f4f6' },
  statItem:        { flex: 1, alignItems: 'center' },
  statValue:       { fontSize: 18, fontWeight: '800' },
  statLabel:       { fontSize: 10, color: '#9ca3af', marginTop: 2, fontWeight: '500' },
  filterWrap:      { marginBottom: 4 },
  filterChip:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb' },
  filterChipActive:{ backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  filterChipText:  { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  card:            { backgroundColor: '#fff', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#f3f4f6', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1 },
  cardTop:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitle:       { fontSize: 15, fontWeight: '700', color: '#111827' },
  cardSub:         { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  cardStudent:     { fontSize: 12, color: '#4f46e5', fontWeight: '600', marginTop: 2 },
  cardDue:         { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  pill:            { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  pillText:        { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  scoreRow:        { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  scoreText:       { fontSize: 13, fontWeight: '700', color: '#111827' },
  scorePct:        { fontSize: 11, color: '#9ca3af' },
  feedbackBox:     { backgroundColor: '#f0fdf4', borderRadius: 10, padding: 8, marginTop: 8, borderLeftWidth: 3, borderLeftColor: '#86efac' },
  feedbackText:    { fontSize: 12, color: '#374151' },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyWrap:       { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle:      { fontSize: 16, color: '#6b7280', fontWeight: '500' },
  emptyBtn:        { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#4f46e5', borderRadius: 12 },
  emptyBtnText:    { color: '#fff', fontWeight: '600', fontSize: 14 },
  teacherBanner:   { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fef3c7', borderRadius: 12, padding: 10, marginBottom: 8 },
  teacherBannerText: { fontSize: 13, fontWeight: '600', color: '#92400e' },
  // Modal
  modalHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  modalTitle:      { fontSize: 17, fontWeight: '700', color: '#111827', flex: 1, marginRight: 12 },
  detailBox:       { backgroundColor: '#f9fafb', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  detailLabel:     { fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  detailValue:     { fontSize: 14, color: '#111827', lineHeight: 21 },
  detailMeta:      { fontSize: 11, color: '#9ca3af' },
  detailRow:       { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  input:           { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#111827', backgroundColor: '#fff' },
  submitBtn:       { backgroundColor: '#4f46e5', borderRadius: 14, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  submitBtnDisabled: { backgroundColor: '#c7d2fe' },
  submitBtnText:   { color: '#fff', fontWeight: '700', fontSize: 15 },
  pickerWrap:      { marginTop: 4 },
  classChip:       { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e5e7eb' },
  classChipActive: { backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  classChipText:   { fontSize: 13, fontWeight: '500', color: '#374151' },
});
