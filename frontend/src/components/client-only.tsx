'use client'

import { useEffect, useState } from 'react'
import { useAuthStore } from '@/store/auth.store'

export function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    async function init() {
      // Rehydrate Zustand store from localStorage on client mount
      useAuthStore.persist.rehydrate()

      // After rehydration, silently refresh the access token using the
      // httpOnly refresh cookie. This restores the in-memory token after
      // a page reload. We AWAIT this so the token is set before we render
      // any UI that fires API requests.
      // (FE-001: access tokens must never be stored in localStorage)
      const { isAuthenticated, refreshToken } = useAuthStore.getState()
      if (isAuthenticated) {
        try {
          await refreshToken()
        } catch {
          // If refresh fails the user will be redirected to login inside refreshToken()
        }
      }

      setMounted(true)
    }

    init()
  }, [])

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-700" />
      </div>
    )
  }

  return <>{children}</>
}
