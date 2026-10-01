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
    // ── Shared handlers ───────────────────────────────────────────────────────
    const handleNotificationNew = (data: any) => {
      if (!data?.title) return
      addNotification({
        type:        mapType(data.type),
        title:       data.title,
        message:     data.body ?? '',
        actionUrl:   resolveActionUrl(data),
        actionLabel: 'View',
      })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread'] })
    }

    const handleLegacyGrade = (data: any) => {
      addNotification({
        type: 'success', title: 'Grade Posted',
        message: `Your grade for ${data?.assignment || 'an assignment'} has been posted`,
        actionUrl: '/grades', actionLabel: 'View',
      })
    }

    const handleLegacyAttendance = (data: any) => {
      addNotification({
        type: 'info', title: 'Attendance Marked',
        message: data?.status === 'present' ? 'You were marked present' : 'You were marked absent',
        actionUrl: '/attendance', actionLabel: 'View',
      })
    }

    const handleLegacyAssignment = (data: any) => {
      addNotification({
        type: 'info', title: 'New Assignment',
        message: data?.title || 'A new assignment has been created',
        actionUrl: data?.id ? `/assignments/${data.id}` : '/assignments',
        actionLabel: 'View',
      })
    }

    const handlePKInvitation = (data: any) => {
      // Fire a DOM event so PKInvitationToast can show the Accept/Decline UI
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pk:invitation:received', { detail: data }))
      }
      addNotification({
        type:        'info',
        title:       data.invitation?.sender
          ? `⚔️ ${data.invitation.sender.firstName} challenges you!`
          : '⚔️ PK Challenge!',
        message:     `${Math.floor((data.invitation?.durationSeconds ?? 300) / 60)} min battle`,
        actionUrl:   '/notifications',
        actionLabel: 'View',
      })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    }

    const handleJoinRequest = (data: any) => {
      addNotification({
        type:        'warning',
        title:       `Join request — ${data?.schoolName ?? 'Your School'}`,
        message:     `${data?.userName ?? 'A user'} wants to join as ${(data?.role ?? 'member').toLowerCase()}`,
        actionUrl:   '/school-memberships/manage',
        actionLabel: 'Review',
      })
      queryClient.invalidateQueries({ queryKey: ['school-members'] })
    }

    // ── Register listeners — works even if socket not yet ready ──────────────
    // We retry every 300ms until we can get a socket reference, then register.
    // Once registered, the socket's own reconnect logic re-fires 'connect'
    // events, but the listeners survive reconnects automatically.
    let socket = getSocket()
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let registered = false

    function register(s: ReturnType<typeof getSocket>) {
      if (!s || registered) return
      registered = true
      s.on('notification:new',  handleNotificationNew)
      s.on('grade_posted',       handleLegacyGrade)
      s.on('attendance_marked',  handleLegacyAttendance)
      s.on('assignment_created', handleLegacyAssignment)
      s.on('pk:invitation',      handlePKInvitation)
      s.on('school:join_request',handleJoinRequest)
    }

    function unregister(s: ReturnType<typeof getSocket>) {
      if (!s) return
      s.off('notification:new',  handleNotificationNew)
      s.off('grade_posted',       handleLegacyGrade)
      s.off('attendance_marked',  handleLegacyAttendance)
      s.off('assignment_created', handleLegacyAssignment)
      s.off('pk:invitation',      handlePKInvitation)
      s.off('school:join_request',handleJoinRequest)
    }

    if (socket) {
      register(socket)
    } else {
      // Socket not ready yet — poll until it is
      const poll = () => {
        socket = getSocket()
        if (socket) {
          register(socket)
        } else {
          retryTimer = setTimeout(poll, 300)
        }
      }
      retryTimer = setTimeout(poll, 300)
    }

    return () => {
      if (retryTimer) clearTimeout(retryTimer)
      unregister(socket)
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
  if (['ATTENDANCE', 'BEHAVIOR', 'LIVE_CLASS_START', 'VOICE_ROOM_LIVE', 'SCHOOL_JOIN_REQUEST'].includes(t))
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
  if (type === 'SCHOOL_JOIN_REQUEST') return '/school-memberships/manage'
  if (type === 'MENTION')          return '/feed'
  return '/notifications'
}
