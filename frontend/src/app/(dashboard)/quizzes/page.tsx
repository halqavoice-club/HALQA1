'use client'
import { Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { QuizCard } from '@/components/quiz/QuizCard'
import { listQuizzes } from '@/lib/quiz'
import { useEducationRole } from '@/hooks/useEducationRole'
import { useSchoolAccess } from '@/hooks/useSchoolAccess'
import { PlusCircle, BookOpen } from 'lucide-react'
import type { Quiz } from '@/store/quiz.store'

// ─── Inner component — uses useSearchParams (must be inside Suspense) ─────────
function QuizzesInner() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const classId      = searchParams.get('classId') ?? undefined

  const { isTeacher, isAdmin } = useEducationRole()
  const { hasSchools }         = useSchoolAccess()

  const { data: quizzes = [], isLoading } = useQuery<Quiz[]>({
    queryKey: ['quizzes', classId],
    queryFn:  () => listQuizzes(classId),
    enabled:  hasSchools,
  })

  const canManage = isTeacher || isAdmin

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Quizzes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {canManage ? 'Create and manage practice quizzes for your classes.' : 'View and take quizzes assigned to your class.'}
          </p>
        </div>
        {canManage && (
          <Button asChild>
            <Link href="/quizzes/new">
              <PlusCircle className="w-4 h-4 mr-2" /> Create Quiz
            </Link>
          </Button>
        )}
      </div>

      {/* Quiz grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      ) : quizzes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
          <BookOpen className="w-12 h-12 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-muted-foreground">No quizzes yet</p>
            {canManage && (
              <p className="text-xs text-muted-foreground mt-1">
                Create your first quiz to get started.
              </p>
            )}
          </div>
          {canManage && (
            <Button asChild variant="outline" size="sm">
              <Link href="/quizzes/new">
                <PlusCircle className="w-3.5 h-3.5 mr-1.5" /> Create Quiz
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {quizzes.map(quiz => (
            <QuizCard
              key={quiz.id}
              quiz={quiz}
              view={canManage ? 'teacher' : 'student'}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Page — Suspense boundary required for useSearchParams (Next.js 14) ───────
export default function QuizzesPage() {
  return (
    <Suspense fallback={
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}
        </div>
      </div>
    }>
      <QuizzesInner />
    </Suspense>
  )
}
