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

  // FE-R-005: Cross-tab logout synchronisation via BroadcastChannel.
  // BroadcastChannel messages are ONLY received by other tabs/windows —
  // never by the tab that posted the message — so there is no same-tab
  // loop risk. This replaces the previous storage-event approach which
  // had subtle same-context timing issues in E2E test environments.
  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return

    const channel = new BroadcastChannel('halqa-auth')

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'LOGOUT') return
      // Only act if this tab currently believes it is authenticated
      if (!useAuthStore.getState().isAuthenticated) return
      useAuthStore.getState().logout()
    }

    channel.addEventListener('message', handleMessage)
    return () => {
      channel.removeEventListener('message', handleMessage)
      channel.close()
    }
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
