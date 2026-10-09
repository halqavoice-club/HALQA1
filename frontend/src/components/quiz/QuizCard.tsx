'use client'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Clock, FileQuestion, BarChart2, Edit2, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Quiz, QuizStatus } from '@/store/quiz.store'

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<QuizStatus, string> = {
  DRAFT:  'bg-slate-100 text-slate-600 border-slate-200',
  OPEN:   'bg-green-100 text-green-700 border-green-200',
  CLOSED: 'bg-gray-100  text-gray-500  border-gray-200',
}

function StatusBadge({ status }: { status: QuizStatus }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border', STATUS_STYLES[status])}>
      {status}
    </span>
  )
}

// ─── QuizCard ─────────────────────────────────────────────────────────────────

interface QuizCardProps {
  quiz: Quiz & { _count?: { questions: number; attempts: number }; myAttempt?: { status: string; score: number | null } | null }
  /** 'teacher' shows Edit + Dashboard; 'student' shows Take + Result */
  view?: 'teacher' | 'student'
}

export function QuizCard({ quiz, view = 'teacher' }: QuizCardProps) {
  const questionCount = quiz._count?.questions ?? quiz.questions?.length ?? 0
  const attemptCount  = quiz._count?.attempts  ?? 0

  return (
    <Card className="flex flex-col hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-semibold line-clamp-2">{quiz.title}</CardTitle>
          <StatusBadge status={quiz.status} />
        </div>
        {quiz.description && (
          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{quiz.description}</p>
        )}
      </CardHeader>

      <CardContent className="pb-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <FileQuestion className="w-3.5 h-3.5" />
          {questionCount} question{questionCount !== 1 ? 's' : ''}
        </span>
        {quiz.timeLimitMin && (
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {quiz.timeLimitMin} min
          </span>
        )}
        {view === 'teacher' && (
          <span className="flex items-center gap-1">
            <BarChart2 className="w-3.5 h-3.5" />
            {attemptCount} submission{attemptCount !== 1 ? 's' : ''}
          </span>
        )}
        {view === 'student' && quiz.myAttempt && (
          <Badge variant="outline" className="text-xs">
            {quiz.myAttempt.status === 'SUBMITTED'
              ? `Submitted${quiz.myAttempt.score != null ? ` · ${Math.round(quiz.myAttempt.score)}%` : ''}`
              : 'In progress'}
          </Badge>
        )}
      </CardContent>

      <CardFooter className="pt-2 flex gap-2 mt-auto">
        {view === 'teacher' ? (
          <>
            <Button asChild size="sm" variant="outline" className="flex-1">
              <Link href={`/quizzes/${quiz.id}/edit`}>
                <Edit2 className="w-3.5 h-3.5 mr-1" /> Edit
              </Link>
            </Button>
            <Button asChild size="sm" className="flex-1">
              <Link href={`/quizzes/${quiz.id}`}>
                <Eye className="w-3.5 h-3.5 mr-1" /> Results
              </Link>
            </Button>
          </>
        ) : (
          <>
            {quiz.myAttempt?.status === 'SUBMITTED' ? (
              <Button asChild size="sm" variant="outline" className="flex-1">
                <Link href={`/quizzes/${quiz.id}/result`}>
                  <BarChart2 className="w-3.5 h-3.5 mr-1" /> View Result
                </Link>
              </Button>
            ) : (
              <Button asChild size="sm" className="flex-1" disabled={quiz.status !== 'OPEN'}>
                <Link href={`/quizzes/${quiz.id}/take`}>
                  {quiz.myAttempt ? 'Continue' : 'Start Quiz'}
                </Link>
              </Button>
            )}
          </>
        )}
      </CardFooter>
    </Card>
  )
}
