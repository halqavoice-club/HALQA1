'use client'

import { useState, useEffect } from 'react'
import { Bell, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePushNotifications } from '@/hooks/usePushNotifications'

export function NotificationPermissionBanner() {
  const { supported, permission, requestPermission } = usePushNotifications()
  const [dismissed, setDismissed] = useState(true) // start hidden

  useEffect(() => {
    if (typeof window === 'undefined') return
    const wasDismissed = localStorage.getItem('notif-banner-dismissed')
    if (!wasDismissed && supported && permission === 'default') {
      // Show after 3 seconds
      const t = setTimeout(() => setDismissed(false), 3000)
      return () => clearTimeout(t)
    }
  }, [supported, permission])

  if (dismissed || !supported || permission !== 'default') return null

  const handleEnable = async () => {
    const result = await requestPermission()
    setDismissed(true)
    localStorage.setItem('notif-banner-dismissed', '1')
  }

  const handleDismiss = () => {
    setDismissed(true)
    localStorage.setItem('notif-banner-dismissed', '1')
  }

  return (
    <div className="fixed bottom-20 md:bottom-6 left-4 right-4 md:left-auto md:right-6 md:w-96 z-40 animate-fade-in">
      <div className="bg-halqa-800 text-white rounded-xl shadow-2xl p-4 flex items-start gap-3">
        <div className="w-9 h-9 bg-white/10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
          <Bell className="w-5 h-5 text-yellow-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">Enable Notifications</p>
          <p className="text-xs text-halqa-300 mt-0.5">
            Get instant alerts for student absences, new grades, and messages.
          </p>
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              onClick={handleEnable}
              className="bg-white text-halqa-800 hover:bg-halqa-100 h-8 text-xs font-semibold"
            >
              Enable
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              className="text-halqa-300 hover:text-white hover:bg-white/10 h-8 text-xs"
            >
              Not now
            </Button>
          </div>
        </div>
        <button onClick={handleDismiss} className="text-halqa-400 hover:text-white flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
