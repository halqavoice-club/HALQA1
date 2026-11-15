'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/store/auth.store'

export type PushPermission = 'default' | 'granted' | 'denied'

export function usePushNotifications() {
  const { isAuthenticated } = useAuthStore()
  const [supported, setSupported] = useState(() => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator)
  const [permission, setPermission] = useState<PushPermission>(() => typeof window !== 'undefined' && 'Notification' in window ? Notification.permission as PushPermission : 'default')

  const requestPermission = useCallback(async () => {
    if (!supported) return 'denied' as PushPermission
    try {
      const result = await Notification.requestPermission()
      setPermission(result as PushPermission)
      return result as PushPermission
    } catch {
      return 'denied' as PushPermission
    }
  }, [supported])

  const sendLocalNotification = useCallback((title: string, body: string, options?: NotificationOptions) => {
    if (!supported || permission !== 'granted') return
    try {
      new Notification(title, {
        body,
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
        ...options
      })
    } catch {}
  }, [supported, permission])

  return { supported, permission, requestPermission, sendLocalNotification }
}
