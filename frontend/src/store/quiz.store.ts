'use client'
import { create } from 'zustand'

// ─── Types ────────────────────────────────────────────────────────────────────

export type QuizStatus = 'DRAFT' | 'OPEN' | 'CLOSED'
export type QuestionType = 'MULTIPLE_CHOICE' | 'SHORT_ANSWER'
export type AttemptStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'TIMED_OUT'

export interface QuizOption {
  id:        string
  text:      string
  position:  number
  isCorrect?: boolean  // present for teacher view; stripped for student take view
}

export interface QuizQuestion {
  id:           string
  position:     number
  questionType: QuestionType
  prompt:       string
  modelAnswer?: string | null
  options:      QuizOption[]
}

export interface Quiz {
  id:           string
  schoolId:     string
  classId:      string
  teacherId:    string
  title:        string
  description:  string | null
  status:       QuizStatus
  timeLimitMin: number | null
  openAt:       string | null
  closeAt:      string | null
  createdAt:    string
  updatedAt:    string
  questions?:   QuizQuestion[]
  _count?:      { questions: number; attempts: number }
}

export interface QuizAttempt {
  id:          string
  quizId:      string
  studentId:   string
  userId:      string
  status:      AttemptStatus
  score:       number | null
  feedback:    string | null
  startedAt:   string
  submittedAt: string | null
}

/** Draft answer stored while the student is taking the quiz */
export interface DraftAnswer {
  selectedOptionId?: string | null
  answerText?:       string | null
}

// ─── Store shape ──────────────────────────────────────────────────────────────

interface QuizStore {
  /** The current IN_PROGRESS attempt (persists across question navigation) */
  activeAttempt: QuizAttempt | null
  /** Draft answers keyed by questionId */
  answers: Record<string, DraftAnswer>
  /** Countdown seconds remaining (set from timeLimitMin on attempt start) */
  timeRemaining: number | null

  // Actions
  setActiveAttempt:  (attempt: QuizAttempt | null) => void
  setAnswer:         (questionId: string, answer: DraftAnswer) => void
  clearAttempt:      () => void
  setTimeRemaining:  (seconds: number | null) => void
  decrementTimer:    () => void
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useQuizStore = create<QuizStore>((set) => ({
  activeAttempt:  null,
  answers:        {},
  timeRemaining:  null,

  setActiveAttempt: (attempt) =>
    set({ activeAttempt: attempt }),

  setAnswer: (questionId, answer) =>
    set((state) => ({
      answers: { ...state.answers, [questionId]: answer }
    })),

  clearAttempt: () =>
    set({ activeAttempt: null, answers: {}, timeRemaining: null }),

  setTimeRemaining: (seconds) =>
    set({ timeRemaining: seconds }),

  decrementTimer: () =>
    set((state) => ({
      timeRemaining:
        state.timeRemaining !== null && state.timeRemaining > 0
          ? state.timeRemaining - 1
          : state.timeRemaining
    })),
}))
