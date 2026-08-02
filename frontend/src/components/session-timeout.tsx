'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuthStore } from '@/store/auth.store'
import { Clock, LogOut, RefreshCw } from 'lucide-react'

const WARNING_BEFORE_MS = 2 * 60 * 1000  // warn 2 min before expiry
const SESSION_DURATION_MS = 15 * 60 * 1000 // 15 min (matches JWT_EXPIRES_IN)

export function SessionTimeout() {
  const { isAuthenticated, refreshToken, logout } = useAuthStore()
  const [showWarning, setShowWarning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(120)
  const [lastActivity, setLastActivity] = useState(Date.now())

  const resetActivity = useCallback(() => {
    setLastActivity(Date.now())
    setShowWarning(false)
  }, [])

  // Track user activity
  useEffect(() => {
    if (!isAuthenticated) return
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart']
    events.forEach(e => window.addEventListener(e, resetActivity, { passive: true }))
    return () => events.forEach(e => window.removeEventListener(e, resetActivity))
  }, [isAuthenticated, resetActivity])

  // Check session expiry
  useEffect(() => {
    if (!isAuthenticated) return
    const interval = setInterval(() => {
      const idle = Date.now() - lastActivity
      const remaining = SESSION_DURATION_MS - idle

      if (remaining <= 0) {
        logout()
      } else if (remaining <= WARNING_BEFORE_MS) {
        setShowWarning(true)
        setSecondsLeft(Math.ceil(remaining / 1000))
      } else {
        setShowWarning(false)
      }
    }, 10000) // check every 10s

    return () => clearInterval(interval)
  }, [isAuthenticated, lastActivity, logout])

  // Countdown when warning shown
  useEffect(() => {
    if (!showWarning) return
    const t = setInterval(() => setSecondsLeft(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [showWarning])

  const handleExtend = async () => {
    await refreshToken()
    resetActivity()
  }

  if (!showWarning || !isAuthenticated) return null

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60

  return (
    <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4">
      <div className="bg-orange-600 text-white rounded-2xl shadow-2xl p-4 flex items-start gap-3 animate-in slide-in-from-bottom-4">
        <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
          <Clock className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">Session expiring soon</p>
          <p className="text-orange-100 text-xs mt-0.5">
            You'll be logged out in {mins > 0 ? `${mins}m ` : ''}{secs}s due to inactivity
          </p>
          <div className="flex gap-2 mt-3">
            <button onClick={handleExtend}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-orange-600 rounded-lg text-xs font-semibold hover:bg-orange-50 transition-colors">
              <RefreshCw className="w-3 h-3" /> Stay logged in
            </button>
            <button onClick={logout}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 text-white rounded-lg text-xs font-medium hover:bg-white/30 transition-colors">
              <LogOut className="w-3 h-3" /> Log out
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
