'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  PlusCircle, Trash2, ChevronUp, ChevronDown, CheckCircle2, Circle
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { QuizQuestion, QuizOption } from '@/store/quiz.store'
import type { AddQuestionInput, QuizOptionInput } from '@/lib/quiz'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BuilderQuestion {
  id?:          string   // present for existing questions
  prompt:       string
  questionType: 'MULTIPLE_CHOICE' | 'SHORT_ANSWER'
  modelAnswer:  string
  options:      BuilderOption[]
  position:     number
}

interface BuilderOption {
  id?:       string
  text:      string
  isCorrect: boolean
  position:  number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyOption(position: number): BuilderOption {
  return { text: '', isCorrect: false, position }
}

function emptyQuestion(position: number): BuilderQuestion {
  return {
    prompt:       '',
    questionType: 'MULTIPLE_CHOICE',
    modelAnswer:  '',
    position,
    options:      [emptyOption(1), emptyOption(2)],
  }
}

function fromApiQuestion(q: QuizQuestion, position: number): BuilderQuestion {
  return {
    id:           q.id,
    prompt:       q.prompt,
    questionType: q.questionType,
    modelAnswer:  q.modelAnswer ?? '',
    position,
    options:      q.options.map((o, i) => ({
      id:        o.id,
      text:      o.text,
      isCorrect: o.isCorrect ?? false,
      position:  o.position ?? i + 1,
    }))
  }
}

// ─── QuizBuilder ──────────────────────────────────────────────────────────────

interface QuizBuilderProps {
  /** Existing questions to pre-populate (for edit page) */
  initialQuestions?: QuizQuestion[]
  onSaveQuestion:    (q: AddQuestionInput, existingId?: string) => Promise<void>
  onDeleteQuestion:  (questionId: string) => Promise<void>
  saving?:           boolean
}

export function QuizBuilder({
  initialQuestions = [],
  onSaveQuestion,
  onDeleteQuestion,
  saving = false,
}: QuizBuilderProps) {
  const [questions, setQuestions] = useState<BuilderQuestion[]>(
    initialQuestions.length > 0
      ? initialQuestions.map((q, i) => fromApiQuestion(q, i + 1))
      : []
  )
  const [pendingIdx, setPendingIdx] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── Question list mutations ──────────────────────────────────────────────────

  function addQuestion() {
    setQuestions(prev => [...prev, emptyQuestion(prev.length + 1)])
  }

  function removeQuestion(idx: number) {
    setQuestions(prev => prev.filter((_, i) => i !== idx).map((q, i) => ({ ...q, position: i + 1 })))
  }

  function moveUp(idx: number) {
    if (idx === 0) return
    setQuestions(prev => {
      const next = [...prev]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      return next.map((q, i) => ({ ...q, position: i + 1 }))
    })
  }

  function moveDown(idx: number) {
    setQuestions(prev => {
      if (idx >= prev.length - 1) return prev
      const next = [...prev]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      return next.map((q, i) => ({ ...q, position: i + 1 }))
    })
  }

  function updateQuestion(idx: number, patch: Partial<BuilderQuestion>) {
    setQuestions(prev => prev.map((q, i) => i === idx ? { ...q, ...patch } : q))
  }

  // ── Option mutations ─────────────────────────────────────────────────────────

  function addOption(qIdx: number) {
    setQuestions(prev => prev.map((q, i) => {
      if (i !== qIdx) return q
      return { ...q, options: [...q.options, emptyOption(q.options.length + 1)] }
    }))
  }

  function removeOption(qIdx: number, oIdx: number) {
    setQuestions(prev => prev.map((q, i) => {
      if (i !== qIdx) return q
      return {
        ...q,
        options: q.options.filter((_, oi) => oi !== oIdx).map((o, oi) => ({ ...o, position: oi + 1 }))
      }
    }))
  }

  function updateOption(qIdx: number, oIdx: number, patch: Partial<BuilderOption>) {
    setQuestions(prev => prev.map((q, i) => {
      if (i !== qIdx) return q
      return { ...q, options: q.options.map((o, oi) => oi === oIdx ? { ...o, ...patch } : o) }
    }))
  }

  function setCorrectOption(qIdx: number, oIdx: number) {
    setQuestions(prev => prev.map((q, i) => {
      if (i !== qIdx) return q
      return { ...q, options: q.options.map((o, oi) => ({ ...o, isCorrect: oi === oIdx })) }
    }))
  }

  // ── Save a single question ───────────────────────────────────────────────────

  async function handleSave(idx: number) {
    setError(null)
    const q = questions[idx]
    if (!q.prompt.trim()) { setError('Question prompt is required'); return }
    if (q.questionType === 'MULTIPLE_CHOICE') {
      if (q.options.length < 2) { setError('Add at least 2 options'); return }
      if (q.options.some(o => !o.text.trim())) { setError('All option texts are required'); return }
      if (!q.options.some(o => o.isCorrect)) { setError('Mark one option as correct'); return }
    }
    setPendingIdx(idx)
    try {
      const input: AddQuestionInput = {
        prompt:       q.prompt.trim(),
        questionType: q.questionType,
        position:     q.position,
        modelAnswer:  q.modelAnswer.trim() || undefined,
        options:      q.questionType === 'MULTIPLE_CHOICE'
          ? q.options.map((o, oi) => ({ text: o.text.trim(), isCorrect: o.isCorrect, position: oi + 1 }))
          : undefined,
      }
      await onSaveQuestion(input, q.id)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Failed to save question')
    } finally {
      setPendingIdx(null)
    }
  }

  async function handleDelete(idx: number) {
    const q = questions[idx]
    if (!q.id) { removeQuestion(idx); return }
    setPendingIdx(idx)
    try {
      await onDeleteQuestion(q.id)
      removeQuestion(idx)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Failed to delete question')
    } finally {
      setPendingIdx(null)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive text-sm px-4 py-2">
          {error}
        </div>
      )}

      {questions.map((q, idx) => (
        <div key={idx} className="border rounded-lg p-4 space-y-3 bg-card">
          {/* Header row */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground w-6">{q.position}.</span>

            {/* Question type toggle */}
            <div className="flex gap-1">
              {(['MULTIPLE_CHOICE', 'SHORT_ANSWER'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => updateQuestion(idx, { questionType: t })}
                  className={cn(
                    'px-2 py-0.5 rounded text-xs font-medium border transition-colors',
                    q.questionType === t
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-muted-foreground border-input hover:bg-muted'
                  )}
                >
                  {t === 'MULTIPLE_CHOICE' ? 'Multiple Choice' : 'Short Answer'}
                </button>
              ))}
            </div>

            {/* Move up/down */}
            <div className="flex gap-0.5 ml-auto">
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveUp(idx)}>
                <ChevronUp className="w-3.5 h-3.5" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveDown(idx)}>
                <ChevronDown className="w-3.5 h-3.5" />
              </Button>
              <Button
                type="button" size="icon" variant="ghost"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() => handleDelete(idx)}
                disabled={pendingIdx === idx}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* Prompt */}
          <div>
            <Label className="text-xs mb-1 block">Question</Label>
            <Textarea
              value={q.prompt}
              onChange={e => updateQuestion(idx, { prompt: e.target.value })}
              placeholder="Enter your question..."
              rows={2}
              className="resize-none text-sm"
            />
          </div>

          {/* Options (MC) */}
          {q.questionType === 'MULTIPLE_CHOICE' && (
            <div className="space-y-2">
              <Label className="text-xs">Options <span className="text-muted-foreground">(click circle to mark correct)</span></Label>
              {q.options.map((opt, oIdx) => (
                <div key={oIdx} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCorrectOption(idx, oIdx)}
                    className="flex-shrink-0 text-muted-foreground hover:text-green-600 transition-colors"
                  >
                    {opt.isCorrect
                      ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                      : <Circle className="w-4 h-4" />}
                  </button>
                  <Input
                    value={opt.text}
                    onChange={e => updateOption(idx, oIdx, { text: e.target.value })}
                    placeholder={`Option ${oIdx + 1}`}
                    className="h-8 text-sm flex-1"
                  />
                  {q.options.length > 2 && (
                    <Button
                      type="button" size="icon" variant="ghost"
                      className="h-7 w-7 flex-shrink-0 text-muted-foreground"
                      onClick={() => removeOption(idx, oIdx)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button" variant="ghost" size="sm"
                className="text-xs h-7 px-2"
                onClick={() => addOption(idx)}
              >
                <PlusCircle className="w-3.5 h-3.5 mr-1" /> Add option
              </Button>
            </div>
          )}

          {/* Model answer (SA) */}
          {q.questionType === 'SHORT_ANSWER' && (
            <div>
              <Label className="text-xs mb-1 block">Model Answer <span className="text-muted-foreground">(optional — for teacher reference)</span></Label>
              <Textarea
                value={q.modelAnswer}
                onChange={e => updateQuestion(idx, { modelAnswer: e.target.value })}
                placeholder="Reference answer..."
                rows={2}
                className="resize-none text-sm"
              />
            </div>
          )}

          {/* Save button */}
          <div className="flex justify-end">
            <Button
              type="button" size="sm"
              onClick={() => handleSave(idx)}
              disabled={saving || pendingIdx === idx}
              className="h-7 text-xs"
            >
              {pendingIdx === idx ? 'Saving…' : q.id ? 'Update' : 'Save question'}
            </Button>
          </div>
        </div>
      ))}

      <Button
        type="button" variant="outline" onClick={addQuestion}
        className="w-full border-dashed"
      >
        <PlusCircle className="w-4 h-4 mr-2" /> Add Question
      </Button>
    </div>
  )
}
