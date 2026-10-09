'use client'
import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { getQuizForTaking, startAttempt, submitAttempt } from '@/lib/quiz'
import { Skeleton } from '@/components/ui/skeleton'
import { StudentQuizView } from '@/components/quiz/StudentQuizView'
import { useQuizStore } from '@/store/quiz.store'
import { useToast } from '@/components/ui/use-toast'
import type { Quiz, QuizAttempt } from '@/store/quiz.store'
import type { SubmitAnswerItem } from '@/lib/quiz'

export default function TakeQuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id }   = use(params)
  const router   = useRouter()
  const { toast } = useToast()

  const {
    answers, setActiveAttempt, setTimeRemaining, clearAttempt
  } = useQuizStore()

  const [currentIdx,   setCurrentIdx]   = useState(0)
  const [submitting,   setSubmitting]   = useState(false)
  const [attemptReady, setAttemptReady] = useState(false)

  // ── Load quiz ──────────────────────────────────────────────────────────────
  const { data: quiz, isLoading, error } = useQuery<Quiz>({
    queryKey: ['quiz-take', id],
    queryFn:  () => getQuizForTaking(id),
  })

  // ── Start attempt on mount ─────────────────────────────────────────────────
  useEffect(() => {
    if (!quiz) return
    let cancelled = false

    startAttempt(id)
      .then((attempt: QuizAttempt) => {
        if (cancelled) return
        setActiveAttempt(attempt)

        // If attempt is already submitted, redirect to result
        if (attempt.status === 'SUBMITTED') {
          router.replace(`/quizzes/${id}/result`)
          return
        }

        // Start countdown timer if quiz has a time limit
        if (quiz.timeLimitMin) {
          const elapsed = (Date.now() - new Date(attempt.startedAt).getTime()) / 1000
          const remaining = Math.max(0, quiz.timeLimitMin * 60 - elapsed)
          setTimeRemaining(Math.floor(remaining))
        }

        setAttemptReady(true)
      })
      .catch((err: any) => {
        if (cancelled) return
        const msg = err?.response?.data?.message ?? 'Failed to start quiz'
        toast({ title: msg, variant: 'destructive' })
        // If already submitted, redirect to result
        if (err?.response?.status === 409) {
          router.replace(`/quizzes/${id}/result`)
        }
      })

    return () => { cancelled = true }
  }, [!!quiz]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!quiz?.questions) return
    setSubmitting(true)
    try {
      const answerPayload: SubmitAnswerItem[] = quiz.questions.map(q => ({
        questionId:        q.id,
        selectedOptionId:  answers[q.id]?.selectedOptionId ?? null,
        answerText:        answers[q.id]?.answerText ?? null,
      }))
      await submitAttempt(id, answerPayload)
      clearAttempt()
      toast({ title: '✅ Quiz submitted!' })
      router.push(`/quizzes/${id}/result`)
    } catch (err: any) {
      toast({ title: err?.response?.data?.message ?? 'Submission failed', variant: 'destructive' })
      setSubmitting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (isLoading || !attemptReady) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (error || !quiz) {
    return (
      <div className="max-w-2xl mx-auto text-sm text-muted-foreground">
        Quiz not found or no longer available.
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{quiz.title}</h1>
        {quiz.description && (
          <p className="text-sm text-muted-foreground mt-1">{quiz.description}</p>
        )}
      </div>

      <StudentQuizView
        quiz={quiz}
        currentIdx={currentIdx}
        onNavigate={setCurrentIdx}
        onSubmit={handleSubmit}
        submitting={submitting}
      />
    </div>
  )
}
