'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { useEducationRole } from '@/hooks/useEducationRole'
import { Plus, Clock, BookOpen, Loader2, Trash2 } from 'lucide-react'
import { ErrorState } from '@/components/ui/error-state'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const HOURS = Array.from({ length: 14 }, (_, i) => {
  const h = i + 7 // 7am to 8pm
  return { value: `${h.toString().padStart(2, '0')}:00`, label: `${h > 12 ? h - 12 : h}:00 ${h >= 12 ? 'PM' : 'AM'}` }
})

const CLASS_COLORS = [
  'bg-blue-100 text-blue-800 border-blue-200',
  'bg-green-100 text-green-800 border-green-200',
  'bg-purple-100 text-purple-800 border-purple-200',
  'bg-orange-100 text-orange-800 border-orange-200',
  'bg-pink-100 text-pink-800 border-pink-200',
  'bg-teal-100 text-teal-800 border-teal-200',
  'bg-yellow-100 text-yellow-800 border-yellow-200',
]

interface ScheduleSlot {
  classId: string
  className: string
  day: number
  startTime: string
  endTime: string
  room?: string
  teacher?: string
  colorIndex: number
}

export default function SchedulePage() {
  const { user } = useAuthStore()
  const { isAdmin, isTeacher, isStudent, isGuardian, effectiveRole } = useEducationRole()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({
    classId: '', day: '1', startTime: '08:00', endTime: '09:00', room: ''
  })

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api.get('/classes').then(r => r.data.data)
  })

  // Build schedule from class data (classes have a schedule JSON field)
  const { data: scheduleData, isLoading, isError: scheduleError, refetch: refetchSchedule } = useQuery({
    queryKey: ['schedule'],
    queryFn: async () => {
      const res = await api.get('/classes')
      const allClasses = res.data.data || []
      const slots: ScheduleSlot[] = []
      allClasses.forEach((cls: any, idx: number) => {
        if (cls.schedule && Array.isArray(cls.schedule)) {
          cls.schedule.forEach((slot: any) => {
            slots.push({
              classId: cls.id,
              className: cls.name,
              day: slot.day,
              startTime: slot.startTime,
              endTime: slot.endTime,
              room: slot.room || cls.room,
              teacher: cls.teacherClasses?.[0]?.teacher?.user
                ? `${cls.teacherClasses[0].teacher.user.firstName} ${cls.teacherClasses[0].teacher.user.lastName}`
                : undefined,
              colorIndex: idx % CLASS_COLORS.length
            })
          })
        }
      })
      return slots
    }
  })

  const updateScheduleMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const cls = await api.get(`/classes/${data.classId}`).then(r => r.data.data)
      const existing = cls.schedule || []
      const newSlot = { day: parseInt(data.day), startTime: data.startTime, endTime: data.endTime, room: data.room }
      const updated = [...existing, newSlot]
      return api.put(`/classes/${data.classId}`, { schedule: updated })
    },
    onSuccess: () => {
      toast({ title: 'Schedule updated' })
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
      setShowAdd(false)
      setForm({ classId: '', day: '1', startTime: '08:00', endTime: '09:00', room: '' })
    },
    onError: () => toast({ title: 'Failed to update schedule', variant: 'destructive' })
  })

  const deleteSlotMutation = useMutation({
    mutationFn: async ({ classId, day, startTime }: { classId: string; day: number; startTime: string }) => {
      const cls = await api.get(`/classes/${classId}`).then(r => r.data.data)
      const existing: any[] = cls.schedule || []
      const updated = existing.filter(s => !(s.day === day && s.startTime === startTime))
      return api.put(`/classes/${classId}`, { schedule: updated })
    },
    onSuccess: () => {
      toast({ title: 'Slot removed' })
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
    },
    onError: () => toast({ title: 'Failed to remove slot', variant: 'destructive' })
  })

  const canEdit = isTeacher
  const slots = scheduleData || []

  const getSlotsForDay = (dayIndex: number) =>
    slots.filter(s => s.day === dayIndex + 1)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))

  const workDays = DAYS.slice(0, 6) // Mon–Sat

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Class Schedule</h1>
          <p className="text-gray-500 text-sm">Weekly timetable for all classes</p>
        </div>
        {canEdit && (
          <Button onClick={() => setShowAdd(true)} className="bg-halqa-700 hover:bg-halqa-800 gap-2">
            <Plus className="w-4 h-4" /> Add Slot
          </Button>
        )}
      </div>

      {/* Weekly grid */}
      {isLoading ? (
        <div className="h-96 bg-gray-100 rounded-xl animate-pulse" />
      ) : scheduleError ? (
        <ErrorState onRetry={refetchSchedule} />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            {/* Day headers */}
            <div className="grid grid-cols-6 gap-2 mb-3">
              {workDays.map(day => (
                <div key={day} className="text-center">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{day.slice(0, 3)}</p>
                </div>
              ))}
            </div>

            {/* Schedule grid */}
            <div className="grid grid-cols-6 gap-2">
              {workDays.map((day, dayIdx) => {
                const daySlots = getSlotsForDay(dayIdx)
                return (
                  <div key={day} className="space-y-2 min-h-[200px]">
                    {daySlots.length === 0 ? (
                      <div className="h-full min-h-[80px] border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center">
                        <p className="text-xs text-gray-300">No classes</p>
                      </div>
                    ) : (
                      daySlots.map((slot, i) => (
                        <div
                          key={`${slot.classId}-${i}`}
                          className={`rounded-xl p-3 border ${CLASS_COLORS[slot.colorIndex]} text-xs group relative`}
                        >
                          <p className="font-semibold truncate pr-5">{slot.className}</p>
                          <p className="flex items-center gap-1 mt-1 opacity-75">
                            <Clock className="w-3 h-3" />
                            {slot.startTime} – {slot.endTime}
                          </p>
                          {slot.room && <p className="opacity-75 mt-0.5">📍 {slot.room}</p>}
                          {slot.teacher && <p className="opacity-75 mt-0.5 truncate">👤 {slot.teacher}</p>}
                          {canEdit && (
                            <button
                              onClick={() => {
                                if (confirm(`Remove "${slot.className}" from ${DAYS[slot.day - 1]} at ${slot.startTime}?`)) {
                                  deleteSlotMutation.mutate({ classId: slot.classId, day: slot.day, startTime: slot.startTime })
                                }
                              }}
                              className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded bg-white/60 hover:bg-white text-red-500 hover:text-red-600"
                              title="Remove slot"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      {slots.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Array.from(new Map(slots.map(s => [s.classId, s])).values()).map(slot => (
            <Badge key={slot.classId} className={`${CLASS_COLORS[slot.colorIndex]} border`}>
              {slot.className}
            </Badge>
          ))}
        </div>
      )}

      {slots.length === 0 && !isLoading && (
        <div className="text-center py-16 text-gray-500">
          <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="font-medium">No schedule set up yet</p>
          <p className="text-sm mt-1">Add schedule slots to classes to see them here</p>
          {canEdit && (
            <Button onClick={() => setShowAdd(true)} className="mt-4 bg-halqa-700 hover:bg-halqa-800">
              Add First Slot
            </Button>
          )}
        </div>
      )}

      {/* Add slot dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Schedule Slot</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Class *</Label>
              <Select value={form.classId || '__none__'} onValueChange={v => setForm(f => ({ ...f, classId: v === '__none__' ? '' : v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select a class…</SelectItem>
                  {(classes || []).map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Day *</Label>
              <Select value={form.day} onValueChange={v => setForm(f => ({ ...f, day: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map((d, i) => (
                    <SelectItem key={d} value={String(i + 1)}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Time *</Label>
                <Select value={form.startTime} onValueChange={v => setForm(f => ({ ...f, startTime: v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOURS.map(h => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>End Time *</Label>
                <Select value={form.endTime} onValueChange={v => setForm(f => ({ ...f, endTime: v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOURS.map(h => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Room (optional)</Label>
              <Input className="mt-1" placeholder="e.g., Room A" value={form.room}
                onChange={e => setForm(f => ({ ...f, room: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button
              onClick={() => updateScheduleMutation.mutate(form)}
              disabled={!form.classId || updateScheduleMutation.isPending}
              className="bg-halqa-700 hover:bg-halqa-800 gap-2"
            >
              {updateScheduleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add Slot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
