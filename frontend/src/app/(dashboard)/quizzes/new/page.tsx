'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { createQuiz } from '@/lib/quiz'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { ArrowLeft, Save } from 'lucide-react'
import Link from 'next/link'

export default function NewQuizPage() {
  const router = useRouter()
  const { toast } = useToast()

  const [title,        setTitle]        = useState('')
  const [classId,      setClassId]      = useState('')
  const [description,  setDescription]  = useState('')
  const [timeLimitMin, setTimeLimitMin]  = useState('')
  const [openAt,       setOpenAt]       = useState('')
  const [closeAt,      setCloseAt]      = useState('')
  const [saving,       setSaving]       = useState(false)

  // Load teacher's classes
  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn:  () => api.get('/classes').then(r => r.data),
  })
  const classes: Array<{ id: string; name: string }> = classesData?.data || []

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { toast({ title: 'Title is required', variant: 'destructive' }); return }
    if (!classId)      { toast({ title: 'Select a class',   variant: 'destructive' }); return }

    setSaving(true)
    try {
      const quiz = await createQuiz({
        title:       title.trim(),
        classId,
        description: description.trim() || null,
        timeLimitMin: timeLimitMin ? parseInt(timeLimitMin) : null,
        openAt:      openAt  || null,
        closeAt:     closeAt || null,
      })
      toast({ title: 'Quiz created! Add questions next.' })
      router.push(`/quizzes/${quiz.id}/edit`)
    } catch (e: any) {
      toast({ title: e?.response?.data?.message ?? 'Failed to create quiz', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Back */}
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/quizzes"><ArrowLeft className="w-4 h-4 mr-1" /> Quizzes</Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">Create Quiz</h1>
        <p className="text-sm text-muted-foreground mt-1">Quiz will be saved as DRAFT. You can add questions on the next page.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Title */}
        <div className="space-y-1.5">
          <Label htmlFor="title">Title <span className="text-destructive">*</span></Label>
          <Input
            id="title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Chapter 3 Review Quiz"
            maxLength={200}
          />
        </div>

        {/* Class */}
        <div className="space-y-1.5">
          <Label>Class <span className="text-destructive">*</span></Label>
          <Select onValueChange={setClassId} value={classId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a class" />
            </SelectTrigger>
            <SelectContent>
              {classes.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label htmlFor="description">Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
          <Textarea
            id="description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Brief description shown to students"
            rows={2}
            className="resize-none"
          />
        </div>

        {/* Time limit */}
        <div className="space-y-1.5">
          <Label htmlFor="timeLimit">Time Limit (minutes) <span className="text-muted-foreground text-xs">(optional — leave blank for unlimited)</span></Label>
          <Input
            id="timeLimit"
            type="number"
            value={timeLimitMin}
            onChange={e => setTimeLimitMin(e.target.value)}
            placeholder="e.g. 30"
            min={1}
            max={180}
          />
        </div>

        {/* Scheduled open/close */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="openAt">Opens At <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input id="openAt" type="datetime-local" value={openAt} onChange={e => setOpenAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="closeAt">Closes At <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input id="closeAt" type="datetime-local" value={closeAt} onChange={e => setCloseAt(e.target.value)} />
          </div>
        </div>

        <Button type="submit" disabled={saving} className="w-full">
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Creating…' : 'Create & Add Questions'}
        </Button>
      </form>
    </div>
  )
}
