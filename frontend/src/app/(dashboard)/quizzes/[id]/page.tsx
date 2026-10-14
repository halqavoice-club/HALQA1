'use client'
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { getQuiz } from '@/lib/quiz'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { QuizResultsDashboard } from '@/components/quiz/QuizResultsDashboard'
import { ArrowLeft, Edit2 } from 'lucide-react'
import type { Quiz } from '@/store/quiz.store'

export default function QuizDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const { data: quiz, isLoading } = useQuery<Quiz>({
    queryKey: ['quiz', id],
    queryFn:  () => getQuiz(id),
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (!quiz) return <div className="text-sm text-muted-foreground">Quiz not found.</div>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/quizzes"><ArrowLeft className="w-4 h-4" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{quiz.title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Live results dashboard</p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/quizzes/${id}/edit`}>
            <Edit2 className="w-3.5 h-3.5 mr-1.5" /> Edit
          </Link>
        </Button>
      </div>

      <QuizResultsDashboard quiz={quiz} quizId={id} />
    </div>
  )
}
