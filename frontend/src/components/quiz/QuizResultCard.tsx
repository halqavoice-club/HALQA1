'use client'
import { CheckCircle2, XCircle, MinusCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { QuizAttempt } from '@/store/quiz.store'

// ─── Score circle ─────────────────────────────────────────────────────────────

function ScoreCircle({ score }: { score: number | null }) {
  if (score == null) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="w-28 h-28 rounded-full border-4 border-muted flex items-center justify-center">
          <span className="text-lg font-semibold text-muted-foreground">Pending</span>
        </div>
        <p className="text-xs text-muted-foreground">Score not yet available</p>
      </div>
    )
  }

  const pct   = Math.round(score)
  const color = pct >= 80 ? '#22c55e' : pct >= 60 ? '#eab308' : '#ef4444'
  const label = pct >= 80 ? 'Excellent!' : pct >= 60 ? 'Good job' : 'Keep practising'

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="w-28 h-28 rounded-full flex items-center justify-center border-4"
        style={{ borderColor: color }}
      >
        <span className="text-3xl font-bold" style={{ color }}>{pct}%</span>
      </div>
      <p className="text-sm font-medium" style={{ color }}>{label}</p>
    </div>
  )
}

// ─── Per-question row ─────────────────────────────────────────────────────────

interface AnswerRow {
  questionId:       string
  prompt:           string
  questionType:     string
  selectedOptionId: string | null
  answerText:       string | null
  isCorrect:        boolean | null
  question?: {
    modelAnswer?: string | null
    options?: Array<{ id: string; text: string; isCorrect: boolean }>
  }
}

function AnswerRowItem({ answer, idx }: { answer: AnswerRow; idx: number }) {
  const icon =
    answer.isCorrect === true  ? <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" /> :
    answer.isCorrect === false ? <XCircle      className="w-4 h-4 text-red-500    flex-shrink-0" /> :
                                 <MinusCircle  className="w-4 h-4 text-muted-foreground flex-shrink-0" />

  const selectedText = answer.question?.options?.find(o => o.id === answer.selectedOptionId)?.text
  const correctText  = answer.question?.options?.find(o => o.isCorrect)?.text

  return (
    <div className={cn(
      'rounded-lg border p-3 space-y-1.5 text-sm',
      answer.isCorrect === true  ? 'border-green-200 bg-green-50/50' :
      answer.isCorrect === false ? 'border-red-200   bg-red-50/50'   :
                                   'border-border'
    )}>
      <div className="flex items-start gap-2">
        {icon}
        <p className="font-medium text-xs leading-relaxed">{idx + 1}. {answer.prompt}</p>
      </div>

      {answer.questionType === 'MULTIPLE_CHOICE' && (
        <div className="pl-6 space-y-0.5 text-xs">
          <p className="text-muted-foreground">
            Your answer: <span className={cn('font-medium', answer.isCorrect ? 'text-green-700' : 'text-red-600')}>
              {selectedText ?? '—'}
            </span>
          </p>
          {answer.isCorrect === false && correctText && (
            <p className="text-muted-foreground">
              Correct: <span className="font-medium text-green-700">{correctText}</span>
            </p>
          )}
        </div>
      )}

      {answer.questionType === 'SHORT_ANSWER' && (
        <div className="pl-6 space-y-0.5 text-xs">
          <p className="text-muted-foreground">
            Your answer: <span className="font-medium text-foreground">{answer.answerText ?? '—'}</span>
          </p>
          {answer.question?.modelAnswer && (
            <p className="text-muted-foreground">
              Model answer: <span className="font-medium text-foreground">{answer.question.modelAnswer}</span>
            </p>
          )}
          <p className="text-muted-foreground italic">Short answers are reviewed by your teacher.</p>
        </div>
      )}
    </div>
  )
}

// ─── QuizResultCard ───────────────────────────────────────────────────────────

interface QuizResultCardProps {
  attempt: QuizAttempt & {
    answers?: AnswerRow[]
  }
  quizTitle?: string
}

export function QuizResultCard({ attempt, quizTitle }: QuizResultCardProps) {
  const mcAnswers = (attempt.answers ?? []).filter(a => a.questionType === 'MULTIPLE_CHOICE')
  const saAnswers = (attempt.answers ?? []).filter(a => a.questionType === 'SHORT_ANSWER')
  const correct   = mcAnswers.filter(a => a.isCorrect === true).length

  return (
    <div className="space-y-6">
      {/* Score summary */}
      <div className="flex flex-col items-center gap-4 py-4">
        {quizTitle && <h2 className="text-lg font-semibold text-center">{quizTitle}</h2>}
        <ScoreCircle score={attempt.score} />
        {mcAnswers.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {correct} / {mcAnswers.length} correct
            {saAnswers.length > 0 && ` · ${saAnswers.length} short answer${saAnswers.length !== 1 ? 's' : ''} awaiting review`}
          </p>
        )}
        {attempt.feedback && (
          <div className="w-full rounded-md border bg-muted/50 p-3 text-sm">
            <p className="text-xs font-medium text-muted-foreground mb-1">Teacher feedback</p>
            <p>{attempt.feedback}</p>
          </div>
        )}
      </div>

      {/* Per-question breakdown */}
      {(attempt.answers ?? []).length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Question breakdown</h3>
          {(attempt.answers ?? []).map((a, i) => (
            <AnswerRowItem key={a.questionId} answer={a} idx={i} />
          ))}
        </div>
      )}
    </div>
  )
}
