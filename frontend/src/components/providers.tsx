'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/store/auth.store'
import { useThemeStore, applyTheme, applyLanguage } from '@/store/theme.store'
import { initSocket, disconnectSocket } from '@/lib/socket'
import { useSocketEvents } from '@/hooks/useSocket'
import { analytics } from '@/lib/analytics'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
})

/**
 * SocketManager — mounts only after socket is initialised.
 * We pass the socket instance as a prop so the child re-renders
 * (and re-registers listeners) if the token changes.
 */
function SocketManager() {
  useSocketEvents()
  return null
}

function ThemeManager() {
  const { theme, language } = useThemeStore()

  useEffect(() => {
    applyTheme(theme)
    applyLanguage(language)
  }, [theme, language])

  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  return null
}

export function Providers({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, getAccessToken } = useAuthStore()
  const accessToken = getAccessToken()
  // Track whether the socket has been successfully initialised this session
  const socketReadyRef = useRef(false)

  useEffect(() => {
    // Rehydrate the Zustand persist store from localStorage on mount.
    // The store uses skipHydration: true to avoid SSR mismatches, so we
    // must trigger hydration manually here on the client.
    useAuthStore.persist.rehydrate()
  }, [])

  useEffect(() => {
    // Initialize analytics once
    analytics.initialize()
  }, [])

  // FE-R-005: Cross-tab logout synchronisation.
  // When the user logs out in one tab, the Zustand persist middleware writes
  // the updated state (isAuthenticated: false) to localStorage under the key
  // 'halqa-auth'. The browser fires a 'storage' event in ALL OTHER open tabs
  // (never in the tab that made the write), so there is no risk of an
  // infinite logout loop.
  useEffect(() => {
    const handleStorageLogout = (event: StorageEvent) => {
      if (event.key === 'halqa-auth') {
        // Only react if this tab currently believes it is authenticated
        const isCurrentlyAuth = useAuthStore.getState().isAuthenticated
        if (!isCurrentlyAuth) return

        if (event.newValue === null) {
          // Key was removed — other tab explicitly cleared auth storage
          useAuthStore.getState().logout()
          return
        }
        try {
          const parsed = JSON.parse(event.newValue)
          if (parsed?.state?.isAuthenticated === false) {
            // Other tab logged out — mirror the logout in this tab.
            // logout() silently catches the failed API call (token already
            // revoked) then clears local state and redirects to /login.
            useAuthStore.getState().logout()
          }
        } catch {
          // Ignore malformed storage values
        }
      }
    }

    window.addEventListener('storage', handleStorageLogout)
    return () => window.removeEventListener('storage', handleStorageLogout)
  }, [])

  useEffect(() => {
    if (isAuthenticated && accessToken) {
      initSocket(accessToken)
      socketReadyRef.current = true
    } else {
      disconnectSocket()
      socketReadyRef.current = false
    }
    return () => {
      disconnectSocket()
      socketReadyRef.current = false
    }
  }, [isAuthenticated, accessToken])

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeManager />
      {/* Only mount SocketManager once the user is authenticated so that
          useSocketEvents() is guaranteed to find a live socket instance. */}
      {isAuthenticated && <SocketManager />}
      {children}
    </QueryClientProvider>
  )
}
