/**
 * HALQA Mobile — Take Quiz screen
 *
 * - Loads the quiz via getQuizForTaking (questions, no isCorrect flags)
 * - Creates an IN_PROGRESS attempt on mount
 * - Saves answers to expo-secure-store on each change for offline resilience
 * - Countdown timer if quiz has a time limit
 * - Submits via POST /submit → navigates to result screen
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Pressable
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuizOption {
  id:       string
  text:     string
  position: number
}

interface QuizQuestion {
  id:           string
  position:     number
  questionType: 'MULTIPLE_CHOICE' | 'SHORT_ANSWER'
  prompt:       string
  options:      QuizOption[]
}

interface Quiz {
  id:           string
  title:        string
  description:  string | null
  timeLimitMin: number | null
  questions:    QuizQuestion[]
}

interface Attempt {
  id:        string
  status:    string
  startedAt: string
}

interface DraftAnswers {
  [questionId: string]: {
    selectedOptionId?: string | null
    answerText?:       string | null
  }
}

// ─── Secure store key ─────────────────────────────────────────────────────────

const draftKey = (attemptId: string) => `quiz_draft_${attemptId}`;

// ─── Countdown timer ──────────────────────────────────────────────────────────

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── TakeQuizScreen ───────────────────────────────────────────────────────────

export default function TakeQuizScreen() {
  const { id }  = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();

  const [attempt,      setAttempt]      = useState<Attempt | null>(null);
  const [answers,      setAnswers]      = useState<DraftAnswers>({});
  const [currentIdx,   setCurrentIdx]   = useState(0);
  const [timeLeft,     setTimeLeft]     = useState<number | null>(null);
  const [submitting,   setSubmitting]   = useState(false);
  const [loadingStart, setLoadingStart] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load quiz ──────────────────────────────────────────────────────────────
  const { data: quiz, isLoading: quizLoading } = useQuery<Quiz>({
    queryKey: ['quiz-take-mobile', id],
    queryFn:  async () => {
      const res = await api.get(`/quizzes/${id}/take`);
      return res.data.data;
    },
    retry: 1,
  });

  // ── Start attempt + restore draft ─────────────────────────────────────────
  useEffect(() => {
    if (!quiz) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await api.post(`/quizzes/${id}/start`);
        const att: Attempt = res.data.data;
        if (cancelled) return;

        if (att.status === 'SUBMITTED') {
          router.replace(`/quiz/${id}-result` as any);
          return;
        }

        setAttempt(att);

        // Restore draft answers from SecureStore
        try {
          const stored = await SecureStore.getItemAsync(draftKey(att.id));
          if (stored) setAnswers(JSON.parse(stored));
        } catch { /* ignore */ }

        // Start countdown
        if (quiz.timeLimitMin) {
          const elapsed = (Date.now() - new Date(att.startedAt).getTime()) / 1000;
          const remaining = Math.max(0, quiz.timeLimitMin * 60 - Math.floor(elapsed));
          setTimeLeft(remaining);
        }
      } catch (err: any) {
        if (err?.response?.status === 409) {
          router.replace(`/quiz/${id}-result` as any);
        } else {
          showMessage({ message: err?.response?.data?.message ?? 'Failed to start quiz', type: 'danger' });
        }
      } finally {
        if (!cancelled) setLoadingStart(false);
      }
    })();

    return () => { cancelled = true; };
  }, [!!quiz]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Countdown tick ────────────────────────────────────────────────────────
  useEffect(() => {
    if (timeLeft === null) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev === null || prev <= 0) {
          clearInterval(timerRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timeLeft !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist draft on answer change ───────────────────────────────────────
  const setAnswer = useCallback(async (
    questionId: string,
    patch: { selectedOptionId?: string | null; answerText?: string | null }
  ) => {
    const next = (prev: DraftAnswers) => ({ ...prev, [questionId]: { ...prev[questionId], ...patch } });
    setAnswers(prev => {
      const updated = next(prev);
      if (attempt) {
        SecureStore.setItemAsync(draftKey(attempt.id), JSON.stringify(updated)).catch(() => {});
      }
      return updated;
    });
  }, [attempt?.id]);

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!quiz || !attempt) return;

    Alert.alert(
      'Submit Quiz',
      'Are you sure you want to submit? You cannot change your answers after submission.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          style: 'default',
          onPress: async () => {
            setSubmitting(true);
            try {
              const answerPayload = quiz.questions.map(q => ({
                questionId:        q.id,
                selectedOptionId:  answers[q.id]?.selectedOptionId ?? null,
                answerText:        answers[q.id]?.answerText ?? null,
              }));
              await api.post(`/quizzes/${id}/submit`, { answers: answerPayload });

              // Clear draft from SecureStore
              if (attempt) {
                await SecureStore.deleteItemAsync(draftKey(attempt.id)).catch(() => {});
              }

              showMessage({ message: '✅ Quiz submitted!', type: 'success' });
              router.replace(`/quiz/${id}-result` as any);
            } catch (err: any) {
              showMessage({ message: err?.response?.data?.message ?? 'Submission failed', type: 'danger' });
              setSubmitting(false);
            }
          }
        }
      ]
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (quizLoading || loadingStart) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.loadingText}>Loading quiz…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!quiz || !quiz.questions?.length) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.errorText}>Quiz not found or not available.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const question   = quiz.questions[currentIdx];
  const isFirst    = currentIdx === 0;
  const isLast     = currentIdx === quiz.questions.length - 1;
  const draft      = answers[question.id] ?? {};
  const totalAnswered = quiz.questions.filter(q => {
    const a = answers[q.id];
    return a && (a.selectedOptionId || a.answerText?.trim());
  }).length;

  const timerWarning = timeLeft !== null && timeLeft <= 60;
  const timerCaution = timeLeft !== null && timeLeft <= 300;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1}>{quiz.title}</Text>
        <View style={styles.headerRight}>
          <Text style={styles.progressText}>{totalAnswered}/{quiz.questions.length}</Text>
          {timeLeft !== null && (
            <View style={[styles.timer, timerWarning ? styles.timerWarn : timerCaution ? styles.timerCaution : styles.timerNormal]}>
              <Ionicons name="time-outline" size={12} color={timerWarning ? '#dc2626' : timerCaution ? '#d97706' : '#6b7280'} />
              <Text style={[styles.timerText, { color: timerWarning ? '#dc2626' : timerCaution ? '#d97706' : '#6b7280' }]}>
                {formatTime(timeLeft)}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${((currentIdx) / quiz.questions.length) * 100}%` as any }]} />
      </View>

      {/* Question */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Question number + prompt */}
        <View style={styles.questionHeader}>
          <View style={styles.questionNumber}>
            <Text style={styles.questionNumberText}>{currentIdx + 1}</Text>
          </View>
          <Text style={styles.questionPrompt}>{question.prompt}</Text>
        </View>

        {/* Multiple choice options */}
        {question.questionType === 'MULTIPLE_CHOICE' && (
          <View style={styles.options}>
            {question.options.map((opt, oi) => {
              const selected = draft.selectedOptionId === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => setAnswer(question.id, { selectedOptionId: opt.id })}
                  activeOpacity={0.7}
                >
                  <View style={[styles.optionCircle, selected && styles.optionCircleSelected]}>
                    <Text style={[styles.optionCircleText, selected && { color: '#fff' }]}>
                      {String.fromCharCode(65 + oi)}
                    </Text>
                  </View>
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {opt.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Short answer */}
        {question.questionType === 'SHORT_ANSWER' && (
          <TextInput
            style={styles.textInput}
            value={draft.answerText ?? ''}
            onChangeText={text => setAnswer(question.id, { answerText: text })}
            placeholder="Type your answer here…"
            placeholderTextColor="#9ca3af"
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />
        )}
      </ScrollView>

      {/* Navigation */}
      <View style={styles.nav}>
        <TouchableOpacity
          style={[styles.navBtn, styles.navBtnOutline, isFirst && styles.navBtnDisabled]}
          onPress={() => setCurrentIdx(i => i - 1)}
          disabled={isFirst}
        >
          <Ionicons name="chevron-back" size={16} color={isFirst ? '#d1d5db' : '#374151'} />
          <Text style={[styles.navBtnText, isFirst && styles.navBtnTextDisabled]}>Prev</Text>
        </TouchableOpacity>

        {isLast ? (
          <TouchableOpacity
            style={[styles.navBtn, styles.navBtnPrimary, submitting && styles.navBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="send" size={15} color="#fff" />}
            <Text style={styles.navBtnTextPrimary}>Submit</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.navBtn, styles.navBtnPrimary]}
            onPress={() => setCurrentIdx(i => i + 1)}
          >
            <Text style={styles.navBtnTextPrimary}>Next</Text>
            <Ionicons name="chevron-forward" size={16} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:           { flex: 1, backgroundColor: '#f8fafc' },
  center:              { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  loadingText:         { fontSize: 13, color: '#6b7280', marginTop: 8 },
  errorText:           { fontSize: 14, color: '#6b7280', textAlign: 'center', paddingHorizontal: 32 },
  header:              { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  headerTitle:         { flex: 1, fontSize: 15, fontWeight: '600', color: '#111827' },
  headerRight:         { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressText:        { fontSize: 12, color: '#6b7280' },
  timer:               { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  timerNormal:         { borderColor: '#e5e7eb', backgroundColor: '#f9fafb' },
  timerCaution:        { borderColor: '#fcd34d', backgroundColor: '#fffbeb' },
  timerWarn:           { borderColor: '#fca5a5', backgroundColor: '#fef2f2' },
  timerText:           { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
  progressBar:         { height: 3, backgroundColor: '#e5e7eb' },
  progressFill:        { height: 3, backgroundColor: '#6366f1' },
  scroll:              { flex: 1 },
  scrollContent:       { padding: 16, paddingBottom: 24 },
  questionHeader:      { flexDirection: 'row', gap: 10, marginBottom: 16 },
  questionNumber:      { width: 28, height: 28, borderRadius: 14, backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  questionNumberText:  { fontSize: 12, fontWeight: '700', color: '#fff' },
  questionPrompt:      { flex: 1, fontSize: 15, fontWeight: '500', color: '#111827', lineHeight: 22 },
  options:             { gap: 10 },
  option:              { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#fff' },
  optionSelected:      { borderColor: '#6366f1', backgroundColor: '#eef2ff' },
  optionCircle:        { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: '#d1d5db', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  optionCircleSelected:{ borderColor: '#6366f1', backgroundColor: '#6366f1' },
  optionCircleText:    { fontSize: 11, fontWeight: '700', color: '#374151' },
  optionText:          { flex: 1, fontSize: 14, color: '#374151', lineHeight: 20 },
  optionTextSelected:  { color: '#3730a3', fontWeight: '500' },
  textInput:           { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#d1d5db', borderRadius: 10, padding: 12, fontSize: 14, color: '#111827', minHeight: 120 },
  nav:                 { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb', backgroundColor: '#fff' },
  navBtn:              { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  navBtnOutline:       { borderWidth: 1.5, borderColor: '#e5e7eb' },
  navBtnPrimary:       { backgroundColor: '#6366f1' },
  navBtnDisabled:      { opacity: 0.4 },
  navBtnText:          { fontSize: 14, fontWeight: '600', color: '#374151' },
  navBtnTextDisabled:  { color: '#d1d5db' },
  navBtnTextPrimary:   { fontSize: 14, fontWeight: '600', color: '#fff' },
});
