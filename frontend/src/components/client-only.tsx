'use client'

import { useEffect, useState } from 'react'
import { useAuthStore } from '@/store/auth.store'

export function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Rehydrate Zustand store from localStorage on client mount
    useAuthStore.persist.rehydrate()

    // After rehydration, restore the Authorization header on the axios instance
    // so that requests fired before Zustand syncs still carry the token.
    const stored = localStorage.getItem('halqa-auth')
    if (stored) {
      try {
        const { state } = JSON.parse(stored)
        if (state?.accessToken) {
          const api = require('@/lib/api').default
          api.defaults.headers.common['Authorization'] = `Bearer ${state.accessToken}`
        }
      } catch {}
    }

    setMounted(true)
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
