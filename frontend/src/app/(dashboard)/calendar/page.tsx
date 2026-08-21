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
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { useEducationRole } from '@/hooks/useEducationRole'
import { Plus, Calendar, ChevronLeft, ChevronRight, Trash2, Filter } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, isToday, addMonths, subMonths,
} from 'date-fns'

const EVENT_TYPES = ['EXAM', 'ASSIGNMENT', 'HOLIDAY', 'MEETING', 'CLASS', 'PRAYER', 'ACTIVITY', 'OTHER']

const EVENT_COLORS: Record<string, string> = {
  EXAM:       'bg-red-100 text-red-700 border-red-200',
  ASSIGNMENT: 'bg-blue-100 text-blue-700 border-blue-200',
  HOLIDAY:    'bg-green-100 text-green-700 border-green-200',
  MEETING:    'bg-purple-100 text-purple-700 border-purple-200',
  CLASS:      'bg-halqa-100 text-halqa-700 border-halqa-200',
  PRAYER:     'bg-yellow-100 text-yellow-700 border-yellow-200',
  ACTIVITY:   'bg-orange-100 text-orange-700 border-orange-200',
  OTHER:      'bg-gray-100 text-gray-700 border-gray-200',
}

export default function CalendarPage() {
  const { toast } = useToast()
  const { user } = useAuthStore()
  const { isAdmin, isTeacher, isStudent, isGuardian, effectiveRole } = useEducationRole()
  const queryClient = useQueryClient()

  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [showForm, setShowForm] = useState(false)
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [typeFilter, setTypeFilter] = useState('')
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: '', type: 'CLASS', startDate: '', endDate: '', description: '', allDay: true,
  })

  const canCreate = isTeacher
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)

  const { data: events, isLoading: eventsLoading, isError: eventsError, refetch: refetchEvents } = useQuery({
    queryKey: ['calendar', format(monthStart, 'yyyy-MM')],
    queryFn: () =>
      api.get('/calendar', {
        params: { startDate: monthStart.toISOString(), endDate: monthEnd.toISOString() },
      }).then(r => r.data.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => api.post('/calendar', data),
    onSuccess: () => {
      toast({ title: 'Event created' })
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
      setShowForm(false)
      setForm({ title: '', type: 'CLASS', startDate: '', endDate: '', description: '', allDay: true })
    },
    onError: () => toast({ title: 'Failed to create event', variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/calendar/${id}`),
    onSuccess: () => {
      toast({ title: 'Event deleted' })
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
      setDeleteEventId(null)
    },
    onError: () => toast({ title: 'Delete failed', variant: 'destructive' }),
  })

  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
  const allEvents: any[] = events || []
  const filteredEvents = typeFilter ? allEvents.filter(e => e.type === typeFilter) : allEvents

  const getEventsForDay = (day: Date) =>
    filteredEvents.filter((e: any) => isSameDay(new Date(e.startDate), day))

  const selectedDayEvents = selectedDay ? getEventsForDay(selectedDay) : []

  const upcomingEvents = filteredEvents
    .filter((e: any) => new Date(e.startDate) >= new Date())
    .sort((a: any, b: any) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
    .slice(0, 8)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Calendar</h1>
          <p className="text-gray-500 text-sm">School events, exams, and schedules</p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={typeFilter || 'all'} onValueChange={v => setTypeFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-36 h-9">
              <div className="flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-gray-400" />
                <SelectValue placeholder="All types" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {EVENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          {canCreate && (
            <Button onClick={() => setShowForm(true)} className="bg-halqa-700 hover:bg-halqa-800 gap-2">
              <Plus className="w-4 h-4" /> Add Event
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Calendar grid */}
        <Card className="lg:col-span-2 border-0 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">
                {format(currentMonth, 'MMMM yyyy')}
              </CardTitle>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(new Date())}>Today</Button>
                <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {eventsError ? (
              <ErrorState onRetry={refetchEvents} />
            ) : (
              <>
                <div className="grid grid-cols-7 mb-2">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                    <div key={d} className="text-center text-xs font-medium text-gray-500 py-2">{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: monthStart.getDay() }).map((_, i) => (
                    <div key={`e-${i}`} />
                  ))}
                  {days.map(day => {
                    const dayEvents = getEventsForDay(day)
                    const isSelected = selectedDay ? isSameDay(day, selectedDay) : false
                    return (
                      <button
                        key={day.toISOString()}
                        onClick={() => setSelectedDay(isSelected ? null : day)}
                        className={[
                          'min-h-[60px] p-1 rounded-lg text-left transition-all',
                          isSelected ? 'bg-halqa-100 ring-2 ring-halqa-400' :
                          isToday(day) ? 'bg-halqa-50' : 'hover:bg-gray-50',
                        ].join(' ')}
                      >
                        <span className={`text-xs font-medium block mb-1 ${isToday(day) ? 'text-halqa-700 font-bold' : 'text-gray-700'}`}>
                          {format(day, 'd')}
                        </span>
                        <div className="space-y-0.5">
                          {dayEvents.slice(0, 2).map((e: any) => (
                            <div key={e.id} className={`text-xs px-1 py-0.5 rounded truncate border ${EVENT_COLORS[e.type] || EVENT_COLORS.OTHER}`}>
                              {e.title}
                            </div>
                          ))}
                          {dayEvents.length > 2 && (
                            <div className="text-xs text-gray-400">+{dayEvents.length - 2}</div>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
                {/* Legend */}
                <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-gray-100">
                  {EVENT_TYPES.map(t => (
                    <button
                      key={t}
                      onClick={() => setTypeFilter(typeFilter === t ? '' : t)}
                      className={[
                        'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-all',
                        typeFilter === t
                          ? `${EVENT_COLORS[t]} font-semibold`
                          : 'border-gray-200 text-gray-500 hover:border-gray-300',
                      ].join(' ')}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Upcoming / selected day panel */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">
              {selectedDay ? format(selectedDay, 'MMMM d, yyyy') : 'Upcoming Events'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {eventsLoading ? (
              <div className="p-4 space-y-2">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {(selectedDay ? selectedDayEvents : upcomingEvents).map((event: any) => (
                  <div key={event.id} className="p-3 group">
                    <div className="flex items-start gap-2">
                      <div className={`flex-1 p-2.5 rounded-lg border ${EVENT_COLORS[event.type] || EVENT_COLORS.OTHER}`}>
                        <p className="text-sm font-medium">{event.title}</p>
                        <p className="text-xs mt-0.5 opacity-75">
                          {format(new Date(event.startDate), 'MMM d · h:mm a')} · {event.type}
                        </p>
                        {event.description && (
                          <p className="text-xs mt-1 opacity-70 line-clamp-2">{event.description}</p>
                        )}
                      </div>
                      {canCreate && (
                        <button
                          onClick={() => setDeleteEventId(event.id)}
                          className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-50 text-gray-400 hover:text-red-500 transition-all flex-shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {(selectedDay ? selectedDayEvents : upcomingEvents).length === 0 && (
                  <div className="text-center py-8 text-gray-400">
                    <Calendar className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                    <p className="text-sm">{selectedDay ? 'No events this day' : 'No upcoming events'}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create event modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Create Event"
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.title || !form.startDate || createMutation.isPending}
              className="bg-halqa-700 hover:bg-halqa-800"
            >
              {createMutation.isPending ? 'Creating...' : 'Create Event'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label>Title *</Label>
            <Input
              className="mt-1"
              placeholder="Event title"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start Date *</Label>
              <Input
                className="mt-1"
                type="datetime-local"
                value={form.startDate}
                onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
              />
            </div>
            <div>
              <Label>End Date</Label>
              <Input
                className="mt-1"
                type="datetime-local"
                value={form.endDate}
                onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <textarea
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-halqa-400 resize-none min-h-[80px]"
              placeholder="Optional description..."
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteEventId}
        title="Delete Event"
        message="Are you sure you want to delete this event?"
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => { if (deleteEventId) deleteMutation.mutate(deleteEventId) }}
        onCancel={() => setDeleteEventId(null)}
      />
    </div>
  )
}
