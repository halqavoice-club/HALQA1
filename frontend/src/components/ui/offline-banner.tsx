'use client'

import { useState, useEffect } from 'react'
import { WifiOff, Wifi } from 'lucide-react'

export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(true)
  const [showReconnected, setShowReconnected] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    setIsOnline(navigator.onLine)

    const handleOffline = () => setIsOnline(false)
    const handleOnline = () => {
      setIsOnline(true)
      setShowReconnected(true)
      setTimeout(() => setShowReconnected(false), 3000)
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  if (isOnline && !showReconnected) return null

  return (
    <div className={`fixed top-14 md:top-0 left-0 right-0 z-[90] flex items-center justify-center gap-2 py-2 text-sm font-medium transition-all ${
      isOnline
        ? 'bg-green-500 text-white'
        : 'bg-red-500 text-white'
    }`}>
      {isOnline ? (
        <><Wifi className="w-4 h-4" /> Back online</>
      ) : (
        <><WifiOff className="w-4 h-4" /> No internet connection — some features may not work</>
      )}
    </div>
  )
}
