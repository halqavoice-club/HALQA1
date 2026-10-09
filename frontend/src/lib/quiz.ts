/**
 * Quiz API helpers — typed wrappers around the /api/v1/quizzes endpoints.
 * All functions use the shared axios instance from @/lib/api.
 */
import api from '@/lib/api'
import type { Quiz, QuizQuestion, QuizAttempt } from '@/store/quiz.store'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateQuizInput {
  title:        string
  classId:      string
  description?: string | null
  timeLimitMin?: number | null
  openAt?:      string | null
  closeAt?:     string | null
}

export interface UpdateQuizInput {
  title?:        string
  description?:  string | null
  timeLimitMin?: number | null
  openAt?:       string | null
  closeAt?:      string | null
}

export interface QuizOptionInput {
  text:      string
  isCorrect: boolean
  position?: number
}

export interface AddQuestionInput {
  prompt:       string
  questionType: 'MULTIPLE_CHOICE' | 'SHORT_ANSWER'
  options?:     QuizOptionInput[]
  modelAnswer?: string | null
  position?:    number
}

export interface UpdateQuestionInput {
  prompt?:      string
  options?:     QuizOptionInput[]
  modelAnswer?: string | null
  position?:    number
}

export interface SubmitAnswerItem {
  questionId:        string
  selectedOptionId?: string | null
  answerText?:       string | null
}

export interface QuizResultRow {
  attemptId:   string
  studentId:   string
  firstName:   string
  lastName:    string
  avatarUrl:   string | null
  status:      string
  score:       number | null
  feedback:    string | null
  startedAt:   string
  submittedAt: string | null
  timeTakenMs: number | null
  answers:     Array<{
    questionId:       string
    prompt:           string
    questionType:     string
    selectedOptionId: string | null
    answerText:       string | null
    isCorrect:        boolean | null
  }>
}

// ─── Teacher / Admin — Quiz CRUD ──────────────────────────────────────────────

export async function createQuiz(input: CreateQuizInput): Promise<Quiz> {
  const res = await api.post('/quizzes', input)
  return res.data.data
}

export async function listQuizzes(classId?: string): Promise<Quiz[]> {
  const params = classId ? { classId } : {}
  const res = await api.get('/quizzes', { params })
  return res.data.data
}

export async function getQuiz(id: string): Promise<Quiz> {
  const res = await api.get(`/quizzes/${id}`)
  return res.data.data
}

export async function updateQuiz(id: string, input: UpdateQuizInput): Promise<Quiz> {
  const res = await api.patch(`/quizzes/${id}`, input)
  return res.data.data
}

export async function deleteQuiz(id: string): Promise<void> {
  await api.delete(`/quizzes/${id}`)
}

// ─── Questions ────────────────────────────────────────────────────────────────

export async function addQuestion(quizId: string, input: AddQuestionInput): Promise<QuizQuestion> {
  const res = await api.post(`/quizzes/${quizId}/questions`, input)
  return res.data.data
}

export async function updateQuestion(
  quizId: string,
  questionId: string,
  input: UpdateQuestionInput
): Promise<QuizQuestion> {
  const res = await api.patch(`/quizzes/${quizId}/questions/${questionId}`, input)
  return res.data.data
}

export async function deleteQuestion(quizId: string, questionId: string): Promise<void> {
  await api.delete(`/quizzes/${quizId}/questions/${questionId}`)
}

// ─── Status transitions ───────────────────────────────────────────────────────

export async function publishQuiz(id: string): Promise<{ message: string; status: string }> {
  const res = await api.patch(`/quizzes/${id}/publish`)
  return res.data.data
}

export async function closeQuiz(id: string): Promise<{ message: string; status: string }> {
  const res = await api.patch(`/quizzes/${id}/close`)
  return res.data.data
}

export async function reopenQuiz(id: string): Promise<{ message: string; status: string }> {
  const res = await api.patch(`/quizzes/${id}/reopen`)
  return res.data.data
}

// ─── Results ─────────────────────────────────────────────────────────────────

export async function getResults(id: string): Promise<{ quiz: Quiz; attempts: QuizResultRow[] }> {
  const res = await api.get(`/quizzes/${id}/results`)
  return res.data.data
}

export async function exportResults(id: string): Promise<{ quiz: Quiz; attempts: QuizResultRow[] }> {
  const res = await api.get(`/quizzes/${id}/results/export`)
  return res.data.data
}

export async function recordGrades(id: string): Promise<{ recorded: number; message: string }> {
  const res = await api.post(`/quizzes/${id}/record-grades`)
  return res.data.data
}

export async function updateFeedback(
  quizId: string,
  attemptId: string,
  feedback: string
): Promise<QuizAttempt> {
  const res = await api.patch(`/quizzes/${quizId}/attempts/${attemptId}`, { feedback })
  return res.data.data
}

// ─── Student endpoints ────────────────────────────────────────────────────────

export async function listMyQuizzes(classId?: string): Promise<Quiz[]> {
  const params = classId ? { classId } : {}
  const res = await api.get('/quizzes/my', { params })
  return res.data.data
}

export async function getQuizForTaking(id: string): Promise<Quiz> {
  const res = await api.get(`/quizzes/${id}/take`)
  return res.data.data
}

export async function startAttempt(id: string): Promise<QuizAttempt> {
  const res = await api.post(`/quizzes/${id}/start`)
  return res.data.data
}

export async function submitAttempt(
  id: string,
  answers: SubmitAnswerItem[]
): Promise<{ message: string; attemptId: string }> {
  const res = await api.post(`/quizzes/${id}/submit`, { answers })
  return res.data.data
}

export async function getMyResult(id: string): Promise<QuizAttempt> {
  const res = await api.get(`/quizzes/${id}/my-result`)
  return res.data.data
}
