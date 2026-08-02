'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { Plus, Clock, Play, Square, Timer, Users, Trash2 } from 'lucide-react'
import { ErrorState } from '@/components/ui/error-state'
import { format, differenceInSeconds } from 'date-fns'

const ACTIVITY_TYPES = ['EXAM', 'BREAK', 'LIBRARY', 'PRAYER', 'MEMORIZATION', 'COUNSELING', 'OTHER']

const TYPE_COLORS: Record<string, string> = {
  EXAM:         'bg-red-100 text-red-700',
  BREAK:        'bg-green-100 text-green-700',
  LIBRARY:      'bg-blue-100 text-blue-700',
  PRAYER:       'bg-yellow-100 text-yellow-700',
  MEMORIZATION: 'bg-purple-100 text-purple-700',
  COUNSELING:   'bg-pink-100 text-pink-700',
  OTHER:        'bg-gray-100 text-gray-700',
}

function LiveTimer({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const start = new Date(startTime).getTime()
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startTime])

  const h = Math.floor(elapsed / 3600)
  const m = Math.floor((elapsed % 3600) / 60)
  const s = elapsed % 60

  return (
    <span className="font-mono text-sm font-bold text-green-700">
      {h > 0 ? `${h}h ` : ''}{m.toString().padStart(2, '0')}:{s.toString().padStart(2, '0')}
    </span>
  )
}

export default function ActivitiesPage() {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [showForm, setShowForm] = useState(false)
  const [selectedClass, setSelectedClass] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [form, setForm] = useState({ title: '', type: 'PRAYER', description: '' })

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api.get('/classes').then(r => r.data.data),
  })

  const { data: activities, isLoading, isError, refetch } = useQuery({
    queryKey: ['activities', selectedClass],
    queryFn: () =>
      api.get('/activities', { params: { classId: selectedClass || undefined } }).then(r => r.data.data),
    refetchInterval: 10000,
  })

  const createMutation = useMutation({
    mutationFn: (d: typeof form) => api.post('/activities', { ...d, classId: selectedClass || undefined }),
    onSuccess: () => {
      toast({ title: 'Activity created' })
      queryClient.invalidateQueries({ queryKey: ['activities'] })
      setShowForm(false)
      setForm({ title: '', type: 'PRAYER', description: '' })
    },
    onError: () => toast({ title: 'Failed to create activity', variant: 'destructive' }),
  })

  const startMutation = useMutation({
    mutationFn: (id: string) => api.post(`/activities/${id}/start`),
    onSuccess: () => {
      toast({ title: 'Activity started' })
      queryClient.invalidateQueries({ queryKey: ['activities'] })
    },
  })

  const stopMutation = useMutation({
    mutationFn: (id: string) => api.post(`/activities/${id}/stop`),
    onSuccess: () => {
      toast({ title: 'Activity stopped' })
      queryClient.invalidateQueries({ queryKey: ['activities'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/activities/${id}`),
    onSuccess: () => {
      toast({ title: 'Activity deleted' })
      queryClient.invalidateQueries({ queryKey: ['activities'] })
      setDeleteId(null)
    },
    onError: () => toast({ title: 'Delete failed', variant: 'destructive' }),
  })

  const canCreate = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(user?.role || '')
  const activeCount = (activities || []).filter((a: any) => a.isActive).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Timed Activities</h1>
          <p className="text-gray-500 text-sm">
            Track exams, prayer sessions, memorization, and more
            {activeCount > 0 && (
              <span className="ml-2 text-green-600 font-medium">· {activeCount} live</span>
            )}
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowForm(true)} className="bg-halqa-700 hover:bg-halqa-800 gap-2">
            <Plus className="w-4 h-4" /> New Activity
          </Button>
        )}
      </div>

      {/* Class filter */}
      <div className="flex items-center gap-3">
        <Label className="text-sm text-gray-600 whitespace-nowrap">Filter by class:</Label>
        <Select value={selectedClass || 'all'} onValueChange={v => setSelectedClass(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-48 h-9">
            <SelectValue placeholder="All classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classes</SelectItem>
            {(classes || []).map((c: any) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Activities list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (activities || []).length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Timer className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p>No activities yet</p>
          {canCreate && <p className="text-sm mt-1 text-gray-400">Click "New Activity" to create one</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {(activities || []).map((activity: any) => (
            <Card key={activity.id} className={`border-0 shadow-sm ${activity.isActive ? 'ring-2 ring-green-400' : ''}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className={`p-2.5 rounded-xl flex-shrink-0 ${TYPE_COLORS[activity.type] || TYPE_COLORS.OTHER}`}>
                    <Clock className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900">{activity.title}</h3>
                      <Badge className={`text-xs ${TYPE_COLORS[activity.type] || TYPE_COLORS.OTHER}`}>
                        {activity.type}
                      </Badge>
                      {activity.isActive && (
                        <Badge className="text-xs bg-green-500 text-white gap-1">
                          <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse inline-block" />
                          LIVE
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-gray-500 flex-wrap">
                      {activity.isActive && activity.startTime && (
                        <span className="flex items-center gap-1">
                          <Timer className="w-3 h-3" />
                          <LiveTimer startTime={activity.startTime} />
                        </span>
                      )}
                      {!activity.isActive && activity.startTime && activity.endTime && (
                        <span>
                          Duration:{' '}
                          {Math.round(
                            differenceInSeconds(new Date(activity.endTime), new Date(activity.startTime)) / 60
                          )}{' '}
                          min
                        </span>
                      )}
                      {activity.startTime && (
                        <span>Started: {format(new Date(activity.startTime), 'h:mm a')}</span>
                      )}
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" /> {activity._count?.participants || 0} participants
                      </span>
                    </div>
                    {activity.description && (
                      <p className="text-xs text-gray-400 mt-0.5">{activity.description}</p>
                    )}
                  </div>
                  {canCreate && (
                    <div className="flex gap-2 flex-shrink-0">
                      {!activity.isActive ? (
                        <Button
                          size="sm"
                          onClick={() => startMutation.mutate(activity.id)}
                          disabled={startMutation.isPending}
                          className="bg-green-600 hover:bg-green-700 gap-1"
                        >
                          <Play className="w-3 h-3" /> Start
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => stopMutation.mutate(activity.id)}
                          disabled={stopMutation.isPending}
                          className="border-red-200 text-red-600 hover:bg-red-50 gap-1"
                        >
                          <Square className="w-3 h-3" /> Stop
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteId(activity.id)}
                        className="text-gray-400 hover:text-red-500 hover:bg-red-50 h-8 w-8 p-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New Activity"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.title || createMutation.isPending}
              className="bg-halqa-700 hover:bg-halqa-800"
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label>Title *</Label>
            <Input
              className="mt-1"
              placeholder="e.g., Juz 30 Memorization"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTIVITY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Input
              className="mt-1"
              placeholder="Brief description..."
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Activity"
        message="Are you sure you want to delete this activity?"
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId) }}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  )
}
