'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import {
  Bell, CheckCheck, Check, ClipboardCheck, BookMarked,
  Star, MessageSquare, Megaphone, Clock, Settings, Filter
} from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'

const TYPE_CONFIG: Record<string, { color: string; icon: React.ElementType; label: string }> = {
  ATTENDANCE:   { color: 'bg-red-100 text-red-700',    icon: ClipboardCheck, label: 'Attendance' },
  GRADE:        { color: 'bg-blue-100 text-blue-700',   icon: BookMarked,     label: 'Grade' },
  BEHAVIOR:     { color: 'bg-yellow-100 text-yellow-700', icon: Star,          label: 'Behavior' },
  MESSAGE:      { color: 'bg-green-100 text-green-700', icon: MessageSquare,  label: 'Message' },
  ANNOUNCEMENT: { color: 'bg-purple-100 text-purple-700', icon: Megaphone,    label: 'Announcement' },
  REMINDER:     { color: 'bg-orange-100 text-orange-700', icon: Clock,        label: 'Reminder' },
  SYSTEM:       { color: 'bg-gray-100 text-gray-700',   icon: Settings,       label: 'System' },
}

function formatTime(date: string) {
  const d = new Date(date)
  if (isToday(d)) return format(d, 'h:mm a')
  if (isYesterday(d)) return `Yesterday ${format(d, 'h:mm a')}`
  return format(d, 'MMM d, h:mm a')
}

export default function NotificationsPage() {
  const queryClient = useQueryClient()
  const [typeFilter, setTypeFilter] = useState('')
  const [showUnreadOnly, setShowUnreadOnly] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then(r => r.data),
    refetchInterval: 30000
  })

  const markAllMutation = useMutation({
    mutationFn: () => api.put('/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread'] })
    }
  })

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.put(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread'] })
    }
  })

  const allNotifications: any[] = data?.data || []
  const unread = allNotifications.filter(n => !n.isRead).length

  // Filter
  const notifications = allNotifications.filter(n => {
    if (showUnreadOnly && n.isRead) return false
    if (typeFilter && n.type !== typeFilter) return false
    return true
  })

  // Group by date
  const grouped: Record<string, any[]> = {}
  notifications.forEach(n => {
    const d = new Date(n.createdAt)
    const key = isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'MMMM d, yyyy')
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(n)
  })

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          <p className="text-gray-500 text-sm">
            {unread > 0 ? `${unread} unread` : 'All caught up'}
            {allNotifications.length > 0 && ` · ${allNotifications.length} total`}
          </p>
        </div>
        {unread > 0 && (
          <Button
            variant="outline" size="sm"
            onClick={() => markAllMutation.mutate()}
            disabled={markAllMutation.isPending}
            className="gap-2"
          >
            <CheckCheck className="w-4 h-4" />
            {markAllMutation.isPending ? 'Marking...' : 'Mark all read'}
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={() => setShowUnreadOnly(!showUnreadOnly)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
            showUnreadOnly
              ? 'bg-halqa-700 text-white border-halqa-700'
              : 'border-gray-200 text-gray-600 hover:border-halqa-300'
          }`}
        >
          <Bell className="w-3 h-3" />
          Unread only
          {unread > 0 && <span className={`ml-0.5 ${showUnreadOnly ? 'text-halqa-200' : 'text-halqa-600'}`}>({unread})</span>}
        </button>

        <div className="w-px h-4 bg-gray-200" />

        <button
          onClick={() => setTypeFilter('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
            !typeFilter ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-300'
          }`}
        >
          All
        </button>
        {Object.entries(TYPE_CONFIG).map(([type, cfg]) => {
          const count = allNotifications.filter(n => n.type === type).length
          if (count === 0) return null
          return (
            <button
              key={type}
              onClick={() => setTypeFilter(typeFilter === type ? '' : type)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                typeFilter === type ? cfg.color + ' border-transparent' : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {cfg.label}
              <span className="opacity-60">({count})</span>
            </button>
          )
        })}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : notifications.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Bell className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="font-medium">{showUnreadOnly || typeFilter ? 'No matching notifications' : 'No notifications'}</p>
          {(showUnreadOnly || typeFilter) && (
            <button
              onClick={() => { setShowUnreadOnly(false); setTypeFilter('') }}
              className="text-sm text-halqa-600 hover:text-halqa-700 mt-2"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).map(([dateLabel, items]) => (
            <div key={dateLabel}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">{dateLabel}</p>
              <div className="space-y-2">
                {items.map((notif: any) => {
                  const cfg = TYPE_CONFIG[notif.type] || TYPE_CONFIG.SYSTEM
                  const Icon = cfg.icon
                  return (
                    <Card
                      key={notif.id}
                      className={`border-0 shadow-sm cursor-pointer transition-all hover:shadow-md ${
                        !notif.isRead ? 'bg-blue-50/40 border-l-2 border-l-halqa-400' : ''
                      }`}
                      onClick={() => !notif.isRead && markReadMutation.mutate(notif.id)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          {/* Type icon */}
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.color}`}>
                            <Icon className="w-4 h-4" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className={`text-sm leading-snug ${!notif.isRead ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                                {notif.title}
                              </p>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <span className="text-xs text-gray-400">{formatTime(notif.createdAt)}</span>
                                {!notif.isRead && (
                                  <div className="w-2 h-2 bg-halqa-500 rounded-full" />
                                )}
                              </div>
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{notif.body}</p>
                            <div className="flex items-center gap-2 mt-2">
                              <Badge className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>
                              {notif.isRead && (
                                <span className="text-xs text-gray-400 flex items-center gap-0.5">
                                  <Check className="w-3 h-3" /> Read
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
