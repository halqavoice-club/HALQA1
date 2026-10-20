'use client'
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Clock, ChevronLeft, ChevronRight, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useQuizStore } from '@/store/quiz.store'
import type { Quiz, QuizQuestion } from '@/store/quiz.store'

// ─── Countdown timer ──────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ─── StudentQuizView ─────────────────────────────────────────────────────────

interface StudentQuizViewProps {
  quiz:        Quiz
  currentIdx:  number
  onNavigate:  (idx: number) => void
  onSubmit:    () => Promise<void>
  submitting?: boolean
}

export function StudentQuizView({
  quiz,
  currentIdx,
  onNavigate,
  onSubmit,
  submitting = false,
}: StudentQuizViewProps) {
  const { answers, setAnswer, timeRemaining, decrementTimer } = useQuizStore()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const questions = quiz.questions ?? []
  const question  = questions[currentIdx]
  const isLast    = currentIdx === questions.length - 1
  const isFirst   = currentIdx === 0

  // Countdown timer
  useEffect(() => {
    if (timeRemaining === null) return
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => { decrementTimer() }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [timeRemaining !== null]) // only start/stop on mount/unmount

  if (!question) return null

  const draft = answers[question.id] ?? {}

  const totalAnswered = questions.filter(q => {
    const a = answers[q.id]
    return a && (a.selectedOptionId || a.answerText?.trim())
  }).length

  const progress = questions.length > 0 ? (totalAnswered / questions.length) * 100 : 0

  return (
    <div className="space-y-6">
      {/* Header — progress + timer */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Question {currentIdx + 1} of {questions.length}</span>
            <span>{totalAnswered} answered</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>
        {timeRemaining !== null && (
          <div className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-mono font-semibold border',
            timeRemaining <= 60
              ? 'text-red-600 bg-red-50 border-red-200 animate-pulse'
              : timeRemaining <= 300
              ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
              : 'text-muted-foreground bg-muted border-border'
          )}>
            <Clock className="w-3.5 h-3.5" />
            {formatTime(timeRemaining)}
          </div>
        )}
      </div>

      {/* Question */}
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
            {currentIdx + 1}
          </span>
          <p className="text-sm font-medium leading-relaxed">{question.prompt}</p>
        </div>

        {/* Multiple choice options */}
        {question.questionType === 'MULTIPLE_CHOICE' && (
          <div className="space-y-2 pl-10">
            {question.options.map(opt => {
              const selected = draft.selectedOptionId === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAnswer(question.id, { selectedOptionId: opt.id })}
                  className={cn(
                    'w-full text-left px-4 py-3 rounded-lg border text-sm transition-all',
                    selected
                      ? 'border-primary bg-primary/5 text-primary font-medium'
                      : 'border-input hover:border-primary/50 hover:bg-muted/50'
                  )}
                >
                  <span className={cn(
                    'inline-flex w-5 h-5 rounded-full border mr-3 items-center justify-center text-xs flex-shrink-0',
                    selected ? 'border-primary bg-primary text-white' : 'border-muted-foreground'
                  )}>
                    {String.fromCharCode(65 + (opt.position - 1))}
                  </span>
                  {opt.text}
                </button>
              )
            })}
          </div>
        )}

        {/* Short answer */}
        {question.questionType === 'SHORT_ANSWER' && (
          <div className="pl-10">
            <Textarea
              value={draft.answerText ?? ''}
              onChange={e => setAnswer(question.id, { answerText: e.target.value })}
              placeholder="Type your answer here…"
              rows={4}
              className="resize-none text-sm"
            />
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          type="button" variant="outline" size="sm"
          onClick={() => onNavigate(currentIdx - 1)}
          disabled={isFirst}
        >
          <ChevronLeft className="w-4 h-4 mr-1" /> Previous
        </Button>

        {/* Question dots */}
        <div className="hidden sm:flex items-center gap-1">
          {questions.map((q, i) => {
            const answered = !!(answers[q.id]?.selectedOptionId || answers[q.id]?.answerText?.trim())
            return (
              <button
                key={i}
                type="button"
                onClick={() => onNavigate(i)}
                className={cn(
                  'w-2.5 h-2.5 rounded-full transition-colors',
                  i === currentIdx  ? 'bg-primary scale-125' :
                  answered          ? 'bg-primary/40' :
                  'bg-muted-foreground/20 hover:bg-muted-foreground/40'
                )}
              />
            )
          })}
        </div>

        {isLast ? (
          <Button
            type="button" size="sm"
            onClick={onSubmit}
            disabled={submitting}
            className="bg-green-600 hover:bg-green-700"
          >
            <Send className="w-3.5 h-3.5 mr-1.5" />
            {submitting ? 'Submitting…' : 'Submit Quiz'}
          </Button>
        ) : (
          <Button
            type="button" size="sm"
            onClick={() => onNavigate(currentIdx + 1)}
          >
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  )
}
