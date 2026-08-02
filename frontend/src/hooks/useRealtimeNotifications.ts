'use client'

/**
 * useRealtimeNotifications — subscribes to server-sent notification events
 * and feeds them into the persistent notification store (bell icon).
 *
 * Backend emits `notification:new` from:
 *   - notification.service.js  (attendance, behavior, grades, assignments)
 *   - notification.worker.js   (background jobs)
 *   - message.controller.js    (broadcast messages)
 *   - groupChat.controller.js  (group chat messages to offline members)
 *
 * `useSocket.ts` (mounted separately) also handles `notification:new` for
 * query invalidation + browser push — this hook feeds the in-app bell store.
 */

import { useEffect } from 'react'
import { useNotificationStore } from '@/store/notifications.store'
import { getSocket } from '@/lib/socket'
import { useQueryClient } from '@tanstack/react-query'

export function useRealtimeNotifications() {
  const addNotification = useNotificationStore((state) => state.addNotification)
  const queryClient     = useQueryClient()

  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    // ── Primary event: backend notification:new ─────────────────────────────
    // Payload: { id, userId, type, title, body, data, isRead, createdAt }
    const handleNotificationNew = (data: any) => {
      if (!data?.title) return
      addNotification({
        type:    mapType(data.type),
        title:   data.title,
        message: data.body ?? '',
        actionUrl:   resolveActionUrl(data),
        actionLabel: 'View',
      })
      // Also invalidate the notifications query so the bell count refreshes
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread'] })
    }

    // ── Legacy event names (kept for backward compat) ───────────────────────
    const handleLegacyGrade = (data: any) => {
      addNotification({
        type: 'success',
        title: 'Grade Posted',
        message: `Your grade for ${data?.assignment || 'an assignment'} has been posted`,
        actionUrl: '/grades',
        actionLabel: 'View',
      })
    }

    const handleLegacyAttendance = (data: any) => {
      addNotification({
        type: 'info',
        title: 'Attendance Marked',
        message: data?.status === 'present' ? 'You were marked present' : 'You were marked absent',
        actionUrl: '/attendance',
        actionLabel: 'View',
      })
    }

    const handleLegacyAssignment = (data: any) => {
      addNotification({
        type: 'info',
        title: 'New Assignment',
        message: data?.title || 'A new assignment has been created',
        actionUrl: data?.id ? `/assignments/${data.id}` : '/assignments',
        actionLabel: 'View',
      })
    }

    socket.on('notification:new',   handleNotificationNew)
    socket.on('grade_posted',        handleLegacyGrade)
    socket.on('attendance_marked',   handleLegacyAttendance)
    socket.on('assignment_created',  handleLegacyAssignment)

    return () => {
      socket.off('notification:new',   handleNotificationNew)
      socket.off('grade_posted',        handleLegacyGrade)
      socket.off('attendance_marked',   handleLegacyAttendance)
      socket.off('assignment_created',  handleLegacyAssignment)
    }
  }, [addNotification, queryClient])

  return {
    notifications:      useNotificationStore((state) => state.notifications),
    unreadCount:        useNotificationStore((state) => state.unreadCount),
    markAsRead:         useNotificationStore((state) => state.markAsRead),
    markAllAsRead:      useNotificationStore((state) => state.markAllAsRead),
    deleteNotification: useNotificationStore((state) => state.deleteNotification),
    clearAll:           useNotificationStore((state) => state.clearAll),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Map backend NotificationType enum to the store's UI severity */
function mapType(type?: string): 'info' | 'success' | 'warning' | 'error' {
  if (!type) return 'info'
  const t = type.toUpperCase()
  if (['GRADE', 'FRIEND_ACCEPTED', 'GIFT_RECEIVED', 'TIP_RECEIVED', 'NEW_SUBSCRIBER'].includes(t))
    return 'success'
  if (['ATTENDANCE', 'BEHAVIOR', 'LIVE_CLASS_START', 'VOICE_ROOM_LIVE'].includes(t))
    return 'warning'
  if (['SYSTEM'].includes(t))
    return 'error'
  return 'info'
}

/** Derive an action URL from notification data payload */
function resolveActionUrl(data: any): string | undefined {
  const payload = data?.data ?? {}
  const type    = (data?.type ?? '').toUpperCase()

  if (payload.groupConversationId) return '/group-chat'
  if (payload.messageId && type === 'MESSAGE') return '/messages'
  if (type === 'GRADE')            return '/grades'
  if (type === 'ATTENDANCE')       return '/attendance'
  if (type === 'BEHAVIOR')         return '/behavior'
  if (type === 'ANNOUNCEMENT')     return '/announcements'
  if (type === 'LIVE_CLASS_START') return '/live-class'
  if (type === 'VOICE_ROOM_LIVE')  return '/voice-club'
  if (type === 'FOLLOW' || type === 'FRIEND_REQUEST' || type === 'FRIEND_ACCEPTED')
    return '/social'
  if (type === 'COINS_PURCHASED')  return '/wallet'
  if (type === 'GIFT_RECEIVED' || type === 'TIP_RECEIVED' || type === 'NEW_SUBSCRIBER')
    return '/creator'
  if (type === 'COMMUNITY_INVITE' || type === 'COMMUNITY_JOIN')
    return '/communities'
  if (type === 'MENTION')          return '/feed'
  return '/notifications'
}
