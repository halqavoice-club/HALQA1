'use client'
import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getQuiz, updateQuiz, deleteQuiz,
  addQuestion, updateQuestion, deleteQuestion,
  publishQuiz, closeQuiz, reopenQuiz
} from '@/lib/quiz'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { QuizBuilder } from '@/components/quiz/QuizBuilder'
import { useToast } from '@/components/ui/use-toast'
import {
  ArrowLeft, Save, Globe, Lock, RotateCcw, Trash2
} from 'lucide-react'
import Link from 'next/link'
import type { AddQuestionInput } from '@/lib/quiz'
import type { Quiz } from '@/store/quiz.store'

const STATUS_COLORS: Record<string, string> = {
  DRAFT:  'bg-slate-100 text-slate-600',
  OPEN:   'bg-green-100 text-green-700',
  CLOSED: 'bg-gray-100 text-gray-500',
}

export default function EditQuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [saving, setSaving] = useState(false)

  const { data: quiz, isLoading } = useQuery<Quiz>({
    queryKey: ['quiz', id],
    queryFn:  () => getQuiz(id),
  })

  // Local edit state
  const [title,        setTitle]        = useState('')
  const [description,  setDescription]  = useState('')
  const [timeLimitMin, setTimeLimitMin]  = useState('')
  const [initialized,  setInitialized]  = useState(false)

  if (quiz && !initialized) {
    setTitle(quiz.title)
    setDescription(quiz.description ?? '')
    setTimeLimitMin(quiz.timeLimitMin?.toString() ?? '')
    setInitialized(true)
  }

  async function handleSaveSettings() {
    if (!title.trim()) { toast({ title: 'Title is required', variant: 'destructive' }); return }
    setSaving(true)
    try {
      await updateQuiz(id, {
        title:       title.trim(),
        description: description.trim() || null,
        timeLimitMin: timeLimitMin ? parseInt(timeLimitMin) : null,
      })
      queryClient.invalidateQueries({ queryKey: ['quiz', id] })
      toast({ title: 'Settings saved' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message ?? 'Failed to save', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    setSaving(true)
    try {
      await publishQuiz(id)
      queryClient.invalidateQueries({ queryKey: ['quiz', id] })
      queryClient.invalidateQueries({ queryKey: ['quizzes'] })
      toast({ title: '✅ Quiz published — students can now take it' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message ?? 'Failed to publish', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function handleClose() {
    setSaving(true)
    try {
      await closeQuiz(id)
      queryClient.invalidateQueries({ queryKey: ['quiz', id] })
      queryClient.invalidateQueries({ queryKey: ['quizzes'] })
      toast({ title: 'Quiz closed' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message ?? 'Failed to close', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function handleReopen() {
    setSaving(true)
    try {
      await reopenQuiz(id)
      queryClient.invalidateQueries({ queryKey: ['quiz', id] })
      queryClient.invalidateQueries({ queryKey: ['quizzes'] })
      toast({ title: '✅ Quiz reopened' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message ?? 'Failed to reopen', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this quiz? This cannot be undone.')) return
    setSaving(true)
    try {
      await deleteQuiz(id)
      queryClient.invalidateQueries({ queryKey: ['quizzes'] })
      toast({ title: 'Quiz deleted' })
      router.push('/quizzes')
    } catch (e: any) {
      toast({ title: e?.response?.data?.message ?? 'Failed to delete', variant: 'destructive' })
      setSaving(false)
    }
  }

  async function handleSaveQuestion(input: AddQuestionInput, existingId?: string) {
    if (existingId) {
      await updateQuestion(id, existingId, input)
    } else {
      await addQuestion(id, input)
    }
    queryClient.invalidateQueries({ queryKey: ['quiz', id] })
  }

  async function handleDeleteQuestion(questionId: string) {
    await deleteQuestion(id, questionId)
    queryClient.invalidateQueries({ queryKey: ['quiz', id] })
  }

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (!quiz) return <div className="text-sm text-muted-foreground">Quiz not found.</div>

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back */}
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/quizzes"><ArrowLeft className="w-4 h-4 mr-1" /> Quizzes</Link>
        </Button>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[quiz.status]}`}>
          {quiz.status}
        </span>
      </div>

      <h1 className="text-2xl font-semibold">Edit Quiz</h1>

      {/* Settings */}
      <div className="border rounded-lg p-4 space-y-4">
        <h2 className="text-sm font-semibold">Settings</h2>

        <div className="space-y-1.5">
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="desc">Description</Label>
          <Textarea
            id="desc" value={description} rows={2}
            onChange={e => setDescription(e.target.value)} className="resize-none"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tl">Time Limit (minutes — leave blank for unlimited)</Label>
          <Input
            id="tl" type="number" value={timeLimitMin}
            onChange={e => setTimeLimitMin(e.target.value)} min={1} max={180} className="w-32"
          />
        </div>

        <Button size="sm" onClick={handleSaveSettings} disabled={saving}>
          <Save className="w-3.5 h-3.5 mr-1.5" />{saving ? 'Saving…' : 'Save Settings'}
        </Button>
      </div>

      {/* Status actions */}
      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold">Status</h2>
        <div className="flex flex-wrap gap-2">
          {quiz.status === 'DRAFT' && (
            <Button size="sm" onClick={handlePublish} disabled={saving} className="bg-green-600 hover:bg-green-700">
              <Globe className="w-3.5 h-3.5 mr-1.5" /> Publish
            </Button>
          )}
          {quiz.status === 'OPEN' && (
            <Button size="sm" variant="outline" onClick={handleClose} disabled={saving}>
              <Lock className="w-3.5 h-3.5 mr-1.5" /> Close Quiz
            </Button>
          )}
          {quiz.status === 'CLOSED' && (
            <Button size="sm" variant="outline" onClick={handleReopen} disabled={saving}>
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Reopen
            </Button>
          )}
          <Button size="sm" variant="outline" asChild>
            <Link href={`/quizzes/${id}`}>View Results</Link>
          </Button>
          <Button
            size="sm" variant="outline"
            className="text-destructive hover:text-destructive border-destructive/30 hover:border-destructive ml-auto"
            onClick={handleDelete} disabled={saving}
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
          </Button>
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Questions</h2>
        <QuizBuilder
          initialQuestions={quiz.questions ?? []}
          onSaveQuestion={handleSaveQuestion}
          onDeleteQuestion={handleDeleteQuestion}
          saving={saving}
        />
      </div>
    </div>
  )
}
