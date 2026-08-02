'use client'

import { useEffect, useCallback, useRef } from 'react'
import { useAttendanceStore, AttendanceStatus } from '@/store/attendance.store'
import api from '@/lib/api'
import { getSocket } from '@/lib/socket'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Auto-sync a single attendance record to the API.
 * Falls back to offline queue if network is unavailable.
 */
export function useAttendanceSync(classId: string, date: string) {
  const { setSavingState, addToOfflineQueue, removeFromOfflineQueue, offlineQueue } = useAttendanceStore()
  const queryClient = useQueryClient()
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const syncRecord = useCallback(async (studentId: string, status: string) => {
    if (!classId || !date || !studentId) return

    setSavingState(studentId, 'saving')

    try {
      await api.post('/attendance', { classId, studentId, date, status, checkInMethod: 'manual' })
      setSavingState(studentId, 'saved')
      removeFromOfflineQueue(studentId, classId, date)
      queryClient.invalidateQueries({ queryKey: ['attendance', classId, date] })

      // Broadcast via socket
      const socket = getSocket()
      if (socket) {
        socket.emit('attendance:update', { classId, studentId, status, date })
      }

      // Clear saved indicator after 1.5s
      setTimeout(() => setSavingState(studentId, 'saved'), 1500)
    } catch {
      // Network error — queue for later
      addToOfflineQueue({ studentId, classId, date, status: status as AttendanceStatus, synced: false, updatedAt: Date.now() })
      setSavingState(studentId, 'error')
    }
  }, [classId, date, setSavingState, addToOfflineQueue, removeFromOfflineQueue, queryClient])

  // Debounced sync — waits 400ms after last tap before saving
  const debouncedSync = useCallback((studentId: string, status: string) => {
    clearTimeout(debounceTimers.current[studentId])
    debounceTimers.current[studentId] = setTimeout(() => {
      syncRecord(studentId, status)
    }, 400)
  }, [syncRecord])

  // Sync offline queue when online
  useEffect(() => {
    const handleOnline = async () => {
      const queue = useAttendanceStore.getState().offlineQueue
      if (queue.length === 0) return

      for (const record of queue) {
        try {
          await api.post('/attendance', {
            classId: record.classId,
            studentId: record.studentId,
            date: record.date,
            status: record.status,
            checkInMethod: 'manual'
          })
          removeFromOfflineQueue(record.studentId, record.classId, record.date)
        } catch {
          // Still offline, keep in queue
        }
      }
    }

    window.addEventListener('online', handleOnline)
    // Try to sync on mount too
    if (navigator.onLine) handleOnline()

    return () => window.removeEventListener('online', handleOnline)
  }, [removeFromOfflineQueue])

  return { debouncedSync, syncRecord }
}
