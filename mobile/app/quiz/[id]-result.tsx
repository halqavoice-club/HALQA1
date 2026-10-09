/**
 * HALQA Mobile — Quiz Result screen
 *
 * Shows the student's score and per-question result after submission.
 */
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import api from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuizOption {
  id:        string
  text:      string
  isCorrect: boolean
}

interface AnswerRow {
  questionId:       string
  prompt:           string
  questionType:     string
  selectedOptionId: string | null
  answerText:       string | null
  isCorrect:        boolean | null
  question?: {
    modelAnswer?: string | null
    options?:     QuizOption[]
  }
}

interface QuizAttempt {
  id:          string
  score:       number | null
  status:      string
  feedback:    string | null
  startedAt:   string
  submittedAt: string | null
  answers?:    AnswerRow[]
}

// ─── Score circle ─────────────────────────────────────────────────────────────

function ScoreCircle({ score }: { score: number | null }) {
  if (score == null) {
    return (
      <View style={styles.scoreCircle}>
        <Text style={styles.scoreCircleLabel}>Pending</Text>
        <Text style={styles.scoreSubLabel}>Score not yet available</Text>
      </View>
    );
  }
  const pct    = Math.round(score);
  const color  = pct >= 80 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
  const label  = pct >= 80 ? 'Excellent!' : pct >= 60 ? 'Good job' : 'Keep practising';

  return (
    <View style={styles.scoreCircleWrap}>
      <View style={[styles.scoreCircle, { borderColor: color }]}>
        <Text style={[styles.scoreNumber, { color }]}>{pct}%</Text>
      </View>
      <Text style={[styles.scoreLabel, { color }]}>{label}</Text>
    </View>
  );
}

// ─── Answer row ───────────────────────────────────────────────────────────────

function AnswerItem({ answer, idx }: { answer: AnswerRow; idx: number }) {
  const correct = answer.isCorrect;
  const iconName = correct === true ? 'checkmark-circle' : correct === false ? 'close-circle' : 'remove-circle';
  const iconColor = correct === true ? '#16a34a' : correct === false ? '#dc2626' : '#9ca3af';
  const borderColor = correct === true ? '#bbf7d0' : correct === false ? '#fecaca' : '#e5e7eb';
  const bg = correct === true ? '#f0fdf4' : correct === false ? '#fef2f2' : '#fff';

  const selectedText = answer.question?.options?.find(o => o.id === answer.selectedOptionId)?.text;
  const correctText  = answer.question?.options?.find(o => o.isCorrect)?.text;

  return (
    <View style={[styles.answerCard, { borderColor, backgroundColor: bg }]}>
      <View style={styles.answerHeader}>
        <Ionicons name={iconName as any} size={18} color={iconColor} />
        <Text style={styles.answerPrompt} numberOfLines={3}>
          {idx + 1}. {answer.prompt}
        </Text>
      </View>

      {answer.questionType === 'MULTIPLE_CHOICE' && (
        <View style={styles.answerDetail}>
          <Text style={styles.answerDetailLabel}>
            Your answer:{' '}
            <Text style={[styles.answerDetailValue, { color: correct ? '#15803d' : '#b91c1c' }]}>
              {selectedText ?? '—'}
            </Text>
          </Text>
          {correct === false && correctText && (
            <Text style={styles.answerDetailLabel}>
              Correct:{' '}
              <Text style={[styles.answerDetailValue, { color: '#15803d' }]}>{correctText}</Text>
            </Text>
          )}
        </View>
      )}

      {answer.questionType === 'SHORT_ANSWER' && (
        <View style={styles.answerDetail}>
          <Text style={styles.answerDetailLabel}>
            Your answer:{' '}
            <Text style={styles.answerDetailValue}>{answer.answerText ?? '—'}</Text>
          </Text>
          {answer.question?.modelAnswer && (
            <Text style={styles.answerDetailLabel}>
              Model answer:{' '}
              <Text style={styles.answerDetailValue}>{answer.question.modelAnswer}</Text>
            </Text>
          )}
          <Text style={styles.saNote}>Short answers are reviewed by your teacher.</Text>
        </View>
      )}
    </View>
  );
}

// ─── QuizResultScreen ────────────────────────────────────────────────────────

export default function QuizResultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: attempt, isLoading } = useQuery<QuizAttempt>({
    queryKey: ['quiz-result-mobile', id],
    queryFn:  async () => {
      const res = await api.get(`/quizzes/${id}/my-result`);
      return res.data.data;
    },
    retry: 1,
  });

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      </SafeAreaView>
    );
  }

  if (!attempt) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.errorText}>No result found.</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/(tabs)/quizzes')}>
            <Text style={styles.backBtnText}>Back to Quizzes</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const mcAnswers = (attempt.answers ?? []).filter(a => a.questionType === 'MULTIPLE_CHOICE');
  const saAnswers = (attempt.answers ?? []).filter(a => a.questionType === 'SHORT_ANSWER');
  const correct   = mcAnswers.filter(a => a.isCorrect === true).length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/(tabs)/quizzes')} style={styles.backIcon}>
          <Ionicons name="arrow-back" size={22} color="#374151" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Quiz Result</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Score */}
        <View style={styles.scoreSection}>
          <ScoreCircle score={attempt.score} />
          {mcAnswers.length > 0 && (
            <Text style={styles.scoreSummary}>
              {correct} / {mcAnswers.length} correct
              {saAnswers.length > 0 ? ` · ${saAnswers.length} short answer${saAnswers.length !== 1 ? 's' : ''} awaiting review` : ''}
            </Text>
          )}
          {attempt.feedback && (
            <View style={styles.feedbackBox}>
              <Text style={styles.feedbackLabel}>Teacher feedback</Text>
              <Text style={styles.feedbackText}>{attempt.feedback}</Text>
            </View>
          )}
        </View>

        {/* Per-question breakdown */}
        {(attempt.answers ?? []).length > 0 && (
          <View style={styles.breakdown}>
            <Text style={styles.breakdownTitle}>Question Breakdown</Text>
            {(attempt.answers ?? []).map((a, i) => (
              <AnswerItem key={a.questionId} answer={a} idx={i} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#f8fafc' },
  center:           { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  header:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  headerTitle:      { fontSize: 16, fontWeight: '700', color: '#111827' },
  backIcon:         { padding: 4, width: 36 },
  scroll:           { padding: 16, paddingBottom: 40 },
  scoreSection:     { alignItems: 'center', paddingVertical: 24, gap: 12 },
  scoreCircleWrap:  { alignItems: 'center', gap: 8 },
  scoreCircle:      { width: 110, height: 110, borderRadius: 55, borderWidth: 4, alignItems: 'center', justifyContent: 'center', borderColor: '#e5e7eb' },
  scoreNumber:      { fontSize: 30, fontWeight: '800' },
  scoreCircleLabel: { fontSize: 14, fontWeight: '600', color: '#6b7280' },
  scoreLabel:       { fontSize: 15, fontWeight: '600' },
  scoreSubLabel:    { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  scoreSummary:     { fontSize: 13, color: '#6b7280', textAlign: 'center' },
  feedbackBox:      { width: '100%', borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', padding: 12, marginTop: 4 },
  feedbackLabel:    { fontSize: 11, fontWeight: '600', color: '#9ca3af', marginBottom: 4 },
  feedbackText:     { fontSize: 13, color: '#374151', lineHeight: 18 },
  breakdown:        { gap: 10 },
  breakdownTitle:   { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 4 },
  answerCard:       { borderRadius: 10, borderWidth: 1.5, padding: 12, gap: 8 },
  answerHeader:     { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  answerPrompt:     { flex: 1, fontSize: 13, fontWeight: '500', color: '#111827', lineHeight: 18 },
  answerDetail:     { paddingLeft: 26, gap: 3 },
  answerDetailLabel:{ fontSize: 12, color: '#6b7280' },
  answerDetailValue:{ fontWeight: '600', color: '#111827' },
  saNote:           { fontSize: 11, color: '#9ca3af', fontStyle: 'italic', marginTop: 2 },
  errorText:        { fontSize: 14, color: '#6b7280', textAlign: 'center' },
  backBtn:          { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, backgroundColor: '#6366f1' },
  backBtnText:      { fontSize: 14, fontWeight: '600', color: '#fff' },
});
