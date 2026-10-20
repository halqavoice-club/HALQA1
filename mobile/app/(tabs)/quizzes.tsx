/**
 * HALQA Mobile — Quizzes tab
 *
 * Lists OPEN quizzes for the student's enrolled classes.
 * Teacher/admin users see all quizzes for their school.
 */
import { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { showMessage } from 'react-native-flash-message';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Quiz {
  id:           string
  title:        string
  description:  string | null
  status:       'DRAFT' | 'OPEN' | 'CLOSED'
  timeLimitMin: number | null
  openAt:       string | null
  closeAt:      string | null
  createdAt:    string
  _count?:      { questions: number }
  myAttempt?:   { status: string; score: number | null } | null
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Quiz['status'] }) {
  const cfg = {
    DRAFT:  { label: 'Draft',  color: '#64748b', bg: '#f1f5f9' },
    OPEN:   { label: 'Open',   color: '#16a34a', bg: '#f0fdf4' },
    CLOSED: { label: 'Closed', color: '#6b7280', bg: '#f9fafb' },
  }[status];
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

// ─── Quiz card ────────────────────────────────────────────────────────────────

function QuizItem({ quiz, onPress }: { quiz: Quiz; onPress: () => void }) {
  const questionCount = quiz._count?.questions ?? 0;
  const attempted = !!quiz.myAttempt;
  const submitted = quiz.myAttempt?.status === 'SUBMITTED';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={2}>{quiz.title}</Text>
        <StatusBadge status={quiz.status} />
      </View>

      {quiz.description ? (
        <Text style={styles.cardDesc} numberOfLines={2}>{quiz.description}</Text>
      ) : null}

      <View style={styles.cardMeta}>
        <View style={styles.metaItem}>
          <Ionicons name="help-circle-outline" size={13} color="#6b7280" />
          <Text style={styles.metaText}>{questionCount} question{questionCount !== 1 ? 's' : ''}</Text>
        </View>
        {quiz.timeLimitMin ? (
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={13} color="#6b7280" />
            <Text style={styles.metaText}>{quiz.timeLimitMin} min</Text>
          </View>
        ) : null}
        {quiz.createdAt ? (
          <View style={styles.metaItem}>
            <Ionicons name="calendar-outline" size={13} color="#6b7280" />
            <Text style={styles.metaText}>
              {formatDistanceToNow(new Date(quiz.createdAt), { addSuffix: true })}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Attempt status */}
      {attempted && (
        <View style={[styles.attemptBanner, submitted ? styles.attemptSubmitted : styles.attemptInProgress]}>
          <Ionicons
            name={submitted ? 'checkmark-circle' : 'ellipsis-horizontal-circle'}
            size={13}
            color={submitted ? '#15803d' : '#b45309'}
          />
          <Text style={[styles.attemptText, { color: submitted ? '#15803d' : '#b45309' }]}>
            {submitted
              ? `Submitted${quiz.myAttempt?.score != null ? ` · ${Math.round(quiz.myAttempt.score)}%` : ''}`
              : 'In progress — tap to continue'}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Quizzes screen ───────────────────────────────────────────────────────────

export default function QuizzesScreen() {
  const router = useRouter();

  const { data, isLoading, refetch, isRefetching } = useQuery<Quiz[]>({
    queryKey: ['quizzes-my'],
    queryFn:  async () => {
      const res = await api.get('/quizzes/my');
      return res.data.data ?? [];
    },
    retry: 1,
  });

  const quizzes = data ?? [];

  function handlePress(quiz: Quiz) {
    if (quiz.myAttempt?.status === 'SUBMITTED') {
      router.push(`/quiz/${quiz.id}-result` as any);
    } else {
      router.push(`/quiz/${quiz.id}` as any);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Quizzes</Text>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      ) : quizzes.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="book-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyTitle}>No quizzes available</Text>
          <Text style={styles.emptyDesc}>Open quizzes from your class will appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={quizzes}
          keyExtractor={q => q.id}
          renderItem={({ item }) => (
            <QuizItem quiz={item} onPress={() => handlePress(item)} />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#6366f1" />
          }
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f8fafc' },
  header:       { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  headerTitle:  { fontSize: 20, fontWeight: '700', color: '#111827' },
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  emptyTitle:   { fontSize: 15, fontWeight: '600', color: '#374151', marginTop: 8 },
  emptyDesc:    { fontSize: 13, color: '#9ca3af', textAlign: 'center' },
  list:         { padding: 16, paddingBottom: 32 },
  card:         { backgroundColor: '#fff', borderRadius: 12, padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  cardHeader:   { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  cardTitle:    { flex: 1, fontSize: 14, fontWeight: '600', color: '#111827', lineHeight: 20 },
  cardDesc:     { fontSize: 12, color: '#6b7280', marginTop: 4, lineHeight: 16 },
  cardMeta:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  metaItem:     { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText:     { fontSize: 11, color: '#6b7280' },
  badge:        { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  badgeText:    { fontSize: 10, fontWeight: '600' },
  attemptBanner:    { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  attemptSubmitted: {},
  attemptInProgress:{},
  attemptText:  { fontSize: 11, fontWeight: '500' },
});
