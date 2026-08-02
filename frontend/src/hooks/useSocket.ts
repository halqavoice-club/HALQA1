'use client'

import { useEffect } from 'react'
import { getSocket } from '@/lib/socket'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth.store'
import { toast } from '@/components/ui/use-toast'

// Browser push notification helper
function pushNotify(title: string, body: string, icon = '/icon-192x192.png') {
  if (typeof window === 'undefined') return
  if (Notification.permission !== 'granted') return
  try {
    new Notification(title, { body, icon, badge: icon })
  } catch {}
}

export function useSocketEvents() {
  const queryClient = useQueryClient()
  const { user, isAuthenticated } = useAuthStore()

  useEffect(() => {
    // Wait until the user is authenticated and socket is ready
    const socket = getSocket()
    if (!socket || !user || !isAuthenticated) return

    const onMessageNew = (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['messages'] })
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread'] })
      const title = `New message from ${data.sender?.firstName || 'Someone'}`
      const body  = data.body?.substring(0, 80) || ''
      toast({ title, description: body })
      pushNotify(title, body)
    }

    const onNotificationNew = (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread'] })
      if (data?.title) pushNotify(data.title, data.body || '')
    }

    const onAttendanceAlert = (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      const title = `Attendance: ${data.studentName}`
      const body  = `Marked as ${data.status} on ${new Date(data.date).toLocaleDateString()}`
      toast({ title, description: body, variant: data.status === 'ABSENT' ? 'destructive' : 'default' })
      pushNotify(title, body)
    }

    const onBehaviorAlert = (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      if (data.type === 'NEGATIVE') {
        const title = `Behavior Alert: ${data.studentName}`
        const body  = `${data.category}: ${data.points} points`
        toast({ title, description: body, variant: 'destructive' })
        pushNotify(title, body)
      }
    }

    const onAttendanceUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
    }

    socket.on('message:new',       onMessageNew)
    socket.on('notification:new',  onNotificationNew)
    socket.on('attendance:alert',  onAttendanceAlert)
    socket.on('behavior:alert',    onBehaviorAlert)
    socket.on('attendance:updated', onAttendanceUpdated)

    return () => {
      socket.off('message:new',       onMessageNew)
      socket.off('notification:new',  onNotificationNew)
      socket.off('attendance:alert',  onAttendanceAlert)
      socket.off('behavior:alert',    onBehaviorAlert)
      socket.off('attendance:updated', onAttendanceUpdated)
    }
  }, [isAuthenticated, user?.id, queryClient]) // re-register if user changes

}

export function useClassRoom(classId: string | null) {
  useEffect(() => {
    if (!classId) return
    const socket = getSocket()
    if (!socket) return
    socket.emit('join:class', classId)
    return () => { socket.emit('leave:class', classId) }
  }, [classId])
}
