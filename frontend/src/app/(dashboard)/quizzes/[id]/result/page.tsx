'use client'
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { getMyResult, getQuiz } from '@/lib/quiz'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { QuizResultCard } from '@/components/quiz/QuizResultCard'
import { ArrowLeft } from 'lucide-react'
import type { QuizAttempt, Quiz } from '@/store/quiz.store'

export default function QuizResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const { data: attempt, isLoading: loadingAttempt } = useQuery<QuizAttempt>({
    queryKey: ['quiz-result', id],
    queryFn:  () => getMyResult(id),
  })

  const { data: quiz } = useQuery<Quiz>({
    queryKey: ['quiz-take', id],
    queryFn:  () => getQuiz(id),
    enabled:  !!attempt,
  })

  if (loadingAttempt) {
    return (
      <div className="max-w-xl mx-auto space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-28 w-28 rounded-full mx-auto" />
        <Skeleton className="h-4 w-40 mx-auto" />
        <div className="space-y-2 mt-6">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      </div>
    )
  }

  if (!attempt) {
    return (
      <div className="max-w-xl mx-auto text-center py-20 space-y-4">
        <p className="text-sm text-muted-foreground">No result found. You may not have submitted this quiz yet.</p>
        <Button asChild variant="outline" size="sm">
          <Link href={`/quizzes/${id}/take`}>Take Quiz</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/quizzes"><ArrowLeft className="w-4 h-4 mr-1" /> Quizzes</Link>
        </Button>
      </div>

      <QuizResultCard
        attempt={attempt as any}
        quizTitle={quiz?.title}
      />
    </div>
  )
}
